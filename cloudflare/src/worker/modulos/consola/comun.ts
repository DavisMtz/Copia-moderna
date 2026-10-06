/**
 * CONSOLA · piezas comunes | Portal Ventel en Cloudflare
 * ======================================================
 * Lo que comparten los seis archivos de la consola (Consola.gs, Grupos.gs, Difusion.gs,
 * Monitoreo.gs, CorreoCliente.gs y Articulos.gs en Apps Script): la puerta de entrada por
 * secciones, el índice de personas con sus permisos ya resueltos, el recorte jerárquico, el rango
 * de fechas, la lectura de la bitácora y los datos del remitente de correo.
 *
 * Las reglas de siempre siguen aquí, palabra por palabra:
 *   1. NADA se ejecuta sin pasar por una puerta (consolaAcceso / consolaGate).
 *   2. NADIE puede dejarse fuera (los candados viven en panel.ts).
 *   3. TODO cambio queda apuntado (apuntarBitacora del núcleo).
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIdentidad, secIdentidadMaestra, secConfig } from '../../nucleo/seguridad';
import {
  permUsuario, permNivelUsuario, permMismoCorreo, permBloque, permModulosApagados, permRolDeFila,
  permParsearAjustes, permBloquesEfectivos, permNormalizarRol, PERM_ROLES, type UsuarioPermisos
} from '../../nucleo/permisos';
import { fechaDesdeMx, aFecha, inicioDelDiaMx } from '../../nucleo/fechas';
import { esAfirmativo, normalizarTexto } from '../../nucleo/util';
import { CUOTA_CORREO_DIARIA } from '../../nucleo/correo';

// ── Secciones de la consola ─────────────────────────────────────────────────
//
// La consola la comparten dos perfiles muy distintos (maestro: todo; supervisor: Roles, Bitácora
// y Métricas, recortadas a su nivel). Se resuelve con esta tabla y no con `if (esMaestro)`
// repartidos: cada sección declara los bloques que la abren, en OR, y basta tener uno.

export interface Seccion { id: string; nombre: string; bloques: string[] }

export const CONSOLA_SECCIONES: Seccion[] = [
  { id: 'resumen',  nombre: 'Resumen',  bloques: [] },   // [] = cualquiera que entre
  { id: 'roles',    nombre: 'Roles',    bloques: ['adm_miembros', 'adm_permisos', 'sup_equipo'] },
  { id: 'modulos',  nombre: 'Módulos',  bloques: ['adm_modulos'] },
  { id: 'ajustes',  nombre: 'Ajustes',  bloques: ['adm_ajustes'] },
  { id: 'formatos', nombre: 'Formatos', bloques: ['adm_formatos'] },
  { id: 'salud',    nombre: 'Salud',    bloques: ['adm_salud'] },
  { id: 'bitacora', nombre: 'Bitácora', bloques: ['adm_bitacora', 'sup_equipo'] },
  // Métricas abre con un bloque de SUPERVISIÓN: el supervisor ve su alcance jerárquico y el
  // maestro todo. El recorte lo hace cada consulta de monitoreo.ts, no esta tabla.
  { id: 'metricas', nombre: 'Métricas', bloques: ['metricas'] }
];

/** Cuántos renglones de bitácora se mandan a la pantalla. */
export const CONSOLA_BITACORA_LIMITE = 150;
/** Tope de la consulta por fechas: hasta aquí llega una descarga, y se avisa si se corta. */
export const CONSOLA_BITACORA_TOPE_RANGO = 2000;
/** Techo duro de filas leídas por consulta, pase lo que pase. */
export const CONSOLA_BITACORA_MAX_LEIDAS = 12000;

function seccionAbierta(seccion: Seccion, bloques: string[]): boolean {
  if (!seccion.bloques.length) return true;
  return seccion.bloques.some((b) => (bloques || []).indexOf(b) !== -1);
}

export interface AccesoOk {
  ok: true; email: string; nombre: string; usuario: UsuarioPermisos; maestro: boolean; nivel: number;
  secciones: string[]; bloques: string[]; error: '';
}
export interface AccesoFallo { ok: false; email?: string; nombre?: string; error: string }
export type Acceso = AccesoOk | AccesoFallo;

/**
 * consolaAcceso_: perfil de acceso de quien llama — quién es, qué secciones ve y hasta dónde
 * alcanza. Es la ÚNICA puerta de la consola; todo lo demás parte de aquí.
 */
export async function consolaAcceso(ctx: Ctx, email: unknown, seccion?: string): Promise<Acceso> {
  const id = await secIdentidad(ctx, email);
  if (!id.ok) return { ok: false, error: id.error || 'Tu sesión no es válida.' };

  const yo = await permUsuario(ctx, id.email);
  const secciones = CONSOLA_SECCIONES.filter((s) => seccionAbierta(s, yo.bloques)).map((s) => s.id);

  // 'resumen' se le abre a cualquiera, así que tenerlo NO prueba nada: quien entra a la consola
  // tiene que traer al menos una sección con contenido propio.
  if (!secciones.some((s) => s !== 'resumen')) {
    return { ok: false, email: yo.email, nombre: yo.nombre, error: 'Tu cuenta no tiene acceso a la Consola.' };
  }
  if (seccion && secciones.indexOf(seccion) === -1) {
    const def = CONSOLA_SECCIONES.find((s) => s.id === seccion);
    return { ok: false, email: yo.email, nombre: yo.nombre,
             error: 'Tu cuenta no tiene acceso a "' + ((def && def.nombre) || seccion) + '" dentro de la Consola.' };
  }
  return { ok: true, email: yo.email, nombre: yo.nombre, usuario: yo, maestro: yo.maestro === true,
           nivel: permNivelUsuario(yo), secciones, bloques: yo.bloques, error: '' };
}

export interface GateOk { ok: true; email: string; nombre: string; maestro: boolean; bloques: string[]; error: string }
export type Gate = GateOk | AccesoFallo;

/** consolaGate_: las secciones de administración pura (ajustes, módulos, formatos, salud). */
export async function consolaGate(ctx: Ctx, email: unknown, bloqueId: string): Promise<Gate> {
  const id = await secIdentidadMaestra(ctx, email);
  if (!id.ok) return { ok: false, email: id.email, nombre: id.nombre, error: id.error };
  if (bloqueId && (id.bloques || []).indexOf(bloqueId) === -1) {
    const b = permBloque(bloqueId);
    return { ok: false, email: id.email, nombre: id.nombre,
             error: 'Tu cuenta maestra no tiene el bloque "' + ((b && b.nombre) || bloqueId) + '".' };
  }
  return { ok: true, email: id.email, nombre: id.nombre, maestro: id.maestro, bloques: id.bloques, error: '' };
}

/** consolaError_: respuesta de error uniforme, para que la pantalla no tenga que adivinar la forma. */
export function consolaError(mensaje?: string): { success: false; message: string } {
  return { success: false, message: mensaje || 'No se pudo completar la operación.' };
}

// ── Índice de personas ──────────────────────────────────────────────────────

export interface Persona extends UsuarioPermisos {
  alta: string;        // fecha de alta tal cual está en D1 (ISO)
  fila: number;        // posición en «Registros» (en la hoja era el número de fila)
  temporal: boolean;   // contraseña temporal pendiente de cambiar
  nivel: number;
}

/**
 * Todas las personas con sus permisos ya resueltos, en UNA consulta (registros ⋈ permisos).
 *
 * Es secIndiceRegistros_ + permUsuario_ fila a fila, pero sin N consultas: la consola, los grupos y
 * el monitoreo necesitan a TODO el equipo de golpe y preguntar persona por persona sería pagar un
 * viaje a D1 por cabeza. La resolución es la misma de permUsuario (rol → concesiones → retiros →
 * módulos apagados). La clave del memo empieza por 'perm:' a propósito: así cada escritura del
 * núcleo (permGuardarPermisos, permFijarModulosApagados…) lo tira sola con ctx.olvidar('perm:').
 */
export function consolaPersonas(ctx: Ctx): Promise<Persona[]> {
  return ctx.memorizar('perm:consola:personas', async () => {
    const [filas, apagados] = await Promise.all([
      ctx.todas<{
        fila: number; email: string; nombre: string; avanzado: number; password_temporal: number; alta: string | null;
        p_email: string | null; rol: string | null; permisos: string | null; activo: number | null;
      }>(
        'SELECT r.rowid AS fila, r.email, r.nombre, r.avanzado, r.password_temporal, r.alta, ' +
        'p.email AS p_email, p.rol, p.permisos, p.activo ' +
        'FROM registros r LEFT JOIN permisos_sistema p ON p.email = r.email ORDER BY r.rowid'),
      permModulosApagados(ctx)
    ]);
    const vistos: Record<string, boolean> = {};
    const out: Persona[] = [];
    for (const f of filas) {
      const email = String(f.email || '').trim().toLowerCase();
      if (!email || vistos[email]) continue;   // el primer registro gana, como en la hoja
      vistos[email] = true;
      const tienePermisos = f.p_email !== null && f.p_email !== undefined;
      const rol = permRolDeFila(tienePermisos ? f.rol : '', esAfirmativo(f.avanzado));
      const ajustes = permParsearAjustes(tienePermisos ? f.permisos : '');
      const p: Persona = {
        encontrado: true,
        email,
        nombre: f.nombre || '',
        rol,
        rolNombre: (PERM_ROLES[rol] || PERM_ROLES.normal).nombre,
        heredado: !(tienePermisos && permNormalizarRol(f.rol)),
        activo: tienePermisos ? Number(f.activo) !== 0 : true,
        avanzado: rol === 'avanzado' || rol === 'maestro',
        maestro: rol === 'maestro',
        bloques: permBloquesEfectivos(rol, ajustes, apagados),
        ajustes,
        alta: f.alta ? String(f.alta) : '',
        fila: Number(f.fila || 0) + 1,
        temporal: esAfirmativo(f.password_temporal),
        nivel: 0
      };
      p.nivel = permNivelUsuario(p);
      out.push(p);
    }
    return out;
  });
}

/** Mapa correo → persona, para consultas por clave. */
export async function consolaPersonasPorCorreo(ctx: Ctx): Promise<Map<string, Persona>> {
  const lista = await consolaPersonas(ctx);
  return new Map(lista.map((p) => [p.email, p]));
}

/** Orden alfabético en español (lo que en Apps Script era localeCompare(…, 'es')). */
export const COLADOR_ES = new Intl.Collator('es');

// ── Bitácora ────────────────────────────────────────────────────────────────

export interface FilaBitacora { fecha: string; quien: string; accion: string; objetivo: string; detalle: string }

type FilaBitacoraD1 = { fecha: string; quien: string | null; accion: string | null; objetivo: string | null; detalle: string | null };

function aFilaBitacora(f: FilaBitacoraD1): FilaBitacora {
  return { fecha: String(f.fecha || ''), quien: String(f.quien || ''), accion: String(f.accion || ''),
           objetivo: String(f.objetivo || ''), detalle: String(f.detalle || '') };
}

/**
 * consolaBitacoraFiltro_: el recorte jerárquico de la bitácora, en UNA sola función.
 *
 * Un supervisor ve su propio rastro y el de la gente a la que alcanza. No ve los cambios de ajustes,
 * módulos ni salud —no son suyos—, ni nada que le hayan hecho a alguien por encima de su nivel. La
 * bitácora sigue completa en la base: lo que se recorta es quién la lee. Los niveles se resuelven
 * una vez por consulta, no fila a fila.
 */
export async function consolaBitacoraFiltro(ctx: Ctx, quien: { email?: string; maestro?: boolean; rol?: string } | null): Promise<(r: FilaBitacora) => boolean> {
  const miNivel = permNivelUsuario(quien);
  const yo = (quien && quien.email) || '';
  const personas = await consolaPersonasPorCorreo(ctx);
  return (r: FilaBitacora) => {
    if (permMismoCorreo(r.quien, yo)) return true;
    if (!r.objetivo) return false;   // apunte del sistema, no de una persona
    const u = personas.get(String(r.objetivo).trim().toLowerCase());
    if (!u) return false;
    return u.nivel <= miNivel;
  };
}

/** consolaBitacoraLeer_: últimos movimientos, del más reciente al más viejo. */
export async function consolaBitacoraLeer(ctx: Ctx, limite: number, quien: UsuarioPermisos | null): Promise<FilaBitacora[]> {
  try {
    const esMaestro = !!(quien && quien.maestro === true);
    // Tope de lo que se puede pedir de una vez (en la hoja no hacía falta: leer era lo caro).
    const pedidos = Math.min(Math.max(1, Math.floor(limite) || CONSOLA_BITACORA_LIMITE), CONSOLA_BITACORA_TOPE_RANGO);
    // Al filtrar se leen MÁS filas de las pedidas, porque muchas se van a descartar: sin este margen
    // un supervisor cuyos apuntes están enterrados bajo cambios de un maestro veía la bitácora vacía.
    const aLeer = esMaestro ? pedidos : Math.min(pedidos * 6, CONSOLA_BITACORA_LIMITE * 4);
    const filas = (await ctx.todas<FilaBitacoraD1>(
      'SELECT fecha, quien, accion, objetivo, detalle FROM bitacora_consola ORDER BY id DESC LIMIT ?', aLeer))
      .map(aFilaBitacora);
    if (esMaestro) return filas.slice(0, pedidos);
    const visible = await consolaBitacoraFiltro(ctx, quien);
    return filas.filter(visible).slice(0, pedidos);
  } catch (e) {
    console.error('consolaBitacoraLeer', e);
    return [];
  }
}

/**
 * consolaBitacoraEnRango_: movimientos entre dos fechas, del más reciente al más viejo.
 * En la hoja se recorría la cola por lotes; en D1 el índice por fecha hace ese trabajo, y se
 * conservan los dos topes (filas devueltas y filas leídas) con sus avisos.
 */
export async function consolaBitacoraEnRango(ctx: Ctx, desde: Date, hasta: Date, quien: UsuarioPermisos | null):
  Promise<{ filas: FilaBitacora[]; truncado: boolean; leidas: number; sinLlegar: boolean }> {
  const esMaestro = !!(quien && quien.maestro === true);
  const visible = esMaestro ? () => true : await consolaBitacoraFiltro(ctx, quien);

  const crudas = await ctx.todas<FilaBitacoraD1>(
    'SELECT fecha, quien, accion, objetivo, detalle FROM bitacora_consola ' +
    'WHERE fecha >= ? AND fecha <= ? ORDER BY id DESC LIMIT ?',
    desde.toISOString(), hasta.toISOString(), CONSOLA_BITACORA_MAX_LEIDAS);

  // Si se llenó el techo de lectura, más atrás puede haber más: se dice, igual que en la hoja.
  let truncado = crudas.length >= CONSOLA_BITACORA_MAX_LEIDAS;
  const out: FilaBitacora[] = [];
  for (const c of crudas) {
    const cuando = aFecha(c.fecha);
    if (!cuando || cuando < desde || cuando > hasta) continue;
    const fila = aFilaBitacora(c);
    fila.fecha = cuando.toISOString();
    if (!visible(fila)) continue;
    if (out.length >= CONSOLA_BITACORA_TOPE_RANGO) { truncado = true; break; }
    out.push(fila);
  }
  return { filas: out, truncado, leidas: crudas.length, sinLlegar: truncado && out.length === 0 };
}

// ── Fechas ──────────────────────────────────────────────────────────────────

export type Rango = { ok: true; desde: Date; hasta: Date; error: '' } | { ok: false; error: string };

/**
 * consolaRangoFechas_: las dos fechas que manda la pantalla (yyyy-MM-dd de un <input type="date">)
 * como el DÍA COMPLETO en hora de México: «del 1 al 5» incluye todo el día 5.
 */
export function consolaRangoFechas(desde: unknown, hasta: unknown): Rango {
  const partes = (texto: unknown) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto == null ? '' : texto).trim());
    return m ? { a: Number(m[1]), me: Number(m[2]), d: Number(m[3]) } : null;
  };
  const a = partes(desde), b = partes(hasta);
  if (!a || !b) return { ok: false, error: 'Elige las dos fechas del rango.' };

  // El Worker está en UTC: la medianoche es la de México (fechaDesdeMx), no la del servidor.
  const ini = fechaDesdeMx(a.a, a.me, a.d, 0, 0, 0, 0);
  const fin = fechaDesdeMx(b.a, b.me, b.d, 23, 59, 59, 999);
  if (isNaN(ini.getTime()) || isNaN(fin.getTime())) return { ok: false, error: 'Esas fechas no son válidas.' };
  if (ini > fin) return { ok: false, error: 'La fecha de inicio es posterior a la de fin.' };
  return { ok: true, desde: ini, hasta: fin, error: '' };
}

/** Días enteros transcurridos desde una fecha ISO, o -1 si no se sabe. */
export function consolaDiasDesde(iso: unknown): number {
  const d = aFecha(iso);
  if (!d) return -1;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

// ── Correo: cuota y remitente de los correos a clientes ─────────────────────

/**
 * Cuánto correo queda hoy (MailApp.getRemainingDailyQuota). Gmail cuenta un correo por
 * destinatario; aquí se cuentan los destinatarios de lo que ya está en la bandeja de salida desde la
 * medianoche de México y se restan de CUOTA_CORREO_DIARIA. Memo por petición, como CONSOLA_CUOTA_MEMO.
 */
export function consolaCuotaCorreo(ctx: Ctx): Promise<number> {
  return ctx.memorizar('consola:cuota', async () => {
    try {
      const contar = (col: string) =>
        "(CASE WHEN COALESCE(" + col + ", '') <> '' THEN length(" + col + ") - length(replace(" + col + ", ',', '')) + 1 ELSE 0 END)";
      const fila = await ctx.una<{ n: number }>(
        'SELECT COALESCE(SUM(' + contar('para') + ' + ' + contar('cc') + ' + ' + contar('cco') + '), 0) AS n ' +
        'FROM correos_salida WHERE fecha >= ?', inicioDelDiaMx().toISOString());
      return Math.max(0, CUOTA_CORREO_DIARIA - Number((fila && fila.n) || 0));
    } catch (e) {
      console.error('consolaCuotaCorreo', e);
      return -1;
    }
  });
}

/** Respaldo de fábrica del nombre visible en los correos a clientes (CorreoCliente.gs). */
export const CC_SENDER_NAME_RESPALDO = 'Centro de Contacto Liverpool | Ventel';

/** ccSenderName_: nombre visible del remitente en los correos a clientes (ajuste CC_SENDER_NAME). */
export async function ccSenderName(ctx: Ctx): Promise<string> {
  return (await secConfig(ctx, 'CC_SENDER_NAME', CC_SENDER_NAME_RESPALDO)) || CC_SENDER_NAME_RESPALDO;
}

// ── Texto ───────────────────────────────────────────────────────────────────

/** monPlano_ / grpClaveNombre_: minúsculas, sin acentos, sin dobles espacios. */
export function plano(texto: unknown): string {
  return normalizarTexto(texto);
}

// ── Funciones de otros módulos ──────────────────────────────────────────────

/**
 * Una función que exporta otro módulo, si ya está portada. Es el `typeof fn === 'function'` con el
 * que los .gs se protegían de un archivo que faltaba: aquí protege de un módulo que otro agente
 * todavía no ha terminado, sin romper la compilación ni la pantalla.
 */
export function deModulo<F extends (...a: any[]) => any>(mod: unknown, nombre: string): F | null {
  const f = mod ? (mod as Record<string, unknown>)[nombre] : undefined;
  return typeof f === 'function' ? (f as F) : null;
}
