/**
 * CONSOLA Y ADMINISTRACIÓN | Portal Ventel en Cloudflare
 * ======================================================
 * Port de Consola.gs, Admin.gs, Grupos.gs, Difusion.gs, Monitoreo.gs, CorreoCliente.gs y Articulos.gs.
 * PENDIENTE DE PORTAR (lo hace el agente de la consola).
 *
 * Contratos que usan otros módulos (no cambiar la firma sin avisar):
 *   monRegistrarBusqueda(ctx, termino, email, origen, resultados)   (cotizaciones: getQuotesForUser)
 */
import type { Ctx } from '../nucleo/contexto';
import type { FuncionRpc } from '../rpc';

/** Apunta una búsqueda en metricas_busquedas (ventana de 45 s por persona y término). Nunca lanza. */
export async function monRegistrarBusqueda(ctx: Ctx, termino: string, email: string, origen: string, resultados?: number): Promise<void> {
  // TODO(agente consola): portar Monitoreo.gs monRegistrarBusqueda_.
}

export const funciones: Record<string, FuncionRpc> = {};
