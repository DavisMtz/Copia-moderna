// F3a.2 · Las encuestas del Portal (Index) en Chrome headless SIN movimiento reducido, con dos encuestas
// publicadas (una ya votada por quien mira, la otra no):
//   pagina → sus resultados dentro de __APP__.datos (pubResultados, F3a.2)   red → por google.script.run a los 2 s
// Dice qué enseña cada encuesta a los ~1.2, ~4 y ~7 s (barras, botones y cuál es el voto propio) y qué funciones
// llamó la página, lotes de la F3b incluidos. Después, la misma sonda de opacidad que revelado-portal.mjs.
// Lo esperado: en «pagina», barras desde el principio y ninguna llamada a pubResultados; en «red», botones
// hasta que contesta el lote.
//   node scripts/laboratorio/revelado-encuestas.mjs <carpeta del proyecto> <salida FUERA del repo>
// En esta PC, lanzarlo desde PowerShell con la ruta larga: desde Git Bash, con la ruta corta del scratchpad,
// no llegó a conectar con Chrome (01/10/2026).

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [, , DIR, OUT] = process.argv;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PUERTO_HTTP = 8793, PUERTO_CDP = 9393;
// La salida va FUERA del repo: el hook de auto-push subiría las capturas.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!OUT || !path.relative(REPO, path.resolve(OUT)).startsWith('..')) { console.error('La salida tiene que ir FUERA del repo: ' + OUT); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const leer = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const PARAMS = JSON.parse(leer('Code.gs').match(/const PARAMS_VISTA = (\[[^\]]*\])/)[1].replace(/'/g, '"'));

const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const TOOLS = { status: 'ok', error: null,
  herramientas: rep(9, (i) => ({ nombre: 'Herramienta ' + (i + 1), enlace: 'https://ejemplo.com/h' + i, comoAcceder: 'Con tu usuario', descripcion: 'Descripción de la herramienta ' + (i + 1), claves: 'clave' + i })),
  presentaciones: rep(4, (i) => ({ nombre: 'Presentación ' + (i + 1), liga: 'https://ejemplo.com/p' + i, descripcion: 'Material ' + i })),
  paqueterias: rep(5, (i) => ({ nombre: 'Paquetería ' + (i + 1), liga: 'https://ejemplo.com/q' + i, soms: 'SOMS ' + i })),
  formatos: rep(4, (i) => ({ acceso: 'Formato ' + (i + 1), observaciones: 'Observaciones ' + i, liga: 'https://ejemplo.com/f' + i })),
  pdePago: rep(4, (i) => ({ nombre: 'Pago ' + (i + 1), detalles: 'Detalles del pago ' + i, liga: 'https://ejemplo.com/g' + i })),
  plantillas: rep(3, (i) => ({ titulo: 'Plantilla ' + (i + 1), tipo: 'correo', asunto: 'Asunto ' + i, cuerpo: 'Hola, cuerpo ' + i, consideraciones: '' })),
  avisos: [], anuncios: [
    { id: 'anc-e1', formato: 'tarjeta', orden: 0, titulo: 'Turno de diciembre', descripcion: 'Ayúdanos a organizar el mes.', encuesta: { pregunta: '¿Qué turno prefieres?', opciones: ['Mañana', 'Tarde', 'Noche'], cierre: '2026-12-31' } },
    { id: 'anc-e2', formato: 'tarjeta', orden: 1, titulo: 'Capacitación', descripcion: 'Cuéntanos.', encuesta: { pregunta: '¿Te sirvió la capacitación?', opciones: ['Sí', 'No'] } }] };
const VOTOS = { 'anc-e1': { total: 5, conteo: { 'Mañana': 3, 'Tarde': 2 }, miVoto: 'Mañana' }, 'anc-e2': { total: 2, conteo: { 'Sí': 2 }, miVoto: '' } };
const ahora = Date.now(), DIA = 86400000;
const PROMOS = { status: 'ok', activas: 12, porTerminar: 3,
  promociones: rep(8, (i) => ({ direccion: ['HOGAR', 'MODA', 'MULTIMEDIA'][i % 3], categoria: 'Categoría ' + i, promocion: 'Hasta ' + (10 + i * 5) + '% de descuento',
    marca: 'Marca ' + i, origen: 'Promociones', vigencia: '20 al 30 de septiembre', fin: ahora + (i + 1) * DIA, dias: i + 1 })),
  eventos: rep(3, (i) => ({ titulo: 'Evento ' + i, inicio: ahora + i * DIA, fin: ahora + (i + 4) * DIA, esTodoElDia: true, descripcion: '' })) };
const TRAZ = { status: 'ok', error: null, generado: new Date().toISOString(), hojaId: 'h', avisos: [],
  secciones: [['bigticket', 'bt', 'Big Ticket', 'BT'], ['softline', 'sl', 'Soft Line', 'SF'], ['slmensajerias', 'slm', 'SL Mensajerías', 'SF'],
    ['mkp', 'mkp', 'MarketPlace', 'MKP'], ['tienda', 'tda', 'Tienda Física', 'TDA'], ['generales', 'gen', 'Generales', 'GEN']]
    .map(([id, prefijo, label, etiqueta]) => ({ id, prefijo, label, etiqueta, hoja: label, tieneAvance: false,
      procesos: rep(5, (i) => ({ n: i + 1, nombre: 'Proceso ' + (i + 1) + ' de ' + label, tiempo: (i + 1) + ' días', observaciones: 'Observaciones del proceso ' + (i + 1) })) })) };
const MODULOS = { success: true, apagados: [], nombres: {} };
const RESPUESTAS = { fetchToolsData: TOOLS, fetchPromoCounts: PROMOS, fetchTrazabilidadData: TRAZ, obtenerModulosPublicos: MODULOS };
const EN_PAGINA = Object.assign({}, RESPUESTAS, { pubResultados: { status: 'ok', correo: '', porId: VOTOS } });

function ensamblar(variante) {
  const app = Object.assign({ baseUrl: 'https://repro.invalid/exec' }, Object.fromEntries(PARAMS.map((p) => [p, ''])));
  if (variante === 'pagina') { app.datos = EN_PAGINA; app.datosAt = Date.now(); app.datosMs = 60; }
  const APP_JSON = JSON.stringify(app).replace(/</g, '\\u003c');
  return leer('Index.html').replace(/<\?(!=|=)?([\s\S]*?)\?>/g, (mm, tipo, cuerpo) => {
    const inc = /^\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/.exec(cuerpo);
    if (tipo === '!=' && inc) return leer(inc[1].replace(/\.html$/, '') + '.html');
    if (/^\s*APP_URL\s*;?\s*$/.test(cuerpo)) return 'https://repro.invalid/exec';
    if (/^\s*APP_JSON\s*;?\s*$/.test(cuerpo)) return APP_JSON;
    throw new Error('scriptlet desconocido: ' + mm);
  });
}
const paginas = { pagina: ensamblar('pagina'), red: ensamblar('red') };
const servidor = http.createServer((req, res) => {
  const v = req.url.split('?')[0].replace(/^\//, '').replace(/\.html$/, '');
  if (!paginas[v]) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(paginas[v]);
});
await new Promise((r) => servidor.listen(PUERTO_HTTP, '127.0.0.1', r));

const stub = `(() => {
  if (window !== window.top) return;
  try { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('ventel-onb-local', '{}'); } catch (e) {}
  const R = ${JSON.stringify(RESPUESTAS)}; const V = ${JSON.stringify(VOTOS)}; window.__llamadas = [];
  const responder = (fn, a) => fn === 'pubResultados' ? Object.assign({ status: 'ok' }, V[a[0]]) : R[fn];
  function corredor(conf) {
    return new Proxy({}, { get(_, prop) {
      if (prop === 'withSuccessHandler') return (fn) => corredor(Object.assign({}, conf, { ok: fn }));
      if (prop === 'withFailureHandler') return (fn) => corredor(Object.assign({}, conf, { mal: fn }));
      if (prop === 'withUserObject') return (o) => corredor(Object.assign({}, conf, { obj: o }));
      return (...args) => {
        const t = Math.round(performance.now());
        if (String(prop) === 'secEjecutarLote') { const lote = args[1] || []; window.__llamadas.push({ fn: 'lote[' + lote.map((x) => x[0]).join('+') + ']', t });
          setTimeout(() => conf.ok && conf.ok(lote.map((x) => { const v = responder(x[0], x[1] || []); return v ? { v, ms: 5 } : { e: 'Sin servidor (repro)' }; })), 2000); return; }
        const fn = String(prop) === 'secEjecutar' ? String(args[1]) : String(prop);
        const a = String(prop) === 'secEjecutar' ? (args[2] || []) : args;
        window.__llamadas.push({ fn, t });
        const v = responder(fn, a);
        if (v) setTimeout(() => conf.ok && conf.ok({ __srv: 1, v, ms: 5 }), 2000);
        else setTimeout(() => { if (conf.mal) conf.mal(new Error('Sin servidor (repro)'), conf.obj); }, 40);
      };
    } });
  }
  window.google = { script: { run: corredor({}),
    url: { getLocation(cb) { setTimeout(() => cb({ parameter: {}, parameters: {}, hash: '' }), 0); } },
    history: { push() {}, replace() {}, setChangeHandler() {} },
    host: { close() {}, setHeight() {}, setWidth() {}, origin: location.origin, editor: { focus() {} } } } };
})();`;

const SONDA = `(() => {
  const vh = innerHeight, vw = innerWidth;
  const efectiva = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
    const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return -1; o *= parseFloat(cs.opacity); } return o; };
  const ocultos = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.children.length || /^(SCRIPT|STYLE|svg|path)$/i.test(e.tagName)) continue;
    const t = (e.textContent || '').trim(); if (t.length < 3) continue;
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    const o = efectiva(e); if (o >= 0 && o < 0.2) ocultos.push(t.slice(0, 28) + '·' + o.toFixed(2));
  }
  return { y: Math.round(scrollY), alto: document.documentElement.scrollHeight, ocultos: ocultos.length, muestra: ocultos.slice(0, 6) };
})()`;

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
const cache = new Map();
async function deCdn(url) {
  if (!cache.has(url)) cache.set(url, (async () => { const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return { status: r.status, tipo: r.headers.get('content-type') || 'application/octet-stream', cuerpo: Buffer.from(await r.arrayBuffer()).toString('base64') }; })());
  return cache.get(url);
}
try {
  for (const v of ['pagina', 'red']) {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    const errores = [];
    const oyente = async (m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') { const dd = m.params.exceptionDetails; errores.push(dd.exception && dd.exception.description ? dd.exception.description.split('\n')[0] : dd.text); }
      if (m.method === 'Fetch.requestPaused') {
        const { requestId, request } = m.params;
        try {
          if (request.url.startsWith('http://127.0.0.1:' + PUERTO_HTTP)) await cdp('Fetch.continueRequest', { requestId }, sessionId);
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
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }, { name: 'prefers-color-scheme', value: 'light' }] }, sessionId);
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: stub }, sessionId);
    await cdp('Page.navigate', { url: 'http://127.0.0.1:' + PUERTO_HTTP + '/' + v + '.html' }, sessionId);
    const ENC = '(() => ({ t: Math.round(performance.now()), enc: [...document.querySelectorAll("#anunciosCards [data-enc]")].map((b) => b.getAttribute("data-enc") + ":barras=" + b.querySelectorAll(".pub-bar").length + ",botones=" + b.querySelectorAll(".pub-op").length + ",mia=" + ((b.querySelector(".pub-bar.mia span") || {}).textContent || "").trim()), llamadas: (window.__llamadas || []).map((x) => x.fn + "@" + x.t) }))()';
    for (const espera of [1200, 2800, 3000]) { await new Promise((r) => setTimeout(r, espera)); console.log(v.padEnd(7), 'encuestas', JSON.stringify((await cdp('Runtime.evaluate', { expression: ENC, returnByValue: true }, sessionId)).result.value)); }
    // El recorrido guiado de la primera visita tapa la pantalla: se cierra con Escape.
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
    await new Promise((r) => setTimeout(r, 800));
    const alto = (await cdp('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true }, sessionId)).result.value;
    for (let y = 0; y < alto; y += 850) {
      await cdp('Runtime.evaluate', { expression: 'window.scrollTo(0,' + y + ')' }, sessionId);
      await new Promise((r) => setTimeout(r, 1300));
      const s = (await cdp('Runtime.evaluate', { expression: SONDA, returnByValue: true }, sessionId)).result.value;
      if (s.ocultos || y === 0) console.log(v.padEnd(7), JSON.stringify(s));
      if (y === 0 || y === 1700) {
        const foto = (await cdp('Page.captureScreenshot', { format: 'png' }, sessionId)).data;
        fs.writeFileSync(path.join(OUT, v + '-y' + y + '.png'), Buffer.from(foto, 'base64'));
      }
    }
    console.log(v.padEnd(7), 'fin · alto', alto, '· errores:', errores.length ? errores.slice(0, 3) : 0);
    oyentes.splice(oyentes.indexOf(oyente), 1);
    await cdp('Target.closeTarget', { targetId });
  }
} finally {
  try { ws.close(); } catch (e) {}
  chrome.kill();
  servidor.close();
}
