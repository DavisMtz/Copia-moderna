// Reproduce el Monitor de promociones en Chrome headless SIN movimiento reducido, en dos variantes:
//   pagina → los datos vienen dentro de la página (__APP__.datos, F3a): onData en el DOMContentLoaded
//   red    → los datos llegan por google.script.run a los 2 s (como antes de la F3a)
// y mide, a varios tiempos, la opacidad de las tarjetas y de las cifras del día.
//   node repro-monitor.mjs <carpeta del proyecto> <salida> [variante…]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [, , DIR, OUT, ...SOLO] = process.argv;
const VARIANTES = SOLO.length ? SOLO : ['pagina', 'red'];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PUERTO_HTTP = 8791, PUERTO_CDP = 9391;
// La salida va FUERA del repo: el hook de auto-push subiría las capturas.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!OUT || !path.relative(REPO, path.resolve(OUT)).startsWith('..')) { console.error('La salida tiene que ir FUERA del repo: ' + OUT); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const leer = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const code = leer('Code.gs');
const PARAMS = JSON.parse(code.match(/const PARAMS_VISTA = (\[[^\]]*\])/)[1].replace(/'/g, '"'));

// 50 promociones como las reales: vigentes hoy, de varias direcciones.
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const hoy = new Date(); const d = hoy.getDate(), m = MESES[hoy.getMonth()];
const DIRS = ['MULTIMEDIA','HOGAR','DEPORTES','MUJER','HOMBRE','BEBÉS','INFANTILES','DIVERSOS'];
const promos = [];
for (let i = 0; i < 50; i++) {
  promos.push({ direccion: DIRS[i % DIRS.length], categoria: 'Categoría ' + (i + 1), promocion: 'Hasta ' + (10 + (i % 6) * 5) + '% de descuento',
    marca: i % 3 ? 'Marca ' + i : '', vigencia: Math.max(1, d - 3) + ' al ' + Math.min(28, d + 4 + (i % 5)) + ' de ' + m,
    liga: 'https://www.liverpool.com.mx', origen: i % 4 ? 'Promociones' : 'Marketplace' });
}
const DIA = 86400000, hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
const MOCK = { status: 'success', error: null, promociones: promos, eventos: [
  { titulo: 'EVENTO A', inicio: hoy0 - DIA, fin: hoy0 + 6 * DIA, esTodoElDia: true, ubicacion: '', descripcion: '' },
  { titulo: 'EVENTO B', inicio: hoy0 + DIA, fin: hoy0 + 13 * DIA, esTodoElDia: true, ubicacion: '', descripcion: '' }] };

function ensamblar(variante) {
  const app = Object.assign({ baseUrl: 'https://repro.invalid/exec' }, Object.fromEntries(PARAMS.map((p) => [p, ''])));
  if (variante === 'pagina') { app.datos = { fetchApplicationData: MOCK }; app.datosAt = Date.now(); app.datosMs = 50; }
  const APP_JSON = JSON.stringify(app).replace(/</g, '\\u003c');
  return leer('Promociones.html').replace(/<\?(!=|=)?([\s\S]*?)\?>/g, (mm, tipo, cuerpo) => {
    const inc = /^\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/.exec(cuerpo);
    if (tipo === '!=' && inc) return leer(inc[1].replace(/\.html$/, '') + '.html');
    if (/^\s*APP_URL\s*;?\s*$/.test(cuerpo)) return 'https://repro.invalid/exec';
    if (/^\s*APP_JSON\s*;?\s*$/.test(cuerpo)) return APP_JSON;
    throw new Error('scriptlet desconocido: ' + mm);
  });
}
const paginas = Object.fromEntries(VARIANTES.map((v) => [v, ensamblar(v)]));
const servidor = http.createServer((req, res) => {
  const v = req.url.split('?')[0].replace(/^\//, '').replace(/\.html$/, '');
  if (!paginas[v]) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(paginas[v]);
});
await new Promise((r) => servidor.listen(PUERTO_HTTP, '127.0.0.1', r));

// google.script.run falso: fetchApplicationData contesta a los 2 s; lo demás falla a los 40 ms.
const stub = (datos) => `(() => {
  if (window !== window.top) return;
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  const DATOS = ${JSON.stringify(datos)};
  function corredor(conf) {
    return new Proxy({}, { get(_, prop) {
      if (prop === 'withSuccessHandler') return (fn) => corredor(Object.assign({}, conf, { ok: fn }));
      if (prop === 'withFailureHandler') return (fn) => corredor(Object.assign({}, conf, { mal: fn }));
      if (prop === 'withUserObject') return (o) => corredor(Object.assign({}, conf, { obj: o }));
      return (...args) => {
        const fn = String(prop) === 'secEjecutar' ? String(args[1]) : String(prop);
        if (fn === 'fetchApplicationData') setTimeout(() => conf.ok && conf.ok({ __srv: 1, v: DATOS, ms: 5 }), 2000);
        else setTimeout(() => { if (conf.mal) conf.mal(new Error('Sin servidor (repro)'), conf.obj); }, 40);
      };
    } });
  }
  window.google = { script: { run: corredor({}),
    url: { getLocation(cb) { setTimeout(() => cb({ parameter: {}, parameters: {}, hash: '' }), 0); } },
    history: { push() {}, replace() {}, setChangeHandler() {} },
    host: { close() {}, setHeight() {}, setWidth() {}, origin: location.origin, editor: { focus() {} } } } };
})();`;

const MEDIR = `(() => {
  const vh = innerHeight;
  const op = (e) => Math.round(parseFloat(getComputedStyle(e).opacity) * 100) / 100;
  const cards = [...document.querySelectorAll('.promo-card')];
  const enVista = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.top < vh && r.bottom > 0; });
  const tiles = [...document.querySelectorAll('.stat-tile')];
  return { vh, visibility: document.visibilityState, tarjetas: cards.length, enVista: enVista.length,
    opEnVista: enVista.map(op), tiles: tiles.map(op),
    heroStats: (document.getElementById('heroStats') || {}).style ? document.getElementById('heroStats').style.visibility : '?',
    triggers: window.ScrollTrigger ? ScrollTrigger.getAll().length : -1, gsapTime: window.gsap ? Math.round(gsap.globalTimeline.time() * 100) / 100 : -1 };
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
  for (const v of VARIANTES) {
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
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: stub(MOCK) }, sessionId);
    await cdp('Page.navigate', { url: 'http://127.0.0.1:' + PUERTO_HTTP + '/' + v + '.html' }, sessionId);
    const t0 = Date.now();
    for (const t of [1500, 3500, 7000]) {
      while (Date.now() - t0 < t) await new Promise((r) => setTimeout(r, 100));
      const med = (await cdp('Runtime.evaluate', { expression: MEDIR, returnByValue: true }, sessionId)).result.value;
      const foto = (await cdp('Page.captureScreenshot', { format: 'png' }, sessionId)).data;
      fs.writeFileSync(path.join(OUT, v + '-' + t + '.png'), Buffer.from(foto, 'base64'));
      console.log(v.padEnd(7), (t / 1000 + ' s').padEnd(6), JSON.stringify(med));
    }
    // Al bajar: las tarjetas que entran en pantalla tienen que revelarse.
    for (const y of [1400, 2800]) {
      await cdp('Runtime.evaluate', { expression: 'window.scrollTo(0, ' + y + ')' }, sessionId);
      await new Promise((r) => setTimeout(r, 1500));
      const med = (await cdp('Runtime.evaluate', { expression: MEDIR, returnByValue: true }, sessionId)).result.value;
      console.log(v.padEnd(7), ('y=' + y).padEnd(6), JSON.stringify({ enVista: med.enVista, opEnVista: med.opEnVista }));
    }
    if (errores.length) console.log('   errores:', errores.slice(0, 3));
    oyentes.splice(oyentes.indexOf(oyente), 1);
    await cdp('Target.closeTarget', { targetId });
  }
} finally {
  try { ws.close(); } catch (e) {}
  chrome.kill();
  servidor.close();
}
