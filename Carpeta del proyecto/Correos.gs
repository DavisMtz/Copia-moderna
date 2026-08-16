/**
 * ===============================================================================
 * NUEVAS/MODIFICADAS FUNCIONES PARA ENVÍO DE CORREO HTML
 * ===============================================================================
 */

// Alias institucional desde el que salen las cotizaciones. Debe estar dado de alta
// como "Enviar como" en la cuenta de Gmail que ejecuta el script; si no lo está,
// el envío cae de vuelta a la cuenta propia (ver sendQuoteByEmail).
//
// T9.7 lo sacó del código: ahora manda el ajuste MAIL_ALIAS de la consola y esto es solo el
// respaldo de fábrica. Se lee por mailAlias_(), nunca por la constante, para que cambiarlo
// no exija desplegar. Sigue escrito aquí a propósito: una instalación recién clonada, sin
// ninguna propiedad puesta, tiene que comportarse exactamente como antes.
const MAIL_ALIAS_RESPALDO = 'cotizacion@liverpool.com.mx';

/** Memo de esta ejecución: el alias se consulta varias veces por envío. */
var MAIL_ALIAS_MEMO = null;

/**
 * El alias con el que sale el correo del sistema.
 *
 * Se resuelve perezosamente y no en una constante global: los .gs se cargan enteros en CADA
 * petición, y leer una propiedad del script al cargar el archivo cobraría ese viaje también
 * a las pantallas que no mandan ningún correo.
 */
function mailAlias_() {
  if (MAIL_ALIAS_MEMO === null) {
    MAIL_ALIAS_MEMO = (typeof secConfig_ === 'function')
      ? (secConfig_('MAIL_ALIAS', MAIL_ALIAS_RESPALDO) || MAIL_ALIAS_RESPALDO)
      : MAIL_ALIAS_RESPALDO;
  }
  return MAIL_ALIAS_MEMO;
}

// ── COPIA OCULTA GLOBAL (T9.6) ───────────────────────────────────────────────
//
// Un buzón que recibe copia de todo lo que el sistema manda hacia fuera. Lo pide quien tiene
// que poder auditar qué se le dijo a un cliente sin pedirle su bandeja a nadie.
//
// LA REGLA QUE NO SE ROMPE: los correos de SEGURIDAD no se copian. Contraseñas temporales y
// códigos de verificación viajan en el cuerpo, y mandar una copia de eso a un buzón compartido
// convierte una medida de vigilancia en un almacén de credenciales de todo el equipo. Por eso
// el CCO NO se mete dentro de la función que envía (cuentasEnviarCorreo_ la comparten los
// correos de seguridad y los avisos): se aplica ruta por ruta, y quien no lo pida no lo lleva.
// Falla cerrado.

/** Buzones configurados en el ajuste CORREO_CCO_GLOBAL. Lista vacía = apagado. */
function correoCcoGlobal_() {
  try {
    const crudo = (typeof secConfig_ === 'function') ? secConfig_('CORREO_CCO_GLOBAL', '') : '';
    if (!crudo) return [];
    return String(crudo).split(/[,;\s]+/)
      .map(function (x) { return String(x || '').trim().toLowerCase(); })
      .filter(function (x) { return x && x.indexOf('@') > 0; });
  } catch (e) {
    Logger.log('correoCcoGlobal_: ' + e);
    return [];
  }
}

/**
 * Añade la copia oculta global a un objeto de opciones de MailApp/GmailApp, respetando el
 * bcc que ya llevara (el que teclea el asesor en la pantalla de plantillas) y sin repetir
 * a nadie que ya estuviera en el correo.
 *
 * @param {Object} opciones  objeto de opciones; se modifica en el sitio.
 * @param {Array<string>=} yaVan  destinatarios que ya reciben el correo (para/cc), para no
 *                                mandarle a alguien dos veces el mismo mensaje.
 * @return {number} cuántos buzones se añadieron, para que la métrica cuente la verdad.
 */
function correoAplicarCco_(opciones, yaVan) {
  const global = correoCcoGlobal_();
  if (!global.length || !opciones) return 0;

  const previos = String(opciones.bcc || '').split(/[,;\s]+/)
    .map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
  const ocupados = previos.concat((yaVan || []).map(function (x) {
    return String(x || '').trim().toLowerCase();
  }));

  const nuevos = global.filter(function (c) { return ocupados.indexOf(c) === -1; });
  if (!nuevos.length) return 0;

  opciones.bcc = previos.concat(nuevos).join(',');
  return nuevos.length;
}

/**
 * Indica al cliente desde qué remitente saldrán los correos, para mostrarlo en la
 * pantalla de composición antes de enviar.
 */
function getMailSenderInfo() {
  // Los alias de Gmail de una cuenta no cambian de un día para otro y la consulta cuesta una
  // llamada al servicio: se guarda por USUARIO (getUserCache, nunca compartida entre cuentas).
  //
  // El alias entra en la CLAVE desde T9.7. Ahora se puede cambiar desde la consola, y con una
  // clave fija cada asesor habría seguido viendo el remitente anterior hasta seis horas —sin
  // forma de forzarlo, porque la caché es suya y no del script—. Con el alias dentro, cambiarlo
  // deja la entrada vieja sin dueño y la nueva se calcula al primer uso.
  const CLAVE_ALIAS = 'mail_sender_v1_' + mailAlias_();
  try {
    const hit = CacheService.getUserCache().get(CLAVE_ALIAS);
    if (hit) return JSON.parse(hit);
  } catch (e) {}

  const info = calcularMailSenderInfo_();
  // Solo se cachea el estado bueno y estable ("el alias existe"). Si aún NO está dado de
  // alta, no se guarda: en cuanto alguien lo configure, la pantalla debe reflejarlo ya.
  if (info.success && info.aliasAvailable) {
    try {
      CacheService.getUserCache().put(CLAVE_ALIAS, JSON.stringify(info), (typeof COT_TTL === 'object' ? COT_TTL.remitente : 21600));
    } catch (e) {}
  }
  return info;
}

/** Consulta real de los alias de Gmail (sin caché). */
function calcularMailSenderInfo_() {
  try {
    const aliasAvailable = GmailApp.getAliases().indexOf(mailAlias_()) !== -1;
    return {
      success: true,
      alias: mailAlias_(),
      aliasAvailable: aliasAvailable,
      effectiveSender: aliasAvailable ? mailAlias_() : (Session.getActiveUser() ? Session.getActiveUser().getEmail() : '')
    };
  } catch (e) {
    return { success: false, alias: mailAlias_(), aliasAvailable: false, message: e.message };
  }
}

/**
 * Formatea un número como moneda MXN.
 * Función de utilidad para ser usada dentro de Apps Script.
 * @param {number} amount - La cantidad a formatear.
 * @return {string} La cantidad formateada como string (ej. $1,234.50).
 */
function formatCurrencyGS(amount) {
  if (isNaN(parseFloat(amount))) return "$0.00";
  return parseFloat(amount).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}


/**
 * Genera el cuerpo HTML completo de una cotización para ser incrustado en un correo.
 * PRIVADA (termina en _): la usan solo el envío de correos y el PDF 'actual'. Sin el
 * guion bajo quedaba expuesta a google.script.run y entregaba la cotización completa
 * sin sesión — el mismo agujero que se cerró en getQuoteDetails (T1.4).
 * @param {string} folio - El folio de la cotización.
 * @return {object} - Objeto con { success: true, html: '...' } o { success: false, message: '...' }.
 */
function generateQuoteHtml_(folio) {
  try {
    const quoteResponse = cotDetalleFolio_(folio);
    if (!quoteResponse.success) {
      return { success: false, message: "No pudimos leer los datos de la cotización para armar el correo." };
    }
    const data = quoteResponse.quote;

    let productsHtml = '';
    if (data.products && data.products.length > 0) {
      data.products.forEach(p => {
        const unitPrice = parseFloat(p.unitPrice) || 0;
        const quantity = parseInt(p.quantity) || 0;
        const priceVolume = unitPrice * quantity;
        let finalPricePerLine;
        let discountDisplayString = "-";
        const costPaymentUnique = parseFloat(p.costPaymentUnique) || 0;
        let discountPublicPercent = parseFloat(p.discountPublicPercent) || 0;
        const additionalDiscountApplied = p.additionalDiscountApplied === 'Si';
        let additionalDiscountPercent = parseFloat(p.additionalDiscountPercent) || 0;

        if (costPaymentUnique > 0 && quantity > 0 && unitPrice > 0) {
            finalPricePerLine = costPaymentUnique;
        } else {
            let priceAfterPublic = priceVolume * (1 - (discountPublicPercent / 100));
            priceAfterPublic = Math.max(0, priceAfterPublic);
            finalPricePerLine = priceAfterPublic;
            if (additionalDiscountApplied && additionalDiscountPercent > 0) {
                finalPricePerLine = priceAfterPublic * (1 - (additionalDiscountPercent / 100));
            }
            finalPricePerLine = Math.max(0, finalPricePerLine);
        }
        const totalMonetaryDiscount = priceVolume - finalPricePerLine;
        const effectiveTotalPercentage = priceVolume > 0 ? (totalMonetaryDiscount / priceVolume) * 100 : 0;

        if (totalMonetaryDiscount > 0.001) {
            let details = [];
            if (discountPublicPercent > 0.001 && !(costPaymentUnique > 0)) {
               details.push(`Púb: ${discountPublicPercent.toFixed(2)}%`);
            }
            if (additionalDiscountApplied && additionalDiscountPercent > 0.001 && !(costPaymentUnique > 0)) {
               details.push(`Adic: ${additionalDiscountPercent.toFixed(2)}%`);
            }
            if (details.length > 0) {
               discountDisplayString = `${details.join(' + ')}. Total: ${formatCurrencyGS(totalMonetaryDiscount)} (${effectiveTotalPercentage.toFixed(2)}% DesTot.)`;
            } else if (costPaymentUnique > 0) {
               discountDisplayString = `${formatCurrencyGS(totalMonetaryDiscount)} (${effectiveTotalPercentage.toFixed(2)}% DesTot.)`;
            } else {
               discountDisplayString = "-";
            }
        }
        
        productsHtml += `
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; white-space: nowrap;">${secEscapeHtml_(p.sku)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center; vertical-align: top; white-space: nowrap;">${quantity}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; word-break: break-word; line-height: 1.3;">${secEscapeHtml_(p.description)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; vertical-align: top; white-space: nowrap;">${formatCurrencyGS(unitPrice)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; vertical-align: top; white-space: nowrap;">${formatCurrencyGS(priceVolume)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; vertical-align: top; word-break: break-word; font-size: 8pt; line-height: 1.2;">${discountDisplayString}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; vertical-align: top; white-space: nowrap; font-weight: 500;">${formatCurrencyGS(finalPricePerLine)}</td>
          </tr>
        `;
      });
    } else {
      productsHtml = '<tr><td colspan="7" style="text-align: center; padding: 1rem;">No hay productos en esta cotización.</td></tr>';
    }

    const observationsHtml = (data.observations && data.observations.trim() !== '') ? `
      <div style="margin-top: 15px; margin-bottom: 20px; font-size: 10pt; padding: 10px; background-color: #fdfdfd; border-radius: 4px; border: 1px solid #f0f0f0;">
        <h2 style="font-size: 14px; font-weight: 700; color: #E10098; margin-top:0; margin-bottom: 8px; border-bottom: 1px solid #eeeeee; padding-bottom: 4px;">Observaciones Adicionales</h2>
        <p style="white-space: pre-wrap; margin: 0; line-height: 1.5;">${secEscapeHtml_(data.observations)}</p>
      </div>` : '';

    // HTML optimizado para renderizado PDF a página completa (Letter)
    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page {
            size: letter;
            margin: 12mm 15mm 12mm 15mm;
          }
          body {
            font-family: Arial, sans-serif;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #ffffff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .pdf-container {
            width: 100%;
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
        </style>
      </head>
      <body>
        <div class="pdf-container">
          <table width="100%" cellspacing="0" cellpadding="0" style="border-bottom: 2px solid #E10098; padding-bottom: 15px; margin-bottom: 25px;">
            <tr>
              <td valign="top">
                <h1 style="font-size: 24px; font-weight: 700; color: #E10098; margin: 0 0 5px 0;">COTIZACIÓN</h1>
                <p style="font-size: 11px; margin: 2px 0; color: #4A4A4A;"><strong>Folio:</strong> ${secEscapeHtml_(data.folio || 'N/A')}</p>
                <p style="font-size: 11px; margin: 2px 0; color: #4A4A4A;"><strong>Fecha de Emisión:</strong> ${data.timestamp ? new Date(data.timestamp).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) : 'N/A'}</p>
              </td>
              <td valign="top" align="right">
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Liverpool_logo.svg/1280px-Liverpool_logo.svg.png" alt="Logo Liverpool" style="max-height: 42px; width: auto; margin-bottom: 8px;">
                <p style="font-size: 10px; margin: 2px 0; color: #666666; text-align: right;">Centro de Contacto Liverpool</p>
                <p style="font-size: 10px; margin: 2px 0; color: #666666; text-align: right;">postventaomnicanal@liverpool.com.mx</p>
                <p style="font-size: 10px; margin: 2px 0; color: #666666; text-align: right;">Tel: 55 5262 9999, opción 3</p>
              </td>
            </tr>
          </table>
          <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 20px; font-size: 11px;">
            <tr>
              <td width="48%" valign="top" style="background-color: #fdfdfd; padding: 10px; border-radius: 4px; border: 1px solid #f0f0f0;">
                <h2 style="margin-top:0; font-size: 14px; font-weight: 700; color: #E10098; margin-bottom: 8px; border-bottom: 1px solid #eeeeee; padding-bottom: 4px;">Información del Asesor</h2>
                <p style="margin: 2px 0; line-height: 1.5;"><strong>Nombre:</strong> ${secEscapeHtml_(data.advisorName || 'N/A')}</p>
                <p style="margin: 2px 0; line-height: 1.5;"><strong>Puesto:</strong> Asesor de Ventas</p>
              </td>
              <td width="4%">&nbsp;</td>
              <td width="48%" valign="top" style="background-color: #fdfdfd; padding: 10px; border-radius: 4px; border: 1px solid #f0f0f0;">
                <h2 style="margin-top:0; font-size: 14px; font-weight: 700; color: #E10098; margin-bottom: 8px; border-bottom: 1px solid #eeeeee; padding-bottom: 4px;">Información del Cliente</h2>
                <p style="margin: 2px 0; line-height: 1.5;"><strong>Dirigida a:</strong> ${secEscapeHtml_(data.clientName || 'N/A')}</p>
                <p style="margin: 2px 0; line-height: 1.5;"><strong>Correo:</strong> ${secEscapeHtml_(data.clientEmail || 'N/A')}</p>
                <p style="margin: 2px 0; line-height: 1.5;"><strong>Teléfono:</strong> ${secEscapeHtml_(data.clientPhone || 'N/A')}</p>
              </td>
            </tr>
          </table>
          <h2 style="font-size: 14px; font-weight: 700; color: #E10098; margin-top: 20px; margin-bottom: 8px; border-bottom: 1px solid #eeeeee; padding-bottom: 4px;">Detalle de Productos</h2>
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin-bottom: 20px; font-size: 9pt;">
            <thead style="background-color: #f5f5f5; font-weight: 700;">
              <tr>
                <th style="width: 14%; border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; white-space: nowrap;">SKU</th>
                <th style="width: 7%; text-align: center; border: 1px solid #cbd5e1; padding: 6px 8px; white-space: nowrap;">Cant.</th>
                <th style="width: 26%; border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; word-break: break-word;">Descripción</th>
                <th style="width: 12%; text-align: right; border: 1px solid #cbd5e1; padding: 6px 8px; white-space: nowrap;">P. Unitario</th>
                <th style="width: 13%; text-align: right; border: 1px solid #cbd5e1; padding: 6px 8px; white-space: nowrap;">P. x Volumen</th>
                <th style="width: 14%; text-align: right; border: 1px solid #cbd5e1; padding: 6px 8px; word-break: break-word;">Desc. Aplicado</th>
                <th style="width: 14%; text-align: right; border: 1px solid #cbd5e1; padding: 6px 8px; white-space: nowrap;">Total Fila</th>
              </tr>
            </thead>
            <tbody>${productsHtml}</tbody>
          </table>
          <table width="100%" cellspacing="0" cellpadding="0"><tr><td align="right">
            <table style="width: 45%; font-size: 10pt;">
              <tr><td style="padding: 6px 8px; border-bottom: 1px solid #eeeeee;">SUBTOTAL:</td><td style="padding: 6px 8px; border-bottom: 1px solid #eeeeee; text-align: right; font-weight: 500;">${formatCurrencyGS(data.summarySubtotal)}</td></tr>
              <tr><td style="padding: 6px 8px; border-bottom: 1px solid #eeeeee;">IVA (16%):</td><td style="padding: 6px 8px; border-bottom: 1px solid #eeeeee; text-align: right; font-weight: 500;">${formatCurrencyGS(data.summaryVat)}</td></tr>
              <tr style="font-size: 12pt; font-weight: 700; color: #E10098;"><td style="padding: 8px; border-top: 2px solid #333;">TOTAL A PAGAR:</td><td style="padding: 8px; text-align: right; border-top: 2px solid #333;">${formatCurrencyGS(data.summaryTotal)}</td></tr>
            </table>
          </td></tr></table>
          ${observationsHtml}
          <div style="font-size: 8pt; color: #555555; margin-top: 20px; line-height: 1.3;">
            <p>Precios y promociones sujetos a cambio sin previo aviso. Los precios incluyen IVA. La disponibilidad de los artículos está sujeta a existencias al momento de realizar la compra.</p>
          </div>
          <div style="font-size: 8pt; color: #888888; text-align: center; border-top: 1px solid #eeeeee; padding-top: 10px; margin-top: 25px;">
            <p>Gracias por su preferencia.<br>Liverpool - Es parte de mi vida</p>
          </div>
        </div>
      </body>
      </html>
    `;
    return { success: true, html: fullHtml };
  } catch (error) {
    Logger.log(`Error en generateQuoteHtml_ para folio ${folio}: ${error.message}`);
    return { success: false, message: "No pudimos preparar el documento de la cotización. Inténtalo de nuevo en un momento." };
  }
}

/**
 * Obtiene los detalles básicos de una cotización para rellenar el formulario de correo.
 * Con candado de sesión (T1.4): entrega nombre y correo del cliente, así que exige
 * identidad registrada igual que getQuoteDetails.
 * @param {string} folio - El folio de la cotización a buscar.
 * @param {string} emailCliente - AppSession.userEmail de quien consulta.
 * @return {object} Un objeto con los datos del cliente.
 */
function getQuoteDetailsForEmail(folio, emailCliente) {
  try {
    const gate = secIdentidad_(emailCliente);
    if (!gate.ok) {
      return { success: false, sinSesion: true, message: gate.error || 'Inicia sesión para consultar esta cotización.' };
    }
    if (!folio) throw new Error("El folio es requerido.");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cotizacionesSheet = ss.getSheetByName(COTIZACIONES_SHEET_NAME);
    if (!cotizacionesSheet) throw new Error(`Hoja "${COTIZACIONES_SHEET_NAME}" no encontrada.`);

    const cotAllData = cotizacionesSheet.getDataRange().getValues();
    if (cotAllData.length <= 1) return { success: false, message: "Todavía no hay ninguna cotización registrada." };

    const cotHeaders = cotAllData.shift();
    const folioColIdx = cotHeaders.indexOf("Folio");
    const clientNameColIdx = cotHeaders.indexOf("ClienteNombre");
    const clientEmailColIdx = cotHeaders.indexOf("CorreoCliente");
    const formatColIdx = cotHeaders.indexOf("Formato");

    if ([folioColIdx, clientNameColIdx, clientEmailColIdx].includes(-1)) {
        throw new Error("Faltan columnas requeridas en la hoja 'Cotizaciones'. Verifica: Folio, ClienteNombre, CorreoCliente.");
    }

    const quoteRow = cotAllData.find(row => row[folioColIdx] == folio);
    if (!quoteRow) return { success: false, message: `No se encontró la cotización con el folio ${folio}.` };

    const details = {
      folio: quoteRow[folioColIdx],
      clientName: quoteRow[clientNameColIdx],
      clientEmail: quoteRow[clientEmailColIdx],
      // 'Formato' es una columna que se auto-crea, así que puede no existir en hojas viejas.
      format: (formatColIdx > -1 && quoteRow[formatColIdx]) ? quoteRow[formatColIdx] : DEFAULT_FORMAT_ID
    };

    // Estado de la revisión: la pantalla necesita saber si puede habilitar el envío.
    // El bloqueo de verdad está en sendQuoteByEmail; esto es para poder explicarlo antes
    // de que el asesor redacte un correo que no va a poder mandar.
    details.revision = (typeof revEstadoDeFolio_ === 'function')
      ? revEstadoDeFolio_(folio)
      : { aprobada: true, estado: '', nombre: '', notas: '' };

    Logger.log(`Detalles para formulario de correo recuperados para folio ${folio}`);
    return { success: true, data: details };

  } catch (error) {
    Logger.log(`Error en getQuoteDetailsForEmail para folio ${folio}: ${error.message}`);
    return { success: false, message: "No pudimos leer los datos de la cotización. Inténtalo de nuevo en un momento." };
  }
}

/**
 * Envía un correo electrónico con la cotización en formato PDF adjunta, y el mensaje del usuario en el cuerpo.
 * @param {object} emailData - Objeto con {to, subject, body, folio, format}.
 *                             'format' es opcional; si no viene, se usa el guardado en la cotización.
 * @return {object} Un objeto indicando el resultado del envío.
 */
function sendQuoteByEmail(emailData) {
  try {
    if (!emailData.to || !emailData.subject || !emailData.body || !emailData.folio) {
      throw new Error("Faltan datos para enviar el correo (to, subject, body, folio).");
    }

    // Gate de sesión: quien envía debe estar registrado (logueado) en la app.
    const asesorMet = metVerificarAsesor_(emailData.asesor);
    if (!asesorMet.ok) {
      return { success: false, message: asesorMet.error || 'Tu sesión no es válida o expiró. Inicia sesión de nuevo para poder enviar correos.' };
    }

    // Gate de REVISIÓN: una cotización no sale al cliente hasta que un usuario avanzado
    // la aprueba (Revision.gs). Se comprueba EN EL SERVIDOR, no solo escondiendo el botón:
    // el cliente puede llamar a esta función directamente desde la consola del navegador.
    // Se lee de la hoja sin caché a propósito — aquí un dato de hace tres minutos podría
    // dejar salir algo que acaban de rechazar.
    if (typeof revPuedeEnviarse_ === 'function') {
      const permiso = revPuedeEnviarse_(emailData.folio);
      if (!permiso.ok) {
        Logger.log('Envío bloqueado por revisión pendiente: ' + emailData.folio + ' — ' + permiso.message);
        return { success: false, sinAprobar: true, message: permiso.message };
      }
    }

    // Los destinatarios se validan antes de generar el PDF: si el correo está mal
    // escrito, se avisa de inmediato en vez de fallar después de minuto y medio de
    // trabajo. Máximo 3, igual que en la pantalla de correos a clientes.
    const destinatarios = ccListaCorreos_(emailData.to, 'Para', 3);
    if (!destinatarios.length) throw new Error('Falta el correo del cliente (Para).');
    const paraFinal = destinatarios.join(',');
    if (String(emailData.subject).length > 250) throw new Error('El asunto es demasiado largo.');

    // 1. Generar el PDF en el formato elegido (el 'actual' se arma desde HTML; el CCL,
    //    desde la plantilla de Google Sheets).
    const pdfBlob = generateQuotePdfBlob(emailData.folio, emailData.format);

    // 2. Obtener los detalles completos de la cotización para armar la plantilla HTML del correo
    const quoteResponse = cotDetalleFolio_(emailData.folio);
    if (!quoteResponse.success) {
      throw new Error("No se pudieron obtener los detalles de la cotización para armar la plantilla.");
    }
    const quote = quoteResponse.quote;

    // 3. Procesar los productos para el cuerpo del correo con sus fotos (reconstruidas dinámicamente)
    let productsHtml = '';
    if (quote.products && quote.products.length > 0) {
      quote.products.forEach(p => {
        const unitPrice = parseFloat(p.unitPrice) || 0;
        const quantity = parseInt(p.quantity) || 0;
        const priceVolume = unitPrice * quantity;
        let finalPricePerLine;
        const costPaymentUnique = parseFloat(p.costPaymentUnique) || 0;
        let discountPublicPercent = parseFloat(p.discountPublicPercent) || 0;
        const additionalDiscountApplied = p.additionalDiscountApplied === 'Si';
        let additionalDiscountPercent = parseFloat(p.additionalDiscountPercent) || 0;

        if (costPaymentUnique > 0 && quantity > 0 && unitPrice > 0) {
            finalPricePerLine = costPaymentUnique;
        } else {
            let priceAfterPublic = priceVolume * (1 - (discountPublicPercent / 100));
            priceAfterPublic = Math.max(0, priceAfterPublic);
            finalPricePerLine = priceAfterPublic;
            if (additionalDiscountApplied && additionalDiscountPercent > 0) {
                finalPricePerLine = priceAfterPublic * (1 - (additionalDiscountPercent / 100));
            }
            finalPricePerLine = Math.max(0, finalPricePerLine);
        }
        const totalMonetaryDiscount = priceVolume - finalPricePerLine;
        const effectiveTotalPercentage = priceVolume > 0 ? (totalMonetaryDiscount / priceVolume) * 100 : 0;

        const verifiedImgUrl = getVerifiedImageUrl(p.sku, p.imageUrl);

        productsHtml += `
          <!-- CARD DE PRODUCTO INDIVIDUAL -->
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" id="lineItems LIV">
            <tbody style="background:#F7F7F7;">
              <tr align="left" style="background:#F7F7F7; width: 100%;">
                <td style="background:#F7F7F7;width:5%;"></td>
                <td style="background:#fff;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0,0,0,0.15);margin:0 auto;padding:15px;width:90%;">
                  <table cellpadding="0" cellspacing="0" style="width:100%;background:#fff;">
                    <tbody>
                      <tr>
                        <!-- Imagen del producto (Left) -->
                        <td align="center" width="35%" valign="top" style="padding-top:10px;padding-right:15px;text-align:center;">
                          <img style="max-width:140px;width:100%;height:auto;border-radius:4px;border:1px solid #f0f0f0;" alt="Liverpool Product" src="${secEscapeHtml_(verifiedImgUrl)}">
                        </td>
                        <!-- Detalles del producto (Right) -->
                        <td valign="top" style="font-family:sans-serif;color:#333;">
                          <h2 style="color:#333;font-size:15px;margin:10px 0 6px 0;font-weight:bold;line-height:1.4;">
                            ${secEscapeHtml_(p.description)}
                          </h2>
                          <p style="color:#666;font-size:12px;margin:0 0 10px 0;">
                            Código de producto: <strong>${secEscapeHtml_(p.sku)}</strong>
                          </p>
                          
                          <!-- Tabla interna de precios -->
                          <table cellpadding="0" cellspacing="0" style="width:100%;font-size:12px;color:#555;border-top:1px dashed #eee;padding-top:8px;">
                            <tr>
                              <td style="width:50%;padding-bottom:5px;">
                                Precio unitario:<br>
                                <span style="color:#333;font-weight:bold;font-size:13px;">${formatCurrencyGS(unitPrice)}</span>
                              </td>
                              <td style="width:50%;padding-bottom:5px;">
                                Cantidad:<br>
                                <span style="color:#333;font-weight:bold;font-size:13px;">${quantity}</span>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding-bottom:5px;">
                                Promoción:<br>
                                <span style="color:#333;font-weight:bold;">${costPaymentUnique > 0 ? 'PAGO ÚNICO' : 'PRECIO BASE'}</span>
                              </td>
                              <td style="padding-bottom:5px;">
                                Descuento:<br>
                                <span style="color:${totalMonetaryDiscount > 0.001 ? '#ef4444' : '#333'};font-weight:bold;">
                                  ${totalMonetaryDiscount > 0.001 ? `-${formatCurrencyGS(totalMonetaryDiscount)} (${effectiveTotalPercentage.toFixed(0)}%)` : '$0.00'}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td colspan="2" style="border-top:1px solid #eee;padding-top:8px;">
                                <p style="color:#666;font-size:12px;margin:0;">Total artículo: <span style="color:#f00;font-weight:bold;font-size:14px;margin-left:5px;">${formatCurrencyGS(finalPricePerLine)}</span></p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td style="background:#F7F7F7;width:5%;"></td>
              </tr>
            </tbody>
          </table>
        `;
      });
    } else {
      productsHtml = `
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;" id="noProducts">
          <tr align="center" style="background:#F7F7F7;">
            <td style="width:5%;"></td>
            <td style="background:#fff;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0,0,0,0.15);padding:20px;width:90%;color:#666;font-family:sans-serif;">
              No hay productos en esta cotización.
            </td>
            <td style="width:5%;"></td>
          </tr>
        </table>
      `;
    }

    const userMessageHtml = secEscapeHtml_(emailData.body).replace(/\n/g, '<br>');

    // 4. Armar la plantilla HTML del correo similar al ticket de Liverpool
    const finalHtmlBody = `
      <!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
      <html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Tu Cotización está Lista</title>
        <style type="text/css">
          body {
            font-family: sans-serif;
            margin: 0 auto !important;
            padding: 0 !important;
            background: #F7F7F7;
            max-width: 650px;
          }
        </style>
      </head>
      <body bgcolor="#F7F7F7" style="background-color: #F7F7F7; margin: 0 auto !important; padding: 0 !important; font-family: sans-serif; max-width: 650px;">
        <table width="100%" border="0" cellpadding="0" cellspacing="0" align="center" style="background-color: #F7F7F7;">
          <tbody>
            <tr>
              <td align="center" valign="top" style="padding-top: 20px;">
                
                <!-- TOP HEADER LOGO (Liverpool banner) -->
                <table width="100%" cellspacing="0" cellpadding="0" role="presentation" style="max-width: 650px;">
                  <tbody>
                    <tr>
                      <td align="center" style="background-color: #F7F7F7;">
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Liverpool_logo.svg/1280px-Liverpool_logo.svg.png" alt="Liverpool - Es parte de mi vida" style="display: block; padding: 10px 0; text-align: center; height: auto; max-width: 160px; margin: 0 auto; border: 0;">
                      </td>
                    </tr>
                  </tbody>
                </table>

                <!-- HEADER: ¡TU COTIZACIÓN ESTÁ LISTA! -->
                <table align="center" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" id="LIV Order">
                  <tbody style="background:#F7F7F7;">
                    <tr align="center" style="background:#F7F7F7;">
                      <td style="width:5%;"></td>
                      <td style="background:#FFF;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0, 0, 0, 0.15);margin:0 auto;padding:25px;width:90%;text-align:center;">
                        <h1 style="margin: 0; color:#333;font-size:24px;font-weight:bold;font-family:sans-serif;">
                          ¡Tu cotización está lista!
                        </h1>
                        <p style="color:#666; margin:15px 0 0 0; font-size:14px; line-height:1.5; font-family:sans-serif; text-align:center;">
                          Te compartimos los detalles de la cotización que solicitaste. Los precios e indicaciones se detallan a continuación.
                        </p>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- ADVISOR'S CUSTOM MESSAGE CARD -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" id="advisorMessageCard">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7;">
                      <td style="width:5%;"></td>
                      <td style="background:#fff;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0,0,0,0.15);margin:0 auto;padding:18px;width:90%;font-family:sans-serif;font-size:14px;color:#333;line-height:1.5;">
                        <p style="margin:0 0 10px 0;font-weight:bold;color:#e10098;font-size:14px;">Mensaje de tu Asesor:</p>
                        <div style="background:#fdf2f8;border-left:4px solid #e10098;padding:12px 16px;border-radius:0 4px 4px 0;color:#4c4c4c;line-height:1.5;">
                          ${userMessageHtml}
                        </div>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- NOTICE BANNER (Yellow alert box) -->
                <table style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" cellpadding="0" cellspacing="0" border="0" id="noticeAlert">
                  <tbody style="background:#f7f7f7;">
                    <tr style="background:#f7f7f7;">
                      <td style="width:5%;"></td>
                      <td style="background:#F7F7F7; width:90%;">
                        <table cellpadding="0" cellspacing="0" style="width:100%;">
                          <tr>
                            <td style="border-left:5px solid #ffd457; background:#fff4d4; padding:12px 15px; border-radius: 0 4px 4px 0; font-size:13px; color:#665c40; font-family:sans-serif; text-align:left; line-height:1.4;">
                              <strong>Nota importante:</strong> Los precios y promociones están sujetos a cambios sin previo aviso. Esta cotización tiene fines informativos y la disponibilidad de los artículos se garantiza al concretar la compra.
                            </td>
                          </tr>
                        </table>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- GENERAL DATES & TOTALS CARD -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" id="datesAndTotals">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7;">
                      <td style="width:5%;"></td>
                      <td style="background:#fff;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0,0,0,0.15);margin:0 auto;padding:15px;width:90%;">
                        <table cellpadding="0" cellspacing="0" style="background:#fff;width:100%;font-size:13px;font-family:sans-serif;">
                          <tbody>
                            <tr>
                              <td width="50%" align="left" style="color:#333;">
                                Fecha de emisión: <span style="font-weight:700;">${new Date(quote.timestamp).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                              </td>
                              <td width="50%" align="right" style="color:#333;">
                                Total cotizado: <span style="font-weight:700;color:#e10098;font-size:15px;">${formatCurrencyGS(quote.summaryTotal)}</span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- SUMMARY BLOCK HEADER: CLIENTE Y ASESOR -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 15px;margin-bottom:5px;" id="clientAdvisorHeader">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7;">
                      <td style="background:#F7F7F7;width:5%;"></td>
                      <td style="background:#F7F7F7;width:90%;">
                        <h3 style="border-bottom:2px solid #e10098;color:#FFF;font-size:15px;font-weight:normal;margin:0;font-family:sans-serif;">
                          <span style="background:#e10098;display:table-cell;height:30px;line-height:30px;padding:3px 16px 0;border-radius:4px 4px 0 0;">
                            Información del Cliente y Asesor
                          </span>
                        </h3>
                      </td>
                      <td style="background:#F7F7F7;width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- SUMMARY BLOCK CONTENT: CLIENTE Y ASESOR -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-bottom:10px;" id="clientAdvisorContent">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7; width: 100%;">
                      <td style="background:#F7F7F7;width:5%;"></td>
                      <td style="background:#FFF;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0, 0, 0, 0.15);margin:0 auto;padding:15px;width:90%;font-family:sans-serif;font-size:13px;line-height:1.5;color:#333;">
                        <table cellpadding="0" cellspacing="0" style="width:100%;">
                          <tr>
                            <td width="48%" valign="top" style="border-right:1px solid #eee;padding-right:10px;">
                              <p style="margin:2px 0;color:#e10098;font-weight:bold;font-size:13px;">Dirigido a:</p>
                              <p style="margin:2px 0;"><strong>Cliente:</strong> ${secEscapeHtml_(quote.clientName || 'N/A')}</p>
                              <p style="margin:2px 0;"><strong>Correo:</strong> ${secEscapeHtml_(quote.clientEmail || 'N/A')}</p>
                              <p style="margin:2px 0;"><strong>Teléfono:</strong> ${secEscapeHtml_(quote.clientPhone || 'N/A')}</p>
                            </td>
                            <td width="4%">&nbsp;</td>
                            <td width="48%" valign="top" style="padding-left:10px;">
                              <p style="margin:2px 0;color:#e10098;font-weight:bold;font-size:13px;">Atendido por:</p>
                              <p style="margin:2px 0;"><strong>Asesor:</strong> ${secEscapeHtml_(quote.advisorName || 'N/A')}</p>
                              <p style="margin:2px 0;"><strong>Folio:</strong> ${secEscapeHtml_(quote.folio || 'N/A')}</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                      <td style="background:#F7F7F7;width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- SECTION HEADER: TUS PRODUCTOS -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 15px;margin-bottom:5px;" id="productsHeader">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7;">
                      <td style="background:#F7F7F7;width:5%;"></td>
                      <td style="background:#F7F7F7;width:90%;">
                        <h3 style="border-bottom:2px solid #e10098;color:#FFF;font-size:15px;font-weight:normal;margin:0;font-family:sans-serif;">
                          <span style="background:#e10098;display:table-cell;height:30px;line-height:30px;padding:3px 16px 0;border-radius:4px 4px 0 0;">
                            Detalle de Artículos
                          </span>
                        </h3>
                      </td>
                      <td style="background:#F7F7F7;width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- PRODUCTS LIST LOOP -->
                ${productsHtml}

                <!-- TOTALS SUMMARY CARD -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 10px;margin-bottom:10px;" id="totalsSummary">
                  <tbody style="background:#F7F7F7;">
                    <tr align="left" style="background:#F7F7F7;">
                      <td style="width:5%;"></td>
                      <td style="background:#fff;border-radius:4px;box-shadow:0 2px 4px 0 rgba(0,0,0,0.15);margin:0 auto;padding:15px;width:90%;">
                        <table cellpadding="0" cellspacing="0" style="background:#fff;width:100%;font-size:13px;font-family:sans-serif;color:#333;">
                          <tbody>
                            <tr>
                              <td align="right" style="padding: 4px 0;color:#666;">Subtotal:</td>
                              <td align="right" width="30%" style="padding: 4px 0;font-weight:700;">${formatCurrencyGS(quote.summarySubtotal)}</td>
                            </tr>
                            <tr>
                              <td align="right" style="padding: 4px 0;color:#666;">IVA (16%):</td>
                              <td align="right" style="padding: 4px 0;font-weight:700;">${formatCurrencyGS(quote.summaryVat)}</td>
                            </tr>
                            <tr style="font-size:15px;font-weight:bold;color:#e10098;">
                              <td align="right" style="border-top:1.5px solid #e10098;padding-top:10px;margin-top:5px;">TOTAL GENERAL:</td>
                              <td align="right" style="border-top:1.5px solid #e10098;padding-top:10px;margin-top:5px;color:#e10098;font-size:16px;">${formatCurrencyGS(quote.summaryTotal)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

                <!-- EMAIL FOOTER INFO -->
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width: 650px;margin-top: 20px;margin-bottom:20px;" id="footerInfo">
                  <tbody style="background:#F7F7F7;">
                    <tr align="center" style="background:#F7F7F7;">
                      <td style="width:5%;"></td>
                      <td style="font-family:sans-serif;font-size:11px;color:#888;line-height:1.5;text-align:center;width:90%;">
                        <p style="margin: 0 0 10px 0;"><strong>Nota:</strong> Se adjunta a este correo el archivo PDF oficial con la cotización formal detallada para su descarga o impresión.</p>
                        <p style="margin: 0 0 15px 0;font-weight:bold;color:#e10098;font-size:12px;">Liverpool - Es parte de mi vida</p>
                      </td>
                      <td style="width:5%;"></td>
                    </tr>
                  </tbody>
                </table>

              </td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;

    // 5. Enviar el correo con el archivo PDF adjunto y la plantilla HTML.
    //    Se intenta enviar desde el alias institucional; si el alias no está dado de
    //    alta en la cuenta que ejecuta el script (Gmail > Configuración > Cuentas >
    //    "Enviar como"), se envía desde la cuenta propia para no bloquear el envío.
    //    Las respuestas del cliente llegan siempre al asesor dueño de la cotización.
    const options = {
      htmlBody: finalHtmlBody,
      name: 'Cotizaciones Ventel Liverpool', // Nombre del remitente que verá el cliente
      attachments: [pdfBlob]
    };
    if (quote.advisorEmail) options.replyTo = quote.advisorEmail;

    // Copia oculta global (T9.6): la cotización es exactamente el correo que alguien va a
    // querer releer meses después. No se le manda al asesor aunque esté configurado —ya la
    // tiene en su bandeja— ni se duplica si el buzón ya está en el "Para".
    const ccoGlobal = correoAplicarCco_(options, destinatarios.concat([quote.advisorEmail || '']));

    let sentFrom = '';
    let aliasAvailable = false;
    try {
      // Requiere el permiso de Gmail (https://mail.google.com/ en appsscript.json).
      // Si el permiso o el alias no están, se registra y se envía por la vía clásica.
      aliasAvailable = GmailApp.getAliases().indexOf(mailAlias_()) !== -1;
    } catch (e) {
      Logger.log('Sin acceso a los alias de Gmail (falta permiso o alias): ' + e.message);
    }

    if (aliasAvailable) {
      try {
        GmailApp.sendEmail(paraFinal, emailData.subject, '', Object.assign({}, options, { from: mailAlias_() }));
        sentFrom = mailAlias_();
      } catch (e) {
        Logger.log('Fallo el envío con alias, se reintenta por la vía clásica: ' + e.message);
        aliasAvailable = false;
      }
    }
    if (!aliasAvailable) {
      // MailApp usa el permiso de envío que el script ya tenía autorizado desde siempre:
      // el correo SIEMPRE sale, aunque el alias o el permiso de Gmail no estén listos.
      MailApp.sendEmail(paraFinal, emailData.subject, '', options);
      sentFrom = Session.getActiveUser() ? Session.getActiveUser().getEmail() : '';
    }
    Logger.log(`Correo con PDF adjunto enviado a ${paraFinal} desde ${sentFrom || 'cuenta del script'} para el folio ${emailData.folio}`);

    // 6. Actualizar el estatus de la cotización a "Enviada por Correo"
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cotizacionesSheet = ss.getSheetByName(COTIZACIONES_SHEET_NAME);
    const cotHeaders = cotizacionesSheet.getRange(1, 1, 1, cotizacionesSheet.getLastColumn()).getValues()[0];
    const folioColIdx = cotHeaders.indexOf("Folio");
    const statusColIdx = cotHeaders.indexOf("Estatus");
    
    if (folioColIdx > -1 && statusColIdx > -1) {
      const cotDataValues = cotizacionesSheet.getDataRange().getValues();
      for (let i = 1; i < cotDataValues.length; i++) {
          if (cotDataValues[i][folioColIdx] == emailData.folio) {
              cotizacionesSheet.getRange(i + 1, statusColIdx + 1).setValue("Enviada por Correo");
              /* T1.6b: la fecha REAL del envío, en su propia columna. El Timestamp se
                 pisa con cada guardado (Code.gs), así que editar una cotización ya
                 enviada le cambiaba "su fecha" en el panel. FechaEnvio solo se escribe
                 aquí: reenviar la actualiza (es un envío de verdad), editar no la toca
                 (saveQuoteDataToSheets conserva las columnas que no maneja). La columna
                 se auto-crea si la hoja no la tiene (patrón de 'Formato'). */
              try {
                setQuoteColumnValue_(emailData.folio, "FechaEnvio", new Date());
              } catch (e) {
                Logger.log('No se pudo escribir FechaEnvio para ' + emailData.folio + ': ' + e.message);
              }
              // El estatus cambió: sin esto, el panel seguiría mostrando "Folio Generado"
              // hasta que caducara la caché (Cache.gs).
              if (typeof cotInvalidarCache_ === 'function') cotInvalidarCache_();
              break;
          }
      }
    }

    // Métrica del envío de cotización (mismo registro unificado que las plantillas).
    metRegistrarEnvio_({
      tipo: 'Cotización (PDF)', referencia: emailData.folio,
      asesorEmail: asesorMet.email, asesorNombre: asesorMet.nombre,
      para: paraFinal,
      destinatarios: destinatarios.length,
      cc: 0, cco: ccoGlobal, asunto: emailData.subject, adjuntos: 1, remitente: sentFrom,
      aliasUsado: aliasAvailable, resultado: 'Enviado', detalle: ''
    });

    return {
      success: true,
      sentFrom: sentFrom,
      aliasUsed: aliasAvailable,
      message: aliasAvailable
        ? `Correo enviado desde ${mailAlias_()}.`
        : `Correo enviado (el alias ${mailAlias_()} aún no está configurado en la cuenta; se usó la cuenta del sistema).`
    };

  } catch (error) {
    Logger.log(`Error al enviar correo para folio ${emailData.folio}: ${error.message} Stack: ${error.stack}`);
    metRegistrarEnvio_({
      tipo: 'Cotización (PDF)', referencia: String(emailData.folio || ''),
      asesorEmail: String(emailData.asesor || '').toLowerCase(),
      para: String(emailData.to || ''), resultado: 'Error', detalle: error.message
    });
    return { success: false, message: 'No pudimos enviar el correo. Revisa la dirección del cliente e inténtalo de nuevo.' };
  }
}

/**
 * Devuelve una URL de imagen que se sabe viva, para que el cliente no reciba fotos rotas.
 *
 * Primero prueba la URL que trae el producto; si no responde 200, prueba EN PARALELO los
 * servidores de imágenes conocidos de Liverpool y se queda con el primero que responda.
 * El resultado se guarda 6 horas en la caché del script: antes cada envío repetía hasta
 * 10 peticiones por producto, lo que en una cotización grande se comía el límite de
 * ejecución de Apps Script.
 *
 * @param {string} sku - El identificador del producto.
 * @param {string} preferredUrl - La URL que recolectó originalmente la extensión.
 * @return {string} Una URL verificada, o el placeholder si ninguna respondió.
 */
const IMG_SUBDOMINIOS = ["ss628", "ss224", "ss318", "ss414", "ss512", "ss101", "ss202", "ss303", "ss404"];
const IMG_PLACEHOLDER = "https://assets.liverpool.com.mx/assets/images/placeholder.gif";
const IMG_CACHE_SEGUNDOS = 21600; // 6 horas: las imágenes de catálogo no cambian de sitio.

function getVerifiedImageUrl(sku, preferredUrl) {
  const skuLimpio = String(sku || '').trim();

  // Caché: sin ella, una cotización de 10 productos podía disparar hasta 100
  // peticiones HTTP en cada envío — minutos de espera y riesgo de topar el límite
  // de 6 minutos de Apps Script.
  const claveCache = 'img_' + skuLimpio + '_' + (preferredUrl ? String(preferredUrl).length : 0);
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache && skuLimpio) {
    const guardada = cache.get(claveCache);
    if (guardada) return guardada;
  }

  const recordar = function (url) {
    if (cache && skuLimpio) {
      try { cache.put(claveCache, url, IMG_CACHE_SEGUNDOS); } catch (e) {}
    }
    return url;
  };

  const responde200 = function (url) {
    try {
      return UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }).getResponseCode() === 200;
    } catch (e) {
      return false;
    }
  };

  if (preferredUrl && String(preferredUrl).indexOf('http') === 0 && responde200(preferredUrl)) {
    Logger.log(`Imagen preferida verificada con éxito: ${preferredUrl}`);
    return recordar(preferredUrl);
  }

  if (!skuLimpio) return IMG_PLACEHOLDER;

  const candidatas = IMG_SUBDOMINIOS.map(s => `https://${s}.liverpool.com.mx/xl/${encodeURIComponent(skuLimpio)}.jpg`);

  // Las candidatas se prueban EN PARALELO (una sola tanda) en vez de una por una.
  try {
    const respuestas = UrlFetchApp.fetchAll(candidatas.map(url => ({
      url: url, muteHttpExceptions: true, followRedirects: true
    })));
    for (let i = 0; i < respuestas.length; i++) {
      if (respuestas[i].getResponseCode() === 200) {
        Logger.log(`Imagen encontrada para SKU ${skuLimpio} en: ${candidatas[i]}`);
        return recordar(candidatas[i]);
      }
    }
    // Ninguna respondió: se recuerda el placeholder para no reintentar 9 veces por correo.
    return recordar(IMG_PLACEHOLDER);
  } catch (e) {
    Logger.log('fetchAll de imágenes falló, se prueba una por una: ' + e.message);
  }

  for (let i = 0; i < candidatas.length; i++) {
    if (responde200(candidatas[i])) return recordar(candidatas[i]);
  }

  return recordar(candidatas[0]);
}
