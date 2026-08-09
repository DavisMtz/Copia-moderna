/**
 * =================================================================================================
 * CONSOLA MAESTRA | Sistema de cotizaciones Ventel + Portal Ventel
 * =================================================================================================
 * Todo lo que hasta ahora se hacía abriendo el editor de Apps Script o editando la hoja
 * "Registros" a mano: nombrar supervisores, cambiar el modo de autenticación, apagar un
 * módulo, ver por qué falla el formato CCL. Este archivo lo expone como funciones que la
 * pantalla ?page=consola puede llamar, y lo hace bajo tres reglas que no se rompen nunca:
 *
 *   1. NADA se ejecuta sin pasar por un gate. Cada función empieza resolviendo la identidad
 *      contra Seguridad.gs y exigiendo un bloque de administración concreto. El correo que
 *      manda el navegador no es una credencial: es una pregunta que el servidor responde.
 *
 *   2. NADIE puede dejarse fuera. No se puede quitar el rol maestro a uno mismo, ni darse
 *      de baja, ni retirar al último maestro que queda. Un sistema de permisos que permite
 *      cerrarse por dentro es un sistema que un día hay que arreglar desde el editor.
 *
 *   3. TODO cambio queda apuntado. La hoja "BitacoraConsola" guarda quién cambió qué y
 *      cuándo. Sin eso, "¿por qué este asesor ya no puede cotizar?" no tiene respuesta.
 *
 * El secreto de contraseñas (HASH_SALT) es deliberadamente de SOLO LECTURA aquí: cambiarlo
 * invalida de golpe la contraseña de todo el mundo, y eso no debe estar a un clic de nadie.
 *
 * Todas las funciones que el cliente llama llevan el prefijo consola*.
 */

// ── CATÁLOGO DE AJUSTES ──────────────────────────────────────────────────────
// Lo que se puede tocar desde la pantalla. Cada ajuste declara qué es, cómo se
// edita y cómo se valida; la consola se dibuja sola a partir de esto, así que
// añadir un ajuste nuevo es añadir una entrada aquí y nada más.
//
//   clave       nombre de la propiedad de script.
//   tipo        'opcion' | 'texto' | 'secreto' | 'id_hoja' | 'id_calendario' | 'id_carpeta'
//   secreto     true = su valor nunca viaja al cliente; solo se dice si está puesto.
//   soloLectura true = se muestra pero no se guarda desde la consola.

const CONSOLA_AJUSTES = [
  {
    clave: 'AUTH_MODO', nombre: 'Modo de autenticación', grupo: 'Identidad',
    detalle: 'Quién decide de quién es la sesión: el correo con el que se entra al portal, o la cuenta de Google del navegador.',
    tipo: 'opcion', predeterminado: 'portal',
    opciones: [
      { valor: 'portal',   nombre: 'Portal (recomendado)',
        detalle: 'Manda el correo con el que se inicia sesión en la app. La cuenta de Google solo es respaldo.' },
      { valor: 'auto',     nombre: 'Automático',
        detalle: 'La cuenta de Google manda si está dada de alta; si no, se acepta la del portal.' },
      { valor: 'estricto', nombre: 'Estricto',
        detalle: 'Solo se acepta la cuenta de Google y debe estar dada de alta. Ignora el correo del portal.' }
    ]
  },
  {
    clave: 'CUENTAS_DOMINIO', nombre: 'Dominio permitido en altas', grupo: 'Identidad',
    detalle: 'Solo se pueden crear cuentas con correo de este dominio. Escribe "ninguno" para no restringir.',
    tipo: 'texto', predeterminado: 'liverpool.com.mx', marcador: 'liverpool.com.mx'
  },
  {
    clave: 'HASH_SALT', nombre: 'Sal de contraseñas', grupo: 'Identidad',
    detalle: 'Secreto con el que se cifran las contraseñas. Cambiarlo invalidaría la de todo el mundo, así que desde aquí solo se consulta si está puesto.',
    tipo: 'secreto', secreto: true, soloLectura: true
  },
  {
    clave: 'WEBHOOK_URL', nombre: 'Webhook de cotizaciones', grupo: 'Avisos',
    detalle: 'A dónde se avisa cuando se crea una cotización. Vacío = no se manda nada.',
    tipo: 'secreto', secreto: true, webhook: true, marcador: 'https://chat.googleapis.com/v1/spaces/…'
  },
  {
    clave: 'OPERACION_WEBHOOK_ESTADO', nombre: 'Webhook del estado de operación', grupo: 'Avisos',
    detalle: 'A dónde se comunica al equipo que un sistema se cayó, se restableció o entra en mantenimiento. Vacío = no se manda nada.',
    tipo: 'secreto', secreto: true, webhook: true, marcador: 'https://chat.googleapis.com/v1/spaces/…'
  },
  {
    clave: 'OPERACION_WEBHOOK_REPORTES', nombre: 'Webhook de reportes sueltos', grupo: 'Avisos',
    detalle: 'Copia de CADA reporte que manda un asesor, uno por uno. Conviene que sea un espacio distinto ' +
             'al de los comunicados: si se mezclan, el aviso que importa se pierde entre los reportes. Vacío = apagado.',
    tipo: 'secreto', secreto: true, webhook: true, marcador: 'https://chat.googleapis.com/v1/spaces/…'
  },
  {
    clave: 'PORTAL_SHEET_ID', nombre: 'Hoja del Portal', grupo: 'Fuentes de datos',
    detalle: 'Base de datos del portal: herramientas, paqueterías, formatos, plantillas y anuncios.',
    tipo: 'id_hoja'
  },
  {
    clave: 'CCL_TEMPLATE_SHEET_ID', nombre: 'Plantilla CCL', grupo: 'Fuentes de datos',
    detalle: 'Hoja de la que se copia el formato oficial CCL Liverpool.',
    tipo: 'id_hoja'
  },
  {
    clave: 'TRAZ_SHEET_ID', nombre: 'Hoja de trazabilidad', grupo: 'Fuentes de datos',
    detalle: 'Dónde se guarda el rastro de cambios de las cotizaciones.',
    tipo: 'id_hoja'
  },
  {
    clave: 'PORTAL_CALENDAR_ID', nombre: 'Calendario comercial', grupo: 'Fuentes de datos',
    detalle: 'Calendario del que salen las promociones vigentes.',
    tipo: 'id_calendario'
  },
  {
    clave: 'PORTAL_ANUNCIOS_FOLDER_ID', nombre: 'Carpeta de anuncios', grupo: 'Fuentes de datos',
    detalle: 'Carpeta de Drive donde se guardan las imágenes de los anuncios del portal.',
    tipo: 'id_carpeta'
  }
];

/** Orden de los grupos de ajustes en pantalla. */
const CONSOLA_GRUPOS_AJUSTES = ['Identidad', 'Avisos', 'Fuentes de datos'];

/** Hosts a los que se permite apuntar el webhook. Un webhook es una URL que el SERVIDOR
 *  visita: dejarlo libre convertiría la consola en un trampolín para alcanzar cualquier
 *  cosa que este proyecto pueda ver desde dentro de Google. */
const CONSOLA_WEBHOOK_HOSTS = ['chat.googleapis.com'];

/** Hoja donde se apunta cada cambio hecho desde la consola. */
const CONSOLA_BITACORA_SHEET = 'BitacoraConsola';
const CONSOLA_BITACORA_COLUMNAS = ['Fecha', 'Quien', 'Accion', 'Objetivo', 'Detalle'];

/** Cuántos renglones de bitácora se mandan a la pantalla. */
const CONSOLA_BITACORA_LIMITE = 150;

// ── BITÁCORA ─────────────────────────────────────────────────────────────────

/** Devuelve la hoja de bitácora, creándola con sus encabezados la primera vez. */
function consolaBitacoraHoja_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONSOLA_BITACORA_SHEET);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONSOLA_BITACORA_SHEET);
  sheet.getRange(1, 1, 1, CONSOLA_BITACORA_COLUMNAS.length).setValues([CONSOLA_BITACORA_COLUMNAS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, CONSOLA_BITACORA_COLUMNAS.length).setFontWeight('bold');
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 230);
  sheet.setColumnWidth(3, 190);
  sheet.setColumnWidth(4, 230);
  sheet.setColumnWidth(5, 420);
  return sheet;
}

/**
 * Apunta un cambio. Nunca revienta la operación que la llamó: si la bitácora falla,
 * el cambio ya se hizo y lo importante es que el usuario no vea un error confuso;
 * el fallo queda en el registro de ejecución.
 */
function consolaBitacoraApuntar_(quien, accion, objetivo, detalle) {
  try {
    consolaBitacoraHoja_().appendRow([new Date(), quien || '', accion || '', objetivo || '', detalle || '']);
  } catch (e) {
    Logger.log('No se pudo escribir en la bitácora: ' + e);
  }
}

/** Últimos movimientos, del más reciente al más viejo. */
function consolaBitacoraLeer_(limite) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSOLA_BITACORA_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const total = sheet.getLastRow() - 1;
    const cuantos = Math.min(total, limite || CONSOLA_BITACORA_LIMITE);
    const desde = sheet.getLastRow() - cuantos + 1;
    const datos = sheet.getRange(desde, 1, cuantos, CONSOLA_BITACORA_COLUMNAS.length).getValues();

    return datos.map(function (f) {
      return {
        fecha: f[0] instanceof Date ? f[0].toISOString() : String(f[0] || ''),
        quien: String(f[1] || ''),
        accion: String(f[2] || ''),
        objetivo: String(f[3] || ''),
        detalle: String(f[4] || '')
      };
    }).reverse();
  } catch (e) {
    Logger.log('consolaBitacoraLeer_ error: ' + e);
    return [];
  }
}

// ── GATE ─────────────────────────────────────────────────────────────────────

/**
 * Puerta de entrada de TODAS las funciones de este archivo.
 * @param {string} email    Correo de la sesión del portal (AppSession.userEmail).
 * @param {string} bloqueId Bloque de administración que hace falta ('adm_miembros', …).
 * @return {{ok:boolean, email:string, nombre:string, error:string}}
 */
function consolaGate_(email, bloqueId) {
  const id = secIdentidadMaestra_(email);
  if (!id.ok) return id;
  if (bloqueId && (id.bloques || []).indexOf(bloqueId) === -1) {
    const b = permBloque_(bloqueId);
    return { ok: false, email: id.email, nombre: id.nombre,
             error: 'Tu cuenta maestra no tiene el bloque "' + ((b && b.nombre) || bloqueId) + '".' };
  }
  return id;
}

/** Respuesta de error uniforme, para que la pantalla no tenga que adivinar la forma. */
function consolaError_(mensaje) {
  return { success: false, message: mensaje || 'No se pudo completar la operación.' };
}

// ── PANORAMA ─────────────────────────────────────────────────────────────────

/**
 * Todo lo que la consola necesita al abrirse, en UNA sola llamada: catálogo de bloques
 * y roles, miembros, ajustes, módulos apagados, formatos y un resumen del sistema.
 *
 * Va junto a propósito. En Apps Script cada google.script.run es un viaje de ida y
 * vuelta de cientos de milisegundos; siete llamadas sueltas se sienten como una
 * pantalla rota aunque cada una sea rápida.
 *
 * @param {string} email Correo de la sesión del portal.
 */
function consolaPanorama(email) {
  try {
    const gate = consolaGate_(email, '');
    if (!gate.ok) return consolaError_(gate.error);

    const catalogo = permCatalogo_();
    const yo = permUsuario_(gate.email);

    return {
      success: true,
      yo: { email: yo.email, nombre: yo.nombre, rol: yo.rol, rolNombre: yo.rolNombre, bloques: yo.bloques },
      catalogo: catalogo,
      miembros: consolaListaMiembros_(),
      ajustes: consolaLeerAjustes_(),
      gruposAjustes: CONSOLA_GRUPOS_AJUSTES.slice(),
      formatos: consolaLeerFormatos_(gate.email),
      resumen: consolaResumen_(),
      bitacora: (yo.bloques.indexOf('adm_bitacora') !== -1) ? consolaBitacoraLeer_(50) : []
    };
  } catch (e) {
    Logger.log('consolaPanorama error: ' + e + ' · ' + e.stack);
    return consolaError_('No pudimos cargar la consola. Inténtalo de nuevo en un momento.');
  }
}

/** Cifras de una ojeada: cuánta gente hay, de qué rol, y qué tan grande es la base. */
function consolaResumen_() {
  const resumen = {
    miembros: 0, activos: 0, bajas: 0,
    porRol: { normal: 0, avanzado: 0, maestro: 0 },
    cotizaciones: 0, modulosApagados: permModulosApagados_().length,
    urlApp: '', zonaHoraria: '', cuotaCorreo: -1
  };

  const indice = secIndiceRegistros_();
  Object.keys(indice).forEach(function (correo) {
    const u = permUsuario_(correo);
    resumen.miembros++;
    if (!u.activo) resumen.bajas++; else resumen.activos++;
    if (resumen.porRol[u.rol] !== undefined) resumen.porRol[u.rol]++;
  });

  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COTIZACIONES_SHEET_NAME);
    // getLastRow() no lee la hoja entera: es lo único que se puede permitir aquí,
    // porque la consola se abre a menudo y "Cotizaciones" es la hoja más grande.
    if (sheet) resumen.cotizaciones = Math.max(0, sheet.getLastRow() - 1);
  } catch (e) {}

  try { resumen.urlApp = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  try { resumen.zonaHoraria = Session.getScriptTimeZone() || ''; } catch (e) {}
  try { resumen.cuotaCorreo = MailApp.getRemainingDailyQuota(); } catch (e) {}

  return resumen;
}

// ── MIEMBROS ─────────────────────────────────────────────────────────────────

/**
 * Lista de miembros con su rol y sus bloques ya resueltos.
 * NUNCA incluye el hash de la contraseña: no hay ninguna pantalla que lo necesite
 * y todo lo que viaja al navegador acaba, tarde o temprano, en la consola de alguien.
 */
function consolaListaMiembros_() {
  const indice = secIndiceRegistros_();

  return Object.keys(indice).map(function (correo) {
    const fila = indice[correo];
    // La identidad sale de "Registros" y los permisos de la hoja oculta; permUsuario_
    // ya sabe juntar las dos cosas, así que la consola no repite esa lógica.
    const u = permUsuario_(correo);
    return {
      email: correo,
      nombre: u.nombre || fila.nombre || '',
      rol: u.rol,
      rolNombre: u.rolNombre,
      activo: u.activo,
      // 'heredado' avisa de que esta persona todavía no tiene rol guardado: el suyo
      // sale de la columna "Avanzado" de siempre.
      heredado: u.heredado === true,
      ajustes: u.ajustes,
      bloques: u.bloques,
      alta: (fila.alta instanceof Date) ? fila.alta.toISOString() : String(fila.alta || ''),
      fila: fila.fila || 0
    };
  }).sort(function (a, b) {
    // Primero por poder (maestros arriba), luego alfabético: es el orden en que se
    // busca a alguien cuando se entra a "¿quién tiene qué?".
    const pa = (PERM_ROLES[a.rol] || PERM_ROLES.normal).orden;
    const pb = (PERM_ROLES[b.rol] || PERM_ROLES.normal).orden;
    if (pa !== pb) return pb - pa;
    return (a.nombre || a.email).localeCompare(b.nombre || b.email, 'es');
  });
}

/** Lista de miembros para refrescar la tabla sin recargar toda la consola. */
function consolaMiembros(email) {
  try {
    const gate = consolaGate_(email, 'adm_miembros');
    if (!gate.ok) return consolaError_(gate.error);
    return { success: true, miembros: consolaListaMiembros_(), resumen: consolaResumen_() };
  } catch (e) {
    Logger.log('consolaMiembros error: ' + e);
    return consolaError_('No pudimos leer la lista de miembros. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Comprobaciones que impiden que la consola se cierre por dentro.
 * @return {string} mensaje de error, o '' si el cambio es seguro.
 */
function consolaCandados_(quien, objetivo, cambio) {
  const esYo = secNormalizarCorreo_(quien) === secNormalizarCorreo_(objetivo);
  const actual = permUsuario_(objetivo);

  if (!actual.encontrado) return 'El correo ' + objetivo + ' no está dado de alta.';

  // Sobre uno mismo: ni bajarse el rol ni darse de baja. No es paternalismo, es que
  // el maestro que se equivoca aquí ya no tiene desde dónde deshacerlo.
  if (esYo && cambio.rol && cambio.rol !== 'maestro') {
    return 'No puedes quitarte a ti mismo el rol maestro. Pídeselo a otro maestro.';
  }
  if (esYo && cambio.activo === false) {
    return 'No puedes darte de baja a ti mismo.';
  }

  // Sobre el último maestro: si se va, no queda nadie que pueda volver a nombrar a uno
  // y hay que abrir el editor de Apps Script para arreglarlo.
  const dejaDeSerMaestro = actual.maestro &&
    ((cambio.rol && cambio.rol !== 'maestro') || cambio.activo === false);
  if (dejaDeSerMaestro && permListaMaestros_().length <= 1) {
    return 'Es el único maestro del sistema. Nombra a otro antes de cambiar este.';
  }

  return '';
}

/**
 * Guarda el rol, los ajustes de permisos y el alta/baja de un miembro.
 *
 * @param {string} email    Correo de quien hace el cambio (sesión del portal).
 * @param {object} cambio   { email, rol, mas:[], menos:[], activo, nombre }
 *        Solo se aplican las llaves presentes: mandar {email, activo:false} da de baja
 *        sin tocar el rol ni los permisos.
 */
function consolaGuardarMiembro(email, cambio) {
  try {
    const gate = consolaGate_(email, 'adm_miembros');
    if (!gate.ok) return consolaError_(gate.error);

    const c = cambio || {};
    const objetivo = secNormalizarCorreo_(c.email);
    if (!objetivo) return consolaError_('Falta el correo del miembro que quieres cambiar.');

    // Cambiar permisos por bloque es un bloque distinto de cambiar el rol: se puede
    // tener un maestro que reparte accesos finos pero no reparte roles.
    const tocaPermisos = (c.mas !== undefined || c.menos !== undefined);
    if (tocaPermisos && (gate.bloques || []).indexOf('adm_permisos') === -1) {
      return consolaError_('Tu cuenta maestra no puede cambiar permisos por bloque.');
    }

    const rolPedido = (c.rol !== undefined && c.rol !== null && c.rol !== '')
      ? permNormalizarRol_(c.rol) : '';
    if (c.rol !== undefined && c.rol !== null && c.rol !== '' && !rolPedido) {
      return consolaError_('El rol "' + c.rol + '" no existe.');
    }

    const activoPedido = (c.activo === undefined || c.activo === null) ? undefined : (c.activo === true);

    const veto = consolaCandados_(gate.email, objetivo, { rol: rolPedido, activo: activoPedido });
    if (veto) return consolaError_(veto);

    const antes = permUsuario_(objetivo);
    const campos = {};
    const notas = [];

    if (rolPedido && rolPedido !== antes.rol) {
      campos[PERM_COL_ROL] = rolPedido;
      notas.push('rol ' + antes.rol + ' → ' + rolPedido);
    } else if (rolPedido && antes.heredado) {
      // Mismo rol, pero venía heredado de "Avanzado": se escribe para dejar de adivinar.
      campos[PERM_COL_ROL] = rolPedido;
    }

    if (tocaPermisos) {
      const ajustes = permLimpiarAjustes_({
        mas: c.mas !== undefined ? c.mas : antes.ajustes.mas,
        menos: c.menos !== undefined ? c.menos : antes.ajustes.menos
      });
      // Un bloque que ya viene con el rol no necesita concesión, y uno que el rol no da
      // no necesita retiro: guardarlos solo ensucia la celda y confunde al que la lea.
      const delRol = permBloquesDeRol_(rolPedido || antes.rol);
      ajustes.mas = ajustes.mas.filter(function (id) { return delRol.indexOf(id) === -1; });
      ajustes.menos = ajustes.menos.filter(function (id) { return delRol.indexOf(id) !== -1; });

      const nuevoTexto = permSerializarAjustes_(ajustes);
      if (nuevoTexto !== permSerializarAjustes_(antes.ajustes)) {
        campos[PERM_COL_PERMISOS] = nuevoTexto;
        notas.push('permisos +[' + (ajustes.mas.join(', ') || '—') + '] −[' + (ajustes.menos.join(', ') || '—') + ']');
      }
    }

    if (activoPedido !== undefined && activoPedido !== antes.activo) {
      campos[PERM_COL_ACTIVO] = activoPedido ? 'Si' : 'No';
      notas.push(activoPedido ? 'reactivado' : 'dado de baja');
    }

    if (c.nombre !== undefined && String(c.nombre).trim() && String(c.nombre).trim() !== antes.nombre) {
      campos['Nombre'] = String(c.nombre).trim();
      notas.push('nombre → ' + String(c.nombre).trim());
    }

    if (!Object.keys(campos).length) {
      return { success: true, sinCambios: true, message: 'No había nada que cambiar.',
               miembros: consolaListaMiembros_(), resumen: consolaResumen_() };
    }

    if (!permEscribirFila_(objetivo, campos)) {
      return consolaError_('No se encontró la fila de ' + objetivo + ' en "' + REGISTROS_SHEET_NAME + '".');
    }

    consolaBitacoraApuntar_(gate.email, 'Miembro modificado', objetivo, notas.join(' · '));

    return {
      success: true,
      message: 'Cambios guardados para ' + objetivo + '.',
      miembros: consolaListaMiembros_(),
      resumen: consolaResumen_()
    };
  } catch (e) {
    Logger.log('consolaGuardarMiembro error: ' + e + ' · ' + e.stack);
    return consolaError_('No pudimos guardar los cambios. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Alta directa de un miembro, sin el código de verificación por correo.
 *
 * Existe porque el alta normal (Cuentas.gs) la hace la propia persona y hay casos en
 * que no puede: alguien sin acceso todavía al correo corporativo, una cuenta de
 * pruebas, un alta masiva del primer día. La contraseña se genera aquí y se le manda
 * a esa persona; quien da el alta nunca la ve, para que "yo te creé la cuenta" no
 * signifique "yo puedo entrar como tú".
 *
 * @param {string} email  Correo de quien da el alta.
 * @param {object} datos  { nombre, email, rol, avisar }
 */
function consolaAltaMiembro(email, datos) {
  try {
    const gate = consolaGate_(email, 'adm_miembros');
    if (!gate.ok) return consolaError_(gate.error);

    const d = datos || {};
    const nombre = String(d.nombre || '').trim();
    const correo = secNormalizarCorreo_(d.email);
    const rol = permNormalizarRol_(d.rol) || 'normal';

    if (!nombre) return consolaError_('Escribe el nombre de la persona.');
    if (!secCorreoValido_(correo)) return consolaError_('El correo "' + d.email + '" no tiene forma de correo.');
    if (secBuscarRegistro_(correo).encontrado) return consolaError_('El correo ' + correo + ' ya está dado de alta.');

    // El dominio de la propiedad CUENTAS_DOMINIO se respeta también aquí: si no, la
    // consola sería el agujero por el que se cuelan las altas que el registro rechaza.
    const dominio = (typeof cuentasDominioPermitido_ === 'function') ? cuentasDominioPermitido_() : '';
    if (dominio && correo.split('@')[1] !== dominio) {
      return consolaError_('Solo se pueden dar de alta correos @' + dominio +
        '. Cambia el dominio permitido en Ajustes si necesitas otro.');
    }

    const temporal = consolaPasswordTemporal_();
    const alta = cuentasAltaUsuario_(nombre, correo, secHashContrasena_(temporal));
    if (!alta.success) return consolaError_(alta.message);

    // La temporal solo sirve para entrar una vez: al hacerlo, el sistema le pedirá a
    // esta persona que elija la suya (ver loginUser y establecerPasswordInicial).
    cuentasMarcarPasswordTemporal_(correo, true);

    if (rol !== 'normal') {
      const campos = {};
      campos[PERM_COL_ROL] = rol;
      campos[PERM_COL_ACTIVO] = 'Si';
      permEscribirFila_(correo, campos);
    }

    let avisoEnviado = false;
    let avisoError = '';
    if (d.avisar !== false) {
      try {
        consolaCorreoBienvenida_(correo, nombre, temporal, gate.nombre || gate.email);
        avisoEnviado = true;
      } catch (e) {
        avisoError = e.message;
        Logger.log('No se pudo enviar la bienvenida a ' + correo + ': ' + e);
      }
    }

    consolaBitacoraApuntar_(gate.email, 'Miembro dado de alta', correo, 'rol ' + rol +
      (avisoEnviado ? ' · aviso enviado' : ' · SIN aviso'));

    return {
      success: true,
      message: 'Se dio de alta a ' + nombre + '.',
      avisoEnviado: avisoEnviado,
      avisoError: avisoError,
      // La contraseña temporal solo se devuelve si el correo NO salió: es el único
      // caso en que alguien tiene que dictársela a mano.
      passwordTemporal: avisoEnviado ? '' : temporal,
      miembros: consolaListaMiembros_(),
      resumen: consolaResumen_()
    };
  } catch (e) {
    Logger.log('consolaAltaMiembro error: ' + e + ' · ' + e.stack);
    return consolaError_('No pudimos dar de alta a esa persona. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Restablece la contraseña de un miembro y se la manda por correo.
 * Sirve para el caso real: alguien perdió el acceso al correo o el flujo de
 * recuperación no le llega, y hay que desatascarlo hoy.
 */
function consolaResetPassword(email, correoObjetivo) {
  try {
    const gate = consolaGate_(email, 'adm_miembros');
    if (!gate.ok) return consolaError_(gate.error);

    const objetivo = secNormalizarCorreo_(correoObjetivo);
    const reg = secBuscarRegistro_(objetivo);
    if (!reg.encontrado) return consolaError_('El correo ' + objetivo + ' no está dado de alta.');

    const temporal = consolaPasswordTemporal_();
    if (!cuentasActualizarPassword_(objetivo, secHashContrasena_(temporal))) {
      return consolaError_('No se pudo escribir la contraseña nueva de ' + objetivo + '.');
    }
    // Igual que en el alta: al entrar con ella se le pedirá que elija la suya.
    cuentasMarcarPasswordTemporal_(objetivo, true);
    // Si estaba bloqueado por intentos fallidos, la contraseña nueva no le serviría
    // hasta que venciera el bloqueo. Se limpia para que pueda entrar de inmediato.
    secIntentosLimpiar_(objetivo);

    let avisoEnviado = false;
    let avisoError = '';
    try {
      consolaCorreoReset_(objetivo, reg.nombre, temporal, gate.nombre || gate.email);
      avisoEnviado = true;
    } catch (e) {
      avisoError = e.message;
      Logger.log('No se pudo enviar el restablecimiento a ' + objetivo + ': ' + e);
    }

    consolaBitacoraApuntar_(gate.email, 'Contraseña restablecida', objetivo,
      avisoEnviado ? 'aviso enviado' : 'SIN aviso: ' + avisoError);

    return {
      success: true,
      message: avisoEnviado
        ? 'Se le mandó una contraseña temporal a ' + objetivo + '.'
        : 'Contraseña restablecida, pero el correo no salió. Dictásela en persona.',
      avisoEnviado: avisoEnviado,
      passwordTemporal: avisoEnviado ? '' : temporal
    };
  } catch (e) {
    Logger.log('consolaResetPassword error: ' + e);
    return consolaError_('No pudimos restablecer la contraseña. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Borra la fila de un miembro. Es la única operación de este archivo que destruye
 * algo, así que pide que se teclee el correo completo como confirmación y se niega
 * en los tres casos en que el borrado sería un error caro.
 *
 * Para casi todo lo demás está la BAJA (activo = false), que quita el acceso sin
 * perder de vista quién hizo cada cotización vieja.
 */
function consolaEliminarMiembro(email, correoObjetivo, confirmacion) {
  try {
    const gate = consolaGate_(email, 'adm_miembros');
    if (!gate.ok) return consolaError_(gate.error);

    const objetivo = secNormalizarCorreo_(correoObjetivo);
    if (secNormalizarCorreo_(confirmacion) !== objetivo) {
      return consolaError_('Para borrar hay que escribir el correo completo tal cual.');
    }
    if (objetivo === secNormalizarCorreo_(gate.email)) {
      return consolaError_('No puedes borrarte a ti mismo.');
    }

    const u = permUsuario_(objetivo);
    if (!u.encontrado) return consolaError_('El correo ' + objetivo + ' no está dado de alta.');
    if (u.maestro) {
      return consolaError_('No se puede borrar a un maestro. Bájale el rol primero, y así queda claro que fue a propósito.');
    }

    const lock = LockService.getScriptLock();
    try { lock.waitLock(15000); } catch (e) {
      return consolaError_('El sistema está ocupado. Inténtalo de nuevo.');
    }
    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTROS_SHEET_NAME);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      const iEmail = headers.indexOf('Email');
      if (iEmail === -1) return consolaError_('La hoja no tiene columna "Email".');

      const correos = sheet.getRange(2, iEmail + 1, sheet.getLastRow() - 1, 1).getValues();
      for (let r = 0; r < correos.length; r++) {
        if (secNormalizarCorreo_(correos[r][0]) !== objetivo) continue;
        sheet.deleteRow(r + 2);
        SEC_REGISTROS_CACHE = null;
        // También su fila en la hoja oculta: si no, dar de alta ese mismo correo más
        // adelante lo resucitaría con los permisos que tenía antes de ser borrado.
        try { permBorrarPermisos_(objetivo); } catch (e) {
          Logger.log('No se pudo borrar la fila de permisos de ' + objetivo + ': ' + e);
        }
        consolaBitacoraApuntar_(gate.email, 'Miembro BORRADO', objetivo,
          'nombre "' + (u.nombre || '') + '", rol ' + u.rol);
        return { success: true, message: 'Se borró a ' + objetivo + '.',
                 miembros: consolaListaMiembros_(), resumen: consolaResumen_() };
      }
      return consolaError_('No se encontró la fila de ' + objetivo + '.');
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  } catch (e) {
    Logger.log('consolaEliminarMiembro error: ' + e);
    return consolaError_('No pudimos borrar a esa persona. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Contraseña temporal legible: sin caracteres que se confundan al dictarla por
 * teléfono (0/O, 1/l/I) y en tres bloques, que es como la gente los copia sin error.
 */
function consolaPasswordTemporal_() {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const numeros = '23456789';
  const trozo = function (fuente, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += fuente.charAt(Math.floor(Math.random() * fuente.length));
    return s;
  };
  return trozo(letras, 3) + '-' + trozo(numeros, 4) + '-' + trozo(letras, 3);
}

/** Correo de bienvenida con la contraseña temporal. */
function consolaCorreoBienvenida_(correo, nombre, temporal, quien) {
  const url = (typeof cuentasUrlApp_ === 'function') ? cuentasUrlApp_('login') : (getScriptUrl() || '');
  const cuerpo =
    cuentasMailP_('Hola ' + secEscapeHtml_(String(nombre || '').split(' ')[0] || '') +
      ', te crearon una cuenta en el sistema de cotizaciones Ventel.', 1) +
    cuentasMailP_('Entra con tu correo y esta contraseña temporal. Cámbiala en cuanto puedas desde ' +
      '“¿Olvidaste tu contraseña?”, para que sea tuya y de nadie más.', 2) +
    cuentasMailDatos_([
      ['Tu correo', correo],
      ['Contraseña temporal', temporal],
      ['Te dio de alta', quien || '']
    ]) +
    cuentasMailBoton_('Entrar al sistema', url) +
    cuentasMailNota_('Guárdala en un lugar seguro',
      'Esta contraseña llegó por correo, así que trátala como temporal de verdad: cámbiala hoy.', 'aviso');

  cuentasEnviarCorreo_(correo, 'Tu cuenta del sistema Ventel ya está lista',
    cuentasPlantillaCorreo_({
      titulo: 'Tu cuenta ya está lista',
      cuerpo: cuerpo,
      chip: 'Cuenta creada',
      tono: 'ok',
      preheader: 'Contraseña temporal: ' + temporal
    }),
    'Tu cuenta del sistema Ventel ya está lista.\nCorreo: ' + correo +
    '\nContraseña temporal: ' + temporal + '\nEntra en: ' + url);
}

/** Correo de contraseña restablecida por un administrador. */
function consolaCorreoReset_(correo, nombre, temporal, quien) {
  const url = (typeof cuentasUrlApp_ === 'function') ? cuentasUrlApp_('login') : (getScriptUrl() || '');
  const cuerpo =
    cuentasMailP_('Hola ' + secEscapeHtml_(String(nombre || '').split(' ')[0] || '') +
      ', un administrador restableció la contraseña de tu cuenta.', 1) +
    cuentasMailP_('Entra con esta contraseña temporal y cámbiala enseguida.', 2) +
    cuentasMailDatos_([
      ['Tu correo', correo],
      ['Contraseña temporal', temporal],
      ['Lo hizo', quien || '']
    ]) +
    cuentasMailBoton_('Entrar y cambiarla', url) +
    cuentasMailNota_('¿No lo pediste?',
      'Avisa de inmediato al equipo del sistema: alguien con acceso de administrador cambió tu contraseña.', 'alerta');

  cuentasEnviarCorreo_(correo, 'Se restableció la contraseña de tu cuenta Ventel',
    cuentasPlantillaCorreo_({
      titulo: 'Contraseña restablecida',
      cuerpo: cuerpo,
      chip: 'Seguridad',
      tono: 'aviso',
      preheader: 'Contraseña temporal: ' + temporal
    }),
    'Se restableció tu contraseña del sistema Ventel.\nContraseña temporal: ' + temporal +
    '\nEntra en: ' + url);
}

// ── AJUSTES DEL SISTEMA ──────────────────────────────────────────────────────

/**
 * Lee los ajustes con su valor actual. Los secretos NO viajan: de ellos solo se dice
 * si están puestos y cuántos caracteres miden, que es lo único que hace falta para
 * saber si hay que configurarlos.
 */
function consolaLeerAjustes_() {
  const props = PropertiesService.getScriptProperties();

  return CONSOLA_AJUSTES.map(function (a) {
    const enPropiedades = props.getProperty(a.clave);
    // secConfig_ es quien decide de verdad: propiedad si existe, si no la constante
    // del código. Se muestra el mismo valor que usa el sistema, no el de la propiedad.
    const efectivo = secConfig_(a.clave, consolaRespaldoEnCodigo_(a.clave));
    const salida = {
      clave: a.clave, nombre: a.nombre, detalle: a.detalle, grupo: a.grupo, tipo: a.tipo,
      opciones: a.opciones || null, marcador: a.marcador || '',
      secreto: a.secreto === true, soloLectura: a.soloLectura === true,
      // 'enCodigo' avisa de un secreto que todavía vive en el archivo fuente en vez
      // de en las propiedades del script: es una observación de seguridad, no un error.
      enPropiedades: enPropiedades !== null && enPropiedades !== '',
      enCodigo: (enPropiedades === null || enPropiedades === '') && !!efectivo,
      configurado: !!efectivo
    };
    salida.valor = a.secreto ? '' : String(efectivo || '');
    salida.pista = a.secreto && efectivo ? ('configurado · ' + String(efectivo).length + ' caracteres') : '';
    return salida;
  });
}

/** Valor de respaldo que vive en el código fuente, cuando existe. */
function consolaRespaldoEnCodigo_(clave) {
  switch (clave) {
    case 'HASH_SALT':               return typeof HASH_SALT === 'string' ? HASH_SALT : '';
    case 'WEBHOOK_URL':             return typeof WEBHOOK_URL === 'string' ? WEBHOOK_URL : '';
    case 'OPERACION_WEBHOOK_ESTADO':
      return typeof OPERACION_WEBHOOK_ESTADO === 'string' ? OPERACION_WEBHOOK_ESTADO : '';
    case 'OPERACION_WEBHOOK_REPORTES':
      return typeof OPERACION_WEBHOOK_REPORTES === 'string' ? OPERACION_WEBHOOK_REPORTES : '';
    case 'PORTAL_SHEET_ID':         return typeof PORTAL_SHEET_ID === 'string' ? PORTAL_SHEET_ID : '';
    case 'CCL_TEMPLATE_SHEET_ID':   return typeof CCL_TEMPLATE_SHEET_ID === 'string' ? CCL_TEMPLATE_SHEET_ID : '';
    case 'PORTAL_CALENDAR_ID':      return typeof PORTAL_CALENDAR_ID === 'string' ? PORTAL_CALENDAR_ID : '';
    case 'CUENTAS_DOMINIO':         return typeof CUENTAS_DOMINIO_RESPALDO === 'string' ? CUENTAS_DOMINIO_RESPALDO : '';
    case 'AUTH_MODO':               return 'portal';
    default:                        return '';
  }
}

/** Lee los ajustes (llamada suelta, para refrescar sin recargar la consola). */
function consolaAjustes(email) {
  try {
    const gate = consolaGate_(email, 'adm_ajustes');
    if (!gate.ok) return consolaError_(gate.error);
    return { success: true, ajustes: consolaLeerAjustes_(), grupos: CONSOLA_GRUPOS_AJUSTES.slice() };
  } catch (e) {
    return consolaError_('No pudimos leer los ajustes. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Guarda UN ajuste. De uno en uno a propósito: cada uno se valida contra el servicio
 * al que apunta —se abre la hoja, se busca el calendario— y un guardado en bloque
 * dejaría a medias los que sí valían cuando uno falla.
 */
function consolaGuardarAjuste(email, clave, valor) {
  try {
    const gate = consolaGate_(email, 'adm_ajustes');
    if (!gate.ok) return consolaError_(gate.error);

    const def = CONSOLA_AJUSTES.filter(function (a) { return a.clave === clave; })[0];
    if (!def) return consolaError_('El ajuste "' + clave + '" no existe.');
    if (def.soloLectura) return consolaError_('"' + def.nombre + '" no se puede cambiar desde aquí.');

    const nuevo = String(valor == null ? '' : valor).trim();
    const validacion = consolaValidarAjuste_(def, nuevo);
    if (!validacion.ok) return consolaError_(validacion.error);

    const props = PropertiesService.getScriptProperties();
    const antes = secConfig_(clave, consolaRespaldoEnCodigo_(clave));

    if (validacion.valor === '') props.deleteProperty(clave);
    else props.setProperty(clave, validacion.valor);

    // Un cambio de fuente de datos deja obsoleto todo lo que había en caché: sin
    // esto, el portal seguiría sirviendo los datos de la hoja anterior hasta diez
    // minutos, y parecería que el ajuste "no se guardó".
    if (clave === 'PORTAL_SHEET_ID') {
      try { CacheService.getScriptCache().remove('toolsData_v1'); } catch (e) {}
      try { if (typeof portalInvalidarCacheAnuncios_ === 'function') portalInvalidarCacheAnuncios_(); } catch (e) {}
    }
    if (clave === 'TRAZ_SHEET_ID') {
      try { if (typeof trazInvalidarCache === 'function') trazInvalidarCache(); } catch (e) {}
    }

    consolaBitacoraApuntar_(gate.email, 'Ajuste cambiado', def.nombre,
      def.secreto ? '(valor oculto)' : ('"' + antes + '" → "' + validacion.valor + '"'));

    return {
      success: true,
      message: '"' + def.nombre + '" guardado.',
      aviso: validacion.aviso || '',
      ajustes: consolaLeerAjustes_()
    };
  } catch (e) {
    Logger.log('consolaGuardarAjuste error: ' + e);
    return consolaError_('No pudimos guardar el ajuste. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Saca el host de una URL https.
 *
 * Apps Script NO tiene el objeto `URL` del navegador —es V8 pelado, no Node ni
 * Chrome—, así que aquí se parsea a mano y de forma deliberadamente estrecha: solo
 * https, host explícito y ninguna de las formas que sirven para disfrazar un
 * destino (credenciales antes de la @, host vacío). Lo que no encaje devuelve ''
 * y el llamador lo rechaza; es preferible rechazar una URL rara a que el servidor
 * acabe visitando algo que no era lo que parecía.
 *
 * @return {string} host en minúsculas, o '' si la URL no es aceptable.
 */
function consolaHostDeUrl_(url) {
  const texto = String(url || '').trim();
  // https://HOST[:puerto][/resto] — la @ queda fuera del juego de caracteres del
  // host a propósito, para que "https://chat.googleapis.com@malicioso.com/" no cuele.
  const m = /^https:\/\/([A-Za-z0-9.-]+)(?::\d+)?(?:[\/?#]|$)/.exec(texto);
  if (!m) return '';
  const host = m[1].toLowerCase();
  if (!host || host.indexOf('.') === -1 || host.charAt(host.length - 1) === '.') return '';
  return host;
}

/**
 * Comprueba que un valor sirve ANTES de guardarlo. Un identificador de hoja mal
 * tecleado no da error al guardarse: da error media hora después, cuando alguien
 * intenta cotizar y el portal aparece vacío.
 *
 * @return {{ok:boolean, valor:string, error:string, aviso:string}}
 */
function consolaValidarAjuste_(def, valor) {
  const bien = function (v, aviso) { return { ok: true, valor: v, error: '', aviso: aviso || '' }; };
  const mal = function (mensaje) { return { ok: false, valor: '', error: mensaje, aviso: '' }; };

  if (def.tipo === 'opcion') {
    const validas = (def.opciones || []).map(function (o) { return o.valor; });
    if (validas.indexOf(valor) === -1) return mal('"' + valor + '" no es una opción válida.');
    return bien(valor);
  }

  if (def.clave === 'CUENTAS_DOMINIO') {
    if (!valor || valor.toLowerCase() === 'ninguno') {
      return bien('ninguno', 'Sin restricción de dominio: cualquier correo podrá crearse una cuenta.');
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(valor)) return mal('"' + valor + '" no parece un dominio.');
    return bien(valor.toLowerCase());
  }

  // Vale para CUALQUIER webhook, no solo el de cotizaciones: cada uno nuevo que se añada
  // al catálogo con `webhook: true` hereda la misma validación de host sin tocar nada aquí.
  // Antes esto miraba la clave exacta, y el segundo webhook habría entrado sin comprobar.
  if (def.webhook) {
    if (!valor) {
      return bien('', {
        'WEBHOOK_URL': 'Sin webhook: dejarán de llegar los avisos de cotización nueva.',
        'OPERACION_WEBHOOK_ESTADO': 'Sin webhook: el equipo dejará de recibir los avisos de caídas y restablecimientos.',
        'OPERACION_WEBHOOK_REPORTES': 'Apagado: los reportes se seguirán guardando, pero no se anunciará ninguno.'
      }[def.clave] || 'Sin webhook: no se mandará nada.');
    }
    const host = consolaHostDeUrl_(valor);
    if (!host) {
      return mal('Eso no es una URL completa. Pega la que te da Google Chat, empezando por https://');
    }
    if (CONSOLA_WEBHOOK_HOSTS.indexOf(host) === -1) {
      return mal('El webhook solo puede apuntar a ' + CONSOLA_WEBHOOK_HOSTS.join(' o ') +
        '. Recibido: ' + host);
    }
    return bien(valor);
  }

  if (def.tipo === 'id_hoja') {
    if (!valor) return bien('', 'Sin identificador: se usará el que quede escrito en el código.');
    if (!/^[A-Za-z0-9_-]{20,}$/.test(valor)) {
      return mal('Eso no parece un identificador de hoja. Es el trozo largo de la URL, entre /d/ y /edit.');
    }
    try {
      const ss = SpreadsheetApp.openById(valor);
      return bien(valor, 'Hoja encontrada: "' + ss.getName() + '".');
    } catch (e) {
      return mal('No se pudo abrir esa hoja. Comprueba que esté compartida con la cuenta que ejecuta el sistema.');
    }
  }

  if (def.tipo === 'id_calendario') {
    if (!valor) return bien('', 'Sin calendario: el monitor de promociones se quedará vacío.');
    try {
      const cal = CalendarApp.getCalendarById(valor);
      if (!cal) return mal('No se encontró ese calendario, o no está compartido con la cuenta que ejecuta el sistema.');
      return bien(valor, 'Calendario encontrado: "' + cal.getName() + '".');
    } catch (e) {
      return mal('No se pudo abrir ese calendario: ' + e.message);
    }
  }

  if (def.tipo === 'id_carpeta') {
    if (!valor) return bien('', 'Sin carpeta: las imágenes de anuncios irán a donde el código decida.');
    try {
      const folder = DriveApp.getFolderById(valor);
      return bien(valor, 'Carpeta encontrada: "' + folder.getName() + '".');
    } catch (e) {
      return mal('No se pudo abrir esa carpeta de Drive. Comprueba el identificador y los permisos.');
    }
  }

  return bien(valor);
}

// ── MÓDULOS (mantenimiento) ──────────────────────────────────────────────────

/**
 * Apaga o enciende un bloque para TODO el mundo. Es la palanca para cuando algo se
 * rompe: en vez de quitarle el permiso a cincuenta personas una por una, se apaga el
 * módulo, se arregla, y se vuelve a encender.
 *
 * El maestro conserva el acceso a lo apagado —si no, no podría comprobar el arreglo—
 * y los bloques marcados como `fijo` no se pueden apagar: dejar el portal o la propia
 * consola fuera de servicio no tendría vuelta atrás desde la pantalla.
 */
function consolaGuardarModulo(email, bloqueId, apagado) {
  try {
    const gate = consolaGate_(email, 'adm_modulos');
    if (!gate.ok) return consolaError_(gate.error);

    const bloque = permBloque_(bloqueId);
    if (!bloque) return consolaError_('El módulo "' + bloqueId + '" no existe.');
    if (bloque.fijo) return consolaError_('"' + bloque.nombre + '" no se puede apagar: la app se quedaría sin puerta de entrada.');

    const actuales = permModulosApagados_();
    const quiereApagar = apagado === true;
    const yaEsta = actuales.indexOf(bloqueId) !== -1;
    if (quiereApagar === yaEsta) {
      return { success: true, sinCambios: true, apagados: actuales, catalogo: permCatalogo_() };
    }

    const nuevos = quiereApagar
      ? actuales.concat([bloqueId])
      : actuales.filter(function (id) { return id !== bloqueId; });

    const guardados = permFijarModulosApagados_(nuevos);
    consolaBitacoraApuntar_(gate.email, quiereApagar ? 'Módulo apagado' : 'Módulo encendido',
      bloque.nombre, quiereApagar ? 'en mantenimiento para todos menos los maestros' : 'de vuelta en servicio');

    return {
      success: true,
      message: '"' + bloque.nombre + '" ' + (quiereApagar ? 'quedó en mantenimiento.' : 'volvió a estar disponible.'),
      apagados: guardados,
      catalogo: permCatalogo_(),
      miembros: consolaListaMiembros_()
    };
  } catch (e) {
    Logger.log('consolaGuardarModulo error: ' + e);
    return consolaError_('No pudimos cambiar el módulo. Inténtalo de nuevo en un momento.');
  }
}

// ── FORMATOS DE COTIZACIÓN ───────────────────────────────────────────────────

/** Formatos con su estado, reutilizando el catálogo que ya vive en Formatos.gs. */
function consolaLeerFormatos_(correo) {
  try {
    const r = getFormatSettings(correo);
    return r && r.success ? r.formats : [];
  } catch (e) {
    Logger.log('consolaLeerFormatos_ error: ' + e);
    return [];
  }
}

function consolaGuardarFormato(email, formatId, habilitado) {
  try {
    const gate = consolaGate_(email, 'adm_formatos');
    if (!gate.ok) return consolaError_(gate.error);

    const r = setQuoteFormatEnabled(gate.email, formatId, habilitado === true);
    if (!r || !r.success) return consolaError_((r && r.message) || 'No se pudo guardar el formato.');

    consolaBitacoraApuntar_(gate.email, habilitado ? 'Formato habilitado' : 'Formato deshabilitado', formatId, '');
    return { success: true, message: 'Formatos actualizados.', formatos: r.formats };
  } catch (e) {
    Logger.log('consolaGuardarFormato error: ' + e);
    return consolaError_('No pudimos guardar el formato. Inténtalo de nuevo en un momento.');
  }
}

// ── SALUD Y BITÁCORA ─────────────────────────────────────────────────────────

/**
 * Corre la revisión maestra completa (Admin.gs) y la devuelve para pintarla.
 * Tarda: toca hojas, Drive, Gmail y calendario a propósito, porque de eso se trata.
 */
function consolaSalud(email) {
  try {
    const gate = consolaGate_(email, 'adm_salud');
    if (!gate.ok) return consolaError_(gate.error);

    const reporte = revisionMaestra();
    const fallos = (reporte.checks || []).filter(function (c) { return !c.ok; }).length;
    consolaBitacoraApuntar_(gate.email, 'Revisión del sistema', '',
      fallos ? fallos + ' problema(s)' : 'todo en orden');

    return { success: true, reporte: reporte };
  } catch (e) {
    Logger.log('consolaSalud error: ' + e);
    return consolaError_('No pudimos correr la revisión. Inténtalo de nuevo en un momento.');
  }
}

function consolaBitacora(email, limite) {
  try {
    const gate = consolaGate_(email, 'adm_bitacora');
    if (!gate.ok) return consolaError_(gate.error);
    return { success: true, bitacora: consolaBitacoraLeer_(Number(limite) || CONSOLA_BITACORA_LIMITE) };
  } catch (e) {
    return consolaError_('No pudimos leer la bitácora. Inténtalo de nuevo en un momento.');
  }
}

// ── DIAGNÓSTICO (desde el editor) ────────────────────────────────────────────

/**
 * Comprueba que la consola puede funcionar: que hay maestro, que la bitácora se
 * puede escribir y que los ajustes se leen. Ejecutar desde el editor.
 */
function consolaDiagnostico() {
  Logger.log('═══ CONSOLA MAESTRA ═══');

  const maestros = permListaMaestros_();
  Logger.log('Maestros: ' + (maestros.length ? maestros.join(', ') : 'NINGUNO'));
  if (!maestros.length) {
    Logger.log('  → Ejecuta permSembrarMaestro("tu.correo@dominio.com") para nombrar al primero.');
  }

  try {
    const hoja = consolaBitacoraHoja_();
    Logger.log('Bitácora: hoja "' + hoja.getName() + '" con ' + Math.max(0, hoja.getLastRow() - 1) + ' movimientos.');
  } catch (e) {
    Logger.log('Bitácora: ✖ ' + e.message);
  }

  Logger.log('── Ajustes ──');
  consolaLeerAjustes_().forEach(function (a) {
    const estado = a.configurado
      ? (a.enPropiedades ? 'en propiedades' : 'EN EL CÓDIGO (conviene moverlo)')
      : 'sin configurar';
    Logger.log('  ' + a.nombre + ' → ' + (a.secreto ? a.pista || '(vacío)' : (a.valor || '(vacío)')) + ' · ' + estado);
  });

  const off = permModulosApagados_();
  Logger.log('Módulos apagados: ' + (off.length ? off.join(', ') : 'ninguno'));
  Logger.log('Miembros: ' + consolaListaMiembros_().length);
  return { maestros: maestros, apagados: off };
}
