/**
 * PDF | Portal Ventel en Cloudflare
 * =================================
 * En Apps Script el PDF de la cotización salía de convertir su HTML en Google Drive. Aquí lo genera
 * Cloudflare Browser Rendering (un Chrome en la red de Cloudflare) con el binding NAVEGADOR del Worker
 * de API: mismo HTML, sin Drive y sin token.
 *
 *   const pdf = await generarPdf(ctx, html);      → Uint8Array, o null si no se pudo
 *
 * Devuelve null (nunca lanza) cuando no hay binding (en local) o el servicio falla: quien llama decide
 * cómo degradar, igual que el .gs cuando Drive no contestaba.
 */
import type { Ctx } from './contexto';

export interface OpcionesPdf {
  formato?: 'letter' | 'a4' | 'legal';   // en minúsculas: Browser Rendering rechaza «Letter» (medido)
  horizontal?: boolean;
  margen?: string;      // CSS, p. ej. '12mm'
}

export async function generarPdf(ctx: Ctx, html: string, op: OpcionesPdf = {}): Promise<Uint8Array | null> {
  const nav = ctx.env.NAVEGADOR;
  if (!nav || typeof nav.quickAction !== 'function' || !html) return null;
  const margen = op.margen || '10mm';
  try {
    const r = await nav.quickAction('pdf', {
      html,
      pdfOptions: Object.assign({
        format: String(op.formato || 'letter').toLowerCase(),
        printBackground: true,
        margin: { top: margen, right: margen, bottom: margen, left: margen }
      }, op.horizontal ? { landscape: true } : {}),
      gotoOptions: { waitUntil: 'networkidle0', timeout: 20000 }
    });
    if (!r.ok) {
      console.error('generarPdf: Browser Rendering contestó', r.status, (await r.text()).slice(0, 300));
      return null;
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    // Un PDF empieza por «%PDF»: si no, lo que llegó es un error con otra forma.
    return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 ? bytes : null;
  } catch (e) {
    console.error('generarPdf', e);
    return null;
  }
}
