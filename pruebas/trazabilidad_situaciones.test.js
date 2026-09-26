/*
 * Trazabilidad por situación (26/09/2026).   node pruebas/trazabilidad_situaciones.test.js
 *
 * Las seis secciones de Trazabilidad pintan una sola vista (app_trazabilidad.html): una pestaña por
 * situación del cliente y, dentro, los procesos de cada línea con la fecha en días hábiles. Los datos
 * salen de la hoja de Homologación, que editan personas. Lo que se rompe sin que se vea:
 *   · un proceso que cae en la situación equivocada, o que desaparece;
 *   · una fecha mal contada (un sábado, un festivo, «72 hrs» contado como 72 días);
 *   · una observación que se pierde o cambia de orden al repartirla en «Qué hacer» y «¿Procede?»;
 *   · un «Copiar» sobre una comilla suelta de la hoja;
 *   · que switchSec, el buscador, ?item= o ?q= vuelvan a llamar a lo que ya no existe.
 * El caso fijo es la hoja real al 26/09/2026 (73 procesos), tal como la devuelve Trazabilidad.gs.
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
const parcial = fs.readFileSync(path.join(PROY, 'app_trazabilidad.html'), 'utf8').replace(/\r\n/g, '\n');
const guion = parcial.slice(parcial.indexOf('<script>') + 8, parcial.lastIndexOf('</script>'));
const estilos = parcial.slice(parcial.indexOf('<style>') + 7, parcial.indexOf('</style>'));
const PAYLOAD = JSON.parse(fs.readFileSync(path.join(__dirname, 'trazabilidad_payload_20260926.json'), 'utf8'));

/* Saca el texto de una función por su nombre: cuenta llaves y se salta cadenas, comentarios y
   expresiones regulares (el parcial tiene /"/g y /[\s"“”]/: una comilla dentro de una regex no abre
   ninguna cadena). */
function fuente(nombre, texto) {
  texto = texto || guion;
  const i = texto.indexOf('function ' + nombre + '(');
  if (i < 0) return '';
  let d = 0, j = texto.indexOf('{', i), q = null, previo = '{';
  for (; j < texto.length; j++) {
    const c = texto[j];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; previo = 'x'; continue; }
    if (c === '/' && texto[j + 1] === '*') { j = texto.indexOf('*/', j) + 1; continue; }
    if (c === '/' && texto[j + 1] === '/') { j = texto.indexOf('\n', j); continue; }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]/.test(previo)) {
      let clase = false;
      for (j++; j < texto.length; j++) {
        const r = texto[j];
        if (r === '\\') { j++; continue; }
        if (r === '[') clase = true; else if (r === ']') clase = false;
        else if (r === '/' && !clase) break;
      }
      previo = 'x';
      continue;
    }
    if (!/\s/.test(c)) previo = c;
    if (c === '{') d++;
    if (c === '}' && --d === 0) return texto.slice(i, j + 1);
  }
  return '';
}
const var_ = (nombre) => { const m = new RegExp('var ' + nombre + ' = ([\\s\\S]*?);\\n').exec(guion); return m ? m[1] : 'undefined'; };

/* El modelo y la ficha del parcial, evaluados de verdad con un «hoy» fijo. */
function cargar(hoyISO) {
  const HOY = new Date(hoyISO).getTime();
  const RealDate = Date;
  class Fija extends RealDate { constructor(...a) { if (!a.length) super(HOY); else super(...a); } static now() { return HOY; } }
  const ctx = { console, Date: Fija };
  vm.runInNewContext(
    ['LINEAS', 'SECS', 'SITUACIONES', 'REGLAS', 'DIAS', 'DIAS_C', 'DIAS_T', 'MESES', 'MESES_C', 'festivosCache', 'RE_CANT',
     'RE_COND_INICIO', 'RE_COND_DENTRO', 'PROPIOS', 'TERMINOS', 'LETRA', 'RE_CLAVE'].map((n) => 'var ' + n + ' = ' + var_(n) + ';').join('\n') + '\n' +
    'function icon(n, c){ return "<svg class=\\"ic\\">" + n + "</svg>"; }\n' +
    ['norm', 'situacionDe', 'vacio', 'festivos', 'esFestivo', 'esHabil', 'hoy', 'diaClave', 'sumarHabiles', 'fechaLarga', 'fechaCorta',
     'plazo', 'fechas', 'desglose', 'renglones', 'esCondicion', 'frasesDe', 'repartir', 'frasesCopiables', 'plataformas', 'modelo',
     'esc', 'ic', 'sinComillaSuelta', 'mayuscula', 'resaltar', 'enLinea', 'diasTexto', 'tiraHTML', 'avanceHTML', 'plazoHTML', 'bloquesHTML',
     'procedeHTML', 'fichaHTML', 'resumen', 'marcar', 'fragmento', 'sistemaDe'].map((n) => { const f = fuente(n); if (!f) throw new Error('no encontré ' + n); return f; }).join('\n') +
    '\nthis.api = { modelo, situacionDe, plazo, fechas, desglose, sumarHabiles, esFestivo, esHabil, festivos, fechaLarga, fechaCorta, ' +
    'renglones, repartir, frasesCopiables, fichaHTML, tiraHTML, enLinea, resumen, marcar, fragmento, SITUACIONES, LINEAS };', ctx);
  return ctx.api;
}
const A = cargar('2026-09-26T12:00:00');   // sábado
const M = A.modelo(PAYLOAD);
const porId = {};
M.forEach((p) => { porId[p.id] = p; });
const d = (iso) => new Date(iso + 'T12:00:00');
const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

console.log('1) Cada proceso, en su situación');
ok('los 73 procesos de la hoja (BT 15 · SL 10 · SLM 9 · MKP 17 · Tienda 10 · Generales 12)', M.length === 73, M.length);
ok('ids únicos y los de siempre (bt-1…, sl-1…): los enlaces guardados siguen valiendo',
  new Set(M.map((p) => p.id)).size === 73 && PAYLOAD.secciones.every((s) => s.procesos.every((p) => porId[p.id] && porId[p.id].nombre === p.nombre)));
const cuenta = {};
M.forEach((p) => { cuenta[p.situacion] = (cuenta[p.situacion] || 0) + 1; });
const esperado = { cuando: 7, vencido: 11, norecibio: 6, llegomal: 9, devolver: 7, cancelar: 6, reembolso: 11, domicilio: 3, pagos: 3, mesa: 3, servicios: 4, otros: 3 };
ok('reparto por situación como el 26/09 (7·11·6·9·7·6·11·3·3·3·4·3)', Object.keys(cuenta).length === Object.keys(esperado).length &&
  Object.keys(esperado).every((k) => cuenta[k] === esperado[k]), cuenta);
ok('toda situación del modelo existe en la lista de pestañas', M.every((p) => A.SITUACIONES.some((s) => s.id === p.situacion)));
[['bt-6', 'devolver', 'Recogidos por satisfacción/ mercancía dañada es recolección aunque diga «dañada»'],
 ['gen-2', 'mesa', 'Mesa de Regalos (Canc…) es mesa de regalos aunque sea cancelación'],
 ['mkp-4', 'cuando', 'Guía tránsito c/movimiento: va en tiempo'],
 ['mkp-5', 'vencido', 'Guía tránsito s/movimiento: no ha llegado'],
 ['tda-6', 'cancelar', 'Cancelaciones BT de Tienda'],
 ['mkp-15', 'llegomal', 'Pedidos con DEFECTO / FUNCIONALIDAD'],
 ['gen-11', 'devolver', 'Artículos que no aplican para reembolso por higiene'],
 ['gen-7', 'reembolso', 'Devoluciones no reflejadas'],
 ['bt-4', 'servicios', 'Armado'],
 ['tda-9', 'otros', 'Sustituto APV / POS no se reconoce: va a Otros casos']
].forEach(([id, sit, porque]) => ok(porque + ' → ' + sit, porId[id] && porId[id].situacion === sit, porId[id] && porId[id].situacion));
ok('un nombre nuevo que nadie reconoce no desaparece: va a «Otros casos»', A.situacionDe({ nombre: 'Proceso inventado 2027' }) === 'otros');
ok('una pestaña de la hoja que el Portal no conoce no rompe nada (se ignora)',
  A.modelo({ secciones: [{ id: 'nueva', procesos: [{ id: 'x-1', nombre: 'Algo' }] }] }).length === 0);

console.log('2) El plazo, leído de la hoja');
const pl = (t) => A.plazo(t);
ok('«10 días» → 10 días hábiles', pl('10 días').tipo === 'dias' && pl('10 días').hasta === 10 && pl('10 días').n === 10);
ok('«5-7 días» → de 5 a 7', pl('5-7 días').n === 5 && pl('5-7 días').hasta === 7);
ok('«72 hrs» → 3 días (las horas cuentan como días, hacia arriba)', pl('72 hrs').hasta === 3 && pl('72 hrs').horas === 72);
ok('«24 hrs» → 1 día', pl('24 hrs').hasta === 1);
ok('«Inmediata (fecha PAO)» NO es «hoy»: es la fecha que marca PAO', pl('Inmediata (fecha PAO)').tipo === 'sistema' && pl('Inmediata (fecha PAO)').sistema === 'PAO');
ok('«Inmediata (fecha SOMS/PAO)» → la fecha de SOMS o PAO (SL fecha en tiempo)', porId['sl-1'].plazo.tipo === 'sistema' && porId['sl-1'].plazo.sistema === 'SOMS o PAO');
ok('solo «Inmediata» o «Inmediato», sin más, se resuelve en la llamada', pl('Inmediata').tipo === 'hoy' && pl('Inmediato').tipo === 'hoy' && porId['gen-1'].plazo.tipo === 'hoy');
ok('«Fecha asignada en el calendario de PAO» → la da PAO', pl('Fecha asignada en el calendario de PAO').tipo === 'sistema' && pl('Fecha asignada en el calendario de PAO').sistema === 'PAO');
ok('«…calendario de SOMS / PAO» → SOMS o PAO', pl('Fecha asignada en el calendario de SOMS / PAO').sistema === 'SOMS o PAO');
ok('«Fecha límite de envío de entrada única + 7 días» → la da Entrada única (no se inventa la base)', pl('Fecha límite de envío de entrada única + 7 días').sistema === 'Entrada única');
ok('«…sumar 7 días a partir del contacto» → 7 días desde hoy', pl('Revisar fecha de Entrada Única si esta vencida\nGenera reporte en MDA y sumar 7 días a partir del contacto.').hasta === 7);
ok('«Depende del estatus.» → texto', pl('Depende del estatus.').tipo === 'texto');
ok('«N/A», «-» y vacío → sin plazo', ['N/A', '-', '', 'N/A (evento abierto)'].slice(0, 3).every((t) => pl(t).tipo === 'na'));
ok('Resurtido BT: el texto largo con «10 a 12 días hábiles» da de 10 a 12', porId['bt-13'].plazo.tipo === 'dias' && porId['bt-13'].plazo.n === 10 && porId['bt-13'].plazo.hasta === 12 && porId['bt-13'].plazo.largo);
const des = porId['bt-8'].desglose;
ok('Devolución sí procede (BT): tres métodos con su plazo', des && des.items.length === 3 &&
  des.items[0].plazo.hasta === 1 && des.items[1].plazo.hasta === 3 && des.items[2].plazo.hasta === 2, des && des.items.map((i) => [i.metodo, i.tiempo]));
ok('…y lo que no es método va de nota («LAS FECHAS SON ESTIMADAS»)', des && des.notas.some((n) => /FECHAS SON ESTIMADAS/.test(n)));
ok('los seis desgloses de reembolso se reconocen', M.filter((p) => p.plazo.tipo === 'desglose').length === 6, M.filter((p) => p.plazo.tipo === 'desglose').map((p) => p.id));

console.log('3) Días hábiles: lunes a viernes, sin los festivos de la LFT');
const f26 = A.festivos(2026);
ok('festivos 2026: 1 ene, 2 feb, 16 mar, 1 may, 16 sep, 16 nov, 25 dic', ['1-1', '2-2', '3-16', '5-1', '9-16', '11-16', '12-25'].every((k) => f26[k]) && Object.keys(f26).length === 7, Object.keys(f26));
const f27 = A.festivos(2027);
ok('festivos 2027: 1 feb, 15 mar y 15 nov (lunes que se mueven)', f27['2-1'] && f27['3-15'] && f27['11-15'] && !f27['2-2']);
ok('1 de octubre solo cada seis años (2030 sí, 2026 no)', A.festivos(2030)['10-1'] && !f26['10-1']);
ok('sábado 26 sep + 1 → lunes 28 sep', mismoDia(A.sumarHabiles(d('2026-09-26'), 1), d('2026-09-28')));
ok('sábado 26 sep + 5 → viernes 2 oct', mismoDia(A.sumarHabiles(d('2026-09-26'), 5), d('2026-10-02')));
ok('sábado 26 sep + 10 → viernes 9 oct', mismoDia(A.sumarHabiles(d('2026-09-26'), 10), d('2026-10-09')));
ok('viernes 13 nov + 3 → jueves 19 nov (el 16 es festivo)', mismoDia(A.sumarHabiles(d('2026-11-13'), 3), d('2026-11-19')));
ok('jueves 24 dic + 1 → lunes 28 dic (el 25 es festivo)', mismoDia(A.sumarHabiles(d('2026-12-24'), 1), d('2026-12-28')));
ok('martes 15 sep + 1 → jueves 17 sep (el 16 es festivo)', mismoDia(A.sumarHabiles(d('2026-09-15'), 1), d('2026-09-17')));
ok('fecha larga en español: «viernes 9 de octubre»', A.fechaLarga(d('2026-10-09')) === 'viernes 9 de octubre');
ok('fecha corta: «vie 9 oct»', A.fechaCorta(d('2026-10-09')) === 'vie 9 oct');
const tira = A.tiraHTML(d('2026-10-09'), null);
ok('la tira de hoy (sáb 26) al vie 9: 14 días, 4 inhábiles, hoy y límite marcados',
  (tira.match(/class="tz-dia/g) || []).length === 14 && (tira.match(/es-inhabil/g) || []).length === 4 &&
  /es-hoy/.test(tira) && (tira.match(/es-limite/g) || []).length === 1, tira.length);
ok('…y su texto para lectores de pantalla cuenta 10 días hábiles', /10 días hábiles/.test(tira));
const B = cargar('2026-11-13T12:00:00');
const tiraFest = B.tiraHTML(B.sumarHabiles(new Date('2026-11-13T12:00:00'), 3), null);
ok('con un festivo en medio la tira lo marca y lo explica', /es-festivo/.test(tiraFest) && /festivo oficial/.test(tiraFest));

console.log('4) Observaciones: «Qué hacer» y «¿Procede?» sin perder nada');
const letras = (s) => [...String(s || '').replace(/^"+|"+$/g, '').replace(/^\s*(\d{1,2})\s*[.)]\s+/gm, '').replace(/^(notas?\s*\d*|importante|tip|consejo|recuerda)\s*[:.\-]\s*/gim, '').replace(/[\s"“”⦁•‣▪◦※*·]/g, '')].sort().join('');
const perdidos = M.filter((p) => letras(p.hacer.concat(p.procede).map((r) => r.txt).join('')) !==
  letras(p.hacer.concat(p.procede).length ? PAYLOAD.secciones.find((s) => s.id === p.linea.id).procesos.find((x) => x.id === p.id).observaciones : ''));
ok('en los 73 procesos no se pierde ni se inventa una letra al repartir', perdidos.length === 0, perdidos.map((p) => p.id));
const txt = (id, lado) => porId[id][lado].map((r) => r.txt).join(' | ');
ok('SL «Entrega no reconocida»: «No aplica en mercancía de + de $3,000.» va a ¿Procede?', /No aplica en mercancía de \+ de \$3,000/.test(txt('sl-5', 'procede')));
ok('SLM: la frase que mezcla condición y acción se parte (la condición arriba, «Si no se cuenta con inventario…» en Qué hacer)',
  /No aplica en mercancía de \+ de \$3,000/.test(txt('slm-6', 'procede')) && /Si no se cuenta con inventario, todas las incidencias/.test(txt('slm-6', 'hacer')));
ok('MKP incompleto SL: «Se deberá registrar…» en Qué hacer y «No aplica en mercancía de alto valor…» en ¿Procede?',
  /Se deberá registrar la devolución/.test(txt('mkp-14', 'hacer')) && /No aplica en mercancía de alto valor/.test(txt('mkp-14', 'procede')));
ok('Tienda ENR: el «(No aplica…)» entre paréntesis se queda con su acción', /\(No aplica en mercancía de alto valor/.test(txt('tda-5', 'hacer')));
ok('el orden dentro de cada lado es el de la hoja (BT fecha vencida)', /^Se asigna caso a CR/.test(porId['bt-2'].hacer[0].txt) && /MDA categoría 49/.test(porId['bt-2'].hacer[porId['bt-2'].hacer.length - 1].txt));
ok('los pasos numerados de la hoja siguen siendo pasos (OV sin disponibilidad: 1, 2, 3)', porId['bt-5'].hacer.filter((r) => r.t === 'paso').map((r) => r.n).join() === '1,2,3');

console.log('5) Frases para pegar en el caso');
const frases = M.filter((p) => p.frases.length).map((p) => p.id);
ok('solo las dos para el CR (BT fecha vencida y BT devolución no procede por estatus)', JSON.stringify(frases) === '["bt-2","bt-10"]', frases);
ok('una comilla suelta de la hoja no se vuelve «Copiar» (MKP ENR, Tienda resurtido y cancelaciones)', ['mkp-8', 'tda-4', 'tda-6', 'tda-7'].every((id) => !porId[id].frases.length));

console.log('6) La ficha');
const fichas = {};
M.forEach((p) => { fichas[p.id] = A.fichaHTML(p); });
const f2 = fichas['bt-2'];
ok('BT fecha vencida: «a más tardar el viernes 2 de octubre» y su tira', /a más tardar el/.test(f2) && /viernes 2 de octubre/.test(f2) && /tz-tira/.test(f2));
ok('…el avance del caso (3 días hábiles, escalación por Salesforce)', /Avance del caso: <b>3 días hábiles<\/b>, a más tardar el mié 30 sep \(escalación por Salesforce\)/.test(f2), (f2.match(/Avance del caso[^<]*<b>[^<]*<\/b>[^<]*/) || [''])[0]);
ok('…la frase para el CR con su botón Copiar', /data-tz-copiar="Buen día CR solicitamos de su apoyo para programar una nueva fecha de entrega"/.test(f2));
ok('lo que se copia es texto: ningún data-tz-copiar lleva etiquetas (la negrita de «CR» se quedaba dentro)',
  Object.values(fichas).every((h) => (h.match(/data-tz-copiar="[^"]*"/g) || []).every((a) => !/[<>]/.test(a))));
ok('…y el orden: plazo → qué hacer → ¿procede? → dónde revisar', (() => {
  const i1 = f2.indexOf('tz-plazo'), i2 = f2.indexOf('Qué hacer'), i4 = f2.indexOf('Dónde revisar');
  return i1 > -1 && i1 < i2 && i2 < i4;
})());
ok('BT devolución: la tabla de métodos con sus fechas (lun 28 sep, mié 30 sep, mar 29 sep)',
  /<table class="tz-metodos">/.test(fichas['bt-8']) && /lun 28 sep/.test(fichas['bt-8']) && /mié 30 sep/.test(fichas['bt-8']) && /mar 29 sep/.test(fichas['bt-8']));
ok('Recogidos BT: «La fecha que marca PAO» y el plazo para reportarlo (1 año)', /La fecha que marca PAO/.test(fichas['bt-6']) && /Plazo para reportarlo: <b>1 año<\/b>/.test(fichas['bt-6']));
ok('BT fecha en tiempo: «Dile al cliente: la fecha que marca PAO», nunca «Hoy mismo»', /Dile al cliente<\/p><p class="tz-p-fecha"><span>La fecha que marca PAO/.test(fichas['bt-1']) && Object.values(fichas).every((h) => h.indexOf('Hoy mismo') < 0));
ok('lo que es para el asesor no dice «Dile al cliente»: «En la llamada», «Plazo según la hoja», «Sin plazo en la hoja: no des una fecha.»',
  /<p class="tz-p-lbl">Plazo<\/p><p class="tz-p-fecha"><span>En la llamada<\/span>/.test(fichas['gen-1']) && fichas['gen-1'].indexOf('Dile al cliente') < 0 &&
  /<p class="tz-p-lbl">Plazo según la hoja<\/p>/.test(fichas['tda-8']) && fichas['tda-8'].indexOf('Dile al cliente') < 0 &&
  /Sin plazo en la hoja: no des una fecha\./.test(fichas['bt-12']) && fichas['bt-12'].indexOf('Dile al cliente') < 0);
ok('Digitales (sin observaciones): lo dice en vez de dejar el hueco', /La hoja no trae observaciones/.test(fichas['gen-8']));
ok('MKP fecha en tiempo: «La fecha de Entrada única + 7 días» (no «la que da Entrada única»)',
  /La fecha de Entrada única \+ 7 días/.test(fichas['mkp-1']) && A.resumen(porId['mkp-1']).cant === 'Fecha Entrada única + 7 d');
ok('«CR» no se enciende dentro de «crédito»', !/<strong>cr<\/strong>édito/i.test(Object.values(fichas).join('')));
ok('las siglas sí («<strong>CR</strong>», «<strong>MDA categoría 49</strong>»)', /<strong>CR<\/strong>/.test(f2) && /<strong>MDA<\/strong> <strong>categoría 49<\/strong>|<strong>MDA categoría 49<\/strong>/.test(f2));
const sinCerrar = Object.entries(fichas).filter(([, h]) => ['li', 'ul', 'ol', 'p', 'section', 'div', 'strong', 'span', 'table', 'tr'].some((t) =>
  (h.match(new RegExp('<' + t + '[\\s>]', 'g')) || []).length !== (h.match(new RegExp('</' + t + '>', 'g')) || []).length)).map(([id]) => id);
ok('las 73 fichas con el HTML balanceado', sinCerrar.length === 0, sinCerrar);
ok('ninguna ficha dice «undefined», «NaN» ni «null»', Object.values(fichas).every((h) => !/undefined|NaN|>null</.test(h)));
ok('el nombre de la fila se escapa', A.marcar('<b>x</b>', []) === '&lt;b&gt;x&lt;/b&gt;');
ok('el filtro marca lo que coincide sin perder los acentos del nombre', A.marcar('Devolución sí procede', ['devolucion']) === '<mark>Devolución</mark> sí procede');
ok('resumen de la fila: «10 días → vie 9 oct», «72 h», «Según el pago», «Fecha PAO», «En la llamada», «Sin plazo»',
  A.resumen(porId['sl-2']).cant === '10 días' && A.resumen(porId['sl-2']).fecha === 'vie 9 oct' && A.resumen(porId['gen-10']).cant === '72 h' &&
  A.resumen(porId['bt-8']).cant === 'Según el pago' && A.resumen(porId['bt-6']).cant === 'Fecha PAO' && A.resumen(porId['bt-1']).cant === 'Fecha PAO' &&
  A.resumen(porId['gen-1']).cant === 'En la llamada' && A.resumen(porId['bt-12']).cant === 'Sin plazo');
ok('filtro que coincide en el cuerpo: el fragmento lo dice con la palabra marcada («OTP» en MKP Cancelación)',
  /<mark>OTP<\/mark>/.test(A.fragmento(porId['mkp-9'], ['otp'])) && A.fragmento(porId['mkp-9'], ['otp']).length < 260);
ok('…sin acentos en la búsqueda y con ellos en el texto («validacion» → «validación», BT cambio de domicilio)', /<mark>validación<\/mark>/.test(A.fragmento(porId['bt-14'], ['validacion'])));
ok('…y si coincide en el nombre no hace falta fragmento', A.fragmento(porId['bt-2'], ['fecha']) === '');

console.log('7) El parcial y sus enganches con Index.html');
['trzPintar', 'trzAviso', 'trzAlEntrar', 'trzRevelar', 'trzAplicarBusqueda'].forEach((n) => ok('el parcial publica window.' + n, guion.indexOf('window.' + n + ' = function') > -1));
ok('el guion no lleva «//» (el quitacomentarios de Google corta ahí) ni \\p{…} (esbuild lo reescribe)', guion.indexOf('//') < 0 && guion.indexOf('\\p{') < 0);
ok('los tonos de estado se aclaran en Carbón (--tz-ok, --tz-warn, --tz-alert)', /\[data-theme="carbon"\] #tz-app\{[^}]*--tz-alert:/.test(estilos));
ok('toda caja con display propio respeta [hidden] (.tz-hoja, .tz-fila, .tz-grupo, .tz-panel)',
  ['.tz-hoja[hidden]', '.tz-fila[hidden]', '.tz-grupo[hidden]', '.tz-panel[hidden]'].every((s) => estilos.indexOf(s + '{display:none}') > -1));
const incl = index.indexOf("<?!= include('app_trazabilidad') ?>");
ok('Index incluye el parcial, después del de Formatos', incl > -1 && incl > index.indexOf("<?!= include('app_formatos') ?>"));
const sw = fuente('switchSec', index);
ok('switchSec muda la vista (trzAlEntrar) ANTES de animar la entrada', sw.indexOf('trzAlEntrar(id)') > -1 && sw.indexOf('trzAlEntrar(id)') < sw.indexOf('sectionEnter(target)'));
ok('sectionEnter anima las pestañas y la hoja de Trazabilidad', fuente('sectionEnter', index).indexOf('.tz-tabs, .tz-hoja:not([hidden])') > -1);
const rv = fuente('revealTarget', index);
ok('revealTarget abre el proceso con trzRevelar y no enseña la pista de Enter', rv.indexOf('trzRevelar(scrollEl)') > -1 && /if \(esTraz\) hideKbHint\(\);/.test(rv));
const el = fuente('elementoDeSeccion', index);
ok('elementoDeSeccion reconoce el nombre (.tz-f-nom) y la fila (.tz-fila)', el.indexOf('.tz-f-nom') > -1 && el.indexOf('.tz-fila') > -1);
ok('filtroDeSeccion lee el filtro de Trazabilidad para la dirección', fuente('filtroDeSeccion', index).indexOf('.tz-buscar input') > -1);
ok('restore: ?q= va a trzAplicarBusqueda y espera a las filas (.tz-fila)', index.indexOf('if (esTraz) { if (window.trzAplicarBusqueda) trzAplicarBusqueda(sec, q); }') > -1 && index.indexOf("'#traz-' + sec + ' .tz-fila'") > -1);
ok('«Todas» vive en la dirección: navUrl escribe linea=todas y restore la lee en sus tres caminos',
  /trzLineaUrl\(id\)/.test(fuente('navUrl', index)) && /params\.linea = linea/.test(fuente('navUrl', index)) && /&linea=/.test(fuente('navUrl', index)) &&
  index.indexOf('const restore = (sec, q, item, pub, linea) => {') > -1 && index.indexOf("if (linea === 'todas' && window.trzVerTodas") > -1 &&
  (index.match(/p\.linea \|\| ''\)/g) || []).length === 2 && index.indexOf("qs.get('linea') || ''") > -1);
['trzLineaUrl', 'trzVerTodas'].forEach((n) => ok('el parcial publica window.' + n, guion.indexOf('window.' + n + ' = function') > -1));
ok('onTrazData entrega los datos a la vista y rehace los índices del buscador', /trzPintar\(data, trazAviso\)/.test(fuente('onTrazData', index)) && /trazReconstruirIndices\(\)/.test(fuente('onTrazData', index)));
ok('onTrazError avisa con la copia guardada o pinta el error', /trzAviso\(trazAviso\)/.test(fuente('onTrazError', index)) && /trzPintar\(null, trazAviso\)/.test(fuente('onTrazError', index)));
const muertos = ['trazRenderSeccion', 'trazCardHTML', 'trazToggle', 'trazJump', 'trazFiltrar', 'trazPintarAvisos', 'trazResetReveals', 'TRAZ_IC',
  'initBtReveals', 'initSlReveals', 'initSlmReveals', 'initMkpReveals', 'initTdaReveals', 'initGenReveals', 'btRevealsReady', '.traz-card', '.traz-find', '.traz-bar'];
ok('nada de la vista vieja queda en Index', muertos.every((m) => index.indexOf(m) < 0), muertos.filter((m) => index.indexOf(m) > -1));
ok('se quedan los datos: trazReintentar, trazSkeletons, trazMock y trazReconstruirIndices', ['trazReintentar', 'trazSkeletons', 'trazMock', 'trazReconstruirIndices'].every((n) => fuente(n, index)));
['bigticket', 'softline', 'slmensajerias', 'mkp', 'tienda', 'generales'].forEach((id) => {
  const i = index.indexOf('<section id="sec-' + id + '"'), j = index.indexOf('</section>', i), s = index.slice(i, j);
  ok('#sec-' + id + ': h1 para lectores de pantalla, su contenedor y sin encabezado visible', /<h1 class="tz-sr">Trazabilidad · /.test(s) && s.indexOf('id="traz-' + id + '"') > -1 && s.indexOf('sec-head') < 0 && s.indexOf('sec-eyebrow') < 0);
});
const devsap = index.slice(index.indexOf('<section id="sec-devsap"'), index.indexOf('</section>', index.indexOf('<section id="sec-devsap"')));
ok('Devoluciones SAP sigue con sus bloques .bt-* y su CSS', /class="bt-block/.test(devsap) && /\n\.bt-block\{/.test(index) && /\[data-theme="carbon"\] \.bt-quote\{/.test(index));
ok('las insignias del menú (SF, MKP, TDA, GEN) conservan su CSS', ['.sl-badge{', '.slm-badge{', '.mkp-badge{', '.tda-badge{', '.gen-badge{'].every((s) => index.indexOf('\n' + s) > -1));
ok('las variantes de color por sección se fueron', ['.sl-block{', '.mkp-num{', '.tda-plat{', '.gen-note{', '[data-theme="carbon"] .sl-block'].every((s) => index.indexOf(s) < 0));

console.log('\n' + (total - fallos) + ' de ' + total + ' comprobaciones' + (fallos ? ' — ' + fallos + ' FALLAN' : ' — todo bien'));
process.exit(fallos ? 1 : 0);
