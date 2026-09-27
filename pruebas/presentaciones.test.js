/*
 * Presentaciones en consola (26/09/2026).   node pruebas/presentaciones.test.js
 *
 * La sección sale de la hoja «Presentaciones» (Nombre | LIGA | DESCRPCION), que editan personas: cada
 * presentación se reconoce por el ARCHIVO de su enlace y su tema por el nombre. El comportamiento vive en
 * app_presentaciones.html y lo que dice Drive (título, tipo, última edición) en pvArchivos() de Portal.gs.
 * Lo que se rompe sin que se vea:
 *   · un archivo que la hoja trae dos veces sale dos veces (o pierde una de sus entradas);
 *   · el visor abre otra diapositiva, u otro archivo, que el enlace de la hoja;
 *   · el filtro vuelve a buscar en la liga («docs» coincidía con todas);
 *   · pvArchivos acepta un id del cliente (leería cualquier archivo con la cuenta del script);
 *   · que el buscador, ?item=, switchSec o revealTarget vuelvan a llamar a lo que ya no existe,
 *     o que una fila de Presentaciones caiga en la rama de Herramientas (csRevelar).
 * Caso fijo: la hoja al 26/09/2026 (presentaciones_hoja_20260926.json, 15 renglones, 13 archivos).
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
const parcialCrudo = fs.readFileSync(path.join(PROY, 'app_presentaciones.html'), 'utf8');
const parcial = parcialCrudo.replace(/\r\n/g, '\n');
const portal = fs.readFileSync(path.join(PROY, 'Portal.gs'), 'utf8').replace(/\r\n/g, '\n');
const guion = parcial.slice(parcial.indexOf('<script>') + 8, parcial.lastIndexOf('</script>'));
const estilos = parcial.slice(parcial.indexOf('<style>') + 7, parcial.indexOf('</style>'));
const FIJO = JSON.parse(fs.readFileSync(path.join(__dirname, 'presentaciones_hoja_20260926.json'), 'utf8'));
const HOJA = FIJO.hoja, DRIVE = FIJO.drive;

/* Saca el texto de una función por su nombre (cuenta llaves, respeta cadenas). */
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

/* El modelo, la ficha y la fila del parcial, evaluados de verdad en un contexto aparte. */
const ctx = { console, URL };
vm.runInNewContext(
  ['FAM', 'ORDEN', 'REGLAS', 'SIGLAS', 'ACENTOS', 'TIPO_URL', 'DOCS', 'MESES'].map((n) => 'var ' + n + ' = ' + var_(n) + ';').join('\n') + '\n' +
  'var cache = null, estado = {}, archivos = null, store = { presentaciones: [] };\n' +
  fuente('norm', index) + '\n' + fuente('linkHref', index) + '\n' +
  'function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }\n' +
  'function icon(n){ return "<i:" + n + ">"; }\n' +
  'function collectBtn(tipo, nombre){ return "<star:" + tipo + ":" + esc(nombre) + ">"; }\n' +
  'function reportBtn(sec, nombre, liga){ return "<flag:" + sec + ":" + esc(nombre) + ":" + esc(liga) + ">"; }\n' +
  ['casiMayusculas', 'enOracion', 'normal', 'docDe', 'numDiap', 'urlVisor', 'tipoPorMime', 'iconoDe', 'fuente', 'modelo', 'famDe', 'sinPrefijo',
    'fechaLarga', 'fechaCorta', 'arch', 'tipoDe', 'metaLista', 'tituloArchivo', 'metaFicha', 'avisoFicha', 'muerto', 'entrada', 'parrafos',
    'entradasHTML', 'visorHTML', 'fichaHTML', 'filaHTML', 'grupoHTML', 'guardar', 'firma'].map((n) => fuente(n)).join('\n') +
  '\nthis.api = { enOracion, docDe, numDiap, urlVisor, tipoPorMime, modelo, sinPrefijo, metaLista, tituloArchivo, metaFicha, avisoFicha, fichaHTML, filaHTML, fechaLarga, guardar, firma,' +
  ' pon: function(filas){ store.presentaciones = filas; cache = null; }, cambia: function(filas){ store.presentaciones = filas; }, limpia: function(){ estado = {}; }, drive: function(d){ archivos = d; }, FAM: FAM };' +
  '\nthis.contar = ' + /window\.pvContar = (function\(filas\)\{[\s\S]*?\n {2}\});/.exec(guion)[1] + ';' +
  '\nthis.coincide = ' + /window\.pvCoincide = (function\(fila, t\)\{[\s\S]*?\n {2}\});/.exec(guion)[1] + ';', ctx);
const A = ctx.api;

console.log('\n— Nombres —');
ok('«MENSAJERIAS» se lee «Mensajerías» (recupera su acento)', A.enOracion('MENSAJERIAS') === 'Mensajerías', A.enOracion('MENSAJERIAS'));
ok('«USO DE CTE» → «Uso de CTE» y «USO DE MDA» → «Uso de MDA» (las siglas se quedan)', A.enOracion('USO DE CTE') === 'Uso de CTE' && A.enOracion('USO DE MDA') === 'Uso de MDA');
ok('«SEPROS Y RECOGIDOS» → «Sepros y recogidos»; «LPC» (sigla corta) no cambia', A.enOracion('SEPROS Y RECOGIDOS') === 'Sepros y recogidos' && A.enOracion('LPC') === 'LPC');
ok('un nombre en mayúsculas y minúsculas se queda como lo escribió el equipo', A.enOracion('CCAIP Venta y errores CSC') === 'CCAIP Venta y errores CSC' && A.enOracion('Cat20: Mensajerías Externas (CCL)') === 'Cat20: Mensajerías Externas (CCL)');

console.log('\n— El archivo detrás del enlace —');
const d1 = A.docDe(HOJA[1].liga), dPaso = A.docDe(HOJA[8].liga), dLpc = A.docDe(HOJA[6].liga);
ok('los 15 enlaces de la hoja son archivos de Google', HOJA.every((r) => !!A.docDe(r.liga)));
ok('#slide=id.p4 → ancla y número 4', d1 && d1.clase === 'presentation' && d1.slide === 'id.p4' && A.numDiap(d1) === 4, d1);
ok('?slide=…#slide=… (PASO A PASO) → la misma ancla', dPaso && dPaso.slide === 'id.g27948f5941b_7_281' && A.numDiap(dPaso) === 0, dPaso);
ok('el documento LPC guarda su apartado (#heading=)', dLpc && dLpc.clase === 'document' && dLpc.heading === 'h.93ycjxoua1i9', dLpc);
ok('/presentation/u/1/d/… también se reconoce', (A.docDe('https://docs.google.com/presentation/u/1/d/1abcdefghijklmnopqrstu/edit') || {}).id === '1abcdefghijklmnopqrstu');
ok('ni http, ni otro dominio, ni javascript: son archivos', !A.docDe('http://docs.google.com/presentation/d/1abcdefghijklmnopqrstu/edit') && !A.docDe('https://evil.example/presentation/d/1abcdefghijklmnopqrstu') && !A.docDe('javascript:alert(1)') && !A.docDe(''));

console.log('\n— Visor —');
ok('presentación con ancla: /preview#slide=…', A.urlVisor(d1, false) === 'https://docs.google.com/presentation/d/1YBFEIrqqzi1jhI390ydQazJ01XWy5L1VxUSpp0s7yf0/preview#slide=id.p4');
ok('«Ver desde el principio»: la misma sin ancla', A.urlVisor(d1, true) === 'https://docs.google.com/presentation/d/1YBFEIrqqzi1jhI390ydQazJ01XWy5L1VxUSpp0s7yf0/preview');
ok('documento: /document/…/preview#heading=…', A.urlVisor(dLpc, false) === 'https://docs.google.com/document/d/1LdbvKAvWXuJ2J0g0p6KdJ9ml7QbMSC8uU2_L9B2Y30E/preview#heading=h.93ycjxoua1i9');
ok('un archivo de Drive va al /preview de Drive; una hoja, al de Sheets', A.urlVisor(A.docDe('https://drive.google.com/file/d/1abcdefghijklmnopqrstu/view'), false) === 'https://drive.google.com/file/d/1abcdefghijklmnopqrstu/preview' &&
  A.urlVisor(A.docDe('https://docs.google.com/spreadsheets/d/1abcdefghijklmnopqrstu/edit#gid=0'), false) === 'https://docs.google.com/spreadsheets/d/1abcdefghijklmnopqrstu/preview');
ok('el visor nunca pone en la URL lo que traía la de la hoja (usp, correo…)', A.urlVisor(A.docDe('https://docs.google.com/presentation/d/1abcdefghijklmnopqrstu/edit?usp=sharing&authuser=alguien@liverpool.com.mx'), false) === 'https://docs.google.com/presentation/d/1abcdefghijklmnopqrstu/preview');

console.log('\n— Modelo: una presentación por archivo —');
A.pon(HOJA);
const M = A.modelo(), IT = M.items, porNombre = (n) => IT.find((it) => it.nombre === n);
ok('15 renglones → 13 presentaciones (Monedero y Mensajerías, una vez cada una)', IT.length === 13, IT.length);
ok('el menú cuenta 13 (pvContar)', ctx.contar(HOJA) === 13, ctx.contar(HOJA));
const mon = porNombre('MONEDERO DIGITAL'), men = porNombre('MENSAJERIAS');
ok('Monedero: dos entradas, diapositivas 4 y 12, en el orden de la hoja', mon && mon.entradas.length === 2 && mon.entradas[0].n === 4 && mon.entradas[1].n === 12, mon && mon.entradas.map((e) => e.n));
ok('la segunda entrada se nombra por lo que la distingue', mon && mon.entradas[1].etiqueta === 'Capacitacion Express ONLINE-CAT-OPERACIONES', mon && mon.entradas[1].etiqueta);
ok('Mensajerías: dos entradas; la de Cat20 conserva su nombre', men && men.entradas.length === 2 && men.entradas[1].etiqueta === 'Cat20: Mensajerías Externas (CCL)' && men.ver === 'Mensajerías');
ok('cada renglón de la hoja lleva a su presentación (porFila)', HOJA.every((r) => M.porFila.get(r)) && M.porFila.get(HOJA[11]) === mon && M.porFila.get(HOJA[9]) === men);
const TEMAS = { 'USO DE CTE': 'consulta', 'MONEDERO DIGITAL': 'pagos', 'SEPROS Y RECOGIDOS': 'postventa', 'USO DE MDA': 'mesa', 'MENSAJERIAS': 'postventa',
  'REPROCESOS': 'pagos', 'LPC': 'consulta', 'Mesa de Regalos': 'venta', 'PASO A PASO: Sepros y Recogidos Liverpool': 'postventa',
  'Plantillas Postventa para uso en Sales Force': 'postventa', 'Manual incidencias MKP | Mesa de ayuda': 'mesa', 'CCAIP Venta y errores CSC': 'venta', 'Proceso de venta CONNECT': 'venta' };
const malTema = IT.filter((it) => TEMAS[it.nombre] !== it.fam).map((it) => it.nombre + '→' + it.fam);
ok('cada presentación cae en su tema (Venta 3 · Monedero y pagos 2 · Postventa 4 · Mesa de Ayuda 2 · Sistemas 2)', !malTema.length, malTema);
A.pon([{ nombre: 'Algo nuevo del equipo', liga: 'https://docs.google.com/presentation/d/1zzzzzzzzzzzzzzzzzzzzz/edit', descripcion: '' }]);
ok('una presentación que no se reconoce va a «Otras» (no desaparece)', A.modelo().items[0].fam === 'otras');
A.pon([{ nombre: 'Sin liga', liga: '', descripcion: '' }, { nombre: 'Web', liga: 'www.liverpool.com.mx', descripcion: '' }]);
const sinLiga = A.modelo().items;
ok('sin enlace: tipo «Sin enlace», sin visor y «Abrir» apagado', sinLiga[0].tipoUrl === 'Sin enlace' && A.fichaHTML(sinLiga[0], '').indexOf('pv-marco') < 0 && A.fichaHTML(sinLiga[0], '').indexOf('cs-abrir is-off') > -1);
ok('un enlace que no es de Google: se abre, pero no hay visor', sinLiga[1].tipoUrl === 'Enlace' && A.fichaHTML(sinLiga[1], '').indexOf('pv-marco') < 0 && A.fichaHTML(sinLiga[1], '').indexOf('href="https://www.liverpool.com.mx"') > -1);
A.pon(HOJA);

console.log('\n— Filtro de la sección (pvCoincide) —');
const cuantos = (t) => HOJA.filter((r) => ctx.coincide(r, t)).length;
ok('«docs» y «google» no coinciden con nada (la liga no se busca)', cuantos('docs') === 0 && cuantos('google') === 0, [cuantos('docs'), cuantos('google')]);
ok('«monedero» encuentra los dos renglones del Monedero', cuantos('monedero') === 2);
ok('«capacitacion» encuentra el Monedero por su SEGUNDA entrada (los dos renglones)', cuantos('capacitacion') === 2);
ok('el nombre del tema NO se busca (para eso están los chips): «monedero» no trae Reprocesos', cuantos('monedero') === 2 && cuantos('postventa') === 1, [cuantos('monedero'), cuantos('postventa')]);
A.drive(DRIVE.archivos);
ok('con lo que dice Drive, el título real también se busca: «cat 28» → REPROCESOS', HOJA.filter((r) => ctx.coincide(r, 'cat 28')).map((r) => r.nombre).join() === 'REPROCESOS');
ok('y el tipo: «powerpoint» → los 4 PowerPoint (5 renglones: MDA, Mensajerías ×2, Mesa de Regalos, CCAIP)', cuantos('powerpoint') === 5, cuantos('powerpoint'));

console.log('\n— Lo que dice Drive (pvArchivos) —');
const reproc = porNombre('REPROCESOS'), sepros = porNombre('SEPROS Y RECOGIDOS'), lpc = porNombre('LPC'), mesa = porNombre('Mesa de Regalos'), ccaip = porNombre('CCAIP Venta y errores CSC');
ok('fila: «PowerPoint · jun 2026» para Mensajerías', A.metaLista(men) === 'PowerPoint · jun 2026', A.metaLista(men));
ok('fila: el archivo que no abre dice «sin acceso»', A.metaLista(sepros) === 'Presentación · sin acceso', A.metaLista(sepros));
ok('ficha: «Última edición: marzo de 2021» para el Monedero', A.metaFicha(mon).indexOf('Última edición: marzo de 2021') > -1);
ok('ficha: el nombre en Drive solo cuando dice otra cosa (REPROCESOS sí; Mensajerías y CCAIP, no)', A.tituloArchivo(reproc) === 'Cat 28: Consulta Métodos de Pago' && A.tituloArchivo(men) === '' && A.tituloArchivo(ccaip) === '' && A.tituloArchivo(lpc) === 'LPC MANUAL');
ok('ficha: «Mesa de Regalos» avisa que en Drive es la junta de 2022', A.metaFicha(mesa).indexOf('«Pres. Junta CAT 2022 Julio»') > -1);
ok('aviso solo donde el Portal no puede abrir el archivo', A.avisoFicha(sepros).indexOf('El Portal tampoco puede abrir') === 0 && A.avisoFicha(mon) === '');
A.drive(null);
ok('sin respuesta de Drive: el tipo sale del enlace y no hay fecha ni aviso', A.metaLista(men) === 'Presentación' && A.metaFicha(mon).indexOf('Última edición') < 0 && A.avisoFicha(sepros) === '');
A.drive(DRIVE.archivos);

console.log('\n— Ficha —');
const fMon = A.fichaHTML(mon, '');
ok('«Abrir» y la bandera van con el enlace de la entrada elegida (la 1.ª)', fMon.indexOf('class="cs-abrir" href="' + HOJA[1].liga + '"') > -1 && fMon.indexOf('<flag:Presentaciones:MONEDERO DIGITAL:' + HOJA[1].liga + '>') > -1);
ok('la estrella va con el nombre de la hoja de la entrada elegida (así la encuentran las colecciones)', fMon.indexOf('<star:presentaciones:MONEDERO DIGITAL>') > -1);
ok('«Copiar enlace» y «Ampliar» en la ficha', fMon.indexOf('data-pv-copiar') > -1 && fMon.indexOf('data-pv-ampliar') > -1);
ok('las dos entradas del Monedero, con su diapositiva', /data-pv-ent="0" aria-pressed="true"[^>]*>.*?diap\. 4/.test(fMon) && /data-pv-ent="1" aria-pressed="false"[^>]*>.*?diap\. 12/.test(fMon));
mon.sel = 1;
const fMon2 = A.fichaHTML(mon, '');
ok('con la 2.ª entrada elegida, «Abrir» y la bandera cambian a su enlace', fMon2.indexOf('class="cs-abrir" href="' + HOJA[11].liga + '"') > -1 && fMon2.indexOf('<flag:Presentaciones:Monedero Digital- Capacitacion Express ONLINE-CAT-OPERACIONES:' + HOJA[11].liga + '>') > -1);
ok('… y la estrella también (un favorito de la 2.ª entrada sale marcado)', fMon2.indexOf('<star:presentaciones:Monedero Digital- Capacitacion Express ONLINE-CAT-OPERACIONES>') > -1);
ok('… la ficha de la 2.ª queda marcada y el pie no repite la diapositiva (ya la dicen las fichas)', /data-pv-ent="1" aria-pressed="true"/.test(fMon2) && fMon2.indexOf('Abre en la diapositiva') < 0 && fMon2.indexOf('>Ver desde el principio<') > -1);
mon.sel = 0;
const fMesa = A.fichaHTML(mesa, '');
ok('Mesa de Regalos: «Abre en la diapositiva 36.» y «Ver desde el principio»', fMesa.indexOf('Abre en la diapositiva 36.') > -1 && fMesa.indexOf('>Ver desde el principio<') > -1);
mesa.inicio = true;
ok('desde el principio: el pie ya no dice la 36 y ofrece volver', A.fichaHTML(mesa, '').indexOf('diapositiva 36') < 0 && A.fichaHTML(mesa, '').indexOf('Volver a donde abre el enlace') > -1);
mesa.inicio = false;
const fLpc = A.fichaHTML(lpc, '');
ok('LPC es documento: visor alto (es-doc) y «Abre en el apartado del enlace.»', fLpc.indexOf('pv-marco es-doc') > -1 && fLpc.indexOf('Abre en el apartado del enlace.') > -1);
const fCon = A.fichaHTML(porNombre('Proceso de venta CONNECT'), '');
ok('CONNECT (#slide=id.p) abre en la portada: sin ancla, sin pie y sin #slide= en el visor', fCon.indexOf('pv-visor-pie') < 0 && A.docDe(HOJA[14].liga).slide === '' && A.docDe('https://docs.google.com/presentation/d/1abcdefghijklmnopqrstu/edit#slide=id.p1').slide === '');
const fCcaip = A.fichaHTML(ccaip, '');
ok('CCAIP (#slide=id.g…, sin número): «Abre donde apunta el enlace.» y «Ver desde el principio»', fCcaip.indexOf('<p>Abre donde apunta el enlace.</p>') > -1 && fCcaip.indexOf('>Ver desde el principio<') > -1);
ok('una presentación sin entradas repetidas no enseña «Abre en» (chips)', fCon.indexOf('pv-entradas') < 0);
const fMkp = A.fichaHTML(porNombre('Manual incidencias MKP | Mesa de ayuda'), '');
ok('sin ancla en el enlace (MKP) no hay pie: nada que decir de dónde abre', fMkp.indexOf('pv-marco es-doc') > -1 && fMkp.indexOf('pv-visor-pie') < 0);
ok('el pie ya no repite lo del acceso (esa pantalla de Google lo dice sola)', !/compartid[oa] contigo/.test(fMesa + fLpc + fCon));
ok('la espera va ENCIMA del marco y se quita al cargar', fMesa.indexOf('<div class="pv-marco-hueco"></div><div class="pv-marco-espera"') > -1 &&
  /\.pv-marco-espera\{position:absolute;inset:0;z-index:2;/.test(estilos) && /\.pv-marco\.listo \.pv-marco-espera\{display:none\}/.test(estilos) && /addEventListener\('load'/.test(fuente('cargarVisor')));
ok('el aviso está oculto donde no hace falta y a la vista donde sí', /data-pv-aviso hidden>/.test(fMon) && /data-pv-aviso>El Portal tampoco/.test(A.fichaHTML(sepros, '')));
ok('la hoja de abajo lleva el id del título para el diálogo (pvHojaT)', A.fichaHTML(mon, '-h').indexOf('id="pvHojaT"') > -1 && fMon.indexOf('id="pvHojaT"') < 0);
A.pon([{ nombre: '<img src=x onerror=alert(1)>', liga: 'https://docs.google.com/presentation/d/1abcdefghijklmnopqrstu/edit#slide=id.p2', descripcion: '"><script>x</script>' }]);
const xss = A.modelo().items[0], fx = A.fichaHTML(xss, '') + A.filaHTML(xss);
ok('nombre y descripción van escapados en la ficha y en la fila', fx.indexOf('<img src=x') < 0 && fx.indexOf('<script>x') < 0 && fx.indexOf('&lt;img src=x') > -1);
A.pon(HOJA);

console.log('\n— Un archivo que ni el Portal abre —');
const fSep = A.fichaHTML(porNombre('SEPROS Y RECOGIDOS'), '');
ok('Sepros: sin visor, sin «Copiar enlace» ni «Ampliar»; quedan «Abrir», la bandera y el aviso', fSep.indexOf('pv-marco') < 0 && fSep.indexOf('data-pv-copiar') < 0 && fSep.indexOf('data-pv-ampliar') < 0 &&
  fSep.indexOf('class="cs-abrir" href="' + HOJA[2].liga + '"') > -1 && fSep.indexOf('<flag:Presentaciones:SEPROS Y RECOGIDOS:') > -1 && /data-pv-aviso>El Portal tampoco/.test(fSep));
A.drive(null);
ok('… sin respuesta de Drive no se sabe: la ficha lleva visor y botones', A.fichaHTML(porNombre('SEPROS Y RECOGIDOS'), '').indexOf('pv-marco') > -1);
A.drive(DRIVE.archivos);

console.log('\n— Los datos llegan otra vez (la copia local y luego la red) —');
const idMon = porNombre('MONEDERO DIGITAL').id;
ok('el id de una presentación es el de su archivo en Drive, no su posición', idMon === 'd1YBFEIrqqzi1jhI390ydQazJ01XWy5L1VxUSpp0s7yf0');
const m1 = porNombre('MONEDERO DIGITAL');
m1.sel = 1; A.guardar(m1);
const f1 = A.firma(m1);
A.cambia(HOJA.map((r) => Object.assign({}, r)));
const m2 = A.modelo().items.find((it) => it.id === idMon);
ok('con los mismos datos en otro arreglo: otra presentación en memoria, la misma entrada elegida y la misma firma (la ficha no se repinta y el visor sigue donde iba)', m2 && m2 !== m1 && m2.sel === 1 && A.firma(m2) === f1);
A.cambia(HOJA.slice(1).concat([HOJA[0]]).map((r) => Object.assign({}, r)));
ok('si cambia el orden de la hoja, la presentación conserva su id', !!A.modelo().items.find((it) => it.id === idMon));
A.limpia(); A.pon(HOJA);

console.log('\n— Guion grande (Index.html) —');
ok('Index ya no declara renderP (pisaría la del parcial)', !/function renderP\(/.test(index));
ok('Index ya no trae .pres-card, .pres-name ni .btn-violet', !/\.pres-(card|name|top|icon|desc)|btn-violet/.test(index));
ok('el parcial se incluye después de app_plantillas', index.indexOf("include('app_presentaciones')") > index.indexOf("include('app_plantillas')") && index.indexOf("include('app_plantillas')") > -1);
ok('switchSec llama a pvAlEntrar', /if \(id === 'presentaciones' && window\.pvAlEntrar\) pvAlEntrar\(\);/.test(fuente('switchSec', index)));
const rv = fuente('revealTarget', index);
ok('revealTarget: la rama de Herramientas solo para #gr-herramientas', /classList\.contains\('cs-fila'\) && scrollEl\.closest\('#gr-herramientas'\) && window\.csRevelar/.test(rv));
ok('revealTarget pasa por pvRevelar con las filas de #gr-presentaciones', /scrollEl\.closest\('#gr-presentaciones'\) && window\.pvRevelar[\s\S]*?if \(pvRevelar\(scrollEl\)\) return;/.test(rv));
ok('el segundo Enter usa a.cs-ir (y ya no a.btn-violet)', /a\.cs-ir/.test(rv) && rv.indexOf('btn-violet') < 0);
ok('elementoDeSeccion le pregunta a pvElemento antes que a nadie', /if \(secId === 'presentaciones' && window\.pvElemento\)\{ const pv = pvElemento\(name\); if \(pv\) return pv; \}/.test(fuente('elementoDeSeccion', index)));
ok('coincideEnSeccion le pregunta a pvCoincide', /if \(sec === 'presentaciones' && window\.pvCoincide\) return pvCoincide\(item, t\);/.test(fuente('coincideEnSeccion', index)));
ok('el menú cuenta con pvContar', /setCount\('presentaciones', window\.pvContar \? pvContar\(store\.presentaciones\) : store\.presentaciones\.length\);/.test(index));
const sec = /<section id="sec-presentaciones"[\s\S]*?<\/section>/.exec(index)[0];
ok('la sección: h1 para lectores, filtro, temas, esqueleto, lista (listbox) y ficha', /<h1 class="cs-sr">Presentaciones<\/h1>/.test(sec) && /oninput="filterSec\('presentaciones',this\.value\)"/.test(sec) &&
  /id="pvChips"/.test(sec) && /id="ld-presentaciones" class="sk-grid cs-sk"/.test(sec) && /id="gr-presentaciones" class="cs-lista" role="listbox"/.test(sec) && /class="cs-ficha pv-ficha" id="pvFicha"/.test(sec));
ok('la vista de diseño trae renglones reales (con los dos repetidos)', /presentaciones:\[\n\s+\{ nombre:'MONEDERO DIGITAL'/.test(index) && index.indexOf("nombre:'Cat20: Mensajerías Externas (CCL)'") > -1 && index.indexOf("Proceso de Atención al Cliente") < 0);

console.log('\n— El parcial —');
ok('va en CRLF, como los demás parciales', /\r\n/.test(parcialCrudo) && !/[^\r]\n/.test(parcialCrudo));
ok('todo vive dentro de un IIFE: solo expone renderP y los pv*', /^\s*\/\*[\s\S]*?\*\/\s*\(function\(\)\{\n {2}'use strict';/.test(guion) && /\}\)\(\);\s*$/.test(guion) &&
  (guion.match(/window\.(\w+) = /g) || []).map((s) => s.slice(7, -3)).sort().join() === 'pvAlEntrar,pvCoincide,pvContar,pvElemento,pvRevelar,renderP');
ok('sin \\p{…} ni escapes \\u (el build y la herramienta de edición los rompen)', !/\\p\{|\\u[0-9a-fA-F]{4}/.test(parcial));
ok('el lector (display:grid) tiene su [hidden]{display:none}', /\.pv-lector\[hidden\]\{display:none\}/.test(estilos));
ok('cada cambio crea un iframe NUEVO (no se reasigna src)', /document\.createElement\('iframe'\)/.test(fuente('cargarVisor')) && !/\.src = [^;]*;\s*\}\s*$/.test(fuente('refrescar')) && fuente('refrescar').indexOf('.src') < 0);
ok('el visor solo se crea con el marco a la vista', /getClientRects\(\)\.length/.test(fuente('cargarVisor')));
ok('la media query de 1100 px es propia (la de Herramientas pierde contra la regla de columnas)', /@media \(max-width:1100px\)\{\s*\.pv-cuerpo,#ld-presentaciones\.cs-sk\{grid-template-columns:minmax\(0,1fr\)\}/.test(estilos));
ok('--cs-top se mide en esta sección', /s\.style\.setProperty\('--cs-top'/.test(fuente('medirTop')));
ok('el tope del visor se mide (ajustarVisor) al pintar, al volver a pintar, al entrar y con Drive', /ajustarVisor\(el\)/.test(fuente('pintarFicha')) && /ajustarVisor\(fi\)/.test(fuente('refrescar')) &&
  /ajustarVisor\(fi\)/.test(/window\.pvAlEntrar = function\(\)\{[\s\S]*?\n {2}\};/.exec(guion)[0]) && /ajustarVisor\(/.test(fuente('aplicarArchivos')) && /Math\.max\(220,/.test(fuente('ajustarVisor')));
ok('pantallas bajas: el cartel se encoge para que el visor quepa (1366×768 deja ~650 px)', /@media \(max-height:820px\) and \(min-width:1101px\)\{\s*\.pv-ficha \.cs-cartel,html\[data-density="compact"\] \.pv-ficha \.cs-cartel\{min-height:92px/.test(estilos));
ok('la tipografía que llega tarde vuelve a medir el visor', /document\.fonts\.addEventListener\('loadingdone'/.test(guion));
ok('dentro de cada tema, en orden alfabético', /localeCompare\(b\.ver, 'es'/.test(fuente('pintar')) && /\.sort\(alfa\)/.test(fuente('pintar')));
ok('la ficha se repinta por su firma, no por cada lista nueva', /firma\(it\) !== pintada/.test(fuente('marcar')) && !/ultimoModelo/.test(guion));
ok('«nada coincide» no promete buscar por tema y ofrece quitar el filtro', /Prueba con otra palabra del nombre/.test(fuente('pintar')) && /data-pv-limpiar/.test(fuente('pintar')) && !/Prueba con el tema/.test(guion));
ok('el lector apaga el resto de la página y la vuelve a encender', /apagarFondo\(L\)/.test(fuente('abrirLector')) && /encenderFondo\(\)/.test(fuente('cerrarLector')) && /el\.inert = true/.test(fuente('apagarFondo')));
ok('lector y hoja llevan el «retorno» después del marco de Google', /data-pv-vuelta/.test(fuente('abrirLector')) && /data-pv-vuelta/.test(fuente('abrirHoja')) &&
  /addEventListener\('focusin', vuelta\)/.test(fuente('abrirLector')) && /addEventListener\('focusin', vuelta\)/.test(fuente('abrirHoja')) && /:not\(\[data-pv-vuelta\]\)/.test(fuente('trampa')));
ok('pantallas muy bajas (≤700 px): cartel de un renglón y sin subtítulo', /@media \(max-height:700px\) and \(min-width:1101px\)\{[\s\S]*?min-height:72px[\s\S]*?\.pv-ficha \.cs-cartel-s\{display:none\}/.test(estilos));
ok('entradas: si no caben, la otra baja de renglón; con poco alto, un renglón donde la elegida no se recorta', /\.pv-entradas\{display:flex;flex-wrap:wrap;/.test(estilos) &&
  /@media \(max-height:820px\) and \(min-width:1101px\)\{[\s\S]*?\.pv-ficha \.pv-entradas\{flex-wrap:nowrap\}[\s\S]*?\.pv-ficha \.pv-entradas \.g-chip\[aria-pressed="true"\]\{flex:none;max-width:62%\}/.test(estilos));

console.log('\n— Servidor: pvArchivos (Portal.gs) —');
const srv = fuente('pvArchivos', portal);
ok('existe, es pública y no recibe argumentos (los id salen de la hoja, nunca del cliente)', /^function pvArchivos\(\) \{/.test(srv));
const guardado = {};
const ctxS = {
  CacheService: { getScriptCache: () => ({ get: (k) => guardado[k] || null, put: (k, v, s) => { guardado[k] = v; guardado.__ttl = s; } }) },
  DriveApp: { getFileById: (id) => {
    if (id === '1fwiK1Qm0P4iAOXX52-bdRO5-kx59CJfSfgT3E70CJLE') throw new Error('No item with the given ID could be found');
    const a = DRIVE.archivos[id];
    return { getName: () => a.titulo, getMimeType: () => a.tipo, getLastUpdated: () => new Date(a.editado) };
  } },
  fetchToolsData: () => ({ presentaciones: HOJA.concat([{ nombre: 'Ajena', liga: 'https://evil.example/presentation/d/1abcdefghijklmnopqrstu/edit' }]) })
};
vm.runInNewContext(srv + '\nthis.r = pvArchivos(); this.r2 = pvArchivos();', ctxS);
const R = ctxS.r;
ok('13 archivos: uno por id, sin el enlace ajeno', R.status === 'ok' && Object.keys(R.archivos).length === 13, Object.keys(R.archivos).length);
ok('el que no abre vuelve como { acceso:false }', R.archivos['1fwiK1Qm0P4iAOXX52-bdRO5-kx59CJfSfgT3E70CJLE'].acceso === false);
ok('título, tipo y última edición del resto', R.archivos['1aHHeBWcXhh72cmdD-VHzf60kKWiGA15qEKS-bXmX1kQ'].titulo === 'Cat 28: Consulta Métodos de Pago' && typeof R.archivos['1tUFffSlA77JeXLkpyR1AOFHWHhG2QkMf'].editado === 'number');
ok('se guarda seis horas y la segunda vez sale de la caché', guardado.__ttl === 21600 && JSON.stringify(ctxS.r2) === JSON.stringify(R));
const ctxE = { CacheService: ctxS.CacheService, DriveApp: ctxS.DriveApp, fetchToolsData: () => { throw new Error('sin hoja'); } };
for (const k of Object.keys(guardado)) delete guardado[k];
vm.runInNewContext(srv + '\nthis.r = pvArchivos();', ctxE);
ok('si la hoja falla: status «error» y no se guarda nada', ctxE.r.status === 'error' && !guardado.pvArchivos_v1);
for (const k of Object.keys(guardado)) delete guardado[k];
const ctxP = { CacheService: ctxS.CacheService, fetchToolsData: ctxS.fetchToolsData, DriveApp: { getFileById: (id) => {
  if (id === '1fwiK1Qm0P4iAOXX52-bdRO5-kx59CJfSfgT3E70CJLE') throw new Error('No item with the given ID could be found. Possibly because you have not edited this item or you do not have permission to access it.');
  if (id === '1LdbvKAvWXuJ2J0g0p6KdJ9ml7QbMSC8uU2_L9B2Y30E') throw new Error('Service invoked too many times for one day: driveapp.');
  return ctxS.DriveApp.getFileById(id);
} } };
vm.runInNewContext(srv + '\nthis.r = pvArchivos();', ctxP);
ok('un fallo pasajero (cuota) no marca el archivo como muerto: { error:true }, pasajero y cinco minutos', ctxP.r.archivos['1LdbvKAvWXuJ2J0g0p6KdJ9ml7QbMSC8uU2_L9B2Y30E'].error === true &&
  ctxP.r.archivos['1LdbvKAvWXuJ2J0g0p6KdJ9ml7QbMSC8uU2_L9B2Y30E'].acceso === undefined && ctxP.r.pasajero === true && guardado.__ttl === 300);
ok('«no existe / sin permiso» sí es acceso:false', ctxP.r.archivos['1fwiK1Qm0P4iAOXX52-bdRO5-kx59CJfSfgT3E70CJLE'].acceso === false);
ok('el cliente no guarda una respuesta con fallo pasajero', /!d\.pasajero/.test(fuente('cargarArchivos')));

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' comprobaciones fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
