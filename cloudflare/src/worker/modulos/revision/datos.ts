/**
 * Lecturas de cotizaciones para la revisión | Portal Ventel en Cloudflare
 * ======================================================================
 * Lo que en Apps Script la revisión tomaba de otros archivos:
 *   · leerDetalleCotizacion_, formatCurrencyGS, QUOTE_FORMATS  → los da el módulo de cotizaciones
 *     (cotizaciones/comun.ts, que no importa nada de la revisión: sin ciclo).
 *   · leerSupervision_ → aquí, como consulta propia: la cola solo necesita lo pendiente y siete campos.
 *   · mailAlias_ y correoAplicarCco_ (Correos.gs) → versión LOCAL mínima. Las del módulo de cotizaciones
 *     viven en cotizaciones/correos.ts, que importa revPuedeEnviarse de este módulo: importarlas de
 *     vuelta formaría un ciclo de imports. Hacen lo mismo y el núcleo fuerza el dominio de todos modos.
 * Todo se lee directo de D1, sin caché: la revisión es justo la pantalla donde un dato de hace tres
 * minutos no sirve.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secConfig } from '../../nucleo/seguridad';
import { aIso } from '../../nucleo/fechas';
import { leerDetalleCotizacion } from '../cotizaciones/comun';

export { formatCurrencyGS, QUOTE_FORMATS } from '../cotizaciones/comun';

/**
 * Detalle de una cotización (Code.gs · leerDetalleCotizacion_): cabecera + products, sin caché. Nunca
 * lanza: {success:false, message} si no existe o no se pudo leer. Su `quote.revision` trae el ajuste
 * de «revisión desactivada» de la consulta; la revisión NO lo usa (lee revEstadoDeFolio, como el .gs).
 */
export async function revLeerDetalle(ctx: Ctx, folio: unknown):
  Promise<{ success: true; quote: Record<string, any> } | { success: false; message: string }> {
  return leerDetalleCotizacion(ctx, folio);
}

const num = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };
const txt = (v: unknown) => (v === null || v === undefined) ? '' : String(v);

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
