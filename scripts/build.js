/*
 * Build del Apps Script (Fase 1 del doc 16): genera `build/` a partir de «Carpeta del proyecto».
 *   node scripts/build.js                         → build/ (hermana de la fuente) con su .clasp.json
 *   node scripts/build.js --salida <dir>          → a otra carpeta (las pruebas usan una temporal)
 *   node scripts/build.js --fuente <dir>          → desde otra fuente (solo para pruebas)
 *   node scripts/build.js --sin-clasp             → sin escribir .clasp.json (nada se puede subir)
 *
 * Por qué: cada ejecución de Apps Script (un doGet, un google.script.run) paga por cargar TODO el
 * código .gs del proyecto, y los comentarios cuentan. Medido en el doc 15 §3.2: quitarlos baja
 * ~0.3-0.8 s por llamada. Los .html no se tocan todavía (eso es la Fase 2).
 *
 * Qué hace con cada .gs:
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
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

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
function textoDeFuncion(archivos, nombre) {
  for (const s of archivos) {
    for (const n of acorn.parse(s, OPC_ACORN).body) {
      if (n.type === 'FunctionDeclaration' && n.id && n.id.name === nombre) return s.slice(n.start, n.end);
    }
  }
  return null;
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
  for (const f of copiar) fs.copyFileSync(path.join(fuente, f), path.join(salida, f));
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
  return { ok: true, salida, gs: gs.length, copiados: copiar.length, bytesAntes, bytesDespues };
}

module.exports = { limpiarGs, arbolSinPosiciones, nombresGlobales, marcasDeVersion, construir };

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
  console.log('  ' + r.gs + ' .gs sin comentarios: ' + kb(r.bytesAntes) + ' → ' + kb(r.bytesDespues) +
              ' (−' + Math.round(100 * (1 - r.bytesDespues / r.bytesAntes)) + ' %)');
  console.log('  ' + r.copiados + ' archivos copiados tal cual (.html y appsscript.json)');
}
