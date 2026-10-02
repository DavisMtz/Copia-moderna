/*
 * F6 del doc 16 · Choques de nombres globales DENTRO de cada pantalla (01/10/2026).
 *   node pruebas/globales_pantallas.test.js
 *
 * En el navegador, todos los <script> clásicos de una página comparten el ámbito global.
 * Si dos parciales incluidos en la misma pantalla declaran el mismo nombre:
 *   · con let, const o class (o uno de esos contra un var/function): el SEGUNDO bloque lanza
 *     «Identifier has already been declared» al cargar y no se ejecuta NADA de él;
 *   · con function o var en dos bloques: el segundo pisa al primero en silencio.
 * El build comprueba cada bloque por separado (que compile y conserve sus globales), no los
 * choques entre bloques; el banco los vería como excepción, pero necesita Chrome y no corre en
 * GitHub. Esto lo mira sin navegador en las 20 pantallas, armadas como include() (un nivel,
 * sin evaluar el parcial, igual que banco.mjs).
 *
 * Hoy: 0 choques en 407 bloques. Si alguna vez hace falta pisar a propósito, va en PERMITIDOS
 * con su porqué.
 * Esta carpeta queda fuera de "Carpeta del proyecto": clasp nunca la sube.
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');
let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '\n      → ' + String(extra).split('\n').join('\n        ') : ''));
}

/* [pantalla, nombre, porqué] de los choques que se aceptan a propósito. */
const PERMITIDOS = [];

const leer = (f) => fs.readFileSync(path.join(PROY, f), 'utf8');
const code = leer('Code.gs');
const pantallas = [...new Set([...code.matchAll(/\bfile:\s*'([^']+)'/g)].map((m) => m[1]))];

/* La pantalla como la arma include(): cada <?!= include('x') ?> pegado tal cual; el resto de
   scriptlets (APP_JSON, APP_URL…) se cambia por un literal, que es lo que dejaría el servidor. */
function ensamblar(pantalla) {
  return leer(pantalla + '.html').replace(/<\?(!=|=)?([\s\S]*?)\?>/g, (m, tipo, cuerpo) => {
    const inc = /^\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/.exec(cuerpo);
    if (tipo === '!=' && inc) return leer(inc[1].replace(/\.html$/, '') + '.html');
    return '{}';
  });
}

console.log('\nLas ' + pantallas.length + ' pantallas, cada una con todos sus <script>');
let bloquesTotales = 0, declaraciones = 0, ilegibles = [];
const choques = [];
pantallas.forEach((p) => {
  const html = ensamblar(p);
  const bloques = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="(?:module|application\/json|text\/template|text\/plain)")[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]);
  bloquesTotales += bloques.length;
  const lex = {}, otros = {};
  bloques.forEach((b, i) => {
    let ast;
    try { ast = acorn.parse(b, { ecmaVersion: 'latest', sourceType: 'script' }); }
    catch (e) { ilegibles.push(p + ' bloque ' + i + ': ' + e.message); return; }
    ast.body.forEach((n) => {
      const apunta = (mapa, nombre) => { (mapa[nombre] = mapa[nombre] || []).push(i); declaraciones++; };
      if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => {
        if (d.id.type === 'Identifier') apunta(n.kind === 'var' ? otros : lex, d.id.name);
      });
      if (n.type === 'ClassDeclaration' && n.id) apunta(lex, n.id.name);
      if (n.type === 'FunctionDeclaration' && n.id) apunta(otros, n.id.name);
    });
  });
  const permitido = (nombre) => PERMITIDOS.some((x) => x[0] === p && x[1] === nombre);
  Object.keys(lex).forEach((k) => {
    if ((lex[k].length > 1 || otros[k]) && !permitido(k)) {
      choques.push(p + ': «' + k + '» (let/const/class) en los bloques ' + lex[k].concat(otros[k] || []).join(', ') + ' → el segundo NO se ejecuta');
    }
  });
  Object.keys(otros).forEach((k) => {
    if (new Set(otros[k]).size > 1 && !lex[k] && !permitido(k)) {
      choques.push(p + ': «' + k + '» (function/var) en los bloques ' + otros[k].join(', ') + ' → el último pisa a los demás');
    }
  });
});
ok('todos los bloques se leen (' + bloquesTotales + ' en ' + pantallas.length + ' pantallas, ' + declaraciones + ' declaraciones globales)',
  ilegibles.length === 0 && bloquesTotales > 300, ilegibles.join('\n'));
ok('ningún nombre global declarado dos veces en la misma pantalla', choques.length === 0, choques.join('\n'));
ok('cada permitido sigue haciendo falta', PERMITIDOS.every((x) => pantallas.indexOf(x[0]) > -1), JSON.stringify(PERMITIDOS));

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
