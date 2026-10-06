/**
 * Archivos (imágenes de anuncios y artículos, evidencias) | Portal Ventel en Cloudflare
 * ===================================================================================
 * En Apps Script iban a carpetas de Drive. Aquí van a R2 (bucket ventel-portal-assets) y se sirven
 * desde el mismo dominio en /archivos/<clave>, con caché larga porque cada clave es única.
 */
import type { Ctx } from './contexto';
import { deBase64, uuid } from './cripto';

export interface ArchivoGuardado { clave: string; url: string; nombre: string; tipo: string; bytes: number }

const TIPOS_PERMITIDOS = /^(image\/(png|jpe?g|gif|webp|svg\+xml)|application\/pdf)$/;

/**
 * Guarda un archivo que llegó en base64 o como data URL (lo que mandan las pantallas).
 * @param carpeta 'anuncios' | 'articulos' | 'evidencias' | …
 */
export async function guardarArchivo(ctx: Ctx, entrada: {
  datos: string; tipo?: string; nombre?: string; carpeta: string; subidoPor?: string; maxBytes?: number;
}): Promise<ArchivoGuardado> {
  const m = String(entrada.datos || '').match(/^data:([^;,]+)[;,]/);
  const tipo = (entrada.tipo || (m && m[1]) || 'application/octet-stream').toLowerCase();
  if (!TIPOS_PERMITIDOS.test(tipo)) throw new Error('Ese tipo de archivo no se puede subir (' + tipo + ').');
  const bytes = deBase64(entrada.datos);
  const max = entrada.maxBytes || 8 * 1024 * 1024;
  if (bytes.length > max) throw new Error('El archivo pesa más de ' + Math.round(max / 1048576) + ' MB.');
  const nombre = String(entrada.nombre || 'archivo').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]+/g, '').slice(0, 80) || 'archivo';
  const carpeta = String(entrada.carpeta || 'varios').replace(/[^\w-]+/g, '');
  const clave = 'subidas/' + carpeta + '/' + uuid() + '-' + nombre.replace(/\s+/g, '-');
  await ctx.env.ARCHIVOS.put(clave, bytes, {
    httpMetadata: { contentType: tipo, cacheControl: 'public, max-age=31536000, immutable' }
  });
  await ctx.ejecutar(
    'INSERT INTO archivos (clave, nombre, tipo, bytes, carpeta, subido_por, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)',
    clave, nombre, tipo, bytes.length, carpeta, entrada.subidoPor || '', ctx.ahoraIso());
  return { clave, url: ctx.origen + '/archivos/' + clave, nombre, tipo, bytes: bytes.length };
}

/** GET /archivos/<clave>. */
export async function servirArchivo(bucket: R2Bucket, clave: string): Promise<Response> {
  if (!clave || clave.includes('..')) return new Response('No encontrado', { status: 404 });
  const obj = await bucket.get(clave);
  if (!obj) return new Response('No encontrado', { status: 404 });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  if (!h.has('cache-control')) h.set('cache-control', 'public, max-age=31536000, immutable');
  h.set('x-content-type-options', 'nosniff');
  return new Response(obj.body, { headers: h });
}
