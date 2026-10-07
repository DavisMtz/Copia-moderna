/**
 * PORTAL · anuncios y publicaciones | Portal Ventel en Cloudflare
 * ===============================================================
 * Port de la AUTORÍA de anuncios de Portal.gs (anuncios.html: getAnunciosAdmin, publicarAnuncio,
 * eliminarAnuncio, toggleAnuncio, moverAnuncio, subirImagenAnuncio), del interruptor del
 * reconocimiento (recoEstado, recoCambiarVisible) y de Publicaciones.gs (pubPorId, pubResultados,
 * pubVotar).
 *
 * La hoja «Anuncios» es la tabla portal_anuncios y «Votos» es portal_votos. Lo que en la hoja había
 * que vigilar a mano ya lo garantiza SQL: toda fila tiene ID (clave primaria, así que
 * pubAsegurarIdsAnuncios_ sobra), y «un voto por persona y publicación» es la clave primaria de
 * portal_votos. Las imágenes van a R2 (guardarArchivo) en lugar de a una carpeta de Drive.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIdentidad, secIntentosRevisar, secIntentosSumar, secNormalizarCorreo } from '../../nucleo/seguridad';
import { leerPropiedad, fijarPropiedad } from '../../nucleo/sistema';
import { guardarArchivo } from '../../nucleo/archivos';
import { fechaDesdeMx, inicioDelDiaMx } from '../../nucleo/fechas';
import {
  PORTAL_ANUNCIOS_FORMATOS, datosDeFila, diaMx, estadoAnuncio, fechaDeCelda, ordenDeFila,
  portalEsActivo, portalGateAvanzado, portalNombreResponsable, portalParseFechaLocal, textoError,
  type FilaAnuncio
} from './comun';

const COLUMNAS = 'id, formato, activo, orden, desde, hasta, datos, autor, responsable, creado';

// ── Identidad y saneo de una publicación (Publicaciones.gs) ─────────────────

/** ID nuevo para una publicación: reloj + sufijo al azar (pubNuevoIdAnuncio_). */
function pubNuevoIdAnuncio(): string {
  return 'anc-' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
}

/** Máximo de opciones de una encuesta: más no caben en la tarjeta ni en móvil. */
const PUB_ENCUESTA_MAX_OPCIONES = 6;

/**
 * Acota lo que se guarda en «Datos (JSON)» (pubSanearDatos_). Solo se recorta lo que tiene forma
 * conocida —la encuesta—; el resto pasa tal cual para no tirar campos de un constructor futuro.
 */
function pubSanearDatos(datos: any): Record<string, any> {
  const out: Record<string, any> = {};
  Object.keys(datos || {}).forEach((k) => {
    // `__proto__` como clave reemplaza el prototipo en vez de crear un campo: se descarta.
    if (k === '__proto__') return;
    out[k] = datos[k];
  });
  if (!out.encuesta || typeof out.encuesta !== 'object') {
    delete out.encuesta;
    return out;
  }
  const e = out.encuesta;
  const opciones = (Array.isArray(e.opciones) ? e.opciones : [])
    .map((o: unknown) => String(o == null ? '' : o).trim().slice(0, 80))
    .filter((o: string) => !!o)
    .slice(0, PUB_ENCUESTA_MAX_OPCIONES);
  const pregunta = String(e.pregunta || '').trim().slice(0, 160);
  // Sin pregunta o con una sola opción no es una encuesta: se guarda como tarjeta informativa.
  if (!pregunta || opciones.length < 2) {
    delete out.encuesta;
    return out;
  }
  out.encuesta = {
    pregunta,
    opciones,
    tiempo: String(e.tiempo || '').trim().slice(0, 40),
    cierre: /^\d{4}-\d{2}-\d{2}$/.test(String(e.cierre || '')) ? String(e.cierre) : '',
    verAntes: e.verAntes === true
  };
  return out;
}

/**
 * El «Orden» de una publicación NUEVA para salir la primera: uno menos que el menor que haya
 * (pubOrdenParaNueva_). Que se vaya a negativo no molesta: el primer reordenado lo normaliza.
 */
async function pubOrdenParaNueva(ctx: Ctx): Promise<number> {
  try {
    const r = await ctx.una<{ minimo: number | null }>('SELECT MIN(orden) AS minimo FROM portal_anuncios');
    return r && r.minimo !== null && r.minimo !== undefined && !isNaN(Number(r.minimo)) ? Number(r.minimo) - 1 : 0;
  } catch (e) {
    console.error('pubOrdenParaNueva', e);
    return 0;
  }
}

// ── Autoría de anuncios (anuncios.html) ─────────────────────────────────────

/** Crea o actualiza una publicación. payload: {id?, formato, activo, orden, desde, hasta, datos, asesor}. */
export async function publicarAnuncio(ctx: Ctx, payload: any) {
  try {
    const gate = await portalGateAvanzado(ctx, payload && payload.asesor);
    if (!gate.ok) return { status: 'error', error: gate.error };
    if (!payload || !payload.formato) throw new Error('Falta el formato del anuncio.');
    const formato = String(payload.formato).trim().toLowerCase();
    if (PORTAL_ANUNCIOS_FORMATOS.indexOf(formato) < 0) throw new Error('Formato no válido: ' + formato);

    const datos = pubSanearDatos(payload.datos && typeof payload.datos === 'object' ? payload.datos : {});
    const activo = payload.activo === undefined ? true : !!payload.activo;
    let orden = Number(payload.orden) || 0;
    const id = payload.id && String(payload.id).trim() ? String(payload.id).trim() : pubNuevoIdAnuncio();

    const previa = await ctx.una<FilaAnuncio>('SELECT ' + COLUMNAS + ' FROM portal_anuncios WHERE id = ?', id);

    // LO NUEVO VA PRIMERO: solo al crear y solo si no se pidió un orden concreto.
    if (!previa && !Number(payload.orden)) orden = await pubOrdenParaNueva(ctx);

    // Autoría y fecha de alta se fijan al CREAR y no se vuelven a tocar: corregir una errata en el
    // anuncio de otra persona no te lo adjudica. Una fila de antes sin autor lo recibe de quien edita.
    const autorPrevio = previa ? String(previa.autor || '').trim() : '';
    const respPrevio = previa ? String(previa.responsable || '').trim() : '';
    const creadoPrevio = previa ? fechaDeCelda(previa.creado) : null;

    const desde = portalParseFechaLocal(payload.desde, true);
    const hasta = portalParseFechaLocal(payload.hasta);

    await ctx.ejecutar(
      'INSERT INTO portal_anuncios (' + COLUMNAS + ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET formato = excluded.formato, activo = excluded.activo, orden = excluded.orden, ' +
      'desde = excluded.desde, hasta = excluded.hasta, datos = excluded.datos, autor = excluded.autor, ' +
      'responsable = excluded.responsable, creado = excluded.creado',
      id, formato, activo ? 1 : 0, orden,
      desde ? desde.toISOString() : null,
      hasta ? hasta.toISOString() : null,
      JSON.stringify(datos),
      autorPrevio || gate.email,
      // El nombre legible es lo que se pinta en el Portal; el correo se queda para quien administra.
      respPrevio || gate.nombre || '',
      (creadoPrevio || new Date()).toISOString());

    return { status: 'ok', id };
  } catch (error) {
    return { status: 'error', error: textoError(error) };
  }
}

/** TODAS las publicaciones (activas, inactivas, programadas y expiradas) para quien administra. */
export async function getAnunciosAdmin(ctx: Ctx, email: string) {
  try {
    const gate = await portalGateAvanzado(ctx, email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const filas = await ctx.todas<FilaAnuncio>('SELECT ' + COLUMNAS + ' FROM portal_anuncios ORDER BY rowid');
    const ahora = new Date();
    const hoy0 = inicioDelDiaMx(ahora);
    const anuncios = filas.filter((f) => f.id).map((f) => ({
      id: String(f.id).trim(),
      formato: f.formato == null ? '' : String(f.formato).trim().toLowerCase(),
      activo: portalEsActivo(f.activo),
      estado: estadoAnuncio(f, ahora, hoy0),
      orden: ordenDeFila(f.orden),
      desde: diaMx(f.desde),
      hasta: diaMx(f.hasta),
      datos: datosDeFila(f.datos),
      // Aquí SÍ va el correo: es la pantalla de administración y saber a quién preguntarle por un
      // anuncio ajeno es media razón para abrirla. En el Portal público solo viaja el nombre.
      autor: String(f.autor || '').trim(),
      responsable: portalNombreResponsable(f.responsable, f.autor),
      creado: diaMx(f.creado)
    }));
    anuncios.sort((a, b) => (a.orden || 0) - (b.orden || 0));
    return { status: 'ok', anuncios };
  } catch (error) {
    return { status: 'error', error: textoError(error) };
  }
}

export async function eliminarAnuncio(ctx: Ctx, id: string, email: string) {
  try {
    const gate = await portalGateAvanzado(ctx, email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const r = await ctx.ejecutar('DELETE FROM portal_anuncios WHERE id = ?', String(id).trim());
    if (!r.cambios) return { status: 'error', error: 'No se encontró el anuncio.' };
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error: textoError(error) };
  }
}

export async function toggleAnuncio(ctx: Ctx, id: string, activo: unknown, email: string) {
  try {
    const gate = await portalGateAvanzado(ctx, email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const r = await ctx.ejecutar('UPDATE portal_anuncios SET activo = ? WHERE id = ?', activo ? 1 : 0, String(id).trim());
    if (!r.cambios) return { status: 'error', error: 'No se encontró el anuncio.' };
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error: textoError(error) };
  }
}

/** Reordena un anuncio (dir: 'up' | 'down') reescribiendo el orden secuencial 0..n-1. */
export async function moverAnuncio(ctx: Ctx, id: string, dir: string, email: string) {
  try {
    const gate = await portalGateAvanzado(ctx, email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const filas = await ctx.todas<{ id: string; orden: number | null }>(
      'SELECT id, orden FROM portal_anuncios ORDER BY rowid');
    if (filas.length < 2) return { status: 'ok' }; // 0-1 anuncios: nada que mover

    const items = filas.map((f, i) => ({ id: String(f.id || '').trim(), orden: Number(f.orden) || 0, pos: i }))
      .filter((x) => x.id)
      .sort((a, b) => a.orden - b.orden || a.pos - b.pos);
    const pos = items.findIndex((x) => x.id === String(id).trim());
    if (pos < 0) return { status: 'error', error: 'No se encontró el anuncio.' };
    const swap = dir === 'up' ? pos - 1 : pos + 1;
    if (swap < 0 || swap >= items.length) return { status: 'ok' };
    const tmp = items[pos]; items[pos] = items[swap]; items[swap] = tmp;

    // El orden secuencial (0..n-1) en UNA sentencia: la posición de cada id en el arreglo JSON.
    await ctx.ejecutar(
      'UPDATE portal_anuncios SET orden = CAST(j.key AS INTEGER) FROM json_each(?1) AS j WHERE portal_anuncios.id = j.value',
      JSON.stringify(items.map((x) => x.id)));
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error: textoError(error) };
  }
}

/**
 * Sube una imagen (data:URL) y devuelve una URL pública. payload: {dataUrl, nombre, asesor}.
 * En Apps Script iba a una carpeta de Drive; aquí a R2, servida desde el mismo dominio (/archivos/…).
 */
export async function subirImagenAnuncio(ctx: Ctx, payload: any) {
  try {
    const gate = await portalGateAvanzado(ctx, payload && payload.asesor);
    if (!gate.ok) return { status: 'error', error: gate.error };
    if (!payload || !payload.dataUrl) throw new Error('No se recibió la imagen.');
    const m = String(payload.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error('Formato de imagen no válido.');
    const mime = m[1].toLowerCase();
    if (mime.indexOf('image/') !== 0) throw new Error('El archivo no es una imagen.');
    // Solo mapas de bits: un SVG servido desde el dominio del sistema puede llevar código (en Drive
    // salía como miniatura rasterizada, aquí se serviría tal cual). El cliente ya manda JPEG.
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(mime)) throw new Error('Sube la imagen en JPG, PNG, GIF o WEBP.');
    const b64 = m[2].replace(/\s+/g, '');
    const bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    if (bytes > 8 * 1024 * 1024) throw new Error('La imagen supera el límite de 8 MB.');

    const nombre = String(payload.nombre || 'anuncio').replace(/[^\w.\-]+/g, '_') + '-' + Date.now();
    const archivo = await guardarArchivo(ctx, {
      datos: String(payload.dataUrl), tipo: mime, nombre, carpeta: 'anuncios', subidoPor: gate.email,
      maxBytes: 8 * 1024 * 1024
    });
    return { status: 'ok', url: archivo.url, id: archivo.clave };
  } catch (error) {
    return { status: 'error', error: textoError(error) };
  }
}

// ── Interruptor del reconocimiento (RECO_VISIBLE) ───────────────────────────

/** Sin la propiedad, se ve. Lo mueve quien tiene el bloque 'anuncios'. */
const RECO_PROPIEDAD = 'RECO_VISIBLE';

async function recoVisible(ctx: Ctx): Promise<boolean> {
  try { return (await leerPropiedad(ctx, RECO_PROPIEDAD)) !== 'no'; } catch { return true; }
}

/** Estado del interruptor, para el constructor de anuncios. */
export async function recoEstado(ctx: Ctx, email: string) {
  const gate = await portalGateAvanzado(ctx, email);
  if (!gate.ok) return { status: 'error', error: gate.error };
  return { status: 'ok', visible: await recoVisible(ctx) };
}

/**
 * Enciende o apaga el reconocimiento en todas las pantallas que lo enseñan. El Worker lee la
 * propiedad al servir cada pantalla (con una memoria de 30 s por isolate): el cambio se ve al abrirlas.
 */
export async function recoCambiarVisible(ctx: Ctx, visible: unknown, email: string) {
  try {
    const gate = await portalGateAvanzado(ctx, email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    await fijarPropiedad(ctx, RECO_PROPIEDAD, visible ? 'si' : 'no');
    console.log('recoCambiarVisible → ' + (visible ? 'si' : 'no') + ' (' + gate.email + ')');
    return { status: 'ok', visible: !!visible };
  } catch (error) {
    return { status: 'error', error: textoError(error) };
  }
}

// ── Una publicación por su id (enlace compartible) ──────────────────────────

/**
 * UNA publicación por id, esté a la vista o no, diciendo por qué no lo está: 'activo' | 'expirado' |
 * 'programado'. Una OCULTA no se sirve por enlace: ocultar es la forma de retirar algo del Portal.
 * Pública: no usa el correo.
 */
export async function pubPorId(ctx: Ctx, id: string, _email?: string) {
  try {
    const clave = String(id || '').trim();
    if (!clave) return { status: 'error', error: 'Falta el identificador de la publicación.' };

    const f = await ctx.una<FilaAnuncio>('SELECT ' + COLUMNAS + ' FROM portal_anuncios WHERE id = ?', clave);
    if (!f) {
      const hay = await ctx.una('SELECT 1 AS x FROM portal_anuncios LIMIT 1');
      return hay
        ? { status: 'error', error: 'No encontramos esa publicación.', estado: 'inexistente' }
        : { status: 'error', error: 'No encontramos esa publicación.' };
    }

    const ahora = new Date();
    const estado = estadoAnuncio(f, ahora, inicioDelDiaMx(ahora));
    if (estado === 'inactivo') {
      return { status: 'error', error: 'Esa publicación ya no está disponible.', estado: 'inactivo' };
    }
    const pub = Object.assign({}, datosDeFila(f.datos), {
      id: clave,
      formato: f.formato ? String(f.formato).trim().toLowerCase() : 'banner',
      orden: ordenDeFila(f.orden),
      responsable: portalNombreResponsable(f.responsable, f.autor),
      creado: diaMx(f.creado),
      estado,
      desde: diaMx(f.desde),
      hasta: diaMx(f.hasta)
    });
    return { status: 'ok', pub };
  } catch (error) {
    return { status: 'error', error: textoError(error) };
  }
}

// ── Encuestas: votos ────────────────────────────────────────────────────────

/**
 * Quién vota: la sesión del Portal. En Apps Script, sin sesión quedaba la cuenta de Google del
 * dominio; aquí no hay cuenta de Google, así que sin sesión no se vota («un voto por persona» sin
 * persona no significa nada).
 */
async function pubQuienVota(ctx: Ctx, emailCliente: unknown): Promise<{ ok: true; correo: string; nombre: string } | { ok: false; error: string }> {
  const declarado = secNormalizarCorreo(emailCliente);
  if (declarado || ctx.sesion) {
    try {
      const id = await secIdentidad(ctx, declarado);
      if (id.ok) return { ok: true, correo: id.email, nombre: id.nombre };
    } catch { /* sin identidad */ }
  }
  return { ok: false, error: 'Inicia sesión en el sistema para poder votar.' };
}

/**
 * Recuento de una encuesta: conteo por opción y voto por persona (pubContar_). Los mapas van SIN
 * prototipo: sus claves son texto que escribió alguien («constructor» no debe existir de antemano).
 */
async function pubContar(ctx: Ctx, id: string) {
  const conteo: Record<string, number> = Object.create(null);
  let total = 0;
  const filas = await ctx.todas<{ opcion: string; n: number }>(
    "SELECT trim(opcion) AS opcion, COUNT(*) AS n FROM portal_votos WHERE publicacion = ? AND trim(opcion) <> '' GROUP BY trim(opcion)", id);
  for (const f of filas) { conteo[f.opcion] = (conteo[f.opcion] || 0) + Number(f.n); total += Number(f.n); }
  return { total, conteo };
}

async function pubVotoDe(ctx: Ctx, id: string, correo: string): Promise<string> {
  if (!correo) return '';
  const f = await ctx.una<{ opcion: string }>('SELECT trim(opcion) AS opcion FROM portal_votos WHERE publicacion = ? AND correo = ?', id, correo);
  return f ? f.opcion : '';
}

/**
 * Recuento de una encuesta: [{opcion: votos}], total, y qué votó quien pregunta. Nunca viaja quién
 * votó qué. Sin caché: D1 contesta en milisegundos y la gráfica sale siempre al día.
 */
export async function pubResultados(ctx: Ctx, id: string, email?: string) {
  try {
    const clave = String(id || '').trim();
    if (!clave) return { status: 'error', error: 'Falta el identificador de la publicación.' };
    let correo = '';
    try {
      const quien = await pubQuienVota(ctx, email);
      if (quien.ok) correo = quien.correo;
    } catch { /* sin identidad: sin voto propio */ }
    const [recuento, miVoto] = await Promise.all([pubContar(ctx, clave), pubVotoDe(ctx, clave, correo)]);
    return { status: 'ok', total: recuento.total, conteo: recuento.conteo, miVoto };
  } catch (error) {
    return { status: 'error', error: textoError(error) };
  }
}

/**
 * ¿Se acabó la votación? Por la fecha de cierre (inclusiva de todo su día, en hora de México) o
 * porque la publicación ya expiró (pubEncuestaCerrada_).
 */
function pubEncuestaCerrada(encuesta: any, pub: any): boolean {
  if (pub && pub.estado === 'expirado') return true;
  const cierre = String((encuesta && encuesta.cierre) || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cierre)) return false;
  const m = cierre.split('-');
  const fin = fechaDesdeMx(Number(m[0]), Number(m[1]), Number(m[2]), 23, 59, 59);
  return new Date() > fin;
}

/**
 * Emite o cambia un voto. payload: {id, opcion, asesor}. Un voto por persona y publicación
 * (cambiable hasta el cierre) y 40 votos por persona y hora.
 */
export async function pubVotar(ctx: Ctx, payload: any) {
  try {
    const id = String((payload && payload.id) || '').trim();
    const opcion = String((payload && payload.opcion) || '').trim();
    if (!id || !opcion) return { status: 'error', error: 'Falta la publicación o la opción.' };

    const quien = await pubQuienVota(ctx, payload && payload.asesor);
    if (!quien.ok) return { status: 'error', error: quien.error };

    const limite = 'voto_' + quien.correo;
    if ((await secIntentosRevisar(ctx, limite, 40)).bloqueado) {
      return { status: 'error', error: 'Has votado muchas veces en la última hora. Inténtalo más tarde.' };
    }

    // La encuesta manda: la opción tiene que ser una de las publicadas y la votación seguir abierta.
    const ficha: any = await pubPorId(ctx, id, payload && payload.asesor);
    if (ficha.status !== 'ok') return { status: 'error', error: ficha.error || 'No encontramos esa publicación.' };
    const enc = ficha.pub && ficha.pub.encuesta;
    if (!enc || !Array.isArray(enc.opciones)) return { status: 'error', error: 'Esa publicación no es una encuesta.' };
    if (enc.opciones.indexOf(opcion) < 0) return { status: 'error', error: 'Esa opción ya no está en la encuesta.' };
    if (pubEncuestaCerrada(enc, ficha.pub)) return { status: 'error', error: 'La encuesta ya está cerrada.' };

    // Un voto por persona: la clave primaria (publicación, correo) hace del segundo una corrección.
    await ctx.ejecutar(
      'INSERT INTO portal_votos (publicacion, correo, opcion, fecha) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(publicacion, correo) DO UPDATE SET opcion = excluded.opcion, fecha = excluded.fecha',
      id, quien.correo, opcion, ctx.ahoraIso());

    await secIntentosSumar(ctx, limite, 3600);

    // El recuento recién hecho: quien vota ve su voto contado en el acto.
    const recuento = await pubContar(ctx, id);
    return { status: 'ok', total: recuento.total, conteo: recuento.conteo, miVoto: opcion };
  } catch (error) {
    return { status: 'error', error: textoError(error) };
  }
}
