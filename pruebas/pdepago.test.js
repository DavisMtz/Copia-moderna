/*
 * Pago Web en consola (25/09/2026).   node pruebas/pdepago.test.js
 *
 * La sección sale de la hoja «PdePago», que editan personas: cada plan se reconoce por su
 * nombre. El comportamiento vive en app_pdepago.html y los factores y promociones los da
 * pdpDatos (Portal.gs). Lo que se rompe sin que se vea:
 *   · una cuenta mal hecha le da al cliente una mensualidad que no es (se compara con las tres
 *     filas de ejemplo de «Pagos Fijos 3.0»);
 *   · un nombre de plan que deja de reconocerse pierde su tira o su calculadora;
 *   · una promoción que no se reparte a su plan (o se reparte a otro);
 *   · que el buscador, ?item= o switchSec vuelvan a llamar a lo que ya no existe;
 *   · que pdpDatos devuelva campos que el Portal no enseña (SKUs, la referencia del año pasado).
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
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

const index = fs.readFileSync(path.join(PROY, 'Index.html'), 'utf8').replace(/\r\n/g, '\n');
const parcial = fs.readFileSync(path.join(PROY, 'app_pdepago.html'), 'utf8').replace(/\r\n/g, '\n');
const portal = fs.readFileSync(path.join(PROY, 'Portal.gs'), 'utf8').replace(/\r\n/g, '\n');
const guion = parcial.slice(parcial.indexOf('<script>') + 8, parcial.lastIndexOf('</script>'));

/* Saca el texto de una función del parcial por su nombre (cuenta llaves, respeta cadenas). */
function fuente(nombre, texto) {
  texto = texto || guion;
  const i = texto.indexOf('function ' + nombre + '(');
  if (i < 0) return '';
  let d = 0, j = texto.indexOf('{', i), q = null;
  for (; j < texto.length; j++) {
    const c = texto[j];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && texto[j + 1] === '/') { j = texto.indexOf('\n', j); continue; }
    if (c === '{') d++;
    if (c === '}' && --d === 0) return texto.slice(i, j + 1);
  }
  return '';
}
const var_ = (nombre) => { const m = new RegExp('var ' + nombre + ' = ([\\s\\S]*?);\\n').exec(guion); return m ? m[1] : 'undefined'; };

/* Las funciones puras del parcial, evaluadas de verdad en un contexto aparte. */
const ctx = { console };
vm.runInNewContext(
  'var MES3 = ' + var_('MES3') + '; var FACTORES_COPIA = ' + var_('FACTORES_COPIA') + '; var factores = FACTORES_COPIA;\n' +
  'function escHtml(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }\n' +
  ['norm', 'tipoDe', 'fijos', 'plazos', 'fMin', 'fMax', 'msiDe', 'mesDe', 'planDePromo', 'cifrasHtml', 'clave'].map((n) => fuente(n)).join('\n') +
  '\nthis.api = { tipoDe, fijos, fMin, fMax, msiDe, mesDe, planDePromo, cifrasHtml, clave, FACTORES_COPIA };', ctx);
const A = ctx.api;

console.log('1 · Cada plan de la hoja se reconoce por su nombre');
{
  const esperado = {
    'Presupuesto Liverpool': 'contado',
    'Meses sin intereses (msi)': 'msi',
    'Empieza a pagar a X mes (presupuesto diferido)': 'diferido',
    'Hasta 48 mensualidades (pagos fijos)': 'fijos',
    'Hasta 48 mensualidad a pagar en x mes': 'fijosdif',
    'Montos mínimos para diferir compra a MSI de forma manual por credito': 'regla',
    'Tarjetas departamentales de otra cadena': 'otro'
  };
  Object.keys(esperado).forEach((n) => ok('«' + n + '» → ' + esperado[n], A.tipoDe(n) === esperado[n], A.tipoDe(n)));
  ok('los nombres de la vista de diseño son los de la hoja', Object.keys(esperado).slice(0, 6).every((n) => index.includes("nombre:'" + n + "'")));
}

console.log('2 · Pagos fijos: la cuenta de «Pagos Fijos 3.0»');
{
  const F = A.FACTORES_COPIA, k = Object.keys(F).map(Number);
  ok('la copia trae de 2 a 48 meses, sin huecos', k.length === 47 && A.fMin() === 2 && A.fMax() === 48 && k.every((n, i) => n === i + 2));
  ok('a más meses, menor factor', k.every((n, i) => !i || F[n] < F[k[i - 1]]));
  ok('a más meses, más se paga en total', k.every((n, i) => !i || F[n] * n > F[k[i - 1]] * k[i - 1]));
  // Las tres filas de ejemplo de la hoja: PRECIO, MENSUALIDADES → MENSUALIDAD, PRECIO FINAL
  [[689, 3, 251.48, 754.44], [1692, 6, 329.93, 1979.55], [4799, 48, 252.63, 12126.40]].forEach(([p, n, men, tot]) => {
    const r = A.fijos(p, n);
    ok('$' + p + ' a ' + n + ' meses: $' + men + ' al mes, $' + tot + ' en total (como la hoja)',
      r && Math.round(r.mensualidad * 100) / 100 === men && Math.round(r.total * 100) / 100 === tot, r);
  });
  ok('fuera de la tabla no inventa (1 y 49 meses)', A.fijos(1000, 1) === null && A.fijos(1000, 49) === null);
  ok('$12,500 a 12 meses: $1,384.80 al mes y $4,117.57 de interés', (() => { const r = A.fijos(12500, 12); return Math.round(r.mensualidad * 100) === 138480 && Math.round(r.interes * 100) === 411757; })());
}

console.log('3 · Promociones: a qué plan va cada una');
{
  const casos = [
    ['15% EN DESCUENTO O [9 MSI DILISA / 6 MSI EXTERNAS]', 'msi', [9, 6]],
    ['Hasta 16 MSI (Lanzamiento Iphone)', 'msi', [16]],
    ['Hasta 58% dto o hasta 55% dto y hasta 16 msi', 'msi', [16]],
    ['Hasta 30% y pague en Diciembre', 'diferido', 11],
    ['Hasta 50% dto y paga hasta diciembre (Quincena Sealy del 22 sept al 11 oct)', 'diferido', 11],
    ['BTS Hasta 20% dto y paga en noviembre', 'diferido', 10],
    ['Hasta 30% DTO', '', null],
    ['Banner preventa Iphone 11 Septiembre', '', null]
  ];
  casos.forEach(([txt, plan, dato]) => {
    const p = A.planDePromo({ promocion: txt });
    const d = plan === 'msi' ? JSON.stringify(A.msiDe(txt)) === JSON.stringify(dato) : plan === 'diferido' ? A.mesDe(txt) === dato : A.msiDe(txt) === null && A.mesDe(txt) === -1;
    ok('«' + txt.slice(0, 48) + '» → ' + (plan || 'ninguno'), p === plan && d, [p, A.msiDe(txt), A.mesDe(txt)]);
  });
  // El filtro del servidor deja pasar todas las que el cliente sabe repartir (y no más de la cuenta)
  const reTxt = /const re = (\/.*\/i);/.exec(fuente('pdpPromos_', portal));
  const re = reTxt ? vm.runInNewContext(reTxt[1]) : null;
  ok('pdpPromos_ tiene su filtro', !!re);
  if (re) {
    casos.forEach(([txt, plan]) => ok('el servidor ' + (plan ? 'deja pasar' : 'descarta') + ' «' + txt.slice(0, 40) + '»', re.test(txt) === !!plan));
  }
}

console.log('4 · Cifras de una regla');
{
  const h = A.cifrasHtml('Liverpool $500 / SBB $1,000');
  ok('«Liverpool $500 / SBB $1,000» → dos cifras en grande', (h.match(/class="pdc-cifra"/g) || []).length === 2 && h.includes('<b>$500</b>') && h.includes('<b>$1,000</b>'), h);
  ok('un texto que no es lista de montos se enseña tal cual', A.cifrasHtml('Aplica solo con tarjeta de crédito') === '');
  ok('las claves de los planes son estables y sin acentos', A.clave('Montos mínimos para diferir compra a MSI') === 'montos-minimos-para-diferir-compra-a-msi');
}

console.log('5 · Marcado de la sección');
{
  const i0 = index.indexOf('<section id="sec-pdepago"'), i1 = index.indexOf('</section>', i0);
  const sec = index.slice(i0, i1);
  ok('la sección existe una vez', i0 > 0 && index.indexOf('<section id="sec-pdepago"', i0 + 1) < 0);
  ok('h1 solo para lectores de pantalla, sin encabezado visible', /<h1 class="pdc-sr">Pago Web<\/h1>/.test(sec) && !/sec-head|sec-eyebrow/.test(sec));
  ok('lista con role="listbox" y nombre, y ficha', /<div class="pdc-lista" role="listbox" aria-label="Planes de pago"><\/div>/.test(sec) && /<article class="pdc-ficha"><\/article>/.test(sec));
  ok('sin barra de filtro (con seis planes se elige)', !/filter-input|filterSec\('pdepago'/.test(sec));
  ok('el esqueleto tiene la forma de la consola', /id="ld-pdepago" class="sk-grid pdc-sk"/.test(sec));
}

console.log('6 · Enganches con el guion grande');
{
  const cuerpo = (nombre) => fuente(nombre, index);
  ok('Index incluye el parcial', /<\?!= include\('app_pdepago'\) \?>/.test(index));
  ok('switchSec llama a pdpAlEntrar', /if \(id === 'pdepago' && window\.pdpAlEntrar\) pdpAlEntrar\(\);/.test(cuerpo('switchSec')));
  ok('revealTarget pasa por pdpRevelar', /pdpRevelar\(scrollEl\)/.test(cuerpo('revealTarget')));
  ok('elementoDeSeccion encuentra el plan por .pdc-nom y lo lleva a .pdc-opc', /\.pdc-nom/.test(cuerpo('elementoDeSeccion')) && /\.pdc-opc/.test(cuerpo('elementoDeSeccion')));
  ok('sectionEnter anima lista y ficha', /\.pdc-lista, \.pdc-ficha/.test(cuerpo('sectionEnter')));
  ok('NAME_FIELD ya no filtra Pago Web', !/pdepago:'nombre'/.test(index));
  ok('Index ya no define renderPP (el del parcial no se pisa)', !/function renderPP\(/.test(index));
  const viejas = ['pago-card', 'pago-head', 'pago-icon', 'pago-name', 'pago-det', 'sim-note'].filter((c) => new RegExp('\\.' + c + '\\b|class="[^"]*\\b' + c + '\\b').test(index));
  ok('no queda CSS ni marcado de las tarjetas viejas', viejas.length === 0, viejas);
  ok('el parcial publica renderPP, pdpAlEntrar y pdpRevelar', /window\.renderPP = function/.test(parcial) && /window\.pdpAlEntrar = function/.test(parcial) && /window\.pdpRevelar = function/.test(parcial));
  ok('[hidden] le gana a las cajas con display propio', /\.pdc-bloque\[hidden\]\{display:none\}/.test(parcial));
  ok('la calculadora dice que es aproximada junto a la cifra', /class="pdc-aprox">aprox\./.test(parcial) && /historial crediticio/.test(parcial));
  ok('pide pdpDatos con AppRun.swr y la guarda con su clave', /AppRun\.swr\(DATOS_CLAVE, 'pdpDatos'/.test(parcial) && /'pdp-datos-v1'/.test(parcial));
}

console.log('7 · pdpDatos (Portal.gs)');
{
  const f = fuente('pdpDatos', portal), fa = fuente('pdpFactores_', portal), fp = fuente('pdpPromos_', portal);
  ok('existen pdpDatos, pdpFactores_ y pdpPromos_', !!(f && fa && fp));
  ok('pdpDatos no se cae si una de las dos partes falla', (f.match(/try \{/g) || []).length === 2 && /status: 'ok'/.test(f));
  ok('el simulador lo decide el servidor (constante o propiedad), nunca el cliente', /function pdpDatos\(\) \{/.test(portal) && /getProperty\('PDP_SIMULADOR_ID'\) \|\| PDP_SIMULADOR_ID/.test(fa));
  ok('los factores se guardan 6 h', /cache\.put\('pdpFactores_v1', JSON\.stringify\(f\), 21600\)/.test(fa));
  const campos = (/out\.push\(\{([\s\S]*?)\}\);/.exec(fp) || [])[1] || '';
  const claves = campos.split('\n').map((l) => (/^\s*(\w+):/.exec(l) || [])[1]).filter(Boolean);
  ok('las promociones llevan solo lo que ya enseña la portada', JSON.stringify(claves) === JSON.stringify(['direccion', 'categoria', 'promocion', 'marca', 'vigencia', 'inicio', 'fin', 'dias', 'empieza']), claves);
  ok('vigentes y las que empiezan en 14 días, con tope', /empieza <= 14/.test(fp) && /slice\(0, 200\)/.test(fp));
}

console.log('\n' + '─'.repeat(45));
if (fallos) { console.log('✖ ' + fallos + ' de ' + total + ' comprobaciones fallaron'); process.exit(1); }
console.log('TODO OK · ' + total + ' comprobaciones');
