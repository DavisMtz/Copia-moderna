/**
 * MONITOREO — la sección «Métricas» de la consola | Portal Ventel en Cloudflare
 * ============================================================================
 * Port de Monitoreo.gs. Responde a «¿cuánto y quién?» sobre cuatro rastros: cotizaciones, correos
 * enviados (metricas_correos), búsquedas (metricas_busquedas) y cambios (bitácora de la consola).
 *
 * Las tres reglas del original siguen mandando:
 *   1. NADA se calcula al abrir la consola: cada consulta la pide el usuario.
 *   2. Se lee lo mínimo: en la hoja era «por la cola y por lotes»; en D1 es el índice por fecha con
 *      un techo de filas leídas (MON_MAX_CANDIDATAS) y otro de filas devueltas (MON_TOPE_FILAS), y
 *      los dos se le cuentan al usuario cuando se alcanzan.
 *   3. EL RECORTE JERÁRQUICO ES DEL SERVIDOR, resuelto una vez por consulta.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIdentidad, secIntentosRevisar, secIntentosSumar } from '../../nucleo/seguridad';
import { cacheLeer, cacheGuardar } from '../../nucleo/sistema';
import { aFecha, formatearFecha, fechaDesdeMx, partesMx } from '../../nucleo/fechas';
import { jsonSeguro } from '../../nucleo/util';
import {
  consolaAcceso, consolaPersonas, consolaRangoFechas, consolaBitacoraEnRango, plano, COLADOR_ES, type AccesoOk
} from './comun';

/** Topes de lectura. CANDIDATAS: filas que se leen como mucho; TOPE_FILAS: las que vuelven. */
const MON_MAX_CANDIDATAS = 4000;
const MON_TOPE_FILAS = 800;
/** Ventana en la que lo que se sigue tecleando cuenta como la misma búsqueda. */
const MON_BUSQ_VENTANA = 45;
/** Búsquedas por persona y hora que se apuntan. Freno de la escritura, no del buscador. */
const MON_BUSQ_POR_HORA = 200;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Solo dígitos: «55 1234 5678», «55-1234-5678» y «5512345678» son el mismo teléfono. */
function soloDigitos(texto: unknown): string {
  return String(texto == null ? '' : texto).replace(/\D+/g, '');
}

function isoDe(valor: unknown): string {
  const d = aFecha(valor);
  return d ? d.toISOString() : '';
}

/** yyyy-MM-dd de una fecha, en hora de México (lo que daba `dia()` con la zona del script). */
function dia(d: Date): string {
  return formatearFecha(d, 'yyyy-MM-dd');
}

interface RangoMon { ok: true; desde: Date; hasta: Date; porDefecto: boolean; completado: string; conHoras: boolean }

/**
 * monRango_: rango de la consulta. Sin fechas, los últimos 30 días. Media fecha NO se ignora en
 * silencio: se completa la que falta y se dice cuál se completó. Las horas, si vienen, acotan el
 * primer y el último día (en hora de México).
 */
function monRango(filtros: any): RangoMon | { ok: false; error: string } {
  const f = (filtros && typeof filtros === 'object') ? filtros : {};
  let desde = String(f.desde || '').trim();
  let hasta = String(f.hasta || '').trim();

  if (!desde && !hasta) {
    const hoy = new Date();
    hasta = dia(hoy);
    desde = dia(new Date(hoy.getTime() - 30 * DIA_MS));
  }
  let completado = '';
  if (desde && !hasta) { hasta = dia(new Date()); completado = 'hasta hoy'; }
  else if (!desde && hasta) {
    const fin = aFecha(/^\d{4}-\d{2}-\d{2}$/.test(hasta) ? hasta + 'T00:00:00' : hasta);
    desde = dia(fin ? new Date(fin.getTime() - 30 * DIA_MS) : new Date());
    completado = 'los treinta días anteriores';
  }

  const r = consolaRangoFechas(desde, hasta);
  if (!r.ok) return { ok: false, error: r.error };

  const hora = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const hd = hora.exec(String(f.horaDesde || '').trim());
  const hh = hora.exec(String(f.horaHasta || '').trim());
  let ini = r.desde, fin = r.hasta;
  // setHours() del día en hora de México: el Worker está en UTC.
  if (hd) { const p = partesMx(ini); ini = fechaDesdeMx(p.anio, p.mes, p.dia, Number(hd[1]), Number(hd[2]), 0, 0); }
  if (hh) { const p = partesMx(fin); fin = fechaDesdeMx(p.anio, p.mes, p.dia, Number(hh[1]), Number(hh[2]), 59, 999); }
  if (ini > fin) return { ok: false, error: 'La hora de inicio es posterior a la de fin.' };

  return { ok: true, desde: ini, hasta: fin, porDefecto: !f.desde && !f.hasta, completado, conHoras: !!(hd || hh) };
}

// ── Puerta y alcance ────────────────────────────────────────────────────────

type AccesoMon = AccesoOk & { alcance: Set<string> | null };

/** monAcceso_: sesión válida y sección 'metricas', con el ALCANCE ya resuelto. */
async function monAcceso(ctx: Ctx, email: unknown): Promise<AccesoMon | { ok: false; error: string }> {
  const acc = await consolaAcceso(ctx, email, 'metricas');
  if (!acc.ok) return { ok: false, error: acc.error };
  return Object.assign(acc, { alcance: await monAlcance(ctx, acc) });
}

/**
 * monAlcance_: correos que esta persona puede mirar. `null` = todos (maestro). Para cualquier otro
 * perfil, la gente de su nivel hacia abajo (la misma regla que la lista de miembros y la bitácora),
 * más su propia cuenta.
 */
async function monAlcance(ctx: Ctx, acc: AccesoOk): Promise<Set<string> | null> {
  if (acc.maestro) return null;
  const permitidos = new Set<string>();
  for (const p of await consolaPersonas(ctx)) if (p.nivel <= acc.nivel) permitidos.add(p.email);
  if (acc.email) permitidos.add(String(acc.email).toLowerCase());
  return permitidos;
}

/**
 * monPuedeVer_: con alcance, solo lo suyo y lo de abajo. Una fila SIN dueño reconocible NO se
 * enseña: es preferible que falte una fila a que un supervisor vea lo de alguien por encima.
 */
function monPuedeVer(alcance: Set<string> | null, correo: unknown): boolean {
  if (alcance === null) return true;
  const c = String(correo == null ? '' : correo).trim().toLowerCase();
  return !!(c && alcance.has(c));
}

interface Recorrido<T> { filas: T[]; truncado: boolean; leidas: number; candidatas: number }

/**
 * monRecorrer_: las filas del rango que pasan el filtro. En la hoja eran dos pasadas (la columna de
 * fechas entera y luego los tramos); en D1 la consulta por rango ya devuelve solo lo que cae dentro,
 * de lo más reciente a lo más viejo, con el techo de candidatas. El filtro fino (asesor, cliente…)
 * se aplica DESPUÉS, igual que allá, y luego se corta a lo que se enseña.
 */
async function monRecorrer<T>(ctx: Ctx, sql: string, colFecha: string, desde: Date, hasta: Date,
  mapear: (fila: any, cuando: Date) => T | null): Promise<Recorrido<T>> {
  const crudas = await ctx.todas<any>(sql + ' WHERE ' + colFecha + ' >= ? AND ' + colFecha + ' <= ? ' +
    'ORDER BY ' + colFecha + ' DESC, rowid DESC LIMIT ?', desde.toISOString(), hasta.toISOString(), MON_MAX_CANDIDATAS);
  const salida: Recorrido<T> = { filas: [], truncado: crudas.length >= MON_MAX_CANDIDATAS, leidas: crudas.length, candidatas: 0 };
  const recogidas: T[] = [];
  for (const f of crudas) {
    const cuando = aFecha(f[colFecha]);
    if (!cuando || cuando < desde || cuando > hasta) continue;
    salida.candidatas++;
    const obj = mapear(f, cuando);
    if (obj) recogidas.push(obj);
  }
  if (recogidas.length > MON_TOPE_FILAS) {
    recogidas.length = MON_TOPE_FILAS;
    salida.truncado = true;
  }
  salida.filas = recogidas;
  return salida;
}

/** monRespuesta_: el envoltorio común de las cuatro consultas (una tabla y no cuatro). */
function monRespuesta(r: { filas: unknown[]; truncado?: boolean; leidas?: number; candidatas?: number }, rango: RangoMon, extra: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    success: true,
    filas: r.filas,
    total: r.filas.length,
    truncado: r.truncado === true,
    leidas: r.leidas || 0,
    desde: rango.desde.toISOString(),
    hasta: rango.hasta.toISOString(),
    porDefecto: rango.porDefecto === true,
    completado: rango.completado || '',
    candidatas: r.candidatas || 0
  };
  Object.keys(extra || {}).forEach((k) => { base[k] = extra[k]; });
  return base;
}

// ── Registro de búsquedas ───────────────────────────────────────────────────

/**
 * monRegistrarBusqueda_: apunta una búsqueda. NUNCA lanza ni frena a quien buscaba.
 *
 *   · SIN SESIÓN NO SE APUNTA NADA: la búsqueda de folios es global y sin esta guarda cualquiera
 *     podría escribir en las métricas sin estar dado de alta.
 *   · Tope por persona y hora (es una escritura disparada por teclear).
 *   · Mientras se teclea, la fila se AFINA en vez de multiplicarse: si lo nuevo continúa lo
 *     anterior (o al revés, porque también se borran letras) dentro de la ventana, se reescribe la
 *     última fila de esta persona con el término más largo.
 * En D1 no hay fórmulas: el término se guarda tal cual (el CSV de la pantalla ya lo neutraliza).
 */
export async function monRegistrarBusqueda(ctx: Ctx, termino: string, email: string, origen: string, resultados?: number): Promise<void> {
  try {
    const texto = String(termino == null ? '' : termino).trim();
    if (texto.length < 3 || texto.length > 120) return;

    let quien = '', nombre = '';
    try {
      const id = await secIdentidad(ctx, email);
      if (id.ok) { quien = id.email; nombre = id.nombre || ''; }
    } catch { /* sin identidad no se apunta */ }
    if (!quien) return;

    const claveTope = 'busq_' + quien;
    if ((await secIntentosRevisar(ctx, claveTope, MON_BUSQ_POR_HORA)).bloqueado) return;
    await secIntentosSumar(ctx, claveTope, 3600);

    const n = (resultados === undefined || resultados === null || (resultados as unknown) === '') ? null : Number(resultados);
    const resultadosNum = n === null || !Number.isFinite(n) ? null : n;
    const clave = 'monbus_' + quien;
    const textoPlano = plano(texto);
    const previa = jsonSeguro<{ t?: string; texto?: string; id?: number } | null>(await cacheLeer(ctx, clave), null);

    if (previa && previa.id && previa.t &&
        (textoPlano.indexOf(previa.t) === 0 || previa.t.indexOf(textoPlano) === 0)) {
      const largo = textoPlano.length >= previa.t.length ? texto : String(previa.texto || texto);
      // Solo si la fila sigue siendo suya (la condición va en el WHERE).
      const r = await ctx.ejecutar(
        'UPDATE metricas_busquedas SET termino = ?, resultados = COALESCE(?, resultados) WHERE id = ? AND quien = ?',
        largo, resultadosNum, previa.id, quien);
      if (r.cambios) {
        await cacheGuardar(ctx, clave, JSON.stringify({
          t: textoPlano.length >= previa.t.length ? textoPlano : previa.t, texto: largo, id: previa.id
        }), MON_BUSQ_VENTANA);
        return;
      }
    }

    const r = await ctx.ejecutar(
      'INSERT INTO metricas_busquedas (fecha, termino, quien, nombre, origen, resultados) VALUES (?, ?, ?, ?, ?, ?)',
      ctx.ahoraIso(), texto, quien, nombre, String(origen == null ? '' : origen), resultadosNum);
    try {
      await cacheGuardar(ctx, clave, JSON.stringify({ t: textoPlano, texto, id: r.ultimoId }), MON_BUSQ_VENTANA);
    } catch { /* la ventana es una comodidad */ }
  } catch (e) {
    console.error('monRegistrarBusqueda no pudo registrar «' + termino + '»', e);
  }
}

// ── Consultas ───────────────────────────────────────────────────────────────

/** monPanorama: quién es, hasta dónde alcanza y con qué se puede filtrar. Barato a propósito. */
export async function monPanorama(ctx: Ctx, email: string) {
  try {
    const acc = await monAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };

    const personas = (await consolaPersonas(ctx))
      .filter((p) => monPuedeVer(acc.alcance, p.email))
      .map((p) => ({ email: p.email, nombre: p.nombre || '' }))
      .sort((a, b) => COLADOR_ES.compare(a.nombre || a.email, b.nombre || b.email));

    const hoy = new Date();
    const hace30 = new Date(hoy.getTime() - 30 * DIA_MS);
    return {
      success: true,
      yo: { email: acc.email, nombre: acc.nombre, maestro: acc.maestro === true, nivel: acc.nivel },
      alcance: acc.maestro ? 'sistema' : 'jerarquia',
      personas,
      tiposCorreo: ['Cotización (PDF)', 'Plantilla cliente', 'Difusión'],
      rangoPorDefecto: { desde: dia(hace30), hasta: dia(hoy) },
      topes: { filas: MON_TOPE_FILAS, candidatas: MON_MAX_CANDIDATAS }
    };
  } catch (e) {
    console.error('monPanorama', e);
    return { success: false, message: 'No pudimos preparar la sección de métricas. Inténtalo de nuevo en un momento.' };
  }
}

/** Cotizaciones del rango: asesor, correo del cliente, teléfono y texto libre (folio o nombre). */
export async function monCotizaciones(ctx: Ctx, email: string, filtros: any) {
  try {
    const acc = await monAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };
    const rango = monRango(filtros);
    if (!rango.ok) return { success: false, message: rango.error };
    const f = (filtros && typeof filtros === 'object') ? filtros : {};

    const fAsesor = plano(f.asesor);
    const fCorreo = plano(f.cliente);
    const fTel = soloDigitos(f.telefono);
    const fTexto = plano(f.texto);

    const r = await monRecorrer(ctx,
      'SELECT folio, timestamp, asesor_correo, asesor_nombre, cliente_nombre, correo_cliente, numero, ' +
      'total_general, estatus, fecha_envio FROM cotizaciones', 'timestamp', rango.desde, rango.hasta,
      (c, cuando) => {
        const asesor = String(c.asesor_correo || '').trim().toLowerCase();
        if (!monPuedeVer(acc.alcance, asesor)) return null;
        if (fAsesor && asesor !== fAsesor) return null;
        if (fCorreo && plano(c.correo_cliente).indexOf(fCorreo) === -1) return null;
        if (fTel && soloDigitos(c.numero).indexOf(fTel) === -1) return null;
        if (fTexto && plano((c.folio || '') + ' ' + (c.cliente_nombre || '')).indexOf(fTexto) === -1) return null;
        return {
          folio: String(c.folio || ''),
          fecha: cuando.toISOString(),
          asesor,
          asesorNombre: String(c.asesor_nombre || ''),
          cliente: String(c.cliente_nombre || ''),
          correo: String(c.correo_cliente || ''),
          telefono: String(c.numero || ''),
          total: Number(c.total_general || 0) || 0,
          estatus: String(c.estatus || ''),
          envio: isoDe(c.fecha_envio)
        };
      });

    return monRespuesta(r, rango, { total: r.filas.reduce((s, q) => s + q.total, 0) });
  } catch (e) {
    console.error('monCotizaciones', e);
    return { success: false, message: 'No pudimos leer las cotizaciones de ese periodo. Prueba con un rango más corto.' };
  }
}

/** Correos enviados del rango, sobre metricas_correos. */
export async function monCorreos(ctx: Ctx, email: string, filtros: any) {
  try {
    const acc = await monAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };
    const rango = monRango(filtros);
    if (!rango.ok) return { success: false, message: rango.error };
    const f = (filtros && typeof filtros === 'object') ? filtros : {};

    const fAsesor = plano(f.asesor);
    const fTipo = plano(f.tipo);
    const fTexto = plano(f.texto);
    const soloErrores = f.soloErrores === true;

    const r = await monRecorrer(ctx,
      'SELECT fecha, tipo, referencia, asesor_email, asesor_nombre, para, destinatarios, cc, cco, asunto, ' +
      'adjuntos, remitente, resultado, detalle, plantilla_modificada FROM metricas_correos', 'fecha', rango.desde, rango.hasta,
      (c, cuando) => {
        const asesor = String(c.asesor_email || '').trim().toLowerCase();
        if (!monPuedeVer(acc.alcance, asesor)) return null;
        if (fAsesor && asesor !== fAsesor) return null;
        if (fTipo && plano(c.tipo) !== fTipo) return null;
        const resultado = String(c.resultado || '');
        const bien = /enviad/i.test(resultado);
        if (soloErrores && bien) return null;
        if (fTexto && plano((c.asunto || '') + ' ' + (c.para || '') + ' ' + (c.referencia || '')).indexOf(fTexto) === -1) return null;
        return {
          fecha: cuando.toISOString(),
          tipo: String(c.tipo || ''),
          referencia: String(c.referencia || ''),
          asesor,
          asesorNombre: String(c.asesor_nombre || ''),
          para: String(c.para || ''),
          destinatarios: Number(c.destinatarios || 0) || 0,
          cc: Number(c.cc || 0) || 0,
          cco: Number(c.cco || 0) || 0,
          asunto: String(c.asunto || ''),
          adjuntos: Number(c.adjuntos || 0) || 0,
          remitente: String(c.remitente || ''),
          resultado,
          detalle: String(c.detalle || ''),
          plantillaModificada: String(c.plantilla_modificada || ''),
          ok: bien
        };
      });

    const errores = r.filas.filter((x) => !x.ok).length;
    return monRespuesta(r, rango, { errores, enviados: r.filas.length - errores });
  } catch (e) {
    console.error('monCorreos', e);
    return { success: false, message: 'No pudimos leer los correos de ese periodo. Prueba con un rango más corto.' };
  }
}

/** Búsquedas registradas en el rango, con lo más buscado del periodo. */
export async function monBusquedas(ctx: Ctx, email: string, filtros: any) {
  try {
    const acc = await monAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };
    const rango = monRango(filtros);
    if (!rango.ok) return { success: false, message: rango.error };
    const f = (filtros && typeof filtros === 'object') ? filtros : {};

    // En la hoja, «la hoja no existe todavía»; aquí, «la tabla nunca ha recibido una búsqueda».
    const hay = await ctx.una<{ id: number }>('SELECT id FROM metricas_busquedas LIMIT 1');
    if (!hay) {
      return monRespuesta({ filas: [], truncado: false, leidas: 0 }, rango,
        { aviso: 'Todavía no hay búsquedas registradas. Se empiezan a guardar desde que se publicó esta versión.' });
    }

    const fQuien = plano(f.asesor);
    const fTexto = plano(f.texto);

    const r = await monRecorrer(ctx,
      'SELECT fecha, termino, quien, nombre, origen, resultados FROM metricas_busquedas', 'fecha', rango.desde, rango.hasta,
      (c, cuando) => {
        const quien = String(c.quien || '').trim().toLowerCase();
        // Las búsquedas anónimas solo las ve el maestro: no hay forma de saber de quién son.
        if (!quien) { if (acc.alcance !== null) return null; }
        else if (!monPuedeVer(acc.alcance, quien)) return null;
        if (fQuien && quien !== fQuien) return null;
        const termino = String(c.termino || '');
        if (fTexto && plano(termino).indexOf(fTexto) === -1) return null;
        return {
          fecha: cuando.toISOString(),
          termino,
          quien,
          nombre: String(c.nombre || ''),
          origen: String(c.origen || ''),
          resultados: (c.resultados === null || c.resultados === undefined || c.resultados === '') ? null : Number(c.resultados)
        };
      });

    // Lo más buscado del periodo, sobre lo que ya se leyó.
    const cuenta: Record<string, { termino: string; veces: number }> = {};
    r.filas.forEach((b) => {
      const k = plano(b.termino);
      if (!k) return;
      if (!cuenta[k]) cuenta[k] = { termino: b.termino, veces: 0 };
      cuenta[k].veces++;
    });
    const top = Object.keys(cuenta).map((k) => cuenta[k]).sort((a, b) => b.veces - a.veces).slice(0, 15);

    return monRespuesta(r, rango, { top });
  } catch (e) {
    console.error('monBusquedas', e);
    return { success: false, message: 'No pudimos leer las búsquedas de ese periodo.' };
  }
}

/**
 * Cambios de personas y de la instalación del mismo rango. Reutiliza la lectura de la bitácora,
 * donde vive el recorte jerárquico de los apuntes: una regla de seguridad, un solo sitio.
 */
export async function monCambios(ctx: Ctx, email: string, filtros: any) {
  try {
    const acc = await monAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };
    const rango = monRango(filtros);
    if (!rango.ok) return { success: false, message: rango.error };
    const f = (filtros && typeof filtros === 'object') ? filtros : {};

    const r = await consolaBitacoraEnRango(ctx, rango.desde, rango.hasta, acc.usuario);
    const fQuien = plano(f.asesor);
    const fTexto = plano(f.texto);
    const filas = r.filas.filter((b) => {
      if (fQuien && plano(b.quien) !== fQuien) return false;
      if (fTexto && plano(b.accion + ' ' + b.objetivo + ' ' + b.detalle + ' ' + b.quien).indexOf(fTexto) === -1) return false;
      return true;
    });

    return monRespuesta({ filas, truncado: r.truncado, leidas: r.leidas }, rango, {});
  } catch (e) {
    console.error('monCambios', e);
    return { success: false, message: 'No pudimos leer los cambios de ese periodo.' };
  }
}
