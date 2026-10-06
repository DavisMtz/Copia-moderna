/*
 * Hablar con el servidor desde el explorador, como lo hacen las pantallas (AppRun → secEjecutar):
 *   POST /api/rpc  { fn: 'secEjecutar', args: [llave, nombre, args, actividad] }
 * La llave y el correo los dejó el inicio de sesión del Portal en localStorage (AppSession, app_core).
 */

export interface MedidaD1 { ms: number; sql: number; filasLeidas: number; consultas: number }

export interface Columna { nombre: string; tipo: string; pk: number; oculta: '' | 'siempre' | 'a veces'; ordenable: boolean }
export type Celda = string | number | null | { $oculto: true } | { $cortado: string; largo: number } | { $blob: number };
export interface TablaResumen { nombre: string; filas: number; columnas: Columna[] }

export interface RespTablas { success: true; tablas: TablaResumen[]; bytes: number; d1: MedidaD1 }
export interface RespFilas {
  success: true; tabla: string; columnas: Columna[]; filas: Array<{ rowid: number | null; celdas: Celda[] }>;
  total: number; pagina: number; porPagina: number; orden: string; dir: 'asc' | 'desc'; filtro: string; d1: MedidaD1;
}
export interface RespFila { success: true; tabla: string; rowid: number; campos: Array<Columna & { valor: Celda }>; d1: MedidaD1 }
export interface RespConsulta { success: true; columnas: string[]; filas: Celda[][]; truncado: boolean; limite: number; d1: MedidaD1 }
export interface CorreoResumen {
  id: number; fecha: string; de: string; nombreDe: string; para: string; cc: string; cco: string; asunto: string;
  tipo: string; referencia: string; adjuntos: number; bytes: number; codigoVigenteHasta: string;
}
export interface RespCorreos {
  success: true; correos: CorreoResumen[]; total: number; tipos: Array<{ tipo: string; n: number }>;
  pagina: number; porPagina: number; d1: MedidaD1;
}
export interface Correo extends Omit<CorreoResumen, 'adjuntos' | 'bytes'> {
  responderA: string; html: string; texto: string; adjuntos: Array<{ nombre: string; tipo: string; bytes: number }>;
}
export interface RespCorreo { success: true; correo: Correo; d1: MedidaD1 }

/** Lo que el servidor contesta cuando algo no se puede (sin lanzar). */
export interface Fallo { success: false; codigo: 'SIN_SESION' | 'SIN_PERMISO' | 'NO_VALIDO'; message: string }

/** Lo que midió el navegador en cada llamada. */
export interface Viaje { ida: number; servidor: number }

export class SinSesion extends Error {}
export class SinPermiso extends Error {}

function leer(clave: string): string {
  try { return localStorage.getItem(clave) || ''; } catch { return ''; }
}

export function sesion() {
  return {
    llave: leer('ventel-llave'),
    email: leer('ventel-user-email'),
    nombre: leer('ventel-user-name'),
    rol: leer('ventel-user-role')
  };
}

/**
 * Llama a una función de modulos/nuevas.ts. Devuelve su respuesta tal cual (con `success`) y lo que
 * tardó el viaje; lanza SinSesion / SinPermiso cuando la puerta no deja pasar, y Error si la red falla.
 */
export async function llamar<T>(nombre: string, args: unknown[]): Promise<{ r: T | Fallo; viaje: Viaje }> {
  const { llave } = sesion();
  if (!llave) throw new SinSesion('No hay una sesión abierta en este navegador.');
  // La persona está usando la app: la ventana de inactividad se comparte con las demás pestañas.
  try { localStorage.setItem('ventel-sesion-actividad', String(Date.now())); } catch { /* sin almacenamiento */ }
  const t0 = performance.now();
  let resp: Response;
  try {
    resp = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ fn: 'secEjecutar', args: [llave, nombre, args, Date.now()] })
    });
  } catch {
    throw new Error('No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.');
  }
  let servidor = -1;
  const st = resp.headers.get('server-timing') || '';
  const m = /app;dur=([\d.]+)/.exec(st);
  if (m) servidor = Number(m[1]);
  let j: { ok: boolean; v?: T | Fallo; e?: string };
  try { j = await resp.json(); } catch { throw new Error('El servidor contestó algo que no se pudo leer (' + resp.status + ').'); }
  const viaje = { ida: Math.round(performance.now() - t0), servidor };
  if (!j.ok) {
    const e = String(j.e || 'Error del servidor.');
    if (/^SESION_EXPIRADA/.test(e)) throw new SinSesion('Tu sesión se cerró por inactividad. Vuelve a iniciar sesión.');
    throw new Error(e);
  }
  const r = j.v as T | Fallo;
  if (r && (r as Fallo).success === false) {
    const f = r as Fallo;
    if (f.codigo === 'SIN_SESION') throw new SinSesion(f.message || 'Tu sesión no es válida o expiró.');
    if (f.codigo === 'SIN_PERMISO') throw new SinPermiso(f.message || 'Tu cuenta no tiene acceso.');
  }
  return { r, viaje };
}

export function esFallo<T>(r: T | Fallo): r is Fallo {
  return !!r && (r as Fallo).success === false;
}
