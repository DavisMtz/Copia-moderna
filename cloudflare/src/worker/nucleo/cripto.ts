/**
 * Hashes, identificadores y base64 (lo que en Apps Script daba Utilities.*).
 */

/** SHA-256 en hexadecimal (Utilities.computeDigest(SHA_256, …) + bytes a hex). */
export async function sha256Hex(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(String(texto));
  const hash = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Utilities.getUuid(). */
export function uuid(): string {
  return crypto.randomUUID();
}

/** n bytes al azar en hexadecimal. */
export function aleatorioHex(nBytes: number): string {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Entero al azar en [min, max]. */
export function aleatorioEntero(min: number, max: number): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return min + (b[0] % (max - min + 1));
}

/** Bytes desde base64 (acepta también una data URL completa). */
export function deBase64(texto: string): Uint8Array {
  const limpio = String(texto || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const bin = atob(limpio);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** base64 de unos bytes. */
export function aBase64(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const TROZO = 0x8000;
  for (let i = 0; i < b.length; i += TROZO) bin += String.fromCharCode(...b.subarray(i, i + TROZO));
  return btoa(bin);
}

/** base64 de un texto UTF-8 (Utilities.base64Encode(texto, UTF_8)). */
export function textoABase64(texto: string): string {
  return aBase64(new TextEncoder().encode(String(texto)));
}
