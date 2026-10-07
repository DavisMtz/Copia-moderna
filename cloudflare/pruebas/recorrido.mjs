/*
 * Recorrido completo en Chromium: cada pantalla, con cada rol, como una persona de verdad.
 *   node pruebas/recorrido.mjs [baseUrl] [carpetaCapturas]
 * Entra por la pantalla real de login con maestro, supervisora y asesor, visita todas las pantallas
 * (y las públicas sin sesión), y deja:
 *   · <carpeta>/reporte.json — por rol y pantalla: errores de consola, excepciones, peticiones fallidas,
 *     llamadas al servidor que fallaron (con su mensaje) y lo que tardó cada llamada;
 *   · <carpeta>/<rol>-<pantalla>.png — una captura de cada una.
 * Sale con código 1 si hubo errores (excluye ruido conocido de terceros: fuentes, CDN, GCM).
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const SALIDA = process.argv[3] || './recorrido';
const ESPERA = Number(process.env.ESPERA || 2500);
const CLAVE = process.env.CLAVE || 'VentelDemo2026';
fs.mkdirSync(SALIDA, { recursive: true });

const TODAS = ['dashboard', 'inicio_avanzado', 'cotizacion', 'consulta_cotizacion', 'revision_cotizacion',
  'correoventel', 'correo_cliente', 'anuncios', 'portal_contenido', 'operacion', 'consola', 'atenciones',
  'articulo', 'portal', 'promociones', 'estado', 'datos'];
const ROLES = [
  { rol: 'maestro', correo: 'maestro@ventel.example', pantallas: TODAS.concat(['consola&sec=miembros', 'consola&sec=permisos', 'consola&sec=modulos', 'consola&sec=ajustes', 'consola&sec=formatos', 'consola&sec=salud', 'consola&sec=metricas', 'consola&sec=bitacora']) },
  { rol: 'supervisora', correo: 'supervisora@ventel.example', pantallas: TODAS },
  { rol: 'asesor', correo: 'asesor@ventel.example', pantallas: ['dashboard', 'cotizacion', 'consulta_cotizacion', 'correoventel', 'correo_cliente', 'atenciones', 'articulo', 'portal', 'promociones', 'estado'] }
];
const PUBLICAS = ['portal', 'promociones', 'estado', 'login', 'registro', 'recuperar'];
const RUIDO = /fonts\.(googleapis|gstatic)|mtalk\.google|favicon|ERR_ABORTED.*(cdnjs|jsdelivr)/i;

// Si la máquina sale a internet por un proxy, el navegador también (para recorrer producción).
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], proxy });
const reporte = { base: BASE, fecha: new Date().toISOString(), resultados: [] };

async function recorrer(rol, correo, pantallas) {
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
  const pagina = await contexto.newPage();
  let actual = null;
  const nuevo = (p) => ({ rol, pantalla: p, errores: [], rpc: [], ms: 0 });
  pagina.on('console', (m) => { if (actual && m.type() === 'error' && !RUIDO.test(m.text())) actual.errores.push('consola: ' + m.text().slice(0, 400)); });
  pagina.on('pageerror', (e) => { if (actual) actual.errores.push('excepción: ' + String(e.message || e).slice(0, 400)); });
  pagina.on('requestfailed', (r) => { if (actual && !RUIDO.test(r.url() + ' ' + ((r.failure() || {}).errorText || ''))) actual.errores.push('red: ' + r.url().slice(0, 160) + ' ' + ((r.failure() || {}).errorText || '')); });
  pagina.on('response', async (r) => {
    if (!actual || !r.url().endsWith('/api/rpc')) return;
    const registro = actual;
    try {
      const cuerpo = r.request().postDataJSON();
      const t = (r.request().timing() || {});
      const j = await r.json();
      const nombres = cuerpo.fn === 'secEjecutar' ? [cuerpo.args[1]] : cuerpo.fn === 'secEjecutarLote' ? cuerpo.args[1].map((x) => x[0]) : [cuerpo.fn];
      const st = r.headers()['server-timing'] || '';
      registro.rpc.push({ fn: nombres.join('+'), ok: !!j.ok, srv: Number((st.match(/app;dur=(\d+)/) || [])[1] || -1), ms: Math.round((t.responseEnd || 0)) });
      if (!j.ok) registro.errores.push('rpc ' + nombres.join('+') + ' → ' + j.e);
      else if (Array.isArray(j.v) && cuerpo.fn === 'secEjecutarLote') j.v.forEach((x, i) => { if (x && x.e) registro.errores.push('rpc ' + nombres[i] + ' → ' + x.e); });
    } catch { /* no JSON */ }
  });

  if (correo) {
    actual = nuevo('login');
    await pagina.goto(BASE + '/?page=login', { waitUntil: 'load' });
    await pagina.fill('#email', correo);
    await pagina.fill('#password', CLAVE);
    await Promise.all([
      pagina.waitForURL((u) => !/page=login/.test(String(u)), { timeout: 20000 }).catch(() => actual.errores.push('no salió del login')),
      pagina.click('#loginButton')
    ]);
    reporte.resultados.push(actual);
  }
  for (const p of pantallas) {
    actual = nuevo(p);
    const t0 = Date.now();
    try {
      await pagina.goto(BASE + '/?page=' + p, { waitUntil: 'load', timeout: 30000 });
      await pagina.waitForTimeout(ESPERA);
      actual.url = pagina.url().replace(BASE, '');
      if (correo && /page=login/.test(actual.url) && p !== 'login') actual.errores.push('mandó al login (¿sesión perdida o sin permiso?)');
      await pagina.screenshot({ path: path.join(SALIDA, rol + '-' + p.replace(/[^\w-]/g, '_') + '.png') });
    } catch (e) {
      actual.errores.push('navegación: ' + e.message.slice(0, 200));
    }
    actual.ms = Date.now() - t0;
    reporte.resultados.push(actual);
    process.stdout.write((actual.errores.length ? '✖' : '·'));
  }
  await contexto.close();
}

for (const r of ROLES) { process.stdout.write('\n' + r.rol.padEnd(12)); await recorrer(r.rol, r.correo, r.pantallas); }
process.stdout.write('\n' + 'sin sesión'.padEnd(12));
await recorrer('publico', null, PUBLICAS);
await navegador.close();

fs.writeFileSync(path.join(SALIDA, 'reporte.json'), JSON.stringify(reporte, null, 1));
const conError = reporte.resultados.filter((x) => x.errores.length);
const llamadas = reporte.resultados.flatMap((x) => x.rpc).filter((x) => x.srv >= 0);
const srv = llamadas.map((x) => x.srv).sort((a, b) => a - b);
console.log('\n\n' + reporte.resultados.length + ' visitas · ' + conError.length + ' con errores · ' + llamadas.length +
  ' llamadas (servidor p50 ' + (srv[Math.floor(srv.length / 2)] ?? '-') + ' ms, p90 ' + (srv[Math.floor(srv.length * 0.9)] ?? '-') + ' ms)');
for (const x of conError) {
  console.log('\n■ ' + x.rol + ' · ' + x.pantalla);
  [...new Set(x.errores)].slice(0, 12).forEach((e) => console.log('   ' + e));
}
process.exit(conError.length ? 1 : 0);
