// Ajuste a los complementos del dron tras ver las recomendaciones reales (04/10/2026):
//  · «mochila» aceptaba cualquier estuche «para cámara»: al DJI Mini 5 Pro le tocó el
//    «Estuche para cámara instantánea Stitch»;
//  · «powerBank» aceptaba cualquier «batería portátil»: al DJI Lito X1 le tocó la batería de una
//    cámara Canon («Batería portátil 9967b002aa»).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ruta = path.join(__dirname, '..', 'wt', 'Extencion para chrome', 'reglas-venta.js');
let s = fs.readFileSync(ruta, 'utf8');
const crlf = s.indexOf('\r\n') > -1;
s = s.replace(/\r\n/g, '\n');
function cambia(a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error(n + ' veces: ' + a.slice(0, 70));
  s = s.split(a).join(b);
}

// --- mochila: de dron, o mochila/maleta de cámara; nunca el estuche de una instantánea ---
cambia("requiere: /\\bdron|dji|camara/, si:",
  "requiere: /\\bdron|\\bdji\\b|^(mochilas?|maletas?|maletin(es)?)\\b.*\\bcamara/, excluye: /instantanea|instax|polaroid/, si:");
cambia("{ tipo: 'mochila', etiqueta: 'Mochila o estuche',",
  "// De dron, o una mochila de cámara (acolchada): un «estuche para cámara» es chico. Al Mini 5 Pro\n" +
  "        // le tocaba el «Estuche para cámara instantánea Stitch» (04/10/2026).\n" +
  "        { tipo: 'mochila', etiqueta: 'Mochila o estuche',");

// --- power bank: con seña de serlo ---
const COLA = "excluye: /dji|\\bdron|intelligent|flight|vuelo/, si: /^(?!.*\\b(juguete|infantil|para nin[oa]s|mini dron|syma|paw patrol|spider|hot wheels)\\b)/, topePrecio: 0.3, buscar: 'power bank' }";
cambia(COLA, "requiere: /mah\\b|power ?bank|\\busb\\b|carga rapida|magsafe|inalambric/, " + COLA);
cambia("{ tipo: 'powerBank', etiqueta: 'Power bank',",
  "// Con seña de serlo (mAh, USB…): Liverpool llama «Batería portátil 9967b002aa» a la batería de\n" +
  "        // una cámara Canon, y le tocaba al DJI Lito X1 (04/10/2026).\n" +
  "        { tipo: 'powerBank', etiqueta: 'Power bank',");

// Comprobación ANTES de escribir.
const ctx = vm.createContext({});
vm.runInContext(s, ctx);
const R = ctx.VENTEL_REGLAS;
const dron = R.clases.find((c) => c.id === 'dron');
const t = (tipo) => dron.complementos.find((k) => k.tipo === tipo);
const pasa = (k, n) => k.palabras.test(n) && (!k.requiere || k.requiere.test(n)) && !(k.excluye && k.excluye.test(n));
const casos = [
  ['mochila', 'estuche para camara instantanea stitch', false],
  ['mochila', 'estuche para camara', false],
  ['mochila', 'mochila para camara impermeable unisex', true],
  ['mochila', 'mochila para drone', true],
  ['mochila', 'estuche para dron mini 4 pro', true],
  ['mochila', 'mochila para camara instantanea instax', false],
  ['powerBank', 'bateria portatil 9967b002aa', false],
  ['powerBank', 'bateria portatil 20000 mah pb20-dw', true],
  ['powerBank', 'power bank 10000', true],
  ['powerBank', 'bateria portatil de 30 w usb tipo c', true]
];
const malos = casos.filter((c) => pasa(t(c[0]), c[1]) !== c[2]);
if (malos.length) throw new Error('no cuadra: ' + JSON.stringify(malos));

fs.writeFileSync(ruta, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('ok · casos', casos.length, '· clases', R.clases.length, '· tipos', R.clases.reduce((a, c) => a + c.complementos.length, 0), '· finales de línea:', crlf ? 'CRLF' : 'LF');
