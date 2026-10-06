/**
 * ENVÍO DE LA COTIZACIÓN POR CORREO | Portal Ventel en Cloudflare
 * ===============================================================
 * Port de Correos.gs (getQuoteDetailsForEmail, sendQuoteByEmail, getMailSenderInfo y sus ayudas).
 *
 * Lo que cambia por ser Cloudflare:
 *   · El correo no sale por Gmail: enviarCorreo (nucleo/correo.ts) lo deja COMPLETO en la bandeja
 *     de salida (`correos_salida`) y contesta como enviado. El estatus «Enviada por Correo», la
 *     FechaEnvio y la métrica se escriben igual que si hubiera salido.
 *   · No hay PDF adjunto (lo generaba Drive / la conversión de Apps Script): el correo se guarda
 *     sin él y en `adjuntos` queda la nota de por qué.
 *   · El alias siempre «está dado de alta»: la bandeja de salida escribe el remitente que se le
 *     diga, así que no hay vía clásica de respaldo.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secConfig, secIdentidad } from '../../nucleo/seguridad';
import { cacheLeer, cacheGuardar } from '../../nucleo/sistema';
import { enviarCorreo } from '../../nucleo/correo';
import { escaparHtml } from '../../nucleo/util';
import { revPuedeEnviarse } from '../revision';
import {
  DEFAULT_FORMAT_ID, QUOTE_FORMATS, REV_ESTATUS_ENVIADA, celda, cotDetalleFolio, estadoRevisionDeFila
} from './comun';
import { metRegistrarEnvio, metVerificarAsesor } from './metricas';
import { tarjetaProductoHtml, sinProductosHtml, cuerpoCorreoCotizacionHtml } from './plantillas';

// Alias institucional desde el que salen las cotizaciones. Manda el ajuste MAIL_ALIAS de la
// consola; esto es el respaldo de fábrica.
export const MAIL_ALIAS_RESPALDO = 'cotizacion@liverpool.com.mx';

/** El alias con el que sale el correo del sistema (mailAlias_). */
export async function mailAlias(ctx: Ctx): Promise<string> {
  return (await secConfig(ctx, 'MAIL_ALIAS', MAIL_ALIAS_RESPALDO)) || MAIL_ALIAS_RESPALDO;
}

// ── COPIA OCULTA GLOBAL (T9.6) ───────────────────────────────────────────────
// Buzones que reciben copia de lo que el sistema manda hacia fuera. Los correos de SEGURIDAD no
// se copian nunca: por eso el CCO se aplica ruta por ruta y no dentro de enviarCorreo.

/** Buzones configurados en el ajuste CORREO_CCO_GLOBAL. Lista vacía = apagado. */
export async function correoCcoGlobal(ctx: Ctx): Promise<string[]> {
  try {
    const crudo = await secConfig(ctx, 'CORREO_CCO_GLOBAL', '');
    if (!crudo) return [];
    return String(crudo).split(/[,;\s]+/)
      .map((x) => String(x || '').trim().toLowerCase())
      .filter((x) => x && x.indexOf('@') > 0);
  } catch (e) {
    console.error('correoCcoGlobal', e);
    return [];
  }
}

/**
 * Añade la copia oculta global a unas opciones de envío ({bcc}), respetando el bcc que ya llevara
 * y sin repetir a nadie que ya reciba el correo. Devuelve cuántos buzones añadió (para la métrica).
 */
export async function correoAplicarCco(ctx: Ctx, opciones: { bcc?: string }, yaVan?: string[]): Promise<number> {
  const global = await correoCcoGlobal(ctx);
  if (!global.length || !opciones) return 0;

  const previos = String(opciones.bcc || '').split(/[,;\s]+/)
    .map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ocupados = previos.concat((yaVan || []).map((x) => String(x || '').trim().toLowerCase()));

  const nuevos = global.filter((c) => ocupados.indexOf(c) === -1);
  if (!nuevos.length) return 0;

  opciones.bcc = previos.concat(nuevos).join(',');
  return nuevos.length;
}

/**
 * Desde qué remitente saldrán los correos, para enseñarlo antes de enviar. Sin Gmail no hay alias
 * que comprobar: la bandeja de salida escribe el alias como remitente, así que siempre está.
 */
export async function getMailSenderInfo(ctx: Ctx) {
  try {
    const alias = await mailAlias(ctx);
    return { success: true, alias, aliasAvailable: true, effectiveSender: alias };
  } catch (e: any) {
    return { success: false, alias: MAIL_ALIAS_RESPALDO, aliasAvailable: false, message: String((e && e.message) || e) };
  }
}

// ── Destinatarios (CorreoCliente.gs: ccListaCorreos_) ──────────────────────────

const CC_EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Normaliza una lista de correos (arreglo o texto separado por comas/;/espacios). Lanza si hay
 * alguno inválido o se pasa del máximo. VERSIÓN LOCAL MÍNIMA: es de CorreoCliente.gs (consola).
 */
export function ccListaCorreos(input: unknown, etiqueta: string, max: number): string[] {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[,;\s]+/);
  const out: string[] = [];
  raw.forEach((e) => {
    const s = String(e || '').trim().toLowerCase();
    if (!s) return;
    if (!CC_EMAIL_RX.test(s)) throw new Error('Correo no válido en ' + etiqueta + ': ' + s);
    if (out.indexOf(s) < 0) out.push(s);
  });
  if (out.length > max) throw new Error('Máximo ' + max + ' destinatarios en ' + etiqueta + '.');
  return out;
}

// ── Imágenes de producto (getVerifiedImageUrl) ─────────────────────────────────

const IMG_SUBDOMINIOS = ['ss628', 'ss224', 'ss318', 'ss414', 'ss512', 'ss101', 'ss202', 'ss303', 'ss404'];
const IMG_PLACEHOLDER = 'https://assets.liverpool.com.mx/assets/images/placeholder.gif';
const IMG_CACHE_SEGUNDOS = 21600; // 6 h: las imágenes de catálogo no cambian de sitio.
const IMG_TIMEOUT_MS = 8000;

/** Código HTTP de una URL, o null si ni siquiera contestó (red, DNS, tiempo agotado). */
async function codigoHttp(url: string): Promise<number | null> {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(IMG_TIMEOUT_MS) });
    try { await r.body?.cancel(); } catch { /* solo importaba el código */ }
    return r.status;
  } catch {
    return null;
  }
}

/**
 * Una URL de imagen que se sabe viva, para que el cliente no reciba fotos rotas. Primero la que
 * trae el producto; si no responde 200, los servidores de imágenes conocidos de Liverpool EN
 * PARALELO. El resultado se recuerda 6 h (en Apps Script, CacheService) para no repetir hasta 10
 * peticiones por producto en cada envío. Si Liverpool no contesta, degrada como el .gs: la primera
 * candidata cuando la red falla, el placeholder cuando contestó pero ninguna existe.
 */
export async function getVerifiedImageUrl(ctx: Ctx, sku: unknown, preferredUrl: unknown): Promise<string> {
  const skuLimpio = String(sku || '').trim();
  const preferida = String(preferredUrl || '');
  const claveCache = 'img_' + skuLimpio + '_' + (preferredUrl ? preferida.length : 0);

  if (skuLimpio) {
    try {
      const guardada = await cacheLeer(ctx, claveCache);
      if (guardada) return guardada;
    } catch { /* sin caché se verifica igual */ }
  }
  const recordar = async (url: string) => {
    if (skuLimpio) {
      try { await cacheGuardar(ctx, claveCache, url, IMG_CACHE_SEGUNDOS); } catch { /* nada */ }
    }
    return url;
  };

  if (preferida && preferida.indexOf('http') === 0 && (await codigoHttp(preferida)) === 200) {
    return recordar(preferida);
  }
  if (!skuLimpio) return IMG_PLACEHOLDER;

  const candidatas = IMG_SUBDOMINIOS.map((s) => `https://${s}.liverpool.com.mx/xl/${encodeURIComponent(skuLimpio)}.jpg`);
  const codigos = await Promise.all(candidatas.map(codigoHttp));
  const viva = codigos.findIndex((c) => c === 200);
  if (viva !== -1) return recordar(candidatas[viva]);
  // fetchAll de Apps Script lanzaba si alguna petición fallaba en la red, y entonces se probaba
  // una por una y se quedaba con la primera candidata; si todas contestaron, el placeholder.
  return recordar(codigos.some((c) => c === null) ? candidatas[0] : IMG_PLACEHOLDER);
}

// ── getQuoteDetailsForEmail ─────────────────────────────────────────────────────

/**
 * Datos básicos de una cotización para rellenar el formulario de correo, con el estado de la
 * revisión (la pantalla explica el bloqueo antes de que el asesor redacte nada).
 */
export async function getQuoteDetailsForEmail(ctx: Ctx, folio: string, emailCliente?: string) {
  try {
    const gate = await secIdentidad(ctx, emailCliente);
    if (!gate.ok) {
      return { success: false, sinSesion: true, message: gate.error || 'Inicia sesión para consultar esta cotización.' };
    }
    if (!folio) throw new Error('El folio es requerido.');

    const fila = await ctx.una('SELECT folio, cliente_nombre, correo_cliente, formato, estatus, revision_estado, revisado_por, ' +
      'revisado_nombre, revision_fecha, revision_notas FROM cotizaciones WHERE folio = ?', String(folio));
    if (!fila) {
      const hay = await ctx.una('SELECT 1 AS si FROM cotizaciones LIMIT 1');
      return hay
        ? { success: false, message: `No se encontró la cotización con el folio ${folio}.` }
        : { success: false, message: 'Todavía no hay ninguna cotización registrada.' };
    }

    const details: Record<string, any> = {
      folio: fila.folio,
      clientName: celda(fila.cliente_nombre),
      clientEmail: celda(fila.correo_cliente),
      format: fila.formato ? fila.formato : DEFAULT_FORMAT_ID
    };
    // El bloqueo de verdad está en sendQuoteByEmail; esto es para poder explicarlo antes.
    details.revision = estadoRevisionDeFila(fila);
    return { success: true, data: details };
  } catch (error) {
    console.error(`Error en getQuoteDetailsForEmail para folio ${folio}`, error);
    return { success: false, message: 'No pudimos leer los datos de la cotización. Inténtalo de nuevo en un momento.' };
  }
}

// ── sendQuoteByEmail ────────────────────────────────────────────────────────────

/** Lo que el original adjuntaba y aquí no existe: queda como nota en la bandeja de salida. */
function notaSinPdf(folio: string) {
  return {
    nombre: `Cotizacion_${folio}.pdf — no adjuntado: esta versión de demostración no genera el PDF (Google Drive)`,
    tipo: 'application/pdf',
    bytes: 0
  };
}

/**
 * Envía al cliente la cotización con el mensaje del asesor.
 * @param emailData {to, subject, body, folio, format, asesor}
 */
export async function sendQuoteByEmail(ctx: Ctx, emailData: Record<string, any>) {
  const datos = emailData || {};
  try {
    if (!datos.to || !datos.subject || !datos.body || !datos.folio) {
      throw new Error('Faltan datos para enviar el correo (to, subject, body, folio).');
    }

    // Gate de sesión: quien envía debe tener sesión en la app.
    const asesorMet = await metVerificarAsesor(ctx, datos.asesor);
    if (!asesorMet.ok) {
      return { success: false, message: asesorMet.error || 'Tu sesión no es válida o expiró. Inicia sesión de nuevo para poder enviar correos.' };
    }

    // Gate de REVISIÓN, EN EL SERVIDOR: una cotización no sale al cliente hasta que se aprueba.
    const permiso = await revPuedeEnviarse(ctx, String(datos.folio));
    if (!permiso.ok) {
      console.log('Envío bloqueado por revisión pendiente: ' + datos.folio + ' — ' + permiso.message);
      return { success: false, sinAprobar: true, message: permiso.message };
    }

    // Los destinatarios se validan antes de nada caro. Máximo 3, como en correos a clientes.
    const destinatarios = ccListaCorreos(datos.to, 'Para', 3);
    if (!destinatarios.length) throw new Error('Falta el correo del cliente (Para).');
    const paraFinal = destinatarios.join(',');
    if (String(datos.subject).length > 250) throw new Error('El asunto es demasiado largo.');

    // 1. El PDF en el formato elegido. El formato se valida como en generateQuotePdfBlob (uno
    //    desconocido es basura del cliente y se dice); el PDF en sí no se genera aquí (sin Drive).
    const quoteResponse = await cotDetalleFolio(ctx, datos.folio);
    if (!quoteResponse.success) {
      throw new Error('No se pudieron obtener los detalles de la cotización para armar la plantilla.');
    }
    const quote = quoteResponse.quote;
    const formato = datos.format || quote.format || DEFAULT_FORMAT_ID;
    if (!QUOTE_FORMATS.some((f) => f.id === formato)) {
      throw new Error(`Formato desconocido: '${formato}'. Los válidos son: ${QUOTE_FORMATS.map((f) => f.id).join(', ')}.`);
    }

    // 2. Las tarjetas de producto con sus fotos (verificadas en paralelo: es lo lento).
    const productos: any[] = quote.products || [];
    let productsHtml = '';
    if (productos.length > 0) {
      const imagenes = await Promise.all(productos.map((p) => getVerifiedImageUrl(ctx, p.sku, p.imageUrl)));
      productos.forEach((p, i) => {
        const unitPrice = parseFloat(p.unitPrice) || 0;
        const quantity = parseInt(p.quantity) || 0;
        const priceVolume = unitPrice * quantity;
        let finalPricePerLine: number;
        const costPaymentUnique = parseFloat(p.costPaymentUnique) || 0;
        const discountPublicPercent = parseFloat(p.discountPublicPercent) || 0;
        const additionalDiscountApplied = p.additionalDiscountApplied === 'Si';
        const additionalDiscountPercent = parseFloat(p.additionalDiscountPercent) || 0;

        // La misma fórmula de descuentos que la pantalla de cotización y el PDF.
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

        productsHtml += tarjetaProductoHtml({
          p, verifiedImgUrl: imagenes[i], unitPrice, quantity, costPaymentUnique,
          totalMonetaryDiscount, effectiveTotalPercentage, finalPricePerLine
        });
      });
    } else {
      productsHtml = sinProductosHtml();
    }

    const userMessageHtml = escaparHtml(datos.body).replace(/\n/g, '<br>');

    // 3. La plantilla HTML del correo (formato aprobado, igual al ticket de Liverpool).
    const finalHtmlBody = cuerpoCorreoCotizacionHtml(quote, productsHtml, userMessageHtml);

    // 4. «Enviar»: queda en la bandeja de salida. Las respuestas del cliente irían al asesor dueño.
    const options: { bcc?: string } = {};
    const ccoGlobal = await correoAplicarCco(ctx, options, destinatarios.concat([quote.advisorEmail || '']));
    const alias = await mailAlias(ctx);
    await enviarCorreo(ctx, {
      para: paraFinal,
      asunto: String(datos.subject),
      html: finalHtmlBody,
      de: alias,
      nombreDe: 'Cotizaciones Ventel Liverpool', // Nombre del remitente que verá el cliente
      responderA: quote.advisorEmail || '',
      cco: options.bcc || '',
      adjuntos: [notaSinPdf(String(datos.folio))],
      tipo: 'cotizacion',
      referencia: String(datos.folio)
    });
    const sentFrom = alias;
    const aliasAvailable = true;
    console.log(`Correo de la cotización ${datos.folio} a ${paraFinal} guardado en la bandeja de salida (remitente ${sentFrom}).`);

    // 5. Estatus «Enviada por Correo» y la fecha REAL del envío (T1.6b), en una sola escritura.
    await ctx.ejecutar('UPDATE cotizaciones SET estatus = ?, fecha_envio = ? WHERE folio = ?',
      REV_ESTATUS_ENVIADA, ctx.ahoraIso(), String(datos.folio));

    // 6. Métrica del envío (mismo registro unificado que las plantillas).
    await metRegistrarEnvio(ctx, {
      tipo: 'Cotización (PDF)', referencia: datos.folio,
      asesorEmail: asesorMet.email, asesorNombre: asesorMet.nombre,
      para: paraFinal,
      destinatarios: destinatarios.length,
      cc: 0, cco: ccoGlobal, asunto: datos.subject, adjuntos: 1, remitente: sentFrom,
      aliasUsado: aliasAvailable, resultado: 'Enviado', detalle: ''
    });

    return {
      success: true,
      sentFrom,
      aliasUsed: aliasAvailable,
      message: `Correo enviado desde ${alias}.`
    };
  } catch (error: any) {
    console.error(`Error al enviar correo para folio ${datos.folio}`, error);
    await metRegistrarEnvio(ctx, {
      tipo: 'Cotización (PDF)', referencia: String(datos.folio || ''),
      asesorEmail: String(datos.asesor || '').toLowerCase(),
      para: String(datos.to || ''), resultado: 'Error', detalle: String((error && error.message) || error)
    });
    return { success: false, message: 'No pudimos enviar el correo. Revisa la dirección del cliente e inténtalo de nuevo.' };
  }
}
