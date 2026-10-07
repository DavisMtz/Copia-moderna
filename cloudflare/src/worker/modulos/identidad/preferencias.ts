/**
 * PREFERENCIAS DE USUARIO | Portal Ventel en Cloudflare
 * =====================================================
 * Port de Preferencias.gs. La personalización de cada persona (tema, tamaño de texto, densidad,
 * accesos fijados, marco lateral…) vive en DOS sitios: localStorage, que es lo que se pinta antes
 * del primer fotograma, y la NUBE (tabla preferencias_usuario, la hoja «_PreferenciasUsuario»),
 * que es lo que hace que la personalización siga a la persona a otro equipo.
 *
 * UNA FILA POR PERSONA: {"v": valores, "t": sellos} en la columna `preferencias`. Cada campo viaja
 * con su marca de tiempo y la fusión es campo por campo: gana el más reciente de CADA UNO, así dos
 * pestañas que tocan cosas distintas no se pisan.
 *
 * Diferencias con Apps Script: sin CacheService (D1 contesta en milisegundos) y sin LockService:
 * el «leer-fusionar-escribir» se protege con la columna `version` (solo se escribe si nadie cambió
 * la fila desde que se leyó; si alguien lo hizo, se vuelve a fusionar sobre lo suyo).
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIdentidad } from '../../nucleo/seguridad';

/** Tope de tamaño del JSON de una persona. */
const PREFS_MAX_BYTES = 4000;

/** Vueltas de «leer-fusionar-escribir» antes de rendirse (solo con muchas pestañas a la vez). */
const PREFS_VUELTAS = 5;

interface CampoPref {
  clave: string;
  tipo: 'opcion' | 'bandera' | 'lista' | 'texto';
  valores?: string[];
  por: unknown;
  tope?: number;
}

// ── Catálogo de preferencias ────────────────────────────────────────────────
// Nada que no esté aquí se guarda: es la única defensa real de esta tabla. Sin una lista blanca se
// convertiría en almacenamiento gratis de cualquier cosa que alguien cuelgue de las preferencias.

export const PREFS_CAMPOS: CampoPref[] = [
  { clave: 'tema',        tipo: 'opcion',  valores: ['aurora', 'slate', 'carbon'], por: 'aurora' },
  { clave: 'densidad',    tipo: 'opcion',  valores: ['cozy', 'compact'],           por: 'cozy' },
  { clave: 'textscale',   tipo: 'opcion',  valores: ['sm', 'md', 'lg', 'xl'],      por: 'md' },
  { clave: 'contraste',   tipo: 'opcion',  valores: ['0', '1'],                    por: '0' },
  // Accesos fijados por la persona en su inicio. Son claves de pantalla o de sección, cortas.
  { clave: 'fijados',     tipo: 'lista',   tope: 12,                               por: [] },
  // Marco lateral recogido.
  { clave: 'menuPlegado', tipo: 'bandera',                                         por: false },
  // Pantalla a la que llevar al entrar. Se valida contra sus permisos AL USARLA, no aquí.
  { clave: 'inicio',      tipo: 'texto',   tope: 40,                               por: '' },
  // Onboarding: recorridos ya vistos, para no repetirlos en cada equipo nuevo.
  { clave: 'vistos',      tipo: 'lista',   tope: 24,                               por: [] }
];

const PREFS_INDICE_CAMPOS: Record<string, CampoPref> = Object.fromEntries(PREFS_CAMPOS.map((c) => [c.clave, c]));

type Valores = Record<string, unknown>;
type Sellos = Record<string, number>;

/** Valores por omisión, listos para mandar al cliente. */
export function prefsPorOmision(): Valores {
  const out: Valores = {};
  PREFS_CAMPOS.forEach((c) => {
    out[c.clave] = (c.tipo === 'lista') ? (c.por as unknown[]).slice() : c.por;
  });
  return out;
}

/**
 * Limpia lo que llega del cliente y devuelve solo lo válido. Se descarta en silencio en vez de
 * rechazar la llamada entera: un campo desconocido casi siempre es una pestaña con una versión
 * anterior de la app, y tumbar el guardado por eso la dejaría sin guardar NINGUNA preferencia.
 */
export function prefsValidar(crudo: unknown): Valores {
  const out: Valores = {};
  if (!crudo || typeof crudo !== 'object') return out;
  const entrada = crudo as Record<string, unknown>;

  Object.keys(entrada).forEach((clave) => {
    if (!Object.prototype.hasOwnProperty.call(PREFS_INDICE_CAMPOS, clave)) return;
    const def = PREFS_INDICE_CAMPOS[clave];
    const v = entrada[clave];

    if (def.tipo === 'opcion') {
      const s = String(v == null ? '' : v);
      if ((def.valores || []).indexOf(s) !== -1) out[clave] = s;

    } else if (def.tipo === 'bandera') {
      out[clave] = (v === true || v === 'true' || v === 1 || v === '1');

    } else if (def.tipo === 'texto') {
      out[clave] = String(v == null ? '' : v).trim().slice(0, def.tope || 60);

    } else if (def.tipo === 'lista') {
      if (!Array.isArray(v)) return;
      const vistos: Record<string, boolean> = {};
      const lista: string[] = [];
      v.forEach((x) => {
        // Cada elemento es una clave corta, no texto libre: 60 caracteres y sin duplicados.
        const s = String(x == null ? '' : x).trim().slice(0, 60);
        if (!s || vistos[s]) return;
        vistos[s] = true;
        if (lista.length < (def.tope || 20)) lista.push(s);
      });
      out[clave] = lista;
    }
  });

  return out;
}

/**
 * Interpreta la columna. Nunca lanza: una fila corrupta degrada a «esta persona no tiene
 * preferencias», un estado del que la app sabe salir sola.
 */
function prefsParsear(texto: unknown): { valores: Valores; sellos: Sellos } {
  const vacio = { valores: {}, sellos: {} };
  if (!texto) return vacio;
  try {
    const o = JSON.parse(String(texto));
    if (!o || typeof o !== 'object') return vacio;
    return {
      valores: prefsValidar(o.v || {}),
      sellos: (o.t && typeof o.t === 'object') ? o.t : {}
    };
  } catch {
    return vacio;
  }
}

function prefsSerializar(valores: Valores, sellos: Sellos): string {
  return JSON.stringify({ v: valores, t: sellos });
}

/** Fila de una persona: { valores, sellos, version } o null si no tiene. */
async function prefsLeerFila(ctx: Ctx, correo: string): Promise<{ valores: Valores; sellos: Sellos; version: number } | null> {
  const objetivo = String(correo || '').trim().toLowerCase();
  if (!objetivo) return null;
  const fila = await ctx.una<{ preferencias: string; version: number }>(
    'SELECT preferencias, version FROM preferencias_usuario WHERE email = ?', objetivo);
  if (!fila) return null;
  const guardado = prefsParsear(fila.preferencias);
  return { valores: guardado.valores, sellos: guardado.sellos, version: Number(fila.version) || 0 };
}

/** Juego completo: los valores por omisión con lo guardado encima. */
function prefsCompletas(valores: Valores): Valores {
  const prefs = prefsPorOmision();
  Object.keys(valores || {}).forEach((k) => { prefs[k] = valores[k]; });
  return prefs;
}

// ── Lectura ─────────────────────────────────────────────────────────────────

/**
 * Preferencias de quien está en sesión, con los valores por omisión ya aplicados. El cliente
 * recibe SIEMPRE el juego completo y el catálogo, generado desde aquí en cada carga.
 */
export async function prefsLeer(ctx: Ctx, email: string) {
  try {
    const id = await secIdentidad(ctx, email);
    if (!id.ok) return { success: false, message: id.error || 'Tu sesión no es válida.' };

    const fila = await prefsLeerFila(ctx, id.email);
    const guardado = fila || { valores: {}, sellos: {}, version: 0 };

    return {
      success: true,
      prefs: prefsCompletas(guardado.valores),
      sellos: guardado.sellos || {},
      version: guardado.version || 0,
      campos: PREFS_CAMPOS.map((c) => ({
        clave: c.clave, tipo: c.tipo, valores: c.valores || null,
        por: (c.tipo === 'lista') ? (c.por as unknown[]).slice() : c.por, tope: c.tope || 0
      }))
    };
  } catch (e) {
    console.error('prefsLeer', e);
    return { success: false, message: 'No pudimos leer tus preferencias.' };
  }
}

// ── Escritura ───────────────────────────────────────────────────────────────

/**
 * Guarda un puñado de preferencias. Fusiona campo por campo con lo que ya hay.
 * @param cambios { clave: valor, ... } — solo lo que cambió.
 * @param sellos  { clave: msDesdeEpoch } — cuándo se tocó cada campo EN EL CLIENTE.
 */
export async function prefsGuardar(ctx: Ctx, email: string, cambios: unknown, sellos?: Record<string, unknown>) {
  try {
    const id = await secIdentidad(ctx, email);
    if (!id.ok) return { success: false, message: id.error || 'Tu sesión no es válida.' };

    const limpios = prefsValidar(cambios);
    if (!Object.keys(limpios).length) {
      return { success: false, message: 'No había ninguna preferencia válida que guardar.' };
    }

    const ahora = Date.now();
    const sellosNuevos: Sellos = {};
    Object.keys(limpios).forEach((k) => {
      const s = Number(sellos && sellos[k]);
      // Un sello del futuro (reloj mal puesto) dejaría ese cambio ganando para siempre: se acota
      // al reloj del servidor, el único en el que se puede confiar aquí.
      sellosNuevos[k] = (s && s > 0 && s <= ahora) ? s : ahora;
    });

    // LockService → comparar-y-cambiar sobre `version`.
    for (let vuelta = 0; vuelta < PREFS_VUELTAS; vuelta++) {
      const actual = await prefsLeerFila(ctx, id.email);
      const valores: Valores = Object.assign({}, actual ? actual.valores : {});
      const sellosViejos: Sellos = Object.assign({}, actual ? actual.sellos : {});

      Object.keys(limpios).forEach((k) => {
        const anterior = Number(sellosViejos[k]) || 0;
        // Solo se pisa si este cambio es MÁS NUEVO que el que ya estaba: un reintento que llega
        // tarde no debe deshacer algo que la persona cambió después.
        if (sellosNuevos[k] >= anterior) {
          valores[k] = limpios[k];
          sellosViejos[k] = sellosNuevos[k];
        }
      });

      const texto = prefsSerializar(valores, sellosViejos);
      if (texto.length > PREFS_MAX_BYTES) {
        return { success: false, message: 'Tus preferencias ocupan demasiado. Quita algún acceso fijado.' };
      }

      const version = (actual ? actual.version : 0) + 1;
      const r = actual
        ? await ctx.ejecutar(
            'UPDATE preferencias_usuario SET preferencias = ?, version = ?, actualizado = ? WHERE email = ? AND version = ?',
            texto, version, ctx.ahoraIso(), id.email, actual.version)
        : await ctx.ejecutar(
            'INSERT INTO preferencias_usuario (email, preferencias, version, actualizado) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT(email) DO NOTHING',
            id.email, texto, version, ctx.ahoraIso());
      if (!r.cambios) continue;   // otra pestaña escribió en medio: se fusiona otra vez sobre lo suyo

      // Se devuelve el juego COMPLETO ya fusionado: la confirmación del guardado es también la
      // sincronización con lo que hubieran cambiado otras pestañas.
      return { success: true, prefs: prefsCompletas(valores), sellos: sellosViejos, version };
    }
    return { success: false, message: 'El sistema está ocupado. Vuelve a intentarlo.' };
  } catch (e) {
    console.error('prefsGuardar', e);
    return { success: false, message: 'No pudimos guardar tus preferencias.' };
  }
}

/**
 * Devuelve las preferencias a su estado de fábrica. La fila se deja con el JSON vacío en vez de
 * borrarla: conserva (y sube) la versión, y así una pestaña con datos viejos ve que hay algo MÁS
 * NUEVO que lo suyo y adopta el restablecimiento.
 */
export async function prefsRestablecer(ctx: Ctx, email: string) {
  try {
    const id = await secIdentidad(ctx, email);
    if (!id.ok) return { success: false, message: id.error || 'Tu sesión no es válida.' };

    // Un solo UPDATE atómico: no hace falta candado.
    const fila = await ctx.una<{ version: number }>(
      'UPDATE preferencias_usuario SET preferencias = ?, version = version + 1, actualizado = ? WHERE email = ? RETURNING version',
      prefsSerializar({}, {}), ctx.ahoraIso(), id.email);
    if (fila) return { success: true, prefs: prefsPorOmision(), sellos: {}, version: Number(fila.version) || 0 };
    return { success: true, prefs: prefsPorOmision(), sellos: {}, version: 0 };
  } catch (e) {
    console.error('prefsRestablecer', e);
    return { success: false, message: 'No pudimos restablecer tus preferencias.' };
  }
}
