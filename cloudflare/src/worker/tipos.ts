/** Lo que el Worker recibe de Cloudflare (wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  ARCHIVOS: R2Bucket;
  ASSETS: Fetcher;
  ENTORNO?: string;
}
