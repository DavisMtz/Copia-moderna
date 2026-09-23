/*
 * Pruebas de las promociones automáticas (PromosAuto.gs).   Ejecutar:  node pruebas/promos_auto.test.js
 *
 * Se cargan los archivos REALES —Portal.gs (parseVigencia_), PortalContenido.gs (el plan de
 * importación), PortalPromosComercial.gs (el intérprete) y PromosAuto.gs— en un contexto con
 * stubs, y una hoja del Portal simulada en memoria. Así se comprueban las tres cosas que importan
 * sin tocar la hoja de verdad: qué entra, qué se borra y que una segunda corrida no duplica.
 *
 * Esta carpeta queda fuera de "Carpeta del proyecto", así que clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RAIZ = path.join(__dirname, '..', 'Carpeta del proyecto');
let fallos = 0, total = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) console.log('  ✔ ' + nombre);
  else { fallos++; console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* ── Hoja simulada ─────────────────────────────────────────────────────── */
function hoja(filas) {
  const d = filas.map((f) => f.slice());
  const ancho = () => Math.max(...d.map((f) => f.length), 1);
  const norm = () => { const w = ancho(); d.forEach((f) => { while (f.length < w) f.push(''); }); };
  return {
    datos: d,
    getLastRow: () => { for (let i = d.length - 1; i >= 0; i--) if (d[i].some((v) => String(v).trim() !== '')) return i + 1; return 0; },
    getLastColumn: () => ancho(),
    getMaxColumns: () => ancho(),
    insertColumnsAfter: () => {},
    deleteRows: (ini, n) => { d.splice(ini - 1, n); },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => { norm(); const out = []; for (let i = 0; i < nr; i++) { const f = []; for (let j = 0; j < nc; j++) f.push((d[r - 1 + i] || [])[c - 1 + j] ?? ''); out.push(f); } return out; },
      getValue: () => (d[r - 1] || [])[c - 1] ?? '',
      setValues: (v) => { v.forEach((f, i) => { while (d.length < r + i) d.push([]); f.forEach((x, j) => { d[r - 1 + i][c - 1 + j] = x; }); }); norm(); },
      setValue: (x) => { while (d.length < r) d.push([]); d[r - 1][c - 1] = x; norm(); return { setFontWeight: () => {} }; }
    })
  };
}

function contexto(hojas) {
  const ctx = {
    console, Math, JSON, String, Number, Object, Array, Date, RegExp, parseInt, parseFloat, isNaN,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'America/Mexico_City' },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 16) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
    CacheService: { getScriptCache: () => ({ remove: () => {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) }
  };
  vm.createContext(ctx);
  ['Seguridad.gs', 'Portal.gs', 'PortalContenido.gs', 'PortalPromosComercial.gs', 'PromosAuto.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f });
  });
  ctx.portalSS_ = () => ({ getSheetByName: (n) => hojas[n] || null });
  ctx.pcApuntar_ = () => {};
  return ctx;
}

const HDR = ['Dirección', 'Banner / Carrusel', 'Promoción 2026', 'Marca', 'Vigencia', 'Liga', 'ID'];
const HDR_MKP = ['Dirección', 'Banner / Carrusel', 'Promoción mktplace', 'Promoción', 'Vigencia', 'Liga', 'ID'];

/* ── 1 · Reglas puras ──────────────────────────────────────────────────── */
console.log('\n1 · Ventana de fechas y cambio de año');
{
  const C = contexto({});
  const hoy = new Date(2026, 8, 23, 9, 0, 0);          // 23 sep 2026
  const r = (t) => C.promosAutoRango_(t, hoy);

  ok('vigente hoy entra', C.promosAutoEntra_(r('20 al 30 de septiembre'), hoy, 30));
  ok('termina HOY entra', C.promosAutoEntra_(r('1 al 23 de septiembre'), hoy, 30));
  ok('terminó ayer NO entra', !C.promosAutoEntra_(r('1 al 22 de septiembre'), hoy, 30));
  ok('arranca en 20 días entra', C.promosAutoEntra_(r('13 al 20 de octubre'), hoy, 30));
  ok('arranca en el día 30 entra', C.promosAutoEntra_(r('23 al 30 de octubre'), hoy, 30));
  ok('arranca en 40 días NO entra', !C.promosAutoEntra_(r('2 al 9 de noviembre'), hoy, 30));

  ok('terminó hace 31 días se borra', C.promosAutoVieja_(r('1 al 23 de agosto'), hoy, 30));
  ok('terminó hace 30 días NO se borra', !C.promosAutoVieja_(r('1 al 24 de agosto'), hoy, 30));
  ok('terminó hace 10 días NO se borra', !C.promosAutoVieja_(r('1 al 13 de septiembre'), hoy, 30));
  ok('vigencia ilegible no se juzga', r('por definir') === null && !C.promosAutoVieja_(null, hoy, 30));

  const dic = new Date(2026, 11, 20);
  const ene = C.promosAutoRango_('5 al 12 de enero', dic);
  ok('en diciembre, «5 al 12 de enero» es del año que viene', ene.start.getFullYear() === 2027, ene.start);
  ok('…y entra en la ventana', C.promosAutoEntra_(ene, dic, 30));
  ok('…y NO se borra', !C.promosAutoVieja_(ene, dic, 30));

  const enero = new Date(2027, 0, 10);
  const dicAnt = C.promosAutoRango_('1 al 20 de diciembre', enero);
  ok('en enero, «1 al 20 de diciembre» es del año pasado', dicAnt.end.getFullYear() === 2026, dicAnt.end);

  ok('texto de rango del mismo mes', C.promosAutoTextoRango_({ start: new Date(2026, 7, 10), end: new Date(2026, 7, 17) }) === '10 al 17 de agosto');
  ok('texto de rango entre meses', C.promosAutoTextoRango_({ start: new Date(2026, 6, 24), end: new Date(2026, 7, 9) }) === '24 de julio al 9 de agosto');
  const ida = C.promosAutoRango_('24 de julio al 9 de agosto', new Date(2026, 7, 1));
  ok('ese texto lo vuelve a leer el parser del monitor', ida && ida.start.getMonth() === 6 && ida.end.getDate() === 9);

  const filas = [{ direccion: 'Mujer', categoria: 'Bolsas', vigencia: '' },
                 { direccion: 'Hombre', categoria: 'Tenis', vigencia: 'sin fecha' }];
  const f = C.promosAutoFiltrar_(filas, { start: new Date(2026, 8, 20), end: new Date(2026, 8, 30, 23, 59, 59) }, hoy, 30);
  ok('sin vigencia en la fila, se toma la de la pestaña', f.entran.length === 2 && filas[0].vigencia === '20 al 30 de septiembre', filas);
  const g = C.promosAutoFiltrar_([{ direccion: 'x', categoria: 'y', vigencia: '' }], null, hoy, 30);
  ok('sin vigencia y sin pestaña fechable, no entra', g.entran.length === 0 && g.sinFecha === 1);
}

/* ── 2 · Aplicar sobre la hoja del Portal ──────────────────────────────── */
console.log('\n2 · Altas, convivencia, limpieza e idempotencia');
{
  const hoy = new Date(2026, 8, 23, 9, 0, 0);
  const H = hoja([
    HDR,
    ['Mujer', 'Bolsas', '30% vieja', 'Coach', '1 al 10 de agosto', 'https://a', 'pro-1'],   // vieja → se borra
    ['Hogar', 'Salas', 'MSI', '', '5 al 30 de agosto', 'https://b', 'pro-2'],               // terminó hace 24 d → se queda
    ['Niños', 'Juguetes', 'lo que sea', '', '', '', 'pro-3'],                                // sin fecha → se respeta
    ['Mujer', 'Jeans', '20%', 'Levis', '15 al 30 de septiembre', 'https://c', 'pro-4'],      // vigente, igual
    ['Hombre', 'Tenis', '10%', 'Nike', '1 al 5 de julio', 'https://d', 'pro-5']             // vieja → se borra
  ]);
  const M = hoja([HDR_MKP]);
  const C = contexto({ Promociones: H, MKP: M });

  const entrada = [
    { direccion: 'Mujer', categoria: 'Bolsas', promocion: '40% nueva', marca: '', vigencia: '20 al 30 de septiembre', liga: 'https://e' },
    { direccion: 'Mujer', categoria: 'Bolsas', promocion: 'Próxima', marca: '', vigencia: '10 al 20 de octubre', liga: '' },
    { direccion: 'Mujer', categoria: 'Jeans', promocion: '20%', marca: '', vigencia: '15 al 30 de septiembre', liga: '' }
  ];
  const s = C.promosAutoAplicarSeccion_('promociones', entrada.map((x) => Object.assign({}, x)), hoy, 30, false);
  ok('dos altas (la vigente y la próxima de Mujer · Bolsas conviven)', s.nuevas === 2, s);
  ok('Mujer · Jeans ya estaba igual: sin cambios, y su Marca NO se borra', s.iguales === 1 && s.actualizadas === 0, s);
  ok('se borraron las 2 viejas', s.borradas === 2, s);
  ok('la fila sin fecha se contó y se respetó', s.sinFechaEnPortal === 1, s);
  const vivas = H.datos.slice(1).filter((f) => f.some((v) => String(v).trim())).map((f) => f[0] + '|' + f[1] + '|' + f[4]);
  ok('lo que queda es lo correcto', JSON.stringify(vivas.sort()) === JSON.stringify([
    'Hogar|Salas|5 al 30 de agosto', 'Mujer|Bolsas|10 al 20 de octubre', 'Mujer|Bolsas|20 al 30 de septiembre',
    'Mujer|Jeans|15 al 30 de septiembre', 'Niños|Juguetes|'].sort()), vivas);
  ok('Levis sigue en la marca de Jeans', H.datos.some((f) => f[1] === 'Jeans' && f[3] === 'Levis'));
  ok('las altas llevan ID', H.datos.slice(1).filter((f) => f[0]).every((f) => String(f[6]).trim()));

  const s2 = C.promosAutoAplicarSeccion_('promociones', entrada.map((x) => Object.assign({}, x)), hoy, 30, false);
  ok('segunda corrida: nada nuevo, nada borrado', s2.nuevas === 0 && s2.actualizadas === 0 && s2.borradas === 0, s2);

  const cambio = entrada.map((x) => Object.assign({}, x));
  cambio[0].promocion = '45% corregida';
  const s3 = C.promosAutoAplicarSeccion_('promociones', cambio, hoy, 30, false);
  ok('un texto corregido en comercial actualiza, no duplica', s3.actualizadas === 1 && s3.nuevas === 0, s3);

  const antes = JSON.stringify(H.datos);
  H.datos.push(['Hombre', 'Relojes', 'x', '', '1 al 2 de junio', '', 'pro-9']);
  const antes2 = JSON.stringify(H.datos);
  const sim = C.promosAutoAplicarSeccion_('promociones', [{ direccion: 'Deportes', categoria: 'Bicis', promocion: 'y', vigencia: '1 al 30 de septiembre' }], hoy, 30, true);
  ok('simulación cuenta lo que haría…', sim.nuevas === 1 && sim.borradas === 1, sim);
  ok('…sin escribir nada', JSON.stringify(H.datos) === antes2 && antes !== antes2);
}

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
