/*
 * Pruebas de la llave de sesión (Sesiones.gs + secIdentidad_ en Seguridad.gs).
 *   Ejecutar:  node pruebas/sesiones.test.js
 *
 * Se cargan los archivos REALES en un contexto con stubs de PropertiesService, CacheService,
 * Utilities, Session y un reloj que avanzamos a mano. Cada «llamada» simula una ejecución nueva
 * de Apps Script: SEC_SESION_ y SEC_ENTRADA_ vuelven a null, como en producción.
 * Esta carpeta queda fuera de "Carpeta del proyecto": clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..', 'Carpeta del proyecto');
let fallos = 0, total = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) console.log('  ✔ ' + nombre);
  else { fallos++; console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function lanza(fn) { try { fn(); return null; } catch (e) { return String(e && e.message || e); } }

const MIN = 60000;
let reloj = Date.UTC(2026, 8, 24, 15, 0, 0);
let props = {}, cache = {}, escrituras = 0;
let activa = 'ana.asesora@liverpool.com.mx', efectiva = 'dueno@liverpool.com.mx';

function contexto() {
  const RelojDate = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(reloj); }
    static now() { return reloj; }
  };
  const ctx = {
    console, Math, JSON, String, Number, Object, Array, RegExp, parseInt, parseFloat, isNaN, Error,
    Function, Date: RelojDate,
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { escrituras++; props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
      getProperties: () => Object.assign({}, props)
    }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => (k in cache ? cache[k] : null),
      put: (k, v) => { cache[k] = v; },
      remove: (k) => { delete cache[k]; }
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, texto) => Array.from(crypto.createHash('sha256').update(String(texto), 'utf8').digest())
        .map((b) => (b > 127 ? b - 256 : b))
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => activa }),
      getEffectiveUser: () => ({ getEmail: () => efectiva })
    }
  };
  vm.createContext(ctx);
  ['Seguridad.gs', 'Sesiones.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f }));
  // La hoja "Registros", simulada. Sin Permisos.gs, la identidad cae al modelo de la columna Avanzado.
  vm.runInContext(`
    var REGISTROS_PRUEBA = {
      'ana.asesora@liverpool.com.mx': { nombre: 'Ana', avanzado: false },
      'maestro@liverpool.com.mx': { nombre: 'Maestro', avanzado: true },
      'dueno@liverpool.com.mx': { nombre: 'Dueño', avanzado: true }
    };
    function secIndiceRegistros_() { return REGISTROS_PRUEBA; }
    function pruebaQuienSoy(correo) { return secIdentidad_(correo); }
    function pruebaLlamaHerramienta() { return cuentasLimpiarTodo(); }
    function cuentasLimpiarTodo() { secSoloInterno_('cuentasLimpiarTodo'); return 'borrado'; }
  `, ctx);
  return ctx;
}
const C = contexto();
/** Una ejecución nueva de Apps Script: los globales de la ejecución anterior no existen. */
function ejecucion(fn) { vm.runInContext('SEC_SESION_ = null; SEC_ENTRADA_ = null;', C); return fn(); }
const llamar = (llave, nombre, args, actividad) => ejecucion(() => C.secEjecutar(llave, nombre, args || [], actividad));

/* ── 1 · Abrir sesión ─────────────────────────────────────────────────── */
console.log('\n1 · Abrir sesión');
const s1 = ejecucion(() => C.sesParaCliente_('Ana.Asesora@liverpool.com.mx'));
ok('la llave tiene el formato esperado', /^vs1\.[0-9a-f]{64}$/.test(s1.llave), s1.llave);
ok('el servidor informa la inactividad (120 min)', s1.inactividadMin === 120, s1);
const claves = Object.keys(props).filter((k) => k.indexOf('ses_') === 0);
ok('se guarda UNA sesión con prefijo ses_', claves.length === 1, claves);
ok('en el almacén NO está la llave en claro', !JSON.stringify(props).includes(s1.llave.slice(4)));
const reg = JSON.parse(props[claves[0]]);
ok('el registro son solo números y el correo normalizado', reg.e === 'ana.asesora@liverpool.com.mx' && typeof reg.u === 'number' && typeof reg.i === 'number', reg);

/* ── 2 · Quién llama ──────────────────────────────────────────────────── */
console.log('\n2 · Con llave, sin llave, llave ajena');
let r = llamar(s1.llave, 'pruebaQuienSoy', ['ana.asesora@liverpool.com.mx'], reloj);
ok('llave + su propio correo → identificada por la sesión', r.ok && r.email === 'ana.asesora@liverpool.com.mx' && r.origen === 'sesion', r);
r = llamar(s1.llave, 'pruebaQuienSoy', ['maestro@liverpool.com.mx'], reloj);
ok('llave de Ana + correo del maestro → RECHAZADA (ya no se puede suplantar)', !r.ok && /otra cuenta/.test(r.error), r);
r = llamar(s1.llave, 'pruebaQuienSoy', [''], reloj);
ok('llave sin correo declarado → es quien dice la llave', r.ok && r.email === 'ana.asesora@liverpool.com.mx', r);
r = ejecucion(() => C.pruebaQuienSoy('maestro@liverpool.com.mx'));
ok('sin llave, en la webapp, declarando al maestro → RECHAZADA', !r.ok && /sesión no es válida/.test(r.error), r);
r = llamar('', 'pruebaQuienSoy', ['maestro@liverpool.com.mx'], reloj);
ok('lo mismo entrando por el canal sin llave → RECHAZADA', !r.ok, r);
r = llamar('', 'pruebaQuienSoy', [''], reloj);
ok('visitante anónimo → {ok:false} sin lanzar (las páginas públicas siguen)', r && r.ok === false, r);
activa = efectiva;   // ahora "es el editor": la cuenta activa es la del dueño
r = ejecucion(() => C.pruebaQuienSoy('maestro@liverpool.com.mx'));
ok('sin llave, desde el EDITOR → lógica de siempre (diagnósticos siguen)', r.ok && r.email === 'maestro@liverpool.com.mx', r);
r = llamar(s1.llave, 'pruebaQuienSoy', ['maestro@liverpool.com.mx'], reloj);
ok('con llave, la sesión manda AUNQUE sea la cuenta del dueño (prueba de roles)', !r.ok && /otra cuenta/.test(r.error), r);
activa = 'ana.asesora@liverpool.com.mx';

/* ── 3 · Inactividad ──────────────────────────────────────────────────── */
console.log('\n3 · Inactividad de 2 horas');
const inicio = reloj;
escrituras = 0;
reloj = inicio + 2 * MIN;
llamar(s1.llave, 'pruebaQuienSoy', [''], reloj);
ok('dentro de 5 min no se reescribe la actividad (ahorra escrituras)', escrituras === 0, escrituras);
reloj = inicio + 119 * MIN;
r = llamar(s1.llave, 'pruebaQuienSoy', [''], inicio + 2 * MIN);
ok('a 1 h 59 sin tocar nada → sigue vigente', r.ok, r);
reloj = inicio + 119 * MIN + 30000;
ok('…y a 1 h 59.5 también (la última actividad informada fue a los 2 min)', llamar(s1.llave, 'pruebaQuienSoy', [''], inicio + 2 * MIN).ok);
reloj = inicio + 123 * MIN;
let err = lanza(() => llamar(s1.llave, 'pruebaQuienSoy', [''], inicio + 2 * MIN));
ok('a 2 h 01 de la última actividad → SESION_EXPIRADA', /^SESION_EXPIRADA/.test(err || ''), err);
ok('…y la sesión se borró del almacén', Object.keys(props).filter((k) => k.indexOf('ses_') === 0).length === 0);

// Una sesión nueva para probar la actividad que informa el navegador.
reloj = inicio + 200 * MIN;
const s2 = ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx'));
const t2 = reloj;
escrituras = 0;
reloj = t2 + 110 * MIN;
r = llamar(s2.llave, 'pruebaQuienSoy', [''], t2 + 108 * MIN);
ok('la persona tocó la pantalla hace 2 min (sin llamar al servidor) → vigente', r.ok, r);
ok('…y se renueva en el servidor (hubo escritura)', escrituras === 1, escrituras);
reloj = t2 + 108 * MIN + 125 * MIN;
err = lanza(() => llamar(s2.llave, 'pruebaQuienSoy', [''], t2 + 108 * MIN));
ok('consulta automática de fondo con la persona ausente 2 h 05 → SESION_EXPIRADA', /^SESION_EXPIRADA/.test(err || ''), err);

reloj = inicio + 400 * MIN;
const s3 = ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx'));
r = llamar(s3.llave, 'pruebaQuienSoy', [''], reloj + 10 * 3600 * 1000);
ok('una actividad «del futuro» se guarda acotada al reloj del servidor',r.ok && JSON.parse(props[Object.keys(props).find((k) => k.indexOf('ses_') === 0)]).u <= reloj);

/* ── 4 · Cerrar sesión, llaves falsas, baja de la cuenta ──────────────── */
console.log('\n4 · Cerrar sesión y llaves que no valen');
ok('sesCerrar responde bien', ejecucion(() => C.sesCerrar(s3.llave)).success === true);
err = lanza(() => llamar(s3.llave, 'pruebaQuienSoy', [''], reloj));
ok('tras cerrar sesión la llave ya no sirve', /^SESION_EXPIRADA/.test(err || ''), err);
err = lanza(() => llamar('vs1.' + 'a'.repeat(64), 'pruebaQuienSoy', [''], reloj));
ok('una llave inventada → SESION_EXPIRADA', /^SESION_EXPIRADA/.test(err || ''), err);
err = lanza(() => llamar('cualquier-cosa', 'pruebaQuienSoy', [''], reloj));
ok('una llave con otro formato → SESION_EXPIRADA', /^SESION_EXPIRADA/.test(err || ''), err);
const s4 = ejecucion(() => C.sesParaCliente_('maestro@liverpool.com.mx'));
vm.runInContext("delete REGISTROS_PRUEBA['maestro@liverpool.com.mx'];", C);
r = llamar(s4.llave, 'pruebaQuienSoy', [''], reloj);
ok('si la cuenta se borró de Registros, la llave ya no da identidad', !r.ok && /ya no está dado de alta/.test(r.error), r);

/* ── 5 · El canal no ejecuta cualquier cosa ───────────────────────────── */
console.log('\n5 · Qué acepta el canal');
const s5 = ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx'));
['eval', 'Function', 'parseInt', 'secIdentidad_', 'sesCrear_', 'cuentasLimpiarTodo', 'doGet', 'include', 'secEjecutar', 'noExiste', '__proto__', 'constructor']
  .forEach((n) => {
    const e = lanza(() => llamar(s5.llave, n, ['1+1'], reloj));
    ok('rechaza «' + n + '»', /no expone la función/.test(e || ''), e);
  });
ok('acepta una función pública del proyecto', llamar(s5.llave, 'pruebaQuienSoy', [''], reloj).ok === true);

/* ── 6 · Candado de herramientas de editor ────────────────────────────── */
console.log('\n6 · secSoloInterno_');
err = lanza(() => ejecucion(() => C.cuentasLimpiarTodo()));
ok('llamada directa desde el navegador (google.script.run.x) → RECHAZADA', /solo se puede ejecutar desde el editor/.test(err || ''), err);
activa = efectiva;
ok('desde el editor → funciona', ejecucion(() => C.cuentasLimpiarTodo()) === 'borrado');
activa = 'ana.asesora@liverpool.com.mx';
ok('llamada INTERNA desde una función que entró por el canal → funciona', llamar(s5.llave, 'pruebaLlamaHerramienta', [], reloj) === 'borrado');
activa = '';   // en un activador, Google puede no informar la cuenta activa
err = lanza(() => ejecucion(() => C.cuentasLimpiarTodo()));
ok('activador sin cuenta informada y sin marca de entrada → el candado rechaza', /solo se puede ejecutar/.test(err || ''), err);
ok('…y funciona cuando el activador marcó su entrada (SEC_ENTRADA_ = activador)',
   ejecucion(() => { vm.runInContext("SEC_ENTRADA_ = 'activador';", C); return C.cuentasLimpiarTodo(); }) === 'borrado');
activa = 'ana.asesora@liverpool.com.mx';

/* ── 7 · Interruptor de emergencia ────────────────────────────────────── */
console.log('\n7 · AUTH_SESIONES = no');
props.AUTH_SESIONES = 'no';
r = ejecucion(() => C.pruebaQuienSoy('ana.asesora@liverpool.com.mx'));
ok('con el interruptor apagado se vuelve al comportamiento anterior', r.ok && r.email === 'ana.asesora@liverpool.com.mx', r);
delete props.AUTH_SESIONES;

/* ── 8 · Limpieza del almacén ─────────────────────────────────────────── */
console.log('\n8 · Purga de sesiones vencidas');
props = {}; cache = {};
const viejas = [1, 2, 3].map(() => ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx')));
reloj += 130 * MIN;
ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx'));
ok('al abrir una sesión se borran las vencidas (queda solo la nueva)', Object.keys(props).filter((k) => k.indexOf('ses_') === 0).length === 1, Object.keys(props));

/* ── 8b · Tiempo de servidor (F3) ─────────────────────────────────────── */
console.log('\n8b · secEjecutar con medir = 1 (AppRun.medidas)');
const s8 = ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx'));
const medida = ejecucion(() => C.secEjecutar(s8.llave, 'pruebaQuienSoy', [''], reloj, 1));
ok('con medir = 1 la respuesta viaja envuelta: {__srv: 1, v, ms}', medida && medida.__srv === 1 && typeof medida.ms === 'number' && medida.ms >= 0, medida);
ok('…y dentro va la respuesta de siempre', medida.v && medida.v.ok === true && medida.v.email === 'ana.asesora@liverpool.com.mx', medida.v);
const cruda = ejecucion(() => C.secEjecutar(s8.llave, 'pruebaQuienSoy', [''], reloj));
ok('sin medir, la respuesta de siempre (una pantalla abierta antes del despliegue no nota nada)', cruda && cruda.ok === true && !('__srv' in cruda), cruda);
ok('cualquier otro valor de medir tampoco envuelve', !('__srv' in ejecucion(() => C.secEjecutar(s8.llave, 'pruebaQuienSoy', [''], reloj, true))));
err = lanza(() => ejecucion(() => C.secEjecutar('vs1.' + 'b'.repeat(64), 'pruebaQuienSoy', [''], reloj, 1)));
ok('un error sigue llegando como error, no envuelto (SESION_EXPIRADA intacto)', /^SESION_EXPIRADA/.test(err || ''), err);
err = lanza(() => ejecucion(() => C.secEjecutar(s8.llave, 'eval', ['1'], reloj, 1)));
ok('medir no abre el canal a nada nuevo', /no expone la función/.test(err || ''), err);

/* ── 9 · Estático: candados y canal en el código ──────────────────────── */
console.log('\n9 · Revisión del código');
const ses = fs.readFileSync(path.join(RAIZ, 'Sesiones.gs'), 'utf8');
const bloque = ses.slice(ses.indexOf('var SES_NO_EXPUESTAS = {'), ses.indexOf('};', ses.indexOf('var SES_NO_EXPUESTAS = {')));
const restringidas = [...bloque.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*1/g)].map((m) => m[1])
  .filter((n) => !['doGet', 'doPost', 'include', 'secEjecutar'].includes(n));
const fuentes = fs.readdirSync(RAIZ).filter((f) => f.endsWith('.gs')).map((f) => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n');
// El activador diario es la única excepción de forma: acepta su propio triggerUid antes del candado.
const ACTIVADOR = /function promosAutoDisparador\(e\) \{[\s\S]{0,700}?if \(e && e\.triggerUid\) SEC_ENTRADA_ = 'activador';\s*else secSoloInterno_\('promosAutoDisparador'\);/;
const sinCandado = restringidas.filter((n) => (n === 'promosAutoDisparador')
  ? !ACTIVADOR.test(fuentes)
  : !new RegExp('function ' + n.replace(/\$/g, '\\$') + '\\([^)]*\\)\\s*\\{\\s*secSoloInterno_\\(\'' + n + '\'\\);').test(fuentes));
ok('las ' + restringidas.length + ' funciones restringidas empiezan con secSoloInterno_', sinCandado.length === 0, sinCandado);
const core = fs.readFileSync(path.join(RAIZ, 'app_core.html'), 'utf8');
ok('AppRun manda todo por secEjecutar con llave, actividad y medir = 1', /runner\.secEjecutar\(AppSession\.llave \|\| '', fnName, args, AppSession\.ultimaActividad\(\), 1\)/.test(core));
ok('isLoggedIn exige la llave', /isLoggedIn: function \(\) \{ return !!this\.userEmail && !!this\.llave; \}/.test(core));
const code = fs.readFileSync(path.join(RAIZ, 'Code.gs'), 'utf8');
ok('getQuotesForUser exige sesión con el bloque consultar (V-03)', /function getQuotesForUser[\s\S]{0,700}secIdentidadConBloque_\(correo, 'consultar'\)/.test(code));
ok('loginUser entrega la llave', /llave: sesionNueva\.llave/.test(code));

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
