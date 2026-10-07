/**
 * Correo | Portal Ventel en Cloudflare
 * ====================================
 * En Apps Script los correos salían por GmailApp/MailApp desde la cuenta que desplegó, con el alias
 * de grupo MAIL_ALIAS (cotizacion@liverpool.com.mx). En esta versión salen DE VERDAD por Brevo, desde
 * el dominio logidma.com (autenticado en Brevo con SPF y DKIM). Es la única diferencia con el
 * original: mismo HTML, mismo asunto, mismas copias y la respuesta va al asesor (responderA).
 *
 *   · Remitente: siempre una dirección de logidma.com. Si un módulo pasa otra (p. ej. el alias de
 *     grupo del original), se usa BREVO_REMITENTE (por omisión ventel@logidma.com) con el mismo
 *     nombre visible.
 *   · Cada correo queda además COMPLETO en `correos_salida`, con su estado: 'enviado' (y el id de
 *     Brevo), 'omitido' (no había a quién mandarlo de verdad, o el envío real está apagado) o 'error'.
 *   · Los destinatarios ficticios de la demo (@ventel.example, @ejemplo.com, dominios .example/.test)
 *     nunca se mandan: rebotarían y dañarían la reputación del dominio.
 *   · Sin la clave BREVO_API_KEY (en local, a propósito) o con la propiedad CORREO_ENVIO_REAL = 'no'
 *     (interruptor de emergencia), nada sale: todo se queda en `correos_salida`.
 *   · Si Brevo rechaza el envío, enviarCorreo LANZA, igual que GmailApp.sendEmail: el módulo que
 *     llama lo trata como trataba un fallo de Gmail.
 */
import type { Ctx } from './contexto';
import { secConfig } from './seguridad';
import { inicioDelDiaMx } from './fechas';
import { cacheSumar } from './sistema';

export interface Adjunto { nombre: string; tipo?: string; bytes?: number; base64?: string }

export interface Correo {
  para: string | string[];
  asunto: string;
  html?: string;
  texto?: string;
  cc?: string | string[];
  cco?: string | string[];
  de?: string;            // remitente que pedía el módulo (se fuerza a logidma.com)
  nombreDe?: string;      // nombre visible del remitente
  responderA?: string;    // a quién responde el cliente (el asesor)
  adjuntos?: Adjunto[];
  tipo?: string;          // 'cotizacion' | 'plantilla' | 'difusion' | 'cuenta' | 'revision' | …
  referencia?: string;    // folio, id de plantilla…
}

export interface ResultadoCorreo { ok: true; id: number; simulado: boolean; estado: 'enviado' | 'omitido'; messageId?: string; omitidos: string[] }

/** Plan gratuito de Brevo: 300 correos al día. */
export const CUOTA_CORREO_DIARIA = 300;
export const DOMINIO_CORREO = 'logidma.com';
const REMITENTE_RESPALDO = 'ventel@logidma.com';
const NOMBRE_RESPALDO = 'Centro de Contacto Liverpool | Ventel';

/**
 * Topes de lo que sale SIN sesión (los códigos de registro y de recuperación). La maqueta es pública:
 * sin esto, alguien podría usar el formulario de registro para escribirle a cientos de direcciones desde
 * logidma.com y, de paso, agotar el cupo diario de Brevo justo antes de una demostración. Con sesión
 * (cotizaciones, plantillas, difusión) no aplica: entrar ya exige la contraseña.
 */
const TOPE_SIN_SESION_DIA = 40;
const TOPE_SIN_SESION_IP_HORA = 6;

async function topeSinSesion(ctx: Ctx): Promise<string> {
  if (ctx.sesion) return '';
  const dia = inicioDelDiaMx().toISOString().slice(0, 10);
  if (await cacheSumar(ctx, 'correo-sin-sesion:' + dia, 26 * 3600) > TOPE_SIN_SESION_DIA) {
    return 'Se llegó al tope diario de correos que se pueden pedir sin iniciar sesión.';
  }
  if (ctx.ip && await cacheSumar(ctx, 'correo-sin-sesion-ip:' + ctx.ip, 3600) > TOPE_SIN_SESION_IP_HORA) {
    return 'Se llegó al tope por hora de correos pedidos desde esta conexión sin iniciar sesión.';
  }
  return '';
}

const RE_FICTICIO = /@(?:[\w.-]+\.)?(?:example|test|invalid|localhost)$|@(?:[\w.-]+\.)?(?:example|ejemplo)\.(?:com|net|org|mx)$/i;
const RE_CORREO = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;

function lista(v: string | string[] | undefined): string[] {
  const crudo = Array.isArray(v) ? v : String(v || '').split(/[,;]/);
  const vistos = new Set<string>();
  return crudo.map((x) => String(x || '').trim().replace(/^.*<([^>]+)>.*$/, '$1').toLowerCase())
    .filter((x) => x && !vistos.has(x) && (vistos.add(x), true));
}

/** ¿Se puede mandar de verdad a esta dirección? */
export function correoEnviable(direccion: string): boolean {
  return RE_CORREO.test(direccion) && !RE_FICTICIO.test(direccion);
}

/** La clave de Brevo: tal cual (xkeysib-…) o como la entrega Brevo para integraciones (base64 de {"api_key": …}). */
function claveBrevo(crudo: string | undefined): string {
  const k = String(crudo || '').trim();
  if (!k) return '';
  if (k.startsWith('xkeysib-')) return k;
  try {
    const json = JSON.parse(atob(k + '='.repeat((4 - (k.length % 4)) % 4)));
    return String(json.api_key || json.apiKey || '');
  } catch {
    return k;
  }
}

/** Remitente real: el del módulo si ya es del dominio; si no, el configurado. */
async function remitente(ctx: Ctx, pedido?: string): Promise<string> {
  const p = String(pedido || '').trim().toLowerCase();
  if (p.endsWith('@' + DOMINIO_CORREO) && RE_CORREO.test(p)) return p;
  const conf = String(await secConfig(ctx, 'BREVO_REMITENTE', REMITENTE_RESPALDO)).trim().toLowerCase();
  return conf.endsWith('@' + DOMINIO_CORREO) ? conf : REMITENTE_RESPALDO;
}

/** Cuántos correos quedan hoy (lo que en Apps Script era MailApp.getRemainingDailyQuota()). */
export async function cuotaCorreoRestante(ctx: Ctx): Promise<number> {
  const fila = await ctx.una<{ n: number }>(
    "SELECT COUNT(*) AS n FROM correos_salida WHERE estado = 'enviado' AND fecha >= ?", inicioDelDiaMx().toISOString());
  return Math.max(0, CUOTA_CORREO_DIARIA - Number(fila?.n || 0));
}

async function registrar(ctx: Ctx, c: Correo, de: string, nombreDe: string, para: string[], cc: string[], cco: string[],
                         estado: string, proveedorId: string, detalle: string): Promise<number> {
  const r = await ctx.ejecutar(
    'INSERT INTO correos_salida (fecha, de, nombre_de, responder_a, para, cc, cco, asunto, html, texto, adjuntos, tipo, referencia, estado, proveedor_id, detalle) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ctx.ahoraIso(), de, nombreDe, c.responderA || '', para.join(', '), cc.join(', '), cco.join(', '),
    c.asunto || '', c.html || '', c.texto || '',
    JSON.stringify((c.adjuntos || []).map((a) => ({ nombre: a.nombre, tipo: a.tipo || '', bytes: a.bytes || 0 }))),
    c.tipo || '', c.referencia || '', estado, proveedorId, detalle);
  return r.ultimoId;
}

/** Envía un correo por Brevo (o lo deja en la bandeja de salida si no puede salir de verdad). */
export async function enviarCorreo(ctx: Ctx, c: Correo): Promise<ResultadoCorreo> {
  const de = await remitente(ctx, c.de);
  const nombreDe = String(c.nombreDe || await secConfig(ctx, 'CC_SENDER_NAME', NOMBRE_RESPALDO)).slice(0, 70);
  const paraTodos = lista(c.para), ccTodos = lista(c.cc), ccoTodos = lista(c.cco);
  const para = paraTodos.filter(correoEnviable), cc = ccTodos.filter(correoEnviable), cco = ccoTodos.filter(correoEnviable);
  const omitidos = [...paraTodos, ...ccTodos, ...ccoTodos].filter((x) => !correoEnviable(x));

  const clave = claveBrevo(ctx.env.BREVO_API_KEY);
  const apagado = String(await secConfig(ctx, 'CORREO_ENVIO_REAL', 'si')).trim().toLowerCase() === 'no';
  if (!clave || apagado || (!para.length && !cc.length && !cco.length)) {
    const motivo = !clave ? 'Sin clave de Brevo en este entorno: no sale.'
      : apagado ? 'Envío real apagado (CORREO_ENVIO_REAL = no).'
      : 'Todos los destinatarios son de ejemplo: no se manda nada.';
    const id = await registrar(ctx, c, de, nombreDe, paraTodos, ccTodos, ccoTodos, 'omitido', '', motivo);
    return { ok: true, id, simulado: true, estado: 'omitido', omitidos };
  }

  const tope = await topeSinSesion(ctx);
  if (tope) {
    await registrar(ctx, c, de, nombreDe, paraTodos, ccTodos, ccoTodos, 'omitido', '', tope);
    throw new Error(tope + ' Inténtalo más tarde.');
  }

  // Brevo exige al menos un «Para». Si solo quedan copias (difusión en CCO con un «Para» de ejemplo),
  // va al propio remitente, como un envío masivo normal.
  const destino = para.length ? para : [de];
  const cuerpo: Record<string, unknown> = {
    sender: { name: nombreDe, email: de },
    to: destino.map((email) => ({ email })),
    subject: c.asunto || '(sin asunto)',
    htmlContent: c.html || ('<pre style="font-family:inherit;white-space:pre-wrap">' +
      String(c.texto || '').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>'),
    tags: ['portal-ventel', c.tipo || 'general']
  };
  if (c.texto) cuerpo.textContent = c.texto;
  if (cc.length) cuerpo.cc = cc.map((email) => ({ email }));
  if (cco.length) cuerpo.bcc = cco.map((email) => ({ email }));
  if (c.responderA && correoEnviable(String(c.responderA).trim().toLowerCase())) cuerpo.replyTo = { email: String(c.responderA).trim().toLowerCase() };
  const conContenido = (c.adjuntos || []).filter((a) => a.base64);
  if (conContenido.length) cuerpo.attachment = conContenido.map((a) => ({ name: a.nombre, content: a.base64 }));

  let estadoHttp = 0, respuesta: any = null, falla = '';
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': clave, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(15000)
    });
    estadoHttp = r.status;
    respuesta = await r.json().catch(() => null);
    if (!r.ok) falla = String((respuesta && (respuesta.message || respuesta.code)) || ('HTTP ' + r.status));
  } catch (e: any) {
    falla = String((e && e.message) || e || 'sin respuesta');
  }

  if (falla) {
    await registrar(ctx, c, de, nombreDe, destino, cc, cco, 'error', '', ('Brevo ' + estadoHttp + ': ' + falla).slice(0, 500));
    throw new Error('No se pudo enviar el correo: ' + falla);
  }
  const messageId = String((respuesta && respuesta.messageId) || '');
  const id = await registrar(ctx, c, de, nombreDe, destino, cc, cco, 'enviado', messageId,
    omitidos.length ? 'Sin enviar a direcciones de ejemplo: ' + omitidos.join(', ') : '');
  return { ok: true, id, simulado: false, estado: 'enviado', messageId, omitidos };
}
