/*
 * Devoluciones SAP en consola (26/09/2026).   node pruebas/devsap.test.js
 *
 * La sección no sale de ninguna hoja: su contenido (la autorización, cuatro leyendas, dos matrices de
 * Soft Line y cinco criterios) estaba escrito a mano en Index.html y ahora es el modelo de
 * app_devsap.html. Lo que se rompe sin que se vea:
 *   · una acción que no es la de la matriz (el asesor le dice al cliente lo que no procede);
 *   · una leyenda mal escrita o donde no va (un registro equivocado en SAP);
 *   · un id ds-* que desaparece: el buscador y los enlaces dejan de llegar, sin error;
 *   · que switchSec, el buscador o ?item= vuelvan a llamar a lo que ya no existe.
 * El caso fijo es la sección de antes, tal cual (devsap_antes_20260926.html): el modelo tiene que decir
 * lo mismo. Un solo cambio, pedido por el creador el 26/09: «ServicioSL/…» se escribe «Servicio SL/…».
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
const leer = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const index = leer(path.join(PROY, 'Index.html'));
const parcial = leer(path.join(PROY, 'app_devsap.html'));
const antes = leer(path.join(__dirname, 'devsap_antes_20260926.html'));
const guion = parcial.slice(parcial.indexOf('<script>') + 8, parcial.lastIndexOf('</script>'));
const estilos = parcial.slice(parcial.indexOf('<style>') + 7, parcial.indexOf('</style>'));
const texto = (h) => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/* El parcial de verdad, con una ventana a sus piezas que solo existe aquí. */
function cargar() {
  const cierre = guion.lastIndexOf('})();');
  const js = guion.slice(0, cierre) +
    'window.__dv = { listaHTML: listaHTML, fichaHTML: fichaHTML, autHTML: autHTML, montoHTML: montoHTML, resHTML: resHTML, ' +
    'CASOS: CASOS, LEYENDAS: LEYENDAS, CRITERIOS: CRITERIOS, MONTOS: MONTOS, ACC: ACC, GRUPOS: GRUPOS, AUT: AUT, st: st, accion: accion, depende: depende, vaEn: vaEn };\n' +
    guion.slice(cierre);
  const ctx = { console };
  ctx.window = ctx;
  vm.runInNewContext(js, ctx, { filename: 'app_devsap.html' });
  return ctx;
}
const W = cargar();
const D = W.__dv;
const caso = (id) => D.CASOS.filter((k) => k.id === id)[0];
function ficha(id, monto) { D.st.monto = monto || ''; D.st.sel = id; const h = D.fichaHTML(id); D.st.monto = ''; D.st.sel = 'servicio'; return h; }
const chips = (h) => (h.match(/data-dv-copiar="([^"]*)"/g) || []).map((x) => texto(x.slice(16, -1)));

/* ── La sección de antes, leída ── */
function matriz(id) {
  const i = antes.indexOf('<div class="ds-matrix-wrap" id="' + id + '">');
  const t = antes.slice(i, antes.indexOf('</table>', i));
  const cols = (t.match(/<thead>[\s\S]*?<\/thead>/)[0].match(/<th>([^<]*)<\/th>/g) || []).map(texto);
  const cuerpo = t.slice(t.indexOf('<tbody>'));
  const filas = (cuerpo.match(/<tr><th>[\s\S]*?<\/tr>/g) || []).map((tr) => {
    const nombre = texto(tr.match(/<th>([\s\S]*?)<\/th>/)[1]);
    const celdas = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
    return { nombre, si: celdas.map((c, n) => (/ds-yes/.test(c) ? n : -1)).filter((n) => n > -1), n: celdas.length };
  });
  return { cols, filas };
}
const ACC_DE_COLUMNA = { 'Recogido': 'recogido', 'Devolución': 'devolucion', 'Canalizar a tienda': 'canalizar', 'Recogido y devolución': 'recogido_dev' };

console.log('1) Las dos matrices de antes caben en caso × monto → acción, sin perder nada');
const mayor = matriz('ds-mayor'), menor = matriz('ds-menor');
ok('las dos matrices tienen 7 escenarios y las mismas 4 acciones',
  mayor.filas.length === 7 && menor.filas.length === 7 && JSON.stringify(mayor.cols) === JSON.stringify(menor.cols) &&
  JSON.stringify(mayor.cols.slice(1)) === JSON.stringify(['Recogido', 'Devolución', 'Canalizar a tienda', 'Recogido y devolución']), mayor.cols);
ok('cada fila tiene UN solo ✓ (por eso una celda con la acción no pierde nada)', mayor.filas.concat(menor.filas).every((f) => f.si.length === 1 && f.n === 4));
ok('la columna «Recogido» sola no la usaba ningún escenario', mayor.filas.concat(menor.filas).every((f) => f.si[0] !== 0));
[['menor', menor, 'hasta'], ['mayor', mayor, 'mas']].forEach(([n, m, monto]) => {
  m.filas.forEach((f) => {
    const k = D.CASOS.filter((x) => x.nombre === f.nombre)[0];
    const esperada = ACC_DE_COLUMNA[m.cols[f.si[0] + 1]];
    ok('SL ' + n + ' a $3,000 · ' + f.nombre + ' → ' + m.cols[f.si[0] + 1], !!k && k.acc && k.acc[monto] === esperada, k && k.acc);
  });
});
ok('el modelo trae los mismos 7 escenarios, ni uno más', D.CASOS.filter((k) => k.acc).length === 7);
ok('«Hasta $3,000» incluye los $3,000 (la matriz menor decía «de hasta $3,000 pesos»)',
  /de hasta \$3,000 pesos/.test(antes) && /de más de \$3,000 pesos/.test(antes) && D.MONTOS[0].nombre === 'Hasta $3,000' && D.MONTOS[1].nombre === 'Más de $3,000');
ok('solo tres casos cambian con el monto: Servicio SL, C&C Servicio SL y Sin tienda Liverpool cercana',
  JSON.stringify(D.CASOS.filter((k) => D.depende(k)).map((k) => k.id)) === JSON.stringify(['servicio', 'cc-servicio', 'sin-tienda']));

console.log('2) Las leyendas: las de antes, con «Servicio SL/…» como pidió el creador');
const leyAntes = [];
(antes.match(/copyText\('([^']*)', this\)" title="Copiar leyenda"/g) || []).forEach((x) => leyAntes.push(x.match(/copyText\('([^']*)'/)[1]));
const leyAhora = [].concat.apply([], D.LEYENDAS.map((L) => L.textos));
ok('las seis leyendas de antes, en el mismo orden', leyAntes.length === 6 && JSON.stringify(leyAntes.map((t) => t.replace('ServicioSL/', 'Servicio SL/'))) === JSON.stringify(leyAhora), { leyAntes, leyAhora });
ok('«Servicio SL/dañada» se escribe con espacio (así viene en la hoja de Homologación)', leyAhora.indexOf('Servicio SL/dañada') > -1 && parcial.indexOf('ServicioSL/') < 0);
const descAntes = (antes.match(/<p class="ds-gloss-desc">[\s\S]*?<\/p>/g) || []).map(texto);
ok('cuándo va cada leyenda: el texto de antes, palabra por palabra',
  descAntes.length === 4 && D.LEYENDAS.every((L, n) => texto(L.cuando + (L.nota ? ' ' + L.nota : '')) === descAntes[n]), descAntes);
const ambAntes = (antes.match(/<span class="ds-gloss-tag">[\s\S]*?<\/span>/g) || []).map(texto);
ok('el ámbito de cada leyenda (Correo soporte: SL, MKP y BT, sólo en órdenes de venta)',
  ambAntes.length === 4 && D.LEYENDAS.slice(0, 3).every((L, n) => L.ambito === ambAntes[n]) &&
  ['Mercaderías SL', 'MKP', 'BT', 'sólo en órdenes de venta'].every((p) => ambAntes[3].indexOf(p) > -1 && D.LEYENDAS[3].ambito.indexOf(p) > -1), ambAntes);

console.log('3) Criterios y autorización: los de antes');
const critAntes = (antes.match(/<li>[\s\S]*?<\/li>/g) || []).map(texto);
ok('los cinco criterios, palabra por palabra (la cita de «Satisfacción SL» va entre comillas)',
  critAntes.length === 5 && D.CRITERIOS.every((c, n) => texto(c.html).replace(/[«»]/g, '') === critAntes[n]), { antes: critAntes, ahora: D.CRITERIOS.map((c) => texto(c.html)) });
const aut = D.autHTML();
ok('el correo de autorización se copia igual que antes', /copyText\('Ventas CCL <ventas-ccl@liverpool\.com\.mx>'/.test(antes) && D.AUT.correo === 'Ventas CCL <ventas-ccl@liverpool.com.mx>' &&
  aut.indexOf('data-dv-copiar="Ventas CCL &lt;ventas-ccl@liverpool.com.mx&gt;"') > -1);
ok('la autorización dice lo mismo: por escrito, supervisor o team leader, sin ella no se realiza',
  ['devolución, recogido o cambio de estatus', 'por escrito de un supervisor o team leader', 'no se realiza'].every((p) => texto(aut).indexOf(p) > -1 && texto(antes).indexOf(p) > -1));
ok('la autorización sale UNA vez (antes, arriba y otra vez al final)', (texto(antes).match(/team leader/g) || []).length === 2 && (aut.match(/team leader/g) || []).length === 1 &&
  (guion.match(/team leader/g) || []).length === 1);

console.log('4) La ficha de cada caso');
D.CASOS.filter((k) => k.acc).forEach((k) => {
  ['', 'hasta', 'mas'].forEach((m) => {
    const h = ficha(k.id, m), t = texto(h);
    const nombres = m ? [D.ACC[k.acc[m]].nombre] : [D.ACC[k.acc.hasta].nombre, D.ACC[k.acc.mas].nombre];
    ok(k.nombre + (m ? ' · ' + m : ' · sin monto') + ': dice qué procede', nombres.every((a) => t.indexOf(a) > -1) &&
      (D.depende(k) ? (m ? (h.match(/class="dv-r es-elegido"/g) || []).length === 1 && (h.match(/class="dv-r es-otro"/g) || []).length === 1 : t.indexOf('Con cualquier monto') < 0)
                    : t.indexOf('Con cualquier monto') > -1));
  });
});
ok('Servicio SL: las tres leyendas, y con más de $3,000 la devolución va cuando se realice el recogido',
  JSON.stringify(chips(ficha('servicio'))) === JSON.stringify(['Servicio SL/dañada', 'Servicio SL/incompleta', 'Servicio SL/equivocada']) &&
  texto(ficha('servicio', 'mas')).indexOf('cuando se realice el recogido') > -1);
ok('Mercancía frágil rota: solo «Servicio SL/dañada» (llegó rota)', JSON.stringify(chips(ficha('fragil'))) === JSON.stringify(['Servicio SL/dañada']));
ok('C&C Servicio SL: la leyenda solo hasta $3,000 (con más, se canaliza a tienda)',
  chips(ficha('cc-servicio', 'hasta')).length === 3 && chips(ficha('cc-servicio', 'mas')).length === 0 && /<h4>Hasta \$3,000<\/h4>/.test(ficha('cc-servicio')));
ok('Satisfacción SL y C&C Satisfacción SL: canalizar a tienda no lleva leyenda, y la ficha lo dice (el creador, 26/09)', ['satisfaccion', 'cc-satisfaccion'].every((id) => ['', 'hasta', 'mas'].every((m) => chips(ficha(id, m)).length === 0 &&
  texto(ficha(id, m)).indexOf('Al canalizar a tienda no se registra leyenda en SAP.') > -1)) && texto(ficha('cc-servicio', 'mas')).indexOf('no se registra leyenda') > -1 && texto(ficha('cc-servicio')).indexOf('no se registra leyenda') < 0);
ok('Sin tienda Liverpool cercana: «Satisfacción SL» con los dos montos (regla del creador)',
  ['', 'hasta', 'mas'].every((m) => JSON.stringify(chips(ficha('sin-tienda', m))) === '["Satisfacción SL"]'));
ok('Productos grandes: la de Servicio SL si llegó mal y la de Satisfacción SL si no le gustó',
  JSON.stringify(chips(ficha('grandes'))) === JSON.stringify(['Servicio SL/dañada', 'Servicio SL/incompleta', 'Servicio SL/equivocada', 'Satisfacción SL']) &&
  texto(ficha('grandes')).indexOf('Si llegó dañada, incompleta o equivocada') > -1 && texto(ficha('grandes')).indexOf('Si no le gustó') > -1);
ok('ENR: la leyenda «Reconocida» y su proceso en Trazabilidad (Soft Line, SL Mensajerías, MarketPlace)',
  JSON.stringify(chips(ficha('enr'))) === '["Reconocida"]' && ['softline', 'slmensajerias', 'mkp'].every((s) => ficha('enr').indexOf('data-dv-traz="' + s + '"') > -1));
ok('Correo soporte: la leyenda y sus cinco supuestos', JSON.stringify(chips(ficha('correo'))) === '["Correo soporte"]' && (ficha('correo').match(/<li>/g) || []).length === 5);
ok('en el glosario, «Va en» dice la condición o el monto (grandes: si no le gustó; C&C Servicio SL: hasta $3,000)',
  /data-dv-ir="grandes">Mercancía de dimensiones grandes SL <small>si no le gustó<\/small>/.test(ficha('glosario')) && /data-dv-ir="cc-servicio">C&amp;C Servicio SL <small>hasta \$3,000<\/small>/.test(ficha('glosario')));
ok('el glosario enseña las cuatro y en qué casos va cada una',
  chips(ficha('glosario')).length === 6 && ficha('glosario').indexOf('data-dv-ir="sin-tienda"') > -1 && ficha('glosario').indexOf('data-dv-ir="fragil"') > -1);
ok('los criterios completos, en su propia ficha', (ficha('criterios').match(/<li>/g) || []).length === 5);
ok('toda ficha tiene su título para lectores de pantalla (h2#dvTitulo en el cartel)',
  D.CASOS.map((k) => k.id).concat(['glosario', 'criterios']).every((id) => /<h2 class="cs-cartel-t" id="dvTitulo">/.test(ficha(id))));
ok('con un monto elegido, ninguna ficha dice el otro monto (un horno de $12,000 no lee «menor a $3,000»)',
  D.CASOS.filter((k) => k.acc).every((k) => ['hasta', 'mas'].every((m) => texto(ficha(k.id, m)).indexOf(m === 'mas' ? 'menor a $3,000' : 'mayor a $3,000') < 0)),
  D.CASOS.filter((k) => k.acc).map((k) => ['hasta', 'mas'].filter((m) => texto(ficha(k.id, m)).indexOf(m === 'mas' ? 'menor a $3,000' : 'mayor a $3,000') > -1).map((m) => k.id + ':' + m)).filter((x) => x.length));
ok('productos grandes: la leyenda de «si no le gustó» no arrastra el «menor a $3,000» del glosario', texto(ficha('grandes')).indexOf('menor a $3,000') < 0);
ok('los supuestos de Correo soporte son una lista, no botones', /<ul class="dv-crit">/.test(ficha('correo')) && ficha('correo').indexOf('dv-lista-p') < 0);
ok('si la opción queda fuera de la vista, el foco va a la ficha (nadie baja la página al devolverlo)', /aLaVista \? o : \(ficha\.querySelector\('\.dv-ficha-cuerpo'\) \|\| o\)/.test(guion));
ok('«revisa también» lleva a casos que existen', D.CASOS.every((k) => (k.ver || []).every((v) => !!caso(v.id))));

console.log('5) La lista y los id del buscador');
const pintado = D.autHTML() + D.montoHTML() + D.listaHTML();
function cargaIndices() {
  const js = leer(path.join(PROY, 'app_indices.html')).match(/<script>([\s\S]*?)<\/script>/)[1];
  const ctx = { console, Math, JSON, String, Number, Object, Array, RegExp };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  return ctx.AppIndices;
}
const DEVSAP = cargaIndices().devolucionesSap;
ok('los nueve id de antes siguen en el índice', ['ds-autorizacion', 'ds-glosario', 'ds-servicio-sl', 'ds-enr', 'ds-satisfaccion-sl', 'ds-correo-soporte', 'ds-mayor', 'ds-menor', 'ds-criterios']
  .every((id) => DEVSAP.some((e) => e.target === id)));
ok('cada caso de la consola tiene su entrada en el buscador', D.CASOS.every((k) => DEVSAP.some((e) => e.target === k.ancla)));
ok('todo destino del buscador existe en lo que pinta la consola (y una sola vez)', DEVSAP.every((e) => (pintado.match(new RegExp('id="' + e.target + '"', 'g')) || []).length === 1),
  DEVSAP.filter((e) => (pintado.match(new RegExp('id="' + e.target + '"', 'g')) || []).length !== 1).map((e) => e.target));
ok('la leyenda de Servicio SL se busca como «Servicio SL/dañada» y también junta', DEVSAP.some((e) => e.target === 'ds-servicio-sl' && /Servicio SL\/dañada/.test(e.sub) && /serviciosl/.test(e.kw)));
ok('once opciones (nueve casos, el glosario y los criterios) y una sola elegida',
  (D.listaHTML().match(/role="option"/g) || []).length === 11 && (D.listaHTML().match(/aria-selected="true"/g) || []).length === 1);
D.st.monto = '';
ok('sin monto, los tres casos que cambian dicen cada respuesta con su monto delante, y los demás «Cualquier monto»',
  D.CASOS.filter((k) => k.acc).every((k) => D.depende(k)
    ? texto(D.resHTML(k)) === 'Hasta $3,000' + D.ACC[k.acc.hasta].nombre + 'Más de $3,000' + D.ACC[k.acc.mas].nombre && D.resHTML(k).indexOf('es-doble') > -1
    : texto(D.resHTML(k)).indexOf('Cualquier monto') > -1), D.CASOS.filter((k) => D.depende(k)).map((k) => texto(D.resHTML(k))));
D.st.monto = 'mas';
ok('con monto, cada caso dice una sola respuesta', D.CASOS.filter((k) => k.acc).every((k) => texto(D.resHTML(k)) === D.ACC[k.acc.mas].nombre));
D.st.monto = '';
ok('el monto: dos botones con los id de las matrices de antes (ds-menor, ds-mayor)', /id="ds-menor" data-dv-monto="hasta"/.test(D.montoHTML()) && /id="ds-mayor" data-dv-monto="mas"/.test(D.montoHTML()));

console.log('6) Enganches con Index.html');
const fuente = (n, t) => { const i = t.indexOf('function ' + n + '('); if (i < 0) return ''; return t.slice(i, t.indexOf('\n}\n', i) + 2); };
ok('Index incluye el parcial una vez, después del de Trazabilidad',
  (index.match(/include\('app_devsap'\)/g) || []).length === 1 && index.indexOf("include('app_devsap')") > index.indexOf("include('app_trazabilidad')"));
const sec = index.slice(index.indexOf('<section id="sec-devsap"'), index.indexOf('</section>', index.indexOf('<section id="sec-devsap"')));
ok('#sec-devsap: h1 para lectores de pantalla y el hueco de la consola, sin encabezado visible',
  /<h1 class="dv-sr">Devoluciones SAP<\/h1>/.test(sec) && /<div id="dv-app"><\/div>/.test(sec) && sec.indexOf('sec-head') < 0 && sec.indexOf('ds-gloss') < 0);
ok('switchSec pinta la consola ANTES de la entrada animada', /if \(id === 'devsap' && window\.dvAlEntrar\) dvAlEntrar\(\); sectionEnter\(target\);/.test(fuente('switchSec', index)));
ok('sectionEnter anima la autorización, la lista y la ficha', /\.dv-aut, \.dv-lista, \.dv-ficha[',]/.test(fuente('sectionEnter', index)));
ok('revealTarget pasa por dvRevelar (buscador y ?item=)', /scrollEl\.closest\('#sec-devsap'\) && window\.dvRevelar[\s\S]*?if \(dvRevelar\(scrollEl\)\) return;/.test(fuente('revealTarget', index)));
ok('elementoDeSeccion reconoce el nombre de un caso (.dv-nom → .dv-opc)', /\.dv-nom,/.test(fuente('elementoDeSeccion', index)) && /\.dv-opc,tr'/.test(fuente('elementoDeSeccion', index)));
const muertos = ['initDevsapReveals', 'jumpToDevsap', 'devsapRevealsReady', '.ds-gloss', '.ds-matrix', '.ds-auth', '.ds-leyenda', '.fp-nav', '.fp-num', '.step-list', '.bt-block', '.bt-obs', '.bt-title'];
ok('nada de la sección de antes queda en Index', muertos.every((m) => index.indexOf(m) < 0), muertos.filter((m) => index.indexOf(m) > -1));
ok('se quedan las insignias del menú (SAP y BT)', /\n\.ds-badge\{/.test(index) && /\n\.bt-badge\{/.test(index) && /data-sec="devsap"/.test(index));

console.log('7) El parcial');
ok('publica dvAlEntrar y dvRevelar', /window\.dvAlEntrar = function/.test(guion) && /window\.dvRevelar = function/.test(guion));
ok('sin \\p{…}: esbuild lo reescribe y el build lo rechaza', parcial.indexOf('\\p{') < 0);
ok('ancho por contenedor (em) y movimiento reducido', /container:dv\/inline-size/.test(estilos) && /@container dv \(max-width:54em\)/.test(estilos) && /prefers-reduced-motion:reduce/.test(estilos));
ok('lo único oculto con hidden son las dos anclas del glosario (no hay caja con display que le gane)', (guion.match(/ hidden>/g) || []).length === 2);
ok('el chip de una leyenda avisa en su etiqueta y no se reescribe entero (copyText(txt, null))', /window\.copyText\(txt, null\)/.test(guion));

console.log('\n' + (total - fallos) + ' de ' + total + ' comprobaciones' + (fallos ? ' — ' + fallos + ' FALLAN' : ' — todo bien'));
process.exit(fallos ? 1 : 0);
