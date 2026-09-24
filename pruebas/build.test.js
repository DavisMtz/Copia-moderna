/*
 * Pruebas del build del Apps Script (scripts/build.js, Fase 1 del doc 16).
 *   Ejecutar:  node pruebas/build.test.js
 *
 * Corre el build REAL a una carpeta temporal y comprueba por su cuenta, sin fiarse de las
 * comprobaciones internas del build, lo que no puede romperse: que se sube lo mismo, que cada
 * .gs es el mismo programa con las mismas líneas y que verificarVersionDelCodigo sigue viendo sus
 * marcas. Después prueba la limpieza con casos trampa y que un fallo no deje nada que subir.
 * Esta carpeta queda fuera de "Carpeta del proyecto": clasp nunca la sube.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const acorn = require('acorn');
const B = require('../scripts/build.js');

const FUENTE = path.join(__dirname, '..', 'Carpeta del proyecto');
const BUILD = path.join(__dirname, '..', 'scripts', 'build.js');
let fallos = 0, total = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) console.log('  ✔ ' + nombre);
  else { fallos++; console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function correr(args) {
  try { return { codigo: 0, salida: execFileSync(process.execPath, [BUILD].concat(args), { encoding: 'utf8', stdio: 'pipe' }) }; }
  catch (e) { return { codigo: e.status, salida: String(e.stdout) + String(e.stderr) }; }
}
const OPC = { ecmaVersion: 'latest', sourceType: 'script' };
const comentarios = (s) => { let n = 0; acorn.parse(s, Object.assign({}, OPC, { onComment: () => n++ })); return n; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-portal-'));

/* ── 1 · El build real ───────────────────────────────────────────────── */
console.log('1 · Build de «Carpeta del proyecto»');
const salida = path.join(tmp, 'build');
const r = correr(['--salida', salida]);
ok('termina bien', r.codigo === 0, r.salida);

const subibles = (dir) => fs.readdirSync(dir).filter((f) => /\.(gs|html)$/.test(f) || f === 'appsscript.json').sort();
ok('sube exactamente los mismos archivos que la fuente', subibles(salida).join() === subibles(FUENTE).join(),
   { fuente: subibles(FUENTE).length, salida: subibles(salida).length });
ok('ningún archivo de más que clasp pudiera subir', fs.readdirSync(salida).every((f) => f.startsWith('.') || subibles(salida).includes(f)));

const conf = JSON.parse(fs.readFileSync(path.join(salida, '.clasp.json'), 'utf8'));
const confFuente = JSON.parse(fs.readFileSync(path.join(FUENTE, '.clasp.json'), 'utf8'));
ok('.clasp.json apunta al mismo proyecto que la fuente, con rootDir "."', conf.scriptId === confFuente.scriptId && conf.rootDir === '.', conf);
ok('lleva el .claspignore de la fuente', fs.readFileSync(path.join(salida, '.claspignore'), 'utf8') === fs.readFileSync(path.join(FUENTE, '.claspignore'), 'utf8'));

const iguales = subibles(FUENTE).filter((f) => !f.endsWith('.gs'))
  .filter((f) => !fs.readFileSync(path.join(FUENTE, f)).equals(fs.readFileSync(path.join(salida, f))));
ok('los .html y appsscript.json salen byte a byte', iguales.length === 0, iguales);

const gs = subibles(FUENTE).filter((f) => f.endsWith('.gs'));
const lee = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const lineas = (s) => s.split('\n').length;
const mal = { compila: [], lineas: [], arbol: [], globales: [], comentarios: [], crlf: [] };
let antes = 0, despues = 0;
for (const f of gs) {
  const s = lee(FUENTE, f), t = lee(salida, f);
  antes += s.length; despues += t.length;
  try { new Function(t); } catch (e) { mal.compila.push(f); }
  if (lineas(s) !== lineas(t)) mal.lineas.push(f);
  if (B.arbolSinPosiciones(s) !== B.arbolSinPosiciones(t)) mal.arbol.push(f);
  if (B.nombresGlobales(s).join() !== B.nombresGlobales(t).join()) mal.globales.push(f);
  if (comentarios(t) !== 0) mal.comentarios.push(f);
  if (t.indexOf('\r\n') !== -1) mal.crlf.push(f);
}
ok('los ' + gs.length + ' .gs compilan', mal.compila.length === 0, mal.compila);
ok('cada .gs conserva su número de líneas', mal.lineas.length === 0, mal.lineas);
ok('cada .gs es el mismo programa (árbol idéntico sin posiciones)', mal.arbol.length === 0, mal.arbol);
ok('mismos nombres globales y en el mismo orden', mal.globales.length === 0, mal.globales);
ok('no queda ningún comentario', mal.comentarios.length === 0, mal.comentarios);
ok('los finales de línea quedan en LF', mal.crlf.length === 0, mal.crlf);
ok('los .gs pesan al menos un 30 % menos', despues < antes * 0.7, { antes, despues });

// verificarVersionDelCodigo: la misma búsqueda que hace en Apps Script, sobre el texto de salida.
const marcas = B.marcasDeVersion(lee(FUENTE, 'Admin.gs'));
ok('se leen las marcas de verificarVersionDelCodigo (' + (marcas ? marcas.length : 0) + ')', marcas && marcas.length >= 10);
const textoDe = (dir, nombre) => {
  for (const f of gs) { const s = lee(dir, f); for (const n of acorn.parse(s, OPC).body) {
    if (n.type === 'FunctionDeclaration' && n.id.name === nombre) return s.slice(n.start, n.end);
  } }
  return '';
};
const enFuente = (marcas || []).filter(({ nombre, marca }) => textoDe(FUENTE, nombre).indexOf(marca) !== -1);
const perdidas = enFuente.filter(({ nombre, marca }) => textoDe(salida, nombre).indexOf(marca) === -1);
ok('ninguna marca que estaba en el fuente se pierde (' + enFuente.length + ' de ' + (marcas || []).length + ')',
   enFuente.length >= 10 && perdidas.length === 0, perdidas);
// Una marca que ya falta en el fuente no la rompe el build: la reporta el propio editor.
(marcas || []).filter((m) => !enFuente.includes(m))
  .forEach(({ nombre, marca }) => console.log('    (aviso: la marca «' + marca + '» ya no está en ' + nombre + ' en el fuente)'));

// Los candados de la Fase 0 siguen siendo la primera línea (pruebas/sesiones.test.js lo exige en la fuente).
const code = lee(salida, 'Code.gs');
ok('el candado de getScriptUrl sigue siendo su primera línea', /function getScriptUrl\(\) \{\nsecSoloInterno_\('getScriptUrl'\);/.test(code));

/* ── 2 · La limpieza, con casos trampa ──────────────────────────────── */
console.log('\n2 · Casos trampa de la limpieza');
const L = B.limpiarGs;
ok('un comentario entre dos palabras deja un espacio', L('var x = a/**/in b;') === 'var x = a in b;', L('var x = a/**/in b;'));
ok('la sangría dentro de una plantilla multilínea se respeta',
   L('function f() {\n  return `<p>\n    hola\n  </p>`;\n}') === 'function f() {\nreturn `<p>\n    hola\n  </p>`;\n}',
   L('function f() {\n  return `<p>\n    hola\n  </p>`;\n}'));
ok('los espacios del final dentro de una plantilla se respetan', L('var t = `a  \nb`;') === 'var t = `a  \nb`;');
ok('el código dentro de ${…} sí se limpia', L('var t = `a${\n    x /* y */\n}b`;') === 'var t = `a${\nx\n}b`;', L('var t = `a${\n    x /* y */\n}b`;'));
ok('// dentro de una cadena no es un comentario', L("var u = 'https://x.com/a'; // fin") === "var u = 'https://x.com/a';");
ok('/* dentro de una plantilla no es un comentario', L('var c = `/* no */`;') === 'var c = `/* no */`;');
ok('// dentro de una expresión regular no es un comentario', L('var r = /a\\/\\/b/g; // c') === 'var r = /a\\/\\/b/g;');
ok('un bloque de varias líneas deja sus saltos', L('a();\n/* uno\n   dos */\nb();') === 'a();\n\n\nb();');
ok('el salto de línea de un bloque sigue separando sentencias', L('var a = 1\n/*\n*/b()') === 'var a = 1\n\nb()');
ok('CRLF pasa a LF sin cambiar el número de líneas', L('a();\r\n  b();\r\n') === 'a();\nb();\n');
ok('la continuación de línea en una cadena se respeta', L("var s = 'uno \\\n  dos';") === "var s = 'uno \\\n  dos';");

/* ── 3 · Un fallo no deja nada que subir ────────────────────────────── */
console.log('\n3 · Fallos');
const fuenteRota = path.join(tmp, 'fuente-rota');
fs.mkdirSync(fuenteRota);
fs.writeFileSync(path.join(fuenteRota, 'appsscript.json'), '{}');
fs.writeFileSync(path.join(fuenteRota, '.clasp.json'), JSON.stringify({ scriptId: 'x', rootDir: '.' }));
fs.writeFileSync(path.join(fuenteRota, 'Bien.gs'), 'function a() { return 1; }\n');
fs.writeFileSync(path.join(fuenteRota, 'Roto.gs'), 'function b( { \n');
const salidaRota = path.join(tmp, 'build-roto');
fs.mkdirSync(salidaRota); fs.writeFileSync(path.join(salidaRota, 'viejo.gs'), 'resto de un build anterior');
const r2 = correr(['--fuente', fuenteRota, '--salida', salidaRota]);
ok('un .gs roto hace fallar el build', r2.codigo !== 0, r2.salida);
ok('…y no deja carpeta de salida (ni el build anterior)', !fs.existsSync(salidaRota));

// Con el Admin.gs real al lado, la lectura de marcas recorre también el archivo roto: pasó en
// la prueba del hook que eso reventaba el build y dejaba la salida a medias.
fs.copyFileSync(path.join(FUENTE, 'Admin.gs'), path.join(fuenteRota, 'Admin.gs'));
fs.mkdirSync(salidaRota);
const r2b = correr(['--fuente', fuenteRota, '--salida', salidaRota]);
ok('un .gs roto junto a Admin.gs falla con su motivo, sin reventar', r2b.codigo !== 0 && /· Roto\.gs: no se pudo leer/.test(r2b.salida) && !/at .*acorn/.test(r2b.salida), r2b.salida);
ok('…y tampoco deja carpeta de salida', !fs.existsSync(salidaRota));

fs.writeFileSync(path.join(fuenteRota, 'Roto.gs'), 'function b() {}\n');
fs.writeFileSync(path.join(fuenteRota, 'suelto.js'), 'var z;');
const r3 = correr(['--fuente', fuenteRota, '--salida', salidaRota]);
ok('un archivo que clasp subiría y el build no conoce lo para', r3.codigo !== 0 && /suelto\.js/.test(r3.salida), r3.salida);
fs.rmSync(path.join(fuenteRota, 'suelto.js'));

const r4 = correr(['--fuente', fuenteRota, '--salida', path.join(fuenteRota, 'build')]);
ok('se niega a escribir dentro de la fuente', r4.codigo !== 0 && fs.existsSync(path.join(fuenteRota, 'Bien.gs')), r4.salida);
const r5 = correr(['--fuente', fuenteRota, '--salida', tmp]);
ok('se niega a borrar una carpeta que contiene la fuente', r5.codigo !== 0 && fs.existsSync(path.join(fuenteRota, 'Bien.gs')), r5.salida);

const r6 = correr(['--fuente', fuenteRota, '--salida', salidaRota, '--sin-clasp']);
ok('--sin-clasp no escribe .clasp.json', r6.codigo === 0 && !fs.existsSync(path.join(salidaRota, '.clasp.json')), r6.salida);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
