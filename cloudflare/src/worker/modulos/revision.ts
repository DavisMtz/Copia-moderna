/**
 * REVISIÓN, POLÍTICA Y AUDITORÍA | Portal Ventel en Cloudflare
 * ============================================================
 * Port de Revision.gs, PoliticaRevision.gs y AuditoriaCotizacion.gs.
 * PENDIENTE DE PORTAR (lo hace el agente de revisión).
 *
 * Contratos que usan otros módulos (no cambiar la firma sin avisar):
 *   revPuedeEnviarse(ctx, folio)                 → {ok, message}           (Correos: antes de enviar)
 *   revpolDecidirAlGuardar(ctx, quoteData)       → {revisar, motivo, origen, reglaId}  (Code: al guardar)
 *   revpolSellarAprobacionAutomatica(ctx, folio, decision)                 (Code: aprobada sola)
 *   audAuditar(ctx, quote, productos, opciones)  → {puntos, score, resumen, criticas, automaticos, pendientes}
 */
import type { Ctx } from '../nucleo/contexto';
import type { FuncionRpc } from '../rpc';

export async function revPuedeEnviarse(ctx: Ctx, folio: string): Promise<{ ok: boolean; message: string }> {
  // TODO(agente revisión): portar Revision.gs revPuedeEnviarse_.
  return { ok: true, message: '' };
}

export async function revpolDecidirAlGuardar(ctx: Ctx, quoteData: any): Promise<{ revisar: boolean; motivo: string; origen: string; reglaId: string }> {
  // TODO(agente revisión): portar PoliticaRevision.gs. Ante cualquier fallo: revisar = true.
  return { revisar: false, motivo: '', origen: 'pendiente', reglaId: '' };
}

export async function revpolSellarAprobacionAutomatica(ctx: Ctx, folio: string, decision: { motivo: string; origen: string; reglaId?: string }): Promise<void> {
  // TODO(agente revisión)
}

export async function audAuditar(ctx: Ctx, quote: any, productos: any[], opciones?: any): Promise<any> {
  // TODO(agente revisión): portar AuditoriaCotizacion.gs audAuditar_.
  return { puntos: [], score: 0, resumen: '', criticas: [], automaticos: 0, pendientes: 0 };
}

export const funciones: Record<string, FuncionRpc> = {};
