/**
 * COTIZACIONES · lo común | Portal Ventel en Cloudflare
 * =====================================================
 * Constantes del ciclo de vida, formato de importes y fechas, y la lectura interna del detalle de
 * un folio (cotDetalleFolio_ de Code.gs), que comparten la consulta, el correo y la revisión.
 *
 * Aquí no hay caché: en Apps Script cotDetalleFolio_ pasaba por Cache.gs porque leía dos hojas
 * enteras; en D1 son dos consultas por clave (ver AGENTES.md §2.7).
 */
import type { Ctx } from '../../nucleo/contexto';
import { leerPropiedadJson } from '../../nucleo/sistema';
import { aFecha, ZONA_MX } from '../../nucleo/fechas';

// ── Estatus del ciclo de vida (Revision.gs) ─────────────────────────────────
// Se guardan en `estatus`. El resultado DURADERO de la revisión vive aparte, en
// `revision_estado`, porque `estatus` se sobrescribe al enviar el correo.
export const REV_ESTATUS_PENDIENTE = 'En Revisión';
export const REV_ESTATUS_APROBADA = 'Aprobada';
export const REV_ESTATUS_RECHAZADA = 'Rechazada';
export const REV_ESTATUS_ENVIADA = 'Enviada por Correo';

/** Propiedad donde PoliticaRevision.gs guarda la política (REVPOL_PROP_KEY). */
const REVPOL_PROP_KEY = 'revision_politica_v1';

// ── Formatos (Formatos.gs) ──────────────────────────────────────────────────

/** Catálogo de formatos disponibles. El orden es el que ve el asesor. */
export const QUOTE_FORMATS = [
  {
    id: 'actual',
    name: 'Actual',
    description: 'El formato que ya usa el sistema. Incluye fotos de los productos y el detalle de descuentos.'
  },
  {
    id: 'ccl_liverpool',
    name: 'CCL Liverpool',
    description: 'Formato oficial del Centro de Contacto Liverpool, generado desde la plantilla de Google Sheets.'
  }
];

// CCL Liverpool es el predeterminado en todo el Portal (decisión del creador, 13/09/2026).
export const DEFAULT_FORMAT_ID = 'ccl_liverpool';

/** Lo que dicen las funciones que en Apps Script producían algo en Google Drive. */
export const MSG_SIN_DRIVE = 'Esta versión de demostración no genera archivos en Google Drive.';
export const MSG_SIN_PDF = 'Esta versión de demostración no genera el PDF en Google Drive. ' +
  'Usa Imprimir (Ctrl+P) → Guardar como PDF: sale la misma vista de la cotización que tienes en pantalla.';

// ── Celdas, importes y fechas ───────────────────────────────────────────────

/** Una celda de texto como la entregaba Sheets: lo vacío es '' (D1 devuelve null). */
export function celda(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** parseFloat(x) || 0, como en todo Code.gs. */
export function numero(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** parseInt(x) || 0. */
export function entero(v: unknown): number {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * formatCurrencyGS (Correos.gs): moneda MXN con 2 decimales ($1,234.50).
 * PRIVADA en Apps Script (secSoloInterno_): aquí simplemente no se registra.
 */
export function formatCurrencyGS(amount: unknown): string {
  const n = parseFloat(String(amount));
  if (isNaN(n)) return '$0.00';
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

// El Worker corre en UTC: toda fecha visible se formatea con la zona del proyecto de Apps Script.
const FMT_CORTA = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: ZONA_MX });
const FMT_LARGA = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'long', year: 'numeric', timeZone: ZONA_MX });
const FMT_NUMERICA = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_MX });

function formatearCon(fmt: Intl.DateTimeFormat, v: unknown): string {
  const d = aFecha(v);
  // new Date('basura').toLocaleDateString(…) en Apps Script daba 'Invalid Date'.
  return d ? fmt.format(d) : 'Invalid Date';
}

/** toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'numeric'}) → '06 oct 2026'. */
export const fechaCortaMx = (v: unknown) => formatearCon(FMT_CORTA, v);
/** toLocaleDateString('es-MX', {day:'2-digit', month:'long', year:'numeric'}) → '06 de octubre de 2026'. */
export const fechaLargaMx = (v: unknown) => formatearCon(FMT_LARGA, v);
/** toLocaleDateString('es-MX') → '6/10/2026'. */
export const fechaNumericaMx = (v: unknown) => formatearCon(FMT_NUMERICA, v);

/** ISO de una fecha guardada, o '' si no es fecha (lo que hacían los .gs con Date → toISOString). */
export function isoDe(v: unknown): string {
  const d = aFecha(v);
  return d ? d.toISOString() : '';
}

// ── Revisión: lo que la cotización necesita saber de PoliticaRevision.gs / Revision.gs ──

/**
 * ¿La política exige revisión? Es revpolLeer_().exigirRevision: solo un `false` explícito la
 * apaga; cualquier fallo deja el modo seguro (revisar).
 * VERSIÓN LOCAL MÍNIMA: revision.ts no expone todavía la lectura de la política; se lee la misma
 * propiedad que usa PoliticaRevision.gs (revision_politica_v1).
 */
export async function revpolExigeRevision(ctx: Ctx): Promise<boolean> {
  try {
    const p = await leerPropiedadJson<any>(ctx, REVPOL_PROP_KEY, null);
    return !(p && typeof p === 'object' && p.exigirRevision === false);
  } catch {
    return true;
  }
}

export interface EstadoRevision {
  existe: boolean; estatus: string; estado: string; por: string; nombre: string;
  fecha: string; notas: string; aprobada: boolean;
}

/** revEstadoDeFolio_ (Revision.gs) a partir de una fila de `cotizaciones` ya leída. */
export function estadoRevisionDeFila(fila: Record<string, any> | null): EstadoRevision {
  if (!fila) {
    return { existe: false, estatus: '', estado: '', por: '', nombre: '', fecha: '', notas: '', aprobada: false };
  }
  const estado = celda(fila.revision_estado);
  const estatus = celda(fila.estatus);
  return {
    existe: true,
    estatus,
    estado,
    por: celda(fila.revisado_por),
    nombre: celda(fila.revisado_nombre),
    fecha: celda(fila.revision_fecha),
    notas: celda(fila.revision_notas),
    // La verdad la manda RevisionEstado. "Estatus" solo cuenta para las cotizaciones
    // anteriores a la revisión, que ya se habían enviado al cliente.
    aprobada: estado
      ? (estado === REV_ESTATUS_APROBADA)
      : (estatus === REV_ESTATUS_APROBADA || estatus === REV_ESTATUS_ENVIADA)
  };
}

/**
 * revEstadoDeFolio_ (Revision.gs): estado de revisión de un folio, directo de la tabla.
 * VERSIÓN LOCAL MÍNIMA (la usa getQuoteDetailsForEmail): lee la cabecera, que es de este módulo.
 */
export async function revEstadoDeFolio(ctx: Ctx, folio: unknown): Promise<EstadoRevision> {
  try {
    const fila = await ctx.una('SELECT estatus, revision_estado, revisado_por, revisado_nombre, revision_fecha, revision_notas ' +
      'FROM cotizaciones WHERE folio = ?', String(folio ?? ''));
    return estadoRevisionDeFila(fila);
  } catch (e) {
    console.error('revEstadoDeFolio falló para ' + folio, e);
    return estadoRevisionDeFila(null);
  }
}

// ── Detalle de un folio (Code.gs: cotDetalleFolio_ / leerDetalleCotizacion_) ─────────────────

/** Lectura interna del detalle, SIN candado: solo para el servidor (correos, revisión, formatos). */
export async function cotDetalleFolio(ctx: Ctx, folio: unknown) {
  return leerDetalleCotizacion(ctx, folio);
}

/** Lectura real del detalle de una cotización (cabecera + partidas). */
export async function leerDetalleCotizacion(ctx: Ctx, folio: unknown): Promise<
  { success: true; quote: Record<string, any> } | { success: false; message: string }> {
  try {
    const clave = String(folio ?? '');
    const [fila, partidas] = await Promise.all([
      ctx.una('SELECT * FROM cotizaciones WHERE folio = ?', clave),
      ctx.todas('SELECT * FROM detalle_cotizaciones WHERE folio_cotizacion = ? ORDER BY orden, id', clave)
    ]);
    if (!fila) return { success: false, message: 'Cotización no encontrada.' };

    const quoteDetails: Record<string, any> = {
      folio: fila.folio,
      timestamp: celda(fila.timestamp),
      advisorEmail: celda(fila.asesor_correo),
      advisorName: celda(fila.asesor_nombre),
      advisorExt: celda(fila.extencion),
      clientName: celda(fila.cliente_nombre),
      clientEmail: celda(fila.correo_cliente),
      clientPhone: celda(fila.numero),
      summarySubtotal: fila.subtotal,
      summaryVat: fila.iva,
      summaryTotal: fila.total_general,
      status: celda(fila.estatus),
      observations: celda(fila.observaciones),
      format: fila.formato || DEFAULT_FORMAT_ID
    };

    // Enlace al PDF guardado (columna LinkPDF) y a la hoja CCL (LinkSheetCCL).
    quoteDetails.driveLink = celda(fila.link_pdf);
    quoteDetails.cclSheetLink = celda(fila.link_sheet_ccl);

    // Estado de la revisión: TODAS las pantallas que muestran una cotización necesitan saber si
    // ya está autorizada.
    const rev = estadoRevisionDeFila(fila);
    quoteDetails.revision = {
      estado: rev.estado,
      por: rev.por,
      nombre: rev.nombre,
      fecha: rev.fecha,
      notas: rev.notas,
      aprobada: rev.aprobada
    } as Record<string, any>;

    // Espejo de revPuedeEnviarse: con la revisión desactivada la pantalla desbloquea el envío
    // igual. Un RECHAZO sigue bloqueando.
    if (!(await revpolExigeRevision(ctx)) && rev.estado !== REV_ESTATUS_RECHAZADA) {
      quoteDetails.revision.aprobada = true;
      quoteDetails.revision.revisionDesactivada = true;
    }

    // Apps Script devolvía la fecha en ISO.
    if (quoteDetails.timestamp) {
      const iso = isoDe(quoteDetails.timestamp);
      if (iso) quoteDetails.timestamp = iso;
    }

    quoteDetails.products = partidas.map((p) => ({
      sku: p.sku || '',
      description: p.descripcion_producto || '',
      quantity: entero(p.cantidad),
      unitPrice: numero(p.precio_unitario_base),
      costPaymentUnique: numero(p.costo_pago_unico_linea),
      discountPublicPercent: numero(p.desc_publico_porcentaje),
      additionalDiscountApplied: p.aplica_desc_adicional || 'No',
      additionalDiscountPercent: numero(p.porcentaje_desc_adicional),
      imageUrl: p.imagen_url || '',
      // Enlace a la ficha del artículo (lo llena la extensión). Se devuelve CRUDO; quien lo
      // incrusta lo valida antes (revUrlArticuloSegura_).
      productUrl: p.link_articulo || ''
    }));

    return { success: true, quote: quoteDetails };
  } catch (error) {
    console.error('Error en getQuoteDetails para folio ' + folio, error);
    return { success: false, message: 'No pudimos abrir esta cotización. Inténtalo de nuevo en un momento.' };
  }
}
