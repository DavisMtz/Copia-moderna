/*
 * Pruebas de «la bolsa como contexto» de «Vende más» (extensión de Chrome 3.0).
 *   Ejecutar:  node pruebas/ext_bolsa.test.js
 *
 * Dos piezas, con los archivos REALES de la extensión en un contexto aislado:
 *   · el núcleo (recomendador-nucleo.js, contextoConBolsa): en la ficha de un accesorio toma
 *     el equipo que el cliente acaba de meter a la bolsa, y no vuelve a ofrecer lo que ya lleva;
 *   · el lector con freno (bolsa-liverpool.js): cuándo se pide /tienda/cart y cuándo NO.
 *
 * Los escenarios son los que se midieron con fichas y búsquedas reales el 04/10/2026
 * (documento 18, §3), recortados. Lo que importa comprobar es lo que NO puede pasar: tomar por
 * contexto una bolsa de hace tres días, pegarle a un accesorio un equipo que no es el suyo,
 * ofrecer el molino de la espresso a quien lleva una cafetera de cápsulas, o pedirle la bolsa a
 * Liverpool una y otra vez.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const EXT = path.join(__dirname, '..', 'Extencion para chrome');
const BUS = JSON.parse(fs.readFileSync(path.join(__dirname, 'ext_busquedas_20261003.json'), 'utf8'));

let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 500) : ''));
}
function seccion(t) { console.log('\n' + t); }

const ctx = vm.createContext({ console });
['reglas-venta.js', 'recomendador-nucleo.js', 'lector-liverpool.js', 'buscador-liverpool.js', 'bolsa-liverpool.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), ctx, { filename: f });
});
const VM = ctx.VentelVM, REGLAS = ctx.VENTEL_REGLAS, L = ctx.VentelLector, B = ctx.VentelBolsa, BUSCADOR = ctx.VentelBuscador;
const AHORA = new Date(2026, 9, 4, 12, 0, 0).getTime();
const MIN = 60000;

const fichaDe = (o) => Object.assign({ id: '1', migas: [], producto: null, modeloComercial: null, precio: null, esRango: false,
  varianteActual: null, skuUrl: null, seleccion: null, variantes: [], colores: [], care: false }, o);
const it = (id, marca, nombre, precio) => ({ id: String(id), marca, nombre, precio: precio == null ? 500 : precio });
/** Un artículo de la bolsa, agregado hace `min` minutos (como lo entrega lector-liverpool.js). */
const enBolsa = (id, marca, nombre, precio, min) => ({ id: String(id), sku: String(id), nombre, marca, precio, cantidad: 1,
  agregado: min === null ? null : AHORA - (min == null ? 10 : min) * MIN, enExistencia: true });
const rec = (ficha, car, busquedas, bolsa) => VM.recomendar(ficha, car || {}, null, REGLAS, AHORA, busquedas || {}, bolsa);
const consultas = (m) => m.busquedas.concat(m.sugeridas).map((b) => b.consulta);

// Las fichas reales de la investigación (nombre, marca y migas tal cual).
const IPHONE = enBolsa('1163567866', 'APPLE', 'iPhone 16 6.1 pulgadas Super Retina XDR', 17499);
const ADAPTADOR = fichaDe({ id: '1168416900', nombre: 'Adaptador de corriente', marca: 'APPLE', migas: ['Apple', 'Accesorios Apple', 'Adaptadores y Cargadores Apple'], producto: 'Adaptador de corriente', precio: 499, care: true });
const FUNDA = fichaDe({ id: '999673023163', nombre: 'Funda para Iphone 16 de TPU', marca: 'LACOSTE', migas: ['Electrónica', 'Celulares y Telefonía', 'Fundas para celular'], producto: 'Funda celular', precio: 899, care: true });
const FUNDAS_16 = [it(1163592828, 'APPLE', 'Funda para iPhone 16 de silicón', 1099), it(1185859220, 'X', 'Funda para iPhone 16 Pro de silicón', 999)];

seccion('0 · Los archivos cargan');
ok('el núcleo trae el contexto con bolsa, y las reglas su ventana de 90 minutos', typeof VM.contextoConBolsa === 'function' && REGLAS.bolsa && REGLAS.bolsa.ventanaMin === 90, REGLAS.bolsa);
ok('VentelBolsa existe', !!B && typeof B.crear === 'function');
{
  const man = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const lista = (man.content_scripts.find((c) => c.js.indexOf('recomendador.js') > -1) || { js: [] }).js;
  ok('el manifiesto carga bolsa-liverpool.js antes que la tarjeta', lista.indexOf('bolsa-liverpool.js') > -1 && lista.indexOf('bolsa-liverpool.js') < lista.indexOf('recomendador.js'), lista);
  // El código sin sus comentarios (que sí hablan de chrome.storage y de agregar o quitar).
  const src = fs.readFileSync(path.join(EXT, 'bolsa-liverpool.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('bolsa-liverpool.js no toca el DOM ni chrome.*: todo le llega por `dep`', !/\bdocument\.\w|\bwindow\.\w|\bchrome\.\w|\bfetch\(/.test(src));
  ok('solo sabe pedir /tienda/cart: nunca agrega ni quita nada', (src.match(/dep\.pedir\(/g) || []).length === 1 && /dep\.pedir\('\/tienda\/cart'\)/.test(src) && !/\b(POST|PUT|DELETE|PATCH)\b|addItem|removeItem/.test(src));
}

seccion('1 · La ventana de tiempo: la bolsa no es el cliente de esta llamada');
{
  const b = [enBolsa(1, 'A', 'iPhone 16', 1, 10), enBolsa(2, 'A', 'Viejo de hace 56 horas', 1, 56 * 60), enBolsa(3, 'A', 'Sin hora de alta', 1, null),
    enBolsa(4, 'A', 'Recién agregado', 1, 1), enBolsa(5, 'A', 'Justo en el límite', 1, 90), enBolsa(6, 'A', 'Un minuto después del límite', 1, 91),
    enBolsa(7, 'A', 'Con el reloj 3 min adelantado', 1, -3), enBolsa(8, 'A', 'Del futuro', 1, -30)];
  const v = VM.bolsaVigente(b, REGLAS, AHORA).map((x) => x.id);
  ok('cuenta lo agregado en los últimos 90 minutos, lo más reciente primero', JSON.stringify(v) === '["7","4","1","5"]', v);
  ok('lo de hace 56 horas no cuenta', v.indexOf('2') === -1);
  ok('sin hora de alta no cuenta: no se puede probar que sea de esta llamada', v.indexOf('3') === -1);
  ok('tolera unos minutos de desfase entre los dos relojes, no media hora', v.indexOf('7') > -1 && v.indexOf('8') === -1);
  ok('sin bolsa o vacía: nada', VM.bolsaVigente(null, REGLAS, AHORA).length === 0 && VM.bolsaVigente([], REGLAS, AHORA).length === 0);
}

seccion('2 · La ficha de un accesorio toma el equipo de la bolsa');
{
  const busq = { 'funda iPhone 16': FUNDAS_16, 'mica iPhone 16': BUS['mica iPhone 16'] };
  const sin = rec(ADAPTADOR, {}, busq, null);
  ok('adaptador Apple, sin bolsa: no hay clase ni nada que ofrecer (como en la 2.9)', sin.clase === null && sin.cruzada.length === 0 && sin.busquedas.length === 0 && sin.bolsa.equipo === null && sin.bolsa.leida === false, sin);
  const con = rec(ADAPTADOR, {}, busq, [IPHONE]);
  ok('con el iPhone 16 en la bolsa: los complementos son los DEL iPhone', con.bolsa.equipo && con.bolsa.equipo.id === '1163567866' && con.bolsa.equipo.modelo === 'iPhone 16' && con.bolsa.equipo.clase.id === 'smartphone', con.bolsa);
  ok('…busca su funda y su mica', JSON.stringify(con.busquedas.map((x) => x.consulta)) === '["funda iPhone 16","mica iPhone 16"]', con.busquedas);
  ok('…y las ofrece, del modelo exacto (no la del 16 Pro)', con.cruzada.length === 2 && con.cruzada[0].id === '1163592828' && con.cruzada[0].compat === 'exacto' &&
    con.cruzada[1].tipo === 'mica' && con.cruzada[1].compat === 'exacto' && !con.cruzada.some((r) => r.id === '1185859220'), con.cruzada);
  ok('…no otro cargador (es lo que ya está viendo) ni el propio teléfono', !con.cruzada.some((r) => r.tipo === 'cargador') && !consultas(con).some((q) => /cargador/.test(q)), consultas(con));
  ok('la cabecera sigue siendo la de la ficha: sin clase propia, sin Liverpool Care, sin subida', con.clase === null && con.servicio === false && con.incremental.modelo === null);
  ok('con la bolsa leída y vacía, igual que sin bolsa', rec(ADAPTADOR, {}, busq, []).cruzada.length === 0 && rec(ADAPTADOR, {}, busq, []).bolsa.leida === true);
}
{
  // La funda es de LACOSTE: sin la bolsa buscaba «audífonos inalámbricos Lacoste».
  const car = { complementa: [it(1190921413, 'MOBEST', 'Adaptador de corriente de 40 w USB tipo C dinámico', 459), it(1110262147, 'APPLE', 'Adaptador de corriente', 539)] };
  const sin = rec(FUNDA, car, {}, null);
  ok('funda Lacoste para iPhone 16, sin bolsa: busca con la marca de la FUNDA', consultas(sin).some((q) => /Lacoste/i.test(q)), consultas(sin));
  const con = rec(FUNDA, car, {}, [IPHONE]);
  ok('con el iPhone en la bolsa: busca con la marca del EQUIPO', consultas(con).some((q) => q === 'audífonos inalámbricos Apple') && !consultas(con).some((q) => /Lacoste/i.test(q)), consultas(con));
  ok('…y el cargador es el de Apple, de su marca, no el genérico', con.cruzada.some((r) => r.id === '1110262147' && r.compat === 'marca') && !con.cruzada.some((r) => r.id === '1190921413'), con.cruzada);
  ok('…sin ofrecer otra funda', !con.cruzada.some((r) => r.tipo === 'funda') && !consultas(con).some((q) => /funda/.test(q)));
}

seccion('3 · La guardia: el equipo se toma solo si el artículo le queda');
{
  const micaA57 = fichaDe({ id: '1197728287', nombre: 'Mica para smartphone Galaxy A57 de Pet', marca: 'SAMSUNG', migas: ['Librería y Papelería', 'Equipo de oficina', 'Micas para Celulares'], producto: 'Set mica', precio: 119 });
  const a56 = enBolsa(1173599021, 'SAMSUNG', 'Galaxy A56 Super AMOLED 6.7 pulgadas', 9199);
  ok('de un artículo de la bolsa solo se sabe el nombre: «Galaxy A56 Super AMOLED…» se reconoce como celular',
    (VM.contexto(fichaDe({ id: '1173599021', nombre: a56.nombre, marca: a56.marca }), REGLAS).clase || {}).id === 'smartphone' &&
    (VM.contexto(fichaDe({ id: '2', nombre: 'Moto G15 4G 6.7 pulgadas', marca: 'MOTOROLA' }), REGLAS).clase || {}).id === 'smartphone' &&
    (VM.contexto(fichaDe({ id: '3', nombre: 'Galaxy Tab A9+ 11 pulgadas', marca: 'SAMSUNG' }), REGLAS).clase || {}).id === 'tablet');
  const m = rec(micaA57, {}, {}, [a56]);
  ok('una mica de Galaxy A57 NO toma un A56 de la bolsa', m.bolsa.equipo === null && consultas(m).every((q) => !/A56/i.test(q)), [m.bolsa, consultas(m)]);
  const a57 = enBolsa(52, 'SAMSUNG', 'Galaxy A57 Super AMOLED plus 6.7 pulgadas', 8999);
  ok('…un A57 sí', (rec(micaA57, {}, {}, [a57]).bolsa.equipo || {}).id === '52', rec(micaA57, {}, {}, [a57]).bolsa);
  const redmi = enBolsa(53, 'XIAOMI', 'Smartphone Xiaomi Redmi Note 14 Pro+ AMOLED 6.6 pulgadas', 7455, 5);
  ok('un adaptador de Apple no toma un Redmi (otra familia)', rec(ADAPTADOR, {}, {}, [redmi]).bolsa.equipo === null);
  const ctrlXbox = fichaDe({ id: '60', nombre: 'Control inalámbrico Xbox Series X Carbon Black', marca: 'MICROSOFT', migas: ['Videojuegos', 'Accesorios'], precio: 1399 });
  const ctrlPs5 = fichaDe({ id: '61', nombre: 'Control inalámbrico para PlayStation 5 edición Limitada', marca: 'PLAYSTATION', migas: ['Videojuegos', 'Accesorios'], precio: 1899 });
  const ps5 = enBolsa(62, 'PLAYSTATION', 'Consola fija ps5 de 1 tb', 11999, 20);
  ok('un control de Xbox no toma una PS5', rec(ctrlXbox, {}, {}, [ps5]).bolsa.equipo === null);
  const mP = rec(ctrlPs5, { complementa: [it(63, 'X', 'Wuchang Fallen Feathers Day One Edition para PS5', 1169), it(64, 'PLAYSTATION', 'Control inalámbrico DualSense PS5 blanco', 1599), it(65, 'NINTENDO', 'Mario Kart World para Nintendo Switch 2', 1599)] }, {}, [ps5]);
  ok('el control de PS5 sí: se le ofrece un juego de PS5, no otro control ni un juego de Switch',
    mP.bolsa.equipo && mP.bolsa.equipo.id === '62' && mP.cruzada.some((r) => r.id === '63' && r.tipo === 'juego') && !mP.cruzada.some((r) => r.id === '64' || r.id === '65'), mP.cruzada);
  ok('con dos equipos en la bolsa, el más reciente AL QUE LE QUEDA (la consola, no el iPhone de hace 2 minutos)',
    (rec(ctrlPs5, {}, {}, [enBolsa(1163567866, 'APPLE', 'iPhone 16 6.1 pulgadas Super Retina XDR', 17499, 2), ps5]).bolsa.equipo || {}).id === '62');
  ok('la bolsa vieja no se toma (el adaptador con la bocina y el Redmi de hace 56 y 61 horas: caso real)',
    rec(ADAPTADOR, {}, {}, [enBolsa(1184854987, 'JBL', 'Bocina portátil Jbl BOOMBOX 4 bluetooth', 7699.3, 56 * 60), enBolsa(99982859613, 'XIAOMI', 'Smartphone Xiaomi Redmi Note 14 Pro+', 7455, 61 * 60),
      enBolsa(1163567866, 'APPLE', 'iPhone 16 6.1 pulgadas Super Retina XDR', 17499, 200)]).bolsa.equipo === null);
  ok('un artículo sin hora de alta tampoco', rec(ADAPTADOR, {}, {}, [enBolsa(1163567866, 'APPLE', 'iPhone 16 6.1 pulgadas Super Retina XDR', 17499, null)]).bolsa.equipo === null);
  ok('lo de la bolsa tiene que ser un EQUIPO: otro accesorio no sirve de contexto',
    rec(ADAPTADOR, {}, {}, [enBolsa(70, 'APPLE', 'Funda para iPhone 16 de silicón', 1099), enBolsa(71, 'X', 'Artículo cualquiera sin clase', 99)]).bolsa.equipo === null);
  const iphoneFicha = fichaDe({ id: '1163567866', nombre: 'iPhone 16 6.1 pulgadas Super Retina XDR', marca: 'APPLE', migas: ['Tecnología', 'Celulares'], producto: 'Smartphone', modeloComercial: 'iPhone 16', precio: 17499, care: true });
  const laptop = enBolsa(80, 'HP', 'Laptop 15-fd0161la 15.6 pulgadas Full HD Intel Core i5', 11999, 3);
  const mI = rec(iphoneFicha, {}, {}, [laptop]);
  ok('la ficha de un EQUIPO nunca toma otro de la bolsa: el iPhone sigue siendo el iPhone, con su Liverpool Care',
    mI.bolsa.equipo === null && mI.clase.id === 'smartphone' && mI.servicio === true && consultas(mI).indexOf('funda iPhone 16') > -1, [mI.bolsa, consultas(mI)]);
  ok('el propio artículo de la ficha, ya en la bolsa, no es «su equipo»', rec(ADAPTADOR, {}, {}, [enBolsa(1110262147, 'APPLE', 'Adaptador de corriente', 539)]).bolsa.equipo === null);
}

seccion('4 · El `si` mira al equipo, no al accesorio (el error del prototipo)');
{
  // «Set de 16 cápsulas Espresso Intenso»: su nombre dice «Espresso», y el molino es para la espresso.
  const caps = fichaDe({ id: '90', nombre: 'Set de 16 cápsulas Espresso Intenso', marca: 'DOLCE GUSTO', migas: ['Despensa', 'Café'], producto: 'Cápsulas', precio: 199 });
  const dolce = enBolsa(1182048221, 'KRUPS', 'Cafetera de cápsula dolce gusto kp240ax0', 2099);
  const car = { complementa: [it(1115918792, 'MASTERCHEF', 'Molino para café de plástico', 719.4), it(9001, 'GENÉRICO', 'Espumador de leche eléctrico', 324)] };
  const m = rec(caps, car, {}, [dolce]);
  ok('cápsulas Dolce Gusto + su cafetera en la bolsa: se toma la cafetera', m.bolsa.equipo && m.bolsa.equipo.id === '1182048221' && m.bolsa.equipo.clase.id === 'cafetera', m.bolsa);
  ok('…el espumador sí; el molino NO, aunque el nombre de las cápsulas diga «Espresso»', m.cruzada.some((r) => r.id === '9001') && !m.cruzada.some((r) => r.id === '1115918792'), m.cruzada);
  ok('…y no busca más cápsulas: es lo que ya está viendo', !consultas(m).some((q) => /c[aá]psulas/i.test(q)), consultas(m));
  const nesp = enBolsa(91, 'NESPRESSO', 'Cafetera de cápsulas Vertuo Pop deluxe titan', 2395);
  ok('las cápsulas Dolce Gusto NO toman una cafetera Nespresso (no es su sistema)', rec(caps, car, {}, [nesp]).bolsa.equipo === null);
  const espresso = enBolsa(92, 'OSTER', 'Cafetera espresso semiautomática 15 bar', 1559);
  ok('…ni una cafetera espresso (no es de cápsulas)', rec(caps, car, {}, [espresso]).bolsa.equipo === null);
}

seccion('5 · Lo que el cliente ya lleva no se le vuelve a ofrecer');
{
  const iphone = fichaDe({ id: '1163567866', nombre: 'iPhone 16 6.1 pulgadas Super Retina XDR', marca: 'APPLE', migas: ['Tecnología', 'Celulares'], producto: 'Smartphone', modeloComercial: 'iPhone 16', precio: 17499, care: true });
  const car = { complementa: [it(1163592828, 'APPLE', 'Funda para iPhone 16 de silicón', 1099), it(1110262147, 'APPLE', 'Adaptador de corriente', 539), it(99986989537, 'X', 'Batería portátil 10000 mAh', 499)] };
  const sin = rec(iphone, car, {}, null);
  ok('iPhone 16, sin bolsa: funda, adaptador y batería', sin.cruzada.map((r) => r.tipo).join() === 'funda,cargador,bateria', sin.cruzada.map((r) => r.tipo));
  const con = rec(iphone, car, {}, [enBolsa(999673023163, 'LACOSTE', 'Funda para Iphone 16 de TPU', 899, 4)]);
  ok('con una funda ya en la bolsa: ni esa ni otra funda', !con.cruzada.some((r) => r.tipo === 'funda') && con.bolsa.tipos.join() === 'funda', [con.cruzada.map((r) => r.tipo), con.bolsa]);
  ok('…y tampoco la busca ni la sugiere: su lugar lo toma la mica', consultas(con).indexOf('funda iPhone 16') === -1 && consultas(con).indexOf('mica iPhone 16') > -1, consultas(con));
  const conCargador = rec(iphone, car, {}, [enBolsa(1110262147, 'APPLE', 'Adaptador de corriente', 539, 4)]);
  ok('el mismo artículo que ya lleva, fuera por su id', !conCargador.cruzada.some((r) => r.id === '1110262147'));
  const viejo = rec(iphone, car, {}, [enBolsa(1110262147, 'APPLE', 'Adaptador de corriente', 539, 70 * 60)]);
  ok('un artículo VIEJO de la bolsa: fuera por su id (ahí está), pero su tipo sigue abierto', !viejo.cruzada.some((r) => r.id === '1110262147') && viejo.bolsa.tipos.length === 0, [viejo.cruzada.map((r) => r.id), viejo.bolsa]);
  const laptop = fichaDe({ id: '1200533310', nombre: 'Laptop thin & light omnibook 3 16-bu0054la 16 pulgadas', marca: 'HP', migas: ['Electrónica', 'Computación', 'Laptops'], producto: 'Laptop', precio: 18959, care: true });
  const carL = { complementa: [it(11, 'LOGITECH', 'Mouse Inalámbrico m170', 149.25), it(12, 'X', 'Mochila con portalaptop Fuji unisex', 674.25)] };
  const mL = rec(laptop, carL, {}, [enBolsa(900000002, 'HP', 'Mouse inalámbrico 400 silencioso AZ7B2AA', 399)]);
  ok('laptop con un mouse en la bolsa: no otro mouse; la mochila sí', !mL.cruzada.some((r) => r.tipo === 'mouse') && mL.cruzada.some((r) => r.id === '12'), mL.cruzada);
}

seccion('6 · El lector con freno: cuándo se pide la bolsa y cuándo no');
const PAGINA = fs.readFileSync(path.join(__dirname, 'ext_lector_bolsa_20261004.html'), 'utf8');
function mundo() {
  const m = { reloj: 1000000000000, almacen: {}, pedidos: [], respuesta: { status: 200, texto: PAGINA } };
  m.dep = {
    leer: (ks) => Promise.resolve(ks.reduce((o, k) => { if (k in m.almacen) o[k] = JSON.parse(JSON.stringify(m.almacen[k])); return o; }, {})),
    guardar: (o) => { Object.assign(m.almacen, JSON.parse(JSON.stringify(o))); return Promise.resolve(); },
    pedir: (url) => { m.pedidos.push(url); return typeof m.respuesta === 'function' ? m.respuesta() : Promise.resolve(m.respuesta); },
    leerBolsa: (t) => L.bolsaDe(L.streamDe(t)),
    ahora: () => m.reloj
  };
  m.bolsa = B.crear(m.dep);
  return m;
}
(async () => {
  let m = mundo();
  let r = await m.bolsa.leer(0, 's1');
  ok('con la cabecera en cero no se pide nada: bolsa vacía', r.de === 'vacia' && r.items.length === 0 && m.pedidos.length === 0, [r, m.pedidos]);
  r = await m.bolsa.leer(null);
  ok('sin saber la cuenta tampoco se pide', r.items === null && r.motivo === 'sin-cuenta' && m.pedidos.length === 0, r);
  r = await m.bolsa.leer(3, 's1');
  ok('con artículos: un solo GET a /tienda/cart', r.de === 'red' && m.pedidos.length === 1 && m.pedidos[0] === '/tienda/cart' && r.items.length === 3 && r.items[0].id === '1163567866', [r.de, m.pedidos]);
  ok('lo guardado no trae nada del cliente', !/CLIENTE DE PRUEBA|CALLE FALSA|example\.com/.test(JSON.stringify(m.almacen)), JSON.stringify(m.almacen).slice(0, 300));
  r = await m.bolsa.leer(3, 's1');
  ok('la misma cuenta, enseguida: sale de lo guardado, sin red', r.de === 'cache' && m.pedidos.length === 1 && r.items.length === 3, [r.de, m.pedidos.length]);
  m.reloj += 14 * MIN;
  r = await m.bolsa.leer(3, 's1');
  ok('…y a los 14 minutos también', r.de === 'cache' && m.pedidos.length === 1);
  m.reloj += 2 * MIN;
  r = await m.bolsa.leer(3, 's1');
  ok('pasados los 15 minutos se vuelve a leer', r.de === 'red' && m.pedidos.length === 2, [r, m.pedidos.length]);
  m.reloj += 30000;
  r = await m.bolsa.leer(4, 's1');
  ok('si cambia la cuenta de la cabecera, se lee aunque no hayan pasado los 15 minutos', r.de === 'red' && m.pedidos.length === 3, [r, m.pedidos.length]);
  m.reloj += 5000;
  r = await m.bolsa.leer(5, 's1');
  ok('ritmo: dos lecturas con menos de 20 s de separación, no', r.motivo === 'ritmo' && r.items === null && m.pedidos.length === 3, [r, m.pedidos.length]);
  m.reloj += 20000;
  r = await m.bolsa.leer(5, 's1');
  ok('…pasados los 20 s, sí', r.de === 'red' && m.pedidos.length === 4);

  m = mundo();
  for (let i = 0; i < 12; i++) { await m.bolsa.leer(10 + i, 's1'); m.reloj += 60000; }
  r = await m.bolsa.leer(40, 's1');
  ok('ritmo: 12 lecturas en la última hora y ni una más', m.pedidos.length === 12 && r.motivo === 'ritmo', [m.pedidos.length, r]);
  m.reloj += 50 * MIN;
  r = await m.bolsa.leer(40, 's1');
  ok('…a la hora, vuelve', r.de === 'red' && m.pedidos.length === 13);

  m = mundo();
  m.respuesta = { status: 403, texto: '' };
  r = await m.bolsa.leer(2, 's1');
  ok('freno: un 403 apaga las lecturas una hora', r.motivo === 'freno' && r.items === null && m.almacen[B.CLAVES.pausa] === m.reloj + B.PAUSA, [r, m.almacen]);
  ok('…y es el MISMO freno que el de la búsqueda', B.CLAVES.pausa === BUSCADOR.CLAVES.pausa);
  {
    const busc = BUSCADOR.crear({ leer: m.dep.leer, guardar: m.dep.guardar, ahora: m.dep.ahora, pedir: (u) => { m.pedidos.push(u); return Promise.resolve({ status: 200, texto: 'ok' }); },
      leerResultados: () => ({ titulo: 'x', items: [] }) });
    const rb = await busc.buscar('mica iphone 16');
    ok('con la bolsa frenada, la búsqueda tampoco sale', rb.items === null && rb.motivo === 'pausa' && m.pedidos.length === 1, [rb, m.pedidos]);
  }
  m.respuesta = { status: 200, texto: PAGINA };
  m.reloj += 30000;
  r = await m.bolsa.leer(2, 's1');
  ok('durante la pausa no se pide nada', r.motivo === 'pausa' && m.pedidos.length === 1, [r, m.pedidos.length]);
  m.reloj += B.PAUSA + 1;
  r = await m.bolsa.leer(2, 's1');
  ok('pasada la hora, vuelve', r.de === 'red' && m.pedidos.length === 2);

  m = mundo();
  m.respuesta = { status: 200, texto: '<html><head><title>Access Denied</title></head><body>Access Denied</body></html>' };
  r = await m.bolsa.leer(2, 's1');
  ok('una página «Access Denied» también frena', r.motivo === 'freno' && m.almacen[B.CLAVES.pausa] > m.reloj, r);

  m = mundo();
  m.respuesta = () => Promise.reject(new Error('sin red'));
  r = await m.bolsa.leer(2, 's1');
  ok('sin red: no lanza, y frena', r.motivo === 'freno' && r.items === null, r);

  m = mundo();
  m.respuesta = { status: 200, texto: '<html><head><title>Mi Bolsa</title></head><body>otro formato</body></html>' };
  r = await m.bolsa.leer(2, 's1');
  ok('una página buena pero ilegible (cambió el formato) NO es un bloqueo: no frena', r.items === null && r.motivo === 'ilegible' && !m.almacen[B.CLAVES.pausa], [r, m.almacen]);
  m.reloj += 60000;
  r = await m.bolsa.leer(2, 's1');
  ok('…pero no se vuelve a pedir en 15 minutos: 520 KB cada 20 s no', m.pedidos.length === 1 && r.items === null, [m.pedidos.length, r]);

  m = mundo();
  await m.bolsa.leer(3, 's1');
  m.reloj += 16 * MIN;
  m.respuesta = { status: 500, texto: '' };
  r = await m.bolsa.leer(3, 's1');
  ok('si no se puede releer y la cuenta es la misma, sirve lo guardado (cada artículo lleva su hora)', r.motivo === 'freno' && r.items && r.items.length === 3, r);
  m.respuesta = { status: 200, texto: PAGINA };
  m.reloj += B.PAUSA + 1;
  r = await m.bolsa.leer(7, 's1');
  ok('…con otra cuenta, lo guardado ya no sirve', r.de === 'red' && m.pedidos.length === 3);

  m = mundo();
  let soltar;
  m.respuesta = () => new Promise((res) => { soltar = () => res({ status: 200, texto: PAGINA }); });
  const p1 = m.bolsa.leer(3, 's1'), p2 = m.bolsa.leer(3, 's1');
  await new Promise((res) => setTimeout(res, 5));
  soltar();
  const [r1, r2] = await Promise.all([p1, p2]);
  ok('dos lecturas a la vez salen como UNA', m.pedidos.length === 1 && r1 === r2, m.pedidos.length);
  const g = await m.bolsa.guardada();
  ok('guardada(): lo último leído, sin red', g && g.cuenta === 3 && g.items.length === 3 && m.pedidos.length === 1, g);

  seccion('6b · De la misma sesión: la misma cuenta no quiere decir la misma bolsa');
  {
    // Lo destapó la prueba de punta a punta: la ficha de un adaptador tomó la bolsa de la prueba
    // anterior, porque la cabecera decía «1» en las dos. En la operación es otro cliente.
    let w = mundo();
    let x = await w.bolsa.leer(1, 'atencion-27105');
    ok('la primera lectura de una atención va a la red', x.de === 'red' && w.pedidos.length === 1);
    w.reloj += 2 * MIN;
    x = await w.bolsa.leer(1, 'atencion-27105');
    ok('la misma atención, la misma cuenta: de lo guardado', x.de === 'cache' && w.pedidos.length === 1);
    x = await w.bolsa.leer(1, 'atencion-27106');
    ok('OTRA atención con la misma cuenta: lo guardado no vale, se vuelve a leer', x.de === 'red' && w.pedidos.length === 2, [x.de, w.pedidos.length]);
    ok('…y lo guardado queda a nombre de la nueva', w.almacen[B.CLAVES.bolsa].quien === 'atencion-27106');
    w.reloj += 21000;
    w.respuesta = { status: 500, texto: '' };
    x = await w.bolsa.leer(1, 'atencion-27107');
    ok('si no se puede leer la de otra atención, NO se sirve la de la anterior', x.items === null && x.motivo === 'freno', x);

    w = mundo();
    x = await w.bolsa.leer(1, '');
    w.reloj += 2 * MIN;
    x = await w.bolsa.leer(1, '');
    ok('sin huella (no se sabe de quién es): lo guardado vale, pero solo 3 minutos', x.de === 'cache' && w.pedidos.length === 1 && B.VIGENCIA_SIN_HUELLA === 3 * MIN);
    w.reloj += 2 * MIN;
    x = await w.bolsa.leer(1);
    ok('…a los 4 minutos se vuelve a leer', x.de === 'red' && w.pedidos.length === 2, [x, w.pedidos.length]);
    w.reloj += 4 * MIN;
    w.respuesta = { status: 500, texto: '' };
    x = await w.bolsa.leer(1, '');
    ok('…y sin huella no hay respaldo si la lectura falla', x.items === null && x.motivo === 'freno', x);
    w = mundo();
    await w.bolsa.leer(1, 'a');
    x = await w.bolsa.leer(1, '');
    ok('de una sesión con huella a una sin ella, tampoco se reutiliza', x.motivo === 'ritmo' && x.items === null, x);
  }

  seccion('7 · De la página real al consejo: la bolsa de prueba, leída y usada');
  {
    const mm = mundo();
    const leida = await mm.bolsa.leer(3, 's1');
    // La página de prueba se «agregó» el 04/10/2026 a las 17:40 y 17:52 UTC; la bocina, dos días antes.
    const ahora = Date.UTC(2026, 9, 4, 18, 0, 0);
    const mAd = VM.recomendar(ADAPTADOR, {}, null, REGLAS, ahora, { 'mica iPhone 16': BUS['mica iPhone 16'] }, leida.items);
    ok('el adaptador toma el iPhone 16 de la bolsa leída', mAd.bolsa.equipo && mAd.bolsa.equipo.id === '1163567866' && mAd.bolsa.vigentes === 2, mAd.bolsa);
    ok('…no ofrece funda (ya hay una en la bolsa) y sí la mica', !mAd.cruzada.some((x) => x.tipo === 'funda') && mAd.cruzada.some((x) => x.tipo === 'mica') && mAd.bolsa.tipos.join() === 'funda', [mAd.cruzada.map((x) => x.tipo), mAd.bolsa.tipos]);
    ok('…y la bocina de hace dos días no cuenta como de esta llamada', VM.bolsaVigente(leida.items, REGLAS, ahora).every((x) => x.id !== '1184854987'));
  }

  console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
  process.exit(fallos ? 1 : 0);
})();
