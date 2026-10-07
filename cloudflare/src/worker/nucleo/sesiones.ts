/**
 * SESIONES — la llave que prueba quién llama | Portal Ventel en Cloudflare
 * ======================================================================
 * Port de Sesiones.gs. Igual que allá:
 *   1. Al iniciar sesión se entrega una LLAVE al azar ('vs1.' + 64 hex). Solo viaja esa vez.
 *   2. El navegador la guarda y TODAS sus llamadas pasan por secEjecutar(llave, función, args).
 *   3. La sesión vence tras SESION_INACTIVIDAD_MIN minutos (120) sin que la persona toque la
 *      pantalla; la actividad la informa el navegador en cada llamada.
 *   4. Cerrar sesión borra la llave (sesCerrar).
 * Se guarda la HUELLA de la llave (tabla `sesiones`), nunca la llave en claro.
 */
import type { Ctx } from './contexto';
import { secConfig, secNormalizarCorreo } from './seguridad';
import { aleatorioHex, sha256Hex } from './cripto';
import { cacheLeer, cacheGuardar, cachePurgar } from './sistema';

const SES_INACTIVIDAD_MIN = 120;
const SES_REFRESCO_MS = 5 * 60 * 1000;
export const SES_ERROR_VENCIDA = 'SESION_EXPIRADA: Tu sesión se cerró por inactividad. Vuelve a iniciar sesión.';
const SES_FORMATO = /^vs1\.[0-9a-f]{64}$/;
const SES_PURGA_CADA_SEG = 1800;

export async function sesInactividadMs(ctx: Ctx): Promise<number> {
  const n = parseInt(await secConfig(ctx, 'SESION_INACTIVIDAD_MIN', String(SES_INACTIVIDAD_MIN)), 10);
  return ((n > 0 && n <= 1440) ? n : SES_INACTIVIDAD_MIN) * 60000;
}

async function huella(llave: string): Promise<string> {
  return (await sha256Hex('sesion:' + String(llave || ''))).slice(0, 40);
}

/** Abre una sesión para un correo YA verificado. Devuelve la llave en claro (única vez). */
export async function sesCrear(ctx: Ctx, email: string): Promise<string> {
  const correo = secNormalizarCorreo(email);
  if (!correo) throw new Error('No se puede abrir una sesión sin correo.');
  const llave = 'vs1.' + aleatorioHex(32);
  const ahora = Date.now();
  await ctx.ejecutar('INSERT INTO sesiones (huella, email, ultima, inicio) VALUES (?, ?, ?, ?)',
    await huella(llave), correo, ahora, ahora);
  return llave;
}

/** Valida una llave. Devuelve {email} o null si no existe o venció. */
export async function sesValidar(ctx: Ctx, llave: unknown, actividad?: unknown): Promise<{ email: string } | null> {
  const texto = String(llave || '');
  if (!SES_FORMATO.test(texto)) return null;
  const h = await huella(texto);
  const reg = await ctx.una<{ email: string; ultima: number }>('SELECT email, ultima FROM sesiones WHERE huella = ?', h);
  if (!reg || !reg.email) return null;
  const ahora = Date.now();
  const guardada = Number(reg.ultima) || 0;
  const informada = Math.min(Number(actividad) || 0, ahora);
  const ultima = Math.max(guardada, informada);
  if (ahora - ultima > await sesInactividadMs(ctx)) {
    ctx.despues(ctx.ejecutar('DELETE FROM sesiones WHERE huella = ?', h));
    return null;
  }
  if (ultima - guardada > SES_REFRESCO_MS) {
    ctx.despues(ctx.ejecutar('UPDATE sesiones SET ultima = ? WHERE huella = ?', ultima, h));
  }
  return { email: reg.email };
}

/** Lo que el login le devuelve al navegador además de sus datos. */
export async function sesParaCliente(ctx: Ctx, correo: string): Promise<{ llave: string; inactividadMin: number }> {
  return { llave: await sesCrear(ctx, correo), inactividadMin: Math.round((await sesInactividadMs(ctx)) / 60000) };
}

/** Cierra la sesión. Se puede llamar sin sesión: solo borra si la llave es válida. */
export async function sesCerrar(ctx: Ctx, llave?: unknown): Promise<{ success: true }> {
  const texto = String(llave || '');
  if (SES_FORMATO.test(texto)) await ctx.ejecutar('DELETE FROM sesiones WHERE huella = ?', await huella(texto));
  return { success: true };
}

/** Latido de una pantalla abierta sin llamadas (pasa por secEjecutar, que ya renueva). */
export async function sesTocar(ctx: Ctx): Promise<{ success: true; vigente: boolean }> {
  return { success: true, vigente: !!ctx.sesion };
}

/** Borra sesiones vencidas y caché caducada, como mucho cada 30 min (fuera del camino crítico). */
export async function sesPurgar(ctx: Ctx): Promise<void> {
  try {
    if (await cacheLeer(ctx, 'sesPurgaReciente')) return;
    await cacheGuardar(ctx, 'sesPurgaReciente', String(Date.now()), SES_PURGA_CADA_SEG);
    await ctx.ejecutar('DELETE FROM sesiones WHERE ultima < ?', Date.now() - await sesInactividadMs(ctx));
    await cachePurgar(ctx);
  } catch (e) {
    console.error('sesPurgar', e);
  }
}
