/**
 * Lecturas de cotizaciones para la revisión | Portal Ventel en Cloudflare
 * ======================================================================
 * Versiones LOCALES y mínimas de lo que en Apps Script la revisión tomaba de otros archivos:
 *   · leerDetalleCotizacion_ y leerSupervision_   (Code.gs)
 *   · QUOTE_FORMATS y DEFAULT_FORMAT_ID           (Formatos.gs)
 *   · formatCurrencyGS, mailAlias_, correoAplicarCco_  (Correos.gs; el envío en sí es nucleo/correo.ts)
 * El módulo de cotizaciones se porta en paralelo y todavía no las exporta (AGENTES.md §3: «haz una
 * versión local mínima»). Leen D1 directo, sin caché: la revisión es justo la pantalla donde un dato
 * de hace tres minutos no sirve, y D1 contesta en milisegundos.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secConfig } from '../../nucleo/seguridad';
import { aIso } from '../../nucleo/fechas';

/** Catálogo de formatos (Formatos.gs · QUOTE_FORMATS), solo lo que usa la política: id y nombre. */
export const QUOTE_FORMATS: Array<{ id: string; name: string }> = [
  { id: 'actual', name: 'Actual' },
  { id: 'ccl_liverpool', name: 'CCL Liverpool' }
];

/** Formato predeterminado (Formatos.gs · DEFAULT_FORMAT_ID). */
export const DEFAULT_FORMAT_ID = 'ccl_liverpool';

/** Moneda MXN como la escribía Apps Script: "$1,234.50" (Correos.gs · formatCurrencyGS). */
export function formatCurrencyGS(amount: unknown): string {
  const n = parseFloat(String(amount));
  if (isNaN(n)) return '$0.00';
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

export interface ProductoCotizacion {
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  costPaymentUnique: number;
  discountPublicPercent: number;
  additionalDiscountApplied: string;
  additionalDiscountPercent: number;
  imageUrl: string;
  productUrl: string;
}

export interface CotizacionDetalle {
  folio: string;
  timestamp: string;
  advisorEmail: string;
  advisorName: string;
  advisorExt: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  summarySubtotal: number;
  summaryVat: number;
  summaryTotal: number;
  status: string;
  observations: string;
  format: string;
  driveLink: string;
  cclSheetLink: string;
  products: ProductoCotizacion[];
}

/** Fila de `cotizaciones` con las columnas que lee la revisión. */
export interface FilaCotizacion {
  folio: string;
  timestamp: string | null;
  asesor_correo: string | null;
  asesor_nombre: string | null;
  extencion: string | null;
  cliente_nombre: string | null;
  correo_cliente: string | null;
  numero: string | null;
  subtotal: number | null;
  iva: number | null;
  total_general: number | null;
  estatus: string | null;
  observaciones: string | null;
  formato: string | null;
  link_pdf: string | null;
  link_sheet_ccl: string | null;
  revision_estado: string | null;
  revisado_por: string | null;
  revisado_nombre: string | null;
  revision_fecha: string | null;
  revision_notas: string | null;
}

const num = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };
const ent = (v: unknown) => { const n = parseInt(String(v), 10); return isNaN(n) ? 0 : n; };
const txt = (v: unknown) => (v === null || v === undefined) ? '' : String(v);

/**
 * Detalle de una cotización con la MISMA forma que leerDetalleCotizacion_ (Code.gs): cabecera +
 * products. Devuelve también la fila cruda, para que quien necesite el estado de revisión no tenga
 * que volver a leerla.
 */
export async function revLeerDetalle(ctx: Ctx, folio: unknown):
  Promise<{ success: true; quote: CotizacionDetalle; fila: FilaCotizacion } | { success: false; message: string }> {
  try {
    const clave = String(folio == null ? '' : folio);
    const fila = await ctx.una<FilaCotizacion>(
      'SELECT folio, timestamp, asesor_correo, asesor_nombre, extencion, cliente_nombre, correo_cliente, numero, ' +
      'subtotal, iva, total_general, estatus, observaciones, formato, link_pdf, link_sheet_ccl, ' +
      'revision_estado, revisado_por, revisado_nombre, revision_fecha, revision_notas ' +
      'FROM cotizaciones WHERE folio = ?', clave);
    if (!fila) return { success: false, message: 'Cotización no encontrada.' };

    const partidas = await ctx.todas<Record<string, any>>(
      'SELECT sku, descripcion_producto, cantidad, precio_unitario_base, costo_pago_unico_linea, ' +
      'desc_publico_porcentaje, aplica_desc_adicional, porcentaje_desc_adicional, imagen_url, link_articulo ' +
      'FROM detalle_cotizaciones WHERE folio_cotizacion = ? ORDER BY orden, id', clave);

    const quote: CotizacionDetalle = {
      folio: txt(fila.folio),
      // ISO como en Apps Script (allí salía de un Date de la hoja).
      timestamp: aIso(fila.timestamp) || txt(fila.timestamp),
      advisorEmail: txt(fila.asesor_correo),
      advisorName: txt(fila.asesor_nombre),
      advisorExt: txt(fila.extencion),
      clientName: txt(fila.cliente_nombre),
      clientEmail: txt(fila.correo_cliente),
      clientPhone: txt(fila.numero),
      summarySubtotal: num(fila.subtotal),
      summaryVat: num(fila.iva),
      summaryTotal: num(fila.total_general),
      status: txt(fila.estatus),
      observations: txt(fila.observaciones),
      format: txt(fila.formato) || DEFAULT_FORMAT_ID,
      driveLink: txt(fila.link_pdf),
      cclSheetLink: txt(fila.link_sheet_ccl),
      products: partidas.map((p) => ({
        sku: txt(p.sku),
        description: txt(p.descripcion_producto),
        quantity: ent(p.cantidad),
        unitPrice: num(p.precio_unitario_base),
        costPaymentUnique: num(p.costo_pago_unico_linea),
        discountPublicPercent: num(p.desc_publico_porcentaje),
        additionalDiscountApplied: txt(p.aplica_desc_adicional) || 'No',
        additionalDiscountPercent: num(p.porcentaje_desc_adicional),
        imageUrl: txt(p.imagen_url),
        // Se devuelve CRUDO; quien lo va a incrustar o a pedir lo valida antes (revUrlArticuloSegura).
        productUrl: txt(p.link_articulo)
      }))
    };
    return { success: true, quote, fila };
  } catch (e: any) {
    console.error('revLeerDetalle ' + folio + ': ' + (e && e.message));
    return { success: false, message: 'No pudimos abrir esta cotización. Inténtalo de nuevo en un momento.' };
  }
}

/** Una cotización de la cola, con los campos de leerSupervision_ que usa la revisión. */
export interface FilaCola {
  folio: string; timestamp: string; advisorName: string; clientName: string; total: number;
  status: string; revisionEstado: string;
}

/**
 * Las cotizaciones que PUEDEN estar esperando revisión, con la forma de leerSupervision_ (Code.gs) y
 * en su orden (la más reciente primero). El filtro SQL solo descarta lo que seguro está cerrado —un
 * "Enviada por Correo" o un RevisionEstado exacto de aprobada/rechazada—; la decisión fina la toma
 * revEsPendiente, que normaliza acentos y mayúsculas igual que en Apps Script.
 */
export async function revFilasCola(ctx: Ctx): Promise<FilaCola[]> {
  const filas = await ctx.todas<Record<string, any>>(
    "SELECT folio, timestamp, asesor_nombre, cliente_nombre, total_general, estatus, revision_estado " +
    "FROM cotizaciones WHERE folio IS NOT NULL AND folio <> '' " +
    "AND COALESCE(estatus, '') <> 'Enviada por Correo' " +
    "AND COALESCE(revision_estado, '') NOT IN ('Aprobada', 'Rechazada')");
  const cola = filas.map((f) => ({
    folio: txt(f.folio),
    timestamp: aIso(f.timestamp),
    advisorName: txt(f.asesor_nombre) || 'No asignado',
    clientName: txt(f.cliente_nombre),
    total: num(f.total_general),
    status: txt(f.estatus) || 'Pendiente',
    revisionEstado: txt(f.revision_estado)
  }));
  cola.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return cola;
}

/** Respaldo de MAIL_ALIAS: ya no es el alias de grupo de Liverpool sino el buzón de logidma.com. */
const MAIL_ALIAS_RESPALDO = 'ventel@logidma.com';

/**
 * Remitente de los avisos (mailAlias_): el ajuste MAIL_ALIAS o, si no hay, ventel@logidma.com. Los
 * correos salen por Brevo desde logidma.com y el núcleo fuerza ese dominio (nucleo/correo.ts), así que
 * el alias se da siempre por disponible (en Apps Script se comprobaba en GmailApp.getAliases()).
 */
export async function revAliasCorreo(ctx: Ctx): Promise<string> {
  return (await secConfig(ctx, 'MAIL_ALIAS', MAIL_ALIAS_RESPALDO)).trim() || MAIL_ALIAS_RESPALDO;
}

/**
 * Copia oculta global (correoAplicarCco_ · T9.6): los buzones del ajuste CORREO_CCO_GLOBAL que no
 * estén ya entre los destinatarios. Lista vacía = apagado.
 */
export async function revCcoGlobal(ctx: Ctx, yaVan: string[]): Promise<string[]> {
  try {
    const crudo = await secConfig(ctx, 'CORREO_CCO_GLOBAL', '');
    if (!crudo) return [];
    const ocupados = (yaVan || []).map((x) => String(x || '').trim().toLowerCase());
    const vistos: Record<string, boolean> = {};
    return String(crudo).split(/[,;\s]+/)
      .map((x) => String(x || '').trim().toLowerCase())
      .filter((x) => {
        if (!x || x.indexOf('@') <= 0 || ocupados.indexOf(x) !== -1 || vistos[x]) return false;
        vistos[x] = true;
        return true;
      });
  } catch (e) {
    console.error('revCcoGlobal', e);
    return [];
  }
}
