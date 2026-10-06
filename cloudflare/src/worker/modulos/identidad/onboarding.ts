/**
 * ONBOARDING · qué tutorial ya vio cada persona | Portal Ventel en Cloudflare
 * ===========================================================================
 * Port de Onboarding.gs. Un recorrido guiado solo sirve la primera vez; lo visto se ANOTA en la
 * base (tabla onboarding, la hoja «Onboarding») y no solo en el navegador, para que quien entra
 * desde otra computadora no vuelva a ver el tutorial de bienvenida como si fuera nuevo.
 *
 * Una fila por persona y pantalla (clave primaria correo + pantalla: ya no puede haber duplicados).
 * OMITIR CUENTA COMO VISTO. Y ESTO NO ES UN CANDADO: si falla, el cliente cae a lo que tenga en el
 * navegador. Sin CacheService ni LockService: D1 lee al momento y la escritura es un UPSERT.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIdentidad } from '../../nucleo/seguridad';

/** Estados válidos. Cualquier otra cosa que llegue se guarda como 'completado'. */
const ONB_ESTADOS = ['completado', 'omitido'];

/** Normaliza una clave de pantalla: minúsculas, sin espacios ni sorpresas. */
export function onbClavePantalla(v: unknown): string {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '').slice(0, 40);
}

/** Mapa pantalla → versión vista de una persona. */
async function onbLeerVistos(ctx: Ctx, email: string): Promise<Record<string, number>> {
  const filas = await ctx.todas<{ pantalla: string; version: number }>(
    'SELECT pantalla, version FROM onboarding WHERE correo = ?', String(email || '').trim().toLowerCase());
  const vistos: Record<string, number> = {};
  for (const f of filas) {
    const pantalla = onbClavePantalla(f.pantalla);
    if (!pantalla) continue;
    const version = Number(f.version) || 1;
    if (!vistos[pantalla] || version > vistos[pantalla]) vistos[pantalla] = version;
  }
  return vistos;
}

/**
 * Qué recorridos ya vio esta persona: mapa pantalla → versión vista. La VERSIÓN permite volver a
 * enseñar el recorrido de una pantalla que cambió de fondo sin repetir todos los demás.
 */
export async function onbEstado(ctx: Ctx, emailCliente: string) {
  try {
    const id = await secIdentidad(ctx, emailCliente);
    // Sin identidad válida no hay nada que consultar, pero tampoco es un error que deba pintarse:
    // el cliente se queda con lo que tenga en el navegador.
    if (!id.ok) return { success: false, vistos: {}, message: id.error || 'Sesión no válida.' };
    return { success: true, vistos: await onbLeerVistos(ctx, id.email), message: '' };
  } catch (e: any) {
    console.error('onbEstado', e);
    return { success: false, vistos: {}, message: String((e && e.message) || e) };
  }
}

/**
 * Anota que esta persona ya vio (o saltó) el recorrido de una pantalla. Idempotente. Nunca lanza:
 * fallar al anotar no debe romper la pantalla que el asesor está usando.
 * @param datos {pantalla, version, estado, paso, total}
 */
export async function onbMarcar(ctx: Ctx, emailCliente: string, datos?: any) {
  datos = datos || {};
  try {
    const id = await secIdentidad(ctx, emailCliente);
    if (!id.ok) return { success: false, message: id.error || 'Sesión no válida.' };

    const pantalla = onbClavePantalla(datos.pantalla);
    if (!pantalla) return { success: false, message: 'Falta la pantalla.' };

    const version = Number(datos.version) || 1;
    const estado = ONB_ESTADOS.indexOf(String(datos.estado || '').toLowerCase()) !== -1
      ? String(datos.estado).toLowerCase() : 'completado';

    await ctx.ejecutar(
      'INSERT INTO onboarding (correo, pantalla, version, estado, paso_final, total_pasos, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(correo, pantalla) DO UPDATE SET version = excluded.version, estado = excluded.estado, ' +
      'paso_final = excluded.paso_final, total_pasos = excluded.total_pasos, actualizado = excluded.actualizado',
      id.email.toLowerCase(), pantalla, version, estado, Number(datos.paso) || 0, Number(datos.total) || 0, ctx.ahoraIso());
    return { success: true, message: '' };
  } catch (e: any) {
    console.error('onbMarcar', e);
    return { success: false, message: String((e && e.message) || e) };
  }
}

/**
 * Borra lo anotado para que los recorridos vuelvan a salir. Solo sobre uno mismo.
 * @param pantalla clave de una pantalla; vacío = todas.
 */
export async function onbReiniciar(ctx: Ctx, emailCliente: string, pantalla?: string) {
  try {
    const id = await secIdentidad(ctx, emailCliente);
    if (!id.ok) return { success: false, borrados: 0, message: id.error || 'Sesión no válida.' };

    const clave = onbClavePantalla(pantalla);
    const r = clave
      ? await ctx.ejecutar('DELETE FROM onboarding WHERE correo = ? AND pantalla = ?', id.email.toLowerCase(), clave)
      : await ctx.ejecutar('DELETE FROM onboarding WHERE correo = ?', id.email.toLowerCase());
    return { success: true, borrados: r.cambios, message: '' };
  } catch (e: any) {
    console.error('onbReiniciar', e);
    return { success: false, borrados: 0, message: String((e && e.message) || e) };
  }
}
