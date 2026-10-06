/**
 * CORREOS A CLIENTES (?page=correo_cliente) | Portal Ventel en Cloudflare
 * ======================================================================
 * Port de CorreoCliente.gs. El asesor llena una plantilla en el navegador, la revisa en el modal de
 * verificación y confirma; el HTML final llega ya armado desde el cliente (idéntico a la vista
 * previa) y aquí solo se valida y se «envía». La plantilla de cotización NO se acepta aquí: esa sale
 * con su PDF desde «Enviar correo».
 *
 * En esta versión el correo sale por Brevo (nucleo/correo.ts) desde el dominio de envío, con la
 * respuesta dirigida al asesor (responderA = el replyTo de allá), y queda completo en la bandeja de
 * salida. Los adjuntos se validan igual (cuántos, cuánto pesan) y viajan con su contenido.
 */
import type { Ctx } from '../../nucleo/contexto';
import { enviarCorreo, type Adjunto } from '../../nucleo/correo';
import { deBase64 } from '../../nucleo/cripto';
import { metRegistrarEnvio, metVerificarAsesor, mailAlias, correoAplicarCco } from '../cotizaciones';
import { ccSenderName, correoEnBandeja } from './comun';

const CC_PLANTILLAS_VALIDAS = ['ticket', 'edodecuenta', 'edodecuentaextranjera', 'validacionexitosa', 'formato', 'textoplano'];
const CC_EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** ccListaCorreos_: normaliza una lista (arreglo o texto separado por comas/;/espacios). Lanza si hay alguno inválido. */
function ccListaCorreos(input: unknown, etiqueta: string, max: number): string[] {
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

/** registrarCorreoClienteEnviado_: bitácora aditiva «CorreosEnviados». No bloquea el envío si falla. */
async function registrarCorreoClienteEnviado(ctx: Ctx, plantilla: string, to: string[], cc: string[], cco: string[],
  asunto: string, asesor: string, remitente: string, numAdjuntos: number): Promise<void> {
  try {
    await ctx.ejecutar(
      'INSERT INTO correos_enviados (fecha, plantilla, para, cc, cco, asunto, asesor, remitente, adjuntos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ctx.ahoraIso(), plantilla, to.join(', '), cc.join(', '), cco.join(', '), asunto, asesor, remitente, String(numAdjuntos || 0));
  } catch (e) {
    console.error('No se pudo registrar el envío en la bitácora', e);
  }
}

/**
 * Envía al cliente un correo generado desde una plantilla.
 * payload: {plantilla, to, cc, cco, asunto, asuntoPlantilla, htmlBody, adjuntos:[{nombre, mime, base64}], asesor}
 * @return {status:'ok', sentFrom} | {status:'error', error}
 */
export async function enviarCorreoPlantilla(ctx: Ctx, payload: any) {
  try {
    if (!payload || typeof payload !== 'object') throw new Error('No se recibieron datos.');

    // Puerta de sesión: el asesor debe estar dado de alta y con sesión para poder enviar.
    const asesorMet = await metVerificarAsesor(ctx, payload.asesor);
    if (!asesorMet.ok) {
      return { status: 'error', error: asesorMet.error || 'Tu sesión no es válida o expiró. Inicia sesión de nuevo para poder enviar correos.' };
    }

    const plantilla = String(payload.plantilla || '').trim().toLowerCase();
    if (CC_PLANTILLAS_VALIDAS.indexOf(plantilla) < 0) {
      throw new Error('Plantilla no válida para esta pantalla: ' + (plantilla || '(vacía)') +
        '. Las cotizaciones se envían desde "Enviar correo".');
    }

    const to = ccListaCorreos(payload.to, 'Para', 3);
    if (!to.length) throw new Error('Falta el correo del cliente (Para).');
    const cc = ccListaCorreos(payload.cc, 'CC', 10);
    const cco = ccListaCorreos(payload.cco, 'CCO', 10);

    const asunto = String(payload.asunto || '').trim();
    if (!asunto) throw new Error('El asunto es obligatorio.');
    if (asunto.length > 250) throw new Error('El asunto es demasiado largo.');

    const htmlBody = String(payload.htmlBody || '');
    if (!htmlBody.trim()) throw new Error('El cuerpo del correo llegó vacío.');
    if (htmlBody.length > 400000) throw new Error('El cuerpo del correo es demasiado grande.');

    // Adjuntos: llegan como base64; límite total 20 MB. Se valida igual que allá.
    const adjuntos: Adjunto[] = [];
    let totalBytes = 0;
    (Array.isArray(payload.adjuntos) ? payload.adjuntos : []).forEach((a: any) => {
      if (!a || !a.base64) return;
      const bytes = deBase64(String(a.base64)).length;
      totalBytes += bytes;
      if (totalBytes > 20 * 1024 * 1024) throw new Error('Los adjuntos superan el límite de 20 MB.');
      const nombre = String(a.nombre || 'adjunto').replace(/[\\\/:*?"<>|]+/g, '_');
      adjuntos.push({ nombre, tipo: String(a.mime || 'application/octet-stream'), bytes });
    });

    // Las respuestas del cliente van al asesor con sesión.
    const advisorEmail = asesorMet.email;
    const opciones: { bcc?: string } = { bcc: cco.join(',') };
    // Copia oculta global: va DESPUÉS del cco que teclea el asesor y sin repetir a nadie.
    const ccoGlobal = await correoAplicarCco(ctx, opciones, to.concat(cc).concat(cco).concat([advisorEmail]));

    /* ¿Se tocó lo que proponía la plantilla? Lo único que el asesor reescribe es el ASUNTO. Es una
       MÉTRICA, no un candado: sin dato se apunta '' en vez de un «No» inventado. */
    let plantillaModificada = '';
    const asuntoPropuesto = String(payload.asuntoPlantilla || '').trim();
    if (asuntoPropuesto) plantillaModificada = (asuntoPropuesto === asunto) ? 'No' : 'Sí';

    // No hay alias de Gmail que comprobar (getAliases): se pide el alias y el núcleo lo deja en el
    // dominio de envío. Si el proveedor rechaza el correo, enviarCorreo LANZA como MailApp.sendEmail
    // y el catch de abajo apunta la métrica de error, igual que allá.
    const envio = await enviarCorreo(ctx, {
      para: to, asunto, html: htmlBody, cc, cco: opciones.bcc || '',
      de: await mailAlias(ctx), nombreDe: await ccSenderName(ctx), responderA: advisorEmail || '',
      adjuntos, tipo: 'plantilla', referencia: plantilla
    });
    const fila = await correoEnBandeja(ctx, envio.id);
    const sentFrom = (fila && fila.de) || (await mailAlias(ctx));

    await registrarCorreoClienteEnviado(ctx, plantilla, to, cc, cco, asunto, advisorEmail, sentFrom, adjuntos.length);

    await metRegistrarEnvio(ctx, {
      tipo: 'Plantilla cliente', referencia: plantilla,
      asesorEmail: asesorMet.email, asesorNombre: asesorMet.nombre,
      para: to.join(', '), destinatarios: to.length, cc: cc.length, cco: cco.length + ccoGlobal,
      asunto, adjuntos: adjuntos.length, remitente: sentFrom,
      aliasUsado: true, resultado: 'Enviado', detalle: '',
      plantillaModificada
    });

    return { status: 'ok', sentFrom };
  } catch (error: any) {
    console.error('Error en enviarCorreoPlantilla', error);
    // Se registra el intento fallido para que las métricas reflejen también los errores.
    await metRegistrarEnvio(ctx, {
      tipo: 'Plantilla cliente', referencia: String((payload && payload.plantilla) || ''),
      asesorEmail: String((payload && payload.asesor) || '').toLowerCase(),
      para: '', resultado: 'Error', detalle: String(error)
    });
    return { status: 'error', error: String(error) };
  }
}
