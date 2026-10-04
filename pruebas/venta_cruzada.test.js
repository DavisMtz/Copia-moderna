/*
 * Pruebas del lado del Portal de «Vende más» (extensión de Chrome 2.6): las promociones del Monitor
 * que la portada deja en la página para la extensión.   Ejecutar:  node pruebas/venta_cruzada.test.js
 *
 * Dos mitades:
 *   A · Servidor. Se cargan Portal.gs y VentaCruzada.gs REALES. Lo que importa:
 *       - que la portada (portalContarPromos_) devuelva EXACTAMENTE lo mismo que antes de sacar
 *         portalVigentes_: se compara contra la versión anterior, copiada aquí tal cual;
 *       - que «la más fuerte» y los MSI se lean con la regla del Monitor (pctDe y la de las
 *         tarjetas, extraídas del app_monitor.html real), con su desempate por la primera;
 *       - que no se lea ninguna hoja si la caché del Monitor está caliente, y que nunca lance.
 *   B · Cliente. Se ejecuta el <script> real de app_venta_cruzada.html con un DOM y un AppRun
 *       falsos: dónde escribe, que la copia fresca evita el viaje, y que nada tumba la portada.
 *
 * Esta carpeta queda fuera de "Carpeta del proyecto": clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');
let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400) : ''));
}
function seccion(t) { console.log('\n' + t); }

/* ═════════════════════════════════════════════════════════════════════════════════════
   A · SERVIDOR
   ═════════════════════════════════════════════════════════════════════════════════════ */

const HOY = new Date(2026, 9, 4, 12, 0, 0).getTime();   // sábado 4 de octubre de 2026, mediodía
let cache = {};
let propsVC = {};
const cuentas = { hojas: 0 };

function contextoServidor() {
  const RelojDate = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(HOY); }
    static now() { return HOY; }
  };
  const cacheScript = {
    get: (k) => (k in cache ? cache[k] : null),
    getAll: (ks) => { const o = {}; ks.forEach((k) => { if (k in cache) o[k] = cache[k]; }); return o; },
    put: (k, v) => { cache[k] = String(v); },
    remove: (k) => { delete cache[k]; }
  };
  const ctx = {
    console, Math, JSON, String, Number, Object, Array, RegExp, Error, parseInt, parseFloat, isNaN,
    Date: RelojDate,
    Logger: { log: () => {} },
    CacheService: { getScriptCache: () => cacheScript },
    SpreadsheetApp: {
      openById: () => { cuentas.hojas++; throw new Error('prueba: no se deben abrir hojas'); },
      getActiveSpreadsheet: () => { cuentas.hojas++; throw new Error('prueba: no se deben abrir hojas'); }
    },
    CalendarApp: { getCalendarById: () => null },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    secConfig_: (k, d) => (k in propsVC ? propsVC[k] : d)
  };
  vm.createContext(ctx);
  ['Portal.gs', 'VentaCruzada.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(PROY, f), 'utf8'), ctx, { filename: f }));
  // La versión de portalContarPromos_ de ANTES de sacar portalVigentes_ (commit 269228b), tal cual.
  vm.runInContext(`function portalContarPromosAntes_(data) {
  const now = new Date();
  const DIA = 86400000;
  let activas = 0, porTerminar = 0;
  const vigentes = [];

  (data.promociones || []).forEach(function (p) {
    const r = parseVigencia_(p.vigencia, now);
    if (r && now >= r.start && now <= r.end) {
      activas++;
      if ((r.end - now) / DIA <= 3) porTerminar++;
      vigentes.push({
        direccion: String(p.direccion || '').trim(),
        categoria: String(p.categoria || '').trim(),
        promocion: String(p.promocion || '').trim(),
        marca:     String(p.marca || '').trim(),
        origen:    String(p.origen || ''),
        vigencia:  String(p.vigencia || ''),
        fin:       r.end.getTime(),
        dias:      Math.floor((r.end - now) / DIA)
      });
    }
  });
  vigentes.sort(function (a, b) { return a.fin - b.fin; });

  const desde = now.getTime() - DIA, hasta = now.getTime() + 28 * DIA;
  const eventos = (data.eventos || [])
    .filter(function (e) { return e && e.fin >= desde && e.inicio <= hasta; })
    .sort(function (a, b) { return a.inicio - b.inicio; })
    .slice(0, 10)
    .map(function (e) {
      return {
        titulo:      String(e.titulo || ''),
        inicio:      e.inicio,
        fin:         e.fin,
        esTodoElDia: !!e.esTodoElDia,
        descripcion: String(e.descripcion || '').slice(0, 240)
      };
    });

  return {
    status: 'ok', activas: activas, porTerminar: porTerminar,
    promociones: vigentes.slice(0, PROMO_PORTADA_TOPE),
    eventos: eventos
  };
}`, ctx);
  // Las dos reglas del Monitor, sacadas del archivo real.
  const monitor = fs.readFileSync(path.join(PROY, 'app_monitor.html'), 'utf8');
  const pct = monitor.match(/function pctDe\(t\) \{[^\n]*\}/);
  const msi = monitor.match(/var msi = (\(function \(t\) \{[^\n]*?\}\))\(p\.promocion\);/);
  ctx.__reglasMonitor = !!(pct && msi);
  if (pct) vm.runInContext(pct[0].replace('function pctDe', 'function monitorPct'), ctx);
  if (msi) vm.runInContext('var monitorMsi = ' + msi[1] + ';', ctx);
  return ctx;
}
const S = contextoServidor();

const P = (dir, cat, promo, vig, origen) => ({ origen: origen || 'Promociones', direccion: dir, categoria: cat, promocion: promo, marca: 'X', vigencia: vig, liga: '#' });
const APPDATA = {
  status: 'success', error: null, eventos: [{ titulo: 'LA NOCTURNA', inicio: HOY - 3600000, fin: HOY + 86400000, esTodoElDia: false, descripcion: 'x' }],
  promociones: [
    P('Mujer', 'Bolsas', 'Hasta 58% de descuento', '1 al 31 de octubre'),
    P('Hogar', 'Línea blanca', 'Hasta 55% de descuento + 13 MSI', '1 al 6 de octubre'),
    P('Mujer', 'Vestidos', 'Hasta 58% DTO', '3 al 12 de octubre'),
    P('Electrónica', 'Celulares', 'Hasta 20% y hasta 18 MSI', '1 al 20 de octubre'),
    P('Electrónica', 'Pantallas', 'SOBRETASA 9MSI CON 2.97%', '1 al 20 de octubre'),
    P('Deportes', 'Tenis', 'Hasta 70% de descuento', '1 al 3 de octubre'),
    P('Niños', 'Juguetes', 'Hasta 80% de descuento', '10 al 20 de octubre'),
    P('Hogar', 'Colchones', 'Precios especiales', '1 al 31 de octubre'),
    P('Belleza', 'Perfumes', '40% en marcas seleccionadas', '1 al 9 de octubre', 'Marketplace')
  ]
};

seccion('A1 · La portada no cambia: portalContarPromos_ igual que antes de sacar portalVigentes_');
{
  const conjuntos = [APPDATA, { promociones: [] }, { promociones: APPDATA.promociones.slice(0, 3), eventos: [] }, {}];
  conjuntos.forEach((d, i) => {
    const nuevo = JSON.stringify(S.portalContarPromos_(d));
    const antes = JSON.stringify(S.portalContarPromosAntes_(d));
    ok('conjunto ' + (i + 1) + ': respuesta idéntica', nuevo === antes, { nuevo: nuevo.slice(0, 200), antes: antes.slice(0, 200) });
  });
  const r = S.portalContarPromos_(APPDATA);
  ok('las cuentas siguen siendo las de siempre (7 vigentes, 1 por terminar)', r.activas === 7 && r.porTerminar === 1, r);
}

seccion('A2 · Las reglas del Monitor, sacadas de app_monitor.html');
ok('se encontraron pctDe y la regla de los MSI en el archivo real', S.__reglasMonitor === true);
const textos = ['Hasta 58% de descuento', 'SOBRETASA 9MSI CON 2.97%', '20%+15% adicional', '50 % y 6 MSI', 'Precios especiales',
  'Hasta 100% bonificación', '13 MSI', 'hasta 18 msi', 'Meses sin intereses (MSI)', '3msi y 10%', '', null, '2x1 en perfumes', '1,500% falso'];
textos.forEach((t) => {
  ok('porcentaje de «' + t + '» como el Monitor', S.vcPctDe_(t) === S.monitorPct(t), [S.vcPctDe_(t), S.monitorPct(t)]);
  ok('MSI de «' + t + '» como el Monitor', S.vcMsiDe_(t) === S.monitorMsi(t), [S.vcMsiDe_(t), S.monitorMsi(t)]);
});

seccion('A3 · El paquete para la extensión');
const ahora = new Date(HOY);
const paq = S.vcPaqueteDesde_(APPDATA, ahora);
ok('status ok, versión 1 y la hora de armado', paq.status === 'ok' && paq.v === 1 && paq.generado === HOY, paq);
ok('solo las vigentes hoy (7): ni la que terminó el 3 ni la que empieza el 10',
  paq.promos.length === 7 && !paq.promos.some((p) => p.c === 'Tenis' || p.c === 'Juguetes'), paq.promos.map((p) => p.c));
ok('la más fuerte: 58 % de Bolsas, la PRIMERA de las dos de 58 % (como el Monitor)',
  paq.fuerte && paq.fuerte.c === 'Bolsas' && paq.fuerte.p === 58, paq.fuerte);
ok('ordenadas de mayor a menor porcentaje, estables en el empate (los 0 % en el orden de la hoja)',
  JSON.stringify(paq.promos.map((p) => p.c)) === JSON.stringify(['Bolsas', 'Vestidos', 'Línea blanca', 'Perfumes', 'Celulares', 'Pantallas', 'Colchones']),
  paq.promos.map((p) => p.c + ' ' + p.p));
const linea = paq.promos.find((p) => p.c === 'Línea blanca');
ok('Línea blanca: 55 % y 13 MSI', linea && linea.p === 55 && linea.m === 13, linea);
const pantallas = paq.promos.find((p) => p.c === 'Pantallas');
ok('«SOBRETASA 9MSI CON 2.97%» no se lee como un 97 %', pantallas && pantallas.p === 0 && pantallas.m === 9, pantallas);
ok('Marketplace se marca', paq.promos.find((p) => p.c === 'Perfumes').k === 'mkp');
ok('el fin viaja en milisegundos (fin del día 6 para Línea blanca)', linea && linea.f === new Date(2026, 9, 6, 23, 59, 59).getTime(), linea && linea.f);
{
  const largo = { promociones: [P('Hogar', 'Sábanas', 'x'.repeat(500) + ' 30%', '1 al 31 de octubre')] };
  const r = S.vcPaqueteDesde_(largo, ahora);
  ok('un texto pegado de 500 caracteres se recorta a 140', r.promos[0].t.length <= 140 && /…$/.test(r.promos[0].t), r.promos[0].t.length);
}
{
  const sinPct = { promociones: [P('Hogar', 'Colchones', 'Precios especiales', '1 al 31 de octubre')] };
  ok('sin porcentajes no hay «más fuerte»', S.vcPaqueteDesde_(sinPct, ahora).fuerte === null);
}
{
  const muchas = { promociones: [] };
  const deps = ['Mujer', 'Hombre', 'Hogar', 'Electrónica', 'Belleza', 'Deportes', 'Niños'];
  for (let i = 0; i < 300; i++) {
    muchas.promociones.push(P(deps[i % deps.length], 'Categoría número ' + i, 'Hasta ' + (10 + (i % 60)) + '% de descuento en artículos seleccionados y hasta 12 MSI con tarjetas participantes', '1 al 31 de octubre', i % 5 ? 'Promociones' : 'Marketplace'));
  }
  const r = S.vcPaqueteDesde_(muchas, ahora);
  const tam = JSON.stringify(r).length;
  ok('tope de 120 promociones', r.promos.length === 120, r.promos.length);
  ok('las 120 que viajan son las de mayor porcentaje', r.promos[119].p >= Math.max(...r.promos.map((p) => p.p)) - 59 && r.promos[0].p === 69, [r.promos[0].p, r.promos[119].p]);
  ok('pesa menos de 25 KB aun con textos largos (' + Math.round(tam / 1024) + ' KB)', tam < 25000, tam);
}

seccion('A3b · El interruptor de la búsqueda en vivo de la extensión (VC_BUSQUEDA_EN_VIVO)');
{
  propsVC = {};
  ok('por omisión, la búsqueda va encendida', S.vcPaqueteDesde_(APPDATA, ahora).ajustes.busqueda === true);
  propsVC = { VC_BUSQUEDA_EN_VIVO: 'no' };
  ok('con la propiedad en «no», el paquete la apaga', S.vcPaqueteDesde_(APPDATA, ahora).ajustes.busqueda === false);
  propsVC = { VC_BUSQUEDA_EN_VIVO: ' NO ' };
  ok('sin importar mayúsculas ni espacios', S.vcPaqueteDesde_(APPDATA, ahora).ajustes.busqueda === false);
  propsVC = { VC_BUSQUEDA_EN_VIVO: 'si' };
  ok('cualquier otra cosa la deja encendida', S.vcPaqueteDesde_(APPDATA, ahora).ajustes.busqueda === true);
  propsVC = {};
}

seccion('A4 · ventaCruzadaPromos: de la caché del Monitor, sin abrir hojas, sin lanzar');
cache = { appData_v1: JSON.stringify(APPDATA) };
cuentas.hojas = 0;
{
  const r = S.ventaCruzadaPromos();
  ok('con la caché caliente devuelve el paquete', r.status === 'ok' && r.fuerte && r.fuerte.p === 58, r);
  ok('y no abre ninguna hoja', cuentas.hojas === 0, cuentas);
}
cache = {};
{
  let error = null, r = null;
  try { r = S.ventaCruzadaPromos(); } catch (e) { error = e.message; }
  ok('con la caché vacía y la hoja caída no lanza', !error, error);
  ok('…y dice que no pudo, sin datos inventados', r && r.status === 'error' && !r.promos, r);
}

/* ═════════════════════════════════════════════════════════════════════════════════════
   B · CLIENTE (app_venta_cruzada.html)
   ═════════════════════════════════════════════════════════════════════════════════════ */

const html = fs.readFileSync(path.join(PROY, 'app_venta_cruzada.html'), 'utf8');
const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
ok('el parcial trae un solo bloque de script', bloques.length === 1, bloques.length);

function documento() {
  const elementos = {};
  const head = { hijos: [], appendChild(el) { this.hijos.push(el); elementos[el.id] = el; } };
  return {
    head, documentElement: head,
    getElementById: (id) => elementos[id] || null,
    createElement: (tag) => ({ tagName: tag, id: '', type: '', textContent: '' })
  };
}

function cliente(opciones) {
  opciones = opciones || {};
  const propio = documento(), arriba = documento();
  const llamadas = [];
  const guardado = {};
  const ventana = {
    document: propio,
    AppCache: {
      get: (k, max) => (opciones.copia && opciones.copia.k === k && max === 30 * 60 * 1000 ? opciones.copia.v : null),
      set: (k, v, o) => { guardado[k] = { v, o }; }
    },
    AppRun: {
      call: (fn, args, o) => {
        llamadas.push({ fn, args, o });
        return opciones.falla ? Promise.reject(new Error('sin red')) : Promise.resolve(opciones.respuesta);
      }
    }
  };
  if (opciones.otroOrigen) {
    Object.defineProperty(ventana, 'parent', { get: () => ({ get document() { throw new Error('SecurityError'); } }) });
  } else {
    ventana.parent = { document: arriba };
  }
  ventana.window = ventana;
  const ctx = Object.assign(ventana, {
    console, JSON, Array, Promise, Object, String,
    google: opciones.sinGoogle ? undefined : { script: { run: {} } }
  });
  vm.createContext(ctx);
  vm.runInContext(bloques[0], ctx, { filename: 'app_venta_cruzada.html' });
  return { ctx, propio, arriba, llamadas, guardado };
}

const RESP = { status: 'ok', v: 1, generado: HOY, fuerte: { d: 'Mujer', c: 'Bolsas', t: 'Hasta 58% </script><script>alert(1)', p: 58, m: 0, f: HOY + 1 }, promos: [{ d: 'Mujer', c: 'Bolsas', t: 'Hasta 58%', p: 58, m: 0, f: HOY + 1 }] };
const esperar = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  seccion('B1 · Publicar');
  {
    const c = cliente();
    ok('expone VentaCruzadaExtension.pedir y .publicar', c.ctx.VentaCruzadaExtension && typeof c.ctx.VentaCruzadaExtension.pedir === 'function');
    const hecho = c.ctx.VentaCruzadaExtension.publicar(RESP);
    const el = c.propio.getElementById('ventel-promos-datos');
    const elArriba = c.arriba.getElementById('ventel-promos-datos');
    ok('escribe en esta página y en la de arriba', hecho === true && el && elArriba, { el: !!el, arriba: !!elArriba });
    ok('como script de datos (application/json), que nunca se ejecuta', el && el.tagName === 'script' && el.type === 'application/json');
    const leido = el && JSON.parse(el.textContent);
    ok('el JSON se lee igual, con el texto de la hoja intacto', leido && leido.fuerte.t === RESP.fuerte.t && leido.promos.length === 1 && leido.v === 1, leido);
    ok('solo viaja lo que la extensión usa (sin status)', leido && !('status' in leido));
    const conAjustes = Object.assign({}, RESP, { ajustes: { busqueda: false } });
    c.ctx.VentaCruzadaExtension.publicar(conAjustes);
    ok('los ajustes del Portal viajan con el paquete', JSON.parse(c.propio.getElementById('ventel-promos-datos').textContent).ajustes.busqueda === false);
    ok('una respuesta de error no se publica', c.ctx.VentaCruzadaExtension.publicar({ status: 'error' }) === false);
  }
  {
    const c = cliente({ otroOrigen: true });
    let error = null;
    try { c.ctx.VentaCruzadaExtension.publicar(RESP); } catch (e) { error = e.message; }
    ok('si la página de arriba es de otro origen, escribe solo en la suya y no lanza', !error && !!c.propio.getElementById('ventel-promos-datos'), error);
  }

  seccion('B2 · Caché primero');
  {
    const c = cliente({ copia: { k: 'vc-promos-v1', v: { data: RESP, at: HOY } }, respuesta: RESP });
    c.ctx.VentaCruzadaExtension.pedir(false);
    await esperar();
    ok('con copia de menos de 30 min no pregunta al servidor', c.llamadas.length === 0, c.llamadas);
    ok('…y publica la copia', !!c.propio.getElementById('ventel-promos-datos'));
  }
  {
    const c = cliente({ respuesta: RESP });
    c.ctx.VentaCruzadaExtension.pedir(false);
    await esperar();
    ok('sin copia pregunta UNA vez a ventaCruzadaPromos, sin indicador de espera',
      c.llamadas.length === 1 && c.llamadas[0].fn === 'ventaCruzadaPromos' && c.llamadas[0].o.busy === false, c.llamadas);
    ok('guarda la respuesta 30 min', c.guardado['vc-promos-v1'] && c.guardado['vc-promos-v1'].o.ttl === 30 * 60 * 1000, c.guardado);
    ok('y la publica', !!c.propio.getElementById('ventel-promos-datos'));
  }
  {
    const c = cliente({ copia: { k: 'vc-promos-v1', v: { data: RESP, at: HOY } }, respuesta: RESP });
    c.ctx.VentaCruzadaExtension.pedir(true);
    await esperar();
    ok('«Actualizar» (fuerza) pregunta aunque haya copia', c.llamadas.length === 1, c.llamadas.length);
  }
  {
    const c = cliente({ respuesta: { status: 'error', error: 'x' } });
    c.ctx.VentaCruzadaExtension.pedir(false);
    await esperar();
    ok('un error del servidor no se guarda ni se publica', !c.guardado['vc-promos-v1'] && !c.propio.getElementById('ventel-promos-datos'));
  }
  {
    const c = cliente({ falla: true });
    let error = null;
    try { c.ctx.VentaCruzadaExtension.pedir(false); await esperar(); } catch (e) { error = e.message; }
    ok('sin red no lanza', !error, error);
  }
  {
    const c = cliente({ sinGoogle: true, respuesta: RESP });
    c.ctx.VentaCruzadaExtension.pedir(false);
    await esperar();
    ok('fuera de Apps Script (vista de diseño) no intenta llamar', c.llamadas.length === 0);
  }

  seccion('B3 · La portada lo pide');
  const index = fs.readFileSync(path.join(PROY, 'Index.html'), 'utf8');
  ok('Index incluye el parcial después de app_core',
    index.indexOf("include('app_venta_cruzada')") > index.indexOf("include('app_core')") && index.indexOf("include('app_venta_cruzada')") > -1);
  ok('requestData lo pide con la misma «fuerza» que el resto', /VentaCruzadaExtension\.pedir\(manual === true\)/.test(index));

  console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
  process.exit(fallos ? 1 : 0);
})();
