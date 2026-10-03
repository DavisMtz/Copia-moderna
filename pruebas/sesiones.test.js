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
// Lecturas del almacén ENTERO (getProperties): es lo caro del barrido de sesiones (sección 8).
let lecturasTodas = 0, cacheRota = false;
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
      getProperties: () => { lecturasTodas++; return Object.assign({}, props); }
    }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => { if (cacheRota) throw new Error('caché caída'); return (k in cache ? cache[k] : null); },
      put: (k, v) => { if (cacheRota) throw new Error('caché caída'); cache[k] = v; },
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
/* Desde el 03/10/2026 el barrido NO corre al abrir sesión: leía el almacén entero y borraba de una
   en una dentro del login, que tiene ~5 s para cambiar de pantalla. Lo hace secEjecutarLote (el
   viaje de fondo), como mucho cada 30 min y con tope de borrados. La caché de mentira no caduca
   sola: «pasaron 30 min» se simula quitando la marca. */
console.log('\n8 · Purga de sesiones vencidas (en el viaje de fondo, no en el login)');
props = {}; cache = {}; lecturasTodas = 0;
const sesionesGuardadas = () => Object.keys(props).filter((k) => k.indexOf('ses_') === 0);
const pasaMediaHora = () => { delete cache.sesPurgaReciente; };
[1, 2, 3].forEach(() => ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx')));
reloj += 130 * MIN;
const s8p = ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx'));
ok('abrir sesión YA NO lee el almacén entero ni borra (el login no paga la limpieza)',
  lecturasTodas === 0 && sesionesGuardadas().length === 4, { lecturasTodas, n: sesionesGuardadas().length });
let rp = ejecucion(() => C.secEjecutarLote(s8p.llave, [['pruebaQuienSoy', ['']]], reloj));
ok('el viaje de fondo barre las vencidas (queda solo la vigente)', sesionesGuardadas().length === 1 && lecturasTodas === 1,
  { lecturasTodas, n: sesionesGuardadas().length });
ok('…y contesta lo de siempre', Array.isArray(rp) && rp.length === 1 && rp[0].v && rp[0].v.ok === true, rp);
[1, 2].forEach(() => ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx')));
reloj += 125 * MIN;   // esas dos vencen; la del lote sigue viva por la actividad que informa
ejecucion(() => C.secEjecutarLote(s8p.llave, [['pruebaQuienSoy', ['']]], reloj));
ok('otro viaje dentro de los 30 min no vuelve a barrer', lecturasTodas === 1 && sesionesGuardadas().length === 3,
  { lecturasTodas, n: sesionesGuardadas().length });
pasaMediaHora();
ejecucion(() => C.secEjecutarLote(s8p.llave, [['pruebaQuienSoy', ['']]], reloj));
ok('pasada la media hora, el siguiente viaje barre otra vez', lecturasTodas === 2 && sesionesGuardadas().length === 1,
  { lecturasTodas, n: sesionesGuardadas().length });
for (let i = 0; i < 30; i++) ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx'));
reloj += 125 * MIN;
pasaMediaHora();
ejecucion(() => C.secEjecutarLote(s8p.llave, [['pruebaQuienSoy', ['']]], reloj));
ok('un barrido borra como mucho 25 (quedan 5 de 30 vencidas + la vigente)', sesionesGuardadas().length === 6, sesionesGuardadas().length);
pasaMediaHora();
ejecucion(() => C.secEjecutarLote(s8p.llave, [['pruebaQuienSoy', ['']]], reloj));
ok('…y el siguiente termina el trabajo', sesionesGuardadas().length === 1, sesionesGuardadas().length);
cacheRota = true;
ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx'));
reloj += 125 * MIN;
rp = ejecucion(() => C.secEjecutarLote(s8p.llave, [['pruebaQuienSoy', ['']]], reloj));
cacheRota = false;
ok('con la caché caída se barre igual y el lote contesta', sesionesGuardadas().length === 1 && rp[0].v && rp[0].v.ok === true,
  { n: sesionesGuardadas().length, rp });

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

/* ── 8c · Varias llamadas en una sola ejecución (F3b) ─────────────────── */
console.log('\n8c · secEjecutarLote');
vm.runInContext(`
  var PRUEBA_CORRIDAS = [];
  function pruebaEco(x) { PRUEBA_CORRIDAS.push(x); return { eco: x, entrada: SEC_ENTRADA_ }; }
  function pruebaFalla() { PRUEBA_CORRIDAS.push('falla'); throw new Error('se cayó a propósito'); }
  var __validaciones = 0, __sesValidarOriginal = sesValidar_;
  sesValidar_ = function (llave, actividad) { __validaciones++; return __sesValidarOriginal(llave, actividad); };
`, C);
const corridas = () => vm.runInContext('PRUEBA_CORRIDAS.slice()', C);
const validaciones = () => vm.runInContext('__validaciones', C);
const reiniciarLote = () => vm.runInContext('PRUEBA_CORRIDAS = []; __validaciones = 0;', C);
const lote = (llave, items, actividad) => ejecucion(() => C.secEjecutarLote(llave, items, actividad));
const s8c = ejecucion(() => C.sesParaCliente_('ana.asesora@liverpool.com.mx'));

reiniciarLote();
let rl = lote(s8c.llave, [['pruebaQuienSoy', ['']], ['pruebaEco', ['a']], ['pruebaEco', ['b']]], reloj);
ok('tres llamadas → tres respuestas, en el mismo orden', Array.isArray(rl) && rl.length === 3 &&
  rl[0].v.email === 'ana.asesora@liverpool.com.mx' && rl[1].v.eco === 'a' && rl[2].v.eco === 'b', rl);
ok('cada una con su tiempo de servidor', rl.every((x) => typeof x.ms === 'number' && x.ms >= 0), rl);
ok('la sesión se valida UNA vez para todo el lote', validaciones() === 1, validaciones());
ok('dentro del lote se entra como por secEjecutar (los candados internos no cambian)', rl[1].v.entrada === 'secEjecutar', rl[1].v);

reiniciarLote();
rl = lote(s8c.llave, [['pruebaEco', ['antes']], ['pruebaFalla', []], ['pruebaEco', ['después']]], reloj);
ok('una que falla lleva { e } y no tumba a las demás', rl[1].e === 'se cayó a propósito' && !('v' in rl[1]) &&
  rl[0].v.eco === 'antes' && rl[2].v.eco === 'después', rl);
ok('…y todas corrieron, en orden', JSON.stringify(corridas()) === JSON.stringify(['antes', 'falla', 'después']), corridas());

reiniciarLote();
const vetadas = ['eval', 'secEjecutar', 'secEjecutarLote', 'cuentasLimpiarTodo', 'sesCrear_', 'doGet', 'noExiste', 'constructor'];
rl = lote(s8c.llave, vetadas.map((n) => [n, ['1']]).slice(0, 7).concat([['pruebaEco', ['sí']]]), reloj);
ok('el lote no abre nada que el canal no abra: ' + vetadas.slice(0, 7).join(', ') + ' → { e }',
  rl.slice(0, 7).every((x) => /no expone la función/.test(x.e || '')), rl.slice(0, 7));
ok('…ninguna de ellas corrió, y la permitida del mismo lote sí', rl[7].v && rl[7].v.eco === 'sí' && JSON.stringify(corridas()) === '["sí"]', corridas());
ok('una llamada interna a una herramienta restringida pasa igual que por secEjecutar',
  lote(s8c.llave, [['pruebaLlamaHerramienta', []]], reloj)[0].v === 'borrado');
rl = lote(s8c.llave, [['pruebaQuienSoy', ['maestro@liverpool.com.mx']], ['pruebaQuienSoy', ['']]], reloj);
ok('la sesión manda en todo el lote: declarar a otro sigue rechazado', !rl[0].v.ok && /otra cuenta/.test(rl[0].v.error) && rl[1].v.ok, rl);

reiniciarLote();
err = lanza(() => lote('vs1.' + 'c'.repeat(64), [['pruebaEco', ['x']], ['pruebaEco', ['y']]], reloj));
ok('llave que no vale → SESION_EXPIRADA para el lote entero', /^SESION_EXPIRADA/.test(err || ''), err);
ok('…sin correr ninguna', corridas().length === 0, corridas());
rl = lote('', [['pruebaQuienSoy', ['']], ['pruebaEco', ['anónimo']]], reloj);
ok('sin llave (páginas públicas) corre como visitante anónimo', rl[0].v && rl[0].v.ok === false && rl[1].v.eco === 'anónimo', rl);

[[], null, 'pruebaEco', new Array(vm.runInContext('SES_LOTE_MAX', C) + 1).fill(['pruebaEco', ['z']])].forEach((malo, i) => {
  const e = lanza(() => lote(s8c.llave, malo, reloj));
  ok('lote no válido #' + (i + 1) + ' (vacío, nulo, texto, demasiado largo) → error, nada corre', /no válido/.test(e || ''), e);
});

/* ── 9 · Estático: candados y canal en el código ──────────────────────── */
console.log('\n9 · Revisión del código');
const ses = fs.readFileSync(path.join(RAIZ, 'Sesiones.gs'), 'utf8');
const bloque = ses.slice(ses.indexOf('var SES_NO_EXPUESTAS = {'), ses.indexOf('};', ses.indexOf('var SES_NO_EXPUESTAS = {')));
// Las puertas del canal no llevan candado (se llaman desde el navegador), pero tampoco pueden ir
// DENTRO de una llamada: por eso están en la lista.
const restringidas = [...bloque.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*1/g)].map((m) => m[1])
  .filter((n) => !['doGet', 'doPost', 'include', 'secEjecutar', 'secEjecutarLote'].includes(n));
const fuentes = fs.readdirSync(RAIZ).filter((f) => f.endsWith('.gs')).map((f) => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n');
// El activador diario es la única excepción de forma: acepta su propio triggerUid antes del candado.
const ACTIVADOR = /function promosAutoDisparador\(e\) \{[\s\S]{0,700}?if \(e && e\.triggerUid\) SEC_ENTRADA_ = 'activador';\s*else secSoloInterno_\('promosAutoDisparador'\);/;
const sinCandado = restringidas.filter((n) => (n === 'promosAutoDisparador')
  ? !ACTIVADOR.test(fuentes)
  : !new RegExp('function ' + n.replace(/\$/g, '\\$') + '\\([^)]*\\)\\s*\\{\\s*secSoloInterno_\\(\'' + n + '\'\\);').test(fuentes));
ok('las ' + restringidas.length + ' funciones restringidas empiezan con secSoloInterno_', sinCandado.length === 0, sinCandado);
const core = fs.readFileSync(path.join(RAIZ, 'app_core.html'), 'utf8');
ok('AppRun manda todo por secEjecutar con llave, actividad y medir = 1', /runner\.secEjecutar\(AppSession\.llave \|\| '', fnName, args, AppSession\.ultimaActividad\(\), 1\)/.test(core));
ok('…y los lotes por secEjecutarLote, también con llave y actividad (F3b)',
  /runner\.secEjecutarLote\(AppSession\.llave \|\| '',\s*lote\.map\([\s\S]{0,120}?\), AppSession\.ultimaActividad\(\)\)/.test(core));
ok('isLoggedIn exige la llave', /isLoggedIn: function \(\) \{ return !!this\.userEmail && !!this\.llave; \}/.test(core));
// El runner falso de la suite F3 no valida el tope: si el cliente armara lotes más largos que los
// que acepta el servidor, este rechazaría lotes ENTEROS y ninguna otra prueba lo vería.
const loteCliente = Number((core.match(/\bLOTE_MAX = (\d+)/) || [])[1]);
const loteServidor = Number((ses.match(/var SES_LOTE_MAX = (\d+)/) || [])[1]);
ok('el cliente nunca arma lotes más largos de los que acepta el servidor (LOTE_MAX ≤ SES_LOTE_MAX)',
  loteCliente > 0 && loteServidor > 0 && loteCliente <= loteServidor, { loteCliente, loteServidor });
const code = fs.readFileSync(path.join(RAIZ, 'Code.gs'), 'utf8');
ok('getQuotesForUser exige sesión con el bloque consultar (V-03)', /function getQuotesForUser[\s\S]{0,700}secIdentidadConBloque_\(correo, 'consultar'\)/.test(code));
ok('loginUser entrega la llave', /llave: sesionNueva\.llave/.test(code));

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
