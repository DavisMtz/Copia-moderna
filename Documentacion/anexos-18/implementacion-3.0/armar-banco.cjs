// Arma el banco de laboratorio para la pestaña de liverpool.com.mx/robots.txt: las reglas y el
// núcleo de la 2.9 (de git) y los del árbol de trabajo, lado a lado (`__lab.v29` y `__lab.n`), más
// lab.js y el lector, la bolsa y la medición de la 3.0.
//   node armar-banco.cjs [commit de la versión vieja] [archivo de salida]
// Por omisión compara con 6f8ab4c (la 2.9) y escribe banco.js en la carpeta temporal del sistema:
// el banco no va al repo. Se sube a la pestaña con un <input type=file> y `(0, eval)(texto)`.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
// La 2.9 tal como está en Drive: el commit del que nació la rama (main ya no sirve de referencia al fusionar).
const BASE = process.argv[2] || '6f8ab4c';
const WT = REPO;
const EXT = path.join(WT, 'Extencion para chrome');
const deGit = (ruta) => execFileSync('git', ['-C', REPO, 'show', BASE + ':Extencion para chrome/' + ruta], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const deWt = (ruta) => fs.readFileSync(path.join(EXT, ruta), 'utf8');

function version(nombre, reglas, nucleo, extras) {
  return '\n;(function () {\n' +
    'var __R = (function () {\n' + reglas + '\n;return VENTEL_REGLAS; })();\n' +
    'var __antes = globalThis.VentelVM;\n' +
    nucleo + '\n' +
    'var __VM = globalThis.VentelVM; globalThis.VentelVM = __antes;\n' +
    'window.__lab = window.__lab || {};\n' +
    'window.__lab[' + JSON.stringify(nombre) + '] = { VM: __VM, R: __R };\n' +
    (extras || '') +
    '})();\n';
}

let extrasN = '';
for (const f of ['lector-liverpool.js', 'bolsa-liverpool.js', 'medicion-local.js']) {
  if (fs.existsSync(path.join(EXT, f))) extrasN += '\n' + deWt(f) + '\n';
}
if (extrasN) extrasN += 'window.__lab.n.Lector = globalThis.VentelLector; window.__lab.n.Bolsa = globalThis.VentelBolsa; window.__lab.n.Medicion = globalThis.VentelMedicion;\n';

const banco = '/* banco de laboratorio ' + new Date().toISOString() + ' */\n' +
  version('v29', deGit('reglas-venta.js'), deGit('recomendador-nucleo.js')) +
  version('n', deWt('reglas-venta.js'), deWt('recomendador-nucleo.js'), extrasN) +
  '\n' + fs.readFileSync(path.join(__dirname, 'lab.js'), 'utf8') + '\n' +
  ';window.__lab.armado = ' + JSON.stringify(new Date().toISOString()) + ';\n';
const SALIDA = process.argv[3] || path.join(require('os').tmpdir(), 'banco.js');
fs.writeFileSync(SALIDA, banco);
// Sintaxis: que al menos cargue en Node con un window de mentira.
const vm = require('vm');
new vm.Script(banco, { filename: 'banco.js' });
console.log(SALIDA, banco.length, 'caracteres');
