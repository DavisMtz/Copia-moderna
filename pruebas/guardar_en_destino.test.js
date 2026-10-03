/*
 * «Ir a Vista Previa» navega en el clic y la vista previa guarda al llegar (03/10/2026).
 *   node pruebas/guardar_en_destino.test.js
 *
 * Por qué existe: una webapp de Apps Script solo puede cambiar de pantalla mientras dura la
 * activación del clic (~5 s; el iframe de Google trae allow-top-navigation-by-user-activation).
 * Guardar la cotización tarda más que eso casi siempre, así que guardar primero y navegar
 * después dejaba al asesor con el aviso de «toca aquí para seguir». Ahora:
 *   cotizacion.html     VistaPreviaPendiente.dejar → AppCache 'vp-pendiente-<ficha>' y navega
 *                       a ?page=cotizado_preview&guardar=<ficha> en el mismo clic;
 *   cotizado_preview    GuardadoPendiente guarda con la ficha, cambia la ficha por el folio en
 *                       la dirección y pinta con los datos que ya tiene;
 *   Code.gs             saveQuoteAndGoToPreview apunta qué folio salió de cada ficha
 *                       (cotReciboLeer_/cotReciboApuntar_): repetirla no da otro folio.
 *
 * Se ejecuta el código REAL (la AppCache de app_core, los dos módulos y la función del
 * servidor) con dobles mínimos de lo que hay alrededor. Esta carpeta queda fuera de
 * "Carpeta del proyecto": clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');
const leerArchivo = (f) => fs.readFileSync(path.join(PROY, f), 'utf8').replace(/\r\n/g, '\n');
const core = leerArchivo('app_core.html');
const cot = leerArchivo('cotizacion.html');
const prev = leerArchivo('cotizado_preview.html');
const code = leerArchivo('Code.gs');
const seg = leerArchivo('Seguridad.gs');
const index = leerArchivo('Index.html');

let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

/* Índice de la llave que cierra la primera `{` desde `i` (salta cadenas y comentarios). */
function cierre(texto, i) {
  let d = 0, q = null;
  for (let j = texto.indexOf('{', i); j > -1 && j < texto.length; j++) {
    const c = texto[j], s = texto[j + 1];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && s === '/') { j = texto.indexOf('\n', j); continue; }
    if (c === '/' && s === '*') { j = texto.indexOf('*/', j + 2) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++;
    if (c === '}' && --d === 0) return j;
  }
  return -1;
}
function funcion(nombre, texto) {
  const i = texto.indexOf('function ' + nombre + '(');
  return i < 0 ? '' : texto.slice(i, cierre(texto, i) + 1);
}
/* `const Nombre = (function () { … })();` entero. */
function modulo(nombre, texto) {
  const i = texto.indexOf('const ' + nombre + ' = (function () {');
  if (i < 0) return '';
  const fin = cierre(texto, i);
  return texto.slice(i, texto.indexOf(';', fin) + 1);
}
const lista = (src, re) => {
  const m = src.match(re);
  return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
};

/* localStorage de mentira. `modo`: 'ok' | 'lleno' (la prueba pasa, las escrituras no) | 'bloqueado'. */
function almacen(modo) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key(i) { const k = Array.from(m.keys())[i]; return k === undefined ? null : k; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      if (modo === 'bloqueado') throw new Error('SecurityError');
      if (modo === 'lleno' && !/_probe$/.test(k)) throw new Error('QuotaExceededError');
      m.set(k, String(v));
    },
    removeItem(k) { m.delete(k); },
    _m: m
  };
}

/* La AppCache REAL de app_core sobre un almacén de mentira. */
const fuenteCache = [/const CACHE_PREFIX = [^;]*;/, /const CACHE_SCHEMA = [^;]*;/, /const CACHE_MAX_AGE_MS = [^;]*;/]
  .map((re) => (core.match(re) || [''])[0]).join('\n') + '\n' + funcion('createStore', core);
function contexto(modo, extra) {
  const ctx = Object.assign({ console: { log() {}, warn() {}, error() {} }, JSON, Date, Math, Promise, Object, Array, String, Number, Uint8Array, crypto: webcrypto }, extra || {});
  ctx.localStorage = almacen(modo);
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fuenteCache + '\nvar AppCache = createStore(function () { return localStorage; });', ctx);
  return ctx;
}
const espera = () => new Promise((r) => setImmediate(r));

console.log('\nA · El contrato entre las dos pantallas y el servidor');
{
  ok('cotizacion.html tiene el módulo que deja la cotización', modulo('VistaPreviaPendiente', cot).length > 0);
  ok('cotizado_preview.html tiene el que la guarda al llegar', modulo('GuardadoPendiente', prev).length > 0);
  const pre = (t) => (t.match(/const PREFIJO = '([^']+)'/) || [])[1];
  ok('las dos usan la misma llave de AppCache', pre(modulo('VistaPreviaPendiente', cot)) === 'vp-pendiente-' &&
    pre(modulo('GuardadoPendiente', prev)) === 'vp-pendiente-', [pre(modulo('VistaPreviaPendiente', cot)), pre(modulo('GuardadoPendiente', prev))]);
  ok('`guardar` está en PARAMS_VISTA de Code.gs y de app_core (si no, no llega a la pantalla)',
    lista(code, /const PARAMS_VISTA = \[([^\]]*)\]/).includes('guardar') && lista(core, /const PARAMS_VISTA = \[([^\]]*)\]/).includes('guardar'));
  ok('…y PASAN del Index sigue sin inventar nada que el servidor no inyecte',
    lista(index, /const PASAN = \[([^\]]*)\]/).every((k) => lista(code, /const PARAMS_VISTA = \[([^\]]*)\]/).includes(k)));

  // El orden del clic es TODO el arreglo: navegar antes de hablar con el servidor.
  const i = (s) => cot.indexOf(s);
  const dejar = i('const fichaPendiente = VistaPreviaPendiente.dejar(quoteData);');
  const volcar = cot.indexOf('Borrador.volcar();', dejar);
  const navegar = i("navigateToPage('cotizado_preview', { guardar: fichaPendiente });");
  const servidor = i("AppRun.call('saveQuoteAndGoToPreview', [quoteData]");
  ok('«Ir a Vista Previa»: deja la copia → vuelca el borrador → navega, y solo DESPUÉS el respaldo que guarda aquí',
    dejar > -1 && dejar < volcar && volcar < navegar && navegar < servidor, { dejar, volcar, navegar, servidor });
  const trozo = cot.slice(navegar, servidor);
  ok('…y tras navegar sale del manejador (no guarda también aquí)', /navigateToPage\('cotizado_preview', \{ guardar: fichaPendiente \}\);\s*return;/.test(trozo));

  // En la vista previa: la ficha manda sobre el folio, y sin copia NO se cae a la caché genérica.
  const arranque = prev.slice(prev.indexOf("document.addEventListener('DOMContentLoaded'"));
  const p1 = arranque.indexOf('if (pendiente) {');
  const p2 = arranque.indexOf('} else if (folioFromUrl) {');
  const p3 = arranque.indexOf('} else if (fichaPendiente) {');
  // La caché genérica (sin folio): la rama del folio también la nombra, por eso la línea entera.
  const p4 = arranque.indexOf("const storedData = localStorage.getItem('pendingQuoteData');");
  ok('vista previa: copia pendiente → folio → ficha perdida → caché genérica, en ese orden',
    p1 > -1 && p1 < p2 && p2 < p3 && p3 < p4, { p1, p2, p3, p4 });
  ok('la ficha se lee de la dirección (AppUrl.param)', /const fichaPendiente = AppUrl\.param\('guardar'\);/.test(arranque));
}

console.log('\nB · cotizacion.html: VistaPreviaPendiente.dejar');
{
  const cargar = (modo) => {
    const ctx = contexto(modo);
    vm.runInContext('var currentUserEmail = "Asesor@Liverpool.com.mx";\n' + modulo('VistaPreviaPendiente', cot) + '\nthis.VPP = VistaPreviaPendiente;', ctx);
    return ctx;
  };
  const q = (n) => ({ folio: null, clientName: 'Cliente ' + n, products: [{ sku: '1', quantity: 1, unitPrice: 10 }] });

  const ctx = cargar('ok');
  const f1 = ctx.VPP.dejar(q(1));
  ok('devuelve una ficha de 32 hexadecimales', /^[a-f0-9]{32}$/.test(f1), f1);
  const e = ctx.AppCache.get('vp-pendiente-' + f1);
  ok('la deja en AppCache con correo (en minúsculas), firma y cotización',
    !!(e && e.data && e.data.email === 'asesor@liverpool.com.mx' && e.data.firma === JSON.stringify(q(1)) && e.data.quote.clientName === 'Cliente 1'));
  ok('…de verdad en disco (localStorage), no solo en memoria', ctx.localStorage.getItem('ventel-cache-vp-pendiente-' + f1) !== null);
  ok('la MISMA cotización otra vez reutiliza la ficha (atrás a mitad del guardado, doble clic)', ctx.VPP.dejar(q(1)) === f1);
  const f2 = ctx.VPP.dejar(q(2));
  ok('otra cotización recibe otra ficha', /^[a-f0-9]{32}$/.test(f2) && f2 !== f1);
  vm.runInContext('currentUserEmail = "otro@liverpool.com.mx";', ctx);
  ok('la misma cotización con OTRA cuenta no hereda la ficha', ctx.VPP.dejar(q(1)) !== f1);
  vm.runInContext('currentUserEmail = "asesor@liverpool.com.mx";', ctx);
  for (let n = 3; n <= 9; n++) ctx.VPP.dejar(q(n));
  ok('nunca guarda más de 4 copias pendientes', ctx.AppCache.keys('vp-pendiente-').length === 4, ctx.AppCache.keys('vp-pendiente-').length);

  const lleno = cargar('lleno');
  ok('almacenamiento lleno → devuelve "" (se guarda en la cotización, como antes)', lleno.VPP.dejar(q(1)) === '');
  ok('…y no deja la copia viviendo solo en memoria', lleno.AppCache.keys('vp-pendiente-').length === 0);
  ok('almacenamiento bloqueado → también ""', cargar('bloqueado').VPP.dejar(q(1)) === '');
}

console.log('\nC · cotizado_preview.html: GuardadoPendiente');
/* La vista previa con dobles: botones, área de mensajes, escena, servidor y dirección. */
function preparaVistaPrevia(opciones) {
  const els = {};
  const nodo = (id) => {
    const clases = new Set();
    return {
      id, disabled: false, textContent: '', children: [], style: {}, className: '', _on: {},
      classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c) },
      appendChild(n) { this.children.push(n); },
      addEventListener(t, f) { this._on[t] = f; }
    };
  };
  const doc = {
    getElementById: (id) => (els[id] = els[id] || nodo(id)),
    createElement: () => nodo('')
  };
  const registro = { llamadas: [], reflejos: [], mensajes: [], pintados: [], navegaciones: [], escenas: [] };
  const ctx = contexto('ok', {
    document: doc,
    AppSession: { userEmail: 'asesor@liverpool.com.mx' },
    AppUrl: { reflejar: (p, o) => { registro.reflejos.push([p, o]); return true; } },
    AppRun: {
      call: (fn, args, opts) => new Promise((resolve, reject) => registro.llamadas.push({ fn, args, opts, resolve, reject }))
    },
    VentelFX: { section: (t, tema, o) => { registro.escenas.push(o.title); registro.subtitulos = (registro.subtitulos || []).concat(o.sub); return { done: (cb) => { if (cb) cb(); } }; } },
    apagarArranque: () => {},
    safeRenderPreview: (d) => registro.pintados.push(d),
    navigateToPage: (page, params) => registro.navegaciones.push([page, params]),
    showPreviewMessage: (texto, error) => {
      const area = doc.getElementById('preview-message-area');
      area.textContent = texto; area.children = [];   // como el de verdad: el texto pisa lo que hubiera
      registro.mensajes.push([texto, !!error]);
    }
  });
  vm.runInContext('var quoteDataForSave = null; var currentFolioForPreview = null;\n' +
    modulo('GuardadoPendiente', prev) + '\nthis.GP = GuardadoPendiente;', ctx);
  const quote = Object.assign({ folio: null, clientName: 'Cliente', products: [{ sku: '1' }], format: 'ccl_liverpool' }, opciones && opciones.quote);
  const ficha = 'ab'.repeat(16);
  ctx.AppCache.set('vp-pendiente-' + ficha, { email: (opciones && opciones.email) || 'asesor@liverpool.com.mx', firma: JSON.stringify(quote), quote });
  const claveBorrador = 'borrador-cot-' + (quote.folio || 'nuevo');
  ctx.AppCache.set(claveBorrador, { email: 'asesor@liverpool.com.mx', folio: quote.folio || '', quote: (opciones && opciones.borrador) || quote });
  ctx.AppCache.set('quotes-asesor', { lista: [] });
  return { ctx, doc, registro, ficha, quote, claveBorrador };
}
const botones = (doc) => ['edit-quote-button', 'download-pdf-button', 'send-by-email-button'].map((id) => doc.getElementById(id).disabled);

(async () => {
  {
    const { ctx, doc, registro, ficha, quote, claveBorrador } = preparaVistaPrevia();
    const p = ctx.GP.leer(ficha);
    ok('lee la copia que dejó la cotización', !!(p && p.quote && p.quote.clientName === 'Cliente'));
    ctx.GP.guardar(ficha, p);
    const ll = registro.llamadas[0];
    ok('guarda con saveQuoteAndGoToPreview mandando la ficha DENTRO de los datos',
      !!ll && ll.fn === 'saveQuoteAndGoToPreview' && ll.args[0].ficha === ficha && ll.args[0].clientName === 'Cliente');
    ok('…sin el disco de la esquina (la escena ya cuenta la espera) y con clave propia de deduplicación',
      ll.opts.busy === false && ll.opts.key === 'vp-guardar:' + ficha);
    ok('la escena dice lo que pasa', registro.escenas[0] === 'Guardando tu cotización…' &&
      (registro.subtitulos || [])[0] === 'Generando el folio', [registro.escenas, registro.subtitulos]);
    ok('Editar, PDF y Enviar quietos mientras no hay folio', botones(doc).every(Boolean));
    ok('la copia NO se suelta antes de que el servidor confirme', !!ctx.AppCache.get('vp-pendiente-' + ficha));

    ll.resolve({ success: true, folio: 'LVP-261003-0007', format: 'ccl_liverpool' });
    await espera();
    ok('la dirección cambia la ficha por el folio, sin apilar historial',
      JSON.stringify(registro.reflejos[0]) === JSON.stringify([{ guardar: '', folio: 'LVP-261003-0007' }, { apilar: true }]), registro.reflejos);
    ok('pinta UNA vez, con los datos que ya tenía y el folio nuevo',
      registro.pintados.length === 1 && registro.pintados[0].folio === 'LVP-261003-0007' && registro.pintados[0].clientName === 'Cliente');
    ok('el estado de la pantalla queda con el folio (los botones lo usan)', vm.runInContext('currentFolioForPreview', ctx) === 'LVP-261003-0007');
    ok('suelta la copia pendiente', ctx.AppCache.get('vp-pendiente-' + ficha) === null);
    ok('…y tira el borrador, que es ESTA misma cotización', ctx.AppCache.get(claveBorrador) === null);
    ok('apunta el folio de la ficha para un F5 que llegue antes que la dirección', ctx.GP.folioHecho(ficha) === 'LVP-261003-0007');
    ok('tira las listas guardadas de «mis cotizaciones»', ctx.AppCache.get('quotes-asesor') === null);
    ok('deja la copia rápida de la vista previa para un F5 (pendingQuoteData_<folio>)',
      JSON.parse(ctx.localStorage.getItem('pendingQuoteData_LVP-261003-0007') || '{}').folio === 'LVP-261003-0007');
    ok('reactiva Editar, PDF y Enviar', botones(doc).every((d) => d === false));
    ok('avisa con el folio', /guardada con el folio LVP-261003-0007/.test((registro.mensajes.pop() || [])[0]));
  }
  {
    const { ctx, registro, ficha } = preparaVistaPrevia();
    ctx.GP.guardar(ficha, ctx.GP.leer(ficha));
    registro.llamadas[0].resolve({ success: true, folio: 'LVP-1', repetida: true });
    await espera();
    ok('si el servidor dice que ya estaba guardada, lo dice así', /ya estaba guardada con el folio LVP-1/.test((registro.mensajes.pop() || [])[0]));
  }
  {
    const otra = { folio: null, clientName: 'OTRO cliente (otra pestaña)', products: [] };
    const { ctx, registro, ficha, claveBorrador } = preparaVistaPrevia({ borrador: otra });
    ctx.GP.guardar(ficha, ctx.GP.leer(ficha));
    registro.llamadas[0].resolve({ success: true, folio: 'LVP-2' });
    await espera();
    ok('un borrador que es OTRA cotización se respeta', !!ctx.AppCache.get(claveBorrador));
  }
  {
    const { ctx, doc, registro, ficha, claveBorrador } = preparaVistaPrevia();
    ctx.GP.guardar(ficha, ctx.GP.leer(ficha));
    registro.llamadas[0].resolve({ success: false, message: 'El sistema está ocupado.' });
    await espera();
    ok('si el servidor no guardó, lo dice como error', JSON.stringify(registro.mensajes[0]) === JSON.stringify(['El sistema está ocupado.', true]));
    ok('…y la copia y el borrador siguen a salvo', !!ctx.AppCache.get('vp-pendiente-' + ficha) && !!ctx.AppCache.get(claveBorrador));
    ok('…sin pintar nada ni cambiar la dirección', registro.pintados.length === 0 && registro.reflejos.length === 0);
    const caja = doc.getElementById('preview-message-area').children[0];
    const [reintentar, volver] = caja ? caja.children : [];
    ok('ofrece «Reintentar» y «Volver a la cotización»', !!reintentar && reintentar.textContent === 'Reintentar' && !!volver && volver.textContent === 'Volver a la cotización');
    reintentar._on.click();
    ok('«Reintentar» vuelve a guardar con la MISMA ficha', registro.llamadas.length === 2 && registro.llamadas[1].args[0].ficha === ficha);
    volver._on.click();
    ok('«Volver a la cotización» abre una cotización nueva (el borrador la repone)',
      JSON.stringify(registro.navegaciones[0]) === JSON.stringify(['cotizacion', {}]));
  }
  {
    const { ctx, doc, registro, ficha } = preparaVistaPrevia({ quote: { folio: 'LVP-260901-0003' } });
    ctx.GP.guardar(ficha, ctx.GP.leer(ficha));
    ok('editando un folio, la escena dice que lo actualiza (y una nueva, que genera el folio)',
      (registro.subtitulos || [])[0] === 'Actualizando el folio LVP-260901-0003', registro.subtitulos);
    registro.llamadas[0].reject(new Error('red'));
    await espera();
    ok('sin conexión también lo dice, sin perder nada', /No hay conexión/.test((registro.mensajes[0] || [])[0]) && !!ctx.AppCache.get('vp-pendiente-' + ficha));
    doc.getElementById('preview-message-area').children[0].children[1]._on.click();
    ok('«Volver» en una edición regresa a ESE folio en edición',
      JSON.stringify(registro.navegaciones[0]) === JSON.stringify(['cotizacion', { folio: 'LVP-260901-0003', action: 'edit' }]));
  }
  {
    const { ctx, ficha } = preparaVistaPrevia({ email: 'otro@liverpool.com.mx' });
    ok('la copia de otra cuenta no se usa', ctx.GP.leer(ficha) === null);
    ok('sin ficha no hay nada que leer', ctx.GP.leer('') === null && ctx.GP.folioHecho('') === '');
  }
  {
    const { ctx, doc, registro } = preparaVistaPrevia();
    ctx.GP.perdida();
    ok('ficha sin copia: lo explica y no enseña un documento vacío',
      /No encontramos en este equipo/.test((registro.mensajes[0] || [])[0]) &&
      doc.getElementById('pdf-preview-content').classList.contains('hidden') &&
      doc.getElementById('ccl-preview-content').classList.contains('hidden'));
  }

  console.log('\nD · Code.gs: el recibo de la ficha (nunca dos folios para la misma cotización)');
  {
    const fuente = ['var COT_RECIBO_PREFIJO', 'var COT_RECIBO_SEG']
      .map((v) => (code.match(new RegExp(v + ' = [^;]*;')) || [''])[0]).join('\n') + '\n' +
      ['cotReciboFicha_', 'cotReciboLeer_', 'cotReciboApuntar_', 'saveQuoteAndGoToPreview'].map((n) => funcion(n, code)).join('\n') + '\n' +
      funcion('secNormalizarCorreo_', seg);

    function servidor(opciones) {
      opciones = opciones || {};
      const cache = new Map();
      const s = { guardados: [], soltados: 0, folio: 0, antesDelCandado: null };
      const ctx = {
        JSON, Date, Object, String, Math, Array,
        Logger: { log() {} },
        CacheService: { getScriptCache: () => ({
          get: (k) => { if (opciones.cacheRota) throw new Error('caché caída'); return cache.has(k) ? cache.get(k) : null; },
          put: (k, v) => { if (opciones.cacheRota) throw new Error('caché caída'); cache.set(k, v); }
        }) },
        LockService: { getScriptLock: () => ({
          tryLock: () => { if (s.antesDelCandado) { const f = s.antesDelCandado; s.antesDelCandado = null; f(); } return true; },
          releaseLock: () => { s.soltados++; }
        }) },
        SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({}) }) },
        COTIZACIONES_SHEET_NAME: 'Cotizaciones', REGISTROS_SHEET_NAME: 'Registros', DEFAULT_FORMAT_ID: 'ccl_liverpool',
        REV_ESTATUS_PENDIENTE: 'En Revisión', REV_ESTATUS_APROBADA: 'Aprobada',
        secCorreoEfectivo_: () => 'asesor@liverpool.com.mx',
        getEnabledQuoteFormats: () => ({ formats: [{ id: 'ccl_liverpool' }], defaultId: 'ccl_liverpool' }),
        generateLvpFolio: () => 'LVP-261003-' + String(++s.folio).padStart(4, '0'),
        revpolDecidirAlGuardar_: () => ({ revisar: true, motivo: 'Todo pasa por revisión', origen: '', reglaId: '' }),
        revpolSellarAprobacionAutomatica_: () => {},
        saveQuoteDataToSheets: (q) => { s.guardados.push(JSON.parse(JSON.stringify(q))); }
      };
      vm.createContext(ctx);
      vm.runInContext(fuente + '\nthis.api = { saveQuoteAndGoToPreview, cotReciboApuntar_, cotReciboFicha_ };', ctx);
      return { api: ctx.api, s, cache };
    }
    const datos = (extra) => Object.assign({ advisorEmail: 'asesor@liverpool.com.mx', advisorName: 'Asesor', clientName: 'Cliente', products: [], format: 'ccl_liverpool' }, extra);
    const ficha = 'c0ffee'.padEnd(32, '0');

    {
      const { api, s } = servidor();
      const r1 = api.saveQuoteAndGoToPreview(datos({ ficha }));
      const r2 = api.saveQuoteAndGoToPreview(datos({ ficha }));
      ok('la misma ficha dos veces = UN guardado y el mismo folio', s.guardados.length === 1 && r1.success && r2.success && r1.folio === r2.folio, { r1, r2, n: s.guardados.length });
      ok('la segunda respuesta lo dice (repetida) y la primera no', r2.repetida === true && !r1.repetida);
      ok('la ficha NO llega a la hoja', s.guardados.length === 1 && !('ficha' in s.guardados[0]));
      ok('el candado se soltó (una sola vez: la repetida ni lo tocó)', s.soltados === 1, s.soltados);
    }
    {
      const { api, s } = servidor();
      const r1 = api.saveQuoteAndGoToPreview(datos());
      const r2 = api.saveQuoteAndGoToPreview(datos());
      ok('sin ficha, todo como antes: cada llamada guarda', s.guardados.length === 2 && r1.folio !== r2.folio);
      const r3 = api.saveQuoteAndGoToPreview(datos({ ficha: 'abc' }));
      const r4 = api.saveQuoteAndGoToPreview(datos({ ficha: 'abc' }));
      ok('una ficha mal formada se ignora (no se usa como clave de caché)', s.guardados.length === 4 && r3.folio !== r4.folio);
    }
    {
      const { api, s } = servidor();
      // Otra llamada con la misma ficha termina MIENTRAS esta espera el candado.
      s.antesDelCandado = () => api.cotReciboApuntar_(ficha, 'asesor@liverpool.com.mx', { folio: 'LVP-261003-0099', format: 'ccl_liverpool', requiereRevision: true, motivoRevision: '' });
      const r = api.saveQuoteAndGoToPreview(datos({ ficha }));
      ok('si otra con la misma ficha guardó mientras esta esperaba el candado, contesta su folio y no guarda',
        s.guardados.length === 0 && r.folio === 'LVP-261003-0099' && r.repetida === true, { r, n: s.guardados.length });
      ok('…y suelta el candado igual', s.soltados === 1);
    }
    {
      const { api, s } = servidor();
      api.cotReciboApuntar_(ficha, 'otro@liverpool.com.mx', { folio: 'LVP-AJENO', format: 'x' });
      const r = api.saveQuoteAndGoToPreview(datos({ ficha }));
      ok('el recibo de OTRA cuenta no entrega su folio', s.guardados.length === 1 && r.folio !== 'LVP-AJENO');
    }
    {
      const { api, s } = servidor({ cacheRota: true });
      const r = api.saveQuoteAndGoToPreview(datos({ ficha }));
      ok('con la caché caída se guarda igual (el recibo protege, no es requisito)', r.success === true && s.guardados.length === 1);
    }
    {
      const { api, s } = servidor();
      const r1 = api.saveQuoteAndGoToPreview(datos({ ficha, folio: 'LVP-260901-0003' }));
      const r2 = api.saveQuoteAndGoToPreview(datos({ ficha, folio: 'LVP-260901-0003' }));
      ok('editando un folio: la repetida no lo vuelve a escribir (ni devuelve la revisión al inicio)',
        s.guardados.length === 1 && r1.folio === 'LVP-260901-0003' && r2.folio === 'LVP-260901-0003' && r2.repetida === true);
    }
    ok('la ficha se normaliza (mayúsculas, espacios) antes de usarse', servidor().api.cotReciboFicha_(' ' + ficha.toUpperCase() + ' ') === ficha);
  }

  console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
  process.exit(fallos ? 1 : 0);
})();
