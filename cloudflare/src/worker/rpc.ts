/**
 * EL CANAL: secEjecutar / secEjecutarLote | Portal Ventel en Cloudflare
 * ====================================================================
 * Port del canal de Sesiones.gs. En Apps Script, TODAS las llamadas del navegador (AppRun) pasaban
 * por secEjecutar(llave, nombre, args, actividad, medir): se validaba la llave, se dejaba la sesión
 * de esa ejecución y se llamaba a la función pedida. Aquí es igual, sobre POST /api/rpc:
 *
 *   { fn: 'secEjecutar',     args: [llave, nombre, args, actividad, medir] }
 *   { fn: 'secEjecutarLote', args: [llave, [[nombre, args], …], actividad] }
 *   { fn: '<nombre>',        args: [...] }   ← llamada directa (sin sesión), p. ej. sesCerrar
 *
 * Solo se puede llamar a lo que está en REGISTRO (modulos/indice.ts): el canal nunca es «ejecuta
 * cualquier cosa». Las funciones internas (las que en Apps Script llevaban secSoloInterno_ o
 * terminaban en _) simplemente no se registran.
 */
import type { Ctx } from './nucleo/contexto';
import { sesValidar, sesPurgar, SES_ERROR_VENCIDA } from './nucleo/sesiones';
import { REGISTRO } from './modulos/indice';

const SES_LOTE_MAX = 8;

export type FuncionRpc = (ctx: Ctx, ...args: any[]) => unknown | Promise<unknown>;

function funcionExpuesta(nombre: string): FuncionRpc | null {
  if (!/^[A-Za-z$][\w$]*$/.test(nombre) || /_$/.test(nombre)) return null;
  return Object.prototype.hasOwnProperty.call(REGISTRO, nombre) ? REGISTRO[nombre] : null;
}

async function abrirEjecucion(ctx: Ctx, llave: unknown, actividad: unknown): Promise<void> {
  ctx.entrada = 'secEjecutar';
  ctx.sesion = null;
  if (llave) {
    const s = await sesValidar(ctx, llave, actividad);
    if (!s) throw new Error(SES_ERROR_VENCIDA);
    ctx.sesion = s;
  }
}

export async function secEjecutar(ctx: Ctx, llave: unknown, nombre: unknown, args: unknown, actividad?: unknown, medir?: unknown) {
  const t0 = Date.now();
  const fn = String(nombre || '');
  const f = funcionExpuesta(fn);
  if (!f) throw new Error('El servidor no expone la función ' + fn + '.');
  await abrirEjecucion(ctx, llave, actividad);
  const respuesta = await f(ctx, ...(Array.isArray(args) ? args : []));
  return medir === 1 ? { __srv: 1, v: respuesta, ms: Date.now() - t0 } : respuesta;
}

export async function secEjecutarLote(ctx: Ctx, llave: unknown, lote: unknown, actividad?: unknown) {
  if (!Array.isArray(lote) || !lote.length || lote.length > SES_LOTE_MAX) throw new Error('Lote de llamadas no válido.');
  await abrirEjecucion(ctx, llave, actividad);
  const respuestas: Array<{ v: unknown; ms: number } | { e: string }> = [];
  // En serie y en el orden en que llegan, como en Apps Script.
  for (const item of lote) {
    const t0 = Date.now();
    const fn = String((Array.isArray(item) && item[0]) || '');
    const f = funcionExpuesta(fn);
    if (!f) { respuestas.push({ e: 'El servidor no expone la función ' + fn + '.' }); continue; }
    try {
      respuestas.push({ v: await f(ctx, ...(Array.isArray(item[1]) ? item[1] : [])), ms: Date.now() - t0 });
    } catch (err: any) {
      respuestas.push({ e: String((err && err.message) || err) });
    }
  }
  ctx.despues(sesPurgar(ctx));
  return respuestas;
}

/** Despacha una petición de /api/rpc. Lanza con el mensaje que verá el withFailureHandler. */
export async function despachar(ctx: Ctx, fn: string, args: unknown[]): Promise<unknown> {
  if (fn === 'secEjecutar') return secEjecutar(ctx, args[0], args[1], args[2], args[3], args[4]);
  if (fn === 'secEjecutarLote') return secEjecutarLote(ctx, args[0], args[1], args[2]);
  const f = funcionExpuesta(fn);
  if (!f) throw new Error('El servidor no expone la función ' + fn + '.');
  ctx.entrada = 'directa';
  ctx.sesion = null;
  return f(ctx, ...args);
}
