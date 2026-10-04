/*
 * Pruebas del lector de «Vende más» (extensión de Chrome 3.0): lo que Liverpool trae en el stream
 * de sus páginas y no pinta (calificación, opiniones, vendedor, existencia, la bolsa).
 *   Ejecutar:  node pruebas/ext_lector.test.js
 *
 * Se carga lector-liverpool.js, el archivo REAL de la extensión, en un contexto aislado. Las
 * páginas de prueba salen de páginas reales de liverpool.com.mx del 04/10/2026:
 *   · ext_lector_ficha_20261004.html     la ficha de la PS5 de 2 TB (1164967618): sus cuatro
 *                                        carruseles, con 6 productos cada uno;
 *   · ext_lector_busqueda_20261004.html  la búsqueda «funda iphone»: sus 12 primeros resultados,
 *                                        los registros del stream y las tarjetas del HTML;
 *   · ext_lector_bolsa_20261004.html     la bolsa con el formato real (el que se vio en la sesión
 *                                        del creador), con artículos y un cliente de MENTIRA.
 * Son los mismos objetos del stream, con menos productos por lista para que pesen poco, vueltos a
 * partir en varios self.__next_f.push. El lector se corrió además contra las 120 páginas enteras
 * que guardó la investigación (documento 18): 118 búsquedas con registros, las 118 con las
 * tarjetas en el mismo orden que los registros.
 *
 * Lo que importa comprobar es lo que NO puede pasar: leer de la bolsa la dirección del cliente,
 * tomar una calificación sin opiniones por buena, o reventar con una página cortada.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const EXT = path.join(__dirname, '..', 'Extencion para chrome');
const leer = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400) : ''));
}
function seccion(t) { console.log('\n' + t); }

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(EXT, 'lector-liverpool.js'), 'utf8'), ctx, { filename: 'lector-liverpool.js' });
const L = ctx.VentelLector;

seccion('0 · El archivo carga y no depende del navegador');
ok('VentelLector existe', !!L && typeof L.streamDe === 'function' && typeof L.bolsaDe === 'function');
{
  const src = fs.readFileSync(path.join(EXT, 'lector-liverpool.js'), 'utf8');
  ok('sin DOM ni chrome.*: solo texto que entra y datos que salen', !/\bdocument\.\w|\bwindow\.\w|\bchrome\.\w|\bfetch\(/.test(src));
  const man = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const lista = (man.content_scripts.find((c) => c.js.indexOf('recomendador.js') > -1) || { js: [] }).js;
  ok('el manifiesto lo carga antes que la tarjeta', lista.indexOf('lector-liverpool.js') > -1 && lista.indexOf('lector-liverpool.js') < lista.indexOf('recomendador.js'), lista);
}

seccion('1 · El stream: trozos de self.__next_f.push que hay que unir en orden');
const ficha = leer('ext_lector_ficha_20261004.html');
const stFicha = L.streamDe(ficha);
ok('une los trozos de la ficha en un solo texto', stFicha.length > 15000 && stFicha.indexOf('"title":"Jewel | Guest | Complementa con"') > -1, stFicha.length);
ok('conserva los saltos de línea de dentro de un trozo', stFicha.indexOf('texto con salto\nde línea "y comillas"') > -1);
ok('los push que no son texto ([0], [2,null]) no estorban', stFicha.indexOf('null') !== 0 && stFicha.indexOf('0:["$"') === 0, stFicha.slice(0, 20));
ok('una página sin stream da cadena vacía', L.streamDe('<html><body>hola</body></html>') === '' && L.streamDe(null) === '' && L.streamDe(undefined) === '');
ok('un push cortado a la mitad no revienta', typeof L.streamDe('<script>self.__next_f.push([1,"a medias') === 'string');

seccion('2 · La ficha: sus carruseles, con lo que Liverpool sabe de cada producto');
const car = L.carruselesDe(stFicha);
ok('los cuatro carruseles de la PS5, por su nombre aunque el título diga «Jewel | Guest | …»',
  ['complementa', 'otros', 'relacionados', 'masVendidos'].every((k) => Array.isArray(car[k]) && car[k].length === 6), Object.keys(car));
{
  const gta = car.complementa.find((p) => p.id === '1118872246');
  ok('«Grand Theft Auto V…»: 4.7 con 56 opiniones, a $569', gta && gta.nombre === 'Grand Theft Auto V estándar para PS5' && gta.cal === 4.7 && gta.nOp === 56 && gta.precio === 569, gta);
  ok('…y no es de marketplace', gta && gta.mkp === false);
  ok('la calificación y las opiniones llegan como texto y salen como número', car.complementa.every((p) => typeof p.nOp === 'number' && (p.cal === null || typeof p.cal === 'number')));
  const sinOp = car.complementa.find((p) => p.nOp === 0);
  ok('sin opiniones, la calificación es null (un 0 no es «cero estrellas»)', !sinOp || sinOp.cal === null, sinOp);
  ok('algún producto de marketplace viene marcado', Object.keys(car).some((k) => car[k].some((p) => p.mkp === true)));
  const mapa = L.calidadDeFicha(stFicha);
  ok('calidadDeFicha: un mapa por id con todo lo de los carruseles', mapa['1118872246'] && mapa['1118872246'].nOp === 56 && Object.keys(mapa).length >= 12, Object.keys(mapa).length);
}
ok('con sesión el título cambia («Jewel | Log in | …», «Jewel | Login in | PDP Vistos recientemente»): se reconoce igual', (() => {
  const s = stFicha.replace(/Jewel \| Guest \| Complementa con/, 'Jewel | Log in | Complementa con').replace(/Jewel \| Guest \| Más vendidos/, 'Jewel | Login in | PDP Vistos recientemente');
  const c = L.carruselesDe(s);
  return c.complementa && c.complementa.length === 6 && c.vistos && c.vistos.length === 6 && !c.masVendidos;
})());
ok('otro bloque con «products» que no es un carrusel conocido se ignora',
  Object.keys(L.carruselesDe('{"title":"Lo nuevo de la semana","variant":"grid","products":[{"productId":"1234567","name":"x"}]}')).length === 0);
ok('un carrusel cortado se salta sin reventar', Object.keys(L.carruselesDe(stFicha.slice(0, stFicha.indexOf('"products":[') + 400))).length === 0);
ok('un producto sin id de Liverpool no entra', L.carruselesDe('{"title":"Jewel | Guest | Complementa con","variant":"slider","products":[{"productId":"abc","name":"x"},{"name":"y"},null,{"productId":"1234567","name":"z","rating":{"average":"9.9","count":"3"}}]}').complementa.length === 1);
ok('…y una calificación fuera de rango se acota a 5', L.carruselesDe('{"title":"Jewel | Guest | Complementa con","variant":"slider","products":[{"productId":"1234567","name":"z","rating":{"average":"9.9","count":"3"}}]}').complementa[0].cal === 5);

seccion('3 · La búsqueda: los resultados, en el orden de Liverpool');
const busq = leer('ext_lector_busqueda_20261004.html');
const recs = L.registrosDe(L.streamDe(busq));
ok('los 12 registros de «funda iphone»', recs.length === 12 && recs[0].id === '1209389220', recs.map((r) => r.id));
{
  // Las tarjetas del HTML, como las lee la tarjeta (enlaces a /pdp/ con <h3>), en su orden.
  const re = /<a\b[^>]*href="([^"]*\/pdp\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g; let m; const ids = [];
  while ((m = re.exec(busq))) { const id = m[1].split('?')[0].split('/').pop(); if (/^\d{6,}$/.test(id) && /<h3/.test(m[2]) && ids.indexOf(id) < 0) ids.push(id); }
  ok('las tarjetas del HTML vienen en el mismo orden que los registros', ids.length === 12 && ids.every((id, i) => recs[i].id === id), ids);
}
ok('cada registro dice si es patrocinado, si es de marketplace y si hay existencia en línea',
  recs.every((r) => typeof r.patroc === 'boolean' && typeof r.mkp === 'boolean' && r.online === true), recs[0]);
ok('unos con opiniones y otros sin ellas (cal null)', recs.some((r) => r.nOp > 0 && r.cal > 0) && recs.some((r) => r.nOp === 0 && r.cal === null));
ok('no guarda la lista de tiendas: solo si «online» está', recs.every((r) => !('geoStoreIds' in r)));
{
  const sinOnline = L.registrosDe('x:{"records":[{"productId":"1234567","geoStoreIds":["88","89"]},{"productId":"7654321","geoStoreIds":[]},{"productId":"1111111"},{"productId":"2222222","geoStoreIds":["online"],"featureFlags":{"isSponsoredRecord":true,"isMarketPlace":true}}]}');
  ok('con tiendas y sin «online»: no hay existencia en línea (false)', sinOnline[0].online === false, sinOnline[0]);
  ok('sin lista de tiendas no se concluye nada (null)', sinOnline[1].online === null && sinOnline[2].online === null, sinOnline);
  ok('patrocinado y marketplace, tal cual', sinOnline[3].patroc === true && sinOnline[3].mkp === true && sinOnline[3].online === true, sinOnline[3]);
}
ok('una página sin resultados da lista vacía', L.registrosDe(L.streamDe('<html><script>self.__next_f.push([1,"0:[]\\n"])</script></html>')).length === 0 && L.registrosDe('').length === 0);
{
  const items = [{ id: '1209389220', nombre: 'Funda iPhone 18 Pro Max de silicón', precio: 999 }, { id: 'no-esta', nombre: 'Otro' },
    { id: recs.find((r) => r.nOp > 0).id, nombre: 'Con opiniones', nOp: 999 }];
  const ricos = L.enriquecer(items, L.calidadDeBusqueda(L.streamDe(busq)));
  ok('enriquecer: suma a cada tarjeta lo que sabe el stream', ricos[0].mkp === false && ricos[0].nOp === 0 && ricos[0].online === true && ricos[0].precio === 999, ricos[0]);
  ok('…deja igual la que no encuentra', ricos[1] === items[1]);
  ok('…y no pisa lo que la tarjeta ya traía', ricos[2].nOp === 999, ricos[2]);
  ok('…sin mapa, devuelve la lista tal cual', L.enriquecer(items, null) === items && L.enriquecer(null, {}).length === 0);
}

seccion('4 · La bolsa: qué lleva ya el cliente (y nada más)');
const bolsaHtml = leer('ext_lector_bolsa_20261004.html');
const bolsa = L.bolsaDe(L.streamDe(bolsaHtml));
ok('los tres artículos, con su id, su SKU, su nombre y su marca',
  bolsa && bolsa.length === 3 && bolsa[0].id === '1163567866' && bolsa[0].sku === '1163058495' && bolsa[0].marca === 'APPLE' && bolsa[0].nombre === 'iPhone 16 6.1 pulgadas Super Retina XDR', bolsa);
ok('el precio en pesos y la cantidad', bolsa && bolsa[0].precio === 17499 && bolsa[1].precio === 1099 && bolsa[1].cantidad === 2, bolsa && bolsa[1]);
ok('la hora en que se agregó: «2026-10-04 17:40:10.000Z» (con espacio) es una fecha', bolsa && bolsa[0].agregado === Date.UTC(2026, 9, 4, 17, 40, 10), bolsa && bolsa[0].agregado);
ok('un nombre con comillas no parte la lectura', bolsa && bolsa[1].nombre === 'Funda para iPhone 16 de silicón "MagSafe"', bolsa && bolsa[1].nombre);
ok('dice si sigue en existencia', bolsa && bolsa[0].enExistencia === true && bolsa[2].enExistencia === false);
{
  const todo = JSON.stringify(bolsa);
  ok('NADA del cliente: ni nombre, ni calle, ni teléfono, ni correo, ni el total', !/CLIENTE DE PRUEBA|NO LEER|CALLE FALSA|5500000000|example\.com|26297|00000000-0000/.test(todo), todo);
  ok('…y la página de prueba sí los traía (la prueba tiene dientes)', /CALLE FALSA 123/.test(L.streamDe(bolsaHtml)));
  ok('cada artículo trae solo los ocho campos que usa la tarjeta', bolsa.every((a) => Object.keys(a).sort().join() === 'agregado,cantidad,enExistencia,id,marca,nombre,precio,sku'), Object.keys(bolsa[0]));
}
ok('bolsa vacía: lista vacía', JSON.stringify(L.bolsaDe('1a7:["$","$L1a7",null,{"cart":{"id":"1","brand":"LP","lineItems":[]}}]')) === '[]');
ok('una página que no es la bolsa: null (no se concluye que esté vacía)', L.bolsaDe(stFicha) === null && L.bolsaDe('') === null && L.bolsaDe('<html>Access Denied</html>') === null);
ok('una bolsa cortada a la mitad: null, sin reventar', L.bolsaDe(L.streamDe(bolsaHtml).slice(0, 900)) === null);
ok('sin fecha de alta, `agregado` es null (el núcleo no la contará como reciente)',
  L.bolsaDe('{"cart":{"lineItems":[{"productId":"1234567","productName":"x","addedAt":null},{"productId":"7654321","productName":"y","addedAt":"ayer"}]}}').every((a) => a.agregado === null));
ok('fecha: también con T, y lo que no es fecha es null', L.fecha('2026-10-04T17:40:10.000Z') === Date.UTC(2026, 9, 4, 17, 40, 10) && L.fecha('') === null && L.fecha(12) === null);

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
