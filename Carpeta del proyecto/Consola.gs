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
//   tipo        'opcion' | 'texto' | 'secreto' | 'correo' | 'lista_correos' |
//               'id_hoja' | 'id_calendario' | 'id_carpeta'
//   secreto     true = su valor nunca viaja al cliente; solo se dice si está puesto.
//   soloLectura true = se muestra pero no se guarda desde la consola.
//   soloMaestro true = ni siquiera con el bloque 'adm_ajustes'; hace falta ser maestro.

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
    clave: 'MAIL_ALIAS', nombre: 'Remitente de las cotizaciones', grupo: 'Correo',
    detalle: 'Alias «Enviar como» con el que salen las cotizaciones y los avisos del sistema. ' +
             'Tiene que estar dado de alta en la cuenta de Gmail que ejecuta el sistema; si no lo está, ' +
             'el correo sale igual desde esa cuenta y solo se pierde el remitente bonito.',
    tipo: 'correo', marcador: 'ventel@liverpool.com.mx'
  },
  {
    clave: 'CC_SENDER_NAME', nombre: 'Nombre visible en los correos a clientes', grupo: 'Correo',
    detalle: 'Cómo ve el cliente al remitente en su bandeja: "Ventel Liverpool", no la dirección.',
    tipo: 'texto', marcador: 'Ventel Liverpool'
  },
  {
    // Solo maestro, y esa marca hace un trabajo que hoy parece de más: consolaGate_ ya exige el
    // rol maestro para CUALQUIER ajuste, así que ahora mismo es redundante. Se declara igual
    // porque la consola lleva un año abriéndose a más perfiles —Roles y Bitácora ya son de
    // supervisión— y el día que Ajustes siga ese camino, «quién recibe copia de todo el correo
    // del sistema» no puede irse con el resto del grupo sin que nadie lo note.
    clave: 'CORREO_CCO_GLOBAL', nombre: 'Copia oculta global', grupo: 'Correo',
    detalle: 'Buzón que recibe copia oculta de todo lo que el sistema manda: cotizaciones, plantillas ' +
             'a cliente y avisos. Varios, separados por coma. Los correos de SEGURIDAD —contraseñas ' +
             'temporales y códigos de verificación— nunca se copian, y eso no es configurable.',
    // `opcional`: no tenerlo puesto NO es un pendiente. Sin esto, una instalación que decide
    // legítimamente no usar copia oculta se comía un «está sin configurar» en el resumen cada
    // vez que abría la consola, sin forma de quitarlo salvo configurando algo que no quiere.
    tipo: 'lista_correos', soloMaestro: true, opcional: true, marcador: 'monitoreo@liverpool.com.mx'
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
const CONSOLA_GRUPOS_AJUSTES = ['Identidad', 'Correo', 'Avisos', 'Fuentes de datos'];

/**
 * Configuraciones que YA tienen su pantalla y que desde Ajustes solo se enlazan (T9.7).
 *
 * La tentación era traérselas aquí para que «todo esté en un sitio». Sería una copia: dos
 * pantallas que escriben lo mismo acaban discrepando, y la que se quede sin mantenimiento es
 * la que alguien usará el día que importe. Se enlazan, que es la otra forma de que todo esté
 * en un sitio: desde Ajustes se ve QUE existen y se llega de un clic.
 *
 *   panel   pestaña de esta misma consola.
 *   pagina  pantalla de la app (clave de PAGES), para las que viven fuera.
 */
const CONSOLA_AJUSTES_ENLACES = [
  { nombre: 'Formatos de cotización', detalle: 'Qué formatos se pueden usar y cuál sale por defecto.',
    panel: 'formatos', bloque: 'adm_formatos' },
  { nombre: 'Política de revisión', detalle: 'Las reglas que mandan una cotización a revisión: montos, descuentos y excepciones.',
    pagina: 'revision_cotizacion', bloque: 'politica_revision' },
  { nombre: 'Módulos en mantenimiento', detalle: 'Apagar y encender bloques enteros mientras se arregla algo.',
    panel: 'modulos', bloque: 'adm_modulos' }
];

/** Hosts a los que se permite apuntar el webhook. Un webhook es una URL que el SERVIDOR
 *  visita: dejarlo libre convertiría la consola en un trampolín para alcanzar cualquier
 *  cosa que este proyecto pueda ver desde dentro de Google. */
const CONSOLA_WEBHOOK_HOSTS = ['chat.googleapis.com'];

/** Hoja donde se apunta cada cambio hecho desde la consola. */
const CONSOLA_BITACORA_SHEET = 'BitacoraConsola';
const CONSOLA_BITACORA_COLUMNAS = ['Fecha', 'Quien', 'Accion', 'Objetivo', 'Detalle'];

/** Cuántos renglones de bitácora se mandan a la pantalla. */
const CONSOLA_BITACORA_LIMITE = 150;

/** Tope de la consulta por fechas: hasta aquí llega una descarga, y se avisa si se corta. */
const CONSOLA_BITACORA_TOPE_RANGO = 2000;

/** Filas que se leen de golpe al recorrer la hoja hacia atrás en la consulta por fechas. */
const CONSOLA_BITACORA_LOTE = 800;

/**
 * Techo duro de filas leídas por consulta, pase lo que pase.
 *
 * Sin esto, pedir «enero del año pasado» sobre una bitácora de sesenta mil apuntes recorría la
 * hoja entera hacia atrás: el corte por «lote entero anterior al rango» solo salta cuando se
 * LLEGA al periodo, y hasta entonces cada lote trae fechas posteriores y el bucle sigue. Con el
 * techo, la consulta contesta lo que alcanzó a leer y lo dice en vez de tardar dos minutos.
 */
const CONSOLA_BITACORA_MAX_LEIDAS = 12000;

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
function consolaBitacoraLeer_(limite, quien) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSOLA_BITACORA_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const esMaestro = !!(quien && quien.maestro === true);
    const pedidos = limite || CONSOLA_BITACORA_LIMITE;

    // Al filtrar se leen MÁS filas de las pedidas, porque muchas se van a descartar.
    // Sin este margen, un supervisor cuyos últimos apuntes están enterrados bajo
    // cincuenta cambios de ajustes de un maestro veía una bitácora vacía y concluía,
    // razonablemente, que sus cambios no se habían guardado. El tope evita que el
    // margen se convierta en leer la hoja entera.
    const aLeer = esMaestro ? pedidos : Math.min(pedidos * 6, CONSOLA_BITACORA_LIMITE * 4);
    const total = sheet.getLastRow() - 1;
    const cuantos = Math.min(total, aLeer);
    const desde = sheet.getLastRow() - cuantos + 1;
    const datos = sheet.getRange(desde, 1, cuantos, CONSOLA_BITACORA_COLUMNAS.length).getValues();

    const filas = datos.map(function (f) {
      return {
        fecha: f[0] instanceof Date ? f[0].toISOString() : String(f[0] || ''),
        quien: String(f[1] || ''),
        accion: String(f[2] || ''),
        objetivo: String(f[3] || ''),
        detalle: String(f[4] || '')
      };
    }).reverse();

    if (esMaestro) return filas.slice(0, pedidos);
    return filas.filter(consolaBitacoraFiltro_(quien)).slice(0, pedidos);
  } catch (e) {
    Logger.log('consolaBitacoraLeer_ error: ' + e);
    return [];
  }
}

/**
 * El recorte jerárquico de la bitácora, en UNA sola función.
 *
 * Un supervisor ve su propio rastro y el de la gente a la que alcanza. No ve los cambios de
 * ajustes, módulos ni salud —no son suyos y describen la instalación—, ni nada que le hayan
 * hecho a alguien por encima de su nivel. La bitácora sigue siendo completa en la hoja: lo
 * que se recorta es quién la lee.
 *
 * Vive aparte porque la leen dos caminos —los últimos movimientos y la consulta por fechas—
 * y una regla de seguridad copiada en dos sitios es una regla que un día solo se corrige en
 * uno. Devuelve un predicado ya cerrado sobre el nivel de quien pregunta.
 */
function consolaBitacoraFiltro_(quien) {
  const miNivel = permNivelUsuario_(quien);
  const yo = (quien && quien.email) || '';
  return function (r) {
    if (permMismoCorreo_(r.quien, yo)) return true;
    if (!r.objetivo) return false;   // apunte del sistema, no de una persona
    const u = permUsuario_(r.objetivo);
    if (!u.encontrado) return false;
    return permNivelUsuario_(u) <= miNivel;
  };
}

/**
 * Interpreta las dos fechas que manda la pantalla (yyyy-MM-dd, las de un <input type="date">)
 * como el DÍA COMPLETO en la zona horaria del script.
 *
 * Es lo que la gente quiere decir: «del 1 al 5» incluye todo el día 5. Tomar las fechas como
 * medianoche a secas dejaría fuera el último día entero y produciría el clásico «faltan los
 * cambios de hoy» que nadie sabe explicar.
 *
 * @return {{ok:boolean, desde:Date, hasta:Date, error:string}}
 */
function consolaRangoFechas_(desde, hasta) {
  const partes = function (texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto || '').trim());
    return m ? { a: Number(m[1]), me: Number(m[2]), d: Number(m[3]) } : null;
  };
  const a = partes(desde), b = partes(hasta);
  if (!a || !b) return { ok: false, error: 'Elige las dos fechas del rango.' };

  const ini = new Date(a.a, a.me - 1, a.d, 0, 0, 0, 0);
  const fin = new Date(b.a, b.me - 1, b.d, 23, 59, 59, 999);
  if (isNaN(ini.getTime()) || isNaN(fin.getTime())) return { ok: false, error: 'Esas fechas no son válidas.' };
  if (ini > fin) return { ok: false, error: 'La fecha de inicio es posterior a la de fin.' };
  return { ok: true, desde: ini, hasta: fin, error: '' };
}

/**
 * Movimientos entre dos fechas, del más reciente al más viejo.
 *
 * Se lee DESDE EL FINAL y por lotes, igual que consolaBitacoraLeer_ y por el mismo motivo: la
 * hoja crece sin tope y nadie la vacía nunca, así que leerla entera para enseñar una semana
 * sería cada mes un poco más lento hasta agotar el tiempo de ejecución. Al encontrar el primer
 * lote entero por debajo del rango se para: la hoja está en orden de escritura, de modo que
 * más atrás solo hay cosas aún más viejas.
 */
function consolaBitacoraEnRango_(desde, hasta, quien) {
  const vacio = { filas: [], truncado: false, leidas: 0 };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSOLA_BITACORA_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return vacio;

  const esMaestro = !!(quien && quien.maestro === true);
  const visible = esMaestro ? function () { return true; } : consolaBitacoraFiltro_(quien);

  let fin = sheet.getLastRow();   // última fila del lote que toca leer
  let leidas = 0, truncado = false;
  const out = [];

  while (fin >= 2 && !truncado) {
    const ini = Math.max(2, fin - CONSOLA_BITACORA_LOTE + 1);
    const datos = sheet.getRange(ini, 1, fin - ini + 1, CONSOLA_BITACORA_COLUMNAS.length).getValues();
    leidas += datos.length;

    // Se cuenta en vez de levantar una bandera: un lote entero con la fecha ilegible no
    // puede detener el recorrido y esconder lo que hay más atrás. Ver Monitoreo.gs.
    let conFecha = 0, anteriores = 0;
    for (let i = datos.length - 1; i >= 0; i--) {
      const f = datos[i];
      const cuando = (f[0] instanceof Date) ? f[0] : new Date(f[0]);
      if (isNaN(cuando.getTime())) continue;
      conFecha++;
      if (cuando < desde) anteriores++;
      if (cuando < desde || cuando > hasta) continue;

      const fila = {
        fecha: cuando.toISOString(),
        quien: String(f[1] || ''),
        accion: String(f[2] || ''),
        objetivo: String(f[3] || ''),
        detalle: String(f[4] || '')
      };
      if (!visible(fila)) continue;
      if (out.length >= CONSOLA_BITACORA_TOPE_RANGO) { truncado = true; break; }
      out.push(fila);
    }

    if (conFecha > 0 && anteriores === conFecha) break;   // lote entero anterior: más atrás, peor
    if (leidas >= CONSOLA_BITACORA_MAX_LEIDAS) { truncado = true; break; }
    fin = ini - 1;
  }

  return { filas: out, truncado: truncado, leidas: leidas,
           // true = se paró por el techo sin haber llegado al periodo: no es que no haya nada,
           // es que está más atrás de lo que se puede leer de una vez.
           sinLlegar: truncado && out.length === 0 };
}

function consolaBitacoraRango(email, desde, hasta) {
  try {
    const acc = consolaAcceso_(email, 'bitacora');
    if (!acc.ok) return consolaError_(acc.error);

    const rango = consolaRangoFechas_(desde, hasta);
    if (!rango.ok) return consolaError_(rango.error);

    const r = consolaBitacoraEnRango_(rango.desde, rango.hasta, acc.usuario);
    return {
      success: true,
      bitacora: r.filas,
      truncado: r.truncado,
      sinLlegar: r.sinLlegar === true,
      leidas: r.leidas,
      // Se devuelven las fechas ya resueltas para que el nombre del CSV y el rótulo de la
      // pantalla digan exactamente el rango que se consultó, no el que se tecleó.
      desde: rango.desde.toISOString(),
      hasta: rango.hasta.toISOString()
    };
  } catch (e) {
    Logger.log('consolaBitacoraRango error: ' + e);
    return consolaError_('No pudimos leer la bitácora de esas fechas. Inténtalo de nuevo en un momento.');
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

// ── ACCESO A LA CONSOLA (maestros Y supervisores) ────────────────────────────
//
// La consola dejó de ser "la pantalla del maestro" para ser LA pantalla donde se
// gestionan roles, y por ahí entran ahora dos perfiles muy distintos:
//
//   maestro     todas las secciones, alcance sobre todo el sistema.
//   supervisor  SOLO Roles y Bitácora, y dentro de ellas solo su nivel hacia abajo.
//
// Se resuelve con una tabla de secciones en vez de con `if (esMaestro)` repartidos por
// el archivo. Cuando mañana haya un tercer perfil —o una sección nueva— se toca una
// fila de esta tabla y no diez condicionales que hay que encontrar primero.
//
// Cada sección declara los bloques que la abren, en OR: basta tener uno. Roles y
// Bitácora aceptan tanto la llave maestra como 'sup_equipo', y ahí es donde los dos
// perfiles se juntan sin que la pantalla tenga que saber cuál de los dos eres.

const CONSOLA_SECCIONES = [
  { id: 'resumen',  nombre: 'Resumen',  bloques: [] },   // [] = cualquiera que entre
  { id: 'roles',    nombre: 'Roles',    bloques: ['adm_miembros', 'adm_permisos', 'sup_equipo'] },
  { id: 'modulos',  nombre: 'Módulos',  bloques: ['adm_modulos'] },
  { id: 'ajustes',  nombre: 'Ajustes',  bloques: ['adm_ajustes'] },
  { id: 'formatos', nombre: 'Formatos', bloques: ['adm_formatos'] },
  { id: 'salud',    nombre: 'Salud',    bloques: ['adm_salud'] },
  { id: 'bitacora', nombre: 'Bitácora', bloques: ['adm_bitacora', 'sup_equipo'] },
  // Métricas es la primera sección que abre un bloque de SUPERVISIÓN y no uno de
  // administración: un supervisor entra con 'metricas' y ve su alcance jerárquico; el maestro
  // lo ve todo. El recorte no lo hace esta tabla —solo dice quién pasa—, sino cada consulta
  // de Monitoreo.gs, que es donde se sabe de quién es cada fila.
  { id: 'metricas', nombre: 'Métricas', bloques: ['metricas'] }
];

/** ¿Alguno de los bloques que abren esta sección está entre los de la persona? */
function consolaSeccionAbierta_(seccion, bloques) {
  if (!seccion.bloques.length) return true;
  return seccion.bloques.some(function (b) { return (bloques || []).indexOf(b) !== -1; });
}

/**
 * Perfil de acceso de quien está llamando: quién es, qué secciones ve y hasta dónde
 * alcanza. Es la ÚNICA puerta de la consola; todo lo demás parte de aquí.
 *
 * @param {string} email      Correo de la sesión del portal.
 * @param {string=} seccion   Sección concreta que se va a usar. Si se pasa y no la
 *                            tiene, se rechaza aquí y no más adentro.
 */
function consolaAcceso_(email, seccion) {
  const id = secIdentidad_(email);
  if (!id.ok) return { ok: false, error: id.error || 'Tu sesión no es válida.' };

  const yo = permUsuario_(id.email);
  const secciones = CONSOLA_SECCIONES
    .filter(function (s) { return consolaSeccionAbierta_(s, yo.bloques); })
    .map(function (s) { return s.id; });

  // 'resumen' se le abre a cualquiera, así que tenerlo NO prueba nada: quien entra a
  // la consola tiene que traer al menos una sección con contenido propio.
  const conFondo = secciones.filter(function (s) { return s !== 'resumen'; });
  if (!conFondo.length) {
    return { ok: false, email: yo.email, nombre: yo.nombre,
             error: 'Tu cuenta no tiene acceso a la Consola.' };
  }

  if (seccion && secciones.indexOf(seccion) === -1) {
    const def = CONSOLA_SECCIONES.filter(function (s) { return s.id === seccion; })[0];
    return { ok: false, email: yo.email, nombre: yo.nombre,
             error: 'Tu cuenta no tiene acceso a "' + ((def && def.nombre) || seccion) + '" dentro de la Consola.' };
  }

  return {
    ok: true,
    email: yo.email,
    nombre: yo.nombre,
    usuario: yo,
    maestro: yo.maestro === true,
    nivel: permNivelUsuario_(yo),
    secciones: secciones,
    bloques: yo.bloques,
    error: ''
  };
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
    const acc = consolaAcceso_(email);
    if (!acc.ok) return consolaError_(acc.error);

    const yo = acc.usuario;
    const tiene = function (s) { return acc.secciones.indexOf(s) !== -1; };
    // Se leen UNA vez y se reparten: los usan el apartado `ajustes` y las recomendaciones.
    const ajustes = tiene('ajustes') ? consolaLeerAjustes_(acc.maestro) : [];

    // Cada apartado se calcula SOLO si esta persona lo va a ver. No es solo higiene de
    // datos: leer ajustes, formatos y salud son viajes a PropertiesService y a la hoja,
    // y a un supervisor que únicamente entra a Roles le costaban casi un segundo de
    // espera para recibir cosas que su pantalla iba a tirar a la basura.
    return {
      success: true,
      yo: {
        email: yo.email, nombre: yo.nombre, rol: yo.rol, rolNombre: yo.rolNombre,
        bloques: yo.bloques, maestro: acc.maestro, nivel: acc.nivel
      },
      // Qué pestañas puede pintar la consola. La pantalla ya no adivina por el rol.
      secciones: acc.secciones,
      // Recortado a su alcance: ver permCatalogoPara_.
      catalogo: permCatalogoPara_(yo),
      miembros:      tiene('roles')    ? consolaListaMiembros_(yo) : [],
      ajustes:       ajustes,
      gruposAjustes: tiene('ajustes')  ? CONSOLA_GRUPOS_AJUSTES.slice() : [],
      enlacesAjustes: tiene('ajustes') ? consolaEnlacesAjustes_(yo.bloques) : [],
      // Los grupos son pequeños y los pide la misma pestaña de Roles; se mandan con el
      // panorama en vez de en una segunda llamada. Solo para quien puede administrarlos.
      //
      // El `typeof` va PRIMERO y el nivel se lee con otro `typeof`: si Grupos.gs no está
      // desplegado, `GRP_NIVEL_MINIMO` no existe, y leerlo aquí no daría un panorama sin
      // grupos —daría un ReferenceError que el catch de abajo convierte en «no pudimos cargar
      // la consola». Un archivo que falta no puede tumbar la pantalla entera.
      grupos:        (typeof grpListar === 'function' && tiene('roles') &&
                      acc.nivel >= (typeof GRP_NIVEL_MINIMO === 'number' ? GRP_NIVEL_MINIMO : 2))
                       ? (grpListar(acc.email).grupos || []) : [],
      formatos:      tiene('formatos') ? consolaLeerFormatos_(acc.email) : [],
      resumen:       consolaResumen_(yo),
      recomendaciones: consolaRecomendaciones_(acc, ajustes),
      bitacora:      tiene('bitacora') ? consolaBitacoraLeer_(50, yo) : []
    };
  } catch (e) {
    Logger.log('consolaPanorama error: ' + e + ' · ' + e.stack);
    return consolaError_('No pudimos cargar la consola. Inténtalo de nuevo en un momento.');
  }
}

// ── RECOMENDACIONES DEL RESUMEN (T9.9) ───────────────────────────────────────
//
// Antes esto lo calculaba el cliente con lo que ya tenía a mano (consola.html): secretos en el
// código y módulos apagados. Se sube al servidor por dos motivos, y el segundo es el que manda:
//
//   · aquí hay datos que el cliente no tiene ni debe tener —los envíos fallidos, cuántos días
//     lleva apagado un módulo, quién no ha entrado nunca—, y
//   · un aviso calculado en el navegador es un aviso que solo ve quien tenga esa pantalla
//     abierta con esa versión del archivo. La consola es donde se mira si el sistema está bien;
//     su lista de pendientes no puede depender de qué copia del JavaScript se cargó.
//
// Cada recomendación trae SU ACCIÓN: sin «a dónde ir», un aviso es una queja.

/** Propiedad donde queda la foto de la última revisión de salud, para poder citarla barata. */
const CONSOLA_PROP_SALUD = 'CONSOLA_ULTIMA_SALUD';

/** Propiedad con el momento en que se apagó cada módulo: {bloqueId: ISO}. */
const CONSOLA_PROP_MODULOS_DESDE = 'CONSOLA_MODULOS_DESDE';

/** Días que un módulo puede estar apagado antes de que la consola pregunte por él. */
const CONSOLA_MODULO_DIAS_AVISO = 7;

/** Correos que quedan en el día por debajo de los cuales conviene avisar. */
const CONSOLA_CUOTA_BAJA = 60;

function consolaModulosDesde_() {
  try {
    const crudo = PropertiesService.getScriptProperties().getProperty(CONSOLA_PROP_MODULOS_DESDE);
    const obj = crudo ? JSON.parse(crudo) : {};
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e) {
    return {};
  }
}

/** Apunta cuándo se apagó un módulo (y lo borra al encenderlo). Nunca revienta la operación. */
function consolaMarcarModuloDesde_(bloqueId, apagado) {
  try {
    const mapa = consolaModulosDesde_();
    if (apagado) mapa[bloqueId] = new Date().toISOString();
    else delete mapa[bloqueId];
    PropertiesService.getScriptProperties().setProperty(CONSOLA_PROP_MODULOS_DESDE, JSON.stringify(mapa));
  } catch (e) {
    Logger.log('consolaMarcarModuloDesde_: ' + e);
  }
}

/**
 * Cuánto correo queda hoy, preguntado UNA vez por ejecución.
 * Lo piden el resumen y las recomendaciones en la misma apertura de la consola, y cada
 * `getRemainingDailyQuota` es una llamada al servicio de correo.
 */
var CONSOLA_CUOTA_MEMO = null;

function consolaCuotaCorreo_() {
  if (CONSOLA_CUOTA_MEMO === null) {
    try { CONSOLA_CUOTA_MEMO = MailApp.getRemainingDailyQuota(); } catch (e) { CONSOLA_CUOTA_MEMO = -1; }
  }
  return CONSOLA_CUOTA_MEMO;
}

/** Días enteros transcurridos desde una fecha ISO, o -1 si no se sabe. */
function consolaDiasDesde_(iso) {
  if (!iso) return -1;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return -1;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * La lista de «esto conviene mirarlo». Todo lo de aquí tiene que ser BARATO: se calcula en
 * cada apertura de la consola, así que nada de leer hojas enteras ni de correr la revisión
 * maestra —que tarda y se pide con un botón—. De la salud se cita la última foto guardada.
 *
 * @return {Array<{texto:string, tono:string, accion:string, panel:string, pagina:string}>}
 */
function consolaRecomendaciones_(acc, ajustesYaLeidos) {
  const out = [];
  const tiene = function (s) { return acc.secciones.indexOf(s) !== -1; };

  /* Qué sección abre cada panel, para no ofrecerle a nadie un botón que no le va a funcionar:
     un supervisor con `sup_equipo` ve el aviso de un módulo apagado —le afecta a su equipo— pero
     no tiene la pestaña Módulos, y el botón «Ir a Módulos» no hacía nada al pulsarlo. */
  const SECCION_DE_PANEL = { miembros: 'roles', permisos: 'roles', modulos: 'modulos',
                             ajustes: 'ajustes', formatos: 'formatos', salud: 'salud',
                             metricas: 'metricas', bitacora: 'bitacora' };

  const añadir = function (texto, tono, accion, destino) {
    const panel = (destino && destino.panel) || '';
    const seccion = SECCION_DE_PANEL[panel];
    const alcanzable = !panel || !seccion || tiene(seccion);
    out.push({
      texto: texto, tono: tono || 'aviso',
      accion: alcanzable ? (accion || '') : '',
      panel: alcanzable ? panel : '',
      pagina: (destino && destino.pagina) || ''
    });
  };

  // 1. Ajustes sin poner o secretos que siguen en el código fuente.
  //    Se reciben ya leídos cuando quien llama acaba de leerlos: cada lectura son quince
  //    `getProperty` y el panorama los pedía dos veces por la misma apertura de consola.
  if (tiene('ajustes')) {
    try {
      (ajustesYaLeidos || consolaLeerAjustes_(acc.maestro)).forEach(function (a) {
        if (a.enCodigo && a.secreto) {
          añadir('«' + a.nombre + '» todavía vive en el código fuente en vez de en las propiedades del script.',
                 'aviso', 'Ir a Ajustes', { panel: 'ajustes' });
        } else if (!a.configurado && !a.soloLectura && !a.opcional) {
          añadir('«' + a.nombre + '» está sin configurar.', 'aviso', 'Ir a Ajustes', { panel: 'ajustes' });
        }
      });
    } catch (e) { Logger.log('recomendaciones/ajustes: ' + e); }
  }

  // 2. Módulos apagados, con el tiempo que llevan así. Un módulo apagado es una decisión
  //    temporal por definición; el que lleva un mes apagado es casi siempre un olvido.
  try {
    const desde = consolaModulosDesde_();
    permModulosApagados_().forEach(function (id) {
      const b = permBloque_(id);
      const nombre = (b && b.nombre) || id;
      const dias = consolaDiasDesde_(desde[id]);
      if (dias >= CONSOLA_MODULO_DIAS_AVISO) {
        añadir('«' + nombre + '» lleva ' + dias + ' días apagado por mantenimiento: nadie del equipo lo ve.',
               'malo', 'Ir a Módulos', { panel: 'modulos' });
      } else {
        añadir('«' + nombre + '» está apagado por mantenimiento: nadie del equipo lo ve.',
               'aviso', 'Ir a Módulos', { panel: 'modulos' });
      }
    });
  } catch (e) { Logger.log('recomendaciones/modulos: ' + e); }

  // De aquí para abajo son cifras de la instalación, y esa conversación es de maestros.
  if (!acc.maestro) return out;

  // 3. Envíos fallidos recientes. Se leen SOLO las últimas filas de la hoja: la pregunta es
  //    «¿algo se rompió últimamente?», y para eso no hace falta la hoja entera.
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MET_SHEET_NAME);
    if (sheet && sheet.getLastRow() > 1) {
      const cuantas = Math.min(sheet.getLastRow() - 1, 200);
      const ancho = Math.max(sheet.getLastColumn(), 1);
      const hdr = sheet.getRange(1, 1, 1, ancho).getValues()[0].map(String);
      const iFecha = hdr.indexOf('Fecha'), iRes = hdr.indexOf('Resultado');
      if (iFecha > -1 && iRes > -1) {
        const datos = sheet.getRange(sheet.getLastRow() - cuantas + 1, 1, cuantas, ancho).getValues();
        const corte = Date.now() - 7 * 24 * 60 * 60 * 1000;
        let fallos = 0;
        datos.forEach(function (f) {
          const d = (f[iFecha] instanceof Date) ? f[iFecha] : new Date(f[iFecha]);
          if (isNaN(d.getTime()) || d.getTime() < corte) return;
          if (!/enviad/i.test(String(f[iRes] || ''))) fallos++;
        });
        if (fallos) {
          añadir(fallos + ' correo(s) fallaron en los últimos siete días.', 'malo',
                 'Ver en Métricas', { panel: 'metricas' });
        }
      }
    }
  } catch (e) { Logger.log('recomendaciones/correos: ' + e); }

  // 4. La última revisión de salud. No se corre aquí —tarda y toca Drive, Gmail y calendario—:
  //    se cita la foto que dejó la última, y si nunca se ha corrido, se dice eso.
  try {
    const crudo = PropertiesService.getScriptProperties().getProperty(CONSOLA_PROP_SALUD);
    const foto = crudo ? JSON.parse(crudo) : null;
    if (!foto) {
      añadir('La revisión del sistema no se ha corrido nunca desde la consola.', 'aviso',
             'Ir a Salud', { panel: 'salud' });
    } else if (foto.fallos > 0) {
      const dias = consolaDiasDesde_(foto.fecha);
      añadir('La última revisión del sistema (' + (dias <= 0 ? 'hoy' : 'hace ' + dias + ' día(s)') +
             ') dejó ' + foto.fallos + ' problema(s) sin resolver.', 'malo', 'Ir a Salud', { panel: 'salud' });
    } else if (consolaDiasDesde_(foto.fecha) > 30) {
      añadir('Hace más de un mes que no se corre la revisión del sistema.', 'aviso',
             'Ir a Salud', { panel: 'salud' });
    }
  } catch (e) { Logger.log('recomendaciones/salud: ' + e); }

  // 5. Cuota de correo. Quedarse sin cuota no da un error claro: las cotizaciones simplemente
  //    dejan de salir, y el asesor cree que las mandó.
  try {
    const quedan = consolaCuotaCorreo_();
    if (quedan >= 0 && quedan <= CONSOLA_CUOTA_BAJA) {
      añadir('Quedan ' + quedan + ' correos de la cuota de hoy. Al agotarse, los envíos fallan sin aviso al asesor.',
             'malo', '', {});
    }
  } catch (e) {}

  // 6. Altas que nunca entraron. La columna PasswordTemporal se limpia sola en cuanto la
  //    persona entra y cambia su contraseña, así que un «Sí» viejo es alguien a quien se dio
  //    de alta y nunca llegó a usar el sistema — o a quien no le llegó el correo.
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTROS_SHEET_NAME);
    if (sheet && sheet.getLastRow() > 1 && typeof CUENTAS_COL_TEMPORAL === 'string') {
      const ancho = Math.max(sheet.getLastColumn(), 1);
      const hdr = sheet.getRange(1, 1, 1, ancho).getValues()[0].map(String);
      const iTemp = hdr.indexOf(CUENTAS_COL_TEMPORAL);
      if (iTemp > -1) {
        const valores = sheet.getRange(2, iTemp + 1, sheet.getLastRow() - 1, 1).getValues();
        let pendientes = 0;
        valores.forEach(function (v) { if (String(v[0] || '').trim()) pendientes++; });
        if (pendientes) {
          añadir(pendientes + ' persona(s) siguen con la contraseña temporal: nunca han entrado.',
                 'aviso', 'Ir a Roles', { panel: 'miembros' });
        }
      }
    }
  } catch (e) { Logger.log('recomendaciones/altas: ' + e); }

  return out;
}

/** Cifras de una ojeada: cuánta gente hay, de qué rol, y qué tan grande es la base. */
function consolaResumen_(quien) {
  const esMaestro = !!(quien && quien.maestro === true);
  const miNivel = permNivelUsuario_(quien);

  const resumen = {
    miembros: 0, activos: 0, bajas: 0,
    porRol: { normal: 0, avanzado: 0, maestro: 0 },
    // El alcance viaja al cliente para que la pantalla pueda rotular las cifras con
    // honestidad: "12 personas" a secas es mentira cuando en el sistema hay 40 y esta
    // persona solo alcanza a 12.
    alcance: esMaestro ? 'sistema' : 'jerarquia',
    cotizaciones: 0, modulosApagados: permModulosApagados_().length,
    urlApp: '', zonaHoraria: '', cuotaCorreo: -1
  };

  const indice = secIndiceRegistros_();
  Object.keys(indice).forEach(function (correo) {
    const u = permUsuario_(correo);
    // Se cuenta lo mismo que se lista: si un supervisor ve 12 filas, su resumen no
    // puede decir 40. Dos cifras que no cuadran en la misma pantalla se leen como
    // que el sistema está mal, y además delatan cuánta gente hay por encima.
    if (!esMaestro && permNivelUsuario_(u) > miNivel &&
        !permMismoCorreo_(correo, quien && quien.email)) return;
    resumen.miembros++;
    if (!u.activo) resumen.bajas++; else resumen.activos++;
    if (resumen.porRol[u.rol] !== undefined) resumen.porRol[u.rol]++;
  });

  // De aquí para abajo son cifras del SISTEMA, no del equipo: cuánto ha crecido la
  // base, qué URL sirve la app, cuánto correo queda. Son las que se piden cuando algo
  // va mal a nivel de instalación, y esa conversación es de maestros.
  if (!esMaestro) return resumen;

  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COTIZACIONES_SHEET_NAME);
    // getLastRow() no lee la hoja entera: es lo único que se puede permitir aquí,
    // porque la consola se abre a menudo y "Cotizaciones" es la hoja más grande.
    if (sheet) resumen.cotizaciones = Math.max(0, sheet.getLastRow() - 1);
  } catch (e) {}

  try { resumen.urlApp = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  try { resumen.zonaHoraria = Session.getScriptTimeZone() || ''; } catch (e) {}
  resumen.cuotaCorreo = consolaCuotaCorreo_();

  return resumen;
}

// ── MIEMBROS ─────────────────────────────────────────────────────────────────

/**
 * Lista de miembros con su rol y sus bloques ya resueltos.
 * NUNCA incluye el hash de la contraseña: no hay ninguna pantalla que lo necesite
 * y todo lo que viaja al navegador acaba, tarde o temprano, en la consola de alguien.
 */
function consolaListaMiembros_(quien) {
  const indice = secIndiceRegistros_();
  const miNivel = permNivelUsuario_(quien);

  return Object.keys(indice).map(function (correo) {
    const fila = indice[correo];
    // La identidad sale de "Registros" y los permisos de la hoja oculta; permUsuario_
    // ya sabe juntar las dos cosas, así que la consola no repite esa lógica.
    const u = permUsuario_(correo);
    const veto = permVetoJerarquia_(quien, u);
    return {
      email: correo,
      nombre: u.nombre || fila.nombre || '',
      rol: u.rol,
      rolNombre: u.rolNombre,
      nivel: permNivelUsuario_(u),
      activo: u.activo,
      // 'heredado' avisa de que esta persona todavía no tiene rol guardado: el suyo
      // sale de la columna "Avanzado" de siempre.
      heredado: u.heredado === true,
      ajustes: u.ajustes,
      bloques: u.bloques,
      // Las filas que no se pueden tocar se pintan igual, en gris y con el motivo:
      // esconderlas convertiría "no puedo" en "no existe", que no es lo mismo.
      // Las de nivel SUPERIOR sí se ocultan del todo, más abajo.
      gestionable: veto === '',
      motivo: veto,
      alta: (fila.alta instanceof Date) ? fila.alta.toISOString() : String(fila.alta || ''),
      fila: fila.fila || 0
    };
  }).filter(function (m) {
    // Regla de jerarquía, mitad "ver": por encima de tu nivel no se ve ni existe.
    // Es distinto de "no se puede editar" a propósito. Que un supervisor sepa
    // exactamente quiénes son los maestros y qué bloques tiene cada uno es un mapa
    // del sistema que no necesita para su trabajo, y sí sirve para saber a quién
    // conviene suplantar. La propia fila siempre se ve: es útil y no revela nada.
    return m.nivel <= miNivel || permMismoCorreo_(m.email, quien && quien.email);
  }).sort(function (a, b) {
    // Primero por poder (el nivel más alto arriba), luego alfabético: es el orden en
    // que se busca a alguien cuando se entra a "¿quién tiene qué?".
    if (a.nivel !== b.nivel) return b.nivel - a.nivel;
    return (a.nombre || a.email).localeCompare(b.nombre || b.email, 'es');
  });
}

/** Lista de miembros para refrescar la tabla sin recargar toda la consola. */
function consolaMiembros(email) {
  try {
    const acc = consolaAcceso_(email, 'roles');
    if (!acc.ok) return consolaError_(acc.error);
    return { success: true, miembros: consolaListaMiembros_(acc.usuario),
             resumen: consolaResumen_(acc.usuario) };
  } catch (e) {
    Logger.log('consolaMiembros error: ' + e);
    return consolaError_('No pudimos leer la lista de personas. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Comprobaciones que impiden que la consola se cierre por dentro.
 * @return {string} mensaje de error, o '' si el cambio es seguro.
 */
function consolaCandados_(quien, objetivo, cambio) {
  const esYo = permMismoCorreo_(quien && quien.email, objetivo);
  const actual = permUsuario_(objetivo);

  if (!actual.encontrado) return 'El correo ' + objetivo + ' no está dado de alta.';

  // 1. JERARQUÍA. Va primero porque es la que decide si esta persona tiene algo que
  //    hacer aquí. Cubre además el caso de uno mismo, con su propio mensaje.
  const veto = permVetoJerarquia_(quien, actual);
  if (veto) return veto;

  // 2. EL ROL QUE SE PIDE. Distinto de lo anterior: una cosa es a quién alcanzas y
  //    otra hasta dónde puedes subirlo. Sin esto, un supervisor no podría editar a un
  //    maestro pero sí nombrar maestro a un asesor, y se fabricaría por la puerta de
  //    atrás el poder que no tiene.
  if (cambio.rol) {
    const vetoRol = permVetoRol_(quien, cambio.rol);
    if (vetoRol) return vetoRol;
  }

  // 3. Sobre uno mismo: ni bajarse el rol ni darse de baja. No es paternalismo, es que
  //    quien se equivoca aquí ya no tiene desde dónde deshacerlo. (permVetoJerarquia_
  //    ya lo corta antes; se deja por si en el futuro se relaja aquella regla.)
  if (esYo && cambio.rol && cambio.rol !== actual.rol) {
    return 'No puedes cambiarte el rol a ti mismo. Pídeselo a otra persona.';
  }
  if (esYo && cambio.activo === false) {
    return 'No puedes darte de baja a ti mismo.';
  }

  // 4. Sobre el último maestro: si se va, no queda nadie que pueda volver a nombrar a
  //    uno y hay que abrir el editor de Apps Script para arreglarlo.
  const dejaDeSerMaestro = actual.maestro &&
    ((cambio.rol && cambio.rol !== 'maestro') || cambio.activo === false);
  if (dejaDeSerMaestro && permListaMaestros_().length <= 1) {
    return 'Es el único maestro del sistema. Nombra a otro antes de cambiar este.';
  }

  return '';
}

/**
 * Los bloques que se piden conceder o retirar, ¿están todos dentro de lo que esta
 * persona puede repartir?
 *
 * Es el tercer flanco de la escalada de privilegios, y el más fácil de olvidar porque
 * no pasa por el rol: sin esta comprobación un supervisor podría abrirle a un asesor
 * los bloques de administración uno por uno —'adm_ajustes', 'adm_modulos'— y quedarse
 * mirando cómo el asesor hace por él lo que a él le está vedado.
 *
 * @return {string} motivo, o '' si todo lo pedido está a su alcance.
 */
function consolaVetoBloques_(quien, mas, menos) {
  const repartibles = permBloquesRepartibles_(quien);
  const fuera = [].concat(mas || [], menos || []).filter(function (id) {
    return PERM_IDS.indexOf(id) !== -1 && repartibles.indexOf(id) === -1;
  });
  if (!fuera.length) return '';

  const nombres = fuera.map(function (id) {
    const b = permBloque_(id);
    return (b && b.nombre) || id;
  });
  // Se nombran los bloques concretos: "no puedes repartir eso" a secas deja a quien lo
  // lee probando casilla por casilla hasta dar con la que estorba.
  return 'No puedes repartir ' + (fuera.length === 1 ? 'el acceso' : 'los accesos') +
         ' "' + nombres.join('", "') + '": no ' + (fuera.length === 1 ? 'lo tienes' : 'los tienes') +
         ' tú mismo.';
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
    const acc = consolaAcceso_(email, 'roles');
    if (!acc.ok) return consolaError_(acc.error);
    const gate = { email: acc.email, nombre: acc.nombre, bloques: acc.bloques };

    const c = cambio || {};
    const objetivo = secNormalizarCorreo_(c.email);
    if (!objetivo) return consolaError_('Falta el correo de la persona que quieres cambiar.');

    // Cambiar permisos por bloque es una facultad distinta de cambiar el rol: se puede
    // tener un maestro que reparte accesos finos pero no reparte roles. Para el
    // supervisor, 'sup_equipo' le da las dos cosas dentro de su nivel — el recorte de
    // lo que puede repartir lo pone consolaVetoBloques_, no un bloque aparte.
    const tocaPermisos = (c.mas !== undefined || c.menos !== undefined);
    if (tocaPermisos && !acc.maestro && (acc.bloques || []).indexOf('sup_equipo') === -1) {
      return consolaError_('Tu cuenta no puede cambiar accesos por bloque.');
    }
    if (tocaPermisos && acc.maestro && (acc.bloques || []).indexOf('adm_permisos') === -1) {
      return consolaError_('Tu cuenta maestra no puede cambiar permisos por bloque.');
    }
    if (tocaPermisos) {
      const vetoBloques = consolaVetoBloques_(acc.usuario, c.mas, c.menos);
      if (vetoBloques) return consolaError_(vetoBloques);
    }

    const rolPedido = (c.rol !== undefined && c.rol !== null && c.rol !== '')
      ? permNormalizarRol_(c.rol) : '';
    if (c.rol !== undefined && c.rol !== null && c.rol !== '' && !rolPedido) {
      return consolaError_('El rol "' + c.rol + '" no existe.');
    }

    const activoPedido = (c.activo === undefined || c.activo === null) ? undefined : (c.activo === true);

    const veto = consolaCandados_(acc.usuario, objetivo, { rol: rolPedido, activo: activoPedido });
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
               miembros: consolaListaMiembros_(acc.usuario), resumen: consolaResumen_(acc.usuario) };
    }

    if (!permEscribirFila_(objetivo, campos)) {
      return consolaError_('No se encontró la fila de ' + objetivo + ' en "' + REGISTROS_SHEET_NAME + '".');
    }

    consolaBitacoraApuntar_(gate.email, 'Rol o accesos modificados', objetivo, notas.join(' · '));

    // La lista se relee DESPUÉS de escribir y con el usuario ya actualizado: si alguien
    // acaba de subir de nivel, su fila tiene que volver con la jerarquía nueva y no con
    // la que había cuando empezó la llamada.
    const yoAhora = permUsuario_(acc.email);
    return {
      success: true,
      message: 'Cambios guardados para ' + objetivo + '.',
      miembros: consolaListaMiembros_(yoAhora),
      resumen: consolaResumen_(yoAhora)
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
    const acc = consolaAcceso_(email, 'roles');
    if (!acc.ok) return consolaError_(acc.error);
    const gate = { email: acc.email, nombre: acc.nombre };

    const d = datos || {};
    const nombre = String(d.nombre || '').trim();
    const correo = secNormalizarCorreo_(d.email);
    const rol = permNormalizarRol_(d.rol) || 'normal';

    // Un alta es la vía más limpia para fabricarse privilegios: no hay nadie a quien
    // "alcanzar", así que la jerarquía por objetivo no aplica y solo queda esta
    // comprobación. Sin ella, un supervisor daría de alta a un maestro nuevo y a
    // través de él tendría el sistema entero.
    const vetoRol = permVetoRol_(acc.usuario, rol);
    if (vetoRol) return consolaError_(vetoRol);

    // Los accesos extra del alta pasan por el mismo filtro que en una edición.
    const vetoBloques = consolaVetoBloques_(acc.usuario, d.mas, d.menos);
    if (vetoBloques) return consolaError_(vetoBloques);

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

    // Rol y accesos concretos se escriben en el MISMO paso que el alta.
    //
    // Antes esto solo corría para roles distintos de 'normal', y los accesos finos no
    // existían aquí: había que dar de alta y volver a entrar a editar a la persona
    // para dejarla como se quería. En la práctica ese segundo paso se olvidaba, y el
    // alta "con permisos" acababa siendo un alta pelada. Ahora la fila queda completa
    // desde el principio, que además es lo que la bitácora deja registrado.
    const ajustesAlta = permLimpiarAjustes_({ mas: d.mas, menos: d.menos });
    const delRol = permBloquesDeRol_(rol);
    // Conceder lo que el rol ya trae, o retirar lo que no trae, solo ensucia la celda.
    ajustesAlta.mas = ajustesAlta.mas.filter(function (id) { return delRol.indexOf(id) === -1; });
    ajustesAlta.menos = ajustesAlta.menos.filter(function (id) { return delRol.indexOf(id) !== -1; });

    const textoAjustes = permSerializarAjustes_(ajustesAlta);
    if (rol !== 'normal' || textoAjustes) {
      const campos = {};
      campos[PERM_COL_ROL] = rol;
      campos[PERM_COL_ACTIVO] = 'Si';
      if (textoAjustes) campos[PERM_COL_PERMISOS] = textoAjustes;
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

    consolaBitacoraApuntar_(gate.email, 'Persona dada de alta', correo, 'rol ' + rol +
      (ajustesAlta.mas.length ? ' · accesos +[' + ajustesAlta.mas.join(', ') + ']' : '') +
      (ajustesAlta.menos.length ? ' · accesos −[' + ajustesAlta.menos.join(', ') + ']' : '') +
      (avisoEnviado ? ' · aviso enviado' : ' · SIN aviso'));

    return {
      success: true,
      message: 'Se dio de alta a ' + nombre + '.',
      avisoEnviado: avisoEnviado,
      avisoError: avisoError,
      // La contraseña temporal solo se devuelve si el correo NO salió: es el único
      // caso en que alguien tiene que dictársela a mano.
      passwordTemporal: avisoEnviado ? '' : temporal,
      miembros: consolaListaMiembros_(acc.usuario),
      resumen: consolaResumen_(acc.usuario)
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
    const acc = consolaAcceso_(email, 'roles');
    if (!acc.ok) return consolaError_(acc.error);
    const gate = { email: acc.email, nombre: acc.nombre };

    const objetivo = secNormalizarCorreo_(correoObjetivo);

    // Restablecer una contraseña es entregarle a alguien la llave de una cuenta ajena,
    // así que pasa por la misma jerarquía que editarla. Sin esto, un supervisor no
    // podría cambiarle el rol a un maestro pero sí generarle una contraseña temporal,
    // y si además llegara a ese buzón, entraría como él. Es la puerta de atrás del
    // control de accesos y se cierra con la misma llave que la de delante.
    const vetoReset = permVetoJerarquia_(acc.usuario, permUsuario_(objetivo));
    if (vetoReset) return consolaError_(vetoReset);

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
    const acc = consolaAcceso_(email, 'roles');
    if (!acc.ok) return consolaError_(acc.error);
    const gate = { email: acc.email, nombre: acc.nombre };

    const objetivo = secNormalizarCorreo_(correoObjetivo);
    if (secNormalizarCorreo_(confirmacion) !== objetivo) {
      return consolaError_('Para borrar hay que escribir el correo completo tal cual.');
    }
    if (objetivo === secNormalizarCorreo_(gate.email)) {
      return consolaError_('No puedes borrarte a ti mismo.');
    }

    const u = permUsuario_(objetivo);
    if (!u.encontrado) return consolaError_('El correo ' + objetivo + ' no está dado de alta.');

    // Borrar alcanza más lejos que editar, así que se exige lo mismo y algo más.
    const vetoBorrar = permVetoJerarquia_(acc.usuario, u);
    if (vetoBorrar) return consolaError_(vetoBorrar);
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
        // También la caché que sobrevive a esta ejecución: sin esto, alguien recién borrado
        // seguiría entrando hasta que caducara la entrada.
        if (typeof idcInvalidar_ === 'function') idcInvalidar_();
        // También su fila en la hoja oculta: si no, dar de alta ese mismo correo más
        // adelante lo resucitaría con los permisos que tenía antes de ser borrado.
        try { permBorrarPermisos_(objetivo); } catch (e) {
          Logger.log('No se pudo borrar la fila de permisos de ' + objetivo + ': ' + e);
        }
        consolaBitacoraApuntar_(gate.email, 'Persona BORRADA', objetivo,
          'nombre "' + (u.nombre || '') + '", rol ' + u.rol);
        return { success: true, message: 'Se borró a ' + objetivo + '.',
                 miembros: consolaListaMiembros_(acc.usuario), resumen: consolaResumen_(acc.usuario) };
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
function consolaLeerAjustes_(esMaestro) {
  const props = PropertiesService.getScriptProperties();
  // Sin dato, se asume lo prudente: los ajustes de solo maestro se pintan en modo consulta.
  // Hoy a esta función solo llegan maestros —consolaGate_ no deja pasar a nadie más—, así que
  // esto es la red por si mañana Ajustes se abre a supervisión.
  const maestro = esMaestro !== false;

  return CONSOLA_AJUSTES.map(function (a) {
    const enPropiedades = props.getProperty(a.clave);
    // secConfig_ es quien decide de verdad: propiedad si existe, si no la constante
    // del código. Se muestra el mismo valor que usa el sistema, no el de la propiedad.
    const efectivo = secConfig_(a.clave, consolaRespaldoEnCodigo_(a.clave));
    const salida = {
      clave: a.clave, nombre: a.nombre, detalle: a.detalle, grupo: a.grupo, tipo: a.tipo,
      opciones: a.opciones || null, marcador: a.marcador || '',
      secreto: a.secreto === true,
      soloMaestro: a.soloMaestro === true,
      opcional: a.opcional === true,
      soloLectura: a.soloLectura === true || (a.soloMaestro === true && !maestro),
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

/**
 * Los enlaces del §Ajustes que esta persona puede seguir. Se filtran por bloque: enseñar un
 * atajo a una pantalla que va a rechazarte es peor que no enseñarlo.
 */
function consolaEnlacesAjustes_(bloques) {
  const mios = bloques || [];
  return CONSOLA_AJUSTES_ENLACES.filter(function (e) {
    return !e.bloque || mios.indexOf(e.bloque) !== -1;
  }).map(function (e) {
    return { nombre: e.nombre, detalle: e.detalle, panel: e.panel || '', pagina: e.pagina || '' };
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
    // Los dos que T9.7 sacó del código fuente. Siguen escritos en Correos.gs y CorreoCliente.gs
    // como respaldo: la propiedad manda, y si nunca se toca el sistema se comporta igual que antes.
    case 'MAIL_ALIAS':              return typeof MAIL_ALIAS_RESPALDO === 'string' ? MAIL_ALIAS_RESPALDO : '';
    case 'CC_SENDER_NAME':          return typeof CC_SENDER_NAME_RESPALDO === 'string' ? CC_SENDER_NAME_RESPALDO : '';
    case 'CORREO_CCO_GLOBAL':       return '';
    case 'AUTH_MODO':               return 'portal';
    default:                        return '';
  }
}

/** Lee los ajustes (llamada suelta, para refrescar sin recargar la consola). */
function consolaAjustes(email) {
  try {
    const gate = consolaGate_(email, 'adm_ajustes');
    if (!gate.ok) return consolaError_(gate.error);
    return { success: true, ajustes: consolaLeerAjustes_(gate.maestro === true),
             grupos: CONSOLA_GRUPOS_AJUSTES.slice(),
             enlaces: consolaEnlacesAjustes_(gate.bloques) };
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
    // El candado por ajuste, exigido en el servidor y no solo pintado en gris (T9.6).
    if (def.soloMaestro && gate.maestro !== true) {
      return consolaError_('"' + def.nombre + '" solo lo cambia una cuenta maestra.');
    }

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
      ajustes: consolaLeerAjustes_(gate.maestro === true)
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

  // Un correo suelto (el alias del remitente). No se comprueba que exista —eso lo dirá Gmail
  // al primer envío—, pero sí que tenga forma de dirección: un alias mal tecleado hace que el
  // sistema intente enviar "como" algo que no es un correo y el envío se cae entero.
  if (def.tipo === 'correo') {
    if (!valor) return bien('', 'Sin alias: los correos saldrán desde la cuenta que ejecuta el sistema.');
    if (!/^[^\s@,;]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(valor)) return mal('"' + valor + '" no parece un correo.');
    return bien(valor.toLowerCase());
  }

  // Lista de correos separados por coma (el CCO global). El tope es corto a propósito: una
  // copia oculta es para vigilar, y una lista larga es una fuga de datos con buena intención.
  if (def.tipo === 'lista_correos') {
    if (!valor) return bien('', 'Sin copia oculta: los correos del sistema van solo a sus destinatarios.');
    const trozos = valor.split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean);
    const malos = trozos.filter(function (x) { return !/^[^\s@,;]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(x); });
    if (malos.length) return mal('Esto no parece un correo: ' + malos.join(', '));
    if (trozos.length > 5) return mal('Como mucho cinco buzones en copia oculta. Si hacen falta más, usa una lista de distribución.');
    const limpios = [];
    trozos.forEach(function (x) {
      const c = x.toLowerCase();
      if (limpios.indexOf(c) === -1) limpios.push(c);
    });
    return bien(limpios.join(','),
      'A partir de ahora ' + limpios.join(', ') + ' recibe copia oculta de las cotizaciones, las ' +
      'plantillas a cliente y los avisos. Los correos de seguridad siguen sin copiarse.');
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

  if (def.tipo === 'texto') {
    // Fuera saltos de línea y tabuladores. Alguno de estos textos acaba en una cabecera de
    // correo (el nombre del remitente), y un salto de línea ahí es la forma clásica de colar
    // un destinatario de más. Cortar aquí sale gratis y cierra el paso para todos.
    return bien(valor.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120));
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
    // Desde cuándo está así, para que el resumen pueda decir «lleva 12 días apagado» (T9.9).
    consolaMarcarModuloDesde_(bloqueId, quiereApagar);
    consolaBitacoraApuntar_(gate.email, quiereApagar ? 'Módulo apagado' : 'Módulo encendido',
      bloque.nombre, quiereApagar ? 'en mantenimiento para todos menos los maestros' : 'de vuelta en servicio');

    return {
      success: true,
      message: '"' + bloque.nombre + '" ' + (quiereApagar ? 'quedó en mantenimiento.' : 'volvió a estar disponible.'),
      apagados: guardados,
      catalogo: permCatalogo_(),
      // Apagar un módulo cambia los bloques efectivos de todo el mundo, así que la
      // tabla de personas vuelve recalculada. Solo un maestro llega aquí (adm_modulos
      // es suyo), de modo que la lista sale sin recorte de jerarquía.
      miembros: consolaListaMiembros_(permUsuario_(gate.email))
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

    /* Foto de esta corrida para el resumen (T9.9). Se guarda el marcador, no el reporte: lo
       que el resumen necesita saber es «cuándo fue la última y cómo salió», y meter el reporte
       entero en una propiedad de script sería guardar kilobytes que nadie va a leer de ahí. */
    try {
      PropertiesService.getScriptProperties().setProperty(CONSOLA_PROP_SALUD, JSON.stringify({
        fecha: new Date().toISOString(), fallos: fallos, total: (reporte.checks || []).length
      }));
    } catch (e) {
      Logger.log('No se pudo guardar la foto de la revisión: ' + e);
    }

    return { success: true, reporte: reporte };
  } catch (e) {
    Logger.log('consolaSalud error: ' + e);
    return consolaError_('No pudimos correr la revisión. Inténtalo de nuevo en un momento.');
  }
}

function consolaBitacora(email, limite) {
  try {
    const acc = consolaAcceso_(email, 'bitacora');
    if (!acc.ok) return consolaError_(acc.error);
    return { success: true,
             bitacora: consolaBitacoraLeer_(Number(limite) || CONSOLA_BITACORA_LIMITE, acc.usuario) };
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
  secSoloInterno_('consolaDiagnostico');
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
  // Se pasa un maestro sintético a propósito. consolaListaMiembros_ RECORTA por
  // jerarquía y falla cerrado: sin un `quien`, trataría a quien pregunta como asesor y
  // el diagnóstico informaría de menos gente de la que hay —justo el tipo de dato
  // engañoso que se viene a descartar aquí—. Esta función solo corre desde el editor,
  // que ya exige ser dueño del proyecto.
  const comoMaestro = { email: '', maestro: true, rol: 'maestro', bloques: PERM_IDS.slice() };
  Logger.log('Personas: ' + consolaListaMiembros_(comoMaestro).length);
  return { maestros: maestros, apagados: off };
}
