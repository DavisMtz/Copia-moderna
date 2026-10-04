/*
 * Pruebas de la medición local de «Vende más» (extensión de Chrome 3.0, fase A del documento 18):
 * contadores de recomendaciones mostradas, abiertas y que acabaron en la bolsa, en ESTE navegador.
 *   Ejecutar:  node pruebas/ext_medicion.test.js
 *
 * Se carga medicion-local.js, el archivo REAL de la extensión, con un almacén y un reloj de
 * mentira. Lo que importa comprobar es lo que NO puede pasar: contar dos veces lo mismo porque la
 * tarjeta se repinta, dar por «en bolsa» algo que ya estaba ahí antes de recomendarse, guardar
 * algo del cliente, o seguir contando cuando el asesor la pausó.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const EXT = path.join(__dirname, '..', 'Extencion para chrome');

let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 500) : ''));
}
function seccion(t) { console.log('\n' + t); }

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(EXT, 'medicion-local.js'), 'utf8'), ctx, { filename: 'medicion-local.js' });
const M = ctx.VentelMedicion;
const MIN = 60000;

function mundo() {
  const m = { reloj: new Date(2026, 9, 5, 10, 0, 0).getTime(), almacen: {}, escrituras: 0 };
  m.dep = {
    leer: (ks) => Promise.resolve(ks.reduce((o, k) => { if (k in m.almacen) o[k] = JSON.parse(JSON.stringify(m.almacen[k])); return o; }, {})),
    guardar: (o) => { m.escrituras++; Object.assign(m.almacen, JSON.parse(JSON.stringify(o))); return Promise.resolve(); },
    ahora: () => m.reloj
  };
  m.med = M.crear(m.dep);
  m.res = async () => M.resumen(await m.med.estado());
  return m;
}
// Lo que la tarjeta enseña en la ficha del iPhone 16: su subida de capacidad y tres complementos.
const RECS = [
  { k: 'c', id: '1163567866', sku: '1163058509' },
  { k: 'x', id: '1163592828', tipo: 'smartphone/funda', pos: 0, origen: 'complementa' },
  { k: 'x', id: '99984306223', tipo: 'smartphone/mica', pos: 1, origen: 'busqueda', calidad: true },
  { k: 'x', id: '1110262147', tipo: 'smartphone/cargador', pos: 2, origen: 'complementa' }
];
const enBolsa = (id, sku, agregado) => ({ id: String(id), sku: String(sku || id), nombre: 'x', marca: 'x', precio: 1, cantidad: 1, agregado, enExistencia: true });

(async () => {
  seccion('0 · El archivo carga y no sale del navegador');
  ok('VentelMedicion existe', !!M && typeof M.crear === 'function' && typeof M.resumen === 'function');
  {
    const src = fs.readFileSync(path.join(EXT, 'medicion-local.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok('sin red, sin DOM y sin chrome.*: no puede mandar nada a ningún lado', !/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|\bdocument\.\w|\bwindow\.\w|\bchrome\.\w|https?:\/\//.test(src));
    const man = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    const lista = (man.content_scripts.find((c) => c.js.indexOf('recomendador.js') > -1) || { js: [] }).js;
    ok('el manifiesto lo carga antes que la tarjeta', lista.indexOf('medicion-local.js') > -1 && lista.indexOf('medicion-local.js') < lista.indexOf('recomendador.js'), lista);
    ok('la extensión sigue sin pedir permisos de red a otros sitios', JSON.stringify(man.host_permissions) === JSON.stringify(['*://*.liverpool.com.mx/*', 'https://script.google.com/*']), man.host_permissions);
  }

  seccion('1 · Mostradas: lo que el asesor tuvo a la vista, una sola vez');
  let m = mundo();
  await m.med.mostrar('1163567866', RECS);
  let r = await m.res();
  ok('una tarjeta, con venta cruzada, tres recomendaciones y una subida', r.total.tarjetas === 1 && r.total.conCruzada === 1 && r.total.mostradas === 3 && r.total.subidas === 1, r.total);
  await m.med.mostrar('1163567866', RECS);
  await m.med.mostrar('1163567866', RECS);
  r = await m.res();
  ok('la tarjeta se repinta cada pocos segundos: lo mismo no cuenta dos veces', r.total.tarjetas === 1 && r.total.mostradas === 3 && r.total.subidas === 1, r.total);
  await m.med.mostrar('1163567866', RECS.concat([{ k: 'x', id: '555000111', tipo: 'smartphone/audifonos', pos: 2, origen: 'busqueda' }]));
  r = await m.res();
  ok('lo que llega después (lo trajo la búsqueda) sí se suma; la tarjeta sigue siendo una', r.total.mostradas === 4 && r.total.tarjetas === 1 && r.total.conCruzada === 1, r.total);
  m.reloj += 10 * MIN;
  await m.med.mostrar('1163567866', RECS);
  ok('a los 10 minutos, recargar la ficha no cuenta de nuevo', (await m.res()).total.tarjetas === 1 && (await m.res()).total.mostradas === 4);
  m.reloj += 25 * MIN;
  await m.med.mostrar('1163567866', RECS);
  r = await m.res();
  ok('pasada la media hora es otra visita: cuenta', r.total.tarjetas === 2 && r.total.mostradas === 7 && r.total.subidas === 2, r.total);
  await m.med.mostrar('1198888888', []);
  r = await m.res();
  ok('una ficha sin nada que recomendar también es una tarjeta (sin venta cruzada)', r.total.tarjetas === 3 && r.total.conCruzada === 2 && r.total.mostradas === 7, r.total);
  await m.med.mostrar('1198888888', []);
  ok('…y tampoco se cuenta dos veces', (await m.res()).total.tarjetas === 3);
  await m.med.mostrar('1198888888', [{ k: 'x', id: '777', tipo: 'laptop/mouse', pos: 0, origen: 'busqueda' }]);
  r = await m.res();
  ok('si su venta cruzada llega después, la ficha pasa a contar como «con venta cruzada»', r.total.conCruzada === 3 && r.total.tarjetas === 3 && r.total.mostradas === 8, r.total);
  await m.med.mostrar('', RECS);
  await m.med.mostrar('1163567866', [null, {}, { k: 'z', id: '1' }, { k: 'x' }]);
  ok('avisos rotos (sin ficha, sin id, de un tipo que no existe) se ignoran', (await m.res()).total.mostradas === 8);

  seccion('2 · Clics: lo que el asesor abrió');
  m = mundo();
  await m.med.mostrar('1163567866', RECS);
  await m.med.clic('1163567866', 'x', '99984306223');
  r = await m.res();
  ok('un clic en la mica', r.total.clics === 1 && r.tasaClic === 33.3, [r.total, r.tasaClic]);
  await m.med.clic('1163567866', 'x', '99984306223');
  ok('otro clic en la misma no cuenta de nuevo', (await m.res()).total.clics === 1);
  await m.med.clic('1163567866', 'x', '000000');
  await m.med.clic('9999', 'x', '99984306223');
  ok('un clic en algo que no se mostró (o de otra ficha) no cuenta', (await m.res()).total.clics === 1);
  await m.med.clic('1163567866', 'c', '1163567866', '1163058509');
  r = await m.res();
  ok('el clic en «Sube a 512 GB» va aparte, por su SKU', r.total.subidasClic === 1 && r.total.clics === 1, r.total);
  await m.med.clic('1163567866', 'q');
  ok('abrir una búsqueda sugerida también se cuenta, aparte', (await m.res()).total.chips === 1);
  r = await m.res();
  ok('por tipo: la mica, 1 de 1; la funda, 0 de 1', r.tipos.find((t) => t.tipo === 'smartphone/mica').clics === 1 && r.tipos.find((t) => t.tipo === 'smartphone/funda').clics === 0 &&
    r.tipos.find((t) => t.tipo === 'smartphone/mica').tasaClic === 100, r.tipos);

  seccion('3 · En bolsa: agregado DESPUÉS de mostrarse y dentro de la hora');
  m = mundo();
  const t0 = m.reloj;
  await m.med.mostrar('1163567866', RECS);
  await m.med.bolsa([enBolsa('1163592828', null, t0 - 2 * 24 * 60 * MIN)]);
  ok('una funda que ya estaba en la bolsa desde hace dos días NO es mérito de la tarjeta', (await m.res()).total.enBolsa === 0);
  await m.med.bolsa([enBolsa('1163592828', null, t0 - 20 * MIN)]);
  ok('…ni una agregada 20 minutos antes de mostrarse', (await m.res()).total.enBolsa === 0);
  m.reloj += 4 * MIN;
  await m.med.bolsa([enBolsa('1163567866', '1163057502', t0 + 1 * MIN), enBolsa('1163592828', null, t0 + 3 * MIN)]);
  r = await m.res();
  ok('la funda recomendada, agregada 3 minutos después: en bolsa', r.total.enBolsa === 1 && r.tasaBolsa === 33.3 && r.tipos.find((t) => t.tipo === 'smartphone/funda').enBolsa === 1, [r.total, r.tipos]);
  ok('el iPhone de 128 GB (el artículo de la ficha) no cuenta como subida: no es el SKU que se sugirió', r.total.subidasEnBolsa === 0, r.total);
  await m.med.bolsa([enBolsa('1163592828', null, t0 + 3 * MIN)]);
  ok('leer otra vez la misma bolsa no la cuenta dos veces', (await m.res()).total.enBolsa === 1);
  await m.med.bolsa([enBolsa('1163567866', '1163058509', t0 + 5 * MIN)]);
  ok('el iPhone en 512 GB (el SKU sugerido): subida en bolsa', (await m.res()).total.subidasEnBolsa === 1);
  await m.med.bolsa([enBolsa('99984306223', null, t0 + 61 * MIN)]);
  ok('la mica agregada 61 minutos después ya no cuenta (la ventana es de 60)', (await m.res()).total.enBolsa === 1);
  await m.med.bolsa([enBolsa('99984306223', null, t0 + 59 * MIN)]);
  ok('…a los 59 minutos sí', (await m.res()).total.enBolsa === 2);
  await m.med.bolsa([enBolsa('1110262147', null, t0 - 3 * MIN)]);
  ok('se toleran 5 minutos de desfase entre el reloj de Liverpool y el del equipo', (await m.res()).total.enBolsa === 3);
  await m.med.bolsa([{ id: '555', agregado: null }, null, {}]);
  await m.med.bolsa(null);
  await m.med.bolsa([]);
  ok('una bolsa vacía, sin leer o con artículos sin hora no rompe ni cuenta', (await m.res()).total.enBolsa === 3);

  seccion('4 · Por día (hora local) y por tipo');
  m = mundo();
  m.reloj = new Date(2026, 9, 5, 23, 50, 0).getTime();
  await m.med.mostrar('100001', [{ k: 'x', id: '1', tipo: 'laptop/mouse' }]);
  m.reloj = new Date(2026, 9, 6, 0, 10, 0).getTime();
  await m.med.mostrar('100002', [{ k: 'x', id: '2', tipo: 'laptop/mouse' }, { k: 'x', id: '3', tipo: 'laptop/mochila' }]);
  r = await m.res();
  ok('cada día en su renglón, con la fecha LOCAL (las 23:50 del 5 no son del 6)', r.dias.length === 2 && r.dias[0].dia === '2026-10-05' && r.dias[0].mostradas === 1 && r.dias[1].dia === '2026-10-06' && r.dias[1].mostradas === 2, r.dias);
  ok('los tipos, del más mostrado al menos', r.tipos[0].tipo === 'laptop/mouse' && r.tipos[0].mostradas === 2 && r.tipos[1].tipo === 'laptop/mochila', r.tipos);
  ok('diaDe usa la hora local', M.diaDe(new Date(2026, 0, 9, 0, 0, 1).getTime()) === '2026-01-09');
  {
    const texto = M.comoTexto(await m.med.estado()).split('\n');
    ok('el resumen para copiar: encabezados, un renglón por día, el total y los tipos, separados por tabuladores',
      texto[0].split('\t')[0] === 'Día' && texto[1].split('\t')[0] === '2026-10-05' && texto[3].split('\t')[0] === 'Total' && texto[3].split('\t')[3] === '3' &&
      texto.some((l) => l === 'laptop/mouse\t2\t0\t0'), texto);
  }

  seccion('5 · Pausar, borrar y no crecer sin fin');
  m = mundo();
  await m.med.mostrar('100001', [{ k: 'x', id: '1', tipo: 'laptop/mouse' }]);
  await m.med.pausar(true);
  await m.med.mostrar('100002', [{ k: 'x', id: '2', tipo: 'laptop/mouse' }]);
  await m.med.clic('100001', 'x', '1');
  await m.med.bolsa([enBolsa('1', null, m.reloj + MIN)]);
  r = await m.res();
  ok('pausada no cuenta nada: ni mostradas, ni clics, ni bolsa', r.pausada === true && r.total.mostradas === 1 && r.total.clics === 0 && r.total.enBolsa === 0, r.total);
  await m.med.pausar(false);
  await m.med.clic('100001', 'x', '1');
  ok('al reanudar vuelve a contar', (await m.res()).total.clics === 1 && (await m.res()).pausada === false);
  await m.med.borrar();
  r = await m.res();
  ok('borrar deja todo en cero', r.total.mostradas === 0 && r.total.clics === 0 && r.dias.length === 0 && r.tipos.length === 0 && (await m.med.estado()).recientes.length === 0, r);
  m = mundo();
  for (let i = 0; i < 130; i++) { await m.med.mostrar('2' + String(100000 + i), [1, 2, 3, 4].map((n) => ({ k: 'x', id: String(i * 10 + n), tipo: 'laptop/mouse' }))); m.reloj += 3 * MIN; }
  {
    const e = await m.med.estado();
    ok('la lista de lo reciente no pasa de 400 renglones (130 fichas × 4 serían 520)', e.recientes.length <= 400 && (await m.res()).total.mostradas === 520, e.recientes.length);
  }
  m.reloj += 25 * 60 * MIN;
  await m.med.mostrar('100009', [{ k: 'x', id: '9', tipo: 'laptop/mouse' }]);
  ok('lo de hace más de un día sale de la lista de lo reciente (los totales se quedan)', (await m.med.estado()).recientes.length === 1 && (await m.res()).total.mostradas === 521, (await m.med.estado()).recientes.length);
  m = mundo();
  for (let d = 0; d < 125; d++) { m.reloj = new Date(2026, 0, 1 + d, 12, 0, 0).getTime(); await m.med.mostrar('100001', [{ k: 'x', id: '1', tipo: 'laptop/mouse' }]); }
  ok('guarda 120 días, no más', Object.keys((await m.med.estado()).dias).length === 120, Object.keys((await m.med.estado()).dias).length);

  seccion('6 · Lo que se guarda: ids de producto, tipos y horas; nada de nadie');
  m = mundo();
  await m.med.mostrar('1163567866', RECS);
  await m.med.clic('1163567866', 'x', '99984306223');
  await m.med.bolsa([Object.assign(enBolsa('1163592828', null, m.reloj + MIN), { nombre: 'Funda para iPhone 16 de silicón', marca: 'APPLE', precio: 1099 })]);
  {
    const crudo = JSON.stringify(m.almacen);
    ok('una sola clave en el almacén', Object.keys(m.almacen).join() === M.CLAVE, Object.keys(m.almacen));
    ok('ni nombres de artículo, ni marcas, ni precios, ni direcciones', !/Funda|APPLE|1099|iPhone|nombre|marca|precio/.test(crudo), crudo.slice(0, 400));
    const x = m.almacen[M.CLAVE].recientes[1];
    ok('cada renglón: hora, ficha, tipo de renglón, id, SKU, tipo de complemento, lugar, origen y sus tres marcas', Object.keys(x).sort().join() === 'bolsa,clic,e,f,id,k,o,pos,q,sku,t,tp', Object.keys(x));
  }
  m = mundo();
  m.almacen[M.CLAVE] = 'basura';
  await m.med.mostrar('100001', [{ k: 'x', id: '1', tipo: 'laptop/mouse' }]);
  ok('un almacén corrupto se reemplaza sin reventar', (await m.res()).total.mostradas === 1);
  m = mundo();
  await Promise.all([m.med.mostrar('100001', [{ k: 'x', id: '1', tipo: 'laptop/mouse' }]), m.med.clic('100001', 'x', '1'), m.med.mostrar('100002', [{ k: 'x', id: '2', tipo: 'laptop/mouse' }])]);
  r = await m.res();
  ok('tres avisos seguidos no se pisan: van uno detrás de otro', r.total.mostradas === 2 && r.total.clics === 1 && r.total.tarjetas === 2, r.total);
  ok('las tasas sin datos son null, no un 0 % inventado', M.resumen(null).tasaClic === null && M.resumen({}).tasaBolsa === null);

  console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
  process.exit(fallos ? 1 : 0);
})();
