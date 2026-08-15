/*
 * Peso REAL de cada pantalla servida, resolviendo los include() como hace Apps Script.
 *   node scripts/peso.js                → todas las pantallas
 *   node scripts/peso.js Index.html     → una
 *   node scripts/peso.js --detalle X    → de qué se compone esa pantalla
 *
 * Apps Script no sirve archivos sueltos: include() pega el contenido del partial dentro
 * del HTML y el navegador se descarga UNA sola cosa. Por eso "diferir un partial" no es
 * como quitar un <script src>: si está incluido, viaja. Esto mide lo que de verdad se
 * baja, que es la única cifra con la que se puede decidir.
 */
const fs = require('fs');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');
const RE_INCLUDE = /<\?!=\s*include\(\s*'([^']+)'\s*\)\s*;?\s*\?>/g;

const cache = {};
function fuente(nombre) {
  if (cache[nombre] === undefined) {
    const p = path.join(PROY, nombre.endsWith('.html') ? nombre : nombre + '.html');
    cache[nombre] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  return cache[nombre];
}

const ciclos = [];

/** Resuelve include() en cascada y devuelve {bytes, partes:{nombre:bytes}}. */
function resuelve(nombre, cadena, partes) {
  cadena = cadena || [];
  partes = partes || {};
  // Un partial que se incluye a sí mismo (directa o indirectamente) no es solo un
  // problema de esta cuenta: Apps Script pega el contenido en cada nivel, así que en el
  // servidor es una expansión que crece hasta reventar la plantilla.
  if (cadena.indexOf(nombre) !== -1) {
    ciclos.push(cadena.concat(nombre).join(' → '));
    return { bytes: 0, partes };
  }
  const src = fuente(nombre);
  if (src == null) return { bytes: 0, partes };
  let total = Buffer.byteLength(src, 'utf8');
  let m;
  /* Los comentarios se quitan ANTES de buscar includes: media docena de partials citan
     su propio `include('…')` en la cabecera para explicar cómo se usan, y contándolos
     como includes de verdad cada uno parece incluirse a sí mismo. */
  const limpio = src.replace(/<!--[\s\S]*?-->/g, '');
  RE_INCLUDE.lastIndex = 0;
  const hijos = [];
  while ((m = RE_INCLUDE.exec(limpio)) !== null) hijos.push(m[1]);
  const dentro = cadena.concat(nombre);
  hijos.forEach((h) => {
    // Apps Script vuelve a pegar el mismo partial si se incluye dos veces; los módulos
    // se protegen con su propia guarda, pero los BYTES viajan igual. Se cuenta cada vez.
    const r = resuelve(h, dentro, partes);
    partes[h] = (partes[h] || 0) + r.bytes;
    total += r.bytes;
  });
  return { bytes: total, partes };
}

const args = process.argv.slice(2);
const detalle = args[0] === '--detalle' ? args[1] : null;

if (detalle) {
  const r = resuelve(detalle);
  const propio = Buffer.byteLength(fuente(detalle) || '', 'utf8');
  console.log(detalle + ': ' + (r.bytes / 1024).toFixed(1) + ' KB servidos');
  console.log('  ' + (propio / 1024).toFixed(1).padStart(7) + ' KB  (el archivo en sí)');
  Object.keys(r.partes).sort((a, b) => r.partes[b] - r.partes[a]).forEach((k) => {
    console.log('  ' + (r.partes[k] / 1024).toFixed(1).padStart(7) + ' KB  ' + k);
  });
  process.exit(0);
}

const pantallas = (args.length ? args : fs.readdirSync(PROY).filter((f) => f.endsWith('.html')))
  .filter((f) => {
    const s = fuente(f);
    return s && s.indexOf('<!DOCTYPE') !== -1;   // pantalla completa, no partial
  });

const filas = pantallas.map((f) => ({ f, kb: resuelve(f).bytes / 1024 }))
  .sort((a, b) => b.kb - a.kb);
filas.forEach((r) => console.log(r.kb.toFixed(1).padStart(8) + ' KB  ' + r.f));
const total = filas.reduce((n, r) => n + r.kb, 0);
console.log('\n' + filas.length + ' pantallas · ' + total.toFixed(0) + ' KB en total · ' +
            (total / filas.length).toFixed(0) + ' KB de media');
