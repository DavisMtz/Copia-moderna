/**
 * LABORATORIO de rendimiento de Apps Script (Portal Ventel) — SE PUEDE BORRAR.
 * Mide lo que la documentación no dice: latencia de google.script.run, límites de tamaño,
 * costo de render en servidor, almacenamiento del iframe e historial.
 * Rutas: ?exp=panel (por omisión) · ?exp=asset · ?exp=ver · ?exp=render&page=X · ?exp=plantilla&f=X
 */
var LAB_T0 = Date.now();   // cuándo se evaluó ESTE archivo (el último en cargar: ZZ_)

function doGet(e) {
  var t0 = Date.now();
  var p = (e && e.parameter) || {};
  var exp = p.exp || 'panel';

  if (exp === 'asset') {
    return ContentService.createTextOutput('window.__labAsset = "cargado " + Date.now();')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  if (exp === 'ver') {
    var r = PropertiesService.getScriptProperties().getProperty('LAB_RESULTADOS') || '{}';
    return HtmlService.createHtmlOutput('<pre id="labres">' + r.replace(/</g, '&lt;') + '</pre>');
  }
  if (exp === 'render' && typeof servirPagina_ === 'function') {
    // El render REAL del Portal (solo existe en LAB-grande, que lleva copia del código).
    var out = servirPagina_({ parameter: { page: p.page || 'portal' } });
    return out.append('<script>window.__LAB = {render_ms:' + (Date.now() - t0) + ',carga_proyecto_ms:' + (t0 - LAB_T0) + '};</script>');
  }
  if (exp === 'plantilla') {
    // Una plantilla ya ensamblada (sin include en tiempo de ejecución), con las mismas variables.
    var t = HtmlService.createTemplateFromFile(p.f);
    var url = ScriptApp.getService().getUrl();
    t.baseUrl = url; t.APP_URL = url;
    ['folio','action','format','q','buscar','tpl','sec','ancla','inc','next','promo','item','rango','estatus','dir','origen','pub','art']
      .forEach(function (k) { t[k] = ''; });
    t.APP_JSON = JSON.stringify({ baseUrl: url });
    var html = t.evaluate();
    return html.append('<script>window.__LAB = {render_ms:' + (Date.now() - t0) + '};</script>')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  var panel = HtmlService.createTemplateFromFile('ZZ_lab');
  panel.URL = ScriptApp.getService().getUrl();
  panel.RENDER_MS = Date.now() - t0;
  panel.PROYECTO = (typeof servirPagina_ === 'function' ? 'grande' : 'mini') + (p.v ? '/' + p.v : '');
  panel.SOLO = p.solo || '';
  return panel.evaluate().setTitle('LAB').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function labNoop() { return Date.now(); }
function labEco(n) { return new Array(n + 1).join('x'); }
function labLongitud(s) { return String(s).length; }
function labTipos() { return { fecha: new Date(0), nulo: null, indef: undefined, arr: [1, 'a', null], anidado: { a: { b: { c: 1 } } } }; }
function labGuardar(json) { PropertiesService.getScriptProperties().setProperty('LAB_RESULTADOS', json); return true; }
