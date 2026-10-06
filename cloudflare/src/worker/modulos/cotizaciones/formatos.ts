/**
 * FORMATOS DE COTIZACIÓN | Portal Ventel en Cloudflare
 * ====================================================
 * Port de Formatos.gs. El catálogo y qué formatos están habilitados funcionan igual (la
 * configuración vive en la propiedad `formatos_habilitados`). Lo que en Apps Script producía algo
 * en Google Drive —el PDF, la hoja CCL copiada de la plantilla— aquí no existe: esas funciones
 * contestan con la MISMA forma de fallo controlado del .gs y un mensaje claro.
 *
 *  1. 'actual'        → el documento que se arma desde HTML.
 *  2. 'ccl_liverpool' → el formato oficial CCL. La pantalla lo pinta igual (app_ccl.html, réplica
 *                        de la plantilla) y se imprime con Ctrl+P; lo que falta es la hoja real.
 */
import type { Ctx } from '../../nucleo/contexto';
import { leerPropiedad, fijarPropiedad } from '../../nucleo/sistema';
import { secIdentidad, secIdentidadAvanzada } from '../../nucleo/seguridad';
import { QUOTE_FORMATS, DEFAULT_FORMAT_ID, MSG_SIN_DRIVE, MSG_SIN_PDF } from './comun';

export const FORMATS_PROP_KEY = 'formatos_habilitados';

/**
 * Qué formatos están habilitados. Un formato sin registro se considera habilitado, para que al
 * agregar formatos nuevos no queden invisibles por omisión.
 */
export async function readFormatFlags(ctx: Ctx): Promise<Record<string, boolean>> {
  try {
    const raw = await leerPropiedad(ctx, FORMATS_PROP_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    const flags: Record<string, boolean> = {};
    QUOTE_FORMATS.forEach((f) => {
      flags[f.id] = stored[f.id] === undefined ? true : stored[f.id] === true;
    });
    return flags;
  } catch (error) {
    console.error('Error en readFormatFlags', error);
    const flags: Record<string, boolean> = {};
    QUOTE_FORMATS.forEach((f) => { flags[f.id] = true; });
    return flags;
  }
}

/** isAdvancedUser (Formatos.gs): delegado a la identidad avanzada de Seguridad. */
export async function isAdvancedUser(ctx: Ctx, email: unknown): Promise<boolean> {
  try {
    return (await secIdentidadAvanzada(ctx, email)).ok;
  } catch (error) {
    console.error('Error en isAdvancedUser', error);
    return false;
  }
}

/**
 * ¿Se puede usar el formato? En Apps Script, para el CCL se abría la plantilla de Google Sheets.
 * Aquí la plantilla no existe, pero el formato SÍ se puede elegir: la pantalla lo pinta con su
 * réplica (app_ccl.html) y se imprime desde el navegador. Lo que no hay —la hoja real y el PDF—
 * lo dicen openQuoteInSheets/previewSheetCcl/downloadQuotePdf al pedirlo.
 */
export function checkFormatAvailability(formatId: string): { available: boolean; reason: string } {
  return { available: QUOTE_FORMATS.some((f) => f.id === formatId), reason: '' };
}

/**
 * Catálogo completo con su estado, para el panel de administración.
 * Puerta: la de Formatos.gs (isAdvancedUser). La consola añade la suya (adm_formatos) en su envoltorio.
 */
export async function getFormatSettings(ctx: Ctx, email: string) {
  try {
    if (!(await isAdvancedUser(ctx, email))) {
      return { success: false, message: 'No tienes permisos para administrar los formatos.' };
    }
    const flags = await readFormatFlags(ctx);
    const formats = QUOTE_FORMATS.map((f) => {
      const availability = checkFormatAvailability(f.id);
      return {
        id: f.id,
        name: f.name,
        description: f.description,
        enabled: flags[f.id],
        available: availability.available,
        unavailableReason: availability.reason
      };
    });
    return { success: true, formats };
  } catch (error) {
    console.error('Error en getFormatSettings', error);
    return { success: false, message: 'No pudimos cargar los formatos. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * Habilita o deshabilita un formato. No deja cero habilitados: el sistema se quedaría sin forma
 * de imprimir.
 */
export async function setQuoteFormatEnabled(ctx: Ctx, email: string, formatId: string, enabled: boolean) {
  try {
    if (!(await isAdvancedUser(ctx, email))) {
      return { success: false, message: 'No tienes permisos para administrar los formatos.' };
    }
    if (!QUOTE_FORMATS.some((f) => f.id === formatId)) {
      return { success: false, message: `El formato '${formatId}' no existe.` };
    }

    const flags = await readFormatFlags(ctx);
    flags[formatId] = enabled === true;

    if (!Object.keys(flags).some((id) => flags[id])) {
      return { success: false, message: 'Debe quedar al menos un formato habilitado.' };
    }

    await fijarPropiedad(ctx, FORMATS_PROP_KEY, JSON.stringify(flags));
    console.log(`Formato ${formatId} ${enabled ? 'habilitado' : 'deshabilitado'} por ${email}.`);

    return getFormatSettings(ctx, email);
  } catch (error) {
    console.error('Error en setQuoteFormatEnabled', error);
    return { success: false, message: 'No pudimos guardar el cambio. Inténtalo de nuevo en un momento.' };
  }
}

/** Los formatos que el asesor puede elegir al cotizar: habilitados y utilizables. Sin puerta. */
export async function getEnabledQuoteFormats(ctx: Ctx) {
  try {
    const flags = await readFormatFlags(ctx);
    const formats = QUOTE_FORMATS
      .filter((f) => flags[f.id] && checkFormatAvailability(f.id).available)
      .map((f) => ({ id: f.id, name: f.name, description: f.description }));

    const defaultId = formats.some((f) => f.id === DEFAULT_FORMAT_ID)
      ? DEFAULT_FORMAT_ID
      : (formats.length > 0 ? formats[0].id : null);

    return { success: true, formats, defaultId };
  } catch (error) {
    console.error('Error en getEnabledQuoteFormats', error);
    return { success: false, message: 'No pudimos cargar los formatos. Inténtalo de nuevo en un momento.', formats: [] };
  }
}

// ── Lo que dependía de Google Drive ─────────────────────────────────────────

/**
 * Crea o refresca la hoja de Google Sheets con el formato CCL y devuelve su URL.
 * Sin Drive no hay hoja: después de la MISMA puerta de sesión, se contesta el fallo controlado
 * del .gs ({success:false, message}). inicio/inicio_avanzado/consulta lo enseñan en un aviso.
 */
export async function openQuoteInSheets(ctx: Ctx, folio: string, emailCliente?: string) {
  try {
    const gate = await secIdentidad(ctx, emailCliente);
    if (!gate.ok) {
      return { success: false, sinSesion: true, message: gate.error || 'Inicia sesión para abrir esta cotización.' };
    }
    if (!folio) throw new Error('El folio es requerido.');
    return {
      success: false,
      message: MSG_SIN_DRIVE + ' El formato CCL no se abre en Google Sheets: lo ves en la vista previa de la ' +
        'cotización y lo puedes imprimir (Ctrl+P → Guardar como PDF).'
    };
  } catch (error) {
    console.error(`Error en openQuoteInSheets (folio ${folio})`, error);
    return { success: false, message: 'No pudimos abrir el documento. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * La puerta que usa la vista previa en segundo plano para enseñar la hoja CCL incrustada. La
 * pantalla calla los fallos a propósito (la vista previa de arriba ya funciona): retira su panel.
 */
export async function previewSheetCcl(ctx: Ctx, folio: string) {
  try {
    if (!folio) return { success: false, message: 'Falta el folio.' };
    // Sin Drive, openQuoteInSheets nunca tiene hoja que devolver: su fallo (o el de la sesión)
    // es la respuesta, con la misma forma.
    return await openQuoteInSheets(ctx, folio);
  } catch (error) {
    console.error(`previewSheetCcl (folio ${folio})`, error);
    return { success: false, message: 'No pudimos generar el documento. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * El PDF codificado para que el navegador lo descargue. Sin Drive (ni la conversión HTML→PDF de
 * Apps Script) no hay PDF: misma puerta y el fallo controlado del .gs, con la salida que sí hay —
 * las dos pantallas que lo piden traen estilos de impresión para su vista de la cotización.
 */
export async function downloadQuotePdf(ctx: Ctx, folio: string, formatId?: string | null, emailCliente?: string) {
  try {
    const gate = await secIdentidad(ctx, emailCliente);
    if (!gate.ok) {
      return { success: false, sinSesion: true, message: gate.error || 'Inicia sesión para descargar esta cotización.' };
    }
    if (!folio) throw new Error('El folio es requerido para generar el PDF.');
    if (formatId && !QUOTE_FORMATS.some((f) => f.id === formatId)) {
      throw new Error(`Formato desconocido: '${formatId}'.`);
    }
    return { success: false, message: MSG_SIN_PDF };
  } catch (error) {
    console.error(`Error en downloadQuotePdf (folio ${folio}, formato ${formatId})`, error);
    return { success: false, message: 'No pudimos generar el PDF. Inténtalo de nuevo en un momento.' };
  }
}
