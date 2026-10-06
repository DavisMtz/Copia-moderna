/**
 * PORTAL | Portal Ventel en Cloudflare
 * ====================================
 * Port de Portal.gs, PortalContenido.gs, Publicaciones.gs, PortalPromosComercial.gs, VentaCruzada.gs
 * y Trazabilidad.gs. El código vive partido en modulos/portal/*:
 *
 *   lectura.ts       fetchToolsData, reportBrokenLink, pvArchivos (lectura pública del Portal)
 *   promos.ts        fetchApplicationData, fetchPromoCounts, pdpDatos, ventaCruzadaPromos
 *                    (+ el analizador de vigencias parseVigencia, en hora de México)
 *   anuncios.ts      autoría de anuncios, interruptor del reconocimiento y publicaciones/encuestas
 *   contenido.ts     pantalla «Contenido del Portal» y la lectura de comercial (degradada)
 *   trazabilidad.ts  fetchTrazabilidadData
 *   recursos.ts      fpLogosTiendas, recoImagenes (archivos del proyecto empaquetados)
 *
 * PromosAuto.gs (la tarea diaria que traía la hoja de comercial al Portal) no se porta: leía un
 * archivo externo de Google Sheets que aquí no existe y ninguna pantalla la llama.
 */
import type { FuncionRpc } from '../rpc';
import { fetchToolsData, reportBrokenLink, pvArchivos } from './portal/lectura';
import { fetchApplicationData, fetchPromoCounts, pdpDatos, ventaCruzadaPromos } from './portal/promos';
import {
  getAnunciosAdmin, publicarAnuncio, eliminarAnuncio, toggleAnuncio, moverAnuncio, subirImagenAnuncio,
  recoEstado, recoCambiarVisible, pubPorId, pubResultados, pubVotar
} from './portal/anuncios';
import {
  portalContenidoCatalogo, portalContenidoListar, portalContenidoGuardar, portalContenidoEliminar,
  portalContenidoDuplicar, portalContenidoMover, portalContenidoAnalizarImport, portalContenidoAplicarImport,
  portalPromosHojas, portalPromosLeer
} from './portal/contenido';
import { fetchTrazabilidadData } from './portal/trazabilidad';
import { fpLogosTiendas, recoImagenes } from './portal/recursos';

export {
  fetchToolsData, reportBrokenLink, pvArchivos,
  fetchApplicationData, fetchPromoCounts, pdpDatos, ventaCruzadaPromos,
  getAnunciosAdmin, publicarAnuncio, eliminarAnuncio, toggleAnuncio, moverAnuncio, subirImagenAnuncio,
  recoEstado, recoCambiarVisible, pubPorId, pubResultados, pubVotar,
  portalContenidoCatalogo, portalContenidoListar, portalContenidoGuardar, portalContenidoEliminar,
  portalContenidoDuplicar, portalContenidoMover, portalContenidoAnalizarImport, portalContenidoAplicarImport,
  portalPromosHojas, portalPromosLeer,
  fetchTrazabilidadData, fpLogosTiendas, recoImagenes
};
// Para otros módulos (p. ej. contar promociones o leer vigencias con el mismo criterio del Monitor).
export { parseVigencia, portalVigentes, portalContarPromos } from './portal/promos';
export { leerAnunciosPublicos } from './portal/lectura';

export const funciones: Record<string, FuncionRpc> = {
  // Portal.gs — lectura pública
  fetchToolsData,
  fetchPromoCounts,
  fetchApplicationData,
  reportBrokenLink,
  fpLogosTiendas,
  recoImagenes,
  pdpDatos,
  pvArchivos,
  // Portal.gs — autoría de anuncios y reconocimiento (bloque 'anuncios')
  getAnunciosAdmin,
  publicarAnuncio,
  eliminarAnuncio,
  toggleAnuncio,
  moverAnuncio,
  subirImagenAnuncio,
  recoEstado,
  recoCambiarVisible,
  // Publicaciones.gs
  pubPorId,
  pubResultados,
  pubVotar,
  // PortalContenido.gs (bloque 'portal_contenido')
  portalContenidoCatalogo,
  portalContenidoListar,
  portalContenidoGuardar,
  portalContenidoEliminar,
  portalContenidoDuplicar,
  portalContenidoMover,
  portalContenidoAnalizarImport,
  portalContenidoAplicarImport,
  // PortalPromosComercial.gs
  portalPromosHojas,
  portalPromosLeer,
  // VentaCruzada.gs
  ventaCruzadaPromos,
  // Trazabilidad.gs
  fetchTrazabilidadData
};
