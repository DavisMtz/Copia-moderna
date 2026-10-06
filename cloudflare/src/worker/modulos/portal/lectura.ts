/**
 * PORTAL · lectura pública | Portal Ventel en Cloudflare
 * ======================================================
 * Port de la parte de LECTURA de Portal.gs: lo que pintan las pantallas públicas del Portal
 * (Index.html y el buscador global). Cada pestaña de la hoja del Portal es una tabla portal_*; las
 * columnas ya no se buscan por alias de encabezado (eso lo hacía readPortalSheet_ porque la hoja la
 * escribían personas): en SQL tienen nombre fijo.
 *
 * El Portal se ve SIN sesión, como en Apps Script: nada de esto exige sesión. Lo único que cambia es
 * a quién se le enseñan «Cómo acceder» y «Claves» de las herramientas (credenciales compartidas): la
 * web app de Apps Script solo la abría alguien del dominio (access: DOMAIN) y este Worker está en
 * internet, así que esas dos columnas viajan solo con una sesión válida del equipo.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIntentosRevisar, secIntentosSumar } from '../../nucleo/seguridad';
import { nuevoId } from '../../nucleo/util';
import { inicioDelDiaMx } from '../../nucleo/fechas';
import {
  PORTAL_ANUNCIOS_FORMATOS, datosDeFila, diaMx, estadoAnuncio, hayPersona, ordenDeFila,
  portalNombreResponsable, textoError, type FilaAnuncio
} from './comun';

// ── Anuncios visibles (readPortalAnuncios_) ─────────────────────────────────

/**
 * Las publicaciones que se ven en el Portal: activas, ya iniciadas y no expiradas, por «Orden»
 * (a igual orden, la que se creó antes). La hoja legacy «Avisos» no existe en D1: no hay respaldo
 * que leer.
 */
export async function leerAnunciosPublicos(ctx: Ctx): Promise<any[]> {
  const filas = await ctx.todas<FilaAnuncio>(
    'SELECT id, formato, activo, orden, desde, hasta, datos, autor, responsable, creado FROM portal_anuncios ORDER BY rowid');
  const ahora = new Date();
  const hoy0 = inicioDelDiaMx(ahora);
  const out: any[] = [];
  for (const f of filas) {
    if (!f.id || estadoAnuncio(f, ahora, hoy0) !== 'activo') continue;
    const formato = f.formato ? String(f.formato).trim().toLowerCase() : 'banner';
    if (PORTAL_ANUNCIOS_FORMATOS.indexOf(formato) < 0) continue;
    // `datos` va PRIMERO y las claves de la fila después: la columna manda sobre el JSON. Un `id`
    // o un `responsable` escritos dentro del JSON no pueden suplantar los de la tabla. El correo
    // del autor NO viaja: en el Portal público solo va el nombre.
    out.push(Object.assign({}, datosDeFila(f.datos), {
      id: String(f.id).trim(),
      formato,
      orden: ordenDeFila(f.orden),
      responsable: portalNombreResponsable(f.responsable, f.autor),
      creado: diaMx(f.creado)
    }));
  }
  out.sort((a, b) => (a.orden || 0) - (b.orden || 0));
  return out;
}

// ── fetchToolsData (Index.html y el buscador global) ────────────────────────

const txt = (v: unknown) => String(v || '').trim();

/**
 * Herramientas, presentaciones, paqueterías, formatos, planes de pago, plantillas y anuncios.
 * Misma forma que buildToolsData_: una fila sin su campo requerido no se lista.
 */
export async function fetchToolsData(ctx: Ctx) {
  const response: Record<string, any> = {
    herramientas: [],
    presentaciones: [],
    paqueterias: [],
    formatos: [],
    pdePago: [],
    plantillas: [],
    avisos: [],
    anuncios: [],
    status: 'ok',
    error: null
  };

  try {
    const [conCredenciales, lote, anuncios] = await Promise.all([
      hayPersona(ctx),
      ctx.lote([
        ['SELECT nombre, enlace, como_acceder, descripcion, claves FROM portal_herramientas ORDER BY orden, rowid'],
        ['SELECT nombre, liga, descripcion FROM portal_presentaciones ORDER BY orden, rowid'],
        ['SELECT nombre, liga, soms FROM portal_paqueterias ORDER BY orden, rowid'],
        ['SELECT acceso, observaciones, liga FROM portal_formatos ORDER BY orden, rowid'],
        ['SELECT nombre, detalles, liga FROM portal_pdepago ORDER BY orden, rowid'],
        ['SELECT titulo, tipo, asunto, cuerpo, consideraciones FROM portal_plantillas ORDER BY orden, rowid']
      ]),
      leerAnunciosPublicos(ctx)
    ]);
    const [herr, pres, paq, fmt, pdp, plt] = lote.map((r) => r.filas);

    // Herramientas — Nombre | Enlace | Como acceder | Descripcion | Claves
    response.herramientas = herr.filter((r) => txt(r.nombre)).map((r) => ({
      nombre: txt(r.nombre),
      enlace: txt(r.enlace),
      comoAcceder: conCredenciales ? txt(r.como_acceder) : '',
      descripcion: txt(r.descripcion),
      claves: conCredenciales ? txt(r.claves) : ''
    }));
    // Presentaciones — Nombre | LIGA | DESCRPCION
    response.presentaciones = pres.filter((r) => txt(r.nombre)).map((r) => ({
      nombre: txt(r.nombre), liga: txt(r.liga), descripcion: txt(r.descripcion)
    }));
    // Paqueterias — Nombre | Liga | Soms
    response.paqueterias = paq.filter((r) => txt(r.nombre)).map((r) => ({
      nombre: txt(r.nombre), liga: txt(r.liga), soms: txt(r.soms)
    }));
    // Formatos — ACCESO | OBSERVACIONES | LIGA
    response.formatos = fmt.filter((r) => txt(r.acceso)).map((r) => ({
      acceso: txt(r.acceso), observaciones: txt(r.observaciones), liga: txt(r.liga)
    }));
    // PdePago — Nombre | Detalles | Liga
    response.pdePago = pdp.filter((r) => txt(r.nombre)).map((r) => ({
      nombre: txt(r.nombre), detalles: txt(r.detalles), liga: txt(r.liga)
    }));
    // Plantillas — Titulo | Tipo | Asunto | Cuerpo | Consideraciones
    response.plantillas = plt.filter((r) => txt(r.titulo)).map((r) => ({
      titulo: txt(r.titulo), tipo: txt(r.tipo), asunto: txt(r.asunto), cuerpo: txt(r.cuerpo),
      consideraciones: txt(r.consideraciones)
    }));

    response.anuncios = anuncios;
    // Compatibilidad: cachés antiguas del cliente aún leen "avisos" (solo banners).
    response.avisos = anuncios
      .filter((a) => a.formato === 'banner')
      .map((a) => ({ mensaje: a.mensaje || '', tipo: a.tono || 'info' }));
  } catch (error) {
    response.status = 'error';
    response.error = textoError(error);
    console.error('fetchToolsData', error);
  }
  return response;
}

// ── Reporte de enlaces caídos (botón «Reportar» de las tarjetas) ────────────

/**
 * Apunta el reporte en portal_reportes (la pestaña «Reportes»). Es la única escritura abierta del
 * Portal: 20 reportes por persona y hora. Sin sesión todos comparten la cuenta «anonimo», igual que
 * en Apps Script quien no daba su cuenta de Google: así nadie puede inflar la tabla desde fuera.
 */
export async function reportBrokenLink(ctx: Ctx, report: any) {
  try {
    // Apps Script tomaba la cuenta de Google del dominio; aquí, el correo de la sesión si la hay.
    const quien = ctx.sesion ? ctx.sesion.email : '';
    const claveLimite = 'reporte_' + (quien || 'anonimo');
    if ((await secIntentosRevisar(ctx, claveLimite, 20)).bloqueado) {
      return { status: 'error', error: 'Recibimos varios reportes tuyos hace poco. Intenta más tarde.' };
    }
    await secIntentosSumar(ctx, claveLimite, 3600);

    await ctx.ejecutar(
      'INSERT INTO portal_reportes (id, orden, fecha, seccion, nombre, enlace, usuario) ' +
      'VALUES (?, (SELECT COALESCE(MAX(orden), 0) + 1 FROM portal_reportes), ?, ?, ?, ?, ?)',
      nuevoId('rep'), ctx.ahoraIso(),
      String((report && report.seccion) || '').slice(0, 200),
      String((report && report.nombre) || '').slice(0, 200),
      String((report && report.enlace) || '').slice(0, 500),
      quien);
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error: textoError(error) };
  }
}

// ── pvArchivos (lo que dice Drive de cada presentación) ─────────────────────

/**
 * En Apps Script preguntaba a Drive el título real, el tipo y la última edición de cada archivo de
 * «Presentaciones». Aquí no hay Drive: vacío controlado. Con `archivos` vacío la ficha se pinta igual,
 * sin esas líneas, que es lo mismo que hacía el cliente sin respuesta.
 */
export async function pvArchivos(_ctx: Ctx) {
  return { status: 'ok', archivos: {} };
}
