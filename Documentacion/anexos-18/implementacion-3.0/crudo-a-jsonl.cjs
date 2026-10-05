// Una sola vez: lo que salió de la pestaña del laboratorio (campos separados por tabuladores, que
// get_page_text aplana a espacios) → datos-evaluacion.jsonl, una ficha por renglón.
// Desde entonces lab.js (L.evaluacion) ya emite el JSONL directo y este paso no hace falta: queda
// como constancia de cómo se armó datos-evaluacion.jsonl. La marca y el nombre se separaron aquí
// por la regla «la marca va en mayúsculas»; en la hoja se enseñan juntos, así que un corte
// equivocado no cambia lo que ve quien califica.
//   node crudo-a-jsonl.cjs [salida]     → por omisión, ../evaluacion-humana/datos-evaluacion.jsonl
const fs = require('fs');
const path = require('path');
const ORIGENES = ['complementa', 'otros', 'busqueda', 'relacionados', 'masVendidos'];

/** «MARCA Nombre del artículo» → [marca, nombre]: en Liverpool la marca viene en mayúsculas. */
function marcaYNombre(resto) {
  const t = resto.split(' ');
  let i = 0;
  while (i < t.length && !/[a-zñáéíóúü]/.test(t[i])) i++;
  if (i === 0) throw new Error('sin marca: ' + resto);
  if (i === t.length) return [t[0], t.slice(1).join(' ')];   // todo en mayúsculas: «XTREM LONCHERA BREAK…»
  return [t.slice(0, i).join(' '), t.slice(i).join(' ')];
}

const fichas = [];
fs.readFileSync(path.join(__dirname, 'evaluacion-crudo.txt'), 'utf8').replace(/\r\n/g, '\n').split('\n').filter(Boolean).forEach((linea, nl) => {
  const t = linea.trim().split(/ +/);
  const mal = (m) => { throw new Error('línea ' + (nl + 1) + ': ' + m + ' → ' + linea.slice(0, 100)); };
  if (t[0] === 'F') {
    const f = Number(t[1]), bloque = t[2];
    if (f !== fichas.length + 1) mal('se esperaba la ficha ' + (fichas.length + 1));
    if (bloque !== 'muestra' && bloque !== 'nuevas') mal('bloque');
    let i = 3; while (i < t.length && !/^\d{6,}$/.test(t[i])) i++;
    if (i >= t.length) mal('sin id');
    const precio = Number(t[i + 1]); if (!isFinite(precio)) mal('precio');
    let j = i + 2; const cl = [];
    while (j < t.length && /^[a-z][A-Za-z]+$/.test(t[j]) && cl.length < 2) cl.push(t[j++]);
    if (!cl.length || (bloque === 'muestra' && cl.length !== 2)) mal('clases');
    const mn = marcaYNombre(t.slice(j).join(' '));
    fichas.push({ f: f, bloque: bloque, consulta: t.slice(3, i).join(' '), id: t[i], precio: precio, claseA: cl.length === 2 ? cl[0] : null, claseB: cl[cl.length - 1], marca: mn[0], nombre: mn[1], recs: [] });
  } else if (t[0] === 'R') {
    const ficha = fichas[fichas.length - 1];
    if (!ficha || Number(t[1]) !== ficha.f) mal('recomendación sin su ficha');
    const a = Number(t[3]), b = Number(t[4]), precio = Number(t[6]);
    if (!/^\d{6,}$/.test(t[2]) || [a, b].some((x) => [0, 1, 2, 3].indexOf(x) === -1) || (!a && !b) || !isFinite(precio)) mal('campos');
    let k = 7; while (k < t.length && ORIGENES.indexOf(t[k]) === -1) k++;
    const medio = t.slice(7, k).map(Number);
    if (k >= t.length || medio.some((x) => !isFinite(x)) || (medio.length !== 2 && medio.length !== 3)) mal('calificación');
    const nOp = medio[medio.length - 2], mkp = medio[medio.length - 1];
    if ((medio.length === 3) !== (nOp > 0) || (mkp !== 0 && mkp !== 1)) mal('opiniones');
    const mn = marcaYNombre(t.slice(k + 1).join(' '));
    ficha.recs.push({ id: t[2], a: a, b: b, tipo: t[5], precio: precio, cal: medio.length === 3 ? medio[0] : null, nOp: nOp, mkp: mkp === 1, origen: t[k], marca: mn[0], nombre: mn[1] });
  } else mal('ni F ni R');
});

// Coherencia: en cada ficha, las posiciones de cada versión son 1..k sin huecos ni repetidos.
fichas.forEach((f) => ['a', 'b'].forEach((v) => {
  const pos = f.recs.map((r) => r[v]).filter(Boolean).sort();
  if (pos.join(',') !== pos.map((_, i) => i + 1).join(',')) throw new Error('ficha ' + f.f + ': posiciones ' + v + ' = ' + pos);
}));
const destino = process.argv[2] || path.join(__dirname, '..', 'evaluacion-humana', 'datos-evaluacion.jsonl');
fs.writeFileSync(destino, fichas.map((f) => JSON.stringify(f)).join('\n') + '\n');
const recs = fichas.reduce((n, f) => n + f.recs.length, 0);
console.log(fichas.length + ' fichas · ' + recs + ' renglones · ' + destino);
