/**
 * Evaluación humana de «Vende más» (fase B del documento 18): arma la hoja A CIEGAS.
 *
 *   node armar-hoja.cjs      → hoja-evaluacion.csv (lo que califican los asesores) y clave.csv
 *
 * Entra `datos-evaluacion.jsonl`: en 74 fichas reales de Liverpool, lo que recomienda la
 * extensión 2.9 (`a`) y lo que recomienda la 3.0 (`b`), con su posición en cada tarjeta.
 * Sale un renglón por cada pareja ficha → recomendación (si las dos versiones recomiendan lo
 * mismo, se califica una sola vez), con las fichas y los renglones revueltos: quien califica no
 * sabe de qué versión viene cada renglón ni en qué lugar salía. Eso lo guarda `clave.csv`, que
 * NO se comparte con los evaluadores.
 *
 * No lee Liverpool ni la extensión, y no lleva datos de clientes ni de asesores.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const AQUI = __dirname;
const DATOS = path.join(AQUI, 'datos-evaluacion.jsonl');
const SEMILLA = 20261004;
const URL_FICHA = 'https://www.liverpool.com.mx/tienda/pdp/x/';

const COLUMNAS = ['Fila', 'El cliente está viendo', 'Precio', 'Ver el artículo', 'Recomendación', 'Precio de la recomendación',
  'Calificación en Liverpool', 'Lo vende', 'Ver la recomendación', '¿La ofrecerías en esta llamada? (sí / no)', 'Comentario (opcional)'];
const COLUMNAS_CLAVE = ['fila', 'ficha', 'bloque', 'id_ficha', 'id_recomendacion', 'pos_2_9', 'pos_3_0', 'tipo', 'origen'];

/** Azar con semilla (mulberry32): la hoja sale igual cada vez que se arma. */
function azar(semilla) {
  let a = semilla >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function barajar(lista, rnd) {
  const l = lista.slice();
  for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = l[i]; l[i] = l[j]; l[j] = x; }
  return l;
}

function pesos(n) {
  const fijo = Math.round(n * 100) % 100 ? n.toFixed(2) : String(Math.round(n));
  const partes = fijo.split('.');
  return '$' + partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (partes[1] ? '.' + partes[1] : '');
}
function calificacion(r) {
  if (!r.nOp || r.cal == null) return 'sin opiniones';
  return (Math.round(r.cal * 10) / 10).toFixed(1) + ' de 5 (' + r.nOp + (r.nOp === 1 ? ' opinión' : ' opiniones') + ')';
}
const BOM = String.fromCharCode(0xFEFF);
function celda(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** Con BOM y CRLF: así Excel lee los acentos, y Google Sheets lo importa igual. */
function aCsv(columnas, renglones) {
  return BOM + [columnas].concat(renglones).map((r) => r.map(celda).join(',')).join('\r\n') + '\r\n';
}

function leerDatos(ruta) {
  const fichas = fs.readFileSync(ruta || DATOS, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  fichas.forEach((f) => {
    if (!/^\d{6,}$/.test(f.id) || !f.nombre || ['muestra', 'nuevas'].indexOf(f.bloque) === -1) throw new Error('ficha ' + f.f + ' mal formada');
    ['a', 'b'].forEach((v) => {
      const pos = f.recs.map((r) => r[v]).filter(Boolean).sort();
      if (pos.join() !== pos.map((_, i) => i + 1).join()) throw new Error('ficha ' + f.f + ': posiciones de «' + v + '» = ' + pos);
    });
    f.recs.forEach((r) => { if (!/^\d{6,}$/.test(r.id) || !r.nombre || (!r.a && !r.b)) throw new Error('ficha ' + f.f + ': recomendación ' + r.id + ' mal formada'); });
  });
  return fichas;
}

/** Los renglones de la hoja, ya revueltos y numerados: [{ fila, ficha, rec }]. */
function armar(fichas, semilla) {
  const rnd = azar(semilla == null ? SEMILLA : semilla);
  const filas = [];
  barajar(fichas, rnd).forEach((f) => barajar(f.recs, rnd).forEach((r) => filas.push({ ficha: f, rec: r })));
  filas.forEach((x, i) => { x.fila = i + 1; });
  return filas;
}

const articulo = (x) => (x.marca ? x.marca + ' · ' : '') + x.nombre;
function hoja(filas) {
  return aCsv(COLUMNAS, filas.map((x) => [x.fila, articulo(x.ficha), pesos(x.ficha.precio), URL_FICHA + x.ficha.id, articulo(x.rec), pesos(x.rec.precio),
    calificacion(x.rec), x.rec.mkp ? 'Marketplace' : 'Liverpool', URL_FICHA + x.rec.id, '', '']));
}
function clave(filas) {
  return aCsv(COLUMNAS_CLAVE, filas.map((x) => [x.fila, x.ficha.f, x.ficha.bloque, x.ficha.id, x.rec.id, x.rec.a || '', x.rec.b || '', x.rec.tipo, x.rec.origen]));
}

module.exports = { SEMILLA, COLUMNAS, COLUMNAS_CLAVE, URL_FICHA, azar, barajar, pesos, calificacion, aCsv, leerDatos, armar, hoja, clave };

if (require.main === module) {
  const fichas = leerDatos();
  const filas = armar(fichas);
  fs.writeFileSync(path.join(AQUI, 'hoja-evaluacion.csv'), hoja(filas));
  fs.writeFileSync(path.join(AQUI, 'clave.csv'), clave(filas));
  const de = (b) => fichas.filter((f) => f.bloque === b);
  console.log('hoja-evaluacion.csv y clave.csv: ' + filas.length + ' renglones de ' + fichas.length + ' fichas (' + de('muestra').length + ' de la muestra del §9 y ' +
    de('nuevas').length + ' de categorías nuevas).');
  console.log('Solo en la 2.9: ' + filas.filter((x) => x.rec.a && !x.rec.b).length + ' · solo en la 3.0: ' + filas.filter((x) => !x.rec.a && x.rec.b).length +
    ' · en las dos: ' + filas.filter((x) => x.rec.a && x.rec.b).length + '.');
}
