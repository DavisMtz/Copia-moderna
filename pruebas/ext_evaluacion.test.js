/*
 * Pruebas de la evaluación humana de «Vende más» (fase B del documento 18): que la hoja a ciegas
 * se arme siempre igual y no delate la versión, y que las cuentas (precisión, útiles por ficha, κ,
 * AC1 y la prueba de signos) den lo que dan a mano.
 *   Ejecutar:  node pruebas/ext_evaluacion.test.js
 *
 * No prueba la evaluación (esa la hacen los asesores): prueba el instrumento.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'Documentacion', 'anexos-18', 'evaluacion-humana');
const H = require(path.join(DIR, 'armar-hoja.cjs'));
const C = require(path.join(DIR, 'calcular.cjs'));

let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400) : ''));
}
function seccion(t) { console.log('\n' + t); }
const cerca = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= (tol || 0.0006);
const sinFin = (t) => t.replace(/\r\n/g, '\n');

seccion('1 · Los datos medidos en el laboratorio');
const datos = H.leerDatos();
const muestra = datos.filter((f) => f.bloque === 'muestra'), nuevas = datos.filter((f) => f.bloque === 'nuevas');
const recs = datos.reduce((n, f) => n + f.recs.length, 0);
ok('74 fichas: las 50 de la muestra del §9 y 24 de categorías nuevas', datos.length === 74 && muestra.length === 50 && nuevas.length === 24, [datos.length, muestra.length, nuevas.length]);
ok('209 parejas ficha → recomendación', recs === 209, recs);
ok('ninguna ficha repetida, y ninguna recomendación repetida dentro de su ficha', new Set(datos.map((f) => f.id)).size === 74 &&
  datos.every((f) => new Set(f.recs.map((r) => r.id)).size === f.recs.length));
ok('nadie se recomienda a sí mismo', datos.every((f) => f.recs.every((r) => r.id !== f.id)));
ok('cada versión muestra de 0 a 3, en posiciones 1, 2, 3 sin huecos', datos.every((f) => ['a', 'b'].every((v) => {
  const p = f.recs.map((r) => r[v]).filter(Boolean).sort(); return p.length <= 3 && p.join() === p.map((_, i) => i + 1).join();
})));
ok('en la muestra, las dos versiones reconocen la clase de las 50 fichas', muestra.every((f) => f.claseA && f.claseB));
ok('de las 24 nuevas, la 2.9 solo «reconocía» dos, y mal (la lámpara como oficina y el vaso térmico como mesa)',
  nuevas.filter((f) => f.claseA).map((f) => f.claseA + '→' + f.claseB).sort().join() === 'mesa→termo,oficina→lampara', nuevas.filter((f) => f.claseA).map((f) => f.claseA + '→' + f.claseB));
ok('con opiniones hay calificación de 0 a 5; sin opiniones, ninguna', datos.every((f) => f.recs.every((r) => (r.nOp > 0 ? r.cal >= 0 && r.cal <= 5 : r.cal === null))));
ok('la 3.0 ya no recomienda nada mal calificado con opiniones suficientes (2.5 con 8; 1.8 con 6)',
  !datos.some((f) => f.recs.some((r) => r.b && r.nOp >= 6 && r.cal < 3)) && datos.some((f) => f.recs.some((r) => r.a && !r.b && r.nOp >= 6 && r.cal < 3)),
  datos.map((f) => f.recs.filter((r) => r.b && r.nOp >= 6 && r.cal < 3).map((r) => r.nombre)).filter((l) => l.length));

seccion('2 · La hoja se arma siempre igual');
const filas = H.armar(datos);
ok('209 renglones numerados del 1 al 209', filas.length === 209 && filas.every((x, i) => x.fila === i + 1));
ok('están todas las parejas, una vez', new Set(filas.map((x) => x.ficha.f + ':' + x.rec.id)).size === 209);
ok('los renglones de una ficha van juntos (el evaluador ve el artículo una sola vez)', (() => {
  const vistas = {}; let anterior = null;
  return filas.every((x) => { const nueva = x.ficha.f !== anterior; if (nueva && vistas[x.ficha.f]) return false; vistas[x.ficha.f] = true; anterior = x.ficha.f; return true; });
})());
ok('con la misma semilla sale idéntica; con otra, distinta', JSON.stringify(H.armar(datos).map((x) => x.rec.id)) === JSON.stringify(filas.map((x) => x.rec.id)) &&
  JSON.stringify(H.armar(datos, 7).map((x) => x.rec.id)) !== JSON.stringify(filas.map((x) => x.rec.id)));
ok('hoja-evaluacion.csv es la que sale de los datos', sinFin(fs.readFileSync(path.join(DIR, 'hoja-evaluacion.csv'), 'utf8')) === sinFin(H.hoja(filas)));
ok('clave.csv es la que sale de los datos', sinFin(fs.readFileSync(path.join(DIR, 'clave.csv'), 'utf8')) === sinFin(H.clave(filas)));

seccion('3 · A ciegas: la hoja no delata de qué versión es cada renglón');
const hoja = C.leerCsv(H.hoja(filas));
ok('la hoja tiene sus 11 columnas y 209 renglones', hoja.length === 210 && hoja[0].join('|') === H.COLUMNAS.join('|') && hoja.every((r) => r.length === 11), hoja[0]);
ok('ninguna columna habla de versión, posición, tipo ni origen', !H.COLUMNAS.some((c) => /versi|posici|pos_|2\.9|3\.0|tipo|origen|clave/i.test(c)));
ok('las respuestas van vacías', hoja.slice(1).every((r) => r[9] === '' && r[10] === ''));
ok('el orden dentro de la ficha no sigue el de la tarjeta (ni en la 2.9 ni en la 3.0)', ['a', 'b'].every((v) => {
  let fuera = 0;
  datos.forEach((f) => { const p = filas.filter((x) => x.ficha.f === f.f && x.rec[v]).map((x) => x.rec[v]); if (p.length > 1 && p.join() !== p.slice().sort().join()) fuera++; });
  return fuera >= 10;
}));
ok('tampoco van primero los de una versión: lo que solo recomienda la 3.0 cae en cualquier lugar de su ficha', (() => {
  let primero = 0, ultimo = 0;
  datos.forEach((f) => { const l = filas.filter((x) => x.ficha.f === f.f); if (l.length < 3) return; const i = l.findIndex((x) => !x.rec.a && x.rec.b); if (i === 0) primero++; if (i === l.length - 1) ultimo++; });
  return primero > 0 && ultimo > 0;
})());
ok('las fichas tampoco van en el orden del documento (las de categorías nuevas quedan mezcladas)', (() => {
  const orden = []; filas.forEach((x) => { if (orden[orden.length - 1] !== x.ficha.f) orden.push(x.ficha.f); });
  return orden.slice(0, 50).some((n) => n > 50) && orden.join() !== orden.slice().sort((a, b) => a - b).join();
})());
ok('cada renglón lleva los dos enlaces a liverpool.com.mx, con el id de su artículo', filas.every((x, i) => hoja[i + 1][3] === H.URL_FICHA + x.ficha.id && hoja[i + 1][8] === H.URL_FICHA + x.rec.id));
ok('precios y calificaciones se leen bien', H.pesos(2395) === '$2,395' && H.pesos(2379.3) === '$2,379.30' && H.pesos(21009) === '$21,009' && H.pesos(57.85) === '$57.85' &&
  H.calificacion({ cal: 4.9647, nOp: 85 }) === '5.0 de 5 (85 opiniones)' && H.calificacion({ cal: 2.5, nOp: 1 }) === '2.5 de 5 (1 opinión)' && H.calificacion({ cal: null, nOp: 0 }) === 'sin opiniones',
  [H.pesos(2379.3), H.calificacion({ cal: 4.9647, nOp: 85 })]);

seccion('4 · Leer lo que contestan');
ok('un CSV con comas, comillas y saltos dentro de una celda', JSON.stringify(C.leerCsv('a,b\r\n"uno, dos","dijo ""sí"""\r\n"línea\nrota",3\r\n')) === JSON.stringify([['a', 'b'], ['uno, dos', 'dijo "sí"'], ['línea\nrota', '3']]));
ok('con BOM, y con punto y coma (Excel en español)', JSON.stringify(C.leerCsv(String.fromCharCode(0xFEFF) + 'Fila;Respuesta\n1;sí\n\n2;no\n')) === JSON.stringify([['Fila', 'Respuesta'], ['1', 'sí'], ['2', 'no']]));
ok('sí, si, S, 1 y x son sí; no, N y 0 son no; vacío es sin calificar', ['Sí', 'si', ' S ', '1', 'x', 'SÍ'].every((v) => C.voto(v) === 1) && ['No', 'n', '0', 'NO '].every((v) => C.voto(v) === 0) && C.voto('') === null && C.voto('  ') === null);
ok('la «í» rota por una exportación en ANSI sigue siendo sí', C.voto('s' + String.fromCharCode(0xFFFD)) === 1);
ok('lo que no se entiende no se adivina', C.voto('tal vez') === undefined && C.voto('?') === undefined);
const cabecera = H.COLUMNAS.join(',');
const contestada = (resp) => cabecera + '\n' + filas.map((x) => [x.fila, 'a', '1', 'u', 'b', '2', 'c', 'L', 'u', resp(x) == null ? '' : resp(x), ''].join(',')).join('\n') + '\n';
{
  const r = C.leerRespuestas([{ nombre: 'evaluador-1', texto: contestada(() => 'sí') }, { nombre: 'evaluador-2', texto: contestada((x) => (x.fila === 5 ? 'quizá' : x.fila === 6 ? '' : 'no')) }]);
  ok('dos hojas, dos evaluadores', r.evaluadores.join() === 'evaluador-1,evaluador-2' && Object.keys(r.votos).length === 209);
  ok('lo que no se entiende se avisa y cuenta como sin calificar', r.errores.length === 1 && /fila 5/.test(r.errores[0]) && r.votos[5][1] === null && r.votos[6][1] === null && r.votos[7][1] === 0, r.errores);
  const varias = C.leerRespuestas([{ nombre: 'todos', texto: 'Fila,Evaluador 1,Evaluador 2,Evaluador 3\n1,sí,no,sí\n2,no,no,\n' }]);
  ok('una sola hoja con una columna por evaluador', varias.evaluadores.join() === 'Evaluador 1,Evaluador 2,Evaluador 3' && varias.votos[1].join() === '1,0,1' && varias.votos[2][2] === null, varias);
  let error = null; try { C.leerRespuestas([{ nombre: 'mal', texto: 'Renglón,Respuesta\n1,sí\n' }]); } catch (e) { error = e.message; }
  ok('sin la columna «Fila» lo dice, no inventa', /Fila/.test(error || ''), error);
}

seccion('5 · Las fórmulas, contra ejemplos hechos a mano');
{
  // Dos evaluadores, 50 artículos: 20 sí-sí, 5 sí-no, 10 no-sí, 15 no-no → coinciden 70 %, azar 50 %, κ = 0.40.
  const t = [].concat(Array(20).fill([1, 1]), Array(5).fill([1, 0]), Array(10).fill([0, 1]), Array(15).fill([0, 0]));
  const a = C.acuerdo(t);
  ok('κ de Cohen = 0.40 y AC1 = 0.406', a.articulos === 50 && cerca(a.observado, 0.7) && cerca(a.kappa, 0.4) && cerca(a.ac1, 0.406), a);
  // Tres evaluadores, 4 artículos, con 3, 3, 0 y 1 «sí»: acuerdo 0.833, κ de Fleiss 0.657, AC1 0.676.
  const f = C.acuerdo([[1, 1, 1], [1, 1, 1], [0, 0, 0], [1, 0, 0]]);
  ok('κ de Fleiss = 0.657 y AC1 = 0.676', cerca(f.observado, 0.833) && cerca(f.kappa, 0.657) && cerca(f.ac1, 0.676), f);
  const todosSi = C.acuerdo(Array(12).fill([1, 1]));
  ok('si todos dicen «sí» a todo: κ no se puede calcular y AC1 = 1', todosSi.kappa === null && todosSi.ac1 === 1 && /no se puede/.test(C.lectura(todosSi.kappa)), todosSi);
  // La paradoja por la que se da también AC1: 45 sí-sí, 3 sí-no, 2 no-sí, 0 no-no → coinciden 90 % y κ sale negativa.
  const par = C.acuerdo([].concat(Array(45).fill([1, 1]), Array(3).fill([1, 0]), Array(2).fill([0, 1])));
  ok('con casi todo «sí», κ se hunde (−0.05) y AC1 no (0.89)', cerca(par.observado, 0.9) && par.kappa < 0 && par.ac1 > 0.85, par);
  ok('un evaluador solo: no hay acuerdo que medir', C.acuerdo(Array(5).fill([1])).kappa === null && C.acuerdo([]).kappa === null);
  ok('la lectura de κ es la de McHugh', C.lectura(0.1) === 'ninguno' && C.lectura(0.3) === 'mínimo' && C.lectura(0.5) === 'débil' && C.lectura(0.7) === 'moderado' && C.lectura(0.85) === 'fuerte' && C.lectura(0.95) === 'casi perfecto');
  ok('prueba de signos: 8 contra 2 → p = 0.1094; 5 contra 5 → 1; 10 contra 0 → 0.002; nada → sin p',
    C.pruebaDeSignos(8, 2) === 0.1094 && C.pruebaDeSignos(5, 5) === 1 && C.pruebaDeSignos(10, 0) === 0.002 && C.pruebaDeSignos(0, 0) === null, [C.pruebaDeSignos(8, 2), C.pruebaDeSignos(10, 0)]);
  // El veredicto solo afirma si coinciden el intervalo y la prueba de signos (con respuestas al azar, el intervalo solo dijo «mejor»).
  ok('veredicto: «mejor» o «peor» solo cuando coinciden las dos pruebas', /sale mejor, más allá/.test(C.veredicto({ ic95: [0.1, 0.5], p: 0.01, diferencia: 0.3 })) &&
    /sale PEOR/.test(C.veredicto({ ic95: [-0.5, -0.1], p: 0.01, diferencia: -0.3 })));
  ok('veredicto: si solo una lo dice, «apunta a», no «sale»', /Apunta a que la 3\.0 sale mejor/.test(C.veredicto({ ic95: [0.02, 0.19], p: 0.1797, diferencia: 0.1 })) &&
    /Apunta a que la 3\.0 sale peor/.test(C.veredicto({ ic95: [-0.3, 0.01], p: 0.03, diferencia: -0.1 })));
  ok('veredicto: si ninguna, no se distingue', /no se distingue/.test(C.veredicto({ ic95: [-0.1, 0.2], p: 0.5, diferencia: 0.05 })) && /no se distingue/.test(C.veredicto({ ic95: [0, 0], p: null, diferencia: 0 })));
}

seccion('6 · El cálculo completo, con respuestas inventadas de resultado conocido');
const clave = C.leerClave(H.clave(filas));
const calcula = (hojas) => C.calcular(datos, clave, C.leerRespuestas(hojas.map((h, i) => ({ nombre: 'evaluador-' + (i + 1), texto: contestada(h) }))));
const cuenta = (lista, v) => lista.reduce((n, f) => n + f.recs.filter((r) => r[v]).length, 0);
{
  // Todos dicen «sí» a todo: la precisión es 100 % y los útiles por ficha son lo que cada versión mostró.
  const R = calcula([() => 'sí', () => 'sí']);
  ok('todo «sí»: precisión 100 % en las dos', R.muestra.v29.precision === 1 && R.muestra.v30.precision === 1 && R.nuevas.v30.precision === 1, R.muestra);
  ok('…y los útiles por ficha son las mostradas entre las fichas', cerca(R.muestra.v29.utilesPorFicha, cuenta(muestra, 'a') / 50, 0.006) && cerca(R.muestra.v30.utilesPorFicha, cuenta(muestra, 'b') / 50, 0.006) &&
    cerca(R.nuevas.v29.utilesPorFicha, cuenta(nuevas, 'a') / 24, 0.006) && cerca(R.nuevas.v30.utilesPorFicha, cuenta(nuevas, 'b') / 24, 0.006), [R.muestra, R.nuevas]);
  ok('…las mostradas cuadran con los datos', R.muestra.v29.mostradas === cuenta(muestra, 'a') && R.muestra.v30.mostradas === cuenta(muestra, 'b') && R.nuevas.v30.mostradas === cuenta(nuevas, 'b'));
  ok('…y nada queda en la lista de «nadie la ofrecería»', R.nadieLaOfreceria.length === 0 && R.calificadosPorTodos === 209);
  ok('las fichas sin recomendación cuentan en los útiles (0) y no en la precisión', R.nuevas.v30.conRecomendacion === nuevas.filter((f) => f.recs.some((r) => r.b)).length && R.nuevas.v30.conRecomendacion < 24 &&
    R.nuevas.v29.conRecomendacion === nuevas.filter((f) => f.recs.some((r) => r.a)).length, R.nuevas);
}
{
  // «Sí» solo a lo que recomienda la 3.0: la 3.0 queda en 100 % y gana en cada ficha donde trae algo que la 2.9 no.
  const R = calcula([(x) => (x.rec.b ? 'sí' : 'no'), (x) => (x.rec.b ? 'sí' : 'no')]);
  const gana = muestra.filter((f) => f.recs.some((r) => r.b && !r.a)).length;
  const c = R.muestra.comparacion;
  ok('la 3.0 queda en 100 % y la 2.9 por debajo', R.muestra.v30.precision === 1 && R.muestra.v29.precision < 1 && R.muestra.v29.precision > 0.5, R.muestra);
  ok('gana en las ' + gana + ' fichas donde trae algo distinto, no pierde en ninguna', c.mejor === gana && c.peor === 0 && c.igual === 50 - gana && c.diferencia > 0 && c.ic95[0] > 0 && c.p < 0.001, c);
  ok('…y «nadie la ofrecería» son justo las que solo recomendaba la 2.9', R.nadieLaOfreceria.length === filas.filter((x) => x.rec.a && !x.rec.b).length && R.nadieLaOfreceria.every((x) => x.en === '2.9'), R.nadieLaOfreceria.length);
  ok('el acuerdo es total', R.acuerdo.general.observado === 1 && R.acuerdo.general.kappa === 1 && R.acuerdo.general.ac1 === 1, R.acuerdo.general);
  const texto = C.informe(R);
  ok('el informe lo dice en claro', /La 3\.0 sale mejor, más allá del margen de error/.test(texto) && /Categorías nuevas/.test(texto) && /κ = 1/.test(texto), texto.slice(0, 300));
}
{
  // Al revés: «sí» solo a lo de la 2.9. El informe tiene que decir que la 3.0 sale PEOR.
  const R = calcula([(x) => (x.rec.a ? 'sí' : 'no')]);
  ok('si la 3.0 fuera peor, lo dice', R.muestra.comparacion.peor > 0 && R.muestra.comparacion.mejor === 0 && /La 3\.0 sale PEOR/.test(C.informe(R)), R.muestra.comparacion);
  ok('con un solo evaluador no hay acuerdo, y el informe lo avisa', R.acuerdo === null && /un solo evaluador/.test(C.informe(R)));
}
{
  // Iguales: «sí» a todo lo que está en las dos y «no» a lo demás → útiles iguales ficha por ficha.
  const R = calcula([(x) => (x.rec.a && x.rec.b ? 'sí' : 'no')]);
  ok('cuando no hay diferencia, dice que no se distingue', R.muestra.comparacion.mejor === 0 && R.muestra.comparacion.peor === 0 && /no se distingue/.test(C.informe(R)), R.muestra.comparacion);
}
{
  // Un renglón sin calificar deja fuera a su ficha (en la versión que lo mostraba), no la cuenta como «no».
  const hueco = filas.filter((x) => x.ficha.bloque === 'muestra' && x.rec.a && x.rec.b)[0];
  const R = calcula([(x) => (x.fila === hueco.fila ? null : 'sí')]);
  ok('un renglón sin calificar saca a su ficha de la cuenta', R.muestra.v29.sinCalificar === 1 && R.muestra.v30.sinCalificar === 1 && R.muestra.v30.precision === 1 && R.calificadosPorTodos === 208 && R.muestra.comparacion.fichas === 49, R.muestra);
  // Dos evaluadores que difieren en un solo renglón: 208 de 209 acuerdos.
  const R2 = calcula([() => 'sí', (x) => (x.fila === hueco.fila ? 'no' : 'sí')]);
  ok('dos evaluadores que difieren en un renglón: coinciden en 208 de 209, y ese renglón vale medio punto', cerca(R2.acuerdo.general.observado, 208 / 209, 0.001) && R2.muestra.v30.precision < 1 && R2.muestra.v30.precision > 0.99 &&
    R2.porEvaluador[0].muestra.v30.precision === 1 && R2.porEvaluador[1].muestra.v30.precision < 1, R2.acuerdo.general);
}

console.log('\n' + (fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde'));
process.exit(fallos ? 1 : 0);
