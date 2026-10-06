/**
 * SEGURIDAD E IDENTIDAD | Portal Ventel en Cloudflare
 * ===================================================
 * Port de Seguridad.gs. La regla es la misma: la sesión del PORTAL manda (la llave de Sesiones),
 * y toda función que exponga algo empieza por una de estas puertas:
 *
 *   secIdentidad(ctx, emailCliente)                 → ¿quién llama?
 *   secIdentidadAvanzada(ctx, emailCliente)         → … y es supervisor o más
 *   secIdentidadConBloque(ctx, emailCliente, 'x')   → … y tiene el bloque x
 *   secIdentidadMaestra(ctx, emailCliente)          → … y es maestro
 *
 * Todas devuelven {ok, email, nombre, avanzado, rol, maestro, bloques, origen, error} y NUNCA
 * lanzan: hay funciones que con !id.ok siguen en modo visitante.
 *
 * Diferencias con Apps Script: aquí no hay cuenta de Google (no hay Session.getActiveUser ni
 * editor), así que los respaldos a la cuenta de Google desaparecen: sin llave de sesión válida no
 * hay identidad, salvo que la propiedad AUTH_SESIONES = 'no' devuelva el modo antiguo (fiarse del
 * correo que declara el navegador, comprobando que exista en registros).
 */
import type { Ctx } from './contexto';
import { leerPropiedad, cacheLeer, cacheSumar, cacheBorrar } from './sistema';
import { sha256Hex } from './cripto';
import { permUsuario, permBloque, permModulosApagados, permFilaRegistro } from './permisos';
import { esAfirmativo, escaparHtml } from './util';

/** Sal de las contraseñas: manda la propiedad HASH_SALT; este es el respaldo de Code.gs. */
const HASH_SALT_RESPALDO = 'vPe/O5s2aG+Bv4cRGCwz+w==';

export interface Identidad {
  ok: boolean; email: string; nombre: string; avanzado: boolean; rol: string; maestro: boolean;
  bloques: string[]; origen: string; error: string;
}

/** secConfig_: la propiedad del script o el respaldo. */
export async function secConfig(ctx: Ctx, clave: string, respaldo: string): Promise<string> {
  try {
    const v = await ctx.memorizar('prop:' + clave, () => leerPropiedad(ctx, clave));
    return (v === null || v === '') ? respaldo : v;
  } catch {
    return respaldo;
  }
}

export function secNormalizarCorreo(email: unknown): string {
  return String(email == null ? '' : email).trim().toLowerCase();
}

export const secEsAfirmativo = esAfirmativo;
export const secEscapeHtml = escaparHtml;

export function secComparacionSegura(a: unknown, b: unknown): boolean {
  const sa = String(a || ''), sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= (sa.charCodeAt(i) ^ sb.charCodeAt(i));
  return diff === 0;
}

/** Hash de contraseña: SHA-256(password + sal) en hex, el mismo algoritmo de Apps Script. */
export async function secHashContrasena(ctx: Ctx, password: string): Promise<string> {
  const sal = await secConfig(ctx, 'HASH_SALT', HASH_SALT_RESPALDO);
  return sha256Hex(String(password) + sal);
}

export function secCorreoValido(email: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(secNormalizarCorreo(email));
}

/** secBuscarRegistro_: ¿existe ese correo en registros? */
export async function secBuscarRegistro(ctx: Ctx, email: unknown): Promise<{ encontrado: boolean; email: string; nombre: string; avanzado: boolean }> {
  const out = { encontrado: false, email: secNormalizarCorreo(email), nombre: '', avanzado: false };
  if (!out.email) return out;
  const fila = await permFilaRegistro(ctx, out.email);
  if (fila) {
    out.encontrado = true;
    out.nombre = fila.nombre || '';
    out.avanzado = esAfirmativo(fila.avanzado);
  }
  return out;
}

function fallo(mensaje: string): Identidad {
  return { ok: false, email: '', nombre: '', avanzado: false, rol: 'normal', maestro: false,
           bloques: [], origen: 'ninguno', error: mensaje };
}

async function exito(ctx: Ctx, reg: { email: string; nombre: string }, origen: string): Promise<Identidad> {
  const u = await permUsuario(ctx, reg.email);
  if (!u.activo) {
    const negado = fallo('Tu cuenta está dada de baja. Pide al administrador que la reactive.');
    negado.email = reg.email;
    negado.nombre = reg.nombre;
    return negado;
  }
  return { ok: true, email: reg.email, nombre: reg.nombre, avanzado: u.avanzado, rol: u.rol,
           maestro: u.maestro, bloques: u.bloques, origen, error: '' };
}

/** ¿Sesiones obligatorias? La propiedad AUTH_SESIONES = 'no' las apaga (interruptor de emergencia). */
export async function sesObligatorias(ctx: Ctx): Promise<boolean> {
  return String(await secConfig(ctx, 'AUTH_SESIONES', 'si')).trim().toLowerCase() !== 'no';
}

/** Resuelve QUIÉN está haciendo la llamada. Único punto donde se decide la identidad. */
export async function secIdentidad(ctx: Ctx, emailCliente?: unknown): Promise<Identidad> {
  const declarado = secNormalizarCorreo(emailCliente);
  const clave = 'id:' + declarado + ':' + (ctx.sesion ? ctx.sesion.email : '');
  return ctx.memorizar(clave, async () => {
    if (await sesObligatorias(ctx)) {
      if (ctx.sesion && ctx.sesion.email) {
        if (declarado && declarado !== ctx.sesion.email) {
          return fallo('La sesión abierta es de otra cuenta. Cierra sesión y vuelve a entrar con ' + declarado + '.');
        }
        const regSesion = await secBuscarRegistro(ctx, ctx.sesion.email);
        return regSesion.encontrado
          ? exito(ctx, regSesion, 'sesion')
          : fallo('El usuario ' + ctx.sesion.email + ' ya no está dado de alta. Inicia sesión de nuevo.');
      }
      return fallo('Tu sesión no es válida o expiró. Inicia sesión de nuevo.');
    }
    // Modo antiguo (AUTH_SESIONES = 'no'): manda el correo declarado si está dado de alta.
    if (declarado) {
      const reg = await secBuscarRegistro(ctx, declarado);
      return reg.encontrado
        ? exito(ctx, reg, 'portal')
        : fallo('El usuario ' + declarado + ' no está dado de alta en el sistema. Inicia sesión de nuevo.');
    }
    return fallo('Tu sesión no es válida o expiró. Inicia sesión de nuevo.');
  });
}

export async function secIdentidadAvanzada(ctx: Ctx, emailCliente?: unknown): Promise<Identidad> {
  const id = await secIdentidad(ctx, emailCliente);
  if (!id.ok) return id;
  if (!id.avanzado) {
    return { ok: false, email: id.email, nombre: id.nombre, avanzado: false, rol: id.rol, maestro: false,
             bloques: id.bloques, origen: id.origen, error: 'Tu cuenta no tiene permisos de usuario avanzado.' };
  }
  return id;
}

export async function secIdentidadConBloque(ctx: Ctx, emailCliente: unknown, bloqueId: string): Promise<Identidad> {
  const id = await secIdentidad(ctx, emailCliente);
  if (!id.ok) return id;
  if (!bloqueId) return id;
  if ((id.bloques || []).indexOf(bloqueId) !== -1) return id;
  const bloque = permBloque(bloqueId);
  const apagado = (await permModulosApagados(ctx)).indexOf(bloqueId) !== -1 && !id.maestro;
  const nombre = (bloque && bloque.nombre) || bloqueId;
  return { ok: false, email: id.email, nombre: id.nombre, avanzado: id.avanzado, rol: id.rol, maestro: id.maestro,
           bloques: id.bloques, origen: id.origen,
           error: apagado
             ? 'El módulo "' + nombre + '" está en mantenimiento. Vuelve a intentarlo más tarde.'
             : 'Tu cuenta no tiene acceso a "' + nombre + '".' };
}

export async function secIdentidadMaestra(ctx: Ctx, emailCliente?: unknown): Promise<Identidad> {
  const id = await secIdentidad(ctx, emailCliente);
  if (!id.ok) return id;
  if (!id.maestro) {
    return { ok: false, email: id.email, nombre: id.nombre, avanzado: id.avanzado, rol: id.rol, maestro: false,
             bloques: id.bloques, origen: id.origen, error: 'Solo el rol maestro puede entrar a la consola de administración.' };
  }
  return id;
}

/** Correo con el que se SELLA un registro. Nunca falla. */
export async function secCorreoEfectivo(ctx: Ctx, emailCliente?: unknown): Promise<string> {
  const id = await secIdentidad(ctx, emailCliente);
  if (id.ok) return id.email;
  return secNormalizarCorreo(emailCliente) || (ctx.sesion ? ctx.sesion.email : '');
}

// ── Límite de intentos (fuerza bruta en el login) ───────────────────────────

export async function secIntentosRevisar(ctx: Ctx, clave: string, maximo: number): Promise<{ bloqueado: boolean; restantes: number }> {
  try {
    const n = Number((await cacheLeer(ctx, 'sec_try_' + clave)) || 0);
    return { bloqueado: n >= maximo, restantes: Math.max(0, maximo - n) };
  } catch {
    return { bloqueado: false, restantes: maximo };
  }
}

export async function secIntentosSumar(ctx: Ctx, clave: string, ventanaSegundos: number): Promise<number> {
  try { return await cacheSumar(ctx, 'sec_try_' + clave, ventanaSegundos); } catch { return 0; }
}

export async function secIntentosLimpiar(ctx: Ctx, clave: string): Promise<void> {
  try { await cacheBorrar(ctx, 'sec_try_' + clave); } catch { /* nada */ }
}
