/**
 * =================================================================================================
 * Portal Ventel en Cloudflare · el Worker del borde (lo que en Apps Script era doGet)
 * =================================================================================================
 *   GET  /?page=…          → la pantalla (igual que /exec?page=…). Cualquier página desconocida cae
 *                            al Portal, como en servirPagina_ (Code.gs).
 *   GET  /exec?page=…      → lo mismo, para que un enlace viejo pegado a mano siga funcionando.
 *   /api/*                 → la API (api.ts). En producción va por el Service Binding `API` al Worker
 *                            que corre junto a la base D1; en local lo atiende este mismo Worker.
 *   GET  /archivos/<clave> → imágenes y evidencias subidas (R2).
 *
 * Las pantallas son archivos estáticos generados por scripts/construir.mjs a partir de «Carpeta del
 * proyecto». Al servirlas se les inyecta window.__VX_APP_JSON__ (lo que en Apps Script era APP_JSON:
 * URL base + parámetros de vista + el interruptor `reco`) con HTMLRewriter, en streaming.
 */
import type { Env } from './tipos';
import { Ctx } from './nucleo/contexto';
import { manejarApi } from './api';
import { servirArchivo } from './nucleo/archivos';
import { leerPropiedad } from './nucleo/sistema';
import { PAGINAS, PAGINAS_PORTAL, PARAMS_VISTA, RECO_PANTALLAS } from './generado/rutas';

const CABECERAS_SEGURIDAD: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin'
};

/** Mismo escapado que appEstadoInicialJson_ (Code.gs): JSON seguro dentro de <script>. */
function jsonParaScript(valor: unknown): string {
  return JSON.stringify(valor)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/* El interruptor del reconocimiento (RECO_VISIBLE) se lee en cada pantalla que lo enseña. Se guarda
   30 s en memoria del isolate: así una visita no paga una consulta, y un cambio se ve en segundos. */
let recoMemo: { valor: boolean; hasta: number } | null = null;
async function recoVisible(env: Env): Promise<boolean> {
  if (recoMemo && recoMemo.hasta > Date.now()) return recoMemo.valor;
  let valor = true;
  try {
    const ctx = new Ctx(env, null, '');
    valor = (await leerPropiedad(ctx, 'RECO_VISIBLE')) !== 'no';
  } catch { valor = true; }
  recoMemo = { valor, hasta: Date.now() + 30000 };
  return valor;
}

function paginaDeError(): Response {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Error · Sistema Ventel</title>' +
    '<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:520px;margin:12vh auto;padding:32px;' +
    'border:1px solid #eadfe6;border-radius:16px;color:#3d2b36;line-height:1.6">' +
    '<h1 style="color:#E10098;font-size:20px;margin:0 0 12px">No pudimos abrir esta pantalla</h1>' +
    '<p style="margin:0 0 16px">Vuelve a intentarlo en un momento. Si sigue igual, avisa al equipo del sistema ' +
    'con la hora exacta y qué estabas haciendo.</p>' +
    '<p style="margin:0;font-size:12px;color:#8a7480">Si necesitas ayuda, escribe al equipo de Ventel.</p></div>',
    { status: 500, headers: { 'content-type': 'text/html; charset=utf-8', ...CABECERAS_SEGURIDAD } });
}

/** servirPagina_ (Code.gs): la pantalla que toca según ?page=, con su APP_JSON. */
async function servirPantalla(req: Request, env: Env, url: URL): Promise<Response> {
  const page = url.searchParams.get('page') || 'portal';

  // Pantalla NUEVA de esta versión (no existe en Apps Script): el explorador de la base D1, una app
  // React (src/react) que se construye en public/vx/app/datos.html. Solo la ve un maestro: la puerta
  // está en cada llamada de modulos/nuevas.ts, no aquí.
  if (page === 'datos') {
    const app = await env.ASSETS.fetch(new Request(new URL('/vx/app/datos.html', url.origin)));
    if (app.ok) {
      return new Response(app.body, { status: 200, headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-cache', ...CABECERAS_SEGURIDAD } });
    }
  }

  const conf = PAGINAS_PORTAL[page] || PAGINAS[page] || PAGINAS_PORTAL['portal'];

  const asset = await env.ASSETS.fetch(new Request(new URL('/pantallas/' + conf.archivo + '.html', url.origin)));
  if (!asset.ok) return paginaDeError();

  const estado: Record<string, unknown> = {};
  if (RECO_PANTALLAS.indexOf(conf.archivo) !== -1) estado.reco = await recoVisible(env);
  estado.baseUrl = url.origin + '/';
  for (const n of PARAMS_VISTA) estado[n] = url.searchParams.get(n) || '';

  const inyeccion = '<script>window.__VX_APP_JSON__=' + jsonParaScript(estado) + ';</script>';
  const cabeceras = new Headers({
    'content-type': 'text/html; charset=utf-8',
    // La página lleva los parámetros de ESTA URL dentro: ninguna caché compartida debe guardarla.
    'cache-control': 'private, no-cache',
    ...CABECERAS_SEGURIDAD
  });
  const respuesta = new Response(asset.body, { status: 200, headers: cabeceras });
  return new HTMLRewriter()
    .on('head', { element(e) { e.prepend(inyeccion, { html: true }); } })
    .transform(respuesta);
}

/**
 * /api/*: al Worker de API por el Service Binding (producción) o aquí mismo (local). A /api/salud se
 * le añade el punto del borde que atendió, para que el panel de velocidad enseñe el camino completo:
 * borde (cerca de la persona) → API (junto a la base) → D1.
 */
async function api(req: Request, env: Env, exec: ExecutionContext, url: URL): Promise<Response> {
  const borde = String(((req as any).cf || {}).colo || '');
  const respuesta = env.API ? await env.API.fetch(req) : await manejarApi(req, env, exec);
  if (!respuesta) return Response.json({ ok: false, e: 'No encontrado.' }, { status: 404 });
  if (url.pathname === '/api/salud' && respuesta.ok) {
    const datos: any = await respuesta.json();
    return Response.json({ ...datos, borde, api: datos.colo, separado: !!env.API }, { headers: { 'cache-control': 'no-store' } });
  }
  const h = new Headers(respuesta.headers);
  h.set('x-vx-borde', borde);
  return new Response(respuesta.body, { status: respuesta.status, headers: h });
}

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, env, exec, url);
      if (url.pathname.startsWith('/archivos/')) {
        return await servirArchivo(env.ARCHIVOS, decodeURIComponent(url.pathname.slice('/archivos/'.length)));
      }
      if (url.pathname === '/' || url.pathname === '/exec' || url.pathname === '/index.html') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Método no permitido', { status: 405 });
        return await servirPantalla(req, env, url);
      }
      return env.ASSETS.fetch(req);
    } catch (err) {
      console.error('[fetch]', err);
      return url.pathname.startsWith('/api/')
        ? Response.json({ ok: false, e: 'Error interno.' }, { status: 500 })
        : paginaDeError();
    }
  }
} satisfies ExportedHandler<Env>;
