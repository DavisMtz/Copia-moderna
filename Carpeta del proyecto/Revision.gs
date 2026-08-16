/**
 * =================================================================================================
 * REVISIÓN DE COTIZACIONES | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Una cotización recién guardada NO está lista para salir al cliente: nace con el folio
 * creado y el estatus "En Revisión". Un usuario avanzado la abre en la pantalla de
 * revisión (?page=revision_cotizacion&folio=...), verifica artículo por artículo y la
 * APRUEBA o la RECHAZA con observaciones. Solo entonces se desbloquea el envío por correo.
 *
 * Qué vive aquí:
 *   · El estado de revisión de un folio (leerlo, escribirlo, y decidir si está aprobada).
 *   · El gate que usa Correos.gs para no dejar salir una cotización sin aprobar.
 *   · El aviso por correo al asesor cuando su cotización se aprueba o se rechaza.
 *   · La validación de las URLs de artículo antes de incrustarlas en un iframe.
 *
 * DEPENDENCIAS: Seguridad.gs (identidad y rol), Code.gs (hojas y getQuoteDetails),
 * Cache.gs (invalidación) y Correos.gs (MAIL_ALIAS). Todas se consultan con `typeof`
 * donde el módulo puede funcionar sin ellas, para que un despliegue parcial no lo tumbe.
 */

// --- Estatus del ciclo de vida de una cotización ------------------------------------------
// Se guardan en la columna "Estatus" de la hoja Cotizaciones. El resultado DURADERO de la
// revisión vive aparte, en "RevisionEstado", porque "Estatus" se sobrescribe al enviar el
// correo ("Enviada por Correo") y con él se perdería el rastro de quién aprobó qué.
const REV_ESTATUS_PENDIENTE = 'En Revisión';
const REV_ESTATUS_APROBADA  = 'Aprobada';
const REV_ESTATUS_RECHAZADA = 'Rechazada';
const REV_ESTATUS_ENVIADA   = 'Enviada por Correo';

/** Columnas que esta función agrega sola a la hoja "Cotizaciones" si no existen. */
const REV_COLS = {
  estado:    'RevisionEstado',
  por:       'RevisadoPor',
  nombre:    'RevisadoNombre',
  fecha:     'RevisionFecha',
  notas:     'RevisionNotas',
  checklist: 'RevisionChecklist'
};

/** Columna nueva de DetalleCotizaciones con el enlace al artículo (la aporta la extensión). */
const REV_COL_LINK_ARTICULO = 'LinkArticulo';

/**
 * Dominios cuyas páginas se pueden incrustar en la pantalla de revisión.
 * El enlace del artículo llega desde la extensión y acaba dentro de un `src` de iframe:
 * sin esta lista, una celda con `javascript:...` sería ejecución de código en la sesión
 * de quien revisa. Se compara el HOST EXACTO (o subdominio real), nunca con `includes`.
 */
const REV_HOSTS_ARTICULO = ['liverpool.com.mx', 'www.liverpool.com.mx'];

/**
 * Lista de verificación de RESPALDO.
 *
 * Lo normal es que los puntos los genere `audAuditar_` (AuditoriaCotizacion.gs) YA RESUELTOS:
 * el correo comprobado, los totales recalculados, el nombre del asesor contrastado. Esta lista
 * solo entra en juego si ese archivo no está en el proyecto, y entonces la pantalla se comporta
 * como antes —casillas que se palomean a mano—, que es mejor que quedarse sin revisión.
 *
 * El punto "El formato de la cotización es el que pidió el cliente" se retiró a propósito: el
 * formato ya se elige al capturar, se ve en la cabecera de esta misma pantalla y no había forma
 * de verificarlo salvo creyéndoselo. Una casilla que solo se puede contestar "sí" no verifica.
 */
const REV_CHECKLIST_GENERAL = [
  { id: 'cliente-nombre',   texto: 'El nombre del cliente está escrito correctamente' },
  { id: 'cliente-correo',   texto: 'El correo del cliente es una dirección válida' },
  { id: 'cliente-telefono', texto: 'El teléfono del cliente tiene 10 dígitos válidos' },
  { id: 'asesor',           texto: 'El asesor aparece con nombre y apellido, y su extensión es correcta' },
  { id: 'precios',          texto: 'Precios, promociones y descuentos coinciden con el sitio' },
  { id: 'totales',          texto: 'Subtotal, IVA y total general cuadran' }
];

// ─────────────────────────────────────────────────────────────────────────────────────────
// URLS
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve la URL del artículo solo si es segura de incrustar; si no, cadena vacía.
 * Regla: https, host exacto de la lista y nada de credenciales embebidas.
 * Apps Script no trae la clase `URL`, así que se descompone a mano — pero comparando el
 * host COMPLETO, no con `startsWith`/`includes` (que "https://evil.com/?x=liverpool.com.mx"
 * saltaría sin despeinarse).
 *
 * @param {string} url
 * @return {string} la URL saneada o ''.
 */
function revUrlArticuloSegura_(url) {
  const bruta = String(url == null ? '' : url).trim();
  if (!bruta) return '';

  const m = bruta.match(/^(https?):\/\/([^\/?#]+)([\/?#][\s\S]*)?$/i);
  if (!m) return '';
  if (m[1].toLowerCase() !== 'https') return '';

  let autoridad = m[2];
  // "usuario:clave@host" — nunca en un enlace nuestro; se descarta entero.
  if (autoridad.indexOf('@') > -1) return '';
  const host = autoridad.split(':')[0].toLowerCase();
  if (REV_HOSTS_ARTICULO.indexOf(host) === -1) return '';

  // Ni saltos de línea ni comillas: acabaría dentro de un atributo HTML.
  if (/[\s"'<>\\]/.test(bruta)) return '';
  if (bruta.length > 2000) return '';
  return bruta;
}

/**
 * Identificador de un Google Sheet a partir de cualquiera de sus URLs.
 * @return {{id:string, gid:string}} vacíos si la URL no es de Sheets.
 */
function revSheetId_(url) {
  const bruta = String(url == null ? '' : url).trim();
  const m = bruta.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9\-_]{20,})/);
  if (!m) return { id: '', gid: '' };
  const g = bruta.match(/[#&?]gid=([0-9]+)/);
  return { id: m[1], gid: g ? g[1] : '' };
}

/**
 * URL de un Google Sheet que SÍ se puede meter en un <iframe>.
 *
 * Aquí estaba la razón de que el recuadro saliera vacío: se usaba `/edit?rm=minimal&widget=true`,
 * que es la vista de EDICIÓN. Google la protege con `X-Frame-Options` y el navegador la bloquea
 * igual que bloquea la página de Liverpool — con el agravante de que a veces "funciona" en la
 * sesión del que la programó (misma cuenta, misma pestaña) y nunca para los demás.
 * `/preview` es la vista que Drive publica precisamente para incrustarse; es de solo lectura,
 * que además es lo correcto en una pantalla que audita un documento: aquí no se edita nada.
 *
 * @param {string} url URL guardada en LinkSheetCCL.
 * @return {string} URL para el iframe, o '' si no se reconoce.
 */
function revUrlEmbedSheet_(url) {
  const s = revSheetId_(url);
  if (!s.id) return '';
  return 'https://docs.google.com/spreadsheets/d/' + s.id + '/preview' +
         (s.gid ? '?gid=' + s.gid : '');
}

/**
 * URL absoluta de una pantalla de la app para un folio concreto.
 * La base NUNCA se escribe a mano: cambia entre despliegues y entre cuenta personal y
 * dominio Workspace. El folio se codifica; si trajera un espacio o un `&`, concatenarlo
 * en crudo partiría la query en dos.
 */
function revUrlDeFolio_(pagina, folio) {
  let base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (e) { base = ''; }
  if (!base) return '';
  return base + '?page=' + encodeURIComponent(pagina) +
         '&folio=' + encodeURIComponent(String(folio || ''));
}

/** URL de la pantalla de revisión (la que va en el webhook). */
function revUrlPantalla_(folio) { return revUrlDeFolio_('revision_cotizacion', folio); }

/** URL de la consulta de la cotización (la que va en el correo al asesor). */
function revUrlConsulta_(folio) { return revUrlDeFolio_('consulta_cotizacion', folio); }

// ─────────────────────────────────────────────────────────────────────────────────────────
// ACCESO A LA HOJA
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Garantiza que la hoja "Cotizaciones" tenga las columnas de revisión y devuelve los
 * encabezados ya actualizados. Auto-reparable, igual que "Formato" e "ImagenUrl": la hoja
 * de producción no necesita prepararse a mano antes de subir esta versión.
 */
function revAsegurarColumnas_(hoja) {
  let headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const faltantes = [];
  Object.keys(REV_COLS).forEach(function (k) {
    if (headers.indexOf(REV_COLS[k]) === -1) faltantes.push(REV_COLS[k]);
  });
  if (faltantes.length) {
    hoja.getRange(1, headers.length + 1, 1, faltantes.length).setValues([faltantes]);
    Logger.log('Revision.gs: columnas agregadas a Cotizaciones → ' + faltantes.join(', '));
    headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  }
  return headers;
}

/**
 * Lee el estado de revisión de un folio directo de la hoja (sin caché: lo usan los gates
 * que deciden si un correo puede salir, y ahí un dato de hace tres minutos no sirve).
 *
 * @param {string} folio
 * @return {{existe:boolean, estatus:string, estado:string, por:string, nombre:string,
 *           fecha:string, notas:string, aprobada:boolean}}
 */
function revEstadoDeFolio_(folio) {
  const vacio = { existe: false, estatus: '', estado: '', por: '', nombre: '', fecha: '',
                  notas: '', aprobada: false };
  try {
    const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COTIZACIONES_SHEET_NAME);
    if (!hoja) return vacio;

    const datos = hoja.getDataRange().getValues();
    if (datos.length < 2) return vacio;
    const headers = datos[0];
    const iFolio = headers.indexOf('Folio');
    if (iFolio === -1) return vacio;

    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][iFolio]) !== String(folio)) continue;
      const leer = function (nombreCol) {
        const idx = headers.indexOf(nombreCol);
        return idx > -1 ? datos[i][idx] : '';
      };
      const estado  = String(leer(REV_COLS.estado) || '');
      const estatus = String(leer('Estatus') || '');
      const fecha   = leer(REV_COLS.fecha);
      return {
        existe: true,
        estatus: estatus,
        estado: estado,
        por: String(leer(REV_COLS.por) || ''),
        nombre: String(leer(REV_COLS.nombre) || ''),
        fecha: (fecha instanceof Date) ? fecha.toISOString() : String(fecha || ''),
        notas: String(leer(REV_COLS.notas) || ''),
        // La verdad la manda RevisionEstado. "Estatus" solo se consulta para las
        // cotizaciones ANTERIORES a esta versión, que ya se habían enviado al cliente:
        // bloquearlas ahora sería romper trabajo terminado.
        aprobada: estado
          ? (estado === REV_ESTATUS_APROBADA)
          : (estatus === REV_ESTATUS_APROBADA || estatus === REV_ESTATUS_ENVIADA)
      };
    }
    return vacio;
  } catch (e) {
    Logger.log('revEstadoDeFolio_ falló para ' + folio + ': ' + e.message);
    return vacio;
  }
}

/**
 * Puerta que usa Correos.gs antes de enviar una cotización al cliente.
 * @return {{ok:boolean, message:string}}
 */
function revPuedeEnviarse_(folio) {
  const est = revEstadoDeFolio_(folio);
  if (!est.existe) {
    return { ok: false, message: 'No se encontró la cotización ' + folio + '.' };
  }
  if (est.aprobada) return { ok: true, message: '' };

  // Un RECHAZO es una decisión que tomó una persona mirando el documento. Apagar la
  // revisión en el panel afloja la regla general; no borra ese "no". Si de verdad hay que
  // enviarla, el asesor corrige y vuelve a guardar, y entonces la política decide de nuevo.
  if (est.estado === REV_ESTATUS_RECHAZADA) {
    return { ok: false, message: 'Esta cotización fue RECHAZADA en la revisión' +
      (est.nombre ? ' por ' + est.nombre : '') + '. Corrígela y pídela de nuevo a revisión antes de enviarla.' };
  }

  // La revisión pudo apagarse DESPUÉS de que este folio entrara a la cola. Sería absurdo
  // dejarlo atrapado esperando a un revisor que ya no existe: si supervisión desactivó la
  // revisión, lo que estaba en la cola también sale.
  try {
    if (typeof revpolLeer_ === 'function' && revpolLeer_().exigirRevision === false) {
      return { ok: true, message: '' };
    }
  } catch (e) {
    Logger.log('revPuedeEnviarse_: no se pudo leer la política (' + e.message + '); se exige revisión.');
  }

  return { ok: false, message: 'Esta cotización todavía está EN REVISIÓN. Un usuario avanzado debe aprobarla antes de que se pueda enviar al cliente.' };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// COLA DE REVISIÓN PARA QUIEN SOLO PUEDE REVISAR
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * ¿Por qué esta función existiendo ya getSupervisionQuotes?
 *
 * Porque son dos permisos distintos y hasta ahora compartían puerta. La cola de
 * pendientes se alimentaba de getSupervisionQuotes, que exige el bloque "supervision";
 * así que a quien se le concedía SOLO "revisar" —justo el caso de un asesor al que se
 * le da la facultad de aprobar— se le quedaba el permiso sin ninguna pantalla desde la
 * que ejercerlo: podía abrir un folio concreto por enlace, pero no había forma de saber
 * cuáles esperaban.
 *
 * La diferencia con getSupervisionQuotes no es solo el candado: esto devuelve
 * ÚNICAMENTE las cotizaciones pendientes y solo los campos de la cola. Quien puede
 * revisar necesita saber qué hay por revisar; no necesita el historial completo del
 * equipo ni los importes de lo ya cerrado. El permiso más pequeño trae el dato más
 * pequeño que lo hace útil.
 *
 * @param {string} email Correo de la sesión del Portal (AppSession.userEmail).
 * @return {{success:boolean, quotes:Array, message:string}}
 */
function revListaPendientes(email) {
  try {
    const id = secIdentidadConBloque_(email, 'revisar');
    if (!id.ok) {
      return { success: false, quotes: [], message: id.error || 'No tienes permiso para revisar cotizaciones.' };
    }

    if (typeof leerSupervision_ !== 'function') {
      return { success: false, quotes: [], message: 'No se pudo leer la hoja de cotizaciones.' };
    }
    const datos = leerSupervision_();
    if (!datos || !datos.success) {
      return { success: false, quotes: [],
               message: (datos && datos.message) || 'No se pudieron leer las cotizaciones.' };
    }

    const pendientes = (datos.quotes || [])
      .filter(function (q) { return revEsPendiente_(q.status, q.revisionEstado); })
      .map(function (q) {
        return {
          folio: q.folio,
          timestamp: q.timestamp,
          advisorName: q.advisorName,
          clientName: q.clientName,
          total: q.total,
          status: q.status,
          revisionEstado: q.revisionEstado
        };
      });

    return { success: true, quotes: pendientes, message: '' };
  } catch (e) {
    Logger.log('revListaPendientes error: ' + e);
    return { success: false, quotes: [], message: 'No pudimos cargar la cola de revisión.' };
  }
}

/**
 * CUÁNTAS cotizaciones siguen esperando revisión. Es el número de la isla de
 * notificaciones (F2): viaja dentro de opEstadoSesion para quien tiene el bloque
 * 'revisar', y esta puerta existe aparte por si alguna pantalla necesita SOLO el
 * conteo sin cargar el estado de operación completo.
 *
 * Mismo criterio que revListaPendientes (revEsPendiente_), para que el número del
 * óvalo y la cola del panel digan siempre lo mismo.
 *
 * @param {string} email Correo de la sesión del Portal (AppSession.userEmail).
 * @return {{success:boolean, pendientes:number, message:string}}
 */
function revContarPendientes(email) {
  try {
    const id = secIdentidadConBloque_(email, 'revisar');
    if (!id.ok) {
      return { success: false, pendientes: 0, message: id.error || 'No tienes permiso para revisar cotizaciones.' };
    }
    const n = revConteoPendientes_();
    if (n < 0) return { success: false, pendientes: 0, message: 'No se pudieron leer las cotizaciones.' };
    return { success: true, pendientes: n, message: '' };
  } catch (e) {
    Logger.log('revContarPendientes error: ' + e);
    return { success: false, pendientes: 0, message: 'No pudimos contar la cola de revisión.' };
  }
}

/**
 * El número solo, SIN gate: los llamadores (revContarPendientes y opEstadoSesion) ya
 * comprobaron el bloque antes de llegar aquí. Devuelve -1 si la hoja no se pudo leer,
 * para que quien llama distinga "cero pendientes" de "no se sabe".
 *
 * Caché en dos capas, ninguna nueva:
 *   · La lista sale de la MISMA entrada compartida que usa el panel de supervisión
 *     ('supervision', Cache.gs), así que contar no añade lecturas de hoja.
 *   · El conteo se guarda aparte con la generación de la BD en la clave (patrón
 *     opCacheado_): guardar una revisión o una cotización llama a cotInvalidarCache_,
 *     la generación cambia y la siguiente consulta recuenta. El TTL es solo red de
 *     seguridad por si alguien edita la hoja a mano.
 */
function revConteoPendientes_() {
  const clave = 'rev_pend_g' + (typeof cotGeneracion_ === 'function' ? cotGeneracion_() : '0');
  try {
    const cache = CacheService.getScriptCache();
    const hit = cache.get(clave);
    if (hit !== null) return parseInt(hit, 10) || 0;
    const n = revCalcularPendientes_();
    if (n >= 0) cache.put(clave, String(n), 300);
    return n;
  } catch (e) {
    return revCalcularPendientes_();
  }
}

/** Cuenta de verdad, sobre la lectura (cacheada) del panel de supervisión. */
function revCalcularPendientes_() {
  if (typeof leerSupervision_ !== 'function') return -1;
  const datos = (typeof cotCacheado_ === 'function')
    ? cotCacheado_('supervision', COT_TTL.supervision, function () { return leerSupervision_(); })
    : leerSupervision_();
  if (!datos || !datos.success) return -1;
  return (datos.quotes || []).filter(function (q) {
    return revEsPendiente_(q.status, q.revisionEstado);
  }).length;
}

/** "En Revisión", "en revision" y "EN  REVISIÓN" son el mismo estado. */
function revClaveEstado_(valor) {
  return String(valor == null ? '' : valor)
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase().trim().replace(/\s+/g, '-');
}

/* Estados que el sistema reconoce, y de ellos los que siguen esperando a una persona.
   Es el mismo criterio que app_estatus.html usa en el cliente; si allí se añade un
   estado, aquí también. Duplicarlo es feo, pero la alternativa —que el servidor mande
   todo y filtre el navegador— significaría entregarle el historial completo a quien
   solo puede revisar. */
const REV_ESTADOS_CONOCIDOS = ['en-revision', 'folio-generado', 'pendiente',
                               'aprobada', 'autorizada', 'rechazada', 'enviada-por-correo'];
const REV_ESTADOS_PENDIENTES = ['en-revision', 'folio-generado', 'pendiente'];

/** ¿Este folio sigue esperando a que alguien lo apruebe o lo rechace? */
function revEsPendiente_(estatus, revisionEstado) {
  const k = revClaveEstado_(estatus);
  // Una cotización ya ENVIADA está cerrada, diga lo que diga la columna de revisión.
  if (k === 'enviada-por-correo') return false;
  const kRev = revClaveEstado_(revisionEstado);
  const elegida = REV_ESTADOS_CONOCIDOS.indexOf(kRev) !== -1 ? kRev : k;
  return REV_ESTADOS_PENDIENTES.indexOf(elegida) !== -1;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// LECTURA PARA LA PANTALLA DE REVISIÓN
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Todo lo que necesita `revision_cotizacion.html` en UNA sola llamada.
 * Sin caché a propósito: es la pantalla donde se decide si un documento sale al cliente;
 * revisar una versión de hace tres minutos es exactamente lo que no debe pasar.
 *
 * @param {string} folio
 * @param {string} email Correo de la sesión del Portal (AppSession.userEmail).
 */
function getRevisionCotizacion(folio, email) {
  try {
    if (!folio) return { success: false, message: 'Falta el folio de la cotización.' };

    const id = secIdentidadConBloque_(email, 'revisar');
    if (!id.ok) {
      return { success: false, sinPermiso: true,
               message: id.error || 'Solo un usuario avanzado puede revisar cotizaciones.' };
    }

    // SIN CACHÉ a propósito: `getQuoteDetails` pasa por Cache.gs (3 min) y esta es la
    // pantalla donde se decide si un documento sale al cliente. Revisar y aprobar una
    // versión de hace tres minutos —la de antes de que el asesor corrigiera un precio—
    // es exactamente lo que este flujo existe para impedir. Se lee la hoja directamente.
    const det = (typeof leerDetalleCotizacion_ === 'function')
      ? leerDetalleCotizacion_(folio)
      : cotDetalleFolio_(folio);
    if (!det.success) return { success: false, message: det.message || 'Cotización no encontrada.' };

    const quote = det.quote;
    const estado = revEstadoDeFolio_(folio);

    // El enlace de cada artículo se sanea AQUÍ, no en el cliente: lo que llega a la
    // pantalla ya es incrustable o viene vacío, y no hay una segunda oportunidad de
    // colar un esquema raro por el camino.
    const productos = (quote.products || []).map(function (p, i) {
      const seguro = revUrlArticuloSegura_(p.productUrl || '');
      return {
        indice: i,
        sku: p.sku || '',
        description: p.description || '',
        quantity: p.quantity || 0,
        unitPrice: p.unitPrice || 0,
        costPaymentUnique: p.costPaymentUnique || 0,
        discountPublicPercent: p.discountPublicPercent || 0,
        additionalDiscountApplied: p.additionalDiscountApplied || 'No',
        additionalDiscountPercent: p.additionalDiscountPercent || 0,
        imageUrl: p.imageUrl || '',
        productUrl: seguro,
        // Se distingue "no traía enlace" de "traía uno que no se puede abrir aquí":
        // lo primero es una cotización vieja; lo segundo, algo que hay que mirar.
        urlDescartada: !seguro && !!String(p.productUrl || '').trim()
      };
    });

    // La auditoría se hace sobre los productos YA SANEADOS: si una URL se descartó por no ser
    // de liverpool.com.mx, ese artículo cuenta como capturado a mano —que es la verdad, porque
    // no hay página que consultar— y no como importado con enlace bueno.
    const auditoria = revAuditar_(quote, productos);

    return {
      success: true,
      revisor: { email: id.email, nombre: id.nombre },
      quote: {
        folio: quote.folio,
        timestamp: quote.timestamp,
        advisorName: quote.advisorName,
        advisorEmail: quote.advisorEmail,
        advisorExt: quote.advisorExt,
        clientName: quote.clientName,
        clientEmail: quote.clientEmail,
        clientPhone: quote.clientPhone,
        summarySubtotal: quote.summarySubtotal,
        summaryVat: quote.summaryVat,
        summaryTotal: quote.summaryTotal,
        observations: quote.observations,
        format: quote.format,
        status: quote.status,
        driveLink: quote.driveLink || ''
      },
      products: productos,
      sheetEmbedUrl: revUrlEmbedSheet_(quote.cclSheetLink || ''),
      sheetUrl: String(quote.cclSheetLink || ''),
      hojaIncrustable: !!revSheetId_(quote.cclSheetLink || '').id,
      // Los puntos llegan YA RESUELTOS por el motor de auditoría: la pantalla los pinta,
      // no los calcula. Ese es el motivo de que sea el servidor quien los produzca — el
      // cliente puede decir que todo está bien, y al guardar se vuelven a calcular aquí.
      checklistGeneral: auditoria.puntos,
      auditoria: auditoria,
      revision: {
        estado: estado.estado,
        por: estado.por,
        nombre: estado.nombre,
        fecha: estado.fecha,
        notas: estado.notas,
        aprobada: estado.aprobada
      }
    };
  } catch (error) {
    Logger.log('getRevisionCotizacion falló: ' + error.message + ' Stack: ' + error.stack);
    return { success: false, message: 'No pudimos abrir la revisión. Inténtalo de nuevo en un momento.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// ESCRITURA DE LA DECISIÓN
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Cierra la revisión de una cotización: la aprueba o la rechaza.
 *
 * @param {{folio:string, email:string, decision:string, notas:string, checklist:object}} payload
 * @return {{success:boolean, message:string, revision?:object, avisoCorreo?:string}}
 */
function guardarRevisionCotizacion(payload) {
  const p = payload || {};
  try {
    const folio = String(p.folio || '').trim();
    if (!folio) return { success: false, message: 'Falta el folio de la cotización.' };

    const id = secIdentidadConBloque_(p.email, 'revisar');
    if (!id.ok) {
      return { success: false, sinPermiso: true,
               message: id.error || 'Solo un usuario avanzado puede cerrar una revisión.' };
    }

    const decision = String(p.decision || '').trim().toLowerCase();
    if (decision !== 'aprobada' && decision !== 'rechazada') {
      return { success: false, message: 'La decisión debe ser "aprobada" o "rechazada".' };
    }

    const notas = String(p.notas || '').trim();
    // Rechazar sin decir por qué deja al asesor sin nada que corregir: el correo que
    // recibiría sería un "no" a secas.
    if (decision === 'rechazada' && notas.length < 10) {
      return { success: false, message: 'Para rechazar hay que escribir la observación de qué se debe corregir (mínimo 10 caracteres).' };
    }
    if (notas.length > 4000) {
      return { success: false, message: 'Las observaciones son demasiado largas (máximo 4000 caracteres).' };
    }

    const nuevoEstado = (decision === 'aprobada') ? REV_ESTATUS_APROBADA : REV_ESTATUS_RECHAZADA;
    const ahora = new Date();

    /*
     * La auditoría se REHACE aquí, con los datos de la hoja y no con los que mande la pantalla.
     * Es la misma razón por la que el gate de envío vive en el servidor: el cliente puede
     * llamar a esta función desde la consola del navegador con el dictamen que se le antoje.
     * Lo que se escribe en la hoja —y lo que se exige para aprobar— sale de este cálculo.
     */
    let auditoria = null;
    try {
      const previo = (typeof leerDetalleCotizacion_ === 'function')
        ? leerDetalleCotizacion_(folio) : cotDetalleFolio_(folio);
      if (previo.success) {
        auditoria = revAuditar_(previo.quote, previo.quote.products || []);
        if (p.verificaciones && typeof audAplicarPreciosEnVivo_ === 'function') {
          auditoria = audAplicarPreciosEnVivo_(auditoria, p.verificaciones);
        }
      }
    } catch (e) {
      Logger.log('guardarRevisionCotizacion: no se pudo auditar ' + folio + ' (' + e.message + ').');
    }

    // Aprobar con comprobaciones falladas se PUEDE —hay casos legítimos: una razón social que
    // parece mal escrita, un precio que cambió después de cotizar y ya se habló con el cliente—
    // pero no en silencio. Queda por escrito quién lo aprobó, con qué falla y por qué.
    if (auditoria && auditoria.criticas && auditoria.criticas.length &&
        decision === 'aprobada' && notas.length < 10) {
      return {
        success: false,
        requiereJustificacion: true,
        criticas: auditoria.criticas,
        message: 'La verificación automática encontró ' + auditoria.criticas.length +
                 ' problema(s): ' + auditoria.criticas.join(' · ') +
                 ' Si aun así hay que aprobarla, escribe en las observaciones por qué (mínimo 10 caracteres).'
      };
    }

    // Candado: dos supervisores abriendo el mismo folio a la vez escribirían encima el
    // uno del otro y el correo al asesor diría una cosa distinta de lo que quedó en la hoja.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) {
      return { success: false, message: 'El sistema está ocupado guardando otra revisión. Intenta de nuevo en unos segundos.' };
    }

    let quote = null;
    try {
      const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COTIZACIONES_SHEET_NAME);
      if (!hoja) throw new Error('Hoja "' + COTIZACIONES_SHEET_NAME + '" no encontrada.');

      const headers = revAsegurarColumnas_(hoja);
      const iFolio = headers.indexOf('Folio');
      if (iFolio === -1) throw new Error('Columna "Folio" no encontrada en Cotizaciones.');

      const datos = hoja.getDataRange().getValues();
      let fila = -1;
      for (let i = 1; i < datos.length; i++) {
        if (String(datos[i][iFolio]) === folio) { fila = i + 1; break; }
      }
      if (fila === -1) throw new Error('No se encontró la cotización ' + folio + '.');

      const escribir = function (nombreCol, valor) {
        const idx = headers.indexOf(nombreCol);
        if (idx > -1) hoja.getRange(fila, idx + 1).setValue(valor);
      };

      escribir(REV_COLS.estado,    nuevoEstado);
      escribir(REV_COLS.por,       id.email);
      escribir(REV_COLS.nombre,    id.nombre || id.email);
      escribir(REV_COLS.fecha,     ahora);
      escribir(REV_COLS.notas,     notas);
      escribir(REV_COLS.checklist, revChecklistTexto_(p.checklist, auditoria));
      // El estatus visible del panel también cambia, para que la lista de cotizaciones
      // diga en qué punto está sin abrir el folio.
      escribir('Estatus',          nuevoEstado);
    } finally {
      lock.releaseLock();
    }

    // La hoja cambió: sin esto el panel y la consulta seguirían mostrando "En Revisión"
    // hasta que caducara la caché de lectura.
    if (typeof cotInvalidarCache_ === 'function') cotInvalidarCache_();

    // El aviso al asesor va DESPUÉS de que la hoja ya quedó escrita y fuera del candado:
    // si Gmail falla, la revisión no se pierde, solo el correo.
    let avisoCorreo = '';
    try {
      const det = cotDetalleFolio_(folio);
      quote = det.success ? det.quote : null;
      avisoCorreo = revNotificarAsesor_(quote, folio, nuevoEstado, id, notas, ahora);
    } catch (e) {
      Logger.log('No se pudo avisar al asesor de la revisión de ' + folio + ': ' + e.message);
      avisoCorreo = 'La revisión quedó guardada, pero no se pudo enviar el aviso por correo al asesor (' + e.message + ').';
    }

    return {
      success: true,
      message: (nuevoEstado === REV_ESTATUS_APROBADA)
        ? 'Cotización aprobada. El envío por correo ya está desbloqueado.'
        : 'Cotización rechazada. Se avisó al asesor con tus observaciones.',
      avisoCorreo: avisoCorreo,
      revision: {
        estado: nuevoEstado,
        por: id.email,
        nombre: id.nombre || id.email,
        fecha: ahora.toISOString(),
        notas: notas,
        aprobada: nuevoEstado === REV_ESTATUS_APROBADA
      }
    };
  } catch (error) {
    Logger.log('guardarRevisionCotizacion falló: ' + error.message + ' Stack: ' + error.stack);
    return { success: false, message: 'No pudimos guardar la revisión. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * Serializa la lista de verificación a algo legible EN LA HOJA. Un JSON crudo en una celda
 * no lo lee nadie; una lista de "✔ punto" sí, y es lo que se consulta cuando alguien
 * pregunta meses después qué se verificó.
 */
function revChecklistTexto_(checklist, auditoria) {
  const c = checklist || {};
  const lineas = [];
  try {
    // El dictamen automático va PRIMERO y con el veredicto del servidor, no con la palomita
    // que mandó la pantalla: es lo que contesta, meses después, "¿esto se revisó de verdad?".
    if (auditoria && auditoria.puntos) {
      if (auditoria.score != null) {
        lineas.push('Índice de confianza de la verificación automática: ' + auditoria.score + '/100');
      }
      const simbolo = { ok: '✔', atencion: '⚠', mal: '✖', manual: '○', pendiente: '…' };
      auditoria.puntos.forEach(function (pt) {
        lineas.push((simbolo[pt.estado] || '·') + ' ' + String(pt.texto || pt.id || '') +
          (pt.detalle ? ' — ' + pt.detalle : ''));
      });
      lineas.push('— Confirmado por quien revisó:');
    }

    (c.general || []).forEach(function (item) {
      lineas.push((item.ok ? '✔ ' : '✖ ') + String(item.texto || item.id || ''));
    });
    const arts = c.articulos || [];
    const verificados = arts.filter(function (a) { return a && a.ok; }).length;
    if (arts.length) {
      lineas.push('— Artículos verificados: ' + verificados + ' de ' + arts.length);
      arts.forEach(function (a) {
        lineas.push('   ' + (a.ok ? '✔' : '✖') + ' ' + String(a.sku || '') + ' · ' + String(a.description || ''));
      });
    }
  } catch (e) {
    return '(no se pudo leer la lista de verificación)';
  }
  const texto = lineas.join('\n');
  // Una celda de Sheets aguanta 50 000 caracteres; se recorta muy por debajo para no
  // convertir la hoja en un volcado.
  return texto.length > 8000 ? texto.slice(0, 8000) + '\n…(recortado)' : texto;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// AVISO AL ASESOR
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Avisa por correo al asesor dueño de la cotización del resultado de la revisión:
 * qué se decidió, quién lo decidió y con qué notas.
 *
 * @return {string} '' si salió bien, o el motivo por el que no se pudo enviar.
 */
function revNotificarAsesor_(quote, folio, estado, revisor, notas, fecha) {
  const para = quote && quote.advisorEmail ? String(quote.advisorEmail).trim() : '';
  if (!para) return 'La cotización no tiene correo de asesor registrado: no se envió aviso.';

  const aprobada = (estado === REV_ESTATUS_APROBADA);
  const asunto = (aprobada ? '✅ Cotización aprobada · ' : '⚠️ Cotización rechazada · ') + folio;
  const urlConsulta = revUrlConsulta_(folio);

  const html = revPlantillaAviso_({
    aprobada: aprobada,
    folio: folio,
    cliente: quote.clientName || '',
    total: quote.summaryTotal,
    revisorNombre: revisor.nombre || revisor.email,
    revisorEmail: revisor.email,
    fecha: fecha,
    notas: notas,
    url: urlConsulta
  });

  const plano = (aprobada
      ? 'Tu cotización ' + folio + ' fue APROBADA.'
      : 'Tu cotización ' + folio + ' fue RECHAZADA.') +
    '\nRevisó: ' + (revisor.nombre || revisor.email) + ' (' + revisor.email + ')' +
    '\nFecha: ' + Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') +
    (notas ? '\nObservaciones: ' + notas : '') +
    (urlConsulta ? '\n\nVer la cotización: ' + urlConsulta : '');

  const opciones = { htmlBody: html, name: 'Sistema de cotizaciones Ventel' };
  // Copia oculta global (T9.6). Este aviso cuenta que una cotización se aprobó o se rechazó y
  // con qué observaciones: es justo lo que se querrá poder releer cuando alguien pregunte por
  // qué salió o por qué no. Con typeof porque Correos.gs podría no estar desplegado.
  if (typeof correoAplicarCco_ === 'function') correoAplicarCco_(opciones, [para]);

  let alias = false;
  try {
    alias = GmailApp.getAliases().indexOf(mailAlias_()) !== -1;
  } catch (e) {
    Logger.log('revNotificarAsesor_: sin acceso a los alias de Gmail: ' + e.message);
  }
  if (alias) {
    try {
      GmailApp.sendEmail(para, asunto, plano, Object.assign({}, opciones, { from: mailAlias_() }));
      Logger.log('Aviso de revisión enviado a ' + para + ' para ' + folio);
      return '';
    } catch (e) {
      Logger.log('revNotificarAsesor_: falló con alias, se reintenta por la vía clásica: ' + e.message);
    }
  }
  MailApp.sendEmail(para, asunto, plano, opciones);
  Logger.log('Aviso de revisión enviado (sin alias) a ' + para + ' para ' + folio);
  return '';
}

/** Cuerpo HTML del aviso. Tabla de 560 px y estilos en línea: es lo único que sobrevive a Outlook. */
function revPlantillaAviso_(o) {
  const acento = o.aprobada ? '#0F7B47' : '#B4451F';
  const fondo  = o.aprobada ? '#E7F6EE' : '#FDEDE6';
  const titulo = o.aprobada ? 'Tu cotización fue aprobada' : 'Tu cotización necesita correcciones';
  const bajada = o.aprobada
    ? 'Ya puedes enviarla al cliente desde el sistema.'
    : 'No se envió al cliente. Corrige lo señalado y vuelve a pedir la revisión.';
  const esc = secEscapeHtml_;
  const fechaTxt = Utilities.formatDate(o.fecha, Session.getScriptTimeZone(), "dd/MM/yyyy 'a las' HH:mm");
  const totalTxt = (typeof formatCurrencyGS === 'function')
    ? formatCurrencyGS(o.total)
    : '$' + Number(o.total || 0).toFixed(2);

  return '' +
  '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>' + esc(titulo) + '</title></head>' +
  '<body style="margin:0;padding:24px 12px;background:#F4F5F7;">' +
  '<table cellpadding="0" cellspacing="0" border="0" role="presentation" ' +
    'style="width:100%;max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E7EC;' +
    'border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1B2330;">' +

    '<tr><td style="background:#E10098;padding:18px 24px;">' +
      '<div style="color:#FFFFFF;font-size:13px;letter-spacing:.08em;text-transform:uppercase;">Sistema de cotizaciones Ventel</div>' +
      '<div style="color:#FFFFFF;font-size:19px;font-weight:bold;margin-top:4px;">Resultado de la revisión</div>' +
    '</td></tr>' +

    '<tr><td style="padding:24px;">' +
      '<div style="background:' + fondo + ';border-left:4px solid ' + acento + ';border-radius:8px;padding:14px 16px;">' +
        '<div style="color:' + acento + ';font-size:17px;font-weight:bold;">' + esc(titulo) + '</div>' +
        '<div style="color:#3C4655;font-size:14px;line-height:1.5;margin-top:4px;">' + esc(bajada) + '</div>' +
      '</div>' +

      '<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;margin-top:20px;font-size:14px;">' +
        '<tr><td style="color:#5B6572;padding:6px 0;width:34%;">Folio</td>' +
            '<td style="padding:6px 0;font-weight:bold;">' + esc(o.folio) + '</td></tr>' +
        '<tr><td style="color:#5B6572;padding:6px 0;">Cliente</td>' +
            '<td style="padding:6px 0;">' + esc(o.cliente || 'N/A') + '</td></tr>' +
        '<tr><td style="color:#5B6572;padding:6px 0;">Total</td>' +
            '<td style="padding:6px 0;">' + esc(totalTxt) + '</td></tr>' +
        '<tr><td style="color:#5B6572;padding:6px 0;">Revisó</td>' +
            '<td style="padding:6px 0;">' + esc(o.revisorNombre) +
              '<br><span style="color:#5B6572;font-size:12px;">' + esc(o.revisorEmail) + '</span></td></tr>' +
        '<tr><td style="color:#5B6572;padding:6px 0;">Fecha</td>' +
            '<td style="padding:6px 0;">' + esc(fechaTxt) + '</td></tr>' +
      '</table>' +

      (o.notas
        ? '<div style="margin-top:20px;">' +
            '<div style="color:#5B6572;font-size:12px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">Observaciones de la revisión</div>' +
            '<div style="background:#F7F8FA;border:1px solid #E4E7EC;border-radius:8px;padding:14px 16px;' +
              'font-size:14px;line-height:1.6;white-space:pre-wrap;">' + esc(o.notas) + '</div>' +
          '</div>'
        : '') +

      (o.url
        ? '<div style="margin-top:24px;">' +
            '<a href="' + esc(o.url) + '" style="display:inline-block;background:#E10098;color:#FFFFFF;' +
              'text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:8px;">' +
              'Abrir la cotización</a>' +
          '</div>'
        : '') +
    '</td></tr>' +

    '<tr><td style="border-top:1px solid #E4E7EC;padding:16px 24px;color:#5B6572;font-size:11px;line-height:1.5;">' +
      'Mensaje automático del Sistema de cotizaciones Ventel. No respondas a este correo: ' +
      'escribe directamente a quien revisó tu cotización.' +
    '</td></tr>' +

  '</table></body></html>';
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// FICHA EN VIVO DEL ARTÍCULO
// ─────────────────────────────────────────────────────────────────────────────────────────
/*
 * POR QUÉ ESTO EXISTE — el recuadro en blanco de la pantalla de revisión.
 *
 * La página del artículo se abría dentro de un <iframe>. NUNCA va a cargar: liverpool.com.mx
 * responde con
 *     X-Frame-Options: SAMEORIGIN
 *     Content-Security-Policy: frame-ancestors https://gcp-na-app.contentstack.com
 * y esas dos cabeceras las aplica el NAVEGADOR. No hay atributo de iframe, sandbox, referrer
 * ni truco de cliente que las levante: mientras la app viva en script.google.com, el recuadro
 * seguirá en blanco. Por eso "Abrir en pestaña" sí funciona y el iframe no.
 *
 * La salida no es insistir con el iframe, es traer el dato DESDE EL SERVIDOR. UrlFetchApp no
 * es un navegador y esas cabeceras no le aplican: pide la página, y de su HTML se extrae lo
 * único que la revisión necesita comparar —nombre, imagen, precio con promoción y precio de
 * lista— para pintarlo al lado de lo que dice la cotización. Acaba siendo MEJOR que el iframe:
 * el supervisor ve los dos precios enfrentados y la diferencia calculada, en vez de tener que
 * buscarla a ojo dentro de una página llena de banners.
 *
 * Si Liverpool cambia su maquetación o su protección anti-bot bloquea la petición, esto
 * devuelve ok:false con un motivo legible y la pantalla cae al mensaje de "ábrelo en pestaña".
 * Nunca rompe la revisión.
 */

/** La ficha se cachea: dos supervisores mirando el mismo folio no piden dos veces la página. */
const REV_FICHA_TTL = 900;   // 15 min · lo justo para que un cambio de precio del día se vea

/** Cabeceras de una petición de navegador normal. Sin esto, muchos CDN devuelven un 403. */
const REV_FICHA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
};

/** Subdominios de imagen de Liverpool, en el mismo orden que usa Correos.gs. */
const REV_IMG_SUBDOMINIOS = ['ss571', 'sm571', 'sp514'];

/**
 * Trae la ficha actual del artículo en liverpool.com.mx para compararla con la cotización.
 *
 * @param {string} url  Enlace del artículo (se vuelve a validar aquí: nunca se confía en el cliente).
 * @param {string} sku  SKU de la cotización; solo se usa para la imagen de respaldo.
 * @param {string} email Correo de la sesión del Portal. Evita que la función quede como
 *                       relay de descargas abierto a cualquiera que sepa su nombre.
 * @return {{ok:boolean, motivo?:string, titulo?:string, imagen?:string, precio?:number,
 *           precioLista?:number, marca?:string, url?:string, capturada?:string}}
 */
function revFichaArticulo(url, sku, email) {
  try {
    const id = secIdentidadConBloque_(email, 'revisar');
    if (!id.ok) {
      return { ok: false, motivo: 'sin-permiso',
               mensaje: 'Solo un usuario avanzado puede consultar la ficha del artículo.' };
    }
    return revFichaDeUrl_(url, sku);
  } catch (error) {
    Logger.log('revFichaArticulo falló: ' + error.message + ' Stack: ' + error.stack);
    return { ok: false, motivo: 'error', mensaje: 'No se pudo leer la ficha: ' + error.message };
  }
}

/**
 * La lectura de la ficha SIN el control de permiso, para que la pueda reusar la verificación
 * en lote (que ya comprobó el permiso una vez, y no tiene sentido volver a leer la hoja de
 * Registros una vez por artículo).
 */
function revFichaDeUrl_(url, sku) {
  try {
    const limpia = revUrlArticuloSegura_(url);
    if (!limpia) {
      return { ok: false, motivo: 'url-invalida',
               mensaje: 'El enlace guardado no es una dirección de liverpool.com.mx.' };
    }

    const clave = 'rev-ficha-' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, limpia));

    let cache = null;
    try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
    if (cache) {
      const guardada = cache.get(clave);
      if (guardada) {
        try {
          const previa = JSON.parse(guardada);
          previa.deCache = true;
          return previa;
        } catch (e) { /* caché corrupta: se vuelve a pedir */ }
      }
    }

    let resp;
    try {
      resp = UrlFetchApp.fetch(limpia, {
        method: 'get',
        headers: REV_FICHA_HEADERS,
        muteHttpExceptions: true,
        followRedirects: true,
        validateHttpsCertificates: true
      });
    } catch (e) {
      return { ok: false, motivo: 'sin-red', url: limpia,
               mensaje: 'No se pudo contactar a liverpool.com.mx (' + e.message + ').' };
    }

    const codigo = resp.getResponseCode();
    if (codigo !== 200) {
      // 403 casi siempre = protección anti-bot; 404 = el artículo dejó de existir, que es
      // un hallazgo de revisión por sí mismo y hay que decirlo con esas palabras.
      return {
        ok: false,
        motivo: codigo === 404 ? 'no-existe' : 'bloqueado',
        codigo: codigo,
        url: limpia,
        imagenRespaldo: revImagenPorSku_(sku),
        mensaje: codigo === 404
          ? 'Liverpool responde que este artículo ya no existe en su sitio (404). Verifícalo antes de aprobar.'
          : 'Liverpool rechazó la consulta automática (código ' + codigo + '). Ábrelo en una pestaña para compararlo.'
      };
    }

    const ficha = revExtraerFicha_(resp.getContentText(), limpia);
    ficha.url = limpia;
    if (!ficha.imagen) ficha.imagen = revImagenPorSku_(sku);
    ficha.capturada = new Date().toISOString();

    if (!ficha.ok) {
      ficha.imagenRespaldo = ficha.imagen;
      return ficha;   // sin cachear: un fallo de lectura no merece quedarse 15 min
    }

    if (cache) {
      try { cache.put(clave, JSON.stringify(ficha), REV_FICHA_TTL); } catch (e) {}
    }
    return ficha;
  } catch (error) {
    Logger.log('revFichaDeUrl_ falló: ' + error.message + ' Stack: ' + error.stack);
    return { ok: false, motivo: 'error', mensaje: 'No se pudo leer la ficha: ' + error.message };
  }
}

/**
 * Saca de la página del artículo lo poco que hace falta para revisarla.
 *
 * La página es Next.js renderizada en servidor, así que TODO lo que interesa ya viene en el
 * HTML. Se leen dos fuentes distintas a propósito:
 *   · las <meta> og:* para el nombre y la imagen — es la parte del HTML que menos cambia;
 *   · el bloque `data-testid="…-configurator-price"` para los precios, con
 *     `data-testid="discounted"` (lo que se paga) y `data-testid="original"` (precio de lista).
 * Si Liverpool rediseña y los testid desaparecen, se devuelve ok:false en vez de un precio
 * inventado: en una pantalla que autoriza documentos, un dato dudoso es peor que ninguno.
 *
 * @param {string} html
 * @param {string} url
 */
function revExtraerFicha_(html, url) {
  const doc = String(html || '');
  if (doc.length < 500) {
    return { ok: false, motivo: 'vacia', mensaje: 'Liverpool devolvió una página vacía.' };
  }

  const titulo = revLimpiarTitulo_(
    revMetaContenido_(doc, 'og:title') || revPrimerH1_(doc));
  const imagen = revMetaContenido_(doc, 'og:image');

  // El bloque de precio del artículo principal. Los carruseles de "también te puede
  // interesar" traen sus propios precios: se ancla al testid del configurador, que es
  // el único que pertenece al producto que se está mirando.
  const anclaPrecio = doc.search(/data-testid="\d+-configurator-price"/);
  const desde = anclaPrecio > -1 ? anclaPrecio : 0;

  const precio      = revPrecioTrasTestid_(doc, 'discounted', desde);
  const precioLista = revPrecioTrasTestid_(doc, 'original', desde);

  if (precio === null) {
    return {
      ok: false, motivo: 'sin-precio',
      titulo: titulo, imagen: imagen,
      mensaje: 'Se abrió la página pero no encontramos el precio (Liverpool cambió el diseño de su sitio). ' +
               'Ábrela en una pestaña para compararla a mano.'
    };
  }

  return {
    ok: true,
    titulo: titulo,
    imagen: imagen,
    precio: precio,
    // Sin descuento activo, Liverpool no pinta el precio tachado: el de lista es el mismo.
    precioLista: (precioLista === null) ? precio : precioLista,
    hayPromo: (precioLista !== null && precioLista > precio + 0.009)
  };
}

/** Contenido de una <meta>, con los atributos en cualquiera de los dos órdenes. */
function revMetaContenido_(html, prop) {
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let m = html.match(new RegExp('<meta[^>]+(?:property|name)="' + p + '"[^>]*content="([^"]*)"', 'i'));
  if (!m) m = html.match(new RegExp('<meta[^>]+content="([^"]*)"[^>]*(?:property|name)="' + p + '"', 'i'));
  return m ? revDesescapar_(m[1]) : '';
}

function revPrimerH1_(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? revDesescapar_(m[1].replace(/<[^>]+>/g, '')) : '';
}

/**
 * Primer importe en pesos que aparece después de un `data-testid` dado.
 *
 * Liverpool parte el precio en varios <span> ("$", "279", un punto invisible, "30") y mete
 * comentarios de React en medio. Por eso se limpia una ventana de texto y se busca ahí:
 * intentar casar el precio contra el HTML crudo con una sola expresión se rompe cada vez
 * que cambian una clase.
 *
 * @return {?number} el importe, o null si no se reconoció.
 */
function revPrecioTrasTestid_(html, testid, desde) {
  const idx = html.indexOf('data-testid="' + testid + '"', desde || 0);
  if (idx === -1) return null;
  // Ventana corta: si se estira demasiado, el precio de "original" se cuela en el de
  // "discounted" y se leería el precio equivocado.
  const ventana = html.substr(idx, 500)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '');
  const m = ventana.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

/** "Anillo Map brillante | Gran Barata" → "Anillo Map brillante". */
function revLimpiarTitulo_(t) {
  return String(t || '').split('|')[0].replace(/\s+/g, ' ').trim();
}

/** Entidades HTML de las <meta>. Son las cuatro que aparecen en la práctica. */
function revDesescapar_(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Imagen oficial del SKU. Es el respaldo cuando la página no se puede leer: aunque no haya
 * precio en vivo, ver la foto del artículo al lado del nombre cotizado ya detecta el error
 * más común de todos, que es un SKU tecleado de más o de menos.
 */
function revImagenPorSku_(sku) {
  const limpio = String(sku == null ? '' : sku).trim().replace(/[^0-9A-Za-z\-]/g, '');
  if (!limpio) return '';
  return 'https://' + REV_IMG_SUBDOMINIOS[0] + '.liverpool.com.mx/xl/' +
         encodeURIComponent(limpio) + '.jpg';
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// VERIFICACIÓN AUTOMÁTICA
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Dictamen de la cotización, con respaldo si el motor de auditoría no está en el proyecto.
 *
 * La degradación es de verdad, no un `try` decorativo: si `AuditoriaCotizacion.gs` falta o
 * revienta, la pantalla vuelve a la lista de casillas manuales de siempre. Una revisión más
 * tosca es aceptable; quedarse sin poder aprobar ninguna cotización, no.
 */
function revAuditar_(quote, productos) {
  if (typeof audAuditar_ === 'function') {
    try {
      return audAuditar_(quote, productos);
    } catch (e) {
      Logger.log('revAuditar_: el motor de auditoría falló (' + e.message + '); se usa la lista manual.');
    }
  }
  return {
    puntos: REV_CHECKLIST_GENERAL.map(function (it) {
      return { id: it.id, texto: it.texto, estado: 'manual', detalle: '', auto: false, peso: 100 / REV_CHECKLIST_GENERAL.length, evidencia: [] };
    }),
    score: null,
    resumen: 'La verificación automática no está disponible: revisa los puntos a mano.',
    criticas: [], automaticos: 0, pendientes: 0, porRevisar: REV_CHECKLIST_GENERAL.length,
    degradada: true
  };
}

/**
 * Compara CONTRA EL SITIO el precio de todos los artículos que traen enlace, en una sola
 * llamada. Es lo que permite que el punto "los precios coinciden con el sitio" se marque solo.
 *
 * Por qué en lote y no artículo por artículo: `UrlFetchApp.fetchAll` lanza las peticiones en
 * paralelo. Diez artículos secuenciales son diez esperas de red encadenadas —y el tiempo de
 * ejecución de Apps Script tiene tope—; en paralelo es una sola espera.
 *
 * @param {string} folio
 * @param {string} email Correo de la sesión del Portal.
 */
function revVerificarPreciosLote(folio, email) {
  try {
    const id = secIdentidadConBloque_(email, 'revisar');
    if (!id.ok) {
      return { ok: false, sinPermiso: true,
               mensaje: id.error || 'Solo un usuario avanzado puede verificar precios.' };
    }
    if (!folio) return { ok: false, mensaje: 'Falta el folio.' };

    const det = (typeof leerDetalleCotizacion_ === 'function')
      ? leerDetalleCotizacion_(folio) : cotDetalleFolio_(folio);
    if (!det.success) return { ok: false, mensaje: det.message || 'Cotización no encontrada.' };

    const productos = det.quote.products || [];
    const pedidos = [];
    productos.forEach(function (p, i) {
      const u = revUrlArticuloSegura_(p.productUrl || '');
      if (u) pedidos.push({ indice: i, url: u, sku: p.sku || '' });
    });

    if (!pedidos.length) {
      return { ok: true, verificaciones: [], sinEnlaces: true,
               mensaje: 'Ningún artículo trae enlace a su página: no hay nada que comparar solo.' };
    }

    const fichas = revFichasEnParalelo_(pedidos);
    const verificaciones = pedidos.map(function (ped) {
      const ficha = fichas[ped.indice] || { ok: false, mensaje: 'No se obtuvo respuesta del sitio.' };
      const cmp = (typeof audCompararConFicha_ === 'function')
        ? audCompararConFicha_(productos[ped.indice], ficha)
        : { estado: ficha.ok ? 'coincide' : 'sin-dato', titulo: '', mensaje: ficha.mensaje || '', diferencia: 0 };
      return {
        indice: ped.indice,
        sku: ped.sku,
        estado: cmp.estado,
        titulo: cmp.titulo,
        mensaje: cmp.mensaje,
        diferencia: cmp.diferencia,
        similitud: cmp.similitud,
        precioSitio: (ficha && typeof ficha.precio === 'number') ? ficha.precio : null,
        tituloSitio: (ficha && ficha.titulo) ? ficha.titulo : '',
        deCache: !!(ficha && ficha.deCache)
      };
    });

    // El dictamen se vuelve a resumir con los precios ya comprobados, para que el índice de
    // confianza que ve el supervisor sea el mismo número que calculará el servidor al guardar.
    let auditoria = revAuditar_(det.quote, productos);
    if (typeof audAplicarPreciosEnVivo_ === 'function') {
      auditoria = audAplicarPreciosEnVivo_(auditoria, verificaciones);
    }

    return { ok: true, verificaciones: verificaciones, auditoria: auditoria };
  } catch (error) {
    Logger.log('revVerificarPreciosLote falló: ' + error.message + ' Stack: ' + error.stack);
    return { ok: false, mensaje: 'No se pudieron verificar los precios: ' + error.message };
  }
}

/**
 * Lee varias fichas a la vez: primero la caché, y lo que falte, en una sola tanda paralela.
 *
 * @param {{indice:number, url:string, sku:string}[]} pedidos
 * @return {object} mapa indice → ficha
 */
function revFichasEnParalelo_(pedidos) {
  const salida = {};
  const lista = (pedidos || []).slice(0, 30);   // tope de cordura: una cotización no tiene 200 líneas
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }

  const claveDe = function (url) {
    return 'rev-ficha-' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url));
  };

  const faltantes = [];
  lista.forEach(function (p) {
    if (cache) {
      const guardada = cache.get(claveDe(p.url));
      if (guardada) {
        try {
          const previa = JSON.parse(guardada);
          previa.deCache = true;
          salida[p.indice] = previa;
          return;
        } catch (e) { /* caché corrupta: se vuelve a pedir */ }
      }
    }
    faltantes.push(p);
  });

  if (!faltantes.length) return salida;

  let respuestas = [];
  try {
    respuestas = UrlFetchApp.fetchAll(faltantes.map(function (p) {
      return {
        url: p.url, method: 'get', headers: REV_FICHA_HEADERS,
        muteHttpExceptions: true, followRedirects: true, validateHttpsCertificates: true
      };
    }));
  } catch (e) {
    // Si la tanda entera revienta (red caída, cuota), se responde artículo por artículo con el
    // motivo: es mejor que devolver un mapa vacío que la pantalla no sabría interpretar.
    Logger.log('revFichasEnParalelo_: fetchAll falló (' + e.message + ')');
    faltantes.forEach(function (p) {
      salida[p.indice] = { ok: false, motivo: 'sin-red',
        mensaje: 'No se pudo contactar a liverpool.com.mx (' + e.message + ').' };
    });
    return salida;
  }

  faltantes.forEach(function (p, i) {
    const resp = respuestas[i];
    if (!resp) {
      salida[p.indice] = { ok: false, motivo: 'sin-red', mensaje: 'El sitio no respondió.' };
      return;
    }
    const codigo = resp.getResponseCode();
    if (codigo !== 200) {
      salida[p.indice] = {
        ok: false,
        motivo: codigo === 404 ? 'no-existe' : 'bloqueado',
        codigo: codigo,
        url: p.url,
        imagenRespaldo: revImagenPorSku_(p.sku),
        mensaje: codigo === 404
          ? 'Liverpool responde que este artículo ya no existe en su sitio (404).'
          : 'Liverpool rechazó la consulta automática (código ' + codigo + ').'
      };
      return;
    }
    const ficha = revExtraerFicha_(resp.getContentText(), p.url);
    ficha.url = p.url;
    if (!ficha.imagen) ficha.imagen = revImagenPorSku_(p.sku);
    ficha.capturada = new Date().toISOString();
    if (ficha.ok && cache) {
      try { cache.put(claveDe(p.url), JSON.stringify(ficha), REV_FICHA_TTL); } catch (e) {}
    }
    salida[p.indice] = ficha;
  });

  return salida;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// LA HOJA DE CÁLCULO, DENTRO DEL PORTAL
// ─────────────────────────────────────────────────────────────────────────────────────────
/*
 * POR QUÉ NO BASTA CON UN IFRAME.
 * El documento CCL vive en un Google Sheet. Incrustarlo con `/preview` funciona… si quien mira
 * tiene sesión de Google iniciada EN ESE NAVEGADOR y permiso sobre el archivo. En la práctica
 * eso falla la mitad de las veces: el supervisor entra al portal con su cuenta del sistema, no
 * necesariamente con la de Google que abrió el Sheet, y lo que ve es un recuadro pidiendo
 * permiso —o directamente en blanco.
 *
 * La app SÍ tiene acceso al archivo (se ejecuta como la cuenta que la desplegó y fue quien lo
 * creó). Así que en vez de pedirle al navegador del supervisor que abra el Sheet, el servidor
 * lo LEE y manda su contenido, y el portal lo pinta con sus propios estilos. Funciona siempre,
 * carga en un tercio del tiempo y de paso se ve como el resto de la aplicación.
 * El iframe sigue ofreciéndose como segunda pestaña para quien sí tenga acceso y quiera la hoja
 * de verdad.
 */

/** Tope de lo que se lee de la hoja. Un formato CCL cabe de sobra; un vertido de datos, no. */
const REV_HOJA_MAX_FILAS = 250;
const REV_HOJA_MAX_COLS  = 30;

/**
 * Devuelve el contenido del Sheet de la cotización listo para pintarlo en el portal.
 *
 * Se leen los valores TAL COMO SE VEN (`getDisplayValues`), no los crudos: la hoja ya trae sus
 * formatos de moneda y porcentaje, y volver a formatearlos aquí sería una segunda fuente de
 * verdad que tarde o temprano diría algo distinto del documento que firma el cliente.
 *
 * @param {string} folio
 * @param {string} email Correo de la sesión del Portal.
 */
function revHojaCotizacion(folio, email) {
  try {
    const id = secIdentidadConBloque_(email, 'revisar');
    if (!id.ok) {
      return { ok: false, sinPermiso: true,
               mensaje: id.error || 'Solo un usuario avanzado puede ver la hoja.' };
    }
    if (!folio) return { ok: false, mensaje: 'Falta el folio.' };

    const det = (typeof leerDetalleCotizacion_ === 'function')
      ? leerDetalleCotizacion_(folio) : cotDetalleFolio_(folio);
    if (!det.success) return { ok: false, mensaje: det.message || 'Cotización no encontrada.' };

    const ref = revSheetId_(det.quote.cclSheetLink || '');
    if (!ref.id) {
      return { ok: false, motivo: 'sin-hoja',
               mensaje: 'Esta cotización no tiene documento en Google Sheets (solo las del formato CCL lo llevan).' };
    }

    let ss;
    try {
      ss = SpreadsheetApp.openById(ref.id);
    } catch (e) {
      return { ok: false, motivo: 'sin-acceso',
               mensaje: 'No pudimos abrir el documento de esta cotización. Comprueba que no se haya borrado ni movido de carpeta.' };
    }

    let hoja = null;
    if (ref.gid) {
      const todas = ss.getSheets();
      for (let i = 0; i < todas.length; i++) {
        if (String(todas[i].getSheetId()) === String(ref.gid)) { hoja = todas[i]; break; }
      }
    }
    if (!hoja) hoja = ss.getSheets()[0];
    if (!hoja) return { ok: false, mensaje: 'El documento está vacío.' };

    const filas = Math.min(hoja.getLastRow() || 1, REV_HOJA_MAX_FILAS);
    const cols  = Math.min(hoja.getLastColumn() || 1, REV_HOJA_MAX_COLS);
    if (filas < 1 || cols < 1) {
      return { ok: true, nombre: hoja.getName(), celdas: [], merges: [], anchos: [],
               url: det.quote.cclSheetLink || '', truncada: false };
    }

    const rango = hoja.getRange(1, 1, filas, cols);
    const valores  = rango.getDisplayValues();
    const fondos   = rango.getBackgrounds();
    const colores  = rango.getFontColors();
    const pesos    = rango.getFontWeights();
    const alineas  = rango.getHorizontalAlignments();

    // Las celdas combinadas se mandan aparte: el cliente las convierte en rowspan/colspan y
    // salta las que quedan tapadas. Sin esto, el encabezado del formato CCL —que está
    // combinado a lo ancho— saldría repetido en cada columna.
    const merges = [];
    try {
      rango.getMergedRanges().forEach(function (r) {
        merges.push({
          fila: r.getRow() - 1, col: r.getColumn() - 1,
          filas: r.getNumRows(), cols: r.getNumColumns()
        });
      });
    } catch (e) { /* una hoja sin combinaciones no es un error */ }

    const anchos = [];
    for (let c = 1; c <= cols; c++) {
      try { anchos.push(hoja.getColumnWidth(c)); } catch (e) { anchos.push(100); }
    }

    // Se recortan las filas finales completamente vacías: la hoja plantilla suele traer un
    // colchón de 200 filas en blanco y pintarlas es scroll para nada.
    let ultima = 0;
    for (let f = 0; f < valores.length; f++) {
      for (let c = 0; c < valores[f].length; c++) {
        if (String(valores[f][c] || '').trim() !== '') { ultima = f; break; }
      }
    }

    const celdas = [];
    for (let f = 0; f <= ultima; f++) {
      const fila = [];
      for (let c = 0; c < cols; c++) {
        fila.push({
          v: valores[f][c],
          // Se manda solo lo que se APARTA de lo normal; mandar el blanco de todas las celdas
          // multiplicaría por tres el tamaño del mensaje sin cambiar nada en pantalla.
          b: revColorUtil_(fondos[f][c], ['#ffffff', '#fff', '']),
          t: revColorUtil_(colores[f][c], ['#000000', '#000', '']),
          n: (pesos[f][c] === 'bold'),
          a: (alineas[f][c] === 'right' || alineas[f][c] === 'center') ? alineas[f][c] : ''
        });
      }
      celdas.push(fila);
    }

    return {
      ok: true,
      nombre: hoja.getName(),
      celdas: celdas,
      merges: merges,
      anchos: anchos,
      url: det.quote.cclSheetLink || '',
      embedUrl: revUrlEmbedSheet_(det.quote.cclSheetLink || ''),
      truncada: (hoja.getLastRow() > REV_HOJA_MAX_FILAS || hoja.getLastColumn() > REV_HOJA_MAX_COLS),
      leida: new Date().toISOString()
    };
  } catch (error) {
    Logger.log('revHojaCotizacion falló: ' + error.message + ' Stack: ' + error.stack);
    return { ok: false, mensaje: 'No pudimos leer el documento. Inténtalo de nuevo en un momento.' };
  }
}

/** Devuelve el color solo si aporta algo (no es el de por defecto). */
function revColorUtil_(color, ignorar) {
  const c = String(color || '').toLowerCase().trim();
  return (ignorar.indexOf(c) > -1) ? '' : c;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// LA PÁGINA DE LIVERPOOL, DENTRO DEL PORTAL
// ─────────────────────────────────────────────────────────────────────────────────────────
/*
 * EL PROBLEMA, OTRA VEZ Y DEFINITIVO.
 * `<iframe src="https://www.liverpool.com.mx/...">` NO va a cargar nunca. Su servidor responde
 *     X-Frame-Options: SAMEORIGIN
 *     Content-Security-Policy: frame-ancestors https://gcp-na-app.contentstack.com
 * y esas dos cabeceras las hace cumplir el NAVEGADOR, antes de pintar un solo píxel. Ningún
 * atributo del iframe (sandbox, allow, referrerpolicy) las levanta, y no hay nada que "arreglar"
 * del lado de la app: mientras el portal viva en script.google.com, ese recuadro sale en blanco.
 * Volver a intentarlo es volver a perder la tarde.
 *
 * LA SALIDA QUE SÍ FUNCIONA.
 * Quien tiene prohibido incrustar la página es el navegador del supervisor, no el servidor.
 * `UrlFetchApp` no es un navegador: pide la página y recibe el HTML completo. Ese HTML se
 * limpia aquí (fuera scripts, formularios, iframes y manejadores de eventos), se le pone un
 * `<base>` para que sus hojas de estilo y sus imágenes —que son públicas— sigan resolviendo
 * contra liverpool.com.mx, y se manda al cliente, que lo pinta con `srcdoc` en un iframe
 * AISLADO (sin `allow-scripts` ni `allow-same-origin`).
 *
 * Resultado: la página de Liverpool se ve DENTRO del portal, con su maquetación y sus fotos
 * reales, y como no puede ejecutar nada, tampoco puede leer la sesión ni llamar a ningún lado.
 * Es más segura que el iframe original que nunca funcionó.
 */

/** Tope del HTML que se devuelve. Por encima de esto, el mensaje tarda más que abrir la pestaña. */
const REV_PAGINA_MAX_BYTES = 900000;

/** Lo que se quita SIEMPRE de la página: bloques enteros que no aportan nada a una revisión. */
const REV_PAGINA_FUERA = [
  'script', 'noscript', 'iframe', 'object', 'embed', 'form', 'template', 'canvas'
];

/**
 * Trae la página del artículo, saneada y lista para incrustarse con `srcdoc`.
 *
 * @param {string} url  Enlace del artículo (se vuelve a validar aquí).
 * @param {string} sku  Solo para el respaldo por imagen.
 * @param {string} email Correo de la sesión del Portal.
 * @return {{ok:boolean, html?:string, bytes?:number, url?:string, motivo?:string, mensaje?:string}}
 */
function revPaginaArticulo(url, sku, email) {
  try {
    const id = secIdentidadConBloque_(email, 'revisar');
    if (!id.ok) {
      return { ok: false, motivo: 'sin-permiso',
               mensaje: 'Solo un usuario avanzado puede abrir la página del artículo aquí dentro.' };
    }

    const limpia = revUrlArticuloSegura_(url);
    if (!limpia) {
      return { ok: false, motivo: 'url-invalida',
               mensaje: 'El enlace guardado no es una dirección de liverpool.com.mx.' };
    }

    // Armar esta copia son nueve peticiones (la página y sus ocho hojas de estilo). Si dos
    // supervisores miran el mismo artículo —o si alguien cierra el visor y lo vuelve a abrir—
    // no tiene sentido repetirlas. Se guarda troceada porque una entrada de caché no admite
    // más de ~100 KB y el documento pesa cerca de medio mega.
    const claveCache = 'rev-pagina-' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, limpia));
    if (typeof cotCacheGet_ === 'function') {
      try {
        const previa = cotCacheGet_(claveCache);
        if (previa && previa.html) {
          previa.deCache = true;
          return previa;
        }
      } catch (e) { /* caché ilegible: se vuelve a armar */ }
    }

    let resp;
    try {
      resp = UrlFetchApp.fetch(limpia, {
        method: 'get', headers: REV_FICHA_HEADERS,
        muteHttpExceptions: true, followRedirects: true, validateHttpsCertificates: true
      });
    } catch (e) {
      return { ok: false, motivo: 'sin-red', url: limpia,
               mensaje: 'No se pudo contactar a liverpool.com.mx (' + e.message + ').' };
    }

    const codigo = resp.getResponseCode();
    if (codigo !== 200) {
      return {
        ok: false,
        motivo: codigo === 404 ? 'no-existe' : 'bloqueado',
        codigo: codigo, url: limpia,
        mensaje: codigo === 404
          ? 'Liverpool responde que este artículo ya no existe (404).'
          : 'Liverpool rechazó la consulta automática (código ' + codigo + '). Ábrelo en una pestaña.'
      };
    }

    const partes = revPartesPagina_(resp.getContentText());
    if (!partes || !partes.cuerpo) {
      return { ok: false, motivo: 'vacia', url: limpia,
               mensaje: 'La página del artículo llegó vacía. Ábrela en una pestaña para verla.' };
    }

    const html = revArmarPaginaIncrustada_(partes, limpia, revHojasDeEstilo_(partes.hojas, limpia));
    if (!html) {
      return { ok: false, motivo: 'vacia', url: limpia,
               mensaje: 'No pudimos mostrar la página aquí dentro. Ábrela en una pestaña.' };
    }
    if (html.length > REV_PAGINA_MAX_BYTES) {
      return { ok: false, motivo: 'demasiado-grande', url: limpia, bytes: html.length,
               mensaje: 'La página es muy pesada para verla aquí dentro: se abre más rápido en una pestaña.' };
    }

    const salida = { ok: true, html: html, bytes: html.length, url: limpia,
                     capturada: new Date().toISOString() };
    if (typeof cotCachePut_ === 'function') {
      try { cotCachePut_(claveCache, salida, REV_FICHA_TTL); } catch (e) { /* sin caché se sigue igual */ }
    }
    return salida;
  } catch (error) {
    Logger.log('revPaginaArticulo falló: ' + error.message + ' Stack: ' + error.stack);
    return { ok: false, motivo: 'error', mensaje: 'No se pudo preparar la página: ' + error.message };
  }
}

/**
 * Descompone la página en lo único que hace falta para reconstruirla: su cuerpo ya saneado,
 * sus estilos en línea y las direcciones de sus hojas de estilo.
 *
 * El saneado se hace con expresiones regulares, que para analizar HTML en general es una mala
 * idea — pero aquí el resultado NO se ejecuta: acaba en un iframe con `sandbox` vacío, sin
 * permiso para correr JavaScript ni para tocar el documento que lo contiene. La limpieza es la
 * primera barrera (que no viaje basura de kilos), no la única; la barrera de verdad es el
 * aislamiento del iframe.
 */
function revPartesPagina_(html) {
  let doc = String(html || '');
  if (doc.length < 500) return null;

  // 1 · Fuera los bloques que no pintan nada en una revisión y sí pueden ejecutar cosas.
  REV_PAGINA_FUERA.forEach(function (tag) {
    doc = doc.replace(new RegExp('<' + tag + '[^>]*>[\\s\\S]*?<\\/' + tag + '>', 'gi'), '');
    doc = doc.replace(new RegExp('<' + tag + '[^>]*\\/?>', 'gi'), '');
  });

  // 2 · Las precargas de JavaScript ya no apuntan a nada útil y disparan peticiones de más.
  doc = doc.replace(/<link[^>]+rel=["'](?:preload|modulepreload|prefetch)["'][^>]*>/gi, '');

  // 3 · Manejadores en línea y URLs con esquema ejecutable.
  doc = doc.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
           .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
           .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
           .replace(/(href|src|action)\s*=\s*["']\s*(?:javascript|data|vbscript):[^"']*["']/gi, '$1="#"');

  const cabeza = doc.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const cuerpo = doc.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!cuerpo) return null;

  const partes = { cuerpo: cuerpo[1], enLinea: '', hojas: [] };
  if (cabeza) {
    const estilos = cabeza[1].match(/<style[^>]*>[\s\S]*?<\/style>/gi);
    if (estilos) partes.enLinea = estilos.join('\n');
    const enlaces = cabeza[1].match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || [];
    enlaces.forEach(function (l) {
      const m = l.match(/href=["']([^"']+)["']/i);
      if (m) partes.hojas.push(m[1]);
    });
  }
  return partes;
}

/**
 * Trae el contenido de las hojas de estilo de la página.
 *
 * POR QUÉ SE DESCARGAN EN VEZ DE ENLAZARLAS (comprobado, no supuesto).
 * Dejar los `<link>` apuntando a liverpool.com.mx parece lo obvio y lo barato… y no funciona:
 * su CDN sirve el archivo, el navegador lo apunta en `document.styleSheets`, y NINGUNA de sus
 * reglas aplica cuando la petición sale de otro origen. Se verificó de las dos formas: el mismo
 * archivo servido desde el propio origen aplica sus 2 260 reglas (la lista pierde las viñetas,
 * la tipografía pasa a Roboto); pedido a liverpool.com.mx desde otra página, la hoja "carga"
 * pero el documento se queda en Times New Roman. Por eso el servidor las descarga y las
 * incrusta: desde dentro del documento son estilos propios y aplican siempre.
 *
 * @param {string[]} hrefs Direcciones tal como venían en el HTML (pueden ser relativas).
 * @param {string} urlOriginal Para resolver las relativas.
 * @return {string[]} el CSS de cada hoja que se pudo traer.
 */
function revHojasDeEstilo_(hrefs, urlOriginal) {
  const origen = String(urlOriginal || '').replace(/^(https:\/\/[^\/]+).*$/, '$1');
  const lista = (hrefs || []).slice(0, 12).map(function (h) {
    if (/^https?:\/\//i.test(h)) return h;
    if (h.indexOf('//') === 0) return 'https:' + h;
    if (h.charAt(0) === '/') return origen + h;
    return origen + '/' + h;
  }).filter(function (u) {
    // Solo del propio Liverpool: esta función descarga lo que diga una página ajena, así que
    // el dominio se comprueba igual que el del artículo.
    return /^https:\/\/[a-z0-9.-]*liverpool\.com\.mx\//i.test(u);
  });

  if (!lista.length) return [];

  let respuestas = [];
  try {
    respuestas = UrlFetchApp.fetchAll(lista.map(function (u) {
      return { url: u, method: 'get', headers: REV_FICHA_HEADERS, muteHttpExceptions: true, followRedirects: true };
    }));
  } catch (e) {
    Logger.log('revHojasDeEstilo_: no se pudieron traer los estilos (' + e.message + ')');
    return [];
  }

  const css = [];
  respuestas.forEach(function (r) {
    try {
      if (r && r.getResponseCode() === 200) css.push(r.getContentText());
    } catch (e) { /* una hoja que falla no tumba la página */ }
  });
  return css;
}

/**
 * Quita del CSS las reglas que este documento no puede usar.
 *
 * Sin esto, las hojas de un artículo suman ~457 KB —son compilaciones de utilidades tipo
 * Tailwind con miles de clases para TODO el sitio— y el mensaje pesaría más que la página.
 * El recorte es conservador: se descarta una regla solo cuando alguna de las clases o
 * identificadores que EXIGE no aparece en el documento. Todo lo demás (selectores de etiqueta,
 * `:root`, `@font-face`, `@keyframes`, atributos) se conserva tal cual, porque ahí es donde
 * viven el reseteo y las variables de las que depende el resto.
 */
function revPurgarCss_(css, usa) {
  const texto = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  let salida = '';
  let prelude = '';
  let i = 0;
  const n = texto.length;

  while (i < n) {
    const ch = texto.charAt(i);

    if (ch === '{') {
      let prof = 1, j = i + 1;
      while (j < n && prof > 0) {
        const c = texto.charAt(j);
        if (c === '{') prof++;
        else if (c === '}') prof--;
        j++;
      }
      const cuerpo = texto.slice(i + 1, j - 1);
      const sel = prelude.trim();
      prelude = '';
      i = j;

      if (!sel) continue;

      if (sel.charAt(0) === '@') {
        const nombre = (sel.match(/^@([a-z-]+)/i) || [])[1] || '';
        if (/^(media|supports|layer|container|scope|document)$/i.test(nombre)) {
          const dentro = revPurgarCss_(cuerpo, usa);
          if (dentro.replace(/\s/g, '')) salida += sel + '{' + dentro + '}';
        } else {
          salida += sel + '{' + cuerpo + '}';        // font-face, keyframes, page, property…
        }
      } else if (revSelectorUsado_(sel, usa)) {
        salida += sel + '{' + cuerpo + '}';
      }
      continue;
    }

    if (ch === ';' && prelude.trim().charAt(0) === '@') {
      salida += prelude.trim() + ';';                 // @import, @charset
      prelude = '';
      i++;
      continue;
    }

    prelude += ch;
    i++;
  }
  return salida;
}

/** ¿Alguna de las alternativas del selector puede llegar a coincidir con este documento? */
function revSelectorUsado_(selector, usa) {
  const partes = String(selector).split(',');
  for (let i = 0; i < partes.length; i++) {
    // Las pseudoclases y pseudoelementos no aportan nada a esta decisión y sus paréntesis
    // (:not(.x), :is(.a,.b)) enredarían la extracción de clases.
    const parte = partes[i].replace(/::?[a-z-]+(\([^)]*\))?/gi, ' ');
    const clases = (parte.match(/\.(?:\\.|[A-Za-z0-9_-])+/g) || [])
      .map(function (c) { return c.slice(1).replace(/\\(.)/g, '$1'); });
    const ids = (parte.match(/#(?:\\.|[A-Za-z0-9_-])+/g) || [])
      .map(function (c) { return c.slice(1).replace(/\\(.)/g, '$1'); });

    // Sin clases ni identificadores es un selector de etiqueta, atributo o global: se conserva.
    if (!clases.length && !ids.length) return true;

    let todas = true;
    for (let c = 0; c < clases.length; c++) { if (!usa.clases[clases[c]]) { todas = false; break; } }
    if (todas) for (let d = 0; d < ids.length; d++) { if (!usa.ids[ids[d]]) { todas = false; break; } }
    if (todas) return true;
  }
  return false;
}

/** Clases e identificadores que de verdad aparecen en el documento. */
function revTokensDelHtml_(html) {
  const usa = { clases: {}, ids: {} };
  const doc = String(html || '');
  (doc.match(/class="[^"]*"/gi) || []).forEach(function (a) {
    a.slice(7, -1).split(/\s+/).forEach(function (c) { if (c) usa.clases[c] = 1; });
  });
  (doc.match(/id="[^"]*"/gi) || []).forEach(function (a) {
    const v = a.slice(4, -1).trim();
    if (v) usa.ids[v] = 1;
  });
  return usa;
}

/**
 * Arma el documento final que se manda al navegador para incrustarlo con `srcdoc`.
 *
 * @param {{cuerpo:string, enLinea:string}} partes
 * @param {string} urlOriginal
 * @param {string[]} cssExternos Contenido de las hojas de estilo ya descargadas.
 */
function revArmarPaginaIncrustada_(partes, urlOriginal, cssExternos) {
  if (!partes || !partes.cuerpo) return '';

  const usa = revTokensDelHtml_(partes.cuerpo);
  let css = '';
  (cssExternos || []).forEach(function (hoja) {
    const recortada = revPurgarCss_(hoja, usa);
    // Si el recorte se lleva por delante casi todo, es que el análisis se perdió (un CSS con
    // llaves dentro de un `content:`, por ejemplo). Ante la duda, la hoja entera: pesa más,
    // pero se ve bien, y verse mal es el único fallo que el supervisor no puede compensar.
    css += (recortada.length > hoja.length * 0.02) ? recortada : hoja;
  });

  const base = String(urlOriginal).replace(/^(https:\/\/[^\/]+).*$/, '$1') + '/';

  return '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    // El <base> es para las IMÁGENES y los recursos relativos que quedan: esos sí cargan
    // directamente de liverpool.com.mx (son públicos y no los limita ninguna cabecera).
    '<base href="' + base + '">' +
    (css ? '<style>' + css + '</style>' : '') +
    partes.enLinea +
    // Retoque propio: se esconde el andamiaje del sitio (barra, menús, pie, avisos de galletas)
    // porque dentro del panel de revisión solo estorba, y se deja el contenido del artículo.
    '<style>' +
      'html,body{background:#fff!important;margin:0!important;padding:0!important;overflow-x:hidden!important}' +
      // La tipografía del sitio son fuentes web servidas por su CDN, y una fuente SÍ exige
      // CORS: desde este documento nunca van a cargar. Sin esto, el respaldo del navegador es
      // una serif y la copia parece un documento roto en vez de una página. Se fuerza la
      // tipografía del sistema, que es la misma familia que usa el resto del portal.
      'html,body,*{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif!important}' +
      // Los iconos son ligaduras de Material: sin su fuente, "chevron_right" o "favorite_border"
      // salen escritos como texto suelto por toda la página.
      '[class*="material-icons"],[class*="material-symbols"],[class*="MuiIcon"],' +
      '[class*="Icon-root"]{display:none!important}' +
      'header,footer,[data-testid*="header"],[data-testid*="footer"],' +
      '[id*="onetrust"],[class*="cookie"],[class*="chat"],[id*="chat"],' +
      '[role="banner"],[role="contentinfo"]{display:none!important}' +
      'a{pointer-events:none!important;cursor:default!important;text-decoration:none!important}' +
      // La foto principal de una ficha de Liverpool ocupa una pantalla entera. Dentro del
      // panel de revisión eso deja el precio —que es a lo que se viene— fuera de la vista y
      // obliga a hacer scroll dentro de un recuadro dentro de una ventana. Se acota.
      'img{max-width:100%!important;height:auto!important;max-height:320px!important;object-fit:contain!important}' +
      '.__rev-aviso{font:600 13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;' +
        'background:#FDF4E6;color:#7A4A12;border-bottom:1px solid #F0D9B5;padding:10px 16px;' +
        'position:relative;z-index:9}' +
    '</style></head><body>' +
    '<div class="__rev-aviso">Copia de la página de liverpool.com.mx traída por el servidor · ' +
      'los enlaces están desactivados dentro de este recuadro</div>' +
    partes.cuerpo +
    '</body></html>';
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// DIAGNÓSTICO
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Revisión rápida del módulo desde el editor de Apps Script. Escribe en el Logger y
 * devuelve el mismo texto: qué columnas existen, cuántas cotizaciones hay por estado y
 * si la validación de URLs se comporta como debe.
 */
function revDiagnostico() {
  const lineas = [];
  const anota = function (ok, txt) { lineas.push((ok ? '✔ ' : '✖ ') + txt); };

  try {
    const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COTIZACIONES_SHEET_NAME);
    if (!hoja) {
      anota(false, 'Hoja "' + COTIZACIONES_SHEET_NAME + '" no encontrada.');
    } else {
      const headers = revAsegurarColumnas_(hoja);
      Object.keys(REV_COLS).forEach(function (k) {
        anota(headers.indexOf(REV_COLS[k]) > -1, 'Columna ' + REV_COLS[k]);
      });

      const datos = hoja.getDataRange().getValues();
      const iEstado = headers.indexOf(REV_COLS.estado);
      const iEstatus = headers.indexOf('Estatus');
      const conteo = {};
      for (let i = 1; i < datos.length; i++) {
        const e = String(datos[i][iEstado] || datos[i][iEstatus] || '(sin estatus)');
        conteo[e] = (conteo[e] || 0) + 1;
      }
      Object.keys(conteo).forEach(function (e) { anota(true, 'Cotizaciones con estado "' + e + '": ' + conteo[e]); });
    }
  } catch (e) {
    anota(false, 'Error leyendo la hoja: ' + e.message);
  }

  try {
    const det = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DETALLE_COTIZACIONES_SHEET_NAME);
    if (det) {
      const h = det.getRange(1, 1, 1, det.getLastColumn()).getValues()[0];
      anota(h.indexOf(REV_COL_LINK_ARTICULO) > -1,
        'Columna ' + REV_COL_LINK_ARTICULO + ' en ' + DETALLE_COTIZACIONES_SHEET_NAME +
        ' (se crea sola al guardar la siguiente cotización)');
    }
  } catch (e) {
    anota(false, 'Error leyendo DetalleCotizaciones: ' + e.message);
  }

  // Casos que TIENEN que rebotar. Si alguno pasa, el iframe de la revisión es explotable.
  const debenFallar = [
    'javascript:alert(1)',
    'http://www.liverpool.com.mx/tienda/pdp/x/1',
    'https://evil.com/?x=liverpool.com.mx',
    'https://liverpool.com.mx.evil.com/x',
    'https://user:pass@www.liverpool.com.mx/x',
    'https://www.liverpool.com.mx/x" onload="alert(1)'
  ];
  debenFallar.forEach(function (u) {
    anota(revUrlArticuloSegura_(u) === '', 'Rechaza: ' + u);
  });
  anota(revUrlArticuloSegura_('https://www.liverpool.com.mx/tienda/pdp/apple-ipad/1176418893?skuid=1') !== '',
    'Acepta una URL de artículo legítima');

  // La URL incrustable tiene que ser /preview: /edit la bloquea el navegador dentro de un iframe.
  const sheetPrueba = 'https://docs.google.com/spreadsheets/d/1l3cdEOUnD1Rgk1VCDfx48NWd_mcgIQ7Gkt2YhwbRs34/edit#gid=123';
  anota(revUrlEmbedSheet_(sheetPrueba).indexOf('/preview') > -1, 'La URL incrustable del Sheet usa /preview');
  anota(revUrlEmbedSheet_(sheetPrueba).indexOf('gid=123') > -1, 'La URL incrustable conserva la pestaña (gid)');
  anota(revUrlEmbedSheet_('https://ejemplo.com/x') === '', 'Rechaza una URL que no es de Sheets');

  // Motor de auditoría: existe y contesta.
  if (typeof audAuditar_ === 'function') {
    const dictamen = revAuditar_(
      { clientName: 'María López', clientEmail: 'maria@gmail.com', clientPhone: '5512345678',
        advisorName: 'David Martínez', advisorExt: '1234', summaryTotal: 116,
        summarySubtotal: 100, summaryVat: 16, timestamp: new Date().toISOString() },
      [{ sku: '1182166315', description: 'Anillo Map brillante', quantity: 1, unitPrice: 116,
         additionalDiscountApplied: 'No', productUrl: 'https://www.liverpool.com.mx/tienda/pdp/x/1' }]);
    anota(dictamen.puntos.length === 8, 'La auditoría automática devuelve sus 8 puntos');
    anota(dictamen.puntos.filter(function (x) { return x.id === 'formato'; }).length === 0,
      'Ya no se pide confirmar el formato de la cotización');
    anota(dictamen.score >= 70, 'Índice de confianza de una cotización sana: ' + dictamen.score + '/100');
  } else {
    anota(false, 'AuditoriaCotizacion.gs NO está en el proyecto: la revisión cae a las casillas manuales');
  }

  // Saneado de la página incrustada: lo que no debe sobrevivir.
  const sucia = '<html><head><style>a{color:red}</style></head><body><div>Hola' +
                '<script>alert(1)<\/script><img src="/x.jpg" onerror="alert(2)">' +
                '<a href="javascript:alert(3)">clic</a></div></body></html>';
  const partes = revPartesPagina_(sucia + new Array(600).join(' '));
  const limpiada = partes
    ? revArmarPaginaIncrustada_(partes, 'https://www.liverpool.com.mx/tienda/pdp/x/1',
        ['.usada{color:green}.jamas-usada{color:red}@font-face{font-family:X;src:url(y)}'])
    : '';
  anota(limpiada.indexOf('<script') === -1, 'El saneado quita los <script>');
  anota(limpiada.toLowerCase().indexOf('onerror') === -1, 'El saneado quita los manejadores en línea');
  anota(limpiada.indexOf('javascript:') === -1, 'El saneado neutraliza los enlaces javascript:');
  anota(limpiada.indexOf('<base href="https://www.liverpool.com.mx/">') > -1,
    'El saneado deja el <base> para que carguen las imágenes');
  anota(limpiada.indexOf('a{color:red}') > -1, 'El saneado conserva los estilos en línea de la página');

  // La purga: fuera lo que el documento no puede usar, dentro lo que sí y lo global.
  const usa = revTokensDelHtml_('<div class="usada" id="x">hola</div>');
  const purgada = revPurgarCss_(
    '.usada{color:green}.jamas-usada{color:red}#x{border:0}#z{border:1px}' +
    'body{margin:0}@media (min-width:600px){.usada{color:blue}.jamas-usada{color:pink}}' +
    '@font-face{font-family:X;src:url(y)}', usa);
  anota(purgada.indexOf('.usada{color:green}') > -1, 'La purga conserva las clases que se usan');
  anota(purgada.indexOf('jamas-usada') === -1, 'La purga descarta las clases que no aparecen');
  anota(purgada.indexOf('#x{border:0}') > -1, 'La purga conserva los identificadores presentes');
  anota(purgada.indexOf('#z') === -1, 'La purga descarta los identificadores ausentes');
  anota(purgada.indexOf('body{margin:0}') > -1, 'La purga conserva los selectores de etiqueta');
  anota(purgada.indexOf('@media (min-width:600px){.usada{color:blue}}') > -1,
    'La purga entra dentro de las @media y limpia solo lo que sobra');
  anota(purgada.indexOf('@font-face') > -1, 'La purga respeta @font-face');

  const reporte = 'REVISIÓN DE COTIZACIONES — diagnóstico\n' + lineas.join('\n');
  Logger.log(reporte);
  return reporte;
}

/**
 * Comprueba, desde el propio despliegue, si la ficha en vivo del artículo funciona.
 *
 * Se ejecuta A MANO desde el editor de Apps Script. Es la única forma de saber si la
 * protección anti-bot de Liverpool deja pasar las peticiones que salen de los servidores de
 * Google: desde una computadora de oficina siempre funciona, y eso no dice nada sobre lo que
 * ve el despliegue. Si aquí sale "bloqueado", la pantalla de revisión seguirá funcionando —
 * mostrará la foto del SKU y el aviso de abrir en pestaña— pero sin comparación de precios.
 *
 * @param {string} [url] Un artículo cualquiera; si se omite se usa uno de ejemplo.
 */
function revDiagnosticoFicha(url) {
  const prueba = url || 'https://www.liverpool.com.mx/tienda/pdp/anillo-map-brillante/1182166315?skuid=1182166321';
  const lineas = ['FICHA EN VIVO — diagnóstico', 'URL: ' + prueba];

  const limpia = revUrlArticuloSegura_(prueba);
  lineas.push((limpia ? '✔' : '✖') + ' La URL pasa el filtro de dominios');
  if (!limpia) { Logger.log(lineas.join('\n')); return lineas.join('\n'); }

  let resp;
  try {
    resp = UrlFetchApp.fetch(limpia, {
      method: 'get', headers: REV_FICHA_HEADERS,
      muteHttpExceptions: true, followRedirects: true
    });
  } catch (e) {
    lineas.push('✖ UrlFetchApp lanzó: ' + e.message);
    Logger.log(lineas.join('\n'));
    return lineas.join('\n');
  }

  const codigo = resp.getResponseCode();
  lineas.push((codigo === 200 ? '✔' : '✖') + ' Código HTTP: ' + codigo);
  if (codigo !== 200) {
    lineas.push('   → Liverpool bloquea las peticiones que salen de Google. La pantalla de');
    lineas.push('     revisión caerá al respaldo (foto del SKU + "abrir en pestaña").');
    Logger.log(lineas.join('\n'));
    return lineas.join('\n');
  }

  const html = resp.getContentText();
  lineas.push('✔ HTML recibido: ' + html.length + ' caracteres');

  const ficha = revExtraerFicha_(html, limpia);
  lineas.push((ficha.ok ? '✔' : '✖') + ' Lectura de la ficha' + (ficha.ok ? '' : ' → ' + ficha.motivo));
  lineas.push('   título      : ' + (ficha.titulo || '(no leído)'));
  lineas.push('   imagen      : ' + (ficha.imagen || '(no leída)'));
  lineas.push('   precio      : ' + (ficha.precio == null ? '(no leído)' : ficha.precio));
  lineas.push('   precio lista: ' + (ficha.precioLista == null ? '(no leído)' : ficha.precioLista));

  const reporte = lineas.join('\n');
  Logger.log(reporte);
  return reporte;
}
