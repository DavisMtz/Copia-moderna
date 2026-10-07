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
    if (az.prob(0.05)) q.envios.push({ t: envio(new Date(q.envios[0].t.getTime() + az.entero(1, 3) * MS_DIA)) });   // un reenvío
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
  const metricas = [], enviados = [];
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
  return { metricas, enviados };
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
