/*
 * Pruebas de Artículos (fase 8).   Ejecutar:  node pruebas/f8_articulos.test.js
 *
 * La mitad de este archivo es el BANCO DE CONTENIDO HOSTIL que pide el criterio de
 * aceptación 2 de la fase: «Contenido hostil (script en el texto, URL javascript:) queda
 * inerte: revisión de seguridad del render con casos escritos».
 *
 * Por qué se prueba en el SERVIDOR y no solo en el navegador: un artículo lo escribe una
 * persona con permiso, pero lo lee el equipo entero. El cliente valida por comodidad; la
 * aduana de verdad es artSanearContenido_, porque el payload llega por google.script.run y
 * nada impide fabricarlo a mano. Lo que no pase por aquí, no llega a la hoja — y lo que no
 * está en la hoja no se puede pintar.
 *
 * La otra mitad cubre el modelo: autoría que no se reescribe al editar, borradores que no
 * se sirven a quien no puede verlos, y el registro de lectura (idempotente por persona).
 *
 * Se cargan Portal.gs y Articulos.gs REALES en un contexto compartido —como en Apps
 * Script— sobre una hoja de cálculo fingida.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');

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

/* ── Hoja de cálculo fingida (misma que usa f7_publicaciones.test.js) ────────── */
function hoja(nombre, filas) {
  const datos = filas.map((f) => f.slice());
  const anchoMax = () => Math.max(26, datos.reduce((m, f) => Math.max(m, f.length), 0));
  const api = {
    _datos: datos,
    getName: () => nombre,
    getLastRow: () => datos.length,
    getLastColumn: () => datos.reduce((m, f) => Math.max(m, f.length), 0),
    getMaxColumns: anchoMax,
    getMaxRows: () => Math.max(1000, datos.length),
    setFrozenRows: () => api,
    insertColumnsAfter: () => api,
    appendRow: (row) => { datos.push(row.slice()); return api; },
    deleteRow: (i) => { datos.splice(i - 1, 1); return api; },
    getDataRange: () => api.getRange(1, 1, datos.length, api.getLastColumn()),
    getRange: (fila, col, nFilas, nCols) => {
      nFilas = nFilas === undefined ? 1 : nFilas;
      nCols = nCols === undefined ? 1 : nCols;
      if (fila < 1 || col < 1) throw new Error('getRange fuera de rango');
      if (col + nCols - 1 > anchoMax()) throw new Error('getRange excede las columnas de la hoja');
      const rango = {
        getValues: () => {
          const out = [];
          for (let r = 0; r < nFilas; r++) {
            const src = datos[fila - 1 + r] || [];
            const linea = [];
            for (let c = 0; c < nCols; c++) linea.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
            out.push(linea);
          }
          return out;
        },
        getValue: () => {
          const src = datos[fila - 1] || [];
          return src[col - 1] === undefined ? '' : src[col - 1];
        },
        setValues: (vals) => {
          for (let r = 0; r < vals.length; r++) {
            const destino = fila - 1 + r;
            if (!datos[destino]) datos[destino] = [];
            for (let c = 0; c < vals[r].length; c++) datos[destino][col - 1 + c] = vals[r][c];
          }
          return rango;
        },
        setValue: (v) => {
          if (!datos[fila - 1]) datos[fila - 1] = [];
          datos[fila - 1][col - 1] = v;
          return rango;
        },
        setFontWeight: () => rango
      };
      return rango;
    }
  };
  return api;
}

function libro(hojas) {
  return {
    getSheetByName: (n) => hojas[n] || null,
    insertSheet: (n) => { hojas[n] = hoja(n, []); return hojas[n]; }
  };
}

function cargar(hojas, opciones) {
  opciones = opciones || {};
  const cacheScript = {};
  const estado = { hojas, cache: cacheScript, lockDisponible: opciones.lockDisponible !== false, usuarioActivo: opciones.usuarioActivo || '' };
  const conPermiso = opciones.conPermiso || [];

  const ctx = {
    JSON, String, Number, Object, Array, Math, Date, RegExp, isNaN, parseInt, parseFloat, console,
    Logger: { log: () => {} },
    Session: {
      getScriptTimeZone: () => 'America/Mexico_City',
      getActiveUser: () => ({ getEmail: () => estado.usuarioActivo })
    },
    Utilities: {
      DigestAlgorithm: { MD5: 'MD5' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: (a, txt) => Array.from(require('crypto').createHash('md5').update(String(txt), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      formatDate: (d, tz, fmt) => {
        const p = (n) => String(n).padStart(2, '0');
        if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      }
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cacheScript ? cacheScript[k] : null),
        put: (k, v) => { cacheScript[k] = v; },
        remove: (k) => { delete cacheScript[k]; }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => estado.lockDisponible,
        waitLock: () => { if (!estado.lockDisponible) throw new Error('sin candado'); },
        releaseLock: () => {}
      })
    },
    SpreadsheetApp: { flush: () => {}, openById: () => libro(hojas) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    DriveApp: {},
    secConfig_: (clave, respaldo) => respaldo,
    secIdentidad_: (correo) => (String(correo || '').indexOf('@') > 0
      ? { ok: true, email: String(correo).toLowerCase(), nombre: 'Lector De Prueba' }
      : { ok: false, error: 'sin sesión' }),
    // Solo los correos de `conPermiso` tienen el bloque 'articulos'.
    secIdentidadConBloque_: (correo, bloque) => {
      const c = String(correo || '').toLowerCase();
      if (c && conPermiso.indexOf(c) > -1) return { ok: true, email: c, nombre: 'Quien Publica', bloques: [bloque] };
      return { ok: false, email: c, error: 'Tu cuenta no tiene acceso a "' + bloque + '".' };
    },
    secIntentosRevisar_: () => ({ bloqueado: false }),
    secIntentosSumar_: () => {}
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ['Portal.gs', 'Articulos.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(PROY, f), 'utf8'), ctx, { filename: f });
  });
  vm.runInContext(
    'this.artUrlSegura_ = artUrlSegura_; this.artDocDeUrl_ = artDocDeUrl_;' +
    'this.artSanearContenido_ = artSanearContenido_; this.artTextoPlano_ = artTextoPlano_;' +
    'this.artGuardar = artGuardar; this.artObtener = artObtener; this.artListar = artListar;' +
    'this.artPublicar = artPublicar; this.artEliminar = artEliminar; this.artLectores = artLectores;' +
    'this.artIndiceBuscador = artIndiceBuscador; this.artCols_ = artCols_;' +
    'this.ART_HEADERS = ART_HEADERS; this.ART_MAX_JSON = ART_MAX_JSON;',
    ctx, { filename: 'exportar' });
  ctx.__estado = estado;
  return ctx;
}

const AUTOR = 'quien@publica.com';
const LECTOR = 'lector@equipo.com';

/* ══════════════════════════════════════════════════════════════════════════════ */
console.log('\n1. BANCO HOSTIL · URLs que no deben sobrevivir');
{
  const ctx = cargar({});
  const malas = [
    ['javascript:alert(1)', 'javascript:'],
    ['JaVaScRiPt:alert(1)', 'javascript: con mayúsculas'],
    ['  javascript:alert(1)', 'javascript: con espacios delante'],
    ['\tjavascript:alert(1)', 'javascript: tras un tabulador'],
    ['java\nscript:alert(1)', 'javascript: partido por un salto de línea'],
    ['data:text/html,<script>alert(1)</script>', 'data: con HTML'],
    ['//evil.example.com/x', 'protocolo relativo (lo resuelve el navegador como absoluto)'],
    ['http://sin-tls.example.com', 'http sin cifrar'],
    ['vbscript:msgbox(1)', 'vbscript:'],
    ['https://ok.example.com/a b', 'https con espacio (rompe el atributo)'],
    ['https://ok.example.com/"onload="alert(1)', 'https con comilla que cierra el atributo'],
    ['https://ok.example.com/<img>', 'https con signos de etiqueta'],
    ['', 'cadena vacía'],
    [null, 'null']
  ];
  malas.forEach(([u, nombre]) => eq('rechaza ' + nombre, ctx.artUrlSegura_(u), ''));

  eq('acepta una https normal', ctx.artUrlSegura_('https://liverpool.com.mx/promo?a=1&b=2'),
    'https://liverpool.com.mx/promo?a=1&b=2');
  eq('y recorta los espacios de los lados', ctx.artUrlSegura_('  https://x.com/y  '), 'https://x.com/y');
  eq('rechaza una https absurdamente larga', ctx.artUrlSegura_('https://x.com/' + 'a'.repeat(2100)), '');
}

console.log('\n2. BANCO HOSTIL · el texto sigue siendo texto');
{
  const ctx = cargar({});
  const c = ctx.artSanearContenido_({
    bloques: [
      { tipo: 'texto', partes: [{ t: '<script>alert(1)</script>' }] },
      { tipo: 'texto', partes: [{ t: 'pulsa aquí', url: 'javascript:alert(1)' }] },
      { tipo: 'titulo', texto: '<img src=x onerror=alert(1)>' },
      { tipo: 'imagen', url: 'javascript:alert(1)', alt: 'x' },
      { tipo: 'imagen', url: 'https://drive.google.com/thumbnail?id=abc', alt: '"><script>' },
      { tipo: 'guion', src: 'https://evil.example.com/x.js' },
      { tipo: 'texto', partes: [{ t: 'con control\x00\x08 dentro' }] }
    ]
  });

  eq('el <script> se guarda como TEXTO, no se pierde ni se ejecuta',
    c.bloques[0].partes[0].t, '<script>alert(1)</script>');
  ok('un bloque de texto no tiene ningún campo de HTML',
    !('html' in c.bloques[0]) && !('innerHTML' in c.bloques[0]), JSON.stringify(c.bloques[0]));

  eq('el enlace javascript: pierde la URL y conserva el texto', c.bloques[1].partes[0].t, 'pulsa aquí');
  ok('y no queda ninguna url en esa parte', !('url' in c.bloques[1].partes[0]), JSON.stringify(c.bloques[1]));

  eq('un título con etiqueta se guarda como texto', c.bloques[2].texto, '<img src=x onerror=alert(1)>');

  // La imagen con URL inválida desaparece entera: sin src no hay imagen que pintar.
  const imgs = c.bloques.filter((b) => b.tipo === 'imagen');
  eq('la imagen con javascript: se descarta entera', imgs.length, 1);
  eq('la imagen buena sobrevive', imgs[0].url, 'https://drive.google.com/thumbnail?id=abc');
  eq('y su texto alternativo se guarda tal cual (lo escapa el render)', imgs[0].alt, '"><script>');

  ok('un tipo de bloque inventado se descarta',
    !c.bloques.some((b) => b.tipo === 'guion'), JSON.stringify(c.bloques.map((b) => b.tipo)));

  const conControl = c.bloques[c.bloques.length - 1].partes[0].t;
  ok('los caracteres de control se limpian', conControl.indexOf('\x00') === -1 && conControl.indexOf('\x08') === -1,
    JSON.stringify(conControl));
}

console.log('\n3. BANCO HOSTIL · documentos de Google');
{
  const ctx = cargar({});
  const casos = [
    ['https://docs.google.com/presentation/d/1AbC_def-123456789/edit#slide=id.p3', 'presentacion', '1AbC_def-123456789'],
    ['https://docs.google.com/document/d/1AbC_def-123456789/edit?usp=sharing', 'documento', '1AbC_def-123456789'],
    ['https://docs.google.com/spreadsheets/d/1AbC_def-123456789/edit#gid=0', 'hoja', '1AbC_def-123456789'],
    ['https://drive.google.com/file/d/1AbC_def-123456789/view', 'archivo', '1AbC_def-123456789']
  ];
  casos.forEach(([url, clase, id]) => {
    const d = ctx.artDocDeUrl_(url);
    ok('reconoce ' + clase, !!d && d.clase === clase && d.docId === id, JSON.stringify(d));
  });

  const falsas = [
    'https://docs.google.com.evil.example/presentation/d/1AbC_def-123456789/edit',
    'http://docs.google.com/document/d/1AbC_def-123456789/edit',
    'https://evil.example.com/docs.google.com/document/d/1AbC_def-123456789',
    'https://docs.google.com/document/d//edit',
    'no es una url'
  ];
  falsas.forEach((u) => eq('rechaza ' + u.slice(0, 46), ctx.artDocDeUrl_(u), null));

  // El bloque guarda el ID, no la URL con la sesión de quien la pegó.
  const c = ctx.artSanearContenido_({
    bloques: [{ tipo: 'documento', url: 'https://docs.google.com/presentation/d/1AbC_def-123456789/edit#slide=id.p3' }]
  });
  eq('el bloque documento se queda con la clase', c.bloques[0].clase, 'presentacion');
  eq('y con el id limpio', c.bloques[0].docId, '1AbC_def-123456789');
  ok('sin arrastrar la URL original', !('url' in c.bloques[0]), JSON.stringify(c.bloques[0]));
  eq('un documento sin id válido se descarta',
    ctx.artSanearContenido_({ bloques: [{ tipo: 'documento', docId: 'x' }] }).bloques.length, 0);
}

console.log('\n3 bis. BANCO HOSTIL · diagramas de draw.io');
{
  const ctx = cargar({});
  const bueno = '<mxfile host="embed.diagrams.net"><diagram>abc</diagram></mxfile>';
  const c = ctx.artSanearContenido_({ bloques: [{ tipo: 'diagrama', xml: bueno, titulo: 'Flujo de devolución' }] });
  eq('un diagrama válido se guarda', c.bloques.length, 1);
  eq('con su XML intacto', c.bloques[0].xml, bueno);
  eq('y su título', c.bloques[0].titulo, 'Flujo de devolución');
  ok('con un alto acotado', c.bloques[0].alto >= 240 && c.bloques[0].alto <= 900, String(c.bloques[0].alto));

  eq('también acepta el otro formato de draw.io',
    ctx.artSanearContenido_({ bloques: [{ tipo: 'diagrama', xml: '<mxGraphModel dx="1"><root/></mxGraphModel>' }] }).bloques.length, 1);

  // Lo que NO es un diagrama no entra: este campo viaja a un iframe de terceros.
  const basura = [
    ['<script>alert(1)</script>', 'un guion disfrazado de diagrama'],
    ['<svg onload=alert(1)></svg>', 'un SVG con manejador'],
    ['<html><body>hola</body></html>', 'HTML cualquiera'],
    ['no soy xml', 'texto suelto'],
    ['', 'vacío'],
    ['   <mxfile>x</mxfile>', 'con espacios delante (se recorta y sí vale)']
  ];
  basura.slice(0, 5).forEach(([xml, nombre]) => {
    eq('rechaza ' + nombre,
      ctx.artSanearContenido_({ bloques: [{ tipo: 'diagrama', xml: xml }] }).bloques.length, 0);
  });
  eq('el que solo traía espacios delante sí se guarda',
    ctx.artSanearContenido_({ bloques: [{ tipo: 'diagrama', xml: '   <mxfile>x</mxfile>' }] }).bloques.length, 1);

  const enorme = ctx.artSanearContenido_({ bloques: [{ tipo: 'diagrama', xml: '<mxfile>' + 'x'.repeat(25000) + '</mxfile>' }] });
  eq('un diagrama desmesurado se descarta en vez de reventar la celda', enorme.bloques.length, 0);

  const alturas = ctx.artSanearContenido_({ bloques: [
    { tipo: 'diagrama', xml: bueno, alto: 5000 }, { tipo: 'diagrama', xml: bueno, alto: 10 }
  ] });
  eq('un alto disparatado se recorta arriba', alturas.bloques[0].alto, 900);
  eq('y abajo', alturas.bloques[1].alto, 240);

  const plano = ctx.artTextoPlano_(c);
  ok('el buscador encuentra el diagrama por su título', plano.indexOf('Flujo de devolución') > -1, plano);
}

console.log('\n4. Tablas y listas: forma sana pase lo que pase');
{
  const ctx = cargar({});
  const c = ctx.artSanearContenido_({
    bloques: [
      { tipo: 'tabla', filas: [['a', 'b', 'c'], ['d'], ['e', 'f']] },
      { tipo: 'lista', items: [[{ t: 'uno' }], [{ t: '' }], [{ t: 'dos', url: 'https://x.com' }]] }
    ]
  });
  const t = c.bloques[0];
  eq('la tabla dentada se rellena a un ancho único', t.filas.map((f) => f.length).join(','), '3,3,3');
  eq('sin inventar contenido', t.filas[1].join('|'), 'd||');
  const l = c.bloques[1];
  eq('la lista descarta los renglones vacíos', l.items.length, 2);
  eq('y conserva el enlace bueno', l.items[1][0].url, 'https://x.com');

  const enorme = ctx.artSanearContenido_({
    bloques: [{ tipo: 'tabla', filas: Array.from({ length: 500 }, () => Array.from({ length: 40 }, () => 'x')) }]
  });
  ok('una tabla enorme se recorta a lo que cabe',
    enorme.bloques[0].filas.length <= 60 && enorme.bloques[0].filas[0].length <= 12,
    enorme.bloques[0].filas.length + 'x' + enorme.bloques[0].filas[0].length);

  const muchos = ctx.artSanearContenido_({
    bloques: Array.from({ length: 500 }, () => ({ tipo: 'separador' }))
  });
  ok('y un artículo con demasiados bloques también', muchos.bloques.length <= 200, String(muchos.bloques.length));
  eq('el contenido sale versionado', ctx.artSanearContenido_({ bloques: [] }).v, 1);
  eq('un contenido basura no revienta', ctx.artSanearContenido_(null).bloques.length, 0);
}

console.log('\n5. Permiso: escribir exige el bloque, leer no');
{
  const arts = hoja('Articulos', [ART_HDR()]);
  const ctx = cargar({ Articulos: arts }, { conPermiso: [AUTOR] });

  const sinPermiso = ctx.artGuardar({ titulo: 'Mío', contenido: { bloques: [] }, asesor: LECTOR });
  eq('quien no tiene el bloque no puede guardar', sinPermiso.status, 'error');
  eq('y la hoja sigue vacía', arts._datos.length, 1);

  const conPermiso = ctx.artGuardar({ titulo: 'Guía de devoluciones', resumen: 'Cómo se hace', contenido: { bloques: [{ tipo: 'texto', partes: [{ t: 'Hola' }] }] }, asesor: AUTOR });
  eq('quien lo tiene, sí', conPermiso.status, 'ok');
  ok('y le sale un id con prefijo art-', /^art-/.test(conPermiso.id), conPermiso.id);
  eq('nace como borrador', conPermiso.estado, 'borrador');

  eq('un artículo sin título se rechaza',
    ctx.artGuardar({ titulo: '   ', contenido: { bloques: [] }, asesor: AUTOR }).status, 'error');
}

console.log('\n6. Borradores: no se listan ni se sirven a quien no puede verlos');
{
  const arts = hoja('Articulos', [ART_HDR()]);
  const ctx = cargar({ Articulos: arts }, { conPermiso: [AUTOR] });
  const a = ctx.artGuardar({ titulo: 'Borrador', contenido: { bloques: [] }, asesor: AUTOR });
  const b = ctx.artGuardar({ titulo: 'Publicado', estado: 'publicado', contenido: { bloques: [] }, asesor: AUTOR });

  const comoLector = ctx.artListar(LECTOR, {});
  eq('el lector solo ve el publicado', comoLector.articulos.length, 1);
  eq('y es el que toca', comoLector.articulos[0].titulo, 'Publicado');
  eq('y se le dice que no puede editar', comoLector.puedeEditar, false);

  const comoAutor = ctx.artListar(AUTOR, {});
  eq('quien publica ve los dos', comoAutor.articulos.length, 2);
  eq('y se le dice que sí puede editar', comoAutor.puedeEditar, true);

  eq('abrir el borrador sin permiso se rechaza', ctx.artObtener(a.id, LECTOR).status, 'error');
  eq('con permiso se abre', ctx.artObtener(a.id, AUTOR).status, 'ok');
  eq('el publicado lo abre cualquiera', ctx.artObtener(b.id, LECTOR).status, 'ok');
  eq('y lo que no existe se dice', ctx.artObtener('art-fantasma', AUTOR).status, 'error');

  eq('el índice del buscador solo trae publicados', ctx.artIndiceBuscador(LECTOR).articulos.length, 1);
}

console.log('\n7. Autoría: se fija al crear y no se la queda quien corrige');
{
  const arts = hoja('Articulos', [ART_HDR()]);
  const ctx = cargar({ Articulos: arts }, { conPermiso: [AUTOR, 'otra@persona.com'] });
  const r = ctx.artGuardar({ titulo: 'Primero', contenido: { bloques: [] }, asesor: AUTOR });
  const c = ctx.artCols_(ART_HDR());
  const autorInicial = arts._datos[1][c.autores];
  const creadoInicial = arts._datos[1][c.creado];
  ok('queda el autor', !!autorInicial, String(autorInicial));

  ctx.artGuardar({ id: r.id, titulo: 'Primero (corregido)', contenido: { bloques: [] }, asesor: 'otra@persona.com' });
  eq('el autor NO cambia al editar', arts._datos[1][c.autores], autorInicial);
  eq('la fecha de creación tampoco', arts._datos[1][c.creado], creadoInicial);
  eq('pero sí quien editó', arts._datos[1][c.editadoPor], 'Quien Publica');
  eq('y sigue habiendo una sola fila', arts._datos.length, 2);
  eq('con el título nuevo', arts._datos[1][c.titulo], 'Primero (corregido)');
}

console.log('\n8. Registro de lectura: una fila por persona, y no cuenta los refrescos');
{
  const arts = hoja('Articulos', [ART_HDR()]);
  const vistas = hoja('ArticulosVistas', [['ID articulo', 'Correo', 'Nombre', 'Primera vez', 'Ultima vez', 'Veces']]);
  const ctx = cargar({ Articulos: arts, ArticulosVistas: vistas }, { conPermiso: [AUTOR] });
  const a = ctx.artGuardar({ titulo: 'Leído', estado: 'publicado', contenido: { bloques: [] }, asesor: AUTOR });

  ctx.artObtener(a.id, LECTOR);
  eq('la primera lectura deja una fila', vistas._datos.length, 2);
  ctx.artObtener(a.id, LECTOR);
  eq('refrescar dentro de la ventana no añade otra', vistas._datos.length, 2);

  // Fuera de la ventana (se vacía la caché a mano, que es lo que hace el tiempo).
  Object.keys(ctx.__estado.cache).forEach((k) => { if (k.indexOf('artVisto_') === 0) delete ctx.__estado.cache[k]; });
  ctx.artObtener(a.id, LECTOR);
  eq('más tarde sigue siendo UNA fila', vistas._datos.length, 2);
  eq('pero cuenta dos lecturas', Number(vistas._datos[1][5]), 2);

  ctx.artObtener(a.id, 'otra@persona.com');
  eq('otra persona sí añade fila', vistas._datos.length, 3);

  const comoLector = ctx.artLectores(a.id, LECTOR);
  eq('el lector no puede ver quién ha leído', comoLector.status, 'error');
  const comoAutor = ctx.artLectores(a.id, AUTOR);
  eq('quien publica sí', comoAutor.status, 'ok');
  eq('y ve a los dos', comoAutor.total, 2);

  // Un borrador no cuenta lecturas: todavía no es algo que se haya leído.
  const b = ctx.artGuardar({ titulo: 'En curso', contenido: { bloques: [] }, asesor: AUTOR });
  const antes = vistas._datos.length;
  ctx.artObtener(b.id, AUTOR);
  eq('abrir un borrador no registra lectura', vistas._datos.length, antes);
}

console.log('\n9. Publicar, despublicar y borrar');
{
  const arts = hoja('Articulos', [ART_HDR()]);
  const ctx = cargar({ Articulos: arts }, { conPermiso: [AUTOR] });
  const a = ctx.artGuardar({ titulo: 'Cambiante', contenido: { bloques: [] }, asesor: AUTOR });

  eq('publicar sin permiso se rechaza', ctx.artPublicar(a.id, true, LECTOR).status, 'error');
  eq('con permiso se publica', ctx.artPublicar(a.id, true, AUTOR).estado, 'publicado');
  eq('el lector ya lo ve', ctx.artListar(LECTOR, {}).articulos.length, 1);
  eq('se puede devolver a borrador', ctx.artPublicar(a.id, false, AUTOR).estado, 'borrador');
  eq('y el lector deja de verlo', ctx.artListar(LECTOR, {}).articulos.length, 0);

  eq('borrar sin permiso se rechaza', ctx.artEliminar(a.id, LECTOR).status, 'error');
  eq('con permiso se borra', ctx.artEliminar(a.id, AUTOR).status, 'ok');
  eq('y la hoja se queda sin la fila', arts._datos.length, 1);
}

console.log('\n10. El tope de tamaño se dice, no se trunca en silencio');
{
  const arts = hoja('Articulos', [ART_HDR()]);
  const ctx = cargar({ Articulos: arts }, { conPermiso: [AUTOR] });
  // Muchos bloques de texto largo: se pasa del tope de la celda.
  const bloques = Array.from({ length: 60 }, () => ({ tipo: 'texto', partes: [{ t: 'x'.repeat(1000) }] }));
  const r = ctx.artGuardar({ titulo: 'Enorme', contenido: { bloques: bloques }, asesor: AUTOR });
  eq('un artículo que no cabe se rechaza con un motivo', r.status, 'error');
  ok('y el motivo se entiende', /demasiado largo/.test(r.error || ''), r.error);
  eq('sin dejar nada a medias en la hoja', arts._datos.length, 1);
}

console.log('\n11. El texto plano que alimenta al buscador');
{
  const ctx = cargar({});
  const plano = ctx.artTextoPlano_(ctx.artSanearContenido_({
    bloques: [
      { tipo: 'titulo', texto: 'Devoluciones SAP' },
      { tipo: 'texto', partes: [{ t: 'La leyenda va ' }, { t: 'aquí', url: 'https://x.com' }] },
      { tipo: 'tabla', filas: [['Clave', 'Valor'], ['FBL5N', 'Consulta']] },
      { tipo: 'imagen', url: 'https://x.com/a.png', pie: 'Pantalla de ejemplo' },
      { tipo: 'documento', docId: 'abcdefghij12', clase: 'hoja', titulo: 'Matriz de rechazos' },
      { tipo: 'separador' }
    ]
  }));
  ok('incluye el título', plano.indexOf('Devoluciones SAP') > -1, plano);
  ok('el texto con sus enlaces', plano.indexOf('La leyenda va aquí') > -1, plano);
  ok('el contenido de la tabla', plano.indexOf('FBL5N') > -1, plano);
  ok('el pie de la imagen', plano.indexOf('Pantalla de ejemplo') > -1, plano);
  ok('y el título del documento', plano.indexOf('Matriz de rechazos') > -1, plano);
}

console.log('\n12. El índice que se sirve al buscador (T8.5, servidor)');
{
  const cuerpo = (txt) => JSON.stringify({ v: 1, bloques: [{ tipo: 'texto', partes: [{ t: txt }] }] });
  const arts = hoja('Articulos', [
    ART_HDR(),
    ['art-1', 'Devoluciones por SAP', 'Cómo se devuelve', cuerpo('La transacción FBL5N abre el estado de cuenta'), 'publicado', 'Ana', new Date(), new Date(), 'Ana'],
    ['art-2', 'Guía a medias', 'Todavía no', cuerpo('esto no debería buscarse'), 'borrador', 'Ana', new Date(), new Date(), 'Ana'],
    ['art-3', 'Muy largo', '', cuerpo('z'.repeat(4000)), 'publicado', 'Ana', new Date(), new Date(), 'Ana']
  ]);
  const ctx = cargar({ Articulos: arts });
  const idx = ctx.artIndiceBuscador(LECTOR);

  eq('el índice contesta bien', idx.status, 'ok');
  const ids = idx.articulos.map((a) => a.id).sort().join(',');
  eq('solo van los publicados: un borrador todavía no existe para nadie', ids, 'art-1,art-3');

  const uno = idx.articulos.filter((a) => a.id === 'art-1')[0];
  eq('con su título', uno.titulo, 'Devoluciones por SAP');
  eq('con su resumen', uno.resumen, 'Cómo se devuelve');
  ok('y con el cuerpo, que es como se busca lo que no se sabe cómo se titula',
     uno.texto.indexOf('FBL5N') > -1, uno.texto);

  const largo = idx.articulos.filter((a) => a.id === 'art-3')[0];
  ok('el cuerpo viaja recortado: el índice lo piden todas las pantallas',
     largo.texto.length <= 1200, 'llegaron ' + largo.texto.length + ' caracteres');

  /* Publicar tiene que tirar el índice cacheado. Sin esto un artículo recién publicado no
     se encuentra hasta cinco minutos después, y quien lo acaba de escribir prueba a
     buscarlo justo entonces: la primera impresión sería que el buscador no lo ve. */
  /* El carril del Portal necesita saber cuántos hay para ofrecer «Ver los N»: sin el total
     no puede distinguir «los estoy enseñando todos» de «hay treinta más». */
  const lista = ctx.artListar(LECTOR, { tope: 1 });
  eq('la lista con tope devuelve solo los pedidos', lista.articulos.length, 1);
  eq('pero dice cuántos hay en total para esa persona', lista.total, 2);
  const sinTope = ctx.artListar(LECTOR, {});
  eq('y sin tope el total cuadra con lo servido', sinTope.total, sinTope.articulos.length);
  const comoAutor = cargar({ Articulos: arts }, { conPermiso: [AUTOR] }).artListar(AUTOR, {});
  eq('quien publica cuenta también sus borradores', comoAutor.total, 3);

  const conPerm = cargar({ Articulos: arts }, { conPermiso: [AUTOR] });
  const antes = conPerm.artIndiceBuscador(LECTOR).articulos.map((a) => a.id).sort().join(',');
  eq('antes de publicarlo, el borrador no está (y el índice queda cacheado)', antes, 'art-1,art-3');
  conPerm.artPublicar('art-2', true, AUTOR);
  const despues = conPerm.artIndiceBuscador(LECTOR).articulos.map((a) => a.id).sort().join(',');
  ok('y al publicarlo el índice ya lo trae: la caché se invalidó', despues.indexOf('art-2') > -1, despues);
}

console.log('\n13. Los artículos entran en los DOS buscadores (T8.5, cliente)');
{
  const CMDK = fs.readFileSync(path.join(PROY, 'app_comando.html'), 'utf8');
  const INDEX = fs.readFileSync(path.join(PROY, 'Index.html'), 'utf8');
  const CORE = fs.readFileSync(path.join(PROY, 'app_core.html'), 'utf8');
  const CODE = fs.readFileSync(path.join(PROY, 'Code.gs'), 'utf8');

  // — El buscador general (Ctrl+K) —
  ok('el Ctrl+K pide el índice al servidor', /AppRun\.call\('artIndiceBuscador'/.test(CMDK));
  ok('y lo pide al teclear, con las demás fuentes', /pideArticulos\(pinta\);/.test(CMDK));
  ok('los artículos son un grupo propio y no se mezclan con el Portal',
     /tipo: 'articulo', titulo: 'Artículos'/.test(CMDK));
  ok('un resultado abre el artículo por su ID',
     /f\.tipo === 'articulo'.*navega\('articulo', \{ art: f\.dato\.id \}\)/.test(CMDK));
  ok('y se puede acotar la búsqueda con «art:»', /id: 'art',\s+rotulo: 'Artículos'/.test(CMDK));

  // — El buscador del Portal —
  ok('el Portal pide el mismo índice al servidor', /AppRun\.call\('artIndiceBuscador'/.test(INDEX));
  ok('los artículos son su propio grupo de resultados', /key: '__articulo'/.test(INDEX));
  ok('con su fila pintada y su identificador', /data-art="\$\{esc\(r\.artId\)\}"/.test(INDEX));
  ok('y al pulsarla se abre el artículo', /if \(it\.dataset\.art\)/.test(INDEX));
  ok('el carril ofrece «Ver los N» a quien solo lee, que no tiene entrada en el menú',
     /articulosVerTodos/.test(INDEX) && /AppUrl\.go\('articulo'\)/.test(INDEX));
  ok('y solo cuando de verdad hay más de los que se ven', /const hayMas = total >/.test(INDEX));
  ok('por AppUrl y por ID, no por título',
     /AppUrl\.go\('articulo', \{ art: id \}\)/.test(INDEX));

  /* La lección de F6: si los dos buscadores puntúan el MISMO contenido con pesos
     distintos, la paridad hay que arreglarla caso a caso para siempre. */
  const zonaIdx = (INDEX.match(/function puntuaArticulo\(Q, a\)\{[\s\S]*?\n\}/) || [''])[0];
  const zonaCmdk = (CMDK.match(/var arts = \(esCotizacion[\s\S]*?if \(arts\.length\)/) || [''])[0];
  const pesos = (s) => [...new Set((s.match(/p:\s*\.?\d+(?:\.\d+)?/g) || [])
    .map((x) => parseFloat(x.replace(/p:\s*/, ''))))].sort((a, b) => a - b).join(',');
  ok('hay un puntuador de artículos en el Portal', !!zonaIdx);
  ok('y un grupo de artículos en el Ctrl+K', !!zonaCmdk);
  eq('los dos pesan igual título, resumen y cuerpo', pesos(zonaCmdk), pesos(zonaIdx));
  eq('y son los pesos decididos (cuerpo flojo)', pesos(zonaIdx), '0.55,1.4,3');

  // — El parámetro tiene que existir en las TRES listas espejo o se pierde sin aviso —
  const listaCore = new Function('return ' + CORE.match(/const PARAMS_VISTA = (\[[^\]]*\]);/)[1])();
  const listaCode = new Function('return ' + CODE.match(/const PARAMS_VISTA = (\[[^\]]*\]);/)[1])();
  const listaPasan = new Function('return ' + INDEX.match(/const PASAN = (\[[^\]]*\]);/)[1])();
  ok('«art» viaja en PARAMS_VISTA de Code.gs', listaCode.indexOf('art') > -1);
  ok('«art» viaja en PARAMS_VISTA de app_core.html', listaCore.indexOf('art') > -1);
  ok('«art» viaja en la lista PASAN de Index.html', listaPasan.indexOf('art') > -1);

  // — Y el motor de verdad, con los pesos de verdad —
  const js = fs.readFileSync(path.join(PROY, 'app_buscar.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const bctx = { console, Math, JSON, String, Number, Object, Array, RegExp, Date, parseInt, parseFloat };
  bctx.window = bctx;
  vm.createContext(bctx);
  vm.runInContext(js, bctx, { filename: 'app_buscar.html' });
  const B = bctx.AppBuscar;
  const OPTS = { exigirTodas: false };
  const puntua = (a, q) => B.puntua(B.consulta(q),
    [{ t: a.titulo, p: 3 }, { t: a.resumen, p: 1.4 }, { t: a.texto, p: .55 }], OPTS);

  const art = { titulo: 'Devoluciones por SAP', resumen: 'Cómo se devuelve una compra',
                texto: 'La transacción FBL5N abre el estado de cuenta del cliente' };

  ok('se encuentra por una frase que solo sale en el CUERPO', puntua(art, 'fbl5n') > 0);
  ok('el título pesa más que el cuerpo', puntua(art, 'devoluciones') > puntua(art, 'fbl5n'));

  /* El porqué del .55: un artículo que menciona «transacción» de pasada no puede quitarle
     el sitio a la herramienta del Portal que se llama así. */
  const herramienta = B.puntua(B.consulta('transaccion'), [{ t: 'Transacciones SAP', p: 3 }], OPTS);
  ok('y una mención de pasada no le gana a la herramienta que se llama así',
     herramienta > puntua(art, 'transaccion'),
     'herramienta ' + herramienta + ' vs artículo ' + puntua(art, 'transaccion'));
}

console.log('\n14. Leer no pide permiso, pero sí pide haber entrado');
{
  /* El Portal es una landing PÚBLICA y su carril de artículos preguntaba igual sin sesión:
     un visitante se llevaba la biblioteca interna con títulos, resúmenes y los nombres de
     quienes la escriben — y con el id a la vista, el contenido entero. T8.1 dice «lectura
     para cualquier SESIÓN»: el permiso sobra, la sesión no. */
  const cuerpo = JSON.stringify({ v: 1, bloques: [{ tipo: 'texto', partes: [{ t: 'secreto del equipo' }] }] });
  const arts = hoja('Articulos', [
    ART_HDR(),
    ['art-9', 'Guía interna', 'Solo para el equipo', cuerpo, 'publicado', 'Ana', new Date(), new Date(), 'Ana']
  ]);
  const ctx = cargar({ Articulos: arts });   // usuarioActivo vacío = visitante

  const lista = ctx.artListar('', {});
  eq('un visitante no recibe la lista', lista.status, 'error');
  eq('y no se le cuela ni un artículo', (lista.articulos || []).length, 0);
  ok('con un motivo que se entiende', /Entra al sistema/.test(lista.error || ''), lista.error);

  const uno = ctx.artObtener('art-9', '');
  eq('ni el contenido de uno concreto, aunque sepa el id', uno.status, 'error');
  ok('y se dice que es por la sesión, no que no exista', uno.sinSesion === true, JSON.stringify(uno));

  const idx = ctx.artIndiceBuscador('');
  eq('el buscador público contesta bien, no con un error rojo', idx.status, 'ok');
  eq('pero sin artículos dentro', idx.articulos.length, 0);

  /* La guarda tiene que ir ANTES de la caché, o el índice que dejó caliente alguien con
     sesión se le serviría al siguiente visitante. */
  const conSesion = cargar({ Articulos: arts });
  eq('con sesión sí hay índice', conSesion.artIndiceBuscador(LECTOR).articulos.length, 1);
  eq('y el visitante que llega después del cacheado sigue sin ver nada',
     conSesion.artIndiceBuscador('').articulos.length, 0);

  // Y con sesión, lo de siempre.
  eq('con sesión, la lista llega entera', ctx.artListar(LECTOR, {}).articulos.length, 1);
  eq('y el artículo también', ctx.artObtener('art-9', LECTOR).status, 'ok');
}

/* ── DOM fingido, en la misma línea que la hoja de cálculo de arriba ──────────
   El criterio 2 de la fase nombra «revisión de seguridad DEL RENDER», y hasta aquí solo
   estaba probada la aduana del servidor. Falta la otra mitad, y no es redundante: el
   editor pinta lo que tiene en memoria SIN pasar por el servidor, así que el render es la
   única defensa mientras se escribe.

   No hay jsdom ni forma de instalarlo (este repositorio no tiene dependencias, a propósito),
   así que se finge lo justo. El nodo GUARDA lo que le hacen —hijos, atributos, propiedades—
   y no interpreta nada: si el código pintara con innerHTML, aquí quedaría como una cadena y
   la prueba lo vería, que es exactamente lo que se quiere vigilar. */
function nodoFalso(tag) {
  const n = {
    _tag: String(tag).toLowerCase(),
    nodeType: 1,
    hijos: [],
    attrs: {},
    style: {},
    dataset: {},
    className: '',
    _texto: '',
    appendChild(c) { n.hijos.push(c); return c; },
    removeChild(c) { const i = n.hijos.indexOf(c); if (i > -1) n.hijos.splice(i, 1); return c; },
    setAttribute(k, v) { n.attrs[String(k)] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(n.attrs, k) ? n.attrs[k] : null; },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: {
      add(c) { n.className = (n.className ? n.className + ' ' : '') + c; },
      remove() {}, contains(c) { return n.className.split(/\s+/).indexOf(c) > -1; }
    }
  };
  Object.defineProperty(n, 'firstChild', { get: () => n.hijos[0] || null });
  Object.defineProperty(n, 'textContent', {
    get() {
      if (n._texto) return n._texto;
      return n.hijos.map((h) => (h.textContent === undefined ? '' : h.textContent)).join('');
    },
    set(v) { n.hijos = []; n._texto = String(v); }
  });
  return n;
}

function cargaRender() {
  const html = fs.readFileSync(path.join(PROY, 'articulo.html'), 'utf8');
  const bloques = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) bloques.push(m[1]);
  const js = bloques.filter((b) => b.indexOf('ArticuloRender =') > -1)[0];
  if (!js) throw new Error('no encontré el bloque de render en articulo.html');

  const doc = {
    createElement: (t) => nodoFalso(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), hijos: [] }),
    getElementById: () => null,
    addEventListener() {},
    body: nodoFalso('body')
  };
  const ctx = { console, Math, JSON, String, Number, Object, Array, RegExp, Date, parseInt,
                parseFloat, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout,
                document: doc };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(js, ctx, { filename: 'articulo.html' });
  if (!ctx.ArticuloRender) throw new Error('articulo.html no publicó window.ArticuloRender');
  return ctx.ArticuloRender;
}

/** Recorre el árbol pintado y devuelve todos los nodos con esa etiqueta. */
function porEtiqueta(n, tag) {
  const out = [];
  (function anda(x) {
    if (!x || x.nodeType === 3) return;
    if (x._tag === tag) out.push(x);
    (x.hijos || []).forEach(anda);
  })(n);
  return out;
}

console.log('\n15. BANCO HOSTIL · el RENDER del cliente (criterio 2, la otra mitad)');
{
  const R = cargaRender();

  // — urlSegura del cliente: la misma regla que artUrlSegura_ del servidor —
  const malas = ['javascript:alert(1)', 'JavaScript:alert(1)', '  javascript:alert(1)',
                 'java\tscript:alert(1)', 'data:text/html,<script>x</script>', '//evil.example/x',
                 'http://sin-tls.example', 'vbscript:x', 'https://ok.example/a"onload=x',
                 "https://ok.example/a'x", 'https://ok.example/con espacio', 'https://ok.example/<b>'];
  let coladas = malas.filter((u) => R.urlSegura(u) !== '');
  ok('el cliente rechaza las ' + malas.length + ' URLs hostiles', coladas.length === 0, coladas.join(' | '));
  eq('y deja pasar una https normal', R.urlSegura('https://docs.google.com/a'), 'https://docs.google.com/a');
  eq('una URL absurdamente larga tampoco pasa', R.urlSegura('https://x.example/' + 'a'.repeat(2100)), '');

  // — Un <script> escrito en el texto se queda como TEXTO —
  const p = R.pintarBloque({ tipo: 'texto', partes: [{ t: '<script>alert(1)</script> y <b>negritas</b>' }] });
  eq('un párrafo con etiquetas dentro no crea ni un <script>', porEtiqueta(p, 'script').length, 0);
  eq('ni una <b>', porEtiqueta(p, 'b').length, 0);
  ok('y el texto se conserva entero, sin perderse',
     p.textContent.indexOf('<script>alert(1)</script>') > -1, p.textContent);

  // — Una parte con URL hostil se pinta como texto, nunca como enlace —
  const conMala = R.pintarBloque({ tipo: 'texto', partes: [{ t: 'pincha aquí', url: 'javascript:alert(1)' }] });
  eq('una parte con javascript: no produce enlace', porEtiqueta(conMala, 'a').length, 0);
  eq('pero su texto sigue ahí', conMala.textContent, 'pincha aquí');

  const conBuena = R.pintarBloque({ tipo: 'texto', partes: [{ t: 'la guía', url: 'https://ok.example/g' }] });
  const enlaces = porEtiqueta(conBuena, 'a');
  eq('una parte con https sí produce enlace', enlaces.length, 1);
  eq('con su href', enlaces[0].href, 'https://ok.example/g');
  eq('y sin regalarle la pestaña de origen', enlaces[0].rel, 'noopener noreferrer');

  // — Listas y tablas: el mismo texto, la misma regla —
  const li = R.pintarBloque({ tipo: 'lista', items: [[{ t: '<img onerror=x>', url: 'javascript:1' }]] });
  eq('una lista con contenido hostil no crea imágenes', porEtiqueta(li, 'img').length, 0);
  eq('ni enlaces', porEtiqueta(li, 'a').length, 0);

  const tb = R.pintarBloque({ tipo: 'tabla', filas: [['<script>a</script>', 'b']], encabezado: true });
  eq('una tabla con una etiqueta en una celda no la ejecuta', porEtiqueta(tb, 'script').length, 0);
  ok('y la celda conserva su texto', tb.textContent.indexOf('<script>a</script>') > -1, tb.textContent);

  // — Un tipo de bloque inventado no se pinta y no revienta —
  eq('un tipo desconocido no pinta nada', R.pintarBloque({ tipo: 'inventado', texto: 'x' }), null);

  // — El extractor de documentos de Google, en el cliente —
  const falsas = ['https://docs.google.com.evil.example/document/d/abcdefghij12/edit',
                  'http://docs.google.com/document/d/abcdefghij12/edit',
                  'https://evil.example/docs.google.com/document/d/abcdefghij12/edit',
                  'https://docs.google.com/document/d/corto/edit'];
  coladas = falsas.filter((u) => R.docDeUrl(u) !== null);
  ok('ninguna URL falsa de Google pasa por documento', coladas.length === 0, coladas.join(' | '));
  const buena = R.docDeUrl('https://docs.google.com/presentation/d/1AbCdEfGhIjK/edit#slide=id.p1');
  ok('y una de verdad da su clase y su id', buena && buena.clase === 'presentacion' && buena.docId === '1AbCdEfGhIjK',
     JSON.stringify(buena));

  // — El visor a pantalla completa existe también para los documentos (T8.3) —
  ok('el documento incrustado tiene pantalla completa, como el diagrama y la imagen',
     typeof R.abrirDocumentoGrande === 'function');

  /* — Pegar imágenes (T8.2, criterio 1) —
     El manejador vive en el bloque de interfaz, que necesita media pantalla para cargarse;
     se comprueba sobre el fuente, que es lo que la casa ya hace en el apartado 13. */
  const AH = fs.readFileSync(path.join(PROY, 'articulo.html'), 'utf8');
  ok('el editor escucha el pegado', /addEventListener\('paste', pegarImagen\)/.test(AH));
  ok('solo se queda con lo que es un ARCHIVO de imagen (el TSV de una hoja llega como texto)',
     /it\.kind === 'file' && String\(it\.type \|\| ''\)\.indexOf\('image\/'\) === 0/.test(AH));
  ok('y solo interviene con el editor abierto', /function pegarImagen\(e\)\{\s*\n\s*if \(st\.modo !== 'edita'\) return;/.test(AH));
  ok('varias imágenes de un pegado entran en orden, no una encima de otra',
     /Math\.min\(base \+ n, st\.bloques\.length\)/.test(AH));
}

function ART_HDR() {
  return ['ID', 'Titulo', 'Resumen', 'Contenido (JSON)', 'Estado', 'Autores', 'Creado', 'Editado', 'Editado por'];
}

console.log('\n─────────────────────────────────────────────');
console.log(fallos === 0 ? `TODO OK · ${pruebas} comprobaciones` : `${fallos} FALLOS de ${pruebas}`);
process.exit(fallos === 0 ? 0 : 1);
