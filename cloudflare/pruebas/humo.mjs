/*
 * Prueba de humo en Chromium: entra al Portal en Cloudflare como una persona de verdad.
 *   node pruebas/humo.mjs [baseUrl] [correo] [contraseña]
 * Abre el inicio de sesión, entra, y recorre las pantallas con sesión apuntando errores de consola,
 * peticiones fallidas y llamadas al servidor que fallaron (google.script.run → /api/rpc).
 */
import { chromium } from 'playwright-core';

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const CORREO = process.argv[3] || 'maestro@ventel.example';
const CLAVE = process.argv[4] || 'VentelDemo2026';
const PANTALLAS = (process.env.PANTALLAS || 'dashboard,inicio_avanzado,cotizacion,consulta_cotizacion,revision_cotizacion,correoventel,correo_cliente,anuncios,portal_contenido,operacion,consola,atenciones,articulo,portal,promociones,estado').split(',');

const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
const pagina = await contexto.newPage();

let actual = 'login';
const problemas = [];
pagina.on('console', (m) => { if (m.type() === 'error') problemas.push([actual, 'consola', m.text().slice(0, 300)]); });
pagina.on('pageerror', (e) => problemas.push([actual, 'excepción', String(e.message || e).slice(0, 300)]));
pagina.on('requestfailed', (r) => { if (!/fonts|cdnjs|jsdelivr|gstatic/.test(r.url())) problemas.push([actual, 'red', r.url().slice(0, 160) + ' ' + (r.failure() || {}).errorText]); });
pagina.on('response', async (r) => {
  if (!r.url().endsWith('/api/rpc')) return;
  try {
    const cuerpo = r.request().postDataJSON();
    const j = await r.json();
    const nombre = cuerpo.fn === 'secEjecutar' ? cuerpo.args[1] : cuerpo.fn === 'secEjecutarLote' ? 'lote:' + cuerpo.args[1].map((x) => x[0]).join('+') : cuerpo.fn;
    if (!j.ok) problemas.push([actual, 'rpc', nombre + ' → ' + j.e]);
    else if (Array.isArray(j.v)) j.v.forEach((x, i) => { if (x && x.e) problemas.push([actual, 'rpc', cuerpo.args[1][i][0] + ' → ' + x.e]); });
  } catch { /* respuesta no JSON */ }
});

const t0 = Date.now();
await pagina.goto(BASE + '/?page=login', { waitUntil: 'load' });
console.log('login cargado en ' + (Date.now() - t0) + ' ms');
await pagina.fill('#email', CORREO);
await pagina.fill('#password', CLAVE);
const t1 = Date.now();
await Promise.all([
  pagina.waitForURL((u) => !/page=login/.test(String(u)), { timeout: 20000 }).catch(() => {}),
  pagina.click('#loginButton')
]);
console.log('tras entrar → ' + pagina.url() + ' (' + (Date.now() - t1) + ' ms)');

for (const p of PANTALLAS) {
  actual = p;
  const t = Date.now();
  await pagina.goto(BASE + '/?page=' + p, { waitUntil: 'load' }).catch((e) => problemas.push([p, 'navegación', e.message]));
  await pagina.waitForTimeout(Number(process.env.ESPERA || 2500));
  console.log(p.padEnd(22) + String(Date.now() - t).padStart(6) + ' ms  → ' + pagina.url().replace(BASE, ''));
}

await navegador.close();
const porPantalla = {};
for (const [p, tipo, txt] of problemas) (porPantalla[p] = porPantalla[p] || []).push(tipo + ': ' + txt);
console.log('\n' + problemas.length + ' problemas');
for (const [p, lista] of Object.entries(porPantalla)) {
  console.log('\n■ ' + p);
  [...new Set(lista)].slice(0, 25).forEach((x) => console.log('   ' + x));
}
