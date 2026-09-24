// Banco del Portal (Fase 2 del doc 16): cada pantalla, ensamblada como include() con DOS carpetas
// (p. ej. la fuente y build/), se abre en Chrome headless con la misma sesión falsa y el mismo
// google.script.run de mentira (responde siempre con fallo). Compara excepciones, avisos, llamadas al
// servidor, texto, estructura y píxeles, y mide el ruido cargando dos veces la primera carpeta.
// A la red solo salen los CDN (GSAP, Chart.js, fuentes), cacheados e iguales para las dos carpetas.
//
//   node scripts/laboratorio/banco.mjs <carpetaA> <carpetaB> <salida> [archivoDePágina…]
//   p. ej.  node scripts/laboratorio/banco.mjs "Carpeta del proyecto" build <scratchpad>/banco Index
//
// La salida (capturas PNG, informe.json, perfil de Chrome) va FUERA del repo: el hook lo sube todo.
// Cubre la carga y los estados de error. Los datos reales y los clics los tiene que ver una persona.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [, , DIR_FUENTE, DIR_BUILD, DIR_OUT, ...SOLO] = process.argv;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PUERTO_HTTP = 8765, PUERTO_CDP = 9333;
const BASE = 'https://banco.invalid/macros/s/BANCO/exec';
const ESPERA_MS = Number(process.env.ESPERA_MS || 6000);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!DIR_OUT || !path.relative(REPO, path.resolve(DIR_OUT)).startsWith('..')) {
  console.error('La salida tiene que ir FUERA del repo (el hook subiría las capturas): ' + DIR_OUT);
  process.exit(1);
}
fs.mkdirSync(DIR_OUT, { recursive: true });

// ── Páginas y ensamblado (como include(): un nivel, sin evaluar el parcial) ──────────────────
const code = fs.readFileSync(path.join(DIR_FUENTE, 'Code.gs'), 'utf8');
const PARAMS = JSON.parse(code.match(/const PARAMS_VISTA = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const PAGINAS = [...new Set([...code.matchAll(/\bfile:\s*'([^']+)'/g)].map((m) => m[1]))].filter((p) => !SOLO.length || SOLO.includes(p));
const SIN_SESION = new Set(['inicioDeSesion', 'registro', 'recuperar']);
const APP_JSON = JSON.stringify(Object.assign({ baseUrl: BASE }, Object.fromEntries(PARAMS.map((p) => [p, '']))));
const leer = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
function ensamblar(dir, pagina) {
  return leer(dir, pagina + '.html').replace(/<\?(!=|=)?([\s\S]*?)\?>/g, (m, tipo, cuerpo) => {
    const inc = /^\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/.exec(cuerpo);
    if (tipo === '!=' && inc) return leer(dir, inc[1].replace(/\.html$/, '') + '.html');
    if (/^\s*APP_URL\s*;?\s*$/.test(cuerpo)) return BASE;
    if (/^\s*APP_JSON\s*;?\s*$/.test(cuerpo)) return APP_JSON;
    throw new Error(pagina + ': scriptlet que el banco no sabe resolver: ' + m);
  });
}
const paginas = {};
for (const p of PAGINAS) paginas['fuente/' + p] = ensamblar(DIR_FUENTE, p), paginas['build/' + p] = ensamblar(DIR_BUILD, p);

const servidor = http.createServer((req, res) => {
  const clave = decodeURIComponent(req.url.split('?')[0].replace(/^\//, '').replace(/\.html$/, ''));
  if (paginas[clave] === undefined) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(paginas[clave]);
});
await new Promise((r) => servidor.listen(PUERTO_HTTP, '127.0.0.1', r));
const ORIGEN = 'http://127.0.0.1:' + PUERTO_HTTP;

// ── Lo que se inyecta antes que nada en cada documento ────────────────────────────────────
const stub = (conSesion) => `(() => {
  if (window !== window.top) return;
  const D = Date, base = new D('2026-09-23T12:00:00-06:00').getTime(), t0 = performance.now();
  const ahora = () => base + Math.floor(performance.now() - t0);
  function FalsaFecha(...a) { if (!new.target) return new D(ahora()).toString(); return a.length ? new D(...a) : new D(ahora()); }
  FalsaFecha.prototype = D.prototype; FalsaFecha.now = ahora; FalsaFecha.parse = D.parse; FalsaFecha.UTC = D.UTC;
  Object.setPrototypeOf(FalsaFecha, D); window.Date = FalsaFecha;
  let semilla = 123456789;
  Math.random = () => { semilla |= 0; semilla = semilla + 0x6D2B79F5 | 0; let t = Math.imul(semilla ^ semilla >>> 15, 1 | semilla);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const banco = window.__banco = { llamadas: [] };
  try {
    localStorage.clear(); sessionStorage.clear();
    if (${conSesion}) {
      localStorage.setItem('ventel-user-name', 'Banco de Pruebas');
      localStorage.setItem('ventel-user-email', 'banco@ventel.test');
      localStorage.setItem('ventel-llave', 'llave-de-banco');
      localStorage.setItem('ventel-sesion-actividad', String(Date.now()));
      localStorage.setItem('ventel-user-advanced', 'true');
      localStorage.setItem('ventel-user-role', 'maestro');
    }
  } catch (e) {}
  function corredor(conf) {
    return new Proxy({}, { get(_, prop) {
      if (prop === 'withSuccessHandler') return (fn) => corredor(Object.assign({}, conf, { ok: fn }));
      if (prop === 'withFailureHandler') return (fn) => corredor(Object.assign({}, conf, { mal: fn }));
      if (prop === 'withUserObject') return (o) => corredor(Object.assign({}, conf, { obj: o }));
      return (...args) => {
        banco.llamadas.push({ fn: String(prop), sub: String(prop) === 'secEjecutar' ? String(args[1]) : '' });
        setTimeout(() => { if (conf.mal) conf.mal(new Error('Sin servidor (banco)'), conf.obj); }, 40);
      };
    } });
  }
  window.google = { script: {
    run: corredor({}),
    url: { getLocation(cb) { setTimeout(() => cb({ parameter: {}, parameters: {}, hash: '' }), 0); } },
    history: { push() {}, replace() {}, setChangeHandler() {} },
    host: { close() {}, setHeight() {}, setWidth() {}, origin: location.origin, editor: { focus() {} } }
  } };
})();`;

const FIRMA = `(() => {
  const els = [...document.querySelectorAll('body *')].filter((e) => e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE');
  const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0; };
  return {
    url: location.href, titulo: document.title,
    elementos: els.length, visibles: els.filter(visible).length,
    texto: document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : '',
    estructura: els.map((e) => e.tagName + (e.id ? '#' + e.id : '') + '.' + (typeof e.className === 'string' ? e.className.trim().split(/\\s+/).sort().join('.') : '')).join('|'),
    llamadas: (window.__banco ? window.__banco.llamadas : []).map((x) => x.fn + (x.sub ? ':' + x.sub : '')).sort().join(','),
    globales: Object.keys(window).length
  };
})()`;

// ── Chrome por CDP ─────────────────────────────────────────────────────────────────────────
const perfil = path.join(DIR_OUT, 'perfil-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + perfil, '--remote-debugging-port=' + PUERTO_CDP, '--force-prefers-reduced-motion',
  '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { const v = await (await fetch('http://127.0.0.1:' + PUERTO_CDP + '/json/version')).json(); ws = new WebSocket(v.webSocketDebuggerUrl); } catch (e) {}
}
if (!ws) throw new Error('Chrome no abrió el puerto de depuración');
await new Promise((r, x) => { ws.onopen = r; ws.onerror = x; });
let sig = 1; const pendientes = new Map(), oyentes = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendientes.has(m.id)) { const p = pendientes.get(m.id); pendientes.delete(m.id); m.error ? p.x(new Error(m.error.message)) : p.r(m.result); return; }
  oyentes.forEach((o) => o(m));
};
const cdp = (method, params = {}, sessionId, tope = 30000) => new Promise((r, x) => {
  const id = sig++; pendientes.set(id, { r, x });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  setTimeout(() => { if (pendientes.has(id)) { pendientes.delete(id); x(new Error('tope de tiempo: ' + method)); } }, tope);
});

// Caché de CDN: se baja una vez y se sirve igual a las dos variantes.
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.tailwindcss\.com)\//;
const cache = new Map(), bloqueadas = new Set();
async function deCdn(url) {
  if (!cache.has(url)) cache.set(url, (async () => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return { status: r.status, tipo: r.headers.get('content-type') || 'application/octet-stream', cuerpo: Buffer.from(await r.arrayBuffer()).toString('base64') };
  })());
  return cache.get(url);
}

async function cargar(clave, conSesion) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const errores = [], avisos = [];
  let cargada = false;
  const oyente = async (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errores.push((d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      avisos.push(m.params.type + ': ' + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ').split('\n')[0].slice(0, 200));
    } else if (m.method === 'Page.loadEventFired') {
      cargada = true;
    } else if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      try {
        if (request.url.startsWith(ORIGEN + '/')) await cdp('Fetch.continueRequest', { requestId }, sessionId);
        else if (request.url.startsWith('https://banco.invalid/')) await cdp('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [] }, sessionId);
        else if (CDN.test(request.url)) {
          const c = await deCdn(request.url);
          await cdp('Fetch.fulfillRequest', { requestId, responseCode: c.status, body: c.cuerpo,
            responseHeaders: [{ name: 'Content-Type', value: c.tipo }, { name: 'Access-Control-Allow-Origin', value: '*' }] }, sessionId);
        } else { bloqueadas.add(request.url.slice(0, 120)); await cdp('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, sessionId); }
      } catch (e) { avisos.push('banco: ' + e.message); }
    }
  };
  oyentes.push(oyente);
  try {
    await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
    await cdp('Page.enable', {}, sessionId);
    await cdp('Runtime.enable', {}, sessionId);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }] }, sessionId);
    await cdp('Storage.clearDataForOrigin', { origin: ORIGEN, storageTypes: 'all' }, sessionId);
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: stub(conSesion) }, sessionId);
    await cdp('Page.navigate', { url: ORIGEN + '/' + clave + '.html' }, sessionId);
    const t0 = Date.now();
    while (!cargada && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, ESPERA_MS));
    const firma = (await cdp('Runtime.evaluate', { expression: FIRMA, returnByValue: true }, sessionId)).result.value;
    const foto = (await cdp('Page.captureScreenshot', { format: 'png' }, sessionId)).data;
    fs.writeFileSync(path.join(DIR_OUT, clave.replace('/', '__') + '.png'), Buffer.from(foto, 'base64'));
    return { cargada, errores, avisos, firma, foto };
  } finally {
    oyentes.splice(oyentes.indexOf(oyente), 1);
    await cdp('Target.closeTarget', { targetId }).catch(() => {});
  }
}

// Diferencia de píxeles entre dos PNG, medida en una pestaña del mismo Chrome.
async function difPixeles(a, b) {
  if (a === b) return 0;
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  try {
    const expr = `(async () => {
      const carga = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
      const [x, y] = await Promise.all([carga(${JSON.stringify(a)}), carga(${JSON.stringify(b)})]);
      if (x.width !== y.width || x.height !== y.height) return -1;
      const px = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
      const p = px(x), q = px(y); let n = 0;
      for (let k = 0; k < p.length; k += 4) if (Math.abs(p[k] - q[k]) + Math.abs(p[k + 1] - q[k + 1]) + Math.abs(p[k + 2] - q[k + 2]) > 24) n++;
      return n;
    })()`;
    return (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId, 60000)).result.value;
  } finally { await cdp('Target.closeTarget', { targetId }).catch(() => {}); }
}

const primeraDif = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i >= a.length && a.length === b.length ? '' : '@' + i + ' «' + a.slice(Math.max(0, i - 40), i + 60) + '» vs «' + b.slice(Math.max(0, i - 40), i + 60) + '»'; };
const informe = [];
try {
  for (const p of PAGINAS) {
    const conSesion = !SIN_SESION.has(p);
    const f = await cargar('fuente/' + p, conSesion);
    const f2 = await cargar('fuente/' + p, conSesion);
    const ruido = await difPixeles(f.foto, f2.foto);
    const b = await cargar('build/' + p, conSesion);
    const px = await difPixeles(f.foto, b.foto);
    const campos = ['titulo', 'elementos', 'visibles', 'texto', 'estructura', 'llamadas', 'globales'];
    const distintos = campos.filter((k) => f.firma[k] !== b.firma[k]);
    const fila = { pagina: p, cargada: f.cargada && b.cargada, erroresF: f.errores.length, erroresB: b.errores.length,
      mismosErrores: JSON.stringify(f.errores) === JSON.stringify(b.errores), avisosF: f.avisos.length, avisosB: b.avisos.length,
      llamadas: f.firma.llamadas.split(',').filter(Boolean).length, elementos: f.firma.elementos, distintos, pixeles: px, ruido };
    informe.push(Object.assign({}, fila, { f: { errores: f.errores, avisos: f.avisos, firma: f.firma }, b: { errores: b.errores, avisos: b.avisos, firma: b.firma } }));
    console.log((distintos.length || px > Math.max(2 * ruido, 50) || !fila.mismosErrores ? '≠ ' : '= ') + p.padEnd(22), 'errores F/B', fila.erroresF + '/' + fila.erroresB,
      '· avisos', fila.avisosF + '/' + fila.avisosB, '· llamadas', fila.llamadas, '· elementos', fila.elementos, '· píxeles distintos', px, '(ruido ' + ruido + ')',
      distintos.length ? '· difieren: ' + distintos.join(',') : '');
    for (const k of distintos) console.log('     ' + k + ': ' + primeraDif(String(f.firma[k]), String(b.firma[k])).slice(0, 300));
    if (!fila.mismosErrores) { console.log('     errores F:', f.errores.slice(0, 5)); console.log('     errores B:', b.errores.slice(0, 5)); }
  }
} finally {
  fs.writeFileSync(path.join(DIR_OUT, 'informe.json'), JSON.stringify({ informe, bloqueadas: [...bloqueadas] }, null, 1));
  try { ws.close(); } catch (e) {}
  chrome.kill();
  servidor.close();
}
console.log('\nPeticiones bloqueadas (fuera de CDN):', [...bloqueadas].slice(0, 10));
