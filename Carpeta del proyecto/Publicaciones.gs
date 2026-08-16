/**
 * =================================================================================================
 * Publicaciones 2.0 — identidad, enlace compartible y encuestas | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Lo que este archivo añade a los anuncios del Portal (Portal.gs sigue siendo el dueño de la
 * hoja "Anuncios"; aquí solo vive lo que la fase 7 le pone encima):
 *
 *   1. IDENTIDAD. Toda fila tiene un ID escrito, aunque la haya creado alguien a mano en el
 *      Sheet. Antes esas filas se identificaban por su POSICIÓN, y ese es un enlace que se
 *      rompe sin avisar en cuanto alguien inserta una fila más arriba.
 *   2. ENLACE COMPARTIBLE. pubPorId() devuelve UNA publicación por su id, incluidas las que
 *      ya no están a la vista (expiradas, programadas, ocultas), diciendo por qué no lo están.
 *      Es lo que permite que ?page=portal&pub=anc-xxx abra siempre algo, aunque sea para
 *      explicar que ya pasó.
 *   3. ENCUESTAS. Una tarjeta puede llevar pregunta y opciones. Los votos NO viven en la fila
 *      del anuncio —publicarAnuncio reescribe esa fila entera, así que editar el anuncio se
 *      llevaría los votos por delante— sino en su propia hoja, una fila por voto.
 *
 * Funciones expuestas al cliente:
 *   pubPorId(id, email)        → Index.html (modal de un enlace compartido)
 *   pubResultados(id, email)   → Index.html (gráfica de una encuesta)
 *   pubVotar(payload)          → Index.html (emitir o cambiar el voto)
 *
 * Nombres con prefijo `pub` porque los .gs comparten un solo ámbito global.
 */

// ── IDENTIDAD DE LAS FILAS ───────────────────────────────────────────────────

/**
 * ID nuevo para una publicación.
 *
 * Lleva sufijo aleatorio además del reloj porque el relleno de IDs escribe varias filas
 * de una vez: `Date.now()` es el mismo milisegundo para todas ellas y dos publicaciones
 * con el mismo id son dos enlaces que llevan al mismo sitio equivocado.
 */
function pubNuevoIdAnuncio_() {
  return 'anc-' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
}

/**
 * Huella corta y estable de un texto. Se usa para dar identidad por CONTENIDO a lo que
 * no puede tener una columna ID propia (la hoja legacy "Avisos") y como respaldo cuando
 * no se ha podido escribir en la hoja.
 *
 * No es seguridad, es identidad: lo que se pide de ella es que el mismo contenido dé
 * siempre el mismo id y que dos avisos distintos no choquen.
 */
function pubHashCorto_(txt) {
  try {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(txt || ''), Utilities.Charset.UTF_8);
    let s = '';
    for (let i = 0; i < 5; i++) {
      const b = (bytes[i] + 256) % 256;
      s += (b < 16 ? '0' : '') + b.toString(16);
    }
    return s;
  } catch (e) {
    // Sin digest disponible, una suma rodante: peor repartida, igual de estable.
    let h = 0;
    const s = String(txt || '');
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(16);
  }
}

/**
 * El id con el que sale una fila de la hoja.
 *
 * Lo normal es que la celda ID lo traiga (pubAsegurarIdsAnuncios_ se encarga). El respaldo
 * por contenido es para el caso en que NO se haya podido escribir —la hoja está tomada por
 * otro proceso, o el despliegue corre sin permiso de escritura—: entonces el id sale del
 * formato y del JSON de la fila, que es lo único que la distingue. Sigue sin ser posicional,
 * que es lo que importa: insertar una fila arriba no se lo cambia a los de abajo.
 */
function pubIdDeFila_(valorId, row, c, indiceFila) {
  const escrito = String(valorId || '').trim();
  if (escrito) return escrito;
  const semilla = String(c.formato > -1 ? row[c.formato] : '') + '|' +
                  String(c.datos > -1 ? row[c.datos] : '') + '|' +
                  String(c.hasta > -1 ? row[c.hasta] : '');
  const huella = pubHashCorto_(semilla);
  // Una fila del todo vacía no tiene contenido que la distinga: ahí sí manda la posición,
  // pero es un caso que no llega al Portal (readPortalAnuncios_ ya la ha descartado).
  return semilla.replace(/\|/g, '').trim() ? 'anc-h' + huella : 'anc-row-' + indiceFila;
}

/**
 * Le pone ID a las filas de "Anuncios" que no lo tengan.
 *
 * Es idempotente y barato: una lectura de la columna ID y, si está toda escrita —el caso
 * normal—, ni siquiera toma el candado. Solo escribe la primera vez que aparece una fila
 * a mano, que es justo cuando hace falta.
 *
 * El candado importa porque esto corre desde la LECTURA pública del Portal: dos visitantes
 * a la vez sobre una hoja recién editada intentarían rellenar los mismos huecos, y el
 * segundo le cambiaría el id al primero —o sea, rompería el enlace que acababa de crear—.
 * Si no se consigue el candado no se escribe nada: la lectura sigue con el id por contenido
 * de pubIdDeFila_ y el siguiente que pase lo intentará de nuevo.
 *
 * @return {boolean} si escribió algo.
 */
function pubAsegurarIdsAnuncios_(sheet) {
  try {
    const ultima = sheet.getLastRow();
    if (ultima < 2) return false;
    const width = sheet.getLastColumn();
    const hdr = sheet.getRange(1, 1, 1, width).getValues()[0];
    const c = portalAnunciosCols_(hdr);
    // Sin columna ID no se inventa una desde una lectura pública: crear columnas es
    // trabajo de portalAnunciosSheetW_, que corre con la sesión de quien administra.
    if (c.id < 0) return false;

    const datos = sheet.getRange(2, 1, ultima - 1, width).getValues();
    let faltan = 0;
    for (let i = 0; i < datos.length; i++) {
      if (!String(datos[i][c.id] || '').trim() && pubFilaViva_(datos[i], c)) faltan++;
    }
    if (!faltan) return false;

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return false;
    try {
      /* Se vuelve a leer ENTERA dentro del candado, y no solo la columna de ids. Dos
         motivos, y el segundo es el que muerde: otro proceso puede haber rellenado ya
         los huecos —escribir con la foto vieja le cambiaría los ids que acaba de
         asignar—, y la hoja puede tener hoy menos filas que hace un instante, en cuyo
         caso los índices de la foto vieja ya no señalan a las mismas filas y el relleno
         acabaría poniéndole un id a una fila vacía. */
      const ultimaAhora = sheet.getLastRow();
      if (ultimaAhora < 2) return false;
      const frescos = sheet.getRange(2, 1, ultimaAhora - 1, sheet.getLastColumn()).getValues();
      const ids = [];
      let escritos = 0;
      for (let i = 0; i < frescos.length; i++) {
        const actual = String(frescos[i][c.id] || '').trim();
        if (!actual && pubFilaViva_(frescos[i], c)) { ids.push([pubNuevoIdAnuncio_()]); escritos++; }
        else ids.push([actual]);
      }
      if (!escritos) return false;
      sheet.getRange(2, c.id + 1, ids.length, 1).setValues(ids);
      SpreadsheetApp.flush();
      /* La caché del Portal pudo construirse con los ids de RESPALDO (los derivados del
         contenido, pubIdDeFila_). Ahora que hay ids escritos, esa copia serviría durante
         diez minutos unos identificadores que ya no son los de la hoja, y un enlace
         copiado de ella no abriría nada. Cuando esto se llama desde el propio build del
         Portal la invalidación no hace nada —la caché se escribe después, y ya con los
         ids buenos—, que es justo lo que se quiere. */
      portalInvalidarCacheAnuncios_();
      return true;
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    // Una lectura del Portal no se cae porque no se haya podido sanear la hoja.
    Logger.log('pubAsegurarIdsAnuncios_: ' + e);
    return false;
  }
}

/** ¿Esta fila es una publicación o es una fila en blanco con formato? */
function pubFilaViva_(row, c) {
  const campos = [c.formato, c.datos, c.hasta, c.orden, c.activo];
  for (let i = 0; i < campos.length; i++) {
    if (campos[i] > -1 && String(row[campos[i]] === null || row[campos[i]] === undefined ? '' : row[campos[i]]).trim() !== '') return true;
  }
  return false;
}

/**
 * El «Orden» que le toca a una publicación NUEVA para salir la primera.
 *
 * Uno menos que el menor que haya. Se eligió eso en vez de renumerar todas las filas
 * —que es lo que hace `moverAnuncio`— porque renumerar son N escrituras cada vez que
 * alguien publica algo, y aquí basta con una. Que los números se vayan a negativo no
 * molesta a nadie: la columna es un criterio de orden, no una posición que se enseñe,
 * y el primer reordenado manual los normaliza a 0..n-1.
 */
function pubOrdenParaNueva_(sheet, c) {
  try {
    if (c.orden < 0) return 0;
    const last = sheet.getLastRow();
    if (last < 2) return 0;
    const valores = sheet.getRange(2, c.orden + 1, last - 1, 1).getValues();
    let min = 0, hay = false;
    for (let i = 0; i < valores.length; i++) {
      const v = valores[i][0];
      if (v === '' || v === null || v === undefined) continue;
      const n = Number(v);
      if (isNaN(n)) continue;
      if (!hay || n < min) { min = n; hay = true; }
    }
    return hay ? min - 1 : 0;
  } catch (e) {
    Logger.log('pubOrdenParaNueva_: ' + e);
    return 0;
  }
}

// ── SANEO DEL JSON DE UNA PUBLICACIÓN ────────────────────────────────────────

var PUB_ENCUESTA_MAX_OPCIONES = 6;   // decisión de la fase 7: más no caben en la tarjeta ni en móvil

/**
 * Acota lo que se guarda en "Datos (JSON)".
 *
 * El constructor ya valida, pero esta función es el servidor: el payload llega del
 * navegador y nada impide mandarlo a mano con doce opciones de mil caracteres. Lo que se
 * recorta aquí es solo lo que tiene forma conocida —la encuesta—; el resto del JSON pasa
 * tal cual para no tirar campos que añada una versión futura del constructor.
 */
function pubSanearDatos_(datos) {
  const out = {};
  Object.keys(datos || {}).forEach(function (k) {
    // `__proto__` como clave no crea una propiedad: reemplaza el prototipo del objeto.
    // Nunca es un campo legítimo de una publicación, así que se descarta sin más.
    if (k === '__proto__') return;
    out[k] = datos[k];
  });
  if (!out.encuesta || typeof out.encuesta !== 'object') {
    delete out.encuesta;
    return out;
  }
  const e = out.encuesta;
  const opciones = (Array.isArray(e.opciones) ? e.opciones : [])
    .map(function (o) { return String(o == null ? '' : o).trim().slice(0, 80); })
    .filter(function (o) { return !!o; })
    .slice(0, PUB_ENCUESTA_MAX_OPCIONES);
  const pregunta = String(e.pregunta || '').trim().slice(0, 160);
  // Una encuesta sin pregunta o con una sola opción no es una encuesta: se guarda como
  // tarjeta informativa en vez de publicar algo que en el Portal no se podría contestar.
  if (!pregunta || opciones.length < 2) {
    delete out.encuesta;
    return out;
  }
  out.encuesta = {
    pregunta: pregunta,
    opciones: opciones,
    tiempo:   String(e.tiempo || '').trim().slice(0, 40),
    cierre:   /^\d{4}-\d{2}-\d{2}$/.test(String(e.cierre || '')) ? String(e.cierre) : '',
    verAntes: e.verAntes === true
  };
  return out;
}

// ── UNA PUBLICACIÓN POR SU ID (enlace compartible) ───────────────────────────

/**
 * Devuelve UNA publicación por id, esté a la vista o no.
 *
 * Existe porque un enlace compartido sobrevive a la publicación: se manda el martes y se
 * abre el viernes, cuando ya expiró. Sin esto, el modal se quedaba sin nada que enseñar y
 * el Portal se comportaba como si el enlace estuviera roto —que es lo que parece cuando no
 * pasa nada—. Ahora se abre igual y dice qué le pasó.
 *
 * `estado` es lo que el Portal traduce a palabras: 'activo' | 'expirado' | 'programado' |
 * 'inactivo'. Los tres últimos se enseñan con su aviso; ninguno es un error.
 */
function pubPorId(id, email) {
  try {
    const clave = String(id || '').trim();
    if (!clave) return { status: 'error', error: 'Falta el identificador de la publicación.' };

    const ss = portalSS_();
    const sheet = ss.getSheetByName(PORTAL_ANUNCIOS_SHEET);
    if (!sheet) return { status: 'error', error: 'No encontramos las publicaciones del Portal.' };
    pubAsegurarIdsAnuncios_(sheet);

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { status: 'error', error: 'No encontramos esa publicación.' };
    const c = portalAnunciosCols_(data[0]);
    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const hoy0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!pubFilaViva_(row, c)) continue;
      if (pubIdDeFila_(c.id > -1 ? row[c.id] : '', row, c, i) !== clave) continue;

      let datos = {};
      if (c.datos > -1 && row[c.datos]) { try { datos = JSON.parse(String(row[c.datos])); } catch (e) {} }
      const formato = c.formato > -1 && row[c.formato] ? String(row[c.formato]).trim().toLowerCase() : 'banner';
      const desde  = c.desde > -1 && row[c.desde] instanceof Date ? row[c.desde] : null;
      const hasta  = c.hasta > -1 && row[c.hasta] instanceof Date ? row[c.hasta] : null;
      const activo = c.activo > -1 ? portalEsActivo_(row[c.activo]) : true;

      let estado = 'activo';
      if (!activo) estado = 'inactivo';
      else if (desde && desde > now) estado = 'programado';
      else if (hasta && hasta < hoy0) estado = 'expirado';

      /* Una publicación OCULTA no se sirve por enlace. Las expiradas y las programadas sí:
         son cosas que existieron o van a existir, y quien recibe el enlace merece saber
         qué decían. "Oculto" es la forma que tiene quien administra de retirar algo del
         Portal, y servirlo por la puerta de atrás dejaría esa decisión sin efecto. */
      if (estado === 'inactivo') {
        return { status: 'error', error: 'Esa publicación ya no está disponible.', estado: 'inactivo' };
      }

      const pub = Object.assign({}, datos, {
        id: clave,
        formato: formato,
        orden: c.orden > -1 && row[c.orden] !== '' ? Number(row[c.orden]) || 0 : 0,
        responsable: portalNombreResponsable_(
          c.responsable > -1 ? row[c.responsable] : '',
          c.autor > -1 ? row[c.autor] : ''),
        creado: c.creado > -1 && row[c.creado] instanceof Date
          ? Utilities.formatDate(row[c.creado], tz, 'yyyy-MM-dd') : '',
        estado: estado,
        desde: desde ? Utilities.formatDate(desde, tz, 'yyyy-MM-dd') : '',
        hasta: hasta ? Utilities.formatDate(hasta, tz, 'yyyy-MM-dd') : ''
      });
      return { status: 'ok', pub: pub };
    }
    return { status: 'error', error: 'No encontramos esa publicación.', estado: 'inexistente' };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

// ── ENCUESTAS: VOTOS ─────────────────────────────────────────────────────────

var PUB_VOTOS_SHEET   = 'Votos';
var PUB_VOTOS_HEADERS = ['Fecha', 'Publicación', 'Correo', 'Opción'];
var PUB_VOTOS_TTL     = 30;   // segundos de caché de resultados

/**
 * Quién está votando.
 *
 * Dos fuentes, por este orden: la sesión del Portal (el correo con el que se entró al
 * sistema, validado contra "Registros") y, si no la hay, la cuenta de Google del dominio.
 * La segunda existe porque el Portal se puede abrir sin iniciar sesión en el sistema y
 * seguir siendo alguien identificable; sin ninguna de las dos no se vota, porque "un voto
 * por persona" sin persona no significa nada.
 */
function pubQuienVota_(emailCliente) {
  const declarado = String(emailCliente || '').trim().toLowerCase();
  if (declarado) {
    try {
      const id = secIdentidad_(declarado);
      if (id.ok) return { ok: true, correo: id.email, nombre: id.nombre };
    } catch (e) {}
  }
  let dominio = '';
  try { dominio = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch (e) {}
  if (dominio) return { ok: true, correo: dominio, nombre: '' };
  return { ok: false, error: 'Inicia sesión en el sistema para poder votar.' };
}

function pubVotosSheet_(ss, crear) {
  let sheet = ss.getSheetByName(PUB_VOTOS_SHEET);
  if (!sheet && crear) {
    sheet = ss.insertSheet(PUB_VOTOS_SHEET);
    sheet.appendRow(PUB_VOTOS_HEADERS);
    sheet.getRange(1, 1, 1, PUB_VOTOS_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Columnas de la hoja Votos, por nombre (nunca por posición). */
function pubVotosCols_(hdr) {
  const h = hdr.map(function (x) { return String(x).toLowerCase().trim(); });
  return {
    fecha:  h.findIndex(function (x) { return x.indexOf('fecha') > -1; }),
    pub:    h.findIndex(function (x) { return x.indexOf('public') > -1 || x.indexOf('anuncio') > -1; }),
    correo: h.findIndex(function (x) { return x.indexOf('correo') > -1 || x.indexOf('mail') > -1; }),
    opcion: h.findIndex(function (x) { return x.indexOf('opci') > -1 || x.indexOf('voto') > -1; })
  };
}

function pubClaveCacheVotos_(id) { return 'pubVotos_' + id; }

/**
 * Recuento de una encuesta: [{opcion, votos}], total, y qué votó quien pregunta.
 *
 * La caché es de MEDIO MINUTO y propia, deliberadamente fuera de fetchToolsData: los
 * anuncios se sirven con diez minutos de caché de script y siete días de copia local en el
 * navegador, y una gráfica de votos servida con esas edades no se equivoca un poco, miente
 * —enseña un resultado de la semana pasada como si fuera el de ahora—. El voto propio no
 * se cachea nunca: es distinto para cada persona.
 */
function pubResultados(id, email) {
  try {
    const clave = String(id || '').trim();
    if (!clave) return { status: 'error', error: 'Falta el identificador de la publicación.' };

    let correo = '';
    try {
      const quien = pubQuienVota_(email);
      if (quien.ok) correo = quien.correo;
    } catch (e) {}

    /* La caché guarda el recuento ENTERO, con el voto de cada quien, y de él se devuelve
       solo el de quien pregunta. Guardar únicamente los totales habría obligado a releer
       la hoja para saber si esta persona ya votó —o sea, a no ahorrar nada— y devolver el
       mapa completo al navegador sería publicar quién votó qué, que es exactamente lo que
       una encuesta no debe hacer. Vive en la caché del SCRIPT, no en la del usuario. */
    const cacheado = portalCacheGet_(pubClaveCacheVotos_(clave));
    if (cacheado && cacheado.conteo) {
      return {
        status: 'ok', total: cacheado.total, conteo: cacheado.conteo,
        miVoto: (cacheado.porCorreo && correo) ? (cacheado.porCorreo[correo] || '') : pubVotoDe_(clave, correo)
      };
    }

    const recuento = pubContar_(clave);
    try {
      const conVotos = JSON.stringify({ total: recuento.total, conteo: recuento.conteo, porCorreo: recuento.porCorreo });
      // Una encuesta muy votada no cabe con el detalle por persona (el límite por llave
      // ronda los 100 KB): entonces se cachean los totales, que es lo que ve todo el mundo,
      // y el voto propio se lee aparte.
      CacheService.getScriptCache().put(pubClaveCacheVotos_(clave),
        conVotos.length < 90000 ? conVotos : JSON.stringify({ total: recuento.total, conteo: recuento.conteo }),
        PUB_VOTOS_TTL);
    } catch (e) {}
    return { status: 'ok', total: recuento.total, conteo: recuento.conteo, miVoto: recuento.porCorreo[correo] || '' };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

/**
 * Lee la hoja de votos de UNA publicación. Devuelve conteo por opción y voto por persona.
 *
 * Los dos mapas se crean SIN PROTOTIPO porque sus claves son texto que escribió una
 * persona: con un objeto normal, una opción llamada "constructor" o "toString" ya
 * "existe" antes del primer voto —vale una función heredada— y `conteo[op] || 0` sumaría
 * 1 a una función en vez de a un número. Es un caso raro y de consecuencias tontas
 * (una barra con NaN), pero cuesta una palabra evitarlo.
 */
function pubContar_(id) {
  const conteo = Object.create(null), porCorreo = Object.create(null);
  let total = 0;
  const ss = portalSS_();
  const sheet = pubVotosSheet_(ss, false);
  if (!sheet) return { total: 0, conteo: conteo, porCorreo: porCorreo };
  const ultima = sheet.getLastRow();
  if (ultima < 2) return { total: 0, conteo: conteo, porCorreo: porCorreo };
  const width = Math.max(sheet.getLastColumn(), PUB_VOTOS_HEADERS.length);
  const data = sheet.getRange(1, 1, ultima, width).getValues();
  const c = pubVotosCols_(data[0]);
  if (c.pub < 0 || c.opcion < 0) return { total: 0, conteo: conteo, porCorreo: porCorreo };
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][c.pub] || '').trim() !== id) continue;
    const op = String(data[i][c.opcion] || '').trim();
    if (!op) continue;
    const quien = c.correo > -1 ? String(data[i][c.correo] || '').trim().toLowerCase() : '';
    conteo[op] = (conteo[op] || 0) + 1;
    total++;
    if (quien) porCorreo[quien] = op;
  }
  return { total: total, conteo: conteo, porCorreo: porCorreo };
}

/** Qué votó una persona concreta, sin recontar toda la encuesta para el resto. */
function pubVotoDe_(id, correo) {
  if (!correo) return '';
  try {
    return pubContar_(id).porCorreo[correo] || '';
  } catch (e) {
    return '';
  }
}

/**
 * Emite o cambia un voto. payload: {id, opcion, asesor}.
 *
 * Tres cuidados, y los tres tienen su razón:
 *   · CANDADO. Dos personas votando a la vez leían la misma hoja y escribían en la misma
 *     fila siguiente; el segundo appendRow pisaba al primero. Con el candado, el segundo
 *     espera su turno y los dos votos quedan.
 *   · UN VOTO POR PERSONA, cambiable. Si ya hay fila suya se reescribe (opción y fecha) en
 *     vez de añadir otra. Cambiar de opinión hasta el cierre es parte de lo pedido; votar
 *     dos veces, no.
 *   · LÍMITE POR PERSONA. La única escritura abierta del Portal era reportBrokenLink y lleva
 *     su límite por hora desde el principio; esta es la segunda y hereda el mismo criterio,
 *     porque el resto de la hoja está a un `appendRow` de distancia de cualquiera.
 */
function pubVotar(payload) {
  try {
    const id = String((payload && payload.id) || '').trim();
    const opcion = String((payload && payload.opcion) || '').trim();
    if (!id || !opcion) return { status: 'error', error: 'Falta la publicación o la opción.' };

    const quien = pubQuienVota_(payload && payload.asesor);
    if (!quien.ok) return { status: 'error', error: quien.error };

    const limite = 'voto_' + quien.correo;
    if (secIntentosRevisar_(limite, 40, 3600).bloqueado) {
      return { status: 'error', error: 'Has votado muchas veces en la última hora. Inténtalo más tarde.' };
    }

    // La encuesta manda: la opción tiene que ser una de las publicadas y la votación tiene
    // que seguir abierta. Sin esta comprobación, la hoja aceptaría cualquier texto como
    // opción y la gráfica del Portal enseñaría barras que nadie publicó.
    const ficha = pubPorId(id, payload && payload.asesor);
    if (ficha.status !== 'ok') return { status: 'error', error: ficha.error || 'No encontramos esa publicación.' };
    const enc = ficha.pub && ficha.pub.encuesta;
    if (!enc || !Array.isArray(enc.opciones)) return { status: 'error', error: 'Esa publicación no es una encuesta.' };
    if (enc.opciones.indexOf(opcion) < 0) return { status: 'error', error: 'Esa opción ya no está en la encuesta.' };
    if (pubEncuestaCerrada_(enc, ficha.pub)) return { status: 'error', error: 'La encuesta ya está cerrada.' };

    const ss = portalSS_();
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) {
      return { status: 'error', error: 'El Portal está ocupado guardando otros votos. Inténtalo en un momento.' };
    }
    try {
      const sheet = pubVotosSheet_(ss, true);
      const width = Math.max(sheet.getLastColumn(), PUB_VOTOS_HEADERS.length);
      const c = pubVotosCols_(sheet.getRange(1, 1, 1, width).getValues()[0]);
      if (c.pub < 0 || c.opcion < 0 || c.correo < 0 || c.fecha < 0) {
        return { status: 'error', error: 'La hoja de votos no tiene las columnas esperadas.' };
      }

      // Fila propia previa, si la hay: un voto por persona, cambiable.
      let fila = -1;
      const ultima = sheet.getLastRow();
      if (ultima > 1) {
        const data = sheet.getRange(2, 1, ultima - 1, width).getValues();
        for (let i = 0; i < data.length; i++) {
          if (String(data[i][c.pub] || '').trim() === id &&
              String(data[i][c.correo] || '').trim().toLowerCase() === quien.correo) { fila = i + 2; break; }
        }
      }

      if (fila > 0) {
        // Celda a celda: la fila puede tener columnas que este código no conoce.
        sheet.getRange(fila, c.opcion + 1).setValue(opcion);
        sheet.getRange(fila, c.fecha + 1).setValue(new Date());
      } else {
        const row = [];
        for (let i = 0; i < width; i++) row[i] = '';
        row[c.fecha] = new Date();
        row[c.pub] = id;
        row[c.correo] = quien.correo;
        row[c.opcion] = opcion;
        sheet.appendRow(row);
      }
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    secIntentosSumar_(limite, 3600);
    try { CacheService.getScriptCache().remove(pubClaveCacheVotos_(id)); } catch (e) {}

    // Se devuelve el recuento recién hecho: quien vota ve su voto contado en el acto, sin
    // una segunda llamada que además podría contestar con la caché de medio minuto.
    const recuento = pubContar_(id);
    return { status: 'ok', total: recuento.total, conteo: recuento.conteo, miVoto: opcion };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

/**
 * ¿Se acabó la votación?
 *
 * Por la fecha de cierre de la encuesta o porque la publicación ya expiró: una encuesta
 * que no se ve no se puede seguir contestando. El cierre es inclusivo de todo su día,
 * igual que "Hasta" en los anuncios, para que las dos fechas signifiquen lo mismo.
 */
function pubEncuestaCerrada_(encuesta, pub) {
  if (pub && pub.estado === 'expirado') return true;
  const cierre = String((encuesta && encuesta.cierre) || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cierre)) return false;
  const m = cierre.split('-');
  const fin = new Date(Number(m[0]), Number(m[1]) - 1, Number(m[2]), 23, 59, 59);
  return new Date() > fin;
}
