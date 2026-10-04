/*
 * Pruebas de «Vende más con este artículo» (extensión de Chrome 2.6): el núcleo de decisiones,
 * con los archivos REALES de la extensión y fichas REALES de liverpool.com.mx.
 *   Ejecutar:  node pruebas/ext_recomendador.test.js
 *
 * Se cargan reglas-venta.js y recomendador-nucleo.js en un contexto aislado, igual que los ve el
 * content script. Las fichas (ext_recomendador_fichas_20261003.json) son las que leyó la propia
 * extensión el 03/10/2026: el iPhone 16, con fundas de otros teléfonos en «Complementa con», y el
 * protector solar ISDIN del mensaje del equipo de venta cruzada.
 *
 * Lo que importa comprobar es lo que NO puede pasar: ofrecer una funda que no le queda, un
 * segundo teléfono como «complemento», la misma capacidad como «subida», un sustituto disfrazado
 * de búsqueda, o una promoción vencida en la frase de apertura.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const EXT = path.join(__dirname, '..', 'Extencion para chrome');
const FICHAS = JSON.parse(fs.readFileSync(path.join(__dirname, 'ext_recomendador_fichas_20261003.json'), 'utf8'));

let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400) : ''));
}
function seccion(t) { console.log('\n' + t); }

const ctx = vm.createContext({ console });
['reglas-venta.js', 'recomendador-nucleo.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), ctx, { filename: f });
});
const VM = ctx.VentelVM;
const REGLAS = ctx.VENTEL_REGLAS;
const copia = (o) => JSON.parse(JSON.stringify(o));
const ids = (l) => l.map((x) => x.id);
const AHORA = new Date(2026, 9, 4, 12, 0, 0).getTime();
const DIA = 86400000;

seccion('0 · Los archivos de la extensión cargan y se entienden');
ok('VentelVM y VENTEL_REGLAS existen', !!VM && !!REGLAS && Array.isArray(REGLAS.clases));
['recomendador.js', 'campana-puente.js', 'fondo.js'].forEach((f) => {
  const ruta = path.join(EXT, f);
  if (!fs.existsSync(ruta)) return;
  let error = null;
  try { new vm.Script(fs.readFileSync(ruta, 'utf8'), { filename: f }); } catch (e) { error = e.message; }
  ok(f + ' tiene sintaxis válida', !error, error);
});
ok('ninguna regla de tipo trae la bandera g (lastIndex rompería el .exec)',
  REGLAS.clases.every((c) => c.complementos.every((k) => !k.palabras.global)));
{
  const man = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const lista = (man.content_scripts.find((c) => c.js.indexOf('recomendador.js') > -1) || { js: [] }).js;
  ok('GSAP se carga ANTES de la tarjeta, en el mismo grupo (mismo mundo aislado)',
    lista.indexOf('vendor/gsap.min.js') > -1 && lista.indexOf('vendor/gsap.min.js') < lista.indexOf('recomendador.js'), lista);
  const g = fs.readFileSync(path.join(EXT, 'vendor', 'gsap.min.js'), 'utf8');
  ok('vendor/gsap.min.js es GSAP 3.15.0 tal cual (la versión del deck del Reto)', /^\/\*!\s*\n?\s*\* GSAP 3\.15\.0/.test(g) && g.length > 70000, g.slice(0, 40));
  const tarjeta = fs.readFileSync(path.join(EXT, 'recomendador.js'), 'utf8');
  ok('la tarjeta ya no tiene frase ni botón de copiar (2.8)', !/Copiar frase|data-accion="copiar"|clipboard/.test(tarjeta));
  ok('nada que anime GSAP lleva transition-all (memoria «gsap-contenido-invisible»)', !/transition:\s*all/.test(tarjeta));
}

seccion('1 · Utilidades');
ok('pesos sin centavos', VM.pesos(17499) === '$17,499', VM.pesos(17499));
ok('pesos con centavos', VM.pesos(24398.85) === '$24,398.85', VM.pesos(24398.85));
ok('norm quita acentos y mayúsculas', VM.norm('  Sérum  ANTIEDAD ') === 'serum antiedad');
ok('bonito escribe iPhone', VM.bonito('mica iphone 16') === 'Mica iPhone 16', VM.bonito('mica iphone 16'));
ok('…también al principio: «iPhone 16», no «IPhone 16» (la cabecera sin «Modelo comercial»)',
  VM.bonito('iphone 16') === 'iPhone 16' && VM.bonito('ipad air 11') === 'iPad air 11' && VM.bonito('galaxy a56') === 'Galaxy A56', [VM.bonito('iphone 16'), VM.bonito('ipad air 11')]);

seccion('2 · Modelos y familias de equipo');
const modelos = [
  ['iPhone 16 6.1 pulgadas Super Retina XDR', 'iphone 16'],
  ['Funda para iPhone17e de silicón', 'iphone 17e'],
  ['Funda para iPhone 16 Pro Max', 'iphone 16 pro max'],
  ['Funda para iPhone 17 Air de plástico', 'iphone 17 air'],
  ['Galaxy S25 Ultra 5G', 'galaxy s25 ultra'],
  ['Moto G15 4G', 'moto g15'],
  ['Funda para Pixel 10 / Pixel 10 Pro', 'pixel 10'],
  ['Funda para iPhone', null],
  ['Funda para tablet Samsung Galaxy Tab A11+ X230', null]
];
modelos.forEach(([t, esperado]) => ok('modelo de «' + t + '» = ' + esperado, VM.modeloDe(t) === esperado, VM.modeloDe(t)));
ok('familias de «Funda para Samsung»', JSON.stringify(VM.familiasDe('Funda para Samsung')) === '["samsung"]');
ok('la marca GOOGLE cuenta como familia pixel', VM.familiasDe('Cargador inalámbrico GOOGLE').indexOf('pixel') > -1);

seccion('3 · Tipo de complemento: decide el sustantivo, no cualquier palabra');
const facial = REGLAS.clases.find((c) => c.id === 'cuidadoFacial');
const celular = REGLAS.clases.find((c) => c.id === 'smartphone');
ok('«Labial brillante Sérum Rose» NO es un sérum', VM.tipoDe({ nombre: 'Labial brillante Sérum Rose Perfecto Shine' }, facial).conocido === false);
ok('«Sérum antiedad» es sérum', VM.tipoDe({ nombre: 'Sérum antiedad Isdinceutics' }, facial).tipo === 'serum');
ok('«Protector solar FPS 50…» es solar', VM.tipoDe({ nombre: 'Protector solar FPS 50 Fotoprotector' }, facial).tipo === 'solar');
ok('«Adaptador de corriente» es cargador', VM.tipoDe({ nombre: 'Adaptador de corriente' }, celular).tipo === 'cargador');
ok('«Funda para localizador Airtag» es funda', VM.tipoDe({ nombre: 'Funda para localizador Airtag' }, celular).tipo === 'funda');

seccion('4 · iPhone 16 (ficha real, sin capacidad elegida)');
const ip = FICHAS.iphone16;
const mIp = VM.recomendar(copia(ip.ficha), copia(ip.carruseles), null, REGLAS, AHORA);
ok('clase: celular', mIp.clase && mIp.clase.id === 'smartphone', mIp.clase);
ok('modelo para las búsquedas: «iPhone 16»', mIp.modelo === 'iPhone 16', mIp.modelo);
ok('precio base: el de 128 GB', mIp.precioBase === 17499, mIp.precioBase);
const cap = mIp.incremental.capacidad;
ok('sube a 512 GB', cap && cap.talla === '512 GB' && cap.desde === '128 GB', cap);
ok('diferencia +$6,899.85', cap && cap.dif === 6899.85, cap && cap.dif);
ok('al mes: $431.24 a 16 MSI', cap && cap.mensual && cap.mensual.meses === 16 && cap.mensual.monto === 431.24, cap && cap.mensual);
ok('dice que 512 GB solo hay en Azul y Verde', cap && !cap.todosLosColores && cap.colores.join('/') === 'Azul/Verde', cap && cap.colores);
ok('siguiente modelo: iPhone 16 Plus (+$1,500.05)',
  mIp.incremental.modelo && mIp.incremental.modelo.id === '1163569672' && mIp.incremental.modelo.dif === 1500.05, mIp.incremental.modelo);
ok('venta cruzada: funda del 16, adaptador Apple y batería, en ese orden',
  JSON.stringify(ids(mIp.cruzada)) === JSON.stringify(['1163592828', '1110262147', '99986989537']), mIp.cruzada.map((r) => r.nombre));
ok('la primera es del mismo modelo', mIp.cruzada[0] && mIp.cruzada[0].compat === 'exacto');
ok('un tipo por lugar (sin dos fundas ni dos cargadores)', new Set(mIp.cruzada.map((r) => r.tipo)).size === mIp.cruzada.length);
const prohibidos = ['1197754891', '1195660359', '99995890466', '1180951217', '1191831126', '1112379882', '1183144991',
  '1165549909', '1178353973', '1162648701', '999680760756', '1163567866', '1199595847', '999680126976', '1178391336'];
const coladas = mIp.cruzada.filter((r) => prohibidos.indexOf(r.id) > -1).map((r) => r.nombre);
ok('ninguna funda de otro modelo, ningún teléfono, ni el propio artículo', !coladas.length, coladas);
ok('búsqueda sugerida: «mica iPhone 16» (Liverpool no trajo mica)',
  mIp.sugeridas.length === 1 && mIp.sugeridas[0].consulta === 'mica iPhone 16', mIp.sugeridas);
ok('ofrece Liverpool Care', mIp.servicio === true);
ok('sin paquete de promociones: lo dice', mIp.promos.hay === false && mIp.promos.ficha === null && mIp.promos.fuerte === null);

seccion('5 · iPhone 16 abierto en 512 GB por su enlace (?skuid=)');
const f512 = Object.assign(copia(ip.ficha), { varianteActual: '1163058509', skuUrl: '1163058509', seleccion: { color: 'Azul', talla: null, completa: false } });
const m512 = VM.recomendar(f512, copia(ip.carruseles), null, REGLAS, AHORA);
ok('el ?skuid= cuenta como elegido: base $24,398.85', m512.precioBase === 24398.85, m512.precioBase);
ok('no vuelve a ofrecer 512 GB', m512.incremental.capacidad === null, m512.incremental.capacidad);
ok('sube al escalón más cercano: iPhone Air', m512.incremental.modelo && m512.incremental.modelo.id === '1186186230', m512.incremental.modelo);

seccion('6 · Protector solar ISDIN (ficha real)');
const ps = FICHAS.protectorSolar;
const mPs = VM.recomendar(copia(ps.ficha), copia(ps.carruseles), null, REGLAS, AHORA);
ok('clase: cuidado facial', mPs.clase && mPs.clase.id === 'cuidadoFacial', mPs.clase);
ok('sin subida de capacidad (una sola variante)', mPs.incremental.capacidad === null);
ok('sin subida de modelo (nada de ISDIN dentro del 25 %)', mPs.incremental.modelo === null, mPs.incremental.modelo);
ok('venta cruzada: el sérum y la crema de ISDIN primero',
  mPs.cruzada.length >= 2 && mPs.cruzada[0].id === '1139728676' && mPs.cruzada[1].id === '1009176981', mPs.cruzada.map((r) => r.nombre));
{
  const a56 = { id: '9', nombre: 'Galaxy A56 Super AMOLED 6.7 pulgadas', marca: 'SAMSUNG', migas: ['Samsung', 'Celulares'], producto: 'Smartphone', modeloComercial: 'Galaxy A56', variantes: [] };
  const mA = VM.recomendar(a56, { complementa: [
    { id: '1', marca: 'SAMSUNG', nombre: 'Mica para smartphone Galaxy de pet', precio: 119 },
    { id: '2', marca: 'TEKNET', nombre: 'Funda para Galaxy A56 de silicón', precio: 359 }] }, null, REGLAS, AHORA);
  ok('una mica «Galaxy» sin modelo no se ofrece (puede no ser de su medida): queda la búsqueda',
    !mA.cruzada.some((r) => r.id === '1') && mA.sugeridas.some((s) => s.consulta === 'mica Galaxy A56'), [mA.cruzada, mA.sugeridas]);
  ok('la funda del A56 sí, exacta', mA.cruzada.some((r) => r.id === '2' && r.compat === 'exacto'));
  const honor = { id: '8', nombre: 'Smartphone Honor 400 Lite AMOLED 6.7 pulgadas', marca: 'HONOR', migas: ['Celulares'], producto: 'Smartphone', modeloComercial: 'Honor 400 Lite', variantes: [] };
  const mH = VM.recomendar(honor, { complementa: [{ id: '3', marca: 'GENERICA', nombre: 'Funda para Honor 400 Lite de TPU', precio: 299 }] }, null, REGLAS, AHORA);
  ok('una marca cuyo modelo no se sabe leer: su «Modelo comercial» basta para la funda exacta', mH.cruzada.some((r) => r.id === '3' && r.compat === 'exacto'), mH.cruzada);
  const h400 = { id: '18', nombre: 'Smartphone Honor 400 AMOLED 6.5 pulgadas', marca: 'HONOR', migas: ['Celulares'], producto: 'Smartphone', modeloComercial: 'Honor 400', variantes: [] };
  const mH4 = VM.recomendar(h400, { complementa: [
    { id: '3', marca: 'GENERICA', nombre: 'Funda para Honor 400 Lite de TPU', precio: 299 },
    { id: '13', marca: 'GENERICA', nombre: 'Funda para Honor 4000 de TPU', precio: 299 },
    { id: '23', marca: 'GENERICA', nombre: 'Funda para Honor 400 5G de silicón', precio: 299 }] }, null, REGLAS, AHORA);
  ok('«Honor 400» no es «Honor 400 Lite» ni «Honor 4000»: queda la del 400 (con su 5G)',
    mH4.cruzada.filter((r) => r.tipo === 'funda').map((r) => r.id).join() === '23', mH4.cruzada);
  const a57 = { id: '6', nombre: 'Galaxy A57 Super AMOLED plus 6.7 pulgadas', marca: 'SAMSUNG', migas: ['Samsung', 'Celulares'], producto: 'Smartphone', modeloComercial: 'Galaxy A57', variantes: [] };
  const fundaA57 = { id: '1197734147', marca: 'SAMSUNG', nombre: 'Funda para Galaxy A57 de policarbonato', precio: 209.6 };
  const m57 = VM.recomendar(a57, { relacionados: [fundaA57, { id: '5', marca: 'SAMSUNG', nombre: 'Galaxy A37 Super AMOLED 6.7 pulgadas', precio: 6199 }] },
    null, REGLAS, AHORA, { 'funda Galaxy A57': [fundaA57] });
  ok('la funda exacta que Liverpool también pone en «Artículos relacionados» no queda vetada', m57.cruzada.some((r) => r.id === fundaA57.id && r.compat === 'exacto'), m57.cruzada);
  const sinClase = { id: '4', nombre: 'Artículo sin clase', marca: 'ZARA', migas: ['Accesorios'], variantes: [] };
  const mB = VM.recomendar(sinClase,
    { complementa: [{ id: '31', marca: 'X', nombre: 'Artículo parecido', precio: 300 }], relacionados: [{ id: '31', marca: 'X', nombre: 'Artículo parecido', precio: 300 }] }, null, REGLAS, AHORA);
  ok('sin clase reconocida, lo que también está en «Artículos relacionados» sigue fuera', !mB.cruzada.some((r) => r.id === '31'), mB.cruzada);
  const sinModelo = { id: '7', nombre: 'Smartphone Honor AMOLED 6.7 pulgadas', marca: 'HONOR', migas: ['Celulares'], producto: 'Smartphone', variantes: [] };
  const mS = VM.recomendar(sinModelo, { complementa: [{ id: '4', marca: 'HONOR', nombre: 'Funda Honor transparente', precio: 249 }] }, null, REGLAS, AHORA);
  ok('sin saber el modelo del equipo, la funda de su marca se sigue ofreciendo', mS.cruzada.some((r) => r.id === '4' && r.compat === 'marca'), mS.cruzada);
}
ok('ningún protector o bloqueador solar como «complemento»', !mPs.cruzada.some((r) => /protector solar|bloqueador/i.test(r.nombre)));
ok('ni el labial ni el aceite capilar (tipos que la regla no conoce)',
  !mPs.cruzada.some((r) => ['1174570027', '1159294591'].indexOf(r.id) > -1), mPs.cruzada.map((r) => r.nombre));
ok('el tercer lugar es otro tipo facial que la regla conoce (el tónico)',
  mPs.cruzada.length === 3 && mPs.cruzada[2].tipo === 'tonico', mPs.cruzada.map((r) => r.tipo + ' ' + r.nombre));
ok('la búsqueda llena el hueco con un tipo que sí le va',
  JSON.stringify(mPs.sugeridas.map((s) => s.consulta)) === JSON.stringify(['limpiador facial Isdin']), mPs.sugeridas);
ok('nunca sugiere buscar otro protector solar', !mPs.sugeridas.some((s) => /solar/.test(s.consulta)));
ok('Liverpool Care no aplica a cuidado facial aunque la ficha traiga la póliza', mPs.servicio === false);

seccion('7 · Pantallas, consolas y ropa (casos armados)');
const tv = {
  id: '1', nombre: 'Pantalla Smart TV Samsung QLED de 55 pulgadas 4K', marca: 'SAMSUNG', migas: ['Electrónica', 'Televisiones y pantallas'],
  producto: 'Pantalla', modeloComercial: null, precio: 12000, esRango: false, varianteActual: '1', variantes: [], seleccion: null, care: false
};
const mTv = VM.recomendar(tv, { complementa: [
  { id: '10', marca: 'GROUND', nombre: 'Soporte de pared articulado 13 - 27 pulgadas', precio: 279 },
  { id: '11', marca: 'MITZU', nombre: 'Soporte de pared fijo 32 a 84 pulgadas', precio: 471 },
  { id: '12', marca: 'SAMSUNG', nombre: 'Barra de sonido HW-B450', precio: 3999 },
  { id: '13', marca: 'LG', nombre: 'Pantalla Smart TV LG 50 pulgadas', precio: 9000 }
] }, null, REGLAS, AHORA);
ok('clase: pantallas', mTv.clase && mTv.clase.id === 'tv');
ok('el soporte de 13-27" no se ofrece a una de 55"', !mTv.cruzada.some((r) => r.id === '10'));
ok('el de 32-84" sí, como compatible exacto', mTv.cruzada[0] && mTv.cruzada[0].id === '11' && mTv.cruzada[0].compat === 'exacto', mTv.cruzada);
ok('otra pantalla no es complemento', !mTv.cruzada.some((r) => r.id === '13'));
ok('la búsqueda de regulador no necesita pulgadas', mTv.sugeridas.some((s) => s.consulta === 'regulador de voltaje'), mTv.sugeridas);

const ps5 = {
  id: '2', nombre: 'Consola PlayStation 5 Slim 1 TB', marca: 'SONY', migas: ['Videojuegos', 'Consolas'], producto: 'Consola',
  precio: 11000, esRango: false, varianteActual: '2', variantes: [], care: true
};
const mPs5 = VM.recomendar(ps5, { complementa: [
  { id: '20', marca: 'MICROSOFT', nombre: 'Control inalámbrico Xbox Series X', precio: 1399 },
  { id: '21', marca: 'SONY', nombre: 'Control inalámbrico DualSense PS5', precio: 1599 }
] }, null, REGLAS, AHORA);
ok('consola PS5: el control de Xbox no pasa, el DualSense sí', mPs5.cruzada.length === 1 && mPs5.cruzada[0].id === '21', mPs5.cruzada);

const playera = {
  id: '3', nombre: 'Playera manga corta para hombre', marca: 'NIKE', migas: ['Hombre', 'Playeras'], esRango: false,
  varianteActual: 'a', variantes: [
    { sku: 'a', size: 'M', color: 'Negro', price: 499, inStock: true },
    { sku: 'b', size: 'XL', color: 'Negro', price: 549, inStock: true }
  ]
};
ok('una talla de ropa no es «sube la versión»', VM.subidaCapacidad(playera) === null);
const perfume = {
  id: '4', nombre: 'Perfume Good Girl Eau de Parfum', marca: 'CAROLINA HERRERA', migas: ['Perfumes'], esRango: false,
  varianteActual: 'p50', skuUrl: null, seleccion: { talla: '50 ml' }, variantes: [
    { sku: 'p50', size: '50 ml', price: 2100, inStock: true, paymentPlans: [] },
    { sku: 'p80', size: '80 ml', price: 2650, inStock: true, paymentPlans: [] },
    { sku: 'p150', size: '150 ml', price: 3600, inStock: true, paymentPlans: [] }
  ]
};
const capP = VM.subidaCapacidad(perfume);
ok('perfume: sube al escalón inmediato (80 ml), no al más grande', capP && capP.talla === '80 ml' && capP.dif === 550, capP);
ok('sin meses sin intereses, no inventa mensualidad', capP && capP.mensual === null);

seccion('8 · Tope de la subida a otro modelo');
const base = { id: '5', nombre: 'Licuadora de 10 velocidades', marca: 'OSTER', migas: ['Licuadoras'], precio: 1000, esRango: false, varianteActual: null, variantes: [] };
const relac = [
  { id: 'r1', marca: 'OSTER', nombre: 'Licuadora de 12 velocidades', precio: 1300 },
  { id: 'r2', marca: 'OSTER', nombre: 'Licuadora de 16 velocidades', precio: 1200 },
  { id: 'r3', marca: 'TAURUS', nombre: 'Licuadora de 12 velocidades', precio: 1100 }
];
const sub = VM.subidaModelo(relac, VM.contexto(base, REGLAS), REGLAS);
ok('dentro del 25 % y de la misma marca: la de $1,200', sub && sub.id === 'r2', sub);
const subAlto = VM.subidaModelo([{ id: 'x', marca: 'OSTER', nombre: 'Licuadora Pro', precio: 13300 }],
  VM.contexto(Object.assign({}, base, { precio: 10000 }), REGLAS), REGLAS);
ok('en ticket alto el tope es 35 %', subAlto && subAlto.id === 'x' && subAlto.tope === 0.35, subAlto);

seccion('9 · Promociones del Monitor');
const paquete = {
  v: 1, generado: AHORA - 3 * 3600000,
  fuerte: { d: 'Mujer', c: 'Bolsas', t: 'Hasta 58% de descuento', p: 58, m: 0, f: AHORA + 2 * DIA },
  promos: [
    { d: 'Mujer', c: 'Bolsas', t: 'Hasta 58% de descuento', p: 58, m: 0, f: AHORA + 2 * DIA },
    { d: 'Mujer', c: 'Vestidos', t: 'Hasta 50% de descuento', p: 50, m: 0, f: AHORA + 2 * DIA },
    { d: 'Hogar', c: 'Línea blanca', t: 'Hasta 55% de descuento + 13 MSI', p: 55, m: 13, f: AHORA + 3 * DIA },
    { d: 'Electrónica', c: 'Celulares', t: 'Hasta 20% y hasta 18 MSI', p: 20, m: 18, f: AHORA + 5 * DIA },
    { d: 'Electrónica', c: 'Pantallas', t: 'Hasta 40% de descuento', p: 40, m: 0, f: AHORA - DIA },
    { d: 'Belleza', c: 'Cuidado facial', t: 'Hasta 30% de descuento', p: 30, m: 0, f: AHORA + 4 * DIA }
  ]
};
const fuerte = VM.promoMasFuerte(paquete, AHORA);
ok('la más fuerte es la que marcó el Portal', fuerte && fuerte.c === 'Bolsas' && fuerte.p === 58, fuerte);
const vencida = Object.assign(copia(paquete), { fuerte: Object.assign({}, paquete.fuerte, { f: AHORA - 1 }) });
vencida.promos[0].f = AHORA - 1;
const fuerteV = VM.promoMasFuerte(vencida, AHORA);
ok('si la marcada ya venció, la de mayor porcentaje entre las vigentes', fuerteV && fuerteV.c === 'Línea blanca' && fuerteV.p === 55, fuerteV);
ok('sin marca del Portal y con empate, la primera de la hoja',
  (VM.promoMasFuerte({ promos: [{ d: 'A', c: 'Uno', t: 'Hasta 30%', p: 30 }, { d: 'B', c: 'Dos', t: 'Hasta 30%', p: 30 }] }, AHORA) || {}).c === 'Uno');
ok('sin porcentajes, no hay «más fuerte»', VM.promoMasFuerte({ promos: [{ d: 'Hogar', t: '13 MSI', p: 0, m: 13 }] }, AHORA) === null);
ok('el núcleo ya no arma la frase para copiar (2.8)', typeof VM.fraseApertura === 'undefined');

const mIpP = VM.recomendar(copia(ip.ficha), copia(ip.carruseles), paquete, REGLAS, AHORA);
ok('iPhone: la promo de su categoría (Celulares)', mIpP.promos.ficha && mIpP.promos.ficha.por === 'categoria' && mIpP.promos.ficha.promo.c === 'Celulares', mIpP.promos.ficha);
const mPsP = VM.recomendar(copia(ps.ficha), copia(ps.carruseles), paquete, REGLAS, AHORA);
ok('protector solar: «Cuidado facial» casa con sus migas', mPsP.promos.ficha && mPsP.promos.ficha.promo.c === 'Cuidado facial', mPsP.promos.ficha);
const mTvP = VM.recomendar(tv, {}, paquete, REGLAS, AHORA);
ok('pantalla: la de Pantallas venció ayer, así que cae a la dirección Electrónica',
  mTvP.promos.ficha && mTvP.promos.ficha.por === 'direccion' && mTvP.promos.ficha.promo.c === 'Celulares', mTvP.promos.ficha);
ok('las horas del paquete se calculan', Math.abs(mIpP.promos.horas - 3) < 0.01, mIpP.promos.horas);
ok('iPhone: además de la de Celulares, la más fuerte del Monitor (Bolsas), sin marcarlas como la misma',
  mIpP.promos.fuerte && mIpP.promos.fuerte.c === 'Bolsas' && mIpP.promos.mismaQueFicha === false, mIpP.promos);
const bolsa = { id: '77', nombre: 'Bolsa de mano tote para mujer', marca: 'GUESS', migas: ['Mujer', 'Bolsas'], variantes: [] };
const mBo = VM.recomendar(bolsa, {}, paquete, REGLAS, AHORA);
ok('en una bolsa, la de su categoría ES la más fuerte: se dice una vez',
  mBo.promos.ficha && mBo.promos.ficha.promo.c === 'Bolsas' && mBo.promos.mismaQueFicha === true, mBo.promos);

seccion('10 · Nada revienta con datos pobres');
let error = null, vacio = null;
try { vacio = VM.recomendar({ id: '9', nombre: 'Algo sin migas', marca: '' }, {}, null, REGLAS, AHORA); } catch (e) { error = e.message; }
ok('ficha mínima, sin carruseles ni promociones', !error && vacio && vacio.cruzada.length === 0 && vacio.incremental.capacidad === null, error || vacio);
error = null;
try { VM.recomendar({ id: '9', nombre: 'iPhone 16' }, { complementa: [{}, null, { id: '1' }] }, { promos: [null, {}] }, REGLAS, AHORA); } catch (e) { error = e.message; }
ok('candidatos y promociones rotos se ignoran', !error, error);

seccion('12 · Lo que falló al medir 15 categorías el 03/10/2026 (fichas reales, casos recortados)');
const BUS = JSON.parse(fs.readFileSync(path.join(__dirname, 'ext_busquedas_20261003.json'), 'utf8'));
const fichaDe = (o) => Object.assign({ id: '1', migas: [], producto: null, modeloComercial: null, precio: null, esRango: false,
  varianteActual: null, skuUrl: null, seleccion: null, variantes: [], colores: [], care: false }, o);
const it = (id, marca, nombre, precio) => ({ id: String(id), marca, nombre, precio: precio == null ? 500 : precio });
{
  const laptop = fichaDe({ nombre: 'Laptop 15-fd0161la 15.6 pulgadas Full HD Intel Core i5', marca: 'HP', migas: ['Electrónica', 'Computación', 'Laptops'], producto: 'Laptop', precio: 11999,
    variantes: [{ sku: '1', price: 11999, inStock: true }], varianteActual: '1' });
  const m = VM.recomendar(laptop, { complementa: [
    it(10, 'APPLE', 'iPhone 16 6.1 pulgadas Super Retina XDR', 17499),
    it(11, 'HP', 'Mouse inalámbrico 400 silencioso AZ7B2AA', 399),
    it(12, 'XIAOMI', 'Funda para tablet Xiaomi Pad 6 y Pad 6 Pro de 11 pulgadas', 499),
    it(13, 'KINGSTON', 'Memoria Micro SD capacidad 512 GB', 899)
  ] }, null, REGLAS, AHORA);
  ok('laptop: el mouse sí', m.cruzada.some((r) => r.id === '11'), m.cruzada.map((r) => r.nombre));
  ok('laptop: una funda de tablet NO es su mochila', !m.cruzada.some((r) => r.id === '12'));
  ok('laptop: una micro SD NO es un disco externo', !m.cruzada.some((r) => r.id === '13'));
  ok('laptop: busca la mochila (para 15 pulgadas) y el disco', JSON.stringify(m.busquedas.map((b) => b.consulta)) ===
    JSON.stringify(['mochila para laptop 15 pulgadas', 'disco duro externo']), m.busquedas);
  const m2 = VM.recomendar(laptop, { complementa: [it(11, 'HP', 'Mouse inalámbrico 400 silencioso AZ7B2AA', 399)] }, null, REGLAS, AHORA,
    { 'mochila para laptop 15 pulgadas': BUS['mochila para laptop 15 pulgadas'] });
  const moch = m2.cruzada.find((r) => r.tipo === 'mochila');
  ok('laptop: con la búsqueda, una mochila CON portalaptop (la «escolar» no dice laptop)', moch && moch.id === '1168658720' && moch.origen === 'busqueda', m2.cruzada);
}
{
  const lav = fichaDe({ nombre: 'Lavadora Kit Limpieza 25 KG automática carga superior LMP752', marca: 'MABE', migas: ['Mabe', 'Lavado y Secado'], producto: 'Lavadora', precio: 12000,
    variantes: [{ sku: '1', price: 12000, inStock: true }], varianteActual: '1' });
  const m = VM.recomendar(lav, { complementa: [
    it(20, 'MABE', 'Combo lavadora + secadora 23 kg automática carga frontal', 30000),
    it(21, 'GENÉRICA', 'Funda secadora compatible con Whirlpool 17-24 kg', 400),
    it(22, 'WHIRLPOOL', 'Pedestal Plata XHPC155YC', 3000)
  ] }, null, REGLAS, AHORA);
  ok('lavadora: clase propia (no «línea blanca» revuelta)', m.clase && m.clase.id === 'lavadora', m.clase);
  ok('lavadora: el combo lavadora + secadora es un sustituto, no un complemento', !m.cruzada.some((r) => r.id === '20'));
  ok('lavadora: una funda de secadora no es la secadora', !m.cruzada.some((r) => r.id === '21'));
  ok('lavadora: el pedestal de OTRA marca no se ofrece', !m.cruzada.some((r) => r.id === '22'));
  ok('lavadora: busca su secadora Mabe y el regulador', JSON.stringify(m.busquedas.map((b) => b.consulta)) ===
    JSON.stringify(['secadora Mabe', 'regulador para lavadora']), m.busquedas);
  const m2 = VM.recomendar(lav, {}, null, REGLAS, AHORA, { 'secadora Mabe': BUS['secadora Mabe'] });
  const sec = m2.cruzada.find((r) => r.tipo === 'secadora');
  ok('lavadora: con la búsqueda, la secadora de 25 kg (hace par con la de 25 kg), no lavadoras ni centros de lavado',
    sec && sec.id === '1126937152', m2.cruzada);
}
{
  const refri = fichaDe({ nombre: 'Refrigerador dúplex 20 pies cúbicos inverter Y no frost RS20', marca: 'HISENSE', migas: ['Hisense', 'Linea Blanca'], producto: 'Dúplex', precio: 15000 });
  const m = VM.recomendar(refri, { complementa: [it(30, 'WHIRLPOOL', 'Pedestal blanco WFP2715HW', 3000), it(31, 'HISENSE', 'Lavadora 22 kg automática carga frontal', 9000)] }, null, REGLAS, AHORA);
  ok('refrigerador: clase propia', m.clase && m.clase.id === 'refrigerador', m.clase);
  ok('refrigerador: un pedestal de lavadora no se ofrece, ni una lavadora', m.cruzada.length === 0, m.cruzada);
  ok('refrigerador: busca el regulador', m.busquedas.length && m.busquedas[0].consulta === 'regulador para refrigerador', m.busquedas);
}
{
  const a56 = fichaDe({ nombre: 'Galaxy A56 Super AMOLED 6.7 pulgadas', marca: 'SAMSUNG', migas: ['Samsung', 'Celulares'], producto: 'Smartphone', precio: 8999 });
  const m = VM.recomendar(a56, { complementa: [it(40, 'GENERICA', 'Funda para Apple de plástico', 299), it(41, 'SAMSUNG', 'Adaptador tipo C', 399)] }, null, REGLAS, AHORA);
  ok('Galaxy A56: una «Funda para Apple» no se cuela', !m.cruzada.some((r) => r.id === '40'), m.cruzada);
  ok('Galaxy A56: el adaptador Samsung sí', m.cruzada.some((r) => r.id === '41'));
  ok('Galaxy A56: busca funda y mica de su modelo', JSON.stringify(m.busquedas.map((b) => b.consulta)) === JSON.stringify(['funda Galaxy A56', 'mica Galaxy A56'])
    || JSON.stringify(m.busquedas.map((b) => b.consulta)) === JSON.stringify(['funda galaxy a56', 'mica galaxy a56']), m.busquedas);
}
{
  const gg = fichaDe({ nombre: 'Eau de parfum Good Girl para mujer', marca: 'CAROLINA HERRERA', migas: ['Belleza', 'Perfumes', 'Perfumes Mujer'], producto: 'Aceite', precio: 2800,
    variantes: [{ sku: '50', size: '50 ml', price: 2800, inStock: true }, { sku: '80', size: '80 ml', price: 3610, inStock: true }], varianteActual: '50', seleccion: { talla: '50 ml' } });
  const m = VM.recomendar(gg, { complementa: [it(50, 'CAROLINA HERRERA', 'Kit Eau de parfum Heiress para mujer', 3000)],
    relacionados: [it(51, 'CAROLINA HERRERA', 'Eau de parfum La Bomba Intensa para mujer', 2940)] }, null, REGLAS, AHORA);
  ok('perfume: sube a 80 ml (la misma fragancia)', m.incremental.capacidad && m.incremental.capacidad.talla === '80 ml', m.incremental.capacidad);
  ok('perfume: OTRA fragancia no es «subir la versión»', m.incremental.modelo === null, m.incremental.modelo);
  ok('perfume: el kit de otra línea (Heiress) no es su set', !m.cruzada.some((r) => r.id === '50'));
  ok('perfume: busca el set de SU línea', m.busquedas[0] && m.busquedas[0].consulta === 'set good girl Carolina herrera', m.busquedas);
  const m2 = VM.recomendar(gg, {}, null, REGLAS, AHORA, { 'set good girl Carolina herrera': BUS['set good girl Carolina herrera'] });
  ok('perfume: con la búsqueda, el Kit Good Girl, de su línea', m2.cruzada[0] && m2.cruzada[0].id === '1204484968' && m2.cruzada[0].compat === 'exacto', m2.cruzada);
}
{
  const nike = fichaDe({ nombre: 'Tenis Air Max Excee de hombre', marca: 'NIKE', migas: ['Hombre', 'Zapatos', 'Tenis Casuales de Hombre'], producto: 'Tenis', precio: 2299 });
  const m = VM.recomendar(nike, { complementa: [it(60, 'NIKE', 'Pants slim con elástico para hombre', 1299), it(61, 'NIKE', 'Playera cuello redondo para mujer', 699)] }, null, REGLAS, AHORA);
  ok('tenis: «completa el look» con ropa del mismo género', m.cruzada.some((r) => r.id === '60'), m.cruzada);
  ok('tenis: una playera de mujer no, para unos tenis de hombre', !m.cruzada.some((r) => r.id === '61'));
  ok('tenis: busca calcetines Nike de hombre', m.busquedas.some((b) => b.consulta === 'calcetines Nike hombre'), m.busquedas);
  const m2 = VM.recomendar(nike, { complementa: [it(60, 'NIKE', 'Pants slim con elástico para hombre', 1299)] }, null, REGLAS, AHORA, { 'calcetines Nike hombre': BUS['calcetines Nike hombre'] });   // con pants ya resuelto, la calceta entra al plan (v3: pesa menos que playera y pants, H&M)
  const cal = m2.cruzada.find((r) => r.tipo === 'calcetines');
  ok('tenis: con la búsqueda, una calceta (unisex u hombre), nunca la de niño', cal && cal.id !== '1157860064', m2.cruzada);
}
{
  const col = fichaDe({ nombre: 'Colchón performance', marca: 'SPRING AIR', migas: ['Muebles', 'Colchones', 'Colchones'], producto: 'Colchón', precio: 9000,
    variantes: [{ sku: 'm', size: 'Matrimonial', price: 9000, inStock: true }, { sku: 'k', size: 'King Size', price: 12000, inStock: true }], varianteActual: 'm', seleccion: { talla: 'Matrimonial' } });
  const m = VM.recomendar(col, { complementa: [it(70, 'SPRING AIR', 'Box King Size', 4000), it(71, 'SPRING AIR', 'Box matrimonial Wonder', 3500), it(72, 'SLEEP', 'Protector de colchón Towel-Tech', 900)] }, null, REGLAS, AHORA);
  ok('colchón: la medida sale de la variante elegida (matrimonial), no del nombre', m.busquedas.every((b) => !/\{/.test(b.consulta)), m.busquedas);
  ok('colchón: un box King no le queda a un matrimonial', !m.cruzada.some((r) => r.id === '70'), m.cruzada);
  ok('colchón: el box matrimonial sí, como exacto', m.cruzada.some((r) => r.id === '71' && r.compat === 'exacto'), m.cruzada);
}
{
  const sony = fichaDe({ nombre: 'Audífonos On-Ear inalámbricos', marca: 'SONY', migas: ['Electrónica', 'Audio', 'Audífonos'], producto: 'Audífonos On-Ear', precio: 1499 });
  const m = VM.recomendar(sony, { complementa: [it(80, 'HP', 'Multifuncional Smart Tank 580 de tinta continua', 4999), it(81, 'SONY', 'Micrófono portátil inalámbrico ECM-G1', 2999), it(82, 'GENÉRICA', 'Porta audífonos in-ear', 199)] }, null, REGLAS, AHORA);
  ok('audífonos: su clase propia (v3 separa audífonos de bocinas)', m.clase && m.clase.id === 'audifonos', m.clase);
  ok('audífonos: ni la impresora ni el micrófono', !m.cruzada.some((r) => r.id === '80' || r.id === '81'), m.cruzada);
  ok('audífonos: el porta audífonos sí', m.cruzada.some((r) => r.id === '82'), m.cruzada);
}
{
  const ps5 = fichaDe({ nombre: 'Consola PS5 de 825 GB edición bundle', marca: 'PLAYSTATION', migas: ['Otras Categorias', 'Top deals'], producto: 'Consola fija', precio: 11000 });
  const m = VM.recomendar(ps5, { complementa: [it(90, 'ROCKSTAR', 'Grand Theft Auto VI estándar para PS5', 1599), it(91, 'NINTENDO', 'Mario Kart World para Nintendo Switch 2', 1599)] }, null, REGLAS, AHORA);
  ok('consola: «Grand Theft Auto VI… para PS5» cuenta como juego', m.cruzada.some((r) => r.id === '90' && r.tipo === 'juego'), m.cruzada);
  ok('consola: un juego de Switch no, para una PS5', !m.cruzada.some((r) => r.id === '91'));
}
{
  const sol = fichaDe({ nombre: 'Protector solar FPS 50', marca: 'ISDIN', migas: ['Belleza', 'Cuidado Facial', 'Protectores Solares'], producto: 'Protector solar', precio: 650,
    variantes: [{ sku: '1', price: 650, inStock: true }], varianteActual: '1' });
  const m = VM.recomendar(sol, { complementa: [it(95, 'SISLEY', 'Crema Ecological Compound para todo tipo de piel', 7050), it(96, 'ISDIN', 'Crema facial hidratante', 600)] }, null, REGLAS, AHORA);
  ok('precio: una crema de $7,050 junto a un protector de $650, no', !m.cruzada.some((r) => r.id === '95'), m.cruzada);
  ok('precio: la de $600 sí', m.cruzada.some((r) => r.id === '96'));
}

seccion('13 · iPhone 16: qué busca y cómo entra lo que trae la búsqueda');
{
  const plan = mIp.busquedas.map((b) => b.consulta);
  ok('solo busca la mica (la funda exacta y el cargador de la marca ya estaban)', JSON.stringify(plan) === '["mica iPhone 16"]', plan);
  const mB = VM.recomendar(copia(ip.ficha), copia(ip.carruseles), null, REGLAS, AHORA, { 'mica iPhone 16': BUS['mica iPhone 16'] });
  const mica = mB.cruzada.find((r) => r.tipo === 'mica');
  ok('con la búsqueda entra una mica del iPhone 16 exacto (no Pro, Plus ni 17)', mica && mica.compat === 'exacto' && /iphone 16(?! pro| plus)/i.test(mica.nombre), mica);
  ok('la funda de la búsqueda no cuenta como mica', !mB.cruzada.some((r) => r.id === '1185859220'));
  ok('los dos exactos van primero: funda y mica; después el adaptador', JSON.stringify(mB.cruzada.map((r) => r.tipo)) === '["funda","mica","cargador"]', mB.cruzada.map((r) => r.tipo));
  ok('el plan no cambia al llegar los resultados (no se vuelve a buscar)', JSON.stringify(mB.busquedas.map((b) => b.consulta)) === '["mica iPhone 16"]');
  ok('la mica de la búsqueda trae su consulta (para «más opciones»)', mica && mica.consulta === 'mica iPhone 16' && mica.origen === 'busqueda');
}

seccion('15 · Reglas v3: el corpus de Liverpool del 04/10/2026 (81 fichas reales; casos recortados)');
{
  const clase = (o) => { const m = VM.recomendar(fichaDe(o), {}, null, REGLAS, AHORA); return m.clase && m.clase.id; };
  ok('las migas de campaña no cuentan («Top deals», «Buen Fin Cocina»)', typeof VM.migaUtil === 'function' &&
    VM.migaUtil(['Otras Categorias', 'Top deals']) === '' && VM.migaUtil(['Cocina', 'Buen Fin Cocina']) === 'cocina');
  ok('el lavavajillas es lavavajillas, aunque su miga diga «Estufas y hornos de microondas» (la 2.8 lo tomaba por estufa)',
    clase({ nombre: 'Lavavajillas de empotre 15 servicios LDFC2423V', marca: 'LG', migas: ['LG', 'Equipo de Cocina', 'Estufas y hornos de microondas'], producto: 'Lavavajillas de empotre', precio: 9099 }) === 'lavavajillas');
  ok('la secadora de cabello no es la de ropa', clase({ nombre: 'Secadora de cabello InfinitiPro 530WES', marca: 'CONAIR', migas: ['Ojos y cejas', 'Sueros de Pestañas y Cejas'], precio: 749 }) === 'secadoraCabello');
  ok('el proyector no es monitor (su miga es «Proyectores y monitores»)', clase({ nombre: 'Proyector Sp-Lff3Claxxzx', marca: 'SAMSUNG', migas: ['Samsung', 'Equipo de entretenimiento', 'Proyectores y monitores'], precio: 11998 }) === 'proyector');
  ok('la licuadora en «Top deals» se reconoce por su característica «Producto»', clase({ nombre: 'Combo licuadora 53800FJ 5 velocidades', marca: 'HAMILTON BEACH', migas: ['Otras Categorias', 'Top deals'], producto: 'Set licuadora', precio: 1319 }) === 'cocinaElectrica');
  ok('el smartwatch en «Buen Fin Smartwatch» se reconoce por su nombre', clase({ nombre: 'Smartwatch Fit 3 unisex con GPS', marca: 'SAMSUNG', migas: ['Buen Fin', 'Buen Fin Smartwatch'], modeloComercial: 'Fit 3', precio: 1199 }) === 'smartwatch');
  ok('«Base» a secas (la de la cama) no es maquillaje', clase({ nombre: 'Base para cama matrimonial', marca: 'X', migas: ['Muebles', 'Bases'], producto: 'Base', precio: 2000 }) !== 'maquillaje');
}
{
  // La cafetera de cápsulas: las cápsulas de SU sistema, por búsqueda; el molino no (es para la espresso).
  const caf = fichaDe({ id: '1182048221', nombre: 'Cafetera de cápsula dolce gusto kp240ax0', marca: 'KRUPS', migas: ['Línea Blanca y Electrodomésticos', 'Cafeteras y Teteras', 'Cafeteras'], producto: 'Cafetera de cápsula', precio: 2099 });
  const car = { complementa: [it(1171368410, 'HISENSE', 'Lavadora doble tina 18 kg semiautomática carga superior wsa1804p', 5389.51), it(1127899769, 'HEUMAN BRAND', 'Enfriador de aire con control remoto 3 velocidades', 1699),
    it(1115918792, 'MASTERCHEF', 'Molino para café de plástico', 719.4), it(9001, 'GENÉRICO', 'Espumador de leche eléctrico', 324)] };
  const m0 = VM.recomendar(caf, car, null, REGLAS, AHORA);
  ok('cafetera de cápsulas: busca «cápsulas Dolce Gusto» (no están en sus carruseles)', m0.busquedas.some((b) => b.consulta === 'cápsulas Dolce Gusto'), m0.busquedas);
  ok('cafetera de cápsulas: ni molino (es para la espresso), ni lavadora, ni enfriador; el espumador sí',
    !m0.cruzada.some((r) => ['1115918792', '1171368410', '1127899769'].includes(r.id)) && m0.cruzada.some((r) => r.id === '9001'), m0.cruzada);
  const caps = [it(1, 'STARBUCKS', 'Set de 12 cápsulas café con leche', 239), it(2, 'DOLCE GUSTO', 'Set de 16 cápsulas Latte Macchiato', 199),
    it(3, 'NESPRESSO', 'Set de 10 cápsulas Ristretto', 189), it(4, 'DOLCE GUSTO', 'Cafetera Genio S Plus', 2999)];
  const m1 = VM.recomendar(caf, car, null, REGLAS, AHORA, { 'cápsulas Dolce Gusto': caps });
  const cap = m1.cruzada.find((r) => r.tipo === 'capsulas');
  ok('con la búsqueda, las cápsulas que dicen su sistema («Set de 16 cápsulas…» de Dolce Gusto); ni las que no lo dicen, ni Nespresso, ni otra cafetera',
    cap && cap.id === '2' && !m1.cruzada.some((r) => ['1', '3', '4'].includes(r.id)), m1.cruzada);
}
{
  const ven = fichaDe({ nombre: 'Ventilador de torre 3 velocidades', marca: 'MIDEA', migas: ['Línea Blanca y Electrodomésticos', 'Clima y Ventilación', 'Ventilación'], producto: 'Ventilador de torre', precio: 999, care: true });
  const m = VM.recomendar(ven, { complementa: [it(1145698550, 'COOKIFY', 'Rebanador y rallador Tipo Multifuncional', 549), it(1177598573, 'XTELLAR', 'Set espátulas de silicón', 459.86)] }, null, REGLAS, AHORA);
  ok('sin clase reconocida, ningún complemento (la 2.8 ofrecía un rebanador y espátulas con un ventilador)', m.clase === null && m.cruzada.length === 0, m.cruzada);
  ok('sin clase tampoco se ofrece Liverpool Care (su marca viene en TODAS las fichas: 81 de 81)', m.servicio === false);
  const alm = fichaDe({ nombre: 'Set de almohada pillow', marca: 'X', migas: ['Ropa de Cama', 'Almohadas'], producto: 'Set de almohada', precio: 599, care: true });
  ok('ni en una almohada; sí en las clases de equipos (el iPhone)', VM.recomendar(alm, {}, null, REGLAS, AHORA).servicio === false && mIp.servicio === true);
}
{
  const sw = fichaDe({ nombre: 'Smartwatch Fit 3 unisex con GPS', marca: 'SAMSUNG', migas: ['Buen Fin', 'Buen Fin Smartwatch'], modeloComercial: 'Fit 3', precio: 1199 });
  const m = VM.recomendar(sw, { complementa: [it(1166880820, 'VENTDEPOT', 'Colgante Y Dije de perro perros y gatos', 391), it(1146966647, 'GENERICO', 'Set de pulsera', 500.87)] }, null, REGLAS, AHORA, {
    'mica para smartwatch Samsung': [it(5, 'SAMSUNG', 'Mica para smartphone Galaxy de pet', 119.2), it(6, 'GENÉRICO', 'Mica para tablet compatible con huawei watch', 150), it(7, 'GENÉRICO', 'Mica para smartwatch Galaxy Fit 3', 129)] });
  ok('smartwatch: ni el colgante ni la pulsera de joyería de su carrusel', !m.cruzada.some((r) => ['1166880820', '1146966647'].includes(r.id)), m.cruzada);
  ok('smartwatch: la mica es la del reloj, no la del teléfono ni la de tablet', m.cruzada.some((r) => r.id === '7') && !m.cruzada.some((r) => r.id === '5' || r.id === '6'), m.cruzada);
}
{
  const cam = fichaDe({ nombre: 'Cámara instantánea film modelo Instax Mini 12', marca: 'FUJI', migas: ['Electrónica', 'Cámaras y Fotografía', 'Cámaras Fotográficas'], producto: 'Cámara instantánea', modeloComercial: 'Instax Mini 12', precio: 1861 });
  const m = VM.recomendar(cam, { complementa: [it(1026095499, 'FUJIFILM', 'Papel para arte A4 modelo Instax Mini', 259), it(1026095502, 'FUJI', 'Papel fotográfico A4 film modelo Instax Mini 2-Pack', 479),
    it(1137343103, 'FUJI', 'Estuche para cámara instantánea film para Instax Mini 12', 419.3), it(8, 'FUJI', 'Papel fotográfico film modelo Instax Wide', 499)] }, null, REGLAS, AHORA);
  ok('cámara instantánea: su papel fotográfico Instax mini y su estuche', m.cruzada.some((r) => r.id === '1026095502') && m.cruzada.some((r) => r.id === '1137343103'), m.cruzada);
  ok('cámara instantánea: ni el papel para arte ni el de otro formato (wide)', !m.cruzada.some((r) => r.id === '1026095499' || r.id === '8'), m.cruzada);
}
{
  const imp = fichaDe({ nombre: 'Multifuncional Smart Tank 580 de tinta continua inalámbrica a color', marca: 'HP', migas: ['Impresión', 'Impresoras Hogar'], producto: 'Multifuncional', modeloComercial: 'Smart Tank 580', precio: 3399 });
  const m = VM.recomendar(imp, { complementa: [it(1187379489, 'HP', 'Laptop 14-dq6015dx 14 pulgadas HD Intel Celeron', 5487)] }, null, REGLAS, AHORA);
  ok('impresora: la tinta no se busca sola (no se adivina el cartucho)…', !m.busquedas.some((b) => /tinta/.test(b.consulta)), m.busquedas);
  ok('…queda como botón «tinta Hp»', m.sugeridas.some((s) => s.consulta === 'tinta Hp'), m.sugeridas);
  ok('impresora: la laptop de su carrusel no es complemento', !m.cruzada.some((r) => r.id === '1187379489'));
}
{
  const sar = fichaDe({ nombre: 'Sartén Easy Titanium de aluminio', marca: 'T-FAL', migas: ['Buen Fin', 'Buen Fin Cocina'], producto: 'Sartén', precio: 356 });
  const m = VM.recomendar(sar, {}, null, REGLAS, AHORA, { 'set de utensilios de cocina': [it(1161439459, 'MOVEN', 'Set espátulas acero inoxidable', 424.15)], 'set de cuchillos': [it(1173490247, 'BOGNER', 'Set de cuchillos utilitario 15 piezas', 899)] });
  ok('sartén de $356: entran unas espátulas de $424 (debajo de $1,500 el tope es al menos 1.5)', m.cruzada.some((r) => r.id === '1161439459'), m.cruzada);
  ok('…pero no unos cuchillos de $899 (2.5 veces la sartén)', !m.cruzada.some((r) => r.id === '1173490247'), m.cruzada);
}
{
  const cartera = fichaDe({ nombre: 'Cartera para hombre', marca: 'HARDLEY', migas: ['Accesorios de Hombre', 'Carteras'], producto: 'Cartera', precio: 699 });
  const m = VM.recomendar(cartera, { complementa: [it(1162191639, 'WÜND', 'Cinturón para hombre', 612)], otros: [it(10, 'HARDLEY', 'Tarjetero para hombre', 399), it(9, 'X', 'Cartera para hombre de piel', 799)] }, null, REGLAS, AHORA);
  ok('cartera: el cinturón para hombre va primero (la 2.8 ofrecía un pantalón y una playera)', m.cruzada[0] && m.cruzada[0].id === '1162191639', m.cruzada);
  ok('cartera: el tarjetero entra (no es «otra cartera»); otra cartera no', m.cruzada.some((r) => r.id === '10') && !m.cruzada.some((r) => r.id === '9'), m.cruzada);
  const rel = fichaDe({ nombre: 'Reloj Coronado Bay para hombre NAPCNS406', marca: 'NAUTICA', migas: ['Relojes', 'Relojes'], producto: 'Reloj', precio: 1199 });
  const mr = VM.recomendar(rel, { complementa: [it(1157104469, 'HOROZ', 'Collar de eslabones 18 K', 549)] }, null, REGLAS, AHORA);
  ok('reloj de hombre: el collar de su carrusel no (la joyería es para el de mujer)', !mr.cruzada.some((r) => r.id === '1157104469'), mr.cruzada);
}
{
  const ps = fichaDe({ nombre: 'Kit de protector solar FPS 50+ Pack Anthelios UVMune 400 Fluido Oil Control Verano', marca: 'LA ROCHE POSAY', migas: ['Cuidado Facial', 'Protectores Solares'], producto: 'Protector solar', precio: 674 });
  const m = VM.recomendar(ps, {}, null, REGLAS, AHORA, { 'sérum facial La roche posay': [it(1102024539, 'LA ROCHE POSAY', 'Sérum antiacné facial Ultra concentré Effaclar todo tipo piel', 714.35),
    it(1197787755, 'LA ROCHE POSAY', 'Protector solar fps 50+ la roche-posay anthelios uv air', 336.75)] });
  ok('protector solar cuyo nombre abre con «Kit de…»: su tipo sale de «Producto» y no busca otro protector', !m.busquedas.some((b) => /protector solar/.test(b.consulta)), m.busquedas);
  ok('protector solar: el sérum sí; otro protector no (aunque venga en la búsqueda)', m.cruzada.some((r) => r.id === '1102024539') && !m.cruzada.some((r) => r.id === '1197787755'), m.cruzada);
  // Lo contrario: el asador de esa ficha dice «Producto: Carbón» (su combustible). Abre como asador: es el asador.
  const asa = fichaDe({ nombre: 'Asador de carbón ASA-2N', marca: 'CHAR-BROIL', migas: ['Jardín', 'Asadores'], producto: 'Carbón', precio: 1989 });
  const ma = VM.recomendar(asa, { complementa: [it(201, 'X', 'Set bbq de acero inoxidable', 1199), it(202, 'X', 'Funda asador', 769), it(203, 'X', 'Encendedor eléctrico portátil', 302)] }, null, REGLAS, AHORA,
    { 'carbón para asador': [it(204, 'X', 'Carbón vegetal de 4 kg', 399.2)] });
  ok('asador con «Producto: Carbón»: el carbón se sigue ofreciendo (no es «otro de lo mismo»)', ma.busquedas.some((b) => b.consulta === 'carbón para asador') && ma.cruzada.some((r) => r.id === '204'), [ma.busquedas, ma.cruzada]);
}
{
  const asp = fichaDe({ nombre: 'Aspiradora robot gamma', marca: 'KOBLENZ', migas: ['Línea Blanca y Electrodomésticos', 'Aspiradoras'], modeloComercial: 'Gamma', precio: 3199 });
  const m = VM.recomendar(asp, { complementa: [it(1184728903, 'MIDEA', 'Lavavajillas de empotre 14 servicios MDWPS1401KSS', 9999)],
    otros: [it(1158784269, 'DREAMETECH', 'Set repuestos para aspiradora', 259), it(1189271006, 'BELUG', 'Aspiradora de mano 500 ml', 972.43)] }, null, REGLAS, AHORA);
  ok('aspiradora robot Koblenz: ni repuestos de otra marca, ni aspiradora de mano (sustituto), ni lavavajillas', m.cruzada.length === 0, m.cruzada);
  ok('aspiradora: los repuestos quedan como botón (son por modelo)', !m.busquedas.length && m.sugeridas.some((s) => s.consulta === 'repuestos aspiradora Koblenz'), [m.busquedas, m.sugeridas]);
  const lic = fichaDe({ nombre: 'Combo licuadora 53800FJ 5 velocidades', marca: 'HAMILTON BEACH', migas: ['Otras Categorias', 'Top deals'], producto: 'Set licuadora', modeloComercial: '53800FJ', precio: 1319 });
  const ml = VM.recomendar(lic, { complementa: [it(1204883692, 'MAKOM HOME', 'Molde para freidora de aire', 129.35), it(1195171862, 'CHEFMAN', 'Freidora de aire con compartimento único TurboFry Touch 7.5 L', 1379.4),
    it(1152914641, 'CHEFMAN', 'Horno de microondas convencional RJ55-7-SMR-MX de 0.7 pies', 1619.4)], otros: [it(99984447915, 'BLUEWARE', 'Combo licuadora BW-PACK-BW-VP1 2 velocidades', 479)] }, null, REGLAS, AHORA);
  ok('licuadora: la freidora y el microondas sí (Liverpool los vende juntos)', ml.cruzada.some((r) => r.id === '1195171862') && ml.cruzada.some((r) => r.id === '1152914641'), ml.cruzada);
  ok('licuadora: ni otra licuadora ni el molde de la freidora', !ml.cruzada.some((r) => r.id === '99984447915' || r.id === '1204883692'), ml.cruzada);
}
{
  const ref = fichaDe({ nombre: 'Refrigerador dúplex 20 pies cúbicos inverter', marca: 'HISENSE', migas: ['Hisense', 'Linea Blanca'], producto: 'Dúplex', precio: 16999 });
  const m = VM.recomendar(ref, { complementa: [it(301, 'SMARTBITT', 'No break 1000 VA', 1899), it(302, 'KOBLENZ', 'Regulador para refrigerador RLB-2603', 1539.3)] }, null, REGLAS, AHORA);
  ok('refrigerador: el regulador sí; el no-break no (Profeco no lo recomienda para línea blanca)', m.cruzada.some((r) => r.id === '302') && !m.cruzada.some((r) => r.id === '301'), m.cruzada);
  const cuna = fichaDe({ nombre: 'Cuna convertible', marca: 'PRINSEL', migas: ['Bebé', 'Recámara Bebé', 'Cunas y Colechos'], producto: 'Cuna convertible', precio: 6999 });
  const mc = VM.recomendar(cuna, { complementa: [it(303, 'X', 'Protector chichonera acolchado para cuna', 699), it(304, 'X', 'Protector de colchón impermeable para cuna', 399)] }, null, REGLAS, AHORA);
  ok('cuna: el protector de colchón sí; la chichonera nunca (prohibida en EE. UU., la AAP la desaconseja)', mc.cruzada.some((r) => r.id === '304') && !mc.cruzada.some((r) => r.id === '303'), mc.cruzada);
}
{
  // Ropa es «por tipo» (04/10/2026): con los jeans va una blusa, que también es ropa. Antes, TODO lo
  // que traía la búsqueda «blusa para mujer» se descartaba como sustituto.
  const jeans = fichaDe({ nombre: 'Jeans skinny para mujer', marca: 'SEXY JEANS', migas: ['Mujer', 'Ropa', 'Jeans'], producto: 'Jeans', precio: 799 });
  const m = VM.recomendar(jeans, {}, null, REGLAS, AHORA, { 'blusa para mujer': [it(11, 'X', 'Blusa manga corta para mujer', 399), it(12, 'X', 'Jeans mom para mujer', 499)] });
  const todas = m.busquedas.concat(m.sugeridas).map((b) => b.consulta);
  ok('jeans: ninguna búsqueda con la marca de la ropa («tenis Sexy jeans mujer» no existe)', !todas.some((q) => /sexy/i.test(q)) && todas.includes('tenis para mujer'), todas);
  ok('jeans: la blusa de su búsqueda entra; otros jeans no', m.cruzada.some((r) => r.id === '11' && r.tipo === 'superior') && !m.cruzada.some((r) => r.id === '12'), m.cruzada);
  const pla = fichaDe({ nombre: 'Playera polo para hombre', marca: 'X', migas: ['Hombre', 'Ropa', 'Playeras'], producto: 'Playera', precio: 499 });
  const mp = VM.recomendar(pla, { complementa: [it(21, 'X', 'Jeans slim para hombre', 899), it(22, 'X', 'Playera cuello V para hombre', 399)] }, null, REGLAS, AHORA);
  ok('playera: los jeans de su carrusel sí; otra playera no', mp.cruzada.some((r) => r.id === '21') && !mp.cruzada.some((r) => r.id === '22'), mp.cruzada);
  const ves = fichaDe({ nombre: 'Vestido largo formal para mujer', marca: 'X', migas: ['Mujer', 'Ropa', 'Vestidos'], producto: 'Vestido', precio: 1890 });
  const mv = VM.recomendar(ves, { complementa: [it(31, 'X', 'Zapatilla de tacón para mujer', 899), it(32, 'X', 'Vestido corto de noche', 1599), it(33, 'X', 'Bolsa clutch para mujer', 699)] }, null, REGLAS, AHORA);
  ok('vestido: zapatillas y bolsa; otro vestido no', mv.cruzada.some((r) => r.id === '31') && mv.cruzada.some((r) => r.id === '33') && !mv.cruzada.some((r) => r.id === '32'), mv.cruzada);
}

seccion('16 · Lo que se parece y no es: barrido de nombres típicos de Liverpool fuera del corpus');
{
  const clase = (nombre, producto, migas) => { const m = VM.recomendar(fichaDe({ nombre, producto, migas, marca: 'X', precio: 1000 }), {}, null, REGLAS, AHORA); return m.clase && m.clase.id; };
  // [nombre, «Producto», migas, la clase que debe ser]
  [
    ['Plancha para el cabello', 'Plancha para cabello', ['Cuidado Personal', 'Planchas de Cabello'], 'secadoraCabello'],
    ['Pantalla para proyector 100 pulgadas', 'Pantalla de proyección', ['Electrónica', 'Proyectores'], 'proyector'],
    ['MacBook Air 13 pulgadas chip M3', 'Portátil', ['Apple', 'Mac'], 'laptop'],
    ['Computadora portátil Vivobook 14', 'Computadora portátil', ['Computación', 'Laptops'], 'laptop'],
    ['Bocina portátil Flip 6 inalámbrica', 'Bocina portátil', ['Electrónica', 'Audio', 'Bocinas'], 'bocina'],
    ['Aire acondicionado portátil 12000 BTU', 'Aire acondicionado portátil', ['Línea Blanca', 'Clima y Ventilación', 'Aires Acondicionados'], 'aire'],
    ['Consola portátil Switch Lite', 'Consola portátil', ['Videojuegos', 'Consolas'], 'consola'],
    ['Traje slim fit de lana para hombre', 'Traje', ['Hombre', 'Ropa', 'Trajes'], 'traje'],
    ['Vaporizador de ropa', 'Vaporizador', ['Electrodomésticos', 'Planchado'], 'plancha'],
    ['Pantalla Smart TV 55 pulgadas 4K UHD', 'Pantalla', ['Electrónica', 'Pantallas'], 'tv'],
    ['Bolsa de mano para mujer', 'Bolsa', ['Mujer', 'Bolsas', 'Bolsas de Mano'], 'bolsa'],
    ['Mochila escolar con ruedas', 'Mochila', ['Escolares', 'Mochilas Escolares'], 'mochilaEscolar'],
    ['Reloj análogo para mujer', 'Reloj', ['Relojes', 'Relojes de Mujer'], 'reloj'],
    ['Collar de plata para mujer', 'Collar', ['Joyería', 'Collares'], 'joyeria']
  ].forEach(([n, p, mg, esperada]) => { const c = clase(n, p, mg); ok('«' + n + '» → ' + esperada, c === esperada, c); });
  // [nombre, «Producto», migas, la clase que NO puede ser]
  [
    ['Traje de baño completo para mujer', 'Traje de baño', ['Mujer', 'Ropa', 'Trajes de Baño'], 'traje'],
    ['Batería portátil 10000 mAh', 'Batería portátil', ['Celulares', 'Accesorios para Celulares'], 'laptop'],
    ['Disco duro portátil 1 TB', 'Disco duro portátil', ['Computación', 'Almacenamiento'], 'laptop'],
    ['Ventilador portátil USB', 'Ventilador portátil', ['Clima y Ventilación', 'Ventilación'], 'laptop'],
    ['Batería portátil 10000 mAh', 'Batería portátil', ['Accesorios'], 'cocina'],
    ['Reloj de pared', 'Reloj de pared', ['Hogar', 'Decoración'], 'reloj'],
    ['Reloj despertador', 'Reloj despertador', ['Hogar', 'Decoración'], 'reloj'],
    ['Bolsa para dormir', 'Bolsa para dormir', ['Deportes', 'Campismo'], 'bolsa'],
    ['Bolsa de basura', 'Bolsa', ['Hogar', 'Limpieza'], 'bolsa'],
    ['Mochila para laptop 15 pulgadas', 'Mochila', ['Computación', 'Mochilas'], 'mochilaEscolar'],
    ['Lentes de natación', 'Goggles', ['Deportes', 'Natación'], 'lentes'],
    ['Colchón inflable', 'Colchón inflable', ['Deportes', 'Campismo'], 'colchon'],
    ['Cámara de seguridad Wi-Fi', 'Cámara de seguridad', ['Electrónica', 'Casa Inteligente'], 'camara'],
    ['Computadora de escritorio todo en uno', 'All in one', ['Computación', 'Computadoras de Escritorio'], 'oficina'],
    ['Plancha para el cabello', 'Plancha para cabello', ['Cuidado Personal', 'Planchas de Cabello'], 'plancha'],
    ['Collar para perro', 'Collar', ['Mascotas', 'Perros'], 'joyeria'],
    ['Shampoo para perro', 'Shampoo', ['Mascotas', 'Perros'], 'cabello']
  ].forEach(([n, p, mg, prohibida]) => { const c = clase(n, p, mg); ok('«' + n + '» (' + mg.join(' > ') + ') no es ' + prohibida, c !== prohibida, c); });
  ok('la sección de Mascotas cuenta por la MIGA, no por el nombre: «Dije de perro» sigue siendo joyería',
    clase('Colgante Y Dije de perro perros y gatos', 'Dije', ['Joyería', 'Dijes']) === 'joyeria');
}

seccion('17 · La ficha de un ACCESORIO (una mica en «Celulares»)');
{
  const mica = fichaDe({ nombre: 'Mica para iPhone 16 cristal templado', marca: 'GENÉRICO', migas: ['Celulares', 'Accesorios para Celulares'], producto: 'Mica', precio: 299, care: true, modeloComercial: 'MC-IP16-01' });
  const car = { complementa: [it(100, 'APPLE', 'iPhone 16 6.1 pulgadas Super Retina XDR', 17499), it(101, 'X', 'Mica para iPhone 16 de vidrio', 199), it(102, 'X', 'Funda para iPhone 16 transparente', 299)] };
  const m = VM.recomendar(mica, car, null, REGLAS, AHORA);
  const qs = m.busquedas.concat(m.sugeridas).map((b) => b.consulta);
  ok('mica: sin Liverpool Care (es para el equipo, no para una mica de $299)', m.servicio === false);
  ok('mica: la funda del MISMO iPhone sí; ni otra mica ni el teléfono', m.cruzada.some((r) => r.id === '102') && !m.cruzada.some((r) => r.id === '101' || r.id === '100'), m.cruzada);
  ok('mica: ninguna búsqueda con «Genérico» ni con la clave del accesorio', !qs.some((q) => /gen[eé]rico|MC-IP16/i.test(q)), qs);
  const carg = fichaDe({ nombre: 'Cargador USB C 20 W', marca: 'APPLE', migas: ['Celulares', 'Accesorios para Celulares'], producto: 'Cargador', precio: 499, care: true });
  const mg = VM.recomendar(carg, car, null, REGLAS, AHORA);
  ok('cargador sin modelo: no se le pega la funda ni la mica de UN iPhone', !mg.cruzada.some((r) => r.id === '101' || r.id === '102'), mg.cruzada);
  const vap = fichaDe({ nombre: 'Vaporizador de ropa 1500 W', marca: 'OSTER', migas: ['Electrodomésticos', 'Planchado'], producto: 'Vaporizador', precio: 1299, care: true });
  ok('un vaporizador es un equipo (abre como su clase), no un accesorio de la plancha: Liverpool Care sí', VM.recomendar(vap, {}, null, REGLAS, AHORA).servicio === true);
}

seccion('11 · El fondo (fondo.js): de dónde acepta promociones y cómo las sanea');
{
  let oyente = null;
  const almacen = {};
  const fondo = vm.createContext({
    console, JSON, Math, Number, String, Array, Object, Promise, isFinite, Date,
    chrome: {
      runtime: { id: 'EXT', lastError: null, onMessage: { addListener: (f) => { oyente = f; } } },
      storage: { local: {
        get: (k, cb) => { const o = {}; [].concat(k).forEach((x) => { if (x in almacen) o[x] = almacen[x]; }); cb(o); },
        set: (o, cb) => { Object.assign(almacen, o); if (cb) cb(); }
      } }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(EXT, 'fondo.js'), 'utf8'), fondo, { filename: 'fondo.js' });
  const PROD = 'AKfycbwGYZs3C-dsZbIWVn27uEaLm_rXQGhiQc9Q54btPxPb-Z1SX0Enx7NlPqKw4STizaOU';
  const PRUE = 'AKfycbxSjCvwk_f3pqcmIzyqlsPbPxlEHj91C6gjJdLXdLOS';
  ok('despliegue de un /exec con dominio', fondo.despliegueDe('https://script.google.com/a/macros/liverpool.com.mx/s/' + PROD + '/exec?page=portal') === PROD);
  ok('despliegue de una /dev sin dominio', fondo.despliegueDe('https://script.google.com/macros/s/' + PRUE + '/dev') === PRUE);
  ok('otra página de script.google.com no es un despliegue', fondo.despliegueDe('https://script.google.com/home/projects/x') === null);
  ok('otro dominio que imita la ruta tampoco', fondo.despliegueDe('https://script.google.com.evil.mx/macros/s/' + PROD + '/exec') === null &&
    fondo.despliegueDe('https://evil.mx/https://script.google.com/macros/s/' + PROD + '/exec') === null);

  const AH = Date.now();
  const crudo = { v: 1, generado: AH, fuerte: { d: 'Mujer', c: 'Bolsas', t: 'Hasta 58%', p: 58, m: 0, f: AH + DIA },
    promos: [{ d: 'x'.repeat(300), c: 'Bolsas', t: 'Hasta 58%', p: 58, m: 99, f: 'nada', k: 'otra', sobra: 1 }, null, { d: '', c: '', t: '' }] };
  const limpio = fondo.sanear(JSON.stringify(crudo), AH);
  ok('sanea: textos recortados, meses acotados, fin inválido a null, campos de más fuera',
    limpio && limpio.promos.length === 1 && limpio.promos[0].d.length === 60 && limpio.promos[0].m === 48 &&
    limpio.promos[0].f === null && limpio.promos[0].k === '' && !('sobra' in limpio.promos[0]), limpio);
  ok('rechaza otra versión', fondo.sanear(JSON.stringify(Object.assign({}, crudo, { v: 2 })), AH) === null);
  ok('rechaza un paquete de hace más de una semana', fondo.sanear(JSON.stringify(Object.assign({}, crudo, { generado: AH - 8 * DIA })), AH) === null);
  ok('rechaza lo que no es JSON', fondo.sanear('<html>login</html>', AH) === null);

  const mandar = (sender, datos) => new Promise((r) => { const asinc = oyente({ tipo: 'ventel-promos', datos: datos }, sender, r); if (!asinc) r('sin respuesta'); });
  const marco = 'https://n-abc-0lu-script.googleusercontent.com/userCodeAppPanel';
  (async () => {
    let r = await mandar({ id: 'EXT', url: marco, tab: { url: 'https://script.google.com/a/macros/liverpool.com.mx/s/' + PROD + '/exec' } }, JSON.stringify(crudo));
    ok('desde el Portal de producción: se guarda', r.ok && r.guardado && almacen.ventelPromos && almacen.ventelPromos.despliegue === PROD, r);
    delete almacen.ventelPromos;
    r = await mandar({ id: 'EXT', url: marco, tab: { url: 'https://script.google.com/macros/s/AKfycbOTRA/exec' } }, JSON.stringify(crudo));
    ok('desde otra webapp: no', !r.ok && r.motivo === 'origen' && !almacen.ventelPromos, r);
    r = await mandar({ id: 'EXT', url: 'https://drive.googleusercontent.com/x', tab: { url: 'https://script.google.com/macros/s/' + PROD + '/exec' } }, JSON.stringify(crudo));
    ok('desde un marco que no es de Apps Script: no', !r.ok && !almacen.ventelPromos, r);
    r = await mandar({ id: 'OTRA', url: marco, tab: { url: 'https://script.google.com/macros/s/' + PROD + '/exec' } }, JSON.stringify(crudo));
    ok('desde otra extensión: no', !r.ok && !almacen.ventelPromos, r);
    r = await mandar({ id: 'EXT', url: marco, tab: {} }, JSON.stringify(crudo));
    ok('sin URL de pestaña (sin permiso de script.google.com): no', !r.ok && !almacen.ventelPromos, r);
    almacen.cotizadorUrl = 'https://script.google.com/a/macros/liverpool.com.mx/s/AKfycbMIO/exec';
    r = await mandar({ id: 'EXT', url: marco, tab: { url: 'https://script.google.com/a/macros/liverpool.com.mx/s/AKfycbMIO/exec' } }, JSON.stringify(crudo));
    ok('desde el /exec configurado en el popup: sí', r.ok && almacen.ventelPromos && almacen.ventelPromos.despliegue === 'AKfycbMIO', r);
    r = await mandar({ id: 'EXT', url: marco, tab: { url: 'https://script.google.com/macros/s/' + PRUE + '/dev' } }, JSON.stringify(Object.assign({}, crudo, { generado: AH - 3600000 })));
    ok('una copia más vieja no pisa la guardada', r.ok && r.guardado === false && almacen.ventelPromos.despliegue === 'AKfycbMIO', r);
    ok('el interruptor del Portal: «busqueda: false» llega tal cual',
      fondo.sanear(JSON.stringify(Object.assign({}, crudo, { ajustes: { busqueda: false } })), AH).ajustes.busqueda === false);
    ok('…y sin ajustes, o con basura, la búsqueda queda encendida',
      fondo.sanear(JSON.stringify(crudo), AH).ajustes.busqueda === true &&
      fondo.sanear(JSON.stringify(Object.assign({}, crudo, { ajustes: { busqueda: 'no' } })), AH).ajustes.busqueda === true);

    await pruebasBuscador();
    console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
    process.exit(fallos ? 1 : 0);
  })();
}

/* El buscador (buscador-liverpool.js): caché, ritmo, freno. Con un sitio y un almacén falsos. */
async function pruebasBuscador() {
  seccion('14 · El buscador: nunca hace que Liverpool bloquee al asesor');
  vm.runInContext(fs.readFileSync(path.join(EXT, 'buscador-liverpool.js'), 'utf8'), ctx, { filename: 'buscador-liverpool.js' });
  const B = ctx.VentelBuscador;
  ok('VentelBuscador existe', !!B && typeof B.crear === 'function');
  let reloj = 1000000000000;
  let almacen = {}, pedidos = [], respuesta = { status: 200, texto: 'ok' }, lectura = { titulo: 'Mica | Liverpool', items: [{ id: '1', nombre: 'Mica para iPhone 16' }] };
  const nuevo = () => B.crear({
    leer: (ks) => Promise.resolve(ks.reduce((o, k) => { if (k in almacen) o[k] = JSON.parse(JSON.stringify(almacen[k])); return o; }, {})),
    guardar: (o) => { Object.assign(almacen, JSON.parse(JSON.stringify(o))); return Promise.resolve(); },
    pedir: (url) => { pedidos.push(url); return typeof respuesta === 'function' ? respuesta() : Promise.resolve(respuesta); },
    leerResultados: () => lectura,
    ahora: () => reloj
  });
  let b = nuevo();
  let r = await b.buscar('Mica iPhone 16');
  ok('la primera vez va a la red, con la búsqueda pública', r.de === 'red' && pedidos.length === 1 && pedidos[0] === '/tienda?s=Mica%20iPhone%2016', [r, pedidos]);
  r = await b.buscar('mica   iphone 16');
  ok('la misma búsqueda (otra escritura) sale de la caché, sin red', r.de === 'cache' && pedidos.length === 1, [r, pedidos.length]);
  ok('deCache la encuentra sin salir a la red', (await b.deCache('MICA IPHONE 16')).length === 1 && pedidos.length === 1);
  reloj += B.TTL + 1;
  r = await b.buscar('mica iphone 16');
  ok('pasadas 24 h, vuelve a la red', r.de === 'red' && pedidos.length === 2, pedidos.length);

  almacen = {}; pedidos = []; b = nuevo();
  for (let i = 0; i < 4; i++) await b.buscar('consulta ' + i);
  r = await b.buscar('consulta 4');
  ok('ritmo: la quinta en el mismo minuto no sale', r.items === null && r.motivo === 'ritmo' && pedidos.length === 4, [r, pedidos.length]);
  reloj += 61000;
  r = await b.buscar('consulta 4');
  ok('…y al minuto siguiente sí', r.de === 'red' && pedidos.length === 5);
  almacen[B.CLAVES.ritmo] = Array.from({ length: 40 }, (_, i) => reloj - 120000 - i * 1000);
  r = await b.buscar('consulta 5');
  ok('ritmo: 40 en la última hora y no sale ni una más', r.items === null && r.motivo === 'ritmo', r);

  almacen = {}; pedidos = []; b = nuevo();
  respuesta = { status: 403, texto: '' };
  r = await b.buscar('algo');
  ok('freno: un 403 apaga la búsqueda', r.items === null && r.motivo === 'freno' && almacen[B.CLAVES.pausa] === reloj + B.PAUSA, [r, almacen[B.CLAVES.pausa]]);
  respuesta = { status: 200, texto: 'ok' };
  r = await b.buscar('otra cosa');
  ok('freno: durante la pausa no sale nada, ni otra búsqueda', r.motivo === 'pausa' && pedidos.length === 1, [r, pedidos.length]);
  reloj += B.PAUSA + 1;
  r = await b.buscar('otra cosa');
  ok('freno: pasada la hora, vuelve', r.de === 'red' && pedidos.length === 2, [r, pedidos.length]);
  lectura = { titulo: 'Access Denied', items: [] };
  r = await b.buscar('tercera');
  ok('freno: una página «Access Denied» también lo activa', r.motivo === 'freno' && almacen[B.CLAVES.pausa] > reloj, r);
  lectura = { titulo: 'Mica | Liverpool', items: [{ id: '1', nombre: 'x' }] };

  almacen = {}; pedidos = []; b = nuevo(); reloj += B.PAUSA + 1;
  respuesta = () => Promise.reject(new Error('sin red'));
  r = await b.buscar('sin red');
  ok('sin red: no lanza y frena', r.items === null && r.motivo === 'freno', r);
  respuesta = { status: 200, texto: 'ok' };

  almacen = {}; pedidos = []; b = nuevo(); reloj += B.PAUSA + 1;
  const cache = {};
  for (let i = 0; i < B.TOPE_CACHE; i++) cache['vieja ' + i] = { en: reloj - 1000 + i, items: [] };
  almacen[B.CLAVES.cache] = cache;
  await b.buscar('la nueva');
  const claves = Object.keys(almacen[B.CLAVES.cache]);
  ok('la caché no pasa de ' + B.TOPE_CACHE + ' búsquedas y tira la más vieja', claves.length === B.TOPE_CACHE && claves.indexOf('vieja 0') === -1 && claves.indexOf('la nueva') > -1, claves.length);

  almacen = {}; pedidos = []; b = nuevo(); reloj += 120000;
  let soltar;
  respuesta = () => new Promise((res) => { soltar = () => res({ status: 200, texto: 'ok' }); });
  const p1 = b.buscar('doble'), p2 = b.buscar('doble');
  await new Promise((res) => setTimeout(res, 5));
  soltar();
  const [r1, r2] = await Promise.all([p1, p2]);
  ok('dos pedidos iguales a la vez salen como UNO', pedidos.length === 1 && r1 === r2, pedidos.length);
}
