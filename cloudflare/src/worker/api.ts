/**
 * =================================================================================================
 * Portal Ventel en Cloudflare · la API (lo que en Apps Script era google.script.run)
 * =================================================================================================
 *   POST /api/rpc    → el canal secEjecutar / secEjecutarLote (rpc.ts)
 *   GET  /api/salud  → ¿está vivo?, con lo que tarda D1 desde DONDE corre esta API
 *
 * En producción esto es un Worker APARTE (wrangler.api.jsonc) ubicado junto a la base D1 (placement),
 * al que el Worker del borde (index.ts) le pasa las llamadas por un Service Binding. Así:
 *   · las pantallas salen del punto de Cloudflare más cercano a la persona (decenas de ms), y
 *   · cada consulta a D1 cuesta un par de milisegundos en vez de una ida y vuelta de continente:
 *     una llamada que hace diez consultas tarda ~20 ms de servidor, no ~700.
 * En local (wrangler dev con wrangler.jsonc) no hay Service Binding y el mismo Worker lo hace todo.
 */
import type { Env } from './tipos';
import { Ctx } from './nucleo/contexto';
import { despachar } from './rpc';
import { CONSTRUIDO } from './generado/rutas';

/**
 * El origen para los enlaces que salen de la API (botones de los correos, URLs de archivos). No se toma
 * a ciegas de la cabecera Origin: quien llame sin navegador puede poner ahí cualquier dominio, y acabaría
 * en el botón de un correo legítimo enviado desde logidma.com (envenenamiento del host, p. ej. con
 * «recuperar contraseña»). En producción es siempre el de la URL; en local se acepta el Origin solo si es
 * de esta máquina (wrangler dev puede reescribir la URL al dominio de producción).
 */
function origenConfiable(req: Request, url: URL, env: Env): string {
  const o = req.headers.get('origin') || '';
  if (env.ENTORNO !== 'produccion' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o;
  return url.origin;
}

async function rpc(req: Request, env: Env, exec: ExecutionContext, url: URL): Promise<Response> {
  const t0 = Date.now();
  let cuerpo: any;
  try { cuerpo = await req.json(); } catch {
    return Response.json({ ok: false, e: 'Petición no válida.' }, { status: 400 });
  }
  const fn = String((cuerpo && cuerpo.fn) || '');
  const args = Array.isArray(cuerpo && cuerpo.args) ? cuerpo.args : [];
  const ctx = new Ctx(env, exec, origenConfiable(req, url, env));
  ctx.ip = req.headers.get('cf-connecting-ip') || '';
  let salida: { ok: true; v: unknown } | { ok: false; e: string };
  try {
    const v = await despachar(ctx, fn, args);
    salida = { ok: true, v: v === undefined ? null : v };
  } catch (err: any) {
    const mensaje = String((err && err.message) || err || 'Error desconocido.');
    if (!/^SESION_EXPIRADA/.test(mensaje)) console.error('[rpc] ' + fn + (fn === 'secEjecutar' ? ' → ' + args[1] : '') + ': ' + mensaje);
    salida = { ok: false, e: mensaje };
  }
  const cf = (req as any).cf || {};
  return new Response(JSON.stringify(salida), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'server-timing': 'app;dur=' + (Date.now() - t0) + ', d1;desc="consultas";dur=' + ctx.consultas,
      'x-vx-api': String(cf.colo || '')
    }
  });
}

async function salud(env: Env, req: Request): Promise<Response> {
  const cf = (req as any).cf || {};
  // Tres lecturas seguidas: la primera puede pagar la conexión; la mediana es lo que cuesta de verdad.
  const tiempos: number[] = [];
  let d1 = true;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    try { await env.DB.prepare('SELECT 1').first(); } catch { d1 = false; }
    tiempos.push(Date.now() - t0);
  }
  tiempos.sort((a, b) => a - b);
  return Response.json({
    ok: d1, d1, d1Ms: tiempos[1], colo: cf.colo || '', ciudad: cf.city || '',
    entorno: env.ENTORNO || 'local', construido: CONSTRUIDO
  }, { headers: { 'cache-control': 'no-store' } });
}

/** Atiende /api/*; null si la ruta no es de la API. */
export async function manejarApi(req: Request, env: Env, exec: ExecutionContext): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.pathname === '/api/rpc') {
    if (req.method !== 'POST') return new Response('Usa POST', { status: 405 });
    return rpc(req, env, exec, url);
  }
  if (url.pathname === '/api/salud') return salud(env, req);
  return null;
}

/** El Worker de API en producción (wrangler.api.jsonc). Solo contesta lo que viene del borde. */
export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    try {
      return (await manejarApi(req, env, exec)) || new Response('No encontrado', { status: 404 });
    } catch (err) {
      console.error('[api]', err);
      return Response.json({ ok: false, e: 'Error interno.' }, { status: 500 });
    }
  }
} satisfies ExportedHandler<Env>;
