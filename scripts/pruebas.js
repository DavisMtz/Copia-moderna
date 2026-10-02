/*
 * TODAS las pruebas, de una vez: la sintaxis y cada suite de pruebas/, una tras otra.
 *   node scripts/pruebas.js      (o: npm test)
 *
 * Es el «todo en verde antes de tocar nada» del arranque del doc 16 en un solo comando,
 * y lo que corre el flujo de GitHub «Pruebas» (F6 del doc 16) en cada push.
 *
 * Cada suite corre en su propio proceso: una que revienta no se lleva a las demás, y
 * así se ve la lista entera de lo que falla y no solo lo primero. Las suites nuevas
 * entran solas: basta con que el archivo termine en .test.js.
 *
 * Sale con código 1 si falla cualquiera. Si existe GITHUB_STEP_SUMMARY (en GitHub),
 * escribe además la tabla en el resumen del flujo.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const suites = fs.readdirSync(path.join(RAIZ, 'pruebas'))
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => 'pruebas/' + f);
const tareas = ['scripts/sintaxis.js'].concat(suites);

const filas = [];
let fallos = 0;
const t0Total = Date.now();
for (const t of tareas) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(RAIZ, t)], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ms = Date.now() - t0;
  const salida = (r.stdout || '') + (r.stderr || '');
  const ultima = (salida.trim().split(/\r?\n/).pop() || '').trim();
  const ok = r.status === 0;
  if (!ok) {
    fallos++;
    // La salida entera solo de lo que falla: con 20 suites en verde, el detalle es ruido.
    console.log('\n──── ' + t + ' (código ' + r.status + ') ────\n' + salida.trimEnd() + '\n');
  }
  filas.push({ t, ok, ms, ultima });
  console.log((ok ? '✔ ' : '✖ ') + t.padEnd(42) + (ms / 1000).toFixed(1).padStart(6) + ' s   ' + ultima.slice(0, 80));
}

const resumen = fallos
  ? '✖ ' + fallos + ' de ' + tareas.length + ' fallaron'
  : '✔ ' + tareas.length + ' en verde';
console.log('\n' + resumen + ' (' + ((Date.now() - t0Total) / 1000).toFixed(0) + ' s)');

if (process.env.GITHUB_STEP_SUMMARY) {
  const celda = (s) => String(s).replace(/\|/g, '\\|');
  const md = ['### Pruebas · ' + resumen, '', '| | Suite | s | Última línea |', '|---|---|---:|---|']
    .concat(filas.map((f) => '| ' + (f.ok ? '✔' : '✖') + ' | `' + f.t + '` | ' + (f.ms / 1000).toFixed(1) + ' | ' + celda(f.ultima.slice(0, 100)) + ' |'));
  try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n'); } catch (e) { /* el resumen es un extra */ }
}

process.exit(fallos ? 1 : 0);
