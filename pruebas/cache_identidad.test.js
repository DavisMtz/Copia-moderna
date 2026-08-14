/*
 * Pruebas de CacheIdentidad.gs.   Ejecutar:  node pruebas/cache_identidad.test.js
 *
 * Mismo enfoque que ttl_cache.test.js: se carga el archivo REAL en un contexto con stubs de
 * PropertiesService, CacheService y Logger. Un "contexto nuevo" equivale a una ejecución nueva de
 * Apps Script —que es justo el punto de todo este cambio: el memo global se pierde entre llamadas
 * y la caché tiene que sobrevivir por su cuenta—.
 *
 * Lo que se comprueba aquí no es "guarda y lee": es que no pueda mentir. Un índice vacío cacheado
 * dejaría al equipo entero fuera del sistema sin un solo error en el registro, y una fila cacheada
 * y obsoleta escribiría los permisos de una persona encima de otra. Esas dos son las pruebas que
 * importan.
 *
 * Esta carpeta queda fuera de "Carpeta del proyecto", así que clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FUENTE = path.join(__dirname, '..', 'Carpeta del proyecto', 'CacheIdentidad.gs');

let reloj = 1_700_000_000;
let propiedades = {};
let cache = {};                 // clave -> {v, ttl, expira}
let puestos = [];               // registro de puts, para ver clave y TTL
let logs = [];
let cacheRota = false;          // simula CacheService caído

function nuevoContexto() {
  const ctx = {
    Math, JSON, String, Number, Object, Array, parseInt, parseFloat, isNaN,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in propiedades ? propiedades[k] : null),
        setProperty: (k, v) => { propiedades[k] = String(v); }
      })
    },
    CacheService: {
      getScriptCache: () => {
        if (cacheRota) throw new Error('CacheService no disponible');
        return {
          put: (k, v, ttl) => { puestos.push({ k, ttl, bytes: v.length }); cache[k] = { v, ttl, expira: reloj + ttl }; },
          get: (k) => (cache[k] && cache[k].expira > reloj ? cache[k].v : null),
          remove: (k) => { delete cache[k]; }
        };
      }
    },
    Logger: { log: (...a) => logs.push(a.join(' ')) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(FUENTE, 'utf8'), ctx, { filename: 'CacheIdentidad.gs' });
  return ctx;
}

/* Mundo limpio. */
function reset() {
  reloj = 1_700_000_000;
  propiedades = {}; cache = {}; puestos = []; logs = []; cacheRota = false;
  return nuevoContexto();
}

/* Nueva ejecución de Apps Script: se conservan propiedades y caché, el memo arranca vacío. */
function nuevaEjecucion() { return nuevoContexto(); }

let fallos = 0, pruebas = 0;
function ok(nombre, cond, detalle) {
  pruebas++;
  if (cond) { console.log('  ✔ ' + nombre); }
  else { fallos++; console.log('  ✖ ' + nombre + (detalle ? '  →  ' + detalle : '')); }
}
function eq(nombre, real, esperado) {
  ok(nombre, real === esperado, 'esperado ' + JSON.stringify(esperado) + ', obtuve ' + JSON.stringify(real));
}

const INDICE = {
  'ana@liverpool.com.mx':  { nombre: 'Ana',  avanzado: false, alta: '2025-05-02T10:00:00.000Z', fila: 2 },
  'beto@liverpool.com.mx': { nombre: 'Beto', avanzado: true,  alta: '2025-06-11T10:00:00.000Z', fila: 3 }
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. Proyecto recién desplegado');
{
  const c = reset();
  eq('la generación arranca en "0"', c.idcGeneracion_(), '0');
  eq('la clave lleva la generación', c.idcClave_('registros'), 'idc_g0_registros');
  eq('sin nada guardado, devuelve null', c.idcLeer_('registros'), null);
}

console.log('\n2. El dato sobrevive ENTRE ejecuciones (el motivo de todo esto)');
{
  const c1 = reset();
  c1.idcGuardar_('registros', INDICE);

  const c2 = nuevaEjecucion();            // otra llamada de google.script.run
  const leido = c2.idcLeer_('registros');
  ok('la segunda ejecución lo encuentra', !!leido);
  eq('con las mismas personas', Object.keys(leido).length, 2);
  eq('y los mismos datos', leido['beto@liverpool.com.mx'].avanzado, true);
  eq('la fila viaja como número', typeof leido['ana@liverpool.com.mx'].fila, 'number');
  eq('se guardó con el TTL de red de seguridad', puestos[0].ttl, 600);
}

console.log('\n3. REGLA 3 · un índice vacío NUNCA se cachea');
{
  const c = reset();
  c.idcGuardar_('registros', {});
  eq('no se escribió nada', puestos.length, 0);
  eq('y no se lee nada', c.idcLeer_('registros'), null);

  // El caso que esto evita: la hoja falla, secIndiceRegistros_ devuelve {} y si se cacheara,
  // TODO EL EQUIPO se quedaría sin acceso durante el TTL sin un solo error que lo explicara.
  c.idcGuardar_('permisos', {});
  eq('lo mismo para permisos', c.idcLeer_('permisos'), null);

  // Y si un objeto vacío llegara desde una versión anterior, la lectura lo descarta.
  cache['idc_g0_registros'] = { v: '{}', ttl: 600, expira: reloj + 600 };
  eq('un {} ya guardado se descarta al leerlo', c.idcLeer_('registros'), null);
}

console.log('\n4. Invalidar deja obsoleta toda la caché de golpe');
{
  const c1 = reset();
  c1.idcGuardar_('registros', INDICE);
  c1.idcGuardar_('permisos', { 'ana@liverpool.com.mx': { rol: 'maestro', permisos: '', activo: true, fila: 2 } });
  ok('las dos están guardadas', !!c1.idcLeer_('registros') && !!c1.idcLeer_('permisos'));

  c1.idcInvalidar_();
  eq('la generación sube', c1.idcGeneracion_(), '1');
  eq('registros ya no se ve', c1.idcLeer_('registros'), null);
  eq('permisos tampoco', c1.idcLeer_('permisos'), null);

  const c2 = nuevaEjecucion();
  eq('y en la ejecución siguiente sigue sin verse', c2.idcLeer_('registros'), null);
  eq('la generación persiste en propiedades', c2.idcGeneracion_(), '1');
}

console.log('\n5. Alta de usuario: entra a la PRIMERA, sin esperar el TTL');
{
  const c1 = reset();
  c1.idcGuardar_('registros', INDICE);                 // Ana y Beto en caché

  const c2 = nuevaEjecucion();                          // se da de alta a Caro
  c2.idcInvalidar_();                                   // ← cuentasAltaUsuario_ hace esto

  const c3 = nuevaEjecucion();                          // Caro intenta entrar
  eq('la caché vieja no la puede dejar fuera', c3.idcLeer_('registros'), null);
}

console.log('\n6. La generación da la vuelta sin romper la clave');
{
  const c = reset();
  propiedades.IDC_CACHE_GEN = '999999';
  const c2 = nuevaEjecucion();
  c2.idcInvalidar_();
  eq('999999 → 0', c2.idcGeneracion_(), '0');
  eq('la clave sigue siendo válida', c2.idcClave_('registros'), 'idc_g0_registros');
}

console.log('\n7. Guardián de tamaño: si no cabe, se sirve sin caché (no se falla)');
{
  const c = reset();
  const enorme = {};
  for (let i = 0; i < 4000; i++) {
    enorme['persona' + i + '@liverpool.com.mx'] = { nombre: 'Nombre Apellido ' + i, avanzado: false, alta: '2025-01-01T00:00:00.000Z', fila: i + 2 };
  }
  ok('el índice de prueba supera el tope', JSON.stringify(enorme).length > c.IDC_MAX_BYTES);
  c.idcGuardar_('registros', enorme);
  eq('no se guardó', puestos.length, 0);
  ok('y quedó dicho en el registro', logs.some(l => l.indexOf('no cabe') > -1), JSON.stringify(logs));

  puestos = [];
  c.idcGuardar_('registros', INDICE);
  eq('uno normal sí cabe', puestos.length, 1);
}

console.log('\n8. Si CacheService falla, nada revienta');
{
  const c = reset();
  cacheRota = true;
  let lanzo = false;
  try { c.idcGuardar_('registros', INDICE); } catch (e) { lanzo = true; }
  ok('guardar no lanza', !lanzo);
  lanzo = false;
  let r;
  try { r = c.idcLeer_('registros'); } catch (e) { lanzo = true; }
  ok('leer no lanza', !lanzo);
  eq('leer devuelve null y el llamador irá a la hoja', r, null);
}

console.log('\n9. Si PropertiesService falla, se sigue funcionando');
{
  reset();
  const ctx = nuevoContexto();
  ctx.PropertiesService = { getScriptProperties: () => { throw new Error('sin propiedades'); } };
  vm.runInContext('IDC_GEN_MEMO = null;', ctx);
  eq('la generación cae a "0"', ctx.idcGeneracion_(), '0');
  let lanzo = false;
  try { ctx.idcInvalidar_(); } catch (e) { lanzo = true; }
  ok('invalidar no lanza', !lanzo);
  ok('y queda anotado', logs.some(l => l.indexOf('idcInvalidar_') > -1), JSON.stringify(logs));
}

console.log('\n10. JSON corrupto en la caché no tumba la lectura');
{
  const c = reset();
  cache['idc_g0_registros'] = { v: '{esto no es json', ttl: 600, expira: reloj + 600 };
  let lanzo = false, r;
  try { r = c.idcLeer_('registros'); } catch (e) { lanzo = true; }
  ok('no lanza', !lanzo);
  eq('devuelve null', r, null);
}

console.log('\n11. El TTL caduca solo (red de seguridad para ediciones a mano)');
{
  const c1 = reset();
  c1.idcGuardar_('registros', INDICE);
  reloj += c1.IDC_TTL - 1;
  ok('justo antes del TTL sigue ahí', !!nuevaEjecucion().idcLeer_('registros'));
  reloj += 2;
  eq('pasado el TTL, se relee la hoja', nuevaEjecucion().idcLeer_('registros'), null);
}

console.log('\n12. idcDiagnostico');
{
  const c = reset();
  const r = c.idcDiagnostico();
  ok('reporta ok', r.ok === true);
  ok('confirma que rechaza el vacío', r.rechazaVacio === true);
  ok('la generación cambia', r.generacionAntes !== r.generacionDespues);
  eq('reporta el TTL vigente', r.ttl, 600);
  eq('reporta el tope de tamaño', r.tope, 90000);
}

console.log('\n─────────────────────────────────────────────');
console.log(fallos === 0 ? `TODO OK · ${pruebas} comprobaciones` : `${fallos} FALLOS de ${pruebas}`);
process.exit(fallos === 0 ? 0 : 1);
