/*
 * Cuatro variantes del proyecto grande para aislar QUÉ del tamaño cuesta en cada ejecución:
 *   full  → .gs del Portal + HTML del Portal (como producción)
 *   gs    → solo .gs del Portal
 *   gsmin → .gs del Portal comprimidos (sin comentarios ni espacios; nombres intactos)
 *   html  → solo HTML del Portal (sin su código de servidor)
 * Todas llevan el laboratorio. La copia de origen es lab-grande (ya SIN secretos).
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const SCR = path.join(__dirname, '..');
const ORIGEN = path.join(SCR, 'lab-grande');
const COMUN = path.join(SCR, 'lab-comun');
const SCRIPT_ID = '1oX4A114LpawkoXGEYRqZXC0dAZJypsu8c-IWbOy08roBiykLC3yFmkbp';

const esLab = (f) => /^ZZ_/.test(f) || /^lab_portal_/.test(f) || f === 'appsscript.json';
const gs = fs.readdirSync(ORIGEN).filter((f) => f.endsWith('.gs') && !esLab(f));
const html = fs.readdirSync(ORIGEN).filter((f) => f.endsWith('.html') && !esLab(f));

function variante(nombre, archivos, transformar) {
  const dir = path.join(SCR, 'var-' + nombre);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(COMUN)) fs.copyFileSync(path.join(COMUN, f), path.join(dir, f));
  fs.copyFileSync(path.join(ORIGEN, 'appsscript.json'), path.join(dir, 'appsscript.json'));
  let bytes = 0;
  for (const f of archivos) {
    let s = fs.readFileSync(path.join(ORIGEN, f), 'utf8');
    if (transformar) s = transformar(f, s);
    bytes += Buffer.byteLength(s);
    fs.writeFileSync(path.join(dir, f), s, 'utf8');
  }
  fs.writeFileSync(path.join(SCR, 'var-' + nombre + '.clasp.json'),
    JSON.stringify({ scriptId: SCRIPT_ID, rootDir: dir.replace(/\\/g, '/') }, null, 2));
  console.log(nombre.padEnd(6), archivos.length + ' archivos del Portal,', Math.round(bytes / 1024) + ' KB');
}

const comprimirGs = (f, s) => {
  if (!f.endsWith('.gs')) return s;
  // Nombres intactos: las trazas de error siguen diciendo en qué función falló.
  return esbuild.transformSync(s, { loader: 'js', minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false,
                                    charset: 'utf8', target: 'es2020', legalComments: 'none' }).code;
};

variante('full', gs.concat(html));
variante('gs', gs);
variante('gsmin', gs, comprimirGs);
variante('html', html);
// La variante comprimida tiene que seguir compilando: si no, mediría un proyecto roto.
for (const f of fs.readdirSync(path.join(SCR, 'var-gsmin')).filter((x) => x.endsWith('.gs'))) {
  new Function(fs.readFileSync(path.join(SCR, 'var-gsmin', f), 'utf8'));
}
console.log('gsmin compila: sí');

// Candidata realista: .gs comprimidos + HTML compilado (parciales y páginas, con los scriptlets protegidos).
const { completo } = require('./medir2-lib.js');
variante('todomin', gs.concat(html), (f, s) => f.endsWith('.gs') ? comprimirGs(f, s) : completo(s.replace(/<!--[\s\S]*?-->/g, '')));

// Sin comentarios pero CON los mismos números de línea: los errores de Stackdriver siguen
// apuntando a la línea del fuente. Los comentarios los localiza acorn (no un regex), para no
// confundirlos con cadenas o expresiones regulares.
const acorn = require('acorn');
function sinComentariosMismasLineas(s) {
  const tramos = [];
  acorn.parse(s, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true,
                   onComment: (bloque, texto, ini, fin) => tramos.push([ini, fin]) });
  let out = '', i = 0;
  for (const [ini, fin] of tramos) {
    out += s.slice(i, ini) + s.slice(ini, fin).replace(/[^\n]/g, '');
    i = fin;
  }
  out += s.slice(i);
  return out.replace(/^[ \t]+/gm, '').replace(/[ \t]+$/gm, '');
}
variante('gscom', gs, (f, s) => sinComentariosMismasLineas(s));
for (const f of fs.readdirSync(path.join(SCR, 'var-gscom')).filter((x) => x.endsWith('.gs') && !/^ZZ_/.test(x))) {
  const a = fs.readFileSync(path.join(ORIGEN, f), 'utf8'), b = fs.readFileSync(path.join(SCR, 'var-gscom', f), 'utf8');
  new Function(b);
  if (a.split('\n').length !== b.split('\n').length) throw new Error('cambió el número de líneas en ' + f);
}
console.log('gscom compila y conserva las líneas: sí');

// CANDIDATA para la Fase A: .gs sin comentarios (líneas intactas) + parciales compilados como
// archivos separados (include() los sigue pegando sin evaluarlos) + páginas sin comentarios HTML
// de nivel de marcado (dentro de <script>/<style> no se toca nada de las plantillas).
const esParcial = (f) => /^(app_.*|.*Partial)\.html$/.test(f);
function paginaSinComentariosHtml(s) {
  const { comoGoogle } = require('./medir2-lib.js');
  // Solo se quitan los <!-- --> del marcado; el resto de la plantilla queda byte a byte.
  let out = '', i = 0; const low = s.toLowerCase();
  while (i < s.length) {
    if (s.startsWith('<!--', i)) { const f = s.indexOf('-->', i + 4); i = f < 0 ? s.length : f + 3; continue; }
    const tag = low.startsWith('<script', i) ? 'script' : low.startsWith('<style', i) ? 'style' : null;
    if (tag) { const c = low.indexOf('</' + tag, i); const f = s.indexOf('>', c) + 1; out += s.slice(i, f); i = f; continue; }
    out += s[i++];
  }
  return out;
}
variante('cand', gs.concat(html), (f, s) =>
  f.endsWith('.gs') ? sinComentariosMismasLineas(s) : esParcial(f) ? completo(s) : paginaSinComentariosHtml(s));
