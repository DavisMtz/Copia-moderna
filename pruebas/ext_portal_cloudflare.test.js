/*
 * Pruebas de la extensión 3.1 con el Portal en Cloudflare (https://ventel.logidma.com/): el Portal ya no va
 * dentro de un marco de Apps Script sino como página de arriba, y la extensión tiene que hablar con él SIN dejar
 * de hablar con el de Apps Script.
 *   Ejecutar:  node pruebas/ext_portal_cloudflare.test.js
 *
 * Se cargan los archivos REALES de la extensión (popup.js, cart-cotizar-button.js, fondo.js, bridge.js y
 * campana-puente.js) en un `vm`, cada uno con un navegador de mentira. Lo que importa comprobar es lo que NO
 * puede pasar: guardar como «el sistema» una dirección que solo PARECE el Portal (otro dominio, http, un puerto
 * raro, usuario@), aceptar promociones de una página que no es el Portal, o que la bolsa se entregue dos veces o
 * se quede en el almacenamiento. El puente de la bolsa no usa postMessage (la bolsa viaja en el DOM, en
 * `#ventel-bolsa-datos`, que es lo que lee cotizacion.html también en el Worker): aquí se comprueba que sigue
 * sin hablar con la página y que, en la página de arriba (sin iframes), la deja en su propio documento.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const EXT = path.join(__dirname, '..', 'Extencion para chrome');
const leer = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');

let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 500) : ''));
}
function seccion(t) { console.log('\n' + t); }
const esperar = () => new Promise((r) => setImmediate(r));

const PORTAL = 'https://ventel.logidma.com/';
const PROD = 'AKfycbwGYZs3C-dsZbIWVn27uEaLm_rXQGhiQc9Q54btPxPb-Z1SX0Enx7NlPqKw4STizaOU';
const EXEC_PROD = 'https://script.google.com/a/macros/liverpool.com.mx/s/' + PROD + '/exec';
const DEV = 'https://script.google.com/macros/s/AKfycbxSjCvwk_f3pqcmIzyqlsPbPxlEHj91C6gjJdLXdLOS/dev';
const COTIZACION = 'https://ventel.logidma.com/?page=cotizacion&origen=extension';
const BOLSA = {
  extractedAt: '2026-10-06T12:00:00.000Z', source: 'Liverpool Bolsa',
  products: [{ sku: '1163567866', description: 'iPhone 16', quantity: 1, unitPrice: 17499, discountedUnitPrice: 17499, costPaymentUnique: 17499, totalLine: 17499, imageUrl: '', productUrl: 'https://www.liverpool.com.mx/tienda/pdp/iphone-16/1163567866', soldBy: '' }],
  summary: { subtotal: 17499, discount: 0, total: 17499 }
};

/* Un almacén como chrome.storage.local: get con cadena o lista, set con o sin aviso, remove. */
function almacenLocal(inicial) {
  const datos = Object.assign({}, inicial || {});
  return {
    datos,
    api: {
      get: (k, cb) => { const o = {}; [].concat(k).forEach((x) => { if (x in datos) o[x] = JSON.parse(JSON.stringify(datos[x])); }); cb(o); },
      set: (o, cb) => { Object.assign(datos, JSON.parse(JSON.stringify(o))); if (cb) cb(); return Promise.resolve(); },
      remove: (k, cb) => { [].concat(k).forEach((x) => { delete datos[x]; }); if (cb) cb(); }
    }
  };
}

/* El popup real (popup.js) con un DOM de mentira: cada getElementById da un elemento que guarda sus manejadores. */
function crearPopup(guardado) {
  const al = almacenLocal(guardado);
  const pestanas = [], portapapeles = [], elementos = {};
  const el = (id) => {
    if (!elementos[id]) {
      const clases = new Set();
      const manejadores = {};
      elementos[id] = {
        id, value: '', innerHTML: '', textContent: '', className: '', disabled: false, style: {}, manejadores,
        classList: { toggle: (c, f) => { if (f === undefined ? !clases.has(c) : f) clases.add(c); else clases.delete(c); }, contains: (c) => clases.has(c), add: (c) => clases.add(c), remove: (c) => clases.delete(c) },
        addEventListener: (ev, fn) => { manejadores[ev] = fn; },
        setAttribute() {}, getAttribute() { return null; }, focus() {}
      };
    }
    return elementos[id];
  };
  const ctx = vm.createContext({
    console, URL, setTimeout: () => 0,
    document: { getElementById: el },
    navigator: { clipboard: { writeText: (t) => { portapapeles.push(t); return Promise.resolve(); } } },
    chrome: {
      runtime: { lastError: null, getURL: (p) => 'chrome-extension://EXT/' + p },
      storage: { local: al.api },
      tabs: { query: async () => [{ id: 5, url: 'https://www.liverpool.com.mx/tienda/cart' }], create: async (o) => { pestanas.push(o); } },
      scripting: { executeScript: async () => [{ result: BOLSA }] }
    }
  });
  vm.runInContext(leer('popup.js'), ctx, { filename: 'popup.js' });
  return { ctx, el, almacen: al.datos, pestanas, portapapeles };
}

/* El botón «Cotizar» que se incrusta en la bolsa de Liverpool (cart-cotizar-button.js), pulsado una vez. */
async function pulsarBotonDeLaBolsa(guardado) {
  const al = almacenLocal(guardado);
  const abiertas = [], manejadores = {};
  const comprar = { parentNode: { insertBefore: (nuevo) => { comprar.nuevo = nuevo; } } };
  const tarjeta = { getAttribute: () => 'ml-card-product-mybag-12345678-1234-1234-1234-123456789abc', querySelector: () => null, querySelectorAll: () => [] };
  const ctx = vm.createContext({
    console, URL, setTimeout: () => 0, clearTimeout() {}, MutationObserver: class { observe() {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    window: { open: (u) => abiertas.push(u) },
    document: {
      readyState: 'complete', body: {}, addEventListener() {}, getElementById: () => null,
      querySelector: (s) => (/checkout-payment-summary-button/.test(s) ? comprar : null),
      querySelectorAll: (s) => (/ml-card-product-mybag-/.test(s) ? [tarjeta] : []),
      createElement: () => ({ style: {}, setAttribute() {}, addEventListener: (ev, fn) => { manejadores[ev] = fn; } })
    },
    chrome: { runtime: { lastError: null }, storage: { local: al.api } }
  });
  vm.runInContext(leer('cart-cotizar-button.js'), ctx, { filename: 'cart-cotizar-button.js' });
  await manejadores.click({ currentTarget: comprar.nuevo });
  return { abiertas, almacen: al.datos };
}

/* El fondo real (fondo.js). Mismo mundo que usa ext_recomendador.test.js: sin `URL`, para que nunca dependa de él. */
function crearFondo() {
  let oyente = null;
  const al = almacenLocal();
  const ctx = vm.createContext({
    console, JSON, Math, Number, String, Array, Object, Promise, isFinite, Date,
    chrome: { runtime: { id: 'EXT', lastError: null, onMessage: { addListener: (f) => { oyente = f; } } }, storage: { local: al.api } }
  });
  vm.runInContext(leer('fondo.js'), ctx, { filename: 'fondo.js' });
  const mandar = (sender, datos) => new Promise((r) => { const asinc = oyente({ tipo: 'ventel-promos', datos: datos }, sender, r); if (!asinc) r('sin respuesta'); });
  return { ctx, almacen: al.datos, mandar };
}

/* El puente de la bolsa (bridge.js) en una página de mentira: un documento con cabeza, sin iframes, y relojes a mano. */
function correrPuente(o) {
  o = Object.assign({ origen: PORTAL.slice(0, -1), arriba: true, bolsa: BOLSA, edadMs: 1000 }, o);
  const al = almacenLocal(o.bolsa ? { bolsaParaCotizar: { data: o.bolsa, createdAt: Date.now() - o.edadMs } } : {});
  const hijos = [], pendientes = [], mensajes = [];
  const cabeza = { appendChild: (e) => { hijos.push(e); } };
  const sandbox = {
    console, JSON, Date, location: { origin: o.origen },
    document: {
      readyState: 'complete', head: cabeza, documentElement: cabeza, defaultView: {}, addEventListener() {},
      getElementById: (id) => hijos.find((e) => e.id === id) || null,
      createElement: () => ({ remove() { const i = hijos.indexOf(this); if (i > -1) hijos.splice(i, 1); } }),
      querySelectorAll: () => []
    },
    setTimeout: (f) => { pendientes.push(f); return pendientes.length; },
    postMessage: (m) => { mensajes.push(m); },
    chrome: { runtime: { lastError: null }, storage: { local: al.api } }
  };
  sandbox.window = sandbox;
  sandbox.top = o.arriba ? sandbox : {};
  vm.createContext(sandbox);
  vm.runInContext(leer('bridge.js'), sandbox, { filename: 'bridge.js' });
  return { almacen: al.datos, hijos, pendientes, mensajes };
}

/* El lector de promociones (campana-puente.js) en una página con el elemento del Portal puesto. */
function correrCampana(origen) {
  const enviados = [];
  const paquete = JSON.stringify({ v: 1, generado: Date.now(), fuerte: null, promos: [] });
  const sandbox = {
    console, location: { origin: origen, hostname: origen.replace(/^https?:\/\//, '').replace(/:\d+$/, '') },
    document: { getElementById: (id) => (id === 'ventel-promos-datos' ? { textContent: paquete } : null), querySelectorAll: () => [] },
    setTimeout: () => 0,
    chrome: { runtime: { lastError: null, sendMessage: (m, cb) => { enviados.push(m); if (cb) cb({ ok: true }); } } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(leer('campana-puente.js'), sandbox, { filename: 'campana-puente.js' });
  return { enviados, paquete };
}

(async () => {
  seccion('0 · Los archivos de la extensión cargan');
  ['bridge.js', 'campana-puente.js', 'fondo.js', 'popup.js', 'cart-cotizar-button.js'].forEach((f) => {
    let error = null;
    try { new vm.Script(leer(f), { filename: f }); } catch (e) { error = e.message; }
    ok(f + ' tiene sintaxis válida', !error, error);
  });

  seccion('1 · Manifiesto: el host nuevo en los dos puentes y en host_permissions, y nada más');
  {
    const man = JSON.parse(leer('manifest.json'));
    const NUEVO = 'https://ventel.logidma.com/*', VIEJO = 'https://*.googleusercontent.com/*';
    const de = (js) => man.content_scripts.find((c) => c.js.indexOf(js) > -1) || { matches: [], js: [] };
    ok('versión 3.1', man.version === '3.1', man.version);
    ok('la descripción dice que funciona con el Portal en Cloudflare', /Portal[^.]*Cloudflare[^.]*ventel\.logidma\.com/.test(man.description), man.description.slice(-220));
    ok('bridge.js corre en el host nuevo y sigue en googleusercontent (el Portal de Apps Script)', de('bridge.js').matches.indexOf(NUEVO) > -1 && de('bridge.js').matches.indexOf(VIEJO) > -1, de('bridge.js').matches);
    ok('campana-puente.js, igual', de('campana-puente.js').matches.indexOf(NUEVO) > -1 && de('campana-puente.js').matches.indexOf(VIEJO) > -1, de('campana-puente.js').matches);
    ok('bridge.js sigue en document_start y en todos los marcos (el Portal de Apps Script los necesita)', de('bridge.js').run_at === 'document_start' && de('bridge.js').all_frames === true, de('bridge.js'));
    ok('campana-puente.js sigue en document_idle y en todos los marcos', de('campana-puente.js').run_at === 'document_idle' && de('campana-puente.js').all_frames === true, de('campana-puente.js'));
    ok('host_permissions suma el host nuevo (fondo.js lo necesita para ver sender.tab.url) y conserva los anteriores',
      JSON.stringify(man.host_permissions) === JSON.stringify(['*://*.liverpool.com.mx/*', 'https://script.google.com/*', NUEVO]), man.host_permissions);
    ok('ningún permiso nuevo fuera de ese host', JSON.stringify(man.permissions) === JSON.stringify(['activeTab', 'scripting', 'storage']), man.permissions);
    const conNuevo = man.content_scripts.filter((c) => c.matches.indexOf(NUEVO) > -1).map((c) => c.js.join(','));
    ok('el host nuevo está en esos dos puentes y en ningún otro content script (ni la tarjeta ni el botón de la bolsa)', JSON.stringify(conNuevo) === JSON.stringify(['bridge.js', 'campana-puente.js']), conNuevo);
  }

  seccion('2 · «Guardar enlace»: qué direcciones acepta el popup');
  {
    const p = crearPopup();
    await esperar();
    const norm = (v) => p.ctx.normalizarUrlCotizador(v);
    [
      PORTAL, 'https://ventel.logidma.com', 'https://ventel.logidma.com/?page=cotizacion', 'https://ventel.logidma.com/?page=portal&origen=extension',
      'https://ventel.logidma.com?page=login', '  https://ventel.logidma.com/  ', 'HTTPS://VENTEL.LOGIDMA.COM/', 'https://ventel.logidma.com:443/',
      'https://ventel.logidma.com/#inicio', 'https://ventel.logidma.com/algo/mas?x=1'
    ].forEach((v) => { const r = norm(v); ok('acepta «' + v.trim() + '» y la guarda como la raíz', r.ok === true && r.url === PORTAL, r); });

    const rechaza = (v, patron, porque) => { const r = norm(v); ok('rechaza ' + porque + ' («' + v + '»)', r.ok === false && !r.url && patron.test(r.message), r); };
    rechaza('http://ventel.logidma.com', /https:\/\//, 'http');
    rechaza('http://ventel.logidma.com/?page=portal', /https:\/\//, 'http, con ?page=');
    rechaza('https://otro.com/?x=ventel.logidma.com', /Portal/, 'otro dominio que lo nombra en la consulta');
    rechaza('https://otro.com/ventel.logidma.com/', /Portal/, 'otro dominio que lo nombra en la ruta');
    rechaza('https://ventel.logidma.com.evil.mx/', /Portal/, 'un dominio que empieza igual');
    rechaza('https://ventel.logidma.com@evil.mx/', /Portal/, 'usuario@: el host real es otro');
    rechaza('https://www.ventel.logidma.com/', /Portal/, 'un subdominio');
    rechaza('https://logidma.com/', /Portal/, 'el dominio padre');
    rechaza('https://ventel.logidma.com:8443/', /Portal/, 'un puerto que no es el de https');
    rechaza(DEV, /\/dev/, 'la URL /dev de Apps Script');
    rechaza('https://script.google.com/macros/s/' + PROD + '/', /\/exec/, 'una de Apps Script que no termina en /exec');
    rechaza('https://script.google.com.evil.mx/macros/s/' + PROD + '/exec', /Portal/, 'un dominio que imita a script.google.com');
    rechaza('https://otro.com/?x=script.google.com', /Portal/, 'otro dominio que nombra script.google.com');
    rechaza('ventel.logidma.com', /válida/, 'una dirección sin https://');
    rechaza('javascript:alert(1)', /https:\/\//, 'javascript:');
    rechaza('', /Escribe/, 'un campo vacío');

    const r = norm(EXEC_PROD + '?page=portal');
    ok('el /exec de Apps Script sigue valiendo (se guarda sin ?page=)', r.ok === true && r.url === EXEC_PROD, r);

    const html = leer('popup.html');
    ok('el panel propone el Portal en el placeholder', /id="inpCotizadorUrl"[^>]*placeholder="https:\/\/ventel\.logidma\.com\/"/.test(html.replace(/\s+/g, ' ')));
    const ayuda = (html.match(/<p class="ayuda">([\s\S]*?)<\/p>/) || [])[1] || '';
    ok('el texto de ayuda nombra el Portal primero y el /exec después', ayuda.indexOf('https://ventel.logidma.com/') > -1 && ayuda.indexOf('/exec') > ayuda.indexOf('https://ventel.logidma.com/'), ayuda);

    // Por el botón, como lo hace el asesor: lo guardado queda normalizado y lo rechazado no se guarda.
    p.el('inpCotizadorUrl').value = 'https://ventel.logidma.com/?page=cotizacion';
    p.el('btnConfigSave').manejadores.click();
    ok('«Guardar enlace» con una URL de la barra de direcciones guarda la raíz del Portal', p.almacen.cotizadorUrl === PORTAL && p.el('inpCotizadorUrl').value === PORTAL, p.almacen);
    const q = crearPopup();
    await esperar();
    q.el('inpCotizadorUrl').value = 'http://ventel.logidma.com/';
    q.el('btnConfigSave').manejadores.click();
    ok('«Guardar enlace» con http:// no guarda nada y avisa del error', q.almacen.cotizadorUrl === undefined && /status-error/.test(q.el('status').className), [q.almacen, q.el('status').className]);
    const s = crearPopup({ cotizadorUrl: PORTAL });
    await esperar();
    ok('al abrir el popup, el enlace guardado queda escrito en el panel', s.el('inpCotizadorUrl').value === PORTAL, s.el('inpCotizadorUrl').value);
  }

  seccion('3 · «Cotizar» arma la dirección sobre la raíz del Portal');
  {
    const cotizar = async (guardado) => { const p = crearPopup(guardado); await esperar(); await p.el('btnCotizar').manejadores.click(); return p; };
    let p = await cotizar({ cotizadorUrl: PORTAL });
    ok('con el Portal guardado: ' + COTIZACION, p.pestanas.length === 1 && p.pestanas[0].url === COTIZACION, p.pestanas);
    ok('…sin «//?page» ni «exec?page»', !/\/\/\?page|exec\?page/.test(p.pestanas[0].url.replace('https://', '')), p.pestanas[0].url);
    ok('…y la bolsa queda esperando al puente, con la copia al portapapeles de respaldo', p.almacen.bolsaParaCotizar && p.almacen.bolsaParaCotizar.data.products.length === 1 && p.portapapeles.length === 1, p.almacen);
    p = await cotizar({});
    ok('sin enlace guardado, «Cotizar» va al Portal (ya no pide guardar uno primero)', p.pestanas.length === 1 && p.pestanas[0].url === COTIZACION, p.pestanas);
    p = await cotizar({ cotizadorUrl: EXEC_PROD });
    ok('con el /exec de Apps Script guardado, sigue yendo al Portal viejo', p.pestanas.length === 1 && p.pestanas[0].url === EXEC_PROD + '?page=cotizacion&origen=extension', p.pestanas);
    p = await cotizar({ cotizadorUrl: 'https://ventel.logidma.com' });
    ok('una base sin barra final (escrita a mano) sale igual', p.pestanas[0].url === COTIZACION, p.pestanas);
    p = await cotizar({ cotizadorUrl: 'https://ventel.logidma.com/?page=portal' });
    ok('una base con otro ?page= (escrita a mano) se pisa con page=cotizacion', p.pestanas[0].url === COTIZACION, p.pestanas);
  }

  seccion('4 · El botón incrustado en la bolsa: el Portal es el respaldo');
  {
    ok('la dirección por omisión es el Portal; ya no queda el /exec de producción', /URL_COTIZADOR_POR_DEFECTO\s*=\s*'https:\/\/ventel\.logidma\.com\/'/.test(leer('cart-cotizar-button.js')) && !/AKfycb|script\.google\.com/.test(leer('cart-cotizar-button.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
    let r = await pulsarBotonDeLaBolsa({});
    ok('sin enlace guardado abre ' + COTIZACION, r.abiertas.length === 1 && r.abiertas[0] === COTIZACION, r.abiertas);
    ok('…y deja la bolsa en el almacenamiento para el puente', r.almacen.bolsaParaCotizar && r.almacen.bolsaParaCotizar.data.products.length === 1, r.almacen);
    r = await pulsarBotonDeLaBolsa({ cotizadorUrl: PORTAL });
    ok('con el Portal guardado, lo mismo', r.abiertas[0] === COTIZACION, r.abiertas);
    r = await pulsarBotonDeLaBolsa({ cotizadorUrl: EXEC_PROD });
    ok('con el /exec guardado manda el que guardó el asesor', r.abiertas[0] === EXEC_PROD + '?page=cotizacion&origen=extension', r.abiertas);
    r = await pulsarBotonDeLaBolsa({ cotizadorUrl: 'esto no es una dirección' });
    ok('con un valor guardado que no es URL cae al respaldo, sin «//?page»', r.abiertas[0] === COTIZACION, r.abiertas);
  }

  seccion('5 · El fondo (fondo.js): de dónde acepta promociones');
  {
    const AH = Date.now();
    const crudo = { v: 1, generado: AH, fuerte: { d: 'Mujer', c: 'Bolsas', t: 'Hasta 58%', p: 58, m: 0, f: AH + 86400000 },
      promos: [{ d: 'x'.repeat(300), c: 'Bolsas', t: 'Hasta 58%', p: 58, m: 99, f: 'nada', k: 'otra', sobra: 1 }, null, { d: '', c: '', t: '' }] };
    const datos = JSON.stringify(crudo);
    const sender = (url, tab, extra) => Object.assign({ id: 'EXT', url: url, tab: tab === undefined ? undefined : { url: tab } }, extra);
    const MARCO = 'https://n-abc-0lu-script.googleusercontent.com/userCodeAppPanel';
    const F = crearFondo();
    const prueba = async (nombre, s, esperado, guardado) => {
      delete F.almacen.ventelPromos;
      if (guardado === undefined) delete F.almacen.cotizadorUrl; else F.almacen.cotizadorUrl = guardado;
      const r = await F.mandar(s, datos);
      const id = F.almacen.ventelPromos && F.almacen.ventelPromos.despliegue;
      if (esperado) ok(nombre, r.ok === true && r.guardado === true && id === esperado, [r, id]);
      else ok(nombre, r.ok === false && r.motivo === 'origen' && !F.almacen.ventelPromos, r);
    };

    await prueba('el Portal en Cloudflare: marco y pestaña son https://ventel.logidma.com → se guarda (despliegue «cloudflare»)', sender(PORTAL + '?page=portal', PORTAL + '?page=portal'), 'cloudflare');
    await prueba('…en cualquier pantalla (?page=cotizacion&origen=extension)', sender(PORTAL, COTIZACION), 'cloudflare');
    await prueba('…con la raíz sin barra final', sender('https://ventel.logidma.com', 'https://ventel.logidma.com'), 'cloudflare');
    await prueba('…y con solo `origin` (sin `url`)', { id: 'EXT', origin: 'https://ventel.logidma.com', tab: { url: PORTAL + '?page=portal' } }, 'cloudflare');
    await prueba('…aunque el asesor tenga guardado el /exec viejo', sender(PORTAL, PORTAL), 'cloudflare', EXEC_PROD);

    await prueba('rechaza: marco del Portal dentro de una pestaña de otro sitio', sender(PORTAL, 'https://otro.com/'), null);
    await prueba('rechaza: marco de otro sitio dentro de una pestaña del Portal', sender('https://otro.com/', PORTAL), null);
    await prueba('rechaza: http en vez de https', sender('http://ventel.logidma.com/', 'http://ventel.logidma.com/'), null);
    await prueba('rechaza: un dominio que empieza igual', sender('https://ventel.logidma.com.evil.mx/', 'https://ventel.logidma.com.evil.mx/'), null);
    await prueba('rechaza: el Portal nombrado dentro de la ruta de otro sitio', sender('https://evil.mx/https://ventel.logidma.com/', 'https://evil.mx/https://ventel.logidma.com/'), null);
    await prueba('rechaza: usuario@ (el host real es otro)', sender('https://ventel.logidma.com@evil.mx/', 'https://ventel.logidma.com@evil.mx/'), null);
    await prueba('rechaza: un subdominio', sender('https://www.ventel.logidma.com/', 'https://www.ventel.logidma.com/'), null);
    await prueba('rechaza: otro puerto', sender('https://ventel.logidma.com:8443/', 'https://ventel.logidma.com:8443/'), null);
    await prueba('rechaza: sin URL de pestaña (sin el permiso del host)', sender(PORTAL, undefined), null);
    await prueba('rechaza: sin nada de dónde sacar el origen', { id: 'EXT' }, null);
    await prueba('rechaza: otra extensión', Object.assign(sender(PORTAL, PORTAL), { id: 'OTRA' }), null);
    await prueba('rechaza: un marco de Apps Script dentro de una pestaña del Portal nuevo', sender(MARCO, PORTAL), null);

    await prueba('el origen que el asesor guardó en el popup, si coincide exacto con marco y pestaña: se guarda', sender('https://ventel-pruebas.workers.dev/?page=portal', 'https://ventel-pruebas.workers.dev/?page=portal'),
      'https://ventel-pruebas.workers.dev', 'https://ventel-pruebas.workers.dev/');
    await prueba('…si la pestaña es de otro origen: no', sender('https://otro.workers.dev/', 'https://otro.workers.dev/'), null, 'https://ventel-pruebas.workers.dev/');
    await prueba('…si el marco no es el de la pestaña: no', sender('https://ventel-pruebas.workers.dev/', PORTAL), null, 'https://ventel-pruebas.workers.dev/');
    await prueba('…si el asesor no lo guardó: no', sender('https://ventel-pruebas.workers.dev/', 'https://ventel-pruebas.workers.dev/'), null);
    await prueba('…si lo guardado es http: no, aunque coincida', sender('http://ventel-pruebas.workers.dev/', 'http://ventel-pruebas.workers.dev/'), null, 'http://ventel-pruebas.workers.dev/');
    await prueba('…el origen de script.google.com es de TODAS las webapps: guardarlo no basta', sender('https://script.google.com/macros/s/AKfycbOTRA/exec', 'https://script.google.com/macros/s/AKfycbOTRA/exec'), null, EXEC_PROD);
    await prueba('…ni el de googleusercontent', sender('https://n-abc-0lu-script.googleusercontent.com/x', 'https://n-abc-0lu-script.googleusercontent.com/x'), null, 'https://n-abc-0lu-script.googleusercontent.com/x');

    await prueba('Apps Script sigue igual: marco de googleusercontent dentro del /exec de producción → se guarda con su despliegue', sender(MARCO, EXEC_PROD), PROD);
    await prueba('…y dentro del /exec que el asesor configuró en el popup', sender(MARCO, 'https://script.google.com/a/macros/liverpool.com.mx/s/AKfycbMIO/exec'), 'AKfycbMIO', 'https://script.google.com/a/macros/liverpool.com.mx/s/AKfycbMIO/exec');
    await prueba('…y no dentro de otra webapp', sender(MARCO, 'https://script.google.com/macros/s/AKfycbOTRA/exec'), null);

    delete F.almacen.ventelPromos;
    const limpio = (await F.mandar(sender(PORTAL, PORTAL), datos)) && F.almacen.ventelPromos;
    ok('el saneado es el de siempre: textos recortados, meses acotados, fin inválido a null, campos de más fuera',
      limpio && limpio.promos.length === 1 && limpio.promos[0].d.length === 60 && limpio.promos[0].m === 48 && limpio.promos[0].f === null && limpio.promos[0].k === '' && !('sobra' in limpio.promos[0]), limpio);
    delete F.almacen.ventelPromos;
    const mal = await F.mandar(sender(PORTAL, PORTAL), JSON.stringify(Object.assign({}, crudo, { v: 2 })));
    ok('…y desde el Portal también rechaza otra versión y lo que no es JSON', mal.ok === false && mal.motivo === 'forma' && (await F.mandar(sender(PORTAL, PORTAL), '<html>login</html>')).motivo === 'forma' && !F.almacen.ventelPromos, mal);
  }

  seccion('6 · El puente de la bolsa (bridge.js) en la página de arriba del Portal');
  {
    let b = correrPuente();
    ok('con una bolsa vigente, la escribe en el propio documento (no hay iframes que buscar)', b.hijos.length === 1 && b.hijos[0].id === 'ventel-bolsa-datos' && b.hijos[0].type === 'application/json', b.hijos.length);
    ok('…es la bolsa tal cual, que es lo que lee cotizacion.html', b.hijos[0] && JSON.stringify(JSON.parse(b.hijos[0].textContent)) === JSON.stringify(BOLSA));
    ok('…y ya no está en el almacenamiento: una bolsa se cotiza una vez (se borra antes de escribirla)', b.almacen.bolsaParaCotizar === undefined, b.almacen);
    ok('nunca habla primero ni después: ni un postMessage a la página', b.mensajes.length === 0, b.mensajes);
    b.pendientes.shift()();
    ok('mientras nadie la lea, la vuelve a mirar sin duplicarla', b.hijos.length === 1 && b.pendientes.length === 1, [b.hijos.length, b.pendientes.length]);
    b.hijos.length = 0;   // la pantalla la leyó y retiró el elemento
    b.pendientes.shift()();
    ok('cuando la pantalla la consume, deja de insistir y no la reescribe', b.hijos.length === 0 && b.pendientes.length === 0, [b.hijos.length, b.pendientes.length]);

    b = correrPuente({ edadMs: 20 * 60 * 1000 });
    ok('una bolsa de hace 20 minutos no se entrega, y se tira', b.hijos.length === 0 && b.almacen.bolsaParaCotizar === undefined, [b.hijos.length, b.almacen]);
    b = correrPuente({ bolsa: null });
    ok('sin bolsa no escribe nada', b.hijos.length === 0 && b.mensajes.length === 0);

    b = correrPuente({ origen: 'https://n-abc-0lu-script.googleusercontent.com', arriba: false });
    ok('en Apps Script todo sigue como antes: el marco (que no es el de arriba) entrega la bolsa', b.hijos.length === 1 && b.almacen.bolsaParaCotizar === undefined && b.mensajes.length === 0, [b.hijos.length, b.almacen]);
  }

  seccion('7 · El lector de promociones (campana-puente.js): dónde corre');
  {
    let c = correrCampana('https://ventel.logidma.com');
    ok('en el Portal en Cloudflare lee el elemento y lo manda tal cual al fondo', c.enviados.length === 1 && c.enviados[0].tipo === 'ventel-promos' && c.enviados[0].datos === c.paquete, c.enviados);
    c = correrCampana('https://n-abc-0lu-script.googleusercontent.com');
    ok('en un marco de Apps Script sigue igual', c.enviados.length === 1 && c.enviados[0].tipo === 'ventel-promos', c.enviados);
    [
      ['https://drive.googleusercontent.com', 'un marco de googleusercontent que no es de Apps Script'],
      ['https://ventel.logidma.com.evil.mx', 'un dominio que empieza igual'],
      ['https://otro.logidma.com', 'otro subdominio de logidma.com'],
      ['https://www.ventel.logidma.com', 'un subdominio del Portal'],
      ['https://logidma.com', 'el dominio padre'],
      ['http://ventel.logidma.com', 'el Portal por http'],
      ['https://ventel.logidma.com:8443', 'el Portal en otro puerto']
    ].forEach(([origen, que]) => { c = correrCampana(origen); ok('no corre en ' + que + ' (' + origen + ')', c.enviados.length === 0, c.enviados); });
  }

  console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.log('✖ la prueba reventó: ' + (e && e.stack || e)); process.exit(1); });
