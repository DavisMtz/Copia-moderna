/**
 * =================================================================================================
 * TRAZABILIDAD — Homologación de Procesos 2026 | Portal Ventel
 * =================================================================================================
 * Los procesos de trazabilidad (Big Ticket, Soft Line, SL Mensajerías, MarketPlace, Tienda y
 * Generales) vivían escritos a mano dentro de Index.html: ~1.800 líneas de HTML que había que
 * editar —y volver a desplegar— cada vez que Operaciones cambiaba un tiempo o una observación.
 * Este archivo mueve esa verdad a la hoja de cálculo de Homologación: el Portal ya sólo pinta.
 *
 * Cómo lee la hoja (y por qué así):
 *
 *   1. NO se asume una posición fija de columnas. Cada hoja de la homologación tiene su propio
 *      número de columnas vacías a la izquierda y BT añade una columna extra ("Tiempo avance")
 *      que las demás no tienen. Por eso se busca la fila de encabezados y se mapean las columnas
 *      por su TEXTO ("Tiempo p/reporte", "Plataformas", "Observaciones"…).
 *   2. El nombre del proceso está en la columna inmediatamente anterior a "Tiempo p/reporte":
 *      el encabezado "Proceso" está combinado sobre varias columnas, así que su índice no sirve
 *      para leer los datos. Esa relación sí es constante en las seis hojas.
 *   3. El número que se muestra es la POSICIÓN de la fila, no el número escrito en la hoja: en la
 *      hoja hay números repetidos y filas sin número, y los anclajes (bt-1, sl-4, mkp-12…) tienen
 *      que ser únicos y estables porque el buscador global enlaza a ellos.
 *
 * Todo el texto se entrega en crudo: el formateo "inteligente" (viñetas, notas, citas, desglose
 * de reembolsos) ocurre en el cliente, donde es más fácil de iterar y no cuesta cuota.
 *
 * Funciones expuestas al cliente:
 *   fetchTrazabilidadData()  → Index.html (las seis secciones de Trazabilidad)
 *
 * Utilidades para ejecutar a mano desde el editor:
 *   trazInvalidarCache()     → fuerza relectura inmediata tras editar la hoja
 *   trazDiagnostico()        → comprueba que cada hoja se lee y con qué columnas
 */

// ── HOJA DE HOMOLOGACIÓN ──────────────────────────────────────────────────────

// Respaldo en código; lo que manda es la propiedad de script 'TRAZ_SHEET_ID'
// (mismo criterio que PORTAL_SHEET_ID, ver secConfig_ en Seguridad.gs).
var TRAZ_SHEET_ID = '1EGCG2OaBAPOYPhUdAjIFj3OrDUYoQmIL7S81qEc8tzo';

function trazSheetId_() {
  return secConfig_('TRAZ_SHEET_ID', TRAZ_SHEET_ID);
}

/**
 * Las seis secciones del Portal y las hojas que las alimentan.
 *
 *   id        → id de la <section> en Index.html (no cambiar: el menú y el buscador dependen de él)
 *   prefijo   → prefijo de los anclajes (bt-1, sl-4…). No cambiar: hay enlaces guardados.
 *   hojas     → nombres aceptados de la pestaña, en orden de preferencia. Se comparan sin
 *               acentos, sin mayúsculas y sin espacios de sobra, así que " SL logistica interna"
 *               (con el espacio inicial que trae la hoja real) entra sin problema.
 */
var TRAZ_SECCIONES = [
  { id: 'bigticket',    prefijo: 'bt',  label: 'Big Ticket',      etiqueta: 'BT',
    hojas: ['BT', 'Big Ticket', 'BigTicket'] },
  { id: 'softline',     prefijo: 'sl',  label: 'Soft Line',       etiqueta: 'SF',
    hojas: ['SL logistica interna', 'SL logística interna', 'SoftLine', 'Soft Line'] },
  { id: 'slmensajerias', prefijo: 'slm', label: 'SL Mensajerías', etiqueta: 'SF',
    hojas: ['SL Mensajerias', 'SL Mensajerías', 'Mensajerias', 'Mensajerías'] },
  { id: 'mkp',          prefijo: 'mkp', label: 'MarketPlace',     etiqueta: 'MKP',
    hojas: ['MKP', 'MarketPlace', 'Marketplace'] },
  { id: 'tienda',       prefijo: 'tda', label: 'Tienda Física',   etiqueta: 'TDA',
    hojas: ['Tienda', 'Tienda Fisica', 'Tienda Física'] },
  { id: 'generales',    prefijo: 'gen', label: 'Generales',       etiqueta: 'GEN',
    hojas: ['Generales', 'General'] }
];

// ── CACHÉ ─────────────────────────────────────────────────────────────────────
// Caché propia (no la de cotizaciones ni la del Portal) para que invalidar una no
// invalide las otras. El payload completo ronda los 60 KB, por encima de lo que
// conviene meter en una sola llave, así que se guarda troceado.

var TRAZ_CACHE_CLAVE = 'trazData_v1';
var TRAZ_CACHE_TTL   = 900;    // 15 min: la hoja se edita pocas veces al día
var TRAZ_CACHE_TROZO = 90000;  // < 100 KB por valor (límite de CacheService)
var TRAZ_CACHE_MAX   = 12;

function trazCacheGet_() {
  try {
    const cache = CacheService.getScriptCache();
    const cabeza = cache.get(TRAZ_CACHE_CLAVE);
    if (!cabeza) return null;
    if (cabeza.indexOf('trozos:') !== 0) return JSON.parse(cabeza);

    const total = parseInt(cabeza.substring(7), 10);
    const claves = [];
    for (let i = 0; i < total; i++) claves.push(TRAZ_CACHE_CLAVE + '#' + i);
    const partes = cache.getAll(claves);
    let json = '';
    for (let i = 0; i < total; i++) {
      const parte = partes[claves[i]];
      if (parte == null) return null;   // un trozo caducó: la entrada completa se descarta
      json += parte;
    }
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function trazCachePut_(objeto) {
  try {
    const json = JSON.stringify(objeto);
    const cache = CacheService.getScriptCache();

    if (json.length <= TRAZ_CACHE_TROZO) {
      cache.put(TRAZ_CACHE_CLAVE, json, TRAZ_CACHE_TTL);
      return;
    }
    const mapa = {};
    let cursor = 0, indice = 0;
    while (cursor < json.length) {
      if (indice >= TRAZ_CACHE_MAX) return;   // demasiado grande: se sirve sin caché
      let fin = Math.min(cursor + TRAZ_CACHE_TROZO, json.length);
      // No partir un par suplente (los textos traen "⦁", "•" y acentos).
      if (fin < json.length) {
        const code = json.charCodeAt(fin - 1);
        if (code >= 0xD800 && code <= 0xDBFF) fin--;
      }
      mapa[TRAZ_CACHE_CLAVE + '#' + indice] = json.substring(cursor, fin);
      cursor = fin;
      indice++;
    }
    mapa[TRAZ_CACHE_CLAVE] = 'trozos:' + indice;
    cache.putAll(mapa, TRAZ_CACHE_TTL);
  } catch (e) {
    // Cuota, tamaño o servicio caído: no es fatal, simplemente se relee la hoja.
    Logger.log('trazCachePut_: ' + e.message);
  }
}

/** Ejecutar a mano tras editar la hoja para que el cambio se vea sin esperar el TTL. */
function trazInvalidarCache() {
  try {
    const claves = [TRAZ_CACHE_CLAVE];
    for (let i = 0; i < TRAZ_CACHE_MAX; i++) claves.push(TRAZ_CACHE_CLAVE + '#' + i);
    CacheService.getScriptCache().removeAll(claves);
    Logger.log('Caché de Trazabilidad invalidada ✔');
    return true;
  } catch (e) {
    Logger.log('No se pudo invalidar: ' + e.message);
    return false;
  }
}

// ── API PARA EL CLIENTE ───────────────────────────────────────────────────────

/**
 * Datos de las seis secciones de Trazabilidad.
 * Nunca lanza: si la hoja falla devuelve status 'error' y el cliente sigue mostrando
 * su última copia buena (guardada en localStorage).
 */
function fetchTrazabilidadData() {
  const cached = trazCacheGet_();
  if (cached) return cached;
  const data = trazConstruir_();
  if (data.status === 'ok') trazCachePut_(data);
  return data;
}

function trazConstruir_() {
  const salida = {
    status: 'ok',
    error: null,
    generado: new Date().toISOString(),
    hojaId: trazSheetId_(),
    secciones: [],
    avisos: []
  };

  let ss;
  try {
    ss = SpreadsheetApp.openById(trazSheetId_());
  } catch (e) {
    salida.status = 'error';
    salida.error = 'No se pudo abrir la hoja de Homologación de Procesos: ' + e.message;
    return salida;
  }

  // Índice de pestañas normalizadas → hoja, para tolerar acentos y espacios sobrantes.
  const hojas = ss.getSheets();
  const indice = hojas.map(function (h) {
    return { norm: trazNorm_(h.getName()), nombre: h.getName(), hoja: h };
  });

  TRAZ_SECCIONES.forEach(function (cfg) {
    const encontrada = trazBuscarHoja_(indice, cfg.hojas);
    if (!encontrada) {
      salida.avisos.push('No se encontró la pestaña de "' + cfg.label + '" (se buscó: ' +
                         cfg.hojas.join(', ') + ').');
      salida.secciones.push({
        id: cfg.id, prefijo: cfg.prefijo, label: cfg.label, etiqueta: cfg.etiqueta,
        hoja: null, tieneAvance: false, procesos: []
      });
      return;
    }

    let procesos = [];
    try {
      procesos = trazLeerHoja_(encontrada.hoja, cfg.prefijo);
    } catch (e) {
      Logger.log('trazLeerHoja_ (' + encontrada.nombre + '): ' + e);
      salida.avisos.push('No pudimos leer los procesos de "' + encontrada.nombre + '".');
    }
    if (!procesos.length) {
      salida.avisos.push('Todavía no hay procesos publicados en "' + encontrada.nombre + '".');
    }

    salida.secciones.push({
      id: cfg.id,
      prefijo: cfg.prefijo,
      label: cfg.label,
      etiqueta: cfg.etiqueta,
      hoja: encontrada.nombre,
      // Sólo BT usa la columna intermedia; si ningún proceso la tiene con dato, no se pinta.
      tieneAvance: procesos.some(function (p) { return !!p.avance && !trazEsVacio_(p.avance); }),
      procesos: procesos
    });
  });

  const total = salida.secciones.reduce(function (n, s) { return n + s.procesos.length; }, 0);
  if (!total) {
    salida.status = 'error';
    salida.error = 'La hoja se abrió pero no se pudo interpretar ninguna pestaña. ' +
                   'Ejecuta trazDiagnostico() para ver qué encabezados encontró.';
  }
  return salida;
}

/** Busca la pestaña por nombre exacto normalizado y, si no, por coincidencia parcial. */
function trazBuscarHoja_(indice, alias) {
  for (let a = 0; a < alias.length; a++) {
    const objetivo = trazNorm_(alias[a]);
    for (let i = 0; i < indice.length; i++) {
      if (indice[i].norm === objetivo) return indice[i];
    }
  }
  for (let a = 0; a < alias.length; a++) {
    const objetivo = trazNorm_(alias[a]);
    if (objetivo.length < 3) continue;
    for (let i = 0; i < indice.length; i++) {
      if (indice[i].norm.indexOf(objetivo) > -1 || objetivo.indexOf(indice[i].norm) > -1) return indice[i];
    }
  }
  return null;
}

// ── LECTURA DE UNA PESTAÑA ────────────────────────────────────────────────────

function trazLeerHoja_(hoja, prefijo) {
  const filas = hoja.getDataRange().getValues();   // una sola lectura de rango
  if (!filas.length) return [];

  // La fila de encabezados no siempre es la misma (hay filas de título y filas en blanco).
  let cols = null, inicio = -1;
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const c = trazMapearColumnas_(filas[i]);
    if (c) { cols = c; inicio = i + 1; break; }
  }
  if (!cols) return [];

  const procesos = [];
  for (let i = inicio; i < filas.length; i++) {
    const fila = filas[i];

    let nombre = trazTexto_(fila[cols.nombre]);
    // Red de seguridad si algún día el nombre deja de ir pegado a "Tiempo p/reporte".
    if (!nombre && cols.proceso > -1) nombre = trazTexto_(fila[cols.proceso]);
    if (!nombre) continue;

    const nn = trazNorm_(nombre);
    if (nn === 'proceso' || nn.indexOf('tiempo p') === 0) continue;   // encabezado repetido

    const num = String(procesos.length + 1);
    procesos.push({
      id: prefijo + '-' + num,
      num: num,
      // Número tal cual está escrito en la hoja: sólo informativo, no se usa para anclar.
      numHoja: cols.num > -1 ? trazTexto_(fila[cols.num]) : '',
      nombre: nombre,
      reporte: cols.reporte > -1 ? trazTexto_(fila[cols.reporte]) : '',
      avance: cols.avance > -1 ? trazTexto_(fila[cols.avance]) : '',
      solucion: cols.solucion > -1 ? trazTexto_(fila[cols.solucion]) : '',
      plataformas: cols.plataformas > -1 ? trazTexto_(fila[cols.plataformas]) : '',
      observaciones: cols.obs > -1 ? trazTexto_(fila[cols.obs]) : ''
    });
  }
  return procesos;
}

/**
 * Mapea una fila candidata a encabezados. Devuelve null si no lo es.
 * "Tiempo p/reporte" es la columna ancla: el nombre del proceso va justo a su izquierda
 * y el número del proceso una más a la izquierda (ver cabecera del archivo).
 */
function trazMapearColumnas_(fila) {
  const c = { num: -1, nombre: -1, proceso: -1, reporte: -1, avance: -1,
              solucion: -1, plataformas: -1, obs: -1 };

  for (let i = 0; i < fila.length; i++) {
    const t = trazNorm_(fila[i]);
    if (!t) continue;
    if (c.proceso     < 0 && t === 'proceso')                          c.proceso = i;
    if (c.reporte     < 0 && /tiempo.*reporte/.test(t))                c.reporte = i;
    if (c.avance      < 0 && /tiempo.*avance/.test(t))                 c.avance = i;
    if (c.solucion    < 0 && /tiempo.*soluci/.test(t))                 c.solucion = i;
    if (c.plataformas < 0 && t.indexOf('plataforma') > -1)             c.plataformas = i;
    if (c.obs         < 0 && t.indexOf('observacion') > -1)            c.obs = i;
  }

  if (c.reporte < 1 || c.solucion < 0) return null;   // no es la fila de encabezados
  c.nombre = c.reporte - 1;
  c.num = c.reporte - 2;
  return c;
}

// ── UTILIDADES DE TEXTO ───────────────────────────────────────────────────────

/** minúsculas, sin acentos y con los espacios colapsados: para comparar nombres y encabezados. */
var TRAZ_DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

function trazNorm_(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(TRAZ_DIACRITICOS, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Valor de celda listo para mostrar.
 * Limpia tres cosas que trae la hoja de origen y que se ven mal en el Portal:
 *   · números que llegan como 11.0 cuando en realidad son "11";
 *   · comillas dobles duplicadas ("" y """") heredadas del CSV original;
 *   · saltos de línea de Windows y bloques de líneas en blanco de más.
 */
function trazTexto_(v) {
  if (v == null) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  if (typeof v === 'number') return String(v);

  let s = String(v).replace(/\r\n?/g, '\n');
  // "11.0" escrito como texto en la hoja se muestra como "11".
  if (/^\d+\.0+$/.test(s.trim())) return String(parseInt(s, 10));
  s = s.replace(/"{2,}/g, '"');
  // Comilla suelta al principio o al final (el CSV original abrió comillas y no las cerró).
  if ((s.match(/"/g) || []).length % 2 === 1) s = s.replace(/^"\s*/, '').replace(/\s*"$/, '');
  s = s.split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

/** "N/A", "-", "---" y similares cuentan como celda sin dato. */
function trazEsVacio_(s) {
  const t = trazNorm_(s).replace(/[^a-z0-9]/g, '');
  return !t || t === 'na' || t === 'naaplica' || t === 'noaplica';
}

// ── DIAGNÓSTICO (ejecutar a mano desde el editor) ─────────────────────────────

/**
 * Comprueba, pestaña por pestaña, qué encabezados encontró y cuántos procesos leyó.
 * Es lo primero que hay que mirar si una sección del Portal aparece vacía.
 */
function trazDiagnostico() {
  const id = trazSheetId_();
  Logger.log('Hoja: %s', id);

  let ss;
  try {
    ss = SpreadsheetApp.openById(id);
  } catch (e) {
    Logger.log('✖ No se pudo abrir la hoja: %s', e.message);
    return { ok: false, error: e.message };
  }

  Logger.log('Pestañas encontradas: %s',
    ss.getSheets().map(function (h) { return '"' + h.getName() + '"'; }).join(', '));

  const indice = ss.getSheets().map(function (h) {
    return { norm: trazNorm_(h.getName()), nombre: h.getName(), hoja: h };
  });

  const resumen = [];
  TRAZ_SECCIONES.forEach(function (cfg) {
    const enc = trazBuscarHoja_(indice, cfg.hojas);
    if (!enc) {
      Logger.log('✖ %s → sin pestaña (se buscó: %s)', cfg.label, cfg.hojas.join(' / '));
      resumen.push({ seccion: cfg.label, hoja: null, procesos: 0 });
      return;
    }
    const filas = enc.hoja.getDataRange().getValues();
    let cols = null, filaHdr = -1;
    for (let i = 0; i < Math.min(filas.length, 15); i++) {
      const c = trazMapearColumnas_(filas[i]);
      if (c) { cols = c; filaHdr = i + 1; break; }
    }
    if (!cols) {
      Logger.log('✖ %s → "%s": no se encontró la fila de encabezados (falta "Tiempo p/reporte").',
                 cfg.label, enc.nombre);
      resumen.push({ seccion: cfg.label, hoja: enc.nombre, procesos: 0 });
      return;
    }
    const procesos = trazLeerHoja_(enc.hoja, cfg.prefijo);
    Logger.log('✔ %s → "%s" | encabezados en fila %s | columnas: nombre=%s reporte=%s avance=%s ' +
               'solucion=%s plataformas=%s obs=%s | %s procesos',
               cfg.label, enc.nombre, filaHdr, cols.nombre, cols.reporte, cols.avance,
               cols.solucion, cols.plataformas, cols.obs, procesos.length);
    if (procesos.length) Logger.log('    1º: %s · último: %s',
                                    procesos[0].nombre, procesos[procesos.length - 1].nombre);
    resumen.push({ seccion: cfg.label, hoja: enc.nombre, procesos: procesos.length });
  });

  const data = trazConstruir_();
  Logger.log('Tamaño del payload: %s KB', Math.round(JSON.stringify(data).length / 1024));
  if (data.avisos.length) Logger.log('Avisos: %s', data.avisos.join(' | '));
  return { ok: data.status === 'ok', resumen: resumen, avisos: data.avisos };
}
