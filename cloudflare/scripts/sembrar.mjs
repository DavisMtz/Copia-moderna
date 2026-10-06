#!/usr/bin/env node
/**
 * Semillas de la demo | Portal Ventel en Cloudflare
 * =================================================
 * Genera, dentro de cloudflare/semilla/:
 *
 *   · 10_demo.sql                   TODO FICTICIO (va a git): cotizaciones, métricas, operación,
 *                                   atenciones, artículos, anuncios, grupos, bitácora, onboarding…
 *   · 20_catalogo_portal.local.sql  El catálogo REAL de la hoja «Portal Ventel» (NO va a git: el
 *                                   repo es público). Sale de semilla/portal_ventel.json.
 *
 * Uso (desde cloudflare/):
 *     node scripts/sembrar.mjs                       genera los dos archivos
 *     node scripts/sembrar.mjs --solo=demo           solo 10_demo.sql
 *     node scripts/sembrar.mjs --solo=catalogo       solo 20_catalogo_portal.local.sql
 *     node scripts/sembrar.mjs --ahora=2026-10-06T14:00   fija «ahora» (hora de México si no lleva zona)
 *
 * Node puro, sin dependencias, y DETERMINISTA: cada sección usa su propio generador pseudoaleatorio
 * con semilla fija, así que regenerar con el mismo «ahora» da exactamente los mismos archivos. Las
 * fechas son RELATIVAS a «ahora» (por omisión, la hora en punto más reciente, en hora de México):
 * las cotizaciones llegan hasta hoy, la incidencia «abierta» sigue abierta, etc.
 *
 * DE DÓNDE SALE CADA FORMA (regla de la semilla: nada se inventa, se copia lo que escribe el .gs):
 *   cotizaciones / detalle   Code.gs (saveQuoteDataToSheets, generateLvpFolio) y la fórmula de importes
 *                            de cotizacion.html (calculateRow) / AuditoriaCotizacion.gs (audCalcularLinea_)
 *   estatus y revisión       Revision.gs (REV_ESTATUS_*, revChecklistTexto_), PoliticaRevision.gs,
 *                            app_estatus.html y el motor AuditoriaCotizacion.gs (se porta aquí para
 *                            que el texto de «RevisionChecklist» sea el que escribiría la revisión)
 *   métricas de correo       Metricas.gs, Correos.gs, CorreoCliente.gs, Difusion.gs
 *   búsquedas                Monitoreo.gs (monRegistrarBusqueda_)
 *   operación                Operacion.gs (catálogo base, opReportar, umbrales, estados)
 *   atenciones               Atenciones.gs (atenId_, tipos, reserva de 15 min)
 *   artículos / anuncios     Articulos.gs (bloques), Publicaciones.gs y anuncios.html (buildDatos)
 *   grupos / bitácora        Grupos.gs, Consola.gs (consolaBitacoraApuntar_ y sus llamadores)
 *   onboarding / prefs       Onboarding.gs (onbMarcar), Preferencias.gs ({v, t})
 *   catálogo del Portal      PortalContenido.gs (PC_COLECCIONES, pcMapaColumnas_) y Portal.gs
 *
 * Los productos reales (nombres, SKUs, precios, fotos) salen de pruebas/ext_*.json y
 * pruebas/ext_lector_*.html; lo que esos archivos no traen (pantallas, muebles, colchones…) se
 * completa con nombres genéricos, SKU de 10 dígitos y sin imagen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');               // cloudflare/
const REPO = path.resolve(RAIZ, '..');
const DIR_SEMILLA = path.join(RAIZ, 'semilla');
const DIR_PRUEBAS = path.join(REPO, 'pruebas');

const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const SOLO = ARGS.solo === 'demo' || ARGS.solo === 'catalogo' ? ARGS.solo : '';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// UTILIDADES · azar con semilla, hora de México, SQL
// ══════════════════════════════════════════════════════════════════════════════════════════════

function mulberry32(semilla) {
  let a = semilla >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashTexto(texto) {                      // FNV-1a
  let h = 2166136261;
  for (const c of String(texto)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Un generador por sección: tocar una sección no cambia lo que sale en las demás. */
class Azar {
  constructor(nombre) { this._f = mulberry32(hashTexto('ventel-demo-1|' + nombre)); }
  num() { return this._f(); }
  entero(a, b) { return a + Math.floor(this._f() * (b - a + 1)); }         // inclusivo
  entre(a, b) { return a + this._f() * (b - a); }
  prob(p) { return this._f() < p; }
  elegir(lista) { return lista[Math.floor(this._f() * lista.length)]; }
  pesos(lista, peso) {
    let total = 0;
    const ps = lista.map((x) => { const p = Math.max(0, peso(x)); total += p; return p; });
    let r = this._f() * total;
    for (let i = 0; i < lista.length; i++) { r -= ps[i]; if (r < 0) return lista[i]; }
    return lista[lista.length - 1];
  }
  barajar(lista) {
    const a = lista.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this._f() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  normal() { const u = Math.max(this._f(), 1e-12), v = this._f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  logn(mediana, sigma) { return mediana * Math.exp(sigma * this.normal()); }
  hex(n) { let s = ''; while (s.length < n) s += Math.floor(this._f() * 16).toString(16); return s; }
  base36(n) { let s = ''; while (s.length < n) s += Math.floor(this._f() * 36).toString(36); return s; }
}

// ── Hora de México (America/Mexico_City; sin horario de verano desde 2022) ────────────────────
const ZONA = 'America/Mexico_City';
const FMT_MX = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
});
const DIAS_CORTOS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const dos = (n) => String(n).padStart(2, '0');

function partesMx(d) {
  const p = {};
  for (const x of FMT_MX.formatToParts(d)) p[x.type] = x.value;
  const anio = +p.year, mes = +p.month, dia = +p.day, hora = +p.hour % 24, minuto = +p.minute, segundo = +p.second;
  const comoUtc = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo);
  const desfaseMin = Math.round((comoUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  return { anio, mes, dia, hora, minuto, segundo, diaSemana: DIAS_CORTOS_EN.indexOf(p.weekday), desfaseMin };
}

/** La fecha que corresponde a esa hora LOCAL de México (mes 1–12; el día puede desbordar). */
function fechaMx(anio, mes, dia, hora = 0, minuto = 0, segundo = 0, ms = 0) {
  const sup = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo, ms);
  let t = sup - partesMx(new Date(sup)).desfaseMin * 60000;
  t = sup - partesMx(new Date(t)).desfaseMin * 60000;
  return new Date(t);
}

/** '2026-10-10T23:59:59' (hora de México, sin zona) o ISO con zona → Date. */
function aFechaMx(v) {
  if (v instanceof Date) return v;
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
  if (!m) { const d = new Date(s); return isNaN(d) ? null : d; }
  return fechaMx(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +((m[7] || '0').padEnd(3, '0')));
}

/** «Ahora»: --ahora=…, o la hora en punto más reciente (así dos corridas de la misma hora coinciden). */
function resolverAhora() {
  if (ARGS.ahora && ARGS.ahora !== true) {
    const d = aFechaMx(ARGS.ahora);
    if (!d) throw new Error('--ahora no es una fecha válida: ' + ARGS.ahora);
    return d;
  }
  const n = new Date();
  n.setUTCMinutes(0, 0, 0);
  return n;
}
const AHORA = resolverAhora();
const MS_MIN = 60000, MS_HORA = 3600000, MS_DIA = 86400000;
const haceMin = (n) => new Date(AHORA.getTime() - n * MS_MIN);

/** Un día de México, `n` días antes (negativo) o después de la fecha de `base`. */
function diaMx(base, n = 0) {
  const p = partesMx(base);
  const u = new Date(Date.UTC(p.anio, p.mes - 1, p.dia + n));
  return { anio: u.getUTCFullYear(), mes: u.getUTCMonth() + 1, dia: u.getUTCDate(), diaSemana: u.getUTCDay() };
}
const aammdd = (d) => String(d.anio).slice(-2) + dos(d.mes) + dos(d.dia);
const ymd = (d) => `${d.anio}-${dos(d.mes)}-${dos(d.dia)}`;
const enDia = (d, h = 0, mi = 0, s = 0, ms = 0) => fechaMx(d.anio, d.mes, d.dia, h, mi, s, ms);
const mismoDiaMx = (a, b) => { const x = partesMx(a), y = partesMx(b); return x.anio === y.anio && x.mes === y.mes && x.dia === y.dia; };
const diasEntre = (a, b) => Math.round((Date.UTC(partesMx(b).anio, partesMx(b).mes - 1, partesMx(b).dia) -
  Date.UTC(partesMx(a).anio, partesMx(a).mes - 1, partesMx(a).dia)) / MS_DIA);
const HOY = diaMx(AHORA, 0);
const iso = (d) => d.toISOString();
const horaMx = (d) => { const p = partesMx(d); return p.hora + p.minuto / 60; };

/** Instante aleatorio dentro de [a, b] (Date). */
const entreFechas = (az, a, b) => new Date(a.getTime() + Math.floor(az.num() * Math.max(0, b.getTime() - a.getTime())));

/**
 * Empuja un instante a las horas en que la gente trabaja (por omisión 9:00–20:59, todos los días):
 * lo que cae de noche pasa a la mañana siguiente. Nunca devuelve algo posterior a `tope`.
 */
function aHorarioLaboral(az, fecha, { desde = 9, hasta = 21 } = {}) {
  let p = partesMx(fecha);
  let d = fecha;
  if (p.hora < desde) d = fechaMx(p.anio, p.mes, p.dia, desde, az.entero(0, 40), az.entero(0, 59), az.entero(0, 999));
  else if (p.hora >= hasta) { const s = diaMx(fecha, 1); d = fechaMx(s.anio, s.mes, s.dia, desde, az.entero(0, 55), az.entero(0, 59), az.entero(0, 999)); }
  return d;
}

// ── Redondeos y texto ─────────────────────────────────────────────────────────────────────────
const r2 = (n) => Math.round((Number(n) || 0) * 100 + (n >= 0 ? 1e-9 : -1e-9)) / 100;
const sinAcentos = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const minusculaPlana = (s) => sinAcentos(s).toLowerCase().trim();
const capitalizar = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const dinero = (n) => '$' + r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);

// ── SQL ───────────────────────────────────────────────────────────────────────────────────────
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Date) return "'" + v.toISOString() + "'";
  if (typeof v === 'object') return lit(JSON.stringify(v));
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/** El esquema de 0001_esquema.sql: nombre de tabla → columnas. Es la red de seguridad del script. */
function leerEsquema() {
  const sql = fs.readFileSync(path.join(RAIZ, 'migrations', '0001_esquema.sql'), 'utf8');
  const tablas = {};
  const re = /CREATE TABLE\s+(\w+)\s*\(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(sql))) {
    const cols = [];
    for (const lineaCruda of m[2].split('\n')) {
      const linea = lineaCruda.trim();
      if (!linea || linea.startsWith('--') || /^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(linea)) continue;
      cols.push(linea.split(/\s+/)[0]);
    }
    tablas[m[1]] = cols;
  }
  return tablas;
}
const ESQUEMA = leerEsquema();

/** Acumula sentencias de UN archivo y cuenta las filas por tabla. Rechaza tablas o columnas ajenas. */
class Salida {
  constructor(archivo, encabezado) {
    this.archivo = archivo;
    this.lineas = encabezado.map((l) => '-- ' + l);
    this.conteo = {};
  }
  seccion(titulo, detalle) {
    this.lineas.push('', '-- ' + '═'.repeat(94), '-- ' + titulo);
    if (detalle) for (const l of [].concat(detalle)) this.lineas.push('-- ' + l);
  }
  nota(texto) { this.lineas.push('-- ' + texto); }
  fila(tabla, obj, modo = 'INSERT OR REPLACE') {
    const cols = Object.keys(obj);
    const esquema = ESQUEMA[tabla];
    if (!esquema) throw new Error(`La tabla «${tabla}» no existe en 0001_esquema.sql.`);
    for (const c of cols) if (!esquema.includes(c)) throw new Error(`La columna «${tabla}.${c}» no existe en 0001_esquema.sql.`);
    this.lineas.push(`${modo} INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map((c) => lit(obj[c])).join(', ')});`);
    this.conteo[tabla] = (this.conteo[tabla] || 0) + 1;
  }
  texto() { return this.lineas.join('\n') + '\n'; }
}

/** Ids como los de la hoja: prefijo + reloj en base 36 + sufijo al azar. */
const idConReloj = (az, prefijo, fecha, largo = 4) => prefijo + '-' + fecha.getTime().toString(36) + az.base36(largo);
