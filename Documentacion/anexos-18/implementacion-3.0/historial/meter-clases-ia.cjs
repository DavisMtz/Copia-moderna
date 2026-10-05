// Pasa a reglas-venta.js las 12 clases del borrador de IA (anexos-18/borrador-ia-v2.js), con la
// revisión de esta sesión. Se copian por código para no meter erratas en ~200 líneas de expresiones.
const fs = require('fs');
const path = require('path');
const WT = path.join(__dirname, '..', 'wt');
const fuente = fs.readFileSync(path.join(WT, 'Documentacion', 'anexos-18', 'borrador-ia-v2.js'), 'utf8').replace(/\r\n/g, '\n');
const reglasRuta = path.join(WT, 'Extencion para chrome', 'reglas-venta.js');
let reglas = fs.readFileSync(reglasRuta, 'utf8');
const crlf = reglas.indexOf('\r\n') > -1;
reglas = reglas.replace(/\r\n/g, '\n');
if (reglas.indexOf("id: 'muneca'") > -1) throw new Error('ya están');

// Los bloques de clase: de «  {» a «  }» en el primer nivel.
const lineas = fuente.split('\n');
const bloques = {}; let actual = null;
for (const l of lineas) {
  if (l === '  {') { actual = [l]; continue; }
  if (actual) {
    actual.push(l);
    if (l === '  },' || l === '  }') {
      const texto = actual.join('\n').replace(/\},$/, '}');
      const id = (texto.match(/id: '(\w+)'/) || [])[1];
      bloques[id] = texto;
      actual = null;
    }
  }
}
const ids = Object.keys(bloques);
if (ids.length !== 12) throw new Error('esperaba 12 clases, hay ' + ids.length);

function cambia(id, a, b) {
  if (bloques[id].indexOf(a) === -1) throw new Error(id + ': no está «' + a.slice(0, 50) + '»');
  bloques[id] = bloques[id].replace(a, b);
}
/** Quita un tipo de complemento (su renglón y el comentario de arriba). */
function quita(id, tipo) {
  const ls = bloques[id].split('\n');
  const i = ls.findIndex((l) => l.indexOf("{ tipo: '" + tipo + "'") > -1);
  if (i === -1) throw new Error(id + ': no está el tipo ' + tipo);
  const desde = /^\s*\/\//.test(ls[i - 1]) ? i - 1 : i;
  ls.splice(desde, i - desde + 1);
  // el último complemento no lleva coma
  const fin = ls.findIndex((l) => /^    \]$/.test(l));
  let u = fin - 1;
  ls[u] = ls[u].replace(/\},$/, '}');
  bloques[id] = ls.join('\n');
}

// ---- La revisión ----------------------------------------------------------------------------------
// Otro artículo no es «más versión» de un juguete, una guitarra, una lámpara o un termo.
for (const id of ['muneca', 'bloquesConstruccion', 'juegoMesa', 'carroControlRemoto', 'guitarra', 'lampara', 'termo']) {
  const m = bloques[id].match(/id: '\w+', nombre: '[^']+'/);
  cambia(id, m[0], m[0] + ', sinSubidaDeModelo: true');
}
// La casa y el coche de la muñeca: hasta el triple, no el cuádruple.
cambia('muneca', "si: /^(?!.*\\b(bebe|nenuco|baby|reborn|neonato)\\b)/, topePrecio: 4,", "si: /^(?!.*\\b(bebe|nenuco|baby|reborn|neonato)\\b)/, topePrecio: 3,");
cambia('muneca', "si: /barbie|\\bken\\b/, topePrecio: 4,", "si: /barbie|\\bken\\b/, topePrecio: 3,");
// LEGO: los tres tipos que fallaron en el buscador (0, 1 y 0 de 10) se quedan fuera.
quita('bloquesConstruccion', 'minifiguras');
quita('bloquesConstruccion', 'base');
quita('bloquesConstruccion', 'llavero');

const sangria = (t) => t.split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
const grupo = (titulo, nota, lista) => '    // =========================================================================\n    // ' + titulo + '\n' +
  (nota ? nota.split('\n').map((l) => '    // ' + l).join('\n') + '\n' : '') +
  '    // =========================================================================\n' + lista.map((id) => sangria(bloques[id])).join(',\n');

const nuevo = ',\n\n' +
  grupo('Juguetes y pasatiempos',
    'Estas doce clases (v4) las redactó un modelo a ciegas y se validaron contra Liverpool: 24 de\n' +
    '24 fichas reales bien clasificadas, ninguna ficha robada a otra clase y cada plantilla de\n' +
    'búsqueda probada en el buscador (documento 18, §6). Revisadas el 04/10/2026: del LEGO se\n' +
    'quitaron las minifiguras, la base y el llavero (Liverpool los nombra distinto o no los tiene).\n' +
    'En estas categorías «Complementa con» casi no ayuda (trae relleno): manda la búsqueda.',
    ['muneca', 'bloquesConstruccion', 'juegoMesa', 'carroControlRemoto', 'guitarra']) + ',\n\n' +
  grupo('Aire libre y movilidad', '', ['casaCampana', 'scooterElectrico', 'dron']) + ',\n\n' +
  grupo('Clima, luz, termos y cómputo de escritorio', '', ['ventilador', 'lampara', 'termo', 'computadoraEscritorio']) + '\n';

// Se inserta al final de `clases: [ … ]`.
const cierre = '\n  ]\n};';
const p = reglas.lastIndexOf(cierre);
if (p === -1) throw new Error('no encuentro el cierre de clases');
reglas = reglas.slice(0, p) + nuevo.replace(/\n$/, '') + reglas.slice(p);
fs.writeFileSync(reglasRuta, crlf ? reglas.replace(/\n/g, '\r\n') : reglas);

// Comprobación: carga y cuenta.
const vm = require('vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(reglasRuta, 'utf8'), ctx);
const R = ctx.VENTEL_REGLAS;
console.log('clases:', R.clases.length, '· tipos:', R.clases.reduce((a, c) => a + c.complementos.length, 0), '· finales de línea:', crlf ? 'CRLF' : 'LF');
console.log('nuevas:', R.clases.slice(-12).map((c) => c.id + '(' + c.complementos.length + ')' + (c.servicio ? ' Care' : '') + (c.sinSubidaDeModelo ? ' sinSubida' : '')).join(' · '));
console.log('bandera g en alguna:', R.clases.some((c) => c.complementos.some((k) => k.palabras.global)));
