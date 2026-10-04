// Barrido estático: reglas CSS con fondos claros o tinta oscura FIJOS (hex/rgb, no tokens) que no
// tienen ajuste para carbón, y estilos en línea con colores fijos dentro de plantillas JS.
//   node scripts/laboratorio/oscuro-estatico.js "Carpeta del proyecto" [archivo…]
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const solo = process.argv.slice(3);
const hex2rgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
function colorDe(valor) {
  // primer color literal del valor: #hex, rgb(a), white/black
  let m = valor.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
  if (m) return { c: hex2rgb(m[0]), a: 1, txt: m[0] };
  m = valor.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,\/]+([\d.]+))?\s*\)/);
  if (m) return { c: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4], txt: m[0] };
  if (/\bwhite\b/.test(valor)) return { c: [255, 255, 255], a: 1, txt: 'white' };
  return null;
}
const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && (!solo.length || solo.includes(f) || solo.includes(f.replace('.html', ''))));
// Selectores con ajuste de carbón en CUALQUIER archivo (por la última clase o id del selector).
const conCarbon = new Set();
const todo = {};
for (const f of archivos.concat(fs.readdirSync(dir).filter((x) => x.endsWith('.html')))) {
  if (todo[f]) continue;
  todo[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of todo[f].matchAll(/\[data-theme="?carbon"?\][^{]*\{/g)) {
    for (const k of m[0].matchAll(/[.#][A-Za-z0-9_-]+/g)) conCarbon.add(k[0]);
  }
}
const salida = [];
for (const f of archivos) {
  const s = todo[f];
  // bloques <style>
  const estilos = [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => ({ css: m[1], off: m.index }));
  for (const { css, off } of estilos) {
    const sinComent = css.replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, ' '));
    for (const r of sinComent.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const sel = r[1].trim();
      if (/data-theme|@media print|data-contrast/.test(sel)) continue;
      if (/^(from|to|\d+%)/.test(sel)) continue;
      for (const d of r[2].split(';')) {
        const i = d.indexOf(':'); if (i < 0) continue;
        const prop = d.slice(0, i).trim().toLowerCase(); const val = d.slice(i + 1).trim();
        // Un token (con o sin respaldo) responde al tema: solo cuenta el color literal que quede FUERA de var().
        const sinVar = val.replace(/var\(--[A-Za-z0-9_-]+\s*(,[^()]*(\([^()]*\))?[^()]*)?\)/g, '');
        const col = colorDe(sinVar); if (!col) continue;
        let tipo = null;
        if (/^(background|background-color)$/.test(prop) && col.a >= 0.5 && L(col.c) > 0.7) tipo = 'FONDO-CLARO';
        if (/^color$/.test(prop) && col.a >= 0.5 && L(col.c) < 0.12) tipo = 'TINTA-OSCURA';
        if (!tipo) continue;
        const claves = [...sel.matchAll(/[.#][A-Za-z0-9_-]+/g)].map((x) => x[0]);
        const cubierto = claves.some((k) => conCarbon.has(k));
        const linea = s.slice(0, off + r.index).split('\n').length;
        salida.push({ f, linea, tipo, sel: sel.replace(/\s+/g, ' ').slice(0, 90), val: col.txt, cubierto });
      }
    }
  }
  // estilos en línea en plantillas JS / marcado: style="...color..."
  const lineas = s.split('\n');
  lineas.forEach((l, i) => {
    for (const m of l.matchAll(/style\s*=\s*\\?["']([^"'\\]*(?:\\.[^"'\\]*)*)\\?["']/g)) {
      const st = m[1];
      for (const d of st.split(';')) {
        const j = d.indexOf(':'); if (j < 0) continue;
        const prop = d.slice(0, j).trim().toLowerCase(); const val = d.slice(j + 1).trim();
        if (/var\(--/.test(val)) continue;
        const col = colorDe(val); if (!col) continue;
        let tipo = null;
        if (/^(background|background-color)$/.test(prop) && col.a >= 0.5 && L(col.c) > 0.7) tipo = 'INLINE-FONDO-CLARO';
        if (/^color$/.test(prop) && col.a >= 0.5 && L(col.c) < 0.12) tipo = 'INLINE-TINTA-OSCURA';
        if (tipo) salida.push({ f, linea: i + 1, tipo, sel: st.slice(0, 90), val: col.txt, cubierto: false });
      }
    }
  });
}
const porArchivo = {};
for (const x of salida) (porArchivo[x.f] = porArchivo[x.f] || []).push(x);
for (const [f, xs] of Object.entries(porArchivo)) {
  const sin = xs.filter((x) => !x.cubierto);
  console.log('=== ' + f + ' — ' + xs.length + ' fijos, ' + sin.length + ' sin ajuste de carbón');
  for (const x of sin.slice(0, 60)) console.log('  ' + String(x.linea).padStart(5) + ' ' + x.tipo.padEnd(20) + ' ' + x.val.padEnd(22) + ' ' + x.sel);
}
