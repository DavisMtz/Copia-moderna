/**
 * =================================================================================================
 * SESIONES — la llave que prueba quién llama | Sistema de cotizaciones Ventel
 * =================================================================================================
 * EL PROBLEMA QUE RESUELVE
 *
 * El Portal identifica a la persona por su correo y contraseña del PORTAL, no por la cuenta de
 * Google del navegador (ver Seguridad.gs). Hasta ahora, después del login, el navegador le decía
 * al servidor en cada llamada «soy fulano@…» y el servidor se lo creía: solo comprobaba que ese
 * correo existiera. Cualquiera con conocimientos técnicos podía escribir otro correo en su
 * navegador y hacerse pasar por otra persona, incluso por un maestro.
 *
 * CÓMO FUNCIONA AHORA
 *
 *   1. Al iniciar sesión (loginUser, o establecerPasswordInicial tras una contraseña temporal) el
 *      servidor entrega una LLAVE al azar ('vs1.' + 64 hex). Solo viaja esa vez.
 *   2. El navegador la guarda y TODAS sus llamadas pasan por secEjecutar(llave, función, args):
 *      el servidor valida la llave, deja la sesión en SEC_SESION_ para ESTA ejecución y llama a
 *      la función pedida. secIdentidad_ (Seguridad.gs) usa esa sesión: un correo declarado que no
 *      coincide con el de la llave se rechaza.
 *   3. INACTIVIDAD: la sesión vence tras SESION_INACTIVIDAD_MIN minutos (120 por omisión) sin que
 *      la persona toque la pantalla. La actividad la informa el navegador en cada llamada, para
 *      que las consultas automáticas de fondo NO mantengan viva una sesión abandonada.
 *   4. Cerrar sesión borra la llave del servidor (sesCerrar).
 *
 * DÓNDE SE GUARDA: propiedades del script con prefijo 'ses_' y la HUELLA (hash) de la llave, nunca
 * la llave en claro; CacheService como vía rápida. Prefijo propio a propósito: cuentasLimpiarTodo
 * borra el prefijo 'cta_' y no debe cerrar las sesiones.
 *
 * INTERRUPTOR DE EMERGENCIA: la propiedad AUTH_SESIONES = 'no' vuelve al comportamiento anterior
 * (el servidor se fía del correo declarado) sin desplegar nada.
 *
 * QUÉ NO CAMBIA: las funciones del servidor conservan su firma; las pantallas siguen pasando el
 * correo donde siempre. Lo único nuevo en el cliente es el canal (AppRun → secEjecutar).
 */

var SES_PREFIJO = 'ses_';
var SES_INACTIVIDAD_MIN = 120;              // respaldo; manda la propiedad SESION_INACTIVIDAD_MIN
var SES_REFRESCO_MS = 5 * 60 * 1000;        // la última actividad se reescribe como mucho cada 5 min
var SES_CACHE_SEG = 21600;                  // 6 h, el máximo de CacheService
var SES_ERROR_VENCIDA = 'SESION_EXPIRADA: Tu sesión se cerró por inactividad. Vuelve a iniciar sesión.';
var SES_FORMATO = /^vs1\.[0-9a-f]{64}$/;

/** Sesión validada en ESTA ejecución. La fija secEjecutar; cada google.script.run empieza en null. */
var SEC_SESION_ = null;

/**
 * Cómo entró la ejecución: 'secEjecutar' o 'doGet'. Null = llamada directa desde el navegador
 * (google.script.run.x) o ejecución del editor/activador. Lo usa secSoloInterno_.
 */
var SEC_ENTRADA_ = null;

/**
 * Funciones que el canal NO acepta como punto de entrada: herramientas del editor y ayudantes que
 * solo debe usar el propio servidor. Todas llevan además secSoloInterno_ en su primera línea (así
 * tampoco se pueden llamar directo con google.script.run). doGet/include/secEjecutar tampoco.
 */
var SES_NO_EXPUESTAS = {
  doGet: 1, doPost: 1, include: 1, secEjecutar: 1,
  // Herramientas de editor y diagnóstico
  NOMBRAR_MAESTRO: 1, REPARAR_MAESTRO: 1, VER_CORREOS_REGISTRADOS: 1, VER_PERMISOS_GUARDADOS: 1,
  permSembrarMaestro: 1, secGuardarConfiguracion: 1, secFijarModoAuth: 1, cuentasLimpiarTodo: 1,
  cuentasPreviaCorreos: 1, diagLimpiarCache: 1, diagPromos: 1, idcRefrescar: 1, trazInvalidarCache: 1,
  pcRevisarCatalogo: 1, promosRevisarHojas: 1, probarAccesoCcl: 1, probarCarpetaAnuncios: 1,
  revisionMaestra: 1, verificarVersionDelCodigo: 1, getSystemHealth: 1,
  promosAutoCorrerAhora: 1, promosAutoSimular: 1, promosAutoDisparador: 1,
  atencionesDiagnostico: 1, audDiagnostico: 1, consolaDiagnostico: 1, cotCacheDiagnostico: 1,
  cuentasDiagnostico: 1, difDiagnostico: 1, equipoDiagnostico: 1, grpDiagnostico: 1, idcDiagnostico: 1,
  monDiagnostico: 1, opDiagnostico: 1, permDiagnostico: 1, prefsDiagnostico: 1, revDiagnostico: 1,
  revDiagnosticoFicha: 1, revpolDiagnostico: 1, secDiagnostico: 1, trazDiagnostico: 1,
  // Ayudantes que solo usa el servidor
  saveQuoteDataToSheets: 1, sendWebhookNotification: 1, generateLvpFolio: 1, generateQuotePdfBlob: 1,
  revContarPendientes: 1, getVerifiedImageUrl: 1, getUserEmail: 1, isAdvancedUser: 1,
  getScriptUrl: 1, formatCurrencyGS: 1, registerUser: 1
};

// ── Configuración ───────────────────────────────────────────────────────────

function sesInactividadMs_() {
  const n = parseInt(secConfig_('SESION_INACTIVIDAD_MIN', SES_INACTIVIDAD_MIN), 10);
  return ((n > 0 && n <= 1440) ? n : SES_INACTIVIDAD_MIN) * 60000;
}

/** 'no' en AUTH_SESIONES apaga todo esto y vuelve a fiarse del correo declarado. */
function sesObligatorias_() {
  return String(secConfig_('AUTH_SESIONES', 'si')).trim().toLowerCase() !== 'no';
}

// ── Almacén ─────────────────────────────────────────────────────────────────

function sesClave_(llave) {
  return SES_PREFIJO + secHashContrasena_('sesion:' + String(llave || '')).slice(0, 40);
}

function sesLeer_(clave) {
  let crudo = null;
  try { crudo = CacheService.getScriptCache().get(clave); } catch (e) {}
  if (!crudo) {
    try { crudo = PropertiesService.getScriptProperties().getProperty(clave); } catch (e) {}
    if (crudo) { try { CacheService.getScriptCache().put(clave, crudo, SES_CACHE_SEG); } catch (e) {} }
  }
  if (!crudo) return null;
  try { return JSON.parse(crudo); } catch (e) { return null; }
}

function sesGuardar_(clave, reg) {
  const texto = JSON.stringify(reg);
  PropertiesService.getScriptProperties().setProperty(clave, texto);
  try { CacheService.getScriptCache().put(clave, texto, SES_CACHE_SEG); } catch (e) {}
}

function sesBorrar_(clave) {
  try { PropertiesService.getScriptProperties().deleteProperty(clave); } catch (e) {}
  try { CacheService.getScriptCache().remove(clave); } catch (e) {}
}

/** Borra las sesiones vencidas. Se llama al crear una: así el almacén no crece sin límite. */
function sesPurgar_(ahora) {
  try {
    const props = PropertiesService.getScriptProperties();
    const todas = props.getProperties();
    const limite = sesInactividadMs_();
    Object.keys(todas).forEach(function (k) {
      if (k.indexOf(SES_PREFIJO) !== 0) return;
      let r = null;
      try { r = JSON.parse(todas[k]); } catch (e) {}
      if (!r || !(ahora - Number(r.u || 0) <= limite)) props.deleteProperty(k);
    });
  } catch (e) {
    Logger.log('sesPurgar_: ' + e);
  }
}

// ── Ciclo de vida ───────────────────────────────────────────────────────────

/**
 * Abre una sesión para un correo YA verificado (contraseña o vale). Devuelve la llave en claro:
 * es la única vez que existe fuera del navegador. Solo se guardan números en el registro.
 */
function sesCrear_(email) {
  const correo = secNormalizarCorreo_(email);
  if (!correo) throw new Error('No se puede abrir una sesión sin correo.');
  const llave = 'vs1.' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const ahora = Date.now();
  sesGuardar_(sesClave_(llave), { e: correo, u: ahora, i: ahora });
  sesPurgar_(ahora);
  return llave;
}

/**
 * Valida una llave. Devuelve {email} o null si no existe o venció.
 * @param {string} llave
 * @param {number=} actividad Cuándo tocó la pantalla la persona por última vez (ms), según el
 *        navegador. Se acota a «ahora». Las consultas de fondo mandan la actividad real, así que
 *        no alargan una sesión abandonada.
 */
function sesValidar_(llave, actividad) {
  const texto = String(llave || '');
  if (!SES_FORMATO.test(texto)) return null;
  const clave = sesClave_(texto);
  const reg = sesLeer_(clave);
  if (!reg || !reg.e) return null;

  const ahora = Date.now();
  const guardada = Number(reg.u) || 0;
  const informada = Math.min(Number(actividad) || 0, ahora);
  const ultima = Math.max(guardada, informada);
  if (ahora - ultima > sesInactividadMs_()) {
    sesBorrar_(clave);
    return null;
  }
  // Solo se reescribe si avanzó más de 5 min: validar cuesta una lectura de caché, no una escritura.
  if (ultima - guardada > SES_REFRESCO_MS) {
    reg.u = ultima;
    try { sesGuardar_(clave, reg); } catch (e) { Logger.log('sesValidar_ (refresco): ' + e); }
  }
  return { email: reg.e };
}

/**
 * ¿Es una ejecución del editor o de un activador? En la webapp (executeAs: USER_DEPLOYING) la
 * cuenta efectiva es la del dueño y la activa la del visitante; en el editor y en los activadores
 * son la misma. OJO: si en un equipo compartido quedara abierta la cuenta de Google del dueño, ese
 * equipo pasaría por «editor» — la cuenta del dueño nunca debe quedar abierta en equipos de asesores.
 */
function secContextoEditor_() {
  try {
    const activa = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    const efectiva = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
    return !!activa && activa === efectiva;
  } catch (e) {
    return false;
  }
}

/**
 * Candado de las funciones que NO deben llamarse desde el navegador (herramientas de editor y
 * ayudantes del servidor). Pasa si:
 *   · se ejecuta desde el editor o un activador (secContextoEditor_), o
 *   · la llamó OTRA función del servidor dentro de una ejecución que entró por secEjecutar o doGet
 *     (el canal nunca las acepta como entrada: ver SES_NO_EXPUESTAS).
 * Una llamada directa google.script.run.x() desde la consola del navegador no cumple ninguna.
 */
function secSoloInterno_(nombre) {
  if (SEC_ENTRADA_ || secContextoEditor_()) return;
  throw new Error('La función ' + (nombre || '') + ' solo se puede ejecutar desde el editor de Apps Script.');
}

// ── El canal ────────────────────────────────────────────────────────────────

/** ¿Es una función del proyecto (no de JavaScript, no privada, no restringida)? */
function sesFuncionExpuesta_(nombre) {
  if (!/^[A-Za-z$][\w$]*$/.test(nombre) || /_$/.test(nombre)) return null;
  if (Object.prototype.hasOwnProperty.call(SES_NO_EXPUESTAS, nombre)) return null;
  const global = (typeof globalThis !== 'undefined') ? globalThis : (function () { return this; })();
  const f = global[nombre];
  if (typeof f !== 'function') return null;
  // Las funciones de JavaScript (eval, Function, parseInt…) dicen «[native code]». Solo pasan las
  // escritas en este proyecto: el canal nunca puede convertirse en «ejecuta cualquier cosa».
  let fuente = '';
  try { fuente = Function.prototype.toString.call(f); } catch (e) { return null; }
  if (/\{\s*\[native code\]\s*\}\s*$/.test(fuente)) return null;
  return f;
}

/**
 * Punto de entrada de TODAS las llamadas del navegador (AppRun.call).
 * @param {string} llave     Llave de sesión, o '' si no hay (login, páginas públicas).
 * @param {string} nombre    Función del servidor a ejecutar.
 * @param {Array}  args      Sus argumentos, tal cual.
 * @param {number=} actividad Última interacción de la persona (ms), para la inactividad.
 * @param {number=} medir     1 = devolver también cuánto trabajó el servidor (F3, AppRun.medidas):
 *        { __srv: 1, v: respuesta, ms }. Sin él, la respuesta de siempre: una pantalla abierta
 *        antes de un despliegue sigue recibiendo lo que espera.
 */
function secEjecutar(llave, nombre, args, actividad, medir) {
  const t0 = Date.now();
  const fn = String(nombre || '');
  const f = sesFuncionExpuesta_(fn);
  if (!f) throw new Error('El servidor no expone la función ' + fn + '.');

  SEC_ENTRADA_ = 'secEjecutar';
  SEC_SESION_ = null;
  if (llave) {
    const s = sesValidar_(llave, actividad);
    if (!s) throw new Error(SES_ERROR_VENCIDA);
    SEC_SESION_ = s;
  }
  Logger.log('secEjecutar → ' + fn);
  // Sin try/catch a propósito: un error de la función debe llegar tal cual al withFailureHandler.
  const respuesta = f.apply(null, Array.isArray(args) ? args : []);
  return medir === 1 ? { __srv: 1, v: respuesta, ms: Date.now() - t0 } : respuesta;
}

/** Cierra la sesión en el servidor. Se puede llamar sin sesión: solo borra si la llave es válida. */
function sesCerrar(llave) {
  const texto = String(llave || '');
  if (SES_FORMATO.test(texto)) sesBorrar_(sesClave_(texto));
  return { success: true };
}

/**
 * La llama el navegador cada ~20 min mientras la persona trabaja sin hablar con el servidor
 * (llenando un formulario largo, leyendo): pasa por secEjecutar, que ya renueva la sesión.
 */
function sesTocar() {
  return { success: true, vigente: !!SEC_SESION_ };
}

/** Lo que el login le devuelve al navegador además de sus datos: la llave y la regla de inactividad. */
function sesParaCliente_(correo) {
  return { llave: sesCrear_(correo), inactividadMin: Math.round(sesInactividadMs_() / 60000) };
}
