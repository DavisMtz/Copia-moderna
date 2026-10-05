// ¿Las pruebas tienen dientes? Se copia la extensión y sus pruebas a una carpeta temporal, se rompe UNA
// cosa cada vez y se mira si alguna suite lo nota. Una mutación que nadie nota es un hueco en las pruebas.
// Al final corre la suite del recomendador contra la 2.9 (commit 6f8ab4c): tiene que fallar.
//   node Documentacion/anexos-18/implementacion-3.0/mutaciones.cjs      (tarda ~1 minuto; no toca el repo)
// Si una mutación «no se pudo aplicar», el código cambió: hay que poner al día su texto en la lista M.
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const WT = path.resolve(__dirname, '..', '..', '..');   // la raíz del repo
const TMP = path.join(require('os').tmpdir(), 'ventel-mutantes-' + Date.now());
const REPO = WT;
fs.rmSync(TMP, { recursive: true, force: true });
const copia = (rel) => fs.cpSync(path.join(WT, rel), path.join(TMP, rel), { recursive: true });
['Extencion para chrome', 'pruebas', path.join('Documentacion', 'anexos-18', 'evaluacion-humana')].forEach(copia);

const SUITES = ['ext_recomendador', 'ext_lector', 'ext_bolsa', 'ext_medicion', 'ext_evaluacion'];   // venta_cruzada prueba el servidor del Portal
function correr(suites) {
  const out = {};
  (suites || SUITES).forEach((s) => {
    const r = spawnSync(process.execPath, [path.join(TMP, 'pruebas', s + '.test.js')], { cwd: TMP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const fallas = ((r.stdout || '').match(/^\s*✖ .*$/gm) || []).filter((l) => !/fallaron/.test(l));
    out[s] = r.status === 0 ? 0 : (fallas.length || 'revienta');
  });
  return out;
}
const base = correr();
console.log('sin tocar nada:', JSON.stringify(base));
if (Object.values(base).some((v) => v !== 0)) { console.log('la copia no arranca en verde: no vale'); process.exit(1); }

const M = [
  // [archivo, qué se rompe, texto original, texto mutado, suites]
  ['Extencion para chrome/reglas-venta.js', 'sin piso de calidad', 'margen: 0.25, piso: 3.3 }', 'margen: 0.25, piso: 0 }'],
  ['Extencion para chrome/reglas-venta.js', 'sin margen: cualquier mejora cambia la elección', 'margen: 0.25, piso', 'margen: 0, piso'],
  ['Extencion para chrome/reglas-venta.js', 'sin tope de los 5 primeros', 'top: 5, topePrecio: 1.25', 'top: 50, topePrecio: 1.25'],
  ['Extencion para chrome/reglas-venta.js', 'sin tope de precio en la elección', 'top: 5, topePrecio: 1.25', 'top: 5, topePrecio: 99'],
  ['Extencion para chrome/reglas-venta.js', 'sin bono a lo que vende Liverpool', 'bonoLiverpool: 0.15', 'bonoLiverpool: 0'],
  ['Extencion para chrome/reglas-venta.js', 'la ventana de la bolsa, de 90 minutos a 70 días', 'bolsa: { ventanaMin: 90 }', 'bolsa: { ventanaMin: 100000 }'],
  ['Extencion para chrome/reglas-venta.js', 'el dron vuelve a «subir» a cualquier modelo', "servicio: true, subidaMismaVar: 'linea',", 'servicio: true,'],
  ['Extencion para chrome/reglas-venta.js', 'la mochila vuelve a poder ser maleta', "noEs: /^mochilas?\\b(?!.*\\b(viaje|cabina|equipaje)\\b)|^mochilas?\\b.*\\b(escolar(es)?|infantil(es)?|nin[oa]s?|kinder|preescolar|primaria)\\b/,", 'noEs: /^zzz/,'],
  ['Extencion para chrome/reglas-venta.js', 'el juego de mesa y sillas vuelve a ser un juego', '|^juegos? de mesa (y|con) (\\d+ )?(sillas?|bancas?|bancos?|taburetes?|sombrilla)\\b|^juegos? de mesa\\b.*\\b(sillas|bancas|comedor|sombrilla)\\b|^juegos? de mesa (de|para) (jardin|exterior|terraza|patio|centro|cafe|comedor|bar)\\b/,', '/,'],
  ['Extencion para chrome/reglas-venta.js', 'la cámara Canon vuelve a darle su batería al dron', 'requiere: /mah\\b|power ?bank|\\busb\\b|carga rapida|magsafe|inalambric/, ', ''],
  ['Extencion para chrome/reglas-venta.js', 'el monitor portátil vuelve a ser monitor de escritorio', 'ritmo|de estudio|portatil/,', 'ritmo|de estudio/,'],
  ['Extencion para chrome/recomendador-nucleo.js', 'lo agotado se ofrece', 'if (it.agotado || it.online === false) return;', ''],
  ['Extencion para chrome/recomendador-nucleo.js', 'lo que ya va en la bolsa se vuelve a ofrecer', 'if (enBolsa && enBolsa.ids[it.id]) return;', ''],
  ['Extencion para chrome/recomendador-nucleo.js', 'el primero de un carrusel sin opiniones ya no se respeta', "if (primero.origen !== 'busqueda' && !opiniones(primero)) return primero;", ''],
  ['Extencion para chrome/recomendador-nucleo.js', 'la calidad cruza niveles de compatibilidad', 'return c.compat === primero.compat && distanciaKilos(c, ctx) === dk;', 'return distanciaKilos(c, ctx) === dk;'],
  ['Extencion para chrome/recomendador-nucleo.js', 'una ficha de accesorio recibe «subida de modelo»', '    if (ctx.accesorio) return null;\n    var s = (reglas && reglas.subida)', '    var s = (reglas && reglas.subida)'],
  ['Extencion para chrome/lector-liverpool.js', 'la calificación de los artículos deja de leerse', 'cal: n && a !== null ? Math.max(0, Math.min(5, a)) : null, nOp: n', 'cal: null, nOp: n'],
  ['Extencion para chrome/bolsa-liverpool.js', 'la caché de la bolsa ya no mira de quién es', "r[CLAVE].cuenta === cuenta && (r[CLAVE].quien || '') === quien ? r[CLAVE] : null", 'r[CLAVE].cuenta === cuenta ? r[CLAVE] : null'],
  ['Extencion para chrome/medicion-local.js', 'la ventana de «en bolsa» pasa de 60 minutos a 60 días', 'var VENTANA_BOLSA = 60 * 60000;', 'var VENTANA_BOLSA = 60 * 24 * 3600000;'],
  ['Extencion para chrome/buscador-liverpool.js', 'la caché vieja (sin datos de calidad) se sigue usando', 'var FORMA = 2;', 'var FORMA = undefined;'],
  ['Documentacion/anexos-18/evaluacion-humana/armar-hoja.cjs', 'la hoja deja de revolverse', 'const j = Math.floor(rnd() * (i + 1));', 'const j = i;'],
  ['Documentacion/anexos-18/evaluacion-humana/calcular.cjs', 'κ con el azar mal calculado', 'const peAc1 = 2 * pi * (1 - pi);', 'const peAc1 = pi * (1 - pi);'],
  ['Documentacion/anexos-18/evaluacion-humana/calcular.cjs', 'un renglón sin calificar cuenta como «no»', 'if (items.some((c) => p[c.fila] == null)) { out[f.f] = null; return; }', ''],
  ['Documentacion/anexos-18/evaluacion-humana/calcular.cjs', 'la prueba de signos, a una cola', 'Math.min(1, 2 * cola / Math.pow(2, n))', 'Math.min(1, cola / Math.pow(2, n))'],
  ['Documentacion/anexos-18/evaluacion-humana/calcular.cjs', 'el veredicto afirma con una sola prueba', 'if (fuera && signos) return', 'if (fuera || signos) return']
];

let huecos = 0;
M.forEach((m) => {
  const ruta = path.join(TMP, m[0]);
  const enDisco = fs.readFileSync(ruta, 'utf8'), original = enDisco.split('\r\n').join('\n');
  const a = m[2], b = m[3];
  if (!a || original.split(a).length !== 2) { console.log('  ?? no se pudo aplicar: ' + m[1] + ' (' + (a ? original.split(a).length - 1 : 0) + ' veces)'); huecos++; return; }
  fs.writeFileSync(ruta, original.split(a).join(b));
  const r = correr();
  fs.writeFileSync(ruta, enDisco);
  const notan = Object.keys(r).filter((s) => r[s] !== 0);
  if (!notan.length) huecos++;
  console.log((notan.length ? '  ✔ ' : '  ✖ NADIE LO NOTA: ') + m[1] + (notan.length ? '  → ' + notan.map((s) => s + ' (' + r[s] + ')').join(', ') : ''));
});

// Y la suite entera contra la 2.9: tiene que fallar mucho.
const viejo = path.join(TMP, 'Extencion para chrome');
['reglas-venta.js', 'recomendador-nucleo.js', 'recomendador.js', 'buscador-liverpool.js', 'manifest.json'].forEach((f) =>
  fs.writeFileSync(path.join(viejo, f), execFileSync('git', ['-C', REPO, 'show', '6f8ab4c:Extencion para chrome/' + f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })));
console.log('contra las reglas, el núcleo y la tarjeta de la 2.9:', JSON.stringify(correr(['ext_recomendador'])));
console.log(huecos ? '\n✖ ' + huecos + ' mutaciones sin detectar o sin aplicar' : '\n✔ las ' + M.length + ' mutaciones se detectan');
fs.rmSync(TMP, { recursive: true, force: true });
