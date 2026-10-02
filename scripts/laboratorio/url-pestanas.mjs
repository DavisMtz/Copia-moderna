// F5 del doc 16 · Las pestañas en la URL: revision_cotizacion (tarjeta del documento ?sec=hoja|google y
// comparador ?item=…&action=pagina) y cotizado_preview (?format=), en Chrome headless.
//
// Lo que el banco no puede ver: un google.script.history DE VERDAD. Aquí lleva una pila (push corta lo de
// delante y apila, replace pisa la entrada actual) guardada en sessionStorage para que sobreviva a la recarga,
// y atrás/adelante llaman al manejador como Apps Script ({ location: { parameter, parameters, hash } }).
// F5 = volver a pedir la página con los parámetros de la entrada actual: el servidor de aquí los inyecta en
// __APP__ igual que doGet (solo los de PARAMS_VISTA). Cada paso dice qué pasó y la sonda sale con código 1 si
// algo no cuadra.
// Desde la decisión 8 del doc 16 (01/10/2026) el sistema NO apila (APILAR_HISTORIAL = false en app_core: con el
// fallo de Google, atrás tras una recarga deja la pantalla en blanco). La sonda lee el interruptor y comprueba lo
// que toca en cada modo: apagado, que todo reemplace y que F5 siga devolviendo el estado; encendido, además el
// recorrido de atrás/adelante dentro de la pantalla.
//   node scripts/laboratorio/url-pestanas.mjs <carpeta del proyecto> <salida FUERA del repo>
// En esta PC, lanzarlo desde PowerShell con la ruta larga (desde Git Bash no llegó a conectar con Chrome).

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [, , DIR, OUT] = process.argv;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PUERTO_HTTP = 8797, PUERTO_CDP = 9397;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!DIR || !OUT || !path.relative(REPO, path.resolve(OUT)).startsWith('..')) { console.error('La salida tiene que ir FUERA del repo: ' + OUT); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const leer = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const PARAMS = JSON.parse(leer('Code.gs').match(/const PARAMS_VISTA = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
// ¿Apila de verdad? (decisión 8). Se le pregunta a la página al cargar (AppUrl.APILA_HISTORIAL): en el build
// esbuild renombra la constante, pero no la propiedad. Sin ella (código anterior a la decisión 8), apilaba.
// `nE(si, no)`: cuántas entradas debe haber según el interruptor.
let APILA = true;
const nE = (si, no) => (APILA ? si : no);
const BASE = 'https://repro.invalid/exec';
const CORREO = 'banco@ventel.test';

// ── Datos de mentira ──────────────────────────────────────────────────────────────────────────
// Cinco líneas: dos con el mismo SKU (111 y 111~2), una sin SKU (~1) y una sin enlace (555).
const URL_ART = (n) => 'https://www.liverpool.com.mx/tienda/pdp/articulo-' + n + '/' + n;
const linea = (indice, sku, desc, conEnlace) => ({ indice, sku, description: desc, quantity: 1, unitPrice: 1000 + indice,
  costPaymentUnique: 0, discountPublicPercent: 0, additionalDiscountApplied: 'No', additionalDiscountPercent: 0,
  imageUrl: '', productUrl: conEnlace ? URL_ART(indice) : '', urlDescartada: false });
const PRODUCTOS = [linea(0, '111', 'Licuadora A', true), linea(1, '222', 'Batidora B', true), linea(2, '111', 'Licuadora A (segunda línea)', true),
  linea(3, '', 'Artículo sin SKU', true), linea(4, '555', 'Artículo sin enlace', false)];
const PUNTOS = [{ id: 'cliente', estado: 'ok', titulo: 'Datos del cliente', detalle: 'Completos' }];
const revision = (conDoc) => ({ success: true, revisor: { email: CORREO, nombre: 'Banco' },
  quote: { folio: 'VT-PRUEBA', timestamp: '2026-10-01T12:00:00Z', advisorName: 'Asesor', advisorEmail: 'a@b.c', clientName: 'Cliente',
    clientEmail: 'cliente@correo.mx', clientPhone: '5555555555', summarySubtotal: 4310, summaryVat: 689.6, summaryTotal: 4999.6,
    observations: '', format: conDoc ? 'ccl_liverpool' : 'actual', status: 'En revisión', driveLink: '' },
  products: PRODUCTOS,
  sheetEmbedUrl: conDoc ? 'https://docs.google.com/spreadsheets/d/HOJA/htmlembed' : '',
  sheetUrl: conDoc ? 'https://docs.google.com/spreadsheets/d/HOJA/edit' : '', hojaIncrustable: !!conDoc,
  checklistGeneral: PUNTOS, auditoria: { score: 92, resumen: 'Todo cuadra', puntos: PUNTOS },
  revision: { estado: '', por: '', nombre: '', fecha: '', notas: '', aprobada: false } });
const COTIZACION = { folio: 'VT-PRUEBA', timestamp: '2026-10-01T12:00:00Z', advisorName: 'Asesor', clientName: 'Cliente', clientEmail: 'cliente@correo.mx',
  clientPhone: '5555555555', summarySubtotal: 4310, summaryVat: 689.6, summaryTotal: 4999.6, observations: '', format: 'ccl_liverpool',
  products: PRODUCTOS.map((p) => ({ sku: p.sku, description: p.description, quantity: 1, unitPrice: p.unitPrice })) };
const FORMATOS = { success: true, defaultId: 'ccl_liverpool', formats: [{ id: 'actual', name: 'Cotización estándar' }, { id: 'ccl_liverpool', name: 'Formato CCL Liverpool' }] };

// La página que pide la sonda: <pantalla>.html?<parámetros>. Lo que sobra de PARAMS_VISTA (onb, doc, cache) es de la sonda.
function ensamblar(pantalla, q) {
  const app = Object.assign({ baseUrl: BASE }, Object.fromEntries(PARAMS.map((p) => [p, q.get(p) || ''])));
  const APP_JSON = JSON.stringify(app).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return leer(pantalla + '.html').replace(/<\?(!=|=)?([\s\S]*?)\?>/g, (mm, tipo, cuerpo) => {
    const inc = /^\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/.exec(cuerpo);
    if (tipo === '!=' && inc) return leer(inc[1].replace(/\.html$/, '') + '.html');
    if (/^\s*APP_JSON\s*;?\s*$/.test(cuerpo)) return APP_JSON;
    throw new Error('scriptlet desconocido: ' + mm);
  });
}
const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const pantalla = u.pathname.replace(/^\//, '').replace(/\.html$/, '');
  if (!['revision_cotizacion', 'cotizado_preview'].includes(pantalla)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(ensamblar(pantalla, u.searchParams));
});
await new Promise((r) => servidor.listen(PUERTO_HTTP, '127.0.0.1', r));
const ORIGEN = 'http://127.0.0.1:' + PUERTO_HTTP;

// ── Lo que se inyecta antes que nada en cada documento ────────────────────────────────────────
const stub = `(() => {
  if (window !== window.top) return;
  const q = new URLSearchParams(location.search);
  try {
    localStorage.setItem('ventel-user-name', 'Banco de Pruebas');
    localStorage.setItem('ventel-user-email', '${CORREO}');
    localStorage.setItem('ventel-llave', 'llave-de-banco');
    localStorage.setItem('ventel-sesion-actividad', String(Date.now()));
    localStorage.setItem('ventel-user-advanced', 'true');
    localStorage.setItem('ventel-user-role', 'maestro');
    // El recorrido guiado se da por visto salvo que la sonda pida verlo (?onb=1).
    localStorage.setItem('ventel-onb-v1', JSON.stringify(q.get('onb') === '1' ? {} :
      { '${CORREO}': { revision_cotizacion: 9, cotizado_preview: 9 } }));
  } catch (e) {}

  /* El historial: [{ p: parámetros, h: hash }] + índice, en sessionStorage (sobrevive al F5 de la sonda). */
  const H = 'sonda-historial';
  const leerH = () => { try { return JSON.parse(sessionStorage.getItem(H)); } catch (e) { return null; } };
  const guardarH = (x) => sessionStorage.setItem(H, JSON.stringify(x));
  let hist = leerH();
  if (!hist) {
    const p = {}; q.forEach((v, k) => { if (k !== 'onb' && k !== 'doc') p[k] = v; });
    p.page = location.pathname.replace(/^\\//, '').replace(/\\.html$/, '');
    hist = { e: [{ p, h: '' }], i: 0 }; guardarH(hist);
  }
  let manejador = null;
  const lugar = (x) => ({ parameter: Object.assign({}, x.p), parameters: Object.fromEntries(Object.entries(x.p).map(([k, v]) => [k, [v]])), hash: x.h || '' });
  window.__hist = {
    estado: () => { const x = leerH(); return { n: x.e.length, i: x.i, p: x.e[x.i].p }; },
    mover: (d) => { const x = leerH(); const j = x.i + d; if (j < 0 || j >= x.e.length) return false; x.i = j; guardarH(x);
      if (manejador) manejador({ state: x.e[j].p, location: lugar(x.e[j]) }); return true; }
  };
  const escribir = (apilar) => function (estado, params, hash) {
    const x = leerH(); const ent = { p: Object.assign({}, params || {}), h: hash || '' };
    if (apilar) { x.e = x.e.slice(0, x.i + 1); x.e.push(ent); x.i = x.e.length - 1; } else x.e[x.i] = ent;
    guardarH(x);
  };

  /* google.script.run con respuestas de mentira, contando qué se pidió. */
  const R = ${JSON.stringify({ revCon: revision(true), revSin: revision(false), COTIZACION, FORMATOS })};
  window.__llamadas = [];
  const responder = (fn, a) => {
    if (fn === 'getRevisionCotizacion') return q.get('doc') === 'no' ? R.revSin : R.revCon;
    if (fn === 'revFichaArticulo') return { ok: true, titulo: 'Ficha de ' + a[1], precio: 1000, precioLista: 1000, hayPromo: false, imagen: '', capturada: Date.now() };
    if (fn === 'revPaginaArticulo') return { ok: true, html: '<!doctype html><title>pdp</title><p>Página de ' + a[1] + '</p>', capturada: Date.now() };
    if (fn === 'getQuoteDetails') return { success: true, quote: R.COTIZACION };
    if (fn === 'getEnabledQuoteFormats') return R.FORMATOS;
    return null;   // lo demás falla, como en el banco
  };
  function corredor(conf) {
    return new Proxy({}, { get(_, prop) {
      if (prop === 'withSuccessHandler') return (fn) => corredor(Object.assign({}, conf, { ok: fn }));
      if (prop === 'withFailureHandler') return (fn) => corredor(Object.assign({}, conf, { mal: fn }));
      if (prop === 'withUserObject') return (o) => corredor(Object.assign({}, conf, { obj: o }));
      return (...args) => {
        if (String(prop) === 'secEjecutarLote') {
          const lote = args[1] || [];
          lote.forEach((x) => window.__llamadas.push(String(x[0])));
          setTimeout(() => conf.ok && conf.ok(lote.map((x) => { const v = responder(String(x[0]), x[1] || []); return v ? { v, ms: 5 } : { e: 'Sin servidor (sonda)' }; })), 60);
          return;
        }
        const fn = String(prop) === 'secEjecutar' ? String(args[1]) : String(prop);
        const a = String(prop) === 'secEjecutar' ? (args[2] || []) : args;
        window.__llamadas.push(fn);
        const v = responder(fn, a);
        if (v) setTimeout(() => conf.ok && conf.ok(String(prop) === 'secEjecutar' ? { __srv: 1, v, ms: 5 } : v), 60);
        else setTimeout(() => { if (conf.mal) conf.mal(new Error('Sin servidor (sonda)'), conf.obj); }, 30);
      };
    } });
  }
  window.google = { script: { run: corredor({}),
    url: { getLocation(cb) { const x = leerH(); setTimeout(() => cb(lugar(x.e[x.i])), 0); } },
    history: { push: escribir(true), replace: escribir(false), setChangeHandler(fn) { manejador = fn; } },
    host: { close() {}, setHeight() {}, setWidth() {}, origin: location.origin, editor: { focus() {} } } } };
})();`;

// ── Chrome por CDP ────────────────────────────────────────────────────────────────────────────
const perfil = path.join(OUT, 'perfil-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + perfil, '--remote-debugging-port=' + PUERTO_CDP, '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { const v = await (await fetch('http://127.0.0.1:' + PUERTO_CDP + '/json/version')).json(); ws = new WebSocket(v.webSocketDebuggerUrl); } catch (e) {}
}
await new Promise((r, x) => { ws.onopen = r; ws.onerror = x; });
let sig = 1; const pend = new Map(), oyentes = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.x(new Error(m.error.message)) : p.r(m.result); return; } oyentes.forEach((o) => o(m)); };
const cdp = (method, params = {}, sessionId) => new Promise((r, x) => { const id = sig++; pend.set(id, { r, x }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
const cacheCdn = new Map();
async function deCdn(url) {
  if (!cacheCdn.has(url)) cacheCdn.set(url, (async () => { const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return { status: r.status, tipo: r.headers.get('content-type') || 'application/octet-stream', cuerpo: Buffer.from(await r.arrayBuffer()).toString('base64') }; })());
  return cacheCdn.get(url);
}

let fallos = 0, total = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

/** Una pestaña nueva (sessionStorage limpio = historial nuevo). */
async function pestana() {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const errores = [];
  const oyente = async (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') { const dd = m.params.exceptionDetails; errores.push(dd.exception && dd.exception.description ? dd.exception.description.split('\n')[0] : dd.text); }
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      try {
        if (request.url.startsWith(ORIGEN)) await cdp('Fetch.continueRequest', { requestId }, sessionId);
        else if (CDN.test(request.url)) { const c = await deCdn(request.url);
          await cdp('Fetch.fulfillRequest', { requestId, responseCode: c.status, body: c.cuerpo, responseHeaders: [{ name: 'Content-Type', value: c.tipo }, { name: 'Access-Control-Allow-Origin', value: '*' }] }, sessionId); }
        else await cdp('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, sessionId);
      } catch (e) {}
    }
  };
  oyentes.push(oyente);
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
  await cdp('Page.enable', {}, sessionId);
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sessionId);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: stub }, sessionId);
  const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(expr.slice(0, 60) + ' → ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text)); return r.result.value; };
  const esperar = async (expr, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) {} await dormir(100); } return false; };
  const ir = async (pantalla, params) => {
    await cdp('Page.navigate', { url: ORIGEN + '/' + pantalla + '.html?' + new URLSearchParams(params).toString() }, sessionId);
    await dormir(300);
  };
  /* F5: la página otra vez con los parámetros de la entrada ACTUAL del historial (lo que inyectaría doGet). */
  const f5 = async (extra) => {
    const h = await ev('__hist.estado()');
    const p = Object.assign({}, h.p, extra || {}); const pantalla = p.page; delete p.page;
    await ir(pantalla, p);
  };
  const foto = async (nombre) => { const f = (await cdp('Page.captureScreenshot', { format: 'png' }, sessionId)).data; fs.writeFileSync(path.join(OUT, nombre + '.png'), Buffer.from(f, 'base64')); };
  const cerrar = async () => { oyentes.splice(oyentes.indexOf(oyente), 1); await cdp('Target.closeTarget', { targetId }); };
  return { ev, esperar, ir, f5, foto, cerrar, errores };
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Lo que se mira en revision_cotizacion, de un vistazo.
const VISTA_REV = `(() => {
  const visor = document.getElementById('rev-viewer');
  const sel = (q) => { const b = document.querySelector(q + '[aria-selected="true"]'); return b ? (b.dataset.vtab || b.dataset.tab) : ''; };
  const card = document.getElementById('rev-sheet-card');
  return {
    visor: visor.classList.contains('active') ? document.getElementById('rev-viewer-titulo').textContent : '',
    vtab: sel('#rev-viewer [data-vtab]'),
    marcoPagina: !!document.querySelector('#rev-pag-host iframe'),
    opacidad: Number(getComputedStyle(visor.querySelector('.rev-viewer-card')).opacity),
    tarjeta: card.classList.contains('hidden') ? 'oculta' : (document.getElementById('rev-sheet-toggle').getAttribute('aria-expanded') === 'true' ? 'abierta' : 'plegada'),
    tab: sel('.rev-tabs [data-tab]'),
    marcoGoogle: !!document.querySelector('#rev-sheet-host iframe'),
    recorrido: !!document.querySelector('.onb-tarjeta'),
    llamadas: window.__llamadas.slice(),
    hist: __hist.estado()
  };
})()`;
const cuenta = (v, fn) => v.llamadas.filter((x) => x === fn).length;
const LISTA = '!document.getElementById("rev-contenido").classList.contains("hidden")';

try {
  // ═══ revision_cotizacion ═══════════════════════════════════════════════════════════════════
  console.log('\nrevision_cotizacion · comparador');
  let t = await pestana();
  await t.ir('revision_cotizacion', { folio: 'VT-PRUEBA' });
  ok('la revisión se pinta', await t.esperar(LISTA));
  APILA = await t.ev('!(window.AppUrl && AppUrl.APILA_HISTORIAL === false)');
  console.log('  Modo: ' + (APILA ? 'APILA historial' : 'solo REEMPLAZA (AppUrl.APILA_HISTORIAL = false, decisión 8)'));
  let v = await t.ev(VISTA_REV);
  ok('al abrir: comparador cerrado, tarjeta plegada, una entrada', !v.visor && v.tarjeta === 'plegada' && v.hist.n === 1, v);

  await t.ev('document.querySelector(\'[data-ver="2"]\').click()');
  await t.esperar('document.getElementById("rev-viewer").classList.contains("active")');
  await dormir(400);
  v = await t.ev(VISTA_REV);
  ok('abrir la 2.ª línea del SKU 111 escribe item=111~2 sin action' + (APILA ? ' (apila)' : ' (reemplaza)'), v.hist.n === nE(2, 1) && v.hist.p.item === '111~2' && !('action' in v.hist.p) && v.hist.p.folio === 'VT-PRUEBA' && v.hist.p.page === 'revision_cotizacion', v.hist);
  ok('…y el comparador enseña esa línea', v.visor === 'Licuadora A (segunda línea)' && v.vtab === 'cmp', v.visor);

  await t.ev('document.getElementById("rev-tab-pag").click()');
  await t.esperar('!!document.querySelector("#rev-pag-host iframe")');
  v = await t.ev(VISTA_REV);
  ok('la pestaña «Página de Liverpool» escribe action=pagina y trae la página una vez', v.hist.n === nE(3, 1) && v.hist.p.action === 'pagina' && cuenta(v, 'revPaginaArticulo') === 1, { hist: v.hist, n: cuenta(v, 'revPaginaArticulo') });
  await t.ev('document.getElementById("rev-tab-pag").click()');
  await dormir(400);
  v = await t.ev(VISTA_REV);
  ok('pulsar la pestaña que ya está abierta no añade entradas', v.hist.n === nE(3, 1), v.hist);

  await t.f5();
  ok('F5: la revisión se pinta', await t.esperar(LISTA));
  await t.esperar('!!document.querySelector("#rev-pag-host iframe")');
  await dormir(1200);
  v = await t.ev(VISTA_REV);
  ok('F5: vuelve el comparador en la misma línea y en «Página de Liverpool»', v.visor === 'Licuadora A (segunda línea)' && v.vtab === 'pag' && v.marcoPagina, v);
  ok('F5: la página se pide UNA vez y la URL no cambia', cuenta(v, 'revPaginaArticulo') === 1 && v.hist.n === nE(3, 1) && v.hist.i === nE(2, 0), { n: cuenta(v, 'revPaginaArticulo'), hist: v.hist });
  ok('F5: el comparador se ve (opacidad 1)', v.opacidad > 0.99, v.opacidad);
  await t.foto('rev-f5-pagina');

  if (APILA) {
    await t.ev('__hist.mover(-1)');
    await dormir(500);
    v = await t.ev(VISTA_REV);
    ok('atrás: misma línea, en la comparación, sin pedir nada', v.visor === 'Licuadora A (segunda línea)' && v.vtab === 'cmp' && cuenta(v, 'revPaginaArticulo') === 1 && cuenta(v, 'revFichaArticulo') === 1, v);
    await t.ev('__hist.mover(-1)');
    await dormir(500);
    v = await t.ev(VISTA_REV);
    ok('atrás otra vez: comparador cerrado', !v.visor && v.hist.i === 0, v);
    await t.ev('__hist.mover(1)');
    await dormir(500);
    v = await t.ev(VISTA_REV);
    ok('adelante: vuelve a abrirse en la comparación (una ficha más)', v.visor === 'Licuadora A (segunda línea)' && v.vtab === 'cmp' && cuenta(v, 'revFichaArticulo') === 2, v);
  } else {
    // Sin entradas propias, atrás no tiene a dónde volver dentro de la pantalla: saldría de ella.
    ok('sin entradas propias de la pantalla: atrás no puede caer en una vieja', v.hist.n === 1 && !(await t.ev('__hist.mover(-1)')), v.hist);
  }

  await t.ev('document.getElementById("rev-viewer-cerrar").click()');
  await dormir(500);
  v = await t.ev(VISTA_REV);
  // Reemplaza la entrada actual (si se apilaba, deja la de delante, como replaceState en un navegador).
  ok('el aspa cierra y QUITA item y action, reemplazando', !v.visor && !('item' in v.hist.p) && !('action' in v.hist.p) && v.hist.n === nE(3, 1) && v.hist.i === nE(1, 0), v.hist);

  await t.ev('document.querySelector(\'[data-ver="1"]\').click()');
  await dormir(500);
  await t.ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
  await dormir(500);
  v = await t.ev(VISTA_REV);
  ok('Escape también quita el artículo de la dirección', !v.visor && !('item' in v.hist.p), v.hist);
  ok('sin errores de página', t.errores.length === 0, t.errores);
  await t.cerrar();

  console.log('\nrevision_cotizacion · tarjeta del documento');
  t = await pestana();
  await t.ir('revision_cotizacion', { folio: 'VT-PRUEBA' });
  await t.esperar(LISTA);
  await t.ev('document.getElementById("rev-sheet-toggle").click()');
  await dormir(500);
  v = await t.ev(VISTA_REV);
  ok('abrir la tarjeta escribe sec=hoja y lee la hoja', v.tarjeta === 'abierta' && v.hist.n === nE(2, 1) && v.hist.p.sec === 'hoja' && cuenta(v, 'revHojaCotizacion') === 1, { v: v.tarjeta, hist: v.hist });
  await t.ev('document.getElementById("rev-tab-google").click()');
  await dormir(500);
  v = await t.ev(VISTA_REV);
  ok('«Hoja de Google» escribe sec=google y crea el marco', v.tab === 'google' && v.marcoGoogle && v.hist.n === nE(3, 1) && v.hist.p.sec === 'google', v);
  await t.f5();
  await t.esperar(LISTA);
  await dormir(800);
  v = await t.ev(VISTA_REV);
  ok('F5: tarjeta abierta en «Hoja de Google», con su marco', v.tarjeta === 'abierta' && v.tab === 'google' && v.marcoGoogle, v);
  ok('F5: sin leer la vista del portal, que nadie está mirando', cuenta(v, 'revHojaCotizacion') === 0, v.llamadas);
  if (APILA) {
    await t.ev('__hist.mover(-1)');
    await dormir(500);
    v = await t.ev(VISTA_REV);
    ok('atrás: «Vista en el portal», que ahora sí se lee', v.tarjeta === 'abierta' && v.tab === 'hoja' && cuenta(v, 'revHojaCotizacion') === 1, v);
    await t.ev('__hist.mover(-1)');
    await dormir(500);
    v = await t.ev(VISTA_REV);
    ok('atrás otra vez: tarjeta plegada', v.tarjeta === 'plegada', v);
    await t.ev('__hist.mover(1)');
    await dormir(300);
  } else {
    // Volver a «Vista en el portal» con su pestaña: ahora sí se lee, una vez.
    await t.ev('document.getElementById("rev-tab-hoja").click()');
    await dormir(500);
    v = await t.ev(VISTA_REV);
    ok('pestaña «Vista en el portal»: se lee entonces, una vez, sin añadir entradas', v.tab === 'hoja' && cuenta(v, 'revHojaCotizacion') === 1 && v.hist.n === 1 && v.hist.p.sec === 'hoja', v);
  }
  await t.ev('document.getElementById("rev-sheet-toggle").click()');
  await dormir(500);
  v = await t.ev(VISTA_REV);
  ok('plegarla QUITA sec, reemplazando', v.tarjeta === 'plegada' && !('sec' in v.hist.p) && v.hist.n === nE(3, 1) && v.hist.i === nE(1, 0), v.hist);
  ok('sin errores de página', t.errores.length === 0, t.errores);
  await t.cerrar();

  console.log('\nrevision_cotizacion · direcciones raras');
  const casos = [
    ['item=~1 abre la línea sin SKU', { item: '~1' }, (x) => x.visor === 'Artículo sin SKU' && x.hist.p.item === '~1'],
    ['item=111 abre la PRIMERA línea del SKU', { item: '111' }, (x) => x.visor === 'Licuadora A'],
    ['un artículo que ya no está no abre nada y se borra', { item: '999', action: 'pagina' }, (x) => !x.visor && !('item' in x.hist.p) && !('action' in x.hist.p)],
    ['un artículo sin enlace no abre nada y se borra', { item: '555' }, (x) => !x.visor && !('item' in x.hist.p)],
    ['sec desconocida: tarjeta plegada y se borra', { sec: 'xyz' }, (x) => x.tarjeta === 'plegada' && !('sec' in x.hist.p)],
    ['action desconocida con artículo: comparación y se borra', { item: '222', action: 'edit' }, (x) => x.visor === 'Batidora B' && x.vtab === 'cmp' && !('action' in x.hist.p)],
    ['sin documento CCL, sec=google se ignora y se borra', { sec: 'google', doc: 'no' }, (x) => x.tarjeta === 'oculta' && !('sec' in x.hist.p)]
  ];
  for (const [nombre, params, cond] of casos) {
    t = await pestana();
    await t.ir('revision_cotizacion', Object.assign({ folio: 'VT-PRUEBA' }, params));
    await t.esperar(LISTA);
    await dormir(900);
    v = await t.ev(VISTA_REV);
    ok(nombre, cond(v) && t.errores.length === 0, { visor: v.visor, vtab: v.vtab, tarjeta: v.tarjeta, hist: v.hist, errores: t.errores });
    await t.cerrar();
  }

  console.log('\nrevision_cotizacion · recorrido guiado');
  t = await pestana();
  await t.ir('revision_cotizacion', { folio: 'VT-PRUEBA', onb: '1' });
  await t.esperar(LISTA);
  ok('sin artículo en la dirección, el recorrido sale solo (el banco sabe lanzarlo)', await t.esperar('!!document.querySelector(".onb-tarjeta")', 6000));
  await t.cerrar();
  t = await pestana();
  await t.ir('revision_cotizacion', { folio: 'VT-PRUEBA', item: '222', onb: '1' });
  await t.esperar(LISTA);
  await dormir(3500);
  v = await t.ev(VISTA_REV);
  ok('con ?item=, el recorrido NO tapa el comparador', v.visor === 'Batidora B' && !v.recorrido, v);
  ok('…y sigue a un clic: registrado y con el botón de ayuda a la vista', await t.ev('(() => { const b = [...document.querySelectorAll("[data-onb-abrir]")]; return AppOnboarding.hay() && b.length > 0 && b.every((x) => !x.hidden); })()'));
  await t.cerrar();

  // ═══ cotizado_preview ══════════════════════════════════════════════════════════════════════
  console.log('\ncotizado_preview · formato');
  const VISTA_PREV = `(() => ({
    select: document.getElementById('format-select').value,
    ccl: !document.getElementById('ccl-preview-content').classList.contains('hidden'),
    estandar: !document.getElementById('pdf-preview-content').classList.contains('hidden'),
    hist: __hist.estado()
  }))()`;
  t = await pestana();
  await t.ir('cotizado_preview', { folio: 'VT-PRUEBA' });
  await t.esperar('document.getElementById("format-select").options.length === 2 && !document.getElementById("format-select").disabled');
  await dormir(500);
  v = await t.ev(VISTA_PREV);
  ok('al abrir: el formato de la cotización (CCL), sin tocar la URL', v.select === 'ccl_liverpool' && v.ccl && !v.estandar && v.hist.n === 1 && !('format' in v.hist.p), v);
  await t.ev('(() => { const s = document.getElementById("format-select"); s.value = "actual"; s.dispatchEvent(new Event("change")); })()');
  await dormir(600);
  v = await t.ev(VISTA_PREV);
  ok('elegir «Cotización estándar» escribe format=actual, reemplazando', v.hist.p.format === 'actual' && v.hist.n === 1 && v.estandar && !v.ccl, v);
  await t.f5();
  await t.esperar('document.getElementById("format-select").options.length === 2 && !document.getElementById("format-select").disabled');
  await dormir(800);
  v = await t.ev(VISTA_PREV);
  ok('F5: sigue en la estándar, con el selector puesto', v.select === 'actual' && v.estandar && !v.ccl, v);
  ok('sin errores de página', t.errores.length === 0, t.errores);
  await t.foto('preview-f5-estandar');
  await t.cerrar();

  t = await pestana();
  await t.ir('cotizado_preview', { folio: 'VT-PRUEBA', format: 'zzz' });
  await t.esperar('document.getElementById("format-select").options.length === 2 && !document.getElementById("format-select").disabled');
  await dormir(800);
  v = await t.ev(VISTA_PREV);
  ok('un formato que no existe cae al predeterminado del catálogo', v.select === 'ccl_liverpool' && v.ccl, v);
  await t.cerrar();

  t = await pestana();
  await t.ev('localStorage.setItem("pendingQuoteData", ' + JSON.stringify(JSON.stringify(COTIZACION)) + ')').catch(() => {});
  await t.ir('cotizado_preview', {});
  await t.ev('localStorage.setItem("pendingQuoteData", ' + JSON.stringify(JSON.stringify(COTIZACION)) + ')');
  await t.ir('cotizado_preview', {});
  await t.esperar('document.getElementById("preview-folio").textContent === "VT-PRUEBA"');
  await dormir(800);
  v = await t.ev(VISTA_PREV);
  ok('sin folio en la URL (caché genérica): se escribe el folio, reemplazando', v.hist.p.folio === 'VT-PRUEBA' && v.hist.n === 1, v.hist);
  await t.cerrar();
} finally {
  console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
  try { ws.close(); } catch (e) {}
  chrome.kill();
  servidor.close();
  process.exitCode = fallos ? 1 : 0;
}
