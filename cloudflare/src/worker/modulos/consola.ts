/**
 * CONSOLA Y ADMINISTRACIÓN | Portal Ventel en Cloudflare
 * ======================================================
 * Port de Consola.gs, Admin.gs, Grupos.gs, Difusion.gs, Monitoreo.gs, CorreoCliente.gs y Articulos.gs.
 *
 * Archivos de este módulo:
 *   consola/comun.ts           puertas por sección, índice de personas, recorte jerárquico, bitácora
 *   consola/panel.ts           Consola.gs (miembros, alta, contraseñas, ajustes, módulos, formatos…)
 *   consola/salud.ts           Admin.gs (revisionMaestra, adaptada a D1)
 *   consola/grupos.ts          Grupos.gs
 *   consola/difusion.ts        Difusion.gs
 *   consola/monitoreo.ts       Monitoreo.gs (y el registro de búsquedas)
 *   consola/correo_cliente.ts  CorreoCliente.gs
 *   consola/articulos.ts       Articulos.gs
 *
 * De otros módulos se usan: la plantilla de correo, el alta y las contraseñas temporales de
 * identidad (Cuentas.gs); las métricas, el alias, la copia oculta global y los formatos de
 * cotizaciones (Metricas.gs, Correos.gs, Formatos.gs); la política de revisión de revisión.
 *
 * Contratos que usan otros módulos (no cambiar la firma sin avisar):
 *   monRegistrarBusqueda(ctx, termino, email, origen, resultados)   (cotizaciones: getQuotesForUser)
 */
import type { FuncionRpc } from '../rpc';
import {
  consolaPanorama, consolaMiembros, consolaAjustes, consolaAltaMiembro, consolaGuardarMiembro, consolaEliminarMiembro,
  consolaResetPassword, consolaGuardarAjuste, consolaGuardarModulo, consolaGuardarFormato, consolaBitacora,
  consolaBitacoraRango, consolaSalud
} from './consola/panel';
import { grpListar, grpGuardar, grpFijarMiembros, grpEliminar } from './consola/grupos';
import { difPreparar, difPrevia, difEnviar } from './consola/difusion';
import { monPanorama, monCotizaciones, monCorreos, monBusquedas, monCambios } from './consola/monitoreo';
import { enviarCorreoPlantilla } from './consola/correo_cliente';
import {
  artListar, artObtener, artGuardar, artPublicar, artEliminar, artLectores, artIndiceBuscador, artSubirImagen
} from './consola/articulos';

/** Apunta una búsqueda en metricas_busquedas (ventana de 45 s por persona y término). Nunca lanza. */
export { monRegistrarBusqueda } from './consola/monitoreo';

export const funciones: Record<string, FuncionRpc> = {
  // Consola.gs
  consolaPanorama,
  consolaMiembros,
  consolaAjustes,
  consolaAltaMiembro,
  consolaGuardarMiembro,
  consolaEliminarMiembro,
  consolaResetPassword,
  consolaGuardarAjuste,
  consolaGuardarModulo,
  consolaGuardarFormato,
  consolaBitacora,
  consolaBitacoraRango,
  consolaSalud,
  // Grupos.gs
  grpListar,
  grpGuardar,
  grpFijarMiembros,
  grpEliminar,
  // Difusion.gs
  difPreparar,
  difPrevia,
  difEnviar,
  // Monitoreo.gs
  monPanorama,
  monCotizaciones,
  monCorreos,
  monBusquedas,
  monCambios,
  // CorreoCliente.gs
  enviarCorreoPlantilla,
  // Articulos.gs
  artListar,
  artObtener,
  artGuardar,
  artPublicar,
  artEliminar,
  artLectores,
  artIndiceBuscador,
  artSubirImagen
};
