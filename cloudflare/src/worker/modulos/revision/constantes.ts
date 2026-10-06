/**
 * Constantes de la revisión y validación de URLs | Portal Ventel en Cloudflare
 * ===========================================================================
 * Lo que Revision.gs compartía con PoliticaRevision.gs y con Code.gs: los estatus del ciclo de vida
 * de una cotización y la validación de los enlaces de artículo y de hoja de cálculo. Va en su propio
 * archivo para que revision.ts, politica.ts y liverpool.ts lo usen sin importarse en círculo.
 */

// --- Estatus del ciclo de vida de una cotización ------------------------------------------
// Se guardan en la columna `estatus` de cotizaciones. El resultado DURADERO de la revisión vive
// aparte, en `revision_estado`, porque `estatus` se sobrescribe al enviar el correo ("Enviada por
// Correo") y con él se perdería el rastro de quién aprobó qué. Mismos textos que Revision.gs.
export const REV_ESTATUS_PENDIENTE = 'En Revisión';
export const REV_ESTATUS_APROBADA = 'Aprobada';
export const REV_ESTATUS_RECHAZADA = 'Rechazada';
export const REV_ESTATUS_ENVIADA = 'Enviada por Correo';

/** Quién firma una aprobación automática (PoliticaRevision.gs · revpolSellarAprobacionAutomatica_). */
export const REV_POR_AUTOMATICA = 'politica-automatica@sistema';
export const REV_NOMBRE_AUTOMATICA = 'Aprobación automática';

/**
 * Dominios cuyas páginas se pueden incrustar en la pantalla de revisión y consultar desde el servidor.
 * El enlace del artículo llega desde la extensión y acaba dentro de un `src` de iframe y de un fetch:
 * sin esta lista, una celda con `javascript:...` sería ejecución de código en la sesión de quien
 * revisa, y cualquier otra dirección convertiría al Worker en un relay de descargas. Se compara el
 * HOST EXACTO, nunca con `includes`.
 */
export const REV_HOSTS_ARTICULO = ['liverpool.com.mx', 'www.liverpool.com.mx'];

/**
 * Devuelve la URL del artículo solo si es segura de incrustar y de pedir; si no, cadena vacía.
 * Regla: https, host exacto de la lista y nada de credenciales embebidas. Se descompone a mano
 * (como en Apps Script, que no traía la clase URL) comparando el host COMPLETO: con
 * `startsWith`/`includes`, "https://evil.com/?x=liverpool.com.mx" saltaría sin despeinarse.
 */
export function revUrlArticuloSegura(url: unknown): string {
  const bruta = String(url == null ? '' : url).trim();
  if (!bruta) return '';

  const m = bruta.match(/^(https?):\/\/([^\/?#]+)([\/?#][\s\S]*)?$/i);
  if (!m) return '';
  if (m[1].toLowerCase() !== 'https') return '';

  const autoridad = m[2];
  // "usuario:clave@host" — nunca en un enlace nuestro; se descarta entero.
  if (autoridad.indexOf('@') > -1) return '';
  const host = autoridad.split(':')[0].toLowerCase();
  if (REV_HOSTS_ARTICULO.indexOf(host) === -1) return '';

  // Ni saltos de línea ni comillas: acabaría dentro de un atributo HTML.
  if (/[\s"'<>\\]/.test(bruta)) return '';
  if (bruta.length > 2000) return '';
  return bruta;
}

/** Identificador de un Google Sheet a partir de cualquiera de sus URLs ({id:'', gid:''} si no lo es). */
export function revSheetId(url: unknown): { id: string; gid: string } {
  const bruta = String(url == null ? '' : url).trim();
  const m = bruta.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9\-_]{20,})/);
  if (!m) return { id: '', gid: '' };
  const g = bruta.match(/[#&?]gid=([0-9]+)/);
  return { id: m[1], gid: g ? g[1] : '' };
}

/**
 * URL de un Google Sheet que SÍ se puede meter en un <iframe>: `/preview`, la vista de solo lectura
 * que Drive publica para incrustarse (la de edición la bloquea el navegador con X-Frame-Options).
 */
export function revUrlEmbedSheet(url: unknown): string {
  const s = revSheetId(url);
  if (!s.id) return '';
  return 'https://docs.google.com/spreadsheets/d/' + s.id + '/preview' + (s.gid ? '?gid=' + s.gid : '');
}
