// Lo que falla SOLO en oscuro: textos con contraste bajo en carbón que en aurora pasaban (o pasaban
// mejor), más las superficies y bordes claros que en carbón no deberían existir.
//   node scripts/laboratorio/oscuro-diff.mjs <informe carbón> <informe aurora> [vista…] [--todo]
import fs from 'node:fs';
const [, , A, B, ...resto] = process.argv;
const todo = resto.includes('--todo');
const SOLO = resto.filter((x) => !x.startsWith('--'));
const c = JSON.parse(fs.readFileSync(A, 'utf8'));
const a = JSON.parse(fs.readFileSync(B, 'utf8'));
const clave = (t) => t.sel + '|' + t.txt;
let total = 0;
for (const vista of Object.keys(c)) {
  if (SOLO.length && !SOLO.includes(vista)) continue;
  const rc = c[vista], ra = a[vista] || { textos: [] };
  if (rc.fallo) { console.log('=== ' + vista + ' FALLÓ ' + rc.fallo); continue; }
  const enAurora = new Map((ra.textos || []).map((t) => [clave(t), t]));
  const solo = rc.textos.filter((t) => { const x = enAurora.get(clave(t)); return todo || !x || x.r - t.r > 0.6; });
  const claras = rc.claras || [];
  const bordes = rc.bordes || [];
  if (!solo.length && !claras.length && !bordes.length) { console.log('=== ' + vista + ' — sin hallazgos propios del oscuro'); continue; }
  console.log('=== ' + vista + ' — textos ' + solo.length + ' · superficies claras ' + claras.length + ' · bordes claros ' + bordes.length + (rc.errores && rc.errores.length ? ' · ERR ' + rc.errores[0].slice(0, 80) : ''));
  total += solo.length + claras.length;
  for (const t of solo.slice(0, 40)) {
    const x = enAurora.get(clave(t));
    console.log('  T ' + String(t.r).padEnd(5) + (x ? '(aurora ' + x.r + ')' : '(aurora ok)').padEnd(15) + t.fg + ' / ' + t.bg + ' fs' + t.fs + (t.n > 1 ? ' x' + t.n : '') + ' y' + t.y + ' | ' + t.sel + ' | «' + t.txt + '»' + (t.inc ? ' [' + t.inc + ']' : ''));
  }
  for (const s of claras.slice(0, 25)) console.log('  S ' + s.bg.padEnd(10) + ' ' + s.w + 'x' + s.h + ' y' + s.y + ' | ' + s.sel);
  for (const b of bordes.slice(0, 12)) console.log('  B x' + b.n + ' ' + b.k);
}
console.log('\nTotal (textos + superficies): ' + total);
