/**
 * ===============================================================================
 * ONBOARDING · qué tutorial ya vio cada persona
 * ===============================================================================
 * Un recorrido guiado solo sirve la primera vez. A partir de la segunda estorba, y
 * si estorba la gente aprende a cerrarlo sin leerlo —que es peor que no tenerlo—.
 * Por eso lo visto se ANOTA, y se anota en una hoja y no solo en el navegador:
 * localStorage se borra al limpiar el caché, se queda en el equipo de la sucursal y
 * no viaja con la persona. Alguien que entra desde otra computadora no debería
 * volver a ver el tutorial de bienvenida como si fuera nuevo.
 *
 * QUÉ SE GUARDA: una fila por persona y pantalla. Nada de lo que se guarda es
 * sensible —qué tutorial vio alguien y cuándo—, así que no hay razón para cifrarlo
 * ni para esconderlo; sí la hay para poder consultarlo, porque "¿la gente termina
 * el tutorial o lo salta en el paso 2?" es justo lo que dice si el tutorial sirve.
 *
 * OMITIR CUENTA COMO VISTO. Quien salta el recorrido está diciendo "ya sé usar
 * esto"; volvérselo a poner en la siguiente pantalla es no escuchar. El botón de
 * "Ver el tutorial" queda siempre a la mano para el que cambie de opinión.
 *
 * ESTO NO ES UN CANDADO: si la hoja falla o no hay red, el cliente cae a lo que
 * tenga guardado en el navegador. El peor caso es ver un tutorial de más o de
 * menos, y ninguno de los dos justifica dejar una pantalla sin abrir.
 *
 * REGISTROS_SHEET_NAME y secIdentidad_ viven en Code.gs / Seguridad.gs (mismo
 * ámbito global de Apps Script).
 */

const ONB_SHEET_NAME = 'Onboarding';
const ONB_HEADERS = ['Correo', 'Pantalla', 'Version', 'Estado', 'PasoFinal', 'TotalPasos', 'Actualizado'];

/** Estados válidos. Cualquier otra cosa que llegue se guarda como 'completado'. */
const ONB_ESTADOS = ['completado', 'omitido'];

/** Caché de lectura: la hoja se escribe una vez por persona y pantalla, en toda su vida. */
const ONB_CACHE_TTL = 300; // 5 min

/**
 * Hoja de onboarding, creada al vuelo la primera vez.
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function onbHoja_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(ONB_SHEET_NAME);
  if (!hoja) {
    hoja = ss.insertSheet(ONB_SHEET_NAME);
    hoja.appendRow(ONB_HEADERS);
    hoja.getRange(1, 1, 1, ONB_HEADERS.length).setFontWeight('bold');
    hoja.setFrozenRows(1);
    hoja.setColumnWidth(1, 240);
    hoja.setColumnWidth(2, 150);
  }
  return hoja;
}

/** Normaliza una clave de pantalla: minúsculas, sin espacios ni sorpresas. */
function onbClavePantalla_(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '').slice(0, 40);
}

function onbClaveCache_(email) {
  return 'onb_v1_' + String(email || '').toLowerCase();
}

/**
 * Qué recorridos ya vio esta persona.
 *
 * Devuelve un mapa pantalla → versión vista. La VERSIÓN es lo que permite volver a
 * enseñar el recorrido de una pantalla que cambió de fondo, sin obligar a repetir
 * todos los demás: se sube el número de esa pantalla y solo esa vuelve a salir.
 *
 * @param {string} emailCliente Correo con el que se inició sesión (AppSession.userEmail).
 * @return {{success:boolean, vistos:Object<string,number>, message:string}}
 */
function onbEstado(emailCliente) {
  try {
    const id = secIdentidad_(emailCliente);
    // Sin identidad válida no hay nada que consultar, pero tampoco es un error que
    // deba pintarse en pantalla: el cliente se queda con lo que tenga en el navegador.
    if (!id.ok) return { success: false, vistos: {}, message: id.error || 'Sesión no válida.' };

    const cache = CacheService.getUserCache();
    const clave = onbClaveCache_(id.email);
    try {
      const guardado = cache.get(clave);
      if (guardado) return { success: true, vistos: JSON.parse(guardado), message: '' };
    } catch (e) { /* caché ilegible: se lee la hoja */ }

    const vistos = onbLeerVistos_(id.email);
    try { cache.put(clave, JSON.stringify(vistos), ONB_CACHE_TTL); } catch (e) {}
    return { success: true, vistos: vistos, message: '' };
  } catch (e) {
    Logger.log('onbEstado error: ' + e);
    return { success: false, vistos: {}, message: e.message };
  }
}

/** Lee de la hoja el mapa pantalla → versión de una persona. */
function onbLeerVistos_(email) {
  const hoja = onbHoja_();
  const filas = hoja.getDataRange().getValues();
  const buscado = String(email || '').trim().toLowerCase();
  const vistos = {};
  for (let i = 1; i < filas.length; i++) {
    if (String(filas[i][0] || '').trim().toLowerCase() !== buscado) continue;
    const pantalla = onbClavePantalla_(filas[i][1]);
    if (!pantalla) continue;
    const version = Number(filas[i][2]) || 1;
    // Si por lo que sea hay dos filas de la misma pantalla, manda la versión más alta.
    if (!vistos[pantalla] || version > vistos[pantalla]) vistos[pantalla] = version;
  }
  return vistos;
}

/**
 * Anota que esta persona ya vio (o saltó) el recorrido de una pantalla.
 *
 * Es idempotente: si ya existe la fila de esa pantalla, se actualiza en vez de
 * apilar filas. Nunca lanza —fallar al anotar no debe romper la pantalla que el
 * asesor está usando—, solo devuelve success:false.
 *
 * @param {string} emailCliente Correo con el que se inició sesión.
 * @param {{pantalla:string, version:number, estado:string, paso:number, total:number}} datos
 * @return {{success:boolean, message:string}}
 */
function onbMarcar(emailCliente, datos) {
  datos = datos || {};
  try {
    const id = secIdentidad_(emailCliente);
    if (!id.ok) return { success: false, message: id.error || 'Sesión no válida.' };

    const pantalla = onbClavePantalla_(datos.pantalla);
    if (!pantalla) return { success: false, message: 'Falta la pantalla.' };

    const version = Number(datos.version) || 1;
    const estado = ONB_ESTADOS.indexOf(String(datos.estado || '').toLowerCase()) !== -1
      ? String(datos.estado).toLowerCase() : 'completado';

    // El candado evita que dos pestañas abiertas a la vez escriban dos filas de la
    // misma pantalla. Si no se consigue en 5 s se escribe igual: una fila duplicada
    // es un problema menor —onbLeerVistos_ se queda con la versión más alta— y
    // perder la anotación significa que el tutorial vuelve a salir mañana.
    const lock = LockService.getScriptLock();
    let conCandado = false;
    try { conCandado = lock.tryLock(5000); } catch (e) {}

    try {
      const hoja = onbHoja_();
      const filas = hoja.getDataRange().getValues();
      const buscado = id.email.toLowerCase();
      let fila = 0;
      for (let i = 1; i < filas.length; i++) {
        if (String(filas[i][0] || '').trim().toLowerCase() === buscado &&
            onbClavePantalla_(filas[i][1]) === pantalla) { fila = i + 1; break; }
      }

      const valores = [
        id.email, pantalla, version, estado,
        Number(datos.paso) || 0, Number(datos.total) || 0, new Date()
      ];
      if (fila) hoja.getRange(fila, 1, 1, ONB_HEADERS.length).setValues([valores]);
      else hoja.appendRow(valores);
    } finally {
      if (conCandado) { try { lock.releaseLock(); } catch (e) {} }
    }

    try { CacheService.getUserCache().remove(onbClaveCache_(id.email)); } catch (e) {}
    return { success: true, message: '' };
  } catch (e) {
    Logger.log('onbMarcar error: ' + e);
    return { success: false, message: e.message };
  }
}

/**
 * Borra lo anotado para que los recorridos vuelvan a salir.
 *
 * Solo sobre uno mismo: "quiero volver a ver el tutorial" es una decisión personal,
 * y reiniciárselo a otro sin avisar es hacerle aparecer una capa encima de su
 * pantalla en medio de una cotización.
 *
 * @param {string} emailCliente Correo con el que se inició sesión.
 * @param {string=} pantalla Clave de una pantalla; vacío = todas.
 * @return {{success:boolean, borrados:number, message:string}}
 */
function onbReiniciar(emailCliente, pantalla) {
  try {
    const id = secIdentidad_(emailCliente);
    if (!id.ok) return { success: false, borrados: 0, message: id.error || 'Sesión no válida.' };

    const clave = onbClavePantalla_(pantalla);
    const hoja = onbHoja_();
    const filas = hoja.getDataRange().getValues();
    const buscado = id.email.toLowerCase();

    // De abajo hacia arriba: borrar de arriba hacia abajo mueve las filas siguientes
    // y se acaban saltando la mitad.
    let borrados = 0;
    for (let i = filas.length - 1; i >= 1; i--) {
      if (String(filas[i][0] || '').trim().toLowerCase() !== buscado) continue;
      if (clave && onbClavePantalla_(filas[i][1]) !== clave) continue;
      hoja.deleteRow(i + 1);
      borrados++;
    }

    try { CacheService.getUserCache().remove(onbClaveCache_(id.email)); } catch (e) {}
    return { success: true, borrados: borrados, message: '' };
  } catch (e) {
    Logger.log('onbReiniciar error: ' + e);
    return { success: false, borrados: 0, message: e.message };
  }
}
