/**
 * =================================================================================================
 * PROMOCIONES — lectura de la hoja de COMERCIAL | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Las promociones nacen en un archivo de comercial («Home Promociones comercial»), no en el
 * Portal. Hasta ahora el camino era: alguien abría ese archivo, copiaba a mano y pegaba en la
 * pestaña Promociones del Portal. Este archivo lee el original directamente.
 *
 * POR QUÉ HACE FALTA UN INTÉRPRETE Y NO UNA LECTURA A SECAS
 *
 * Ese archivo tiene MÁS DE 300 PESTAÑAS —una por campaña o por semana: «HOT FASHION 10-17
 * AGOSTO», «GBV Etapa 2 (10-23 jul)», «Beauty Day jul»…— y no hay dos iguales:
 *
 *   · La fila de encabezados NO está en la 1. Está donde toque: en «HOT FASHION» es la 14,
 *     en «GBV Etapa 2» la 13 y en «Beauty Day jul» la 3. Encima llevan un bloque de resumen
 *     («Descuento genérico», «Fecha límite carga de promos») que no es la tabla.
 *   · Las columnas cambian de sitio. «Marca» está en la G en unas hojas y en la E en otras,
 *     porque algunas no traen «Promoción AA 2025» ni «BANNERS HOME».
 *   · Una misma pestaña puede traer DOS tablas: la de tienda y, más abajo, otra de
 *     Marketplace con sus propios encabezados.
 *   · Entre medias hay filas de notas, totales y celdas sueltas que no son promociones.
 *
 * Por eso aquí no se lee «la fila 14 de la columna G»: se BUSCA la fila de encabezados, se
 * localiza cada columna por su nombre —el mismo criterio que usa el resto del sistema
 * (pcMapaColumnas_ en PortalContenido.gs)— y se descarta lo que no tiene pinta de promoción.
 *
 * QUÉ NO HACE: no escribe nada. Devuelve filas ya normalizadas que entran por el mismo
 * embudo que el pegado manual (portalContenidoAnalizarImport → portalContenidoAplicarImport),
 * con sus mismos seguros contra duplicados y su misma confirmación.
 *
 * Funciones expuestas al cliente:
 *   portalPromosHojas(email)          → pestañas visibles del archivo de comercial
 *   portalPromosLeer({email, hoja})   → filas interpretadas de esa pestaña
 */

// ── ORIGEN ───────────────────────────────────────────────────────────────────

// Respaldo en código; manda la propiedad de script 'PROMOS_COMERCIAL_ID'.
var PROMOS_COMERCIAL_ID = '1rZCrNpNAiuh1rFwH9YpWz0n7TIgviFmwwxnQFFIj7SE';

function promosComercialSS_() {
  return SpreadsheetApp.openById(secConfig_('PROMOS_COMERCIAL_ID', PROMOS_COMERCIAL_ID));
}

/** Filas que se leen como máximo de una pestaña (las hay de más de 1000). */
var PROMOS_MAX_FILAS = 600;

/** Cuántas filas vacías seguidas dan por terminada una tabla. */
var PROMOS_CORTE_VACIAS = 4;

/** Mínimo de columnas reconocidas para creer que una fila es de encabezados. */
var PROMOS_MIN_COLUMNAS = 4;

// ── DETECCIÓN DE LA TABLA ────────────────────────────────────────────────────

/**
 * ¿Es esta fila un encabezado de tabla de promociones? Se puntúa cuántas columnas
 * del catálogo reconoce. Un bloque de resumen («Descuento genérico | Hasta 40%»)
 * reconoce cero o una; la fila de encabezados de verdad reconoce cinco o seis.
 *
 * @return {{esHeader:boolean, puntos:number, mapa:Object, tipo:string}}
 */
function promosAnalizarFila_(fila, colProm, colMkp) {
  const textos = fila.map(function (v) { return String(v == null ? '' : v); });

  function puntuar(col) {
    const mapa = pcMapaColumnas_(col, textos);
    let n = 0;
    col.campos.forEach(function (c) { if (mapa[c.id] > -1) n++; });
    return { mapa: mapa, puntos: n };
  }

  // Una tabla de Marketplace se delata por su columna propia, «Promoción mktplace».
  const esMkp = textos.some(function (t) { return pcNormHdr_(t).indexOf('mktplace') !== -1; });
  const col = esMkp ? colMkp : colProm;
  const r = puntuar(col);

  // Sin la columna que identifica la fila (Dirección) no hay tabla que valga:
  // hay filas de resumen que casan «vigencia» o «liga» por casualidad.
  const tieneDireccion = r.mapa.direccion > -1;

  return {
    esHeader: tieneDireccion && r.puntos >= PROMOS_MIN_COLUMNAS,
    puntos: r.puntos,
    mapa: r.mapa,
    tipo: esMkp ? 'mkp' : 'promociones'
  };
}

/**
 * ¿Esta fila de datos es una promoción de verdad, o es ruido?
 *
 * Lo que se descarta y por qué:
 *   · Sin dirección → el Portal no la mostraría igualmente.
 *   · Dirección numérica → en «Beauty Day jul» esa columna trae «7» en vez del
 *     nombre de la dirección. Es un dato roto en origen, no una promoción.
 *   · Rótulos de sección y notas («Marketplace», «Fecha límite carga…», «MG»,
 *     «Total») que viven sueltos entre las tablas.
 *   · Filas con una sola celda: son títulos, no registros.
 */
function promosFilaUtil_(valores, celdasConTexto) {
  const dir = String(valores.direccion || '').trim();
  const cat = String(valores.categoria || '').trim();

  // RECUPERABLE: la fila es una promoción de verdad —tiene categoría y promoción—
  // pero su dirección no sirve. Las hojas «Beauty Day» traen un 7 en esa columna, y
  // descartarlas en silencio tiraba TODAS sus promociones de tienda. Se devuelven
  // aparte para que el supervisor les ponga la dirección de una vez, en lugar de que
  // desaparezcan sin que nadie se entere.
  const dirRota = !dir || /^[\d.,\s]+$/.test(dir);
  if (dirRota && cat && celdasConTexto >= 2) {
    return { ok: false, recuperable: true,
             motivo: dir ? 'la dirección es un número («' + dir + '»)' : 'sin dirección' };
  }
  if (!dir) return { ok: false, motivo: 'sin dirección' };
  if (/^[\d.,\s]+$/.test(dir)) return { ok: false, motivo: 'la dirección es un número («' + dir + '»)' };

  const k = pcClave_(dir);
  const rotulos = ['marketplace', 'mkp', 'total', 'totales', 'mg', 'nota', 'notas',
                   'descuento generico', 'multimedia y linea blanca'];
  if (rotulos.indexOf(k) !== -1) return { ok: false, motivo: 'rótulo de sección' };
  if (k.indexOf('fecha limite') === 0) return { ok: false, motivo: 'nota de fechas' };

  if (celdasConTexto < 2) return { ok: false, motivo: 'fila con una sola celda' };
  return { ok: true };
}

/** Celda → texto limpio. Las fechas se escriben como las espera el Portal. */
function promosTexto_(v) {
  if (v instanceof Date) {
    try { return Utilities.formatDate(v, Session.getScriptTimeZone(), 'd \'de\' MMMM'); }
    catch (e) { return String(v); }
  }
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

/**
 * EL INTÉRPRETE. Recibe la cuadrícula de valores en crudo y devuelve las tablas que
 * encuentra dentro. Está separado del acceso a Sheets a propósito: así se le pueden
 * echar encima hojas reales en una prueba, sin abrir el archivo de comercial.
 *
 * El recorrido es: buscar una fila de encabezados → leer hacia abajo hasta que se
 * acabe la tabla (varias filas vacías seguidas o el encabezado de la siguiente) →
 * seguir buscando. Por eso una pestaña con la tabla de tienda arriba y la de
 * Marketplace abajo sale con las dos.
 *
 * @param {Array<Array>} datos   cuadrícula tal cual (getValues)
 * @param {Object} colProm       sección 'promociones' del catálogo
 * @param {Object} colMkp        sección 'mkp' del catálogo
 * @return {{promociones:Array, mkp:Array, tablas:Array, descartes:Array}}
 */
function promosInterpretar_(datos, colProm, colMkp) {
  const salida = { promociones: [], mkp: [] };
  const pendientes = { promociones: [], mkp: [] };
  const descartes = [];
  const tablas = [];

  let i = 0;
  while (i < datos.length) {
    const cab = promosAnalizarFila_(datos[i], colProm, colMkp);
    if (!cab.esHeader) { i++; continue; }

    const col = cab.tipo === 'mkp' ? colMkp : colProm;
    let vacias = 0, leidas = 0, aceptadas = 0;

    let j = i + 1;
    for (; j < datos.length; j++) {
      // Otra tabla empieza aquí: se corta y el bucle exterior la recoge.
      if (promosAnalizarFila_(datos[j], colProm, colMkp).esHeader) break;

      const bruta = datos[j];
      const conTexto = bruta.filter(function (v) { return promosTexto_(v) !== ''; }).length;
      if (!conTexto) {
        vacias++;
        if (vacias >= PROMOS_CORTE_VACIAS) break;
        continue;
      }
      vacias = 0;
      leidas++;

      const valores = {};
      col.campos.forEach(function (c) {
        valores[c.id] = cab.mapa[c.id] > -1 ? promosTexto_(bruta[cab.mapa[c.id]]) : '';
      });

      const util = promosFilaUtil_(valores, conTexto);
      if (!util.ok) {
        if (util.recuperable) {
          valores.direccion = '';                 // se rellena arriba, no aquí
          pendientes[cab.tipo].push(valores);
        } else if (descartes.length < 25) {
          descartes.push({ fila: j + 1, motivo: util.motivo, texto: promosTexto_(bruta[0]).slice(0, 60) });
        }
        continue;
      }

      salida[cab.tipo].push(valores);
      aceptadas++;
    }

    tablas.push({ tipo: cab.tipo, filaEncabezado: i + 1, leidas: leidas, aceptadas: aceptadas,
                  pendientes: pendientes[cab.tipo].length,
                  columnas: col.campos.filter(function (c) { return cab.mapa[c.id] > -1; })
                                      .map(function (c) { return c.etiqueta; }) });
    i = j;
  }

  return { promociones: salida.promociones, mkp: salida.mkp,
           pendientes: pendientes, tablas: tablas, descartes: descartes };
}

// ── PESTAÑAS DISPONIBLES ─────────────────────────────────────────────────────

/** Meses en español, para leer el rango de fechas del NOMBRE de la pestaña. */
var PROMOS_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Interpreta el nombre de una pestaña para saber a qué fechas se refiere.
 * Los nombres vienen de mil formas: «10-17 AGOSTO», «8 - 18 de Junio»,
 * «GBV Etapa 3 (24 jul-09 agos)», «26 de Julio al 01 Agosto», «Beauty Day jul».
 * Devuelve {inicio, fin} o null si no se puede deducir.
 */
function promosRangoDelNombre_(nombre, anio) {
  const s = pcClave_(nombre);

  function mesDe(txt) {
    if (!txt) return -1;
    const t = pcClave_(txt);
    for (let i = 0; i < 12; i++) if (PROMOS_MESES[i].indexOf(t.slice(0, 3)) === 0) return i;
    return -1;
  }

  // «10-17 agosto», «8 - 18 de junio», «24 jul-09 agos», «26 de julio al 01 agosto»
  let m = s.match(/(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})?\s*(?:-|–|al?|a)\s*(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})/);
  if (m) {
    const d1 = parseInt(m[1], 10), d2 = parseInt(m[3], 10);
    let m1 = mesDe(m[2]), m2 = mesDe(m[4]);
    if (m1 < 0 && m2 >= 0) m1 = m2;
    if (m2 < 0 && m1 >= 0) m2 = m1;
    if (m1 >= 0 && m2 >= 0) {
      const a2 = (m2 < m1) ? anio + 1 : anio;
      return { inicio: new Date(anio, m1, d1, 0, 0, 0), fin: new Date(a2, m2, d2, 23, 59, 59) };
    }
  }
  // Un solo mes suelto: «beauty day jul» → todo ese mes.
  m = s.match(/\b([a-z]{3,10})\b\s*$/);
  if (m) {
    const mi = mesDe(m[1]);
    if (mi >= 0) return { inicio: new Date(anio, mi, 1, 0, 0, 0), fin: new Date(anio, mi + 1, 0, 23, 59, 59) };
  }
  return null;
}

/**
 * Pestañas del archivo de comercial que tiene sentido ofrecer.
 *
 * Solo las VISIBLES: ese archivo arrastra más de 300 pestañas ocultas con el
 * histórico de años anteriores, y ofrecerlas es invitar a publicar promociones
 * caducadas. Se ordenan poniendo delante la que cubre el día de hoy.
 */
function portalPromosHojas(email) {
  try {
    const gate = pcGate_(email);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const ss = promosComercialSS_();
    const hoy = new Date();
    const anio = hoy.getFullYear();

    const hojas = ss.getSheets()
      .filter(function (sh) { return !sh.isSheetHidden(); })
      .map(function (sh) {
        const nombre = sh.getName();
        const rango = promosRangoDelNombre_(nombre, anio);
        const vigente = !!(rango && hoy >= rango.inicio && hoy <= rango.fin);
        // Distancia en días al periodo, para ordenar lo más cercano primero.
        let dist = 99999;
        if (rango) {
          dist = vigente ? 0 : Math.round(Math.min(
            Math.abs(hoy - rango.inicio), Math.abs(hoy - rango.fin)) / 86400000);
        }
        return { nombre: nombre, vigente: vigente, distancia: dist,
                 periodo: rango ? Utilities.formatDate(rango.inicio, Session.getScriptTimeZone(), 'd MMM') +
                                  ' – ' + Utilities.formatDate(rango.fin, Session.getScriptTimeZone(), 'd MMM') : '' };
      });

    hojas.sort(function (a, b) { return a.distancia - b.distancia; });

    return {
      status: 'ok',
      archivo: ss.getName(),
      url: ss.getUrl(),
      hojas: hojas,
      sugerida: hojas.length ? hojas[0].nombre : ''
    };
  } catch (error) {
    Logger.log('portalPromosHojas: ' + error);
    return { status: 'error',
             error: 'No pudimos abrir el archivo de comercial. Comprueba que la cuenta del sistema ' +
                    'tenga acceso a él. (' + error + ')' };
  }
}

// ── LECTURA E INTERPRETACIÓN ─────────────────────────────────────────────────

/**
 * Lee una pestaña del archivo de comercial y devuelve sus promociones ya en el
 * formato de campos del catálogo del Portal, listas para el análisis de importación.
 *
 * Devuelve las DOS tablas por separado (tienda y Marketplace) porque van a
 * secciones distintas del Portal, y un diagnóstico de lo que se descartó: si de 40
 * filas entran 12, el supervisor tiene que poder ver por qué antes de publicar.
 *
 * @param {{email:string, hoja:string}} p
 */
function portalPromosLeer(p) {
  try {
    const gate = pcGate_(p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const nombreHoja = String((p && p.hoja) || '').trim();
    if (!nombreHoja) return { status: 'error', error: 'Falta decir qué pestaña leer.' };

    const sh = promosComercialSS_().getSheetByName(nombreHoja);
    if (!sh) return { status: 'error', error: 'La pestaña «' + nombreHoja + '» ya no está en el archivo de comercial.' };

    const colProm = pcColeccion_('promociones');
    const colMkp  = pcColeccion_('mkp');

    const ultimaFila = Math.min(sh.getLastRow(), PROMOS_MAX_FILAS);
    const ultimaCol  = Math.max(sh.getLastColumn(), 1);
    if (ultimaFila < 2) return { status: 'error', error: 'Esa pestaña está vacía.' };

    const datos = sh.getRange(1, 1, ultimaFila, ultimaCol).getValues();
    const r = promosInterpretar_(datos, colProm, colMkp);

    if (!r.tablas.length) {
      return { status: 'error',
               error: 'No encontramos una tabla de promociones en «' + nombreHoja + '». ' +
                      'Hace falta una fila de encabezados con al menos Dirección y otras tres columnas ' +
                      '(Banner / Carrusel, Promoción, Vigencia, Liga…).' };
    }

    return {
      status: 'ok',
      hoja: nombreHoja,
      promociones: r.promociones,
      mkp: r.mkp,
      // Filas buenas a las que solo les falta la dirección: el cliente pide una y las
      // suma a las de arriba. Sin esto, las hojas «Beauty Day» no aportaban nada.
      pendientes: r.pendientes,
      tablas: r.tablas,
      descartes: r.descartes,
      truncado: sh.getLastRow() > PROMOS_MAX_FILAS
    };
  } catch (error) {
    Logger.log('portalPromosLeer: ' + error);
    return { status: 'error', error: String(error.message || error) };
  }
}

// ── DIAGNÓSTICO ──────────────────────────────────────────────────────────────

/**
 * Ejecútala desde el editor para ver, de un vistazo, qué entiende el intérprete de
 * cada pestaña visible del archivo de comercial. Es la forma rápida de detectar que
 * comercial cambió el formato de una hoja antes de que alguien lo sufra publicando.
 */
function promosRevisarHojas() {
  secSoloInterno_('promosRevisarHojas');
  const r = portalPromosHojas(Session.getActiveUser().getEmail());
  if (r.status !== 'ok') { Logger.log('No se pudo listar: ' + r.error); return r; }

  Logger.log('═══ ' + r.archivo + ' · ' + r.hojas.length + ' pestañas visibles ═══');
  r.hojas.forEach(function (h) {
    const d = portalPromosLeer({ email: Session.getActiveUser().getEmail(), hoja: h.nombre });
    if (d.status !== 'ok') {
      Logger.log('  ✖ ' + h.nombre + ' → ' + d.error);
      return;
    }
    Logger.log('  ' + (h.vigente ? '►' : ' ') + ' ' + h.nombre +
               '  [' + h.periodo + ']  tienda=' + d.promociones.length +
               '  mkp=' + d.mkp.length +
               '  descartadas=' + d.descartes.length +
               '  encabezado en fila ' + d.tablas.map(function (t) { return t.filaEncabezado; }).join('/'));
  });
  return r;
}
