/*
 * Pruebas del TTL adaptativo de Cache.gs.   Ejecutar:  node pruebas/ttl_cache.test.js
 *
 * Apps Script no se puede correr en local, pero Cache.gs es JavaScript plano: se carga el archivo
 * REAL (no una copia) en un contexto con stubs de PropertiesService, CacheService, Logger y
 * Utilities, y con un reloj que avanzamos a mano. Eso permite comprobar en un segundo cosas que
 * en producción tardarían horas en verse: cómo queda la caducidad en hora pico, de madrugada,
 * con la propiedad en formato viejo o corrupta.
 *
 * Esta carpeta queda fuera de "Carpeta del proyecto", así que clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FUENTE = path.join(__dirname, '..', 'Carpeta del proyecto', 'Cache.gs');

let reloj = 1_700_000_000;            // epoch en segundos, controlable
let propiedades = {};
let cache = {};                        // clave -> {valor, ttl, expira}
let puestos = [];                      // registro de puts (para ver el TTL efectivo)
let logs = [];

function nuevoContexto() {
  const ctx = {
    // Las funciones de diagnóstico llevan el candado de Sesiones.gs; aquí se prueba la caché, no la seguridad (eso lo cubre sesiones.test.js).
    secSoloInterno_: () => {},
    Date: { now: () => reloj * 1000 },
    Math, JSON, String, Number, Object, Array, parseInt, parseFloat, isNaN,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in propiedades ? propiedades[k] : null),
        setProperty: (k, v) => { propiedades[k] = String(v); }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        put: (k, v, ttl) => { puestos.push({ k, ttl }); cache[k] = { v, ttl, expira: reloj + ttl }; },
        putAll: (mapa, ttl) => { Object.keys(mapa).forEach(k => { puestos.push({ k, ttl }); cache[k] = { v: mapa[k], ttl, expira: reloj + ttl }; }); },
        get: (k) => (cache[k] && cache[k].expira > reloj ? cache[k].v : null),
        getAll: (ks) => { const o = {}; ks.forEach(k => { if (cache[k] && cache[k].expira > reloj) o[k] = cache[k].v; }); return o; },
        remove: (k) => { delete cache[k]; }
      })
    },
    Logger: { log: (...a) => logs.push(a.join(' ')) },
    Utilities: {
      DigestAlgorithm: { MD5: 'MD5' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: (_a, texto) => Array.from(require('crypto').createHash('md5').update(String(texto)).digest())
    }
  };
  // `new Date()` solo se usa para un texto de diagnóstico
  ctx.Date = function () { return { toISOString: () => '2026-01-01T00:00:00.000Z' }; };
  ctx.Date.now = () => reloj * 1000;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(FUENTE, 'utf8'), ctx, { filename: 'Cache.gs' });
  return ctx;
}

/* Reinicia todo el mundo simulado y devuelve un contexto fresco
   (equivale a una ejecución nueva de Apps Script: el memo arranca vacío). */
function reset(propInicial) {
  reloj = 1_700_000_000;
  propiedades = propInicial ? { COT_CACHE_GEN: propInicial } : {};
  cache = {}; puestos = []; logs = [];
  return nuevoContexto();
}

/* Nueva "ejecución" conservando propiedades y caché (memo limpio). */
function nuevaEjecucion() { return nuevoContexto(); }

let fallos = 0, pruebas = 0;
function ok(nombre, cond, detalle) {
  pruebas++;
  if (cond) { console.log('  ✔ ' + nombre); }
  else { fallos++; console.log('  ✖ ' + nombre + (detalle ? '  →  ' + detalle : '')); }
}
function eq(nombre, real, esperado) {
  ok(nombre, real === esperado, 'esperado ' + esperado + ', obtuve ' + JSON.stringify(real));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. Sin historial (proyecto recién desplegado)');
{
  const c = reset();
  eq('generación arranca en "0"', c.cotGeneracion_(), '0');
  eq('listaAsesor = base', c.cotTtl_(180), 180);
  eq('busqueda = base', c.cotTtl_(90), 90);
  eq('metricas = base', c.cotTtl_(600), 600);
}

console.log('\n2. Formato viejo de la propiedad ("12", sin barras) — sin migración');
{
  const c = reset('12');
  eq('generación se lee igual', c.cotGeneracion_(), '12');
  eq('la clave no cambia de forma', c.cotClave_('dashboard'), 'cot_g12_dashboard');
  eq('TTL sigue en su base', c.cotTtl_(240), 240);
  c.cotInvalidarCache_();
  ok('tras invalidar, la propiedad ya trae los 3 campos', /^13\|\d+\|0$/.test(propiedades.COT_CACHE_GEN),
     propiedades.COT_CACHE_GEN);
}

console.log('\n3. Hora pico: una escritura cada 30 s');
{
  const c0 = reset();
  let c = c0;
  for (let i = 0; i < 12; i++) { c.cotInvalidarCache_(); reloj += 30; c = nuevaEjecucion(); }
  const est = c.cotEstado_();
  ok('el ritmo converge a ~30 s', Math.abs(est.ritmo - 30) <= 2, 'ritmo=' + est.ritmo);
  eq('listaAsesor se acorta al mínimo (0.5×180)', c.cotTtl_(180), 90);
  eq('busqueda se queda en el piso de 60 s', c.cotTtl_(90), 60);
  eq('supervision 0.5×240', c.cotTtl_(240), 120);
  eq('metricas 0.5×600', c.cotTtl_(600), 300);
}

console.log('\n4. Madrugada: mismo ritmo aprendido, pero 8 h sin escribir');
{
  let c = reset();
  for (let i = 0; i < 12; i++) { c.cotInvalidarCache_(); reloj += 30; c = nuevaEjecucion(); }
  reloj += 8 * 3600;
  c = nuevaEjecucion();
  eq('listaAsesor se estira al máximo (6×180)', c.cotTtl_(180), 1080);
  eq('busqueda 6×90', c.cotTtl_(90), 540);
  eq('supervision 6×240', c.cotTtl_(240), 1440);
  eq('metricas 6×600', c.cotTtl_(600), 3600);
}

console.log('\n5. Ritmo intermedio: una escritura cada 10 min');
{
  let c = reset();
  for (let i = 0; i < 15; i++) { c.cotInvalidarCache_(); reloj += 600; c = nuevaEjecucion(); }
  const est = c.cotEstado_();
  ok('ritmo ≈ 600 s', Math.abs(est.ritmo - 600) <= 20, 'ritmo=' + est.ritmo);
  // justo después de escribir: manda el ritmo, no el silencio
  reloj -= 600; c = nuevaEjecucion();
  eq('listaAsesor sigue el ritmo real (600 s)', c.cotTtl_(180), 600);
  eq('busqueda topa en 6×90', c.cotTtl_(90), 540);
  eq('supervision sigue el ritmo', c.cotTtl_(240), 600);
  eq('metricas = su base', c.cotTtl_(600), 600);
}

console.log('\n6. Ráfaga aislada no descarrila el promedio');
{
  let c = reset();
  for (let i = 0; i < 15; i++) { c.cotInvalidarCache_(); reloj += 600; c = nuevaEjecucion(); }
  const antes = c.cotEstado_().ritmo;
  for (let i = 0; i < 3; i++) { c.cotInvalidarCache_(); reloj += 2; c = nuevaEjecucion(); }
  const despues = c.cotEstado_().ritmo;
  ok('tres guardados seguidos bajan el ritmo pero no lo destruyen',
     despues < antes && despues > 100, 'antes=' + antes + ' después=' + despues);
}

console.log('\n7. Límites duros');
{
  let c = reset();
  for (let i = 0; i < 30; i++) { c.cotInvalidarCache_(); reloj += 4000; c = nuevaEjecucion(); }
  reloj += 30 * 24 * 3600;                       // un mes sin tocar nada
  c = nuevaEjecucion();
  ok('nunca supera el tope de CacheService', c.cotTtl_(21600) <= 21600, String(c.cotTtl_(21600)));
  ok('nunca supera 6× la base', c.cotTtl_(180) <= 1080, String(c.cotTtl_(180)));
  let c2 = reset();
  for (let i = 0; i < 20; i++) { c2.cotInvalidarCache_(); reloj += 1; c2 = nuevaEjecucion(); }
  ok('nunca baja del piso de 60 s', c2.cotTtl_(90) >= 60 && c2.cotTtl_(180) >= 60,
     c2.cotTtl_(90) + '/' + c2.cotTtl_(180));
  ok('el ritmo se satura en 6 h', c.cotEstado_().ritmo <= 21600, String(c.cotEstado_().ritmo));
}

console.log('\n8. Propiedad corrupta o servicio caído');
{
  const c = reset('basura|no-fecha|???');
  eq('gen cae a "0" sin lanzar', c.cotGeneracion_(), '0');
  eq('TTL cae a la base', c.cotTtl_(180), 180);
  const c2 = reset('5|9999999999|300');          // ultima en el futuro (reloj torcido)
  eq('silencio negativo no rompe nada', c2.cotTtl_(180), 300);
  c2.cotInvalidarCache_();
  ok('con ultima en el futuro el ritmo no se contamina',
     /^6\|\d+\|300$/.test(propiedades.COT_CACHE_GEN), propiedades.COT_CACHE_GEN);
}

console.log('\n9. La invalidación por escritura sigue mandando');
{
  let c = reset();
  for (let i = 0; i < 12; i++) { c.cotInvalidarCache_(); reloj += 30; c = nuevaEjecucion(); }
  c.cotCacheado_('dashboard', c.COT_TTL.supervision, () => ({ success: true, filas: [1, 2, 3] }));
  const ttlUsado = puestos[puestos.length - 1].ttl;
  eq('cotCacheado_ guarda con el TTL modulado, no con el base', ttlUsado, 120);
  ok('el dato se sirve de caché', JSON.stringify(c.cotCacheado_('dashboard', 240, () => ({ success: true, filas: [] })))
     === JSON.stringify({ success: true, filas: [1, 2, 3] }));
  c.cotInvalidarCache_();
  const c3 = nuevaEjecucion();
  eq('tras escribir, la lectura vuelve a la hoja', c3.cotCacheado_('dashboard', 240, () => ({ success: true, filas: ['fresco'] })).filas[0], 'fresco');
}

console.log('\n10. cotCachePut_ directo conserva su TTL exacto (diagnósticos, página externa)');
{
  let c = reset();
  for (let i = 0; i < 12; i++) { c.cotInvalidarCache_(); reloj += 30; c = nuevaEjecucion(); }
  puestos = [];
  c.cotCachePut_('rev-pagina-x', { html: 'x' }, 1800);
  eq('el TTL pasado se respeta tal cual', puestos[0].ttl, 1800);
}

console.log('\n11. Troceado de valores grandes con TTL adaptativo');
{
  let c = reset();
  for (let i = 0; i < 12; i++) { c.cotInvalidarCache_(); reloj += 4000; c = nuevaEjecucion(); }
  puestos = [];
  const grande = { success: true, filas: new Array(20000).fill('cotización de prueba áéíóú') };
  c.cotCacheado_('supervision', c.COT_TTL.supervision, () => grande);
  ok('se guardó troceado', puestos.length > 1, 'puts=' + puestos.length);
  ok('todos los trozos comparten el mismo TTL modulado',
     new Set(puestos.map(p => p.ttl)).size === 1 && puestos[0].ttl === c.cotTtl_(240),
     JSON.stringify(puestos.map(p => p.ttl).slice(0, 3)));
  const leido = c.cotCacheGet_('supervision');
  ok('se relee entero e idéntico', leido && leido.filas.length === 20000);
}

console.log('\n12. cotCacheDiagnostico');
{
  let c = reset();
  for (let i = 0; i < 12; i++) { c.cotInvalidarCache_(); reloj += 30; c = nuevaEjecucion(); }
  const r = c.cotCacheDiagnostico();
  ok('reporta ok', r.ok === true);
  ok('la generación cambia', r.generacionAntes !== r.generacionDespues);
  ok('reporta el ritmo', typeof r.ritmo === 'number' && r.ritmo > 0, String(r.ritmo));
  eq('marca remitente como fijo', r.ttl.remitente.efectivo, 21600);
  ok('remitente viene marcado', r.ttl.remitente.fijo === true);
  ok('supervision viene modulado', r.ttl.supervision.efectivo === 120 && r.ttl.supervision.fijo === false,
     JSON.stringify(r.ttl.supervision));
}

console.log('\n─────────────────────────────────────────────');
console.log(fallos === 0 ? `TODO OK · ${pruebas} comprobaciones` : `${fallos} FALLOS de ${pruebas}`);
process.exit(fallos === 0 ? 0 : 1);
