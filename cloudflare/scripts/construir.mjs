/*
 * Build de las pantallas para Cloudflare | Portal Ventel
 * =======================================================
 *   node scripts/construir.mjs                    → public/ (pantallas, módulos compartidos, _headers)
 *   node scripts/construir.mjs --salida <dir>     → a otra carpeta (para probar sin tocar public/)
 *
 * La FUENTE sigue siendo «Carpeta del proyecto»: aquí no se edita ninguna pantalla. El build hace, una
 * sola vez, lo que hacía HtmlService en cada visita, y además lo que Apps Script no permitía:
 *
 * 1 · Parte del build de Apps Script (scripts/build.js, Fases 1 y 2 del doc 16): parciales compilados
 *     con esbuild y páginas sin comentarios. Es el mismo código que va a producción, ya verificado.
 *
 * 2 · Plantillas, como HtmlService:
 *     · <?!= include('x') ?> → el contenido de x.html TAL CUAL (los parciales no se evalúan).
 *     · <?= APP_URL ?>       → '/'.        · <?!= APP_JSON ?> → __vxAppJson() (ver gas-shim.js).
 *     · <title> de PAGES/PORTAL_PAGES (setTitle) y <meta viewport> si falta (addMetaTag).
 *     Cualquier otro scriptlet PARA el build: no sabríamos qué hacía en Apps Script.
 *
 * 3 · Lo que en Apps Script no se podía: CADA <script> y <style> en línea de más de UMBRAL caracteres
 *     sale a un archivo propio en /vx/p/, con el hash de su contenido en el nombre y caché de un año
 *     (public/_headers). Los parciales son los mismos en las 20 pantallas, así que el navegador los
 *     baja UNA vez: cambiar de pantalla ya solo trae el HTML propio de esa pantalla. Los <script> de
 *     las páginas (que build.js no compila) se compilan aquí con las mismas opciones que los parciales.
 *     Es seguro porque un <script src> clásico sin async/defer se ejecuta en el mismo punto y orden que
 *     uno en línea (el analizador se detiene igual); por eso al sacarlo se le quitan async/defer, que
 *     en un script en línea no hacían nada y fuera sí cambiarían el orden.
 *
 * 4 · Primer elemento del <head>: el puente google.script → Worker (src/shim/gas-shim.js), en línea.
 *     Último del <head>: reglas de precarga (Speculation Rules): al apuntar un enlace a otra pantalla, el
 *     navegador ya la va pidiendo.
 *
 * Comprobaciones (si una falla, el build para y no deja nada a medias): cada JS que sale se deja leer
 * (acorn) y declara los mismos nombres globales que el original (las demás piezas de la página los
 * usan); ningún archivo lleva «</script»; no queda ningún scriptlet sin traducir.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as esbuild from 'esbuild';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_CF = path.join(AQUI, '..');
const RAIZ_REPO = path.join(RAIZ_CF, '..');
const FUENTE_ORIGINAL = path.join(RAIZ_REPO, 'Carpeta del proyecto');
const GENERADO = path.join(RAIZ_CF, 'src', 'worker', 'generado');

const argSalida = process.argv.indexOf('--salida');
const PUBLICO = argSalida > -1 ? path.resolve(process.argv[argSalida + 1]) : path.join(RAIZ_CF, 'public');
const SALIDA_PANTALLAS = path.join(PUBLICO, 'pantallas');
const SALIDA_MODULOS = path.join(PUBLICO, 'vx', 'p');
const TEMPORAL = path.join(RAIZ_CF, '.construccion');

/** Bloques más cortos que esto se quedan en línea: no vale la pena una petición. */
const UMBRAL = 1200;

/**
 * Lo que se añade al final de <body> en TODAS las pantallas (islas React, etc.). Cada entrada es
 * { archivo: ruta pública, etiqueta: html } y solo se inyecta si el archivo existe en public/.
 */
const INYECCIONES_FINALES = [
  // Panel de velocidad (isla React, src/react). Módulo: no bloquea el pintado de la pantalla.
  { archivo: 'vx/app/panel.js', etiqueta: '<script type="module" src="/vx/app/panel.js"></script>' },
];

const REGLAS_PRECARGA = JSON.stringify({
  prefetch: [{
    source: 'document',
    where: { or: [{ href_matches: '/?page=*' }, { href_matches: '/' }] },
    eagerness: 'moderate'
  }]
});

const OPC_ACORN = { ecmaVersion: 'latest', sourceType: 'script' };
const OPC_JS = { loader: 'js', charset: 'utf8', target: 'chrome109', legalComments: 'none',
  minifyWhitespace: true, minifyIdentifiers: true, minifySyntax: false };
const OPC_CSS = { loader: 'css', charset: 'utf8', target: 'chrome109', minify: true };

function fallar(msg) {
  console.error('✖ construir: ' + msg);
  process.exit(1);
}

/* ── 1 · El build de Apps Script como punto de partida ─────────────────────────────────────── */

fs.rmSync(TEMPORAL, { recursive: true, force: true });
try {
  execFileSync(process.execPath, [path.join(RAIZ_REPO, 'scripts', 'build.js'), '--salida', path.join(TEMPORAL, 'gas'), '--sin-clasp'],
    { cwd: RAIZ_REPO, stdio: ['ignore', 'ignore', 'inherit'] });
} catch (e) {
  fallar('scripts/build.js falló (¿falta `npm ci` en la raíz del repo?)');
}
const FUENTE = path.join(TEMPORAL, 'gas');

/** Valor de una declaración global (const/var X = <literal>) de un .gs ORIGINAL, evaluado. */
function literalGlobal(archivo, nombre) {
  const fuente = fs.readFileSync(path.join(FUENTE_ORIGINAL, archivo), 'utf8');
  const arbol = acorn.parse(fuente, OPC_ACORN);
  for (const n of arbol.body) {
    if (n.type !== 'VariableDeclaration') continue;
    for (const d of n.declarations) {
      if (d.id && d.id.name === nombre && d.init) {
        return new Function('return (' + fuente.slice(d.init.start, d.init.end) + ');')();
      }
    }
  }
  fallar('no encontré ' + nombre + ' en ' + archivo);
}

const PAGES = literalGlobal('Code.gs', 'PAGES');
const PORTAL_PAGES = literalGlobal('Code.gs', 'PORTAL_PAGES');
const PARAMS_VISTA = literalGlobal('Code.gs', 'PARAMS_VISTA');
const RECO_PANTALLAS = literalGlobal('Portal.gs', 'RECO_PANTALLAS');

const shim = fs.readFileSync(path.join(RAIZ_CF, 'src', 'shim', 'gas-shim.js'), 'utf8')
  .replace('/*__PARAMS_VISTA__*/[]', JSON.stringify(PARAMS_VISTA));
if (/<\/script/i.test(shim)) fallar('el puente no puede contener "</script"');

/* ── 2 · Troceado de HTML (el mismo criterio que scripts/build.js, sin scriptlets) ─────────── */

const OPACOS = ['textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'template'];

function trocear(html) {
  const low = html.toLowerCase();
  const trozos = [];
  let i = 0, desde = 0;
  const marcadoHasta = (fin) => { if (fin > desde) trozos.push({ t: 'marcado', texto: html.slice(desde, fin) }); };
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      let f;
      if (html.startsWith('<!-->', i)) f = i + 5;
      else if (html.startsWith('<!--->', i)) f = i + 6;
      else {
        const a = html.indexOf('-->', i + 4), b = html.indexOf('--!>', i + 4);
        if (a === -1 && b === -1) throw new Error('comentario <!-- sin cerrar');
        f = (b !== -1 && (a === -1 || b < a)) ? b + 4 : a + 3;
      }
      marcadoHasta(i);
      trozos.push({ t: 'marcado', texto: html.slice(i, f) });
      i = desde = f;
      continue;
    }
    const m = /^<([a-z]+)[\s>\/]/.exec(low.slice(i, i + 12));
    if (m && (m[1] === 'script' || m[1] === 'style' || OPACOS.includes(m[1]))) {
      const tag = m[1];
      const finApertura = low.indexOf('>', i);
      if (finApertura === -1) throw new Error('<' + tag + '> sin cerrar la etiqueta');
      let c = finApertura;
      for (;;) {
        c = low.indexOf('</' + tag, c + 1);
        if (c === -1) throw new Error('falta </' + tag + '>');
        if (/[\s\/>]/.test(html[c + 2 + tag.length] || '')) break;
      }
      const finCierre = html.indexOf('>', c);
      marcadoHasta(i);
      trozos.push({
        t: (tag === 'script' || tag === 'style') ? tag : 'marcado', tag,
        apertura: html.slice(i, finApertura + 1), contenido: html.slice(finApertura + 1, c),
        texto: html.slice(i, finCierre + 1)
      });
      i = desde = finCierre + 1;
      continue;
    }
    i++;
  }
  marcadoHasta(html.length);
  return trozos;
}

function esJsClasicoEnLinea(apertura) {
  if (/\ssrc\s*=/i.test(apertura) || /\snomodule\b/i.test(apertura)) return false;
  const tipo = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(apertura);
  return !tipo || tipo[1] === '' || /^(text|application)\/(java|ecma)script$/i.test(tipo[1]);
}

/** Nombres que un guion deja en el ámbito global (para comprobar que compilar no los cambia). */
function globales(js) {
  const g = [];
  const dePatron = (p) => {
    if (!p) return;
    if (p.type === 'Identifier') g.push(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((x) => dePatron(x.value || x.argument));
    else if (p.type === 'ArrayPattern') p.elements.forEach(dePatron);
    else if (p.type === 'AssignmentPattern') dePatron(p.left);
    else if (p.type === 'RestElement') dePatron(p.argument);
  };
  const visitar = (n, arriba) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'FunctionDeclaration') { if (n.id) g.push(n.id.name); return; }
    if (/^(FunctionExpression|ArrowFunctionExpression|ClassExpression|StaticBlock|MethodDefinition|PropertyDefinition)$/.test(n.type)) return;
    if (n.type === 'ClassDeclaration') { if (arriba && n.id) g.push(n.id.name); return; }
    if (n.type === 'VariableDeclaration' && (n.kind === 'var' || arriba)) n.declarations.forEach((d) => dePatron(d.id));
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach((h) => visitar(h, false));
      else if (v && typeof v.type === 'string') visitar(v, false);
    }
  };
  acorn.parse(js, OPC_ACORN).body.forEach((n) => visitar(n, true));
  return [...new Set(g)].sort().join(',');
}

/* ── 3 · Sacar los bloques grandes a /vx/p ──────────────────────────────────────────────────── */

const modulos = new Map();     // nombre de archivo → contenido
let bytesFuera = 0;

function publicar(origen, ext, contenido) {
  const hash = crypto.createHash('sha256').update(contenido).digest('hex').slice(0, 12);
  const nombre = origen.replace(/[^\w-]/g, '') + '.' + hash + '.' + ext;
  if (!modulos.has(nombre)) { modulos.set(nombre, contenido); bytesFuera += contenido.length; }
  return '/vx/p/' + nombre;
}

/**
 * Devuelve el HTML con sus <script>/<style> grandes fuera.
 * @param compilar true para JS que build.js no compiló (los de las páginas).
 */
function extraer(html, origen, compilar) {
  let n = 0;
  return trocear(html).map((t) => {
    if (t.t === 'script' && esJsClasicoEnLinea(t.apertura)) {
      let js = t.contenido;
      if (!js.trim()) return t.texto;
      if (compilar) {
        const antes = globales(js);
        js = esbuild.transformSync(js, OPC_JS).code;
        if (globales(js) !== antes) fallar(origen + ': compilar cambió los nombres globales de un <script>');
      } else {
        acorn.parse(js, OPC_ACORN); // que se deje leer
      }
      if (/<\/script/i.test(js)) fallar(origen + ': un <script> contiene «</script»');
      if (js.length < UMBRAL) return t.apertura + js + '</script>';
      // async/defer no hacen nada en un script en línea; fuera sí: se quitan para no cambiar el orden.
      const apertura = t.apertura.replace(/\s(async|defer)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?(?=[\s>])/gi, '');
      const src = publicar(origen + '-' + (++n), 'js', js);
      return apertura.replace(/>$/, ' src="' + src + '">') + '</script>';
    }
    if (t.t === 'style') {
      const css = compilar ? esbuild.transformSync(t.contenido, OPC_CSS).code : t.contenido;
      if (css.length < UMBRAL) return t.apertura + css + '</style>';
      const media = /\smedia\s*=\s*("[^"]*"|'[^']*')/i.exec(t.apertura);
      const id = /\sid\s*=\s*("[^"]*"|'[^']*')/i.exec(t.apertura);
      const href = publicar(origen + '-' + (++n), 'css', css);
      return '<link rel="stylesheet" href="' + href + '"' + (media ? ' media=' + media[1] : '') + (id ? ' id=' + id[1] : '') + '>';
    }
    return t.texto;
  }).join('');
}

const parciales = new Map();
function parcial(nombre) {
  const limpio = String(nombre).replace(/\.html$/, '');
  if (!parciales.has(limpio)) {
    const ruta = path.join(FUENTE, limpio + '.html');
    if (!fs.existsSync(ruta)) fallar('include("' + nombre + '") no existe en «Carpeta del proyecto»');
    // Los parciales ya vienen compilados por build.js: solo se sacan sus bloques grandes.
    parciales.set(limpio, extraer(fs.readFileSync(ruta, 'utf8'), limpio, false));
  }
  return parciales.get(limpio);
}

/* ── 4 · Cada pantalla ─────────────────────────────────────────────────────────────────────── */

const RE_SCRIPTLET = /<\?(!=|=)?([\s\S]*?)\?>/g;
const RE_INCLUDE = /^\s*include\(\s*(['"])([^'"]+)\1\s*\)\s*;?\s*$/;
const escaparHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function construirPagina(archivo, titulo) {
  const ruta = path.join(FUENTE, archivo + '.html');
  if (!fs.existsSync(ruta)) fallar('la pantalla ' + archivo + '.html no existe');
  let plantilla = fs.readFileSync(ruta, 'utf8');

  const tituloHtml = '<title>' + escaparHtml(titulo) + '</title>';
  if (/<title[^>]*>[\s\S]*?<\/title>/i.test(plantilla)) plantilla = plantilla.replace(/<title[^>]*>[\s\S]*?<\/title>/i, tituloHtml);
  else plantilla = plantilla.replace(/<head[^>]*>/i, (m) => m + '\n' + tituloHtml);

  // Scriptlets → marcadores; la página (sin parciales) se compila y se extrae; luego se pegan los
  // parciales ya extraídos. Así cada bloque se compila una vez y con el criterio que le toca.
  const incluidos = [];
  const desconocidos = [];
  let pagina = plantilla.replace(RE_SCRIPTLET, (todo, tipo, codigo) => {
    const inc = RE_INCLUDE.exec(codigo);
    if (tipo === '!=' && inc) { incluidos.push(inc[2]); return '\u0000INC' + (incluidos.length - 1) + '\u0000'; }
    if (tipo === '=' && codigo.trim() === 'APP_URL') return '/';
    if (tipo === '!=' && codigo.trim() === 'APP_JSON') return '__vxAppJson()';
    desconocidos.push(todo.slice(0, 120));
    return todo;
  });
  if (desconocidos.length) fallar(archivo + '.html tiene scriptlets que no sé traducir: ' + desconocidos.join(' | '));
  if (/\u0000INC\d+\u0000[^<]*<\/script/i.test(pagina) && false) fallar('include dentro de un script');

  pagina = extraer(pagina, archivo, true);
  let salida = pagina.replace(/\u0000INC(\d+)\u0000/g, (m, i) => parcial(incluidos[Number(i)]));

  const cabecera = [
    '<script id="vx-puente">' + shim + '</script>',
    /<meta[^>]+name=["']viewport["']/i.test(salida) ? '' : '<meta name="viewport" content="width=device-width, initial-scale=1">',
    /<link[^>]+rel=["'](?:shortcut )?icon["']/i.test(salida) ? '' : '<link rel="icon" type="image/png" href="/vx/favicon.png">'
  ].filter(Boolean).join('\n');
  if (/<head[^>]*>/i.test(salida)) salida = salida.replace(/<head[^>]*>/i, (m) => m + '\n' + cabecera);
  else salida = cabecera + '\n' + salida;

  const precarga = '<script type="speculationrules">' + REGLAS_PRECARGA + '</script>';
  salida = /<\/head>/i.test(salida) ? salida.replace(/<\/head>/i, precarga + '\n</head>') : salida;

  const finales = INYECCIONES_FINALES
    .filter((x) => fs.existsSync(path.join(PUBLICO, x.archivo)))
    .map((x) => x.etiqueta).join('\n');
  if (finales) {
    const i = salida.toLowerCase().lastIndexOf('</body>');
    salida = i === -1 ? salida + '\n' + finales : salida.slice(0, i) + finales + '\n' + salida.slice(i);
  }
  if (/<\?(=|!=)/.test(pagina)) fallar(archivo + ': quedó un scriptlet');
  return salida;
}

fs.rmSync(SALIDA_PANTALLAS, { recursive: true, force: true });
fs.rmSync(SALIDA_MODULOS, { recursive: true, force: true });
fs.mkdirSync(SALIDA_PANTALLAS, { recursive: true });
fs.mkdirSync(SALIDA_MODULOS, { recursive: true });
fs.mkdirSync(GENERADO, { recursive: true });

const hechas = new Set();
const tam = [];
for (const conf of Object.values(Object.assign({}, PAGES, PORTAL_PAGES))) {
  if (hechas.has(conf.file)) continue;
  hechas.add(conf.file);
  const html = construirPagina(conf.file, conf.title);
  fs.writeFileSync(path.join(SALIDA_PANTALLAS, conf.file + '.html'), html);
  tam.push([conf.file, html.length]);
}
for (const [nombre, contenido] of modulos) fs.writeFileSync(path.join(SALIDA_MODULOS, nombre), contenido);

fs.writeFileSync(path.join(PUBLICO, '_headers'),
  '# Lo genera scripts/construir.mjs. Los módulos llevan el hash de su contenido en el nombre:\n' +
  '# un cambio es un archivo nuevo, así que se pueden guardar un año sin volver a preguntar.\n' +
  '/vx/p/*\n  Cache-Control: public, max-age=31536000, immutable\n' +
  '/vx/app/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');

// rutas.ts solo se reescribe si cambió (si no, cada build recargaría todos los `wrangler dev`).
const aTs = (v) => JSON.stringify(v, null, 2);
const paginas = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { archivo: v.file, titulo: v.title }]));
const cuerpoRutas =
  '// GENERADO por scripts/construir.mjs a partir de Code.gs y Portal.gs. No se edita a mano.\n' +
  'export interface Pagina { archivo: string; titulo: string }\n' +
  'export const PAGINAS: Record<string, Pagina> = ' + aTs(paginas(PAGES)) + ';\n' +
  'export const PAGINAS_PORTAL: Record<string, Pagina> = ' + aTs(paginas(PORTAL_PAGES)) + ';\n' +
  'export const PARAMS_VISTA: string[] = ' + aTs(PARAMS_VISTA) + ';\n' +
  'export const RECO_PANTALLAS: string[] = ' + aTs(RECO_PANTALLAS) + ';\n';
const rutaRutas = path.join(GENERADO, 'rutas.ts');
const previo = fs.existsSync(rutaRutas) ? fs.readFileSync(rutaRutas, 'utf8') : '';
if (!previo.startsWith(cuerpoRutas)) {
  fs.writeFileSync(rutaRutas, cuerpoRutas + 'export const CONSTRUIDO = ' + JSON.stringify(new Date().toISOString()) + ';\n');
}
fs.rmSync(TEMPORAL, { recursive: true, force: true });

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const total = tam.reduce((a, b) => a + b[1], 0);
console.log('✔ ' + tam.length + ' pantallas (' + kb(total) + ' de HTML propio) + ' + modulos.size +
  ' módulos compartidos en /vx/p (' + kb(bytesFuera) + ', se bajan una vez)');
for (const [f, n] of tam.sort((a, b) => b[1] - a[1])) console.log('   ' + f.padEnd(24) + kb(n));
