/**
 * =================================================================================================
 * Sistema integral de Ventel - Creado por David Martinez/ Davis18 trabajado desde Mayo 2025
 * Se uso generador de codigo de IA en este proyecto. (Gemini, Claude)
 * Version 0.9 Pruebas de control
 * 
 * IMPORTANTE: Todo el sistema tienen notas personales o del generador de codigo para facilitar el entendimiento de la estructura.
 * =================================================================================================
 * Este script actúa como el backend para una aplicación web.
 * Gestiona las siguientes funcionalidades principales:
 * 1.  Servicio de páginas HTML: Sirve las diferentes vistas de la aplicación (login, registro, dashboard, etc.).
 * 2.  Gestión de Usuarios: Registro y autenticación de usuarios con roles (Normal/Avanzado).
 * 3.  Operaciones CRUD para Cotizaciones: Crear, leer, actualizar y gestionar cotizaciones.
 * 4.  Almacenamiento de Datos: Utiliza Google Sheets como base de datos.
 * 5.  Generación de PDF: Crea un archivo PDF de la cotización.
 * 6.  Dashboard Analítico: Provee datos para el dashboard de usuarios avanzados.
 * 7.  Notificaciones Webhook: Envía notificaciones a un chat cuando se crea una nueva cotización.
 */

// --- Constantes Globales ---
const REGISTROS_SHEET_NAME = "Registros";
const COTIZACIONES_SHEET_NAME = "Cotizaciones";
const DETALLE_COTIZACIONES_SHEET_NAME = "DetalleCotizaciones";

// Valores sensibles: son el RESPALDO. Lo que manda es la propiedad de script del
// mismo nombre (Configuración > Propiedades del script). Ejecuta una vez
// secGuardarConfiguracion() en Seguridad.gs para moverlos allá y luego vacía estas
// constantes: así el secreto deja de viajar en el código fuente.
const HASH_SALT = "vPe/O5s2aG+Bv4cRGCwz+w==";
const WEBHOOK_URL = "https://chat.googleapis.com/v1/spaces/AAQAF6OTWgk/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=eUUUkEFC28CJYK0au8d5fRWkiZX5h7Zd7T-cAerb5wI";

/** Máximo de intentos fallidos de login por correo antes de bloquear 15 minutos. */
const LOGIN_MAX_INTENTOS = 8;
const LOGIN_VENTANA_SEGUNDOS = 900;

/**
 * Obtiene la URL base de la aplicación web una vez que ha sido desplegada.
 * Es útil para construir URLs completas dentro del script o en el lado del cliente.
 * @return {string | null} La URL de la aplicación web desplegada, o null si ocurre un error.
 */
function getScriptUrl() {
  try {
  
    return ScriptApp.getService().getUrl();
  } catch (error) {
    Logger.log("Error en getScriptUrl: " + error.message + " Stack: " + error.stack);
    return null;
  }
}

/**
 * Función principal que se ejecuta cuando se accede a la URL de la aplicación web (solicitud GET).
 * Actúa como un enrutador, sirviendo diferentes páginas HTML según el parámetro 'page' en la URL.
 * {object} e - El objeto de evento de la solicitud, que contiene los parámetros de la URL.
 */
const PAGES = {
  'login':               { file: 'inicioDeSesion',      title: 'Iniciar Sesión - Sistema Ventel' },
  'registro':            { file: 'registro',            title: 'Crear Cuenta - Sistema Ventel' },
  'recuperar':           { file: 'recuperar',           title: 'Recuperar Contraseña - Sistema Ventel' },
  'dashboard':           { file: 'inicio',              title: 'Dashboard - Sistema Ventel' },
  'inicio_avanzado':     { file: 'inicio_avanzado',     title: 'Dashboard Avanzado - Sistema Ventel' },
  'cotizacion':          { file: 'cotizacion',          title: 'Cotización - Sistema Ventel' },
  'cotizado_preview':    { file: 'cotizado_preview',    title: 'Vista Previa de Cotización' },
  'consulta_cotizacion': { file: 'consulta_cotizacion', title: 'Consulta de Cotización' },
  'revision_cotizacion': { file: 'revision_cotizacion', title: 'Revisión de Cotización - Sistema Ventel' },
  'correoventel':        { file: 'correoventel',        title: 'Enviar Correo - Sistema Ventel' },
  'correo_cliente':      { file: 'correo_cliente',      title: 'Correos a Clientes - Sistema Ventel' },
  'anuncios':            { file: 'anuncios',            title: 'Constructor de Anuncios - Sistema Ventel' },
  // Gestión del contenido del Portal (herramientas, plantillas, formatos, promos…).
  // Igual que la consola: el cascarón se sirve a quien lo pida y no enseña nada hasta
  // que el servidor confirma el bloque 'portal_contenido' en cada llamada.
  'portal_contenido':    { file: 'portal_contenido',    title: 'Contenido del Portal - Sistema Ventel' },
  // Panel de operación: confirmar, descartar y actualizar lo que reporta el equipo.
  // El tablero que ve TODO el mundo es '?page=estado', que es público (ver PORTAL_PAGES).
  'operacion':           { file: 'operacion',           title: 'Estado de Operación - Sistema Ventel' },
  // Consola de administración (rol maestro). La página se sirve a cualquiera que la
  // pida —igual que las demás—, pero no enseña NADA hasta que el servidor confirma el
  // rol: todo su contenido llega de consolaPanorama, que exige maestro. Servir el
  // cascarón no filtra nada y evita tener dos formas distintas de rutear.
  'consola':             { file: 'consola',             title: 'Consola - Sistema Ventel' }
};

// Páginas públicas del Portal Ventel (sin sesión). El Portal es la landing por
// defecto; sus plantillas esperan la variable APP_URL (no baseUrl/__APP__).
const PORTAL_PAGES = {
  'portal':      { file: 'Index',       title: 'Portal VENTEL · Liverpool' },
  'promociones': { file: 'Promociones', title: 'Monitor de Promociones | Liverpool · VENTEL' },
  // Tablero de estado de los sistemas. Es PÚBLICO a propósito: la pregunta "¿está caído
  // Connect o soy yo?" tiene que poder contestarse justo cuando no puedes entrar. Lo que
  // se sirve sin sesión no lleva ni nombres ni evidencias (ver Operacion.gs).
  'estado':      { file: 'estado',      title: 'Estado de operación · VENTEL' }
};

/**
 * PARÁMETROS DE VISTA · el contrato de las URLs del sistema.
 *
 * Cada uno se inyecta en TODA plantilla de app, aunque esa pantalla no lo use. Suena a
 * desperdicio y no lo es: una plantilla de Apps Script revienta al evaluar una variable
 * que no se le pasó, así que la alternativa —inyectar solo los que cada pantalla
 * necesita— obliga a tocar este archivo cada vez que alguien añade un enlace profundo, y
 * el día que se olvida, la pantalla no falla aquí sino al renderizar, con un error que
 * no dice qué falta. Inyectarlos todos convierte "añadir un parámetro" en una sola línea
 * en esta lista, y el cliente los lee por el mismo nombre desde AppUrl.param().
 *
 * Qué va en cada uno (el criterio, para que la lista no se llene de sinónimos):
 *   folio   IDENTIDAD de una cotización. Es lo que la pantalla abre.
 *   action  qué hacer con ella ('edit'). Modificador, no identidad.
 *   format  formato del documento a generar.
 *   q       filtro ya aplicado sobre una tabla (enlace a un resultado concreto).
 *   buscar  término con el que ABRIR EL BUSCADOR general. Distinto de `q`: uno filtra
 *           lo que ya hay en pantalla, el otro abre el panel de búsqueda encima.
 *   tpl     plantilla preseleccionada en "Correos a clientes".
 *   sec     sección/pestaña abierta dentro de una pantalla con varias.
 *   ancla   a qué apartado bajar al cargar. Se escribe también como #fragmento.
 *   inc     incidencia a abrir en el tablero de estado.
 *   next    a dónde volver tras el login. Es una CLAVE de página, jamás una URL: el
 *           cliente solo acepta las de su lista blanca (AppUrl.PAGINAS_TRAS_LOGIN), de
 *           modo que este parámetro no puede sacar a nadie fuera del sistema.
 */
const PARAMS_VISTA = ['folio', 'action', 'format', 'q', 'buscar', 'tpl', 'sec', 'ancla', 'inc', 'next', 'promo'];

function doGet(e) {
  try {
    return servirPagina_(e);
  } catch (error) {
    // Sin esto, cualquier fallo al renderizar (una hoja movida, un include que no
    // existe) le muestra al asesor la pantalla amarilla de error de Apps Script.
    Logger.log('doGet falló: ' + error.message + ' Stack: ' + error.stack);
    return HtmlService.createHtmlOutput(
      '<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:520px;margin:12vh auto;padding:32px;' +
      'border:1px solid #eadfe6;border-radius:16px;color:#3d2b36;line-height:1.6">' +
      '<h1 style="color:#E10098;font-size:20px;margin:0 0 12px">No pudimos abrir esta pantalla</h1>' +
      '<p style="margin:0 0 16px">Vuelve a intentarlo en un momento. Si sigue igual, avisa al equipo del sistema ' +
      'con la hora exacta y qué estabas haciendo.</p>' +
      '<p style="margin:0;font-size:12px;color:#8a7480">Si necesitas ayuda, escribe al equipo de Ventel.</p>' +
      '</div>'
    ).setTitle('Error · Sistema Ventel');
  }
}

function servirPagina_(e) {
  Logger.log("Parámetros doGet: " + JSON.stringify(e && e.parameter));
  const page = (e && e.parameter && e.parameter.page) || 'portal';

  // Portal público (landing). Cualquier página desconocida cae aquí también.
  if (PORTAL_PAGES[page] || !PAGES[page]) {
    const pConfig = PORTAL_PAGES[page] || PORTAL_PAGES['portal'];
    const pTemplate = HtmlService.createTemplateFromFile(pConfig.file);
    pTemplate.APP_URL = getScriptUrl() || '';
    // Las páginas públicas reciben los MISMOS parámetros de vista que las de app: el
    // Portal también tiene buscador general y anclas, y un enlace profundo no puede
    // dejar de funcionar por el lado de la valla en el que caiga la pantalla. Se
    // definen todos aunque cada plantilla lea uno: una plantilla de Apps Script falla
    // si usa una variable que no se le pasó (así llegó aquí `inc`, para estado.html).
    PARAMS_VISTA.forEach(function (nombre) {
      pTemplate[nombre] = (e && e.parameter && e.parameter[nombre]) || '';
    });
    return pTemplate.evaluate()
      .setTitle(pConfig.title)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const config = PAGES[page];

  const template = HtmlService.createTemplateFromFile(config.file);
  // La URL base se inyecta al renderizar: el cliente ya no necesita pedirla por red
  // en cada clic, que era lo que dejaba la navegación colgada cuando fallaba.
  template.baseUrl = getScriptUrl() || '';

  // Y con ella TODOS los parámetros de vista, de una vez (ver PARAMS_VISTA).
  PARAMS_VISTA.forEach(function (nombre) {
    template[nombre] = (e && e.parameter && e.parameter[nombre]) || '';
  });

  return template.evaluate()
    .setTitle(config.title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Permite incluir el contenido de otros archivos (como CSS o JS) dentro de una plantilla HTML principal.
 * Se usa en las plantillas con la sintaxis: <?!= include('nombre_archivo.html'); ?>
 * {string} filename - El nombre del archivo a incluir.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Correo del usuario activo. La identidad la define la sesión del PORTAL, no la cuenta
 * de Google del navegador (ver Seguridad.gs): por eso el cliente debe pasar su
 * AppSession.userEmail. Sin él solo queda el respaldo de la cuenta de Google.
 * {string=} correoPortal - AppSession.userEmail.
 */
function getUserEmail(correoPortal) {
  try {
    return secCorreoEfectivo_(correoPortal) || null;
  } catch (e) {
    Logger.log("Error obteniendo email del usuario: " + e.toString());
    return null; // El cliente debe ser capaz de manejar un valor nulo.
  }
}

/**
 * ALTA DE USUARIOS — la puerta única es Cuentas.gs.
 *
 * Antes esta función creaba la cuenta de golpe: bastaba teclear cualquier correo para
 * quedar dado de alta, sin probar que fuera tuyo. Ahora el alta pasa por un código de
 * 6 dígitos enviado a ese correo (solicitarCodigoRegistro → confirmarCodigoRegistro,
 * en Cuentas.gs), que además es lo que da sentido a la recuperación de contraseña:
 * si el correo no está verificado, mandarle un código para restablecerla no prueba nada.
 *
 * Se conserva el nombre por compatibilidad —una pantalla vieja en la caché del
 * navegador podría seguir llamándola— pero ya no da de alta a nadie: sería un atajo
 * para saltarse la verificación llamando a google.script.run desde la consola.
 *
 * {string} name - El nombre del usuario.
 * {string} email - El correo electrónico del usuario.
 * {string} password - La contraseña en texto plano.
 */
function registerUser(name, email, password) {
  Logger.log('registerUser (obsoleta) llamada para ' + secNormalizarCorreo_(email) +
             '. El alta requiere verificación por código.');
  return {
    success: false,
    obsoleta: true,
    message: 'Ahora el registro se confirma con un código enviado a tu correo. Recarga la página para continuar.'
  };
}

/**
 * Valida las credenciales de un usuario para iniciar sesión y determina su nivel de acceso.
 * {string} email - El correo del usuario.
 * {string} password - La contraseña proporcionada por el usuario.
 */
function loginUser(email, password) {
  try {
    const correo = secNormalizarCorreo_(email);
    if (!correo || !password) return { success: false, message: "Correo o contraseña incorrectos." };

    // Freno a la fuerza bruta: tras varios intentos fallidos el correo queda
    // bloqueado unos minutos. El contador vive en la caché del script, así que se
    // limpia solo y no ensucia la hoja.
    const bloqueo = secIntentosRevisar_(correo, LOGIN_MAX_INTENTOS, LOGIN_VENTANA_SEGUNDOS);
    if (bloqueo.bloqueado) {
      Logger.log("Login bloqueado por demasiados intentos: " + correo);
      return { success: false, message: "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo." };
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTROS_SHEET_NAME);
    if (!sheet) throw new Error(`Hoja '${REGISTROS_SHEET_NAME}' no encontrada.`);

    const data = sheet.getDataRange().getValues();
    const headers = data.shift().map(String);
    const nameColumnIndex = headers.indexOf("Nombre");
    const emailColumnIndex = headers.indexOf("Email");
    const passwordHashColumnIndex = headers.indexOf("PasswordHash");
    const avanzadoColumnIndex = headers.indexOf("Avanzado");

    if (emailColumnIndex === -1 || passwordHashColumnIndex === -1 || nameColumnIndex === -1 || avanzadoColumnIndex === -1) {
      throw new Error("Columnas requeridas no encontradas en '" + REGISTROS_SHEET_NAME + "'. Verifique 'Nombre', 'Email', 'PasswordHash', 'Avanzado'.");
    }

    // Comparación normalizada: el correo guardado puede traer mayúsculas o espacios
    // de registros viejos.
    const userRow = data.find(row => secNormalizarCorreo_(row[emailColumnIndex]) === correo);

    if (!userRow) {
      secIntentosSumar_(correo, LOGIN_VENTANA_SEGUNDOS);
      return { success: false, message: "Correo o contraseña incorrectos." };
    }

    const storedHash = String(userRow[passwordHashColumnIndex] || '').trim();
    const providedHashString = secHashContrasena_(password);

    if (secComparacionSegura_(providedHashString, storedHash)) {
      // El rol y los bloques se resuelven en Permisos.gs, que es el único lugar donde
      // se decide quién puede qué. Aquí solo se cobran para mandárselos al cliente,
      // que los usa para dibujar el menú; la app NO confía en esa copia: cada llamada
      // de servidor vuelve a preguntar (secIdentidadConBloque_).
      const permisos = (typeof permUsuario_ === 'function')
        ? permUsuario_(correo)
        : { activo: true, rol: secEsAfirmativo_(userRow[avanzadoColumnIndex]) ? 'avanzado' : 'normal',
            rolNombre: '', maestro: false, avanzado: secEsAfirmativo_(userRow[avanzadoColumnIndex]), bloques: [] };

      if (permisos.activo === false) {
        Logger.log('Login rechazado (cuenta dada de baja): ' + correo);
        return { success: false, message: 'Tu cuenta está dada de baja. Pide al administrador que la reactive.' };
      }

      secIntentosLimpiar_(correo);

      /**
       * CONTRASEÑA TEMPORAL: la credencial es correcta, pero no abre sesión.
       *
       * Una contraseña que la consola generó y mandó por correo ha viajado por un
       * buzón, ha podido dictarse en voz alta y suele acabar apuntada. Sirve para
       * demostrar UNA vez que el correo es de quien dice, no para ser su contraseña.
       * En vez de la sesión se devuelve un vale de un solo uso con el que la pantalla
       * pide la contraseña definitiva (establecerPasswordInicial, en Cuentas.gs), y es
       * ESA llamada la que abre la sesión. Así una temporal nunca deja a nadie dentro,
       * ni siquiera si cierra la pestaña a medio camino.
       *
       * Si algo falla al emitir el vale se entra con normalidad: dejar a alguien fuera
       * de su cuenta por un fallo nuestro es peor que un cambio de contraseña tardío.
       */
      if (typeof cuentasPasswordEsTemporal_ === 'function' && cuentasPasswordEsTemporal_(correo)) {
        try {
          const vale = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
          cuentasGuardar_(cuentasClave_('inicial', correo), {
            c: cuentasHash_('vale', vale),
            exp: Date.now() + CUENTAS_VALE_MINUTOS * 60000,
            ini: Date.now()
          });
          Logger.log('Login con contraseña temporal: ' + correo + ' — se pedirá contraseña nueva.');
          return {
            success: true,
            debeCambiarPassword: true,
            message: 'Entraste con una contraseña temporal. Elige la tuya para continuar.',
            userName: userRow[nameColumnIndex],
            userEmail: correo,
            vale: vale,
            expiraSegundos: CUENTAS_VALE_MINUTOS * 60
          };
        } catch (e) {
          Logger.log('No se pudo emitir el vale de contraseña inicial para ' + correo + ': ' + e);
        }
      }

      Logger.log(`Login exitoso para: ${correo}. Rol: ${permisos.rol}`);

      return {
        success: true,
        message: "Inicio de sesión exitoso.",
        userName: userRow[nameColumnIndex],
        userEmail: secNormalizarCorreo_(userRow[emailColumnIndex]),
        isAdvanced: permisos.avanzado, // El cliente usará esto para redirigir.
        rol: permisos.rol,
        rolNombre: permisos.rolNombre || '',
        isMaster: permisos.maestro === true,
        bloques: permisos.bloques || []
      };
    } else {
      const n = secIntentosSumar_(correo, LOGIN_VENTANA_SEGUNDOS);
      Logger.log(`Intento de login fallido para: ${correo} (${n} de ${LOGIN_MAX_INTENTOS})`);
      return { success: false, message: "Correo o contraseña incorrectos." };
    }
  } catch (error) {
    Logger.log("Error en loginUser: " + error.message);
    return { success: false, message: "No pudimos iniciar tu sesión en este momento. Inténtalo de nuevo en un minuto." };
  }
}

/**
 * Genera un folio único para una nueva cotización con el formato LVP-AAMMDD-XXXX.
 * El número secuencial (XXXX) se reinicia cada día.
 * {GoogleAppsScript.Spreadsheet.Sheet} sheet - La hoja de 'Cotizaciones'.
 */
function generateLvpFolio(sheet) {
  const HOY = new Date();
  const ANIO = HOY.getFullYear().toString().slice(-2); // Últimos 2 dígitos del año
  const MES = (HOY.getMonth() + 1).toString().padStart(2, '0'); // Mes con 2 dígitos
  const DIA = HOY.getDate().toString().padStart(2, '0'); // Día con 2 dígitos

  let newFolioNumber = 1; // El número secuencial empieza en 1.
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) { // Si hay cotizaciones existentes.
    const folios = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0].toString());
    const prefix = `LVP-${ANIO}${MES}${DIA}-`; // Prefijo para los folios del día de hoy.
    const foliosDelDia = folios.filter(f => f.startsWith(prefix));

    if (foliosDelDia.length > 0) {
      // Si ya hay folios para hoy, encuentra el número más alto y le suma 1.
      const numerosSecuenciales = foliosDelDia.map(f => parseInt(f.substring(prefix.length)) || 0);
      newFolioNumber = Math.max(...numerosSecuenciales) + 1;
    }
  }
  // Construye y retorna el nuevo folio completo, rellenando el número con ceros a la izquierda.
  return `LVP-${ANIO}${MES}${DIA}-${newFolioNumber.toString().padStart(4, '0')}`;
}

/**
 * Guarda o actualiza los datos de una cotización en las hojas 'Cotizaciones' y 'DetalleCotizaciones'.
 * quoteData - El objeto con todos los datos de la cotización.
 * status - El estado de la cotización (ej. "Folio Generado").
 */
function saveQuoteDataToSheets(quoteData, status, pdfLink = null) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cotizacionesSheet = ss.getSheetByName(COTIZACIONES_SHEET_NAME);
  const detalleSheet = ss.getSheetByName(DETALLE_COTIZACIONES_SHEET_NAME);

  if (!cotizacionesSheet) throw new Error(`Hoja "${COTIZACIONES_SHEET_NAME}" no encontrada.`);
  if (!detalleSheet) throw new Error(`Hoja "${DETALLE_COTIZACIONES_SHEET_NAME}" no encontrada.`);

  const cotHeaders = cotizacionesSheet.getRange(1, 1, 1, cotizacionesSheet.getLastColumn()).getValues()[0];
  const folioColIdxCot = cotHeaders.indexOf("Folio");
  if (folioColIdxCot === -1) throw new Error("Columna 'Folio' no encontrada en la hoja 'Cotizaciones'.");

  // Se localiza primero la fila para poder ACTUALIZARLA sin borrar las columnas que
  // esta función no maneja (p. ej. LinkSheetCCL, que escribe Formatos.gs).
  let existingRowIndexCot = -1;
  let filaExistente = null;
  const cotDataValues = cotizacionesSheet.getDataRange().getValues();
  for (let i = 1; i < cotDataValues.length; i++) {
    if (cotDataValues[i][folioColIdxCot] == quoteData.folio) {
      existingRowIndexCot = i + 1;
      filaExistente = cotDataValues[i];
      break;
    }
  }

  // La fila se arma por NOMBRE de columna (getQuoteDetails ya lee así). Antes se
  // armaba por posición fija, de modo que insertar o mover una columna en la hoja
  // desalineaba en silencio todas las cotizaciones nuevas.
  const camposCotizacion = [
    ["Folio",         quoteData.folio],
    ["Timestamp",     quoteData.timestamp || new Date()],
    // El asesor que se guarda es el de la sesión del PORTAL (Seguridad.gs), no la cuenta
    // de Google del navegador: pueden ser distintas y la cotización quedaría a otro nombre.
    ["AsesorCorreo",  quoteData.advisorEmail || secCorreoEfectivo_('')],
    ["AsesorNombre",  quoteData.advisorName || ''],
    ["Extencion",     quoteData.advisorExt || ''],
    ["ClienteNombre", quoteData.clientName || ''],
    ["CorreoCliente", quoteData.clientEmail || ''],
    ["Numero",        quoteData.clientPhone || ''],
    ["Subtotal",      parseFloat(quoteData.summarySubtotal) || 0],
    ["IVA",           parseFloat(quoteData.summaryVat) || 0],
    ["TotalGeneral",  parseFloat(quoteData.summaryTotal) || 0],
    ["Estatus",       status],
    ["Observaciones", quoteData.observations || '']
  ];
  // El enlace al PDF solo se toca cuando llega uno: guardarlo vacío borraría el que
  // ya estuviera registrado.
  if (pdfLink) camposCotizacion.push(["LinkPDF", pdfLink]);

  const mainQuoteRowData = new Array(cotHeaders.length).fill('');
  if (filaExistente) {
    // Al actualizar se parte de lo que ya tenía la fila. Si alguna columna que esta
    // función no maneja contiene una FÓRMULA, se devuelve la fórmula (no su
    // resultado): reescribir el valor calculado la convertiría en un dato muerto.
    const formulasFila = cotizacionesSheet
      .getRange(existingRowIndexCot, 1, 1, cotHeaders.length).getFormulas()[0];
    for (let c = 0; c < cotHeaders.length; c++) {
      const valor = formulasFila[c] ? formulasFila[c]
                                    : (filaExistente[c] === undefined ? '' : filaExistente[c]);
      mainQuoteRowData[c] = valor;
    }
  }

  let camposUbicados = 0;
  camposCotizacion.forEach(function (par, posicionLegado) {
    const idx = cotHeaders.indexOf(par[0]);
    if (idx > -1) {
      mainQuoteRowData[idx] = par[1];
      camposUbicados++;
    } else if (!filaExistente && posicionLegado < cotHeaders.length) {
      // La columna no existe con ese nombre (hojas viejas pueden llamarla distinto).
      // Solo en filas nuevas se respeta la posición histórica, para no perder el dato.
      mainQuoteRowData[posicionLegado] = par[1];
    }
  });
  if (camposUbicados < 5) {
    throw new Error("La hoja 'Cotizaciones' no tiene los encabezados esperados (Folio, Timestamp, AsesorCorreo, ClienteNombre, TotalGeneral...). Revisa la primera fila.");
  }

  // REVISIÓN: guardar una cotización la devuelve SIEMPRE al punto de partida del ciclo.
  // Es lo que impide que alguien apruebe un folio, le cambie los precios y lo envíe con
  // el sello de aprobado puesto: cualquier edición borra la revisión anterior y el
  // documento vuelve a la cola. El estatus que llega en `status` ya es "En Revisión".
  if (typeof revAsegurarColumnas_ === 'function' && typeof REV_COLS === 'object') {
    const headersRev = revAsegurarColumnas_(cotizacionesSheet);
    // revAsegurarColumnas_ pudo agregar columnas: la fila tiene que crecer con la hoja.
    for (let c = cotHeaders.length; c < headersRev.length; c++) cotHeaders.push(headersRev[c]);
    while (mainQuoteRowData.length < cotHeaders.length) mainQuoteRowData.push('');

    Object.keys(REV_COLS).forEach(function (k) {
      const idx = cotHeaders.indexOf(REV_COLS[k]);
      if (idx > -1) mainQuoteRowData[idx] = '';
    });
  }

  // Auto-crear la columna "Formato" si no existe, igual que se hace con "ImagenUrl".
  let formatoColIdxCot = cotHeaders.indexOf("Formato");
  if (formatoColIdxCot === -1) {
    cotizacionesSheet.getRange(1, cotHeaders.length + 1).setValue("Formato");
    cotHeaders.push("Formato");
    formatoColIdxCot = cotHeaders.length - 1;
    Logger.log("Nueva columna 'Formato' agregada de forma auto-reparable en Cotizaciones.");
  }
  while (mainQuoteRowData.length <= formatoColIdxCot) mainQuoteRowData.push('');
  mainQuoteRowData[formatoColIdxCot] = quoteData.format || DEFAULT_FORMAT_ID;

  if (existingRowIndexCot > 0) {
    cotizacionesSheet.getRange(existingRowIndexCot, 1, 1, mainQuoteRowData.length).setValues([mainQuoteRowData]);
    Logger.log(`Cotización principal actualizada en hoja: ${quoteData.folio}`);
  } else {
    // Este bloque solo se ejecuta para una cotización NUEVA.
    cotizacionesSheet.appendRow(mainQuoteRowData);
    Logger.log(`Cotización principal guardada en hoja: ${quoteData.folio}`);

    // El estatus se pasa al aviso: si la política dejó pasar la cotización sin revisión,
    // el mensaje del chat no puede decir "revísala" y enlazar a una cola donde no está.
    sendWebhookNotification(quoteData.folio, quoteData, status);
  }

  const detHeaders = detalleSheet.getRange(1, 1, 1, detalleSheet.getLastColumn()).getValues()[0];
  const folioColIdxDet = detHeaders.indexOf("FolioCotizacion");
  if (folioColIdxDet === -1) throw new Error("Columna 'FolioCotizacion' no encontrada en la hoja 'DetalleCotizaciones'.");

  const detDataValues = detalleSheet.getDataRange().getValues();
  const rowsToDelete = [];
  for (let i = detDataValues.length - 1; i >= 1; i--) {
    if (detDataValues[i][folioColIdxDet] == quoteData.folio) {
      rowsToDelete.push(i + 1);
    }
  }
  rowsToDelete.sort((a, b) => b - a).forEach(rowIndex => detalleSheet.deleteRow(rowIndex));

  if (quoteData.products && quoteData.products.length > 0) {
    const detHeadersUpdated = detalleSheet.getRange(1, 1, 1, detalleSheet.getLastColumn()).getValues()[0];
    
    // Auto-crear la columna "ImagenUrl" si no existe
    let imgUrlColIdxDet = detHeadersUpdated.indexOf("ImagenUrl");
    if (imgUrlColIdxDet === -1) {
      detalleSheet.getRange(1, detHeadersUpdated.length + 1).setValue("ImagenUrl");
      detHeadersUpdated.push("ImagenUrl");
      imgUrlColIdxDet = detHeadersUpdated.length - 1;
      Logger.log("Nueva columna 'ImagenUrl' agregada de forma auto-reparable en DetalleCotizaciones.");
    }

    // Enlace a la ficha del artículo en liverpool.com.mx. Lo aporta la extensión de Chrome
    // y es lo que permite abrir el producto DENTRO de la pantalla de revisión, en vez de
    // pedirle a quien revisa que lo busque a mano. Misma columna auto-reparable.
    const NOMBRE_COL_LINK = (typeof REV_COL_LINK_ARTICULO === 'string') ? REV_COL_LINK_ARTICULO : 'LinkArticulo';
    let linkArtColIdxDet = detHeadersUpdated.indexOf(NOMBRE_COL_LINK);
    if (linkArtColIdxDet === -1) {
      detalleSheet.getRange(1, detHeadersUpdated.length + 1).setValue(NOMBRE_COL_LINK);
      detHeadersUpdated.push(NOMBRE_COL_LINK);
      linkArtColIdxDet = detHeadersUpdated.length - 1;
      Logger.log("Nueva columna '" + NOMBRE_COL_LINK + "' agregada de forma auto-reparable en DetalleCotizaciones.");
    }

    const productDetailsRows = quoteData.products.map(p => {
      // Inicializar una fila con el ancho de las cabeceras actuales
      const row = new Array(detHeadersUpdated.length).fill('');
      
      // Asignar los valores basados en los índices correspondientes
      row[detHeadersUpdated.indexOf("FolioCotizacion")] = quoteData.folio;
      row[detHeadersUpdated.indexOf("SKU")] = p.sku || '';
      row[detHeadersUpdated.indexOf("DescripcionProducto")] = p.description || '';
      row[detHeadersUpdated.indexOf("Cantidad")] = parseInt(p.quantity) || 0;
      row[detHeadersUpdated.indexOf("PrecioUnitarioBase")] = parseFloat(p.unitPrice) || 0;
      row[detHeadersUpdated.indexOf("CostoPagoUnicoLinea")] = parseFloat(p.costPaymentUnique) || 0;
      row[detHeadersUpdated.indexOf("DescPublicoPorcentaje")] = parseFloat(p.discountPublicPercent) || 0;
      row[detHeadersUpdated.indexOf("AplicaDescAdicional")] = p.additionalDiscountApplied || 'No';
      row[detHeadersUpdated.indexOf("PorcentajeDescAdicional")] = parseFloat(p.additionalDiscountPercent) || 0;
      
      if (imgUrlColIdxDet > -1) {
        row[imgUrlColIdxDet] = p.imageUrl || '';
      }
      if (linkArtColIdxDet > -1) {
        row[linkArtColIdxDet] = p.productUrl || '';
      }

      return row;
    });
    
    detalleSheet.getRange(detalleSheet.getLastRow() + 1, 1, productDetailsRows.length, detHeadersUpdated.length)
                .setValues(productDetailsRows);
    Logger.log(`Detalles de productos guardados para folio ${quoteData.folio}: ${productDetailsRows.length} productos con ImagenUrl.`);
  }

  // La BD cambió: se tira la caché de lectura para que el panel, la supervisión y el
  // detalle del folio muestren esto en la siguiente consulta y no lo de hace un minuto.
  // Va al FINAL a propósito: si algo de arriba falla, la caché vigente sigue siendo válida.
  if (typeof cotInvalidarCache_ === 'function') cotInvalidarCache_();
}
/**
 * Guarda los datos de la cotización con estado "Folio Generado" para la vista previa.
 * quoteDataFromClient - Los datos de la cotización enviados desde el cliente.
 */
function saveQuoteAndGoToPreview(quoteDataFromClient) {
  Logger.log("saveQuoteAndGoToPreview - Datos recibidos: " + JSON.stringify(quoteDataFromClient));
  try {
    if (!quoteDataFromClient) throw new Error("No se recibieron datos de la cotización.");
    
    if (!quoteDataFromClient.advisorEmail) {
      // Respaldo cuando el cliente no manda el correo de la sesión del portal.
      quoteDataFromClient.advisorEmail = secCorreoEfectivo_('') || null;
    }
    if (!quoteDataFromClient.advisorName && quoteDataFromClient.advisorEmail) {
        const registrosSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTROS_SHEET_NAME);
        if (registrosSheet) {
            const regHeaders = registrosSheet.getRange(1,1,1,registrosSheet.getLastColumn()).getValues()[0];
            const emailIdx = regHeaders.indexOf("Email");
            const nameIdx = regHeaders.indexOf("Nombre");
            if (emailIdx > -1 && nameIdx > -1) {
                const regData = registrosSheet.getDataRange().getValues();
                const advisorRow = regData.find(row => row[emailIdx] === quoteDataFromClient.advisorEmail);
                if (advisorRow) quoteDataFromClient.advisorName = advisorRow[nameIdx];
            }
        }
    }

    // El formato que llega del cliente se valida contra los habilitados: si viene vacío o
    // apunta a un formato que ya se deshabilitó, se cae al predeterminado.
    const enabledFormats = getEnabledQuoteFormats();
    const validFormatIds = (enabledFormats.formats || []).map(f => f.id);
    if (!quoteDataFromClient.format || validFormatIds.indexOf(quoteDataFromClient.format) === -1) {
      quoteDataFromClient.format = enabledFormats.defaultId || DEFAULT_FORMAT_ID;
    }

    // Lo que la política decidió. Se declara fuera del candado porque la respuesta al
    // cliente se arma cuando el candado ya se soltó.
    let decisionRevision = { revisar: true, motivo: '', origen: '', reglaId: '' };

    // El folio se genera y se guarda bajo un candado: sin él, dos asesores cotizando al
    // mismo tiempo leen el mismo "último folio" y ambos reciben el mismo número.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error("El sistema está ocupado guardando otra cotización. Intenta de nuevo en unos segundos.");
    }
    try {
      if (!quoteDataFromClient.folio) {
        const cotizacionesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COTIZACIONES_SHEET_NAME);
        if (!cotizacionesSheet) throw new Error(`Hoja "${COTIZACIONES_SHEET_NAME}" no encontrada.`);
        quoteDataFromClient.folio = generateLvpFolio(cotizacionesSheet);
        Logger.log("Nuevo folio generado para vista previa: " + quoteDataFromClient.folio);
      } else {
        Logger.log("Actualizando cotización para vista previa con folio: " + quoteDataFromClient.folio);
      }

      quoteDataFromClient.timestamp = new Date();

      // ¿Esta cotización tiene que pasar por la cola de revisión?
      // Lo decide la política que supervisión configura en el panel avanzado
      // (PoliticaRevision.gs): puede ir por monto, descuento, formato, asesor u horario.
      // Si ese archivo no está desplegado todavía, se revisa TODO, que es el
      // comportamiento de siempre: un despliegue parcial nunca puede degradar a
      // "sale al cliente sin que nadie lo mire".
      const decision = (typeof revpolDecidirAlGuardar_ === 'function')
        ? revpolDecidirAlGuardar_(quoteDataFromClient)
        : { revisar: true, motivo: 'Política de revisión no disponible.', origen: 'sin-modulo', reglaId: '' };
      decisionRevision = decision;

      const estatusPendiente = (typeof REV_ESTATUS_PENDIENTE === 'string') ? REV_ESTATUS_PENDIENTE : 'En Revisión';
      const estatusAprobada  = (typeof REV_ESTATUS_APROBADA  === 'string') ? REV_ESTATUS_APROBADA  : 'Aprobada';
      const estatusInicial = decision.revisar ? estatusPendiente : estatusAprobada;

      saveQuoteDataToSheets(quoteDataFromClient, estatusInicial);

      // El sello va DESPUÉS de guardar: saveQuoteDataToSheets limpia las columnas de
      // revisión en cada escritura (para que editar un folio aprobado lo devuelva a la
      // cola), así que escribirlo antes lo borraría.
      if (!decision.revisar && typeof revpolSellarAprobacionAutomatica_ === 'function') {
        revpolSellarAprobacionAutomatica_(quoteDataFromClient.folio, decision);
      }
    } finally {
      lock.releaseLock();
    }

    return {
      success: true,
      folio: quoteDataFromClient.folio,
      format: quoteDataFromClient.format,
      // La pantalla de cotización necesita saberlo para no prometerle al asesor una
      // revisión que no va a ocurrir (o al revés).
      requiereRevision: decisionRevision.revisar,
      motivoRevision: decisionRevision.motivo,
      message: `Datos de cotización ${quoteDataFromClient.folio} preparados.`
    };

  } catch (error) {
    Logger.log("Error en saveQuoteAndGoToPreview: " + error.message);
    return { success: false, message: "No pudimos guardar la cotización. Inténtalo de nuevo en un momento.", folio: quoteDataFromClient ? quoteDataFromClient.folio : null };
  }
}

/**
 * Obtiene las cotizaciones para el usuario o realiza una búsqueda general.
 *
 * Pasa por la caché de lectura (Cache.gs): leer la hoja entera en cada pintado del panel es lo
 * más caro de la app, y cualquier escritura invalida la caché al instante (cotInvalidarCache_),
 * así que una cotización recién guardada aparece de inmediato. Si Cache.gs no está en el
 * proyecto, se lee la hoja directamente: la caché nunca es un requisito para funcionar.
 *
 * @param {string} callingUserEmail - El email del usuario que llama la función (asesor).
 * @param {string} searchTerm - El término de búsqueda.
 * @param {boolean} forzarRecarga - true desde el botón "Actualizar": relee la hoja sin mirar la caché.
 */
function getQuotesForUser(callingUserEmail, searchTerm, forzarRecarga) {
  const termino = String(searchTerm || '').trim();
  const correo = String(callingUserEmail || '').trim().toLowerCase();

  if (typeof cotCacheado_ !== 'function' || (!termino && !correo)) {
    return leerCotizacionesDeUsuario_(callingUserEmail, searchTerm);
  }
  const nombre = termino ? 'busq_' + cotHash_(termino) : 'lista_' + cotHash_(correo);
  const ttl = termino ? COT_TTL.busqueda : COT_TTL.listaAsesor;
  return cotCacheado_(nombre, ttl, function () {
    return leerCotizacionesDeUsuario_(callingUserEmail, searchTerm);
  }, null, forzarRecarga === true);
}

/** Lectura real de la hoja para getQuotesForUser (sin caché). */
function leerCotizacionesDeUsuario_(callingUserEmail, searchTerm) {
  Logger.log(`getQuotesForUser - Email: ${callingUserEmail}, SearchTerm: ${searchTerm}`);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COTIZACIONES_SHEET_NAME);
    if (!sheet) {
      return { success: false, quotes: null, message: `Hoja '${COTIZACIONES_SHEET_NAME}' no encontrada.` };
    }

    const allSheetData = sheet.getDataRange().getValues();
    if (allSheetData.length <= 1) {
      return { success: true, quotes: [], message: "No hay cotizaciones registradas." };
    }
    
    const headers = allSheetData.shift() || [];
    const folioIdx = headers.indexOf("Folio");
    const clienteNombreIdx = headers.indexOf("ClienteNombre");
    const timestampIdx = headers.indexOf("Timestamp");
    const totalIdx = headers.indexOf("TotalGeneral");
    const statusIdx = headers.indexOf("Estatus");
    const advisorCorreoIdx = headers.indexOf("AsesorCorreo");
    const advisorNombreIdx = headers.indexOf("AsesorNombre");
    const clienteCorreoIdx = headers.indexOf("CorreoCliente");
    const formatoIdx = headers.indexOf("Formato");

    const requiredCols = ["Folio", "ClienteNombre", "Timestamp", "TotalGeneral", "Estatus", "AsesorCorreo"];
    const missingCols = requiredCols.filter(col => headers.indexOf(col) === -1);
    if (missingCols.length > 0) {
      const errorMsg = `Columnas requeridas no encontradas en '${COTIZACIONES_SHEET_NAME}': ${missingCols.join(", ")}.`;
      return { success: false, quotes: null, message: errorMsg };
    }
    
    let resultingQuotes = [];
    // Cuando hay término de búsqueda se busca en TODO el sistema (no solo las
    // cotizaciones propias): así un asesor puede localizar el folio de otro cuando
    // lo necesita. El emparejamiento es tolerante a acentos y errores de tipeo
    // (ver fuzzyScore_): "gonzalez" encuentra "González", "jse" encuentra "José".
    const isSearch = !!(searchTerm && searchTerm.trim() !== "");
    if (isSearch) {
      const term = searchTerm.trim();
      const scored = [];
      allSheetData.forEach(row => {
        // El asesor también entra al pajar: la pregunta real detrás de una búsqueda
        // suele ser "¿esto lo hizo Ana?" tanto como "¿dónde quedó este folio?", y el
        // panel de supervisión ya ofrecía buscar por asesor sin que esto lo mirara.
        const haystack = [
          row[folioIdx], row[clienteNombreIdx], row[clienteCorreoIdx],
          advisorNombreIdx > -1 ? row[advisorNombreIdx] : '', row[advisorCorreoIdx]
        ].join(' ');
        const score = fuzzyScore_(haystack, term);
        if (score >= 0) scored.push({ row: row, score: score });
      });
      // Mayor relevancia primero; a igualdad, folio más reciente.
      scored.sort((a, b) => (b.score - a.score) || String(b.row[folioIdx] || '').localeCompare(String(a.row[folioIdx] || '')));
      resultingQuotes = scored.map(s => s.row);
    } else if (callingUserEmail) {
      const lowerCallingUserEmail = callingUserEmail.trim().toLowerCase();
      resultingQuotes = allSheetData.filter(row => String(row[advisorCorreoIdx] || '').toLowerCase() === lowerCallingUserEmail);
    } else {
      return { success: true, quotes: [], message: "Inicia sesión para ver tus cotizaciones o realiza una búsqueda." };
    }

    /* De quién es cada folio va como CORREO del asesor y no como un "es tuya" ya
       resuelto: los resultados de una búsqueda se guardan en caché por término y esa
       copia la reaprovecha todo el equipo, así que una marca calculada aquí saldría
       con la respuesta de quien buscó primero. Quién es el dueño lo decide la pantalla
       comparando con su propia sesión, que es información que ya tiene. */
    const formattedQuotes = resultingQuotes.map(row => {
      const correoAsesor = String(row[advisorCorreoIdx] || '').trim();
      return {
        folio: row[folioIdx],
        cliente: row[clienteNombreIdx],
        // El correo del cliente viaja con cada fila para que el filtro instantáneo del
        // navegador pueda buscar por él sin volver al servidor, que es la forma en que
        // más se pregunta por una cotización cuando no se tiene el folio a la mano.
        // No revela nada nuevo: getQuoteDetails ya lo entrega al abrir cualquier folio.
        correoCliente: (clienteCorreoIdx > -1 ? String(row[clienteCorreoIdx] || '') : ''),
        // En una búsqueda global la mitad de los resultados son de otros asesores y
        // sin esto no había forma de distinguirlos en la tabla.
        asesor: (advisorNombreIdx > -1 ? String(row[advisorNombreIdx] || '') : '') || correoAsesor,
        asesorCorreo: correoAsesor,
        fecha: (row[timestampIdx] instanceof Date)
                  ? row[timestampIdx].toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'numeric'})
                  : (row[timestampIdx] ? new Date(row[timestampIdx]).toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'numeric'}) : 'N/A'),
        total: parseFloat(row[totalIdx]) || 0,
        estatus: row[statusIdx] || "Pendiente",
        // 'Formato' es una columna auto-reparable: las cotizaciones viejas no la tienen.
        formato: (formatoIdx > -1 && row[formatoIdx]) ? row[formatoIdx] : DEFAULT_FORMAT_ID
      };
    });
    
    // En búsqueda se conserva el orden por relevancia calculado arriba; sin búsqueda
    // (lista propia) se ordena por folio más reciente.
    if (!isSearch) {
      formattedQuotes.sort((a, b) => (String(b.folio) || '').localeCompare(String(a.folio) || ''));
    }
    return { success: true, quotes: formattedQuotes, message: null };

  } catch (error) {
    Logger.log(`Error en getQuotesForUser: ${error.message} Stack: ${error.stack}`);
    return { success: false, quotes: null, message: "No pudimos cargar las cotizaciones. Inténtalo de nuevo en un momento." };
  }
}

/**
 * Búsqueda de cotizaciones para el BUSCADOR GENERAL (app_comando), disponible en
 * todas las pantallas.
 *
 * Es getQuotesForUser recortada a lo que cabe en una lista desplegable: unas pocas
 * filas y solo los campos que se leen ahí. Existe aparte por dos razones concretas:
 *
 *   · El buscador dispara mientras se teclea. Devolver el sistema entero —cientos de
 *     filas con productos, totales y formato— para enseñar cinco es pagar el envío
 *     completo en cada pulsación; recortar en el servidor lo vuelve barato de verdad.
 *   · Puede preguntar cualquier pantalla, incluidas las que no cargan la tabla de
 *     cotizaciones, así que no debe arrastrar el contrato del panel.
 *
 * Busca en TODO el sistema (no solo lo propio): encontrar el folio que hizo otra
 * persona del equipo es justo para lo que se abre. La caché es la misma de
 * getQuotesForUser y se invalida con cualquier guardado (cotInvalidarCache_).
 *
 * @param {string} callingUserEmail Correo de la sesión (AppSession.userEmail).
 * @param {string} termino          Folio, correo del cliente, nombre o asesor.
 * @param {number=} limite          Cuántas filas devolver (tope 25, por omisión 8).
 * @return {{success:boolean, quotes:Array, message:?string}}
 */
function buscarCotizaciones(callingUserEmail, termino, limite) {
  const term = String(termino || '').trim();
  const tope = Math.min(Math.max(parseInt(limite, 10) || 8, 1), 25);
  // Con una o dos letras no hay búsqueda que valga: traería media hoja y ninguna
  // de las filas sería la que se busca.
  if (term.length < 3) return { success: true, quotes: [], message: null };

  const base = getQuotesForUser(callingUserEmail, term, false);
  if (!base || !base.success) {
    return { success: false, quotes: [], message: (base && base.message) || 'No pudimos buscar cotizaciones.' };
  }
  const quotes = (base.quotes || []).slice(0, tope).map(function (q) {
    return {
      folio: q.folio,
      cliente: q.cliente,
      correoCliente: q.correoCliente,
      asesor: q.asesor,
      asesorCorreo: q.asesorCorreo,
      fecha: q.fecha,
      estatus: q.estatus
    };
  });
  return { success: true, quotes: quotes, message: null };
}

/**
 * Obtiene todos los detalles de una cotización específica (datos principales y lista de productos).
 * Lee DOS hojas completas, así que pasa por la caché de lectura; cualquier guardado la invalida.
 * @param {string} folio - El folio de la cotización a buscar.
 */
function getQuoteDetails(folio) {
  if (typeof cotCacheado_ === 'function' && folio) {
    return cotCacheado_('folio_' + cotHash_(folio), COT_TTL.listaAsesor, function () {
      return leerDetalleCotizacion_(folio);
    });
  }
  return leerDetalleCotizacion_(folio);
}

/** Lectura real del detalle de una cotización (sin caché). */
function leerDetalleCotizacion_(folio) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cotizacionesSheet = ss.getSheetByName(COTIZACIONES_SHEET_NAME);
    const detalleSheet = ss.getSheetByName(DETALLE_COTIZACIONES_SHEET_NAME);

    if (!cotizacionesSheet) throw new Error(`Hoja "${COTIZACIONES_SHEET_NAME}" no encontrada.`);
    if (!detalleSheet) throw new Error(`Hoja "${DETALLE_COTIZACIONES_SHEET_NAME}" no encontrada.`);
    
    const cotAllData = cotizacionesSheet.getDataRange().getValues();
    if (cotAllData.length === 0) return { success: false, message: "Todavía no hay ninguna cotización registrada." };
    const cotHeaders = cotAllData.shift() || [];
    const folioColIdxCot = cotHeaders.indexOf("Folio");
    if (folioColIdxCot === -1) throw new Error("Columna 'Folio' no encontrada en 'Cotizaciones'.");
    
    const quoteRow = cotAllData.find(row => row[folioColIdxCot] == folio);
    if (!quoteRow) return { success: false, message: "Cotización no encontrada." };

    const quoteDetails = {
      folio: quoteRow[cotHeaders.indexOf("Folio")],
      timestamp: quoteRow[cotHeaders.indexOf("Timestamp")],
      advisorEmail: quoteRow[cotHeaders.indexOf("AsesorCorreo")],
      advisorName: quoteRow[cotHeaders.indexOf("AsesorNombre")],
      advisorExt: quoteRow[cotHeaders.indexOf("Extencion")],
      clientName: quoteRow[cotHeaders.indexOf("ClienteNombre")],
      clientEmail: quoteRow[cotHeaders.indexOf("CorreoCliente")],
      clientPhone: quoteRow[cotHeaders.indexOf("Numero")],
      summarySubtotal: quoteRow[cotHeaders.indexOf("Subtotal")],
      summaryVat: quoteRow[cotHeaders.indexOf("IVA")],
      summaryTotal: quoteRow[cotHeaders.indexOf("TotalGeneral")],
      status: quoteRow[cotHeaders.indexOf("Estatus")],
      observations: quoteRow[cotHeaders.indexOf("Observaciones")],
      format: quoteRow[cotHeaders.indexOf("Formato")] || DEFAULT_FORMAT_ID
    };

    // Enlace al PDF/documento guardado, si la hoja lo tiene. El nombre de la columna ha
    // variado entre versiones de la hoja, así que se buscan los nombres conocidos.
    const linkColumnCandidates = ["LinkPDF", "PDFLink", "LinkDrive", "PdfLink", "LinkArchivo"];
    const linkColIdx = linkColumnCandidates
      .map(name => cotHeaders.indexOf(name))
      .find(idx => idx > -1);
    quoteDetails.driveLink = (linkColIdx !== undefined) ? String(quoteRow[linkColIdx] || '') : '';

    const cclLinkIdx = cotHeaders.indexOf("LinkSheetCCL");
    quoteDetails.cclSheetLink = (cclLinkIdx > -1) ? String(quoteRow[cclLinkIdx] || '') : '';

    // Estado de la revisión (Revision.gs). Va en el detalle porque TODAS las pantallas
    // que muestran una cotización necesitan saber si ya está autorizada: la consulta para
    // decidir si enseña el botón "Revisar" y si desbloquea el envío, y la propia revisión
    // para saber si se está reabriendo algo ya cerrado.
    const colsRev = (typeof REV_COLS === 'object') ? REV_COLS : null;
    if (colsRev) {
      const leerRev = function (nombreCol) {
        const idx = cotHeaders.indexOf(nombreCol);
        return idx > -1 ? quoteRow[idx] : '';
      };
      const fechaRev = leerRev(colsRev.fecha);
      const estadoRev = String(leerRev(colsRev.estado) || '');
      quoteDetails.revision = {
        estado: estadoRev,
        por: String(leerRev(colsRev.por) || ''),
        nombre: String(leerRev(colsRev.nombre) || ''),
        fecha: (fechaRev instanceof Date) ? fechaRev.toISOString() : String(fechaRev || ''),
        notas: String(leerRev(colsRev.notas) || ''),
        // Las cotizaciones anteriores a la revisión no tienen RevisionEstado: para ellas
        // vale el estatus de siempre, o se bloquearía trabajo ya entregado al cliente.
        aprobada: estadoRev
          ? (estadoRev === REV_ESTATUS_APROBADA)
          : (quoteDetails.status === REV_ESTATUS_APROBADA || quoteDetails.status === REV_ESTATUS_ENVIADA)
      };

      // Espejo de lo que hace revPuedeEnviarse_ (la autoridad real, en el servidor): si la
      // revisión está desactivada, la pantalla tiene que desbloquear el envío igual, o el
      // asesor vería "en revisión" para siempre sobre un folio que el servidor sí dejaría salir.
      // Un RECHAZO sigue bloqueando: apagar la política no borra un "no" que alguien escribió.
      try {
        if (typeof revpolLeer_ === 'function' && revpolLeer_().exigirRevision === false &&
            estadoRev !== REV_ESTATUS_RECHAZADA) {
          quoteDetails.revision.aprobada = true;
          quoteDetails.revision.revisionDesactivada = true;
        }
      } catch (e) {
        Logger.log('getQuoteDetails: no se pudo leer la política de revisión: ' + e.message);
      }
    } else {
      quoteDetails.revision = { estado: '', por: '', nombre: '', fecha: '', notas: '', aprobada: true };
    }

    if (quoteDetails.timestamp && quoteDetails.timestamp instanceof Date) {
        quoteDetails.timestamp = quoteDetails.timestamp.toISOString();
    } else if (quoteDetails.timestamp) { 
        const parsedDate = new Date(quoteDetails.timestamp);
        if (!isNaN(parsedDate)) quoteDetails.timestamp = parsedDate.toISOString();
    }
    
    quoteDetails.products = [];
    const detAllData = detalleSheet.getDataRange().getValues();
    if (detAllData.length > 1) {
        const detHeaders = detAllData.shift() || [];
        const folioColIdxDet = detHeaders.indexOf("FolioCotizacion");
        const productRows = detAllData.filter(row => row[folioColIdxDet] == folio);
        
        quoteDetails.products = productRows.map(productRow => ({
          sku: productRow[detHeaders.indexOf("SKU")] || '',
          description: productRow[detHeaders.indexOf("DescripcionProducto")] || '',
          quantity: parseInt(productRow[detHeaders.indexOf("Cantidad")]) || 0,
          unitPrice: parseFloat(productRow[detHeaders.indexOf("PrecioUnitarioBase")]) || 0,
          costPaymentUnique: parseFloat(productRow[detHeaders.indexOf("CostoPagoUnicoLinea")]) || 0,
          discountPublicPercent: parseFloat(productRow[detHeaders.indexOf("DescPublicoPorcentaje")]) || 0,
          additionalDiscountApplied: productRow[detHeaders.indexOf("AplicaDescAdicional")] || 'No',
          additionalDiscountPercent: parseFloat(productRow[detHeaders.indexOf("PorcentajeDescAdicional")]) || 0,
          imageUrl: detHeaders.indexOf("ImagenUrl") > -1 ? (productRow[detHeaders.indexOf("ImagenUrl")] || '') : '',
          // Enlace a la ficha del artículo (columna que llena la extensión de Chrome).
          // Se devuelve CRUDO; quien lo va a incrustar lo valida antes (revUrlArticuloSegura_).
          productUrl: detHeaders.indexOf("LinkArticulo") > -1 ? (productRow[detHeaders.indexOf("LinkArticulo")] || '') : ''
        }));
    }
    
    Logger.log(`Detalles recuperados para folio ${folio}: ${quoteDetails.products.length} productos.`);
    return { success: true, quote: quoteDetails };

  } catch (error) {
    Logger.log("Error en getQuoteDetails para folio " + folio + ": " + error.message + " Stack: " + error.stack);
    return { success: false, message: "No pudimos abrir esta cotización. Inténtalo de nuevo en un momento." };
  }
}


/**
 * Obtiene todas las estadísticas necesarias para el dashboard avanzado.
 * El panel avanzado pide en la misma carga estadísticas, supervisión y métricas: sin caché son
 * tres lecturas completas de la misma hoja. Con ella, la primera paga y las otras van a memoria.
 * @return {object} Un objeto con todas las métricas calculadas.
 */
function getDashboardStats() {
  if (typeof cotCacheado_ === 'function') {
    return cotCacheado_('dashboard', COT_TTL.supervision, function () { return calcularDashboardStats_(); });
  }
  return calcularDashboardStats_();
}

/** Cálculo real de las estadísticas del dashboard (sin caché). */
function calcularDashboardStats_() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COTIZACIONES_SHEET_NAME);
    if (!sheet) throw new Error(`Hoja '${COTIZACIONES_SHEET_NAME}' no encontrada.`);

    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) {
      return { success: true, stats: { currentMonthCount: 0, previousMonthCount: 0, quotesPerUser: [], last7Days: [], today: [], lastQuotes: [] } };
    }
    
    const headers = values.shift();
    const colMap = {};
    headers.forEach((h, i) => colMap[h] = i);

    const now = new Date();
    const firstDayCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstDayNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const firstDayPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    let currentMonthCount = 0;
    let previousMonthCount = 0;
    const quotesPerUserCurrentMonth = {};
    const activityQuotes = [];

    values.forEach(row => {
      const quoteDate = new Date(row[colMap["Timestamp"]]);
      if (isNaN(quoteDate.getTime())) return;

      const advisorName = row[colMap["AsesorNombre"]] || 'No asignado';

      if (quoteDate >= firstDayCurrentMonth && quoteDate < firstDayNextMonth) {
        currentMonthCount++;
        quotesPerUserCurrentMonth[advisorName] = (quotesPerUserCurrentMonth[advisorName] || 0) + 1;
      }
      
      if (quoteDate >= firstDayPreviousMonth && quoteDate < firstDayCurrentMonth) {
        previousMonthCount++;
      }
      
      activityQuotes.push({
          rawDate: quoteDate,
          advisorName: advisorName,
          clientName: row[colMap["ClienteNombre"]] || 'N/A',
          folio: row[colMap["Folio"]] || 'N/A'
      });
    });

    // --- CORRECCIÓN AQUÍ ---
    // Se construyen objetos nuevos explícitamente para evitar enviar el objeto 'rawDate' (que no es serializable) al cliente.
    // Esto evita que la función devuelva 'null' y cause el error en el frontend.
    const today = activityQuotes
      .filter(q => q.rawDate >= todayStart)
      .sort((a,b) => b.rawDate - a.rawDate)
      .map(q => ({
          advisorName: q.advisorName,
          clientName: q.clientName,
          folio: q.folio
      }));

    const last7Days = activityQuotes
      .filter(q => q.rawDate >= sevenDaysAgo)
      .sort((a,b) => b.rawDate - a.rawDate)
      .map(q => ({
          advisorName: q.advisorName,
          clientName: q.clientName,
          folio: q.folio
      }));


    const sortedValues = values
        .slice()
        .sort((a, b) => new Date(b[colMap["Timestamp"]]) - new Date(a[colMap["Timestamp"]]));

    const lastQuotes = sortedValues.slice(0, 5).map(row => ({
        folio: row[colMap["Folio"]],
        cliente: row[colMap["ClienteNombre"]],
        fecha: new Date(row[colMap["Timestamp"]]).toLocaleDateString('es-MX'),
        total: parseFloat(row[colMap["TotalGeneral"]]) || 0,
        estatus: row[colMap["Estatus"]],
        // 'Formato' es auto-reparable: si la columna no existe, colMap la deja indefinida.
        formato: row[colMap["Formato"]] || DEFAULT_FORMAT_ID
    }));

    const quotesPerUserArray = Object.entries(quotesPerUserCurrentMonth)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

    return {
      success: true,
      stats: {
        currentMonthCount,
        previousMonthCount,
        quotesPerUser: quotesPerUserArray,
        last7Days,
        today,
        lastQuotes
      }
    };
  } catch (error) {
    Logger.log("Error en getDashboardStats: " + error.message + " Stack: " + error.stack);
    return { success: false, message: "No pudimos calcular el resumen. Inténtalo de nuevo en un momento." };
  }
}

/**
 * Devuelve TODAS las cotizaciones con los campos que necesita el panel de supervisión
 * (búsqueda, filtros, rango de fechas y exportación a reporte se hacen en el cliente).
 * Solo para usuarios avanzados.
 * @param {string} email - Correo del usuario que consulta.
 * @return {object} { success, quotes: [...] } o { success: false, message }
 */
function getSupervisionQuotes(email) {
  try {
    // El permiso se resuelve contra la identidad REAL de quien llama (Seguridad.gs),
    // no contra el correo que manda el navegador: si no, bastaba con llamar esta
    // función con el correo de un supervisor para ver todas las cotizaciones.
    const id = secIdentidadConBloque_(email, 'supervision');
    if (!id.ok) {
      return { success: false, message: id.error || "No tienes permisos para ver el panel de supervisión." };
    }

    // El permiso ya se resolvió arriba: de aquí en adelante el dato es idéntico para
    // todos los avanzados, así que la caché es compartida (Cache.gs) y se invalida
    // en cuanto alguien guarda o envía una cotización.
    if (typeof cotCacheado_ === 'function') {
      return cotCacheado_('supervision', COT_TTL.supervision, function () { return leerSupervision_(); });
    }
    return leerSupervision_();
  } catch (error) {
    Logger.log("Error en getSupervisionQuotes: " + error.message + " Stack: " + error.stack);
    return { success: false, message: "No pudimos cargar las cotizaciones. Inténtalo de nuevo en un momento." };
  }
}

/** Lectura real de todas las cotizaciones para el panel de supervisión (sin caché). */
function leerSupervision_() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COTIZACIONES_SHEET_NAME);
    if (!sheet) throw new Error(`Hoja '${COTIZACIONES_SHEET_NAME}' no encontrada.`);

    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return { success: true, quotes: [] };

    const headers = values.shift();
    const col = {};
    headers.forEach((h, i) => col[h] = i);

    const quotes = values.map(row => {
      const rawDate = row[col["Timestamp"]];
      const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
      return {
        folio: String(row[col["Folio"]] || ''),
        // ISO para que el cliente pueda filtrar por rango de fechas sin ambigüedad.
        timestamp: isNaN(date.getTime()) ? '' : date.toISOString(),
        advisorName: String(row[col["AsesorNombre"]] || 'No asignado'),
        advisorEmail: String(row[col["AsesorCorreo"]] || ''),
        clientName: String(row[col["ClienteNombre"]] || ''),
        clientEmail: String(row[col["CorreoCliente"]] || ''),
        subtotal: parseFloat(row[col["Subtotal"]]) || 0,
        vat: parseFloat(row[col["IVA"]]) || 0,
        total: parseFloat(row[col["TotalGeneral"]]) || 0,
        status: String(row[col["Estatus"]] || 'Pendiente'),
        // El resultado DURADERO de la revisión (Revision.gs). Va aparte de "Estatus" porque
        // este último se sobrescribe con "Enviada por Correo" al mandar la cotización, y sin
        // esta columna el panel no podría distinguir un folio que nadie ha revisado de uno
        // aprobado y ya entregado. La cola de pendientes se arma con este dato.
        revisionEstado: (col["RevisionEstado"] !== undefined)
          ? String(row[col["RevisionEstado"]] || '') : '',
        revisionPor: (col["RevisadoNombre"] !== undefined)
          ? String(row[col["RevisadoNombre"]] || '') : '',
        format: (col["Formato"] !== undefined && row[col["Formato"]]) ? String(row[col["Formato"]]) : DEFAULT_FORMAT_ID,
        observations: String(row[col["Observaciones"]] || '')
      };
    }).filter(q => q.folio);

    quotes.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    return { success: true, quotes: quotes };
  } catch (error) {
    Logger.log("Error en getSupervisionQuotes: " + error.message + " Stack: " + error.stack);
    return { success: false, message: "No pudimos cargar las cotizaciones. Inténtalo de nuevo en un momento." };
  }
}

/**
 * Avisa por Webhook (Google Chat) que hay una cotización esperando revisión.
 *
 * El mensaje lleva el ENLACE DIRECTO a la pantalla de revisión de ese folio: quien
 * supervisa abre el chat, toca el enlace y ya está en el documento. Antes solo llegaba
 * el número de folio y había que buscarlo a mano en el panel.
 *
 * @param {string} folio - El folio de la cotización recién creada.
 * @param {object=} quoteData - Datos de la cotización, para dar contexto en el mensaje.
 * @param {string=} estatus - Estatus con el que nació. Si la política la dejó pasar sin
 *        revisión, el aviso lo dice en vez de mandar a supervisión a una cola vacía.
 */
function sendWebhookNotification(folio, quoteData, estatus) {
  // La URL trae una llave de Google Chat: se lee de las propiedades del script si
  // está configurada (recomendado) y solo si no, de la constante del archivo.
  const url = secConfig_('WEBHOOK_URL', WEBHOOK_URL);
  if (!url) {
    Logger.log("URL de Webhook no configurada. Omitiendo notificación.");
    return;
  }

  try {
    const q = quoteData || {};
    const enlace = (typeof revUrlPantalla_ === 'function') ? revUrlPantalla_(folio) : '';

    const detalles = [];
    if (q.clientName)   detalles.push('Cliente: ' + q.clientName);
    if (q.advisorName)  detalles.push('Asesor: ' + q.advisorName);
    if (q.summaryTotal) detalles.push('Total: ' + formatCurrencyGS(q.summaryTotal));

    const aprobadaSola = (typeof REV_ESTATUS_APROBADA === 'string')
      ? (estatus === REV_ESTATUS_APROBADA)
      : (estatus === 'Aprobada');

    // Formato de texto de Google Chat: *negritas* y <url|texto> para el enlace.
    // Una cotización que salió sin revisión SÍ se anuncia: que no necesite aprobación no
    // significa que supervisión no deba enterarse de que existe.
    const message = aprobadaSola
      ? `*${folio}* · nueva cotización *aprobada automáticamente*` +
        (detalles.length ? `\n${detalles.join(' · ')}` : '') +
        `\nLa política de revisión permitió enviarla sin aprobación manual.` +
        (enlace ? `\n<${enlace}|Ver la cotización>` : `\nÁbrela en el sistema con el folio ${folio}.`)
      : `*${folio}* · nueva cotización *en revisión*` +
        (detalles.length ? `\n${detalles.join(' · ')}` : '') +
        `\nNo se puede enviar al cliente hasta que alguien la apruebe.` +
        (enlace ? `\n<${enlace}|Revisar la cotización>` : `\nÁbrela en el sistema con el folio ${folio}.`);

    const payload = { 'text': message };

    const options = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify(payload),
      'muteHttpExceptions': true
    };

    UrlFetchApp.fetch(url, options);
    Logger.log(`Notificación de webhook enviada para el folio: ${folio}`);
  } catch (error) {
    Logger.log(`Error al enviar la notificación de webhook para el folio ${folio}: ${error.message}`);
  }
}

/**
 * =================================================================================================
 * BÚSQUEDA TOLERANTE A ERRORES (FUZZY)
 * =================================================================================================
 * Utilidades para que el buscador de cotizaciones encuentre resultados aunque el usuario
 * escriba sin acentos ("gonzalez" → "González"), con mayúsculas distintas o con pequeños
 * errores de tipeo ("jse" → "José", "cotisacion" → cliente "Cotización"). Se usa en
 * getQuotesForUser y en buscarCotizaciones. El equivalente del navegador vive en
 * app_buscar.html (mismo criterio) para que ambos encuentren lo mismo.
 *
 * LO QUE SE BUSCA AQUÍ son dos datos que casi nunca llegan completos ni bien escritos:
 *
 *   · El FOLIO. Se dicta por teléfono, se copia de un chat y se teclea a mano, así que
 *     aparece como "LVP-2024-118", "lvp2024118", "2024 118" o solo "118". Comparar en
 *     crudo fallaba en tres de esos cuatro casos; ahora se compara también la forma
 *     COMPACTA (sin guiones ni espacios) y cada tramo por separado.
 *
 *   · El CORREO DEL CLIENTE. Buscarlo entero no acertaba si en la hoja estaba escrito
 *     con otro punto o con mayúsculas, y buscar "ana lopez" no llegaba al correo.
 *     Ahora el correo se parte en sus palabras ("ana", "lopez", "liverpool") y se
 *     compara por los dos lados.
 */

/** Normaliza texto: minúsculas, sin acentos/diacríticos y sin espacios sobrantes. */
function normalizeText_(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos/diacríticos
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Solo letras y dígitos: la forma en que se teclean folios y números de pedido. */
function compactText_(s) {
  return normalizeText_(s).replace(/[^a-z0-9]/g, '');
}

/**
 * Palabras de un texto, partiendo también en la frontera letra/dígito y por los
 * signos del correo: "LVP-2024-118" → ["lvp","2024","118"] y
 * "ana.lopez@liverpool.com.mx" → ["ana","lopez","liverpool","com","mx"].
 */
function searchTokens_(s) {
  return normalizeText_(s)
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(function (t) { return t; });
}

/** Distancia de edición (Levenshtein) entre dos cadenas ya normalizadas. */
function levenshtein_(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = [i];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[bl];
}

/** Errores de tipeo tolerados según qué tan larga es la palabra buscada. */
function fuzzyTolerance_(len) {
  if (len <= 3) return 0; // palabras muy cortas: coincidencia exacta para no traer ruido
  if (len <= 5) return 1;
  if (len <= 8) return 2;
  return 3;
}

/**
 * Puntúa qué tan bien coincide `term` con `text`. Devuelve -1 si NO hay coincidencia.
 * Semántica AND: cada palabra de la búsqueda debe encontrar algo en el texto.
 * A mayor puntaje, más relevante (una coincidencia literal pesa más que una difusa).
 * @param {string} text - Texto donde buscar (p.ej. folio + cliente + correo).
 * @param {string} term - Lo que escribió el usuario.
 * @return {number} Puntaje de relevancia, o -1 si no coincide.
 */
function fuzzyScore_(text, term) {
  const q = normalizeText_(term);
  if (!q) return 0;
  const t = normalizeText_(text);
  if (!t) return -1;

  // Coincidencia directa de toda la frase: lo más fuerte (más temprana = mejor).
  // Que TERMINE donde termina una palabra vale aparte, y mucho: buscando
  // "LVP-2024-118" el folio exacto tiene que ganarle a "LVP-2024-1180", que también
  // lo contiene. Sin ese desempate el folio correcto salía en segundo lugar.
  const idx = t.indexOf(q);
  if (idx !== -1) {
    const sigue = t.charAt(idx + q.length);
    return 3000 - idx + (sigue === '' || !/[a-z0-9]/.test(sigue) ? 400 : 0);
  }

  // La misma frase con otros separadores. Es el caso del folio dictado: en la hoja
  // dice "LVP-2024-118" y en el buscador se escribió "lvp2024118" o "lvp 2024 118".
  // Sin esto, la búsqueda más común del sistema no encontraba nada.
  const qc = compactText_(term);
  if (qc.length >= 3) {
    // Se compara contra cada "palabra" del texto ya compactada, para poder distinguir
    // el folio completo de otro que solo empieza igual.
    const trozos = t.split(' ');
    for (let z = 0; z < trozos.length; z++) {
      const tz = compactText_(trozos[z]);
      if (!tz) continue;
      if (tz === qc) return 3300;
      if (tz.indexOf(qc) === 0) return 2900;
    }
    const ic = compactText_(text).indexOf(qc);
    if (ic !== -1) return 2600 - ic;
  }

  const qTokens = searchTokens_(term);
  const tTokens = searchTokens_(text);
  if (qTokens.length === 0 || tTokens.length === 0) return -1;

  let total = 0;
  for (let i = 0; i < qTokens.length; i++) {
    const qt = qTokens[i];
    let best = -1;
    for (let j = 0; j < tTokens.length; j++) {
      const tt = tTokens[j];
      if (tt === qt) { best = Math.max(best, 200); continue; }
      if (tt.indexOf(qt) === 0) { best = Math.max(best, 160); continue; }     // prefijo de palabra
      if (tt.indexOf(qt) !== -1) { best = Math.max(best, 120); continue; }    // dentro de la palabra
      const tol = fuzzyTolerance_(qt.length);
      if (tol > 0) {
        const d = levenshtein_(qt, tt);
        if (d <= tol) { best = Math.max(best, 90 - d * 10); continue; }
        // Nombres largos con typo: compara contra el inicio de la palabra del texto.
        if (tt.length > qt.length) {
          const d2 = levenshtein_(qt, tt.substring(0, qt.length));
          if (d2 <= tol) best = Math.max(best, 70 - d2 * 10);
        }
      }
    }
    if (best < 0) return -1; // esta palabra no encontró nada → la búsqueda no coincide
    total += best;
  }
  return total;
}

