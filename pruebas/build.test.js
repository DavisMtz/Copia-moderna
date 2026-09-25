/*
 * Pruebas del build del Apps Script (scripts/build.js, Fases 1 y 2 del doc 16).
 *   Ejecutar:  node pruebas/build.test.js
 *
 * Corre el build REAL a una carpeta temporal y comprueba por su cuenta, sin fiarse de las
 * comprobaciones internas del build, lo que no puede romperse: que se sube lo mismo, que cada
 * .gs es el mismo programa con las mismas líneas y que verificarVersionDelCodigo sigue viendo sus
 * marcas; que cada página es la fuente sin comentarios, con el mismo marcado y el mismo JS; que
 * cada parcial compilado se deja leer y no pierde globales; y que ningún <script> de la salida
 * lleva lo que corta el quitacomentarios de Google (modelo en pruebas/quitacomentarios_google.js).
 * Después prueba la limpieza con casos trampa y que un fallo no deje nada que subir.
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

ok('appsscript.json sale byte a byte',
   fs.readFileSync(path.join(FUENTE, 'appsscript.json')).equals(fs.readFileSync(path.join(salida, 'appsscript.json'))));

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

/* ── 1b · Los .html (Fase 2) ─────────────────────────────────────────── */
console.log('\n1b · Los .html (Fase 2)');
const htmls = subibles(FUENTE).filter((f) => f.endsWith('.html'));
const parciales = htmls.filter(B.esParcial), paginas = htmls.filter((f) => !B.esParcial(f));
const leeLF = (dir, f) => lee(dir, f).replace(/\r\n/g, '\n');
ok('hay parciales y páginas (' + parciales.length + ' y ' + paginas.length + ')', parciales.length >= 20 && paginas.length >= 18);

// Páginas: fuera los <!-- … --> del marcado (ninguno con un scriptlet), y todo lo demás sale como
// estaba salvo el JS clásico: cada <script> es el MISMO programa que el de la fuente, con sus mismas
// líneas y sin comentarios. Sus scriptlets se cambian por el mismo nombre en los dos lados para
// poder leerlos.
const malPag = { conScriptlet: [], quedan: [], secuencia: [], difiere: [], scriptlets: [], programa: [], lineas: [], comentarios: [] };
let comentariosQuitados = 0, guionesDePagina = 0, conComentarios = 0;
const lineaEn = (s, pos) => s.slice(0, pos).split('\n').length;
const scriptletsDe = (s) => JSON.stringify(s.match(/<\?[\s\S]*?\?>/g) || []);
const conRelleno = (js) => { let k = 0; return js.replace(/<\?[\s\S]*?\?>/g, () => '__relleno' + (k++) + '__'); };
const trozosSinComentarios = (s) => {
  const out = [];
  for (const t of B.trocearHtml(s, true)) {
    if (t.t === 'comentario') continue;
    const u = out[out.length - 1];
    if (t.t === 'marcado' && u && u.t === 'marcado') u.texto += t.texto;   // lo que un comentario separaba
    else out.push(Object.assign({}, t));
  }
  return out;
};
for (const f of paginas) {
  const a = leeLF(FUENTE, f), b = lee(salida, f);
  const deFuente = B.trocearHtml(a, true).filter((t) => t.t === 'comentario');
  comentariosQuitados += deFuente.length;
  if (deFuente.some((t) => t.texto.indexOf('<?') !== -1)) malPag.conScriptlet.push(f);
  if (B.trocearHtml(b, true).some((t) => t.t === 'comentario')) malPag.quedan.push(f);
  if (scriptletsDe(a) !== scriptletsDe(b)) malPag.scriptlets.push(f);
  const ta = trozosSinComentarios(a), tb = trozosSinComentarios(b);
  if (ta.map((t) => t.t).join() !== tb.map((t) => t.t).join()) { malPag.secuencia.push(f); continue; }
  ta.forEach((x, k) => {
    const y = tb[k], donde = f + ':' + lineaEn(a, x.ini);
    if (!(x.t === 'script' && B.esJsClasico(x.apertura) && x.contenido.trim())) {
      if (x.texto !== y.texto) malPag.difiere.push(donde + ' ' + JSON.stringify(x.texto.slice(0, 50)));
      return;
    }
    guionesDePagina++;
    if (x.apertura !== y.apertura || x.cierre !== y.cierre) { malPag.difiere.push(donde + ': las etiquetas de un <script>'); return; }
    const ja = conRelleno(x.contenido), jb = conRelleno(y.contenido);
    try {
      if (comentarios(ja)) conComentarios++;
      if (B.arbolSinCrudo(ja) !== B.arbolSinCrudo(jb)) malPag.programa.push(donde);
      if (comentarios(jb)) malPag.comentarios.push(donde);
    } catch (e) { malPag.programa.push(donde + ' ' + e.message); }
    if (lineas(x.contenido) !== lineas(y.contenido)) malPag.lineas.push(donde);
  });
}
ok('páginas: se quitaron los comentarios del marcado (' + comentariosQuitados + ')', comentariosQuitados > 50);
ok('…ninguno llevaba un scriptlet (Google lo habría ejecutado)', malPag.conScriptlet.length === 0, malPag.conScriptlet);
ok('…y no queda ninguno', malPag.quedan.length === 0, malPag.quedan);
ok('…sus scriptlets siguen idénticos y en orden', malPag.scriptlets.length === 0, malPag.scriptlets);
ok('…la misma secuencia de marcado y bloques', malPag.secuencia.length === 0, malPag.secuencia);
ok('…el marcado, los <style>, los bloques opacos y el JS que no es clásico salen byte a byte', malPag.difiere.length === 0, malPag.difiere);
ok('…cada uno de sus ' + guionesDePagina + ' <script> es el mismo programa que en la fuente', guionesDePagina >= 60 && malPag.programa.length === 0, malPag.programa);
ok('…con las mismas líneas', malPag.lineas.length === 0, malPag.lineas);
ok('…y sin comentarios (' + conComentarios + ' los tenían)', conComentarios >= 20 && malPag.comentarios.length === 0, malPag.comentarios);

// Parciales: los mismos bloques y en el mismo orden; el marcado es el de la fuente sin comentarios;
// cada JS compilado se deja leer, no lleva comentarios ni </script, declara los mismos globales y
// no trae plantillas `…` nuevas con //, /* o saltos de línea (issue 156139610 de Google).
const malPar = { bloques: [], marcado: [], lee: [], comentarios: [], cierre: [], globales: [], plantillas: [], css: [] };
let pesoA = 0, pesoB = 0, bloquesJs = 0;
const peligrosasDe = (js) => {
  const out = [];
  (function visita(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'TemplateLiteral') {
      const crudo = n.quasis.map((q) => q.value.raw).join('${}');
      if (/\/\/|\/\*|[\r\n]/.test(crudo)) out.push(crudo);
    }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visita); else if (v && typeof v.type === 'string') visita(v); }
  })(acorn.parse(js, OPC));
  return out;
};
const firmaBloques = (ts) => JSON.stringify(ts.filter((t) => t.t !== 'marcado' && t.t !== 'comentario').map((t) => t.t + (t.apertura || '')));
const marcadoDe = (ts) => ts.filter((t) => t.t === 'marcado').map((t) => t.texto).join('');
for (const f of parciales) {
  const a = leeLF(FUENTE, f), b = lee(salida, f);
  pesoA += Buffer.byteLength(a); pesoB += Buffer.byteLength(b);
  const ta = B.trocearHtml(a, false), tb = B.trocearHtml(b, false);
  if (firmaBloques(ta) !== firmaBloques(tb)) { malPar.bloques.push(f); continue; }
  if (tb.some((t) => t.t === 'comentario') || marcadoDe(ta) !== marcadoDe(tb)) malPar.marcado.push(f);
  const ga = ta.filter((t) => t.t === 'script'), gb = tb.filter((t) => t.t === 'script');
  gb.forEach((g, k) => {
    const src = ga[k];
    if (!B.esJsClasico(g.apertura) || !src.contenido.trim()) {
      if (g.contenido !== src.contenido) malPar.bloques.push(f + ' (un <script> que no es JS clásico cambió)');
      return;
    }
    bloquesJs++;
    let n = 0;
    try { acorn.parse(g.contenido, Object.assign({}, OPC, { onComment: () => n++ })); } catch (e) { malPar.lee.push(f + ': ' + e.message); return; }
    if (n) malPar.comentarios.push(f);
    if (/<\/script/i.test(g.contenido)) malPar.cierre.push(f);
    if (B.globalesDeGuion(g.contenido).join() !== B.globalesDeGuion(src.contenido).join()) malPar.globales.push(f);
    const yaEstaban = new Set(peligrosasDe(src.contenido));
    const nuevas = peligrosasDe(g.contenido).filter((x) => !yaEstaban.has(x));
    if (nuevas.length) malPar.plantillas.push(f + ': ' + nuevas[0].slice(0, 60));
  });
  tb.filter((t) => t.t === 'style').forEach((st) => { if (/<\/style|\/\*/i.test(st.contenido)) malPar.css.push(f); });
}
ok('cada parcial conserva sus bloques <script>/<style>, en orden y con las mismas etiquetas', malPar.bloques.length === 0, malPar.bloques);
ok('…su marcado es el de la fuente sin comentarios', malPar.marcado.length === 0, malPar.marcado);
ok('…sus ' + bloquesJs + ' bloques de JS compilados se dejan leer', bloquesJs >= 20 && malPar.lee.length === 0, malPar.lee);
ok('…sin comentarios', malPar.comentarios.length === 0, malPar.comentarios);
ok('…sin </script', malPar.cierre.length === 0, malPar.cierre);
ok('…con los mismos nombres globales y del mismo tipo', malPar.globales.length === 0, malPar.globales);
ok('…sin plantillas `…` nuevas con //, /* o saltos de línea', malPar.plantillas.length === 0, malPar.plantillas);
ok('…y su CSS sale sin comentarios', malPar.css.length === 0, malPar.css);
ok('los parciales pesan al menos un 35 % menos', pesoB < pesoA * 0.65, { pesoA, pesoB });

// Cada página ensamblada como la ve el navegador: sus scriptlets fuera y los include() pegados
// (un solo nivel, como hace include()). Misma secuencia de bloques con la fuente y con la salida,
// y todo el JS que no venía de un scriptlet se deja leer.
const INCLUDE = /<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g;
const ensambla = (dir, f) => {
  const nombres = [];
  return leeLF(dir, f)
    .replace(INCLUDE, (m, n) => { nombres.push(n.replace(/\.html$/, '') + '.html'); return 'INCLUIR_' + (nombres.length - 1) + '_'; })
    .replace(/<\?[\s\S]*?\?>/g, '__SCRIPTLET__')
    .replace(/INCLUIR_(\d+)_/g, (m, k) => (fs.existsSync(path.join(dir, nombres[+k])) ? leeLF(dir, nombres[+k]) : ''));
};
const malEns = [];
for (const f of paginas) {
  let ta, tb;
  try { ta = B.trocearHtml(ensambla(FUENTE, f), false); tb = B.trocearHtml(ensambla(salida, f), false); } catch (e) { malEns.push(f + ': ' + e.message); continue; }
  if (firmaBloques(ta) !== firmaBloques(tb)) { malEns.push(f + ': cambió la secuencia de bloques'); continue; }
  for (const t of tb) {
    if (t.t !== 'script' || !B.esJsClasico(t.apertura) || !t.contenido.trim() || t.contenido.indexOf('__SCRIPTLET__') !== -1) continue;
    try { acorn.parse(t.contenido, OPC); } catch (e) { malEns.push(f + ': ' + e.message); }
  }
}
ok('cada página ensamblada conserva la secuencia de bloques y todo su JS se deja leer', malEns.length === 0, malEns);

/* ── 1c · Lo que cortaría el quitacomentarios de Google ─────────────── */
// El 24/09/2026 Google cortó 'https://mail.google.com…' en el bloque principal de Index.html y el
// Portal de pruebas se quedó en «Cargando datos…» (sinBarrasCortables en scripts/build.js). Aquí se
// comprueba por separado que ningún <script> de la salida lleva // ni /*, y que el modelo de lo que
// hace Google no les quita nada.
console.log('\n1c · El quitacomentarios de Google');
const G = require('./quitacomentarios_google.js');
// Lo que escribe <?!= APP_JSON ?> al servir, con lo peor que puede traer una URL.
const APP_JSON_MUESTRA = '{"baseUrl":"https://script.google.com/a/macros/x/s/y/dev","datos":{"u":"http://a.b/*c*/d"}}';
const malG = { cortables: [], modelo: [], lee: [] };
let guionesSalida = 0;
for (const f of htmls) {
  const html = lee(salida, f);
  for (const t of B.trocearHtml(html, !B.esParcial(f))) {
    if (t.t !== 'script' || !B.esJsClasico(t.apertura) || !t.contenido.trim()) continue;
    guionesSalida++;
    const donde = f + ':' + lineaEn(html, t.ini);
    if (/\/\/|\/\*/.test(t.contenido.replace(/<\?[\s\S]*?\?>/g, '0'))) malG.cortables.push(donde);
    const servido = t.contenido.replace(/<\?[\s\S]*?\?>/g, APP_JSON_MUESTRA);
    if (G.quitar(servido) !== servido) malG.modelo.push(donde);
    try { new Function(G.quitar(servido)); } catch (e) { malG.lee.push(donde + ' ' + e.message); }
  }
}
ok('ningún <script> de la salida (' + guionesSalida + ') lleva // ni /*', guionesSalida >= 100 && malG.cortables.length === 0, malG.cortables);
ok('…el modelo de Google no les quita nada, tampoco al JSON de APP_JSON con URLs', malG.modelo.length === 0, malG.modelo);
ok('…y todos se dejan leer después de pasar por él', malG.lee.length === 0, malG.lee);

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

/* ── 2b · La Fase 2, con casos trampa ────────────────────────────────── */
console.log('\n2b · Casos trampa de la Fase 2');
const errs = [];
const P = (s) => { errs.length = 0; return B.limpiarPagina(s, 'pagina.html', errs); };
const Q = (s) => { errs.length = 0; return B.limpiarParcial(s, 'app_prueba.html', errs); };
const dentroDe = (s) => (/^<script>([\s\S]*)<\/script>$/.exec(s || '') || [])[1];

ok('página: se quita un comentario del marcado', P('<p>a</p><!-- c --><p>b</p>') === '<p>a</p><p>b</p>');
ok('página: <!-- dentro de un <script> no se toca', P("<script>var s = '<!-- no -->';</script>") === "<script>var s = '<!-- no -->';</script>");
ok('página: <!-- dentro de un <textarea> es texto y se queda', P('<textarea><!-- queda --></textarea>') === '<textarea><!-- queda --></textarea>');
const conScriptlets = "<?= '<!--' ?><p>x</p><script>var a = <?!= '</script>' ?>;</script><!-- c -->";
ok('página: un scriptlet con <!-- o </script dentro no confunde al troceador', P(conScriptlets) === "<?= '<!--' ?><p>x</p><script>var a = <?!= '</script>' ?>;</script>", P(conScriptlets));
ok('página: un scriptlet dentro de una etiqueta no la corta', P('<script src="<?= url ?>"></script><!-- c -->') === '<script src="<?= url ?>"></script>');
ok('página: un comentario con un scriptlet PARA el build', P("<!-- <?!= include('app_x') ?> -->") === null && /scriptlet/.test(errs.join()), errs);
ok('página: <!--> y <!---> son comentarios vacíos y no se comen lo que sigue', P('a<!-->b<!--->c<!-- d -->e') === 'abce');

const q1 = Q('<!-- doc --><script>\n// comentario\nvar GLOBAL_X = (function () { var largo = 20; return largo + 1; })();\n</script>');
ok('parcial: fuera comentarios; JS compilado con el mismo resultado',
   q1 !== null && !/doc|comentario|largo/.test(q1) && new Function(dentroDe(q1) + '; return GLOBAL_X;')() === 21, q1);
const comillas = "var c = 'dice \"hola\" y it\\'s https://x.com y /* esto */'; var d = 'uno \"a\" it\\'s\\nsalto';";
const q2 = dentroDe(Q('<script>' + comillas + '</script>'));
ok('parcial: una cadena con las dos comillas y // no sale como plantilla `…`', q2 !== undefined && q2.indexOf('`') === -1, q2);
ok('…y vale lo mismo', q2 !== undefined && new Function(q2 + '; return c + d;')() === new Function(comillas + '; return c + d;')());
const q3 = Q('<script>var g = "</scr" + "ipt>";</script>');
ok('parcial: esbuild no deja un </script dentro del JS', q3 !== null && (q3.match(/<\/script/gi) || []).length === 1, q3);
ok('parcial: el CSS se compila sin comentarios', Q('<style>/* c */ .a { color: red; }</style>') === '<style>.a{color:red}</style>');
ok('parcial: un CSS que esbuild no entiende PARA el build', Q("<style>.a { content: 'sin cerrar }</style>") === null && /avisa/.test(errs.join()), errs);
const noJs = '<script type="text/template"><!-- queda --><b>x</b></script><script src="https://x.example/y.js"></script>';
ok('parcial: un <script> que no es JS clásico (type, src) se queda intacto', Q(noJs) === noJs, Q(noJs));
ok('parcial: un JS que no compila PARA el build', Q('<script>var = ;</script>') === null && errs.length > 0, errs);

ok('globales: el tipo cuenta (var no es let)', B.globalesDeGuion('var a;').join() !== B.globalesDeGuion('let a;').join());
ok('globales: un var dentro de un bloque es global; un let no', B.globalesDeGuion('if (x) { var a; let b; }').join() === 'var a');
ok('arbolNormalizado ve un cambio de programa', B.arbolNormalizado('var a = 1 + 2;') !== B.arbolNormalizado('var a = 3;') &&
   B.arbolNormalizado('x.uno = 1;') !== B.arbolNormalizado('x.dos = 1;') && B.arbolNormalizado('if (a) b();') !== B.arbolNormalizado('a && b();'));
ok('…y acepta lo que esbuild abrevia sin cambiarlo', B.arbolNormalizado('var o = {n: n}; if (v === undefined) w("a" + "b"); var t = `z`;') ===
   B.arbolNormalizado('var o={n};if(v===void 0)w("ab");var t="z";'));

const fuenteC = "var c = 'a \"b\" it\\'s https://x';";
const seguraC = B.plantillasSeguras("var c=`a \"b\" it's https://x`;", fuenteC);
ok('plantillasSeguras: reescribe la plantilla nueva como cadena, con el mismo valor',
   seguraC.indexOf('`') === -1 && new Function(seguraC + '; return c;')() === new Function(fuenteC + '; return c;')(), seguraC);
ok('plantillasSeguras: deja las que ya estaban en el fuente', B.plantillasSeguras('var t=`a\n  b`;', 'var t = `a\n  b`;') === 'var t=`a\n  b`;');
ok('plantillasSeguras: como sentencia suelta la envuelve en paréntesis (no es una directiva)',
   /\("a \\"b\\" it's \/\/"\)/.test(B.plantillasSeguras("function f(){x();`a \"b\" it's //`}", "function f(){x(); 'a \"b\" it\\'s //'}")));
let lanza = false;
try { B.plantillasSeguras('var t=`a${x}//b`;', 'var t = "a" + x + "//b";'); } catch (e) { lanza = true; }
ok('plantillasSeguras: una plantilla nueva con ${} y // no se sabe arreglar: error', lanza);

/* ── 2c · Sin // ni /*, con casos trampa ─────────────────────────────── */
console.log('\n2c · Casos trampa de sinBarrasCortables');
const S = B.sinBarrasCortables;
const sinCortables = (js) => !/\/\/|\/\*/.test(js);
const vale = (js, expr) => new Function(js + '; return ' + expr + ';')();
const lanzaCon = (js, re) => { try { S(js); return false; } catch (e) { return re.test(e.message); } };

// Lo del 24/09 en pequeño: una plantilla con apóstrofo desfasa al quitacomentarios y el // de la
// cadena de abajo le queda fuera de lo que él cree una cadena.
const trampa = "var a = `it's`;\nvar u = 'https://mail.google.com/mail/?view=cm';\n";
let rota = false;
try { new Function(G.quitar(trampa)); } catch (e) { rota = true; }
ok('el modelo reproduce el fallo: plantilla con apóstrofo y una URL después', rota);
const arreglada = S(trampa);
ok('…y con sinBarrasCortables no le queda nada que cortar, con el mismo valor',
   sinCortables(arreglada) && G.quitar(arreglada) === arreglada && vale(arreglada, 'u') === vale(trampa, 'u'), arreglada);

const cadenas = String.raw`var a = 'https://x.com/a', b = "c/*d*/e", c = 'f\//g', d = 'h\\//i', e = '//*/';`;
const cadenasS = S(cadenas);
ok('cadenas: sin // ni /*, y cada una vale lo mismo (también con \\/ y \\\\ delante)',
   sinCortables(cadenasS) && ['a', 'b', 'c', 'd', 'e'].every((v) => vale(cadenasS, v) === vale(cadenas, v)), cadenasS);
ok('…las que no llevan // ni /* no se tocan', S("var s = '</div>', t = 'a/b';") === "var s = '</div>', t = 'a/b';");

const regex = String.raw`var r = /^https?:\/\//i, s = /a[/*]b/, t = /\/*x/g, q = 8 / 2 / 2;`;
const regexS = S(regex);
const prueba = (js) => { const f = new Function(js + '; return [r.test("https://a"), r.test("HTTP://a"), r.test("https:/a"), s.test("a/b"), s.test("a*b"), s.test("axb"), "x//x /x".match(t).join("|"), q];'); return JSON.stringify(f()); };
ok('expresiones regulares: sin // ni /*, y encuentran lo mismo', sinCortables(regexS) && prueba(regexS) === prueba(regex), [regexS, prueba(regexS)]);

const plantilla = 'var x = 1, t = `a//b${x}c/*d*/${ "http://y" }`;';
const plantillaS = S(plantilla);
ok('plantillas: sin // ni /*, también dentro de ${…}, con el mismo valor',
   sinCortables(plantillaS) && vale(plantillaS, 't') === vale(plantilla, 't'), plantillaS);
ok('…una con etiqueta no se puede tocar (recibe el texto crudo): error', lanzaCon('var t = String.raw`a//b`;', /etiqueta/));
ok('un comentario que quedara es un error, no se deja pasar', lanzaCon('var a = 1; // fin', /queda un \/\//));
ok('"use strict" sigue siendo una directiva', vale(S("'use strict'; var u = 'a//b';"), '(function () { return this === undefined; })()'));

const errsG = [];
const guion = B.limpiarGuionDePagina('\n    /* la URL base */\n    window.__APP__ = <?!= APP_JSON ?>; // fin\n  ', 'p.html:1', errsG);
ok('página: un <script> con scriptlet pierde sus comentarios y conserva el scriptlet',
   guion === '\n\nwindow.__APP__ = <?!= APP_JSON ?>;\n' && errsG.length === 0, [guion, errsG]);
ok('página: un <script> pierde sus comentarios, su sangría y sus // dentro de cadenas',
   P("<script>\n  // abre Gmail\n  var u = 'https://mail.google.com';\n</script>") === "<script>\n\nvar u = 'https:\\/\\/mail.google.com';\n</script>",
   P("<script>\n  // abre Gmail\n  var u = 'https://mail.google.com';\n</script>"));
ok('parcial: su JS compilado tampoco lleva // ni /*', sinCortables(dentroDe(Q("<script>var u = 'https://x.com/*y*/';</script>")) || '//'));

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

// Fase 2: un parcial roto para el build entero, igual que un .gs roto.
fs.writeFileSync(path.join(fuenteRota, 'Code.gs'), "var PAGES = { a: { file: 'Pagina' } };\n");
fs.writeFileSync(path.join(fuenteRota, 'Pagina.html'), '<p>hola</p><!-- c -->');
fs.writeFileSync(path.join(fuenteRota, 'app_roto.html'), '<script>var = ;</script>');
const r7 = correr(['--fuente', fuenteRota, '--salida', salidaRota]);
ok('un parcial con JS roto hace fallar el build, con su motivo', r7.codigo !== 0 && /app_roto\.html/.test(r7.salida), r7.salida);
ok('…y no deja carpeta de salida', !fs.existsSync(salidaRota));
fs.writeFileSync(path.join(fuenteRota, 'app_roto.html'), '<script>var bien = 1;</script>');
fs.writeFileSync(path.join(fuenteRota, 'Code.gs'), "var PAGES = { a: { file: 'app_roto' } };\n");
const r8 = correr(['--fuente', fuenteRota, '--salida', salidaRota]);
ok('una página de doGet con nombre de parcial PARA el build', r8.codigo !== 0 && /nombre de parcial/.test(r8.salida), r8.salida);
fs.writeFileSync(path.join(fuenteRota, 'Code.gs'), "var PAGES = { a: { file: 'Pagina' } };\n");
const r9 = correr(['--fuente', fuenteRota, '--salida', salidaRota, '--sin-clasp']);
ok('con todo sano pasa, y compila el parcial y la página', r9.codigo === 0 &&
   lee(salidaRota, 'Pagina.html') === '<p>hola</p>' && lee(salidaRota, 'app_roto.html') === '<script>var bien=1;</script>', r9.salida);

// Un <script> de página con un // que el build no sabe quitar sin cambiar el programa.
fs.writeFileSync(path.join(fuenteRota, 'Pagina.html'), '<p>hola</p><script>var t = String.raw`https://x`;</script>');
const r10 = correr(['--fuente', fuenteRota, '--salida', salidaRota, '--sin-clasp']);
ok('una página con una plantilla con etiqueta y // PARA el build, con su motivo', r10.codigo !== 0 && /Pagina\.html:1: .*etiqueta/.test(r10.salida), r10.salida);
ok('…y no deja carpeta de salida', !fs.existsSync(salidaRota));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
