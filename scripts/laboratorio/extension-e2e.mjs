// La extensión de Chrome REAL (su mundo aislado y todos sus content scripts) en un Chrome headless aparte,
// sobre páginas REALES de liverpool.com.mx guardadas en disco. Es la prueba de punta a punta de
// «Vende más» (extensión 3.0, 04/10/2026).
//
// Por qué así:
//   · Liverpool contesta «Access Denied» a Chrome headless: las páginas se bajan aparte (abajo) y se
//     sirven en su URL real por intercepción de red (Fetch). Nada sale a internet durante la prueba.
//   · Los .js de la página reciben 404: React no hidrata y queda el HTML del servidor con su stream,
//     que es lo que leen el inspector y la tarjeta.
//   · La bolsa (/tienda/cart) se arma aquí con el formato real y la hora de AHORA, con un cliente y
//     una dirección falsos: sirve para comprobar que la extensión NO los guarda.
//
// Uso (desde PowerShell, con rutas largas):
//   node scripts/laboratorio/extension-e2e.mjs "Extencion para chrome" <salida> <páginas>
//   · <salida> y <páginas> van FUERA del repo (el scratchpad): capturas, informe.json y páginas de Liverpool.
//   · CHROME=<ruta a chrome.exe> si no está en Archivos de programa.
// Sale con código 1 si alguna comprobación falla. Tarda unos 3 minutos (respeta el ritmo de la bolsa).
//
// Las páginas (invitado, sin sesión; una por una y con pausa):
//   curl -sS -L --compressed -A "<agente de un Chrome de escritorio>" -H "Accept-Language: es-MX" -o <archivo> <url>
//   pdp_iphone16.html   /tienda/pdp/iphone-16-6-1-pulgadas-super-retina-xdr/1163567866
//   pdp_adaptador.html  /tienda/pdp/adaptador-de-corriente/1168416900
//   pdp_funda.html      /tienda/pdp/funda-para-iphone-16-de-tpu/999673023163
//   pdp_freidora.html   /tienda/pdp/x/1188152119
//   pdp_espresso.html   /tienda/pdp/cafetera-espresso-rj54-ss-15-d-mx/1163997114
//   pdp_laptop.html     /tienda/pdp/x/1200533310
//   pdp_dron.html       /tienda/pdp/x/1201023200
//   s_funda_iphone_16.html   /tienda?s=funda%20iPhone%2016        s_mica_iphone_16.html  /tienda?s=mica%20iPhone%2016
//   s_audifonos_apple.html   /tienda?s=aud%C3%ADfonos%20inal%C3%A1mbricos%20Apple
//   s_molde_freidora.html    /tienda?s=molde%20para%20freidora%20de%20aire   s_tazas_cafe.html  /tienda?s=set%20de%20tazas%20para%20caf%C3%A9
//   s_micro_sd.html          /tienda?s=memoria%20micro%20SD       s_mochila_dron.html    /tienda?s=mochila%20para%20dron
// Los artículos cambian: si una ficha ya no existe, se cambia por otra de su tipo y se ajusta su escenario.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const REPO = path.resolve(AQUI, '..', '..');
const [EXT, SALIDA, PAGINAS] = process.argv.slice(2).map((a) => path.resolve(a));
if (!EXT || !SALIDA || !PAGINAS) { console.error('Uso: node extension-e2e.mjs <carpeta de la extensión> <salida> <páginas guardadas>'); process.exit(2); }
for (const [que, ruta] of [['La salida', SALIDA], ['Las páginas', PAGINAS]]) {
  if ((ruta + path.sep).toLowerCase().indexOf((REPO + path.sep).toLowerCase()) === 0) { console.error(que + ' van fuera del repo: ' + ruta); process.exit(2); }
}
if (!fs.existsSync(path.join(EXT, 'manifest.json'))) { console.error('No hay manifest.json en ' + EXT); process.exit(2); }
fs.mkdirSync(SALIDA, { recursive: true });

const perfil = path.join(os.tmpdir(), 'e2e-vm3-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging', '--user-data-dir=' + perfil, '--window-size=1366,900', '--lang=es-MX', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const escribir = chrome.stdio[3], leerPipe = chrome.stdio[4];
let n = 0; const pend = new Map(); const oyentes = []; let resto = Buffer.alloc(0);
leerPipe.on('data', (t) => {
  resto = Buffer.concat([resto, t]); let i;
  while ((i = resto.indexOf(0)) !== -1) {
    const m = JSON.parse(resto.subarray(0, i).toString('utf8')); resto = resto.subarray(i + 1);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) oyentes.forEach((f) => f(m));
  }
});
function cdp(method, params = {}, sessionId, tope = 30000) {
  return new Promise((res, rej) => {
    const i = ++n; const t = setTimeout(() => { pend.delete(i); rej(new Error('tope en ' + method)); }, tope);
    pend.set(i, (m) => { clearTimeout(t); res(m); });
    const msg = { id: i, method, params }; if (sessionId) msg.sessionId = sessionId;
    escribir.write(JSON.stringify(msg) + '\0');
  });
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const leer = (f) => fs.readFileSync(path.join(PAGINAS, f), 'utf8');

// ---- lo que se sirve -----------------------------------------------------------------------------
const BUSQUEDAS = {
  'funda iphone 16': 's_funda_iphone_16.html', 'mica iphone 16': 's_mica_iphone_16.html', 'audifonos inalambricos apple': 's_audifonos_apple.html',
  'molde para freidora de aire': 's_molde_freidora.html', 'set de tazas para cafe': 's_tazas_cafe.html',
  'memoria micro sd': 's_micro_sd.html', 'mochila para dron': 's_mochila_dron.html'
};
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();
const SIN_RESULTADOS = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Sin resultados | Liverpool</title></head><body><main><p>No encontramos resultados</p></main></body></html>';
const comoNext = (s) => JSON.stringify(s).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const hora = (ms) => new Date(ms).toISOString().replace('T', ' ');   // «2026-10-04 17:40:10.000Z», como la escribe Liverpool
function paginaBolsa(items) {
  const lineas = items.map((x, i) => ({ internalKey: 'li-' + i, id: '00000000-0000-4000-8000-00000000000' + i, sku: String(x.sku || x.id), productName: x.nombre, productSlug: String(x.id), productType: 'SOFT_LINE',
    price: { centAmount: Math.round(x.precio * 100), fractionDigits: 2, currencyCode: 'MXN', pesosAmount: x.precio }, quantity: 1, categoryName: null, sellerName: null,
    addedAt: hora(x.agregado), lastModifiedAt: hora(x.agregado), isMarketplace: false, brand: x.marca, isOnStock: true, productId: String(x.id) }));
  const stream = '0:["$","$L1",null,{"buildId":"e2e"}]\n1a7:' + JSON.stringify(['$', '$L1a7', null, { cart: { id: '25550000001', brand: 'LP', lineItems: lineas,
    shippingAddress: { firstName: 'CLIENTE DE PRUEBA', street: 'CALLE FALSA 123', phone: '5500000000' } } }]) + '\n';
  const medio = Math.floor(stream.length / 2);
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Mi Bolsa</title></head><body>' +
    '<script>self.__next_f=self.__next_f||[];self.__next_f.push([0])</script><script>self.__next_f.push([1,' + comoNext(stream.slice(0, medio)) + '])</script>' +
    '<script>self.__next_f.push([1,' + comoNext(stream.slice(medio)) + '])</script></body></html>';
}
/** La ficha, con la insignia de la bolsa en la cabecera si se pide (la página de invitado no la trae). */
function conInsignia(html, cuenta) {
  if (!cuenta) return html;
  return html.replace(/(<a[^>]*data-testid="[^"]*-header-shopping-cart-shopping-link"[^>]*>)/, '$1<div data-testid="blt26617d4f2e17657d-header-shopping-cart-header-cart-quantity">' + cuenta + '</div>');
}

const informe = { escenarios: {} };
let extId = null, sExt = null;

async function almacen() {
  const r = await cdp('Runtime.evaluate', { expression: 'new Promise(function (r) { chrome.storage.local.get(null, function (x) { r(JSON.stringify(x)); }); })', awaitPromise: true, returnByValue: true }, sExt);
  return JSON.parse(r.result.result.value);
}
async function limpiarAlmacen(claves) {
  await cdp('Runtime.evaluate', { expression: 'new Promise(function (r) { chrome.storage.local.remove(' + JSON.stringify(claves) + ', function () { r(true); }); })', awaitPromise: true }, sExt);
}

/** Abre una ficha servida desde disco. `mundo` se puede cambiar a media prueba (la bolsa, la insignia). */
async function abrirFicha(url, archivo, mundo) {
  const t = await cdp('Target.createTarget', { url: 'about:blank' });
  const s = (await cdp('Target.attachToTarget', { targetId: t.result.targetId, flatten: true })).result.sessionId;
  await cdp('Network.enable', {}, s);
  if (mundo.folio) await cdp('Network.setCookie', { name: 'x-cs-folio-id', value: String(mundo.folio), domain: 'www.liverpool.com.mx', path: '/' }, s);
  else await cdp('Network.deleteCookies', { name: 'x-cs-folio-id', domain: 'www.liverpool.com.mx' }, s);
  const st = { s, targetId: t.result.targetId, pedidos: [], contextos: [], mundo };
  const htmlFicha = leer(archivo);
  oyentes.push((m) => {
    if (m.sessionId !== s) return;
    if (m.method === 'Runtime.executionContextCreated') st.contextos.push(m.params.context);
    if (m.method !== 'Fetch.requestPaused') return;
    const u = m.params.request.url, id = m.params.requestId;
    const responder = (cuerpo, codigo) => cdp('Fetch.fulfillRequest', { requestId: id, responseCode: codigo || 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: b64(cuerpo) }, s);
    let ruta = null;
    try { const x = new URL(u); if (/(^|\.)liverpool\.com\.mx$/.test(x.hostname)) ruta = x.pathname + x.search; } catch (e) { /* nada */ }
    if (ruta === null) { cdp('Fetch.failRequest', { requestId: id, errorReason: 'BlockedByClient' }, s); return; }   // nada sale a terceros
    if (ruta.indexOf('/tienda/pdp/') === 0) { st.pedidos.push('ficha ' + ruta.split('?')[1] || ''); responder(conInsignia(htmlFicha, st.mundo.cuenta)); return; }
    if (ruta.indexOf('/tienda?s=') === 0) {
      const q = decodeURIComponent(ruta.slice('/tienda?s='.length));
      st.pedidos.push('busqueda ' + q);
      const f = BUSQUEDAS[norm(q)];
      responder(f ? leer(f) : SIN_RESULTADOS);
      return;
    }
    if (ruta.indexOf('/tienda/cart') === 0) { st.pedidos.push('bolsa'); responder(paginaBolsa(st.mundo.bolsa || [])); return; }
    cdp('Fetch.fulfillRequest', { requestId: id, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: b64('') }, s);
  });
  await cdp('Runtime.enable', {}, s);
  await cdp('Page.enable', {}, s);
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, s);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
  // Los enlaces de la tarjeta abren pestaña nueva: en la prueba el clic se anota pero no navega.
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'document.addEventListener("click", function (e) { var a = e.composedPath && e.composedPath()[0]; if (window.__sinNavegar) e.preventDefault(); }, true);' }, s);
  await cdp('Page.navigate', { url }, s);
  let lista = false;
  for (let i = 0; i < 60 && !lista; i++) {
    await dormir(250);
    const r = await cdp('Runtime.evaluate', { expression: '!!(document.getElementById("ventel-vende-mas") && document.getElementById("ventel-vende-mas").shadowRoot.querySelector(".t"))', returnByValue: true }, s);
    lista = r.result.result.value === true;
  }
  st.tarjeta = lista;
  return st;
}
const evalua = async (st, expression) => (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, st.s)).result.result.value;
/** Lo que la tarjeta tiene pintado (el shadow root es abierto: se lee desde la página). */
async function pintado(st) {
  return JSON.parse(await evalua(st, `(function () {
    var h = document.getElementById('ventel-vende-mas'); if (!h) return 'null';
    var r = h.shadowRoot, t = function (e) { return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; };
    return JSON.stringify({
      cabecera: t(r.querySelector('.cab-tx')),
      secciones: [].map.call(r.querySelectorAll('.sec h3'), t),
      equipo: t(r.querySelector('.eq')), yaVa: t(r.querySelector('.ya')), care: !!r.querySelector('.srv'),
      filas: [].map.call(r.querySelectorAll('a.f'), function (a) { return { k: a.getAttribute('data-k'), marca: t(a.querySelector('.ceja')), nombre: t(a.querySelector('.nom')), nota: t(a.querySelector('.nota')), precio: t(a.querySelector('.pz')) }; }),
      chips: [].map.call(r.querySelectorAll('.chip'), t),
      promos: [].map.call(r.querySelectorAll('.promo'), t),
      estilosPegados: [].map.call(r.querySelectorAll('[style]'), function (e) { return e.className; }),
      alto: Math.round(h.getBoundingClientRect().height)
    }); })()`));
}
/** El diagnóstico de la tarjeta, que vive en el mundo aislado de la extensión. */
async function diagnostico(st) {
  let aislado = null;
  for (const c of st.contextos.filter((x) => x.auxData && x.auxData.type === 'isolated').reverse()) {
    try {
      const p = await cdp('Runtime.evaluate', { contextId: c.id, returnByValue: true, expression: 'typeof window.__ventelVendeMas' }, st.s);
      if (p.result && p.result.result && p.result.result.value === 'function') { aislado = c; break; }
    } catch (e) { /* contexto ya destruido */ }
  }
  if (!aislado) return { error: 'sin mundo aislado con la tarjeta' };
  const r = await cdp('Runtime.evaluate', { contextId: aislado.id, returnByValue: true, expression: `(function () { try {
    var d = window.__ventelVendeMas(), m = d.modelo || {};
    var conDatos = function (l) { return (l || []).filter(function (x) { return typeof x.nOp === 'number'; }).length + '/' + (l || []).length; };
    return JSON.stringify({ clase: m.clase && m.clase.id, delStream: d.ficha && d.ficha.delStream,
      carruseles: { complementa: conDatos(d.carruseles.complementa), otros: conDatos(d.carruseles.otros), relacionados: conDatos(d.carruseles.relacionados) },
      cruzada: (m.cruzada || []).map(function (x) { return { id: x.id, tipo: x.tipo, origen: x.origen, compat: x.compat, cal: x.cal, nOp: x.nOp, mkp: x.mkp, enLugarDe: x.enLugarDe || null }; }),
      plan: (m.busquedas || []).map(function (b) { return b.consulta; }), botones: (m.sugeridas || []).map(function (b) { return b.consulta; }), servicio: !!m.servicio,
      bajoElPiso: ['complementa', 'otros'].reduce(function (l, k) { return l.concat((d.carruseles[k] || []).filter(function (x) { return VentelVM.malCalificado(x, VENTEL_REGLAS.calidad); }).map(function (x) { return x.id + ' ' + x.nombre.slice(0, 44) + ' ★' + x.cal + ' (' + x.nOp + ')'; })); }, []),
      conPencil: ['complementa', 'otros', 'relacionados'].reduce(function (n, k) { return n + (d.carruseles[k] || []).filter(function (x) { return /pencil/i.test(x.nombre); }).length; }, 0),
      bolsa: m.bolsa, cuenta: d.bolsa.cuenta, articulos: d.bolsa.articulos ? d.bolsa.articulos.length : null,
      aLaVista: d.aLaVista, medido: d.medido, gsap: typeof gsap === 'undefined' ? null : gsap.version });
  } catch (e) { return JSON.stringify({ error: String(e && e.message) }); } })()` }, st.s);
  return JSON.parse(r.result.result.value);
}
async function foto(st, nombre) {
  await evalua(st, 'document.getElementById("ventel-vende-mas").scrollIntoView({ block: "center" }); true');
  await dormir(1300);
  const b = JSON.parse(await evalua(st, '(function () { var r = document.getElementById("ventel-vende-mas").getBoundingClientRect(); return JSON.stringify({ x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height }); })()'));
  const f = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, b.x - 16), y: Math.max(0, b.y - 16), width: Math.min(b.width + 32, 900), height: Math.min(b.height + 32, 880), scale: 2 } }, st.s);
  fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(f.result.data, 'base64'));
}
const cerrar = (st) => cdp('Target.closeTarget', { targetId: st.targetId });
async function esperar(cond, tope, paso) {
  const t0 = Date.now();
  while (Date.now() - t0 < tope) { if (await cond()) return true; await dormir(paso || 400); }
  return false;
}

try {
  await dormir(800);
  const carga = await cdp('Extensions.loadUnpacked', { path: EXT });
  if (!carga.result) throw new Error('no cargó: ' + JSON.stringify(carga.error));
  extId = carga.result.id;
  const tExt = await cdp('Target.createTarget', { url: 'chrome-extension://' + extId + '/viewer.html' });
  sExt = (await cdp('Target.attachToTarget', { targetId: tExt.result.targetId, flatten: true })).result.sessionId;
  await dormir(800);
  const ahora = Date.now(), dia = 86400000;
  const promos = { v: 1, generado: ahora - 2 * 3600000, fuerte: { d: 'Mujer', c: 'Bolsas', t: 'Hasta 58% de descuento', p: 58, m: 0, f: ahora + 2 * dia, k: '' },
    promos: [{ d: 'Mujer', c: 'Bolsas', t: 'Hasta 58% de descuento', p: 58, m: 0, f: ahora + 2 * dia, k: '' },
      { d: 'Electrónica', c: 'Celulares', t: 'Hasta 20% de descuento y hasta 18 MSI', p: 20, m: 18, f: ahora + 5 * dia, k: '' }], ajustes: { busqueda: true } };
  await cdp('Runtime.evaluate', { expression: 'new Promise(function (r) { chrome.storage.local.set({ ventelPromos: ' + JSON.stringify(promos) + ' }, function () { r(true); }); })', awaitPromise: true }, sExt);

  // ============ 1. iPhone 16, sin nada en la bolsa ============
  {
    const E = informe.escenarios.iphone16 = {};
    const st = await abrirFicha('https://www.liverpool.com.mx/tienda/pdp/iphone-16-6-1-pulgadas-super-retina-xdr/1163567866', 'pdp_iphone16.html', { cuenta: 0, bolsa: [], folio: 27105 });
    E.tarjeta = st.tarjeta;
    await evalua(st, 'window.__sinNavegar = true; document.getElementById("ventel-vende-mas").scrollIntoView({ block: "center" }); true');
    await esperar(async () => st.pedidos.some((p) => p.indexOf('busqueda') === 0), 8000);
    await dormir(3500);
    E.pintado = await pintado(st);
    E.diag = await diagnostico(st);
    E.pedidos = st.pedidos.slice();
    await foto(st, '1-iphone16');
    let a = await almacen();
    E.medicion1 = a.vmMedicion ? { dias: a.vmMedicion.dias, recientes: a.vmMedicion.recientes.map((x) => x.k + ':' + x.id + (x.sku ? '/' + x.sku : '')) } : null;
    E.cacheBusqueda = Object.keys(a.vmBusquedas || {}).map((k) => k + ' v' + a.vmBusquedas[k].v + ' ' + a.vmBusquedas[k].items.length + ' con datos ' + a.vmBusquedas[k].items.filter((x) => typeof x.nOp === 'number').length);
    E.bolsaGuardada = a.vmBolsa || null;

    // el clic en la primera recomendación
    const primera = E.pintado.filas.find((f) => /^x:/.test(f.k));
    E.clicEn = primera ? primera.k : null;
    if (primera) {
      await evalua(st, 'document.getElementById("ventel-vende-mas").shadowRoot.querySelector(\'a.f[data-k="' + primera.k + '"]\').click(); true');
      await dormir(700);
      a = await almacen();
      E.trasClic = a.vmMedicion.dias[Object.keys(a.vmMedicion.dias)[0]];
      // «la agrega a la bolsa»: la cabecera pasa a 1 y la bolsa trae ese artículo, agregado ahora
      st.mundo.cuenta = 1;
      st.mundo.bolsa = [{ id: primera.k.slice(2), nombre: primera.nombre, marca: primera.marca, precio: 999, agregado: Date.now() }];
      await evalua(st, `(function () { var a = document.querySelector('[data-testid$="-header-shopping-cart-shopping-link"]'); var d = document.createElement('div'); d.setAttribute('data-testid', 'blt26617d4f2e17657d-header-shopping-cart-header-cart-quantity'); d.textContent = '1'; a.insertBefore(d, a.firstChild); return true; })()`);
      E.bolsaLeida = await esperar(async () => st.pedidos.indexOf('bolsa') > -1, 9000);
      await dormir(1500);
      a = await almacen();
      E.trasBolsa = a.vmMedicion.dias[Object.keys(a.vmMedicion.dias)[0]];
      E.tipos = a.vmMedicion.tipos;
      E.pintadoTrasBolsa = await pintado(st);
      E.pedidosFinal = st.pedidos.slice();
      E.guardadoDeLaBolsa = JSON.stringify(a.vmBolsa);
      await foto(st, '1b-iphone16-con-su-recomendacion-en-la-bolsa');
    }
    await cerrar(st);
  }

  // ============ 2. El adaptador de Apple, con el iPhone 16 recién agregado a la bolsa ============
  {
    const E = informe.escenarios.adaptadorConIphone = {};
    await dormir(21000);   // el ritmo de la bolsa: 20 s entre dos lecturas (la anterior fue hace un momento)
    const st = await abrirFicha('https://www.liverpool.com.mx/tienda/pdp/adaptador-de-corriente/1168416900', 'pdp_adaptador.html',
      { cuenta: 1, folio: 27106, bolsa: [{ id: '1163567866', sku: '1163057502', nombre: 'iPhone 16 6.1 pulgadas Super Retina XDR', marca: 'APPLE', precio: 17499, agregado: Date.now() - 5 * 60000 }] });
    E.tarjeta = st.tarjeta;
    await evalua(st, 'window.__sinNavegar = true; document.getElementById("ventel-vende-mas").scrollIntoView({ block: "center" }); true');
    E.bolsaLeida = await esperar(async () => st.pedidos.indexOf('bolsa') > -1, 9000);
    await esperar(async () => st.pedidos.filter((p) => p.indexOf('busqueda') === 0).length >= 2, 12000);
    await dormir(3500);
    E.pintado = await pintado(st);
    E.diag = await diagnostico(st);
    E.pedidos = st.pedidos.slice();
    await foto(st, '2-adaptador-con-iphone-en-la-bolsa');
    await cerrar(st);
  }

  // ============ 3. La freidora: el molde mejor calificado en lugar del primero ============
  {
    const E = informe.escenarios.freidora = {};
    const st = await abrirFicha('https://www.liverpool.com.mx/tienda/pdp/freidora-de-aire-con-compartimento-%c3%banico-6-l-ckstaf60wddf/1188152119', 'pdp_freidora.html', { cuenta: 0, bolsa: [], folio: 27106 });
    E.tarjeta = st.tarjeta;
    await evalua(st, 'window.__sinNavegar = true; document.getElementById("ventel-vende-mas").scrollIntoView({ block: "center" }); true');
    await esperar(async () => st.pedidos.some((p) => p.indexOf('busqueda') === 0), 8000);
    await dormir(3500);
    E.pintado = await pintado(st);
    E.diag = await diagnostico(st);
    E.pedidos = st.pedidos.slice();
    await foto(st, '3-freidora');
    await cerrar(st);
  }

  // ============ 4. La funda Lacoste con el iPhone en la bolsa (de la caché: sin releer la bolsa) ============
  {
    const E = informe.escenarios.fundaConIphone = {};
    await dormir(16000);   // el ritmo de la bolsa: 20 s entre dos lecturas
    const st = await abrirFicha('https://www.liverpool.com.mx/tienda/pdp/funda-para-iphone-16-de-tpu/999673023163', 'pdp_funda.html',
      { cuenta: 1, folio: 27106, bolsa: [{ id: '1163567866', sku: '1163057502', nombre: 'iPhone 16 6.1 pulgadas Super Retina XDR', marca: 'APPLE', precio: 17499, agregado: Date.now() - 6 * 60000 }] });
    E.tarjeta = st.tarjeta;
    await evalua(st, 'window.__sinNavegar = true; document.getElementById("ventel-vende-mas").scrollIntoView({ block: "center" }); true');
    await esperar(async () => st.pedidos.filter((p) => p.indexOf('busqueda') === 0).length >= 1, 9000);
    await dormir(4500);
    E.pintado = await pintado(st);
    E.diag = await diagnostico(st);
    E.pedidos = st.pedidos.slice();
    await foto(st, '4-funda-con-iphone-en-la-bolsa');
    await cerrar(st);
  }

  // ============ 4b. La cafetera espresso: lo que los clientes calificaron mal no se ofrece (el piso) ============
  {
    const E = informe.escenarios.espresso = {};
    const st = await abrirFicha('https://www.liverpool.com.mx/tienda/pdp/cafetera-espresso-rj54-ss-15-d-mx/1163997114', 'pdp_espresso.html', { cuenta: 0, bolsa: [], folio: 27106 });
    E.tarjeta = st.tarjeta;
    await evalua(st, 'window.__sinNavegar = true; document.getElementById("ventel-vende-mas").scrollIntoView({ block: "center" }); true');
    await esperar(async () => st.pedidos.some((p) => p.indexOf('busqueda') === 0), 8000);
    await dormir(4500);
    E.pintado = await pintado(st);
    E.diag = await diagnostico(st);
    E.pedidos = st.pedidos.slice();
    await foto(st, '4b-espresso');
    await cerrar(st);
  }

  // ============ 4c. La laptop: el adaptador del Pencil no es su hub (uno de los cuatro errores de la 2.9) ============
  {
    const E = informe.escenarios.laptop = {};
    const st = await abrirFicha('https://www.liverpool.com.mx/tienda/pdp/laptop-thin-light-omnibook-3-16-bu0054la/1200533310', 'pdp_laptop.html', { cuenta: 0, bolsa: [], folio: 27106 });
    E.tarjeta = st.tarjeta;
    await evalua(st, 'window.__sinNavegar = true; document.getElementById("ventel-vende-mas").scrollIntoView({ block: "center" }); true');
    await esperar(async () => st.pedidos.some((p) => p.indexOf('busqueda') === 0), 8000);
    await dormir(4500);
    E.pintado = await pintado(st);
    E.diag = await diagnostico(st);
    E.pedidos = st.pedidos.slice();
    await foto(st, '4c-laptop');
    await cerrar(st);
  }

  // ============ 4d. Un dron DJI: una de las doce clases nuevas ============
  {
    const E = informe.escenarios.dron = {};
    const st = await abrirFicha('https://www.liverpool.com.mx/tienda/pdp/x/1201023200', 'pdp_dron.html', { cuenta: 0, bolsa: [], folio: 27106 });
    E.tarjeta = st.tarjeta;
    await evalua(st, 'window.__sinNavegar = true; document.getElementById("ventel-vende-mas").scrollIntoView({ block: "center" }); true');
    await esperar(async () => st.pedidos.some((p) => p.indexOf('busqueda') === 0), 8000);
    await dormir(4500);
    E.pintado = await pintado(st);
    E.diag = await diagnostico(st);
    E.pedidos = st.pedidos.slice();
    await foto(st, '4d-dron');
    await cerrar(st);
  }

  // ============ 5. La página de la medición ============
  {
    const E = informe.escenarios.medicion = {};
    const t = await cdp('Target.createTarget', { url: 'chrome-extension://' + extId + '/medicion.html' });
    const s = (await cdp('Target.attachToTarget', { targetId: t.result.targetId, flatten: true })).result.sessionId;
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1180, height: 1500, deviceScaleFactor: 1, mobile: false }, s);
    await dormir(1200);
    const lee = async () => JSON.parse((await cdp('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({ origen: document.getElementById('origen').textContent,
      vacio: document.getElementById('vacio').hidden, embudo: [].map.call(document.querySelectorAll('.paso'), function (p) { return p.textContent.replace(/\\s+/g, ' ').trim(); }),
      cifras: [].map.call(document.querySelectorAll('.tarjeta-resumen'), function (p) { return p.textContent.replace(/\\s+/g, ' ').trim(); }),
      dias: [].map.call(document.querySelectorAll('#secDias tr'), function (r) { return [].map.call(r.children, function (c) { return c.textContent; }).join(' | '); }),
      tipos: [].map.call(document.querySelectorAll('#secTipos tbody tr'), function (r) { return [].map.call(r.children, function (c) { return c.textContent; }).join(' | '); }),
      avisos: document.getElementById('avisos').textContent, pausar: document.getElementById('btnPausar').textContent, borrar: document.getElementById('btnBorrar').textContent,
      desborde: document.documentElement.scrollWidth > document.documentElement.clientWidth })` }, s)).result.result.value);
    E.inicial = await lee();
    let f = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, s);
    fs.writeFileSync(path.join(SALIDA, '5-medicion.png'), Buffer.from(f.result.data, 'base64'));
    await cdp('Emulation.setDeviceMetricsOverride', { width: 420, height: 1400, deviceScaleFactor: 1, mobile: false }, s);
    await dormir(400);
    E.angosta = (await lee()).desborde;
    f = await cdp('Page.captureScreenshot', { format: 'png' }, s);
    fs.writeFileSync(path.join(SALIDA, '5b-medicion-angosta.png'), Buffer.from(f.result.data, 'base64'));
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, s);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1180, height: 1500, deviceScaleFactor: 1, mobile: false }, s);
    await dormir(400);
    f = await cdp('Page.captureScreenshot', { format: 'png' }, s);
    fs.writeFileSync(path.join(SALIDA, '5c-medicion-oscuro.png'), Buffer.from(f.result.data, 'base64'));
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, s);
    await cdp('Runtime.evaluate', { expression: 'document.getElementById("btnPausar").click()' }, s);
    await dormir(500);
    E.pausada = { pagina: await lee(), almacen: (await almacen()).vmMedicion.pausada };
    await cdp('Runtime.evaluate', { expression: 'document.getElementById("btnPausar").click()' }, s);
    await dormir(400);
    E.reanudada = (await almacen()).vmMedicion.pausada;
    await cdp('Runtime.evaluate', { expression: 'document.getElementById("btnBorrar").click()' }, s);
    await dormir(300);
    E.borrarPideConfirmar = { boton: (await lee()).borrar, siguenLosDatos: Object.keys((await almacen()).vmMedicion.dias).length };
    await cdp('Runtime.evaluate', { expression: 'document.getElementById("btnBorrar").click()' }, s);
    await dormir(500);
    E.borrada = { pagina: await lee(), dias: Object.keys((await almacen()).vmMedicion.dias).length };
    f = await cdp('Page.captureScreenshot', { format: 'png' }, s);
    fs.writeFileSync(path.join(SALIDA, '5d-medicion-vacia.png'), Buffer.from(f.result.data, 'base64'));
  }

  // ============ 6. El popup trae el acceso a la medición ============
  {
    const E = informe.escenarios.popup = {};
    const t = await cdp('Target.createTarget', { url: 'chrome-extension://' + extId + '/popup.html' });
    const s = (await cdp('Target.attachToTarget', { targetId: t.result.targetId, flatten: true })).result.sessionId;
    await cdp('Emulation.setDeviceMetricsOverride', { width: 400, height: 640, deviceScaleFactor: 2, mobile: false }, s);
    await dormir(900);
    E.boton = (await cdp('Runtime.evaluate', { returnByValue: true, expression: '(function () { var b = document.getElementById("btnMedicion"); return b ? b.textContent.replace(/\\s+/g, " ").trim() + " | visible: " + (b.getBoundingClientRect().height > 0) + " | y: " + Math.round(b.getBoundingClientRect().top) + " de " + document.documentElement.scrollHeight : null; })()' }, s)).result.result.value;
    const antes = (await cdp('Target.getTargets')).result.targetInfos.length;
    await cdp('Runtime.evaluate', { expression: 'document.getElementById("btnMedicion").click()' }, s);
    await dormir(900);
    const despues = (await cdp('Target.getTargets')).result.targetInfos;
    E.abreMedicion = despues.length === antes + 1 && despues.some((x) => /medicion\.html$/.test(x.url));
    const f = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, s);
    fs.writeFileSync(path.join(SALIDA, '6-popup.png'), Buffer.from(f.result.data, 'base64'));
  }

  // ============ 7. Lo que dice Chrome de la extensión ============
  const sp = (await cdp('Target.attachToTarget', { targetId: (await cdp('Target.createTarget', { url: 'chrome://extensions/?id=' + extId })).result.targetId, flatten: true })).result.sessionId;
  await dormir(1500);
  const av = await cdp('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: 'new Promise(function(ok){chrome.developerPrivate.getExtensionInfo("' + extId + '", function(i){ok(JSON.stringify({version:i.version,avisos:i.installWarnings,erroresManifiesto:(i.manifestErrors||[]).length,erroresEjecucion:(i.runtimeErrors||[]).map(function(e){return e.message + " @ " + (e.source||"").split("/").pop()}).slice(0,8)}))})})' }, sp);
  informe.chrome = JSON.parse(av.result.result.value);

  // ============ Lo que tiene que cumplirse ============
  const E = informe.escenarios, C = informe.comprobaciones = [];
  const ok = (nombre, cond, extra) => C.push(cond ? { ok: true, nombre } : { ok: false, nombre, extra });
  const FICHAS = ['iphone16', 'adaptadorConIphone', 'freidora', 'fundaConIphone', 'espresso', 'laptop', 'dron'];
  const tipos = (k) => E[k].diag.cruzada.map((x) => x.tipo).join();
  const hoy = Object.keys(E.iphone16.medicion1.dias)[0];
  const guardado = JSON.stringify(await almacen());
  ok('la tarjeta aparece en las 7 fichas', FICHAS.every((k) => E[k].tarjeta), FICHAS.filter((k) => !E[k].tarjeta));
  ok('la ficha y los carruseles se leen del stream, con la calificación de cada artículo',
    FICHAS.every((k) => E[k].diag.delStream && E[k].diag.carruseles.complementa !== '0/0' && /^(\d+)\/\1$/.test(E[k].diag.carruseles.complementa)), FICHAS.map((k) => E[k].diag.carruseles));
  ok('GSAP 3.15.0 vive en el mundo aislado de la extensión', E.iphone16.diag.gsap === '3.15.0', E.iphone16.diag.gsap);
  ok('iPhone 16: la funda y la mica son de SU modelo', E.iphone16.diag.clase === 'smartphone' && E.iphone16.diag.cruzada.filter((x) => (x.tipo === 'funda' || x.tipo === 'mica') && x.compat === 'exacto').length === 2, E.iphone16.diag.cruzada);
  ok('iPhone 16: busca la mica y guarda los resultados con sus datos (forma 2 de la caché)',
    E.iphone16.pedidos.indexOf('busqueda mica iPhone 16') > -1 && E.iphone16.cacheBusqueda.some((c) => /^mica iphone 16 v2 \d+ con datos [1-9]/.test(c)), [E.iphone16.pedidos, E.iphone16.cacheBusqueda]);
  ok('la calificación se ve junto a la recomendación', E.iphone16.pintado.filas.some((f) => /★ \d\.\d · \d+ opini/.test(f.nota || '')), E.iphone16.pintado.filas.map((f) => f.nota));
  ok('medición: cuenta lo mostrado, el clic y la llegada a la bolsa',
    E.iphone16.medicion1.dias[hoy].mostradas === 3 && E.iphone16.medicion1.dias[hoy].clics === 0 && E.iphone16.trasClic.clics === 1 && E.iphone16.bolsaLeida && E.iphone16.trasBolsa.enBolsa === 1, [E.iphone16.medicion1, E.iphone16.trasClic, E.iphone16.trasBolsa]);
  ok('con la funda ya en la bolsa, no se vuelve a ofrecer y la tarjeta lo dice',
    /funda/.test(E.iphone16.pintadoTrasBolsa.yaVa || '') && !E.iphone16.pintadoTrasBolsa.filas.some((f) => f.k === E.iphone16.clicEn), E.iphone16.pintadoTrasBolsa);
  ok('de la bolsa se guarda el artículo, no el cliente: ni su nombre, ni su dirección, ni su teléfono', /"vmBolsa"/.test(guardado) && !/CLIENTE DE PRUEBA|CALLE FALSA|5500000000/.test(guardado + JSON.stringify(E)), guardado.slice(0, 300));
  ok('adaptador de Apple con el iPhone en la bolsa: adopta el iPhone 16 y ofrece su funda y su mica',
    /iPhone 16/.test(E.adaptadorConIphone.pintado.equipo || '') && tipos('adaptadorConIphone') === 'funda,mica' && E.adaptadorConIphone.diag.cruzada.every((x) => x.compat === 'exacto'), [E.adaptadorConIphone.pintado.equipo, E.adaptadorConIphone.diag.cruzada]);
  ok('…leyendo la bolsa una sola vez, y sin buscar nada antes de tenerla',
    E.adaptadorConIphone.pedidos.filter((p) => p === 'bolsa').length === 1 && E.adaptadorConIphone.pedidos.findIndex((p) => p === 'bolsa') < E.adaptadorConIphone.pedidos.findIndex((p) => p.indexOf('busqueda') === 0), E.adaptadorConIphone.pedidos);
  ok('freidora: entre los moldes, la calidad elige uno con opiniones', E.freidora.diag.cruzada.some((x) => x.tipo === 'accesorios' && x.enLugarDe && x.nOp > 0), E.freidora.diag.cruzada);
  ok('funda con el iPhone en la bolsa: adopta el iPhone y no ofrece otra funda', /iPhone 16/.test(E.fundaConIphone.pintado.equipo || '') && !/funda/.test(tipos('fundaConIphone')), [E.fundaConIphone.pintado.equipo, tipos('fundaConIphone')]);
  ok('espresso: el carrusel trae algo bajo el piso de calidad y la tarjeta no lo ofrece',
    E.espresso.diag.bajoElPiso.length > 0 && !E.espresso.pintado.filas.some((f) => E.espresso.diag.bajoElPiso.some((m) => f.k === 'x:' + m.split(' ')[0])), [E.espresso.diag.bajoElPiso, E.espresso.pintado.filas.map((f) => f.k)]);
  ok('laptop: la página trae el adaptador del Pencil y la tarjeta no lo ofrece como hub',
    E.laptop.diag.clase === 'laptop' && E.laptop.diag.conPencil > 0 && !E.laptop.pintado.filas.some((f) => /pencil/i.test(f.nombre || '')), [E.laptop.diag.conPencil, E.laptop.pintado.filas.map((f) => f.nombre)]);
  ok('dron (clase nueva): micro SD y mochila de dron, con Liverpool Care y la batería de su modelo como botón',
    E.dron.diag.clase === 'dron' && E.dron.pintado.care && tipos('dron') === 'microsd,mochila' && E.dron.pintado.chips.some((c) => /bater[ií]a .*mini 5 pro/i.test(c)), [E.dron.diag.clase, tipos('dron'), E.dron.pintado.chips]);
  ok('dron: si hay subida de versión, es el mismo modelo', E.dron.pintado.filas.filter((f) => /^m:/.test(f.k)).every((f) => /mini 5 pro/i.test(f.nombre)), E.dron.pintado.filas.filter((f) => /^m:/.test(f.k)));
  ok('la página de la medición enseña el embudo y no desborda en 420 px', /recomendaciones mostradas/.test(E.medicion.inicial.embudo[0] || '') && E.medicion.inicial.vacio === true && E.medicion.angosta === false, E.medicion.inicial.embudo);
  ok('la medición se pausa, se reanuda y se borra en dos toques',
    E.medicion.pausada.almacen === true && E.medicion.reanudada === false && /otra vez/.test(E.medicion.borrarPideConfirmar.boton) && E.medicion.borrarPideConfirmar.siguenLosDatos > 0 && E.medicion.borrada.dias === 0, [E.medicion.pausada.almacen, E.medicion.reanudada, E.medicion.borrarPideConfirmar, E.medicion.borrada.dias]);
  ok('el popup abre la medición', /visible: true/.test(E.popup.boton || '') && E.popup.abreMedicion === true, E.popup);
  ok('Chrome carga la extensión sin avisos ni errores, en la versión del manifiesto',
    informe.chrome.avisos.length === 0 && informe.chrome.erroresManifiesto === 0 && informe.chrome.erroresEjecucion.length === 0 && informe.chrome.version === JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version, informe.chrome);
} catch (e) {
  informe.fallo = e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n');
} finally {
  fs.writeFileSync(path.join(SALIDA, 'informe.json'), JSON.stringify(informe, null, 1));
  chrome.kill();
  const C = informe.comprobaciones || [], mal = C.filter((c) => !c.ok);
  C.forEach((c) => console.log((c.ok ? '  ✔ ' : '  ✖ ') + c.nombre + (c.ok ? '' : '  → ' + JSON.stringify(c.extra).slice(0, 500))));
  if (informe.fallo) console.log('\nSe interrumpió: ' + informe.fallo);
  console.log('\n' + (informe.fallo || mal.length || !C.length ? '✖ ' + (informe.fallo ? 'no terminó' : mal.length + ' de ' + C.length + ' fallaron') : '✔ ' + C.length + ' comprobaciones en verde') + ' · informe y capturas en ' + SALIDA);
  process.exitCode = informe.fallo || mal.length || !C.length ? 1 : 0;
}
