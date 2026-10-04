/*
 * El reconocimiento del Reto de Innovación Liverpool 2026 (04/10/2026): la credencial en la barra de
 * TODAS las pantallas que tienen barra, el interruptor que la apaga en todas y los dibujos grandes,
 * que solo viajan donde se pintan al cargar.   Ejecutar:  node pruebas/reconocimiento.test.js
 *
 * Lo que vigila, y el fallo que evita cada parte:
 *   1 · Las pantallas. Cada una con barra (el Portal, el Monitor y las once del marco) incluye el
 *       parcial, y RECO_PANTALLAS (Portal.gs) es exactamente la lista de las que lo incluyen. Una
 *       pantalla nueva del marco sin el parcial sale sin credencial; una con el parcial y fuera de la
 *       lista sale con la credencial y SIN interruptor: no se podría apagar.
 *   2 · Los pesos. El parcial común va en catorce pantallas y no lleva los dibujos grandes (~64 KB
 *       por visita); esos los incluyen solo las pantallas que los pintan al cargar.
 *   3 · La misma credencial en las tres barras, y el sello de la barra lateral (la B) retirado.
 *   4 · El cliente: el guion del parcial con un DOM de mentira. Apagado, el saludo de la medalla una
 *       vez al día, los dibujos que llegan con las imágenes, la petición anticipada al apuntar, el
 *       reintento tras un fallo y el interruptor aplicado sin recargar.
 *   5 · El servidor: recoImagenes entrega también los dibujos, tal cual están en su archivo.
 * Esta carpeta queda fuera de "Carpeta del proyecto": clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');
let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400) : ''));
}

const leer = (f) => fs.readFileSync(path.join(PROY, f), 'utf8');
const code = leer('Code.gs');
const portal = leer('Portal.gs');
const shell = leer('app_shell.html');
const parcial = leer('app_reconocimiento.html');
const dibujos = leer('app_reconocimiento_sprite.html');
const pantallas = [...new Set([...code.matchAll(/\bfile:\s*'([^']+)'/g)].map((m) => m[1]))];
const fuente = {};
pantallas.forEach((p) => { fuente[p] = leer(p + '.html'); });
const incluye = (p, nombre) => new RegExp("<\\?!=\\s*include\\(\\s*'" + nombre + "'\\s*\\)\\s*;?\\s*\\?>").test(fuente[p]);
const ordenada = (a) => JSON.stringify(a.slice().sort());

/* ═════════════════════════════════════════════════════════════════════════════════════ */
console.log('\n1 · Todas las pantallas con barra llevan la credencial, y todas obedecen al interruptor');
const conMarco = pantallas.filter((p) => incluye(p, 'app_shell'));
const conBarraPropia = pantallas.filter((p) => /<header class="topbar">/.test(fuente[p]));
ok('las once pantallas del marco (app_shell)', conMarco.length === 11, conMarco);
ok('dos con barra propia: el Portal y el Monitor', ordenada(conBarraPropia) === '["Index","Promociones"]', conBarraPropia);
const conBarra = conMarco.concat(conBarraPropia);
const conParcial = pantallas.filter((p) => incluye(p, 'app_reconocimiento'));
ok('cada pantalla con barra incluye app_reconocimiento', conBarra.every((p) => conParcial.includes(p)), conBarra.filter((p) => !conParcial.includes(p)));
ok('…y además solo el inicio de sesión (la vitrina)', ordenada(conParcial) === ordenada(conBarra.concat('inicioDeSesion')), conParcial);
const mLista = portal.match(/var RECO_PANTALLAS = (\[[\s\S]*?\]);/);
const lista = mLista ? vm.runInNewContext(mLista[1]) : [];
ok('RECO_PANTALLAS (Portal.gs) es exactamente la lista de pantallas que incluyen el parcial', ordenada(lista) === ordenada(conParcial), { lista, conParcial });
ok('servirPagina_ pasa por recoEnPagina_ en sus dos ramas, sin pantallas escritas a mano',
  (code.match(/= recoEnPagina_\((pConfig|config)\.file, /g) || []).length === 2 && !/recoEnEstado_\(/.test(code));
ok('el parcial esconde con el interruptor apagado la credencial, la vitrina y la banda',
  /\[data-reco="no"\] \.reco-vitrina,\[data-reco="no"\] \.reco-banda,\[data-reco="no"\] \.reco-cred\{display:none !important\}/.test(parcial));

/* ═════════════════════════════════════════════════════════════════════════════════════ */
console.log('\n2 · Los dibujos grandes solo viajan donde se pintan al cargar');
const simbolos = (s) => [...s.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
ok('el parcial común solo define la medalla', JSON.stringify(simbolos(parcial)) === '["recoMedalla"]', simbolos(parcial));
ok('app_reconocimiento_sprite define el logotipo, la insignia y la miniatura del diploma, y nada más',
  ordenada(simbolos(dibujos)) === '["recoDiplomaMini","recoInsignia","recoLogo"]' && !/<script|<style/.test(dibujos), simbolos(dibujos));
ok('el parcial común pesa menos de 30 KB en el fuente (va en catorce pantallas)', Buffer.byteLength(parcial) < 30000, Buffer.byteLength(parcial));
// Las pantallas que pintan esos dibujos al cargar, fuera del visor (que está en el parcial).
const pintanGrandes = pantallas.filter((p) => /href="#reco(Logo|Insignia|DiplomaMini)"/.test(fuente[p]));
const conDibujos = pantallas.filter((p) => incluye(p, 'app_reconocimiento_sprite'));
ok('los incluyen exactamente las que los pintan al cargar: el Portal (banda) y el inicio de sesión (vitrina)',
  ordenada(conDibujos) === ordenada(pintanGrandes) && ordenada(conDibujos) === '["Index","inicioDeSesion"]', { conDibujos, pintanGrandes });

/* ═════════════════════════════════════════════════════════════════════════════════════ */
console.log('\n3 · La misma credencial en las tres barras; el sello lateral (B), retirado');
const norm = (s) => s.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
const botones = (html) => html.match(/<button type="button" class="reco-cred"[\s\S]*?<\/button>/g) || [];
ok('el Portal lleva una credencial en su barra', botones(fuente.Index).length === 1);
ok('el Monitor lleva una credencial en su barra', botones(fuente.Promociones).length === 1);
// Las tres barras quedan en el mismo orden: buscador → credencial → lo demás. El «Buscar» del Monitor
// y del marco lo pone app_comando al cargar: tras el espaciador, o primero en el grupo de la sesión.
ok('en el Monitor, tras el espaciador (donde se pone «Buscar») y antes de «Portal principal»',
  /<span class="spacer"><\/span>\s*<!--[\s\S]*?-->\s*<button type="button" class="reco-cred"[\s\S]*?<\/button>\s*<a class="back-link"/.test(fuente.Promociones) &&
  /if \(hueco && hueco\.nextSibling\) barra\.insertBefore\(btn, hueco\.nextSibling\);/.test(leer('app_comando.html')));
ok('en el Portal, entre el buscador y el reloj',
  /<div class="search-drop" id="searchDrop"><\/div>\s*<\/div>\s*<!--[\s\S]*?-->\s*<button type="button" class="reco-cred"[\s\S]*?<\/button>\s*<div class="clock">/.test(fuente.Index));
ok('el marco la pide a AppReco, primera del grupo de la sesión (detrás de «Buscar»), y solo si el parcial está en la página',
  /'<div class="shell-session">' \+\s*\(window\.AppReco && AppReco\.credencial \? AppReco\.credencial\(\) : ''\) \+\s*'<span class="shell-user">/.test(shell) &&
  /if \(sesion\) sesion\.insertBefore\(btn, sesion\.firstChild\);/.test(leer('app_comando.html')));
ok('el marco avisa a la medalla cuando su barra ya está puesta', /col\.appendChild\(main\);[^\n]*\n[^\n]*\n\s*if \(window\.AppReco && AppReco\.saludar\) AppReco\.saludar\(\);/.test(shell));
ok('en el Portal, el margen automático del reloj se anula tras la credencial', /\.reco-cred \+ \.clock\{margin-left:0\}/.test(parcial));
const sello = fs.readdirSync(PROY).filter((f) => /\.(html|gs)$/.test(f) && /reco-sello-lat|reco-sello-med|reco-sello-tx/.test(leer(f)));
ok('el sello de la barra lateral (B) no queda en ningún archivo', sello.length === 0, sello);

/* ═════════════════════════════════════════════════════════════════════════════════════
   4 · CLIENTE: el guion del parcial con un DOM de mentira
   ═════════════════════════════════════════════════════════════════════════════════════ */
const guion = (parcial.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
const DIBUJOS_RESPUESTA = '<svg class="reco-sprite"><symbol id="recoLogo"></symbol></svg>';

function clases() {
  const s = new Set();
  return {
    add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
    toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; if (on) s.add(c); else s.delete(c); return on; }
  };
}

/** Una página con el parcial: opc.app (__APP__), opc.conDibujos, opc.respuesta, opc.guardado, opc.hoy. */
function pagina(opc) {
  opc = opc || {};
  const attrs = {}, insertados = [], escuchas = {}, llamadas = [], cache = {};
  const almacen = Object.assign({}, opc.guardado || {});
  const creds = opc.sinCredencial ? [] : [{ classList: clases() }];
  let hayLogo = !!opc.conDibujos;
  const caja = () => ({ classList: clases(), hijos: [], querySelector() { return this.hijos[0] || null; }, appendChild(n) { this.hijos.push(n); } });
  const cajas = { diploma: caja(), mensaje: caja() };
  const visor = {
    open: false, classList: clases(),
    showModal() { this.open = true; }, close() { this.open = false; },
    querySelector: (sel) => { const m = /data-reco-lugar="(\w+)"/.exec(sel); return m ? cajas[m[1]] : null; },
    querySelectorAll: () => []
  };
  const document = {
    readyState: 'complete',
    documentElement: {
      setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; },
      getAttribute: (k) => (k in attrs ? attrs[k] : null)
    },
    querySelectorAll: (sel) => (sel === '.reco-cred' ? creds : []),
    getElementById: (id) => (id === 'recoLogo' ? (hayLogo ? {} : null) : id === 'recoVisor' ? visor : null),
    body: { insertAdjacentHTML: (pos, html) => { insertados.push(pos + ':' + html); if (/id="recoLogo"/.test(html)) hayLogo = true; } },
    addEventListener: (t, fn) => { (escuchas[t] = escuchas[t] || []).push(fn); },
    removeEventListener: (t, fn) => { escuchas[t] = (escuchas[t] || []).filter((f) => f !== fn); }
  };
  const ctx = {
    document, console, Promise, String,
    __APP__: opc.app || {},
    localStorage: { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); } },
    AppRun: { call: (fn) => { llamadas.push(fn); return opc.respuesta ? Promise.resolve(opc.respuesta) : Promise.reject(new Error('prueba: servidor caído')); } },
    AppCache: { get: (k) => (k in cache ? { data: cache[k] } : null), set: (k, d) => { cache[k] = d; } },
    Image: function () { this.src = ''; this.getAttribute = (k) => this[k] || null; },
    Date: opc.hoy ? class extends Date { constructor(...a) { if (a.length) super(...a); else super(opc.hoy); } } : Date
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(guion, ctx, { filename: 'app_reconocimiento.html' });
  const disparar = (tipo, abre) => (escuchas[tipo] || []).slice().forEach((fn) => fn({
    target: { closest: (sel) => (abre && sel === '[data-reco-abrir]' ? { getAttribute: () => 'diploma' } : null) },
    preventDefault() {}
  }));
  return { ctx, attrs, insertados, escuchas, llamadas, cache, almacen, creds, visor, cajas, disparar };
}
const esperar = () => new Promise((r) => setImmediate(r));
const RESPUESTA = { v: 'x', diploma: 'data:image/webp;base64,AAAA', mensaje: 'data:image/webp;base64,BBBB', sprite: DIBUJOS_RESPUESTA };

(async () => {
  console.log('\n4 · El cliente');
  ok('el guion del parcial se extrae', guion.length > 1000, guion.length);

  let p = pagina({ app: { reco: false } });
  ok('apagado (__APP__.reco === false): marca data-reco="no" en <html>', p.attrs['data-reco'] === 'no', p.attrs);
  ok('…y la medalla no saluda ni deja fecha guardada', !p.creds[0].classList.contains('saluda') && !('ventel-reco-saludo' in p.almacen), p.almacen);
  p.ctx.AppReco.encender(true);
  ok('encender(true) lo vuelve a mostrar sin recargar (lo usa anuncios.html)', !('data-reco' in p.attrs), p.attrs);
  p.ctx.AppReco.encender(false);
  ok('encender(false) lo apaga sin recargar', p.attrs['data-reco'] === 'no', p.attrs);

  const HOY = new Date(2026, 9, 4, 19, 30, 0);   // 19:30 en México ya es día 5 en Greenwich
  p = pagina({ app: { reco: true }, hoy: HOY });
  ok('encendido: no toca <html>', !('data-reco' in p.attrs), p.attrs);
  ok('primera pantalla del día: la medalla saluda', p.creds[0].classList.contains('saluda'));
  ok('…y guarda el día de aquí, no el de Greenwich', p.almacen['ventel-reco-saludo'] === '2026-10-04', p.almacen);
  p = pagina({ app: { reco: true }, hoy: HOY, guardado: { 'ventel-reco-saludo': '2026-10-04' } });
  ok('segunda pantalla del mismo día: quieta', !p.creds[0].classList.contains('saluda'));
  p = pagina({ app: { reco: true }, hoy: HOY, sinCredencial: true });
  ok('sin credencial todavía (el marco la pinta después): no gasta el saludo del día…', !('ventel-reco-saludo' in p.almacen), p.almacen);
  p.creds.push({ classList: clases() });
  p.ctx.AppReco.saludar();
  ok('…y saluda cuando el marco avisa de que ya está puesta', p.creds[0].classList.contains('saluda') && p.almacen['ventel-reco-saludo'] === '2026-10-04');
  const credHTML = p.ctx.AppReco.credencial();
  ok('AppReco.credencial() es la misma credencial que llevan el Portal y el Monitor',
    norm(credHTML) === norm(botones(fuente.Index)[0].replace(/\s*<!--[\s\S]*?-->/g, '')) &&
    norm(credHTML) === norm(botones(fuente.Promociones)[0]), norm(credHTML));

  // Pantalla del marco: sin dibujos escritos. Al apuntar a la credencial se piden con las imágenes.
  p = pagina({ app: { reco: true }, respuesta: RESPUESTA });
  p.disparar('pointerover', false);
  ok('apuntar a cualquier otra cosa no pide nada', p.llamadas.length === 0, p.llamadas);
  p.disparar('pointerover', true);
  await esperar();
  ok('apuntar a la credencial pide recoImagenes una vez', JSON.stringify(p.llamadas) === '["recoImagenes"]', p.llamadas);
  ok('…y añade los dibujos al final de <body>', p.insertados.length === 1 && p.insertados[0] === 'beforeend:' + DIBUJOS_RESPUESTA, p.insertados);
  ok('…y lo guarda con la clave nueva (reco-imagenes-v2), dibujos incluidos', p.cache['reco-imagenes-v2'] && p.cache['reco-imagenes-v2'].sprite === DIBUJOS_RESPUESTA, Object.keys(p.cache));
  p.disparar('pointerover', true);
  p.disparar('focusin', true);
  ok('volver a apuntar no repite la petición', p.llamadas.length === 1, p.llamadas);
  p.ctx.AppReco.abrir('diploma');
  await esperar();
  ok('al abrir: el visor se abre sin el hueco de «sin dibujos» (ya llegaron)', p.visor.open && !p.visor.classList.contains('sin-dibujos'));
  ok('…pone el diploma y el mensaje, sin otra petición', p.cajas.diploma.hijos.length === 1 && p.cajas.mensaje.hijos.length === 1 && p.llamadas.length === 1);
  ok('…y no añade los dibujos dos veces', p.insertados.length === 1, p.insertados.length);

  // Pantalla con los dibujos escritos (Portal, inicio de sesión): no se añaden.
  p = pagina({ app: { reco: true }, respuesta: RESPUESTA, conDibujos: true });
  p.ctx.AppReco.abrir('insignia');
  await esperar();
  ok('con los dibujos ya escritos no se añade nada', p.insertados.length === 0 && !p.visor.classList.contains('sin-dibujos'), p.insertados);

  // Servidor caído: el visor lo dice, enseña el hueco, y el siguiente clic lo reintenta.
  p = pagina({ app: { reco: true } });
  p.ctx.AppReco.abrir('diploma');
  ok('abierto sin dibujos todavía: el visor enseña el hueco (sin-dibujos)', p.visor.classList.contains('sin-dibujos'));
  await esperar();
  ok('si el servidor falla, el visor lo dice (falla)', p.visor.classList.contains('falla'));
  p.ctx.AppReco.cerrar();
  p.ctx.AppReco.abrir('diploma');
  await esperar();
  ok('…y abrirlo otra vez lo reintenta', p.llamadas.length === 2, p.llamadas);

  // Lo guardado de antes (v2) se usa sin ir al servidor, y trae los dibujos.
  p = pagina({ app: { reco: true } });
  p.ctx.AppCache.set('reco-imagenes-v2', RESPUESTA);
  p.ctx.AppReco.abrir('diploma');
  await esperar();
  ok('con lo guardado (30 días) no se llama al servidor y los dibujos se añaden', p.llamadas.length === 0 && p.insertados.length === 1, { llamadas: p.llamadas, insertados: p.insertados.length });

  /* ═══════════════════════════════════════════════════════════════════════════════════ */
  console.log('\n5 · El servidor entrega los dibujos con las imágenes');
  const ctxS = {
    console, JSON, String, Object, Array, RegExp, Error, Math, Date,
    Logger: { log: () => {} },
    HtmlService: { createHtmlOutputFromFile: (f) => ({ getContent: () => leer(f + '.html') }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) }
  };
  vm.createContext(ctxS);
  let errS = null, d = null;
  try { vm.runInContext(portal, ctxS, { filename: 'Portal.gs' }); d = vm.runInContext('recoImagenes()', ctxS); } catch (e) { errS = e.message; }
  ok('recoImagenes() responde', !errS && d, errS);
  ok('…con el diploma y el mensaje en base64 normal', d && /^data:image\/(webp|png|jpeg);base64,/.test(d.diploma) && /^data:image\/(webp|png|jpeg);base64,/.test(d.mensaje) && !/[-_]/.test(d.diploma.split(',')[1]));
  ok('…y los dibujos, tal cual están en app_reconocimiento_sprite.html', d && d.sprite === dibujos);
  ok('recoEnPagina_: una pantalla de la lista lleva reco; otra, el JSON intacto',
    vm.runInContext("recoEnPagina_('consola', '{\"a\":1}')", ctxS) === '{"reco":true,"a":1}' &&
    vm.runInContext("recoEnPagina_('cotizacion', '{\"a\":1}')", ctxS) === '{"a":1}');

  /* ═══════════════════════════════════════════════════════════════════════════════════ */
  console.log('\n6 · El interruptor de anuncios.html');
  const anuncios = fuente.anuncios;
  ok('al cambiarlo, lo aplica en su propia barra sin recargar', /if \(window\.AppReco && AppReco\.encender\) AppReco\.encender\(r\.visible\);/.test(anuncios));
  ok('y dice que vale para todas las pantallas', /Se muestra en todas las pantallas/.test(anuncios) && !/en el Portal y en el inicio de sesión/.test(anuncios));

  console.log('\n' + '─'.repeat(45));
  if (fallos) { console.log('✖ ' + fallos + ' de ' + total + ' comprobaciones fallaron'); process.exit(1); }
  console.log('✔ ' + total + ' comprobaciones en verde');
})().catch((e) => { console.log('✖ la suite reventó: ' + (e && e.stack || e)); process.exit(1); });
