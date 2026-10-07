/**
 * PORTAL · ayudantes compartidos | Portal Ventel en Cloudflare
 * ============================================================
 * Lo que en Portal.gs, Publicaciones.gs y PortalContenido.gs usaban varios archivos a la vez:
 * las puertas (anuncios y contenido), las fechas de los anuncios en hora de México y los criterios
 * de lectura de una fila de «Anuncios» (activo, responsable, datos en JSON).
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIdentidad, secIdentidadConBloque } from '../../nucleo/seguridad';
import { aFecha, fechaDesdeMx, formatearFecha } from '../../nucleo/fechas';

export const DIA_MS = 86400000;

// ── Puertas ─────────────────────────────────────────────────────────────────

export type Puerta = { ok: true; email: string; nombre: string } | { ok: false; error: string };

const ERROR_PUERTA = 'No pudimos verificar tu cuenta. Vuelve a entrar al sistema e inténtalo de nuevo.';

/**
 * Sesión + un bloque de permisos (portalGateAvanzado_ y pcGate_). Es la MISMA puerta que usa el
 * resto del sistema, así que respeta ajustes por persona y módulos apagados.
 */
export async function puertaBloque(ctx: Ctx, email: unknown, bloque: string): Promise<Puerta> {
  try {
    const id = await secIdentidadConBloque(ctx, email, bloque);
    return id.ok ? { ok: true, email: id.email, nombre: id.nombre } : { ok: false, error: id.error };
  } catch (e) {
    console.error('puertaBloque(' + bloque + ')', e);
    return { ok: false, error: ERROR_PUERTA };
  }
}

/** portalGateAvanzado_: publicar anuncios pide el bloque 'anuncios'. */
export function portalGateAvanzado(ctx: Ctx, email: unknown): Promise<Puerta> {
  return puertaBloque(ctx, email, 'anuncios');
}

/**
 * ¿Hay una persona del equipo detrás de esta llamada? (sesión válida y cuenta activa). Nunca lanza.
 * Lo usa la lectura pública del Portal para decidir si viajan las columnas con credenciales.
 */
export async function hayPersona(ctx: Ctx): Promise<boolean> {
  if (!ctx.sesion) return false;
  try { return (await secIdentidad(ctx, '')).ok; } catch { return false; }
}

// ── Fechas de los anuncios ──────────────────────────────────────────────────

/**
 * 'YYYY-MM-DD' → la fecha en hora de México: inicio del día para «Desde», 23:59:59 para «Hasta»
 * (portalParseFechaLocal_). '' si no trae fecha.
 */
export function portalParseFechaLocal(str: unknown, inicio?: boolean): Date | '' {
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = inicio
    ? fechaDesdeMx(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0)
    : fechaDesdeMx(Number(m[1]), Number(m[2]), Number(m[3]), 23, 59, 59);
  return isNaN(d.getTime()) ? '' : d;
}

/** Una celda de fecha leída de D1 (ISO UTC, o lo que haya dejado la semilla) como Date, o null. */
export function fechaDeCelda(v: unknown): Date | null {
  return aFecha(v);
}

/** Date → 'yyyy-MM-dd' en hora de México (Utilities.formatDate(…, tz, 'yyyy-MM-dd')). '' si no hay. */
export function diaMx(v: unknown): string {
  const d = aFecha(v);
  return d ? formatearFecha(d, 'yyyy-MM-dd') : '';
}

// ── Una fila de «Anuncios» ──────────────────────────────────────────────────

export const PORTAL_ANUNCIOS_FORMATOS = ['banner', 'destacado', 'tarjeta', 'modal'];

/**
 * portalEsActivo_. En la hoja una celda VACÍA contaba como activa; en D1 la columna es 0/1, pero se
 * conserva el criterio para lo que llegue como texto (y NULL vale lo que valía la celda vacía).
 */
export function portalEsActivo(v: unknown): boolean {
  if (v === true) return true;
  if (v === false) return false;
  if (v === null || v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'true' || s === 'si' || s === 'sí' || s === '1' || s === 'x' || s === 'activo';
}

/**
 * Nombre legible de quien publicó (portalNombreResponsable_). Manda «Responsable»; de las filas que
 * solo tienen el correo se saca un nombre presentable: el Portal lo ve todo el equipo y un correo ahí
 * es un dato de contacto que nadie pidió publicar. "maria.lopez@…" → "Maria Lopez".
 */
export function portalNombreResponsable(nombre: unknown, correo: unknown): string {
  const n = String(nombre || '').trim();
  if (n) return n;
  const c = String(correo || '').trim();
  if (!c) return '';
  const usuario = c.split('@')[0].replace(/[._-]+/g, ' ').trim();
  if (!usuario) return '';
  return usuario.split(/\s+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

/** «Datos (JSON)» de la fila; {} si está vacío o roto (como el try/catch del original). */
export function datosDeFila(v: unknown): any {
  if (v === null || v === undefined || v === '') return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return {}; }
}

/** «Orden» como número (0 si vacío o no numérico). */
export function ordenDeFila(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  return Number(v) || 0;
}

/** Fila de portal_anuncios tal cual sale de D1. */
export interface FilaAnuncio {
  id: string; formato: string; activo: number | string | null; orden: number | null;
  desde: string | null; hasta: string | null; datos: string | null; autor: string | null;
  responsable: string | null; creado: string | null;
}

/** Estado de una publicación en `ahora`: 'inactivo' | 'programado' | 'expirado' | 'activo'. */
export function estadoAnuncio(f: FilaAnuncio, ahora: Date, hoy0: Date): string {
  if (!portalEsActivo(f.activo)) return 'inactivo';
  const desde = fechaDeCelda(f.desde);
  const hasta = fechaDeCelda(f.hasta);
  if (desde && desde > ahora) return 'programado';
  // «Hasta» es inclusivo de todo su día: expira solo cuando cae en un día ANTERIOR a hoy.
  if (hasta && hasta < hoy0) return 'expirado';
  return 'activo';
}

/** Texto de error como lo daba `error.toString()` en Apps Script ('Error: …'). */
export function textoError(e: unknown): string {
  return String(e);
}

/** Mensaje de un error sin el prefijo (String(error.message || error)). */
export function mensajeError(e: any): string {
  return String((e && e.message) || e);
}
