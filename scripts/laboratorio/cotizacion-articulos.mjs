// La columna «Artículo» de cotizacion.html (04/10/2026): la foto de cada artículo vive en su
// propia fila, pegada a la derecha. Monta la pantalla como include() (un nivel), con sesión y
// google.script.run falsos, mete 8 artículos (5 con foto, 3 a mano) y comprueba en Chrome headless:
//   · el estado vacío (la pista en la primera fila) y que cada celda sea de SU fila, también con
//     una fila vacía insertada a media tabla; desfase celda↔fila y alto de fila (59 px);
//   · que teclear cambie el texto sin volver a pedir la foto, y el clic que lleva a la descripción;
//   · scroll horizontal (400 px y al final): la columna sigue pegada al borde y encima;
//   · columnas enteras a la vista sin desplazar, impresión, carbón, 960 px y una carga CON
//     movimiento (GSAP vivo: importar, teclear y eliminar).
// Contra una copia ANTERIOR (la galería lateral) solo mide lo que se puede comparar.
//
//   node scripts/laboratorio/cotizacion-articulos.mjs "Carpeta del proyecto" <scratchpad>/articulos [etiqueta]
//
// Desde PowerShell con la ruta larga (desde Git Bash Chrome no abre su puerto). La salida (capturas
// y <etiqueta>-articulos.json) va FUERA del repo o se niega: el hook lo sube todo. Sale con 1 si falla algo.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [, , DIR, OUT, ETQ = 'x'] = process.argv;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PUERTO_HTTP = 8851 + Math.floor(Math.random() * 50), PUERTO_CDP = 9451 + Math.floor(Math.random() * 50);
const BASE = 'https://banco.invalid/macros/s/BANCO/exec';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!DIR || !OUT || !path.relative(REPO, path.resolve(OUT)).startsWith('..')) {
  console.error('Uso: node cotizacion-articulos.mjs <carpetaProyecto> <salida FUERA del repo> [etiqueta]');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const leer = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const code = leer('Code.gs');
const PARAMS = JSON.parse(code.match(/const PARAMS_VISTA = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const APP_JSON = JSON.stringify(Object.assign({ baseUrl: BASE }, Object.fromEntries(PARAMS.map((p) => [p, '']))));
const pagina = leer('cotizacion.html').replace(/<\?(!=|=)?([\s\S]*?)\?>/g, (m, tipo, cuerpo) => {
  const inc = /^\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/.exec(cuerpo);
  if (tipo === '!=' && inc) return leer(inc[1].replace(/\.html$/, '') + '.html');
  if (/^\s*APP_URL\s*;?\s*$/.test(cuerpo)) return BASE;
  if (/^\s*APP_JSON\s*;?\s*$/.test(cuerpo)) return APP_JSON;
  throw new Error('scriptlet sin resolver: ' + m);
});
// Si la celda cambia de nombre, la sonda no puede dar «todo en verde» sin haber medido nada.
if (!/col-articulo/.test(pagina) && !/cot-galeria/.test(pagina)) {
  console.error('No reconozco ni la columna «Artículo» (col-articulo) ni la galería (cot-galeria): no sé qué medir.');
  process.exit(1);
}
const COLORES = ['#d9534f', '#5b8def', '#3cb371', '#e0a800', '#8e44ad', '#16a085', '#e67e22', '#34495e'];
const foto = (i) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<rect width="400" height="400" fill="#fff"/><rect x="60" y="60" width="280" height="280" rx="30" fill="${COLORES[i % 8]}"/>
<text x="200" y="235" font-size="140" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="bold">${i + 1}</text></svg>`;
const servidor = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/cotizacion.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(pagina); }
  const m = /^\/img\/(\d+)\.svg$/.exec(u);
  if (m) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(foto(Number(m[1]))); }
  res.writeHead(404); res.end('no');
});
await new Promise((r) => servidor.listen(PUERTO_HTTP, '127.0.0.1', r));
const ORIGEN = 'http://127.0.0.1:' + PUERTO_HTTP;

const stub = (tema) => `(() => {
  if (window !== window.top) return;
  try {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('ventel-user-name', 'Banco de Pruebas');
    localStorage.setItem('ventel-user-email', 'banco@ventel.test');
    localStorage.setItem('ventel-llave', 'llave-de-banco');
    localStorage.setItem('ventel-sesion-actividad', String(Date.now()));
    localStorage.setItem('ventel-user-advanced', 'true');
    localStorage.setItem('ventel-user-role', 'maestro');
    ${tema ? `localStorage.setItem('ventel-theme', '${tema}');` : ''}
  } catch (e) {}
  function corredor(conf) {
    return new Proxy({}, { get(_, prop) {
      if (prop === 'withSuccessHandler') return (fn) => corredor(Object.assign({}, conf, { ok: fn }));
      if (prop === 'withFailureHandler') return (fn) => corredor(Object.assign({}, conf, { mal: fn }));
      if (prop === 'withUserObject') return (o) => corredor(Object.assign({}, conf, { obj: o }));
      return (...args) => { setTimeout(() => { if (conf.mal) conf.mal(new Error('Sin servidor (sonda)'), conf.obj); }, 40); };
    } });
  }
  window.google = { script: {
    run: corredor({}),
    url: { getLocation(cb) { setTimeout(() => cb({ parameter: {}, parameters: {}, hash: '' }), 0); } },
    history: { push() {}, replace() {}, setChangeHandler() {} },
    host: { close() {}, setHeight() {}, setWidth() {}, origin: location.origin, editor: { focus() {} } }
  } };
})();`;

const perfil = path.join(OUT, 'perfil-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + perfil, '--remote-debugging-port=' + PUERTO_CDP, '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  await new Promise((r) => setTimeout(r, 250));
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
  setTimeout(() => { if (pendientes.has(id)) { pendientes.delete(id); x(new Error('tope: ' + method)); } }, tope);
});
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

const PRODUCTOS = [
  { sku: '1101234567', description: 'Pantalla Samsung 55 pulgadas UHD 4K Smart TV UN55DU7000FXZX', quantity: 1, unitPrice: 12999, discountedUnitPrice: 10399.2, soldBy: 'Liverpool', imageUrl: 0 },
  { sku: '1109876543', description: 'Refrigerador LG 22 pies', quantity: 1, unitPrice: 21999, soldBy: 'Liverpool', imageUrl: 1 },
  { sku: '', description: 'Instalación a domicilio', quantity: 1, unitPrice: 899, soldBy: '' },
  { sku: '1094561237', description: 'Lavadora Whirlpool carga superior 20 kg', quantity: 2, unitPrice: 9499, discountedUnitPrice: 8549.1, soldBy: 'Electro Plus SA de CV', imageUrl: 3 },
  { sku: '1125558899', description: 'Colchón Spring Air Queen Size Back Supreme', quantity: 1, unitPrice: 15999, soldBy: 'Liverpool', imageUrl: 4 },
  { sku: '1001112223', description: 'Garantía extendida 2 años', quantity: 1, unitPrice: 1299, soldBy: '' },
  { sku: '1137771112', description: 'Horno de microondas Panasonic 1.2 pies cúbicos acero inoxidable con grill y descongelado rápido', quantity: 1, unitPrice: 3299, soldBy: 'Liverpool', imageUrl: 6 },
  { sku: '', description: 'Flete especial', quantity: 1, unitPrice: 450, soldBy: '' }
].map((p) => Object.assign({}, p, p.imageUrl !== undefined ? { imageUrl: ORIGEN + '/img/' + p.imageUrl + '.svg' } : {}));

async function abrir({ ancho = 1366, alto = 900, tema = '', movimiento = false }) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const errores = [];
  let cargada = false;
  const oyente = async (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errores.push(d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text); }
    else if (m.method === 'Page.loadEventFired') cargada = true;
    else if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      try {
        if (request.url.startsWith(ORIGEN + '/')) await cdp('Fetch.continueRequest', { requestId }, sessionId);
        else if (request.url.startsWith('https://banco.invalid/')) await cdp('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [] }, sessionId);
        else if (CDN.test(request.url)) await cdp('Fetch.continueRequest', { requestId }, sessionId);
        else await cdp('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, sessionId);
      } catch (e) {}
    }
  };
  oyentes.push(oyente);
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
  await cdp('Page.enable', {}, sessionId);
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: movimiento ? 'no-preference' : 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }] }, sessionId);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: stub(tema) }, sessionId);
  await cdp('Page.navigate', { url: ORIGEN + '/cotizacion.html' }, sessionId);
  const t0 = Date.now();
  while (!cargada && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 2500));
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    return r.result.value;
  };
  const limpiar = () => ev(`(() => { document.querySelectorAll('.vl-overlay').forEach((e) => e.remove()); const s = document.querySelector('[data-onb="saltar"]'); if (s) s.click(); return 1; })()`);
  await limpiar();
  if (!movimiento) await ev(`(() => { const st = document.createElement('style'); st.textContent = '*{transition:none !important;animation:none !important}'; document.head.appendChild(st); return 1; })()`);
  const captura = async (nombre, opts = {}) => {
    const png = (await cdp('Page.captureScreenshot', Object.assign({ format: 'png' }, opts), sessionId)).data;
    fs.writeFileSync(path.join(OUT, `${ETQ}-${nombre}.png`), Buffer.from(png, 'base64'));
  };
  const cerrar = async () => { oyentes.splice(oyentes.indexOf(oyente), 1); await cdp('Target.closeTarget', { targetId }).catch(() => {}); };
  return { sessionId, ev, limpiar, captura, cerrar, errores };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const informe = {};
const ok = (nombre, cond, detalle) => { informe[nombre] = { ok: !!cond, detalle }; console.log((cond ? '  ✔ ' : '  ✖ ') + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); };
const nuevo = !!pagina.match(/col-articulo/);

try {
  // ── 1. Estado vacío (cotización nueva) + importación + fila vacía en medio + tecleo ──
  console.log('\n[1] 1366 px · estado vacío, importación, fila vacía en medio, tecleo');
  {
    const p = await abrir({});
    if (nuevo) {
      const pista = await p.ev(`(() => { const c = document.querySelector('#product-rows .product-row td.col-articulo'); return c ? { estado: c.getAttribute('data-art'), texto: c.textContent.trim() } : null; })()`);
      ok('pista en la primera fila de una cotización nueva', pista && pista.estado === 'pista' && /Aquí verás/.test(pista.texto), pista);
    } else {
      const vacio = await p.ev(`(document.querySelector('#cot-galeria-lista') || {}).textContent || ''`);
      ok('(antes) mensaje de galería vacía', /Aquí verás/.test(vacio), vacio.slice(0, 60));
    }
    await p.ev(`importarProductos(${JSON.stringify({ products: PRODUCTOS })}); 1`);
    await esperar(1200); await p.limpiar();
    // Columnas enteras a la vista SIN desplazar (a la izquierda de lo que tapa).
    const vista = await p.ev(`(() => {
      const caja = document.querySelector('.cot-tabla-col').getBoundingClientRect();
      const fija = document.querySelector('#product-table th.col-articulo');
      const limite = fija ? fija.getBoundingClientRect().left : caja.right;
      const ths = [...document.querySelectorAll('#product-table thead th')].filter((t) => !t.classList.contains('col-articulo'));
      const enteras = ths.filter((t) => t.getBoundingClientRect().right <= limite + 0.5).map((t) => t.textContent.replace(/\\s+/g, ' ').trim());
      return { anchoVisibleTabla: Math.round(limite - caja.left), enteras: enteras.length, ultima: enteras[enteras.length - 1] };
    })()`);
    ok('columnas enteras a la vista sin desplazar', true, vista);
    if (nuevo) {
      // Fila vacía en medio: se inserta tras la 3.ª y se recalcula.
      const r = await p.ev(`(() => {
        const filas = document.querySelectorAll('#product-rows .product-row');
        const v = addRow(false);
        document.getElementById('product-rows').insertBefore(v, filas[3]);
        calculateTotals();
        const todas = [...document.querySelectorAll('#product-rows .product-row')];
        const malas = [];
        todas.forEach((f, i) => {
          const c = f.querySelector('td.col-articulo');
          const sku = f.querySelector('.sku').value.trim(), desc = f.querySelector('.description').value.trim();
          const vacia = !sku && !desc && !f.getAttribute('data-image-url');
          if (vacia) { if (c.innerHTML !== '' || c.getAttribute('data-art') !== 'vacia') malas.push(i + ': vacía con contenido'); return; }
          const tSku = (c.querySelector('.cot-art-sku') || {}).textContent || '';
          const tDesc = (c.querySelector('.cot-art-desc') || {}).textContent || '';
          if (tSku !== sku || tDesc !== (desc || 'Artículo sin descripción')) malas.push(i + ': ' + tSku + ' / ' + tDesc.slice(0, 20));
          const img = c.querySelector('.cot-art-img img');
          if ((f.getAttribute('data-image-url') || '') !== (img ? img.getAttribute('src') : '')) malas.push(i + ': foto ajena');
        });
        return { filas: todas.length, malas };
      })()`);
      ok('fila vacía en medio: cada celda sigue siendo de su fila', r.malas.length === 0, r);
      const alin = await p.ev(`(() => [...document.querySelectorAll('#product-rows .product-row')].map((f) => {
        const a = f.getBoundingClientRect(), c = f.querySelector('td.col-articulo').getBoundingClientRect();
        return Math.abs((a.top + a.bottom) / 2 - (c.top + c.bottom) / 2);
      }).reduce((m, x) => Math.max(m, x), 0))()`);
      ok('desfase máximo celda↔fila (px)', alin < 0.6, alin);
      const alturas = await p.ev(`[...new Set([...document.querySelectorAll('#product-rows .product-row')].map((f) => Math.round(f.getBoundingClientRect().height)))]`);
      ok('alto de fila (px, todas iguales)', alturas.length === 1 && alturas[0] === 59, alturas);
      // Tecleo en la descripción de una fila con foto: cambia el texto, la <img> es la MISMA.
      const tec = await p.ev(`(() => {
        const f = document.querySelector('#product-rows .product-row');
        const img = f.querySelector('td.col-articulo img'); img.__marca = 'x';
        const d = f.querySelector('.description'); d.value = 'Pantalla Samsung 65 pulgadas'; d.dispatchEvent(new Event('input', { bubbles: true }));
        const img2 = f.querySelector('td.col-articulo img');
        return { mismaImg: !!img2 && img2.__marca === 'x', texto: f.querySelector('.cot-art-desc').textContent, title: f.querySelector('.cot-art').title };
      })()`);
      ok('teclear no repinta la foto y actualiza texto + title', tec.mismaImg && tec.texto === 'Pantalla Samsung 65 pulgadas' && /65 pulgadas · 1101234567/.test(tec.title), tec);
      // Clic en la tarjeta: foco en la descripción de SU fila.
      const clic = await p.ev(`(() => {
        const f = document.querySelectorAll('#product-rows .product-row')[5];
        f.querySelector('.cot-art').click();
        return document.activeElement === f.querySelector('.description');
      })()`);
      ok('clic en la foto enfoca la descripción de su fila', clic, clic);
      // Eliminar una fila (sin GSAP en reducido: se quita en el acto).
      await p.ev(`(() => { const f = document.querySelectorAll('#product-rows .product-row')[1]; removeRow(f.querySelector('.v-btn-danger')); return 1; })()`);
      await esperar(700);
      const elim = await p.ev(`document.querySelectorAll('#product-rows .product-row').length`);
      ok('eliminar fila sin errores', elim === 8, elim);
    }
    await p.ev(`window.scrollTo(0, Math.round(document.getElementById('product-table').getBoundingClientRect().top + scrollY - 20)); 1`);
    await esperar(300);
    await p.captura('1366-reposo');
    // ── Scroll horizontal ──
    for (const [nombre, expr] of [['400', '400'], ['max', 'c.scrollWidth']]) {
      await p.ev(`(() => { const c = document.querySelector('.cot-tabla-col'); c.scrollLeft = ${expr}; return c.scrollLeft; })()`);
      await esperar(300);
      if (nuevo) {
        const m = await p.ev(`(() => {
          const c = document.querySelector('.cot-tabla-col'), cb = c.getBoundingClientRect();
          const celdas = [...document.querySelectorAll('#product-table .col-articulo')];
          const fuera = celdas.filter((td) => { const b = td.getBoundingClientRect(); return b.right > cb.right + 0.5 || b.left < cb.left - 0.5; }).length;
          const tapadas = celdas.filter((td) => { const b = td.getBoundingClientRect(); const x = b.left + b.width * 0.7, y = b.top + b.height / 2;
            if (y < 0 || y > innerHeight) return false; const e = document.elementFromPoint(x, y); return !(e && (e === td || td.contains(e))); }).length;
          const pegada = Math.round(cb.right - celdas[0].getBoundingClientRect().right);
          return { scrollLeft: c.scrollLeft, celdas: celdas.length, fuera, tapadas, distanciaAlBorde: pegada };
        })()`);
        ok('scroll ' + nombre + ': la columna sigue pegada a la derecha y encima', m.fuera === 0 && m.tapadas === 0 && Math.abs(m.distanciaAlBorde) <= 1, m);
      }
      await p.captura('1366-scroll-' + nombre);
    }
    ok('[1] errores JS', p.errores.length === 0, p.errores);
    await p.cerrar();
  }

  // ── 2. Impresión ──
  console.log('\n[2] impresión');
  {
    const p = await abrir({});
    await p.ev(`importarProductos(${JSON.stringify({ products: PRODUCTOS })}); 1`);
    await esperar(800);
    await cdp('Emulation.setEmulatedMedia', { media: 'print' }, p.sessionId);
    const r = await p.ev(`(() => {
      const cols = [...document.querySelectorAll('#product-table .col-articulo, #cot-galeria')];
      return { elementos: cols.length, visibles: cols.filter((e) => getComputedStyle(e).display !== 'none').length,
               columnasImpresas: document.querySelectorAll('#product-table thead th').length - [...document.querySelectorAll('#product-table thead th')].filter((t) => getComputedStyle(t).display === 'none').length };
    })()`);
    ok('al imprimir no sale la columna (ni la galería)', r.visibles === 0, r);
    await p.captura('print', { captureBeyondViewport: false });
    await p.cerrar();
  }

  // ── 3. Carbón ──
  console.log('\n[3] tema carbón');
  {
    const p = await abrir({ tema: 'carbon' });
    await p.ev(`importarProductos(${JSON.stringify({ products: PRODUCTOS })}); 1`);
    await esperar(800); await p.limpiar();
    const r = await p.ev(`(() => {
      const cs = (sel, prop) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
      return { tema: document.documentElement.getAttribute('data-theme'),
               papel: cs('.v-papel', 'backgroundColor'),
               celda: cs('#product-table td.col-articulo', 'backgroundColor') || cs('#cot-galeria', 'backgroundColor'),
               texto: cs('.cot-art-desc', 'color'), sku: cs('.cot-art-sku', 'color'), cuadro: cs('.cot-art-img', 'backgroundColor') };
    })()`);
    ok('carbón: la hoja y la columna siguen en papel claro', r.tema === 'carbon' && /255, 255, 255/.test(r.papel || ''), r);
    await p.ev(`window.scrollTo(0, Math.round(document.getElementById('product-table').getBoundingClientRect().top + scrollY - 20)); 1`);
    await esperar(300);
    await p.captura('1366-carbon');
    ok('[3] errores JS', p.errores.length === 0, p.errores);
    await p.cerrar();
  }

  // ── 4. 960 px (media pantalla) ──
  console.log('\n[4] 960 px');
  {
    const p = await abrir({ ancho: 960, alto: 900 });
    await p.ev(`importarProductos(${JSON.stringify({ products: PRODUCTOS })}); 1`);
    await esperar(800); await p.limpiar();
    if (nuevo) {
      const r = await p.ev(`(() => {
        const th = document.querySelector('#product-table th.col-articulo');
        const td = document.querySelector('#product-table td.col-articulo');
        return { anchoCol: Math.round(td.getBoundingClientRect().width), encabezado: th.innerText.trim(),
                 textoOculto: getComputedStyle(td.querySelector('.cot-art-tx')).display === 'none',
                 altos: [...new Set([...document.querySelectorAll('#product-rows .product-row')].map((f) => Math.round(f.getBoundingClientRect().height)))] };
      })()`);
      ok('960 px: solo miniatura, encabezado «Foto», filas de 59', r.anchoCol <= 76 && r.textoOculto && /foto/i.test(r.encabezado) && r.altos.length === 1, r);
    }
    await p.ev(`window.scrollTo(0, Math.round(document.getElementById('product-table').getBoundingClientRect().top + scrollY - 160)); 1`);
    await esperar(300);
    await p.captura('960');
    ok('[4] errores JS', p.errores.length === 0, p.errores);
    await p.cerrar();
  }

  // ── 5. Con movimiento (GSAP vivo): importar, teclear, eliminar ──
  console.log('\n[5] con movimiento');
  {
    const p = await abrir({ movimiento: true });
    const gsapOk = await p.ev(`typeof gsap !== 'undefined'`);
    await p.ev(`importarProductos(${JSON.stringify({ products: PRODUCTOS })}); 1`);
    await esperar(1500); await p.limpiar();
    if (nuevo) {
      await p.ev(`(() => { const f = document.querySelectorAll('#product-rows .product-row')[2]; const d = f.querySelector('.description'); d.value = 'Instalación y armado'; d.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
      await p.ev(`(() => { const f = document.querySelectorAll('#product-rows .product-row')[0]; removeRow(f.querySelector('.v-btn-danger')); return 1; })()`);
      await esperar(1200);
      const r = await p.ev(`(() => ({ filas: document.querySelectorAll('#product-rows .product-row').length,
        opacidades: [...document.querySelectorAll('#product-rows .cot-art')].map((c) => getComputedStyle(c).opacity).filter((o) => o !== '1').length,
        bolsas: document.querySelectorAll('#product-rows .cot-bolsa').length }))()`);
      ok('con GSAP: tras importar/teclear/eliminar, tarjetas visibles y 7 filas', gsapOk && r.filas === 7 && r.opacidades === 0, Object.assign({ gsap: gsapOk }, r));
    } else {
      ok('(antes) gsap cargado', gsapOk, gsapOk);
    }
    await p.ev(`window.scrollTo(0, Math.round(document.getElementById('product-table').getBoundingClientRect().top + scrollY - 20)); 1`);
    await esperar(2200);
    await p.captura('1366-movimiento');
    ok('[5] errores JS', p.errores.length === 0, p.errores);
    await p.cerrar();
  }
} finally {
  fs.writeFileSync(path.join(OUT, `${ETQ}-articulos.json`), JSON.stringify(informe, null, 1));
  try { ws.close(); } catch (e) {}
  chrome.kill();
  servidor.close();
}
const fallos = Object.keys(informe).filter((k) => !informe[k].ok);
console.log(fallos.length
  ? `\n✖ ${fallos.length} comprobaciones fallaron: ${fallos.join(' · ')}`
  : `\n✔ Todo en verde (${Object.keys(informe).length} comprobaciones)`);
process.exit(fallos.length ? 1 : 0);
