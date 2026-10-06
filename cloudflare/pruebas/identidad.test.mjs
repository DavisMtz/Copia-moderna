/*
 * Prueba del módulo IDENTIDAD Y CUENTAS (Cuentas.gs, Equipo.gs, Preferencias.gs, Onboarding.gs).
 *   node pruebas/identidad.test.mjs [baseUrl]          (por omisión http://127.0.0.1:8801)
 *
 * No levanta nada: necesita el Worker local corriendo (scripts/dev-aislado.sh identidad 8801 &).
 * Recorre los flujos completos tal como los hacen las pantallas registro, recuperar e inicio de
 * sesión, leyendo los códigos de verificación de la bandeja de salida (correos_salida) de esa
 * misma base local. Para tocar la base usa la API local de wrangler (/cdn-cgi/local/explorer) y, si
 * no está, `wrangler d1 execute` sobre .wrangler/estado-identidad (variable ESTADO para otra).
 *
 * Crea cuentas nuevas con un sufijo único por corrida y las borra al terminar; las preferencias y
 * el onboarding del asesor de prueba quedan restablecidos. Sale con código 1 si algo falla.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'http://127.0.0.1:8801').replace(/\/$/, '');
const ESTADO = process.env.ESTADO || '.wrangler/estado-identidad';
const CLAVE_DEMO = 'VentelDemo2026';
const SAL_RESPALDO = 'vPe/O5s2aG+Bv4cRGCwz+w==';   // HASH_SALT de Code.gs, si la propiedad no está
const T = Date.now().toString(36);                 // sufijo único de esta corrida

// ── Utilidades ─────────────────────────────────────────────────────────────

let pasadas = 0, fallos = 0;
function ok(cond, nombre, detalle) {
  if (cond) { pasadas++; console.log('  ✓ ' + nombre); return true; }
  fallos++;
  console.log('  ✗ ' + nombre + (detalle !== undefined ? '\n      → ' + JSON.stringify(detalle).slice(0, 400) : ''));
  return false;
}
function seccion(t) { console.log('\n■ ' + t); }

async function rpc(cuerpo) {
  const r = await fetch(BASE + '/api/rpc', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(20000)
  });
  return r.json();
}

/** Como AppRun: todo pasa por secEjecutar (llave '' = sin sesión, como registro y recuperar). */
async function llamar(fn, args = [], llave = '') {
  const j = await rpc({ fn: 'secEjecutar', args: [llave, fn, args, Date.now()] });
  if (!j.ok) throw new Error(j.e);
  return j.v;
}

async function entrar(correo, clave = CLAVE_DEMO) {
  const r = await llamar('loginUser', [correo, clave]);
  if (!r || !r.success || !r.llave) throw new Error('No se pudo entrar como ' + correo + ': ' + JSON.stringify(r));
  return r.llave;
}

// ── Acceso directo a la base D1 local ──────────────────────────────────────

let idBase = null;
let conExplorador = true;

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

async function sql(consulta, params = []) {
  if (conExplorador) {
    try {
      if (!idBase) {
        const r = await fetch(BASE + '/cdn-cgi/local/explorer/api/d1/database', { signal: AbortSignal.timeout(5000) });
        const j = await r.json();
        idBase = ((j.result || []).find((x) => x.name === 'DB') || (j.result || [])[0] || {}).uuid;
        if (!idBase) throw new Error('sin base');
      }
      const r = await fetch(BASE + '/cdn-cgi/local/explorer/api/d1/database/' + idBase + '/raw', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: consulta, params }), signal: AbortSignal.timeout(10000)
      });
      const j = await r.json();
      if (!j.success) throw new Error(JSON.stringify(j.errors));
      const res = j.result[0].results || { columns: [], rows: [] };
      return res.rows.map((fila) => Object.fromEntries(res.columns.map((c, i) => [c, fila[i]])));
    } catch (e) {
      if (idBase) throw e;          // el explorador existe pero la consulta falló: es un error de verdad
      conExplorador = false;        // no hay explorador: se usa la línea de comandos de wrangler
    }
  }
  let i = 0;
  const enLinea = consulta.replace(/\?/g, () => literal(params[i++]));
  const salida = execFileSync('npx', ['wrangler', 'd1', 'execute', 'ventel-portal', '--local', '--persist-to', ESTADO,
    '--command', enLinea, '--json'], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const j = JSON.parse(salida);
  return (j[0] && j[0].results) || [];
}

let sal = null;
async function hashContrasena(texto) {
  if (sal === null) {
    const f = await sql("SELECT valor FROM propiedades WHERE clave = 'HASH_SALT'");
    sal = (f[0] && f[0].valor) || SAL_RESPALDO;
  }
  return createHash('sha256').update(String(texto) + sal, 'utf8').digest('hex');
}

/** cuentasClave: cta_<propósito>_<huella del correo>. */
async function claveCuenta(proposito, correo) {
  return 'cta_' + proposito + '_' + (await hashContrasena('huella:' + correo.toLowerCase())).slice(0, 24);
}

/** El código de 6 dígitos del último correo «Tu código…» que recibió ese correo. */
async function ultimoCodigo(correo, asunto) {
  const filas = await sql('SELECT texto FROM correos_salida WHERE para = ? AND asunto = ? ORDER BY id DESC LIMIT 1', [correo, asunto]);
  const m = filas[0] && String(filas[0].texto).match(/^ {4}(\d{6})$/m);
  return m ? m[1] : null;
}

async function ultimoCorreo(correo) {
  const filas = await sql('SELECT asunto, html, texto, tipo, cco FROM correos_salida WHERE para = ? ORDER BY id DESC LIMIT 1', [correo]);
  return filas[0] || null;
}

const otroCodigo = (c) => String((Number(c) + 1) % 1000000).padStart(6, '0');
const ASUNTO_REGISTRO = 'Tu código para crear la cuenta · Ventel';
const ASUNTO_RECUPERAR = 'Tu código para recuperar la contraseña · Ventel';

// ── Las pruebas ────────────────────────────────────────────────────────────

const creadas = [];

async function main() {
  console.log('Identidad y cuentas contra ' + BASE + ' (corrida ' + T + ')');

  // Dominio exigido en las altas (CUENTAS_DOMINIO): se averigua por el mensaje de rechazo.
  seccion('Alta de cuenta con código (solicitarCodigoRegistro / confirmarCodigoRegistro)');
  const sonda = await llamar('solicitarCodigoRegistro', ['Persona Sonda', 'sonda.' + T + '@dominio-ajeno.test', 'abcdef']);
  const mDom = String((sonda && sonda.message) || '').match(/con un correo @(.+)\.$/);
  const dominio = (!sonda.success && mDom) ? mDom[1] : 'dominio-ajeno.test';
  ok(mDom ? (sonda.campo === 'email') : sonda.success === true,
     mDom ? 'dominio exigido: @' + dominio + ' (rechaza otros con campo "email")' : 'sin restricción de dominio', sonda);

  const nuevo = 'nuevo.' + T + '@' + dominio;
  const claveNueva = 'Clave-' + T;
  creadas.push(nuevo);

  let r = await llamar('solicitarCodigoRegistro', ['Al', nuevo, claveNueva]);
  ok(r.success === false && r.campo === 'name' && r.message === 'Escribe tu nombre completo.', 'nombre corto → campo name', r);
  r = await llamar('solicitarCodigoRegistro', ['Ana Prueba', 'no-es-correo', claveNueva]);
  ok(r.success === false && r.campo === 'email' && r.message === 'El correo electrónico no tiene un formato válido.', 'correo inválido → campo email', r);
  r = await llamar('solicitarCodigoRegistro', ['Ana Prueba', nuevo, '123']);
  ok(r.success === false && r.campo === 'password' && r.message === 'La contraseña debe tener al menos 6 caracteres.', 'contraseña corta → campo password', r);

  r = await llamar('solicitarCodigoRegistro', ['Ana Prueba ' + T, nuevo.toUpperCase(), claveNueva]);
  ok(r.success === true && /•/.test(r.correoMascara || '') && r.expiraSegundos === 600 && r.reenvioSegundos === 60 &&
     r.message === 'Te enviamos un código de 6 dígitos a ' + r.correoMascara + '.', 'código enviado (máscara, 600 s, reenvío 60 s)', r);
  r = await llamar('solicitarCodigoRegistro', ['Ana Prueba ' + T, nuevo, claveNueva]);
  ok(r.success === false && r.esperaSegundos > 0 && r.esperaSegundos <= 60 &&
     r.message === 'Ya te enviamos un código hace un momento. Espera ' + r.esperaSegundos + ' segundos para pedir otro.',
     'freno de 60 s entre envíos', r);

  const codigo = await ultimoCodigo(nuevo, ASUNTO_REGISTRO);
  ok(/^\d{6}$/.test(codigo || ''), 'el código está en la bandeja de salida (correos_salida)', codigo);
  const correoCodigo = await ultimoCorreo(nuevo);
  ok(correoCodigo && correoCodigo.tipo === 'cuenta' && correoCodigo.html.includes(codigo) &&
     correoCodigo.html.includes('Sistema de cotizaciones Ventel') && /Vence a las \d\d:\d\d h/.test(correoCodigo.html) &&
     !correoCodigo.asunto.includes(codigo), 'el correo usa la plantilla de Cuentas.gs y el código no va en el asunto');

  r = await llamar('confirmarCodigoRegistro', [nuevo, '12']);
  ok(r.success === false && r.message === 'El código son 6 dígitos.', 'código incompleto (no gasta intento)', r);
  r = await llamar('confirmarCodigoRegistro', [nuevo, otroCodigo(codigo)]);
  ok(r.success === false && r.intentosRestantes === 4 && r.message === 'Código incorrecto. Te quedan 4 intentos.', 'código incorrecto → quedan 4', r);
  r = await llamar('confirmarCodigoRegistro', [nuevo, codigo]);
  ok(r.success === true && r.userEmail === nuevo && r.userName === 'Ana Prueba ' + T && r.message === 'Cuenta verificada y creada.',
     'código correcto → cuenta creada', r);
  const aviso = await ultimoCorreo(nuevo);
  ok(aviso && aviso.asunto === 'Cuenta creada · Sistema de cotizaciones Ventel' && aviso.html.includes('?page=login'),
     'aviso «Cuenta creada» con botón a ?page=login', aviso && aviso.asunto);
  const fila = (await sql('SELECT nombre, avanzado, password_temporal, alta FROM registros WHERE email = ?', [nuevo]))[0];
  ok(fila && fila.nombre === 'Ana Prueba ' + T && fila.avanzado === 0 && fila.password_temporal === 0 && /^\d{4}-\d\d-\d\dT/.test(fila.alta || ''),
     'fila en registros (avanzado 0, temporal 0, alta ISO)', fila);
  r = await llamar('confirmarCodigoRegistro', [nuevo, codigo]);
  ok(r.success === false && r.message === 'No hay ningún código activo para ese correo. Pide uno nuevo.', 'el código es de un solo uso', r);
  r = await llamar('solicitarCodigoRegistro', ['Ana Prueba', nuevo, claveNueva]);
  ok(r.success === false && r.campo === 'email' && r.message === 'Ese correo ya tiene cuenta. Inicia sesión o recupera tu contraseña.',
     'correo ya registrado → campo email', r);
  r = await llamar('loginUser', [nuevo, claveNueva]);
  ok(r.success === true && /^vs1\.[0-9a-f]{64}$/.test(r.llave || '') && r.rol === 'normal', 'la cuenta nueva inicia sesión', r.message);

  seccion('Límite de intentos por código (secuencial y en paralelo)');
  const intentos = 'intentos.' + T + '@' + dominio;
  creadas.push(intentos);
  r = await llamar('solicitarCodigoRegistro', ['Prueba Intentos', intentos, claveNueva]);
  const cInt = await ultimoCodigo(intentos, ASUNTO_REGISTRO);
  const esperados = ['Código incorrecto. Te quedan 4 intentos.', 'Código incorrecto. Te quedan 3 intentos.',
    'Código incorrecto. Te quedan 2 intentos.', 'Código incorrecto. Te queda 1 intento.',
    'Código incorrecto. Se agotaron los intentos: pide un código nuevo.'];
  const vistos = [];
  for (let i = 0; i < 5; i++) vistos.push((await llamar('confirmarCodigoRegistro', [intentos, otroCodigo(cInt)])).message);
  ok(JSON.stringify(vistos) === JSON.stringify(esperados), 'cinco fallos: 4, 3, 2, 1 y «se agotaron»', vistos);
  r = await llamar('confirmarCodigoRegistro', [intentos, cInt]);
  ok(r.success === false && r.message === 'No hay ningún código activo para ese correo. Pide uno nuevo.', 'tras agotarlos, ni el código bueno sirve', r);

  const paralelo = 'paralelo.' + T + '@' + dominio;
  creadas.push(paralelo);
  await llamar('solicitarCodigoRegistro', ['Prueba Paralelo', paralelo, claveNueva]);
  const cPar = await ultimoCodigo(paralelo, ASUNTO_REGISTRO);
  const rafaga = await Promise.all(Array.from({ length: 15 }, () => llamar('confirmarCodigoRegistro', [paralelo, otroCodigo(cPar)])));
  const comparados = rafaga.filter((x) => /^Código incorrecto/.test(x.message)).length;
  ok(comparados <= 5, '15 intentos a la vez: como mucho 5 llegan a compararse (' + comparados + ')', rafaga.map((x) => x.message));
  r = await llamar('confirmarCodigoRegistro', [paralelo, cPar]);
  ok(r.success === false, 'tras la ráfaga el código bueno ya no sirve', r);

  seccion('Tope de 5 códigos por hora');
  const hora = 'hora.' + T + '@' + dominio;
  creadas.push(hora);
  const claveHora = await claveCuenta('registro', hora);
  const envios = [];
  for (let i = 0; i < 6; i++) {
    envios.push(await llamar('solicitarCodigoRegistro', ['Prueba Hora', hora, claveNueva]));
    // Se salta el freno de 60 s moviendo el último envío al pasado (el tope por hora no se toca).
    await sql("UPDATE propiedades SET valor = json_set(valor, '$.ult', 0) WHERE clave = ?", [claveHora]);
  }
  ok(envios.slice(0, 5).every((x) => x.success === true), 'los cinco primeros salen', envios.map((x) => x.message));
  ok(envios[5].success === false && envios[5].message === 'Pediste demasiados códigos en la última hora. Inténtalo más tarde o avisa al equipo del sistema.',
     'el sexto en la hora se rechaza', envios[5]);

  seccion('Recuperación de contraseña (solicitar / confirmar / restablecerContrasena)');
  r = await llamar('solicitarCodigoRecuperacion', ['nadie.' + T + '@' + dominio]);
  ok(r.success === false && r.campo === 'email' && r.message === 'Ese correo no está dado de alta en el sistema. Revisa que esté bien escrito o crea una cuenta.',
     'correo sin cuenta → campo email', r);
  r = await llamar('solicitarCodigoRecuperacion', ['mal']);
  ok(r.success === false && r.campo === 'email' && r.message === 'El correo electrónico no tiene un formato válido.', 'formato inválido', r);
  r = await llamar('solicitarCodigoRecuperacion', [nuevo]);
  ok(r.success === true && r.correoMascara && r.expiraSegundos === 600, 'código de recuperación enviado', r);
  const cRec = await ultimoCodigo(nuevo, ASUNTO_RECUPERAR);
  ok(/^\d{6}$/.test(cRec || ''), 'código de recuperación en la bandeja', cRec);
  r = await llamar('confirmarCodigoRecuperacion', [nuevo, otroCodigo(cRec)]);
  ok(r.success === false && r.intentosRestantes === 4, 'código de recuperación incorrecto → quedan 4', r);
  r = await llamar('confirmarCodigoRecuperacion', [nuevo, cRec]);
  ok(r.success === true && /^[0-9a-f]{40}$/.test(r.vale || '') && r.expiraSegundos === 900 &&
     r.message === 'Código verificado. Ahora elige tu contraseña nueva.', 'código correcto → vale de 40 hex, 900 s', r);
  const vale = r.vale;
  r = await llamar('restablecerContrasena', [nuevo, vale, '123']);
  ok(r.success === false && r.campo === 'password', 'contraseña nueva corta → campo password', r);
  r = await llamar('restablecerContrasena', [nuevo, vale, claveNueva]);
  ok(r.success === false && r.campo === 'password' && r.message === 'Esa ya es tu contraseña actual. Elige una distinta.', 'la misma contraseña se rechaza (el vale sigue vivo)', r);
  const claveRec = 'Recuperada-' + T;
  r = await llamar('restablecerContrasena', [nuevo, vale, claveRec]);
  ok(r.success === true && r.userEmail === nuevo && r.message === 'Tu contraseña se actualizó. Ya puedes iniciar sesión.', 'contraseña restablecida', r);
  const avisoRec = await ultimoCorreo(nuevo);
  ok(avisoRec && avisoRec.asunto === 'Tu contraseña de Ventel cambió', 'aviso «Tu contraseña de Ventel cambió»', avisoRec && avisoRec.asunto);
  r = await llamar('restablecerContrasena', [nuevo, vale, 'Otra-' + T]);
  ok(r.success === false && r.expirado === true && r.message === 'La verificación caducó. Vuelve a pedir un código.', 'el vale se quema al usarse', r);
  r = await llamar('loginUser', [nuevo, claveNueva]);
  ok(r.success === false && r.message === 'Correo o contraseña incorrectos.', 'la contraseña vieja ya no entra', r);
  r = await llamar('loginUser', [nuevo, claveRec]);
  ok(r.success === true && !!r.llave, 'la contraseña nueva entra', r.message);

  // Vale equivocado: se borra el código anterior (freno de 60 s) y se repite el ciclo.
  await sql('DELETE FROM propiedades WHERE clave = ?', [await claveCuenta('recuperacion', nuevo)]);
  await llamar('solicitarCodigoRecuperacion', [nuevo]);
  r = await llamar('confirmarCodigoRecuperacion', [nuevo, await ultimoCodigo(nuevo, ASUNTO_RECUPERAR)]);
  const vale2 = r.vale;
  r = await llamar('restablecerContrasena', [nuevo, 'f'.repeat(40), 'Otra-' + T]);
  ok(r.success === false && r.expirado === true && r.message === 'La verificación no es válida. Vuelve a pedir un código.', 'vale equivocado → no es válida', r);
  r = await llamar('restablecerContrasena', [nuevo, vale2, 'Otra-' + T]);
  ok(r.success === false && r.expirado === true, 'un vale equivocado quema también el bueno', r);

  seccion('Contraseña temporal (loginUser → emitirValeInicial → establecerPasswordInicial)');
  await sql('UPDATE registros SET password_temporal = 1 WHERE email = ?', [nuevo]);
  r = await llamar('loginUser', [nuevo, claveRec]);
  ok(r.success === true && r.debeCambiarPassword === true && /^[0-9a-f]{40}$/.test(r.vale || '') && r.expiraSegundos === 900 &&
     !r.llave && r.userEmail === nuevo && r.message === 'Entraste con una contraseña temporal. Elige la tuya para continuar.',
     'la temporal no abre sesión: devuelve un vale', r);
  const valeIni = r.vale;
  r = await llamar('establecerPasswordInicial', [nuevo, 'a'.repeat(40), 'Definitiva-' + T]);
  ok(r.success === false && r.expirado === true && r.message === 'La verificación no es válida. Vuelve a entrar con la contraseña temporal.', 'vale inicial equivocado', r);
  r = await llamar('establecerPasswordInicial', [nuevo, valeIni, 'Definitiva-' + T]);
  ok(r.success === false && r.expirado === true && r.message === 'Se acabó el tiempo para elegir tu contraseña. Vuelve a entrar con la temporal.', 'el vale quedó quemado', r);
  r = await llamar('loginUser', [nuevo, claveRec]);
  const valeIni2 = r.vale;
  r = await llamar('establecerPasswordInicial', [nuevo, valeIni2, '123']);
  ok(r.success === false && r.campo === 'password', 'contraseña corta → campo password', r);
  r = await llamar('establecerPasswordInicial', [nuevo, valeIni2, claveRec]);
  ok(r.success === false && r.campo === 'password' && r.message === 'Esa es la contraseña temporal. Elige una distinta, solo tuya.', 'no puede repetir la temporal', r);
  const claveDef = 'Definitiva-' + T;
  r = await llamar('establecerPasswordInicial', [nuevo, valeIni2, claveDef]);
  ok(r.success === true && /^vs1\.[0-9a-f]{64}$/.test(r.llave || '') && r.userEmail === nuevo && r.userName === 'Ana Prueba ' + T &&
     r.rol === 'normal' && r.rolNombre === 'Asesor' && r.isMaster === false && r.isAdvanced === false &&
     Array.isArray(r.bloques) && r.bloques.includes('cotizar') && r.inactividadMin > 0 && r.message === 'Listo. Esta es tu contraseña a partir de ahora.',
     'contraseña definitiva → misma respuesta que un login (con llave)', r);
  const llaveDef = r.llave;
  const temp = (await sql('SELECT password_temporal FROM registros WHERE email = ?', [nuevo]))[0];
  ok(temp && temp.password_temporal === 0, 'la marca de temporal se limpia', temp);
  r = await llamar('prefsLeer', [nuevo], llaveDef);
  ok(r.success === true, 'la llave que devolvió sirve para llamar al servidor', r);
  r = await llamar('loginUser', [nuevo, claveDef]);
  ok(r.success === true && !r.debeCambiarPassword && !!r.llave, 'a partir de ahora entra normal', r);

  seccion('Preferencias (prefsLeer / prefsGuardar / prefsRestablecer)');
  r = await llamar('prefsLeer', ['asesor@ventel.example']);
  ok(r.success === false && /sesión/i.test(r.message || ''), 'sin sesión no hay preferencias', r);
  const llaveAsesor = await entrar('asesor@ventel.example');
  r = await llamar('prefsRestablecer', ['asesor@ventel.example'], llaveAsesor);
  ok(r.success === true && r.prefs.tema === 'aurora' && Object.keys(r.sellos).length === 0, 'restablecer → valores de fábrica', r);
  r = await llamar('prefsLeer', ['asesor@ventel.example'], llaveAsesor);
  const v0 = r.version;
  ok(r.success === true && r.prefs.tema === 'aurora' && r.prefs.menuPlegado === false && Array.isArray(r.prefs.fijados) &&
     Array.isArray(r.campos) && r.campos.length === 8 && r.campos[0].clave === 'tema' && r.campos[0].valores.length === 3,
     'prefsLeer: juego completo + catálogo de 8 campos', r);
  const ahora = Date.now();
  r = await llamar('prefsGuardar', ['asesor@ventel.example', { tema: 'carbon', basura: 'x', fijados: ['a', 'a', 'b'], textscale: 'gigante' },
    { tema: ahora, fijados: ahora + 3600000 }], llaveAsesor);
  ok(r.success === true && r.prefs.tema === 'carbon' && JSON.stringify(r.prefs.fijados) === '["a","b"]' && r.prefs.textscale === 'md' &&
     !('basura' in r.prefs) && r.version === v0 + 1 && r.sellos.tema === ahora && r.sellos.fijados <= Date.now(),
     'guardar: lista blanca, sin duplicados, sello futuro acotado, versión +1', r);
  r = await llamar('prefsGuardar', ['asesor@ventel.example', { tema: 'slate' }, { tema: ahora - 60000 }], llaveAsesor);
  ok(r.success === true && r.prefs.tema === 'carbon', 'un cambio con sello más viejo no pisa', r.prefs);
  r = await llamar('prefsGuardar', ['asesor@ventel.example', {}], llaveAsesor);
  ok(r.success === false && r.message === 'No había ninguna preferencia válida que guardar.', 'nada válido → mensaje', r);
  const cambios = [{ densidad: 'compact' }, { textscale: 'xl' }, { contraste: '1' }, { menuPlegado: true }, { inicio: 'cotizacion' }];
  await Promise.all(cambios.map((c) => llamar('prefsGuardar', ['asesor@ventel.example', c, {}], llaveAsesor)));
  r = await llamar('prefsLeer', ['asesor@ventel.example'], llaveAsesor);
  ok(r.prefs.densidad === 'compact' && r.prefs.textscale === 'xl' && r.prefs.contraste === '1' && r.prefs.menuPlegado === true &&
     r.prefs.inicio === 'cotizacion' && r.prefs.tema === 'carbon', 'cinco guardados a la vez no se pisan (fusión por campo)', r.prefs);
  r = await llamar('prefsGuardar', ['supervisora@ventel.example', { tema: 'slate' }], llaveAsesor);
  ok(r.success === false, 'no se pueden guardar preferencias de otra cuenta', r);
  const vAntes = (await llamar('prefsLeer', ['asesor@ventel.example'], llaveAsesor)).version;
  r = await llamar('prefsRestablecer', ['asesor@ventel.example'], llaveAsesor);
  ok(r.success === true && r.prefs.tema === 'aurora' && r.version === vAntes + 1, 'restablecer sube la versión', r);

  seccion('Onboarding (onbEstado / onbMarcar / onbReiniciar)');
  r = await llamar('onbEstado', ['asesor@ventel.example']);
  ok(r.success === false && JSON.stringify(r.vistos) === '{}', 'sin sesión: success false y vistos vacío', r);
  await llamar('onbReiniciar', ['asesor@ventel.example'], llaveAsesor);
  r = await llamar('onbEstado', ['asesor@ventel.example'], llaveAsesor);
  ok(r.success === true && JSON.stringify(r.vistos) === '{}' && r.message === '', 'estado vacío', r);
  r = await llamar('onbMarcar', ['asesor@ventel.example', { pantalla: 'Dashboard!', version: 2, estado: 'omitido', paso: 1, total: 5 }], llaveAsesor);
  ok(r.success === true && r.message === '', 'marcar una pantalla', r);
  await llamar('onbMarcar', ['asesor@ventel.example', { pantalla: 'dashboard', version: 3, estado: 'raro' }], llaveAsesor);
  r = await llamar('onbEstado', ['asesor@ventel.example'], llaveAsesor);
  ok(r.success === true && r.vistos.dashboard === 3 && Object.keys(r.vistos).length === 1, 'la misma pantalla se actualiza, no se duplica', r);
  const onb = (await sql("SELECT estado, paso_final, total_pasos FROM onboarding WHERE correo = 'asesor@ventel.example' AND pantalla = 'dashboard'"))[0];
  ok(onb && onb.estado === 'completado', 'un estado desconocido se guarda como «completado»', onb);
  r = await llamar('onbMarcar', ['asesor@ventel.example', {}], llaveAsesor);
  ok(r.success === false && r.message === 'Falta la pantalla.', 'sin pantalla → «Falta la pantalla.»', r);
  r = await llamar('onbReiniciar', ['asesor@ventel.example', 'dashboard'], llaveAsesor);
  ok(r.success === true && r.borrados === 1, 'reiniciar una pantalla', r);

  seccion('Equipo (equipoPanorama) y puertas');
  r = await llamar('equipoPanorama', ['asesor@ventel.example']);
  ok(r.success === false, 'sin sesión no hay equipo', r);
  r = await llamar('equipoPanorama', ['asesor@ventel.example'], llaveAsesor);
  ok(r.success === false && /Consola/.test(r.message || ''), 'un asesor no ve el equipo', r);
  r = await llamar('equipoGuardarMiembro', ['asesor@ventel.example', { email: 'sofia.herrera@ventel.example', rol: 'maestro' }], llaveAsesor);
  ok(r.success === false, 'un asesor no puede cambiar a nadie', r);
  const llaveSup = await entrar('supervisora@ventel.example');
  r = await llamar('equipoPanorama', ['supervisora@ventel.example'], llaveSup);
  const lista = (r && r.asesores) || [];
  ok(r.success === true && r.movidoA === 'consola' && r.message === '' && r.yo && r.yo.email === 'supervisora@ventel.example' &&
     Array.isArray(lista) && lista.some((m) => m.email === 'asesor@ventel.example') && r.catalogo && Array.isArray(r.catalogo.bloques),
     'supervisora: panorama con asesores y catálogo', r && r.message);
  ok(!lista.some((m) => m.email === 'maestro@ventel.example'), 'la supervisora no ve a quien está por encima de su nivel');
  ok(!JSON.stringify(lista).includes('password'), 'la lista nunca lleva hashes de contraseña');
  r = await llamar('equipoPanorama', ['maestro@ventel.example'], llaveSup);
  ok(r.success === false, 'no se puede pedir el panorama declarando otra cuenta', r);
  const llaveMaestro = await entrar('maestro@ventel.example');
  r = await llamar('equipoPanorama', ['maestro@ventel.example'], llaveMaestro);
  ok(r.success === true && (r.asesores || []).some((m) => m.email === 'maestro@ventel.example'), 'el maestro ve a todos', r && r.message);

  // Las funciones de cuentas se llaman sin sesión (pantallas públicas), pero nunca dan datos de nadie.
  r = await llamar('solicitarCodigoRecuperacion', ['asesor@ventel.example']);
  ok(!JSON.stringify(r).includes('Carlos'), 'la recuperación no revela el nombre de la cuenta');

  seccion('Dada de baja');
  r = await llamar('loginUser', ['paola.jimenez@ventel.example', CLAVE_DEMO]);
  ok(r.success === false && r.message === 'Tu cuenta está dada de baja. Pide al administrador que la reactive.', 'una cuenta inactiva no entra', r);
}

async function limpiar() {
  // Las cuentas creadas, sus sesiones y sus códigos/vales; la bandeja de salida se conserva.
  try {
    for (const correo of creadas) {
      await sql('DELETE FROM registros WHERE email = ?', [correo]);
      await sql('DELETE FROM permisos_sistema WHERE email = ?', [correo]);
      await sql('DELETE FROM sesiones WHERE email = ?', [correo]);
      await sql('DELETE FROM preferencias_usuario WHERE email = ?', [correo]);
      for (const p of ['registro', 'recuperacion', 'vale', 'inicial']) {
        await sql('DELETE FROM propiedades WHERE clave = ?', [await claveCuenta(p, correo)]);
      }
    }
    // El código de recuperación que se pidió para el asesor de prueba (para no dejar el freno puesto).
    await sql('DELETE FROM propiedades WHERE clave = ?', [await claveCuenta('recuperacion', 'asesor@ventel.example')]);
  } catch (e) {
    console.log('(limpieza incompleta: ' + e.message + ')');
  }
}

try {
  await main();
} catch (e) {
  fallos++;
  console.log('\n✗ La prueba se interrumpió: ' + (e && e.stack || e));
} finally {
  await limpiar();
}
console.log('\n' + pasadas + ' comprobaciones correctas, ' + fallos + ' fallidas.');
process.exit(fallos ? 1 : 0);
