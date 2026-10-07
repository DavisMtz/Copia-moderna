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
import { createRequire } from 'node:module';

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
  // Columnas que añaden las migraciones posteriores a tablas de 0001 (p. ej. 0009: estado, proveedor_id y detalle de correos_salida).
  const carpeta = path.join(RAIZ, 'migrations');
  for (const f of fs.readdirSync(carpeta).filter((x) => x.endsWith('.sql') && !x.startsWith('0001_')).sort()) {
    const extra = fs.readFileSync(path.join(carpeta, f), 'utf8');
    const alter = /ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/gi;
    let a;
    while ((a = alter.exec(extra))) if (tablas[a[1]] && !tablas[a[1]].includes(a[2])) tablas[a[1]].push(a[2]);
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
  /** Una sentencia tal cual (DELETE de limpieza…). Solo para lo que no es una fila. */
  cruda(sql) { this.lineas.push(/;\s*$/.test(sql) ? sql : sql + ';'); }
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PERSONAS · salen de semilla/00_usuarios_demo.sql (no se duplican aquí)
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Lista de valores de un `INSERT … VALUES (...)` de una sola línea. */
function valoresSql(linea) {
  const m = /VALUES\s*\((.*)\);\s*$/.exec(linea);
  if (!m) return null;
  const s = m[1], out = [];
  let i = 0;
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === ',') i++;
    if (i >= s.length) break;
    if (s[i] === "'") {
      let j = i + 1, v = '';
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") { v += "'"; j += 2; }
        else if (s[j] === "'") break;
        else v += s[j++];
      }
      out.push(v); i = j + 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== ',') j++;
      const tok = s.slice(i, j).trim();
      out.push(tok === 'NULL' ? null : Number(tok)); i = j;
    }
  }
  return out;
}

function leerUsuarios() {
  const ruta = path.join(DIR_SEMILLA, '00_usuarios_demo.sql');
  const sql = fs.readFileSync(ruta, 'utf8').split('\n');
  const mapa = new Map();
  for (const l of sql) {
    if (l.startsWith('INSERT OR REPLACE INTO registros')) {
      const v = valoresSql(l);
      if (v) mapa.set(v[0], { email: v[0], nombre: v[1], alta: v[5] || null, rol: 'normal', activo: 1 });
    }
  }
  for (const l of sql) {
    if (l.startsWith('INSERT OR REPLACE INTO permisos_sistema')) {
      const v = valoresSql(l);
      const u = v && mapa.get(v[0]);
      if (u) { u.rol = v[1] || 'normal'; u.activo = v[3] === 0 ? 0 : 1; }
    }
  }
  const lista = [...mapa.values()];
  if (!lista.length) throw new Error('No encontré personas en ' + ruta);
  return lista;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CLIENTES FICTICIOS · nombres variados, correos @ejemplo.com, teléfonos al azar
// ══════════════════════════════════════════════════════════════════════════════════════════════
const NOMBRES_H = ['Alejandro', 'Carlos', 'Eduardo', 'Fernando', 'Gerardo', 'Héctor', 'Ignacio', 'Javier', 'Jorge Luis', 'José Luis',
  'Juan Carlos', 'Luis Ángel', 'Manuel', 'Miguel Ángel', 'Óscar', 'Pablo', 'Rafael', 'Ricardo', 'Roberto', 'Salvador', 'Sergio',
  'Tomás', 'Víctor', 'Arturo', 'Bernardo', 'Cristian', 'Emilio', 'Gustavo', 'Hugo', 'Iván', 'Leonardo', 'Mauricio', 'Nicolás',
  'Omar', 'Raúl', 'Rodrigo', 'Santiago', 'Armando', 'Alfredo', 'Enrique', 'Francisco', 'Guillermo', 'Jesús', 'Mario', 'Andrés',
  'Daniel', 'Esteban', 'Felipe', 'Gilberto', 'Humberto', 'Isaac', 'Joaquín', 'Lorenzo', 'Marcos', 'Noé', 'Patricio', 'Rubén',
  'Samuel', 'Gabriel', 'Adrián', 'Ernesto', 'Ramón', 'Mateo'];
const NOMBRES_M = ['Adriana', 'Alejandra', 'Ana Karen', 'Andrea', 'Beatriz', 'Brenda', 'Carmen', 'Claudia', 'Daniela', 'Diana', 'Elena',
  'Erika', 'Fabiola', 'Gabriela', 'Guadalupe', 'Irma', 'Isabel', 'Jessica', 'Julieta', 'Karla', 'Laura Patricia', 'Leticia', 'Lucía',
  'Magdalena', 'Mariana', 'María Fernanda', 'Mónica', 'Natalia', 'Norma', 'Olga', 'Patricia', 'Paulina', 'Rosa María', 'Sandra',
  'Silvia', 'Susana', 'Teresa', 'Valentina', 'Verónica', 'Yolanda', 'Ximena', 'Berenice', 'Cecilia', 'Dolores', 'Eva', 'Fátima',
  'Graciela', 'Ivonne', 'Jimena', 'Lorena', 'Marcela', 'Nayeli', 'Rocío', 'Itzel', 'Regina', 'Paola', 'Camila', 'Renata'];
const APELLIDOS = ['Hernández', 'García', 'Martínez', 'López', 'González', 'Rodríguez', 'Pérez', 'Sánchez', 'Ramírez', 'Flores', 'Gómez',
  'Morales', 'Vázquez', 'Jiménez', 'Reyes', 'Cruz', 'Díaz', 'Torres', 'Gutiérrez', 'Ruiz', 'Mendoza', 'Aguilar', 'Ortiz', 'Castillo',
  'Moreno', 'Romero', 'Álvarez', 'Chávez', 'Herrera', 'Medina', 'Vargas', 'Castro', 'Guerrero', 'Ramos', 'Salazar', 'Domínguez',
  'Velázquez', 'Cervantes', 'Estrada', 'Fuentes', 'Ibarra', 'Lara', 'Luna', 'Maldonado', 'Navarro', 'Ochoa', 'Pacheco', 'Rangel',
  'Rivera', 'Rojas', 'Santiago', 'Silva', 'Soto', 'Trejo', 'Valdez', 'Vega', 'Zamora', 'Zavala', 'Barrera', 'Cabrera', 'Carrillo',
  'Delgado', 'Espinoza', 'Figueroa', 'Galván', 'Juárez', 'Lozano', 'Macías', 'Núñez', 'Padilla', 'Quintero', 'Rosales', 'Sandoval',
  'Tapia', 'Uribe', 'Villegas', 'Becerra', 'Camacho', 'Contreras', 'Escobar', 'Franco', 'Garza', 'Hidalgo', 'Ledesma', 'Montes',
  'Orozco', 'Peña', 'Serrano', 'Treviño', 'Valencia', 'Villanueva', 'de la Cruz', 'del Río', 'de León', 'de la Rosa', 'Ponce de León'];
const EMPRESAS = [
  { nombre: 'Constructora Valle Alto SA de CV', local: 'administracion.valle' },
  { nombre: 'Clínica Dental Sonrisa SC', local: 'recepcion.sonrisa' },
  { nombre: 'Despacho Contable Ríos y Asociados', local: 'contabilidad.rios' },
  { nombre: 'Estudio Creativo Nexo SC', local: 'compras.nexo' },
  { nombre: 'Hotel Boutique Casa Jacaranda SA de CV', local: 'gerencia.jacaranda' },
  { nombre: 'Taller Mecánico Los Pinos SA de CV', local: 'administracion.lospinos' }
];

/** Teléfono de 10 dígitos que pasa la auditoría (indicativo válido, sin rellenos ni secuencias). */
function telefonoFicticio(az) {
  const lada = az.pesos([['55', 50], ['33', 18], ['81', 14], ['222', 9], ['442', 9]], (x) => x[1])[0];
  let d;
  for (;;) {
    d = lada + Array.from({ length: 10 - lada.length }, (_, i) => az.entero(i === 0 ? 1 : 0, 9)).join('');
    const feo = /(\d)\1{4,}/.test(d) || '01234567890123456789'.includes(d.slice(2, 8)) || '98765432109876543210'.includes(d.slice(2, 8));
    if (!feo) break;
  }
  const corte = lada.length;
  const forma = az.num();
  if (forma < 0.55) return `${d.slice(0, corte)} ${d.slice(corte, corte + (corte === 2 ? 4 : 3))} ${d.slice(corte + (corte === 2 ? 4 : 3))}`;
  if (forma < 0.85) return d;
  if (forma < 0.93) return `${d.slice(0, corte)}-${d.slice(corte, corte + (corte === 2 ? 4 : 3))}-${d.slice(corte + (corte === 2 ? 4 : 3))}`;
  return `(${d.slice(0, corte)}) ${d.slice(corte, corte + (corte === 2 ? 4 : 3))} ${d.slice(corte + (corte === 2 ? 4 : 3))}`;
}

function crearClientes(az, cuantos, nombresVetados) {
  const vistos = new Set(), correos = new Set(), out = [];
  const limpio = (s) => sinAcentos(s).toLowerCase().replace(/\bde la\b|\bdel\b|\bde\b/g, '').replace(/[^a-z0-9]+/g, '');
  while (out.length < cuantos) {
    // Una de cada ~14 es una empresa; el resto, personas.
    if (out.length > 4 && out.filter((c) => c.empresa).length < EMPRESAS.length && az.prob(0.07)) {
      const e = EMPRESAS[out.filter((c) => c.empresa).length];
      const correo = e.local + '@ejemplo.com';
      if (correos.has(correo)) continue;
      correos.add(correo);
      out.push({ nombre: e.nombre, correo, telefono: telefonoFicticio(az), empresa: true });
      continue;
    }
    const mujer = az.prob(0.5);
    const nombre = az.elegir(mujer ? NOMBRES_M : NOMBRES_H);
    const a1 = az.elegir(APELLIDOS);
    const a2 = az.prob(0.72) ? az.elegir(APELLIDOS) : '';
    if (a2 === a1) continue;
    const completo = [nombre, a1, a2].filter(Boolean).join(' ');
    const llave = minusculaPlana(nombre + ' ' + a1);
    if (vistos.has(llave) || nombresVetados.has(llave)) continue;
    vistos.add(llave);

    const n1 = limpio(nombre.split(' ')[0]), ap = limpio(a1), ap2 = limpio(a2);
    const molde = az.pesos([0, 1, 2, 3, 4], (x) => [40, 20, 15, 15, 10][x]);
    let local = [n1 + '.' + ap, n1 + ap + az.entero(1, 99), n1[0] + ap, (ap2 ? ap + '.' + ap2 : n1 + '_' + ap), ap + n1[0] + az.entero(70, 99)][molde];
    let intento = 0;
    while (correos.has(local + '@ejemplo.com')) local += az.entero(1, 9) + (intento++ > 3 ? 'x' : '');
    const correo = local + '@ejemplo.com';
    correos.add(correo);
    out.push({ nombre: completo, correo, telefono: telefonoFicticio(az), empresa: false });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PRODUCTOS · reales (pruebas/ext_*) + genéricos para lo que esos archivos no traen
// ══════════════════════════════════════════════════════════════════════════════════════════════
const leerJsonPruebas = (n) => { try { return JSON.parse(fs.readFileSync(path.join(DIR_PRUEBAS, n), 'utf8')); } catch { return null; } };
const leerTextoPruebas = (n) => { try { return fs.readFileSync(path.join(DIR_PRUEBAS, n), 'utf8'); } catch { return ''; } };

/** Todo el texto que una página de Next.js guardó en self.__next_f.push([1,"…"]). */
function textoDePaginaNext(html) {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m, todo = '';
  while ((m = re.exec(html))) { try { todo += JSON.parse('"' + m[1] + '"'); } catch { /* trozo ilegible: se salta */ } }
  return todo;
}

/** Productos de la ficha guardada (con su foto y su precio de lista/promoción). */
function productosDeFichaGuardada(html) {
  const todo = textoDePaginaNext(html);
  const out = new Map();
  const re = /\{"index":\d+,"productId":"(\d+)"[\s\S]*?"name":"([^"]*)"[\s\S]*?"priceInfo":\{([^}]*)\}[\s\S]*?"mainCategory":"([^"]*)"[\s\S]*?"images":\[\{"type":"[^"]*","url":"([^"]*)"\}[\s\S]*?"brand":"([^"]*)"/g;
  let m;
  while ((m = re.exec(todo))) {
    if (out.has(m[1])) continue;
    const num = (k) => { const x = new RegExp('"' + k + '":([\\d.]+)').exec(m[3]); return x ? Number(x[1]) : null; };
    out.set(m[1], { id: m[1], nombre: m[2], marca: m[6], categoria: m[4], imagen: m[5], original: num('originalPrice'), promo: num('promoPrice') ?? num('price') });
  }
  return out;
}

const slugPdp = (nombre) => minusculaPlana(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const linkPdp = (nombre, productId, sku) =>
  `https://www.liverpool.com.mx/tienda/pdp/${slugPdp(nombre)}/${productId}` + (sku && sku !== productId ? `?skuid=${sku}` : '');

/** precio con descuento + % → precio de lista (a pesos enteros si queda a menos de 6 centavos). */
function listaDesdeDescuento(precio, desc) {
  if (!desc) return precio;
  const bruto = precio / (1 - desc / 100);
  return Math.abs(bruto - Math.round(bruto)) < 0.06 ? Math.round(bruto) : r2(bruto);
}

/**
 * Productos REALES (nombre, SKU, precio, foto) leídos de los archivos que dejó la extensión. Cada uno
 * lleva `grupo` (para armar canastas con sentido). Si los archivos no están, devuelve [] y el resto
 * de la demo se arma solo con genéricos.
 */
function cargarProductosReales() {
  const fichas = leerJsonPruebas('ext_recomendador_fichas_20261003.json');
  const busq = leerJsonPruebas('ext_busquedas_20261003.json');
  const ps5 = productosDeFichaGuardada(leerTextoPruebas('ext_lector_ficha_20261004.html'));
  const bolsa = textoDePaginaNext(leerTextoPruebas('ext_lector_bolsa_20261004.html'));
  const lista = [];
  const agregar = (o) => {
    const promo = r2(o.promo ?? o.lista), base = r2(o.lista);
    lista.push({
      real: true, grupo: o.grupo, nombre: o.nombre, sku: String(o.sku), productId: String(o.productId || o.sku),
      marca: o.marca || '', lista: base, promo, d: base > 0 ? Math.max(0, Math.round((1 - promo / base) * 100)) : 0,
      imagen: o.imagen || '', link: linkPdp(o.nombre, o.productId || o.sku, o.sku), peso: o.peso || 1
    });
  };

  if (fichas && fichas.iphone16 && fichas.iphone16.ficha) {
    const f = fichas.iphone16.ficha;
    // El precio de lista del iPhone 16 de 128 GB sale de la bolsa guardada (listPrice del renglón).
    const lp = /"sku":"1163058495"[\s\S]*?"listPrice":\{[^}]*"pesosAmount":([\d.]+)\}/.exec(bolsa);
    const listaIphone = lp ? Number(lp[1]) : null;
    for (const v of f.variantes || []) {
      if (!['1163057502', '1163058169', '1163058142', '1163058509'].includes(v.sku)) continue;
      const lista128 = listaIphone && v.size === '128 GB' ? listaIphone : v.price;
      agregar({ grupo: 'iphone', nombre: f.nombre, sku: v.sku, productId: f.id, marca: f.marca, lista: lista128, promo: v.price, peso: 3 });
    }
    const buscarEn = (id) => {
      for (const arr of Object.values(fichas.iphone16.carruseles || {})) {
        const x = (arr || []).find((p) => String(p.id) === id);
        if (x) return x;
      }
      return null;
    };
    const deCarrusel = (id, grupo, peso = 1) => {
      const x = buscarEn(id);
      if (x) agregar({ grupo, nombre: x.nombre, sku: x.id, marca: x.marca, lista: listaDesdeDescuento(x.precio, Number(x.desc) || 0), promo: x.precio, peso });
    };
    deCarrusel('1163592828', 'funda', 3);
    deCarrusel('1110262147', 'adaptador', 2);
    deCarrusel('999686656642', 'cargador');
    deCarrusel('999680760756', 'bateria');
    deCarrusel('1199595847', 'honor', 2);
    deCarrusel('1178391336', 'iphone', 1);
    deCarrusel('1163569672', 'iphone', 1);
    deCarrusel('1186186230', 'iphone', 1);
    deCarrusel('1186186914', 'iphone', 1);
  }
  if (fichas && fichas.protectorSolar && fichas.protectorSolar.ficha) {
    const f = fichas.protectorSolar.ficha;
    const v = (f.variantes || [])[0];
    if (v) agregar({ grupo: 'belleza', nombre: f.nombre, sku: v.sku, productId: f.id, marca: f.marca, lista: v.price, promo: v.price });
  }
  if (busq) {
    const deBusqueda = (consulta, id, grupo, peso = 1) => {
      const x = (busq[consulta] || []).find((p) => String(p.id) === id);
      if (x) agregar({ grupo, nombre: x.nombre, sku: x.id, marca: x.marca, lista: x.precio, promo: x.precio, peso });
    };
    for (const id of ['1085618454', '1049824340', '1105386831', '1126937152']) deBusqueda('secadora Mabe', id, 'secadora', 1);
    deBusqueda('secadora Mabe', '1105661793', 'secadora');
    deBusqueda('secadora Mabe', '1105027911', 'lavadora', 2);
    deBusqueda('secadora Mabe', '1175156352', 'lavadora', 2);
    deBusqueda('secadora Mabe', '1158330381', 'centrolavado');
    for (const id of ['1109875798', '1187389321', '1168658720']) deBusqueda('mochila para laptop 15 pulgadas', id, 'mochila');
    deBusqueda('mochila para laptop 15 pulgadas', '1103812913', 'mochila');
    deBusqueda('mica iPhone 16', '1181424245', 'mica', 2);
    deBusqueda('mica iPhone 16', '1180661341', 'mica');
    deBusqueda('set good girl Carolina herrera', '1204484968', 'belleza');
    deBusqueda('set good girl Carolina herrera', '1142934062', 'belleza');
  }
  for (const [id, grupo, peso] of [['1171425529', 'ps5', 3], ['1180626294', 'ps5', 2], ['1186785807', 'ps5', 2], ['1185699265', 'ps5', 1],
    ['1193710707', 'ps5', 1], ['1207352230', 'ps5', 1], ['1118872246', 'juego', 2], ['1147133711', 'juego', 1],
    ['1142290487', 'juego', 1], ['1131606547', 'juego', 1], ['1148828799', 'discops5', 1]]) {
    const x = ps5.get(id);
    if (x && x.promo) agregar({ grupo, nombre: x.nombre, sku: x.id, marca: x.marca, lista: x.original || x.promo, promo: x.promo, imagen: x.imagen, peso });
  }
  return lista;
}

/** Lo que los archivos reales no traen: genéricos (sin marca), SKU de 10 dígitos y sin foto. */
const GENERICOS = [
  // [grupo, nombre, precio de lista, % de promoción habitual]
  ['tv', 'Pantalla Smart TV 43 pulgadas Full HD', 6990, 15],
  ['tv', 'Pantalla Smart TV 50 pulgadas 4K UHD Google TV', 9490, 20],
  ['tv', 'Pantalla Smart TV 55 pulgadas 4K UHD Google TV', 11990, 25],
  ['tv', 'Pantalla Smart TV 55 pulgadas QLED 4K', 15990, 22],
  ['tv', 'Pantalla Smart TV 65 pulgadas 4K UHD Google TV', 16990, 30],
  ['tv', 'Pantalla Smart TV 65 pulgadas OLED 4K', 38990, 18],
  ['tv', 'Pantalla Smart TV 75 pulgadas 4K UHD', 23990, 28],
  ['tv', 'Pantalla Smart TV 85 pulgadas QLED 4K', 46990, 20],
  ['barra', 'Barra de sonido 2.1 canales con subwoofer inalámbrico', 3990, 20],
  ['barra', 'Barra de sonido 3.1.2 canales Dolby Atmos', 8990, 15],
  ['soporte', 'Soporte de pared inclinable para pantalla de 32 a 70 pulgadas', 790, 0],
  ['refri', 'Refrigerador Top Mount 14 pies cúbicos acero inoxidable', 13990, 18],
  ['refri', 'Refrigerador Bottom Mount 18 pies cúbicos con dispensador de agua', 19990, 22],
  ['refri', 'Refrigerador French Door 27 pies cúbicos con dispensador', 34990, 25],
  ['refri', 'Refrigerador Side by Side 22 pies cúbicos acero inoxidable', 27990, 20],
  ['refri', 'Frigobar 3.1 pies cúbicos', 4290, 10],
  ['estufa', 'Estufa de piso 6 quemadores 36 pulgadas acero inoxidable', 11990, 15],
  ['estufa', 'Parrilla a gas empotrable 4 quemadores', 5490, 12],
  ['campana', 'Campana de pared 90 cm acero inoxidable', 4290, 10],
  ['lavavajillas', 'Lavavajillas 14 servicios acero inoxidable', 14990, 20],
  ['horno', 'Horno eléctrico de empotrar 60 cm', 12990, 15],
  ['minisplit', 'Aire acondicionado minisplit 1 tonelada inverter 110 V solo frío', 9990, 15],
  ['minisplit', 'Aire acondicionado minisplit 1.5 toneladas inverter 220 V frío y calor', 15990, 18],
  ['microondas', 'Horno de microondas 1.1 pies cúbicos 1000 W acero inoxidable', 2890, 15],
  ['colchon', 'Colchón individual espuma de alta densidad 90 x 190 cm', 3990, 20],
  ['colchon', 'Colchón matrimonial de resortes ensacados con pillow top', 8990, 25],
  ['colchon', 'Colchón queen size híbrido memory foam', 14990, 28],
  ['colchon', 'Colchón king size ortopédico firme', 17990, 30],
  ['base', 'Base de cama matrimonial con cajones de almacenamiento', 4490, 15],
  ['base', 'Base de cama king size tapizada', 6990, 15],
  ['cabecera', 'Cabecera tapizada king size', 5990, 20],
  ['almohada', 'Almohada viscoelástica ergonómica (paquete de 2)', 1290, 20],
  ['sala', 'Sala modular 3 piezas tela gris', 15990, 25],
  ['sala', 'Sala esquinera en L con chaise longue', 22990, 20],
  ['sala', 'Sofá cama de 2 plazas', 7990, 15],
  ['sala', 'Sillón reclinable individual piel sintética', 6490, 18],
  ['mesa', 'Mesa de centro con cubierta de cristal templado', 2490, 10],
  ['comedor', 'Comedor 6 sillas estructura de madera y cubierta de cristal', 12990, 20],
  ['comedor', 'Antecomedor 4 sillas', 6990, 15],
  ['recamara', 'Recámara matrimonial 5 piezas', 13990, 22],
  ['escritorio', 'Escritorio esquinero con librero', 3990, 15],
  ['silla', 'Silla ergonómica de oficina con soporte lumbar', 3290, 20],
  ['librero', 'Librero de 5 repisas', 2190, 10],
  ['laptop', 'Laptop 15.6 pulgadas Intel Core i5 16 GB RAM 512 GB SSD', 14990, 15],
  ['laptop', 'Laptop 14 pulgadas Intel Core i7 16 GB RAM 1 TB SSD', 22990, 12],
  ['laptop', 'Laptop 15.6 pulgadas AMD Ryzen 5 8 GB RAM 256 GB SSD', 9990, 18],
  ['tablet', 'Tableta de 10.5 pulgadas 128 GB Wi-Fi', 5490, 15],
  ['monitor', 'Monitor 27 pulgadas Full HD 75 Hz', 3490, 15],
  ['impresora', 'Impresora multifuncional inalámbrica de tinta continua', 3290, 10],
  ['mouse', 'Mouse inalámbrico ergonómico', 390, 0],
  ['teclado', 'Teclado inalámbrico en español', 590, 0],
  ['disco', 'Disco duro externo 2 TB USB 3.0', 1790, 12],
  ['freidora', 'Freidora de aire digital 6 litros', 2190, 20],
  ['licuadora', 'Licuadora de vaso de vidrio 1.5 litros 600 W', 1190, 15],
  ['cafetera', 'Cafetera automática con molino integrado', 4490, 20],
  ['cafetera', 'Cafetera de cápsulas', 2290, 15],
  ['aspiradora', 'Aspiradora robot con mapeo láser', 6990, 25],
  ['aspiradora', 'Aspiradora vertical inalámbrica', 4990, 20],
  ['batidora', 'Batidora de pedestal 5 litros', 4990, 18],
  ['robotcocina', 'Robot de cocina multifunción con báscula', 9990, 12],
  ['olla', 'Olla de cocción lenta 6 litros', 1490, 10],
  ['ventilador', 'Ventilador de torre 42 pulgadas con control remoto', 1490, 10],
  ['purificador', 'Purificador de aire con filtro HEPA', 3990, 15],
  ['plancha', 'Plancha de vapor 2400 W', 890, 0],
  ['bocina', 'Bocina bluetooth portátil 20 W resistente al agua', 1490, 20]
];

/** SKU de 10 dígitos estable (sale del nombre, no del orden): '19' + 8 dígitos. */
function skuGenerico(nombre, usados) {
  let h = hashTexto('sku|' + nombre), sku;
  do { sku = '19' + String(h % 100000000).padStart(8, '0'); h = Math.imul(h, 1103515245) + 12345 >>> 0; } while (usados.has(sku));
  usados.add(sku);
  return sku;
}

function armarCatalogo() {
  const reales = cargarProductosReales();
  const usados = new Set(reales.map((p) => p.sku));
  const porGrupo = new Map();
  const poner = (p) => { if (!porGrupo.has(p.grupo)) porGrupo.set(p.grupo, []); porGrupo.get(p.grupo).push(p); };
  reales.forEach(poner);
  for (const [grupo, nombre, lista, d] of GENERICOS) {
    poner({
      real: false, grupo, nombre, sku: skuGenerico(nombre, usados), productId: '', marca: '', lista, promo: r2(lista * (1 - d / 100)),
      d, imagen: '', link: '', peso: 1
    });
  }
  return { porGrupo, reales };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// AUDITORÍA · porte de AuditoriaCotizacion.gs (solo lo que se escribe en «RevisionChecklist»)
// El texto de la hoja sale de revChecklistTexto_ con los puntos que calcula este motor: aquí se
// recalculan igual para que la semilla diga EXACTAMENTE lo que habría escrito la revisión.
// ══════════════════════════════════════════════════════════════════════════════════════════════
const AUD_PESOS = { 'cliente-nombre': 8, 'cliente-correo': 14, 'cliente-telefono': 8, 'asesor': 8, 'precios': 22, 'totales': 22, 'articulos': 12, 'vigencia': 6 };
const AUD_CASTIGO = { ok: 0, pendiente: 0.15, manual: 0.35, atencion: 0.55, mal: 1 };
const AUD_PARTICULAS = ['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos', 'van', 'von', 'di'];
const AUD_MARCAS_EMPRESA = ['sa', 'sadecv', 'srl', 'sc', 'sapi', 'scv', 'spr', 'ac', 'sofom', 'grupo', 'corporativo', 'comercializadora',
  'distribuidora', 'servicios', 'industrias', 'constructora'];
const AUD_DOMINIOS_COMUNES = ['gmail.com', 'hotmail.com', 'hotmail.es', 'hotmail.com.mx', 'outlook.com', 'outlook.es', 'outlook.com.mx',
  'yahoo.com', 'yahoo.com.mx', 'yahoo.es', 'live.com', 'live.com.mx', 'icloud.com', 'me.com', 'msn.com', 'aol.com', 'prodigy.net.mx',
  'liverpool.com.mx'];
const AUD_BUZONES = ['info', 'ventas', 'contacto', 'noreply', 'no-reply', 'admin', 'soporte', 'facturacion', 'cobranza', 'atencion', 'compras'];

const audLimpiar = (s) => String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim();
const audPlano = (s) => sinAcentos(String(s == null ? '' : s)).toLowerCase().trim();

function audDistancia(a, b) {
  const s = String(a || ''), t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const d = [];
  for (let i = 0; i <= s.length; i++) d[i] = [i];
  for (let j = 0; j <= t.length; j++) d[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const costo = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && s.charAt(i - 1) === t.charAt(j - 2) && s.charAt(i - 2) === t.charAt(j - 1)) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

function audCapitalizarNombre(nombre) {
  const limpio = audLimpiar(nombre);
  if (!limpio) return '';
  return limpio.split(' ').map((palabra, i) => {
    const plano = audPlano(palabra);
    if (i > 0 && AUD_PARTICULAS.includes(plano)) return plano;
    return palabra.split(/([-'’])/).map((trozo) => {
      if (trozo.length <= 1 && /[-'’]/.test(trozo)) return trozo;
      if (!trozo) return trozo;
      return trozo.charAt(0).toUpperCase() + trozo.slice(1).toLowerCase();
    }).join('');
  }).join(' ');
}
const audPalabrasNombre = (nombre) => audLimpiar(nombre).split(' ').filter((p) => p && !AUD_PARTICULAS.includes(audPlano(p)) && !/^[A-Za-zÁÉÍÓÚÑáéíóúñ]\.?$/.test(p));
function audNombreYApellido(p) {
  if (p.length <= 2) return audCapitalizarNombre(p.join(' '));
  if (p.length === 3) return audCapitalizarNombre(p[0] + ' ' + p[1]);
  if (p.length === 4) return audCapitalizarNombre(p[0] + ' ' + p[2]);
  return audCapitalizarNombre(p[0] + ' ' + p[p.length - 2]);
}
function audPareceEmpresa(nombre) {
  const plano = audPlano(nombre).replace(/[.,]/g, '');
  if (/\b(s\s?a\s?de\s?c\s?v|sa de cv|s de rl|sapi|sofom)\b/.test(plano)) return true;
  return plano.split(' ').some((p) => AUD_MARCAS_EMPRESA.includes(p));
}

function audValidarNombrePersona(nombre, op = {}) {
  const quien = op.quien || 'el nombre';
  const bruto = String(nombre == null ? '' : nombre);
  const limpio = audLimpiar(bruto);
  const r = { estado: 'ok', mensaje: '' };
  if (!limpio) { r.estado = 'mal'; r.mensaje = 'Falta ' + quien + '.'; return r; }
  if (/@/.test(limpio)) { r.estado = 'mal'; r.mensaje = 'En ' + quien + ' quedó un correo electrónico, no un nombre.'; return r; }
  if (/[<>|\\/{}[\]=]/.test(limpio)) { r.estado = 'atencion'; r.mensaje = capitalizar(quien) + ' tiene símbolos que no van en un nombre.'; return r; }
  const empresa = audPareceEmpresa(limpio);
  const palabras = audPalabrasNombre(limpio);
  const corregido = audCapitalizarNombre(limpio);
  const problemas = [];
  if (bruto !== limpio) problemas.push('espacios de más');
  if (!empresa) {
    if (limpio === limpio.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{2,}/.test(limpio)) problemas.push('está TODO EN MAYÚSCULAS');
    else if (limpio === limpio.toLowerCase() && /[a-záéíóúñ]/.test(limpio)) problemas.push('está todo en minúsculas');
    else if (corregido !== limpio) problemas.push('hay palabras sin la inicial mayúscula');
    if (/\d/.test(limpio)) problemas.push('tiene números');
  }
  if (!empresa) {
    if (op.exigirExacto && palabras.length !== op.maxPalabras) {
      r.estado = 'atencion';
      r.mensaje = palabras.length < op.maxPalabras
        ? capitalizar(quien) + ' viene con una sola palabra: debe llevar nombre y apellido.'
        : capitalizar(quien) + ' trae ' + palabras.length + ' palabras; en el documento debe salir solo nombre y apellido.';
      return r;
    }
    if (!op.exigirExacto && palabras.length < (op.minPalabras || 2)) {
      r.estado = 'atencion';
      r.mensaje = capitalizar(quien) + ' solo trae una palabra. Un documento formal lleva al menos nombre y apellido.';
      return r;
    }
    if (op.maxPalabras && palabras.length > op.maxPalabras) problemas.push('trae ' + palabras.length + ' palabras');
  }
  if (problemas.length) { r.estado = 'atencion'; r.mensaje = capitalizar(quien) + ': ' + problemas.join(', ') + '.'; return r; }
  r.mensaje = empresa ? 'Parece una razón social; se aceptó tal cual está escrita.' : 'Bien escrito: ' + palabras.length + ' palabras, capitalización correcta.';
  return r;
}

function audValidarCorreo(correo) {
  const bruto = String(correo == null ? '' : correo).trim();
  const r = { estado: 'ok', mensaje: '' };
  const mal = (m) => { r.estado = 'mal'; r.mensaje = m; return r; };
  if (!bruto) return mal('La cotización no tiene correo del cliente: no hay a dónde enviarla.');
  if (/\s/.test(bruto)) return mal('El correo tiene espacios en medio.');
  const partes = bruto.split('@');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return mal('No tiene la forma nombre@dominio.');
  const local = partes[0], dominio = partes[1].toLowerCase();
  if (local.length > 64) return mal('La parte anterior a la @ es demasiado larga.');
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return mal('La parte anterior a la @ tiene caracteres que no se admiten (acentos, ñ o símbolos).');
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return mal('La parte anterior a la @ tiene puntos mal colocados.');
  if (dominio.length > 255 || !dominio.includes('.')) return mal('El dominio no es una dirección completa (le falta el .com, .mx…).');
  for (const e of dominio.split('.')) {
    if (!e || e.length > 63 || !/^[a-z0-9-]+$/.test(e) || e.startsWith('-') || e.endsWith('-')) return mal('El dominio "' + dominio + '" no es válido.');
  }
  const tld = dominio.split('.').pop();
  if (!/^[a-z]{2,24}$/.test(tld)) return mal('La terminación del dominio (.' + tld + ') no es válida.');
  if (AUD_BUZONES.includes(audPlano(local))) { r.estado = 'atencion'; r.mensaje = 'Es un buzón de área ("' + local + '@"), no de una persona. Confirma que ahí lo van a leer.'; return r; }
  if (!AUD_DOMINIOS_COMUNES.includes(dominio)) {
    let mejor = '', dist = 99;
    for (const d of AUD_DOMINIOS_COMUNES) { const x = audDistancia(dominio, d); if (x < dist) { dist = x; mejor = d; } }
    if (dist > 0 && dist <= 2 && Math.abs(dominio.length - mejor.length) <= 2 && dominio.length >= 5) {
      r.estado = 'atencion';
      r.mensaje = '"' + dominio + '" se parece mucho a "' + mejor + '". Si fue una errata, el correo nunca llegará.';
      return r;
    }
  }
  r.mensaje = 'Dirección válida' + (AUD_DOMINIOS_COMUNES.includes(dominio) ? ' y de un dominio conocido.' : '.');
  return r;
}

function audValidarTelefonoMx(tel) {
  const bruto = String(tel == null ? '' : tel).trim();
  const r = { estado: 'ok', mensaje: '' };
  if (!bruto) { r.estado = 'atencion'; r.mensaje = 'No hay teléfono del cliente. Sin él no hay forma de aclarar dudas de la cotización.'; return r; }
  let d = bruto.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3);
  else if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  else if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  if (d.length !== 10) { r.estado = 'mal'; r.mensaje = 'El teléfono tiene ' + d.length + ' dígito(s); en México son 10.'; return r; }
  if (d.charAt(0) === '0' || d.charAt(0) === '1') { r.estado = 'mal'; r.mensaje = 'Ningún indicativo de área en México empieza en ' + d.charAt(0) + '.'; return r; }
  if (/^(\d)\1{9}$/.test(d)) { r.estado = 'mal'; r.mensaje = 'El teléfono son diez veces el mismo dígito: es un relleno, no un número.'; return r; }
  if ('0123456789012345678'.includes(d) || '9876543210987654321'.includes(d)) { r.estado = 'mal'; r.mensaje = 'El teléfono es una secuencia seguida de dígitos: es un relleno.'; return r; }
  const sug = ['55', '56', '33', '81'].includes(d.substr(0, 2))
    ? d.substr(0, 2) + ' ' + d.substr(2, 4) + ' ' + d.substr(6, 4)
    : d.substr(0, 3) + ' ' + d.substr(3, 3) + ' ' + d.substr(6, 4);
  r.mensaje = '10 dígitos con indicativo válido (' + sug + ').';
  return r;
}

/** La misma fórmula que cotizacion.html (calculateRow) y audCalcularLinea_. */
function audCalcularLinea(p) {
  const unitario = parseFloat(p.unitPrice) || 0, cantidad = parseInt(p.quantity, 10) || 0;
  const volumen = unitario * cantidad;
  const pagoUnico = parseFloat(p.costPaymentUnique) || 0;
  const descPublico = parseFloat(p.discountPublicPercent) || 0;
  const adicional = p.additionalDiscountApplied === 'Si';
  const descAdicional = parseFloat(p.additionalDiscountPercent) || 0;
  let total;
  if (pagoUnico > 0 && cantidad > 0 && unitario > 0) total = pagoUnico;
  else {
    const base = Math.max(0, volumen * (1 - descPublico / 100));
    total = (adicional && descAdicional > 0) ? base * (1 - descAdicional / 100) : base;
    total = Math.max(0, total);
  }
  const ahorro = volumen - total;
  return { cantidad, unitario, volumen, total, ahorro, porcentaje: volumen > 0 ? (ahorro / volumen) * 100 : 0, descPublico, descAdicional: adicional ? descAdicional : 0 };
}

function audMediana(nums) {
  const v = nums.filter((n) => typeof n === 'number' && isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function audAtipicos(nums, umbral = 3.5) {
  const v = nums.map((n) => Number(n) || 0);
  if (v.length < 4) return [];
  const med = audMediana(v);
  const mad = audMediana(v.map((n) => Math.abs(n - med)));
  if (mad === 0) return v.map((n, i) => [n, i]).filter(([n]) => Math.abs(n - med) > 1e-9).map(([, i]) => i);
  return v.map((n, i) => [n, i]).filter(([n]) => Math.abs(0.6745 * (n - med) / mad) > umbral).map(([, i]) => i);
}

function audValidarTotales(q, lista) {
  const r = { estado: 'ok', mensaje: '' };
  const suma = r2(lista.reduce((a, p) => a + audCalcularLinea(p).total, 0));
  const subtotal = r2(q.summarySubtotal), iva = r2(q.summaryVat), total = r2(q.summaryTotal);
  const tol = Math.max(0.05, lista.length * 0.005 + 0.02);
  const esperadoSub = r2(suma / 1.16), esperadoIva = r2(suma - esperadoSub);
  const dif = [];
  const revisa = (etiqueta, valor, esperado) => { if (Math.abs(r2(valor - esperado)) > tol) dif.push(etiqueta); };
  revisa('Total', total, suma); revisa('Subtotal', subtotal, esperadoSub); revisa('IVA', iva, esperadoIva); revisa('Subtotal + IVA', r2(subtotal + iva), total);
  if (!lista.length) { r.estado = 'mal'; r.mensaje = 'La cotización no tiene artículos, así que no hay nada que sume los totales.'; return r; }
  if (total <= 0) { r.estado = 'mal'; r.mensaje = 'El total de la cotización es cero. Nada de esto se puede enviar al cliente.'; return r; }
  if (dif.length) { r.estado = 'mal'; r.mensaje = 'Los importes no cuadran: ' + dif.join(' · ') + '.'; return r; }
  r.mensaje = 'Las ' + lista.length + ' líneas suman ' + total.toFixed(2) + ', el IVA del 16 % da ' + iva.toFixed(2) + ' y la base ' + subtotal.toFixed(2) + '. Todo cuadra al centavo.';
  return r;
}

function audValidarArticulos(lista) {
  const r = { estado: 'ok', mensaje: '', hallazgos: [] };
  if (!lista.length) { r.estado = 'mal'; r.mensaje = 'La cotización se guardó sin artículos.'; return r; }
  const vistos = {}, descuentos = [], porArticulo = [];
  lista.forEach((p, i) => {
    const c = audCalcularLinea(p), avisos = [];
    const sku = String(p.sku || '').trim(), desc = String(p.description || '').trim();
    if (!sku) avisos.push('sin SKU');
    else if (!/^[0-9]{6,14}$/.test(sku)) avisos.push('el SKU "' + sku + '" no tiene la forma de un código de Liverpool');
    if (sku) { if (vistos[sku] != null) avisos.push('SKU repetido (ya está en la línea ' + (vistos[sku] + 1) + ')'); else vistos[sku] = i; }
    if (!desc) avisos.push('sin descripción'); else if (desc.length < 5) avisos.push('descripción demasiado corta ("' + desc + '")');
    if (c.cantidad <= 0) avisos.push('cantidad en cero'); else if (c.cantidad > 999) avisos.push('cantidad de ' + c.cantidad + ' piezas');
    if (c.unitario <= 0) avisos.push('precio unitario en cero');
    if (c.total <= 0) avisos.push('la línea completa suma cero');
    if (c.descPublico < 0 || c.descPublico > 100) avisos.push('descuento público fuera del rango 0-100 %');
    if (c.descAdicional < 0 || c.descAdicional > 100) avisos.push('descuento adicional fuera del rango 0-100 %');
    if (c.porcentaje > 90) avisos.push('descuento total del ' + c.porcentaje.toFixed(1) + ' %');
    descuentos.push(c.porcentaje);
    porArticulo.push({ descuento: c.porcentaje });
    avisos.forEach((a) => r.hallazgos.push('Artículo ' + (i + 1) + ': ' + a));
  });
  audAtipicos(descuentos).forEach((i) => {
    const p = porArticulo[i];
    if (!p || Math.abs(p.descuento - audMediana(descuentos)) < 5) return;
    r.hallazgos.push('Artículo ' + (i + 1) + ': su descuento (' + p.descuento.toFixed(1) + ' %) se sale del patrón del resto de la cotización.');
  });
  const grave = r.hallazgos.some((h) => /repetido|en cero|suma cero|sin SKU|fuera del rango/.test(h));
  if (r.hallazgos.length) { r.estado = grave ? 'mal' : 'atencion'; r.mensaje = r.hallazgos.length + ' cosa(s) que revisar en los artículos.'; return r; }
  r.mensaje = lista.length + ' artículo(s) con SKU único, cantidades y descuentos dentro de lo normal.';
  return r;
}

function audValidarVigencia(tGuardado, ahora) {
  const dias = Math.floor((ahora.getTime() - tGuardado.getTime()) / MS_DIA);
  if (dias < 0) return { estado: 'atencion', mensaje: 'La fecha de la cotización está en el futuro (' + tGuardado.toISOString().slice(0, 10) + ').' };
  if (dias <= 3) return { estado: 'ok', mensaje: dias === 0 ? 'Se creó hoy.' : 'Se creó hace ' + dias + ' día(s).' };
  return { estado: 'atencion', mensaje: 'Se creó hace ' + dias + ' días. Las promociones de Liverpool cambian cada semana: vuelve a comprobar los precios antes de aprobarla.' };
}

/**
 * Los ocho puntos YA RESUELTOS, como los dejaría la revisión al guardar.
 * `precioFallo`: la consulta en vivo encontró un precio distinto del sitio (rechazo por precio).
 */
function auditar(q, productos, cuando, { precioFallo = false } = {}) {
  const puntos = [];
  const punto = (id, texto, estado, detalle) => puntos.push({ id, texto, estado, detalle: detalle || '' });
  const nom = audValidarNombrePersona(q.clientName, { quien: 'el nombre del cliente', minPalabras: 2, maxPalabras: 6 });
  punto('cliente-nombre', 'El nombre del cliente está escrito correctamente', nom.estado, nom.mensaje);
  const cor = audValidarCorreo(q.clientEmail);
  punto('cliente-correo', 'El correo del cliente es una dirección válida', cor.estado, cor.mensaje);
  const tel = audValidarTelefonoMx(q.clientPhone);
  punto('cliente-telefono', 'El teléfono del cliente tiene 10 dígitos válidos', tel.estado, tel.mensaje);
  const ase = audValidarNombrePersona(q.advisorName, { quien: 'el nombre del asesor', maxPalabras: 2, exigirExacto: true });
  punto('asesor', 'El asesor aparece con nombre y apellido', ase.estado, ase.mensaje);

  // Precios contra el sitio: lo que traen enlace se compara solo; lo capturado a mano pide criterio.
  const total = productos.length, importados = productos.filter((p) => String(p.productUrl || '').trim()).length, manuales = total - importados;
  if (precioFallo && importados) {
    punto('precios', 'Precios, promociones y descuentos coinciden con el sitio', 'mal',
      '1 artículo(s) tienen en la cotización un precio distinto del que publica el sitio ahora mismo. Revísalos antes de aprobar.');
  } else if (!importados) {
    punto('precios', 'Precios, promociones y descuentos coinciden con el sitio', 'manual',
      'Los ' + total + ' artículos se capturaron a mano (no traen enlace a su página), así que el sistema no puede compararlos solo. Ábrelos en el sitio y confírmalo tú.');
  } else if (manuales) {
    punto('precios', 'Precios, promociones y descuentos coinciden con el sitio', 'manual',
      importados + ' artículo(s) verificados contra el sitio y correctos; ' + manuales + ' capturado(s) a mano, sin enlace que consultar. Confirma tú los que faltan.');
  } else {
    punto('precios', 'Precios, promociones y descuentos coinciden con el sitio', 'ok',
      'Los ' + importados + ' artículos se compararon con liverpool.com.mx y el precio unitario cuadra en todos.');
  }
  const tot = audValidarTotales(q, productos);
  punto('totales', 'Subtotal, IVA y total general cuadran', tot.estado, tot.mensaje);
  const art = audValidarArticulos(productos);
  punto('articulos', 'Los artículos no repiten SKU y sus cantidades y descuentos son razonables', art.estado, art.mensaje);
  const vig = audValidarVigencia(q.tGuardado, cuando);
  punto('vigencia', 'La cotización es reciente y sus precios siguen vigentes', vig.estado, vig.mensaje);

  let penal = 0, pesoTotal = 0;
  for (const p of puntos) { const peso = AUD_PESOS[p.id] || 5; pesoTotal += peso; penal += peso * (AUD_CASTIGO[p.estado] == null ? 0.5 : AUD_CASTIGO[p.estado]); }
  const score = pesoTotal ? Math.max(0, Math.min(100, Math.round(100 - (penal / pesoTotal) * 100))) : 0;
  return { puntos, score };
}

/** revChecklistTexto_: lo que se escribe en la celda RevisionChecklist (texto legible, no JSON). */
function checklistTexto(auditoria, fallan, articulos) {
  const simbolo = { ok: '✔', atencion: '⚠', mal: '✖', manual: '○', pendiente: '…' };
  const lineas = ['Índice de confianza de la verificación automática: ' + auditoria.score + '/100'];
  for (const pt of auditoria.puntos) lineas.push((simbolo[pt.estado] || '·') + ' ' + pt.texto + (pt.detalle ? ' — ' + pt.detalle : ''));
  lineas.push('— Confirmado por quien revisó:');
  for (const pt of auditoria.puntos) lineas.push((fallan.has(pt.id) ? '✖ ' : '✔ ') + pt.texto);
  const verificados = articulos.filter((a) => a.ok).length;
  if (articulos.length) {
    lineas.push('— Artículos verificados: ' + verificados + ' de ' + articulos.length);
    for (const a of articulos) lineas.push('   ' + (a.ok ? '✔' : '✖') + ' ' + a.sku + ' · ' + a.description);
  }
  const texto = lineas.join('\n');
  return texto.length > 8000 ? texto.slice(0, 8000) + '\n…(recortado)' : texto;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// COTIZACIONES · cabecera + partidas, con su ciclo de vida (revisión, envío) coherente en el tiempo
// ══════════════════════════════════════════════════════════════════════════════════════════════
const TOTAL_COTIZACIONES = 160;
const DIAS_HISTORIA = 74;                       // 75 días contando hoy
const PESO_SEMANA = [0.30, 1.15, 1.22, 1.15, 1.10, 1.22, 0.55];   // dom … sáb: más trabajo en días hábiles
const PESO_HORA = { 9: 4, 10: 8, 11: 11, 12: 12, 13: 10, 14: 8, 15: 8, 16: 9, 17: 10, 18: 9, 19: 6, 20: 4 };   // 9 a 21 h
const ESTADOS = { ER: 'En Revisión', AP: 'Aprobada', RE: 'Rechazada', ENV: 'Enviada por Correo', FG: 'Folio Generado' };
// Los correos salen por Brevo desde logidma.com (decisión del usuario); alias_usado = 'Sí' como en el caso normal del original.
const REMITENTE_COTIZACIONES = 'ventel@logidma.com';

function calendarioCotizaciones(az) {
  const dias = [];
  for (let n = DIAS_HISTORIA; n >= 0; n--) {
    const dia = diaMx(AHORA, -n);
    dias.push({ n, dia, base: PESO_SEMANA[dia.diaSemana] * (0.8 + 0.45 * (DIAS_HISTORIA - n) / DIAS_HISTORIA), cuantos: 0 });
  }
  const forzados = new Map([[0, 7], [1, 6]]);              // hoy y ayer: varias, para que el panel se vea vivo
  const fijo = [...forzados.values()].reduce((a, b) => a + b, 0);
  const libres = dias.filter((x) => !forzados.has(x.n));
  const k = (TOTAL_COTIZACIONES - fijo) / libres.reduce((s, x) => s + x.base, 0);
  for (const x of dias) {
    if (forzados.has(x.n)) { x.cuantos = forzados.get(x.n); continue; }
    const e = x.base * k;
    x.cuantos = Math.floor(e) + (az.num() < e - Math.floor(e) ? 1 : 0);
  }
  let total = dias.reduce((s, x) => s + x.cuantos, 0);
  for (let i = 0; total !== TOTAL_COTIZACIONES && i < 5000; i++) {
    const x = az.pesos(libres, (y) => (total > TOTAL_COTIZACIONES && y.cuantos === 0 ? 0 : y.base));
    if (total < TOTAL_COTIZACIONES) { x.cuantos++; total++; } else if (x.cuantos > 0) { x.cuantos--; total--; }
  }
  return dias;
}

function instantesDelDia(az, dia, n, esHoy) {
  const tope = esHoy ? new Date(AHORA.getTime() - 6 * MS_MIN) : null;
  const horas = Object.keys(PESO_HORA).map(Number);
  const ts = [];
  for (let i = 0; i < n; i++) {
    let t = null;
    for (let intento = 0; intento < 60 && !t; intento++) {
      const h = az.pesos(horas, (x) => PESO_HORA[x]);
      const c = enDia(dia, h, az.entero(0, 59), az.entero(0, 59), az.entero(0, 999));
      if (!tope || c <= tope) t = c;
    }
    if (!t) {                                        // todavía es temprano: se reparte en la ventana disponible
      const ini = new Date(Math.min(enDia(dia, 9).getTime(), AHORA.getTime() - 150 * MS_MIN));
      t = entreFechas(az, ini, tope);
    }
    ts.push(t);
  }
  return ts.sort((a, b) => a - b);
}

// ── Canastas: qué se cotiza junto ─────────────────────────────────────────────────────────────
const CANASTAS = [
  { id: 'pantalla', peso: 17, arma: (u) => { const l = [u.p('tv')]; if (u.az.prob(0.33)) l.push(u.p('barra')); if (u.az.prob(0.28)) l.push(u.p('soporte')); if (u.az.prob(0.06)) l.push(u.p('ps5')); return l; } },
  { id: 'refri', peso: 11, arma: (u) => { const l = [u.p('refri')]; if (u.az.prob(0.3)) l.push(u.p('estufa')); if (u.az.prob(0.18)) l.push(u.p('microondas')); if (u.az.prob(0.12)) l.push(u.p('campana')); return l; } },
  { id: 'lavado', peso: 9, arma: (u) => { if (u.az.prob(0.12)) return [u.p('centrolavado')]; const l = [u.p('lavadora')]; if (u.az.prob(0.55)) l.push(u.p('secadora')); return l; } },
  { id: 'cocina', peso: 4, arma: (u) => { const l = [u.p(u.az.elegir(['estufa', 'lavavajillas', 'horno']))]; if (u.az.prob(0.35)) l.push(u.p('campana')); return l; } },
  { id: 'clima', peso: 3, arma: (u) => { const l = [u.p('minisplit')]; if (u.az.prob(0.3)) l.push(u.p('minisplit')); return l; } },
  { id: 'celular', peso: 14, arma: (u) => { const l = [u.p(u.az.prob(0.12) ? 'honor' : 'iphone')]; if (u.az.prob(0.6)) l.push(u.p('funda')); if (u.az.prob(0.4)) l.push(u.p('adaptador')); if (u.az.prob(0.35)) l.push(u.p('mica')); if (u.az.prob(0.1)) l.push(u.p('cargador')); return l; } },
  { id: 'colchon', peso: 9, arma: (u) => { const l = [u.p('colchon')]; if (u.az.prob(0.5)) l.push(u.p('base')); if (u.az.prob(0.4)) l.push(u.p('almohada')); if (u.az.prob(0.2)) l.push(u.p('cabecera')); return l; } },
  { id: 'muebles', peso: 10, arma: (u) => { const r = u.az.num(); if (r < 0.4) { const l = [u.p('sala')]; if (u.az.prob(0.4)) l.push(u.p('mesa')); return l; } if (r < 0.65) return [u.p('comedor')]; if (r < 0.85) { const l = [u.p('recamara')]; if (u.az.prob(0.3)) l.push(u.p('colchon')); return l; } const l = [u.p('escritorio'), u.p('silla')]; if (u.az.prob(0.3)) l.push(u.p('librero')); return l; } },
  { id: 'computo', peso: 8, arma: (u) => { const r = u.az.num(); if (r < 0.6) { const l = [u.p('laptop')]; if (u.az.prob(0.45)) l.push(u.p('mochila')); if (u.az.prob(0.4)) l.push(u.p('mouse')); if (u.az.prob(0.2)) l.push(u.p('teclado')); if (u.az.prob(0.12)) l.push(u.p('monitor')); return l; } if (r < 0.8) { const l = [u.p('tablet')]; if (u.az.prob(0.4)) l.push(u.p('mochila')); return l; } const l = [u.p(u.az.elegir(['monitor', 'impresora', 'disco']))]; if (u.az.prob(0.3)) l.push(u.p('mouse')); return l; } },
  { id: 'consola', peso: 7, arma: (u) => { const l = [u.p('ps5')]; if (u.az.prob(0.7)) l.push(u.p('juego')); if (u.az.prob(0.3)) l.push(u.p('juego')); if (u.az.prob(0.08)) l.push(u.p('discops5')); return l; } },
  { id: 'electro', peso: 9, arma: (u) => { const grupos = ['freidora', 'licuadora', 'cafetera', 'aspiradora', 'batidora', 'robotcocina', 'olla', 'ventilador', 'purificador', 'plancha', 'bocina']; return u.az.barajar(grupos).slice(0, u.az.pesos([1, 2, 3], (x) => [5, 3, 1.5][x - 1])).map((g) => u.p(g)); } },
  { id: 'belleza', peso: 2, arma: (u) => [u.p('belleza'), ...(u.az.prob(0.5) ? [u.p('belleza')] : [])] }
];

function cantidadPara(az, p) {
  if (['funda', 'mica', 'almohada', 'silla', 'juego', 'mouse'].includes(p.grupo)) return az.prob(0.25) ? 2 : 1;
  if (['tv', 'refri', 'lavadora', 'colchon', 'sala'].includes(p.grupo)) return az.prob(0.04) ? 2 : 1;
  return az.prob(0.06) ? 2 : 1;
}

const redondea5 = (n) => Math.max(0, Math.min(60, Math.round(n / 5) * 5));

/** Una partida en la forma de DetalleCotizaciones (y su total, con la fórmula de cotizacion.html). */
function armarLinea(az, p, cant) {
  const unit = p.lista;
  const modo = az.pesos(['ext', 'manual', 'adic'], (x) => (p.real ? { ext: 70, manual: 20, adic: 10 } : { ext: 14, manual: 62, adic: 24 })[x]);
  let cpu = 0, dpub = 0, adic = 'No', dadic = 0;
  if (modo === 'ext') {
    cpu = r2(p.promo * cant);
    dpub = Math.max(0, Math.min(100, r2((1 - cpu / cant / unit) * 100)));
  } else if (modo === 'manual') {
    dpub = az.prob(0.7) ? redondea5(p.d) : az.elegir([0, 5, 10, 15, 20, 25, 30]);
  } else {
    dpub = redondea5(p.d); adic = 'Si'; dadic = az.elegir([5, 7, 8, 10, 12, 15]);
  }
  const conEnlace = modo === 'ext' && p.real;             // lo que entra por la extensión trae su ficha y su foto
  return {
    sku: p.sku, descripcion: p.nombre, cantidad: cant, precio: unit, cpu, dpub, adic, dadic,
    imagen: conEnlace ? p.imagen : '', link: conEnlace ? p.link : '', modo, real: p.real, grupo: p.grupo
  };
}
function totalLinea(l) {
  if (l.cpu > 0 && l.cantidad > 0 && l.precio > 0) return l.cpu;
  const base = Math.max(0, l.cantidad * l.precio * (1 - l.dpub / 100));
  return Math.max(0, (l.adic === 'Si' && l.dadic > 0) ? base * (1 - l.dadic / 100) : base);
}
/** Importes de la cabecera: sumas sin redondear que se guardan ya a 2 decimales (parseCurrency del texto en pantalla). */
function totalesDe(lineas) {
  let sub = 0, iva = 0, tot = 0;
  for (const l of lineas) { const t = totalLinea(l); const s = t / 1.16; sub += s; iva += t - s; tot += t; }
  return { subtotal: r2(sub), iva: r2(iva), total: r2(tot) };
}
/** La partida como la ve el servidor (forma de getQuoteDetails), para auditar. */
const aFormaApp = (l) => ({
  sku: l.sku, description: l.descripcion, quantity: l.cantidad, unitPrice: l.precio, costPaymentUnique: l.cpu,
  discountPublicPercent: l.dpub, additionalDiscountApplied: l.adic, additionalDiscountPercent: l.dadic,
  imageUrl: l.imagen, productUrl: l.link
});

const OBS_GENERALES = [
  'Cliente solicita entrega a domicilio en la zona metropolitana.', 'Pago a 12 meses sin intereses con tarjeta Liverpool.',
  'Confirmar disponibilidad antes de cerrar la venta.', 'El cliente comparará con otra cotización; dar seguimiento en 48 horas.',
  'Pide factura a nombre de empresa.', 'Entrega en planta baja, sin elevador.', 'Pagará de contado en tienda.',
  'Cotización para regalo: entrega después del día 15.', 'Cliente pregunta por promociones de fin de semana.',
  'Envío a otro estado, validar cobertura de la paquetería.', 'Solicita apartar el precio hasta el viernes.',
  'Le interesa ampliar la cotización con accesorios.', 'Cliente frecuente, ya compró con nosotros.', 'Prefiere que lo contacten por la tarde.'
];
const OBS_POR_GRUPO = {
  tv: ['Pregunta si incluye instalación en pared.', 'Quiere ver la pantalla en tienda antes de comprar.'],
  refri: ['Medidas del espacio: 70 cm de ancho; validar que quepa.', 'Retiro del refrigerador anterior, preguntar costo.'],
  lavadora: ['Necesita instalación de toma de gas.', 'Entrega en departamento, segundo piso con elevador.'],
  colchon: ['Entrega y retiro del colchón anterior.', 'Pregunta por garantía del colchón.'],
  sala: ['Pasillo angosto, confirmar maniobra de entrega.', 'Quiere otro color de tapiz, validar opciones.'],
  iphone: ['Pide que incluya mica y funda.', 'Compara contra el pago a meses de la operadora.'],
  laptop: ['Uso escolar, quiere paquete con mochila.', 'Pregunta por garantía extendida.']
};

function observacionesDe(az, lineas) {
  if (!az.prob(0.5)) return '';
  const grupos = lineas.map((l) => l.grupo).filter((g) => OBS_POR_GRUPO[g]);
  if (grupos.length && az.prob(0.45)) return az.elegir(OBS_POR_GRUPO[az.elegir(grupos)]);
  return az.elegir(OBS_GENERALES);
}

// ── Razones de rechazo: cada una deja la cotización con ESE defecto y a quien revisa con su nota ─
const RAZONES_RECHAZO = [
  { id: 'precio', peso: 3, fallan: ['precios'], requiereEnlace: true,
    aplicar() {},
    nota: (q) => { const l = q.lineas.find((x) => x.link) || q.lineas[0]; return `El precio de «${l.descripcion}» cambió en el sitio. Actualiza el precio de lista y vuelve a guardar la cotización.`; } },
  { id: 'mayusculas', peso: 2, fallan: ['cliente-nombre'], aplicar(q) { q.cliente = { ...q.cliente, nombre: q.cliente.nombre.toUpperCase() }; },
    nota: () => 'El nombre del cliente está todo en mayúsculas. Escríbelo como aparece en su identificación y vuelve a mandarla a revisión.' },
  { id: 'adicional', peso: 2, fallan: ['articulos'], aplicar(q) {
      const l = q.lineas.find((x) => x.cpu === 0) || q.lineas[0];
      l.cpu = 0; l.adic = 'Si'; l.dadic = 15; l.dpub = l.dpub || 10; q.razonDato = 15;
    },
    nota: (q) => `El descuento adicional del ${q.razonDato || 15}% no tiene autorización de supervisión. Quítalo o pide autorización antes de volver a enviarla.` },
  { id: 'instalacion', peso: 1, fallan: ['articulos'], aplicar(q) { q.obs = 'El cliente pide que se incluya la instalación en domicilio.'; },
    nota: () => 'Falta incluir el servicio de instalación que pidió el cliente (viene en observaciones). Agrégalo como partida y vuelve a enviarla a revisión.' },
  { id: 'telefono', peso: 1, fallan: ['cliente-telefono'], aplicar(q) { q.cliente = { ...q.cliente, telefono: String(q.cliente.telefono).replace(/\D/g, '').slice(0, 8) }; },
    nota: () => 'El teléfono del cliente está incompleto (8 dígitos). Confírmalo con el cliente y corrígelo antes de enviarla.' },
  { id: 'correo', peso: 1, fallan: ['cliente-correo'], aplicar(q) { q.cliente = { ...q.cliente, correo: q.cliente.correo.replace('@ejemplo.com', '@ejemplocom') }; },
    nota: () => 'El correo del cliente está incompleto (falta el punto antes de «com»). Corrígelo: así no le llegaría la cotización.' },
  { id: 'repetido', peso: 1, fallan: ['articulos'], aplicar(q) { q.lineas.push({ ...q.lineas[0], cantidad: 1, cpu: 0, imagen: '', link: '' }); },
    nota: () => 'La cotización repite el mismo SKU en dos renglones. Júntalos en uno solo y vuelve a guardarla.' }
];
const NOTAS_APROBACION = ['', '', '', '', 'Todo en orden.', 'Precios verificados contra el sitio.', 'Aprobada. Ojo: la promoción vence este fin de semana.',
  'Se confirmó el nombre completo con el cliente.', 'Correcto. Anota la fecha de entrega que pidió el cliente.', 'Revisada, sin observaciones.'];
const ASUNTO_COTIZACION = (folio) => `Cotización de Servicios Ventel - Folio ${folio}`;
const ASUNTOS_EDITADOS = [(f) => `Cotización Liverpool · Folio ${f}`, (f) => `Su cotización de Liverpool (${f})`, (f) => `Cotización ${f} · Liverpool`];

/** Pide n cotizaciones aún sin destino que cumplan el filtro; las que cumplen `prefiere` van primero. */
function tomar(az, todas, filtro, n, prefiere) {
  let cands = az.barajar(todas.filter((q) => !q.destino && filtro(q)));
  if (prefiere) cands = [...cands.filter(prefiere), ...cands.filter((q) => !prefiere(q))];
  return cands.slice(0, n);
}

function generarCotizaciones(P) {
  const az = new Azar('cotizaciones');
  const catalogo = armarCatalogo();
  const dice = (grupo) => {
    const lista = catalogo.porGrupo.get(grupo);
    if (!lista || !lista.length) throw new Error('No hay productos del grupo ' + grupo);
    return az.pesos(lista, (p) => (p.real ? p.peso * 2 : 1));
  };
  const u = { az, p: dice };

  // ── 1 · Qué día y a qué hora ───────────────────────────────────────────────────────────────
  const quotes = [];
  for (const d of calendarioCotizaciones(az)) {
    for (const t of instantesDelDia(az, d.dia, d.cuantos, d.n === 0)) {
      quotes.push({ t, tGuardado: t, dia: d.dia, edad: d.n });
    }
  }
  quotes.sort((a, b) => a.t - b.t);

  // ── 2 · Quién cotiza ────────────────────────────────────────────────────────────────────────
  const { demo, asesores, supervisores, maestro } = P;
  const pesoPersona = new Map();
  for (const a of asesores) pesoPersona.set(a.email, a === demo ? 1.7 : 0.8 + az.num() * 0.5);
  supervisores.forEach((s, i) => pesoPersona.set(s.email, i === 0 ? 0.24 : 0.18));
  for (const q of quotes) {
    const elegibles = [...asesores, ...supervisores].filter((x) => x.activo || q.edad >= 31);
    q.asesor = az.pesos(elegibles, (x) => pesoPersona.get(x.email) * (x.activo ? 1 : 0.55));
  }
  // Pruebas del maestro: dos cotizaciones sueltas, de hace tiempo.
  if (maestro) for (const edad of [58, 13]) {
    const q = quotes.find((x) => x.edad <= edad && x.edad >= edad - 3);
    if (q) q.asesor = maestro;
  }
  // El asesor de la demo: presente hoy (una enviada y otra en revisión) y ayer.
  const hoy = quotes.filter((q) => q.edad === 0), ayer = quotes.filter((q) => q.edad === 1);
  if (hoy.length >= 6) { hoy[1].asesor = demo; hoy[hoy.length - 2].asesor = demo; }
  if (ayer.length >= 5) { ayer[2].asesor = demo; ayer[4].asesor = demo; }
  const delDemo = () => quotes.filter((q) => q.asesor === demo).length;
  for (let guardia = 0; delDemo() < 30 && guardia < 200; guardia++) {
    const q = az.elegir(quotes.filter((x) => x.edad >= 3 && x.asesor !== demo && x.asesor !== maestro));
    if (q) q.asesor = demo;
  }

  // ── 3 · A quién y qué ───────────────────────────────────────────────────────────────────────
  const clientes = az.barajar(crearClientes(az, 140, P.nombresVetados));
  const usados = [];
  quotes.forEach((q) => {
    q.cliente = (usados.length > 8 && az.prob(0.08)) ? az.elegir(usados) : (clientes.pop() || az.elegir(usados));
    if (!usados.includes(q.cliente)) usados.push(q.cliente);
    const canasta = az.pesos(CANASTAS, (c) => c.peso);
    const vistos = new Set();
    q.lineas = [];
    for (const p of canasta.arma(u)) {
      if (!p || vistos.has(p.sku) || q.lineas.length >= 5) continue;
      vistos.add(p.sku);
      q.lineas.push(armarLinea(az, p, cantidadPara(az, p)));
    }
    q.canasta = canasta.id;
    q.obs = observacionesDe(az, q.lineas);
    const despuesDelCambio = q.t >= fechaMx(2026, 9, 13, 0);     // CCL Liverpool pasó a ser el formato por omisión el 13/09/2026
    q.formato = az.prob(despuesDelCambio ? 0.85 : 0.2) ? 'ccl_liverpool' : 'actual';
  });

  // ── 4 · Destino de cada una (estatus) ───────────────────────────────────────────────────────
  const edad = (q) => q.edad;
  const esDemo = (q) => q.asesor === demo;
  const marcar = (lista, d) => lista.forEach((q) => { q.destino = d; });
  const ahoraMenos = (min) => AHORA.getTime() - min * MS_MIN;

  // Hoy: las más recientes siguen en revisión; una ya aprobada espera su envío.
  const hoyOrden = quotes.filter((q) => edad(q) === 0);
  marcar(hoyOrden.slice(-Math.min(4, Math.ceil(hoyOrden.length * 0.55))), 'ER');
  marcar(tomar(az, quotes, (q) => edad(q) === 0 && q.t.getTime() <= ahoraMenos(60), 1, (q) => !esDemo(q)), 'AP');
  marcar(tomar(az, quotes, (q) => edad(q) === 1, 2, null), 'ER');
  marcar(tomar(az, quotes, (q) => edad(q) === 1, 2, esDemo), 'AP');
  marcar(tomar(az, quotes, (q) => edad(q) === 1 && !esDemo(q), 1, null), 'RE');
  marcar(tomar(az, quotes, (q) => edad(q) >= 2 && edad(q) <= 4, 2, null), 'AP');
  marcar(tomar(az, quotes, (q) => edad(q) >= 2 && edad(q) <= 4, 2, esDemo), 'RE');
  marcar(tomar(az, quotes, (q) => edad(q) === 3, 1, null), 'ER');
  marcar(tomar(az, quotes, (q) => edad(q) >= 5 && edad(q) <= 7, 1, null), 'ER');
  marcar(tomar(az, quotes, (q) => edad(q) >= 5 && edad(q) <= 9, 2, null), 'AP');
  marcar(tomar(az, quotes, (q) => edad(q) >= 5 && edad(q) <= 9, 2, null), 'RE');
  marcar(tomar(az, quotes, (q) => edad(q) >= 10 && edad(q) <= 14, 1, null), 'ER');
  marcar(tomar(az, quotes, (q) => edad(q) >= 10 && edad(q) <= 20, 2, null), 'RE');
  marcar(tomar(az, quotes, (q) => edad(q) >= 8 && edad(q) <= 25, 3, null), 'AP');
  marcar(tomar(az, quotes, (q) => edad(q) >= 12 && edad(q) <= 30, 2, null), 'FG');
  marcar(tomar(az, quotes, (q) => edad(q) >= 21, 1, null), 'RE');
  // Tres casos de «editada después de enviarse»: Timestamp ≠ FechaEnvio (la hoja no toca FechaEnvio al editar).
  const s1 = tomar(az, quotes, (q) => edad(q) >= 3 && edad(q) <= 6 && !esDemo(q), 1, null); marcar(s1, 'S1');
  const s2 = tomar(az, quotes, (q) => edad(q) >= 2 && edad(q) <= 5, 1, null); marcar(s2, 'S2');
  const s3 = tomar(az, quotes, (q) => edad(q) >= 5 && edad(q) <= 12, 1, null); marcar(s3, 'S3');
  for (const q of quotes) if (!q.destino) q.destino = 'ENV';

  // ── 5 · Los rechazos mutan la cotización y llevan su nota ──────────────────────────────────
  for (const q of quotes.filter((x) => x.destino === 'RE')) {
    const posibles = RAZONES_RECHAZO.filter((r) => !r.requiereEnlace || q.lineas.some((l) => l.link));
    q.razon = az.pesos(posibles, (r) => r.peso);
    q.razon.aplicar(q);
  }

  // ── 6 · Importes, folios y cronología ───────────────────────────────────────────────────────
  const porDia = new Map();
  for (const q of quotes) {
    const k = aammdd(q.dia);
    porDia.set(k, (porDia.get(k) || 0) + 1);
    q.folio = `LVP-${k}-${String(porDia.get(k)).padStart(4, '0')}`;
    q.totales = totalesDe(q.lineas);
  }
  const contadores = [...porDia.entries()].map(([k, n]) => ({ clave: 'folio:' + k, valor: n }));
  for (const q of quotes) cronologia(az, q, P);
  return { quotes, contadores, catalogo };
}

/** Revisión y envío de UNA cotización, con horas coherentes (revisan de 9 a 19:30; se envía de 9 a 21). */
function cronologia(az, q, P) {
  const tope = new Date(AHORA.getTime() - 2 * MS_MIN);
  const tRevisor = (d) => {
    const p = partesMx(d);
    const despuesDeLaTarde = p.hora > 19 || (p.hora === 19 && p.minuto >= 30);
    if (p.hora < 9) return fechaMx(p.anio, p.mes, p.dia, 9, az.entero(0, 50), az.entero(0, 59), az.entero(0, 999));
    if (despuesDeLaTarde) { const s = diaMx(d, 1); return fechaMx(s.anio, s.mes, s.dia, 9, az.entero(0, 70) % 60, az.entero(0, 59), az.entero(0, 999)); }
    return d;
  };
  const revisores = P.revisores.filter((r) => r.email !== q.asesor.email);
  const revisor = az.pesos(revisores, (r) => r.peso);
  q.revisor = revisor.persona;
  q.envios = [];
  q.cicloPrevio = null;

  const simple = q.destino;
  q.estatus = ESTADOS[simple] || ESTADOS.ENV;
  q.revisionEstado = '';

  // Sin revisión todavía (en cola o folio sin cerrar): nada más que decir.
  if (simple === 'ER' || simple === 'FG') { q.estatus = ESTADOS[simple]; return; }

  const necesitaDecision = ['AP', 'RE', 'ENV', 'S1', 'S2', 'S3'].includes(simple);
  if (!necesitaDecision) return;

  // Primer ciclo (y único, salvo las editadas después de enviarse).
  const ciclo = (desde) => {
    const lat = Math.max(6, az.logn(35, 0.9) + (az.prob(0.08) ? az.entero(300, 1100) : 0));
    let t = tRevisor(new Date(desde.getTime() + lat * MS_MIN));
    if (t > tope) t = new Date(Math.max(desde.getTime() + 6 * MS_MIN, tope.getTime() - az.entero(0, 25) * MS_MIN));
    return t;
  };
  const envio = (desde) => {
    let t = aHorarioLaboral(az, new Date(desde.getTime() + Math.max(3, az.logn(25, 1.0)) * MS_MIN));
    if (t > tope) t = new Date(Math.max(desde.getTime() + 3 * MS_MIN, tope.getTime() - az.entero(0, 20) * MS_MIN));
    return t;
  };

  if (simple === 'S1' || simple === 'S2' || simple === 'S3') {
    // Se aprobó, se envió y después la editaron: el primer ciclo ya no deja huella más que el envío.
    const tRev1 = ciclo(q.t);
    const tEnv1 = envio(tRev1);
    q.envios.push({ t: tEnv1 });
    q.cicloPrevio = { tRev: tRev1 };
    // La editan al rato de enviarla (el cliente pide un cambio) o a la mañana siguiente; siempre en horario de trabajo.
    const demora = az.prob(0.6) ? az.entero(35, 300) : az.entero(900, 1200);
    q.tGuardado = aHorarioLaboral(az, new Date(tEnv1.getTime() + demora * MS_MIN));
    if (q.tGuardado > new Date(tope.getTime() - 30 * MS_MIN) || q.tGuardado <= tEnv1) q.tGuardado = new Date(tEnv1.getTime() + 20 * MS_MIN);
    if (simple === 'S1') { q.estatus = ESTADOS.ER; return; }
    q.tRev = ciclo(q.tGuardado);
    q.estatus = ESTADOS.AP;
    if (simple === 'S3') {
      const tEnv2 = envio(q.tRev);
      q.envios.push({ t: tEnv2 });
      q.estatus = ESTADOS.ENV;
    }
    q.decision = 'aprobada';
    return;
  }

  q.tRev = ciclo(q.tGuardado);
  q.decision = simple === 'RE' ? 'rechazada' : 'aprobada';
  if (simple === 'RE') { q.estatus = ESTADOS.RE; return; }
  q.estatus = simple === 'AP' ? ESTADOS.AP : ESTADOS.ENV;
  if (simple === 'ENV') {
    q.envios.push({ t: envio(q.tRev) });
    if (az.prob(0.05)) {                                                           // un reenvío, al día siguiente o poco después; nunca en el futuro
      const desde = new Date(q.envios[0].t.getTime() + az.entero(1, 3) * MS_DIA);
      if (desde < new Date(tope.getTime() - 40 * MS_MIN)) q.envios.push({ t: envio(desde) });
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PERSONAS · quién hace qué, y desde cuándo
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Cuántos días antes de «ahora» se dio de baja a la persona inactiva: toda su actividad es anterior. */
const DIAS_BAJA = 30;
const FECHA_BAJA = enDia(diaMx(AHORA, -DIAS_BAJA), 10, 12, 20, 0);
/** ¿Podía actuar esta persona en ese momento? Las bajas, solo antes de que las dieran de baja. */
const activoEn = (p, t) => !!p.activo || t < FECHA_BAJA;

function prepararPersonas() {
  const usuarios = leerUsuarios();
  const maestro = usuarios.find((u) => u.rol === 'maestro') || null;
  const supervisores = usuarios.filter((u) => u.rol === 'avanzado');
  const asesores = usuarios.filter((u) => u.rol === 'normal');
  if (!asesores.length) throw new Error('00_usuarios_demo.sql no trae ningún asesor.');
  const demo = asesores.find((u) => u.email === 'asesor@ventel.example') || asesores[0];
  // Ningún cliente ficticio se llama como alguien del equipo.
  const nombresVetados = new Set();
  for (const u of usuarios) {
    const p = minusculaPlana(u.nombre).split(/\s+/).filter(Boolean);
    nombresVetados.add(p.join(' '));
    if (p.length > 1) nombresVetados.add(p[0] + ' ' + p[p.length - 1]);
  }
  // Quién revisa: las dos personas de supervisión casi siempre; el maestro, de vez en cuando.
  const pesoSup = [46, 42];
  const revisores = supervisores.map((s, i) => ({ persona: s, email: s.email, peso: pesoSup[i] || 20 }));
  if (maestro) revisores.push({ persona: maestro, email: maestro.email, peso: 12 });
  return { usuarios, maestro, supervisores, asesores, demo, nombresVetados, revisores };
}

/** Un id que parece de los de la hoja (prefijo + base 36) pero sale del texto: es el mismo en cada corrida. */
function idEstable(prefijo, clave) {
  const a = hashTexto('id-a|' + clave), b = hashTexto('id-b|' + clave);
  return prefijo + '-' + a.toString(36) + b.toString(36).slice(0, 4);
}

/**
 * Reparte `total` instantes en los últimos días, con más peso en días hábiles y en horas de trabajo
 * (9 a 21 h de México) y sin pasar de «ahora». Devuelve los Date ordenados.
 */
function repartirInstantes(az, total, { diasAtras = DIAS_HISTORIA, crecimiento = 0.45 } = {}) {
  const dias = [];
  for (let n = diasAtras; n >= 0; n--) {
    const dia = diaMx(AHORA, -n);
    dias.push({ n, dia, peso: PESO_SEMANA[dia.diaSemana] * (0.8 + crecimiento * (diasAtras - n) / diasAtras) });
  }
  const horas = Object.keys(PESO_HORA).map(Number);
  const tope = new Date(AHORA.getTime() - 6 * MS_MIN);
  const salida = [];
  for (let i = 0; i < total; i++) {
    let t = null;
    for (let intento = 0; intento < 80 && !t; intento++) {
      const d = az.pesos(dias, (x) => x.peso);
      const h = az.pesos(horas, (x) => PESO_HORA[x]);
      const c = enDia(d.dia, h, az.entero(0, 59), az.entero(0, 59), az.entero(0, 999));
      if (c <= tope) t = c;
    }
    salida.push(t || new Date(tope.getTime() - az.entero(1, 600) * MS_MIN));
  }
  return salida.sort((a, b) => a - b);
}

/** Una persona de la lista que pudiera actuar en `t`, con peso. */
function personaEn(az, lista, t, peso) {
  const posibles = lista.filter((p) => activoEn(p, t));
  return az.pesos(posibles.length ? posibles : lista, peso);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GRUPOS · listas de personas (Grupos.gs). Se planean aquí porque las difusiones los usan.
// ══════════════════════════════════════════════════════════════════════════════════════════════
function planGrupos(P) {
  const A = P.asesores.filter((a) => a.activo);
  const bajas = P.asesores.filter((a) => !a.activo);
  const mitad = Math.ceil(A.length / 2);
  const sup = P.supervisores[0] || P.maestro;
  const sup2 = P.supervisores[1] || sup;
  const piloto = [A[0], A[Math.min(3, A.length - 1)], ...P.supervisores].filter((p, i, l) => p && l.indexOf(p) === i);
  const def = [
    { nombre: 'Turno matutino', detalle: 'Asesores del turno de 9:00 a 17:00 h.', miembros: [...A.slice(0, mitad), ...bajas.slice(0, 1)],
      creado: haceMin(66 * 1440 + 130), por: sup, edita: { hace: 21 * 1440 + 400, por: sup2 } },
    { nombre: 'Turno vespertino', detalle: 'Asesores del turno de 12:00 a 20:00 h.', miembros: A.slice(mitad),
      creado: haceMin(66 * 1440 + 115), por: sup, edita: null },
    { nombre: 'Piloto de cotizaciones', detalle: 'Quienes prueban las funciones nuevas antes de abrirlas a todo el equipo.', miembros: piloto,
      creado: haceMin(28 * 1440 + 260), por: sup2, edita: null }
  ];
  return def.map((g) => {
    const creado = aHorarioLaboral(new Azar('grupos|' + g.nombre), g.creado);
    const cambio = g.edita ? aHorarioLaboral(new Azar('grupos-e|' + g.nombre), haceMin(g.edita.hace)) : null;
    return {
      id: idEstable('grp', g.nombre), nombre: g.nombre, detalle: g.detalle, miembros: g.miembros.map((p) => p.email),
      activos: g.miembros.filter((p) => p.activo).length,
      creado, creadoPor: g.por, miembrosFijados: new Date(creado.getTime() + 6 * MS_MIN + 40000),
      editado: cambio, editadoPor: g.edita ? g.edita.por : null
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// COTIZACIONES · escritura (cabecera + partidas + contadores de folio)
// ══════════════════════════════════════════════════════════════════════════════════════════════
const CHECKLIST_SIN_REVISION = '';

/**
 * RevisionChecklist como lo deja el Worker (revision.ts · revChecklistJson): JSON con el texto legible
 * de siempre (el de revChecklistTexto_ del .gs) y lo mínimo estructurado del cálculo del servidor.
 */
function checklistDe(q, razon) {
  const productos = q.lineas.map(aFormaApp);
  const rechazada = q.decision === 'rechazada';
  const precioFallo = rechazada && !!razon && razon.id === 'precio';
  const aud = auditar({
    clientName: q.cliente.nombre, clientEmail: q.cliente.correo, clientPhone: q.cliente.telefono,
    advisorName: q.asesor.nombre, summarySubtotal: q.totales.subtotal, summaryVat: q.totales.iva,
    summaryTotal: q.totales.total, tGuardado: q.tGuardado
  }, productos, q.tRev, { precioFallo });
  const fallan = new Set(rechazada && razon ? razon.fallan : []);
  const marcada = precioFallo ? (q.lineas.find((x) => x.link) || q.lineas[0]) : null;
  const articulos = q.lineas.map((l) => ({ sku: l.sku, description: l.descripcion, ok: l !== marcada }));
  return JSON.stringify({
    v: 1, tipo: 'revision', texto: checklistTexto(aud, fallan, articulos), score: aud.score,
    puntos: aud.puntos.map((p) => ({ id: p.id, estado: p.estado })),
    articulos: { verificados: articulos.filter((a) => a.ok).length, total: articulos.length }
  });
}

function emitirCotizaciones(S, G, P) {
  S.seccion('COTIZACIONES · cabecera, partidas y contadores de folio', [
    'Cada cotización sale con la forma que escribe saveQuoteDataToSheets (Code.gs / cotizaciones.ts) y, si ya la revisaron,',
    'con las columnas de revisión que deja guardarRevisionCotizacion. Folios LVP-AAMMDD-XXXX consecutivos por día.',
    'Clientes y teléfonos son FICTICIOS (correos @ejemplo.com): el núcleo nunca les manda nada.'
  ]);
  let idDetalle = 0;
  for (const q of G.quotes) {
    const rev = q.tRev && q.decision ? q.decision : '';
    const razon = rev === 'rechazada' ? q.razon : null;
    const fila = {
      folio: q.folio,
      timestamp: iso(q.tGuardado),
      asesor_correo: q.asesor.email,
      asesor_nombre: q.asesor.nombre,
      extencion: '',
      cliente_nombre: q.cliente.nombre,
      correo_cliente: q.cliente.correo,
      numero: q.cliente.telefono,
      subtotal: q.totales.subtotal,
      iva: q.totales.iva,
      total_general: q.totales.total,
      estatus: q.estatus,
      observaciones: q.obs || '',
      formato: q.formato,
      revision_estado: '', revisado_por: '', revisado_nombre: '', revision_fecha: '', revision_notas: '', revision_checklist: CHECKLIST_SIN_REVISION
    };
    if (q.envios.length) fila.fecha_envio = iso(q.envios[q.envios.length - 1].t);
    if (rev) {
      const azRev = new Azar('revision|' + q.folio);
      fila.revision_estado = rev === 'rechazada' ? ESTADOS.RE : ESTADOS.AP;
      fila.revisado_por = q.revisor.email;
      fila.revisado_nombre = q.revisor.nombre;
      fila.revision_fecha = iso(q.tRev);
      fila.revision_notas = razon ? razon.nota(q) : azRev.elegir(NOTAS_APROBACION);
      fila.revision_checklist = checklistDe(q, razon);
    }
    S.fila('cotizaciones', fila);
    q.lineas.forEach((l, k) => {
      S.fila('detalle_cotizaciones', {
        id: ++idDetalle, folio_cotizacion: q.folio, orden: k, sku: l.sku, descripcion_producto: l.descripcion,
        cantidad: l.cantidad, precio_unitario_base: l.precio, costo_pago_unico_linea: l.cpu,
        desc_publico_porcentaje: l.dpub, aplica_desc_adicional: l.adic,
        porcentaje_desc_adicional: l.adic === 'Si' ? l.dadic : 0, imagen_url: l.imagen || '', link_articulo: l.link || ''
      });
    });
  }
  for (const c of G.contadores) S.fila('contadores', { clave: c.clave, valor: c.valor });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CORREOS · metricas_correos (Metricas.gs) y correos_enviados (CorreoCliente.gs)
// ══════════════════════════════════════════════════════════════════════════════════════════════
const PLANTILLAS_CLIENTE = [
  { clave: 'ticket', peso: 35, adjuntos: 1, asunto: (p) => `Ticket de su compra · Pedido ${p} | Liverpool` },
  { clave: 'edodecuenta', peso: 22, adjuntos: 0, asunto: (p) => `Validación de su pedido ${p} · Estado de cuenta | Liverpool` },
  { clave: 'validacionexitosa', peso: 18, adjuntos: 0, asunto: (p) => `Validación exitosa · Pedido ${p} | Liverpool` },
  { clave: 'formato', peso: 12, adjuntos: 0, asunto: (p, t) => `${t || 'Información sobre su solicitud'} | Liverpool` },
  { clave: 'edodecuentaextranjera', peso: 5, adjuntos: 0, asunto: () => 'Validación de compra con tarjeta extranjera · Estado de cuenta | Liverpool' },
  { clave: 'textoplano', peso: 8, adjuntos: 0, asunto: null }
];
const TITULOS_FORMATO = ['Seguimiento a su solicitud', 'Confirmación de su cita de entrega', 'Cambio de dirección de entrega',
  'Respuesta a su aclaración', 'Información sobre su garantía', 'Actualización de su pedido'];
const ASUNTOS_TEXTO_PLANO = ['Seguimiento a su compra', 'Información de su pedido', 'Respuesta a su solicitud', 'Datos para su entrega'];
const RETOQUES_ASUNTO = [(a) => a + ' (urgente)', (a) => 'Re: ' + a, (a) => a.replace(' | Liverpool', ' · Liverpool'), (a) => 'Importante: ' + a];

/** Un segundo correo (casa, oficina) para los pocos envíos que llevan dos destinatarios. */
const correoAlterno = (correo) => 'casa.' + String(correo).split('@')[0] + '@ejemplo.com';

const DIFUSIONES = [
  { grupo: 'Ventel', hace: 54 * 1440 + 200, asunto: 'Recordatorio: toda cotización pasa por revisión antes de enviarse', imagenes: 0, prueba: true },
  { grupo: 'Turno vespertino', hace: 18 * 1440 + 90, asunto: 'Cambio de horario de la capacitación de esta semana', imagenes: 0, prueba: false },
  { grupo: 'Piloto de cotizaciones', hace: 9 * 1440 + 310, asunto: 'Prueba de la nueva pantalla de atenciones pendientes', imagenes: 1, prueba: true },
  { absoluta: [2026, 9, 11, 17, 30], grupo: 'Ventel', asunto: 'Nuevo formato de cotización CCL Liverpool desde el 13 de septiembre', imagenes: 0, prueba: false }
];

function generarCorreos(P, G, X, grupos) {
  const az = new Azar('correos');
  const metricas = [], enviados = [], envios = [];
  const base = (t, o) => Object.assign({
    t, tipo: '', referencia: '', asesor_email: '', asesor_nombre: '', para: '', destinatarios: 0, cc: '0', cco: '0',
    asunto: '', adjuntos: '0', remitente: '', alias_usado: 'No', resultado: '', detalle: '', plantilla_modificada: ''
  }, o);
  const enviadoOk = { remitente: REMITENTE_COTIZACIONES, alias_usado: 'Sí', resultado: 'Enviado', detalle: '' };

  // ── 1 · Cotizaciones enviadas (una fila por envío, reenvíos incluidos) ─────────────────────
  for (const q of G.quotes) {
    q.envios.forEach((e) => {
      const dos = az.prob(0.07);
      const asunto = az.prob(0.7) ? ASUNTO_COTIZACION(q.folio) : az.elegir(ASUNTOS_EDITADOS)(q.folio);
      metricas.push(base(e.t, Object.assign({
        tipo: 'Cotización (PDF)', referencia: q.folio, asesor_email: q.asesor.email, asesor_nombre: q.asesor.nombre,
        para: dos ? q.cliente.correo + ',' + correoAlterno(q.cliente.correo) : q.cliente.correo,
        destinatarios: dos ? 2 : 1, asunto
      }, enviadoOk)));
      envios.push({ t: e.t, q, para: dos ? [q.cliente.correo, correoAlterno(q.cliente.correo)] : [q.cliente.correo], asunto });
    });
  }

  // ── 2 · Intentos fallidos: el asesor tecleó mal el «Para» y reintentó a los pocos minutos ──
  const candidatas = az.barajar(G.quotes.filter((q) => q.destino === 'ENV' && q.edad >= 2 && q.edad <= 40 && q.envios.length));
  const vistos = new Set(), conError = [];
  for (const q of candidatas) {
    if (vistos.has(q.asesor.email)) continue;
    vistos.add(q.asesor.email);
    conError.push(q);
    if (conError.length === 3) break;
  }
  const FALLOS = [
    (q) => ({ para: q.cliente.correo.replace(/\.com$/, ',com'), detalle: 'Correo no válido en Para: ' + q.cliente.correo.replace(/\.com$/, '') }),
    (q) => ({ para: q.cliente.correo.replace(/\.com$/, 'com'), detalle: 'Correo no válido en Para: ' + q.cliente.correo.replace(/\.com$/, 'com') }),
    () => ({ para: '', detalle: 'Faltan datos para enviar el correo (to, subject, body, folio).' })
  ];
  conError.forEach((q, i) => {
    const f = FALLOS[i](q);
    const t = new Date(q.envios[0].t.getTime() - az.entero(70, 260) * 1000);
    // Lo que apunta el catch de sendQuoteByEmail: sin nombre del asesor, sin asunto, remitente vacío y «No».
    metricas.push(base(t, { tipo: 'Cotización (PDF)', referencia: q.folio, asesor_email: q.asesor.email, para: f.para, resultado: 'Error', detalle: f.detalle }));
  });

  // ── 3 · Plantillas a clientes (+ su bitácora «CorreosEnviados») ────────────────────────────
  const clientes = crearClientes(az, 70, P.nombresVetados);
  const quienes = [...P.asesores, ...P.supervisores];
  const pesoQuien = new Map(quienes.map((p) => [p.email, p === P.demo ? 1.8 : (P.supervisores.includes(p) ? 0.25 : 0.7 + az.num() * 0.6)]));
  const instantes = repartirInstantes(az, 56, { crecimiento: 0.6 });
  instantes.forEach((t, i) => {
    const quien = personaEn(az, quienes, t, (p) => pesoQuien.get(p.email));
    const pl = az.pesos(PLANTILLAS_CLIENTE, (x) => x.peso);
    const cliente = clientes.pop() || az.elegir(clientes);
    const pedido = String(1000000000 + az.entero(0, 899999999));
    const titulo = pl.clave === 'formato' ? az.elegir(TITULOS_FORMATO) : '';
    const propuesto = pl.asunto ? pl.asunto(pedido, titulo) : '';
    let asunto = propuesto || az.elegir(ASUNTOS_TEXTO_PLANO);
    let modificada = '';
    if (propuesto) {
      modificada = az.prob(0.16) ? 'Sí' : 'No';
      if (modificada === 'Sí') asunto = az.elegir(RETOQUES_ASUNTO)(propuesto);
    }
    const para = [cliente.correo];
    if (az.prob(0.06)) para.push(correoAlterno(cliente.correo));
    const cc = az.prob(0.1) ? [(P.supervisores[0] || P.maestro).email] : [];
    const adjuntos = pl.adjuntos || (pl.clave === 'textoplano' && az.prob(0.15) ? 1 : 0);
    metricas.push(base(t, Object.assign({
      tipo: 'Plantilla cliente', referencia: pl.clave, asesor_email: quien.email, asesor_nombre: quien.nombre,
      para: para.join(', '), destinatarios: para.length, cc: String(cc.length), cco: '0', asunto, adjuntos: String(adjuntos),
      plantilla_modificada: modificada
    }, enviadoOk)));
    enviados.push({
      t, plantilla: pl.clave, para: para.join(', '), cc: cc.join(', '), cco: '', asunto, asesor: quien.email,
      remitente: REMITENTE_COTIZACIONES, adjuntos: String(adjuntos)
    });
  });
  // Un intento fallido de plantilla: el «Para» sin arroba (lo apunta el catch con String(error)).
  {
    const t = instantes[Math.floor(instantes.length * 0.4)];
    const quien = personaEn(az, P.asesores, t, () => 1);
    metricas.push(base(new Date(t.getTime() - 3 * MS_MIN), {
      tipo: 'Plantilla cliente', referencia: 'edodecuenta', asesor_email: quien.email, resultado: 'Error',
      detalle: 'Error: Correo no válido en Para: ' + clientes[0].correo.split('@')[0]
    }));
  }

  // ── 4 · Difusiones internas (Difusion.gs) ──────────────────────────────────────────────────
  const emisores = P.supervisores.length ? P.supervisores : [P.maestro];
  const ventel = { nombre: 'Ventel', activos: P.usuarios.filter((u) => u.activo).length, creado: new Date(0) };
  DIFUSIONES.forEach((d, i) => {
    const t0 = d.absoluta ? fechaMx(...d.absoluta) : haceMin(d.hace);
    if (t0 > new Date(AHORA.getTime() - MS_DIA)) return;
    const g = d.grupo === 'Ventel' ? ventel : grupos.find((x) => x.nombre === d.grupo);
    if (!g) return;
    const quien = emisores[i % emisores.length];
    const t = aHorarioLaboral(new Azar('difusion|' + d.asunto), t0);
    if (t < g.creado) return;
    const comun = { tipo: 'Difusión', asesor_email: quien.email, asesor_nombre: quien.nombre, para: quien.email, destinatarios: 1,
      cc: '0', asunto: d.asunto, adjuntos: String(d.imagenes), ...enviadoOk };
    if (d.prueba) {
      const tp = new Date(t.getTime() - az.entero(9, 26) * MS_MIN);
      metricas.push(base(tp, Object.assign({ referencia: 'prueba', cco: '0' }, comun)));
      X.bitacora.push({ t: tp, quien: quien.email, accion: 'Difusión de prueba', objetivo: quien.email,
        detalle: '«' + d.asunto + '» · solo a quien la escribió', parte: 'demo' });
    }
    metricas.push(base(t, Object.assign({ referencia: g.nombre, cco: String(g.activos) }, comun)));
    X.bitacora.push({ t, quien: quien.email, accion: 'Difusión enviada', objetivo: g.nombre,
      detalle: '«' + d.asunto + '» · ' + g.activos + ' destinatario(s)', parte: 'demo' });
  });

  metricas.sort((a, b) => a.t - b.t);
  enviados.sort((a, b) => a.t - b.t);
  return { metricas, enviados, envios };
}

function emitirCorreos(S, C) {
  S.seccion('CORREOS · metricas_correos y correos_enviados', [
    'Los correos salen por Brevo desde logidma.com: remitente «' + REMITENTE_COTIZACIONES + '» y alias_usado «Sí» en los envíos',
    'correctos (como los escriben ahora los módulos); las filas de error dejan remitente vacío y alias «No».',
    'CC, CCO y Adjuntos son conteos guardados como TEXTO, igual que metRegistrarEnvio.'
  ]);
  C.metricas.forEach((m, i) => {
    const { t, ...fila } = m;
    S.fila('metricas_correos', Object.assign({ id: i + 1, fecha: iso(t) }, fila));
  });
  C.enviados.forEach((e, i) => {
    const { t, ...fila } = e;
    S.fila('correos_enviados', Object.assign({ id: i + 1, fecha: iso(t) }, fila));
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BÚSQUEDAS · metricas_busquedas (Monitoreo.gs · monRegistrarBusqueda_)
// Lo único que escribe búsquedas es el buscador de cotizaciones (origen «cotizaciones», sin
// «resultados»), así que los términos son lo que se busca ahí: clientes, folios, correos, asesores.
// ══════════════════════════════════════════════════════════════════════════════════════════════
function generarBusquedas(P, G) {
  const az = new Azar('busquedas');
  const instantes = repartirInstantes(az, 300, { crecimiento: 0.5 });
  const quienes = [...P.asesores, ...P.supervisores];
  const pesoQuien = new Map(quienes.map((p) => [p.email, p === P.demo ? 2 : (P.supervisores.includes(p) ? 0.9 : 0.8 + az.num() * 0.7)]));
  const plano = (s) => (az.prob(0.6) ? sinAcentos(s).toLowerCase() : s);

  const terminosDe = (q) => {
    const c = q.cliente, palabras = c.nombre.split(' ');
    return {
      completo: c.nombre, dos: palabras.slice(0, 2).join(' '), apellido: palabras[palabras.length > 2 ? 1 : palabras.length - 1],
      folio: q.folio, correo: c.correo, local: c.correo.split('@')[0], folioCorto: q.folio.slice(4)
    };
  };
  // Los «más buscados»: un puñado de clientes y folios que varias personas consultan.
  const recientes = G.quotes.filter((q) => q.edad <= 20);
  const calientes = az.barajar(recientes).slice(0, 12).map((q, i) => ({ q, termino: i % 4 === 3 ? q.folio : plano(terminosDe(q).dos) }));

  const filas = [];
  for (const t of instantes) {
    const quien = personaEn(az, quienes, t, (p) => pesoQuien.get(p.email));
    const existentes = G.quotes.filter((q) => q.t <= t);
    if (!existentes.length) continue;
    let termino = '';
    const hot = calientes.filter((h) => h.q.t <= t);
    if (hot.length && az.prob(0.27)) termino = az.elegir(hot).termino;
    else {
      // Se busca sobre todo lo reciente: el peso cae con la antigüedad de la cotización.
      const q = az.pesos(existentes, (x) => Math.exp(-(t - x.t) / (7 * MS_DIA)) + 0.02);
      const k = terminosDe(q), r = az.num();
      if (r < 0.40) termino = plano(k.completo);
      else if (r < 0.56) termino = plano(k.dos);
      else if (r < 0.66) termino = plano(k.apellido);
      else if (r < 0.80) termino = k.folio;
      else if (r < 0.86) termino = k.folio.slice(0, az.entero(8, 13));
      else if (r < 0.90) termino = k.folioCorto;
      else if (r < 0.96) termino = az.prob(0.5) ? k.correo : k.local;
      else termino = plano(P.usuarios[az.entero(0, P.usuarios.length - 1)].nombre.split(' ').slice(0, 2).join(' '));
    }
    if (termino.length < 3) continue;
    filas.push({ t, termino, quien: quien.email, nombre: quien.nombre });
  }
  return filas;
}

function emitirBusquedas(S, filas) {
  S.seccion('BÚSQUEDAS · metricas_busquedas', [
    'Origen «cotizaciones» (el único que escribe hoy) y «resultados» sin dato, como en monRegistrarBusqueda_.'
  ]);
  filas.forEach((b, i) => {
    S.fila('metricas_busquedas', { id: i + 1, fecha: iso(b.t), termino: b.termino, quien: b.quien, nombre: b.nombre, origen: 'cotizaciones' });
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ESTADO DE OPERACIÓN · reportes, incidencias, historial y catálogo (Operacion.gs / operacion.ts)
// ══════════════════════════════════════════════════════════════════════════════════════════════
const opNormalizar = (t) => sinAcentos(String(t == null ? '' : t)).toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const opClave = (t) => opNormalizar(t).replace(/ /g, '-').substring(0, 60);
/** Los cuatro sistemas de siempre (OP_SISTEMAS_BASE). */
const OP_SISTEMAS = { connect: 'Connect', 'pagina-app': 'Página/App', salesforce: 'Salesforce', ccaip: 'CCAIP' };
const OP_AVISO_POSIBLE_DETALLE = 'Es posible que existan problemas con el servicio. Varias personas reportaron fallas en los últimos 30 minutos y lo estamos revisando.';
/** Estados que cuentan como «algo pasa» (afecta) y los que cierran (OP_ESTADOS_BASE). */
const OP_ESTADO = {
  posible: { afecta: true, cierra: false }, confirmado: { afecta: true, cierra: false }, intermitencia: { afecta: true, cierra: false },
  mantenimiento: { afecta: true, cierra: false }, resuelto: { afecta: false, cierra: true }, descartado: { afecta: false, cierra: true }
};

const NOTAS_REPORTE = {
  'connect|No abre / no carga': ['Abro Connect y se queda en blanco, ya probé con otro navegador.', 'No carga la pantalla de llamadas, solo da vueltas el círculo.',
    'Me marca error al abrir Connect y no puedo tomar llamadas.', 'Se quedó cargando desde hace 10 minutos y tengo llamadas en cola.', 'Cerré sesión y volví a entrar, sigue sin abrir.'],
  'connect|Va muy lento': ['Tarda más de un minuto en cada pantalla.', 'Cada clic tarda mucho en responder, así no se puede trabajar.', 'Va lentísimo desde hace un rato, a todos en mi isla nos pasa.'],
  'connect|No guarda la llamada': ['Termino la llamada y no se guarda el registro.', 'Al cerrar la llamada marca error y se pierde la nota.', 'No me guardó la última llamada, la tuve que capturar a mano.'],
  'salesforce|Va muy lento': ['Salesforce tarda en abrir cada caso, se queda pensando.', 'Los casos tardan casi un minuto en cargar.', 'Lento al guardar el caso, a veces marca tiempo de espera.'],
  'salesforce|No deja iniciar sesión': ['Me pide la contraseña otra vez y no la acepta.', 'Dice que mi contraseña venció y no me deja entrar.', 'Marca error de credenciales aunque la contraseña es la correcta.'],
  'salesforce|No encuentra al cliente': ['Busco al cliente por teléfono y no aparece, pero sí tiene pedidos.'],
  'pagina-app|No aparecen precios': ['En la página no aparecen los precios de los productos, salen vacíos.', 'Busco el producto y el precio sale en $0.', 'Los precios no cargan en la app ni en la página.', 'No se ve el precio en ningún artículo que busco.'],
  'pagina-app|No carga la página': ['La página de Liverpool no abre, marca error de conexión.', 'Se queda en blanco al entrar a la página.'],
  'pagina-app|Error al pagar': ['El cliente intenta pagar y le sale error al confirmar.', 'Al pagar con tarjeta marca error y no deja continuar.', 'No deja finalizar la compra, se queda en «procesando».'],
  'pagina-app|No deja agregar a la bolsa': ['El botón de agregar a la bolsa no responde.', 'No me deja agregar productos a la bolsa.'],
  'pagina-app|Imágenes rotas': ['Varias fotos de productos salen rotas en la página.'],
  'ccaip|Se corta el audio': ['El audio se corta cada pocos segundos, el cliente no me escucha.', 'Se entrecorta la llamada y a ratos se va el audio.',
    'El cliente dice que me escucha con interferencia.', 'Me escucho con eco y se corta, tuve que colgar y devolver la llamada.', 'Audio entrecortado en todas las llamadas.'],
  'ccaip|No cambia de estado': ['No me deja cambiar a disponible, se queda en no disponible.'],
  'outlook|No sincroniza el correo': ['Mi correo lleva horas sin actualizar, no me llegan los nuevos.']
};

/** Las incidencias de la demo. `hace` = minutos antes de «ahora»; `dia` = días atrás; `offsets` = minutos de cada reporte respecto al tercero. */
const INCIDENTES_DEMO = [
  { id: 'connect-abierta', sistema: 'connect', sub: 'No abre / no carga', origen: 'automatico', hace: 104, offsets: [-14, -6, 0, 7, 18], demoEn: 1,
    eventos: [
      { min: 9, quien: 0, estado: 'confirmado', aviso: true, nota: 'Confirmado: Connect no abre para varias personas. Ya avisé a TI.', detalle: 'Connect no abre o no carga para varias personas. TI ya lo está revisando.' },
      { min: 41, quien: 1, estado: 'confirmado', aviso: true, nota: 'TI sigue trabajando en la falla. Mientras vuelve, anota en Atenciones a quien se quede esperando.' }
    ] },
  { id: 'salesforce-observacion', sistema: 'salesforce', sub: 'Va muy lento', origen: 'automatico', hace: 52, offsets: [-9, -3, 0, 11],
    eventos: [
      { min: 14, quien: 1, estado: 'intermitencia', aviso: true, nota: 'En observación: Salesforce va lento a ratos. Si se detiene por completo, avísennos.', detalle: 'Salesforce responde lento a ratos. Estamos en observación.' }
    ] },
  { id: 'pagina-precios', sistema: 'pagina-app', sub: 'No aparecen precios', origen: 'automatico', dia: -3, h: 11, m: 8, offsets: [-11, -5, 0, 4], demoEn: 0,
    eventos: [
      { min: 12, quien: 0, estado: 'confirmado', aviso: true, nota: 'Confirmado: en la página no se ven los precios. Ya está con TI.', detalle: 'En la página y la app no aparecen los precios de los productos. TI ya lo está revisando.' },
      { min: 95, quien: 0, estado: 'resuelto', aviso: true, nota: 'Los precios ya aparecen. Fue un error en la actualización del catálogo; TI la revirtió.', detalle: 'Servicio restablecido: los precios ya se muestran con normalidad.' }
    ] },
  { id: 'ccaip-audio', sistema: 'ccaip', sub: 'Se corta el audio', origen: 'automatico', dia: -6, h: 16, m: 21, offsets: [-12, -7, 0, 5, 16],
    eventos: [
      { min: 8, quien: 1, estado: 'confirmado', aviso: true, nota: 'Confirmado: el audio se corta en varias posiciones. Se levantó caso con el proveedor de telefonía.', detalle: 'El audio de las llamadas se corta en varias posiciones. Ya está reportado con el proveedor.' },
      { min: 34, quien: 1, estado: 'confirmado', aviso: false, nota: 'El proveedor ya tiene el caso y pidió datos de las llamadas afectadas.' },
      { min: 72, quien: 1, estado: 'resuelto', aviso: true, nota: 'El proveedor corrigió el enlace. El audio ya está normal.', detalle: 'Servicio restablecido: el audio de las llamadas ya funciona con normalidad.' }
    ] },
  { id: 'connect-lento', sistema: 'connect', sub: 'Va muy lento', origen: 'automatico', dia: -9, h: 10, m: 12, offsets: [-17, -9, 0, 10],
    eventos: [
      { min: 15, quien: 0, estado: 'confirmado', aviso: true, nota: 'Confirmado: Connect va muy lento. TI está revisando los servidores.', detalle: 'Connect responde muy lento. TI está revisando.' },
      { min: 180, quien: 0, estado: 'resuelto', aviso: true, nota: 'Connect volvió a responder con normalidad.', detalle: 'Servicio restablecido.' }
    ] },
  { id: 'salesforce-sesion', sistema: 'salesforce', sub: 'No deja iniciar sesión', origen: 'automatico', dia: -12, h: 9, m: 47, offsets: [-8, -4, 0],
    eventos: [
      { min: 11, quien: 1, estado: 'descartado', aviso: false, nota: 'Eran contraseñas vencidas por la política de 90 días, no una falla de Salesforce. Ya se les restableció a las tres personas.' }
    ] },
  { id: 'connect-guardado', sistema: 'connect', sub: 'No guarda la llamada', origen: 'automatico', dia: -15, h: 14, m: 5, offsets: [-13, -6, 0], cierraSolo: 61, eventos: [] },
  { id: 'salesforce-mantenimiento', sistema: 'salesforce', sub: 'Mantenimiento programado', origen: 'supervision', sabado: -16, h: 9, m: 5, manual: true,
    titulo: 'Mantenimiento de Salesforce', detalle: 'Salesforce estará en mantenimiento de 9:00 a 11:30 h. Vuelve a abrirlo después de esa hora.',
    eventos: [
      { min: 0, quien: 0, estado: 'mantenimiento', aviso: true, nota: 'Mantenimiento programado por TI.' },
      { min: 145, quien: 0, estado: 'resuelto', aviso: true, nota: 'Mantenimiento terminado: Salesforce ya está disponible.', detalle: 'Mantenimiento terminado. Salesforce ya está disponible.' }
    ] },
  { id: 'pagina-servicio', sistema: 'pagina-app', sub: '', origen: 'automatico-servicio', dia: -24, h: 12, m: 40, offsets: [-15, -8, 0, 6],
    subs: ['No carga la página', 'Error al pagar', 'No deja agregar a la bolsa', 'Error al pagar'],
    eventos: [
      { min: 10, quien: 0, estado: 'confirmado', aviso: true, nota: 'Confirmado: la tienda en línea está fallando de varias formas a la vez.', detalle: 'La página y la app presentan fallas: no cargan o no dejan pagar. TI ya lo está revisando.' },
      { min: 25, quien: 0, estado: 'confirmado', aviso: true, nota: 'Seguimos con la falla. Para pedidos urgentes, anoten los datos del cliente en Atenciones.' },
      { min: 215, quien: 1, estado: 'resuelto', aviso: true, nota: 'Se restableció la tienda en línea. Ya se puede comprar con normalidad.', detalle: 'Servicio restablecido: la página y la app funcionan con normalidad.' }
    ] }
];

/** Reportes sueltos que nadie ha elevado todavía (y uno descartado), con un sistema escrito por una persona. */
const SUELTOS_DEMO = [
  { dia: -5, h: 12, m: 31, sistema: 'outlook', sistemaNuevo: 'Outlook', sub: 'No sincroniza el correo', estado: 'abierto' },
  { dia: -2, h: 16, m: 12, sistema: 'salesforce', sub: 'No encuentra al cliente', estado: 'abierto' },
  { dia: -1, h: 11, m: 40, sistema: 'pagina-app', sub: 'Imágenes rotas', estado: 'abierto' },
  { dia: -8, h: 13, m: 15, sistema: 'ccaip', sub: 'No cambia de estado', estado: 'descartado' }
];

function generarOperacion(P) {
  const az = new Azar('operacion');
  const A = P.asesores.filter((a) => a.activo);
  const supervision = [P.supervisores[0] || P.maestro, P.supervisores[1] || P.supervisores[0] || P.maestro];
  const reportes = [], incidentes = [], actualizaciones = [];
  const catalogo = new Map();     // 'tipo|sistema|clave' → fila del catálogo

  const idDe = (prefijo, t) => prefijo + '-' + t.getTime().toString(36) + '-' + az.entero(0, 46655).toString(36);
  const sumarUso = (tipo, sistemaClave, valor, quien, t) => {
    const clave = opClave(valor), k = tipo + '|' + sistemaClave + '|' + clave;
    const f = catalogo.get(k);
    if (f) f.usos++;
    else catalogo.set(k, { tipo, sistema_clave: sistemaClave, valor, clave, tono: '', creado: t, creado_por: quien, activo: 1, usos: 1 });
  };
  const notaDe = (sistema, sub) => az.elegir(NOTAS_REPORTE[sistema + '|' + sub] || ['Me está fallando ' + (OP_SISTEMAS[sistema] || sistema) + ' y no puedo trabajar.']);
  // Los días hábiles (de lunes a viernes): si cae en fin de semana, el viernes anterior.
  const dia = (n) => { for (let k = n; k > n - 3; k--) { const d = diaMx(AHORA, k); if (d.diaSemana !== 0 && d.diaSemana !== 6) return d; } return diaMx(AHORA, n); };
  const reporte = (t, quien, sistema, sub, extra) => {
    const nombreSistema = OP_SISTEMAS[sistema] || (extra && extra.sistemaNuevo) || sistema;
    const r = Object.assign({
      id: idDe('rep', t), fecha: t, correo: quien.email, nombre: quien.nombre, sistema: nombreSistema, sistema_clave: sistema,
      submotivo: sub, submotivo_clave: opClave(sub), notas: notaDe(sistema, sub), evidencias: '[]', incidente_id: '', estado: 'abierto'
    }, extra || {});
    delete r.sistemaNuevo;
    reportes.push(r);
    return r;
  };

  // ── Incidencias con sus reportes y su historial ────────────────────────────────────────────
  for (const d of INCIDENTES_DEMO) {
    const sup = (i) => supervision[i % supervision.length];
    const base = d.hace != null
      ? haceMin(d.hace)
      : (d.sabado != null
        ? (() => { for (let n = d.sabado; n > d.sabado - 8; n--) { const x = diaMx(AHORA, n); if (x.diaSemana === 6) return enDia(x, d.h, d.m, az.entero(0, 59), az.entero(0, 999)); } return enDia(dia(d.sabado), d.h, d.m); })()
        : enDia(dia(d.dia), d.h, d.m, az.entero(0, 59), az.entero(0, 999)));
    const nombreSistema = OP_SISTEMAS[d.sistema];
    const idInc = idDe('inc', base);
    const inc = {
      id: idInc, clave: d.sistema + '|' + opClave(d.sub), sistema: nombreSistema, sistema_clave: d.sistema, submotivo: d.sub, estado: 'posible',
      titulo: d.titulo || (d.sub ? nombreSistema + ' · ' + d.sub : 'Problemas con ' + nombreSistema), detalle: d.detalle || OP_AVISO_POSIBLE_DETALLE,
      creado: base, creado_por: 'sistema', creado_nombre: 'Detección automática', confirmado: null, confirmado_por: null, confirmado_nombre: null,
      actualizado: base, actualizado_por: null, cerrado: null, origen: d.origen
    };
    const acts = [];
    const act = (t, autor, nombre, estado, nota, aviso) => acts.push({ id: idDe('act', t), incidente_id: idInc, fecha: t, autor, autor_nombre: nombre, estado, nota, aviso: aviso ? '1' : '0' });
    const mias = [];

    if (d.manual) {
      // La crea supervisión a mano (opCrearIncidente): nace ya confirmada por quien la crea.
      const s = sup(d.eventos[0].quien), primero = d.eventos[0];
      inc.creado_por = s.email; inc.creado_nombre = s.nombre; inc.estado = primero.estado; inc.confirmado = base;
      inc.confirmado_por = s.email; inc.confirmado_nombre = s.nombre; inc.actualizado_por = s.email;
      act(base, s.email, s.nombre, primero.estado, primero.nota, primero.aviso);
      sumarUso('submotivo', d.sistema, d.sub, s.email, base);
      for (const e of d.eventos.slice(1)) {
        const t = new Date(base.getTime() + e.min * MS_MIN + az.entero(0, 59) * 1000);
        const s2 = sup(e.quien);
        act(t, s2.email, s2.nombre, e.estado, e.nota, e.aviso);
        inc.estado = e.estado; inc.actualizado = t; inc.actualizado_por = s2.email;
        if (e.detalle !== undefined) inc.detalle = e.detalle;
        if (OP_ESTADO[e.estado].cierra) inc.cerrado = t;
      }
    } else {
      // Quién reporta: personas distintas; la persona de la demo, en el puesto que se diga.
      const n = d.offsets.length;
      const gente = az.barajar(A.filter((a) => a !== P.demo)).slice(0, n);
      if (d.demoEn != null) gente.splice(d.demoEn, 0, P.demo);
      const quienes = gente.slice(0, n);
      const tiempos = d.offsets.map((o, i) => new Date(base.getTime() + o * MS_MIN + (o === 0 ? 0 : az.entero(0, 50) * 1000) + i));
      const subs = d.subs || null;
      quienes.forEach((q, i) => {
        const sub = subs ? subs[i] : d.sub;
        mias.push(reporte(tiempos[i], q, d.sistema, sub, { incidente_id: idInc, estado: 'vinculado' }));
        sumarUso('submotivo', d.sistema, sub, q.email, tiempos[i]);
      });
      // La incidencia nace un instante después del tercer reporte (el que cruza el umbral).
      inc.creado = new Date(tiempos[2].getTime() + az.entero(120, 420));
      inc.actualizado = inc.creado;
      for (let i = 3; i < n; i++) inc.actualizado = tiempos[i] > inc.actualizado ? tiempos[i] : inc.actualizado;
      act(inc.creado, 'sistema', 'Detección automática', 'posible', OP_AVISO_POSIBLE_DETALLE, true);
      const motivos = []; (subs || []).forEach((s) => { if (motivos.indexOf(s) === -1) motivos.push(s); });
      act(inc.creado, 'sistema', 'Detección automática', 'posible', d.sub
        ? '3 personas distintas reportaron «' + d.sub + '» en ' + nombreSistema + ' en menos de 30 minutos.'
        : '3 personas distintas reportaron fallas en ' + nombreSistema + ' en menos de 30 minutos, cada una con un motivo diferente (' + motivos.slice(0, 5).join('; ') + ').', false);
      let t0 = inc.creado;
      for (const e of d.eventos) {
        const t = new Date(t0.getTime() + e.min * MS_MIN + az.entero(0, 55) * 1000);
        const s = sup(e.quien);
        act(t, s.email, s.nombre, e.estado, e.nota, e.aviso);
        inc.estado = e.estado; inc.actualizado = t; inc.actualizado_por = s.email;
        if (e.detalle !== undefined) inc.detalle = e.detalle;
        if (!inc.confirmado && OP_ESTADO[e.estado].afecta && e.estado !== 'posible') {
          inc.confirmado = t; inc.confirmado_por = s.email; inc.confirmado_nombre = s.nombre;
        }
        if (OP_ESTADO[e.estado].cierra && !inc.cerrado) inc.cerrado = t;
      }
      if (d.cierraSolo) {
        // opCaducarPosibles: nadie la confirmó y dejaron de llegar reportes; se cierra sola al leer, pasada la hora.
        const t = new Date(inc.creado.getTime() + d.cierraSolo * MS_MIN + az.entero(0, 59) * 1000);
        acts.push({ id: idDe('act', t), incidente_id: idInc, fecha: t, autor: 'sistema', autor_nombre: 'Sistema', estado: 'descartado',
          nota: 'Sin reportes nuevos en 1 hora y sin confirmar. Se cerró solo.', aviso: '0' });
        inc.estado = 'descartado'; inc.cerrado = t; inc.actualizado = t;       // no toca actualizado_por
      }
      // Al cerrar desde la bandeja, sus reportes dejan de aparecer como pendientes (opActualizarIncidente).
      if (inc.cerrado && !d.cierraSolo) mias.forEach((r) => { r.estado = inc.estado; });
    }
    incidentes.push(inc);
    actualizaciones.push(...acts);
  }

  // ── Reportes sueltos ───────────────────────────────────────────────────────────────────────
  for (const s of SUELTOS_DEMO) {
    const t = enDia(dia(s.dia), s.h, s.m, az.entero(0, 59), az.entero(0, 999));
    const quien = az.elegir(A.filter((a) => a !== P.demo));
    reporte(t, quien, s.sistema, s.sub, { estado: s.estado, sistemaNuevo: s.sistemaNuevo });
    if (s.sistemaNuevo) sumarUso('sistema', '', s.sistemaNuevo, quien.email, t);
    sumarUso('submotivo', s.sistema, s.sub, quien.email, t);
  }

  reportes.sort((a, b) => a.fecha - b.fecha);
  incidentes.sort((a, b) => a.creado - b.creado);
  actualizaciones.sort((a, b) => a.fecha - b.fecha);
  return { reportes, incidentes, actualizaciones, catalogo: [...catalogo.values()].sort((a, b) => a.creado - b.creado) };
}

function emitirOperacion(S, O) {
  S.seccion('OPERACIÓN · catálogo, reportes, incidencias e historial', [
    'Lo base (los cuatro sistemas, sus motivos y los estados) vive en el código; la tabla operacion_catalogo guarda lo que se ha',
    'USADO (un uso por reporte) y los sistemas que escribió alguien. Dos incidencias abiertas hoy: Connect (confirmada) y Salesforce',
    '(«En observación» = estado intermitencia). El resto, resueltas o descartadas, con su historial de actualizaciones.'
  ]);
  for (const c of O.catalogo) {
    S.fila('operacion_catalogo', { tipo: c.tipo, sistema_clave: c.sistema_clave, valor: c.valor, clave: c.clave, tono: c.tono, creado: iso(c.creado), creado_por: c.creado_por, activo: c.activo, usos: c.usos });
  }
  for (const r of O.reportes) {
    S.fila('operacion_reportes', {
      id: r.id, fecha: iso(r.fecha), correo: r.correo, nombre: r.nombre, sistema: r.sistema, sistema_clave: r.sistema_clave, submotivo: r.submotivo,
      submotivo_clave: r.submotivo_clave, notas: r.notas, evidencias: r.evidencias, incidente_id: r.incidente_id, estado: r.estado
    });
  }
  for (const i of O.incidentes) {
    const fila = {
      id: i.id, clave: i.clave, sistema: i.sistema, sistema_clave: i.sistema_clave, submotivo: i.submotivo, estado: i.estado, titulo: i.titulo,
      detalle: i.detalle, creado: iso(i.creado), creado_por: i.creado_por, creado_nombre: i.creado_nombre, actualizado: iso(i.actualizado), origen: i.origen
    };
    if (i.confirmado) Object.assign(fila, { confirmado: iso(i.confirmado), confirmado_por: i.confirmado_por, confirmado_nombre: i.confirmado_nombre });
    if (i.actualizado_por) fila.actualizado_por = i.actualizado_por;
    if (i.cerrado) fila.cerrado = iso(i.cerrado);
    S.fila('operacion_incidentes', fila);
  }
  for (const a of O.actualizaciones) {
    S.fila('operacion_actualizaciones', { id: a.id, incidente_id: a.incidente_id, fecha: iso(a.fecha), autor: a.autor, autor_nombre: a.autor_nombre, estado: a.estado, nota: a.nota, aviso: a.aviso });
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ATENCIONES · devolverle la llamada a quien se quedó a medias (Atenciones.gs / atenciones.ts)
// ══════════════════════════════════════════════════════════════════════════════════════════════
const NOTAS_ATENCION = {
  Venta: ['Quería pagar a meses una pantalla y se cayó Connect a media llamada. Pide que le devuelvan la llamada.', 'Iba a cerrar la compra de un refrigerador y se cortó la llamada.',
    'Cotización de una sala casi lista; falta confirmar la fecha de entrega.', 'Interesado en un colchón king size; pidió que le llamen en la tarde.', 'Pidió precio de una lavadora y secadora, se cayó el sistema antes de cotizar.'],
  Seguimiento: ['Dar seguimiento a la cotización que se le envió ayer.', 'Preguntó si ya se aprobó su cotización; queda pendiente avisarle.', 'Le prometí confirmar disponibilidad y una fecha de entrega.', 'Quedó en decidir esta semana; llamarle para ver si procede.'],
  'Aclaración': ['Duda con el cobro de un pedido; hay que revisar el cargo en su estado de cuenta.', 'Pide aclarar por qué el precio cambió respecto a la cotización.', 'No le llegó el correo con su cotización; confirmar la dirección y reenviar.'],
  'Garantía': ['Su refrigerador falló a los 5 meses; quiere saber cómo hacer válida la garantía.', 'Pide información de la garantía de una laptop que compró hace un año.'],
  Entrega: ['Pregunta por la entrega de su pedido, la paquetería no ha pasado.', 'Quiere cambiar la dirección de entrega de su pedido.'],
  Otro: ['Cliente pidió que le llamen de vuelta, no dijo el motivo.', 'Llamada cortada, no alcancé a anotar el motivo.']
};
const RESULTADOS_ATENCION = ['Se le devolvió la llamada y quedó resuelto.', 'Se contactó al cliente y aceptó la cotización.', 'El cliente ya había comprado en tienda; se cierra.',
  'No contestó en dos intentos; se le dejó mensaje.', 'Se aclaró el cargo y quedó conforme.', 'Se envió la cotización por correo y el cliente confirmó que la recibió.',
  'Pidió más tiempo para decidir; se le llamará la próxima semana.', 'Se le explicó el proceso de garantía y ya levantó su solicitud.'];
const PROMESAS_HOY = ['Hoy 5:00 pm', 'Hoy 6:30 pm', 'Hoy después de las 4', 'Antes de las 8 pm', '17:30', '', ''];
const PROMESAS_OTRO_DIA = ['10:00 am', '17:30', 'Por la tarde', 'Antes de las 3 pm', '', ''];

function generarAtenciones(P, G) {
  const az = new Azar('atenciones');
  const A = P.asesores;
  const clientes = crearClientes(az, 40, P.nombresVetados);
  const filas = [];
  const idAt = (t) => 'AT-' + az.hex(8).toUpperCase() + '-' + (t.getTime() % 100000);
  const telefonoLimpio = (c) => c.telefono;

  const nueva = (o) => {
    const c = o.cliente || clientes.pop();
    const tipo = o.tipo || az.pesos(['Venta', 'Seguimiento', 'Aclaración', 'Otro', 'Garantía', 'Entrega'], (x) => ({ Venta: 40, Seguimiento: 24, 'Aclaración': 14, Otro: 8, 'Garantía': 7, Entrega: 7 })[x]);
    const fecha = o.fecha;
    const a = Object.assign({
      id: idAt(fecha), fecha, asesor: o.asesor.email, asesor_nombre: o.asesor.nombre, cliente: c.nombre, telefono: telefonoLimpio(c),
      correo: az.prob(0.45) ? c.correo : '', tipo, notas: az.elegir(NOTAS_ATENCION[tipo] || NOTAS_ATENCION.Otro),
      hora_promesa: az.elegir(mismoDiaMx(fecha, AHORA) ? PROMESAS_HOY : PROMESAS_OTRO_DIA), liberar_en: null, estado: 'pendiente', rescatada_por: '', rescatada_en: null, cerrada_por: '', cerrada_en: null, resultado: ''
    }, o.extra || {});
    filas.push(a);
    return a;
  };
  const libera = (a, min) => { a.liberar_en = new Date(a.fecha.getTime() + min * MS_MIN); return a; };
  const otros = (excepto) => A.filter((x) => x.activo && x !== excepto && x !== P.demo);
  const tarde = (n, h, m) => enDia(diaMx(AHORA, n), h, m, az.entero(0, 59), az.entero(0, 999));
  /** «Hace N minutos», pero nunca de madrugada ni después de «ahora». */
  const rel = (min) => {
    let t = haceMin(min);
    const h = partesMx(t).hora;
    if (h < 8 || h >= 21) t = aHorarioLaboral(az, t);
    return t > new Date(AHORA.getTime() - 4 * MS_MIN) ? new Date(AHORA.getTime() - 4 * MS_MIN - az.entero(0, 400) * 1000) : t;
  };

  // ── Abiertas ───────────────────────────────────────────────────────────────────────────────
  // La persona de la demo: una privada (más antigua), una ya liberada al pool y una que se libera más tarde.
  nueva({ asesor: P.demo, fecha: tarde(-3, 12, 40), tipo: 'Seguimiento', extra: { hora_promesa: '17:30' } });
  libera(nueva({ asesor: P.demo, fecha: rel(255), tipo: 'Venta' }), 120);                  // liberada hace ~2 h
  libera(nueva({ asesor: P.demo, fecha: rel(50), tipo: 'Aclaración' }), 240);              // se libera en ~3 h
  // De otras personas: unas en el pool, otras programadas, otras solo suyas.
  const dueno = () => az.elegir(otros(null));
  libera(nueva({ asesor: dueno(), fecha: rel(330) }), 120);
  libera(nueva({ asesor: dueno(), fecha: rel(200) }), 60);
  libera(nueva({ asesor: dueno(), fecha: rel(1500) }), 30);
  libera(nueva({ asesor: dueno(), fecha: rel(2900), tipo: 'Venta' }), 240);
  libera(nueva({ asesor: dueno(), fecha: rel(35) }), 120);
  libera(nueva({ asesor: dueno(), fecha: rel(20) }), 240);
  nueva({ asesor: dueno(), fecha: rel(1700) });
  nueva({ asesor: dueno(), fecha: tarde(-5, 15, 10), tipo: 'Seguimiento' });
  {
    // Una con «hora fija»: se libera hoy a las 18:00 (o mañana, si ya pasó).
    const a = nueva({ asesor: dueno(), fecha: rel(95), tipo: 'Venta' });
    let objetivo = enDia(HOY, 18, 0);
    if (objetivo <= a.fecha) objetivo = new Date(objetivo.getTime() + MS_DIA);
    a.liberar_en = objetivo;
  }

  // ── Cerradas ───────────────────────────────────────────────────────────────────────────────
  const cierra = (a, quien, minDespues, extra) => {
    a.estado = 'finalizada'; a.cerrada_por = quien.email;
    a.cerrada_en = new Date(a.fecha.getTime() + minDespues * MS_MIN + az.entero(0, 59) * 1000);
    a.resultado = (extra && extra.resultado) || az.elegir(RESULTADOS_ATENCION);
    return a;
  };
  // Atendidas por su propio autor. Cuatro son de clientes que acabaron cotizados (el resultado cita el folio) y se anotan
  // ANTES de que salga esa cotización; las demás son de otras fechas.
  const vistas = az.barajar(G.quotes.filter((q) => q.destino === 'ENV' && q.edad >= 1 && q.edad <= 24 && P.asesores.includes(q.asesor) &&
    partesMx(q.t).hora >= 13));
  for (let i = 0; i < 8; i++) {
    const q = vistas.pop();
    if (i < 4 && q) {
      const fecha = new Date(q.t.getTime() - az.entero(40, 240) * MS_MIN);
      const a = nueva({ asesor: q.asesor, fecha, tipo: 'Venta', cliente: q.cliente });
      cierra(a, q.asesor, Math.round((q.t - fecha) / MS_MIN) + az.entero(4, 14), { resultado: 'Se cotizó con folio ' + q.folio + ' y se envió al correo del cliente.' });
    } else {
      const tipo = az.elegir(['Seguimiento', 'Aclaración', 'Garantía', 'Entrega', 'Venta']);
      const asesor = az.elegir(otros(null).concat([P.demo]));
      const fecha = aHorarioLaboral(az, enDia(diaMx(AHORA, -az.entero(2, 24)), az.entero(9, 19), az.entero(0, 59)));
      cierra(nueva({ asesor, fecha, tipo }), asesor, az.entero(35, 600));
    }
  }
  // Rescatadas por otra persona: la libera su autor, otra la toma (reserva de 15 min), llama al cliente y cotiza.
  for (let i = 0; i < 5; i++) {
    const q = vistas.pop();
    if (!q) break;
    const autor = az.elegir(otros(q.asesor).concat([P.demo].filter((p) => p !== q.asesor)));
    const toma = new Date(q.t.getTime() - az.entero(4, 9) * MS_MIN);             // la toma poco antes de cotizar
    const liberada = new Date(toma.getTime() - az.entero(3, 40) * MS_MIN);
    const espera = az.elegir([30, 60, 120]);
    const a = nueva({ asesor: autor, fecha: new Date(liberada.getTime() - espera * MS_MIN), tipo: 'Venta', cliente: q.cliente });
    a.liberar_en = liberada;
    a.rescatada_por = q.asesor.email; a.rescatada_en = toma;
    a.estado = 'finalizada'; a.cerrada_por = q.asesor.email;
    a.cerrada_en = new Date(q.t.getTime() + az.entero(1, 4) * MS_MIN + az.entero(0, 59) * 1000);
    a.resultado = i % 2 ? 'Se hizo la cotización ' + q.folio + ' y el cliente la recibió por correo.' : 'Se le devolvió la llamada al cliente y se cotizó con el folio ' + q.folio + '.';
  }

  // Lo que nunca puede pasar: una atención de alguien que ya estaba de baja, o que sea posterior a «ahora».
  const lista = filas.filter((a) => a.fecha < new Date(AHORA.getTime() - 3 * MS_MIN)).sort((a, b) => a.fecha - b.fecha);

  // Catálogo de tipos: se alimenta solo, con el uso (el primero que lo escribió lo deja con su grafía).
  const tipos = new Map();
  for (const a of lista) {
    const clave = sinAcentos(a.tipo).toLowerCase().replace(/\s+/g, ' ').trim();
    const t = tipos.get(clave);
    if (t) t.usos++; else tipos.set(clave, { clave, tipo: a.tipo, usos: 1, creado: a.fecha, por: a.asesor });
  }
  return { atenciones: lista, tipos: [...tipos.values()] };
}

function emitirAtenciones(S, T) {
  S.seccion('ATENCIONES · atenciones_pendientes y atenciones_tipos', [
    'Privadas (sin liberar_en), liberadas al pool, programadas y ya cerradas (algunas rescatadas por otra persona dentro de la reserva de 15 min).',
    'Varias son de los mismos clientes ficticios de las cotizaciones y su resultado cita el folio.'
  ]);
  for (const a of T.atenciones) {
    S.fila('atenciones_pendientes', {
      id: a.id, fecha: iso(a.fecha), asesor: a.asesor, asesor_nombre: a.asesor_nombre, cliente: a.cliente, telefono: a.telefono, correo: a.correo,
      tipo: a.tipo, notas: a.notas, hora_promesa: a.hora_promesa, liberar_en: a.liberar_en ? iso(a.liberar_en) : null, estado: a.estado,
      rescatada_por: a.rescatada_por, rescatada_en: a.rescatada_en ? iso(a.rescatada_en) : null, cerrada_por: a.cerrada_por,
      cerrada_en: a.cerrada_en ? iso(a.cerrada_en) : null, resultado: a.resultado
    });
  }
  for (const t of T.tipos) S.fila('atenciones_tipos', { clave: t.clave, tipo: t.tipo, usos: t.usos, creado: iso(t.creado), por: t.por });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CONTENIDO · artículos, publicaciones (anuncios + votos), grupos
// ══════════════════════════════════════════════════════════════════════════════════════════════
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = (d) => `${DIAS_ES[d.diaSemana]} ${d.dia} de ${MESES[d.mes - 1]}`;

// Los bloques, ya en su forma canónica (la que deja artSanearContenido): {v:1, bloques:[…]}.
const bTexto = (t) => ({ tipo: 'texto', partes: [{ t }] });
const bTitulo = (texto, nivel = 2) => ({ tipo: 'titulo', texto, nivel });
const bLista = (items, ordenada = false) => ({ tipo: 'lista', items: items.map((t) => [{ t }]), ordenada });
const bTabla = (filas) => ({ tipo: 'tabla', filas, encabezado: true });
const bSeparador = () => ({ tipo: 'separador' });

const ARTICULOS_DEMO = [
  {
    titulo: 'Cómo cotizar un pedido especial', estado: 'publicado', autor: 1, editor: 0, creadoHace: 41, editadoHace: 12,
    resumen: 'Paso a paso para armar una cotización cuando el cliente pide algo fuera de lo normal: varios artículos, un descuento adicional o un producto que hay que capturar a mano.',
    bloques: [
      bTexto('Un pedido especial es el que se sale de la cotización de siempre: lleva varios artículos, un descuento adicional autorizado o un producto que hay que capturar a mano. El flujo es el mismo, pero conviene cuidar tres cosas: los datos del cliente, los precios y la revisión.'),
      bTitulo('Antes de empezar'),
      bLista(['Ten a la mano el nombre completo del cliente, su correo y un teléfono de 10 dígitos.', 'Confirma con el cliente qué artículos quiere y cuántas piezas de cada uno.',
        'Si pidió un descuento adicional, pide autorización a supervisión antes de capturarlo.']),
      bTitulo('Armar la cotización'),
      bLista(['Entra a Cotizar y captura los datos del cliente. El nombre va con mayúscula inicial, no todo en mayúsculas.',
        'Agrega los artículos. Con la extensión de Ventel se importan solos desde liverpool.com.mx; si no, captúralos a mano con su SKU, descripción, cantidad y precio de lista.',
        'Revisa el descuento de cada línea y el total: el sistema calcula el IVA del 16 %.', 'Escribe en observaciones lo que pidió el cliente (entrega, instalación, factura).',
        'Pulsa «Ir a vista previa»: se genera el folio LVP-AAMMDD-XXXX y la cotización pasa a revisión.'], true),
      bTitulo('Qué pasa después'),
      bTexto('Una cotización no se puede enviar al cliente hasta que supervisión la aprueba. Mientras tanto la verás como «En Revisión». Si la rechazan, te llega un correo con lo que hay que corregir.'),
      bTabla([['Estatus', 'Qué significa', 'Qué hago'], ['En Revisión', 'Supervisión todavía no la revisa.', 'Esperar; no se puede enviar.'],
        ['Aprobada', 'Ya se puede enviar al cliente.', 'Enviarla desde «Enviar correo».'], ['Rechazada', 'Hay algo que corregir; la nota dice qué.', 'Corregir y volver a guardarla.'],
        ['Enviada por Correo', 'El cliente ya la recibió.', 'Darle seguimiento.']]),
      bSeparador(),
      bTexto('Si el producto no existe en la página, captúralo a mano y anota en observaciones de dónde sale el precio.')
    ]
  },
  {
    titulo: 'Qué hacer cuando Connect se cae', estado: 'publicado', autor: 0, editor: 0, creadoHace: 27, editadoHace: 9,
    resumen: 'Cómo comprobar que la falla no es de tu equipo, cómo reportarla para que se levante un aviso y qué hacer con los clientes que se quedan esperando.',
    bloques: [
      bTexto('Cuando Connect no abre o va muy lento, lo primero es saber si le pasa solo a tu equipo o a todos. No pierdas tiempo reportando algo que ya está avisado.'),
      bTitulo('Primero, descarta tu equipo'),
      bLista(['Cierra la pestaña de Connect y ábrela de nuevo.', 'Prueba con otro navegador o en una ventana de incógnito.', 'Comprueba que tu conexión funcione abriendo cualquier otra página.'], true),
      bTitulo('Mira el tablero de estado'),
      bTexto('En el Portal, la pastilla «Estado de operación» dice si ya hay una incidencia abierta. Si ya la hay, no reportes de nuevo: tu reporte se suma solo a los de los demás.'),
      bTitulo('Si no hay aviso, repórtalo'),
      bLista(['Abre «Reportar una falla» y elige el sistema: Connect.', 'Elige qué está pasando (por ejemplo, «No abre / no carga») y añade una nota con lo que ves.', 'Si puedes, adjunta una captura de pantalla.'], true),
      bTexto('Cuando tres personas distintas reportan lo mismo en media hora, el sistema levanta solo un aviso de posible problema y supervisión lo confirma.'),
      bTitulo('Mientras Connect no funciona'),
      bLista(['Anota en Atenciones los datos del cliente que se quedó esperando: nombre, teléfono y qué quería.',
        'No prometas una hora de solución: di que lo estás atendiendo y que le devolverás la llamada.',
        'Cuando el aviso diga «Resuelto», devuelve las llamadas pendientes, empezando por las más antiguas.']),
      bTabla([['Estado del aviso', 'Qué significa'], ['Posible problema', 'Varias personas reportaron lo mismo; falta confirmarlo.'], ['Confirmado', 'Supervisión confirmó la falla y ya se trabaja en ella.'],
        ['Intermitencia', 'Funciona a ratos; puede fallar sin aviso.'], ['Resuelto', 'El sistema volvió a la normalidad.']])
    ]
  },
  {
    titulo: 'Guía rápida de garantías', estado: 'publicado', autor: 2, editor: 2, creadoHace: 15, editadoHace: 15, sinDemo: true,
    resumen: 'Qué revisar cuando un cliente pregunta por la garantía de un producto y cuándo escalarlo con supervisión.',
    bloques: [
      bTexto('La garantía depende de la marca, de la categoría del producto y de la fecha de compra. Antes de responder, reúne estos datos y no prometas plazos de memoria.'),
      bTitulo('Datos que necesitas'),
      bLista(['Número de pedido o ticket de compra.', 'SKU y nombre del producto.', 'Fecha en que se compró y fecha en que se entregó.', 'Qué falla presenta y desde cuándo.']),
      bTitulo('Dónde consultar'),
      bTabla([['Qué necesito saber', 'Dónde lo consulto'], ['El plazo de garantía del producto', 'Ficha del producto en liverpool.com.mx y póliza de la marca.'],
        ['Si la compra es del cliente', 'Ticket y pedido en Salesforce.'], ['Si el producto tuvo un cambio', 'Historial del pedido en Salesforce.']]),
      bTitulo('Cómo responder'),
      bLista(['Pide al cliente los datos de arriba.', 'Confirma que la falla no sea por mal uso (golpes, humedad, instalación incorrecta).',
        'Explícale el proceso: la marca o el centro de servicio autorizado revisa el producto.', 'Si el cliente no está de acuerdo con la respuesta, escala con tu supervisor y deja la nota en el caso.'], true),
      bSeparador(),
      bTexto('Esta guía es un resumen. Ante la duda, consulta la póliza de la marca y escala con supervisión.')
    ]
  },
  {
    titulo: 'Cierre de mes: pendientes de cotizaciones', estado: 'borrador', autor: 1, editor: 1, creadoHace: 3, editadoHace: 1,
    resumen: 'Qué revisar antes de cerrar el mes: cotizaciones aprobadas sin enviar y atenciones todavía abiertas.',
    bloques: [
      bTexto('Antes de cerrar el mes conviene dejar limpio lo que quedó a medias. Este borrador lista lo mínimo; falta completar los pasos y revisarlo con supervisión.'),
      bTitulo('Qué revisar'),
      bLista(['Cotizaciones en estatus «Aprobada» que nunca se enviaron al cliente.', 'Atenciones pendientes con más de una semana.'])
    ]
  }
];

function generarContenido(P, grupos) {
  const az = new Azar('contenido');
  const autoria = [P.supervisores[0] || P.maestro, P.supervisores[1] || P.supervisores[0] || P.maestro, P.maestro || P.supervisores[0]];
  const activos = [...P.asesores.filter((a) => a.activo), ...P.supervisores, ...(P.maestro ? [P.maestro] : [])];

  // ── Artículos y sus lecturas ────────────────────────────────────────────────────────────────
  const articulos = [], vistas = [];
  for (const a of ARTICULOS_DEMO) {
    const creado = aHorarioLaboral(az, haceMin(a.creadoHace * 1440 + az.entero(0, 600)));
    let editado = a.editadoHace === a.creadoHace ? creado : aHorarioLaboral(az, haceMin(a.editadoHace * 1440 + az.entero(0, 400)));
    if (editado < creado) editado = new Date(creado.getTime() + 20 * MS_MIN);
    const fila = {
      id: idEstable('art', a.titulo), titulo: a.titulo, resumen: a.resumen, contenido: JSON.stringify({ v: 1, bloques: a.bloques }), estado: a.estado,
      autores: autoria[a.autor].nombre, creado, editado, editado_por: autoria[a.editor].nombre
    };
    articulos.push(fila);
    if (a.estado !== 'publicado') continue;
    const lectores = az.barajar(activos.filter((p) => !(a.sinDemo && p === P.demo))).slice(0, az.entero(5, 8));
    for (const p of lectores) {
      const veces = az.pesos([1, 2, 3, 4], (x) => [55, 25, 12, 8][x - 1]);
      const tope = AHORA.getTime() - 40 * MS_MIN;
      const primera = new Date(Math.min(aHorarioLaboral(az, new Date(creado.getTime() + az.entero(30, 9 * 1440) * MS_MIN)).getTime(), tope - 90 * MS_MIN));
      const ultima = veces === 1 ? primera : new Date(Math.min(aHorarioLaboral(az, new Date(primera.getTime() + az.entero(60, 12 * 1440) * MS_MIN)).getTime(), tope));
      vistas.push({ articulo_id: fila.id, correo: p.email, nombre: p.nombre, primera_vez: primera, ultima_vez: ultima < primera ? primera : ultima, veces });
    }
  }

  // ── Publicaciones del Portal (los formatos que escribe anuncios.html · buildDatos) ──────────
  const sup = autoria[0], sup2 = autoria[1];
  const h = (n) => diaMx(AHORA, n);
  const desde = (d) => fechaMx(d.anio, d.mes, d.dia, 0, 0, 0);          // «Desde»: inicio del día en México
  const hasta = (d) => fechaMx(d.anio, d.mes, d.dia, 23, 59, 59);       // «Hasta»: 23:59:59 de México
  let sab = 1; while (h(sab).diaSemana !== 6 && sab < 8) sab++;       // el próximo sábado
  const tres = h(3);
  const anuncios = [
    {
      id: idEstable('anc', 'encuesta-capacitacion'), formato: 'tarjeta', activo: 1, orden: 1, desde: desde(h(-2)), hasta: hasta(tres), autor: sup, creado: aHorarioLaboral(az, haceMin(2 * 1440 + 250)),
      datos: { tono: 'info', titulo: 'Queremos tu opinión: horario de la capacitación', descripcion: 'Una pregunta rápida para decidir cuándo hacemos la próxima capacitación de cotizaciones.',
        imagenUrl: '', vigencia: 'Responde antes del ' + fechaLarga(tres),
        encuesta: { pregunta: '¿Qué horario te acomoda para la capacitación?', opciones: ['Por la mañana', 'Después de comer', 'Al final del turno'], tiempo: '30 segundos',
          cierre: ymd(tres), verAntes: false } }
    },
    {
      id: idEstable('anc', 'banner-mantenimiento'), formato: 'banner', activo: 1, orden: 2, desde: desde(h(-1)), hasta: hasta(h(sab)), autor: sup2, creado: aHorarioLaboral(az, haceMin(1 * 1440 + 200)),
      datos: { tono: 'warn', mensaje: 'Mantenimiento programado: el ' + fechaLarga(h(sab)) + ', de 8:00 a 11:00 h, el sistema no estará disponible. Guarda y envía tus cotizaciones antes.' }
    },
    {
      id: idEstable('anc', 'destacado-capacitacion'), formato: 'destacado', activo: 1, orden: 3, desde: desde(h(2)), hasta: hasta(h(2)), autor: sup, creado: aHorarioLaboral(az, haceMin(300)),
      datos: { tono: 'info', titulo: 'Capacitación de cotizaciones', cuerpo: 'El ' + fechaLarga(h(2)) + ', a las 16:00 h, repasamos el flujo completo de cotización y revisión. Confirma tu asistencia con tu supervisor.', icono: 'calendar' }
    },
    {
      id: idEstable('anc', 'tarjeta-promos-vencida'), formato: 'tarjeta', activo: 1, orden: 4, desde: desde(h(-20)), hasta: hasta(h(-5)), autor: sup2, creado: aHorarioLaboral(az, haceMin(20 * 1440 + 120)),
      datos: { tono: 'ok', titulo: 'Promociones de temporada', descripcion: 'Antes de cotizar, revisa en el Monitor de promociones qué categorías tienen descuento vigente.', imagenUrl: '', vigencia: 'Terminó el ' + fechaLarga(h(-5)) }
    }
  ].map((a) => Object.assign(a, { responsable: a.autor.nombre, autor: a.autor.email }));

  // Votos de la encuesta: una fila por persona (quien vota otra vez cambia su opción). La persona de la demo no ha votado.
  const encuesta = anuncios[0];
  const votantes = az.barajar([...P.asesores.filter((a) => a.activo && a !== P.demo), ...P.supervisores]).slice(0, 8);
  const votos = votantes.map((p) => ({
    publicacion: encuesta.id, correo: p.email, opcion: az.pesos(encuesta.datos.encuesta.opciones, (o) => (o === 'Al final del turno' ? 4 : o === 'Por la mañana' ? 3 : 2)),
    fecha: aHorarioLaboral(az, new Date(Math.max(encuesta.creado.getTime() + 30 * MS_MIN, AHORA.getTime() - az.entero(20, 2 * 1440) * MS_MIN)))
  })).map((v) => (v.fecha > new Date(AHORA.getTime() - 5 * MS_MIN) ? Object.assign(v, { fecha: new Date(AHORA.getTime() - 25 * MS_MIN) }) : v));
  return { articulos, vistas, anuncios, votos };
}

function emitirContenido(S, C, grupos, P) {
  S.seccion('CONTENIDO · artículos, lecturas, publicaciones del Portal, votos y grupos', [
    'Artículos: contenido = JSON de bloques versionado ({v:1, bloques}) en la forma canónica de Articulos.gs (3 publicados y 1 borrador).',
    'Publicaciones: «Datos (JSON)» como lo arma buildDatos de anuncios.html; «Desde»/«Hasta» son inicio y fin de día de México en ISO UTC.',
    'Hay una encuesta activa con votos (la persona de la demo aún no vota), un banner, uno programado y uno ya vencido.',
    'Grupos: miembros = arreglo JSON de correos; creado_por/actualizado_por llevan el NOMBRE (como los escribe grupos.ts).'
  ]);
  for (const a of C.articulos) {
    S.fila('portal_articulos', { id: a.id, titulo: a.titulo, resumen: a.resumen, contenido: a.contenido, estado: a.estado, autores: a.autores, creado: iso(a.creado), editado: iso(a.editado), editado_por: a.editado_por });
  }
  for (const v of C.vistas) {
    S.fila('portal_articulos_vistas', { articulo_id: v.articulo_id, correo: v.correo, nombre: v.nombre, primera_vez: iso(v.primera_vez), ultima_vez: iso(v.ultima_vez), veces: v.veces });
  }
  for (const a of C.anuncios) {
    S.fila('portal_anuncios', { id: a.id, formato: a.formato, activo: a.activo, orden: a.orden, desde: iso(a.desde), hasta: iso(a.hasta), datos: JSON.stringify(a.datos), autor: a.autor, responsable: a.responsable, creado: iso(a.creado) });
  }
  for (const v of C.votos) S.fila('portal_votos', { publicacion: v.publicacion, correo: v.correo, opcion: v.opcion, fecha: iso(v.fecha) });
  for (const g of grupos) {
    const ultima = g.editado && g.editado > g.miembrosFijados ? { t: g.editado, por: g.editadoPor } : { t: g.miembrosFijados, por: g.creadoPor };
    S.fila('grupos', {
      id: g.id, nombre: g.nombre, detalle: g.detalle, miembros: JSON.stringify(g.miembros), creado: iso(g.creado), creado_por: g.creadoPor.nombre,
      actualizado: iso(ultima.t), actualizado_por: ultima.por.nombre
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ONBOARDING · qué tutorial vio cada persona (Onboarding.gs · onbMarcar)
// Maestro y supervisores ya los vieron todos; las cuentas de asesor quedan SIN ver (para enseñarlos en la demo).
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** pantalla → [versión del recorrido, cuántos pasos tiene] (los de cada pantalla .html: onbIniciar({pantalla, version, pasos})). */
const RECORRIDOS = {
  portal: [2, 9], promociones: [1, 5], anuncios: [1, 5], articulo: [1, 5], consola: [1, 5], consulta: [1, 3], correos_cliente: [1, 4],
  cotizacion: [1, 6], dashboard: [1, 5], supervision: [2, 4], operacion: [1, 5], portal_contenido: [1, 5], revision_cotizacion: [1, 5]
};

function generarOnboarding(P) {
  const az = new Azar('onboarding');
  const filas = [];
  for (const p of [...(P.maestro ? [P.maestro] : []), ...P.supervisores]) {
    const alta = p.alta ? new Date(p.alta) : new Date(AHORA.getTime() - 120 * MS_DIA);
    for (const [pantalla, [version, total]] of Object.entries(RECORRIDOS)) {
      const omitido = az.prob(0.12) && total > 2;
      const t = aHorarioLaboral(az, new Date(alta.getTime() + az.entero(1 * 1440, 40 * 1440) * MS_MIN));
      filas.push({ correo: p.email, pantalla, version, estado: omitido ? 'omitido' : 'completado', paso_final: omitido ? az.entero(1, total - 1) : total, total_pasos: total, actualizado: t });
    }
  }
  return filas;
}

function emitirOnboarding(S, filas) {
  S.seccion('ONBOARDING · tutoriales ya vistos', ['Maestro y supervisores: los 13 recorridos. Los asesores no tienen filas: les saldrán todos.']);
  for (const f of filas) S.fila('onboarding', { correo: f.correo, pantalla: f.pantalla, version: f.version, estado: f.estado, paso_final: f.paso_final, total_pasos: f.total_pasos, actualizado: iso(f.actualizado) });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TRAZABILIDAD · las seis secciones de la Homologación de Procesos (pruebas/trazabilidad_payload_20260926.json)
// ══════════════════════════════════════════════════════════════════════════════════════════════
const txt = (v) => (v === null || v === undefined ? '' : String(v));

function generarTrazabilidad() {
  const p = leerJsonPruebas('trazabilidad_payload_20260926.json');
  if (!p || !Array.isArray(p.secciones)) return null;
  const secciones = [], procesos = [];
  p.secciones.forEach((s, i) => {
    secciones.push({ id: txt(s.id), orden: i, prefijo: txt(s.prefijo), label: txt(s.label), etiqueta: txt(s.etiqueta), hoja: s.hoja == null ? null : String(s.hoja), tiene_avance: s.tieneAvance ? 1 : 0 });
    (s.procesos || []).forEach((x, j) => procesos.push({
      id: txt(x.id), seccion: txt(s.id), orden: j, num: txt(x.num), num_hoja: txt(x.numHoja), nombre: txt(x.nombre), reporte: txt(x.reporte),
      avance: txt(x.avance), solucion: txt(x.solucion), plataformas: txt(x.plataformas), observaciones: txt(x.observaciones)
    }));
  });
  return { secciones, procesos };
}

function emitirTrazabilidad(S, T) {
  S.seccion('TRAZABILIDAD · trazabilidad_secciones y trazabilidad_procesos', [
    'Salen de pruebas/trazabilidad_payload_20260926.json (que ya está en el repo): sección i → orden i; proceso j de la sección → orden j.',
    'Con eso fetchTrazabilidadData responde lo mismo que el payload de referencia.'
  ]);
  for (const s of T.secciones) S.fila('trazabilidad_secciones', s);
  for (const x of T.procesos) S.fila('trazabilidad_procesos', x);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BITÁCORA · BitacoraConsola (consolaBitacoraApuntar_ y sus llamadores)
// Se arma con eventos de varias secciones (grupos, difusiones, catálogo del Portal…) y se numera
// por fecha: la consola lee `ORDER BY id DESC`, así que el id más alto tiene que ser el más reciente.
// ══════════════════════════════════════════════════════════════════════════════════════════════
function armarBitacora(P, grupos, X) {
  const az = new Azar('bitacora');
  const B = X.bitacora;
  const maestro = P.maestro || P.supervisores[0];
  const sup = P.supervisores[0] || maestro, sup2 = P.supervisores[1] || sup;
  const evento = (t, quien, accion, objetivo, detalle, parte = 'demo') => B.push({ t, quien: quien.email, accion, objetivo, detalle, parte });
  const lab = (min) => aHorarioLaboral(az, haceMin(min));

  // Las altas de la demo: la maestra las dio de alta el día en que se crearon las cuentas (00_usuarios_demo.sql).
  for (const u of P.usuarios) {
    if (u === maestro || !u.alta) continue;
    evento(new Date(new Date(u.alta).getTime() + az.entero(4, 25) * MS_MIN), maestro, 'Persona dada de alta', u.email,
      'rol ' + u.rol + ' · aviso enviado');
  }
  // Ajustes (Consola.gs: «Ajuste cambiado», con el nombre del ajuste y «antes» → «después»).
  evento(lab(20 * 1440 + 310), maestro, 'Ajuste cambiado', 'Remitente de las cotizaciones', '"cotizacion@liverpool.com.mx" → "ventel@logidma.com"');
  evento(lab(19 * 1440 + 150), maestro, 'Ajuste cambiado', 'Nombre visible en los correos a clientes',
    '"Centro de Contacto Liverpool | Ventel" → "Centro de Contacto Liverpool (CCL) | Ventel"');
  // El formato CCL Liverpool pasa a ser el de por omisión el 13 de septiembre (las cotizaciones lo reflejan).
  const cambio = fechaMx(2026, 9, 11, 18, 10);
  if (cambio < new Date(AHORA.getTime() - MS_DIA)) evento(cambio, maestro, 'Formato habilitado', 'ccl_liverpool', '');
  // Una ventana de mantenimiento de «Correos a clientes», por la noche.
  {
    const t = enDia(diaMx(AHORA, -26), 20, 15, az.entero(0, 59), az.entero(0, 999));
    evento(t, maestro, 'Módulo apagado', 'Correos a clientes', 'en mantenimiento para todos menos los maestros');
    evento(new Date(t.getTime() + 25 * MS_MIN), maestro, 'Módulo encendido', 'Correos a clientes', 'de vuelta en servicio');
  }
  // La baja de la persona inactiva (toda su actividad en la demo es anterior).
  const bajas = P.asesores.filter((a) => !a.activo);
  bajas.forEach((b) => evento(FECHA_BAJA, maestro, 'Rol o accesos modificados', b.email, 'dado de baja'));
  // Contraseñas restablecidas por supervisión (a personas de su nivel hacia abajo).
  const activos = P.asesores.filter((a) => a.activo && a !== P.demo);
  evento(lab(47 * 1440 + 90), sup, 'Contraseña restablecida', az.elegir(activos).email, 'aviso enviado');
  evento(lab(13 * 1440 + 400), sup2, 'Contraseña restablecida', az.elegir(activos).email, 'aviso enviado');
  // La revisión maestra de la pestaña Salud.
  evento(lab(40 * 1440 + 200), maestro, 'Revisión del sistema', '', 'todo en orden');
  evento(lab(21 * 1440 + 100), maestro, 'Revisión del sistema', '', '1 problema(s)');
  evento(lab(6 * 1440 + 260), maestro, 'Revisión del sistema', '', 'todo en orden');
  // Dos consultas del explorador de datos (solo lectura).
  evento(lab(8 * 1440 + 150), maestro, 'Consulta de solo lectura (explorador de datos)', '', 'SELECT folio, estatus, total_general FROM cotizaciones ORDER BY timestamp DESC LIMIT 20');
  evento(lab(2 * 1440 + 380), maestro, 'Consulta de solo lectura (explorador de datos)', '', "SELECT tipo, COUNT(*) AS n FROM metricas_correos GROUP BY tipo");
  // Grupos: se crean, se fijan sus miembros y alguno se edita (Grupos.gs).
  for (const g of grupos) {
    evento(g.creado, g.creadoPor, 'Grupo creado', g.nombre, g.detalle || 'sin descripción');
    evento(g.miembrosFijados, g.creadoPor, 'Miembros de grupo', g.nombre, 'quedan ' + g.miembros.length + ' · +' + g.miembros.length);
    if (g.editado) evento(g.editado, g.editadoPor, 'Grupo editado', g.nombre, 'descripción');
  }
  return B;
}

function emitirBitacora(S, eventos, titulo) {
  S.seccion(titulo, ['Una fila por cambio; los ids van en orden cronológico (la consola lee «ORDER BY id DESC»).']);
  for (const e of eventos) S.fila('bitacora_consola', { id: e.id, fecha: iso(e.t), quien: e.quien, accion: e.accion, objetivo: e.objetivo, detalle: e.detalle });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CATÁLOGO DEL PORTAL · semilla/portal_ventel.json → 20_catalogo_portal.local.sql  (NO va a git)
// Se aplica lo mismo que hace PortalContenido.gs (PC_COLECCIONES + pcMapaColumnas_): cada campo
// busca SU columna por encabezado —en minúsculas, sin espacios sobrantes—, con «contiene» o, si el
// alias empieza por «=», con coincidencia exacta, y una columna solo se asigna UNA vez (gana el
// primer alias que encuentra columna, en el orden en que se declaran los campos).
// ══════════════════════════════════════════════════════════════════════════════════════════════
const PC_COLECCIONES_SEMILLA = [
  { id: 'herramientas', hoja: 'Herramientas', tabla: 'portal_herramientas', nombre: 'Herramientas', titulo: 'nombre',
    // Los dos campos con credenciales compartidas NO se siembran nunca, aunque algún día la hoja los traiga.
    vacias: ['como_acceder', 'claves'],
    campos: [
      { col: 'nombre', alias: ['nombre'] }, { col: 'enlace', alias: ['enlace', 'liga', 'link', 'url'], url: true },
      { col: 'como_acceder', alias: ['acceder', 'acceso', 'como'] }, { col: 'descripcion', alias: ['descr'] }, { col: 'claves', alias: ['clave'] }] },
  { id: 'plantillas', hoja: 'Plantillas', tabla: 'portal_plantillas', nombre: 'Plantillas de correo', titulo: 'titulo',
    campos: [
      { col: 'titulo', alias: ['titulo', 'título', 'nombre', 'plantilla'] }, { col: 'tipo', alias: ['tipo'] }, { col: 'asunto', alias: ['asunto', 'subject'] },
      { col: 'cuerpo', alias: ['cuerpo', 'body', 'mensaje', 'texto', 'contenido'] }, { col: 'consideraciones', alias: ['consider', 'nota', 'escalam', 'copia', 'observ'] }] },
  { id: 'formatos', hoja: 'Formatos', tabla: 'portal_formatos', nombre: 'Formatos', titulo: 'acceso',
    campos: [{ col: 'acceso', alias: ['acceso', 'nombre', 'formato'] }, { col: 'observaciones', alias: ['observ', 'nota'] }, { col: 'liga', alias: ['liga', 'enlace', 'link', 'url'], url: true }] },
  { id: 'presentaciones', hoja: 'Presentaciones', tabla: 'portal_presentaciones', nombre: 'Presentaciones', titulo: 'nombre',
    // El encabezado real dice «DESCRPCION» (sin la i): por eso el alias es «descr».
    campos: [{ col: 'nombre', alias: ['nombre'] }, { col: 'liga', alias: ['liga', 'enlace', 'link', 'url'], url: true }, { col: 'descripcion', alias: ['descr'] }] },
  { id: 'paqueterias', hoja: 'Paqueterias', tabla: 'portal_paqueterias', nombre: 'Paqueterías', titulo: 'nombre',
    campos: [{ col: 'nombre', alias: ['nombre'] }, { col: 'liga', alias: ['liga', 'enlace', 'link', 'url'], url: true }, { col: 'soms', alias: ['soms', 'sistema'] }] },
  { id: 'pdepago', hoja: 'PdePago', tabla: 'portal_pdepago', nombre: 'Planes de pago', titulo: 'nombre',
    campos: [{ col: 'nombre', alias: ['nombre'] }, { col: 'detalles', alias: ['detalle', 'descrip', 'info'] }, { col: 'liga', alias: ['liga', 'enlace', 'link', 'url', 'simulad'], url: true }] },
  { id: 'promociones', hoja: 'Promociones', tabla: 'portal_promociones', nombre: 'Promociones', titulo: 'categoria',
    campos: [
      { col: 'direccion', alias: ['direcci'] }, { col: 'categoria', alias: ['banner / carrusel', 'banner'] },
      { col: 'promocion', alias: ['promoción 2026', 'promocion 2026', 'promoción 202', 'promocion 202', '=promoción', '=promocion'] },
      { col: 'marca', alias: ['=marca'] }, { col: 'vigencia', alias: ['vigencia'] }, { col: 'liga', alias: ['liga'], url: true }],
    // Columnas que la hoja trae y la app no edita: se conservan (el Monitor lee «Desc Mkp» cuando «Promoción 2026» está vacía).
    extras: [
      { col: 'promocion_aa', alias: ['promoción aa', 'promocion aa'] }, { col: 'desc_mkp', alias: ['desc mkp'] }, { col: 'banners_home', alias: ['banners home'] },
      { col: 'skus', alias: ['skus mercader', 'skus'] }, { col: 'num_skus', alias: ['#skus', '# skus'] }] },
  { id: 'mkp', hoja: 'MKP', tabla: 'portal_mkp', nombre: 'Marketplace', titulo: 'categoria',
    campos: [
      { col: 'direccion', alias: ['direcci'] }, { col: 'categoria', alias: ['banner / carrusel', 'banner'] },
      { col: 'promocion_mkt', alias: ['promoción mktplace', 'mktplace'] }, { col: 'promocion', alias: ['=promoción', '=promocion'] },
      { col: 'vigencia', alias: ['vigencia'] }, { col: 'liga', alias: ['liga'], url: true }],
    extras: [{ col: 'skus', alias: ['skus'] }, { col: 'num_skus', alias: ['# de sku'] }] }
];

const pcNormHdr = (v) => String(v == null ? '' : v).toLowerCase().trim().replace(/\s+/g, ' ');

/** pcMapaColumnas_: campo → índice de columna (−1 = no existe). Misma regla de «una columna, una sola vez». */
function pcMapaColumnas(campos, encabezados) {
  const h = encabezados.map(pcNormHdr), tomadas = {}, mapa = {};
  for (const campo of campos) {
    let encontrada = -1;
    for (let a = 0; a < campo.alias.length && encontrada < 0; a++) {
      const exacto = campo.alias[a].charAt(0) === '=';
      const buscado = pcNormHdr(exacto ? campo.alias[a].slice(1) : campo.alias[a]);
      for (let c = 0; c < h.length; c++) {
        if (tomadas[c] || !h[c]) continue;
        if (exacto ? h[c] === buscado : h[c].indexOf(buscado) !== -1) { encontrada = c; break; }
      }
    }
    mapa[campo.col] = encontrada;
    if (encontrada > -1) tomadas[encontrada] = true;
  }
  return mapa;
}

const esUrl = (s) => /^https?:\/\//i.test(String(s == null ? '' : s).trim());
/** Una celda de la hoja como texto (los números van como texto: son columnas TEXT). */
const celdaTexto = (v) => (v === null || v === undefined ? '' : (typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v)));

function leerCatalogoJson() {
  const ruta = path.join(DIR_SEMILLA, 'portal_ventel.json');
  if (!fs.existsSync(ruta)) return null;
  const j = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  return j && j.hojas ? j : null;
}

/** Las filas de una colección ya convertidas a las columnas de su tabla. */
function filasDeColeccion(def, hoja) {
  const enc = hoja.encabezados || [], filas = hoja.filas || [], vinculos = hoja.vinculos || [];
  const mapa = pcMapaColumnas(def.campos.concat(def.extras || []), enc);
  const colId = enc.map(pcNormHdr).indexOf('id');
  const salida = [];
  filas.forEach((fila, i) => {
    const obj = {};
    for (const campo of def.campos.concat(def.extras || [])) {
      const idx = mapa[campo.col];
      let v = idx > -1 ? celdaTexto(fila[idx]) : '';
      // Regla de los hipervínculos: si lo escrito no es una dirección y la celda lleva un vínculo, vale el vínculo.
      if (campo.url && idx > -1 && !esUrl(v)) {
        const vin = (vinculos[i] || [])[idx];
        if (esUrl(vin)) v = String(vin);
      }
      obj[campo.col] = v;
    }
    for (const c of def.vacias || []) obj[c] = '';
    if (!Object.values(obj).some((x) => String(x).trim())) return;            // fila en blanco
    const id = colId > -1 ? celdaTexto(fila[colId]).trim() : '';
    salida.push(Object.assign({ id: id || idEstable(def.id.slice(0, 3), def.id + '|' + i), orden: i }, obj));
  });
  return salida;
}

/** «Anuncios»: la hora de la hoja es de México y no lleva zona → ISO UTC. «Datos (JSON)» pasa tal cual. */
function filasAnuncios(hoja) {
  const enc = (hoja.encabezados || []).map(pcNormHdr);
  const i = (n) => enc.indexOf(n);
  const salida = [];
  for (const fila of hoja.filas || []) {
    const id = celdaTexto(fila[i('id')]).trim();
    if (!id) continue;
    let datos = fila[i('datos (json)')];
    if (datos && typeof datos === 'object') datos = JSON.stringify(datos);
    datos = celdaTexto(datos).trim();
    try { JSON.parse(datos); } catch { datos = '{}'; }
    const act = fila[i('activo')];
    const activo = act === null || act === undefined || act === '' || act === true || ['true', 'si', 'sí', '1', 'x', 'activo'].includes(String(act).trim().toLowerCase());
    const fecha = (v) => { const d = aFechaMx(v); return d && !isNaN(d) ? iso(d) : null; };
    salida.push({
      id, formato: celdaTexto(fila[i('formato')]).trim().toLowerCase() || 'banner', activo: activo ? 1 : 0, orden: Number(fila[i('orden')]) || 0,
      desde: fecha(fila[i('desde')]), hasta: fecha(fila[i('hasta')]), datos, autor: celdaTexto(fila[i('autor')]).trim(),
      responsable: celdaTexto(fila[i('responsable')]).trim(), creado: fecha(fila[i('creado')])
    });
  }
  return salida;
}

function generarCatalogo(P, X) {
  const json = leerCatalogoJson();
  if (!json) return null;
  const az = new Azar('catalogo');
  const colecciones = {};
  for (const def of PC_COLECCIONES_SEMILLA) {
    const hoja = json.hojas[def.hoja];
    colecciones[def.id] = hoja ? filasDeColeccion(def, hoja) : [];
  }
  const anuncios = json.hojas.Anuncios ? filasAnuncios(json.hojas.Anuncios) : [];

  // Enlaces reportados (el botón «Reportar» de las tarjetas del Portal): sobre elementos reales del catálogo.
  const activos = P.asesores.filter((a) => a.activo);
  const reportes = [];
  const pone = (dias, hora, seccion, fila, nombreCol, enlaceCol) => {
    if (!fila) return;
    const t = enDia(diaMx(AHORA, -dias), hora, az.entero(0, 59), az.entero(0, 59), az.entero(0, 999));
    if (t > AHORA) return;
    reportes.push({ id: idEstable('rep', seccion + '|' + fila[nombreCol] + '|' + dias), orden: reportes.length + 1, fecha: t, seccion, nombre: fila[nombreCol], enlace: fila[enlaceCol] || '', usuario: az.elegir(activos).email });
  };
  const con = (lista, col) => lista.filter((f) => f[col]);
  pone(15, 11, 'Herramientas', az.elegir(con(colecciones.herramientas, 'enlace')), 'nombre', 'enlace');
  pone(9, 16, 'Paqueterías', az.elegir(con(colecciones.paqueterias, 'liga')), 'nombre', 'liga');
  pone(4, 13, 'Formatos', az.elegir(con(colecciones.formatos, 'liga')), 'acceso', 'liga');
  pone(1, 10, 'Herramientas', az.elegir(con(colecciones.herramientas, 'enlace')), 'nombre', 'enlace');

  // Lo que la consola apunta cuando se edita el contenido del Portal («Portal · <sección>» y el rótulo de la fila).
  const sup = P.supervisores[0] || P.maestro, sup2 = P.supervisores[1] || sup;
  const lab = (min) => aHorarioLaboral(az, haceMin(min));
  const algun = (lista, col) => (lista.length ? lista[az.entero(0, lista.length - 1)][col] : '');
  const evento = (t, quien, accion, seccion, detalle) => X.bitacora.push({ t, quien: quien.email, accion, objetivo: 'Portal · ' + seccion, detalle, parte: 'catalogo' });
  const nPromos = colecciones.promociones.length;
  if (colecciones.herramientas.length) evento(lab(31 * 1440 + 200), sup, 'Portal: edición de contenido', 'Herramientas', algun(colecciones.herramientas, 'nombre'));
  if (colecciones.plantillas.length) evento(lab(22 * 1440 + 330), sup2, 'Portal: alta de contenido', 'Plantillas de correo', algun(colecciones.plantillas, 'titulo'));
  if (colecciones.paqueterias.length) evento(lab(17 * 1440 + 120), sup, 'Portal: edición de contenido', 'Paqueterías', algun(colecciones.paqueterias, 'nombre'));
  if (colecciones.formatos.length) {
    const f = algun(colecciones.formatos, 'acceso');
    evento(lab(11 * 1440 + 260), sup2, 'Portal: duplicado de contenido', 'Formatos', f + ' (copia)');
    evento(lab(11 * 1440 + 200), sup2, 'Portal: baja de contenido', 'Formatos', f + ' (copia)');
  }
  if (nPromos) evento(lab(5 * 1440 + 150), sup, 'Portal: importación', 'Promociones', '6 altas · 21 actualizadas · ' + Math.max(0, nPromos - 27) + ' sin cambios · 0 duplicadas · 0 con error');
  return { colecciones, anuncios, reportes };
}

function emitirCatalogo(S, K) {
  S.seccion('CATÁLOGO DEL PORTAL · real, de la hoja «Portal Ventel»', [
    'Cada pestaña es una tabla portal_*; «orden» = la posición de la fila en la hoja (0 = la primera). Los encabezados se localizan con',
    'los mismos alias que PortalContenido.gs. Herramientas: «Como acceder» y «Claves» (credenciales) quedan VACÍAS. Se recarga entera.'
  ]);
  for (const def of PC_COLECCIONES_SEMILLA) S.cruda('DELETE FROM ' + def.tabla);
  S.cruda('DELETE FROM portal_reportes');
  for (const def of PC_COLECCIONES_SEMILLA) {
    for (const f of K.colecciones[def.id]) {
      const fila = { id: f.id, orden: f.orden };
      for (const campo of def.campos.concat(def.extras || [])) fila[campo.col] = f[campo.col];
      S.fila(def.tabla, fila);
    }
  }
  for (const a of K.anuncios) S.fila('portal_anuncios', Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null)));
  for (const r of K.reportes) S.fila('portal_reportes', { id: r.id, orden: r.orden, fecha: iso(r.fecha), seccion: r.seccion, nombre: r.nombre, enlace: r.enlace, usuario: r.usuario });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BANDEJA DE SALIDA · correos_salida (nucleo/correo.ts + cotizaciones/correos.ts · sendQuoteByEmail)
// Los clientes son de ejemplo, así que el núcleo NO manda nada: cada correo queda entero en la bandeja con estado
// «omitido». Se siembran los últimos envíos de cotización con el HTML aprobado, para que la bandeja no esté vacía.
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ── Copia del HTML APROBADO del correo de cotización (cotizaciones/plantillas.ts: tarjetaProductoHtml y cuerpoCorreoCotizacionHtml) ──
// Se copia aquí, tal cual, para que los correos de ejemplo de la bandeja de salida sean idénticos a los que arma sendQuoteByEmail.
const escaparHtml = (texto) => String(texto == null ? '' : texto).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const formatCurrencyGS = (amount) => { const n = parseFloat(String(amount)); return isNaN(n) ? '$0.00' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }); };
const FMT_FECHA_LARGA = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'long', year: 'numeric', timeZone: ZONA });
const fechaLargaMx = (v) => { const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? 'Invalid Date' : FMT_FECHA_LARGA.format(d); };

function tarjetaProductoHtml(v) {
  const { p, verifiedImgUrl, unitPrice, quantity, costPaymentUnique, totalMonetaryDiscount,
          effectiveTotalPercentage, finalPricePerLine } = v;
  return `
          <!-- CARD DE PRODUCTO INDIVIDUAL -->
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" id="lineItems LIV">
            <tbody style="background:#F7F7F7;">
              <tr align="left" style="background:#F7F7F7; width: 100%;">
                <td style="background:#F7F7F7;width:5%;"></td>
                <td style="background:#fff;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0,0,0,0.15);margin:0 auto;padding:15px;width:90%;">
                  <table cellpadding="0" cellspacing="0" style="width:100%;background:#fff;">
                    <tbody>
                      <tr>
                        <!-- Imagen del producto (Left) -->
                        <td align="center" width="35%" valign="top" style="padding-top:10px;padding-right:15px;text-align:center;">
                          <img style="max-width:140px;width:100%;height:auto;border-radius:4px;border:1px solid #f0f0f0;" alt="Liverpool Product" src="${escaparHtml(verifiedImgUrl)}">
                        </td>
                        <!-- Detalles del producto (Right) -->
                        <td valign="top" style="font-family:sans-serif;color:#333;">
                          <h2 style="color:#333;font-size:15px;margin:10px 0 6px 0;font-weight:bold;line-height:1.4;">
                            ${escaparHtml(p.description)}
                          </h2>
                          <p style="color:#666;font-size:12px;margin:0 0 10px 0;">
                            Código de producto: <strong>${escaparHtml(p.sku)}</strong>
                          </p>
                          
                          <!-- Tabla interna de precios -->
                          <table cellpadding="0" cellspacing="0" style="width:100%;font-size:12px;color:#555;border-top:1px dashed #eee;padding-top:8px;">
                            <tr>
                              <td style="width:50%;padding-bottom:5px;">
                                Precio unitario:<br>
                                <span style="color:#333;font-weight:bold;font-size:13px;">${formatCurrencyGS(unitPrice)}</span>
                              </td>
                              <td style="width:50%;padding-bottom:5px;">
                                Cantidad:<br>
                                <span style="color:#333;font-weight:bold;font-size:13px;">${quantity}</span>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding-bottom:5px;">
                                Promoción:<br>
                                <span style="color:#333;font-weight:bold;">${costPaymentUnique > 0 ? 'PAGO ÚNICO' : 'PRECIO BASE'}</span>
                              </td>
                              <td style="padding-bottom:5px;">
                                Descuento:<br>
                                <span style="color:${totalMonetaryDiscount > 0.001 ? '#ef4444' : '#333'};font-weight:bold;">
                                  ${totalMonetaryDiscount > 0.001 ? `-${formatCurrencyGS(totalMonetaryDiscount)} (${effectiveTotalPercentage.toFixed(0)}%)` : '$0.00'}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td colspan="2" style="border-top:1px solid #eee;padding-top:8px;">
                                <p style="color:#666;font-size:12px;margin:0;">Total artículo: <span style="color:#f00;font-weight:bold;font-size:14px;margin-left:5px;">${formatCurrencyGS(finalPricePerLine)}</span></p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td style="background:#F7F7F7;width:5%;"></td>
              </tr>
            </tbody>
          </table>
        `;
}

function cuerpoCorreoCotizacionHtml(quote, productsHtml, userMessageHtml) {
  return `
      <!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
      <html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Tu Cotización está Lista</title>
        <style type="text/css">
          body {
            font-family: sans-serif;
            margin: 0 auto !important;
            padding: 0 !important;
            background: #F7F7F7;
            max-width: 650px;
          }
        </style>
      </head>
      <body bgcolor="#F7F7F7" style="background-color: #F7F7F7; margin: 0 auto !important; padding: 0 !important; font-family: sans-serif; max-width: 650px;">
        <table width="100%" border="0" cellpadding="0" cellspacing="0" align="center" style="background-color: #F7F7F7;">
          <tbody>
            <tr>
              <td align="center" valign="top" style="padding-top: 20px;">
                
                <!-- TOP HEADER LOGO (Liverpool banner) -->
                <table width="100%" cellspacing="0" cellpadding="0" role="presentation" style="max-width: 650px;">
                  <tbody>
                    <tr>
                      <td align="center" style="background-color: #F7F7F7;">
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Liverpool_logo.svg/1280px-Liverpool_logo.svg.png" alt="Liverpool - Es parte de mi vida" style="display: block; padding: 10px 0; text-align: center; height: auto; max-width: 160px; margin: 0 auto; border: 0;">
                      </td>
                    </tr>
                  </tbody>
                </table>

                <!-- HEADER: ¡TU COTIZACIÓN ESTÁ LISTA! -->
                <table align="center" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" id="LIV Order">
                  <tbody style="background:#F7F7F7;">
                    <tr align="center" style="background:#F7F7F7;">
                      <td style="width:5%;"></td>
                      <td style="background:#FFF;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0, 0, 0, 0.15);margin:0 auto;padding:25px;width:90%;text-align:center;">
                        <h1 style="margin: 0; color:#333;font-size:24px;font-weight:bold;font-family:sans-serif;">
                          ¡Tu cotización está lista!
                        </h1>
                        <p style="color:#666; margin:15px 0 0 0; font-size:14px; line-height:1.5; font-family:sans-serif; text-align:center;">
                          Te compartimos los detalles de la cotización que solicitaste. Los precios e indicaciones se detallan a continuación.
                        </p>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- ADVISOR'S CUSTOM MESSAGE CARD -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" id="advisorMessageCard">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7;">
                      <td style="width:5%;"></td>
                      <td style="background:#fff;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0,0,0,0.15);margin:0 auto;padding:18px;width:90%;font-family:sans-serif;font-size:14px;color:#333;line-height:1.5;">
                        <p style="margin:0 0 10px 0;font-weight:bold;color:#e10098;font-size:14px;">Mensaje de tu Asesor:</p>
                        <div style="background:#fdf2f8;border-left:4px solid #e10098;padding:12px 16px;border-radius:0 4px 4px 0;color:#4c4c4c;line-height:1.5;">
                          ${userMessageHtml}
                        </div>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- NOTICE BANNER (Yellow alert box) -->
                <table style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" cellpadding="0" cellspacing="0" border="0" id="noticeAlert">
                  <tbody style="background:#f7f7f7;">
                    <tr style="background:#f7f7f7;">
                      <td style="width:5%;"></td>
                      <td style="background:#F7F7F7; width:90%;">
                        <table cellpadding="0" cellspacing="0" style="width:100%;">
                          <tr>
                            <td style="border-left:5px solid #ffd457; background:#fff4d4; padding:12px 15px; border-radius: 0 4px 4px 0; font-size:13px; color:#665c40; font-family:sans-serif; text-align:left; line-height:1.4;">
                              <strong>Nota importante:</strong> Los precios y promociones están sujetos a cambios sin previo aviso. Esta cotización tiene fines informativos y la disponibilidad de los artículos se garantiza al concretar la compra.
                            </td>
                          </tr>
                        </table>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- GENERAL DATES & TOTALS CARD -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" id="datesAndTotals">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7;">
                      <td style="width:5%;"></td>
                      <td style="background:#fff;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0,0,0,0.15);margin:0 auto;padding:15px;width:90%;">
                        <table cellpadding="0" cellspacing="0" style="background:#fff;width:100%;font-size:13px;font-family:sans-serif;">
                          <tbody>
                            <tr>
                              <td width="50%" align="left" style="color:#333;">
                                Fecha de emisión: <span style="font-weight:700;">${fechaLargaMx(quote.timestamp)}</span>
                              </td>
                              <td width="50%" align="right" style="color:#333;">
                                Total cotizado: <span style="font-weight:700;color:#e10098;font-size:15px;">${formatCurrencyGS(quote.summaryTotal)}</span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- SUMMARY BLOCK HEADER: CLIENTE Y ASESOR -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 15px;margin-bottom:5px;" id="clientAdvisorHeader">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7;">
                      <td style="background:#F7F7F7;width:5%;"></td>
                      <td style="background:#F7F7F7;width:90%;">
                        <h3 style="border-bottom:2px solid #e10098;color:#FFF;font-size:15px;font-weight:normal;margin:0;font-family:sans-serif;">
                          <span style="background:#e10098;display:table-cell;height:30px;line-height:30px;padding:3px 16px 0;border-radius:4px 4px 0 0;">
                            Información del Cliente y Asesor
                          </span>
                        </h3>
                      </td>
                      <td style="background:#F7F7F7;width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- SUMMARY BLOCK CONTENT: CLIENTE Y ASESOR -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-bottom:10px;" id="clientAdvisorContent">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7; width: 100%;">
                      <td style="background:#F7F7F7;width:5%;"></td>
                      <td style="background:#FFF;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0, 0, 0, 0.15);margin:0 auto;padding:15px;width:90%;font-family:sans-serif;font-size:13px;line-height:1.5;color:#333;">
                        <table cellpadding="0" cellspacing="0" style="width:100%;">
                          <tr>
                            <td width="48%" valign="top" style="border-right:1px solid #eee;padding-right:10px;">
                              <p style="margin:2px 0;color:#e10098;font-weight:bold;font-size:13px;">Dirigido a:</p>
                              <p style="margin:2px 0;"><strong>Cliente:</strong> ${escaparHtml(quote.clientName || 'N/A')}</p>
                              <p style="margin:2px 0;"><strong>Correo:</strong> ${escaparHtml(quote.clientEmail || 'N/A')}</p>
                              <p style="margin:2px 0;"><strong>Teléfono:</strong> ${escaparHtml(quote.clientPhone || 'N/A')}</p>
                            </td>
                            <td width="4%">&nbsp;</td>
                            <td width="48%" valign="top" style="padding-left:10px;">
                              <p style="margin:2px 0;color:#e10098;font-weight:bold;font-size:13px;">Atendido por:</p>
                              <p style="margin:2px 0;"><strong>Asesor:</strong> ${escaparHtml(quote.advisorName || 'N/A')}</p>
                              <p style="margin:2px 0;"><strong>Folio:</strong> ${escaparHtml(quote.folio || 'N/A')}</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                      <td style="background:#F7F7F7;width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- SECTION HEADER: TUS PRODUCTOS -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 15px;margin-bottom:5px;" id="productsHeader">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7;">
                      <td style="background:#F7F7F7;width:5%;"></td>
                      <td style="background:#F7F7F7;width:90%;">
                        <h3 style="border-bottom:2px solid #e10098;color:#FFF;font-size:15px;font-weight:normal;margin:0;font-family:sans-serif;">
                          <span style="background:#e10098;display:table-cell;height:30px;line-height:30px;padding:3px 16px 0;border-radius:4px 4px 0 0;">
                            Detalle de Artículos
                          </span>
                        </h3>
                      </td>
                      <td style="background:#F7F7F7;width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- PRODUCTS LIST LOOP -->
                ${productsHtml}

                <!-- TOTALS SUMMARY CARD -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" id="totalsSummary">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7;">
                      <td style="width:5%;"></td>
                      <td style="background:#fff;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0,0,0,0.15);margin:0 auto;padding:15px;width:90%;">
                        <table cellpadding="0" cellspacing="0" style="background:#fff;width:100%;font-size:13px;font-family:sans-serif;color:#333;">
                          <tbody>
                            <tr>
                              <td align="right" style="padding: 4px 0;color:#666;">Subtotal:</td>
                              <td align="right" width="30%" style="padding: 4px 0;font-weight:700;">${formatCurrencyGS(quote.summarySubtotal)}</td>
                            </tr>
                            <tr>
                              <td align="right" style="padding: 4px 0;color:#666;">IVA (16%):</td>
                              <td align="right" style="padding: 4px 0;font-weight:700;">${formatCurrencyGS(quote.summaryVat)}</td>
                            </tr>
                            <tr style="font-size:15px;font-weight:bold;color:#e10098;">
                              <td align="right" style="border-top:1.5px solid #e10098;padding-top:10px;margin-top:5px;">TOTAL GENERAL:</td>
                              <td align="right" style="border-top:1.5px solid #e10098;padding-top:10px;margin-top:5px;color:#e10098;font-size:16px;">${formatCurrencyGS(quote.summaryTotal)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- EMAIL FOOTER INFO -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 20px;margin-bottom:20px;" id="footerInfo">
                  <tbody style="background:#F7F7F7;">
                    <tr align="center" style="background:#F7F7F7;">
                      <td style="width:5%;"></td>
                      <td style="font-family:sans-serif;font-size:11px;color:#888;line-height:1.5;text-align:center;width:90%;">
                        <p style="margin: 0 0 10px 0;"><strong>Nota:</strong> Se adjunta a este correo el archivo PDF oficial con la cotización formal detallada para su descarga o impresión.</p>
                        <p style="margin: 0 0 15px 0;font-weight:bold;color:#e10098;font-size:12px;">Liverpool - Es parte de mi vida</p>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

              </td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
}

const CORREOS_SALIDA_EJEMPLO = 12;
const PLACEHOLDER_IMAGEN = 'https://assets.liverpool.com.mx/assets/images/placeholder.gif';

/** El correo de una cotización, armado igual que sendQuoteByEmail (mismas tarjetas, misma fórmula de descuentos, mismo marco). */
function htmlCorreoCotizacion(q, mensaje) {
  let productsHtml = '';
  for (const l of q.lineas) {
    const p = aFormaApp(l);
    const unitPrice = parseFloat(p.unitPrice) || 0, quantity = parseInt(p.quantity) || 0;
    const priceVolume = unitPrice * quantity;
    const costPaymentUnique = parseFloat(p.costPaymentUnique) || 0;
    const discountPublicPercent = parseFloat(p.discountPublicPercent) || 0;
    const additionalDiscountApplied = p.additionalDiscountApplied === 'Si';
    const additionalDiscountPercent = parseFloat(p.additionalDiscountPercent) || 0;
    let finalPricePerLine;
    if (costPaymentUnique > 0 && quantity > 0 && unitPrice > 0) finalPricePerLine = costPaymentUnique;
    else {
      const priceAfterPublic = Math.max(0, priceVolume * (1 - discountPublicPercent / 100));
      finalPricePerLine = (additionalDiscountApplied && additionalDiscountPercent > 0) ? priceAfterPublic * (1 - additionalDiscountPercent / 100) : priceAfterPublic;
      finalPricePerLine = Math.max(0, finalPricePerLine);
    }
    const totalMonetaryDiscount = priceVolume - finalPricePerLine;
    const effectiveTotalPercentage = priceVolume > 0 ? (totalMonetaryDiscount / priceVolume) * 100 : 0;
    // getVerifiedImageUrl: la foto del producto si la trae; si no, la de los servidores de imágenes de Liverpool (o su imagen vacía).
    const verifiedImgUrl = l.imagen || (l.real ? `https://ss628.liverpool.com.mx/xl/${encodeURIComponent(l.sku)}.jpg` : PLACEHOLDER_IMAGEN);
    productsHtml += tarjetaProductoHtml({ p, verifiedImgUrl, unitPrice, quantity, costPaymentUnique, totalMonetaryDiscount, effectiveTotalPercentage, finalPricePerLine });
  }
  const quote = {
    timestamp: iso(q.tGuardado), summaryTotal: q.totales.total, summarySubtotal: q.totales.subtotal, summaryVat: q.totales.iva,
    clientName: q.cliente.nombre, clientEmail: q.cliente.correo, clientPhone: q.cliente.telefono, advisorName: q.asesor.nombre, folio: q.folio
  };
  // Sin la sangría de la plantilla (no cambia cómo se ve el correo; solo adelgaza el archivo de semilla).
  return cuerpoCorreoCotizacionHtml(quote, productsHtml, escaparHtml(mensaje).replace(/\n/g, '<br>')).replace(/\n[ \t]+/g, '\n');
}

function generarCorreosSalida(C) {
  const az = new Azar('bandeja');
  return C.envios.slice().sort((a, b) => a.t - b.t).slice(-CORREOS_SALIDA_EJEMPLO).map((e) => {
    const q = e.q;
    // El mensaje que propone la pantalla «Enviar correo» (correoventel.html); casi todos firman con su nombre.
    const mensaje = `Estimado(a) ${q.cliente.nombre},\n\nJunto con saludar, y como seguimiento a nuestra conversación, le hago llegar la cotización solicitada con folio ${q.folio}.\n\nQuedo a sus órdenes para cualquier duda o aclaración.\n\nSaludos cordiales,` +
      (az.prob(0.7) ? '\n' + q.asesor.nombre : '');
    return { t: e.t, para: e.para, asunto: e.asunto, responderA: q.asesor.email, folio: q.folio, html: htmlCorreoCotizacion(q, mensaje) };
  });
}

function emitirCorreosSalida(S, lista) {
  S.seccion('BANDEJA DE SALIDA · correos_salida', [
    'Los últimos ' + lista.length + ' envíos de cotización, con el HTML aprobado. estado «omitido» y detalle «Dato de ejemplo» (los clientes son @ejemplo.com: no sale nada).',
    'Sin id: la bandeja asigna el suyo, y la limpieza del principio solo borra lo marcado con «Dato de ejemplo» (nunca un correo real).'
  ]);
  for (const c of lista) {
    S.fila('correos_salida', {
      fecha: iso(c.t), de: REMITENTE_COTIZACIONES, nombre_de: 'Cotizaciones Ventel Liverpool', responder_a: c.responderA, para: c.para.join(', '), cc: '', cco: '',
      asunto: c.asunto, html: c.html, texto: '',
      adjuntos: JSON.stringify([{ nombre: `Cotizacion_${c.folio}.pdf — no adjuntado: esta versión de demostración no genera el PDF (Google Drive)`, tipo: 'application/pdf', bytes: 0 }]),
      tipo: 'cotizacion', referencia: c.folio, estado: 'omitido', proveedor_id: '', detalle: 'Dato de ejemplo'
    }, 'INSERT');
  }
}


// ══════════════════════════════════════════════════════════════════════════════════════════════
// ENSAMBLE · limpieza + todas las secciones → 10_demo.sql y 20_catalogo_portal.local.sql
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Tablas que 10_demo.sql vacía antes de llenarlas: así reaplicarla refresca las fechas sin duplicar nada. */
const LIMPIEZA_DEMO = ['detalle_cotizaciones', 'cotizaciones', ["contadores", "clave LIKE 'folio:%'"], ['correos_salida', "detalle = 'Dato de ejemplo'"], 'metricas_correos', 'metricas_busquedas', 'correos_enviados',
  'operacion_actualizaciones', 'operacion_reportes', 'operacion_incidentes', 'operacion_catalogo', 'atenciones_pendientes', 'atenciones_tipos', 'bitacora_consola',
  'grupos', 'onboarding', 'portal_articulos', 'portal_articulos_vistas', 'portal_votos', 'trazabilidad_procesos', 'trazabilidad_secciones'];

function encabezadoArchivo(titulo, extra) {
  return [titulo, 'Generado por scripts/sembrar.mjs (node scripts/sembrar.mjs) — NO se edita a mano: se regenera.',
    '«Ahora» de esta corrida: ' + iso(AHORA) + ' (' + ymd(HOY) + ', hora de México). Todas las fechas son relativas a él.', ...extra];
}

function ensamblar() {
  const P = prepararPersonas();
  const X = { bitacora: [] };

  // ── Todo lo que se calcula (sin escribir nada todavía) ──────────────────────────────────────
  const G = generarCotizaciones(P);
  const grupos = planGrupos(P);
  const C = generarCorreos(P, G, X, grupos);
  const CS = generarCorreosSalida(C);
  const B = generarBusquedas(P, G);
  const O = generarOperacion(P);
  const T = generarAtenciones(P, G);
  const N = generarContenido(P, grupos);
  const OB = generarOnboarding(P);
  const Z = generarTrazabilidad();
  armarBitacora(P, grupos, X);
  const K = generarCatalogo(P, X);                  // null si no está portal_ventel.json
  // La bitácora se numera por fecha, con los eventos de los dos archivos mezclados.
  X.bitacora.sort((a, b) => a.t - b.t).forEach((e, i) => { e.id = i + 1; });

  // ── 10_demo.sql ──────────────────────────────────────────────────────────────────────────────
  const demo = new Salida('10_demo.sql', encabezadoArchivo('Datos de la demo — TODO FICTICIO (clientes, folios, correos @ejemplo.com, incidentes, atenciones…).', [
    'Al empezar VACÍA las tablas que llena (no toca cuentas, permisos, ajustes ni el catálogo del Portal) y las vuelve a cargar: aplicarla otra vez',
    'refresca las fechas. En una base nueva (scripts/dev-aislado.sh) esa limpieza no borra nada.']));
  demo.seccion('0 · LIMPIEZA (la demo se recarga entera)');
  for (const t of LIMPIEZA_DEMO) {
    const [tabla, donde] = Array.isArray(t) ? t : [t, ''];
    if (!ESQUEMA[tabla]) throw new Error('Limpieza: la tabla «' + tabla + '» no existe en 0001_esquema.sql.');
    demo.cruda('DELETE FROM ' + tabla + (donde ? ' WHERE ' + donde : ''));
  }
  demo.cruda('DELETE FROM portal_anuncios WHERE id IN (' + N.anuncios.map((a) => lit(a.id)).join(', ') + ')');
  emitirCotizaciones(demo, G, P);
  emitirCorreos(demo, C);
  emitirCorreosSalida(demo, CS);
  emitirBusquedas(demo, B);
  emitirOperacion(demo, O);
  emitirAtenciones(demo, T);
  emitirContenido(demo, N, grupos, P);
  emitirOnboarding(demo, OB);
  if (Z) emitirTrazabilidad(demo, Z); else console.warn('AVISO: no encontré pruebas/trazabilidad_payload_20260926.json; Trazabilidad queda sin sembrar.');
  emitirBitacora(demo, X.bitacora.filter((e) => e.parte === 'demo'), 'BITÁCORA · BitacoraConsola');

  // ── 20_catalogo_portal.local.sql ─────────────────────────────────────────────────────────────
  let catalogo = null;
  if (K) {
    catalogo = new Salida('20_catalogo_portal.local.sql', encabezadoArchivo('Catálogo REAL del Portal (de la hoja «Portal Ventel») — NO va a git: el repo es público.', [
      'Sale de semilla/portal_ventel.json (sin contraseñas ni datos de clientes). Va DESPUÉS de 10_demo.sql: sus apuntes de bitácora entran con ids',
      'que se intercalan por fecha con los de 10_demo.sql.']));
    emitirCatalogo(catalogo, K);
    emitirBitacora(catalogo, X.bitacora.filter((e) => e.parte === 'catalogo'), 'BITÁCORA · cambios al contenido del Portal (con el nombre real de lo que se tocó)');
  } else {
    console.warn('AVISO: no encontré semilla/portal_ventel.json; no se genera 20_catalogo_portal.local.sql (el Portal arranca sin herramientas ni plantillas).');
  }
  return { demo, catalogo };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// COMPROBACIÓN · aplica todo a una base en memoria (node:sqlite) y revisa las columnas JSON
// ══════════════════════════════════════════════════════════════════════════════════════════════
function autoverificar(archivos) {
  let DatabaseSync;
  try {
    const orig = process.emitWarning;
    process.emitWarning = (w, ...a) => (/sqlite/i.test(String(w)) ? undefined : orig.call(process, w, ...a));
    ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite'));
    process.emitWarning = orig;
  } catch { console.log('· Sin node:sqlite en esta versión de Node: me salto la comprobación en memoria.'); return true; }
  const db = new DatabaseSync(':memory:');
  const migraciones = path.join(RAIZ, 'migrations');
  for (const f of fs.readdirSync(migraciones).filter((x) => x.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(migraciones, f), 'utf8'));
  const usuarios = path.join(DIR_SEMILLA, '00_usuarios_demo.sql');
  if (fs.existsSync(usuarios)) db.exec(fs.readFileSync(usuarios, 'utf8'));
  const errores = [];
  for (const a of archivos) {
    try { db.exec(a.texto()); } catch (e) { errores.push(a.archivo + ': ' + e.message); }
  }
  // Las columnas JSON tienen que ser JSON de verdad.
  const json = [['cotizaciones', 'revision_checklist', true], ['portal_anuncios', 'datos'], ['portal_articulos', 'contenido'], ['grupos', 'miembros'], ['operacion_reportes', 'evidencias']];
  for (const [tabla, col, vacioOk] of json) {
    for (const f of db.prepare(`SELECT ${col} AS v FROM ${tabla}`).all()) {
      if (vacioOk && !f.v) continue;
      try { JSON.parse(f.v); } catch { errores.push(`${tabla}.${col} no es JSON: ${String(f.v).slice(0, 60)}`); break; }
    }
  }
  // Sin fechas en el futuro (salvo lo programado a propósito) y sin folios repetidos.
  const futuro = db.prepare('SELECT COUNT(*) n FROM cotizaciones WHERE timestamp > ?').get(iso(AHORA)).n;
  if (futuro) errores.push(futuro + ' cotización(es) con fecha posterior a «ahora».');
  if (errores.length) { for (const e of errores) console.error('✘ ' + e); return false; }
  console.log('· Comprobación en memoria: las migraciones y las semillas cargan sin error y las columnas JSON son JSON.');
  return true;
}

function main() {
  const { demo, catalogo } = ensamblar();
  const escribe = (S, nombre) => {
    fs.writeFileSync(path.join(DIR_SEMILLA, nombre), S.texto());
    const total = Object.values(S.conteo).reduce((a, b) => a + b, 0);
    console.log(`\n${nombre}  (${Math.round(S.texto().length / 1024)} KB, ${total} filas)`);
    for (const [t, n] of Object.entries(S.conteo)) console.log('  ' + String(n).padStart(5) + '  ' + t);
  };
  if (SOLO !== 'catalogo') escribe(demo, '10_demo.sql');
  if (SOLO !== 'demo' && catalogo) escribe(catalogo, '20_catalogo_portal.local.sql');
  if (!ARGS['sin-validar']) {
    const todos = [];
    for (const [S, n] of [[demo, '10_demo.sql'], [catalogo, '20_catalogo_portal.local.sql']]) if (S) todos.push(S);
    if (!autoverificar(todos)) process.exitCode = 1;
  }
}

main();
