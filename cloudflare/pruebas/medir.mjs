/*
 * Mide la maqueta COMO el doc 15 midió Apps Script, para que las dos columnas del doc 19 se puedan
 * comparar sin trampa:
 *   CLAVE=… node pruebas/medir.mjs [baseUrl] [correo] [cargas]
 *
 *   1. Llamada vacía (doc 15 §3.2): labNoop por google.script.run desde una pantalla abierta.
 *      Una en frío (se descarta, como allá) y 21 en serie → mediana y p25–p75.
 *   2. Ocho llamadas vacías en paralelo (doc 15 §3.3).
 *   3. Pantalla Portal (?page=portal) con sesión (doc 15 §2 y Fase 3a): la primera visita con el
 *      navegador vacío, y luego N cargas seguidas (30, como la Fase 3a) → mediana de primer byte,
 *      DOMContentLoaded, último dato y bytes recibidos.
 *
 * «Último dato» = cuando termina la última llamada al servidor que salió durante la carga, contado
 * desde que empezó la navegación (lo mismo que el doc 15 leía en la página de Google).
 * Deja el resultado en pruebas/medicion.json (o MEDICION=ruta).
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const CORREO = process.argv[3] || 'asesor@ventel.example';
const CARGAS = Number(process.argv[4] || 30);
const CLAVE = process.env.CLAVE || 'VentelDemo2026';
const SALIDA = process.env.MEDICION || new URL('./medicion.json', import.meta.url).pathname;

const ordenar = (xs) => xs.slice().sort((a, b) => a - b);
function cuantil(xs, q) {
  const o = ordenar(xs);
  if (!o.length) return null;
  const i = (o.length - 1) * q, a = Math.floor(i), b = Math.ceil(i);
  return Math.round(o[a] + (o[b] - o[a]) * (i - a));
}
const resumen = (xs) => ({ mediana: cuantil(xs, 0.5), p25: cuantil(xs, 0.25), p75: cuantil(xs, 0.75), min: cuantil(xs, 0), max: cuantil(xs, 1), n: xs.length });

// Si la máquina sale a internet por un proxy (como la del doc 15), el navegador también.
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], proxy });
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
const pagina = await contexto.newPage();
const resultado = { base: BASE, fecha: new Date().toISOString(), correo: CORREO };

// Dónde se midió: el punto de Cloudflare que atendió y dónde corre la API.
try {
  const r = await contexto.request.get(BASE + '/api/salud');
  const s = await r.json();
  resultado.salud = s;
  resultado.desde = { borde: s.borde || (r.headers()['cf-ray'] || '').split('-').pop(), api: s.api || s.colo || '', d1Ms: s.d1Ms };
} catch (e) { resultado.salud = { error: String(e) }; }

// ── Entrar por la pantalla real de login ──────────────────────────────────────────────────────────
await pagina.goto(BASE + '/?page=login', { waitUntil: 'load' });
await pagina.fill('#email', CORREO);
await pagina.fill('#password', CLAVE);
await Promise.all([
  pagina.waitForURL((u) => !/page=login/.test(String(u)), { timeout: 30000 }),
  pagina.click('#loginButton')
]);
await pagina.waitForLoadState('load');

// ── 3a. Primera visita al Portal (lo que trae la página tras el login ya cuenta como caché llena de
//        lo común; por eso la primera visita «de verdad» se mide en un contexto nuevo, más abajo) ──
async function medirCarga(p) {
  await p.goto(BASE + '/?page=portal', { waitUntil: 'load', timeout: 60000 });
  // Espera a que las llamadas de la carga terminen: el Portal las lanza DESPUÉS de `load` (como en Apps
  // Script), así que se esperan 2.5 s pasado `load` y luego 1.5 s sin llamadas nuevas (tope 20 s).
  await p.waitForFunction(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    if (!nav || !nav.loadEventEnd || performance.now() < nav.loadEventEnd + 2500) return false;
    const m = (window.__vxRed && window.__vxRed.medidas()) || [];
    const ultima = m.length ? m[m.length - 1].t : performance.timeOrigin;
    return Date.now() - ultima > 1500;
  }, null, { timeout: 20000, polling: 100 }).catch(() => {});
  return p.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const rec = performance.getEntriesByType('resource');
    const medidas = (window.__vxRed && window.__vxRed.medidas()) || [];
    const fin = medidas.map((x) => x.t - performance.timeOrigin).filter((x) => x > 0 && x < 20000);
    return {
      primerByte: Math.round(nav.responseStart),
      listo: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      ultimoDato: fin.length ? Math.round(Math.max(...fin)) : null,
      llamadas: medidas.length,
      llamadasMs: medidas.map((x) => x.ms),
      servidorMs: medidas.map((x) => x.srv).filter((x) => typeof x === 'number' && x >= 0),
      htmlKb: Math.round((nav.decodedBodySize || 0) / 102.4) / 10,
      htmlComprimidoKb: Math.round((nav.encodedBodySize || 0) / 102.4) / 10,
      transferidoKb: Math.round(((nav.transferSize || 0) + rec.reduce((s, r) => s + (r.transferSize || 0), 0)) / 102.4) / 10,
      recursos: rec.length
    };
  });
}

// ── 1. Llamada vacía ─────────────────────────────────────────────────────────────────────────────
await pagina.goto(BASE + '/?page=portal', { waitUntil: 'load' });
await pagina.waitForTimeout(2500);
resultado.llamadaVacia = await pagina.evaluate(async () => {
  const una = () => new Promise((ok, mal) => {
    const t0 = performance.now();
    google.script.run.withSuccessHandler(() => ok(performance.now() - t0)).withFailureHandler(mal).labNoop();
  });
  const frio = await una();
  const serie = [];
  for (let i = 0; i < 21; i++) serie.push(await una());
  const t0 = performance.now();
  const paralelo = await Promise.all(Array.from({ length: 8 }, una));
  return { frio: Math.round(frio), serie: serie.map(Math.round), paralelo: paralelo.map(Math.round), paraleloTotal: Math.round(performance.now() - t0) };
});
resultado.llamadaVacia.resumen = resumen(resultado.llamadaVacia.serie);

// ── 3b. N cargas seguidas del Portal con sesión (caché del navegador como la de un asesor) ────────
const cargas = [];
for (let i = 0; i < CARGAS; i++) {
  cargas.push(await medirCarga(pagina));
  process.stdout.write('·');
}
process.stdout.write('\n');
resultado.portal = {
  cargas,
  primerByte: resumen(cargas.map((c) => c.primerByte)),
  listo: resumen(cargas.map((c) => c.listo)),
  ultimoDato: resumen(cargas.map((c) => c.ultimoDato).filter((x) => x != null)),
  transferidoKb: resumen(cargas.map((c) => c.transferidoKb)),
  htmlKb: cargas[0] && cargas[0].htmlKb,
  htmlComprimidoKb: cargas[0] && cargas[0].htmlComprimidoKb,
  servidorMs: resumen(cargas.flatMap((c) => c.servidorMs))
};

// ── 3a. Primera visita: contexto nuevo (navegador vacío), con la sesión copiada ───────────────────
const estado = await contexto.storageState();
const limpio = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-MX', timezoneId: 'America/Mexico_City', storageState: estado });
resultado.primeraVisita = await medirCarga(await limpio.newPage());
await limpio.close();

await navegador.close();
fs.writeFileSync(SALIDA, JSON.stringify(resultado, null, 1));

const f = (r) => r ? r.mediana + ' ms (p25–p75 ' + r.p25 + '–' + r.p75 + ', n=' + r.n + ')' : '—';
console.log('Base: ' + BASE + ' · borde ' + (resultado.desde && resultado.desde.borde) + ' · API en ' + (resultado.desde && resultado.desde.api) + ' · D1 ' + (resultado.desde && resultado.desde.d1Ms) + ' ms');
console.log('Llamada vacía (labNoop): ' + f(resultado.llamadaVacia.resumen) + ' · en frío ' + resultado.llamadaVacia.frio + ' ms');
console.log('8 en paralelo: ' + resultado.llamadaVacia.paraleloTotal + ' ms en total');
console.log('Portal, primer byte: ' + f(resultado.portal.primerByte));
console.log('Portal, listo (DOMContentLoaded): ' + f(resultado.portal.listo));
console.log('Portal, último dato: ' + f(resultado.portal.ultimoDato));
console.log('Portal, transferido por visita: ' + (resultado.portal.transferidoKb && resultado.portal.transferidoKb.mediana) + ' KB · HTML ' + resultado.portal.htmlKb + ' KB (' + resultado.portal.htmlComprimidoKb + ' KB comprimido)');
console.log('Primera visita (navegador vacío): primer byte ' + resultado.primeraVisita.primerByte + ' ms · listo ' + resultado.primeraVisita.listo +
  ' ms · último dato ' + resultado.primeraVisita.ultimoDato + ' ms · ' + resultado.primeraVisita.transferidoKb + ' KB');
console.log('Servidor por llamada: ' + f(resultado.portal.servidorMs));
console.log('→ ' + SALIDA);
