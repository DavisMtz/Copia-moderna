/**
 * PLANTILLAS HTML DE LA COTIZACIÓN | Portal Ventel en Cloudflare
 * ==============================================================
 * GENERADO por generar-plantillas.mjs (en esta misma carpeta) a partir de «Carpeta del proyecto». No se
 * edita a mano: si cambia el original, se vuelve a generar. Son formatos APROBADOS, copiados TAL CUAL:
 *   · el correo al cliente (sendQuoteByEmail, Correos.gs);
 *   · el documento del PDF 'actual' (generateQuoteHtml_, Correos.gs);
 *   · la réplica del formato CCL Liverpool (app_ccl.html): estilos, hoja y fila de producto.
 * Solo cambian los nombres de las ayudas (secEscapeHtml_ → escaparHtml) y la fecha de emisión, que en el
 * Worker (UTC) se formatea con la zona de México (fechaLargaMx), como lo hacía Apps Script.
 */
import { escaparHtml } from '../../nucleo/util';
import { formatCurrencyGS, fechaLargaMx, formatPercentJS } from './comun';
import type { FilaCcl } from './comun';

// ── Correo al cliente (sendQuoteByEmail) ────────────────────────────────────

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

// ── Documento del PDF 'actual' (generateQuoteHtml_) ─────────────────────────

/** Una fila de la tabla de productos del PDF. */
export function filaPdfActualHtml(v: {
  p: { sku: string; description: string };
  quantity: number; unitPrice: number; priceVolume: number; discountDisplayString: string; finalPricePerLine: number;
}): string {
  const { p, quantity, unitPrice, priceVolume, discountDisplayString, finalPricePerLine } = v;
  return `
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; white-space: nowrap;">${escaparHtml(p.sku)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center; vertical-align: top; white-space: nowrap;">${quantity}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; word-break: break-word; line-height: 1.3;">${escaparHtml(p.description)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; vertical-align: top; white-space: nowrap;">${formatCurrencyGS(unitPrice)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; vertical-align: top; white-space: nowrap;">${formatCurrencyGS(priceVolume)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; vertical-align: top; word-break: break-word; font-size: 8pt; line-height: 1.2;">${discountDisplayString}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; vertical-align: top; white-space: nowrap; font-weight: 500;">${formatCurrencyGS(finalPricePerLine)}</td>
          </tr>
        `;
}

/** La fila que va cuando la cotización no tiene productos. */
export const SIN_PRODUCTOS_PDF_ACTUAL = '<tr><td colspan="7" style="text-align: center; padding: 1rem;">No hay productos en esta cotización.</td></tr>';

/** El bloque de observaciones (vacío si no hay). */
export function observacionesPdfActualHtml(data: Record<string, any>): string {
  return (data.observations && data.observations.trim() !== '') ? `
      <div style="margin-top: 15px; margin-bottom: 20px; font-size: 10pt; padding: 10px; background-color: #fdfdfd; border-radius: 4px; border: 1px solid #f0f0f0;">
        <h2 style="font-size: 14px; font-weight: 700; color: #E10098; margin-top:0; margin-bottom: 8px; border-bottom: 1px solid #eeeeee; padding-bottom: 4px;">Observaciones Adicionales</h2>
        <p style="white-space: pre-wrap; margin: 0; line-height: 1.5;">${escaparHtml(data.observations)}</p>
      </div>` : '';
}

/** El documento completo, optimizado para página carta. */
export function documentoPdfActualHtml(data: Record<string, any>, productsHtml: string, observationsHtml: string): string {
  return `
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
                <p style="font-size: 11px; margin: 2px 0; color: #4A4A4A;"><strong>Folio:</strong> ${escaparHtml(data.folio || 'N/A')}</p>
                <p style="font-size: 11px; margin: 2px 0; color: #4A4A4A;"><strong>Fecha de Emisión:</strong> ${data.timestamp ? fechaLargaMx(data.timestamp) : 'N/A'}</p>
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
                <p style="margin: 2px 0; line-height: 1.5;"><strong>Nombre:</strong> ${escaparHtml(data.advisorName || 'N/A')}</p>
                <p style="margin: 2px 0; line-height: 1.5;"><strong>Puesto:</strong> Asesor de Ventas</p>
              </td>
              <td width="4%">&nbsp;</td>
              <td width="48%" valign="top" style="background-color: #fdfdfd; padding: 10px; border-radius: 4px; border: 1px solid #f0f0f0;">
                <h2 style="margin-top:0; font-size: 14px; font-weight: 700; color: #E10098; margin-bottom: 8px; border-bottom: 1px solid #eeeeee; padding-bottom: 4px;">Información del Cliente</h2>
                <p style="margin: 2px 0; line-height: 1.5;"><strong>Dirigida a:</strong> ${escaparHtml(data.clientName || 'N/A')}</p>
                <p style="margin: 2px 0; line-height: 1.5;"><strong>Correo:</strong> ${escaparHtml(data.clientEmail || 'N/A')}</p>
                <p style="margin: 2px 0; line-height: 1.5;"><strong>Teléfono:</strong> ${escaparHtml(data.clientPhone || 'N/A')}</p>
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
}

// ── Formato CCL Liverpool (app_ccl.html) ────────────────────────────────────

/** Los estilos de la réplica, tal cual (incluidas sus reglas de impresión). */
export const CCL_ESTILOS = "    /* --- VISTA PREVIA DEL FORMATO CCL ---\n       Replica la plantilla de Sheets: horizontal, tabla de 12 columnas y bloques\n       de vendedor/cliente. Es una representación en pantalla, no el PDF final:\n       el PDF lo exporta Google Sheets desde la hoja real. */\n    .ccl-sheet {\n        width: 100%;\n        max-width: 1100px;\n        background: #fff;\n        padding: 28px 32px;\n        border-radius: 8px;\n        box-shadow: 0 4px 12px rgba(0,0,0,0.1);\n        font-size: 11px;\n        color: #222;\n    }\n    .ccl-header {\n        display: flex;\n        align-items: center;\n        gap: 20px;\n        border-bottom: 2px solid #E10098;\n        padding-bottom: 12px;\n    }\n    .ccl-logo { height: 38px; width: auto; }\n    .ccl-header-text { flex: 1; text-align: center; }\n    .ccl-contacto { font-size: 10px; color: #555; margin: 0 0 4px 0; }\n    .ccl-titulo { font-size: 15px; font-weight: 700; color: #E10098; margin: 0; letter-spacing: 0.5px; }\n    .ccl-fecha { font-size: 10px; color: #555; margin: 4px 0 0 0; }\n    .ccl-entrega { text-align: center; margin: 14px 0 18px 0; font-size: 11px; }\n\n    .ccl-partes { display: flex; gap: 16px; margin-bottom: 18px; }\n    .ccl-parte { flex: 1; border: 1px solid #d9d9d9; border-radius: 4px; overflow: hidden; }\n    .ccl-parte-titulo {\n        background: #E10098;\n        color: #fff;\n        font-weight: 700;\n        text-align: center;\n        padding: 5px;\n        letter-spacing: 1px;\n        font-size: 11px;\n    }\n    .ccl-parte-cuerpo { padding: 10px 12px; }\n    .ccl-parte-cuerpo p { margin: 2px 0; line-height: 1.45; }\n    .ccl-parte-nombre { font-weight: 700; font-size: 12px; }\n\n    .ccl-tabla { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 10px; }\n    .ccl-tabla th {\n        background: #f1f1f1;\n        border: 1px solid #bfbfbf;\n        padding: 6px 4px;\n        font-weight: 700;\n        text-align: center;\n        line-height: 1.25;\n    }\n    .ccl-tabla td {\n        border: 1px solid #bfbfbf;\n        padding: 6px 4px;\n        text-align: right;\n        vertical-align: middle;\n    }\n    .ccl-tabla td.ccl-txt { text-align: left; }\n    .ccl-tabla td.ccl-cen { text-align: center; }\n    .ccl-col-desc { width: 26%; }\n\n    .ccl-pie { display: flex; gap: 16px; align-items: flex-start; }\n    .ccl-info { flex: 1; border: 1px solid #d9d9d9; border-radius: 4px; overflow: hidden; }\n    .ccl-info-titulo {\n        background: #E10098;\n        color: #fff;\n        font-weight: 700;\n        text-align: center;\n        padding: 5px;\n        letter-spacing: 1px;\n        font-size: 11px;\n    }\n    .ccl-info p { margin: 0; padding: 10px 12px; }\n    .ccl-totales { width: 38%; border-collapse: collapse; }\n    .ccl-totales td { border: 1px solid #bfbfbf; padding: 6px 10px; }\n    .ccl-totales td:first-child { font-weight: 700; letter-spacing: 1px; background: #f1f1f1; }\n    .ccl-totales td:last-child { text-align: right; }\n    .ccl-total-final td { background: #fce4f3; color: #E10098; font-weight: 700; font-size: 12px; }\n\n    /* Impresión: Ctrl+P debe sacar la hoja que está en pantalla. Las pantallas que\n       incluyen este archivo ocultan TODO con `body * { visibility: hidden }`, así que\n       aquí se vuelve a hacer visible solo el CCL — y solo si no está oculto. */\n    @media print {\n        #ccl-preview-content, #ccl-preview-content * { visibility: visible; }\n        #ccl-preview-content.hidden, #ccl-preview-content.hidden * { visibility: hidden; }\n        #ccl-preview-content {\n            position: absolute;\n            left: 0;\n            top: 0;\n            width: 100%;\n            margin: 0;\n            padding: 0;\n            font-size: 10pt;\n            border: none;\n            box-shadow: none;\n        }\n    }";

/** Lo que va dentro del <tr> de un producto (populateCclPreview). */
export function filaCclHtml(r: FilaCcl): string {
  const escTxt = escaparHtml;
  const formatCurrencyJS = formatCurrencyGS;
  return `
                <td class="ccl-txt">${escTxt(r.sku)}</td>
                <td class="ccl-cen">${r.quantity}</td>
                <td class="ccl-txt">${escTxt(r.description)}</td>
                <td>${formatCurrencyJS(r.unitPrice)}</td>
                <td>${formatCurrencyJS(r.priceVolume)}</td>
                <td>${formatPercentJS(r.discountFraction)}</td>
                <td>${formatCurrencyJS(r.priceWithDiscount)}</td>
                <td>${formatCurrencyJS(r.subtotal)}</td>
                <td>${formatCurrencyJS(r.vat)}</td>
                <td class="ccl-cen">${r.additionalApplied}</td>
                <td>${formatPercentJS(r.additionalFraction)}</td>
                <td>${formatCurrencyJS(r.total)}</td>
            `;
}

/** La hoja CCL con sus huecos ya llenos (textos escapados, filas armadas). */
export function hojaCclHtml(v: {
  fecha: string; asesorNombre: string; clienteNombre: string; clienteEmail: string; clienteTelefono: string;
  clienteObservacion: string; filas: string; subtotal: string; iva: string; total: string;
}): string {
  return `<div class="ccl-sheet v-papel" id="ccl-preview-content">
    <div class="ccl-header">
        <img class="ccl-logo" src="https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Liverpool_logo.svg/1280px-Liverpool_logo.svg.png" alt="Liverpool">
        <div class="ccl-header-text">
            <p class="ccl-contacto">Centro de Contacto Liverpool (CCL) Ventas por Teléfono 55 52 62 99 99 Opción 3</p>
            <h1 class="ccl-titulo">C O T I Z A C I Ó N&nbsp;&nbsp;&nbsp;V E N T A S&nbsp;&nbsp;&nbsp;A&nbsp;&nbsp;&nbsp;D I S T A N C I A</h1>
            <p class="ccl-fecha" id="ccl-fecha">${v.fecha}</p>
        </div>
    </div>

    <p class="ccl-entrega">Por medio de la presente, hago entrega de la cotizacion solicitada.</p>

    <div class="ccl-partes">
        <div class="ccl-parte">
            <div class="ccl-parte-titulo">V E N D E D O R</div>
            <div class="ccl-parte-cuerpo">
                <p class="ccl-parte-nombre" id="ccl-asesorNombre">${v.asesorNombre}</p>
                <p>Asesor de Ventas por Teléfono e Internet</p>
                <p>postventaomnicanal@liverpool.com.mx</p>
                <p id="ccl-asesorTelefono">55-52-62-99-99 / Pregunte por su asesor</p>
            </div>
        </div>
        <div class="ccl-parte">
            <div class="ccl-parte-titulo">C L I E N T E</div>
            <div class="ccl-parte-cuerpo">
                <p class="ccl-parte-nombre" id="ccl-clienteNombre">${v.clienteNombre}</p>
                <p id="ccl-clienteEmail">${v.clienteEmail}</p>
                <p id="ccl-clienteTelefono">${v.clienteTelefono}</p>
                <p id="ccl-clienteObservacion">${v.clienteObservacion}</p>
            </div>
        </div>
    </div>

    <table class="ccl-tabla">
        <thead>
            <tr>
                <th>Sku</th>
                <th>Cantidad</th>
                <th class="ccl-col-desc">Descripción</th>
                <th>Precio Unitario</th>
                <th>Precio por volumen</th>
                <th>Descuento</th>
                <th>Precio con descuento</th>
                <th>Subtotal</th>
                <th>IVA</th>
                <th>Descuento Adicional</th>
                <th>% Descuento Adicional</th>
                <th>Total</th>
            </tr>
        </thead>
        <tbody id="ccl-productos-tbody">${v.filas}</tbody>
    </table>

    <div class="ccl-pie">
        <div class="ccl-info">
            <div class="ccl-info-titulo">I N F O R M A C I Ó N&nbsp;&nbsp;&nbsp;A D I C I O N A L</div>
            <p>Disponibilidad, precios y promociones sujetas a cambios sin previo aviso.</p>
        </div>
        <table class="ccl-totales">
            <tbody>
                <tr><td>S U B T O T A L</td><td id="ccl-subtotal">${v.subtotal}</td></tr>
                <tr><td>I V A</td><td id="ccl-iva">${v.iva}</td></tr>
                <tr class="ccl-total-final"><td>T O T A L</td><td id="ccl-total">${v.total}</td></tr>
            </tbody>
        </table>
    </div>
</div>`;
}
