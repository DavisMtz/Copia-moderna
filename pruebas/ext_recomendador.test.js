/*
 * Pruebas de «Vende más con este artículo» (extensión de Chrome 2.6): el núcleo de decisiones,
 * con los archivos REALES de la extensión y fichas REALES de liverpool.com.mx.
 *   Ejecutar:  node pruebas/ext_recomendador.test.js
 *
 * Se cargan reglas-venta.js y recomendador-nucleo.js en un contexto aislado, igual que los ve el
 * content script. Las fichas (ext_recomendador_fichas_20261004.json) son las que leyó la propia
 * extensión el 04/10/2026: el iPhone 16, con fundas de otros teléfonos en «Complementa con», y el
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
const FICHAS = JSON.parse(fs.readFileSync(path.join(__dirname, 'ext_recomendador_fichas_20261004.json'), 'utf8'));

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

seccion('1 · Utilidades');
ok('pesos sin centavos', VM.pesos(17499) === '$17,499', VM.pesos(17499));
ok('pesos con centavos', VM.pesos(24398.85) === '$24,398.85', VM.pesos(24398.85));
ok('norm quita acentos y mayúsculas', VM.norm('  Sérum  ANTIEDAD ') === 'serum antiedad');
ok('bonito escribe iPhone', VM.bonito('mica iphone 16') === 'Mica iPhone 16', VM.bonito('mica iphone 16'));

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
ok('sin paquete de promociones: lo dice', mIp.promos.hay === false && mIp.promos.frase === null);

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
ok('ningún protector o bloqueador solar como «complemento»', !mPs.cruzada.some((r) => /protector solar|bloqueador/i.test(r.nombre)));
ok('ni el labial ni el aceite capilar (tipos que la regla no conoce)',
  !mPs.cruzada.some((r) => ['1174570027', '1159294591'].indexOf(r.id) > -1), mPs.cruzada.map((r) => r.nombre));
ok('las búsquedas llenan los huecos con tipos que sí le van',
  JSON.stringify(mPs.sugeridas.map((s) => s.consulta)) === JSON.stringify(['limpiador facial Isdin', 'agua termal']), mPs.sugeridas);
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
const frase = VM.fraseApertura(paquete, AHORA);
ok('frase con la más fuerte y la siguiente de OTRA dirección, con sus MSI',
  frase && frase.texto === 'Sr. / Srta., hoy tenemos hasta un 58% de descuento en Mujer o hasta 55% de descuento + 13 MSI en Hogar…', frase && frase.texto);
const vencida = Object.assign(copia(paquete), { fuerte: Object.assign({}, paquete.fuerte, { f: AHORA - 1 }) });
vencida.promos[0].f = AHORA - 1;
const fraseV = VM.fraseApertura(vencida, AHORA);
ok('si la más fuerte ya venció, no sale en la frase', fraseV && fraseV.fuerte.p === 55 && fraseV.texto.indexOf('58%') === -1, fraseV && fraseV.texto);
ok('sin porcentajes, no hay frase', VM.fraseApertura({ promos: [{ d: 'Hogar', t: '13 MSI', p: 0, m: 13 }] }, AHORA) === null);

const mIpP = VM.recomendar(copia(ip.ficha), copia(ip.carruseles), paquete, REGLAS, AHORA);
ok('iPhone: la promo de su categoría (Celulares)', mIpP.promos.ficha && mIpP.promos.ficha.por === 'categoria' && mIpP.promos.ficha.promo.c === 'Celulares', mIpP.promos.ficha);
const mPsP = VM.recomendar(copia(ps.ficha), copia(ps.carruseles), paquete, REGLAS, AHORA);
ok('protector solar: «Cuidado facial» casa con sus migas', mPsP.promos.ficha && mPsP.promos.ficha.promo.c === 'Cuidado facial', mPsP.promos.ficha);
const mTvP = VM.recomendar(tv, {}, paquete, REGLAS, AHORA);
ok('pantalla: la de Pantallas venció ayer, así que cae a la dirección Electrónica',
  mTvP.promos.ficha && mTvP.promos.ficha.por === 'direccion' && mTvP.promos.ficha.promo.c === 'Celulares', mTvP.promos.ficha);
ok('las horas del paquete se calculan', Math.abs(mIpP.promos.horas - 3) < 0.01, mIpP.promos.horas);

seccion('10 · Nada revienta con datos pobres');
let error = null, vacio = null;
try { vacio = VM.recomendar({ id: '9', nombre: 'Algo sin migas', marca: '' }, {}, null, REGLAS, AHORA); } catch (e) { error = e.message; }
ok('ficha mínima, sin carruseles ni promociones', !error && vacio && vacio.cruzada.length === 0 && vacio.incremental.capacidad === null, error || vacio);
error = null;
try { VM.recomendar({ id: '9', nombre: 'iPhone 16' }, { complementa: [{}, null, { id: '1' }] }, { promos: [null, {}] }, REGLAS, AHORA); } catch (e) { error = e.message; }
ok('candidatos y promociones rotos se ignoran', !error, error);

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

    console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
    process.exit(fallos ? 1 : 0);
  })();
}
