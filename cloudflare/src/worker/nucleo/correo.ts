/**
 * Correo | Portal Ventel en Cloudflare
 * ====================================
 * En Apps Script los correos salían por GmailApp/MailApp desde la cuenta que desplegó, con su alias.
 * Esta versión NO manda correos de verdad: es una maqueta y Gmail es un servicio de Google que se
 * dejó fuera a propósito. Cada correo se guarda COMPLETO en la tabla `correos_salida` y la función
 * contesta como si hubiera salido, así que las pantallas siguen su flujo normal (métricas, estatus
 * «Enviada», avisos) y en la demo se puede enseñar exactamente qué habría recibido el cliente.
 *
 * Para mandarlos de verdad bastaría cambiar el cuerpo de enviarCorreo (Email Routing de Cloudflare,
 * Resend, SES…); ningún módulo tiene que enterarse.
 */
import type { Ctx } from './contexto';

export interface Adjunto { nombre: string; tipo?: string; bytes?: number }

export interface Correo {
  para: string | string[];
  asunto: string;
  html?: string;
  texto?: string;
  cc?: string | string[];
  cco?: string | string[];
  de?: string;            // alias / remitente
  nombreDe?: string;      // nombre visible del remitente
  responderA?: string;
  adjuntos?: Adjunto[];
  tipo?: string;          // 'cotizacion' | 'plantilla' | 'difusion' | 'cuenta' | 'revision' | …
  referencia?: string;    // folio, id de plantilla…
}

/** Cuota diaria «restante» (MailApp.getRemainingDailyQuota). En la maqueta no hay tope real. */
export const CUOTA_CORREO_DIARIA = 1500;

const lista = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean).join(', ');

/** «Envía» un correo: lo deja en la bandeja de salida. Devuelve su id. */
export async function enviarCorreo(ctx: Ctx, c: Correo): Promise<{ ok: true; id: number; simulado: true }> {
  const r = await ctx.ejecutar(
    'INSERT INTO correos_salida (fecha, de, nombre_de, responder_a, para, cc, cco, asunto, html, texto, adjuntos, tipo, referencia) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ctx.ahoraIso(), c.de || 'portal@ventel.example', c.nombreDe || 'Portal Ventel', c.responderA || '',
    lista(c.para), lista(c.cc), lista(c.cco), c.asunto || '', c.html || '', c.texto || '',
    JSON.stringify((c.adjuntos || []).map((a) => ({ nombre: a.nombre, tipo: a.tipo || '', bytes: a.bytes || 0 }))),
    c.tipo || '', c.referencia || '');
  return { ok: true, id: r.ultimoId, simulado: true };
}
