// La clase de una lista de nombres en la 2.9 (commit 6f8ab4c) y en el árbol de trabajo, lado a lado.
// Sirve para ver qué fichas cambian de clase al tocar un `noEs` o al añadir una clase.
//   node clases-2.9-contra-3.0.cjs [lista.json]     → sin lista, nombres-de-prueba.json
// La lista: [[nombre, «Producto» o null, [migas] o null], …]. «≠» marca las que cambian.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..');
const EXT = path.join(REPO, 'Extencion para chrome');
const deGit = (f) => execFileSync('git', ['-C', REPO, 'show', '6f8ab4c:Extencion para chrome/' + f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
function cargar(reglas, nucleo) {
  const ctx = vm.createContext({ console });
  vm.runInContext(reglas, ctx); vm.runInContext(nucleo, ctx);
  return { VM: ctx.VentelVM, R: ctx.VENTEL_REGLAS };
}
const A = cargar(deGit('reglas-venta.js'), deGit('recomendador-nucleo.js'));
const B = cargar(fs.readFileSync(path.join(EXT, 'reglas-venta.js'), 'utf8'), fs.readFileSync(path.join(EXT, 'recomendador-nucleo.js'), 'utf8'));
const AHORA = new Date(2026, 9, 4, 12).getTime();
const fichaDe = (o) => Object.assign({ id: '1', migas: [], producto: null, modeloComercial: null, precio: null, esRango: false,
  varianteActual: null, skuUrl: null, seleccion: null, variantes: [], colores: [], care: false }, o);
const clase = (V, n) => { const m = V.VM.recomendar(fichaDe({ nombre: n[0], producto: n[1] || null, migas: n[2] || [], marca: 'X', precio: 1000 }), {}, null, V.R, AHORA); return (m.clase && m.clase.id) || null; };

const N = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, 'nombres-de-prueba.json'), 'utf8'));
N.forEach((n) => { const a = clase(A, n), b = clase(B, n); console.log((a === b ? '  ' : '≠ ') + String(a).padEnd(20) + ' → ' + String(b).padEnd(22) + '«' + n[0] + '»' + (n[2] ? ' ' + n[2].join(' > ') : '')); });
