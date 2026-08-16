/**
 * =================================================================================================
 * CUENTAS: VERIFICACIÓN POR CÓDIGO Y RECUPERACIÓN DE CONTRASEÑA | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Dos flujos, un solo mecanismo: un código temporal de 6 dígitos enviado al correo.
 *
 *   ALTA (registro)         solicitarCodigoRegistro → [correo con código] → confirmarCodigoRegistro
 *                           La cuenta NO se crea hasta que el código se confirma: así nadie se da
 *                           de alta con un correo que no es suyo (antes bastaba con teclearlo).
 *
 *   RECUPERACIÓN            solicitarCodigoRecuperacion → confirmarCodigoRecuperacion (devuelve un
 *                           vale de un solo uso) → restablecerContrasena (con ese vale).
 *                           El código por sí solo NO cambia la contraseña: el vale separa "probé
 *                           que el correo es mío" de "escribo la contraseña nueva", de modo que el
 *                           código no viaja otra vez ni se queda dando vueltas en el cliente.
 *
 * DÓNDE VIVEN LOS CÓDIGOS
 * En las propiedades del script (no en la hoja): son datos efímeros y no tienen por qué quedar
 * en la BD, donde los vería cualquiera con acceso al archivo de Sheets. Se guarda el HASH del
 * código, no el código en claro. Con seis dígitos el hash no es una barrera criptográfica —
 * quien tenga la sal puede probar el millón de combinaciones— pero sí evita que un código
 * quede a la vista en la pantalla de propiedades, y el acceso al editor ya implicaría acceso
 * total al sistema. Cada registro caduca solo y se purga al emitir el siguiente.
 *
 * FRENOS (todos del lado del servidor, el cliente no puede saltárselos)
 *   · 60 s entre envíos al mismo correo, y como máximo 5 códigos por hora.
 *   · 5 intentos por código; al sexto el código muere y hay que pedir otro.
 *   · El código caduca a los 10 minutos; el vale de cambio de contraseña, a los 15.
 *   · Comparación en tiempo constante (secComparacionSegura_), como en el login.
 *
 * Todas las funciones internas llevan el prefijo cuentas* para no chocar con nada.
 * REGISTROS_SHEET_NAME vive en Code.gs y MAIL_ALIAS en Correos.gs (mismo ámbito global).
 */

// ── Parámetros (todos ajustables por propiedad de script) ────────────────────

/** Dominio corporativo exigido en las altas nuevas. Vaciar la propiedad = sin restricción. */
const CUENTAS_DOMINIO_RESPALDO = 'liverpool.com.mx';

const CUENTAS_CODIGO_MINUTOS   = 10;   // vigencia del código
const CUENTAS_VALE_MINUTOS     = 15;   // vigencia del vale de cambio de contraseña
const CUENTAS_MAX_INTENTOS     = 5;    // intentos de verificación por código
const CUENTAS_REENVIO_SEGUNDOS = 60;   // espera mínima entre dos envíos
const CUENTAS_MAX_POR_HORA     = 5;    // códigos por correo y propósito en una hora
const CUENTAS_PREFIJO          = 'cta_'; // prefijo de las propiedades (para purgarlas)

/**
 * Dominio permitido para altas nuevas ('' si se desactivó).
 * Para quitar la restricción hay que poner la propiedad CUENTAS_DOMINIO en 'ninguno'
 * (o '*'): dejarla vacía no sirve, porque secConfig_ devolvería el respaldo del código.
 */
function cuentasDominioPermitido_() {
  const valor = secNormalizarCorreo_(secConfig_('CUENTAS_DOMINIO', CUENTAS_DOMINIO_RESPALDO)).replace(/^@/, '');
  if (valor === 'ninguno' || valor === '*' || valor === 'todos') return '';
  return valor;
}

// ── Almacén efímero de códigos y vales ───────────────────────────────────────

function cuentasProps_() { return PropertiesService.getScriptProperties(); }

/** Huella corta del correo: la clave de la propiedad no expone la dirección. */
function cuentasHuella_(texto) {
  return secHashContrasena_('huella:' + secNormalizarCorreo_(texto)).slice(0, 24);
}

function cuentasClave_(proposito, correo) {
  return CUENTAS_PREFIJO + proposito + '_' + cuentasHuella_(correo);
}

/** Hash del código/vale. Mismo algoritmo y sal que las contraseñas, con su propio prefijo. */
function cuentasHash_(tipo, valor) {
  return secHashContrasena_(tipo + ':' + String(valor || ''));
}

function cuentasLeer_(clave) {
  try {
    const crudo = cuentasProps_().getProperty(clave);
    return crudo ? JSON.parse(crudo) : null;
  } catch (e) {
    return null;
  }
}

function cuentasGuardar_(clave, obj) {
  cuentasProps_().setProperty(clave, JSON.stringify(obj));
}

function cuentasBorrar_(clave) {
  try { cuentasProps_().deleteProperty(clave); } catch (e) {}
}

/**
 * Borra los códigos y vales caducados. Se llama al emitir uno nuevo: sin esto las
 * propiedades del script irían creciendo con basura que ya no sirve para nada.
 */
function cuentasPurgar_() {
  try {
    const props = cuentasProps_();
    const todas = props.getProperties();
    const ahora = Date.now();
    Object.keys(todas).forEach(function (clave) {
      if (clave.indexOf(CUENTAS_PREFIJO) !== 0) return;
      let reg = null;
      try { reg = JSON.parse(todas[clave]); } catch (e) {}
      // Se conservan una hora de más: el contador de envíos por hora vive en el
      // mismo registro y borrarlo al caducar el código regalaría reintentos.
      if (!reg || !reg.exp || (ahora - reg.exp) > 3600000) props.deleteProperty(clave);
    });
  } catch (e) {
    Logger.log('cuentasPurgar_: ' + e);
  }
}

/** Código de 6 dígitos con entropía de UUID (Math.random por sí solo no basta). */
function cuentasGenerarCodigo_() {
  const semilla = Utilities.getUuid() + ':' + Date.now() + ':' + Math.random();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, semilla);
  let n = 0;
  for (let i = 0; i < 6; i++) n = (n * 256 + (bytes[i] & 0xFF)) % 1000000;
  return ('000000' + n).slice(-6);
}

/** d••••@liverpool.com.mx — para confirmar a dónde fue el código sin publicarlo entero. */
function cuentasEnmascarar_(correo) {
  const c = secNormalizarCorreo_(correo);
  const at = c.indexOf('@');
  if (at < 1) return c;
  const usuario = c.slice(0, at);
  const visible = usuario.slice(0, usuario.length > 3 ? 2 : 1);
  return visible + new Array(Math.max(3, usuario.length - visible.length) + 1).join('•') + c.slice(at);
}

// ── Emisión y verificación ───────────────────────────────────────────────────

/**
 * Genera un código, lo guarda hasheado y lo manda por correo.
 * @param {string} proposito 'registro' | 'recuperacion'
 * @param {string} correo    destinatario ya normalizado
 * @param {Object} datos     carga útil que se recuperará al confirmar (nombre, hash…)
 * @param {Object} textos    { asunto, titulo, intro, cierre }
 */
function cuentasEmitirCodigo_(proposito, correo, datos, textos) {
  const clave = cuentasClave_(proposito, correo);
  const ahora = Date.now();
  const previo = cuentasLeer_(clave);

  // Freno 1: no dos correos seguidos. Evita usar el sistema para bombardear un buzón.
  if (previo && previo.ult && (ahora - previo.ult) < CUENTAS_REENVIO_SEGUNDOS * 1000) {
    const espera = Math.ceil((CUENTAS_REENVIO_SEGUNDOS * 1000 - (ahora - previo.ult)) / 1000);
    return {
      success: false,
      esperaSegundos: espera,
      message: 'Ya te enviamos un código hace un momento. Espera ' + espera + ' segundos para pedir otro.'
    };
  }

  // Freno 2: tope por hora. La ventana arranca con el primer envío y se reinicia sola.
  let envios = 0, ventana = ahora;
  if (previo && previo.ini && (ahora - previo.ini) < 3600000) {
    envios = previo.env || 0;
    ventana = previo.ini;
    if (envios >= CUENTAS_MAX_POR_HORA) {
      return {
        success: false,
        message: 'Pediste demasiados códigos en la última hora. Inténtalo más tarde o avisa al equipo del sistema.'
      };
    }
  }

  const codigo = cuentasGenerarCodigo_();
  const registro = {
    c: cuentasHash_(proposito, codigo),
    exp: ahora + CUENTAS_CODIGO_MINUTOS * 60000,
    int: 0,
    env: envios + 1,
    ini: ventana,
    ult: ahora,
    dat: datos || {}
  };

  cuentasPurgar_();
  cuentasGuardar_(clave, registro);

  try {
    // La caducidad se pasa al correo para poder decir la hora exacta ("vence a las 14:32 h"),
    // que es más claro que "en 10 minutos" cuando el mensaje se lee un rato después.
    cuentasEnviarCodigo_(correo, codigo, Object.assign({ expira: registro.exp }, textos || {}));
  } catch (e) {
    // Si el correo no salió, el código no sirve para nada: se retira para no dejar al
    // asesor esperando un mensaje que nunca va a llegar.
    cuentasBorrar_(clave);
    Logger.log('cuentasEmitirCodigo_ (' + proposito + ') no pudo enviar: ' + e);
    return { success: false, message: 'No pudimos enviar el correo con el código. Inténtalo de nuevo en un minuto.' };
  }

  Logger.log('Código de ' + proposito + ' enviado a ' + correo + ' (envío ' + registro.env + ' de la hora).');
  return {
    success: true,
    message: 'Te enviamos un código de 6 dígitos a ' + cuentasEnmascarar_(correo) + '.',
    correoMascara: cuentasEnmascarar_(correo),
    expiraSegundos: CUENTAS_CODIGO_MINUTOS * 60,
    reenvioSegundos: CUENTAS_REENVIO_SEGUNDOS
  };
}

/**
 * Comprueba un código. NO borra el registro si acierta: eso lo decide quien llama,
 * cuando la operación de verdad (crear la cuenta, emitir el vale) ya salió bien.
 * @return {{ok:boolean, datos:Object, message:string}}
 */
function cuentasVerificarCodigo_(proposito, correo, codigo) {
  const clave = cuentasClave_(proposito, correo);
  const reg = cuentasLeer_(clave);
  const limpio = String(codigo == null ? '' : codigo).replace(/\D/g, '');

  if (!reg || !reg.c) {
    return { ok: false, datos: null, message: 'No hay ningún código activo para ese correo. Pide uno nuevo.' };
  }
  if (Date.now() > reg.exp) {
    cuentasBorrar_(clave);
    return { ok: false, datos: null, message: 'El código caducó. Pide uno nuevo.' };
  }
  if ((reg.int || 0) >= CUENTAS_MAX_INTENTOS) {
    cuentasBorrar_(clave);
    return { ok: false, datos: null, message: 'Demasiados intentos con ese código. Pide uno nuevo.' };
  }
  if (limpio.length !== 6) {
    return { ok: false, datos: null, message: 'El código son 6 dígitos.' };
  }

  if (!secComparacionSegura_(cuentasHash_(proposito, limpio), reg.c)) {
    reg.int = (reg.int || 0) + 1;
    cuentasGuardar_(clave, reg);
    const restantes = CUENTAS_MAX_INTENTOS - reg.int;
    if (restantes <= 0) {
      cuentasBorrar_(clave);
      return { ok: false, datos: null, message: 'Código incorrecto. Se agotaron los intentos: pide un código nuevo.' };
    }
    return {
      ok: false,
      datos: null,
      intentosRestantes: restantes,
      message: 'Código incorrecto. Te ' + (restantes === 1 ? 'queda 1 intento' : 'quedan ' + restantes + ' intentos') + '.'
    };
  }

  return { ok: true, datos: reg.dat || {}, message: '' };
}

// ── Consultas a la hoja "Registros" ──────────────────────────────────────────

/** ¿Ese correo ya tiene cuenta? (lee el índice de Seguridad.gs, no la hoja entera). */
function cuentasCorreoRegistrado_(correo) {
  return secBuscarRegistro_(correo).encontrado;
}

/**
 * Alta real de un usuario. Es el único punto que escribe en "Registros" al crear una
 * cuenta: registerUser (Code.gs) también pasa por aquí.
 * @return {{success:boolean, message:string}}
 */
function cuentasAltaUsuario_(nombre, correo, passwordHash) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return { success: false, message: 'El sistema está ocupado. Inténtalo de nuevo en unos segundos.' };
  }
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTROS_SHEET_NAME);
    if (!sheet) throw new Error("Hoja '" + REGISTROS_SHEET_NAME + "' no encontrada.");

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const iEmail = headers.indexOf('Email');
    if (iEmail === -1) throw new Error("Columna 'Email' no encontrada en '" + REGISTROS_SHEET_NAME + "'.");

    // Se vuelve a comprobar DENTRO del bloqueo: entre la validación y el alta pudo
    // colarse otro registro con el mismo correo.
    const data = sheet.getDataRange().getValues();
    const yaEsta = data.slice(1).some(function (fila) {
      return secNormalizarCorreo_(fila[iEmail]) === correo;
    });
    if (yaEsta) return { success: false, message: 'El correo electrónico ya está registrado.' };

    // Por NOMBRE de columna: si algún día se reordena la hoja, el alta sigue cuadrando.
    const fila = new Array(headers.length).fill('');
    const poner = function (columna, valor) {
      const i = headers.indexOf(columna);
      if (i > -1) fila[i] = valor;
    };
    poner(headers[0], new Date());
    poner('Timestamp', new Date());
    poner('Fecha', new Date());
    poner('Nombre', nombre);
    poner('Email', correo);
    poner('PasswordHash', passwordHash);
    poner('Avanzado', 'No');
    poner('Verificado', 'Sí');            // columnas opcionales: solo si existen
    poner('FechaVerificacion', new Date());

    sheet.appendRow(fila);
    SEC_REGISTROS_CACHE = null;           // el índice en memoria quedó viejo
    // Y el de CacheService, que sobrevive a esta ejecución: sin esto, quien se acaba de dar de
    // alta no existiría para el sistema hasta que caducara la entrada, y su primer intento de
    // entrar sería un "no estás registrado" imposible de explicar.
    if (typeof idcInvalidar_ === 'function') idcInvalidar_();
    Logger.log('Usuario dado de alta: ' + correo);
    return { success: true, message: 'Usuario registrado exitosamente.' };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Escribe el hash nuevo de contraseña. @return {boolean} si encontró la fila. */
function cuentasActualizarPassword_(correo, passwordHash) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    throw new Error('El sistema está ocupado. Inténtalo de nuevo en unos segundos.');
  }
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTROS_SHEET_NAME);
    if (!sheet) throw new Error("Hoja '" + REGISTROS_SHEET_NAME + "' no encontrada.");

    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(String);
    const iEmail = headers.indexOf('Email');
    const iHash = headers.indexOf('PasswordHash');
    if (iEmail === -1 || iHash === -1) {
      throw new Error("Faltan las columnas 'Email' o 'PasswordHash' en '" + REGISTROS_SHEET_NAME + "'.");
    }

    for (let r = 1; r < data.length; r++) {
      if (secNormalizarCorreo_(data[r][iEmail]) !== correo) continue;
      // Solo la celda del hash: el resto de la fila (rol, notas, fórmulas) se respeta.
      sheet.getRange(r + 1, iHash + 1).setValue(passwordHash);
      const iAct = headers.indexOf('PasswordActualizada');
      if (iAct > -1) sheet.getRange(r + 1, iAct + 1).setValue(new Date());
      SEC_REGISTROS_CACHE = null;
      return true;
    }
    return false;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ── CONTRASEÑAS TEMPORALES ───────────────────────────────────────────────────
//
// Cuando la consola da de alta a alguien —o le restablece la contraseña— le pone una
// temporal y se la manda por correo. Esa contraseña ha viajado por un buzón, alguien
// pudo dictarla en voz alta y suele acabar apuntada en un papel: sirve para entrar UNA
// vez, no para ser la contraseña de la persona.
//
// La marca vive en una columna OPCIONAL de "Registros". Se crea sola la primera vez que
// hace falta, y todo lo que la lee tolera que no exista: una hoja vieja se comporta
// exactamente como antes en vez de dejar a nadie fuera.

const CUENTAS_COL_TEMPORAL = 'PasswordTemporal';

/**
 * Índice (0-based) de la columna de la marca. Si `crear` es true y no existe, la añade.
 * @return {number} -1 si no existe y no se pidió crearla.
 */
function cuentasIndiceTemporal_(sheet, crear) {
  const ancho = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, ancho).getValues()[0].map(String);
  let i = headers.indexOf(CUENTAS_COL_TEMPORAL);
  if (i > -1 || !crear) return i;
  sheet.getRange(1, ancho + 1).setValue(CUENTAS_COL_TEMPORAL);
  return ancho;   // la nueva quedó al final, en índice = ancho anterior
}

/**
 * Marca o desmarca que la contraseña de este correo es temporal.
 * Nunca lanza: si falla, lo peor que pasa es que no se pida el cambio.
 * @return {boolean} si se pudo escribir
 */
function cuentasMarcarPasswordTemporal_(correo, esTemporal) {
  const lock = LockService.getScriptLock();
  let conCandado = false;
  try { conCandado = lock.tryLock(10000); } catch (e) {}
  try {
    const objetivo = secNormalizarCorreo_(correo);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTROS_SHEET_NAME);
    if (!sheet) return false;

    // Al desmarcar no se crea la columna: si no existe, no había nada que limpiar.
    const iTemp = cuentasIndiceTemporal_(sheet, esTemporal === true);
    if (iTemp === -1) return false;

    const data = sheet.getDataRange().getValues();
    const iEmail = data[0].map(String).indexOf('Email');
    if (iEmail === -1) return false;

    for (let r = 1; r < data.length; r++) {
      if (secNormalizarCorreo_(data[r][iEmail]) !== objetivo) continue;
      sheet.getRange(r + 1, iTemp + 1).setValue(esTemporal ? 'Sí' : '');
      SEC_REGISTROS_CACHE = null;
      return true;
    }
    return false;
  } catch (e) {
    Logger.log('cuentasMarcarPasswordTemporal_: ' + e);
    return false;
  } finally {
    if (conCandado) { try { lock.releaseLock(); } catch (e) {} }
  }
}

/**
 * ¿La contraseña de este correo es una temporal pendiente de cambiar?
 * Ante cualquier duda responde NO: equivocarse hacia el "sí" dejaría a alguien
 * atrapado en la pantalla de cambio sin motivo.
 */
function cuentasPasswordEsTemporal_(correo) {
  try {
    const objetivo = secNormalizarCorreo_(correo);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTROS_SHEET_NAME);
    if (!sheet) return false;

    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(String);
    const iTemp = headers.indexOf(CUENTAS_COL_TEMPORAL);
    const iEmail = headers.indexOf('Email');
    if (iTemp === -1 || iEmail === -1) return false;   // hoja sin la columna: nada que exigir

    for (let r = 1; r < data.length; r++) {
      if (secNormalizarCorreo_(data[r][iEmail]) !== objetivo) continue;
      return secEsAfirmativo_(data[r][iTemp]);
    }
    return false;
  } catch (e) {
    Logger.log('cuentasPasswordEsTemporal_: ' + e);
    return false;
  }
}

/** Hash actual de la contraseña de un correo ('' si no lo encuentra). */
function cuentasHashActual_(correo) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTROS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return '';
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(String);
    const iEmail = headers.indexOf('Email');
    const iHash = headers.indexOf('PasswordHash');
    if (iEmail === -1 || iHash === -1) return '';
    for (let r = 1; r < data.length; r++) {
      if (secNormalizarCorreo_(data[r][iEmail]) === correo) return String(data[r][iHash] || '').trim();
    }
    return '';
  } catch (e) {
    return '';
  }
}

// =================================================================================================
// ALTA DE CUENTA CON VERIFICACIÓN POR CORREO
// =================================================================================================

/**
 * Paso 1 del alta: valida los datos y manda el código. La cuenta todavía NO existe;
 * el nombre y el hash de la contraseña quedan guardados junto al código y se usan al
 * confirmar. La contraseña en claro nunca se almacena, ni siquiera de forma temporal.
 *
 * @param {string} name     nombre completo
 * @param {string} email    correo del asesor
 * @param {string} password contraseña elegida
 * @return {{success:boolean, message:string, campo:string=, correoMascara:string=,
 *           expiraSegundos:number=, reenvioSegundos:number=, esperaSegundos:number=}}
 */
function solicitarCodigoRegistro(name, email, password) {
  try {
    const nombre = String(name || '').trim();
    const correo = secNormalizarCorreo_(email);
    const clave = String(password == null ? '' : password);

    if (nombre.length < 3) return { success: false, campo: 'name', message: 'Escribe tu nombre completo.' };
    if (!secCorreoValido_(correo)) return { success: false, campo: 'email', message: 'El correo electrónico no tiene un formato válido.' };

    const dominio = cuentasDominioPermitido_();
    if (dominio && correo.slice(-(dominio.length + 1)) !== '@' + dominio) {
      return { success: false, campo: 'email', message: 'Solo se pueden crear cuentas con un correo @' + dominio + '.' };
    }
    if (clave.length < 6) return { success: false, campo: 'password', message: 'La contraseña debe tener al menos 6 caracteres.' };
    if (cuentasCorreoRegistrado_(correo)) {
      return { success: false, campo: 'email', message: 'Ese correo ya tiene cuenta. Inicia sesión o recupera tu contraseña.' };
    }

    return cuentasEmitirCodigo_('registro', correo, { nombre: nombre, hash: secHashContrasena_(clave) }, {
      titulo: 'Confirma tu correo',
      chip: 'Alta de cuenta',
      intro: 'Estás creando tu cuenta en el Sistema de cotizaciones Ventel. Escribe este código para terminar:',
      asunto: 'Tu código para crear la cuenta · Ventel',
      cierre: 'Si no fuiste tú quien pidió crear una cuenta, ignora este mensaje: sin el código no se crea nada.'
    });
  } catch (error) {
    Logger.log('solicitarCodigoRegistro: ' + error.message);
    return { success: false, message: 'No pudimos iniciar tu registro. Inténtalo de nuevo en un minuto.' };
  }
}

/**
 * Paso 2 del alta: comprueba el código y, solo entonces, crea la cuenta.
 * @return {{success:boolean, message:string, userEmail:string=, userName:string=}}
 */
function confirmarCodigoRegistro(email, codigo) {
  try {
    const correo = secNormalizarCorreo_(email);
    if (!secCorreoValido_(correo)) return { success: false, message: 'Correo no válido.' };

    const prueba = cuentasVerificarCodigo_('registro', correo, codigo);
    if (!prueba.ok) return { success: false, message: prueba.message, intentosRestantes: prueba.intentosRestantes };

    const alta = cuentasAltaUsuario_(prueba.datos.nombre, correo, prueba.datos.hash);
    cuentasBorrar_(cuentasClave_('registro', correo));   // de un solo uso, salga bien o mal
    if (!alta.success) return alta;

    try {
      cuentasEnviarAviso_(correo, prueba.datos.nombre, {
        titulo: 'Tu cuenta ya está lista',
        chip: 'Cuenta creada',
        tono: 'ok',
        preheader: 'Ya puedes iniciar sesión en el Sistema de cotizaciones Ventel.',
        intro: 'Se creó tu cuenta en el Sistema de cotizaciones Ventel con este correo. Ya puedes iniciar sesión y empezar a cotizar.',
        asunto: 'Cuenta creada · Sistema de cotizaciones Ventel',
        datos: [['Nombre', prueba.datos.nombre || '']],
        cta: { texto: 'Iniciar sesión', pagina: 'login' },
        alerta: {
          titulo: '¿No reconoces esta cuenta?',
          texto: 'Si no fuiste tú quien se registró con este correo, avisa al equipo del sistema para que la demos de baja.',
          tono: 'warn'
        },
        cierre: 'Guarda tu contraseña en un sitio seguro: nadie del equipo puede verla, solo se puede restablecer.'
      });
    } catch (e) {
      Logger.log('Aviso de alta no enviado (la cuenta sí se creó): ' + e);
    }

    return {
      success: true,
      message: 'Cuenta verificada y creada.',
      userEmail: correo,
      userName: prueba.datos.nombre
    };
  } catch (error) {
    Logger.log('confirmarCodigoRegistro: ' + error.message);
    return { success: false, message: 'No pudimos confirmar tu código. Inténtalo de nuevo en un minuto.' };
  }
}

// =================================================================================================
// RECUPERACIÓN DE CONTRASEÑA
// =================================================================================================

/**
 * Paso 1: manda el código a un correo que SÍ tenga cuenta.
 * Se dice claramente cuando el correo no está dado de alta (decisión tomada para uso
 * interno: el asesor necesita saber que se equivocó de dirección o que nunca se registró).
 */
function solicitarCodigoRecuperacion(email) {
  try {
    const correo = secNormalizarCorreo_(email);
    if (!secCorreoValido_(correo)) {
      return { success: false, campo: 'email', message: 'El correo electrónico no tiene un formato válido.' };
    }

    const reg = secBuscarRegistro_(correo);
    if (!reg.encontrado) {
      return {
        success: false,
        campo: 'email',
        message: 'Ese correo no está dado de alta en el sistema. Revisa que esté bien escrito o crea una cuenta.'
      };
    }

    return cuentasEmitirCodigo_('recuperacion', correo, { nombre: reg.nombre }, {
      titulo: 'Recupera tu contraseña',
      chip: 'Recuperar acceso',
      intro: 'Pediste cambiar la contraseña de tu cuenta en el Sistema de cotizaciones Ventel. Escribe este código para continuar:',
      asunto: 'Tu código para recuperar la contraseña · Ventel',
      cierre: 'Si no fuiste tú, ignora este mensaje: tu contraseña sigue igual mientras nadie use el código.'
    });
  } catch (error) {
    Logger.log('solicitarCodigoRecuperacion: ' + error.message);
    return { success: false, message: 'No pudimos enviarte el código. Inténtalo de nuevo en un minuto.' };
  }
}

/**
 * Paso 2: comprueba el código y entrega un vale de un solo uso para cambiar la
 * contraseña. El código se retira en el acto: a partir de aquí manda el vale.
 * @return {{success:boolean, message:string, vale:string=, expiraSegundos:number=}}
 */
function confirmarCodigoRecuperacion(email, codigo) {
  try {
    const correo = secNormalizarCorreo_(email);
    if (!secCorreoValido_(correo)) return { success: false, message: 'Correo no válido.' };

    const prueba = cuentasVerificarCodigo_('recuperacion', correo, codigo);
    if (!prueba.ok) return { success: false, message: prueba.message, intentosRestantes: prueba.intentosRestantes };

    const vale = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    cuentasGuardar_(cuentasClave_('vale', correo), {
      c: cuentasHash_('vale', vale),
      exp: Date.now() + CUENTAS_VALE_MINUTOS * 60000,
      int: 0,
      env: 1,
      ini: Date.now(),
      ult: Date.now(),
      dat: { nombre: prueba.datos.nombre || '' }
    });
    cuentasBorrar_(cuentasClave_('recuperacion', correo));

    return {
      success: true,
      message: 'Código verificado. Ahora elige tu contraseña nueva.',
      vale: vale,
      expiraSegundos: CUENTAS_VALE_MINUTOS * 60
    };
  } catch (error) {
    Logger.log('confirmarCodigoRecuperacion: ' + error.message);
    return { success: false, message: 'No pudimos verificar tu código. Inténtalo de nuevo en un minuto.' };
  }
}

/**
 * Paso 3: cambia la contraseña. Exige el vale emitido en el paso 2, que se quema al usarse.
 * @param {string} email  correo de la cuenta
 * @param {string} vale   token devuelto por confirmarCodigoRecuperacion
 * @param {string} nueva  contraseña nueva en claro
 */
function restablecerContrasena(email, vale, nueva) {
  try {
    const correo = secNormalizarCorreo_(email);
    const clave = String(nueva == null ? '' : nueva);
    if (!secCorreoValido_(correo)) return { success: false, message: 'Correo no válido.' };
    if (clave.length < 6) return { success: false, campo: 'password', message: 'La contraseña debe tener al menos 6 caracteres.' };

    const claveVale = cuentasClave_('vale', correo);
    const reg = cuentasLeer_(claveVale);
    if (!reg || !reg.c) {
      return { success: false, expirado: true, message: 'La verificación caducó. Vuelve a pedir un código.' };
    }
    if (Date.now() > reg.exp) {
      cuentasBorrar_(claveVale);
      return { success: false, expirado: true, message: 'La verificación caducó. Vuelve a pedir un código.' };
    }
    if (!secComparacionSegura_(cuentasHash_('vale', vale), reg.c)) {
      cuentasBorrar_(claveVale);
      Logger.log('Vale de recuperación inválido para ' + correo);
      return { success: false, expirado: true, message: 'La verificación no es válida. Vuelve a pedir un código.' };
    }

    const hashNuevo = secHashContrasena_(clave);
    if (secComparacionSegura_(hashNuevo, cuentasHashActual_(correo))) {
      return { success: false, campo: 'password', message: 'Esa ya es tu contraseña actual. Elige una distinta.' };
    }

    const cambiada = cuentasActualizarPassword_(correo, hashNuevo);
    cuentasBorrar_(claveVale);
    if (!cambiada) {
      return { success: false, message: 'No encontramos tu cuenta al guardar la contraseña. Avisa al equipo del sistema.' };
    }

    // El bloqueo por intentos fallidos ya no tiene sentido: la contraseña es otra.
    secIntentosLimpiar_(correo);

    try {
      cuentasEnviarAviso_(correo, (reg.dat && reg.dat.nombre) || '', {
        titulo: 'Tu contraseña se actualizó',
        chip: 'Contraseña actualizada',
        tono: 'ok',
        preheader: 'Cambio confirmado. Si no fuiste tú, avisa al equipo del sistema.',
        intro: 'La contraseña de tu cuenta en el Sistema de cotizaciones Ventel acaba de cambiar. Si fuiste tú, no tienes que hacer nada más: entra con la contraseña nueva.',
        asunto: 'Tu contraseña de Ventel cambió',
        cta: { texto: 'Iniciar sesión', pagina: 'login' },
        alerta: {
          titulo: 'Si NO fuiste tú, actúa ahora',
          texto: 'Alguien más pudo entrar a tu correo. Avisa de inmediato al equipo del sistema y cambia también la contraseña de tu cuenta de correo.',
          tono: 'warn'
        }
      });
    } catch (e) {
      Logger.log('Aviso de cambio de contraseña no enviado (la contraseña sí cambió): ' + e);
    }

    // La eligió la persona: deja de ser temporal, si es que lo era.
    cuentasMarcarPasswordTemporal_(correo, false);

    Logger.log('Contraseña restablecida para ' + correo);
    return { success: true, message: 'Tu contraseña se actualizó. Ya puedes iniciar sesión.', userEmail: correo };
  } catch (error) {
    Logger.log('restablecerContrasena: ' + error.message);
    return { success: false, message: 'No pudimos actualizar tu contraseña. Inténtalo de nuevo en un minuto.' };
  }
}

// =================================================================================================
// PRIMERA CONTRASEÑA (tras entrar con una temporal)
// =================================================================================================

/**
 * Cambia la contraseña temporal por la definitiva y ABRE LA SESIÓN.
 *
 * POR QUÉ UN VALE Y NO LA CONTRASEÑA TEMPORAL OTRA VEZ: loginUser comprueba la temporal
 * y, en lugar de devolver la sesión, emite este vale de un solo uso. Así una contraseña
 * temporal NUNCA llega a abrir sesión —ni aunque alguien cierre la pestaña a medias— y
 * la contraseña que viajó por correo no vuelve a viajar por la red.
 *
 * Devuelve exactamente lo mismo que un login correcto, para que la pantalla guarde la
 * sesión y entre sin pedir credenciales de nuevo: obligar a teclear otra vez lo que
 * acaba de escribir sería castigar a quien hizo lo correcto.
 *
 * @param {string} email  correo de la cuenta
 * @param {string} vale   token emitido por loginUser
 * @param {string} nueva  contraseña nueva en claro
 */
function establecerPasswordInicial(email, vale, nueva) {
  try {
    const correo = secNormalizarCorreo_(email);
    const clave = String(nueva == null ? '' : nueva);
    if (!secCorreoValido_(correo)) return { success: false, message: 'Correo no válido.' };
    if (clave.length < 6) {
      return { success: false, campo: 'password', message: 'La contraseña debe tener al menos 6 caracteres.' };
    }

    const claveVale = cuentasClave_('inicial', correo);
    const reg = cuentasLeer_(claveVale);
    if (!reg || !reg.c || Date.now() > reg.exp) {
      cuentasBorrar_(claveVale);
      return { success: false, expirado: true,
               message: 'Se acabó el tiempo para elegir tu contraseña. Vuelve a entrar con la temporal.' };
    }
    if (!secComparacionSegura_(cuentasHash_('vale', vale), reg.c)) {
      cuentasBorrar_(claveVale);
      Logger.log('Vale de primera contraseña inválido para ' + correo);
      return { success: false, expirado: true,
               message: 'La verificación no es válida. Vuelve a entrar con la contraseña temporal.' };
    }

    // Que no repita la temporal: es justo la que hay que dejar de usar.
    const hashNuevo = secHashContrasena_(clave);
    if (secComparacionSegura_(hashNuevo, cuentasHashActual_(correo))) {
      return { success: false, campo: 'password',
               message: 'Esa es la contraseña temporal. Elige una distinta, solo tuya.' };
    }

    if (!cuentasActualizarPassword_(correo, hashNuevo)) {
      return { success: false, message: 'No encontramos tu cuenta al guardar la contraseña. Avisa al equipo del sistema.' };
    }
    cuentasMarcarPasswordTemporal_(correo, false);
    cuentasBorrar_(claveVale);
    secIntentosLimpiar_(correo);

    // Sesión: se resuelve igual que en loginUser, por el mismo camino de permisos.
    const id = secIdentidad_(correo);
    if (!id.ok) {
      return { success: false, message: id.error || 'Tu contraseña se guardó, pero no pudimos abrir la sesión. Inicia sesión de nuevo.' };
    }

    Logger.log('Primera contraseña establecida para ' + correo);
    return {
      success: true,
      message: 'Listo. Esta es tu contraseña a partir de ahora.',
      userName: id.nombre,
      userEmail: id.email,
      isAdvanced: id.avanzado,
      rol: id.rol,
      rolNombre: (typeof PERM_ROLES !== 'undefined' && PERM_ROLES[id.rol]) ? PERM_ROLES[id.rol].nombre : '',
      isMaster: id.maestro === true,
      bloques: id.bloques || []
    };
  } catch (error) {
    Logger.log('establecerPasswordInicial: ' + error.message);
    return { success: false, message: 'No pudimos guardar tu contraseña. Inténtalo de nuevo en un minuto.' };
  }
}

// =================================================================================================
// CORREOS
// =================================================================================================
/**
 * LENGUAJE VISUAL DE LOS CORREOS DE CUENTA
 *
 * Estos correos (código, alta, cambio de contraseña) usan los MISMOS tokens que la app
 * rediseñada: neutros fríos para texto y superficies, y el rosa #E10098 reservado al
 * acento (60/30/10). Antes la plantilla iba por su cuenta con una gama malva (#3d2b36,
 * #8a7480, #f6f4f5) que no existe en ninguna pantalla del sistema: al abrirlos no
 * parecían del mismo producto.
 *
 * REGLAS DE UN CORREO QUE NO SE ROMPE
 *   · Tablas para maquetar y estilos EN LÍNEA: es lo único que respetan a la vez Gmail,
 *     Outlook (motor de Word) y los clientes móviles. Nada de flex, grid ni clases sueltas.
 *   · 600 px de ancho, el estándar que no obliga a hacer zoom en ningún cliente.
 *   · Texto de vista previa (preheader) oculto: es lo que se lee en la bandeja ANTES de
 *     abrir. Sin él, Gmail muestra el primer trozo del cuerpo, que suele ser el saludo.
 *   · El bloque <style> solo añade tema oscuro. Si el cliente lo descarta, el correo se ve
 *     igual de bien con los estilos en línea: mejora progresiva, nunca dependencia.
 *   · El color no es nunca el único portador del mensaje: cada distintivo lleva su texto.
 *   · Todo correo sale con su versión en texto plano, construida con los mismos datos.
 */

/** Paleta del correo. Espejo de los tokens claros de app_theme.html (no inventar colores). */
const CUENTAS_MAIL = {
  bg:        '#EDF1F6',   // lienzo detrás de la tarjeta
  surface:   '#FFFFFF',
  surface2:  '#F7F9FC',   // cajas dentro de la tarjeta
  line:      '#E4E9F0',
  ink:       '#1B2330',
  inkSoft:   '#5C6B7E',
  inkFaint:  '#6B7684',   // más oscuro que --ink-faint de la app: aquí hay texto de 11 px
                          // sobre blanco y con #94A1B2 se quedaba en 3.4:1 (AA pide 4.5:1)
  brand:     '#E10098',
  brandDeep: '#A8006F',
  brandTint: '#FDE7F4',
  ok:        '#15803D',
  okTint:    '#EAF7EF',
  warn:      '#9A5B00',
  warnTint:  '#FDF4E7',
  fuente:    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,Helvetica,sans-serif",
  mono:      "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace",
  logo:      'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Liverpool_logo.svg/1280px-Liverpool_logo.svg.png'
};

/** Cuando es un array, cuentasEnviarCorreo_ captura los correos en vez de enviarlos. */
var CUENTAS_MAIL_CAPTURA = null;

/** Colores de un tono semántico: 'brand' (acción), 'ok' (confirmado), 'warn' (atención). */
function cuentasMailTono_(tono) {
  const M = CUENTAS_MAIL;
  if (tono === 'ok')   return { ink: M.ok,        tint: M.okTint,    marca: '✓' };
  if (tono === 'warn') return { ink: M.warn,      tint: M.warnTint,  marca: '!' };
  return { ink: M.brandDeep, tint: M.brandTint, marca: '•' };
}

/**
 * Fecha y hora legibles para el cuerpo del correo. Formato numérico a propósito:
 * el nombre del mes lo resolvería SimpleDateFormat con la configuración regional del
 * script y podría salir en inglés ("July").
 */
function cuentasMailFecha_(fecha) {
  return Utilities.formatDate(fecha || new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy 'a las' HH:mm");
}

/** Solo la hora (para "vence a las 14:32 h"). */
function cuentasMailHora_(fecha) {
  return Utilities.formatDate(fecha || new Date(), Session.getScriptTimeZone(), 'HH:mm');
}

/**
 * URL de una pantalla de la app para un botón del correo.
 * Se fuerza /exec: getUrl() devuelve /dev cuando se ejecuta desde el editor, y ese
 * enlace solo abre para quien tiene permiso de edición — al asesor le daría un error.
 * Devuelve '' si el script todavía no está desplegado, y entonces no se pinta el botón.
 */
function cuentasUrlApp_(pagina) {
  try {
    const base = String(ScriptApp.getService().getUrl() || '');
    if (!base) return '';
    const exec = base.replace(/\/dev(\?|$)/, '/exec$1');
    const p = String(pagina || '').trim();
    return p ? exec + '?page=' + encodeURIComponent(p) : exec;
  } catch (e) {
    Logger.log('cuentasUrlApp_: ' + e.message);
    return '';
  }
}

// ── Piezas de la plantilla ───────────────────────────────────────────────────
// Cada pieza devuelve HTML ya seguro: el texto se escapa aquí, no en quien llama.

/** Texto de vista previa en la bandeja. Los espacios de ancho cero evitan que el cliente
 *  rellene la vista previa con el principio del cuerpo. */
function cuentasMailPreheader_(texto) {
  if (!texto) return '';
  return '<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;' +
         'font-size:1px;line-height:1px;color:transparent;mso-hide:all">' +
         secEscapeHtml_(texto) + new Array(70).join('&#8203;&nbsp;') + '</div>';
}

/** Párrafo del cuerpo. nivel: 1 = principal, 2 = secundario, 3 = letra pequeña. */
function cuentasMailP_(html, nivel, margen) {
  const M = CUENTAS_MAIL;
  const est = {
    1: 'font-size:16px;line-height:1.6;color:' + M.ink,
    2: 'font-size:15px;line-height:1.6;color:' + M.inkSoft,
    3: 'font-size:13px;line-height:1.6;color:' + M.inkFaint
  }[nivel || 1];
  const clase = { 1: 'm-t1', 2: 'm-t2', 3: 'm-t3' }[nivel || 1];
  return '<p class="' + clase + '" style="margin:0 0 ' + (margen == null ? 16 : margen) + 'px;' + est + '">' + html + '</p>';
}

/**
 * Distintivo de estado. Lleva texto siempre: el color por sí solo no informa.
 *
 * A propósito NO lleva la clase m-soft: en tema oscuro conserva su fondo teñido claro
 * con el texto de color encima. Si se oscureciera el fondo (como el resto de las cajas),
 * el rosa #A8006F o el verde #15803D sobre #22272F se quedarían en 2:1 y no se leerían.
 */
function cuentasMailChip_(texto, tono) {
  if (!texto) return '';
  const t = cuentasMailTono_(tono);
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr>' +
    '<td style="padding:6px 12px;border-radius:999px;background:' + t.tint + '">' +
      '<span style="font-family:' + CUENTAS_MAIL.fuente + ';font-size:11px;font-weight:700;' +
      'letter-spacing:.1em;text-transform:uppercase;color:' + t.ink + '">' +
      t.marca + '&nbsp;&nbsp;' + secEscapeHtml_(texto) + '</span>' +
    '</td></tr></table>';
}

/** Botón sólido a prueba de clientes: el color va en el <td> (Outlook ignora el fondo del <a>). */
function cuentasMailBoton_(texto, url) {
  if (!url) return '';
  const M = CUENTAS_MAIL;
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 22px"><tr>' +
    '<td align="center" bgcolor="' + M.brand + '" style="border-radius:10px">' +
      '<a href="' + secEscapeHtml_(url) + '" target="_blank" ' +
      'style="display:inline-block;padding:13px 28px;font-family:' + M.fuente + ';font-size:15px;' +
      'font-weight:700;line-height:1;color:#FFFFFF;text-decoration:none;border-radius:10px">' +
      secEscapeHtml_(texto) + '</a>' +
    '</td></tr></table>';
}

/**
 * Ficha de datos del evento (cuenta, fecha…). Es lo que convierte un aviso genérico en
 * algo comprobable: el asesor puede ver si la hora cuadra con lo que él hizo.
 * @param {Array<Array<string>>} filas pares [etiqueta, valor]
 */
function cuentasMailDatos_(filas) {
  const M = CUENTAS_MAIL;
  const utiles = (filas || []).filter(function (f) { return f && f[1]; });
  if (!utiles.length) return '';

  // Las clases m-t2/m-t1 son imprescindibles: sin ellas, en tema oscuro el valor se
  // queda en #1B2330 sobre una superficie #22272F y el dato desaparece del correo.
  const cuerpo = utiles.map(function (f, i) {
    const borde = i ? 'border-top:1px solid ' + M.line + ';' : '';
    return '<tr>' +
      '<td class="m-hair m-t2" style="' + borde + 'padding:10px 0 10px 16px;font-family:' + M.fuente + ';' +
      'font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;' +
      'color:' + M.inkSoft + ';white-space:nowrap;vertical-align:top">' + secEscapeHtml_(f[0]) + '</td>' +
      '<td class="m-hair m-t1" align="right" style="' + borde + 'padding:10px 16px 10px 12px;font-family:' + M.fuente + ';' +
      'font-size:14px;font-weight:600;color:' + M.ink + ';vertical-align:top">' + secEscapeHtml_(f[1]) + '</td>' +
    '</tr>';
  }).join('');

  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="m-soft" ' +
    'style="margin:0 0 22px;background:' + M.surface2 + ';border:1px solid ' + M.line + ';border-radius:12px">' +
    cuerpo + '</table>';
}

/**
 * Recuadro de aviso con barra lateral de color (seguridad, "si no fuiste tú"…).
 * Igual que el distintivo, es un bloque que se queda CLARO en tema oscuro: así el color
 * del tono sigue significando algo y el texto no pierde contraste. Por eso su texto no
 * lleva las clases m-t*, que lo aclararían sobre un fondo que sigue siendo claro.
 */
function cuentasMailNota_(titulo, texto, tono) {
  if (!texto) return '';
  const M = CUENTAS_MAIL;
  const t = cuentasMailTono_(tono);
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="margin:0 0 20px;background:' + t.tint + ';border-radius:12px">' +
    '<tr><td style="padding:14px 16px;border-left:3px solid ' + t.ink + ';border-radius:12px">' +
      (titulo
        ? '<div style="font-family:' + M.fuente + ';font-size:13px;font-weight:700;color:' + t.ink + ';margin-bottom:4px">' +
          secEscapeHtml_(titulo) + '</div>'
        : '') +
      '<div style="font-family:' + M.fuente + ';font-size:13px;line-height:1.6;color:#3F4A57">' +
      secEscapeHtml_(texto) + '</div>' +
    '</td></tr></table>';
}

/**
 * Envía con el alias institucional si está dado de alta ("Enviar como" en Gmail) y, si no,
 * por la vía clásica: el correo del código SIEMPRE tiene que salir. Mismo criterio que
 * Correos.gs, pero con su propio remitente visible porque esto no es una cotización.
 *
 * @param {{cco:boolean, adjuntos:Array, bcc:string}=} extra
 *        `cco:true` PIDE la copia oculta global (T9.6). Es opt-in y no al revés, y eso es lo
 *        único que impide que una contraseña temporal acabe en un buzón compartido: por aquí
 *        pasan los correos de seguridad (códigos y contraseñas) y los avisos normales, y solo
 *        los segundos la piden. Quien escriba un correo nuevo y no diga nada, no la lleva.
 */
function cuentasEnviarCorreo_(para, asunto, html, textoPlano, extra) {
  // Modo captura (lo activa cuentasPreviaCorreos): el correo se guarda en vez de enviarse.
  // Así se puede revisar el diseño de las cuatro variantes sin dar de alta cuentas de
  // prueba ni gastar cuota de envío.
  if (CUENTAS_MAIL_CAPTURA) {
    CUENTAS_MAIL_CAPTURA.push({ para: para, asunto: asunto, html: html, plano: textoPlano });
    return '(captura)';
  }

  const opciones = { htmlBody: html, name: 'Sistema de cotizaciones Ventel' };
  extra = extra || {};
  if (extra.bcc) opciones.bcc = extra.bcc;
  if (extra.adjuntos && extra.adjuntos.length) opciones.attachments = extra.adjuntos;
  if (extra.inline) opciones.inlineImages = extra.inline;
  if (extra.responderA) opciones.replyTo = extra.responderA;
  if (extra.remitente) opciones.name = extra.remitente;
  if (extra.cco === true && typeof correoAplicarCco_ === 'function') {
    correoAplicarCco_(opciones, [para]);
  }

  let alias = false;
  try {
    alias = GmailApp.getAliases().indexOf(mailAlias_()) !== -1;
  } catch (e) {
    Logger.log('Sin acceso a los alias de Gmail: ' + e.message);
  }
  if (alias) {
    try {
      GmailApp.sendEmail(para, asunto, textoPlano, Object.assign({}, opciones, { from: mailAlias_() }));
      return mailAlias_();
    } catch (e) {
      Logger.log('Fallo el envío con alias, se reintenta por la vía clásica: ' + e.message);
    }
  }
  MailApp.sendEmail(para, asunto, textoPlano, opciones);
  return '';
}

/**
 * Correo con el código. El código va en el cuerpo, nunca en el asunto (el asunto se lee
 * en la lista de la bandeja, y ahí lo vería cualquiera que pase por delante de la pantalla).
 *
 * A propósito NO lleva botón: el código se teclea en la misma pestaña donde se pidió, y un
 * enlace a la pantalla de registro abriría un formulario vacío, sin los datos a medio llenar.
 *
 * @param {number=} textos.expira  marca de tiempo de caducidad, para decir la hora exacta.
 */
function cuentasEnviarCodigo_(correo, codigo, textos) {
  const M = CUENTAS_MAIL;
  const asunto = textos.asunto || 'Tu código de verificación · Ventel';
  const hora = textos.expira ? cuentasMailHora_(new Date(textos.expira)) : '';

  const html = cuentasPlantillaCorreo_({
    titulo: textos.titulo || 'Tu código de verificación',
    chip: textos.chip || 'Código de verificación',
    tono: 'brand',
    // La bandeja muestra esto antes de abrir: el dato que el asesor está esperando.
    preheader: 'Tu código de 6 dígitos, válido ' + CUENTAS_CODIGO_MINUTOS + ' minutos.',
    cuerpo:
      cuentasMailP_(secEscapeHtml_(textos.intro || 'Usa este código para continuar:'), 1, 20) +

      // El código: la única cosa que el asesor vino a buscar, así que es lo más grande
      // del correo. Monoespaciada y con interletraje para que no se confunda 0 con O.
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="m-soft" ' +
      'style="margin:0 0 22px;background:' + M.surface2 + ';border:1px solid ' + M.line + ';border-radius:14px">' +
        '<tr><td align="center" style="padding:24px 16px 20px">' +
          '<div class="m-t3" style="font-family:' + M.fuente + ';font-size:11px;font-weight:700;' +
          'letter-spacing:.14em;text-transform:uppercase;color:' + M.inkFaint + ';margin-bottom:12px">' +
          'Tu código</div>' +
          '<div class="m-code" style="font-family:' + M.mono + ';font-size:38px;font-weight:700;line-height:1.1;' +
          'letter-spacing:.28em;text-indent:.28em;color:' + M.brand + '">' + secEscapeHtml_(codigo) + '</div>' +
        '</td></tr>' +
        '<tr><td align="center" class="m-hair" style="padding:11px 16px;border-top:1px solid ' + M.line + '">' +
          '<span class="m-t2" style="font-family:' + M.fuente + ';font-size:12px;font-weight:600;color:' + M.inkSoft + '">' +
          (hora ? 'Vence a las ' + hora + ' h' : 'Vence en ' + CUENTAS_CODIGO_MINUTOS + ' minutos') +
          '&nbsp; · &nbsp;Un solo uso</span>' +
        '</td></tr>' +
      '</table>' +

      cuentasMailP_('Tecléalo en la pestaña donde lo pediste. Si ya la cerraste, vuelve a empezar y pide otro código.', 2, 20) +

      cuentasMailNota_('Nadie te va a pedir este código',
        'Ni por teléfono, ni por chat, ni por correo. El equipo Ventel nunca te lo va a preguntar: si alguien lo hace, no se lo des.',
        'warn') +

      (textos.cierre ? cuentasMailP_(secEscapeHtml_(textos.cierre), 3, 0) : '')
  });

  const plano = [
    textos.titulo || 'Tu código de verificación',
    '',
    textos.intro || 'Usa este código para continuar:',
    '',
    '    ' + codigo,
    '',
    (hora ? 'Vence a las ' + hora + ' h' : 'Vence en ' + CUENTAS_CODIGO_MINUTOS + ' minutos') + '. Un solo uso.',
    '',
    'Nadie del equipo Ventel te va a pedir este código por teléfono, chat ni correo.',
    'No lo compartas con nadie.',
    '',
    textos.cierre || ''
  ].join('\n');

  return cuentasEnviarCorreo_(correo, asunto, html, plano);
}

/**
 * Correo informativo, sin código dentro (cuenta creada, contraseña cambiada). Además del
 * texto acepta la ficha del evento y un botón, que es lo que lo vuelve útil y no solo
 * decorativo: el asesor ve la hora exacta y tiene a un clic la pantalla a la que va.
 *
 * @param {Object} textos
 *   {string}  titulo, intro, cierre, asunto
 *   {string=} chip      distintivo de estado ('Cuenta creada'…)
 *   {string=} tono      'ok' | 'warn' | 'brand' (color del distintivo)
 *   {string=} preheader vista previa en la bandeja
 *   {Array=}  datos     pares [etiqueta, valor] de la ficha
 *   {Object=} cta       { texto, pagina } botón hacia una pantalla de la app
 *   {Object=} alerta    { titulo, texto, tono } recuadro destacado
 */
function cuentasEnviarAviso_(correo, nombre, textos) {
  const pila = String(nombre || '').trim();
  const saludo = pila ? 'Hola, ' + secEscapeHtml_(pila.split(' ')[0]) + ':' : 'Hola:';
  const url = textos.cta ? cuentasUrlApp_(textos.cta.pagina) : '';
  // Una sola lectura del reloj: si se calculara en el HTML y otra vez en el texto plano,
  // las dos versiones del mismo correo podrían quedar con minutos distintos.
  const cuando = cuentasMailFecha_(new Date()) + ' h';

  const filas = (textos.datos || []).slice();
  filas.push(['Cuenta', correo]);
  filas.push(['Fecha y hora', cuando]);

  const html = cuentasPlantillaCorreo_({
    titulo: textos.titulo || 'Aviso de tu cuenta',
    chip: textos.chip || '',
    tono: textos.tono || 'ok',
    preheader: textos.preheader || textos.intro || '',
    cuerpo:
      cuentasMailP_(saludo, 1, 12) +
      cuentasMailP_(secEscapeHtml_(textos.intro || ''), 1, 22) +
      cuentasMailDatos_(filas) +
      cuentasMailBoton_((textos.cta && textos.cta.texto) || '', url) +
      (textos.alerta
        ? cuentasMailNota_(textos.alerta.titulo, textos.alerta.texto, textos.alerta.tono || 'warn')
        : '') +
      (textos.cierre ? cuentasMailP_(secEscapeHtml_(textos.cierre), 3, 0) : '')
  });

  const plano = [
    textos.titulo || 'Aviso de tu cuenta',
    '',
    (pila ? 'Hola, ' + pila.split(' ')[0] + ':' : 'Hola:'),
    '',
    textos.intro || '',
    '',
    'Cuenta: ' + correo,
    'Fecha y hora: ' + cuando + ' (hora del centro de México)',
    '',
    (url ? ((textos.cta && textos.cta.texto) || 'Abrir el sistema') + ': ' + url + '\n' : ''),
    (textos.alerta ? textos.alerta.texto + '\n' : ''),
    textos.cierre || ''
  ].join('\n');

  // Estos avisos SÍ llevan la copia oculta global: dicen que una cuenta se creó o que su
  // contraseña cambió, nunca cuál es. Los otros dos correos de este archivo —el código de
  // verificación y la contraseña temporal— llaman a la misma función sin pedirla.
  return cuentasEnviarCorreo_(correo, textos.asunto || 'Aviso de tu cuenta · Ventel', html, plano,
                              { cco: true });
}

/**
 * Marco del correo: cabecera con la marca, distintivo de estado, título, cuerpo y pie.
 * Recibe HTML ya escapado por las piezas de arriba; el único texto que escapa aquí es
 * el título, que llega en claro desde quien compone el correo.
 *
 * @param {Object} op { titulo, cuerpo, chip, tono, preheader }
 */
function cuentasPlantillaCorreo_(op) {
  const M = CUENTAS_MAIL;
  const o = op || {};

  return '' +
  '<!DOCTYPE html><html lang="es"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    // Sin esto, iOS y Outlook oscurecen el correo por su cuenta y revientan los contrastes.
    '<meta name="color-scheme" content="light dark">' +
    '<meta name="supported-color-schemes" content="light dark">' +
    '<title>' + secEscapeHtml_(o.titulo || '') + '</title>' +
    // Outlook de escritorio no entiende la pila de fuentes moderna: se le fija Arial.
    '<!--[if mso]><style>body,table,td,p,a,h1,div{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->' +
    '<style>' +
      // Móvil: menos aire lateral, para no perder ancho de lectura en 375 px.
      '@media only screen and (max-width:620px){' +
        '.m-pad{padding-left:22px !important;padding-right:22px !important}' +
        '.m-code{font-size:32px !important;letter-spacing:.2em !important;text-indent:.2em !important}' +
      '}' +
      // Tema oscuro: se redefinen los tokens, no se invierten los colores.
      '@media (prefers-color-scheme:dark){' +
        '.m-bg{background:#111519 !important}' +
        '.m-card{background:#1C2027 !important;border-color:#2C313A !important}' +
        '.m-soft{background:#22272F !important;border-color:#2C313A !important}' +
        '.m-hair{border-color:#2C313A !important}' +
        '.m-t1{color:#F1EDEF !important}' +
        '.m-t2{color:#C3CAD3 !important}' +
        '.m-t3{color:#96A0AC !important}' +
        '.m-logo{filter:brightness(0) invert(1)}' +
      '}' +
    '</style>' +
  '</head>' +
  '<body class="m-bg" style="margin:0;padding:0;width:100%;background:' + M.bg + ';' +
  '-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">' +
    cuentasMailPreheader_(o.preheader) +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="m-bg" ' +
    'style="background:' + M.bg + '">' +
      '<tr><td align="center" style="padding:32px 12px">' +

        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="m-card" ' +
        'style="width:100%;max-width:600px;background:' + M.surface + ';border:1px solid ' + M.line + ';' +
        'border-radius:16px;overflow:hidden;font-family:' + M.fuente + '">' +

          // Filete de marca: el único bloque rosa lleno del correo.
          '<tr><td style="height:4px;background:' + M.brand + ';line-height:4px;font-size:0">&nbsp;</td></tr>' +

          // Cabecera: logo + de qué sistema viene esto.
          '<tr><td class="m-pad" style="padding:26px 34px 0">' +
            '<img src="' + M.logo + '" width="104" alt="Liverpool" class="m-logo" ' +
            'style="display:block;width:104px;max-width:104px;height:auto;border:0;' +
            'font-family:' + M.fuente + ';font-size:15px;font-weight:700;color:' + M.brand + '">' +
            '<div class="m-t3" style="margin-top:12px;font-size:11px;font-weight:700;letter-spacing:.16em;' +
            'text-transform:uppercase;color:' + M.inkFaint + '">Sistema de cotizaciones Ventel</div>' +
          '</td></tr>' +

          // Estado y título.
          '<tr><td class="m-pad" style="padding:20px 34px 0">' +
            cuentasMailChip_(o.chip, o.tono) +
            '<h1 class="m-t1" style="margin:0 0 18px;font-size:25px;line-height:1.25;letter-spacing:-.01em;' +
            'font-weight:700;color:' + M.ink + '">' + secEscapeHtml_(o.titulo || '') + '</h1>' +
          '</td></tr>' +

          '<tr><td class="m-pad" style="padding:0 34px 8px">' + (o.cuerpo || '') + '</td></tr>' +

          // Pie.
          '<tr><td class="m-pad m-hair" style="padding:18px 34px 26px;border-top:1px solid ' + M.line + '">' +
            '<p class="m-t3" style="margin:0 0 6px;font-size:12px;line-height:1.6;color:' + M.inkSoft + '">' +
            '<strong style="font-weight:700">Sistema de cotizaciones Ventel</strong> · Liverpool</p>' +
            '<p class="m-t3" style="margin:0;font-size:11px;line-height:1.6;color:' + M.inkSoft + '">' +
            'Correo automático: no respondas a este mensaje. Las horas son del centro de México. ' +
            'Si algo no cuadra, avisa al equipo del sistema.</p>' +
          '</td></tr>' +

        '</table>' +

      '</td></tr>' +
    '</table>' +
  '</body></html>';
}

// =================================================================================================
// DIAGNÓSTICO (ejecutar desde el editor)
// =================================================================================================

/**
 * Comprueba que el flujo de códigos puede funcionar: propiedades escribibles, correo
 * saliente disponible, dominio configurado y códigos vivos en este momento.
 * @param {string=} correoPrueba correo al que mandar un código real de prueba (opcional).
 */
function cuentasDiagnostico(correoPrueba) {
  const dominio = cuentasDominioPermitido_();
  Logger.log('Dominio exigido en altas nuevas: ' + (dominio ? '@' + dominio : '(sin restricción)'));
  Logger.log('Vigencia del código: ' + CUENTAS_CODIGO_MINUTOS + ' min · vale: ' + CUENTAS_VALE_MINUTOS + ' min');
  Logger.log('Frenos: ' + CUENTAS_REENVIO_SEGUNDOS + ' s entre envíos, ' + CUENTAS_MAX_POR_HORA +
             ' por hora, ' + CUENTAS_MAX_INTENTOS + ' intentos por código');

  try {
    let vivos = 0;
    const todas = cuentasProps_().getProperties();
    Object.keys(todas).forEach(function (k) { if (k.indexOf(CUENTAS_PREFIJO) === 0) vivos++; });
    Logger.log('✔ Propiedades del script accesibles. Códigos/vales almacenados ahora: ' + vivos);
  } catch (e) {
    Logger.log('✖ No se pueden leer las propiedades del script: ' + e.message);
  }

  try {
    const alias = GmailApp.getAliases().indexOf(mailAlias_()) !== -1;
    Logger.log((alias ? '✔' : '·') + ' Alias ' + mailAlias_() + (alias ? ' disponible.' : ' NO configurado: los códigos saldrán de la cuenta del sistema.'));
  } catch (e) {
    Logger.log('· Sin acceso a los alias de Gmail (se usará MailApp): ' + e.message);
  }
  Logger.log('Cuota de correos que le queda hoy a la cuenta: ' + MailApp.getRemainingDailyQuota());

  if (correoPrueba) {
    const r = solicitarCodigoRecuperacion(correoPrueba);
    Logger.log('Prueba de envío a ' + correoPrueba + ': ' + JSON.stringify(r));
    return r;
  }
  return { success: true };
}

/**
 * Genera las CUATRO variantes de correo de cuenta sin enviar nada y las deja en un
 * archivo HTML en Drive para revisarlas en el navegador. Ejecutar desde el editor.
 *
 * Es la forma de revisar el diseño sin dar de alta cuentas falsas: los correos se
 * capturan en memoria (CUENTAS_MAIL_CAPTURA) en lugar de salir por Gmail.
 *
 * @param {string=} enviarA  si se pasa un correo, además manda las cuatro de verdad a
 *                           esa dirección para verlas en un cliente real (Gmail, Outlook).
 * @return {string} URL del archivo de vista previa en Drive.
 */
function cuentasPreviaCorreos(enviarA) {
  const muestra = {
    correo: 'asesor.demo@liverpool.com.mx',
    nombre: 'María Fernanda Ruiz',
    codigo: '408137',
    expira: Date.now() + CUENTAS_CODIGO_MINUTOS * 60000
  };

  const variantes = function () {
    cuentasEnviarCodigo_(muestra.correo, muestra.codigo, {
      titulo: 'Confirma tu correo',
      chip: 'Alta de cuenta',
      expira: muestra.expira,
      intro: 'Estás creando tu cuenta en el Sistema de cotizaciones Ventel. Escribe este código para terminar:',
      asunto: 'Tu código para crear la cuenta · Ventel',
      cierre: 'Si no fuiste tú quien pidió crear una cuenta, ignora este mensaje: sin el código no se crea nada.'
    });
    cuentasEnviarCodigo_(muestra.correo, muestra.codigo, {
      titulo: 'Recupera tu contraseña',
      chip: 'Recuperar acceso',
      expira: muestra.expira,
      intro: 'Pediste cambiar la contraseña de tu cuenta en el Sistema de cotizaciones Ventel. Escribe este código para continuar:',
      asunto: 'Tu código para recuperar la contraseña · Ventel',
      cierre: 'Si no fuiste tú, ignora este mensaje: tu contraseña sigue igual mientras nadie use el código.'
    });
    cuentasEnviarAviso_(muestra.correo, muestra.nombre, {
      titulo: 'Tu cuenta ya está lista',
      chip: 'Cuenta creada',
      tono: 'ok',
      preheader: 'Ya puedes iniciar sesión en el Sistema de cotizaciones Ventel.',
      intro: 'Se creó tu cuenta en el Sistema de cotizaciones Ventel con este correo. Ya puedes iniciar sesión y empezar a cotizar.',
      asunto: 'Cuenta creada · Sistema de cotizaciones Ventel',
      datos: [['Nombre', muestra.nombre]],
      cta: { texto: 'Iniciar sesión', pagina: 'login' },
      alerta: {
        titulo: '¿No reconoces esta cuenta?',
        texto: 'Si no fuiste tú quien se registró con este correo, avisa al equipo del sistema para que la demos de baja.',
        tono: 'warn'
      },
      cierre: 'Guarda tu contraseña en un sitio seguro: nadie del equipo puede verla, solo se puede restablecer.'
    });
    cuentasEnviarAviso_(muestra.correo, muestra.nombre, {
      titulo: 'Tu contraseña se actualizó',
      chip: 'Contraseña actualizada',
      tono: 'ok',
      preheader: 'Cambio confirmado. Si no fuiste tú, avisa al equipo del sistema.',
      intro: 'La contraseña de tu cuenta en el Sistema de cotizaciones Ventel acaba de cambiar. Si fuiste tú, no tienes que hacer nada más: entra con la contraseña nueva.',
      asunto: 'Tu contraseña de Ventel cambió',
      cta: { texto: 'Iniciar sesión', pagina: 'login' },
      alerta: {
        titulo: 'Si NO fuiste tú, actúa ahora',
        texto: 'Alguien más pudo entrar a tu correo. Avisa de inmediato al equipo del sistema y cambia también la contraseña de tu cuenta de correo.',
        tono: 'warn'
      }
    });
  };

  // 1) Capturar para la vista previa.
  const capturados = [];
  CUENTAS_MAIL_CAPTURA = capturados;
  try {
    variantes();
  } finally {
    CUENTAS_MAIL_CAPTURA = null;   // sin esto, el siguiente envío real se quedaría en memoria
  }

  const pagina = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
    '<title>Correos de cuenta · vista previa</title></head>' +
    '<body style="margin:0;background:#DDE3EA;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">' +
    capturados.map(function (c) {
      return '<div style="padding:20px 12px 0"><div style="max-width:600px;margin:0 auto;' +
        'font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5C6B7E">' +
        'Asunto: ' + secEscapeHtml_(c.asunto) + '</div></div>' + c.html;
    }).join('') +
    '</body></html>';

  const archivo = DriveApp.createFile(
    'Ventel · vista previa de correos de cuenta.html', pagina, MimeType.HTML);
  Logger.log('Vista previa generada (' + capturados.length + ' correos): ' + archivo.getUrl());

  // 2) Si se pidió, enviarlos de verdad para verlos en un cliente real.
  if (enviarA && secCorreoValido_(enviarA)) {
    capturados.forEach(function (c) {
      cuentasEnviarCorreo_(enviarA, '[PRUEBA] ' + c.asunto, c.html, c.plano);
    });
    Logger.log('Las cuatro variantes se enviaron a ' + enviarA + '.');
  }

  return archivo.getUrl();
}

/**
 * Borra TODOS los códigos y vales pendientes. Salida de emergencia si algo quedó
 * atascado (p. ej. un correo bloqueado por el tope horario).
 */
function cuentasLimpiarTodo() {
  const props = cuentasProps_();
  const todas = props.getProperties();
  let n = 0;
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf(CUENTAS_PREFIJO) === 0) { props.deleteProperty(k); n++; }
  });
  Logger.log('Códigos y vales borrados: ' + n);
  return n;
}
