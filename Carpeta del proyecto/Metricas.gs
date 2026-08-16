/**
 * ===============================================================================
 * MÉTRICAS DE CORREOS ENVIADOS
 * ===============================================================================
 * Registro unificado de TODOS los correos que salen de la app (cotizaciones con
 * PDF + plantillas a cliente), para poder medir la actividad por asesor, por día
 * y por tipo de envío.
 *
 * "Debe estar logueado para poder hacerlo": como la sesión de la app vive solo en
 * el navegador (AppSession en localStorage, sin token de servidor), aquí se exige
 * que el correo del asesor que envía EXISTA en la hoja "Registros" (usuario dado de
 * alta con loginUser). Si no está registrado, el envío se rechaza en el servidor.
 *
 * Todo se guarda en la hoja "MetricasCorreos" de la misma BD de cotizaciones. Es
 * ADITIVO: no reemplaza la bitácora "CorreosEnviados" de CorreoCliente.gs (esa
 * sigue igual); esta hoja es la fuente única para métricas de ambos canales.
 *
 * REGISTROS_SHEET_NAME, MAIL_ALIAS y demás constantes viven en Code.gs / Correos.gs
 * (mismo ámbito global de Apps Script).
 */

const MET_SHEET_NAME = 'MetricasCorreos';
const MET_HEADERS = [
  'Fecha', 'Tipo', 'Referencia', 'AsesorEmail', 'AsesorNombre',
  'Para', 'Destinatarios', 'CC', 'CCO', 'Asunto', 'Adjuntos',
  'Remitente', 'AliasUsado', 'Resultado', 'Detalle',
  // T9.4: 'Sí' | 'No' | '' cuando no se puede saber. Ver enviarCorreoPlantilla (CorreoCliente.gs).
  'PlantillaModificada'
];

/**
 * Gate de sesión: confirma que el correo del asesor está registrado en "Registros".
 * @param {string} email correo del asesor con sesión (payload.asesor / emailData.asesor)
 * @return {{ok:boolean, email:string, nombre:string, avanzado:boolean}}
 */
function metVerificarAsesor_(email) {
  // La verificación real vive en Seguridad.gs: manda el correo con el que se inició
  // sesión en el portal y solo se acepta si está dado de alta en "Registros".
  const id = secIdentidad_(email);
  return {
    ok: id.ok,
    email: id.email,
    nombre: id.nombre,
    avanzado: id.avanzado,
    error: id.error || ''
  };
}

/**
 * Encabezados reales de la hoja, añadiendo las columnas que el código conoce y la hoja no
 * tiene todavía. Devuelve la cabecera ya completa, en el orden en que está EN LA HOJA —que no
 * tiene por qué ser el de MET_HEADERS: alguien pudo mover una columna, y mover una columna es
 * algo que la gente hace en una hoja de cálculo.
 */
function metCabecera_(sheet) {
  const ancho = Math.max(sheet.getLastColumn(), 1);
  let hdr = sheet.getRange(1, 1, 1, ancho).getValues()[0].map(function (x) { return String(x || '').trim(); });

  // Fuera las columnas vacías del final: son el ancho por omisión de la hoja, no columnas.
  while (hdr.length && hdr[hdr.length - 1] === '') hdr.pop();

  const faltan = MET_HEADERS.filter(function (h) { return hdr.indexOf(h) === -1; });
  if (faltan.length) {
    /* Primero se ESTIRA la hoja si hace falta. Una hoja a la que alguien le borró las columnas
       sobrantes de la derecha tiene exactamente las que usa, y `getRange` más allá del último
       borde no escribe nada: lanza. Y como todo esto vive dentro del try/catch de
       metRegistrarEnvio_ —que nunca revienta el envío—, el fallo se lo tragaba el Logger y las
       métricas dejaban de escribirse en silencio. */
    const necesarias = hdr.length + faltan.length;
    const maximas = sheet.getMaxColumns();
    if (maximas < necesarias) sheet.insertColumnsAfter(maximas, necesarias - maximas);

    sheet.getRange(1, hdr.length + 1, 1, faltan.length).setValues([faltan]);
    sheet.getRange(1, hdr.length + 1, 1, faltan.length).setFontWeight('bold');
    hdr = hdr.concat(faltan);
  }
  return hdr;
}

/**
 * Escribe una fila de métrica de envío. Nunca lanza: si falla, solo lo registra en
 * el Logger para no tumbar el envío (que ya se realizó).
 * @param {Object} ev {
 *   tipo, referencia, asesorEmail, asesorNombre, para, destinatarios,
 *   cc, cco, asunto, adjuntos, remitente, aliasUsado, resultado, detalle
 * }
 */
function metRegistrarEnvio_(ev) {
  ev = ev || {};
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(MET_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(MET_SHEET_NAME);
      sheet.appendRow(MET_HEADERS);
      sheet.getRange(1, 1, 1, MET_HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    /* La fila se arma POR NOMBRE de columna y no por posición, y la hoja se repara sola si le
       falta alguna de las que el código conoce.
       Las dos cosas son la misma lección: la autocreación de arriba solo actúa cuando la hoja
       NO existe, así que el día que este archivo estrenó la columna 'PlantillaModificada' las
       instalaciones vivas se quedaron con quince columnas y un appendRow de dieciséis valores
       habría empezado a escribir cada dato una casilla corrido. Es el patrón auto-reparable de
       'Formato' en Code.gs. */
    const hdr = metCabecera_(sheet);
    const valores = {
      'Fecha': new Date(),
      'Tipo': ev.tipo || '',
      'Referencia': ev.referencia || '',
      'AsesorEmail': ev.asesorEmail || '',
      'AsesorNombre': ev.asesorNombre || '',
      'Para': ev.para || '',
      'Destinatarios': ev.destinatarios || 0,
      'CC': ev.cc || 0,
      'CCO': ev.cco || 0,
      'Asunto': ev.asunto || '',
      'Adjuntos': ev.adjuntos || 0,
      'Remitente': ev.remitente || '',
      'AliasUsado': ev.aliasUsado ? 'Sí' : 'No',
      'Resultado': ev.resultado || '',
      'Detalle': ev.detalle || '',
      'PlantillaModificada': ev.plantillaModificada || ''
    };
    sheet.appendRow(hdr.map(function (nombre) {
      return Object.prototype.hasOwnProperty.call(valores, nombre) ? valores[nombre] : '';
    }));
    // Hay un envío más: el resumen cacheado (Cache.gs) ya no es el vigente.
    if (typeof cotInvalidarCache_ === 'function') cotInvalidarCache_();
  } catch (e) {
    Logger.log('metRegistrarEnvio_ no pudo registrar la métrica: ' + e);
  }
}

/**
 * Resumen de métricas para un panel (p. ej. inicio_avanzado). Solo usuarios
 * avanzados registrados pueden consultarlo.
 * @param {string} solicitanteEmail correo del asesor que pide el resumen
 * @return {Object} { success, total, enviados, errores, porTipo, porDia, porAsesor, recientes }
 */
function getResumenMetricasCorreos(solicitanteEmail) {
  try {
    const who = secIdentidadConBloque_(solicitanteEmail, 'supervision');
    if (!who.ok) return { success: false, message: who.error || 'Solo los usuarios avanzados pueden ver las métricas de correos.' };

    // Ya pasó el permiso: el resumen es el mismo para todos los avanzados, así que la
    // caché es compartida y se invalida en cuanto se registra un envío nuevo.
    if (typeof cotCacheado_ === 'function') {
      return cotCacheado_('metricas', COT_TTL.metricas, function () { return calcularResumenMetricas_(); });
    }
    return calcularResumenMetricas_();
  } catch (error) {
    Logger.log('getResumenMetricasCorreos: ' + error);
    return { success: false, message: 'No pudimos calcular el resumen. Inténtalo de nuevo en un momento.' };
  }
}

/** Cálculo real del resumen de métricas (sin caché). */
function calcularResumenMetricas_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(MET_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, total: 0, enviados: 0, errores: 0, porTipo: {}, porDia: [], porAsesor: [], recientes: [] };
    }

    const data = sheet.getDataRange().getValues();
    const headers = data.shift();
    const idx = name => headers.indexOf(name);
    const iFecha = idx('Fecha'), iTipo = idx('Tipo'), iRef = idx('Referencia'),
          iAsesor = idx('AsesorEmail'), iNombre = idx('AsesorNombre'),
          iPara = idx('Para'), iAsunto = idx('Asunto'), iRes = idx('Resultado');
    const tz = Session.getScriptTimeZone();

    let total = 0, enviados = 0, errores = 0;
    const porTipo = {}, porAsesorMap = {}, porDiaMap = {};

    data.forEach(row => {
      const ok = /enviad/i.test(String(row[iRes] || ''));
      total++; ok ? enviados++ : errores++;

      const tipo = String(row[iTipo] || '—');
      porTipo[tipo] = (porTipo[tipo] || 0) + 1;

      const email = String(row[iAsesor] || '—');
      if (!porAsesorMap[email]) porAsesorMap[email] = { email: email, nombre: String(row[iNombre] || ''), total: 0, enviados: 0 };
      porAsesorMap[email].total++;
      if (ok) porAsesorMap[email].enviados++;

      const f = row[iFecha] instanceof Date ? row[iFecha] : new Date(row[iFecha]);
      if (!isNaN(f)) {
        const dia = Utilities.formatDate(f, tz, 'yyyy-MM-dd');
        porDiaMap[dia] = (porDiaMap[dia] || 0) + 1;
      }
    });

    const recientes = [];
    for (let i = data.length - 1; i >= 0 && recientes.length < 20; i--) {
      const row = data[i];
      const f = row[iFecha] instanceof Date ? row[iFecha] : new Date(row[iFecha]);
      recientes.push({
        fecha: isNaN(f) ? '' : Utilities.formatDate(f, tz, 'dd/MM/yyyy HH:mm'),
        tipo: String(row[iTipo] || ''),
        referencia: String(row[iRef] || ''),
        asesor: String(row[iNombre] || row[iAsesor] || ''),
        para: String(row[iPara] || ''),
        asunto: String(row[iAsunto] || ''),
        resultado: String(row[iRes] || '')
      });
    }

    const porDia = Object.keys(porDiaMap).sort().slice(-30).map(d => ({ dia: d, total: porDiaMap[d] }));
    const porAsesor = Object.keys(porAsesorMap).map(k => porAsesorMap[k]).sort((a, b) => b.total - a.total);

    return { success: true, total: total, enviados: enviados, errores: errores, porTipo: porTipo, porDia: porDia, porAsesor: porAsesor, recientes: recientes };
  } catch (e) {
    Logger.log('getResumenMetricasCorreos error: ' + e);
    return { success: false, message: 'No pudimos leer las métricas. Inténtalo de nuevo en un momento.' };
  }
}
