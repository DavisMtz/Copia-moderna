/*
 * Formas de Pago en pestañas (25/09/2026).   node pruebas/formaspago.test.js
 *
 * La sección no sale de ninguna hoja: su contenido está escrito en Index.html y el
 * comportamiento vive en app_formaspago.html. Lo que se rompe sin que se vea:
 *   · el buscador (Ctrl K, ?item= y la portada) llega por id: si un fp-* desaparece, la
 *     sección se abre y no resalta nada;
 *   · una pestaña que apunta a un panel que no existe (o al revés) deja contenido
 *     inalcanzable con el teclado;
 *   · una tienda con un estado mal escrito no sale nunca al filtrar por estado;
 *   · un BIN repetido o de dos dígitos hace mentir a la consulta;
 *   · que switchSec o revealTarget vuelvan a llamar a lo que ya no existe.
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
const parcial = fs.readFileSync(path.join(PROY, 'app_formaspago.html'), 'utf8').replace(/\r\n/g, '\n');
const i0 = index.indexOf('<section id="sec-formaspago"');
const i1 = index.indexOf('<!-- ══ PAGO WEB ══ -->');
const sec = index.slice(i0, i1);
const atr = (html, re) => { const out = []; let m; while ((m = re.exec(html))) out.push(m); return out; };

console.log('1 · Destinos del buscador');
{
  // FORMAS_PAGO de app_indices.html, evaluado de verdad (no leído con una expresión regular).
  const indices = fs.readFileSync(path.join(PROY, 'app_indices.html'), 'utf8');
  const js = indices.replace(/^[\s\S]*?<script>/, '').replace(/<\/script>[\s\S]*$/, '');
  const ctx = { window: {}, console };
  vm.runInNewContext(js, ctx);
  const fp = (ctx.window.AppIndices && ctx.window.AppIndices.formasPago) || [];
  ok('app_indices expone FORMAS_PAGO', fp.length >= 8, fp.length);
  fp.forEach((it) => {
    const n = (sec.match(new RegExp('id="' + it.target + '"', 'g')) || []).length;
    ok('«' + it.name + '» → #' + it.target + ' existe una vez dentro de la sección', n === 1, n);
  });
  ok('ningún fp-* de la sección vive fuera de ella', !/id="fp-(efectivo|tiendas|transfer|fiscal|monedero|bin|fbl5n|fraudes)"/.test(index.slice(0, i0) + index.slice(i1)));
}

console.log('2 · Pestañas y paneles');
{
  const tabs = atr(sec, /<button[^>]*role="tab"[^>]*id="([^"]+)"[^>]*aria-controls="([^"]+)"[^>]*aria-selected="(true|false)"/g);
  const paneles = atr(sec, /<div class="fpg-panel" role="tabpanel" id="([^"]+)" aria-labelledby="([^"]+)"/g);
  ok('seis pestañas y seis paneles', tabs.length === 6 && paneles.length === 6, [tabs.length, paneles.length]);
  ok('una sola pestaña seleccionada al abrir', tabs.filter((t) => t[3] === 'true').length === 1);
  tabs.forEach((t) => ok('la pestaña ' + t[1] + ' controla un panel que existe', paneles.some((p) => p[1] === t[2])));
  paneles.forEach((p) => ok('el panel ' + p[1] + ' lo nombra su pestaña', tabs.some((t) => t[1] === p[2] && t[2] === p[1])));
  const visibles = atr(sec, /<div class="fpg-panel"[^>]*>/g).filter((m) => !/\shidden[\s>]/.test(m[0]));
  ok('solo el panel de la pestaña seleccionada nace visible', visibles.length === 1 && visibles[0][0].includes(tabs.find((t) => t[3] === 'true')[2]), visibles.map((v) => v[0]));
}

console.log('3 · Tiendas');
{
  const codigos = atr(sec, /<option value="([A-Z]+)">/g).map((m) => m[1]);
  ok('el selector trae los 32 estados, sin repetir', codigos.length === 32 && new Set(codigos).size === 32, codigos.length);
  const escalones = atr(sec, /<li class="fpg-esc" data-m="(\d+)">([\s\S]*?)<\/ul><\/li>/g);
  ok('hay escalones de tope, de mayor a menor', escalones.length > 0 && escalones.every((e, k) => !k || Number(escalones[k - 1][1]) > Number(e[1])), escalones.map((e) => e[1]));
  const tiendas = escalones.flatMap((e) => atr(e[2], /<li class="fpg-t"([^>]*)>[\s\S]*?<span class="fpg-t-tx"><b>([^<]+)<\/b>/g).map((t) => ({ m: e[1], attrs: t[1], n: t[2] })));
  ok('16 tiendas, sin nombres repetidos', tiendas.length === 16 && new Set(tiendas.map((t) => t.n)).size === 16, tiendas.length);
  tiendas.filter((t) => /data-est=/.test(t.attrs)).forEach((t) => {
    const est = (/data-est="([^"]*)"/.exec(t.attrs) || [])[1].split(/\s+/);
    ok(t.n + ': sus estados existen en el selector y trae la cobertura escrita', est.every((c) => codigos.includes(c)) && /data-cob="[^"]+"/.test(t.attrs), est);
  });
  ok('cada placa de logo nombra su tienda', (sec.match(/class="fpg-logo" data-logo="/g) || []).length === tiendas.length);
}

console.log('4 · BINes');
{
  const bines = atr(sec, /<li class="fpg-bin-fila (es-si|es-no)" data-bin="([^"]+)"><b>([^<]+)<\/b>/g);
  ok('14 BINes', bines.length === 14, bines.length);
  ok('todos de 3 dígitos y sin repetir', bines.every((b) => /^\d{3}$/.test(b[2]) && b[2] === b[3]) && new Set(bines.map((b) => b[2])).size === bines.length);
  ok('6 se traspasan y 8 no', bines.filter((b) => b[1] === 'es-si').length === 6 && bines.filter((b) => b[1] === 'es-no').length === 8);
}

console.log('5 · Datos que se copian');
{
  const copias = atr(sec, /data-fpg-copia="([^"]*)"/g).map((m) => m[1]);
  ok('cada botón de copiar lleva un valor', copias.length > 0 && copias.every(Boolean), copias);
  ['012914002014222862', '1422286', 'DLI931201MI9', '750160'].forEach((v) => ok('se puede copiar ' + v, copias.includes(v)));
}

console.log('6 · Enganches con el guion grande');
{
  const guion = index.slice(index.indexOf('function switchSec('));
  const cuerpo = (nombre) => { const k = index.indexOf('function ' + nombre + '('); return k === -1 ? '' : index.slice(k, index.indexOf('\n}\n', k)); };
  ok('Index incluye el parcial', /<\?!= include\('app_formaspago'\) \?>/.test(index));
  ok('switchSec llama a fpAlEntrar', /if \(id === 'formaspago' && window\.fpAlEntrar\) fpAlEntrar\(\);/.test(cuerpo('switchSec')));
  ok('revealTarget pasa por fpRevelar', /fpRevelar\(scrollEl\)/.test(cuerpo('revealTarget')));
  ok('jumpToFp pasa por fpRevelar', /fpRevelar\(el\)/.test(cuerpo('jumpToFp')));
  const muertos = ['initFpReveals', 'logosTiendaFX', 'toggleStores', 'initCopyables', 'fpRevealsReady', 'storeGrid'].filter((x) => guion.includes(x) || index.includes(x));
  ok('no queda ninguna llamada a lo que se quitó', muertos.length === 0, muertos);
  const viejas = ['fp-block', 'fp-card', 'fp-grid', 'store-card', 'store-grid', 'fraud-map', 'data-table', 'table-card', 'badge-pill', 'copyable', 'info-note'].filter((c) => new RegExp('\\.' + c + '\\b|class="[^"]*\\b' + c + '\\b').test(index));
  ok('no queda CSS ni marcado de la sección vieja', viejas.length === 0, viejas);
  ok('lo compartido sigue: .fp-nav, .fp-num y .step-list', ['.fp-nav{', '.fp-nav-chip{', '.fp-num{', '.step-list{', '.step-n{'].every((r) => index.includes(r)));
  ok('el parcial publica fpAlEntrar y fpRevelar', /window\.fpAlEntrar = function/.test(parcial) && /window\.fpRevelar = function/.test(parcial));
}

console.log('7 · Logos (se piden al abrir la sección, no viajan en la página)');
{
  const portal = fs.readFileSync(path.join(PROY, 'Portal.gs'), 'utf8');
  ok('Portal.gs expone fpLogosTiendas() y lee fp_logos', /function fpLogosTiendas\(\) \{\s*return JSON\.parse\(HtmlService\.createHtmlOutputFromFile\('fp_logos'\)\.getContent\(\)\);/.test(portal));
  const crudo = fs.readFileSync(path.join(PROY, 'fp_logos.html'), 'utf8');
  let mapa = null; try { mapa = JSON.parse(crudo); } catch (e) {}
  ok('fp_logos.html es un JSON', !!mapa);
  const placas = atr(sec, /class="fpg-logo" data-logo="([^"]+)"/g).map((m) => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  const claves = mapa ? Object.keys(mapa) : [];
  ok('un logo por cada placa, con el mismo nombre', claves.length === placas.length && placas.every((n) => claves.includes(n)), placas.filter((n) => !claves.includes(n)));
  ok('cada logo es una imagen incrustada', claves.every((k) => /^data:image\/(svg\+xml|png|webp)[,;]/.test(mapa[k])));
  ok('sin < ni & ni // ni /* (HtmlService y el quitacomentarios no tienen nada que tocar)', !/[<&]|\/\/|\/\*/.test(crudo));
  ok('el parcial los pide con AppRun y los guarda con AppCache', /AppRun\.call\('fpLogosTiendas'/.test(parcial) && /AppCache\.set\(LOGOS_CLAVE/.test(parcial));
  ok('Index no lleva los logos dentro', !/data:image\/(png|svg)/.test(sec));
}

console.log('\n' + '─'.repeat(45));
if (fallos) { console.log('✖ ' + fallos + ' de ' + total + ' comprobaciones fallaron'); process.exit(1); }
console.log('TODO OK · ' + total + ' comprobaciones');
