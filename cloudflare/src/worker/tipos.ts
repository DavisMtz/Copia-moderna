/** Lo que el Worker recibe de Cloudflare (wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  ARCHIVOS: R2Bucket;
  ASSETS: Fetcher;
  /** Producción: el Worker de API junto a la base (Service Binding). En local no existe. */
  API?: Fetcher;
  ENTORNO?: string;
  /** Secreto (solo en producción, Worker de API): clave de Brevo para mandar los correos. */
  BREVO_API_KEY?: string;
}
