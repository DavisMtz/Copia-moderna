/**
 * ===============================================================================
 * CORREOS A CLIENTES (página ?page=correo_cliente → correo_cliente.html)
 * ===============================================================================
 * El asesor llena una plantilla de correo en el navegador, la revisa en el modal
 * de verificación y confirma; el HTML final llega ya armado desde el cliente
 * (idéntico a la vista previa, WYSIWYG) y aquí solo se valida y se envía.
 *
 * Remitente: el MISMO que las cotizaciones — el alias MAIL_ALIAS (Correos.gs)
 * si está dado de alta como "Enviar como" en la cuenta que ejecuta el script;
 * si no, se envía desde la cuenta propia para no bloquear el envío. Las
 * respuestas del cliente llegan al asesor (replyTo).
 *
 * La plantilla de cotización NO se acepta aquí: esa se envía con su PDF desde
 * la pantalla "Enviar correo" (correoventel.html / sendQuoteByEmail).
 */

const CC_SENDER_NAME = 'Centro de Contacto Liverpool | Ventel';
const CC_PLANTILLAS_VALIDAS = ['ticket', 'edodecuenta', 'edodecuentaextranjera', 'validacionexitosa', 'formato', 'textoplano'];
const CC_EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CC_BITACORA_SHEET = 'CorreosEnviados';

// Normaliza una lista de correos (array o string separado por comas/;/espacios).
// Lanza si hay alguno inválido o se excede el máximo permitido.
function ccListaCorreos_(input, etiqueta, max) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[,;\s]+/);
  const out = [];
  raw.forEach(function (e) {
    const s = String(e || '').trim().toLowerCase();
    if (!s) return;
    if (!CC_EMAIL_RX.test(s)) throw new Error('Correo no válido en ' + etiqueta + ': ' + s);
    if (out.indexOf(s) < 0) out.push(s);
  });
  if (out.length > max) throw new Error('Máximo ' + max + ' destinatarios en ' + etiqueta + '.');
  return out;
}

/**
 * Envía al cliente un correo generado desde una plantilla.
 * @param {Object} payload {
 *   plantilla: id de plantilla (no se acepta 'cotizacion'),
 *   to:        correo(s) del cliente,
 *   cc:        string|array opcional,
 *   cco:       string|array opcional (copia oculta),
 *   asunto:    asunto ya revisado/editado por el asesor,
 *   htmlBody:  HTML final del correo (idéntico a la vista previa),
 *   adjuntos:  [{ nombre, mime, base64 }] opcional,
 *   asesor:    correo del asesor con sesión (para replyTo y bitácora)
 * }
 * @return {Object} { status:'ok', sentFrom } | { status:'error', error }
 */
function enviarCorreoPlantilla(payload) {
  try {
    if (!payload) throw new Error('No se recibieron datos.');

    // Gate de sesión: el asesor debe estar registrado (logueado) para poder enviar.
    const asesorMet = metVerificarAsesor_(payload.asesor);
    if (!asesorMet.ok) {
      return { status: 'error', error: asesorMet.error || 'Tu sesión no es válida o expiró. Inicia sesión de nuevo para poder enviar correos.' };
    }

    const plantilla = String(payload.plantilla || '').trim().toLowerCase();
    if (CC_PLANTILLAS_VALIDAS.indexOf(plantilla) < 0)
      throw new Error('Plantilla no válida para esta pantalla: ' + (plantilla || '(vacía)') +
        '. Las cotizaciones se envían desde "Enviar correo".');

    const to = ccListaCorreos_(payload.to, 'Para', 3);
    if (!to.length) throw new Error('Falta el correo del cliente (Para).');
    const cc  = ccListaCorreos_(payload.cc,  'CC',  10);
    const cco = ccListaCorreos_(payload.cco, 'CCO', 10);

    const asunto = String(payload.asunto || '').trim();
    if (!asunto) throw new Error('El asunto es obligatorio.');
    if (asunto.length > 250) throw new Error('El asunto es demasiado largo.');

    const htmlBody = String(payload.htmlBody || '');
    if (!htmlBody.trim()) throw new Error('El cuerpo del correo llegó vacío.');
    if (htmlBody.length > 400000) throw new Error('El cuerpo del correo es demasiado grande.');

    // Adjuntos: llegan como base64 desde el navegador; límite total 20 MB.
    const attachments = [];
    let totalBytes = 0;
    (payload.adjuntos || []).forEach(function (a) {
      if (!a || !a.base64) return;
      const bytes = Utilities.base64Decode(String(a.base64));
      totalBytes += bytes.length;
      if (totalBytes > 20 * 1024 * 1024) throw new Error('Los adjuntos superan el límite de 20 MB.');
      const nombre = String(a.nombre || 'adjunto').replace(/[\\\/:*?"<>|]+/g, '_');
      attachments.push(Utilities.newBlob(bytes, String(a.mime || 'application/octet-stream'), nombre));
    });

    // Las respuestas del cliente van al asesor con sesión (verificado por el gate).
    const advisorEmail = asesorMet.email;

    const options = { htmlBody: htmlBody, name: CC_SENDER_NAME };
    if (cc.length)  options.cc  = cc.join(',');
    if (cco.length) options.bcc = cco.join(',');
    if (attachments.length) options.attachments = attachments;
    if (advisorEmail) options.replyTo = advisorEmail;

    // Mismo esquema que sendQuoteByEmail (Correos.gs): se intenta el alias
    // institucional y, si el permiso de Gmail o el alias fallan, se cae a
    // MailApp (cuenta propia) para que el correo SIEMPRE salga.
    let sentFrom = '';
    let aliasAvailable = false;
    try {
      aliasAvailable = GmailApp.getAliases().indexOf(MAIL_ALIAS) !== -1;
    } catch (e) {
      Logger.log('Sin acceso a los alias de Gmail (falta permiso o alias): ' + e.message);
    }

    if (aliasAvailable) {
      try {
        GmailApp.sendEmail(to.join(','), asunto, '', Object.assign({}, options, { from: MAIL_ALIAS }));
        sentFrom = MAIL_ALIAS;
      } catch (e) {
        Logger.log('Falló el envío con alias, se reintenta por la vía clásica: ' + e.message);
        aliasAvailable = false;
      }
    }
    if (!aliasAvailable) {
      MailApp.sendEmail(to.join(','), asunto, '', options);
      sentFrom = advisorEmail || 'cuenta del script';
    }

    registrarCorreoClienteEnviado_(plantilla, to, cc, cco, asunto, advisorEmail, sentFrom, attachments.length);

    // Métrica unificada (además de la bitácora anterior).
    metRegistrarEnvio_({
      tipo: 'Plantilla cliente', referencia: plantilla,
      asesorEmail: asesorMet.email, asesorNombre: asesorMet.nombre,
      para: to.join(', '), destinatarios: to.length, cc: cc.length, cco: cco.length,
      asunto: asunto, adjuntos: attachments.length, remitente: sentFrom,
      aliasUsado: aliasAvailable, resultado: 'Enviado', detalle: ''
    });

    return { status: 'ok', sentFrom: sentFrom };
  } catch (error) {
    Logger.log('Error en enviarCorreoPlantilla: ' + error);
    // Registra el intento fallido para que las métricas reflejen también los errores.
    metRegistrarEnvio_({
      tipo: 'Plantilla cliente', referencia: String((payload && payload.plantilla) || ''),
      asesorEmail: String((payload && payload.asesor) || '').toLowerCase(),
      para: '', resultado: 'Error', detalle: error.toString()
    });
    return { status: 'error', error: error.toString() };
  }
}

// Bitácora de envíos en la hoja "CorreosEnviados" de la BD (no bloquea el envío si falla).
function registrarCorreoClienteEnviado_(plantilla, to, cc, cco, asunto, asesor, remitente, numAdjuntos) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(CC_BITACORA_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(CC_BITACORA_SHEET);
      sheet.appendRow(['Fecha', 'Plantilla', 'Para', 'CC', 'CCO', 'Asunto', 'Asesor', 'Remitente', 'Adjuntos']);
      sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), plantilla, to.join(', '), cc.join(', '), cco.join(', '),
                     asunto, asesor, remitente, numAdjuntos || 0]);
  } catch (e) {
    Logger.log('No se pudo registrar el envío en la bitácora: ' + e);
  }
}
