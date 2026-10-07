/*
 * Prueba del módulo de REVISIÓN, POLÍTICA Y AUDITORÍA | Portal Ventel en Cloudflare
 * =================================================================================
 *   node pruebas/revision.test.mjs [baseUrl]          (por omisión http://127.0.0.1:8803)
 *
 * PARTE A — contra el servidor local, como lo haría la pantalla (POST /api/rpc → secEjecutar).
 *   Necesita el Worker levantado:  scripts/dev-aislado.sh revision 8803 &
 *   Prepara sus propias cotizaciones (folios LVP-990101-R00x) con `wrangler d1 execute` en la base
 *   local de ese servidor (ESTADO=.wrangler/estado-revision por omisión) y comprueba las formas de
 *   respuesta principales y las puertas: sin sesión no hay datos, un asesor no revisa ni toca la
 *   política, un supervisor sí. Deja la política como la encontró (la borra: rige la de arranque).
 *
 * PARTE B — los contratos internos, sin servidor. Empaqueta modulos/revision.ts con esbuild y lo
 *   corre sobre una D1 de mentira en memoria (node:sqlite) con las migraciones reales:
 *   revPuedeEnviarse, revpolDecidirAlGuardar, revpolSellarAprobacionAutomatica, audAuditar (los casos
 *   de audDiagnostico), y la DEGRADACIÓN cuando Liverpool bloquea o Brevo rechaza, con un fetch
 *   simulado (ningún byte sale a la red en esta parte). Se salta sola si falta node:sqlite o esbuild.
 *   SOLO_B=1 corre solo esta parte; SIN_B=1 la omite.
 *
 * Sin frameworks: un contador, ✔/✖ por línea y código de salida 1 si algo falla.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const CF = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'http://127.0.0.1:8803').replace(/\/$/, '');
const ESTADO = process.env.ESTADO || '.wrangler/estado-revision';
const CLAVE = 'VentelDemo2026';
const SUP = 'supervisora@ventel.example';
const ASESOR = 'asesor@ventel.example';

let ok = 0, mal = 0;
function comprueba(descripcion, condicion, detalle) {
  if (condicion) { ok++; console.log('  ✔ ' + descripcion); }
  else { mal++; console.log('  ✖ ' + descripcion + (detalle !== undefined ? '  → ' + JSON.stringify(detalle).slice(0, 400) : '')); }
}
const seccion = (t) => console.log('\n■ ' + t);
const mismasLlaves = (obj, llaves) => !!obj && JSON.stringify(Object.keys(obj).sort()) === JSON.stringify([...llaves].sort());

const URL_ANILLO = 'https://www.liverpool.com.mx/tienda/pdp/anillo-map-brillante/1182166315?skuid=1182166321';
const URLS_MALAS = [
  'javascript:alert(1)',
  'http://www.liverpool.com.mx/tienda/pdp/x/1',
  'https://evil.com/?x=liverpool.com.mx',
  'https://liverpool.com.mx.evil.com/x',
  'https://user:pass@www.liverpool.com.mx/x',
  'https://www.liverpool.com.mx/x" onload="alert(1)'
];
const MOTIVOS_DEGRADADOS = ['bloqueado', 'sin-red', 'no-existe', 'sin-precio', 'vacia', 'error'];
const IDS_PUNTOS = ['cliente-nombre', 'cliente-correo', 'cliente-telefono', 'asesor', 'precios', 'totales', 'articulos', 'vigencia'];

// ═════════════════════════════════════════════════════════════════════════════════════════
// PARTE A · contra el servidor local
// ═════════════════════════════════════════════════════════════════════════════════════════

async function postRpc(cuerpo) {
  const pedir = async () => (await fetch(BASE + '/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })).json();
  try {
    return await pedir();
  } catch (e) {
    // Fallo de RED (no de la función): wrangler dev se recarga cada vez que otro agente guarda un
    // archivo del Worker, y la petición que pilla la recarga se corta. Se reintenta una vez.
    await new Promise((r) => setTimeout(r, 2000));
    try { return await pedir(); } catch (e2) {
      throw new Error('sin respuesta del servidor (' + ((e2 && e2.cause && (e2.cause.code || e2.cause.message)) || e2.message) + ')');
    }
  }
}
const llaves = {};
/** Llama a una función como la pantalla. `como` = correo con sesión, o '' para ir sin sesión. */
async function rpc(como, fn, args) {
  let llave = '';
  if (como) {
    if (!llaves[como]) {
      const j = await postRpc({ fn: 'secEjecutar', args: ['', 'loginUser', [como, CLAVE], 0] });
      if (!j.ok || !j.v.success) throw new Error('login ' + como + ': ' + (j.e || j.v.message));
      llaves[como] = j.v.llave;
    }
    llave = llaves[como];
  }
  const j = await postRpc({ fn: 'secEjecutar', args: [llave, fn, args, Date.now()] });
  if (!j.ok) throw new Error(j.e);
  return j.v;
}

function wrangler(args) {
  return execFileSync('npx', ['wrangler', 'd1', 'execute', 'ventel-portal', '--local', '--persist-to', ESTADO, ...args],
    { cwd: CF, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function sqlConsulta(sql) {
  const salida = wrangler(['--json', '--command', sql]);
  return JSON.parse(salida.slice(salida.indexOf('[')))[0].results;
}

const q = (v) => v === null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
function filaCot(c) {
  const cols = Object.keys(c);
  return 'INSERT INTO cotizaciones (' + cols.join(', ') + ') VALUES (' + cols.map((k) => q(c[k])).join(', ') + ');';
}
function filaDet(folio, orden, p) {
  return 'INSERT INTO detalle_cotizaciones (folio_cotizacion, orden, sku, descripcion_producto, cantidad, precio_unitario_base, ' +
    'costo_pago_unico_linea, desc_publico_porcentaje, aplica_desc_adicional, porcentaje_desc_adicional, imagen_url, link_articulo) VALUES (' +
    [folio, orden, p.sku, p.desc, p.cant, p.precio, 0, p.descPub || 0, 'No', 0, p.img || '', p.url || ''].map(q).join(', ') + ');';
}

function prepararFixtures() {
  const ahora = new Date().toISOString();
  const hace10 = new Date(Date.now() - 10 * 86400000).toISOString();
  const base = { asesor_correo: ASESOR, asesor_nombre: 'Carlos Mendoza', extencion: '', observaciones: '', formato: 'actual' };
  const sql = [
    "DELETE FROM detalle_cotizaciones WHERE folio_cotizacion LIKE 'LVP-990101-R%';",
    "DELETE FROM cotizaciones WHERE folio LIKE 'LVP-990101-R%';",
    "DELETE FROM correos_salida WHERE referencia LIKE 'LVP-990101-R%';",
    "DELETE FROM propiedades WHERE clave = 'revision_politica_v1';",
    // R001 · sana, pendiente, un artículo con enlace de Liverpool y uno capturado a mano.
    filaCot({ ...base, folio: 'LVP-990101-R001', timestamp: ahora, cliente_nombre: 'María López Hernández',
      correo_cliente: 'maria.lopez@gmail.com', numero: '5512345678', subtotal: 541.64, iva: 86.66, total_general: 628.30,
      estatus: 'En Revisión', observaciones: 'Entrega en tienda Perisur' }),
    filaDet('LVP-990101-R001', 0, { sku: '1182166315', desc: 'Anillo redondo Map brillante', cant: 1, precio: 299, descPub: 30, url: URL_ANILLO }),
    filaDet('LVP-990101-R001', 1, { sku: '1099887766', desc: 'Juego de sartenes antiadherentes', cant: 1, precio: 419 }),
    // R002 · pendiente y con todo mal: correo con errata, teléfono de relleno, totales que no cuadran,
    // SKU repetido y enlaces que NO son de Liverpool (tienen que llegar vacíos a la pantalla).
    filaCot({ ...base, folio: 'LVP-990101-R002', timestamp: hace10, asesor_correo: 'sofia.herrera@ventel.example',
      asesor_nombre: 'Sofía Alejandra Herrera Vázquez', cliente_nombre: 'JUAN PEREZ', correo_cliente: 'juan@gmial.com',
      numero: '5555555555', subtotal: 100, iva: 16, total_general: 999, estatus: 'En Revisión', formato: 'ccl_liverpool' }),
    filaDet('LVP-990101-R002', 0, { sku: '1182166315', desc: 'Anillo Map', cant: 2, precio: 399, descPub: 10, url: 'https://evil.com/?x=liverpool.com.mx' }),
    filaDet('LVP-990101-R002', 1, { sku: '1182166315', desc: 'Anillo Map repetido', cant: 1, precio: 399, url: 'javascript:alert(1)' }),
    // R003 · ya enviada (cerrada aunque diga «Aprobada»). R004 · aprobada y con hoja CCL.
    filaCot({ ...base, folio: 'LVP-990101-R003', timestamp: hace10, cliente_nombre: 'Ana Ruiz', correo_cliente: 'ana@hotmail.com',
      numero: '3312345678', subtotal: 86.21, iva: 13.79, total_general: 100, estatus: 'Enviada por Correo',
      revision_estado: 'Aprobada', revisado_por: SUP, revisado_nombre: 'Laura Domínguez', revision_fecha: hace10, revision_notas: '' }),
    filaCot({ ...base, folio: 'LVP-990101-R004', timestamp: ahora, cliente_nombre: 'Pedro Gómez', correo_cliente: 'pedro@outlook.com',
      numero: '8112345678', subtotal: 86.21, iva: 13.79, total_general: 100, estatus: 'Aprobada', formato: 'ccl_liverpool',
      link_sheet_ccl: 'https://docs.google.com/spreadsheets/d/1l3cdEOUnD1Rgk1VCDfx48NWd_mcgIQ7Gkt2YhwbRs34/edit#gid=123',
      revision_estado: 'Aprobada', revisado_por: SUP, revisado_nombre: 'Laura Domínguez', revision_fecha: ahora, revision_notas: 'Todo en orden' }),
    filaDet('LVP-990101-R004', 0, { sku: '1011223344', desc: 'Batería de cocina', cant: 1, precio: 100 }),
    // R005 · pendiente, sin enlaces (todo capturado a mano): la que se rechaza.
    filaCot({ ...base, folio: 'LVP-990101-R005', timestamp: ahora, asesor_correo: 'jorge.ramirez@ventel.example', asesor_nombre: 'Jorge Ramírez',
      cliente_nombre: 'Lucía Torres', correo_cliente: 'lucia.torres@yahoo.com.mx', numero: '2221234567',
      subtotal: 862.07, iva: 137.93, total_general: 1000, estatus: 'En Revisión' }),
    filaDet('LVP-990101-R005', 0, { sku: '1077665544', desc: 'Licuadora Oster 10 velocidades', cant: 2, precio: 500 })
  ].join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'rev-fixtures-'));
  const archivo = join(dir, 'fixtures.sql');
  writeFileSync(archivo, sql);
  try { wrangler(['--file', archivo]); } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function parteA() {
  console.log('PARTE A · servidor ' + BASE + ' (base local ' + ESTADO + ')');
  try {
    const salud = await (await fetch(BASE + '/api/salud')).json();
    if (!salud.ok) throw new Error('D1 no contesta');
  } catch (e) {
    comprueba('el servidor local contesta en ' + BASE + ' (scripts/dev-aislado.sh revision 8803 &)', false, String(e.message || e));
    return;
  }
  prepararFixtures();

  seccion('Puertas: sin sesión no hay datos privados');
  const anonRev = await rpc('', 'getRevisionCotizacion', ['LVP-990101-R001', SUP]);
  comprueba('getRevisionCotizacion sin sesión → success:false, sinPermiso, sin datos',
    anonRev.success === false && anonRev.sinPermiso === true && !anonRev.quote, anonRev);
  const anonCola = await rpc('', 'revListaPendientes', [SUP]);
  comprueba('revListaPendientes sin sesión → success:false y cola vacía', anonCola.success === false && anonCola.quotes.length === 0, anonCola);
  const anonPol = await rpc('', 'getPoliticaRevision', [SUP]);
  comprueba('getPoliticaRevision sin sesión → success:false', anonPol.success === false && !anonPol.politica, anonPol);
  const anonFicha = await rpc('', 'revFichaArticulo', [URL_ANILLO, '1182166315', SUP]);
  comprueba('revFichaArticulo sin sesión → motivo sin-permiso (no es un relay abierto)', anonFicha.ok === false && anonFicha.motivo === 'sin-permiso', anonFicha);
  let noExpuesta = '';
  try { await rpc(SUP, 'revContarPendientes', [SUP]); } catch (e) { noExpuesta = e.message; }
  comprueba('revContarPendientes NO se expone (solo interna, como en Apps Script)', /no expone la función revContarPendientes/.test(noExpuesta), noExpuesta);

  seccion('Puertas: un asesor no revisa ni toca la política');
  const negadas = [
    ['revListaPendientes', [ASESOR], (r) => r.success === false && r.quotes.length === 0],
    ['getRevisionCotizacion', ['LVP-990101-R001', ASESOR], (r) => r.success === false && r.sinPermiso === true && !r.quote],
    ['guardarRevisionCotizacion', [{ folio: 'LVP-990101-R001', email: ASESOR, decision: 'aprobada', notas: '' }], (r) => r.success === false && r.sinPermiso === true],
    ['revFichaArticulo', [URL_ANILLO, '1', ASESOR], (r) => r.ok === false && r.motivo === 'sin-permiso'],
    ['revPaginaArticulo', [URL_ANILLO, '1', ASESOR], (r) => r.ok === false && r.motivo === 'sin-permiso' && !r.html],
    ['revVerificarPreciosLote', ['LVP-990101-R001', ASESOR], (r) => r.ok === false && r.sinPermiso === true],
    ['revHojaCotizacion', ['LVP-990101-R004', ASESOR], (r) => r.ok === false && r.sinPermiso === true],
    ['getPoliticaRevision', [ASESOR], (r) => r.success === false && !r.politica],
    ['guardarPoliticaRevision', [ASESOR, { exigirRevision: false }], (r) => r.success === false],
    ['simularPoliticaRevision', [ASESOR, { total: 1 }], (r) => r.success === false && r.revisar === undefined]
  ];
  for (const [fn, args, esperado] of negadas) {
    const r = await rpc(ASESOR, fn, args);
    comprueba(fn + ' como asesor → negado', esperado(r), r);
  }
  const msgBloque = (await rpc(ASESOR, 'revListaPendientes', [ASESOR])).message;
  comprueba('el mensaje dice qué permiso falta', /Revisar cotizaciones/.test(msgBloque), msgBloque);

  seccion('Cola de revisión (revListaPendientes)');
  const cola = await rpc(SUP, 'revListaPendientes', [SUP]);
  const folios = (cola.quotes || []).map((x) => x.folio).filter((f) => f.startsWith('LVP-990101-R'));
  comprueba('success y message vacío', cola.success === true && cola.message === '', cola);
  comprueba('trae las pendientes R001, R002 y R005', ['LVP-990101-R001', 'LVP-990101-R002', 'LVP-990101-R005'].every((f) => folios.includes(f)), folios);
  comprueba('no trae la enviada (R003) ni la aprobada (R004)', !folios.includes('LVP-990101-R003') && !folios.includes('LVP-990101-R004'), folios);
  comprueba('cada fila trae SOLO los campos de la cola', cola.quotes.every((x) => mismasLlaves(x, ['folio', 'timestamp', 'advisorName', 'clientName', 'total', 'status', 'revisionEstado'])), cola.quotes[0]);
  comprueba('orden: la más reciente primero', folios.indexOf('LVP-990101-R002') > folios.indexOf('LVP-990101-R001'), folios);
  const r1Cola = cola.quotes.find((x) => x.folio === 'LVP-990101-R001');
  comprueba('total numérico y fecha ISO', r1Cola && r1Cola.total === 628.3 && /^\d{4}-\d\d-\d\dT.*Z$/.test(r1Cola.timestamp), r1Cola);

  seccion('Abrir una revisión (getRevisionCotizacion)');
  const r1 = await rpc(SUP, 'getRevisionCotizacion', ['LVP-990101-R001', SUP]);
  comprueba('forma de la respuesta', r1.success === true && mismasLlaves(r1, ['success', 'revisor', 'quote', 'products', 'sheetEmbedUrl', 'sheetUrl', 'hojaIncrustable', 'checklistGeneral', 'auditoria', 'revision']), Object.keys(r1));
  comprueba('quote con los campos de Revision.gs', mismasLlaves(r1.quote, ['folio', 'timestamp', 'advisorName', 'advisorEmail', 'advisorExt', 'clientName', 'clientEmail', 'clientPhone', 'summarySubtotal', 'summaryVat', 'summaryTotal', 'observations', 'format', 'status', 'driveLink']), r1.quote);
  comprueba('revisor = quien abre', r1.revisor.email === SUP && r1.revisor.nombre === 'Laura Domínguez', r1.revisor);
  comprueba('products con índice y enlace saneado', r1.products.length === 2 && r1.products[0].indice === 0 && r1.products[0].productUrl === URL_ANILLO && r1.products[1].productUrl === '' && r1.products[1].urlDescartada === false, r1.products);
  comprueba('los 8 puntos de la auditoría, en su orden', JSON.stringify(r1.checklistGeneral.map((p) => p.id)) === JSON.stringify(IDS_PUNTOS), r1.checklistGeneral.map((p) => p.id));
  comprueba('cada punto trae id, texto, estado, detalle, auto, peso, sugerencia, evidencia', r1.checklistGeneral.every((p) => ['id', 'texto', 'estado', 'detalle', 'auto', 'peso', 'sugerencia', 'evidencia'].every((k) => k in p)), r1.checklistGeneral[0]);
  comprueba('cotización sana: precios «pendiente» hasta consultar el sitio, el resto ok', r1.checklistGeneral.find((p) => p.id === 'precios').estado === 'pendiente' && r1.checklistGeneral.filter((p) => p.id !== 'precios').every((p) => p.estado === 'ok'), r1.checklistGeneral.map((p) => p.estado));
  comprueba('auditoria con score numérico y sin críticas', typeof r1.auditoria.score === 'number' && r1.auditoria.score >= 80 && r1.auditoria.criticas.length === 0, r1.auditoria.score);
  comprueba('revisión aún abierta', r1.revision.estado === '' && r1.revision.aprobada === false, r1.revision);
  comprueba('sin hoja CCL: no hay incrustable', r1.sheetEmbedUrl === '' && r1.hojaIncrustable === false, r1.sheetEmbedUrl);

  const r2 = await rpc(SUP, 'getRevisionCotizacion', ['LVP-990101-R002', SUP]);
  const p2 = (id) => r2.checklistGeneral.find((p) => p.id === id);
  comprueba('enlaces que no son de liverpool.com.mx llegan vacíos y marcados', r2.products.every((p) => p.productUrl === '' && p.urlDescartada === true), r2.products);
  comprueba('errata de dominio: «atención» y sugiere juan@gmail.com', p2('cliente-correo').estado === 'atencion' && p2('cliente-correo').sugerencia === 'juan@gmail.com', p2('cliente-correo'));
  comprueba('teléfono de relleno: «mal»', p2('cliente-telefono').estado === 'mal', p2('cliente-telefono'));
  comprueba('asesor con 4 palabras: sugiere «Sofía Herrera»', p2('asesor').estado === 'atencion' && p2('asesor').sugerencia === 'Sofía Herrera', p2('asesor'));
  comprueba('enlace descartado cuenta como captura a mano (precios «manual»)', p2('precios').estado === 'manual', p2('precios'));
  comprueba('totales y SKU repetido: «mal» → 3 críticas', p2('totales').estado === 'mal' && p2('articulos').estado === 'mal' && r2.auditoria.criticas.length === 3, r2.auditoria.criticas);

  const r4 = await rpc(SUP, 'getRevisionCotizacion', ['LVP-990101-R004', SUP]);
  comprueba('cotización aprobada: revisión cerrada con quién, cuándo y notas', r4.revision.estado === 'Aprobada' && r4.revision.aprobada === true && r4.revision.nombre === 'Laura Domínguez' && r4.revision.notas === 'Todo en orden' && /Z$/.test(r4.revision.fecha), r4.revision);
  comprueba('hoja CCL: URL /preview con su pestaña', r4.hojaIncrustable === true && /\/preview\?gid=123$/.test(r4.sheetEmbedUrl), r4.sheetEmbedUrl);
  const noFolio = await rpc(SUP, 'getRevisionCotizacion', ['', SUP]);
  comprueba('sin folio → «Falta el folio de la cotización.»', noFolio.success === false && noFolio.message === 'Falta el folio de la cotización.', noFolio);
  const noExiste = await rpc(SUP, 'getRevisionCotizacion', ['LVP-990101-NOEXISTE', SUP]);
  comprueba('folio inexistente → «Cotización no encontrada.»', noExiste.success === false && noExiste.message === 'Cotización no encontrada.', noExiste);

  seccion('Liverpool en vivo: validación de host EXACTO y degradación');
  for (const u of URLS_MALAS) {
    const r = await rpc(SUP, 'revFichaArticulo', [u, '1', SUP]);
    comprueba('ficha rechaza ' + u, r.ok === false && r.motivo === 'url-invalida', r);
  }
  const pagMala = await rpc(SUP, 'revPaginaArticulo', ['https://evil.com/?x=liverpool.com.mx', '1', SUP]);
  comprueba('página rechaza un host ajeno', pagMala.ok === false && pagMala.motivo === 'url-invalida' && !pagMala.html, pagMala);
  const ficha = await rpc(SUP, 'revFichaArticulo', [URL_ANILLO, '1182166315', SUP]);
  comprueba('ficha real: o el precio leído, o un fallo controlado (nunca un precio inventado)',
    (ficha.ok === true && typeof ficha.precio === 'number' && typeof ficha.titulo === 'string')
      || (ficha.ok === false && MOTIVOS_DEGRADADOS.includes(ficha.motivo) && typeof ficha.mensaje === 'string' && ficha.precio === undefined), ficha);
  console.log('    (liverpool.com.mx desde este Worker: ' + (ficha.ok ? 'precio ' + ficha.precio + (ficha.deCache ? ', de caché' : '') : 'degradado · ' + ficha.motivo) + ')');

  const lote = await rpc(SUP, 'revVerificarPreciosLote', ['LVP-990101-R001', SUP]);
  comprueba('verificación en lote: una verificación por artículo con enlace', lote.ok === true && lote.verificaciones.length === 1 && lote.verificaciones[0].indice === 0, lote);
  comprueba('cada verificación trae su veredicto', ['coincide', 'difiere', 'sin-dato'].includes(lote.verificaciones[0].estado) && mismasLlaves(lote.verificaciones[0], ['indice', 'sku', 'estado', 'titulo', 'mensaje', 'diferencia', 'similitud', 'precioSitio', 'tituloSitio', 'deCache']), lote.verificaciones[0]);
  comprueba('el dictamen vuelve con el punto de precios resuelto (ya no «pendiente»)', lote.auditoria.puntos.length === 8 && lote.auditoria.puntos.find((p) => p.id === 'precios').estado !== 'pendiente', lote.auditoria.puntos.find((p) => p.id === 'precios'));
  const sinEnlaces = await rpc(SUP, 'revVerificarPreciosLote', ['LVP-990101-R005', SUP]);
  comprueba('sin enlaces: ok, sinEnlaces y nada que comparar', sinEnlaces.ok === true && sinEnlaces.sinEnlaces === true && sinEnlaces.verificaciones.length === 0, sinEnlaces);

  seccion('La hoja de Google (no hay Drive en esta versión)');
  const hoja4 = await rpc(SUP, 'revHojaCotizacion', ['LVP-990101-R004', SUP]);
  comprueba('con hoja CCL → fallo controlado con el mensaje de la demo', hoja4.ok === false && /no genera archivos en Google Drive/.test(hoja4.mensaje), hoja4);
  const hoja1 = await rpc(SUP, 'revHojaCotizacion', ['LVP-990101-R001', SUP]);
  comprueba('sin hoja → motivo sin-hoja, como el original', hoja1.ok === false && hoja1.motivo === 'sin-hoja', hoja1);

  seccion('Política de revisión: leer, guardar, simular');
  try {
    const pol0 = await rpc(SUP, 'getPoliticaRevision', [SUP]);
    comprueba('sin guardar rige la de arranque: revisar todo, sin criterios', pol0.success === true && pol0.politica.exigirRevision === true && pol0.politica.accionPorDefecto === 'revisar' && pol0.politica.reglas.length === 0, pol0.politica);
    comprueba('catálogo completo (6 tipos, 3 operadores, 7 días, 2 formatos, zona de México, tope 20)',
      pol0.catalogo.tipos.length === 6 && pol0.catalogo.operadores.length === 3 && pol0.catalogo.dias.length === 7 &&
      JSON.stringify(pol0.catalogo.formatos) === JSON.stringify([{ id: 'actual', nombre: 'Actual' }, { id: 'ccl_liverpool', nombre: 'CCL Liverpool' }]) &&
      pol0.catalogo.zonaHoraria === 'America/Mexico_City' && pol0.catalogo.maxReglas === 20, pol0.catalogo);

    const prueba = { exigirRevision: true, accionPorDefecto: 'revisar', historial: [{ fecha: 'x', por: 'intruso', que: 'borré el rastro' }], reglas: [
      { id: 'a', tipo: 'descuento', operador: 'mayor-igual', valor: 40, accion: 'revisar' },
      { id: 'b', tipo: 'monto', operador: 'menor', valor: 5000, accion: 'auto' },
      { id: 'c', tipo: 'horario', dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00', dentro: false, accion: 'revisar' },
      { tipo: 'inventado' },
      { id: 'd', tipo: 'monto', operador: 'entre', valor: 900, valor2: 100, accion: 'revisar', activa: false }
    ] };
    const g1 = await rpc(SUP, 'guardarPoliticaRevision', [SUP, prueba]);
    comprueba('guardar → success y mensaje', g1.success === true && g1.message === 'Política de revisión guardada.', g1.message);
    comprueba('normaliza: descarta el tipo desconocido y ordena el rango al revés', g1.politica.reglas.length === 4 && g1.politica.reglas[3].valor === 100 && g1.politica.reglas[3].valor2 === 900, g1.politica.reglas);
    comprueba('firma quién la cambió y el historial NO viene del cliente', g1.politica.actualizadaPor === 'Laura Domínguez (supervisora@ventel.example)' && g1.politica.historial.length === 1 && g1.politica.historial[0].que === 'Criterios: 0 → 4', g1.politica.historial);
    comprueba('describe los criterios en español (moneda MXN)', g1.descripciones[1] === 'si el total es menor que $5,000.00, se envía sin revisar.', g1.descripciones);
    const demasiadas = await rpc(SUP, 'guardarPoliticaRevision', [SUP, { reglas: Array.from({ length: 21 }, (_, i) => ({ id: 'm' + i, tipo: 'monto', valor: i })) }]);
    comprueba('más de 20 criterios → rechazado', demasiadas.success === false && /más de 20 criterios/.test(demasiadas.message), demasiadas);

    // Los casos de revpolDiagnostico: lunes 3 de agosto de 2026, hora de México.
    const sim = async (caso, borrador) => rpc(SUP, 'simularPoliticaRevision', borrador ? [SUP, caso, borrador] : [SUP, caso]);
    const casos = [
      ['$900, 10% a las 10:00 → directo por el criterio 2', { total: 900, descuentoMax: 10, articulos: 1, formato: 'actual', fechaHora: '2026-08-03T10:00' }, false, 'b'],
      ['$900 pero 55% → revisar (gana el criterio 1, va antes)', { total: 900, descuentoMax: 55, articulos: 1, formato: 'actual', fechaHora: '2026-08-03T10:00' }, true, 'a'],
      ['$80,000, 10% → revisar por defecto', { total: 80000, descuentoMax: 10, articulos: 3, formato: 'actual', fechaHora: '2026-08-03T10:00' }, true, ''],
      ['$900 a las 22:00 → directo (el criterio 2 gana al horario)', { total: 900, descuentoMax: 5, articulos: 1, formato: 'actual', fechaHora: '2026-08-03T22:00' }, false, 'b'],
      ['$20,000 a las 22:00 → revisar (fuera de horario)', { total: 20000, descuentoMax: 5, articulos: 1, formato: 'actual', fechaHora: '2026-08-03T22:00' }, true, 'c']
    ];
    for (const [txt, caso, revisar, regla] of casos) {
      const r = await sim(caso);
      comprueba('simula ' + txt, r.success === true && r.revisar === revisar && r.reglaId === regla, r);
    }
    const s1 = await sim(casos[0][1]);
    comprueba('el contexto devuelve la hora del sistema (formato de Apps Script)', s1.contexto.hora === 'Monday 03/08/2026 10:00' && s1.origen === 'regla', s1.contexto);
    const sB = await sim({ total: 999999, fechaHora: '2026-08-03T10:00' }, { exigirRevision: false, reglas: [{ id: 'z', tipo: 'monto', valor: 1, accion: 'revisar' }] });
    comprueba('simula con el BORRADOR: interruptor apagado manda sobre todo', sB.revisar === false && sB.origen === 'maestro', sB);
    const sN = await sim({ total: 50, fechaHora: '2026-08-08T03:00' }, { accionPorDefecto: 'auto', reglas: [{ id: 'n', tipo: 'horario', dias: [5], desde: '22:00', hasta: '06:00', accion: 'revisar' }] });
    comprueba('franja que cruza la medianoche pertenece al día en que empieza (viernes → sábado 03:00)', sN.revisar === true && sN.reglaId === 'n', sN);

    const apagar = await rpc(SUP, 'guardarPoliticaRevision', [SUP, { exigirRevision: false, accionPorDefecto: 'revisar', reglas: [] }]);
    comprueba('apagar la revisión avisa en el momento', apagar.success === true && /DESACTIVADA/.test(apagar.aviso || '') && apagar.politica.historial[0].que.includes('DESACTIVÓ la revisión'), apagar);
  } finally {
    sqlConsulta("DELETE FROM propiedades WHERE clave = 'revision_politica_v1'");   // como se encontró
  }

  seccion('Cerrar una revisión (guardarRevisionCotizacion) y el aviso al asesor');
  const g = (carga) => rpc(SUP, 'guardarRevisionCotizacion', [{ email: SUP, ...carga }]);
  comprueba('sin folio', (await g({ folio: '', decision: 'aprobada' })).message === 'Falta el folio de la cotización.');
  comprueba('decisión inválida', (await g({ folio: 'LVP-990101-R005', decision: 'quizás' })).message === 'La decisión debe ser "aprobada" o "rechazada".');
  comprueba('rechazar sin decir por qué', /mínimo 10 caracteres/.test((await g({ folio: 'LVP-990101-R005', decision: 'rechazada', notas: 'corto' })).message));
  comprueba('observaciones de más de 4000', /demasiado largas/.test((await g({ folio: 'LVP-990101-R005', decision: 'rechazada', notas: 'x'.repeat(4001) })).message));
  const sinJust = await g({ folio: 'LVP-990101-R002', decision: 'aprobada', notas: '' });
  comprueba('aprobar con fallas críticas exige justificación', sinJust.success === false && sinJust.requiereJustificacion === true && sinJust.criticas.length === 3, sinJust);
  const r2Despues = sqlConsulta("SELECT revision_estado, estatus FROM cotizaciones WHERE folio = 'LVP-990101-R002'")[0];
  comprueba('…y no escribe nada', !r2Despues.revision_estado && r2Despues.estatus === 'En Revisión', r2Despues);
  const inexistente = await g({ folio: 'LVP-990101-NOEXISTE', decision: 'aprobada', notas: '' });
  comprueba('folio inexistente → mensaje genérico de Revision.gs', inexistente.success === false && inexistente.message === 'No pudimos guardar la revisión. Inténtalo de nuevo en un momento.', inexistente);

  const notas = 'La licuadora cambió de precio: actualízala y vuelve a guardarla.';
  const rech = await g({ folio: 'LVP-990101-R005', decision: 'rechazada', notas,
    checklist: { general: [{ id: 'cliente-nombre', texto: 'El nombre del cliente está escrito correctamente', ok: true }], articulos: [{ sku: '1077665544', description: 'Licuadora', ok: false }] } });
  comprueba('rechazo → success, mensaje y revisión con quién y cuándo', rech.success === true && rech.message === 'Cotización rechazada. Se avisó al asesor con tus observaciones.' &&
    rech.revision.estado === 'Rechazada' && rech.revision.aprobada === false && rech.revision.por === SUP && rech.revision.nombre === 'Laura Domínguez' && rech.revision.notas === notas, rech);
  comprueba('el aviso no falló (avisoCorreo vacío)', rech.avisoCorreo === '', rech.avisoCorreo);
  const fila5 = sqlConsulta("SELECT estatus, revision_estado, revisado_por, revisado_nombre, revision_fecha, revision_notas, revision_checklist FROM cotizaciones WHERE folio = 'LVP-990101-R005'")[0];
  const chk5 = JSON.parse(fila5.revision_checklist || '{}');
  comprueba('en D1: estatus y revision_estado «Rechazada», con revisor, fecha ISO y notas', fila5.estatus === 'Rechazada' && fila5.revision_estado === 'Rechazada' && fila5.revisado_por === SUP && /Z$/.test(fila5.revision_fecha) && fila5.revision_notas === notas, fila5);
  comprueba('revision_checklist es JSON con el texto legible y el dictamen del SERVIDOR', chk5.tipo === 'revision' && /Índice de confianza/.test(chk5.texto) && chk5.texto.includes('— Artículos verificados: 0 de 1') && chk5.puntos.length === 8, chk5);
  const correo5 = sqlConsulta("SELECT para, asunto, texto, html, tipo, nombre_de FROM correos_salida WHERE referencia = 'LVP-990101-R005' ORDER BY id DESC LIMIT 1")[0];
  comprueba('aviso al asesor en correos_salida (para, asunto, tipo)', correo5 && correo5.para === 'jorge.ramirez@ventel.example' && correo5.asunto === '⚠️ Cotización rechazada · LVP-990101-R005' && correo5.tipo === 'revision' && correo5.nombre_de === 'Sistema de cotizaciones Ventel', correo5);
  comprueba('el aviso lleva las observaciones y el enlace a la consulta', correo5 && correo5.texto.includes('Observaciones: ' + notas) && correo5.texto.includes('?page=consulta_cotizacion&folio=LVP-990101-R005') && correo5.html.includes('$1,000.00'), correo5 && correo5.texto);

  const apr = await g({ folio: 'LVP-990101-R001', decision: 'aprobada', notas: '', verificaciones: [{ indice: 0, estado: 'coincide' }],
    checklist: { general: [], articulos: [{ sku: '1182166315', description: 'Anillo', ok: true }, { sku: '1099887766', description: 'Sartenes', ok: true }] } });
  comprueba('aprobación → success y envío desbloqueado', apr.success === true && apr.message === 'Cotización aprobada. El envío por correo ya está desbloqueado.' && apr.revision.aprobada === true, apr);
  const correo1 = sqlConsulta("SELECT asunto FROM correos_salida WHERE referencia = 'LVP-990101-R001' ORDER BY id DESC LIMIT 1")[0];
  comprueba('aviso de aprobación', correo1 && correo1.asunto === '✅ Cotización aprobada · LVP-990101-R001', correo1);
  const r1Despues = await rpc(SUP, 'getRevisionCotizacion', ['LVP-990101-R001', SUP]);
  comprueba('al reabrirla, la revisión ya está cerrada', r1Despues.revision.estado === 'Aprobada' && r1Despues.revision.aprobada === true && r1Despues.quote.status === 'Aprobada', r1Despues.revision);
  const colaDespues = (await rpc(SUP, 'revListaPendientes', [SUP])).quotes.map((x) => x.folio);
  comprueba('R001 y R005 salieron de la cola; R002 sigue', !colaDespues.includes('LVP-990101-R001') && !colaDespues.includes('LVP-990101-R005') && colaDespues.includes('LVP-990101-R002'), colaDespues);

  seccion('El envío por correo respeta la revisión (si el módulo de cotizaciones ya lo expone)');
  let envio;
  try {
    envio = await rpc(SUP, 'sendQuoteByEmail', [{ to: 'cliente@ventel.example', subject: 'Prueba', body: 'Prueba', folio: 'LVP-990101-R002', asesor: SUP }]);
  } catch (e) { envio = { noExpuesta: e.message }; }
  if (envio && envio.noExpuesta) console.log('    (omitida: ' + envio.noExpuesta + ')');
  else comprueba('sendQuoteByEmail NO manda una cotización en revisión', envio && envio.success !== true, envio);
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// PARTE B · contratos internos sobre una D1 en memoria y un fetch simulado
// ═════════════════════════════════════════════════════════════════════════════════════════

/** Una D1 de mentira con la misma API que usa nucleo/contexto.ts, sobre node:sqlite. */
function d1Falsa(db) {
  const preparada = (sql, params = []) => ({
    sql, params,
    bind: (...p) => preparada(sql, p),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => { const f = db.prepare(sql).get(...params); return f === undefined ? null : f; },
    run: async () => { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  });
  return {
    prepare: (sql) => preparada(sql),
    batch: async (lista) => {
      db.exec('BEGIN');
      try {
        const out = lista.map((s) => {
          const st = db.prepare(s.sql);
          if (/^\s*(select|with)\b|\breturning\b/i.test(s.sql)) return { results: st.all(...s.params), meta: { changes: 0 } };
          const r = st.run(...s.params);
          return { results: [], meta: { changes: Number(r.changes) } };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}

const FICHA_HTML = '<!doctype html><html><head>' +
  '<meta property="og:title" content="Anillo redondo Map brillante | Liverpool"/>' +
  '<meta property="og:image" content="https://sp514.liverpool.com.mx/i/1182166321.jpg"/>' +
  '<style>a{color:red}</style><link rel="stylesheet" href="/_pdpnext/a.css"/>' +
  '<link rel="stylesheet" href="https://evilliverpool.com.mx/robo.css"/></head><body>' +
  '<script>alert(1)</script><div class="usada" id="x"><h1>Anillo redondo Map brillante</h1>' +
  '<div data-testid="1182166315-configurator-price"><p data-testid="discounted"><span>$</span><span>209</span><!-- --><span>.30</span></p>' +
  '<p data-testid="original" style="padding-left:4px">$299.00</p></div>' +
  '<img src="/x.jpg" onerror="alert(2)"><a href="javascript:alert(3)">clic</a></div>' + ' '.repeat(600) + '</body></html>';
// La portada: trae precios de carrusel, pero ningún bloque del configurador.
const PORTADA_HTML = '<!doctype html><html><head><meta property="og:title" content="Liverpool México"/></head><body>' +
  '<div data-testid="discounted">$15,999.00</div><div data-testid="original">$22,499.00</div>' + ' '.repeat(700) + '</body></html>';
const CSS_A = '.usada{color:green}.jamas-usada{color:red}';

async function parteB() {
  console.log('\nPARTE B · contratos internos (D1 en memoria, fetch simulado)');
  let DatabaseSync, esbuild;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { console.log('  (omitida: este Node no trae node:sqlite)'); return; }
  try { esbuild = createRequire(join(CF, 'package.json'))('esbuild'); } catch { console.log('  (omitida: falta esbuild en cloudflare/node_modules)'); return; }

  // ── El módulo, empaquetado tal cual lo empaqueta wrangler ──
  const dir = mkdtempSync(join(tmpdir(), 'rev-prueba-'));
  let M;
  try {
    const r = await esbuild.build({
      stdin: {
        contents: [
          "export * from './src/worker/modulos/revision.ts';",
          "export * as aud from './src/worker/modulos/revision/auditoria.ts';",
          "export * as liv from './src/worker/modulos/revision/liverpool.ts';",
          "export * as pol from './src/worker/modulos/revision/politica.ts';",
          "export * as cons from './src/worker/modulos/revision/constantes.ts';",
          "export { Ctx } from './src/worker/nucleo/contexto.ts';"
        ].join('\n'),
        resolveDir: CF, sourcefile: 'entrada-prueba.ts', loader: 'ts'
      },
      bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false, logLevel: 'silent'
    });
    writeFileSync(join(dir, 'revision.mjs'), r.outputFiles[0].text);
    M = await import(pathToFileURL(join(dir, 'revision.mjs')).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const { aud, liv, pol, cons } = M;

  // ── La base: TODAS las migraciones en orden (0001 y 0004 tienen que entrar; las ajenas, si fallan, se avisan) ──
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(join(CF, 'migrations')).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    try { db.exec(readFileSync(join(CF, 'migrations', f), 'utf8')); }
    catch (e) {
      if (/^000[14]_/.test(f)) throw new Error('migración ' + f + ': ' + e.message);
      console.log('    (aviso: la migración ajena ' + f + ' no entró: ' + e.message + ')');
    }
  }
  db.exec(readFileSync(join(CF, 'semilla', '00_usuarios_demo.sql'), 'utf8'));
  const env = { DB: d1Falsa(db) };
  const nuevoCtx = (sesion, extraEnv) => {
    const ctx = new M.Ctx({ ...env, ...(extraEnv || {}) }, null, 'https://ventel.example');
    if (sesion) ctx.sesion = { email: sesion };
    return ctx;
  };
  const fila = (sql, ...p) => db.prepare(sql).get(...p);
  const insertarCot = (c) => {
    const cols = Object.keys(c);
    db.prepare('INSERT OR REPLACE INTO cotizaciones (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')').run(...cols.map((k) => c[k]));
  };
  const insertarDet = (folio, lineas) => {
    db.prepare('DELETE FROM detalle_cotizaciones WHERE folio_cotizacion = ?').run(folio);
    lineas.forEach((p, i) => db.prepare('INSERT INTO detalle_cotizaciones (folio_cotizacion, orden, sku, descripcion_producto, cantidad, precio_unitario_base, desc_publico_porcentaje, link_articulo) VALUES (?,?,?,?,?,?,?,?)')
      .run(folio, i, p.sku, p.desc, p.cant, p.precio, p.descPub || 0, p.url || ''));
  };

  // ── El fetch simulado: registra cada URL y contesta según el escenario ──
  const fetchReal = globalThis.fetch;
  const llamadas = [];
  let escenario = () => { throw new Error('fetch sin escenario'); };
  globalThis.fetch = async (entrada, init) => {
    const url = String((entrada && entrada.url) || entrada);
    llamadas.push({ url, init });
    return escenario(url, init);
  };
  const html = (cuerpo, status = 200, headers = {}) => new Response(cuerpo, { status, headers: { 'content-type': 'text/html', ...headers } });

  // El módulo escribe su bitácora en la consola (lo que en Apps Script era Logger.log). Aquí estorba:
  // solo pasan las líneas de la prueba.
  const logReal = console.log, errorReal = console.error;
  console.error = () => {};
  console.log = (...a) => { if (typeof a[0] === 'string' && /^(\s{2}[✔✖] |\n[■✖] |\s{4}\()/.test(a[0])) logReal(...a); };

  try {
    seccion('Auditoría (los casos de audDiagnostico)');
    const c = (correo) => aud.audValidarCorreo(correo);
    comprueba('correo bueno', c('juan.perez@gmail.com').estado === 'ok');
    comprueba('correo sin arroba / vacío / con espacio → mal', ['juanperez.gmail.com', '', 'juan perez@gmail.com'].every((x) => c(x).estado === 'mal'));
    comprueba('errata gmial.com → atención y sugerencia', c('juan@gmial.com').estado === 'atencion' && c('juan@gmial.com').sugerencia === 'juan@gmail.com');
    comprueba('dominio raro pero legítimo (uaslp.mx) → ok', c('a.lopez@uaslp.mx').estado === 'ok');
    comprueba('buzón genérico y correo temporal → atención', c('ventas@empresa.com.mx').estado === 'atencion' && c('x@mailinator.com').estado === 'atencion');
    comprueba('TLD inventado → mal', c('x@dominio.c').estado === 'mal');
    const n = (nombre, op) => aud.audValidarNombrePersona(nombre, op);
    const ase = { quien: 'el asesor', maxPalabras: 2, exigirExacto: true }, cli = { quien: 'el cliente', minPalabras: 2, maxPalabras: 6 };
    comprueba('asesor con nombre y apellido → ok', n('David Martínez', ase).estado === 'ok');
    comprueba('asesor de 4 palabras → atención, sugiere «David Martínez»', n('David Alejandro Martínez López', ase).estado === 'atencion' && n('David Alejandro Martínez López', ase).sugerencia === 'David Martínez');
    comprueba('asesor de 3 palabras → sugiere «María López»', n('María López Hernández', ase).sugerencia === 'María López');
    comprueba('cliente en mayúsculas → atención', n('MARIA LOPEZ', cli).estado === 'atencion');
    comprueba('capitaliza con partículas: «Maria de la Luz López»', n('maria de la luz lópez', cli).sugerencia === 'Maria de la Luz López');
    comprueba('cliente bien escrito y razón social → ok', n('María López Hernández', cli).estado === 'ok' && n('Grupo Industrial ACME SA de CV', cli).estado === 'ok');
    const t = (x) => aud.audValidarTelefonoMx(x).estado;
    comprueba('teléfonos: bueno, con +52 → ok; corto, relleno, secuencia → mal', t('5512345678') === 'ok' && t('+52 55 1234 5678') === 'ok' && t('55123456') === 'mal' && t('5555555555') === 'mal' && t('1234567890') === 'mal');
    const prods = [
      { sku: '1182166315', description: 'Anillo Map brillante', quantity: 2, unitPrice: 399, discountPublicPercent: 30, additionalDiscountApplied: 'No', additionalDiscountPercent: 0, productUrl: 'https://www.liverpool.com.mx/tienda/pdp/x/1' },
      { sku: '1182166316', description: 'Collar Map', quantity: 1, unitPrice: 1000, discountPublicPercent: 0, additionalDiscountApplied: 'No', additionalDiscountPercent: 0, productUrl: 'https://www.liverpool.com.mx/tienda/pdp/y/2' }
    ];
    const total = 399 * 2 * 0.7 + 1000;
    const qq = { clientName: 'María López', clientEmail: 'maria@gmail.com', clientPhone: '5512345678', advisorName: 'David Martínez', advisorEmail: 'd@liverpool.com.mx',
      summaryTotal: total, summarySubtotal: Math.round((total / 1.16) * 100) / 100, summaryVat: Math.round((total - total / 1.16) * 100) / 100, timestamp: new Date().toISOString() };
    comprueba('totales que cuadran / que no cuadran', aud.audValidarTotales(qq, prods).estado === 'ok' && aud.audValidarTotales({ ...qq, summaryTotal: total + 100 }, prods).estado === 'mal');
    comprueba('artículos sanos / SKU repetido', aud.audValidarArticulos(prods).estado === 'ok' && aud.audValidarArticulos(prods.concat([{ sku: '1182166315', description: 'Anillo Map brillante', quantity: 1, unitPrice: 399 }])).estado === 'mal');
    comprueba('descuento atípico por z modificada', aud.audAtipicos([10, 10.5, 11, 10.2, 85]).join(',') === '4' && aud.audAtipicos([10, 10.5, 11, 10.2]).length === 0);
    comprueba('similitud de Dice alta / baja', aud.audSimilitud('Anillo MAP brillante dorado', 'Anillo Map brillante') > 0.6 && aud.audSimilitud('Licuadora Oster 10 velocidades', 'Anillo Map brillante') < 0.3);
    const dict = await M.audAuditar(nuevoCtx(), qq, prods);
    comprueba('audAuditar (contrato): 8 puntos, sin el de formato, score ≥ 80', dict.puntos.length === 8 && !dict.puntos.some((p) => p.id === 'formato') && dict.score >= 80, dict.score);
    comprueba('audAuditar trae puntos, score, resumen, criticas, automaticos, pendientes', ['puntos', 'score', 'resumen', 'criticas', 'automaticos', 'pendientes'].every((k) => k in dict));
    const vivo = aud.audAplicarPreciosEnVivo(await M.audAuditar(nuevoCtx(), qq, prods), [{ indice: 0, estado: 'coincide' }, { indice: 1, estado: 'coincide' }]);
    comprueba('precios en vivo que cuadran → precios «ok»', vivo.puntos.find((p) => p.id === 'precios').estado === 'ok');
    const difiere = aud.audAplicarPreciosEnVivo(await M.audAuditar(nuevoCtx(), qq, prods), [{ indice: 0, estado: 'difiere' }, { indice: 1, estado: 'coincide' }]);
    comprueba('un precio que difiere → crítica', difiere.criticas.some((x) => x.startsWith('Precios, promociones')));
    const cmp = aud.audCompararConFicha(prods[1], { ok: true, precio: 1000, titulo: 'Collar Map dorado' });
    comprueba('comparar con la ficha: coincide / difiere / sin dato', cmp.estado === 'coincide' && aud.audCompararConFicha(prods[1], { ok: true, precio: 900, titulo: 'Collar Map' }).estado === 'difiere' && aud.audCompararConFicha(prods[1], { ok: false }).estado === 'sin-dato');

    seccion('URLs y saneado de la página');
    comprueba('revUrlArticuloSegura rechaza los seis casos peligrosos', URLS_MALAS.every((u) => cons.revUrlArticuloSegura(u) === ''));
    comprueba('…y acepta un artículo legítimo', cons.revUrlArticuloSegura('https://www.liverpool.com.mx/tienda/pdp/apple-ipad/1176418893?skuid=1') !== '');
    const sheet = 'https://docs.google.com/spreadsheets/d/1l3cdEOUnD1Rgk1VCDfx48NWd_mcgIQ7Gkt2YhwbRs34/edit#gid=123';
    comprueba('hoja incrustable: /preview y conserva gid; otra URL → vacío', cons.revUrlEmbedSheet(sheet).endsWith('/preview?gid=123') && cons.revUrlEmbedSheet('https://ejemplo.com/x') === '');
    const sucia = '<html><head><style>a{color:red}</style></head><body><div>Hola<script>alert(1)<\/script><img src="/x.jpg" onerror="alert(2)"><a href="javascript:alert(3)">clic</a></div></body></html>' + ' '.repeat(600);
    const limpia = liv.revArmarPaginaIncrustada(liv.revPartesPagina(sucia), 'https://www.liverpool.com.mx/tienda/pdp/x/1', ['.usada{color:green}']);
    comprueba('saneado: sin <script>, sin manejadores, sin javascript:', !limpia.includes('<script') && !/onerror/i.test(limpia) && !limpia.includes('javascript:'));
    comprueba('saneado: <base> de Liverpool y estilos en línea conservados', limpia.includes('<base href="https://www.liverpool.com.mx/">') && limpia.includes('a{color:red}'));
    const usa = liv.revTokensDelHtml('<div class="usada" id="x">hola</div>');
    const purgada = liv.revPurgarCss('.usada{color:green}.jamas-usada{color:red}#x{border:0}#z{border:1px}body{margin:0}@media (min-width:600px){.usada{color:blue}.jamas-usada{color:pink}}@font-face{font-family:X;src:url(y)}', usa);
    comprueba('purga de CSS: conserva lo usado, etiquetas, @media limpias y @font-face; tira lo ausente',
      purgada.includes('.usada{color:green}') && !purgada.includes('jamas-usada') && purgada.includes('#x{border:0}') && !purgada.includes('#z') &&
      purgada.includes('body{margin:0}') && purgada.includes('@media (min-width:600px){.usada{color:blue}}') && purgada.includes('@font-face'), purgada);

    seccion('revpolDecidirAlGuardar y el sello de la aprobación automática');
    const barata = { summaryTotal: 800, format: 'actual', advisorEmail: ASESOR, products: [{ unitPrice: 800, quantity: 1 }] };
    let d = await M.revpolDecidirAlGuardar(nuevoCtx(), barata);
    comprueba('sin política guardada → revisar (por defecto)', d.revisar === true && d.origen === 'defecto' && d.reglaId === '', d);
    const gp = await pol.guardarPoliticaRevision(nuevoCtx(SUP), SUP, { exigirRevision: true, accionPorDefecto: 'revisar', reglas: [
      { id: 'a', tipo: 'descuento', operador: 'mayor-igual', valor: 40, accion: 'revisar' },
      { id: 'b', tipo: 'monto', operador: 'menor', valor: 5000, accion: 'auto' }] });
    comprueba('guardarPoliticaRevision con sesión de supervisora', gp.success === true, gp);
    d = await M.revpolDecidirAlGuardar(nuevoCtx(), barata);
    comprueba('$800 → aprobada sola por el criterio 2', d.revisar === false && d.origen === 'regla' && d.reglaId === 'b' && d.motivo.startsWith('Criterio 2: si el total es menor que $5,000.00'), d);
    d = await M.revpolDecidirAlGuardar(nuevoCtx(), { summaryTotal: 500, products: [{ unitPrice: 1000, quantity: 1, discountPublicPercent: 50 }] });
    comprueba('50 % de descuento → revisar (el criterio 1 va antes)', d.revisar === true && d.reglaId === 'a', d);
    d = await M.revpolDecidirAlGuardar(nuevoCtx(), { get products() { throw new Error('dato roto'); } });
    comprueba('ante un fallo → revisar, origen «error»', d.revisar === true && d.origen === 'error' && /por seguridad/.test(d.motivo), d);
    db.prepare("UPDATE propiedades SET valor = '{no-es-json' WHERE clave = 'revision_politica_v1'").run();
    d = await M.revpolDecidirAlGuardar(nuevoCtx(), barata);
    comprueba('política corrupta → la de arranque (revisar todo)', d.revisar === true && d.origen === 'defecto', d);
    db.prepare("DELETE FROM propiedades WHERE clave = 'revision_politica_v1'").run();

    insertarCot({ folio: 'T-SELLO', timestamp: new Date().toISOString(), asesor_correo: ASESOR, estatus: 'Aprobada', total_general: 800 });
    await M.revpolSellarAprobacionAutomatica(nuevoCtx(), 'T-SELLO', { motivo: 'Criterio 2: si el total es menor que $5,000.00, se envía sin revisar.', origen: 'regla', reglaId: 'b' });
    const sello = fila('SELECT * FROM cotizaciones WHERE folio = ?', 'T-SELLO');
    const chkSello = JSON.parse(sello.revision_checklist);
    comprueba('el sello deja el mismo rastro que una persona', sello.revision_estado === 'Aprobada' && sello.revisado_por === 'politica-automatica@sistema' && sello.revisado_nombre === 'Aprobación automática' && /Z$/.test(sello.revision_fecha), sello);
    comprueba('…con el motivo en las notas y en revision_checklist, sin tocar el estatus', sello.revision_notas.startsWith('Aprobada sin revisión humana por la política vigente. Criterio 2') &&
      chkSello.tipo === 'automatica' && chkSello.texto.includes('Motivo registrado: Criterio 2') && chkSello.reglaId === 'b' && sello.estatus === 'Aprobada', chkSello);
    let lanzo = false;
    try { await M.revpolSellarAprobacionAutomatica(nuevoCtx(), 'NO-EXISTE', { motivo: 'x', origen: 'regla' }); } catch { lanzo = true; }
    comprueba('sellar un folio inexistente no lanza', !lanzo);

    seccion('revPuedeEnviarse: la puerta del envío');
    const est = (folio, estatus, revision_estado, revisado_nombre) => insertarCot({ folio, timestamp: new Date().toISOString(), estatus, revision_estado, revisado_nombre, revisado_por: revisado_nombre ? SUP : '' });
    est('T-PEND', 'En Revisión', '', '');
    est('T-RECH', 'Rechazada', 'Rechazada', 'Laura Domínguez');
    est('T-APRO', 'Aprobada', 'Aprobada', 'Laura Domínguez');
    est('T-VIEJA', 'Enviada por Correo', '', '');
    const pe = (folio) => M.revPuedeEnviarse(nuevoCtx(), folio);
    comprueba('folio inexistente', JSON.stringify(await pe('NO-EXISTE')) === JSON.stringify({ ok: false, message: 'No se encontró la cotización NO-EXISTE.' }));
    const pPend = await pe('T-PEND');
    comprueba('en revisión → bloqueada', pPend.ok === false && pPend.message.startsWith('Esta cotización todavía está EN REVISIÓN.'), pPend);
    const pRech = await pe('T-RECH');
    comprueba('rechazada → bloqueada y dice quién', pRech.ok === false && pRech.message === 'Esta cotización fue RECHAZADA en la revisión por Laura Domínguez. Corrígela y pídela de nuevo a revisión antes de enviarla.', pRech);
    comprueba('aprobada, sellada por la política o anterior a la revisión → sale', (await pe('T-APRO')).ok && (await pe('T-SELLO')).ok && (await pe('T-VIEJA')).ok);
    await pol.guardarPoliticaRevision(nuevoCtx(SUP), SUP, { exigirRevision: false });
    comprueba('revisión apagada después: lo que esperaba en la cola también sale', (await pe('T-PEND')).ok === true);
    comprueba('…pero un RECHAZO sigue bloqueando', (await pe('T-RECH')).ok === false);
    db.prepare("DELETE FROM propiedades WHERE clave = 'revision_politica_v1'").run();

    seccion('Liverpool bloquea o no contesta: degradación exacta, sin inventar precios');
    llamadas.length = 0;
    const ficha = (url = URL_ANILLO, sku = '1182166315') => M.revFichaArticulo(nuevoCtx(SUP), url, sku, SUP);
    escenario = () => html('<html><body><h1>Access Denied</h1></body></html>', 403);
    let f = await ficha();
    comprueba('403 «Access Denied» → bloqueado, foto del SKU y sin última buena', f.ok === false && f.motivo === 'bloqueado' && f.codigo === 403 && f.imagenRespaldo === 'https://ss571.liverpool.com.mx/xl/1182166315.jpg' && f.ultimaBuena === null && f.precio === undefined, f);
    comprueba('…con el mensaje de Revision.gs', f.mensaje === 'Liverpool rechazó la consulta automática (código 403). Ábrelo en una pestaña para compararlo.', f.mensaje);
    comprueba('pide con cabeceras de navegador, redirección manual y tiempo máximo', llamadas[0].init.headers['User-Agent'].startsWith('Mozilla/5.0') && llamadas[0].init.redirect === 'manual' && !!llamadas[0].init.signal);
    escenario = () => html(FICHA_HTML);
    f = await ficha();
    comprueba('200 → la ficha: título, precio con promoción y de lista', f.ok === true && f.titulo === 'Anillo redondo Map brillante' && f.precio === 209.3 && f.precioLista === 299 && f.hayPromo === true && f.imagen === 'https://sp514.liverpool.com.mx/i/1182166321.jpg', f);
    const antes = llamadas.length;
    f = await ficha();
    comprueba('la segunda vez sale de la caché de 15 min, sin pedir nada', f.deCache === true && llamadas.length === antes, f);
    db.prepare("DELETE FROM cache WHERE clave LIKE 'rev-%'").run();
    escenario = () => html('Access Denied', 403);
    f = await ficha();
    comprueba('bloqueado después de una lectura buena → enseña la última ficha buena', f.motivo === 'bloqueado' && f.ultimaBuena && f.ultimaBuena.precio === 209.3 && f.ultimaBuena.precioLista === 299 && f.ultimaBuena.titulo === 'Anillo redondo Map brillante' && !!f.ultimaBuena.capturada, f.ultimaBuena);
    escenario = () => { throw new TypeError('fetch failed'); };
    f = await ficha();
    comprueba('red caída → sin-red con el motivo, y la última buena', f.motivo === 'sin-red' && f.mensaje === 'No se pudo contactar a liverpool.com.mx (fetch failed).' && f.ultimaBuena && f.ultimaBuena.precio === 209.3, f);
    escenario = () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
    f = await ficha();
    comprueba('tiempo agotado (8 s) → sin-red en español', f.motivo === 'sin-red' && /tardó más de 8 segundos/.test(f.mensaje), f.mensaje);
    escenario = () => html('', 404);
    f = await ficha('https://www.liverpool.com.mx/tienda/pdp/ya-no-existe/1');
    comprueba('404 → no-existe', f.motivo === 'no-existe' && f.codigo === 404 && /\(404\)/.test(f.mensaje), f);
    llamadas.length = 0;
    escenario = (url) => url.includes('evil.example') ? html(FICHA_HTML) : new Response(null, { status: 302, headers: { location: 'https://evil.example/robo' } });
    f = await ficha('https://www.liverpool.com.mx/tienda/pdp/redirige/2');
    comprueba('redirección a otro dominio → no se sigue (bloqueado 302)', f.ok === false && f.motivo === 'bloqueado' && f.codigo === 302 && llamadas.every((x) => !x.url.includes('evil.example')), llamadas.map((x) => x.url));
    escenario = (url) => url.includes('/tienda/pdp/destino/') ? html(FICHA_HTML) : new Response(null, { status: 301, headers: { location: '/tienda/pdp/destino/3' } });
    f = await ficha('https://liverpool.com.mx/tienda/pdp/origen/3');
    comprueba('redirección dentro de liverpool.com.mx → se sigue', f.ok === true && f.precio === 209.3, f);
    escenario = () => html(PORTADA_HTML);
    f = await ficha('https://www.liverpool.com.mx/tienda/pdp/a-la-portada/4');
    comprueba('una página sin el bloque del configurador (la portada) → sin-precio, no el del carrusel', f.ok === false && f.motivo === 'sin-precio' && f.precio === undefined, f);

    insertarCot({ folio: 'T-LOTE', timestamp: new Date().toISOString(), asesor_correo: ASESOR, asesor_nombre: 'Carlos Mendoza', cliente_nombre: 'María López',
      correo_cliente: 'maria@gmail.com', numero: '5512345678', estatus: 'En Revisión', subtotal: 1162.07, iva: 185.93, total_general: 1348 });
    insertarDet('T-LOTE', [
      { sku: '1182166315', desc: 'Anillo redondo Map brillante', cant: 1, precio: 299, url: 'https://www.liverpool.com.mx/tienda/pdp/a/5' },
      { sku: '1182166316', desc: 'Collar Map', cant: 1, precio: 49, url: 'https://www.liverpool.com.mx/tienda/pdp/b/6' },
      { sku: '1182166317', desc: 'Pulsera Map', cant: 1, precio: 1000 }
    ]);
    db.prepare("DELETE FROM cache WHERE clave LIKE 'rev-%'").run();
    escenario = () => html('Access Denied', 403);
    const lote = await M.revVerificarPreciosLote(nuevoCtx(SUP), 'T-LOTE', SUP);
    const precios = lote.auditoria.puntos.find((p) => p.id === 'precios');
    comprueba('lote bloqueado: cada artículo «sin-dato», ninguno inventado', lote.ok === true && lote.verificaciones.length === 2 && lote.verificaciones.every((v) => v.estado === 'sin-dato' && v.precioSitio === null), lote.verificaciones);
    comprueba('…y el punto de precios queda «manual» con el porqué', precios.estado === 'manual' && precios.detalle.includes('2 que el sitio no dejó leer') && precios.detalle.includes('1 capturado(s) a mano'), precios.detalle);
    const pagina = await M.revPaginaArticulo(nuevoCtx(SUP), URL_ANILLO, '1', SUP);
    comprueba('página bloqueada → fallo controlado con su mensaje', pagina.ok === false && pagina.motivo === 'bloqueado' && pagina.codigo === 403 && pagina.mensaje === 'Liverpool rechazó la consulta automática (código 403). Ábrelo en una pestaña.' && !pagina.html, pagina);
    llamadas.length = 0;
    escenario = (url) => url.endsWith('.css') ? new Response(CSS_A, { status: 200 }) : html(FICHA_HTML);
    const pag = await M.revPaginaArticulo(nuevoCtx(SUP), URL_ANILLO, '1', SUP);
    comprueba('página traída: saneada, con <base> y el CSS purgado incrustado', pag.ok === true && !pag.html.includes('<script') && !/onerror/i.test(pag.html) && !pag.html.includes('javascript:') &&
      pag.html.includes('<base href="https://www.liverpool.com.mx/">') && pag.html.includes('.usada{color:green}') && !pag.html.includes('jamas-usada'), pag.ok);
    comprueba('las hojas de estilo solo se piden a Liverpool (no a «evilliverpool.com.mx»)', llamadas.some((x) => x.url === 'https://www.liverpool.com.mx/_pdpnext/a.css') && llamadas.every((x) => !x.url.includes('evilliverpool')), llamadas.map((x) => x.url));
    comprueba('getRevisionCotizacion no depende del sitio', (await M.getRevisionCotizacion(nuevoCtx(SUP), 'T-LOTE', SUP)).success === true);

    seccion('El aviso al asesor cuando Brevo rechaza el envío');
    insertarCot({ folio: 'T-AVISO', timestamp: new Date().toISOString(), asesor_correo: 'asesora@logidma-pruebas.mx', asesor_nombre: 'Carlos Mendoza', cliente_nombre: 'María López',
      correo_cliente: 'maria@gmail.com', numero: '5512345678', estatus: 'En Revisión', subtotal: 86.21, iva: 13.79, total_general: 100 });
    insertarDet('T-AVISO', [{ sku: '1182166399', desc: 'Batería de cocina', cant: 1, precio: 100 }]);
    escenario = (url) => url.startsWith('https://api.brevo.com/') ? new Response(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }), { status: 401 }) : html('Access Denied', 403);
    const conClave = { BREVO_API_KEY: 'xkeysib-prueba-no-real' };
    const rechazo = await M.guardarRevisionCotizacion(nuevoCtx(SUP, conClave), { folio: 'T-AVISO', email: SUP, decision: 'rechazada', notas: 'Falta confirmar el color con el cliente.' });
    comprueba('Brevo rechaza → la revisión SÍ queda guardada y avisoCorreo lo explica', rechazo.success === true && rechazo.revision.estado === 'Rechazada' &&
      rechazo.avisoCorreo === 'La revisión quedó guardada, pero no se pudo enviar el aviso por correo al asesor (No se pudo enviar el correo: Key not found).', rechazo);
    comprueba('…en D1 y con el correo apuntado como «error»', fila('SELECT revision_estado FROM cotizaciones WHERE folio = ?', 'T-AVISO').revision_estado === 'Rechazada' &&
      fila("SELECT estado FROM correos_salida WHERE referencia = 'T-AVISO' ORDER BY id DESC LIMIT 1").estado === 'error');
    let cuerpoBrevo = null;
    escenario = (url, init) => { if (url.startsWith('https://api.brevo.com/')) { cuerpoBrevo = JSON.parse(init.body); return new Response(JSON.stringify({ messageId: '<prueba@brevo>' }), { status: 201 }); } return html('', 403); };
    const aprobacion = await M.guardarRevisionCotizacion(nuevoCtx(SUP, conClave), { folio: 'T-AVISO', email: SUP, decision: 'aprobada', notas: '' });
    comprueba('Brevo acepta → avisoCorreo vacío y correo «enviado»', aprobacion.success === true && aprobacion.avisoCorreo === '' &&
      fila("SELECT estado FROM correos_salida WHERE referencia = 'T-AVISO' ORDER BY id DESC LIMIT 1").estado === 'enviado', aprobacion);
    comprueba('remitente de logidma.com con el nombre de siempre, asunto y destinatario del original', cuerpoBrevo && cuerpoBrevo.sender.email === 'ventel@logidma.com' && cuerpoBrevo.sender.name === 'Sistema de cotizaciones Ventel' &&
      cuerpoBrevo.subject === '✅ Cotización aprobada · T-AVISO' && cuerpoBrevo.to[0].email === 'asesora@logidma-pruebas.mx' && /Fecha: \d\d\/\d\d\/\d{4} \d\d:\d\d/.test(cuerpoBrevo.textContent), cuerpoBrevo && { sender: cuerpoBrevo.sender, subject: cuerpoBrevo.subject, to: cuerpoBrevo.to });
    const sinClave = await M.guardarRevisionCotizacion(nuevoCtx(SUP), { folio: 'T-AVISO', email: SUP, decision: 'aprobada', notas: '', verificaciones: { no: 'es arreglo' } });
    comprueba('sin clave de Brevo (local) → «omitido», y unas verificaciones mal formadas no tumban nada', sinClave.success === true && sinClave.avisoCorreo === '' &&
      fila("SELECT estado FROM correos_salida WHERE referencia = 'T-AVISO' ORDER BY id DESC LIMIT 1").estado === 'omitido', sinClave);
  } finally {
    globalThis.fetch = fetchReal;
    console.log = logReal;
    console.error = errorReal;
    db.close();
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════
try {
  if (!process.env.SOLO_B) await parteA();
  if (!process.env.SIN_B) await parteB();
} catch (e) {
  mal++;
  console.log('\n✖ La prueba se interrumpió: ' + (e && e.stack || e));
}
console.log('\n' + ok + ' bien, ' + mal + ' mal');
process.exit(mal ? 1 : 0);
