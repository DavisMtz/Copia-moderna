/**
 * Evaluación humana de «Vende más» (fase B del documento 18): calcula el resultado.
 *
 *   node calcular.cjs evaluador-1.csv evaluador-2.csv [evaluador-3.csv]
 *   node calcular.cjs hoja-con-varias-columnas.csv
 *   … --json     → lo mismo, como datos
 *
 * Cada archivo es la hoja ya contestada, exportada como CSV (de Google Sheets o de Excel). Solo
 * se leen la columna «Fila» y las de respuesta: la que empieza por «¿La ofrecerías…», o varias
 * llamadas «Evaluador 1», «Evaluador 2»… Vale sí / si / s / 1 / x y no / n / 0; vacío = sin calificar.
 *
 * Qué responde:
 *   · de lo que cada versión recomienda, qué parte ofrecería un asesor (precisión) y cuántas
 *     recomendaciones útiles deja por ficha (de 3);
 *   · si la 3.0 es mejor que la 2.9 EN LAS MISMAS FICHAS, con su margen de error;
 *   · qué tan de acuerdo están los evaluadores entre sí (κ y AC1): sin acuerdo, lo de arriba es
 *     la opinión de una persona.
 * No mide ventas: es un indicio de aceptación (documento 18, §5 y §7).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { leerDatos, azar, SEMILLA } = require('./armar-hoja.cjs');

const AQUI = __dirname;
const BOM = String.fromCharCode(0xFEFF);

// ---------------------------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------------------------

/** Un CSV a renglones de celdas: comillas, comas dentro de comillas, BOM, y «,», «;» o tabulador. */
function leerCsv(texto) {
  let t = String(texto);
  if (t.charAt(0) === BOM) t = t.slice(1);
  const primera = t.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const sep = [',', ';', '\t'].map((s) => [s, primera.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = [];
  let fila = [], campo = '', enComillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c !== '"') campo += c;
      else if (t[i + 1] === '"') { campo += '"'; i++; }
      else enComillas = false;
    } else if (c === '"' && campo === '') enComillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo); campo = ''; filas.push(fila); fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}

/** «Sí», «si», «S», «1», «x» → 1; «no», «N», «0» → 0; vacío → null; lo demás → undefined (no se entiende). */
function voto(v) {
  // Excel a veces exporta en ANSI y la «í» llega rota: solo cuentan las letras y los números.
  const crudo = String(v == null ? '' : v).trim();
  const s = crudo.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '');
  if (crudo === '') return null;
  if (['si', 's', '1', 'x', 'yes', 'y', 'true', 'verdadero'].indexOf(s) > -1) return 1;
  if (['no', 'n', '0', 'false', 'falso'].indexOf(s) > -1) return 0;
  return undefined;
}

/** `archivos`: [{ nombre, texto }] → { evaluadores: [nombre], votos: { fila: [0 | 1 | null, …] }, errores: [texto] }. */
function leerRespuestas(archivos) {
  const evaluadores = [], crudo = [], errores = [];
  archivos.forEach((arch) => {
    const filas = leerCsv(arch.texto);
    if (!filas.length) throw new Error(arch.nombre + ': está vacío');
    const cab = filas[0].map((c) => c.trim());
    const iFila = cab.findIndex((c) => /^fila$/i.test(c));
    if (iFila === -1) throw new Error(arch.nombre + ': no tiene la columna «Fila»');
    const cols = cab.map((c, i) => (/la ofrecer|^evaluador|^respuesta/i.test(c) ? i : -1)).filter((i) => i > -1);
    if (!cols.length) throw new Error(arch.nombre + ': no tiene columna de respuesta («¿La ofrecerías…» o «Evaluador N»)');
    cols.forEach((col) => {
      const e = evaluadores.length;
      evaluadores.push(cols.length === 1 ? arch.nombre : cab[col]);
      filas.slice(1).forEach((f) => {
        const n = Number(String(f[iFila] || '').trim());
        if (!Number.isInteger(n) || n < 1) return;
        const v = voto(f[col]);
        if (v === undefined) errores.push(evaluadores[e] + ', fila ' + n + ': no se entiende «' + String(f[col]).trim().slice(0, 30) + '»');
        else if (v !== null) crudo.push([n, e, v]);
      });
    });
  });
  const votos = {};
  crudo.forEach((x) => { (votos[x[0]] = votos[x[0]] || evaluadores.map(() => null))[x[1]] = x[2]; });
  return { evaluadores: evaluadores, votos: votos, errores: errores };
}

/** clave.csv → [{ fila, ficha, bloque, a, b, idRec }]: `a` y `b` son la posición en la 2.9 y en la 3.0 (0 = no la recomienda). */
function leerClave(texto) {
  const filas = leerCsv(texto), cab = filas[0], col = (n) => cab.indexOf(n);
  ['fila', 'ficha', 'bloque', 'pos_2_9', 'pos_3_0'].forEach((n) => { if (col(n) === -1) throw new Error('clave.csv: falta la columna ' + n); });
  return filas.slice(1).map((f) => ({ fila: Number(f[col('fila')]), ficha: Number(f[col('ficha')]), bloque: f[col('bloque')],
    a: Number(f[col('pos_2_9')]) || 0, b: Number(f[col('pos_3_0')]) || 0, idRec: f[col('id_recomendacion')] }));
}

// ---------------------------------------------------------------------------------------------
// Acuerdo entre evaluadores
// ---------------------------------------------------------------------------------------------

const redondo = (x, d) => (x == null || !isFinite(x) ? null : Math.round(x * Math.pow(10, d == null ? 3 : d)) / Math.pow(10, d == null ? 3 : d));
/** (observado − esperado) / (1 − esperado); null si todos contestaron lo mismo (no hay con qué comparar). */
const corregido = (po, pe) => (pe >= 1 ? null : (po - pe) / (1 - pe));

/**
 * `tabla`: un renglón por artículo calificado, con el voto (0 | 1) de CADA evaluador. Devuelve el
 * acuerdo observado (la proporción de parejas de evaluadores que coinciden), la κ (de Cohen con
 * dos evaluadores, de Fleiss con más) y el AC1 de Gwet, que no se hunde cuando casi todo es «sí».
 */
function acuerdo(tabla) {
  const N = tabla.length, n = N ? tabla[0].length : 0;
  if (!N || n < 2) return { articulos: N, evaluadores: n, observado: null, kappa: null, ac1: null };
  let suma = 0, si = 0;
  const siPor = new Array(n).fill(0);
  tabla.forEach((votos) => {
    const k = votos.reduce((a, v) => a + v, 0);
    si += k;
    votos.forEach((v, e) => { siPor[e] += v; });
    suma += (k * (k - 1) + (n - k) * (n - k - 1)) / (n * (n - 1));
  });
  const po = suma / N, pi = si / (N * n);
  // Azar de Cohen: cada evaluador con SU proporción de «sí». De Fleiss: todos con la proporción común.
  const peKappa = n === 2 ? (siPor[0] / N) * (siPor[1] / N) + (1 - siPor[0] / N) * (1 - siPor[1] / N) : pi * pi + (1 - pi) * (1 - pi);
  const peAc1 = 2 * pi * (1 - pi);
  return { articulos: N, evaluadores: n, observado: redondo(po), proporcionSi: redondo(pi), kappa: redondo(corregido(po, peKappa)), ac1: redondo(corregido(po, peAc1)) };
}

/** Cómo se lee una κ (McHugh 2012, la referencia del documento 18). */
function lectura(k) {
  if (k == null) return 'no se puede calcular (todos contestaron lo mismo)';
  if (k < 0.21) return 'ninguno';
  if (k < 0.40) return 'mínimo';
  if (k < 0.60) return 'débil';
  if (k < 0.80) return 'moderado';
  if (k <= 0.90) return 'fuerte';
  return 'casi perfecto';
}

// ---------------------------------------------------------------------------------------------
// Precisión y comparación
// ---------------------------------------------------------------------------------------------

const media = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);

/** El puntaje de cada fila para un evaluador (su voto) o para todos (`quien` null: la proporción de «sí»). */
function puntajes(votos, quien) {
  const p = {};
  Object.keys(votos).forEach((fila) => {
    const v = quien == null ? votos[fila].filter((x) => x !== null) : [votos[fila][quien]].filter((x) => x !== null && x !== undefined);
    if (v.length) p[fila] = media(v);
  });
  return p;
}

/**
 * Una versión (`v`: 'a' = 2.9, 'b' = 3.0) en un bloque de fichas. Por ficha: `precision` (de lo que
 * mostró, qué parte se ofrecería) y `utiles` (cuántas se ofrecerían; 0 si no mostró nada). Una
 * ficha con algún renglón sin calificar no entra.
 */
function porFicha(fichas, clave, p, v) {
  const out = {};
  fichas.forEach((f) => {
    const items = clave.filter((c) => c.ficha === f.f && c[v] > 0);
    if (items.some((c) => p[c.fila] == null)) { out[f.f] = null; return; }
    const pts = items.map((c) => p[c.fila]);
    out[f.f] = { mostradas: items.length, utiles: pts.reduce((a, b) => a + b, 0), precision: items.length ? media(pts) : null };
  });
  return out;
}
function resumenVersion(fichas, clave, p, v) {
  const pf = porFicha(fichas, clave, p, v), completas = fichas.filter((f) => pf[f.f]), con = completas.filter((f) => pf[f.f].mostradas > 0);
  return { fichas: fichas.length, sinCalificar: fichas.length - completas.length, conRecomendacion: con.length,
    mostradas: con.reduce((a, f) => a + pf[f.f].mostradas, 0),
    precision: redondo(media(con.map((f) => pf[f.f].precision))), utilesPorFicha: redondo(media(completas.map((f) => pf[f.f].utiles)), 2) };
}

/** Probabilidad de un reparto así de desigual (o más) si las dos versiones fueran iguales. Dos colas. */
function pruebaDeSignos(mejor, peor) {
  const n = mejor + peor, k = Math.min(mejor, peor);
  if (!n) return null;
  let cola = 0, comb = 1;
  for (let i = 0; i <= k; i++) { cola += comb; comb = comb * (n - i) / (i + 1); }
  return redondo(Math.min(1, 2 * cola / Math.pow(2, n)), 4);
}

/** La 3.0 menos la 2.9, ficha por ficha, en útiles por ficha. Intervalo por remuestreo de fichas (4,000 veces, con semilla). */
function comparar(fichas, clave, p) {
  const A = porFicha(fichas, clave, p, 'a'), B = porFicha(fichas, clave, p, 'b');
  const d = fichas.filter((f) => A[f.f] && B[f.f]).map((f) => B[f.f].utiles - A[f.f].utiles);
  if (!d.length) return { fichas: 0 };
  const rnd = azar(SEMILLA), medias = [];
  for (let r = 0; r < 4000; r++) { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(rnd() * d.length)]; medias.push(s / d.length); }
  medias.sort((x, y) => x - y);
  const mejor = d.filter((x) => x > 1e-9).length, peor = d.filter((x) => x < -1e-9).length;
  return { fichas: d.length, diferencia: redondo(media(d), 2), ic95: [redondo(medias[Math.floor(0.025 * medias.length)], 2), redondo(medias[Math.ceil(0.975 * medias.length) - 1], 2)],
    mejor: mejor, peor: peor, igual: d.length - mejor - peor, p: pruebaDeSignos(mejor, peor) };
}

/** Todo el cálculo. `datos`: las fichas de datos-evaluacion.jsonl; `clave`: leerClave(); `r`: leerRespuestas(). */
function calcular(datos, clave, r) {
  const n = r.evaluadores.length;
  const de = (b) => datos.filter((f) => f.bloque === b);
  const bloque = (b, p) => ({ v29: resumenVersion(de(b), clave, p, 'a'), v30: resumenVersion(de(b), clave, p, 'b') });
  const todos = puntajes(r.votos, null);
  const completas = clave.filter((c) => r.votos[c.fila] && r.votos[c.fila].every((x) => x !== null));
  const pares = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const t = clave.filter((c) => r.votos[c.fila] && r.votos[c.fila][i] !== null && r.votos[c.fila][j] !== null).map((c) => [r.votos[c.fila][i], r.votos[c.fila][j]]);
    pares.push(Object.assign({ entre: [r.evaluadores[i], r.evaluadores[j]] }, acuerdo(t)));
  }
  // Para revisar las reglas: lo que ningún evaluador ofrecería, con la versión que lo recomienda.
  const porId = {}; datos.forEach((f) => { porId[f.f] = f; });
  const nadie = completas.filter((c) => r.votos[c.fila].every((x) => x === 0)).map((c) => {
    const f = porId[c.ficha], rec = f.recs.filter((x) => x.id === c.idRec)[0] || {};
    return { fila: c.fila, ficha: f.marca + ' · ' + f.nombre, recomendacion: (rec.marca || '') + ' · ' + (rec.nombre || ''), tipo: rec.tipo, en: (c.a ? '2.9' : '') + (c.a && c.b ? ' y ' : '') + (c.b ? '3.0' : '') };
  });
  return {
    evaluadores: r.evaluadores, renglones: clave.length, calificadosPorTodos: completas.length,
    calificadosPorAlguno: clave.filter((c) => todos[c.fila] != null).length, errores: r.errores,
    muestra: Object.assign(bloque('muestra', todos), { comparacion: comparar(de('muestra'), clave, todos) }),
    nuevas: bloque('nuevas', todos),
    porEvaluador: r.evaluadores.map((nombre, e) => { const p = puntajes(r.votos, e); return { evaluador: nombre, muestra: Object.assign(bloque('muestra', p), { comparacion: comparar(de('muestra'), clave, p) }), nuevas: bloque('nuevas', p) }; }),
    acuerdo: n < 2 ? null : { general: acuerdo(completas.map((c) => r.votos[c.fila])), porPareja: pares },
    nadieLaOfreceria: nadie
  };
}

// ---------------------------------------------------------------------------------------------
// El informe
// ---------------------------------------------------------------------------------------------

const pct = (x) => (x == null ? '—' : Math.round(x * 100) + ' %');
const num = (x) => (x == null ? '—' : String(x));
/**
 * Qué se puede afirmar de la comparación. Solo se dice «mejor» o «peor» si coinciden las dos
 * pruebas (el intervalo no toca el cero Y la prueba de signos da p < 0.05): con pocas fichas
 * distintas el intervalo solo se queda corto, y con respuestas al azar daba «mejor» de más.
 */
function veredicto(c) {
  const fuera = c.ic95[0] > 0 ? 1 : c.ic95[1] < 0 ? -1 : 0, signos = c.p != null && c.p < 0.05;
  if (fuera && signos) return fuera > 0 ? 'La 3.0 sale mejor, más allá del margen de error.' : 'La 3.0 sale PEOR, más allá del margen de error.';
  if (fuera || signos) return 'Apunta a que la 3.0 sale ' + (c.diferencia > 0 ? 'mejor' : 'peor') + ', pero las dos pruebas no coinciden: hacen falta más fichas para afirmarlo.';
  return 'La diferencia cabe en el margen de error: con estas fichas no se distingue.';
}
function informe(R) {
  const L = [], n = R.evaluadores.length;
  const fila = (t, a, b) => L.push('   ' + t.padEnd(34) + String(a).padStart(8) + String(b).padStart(8));
  const tabla = (B) => {
    fila('', '2.9', '3.0');
    fila('Fichas con recomendación', B.v29.conRecomendacion + '/' + B.v29.fichas, B.v30.conRecomendacion + '/' + B.v30.fichas);
    fila('Recomendaciones mostradas', B.v29.mostradas, B.v30.mostradas);
    fila('Precisión (las ofrecería)', pct(B.v29.precision), pct(B.v30.precision));
    fila('Útiles por ficha (de 3)', num(B.v29.utilesPorFicha), num(B.v30.utilesPorFicha));
    if (B.v29.sinCalificar || B.v30.sinCalificar) L.push('   (fichas con renglones sin calificar, fuera de la cuenta: ' + Math.max(B.v29.sinCalificar, B.v30.sinCalificar) + ')');
  };
  L.push('Evaluación humana de «Vende más»: la 2.9 contra la 3.0');
  L.push('Evaluadores: ' + n + ' (' + R.evaluadores.join(', ') + ')');
  L.push('Renglones: ' + R.renglones + ' · calificados por todos: ' + R.calificadosPorTodos + ' · por alguno: ' + R.calificadosPorAlguno);
  if (R.errores.length) { L.push(''); L.push('RESPUESTAS QUE NO SE ENTIENDEN (' + R.errores.length + '; cuentan como sin calificar):'); R.errores.slice(0, 20).forEach((e) => L.push('   ' + e)); }
  L.push(''); L.push('1. La muestra del §9: las mismas 50 fichas en las dos versiones' + (n > 1 ? ' (promedio de los evaluadores)' : ''));
  tabla(R.muestra);
  const c = R.muestra.comparacion;
  if (c.fichas) {
    L.push('   Diferencia en útiles por ficha (3.0 − 2.9): ' + (c.diferencia > 0 ? '+' : '') + c.diferencia + '  ·  intervalo de 95 %: ' + c.ic95[0] + ' a ' + c.ic95[1]);
    L.push('   Fichas donde gana la 3.0: ' + c.mejor + ' · donde pierde: ' + c.peor + ' · iguales: ' + c.igual + (c.p == null ? '' : ' · prueba de signos: p = ' + c.p));
    L.push('   ' + veredicto(c));
  }
  L.push(''); L.push('2. Categorías nuevas: 24 fichas que la 2.9 no reconocía');
  tabla(R.nuevas);
  L.push(''); L.push('3. Acuerdo entre evaluadores');
  if (!R.acuerdo) L.push('   Con un solo evaluador no hay acuerdo que medir: lo de arriba es la opinión de una persona.');
  else {
    const g = R.acuerdo.general;
    L.push('   En los ' + g.articulos + ' renglones que calificaron todos: coinciden en ' + pct(g.observado) + ' · κ = ' + num(g.kappa) + ' (' + lectura(g.kappa) + ') · AC1 = ' + num(g.ac1) + ' · dijeron «sí» al ' + pct(g.proporcionSi));
    if (R.acuerdo.porPareja.length > 1) R.acuerdo.porPareja.forEach((x) => L.push('   ' + x.entre.join(' y ') + ': coinciden en ' + pct(x.observado) + ' · κ = ' + num(x.kappa) + ' · AC1 = ' + num(x.ac1) + ' (' + x.articulos + ' renglones)'));
    if (g.kappa != null && g.kappa < 0.4) L.push('   Con un acuerdo así, las cifras de arriba dependen de quién califique: conviene repasar el criterio juntos y repetir.');
  }
  if (n > 1) {
    L.push(''); L.push('4. Por evaluador (precisión y útiles por ficha en la muestra; 2.9 → 3.0)');
    R.porEvaluador.forEach((e) => L.push('   ' + e.evaluador + ': ' + pct(e.muestra.v29.precision) + ' → ' + pct(e.muestra.v30.precision) + ' · ' + num(e.muestra.v29.utilesPorFicha) + ' → ' + num(e.muestra.v30.utilesPorFicha) +
      ' · categorías nuevas: ' + pct(e.nuevas.v30.precision)));
  }
  L.push(''); L.push((n > 1 ? '5' : '4') + '. Lo que ningún evaluador ofrecería (' + R.nadieLaOfreceria.length + '): es la lista para revisar reglas');
  R.nadieLaOfreceria.slice(0, 60).forEach((x) => L.push('   [' + x.en + '] ' + x.ficha.slice(0, 48) + '  →  ' + x.recomendacion.slice(0, 60) + ' (' + x.tipo + ')'));
  return L.join('\n');
}

module.exports = { leerCsv, voto, leerRespuestas, leerClave, acuerdo, lectura, puntajes, porFicha, resumenVersion, pruebaDeSignos, comparar, calcular, veredicto, informe };

if (require.main === module) {
  const args = process.argv.slice(2), json = args.indexOf('--json') > -1, archivos = args.filter((a) => a.slice(0, 2) !== '--');
  if (!archivos.length) { console.error('Uso: node calcular.cjs evaluador-1.csv evaluador-2.csv [evaluador-3.csv] [--json]'); process.exit(2); }
  const r = leerRespuestas(archivos.map((a) => ({ nombre: path.basename(a).replace(/\.csv$/i, ''), texto: fs.readFileSync(a, 'utf8') })));
  const R = calcular(leerDatos(), leerClave(fs.readFileSync(path.join(AQUI, 'clave.csv'), 'utf8')), r);
  console.log(json ? JSON.stringify(R, null, 1) : informe(R));
}
