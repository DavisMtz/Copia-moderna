/**
 * =================================================================================================
 * FUNCIONES NUEVAS DE LA VERSIÓN CLOUDFLARE | Portal Ventel
 * =================================================================================================
 * No existían en Apps Script: las usa el explorador de la base de datos (?page=datos, una app React
 * en src/react/datos) y solo las puede llamar el rol MAESTRO. Todas empiezan por secIdentidadMaestra.
 *
 *   datosTablas(email)                          → las tablas de D1, con sus filas y sus columnas
 *   datosFilas(email, tabla, {pagina, porPagina, orden, dir, filtro})  → filas paginadas
 *   datosFila(email, tabla, rowid)              → una fila entera (sin recortar)
 *   datosConsulta(email, sql)                   → consola de SOLO LECTURA
 *   datosCorreos(email, {pagina, porPagina, filtro, tipo}) → la bandeja de salida (sin cuerpo)
 *   datosCorreo(email, id)                      → un correo completo: lo que recibió el cliente, y si
 *                                                 salió de verdad por Brevo (estado, id, detalle)
 *
 * LO SECRETO NO SALE, NI PARA EL MAESTRO. Las columnas secretas (registros.password_hash,
 * sesiones.huella, cualquier columna *hash*, *huella*, *llave*, *token*… y las contraseñas compartidas
 * de portal_herramientas) ni siquiera se leen de D1: se piden como NULL y se pintan como «oculto». En
 * `propiedades` lo secreto es el VALOR de las claves que lo parecen (HASH_SALT, webhooks, códigos
 * cta_…). Tampoco se puede filtrar ni ordenar por lo secreto: un filtro «empieza por a» sobre un hash
 * sería un oráculo para adivinarlo letra a letra.
 *
 * Cada respuesta dice lo que costó en D1 (`d1`): ms = ida y vuelta desde el Worker hasta la base,
 * sql = lo que tardó la base en ejecutar (meta.duration), filasLeidas = rows_read, consultas = viajes.
 * Es la prueba, en la demo, de que una consulta cuesta milisegundos.
 * =================================================================================================
 */
import type { Ctx } from '../nucleo/contexto';
import type { FuncionRpc } from '../rpc';
import { secIdentidadMaestra } from '../nucleo/seguridad';
import { apuntarBitacora } from '../nucleo/sistema';
import { recortar } from '../nucleo/util';

// ── Puerta ───────────────────────────────────────────────────────────────────────────────────────

type Fallo = { success: false; codigo: 'SIN_SESION' | 'SIN_PERMISO' | 'NO_VALIDO'; message: string };

/** Solo el maestro. SIN_SESION si no hay nadie detrás de la llave; SIN_PERMISO si lo hay, pero no es maestro. */
async function puerta(ctx: Ctx, emailCliente: unknown): Promise<{ ok: true; email: string } | { ok: false; fallo: Fallo }> {
  const id = await secIdentidadMaestra(ctx, emailCliente);
  if (id.ok) return { ok: true, email: id.email };
  return { ok: false, fallo: { success: false, codigo: id.email ? 'SIN_PERMISO' : 'SIN_SESION', message: id.error } };
}

function noValido(message: string): Fallo {
  return { success: false, codigo: 'NO_VALIDO', message };
}

// ── Medir lo que cuesta D1 ───────────────────────────────────────────────────────────────────────

interface MedidaD1 { ms: number; sql: number; filasLeidas: number; consultas: number }

class Cronometro {
  ms = 0; sql = 0; filasLeidas = 0; consultas = 0; bytes = 0;
  apuntar(desde: number, metas: Array<Partial<D1Meta> | undefined>): void {
    this.ms += Date.now() - desde;
    for (const m of metas) {
      if (!m) continue;
      this.sql += Number(m.duration) || 0;
      this.filasLeidas += Number(m.rows_read) || 0;
      if (Number(m.size_after) > 0) this.bytes = Number(m.size_after);
      this.consultas++;
    }
  }
  resumen(): MedidaD1 {
    return { ms: this.ms, sql: Math.round(this.sql * 100) / 100, filasLeidas: this.filasLeidas, consultas: this.consultas };
  }
}

async function todas<T = Record<string, unknown>>(ctx: Ctx, crono: Cronometro, st: D1PreparedStatement): Promise<T[]> {
  ctx.consultas++;
  const t0 = Date.now();
  const r = await st.all<T>();
  crono.apuntar(t0, [r.meta]);
  return r.results || [];
}

/** Varias sentencias en UNA ida a D1. */
async function lote(ctx: Ctx, crono: Cronometro, sts: D1PreparedStatement[]): Promise<Array<Array<Record<string, unknown>>>> {
  if (!sts.length) return [];
  ctx.consultas++;
  const t0 = Date.now();
  const rs = await ctx.db.batch<Record<string, unknown>>(sts);
  crono.apuntar(t0, rs.map((r) => r.meta));
  return rs.map((r) => r.results || []);
}

// ── El esquema, leído de la propia base ─────────────────────────────────────────────────────────

interface Columna { nombre: string; tipo: string; pk: number; nn: boolean }
interface Tabla { nombre: string; columnas: Columna[]; conRowid: boolean }

/** Tablas internas de SQLite, de D1 (_cf_KV, _cf_METADATA, d1_migrations) y de Cloudflare: fuera. */
const INTERNA = /^(sqlite_|_cf_|d1_)/i;

/** Comillas de identificador SQL. Los nombres salen de sqlite_master, pero igual se escapan. */
function ident(nombre: string): string {
  return '"' + String(nombre).replace(/"/g, '""') + '"';
}

/**
 * Tablas y columnas en UNA consulta. Las internas se quitan ANTES de pedir sus columnas (MATERIALIZED
 * obliga a filtrar primero): D1 no deja ni mirar las columnas de _cf_* (SQLITE_AUTH).
 */
async function esquema(ctx: Ctx, crono: Cronometro): Promise<Map<string, Tabla>> {
  const filas = await todas<{ tabla: string; sin_rowid: number; columna: string; tipo: string; pk: number; nn: number }>(ctx, crono, ctx.db.prepare(
    'WITH t AS MATERIALIZED (' +
    "  SELECT name, instr(upper(sql), 'WITHOUT ROWID') > 0 AS sin_rowid FROM sqlite_master" +
    "  WHERE type = 'table' AND substr(name, 1, 4) <> '_cf_' AND substr(lower(name), 1, 7) <> 'sqlite_'" +
    "    AND substr(lower(name), 1, 3) <> 'd1_'" +
    ') SELECT t.name AS tabla, t.sin_rowid AS sin_rowid, p.name AS columna, p.type AS tipo, p.pk AS pk, p."notnull" AS nn ' +
    'FROM t JOIN pragma_table_info(t.name) p ORDER BY t.name, p.cid'));
  const mapa = new Map<string, Tabla>();
  for (const f of filas) {
    if (INTERNA.test(f.tabla)) continue;
    let t = mapa.get(f.tabla);
    if (!t) {
      t = { nombre: f.tabla, columnas: [], conRowid: !Number(f.sin_rowid) };
      mapa.set(f.tabla, t);
    }
    t.columnas.push({ nombre: f.columna, tipo: String(f.tipo || ''), pk: Number(f.pk) || 0, nn: !!f.nn });
  }
  return mapa;
}

// ── Lo secreto ───────────────────────────────────────────────────────────────────────────────────

/** Una columna con este nombre guarda un secreto, esté en la tabla que esté. */
const NOMBRE_SECRETO = /hash|huella|llave|token|secret|passw|contrase/i;
/** …salvo estas, que solo lo parecen: registros.password_temporal es un Sí/No. */
const NO_SECRETAS = new Set(['password_temporal']);

/** Secretos que el nombre no delata: las contraseñas compartidas de las herramientas (PRODUCT.md). */
const SECRETAS_POR_TABLA: Record<string, string[]> = {
  portal_herramientas: ['claves', 'como_acceder']
};

function nombreSecreto(columna: string): boolean {
  return NOMBRE_SECRETO.test(columna) && !NO_SECRETAS.has(columna.toLowerCase());
}

function columnaSecreta(tabla: string, columna: string): boolean {
  return nombreSecreto(columna) || (SECRETAS_POR_TABLA[tabla] || []).indexOf(columna) !== -1;
}

/**
 * En `propiedades` (PropertiesService) el secreto es el valor de ciertas claves: HASH_SALT, los
 * webhooks del Chat, los códigos de cuenta (cta_…), las sesiones viejas de Apps Script (ses_…).
 */
const TROZOS_PROPIEDAD_SECRETA = ['hash', 'salt', 'huella', 'llave', 'token', 'secret', 'passw', 'contrase', 'clave',
  'webhook', 'apikey', 'api_key', 'privad'];
const PREFIJOS_PROPIEDAD_SECRETA = ['cta_', 'ses_'];

/** La misma regla en SQL, para que D1 ni siquiera devuelva el valor (y para filtrar sin oráculo). */
const SQL_PROPIEDAD_SECRETA = '(' +
  TROZOS_PROPIEDAD_SECRETA.map((t) => "instr(lower(\"clave\"), '" + t + "') > 0")
    .concat(PREFIJOS_PROPIEDAD_SECRETA.map((p) => "substr(lower(\"clave\"), 1, " + p.length + ") = '" + p + "'"))
    .join(' OR ') + ')';

function valorPropiedadSecreto(tabla: string, columna: string): boolean {
  return tabla === 'propiedades' && columna === 'valor';
}

/** ¿Se puede filtrar u ordenar por esta columna sin revelar nada? */
function ordenable(tabla: string, columna: string): boolean {
  return !columnaSecreta(tabla, columna) && !valorPropiedadSecreto(tabla, columna);
}

// ── Celdas ───────────────────────────────────────────────────────────────────────────────────────

type Celda = string | number | null
  | { $oculto: true }
  | { $cortado: string; largo: number }
  | { $blob: number };

const OCULTO: Celda = { $oculto: true };
/** Caracteres por celda en la rejilla (la fila entera llega sin recortar con datosFila). */
const CORTE_REJILLA = 160;
/** Tope por celda incluso al pedir la fila entera: un HTML de correo puede pesar mucho. */
const CORTE_FILA = 200000;

function celda(v: unknown, corte: number): Celda {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return { $blob: v.byteLength };
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return { $blob: (v as ArrayLike<number>).length }; // D1 da los BLOB como bytes
  const s = String(v);
  return s.length > corte ? { $cortado: s.slice(0, corte), largo: s.length } : s;
}

function entero(v: unknown, respaldo: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : respaldo;
}

/**
 * La lista del SELECT de una tabla: lo secreto se pide como NULL (nunca sale de D1) y el valor de
 * `propiedades` solo cuando su clave no parece secreta, con una marca para pintarlo «oculto».
 */
function listaSelect(t: Tabla): string {
  const partes = t.conRowid ? ['rowid AS "__rowid"'] : [];
  for (const c of t.columnas) {
    if (columnaSecreta(t.nombre, c.nombre)) partes.push('NULL AS ' + ident(c.nombre));
    else if (valorPropiedadSecreto(t.nombre, c.nombre)) {
      partes.push('CASE WHEN ' + SQL_PROPIEDAD_SECRETA + ' THEN NULL ELSE "valor" END AS "valor"');
      partes.push(SQL_PROPIEDAD_SECRETA + ' AS "__secreta"');
    } else partes.push(ident(c.nombre));
  }
  return partes.join(', ');
}

function celdasDeFila(t: Tabla, fila: Record<string, unknown>, corte: number): Celda[] {
  return t.columnas.map((c) => {
    if (columnaSecreta(t.nombre, c.nombre)) return OCULTO;
    if (valorPropiedadSecreto(t.nombre, c.nombre) && Number(fila.__secreta)) return OCULTO;
    return celda(fila[c.nombre], corte);
  });
}

function columnasPublicas(t: Tabla) {
  return t.columnas.map((c) => ({
    nombre: c.nombre, tipo: c.tipo, pk: c.pk,
    oculta: columnaSecreta(t.nombre, c.nombre) ? 'siempre' : (valorPropiedadSecreto(t.nombre, c.nombre) ? 'a veces' : ''),
    ordenable: ordenable(t.nombre, c.nombre)
  }));
}

// ── 1 · Las tablas ───────────────────────────────────────────────────────────────────────────────

export async function datosTablas(ctx: Ctx, emailCliente?: unknown) {
  const p = await puerta(ctx, emailCliente);
  if (!p.ok) return p.fallo;
  const crono = new Cronometro();
  const esq = await esquema(ctx, crono);
  const lista = [...esq.values()];
  // Un COUNT por tabla, todos en una sola ida a D1.
  const conteos = await lote(ctx, crono, lista.map((t) => ctx.db.prepare('SELECT COUNT(*) AS n FROM ' + ident(t.nombre))));
  return {
    success: true,
    tablas: lista.map((t, i) => ({
      nombre: t.nombre,
      filas: Number((conteos[i] && conteos[i][0] && conteos[i][0].n) || 0),
      columnas: columnasPublicas(t)
    })),
    bytes: crono.bytes,
    d1: crono.resumen()
  };
}

// ── 2 · Filas de una tabla ───────────────────────────────────────────────────────────────────────

export async function datosFilas(ctx: Ctx, emailCliente: unknown, tabla: unknown, opciones?: unknown) {
  const p = await puerta(ctx, emailCliente);
  if (!p.ok) return p.fallo;
  const crono = new Cronometro();
  // Leer el esquema es trámite (2-3 ms): `d1` cuenta solo la consulta que pidió la persona.
  const esq = await esquema(ctx, new Cronometro());
  const t = esq.get(String(tabla || ''));
  if (!t) return noValido('No existe la tabla «' + recortar(tabla, 80) + '».');

  const o = (opciones && typeof opciones === 'object' ? opciones : {}) as Record<string, unknown>;
  const porPagina = Math.min(200, Math.max(1, entero(o.porPagina, 50)));
  const pagina = Math.max(1, entero(o.pagina, 1));
  const filtro = String(o.filtro == null ? '' : o.filtro).trim().slice(0, 200);
  const dir = String(o.dir || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const pedido = String(o.orden || '');
  const orden = t.columnas.some((c) => c.nombre === pedido) && ordenable(t.nombre, pedido) ? pedido : '';

  // Filtro de texto sobre lo que se puede ver. El valor de una propiedad secreta tampoco cuenta.
  let donde = '';
  const params: string[] = [];
  if (filtro) {
    const patron = '%' + filtro.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const condiciones: string[] = [];
    for (const c of t.columnas) {
      if (columnaSecreta(t.nombre, c.nombre)) continue;
      const como = 'CAST(' + ident(c.nombre) + " AS TEXT) LIKE ? ESCAPE '\\'";
      condiciones.push(valorPropiedadSecreto(t.nombre, c.nombre) ? '(NOT ' + SQL_PROPIEDAD_SECRETA + ' AND ' + como + ')' : como);
      params.push(patron);
    }
    if (condiciones.length) donde = ' WHERE (' + condiciones.join(' OR ') + ')';
  }

  const llaveOrden = t.conRowid ? 'rowid' : (t.columnas.filter((c) => c.pk).map((c) => ident(c.nombre)).join(', ') || '1');
  const ordenSql = ' ORDER BY ' + (orden ? ident(orden) + ' ' + dir + ', ' : '') + llaveOrden + (orden ? '' : ' ' + dir);
  const desde = (pagina - 1) * porPagina;

  const [filas, total] = await lote(ctx, crono, [
    ctx.db.prepare('SELECT ' + listaSelect(t) + ' FROM ' + ident(t.nombre) + donde + ordenSql + ' LIMIT ? OFFSET ?')
      .bind(...params, porPagina, desde),
    ctx.db.prepare('SELECT COUNT(*) AS n FROM ' + ident(t.nombre) + donde).bind(...params)
  ]);

  return {
    success: true,
    tabla: t.nombre,
    columnas: columnasPublicas(t),
    filas: filas.map((f) => ({ rowid: t.conRowid ? Number(f.__rowid) : null, celdas: celdasDeFila(t, f, CORTE_REJILLA) })),
    total: Number((total[0] && total[0].n) || 0),
    pagina, porPagina, orden, dir: dir.toLowerCase(), filtro,
    d1: crono.resumen()
  };
}

// ── 3 · Una fila entera ──────────────────────────────────────────────────────────────────────────

export async function datosFila(ctx: Ctx, emailCliente: unknown, tabla: unknown, rowid: unknown) {
  const p = await puerta(ctx, emailCliente);
  if (!p.ok) return p.fallo;
  const crono = new Cronometro();
  // Leer el esquema es trámite (2-3 ms): `d1` cuenta solo la consulta que pidió la persona.
  const esq = await esquema(ctx, new Cronometro());
  const t = esq.get(String(tabla || ''));
  if (!t) return noValido('No existe la tabla «' + recortar(tabla, 80) + '».');
  if (!t.conRowid) return noValido('Esta tabla no tiene rowid: ábrela desde la rejilla.');
  const id = entero(rowid, NaN);
  if (!Number.isFinite(id)) return noValido('Fila no válida.');
  const filas = await todas(ctx, crono,
    ctx.db.prepare('SELECT ' + listaSelect(t) + ' FROM ' + ident(t.nombre) + ' WHERE rowid = ?').bind(id));
  if (!filas.length) return noValido('Esa fila ya no existe.');
  const celdas = celdasDeFila(t, filas[0], CORTE_FILA);
  return {
    success: true,
    tabla: t.nombre,
    rowid: id,
    campos: columnasPublicas(t).map((c, i) => ({ ...c, valor: celdas[i] })),
    d1: crono.resumen()
  };
}

// ── 4 · Consola de solo lectura ──────────────────────────────────────────────────────────────────

/** Filas que devuelve la consola como mucho (se pide una más para saber si había más). */
const LIMITE_CONSOLA = 200;
const LARGO_MAX_CONSULTA = 5000;

/**
 * Palabras que no caben en una consulta de lectura. La consulta además tiene que EMPEZAR por SELECT o
 * WITH y se ejecuta dentro de `SELECT * FROM ( … ) LIMIT n`: en SQLite un INSERT/UPDATE/DELETE ni
 * siquiera se puede escribir ahí dentro, así que aunque algo se colara aquí, D1 lo rechazaría.
 */
const PROHIBIDAS = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'UPSERT', 'MERGE', 'CREATE', 'DROP', 'ALTER',
  'TRUNCATE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'REINDEX', 'ANALYZE', 'BEGIN', 'COMMIT', 'ROLLBACK',
  'SAVEPOINT', 'RELEASE', 'TRANSACTION', 'GRANT', 'REVOKE', 'LOAD_EXTENSION']);

type TipoFicha = 'palabra' | 'ident' | 'cadena' | 'numero' | 'simbolo' | 'param';
interface Ficha { tipo: TipoFicha; texto: string; valor: string }

/**
 * Parte la consulta en fichas, respetando cadenas ('…'), identificadores entre comillas ("…", `…`,
 * […]) y comentarios. Devuelve también el SQL sin comentarios (es el que se ejecuta): un «-- …» al
 * final se comería el paréntesis del envoltorio.
 */
function fichas(sql: string): { fichas: Ficha[]; limpio: string } | { error: string } {
  const out: Ficha[] = [];
  let limpio = '';
  let i = 0;
  const n = sql.length;
  const cerrar = (abre: string, cierra: string, tipo: TipoFicha): string | null => {
    let j = i + 1;
    for (;;) {
      const k = sql.indexOf(cierra, j);
      if (k === -1) return null;
      if (cierra !== ']' && sql[k + 1] === cierra) { j = k + 2; continue; } // comilla doblada = escapada
      const texto = sql.slice(i, k + 1);
      const interior = texto.slice(1, -1);
      out.push({ tipo, texto, valor: cierra === ']' ? interior : interior.split(cierra + cierra).join(cierra) });
      limpio += texto;
      i = k + 1;
      return texto;
    }
  };
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { limpio += c; i++; continue; }
    if (c === '-' && sql[i + 1] === '-') {
      const f = sql.indexOf('\n', i);
      limpio += ' ';
      i = f === -1 ? n : f;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const f = sql.indexOf('*/', i + 2);
      if (f === -1) return { error: 'Hay un comentario «/*» sin cerrar.' };
      limpio += ' ';
      i = f + 2;
      continue;
    }
    if (c === "'") { if (cerrar("'", "'", 'cadena') === null) return { error: 'Hay un texto sin cerrar: falta una comilla «\'».' }; continue; }
    if (c === '"') { if (cerrar('"', '"', 'ident') === null) return { error: 'Falta cerrar unas comillas «"».' }; continue; }
    if (c === '`') { if (cerrar('`', '`', 'ident') === null) return { error: 'Falta cerrar una comilla «`».' }; continue; }
    if (c === '[') { if (cerrar('[', ']', 'ident') === null) return { error: 'Falta cerrar un corchete «[».' }; continue; }
    const num = /^(0x[0-9a-f]+|\d+(\.\d*)?(e[+-]?\d+)?|\.\d+(e[+-]?\d+)?)/i.exec(sql.slice(i, i + 64));
    if (num) { out.push({ tipo: 'numero', texto: num[0], valor: num[0] }); limpio += num[0]; i += num[0].length; continue; }
    if (/[A-Za-z_\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$\u0080-￿]/.test(sql[j])) j++;
      const texto = sql.slice(i, j);
      out.push({ tipo: 'palabra', texto, valor: texto });
      limpio += texto;
      i = j;
      continue;
    }
    if (c === '?' || ((c === ':' || c === '@' || c === '$') && /[A-Za-z0-9_]/.test(sql[i + 1] || ''))) {
      out.push({ tipo: 'param', texto: c, valor: c });
      limpio += c;
      i++;
      continue;
    }
    const doble = sql.slice(i, i + 3) === '->>' ? '->>' : (['||', '<=', '>=', '==', '!=', '<>', '<<', '>>', '->'].indexOf(sql.slice(i, i + 2)) !== -1 ? sql.slice(i, i + 2) : c);
    out.push({ tipo: 'simbolo', texto: doble, valor: doble });
    limpio += doble;
    i += doble.length;
  }
  return { fichas: out, limpio };
}

/** ¿Hay un `*` que expande columnas (SELECT *, t.*), y no una multiplicación ni un count(*)? */
function hayComodin(f: Ficha[]): boolean {
  for (let k = 0; k < f.length; k++) {
    if (f[k].texto !== '*') continue;
    const antes = f[k - 1];
    if (!antes) return true;
    const a = antes.tipo === 'palabra' ? antes.valor.toUpperCase() : antes.texto;
    if (a === 'SELECT' || a === 'DISTINCT' || a === 'ALL' || a === ',' || a === '.') return true;
    if (a === '(') {
      const fn = f[k - 2];
      if (fn && fn.tipo === 'palabra' && fn.valor.toLowerCase() === 'count') continue;
      return true;
    }
  }
  return false;
}

/** Traduce lo que contesta D1 cuando una consulta no se puede ejecutar. */
function errorDeD1(err: unknown): string {
  let m = String((err as any)?.message || err || '');
  m = m.replace(/^[\s\S]*?D1_ERROR:\s*/, '').replace(/:\s*SQLITE_[A-Z_]+\s*$/, '').trim();
  let x: RegExpExecArray | null;
  if ((x = /^no such table:\s*(.+)$/i.exec(m))) return 'No existe la tabla «' + x[1].replace(/^main\./, '') + '».';
  if ((x = /^no such column:\s*(.+)$/i.exec(m))) return 'No existe la columna «' + x[1] + '».';
  if ((x = /^no such function:\s*(.+)$/i.exec(m))) return 'D1 no conoce la función «' + x[1] + '».';
  if ((x = /near "([^"]*)": syntax error/i.exec(m))) return 'Error de sintaxis cerca de «' + x[1] + '».';
  if (/incomplete input/i.test(m)) return 'La consulta quedó incompleta.';
  if (/ambiguous column name:\s*(.+)/i.test(m)) return 'Hay una columna ambigua: ' + m.replace(/^.*ambiguous column name:\s*/i, '') + '. Ponle el nombre de su tabla delante.';
  if (/not authorized|access to .* is prohibited/i.test(m)) return 'D1 no deja leer eso.';
  return 'D1 contestó: ' + recortar(m || 'error desconocido', 300);
}

export async function datosConsulta(ctx: Ctx, emailCliente: unknown, sql: unknown) {
  const p = await puerta(ctx, emailCliente);
  if (!p.ok) return p.fallo;
  const texto = String(sql == null ? '' : sql);
  if (!texto.trim()) return noValido('Escribe una consulta.');
  if (texto.length > LARGO_MAX_CONSULTA) return noValido('La consulta es demasiado larga (máximo 5,000 caracteres).');

  const partida = fichas(texto);
  if ('error' in partida) return noValido(partida.error);
  const f = partida.fichas.slice();
  while (f.length && f[f.length - 1].texto === ';') f.pop();
  if (!f.length) return noValido('Escribe una consulta.');
  if (f.some((x) => x.texto === ';')) return noValido('Va una sola sentencia: quita el «;» del medio.');
  const primera = f[0].tipo === 'palabra' ? f[0].valor.toUpperCase() : '';
  if (primera !== 'SELECT' && primera !== 'WITH') {
    return noValido('Solo se permiten consultas de lectura: empieza con SELECT o WITH.');
  }

  const crono = new Cronometro();
  // Leer el esquema es trámite (2-3 ms): `d1` cuenta solo la consulta que pidió la persona.
  const esq = await esquema(ctx, new Cronometro());
  // Columnas secretas de TODA la base (por nombre) y lo secreto de cada tabla sensible.
  const secretasGlobales = new Set<string>();
  const sensibles = new Map<string, string[]>();
  for (const t of esq.values()) {
    const suyas = t.columnas.filter((c) => columnaSecreta(t.nombre, c.nombre)).map((c) => c.nombre.toLowerCase());
    suyas.forEach((c) => secretasGlobales.add(c));
    if (t.nombre === 'propiedades') suyas.push('valor');
    if (suyas.length) sensibles.set(t.nombre.toLowerCase(), suyas);
  }

  const nombres = new Set<string>();
  for (let k = 0; k < f.length; k++) {
    const x = f[k];
    if (x.tipo === 'param') return noValido('Escribe los valores dentro de la consulta: aquí no hay parámetros «' + x.texto + '».');
    if (x.tipo === 'palabra') {
      const u = x.valor.toUpperCase();
      // replace(texto, a, b) es una función de texto, no la sentencia REPLACE.
      if (PROHIBIDAS.has(u) && !(u === 'REPLACE' && f[k + 1] && f[k + 1].texto === '(')) {
        return noValido('«' + u + '» no está permitido: la consola es de solo lectura.');
      }
    }
    if (x.tipo === 'palabra' || x.tipo === 'ident' || x.tipo === 'cadena') {
      // SQLite acepta un nombre entre comillas simples donde no cabe un texto (FROM 'registros',
      // USING ('password_hash')): las cadenas también cuentan como nombres. Más vale un falso positivo.
      const v = x.valor.toLowerCase();
      nombres.add(v);
      if (/^_cf_/.test(v)) return noValido('Las tablas internas de Cloudflare (_cf_…) no se consultan.');
      if (secretasGlobales.has(v)) {
        return noValido('La consola no enseña «' + x.valor + '»: es un secreto. En la pestaña Tablas sale oculto.');
      }
    }
  }
  const comodin = hayComodin(f);
  for (const [tabla, secretas] of sensibles) {
    if (!nombres.has(tabla)) continue;
    const nombrada = secretas.find((c) => nombres.has(c));
    if (nombrada) return noValido('Con «' + tabla + '» no se puede pedir «' + nombrada + '»: guarda secretos. Míralo en la pestaña Tablas, donde sale oculto.');
    if (comodin) return noValido('Con «' + tabla + '» no se puede usar «*»: nombra las columnas que quieres ver (las secretas no se enseñan).');
  }

  const limpio = partida.limpio.replace(/[\s;]+$/, '');
  const ejecutada = 'SELECT * FROM (\n' + limpio + '\n) LIMIT ' + (LIMITE_CONSOLA + 1);
  let filas: Record<string, unknown>[];
  let columnas: string[];
  try {
    filas = await todas(ctx, crono, ctx.db.prepare(ejecutada));
    columnas = filas.length ? Object.keys(filas[0]) : [];
    // Sin filas no hay nombres; y un nombre numérico («1») desordena las claves de un objeto JS.
    if (!filas.length || columnas.some((c) => /^\d+$/.test(c))) {
      ctx.consultas++;
      const crudo = await ctx.db.prepare(ejecutada).raw({ columnNames: true });
      columnas = (crudo[0] as string[]) || [];
      const resto = crudo.slice(1) as unknown[][];
      filas = resto.map((arr) => Object.fromEntries(columnas.map((c, i) => [c, arr[i]])));
      // Con nombres repetidos, el objeto perdería columnas: se usan los arreglos tal cual.
      if (new Set(columnas).size !== columnas.length) {
        return respuestaConsulta(ctx, p.email, limpio, columnas, resto, crono);
      }
    }
  } catch (err) {
    return noValido(errorDeD1(err));
  }
  return respuestaConsulta(ctx, p.email, limpio, columnas, filas.map((fila) => columnas.map((c) => fila[c])), crono);
}

function respuestaConsulta(ctx: Ctx, email: string, limpio: string, columnas: string[], filas: unknown[][], crono: Cronometro) {
  const truncado = filas.length > LIMITE_CONSOLA;
  // Último candado: una columna que se llame como un secreto sale oculta aunque llegara aquí.
  const ocultas = columnas.map((c) => nombreSecreto(c));
  // Quién consultó qué: la consola lee datos de clientes y queda apuntado (después de contestar).
  ctx.despues(apuntarBitacora(ctx, email, 'Consulta de solo lectura (explorador de datos)', '', recortar(limpio, 500)));
  return {
    success: true,
    columnas,
    filas: filas.slice(0, LIMITE_CONSOLA).map((fila) => fila.map((v, i) => (ocultas[i] ? OCULTO : celda(v, 2000)))),
    truncado,
    limite: LIMITE_CONSOLA,
    d1: crono.resumen()
  };
}

// ── 5 · Bandeja de salida ────────────────────────────────────────────────────────────────────────

/** Los correos de cuenta llevan un código que vale 10 min (el vale de contraseña, 15). */
const MINUTOS_CODIGO_VIGENTE = 15;

function codigoVigente(tipo: unknown, referencia: unknown, fecha: unknown): string {
  if (String(tipo || '') !== 'cuenta' || String(referencia || '') === 'aviso') return '';
  const t = Date.parse(String(fecha || ''));
  if (!Number.isFinite(t)) return '';
  const hasta = t + MINUTOS_CODIGO_VIGENTE * 60000;
  return hasta > Date.now() ? new Date(hasta).toISOString() : '';
}

async function tieneEstadoDeEnvio(ctx: Ctx): Promise<boolean> {
  ctx.consultas++;
  const r = await ctx.db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('correos_salida') WHERE name = 'estado'").first<{ n: number }>();
  return Number(r && r.n) > 0;
}

function cuantosAdjuntos(json: unknown): number {
  try {
    const a = JSON.parse(String(json || '[]'));
    return Array.isArray(a) ? a.length : 0;
  } catch { return 0; }
}

export async function datosCorreos(ctx: Ctx, emailCliente: unknown, opciones?: unknown) {
  const p = await puerta(ctx, emailCliente);
  if (!p.ok) return p.fallo;
  const crono = new Cronometro();
  const o = (opciones && typeof opciones === 'object' ? opciones : {}) as Record<string, unknown>;
  const porPagina = Math.min(100, Math.max(1, entero(o.porPagina, 30)));
  const pagina = Math.max(1, entero(o.pagina, 1));
  const filtro = String(o.filtro == null ? '' : o.filtro).trim().slice(0, 200);
  const tipo = String(o.tipo == null ? '' : o.tipo).trim().slice(0, 60);

  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (filtro) {
    const patron = '%' + filtro.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const cols = ['asunto', 'para', 'cc', 'cco', 'de', 'nombre_de', 'referencia'];
    condiciones.push('(' + cols.map((c) => 'COALESCE(' + c + ", '') LIKE ? ESCAPE '\\'").join(' OR ') + ')');
    cols.forEach(() => params.push(patron));
  }
  if (tipo) { condiciones.push("COALESCE(tipo, '') = ?"); params.push(tipo); }
  const donde = condiciones.length ? ' WHERE ' + condiciones.join(' AND ') : '';

  // El estado del envío (Brevo) llegó con la migración 0009: sin ella, la bandeja se lee igual.
  const conEstado = await tieneEstadoDeEnvio(ctx);
  const [filas, total, tipos, estados] = await lote(ctx, crono, [
    ctx.db.prepare('SELECT id, fecha, de, nombre_de, para, cc, cco, asunto, tipo, referencia, adjuntos, ' +
      (conEstado ? 'estado, detalle, ' : '') +
      'length(html) AS bytes_html FROM correos_salida' + donde + ' ORDER BY id DESC LIMIT ? OFFSET ?')
      .bind(...params, porPagina, (pagina - 1) * porPagina),
    ctx.db.prepare('SELECT COUNT(*) AS n FROM correos_salida' + donde).bind(...params),
    ctx.db.prepare("SELECT COALESCE(tipo, '') AS tipo, COUNT(*) AS n FROM correos_salida GROUP BY 1 ORDER BY 2 DESC"),
    ctx.db.prepare(conEstado
      ? "SELECT COALESCE(estado, '') AS estado, COUNT(*) AS n FROM correos_salida GROUP BY 1 ORDER BY 2 DESC"
      : "SELECT '' AS estado, COUNT(*) AS n FROM correos_salida")
  ]);

  return {
    success: true,
    correos: filas.map((f) => ({
      id: Number(f.id), fecha: String(f.fecha || ''), de: String(f.de || ''), nombreDe: String(f.nombre_de || ''),
      para: String(f.para || ''), cc: String(f.cc || ''), cco: String(f.cco || ''), asunto: String(f.asunto || ''),
      tipo: String(f.tipo || ''), referencia: String(f.referencia || ''), adjuntos: cuantosAdjuntos(f.adjuntos),
      bytes: Number(f.bytes_html) || 0, codigoVigenteHasta: codigoVigente(f.tipo, f.referencia, f.fecha),
      estado: String(f.estado || ''), detalle: String(f.detalle || '')
    })),
    total: Number((total[0] && total[0].n) || 0),
    tipos: tipos.map((t) => ({ tipo: String(t.tipo || ''), n: Number(t.n) || 0 })),
    estados: estados.filter((e) => Number(e.n) > 0).map((e) => ({ estado: String(e.estado || ''), n: Number(e.n) || 0 })),
    pagina, porPagina, filtro, tipo,
    d1: crono.resumen()
  };
}

export async function datosCorreo(ctx: Ctx, emailCliente: unknown, id: unknown) {
  const p = await puerta(ctx, emailCliente);
  if (!p.ok) return p.fallo;
  const n = entero(id, NaN);
  if (!Number.isFinite(n)) return noValido('Correo no válido.');
  const crono = new Cronometro();
  const filas = await todas(ctx, crono, ctx.db.prepare('SELECT * FROM correos_salida WHERE id = ?').bind(n));
  const f = filas[0];
  if (!f) return noValido('Ese correo ya no está en la bandeja.');
  let adjuntos: Array<{ nombre: string; tipo: string; bytes: number }> = [];
  try {
    const a = JSON.parse(String(f.adjuntos || '[]'));
    if (Array.isArray(a)) adjuntos = a.map((x) => ({ nombre: String(x?.nombre || ''), tipo: String(x?.tipo || ''), bytes: Number(x?.bytes) || 0 }));
  } catch { adjuntos = []; }
  return {
    success: true,
    correo: {
      id: Number(f.id), fecha: String(f.fecha || ''), de: String(f.de || ''), nombreDe: String(f.nombre_de || ''),
      responderA: String(f.responder_a || ''), para: String(f.para || ''), cc: String(f.cc || ''), cco: String(f.cco || ''),
      asunto: String(f.asunto || ''), html: recortar(f.html, 2000000), texto: recortar(f.texto, 200000),
      adjuntos, tipo: String(f.tipo || ''), referencia: String(f.referencia || ''),
      codigoVigenteHasta: codigoVigente(f.tipo, f.referencia, f.fecha),
      // Qué pasó al mandarlo (nucleo/correo.ts): 'enviado' (Brevo, con su id), 'omitido' o 'error'.
      estado: String(f.estado || ''), proveedorId: String(f.proveedor_id || ''), detalle: String(f.detalle || '')
    },
    d1: crono.resumen()
  };
}

export const funciones: Record<string, FuncionRpc> = {
  datosTablas, datosFilas, datosFila, datosConsulta, datosCorreos, datosCorreo
};
