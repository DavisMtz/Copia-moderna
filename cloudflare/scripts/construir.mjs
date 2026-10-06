/*
 * Build de las pantallas para Cloudflare | Portal Ventel
 * =======================================================
 *   node scripts/construir.mjs            → public/pantallas/*.html + src/worker/generado/rutas.ts
 *
 * La FUENTE sigue siendo «Carpeta del proyecto»: aquí no se edita ninguna pantalla. Este script hace
 * lo mismo que hacía HtmlService al servir cada página, una sola vez y en el build:
 *
 *   · <?!= include('x') ?>  → el contenido de x.html, TAL CUAL. Igual que include() en Code.gs: los
 *     parciales no se evalúan (un include escrito dentro del comentario de un parcial es texto).
 *   · <?= APP_URL ?>        → '/'. Las páginas públicas lo usan en enlaces (APP_URL?page=…, APP_URL#…).
 *   · <?!= APP_JSON ?>      → __vxAppJson(): lo calcula el Worker al servir (o el puente, desde la URL).
 *   · El <title> es el de PAGES/PORTAL_PAGES (HtmlOutput.setTitle) y, si la página no trae
 *     <meta viewport>, se añade (addMetaTag).
 *   · Primer elemento del <head>: el puente google.script → Worker (src/shim/gas-shim.js), en línea.
 *
 * Cualquier otro scriptlet <? … ?> en una página PARA el build: no sabríamos qué hacía en Apps Script.
 *
 * Las rutas (qué archivo sirve cada ?page=) se leen de PAGES y PORTAL_PAGES en Code.gs, y la lista de
 * parámetros de vista de PARAMS_VISTA: una sola fuente para Apps Script y para Cloudflare.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_CF = path.join(AQUI, '..');
const FUENTE = path.join(RAIZ_CF, '..', 'Carpeta del proyecto');
const SALIDA = path.join(RAIZ_CF, 'public', 'pantallas');
const GENERADO = path.join(RAIZ_CF, 'src', 'worker', 'generado');

/**
 * Lo que se añade al final de <body> en TODAS las pantallas (islas React, etc.). Cada entrada es
 * { archivo: ruta pública, etiqueta: html } y solo se inyecta si el archivo existe en public/.
 */
const INYECCIONES_FINALES = [
  // { archivo: 'vx/app/panel.js', etiqueta: '<script type="module" src="/vx/app/panel.js"></script>' },
];

function fallar(msg) {
  console.error('✖ construir: ' + msg);
  process.exit(1);
}

/** Valor de una declaración global (const/var X = <literal>) de un .gs, evaluado. */
function literalGlobal(archivo, nombre) {
  const fuente = fs.readFileSync(path.join(FUENTE, archivo), 'utf8');
  const arbol = acorn.parse(fuente, { ecmaVersion: 'latest', sourceType: 'script' });
  for (const n of arbol.body) {
    if (n.type !== 'VariableDeclaration') continue;
    for (const d of n.declarations) {
      if (d.id && d.id.name === nombre && d.init) {
        const texto = fuente.slice(d.init.start, d.init.end);
        // Solo literales (objetos, arreglos, cadenas): nada que dependa de otras globales.
        return new Function('return (' + texto + ');')();
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

const escaparHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const parciales = new Map();
function parcial(nombre) {
  const limpio = String(nombre).replace(/\.html$/, '');
  if (!parciales.has(limpio)) {
    const ruta = path.join(FUENTE, limpio + '.html');
    if (!fs.existsSync(ruta)) fallar('include("' + nombre + '") no existe en «Carpeta del proyecto»');
    parciales.set(limpio, fs.readFileSync(ruta, 'utf8'));
  }
  return parciales.get(limpio);
}

const RE_SCRIPTLET = /<\?(!=|=)?([\s\S]*?)\?>/g;
const RE_INCLUDE = /^\s*include\(\s*(['"])([^'"]+)\1\s*\)\s*;?\s*$/;

function construirPagina(archivo, titulo) {
  const ruta = path.join(FUENTE, archivo + '.html');
  if (!fs.existsSync(ruta)) fallar('la pantalla ' + archivo + '.html no existe');
  let plantilla = fs.readFileSync(ruta, 'utf8');

  // 1 · <title> (setTitle) sobre la PLANTILLA, antes de pegar parciales: un parcial puede llevar un
  //     <title> dentro de una cadena (las ventanas de impresión) y ese no es el de la página.
  const tituloHtml = '<title>' + escaparHtml(titulo) + '</title>';
  if (/<title[^>]*>[\s\S]*?<\/title>/i.test(plantilla)) {
    plantilla = plantilla.replace(/<title[^>]*>[\s\S]*?<\/title>/i, tituloHtml);
  } else {
    plantilla = plantilla.replace(/<head[^>]*>/i, (m) => m + '\n' + tituloHtml);
  }

  // 2 · Scriptlets: un solo pase. Lo que se pega (parciales) no se vuelve a examinar.
  const desconocidos = [];
  let salida = plantilla.replace(RE_SCRIPTLET, (todo, tipo, codigo) => {
    const inc = RE_INCLUDE.exec(codigo);
    if (tipo === '!=' && inc) return parcial(inc[2]);
    if (tipo === '=' && codigo.trim() === 'APP_URL') return '/';
    if (tipo === '!=' && codigo.trim() === 'APP_JSON') return '__vxAppJson()';
    desconocidos.push(todo.slice(0, 120));
    return todo;
  });
  if (desconocidos.length) fallar(archivo + '.html tiene scriptlets que no sé traducir: ' + desconocidos.join(' | '));

  // 3 · Cabecera: puente primero (antes de cualquier script), viewport si falta, favicon si falta.
  const cabecera = [
    '<script id="vx-puente">' + shim + '</script>',
    /<meta[^>]+name=["']viewport["']/i.test(salida) ? '' : '<meta name="viewport" content="width=device-width, initial-scale=1">',
    /<link[^>]+rel=["'](?:shortcut )?icon["']/i.test(salida) ? '' : '<link rel="icon" type="image/png" href="/vx/favicon.png">'
  ].filter(Boolean).join('\n');
  if (/<head[^>]*>/i.test(salida)) salida = salida.replace(/<head[^>]*>/i, (m) => m + '\n' + cabecera);
  else salida = cabecera + '\n' + salida;

  // 4 · Islas y añadidos al final del <body>.
  const finales = INYECCIONES_FINALES
    .filter((x) => fs.existsSync(path.join(RAIZ_CF, 'public', x.archivo)))
    .map((x) => x.etiqueta).join('\n');
  if (finales) {
    const i = salida.toLowerCase().lastIndexOf('</body>');
    salida = i === -1 ? salida + '\n' + finales : salida.slice(0, i) + finales + '\n' + salida.slice(i);
  }

  fs.writeFileSync(path.join(SALIDA, archivo + '.html'), salida);
  return salida.length;
}

fs.rmSync(SALIDA, { recursive: true, force: true });
fs.mkdirSync(SALIDA, { recursive: true });
fs.mkdirSync(GENERADO, { recursive: true });

const rutas = {};
const tam = [];
for (const [clave, conf] of Object.entries(Object.assign({}, PAGES, PORTAL_PAGES))) {
  if (!rutas[conf.file]) {
    rutas[conf.file] = true;
    tam.push([conf.file, construirPagina(conf.file, conf.title)]);
  }
}

const aTs = (v) => JSON.stringify(v, null, 2);
const paginas = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { archivo: v.file, titulo: v.title }]));
fs.writeFileSync(path.join(GENERADO, 'rutas.ts'),
  '// GENERADO por scripts/construir.mjs a partir de Code.gs y Portal.gs. No se edita a mano.\n' +
  'export interface Pagina { archivo: string; titulo: string }\n' +
  'export const PAGINAS: Record<string, Pagina> = ' + aTs(paginas(PAGES)) + ';\n' +
  'export const PAGINAS_PORTAL: Record<string, Pagina> = ' + aTs(paginas(PORTAL_PAGES)) + ';\n' +
  'export const PARAMS_VISTA: string[] = ' + aTs(PARAMS_VISTA) + ';\n' +
  'export const RECO_PANTALLAS: string[] = ' + aTs(RECO_PANTALLAS) + ';\n' +
  'export const CONSTRUIDO = ' + JSON.stringify(new Date().toISOString()) + ';\n');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log('✔ ' + tam.length + ' pantallas en public/pantallas (' + kb(tam.reduce((a, b) => a + b[1], 0)) + ' en total)');
for (const [f, n] of tam.sort((a, b) => b[1] - a[1])) console.log('   ' + f.padEnd(24) + kb(n));
