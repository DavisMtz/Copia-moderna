/*
 * Build del Apps Script (Fases 1 y 2 del doc 16): genera `build/` a partir de «Carpeta del proyecto».
 *   node scripts/build.js                         → build/ (hermana de la fuente) con su .clasp.json
 *   node scripts/build.js --salida <dir>          → a otra carpeta (las pruebas usan una temporal)
 *   node scripts/build.js --fuente <dir>          → desde otra fuente (solo para pruebas)
 *   node scripts/build.js --sin-clasp             → sin escribir .clasp.json (nada se puede subir)
 *
 * Por qué: cada ejecución de Apps Script (un doGet, un google.script.run) paga por cargar TODO el
 * código .gs del proyecto, y los comentarios cuentan. Medido en el doc 15 §3.2: quitarlos baja
 * ~0.3-0.8 s por llamada. Los .html (Fase 2, más abajo) pesan en el navegador, no en el servidor.
 *
 * Qué hace con cada .gs (Fase 1):
 *   · quita los comentarios —los localiza acorn, no un regex, para no confundirlos con cadenas o
 *     expresiones regulares— y CONSERVA LOS SALTOS DE LÍNEA: un error en Stackdriver sigue
 *     apuntando a la misma línea del fuente;
 *   · quita la sangría y los espacios del final de línea, salvo dentro de una cadena o una
 *     plantilla de texto multilínea (el HTML de los correos va en `…` y ahí el espacio es dato);
 *   · deja los finales en LF, como los guarda el editor.
 *
 * Y no da nada por bueno sin comprobarlo. Si algo falla, borra la salida entera y sale con 1, para
 * que nadie pueda subir un build a medias:
 *   · el árbol sintáctico de la salida es IDÉNTICO al del fuente (mismas sentencias, mismos
 *     literales, mismos nombres): cubre de una vez los globales, las cadenas y el punto y coma
 *     automático;
 *   · mismo número de líneas, mismos nombres globales y en el mismo orden;
 *   · verificarVersionDelCodigo (Admin.gs) lee el TEXTO de algunas funciones buscando marcas: sus
 *     marcas siguen ahí (la lista se lee del propio Admin.gs, no de una copia);
 *   · la salida tiene exactamente los archivos que subiría clasp desde la fuente: `clasp push`
 *     BORRA en el editor lo que no exista en local.
 *
 * Qué hace con cada .html (Fase 2). Google ya sirve el HTML sin comentarios y sin sangría, pero
 * conserva los saltos de línea y los nombres (doc 15 §3.1): lo que queda por ganar es el JS y el
 * CSS compilados, 19-27 % menos por pantalla.
 *   · PARCIALES (app_*.html, *Partial.html): include() los pega tal cual, sin evaluarlos. Se les
 *     quitan los comentarios HTML y cada <script> y <style> pasa por esbuild. Del JS se quitan los
 *     espacios y se acortan los nombres LOCALES; la sintaxis no se reescribe (ver OPC_JS). El
 *     marcado no se toca: su sangría ya la quita Google.
 *   · PÁGINAS (las plantillas que sirve doGet): solo se quitan los comentarios HTML del marcado, sin
 *     entrar en sus <script> ni en sus <style>. Un comentario con un scriptlet dentro PARA el build:
 *     Google ejecuta los <? ?> aunque estén comentados (doc 15 §3.8), y borrarlo cambiaría la página.
 * Comprobaciones de cada bloque compilado: el JS de salida se deja leer; declara los mismos nombres
 * globales y del mismo tipo (var, let, function…) que el fuente, porque los demás bloques de la
 * página los usan; no lleva `</script` ni más `<!--` o `<script` que el fuente; y ninguna
 * plantilla `…` nueva contiene //, /* ni un salto de línea: el quitacomentarios de Google las toma
 * por comentarios o por sangría (issue 156139610, doc 15 §3.10). Las que crea esbuild al elegir
 * comillas se reescriben como cadenas normales, con el mismo valor.
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const esbuild = require('esbuild');

const RAIZ = path.join(__dirname, '..');
const OPC_ACORN = { ecmaVersion: 'latest', sourceType: 'script' };

/* ── Limpieza de un .gs ─────────────────────────────────────────────── */

// Visita todos los nodos del árbol de acorn sin depender de acorn-walk.
function recorrer(nodo, visita) {
  if (!nodo || typeof nodo.type !== 'string') return;
  visita(nodo);
  for (const clave of Object.keys(nodo)) {
    const v = nodo[clave];
    if (Array.isArray(v)) v.forEach((h) => recorrer(h, visita));
    else if (v && typeof v.type === 'string') recorrer(v, visita);
  }
}

// Tramos donde un salto de línea es parte de un valor y no separa código: el texto de una
// plantilla `…` (sus TemplateElement, no las expresiones ${…}) y las cadenas con continuación
// de línea. Ahí la sangría y los espacios del final son contenido.
function tramosProtegidos(arbol, s) {
  const tramos = [];
  recorrer(arbol, (n) => {
    if ((n.type === 'TemplateElement' || (n.type === 'Literal' && typeof n.value === 'string'))
        && s.slice(n.start, n.end).indexOf('\n') !== -1) {
      tramos.push([n.start, n.end]);
    }
  });
  return tramos.sort((a, b) => a[0] - b[0]);
}

function limpiarGs(s) {
  const comentarios = [];
  const arbol = acorn.parse(s, Object.assign({}, OPC_ACORN, {
    onComment: (bloque, texto, ini, fin) => comentarios.push([ini, fin])
  }));
  const protegidos = tramosProtegidos(arbol, s);
  const protegido = (p) => protegidos.some(([a, b]) => a <= p && p <= b);

  // Cada posición del fuente se queda, desaparece ('') o se sustituye.
  const out = s.split('');
  for (const [ini, fin] of comentarios) {
    const trozo = s.slice(ini, fin);
    for (let i = ini; i < fin; i++) if (s[i] !== '\n') out[i] = '';
    // Un comentario de una sola línea separa dos palabras (`a/**/b` no es `ab`): se queda un
    // espacio. Si luego cae en el borde de la línea, lo quita la sangría o el final.
    if (trozo.indexOf('\n') === -1) out[ini] = ' ';
  }
  // CRLF → LF. Seguro también dentro de las plantillas: JavaScript ya normaliza ahí el CRLF.
  for (let i = 0; i < s.length - 1; i++) if (s[i] === '\r' && s[i + 1] === '\n') out[i] = '';

  const esEspacio = (i) => out[i] === '' || out[i] === ' ' || out[i] === '\t';
  let inicio = 0;
  while (inicio <= s.length) {
    let finLinea = s.indexOf('\n', inicio);
    if (finLinea === -1) finLinea = s.length;
    // Sangría: si la línea arranca dentro de un valor multilínea, es contenido.
    if (!protegido(inicio)) {
      for (let i = inicio; i < finLinea && esEspacio(i); i++) out[i] = '';
    }
    // Final de línea: si el salto de línea pertenece a un valor, lo que va antes también.
    if (finLinea === s.length || !protegido(finLinea)) {
      for (let i = finLinea - 1; i >= inicio && esEspacio(i); i--) out[i] = '';
    }
    inicio = finLinea + 1;
  }
  return out.join('');
}

/* ── Comprobaciones ──────────────────────────────────────────────────── */

// El árbol sin posiciones: si dos árboles salen iguales, los dos programas son el mismo.
function arbolSinPosiciones(s) {
  return JSON.stringify(acorn.parse(s, OPC_ACORN), (clave, v) =>
    (clave === 'start' || clave === 'end') ? undefined : v);
}

function nombresGlobales(s) {
  const nombres = [];
  const dePatron = (p) => {
    if (!p) return;
    if (p.type === 'Identifier') nombres.push(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((x) => dePatron(x.value || x.argument));
    else if (p.type === 'ArrayPattern') p.elements.forEach(dePatron);
    else if (p.type === 'AssignmentPattern') dePatron(p.left);
    else if (p.type === 'RestElement') dePatron(p.argument);
  };
  for (const n of acorn.parse(s, OPC_ACORN).body) {
    if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) nombres.push(n.id.name);
    else if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => dePatron(d.id));
  }
  return nombres;
}

const lineas = (s) => s.split('\n').length;

// Las marcas que busca verificarVersionDelCodigo, leídas del Admin.gs real.
function marcasDeVersion(adminGs) {
  const ini = adminGs.indexOf('function verificarVersionDelCodigo(');
  if (ini === -1) return null;
  const cuerpo = adminGs.slice(ini, adminGs.indexOf('const problemas', ini));
  return [...cuerpo.matchAll(/nombre:\s*'([^']+)'[\s\S]*?marca:\s*'([^']+)'/g)]
    .map((m) => ({ nombre: m[1], marca: m[2] }));
}

// El texto de una función global tal como lo devolvería fn.toString() en Apps Script.
// Un archivo que no se deja leer se salta: ese error ya lo reporta la limpieza.
function textoDeFuncion(archivos, nombre) {
  for (const s of archivos) {
    let cuerpo;
    try { cuerpo = acorn.parse(s, OPC_ACORN).body; } catch (e) { continue; }
    for (const n of cuerpo) {
      if (n.type === 'FunctionDeclaration' && n.id && n.id.name === nombre) return s.slice(n.start, n.end);
    }
  }
  return null;
}

/* ── Fase 2: los .html ───────────────────────────────────────────────── */

// Parciales: los pega include() sin evaluarlos. Todo lo demás es una página (plantilla).
const esParcial = (f) => /^(app_.*|.*Partial)\.html$/.test(f);

// JS: sin espacios y con los nombres locales acortados, pero SIN minifySyntax. Esa opción, además
// de reescribir la sintaxis (if → &&, true → !0…), convierte las cadenas con '\n' en plantillas
// `…` con el salto de línea dentro, y ahí la sangría que viniera detrás la quitaría Google
// (medido: 2 casos en los parciales de hoy). Sin ella se pierde 1 punto de compresión.
// Los nombres globales no se tocan: esbuild no renombra el ámbito superior de un guion.
const OPC_JS = {
  loader: 'js', charset: 'utf8', target: 'chrome109', legalComments: 'none',
  minifyWhitespace: true, minifyIdentifiers: true, minifySyntax: false
};
const OPC_CSS = { loader: 'css', charset: 'utf8', target: 'chrome109', minify: true };

// Elementos cuyo contenido el navegador NO lee como marcado: ahí `<!--` es texto y no se toca.
const OPACOS = ['textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'];

// Parte un HTML como lo haría el navegador: comentario, bloque (<script>, <style> u opaco) y
// marcado. En una PLANTILLA los scriptlets <? ?> son opacos y se saltan en todas las búsquedas:
// Google los ejecuta antes de que el navegador vea nada. Cada trozo lleva su posición (`ini`).
function trocearHtml(html, plantilla) {
  const low = html.toLowerCase();
  const trozos = [];
  let i = 0, desde = 0;
  const marcadoHasta = (fin) => { if (fin > desde) trozos.push({ t: 'marcado', ini: desde, texto: html.slice(desde, fin) }); };
  const finScriptlet = (ini) => {
    const f = html.indexOf('?>', ini + 2);
    if (f === -1) throw new Error('scriptlet <? sin cerrar (posición ' + ini + ')');
    return f + 2;
  };
  // Como indexOf, pero en una plantilla no mira dentro de los scriptlets.
  const buscar = (aguja, pos) => {
    for (;;) {
      const a = low.indexOf(aguja, pos);
      if (!plantilla || a === -1) return a;
      const s = html.indexOf('<?', pos);
      if (s === -1 || a < s) return a;
      pos = finScriptlet(s);
    }
  };
  while (i < html.length) {
    if (plantilla && html.startsWith('<?', i)) {
      const f = finScriptlet(i);
      marcadoHasta(i);
      trozos.push({ t: 'scriptlet', ini: i, texto: html.slice(i, f) });
      i = desde = f;
      continue;
    }
    if (html.startsWith('<!--', i)) {
      // `<!-->` y `<!--->` son comentarios vacíos completos; `--!>` también cierra (norma HTML).
      let f;
      if (html.startsWith('<!-->', i)) f = i + 5;
      else if (html.startsWith('<!--->', i)) f = i + 6;
      else {
        const a = html.indexOf('-->', i + 4), b = html.indexOf('--!>', i + 4);
        if (a === -1 && b === -1) throw new Error('comentario <!-- sin cerrar (posición ' + i + ')');
        f = (b !== -1 && (a === -1 || b < a)) ? b + 4 : a + 3;
      }
      marcadoHasta(i);
      trozos.push({ t: 'comentario', ini: i, texto: html.slice(i, f) });
      i = desde = f;
      continue;
    }
    const m = /^<([a-z]+)[\s>\/]/.exec(low.slice(i, i + 12));
    if (m && (m[1] === 'script' || m[1] === 'style' || OPACOS.includes(m[1]))) {
      const tag = m[1];
      const finApertura = buscar('>', i);
      if (finApertura === -1) throw new Error('<' + tag + '> sin cerrar la etiqueta (posición ' + i + ')');
      // El bloque acaba en `</tag` seguido de espacio, `/` o `>`: lo mismo que busca el navegador.
      let c = finApertura;
      for (;;) {
        c = buscar('</' + tag, c + 1);
        if (c === -1) throw new Error('falta </' + tag + '> (abierto en la posición ' + i + ')');
        if (/[\s\/>]/.test(html[c + 2 + tag.length] || '')) break;
      }
      const finCierre = html.indexOf('>', c);
      if (finCierre === -1) throw new Error('</' + tag + ' sin «>» (posición ' + c + ')');
      marcadoHasta(i);
      trozos.push({
        t: (tag === 'script' || tag === 'style') ? tag : 'opaco', ini: i, tag,
        apertura: html.slice(i, finApertura + 1), contenido: html.slice(finApertura + 1, c),
        cierre: html.slice(c, finCierre + 1), texto: html.slice(i, finCierre + 1)
      });
      i = desde = finCierre + 1;
      continue;
    }
    i++;
  }
  marcadoHasta(html.length);
  return trozos;
}

// Solo el JS clásico se compila. `src`, `type="module"`, plantillas de texto, JSON…: intactos.
function esJsClasico(apertura) {
  if (/\ssrc\s*=/i.test(apertura)) return false;
  const tipo = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(apertura);
  return !tipo || tipo[1] === '' || /^(text|application)\/(java|ecma)script$/i.test(tipo[1]);
}

// Nombres que un bloque deja en el ámbito global, con su tipo: los `var` de cualquier bloque fuera
// de una función (suben al ámbito global), y los let/const/class/function del nivel superior. Una
// función declarada dentro de un bloque cuenta aparte: en modo no estricto también es global.
function globalesDeGuion(js) {
  const g = [];
  const dePatron = (p, tipo) => {
    if (!p) return;
    if (p.type === 'Identifier') g.push(tipo + ' ' + p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((x) => dePatron(x.value || x.argument, tipo));
    else if (p.type === 'ArrayPattern') p.elements.forEach((x) => dePatron(x, tipo));
    else if (p.type === 'AssignmentPattern') dePatron(p.left, tipo);
    else if (p.type === 'RestElement') dePatron(p.argument, tipo);
  };
  const visitar = (n, arriba) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'FunctionDeclaration') { if (n.id) g.push((arriba ? 'function ' : 'function-en-bloque ') + n.id.name); return; }
    if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' ||
        n.type === 'ClassExpression' || n.type === 'StaticBlock' || n.type === 'MethodDefinition' ||
        n.type === 'PropertyDefinition') return;
    if (n.type === 'ClassDeclaration') { if (arriba && n.id) g.push('class ' + n.id.name); return; }
    if (n.type === 'VariableDeclaration' && (n.kind === 'var' || arriba)) n.declarations.forEach((d) => dePatron(d.id, n.kind));
    for (const clave of Object.keys(n)) {
      const v = n[clave];
      if (Array.isArray(v)) v.forEach((h) => visitar(h, false));
      else if (v && typeof v.type === 'string') visitar(v, false);
    }
  };
  acorn.parse(js, OPC_ACORN).body.forEach((n) => visitar(n, true));
  return g.sort();
}

// Plantillas `…` de un JS, con su padre (para saber si llevan etiqueta).
function plantillasDe(js) {
  const out = [];
  const visitar = (n, padre) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'TemplateLiteral') {
      out.push({
        nodo: n, padre,
        etiquetada: !!(padre && padre.type === 'TaggedTemplateExpression' && padre.quasi === n),
        crudo: n.quasis.map((q) => q.value.raw).join('${}')
      });
    }
    for (const clave of Object.keys(n)) {
      const v = n[clave];
      if (Array.isArray(v)) v.forEach((h) => visitar(h, n));
      else if (v && typeof v.type === 'string') visitar(v, n);
    }
  };
  visitar(acorn.parse(js, OPC_ACORN), null);
  return out;
}

// Lo que el quitacomentarios de Google estropea dentro de una plantilla `…`.
const PELIGRO_EN_PLANTILLA = /\/\/|\/\*|[\r\n]/;

// Las plantillas peligrosas de la salida que NO estaban ya en el fuente. Las que ya estaban las
// sirve Google hoy y se quedan como están: tocarlas cambiaría lo que llega al navegador.
function plantillasPeligrosasNuevas(salida, fuente) {
  const deFuente = new Map();
  for (const p of plantillasDe(fuente)) {
    if (PELIGRO_EN_PLANTILLA.test(p.crudo)) deFuente.set(p.crudo, (deFuente.get(p.crudo) || 0) + 1);
  }
  return plantillasDe(salida).filter((p) => {
    if (!PELIGRO_EN_PLANTILLA.test(p.crudo)) return false;
    const n = deFuente.get(p.crudo) || 0;
    if (n > 0) { deFuente.set(p.crudo, n - 1); return false; }
    return true;
  });
}

// Una cadena JS con el mismo valor, que no puede cerrar un <script> ni abrir un comentario HTML.
const cadenaSegura = (valor) => JSON.stringify(valor)
  .replace(/</g, '\\u003c').replace(new RegExp('\u2028', 'g'), '\\u2028').replace(new RegExp('\u2029', 'g'), '\\u2029');

// El árbol de un JS sin posiciones, con cada plantilla `…` sin etiqueta ni ${} vista como la
// cadena que vale: así se compara el programa antes y después de reescribir esas plantillas.
function arbolComoCadenas(js) {
  return JSON.stringify(acorn.parse(js, OPC_ACORN), function (clave, v) {
    if (clave === 'start' || clave === 'end' || clave === 'raw') return undefined;
    if (v && v.type === 'TemplateLiteral' && clave !== 'quasi' && v.expressions.length === 0) {
      return { type: 'Literal', value: v.quasis[0].value.cooked };
    }
    return v;
  });
}

// esbuild elige las comillas que menos escapes piden, y una cadena con comillas simples y dobles
// puede salir como `…` aunque en el fuente no lo fuera; si lleva //, /* o un salto de línea, Google
// la estropearía. Se reescriben como cadenas normales con el mismo valor. Una nueva con ${} o con
// etiqueta no la puede haber creado esa elección y no se sabe arreglar: error.
function plantillasSeguras(salida, fuente) {
  const nuevas = plantillasPeligrosasNuevas(salida, fuente);
  if (!nuevas.length) return salida;
  const malas = nuevas.filter((p) => p.etiquetada || p.nodo.expressions.length);
  if (malas.length) {
    throw new Error('esbuild creó una plantilla `…` con //, /* o un salto de línea que no se puede convertir en cadena: ' +
      JSON.stringify(malas[0].crudo.slice(0, 80)));
  }
  let s = salida;
  for (const p of nuevas.sort((a, b) => b.nodo.start - a.nodo.start)) {
    let lit = cadenaSegura(p.nodo.quasis[0].value.cooked);
    // Como sentencia suelta, una cadena al principio de una función sería una directiva ("use strict").
    if (p.padre && p.padre.type === 'ExpressionStatement') lit = '(' + lit + ')';
    s = s.slice(0, p.nodo.start) + lit + s.slice(p.nodo.end);
  }
  if (arbolComoCadenas(s) !== arbolComoCadenas(salida)) throw new Error('reescribir las plantillas cambió el programa');
  return s;
}

// El programa sin lo que esbuild cambia sin cambiar lo que hace: posiciones y espacios, los nombres
// de variables (se acortan; las claves y las propiedades con punto no), `{a: a}` → `{a}`,
// `undefined` → `void 0`, cadenas constantes juntadas (`'a' + 'b'` → `'ab'`) y las plantillas `…`
// sin ${} reescritas como cadenas. Si dos JS dan lo mismo aquí, son el mismo programa salvo los
// nombres locales, y los globales ya se comparan aparte. Medido en los 24 bloques de hoy: iguales.
function arbolNormalizado(js) {
  const esClave = (clave, padre) => !!padre && !padre.computed && (
    (clave === 'key' && (padre.type === 'Property' || padre.type === 'MethodDefinition' || padre.type === 'PropertyDefinition')) ||
    (clave === 'property' && padre.type === 'MemberExpression'));
  const normal = (n, clave, padre) => {
    if (Array.isArray(n)) return n.map((x) => normal(x, clave, padre));
    if (!n || typeof n !== 'object') return n;
    if (esClave(clave, padre)) return { clave: String(n.type === 'Identifier' ? n.name : n.value) };
    if ((n.type === 'Identifier' && n.name === 'undefined') ||
        (n.type === 'UnaryExpression' && n.operator === 'void' && n.argument.type === 'Literal' && n.argument.value === 0)) {
      return { type: 'undefined' };
    }
    if (n.type === 'Identifier' || n.type === 'PrivateIdentifier') return { type: n.type };
    if (n.type === 'TemplateLiteral' && clave !== 'quasi' && n.expressions.length === 0) {
      return { type: 'Literal', value: n.quasis[0].value.cooked };
    }
    if (n.type === 'BinaryExpression' && n.operator === '+') {
      // a + b + c es ((a + b) + c): se aplana y se juntan las cadenas vecinas. Juntarlas no cambia
      // el resultado: a la izquierda de una cadena el valor ya es una cadena.
      const partes = [];
      (function aplanar(x) { if (x.type === 'BinaryExpression' && x.operator === '+') { aplanar(x.left); partes.push(x.right); } else partes.push(x); })(n);
      const juntas = [];
      for (const p of partes.map((x) => normal(x, 'suma', n))) {
        const u = juntas[juntas.length - 1];
        const cadena = (x) => x && x.type === 'Literal' && typeof x.value === 'string';
        if (cadena(u) && cadena(p)) juntas[juntas.length - 1] = { type: 'Literal', value: u.value + p.value };
        else juntas.push(p);
      }
      return juntas.length === 1 ? juntas[0] : { type: 'Suma', partes: juntas };
    }
    const out = {};
    for (const k of Object.keys(n)) {
      if (k !== 'start' && k !== 'end' && k !== 'raw' && k !== 'shorthand') out[k] = normal(n[k], k, n);
    }
    return out;
  };
  return JSON.stringify(normal(acorn.parse(js, OPC_ACORN), null, null));
}

const cuenta = (s, re) => (s.match(re) || []).length;
const primeraLinea = (e) => String((e && e.message) || e).split('\n').filter((x) => x.trim())[0];

function compilarJs(fuente, donde, errores) {
  let globalesFuente;
  try { globalesFuente = globalesDeGuion(fuente); } catch (e) { errores.push(donde + ': acorn no pudo leer el fuente (' + e.message + ')'); return null; }
  let salida;
  try { salida = esbuild.transformSync(fuente, OPC_JS).code.trim(); } catch (e) { errores.push(donde + ': esbuild no lo pudo compilar (' + primeraLinea(e) + ')'); return null; }
  try { salida = plantillasSeguras(salida, fuente); } catch (e) { errores.push(donde + ': ' + e.message); return null; }
  try { acorn.parse(salida, OPC_ACORN); } catch (e) { errores.push(donde + ': la salida no se deja leer (' + e.message + ')'); return null; }
  const antes = errores.length;
  if (globalesDeGuion(salida).join() !== globalesFuente.join()) errores.push(donde + ': cambiaron los nombres globales o su tipo');
  if (arbolNormalizado(salida) !== arbolNormalizado(fuente)) {
    errores.push(donde + ': esbuild cambió el programa más allá de los nombres locales (ver arbolNormalizado en scripts/build.js)');
  }
  if (/<\/script/i.test(salida)) errores.push(donde + ': la salida lleva </script');
  if (cuenta(salida, /<!--/g) > cuenta(fuente, /<!--/g) || cuenta(salida, /<script/gi) > cuenta(fuente, /<script/gi)) {
    errores.push(donde + ': la salida lleva más <!-- o <script que el fuente');
  }
  if (plantillasPeligrosasNuevas(salida, fuente).length) errores.push(donde + ': queda una plantilla `…` nueva con //, /* o un salto de línea');
  return errores.length === antes ? salida : null;
}

function compilarCss(fuente, donde, errores) {
  let r;
  try { r = esbuild.transformSync(fuente, OPC_CSS); } catch (e) { errores.push(donde + ': esbuild no pudo leer el CSS (' + primeraLinea(e) + ')'); return null; }
  // Un aviso de esbuild en CSS es algo que no entendió (una cadena sin cerrar, una llave de más):
  // lo que haga con eso no se puede dar por bueno.
  if (r.warnings.length) { errores.push(donde + ': esbuild avisa en el CSS: ' + r.warnings[0].text); return null; }
  const salida = r.code.trim();
  const antes = errores.length;
  if (/<\/style/i.test(salida)) errores.push(donde + ': el CSS de salida lleva </style');
  if (cuenta(salida, /\/\//g) > cuenta(fuente.replace(/\/\*[\s\S]*?\*\//g, ''), /\/\//g)) errores.push(donde + ': el CSS de salida lleva // nuevos');
  return errores.length === antes ? salida : null;
}

const lineaDe = (html, pos) => html.slice(0, pos).split('\n').length;

function limpiarParcial(html, nombre, errores) {
  let trozos;
  try { trozos = trocearHtml(html, false); } catch (e) { errores.push(nombre + ': ' + e.message); return null; }
  const antes = errores.length;
  const out = trozos.map((t) => {
    const donde = nombre + ':' + lineaDe(html, t.ini);
    if (t.t === 'comentario') return '';
    if (t.t === 'script' && esJsClasico(t.apertura) && t.contenido.trim()) {
      const js = compilarJs(t.contenido, donde, errores);
      return js === null ? '' : t.apertura + js + t.cierre;
    }
    if (t.t === 'style' && t.contenido.trim()) {
      const css = compilarCss(t.contenido, donde, errores);
      return css === null ? '' : t.apertura + css + t.cierre;
    }
    return t.texto;
  }).join('');
  return errores.length === antes ? out : null;
}

function limpiarPagina(html, nombre, errores) {
  let trozos;
  try { trozos = trocearHtml(html, true); } catch (e) { errores.push(nombre + ': ' + e.message); return null; }
  const antes = errores.length;
  const out = trozos.map((t) => {
    if (t.t !== 'comentario') return t.texto;
    if (t.texto.indexOf('<?') !== -1) {
      errores.push(nombre + ':' + lineaDe(html, t.ini) + ': un comentario HTML lleva un scriptlet <? ?>. Google lo ' +
        'ejecuta aunque esté comentado: sácalo del comentario o bórralo');
      return t.texto;
    }
    return '';
  }).join('');
  return errores.length === antes ? out : null;
}

// Las páginas que sirve doGet: las claves `file:` de PAGES y PORTAL_PAGES.
function paginasServidas(archivosGs) {
  const paginas = new Set();
  for (const s of archivosGs) for (const m of s.matchAll(/\bfile:\s*'([^']+)'/g)) paginas.add(m[1] + '.html');
  return paginas;
}

/* ── Qué subiría clasp ───────────────────────────────────────────────── */

// clasp sube .gs/.js/.html y cualquier .json de la raíz del rootDir (y de sus subcarpetas).
// El build solo sabe de .gs, .html y appsscript.json en la raíz: cualquier otra cosa que clasp
// subiría es un caso que no está pensado y se para aquí, en vez de perderse en el editor.
function clasificar(fuente) {
  const gs = [], copiar = [], raros = [];
  for (const e of fs.readdirSync(fuente, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;   // .clasp.json, .claspignore, .claude: no se suben
    if (e.isDirectory()) { raros.push(e.name + '/'); continue; }
    if (e.name.endsWith('.gs')) gs.push(e.name);
    else if (e.name.endsWith('.html') || e.name === 'appsscript.json') copiar.push(e.name);
    else if (/\.(js|json)$/.test(e.name)) raros.push(e.name);
  }
  return { gs: gs.sort(), copiar: copiar.sort(), raros };
}

/* ── Build ───────────────────────────────────────────────────────────── */

function construir(opc) {
  const fuente = path.resolve(opc.fuente || path.join(RAIZ, 'Carpeta del proyecto'));
  const salida = path.resolve(opc.salida || path.join(RAIZ, 'build'));
  const errores = [];

  // La salida se borra entera: nunca puede ser (ni contener, ni estar dentro de) la fuente.
  const dentro = (hijo, padre) => !path.relative(padre, hijo).startsWith('..') && !path.isAbsolute(path.relative(padre, hijo));
  if (dentro(salida, fuente) || dentro(fuente, salida)) {
    return { ok: false, errores: ['la salida no puede estar dentro de la fuente ni contenerla: ' + salida] };
  }
  if (!fs.existsSync(path.join(fuente, 'appsscript.json'))) {
    return { ok: false, errores: ['no encuentro appsscript.json en la fuente: ' + fuente] };
  }

  const { gs, copiar, raros } = clasificar(fuente);
  if (raros.length) errores.push('archivos que clasp subiría y el build no sabe tratar: ' + raros.join(', '));

  fs.rmSync(salida, { recursive: true, force: true });
  fs.mkdirSync(salida, { recursive: true });
  // Pase lo que pase a partir de aquí, un fallo no puede dejar una salida a medias.
  try {
    return generar(fuente, salida, gs, copiar, errores, opc);
  } catch (e) {
    fs.rmSync(salida, { recursive: true, force: true });
    return { ok: false, errores: errores.concat(['error inesperado del build: ' + (e && e.stack || e)]) };
  }
}

function generar(fuente, salida, gs, copiar, errores, opc) {
  let bytesAntes = 0, bytesDespues = 0;
  const limpios = {};
  for (const f of gs) {
    const s = fs.readFileSync(path.join(fuente, f), 'utf8');
    let t;
    try { t = limpiarGs(s); } catch (e) { errores.push(f + ': no se pudo leer (' + e.message + ')'); continue; }
    try { new Function(t); } catch (e) { errores.push(f + ': la salida no compila (' + e.message + ')'); continue; }
    if (lineas(t) !== lineas(s)) errores.push(f + ': cambió el número de líneas (' + lineas(s) + ' → ' + lineas(t) + ')');
    if (nombresGlobales(t).join() !== nombresGlobales(s).join()) errores.push(f + ': cambiaron los nombres globales');
    if (arbolSinPosiciones(t) !== arbolSinPosiciones(s)) errores.push(f + ': el programa cambió (árbol distinto)');
    fs.writeFileSync(path.join(salida, f), t, 'utf8');
    limpios[f] = t;
    bytesAntes += Buffer.byteLength(s);
    bytesDespues += Buffer.byteLength(t);
  }
  // Fase 2. Un parcial compilado como si fuera página (o al revés) rompería la pantalla: si una
  // página que sirve doGet tiene nombre de parcial, se para aquí.
  const html = { parciales: 0, paginas: 0, antes: 0, despues: 0 };
  const servidas = paginasServidas(gs.map((f) => fs.readFileSync(path.join(fuente, f), 'utf8')));
  const confundidas = [...servidas].filter(esParcial);
  if (confundidas.length) errores.push('páginas de doGet con nombre de parcial (se compilarían como parcial): ' + confundidas.join(', '));
  if (copiar.some((f) => f.endsWith('.html')) && !servidas.size) errores.push('no encontré las páginas de doGet (claves file: de PAGES) en los .gs');
  for (const f of copiar) {
    if (!f.endsWith('.html')) { fs.copyFileSync(path.join(fuente, f), path.join(salida, f)); continue; }
    // CRLF → LF, como los .gs: el navegador y JavaScript ya los tratan igual.
    const s = fs.readFileSync(path.join(fuente, f), 'utf8').replace(/\r\n/g, '\n');
    const t = esParcial(f) ? limpiarParcial(s, f, errores) : limpiarPagina(s, f, errores);
    if (t === null) continue;
    fs.writeFileSync(path.join(salida, f), t, 'utf8');
    html[esParcial(f) ? 'parciales' : 'paginas']++;
    html.antes += Buffer.byteLength(s);
    html.despues += Buffer.byteLength(t);
  }
  if (fs.existsSync(path.join(fuente, '.claspignore'))) {
    fs.copyFileSync(path.join(fuente, '.claspignore'), path.join(salida, '.claspignore'));
  }

  // Las marcas de verificarVersionDelCodigo tienen que sobrevivir a la limpieza.
  if (limpios['Admin.gs'] !== undefined) {
    const marcas = marcasDeVersion(fs.readFileSync(path.join(fuente, 'Admin.gs'), 'utf8'));
    if (!marcas || marcas.length < 5) {
      errores.push('no pude leer las marcas de verificarVersionDelCodigo en Admin.gs');
    } else {
      const originales = gs.map((f) => fs.readFileSync(path.join(fuente, f), 'utf8'));
      const salidas = gs.map((f) => limpios[f]).filter((x) => x !== undefined);
      for (const { nombre, marca } of marcas) {
        const antes = textoDeFuncion(originales, nombre);
        const despues = textoDeFuncion(salidas, nombre);
        // Si la marca ya faltaba en el fuente, eso lo avisa el propio editor; aquí se vigila
        // solo lo que el build pudiera romper.
        if (antes && antes.indexOf(marca) !== -1 && (!despues || despues.indexOf(marca) === -1)) {
          errores.push('verificarVersionDelCodigo perdería la marca «' + marca + '» de ' + nombre);
        }
      }
    }
  }

  // Paridad: la salida sube exactamente los mismos archivos que la fuente.
  const subeFuente = gs.concat(copiar).sort().join();
  const c = clasificar(salida);
  if (c.gs.concat(c.copiar).sort().join() !== subeFuente || c.raros.length) {
    errores.push('la salida no tiene los mismos archivos que la fuente');
  }

  if (!opc.sinClasp && !errores.length) {
    const conf = JSON.parse(fs.readFileSync(path.join(fuente, '.clasp.json'), 'utf8'));
    if (!conf.scriptId) errores.push('.clasp.json de la fuente sin scriptId');
    else fs.writeFileSync(path.join(salida, '.clasp.json'),
      JSON.stringify({ scriptId: conf.scriptId, rootDir: '.' }, null, 2) + '\n', 'utf8');
  }

  if (errores.length) {
    fs.rmSync(salida, { recursive: true, force: true });
    return { ok: false, errores };
  }
  return { ok: true, salida, gs: gs.length, bytesAntes, bytesDespues, html };
}

module.exports = {
  limpiarGs, arbolSinPosiciones, nombresGlobales, marcasDeVersion, construir,
  trocearHtml, esParcial, esJsClasico, globalesDeGuion, plantillasDe, plantillasPeligrosasNuevas,
  plantillasSeguras, arbolComoCadenas, arbolNormalizado, compilarJs, compilarCss, limpiarParcial,
  limpiarPagina, paginasServidas, OPC_JS
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const valor = (bandera) => { const i = args.indexOf(bandera); return i === -1 ? null : args[i + 1]; };
  const t0 = Date.now();
  const r = construir({ salida: valor('--salida'), fuente: valor('--fuente'), sinClasp: args.includes('--sin-clasp') });
  if (!r.ok) {
    console.error('✖ Build fallido. No se generó nada:');
    r.errores.forEach((e) => console.error('  · ' + e));
    process.exit(1);
  }
  const kb = (b) => Math.round(b / 1024) + ' KB';
  console.log('✔ Build en ' + r.salida + ' (' + (Date.now() - t0) + ' ms)');
  const menos = (a, d) => ' (−' + Math.round(100 * (1 - d / a)) + ' %)';
  console.log('  ' + r.gs + ' .gs sin comentarios: ' + kb(r.bytesAntes) + ' → ' + kb(r.bytesDespues) + menos(r.bytesAntes, r.bytesDespues));
  console.log('  ' + r.html.parciales + ' parciales compilados y ' + r.html.paginas + ' páginas sin comentarios: ' +
              kb(r.html.antes) + ' → ' + kb(r.html.despues) + menos(r.html.antes, r.html.despues));
}
