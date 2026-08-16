/*
 * Pruebas de Publicaciones 2.0 (fase 7).   Ejecutar:  node pruebas/f7_publicaciones.test.js
 *
 * Cubre los criterios de aceptación de la fase que se pueden comprobar sin desplegar:
 *
 *   · Criterio 2 — «Insertar una fila a mano en el Sheet no cambia el ID de ninguna
 *     publicación existente». Es el que más silenciosamente se rompía: los ids eran la
 *     POSICIÓN de la fila, así que insertar una arriba reasignaba los de todas las de
 *     abajo y los enlaces compartidos empezaban a llevar a otra publicación —sin error,
 *     sin aviso, sin forma de enterarse—.
 *   · Criterio 3 — «Dos personas votando a la vez no pierden votos; editar el anuncio
 *     después no borra resultados; nadie vota dos veces con la misma sesión».
 *   · El contrato de las tres listas espejo con el parámetro `pub` (T7.3).
 *   · El saneo del servidor sobre lo que llega del navegador (tope de opciones, encuesta
 *     incompleta, claves venenosas).
 *
 * Se cargan Portal.gs y Publicaciones.gs REALES en un mismo contexto —que es como viven
 * en Apps Script, donde los .gs comparten ámbito global— sobre una hoja de cálculo
 * fingida. Si alguien cambia una de las dos y rompe a la otra, esto se entera.
 *
 * Esta carpeta queda fuera de "Carpeta del proyecto", así que clasp nunca la sube.
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

/* ── Hoja de cálculo fingida ────────────────────────────────────────────────────
   Lo justo que usan estas funciones, con dos cuidados que no son adorno:
     · getRange() valida los límites como el de verdad (pedir más allá del último borde
       revienta), porque parte de lo que se está probando es precisamente que el código
       no se salga de la hoja.
     · Las celdas se guardan por referencia en una matriz, así que setValues() se ve en
       la siguiente lectura: sin eso, "es idempotente" pasaría siempre. */
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
      /* Los setters devuelven el propio RANGO, como el Range de verdad: el código de
         producción encadena `.setValues(...).setFontWeight('bold')`, y un stub que
         devolviera la hoja haría fallar esa línea aquí y solo aquí —un falso aviso, que
         es peor que no probar—. */
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

/* ── El contexto de Apps Script, fingido ───────────────────────────────────────── */
function cargar(hojas, opciones) {
  opciones = opciones || {};
  const cacheScript = {};
  const estado = {
    hojas: hojas,
    cache: cacheScript,
    intentos: {},
    lockTomado: 0,          // cuántas veces se pidió el candado
    lockDisponible: opciones.lockDisponible !== false,
    usuarioActivo: opciones.usuarioActivo || ''
  };

  const ctx = {
    JSON, String, Number, Object, Array, Math, Date, RegExp, isNaN, parseInt, parseFloat,
    console,
    Logger: { log: () => {} },
    Session: {
      getScriptTimeZone: () => 'America/Mexico_City',
      getActiveUser: () => ({ getEmail: () => estado.usuarioActivo })
    },
    Utilities: {
      DigestAlgorithm: { MD5: 'MD5' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: (algo, txt) => {
        // Un digest de verdad no hace falta: lo que se prueba es que la MISMA entrada
        // dé la MISMA salida y que entradas distintas no choquen. MD5 de Node vale.
        const crypto = require('crypto');
        const buf = crypto.createHash('md5').update(String(txt), 'utf8').digest();
        // Apps Script devuelve bytes con signo; se imita para que el código bajo prueba
        // pase por la misma aritmética que en producción.
        return Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
      },
      formatDate: (d, tz, fmt) => {
        const p = (n) => String(n).padStart(2, '0');
        return fmt === 'yyyy-MM-dd'
          ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` : d.toISOString();
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
        tryLock: () => { estado.lockTomado++; return estado.lockDisponible; },
        waitLock: () => { estado.lockTomado++; if (!estado.lockDisponible) throw new Error('sin candado'); },
        releaseLock: () => {}
      })
    },
    SpreadsheetApp: { flush: () => {}, openById: () => libro(hojas) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    DriveApp: {},
    // Seguridad.gs no se carga entera (arrastra medio sistema); se fingen las tres
    // puertas que Publicaciones.gs usa, con su MISMO contrato.
    secConfig_: (clave, respaldo) => respaldo,
    secIdentidad_: (correo) => (String(correo || '').indexOf('@') > 0
      ? { ok: true, email: String(correo).toLowerCase(), nombre: 'Persona De Prueba' }
      : { ok: false, error: 'sin sesión' }),
    secIdentidadConBloque_: (correo) => (String(correo || '').indexOf('@') > 0
      ? { ok: true, email: String(correo).toLowerCase(), nombre: 'Quien Publica' }
      : { ok: false, error: 'sin permiso' }),
    secIntentosRevisar_: (clave, max) => ({ bloqueado: (estado.intentos[clave] || 0) >= max }),
    secIntentosSumar_: (clave) => { estado.intentos[clave] = (estado.intentos[clave] || 0) + 1; }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  ['Portal.gs', 'Publicaciones.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(PROY, f), 'utf8'), ctx, { filename: f });
  });
  // `const`/`function` de un contexto de vm no salen como propiedades: se exponen a mano
  // las que estas pruebas necesitan nombrar.
  vm.runInContext(
    'this.pubIdDeFila_ = pubIdDeFila_; this.pubAsegurarIdsAnuncios_ = pubAsegurarIdsAnuncios_;' +
    'this.pubSanearDatos_ = pubSanearDatos_; this.pubVotar = pubVotar; this.pubPorId = pubPorId;' +
    'this.pubResultados = pubResultados; this.pubEncuestaCerrada_ = pubEncuestaCerrada_;' +
    'this.pubContar_ = pubContar_; this.portalNombreResponsable_ = portalNombreResponsable_;' +
    'this.readPortalAnuncios_ = readPortalAnuncios_; this.portalAnunciosCols_ = portalAnunciosCols_;' +
    'this.publicarAnuncio = publicarAnuncio; this.getAnunciosAdmin = getAnunciosAdmin;' +
    'this.PORTAL_ANUNCIOS_HEADERS = PORTAL_ANUNCIOS_HEADERS;',
    ctx, { filename: 'exportar' });
  ctx.__estado = estado;
  return ctx;
}

const HDR = ['ID', 'Formato', 'Activo', 'Orden', 'Desde', 'Hasta', 'Datos (JSON)', 'Autor', 'Responsable', 'Creado'];
const fila = (id, formato, datos, extra) => [
  id, formato, true, (extra && extra.orden) || 0, '', (extra && extra.hasta) || '',
  JSON.stringify(datos), (extra && extra.autor) || '', (extra && extra.responsable) || '', ''
];

/* ══════════════════════════════════════════════════════════════════════════════ */
console.log('\n1. Criterio 2 · Insertar una fila a mano no le cambia el ID a nadie');
{
  const anuncios = hoja('Anuncios', [
    HDR,
    fila('anc-uno', 'tarjeta', { titulo: 'Primera' }),
    ['', 'tarjeta', true, 1, '', '', JSON.stringify({ titulo: 'Escrita a mano' }), '', '', ''],
    fila('anc-tres', 'banner', { mensaje: 'Tercera' }, { orden: 2 })
  ]);
  const ctx = cargar({ Anuncios: anuncios });

  const escribio = ctx.pubAsegurarIdsAnuncios_(anuncios);
  ok('rellena el hueco de la fila sin ID', escribio === true);
  const idNuevo = anuncios._datos[2][0];
  ok('la fila escrita a mano recibe un ID persistente', !!idNuevo && /^anc-/.test(idNuevo), idNuevo);
  eq('y las que ya tenían ID no se tocan', anuncios._datos[1][0], 'anc-uno');
  eq('ni la tercera', anuncios._datos[3][0], 'anc-tres');

  const otraVez = ctx.pubAsegurarIdsAnuncios_(anuncios);
  ok('la segunda pasada no escribe nada (es idempotente)', otraVez === false);
  eq('y el ID asignado sobrevive', anuncios._datos[2][0], idNuevo);

  // Ahora lo que de verdad se está probando: se inserta una fila ARRIBA del todo.
  anuncios._datos.splice(1, 0, fila('anc-cero', 'banner', { mensaje: 'Recién insertada' }));
  ctx.pubAsegurarIdsAnuncios_(anuncios);
  eq('tras insertar una fila arriba, el ID de la de a mano sigue siendo el mismo',
    anuncios._datos[3][0], idNuevo);
  eq('y el de la primera también', anuncios._datos[2][0], 'anc-uno');
}

console.log('\n2. Sin poder escribir en la hoja, el ID sale del CONTENIDO y no de la fila');
{
  const cols = { id: 0, formato: 1, datos: 6, hasta: 5, orden: 3, activo: 2 };
  const ctx = cargar({}, {});
  const f = ['', 'tarjeta', true, 0, '', '', JSON.stringify({ titulo: 'Sin id' }), '', '', ''];
  const idEnFila2 = ctx.pubIdDeFila_('', f, cols, 2);
  const idEnFila9 = ctx.pubIdDeFila_('', f, cols, 9);
  eq('la misma fila en otra posición da el mismo id', idEnFila2, idEnFila9);
  ok('y no es un id posicional', idEnFila2.indexOf('anc-row-') !== 0, idEnFila2);

  const otra = ['', 'tarjeta', true, 0, '', '', JSON.stringify({ titulo: 'Distinta' }), '', '', ''];
  ok('dos publicaciones distintas no comparten id', ctx.pubIdDeFila_('', otra, cols, 2) !== idEnFila2);
  eq('y si la celda ID trae valor, manda ese', ctx.pubIdDeFila_('  anc-x  ', f, cols, 2), 'anc-x');
}

console.log('\n3. El candado: si no se consigue, no se escribe (y no se rompe la lectura)');
{
  const anuncios = hoja('Anuncios', [
    HDR,
    ['', 'tarjeta', true, 0, '', '', JSON.stringify({ titulo: 'Sin id' }), '', '', '']
  ]);
  const ctx = cargar({ Anuncios: anuncios }, { lockDisponible: false });
  const escribio = ctx.pubAsegurarIdsAnuncios_(anuncios);
  ok('no escribe sin candado', escribio === false);
  eq('la celda sigue vacía', anuncios._datos[1][0], '');
  const lista = ctx.readPortalAnuncios_(libro({ Anuncios: anuncios }));
  eq('y la lectura del Portal devuelve la publicación igual', lista.length, 1);
  ok('con un id derivado del contenido', /^anc-h/.test(lista[0].id), lista[0].id);
}

console.log('\n4. Responsable: nombre legible, nunca el correo');
{
  const ctx = cargar({});
  eq('manda el nombre guardado', ctx.portalNombreResponsable_('Ana Ruiz', 'ana.ruiz@x.com'), 'Ana Ruiz');
  eq('sin nombre, se compone del correo', ctx.portalNombreResponsable_('', 'maria.lopez@x.com'), 'Maria Lopez');
  eq('con guiones bajos también', ctx.portalNombreResponsable_('', 'juan_perez@x.com'), 'Juan Perez');
  eq('sin nada, cadena vacía', ctx.portalNombreResponsable_('', ''), '');

  const anuncios = hoja('Anuncios', [
    HDR, fila('anc-r', 'tarjeta', { titulo: 'Con autor' }, { autor: 'ana.ruiz@x.com', responsable: 'Ana Ruiz' })
  ]);
  const ctx2 = cargar({ Anuncios: anuncios });
  const lista = ctx2.readPortalAnuncios_(libro({ Anuncios: anuncios }));
  eq('la lectura pública trae el nombre', lista[0].responsable, 'Ana Ruiz');
  ok('y NO trae el correo', !('autor' in lista[0]), JSON.stringify(lista[0]));
}

console.log('\n5. Publicar: la autoría se fija al crear y no se pisa al editar');
{
  const anuncios = hoja('Anuncios', [HDR]);
  const ctx = cargar({ Anuncios: anuncios });
  const r1 = ctx.publicarAnuncio({
    formato: 'tarjeta', activo: true, orden: 0, datos: { titulo: 'Mía' }, asesor: 'quien@publica.com'
  });
  eq('se crea', r1.status, 'ok');
  const c = ctx.portalAnunciosCols_(HDR);
  const creado = anuncios._datos[1][c.creado];
  eq('guarda el correo en Autor', anuncios._datos[1][c.autor], 'quien@publica.com');
  eq('y el nombre legible en Responsable', anuncios._datos[1][c.responsable], 'Quien Publica');
  ok('con fecha de creación', creado instanceof Date);

  const r2 = ctx.publicarAnuncio({
    id: r1.id, formato: 'tarjeta', activo: true, orden: 0,
    datos: { titulo: 'Corregida por otra persona' }, asesor: 'otra@persona.com'
  });
  eq('se actualiza', r2.status, 'ok');
  eq('el autor NO cambia al editar', anuncios._datos[1][c.autor], 'quien@publica.com');
  eq('el responsable tampoco', anuncios._datos[1][c.responsable], 'Quien Publica');
  eq('y la fecha de creación se conserva', anuncios._datos[1][c.creado], creado);
  eq('sigue habiendo una sola fila', anuncios._datos.length, 2);
}

console.log('\n5 bis. Lo que se publica ahora va PRIMERO');
{
  const anuncios = hoja('Anuncios', [HDR]);
  const ctx = cargar({ Anuncios: anuncios });
  const c = ctx.portalAnunciosCols_(HDR);

  const a = ctx.publicarAnuncio({ formato: 'tarjeta', activo: true, datos: { titulo: 'La primera' }, asesor: 'quien@publica.com' });
  eq('la primera publicación nace en 0', Number(anuncios._datos[1][c.orden]), 0);

  const b = ctx.publicarAnuncio({ formato: 'tarjeta', activo: true, datos: { titulo: 'La segunda' }, asesor: 'quien@publica.com' });
  ok('la segunda nace por DELANTE de la primera',
    Number(anuncios._datos[2][c.orden]) < Number(anuncios._datos[1][c.orden]),
    anuncios._datos[2][c.orden] + ' vs ' + anuncios._datos[1][c.orden]);

  ctx.publicarAnuncio({ formato: 'banner', activo: true, datos: { mensaje: 'La tercera' }, asesor: 'quien@publica.com' });
  const lista = ctx.readPortalAnuncios_(libro({ Anuncios: anuncios }));
  eq('el Portal las pinta de la más nueva a la más vieja',
    lista.map((x) => x.titulo || x.mensaje).join(' > '), 'La tercera > La segunda > La primera');

  // Quien escribe un orden concreto manda: eso no se toca.
  ctx.publicarAnuncio({ formato: 'tarjeta', activo: true, orden: 99, datos: { titulo: 'Al final a mano' }, asesor: 'quien@publica.com' });
  const lista2 = ctx.readPortalAnuncios_(libro({ Anuncios: anuncios }));
  eq('un orden escrito a mano se respeta', lista2[lista2.length - 1].titulo, 'Al final a mano');

  // Y EDITAR no mueve de sitio: sería una sorpresa desagradable al corregir una errata.
  const ordenAntes = Number(anuncios._datos[1][c.orden]);
  ctx.publicarAnuncio({ id: a.id, formato: 'tarjeta', activo: true, datos: { titulo: 'La primera (corregida)' }, asesor: 'quien@publica.com' });
  eq('editar no cambia el orden', Number(anuncios._datos[1][c.orden]), ordenAntes);
}

console.log('\n6. Saneo del servidor sobre la encuesta que llega del navegador');
{
  const ctx = cargar({});
  const muchas = ctx.pubSanearDatos_({
    titulo: 'x',
    encuesta: { pregunta: '¿Cuál?', opciones: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }
  });
  eq('recorta a seis opciones', muchas.encuesta.opciones.length, 6);
  eq('y conserva el resto del contenido', muchas.titulo, 'x');

  eq('una encuesta sin pregunta se descarta',
    ctx.pubSanearDatos_({ encuesta: { pregunta: '', opciones: ['a', 'b'] } }).encuesta, undefined);
  eq('una con una sola opción también',
    ctx.pubSanearDatos_({ encuesta: { pregunta: '¿?', opciones: ['solo una'] } }).encuesta, undefined);
  eq('las opciones vacías no cuentan',
    ctx.pubSanearDatos_({ encuesta: { pregunta: '¿?', opciones: ['a', '   ', ''] } }).encuesta, undefined);

  const fechaMala = ctx.pubSanearDatos_({
    encuesta: { pregunta: '¿?', opciones: ['a', 'b'], cierre: 'el jueves' }
  });
  eq('una fecha de cierre que no es fecha se descarta', fechaMala.encuesta.cierre, '');

  const veneno = ctx.pubSanearDatos_(JSON.parse('{"__proto__":{"colado":1},"titulo":"ok"}'));
  eq('la clave __proto__ no se copia', ({}).colado, undefined);
  eq('y el resto pasa', veneno.titulo, 'ok');
}

console.log('\n7. Criterio 3 · Votar: dos personas a la vez, y nadie dos veces');
{
  const encuesta = { titulo: 'Capacitación', encuesta: { pregunta: '¿Cuándo?', opciones: ['Mañana', 'Tarde'] } };
  const anuncios = hoja('Anuncios', [HDR, fila('anc-enc', 'tarjeta', encuesta)]);
  const votos = hoja('Votos', [['Fecha', 'Publicación', 'Correo', 'Opción']]);
  const ctx = cargar({ Anuncios: anuncios, Votos: votos });

  const v1 = ctx.pubVotar({ id: 'anc-enc', opcion: 'Mañana', asesor: 'ana@x.com' });
  eq('el primer voto entra', v1.status, 'ok');
  const v2 = ctx.pubVotar({ id: 'anc-enc', opcion: 'Tarde', asesor: 'luis@x.com' });
  eq('el segundo también', v2.status, 'ok');
  eq('y ninguno pisó al otro: dos filas', votos._datos.length, 3);
  eq('el recuento los ve a los dos', v2.total, 2);
  eq('una para Mañana', v2.conteo['Mañana'], 1);
  eq('otra para Tarde', v2.conteo['Tarde'], 1);
  ok('los dos votos pasaron por el candado', ctx.__estado.lockTomado >= 2, String(ctx.__estado.lockTomado));

  const v3 = ctx.pubVotar({ id: 'anc-enc', opcion: 'Tarde', asesor: 'ana@x.com' });
  eq('cambiar de opinión no añade fila', votos._datos.length, 3);
  eq('el total sigue siendo dos', v3.total, 2);
  eq('y ahora Tarde tiene dos', v3.conteo['Tarde'], 2);
  eq('Mañana se queda sin votos', v3.conteo['Mañana'], undefined);
  eq('el voto propio que se devuelve es el nuevo', v3.miVoto, 'Tarde');

  const inventada = ctx.pubVotar({ id: 'anc-enc', opcion: 'A media noche', asesor: 'ana@x.com' });
  eq('una opción que no está en la encuesta se rechaza', inventada.status, 'error');
  eq('y no se escribió nada', votos._datos.length, 3);

  const sinSesion = ctx.pubVotar({ id: 'anc-enc', opcion: 'Tarde', asesor: '' });
  eq('sin identidad no se puede votar', sinSesion.status, 'error');

  const noEncuesta = ctx.pubVotar({ id: 'anc-enc-noexiste', opcion: 'Tarde', asesor: 'ana@x.com' });
  eq('votar en algo que no existe se rechaza', noEncuesta.status, 'error');
}

console.log('\n8. Criterio 3 · Editar el anuncio después NO borra los votos');
{
  const encuesta = { titulo: 'Capacitación', encuesta: { pregunta: '¿Cuándo?', opciones: ['Mañana', 'Tarde'] } };
  const anuncios = hoja('Anuncios', [HDR, fila('anc-enc', 'tarjeta', encuesta, { autor: 'quien@publica.com' })]);
  const votos = hoja('Votos', [['Fecha', 'Publicación', 'Correo', 'Opción']]);
  const ctx = cargar({ Anuncios: anuncios, Votos: votos });

  ctx.pubVotar({ id: 'anc-enc', opcion: 'Mañana', asesor: 'ana@x.com' });
  ctx.pubVotar({ id: 'anc-enc', opcion: 'Mañana', asesor: 'luis@x.com' });
  eq('hay dos votos', ctx.pubContar_('anc-enc').total, 2);

  const r = ctx.publicarAnuncio({
    id: 'anc-enc', formato: 'tarjeta', activo: true, orden: 0,
    datos: { titulo: 'Capacitación (corregido)', encuesta: encuesta.encuesta },
    asesor: 'quien@publica.com'
  });
  eq('la edición se guarda', r.status, 'ok');
  eq('los votos siguen ahí', ctx.pubContar_('anc-enc').total, 2);
  eq('y el texto sí cambió',
    JSON.parse(anuncios._datos[1][ctx.portalAnunciosCols_(HDR).datos]).titulo, 'Capacitación (corregido)');
}

console.log('\n9. Encuesta cerrada: por fecha propia o porque la publicación expiró');
{
  const ctx = cargar({});
  const ayer = new Date(Date.now() - 86400000);
  const manana = new Date(Date.now() + 86400000);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  ok('sin fecha de cierre, abierta', ctx.pubEncuestaCerrada_({ cierre: '' }, { estado: 'activo' }) === false);
  ok('con cierre futuro, abierta', ctx.pubEncuestaCerrada_({ cierre: iso(manana) }, { estado: 'activo' }) === false);
  ok('con cierre pasado, cerrada', ctx.pubEncuestaCerrada_({ cierre: iso(ayer) }, { estado: 'activo' }) === true);
  ok('si la publicación expiró, cerrada aunque el cierre sea futuro',
    ctx.pubEncuestaCerrada_({ cierre: iso(manana) }, { estado: 'expirado' }) === true);

  // Y de punta a punta: no se puede votar en una cerrada.
  const enc = { titulo: 'Vieja', encuesta: { pregunta: '¿?', opciones: ['a', 'b'], cierre: iso(ayer) } };
  const anuncios = hoja('Anuncios', [HDR, fila('anc-vieja', 'tarjeta', enc)]);
  const ctx2 = cargar({ Anuncios: anuncios, Votos: hoja('Votos', [['Fecha', 'Publicación', 'Correo', 'Opción']]) });
  eq('votar en una encuesta cerrada se rechaza',
    ctx2.pubVotar({ id: 'anc-vieja', opcion: 'a', asesor: 'ana@x.com' }).status, 'error');
}

console.log('\n10. T7.3 · pubPorId sirve las expiradas (diciéndolo) y nunca las ocultas');
{
  const ayer = new Date(Date.now() - 3 * 86400000);
  const manana = new Date(Date.now() + 3 * 86400000);
  const anuncios = hoja('Anuncios', [
    HDR,
    ['anc-viva',  'tarjeta', true,  0, '', '', JSON.stringify({ titulo: 'Viva' }), '', 'Ana Ruiz', ''],
    ['anc-vieja', 'tarjeta', true,  1, '', ayer, JSON.stringify({ titulo: 'Vieja' }), '', '', ''],
    ['anc-prog',  'tarjeta', true,  2, manana, '', JSON.stringify({ titulo: 'Programada' }), '', '', ''],
    ['anc-off',   'tarjeta', false, 3, '', '', JSON.stringify({ titulo: 'Oculta' }), '', '', '']
  ]);
  const ctx = cargar({ Anuncios: anuncios });

  const viva = ctx.pubPorId('anc-viva', '');
  eq('la vigente se sirve', viva.status, 'ok');
  eq('con su estado', viva.pub.estado, 'activo');
  eq('y su responsable', viva.pub.responsable, 'Ana Ruiz');

  const vieja = ctx.pubPorId('anc-vieja', '');
  eq('la expirada TAMBIÉN se sirve', vieja.status, 'ok');
  eq('marcada como expirada', vieja.pub.estado, 'expirado');
  ok('con la fecha en que expiró', !!vieja.pub.hasta, JSON.stringify(vieja.pub));

  eq('la programada se sirve y lo dice', ctx.pubPorId('anc-prog', '').pub.estado, 'programado');

  const oculta = ctx.pubPorId('anc-off', '');
  eq('la oculta NO se sirve', oculta.status, 'error');
  eq('y se distingue de "no existe"', oculta.estado, 'inactivo');
  eq('lo que no existe se dice como tal', ctx.pubPorId('anc-fantasma', '').estado, 'inexistente');

  // La lectura del Portal, mientras tanto, solo enseña la viva.
  const lista = ctx.readPortalAnuncios_(libro({ Anuncios: anuncios }));
  eq('el Portal solo pinta la vigente', lista.length, 1);
  eq('y es la que toca', lista[0].id, 'anc-viva');
}

console.log('\n11. Resultados: caché corta, y el voto propio es de cada quien');
{
  const enc = { titulo: 'E', encuesta: { pregunta: '¿?', opciones: ['a', 'b'] } };
  const anuncios = hoja('Anuncios', [HDR, fila('anc-e', 'tarjeta', enc)]);
  const votos = hoja('Votos', [['Fecha', 'Publicación', 'Correo', 'Opción']]);
  const ctx = cargar({ Anuncios: anuncios, Votos: votos });

  ctx.pubVotar({ id: 'anc-e', opcion: 'a', asesor: 'ana@x.com' });
  const rAna = ctx.pubResultados('anc-e', 'ana@x.com');
  eq('ana ve su voto', rAna.miVoto, 'a');
  const rLuis = ctx.pubResultados('anc-e', 'luis@x.com');
  eq('luis ve el total', rLuis.total, 1);
  eq('pero no tiene voto propio', rLuis.miVoto, '');
  ok('la respuesta NO incluye quién votó qué',
    !('porCorreo' in rLuis) && !('correos' in rLuis), JSON.stringify(rLuis));

  ok('la segunda lectura sale de la caché', 'pubVotos_anc-e' in ctx.__estado.cache);
  ctx.pubVotar({ id: 'anc-e', opcion: 'b', asesor: 'luis@x.com' });
  ok('y votar la tira', !('pubVotos_anc-e' in ctx.__estado.cache));
  eq('así que el siguiente recuento está al día', ctx.pubResultados('anc-e', 'luis@x.com').total, 2);
}

console.log('\n12. Contrato de las tres listas espejo: `pub` está en las tres');
{
  const code = fs.readFileSync(path.join(PROY, 'Code.gs'), 'utf8');
  const core = fs.readFileSync(path.join(PROY, 'app_core.html'), 'utf8');
  const index = fs.readFileSync(path.join(PROY, 'Index.html'), 'utf8');

  const listaDe = (src, re) => {
    const m = src.match(re);
    return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;
  };
  const enCode = listaDe(code, /const PARAMS_VISTA = \[([^\]]*)\]/);
  const enCore = listaDe(core, /const PARAMS_VISTA = \[([^\]]*)\]/);
  const enPasan = listaDe(index, /const PASAN = \[([^\]]*)\]/);

  ok('Code.gs declara `pub`', enCode && enCode.indexOf('pub') > -1, JSON.stringify(enCode));
  ok('app_core.html declara `pub`', enCore && enCore.indexOf('pub') > -1, JSON.stringify(enCore));
  ok('la lista PASAN de Index declara `pub`', enPasan && enPasan.indexOf('pub') > -1, JSON.stringify(enPasan));
  // PASAN es un subconjunto: no lleva `next` ni `format`, que no son destino sino cómo
  // se llegó. Lo que se comprueba es que no tenga nada que Code.gs no conozca.
  const sobran = (enPasan || []).filter((k) => enCode.indexOf(k) === -1);
  ok('y PASAN no inventa parámetros que el servidor no inyecta', sobran.length === 0, sobran.join(','));
}

console.log('\n13. La hoja se prepara sola: cabeceras nuevas sin tocar la de cálculo a mano');
{
  // Una hoja "de antes": sin Desde, sin Responsable y sin Creado.
  const vieja = hoja('Anuncios', [
    ['ID', 'Formato', 'Activo', 'Orden', 'Hasta', 'Datos (JSON)', 'Autor'],
    ['anc-1', 'banner', true, 0, '', JSON.stringify({ mensaje: 'Hola' }), 'quien@publica.com']
  ]);
  const ctx = cargar({ Anuncios: vieja });
  const r = ctx.publicarAnuncio({
    formato: 'banner', activo: true, orden: 1, datos: { mensaje: 'Nuevo' }, asesor: 'quien@publica.com'
  });
  ok('publicar sobre una hoja vieja funciona', r.status === 'ok', r.error);
  const hdr = vieja._datos[0].map((h) => String(h).toLowerCase());
  ok('se añadió la columna Desde', hdr.some((h) => h.indexOf('desde') > -1), hdr.join('|'));
  ok('y la columna Responsable', hdr.some((h) => h.indexOf('responsable') > -1), hdr.join('|'));
  ok('y la columna Creado', hdr.some((h) => h.indexOf('creado') > -1), hdr.join('|'));
  eq('sin duplicar Autor, que ya estaba',
    hdr.filter((h) => h.indexOf('autor') > -1).length, 1);
  eq('la publicación vieja sigue en su fila', vieja._datos[1][0], 'anc-1');

  // Y una segunda publicación no vuelve a añadir columnas.
  const anchoTras = vieja._datos[0].length;
  ctx.publicarAnuncio({ formato: 'banner', activo: true, orden: 2, datos: { mensaje: 'Otro' }, asesor: 'quien@publica.com' });
  eq('la siguiente publicación no añade más columnas', vieja._datos[0].length, anchoTras);
}

console.log('\n─────────────────────────────────────────────');
console.log(fallos === 0 ? `TODO OK · ${pruebas} comprobaciones` : `${fallos} FALLOS de ${pruebas}`);
process.exit(fallos === 0 ? 0 : 1);
