/*
 * Comprobación de sintaxis de los .gs y de los bloques de guion de los .html.
 *   node scripts/sintaxis.js              → todo "Carpeta del proyecto"
 *   node scripts/sintaxis.js Index.html   → solo esos archivos
 *
 * Apps Script no se puede correr en local y el editor no avisa hasta desplegar, así que
 * esto es la única red que hay contra un paréntesis suelto. Dos cuidados que parecen
 * detalles y son la diferencia entre una comprobación y un generador de falsos avisos:
 *
 *   · Los comentarios de HTML se quitan ANTES de buscar bloques de guion. Si no, la
 *     palabra "script" escrita entre <!-- --> abre un bloque fantasma y el archivo
 *     aparece roto sin estarlo.
 *   · Los bloques con plantilla de Apps Script (<?= ?> / <?!= ?>) se saltan: ese texto
 *     lo sustituye el servidor al renderizar y aquí nunca es JavaScript válido.
 */
const fs = require('fs');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');

function bloquesDeGuion(html) {
  // Fuera los comentarios de HTML, conservando los saltos de línea para que el número
  // de línea que se reporte siga siendo el del archivo real.
  const limpio = html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(limpio)) !== null) {
    out.push({ js: m[1], linea: limpio.slice(0, m.index).split('\n').length });
  }
  return out;
}

function revisa(rutaAbs) {
  const nombre = path.basename(rutaAbs);
  const src = fs.readFileSync(rutaAbs, 'utf8');
  const fallos = [];
  let revisados = 0;

  if (nombre.endsWith('.gs')) {
    revisados = 1;
    try { new Function(src); } catch (e) { fallos.push(`${nombre}: ${e.message}`); }
  } else {
    bloquesDeGuion(src).forEach((b) => {
      if (!b.js.trim()) return;
      if (b.js.indexOf('<?') !== -1) return;   // plantilla del servidor, no es JS todavía
      revisados++;
      try { new Function(b.js); } catch (e) { fallos.push(`${nombre}:${b.linea} → ${e.message}`); }
    });
  }
  return { nombre, revisados, fallos };
}

const pedidos = process.argv.slice(2);
const archivos = (pedidos.length ? pedidos : fs.readdirSync(PROY))
  .filter((f) => f.endsWith('.gs') || f.endsWith('.html'))
  .map((f) => (path.isAbsolute(f) ? f : path.join(PROY, f)))
  .filter((f) => fs.existsSync(f));

let bloques = 0;
const rotos = [];
archivos.forEach((f) => {
  const r = revisa(f);
  bloques += r.revisados;
  r.fallos.forEach((x) => rotos.push(x));
});

console.log(`${archivos.length} archivos · ${bloques} bloques comprobados`);
if (rotos.length) {
  console.log('\nFALLOS:');
  rotos.forEach((x) => console.log('  ✗ ' + x));
  process.exit(1);
}
console.log('Sin errores de sintaxis.');
