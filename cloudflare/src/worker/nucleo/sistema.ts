/**
 * Propiedades, caché, contadores y bitácora | Portal Ventel en Cloudflare
 * ======================================================================
 * Sustitutos de los servicios de Apps Script que no son hojas:
 *
 *   PropertiesService  → leerPropiedad / fijarPropiedad / borrarPropiedad / propiedadesConPrefijo
 *   CacheService       → cacheLeer / cacheGuardar / cacheBorrar (con caducidad en segundos)
 *   LockService        → siguienteContador (incremento atómico en D1) y ctx.lote (transacción)
 *   BitacoraConsola    → apuntarBitacora
 *
 * Nota sobre la caché: en Apps Script cada lectura de hoja costaba cientos de ms y por eso casi todo
 * se cacheaba. D1 contesta en milisegundos: NO se cachean lecturas de datos (evita la familia entera
 * de errores de «guardé y no se ve»). La caché queda para contadores con caducidad (intentos de
 * login, límites por hora) y marcas temporales.
 */
import type { Ctx } from './contexto';

// ── Propiedades del script ──────────────────────────────────────────────────

export async function leerPropiedad(ctx: Ctx, clave: string): Promise<string | null> {
  const fila = await ctx.una<{ valor: string }>('SELECT valor FROM propiedades WHERE clave = ?', clave);
  return fila ? fila.valor : null;
}

export async function fijarPropiedad(ctx: Ctx, clave: string, valor: unknown): Promise<void> {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  await ctx.ejecutar(
    'INSERT INTO propiedades (clave, valor, actualizado) VALUES (?, ?, ?) ' +
    'ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado = excluded.actualizado',
    clave, texto, ctx.ahoraIso());
}

export async function borrarPropiedad(ctx: Ctx, clave: string): Promise<void> {
  await ctx.ejecutar('DELETE FROM propiedades WHERE clave = ?', clave);
}

/** Todas las propiedades cuyo nombre empieza por `prefijo` (getProperties() filtrado). */
export async function propiedadesConPrefijo(ctx: Ctx, prefijo: string): Promise<Record<string, string>> {
  const filas = await ctx.todas<{ clave: string; valor: string }>(
    "SELECT clave, valor FROM propiedades WHERE substr(clave, 1, ?) = ?", prefijo.length, prefijo);
  const out: Record<string, string> = {};
  for (const f of filas) out[f.clave] = f.valor;
  return out;
}

/** Una propiedad interpretada como JSON (o el respaldo). */
export async function leerPropiedadJson<T>(ctx: Ctx, clave: string, respaldo: T): Promise<T> {
  const v = await leerPropiedad(ctx, clave);
  if (v === null || v === '') return respaldo;
  try { return JSON.parse(v) as T; } catch { return respaldo; }
}

// ── Caché con caducidad ─────────────────────────────────────────────────────

export async function cacheLeer(ctx: Ctx, clave: string): Promise<string | null> {
  const fila = await ctx.una<{ valor: string; expira: number }>('SELECT valor, expira FROM cache WHERE clave = ?', clave);
  if (!fila) return null;
  if (fila.expira <= Date.now()) {
    ctx.despues(ctx.ejecutar('DELETE FROM cache WHERE clave = ? AND expira <= ?', clave, Date.now()));
    return null;
  }
  return fila.valor;
}

export async function cacheGuardar(ctx: Ctx, clave: string, valor: unknown, segundos: number): Promise<void> {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  await ctx.ejecutar(
    'INSERT INTO cache (clave, valor, expira) VALUES (?, ?, ?) ' +
    'ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, expira = excluded.expira',
    clave, texto, Date.now() + Math.max(1, segundos) * 1000);
}

export async function cacheBorrar(ctx: Ctx, clave: string): Promise<void> {
  await ctx.ejecutar('DELETE FROM cache WHERE clave = ?', clave);
}

/** Suma 1 a un contador con caducidad y devuelve el valor nuevo (intentos, límites por hora). */
export async function cacheSumar(ctx: Ctx, clave: string, segundos: number): Promise<number> {
  const ahora = Date.now();
  const fila = await ctx.una<{ valor: string }>(
    'INSERT INTO cache (clave, valor, expira) VALUES (?, \'1\', ?) ' +
    'ON CONFLICT(clave) DO UPDATE SET ' +
    "  valor = CASE WHEN cache.expira <= ? THEN '1' ELSE CAST(CAST(cache.valor AS INTEGER) + 1 AS TEXT) END, " +
    '  expira = CASE WHEN cache.expira <= ? THEN excluded.expira ELSE cache.expira END ' +
    'RETURNING valor',
    clave, ahora + segundos * 1000, ahora, ahora);
  return Number(fila?.valor || 1);
}

/** Limpieza de entradas vencidas (la llama el Worker de vez en cuando, fuera del camino crítico). */
export async function cachePurgar(ctx: Ctx): Promise<void> {
  await ctx.ejecutar('DELETE FROM cache WHERE expira <= ?', Date.now());
}

// ── Contadores atómicos (LockService) ───────────────────────────────────────

/** Incrementa y devuelve el contador. Atómico: dos peticiones a la vez nunca reciben el mismo. */
export async function siguienteContador(ctx: Ctx, clave: string): Promise<number> {
  const fila = await ctx.una<{ valor: number }>(
    'INSERT INTO contadores (clave, valor) VALUES (?, 1) ' +
    'ON CONFLICT(clave) DO UPDATE SET valor = contadores.valor + 1 RETURNING valor', clave);
  return Number(fila?.valor || 1);
}

// ── Bitácora de la consola ──────────────────────────────────────────────────

/** Una fila en «BitacoraConsola»: quién cambió qué. Nunca lanza. */
export async function apuntarBitacora(ctx: Ctx, quien: string, accion: string, objetivo: string, detalle: unknown): Promise<void> {
  try {
    await ctx.ejecutar(
      'INSERT INTO bitacora_consola (fecha, quien, accion, objetivo, detalle) VALUES (?, ?, ?, ?, ?)',
      ctx.ahoraIso(), quien || '', accion || '', objetivo || '',
      typeof detalle === 'string' ? detalle : JSON.stringify(detalle ?? ''));
  } catch (e) {
    console.error('apuntarBitacora', e);
  }
}
