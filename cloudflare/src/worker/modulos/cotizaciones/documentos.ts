/**
 * DOCUMENTOS DE LA COTIZACIÓN (el HTML que se vuelve PDF) | Portal Ventel en Cloudflare
 * =====================================================================================
 * En Apps Script el PDF salía de dos caminos (generateQuotePdfBlob, Formatos.gs):
 *   · 'actual'        → el HTML de generateQuoteHtml_ (Correos.gs) convertido por Drive.
 *   · 'ccl_liverpool' → una copia de la hoja plantilla de Google Sheets, llenada y exportada.
 * Aquí los dos son HTML que convierte Cloudflare Browser Rendering (nucleo/pdf.ts):
 *   · 'actual' → el MISMO HTML de generateQuoteHtml_ (plantillas.ts), llenado igual.
 *   · 'ccl'    → la réplica de la plantilla que ya pintan la vista previa y la consulta
 *                (app_ccl.html, plantillas.ts), llenada igual que populateCclPreview: es la hoja que
 *                el asesor ve en pantalla y la que sale con Ctrl+P. Sin Google Sheets no hay otra.
 *
 * Fotos y logotipo: el documento 'actual' no lleva fotos de producto (tampoco en el original) y el
 * CCL tampoco; lo único remoto es el logotipo de Liverpool. Se incrusta como data: URI para que el
 * navegador de Cloudflare no tenga que ir a buscar nada: una imagen que no carga, o que tarda, no
 * puede tumbar ni retrasar el PDF. Si no se pudo traer, se usa un píxel transparente (el PDF sale sin
 * logotipo antes que no salir).
 */
import type { Ctx } from '../../nucleo/contexto';
import { cacheLeer, cacheGuardar } from '../../nucleo/sistema';
import { aBase64 } from '../../nucleo/cripto';
import { escaparHtml } from '../../nucleo/util';
import { formatCurrencyGS, fechaLargaMx } from './comun';
import type { FilaCcl } from './comun';
import {
  filaPdfActualHtml, SIN_PRODUCTOS_PDF_ACTUAL, observacionesPdfActualHtml, documentoPdfActualHtml,
  CCL_ESTILOS, filaCclHtml, hojaCclHtml
} from './plantillas';

/** El logotipo que llevan los dos documentos (y la pantalla). */
export const LOGO_LIVERPOOL_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Liverpool_logo.svg/1280px-Liverpool_logo.svg.png';
/** GIF transparente de 1×1: el sitio del logotipo cuando no se pudo traer. */
export const PIXEL_TRANSPARENTE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const LOGO_CACHE = 'pdf_logo_liverpool_v1';
const LOGO_CACHE_SEG = 7 * 24 * 3600;   // el logotipo no cambia: una semana
const LOGO_TIMEOUT_MS = 4000;
const LOGO_MAX_BYTES = 400000;

/** Cambia la URL remota del logotipo por la que se le dé (data: URI). */
function conLogo(html: string, logoSrc?: string): string {
  return logoSrc ? html.split(LOGO_LIVERPOOL_URL).join(logoSrc) : html;
}

/**
 * El logotipo de Liverpool como data: URI, para incrustarlo en el documento. Se trae una vez (con
 * tiempo límite) y se recuerda una semana en la tabla `cache`. Nunca lanza: si no se puede, el
 * píxel transparente.
 */
export async function logoLiverpoolDatos(ctx: Ctx): Promise<string> {
  try {
    const guardado = await cacheLeer(ctx, LOGO_CACHE);
    if (guardado) return guardado;
  } catch { /* sin caché se trae igual */ }
  try {
    const r = await fetch(LOGO_LIVERPOOL_URL, {
      // Wikimedia pide identificarse; sin agente puede contestar 403.
      headers: { 'user-agent': 'PortalVentel/1.0 (+https://ventel.logidma.com)' },
      signal: AbortSignal.timeout(LOGO_TIMEOUT_MS)
    });
    const tipo = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (r.ok && /^image\/(png|jpe?g|gif|webp)$/.test(tipo)) {
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > 0 && bytes.length <= LOGO_MAX_BYTES) {
        const datos = 'data:' + tipo + ';base64,' + aBase64(bytes);
        try { await cacheGuardar(ctx, LOGO_CACHE, datos, LOGO_CACHE_SEG); } catch { /* la próxima vez se trae otra vez */ }
        return datos;
      }
    } else {
      try { await r.body?.cancel(); } catch { /* nada */ }
    }
  } catch (e) {
    console.error('No se pudo traer el logotipo para el PDF', e);
  }
  return PIXEL_TRANSPARENTE;
}

// ── Formato 'actual' (generateQuoteHtml_, Correos.gs) ───────────────────────

/** El HTML del PDF 'actual' de una cotización (la que devuelve cotDetalleFolio). */
export function documentoActualHtml(data: Record<string, any>, logoSrc?: string): string {
  let productsHtml = '';
  if (data.products && data.products.length > 0) {
    data.products.forEach((p: any) => {
      const unitPrice = parseFloat(p.unitPrice) || 0;
      const quantity = parseInt(p.quantity) || 0;
      const priceVolume = unitPrice * quantity;
      let finalPricePerLine: number;
      let discountDisplayString = '-';
      const costPaymentUnique = parseFloat(p.costPaymentUnique) || 0;
      const discountPublicPercent = parseFloat(p.discountPublicPercent) || 0;
      const additionalDiscountApplied = p.additionalDiscountApplied === 'Si';
      const additionalDiscountPercent = parseFloat(p.additionalDiscountPercent) || 0;

      // La misma fórmula de descuentos que la pantalla de cotización y el correo.
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
        const details: string[] = [];
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
          discountDisplayString = '-';
        }
      }

      productsHtml += filaPdfActualHtml({ p, quantity, unitPrice, priceVolume, discountDisplayString, finalPricePerLine });
    });
  } else {
    productsHtml = SIN_PRODUCTOS_PDF_ACTUAL;
  }
  const observationsHtml = observacionesPdfActualHtml(data);
  return conLogo(documentoPdfActualHtml(data, productsHtml, observationsHtml), logoSrc);
}

// ── Formato CCL (app_ccl.html) ──────────────────────────────────────────────

/**
 * Una fila del formato CCL con las fórmulas de la plantilla de Sheets (computeCclRow de app_ccl.html,
 * que a su vez sigue a buildCclProductRow_ de Formatos.gs): si cambia una, cambian las tres.
 *   I = H*B · K = I-(I*J) · P = K-(O*K) · L = IF(N="NO", K/1.16, P/1.16) · M = base - L
 */
export function computeCclRow(p: any): FilaCcl {
  const quantity = parseInt(p.quantity) || 0;
  const unitPrice = parseFloat(p.unitPrice) || 0;
  const costPaymentUnique = parseFloat(p.costPaymentUnique) || 0;
  const priceVolume = unitPrice * quantity;

  let discountFraction = (parseFloat(p.discountPublicPercent) || 0) / 100;
  const additionalApplied = p.additionalDiscountApplied === 'Si' ? 'Si' : 'No';
  let additionalFraction = (parseFloat(p.additionalDiscountPercent) || 0) / 100;

  // El pago único no existe en el CCL: se traduce al descuento equivalente (en la columna
  // adicional si el asesor marcó descuento adicional).
  if (costPaymentUnique > 0 && priceVolume > 0) {
    if (additionalApplied === 'Si') {
      const priceWithPublic = priceVolume * (1 - discountFraction);
      additionalFraction = priceWithPublic > 0
        ? Math.min(1, Math.max(0, 1 - (costPaymentUnique / priceWithPublic)))
        : 0;
    } else {
      discountFraction = Math.max(0, 1 - (costPaymentUnique / priceVolume));
      additionalFraction = 0;
    }
  }

  const priceWithDiscount = priceVolume - (priceVolume * discountFraction);
  const total = priceWithDiscount - (additionalFraction * priceWithDiscount);
  const base = additionalApplied === 'No' ? priceWithDiscount : total;
  const subtotal = base / 1.16;

  return {
    sku: p.sku || '',
    description: p.description || '',
    quantity,
    unitPrice,
    priceVolume,
    discountFraction,
    priceWithDiscount,
    subtotal,
    vat: base - subtotal,
    additionalApplied,
    additionalFraction,
    total
  };
}

/*
 * Lo que en la pantalla ponían alrededor de la hoja el tema y Tailwind (y que la réplica da por
 * hecho): cajas border-box, interlineado 1.5, tipografía sin remates, imágenes en bloque y papel
 * blanco con sus colores al imprimir. Sin fuentes web: el documento no carga nada de fuera.
 */
const CCL_BASE = `
    *, ::before, ::after { box-sizing: border-box; }
    html { line-height: 1.5; -webkit-text-size-adjust: 100%; }
    body { margin: 0; background: #fff; color: #222;
           font-family: Inter, Roboto, 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    img { display: block; max-width: 100%; }
    table { text-indent: 0; border-color: inherit; }
`;

/** El documento del formato CCL de una cotización: la réplica de la pantalla, llenada en el servidor. */
export function documentoCclHtml(data: Record<string, any>, logoSrc?: string): string {
  // Lo mismo que populateCclPreview, con la fecha en hora de México (en la pantalla era la del navegador).
  const fecha = fechaLargaMx(data.timestamp || Date.now()) + '   |   Folio: ' + (data.folio || 'NUEVO');

  let sumSubtotal = 0, sumVat = 0, sumTotal = 0;
  const filas = (data.products || []).map((p: any) => {
    const r = computeCclRow(p);
    sumSubtotal += r.subtotal;
    sumVat += r.vat;
    sumTotal += r.total;
    return '<tr>' + filaCclHtml(r) + '</tr>';
  }).join('');

  const hoja = hojaCclHtml({
    fecha: escaparHtml(fecha),
    asesorNombre: escaparHtml(data.advisorName || 'N/A'),
    clienteNombre: escaparHtml('Dirigida a: ' + (data.clientName || 'Cliente')),
    clienteEmail: escaparHtml('Correo: ' + (data.clientEmail || '')),
    clienteTelefono: escaparHtml('Teléfono: ' + (data.clientPhone || '')),
    clienteObservacion: escaparHtml('Observación: ' + (data.observations || '')),
    filas,
    subtotal: formatCurrencyGS(sumSubtotal),
    iva: formatCurrencyGS(sumVat),
    total: formatCurrencyGS(sumTotal)
  });

  return conLogo('<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n' +
    '<title>' + escaparHtml('Cotizacion_' + (data.folio || '')) + '</title>\n' +
    '<style>' + CCL_BASE + CCL_ESTILOS + '\n</style>\n</head>\n<body>\n' + hoja + '\n</body>\n</html>\n', logoSrc);
}
