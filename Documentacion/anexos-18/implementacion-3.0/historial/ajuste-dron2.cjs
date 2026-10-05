// Tercer ajuste al dron (04/10/2026): el «Cargador pared» que Liverpool liga al DJI es el de una
// cámara Sony ($1,148.70), y el «Cargador para cámara USB tipo C» es de GoPro. El del dron es un
// cargador USB de pared: tiene que decirlo.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ruta = path.join(__dirname, '..', 'wt', 'Extencion para chrome', 'reglas-venta.js');
let s = fs.readFileSync(ruta, 'utf8');
function cambia(a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error(n + ' veces: ' + a.slice(0, 70));
  s = s.split(a).join(b);
}

cambia("requiere: /pared|usb|tipo c|corriente|\\d+ ?w\\b/, excluye: /pilas|\\baaa?\\b|\\bauto\\b|carro|coche|inalambrico|laptop|solar|power ?bank|mah\\b/",
  "requiere: /\\busb\\b|tipo c/, excluye: /pilas|\\baaa?\\b|\\bauto\\b|carro|coche|inalambrico|laptop|solar|power ?bank|mah\\b|camara|gopro/");
cambia("        // Liverpool lo liga al dron: baterías y control cargan por USB-C y la caja no siempre trae cargador.\n",
  "        // Baterías y control cargan por USB-C y la caja no siempre trae cargador. Tiene que decir USB:\n" +
  "        // el «Cargador pared» que Liverpool liga al DJI es el de una cámara Sony (04/10/2026).\n");

const ctx = vm.createContext({});
vm.runInContext(s, ctx);
const R = ctx.VENTEL_REGLAS;
const dron = R.clases.find((c) => c.id === 'dron');
const k = dron.complementos.find((x) => x.tipo === 'cargadorPared');
const pasa = (n) => k.palabras.test(n) && (!k.requiere || k.requiere.test(n)) && !(k.excluye && k.excluye.test(n));
const casos = [
  ['cargador pared', false],
  ['cargador para camara usb tipo c', false],
  ['cargador pared usb tipo c', true],
  ['cargador pared usb tipo c 45 w', true],
  ['cargador pared 15570 usb + usb tipo c', true],
  ['cargador de pared de 30 w usb tipo c', true],
  ['cargador pared de 67 w usb tipo a + usb tipo c a2669113', true],
  ['cargador pared universal', false],
  ['cargador para auto usb', false],
  ['adaptador de corriente usb-c 20 w', true]
];
const malos = casos.filter((c) => pasa(c[0]) !== c[1]);
if (malos.length) throw new Error('no cuadra: ' + JSON.stringify(malos));
fs.writeFileSync(ruta, s);
console.log('ok · casos', casos.length, '· clases', R.clases.length, '· tipos', R.clases.reduce((a, c) => a + c.complementos.length, 0));
