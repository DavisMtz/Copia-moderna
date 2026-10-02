/*
 * F6 del doc 16 · Nombres y tipos del SERVIDOR (01/10/2026).   node pruebas/tipos.test.js
 *
 * Apps Script mete todos los .gs en UN SOLO espacio de nombres. Dos archivos que declaran el
 * mismo nombre no dan error al subir: una función repetida pisa a la otra en silencio (gana la
 * que se cargue después) y una `const` repetida tumba el proyecto entero al cargarlo. Con unos
 * 1000 nombres globales y agentes añadiendo funciones, es cuestión de tiempo.
 *
 *   A · Nombres de nivel superior repetidos entre .gs (con acorn): funciones, var, let y const.
 *   B · `tsc --checkJs` (TypeScript + @types/google-apps-script) sobre una copia de los .gs.
 *       Solo HACEN FALLAR las clases de error que rompen en ejecución: un nombre que no existe,
 *       una redeclaración, una errata en la API de Apps Script que el compilador sabe corregir,
 *       llamar a algo que no es función o asignar a una constante. El resto —unos 440 avisos de
 *       JS sin tipos, sobre todo propiedades de objetos que se arman sobre la marcha— solo se
 *       cuenta: limpiarlo sería reescribir, y la F6 es «sin reescribir».
 *
 * Los falsos positivos ya revisados van en ACEPTADOS, cada uno con su porqué.
 * Necesita `npm ci` (typescript y @types/google-apps-script son devDependencies).
 * Esta carpeta queda fuera de "Carpeta del proyecto": clasp nunca la sube.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PROY = path.join(RAIZ, 'Carpeta del proyecto');
let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '\n      → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra, null, 1)).split('\n').join('\n        ') : ''));
}

const archivosGs = fs.readdirSync(PROY).filter((f) => f.endsWith('.gs')).sort();

console.log('\nA · Ningún nombre global repetido entre los .gs');
const acorn = require('acorn');
const donde = {};
archivosGs.forEach((f) => {
  const ast = acorn.parse(fs.readFileSync(path.join(PROY, f), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  ast.body.forEach((n) => {
    const nombres = [];
    if (n.type === 'FunctionDeclaration' && n.id) nombres.push(n.id.name);
    if (n.type === 'ClassDeclaration' && n.id) nombres.push(n.id.name);
    if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => { if (d.id.type === 'Identifier') nombres.push(d.id.name); });
    nombres.forEach((x) => { (donde[x] = donde[x] || []).push(f); });
  });
});
const repetidos = Object.keys(donde).filter((k) => donde[k].length > 1).map((k) => k + ' → ' + donde[k].join(', '));
ok(archivosGs.length + ' archivos, ' + Object.keys(donde).length + ' nombres globales, ninguno repetido', repetidos.length === 0, repetidos.join('\n'));

console.log('\nB · tsc --checkJs: lo que rompe en ejecución');
/* Las clases de error que hacen fallar. Las demás se cuentan y ya. */
const GRAVES = {
  2304: 'nombre que no existe',
  2552: 'nombre que no existe (con sugerencia)',
  2451: 'variable redeclarada',
  2300: 'identificador duplicado',
  2551: 'propiedad con errata (con sugerencia)',
  2349: 'se llama a algo que no es función',
  2588: 'se asigna a una constante'
};
/* Falsos positivos revisados a mano: [archivo, código, texto del mensaje, porqué]. */
const ACEPTADOS = [
  ['Atenciones', 2551, "Property 'toISOString' does not exist on type 'string | Date'",
    'atenLiberarEnDesde_ devuelve una fecha o "" y la línea ya comprueba que no esté vacío antes de llamar a toISOString'],
];
/* Los tipos que el código escribe en sus comentarios JSDoc ({Sheet}, {Blob}…) viven con
   espacio de nombres en @types/google-apps-script: sin estos alias saldrían como «nombre que
   no existe» sin serlo. */
const ALIAS = [
  'type Sheet = GoogleAppsScript.Spreadsheet.Sheet;',
  'type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;',
  'type Range = GoogleAppsScript.Spreadsheet.Range;',
  'type Blob = GoogleAppsScript.Base.Blob;',
  'type Folder = GoogleAppsScript.Drive.Folder;',
  'type File = GoogleAppsScript.Drive.File;'
].join('\n');

const tsc = path.join(RAIZ, 'node_modules', 'typescript', 'bin', 'tsc');
const tipos = path.join(RAIZ, 'node_modules', '@types', 'google-apps-script');
if (!fs.existsSync(tsc) || !fs.existsSync(tipos)) {
  ok('typescript y @types/google-apps-script instalados', false, 'Falta `npm ci` en la raíz del repo.');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tipos-portal-'));
  try {
    fs.mkdirSync(path.join(tmp, 'src'));
    archivosGs.forEach((f) => fs.copyFileSync(path.join(PROY, f), path.join(tmp, 'src', f.replace(/\.gs$/, '.js'))));
    fs.writeFileSync(path.join(tmp, 'alias.d.ts'), ALIAS + '\n');
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
        target: 'es2020', lib: ['es2020'], strict: false, noImplicitAny: false,
        moduleDetection: 'legacy',   // todos los .gs comparten el ámbito global, como en Apps Script
        types: ['google-apps-script'], typeRoots: [path.join(RAIZ, 'node_modules', '@types')]
      },
      include: ['src/**/*.js', 'alias.d.ts']
    }, null, 2));

    const r = spawnSync(process.execPath, [tsc, '-p', tmp, '--pretty', 'false'], { cwd: tmp, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const salida = (r.stdout || '') + (r.stderr || '');
    const diag = [];
    salida.split(/\r?\n/).forEach((l) => {
      const m = /^src[\\/](.+?)\.js\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(l);
      if (m) diag.push({ archivo: m[1], linea: +m[2], codigo: +m[4], mensaje: m[5] });
    });
    // tsc sale con 2 cuando hay errores de tipos: lo raro es que no diga nada y falle igual.
    ok('tsc corrió y su salida se entiende', r.status === 0 || diag.length > 0, salida.slice(0, 600));

    const porCodigo = {};
    diag.forEach((d) => { porCodigo[d.codigo] = (porCodigo[d.codigo] || 0) + 1; });
    const masComunes = Object.keys(porCodigo).sort((a, b) => porCodigo[b] - porCodigo[a]).slice(0, 4)
      .map((c) => 'TS' + c + '×' + porCodigo[c]).join(', ');
    console.log('    (' + diag.length + ' avisos en total, que solo se cuentan: ' + masComunes + ')');

    const aceptado = (d) => ACEPTADOS.some((a) => a[0] === d.archivo && a[1] === d.codigo && d.mensaje.indexOf(a[2]) === 0);
    const graves = diag.filter((d) => GRAVES[d.codigo] && !aceptado(d))
      .map((d) => d.archivo + '.gs:' + d.linea + ' · TS' + d.codigo + ' (' + GRAVES[d.codigo] + '): ' + d.mensaje);
    ok('ningún error de los que rompen en ejecución', graves.length === 0, graves.join('\n'));

    const vigentes = ACEPTADOS.filter((a) => diag.some((d) => a[0] === d.archivo && a[1] === d.codigo && d.mensaje.indexOf(a[2]) === 0));
    ok('cada aceptado sigue apareciendo (si ya no sale, se quita de la lista)', vigentes.length === ACEPTADOS.length,
      ACEPTADOS.filter((a) => vigentes.indexOf(a) < 0).map((a) => a[0] + ' TS' + a[1]).join(', '));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
