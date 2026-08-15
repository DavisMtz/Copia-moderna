/*
 * Pruebas de appEstadoInicialJson_ (Code.gs).   Ejecutar:  node pruebas/estado_inicial.test.js
 *
 * Es la función que arma el `window.__APP__` de las diecinueve pantallas. Sus valores
 * vienen de la URL, o sea de fuera, y se imprimen SIN escapar (`<?!= ?>`) dentro de un
 * <script>. Lo que se comprueba aquí no es "serializa bien": es que un enlace no pueda
 * salirse de la etiqueta. Un solo `</script>` que pase convierte cualquier enlace
 * compartido en ejecución de código en la sesión de quien lo abra.
 *
 * La segunda mitad de las pruebas mira el contrato: que estén TODOS los parámetros de
 * vista, siempre, aunque la petición no traiga ninguno — porque esa fue la avería que
 * dejó muertos los enlaces profundos de la consola durante meses (los leía y no le
 * llegaban nunca).
 *
 * Se carga el Code.gs REAL en un contexto con los stubs mínimos: si alguien cambia la
 * función o la lista, esta prueba se entera.
 *
 * Esta carpeta queda fuera de "Carpeta del proyecto", así que clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FUENTE = path.join(__dirname, '..', 'Carpeta del proyecto', 'Code.gs');

let pruebas = 0, fallos = 0;
function ok(nombre, cond, extra) {
  pruebas++;
  if (cond) { console.log(`  ✔ ${nombre}`); return; }
  fallos++;
  console.log(`  ✘ ${nombre}${extra ? '  → ' + extra : ''}`);
}
function eq(nombre, real, esperado) {
  ok(nombre, real === esperado, `esperaba ${JSON.stringify(esperado)}, llegó ${JSON.stringify(real)}`);
}

/* Code.gs entero necesita muchísimo entorno de Apps Script para EVALUARSE. No hace
   falta: se extraen las dos piezas que esta prueba mira —la lista y la función— y se
   evalúan solas. Si cualquiera de las dos se renombra o desaparece, esto falla en el
   acto, que es justo lo que se quiere de una prueba de contrato. */
function cargar() {
  const src = fs.readFileSync(FUENTE, 'utf8');

  const lista = src.match(/const PARAMS_VISTA = \[[^\]]*\];/);
  if (!lista) throw new Error('No se encontró PARAMS_VISTA en Code.gs');

  const fn = src.match(/function appEstadoInicialJson_\(baseUrl, e\) \{[\s\S]*?\n\}/);
  if (!fn) throw new Error('No se encontró appEstadoInicialJson_ en Code.gs');

  const ctx = { JSON, String, Object, Array };
  vm.createContext(ctx);
  /* La cola expone la lista: `const` dentro de un contexto de vm no se ve como
     propiedad del contexto, y esta prueba necesita leerla para comprobar el contrato. */
  vm.runInContext(
    lista[0] + '\n' + fn[0] + '\nthis.PARAMS_VISTA = PARAMS_VISTA;',
    ctx, { filename: 'Code.gs (extracto)' });
  return ctx;
}

/* Los dos separadores de línea que JavaScript reconoce y JSON no escapa. Se construyen
   en vez de escribirse: un U+2028 crudo en un archivo fuente es invisible en el editor
   y es exactamente el susto que esta prueba existe para evitar. */
const LS = String.fromCharCode(0x2028);   // LINE SEPARATOR
const PS = String.fromCharCode(0x2029);   // PARAGRAPH SEPARATOR

const ctx = cargar();
const json = (params) => ctx.appEstadoInicialJson_('https://script.google.com/x/exec', { parameter: params || {} });

console.log('\n1. Forma básica: es JSON válido y pegable en un <script>');
{
  const s = json({ folio: 'COT-2026-001' });
  let dato = null, lanzo = false;
  try { dato = JSON.parse(s); } catch (e) { lanzo = true; }
  ok('el resultado parsea como JSON', !lanzo, s.slice(0, 120));
  eq('conserva la URL base', dato.baseUrl, 'https://script.google.com/x/exec');
  eq('conserva el parámetro que vino', dato.folio, 'COT-2026-001');
}

console.log('\n2. El contrato: TODOS los parámetros de vista, siempre');
{
  const dato = JSON.parse(json({}));
  const faltan = ctx.PARAMS_VISTA.filter((n) => !(n in dato));
  ok('sin ninguno en la petición, están los ' + ctx.PARAMS_VISTA.length + ' declarados',
    faltan.length === 0, 'faltan: ' + faltan.join(', '));
  eq('y el que no vino es cadena vacía, no undefined', dato.q, '');
  ok('los tres que añadió T1.2 están en la lista',
    ['estatus', 'dir', 'origen'].every((n) => ctx.PARAMS_VISTA.indexOf(n) > -1),
    ctx.PARAMS_VISTA.join(','));
  ok('baseUrl no se cuela en PARAMS_VISTA (es aparte)', ctx.PARAMS_VISTA.indexOf('baseUrl') === -1);
}

console.log('\n3. La que importa: no se puede salir del <script>');
{
  const s = json({ folio: '</script><script>alert(1)</script>' });
  ok('no queda ni un "</script>" literal', s.indexOf('</script>') === -1, s);
  ok('tampoco un "<" suelto', s.indexOf('<') === -1, s);
  ok('ni un ">"', s.indexOf('>') === -1, s);
  eq('y el valor sobrevive intacto al parsear',
    JSON.parse(s).folio, '</script><script>alert(1)</script>');
}

console.log('\n4. Las otras puertas del mismo pasillo');
{
  const s = json({ q: '<!--', sec: '<img src=x onerror=alert(1)>', item: 'a&b' });
  ok('el abre-comentario HTML va escapado', s.indexOf('<!--') === -1, s);
  ok('la etiqueta img va escapada', s.indexOf('<img') === -1, s);
  ok('el ampersand va escapado', s.indexOf('&') === -1, s);
  const dato = JSON.parse(s);
  eq('q intacto', dato.q, '<!--');
  eq('sec intacto', dato.sec, '<img src=x onerror=alert(1)>');
  eq('a&b intacto', dato.item, 'a&b');
}

console.log('\n5. Separadores de línea de JavaScript (JSON los deja pasar crudos)');
{
  const s = json({ q: 'antes' + LS + 'despues', sec: 'antes' + PS + 'despues' });
  ok('U+2028 no viaja crudo', s.indexOf(LS) === -1);
  ok('U+2029 no viaja crudo', s.indexOf(PS) === -1);
  eq('U+2028 sobrevive al parseo', JSON.parse(s).q, 'antes' + LS + 'despues');
  eq('U+2029 sobrevive al parseo', JSON.parse(s).sec, 'antes' + PS + 'despues');
}

console.log('\n6. Comillas y barras, que es lo que rompe una serialización a mano');
{
  const dato = JSON.parse(json({ q: 'dijo "hola"\\ y se fue' }));
  eq('comillas y barra intactas', dato.q, 'dijo "hola"\\ y se fue');
}

console.log('\n7. Llamadas degeneradas: no puede lanzar');
{
  let lanzo = false, s = '';
  try { s = ctx.appEstadoInicialJson_(null, null); } catch (e) { lanzo = true; }
  ok('sin baseUrl ni petición, no lanza', !lanzo);
  eq('y baseUrl queda vacío', JSON.parse(s).baseUrl, '');

  lanzo = false;
  try { s = ctx.appEstadoInicialJson_('u', {}); } catch (e) { lanzo = true; }
  ok('con una petición sin .parameter, no lanza', !lanzo);
  eq('los params quedan vacíos', JSON.parse(s).folio, '');
}

console.log('\n8. Un parámetro ajeno al contrato no se copia');
{
  const dato = JSON.parse(json({ folio: 'F1', maldad: 'no debería estar' }));
  ok('lo que no está en PARAMS_VISTA no viaja', !('maldad' in dato), JSON.stringify(dato));
  eq('lo que sí está, viaja', dato.folio, 'F1');
}

console.log('\n─────────────────────────────────────────────');
console.log(fallos === 0 ? `TODO OK · ${pruebas} comprobaciones` : `${fallos} FALLOS de ${pruebas}`);
process.exit(fallos === 0 ? 0 : 1);
