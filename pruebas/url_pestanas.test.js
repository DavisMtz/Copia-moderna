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
 *   · que nadie escuche atrás/adelante, o que los parámetros dejen de estar en PARAMS_VISTA.
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

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
