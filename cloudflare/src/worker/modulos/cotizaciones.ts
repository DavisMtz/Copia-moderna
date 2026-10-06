/**
 * COTIZACIONES | Portal Ventel en Cloudflare
 * ==========================================
 * Port de Code.gs (cotizaciones), Cache.gs, Formatos.gs, Correos.gs y Metricas.gs.
 * PENDIENTE DE PORTAR (lo hace el agente de cotizaciones).
 *
 * Contratos que usan otros módulos (no cambiar la firma sin avisar):
 *   metRegistrarEnvio(ctx, ev)       ← Metricas.gs metRegistrarEnvio_  (lo usan correos, plantillas, difusión)
 *   getFormatSettings(ctx, email)    ← Formatos.gs                     (lo usa la consola)
 */
import type { Ctx } from '../nucleo/contexto';
import type { FuncionRpc } from '../rpc';

/** Una fila en metricas_correos. Nunca lanza. ev = {tipo, referencia, asesorEmail, asesorNombre,
 *  para, destinatarios, cc, cco, asunto, adjuntos, remitente, aliasUsado, resultado, detalle, plantillaModificada} */
export async function metRegistrarEnvio(ctx: Ctx, ev: Record<string, any>): Promise<void> {
  // TODO(agente cotizaciones): portar Metricas.gs.
}

export const funciones: Record<string, FuncionRpc> = {};
