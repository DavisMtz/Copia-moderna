/*
 * Caché de la disponibilidad de la plantilla CCL (F3b del doc 16).   node pruebas/formatos_cache.test.js
 *
 * getEnabledQuoteFormats abría la plantilla CCL (SpreadsheetApp.openById) en cada carga de
 * cotización, vista previa y correo, y al guardar cada cotización. Se carga el Formatos.gs REAL
 * con servicios simulados que cuentan las aperturas. Lo que importa comprobar:
 *   · la segunda vez no se abre;
 *   · lo que NO está disponible no se guarda (arreglar la plantilla se nota al momento);
 *   · el panel de administración mira siempre de verdad y corrige la caché;
 *   · apagar un formato manda en el acto, con caché o sin ella;
 *   · cambiar el id de la plantilla obliga a mirar de nuevo.
 * Esta carpeta queda fuera de "Carpeta del proyecto": clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');
let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

let props = {}, cache = {}, aperturas = 0, plantillaRota = false, conPestana = true;
const ctx = {
  console, Math, JSON, String, Number, Object, Array, RegExp, Error, parseInt, isNaN, Date,
  Logger: { log: () => {} },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); }
  }) },
  CacheService: { getScriptCache: () => ({
    get: (k) => (k in cache ? cache[k] : null),
    put: (k, v) => { cache[k] = String(v); },
    remove: (k) => { delete cache[k]; }
  }) },
  SpreadsheetApp: {
    openById: (id) => {
      aperturas++;
      if (plantillaRota) throw new Error('No se encontró el archivo ' + id);
      return { getSheetByName: (n) => (conPestana && n === 'Liverpool' ? {} : null) };
    }
  }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(PROY, 'Seguridad.gs'), 'utf8'), ctx, { filename: 'Seguridad.gs' });
vm.runInContext(fs.readFileSync(path.join(PROY, 'Formatos.gs'), 'utf8'), ctx, { filename: 'Formatos.gs' });
// getFormatSettings pregunta si quien llama es avanzado (Code.gs); aquí siempre.
vm.runInContext('function isAdvancedUser() { return true; }', ctx);

const ids = (r) => (r.formats || []).map((f) => f.id).join(',');
const reiniciar = () => { props = {}; cache = {}; aperturas = 0; plantillaRota = false; conPestana = true; };

console.log('\n1 · La segunda vez no se abre la plantilla');
reiniciar();
let r = ctx.getEnabledQuoteFormats();
ok('la primera vez se abre UNA vez y salen los dos formatos, CCL por omisión',
  aperturas === 1 && ids(r) === 'actual,ccl_liverpool' && r.defaultId === 'ccl_liverpool', { aperturas, r });
r = ctx.getEnabledQuoteFormats();
ok('la segunda, ninguna apertura y la misma respuesta', aperturas === 1 && ids(r) === 'actual,ccl_liverpool' && r.defaultId === 'ccl_liverpool', { aperturas, r });
ok('lo guardado es solo la disponibilidad de la CCL, con el id de la plantilla en la clave',
  Object.keys(cache).length === 1 && /^fmtDisp_v1_ccl_liverpool_1zD_0TiN7EBKfYIjNWzAH77pYJ021GGqilI1jUJ000sI$/.test(Object.keys(cache)[0]), Object.keys(cache));

console.log('\n2 · Lo que no está disponible no se guarda');
reiniciar();
plantillaRota = true;
r = ctx.getEnabledQuoteFormats();
ok('con la plantilla rota, la CCL no se ofrece y manda el formato actual', ids(r) === 'actual' && r.defaultId === 'actual', r);
ok('…y no queda nada en la caché', Object.keys(cache).length === 0, cache);
plantillaRota = false;
r = ctx.getEnabledQuoteFormats();
ok('arreglada la plantilla, la siguiente carga lo nota (vuelve a mirar)', aperturas === 2 && ids(r) === 'actual,ccl_liverpool', { aperturas, r });
reiniciar();
conPestana = false;
r = ctx.getEnabledQuoteFormats();
ok('sin la pestaña «Liverpool» tampoco se ofrece ni se guarda', ids(r) === 'actual' && Object.keys(cache).length === 0, { r, cache });

console.log('\n3 · El panel de administración mira siempre de verdad');
reiniciar();
ctx.getEnabledQuoteFormats();
plantillaRota = true;
let s = ctx.getFormatSettings('admin@liverpool.com.mx');
ok('el panel abre la plantilla aunque haya caché, y ve que está rota', aperturas === 2 && s.success &&
  s.formats.find((f) => f.id === 'ccl_liverpool').available === false, { aperturas, s });
r = ctx.getEnabledQuoteFormats();
ok('…y corrige la caché: la siguiente carga ya no ofrece la CCL', ids(r) === 'actual' && aperturas === 3, { aperturas, r });
plantillaRota = false;
ctx.getFormatSettings('admin@liverpool.com.mx');
const antes = aperturas;
r = ctx.getEnabledQuoteFormats();
ok('lo que el panel ve bien también queda guardado para la siguiente carga', ids(r) === 'actual,ccl_liverpool' && aperturas === antes, { aperturas, antes });

console.log('\n4 · Apagar un formato manda en el acto');
reiniciar();
ctx.getEnabledQuoteFormats();
props.formatos_habilitados = JSON.stringify({ actual: true, ccl_liverpool: false });
r = ctx.getEnabledQuoteFormats();
ok('la CCL apagada desaparece aunque su disponibilidad esté en caché', ids(r) === 'actual' && r.defaultId === 'actual', r);
props.formatos_habilitados = JSON.stringify({ actual: false, ccl_liverpool: true });
r = ctx.getEnabledQuoteFormats();
ok('y al revés: solo la CCL, sin volver a abrir la plantilla', ids(r) === 'ccl_liverpool' && aperturas === 1, { aperturas, r });

console.log('\n5 · Otra plantilla obliga a mirar');
reiniciar();
ctx.getEnabledQuoteFormats();
props.CCL_TEMPLATE_SHEET_ID = 'otraPlantilla123';
ctx.getEnabledQuoteFormats();
ok('cambiar CCL_TEMPLATE_SHEET_ID vuelve a abrir (la clave lleva el id)', aperturas === 2 && Object.keys(cache).some((k) => k.endsWith('_otraPlantilla123')), { aperturas, cache: Object.keys(cache) });

console.log('\n6 · Lo que no usa caché');
reiniciar();
ok('el formato actual no abre nada ni guarda nada', ctx.formatoDisponible_('actual').available === true && aperturas === 0 && Object.keys(cache).length === 0);
ctx.getEnabledQuoteFormats();
const src = fs.readFileSync(path.join(PROY, 'Formatos.gs'), 'utf8');
const generar = src.slice(src.indexOf('function generateCclPdfBlob_'), src.indexOf('function generateCclPdfBlob_') + 400);
ok('generar el PDF CCL sigue comprobando la plantilla de verdad, sin caché', /checkFormatAvailability_\("ccl_liverpool"\)/.test(generar) && !/formatoDisponible_/.test(generar));

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
