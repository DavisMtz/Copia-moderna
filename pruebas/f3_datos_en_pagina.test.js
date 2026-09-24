/*
 * Pruebas de la Fase 3 (doc 16): respuestas en caché servidas DENTRO de la página, y medidas
 * de cada llamada.   Ejecutar:  node pruebas/f3_datos_en_pagina.test.js
 *
 * Dos mitades:
 *   A · Servidor. Se cargan los .gs REALES (Code, Portal, Trazabilidad, Operacion, Permisos…) con
 *       servicios simulados. Lo que importa comprobar no es «devuelve datos», es lo que NO puede
 *       pasar: que el doGet abra una hoja o el Calendario (primer byte de 5-10 s en frío), que
 *       escriba (readPortalAnuncios_ y opCalcularEstadoPublico_ escriben), que sirva un status de
 *       error como si fuera un dato, o que un texto con `</script>` se salga de la etiqueta.
 *   B · Cliente. Se extrae el AppRun REAL de app_core.html y se ejecuta con un google.script.run
 *       falso. Se comprueba que la respuesta de la página se usa una sola vez, que `fuerza` y las
 *       mutaciones nunca la usan, que el tiempo de servidor se desenvuelve (y que un servidor viejo
 *       sin envoltorio sigue funcionando) y que las medidas no pueden romper una llamada.
 *
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
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 300) : ''));
}
function lanza(fn) { try { fn(); return null; } catch (e) { return String(e && e.message || e); } }

/* ═════════════════════════════════════════════════════════════════════════════════════
   A · SERVIDOR
   ═════════════════════════════════════════════════════════════════════════════════════ */

// «Hoy» fijo: la cuenta de promociones depende de la fecha (vigentes, por terminar).
const HOY = new Date(2026, 8, 24, 12, 0, 0).getTime();

let cache = {}, props = {};
const cuentas = { hojas: 0, calendario: 0, drive: 0, escriturasProp: 0, escriturasCache: 0 };
// Viajes a CacheService y a las propiedades (F3a.1): cada uno cuesta decenas de ms del primer byte.
const lecturas = { get: 0, getAll: 0, getProperty: 0, getProperties: 0, pedidas: [] };
let getAllRoto = false;
let plantillas = [];

function contextoServidor() {
  const RelojDate = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(HOY); }
    static now() { return HOY; }
  };
  const cacheScript = {
    get: (k) => { lecturas.get++; return (k in cache ? cache[k] : null); },
    getAll: (ks) => {
      lecturas.getAll++; lecturas.pedidas.push(ks.slice());
      if (getAllRoto) throw new Error('prueba: CacheService caído');
      const o = {}; ks.forEach((k) => { if (k in cache) o[k] = cache[k]; }); return o;
    },
    put: (k, v) => { cuentas.escriturasCache++; cache[k] = String(v); },
    putAll: (m) => { cuentas.escriturasCache++; Object.assign(cache, m); },
    remove: (k) => { delete cache[k]; },
    removeAll: (ks) => { ks.forEach((k) => delete cache[k]); }
  };
  const salida = {
    setTitle() { return this; }, setXFrameOptionsMode() { return this; }, addMetaTag() { return this; }
  };
  const ctx = {
    console, Math, JSON, String, Number, Object, Array, RegExp, Error, parseInt, parseFloat, isNaN,
    Date: RelojDate,
    Logger: { log: () => {} },
    CacheService: { getScriptCache: () => cacheScript, getUserCache: () => cacheScript },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => { lecturas.getProperty++; return (k in props ? props[k] : null); },
      setProperty: (k, v) => { cuentas.escriturasProp++; props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
      getProperties: () => { lecturas.getProperties++; return Object.assign({}, props); }
    }) },
    // Si el doGet abre CUALQUIER hoja, el Calendario o Drive, la prueba lo cuenta y la llamada falla.
    SpreadsheetApp: {
      openById: () => { cuentas.hojas++; throw new Error('prueba: el doGet no debe abrir hojas'); },
      getActiveSpreadsheet: () => { cuentas.hojas++; throw new Error('prueba: el doGet no debe abrir hojas'); },
      flush: () => {}
    },
    CalendarApp: { getCalendarById: () => { cuentas.calendario++; throw new Error('prueba: sin Calendario'); } },
    DriveApp: { getFolderById: () => { cuentas.drive++; throw new Error('prueba: sin Drive'); } },
    Session: {
      getScriptTimeZone: () => 'America/Mexico_City',
      getActiveUser: () => ({ getEmail: () => 'visita@liverpool.com.mx' }),
      getEffectiveUser: () => ({ getEmail: () => 'dueno@liverpool.com.mx' })
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/PRUEBA/exec' }) },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createTemplateFromFile: (archivo) => {
        const t = { __archivo: archivo, evaluate: () => salida };
        plantillas.push(t);
        return t;
      },
      createHtmlOutput: () => salida
    }
  };
  vm.createContext(ctx);
  ['Seguridad.gs', 'Sesiones.gs', 'Code.gs', 'Portal.gs', 'Trazabilidad.gs', 'Operacion.gs', 'Permisos.gs', 'Publicaciones.gs']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(PROY, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}
const S = contextoServidor();
/** Cada petición es una ejecución nueva de Apps Script: los memos de la anterior no existen. */
function ejecucion(fn) { vm.runInContext('SEC_SESION_ = null; SEC_ENTRADA_ = null; OP_GEN_MEMO = null;', S); return fn(); }
function reiniciar() {
  cache = {}; props = {}; plantillas = []; getAllRoto = false;
  Object.keys(cuentas).forEach((k) => { cuentas[k] = 0; });
  ponerLecturasACero();
}
function ponerLecturasACero() {
  lecturas.get = lecturas.getAll = lecturas.getProperty = lecturas.getProperties = 0;
  lecturas.pedidas = [];
}

// Lo que el Portal deja en caché cuando alguien ya lo abrió (misma forma que las funciones reales).
const LS = String.fromCharCode(0x2028);
const TOOLS = {
  status: 'ok', error: null,
  herramientas: [{ nombre: 'SOMS', enlace: 'https://soms', comoAcceder: '', descripcion: '', claves: '' }],
  presentaciones: [], paqueterias: [], formatos: [], pdePago: [], avisos: [], anuncios: [],
  plantillas: [{ titulo: 'Aviso', tipo: 'correo', asunto: 'x', cuerpo: 'Hola</script><script>alert(1)</script>' + LS + ' & <b>', consideraciones: '' }]
};
const APPDATA = {
  status: 'success', error: null,
  promociones: [
    { origen: 'Promociones', direccion: 'Hogar', categoria: 'Banner', promocion: '20% en sábanas', marca: 'X', vigencia: '20 al 30 de septiembre', liga: '#' },
    { origen: 'Promociones', direccion: 'Moda', categoria: 'Carrusel', promocion: 'Ya pasó', marca: 'Y', vigencia: '1 al 5 de septiembre', liga: '#' }
  ],
  eventos: []
};
const TRAZ = { status: 'ok', error: null, generado: '2026-09-24T18:00:00.000Z', hojaId: 'h', avisos: [],
  secciones: [{ id: 'bigticket', prefijo: 'bt', label: 'Big Ticket', etiqueta: 'BT', hoja: 'BT', tieneAvance: false,
    procesos: [{ n: 1, nombre: 'Entrega', tiempo: '3 días', observaciones: 'x'.repeat(500) }] }] };
const OP_PUBLICO = { success: true, sistemas: [{ clave: 'connect', nombre: 'Connect', tono: 'ok' }], incidentes: [] };

function calentar() {
  cache.toolsData_v1 = JSON.stringify(TOOLS);
  cache.appData_v1 = JSON.stringify(APPDATA);
  // Trazabilidad en una sola llave, como hoy (~47 KB). La troceada tiene su caso en A8.
  cache.trazData_v1 = JSON.stringify(TRAZ);
  props.OP_CACHE_GEN = '7';
  cache.op_g7_publico = JSON.stringify(OP_PUBLICO);
}

/** Trazabilidad guardada en `n` trozos, como la deja trazCachePut_ cuando pasa de 90 KB. */
function trocearTraz(n) {
  const t = JSON.stringify(TRAZ), paso = Math.ceil(t.length / n);
  Object.keys(cache).filter((k) => k.indexOf('trazData_v1') === 0).forEach((k) => delete cache[k]);
  cache.trazData_v1 = 'trozos:' + n;
  for (let i = 0; i < n; i++) cache['trazData_v1#' + i] = t.slice(i * paso, (i + 1) * paso);
}

console.log('\nA1 · Caché vacía: no se construye nada');
reiniciar();
{
  const r = ejecucion(() => S.datosInicialesDePagina_('portal'));
  ok('devuelve { datos, at, ms }', r && typeof r.datos === 'object' && typeof r.at === 'number' && typeof r.ms === 'number', r);
  ok('solo va la lista de módulos apagados (es una propiedad, no una caché)',
    JSON.stringify(Object.keys(r.datos)) === '["obtenerModulosPublicos"]', Object.keys(r.datos));
  ok('no abrió ninguna hoja', cuentas.hojas === 0, cuentas);
  ok('ni el Calendario ni Drive', cuentas.calendario === 0 && cuentas.drive === 0, cuentas);
  ok('no escribió nada (ni propiedades ni caché)', cuentas.escriturasProp === 0 && cuentas.escriturasCache === 0, cuentas);
}

console.log('\nA2 · Caché caliente: las cinco respuestas del Portal');
reiniciar(); calentar();
{
  const r = ejecucion(() => S.datosInicialesDePagina_('portal'));
  const claves = Object.keys(r.datos).sort();
  ok('están las cinco', JSON.stringify(claves) === JSON.stringify(['fetchPromoCounts', 'fetchToolsData', 'fetchTrazabilidadData', 'obtenerModulosPublicos', 'opEstadoPublico']), claves);
  ok('herramientas tal cual estaban en caché', JSON.stringify(r.datos.fetchToolsData) === JSON.stringify(TOOLS));
  ok('trazabilidad tal cual estaba en caché', JSON.stringify(r.datos.fetchTrazabilidadData) === JSON.stringify(TRAZ));
  ok('estado público de la generación vigente', JSON.stringify(r.datos.opEstadoPublico) === JSON.stringify(OP_PUBLICO));
  const pc = r.datos.fetchPromoCounts;
  ok('la cuenta de promociones se hace con la copia de la caché', pc.status === 'ok' && pc.activas === 1 && pc.promociones.length === 1 && pc.promociones[0].promocion === '20% en sábanas', pc);
  ok('…y da lo mismo que fetchPromoCounts()', JSON.stringify(pc) === JSON.stringify(ejecucion(() => S.fetchPromoCounts())));
  ok('sigue sin abrir hojas ni Calendario', cuentas.hojas === 0 && cuentas.calendario === 0, cuentas);
  ok('y sin escribir', cuentas.escriturasProp === 0 && cuentas.escriturasCache === 0, cuentas);
}

console.log('\nA3 · Lo que el cliente no aceptaría no se sirve');
reiniciar(); calentar();
{
  cache.toolsData_v1 = JSON.stringify({ status: 'error', error: 'hoja movida' });
  cache.trazData_v1 = JSON.stringify({ status: 'ok' });   // sin secciones
  cache.op_g7_publico = JSON.stringify({ success: false, message: 'x' });
  const r = ejecucion(() => S.datosInicialesDePagina_('portal'));
  ok('un status de error no viaja como dato', !('fetchToolsData' in r.datos), Object.keys(r.datos));
  ok('trazabilidad sin secciones tampoco', !('fetchTrazabilidadData' in r.datos));
  ok('ni un estado con success:false', !('opEstadoPublico' in r.datos));
  ok('lo demás sí', 'fetchPromoCounts' in r.datos && 'obtenerModulosPublicos' in r.datos, Object.keys(r.datos));
}

console.log('\nA4 · Una lectura que falla no tumba la página');
reiniciar(); calentar();
{
  cache.appData_v1 = '{roto';   // JSON corrupto en la caché
  vm.runInContext('var __opOriginal = opEstadoPublicoEnCache_; opEstadoPublicoEnCache_ = function () { throw new Error("caché caída"); };', S);
  let r = null;
  const err = lanza(() => { r = ejecucion(() => S.datosInicialesDePagina_('portal')); });
  vm.runInContext('opEstadoPublicoEnCache_ = __opOriginal;', S);
  ok('no lanza', err === null, err);
  ok('se omite lo que falló y sigue lo demás', r && !('opEstadoPublico' in r.datos) && !('fetchPromoCounts' in r.datos) && ('fetchToolsData' in r.datos), r && Object.keys(r.datos));
  ok('y la caché corrupta no provocó una lectura de hojas', cuentas.hojas === 0, cuentas);
}

console.log('\nA5 · Otras pantallas');
reiniciar(); calentar();
{
  const p = ejecucion(() => S.datosInicialesDePagina_('promociones'));
  ok('el Monitor recibe fetchApplicationData', p && JSON.stringify(Object.keys(p.datos)) === '["fetchApplicationData"]' && p.datos.fetchApplicationData.promociones.length === 2, p && Object.keys(p.datos));
  delete cache.appData_v1;
  const q = ejecucion(() => S.datosInicialesDePagina_('promociones'));
  ok('sin caché, nada (y sin leer hojas)', q && Object.keys(q.datos).length === 0 && cuentas.hojas === 0, q);
  ok('una pantalla sin lista (estado) → null', ejecucion(() => S.datosInicialesDePagina_('estado')) === null);
  ok('las de la app tampoco tienen (cotizacion) → null', ejecucion(() => S.datosInicialesDePagina_('cotizacion')) === null);
}

console.log('\nA6 · servirPagina_: qué pantalla lleva datos');
reiniciar(); calentar();
{
  const servir = (page) => {
    plantillas = [];
    ejecucion(() => S.doGet({ parameter: page ? { page: page } : {} }));
    const t = plantillas[plantillas.length - 1];
    return { archivo: t && t.__archivo, estado: t && t.APP_JSON ? JSON.parse(t.APP_JSON) : null, crudo: t && t.APP_JSON };
  };
  let r = servir('portal');
  ok('?page=portal → Index con las cinco respuestas', r.archivo === 'Index' && r.estado && Object.keys(r.estado.datos || {}).length === 5, r.estado && Object.keys(r.estado.datos || {}));
  ok('…y con la hora y el costo de la lectura', typeof r.estado.datosAt === 'number' && typeof r.estado.datosMs === 'number');
  ok('el texto de una plantilla no deja "<", ">", "&" ni U+2028 crudos en la página (no puede cerrar el <script>)',
    !/[<>&]/.test(r.crudo) && r.crudo.indexOf(LS) === -1, r.crudo.slice(0, 200));
  ok('…pero llega intacto al parsear', r.estado.datos.fetchToolsData.plantillas[0].cuerpo === TOOLS.plantillas[0].cuerpo);
  r = servir('');
  ok('sin ?page (la landing) → también', r.archivo === 'Index' && Object.keys(r.estado.datos || {}).length === 5);
  r = servir('no-existe');
  ok('una página desconocida cae en el Portal y lleva los del Portal', r.archivo === 'Index' && Object.keys(r.estado.datos || {}).length === 5);
  r = servir('promociones');
  ok('?page=promociones → los del Monitor', r.archivo === 'Promociones' && JSON.stringify(Object.keys(r.estado.datos || {})) === '["fetchApplicationData"]');
  r = servir('estado');
  ok('?page=estado → sin datos', r.archivo === 'estado' && !('datos' in r.estado), r.estado && Object.keys(r.estado));
  r = servir('cotizacion');
  ok('?page=cotizacion (app) → sin datos', r.archivo === 'cotizacion' && !('datos' in r.estado));
  ok('ninguna de estas peticiones abrió hojas ni escribió', cuentas.hojas === 0 && cuentas.escriturasProp === 0 && cuentas.escriturasCache === 0, cuentas);
}

console.log('\nA7 · La clave de la caché de operación es la misma al escribir y al leer');
reiniciar();
{
  props.OP_CACHE_GEN = '3';
  const producido = ejecucion(() => S.opCacheado_('publico', 45, () => ({ success: true, x: 1 })));
  ok('opCacheado_ guarda como siempre', producido.x === 1 && cache.op_g3_publico !== undefined, Object.keys(cache));
  ok('opEstadoPublicoEnCache_ lee eso mismo', JSON.stringify(ejecucion(() => S.opEstadoPublicoEnCache_())) === JSON.stringify({ success: true, x: 1 }));
  ejecucion(() => S.opInvalidarCache_());
  ok('tras invalidar (generación nueva) ya no hay nada que servir', ejecucion(() => S.opEstadoPublicoEnCache_()) === null);
}

console.log('\nA8 · F3a.1: un solo viaje a la caché y un tope a lo que viaja');
{
  // Lo que arma servirPagina_ para una pantalla, con las lecturas que costó.
  const servir = (page) => {
    plantillas = [];
    ponerLecturasACero();
    ejecucion(() => S.doGet({ parameter: { page: page } }));
    const t = plantillas[plantillas.length - 1];
    const estado = t && t.APP_JSON ? JSON.parse(t.APP_JSON) : {};
    return { datos: estado.datos || {}, lecturas: JSON.parse(JSON.stringify(lecturas)) };
  };
  const pedidas = (r) => [].concat(...r.lecturas.pedidas);
  const cinco = ['fetchPromoCounts', 'fetchToolsData', 'fetchTrazabilidadData', 'obtenerModulosPublicos', 'opEstadoPublico'];
  const claves = (r) => JSON.stringify(Object.keys(r.datos).sort());

  reiniciar(); calentar();
  let r = servir('portal');
  ok('Portal: las cinco respuestas…', claves(r) === JSON.stringify(cinco), Object.keys(r.datos));
  ok('…con UN solo getAll y ningún get suelto', r.lecturas.getAll === 1 && r.lecturas.get === 0, r.lecturas);
  ok('…que pide las cuatro claves y ninguna más',
    JSON.stringify(pedidas(r).slice().sort()) === JSON.stringify(['appData_v1', 'op_g7_publico', 'toolsData_v1', 'trazData_v1']), pedidas(r));
  ok('…y dos lecturas de propiedades como mucho (generación y módulos), nunca el almacén entero',
    r.lecturas.getProperty <= 2 && r.lecturas.getProperties === 0, r.lecturas);

  r = servir('promociones');
  ok('Monitor: un getAll con appData_v1 y nada más',
    r.lecturas.getAll === 1 && r.lecturas.get === 0 && JSON.stringify(pedidas(r)) === '["appData_v1"]' && r.lecturas.getProperty === 0, r.lecturas);
  r = servir('estado');
  ok('una pantalla sin lista no lee nada', r.lecturas.getAll === 0 && r.lecturas.get === 0 && r.lecturas.getProperty === 0, r.lecturas);

  // Trazabilidad troceada (su hoja creció de 90 KB): no viaja, y sus trozos ni se piden.
  reiniciar(); calentar(); trocearTraz(2);
  r = servir('portal');
  ok('troceada: trazabilidad se omite y las otras cuatro siguen',
    claves(r) === JSON.stringify(cinco.filter((f) => f !== 'fetchTrazabilidadData')), Object.keys(r.datos));
  ok('…sin pedir ningún trozo (crecer no encarece esta lectura)', !pedidas(r).some((k) => k.indexOf('#') !== -1) && r.lecturas.getAll === 1, pedidas(r));
  ponerLecturasACero();
  ok('la ejecución normal (trazCacheGet_) la sigue rearmando de sus trozos',
    JSON.stringify(ejecucion(() => S.trazCacheGet_())) === JSON.stringify(TRAZ));
  trocearTraz(3);
  cache['trazData_v1#3'] = 'basura de una escritura anterior más grande';
  ok('…un trozo de más, de una escritura anterior, se ignora', JSON.stringify(ejecucion(() => S.trazCacheGet_())) === JSON.stringify(TRAZ));
  delete cache['trazData_v1#1'];
  ok('…y si falta uno, la entrada entera se descarta', ejecucion(() => S.trazCacheGet_()) === null);
  // Sin el trozo del medio, lo que queda aquí SÍ sería un JSON válido: descartarlo es la regla,
  // no un accidente del JSON.parse.
  const cojo = { trazData_v1: 'trozos:3', 'trazData_v1#0': '{"status":"ok","secciones":[]', 'trazData_v1#2': ',"x":1}' };
  let armadoCojo = 'sin llamar';
  const errCojo = lanza(() => { armadoCojo = S.trazCacheDesdeLote_(cojo); });
  ok('…aunque lo que quede se pudiera leer', errCojo === null && armadoCojo === null, errCojo || armadoCojo);
  // Manda la cabeza también al armar: un lote que trae un trozo de más (p. ej. un getAll que los
  // pidiera todos) no lo pega.
  const t2 = JSON.stringify(TRAZ), mitad2 = Math.ceil(t2.length / 2);
  const conSobra = { trazData_v1: 'trozos:2', 'trazData_v1#0': t2.slice(0, mitad2), 'trazData_v1#1': t2.slice(mitad2), 'trazData_v1#2': 'basura' };
  let armado = null;
  const errArmado = lanza(() => { armado = S.trazCacheDesdeLote_(conSobra); });
  ok('…y el armado usa los N trozos de la cabeza, ni uno más', errArmado === null && JSON.stringify(armado) === JSON.stringify(TRAZ), errArmado);

  // Tope por respuesta: una de más de DATOS_TOPE_RESPUESTA no viaja.
  reiniciar(); calentar();
  const tope = vm.runInContext('DATOS_TOPE_RESPUESTA', S), topeTotal = vm.runInContext('DATOS_TOPE_TOTAL', S);
  ok('los topes son 100 000 y 150 000 caracteres', tope === 100000 && topeTotal === 150000, [tope, topeTotal]);
  cache.toolsData_v1 = JSON.stringify(Object.assign({}, TOOLS, { relleno: 'x'.repeat(tope + 1000) }));
  r = servir('portal');
  ok('herramientas de más de 100 000 caracteres se omiten…', !('fetchToolsData' in r.datos), Object.keys(r.datos));
  ok('…y las otras cuatro siguen', claves(r) === JSON.stringify(cinco.filter((f) => f !== 'fetchToolsData')), Object.keys(r.datos));

  // Tope total: cada una cabe sola, juntas no. Cae la que va más abajo en la lista.
  reiniciar(); calentar();
  cache.toolsData_v1 = JSON.stringify(Object.assign({}, TOOLS, { relleno: 'x'.repeat(90000) }));
  const trazGrande = JSON.parse(JSON.stringify(TRAZ));
  trazGrande.secciones[0].procesos[0].observaciones = 'x'.repeat(80000);
  cache.trazData_v1 = JSON.stringify(trazGrande);
  r = servir('portal');
  ok('90 KB + 80 KB: trazabilidad (declarada después) se queda fuera…', !('fetchTrazabilidadData' in r.datos) && 'fetchToolsData' in r.datos, Object.keys(r.datos));
  ok('…y las pequeñas de más abajo sí caben', 'obtenerModulosPublicos' in r.datos && 'opEstadoPublico' in r.datos && 'fetchPromoCounts' in r.datos, Object.keys(r.datos));
  const suma = Object.keys(r.datos).reduce((s, f) => s + JSON.stringify(r.datos[f]).length, 0);
  ok('lo que viaja no pasa del tope total', suma <= topeTotal, suma);
  ok('y el tope no provocó ninguna lectura de hojas', cuentas.hojas === 0, cuentas);

  // Si la caché entera falla, la página sale con lo que no depende de ella.
  reiniciar(); calentar();
  getAllRoto = true;
  let err = null;
  err = lanza(() => { r = servir('portal'); });
  ok('getAll caído: la página sale igual, sin lanzar…', err === null, err);
  ok('…con los módulos (una propiedad) y sin nada de la caché', claves(r) === '["obtenerModulosPublicos"]', r && Object.keys(r.datos));
  getAllRoto = false;

  // Una entrada cuyas claves no se pueden calcular no arrastra a las demás.
  reiniciar(); calentar();
  vm.runInContext('var __claveOriginal = opCacheClave_; opCacheClave_ = function () { throw new Error("propiedades caídas"); };', S);
  err = lanza(() => { r = servir('portal'); });
  vm.runInContext('opCacheClave_ = __claveOriginal;', S);
  ok('si falla la clave del estado público, no lanza y las otras cuatro siguen',
    err === null && claves(r) === JSON.stringify(cinco.filter((f) => f !== 'opEstadoPublico')), err || (r && Object.keys(r.datos)));
}

/* ═════════════════════════════════════════════════════════════════════════════════════
   B · CLIENTE: el AppRun real de app_core.html
   ═════════════════════════════════════════════════════════════════════════════════════ */

const CORE = fs.readFileSync(path.join(PROY, 'app_core.html'), 'utf8');
const BLOQUE = (CORE.match(/  const AppRun = \(function \(\) \{[\s\S]*?\n  \}\)\(\);/) || [])[0];
if (!BLOQUE) throw new Error('No se encontró el bloque de AppRun en app_core.html');

function contextoCliente(opciones) {
  opciones = opciones || {};
  const almacen = {};
  const llamadas = [];
  const servidor = {};
  const vencidas = [];
  const store = () => {
    const m = {};
    return {
      get: (n) => (n in m ? { data: m[n].data, at: m[n].at } : null),
      set: (n, data) => { m[n] = { data: JSON.parse(JSON.stringify(data)), at: Date.now() }; return true; },
      _m: m
    };
  };
  const appCache = store();
  appCache.session = store();
  function corredor(conf) {
    const run = {
      withSuccessHandler(fn) { return corredor(Object.assign({}, conf, { bien: fn })); },
      withFailureHandler(fn) { return corredor(Object.assign({}, conf, { mal: fn })); },
      secEjecutar(llave, fn, args, actividad, medir) {
        llamadas.push({ fn, args, medir, n: arguments.length });
        const r = servidor[fn];
        setTimeout(() => {
          if (r instanceof Error) conf.mal(r);
          else conf.bien(typeof r === 'function' ? r(args, medir) : r);
        }, 2);
      }
    };
    // F3b. Como el de Sesiones.gs: { v, ms } o { e } por función, en orden. `servidor.__lote`
    // puede tumbar el lote entero (un Error) o contestar otra cosa (una función).
    if (!opciones.sinLote) {
      run.secEjecutarLote = function (llave, lote, actividad) {
        llamadas.push({ fn: 'secEjecutarLote', lote: lote.map((x) => x[0]), args: lote.map((x) => x[1]), llave, actividad, n: arguments.length });
        const todo = servidor.__lote;
        setTimeout(() => {
          if (todo instanceof Error) return conf.mal(todo);
          if (typeof todo === 'function') return conf.bien(todo(lote));
          conf.bien(lote.map((x) => {
            const r = servidor[x[0]];
            if (r instanceof Error) return { e: r.message };
            return { v: typeof r === 'function' ? r(x[1]) : r, ms: 7 };
          }));
        }, 2);
      };
    }
    return run;
  }
  const ctx = {
    console, JSON, Math, Object, Array, String, Number, Error, RegExp, Promise, Date,
    setTimeout, clearTimeout,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    performance: { now: () => 1234.4 },
    localStorage: {
      getItem: (k) => { if (opciones.almacenRoto) throw new Error('almacén bloqueado'); return k in almacen ? almacen[k] : null; },
      setItem: (k, v) => { if (opciones.almacenRoto) throw new Error('almacén bloqueado'); almacen[k] = String(v); },
      removeItem: (k) => { delete almacen[k]; }
    },
    AppBusy: { start: () => 1, done: () => {} },
    AppCache: appCache,
    AppSession: { llave: 'vs1.llave', ultimaActividad: () => 111 },
    google: { script: { run: corredor({}) } },
    __APP__: opciones.app
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('var ultimoContacto = 0; function sesionVencida(m) { __vencidas.push(m || "vencida"); }', Object.assign(ctx, { __vencidas: vencidas }));
  vm.runInContext(BLOQUE + '\nwindow.AppRunPrueba = AppRun;', ctx, { filename: 'app_core.html (AppRun)' });
  return { R: ctx.AppRunPrueba, llamadas, servidor, almacen, appCache, vencidas, ctx };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function cliente() {
  console.log('\nB1 · swr con la respuesta dentro de la página');
  {
    const c = contextoCliente({ app: { datos: { fetchToolsData: { status: 'ok', v: 1 } }, datosAt: 5000 } });
    c.servidor.fetchToolsData = { __srv: 1, v: { status: 'ok', v: 2 }, ms: 30 };
    const pintadas = [];
    const p = c.R.swr('portal-x', 'fetchToolsData', [], { ttl: 60000, accept: (d) => d.status !== 'error', onData: (d, deCache, at) => pintadas.push([d.v, deCache, at]) });
    ok('se pinta EN EL ACTO, una sola vez, como respuesta del servidor (deCache=false)', pintadas.length === 1 && pintadas[0][0] === 1 && pintadas[0][1] === false, pintadas);
    ok('con la hora en que el servidor la leyó', pintadas[0][2] === 5000, pintadas[0]);
    const v = await p;
    ok('la promesa resuelve con el dato', v && v.v === 1, v);
    ok('sin viajar al servidor', c.llamadas.length === 0, c.llamadas);
    ok('y queda guardada en la copia local', c.appCache._m['portal-x'] && c.appCache._m['portal-x'].data.v === 1);
    ok('se usa UNA vez: sale de __APP__.datos', !('fetchToolsData' in c.ctx.__APP__.datos));
    const pintadas2 = [];
    await c.R.swr('portal-x', 'fetchToolsData', [], { onData: (d, deCache) => pintadas2.push([d.v, deCache]) });
    ok('la siguiente vez revalida contra el servidor (copia local primero, luego la respuesta)',
      c.llamadas.length === 1 && JSON.stringify(pintadas2) === '[[1,true],[2,false]]', { llamadas: c.llamadas, pintadas2 });
  }

  console.log('\nB2 · Cuándo NO se usa la respuesta de la página');
  {
    let c = contextoCliente({ app: { datos: { fetchToolsData: { status: 'error' } } } });
    c.servidor.fetchToolsData = { status: 'ok', v: 9 };
    let pint = [];
    await c.R.swr('k', 'fetchToolsData', [], { accept: (d) => d.status !== 'error', onData: (d, dc) => pint.push([d.status, dc]) });
    ok('si el cliente no la acepta, se pide al servidor', c.llamadas.length === 1 && JSON.stringify(pint) === '[["ok",false]]', { l: c.llamadas, pint });
    ok('…y la rechazada se descarta', !('fetchToolsData' in c.ctx.__APP__.datos));

    c = contextoCliente({ app: { datos: { fetchToolsData: { status: 'ok', v: 1 } } } });
    c.servidor.fetchToolsData = { status: 'ok', v: 2 };
    pint = [];
    await c.R.swr('k', 'fetchToolsData', [], { fuerza: true, onData: (d) => pint.push(d.v) });
    ok('«Actualizar» (fuerza) va al servidor', c.llamadas.length === 1 && JSON.stringify(pint) === '[2]', pint);
    ok('…y descarta la de la página para que no reaparezca luego como nueva', !('fetchToolsData' in c.ctx.__APP__.datos));

    c = contextoCliente({ app: { datos: { getQuotesForUser: { v: 1 } } } });
    c.servidor.getQuotesForUser = { v: 2 };
    await c.R.swr('q', 'getQuotesForUser', ['a@b.c'], {});
    ok('con argumentos nunca se usa (todo lo servido así es sin argumentos)', c.llamadas.length === 1 && ('getQuotesForUser' in c.ctx.__APP__.datos));

    c = contextoCliente({ app: { datos: { obtenerModulosPublicos: { success: true, apagados: ['x'] } } } });
    c.servidor.obtenerModulosPublicos = { success: true, apagados: [] };
    let r = await c.R.call('obtenerModulosPublicos', [], {});
    ok('call sin `inline` va al servidor aunque la página la traiga', c.llamadas.length === 1 && r.apagados.length === 0, r);
    r = await c.R.call('obtenerModulosPublicos', [], { inline: true });
    ok('call con inline:true la toma de la página, sin viajar', c.llamadas.length === 1 && r.apagados[0] === 'x', r);
    r = await c.R.call('obtenerModulosPublicos', [], { inline: true });
    ok('…una sola vez', c.llamadas.length === 2 && r.apagados.length === 0, c.llamadas.length);

    c = contextoCliente({ app: undefined });
    c.servidor.fetchToolsData = { status: 'ok' };
    await c.R.swr('k', 'fetchToolsData', [], {});
    ok('una página sin __APP__ (o sin datos) funciona como antes', c.llamadas.length === 1);
  }

  console.log('\nB3 · Tiempo de servidor y medidas');
  {
    const c = contextoCliente({ app: {} });
    c.servidor.nueva = { __srv: 1, v: { a: 1 }, ms: 42 };
    c.servidor.vieja = { a: 2 };
    c.servidor.nula = null;
    const a = await c.R.call('nueva', ['x']);
    ok('la respuesta envuelta se desenvuelve', a && a.a === 1 && !('__srv' in a), a);
    ok('secEjecutar recibe 5 argumentos y pide medir (= 1)', c.llamadas[0].n === 5 && c.llamadas[0].medir === 1, c.llamadas[0]);
    const b = await c.R.call('vieja', []);
    ok('un servidor anterior (sin envoltorio) sigue funcionando', b && b.a === 2, b);
    ok('una respuesta null (un Date en el servidor) sigue llegando null', (await c.R.call('nula', [])) === null);
    const crudo = c.R.medidas(true);
    const mNueva = crudo.find((m) => m.f === 'nueva'), mVieja = crudo.find((m) => m.f === 'vieja');
    ok('se apunta el tiempo del servidor cuando lo dice', mNueva && mNueva.s === 42 && mNueva.o === 'red' && mNueva.ok === 1 && mNueva.ms >= 0, mNueva);
    ok('…y -1 cuando no lo dice', mVieja && mVieja.s === -1, mVieja);
    ok('con el momento de salida relativo a la pantalla', mNueva.d === 1234 && typeof mNueva.t === 'number', mNueva);

    c.servidor.falla = new Error('boom');
    let err = null;
    await c.R.call('falla', []).catch((e) => { err = e; });
    ok('un fallo se sigue rechazando igual', err && err.message === 'boom', err && err.message);
    ok('…y se apunta como error', c.R.medidas(true).some((m) => m.f === 'falla' && m.ok === 0));
    c.servidor.vence = new Error('SESION_EXPIRADA: se cerró');
    await c.R.call('vence', []).catch(() => {});
    ok('SESION_EXPIRADA sigue avisando a la sesión', c.vencidas.length === 1, c.vencidas);

    for (let i = 0; i < 100; i++) { c.servidor['f' + (i % 3)] = { __srv: 1, v: i, ms: i }; await c.R.call('f' + (i % 3), [i]); }
    ok('el anillo se queda en las últimas 80', c.R.medidas(true).length === 80, c.R.medidas(true).length);
    const resumen = c.R.medidas();
    const f0 = resumen.find((x) => x.fn === 'f0');
    ok('el resumen trae por función n, errores, p50, p90 y servidorP50',
      f0 && typeof f0.n === 'number' && f0.errores === 0 && typeof f0.p50 === 'number' && typeof f0.p90 === 'number' && typeof f0.servidorP50 === 'number', f0);

    const d = contextoCliente({ app: { datos: { fetchPromoCounts: { status: 'ok' } } } });
    await d.R.swr('p', 'fetchPromoCounts', [], {});
    const mp = d.R.medidas(true)[0];
    ok('lo que vino en la página se apunta como o:"pagina"', mp && mp.o === 'pagina' && mp.f === 'fetchPromoCounts' && mp.s === -1, mp);
  }

  console.log('\nB4 · Lo de siempre sigue igual');
  {
    const c = contextoCliente({ app: {} });
    c.servidor.lenta = { __srv: 1, v: 'ok', ms: 1 };
    const [x, y] = await Promise.all([c.R.call('lenta', [1]), c.R.call('lenta', [1])]);
    ok('dos llamadas iguales a la vez siguen siendo UN viaje', c.llamadas.length === 1 && x === 'ok' && y === 'ok', c.llamadas.length);

    const roto = contextoCliente({ app: {}, almacenRoto: true });
    roto.servidor.algo = { __srv: 1, v: 5, ms: 1 };
    let v = null, e = null;
    await roto.R.call('algo', []).then((r) => { v = r; }, (er) => { e = er; });
    ok('con localStorage bloqueado, medir no rompe la llamada', v === 5 && e === null, e && e.message);
    ok('…y medidas() devuelve una lista vacía en vez de lanzar', Array.isArray(roto.R.medidas()) && roto.R.medidas().length === 0);
  }

  console.log('\nB5 · F3b: las llamadas de fondo viajan juntas');
  {
    const c = contextoCliente({ app: {} });
    c.servidor.obtenerPermisosSesion = { success: true, rol: 'normal' };
    c.servidor.prefsLeer = { success: true, prefs: { tema: 'claro' } };
    c.servidor.onbEstado = { success: true, vistos: { portal: 1 } };
    c.servidor.fetchToolsData = { __srv: 1, v: { status: 'ok' }, ms: 3 };
    const pa = c.R.call('obtenerPermisosSesion', ['a@b.c'], { key: 'permisos-sesion' });
    const pb = c.R.call('prefsLeer', ['a@b.c'], { key: 'prefs-prefsLeer', busy: false });
    const pc = c.R.call('onbEstado', ['a@b.c'], { key: 'onb-estado' });
    ok('las de la lista esperan en la cola: todavía no salió ninguna', c.llamadas.length === 0, c.llamadas);
    const pd = c.R.call('fetchToolsData', [], {});
    ok('una que no está en la lista (pinta la pantalla) sale en el acto', c.llamadas.length === 1 && c.llamadas[0].fn === 'fetchToolsData', c.llamadas);
    const [a, b, d] = await Promise.all([pa, pb, pc]);
    const lotes = c.llamadas.filter((x) => x.fn === 'secEjecutarLote');
    ok('las tres salen en UN solo viaje (secEjecutarLote)', lotes.length === 1 &&
      JSON.stringify(lotes[0].lote) === '["obtenerPermisosSesion","prefsLeer","onbEstado"]', c.llamadas);
    ok('…con sus argumentos, la llave y la actividad', JSON.stringify(lotes[0].args) === '[["a@b.c"],["a@b.c"],["a@b.c"]]' &&
      lotes[0].llave === 'vs1.llave' && lotes[0].actividad === 111 && lotes[0].n === 3, lotes[0]);
    ok('cada promesa recibe SU respuesta', a.rol === 'normal' && b.prefs.tema === 'claro' && d.vistos.portal === 1, [a, b, d]);
    const enLote = c.R.medidas(true).filter((m) => m.l === 3);
    ok('las medidas dicen que viajaron juntas (l = 3), con su tiempo de servidor', enLote.length === 3 && enLote.every((m) => m.s === 7 && m.ok === 1), enLote);
    ok('…y el resumen lo cuenta (enLote)', c.R.medidas().find((x) => x.fn === 'prefsLeer').enLote === 1);
    ok('la que fue sola no lleva `l`', !('l' in c.R.medidas(true).find((m) => m.f === 'fetchToolsData')));
    await pd;
  }
  {
    const c = contextoCliente({ app: {} });
    c.servidor.opEstadoSesion = { __srv: 1, v: { success: true, x: 1 }, ms: 2 };
    const r = await c.R.call('opEstadoSesion', ['a@b.c'], {});
    ok('una sola en su ventana viaja por secEjecutar, como siempre', c.llamadas.length === 1 && c.llamadas[0].fn === 'opEstadoSesion' &&
      c.llamadas[0].medir === 1 && r.x === 1, c.llamadas);
  }
  {
    const c = contextoCliente({ app: {} });
    c.servidor.prefsLeer = new Error('hoja caída');
    c.servidor.onbEstado = { success: true };
    const res = await Promise.allSettled([c.R.call('prefsLeer', ['a']), c.R.call('onbEstado', ['a'])]);
    ok('una que falla dentro del lote se rechaza SOLA, con su mensaje', res[0].status === 'rejected' && res[0].reason.message === 'hoja caída' &&
      res[1].status === 'fulfilled' && res[1].value.success === true, res.map((x) => x.status));
    ok('…se apunta como error, en lote', c.R.medidas(true).some((m) => m.f === 'prefsLeer' && m.ok === 0 && m.l === 2));
    ok('…y no toca la sesión', c.vencidas.length === 0, c.vencidas);
  }
  {
    const c = contextoCliente({ app: {} });
    c.servidor.__lote = new Error('SESION_EXPIRADA: se cerró');
    const res = await Promise.allSettled(['prefsLeer', 'onbEstado', 'obtenerPermisosSesion'].map((f) => c.R.call(f, ['a'])));
    ok('SESION_EXPIRADA en el lote rechaza las tres', res.every((x) => x.status === 'rejected' && /^SESION_EXPIRADA/.test(x.reason.message)), res.map((x) => x.status));
    ok('…y avisa a la sesión UNA sola vez', c.vencidas.length === 1, c.vencidas);
  }
  {
    const c = contextoCliente({ app: {} });
    c.servidor.__lote = () => null;   // p. ej. un Date dentro: Apps Script entrega la respuesta entera como null
    const res = await Promise.allSettled([c.R.call('prefsLeer', ['a']), c.R.call('onbEstado', ['a'])]);
    ok('una respuesta de lote que no cuadra rechaza todas (nadie pinta basura)', res.every((x) => x.status === 'rejected'), res.map((x) => x.status));
  }
  {
    const c = contextoCliente({ app: {}, sinLote: true });
    c.servidor.prefsLeer = { success: true, a: 1 };
    c.servidor.onbEstado = { success: true, b: 2 };
    const [x, y] = await Promise.all([c.R.call('prefsLeer', ['a']), c.R.call('onbEstado', ['a'])]);
    ok('con un servidor sin secEjecutarLote, cada una sale por su lado', c.llamadas.length === 2 &&
      c.llamadas.every((l) => l.fn !== 'secEjecutarLote') && x.a === 1 && y.b === 2, c.llamadas);
  }
  {
    const c = contextoCliente({ app: {} });
    c.servidor.pubResultados = (args) => ({ status: 'ok', id: args[0] });
    const dup = await Promise.all([c.R.call('pubResultados', ['p1', '']), c.R.call('pubResultados', ['p1', ''])]);
    ok('dos iguales a la vez siguen siendo UNA en la cola', c.llamadas.length === 1 && c.llamadas[0].fn === 'pubResultados' && dup[0] === dup[1], c.llamadas);
    c.llamadas.length = 0;
    const muchas = await Promise.all([...Array(9)].map((_, i) => c.R.call('pubResultados', ['q' + i, ''])));
    const viajes = c.llamadas.map((x) => (x.fn === 'secEjecutarLote' ? x.lote.length : 1));
    ok('nueve a la vez → un lote de 8 y la que sobra, sola', JSON.stringify(viajes) === '[8,1]', viajes);
    ok('…y cada una con la suya', muchas.every((r, i) => r.id === 'q' + i), muchas);
  }
}

/* ═════════════════════════════════════════════════════════════════════════════════════
   C · ESTÁTICO: `__APP__` ya no son solo parámetros de la URL
   Desde la F3 también trae `datos`, `datosAt` y `datosMs`. Si alguna pantalla recorriera
   __APP__ entero para armar un enlace o reescribir la barra, cada URL del Portal saldría con
   `&datos=[object Object]&datosAt=…`. Hoy nadie lo hace: AppUrl.params() recorre la lista
   fija PARAMS_VISTA y el resto lee claves concretas. Esto vigila que siga así.
   ═════════════════════════════════════════════════════════════════════════════════════ */
function estatico() {
  console.log('\nC · Nadie recorre __APP__ entero');
  ok('AppUrl.params() recorre la lista PARAMS_VISTA, no __APP__',
    /params: function \(\) \{[\s\S]{0,200}?PARAMS_VISTA\.forEach/.test(CORE));
  const recorridos = /Object\.(keys|entries|values|assign)\(\s*(\{\}\s*,\s*)?(window\.__APP__|cfg)\b|\.\.\.\s*(window\.__APP__|cfg)\b|\bin\s+(window\.__APP__|cfg)\s*\)/;
  const culpables = fs.readdirSync(PROY).filter((f) => f.endsWith('.html'))
    .filter((f) => recorridos.test(fs.readFileSync(path.join(PROY, f), 'utf8')));
  ok('ningún .html enumera, copia o esparce __APP__ (ni el `cfg` de app_core)', culpables.length === 0, culpables);
  const code = fs.readFileSync(path.join(PROY, 'Code.gs'), 'utf8');
  const params = JSON.parse(code.match(/const PARAMS_VISTA = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  ok('ningún parámetro de vista se llama como los campos nuevos', !params.some((p) => ['datos', 'datosAt', 'datosMs'].includes(p)), params);
}

cliente().then(() => {
  estatico();
  console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
  process.exit(fallos ? 1 : 0);
}, (e) => { console.log('✖ la prueba reventó: ' + (e && e.stack || e)); process.exit(1); });
