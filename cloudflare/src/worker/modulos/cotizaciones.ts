/**
 * COTIZACIONES | Portal Ventel en Cloudflare
 * ==========================================
 * Port de Code.gs (la parte de cotizaciones), Formatos.gs, Correos.gs y Metricas.gs. Es el corazón
 * del sistema: captura → guardado (folio + cabecera + partidas) → decisión de revisión → consulta →
 * envío al cliente (ver Documentacion/01_Arquitectura_General.md §4).
 *
 * Cache.gs NO se porta: D1 contesta en milisegundos y cada lectura va directa (AGENTES.md §2.7).
 * Sus invalidaciones (cotInvalidarCache_) desaparecen y `forzarRecarga` ya no tiene nada que saltar.
 *
 * Archivos de este módulo:
 *   cotizaciones/comun.ts       constantes, importes, fechas y el detalle de un folio
 *   cotizaciones/busqueda.ts    búsqueda tolerante a errores (fuzzy)
 *   cotizaciones/formatos.ts    Formatos.gs
 *   cotizaciones/correos.ts     Correos.gs
 *   cotizaciones/plantillas.ts  el HTML aprobado del correo al cliente, tal cual
 *   cotizaciones/metricas.ts    Metricas.gs
 *
 * Contratos que usan otros módulos (no cambiar la firma sin avisar):
 *   metRegistrarEnvio(ctx, ev)       ← Metricas.gs metRegistrarEnvio_  (correos, plantillas, difusión)
 *   getFormatSettings(ctx, email)    ← Formatos.gs                     (la consola)
 * y además, para quien los necesite: cotDetalleFolio, leerDetalleCotizacion, metVerificarAsesor,
 * mailAlias, correoAplicarCco, correoCcoGlobal, formatCurrencyGS, getVerifiedImageUrl,
 * setQuoteFormatEnabled, getEnabledQuoteFormats, getMailSenderInfo, QUOTE_FORMATS, DEFAULT_FORMAT_ID.
 */
import type { Ctx } from '../nucleo/contexto';
import type { FuncionRpc } from '../rpc';
import { secIdentidad, secIdentidadConBloque, secNormalizarCorreo } from '../nucleo/seguridad';
import { siguienteContador, cacheLeer, cacheGuardar, cacheSumar, cacheBorrar } from '../nucleo/sistema';
import { partesMx, fechaDesdeMx, inicioDelDiaMx } from '../nucleo/fechas';
import { revpolDecidirAlGuardar, revpolSellarAprobacionAutomatica } from './revision';
import { monRegistrarBusqueda } from './consola';
import {
  DEFAULT_FORMAT_ID, REV_ESTATUS_PENDIENTE, REV_ESTATUS_APROBADA,
  celda, numero, entero, isoDe, fechaCortaMx, fechaNumericaMx, formatCurrencyGS, cotDetalleFolio
} from './cotizaciones/comun';
import { fuzzyScore } from './cotizaciones/busqueda';
import {
  getEnabledQuoteFormats, getFormatSettings, setQuoteFormatEnabled,
  openQuoteInSheets, previewSheetCcl, downloadQuotePdf
} from './cotizaciones/formatos';
import { getQuoteDetailsForEmail, sendQuoteByEmail, getMailSenderInfo } from './cotizaciones/correos';
import { getResumenMetricasCorreos } from './cotizaciones/metricas';

export { metRegistrarEnvio, metVerificarAsesor } from './cotizaciones/metricas';
export { getFormatSettings, setQuoteFormatEnabled, getEnabledQuoteFormats } from './cotizaciones/formatos';
export {
  getMailSenderInfo, mailAlias, correoAplicarCco, correoCcoGlobal, getVerifiedImageUrl, MAIL_ALIAS_RESPALDO
} from './cotizaciones/correos';
export {
  cotDetalleFolio, leerDetalleCotizacion, revEstadoDeFolio, formatCurrencyGS, QUOTE_FORMATS, DEFAULT_FORMAT_ID,
  REV_ESTATUS_PENDIENTE, REV_ESTATUS_APROBADA, REV_ESTATUS_RECHAZADA, REV_ESTATUS_ENVIADA
} from './cotizaciones/comun';

// =================================================================================================
// FOLIO
// =================================================================================================

/**
 * Folio único con el formato LVP-AAMMDD-XXXX, con la fecha de HOY en hora de México. El
 * consecutivo se reinicia cada día y sale de un contador atómico (lo que en Apps Script hacía
 * LockService): dos asesores guardando a la vez nunca reciben el mismo número.
 */
export async function generateLvpFolio(ctx: Ctx): Promise<string> {
  const p = partesMx(ctx.ahora());
  const aammdd = String(p.anio).slice(-2) + String(p.mes).padStart(2, '0') + String(p.dia).padStart(2, '0');
  const prefijo = `LVP-${aammdd}-`;
  const clave = 'folio:' + aammdd;

  let n = await siguienteContador(ctx, clave);
  // La regla del .gs era «el mayor folio de hoy + 1». Si la tabla ya trae folios de hoy que el
  // contador no conoce (semilla, importación de la hoja), se sube el contador por encima de ellos
  // —nunca hacia abajo— y se vuelve a pedir: así sigue siendo atómico.
  const fila = await ctx.una<{ m: number | null }>(
    'SELECT MAX(CAST(substr(folio, ?) AS INTEGER)) AS m FROM cotizaciones WHERE folio >= ? AND folio < ?',
    prefijo.length + 1, prefijo, prefijo + '~');
  const mayor = Number(fila?.m) || 0;
  if (n <= mayor) {
    await ctx.ejecutar('UPDATE contadores SET valor = MAX(valor, ?) WHERE clave = ?', mayor, clave);
    n = await siguienteContador(ctx, clave);
  }
  return prefijo + String(n).padStart(4, '0');
}

// =================================================================================================
// GUARDADO
// =================================================================================================

/** Avisa al Chat de supervisión que hay una cotización nueva. Webhooks de Chat → no-op. */
export function sendWebhookNotification(ctx: Ctx, folio: string, quoteData: Record<string, any>, estatus: string): void {
  try {
    const q = quoteData || {};
    const enlace = ctx.origen ? ctx.origen + '/?page=revision_cotizacion&folio=' + encodeURIComponent(String(folio || '')) : '';
    const detalles: string[] = [];
    if (q.clientName) detalles.push('Cliente: ' + q.clientName);
    if (q.advisorName) detalles.push('Asesor: ' + q.advisorName);
    if (q.summaryTotal) detalles.push('Total: ' + formatCurrencyGS(q.summaryTotal));
    const aprobadaSola = estatus === REV_ESTATUS_APROBADA;
    const message = aprobadaSola
      ? `*${folio}* · nueva cotización *aprobada automáticamente*` +
        (detalles.length ? `\n${detalles.join(' · ')}` : '') +
        `\nLa política de revisión permitió enviarla sin aprobación manual.` +
        (enlace ? `\n<${enlace}|Ver la cotización>` : `\nÁbrela en el sistema con el folio ${folio}.`)
      : `*${folio}* · nueva cotización *en revisión*` +
        (detalles.length ? `\n${detalles.join(' · ')}` : '') +
        `\nNo se puede enviar al cliente hasta que alguien la apruebe.` +
        (enlace ? `\n<${enlace}|Revisar la cotización>` : `\nÁbrela en el sistema con el folio ${folio}.`);
    // Esta versión no publica en Google Chat: el aviso queda en el registro del Worker.
    console.log('[webhook Chat · no se envía] ' + message);
  } catch (error) {
    console.error(`Error al preparar el aviso de Chat para el folio ${folio}`, error);
  }
}

/** Partidas por sentencia: D1 acepta hasta 100 parámetros por consulta y cada partida lleva 12. */
const PARTIDAS_POR_INSERT = 8;

/**
 * Valor para una columna de texto: `x || ''` del .gs, pero siempre como texto. D1 recibe los números
 * de JavaScript como REAL y en una columna TEXT un teléfono 5512345678 quedaría «5512345678.0».
 */
function texto(v: unknown): string {
  return v ? String(v) : '';
}

/**
 * Guarda o actualiza una cotización: cabecera en `cotizaciones` y partidas en
 * `detalle_cotizaciones`, TODO en una transacción (ctx.lote).
 *
 *  · Solo se escriben las columnas que escribía el .gs; fecha_envio, link_sheet_ccl y link_pdf
 *    (salvo que llegue uno) se conservan al actualizar.
 *  · REVISIÓN: guardar devuelve SIEMPRE la cotización al punto de partida del ciclo: se vacían
 *    las columnas de revisión. Es lo que impide aprobar un folio, cambiarle los precios y enviarlo
 *    con el sello puesto. El estatus que llega ya es «En Revisión» (o «Aprobada» si la política la
 *    deja pasar, y entonces el sello se escribe DESPUÉS).
 *  · Las partidas de ese folio se borran y se reescriben (con su `orden`), igual que la hoja.
 */
export async function saveQuoteDataToSheets(ctx: Ctx, quoteData: Record<string, any>, status: string, pdfLink: string | null = null): Promise<void> {
  const folio = String(quoteData.folio);
  const existente = await ctx.una('SELECT folio FROM cotizaciones WHERE folio = ?', folio);

  const columnas: Array<[string, unknown]> = [
    ['folio', folio],
    ['timestamp', isoDe(quoteData.timestamp) || ctx.ahoraIso()],
    // El asesor que se guarda es el de la sesión del PORTAL.
    ['asesor_correo', texto(quoteData.advisorEmail)],
    ['asesor_nombre', texto(quoteData.advisorName)],
    ['extencion', texto(quoteData.advisorExt)],
    ['cliente_nombre', texto(quoteData.clientName)],
    ['correo_cliente', texto(quoteData.clientEmail)],
    ['numero', texto(quoteData.clientPhone)],
    ['subtotal', numero(quoteData.summarySubtotal)],
    ['iva', numero(quoteData.summaryVat)],
    ['total_general', numero(quoteData.summaryTotal)],
    ['estatus', status],
    ['observaciones', texto(quoteData.observations)],
    ['formato', texto(quoteData.format) || DEFAULT_FORMAT_ID],
    ['revision_estado', ''],
    ['revisado_por', ''],
    ['revisado_nombre', ''],
    ['revision_fecha', ''],
    ['revision_notas', ''],
    ['revision_checklist', '']
  ];
  // El enlace al PDF solo se toca cuando llega uno: guardarlo vacío borraría el que ya hubiera.
  if (pdfLink) columnas.push(['link_pdf', pdfLink]);

  const nombres = columnas.map((c) => c[0]);
  const sentencias: Array<[string, ...unknown[]]> = [[
    `INSERT INTO cotizaciones (${nombres.join(', ')}) VALUES (${nombres.map(() => '?').join(', ')}) ` +
    'ON CONFLICT(folio) DO UPDATE SET ' + nombres.filter((n) => n !== 'folio').map((n) => `${n} = excluded.${n}`).join(', '),
    ...columnas.map((c) => c[1])
  ]];

  sentencias.push(['DELETE FROM detalle_cotizaciones WHERE folio_cotizacion = ?', folio]);

  const productos: any[] = Array.isArray(quoteData.products) ? quoteData.products : [];
  for (let i = 0; i < productos.length; i += PARTIDAS_POR_INSERT) {
    const trozo = productos.slice(i, i + PARTIDAS_POR_INSERT);
    const valores: unknown[] = [];
    trozo.forEach((p, k) => {
      valores.push(
        folio,
        i + k,
        texto(p.sku),
        texto(p.description),
        entero(p.quantity),
        numero(p.unitPrice),
        numero(p.costPaymentUnique),
        numero(p.discountPublicPercent),
        texto(p.additionalDiscountApplied) || 'No',
        numero(p.additionalDiscountPercent),
        texto(p.imageUrl),
        // Enlace a la ficha del artículo en liverpool.com.mx (lo aporta la extensión): permite
        // abrir el producto dentro de la pantalla de revisión.
        texto(p.productUrl));
    });
    sentencias.push([
      'INSERT INTO detalle_cotizaciones (folio_cotizacion, orden, sku, descripcion_producto, cantidad, ' +
      'precio_unitario_base, costo_pago_unico_linea, desc_publico_porcentaje, aplica_desc_adicional, ' +
      'porcentaje_desc_adicional, imagen_url, link_articulo) VALUES ' +
      trozo.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', '),
      ...valores
    ]);
  }

  await ctx.lote(sentencias);
  console.log(`Cotización ${existente ? 'actualizada' : 'guardada'}: ${folio} (${productos.length} productos).`);

  // Solo una cotización NUEVA se anuncia; el estatus va en el aviso (aprobada sola o en revisión).
  if (!existente) sendWebhookNotification(ctx, folio, quoteData, status);
}

/*
 * RECIBO DEL GUARDADO · que «Ir a Vista Previa» nunca dé dos folios para la misma cotización.
 * La vista previa guarda al llegar y manda una FICHA (32 hex, la misma para la misma cotización):
 * aquí se apunta qué folio salió de ella, 6 h. Si la ficha vuelve (un F5, un reintento, una
 * respuesta perdida) se contesta lo mismo sin tocar la base: ni folio nuevo, ni partidas repetidas.
 *
 * En Apps Script el recibo vivía en CacheService y se consultaba otra vez dentro del LockService.
 * Aquí vive en la tabla `cache` y el candado es por ficha: un turno atómico (cacheSumar) que
 * solo esperan las llamadas con ESA misma ficha; las demás cotizaciones no esperan a nadie.
 */
const COT_RECIBO_PREFIJO = 'vpRecibo_';
const COT_RECIBO_SEG = 21600;
const COT_TURNO_PREFIJO = 'vpGuardando_';
const COT_TURNO_SEG = 60;
const COT_TURNO_ESPERA_MS = 30000;   // lo que esperaba lock.tryLock(30000)

/** La ficha tal como la manda la pantalla, o '' si no viene o no tiene la forma esperada. */
function cotReciboFicha(valor: unknown): string {
  const ficha = String(valor == null ? '' : valor).trim().toLowerCase();
  return /^[a-f0-9]{32}$/.test(ficha) ? ficha : '';
}

/** La respuesta que ya se dio para esa ficha, o null si no hay recibo (o es de otra persona). */
async function cotReciboLeer(ctx: Ctx, ficha: string, correo: unknown) {
  if (!ficha) return null;
  let crudo: string | null = null;
  try { crudo = await cacheLeer(ctx, COT_RECIBO_PREFIJO + ficha); } catch { return null; }
  if (!crudo) return null;
  let recibo: any = null;
  try { recibo = JSON.parse(crudo); } catch { return null; }
  if (!recibo || !recibo.folio) return null;
  if (recibo.correo && recibo.correo !== secNormalizarCorreo(correo)) return null;
  return {
    success: true,
    folio: recibo.folio,
    format: recibo.format,
    requiereRevision: recibo.requiereRevision,
    motivoRevision: recibo.motivoRevision,
    // La pantalla lo dice distinto: «ya estaba guardada» en vez de «guardada».
    repetida: true,
    message: 'Datos de cotización ' + recibo.folio + ' preparados.'
  };
}

/** Apunta qué salió de esa ficha. Nunca lanza: sin recibo solo se pierde la protección. */
async function cotReciboApuntar(ctx: Ctx, ficha: string, correo: unknown, datos: Record<string, any>): Promise<void> {
  if (!ficha) return;
  try {
    await cacheGuardar(ctx, COT_RECIBO_PREFIJO + ficha, JSON.stringify({
      correo: secNormalizarCorreo(correo),
      folio: datos.folio,
      format: datos.format,
      requiereRevision: datos.requiereRevision,
      motivoRevision: datos.motivoRevision
    }), COT_RECIBO_SEG);
  } catch (e) {
    console.error('cotReciboApuntar: no se pudo apuntar el recibo de ' + datos.folio, e);
  }
}

/**
 * El turno de guardado de una ficha. Devuelve {recibo} si otra llamada con la misma ficha guardó
 * mientras se esperaba, o {turno: true} cuando le toca a esta. Sin ficha no hay turno que esperar.
 */
async function cotReciboTurno(ctx: Ctx, ficha: string, correo: unknown): Promise<{ recibo?: any; turno: boolean }> {
  if (!ficha) return { turno: false };
  const hasta = Date.now() + COT_TURNO_ESPERA_MS;
  for (;;) {
    if ((await cacheSumar(ctx, COT_TURNO_PREFIJO + ficha, COT_TURNO_SEG)) === 1) return { turno: true };
    if (Date.now() > hasta) {
      throw new Error('El sistema está ocupado guardando otra cotización. Intenta de nuevo en unos segundos.');
    }
    await new Promise((r) => setTimeout(r, 300));
    const recibo = await cotReciboLeer(ctx, ficha, correo);
    if (recibo) return { recibo, turno: false };
  }
}

/**
 * Guarda la cotización y decide si pasa por revisión. Es la puerta de entrada de toda cotización.
 * @param quoteDataFromClient lo que arma collectQuoteData (cotizacion.html); puede traer `ficha`.
 */
export async function saveQuoteAndGoToPreview(ctx: Ctx, quoteDataFromClient: Record<string, any>) {
  let tengoTurno = false;
  let ficha = '';
  try {
    if (!quoteDataFromClient) throw new Error('No se recibieron datos de la cotización.');
    const q = quoteDataFromClient;

    // La ficha viaja dentro de los datos para no cambiar la firma; no sigue hasta la base.
    ficha = cotReciboFicha(q.ficha);
    delete q.ficha;

    // Puerta NUEVA respecto al .gs: allí bastaba estar dentro del dominio de Liverpool; aquí el
    // Worker está en internet, así que guardar exige sesión con el bloque 'cotizar' (el mismo que
    // piden cotizacion.html y cotizado_preview.html). El asesor que se sella es el de la sesión.
    const id = await secIdentidadConBloque(ctx, q.advisorEmail, 'cotizar');
    if (!id.ok) {
      return { success: false, message: id.error || 'Inicia sesión para guardar la cotización.', folio: q.folio || null };
    }
    if (!q.advisorEmail) q.advisorEmail = id.email;

    // ¿Esta misma cotización ya se guardó? (Un F5 en la vista previa, un reintento.)
    const yaGuardada = await cotReciboLeer(ctx, ficha, q.advisorEmail);
    if (yaGuardada) {
      console.log('saveQuoteAndGoToPreview: esa ficha ya dio el folio ' + yaGuardada.folio + '; no se vuelve a guardar.');
      return yaGuardada;
    }

    if (!q.advisorName && q.advisorEmail) {
      const reg = await ctx.una<{ nombre: string }>('SELECT nombre FROM registros WHERE email = ?', String(q.advisorEmail));
      if (reg) q.advisorName = reg.nombre;
    }

    // El formato se valida contra los habilitados: vacío o deshabilitado → el predeterminado.
    const enabledFormats = await getEnabledQuoteFormats(ctx);
    const validFormatIds = (enabledFormats.formats || []).map((f) => f.id);
    if (!q.format || validFormatIds.indexOf(q.format) === -1) {
      q.format = (enabledFormats as any).defaultId || DEFAULT_FORMAT_ID;
    }

    // Turno de la ficha (lo que era el candado): si otra llamada con ella guardó mientras tanto,
    // su recibo es la respuesta.
    const turno = await cotReciboTurno(ctx, ficha, q.advisorEmail);
    if (turno.recibo) return turno.recibo;
    tengoTurno = turno.turno;
    const guardadaMientras = await cotReciboLeer(ctx, ficha, q.advisorEmail);
    if (guardadaMientras) return guardadaMientras;

    if (!q.folio) {
      q.folio = await generateLvpFolio(ctx);
      console.log('Nuevo folio generado para vista previa: ' + q.folio);
    }
    q.timestamp = ctx.ahoraIso();

    // ¿Tiene que pasar por la cola de revisión? Lo decide la política de supervisión. Ante
    // cualquier fallo se revisa: un error nunca puede degradar a «sale sin que nadie lo mire».
    let decision: { revisar: boolean; motivo: string; origen: string; reglaId: string };
    try {
      const d: any = await revpolDecidirAlGuardar(ctx, q);
      decision = {
        revisar: !(d && d.revisar === false),
        motivo: String((d && d.motivo) || ''),
        origen: String((d && d.origen) || ''),
        reglaId: String((d && d.reglaId) || '')
      };
    } catch (e) {
      console.error('revpolDecidirAlGuardar falló; la cotización pasa a revisión.', e);
      decision = { revisar: true, motivo: 'No se pudo evaluar la política; se mandó a revisión por seguridad.', origen: 'error', reglaId: '' };
    }

    const estatusInicial = decision.revisar ? REV_ESTATUS_PENDIENTE : REV_ESTATUS_APROBADA;
    await saveQuoteDataToSheets(ctx, q, estatusInicial);

    // El sello va DESPUÉS de guardar: guardar limpia las columnas de revisión.
    if (!decision.revisar) {
      try {
        await revpolSellarAprobacionAutomatica(ctx, q.folio, decision);
      } catch (e) {
        // Queda «Aprobada» sin rastro: se registra fuerte para poder encontrarlo después.
        console.error('revpolSellarAprobacionAutomatica FALLÓ para ' + q.folio, e);
      }
    }

    await cotReciboApuntar(ctx, ficha, q.advisorEmail, {
      folio: q.folio, format: q.format, requiereRevision: decision.revisar, motivoRevision: decision.motivo
    });

    return {
      success: true,
      folio: q.folio,
      format: q.format,
      // La pantalla necesita saberlo para no prometer una revisión que no va a ocurrir.
      requiereRevision: decision.revisar,
      motivoRevision: decision.motivo,
      message: `Datos de cotización ${q.folio} preparados.`
    };
  } catch (error) {
    console.error('Error en saveQuoteAndGoToPreview', error);
    return {
      success: false,
      message: 'No pudimos guardar la cotización. Inténtalo de nuevo en un momento.',
      folio: quoteDataFromClient ? quoteDataFromClient.folio : null
    };
  } finally {
    if (tengoTurno) {
      try { await cacheBorrar(ctx, COT_TURNO_PREFIJO + ficha); } catch { /* caduca solo en 60 s */ }
    }
  }
}

// =================================================================================================
// LISTA DEL ASESOR Y BÚSQUEDA
// =================================================================================================

/**
 * Las cotizaciones del asesor o, con término, una búsqueda en TODO el sistema.
 * @param forzarRecarga el botón «Actualizar»: sin caché en D1 ya no hay nada que saltar.
 */
export async function getQuotesForUser(ctx: Ctx, callingUserEmail: string, searchTerm?: string | null, forzarRecarga?: boolean) {
  const termino = String(searchTerm || '').trim();
  const correo = String(callingUserEmail || '').trim().toLowerCase();

  // V-03 (doc 14): exige sesión con el bloque 'consultar' (asesor y avanzado lo tienen).
  const idConsulta = await secIdentidadConBloque(ctx, correo, 'consultar');
  if (!idConsulta.ok) {
    return { success: false, quotes: null, message: idConsulta.error || 'Inicia sesión para ver las cotizaciones.' };
  }

  // T9.4: se apunta QUÉ se buscó, en cada búsqueda real (único punto de registro: buscarCotizaciones
  // delega aquí). Va por detrás de la respuesta: el registro nunca frena a quien busca.
  if (termino) {
    ctx.despues(Promise.resolve().then(() => monRegistrarBusqueda(ctx, termino, callingUserEmail, 'cotizaciones')));
  }
  return leerCotizacionesDeUsuario(ctx, callingUserEmail, searchTerm);
}

const COLS_LISTA = 'folio, cliente_nombre, correo_cliente, asesor_nombre, asesor_correo, timestamp, total_general, estatus, formato';

/** Lectura real para getQuotesForUser. */
async function leerCotizacionesDeUsuario(ctx: Ctx, callingUserEmail: string, searchTerm?: string | null) {
  try {
    const term = String(searchTerm == null ? '' : searchTerm).trim();
    // Cuando hay término se busca en TODO el sistema: un asesor puede localizar el folio de otro.
    const isSearch = !!(searchTerm && term !== '');
    const correo = String(callingUserEmail || '').trim().toLowerCase();

    let filas: Record<string, any>[];
    let hayCotizaciones: boolean;
    if (isSearch) {
      filas = await ctx.todas(`SELECT ${COLS_LISTA} FROM cotizaciones ORDER BY rowid`);
      hayCotizaciones = filas.length > 0;
    } else {
      const [propias, alguna] = await Promise.all([
        correo ? ctx.todas(`SELECT ${COLS_LISTA} FROM cotizaciones WHERE lower(asesor_correo) = ? ORDER BY rowid`, correo) : Promise.resolve([]),
        ctx.una('SELECT 1 AS si FROM cotizaciones LIMIT 1')
      ]);
      filas = propias;
      hayCotizaciones = !!alguna;
    }
    if (!hayCotizaciones) return { success: true, quotes: [], message: 'No hay cotizaciones registradas.' };

    let resultantes: Record<string, any>[];
    if (isSearch) {
      // El asesor también entra al pajar: «¿esto lo hizo Ana?» es tan común como «¿dónde quedó
      // este folio?». Tolerante a acentos y dedazos (fuzzyScore).
      const scored: Array<{ row: Record<string, any>; score: number }> = [];
      filas.forEach((row) => {
        const haystack = [row.folio, row.cliente_nombre, row.correo_cliente, row.asesor_nombre, row.asesor_correo]
          .map(celda).join(' ');
        const score = fuzzyScore(haystack, term);
        if (score >= 0) scored.push({ row, score });
      });
      // Mayor relevancia primero; a igualdad, folio más reciente.
      scored.sort((a, b) => (b.score - a.score) || String(b.row.folio || '').localeCompare(String(a.row.folio || '')));
      resultantes = scored.map((s) => s.row);
    } else if (correo) {
      resultantes = filas;
    } else {
      return { success: true, quotes: [], message: 'Inicia sesión para ver tus cotizaciones o realiza una búsqueda.' };
    }

    /* De quién es cada folio va como CORREO del asesor y no como un «es tuya» ya resuelto: quién
       es el dueño lo decide la pantalla comparando con su propia sesión. */
    const formattedQuotes = resultantes.map((row) => {
      const correoAsesor = celda(row.asesor_correo).trim();
      return {
        folio: row.folio,
        cliente: celda(row.cliente_nombre),
        // El correo del cliente viaja para que el filtro instantáneo del navegador busque por él.
        correoCliente: celda(row.correo_cliente),
        asesor: celda(row.asesor_nombre) || correoAsesor,
        asesorCorreo: correoAsesor,
        fecha: row.timestamp ? fechaCortaMx(row.timestamp) : 'N/A',
        total: numero(row.total_general),
        estatus: row.estatus || 'Pendiente',
        formato: row.formato ? row.formato : DEFAULT_FORMAT_ID
      };
    });

    // En búsqueda se conserva el orden por relevancia; la lista propia, por folio más reciente.
    if (!isSearch) {
      formattedQuotes.sort((a, b) => String(b.folio || '').localeCompare(String(a.folio || '')));
    }
    return { success: true, quotes: formattedQuotes, message: null };
  } catch (error) {
    console.error('Error en getQuotesForUser', error);
    return { success: false, quotes: null, message: 'No pudimos cargar las cotizaciones. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * Búsqueda para el BUSCADOR GENERAL (app_comando): getQuotesForUser recortada a lo que cabe en
 * una lista desplegable (tope 25, por omisión 8) y solo con los campos que se leen ahí.
 */
export async function buscarCotizaciones(ctx: Ctx, callingUserEmail: string, termino: string, limite?: number) {
  const term = String(termino || '').trim();
  const tope = Math.min(Math.max(parseInt(String(limite), 10) || 8, 1), 25);
  // Con una o dos letras no hay búsqueda que valga.
  if (term.length < 3) return { success: true, quotes: [], message: null };

  const base = await getQuotesForUser(ctx, callingUserEmail, term, false);
  if (!base || !base.success) {
    return { success: false, quotes: [], message: (base && base.message) || 'No pudimos buscar cotizaciones.' };
  }
  const quotes = (base.quotes || []).slice(0, tope).map((q) => ({
    folio: q.folio,
    cliente: q.cliente,
    correoCliente: q.correoCliente,
    asesor: q.asesor,
    asesorCorreo: q.asesorCorreo,
    fecha: q.fecha,
    estatus: q.estatus
  }));
  return { success: true, quotes, message: null };
}

// =================================================================================================
// DETALLE
// =================================================================================================

/**
 * Todos los detalles de una cotización (cabecera y productos). CON CANDADO DE SESIÓN (T1.4): las
 * lecturas internas del servidor usan cotDetalleFolio, que no pasa por aquí.
 */
export async function getQuoteDetails(ctx: Ctx, folio: string, emailCliente?: string) {
  const id = await secIdentidad(ctx, emailCliente);
  if (!id.ok) {
    return { success: false, sinSesion: true, message: id.error || 'Inicia sesión para consultar esta cotización.' };
  }
  return cotDetalleFolio(ctx, folio);
}

// =================================================================================================
// PANEL AVANZADO: ESTADÍSTICAS Y SUPERVISIÓN
// =================================================================================================

/**
 * Las estadísticas del panel avanzado (KPIs, reparto por asesor, actividad de hoy y de 7 días).
 * Puerta NUEVA respecto al .gs (V-10 del doc 14: «expone métricas por persona»): el bloque de
 * supervisión, que es el mismo con el que inicio_avanzado decide pedirlas (PUEDE.metricas).
 */
export async function getDashboardStats(ctx: Ctx) {
  const id = await secIdentidadConBloque(ctx, '', 'supervision');
  if (!id.ok) return { success: false, message: id.error || 'No tienes permisos para ver el panel de supervisión.' };
  return calcularDashboardStats(ctx);
}

/** Cálculo real de las estadísticas, con los cortes de fecha en hora de México. */
async function calcularDashboardStats(ctx: Ctx) {
  try {
    const p = partesMx(ctx.ahora());
    const firstDayCurrentMonth = fechaDesdeMx(p.anio, p.mes, 1).toISOString();
    const firstDayNextMonth = fechaDesdeMx(p.anio, p.mes + 1, 1).toISOString();
    const firstDayPreviousMonth = fechaDesdeMx(p.anio, p.mes - 1, 1).toISOString();
    const todayStart = fechaDesdeMx(p.anio, p.mes, p.dia).toISOString();
    const sevenDaysAgo = inicioDelDiaMx(ctx.ahora(), -7).toISOString();

    const [cuentas, porAsesor, actividad, ultimas] = await Promise.all([
      ctx.una<{ actual: number; anterior: number }>(
        'SELECT COALESCE(SUM(CASE WHEN timestamp >= ? AND timestamp < ? THEN 1 ELSE 0 END), 0) AS actual, ' +
        'COALESCE(SUM(CASE WHEN timestamp >= ? AND timestamp < ? THEN 1 ELSE 0 END), 0) AS anterior FROM cotizaciones',
        firstDayCurrentMonth, firstDayNextMonth, firstDayPreviousMonth, firstDayCurrentMonth),
      // A igualdad de cotizaciones, en el orden en que cada asesor aparece en la tabla.
      ctx.todas<{ name: string; count: number }>(
        "SELECT COALESCE(NULLIF(asesor_nombre, ''), 'No asignado') AS name, COUNT(*) AS count, MIN(rowid) AS primero " +
        'FROM cotizaciones WHERE timestamp >= ? AND timestamp < ? GROUP BY 1 ORDER BY count DESC, primero ASC',
        firstDayCurrentMonth, firstDayNextMonth),
      ctx.todas('SELECT folio, asesor_nombre, cliente_nombre, timestamp FROM cotizaciones ' +
        'WHERE timestamp >= ? ORDER BY timestamp DESC, rowid ASC', sevenDaysAgo),
      ctx.todas('SELECT folio, cliente_nombre, timestamp, total_general, estatus, formato FROM cotizaciones ' +
        'ORDER BY timestamp DESC, rowid ASC LIMIT 5')
    ]);

    // Objetos nuevos, sin la fecha: es lo que viaja al navegador.
    const actividadDe = (q: Record<string, any>) => ({
      advisorName: q.asesor_nombre || 'No asignado',
      clientName: q.cliente_nombre || 'N/A',
      folio: q.folio || 'N/A'
    });
    const last7Days = actividad.map(actividadDe);
    const today = actividad.filter((q) => String(q.timestamp) >= todayStart).map(actividadDe);

    const lastQuotes = ultimas.map((row) => ({
      folio: row.folio,
      cliente: celda(row.cliente_nombre),
      fecha: fechaNumericaMx(row.timestamp),
      total: numero(row.total_general),
      estatus: celda(row.estatus),
      formato: row.formato || DEFAULT_FORMAT_ID
    }));

    return {
      success: true,
      stats: {
        currentMonthCount: Number(cuentas?.actual) || 0,
        previousMonthCount: Number(cuentas?.anterior) || 0,
        quotesPerUser: porAsesor.map((u) => ({ name: u.name, count: Number(u.count) || 0 })),
        last7Days,
        today,
        lastQuotes
      }
    };
  } catch (error) {
    console.error('Error en getDashboardStats', error);
    return { success: false, message: 'No pudimos calcular el resumen. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * TODAS las cotizaciones con lo que necesita el panel de supervisión (búsqueda, filtros, rango de
 * fechas y reporte se hacen en el cliente). El permiso se resuelve contra la identidad REAL.
 */
export async function getSupervisionQuotes(ctx: Ctx, email: string) {
  try {
    const id = await secIdentidadConBloque(ctx, email, 'supervision');
    if (!id.ok) {
      return { success: false, message: id.error || 'No tienes permisos para ver el panel de supervisión.' };
    }
    return await leerSupervision(ctx);
  } catch (error) {
    console.error('Error en getSupervisionQuotes', error);
    return { success: false, message: 'No pudimos cargar las cotizaciones. Inténtalo de nuevo en un momento.' };
  }
}

/** Lectura real de todas las cotizaciones para el panel de supervisión. */
async function leerSupervision(ctx: Ctx) {
  try {
    const filas = await ctx.todas('SELECT folio, timestamp, asesor_nombre, asesor_correo, cliente_nombre, correo_cliente, ' +
      'subtotal, iva, total_general, estatus, revision_estado, revisado_nombre, fecha_envio, formato, observaciones ' +
      'FROM cotizaciones ORDER BY rowid');
    const quotes = filas.map((row) => ({
      folio: celda(row.folio),
      // ISO para que el cliente filtre por rango de fechas sin ambigüedad.
      timestamp: isoDe(row.timestamp),
      advisorName: String(row.asesor_nombre || 'No asignado'),
      advisorEmail: celda(row.asesor_correo),
      clientName: celda(row.cliente_nombre),
      clientEmail: celda(row.correo_cliente),
      subtotal: numero(row.subtotal),
      vat: numero(row.iva),
      total: numero(row.total_general),
      status: String(row.estatus || 'Pendiente'),
      // El resultado DURADERO de la revisión: «Estatus» se pisa con «Enviada por Correo».
      revisionEstado: celda(row.revision_estado),
      revisionPor: celda(row.revisado_nombre),
      // T1.6b: la fecha REAL del envío (el Timestamp se pisa con cada guardado).
      fechaEnvio: isoDe(row.fecha_envio),
      format: row.formato ? String(row.formato) : DEFAULT_FORMAT_ID,
      observations: celda(row.observaciones)
    })).filter((q) => q.folio);

    quotes.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    return { success: true, quotes };
  } catch (error) {
    console.error('Error en getSupervisionQuotes', error);
    return { success: false, message: 'No pudimos cargar las cotizaciones. Inténtalo de nuevo en un momento.' };
  }
}

// =================================================================================================
// REGISTRO DE FUNCIONES EXPUESTAS AL NAVEGADOR
// =================================================================================================
// Las internas (generateLvpFolio, saveQuoteDataToSheets, sendWebhookNotification, formatCurrencyGS,
// getVerifiedImageUrl… las de SES_NO_EXPUESTAS en Sesiones.gs) no se registran.

export const funciones: Record<string, FuncionRpc> = {
  // Code.gs
  saveQuoteAndGoToPreview,
  getQuotesForUser,
  buscarCotizaciones,
  getQuoteDetails,
  getDashboardStats,
  getSupervisionQuotes,
  // Correos.gs
  getQuoteDetailsForEmail,
  sendQuoteByEmail,
  getMailSenderInfo,
  // Formatos.gs
  getEnabledQuoteFormats,
  getFormatSettings,
  setQuoteFormatEnabled,
  downloadQuotePdf,
  openQuoteInSheets,
  previewSheetCcl,
  // Metricas.gs
  getResumenMetricasCorreos
};
