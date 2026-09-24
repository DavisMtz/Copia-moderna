/*
 * Laboratorio: ¿cuánto se ahorra comprimiendo los parciales del Portal, y se rompe algo?
 * Lee los originales (no escribe en el repo) y deja la salida en ./salida para inspeccionarla.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const esbuild = require('esbuild');
const acorn = require('acorn');

const PROY = 'C:/Users/seguimientos/Desktop/Proyectos/Portal Ventel/Carpeta del proyecto';
const SALIDA = path.join(__dirname, 'salida');
fs.mkdirSync(SALIDA, { recursive: true });
const TARGET = 'chrome109';

const gz = (s) => zlib.gzipSync(Buffer.from(s, 'utf8'), { level: 9 }).length;
const br = (s) => zlib.brotliCompressSync(Buffer.from(s, 'utf8')).length;
const kb = (n) => (n / 1024).toFixed(0);

/* Parte el HTML en trozos: comentario / script / style / marcado, como lo tokeniza un navegador. */
function trocear(html) {
  const out = [];
  let i = 0, buf = '';
  const low = html.toLowerCase();
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const fin = html.indexOf('-->', i + 4);
      const j = fin < 0 ? html.length : fin + 3;
      if (buf) { out.push({ t: 'marcado', s: buf }); buf = ''; }
      out.push({ t: 'comentario', s: html.slice(i, j) });
      i = j; continue;
    }
    const esScript = low.startsWith('<script', i) && /[\s>]/.test(html[i + 7] || '');
    const esStyle = low.startsWith('<style', i) && /[\s>]/.test(html[i + 6] || '');
    if (esScript || esStyle) {
      const tag = esScript ? 'script' : 'style';
      const finApertura = html.indexOf('>', i);
      const cierre = low.indexOf('</' + tag, finApertura);
      const finCierre = html.indexOf('>', cierre) + 1;
      if (buf) { out.push({ t: 'marcado', s: buf }); buf = ''; }
      out.push({ t: tag, apertura: html.slice(i, finApertura + 1), s: html.slice(finApertura + 1, cierre),
                 cierre: html.slice(cierre, finCierre) });
      i = finCierre; continue;
    }
    buf += html[i++];
  }
  if (buf) out.push({ t: 'marcado', s: buf });
  return out;
}

function nombresGlobales(js) {
  const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script' });
  const n = new Set();
  for (const st of ast.body) {
    if (st.type === 'VariableDeclaration') st.declarations.forEach((d) => d.id.type === 'Identifier' && n.add(d.id.name));
    if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) n.add(st.id.name);
  }
  return n;
}

const problemas = [];
function compilar(nombre, html) {
  return trocear(html).map((p) => {
    if (p.t === 'comentario') return '';
    if (p.t === 'marcado') {
      // Solo sangría y líneas vacías: el espacio entre elementos en línea se conserva.
      if (/<(pre|textarea)\b/i.test(p.s)) return p.s;
      return p.s.replace(/^[ \t]+/gm, '').replace(/\n{2,}/g, '\n');
    }
    if (p.t === 'style') {
      
      const css = esbuild.transformSync(p.s, { loader: 'css', minify: true, charset: 'utf8', target: TARGET }).code.trim();
      return p.apertura + css + p.cierre;
    }
    // script
    if (/\bsrc\s*=/.test(p.apertura) || /\btype\s*=\s*["']?(?!text\/javascript|application\/javascript|module)/i.test(p.apertura)
        || !p.s.trim()) {
      return p.apertura + p.s + p.cierre;
    }
    const js = esbuild.transformSync(p.s, { loader: 'js', minify: true, charset: 'utf8', target: TARGET, legalComments: 'none' }).code.trim();
    // Comprobaciones: sigue siendo JS, no aparece un cierre de script, y los globales son los mismos.
    try { new Function(js); } catch (e) { problemas.push(nombre + ': no compila → ' + e.message); }
    if (/<\/script/i.test(js)) problemas.push(nombre + ': aparece </script en la salida');
    const a = nombresGlobales(p.s), b = nombresGlobales(js);
    const faltan = [...a].filter((x) => !b.has(x));
    if (faltan.length || a.size !== b.size) problemas.push(nombre + ': cambian los globales → ' + faltan.join(', '));
    return p.apertura + js + p.cierre;
  }).join('');
}

// ── Parciales ──
const parciales = fs.readdirSync(PROY).filter((f) => /^(app_.*|.*Partial)\.html$/.test(f));
const tabla = [];
const tam = {};
for (const f of parciales) {
  const src = fs.readFileSync(path.join(PROY, f), 'utf8');
  const out = compilar(f, src);
  fs.writeFileSync(path.join(SALIDA, f), out, 'utf8');
  tam[f.replace(/\.html$/, '')] = { src, out };
  tabla.push([f, src.length, out.length, gz(src), gz(out), br(src), br(out)]);
}
tabla.sort((x, y) => y[1] - x[1]);
let T = [0, 0, 0, 0, 0, 0];
console.log('PARCIAL                     original  → compilado | gzip orig → comp | br orig → comp  (KB)');
for (const r of tabla) {
  console.log(r[0].padEnd(26), kb(r[1]).padStart(8), '→', kb(r[2]).padStart(6), '|', kb(r[3]).padStart(6), '→', kb(r[4]).padStart(4),
              '|', kb(r[5]).padStart(5), '→', kb(r[6]).padStart(4), '  (' + Math.round(100 - 100 * r[2] / r[1]) + '% menos)');
  for (let k = 0; k < 6; k++) T[k] += r[k + 1];
}
console.log('TOTAL'.padEnd(26), kb(T[0]).padStart(8), '→', kb(T[1]).padStart(6), '|', kb(T[2]).padStart(6), '→', kb(T[3]).padStart(4),
            '|', kb(T[4]).padStart(5), '→', kb(T[5]).padStart(4));

// ── Pantallas: la página propia sin tocar + sus parciales (un nivel, como include()) ──
const RE = /<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g;
console.log('\nPANTALLA                   servida hoy → con parciales compilados | br hoy → br compilado (KB)');
const pantallas = fs.readdirSync(PROY).filter((f) => f.endsWith('.html') && !/^(app_.*|.*Partial)\.html$/.test(f));
const filas = [];
for (const f of pantallas) {
  const src = fs.readFileSync(path.join(PROY, f), 'utf8');
  const sinComent = src.replace(/<!--[\s\S]*?-->/g, '');
  let hoy = src, comp = src, n = 0;
  hoy = sinComent.replace(RE, (m, nom) => { n++; return tam[nom] ? tam[nom].src : ''; });
  comp = sinComent.replace(RE, (m, nom) => (tam[nom] ? tam[nom].out : ''));
  if (!n) continue;
  filas.push([f, hoy.length, comp.length, br(hoy), br(comp)]);
}
filas.sort((x, y) => y[1] - x[1]);
for (const r of filas) {
  console.log(r[0].padEnd(26), kb(r[1]).padStart(8), '→', kb(r[2]).padStart(6), '  |', kb(r[3]).padStart(5), '→', kb(r[4]).padStart(4),
              '  (' + Math.round(100 - 100 * r[2] / r[1]) + '% menos)');
}
console.log('\nPROBLEMAS:', problemas.length ? '\n  ' + problemas.join('\n  ') : 'ninguno');
