/**
 * PORTAL · promociones | Portal Ventel en Cloudflare
 * ==================================================
 * Port de la parte de promociones de Portal.gs (fetchApplicationData, fetchPromoCounts, pdpDatos),
 * de VentaCruzada.gs (ventaCruzadaPromos) y del analizador de vigencias que comparten.
 *
 * Las promociones salen de las tablas portal_promociones y portal_mkp (las pestañas «Promociones»
 * y «MKP» de la hoja del Portal). El calendario comercial venía de Google Calendar: aquí no hay
 * Calendar, así que `eventos` va vacío (decisión del proyecto: lo que viene de Google, en blanco).
 *
 * Todas son públicas y sin sesión, como en Apps Script: son las promociones que ya enseña el Monitor.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secConfig } from '../../nucleo/seguridad';
import { fechaDesdeMx, partesMx } from '../../nucleo/fechas';
import { DIA_MS, textoError } from './comun';

// ── El analizador de vigencias (parseVigencia_ y monthIdx_, tal cual) ───────

export interface Rango { start: Date; end: Date }

/** Índice del mes (0–11) por su prefijo en español ('sept' → 8, 'Octubre' → 9), o undefined. */
export function monthIdx(name: unknown): number | undefined {
  if (!name) return undefined;
  const pref = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const n = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (let i = 0; i < 12; i++) if (n.indexOf(pref[i]) === 0) return i;
  return undefined;
}

/**
 * Mismo formato de vigencia que interpreta Promociones.html («3 al 15 de junio», «10 de mayo»…).
 * Es parseVigencia_ letra por letra; lo único que cambia es CÓMO se construyen las fechas: en Apps
 * Script `new Date(año, mes, día)` era hora de México (zona del proyecto) y el Worker está en UTC,
 * así que aquí se arman con fechaDesdeMx. El año es el de hoy en México.
 */
export function parseVigencia(vigenciaStr: unknown, now: Date): Rango | null {
  if (!vigenciaStr) return null;
  const s = String(vigenciaStr).toLowerCase();
  const year = partesMx(now).anio;

  let m = s.match(/(\d{1,2})\s*(?:de\s+)?([a-záéíóú]+)?\s*(?:al?|hasta(?:\s+el)?|[-–—])\s*(\d{1,2})\s*(?:de\s+)?([a-záéíóú]+)/i);
  if (m) {
    const d1 = parseInt(m[1], 10), d2 = parseInt(m[3], 10);
    let mi2 = monthIdx(m[4]), mi1 = monthIdx(m[2]);
    if (mi2 === undefined && mi1 !== undefined) mi2 = mi1;
    if (mi1 === undefined && mi2 !== undefined) mi1 = (d1 <= d2) ? mi2 : (mi2 + 11) % 12;
    if (mi1 !== undefined && mi2 !== undefined) {
      const y2 = (mi2 < mi1) ? year + 1 : year;
      return { start: fechaDesdeMx(year, mi1 + 1, d1, 0, 0, 0), end: fechaDesdeMx(y2, mi2 + 1, d2, 23, 59, 59) };
    }
  }
  m = s.match(/(\d{1,2})\s*(?:de\s+)?([a-záéíóú]+)/i);
  if (m) {
    const mi = monthIdx(m[2]);
    if (mi !== undefined) {
      const d = parseInt(m[1], 10);
      return { start: fechaDesdeMx(year, mi + 1, d, 0, 0, 0), end: fechaDesdeMx(year, mi + 1, d, 23, 59, 59) };
    }
  }
  return null;
}

// ── fetchApplicationData (Promociones.html) ─────────────────────────────────

export interface PromoMonitor {
  origen: string; direccion: any; categoria: any; promocion: any; marca: any; vigencia: any; liga: any;
}

export interface DatosMonitor {
  promociones: PromoMonitor[]; eventos: any[]; status: string; error: string | null;
}

/** Promociones (tienda y Marketplace, en el orden de la hoja) y calendario comercial. */
export async function fetchApplicationData(ctx: Ctx): Promise<DatosMonitor> {
  const response: DatosMonitor = { promociones: [], eventos: [], status: 'success', error: null };
  try {
    const [pro, mkp] = await ctx.lote([
      ['SELECT direccion, categoria, promocion, desc_mkp, marca, vigencia, liga FROM portal_promociones ORDER BY orden, rowid'],
      ['SELECT direccion, categoria, promocion, promocion_mkt, vigencia, liga FROM portal_mkp ORDER BY orden, rowid']
    ]);

    // Hoja: Promociones. «Promoción 2026» manda; si está vacía, el texto de «Desc Mkp».
    for (const r of pro.filas) {
      if (!r.direccion && !r.categoria) continue;
      response.promociones.push({
        origen: 'Promociones',
        direccion: r.direccion || '',
        categoria: r.categoria || '',
        promocion: r.promocion || r.desc_mkp || '',
        marca: r.marca == null ? '' : r.marca,
        vigencia: r.vigencia || '',
        liga: r.liga || '#'
      });
    }

    // Hoja: MKP. «Promoción mktplace» es la que se publica; «Promoción» es el respaldo.
    for (const r of mkp.filas) {
      if (!r.direccion && !r.categoria) continue;
      response.promociones.push({
        origen: 'Marketplace',
        direccion: r.direccion || '',
        categoria: r.categoria || '',
        promocion: r.promocion_mkt || r.promocion || '',
        marca: 'Marketplace',
        vigencia: r.vigencia || '',
        liga: r.liga || '#'
      });
    }

    // Google Calendar (eventos comerciales a 90 días): no existe en esta versión → lista vacía.
    response.eventos = [];
  } catch (error) {
    response.status = 'error';
    response.error = textoError(error);
    console.error('fetchApplicationData', error);
  }
  return response;
}

// ── fetchPromoCounts (portada del Portal) ───────────────────────────────────

/** Cuántas promociones vigentes viajan a la portada (las que terminan antes, primero). */
const PROMO_PORTADA_TOPE = 8;

export interface Vigente {
  direccion: string; categoria: string; promocion: string; marca: string; origen: string; vigencia: string;
  fin: number; dias: number;
}

/**
 * Las promociones del Monitor vigentes en `now`, EN EL ORDEN DE LA HOJA (Promociones y luego MKP),
 * con su fin y los días que les quedan (portalVigentes_). El orden importa: «la más fuerte» de la
 * venta cruzada desempata por la primera.
 */
export function portalVigentes(data: { promociones?: PromoMonitor[] }, now: Date): Vigente[] {
  const vigentes: Vigente[] = [];
  (data.promociones || []).forEach((p) => {
    const r = parseVigencia(p.vigencia, now);
    if (r && now >= r.start && now <= r.end) {
      vigentes.push({
        direccion: String(p.direccion || '').trim(),
        categoria: String(p.categoria || '').trim(),
        promocion: String(p.promocion || '').trim(),
        marca: String(p.marca || '').trim(),
        origen: String(p.origen || ''),
        vigencia: String(p.vigencia || ''),
        fin: r.end.getTime(),
        // 0 = termina hoy, 1 = mañana… (el fin es a las 23:59:59 de su último día)
        dias: Math.floor((r.end.getTime() - now.getTime()) / DIA_MS)
      });
    }
  });
  return vigentes;
}

/** Lo que calcula fetchPromoCounts sobre los datos del Monitor (portalContarPromos_). */
export function portalContarPromos(data: { promociones?: PromoMonitor[]; eventos?: any[] }) {
  const now = new Date();
  const vigentes = portalVigentes(data, now);
  const activas = vigentes.length;
  const porTerminar = vigentes.filter((v) => (v.fin - now.getTime()) / DIA_MS <= 3).length;
  vigentes.sort((a, b) => a.fin - b.fin);

  const desde = now.getTime() - DIA_MS, hasta = now.getTime() + 28 * DIA_MS;
  const eventos = (data.eventos || [])
    .filter((e) => e && e.fin >= desde && e.inicio <= hasta)
    .sort((a, b) => a.inicio - b.inicio)
    .slice(0, 10)
    .map((e) => ({
      titulo: String(e.titulo || ''),
      inicio: e.inicio,
      fin: e.fin,
      esTodoElDia: !!e.esTodoElDia,
      descripcion: String(e.descripcion || '').slice(0, 240)
    }));

  return {
    status: 'ok', activas, porTerminar,
    promociones: vigentes.slice(0, PROMO_PORTADA_TOPE),
    eventos
  };
}

/** Widget «Hoy en promociones» de la portada: contadores, vigentes y calendario. */
export async function fetchPromoCounts(ctx: Ctx) {
  try {
    return portalContarPromos(await fetchApplicationData(ctx));
  } catch (error) {
    return { status: 'error', error: textoError(error), activas: 0, porTerminar: 0 };
  }
}

// ── pdpDatos (Planes de pago, «Pago Web») ───────────────────────────────────

/**
 * Lo que la consola de planes de pago no saca de la tabla PdePago:
 *   · factores: la tabla de «Pagos Fijos 3.0» salía de la hoja del simulador (Google Sheets). Aquí
 *     no se puede abrir → null, igual que cuando la hoja fallaba: el cliente usa su copia del
 *     30/06/2026 y lo dice junto a la cifra.
 *   · promos: las vigentes y las que empiezan en los próximos 14 días con MSI, «pague en…» o pagos fijos.
 */
export async function pdpDatos(ctx: Ctx) {
  const out: Record<string, unknown> = { status: 'ok', factores: null, promos: [] };
  out.factoresError = 'Esta versión no abre la hoja del simulador «Pagos Fijos 3.0» (Google Sheets): se usa la copia del 30/06/2026.';
  try { out.promos = await pdpPromos(ctx); } catch (e: any) { out.promosError = String((e && e.message) || e).slice(0, 200); }
  return out;
}

async function pdpPromos(ctx: Ctx) {
  const now = new Date();
  const re = /\d+\s*msi|meses sin inter|pag(?:ue|a|ar)?\s+(?:en|hasta)\s+[a-z]|mensualidad|pagos fijos/i;
  const out: any[] = [];
  const data = await fetchApplicationData(ctx);
  (data.promociones || []).forEach((p) => {
    const txt = String(p.promocion || '').trim();
    if (!txt || !re.test(txt)) return;
    const r = parseVigencia(p.vigencia, now);
    if (!r) return;
    const vigente = now >= r.start && now <= r.end;
    const empieza = r.start > now ? Math.ceil((r.start.getTime() - now.getTime()) / DIA_MS) : 0;
    if (!vigente && !(empieza > 0 && empieza <= 14)) return;
    out.push({
      direccion: String(p.direccion || '').trim(),
      categoria: String(p.categoria || '').trim(),
      promocion: txt,
      marca: String(p.marca || '').trim(),
      vigencia: String(p.vigencia || ''),
      inicio: r.start.getTime(),
      fin: r.end.getTime(),
      dias: Math.floor((r.end.getTime() - now.getTime()) / DIA_MS),
      empieza: vigente ? 0 : empieza
    });
  });
  out.sort((a, b) => a.inicio - b.inicio || a.fin - b.fin);
  return out.slice(0, 200);
}

// ── ventaCruzadaPromos (VentaCruzada.gs: la extensión de Chrome) ────────────

/** Cuántas promociones viajan: las de mayor porcentaje. */
const VC_TOPE_PROMOS = 120;
/** Tope del texto de cada promoción. */
const VC_TOPE_TEXTO = 140;

/** El porcentaje más alto de un texto. Es pctDe de app_monitor.html, letra por letra. */
export function vcPctDe(t: unknown): number {
  const n = (String(t || '').match(/(?<![\d.,])\d{1,3}(?=\s*%)/g) || []).map((x) => parseInt(x, 10));
  return n.length ? Math.max(...n) : 0;
}

/** Los meses sin intereses de un texto: N, 1 si dice «MSI» sin cifra, o 0. */
export function vcMsiDe(t: unknown): number {
  const m = String(t || '').match(/(\d{1,2})\s*msi/i);
  if (m) return parseInt(m[1], 10);
  return /\bmsi\b/i.test(String(t || '')) ? 1 : 0;
}

function vcRecorta(s: unknown, n: number): string {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trim() + '…' : t;
}

/** Una promoción vigente, con nombres de una letra: viajan 120 y la extensión las guarda. */
function vcCorta(v: Vigente) {
  return {
    d: vcRecorta(v.direccion, 60),
    c: vcRecorta(v.categoria, 80),
    t: vcRecorta(v.promocion, VC_TOPE_TEXTO),
    p: vcPctDe(v.promocion),
    m: vcMsiDe(v.promocion),
    f: v.fin,
    k: v.origen === 'Marketplace' ? 'mkp' : ''
  };
}

/** Ajustes que obedece la extensión: `busqueda` se apaga con la propiedad VC_BUSQUEDA_EN_VIVO = no. */
async function vcAjustes(ctx: Ctx) {
  let busqueda = true;
  try { busqueda = String(await secConfig(ctx, 'VC_BUSQUEDA_EN_VIVO', 'si')).trim().toLowerCase() !== 'no'; } catch { /* encendida */ }
  return { busqueda };
}

/** El paquete para la extensión sobre los datos del Monitor (vcPaqueteDesde_). */
export async function vcPaqueteDesde(ctx: Ctx, data: { promociones?: PromoMonitor[] }, now: Date) {
  const vigentes = portalVigentes(data || {}, now);
  let fuerte: { v: Vigente; pct: number } | null = null;
  vigentes.forEach((v) => {
    const x = vcPctDe(v.promocion);
    if (!fuerte || x > fuerte.pct) fuerte = { v, pct: x };
  });
  const promos = vigentes.map(vcCorta).sort((a, b) => b.p - a.p).slice(0, VC_TOPE_PROMOS);
  const f = fuerte as { v: Vigente; pct: number } | null;
  return {
    status: 'ok',
    v: 1,
    generado: now.getTime(),
    fuerte: f && f.pct ? vcCorta(f.v) : null,
    promos,
    ajustes: await vcAjustes(ctx)
  };
}

/** Lo que pide la portada para la extensión. Nunca lanza. */
export async function ventaCruzadaPromos(ctx: Ctx) {
  try {
    const data = await fetchApplicationData(ctx);
    if (!data || data.status === 'error') {
      return { status: 'error', error: 'No se pudieron leer las promociones del Monitor.' };
    }
    return await vcPaqueteDesde(ctx, data, new Date());
  } catch (e) {
    console.error('ventaCruzadaPromos', e);
    return { status: 'error', error: 'No se pudieron leer las promociones del Monitor.' };
  }
}
