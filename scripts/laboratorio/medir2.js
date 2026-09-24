/*
 * ¿Cuánto gana esbuild SOBRE lo que Google ya hace? Medido en vivo (23/09/2026): HtmlService
 * sirve el HTML sin comentarios (HTML, JS y CSS) y sin sangría, pero conserva los saltos de
 * línea y los nombres. Aquí se imita eso ("como Google") y se compara con esbuild completo.
 * Validación: la pantalla Portal (Index.html) medida en vivo pesó 880 KB de userHtml.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const esbuild = require('esbuild');

const PROY = 'C:/Users/seguimientos/Desktop/Proyectos/Portal Ventel/Carpeta del proyecto';
const TARGET = 'chrome109';
const br = (s) => zlib.brotliCompressSync(Buffer.from(s, 'utf8')).length;
const kb = (n) => (n / 1024).toFixed(0);

function trocear(html) {
  const out = []; let i = 0, buf = ''; const low = html.toLowerCase();
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const fin = html.indexOf('-->', i + 4); const j = fin < 0 ? html.length : fin + 3;
      if (buf) { out.push({ t: 'marcado', s: buf }); buf = ''; }
      out.push({ t: 'comentario', s: html.slice(i, j) }); i = j; continue;
    }
    const esScript = low.startsWith('<script', i) && /[\s>]/.test(html[i + 7] || '');
    const esStyle = low.startsWith('<style', i) && /[\s>]/.test(html[i + 6] || '');
    if (esScript || esStyle) {
      const tag = esScript ? 'script' : 'style';
      const a = html.indexOf('>', i); const c = low.indexOf('</' + tag, a); const f = html.indexOf('>', c) + 1;
      if (buf) { out.push({ t: 'marcado', s: buf }); buf = ''; }
      out.push({ t: tag, apertura: html.slice(i, a + 1), s: html.slice(a + 1, c), cierre: html.slice(c, f) }); i = f; continue;
    }
    buf += html[i++];
  }
  if (buf) out.push({ t: 'marcado', s: buf });
  return out;
}
const sinSangria = (s) => s.replace(/^[ \t]+/gm, '').replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n');
const esJs = (ap) => !/\bsrc\s*=/.test(ap) && !/\btype\s*=\s*["']?(?!text\/javascript|application\/javascript|module)/i.test(ap);

// Reemplaza scriptlets por marcadores para poder procesar bloques de plantilla, y los restaura.
function conMarcadores(s, fn) {
  const guardados = [];
  const t = s.replace(/<\?[\s\S]*?\?>/g, (m) => { guardados.push(m); return '__SCRIPTLET_' + (guardados.length - 1) + '__'; });
  const r = fn(t);
  return r.replace(/__SCRIPTLET_(\d+)__/g, (m, n) => guardados[+n]);
}

function comoGoogle(html) {
  return trocear(html).map((p) => {
    if (p.t === 'comentario') return '';
    if (p.t === 'marcado') return sinSangria(p.s);
    if (p.t === 'style') {
      return p.apertura + sinSangria(p.s.replace(/\/\*[\s\S]*?\*\//g, '')) + p.cierre;
    }
    if (!esJs(p.apertura) || !p.s.trim()) return p.apertura + p.s + p.cierre;
    try {
      // esbuild sin minificar = mismo código, sin comentarios; luego sin sangría.
      const js = conMarcadores(p.s, (t) => esbuild.transformSync(t, { loader: 'js', charset: 'utf8', legalComments: 'none' }).code);
      return p.apertura + sinSangria(js) + p.cierre;
    } catch (e) { return p.apertura + sinSangria(p.s) + p.cierre; }
  }).join('');
}

let fallidos = 0;
function completo(html) {
  return trocear(html).map((p) => {
    if (p.t === 'comentario') return '';
    if (p.t === 'marcado') return sinSangria(p.s);
    if (p.t === 'style') {
      try { return p.apertura + conMarcadores(p.s, (t) => esbuild.transformSync(t, { loader: 'css', minify: true, charset: 'utf8', target: TARGET }).code.trim()) + p.cierre; }
      catch (e) { fallidos++; return p.apertura + sinSangria(p.s) + p.cierre; }
    }
    if (!esJs(p.apertura) || !p.s.trim()) return p.apertura + p.s + p.cierre;
    try { return p.apertura + conMarcadores(p.s, (t) => esbuild.transformSync(t, { loader: 'js', minify: true, charset: 'utf8', target: TARGET, legalComments: 'none' }).code.trim()) + p.cierre; }
    catch (e) { fallidos++; return p.apertura + sinSangria(p.s) + p.cierre; }
  }).join('');
}

const RE = /<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g;
const leer = (n) => { const p = path.join(PROY, n.endsWith('.html') ? n : n + '.html'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
const pantallas = fs.readdirSync(PROY).filter((f) => f.endsWith('.html') && !/^(app_.*|.*Partial)\.html$/.test(f));

console.log('PANTALLA                 como Google hoy → solo parciales con esbuild → todo con esbuild  | br: hoy → todo (KB)');
for (const f of pantallas.sort()) {
  const src = leer(f);
  const sinC = src.replace(/<!--[\s\S]*?-->/g, '');
  if (!RE.test(sinC)) continue; RE.lastIndex = 0;
  // Hoy: Google procesa la página ya ensamblada.
  const ensamblada = sinC.replace(RE, (m, n) => leer(n));
  const hoy = comoGoogle(ensamblada);
  // Fase A: parciales con esbuild; la página (plantilla) sigue como hoy.
  const faseA = comoGoogle(sinC.replace(RE, (m, n) => '\u0000' + n + '\u0000')).replace(/\u0000([^\u0000]+)\u0000/g, (m, n) => completo(leer(n)));
  // Fase A+: también los bloques de la propia página (con marcadores para los scriptlets).
  const todo = completo(sinC.replace(RE, (m, n) => '\u0000' + n + '\u0000')).replace(/\u0000([^\u0000]+)\u0000/g, (m, n) => completo(leer(n)));
  console.log(f.padEnd(24), kb(hoy.length).padStart(6), '→', kb(faseA.length).padStart(5), `(${Math.round(100 - 100 * faseA.length / hoy.length)}%)`.padStart(6),
              '→', kb(todo.length).padStart(5), `(${Math.round(100 - 100 * todo.length / hoy.length)}%)`.padStart(6), '  |', kb(br(hoy)).padStart(4), '→', kb(br(todo)).padStart(4));
}
console.log('\nBloques que no se pudieron compilar (quedaron como hoy):', fallidos);
