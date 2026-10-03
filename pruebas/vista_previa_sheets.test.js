/*
 * «Ver en Google Sheets» en la barra de la vista previa (03/10/2026).
 *   node pruebas/vista_previa_sheets.test.js
 *
 * Lo pidió el creador: cuando el documento oficial queda listo, arriba —junto a «Enviar por
 * Correo»— aparece «Ver en Google Sheets», que lleva a la hoja como el botón «Sheets» del
 * panel de inicio; mientras se genera, en ese sitio dice «Generando documento…».
 *   Formatos.gs         previewSheetCcl devuelve también `url`, la misma dirección que
 *                       openQuoteInSheets le da al botón del panel de inicio.
 *   cotizado_preview    DocumentoCcl lleva la barra en tres estados (generando, listo,
 *                       oculto) desde los mismos puntos que el panel del documento.
 *
 * Se ejecuta el código REAL (el módulo DocumentoCcl y la función del servidor) con dobles
 * mínimos de lo que hay alrededor. Esta carpeta queda fuera de "Carpeta del proyecto":
 * clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');
const leerArchivo = (f) => fs.readFileSync(path.join(PROY, f), 'utf8').replace(/\r\n/g, '\n');
const prev = leerArchivo('cotizado_preview.html');
const formatos = leerArchivo('Formatos.gs');

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
const espera = () => new Promise((r) => setImmediate(r));

const URL_HOJA = 'https://docs.google.com/spreadsheets/d/ABC123/edit';
const URL_INCRUSTAR = 'https://docs.google.com/spreadsheets/d/ABC123/preview';

console.log('\nA · El marcado: dónde está y cómo nace');
{
  const acciones = prev.slice(prev.indexOf('<div class="actions">'), prev.indexOf('id="pdf-preview-content"'));
  const pos = (id) => acciones.indexOf('id="' + id + '"');
  ok('la espera y el botón viven en la barra de acciones', pos('doc-sheets-espera') > -1 && pos('doc-sheets-abrir') > -1);
  // Después del botón principal: aparecen, cambian de ancho y a veces se van, y así nada
  // de eso mueve «Enviar por Correo» (ni lo baja de fila en una ventana angosta).
  ok('…a la derecha de «Enviar por Correo», al final de la fila',
    pos('download-pdf-button') < pos('send-by-email-button') && pos('send-by-email-button') < pos('doc-sheets-espera') &&
    pos('doc-sheets-espera') < pos('doc-sheets-abrir'),
    ['download-pdf-button', 'send-by-email-button', 'doc-sheets-espera', 'doc-sheets-abrir'].map(pos));
  ok('la fila de acciones va siempre bajo el título (la barra no cambia de alto al aparecer la espera)',
    /\.preview-controls \.actions \{[^}]*flex-basis:\s*100%/.test(prev));

  const tagEspera = (prev.match(/<span id="doc-sheets-espera"[^>]*>/) || [''])[0];
  const tagEnlace = (prev.match(/<a id="doc-sheets-abrir"[^>]*>/) || [''])[0];
  ok('la espera es un aviso de estado (role="status") y nace oculta', /role="status"/.test(tagEspera) && /\shidden[\s>]/.test(tagEspera), tagEspera);
  ok('la espera dice «Generando documento…»', /id="doc-sheets-espera"[\s\S]*?Generando documento…[\s\S]*?<\/span>\s*<\/span>/.test(prev));
  ok('el botón es un enlace que abre pestaña nueva sin dejarle la ventana a Google (noopener)',
    /target="_blank"/.test(tagEnlace) && /rel="[^"]*\bnoopener\b[^"]*"/.test(tagEnlace), tagEnlace);
  ok('…nace oculto y SIN destino (no lleva href hasta que hay hoja)', /\shidden[\s>]/.test(tagEnlace) && !/\bhref=/.test(tagEnlace), tagEnlace);
  ok('…y dice «Ver en Google Sheets», con el ícono del botón «Sheets» del panel de inicio',
    /id="doc-sheets-abrir"[\s\S]*?data-icon="document"[\s\S]*?Ver en Google Sheets[\s\S]*?<\/a>/.test(prev));

  // `hidden` solo gana a `.v-btn{display:inline-flex}` porque [hidden] llega después con el
  // mismo peso: una regla propia con `display` lo taparía y la espera no se iría nunca.
  const reglas = [...prev.matchAll(/([^{}]*doc-sheets[^{}]*)\{([^}]*)\}/g)];
  ok('ninguna regla propia de la barra declara display (el atributo hidden tiene que ganar)',
    reglas.length > 0 && reglas.every((m) => !/(^|[;\s])display\s*:/.test(m[2])), reglas.map((m) => m[1].trim()));
}

console.log('\nB · Formatos.gs: previewSheetCcl devuelve la dirección de la hoja');
{
  const src = funcion('previewSheetCcl', formatos);
  ok('la función existe', src.length > 0);
  let pedidas = 0;
  const correr = (respuesta, folio) => {
    const ctx = { Logger: { log() {} }, Date, String, JSON, openQuoteInSheets: () => { pedidas++; return respuesta; } };
    vm.createContext(ctx);
    vm.runInContext(src + '\nthis.f = previewSheetCcl;', ctx);
    return ctx.f(folio === undefined ? 'LVP-1' : folio);
  };
  const r = correr({ success: true, url: URL_HOJA, urlIncrustable: URL_INCRUSTAR, compartido: true });
  ok('con documento: success, la de incrustar Y la de Google Sheets (la misma de openQuoteInSheets)',
    r.success === true && r.urlIncrustable === URL_INCRUSTAR && r.url === URL_HOJA, r);
  ok('…sin ningún Date en la respuesta (llegaría null al navegador)',
    Object.keys(r).every((k) => !(r[k] instanceof Date)), Object.keys(r));
  const mal = correr({ success: false, message: 'No pudimos abrir el documento.' });
  ok('si openQuoteInSheets falla, se devuelve su fallo tal cual (sin dirección)', mal.success === false && !mal.url, mal);
  pedidas = 0;
  const sinFolio = correr({ success: true, url: URL_HOJA, urlIncrustable: URL_INCRUSTAR }, '');
  ok('sin folio no genera nada (ni llega a pedir la hoja)', sinFolio.success === false && pedidas === 0, [sinFolio, pedidas]);
}

console.log('\nC · cotizado_preview.html: DocumentoCcl lleva la barra');
/* La vista previa con dobles: el DOM del panel y de la barra, el servidor y los relojes. */
function preparar(opciones) {
  opciones = opciones || {};
  const OCULTOS = ['doc-ccl', 'doc-ccl-marco', 'doc-ccl-ampliar', 'doc-sheets-espera', 'doc-sheets-abrir'];
  const nodo = (id) => ({
    id, hidden: OCULTOS.includes(id), textContent: '', attrs: {}, children: [], style: {}, _on: {},
    classList: { _c: new Set(), add(c) { this._c.add(c); }, remove(c) { this._c.delete(c); }, contains(c) { return this._c.has(c); }, toggle(c, f) { if (f === undefined ? !this._c.has(c) : f) this._c.add(c); else this._c.delete(c); } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(n) { this.children.push(n); },
    get firstElementChild() { return this.children[0] || null; },
    addEventListener(t, f) { this._on[t] = f; }
  });
  const els = {};
  const doc = {
    hidden: !!opciones.pestanaOculta,
    getElementById: (id) => (els[id] = els[id] || nodo(id)),
    querySelector: (sel) => (els[sel] = els[sel] || nodo(sel)),
    createElement: () => nodo(''),
    addEventListener() {}
  };
  const registro = { llamadas: [], temporizadores: [], tweens: [], toasts: [] };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, JSON, Date, Math, Promise, Object, Array, String, Number,
    document: doc,
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn, ms) => { registro.temporizadores.push({ fn, ms }); return registro.temporizadores.length; },
    AppRun: { call: (fn, args, opts) => new Promise((resolve, reject) => registro.llamadas.push({ fn, args, opts, resolve, reject })) },
    VentelFX: { section: () => ({ done: (cb) => { if (cb) cb(); } }) },
    AppMotion: { toast: (t, k) => registro.toasts.push([t, k]) }
  };
  if (opciones.sinServidor !== true) ctx.google = { script: { run: {} } };
  if (opciones.conGsap) {
    const anota = (tipo) => function (t, a, b) { registro.tweens.push({ tipo, t, a, b }); return this; };
    ctx.gsap = { from: anota('from'), fromTo: anota('fromTo'), to: anota('to'),
      timeline() { return { fromTo: anota('tl.fromTo'), from: anota('tl.from'), to: anota('tl.to') }; } };
  }
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(modulo('DocumentoCcl', prev) + '\nthis.DC = DocumentoCcl;', ctx);
  const el = (id) => doc.getElementById(id);
  const barra = () => ({
    espera: !el('doc-sheets-espera').hidden,
    boton: !el('doc-sheets-abrir').hidden,
    href: el('doc-sheets-abrir').getAttribute('href')
  });
  const vencerTope = () => registro.temporizadores.filter((t) => t.ms >= 45000).forEach((t) => t.fn());
  return { ctx, el, barra, registro, vencerTope };
}

(async () => {
  ok('el módulo existe y se puede extraer', modulo('DocumentoCcl', prev).length > 0);
  {
    const { ctx, el, barra, registro } = preparar();
    ok('antes de pedir el documento no hay nada en la barra', JSON.stringify(barra()) === JSON.stringify({ espera: false, boton: false, href: null }), barra());
    ctx.DC.generar('LVP-261003-0001');
    const ll = registro.llamadas[0];
    ok('pide el documento UNA vez, con el folio', registro.llamadas.length === 1 && ll.fn === 'previewSheetCcl' && ll.args[0] === 'LVP-261003-0001', registro.llamadas.map((x) => x.fn));
    ok('…sin el aviso de la esquina: la espera la cuenta la barra (busy: false)', ll.opts && ll.opts.busy === false, ll.opts);
    ok('mientras se genera: «Generando documento…» a la vista y el botón todavía no',
      barra().espera === true && barra().boton === false && barra().href === null, barra());
    ctx.DC.generar('LVP-261003-0001');
    ok('pedirlo otra vez no vuelve a generar la hoja', registro.llamadas.length === 1);

    ll.resolve({ success: true, urlIncrustable: URL_INCRUSTAR, url: URL_HOJA, compartido: true, message: '' });
    await espera();
    ok('documento listo: la espera se va y aparece «Ver en Google Sheets»', barra().espera === false && barra().boton === true, barra());
    ok('…que lleva a la hoja en Google Sheets (la de edición, como el panel de inicio)', barra().href === URL_HOJA, barra().href);
    ok('…en el mismo momento en que el panel dice «Documento oficial listo»', el('doc-ccl-tit-tx').textContent === 'Documento oficial listo');
    ok('el panel sigue mostrando el documento incrustado (la otra dirección)',
      el('doc-ccl').hidden === false && (el('doc-ccl-marco').children[0] || {}).src === URL_INCRUSTAR);
    ok('DocumentoCcl.listo() lo confirma', ctx.DC.listo() === true);
  }
  {
    const { ctx, el, barra, registro } = preparar();
    ctx.DC.generar('LVP-2');
    registro.llamadas[0].resolve({ success: true, urlIncrustable: URL_INCRUSTAR });
    await espera();
    ok('servidor sin `url` (el minuto en que /exec aún sirve el anterior): ni espera ni botón roto',
      JSON.stringify(barra()) === JSON.stringify({ espera: false, boton: false, href: null }), barra());
    ok('…y el panel del documento funciona igual que antes', el('doc-ccl').hidden === false && el('doc-ccl-tit-tx').textContent === 'Documento oficial listo');
  }
  {
    const { ctx, barra, registro } = preparar();
    ctx.DC.generar('LVP-3');
    registro.llamadas[0].resolve({ success: true, urlIncrustable: URL_INCRUSTAR, url: 'javascript:alert(1)' });
    await espera();
    ok('una dirección que no es https nunca llega al enlace', barra().boton === false && barra().href === null, barra());
  }
  {
    const { ctx, el, barra, registro } = preparar();
    ctx.DC.generar('LVP-4');
    registro.llamadas[0].resolve({ success: false, message: 'No pudimos generar el documento.' });
    await espera();
    ok('si el servidor no pudo generarlo: la espera se va y no aparece botón', !barra().espera && !barra().boton && barra().href === null, barra());
    ok('…igual de callado que el panel, que también se retira', el('doc-ccl').hidden === true);
  }
  {
    const { ctx, barra, registro } = preparar();
    ctx.DC.generar('LVP-5');
    registro.llamadas[0].reject(new Error('El servidor no expone la función previewSheetCcl.'));
    await espera();
    ok('si la llamada falla (red, servidor viejo): tampoco se queda la espera colgada', !barra().espera && !barra().boton, barra());
  }
  {
    const { ctx, el, barra, registro, vencerTope } = preparar();
    ctx.DC.generar('LVP-6');
    vencerTope();
    ok('a los 45 s sin respuesta: la espera se retira con el panel', !barra().espera && !barra().boton && el('doc-ccl').hidden === true, barra());
    registro.llamadas[0].resolve({ success: true, urlIncrustable: URL_INCRUSTAR, url: URL_HOJA });
    await espera();
    ok('…y si la hoja llega tarde, el botón aparece igual que vuelve el panel',
      barra().boton === true && barra().href === URL_HOJA && el('doc-ccl').hidden === false, barra());
  }
  {
    const { ctx, barra, registro } = preparar({ sinServidor: true });
    ctx.DC.generar('LVP-7');
    ok('sin Apps Script (google.script.run) no anuncia un documento que nadie va a generar',
      registro.llamadas.length === 0 && !barra().espera && !barra().boton);
  }
  {
    const { ctx, el, registro } = preparar({ conGsap: true });
    ctx.DC.generar('LVP-8');
    registro.llamadas[0].resolve({ success: true, urlIncrustable: URL_INCRUSTAR, url: URL_HOJA });
    await espera();
    const entrada = registro.tweens.filter((t) => t.t === el('doc-sheets-abrir'));
    ok('con movimiento: el botón entra con fromTo y destino explícito (nunca un from que se quede en 0)',
      entrada.length === 1 && entrada[0].tipo === 'fromTo' && entrada[0].a.opacity === 0 && entrada[0].b.opacity === 1,
      entrada.map((t) => [t.tipo, t.a, t.b]));
    ok('…y limpia su opacidad al terminar (clearProps)', entrada[0] && /opacity/.test(entrada[0].b.clearProps || ''));
  }
  {
    const { ctx, el, barra, registro } = preparar({ conGsap: true, pestanaOculta: true });
    ctx.DC.generar('LVP-9');
    registro.llamadas[0].resolve({ success: true, urlIncrustable: URL_INCRUSTAR, url: URL_HOJA });
    await espera();
    ok('con la pestaña oculta no se anima: el botón simplemente está (no hay fotogramas que la terminen)',
      registro.tweens.filter((t) => t.t === el('doc-sheets-abrir')).length === 0 && barra().boton === true);
  }

  console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' comprobaciones fallaron' : '✔ ' + total + ' comprobaciones en verde'));
  process.exit(fallos ? 1 : 0);
})();
