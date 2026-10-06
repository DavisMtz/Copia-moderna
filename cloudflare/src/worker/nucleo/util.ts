/**
 * Ayudantes pequeños compartidos por todos los módulos.
 */

/** Escapa texto para incrustarlo en HTML (secEscapeHtml_). */
export function escaparHtml(texto: unknown): string {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Minúsculas, sin acentos y con espacios colapsados: para comparar textos que escribe gente. */
export function normalizarTexto(v: unknown): string {
  return String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/** JSON.parse que no lanza. */
export function jsonSeguro<T = any>(texto: unknown, respaldo: T): T {
  if (texto === null || texto === undefined || texto === '') return respaldo;
  if (typeof texto === 'object') return texto as T;
  try { return JSON.parse(String(texto)) as T; } catch { return respaldo; }
}

/** Número o el respaldo (parseFloat tolerante a '$1,234.50'). */
export function aNumero(v: unknown, respaldo = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : respaldo;
  const n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : respaldo;
}

/** Recorta un texto a n caracteres. */
export function recortar(v: unknown, n: number): string {
  const s = String(v == null ? '' : v);
  return s.length > n ? s.slice(0, n) : s;
}

let secuencia = 0;
/** Identificador nuevo con prefijo, como pcNuevoId_ ('htl-msk…'). */
export function nuevoId(prefijo: string): string {
  secuencia = (secuencia + 1) % 1296;
  return prefijo + '-' + Date.now().toString(36) + secuencia.toString(36);
}

/** Interpreta Sí/No de una celda: 'Si', 'sí', 'TRUE', 'x', '1', 'verdadero', true, 1. */
export function esAfirmativo(valor: unknown): boolean {
  if (valor === true || valor === 1) return true;
  const s = normalizarTexto(valor);
  return s === 'si' || s === 'true' || s === 'x' || s === '1' || s === 'verdadero';
}

/** Error con el mensaje tal cual lo verá el asesor (llega al withFailureHandler). */
export function errorVisible(mensaje: string): Error {
  return new Error(mensaje);
}
