/**
 * =================================================================================================
 * SEGURIDAD E IDENTIDAD | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Capa única de identidad, permisos y configuración sensible. Antes cada archivo
 * resolvía esto por su cuenta y de forma distinta:
 *
 *   - Code.gs / Formatos.gs → isAdvancedUser(email)      (comparaba 'Si' exacto)
 *   - Metricas.gs           → metVerificarAsesor_(email) (comparaba 'Si' exacto)
 *   - Portal.gs             → portalGateAvanzado_(email) (comparaba en minúsculas)
 *
 * y cada una lo hacía distinto.
 *
 * QUIÉN MANDA: la sesión del PORTAL, es decir el correo con el que el asesor inició
 * sesión en la app (AppSession.userEmail, validado contra "Registros"). La cuenta de
 * Google con la que se abrió la web app (Session.getActiveUser) NO decide la identidad:
 * un asesor puede tener abierta otra cuenta de Google en el navegador y aun así trabajar
 * con el usuario del portal. Google solo se usa como respaldo cuando el navegador no
 * declara ningún correo (ejecuciones desde el editor, disparadores, diagnósticos).
 *
 * MODO DE AUTENTICACIÓN — propiedad de script "AUTH_MODO" (Configuración > Propiedades):
 *   'portal'   (predeterminado) Manda el correo con el que se inició sesión en el portal.
 *              Debe estar dado de alta en "Registros"; si no lo está, se rechaza. Sin
 *              correo declarado se cae a la cuenta de Google (si está registrada).
 *   'auto'     La cuenta de Google manda cuando está dada de alta en "Registros"; si esa
 *              cuenta NO está registrada, se acepta el correo del portal.
 *   'estricto' Solo se acepta la cuenta de Google, y debe estar dada de alta. Ignora por
 *              completo el correo del portal.
 *   'legado'   Como 'portal' pero sin el respaldo a la cuenta de Google: si el navegador
 *              no declara correo, falla. Se conserva por compatibilidad.
 *
 * OJO con 'portal': el correo lo declara el navegador, así que el servidor comprueba
 * que exista en "Registros" pero no puede probar que sea de quien dice ser. Es el modo
 * elegido a propósito para que la sesión sea la del portal y no la de Google.
 *
 * Todas las funciones de este archivo llevan el prefijo sec* para no chocar con nada.
 */

// ── CONFIGURACIÓN (Script Properties con respaldo en código) ─────────────────
// Los valores sensibles (webhook, sal de contraseñas, IDs de hojas) deberían vivir
// en las propiedades del script, no en el código fuente. secConfig_ lee la propiedad
// y, si no existe, usa el valor que ya estaba en el archivo: así nada se rompe al
// desplegar y la migración se puede hacer con secGuardarConfiguracion().

function secConfig_(clave, respaldo) {
  try {
    const v = PropertiesService.getScriptProperties().getProperty(clave);
    return (v === null || v === '') ? respaldo : v;
  } catch (e) {
    return respaldo;
  }
}

/**
 * Guarda en las propiedades del script los valores sensibles. Ejecutar UNA VEZ a mano
 * desde el editor (con los valores reales) para sacarlos del código fuente.
 * Después de correrla se pueden vaciar las constantes de Code.gs / Portal.gs.
 */
function secGuardarConfiguracion() {
  secSoloInterno_('secGuardarConfiguracion');
  const props = PropertiesService.getScriptProperties();
  const actual = {
    AUTH_MODO:              secConfig_('AUTH_MODO', 'portal'),
    // Dominio exigido en las altas nuevas (Cuentas.gs). 'ninguno' = sin restricción.
    CUENTAS_DOMINIO:        secConfig_('CUENTAS_DOMINIO', typeof CUENTAS_DOMINIO_RESPALDO === 'string' ? CUENTAS_DOMINIO_RESPALDO : ''),
    WEBHOOK_URL:            secConfig_('WEBHOOK_URL', typeof WEBHOOK_URL === 'string' ? WEBHOOK_URL : ''),
    HASH_SALT:              secConfig_('HASH_SALT', typeof HASH_SALT === 'string' ? HASH_SALT : ''),
    PORTAL_SHEET_ID:        secConfig_('PORTAL_SHEET_ID', typeof PORTAL_SHEET_ID === 'string' ? PORTAL_SHEET_ID : ''),
    CCL_TEMPLATE_SHEET_ID:  secConfig_('CCL_TEMPLATE_SHEET_ID', typeof CCL_TEMPLATE_SHEET_ID === 'string' ? CCL_TEMPLATE_SHEET_ID : ''),
    PORTAL_CALENDAR_ID:     secConfig_('PORTAL_CALENDAR_ID', typeof PORTAL_CALENDAR_ID === 'string' ? PORTAL_CALENDAR_ID : '')
  };
  Object.keys(actual).forEach(function (k) { if (actual[k]) props.setProperty(k, actual[k]); });
  Logger.log('Configuración guardada en las propiedades del script:');
  Object.keys(actual).forEach(function (k) {
    Logger.log('  ' + k + ' = ' + (k === 'HASH_SALT' || k === 'WEBHOOK_URL' ? '(oculto, ' + String(actual[k]).length + ' caracteres)' : actual[k]));
  });
  return actual;
}

/**
 * Fija el modo de autenticación. Ejecutar desde el editor si la propiedad AUTH_MODO ya
 * quedó guardada con otro valor (el predeterminado del código solo aplica cuando la
 * propiedad NO existe).
 * @param {string=} modo 'portal' (predeterminado), 'auto', 'estricto' o 'legado'.
 */
function secFijarModoAuth(modo) {
  secSoloInterno_('secFijarModoAuth');
  const valor = String(modo || 'portal').trim().toLowerCase();
  if (['portal', 'auto', 'estricto', 'legado'].indexOf(valor) < 0) {
    throw new Error('Modo desconocido: "' + valor + '" (usa portal, auto, estricto o legado).');
  }
  PropertiesService.getScriptProperties().setProperty('AUTH_MODO', valor);
  Logger.log('AUTH_MODO = ' + valor);
  return valor;
}

// ── IDENTIDAD ────────────────────────────────────────────────────────────────

/** Correo de la cuenta de Google que abrió la web app ('' si Google no lo expone). */
function secUsuarioGoogle_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

/** Normaliza un correo para comparar (minúsculas, sin espacios). */
function secNormalizarCorreo_(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

/** Interpreta la columna "Avanzado": tolera 'Si', 'si', 'SI', 'Sí', 'TRUE', 'x'. */
function secEsAfirmativo_(valor) {
  if (valor === true) return true;
  const s = String(valor == null ? '' : valor).trim().toLowerCase()
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
  return s === 'si' || s === 'true' || s === 'x' || s === '1' || s === 'verdadero';
}

/**
 * Índice de la hoja "Registros" en memoria, válido solo durante ESTA ejecución.
 * Una llamada puede resolver la identidad dos veces (cuenta de Google y correo
 * declarado); sin esto se leería la hoja completa dos veces por petición.
 */
var SEC_REGISTROS_CACHE = null;

function secIndiceRegistros_() {
  if (SEC_REGISTROS_CACHE) return SEC_REGISTROS_CACHE;

  // Segunda capa, entre el memo y la hoja: CacheIdentidad.gs. El memo de arriba solo vive lo que
  // dura ESTA ejecución, y cada google.script.run es una ejecución nueva, así que sin esto toda
  // llamada al servidor releía la hoja entera antes de hacer su trabajo. Con typeof porque el
  // sistema tiene que seguir en pie si ese archivo no está desplegado todavía.
  if (typeof idcLeer_ === 'function') {
    const guardado = idcLeer_('registros');
    if (guardado) {
      SEC_REGISTROS_CACHE = guardado;
      return guardado;
    }
  }

  const indice = {};
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTROS_SHEET_NAME);
    if (sheet && sheet.getLastRow() >= 2) {
      const data = sheet.getDataRange().getValues();
      const headers = data.shift().map(String);
      const iEmail = headers.indexOf('Email');
      const iNombre = headers.indexOf('Nombre');
      const iAdv = headers.indexOf('Avanzado');
      // OJO: aquí NO se leen rol ni permisos. Esta hoja dice QUIÉN es cada persona
      // (nombre, correo, contraseña); QUÉ PUEDE hacer vive en la hoja oculta
      // "_PermisosSistema" (ver Permisos.gs). Se separaron porque "Registros" es una
      // hoja que edita gente, con sus validaciones y sus columnas propias, y meter
      // ahí la configuración del sistema acababa en choques silenciosos.
      // "Avanzado" sí se sigue leyendo: es el respaldo para quien aún no tiene fila
      // en la hoja de permisos.
      const iAlta = headers.indexOf('Timestamp') >= 0 ? headers.indexOf('Timestamp') : headers.indexOf('Fecha');
      if (iEmail >= 0) {
        for (let r = 0; r < data.length; r++) {
          const correo = secNormalizarCorreo_(data[r][iEmail]);
          if (!correo || indice[correo]) continue; // el primer registro gana
          indice[correo] = {
            nombre: iNombre >= 0 ? String(data[r][iNombre] || '') : '',
            avanzado: iAdv >= 0 && secEsAfirmativo_(data[r][iAdv]),
            alta: iAlta >= 0 ? data[r][iAlta] : '',
            fila: r + 2   // número de fila real en la hoja, para la consola
          };
        }
      }
    }
  } catch (e) {
    Logger.log('secIndiceRegistros_ error: ' + e);
  }
  // Si la lectura falló, `indice` sigue vacío — y un índice vacío NO se guarda (regla 3 de
  // CacheIdentidad.gs): "la hoja no se pudo leer" y "no hay nadie dado de alta" producen el mismo
  // objeto, y cachear el segundo dejaría a todo el mundo fuera durante el TTL sin un solo error.
  if (typeof idcGuardar_ === 'function') idcGuardar_('registros', indice);
  SEC_REGISTROS_CACHE = indice;
  return indice;
}

/**
 * Busca un correo en la hoja "Registros".
 * @return {{encontrado:boolean, email:string, nombre:string, avanzado:boolean}}
 */
function secBuscarRegistro_(email) {
  const out = { encontrado: false, email: secNormalizarCorreo_(email), nombre: '', avanzado: false };
  if (!out.email) return out;
  const fila = secIndiceRegistros_()[out.email];
  if (fila) {
    out.encontrado = true;
    out.nombre = fila.nombre;
    out.avanzado = fila.avanzado;
  }
  return out;
}

/**
 * Resuelve QUIÉN está haciendo la llamada. Es el único punto donde se decide la
 * identidad: el resto del sistema debe usar esto y nunca el correo del cliente a secas.
 *
 * @param {string} emailCliente Correo con el que se inició sesión en el portal (AppSession.userEmail).
 * @return {{ok:boolean, email:string, nombre:string, avanzado:boolean, origen:string, error:string}}
 */
function secIdentidad_(emailCliente) {
  const modo = String(secConfig_('AUTH_MODO', 'portal')).trim().toLowerCase();
  const declarado = secNormalizarCorreo_(emailCliente);

  const fallo = function (mensaje) {
    return { ok: false, email: '', nombre: '', avanzado: false, rol: 'normal', maestro: false,
             bloques: [], origen: 'ninguno', error: mensaje };
  };

  /**
   * Arma la identidad de alguien que SÍ está dado de alta.
   *
   * Aquí es donde el modelo de bloques (Permisos.gs) entra al sistema: como toda
   * llamada pasa por secIdentidad_, basta resolver el rol y los bloques una vez y
   * el resto de la app los recibe ya calculados. Si Permisos.gs no estuviera en el
   * proyecto, se cae al comportamiento anterior —la columna "Avanzado" mandando—
   * en vez de dejar a todo el mundo fuera.
   */
  const exito = function (reg, origen) {
    // Los permisos se piden a Permisos.gs, que los lee de su hoja oculta. Si ese
    // archivo no estuviera en el proyecto, se cae al comportamiento anterior —la
    // columna "Avanzado" mandando— en vez de dejar a todo el mundo fuera.
    if (typeof permUsuario_ !== 'function') {
      return {
        ok: true, email: reg.email, nombre: reg.nombre, avanzado: reg.avanzado,
        rol: reg.avanzado ? 'avanzado' : 'normal', maestro: false, bloques: [],
        origen: origen, error: ''
      };
    }

    const u = permUsuario_(reg.email);

    // Una cuenta dada de baja existe en la hoja pero no puede hacer nada: se corta
    // aquí, en el único punto por el que pasan todas las funciones de servidor.
    if (!u.activo) {
      const negado = fallo('Tu cuenta está dada de baja. Pide al administrador que la reactive.');
      negado.email = reg.email;
      negado.nombre = reg.nombre;
      return negado;
    }

    return {
      ok: true,
      email: reg.email,
      nombre: reg.nombre,
      // 'avanzado' se conserva porque decenas de funciones ya lo consultan; ahora
      // se deriva del rol, de modo que un maestro pasa todas esas puertas también.
      avanzado: u.avanzado,
      rol: u.rol,
      maestro: u.maestro,
      bloques: u.bloques,
      origen: origen,
      error: ''
    };
  };

  /* LA LLAVE DE SESIÓN MANDA (Sesiones.gs). En este orden:
       1. Hay sesión validada en esta ejecución → es ella quien llama. Un correo declarado
          distinto del de la llave se rechaza: eso es lo que impide hacerse pasar por otro.
       2. No hay sesión y es el editor o un activador → sigue la lógica de siempre (abajo).
       3. No hay sesión y es la webapp → se rechaza: el correo que diga el navegador ya no
          basta. (Llave vencida no llega aquí: secEjecutar corta antes con SESION_EXPIRADA.)
     La sesión gana AUNQUE la cuenta activa sea la del dueño: así el dueño puede probar roles
     entrando al Portal como otra persona. Se devuelve {ok:false}, nunca se lanza: hay
     funciones que con !id.ok siguen en modo visitante. 'estricto' no usa sesiones (manda
     Google) y AUTH_SESIONES='no' devuelve el comportamiento anterior. */
  if (modo !== 'estricto' && typeof sesObligatorias_ === 'function' && sesObligatorias_()) {
    if (typeof SEC_SESION_ !== 'undefined' && SEC_SESION_ && SEC_SESION_.email) {
      if (declarado && declarado !== SEC_SESION_.email) {
        return fallo('La sesión abierta es de otra cuenta. Cierra sesión y vuelve a entrar con ' + declarado + '.');
      }
      const regSesion = secBuscarRegistro_(SEC_SESION_.email);
      return regSesion.encontrado
        ? exito(regSesion, 'sesion')
        : fallo('El usuario ' + SEC_SESION_.email + ' ya no está dado de alta. Inicia sesión de nuevo.');
    }
    if (!secContextoEditor_()) {
      return fallo('Tu sesión no es válida o expiró. Inicia sesión de nuevo.');
    }
  }

  // Modo predeterminado: la sesión es la del PORTAL. La cuenta de Google del navegador
  // no interviene salvo que no llegue ningún correo declarado (editor, disparadores).
  if (modo === 'portal') {
    if (declarado) {
      const regPortal = secBuscarRegistro_(declarado);
      return regPortal.encontrado
        ? exito(regPortal, 'portal')
        : fallo('El usuario ' + declarado + ' no está dado de alta en el sistema. Inicia sesión de nuevo.');
    }
    const regGoogleFallback = secBuscarRegistro_(secUsuarioGoogle_());
    return regGoogleFallback.encontrado
      ? exito(regGoogleFallback, 'google')
      : fallo('Tu sesión no es válida o expiró. Inicia sesión de nuevo.');
  }

  const google = secUsuarioGoogle_();

  // Modo legado: comportamiento anterior (solo como salida de emergencia).
  if (modo === 'legado') {
    const reg = secBuscarRegistro_(declarado);
    return reg.encontrado
      ? exito(reg, 'cliente')
      : fallo('Tu sesión no es válida o expiró. Inicia sesión de nuevo.');
  }

  // La cuenta de Google manda siempre que esté dada de alta.
  if (google) {
    const regGoogle = secBuscarRegistro_(google);
    if (regGoogle.encontrado) return exito(regGoogle, 'google');

    if (modo === 'estricto') {
      return fallo('Tu cuenta de Google (' + google + ') no está dada de alta en el sistema. ' +
        'Regístrate con ese mismo correo o pide que te den de alta.');
    }
    // Modo 'auto': la cuenta de Google no está registrada (p. ej. una cuenta de
    // servicio o alguien que aún no se da de alta) → se acepta lo que dice el cliente.
  } else if (modo === 'estricto') {
    return fallo('No se pudo verificar tu cuenta de Google. Abre la aplicación desde tu cuenta corporativa.');
  }

  const regDeclarado = secBuscarRegistro_(declarado);
  if (!regDeclarado.encontrado) {
    return fallo('Tu sesión no es válida o expiró. Inicia sesión de nuevo.');
  }
  return exito(regDeclarado, 'cliente');
}

/**
 * Igual que secIdentidad_ pero además exige rol avanzado.
 * @return {{ok:boolean, email:string, nombre:string, avanzado:boolean, error:string}}
 */
function secIdentidadAvanzada_(emailCliente) {
  const id = secIdentidad_(emailCliente);
  if (!id.ok) return id;
  if (!id.avanzado) {
    return { ok: false, email: id.email, nombre: id.nombre, avanzado: false, rol: id.rol,
             maestro: false, bloques: id.bloques, origen: id.origen,
             error: 'Tu cuenta no tiene permisos de usuario avanzado.' };
  }
  return id;
}

/**
 * Igual que secIdentidad_ pero exigiendo un BLOQUE concreto (ver Permisos.gs).
 * Es la puerta fina: en vez de preguntar "¿es avanzado?" se pregunta "¿puede
 * revisar cotizaciones?", que es lo que de verdad se está a punto de dejar hacer.
 *
 * @param {string} emailCliente Correo de la sesión del portal.
 * @param {string} bloqueId     Identificador de bloque ('revisar', 'anuncios', …).
 */
function secIdentidadConBloque_(emailCliente, bloqueId) {
  const id = secIdentidad_(emailCliente);
  if (!id.ok) return id;
  if (!bloqueId) return id;
  if ((id.bloques || []).indexOf(bloqueId) !== -1) return id;

  // Se distingue "no te toca" de "está apagado por mantenimiento": son dos problemas
  // distintos y el asesor no debería ir a pedir permisos cuando lo que hay es una
  // ventana de mantenimiento.
  const bloque = (typeof permBloque_ === 'function') ? permBloque_(bloqueId) : null;
  const apagado = (typeof permModulosApagados_ === 'function') &&
                  permModulosApagados_().indexOf(bloqueId) !== -1 && !id.maestro;
  const nombre = (bloque && bloque.nombre) || bloqueId;
  return {
    ok: false, email: id.email, nombre: id.nombre, avanzado: id.avanzado, rol: id.rol,
    maestro: id.maestro, bloques: id.bloques, origen: id.origen,
    error: apagado
      ? 'El módulo "' + nombre + '" está en mantenimiento. Vuelve a intentarlo más tarde.'
      : 'Tu cuenta no tiene acceso a "' + nombre + '".'
  };
}

/**
 * Exige el rol MAESTRO. Es el gate de toda la consola de administración: cambiar
 * roles, ajustes o módulos solo puede hacerlo quien ya lo es, y el primer maestro
 * se nombra a mano desde el editor (permSembrarMaestro en Permisos.gs).
 */
function secIdentidadMaestra_(emailCliente) {
  const id = secIdentidad_(emailCliente);
  if (!id.ok) return id;
  if (!id.maestro) {
    return { ok: false, email: id.email, nombre: id.nombre, avanzado: id.avanzado, rol: id.rol,
             maestro: false, bloques: id.bloques, origen: id.origen,
             error: 'Solo el rol maestro puede entrar a la consola de administración.' };
  }
  return id;
}

/**
 * Correo con el que hay que SELLAR un registro (AsesorCorreo de una cotización, replyTo
 * de un correo…). Antes estos puntos caían a Session.getActiveUser(), que en modo
 * 'portal' puede ser una cuenta distinta a la del asesor que está usando la app.
 * Nunca falla: si la identidad no se resuelve, devuelve lo que declaró el navegador y,
 * en última instancia, la cuenta de Google.
 *
 * @param {string} emailCliente Correo de la sesión del portal.
 * @return {string} correo en minúsculas ('' si no hay nada de dónde sacarlo).
 */
function secCorreoEfectivo_(emailCliente) {
  const id = secIdentidad_(emailCliente);
  if (id.ok) return id.email;
  return secNormalizarCorreo_(emailCliente) || secUsuarioGoogle_();
}

// ── LÍMITE DE INTENTOS (fuerza bruta en el login) ────────────────────────────

/**
 * Cuenta intentos fallidos por clave (correo) en una ventana de tiempo.
 * @return {{bloqueado:boolean, restantes:number}}
 */
function secIntentosRevisar_(clave, maximo, ventanaSegundos) {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get('sec_try_' + clave) || 0);
    return { bloqueado: n >= maximo, restantes: Math.max(0, maximo - n) };
  } catch (e) {
    return { bloqueado: false, restantes: maximo };
  }
}

function secIntentosSumar_(clave, ventanaSegundos) {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get('sec_try_' + clave) || 0) + 1;
    cache.put('sec_try_' + clave, String(n), ventanaSegundos);
    return n;
  } catch (e) {
    return 0;
  }
}

function secIntentosLimpiar_(clave) {
  try { CacheService.getScriptCache().remove('sec_try_' + clave); } catch (e) {}
}

// ── UTILIDADES ───────────────────────────────────────────────────────────────

/**
 * Escapa texto para incrustarlo en HTML (correos y documentos generados en el servidor).
 * Los datos vienen de formularios que llenan asesores; sin esto, un nombre con "<" rompe
 * el correo del cliente y abre la puerta a inyección de marcado.
 */
function secEscapeHtml_(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Compara dos cadenas en tiempo constante (evita filtrar información por tiempos). */
function secComparacionSegura_(a, b) {
  const sa = String(a || ''), sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= (sa.charCodeAt(i) ^ sb.charCodeAt(i));
  return diff === 0;
}

/** Hash de contraseña (mismo algoritmo de siempre, para no invalidar las existentes). */
function secHashContrasena_(password) {
  const sal = secConfig_('HASH_SALT', typeof HASH_SALT === 'string' ? HASH_SALT : '');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password) + sal);
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/** Valida la forma de un correo. */
function secCorreoValido_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(secNormalizarCorreo_(email));
}

/**
 * Diagnóstico rápido de la capa de seguridad. Ejecutar desde el editor.
 * @param {string=} correoPortal Correo de la sesión del portal a simular. Si se omite,
 *        se prueba con la cuenta de Google (que es el respaldo del modo 'portal').
 */
function secDiagnostico(correoPortal) {
  secSoloInterno_('secDiagnostico');
  const google = secUsuarioGoogle_();
  const modo = String(secConfig_('AUTH_MODO', 'portal')).trim().toLowerCase();
  Logger.log('Modo de autenticación: ' + modo +
    (modo === 'portal' ? ' (manda el correo con el que se inicia sesión en el portal)' : ''));
  Logger.log('Cuenta de Google detectada: ' + (google || '(no visible)') +
    (modo === 'portal' ? ' — solo se usa si el navegador no declara correo' : ''));
  const reg = secBuscarRegistro_(google);
  Logger.log('¿La cuenta de Google está en Registros? ' + (reg.encontrado ? 'sí' + (reg.avanzado ? ' (avanzado)' : ' (normal)') : 'NO'));
  const declarado = secNormalizarCorreo_(correoPortal);
  Logger.log('Correo del portal simulado: ' + (declarado || '(ninguno)'));
  const id = secIdentidad_(declarado);
  Logger.log('Identidad resuelta: ' + JSON.stringify(id));
  return id;
}
