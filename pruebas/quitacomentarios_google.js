/*
 * Modelo del quitacomentarios que Google aplica a cada <script> al servir una página de Apps Script.
 * No es una suite: lo usa pruebas/build.test.js.
 *
 * Se armó el 24/09/2026, cuando el Portal de pruebas se quedó en «Cargando datos…»: con estas
 * reglas, el bloque principal de Index.html sale con la MISMA huella SHA-256 que el que sirvió
 * Google, roto. No es un analizador de JS, y eso es justo lo que modela:
 *   · entiende las cadenas '…' y "…", con sus escapes y aunque crucen líneas;
 *   · NO entiende las plantillas `…`: para él, la comilla invertida es un carácter más;
 *   · abre una expresión regular en una / que siga a ( , = : [ ! & | ? { } ; + - * % < > ~ ^, o a
 *     return, typeof, in, of…, y la cierra en la siguiente / sin escapar: no mira las clases [ ]
 *     ni los saltos de línea;
 *   · quita // hasta el final de la línea, y cambia un comentario de bloque por un salto de línea
 *     si ocupaba varias o por un espacio si ocupaba una.
 * En cuanto se equivoca una vez (una plantilla con un apóstrofo, un `</svg>` dentro de `…`) va
 * desfasado el resto del bloque, y el siguiente // que encuentre fuera de lo que cree una cadena lo
 * corta, aunque esté dentro de una cadena de verdad. Por eso el build no deja ni un // ni un /* en
 * ningún <script> (sinBarrasCortables en scripts/build.js).
 *
 * Uso: quitar(js) → el JS como lo serviría Google (la sangría la deja: medido el 25/09/2026).
 *      quitar(js, true) → { out, eventos }: lo que reconoció, con su tipo ('//', '/*', "'", '"',
 *      're') y su posición.
 * Desde la consola, para revisar algo que se va a subir SIN pasar por el build actual (una copia
 * vieja, la fuente tal cual):
 *      node pruebas/quitacomentarios_google.js <carpeta>/*.html
 * Dice, bloque a bloque, qué cortaría Google que no sea un comentario y si el bloque dejaría de
 * leerse. Los bloques con scriptlets se saltan (lo que ve Google ahí no es ese texto).
 */
const BS = '\\';
const TRAS_PALABRA = /(?:^|[^A-Za-z0-9_$])(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)\s*$/;
const ABRE_REGEX = '(,=:[!&|?{};+-*%<>~^';

function quitar(s, conEventos) {
  let out = '', i = 0, prev = '';
  const n = s.length, eventos = [];
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') {
      let j = s.indexOf('\n', i); if (j < 0) j = n;
      eventos.push({ tipo: '//', ini: i, fin: j });
      i = j; continue;
    }
    if (c === '/' && d === '*') {
      let j = s.indexOf('*/', i + 2); if (j < 0) j = n - 2;
      eventos.push({ tipo: '/*', ini: i, fin: j + 2 });
      out += s.slice(i, j + 2).indexOf('\n') !== -1 ? '\n' : ' ';
      i = j + 2; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (s[j] === BS) { j += 2; continue; }
        if (s[j] === c) break;
        j++;
      }
      eventos.push({ tipo: c, ini: i, fin: j + 1 });
      out += s.slice(i, j + 1); i = j + 1; prev = c; continue;
    }
    if (c === '/' && (prev === '' || ABRE_REGEX.indexOf(prev) !== -1 || TRAS_PALABRA.test(s.slice(Math.max(0, i - 24), i)))) {
      let j = i + 1;
      while (j < n) {
        if (s[j] === BS) { j += 2; continue; }
        if (s[j] === '/') break;
        j++;
      }
      eventos.push({ tipo: 're', ini: i, fin: j + 1 });
      out += s.slice(i, j + 1); i = j + 1; prev = '/'; continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return conEventos ? { out, eventos } : out;
}

module.exports = { quitar };

if (require.main === module) {
  const fs = require('fs'), path = require('path');
  const acorn = require('acorn');
  let danos = 0, rotos = 0;
  for (const f of process.argv.slice(2)) {
    const html = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[1] || '', js = m[2];
      if (/\ssrc\s*=/i.test(attrs) || /type\s*=\s*["']?(module|application\/json|text\/(template|html))/i.test(attrs)) continue;
      if (!js.trim() || js.indexOf('<?') !== -1) continue;
      const linea = html.slice(0, m.index).split('\n').length;
      const reales = new Set();
      try { acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script', onComment: (b, t, ini) => reales.add(ini) }); }
      catch (e) { console.log(path.basename(f) + ':' + linea + ' no se deja leer ni antes de Google (' + e.message + ')'); continue; }
      const { out, eventos } = quitar(js, true);
      const malos = eventos.filter((e) => (e.tipo === '//' || e.tipo === '/*') && !reales.has(e.ini));
      let rota = null;
      try { new Function(out); } catch (e) { rota = e.message; }
      if (!malos.length && !rota) continue;
      danos += malos.length; if (rota) rotos++;
      console.log(path.basename(f) + ':' + linea + ' → ' + malos.length + ' cortes que no son comentarios' + (rota ? ', y el bloque ya no se lee: ' + rota : ''));
      for (const d of malos.slice(0, 5)) {
        console.log('    línea ' + (linea + js.slice(0, d.ini).split('\n').length - 1) + ': ' + JSON.stringify(js.slice(d.ini, Math.min(d.fin, d.ini + 80))));
      }
    }
  }
  console.log(danos || rotos ? '✖ ' + danos + ' cortes dañinos, ' + rotos + ' bloques rotos' : '✔ Google no cortaría nada que no sea un comentario');
  process.exit(danos || rotos ? 1 : 0);
}
