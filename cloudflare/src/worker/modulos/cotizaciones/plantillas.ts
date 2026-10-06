/**
 * PLANTILLAS DEL CORREO DE COTIZACIÓN AL CLIENTE | Portal Ventel en Cloudflare
 * ============================================================================
 * Formato APROBADO: el HTML es el de sendQuoteByEmail (Correos.gs), copiado TAL CUAL por
 * scripts de extracción (líneas 468-530, 533-543 y 549-773 del .gs). Solo cambia el nombre de
 * las ayudas: secEscapeHtml_ → escaparHtml, y la fecha de emisión, que en el Worker (UTC) tiene
 * que formatearse con la zona de México (fechaLargaMx) igual que lo hacía Apps Script.
 * No se rediseña: si cambia aquí, cambia lo que recibe el cliente.
 */
import { escaparHtml } from '../../nucleo/util';
import { formatCurrencyGS, fechaLargaMx } from './comun';

/** Una tarjeta de producto (el bucle de productos de sendQuoteByEmail). */
export function tarjetaProductoHtml(v: {
  p: { sku: string; description: string };
  verifiedImgUrl: string; unitPrice: number; quantity: number; costPaymentUnique: number;
  totalMonetaryDiscount: number; effectiveTotalPercentage: number; finalPricePerLine: number;
}): string {
  const { p, verifiedImgUrl, unitPrice, quantity, costPaymentUnique, totalMonetaryDiscount,
          effectiveTotalPercentage, finalPricePerLine } = v;
  return `
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
                          <img style="max-width:140px;width:100%;height:auto;border-radius:4px;border:1px solid #f0f0f0;" alt="Liverpool Product" src="${escaparHtml(verifiedImgUrl)}">
                        </td>
                        <!-- Detalles del producto (Right) -->
                        <td valign="top" style="font-family:sans-serif;color:#333;">
                          <h2 style="color:#333;font-size:15px;margin:10px 0 6px 0;font-weight:bold;line-height:1.4;">
                            ${escaparHtml(p.description)}
                          </h2>
                          <p style="color:#666;font-size:12px;margin:0 0 10px 0;">
                            Código de producto: <strong>${escaparHtml(p.sku)}</strong>
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
}

/** Lo que va en lugar de las tarjetas cuando la cotización no tiene productos. */
export function sinProductosHtml(): string {
  return `
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

/** El correo completo, con el mensaje del asesor ya escapado y las tarjetas ya armadas. */
export function cuerpoCorreoCotizacionHtml(quote: Record<string, any>, productsHtml: string, userMessageHtml: string): string {
  return `
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
                                Fecha de emisión: <span style="font-weight:700;">${fechaLargaMx(quote.timestamp)}</span>
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
                              <p style="margin:2px 0;"><strong>Cliente:</strong> ${escaparHtml(quote.clientName || 'N/A')}</p>
                              <p style="margin:2px 0;"><strong>Correo:</strong> ${escaparHtml(quote.clientEmail || 'N/A')}</p>
                              <p style="margin:2px 0;"><strong>Teléfono:</strong> ${escaparHtml(quote.clientPhone || 'N/A')}</p>
                            </td>
                            <td width="4%">&nbsp;</td>
                            <td width="48%" valign="top" style="padding-left:10px;">
                              <p style="margin:2px 0;color:#e10098;font-weight:bold;font-size:13px;">Atendido por:</p>
                              <p style="margin:2px 0;"><strong>Asesor:</strong> ${escaparHtml(quote.advisorName || 'N/A')}</p>
                              <p style="margin:2px 0;"><strong>Folio:</strong> ${escaparHtml(quote.folio || 'N/A')}</p>
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
}
