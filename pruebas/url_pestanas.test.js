/*
 * F5 del doc 16 · Las pestañas en la URL (01/10/2026).   node pruebas/url_pestanas.test.js
 *
 * revision_cotizacion escribe en la dirección la tarjeta del documento (?sec=hoja|google) y el
 * artículo del comparador (?item=, con ?action=pagina); cotizado_preview, el formato (?format=).
 * El comportamiento de punta a punta (F5, atrás, adelante) lo mira la sonda en Chrome:
 *   scripts/laboratorio/url-pestanas.mjs
 * Esto vigila, sin navegador, lo que se rompe sin que se vea:
 *   · que ?item= deje de encontrar la línea que escribió (SKU repetido, línea sin SKU);
 *   · que un artículo que ya no está o sin enlace abra OTRO en su lugar;
 *   · que el aspa vuelva a recibir el clic como `sinUrl` y deje el artículo en la barra;
 *   · que nadie escuche atrás/adelante, o que los parámetros dejen de estar en PARAMS_VISTA;
 *   · (decisión 8) que alguna pantalla vuelva a APILAR historial: con el fallo de Google, atrás
 *     después de una recarga deja la pantalla en blanco. Se ejecutan el AppUrl real y el navUrl
 *     real del Portal con un google.script.history falso.
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
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

const rev = fs.readFileSync(path.join(PROY, 'revision_cotizacion.html'), 'utf8').replace(/\r\n/g, '\n');
const prev = fs.readFileSync(path.join(PROY, 'cotizado_preview.html'), 'utf8').replace(/\r\n/g, '\n');
const idx = fs.readFileSync(path.join(PROY, 'Index.html'), 'utf8').replace(/\r\n/g, '\n');
const code = fs.readFileSync(path.join(PROY, 'Code.gs'), 'utf8');
const core = fs.readFileSync(path.join(PROY, 'app_core.html'), 'utf8');

/* Saca el texto de una función por su nombre (cuenta llaves, respeta cadenas). */
function fuente(nombre, texto) {
  const i = texto.indexOf('function ' + nombre + '(');
  if (i < 0) return '';
  let d = 0, j = texto.indexOf('{', i), q = null;
  for (; j < texto.length; j++) {
    const c = texto[j];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && texto[j + 1] === '/') { j = texto.indexOf('\n', j); continue; }
    if (c === '{') d++;
    if (c === '}' && --d === 0) return texto.slice(i, j + 1);
  }
  return '';
}

console.log('\nA · La identidad del artículo en ?item=');
const ctx = { URL };
vm.runInNewContext(
  rev.match(/const HOSTS_LIVERPOOL = [^;]*;/)[0] + '\n' +
  ['urlSegura', 'idArticulo', 'indiceDeArticulo'].map((n) => fuente(n, rev)).join('\n') +
  '\nthis.api = { idArticulo, indiceDeArticulo };', ctx);
const A = ctx.api;
const enlace = (n) => 'https://www.liverpool.com.mx/tienda/pdp/x/' + n;
const P = [
  { sku: '111', productUrl: enlace(0) }, { sku: '222', productUrl: enlace(1) }, { sku: ' 111 ', productUrl: enlace(2) },
  { sku: '', productUrl: enlace(3) }, { sku: '555', productUrl: '' }, { sku: '', productUrl: enlace(5) },
  { sku: '777', productUrl: 'https://otro-sitio.com/777' }
];
const ids = P.map((_, i) => A.idArticulo(P, i));
ok('los ids salen como se documentan', JSON.stringify(ids) === JSON.stringify(['111', '222', '111~2', '~1', '555', '~2', '777']), ids);
ok('cada línea con enlace de Liverpool vuelve a sí misma', [0, 1, 2, 3, 5].every((i) => A.indiceDeArticulo(P, ids[i]) === i),
  [0, 1, 2, 3, 5].map((i) => A.indiceDeArticulo(P, ids[i])));
ok('sin enlace, o con uno que no es de Liverpool, no se abre (y no se abre OTRA)', A.indiceDeArticulo(P, '555') === -1 && A.indiceDeArticulo(P, '777') === -1);
ok('un SKU que ya no está, o una aparición que no existe, da -1', A.indiceDeArticulo(P, '999') === -1 && A.indiceDeArticulo(P, '111~3') === -1 && A.indiceDeArticulo(P, '~9') === -1);
ok('vacío y basura dan -1', A.indiceDeArticulo(P, '') === -1 && A.indiceDeArticulo(P, null) === -1 && A.indiceDeArticulo(P, '~') === -1);
// Si la cotización se edita y entra una línea arriba, el enlace sigue señalando el mismo artículo.
const editada = [{ sku: '999', productUrl: enlace(9) }].concat(P);
ok('una línea nueva arriba no cambia a qué artículo apunta un enlace ya compartido',
  A.indiceDeArticulo(editada, '222') === 2 && A.indiceDeArticulo(editada, '111~2') === 3);

console.log('\nB · revision_cotizacion: el cableado');
const pintarTodo = fuente('pintarTodo', rev);
ok('pintarTodo aplica la dirección al terminar de pintar', /aplicarUrl\(AppUrl\.params\(\)\)/.test(pintarTodo));
ok('…antes de lanzar el recorrido guiado, que no se lanza con el comparador abierto',
  pintarTodo.indexOf('aplicarUrl(') > -1 && pintarTodo.indexOf('aplicarUrl(') < pintarTodo.indexOf("AppOnboarding[visorAbierto() ? 'definir' : 'auto']"));
ok('atrás/adelante pasan por aplicarUrl', /AppUrl\.alCambiarUrl\(function \(loc\) \{ aplicarUrl\(/.test(rev));
ok('el aspa no recibe el clic como `sinUrl`', !/addEventListener\('click', cerrarVisor\)/.test(rev) && /'rev-viewer-cerrar'\)\.addEventListener\('click', function \(\) \{ cerrarVisor\(\); \}\)/.test(rev));
const aplicar = fuente('aplicarUrl', rev);
ok('aplicarUrl abre, cambia y cierra siempre en callado', /abrirVisor\([^)]*, true\)/.test(aplicar) && /irPestanaVisor\([^)]*, true\)/.test(aplicar) &&
  /cerrarVisor\(true\)/.test(aplicar) && /documento\.pestana\(sec, true\)/.test(aplicar) && /documento\.abrir\((true|false), true\)/.test(aplicar));
ok('abrir apila; cerrar reemplaza', /AppUrl\.reflejar\(\{ item: idArticulo\([^)]*\), action: '' \}, \{ apilar: true \}\)/.test(fuente('abrirVisor', rev)) &&
  /AppUrl\.reflejar\(\{ item: '', action: '' \}\);/.test(fuente('cerrarVisor', rev)));

console.log('\nC · cotizado_preview y el contrato de parámetros');
ok('el formato se escribe desde `change`, sin apilar', /select\.addEventListener\('change'[\s\S]{0,700}?AppUrl\.reflejar\(\{ format: select\.value \}\);/.test(prev));
ok('…y al pintar manda el de la dirección', /const formatoDeUrl = AppUrl\.param\('format'\);/.test(fuente('populatePreview', prev)) &&
  /loadPreviewFormats\(formatoDeUrl \|\| data\.format\)/.test(fuente('populatePreview', prev)));
const lista = (txt) => JSON.parse(txt.match(/const PARAMS_VISTA = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
ok('sec, item, action y format siguen en las dos PARAMS_VISTA (servidor y cliente)',
  ['sec', 'item', 'action', 'format'].every((k) => lista(code).includes(k) && lista(core).includes(k)));

console.log('\nD · Decisión 8: ninguna pantalla apila historial (fallo de Google tras recargar)');
/* google.script.history falso: apunta qué método se llamó y con qué parámetros. */
function historialFalso() {
  const llamadas = [];
  const reg = (m) => function (estado, params, hash) { llamadas.push({ m, params: Object.assign({}, params), hash }); };
  return { llamadas, api: { push: reg('push'), replace: reg('replace'), setChangeHandler() {} } };
}
/* El AppUrl REAL: de PARAMS_VISTA al cierre de su objeto, con el interruptor tal cual o forzado. */
const ini = core.indexOf('  const PARAMS_VISTA = [');
const fin = core.indexOf('  /** Pantallas que exigieron sesión');
const trozoAppUrl = ini > -1 && fin > ini ? core.slice(ini, fin) : '';
ok('se encuentra el AppUrl de app_core para ejecutarlo', /const AppUrl = \{/.test(trozoAppUrl) && /const APILAR_HISTORIAL = (true|false);/.test(trozoAppUrl));
ok('el interruptor está APAGADO', /const APILAR_HISTORIAL = false;/.test(core));
function appUrlCon(apilarHistorial) {
  const h = historialFalso();
  const ctx = { console, setTimeout, clearTimeout, URLSearchParams, cfg: { baseUrl: 'https://x/exec', folio: 'F1' } };
  ctx.window = ctx; ctx.location = { search: '' }; ctx.google = { script: { history: h.api } };
  const fuenteAppUrl = trozoAppUrl.replace(/const APILAR_HISTORIAL = (true|false);/, 'const APILAR_HISTORIAL = ' + apilarHistorial + ';');
  vm.runInNewContext(fuenteAppUrl + '\nthis.AppUrl = AppUrl;', ctx);
  return { AppUrl: ctx.AppUrl, llamadas: h.llamadas };
}
if (trozoAppUrl) {
  const hoy = appUrlCon(false);
  hoy.AppUrl.declararPagina('revision_cotizacion');
  hoy.AppUrl.reflejar({ item: '111~2', action: '' }, { apilar: true });
  hoy.AppUrl.actualizar({ page: 'consola', sec: 'grupos' }, 'grupos', true);
  ok('con el interruptor apagado, «apilar» REEMPLAZA (y en el acto)', hoy.llamadas.length === 2 && hoy.llamadas.every((x) => x.m === 'replace'), hoy.llamadas);
  ok('…sin perder la página ni lo demás de la dirección', hoy.llamadas[0] && hoy.llamadas[0].params.page === 'revision_cotizacion' &&
    hoy.llamadas[0].params.folio === 'F1' && hoy.llamadas[0].params.item === '111~2' && !('action' in hoy.llamadas[0].params), hoy.llamadas[0]);
  ok('AppUrl.APILA_HISTORIAL lo publica para el Portal', hoy.AppUrl.APILA_HISTORIAL === false);
  const siGoogleLoArregla = appUrlCon(true);
  siGoogleLoArregla.AppUrl.actualizar({ page: 'consola', sec: 'grupos' }, null, true);
  siGoogleLoArregla.AppUrl.actualizar({ page: 'consola', q: 'x' }, null, false);
  ok('encendido, vuelve a apilar (y los filtros siguen reemplazando): se revierte en una línea',
    siGoogleLoArregla.llamadas.map((x) => x.m).join(',') === 'push,replace', siGoogleLoArregla.llamadas);
}
/* El navUrl REAL del Portal, que escribe la barra por su cuenta. */
const navUrlFuente = fuente('navUrl', idx);
ok('se encuentra navUrl en Index.html', !!navUrlFuente);
function navUrlCon(apilaHistorial) {
  const h = historialFalso();
  const ctx = { pubAbierta: '', google: { script: { history: h.api } } };
  ctx.window = ctx; ctx.AppUrl = { APILA_HISTORIAL: apilaHistorial };
  vm.runInNewContext('var pubAbierta = "";\n' + navUrlFuente + '\nthis.navUrl = navUrl;', ctx);
  return { navUrl: ctx.navUrl, llamadas: h.llamadas };
}
if (navUrlFuente) {
  const portal = navUrlCon(false);
  portal.navUrl('herramientas', '', true);
  portal.navUrl('paqueterias', 'estafeta', false);
  ok('el Portal tampoco apila al cambiar de sección', portal.llamadas.map((x) => x.m).join(',') === 'replace,replace' &&
    portal.llamadas[0].params.sec === 'herramientas' && portal.llamadas[0].hash === 'herramientas', portal.llamadas);
  const portalArreglado = navUrlCon(true);
  portalArreglado.navUrl('herramientas', '', true);
  ok('…y obedece al mismo interruptor', portalArreglado.llamadas.map((x) => x.m).join(',') === 'push');
}
ok('nadie más llama a google.script.history.push (solo AppUrl.actualizar y navUrl)',
  fs.readdirSync(PROY).filter((f) => /\.html$/.test(f)).every((f) => {
    const t = fs.readFileSync(path.join(PROY, f), 'utf8');
    const n = (t.match(/google\.script\.history\.push/g) || []).length;
    return n === 0 || (f === 'app_core.html' && n === 1) || (f === 'Index.html' && n === 1);
  }));

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
