/**
 * PORTAL · recursos que viajan bajo demanda | Portal Ventel en Cloudflare
 * =======================================================================
 * fpLogosTiendas y recoImagenes leían en Apps Script un archivo del proyecto con
 * HtmlService.createHtmlOutputFromFile(…).getContent(). Aquí son los MISMOS archivos de «Carpeta del
 * proyecto», empaquetados en el Worker como texto al construir (wrangler importa .html como texto):
 * una sola fuente para las dos versiones, y ninguna lectura en tiempo de petición.
 */
import fpLogos from '../../../../../Carpeta del proyecto/fp_logos.html';
import recoImagenesHtml from '../../../../../Carpeta del proyecto/reco_imagenes.html';
import recoSprite from '../../../../../Carpeta del proyecto/app_reconocimiento_sprite.html';
import type { Ctx } from '../../nucleo/contexto';

/**
 * Logos de las tiendas afiliadas de Formas de Pago: { nombre de la tienda: data URI }. Pública a
 * propósito: no recibe argumentos ni devuelve nada de nadie.
 */
export async function fpLogosTiendas(_ctx: Ctx) {
  return JSON.parse(fpLogos);
}

/**
 * Reconocimiento del Reto de Innovación Liverpool 2026: { v, diploma, mensaje, sprite }. En el archivo
 * el base64 va en su variante URL (- y _ en vez de + y /); aquí se devuelve al normal. `sprite` lleva
 * los dibujos grandes que las pantallas sin ellos añaden al abrir el visor. Pública, como en Apps Script.
 */
export async function recoImagenes(_ctx: Ctx) {
  const d = JSON.parse(recoImagenesHtml);
  for (const k of ['diploma', 'mensaje']) {
    d[k] = String(d[k] || '').replace(/-/g, '+').replace(/_/g, '/');
  }
  d.sprite = recoSprite;
  return d;
}
