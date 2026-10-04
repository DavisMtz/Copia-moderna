// Auditoría del tema oscuro (carbón) del Portal Ventel, pantalla por pantalla, en Chrome headless (04/10/2026).
//   node scripts/laboratorio/oscuro.mjs "Carpeta del proyecto" <salida FUERA del repo> [vista…]
//   vistas: las 20 páginas de Code.gs y las secciones del Portal como «Index~herramientas»…
// Variables:
//   TEMA          carbon (por omisión), aurora o slate.
//   ANCHO / ALTO  ventana (1440×900). ALTO_FOTO limita la altura de la captura (por omisión, la página entera).
//   FOTOS=0       sin capturas. ESPERA: ms tras cargar (2600).
//   MOCKS         .js con window.__responder(fn, args) → respuesta del servidor (lo arma oscuro-datos.mjs).
//   DATOS_PAGINA  JSON { "<página>": { "<función>": respuesta } } que va en __APP__.datos (F3a, p. ej. el Monitor).
//   VISTAS_EXTRA  JSON [{ "nombre": "…", "url": "pagina?folio=…" }].
//   ANTES         expresión que se evalúa antes de medir y fotografiar (abrir un modal, la paleta…); ESPERA_ANTES (700).
//   EVAL          expresión cuyo resultado se imprime. NO_SALTAR=1 deja abierto el recorrido de bienvenida.
// Cada pantalla se ensambla como include() (un nivel), con sesión falsa de rol maestro y un google.script.run
// que contesta lo que diga MOCKS y falla en lo demás (el Portal va sin google: pinta sus datos de muestra).
// La sonda mide el contraste de cada texto visible contra su fondo REAL (compuesto con los ancestros y sus
// degradados), las superficies claras grandes y los bordes claros; todo va a <salida>/informe.json.
// Lo que falla SOLO en oscuro sale comparando dos corridas (TEMA=aurora y carbon) con oscuro-diff.mjs.
// Lanzarlo desde PowerShell con la ruta LARGA y sin sandbox (desde Git Bash Chrome no abrió el puerto).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [, , FUENTE, SALIDA, ...SOLO] = process.argv;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!SALIDA || !path.relative(REPO, path.resolve(SALIDA)).startsWith('..')) {
  console.error('La salida tiene que ir FUERA del repo (el hook subiría las capturas): ' + SALIDA);
  process.exit(1);
}
const TEMA = process.env.TEMA || 'carbon';
const ANCHO = Number(process.env.ANCHO || 1440);
const ALTO = Number(process.env.ALTO || 900);
const FOTOS = process.env.FOTOS !== '0';
const ESPERA = Number(process.env.ESPERA || 2600);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'https://banco.invalid/macros/s/BANCO/exec';
fs.mkdirSync(SALIDA, { recursive: true });

const leer = (f) => fs.readFileSync(path.join(FUENTE, f), 'utf8').replace(/\r\n/g, '\n');
const code = leer('Code.gs');
const PARAMS = JSON.parse(code.match(/const PARAMS_VISTA = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const PAGINAS = [...new Set([...code.matchAll(/\bfile:\s*'([^']+)'/g)].map((m) => m[1]))];
// MOCKS: un .js que define window.__responder(fn, args) (lo genera oscuro-datos.mjs).
// DATOS_PAGINA: JSON { "<página>": { "<función>": respuesta } } que va en __APP__.datos (F3a).
const MOCKS = process.env.MOCKS ? fs.readFileSync(process.env.MOCKS, 'utf8') : '';
const DATOS_PAGINA = process.env.DATOS_PAGINA ? JSON.parse(fs.readFileSync(process.env.DATOS_PAGINA, 'utf8')) : {};
const cache = {};
function ensamblar(pagina, query) {
  const app = Object.assign({ baseUrl: BASE, reco: true }, Object.fromEntries(PARAMS.map((p) => [p, query.get(p) || ''])));
  if (DATOS_PAGINA[pagina]) { app.datos = DATOS_PAGINA[pagina]; app.datosAt = Date.now(); app.datosMs = 50; }
  const crudo = cache[pagina] || (cache[pagina] = leer(pagina + '.html'));
  return crudo.replace(/<\?(!=|=)?([\s\S]*?)\?>/g, (m, tipo, cuerpo) => {
    const inc = /^\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/.exec(cuerpo);
    if (tipo === '!=' && inc) { const f = inc[1].replace(/\.html$/, '') + '.html'; return cache[f] || (cache[f] = leer(f)); }
    if (/^\s*APP_URL\s*;?\s*$/.test(cuerpo)) return BASE;
    if (/^\s*APP_JSON\s*;?\s*$/.test(cuerpo)) return JSON.stringify(app);
    throw new Error(pagina + ': scriptlet sin resolver: ' + m);
  });
}

// Vistas: las 20 pantallas y las secciones del Portal.
const SECCIONES = ['herramientas', 'paqueterias', 'formaspago', 'pdepago', 'formatos', 'presentaciones', 'plantillas',
  'bigticket', 'softline', 'slmensajerias', 'mkp', 'tienda', 'generales', 'devsap'];
// VISTAS_EXTRA: JSON [{ "nombre": "…", "url": "pagina?param=…" }] (p. ej. Revisión con folio).
const VISTAS = [
  ...PAGINAS.map((p) => ({ nombre: p, url: p })),
  ...SECCIONES.map((s) => ({ nombre: 'Index~' + s, url: 'Index?sec=' + s })),
  ...(process.env.VISTAS_EXTRA ? JSON.parse(process.env.VISTAS_EXTRA) : []),
].filter((v) => !SOLO.length || SOLO.includes(v.nombre) || SOLO.includes(v.nombre.split('~')[0]));

const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const clave = decodeURIComponent(u.pathname.replace(/^\//, '').replace(/\.html$/, ''));
  if (!PAGINAS.includes(clave)) { res.writeHead(404); return res.end('no'); }
  let html;
  try { html = ensamblar(clave, u.searchParams); } catch (e) { res.writeHead(500); return res.end(String(e)); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});
const PUERTO_HTTP = 8790 + Math.floor(Math.random() * 100);
await new Promise((r) => servidor.listen(PUERTO_HTTP, '127.0.0.1', r));

// Lo que se inyecta antes que nada. El Portal (Index) va SIN google: así entra en su vista de diseño.
const stub = (conGoogle) => `(() => {
  if (window !== window.top) return;
  try {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('ventel-theme', ${JSON.stringify(TEMA)});
    localStorage.setItem('ventel-user-name', 'Banco de Pruebas'); localStorage.setItem('ventel-user-email', 'banco@ventel.test');
    localStorage.setItem('ventel-llave', 'llave-de-banco'); localStorage.setItem('ventel-sesion-actividad', String(Date.now()));
    localStorage.setItem('ventel-user-advanced', 'true'); localStorage.setItem('ventel-user-role', 'maestro');
    localStorage.setItem('ventel-coach-done', 'true');
  } catch (e) {}
  window.__llamadas = [];
  ${MOCKS}
  if (!${conGoogle}) return;
  function corredor(conf) {
    return new Proxy({}, { get(_, prop) {
      if (prop === 'withSuccessHandler') return (fn) => corredor(Object.assign({}, conf, { ok: fn }));
      if (prop === 'withFailureHandler') return (fn) => corredor(Object.assign({}, conf, { mal: fn }));
      if (prop === 'withUserObject') return (o) => corredor(Object.assign({}, conf, { obj: o }));
      return (...args) => {
        if (String(prop) === 'secEjecutarLote' && Array.isArray(args[1])) {
          const rs = args[1].map((it) => {
            const f = String(it && it[0]); window.__llamadas.push(f);
            const r = window.__responder && window.__responder(f, it[1]);
            return r !== undefined ? { v: r, ms: 5 } : { e: 'Sin servidor (banco)' };
          });
          setTimeout(() => conf.ok && conf.ok(rs, conf.obj), 60);
          return;
        }
        const fn = String(prop) === 'secEjecutar' ? String(args[1]) : String(prop);
        window.__llamadas.push(fn);
        const r = window.__responder && window.__responder(fn, String(prop) === 'secEjecutar' ? args[2] : args);
        if (r !== undefined) { setTimeout(() => conf.ok && conf.ok(r, conf.obj), 60); return; }
        setTimeout(() => { if (conf.mal) conf.mal(new Error('Sin servidor (banco)'), conf.obj); }, 40);
      };
    } });
  }
  const parametros = () => Object.fromEntries(new URLSearchParams(location.search));
  window.google = { script: { run: corredor({}),
    url: { getLocation(cb) { setTimeout(() => cb({ parameter: parametros(), parameters: {}, hash: '' }), 0); } },
    history: { push() {}, replace() {}, setChangeHandler() {} },
    host: { close() {}, setHeight() {}, setWidth() {}, origin: location.origin, editor: { focus() {} } } } };
})();`;

// ── Sonda (corre dentro de la página) ─────────────────────────────────────────────────────
function sonda() {
  const parse = (s) => {
    if (!s) return null;
    let m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = s.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : Number(m[4])];
    return null;
  };
  const over = (t, b) => { const a = t[3] + b[3] * (1 - t[3]); if (a <= 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (t[i] * t[3] + b[i] * b[3] * (1 - t[3])) / a).concat([a]); };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('') + (c[3] < 0.999 ? '/' + c[3].toFixed(2) : '');
  const firma = (el) => {
    const partes = [];
    for (let e = el, n = 0; e && e.nodeType === 1 && n < 4; e = e.parentElement, n++) {
      let s = e.tagName.toLowerCase();
      if (e.id) { s += '#' + e.id; partes.unshift(s); break; }
      const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter((c) => c && !/^(is-|gsap|active$|show$|open$)/.test(c)).slice(0, 3) : [];
      if (cls.length) s += '.' + cls.join('.');
      partes.unshift(s);
    }
    return partes.join(' > ');
  };
  // Capas de fondo desde el elemento hacia arriba; los degradados abren varias candidatas.
  const fondos = (el) => {
    const capas = [];
    let incierto = '';
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const bi = cs.backgroundImage;
      if (bi && bi !== 'none') {
        if (/url\(/.test(bi)) incierto = incierto || 'imagen';
        const stops = (bi.match(/rgba?\([^)]+\)|color\(srgb[^)]+\)/g) || []).map(parse).filter(Boolean);
        if (stops.length) capas.push({ tipo: 'grad', stops: stops.slice(0, 6) });
      }
      const bc = parse(cs.backgroundColor);
      if (bc && bc[3] > 0) { capas.push({ tipo: 'color', c: bc }); if (bc[3] >= 0.99) break; }
    }
    let cands = [[255, 255, 255, 1]];
    for (let i = capas.length - 1; i >= 0; i--) {
      const k = capas[i];
      if (k.tipo === 'color') cands = cands.map((b) => over(k.c, b));
      else { const n = []; for (const b of cands) for (const s of k.stops) n.push(over(s, b)); cands = n.slice(0, 24); }
    }
    return { cands, incierto };
  };
  const opacidad = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const visible = (el) => {
    if (!el.checkVisibility || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width * r.height >= 4;
  };
  const textos = [], vistos = new Set();
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || vistos.has(el)) continue;
    vistos.add(el);
    if (el.closest('script,style,noscript,template,svg,option,datalist')) continue;
    if (!visible(el)) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    const rr = rg.getBoundingClientRect();
    if (rr.width * rr.height < 4) continue;
    const cs = getComputedStyle(el);
    if (cs.color === 'transparent' || cs.webkitTextFillColor === 'transparent' || /text/.test(cs.backgroundClip || cs.webkitBackgroundClip || '')) continue;
    const op = opacidad(el);
    if (op < 0.15) continue;
    let fg = parse(cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color);
    if (!fg) continue;
    fg = fg.slice(0, 3).concat([fg[3] * op]);
    const { cands, incierto } = fondos(el);
    let peor = 99, peorBg = null;
    for (const b of cands) { const r = ratio(over(fg, b), b); if (r < peor) { peor = r; peorBg = b; } }
    const fs = parseFloat(cs.fontSize), fw = Number(cs.fontWeight) || 400;
    const grande = fs >= 24 || (fs >= 18.66 && fw >= 700);
    const minimo = grande ? 3 : 4.5;
    if (peor < minimo) textos.push({ r: Math.round(peor * 100) / 100, min: minimo, fg: hex(fg), bg: hex(peorBg), fs: Math.round(fs), sel: firma(el), txt: n.nodeValue.trim().replace(/\s+/g, ' ').slice(0, 50), inc: incierto || undefined, y: Math.round(rr.top + scrollY) });
  }
  // Controles de formulario (su texto no es un nodo de texto).
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]),select,textarea')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); if (!fg) continue;
    const { cands } = fondos(el);
    let peor = 99, peorBg = null;
    for (const b of cands) { const r = ratio(over(fg, b), b); if (r < peor) { peor = r; peorBg = b; } }
    const bgPropio = parse(cs.backgroundColor);
    if (peor < 4.5 || (bgPropio && bgPropio[3] > 0.5 && L(bgPropio) > 0.6)) textos.push({ r: Math.round(peor * 100) / 100, min: 4.5, fg: hex(fg), bg: hex(peorBg), fs: Math.round(parseFloat(cs.fontSize)), sel: firma(el) + ' [control]', txt: (el.value || el.placeholder || '').slice(0, 40), y: Math.round(el.getBoundingClientRect().top + scrollY) });
  }
  // Superficies claras grandes y bordes claros.
  const claras = [], bordes = new Map();
  for (const el of document.body.querySelectorAll('*')) {
    if (/^(IMG|SVG|CANVAS|VIDEO|IFRAME|PICTURE|svg|path|use|g|circle|rect|line|polyline|polygon|ellipse|text|tspan|defs|symbol|lineargradient|stop)$/i.test(el.tagName)) continue;
    if (el.closest('svg')) continue;
    const cs = getComputedStyle(el);
    const bc = parse(cs.backgroundColor);
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (bc && bc[3] >= 0.5 && L(bc) > 0.55 && area >= 1200 && visible(el) && opacidad(el) > 0.3) {
      claras.push({ sel: firma(el), bg: hex(bc), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top + scrollY) });
    }
    const bi = cs.backgroundImage;
    if (bi && bi !== 'none' && !/url\(/.test(bi) && area >= 1200) {
      const stops = (bi.match(/rgba?\([^)]+\)|color\(srgb[^)]+\)/g) || []).map(parse).filter(Boolean);
      if (stops.some((s) => s[3] >= 0.6 && L(s) > 0.55) && visible(el) && opacidad(el) > 0.3) claras.push({ sel: firma(el) + ' [degradado]', bg: stops.map(hex).join(' → ').slice(0, 80), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top + scrollY) });
    }
    for (const lado of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(cs['border' + lado + 'Width']) >= 1 && cs['border' + lado + 'Style'] !== 'none') {
        const c = parse(cs['border' + lado + 'Color']);
        if (c && c[3] >= 0.5 && L(c) > 0.45 && visible(el)) {
          const k = firma(el) + ' ' + hex(c);
          bordes.set(k, (bordes.get(k) || 0) + 1);
          break;
        }
      }
    }
  }
  // Agrupar textos repetidos (misma firma y mismos colores).
  const grupos = new Map();
  for (const t of textos) {
    const k = t.sel.replace(/:nth-child\(\d+\)/g, '') + '|' + t.fg + '|' + t.bg;
    const g = grupos.get(k);
    if (g) g.n++; else grupos.set(k, Object.assign({ n: 1 }, t));
  }
  const de = document.documentElement;
  return {
    tema: de.getAttribute('data-theme'), titulo: document.title,
    alto: Math.round(de.scrollHeight), anchoDesborda: de.scrollWidth > de.clientWidth,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    textos: [...grupos.values()].sort((a, b) => a.r - b.r),
    claras: claras.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 60),
    bordes: [...bordes.entries()].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 40),
    llamadas: (window.__llamadas || []).slice(0, 60)
  };
}

// ── Chrome por CDP ─────────────────────────────────────────────────────────────────────────
const perfil = fs.mkdtempSync(path.join(SALIDA, 'perfil-'));
const puerto = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + perfil, '--remote-debugging-port=' + puerto, '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try { const l = await (await fetch('http://127.0.0.1:' + puerto + '/json/list')).json(); const p = l.find((x) => x.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch (e) {}
}
if (!wsUrl) throw new Error('Chrome no abrió el puerto de depuración');
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let n = 0; const pend = new Map(); const eventos = []; const errores = [];
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
  if (d.method === 'Runtime.exceptionThrown') errores.push(((d.params.exceptionDetails.exception || {}).description || d.params.exceptionDetails.text || '').slice(0, 240));
  if (d.method) eventos.push(d);
});
const cdp = (method, params = {}, tope = 60000) => new Promise((ok, mal) => {
  const id = ++n; const t = setTimeout(() => { pend.delete(id); mal(new Error('tope ' + method)); }, tope);
  pend.set(id, (d) => { clearTimeout(t); d.error ? mal(new Error(method + ': ' + d.error.message)) : ok(d.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalua = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

let inyeccion = null;
async function abrir(v) {
  if (inyeccion) await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: inyeccion });
  inyeccion = (await cdp('Page.addScriptToEvaluateOnNewDocument', { source: stub(!v.url.startsWith('Index')) })).identifier;
  await cdp('Emulation.setDeviceMetricsOverride', { width: ANCHO, height: ALTO, deviceScaleFactor: 1, mobile: false });
  eventos.length = 0; errores.length = 0;
  await cdp('Page.navigate', { url: 'http://127.0.0.1:' + PUERTO_HTTP + '/' + v.url });
  for (let i = 0; i < 120; i++) { if (eventos.some((e) => e.method === 'Page.loadEventFired')) break; await espera(100); }
  await espera(ESPERA);
  // NO_SALTAR=1 deja el recorrido de bienvenida abierto (para fotografiarlo).
  for (let k = 0; k < 2 && process.env.NO_SALTAR !== '1'; k++) {
    await evalua(`(() => { document.querySelectorAll('[data-onb="saltar"]').forEach((s) => s.click()); if (window.dismissCoach) try { dismissCoach(); } catch (e) {} return 1; })()`).catch(() => {});
    await espera(400);
  }
  // Fotos y medidas en el estado final, sin transiciones a medias.
  // Las animaciones CSS se TERMINAN (no se pausan): pausada, una entrada como el svFadeIn de las
  // pestañas de Supervisión se quedaba en su fotograma 0, con el panel transparente.
  await evalua(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none !important;animation-duration:.001s !important;animation-delay:0s !important;animation-iteration-count:1 !important}'; document.head.appendChild(s); return 1; })()`).catch(() => {});
  await espera(150);
}
async function foto(nombre, alto) {
  const h = Math.min(alto || ALTO, Number(process.env.ALTO_FOTO || 9000));
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: ANCHO, height: h, scale: 1 } });
  fs.writeFileSync(path.join(SALIDA, nombre), Buffer.from(r.data, 'base64'));
}

const informe = {};
// ANTES: expresión que se evalúa antes de la sonda y de la foto (abrir un modal, la paleta…).
// EVAL: expresión cuyo resultado se imprime (para preguntarle cosas a la página).
const ANTES = process.env.ANTES || '';
const EVAL = process.env.EVAL || '';
for (const v of VISTAS) {
  try {
    await abrir(v);
    if (ANTES) { try { await evalua(ANTES); } catch (e) { console.log('ANTES falló', String(e.message).slice(0, 200)); } await espera(Number(process.env.ESPERA_ANTES || 700)); }
    if (EVAL) { try { console.log(v.nombre, 'EVAL', JSON.stringify(await evalua(EVAL)).slice(0, 3000)); } catch (e) { console.log('EVAL falló', String(e.message).slice(0, 300)); } }
    const res = await evalua('(' + sonda.toString() + ')()');
    res.errores = errores.slice(0, 8);
    informe[v.nombre] = res;
    if (FOTOS) await foto(v.nombre.replace('~', '__') + '.png', res.alto);
    const graves = res.textos.filter((t) => t.r < 3).length;
    console.log(v.nombre.padEnd(26), 'tema', res.tema, '| textos bajos', String(res.textos.length).padStart(3), '(graves', String(graves).padStart(3) + ')',
      '| claras', String(res.claras.length).padStart(3), '| bordes', String(res.bordes.length).padStart(3), res.errores.length ? '| ERR ' + res.errores[0].slice(0, 90) : '');
  } catch (e) {
    console.log(v.nombre.padEnd(26), 'FALLÓ', String(e.message).slice(0, 200));
    informe[v.nombre] = { fallo: String(e.message) };
  }
}
fs.writeFileSync(path.join(SALIDA, 'informe.json'), JSON.stringify(informe, null, 1));
ws.close(); chrome.kill(); servidor.close();
try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) {}
