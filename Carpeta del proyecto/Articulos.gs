/**
 * =================================================================================================
 * Artículos — publicaciones largas del Portal | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Fase 8 del plan de cierre (R16). Un artículo es lo que una publicación del Portal no puede ser:
 * texto largo con subtítulos, imágenes, tablas, enlaces y documentos de Google incrustados, con
 * firma de quién lo escribió y registro de quién lo ha leído.
 *
 * LA DECISIÓN QUE ORDENA TODO LO DEMÁS: el contenido se guarda como JSON DE BLOQUES VERSIONADO,
 * nunca como HTML.
 *
 *     { v: 1, bloques: [ {tipo:'titulo', texto:'…'}, {tipo:'texto', partes:[…]}, … ] }
 *
 * Guardar el HTML que produjera un editor sería guardar código de terceros para pintarlo después
 * en la pantalla de todo el equipo: cualquier `<script>`, cualquier `onerror=`, cualquier
 * `javascript:` que se colara en el camino se ejecutaría en la sesión de quien lo lea. Con bloques,
 * el servidor sabe qué campos existen y de qué tipo son —y descarta el resto—, y el cliente
 * CONSTRUYE nodos del DOM en vez de asignar innerHTML: no hay ningún punto por el que el texto de
 * un artículo pueda dejar de ser texto. La `v` está para poder cambiar la forma más adelante sin
 * que los artículos viejos dejen de leerse.
 *
 * Funciones expuestas al cliente:
 *   artListar(email, opts)      → lista para la pantalla y para el carril del Portal
 *   artObtener(id, email)       → un artículo, y de paso registra la lectura
 *   artGuardar(payload)         → crear o actualizar          (bloque 'articulos')
 *   artPublicar(id, pub, email) → borrador ⇄ publicado        (bloque 'articulos')
 *   artEliminar(id, email)      → borrar                      (bloque 'articulos')
 *   artLectores(id, email)      → quién lo ha leído           (bloque 'articulos')
 *   artIndiceBuscador(email)    → títulos y resúmenes para el buscador general
 *
 * Los .gs comparten un solo ámbito global: todo lo de aquí lleva prefijo `art`.
 */

// ── HOJAS ────────────────────────────────────────────────────────────────────
// Viven en el libro del Portal (portalSS_, Portal.gs), que es donde ya está el resto del
// contenido que el equipo publica.

var ART_SHEET         = 'Articulos';
var ART_VISTAS_SHEET  = 'ArticulosVistas';
var ART_BLOQUE_PERM   = 'articulos';   // permiso de ESCRITURA; leer puede cualquier sesión

var ART_HEADERS = ['ID', 'Titulo', 'Resumen', 'Contenido (JSON)', 'Estado',
                   'Autores', 'Creado', 'Editado', 'Editado por'];
var ART_VISTAS_HEADERS = ['ID articulo', 'Correo', 'Nombre', 'Primera vez', 'Ultima vez', 'Veces'];

var ART_ESTADOS = ['borrador', 'publicado'];

/* Topes. No son burocracia: una celda de Sheets aguanta 50 000 caracteres, y pasarse no da un
   error claro sino un guardado que trunca en silencio. Se corta antes, y se avisa. */
var ART_MAX_JSON      = 45000;   // margen sobre el límite real de la celda
var ART_MAX_BLOQUES   = 200;
var ART_MAX_TEXTO     = 6000;    // por bloque de texto
var ART_MAX_TITULO    = 160;
var ART_MAX_RESUMEN   = 400;
var ART_MAX_FILAS_TAB = 60;
var ART_MAX_COLS_TAB  = 12;
var ART_MAX_DIAGRAMA  = 20000;  // XML de draw.io por bloque

// ── UTILIDADES DE HOJA ───────────────────────────────────────────────────────

function artSheet_(ss, crear) {
  let sheet = ss.getSheetByName(ART_SHEET);
  if (!sheet && crear) {
    sheet = ss.insertSheet(ART_SHEET);
    sheet.appendRow(ART_HEADERS);
    sheet.getRange(1, 1, 1, ART_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function artVistasSheet_(ss, crear) {
  let sheet = ss.getSheetByName(ART_VISTAS_SHEET);
  if (!sheet && crear) {
    sheet = ss.insertSheet(ART_VISTAS_SHEET);
    sheet.appendRow(ART_VISTAS_HEADERS);
    sheet.getRange(1, 1, 1, ART_VISTAS_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Columnas por NOMBRE, nunca por posición (regla 3 de la casa). */
function artCols_(hdr) {
  const h = hdr.map(function (x) { return String(x).toLowerCase().trim(); });
  const buscar = function (test) { return h.findIndex(test); };
  return {
    id:        buscar(function (x) { return x.indexOf('id') === 0 || x === 'id'; }),
    titulo:    buscar(function (x) { return x.indexOf('titulo') > -1 || x.indexOf('título') > -1; }),
    resumen:   buscar(function (x) { return x.indexOf('resumen') > -1; }),
    contenido: buscar(function (x) { return x.indexOf('contenido') > -1 || x.indexOf('json') > -1; }),
    estado:    buscar(function (x) { return x.indexOf('estado') > -1; }),
    autores:   buscar(function (x) { return x.indexOf('autor') > -1; }),
    creado:    buscar(function (x) { return x.indexOf('creado') > -1; }),
    editado:   buscar(function (x) { return x === 'editado' || x.indexOf('editado ') === 0 || (x.indexOf('editado') > -1 && x.indexOf('por') === -1); }),
    editadoPor: buscar(function (x) { return x.indexOf('editado por') > -1 || x.indexOf('editadopor') > -1; })
  };
}

function artVistasCols_(hdr) {
  const h = hdr.map(function (x) { return String(x).toLowerCase().trim(); });
  return {
    id:      h.findIndex(function (x) { return x.indexOf('articulo') > -1 || x.indexOf('artículo') > -1 || x === 'id'; }),
    correo:  h.findIndex(function (x) { return x.indexOf('correo') > -1 || x.indexOf('mail') > -1; }),
    nombre:  h.findIndex(function (x) { return x.indexOf('nombre') > -1; }),
    primera: h.findIndex(function (x) { return x.indexOf('primera') > -1; }),
    ultima:  h.findIndex(function (x) { return x.indexOf('ultima') > -1 || x.indexOf('última') > -1; }),
    veces:   h.findIndex(function (x) { return x.indexOf('veces') > -1; })
  };
}

function artNuevoId_() {
  return 'art-' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
}

function artInvalidarCache_() {
  try {
    const c = CacheService.getScriptCache();
    c.remove('artIndice_v1');
    c.remove('artRecientes_v1');
  } catch (e) {}
}

/** Puerta de ESCRITURA. Leer artículos no pasa por aquí: los lee cualquier sesión. */
function artGate_(email) {
  try {
    const id = secIdentidadConBloque_(email, ART_BLOQUE_PERM);
    return id.ok
      ? { ok: true, email: id.email, nombre: id.nombre }
      : { ok: false, error: id.error };
  } catch (e) {
    Logger.log('artGate_: ' + e);
    return { ok: false, error: 'No pudimos verificar tu cuenta. Vuelve a entrar al sistema e inténtalo de nuevo.' };
  }
}

/** Identidad de quien LEE. Sin ella se puede leer igual; solo no se registra la lectura. */
function artQuienLee_(email) {
  const declarado = String(email || '').trim().toLowerCase();
  if (declarado) {
    try {
      const id = secIdentidad_(declarado);
      if (id.ok) return { ok: true, correo: id.email, nombre: id.nombre || '' };
    } catch (e) {}
  }
  let dominio = '';
  try { dominio = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch (e) {}
  return dominio ? { ok: true, correo: dominio, nombre: '' } : { ok: false };
}

// ── SANEO DEL CONTENIDO ──────────────────────────────────────────────────────
// Esta es la pieza de seguridad del módulo. Todo lo que llega del navegador pasa por aquí
// ANTES de tocar la hoja, y lo que no encaje en la forma conocida se descarta. El cliente
// también valida, pero el cliente es sugerencia: esto es la aduana.

/**
 * URL admisible dentro de un artículo.
 *
 * Solo https. Ni `javascript:`, ni `data:`, ni protocolo relativo (`//otro.sitio`), que el
 * navegador resuelve como una URL absoluta a otro dominio y es el disfraz clásico. Se
 * comprueba el principio de la cadena YA RECORTADA, porque un espacio o un salto de línea
 * delante son suficientes para colar `  javascript:` en algunos navegadores.
 */
function artUrlSegura_(u) {
  const s = String(u == null ? '' : u).trim();
  if (!s) return '';
  if (!/^https:\/\/[^\s"'<>]+$/i.test(s)) return '';
  if (s.length > 2000) return '';
  return s;
}

/** Texto plano acotado: sin caracteres de control, con la longitud que le toque. */
function artTexto_(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .slice(0, max || ART_MAX_TEXTO);
}

/**
 * Un párrafo es una lista de PARTES: {t:'texto'} o {t:'texto', url:'https://…'}.
 *
 * Se eligió esto en vez de guardar el párrafo con marcado dentro (HTML o markdown) porque un
 * hipervínculo es lo único que el texto necesita llevar, y así el texto nunca deja de ser
 * texto: al pintarlo, cada parte es un nodo de texto o un <a> con su href ya validado, y no
 * hay ninguna cadena que un navegador tenga que interpretar como marcado.
 */
function artPartes_(v) {
  const arr = Array.isArray(v) ? v : [];
  const out = [];
  let total = 0;
  for (let i = 0; i < arr.length && out.length < 200; i++) {
    const p = arr[i] || {};
    const t = artTexto_(p.t, ART_MAX_TEXTO - total);
    if (!t) continue;
    total += t.length;
    const url = artUrlSegura_(p.url);
    out.push(url ? { t: t, url: url } : { t: t });
    if (total >= ART_MAX_TEXTO) break;
  }
  return out;
}

/** Los cuatro tipos de documento de Google que sabemos incrustar. */
var ART_DOC_CLASES = ['documento', 'presentacion', 'hoja', 'archivo'];

/**
 * Saca de una URL de Google el tipo de documento y su ID.
 *
 * Se guarda el ID y no la URL entera a propósito: la URL que copia alguien de la barra trae
 * `/edit`, `#slide=id.p3`, `?usp=sharing` y a veces el correo con el que la abrió. El visor se
 * arma después a partir del ID, así que lo que se guarda es el mínimo que identifica al
 * documento y nada de lo que arrastraba la sesión de quien lo pegó.
 */
function artDocDeUrl_(url) {
  const s = String(url || '').trim();
  if (!/^https:\/\/(docs|drive)\.google\.com\//i.test(s)) return null;
  const m = s.match(/\/(document|presentation|spreadsheets|file)\/d\/([a-zA-Z0-9_-]{10,})/);
  if (!m) return null;
  const clase = m[1] === 'document' ? 'documento'
              : m[1] === 'presentation' ? 'presentacion'
              : m[1] === 'spreadsheets' ? 'hoja' : 'archivo';
  return { clase: clase, docId: m[2] };
}

/** Un bloque saneado, o null si no hay nada que guardar. */
function artBloque_(b) {
  if (!b || typeof b !== 'object') return null;
  const tipo = String(b.tipo || '').trim().toLowerCase();

  if (tipo === 'titulo') {
    const texto = artTexto_(b.texto, ART_MAX_TITULO);
    if (!texto) return null;
    // Solo dos niveles: un artículo del Portal no es una tesis, y más niveles se leen peor.
    return { tipo: 'titulo', texto: texto, nivel: Number(b.nivel) === 3 ? 3 : 2 };
  }

  if (tipo === 'texto') {
    const partes = artPartes_(b.partes);
    if (!partes.length) return null;
    return { tipo: 'texto', partes: partes };
  }

  if (tipo === 'lista') {
    const items = (Array.isArray(b.items) ? b.items : [])
      .map(function (it) { return artPartes_(it); })
      .filter(function (p) { return p.length; })
      .slice(0, 60);
    if (!items.length) return null;
    return { tipo: 'lista', items: items, ordenada: b.ordenada === true };
  }

  if (tipo === 'imagen') {
    const url = artUrlSegura_(b.url);
    if (!url) return null;
    return { tipo: 'imagen', url: url, alt: artTexto_(b.alt, 200), pie: artTexto_(b.pie, 300) };
  }

  if (tipo === 'tabla') {
    const filas = (Array.isArray(b.filas) ? b.filas : [])
      .slice(0, ART_MAX_FILAS_TAB)
      .map(function (f) {
        return (Array.isArray(f) ? f : []).slice(0, ART_MAX_COLS_TAB)
          .map(function (c) { return artTexto_(c, 500); });
      })
      .filter(function (f) { return f.length; });
    if (!filas.length) return null;
    // Todas las filas con el mismo ancho: una tabla dentada se pinta rota y la culpa
    // acaba pareciendo del render.
    const ancho = filas.reduce(function (m, f) { return Math.max(m, f.length); }, 0);
    filas.forEach(function (f) { while (f.length < ancho) f.push(''); });
    return { tipo: 'tabla', filas: filas, encabezado: b.encabezado !== false };
  }

  if (tipo === 'documento') {
    let clase = String(b.clase || '').trim().toLowerCase();
    let docId = String(b.docId || '').trim();
    // Se acepta también la URL pegada, por comodidad del cliente: aquí se convierte.
    if (!docId && b.url) {
      const d = artDocDeUrl_(b.url);
      if (d) { clase = d.clase; docId = d.docId; }
    }
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(docId)) return null;
    if (ART_DOC_CLASES.indexOf(clase) < 0) clase = 'archivo';
    return { tipo: 'documento', clase: clase, docId: docId, titulo: artTexto_(b.titulo, 200) };
  }

  if (tipo === 'diagrama') {
    /* Un diagrama es el XML de draw.io (diagrams.net), guardado como TEXTO.
       Se guarda el XML y no una imagen exportada por dos razones: sigue siendo
       editable dentro del artículo —un flujo se corrige más veces de las que se
       dibuja— y no hay que subir ni versionar un PNG en Drive por cada retoque.
       Y no se pinta nunca en nuestro DOM: viaja al visor de diagrams.net dentro de
       un iframe, que es lo que lo mantiene aislado por más marcado que traiga. */
    const xml = String(b.xml == null ? '' : b.xml).trim();
    if (!xml || xml.length > ART_MAX_DIAGRAMA) return null;
    // Tiene que parecer lo que dice ser. Cualquier otra cosa no se guarda: un blob
    // de texto arbitrario en este campo acabaría en el iframe de un tercero.
    if (!/^<(mxfile|mxGraphModel)[\s>]/i.test(xml)) return null;
    return {
      tipo: 'diagrama',
      xml: xml,
      titulo: artTexto_(b.titulo, 200),
      alto: Math.min(900, Math.max(240, Number(b.alto) || 420))
    };
  }

  if (tipo === 'separador') return { tipo: 'separador' };

  return null;   // tipo desconocido: se descarta entero, no se adivina
}

/** Contenido completo saneado y versionado. Nunca lanza: devuelve algo pintable. */
function artSanearContenido_(c) {
  const bruto = (c && Array.isArray(c.bloques)) ? c.bloques : [];
  const bloques = [];
  for (let i = 0; i < bruto.length && bloques.length < ART_MAX_BLOQUES; i++) {
    const b = artBloque_(bruto[i]);
    if (b) bloques.push(b);
  }
  return { v: 1, bloques: bloques };
}

/** Texto plano de un artículo, para que el buscador general lo encuentre por su contenido. */
function artTextoPlano_(contenido) {
  const partes = [];
  ((contenido && contenido.bloques) || []).forEach(function (b) {
    if (b.tipo === 'titulo') partes.push(b.texto);
    else if (b.tipo === 'texto') partes.push((b.partes || []).map(function (p) { return p.t; }).join(''));
    else if (b.tipo === 'lista') (b.items || []).forEach(function (it) {
      partes.push((it || []).map(function (p) { return p.t; }).join(''));
    });
    else if (b.tipo === 'tabla') (b.filas || []).forEach(function (f) { partes.push(f.join(' ')); });
    else if (b.tipo === 'imagen') { if (b.pie) partes.push(b.pie); }
    else if (b.tipo === 'documento' || b.tipo === 'diagrama') { if (b.titulo) partes.push(b.titulo); }
  });
  return partes.join(' ').replace(/\s+/g, ' ').trim();
}

// ── LECTURA ──────────────────────────────────────────────────────────────────

/** Fila → objeto de artículo. `conContenido` a false para las listas (pesa mucho). */
function artDeFila_(row, c, tz, conContenido) {
  let contenido = { v: 1, bloques: [] };
  if (c.contenido > -1 && row[c.contenido]) {
    try { contenido = JSON.parse(String(row[c.contenido])); } catch (e) {}
  }
  const estado = c.estado > -1 ? String(row[c.estado] || '').trim().toLowerCase() : 'borrador';
  const art = {
    id:      String(row[c.id] || '').trim(),
    titulo:  c.titulo > -1 ? String(row[c.titulo] || '').trim() : '',
    resumen: c.resumen > -1 ? String(row[c.resumen] || '').trim() : '',
    estado:  ART_ESTADOS.indexOf(estado) > -1 ? estado : 'borrador',
    autores: c.autores > -1 ? String(row[c.autores] || '').trim() : '',
    creado:  c.creado > -1 && row[c.creado] instanceof Date ? Utilities.formatDate(row[c.creado], tz, 'yyyy-MM-dd') : '',
    editado: c.editado > -1 && row[c.editado] instanceof Date ? Utilities.formatDate(row[c.editado], tz, 'yyyy-MM-dd') : '',
    editadoPor: c.editadoPor > -1 ? String(row[c.editadoPor] || '').trim() : ''
  };
  if (conContenido) {
    art.contenido = artSanearContenido_(contenido);
  } else {
    // Para la lista basta con saber si tiene cuerpo y cuánto se tarda en leerlo.
    const plano = artTextoPlano_(contenido);
    art.palabras = plano ? plano.split(/\s+/).length : 0;
    art.minutos = Math.max(1, Math.round(art.palabras / 200));
    art.bloques = ((contenido && contenido.bloques) || []).length;
  }
  return art;
}

/**
 * Lista de artículos.
 *
 * Los PUBLICADOS los ve cualquiera con sesión; los BORRADORES solo quien puede publicar.
 * No es cortesía: un borrador es trabajo a medias y enseñarlo al equipo entero convierte
 * cada artículo en una obra pública desde la primera frase.
 */
function artListar(email, opts) {
  try {
    opts = opts || {};
    const puedeEditar = artGate_(email).ok;
    const ss = portalSS_();
    const sheet = artSheet_(ss, false);
    if (!sheet) return { status: 'ok', articulos: [], puedeEditar: puedeEditar };
    const last = sheet.getLastRow();
    if (last < 2) return { status: 'ok', articulos: [], puedeEditar: puedeEditar };

    const data = sheet.getRange(1, 1, last, sheet.getLastColumn()).getValues();
    const c = artCols_(data[0]);
    if (c.id < 0) return { status: 'error', error: 'La hoja de artículos no tiene columna ID.' };
    const tz = Session.getScriptTimeZone();
    const out = [];
    for (let i = 1; i < data.length; i++) {
      if (!String(data[i][c.id] || '').trim()) continue;
      const art = artDeFila_(data[i], c, tz, false);
      if (art.estado !== 'publicado' && !puedeEditar) continue;
      out.push(art);
    }
    // Lo más reciente primero: un artículo se lee cuando sale, no cuando toca por orden.
    out.sort(function (a, b) { return String(b.editado || b.creado).localeCompare(String(a.editado || a.creado)); });
    /* `total` es cuántos podía ver ESTA persona, antes del tope. Lo necesita el carril del
       Portal para saber si tiene que ofrecer un «Ver todos»: sin el dato solo puede elegir
       entre no ofrecerlo nunca —y entonces quien lee no tiene puerta a los demás— u
       ofrecerlo siempre, incluso cuando el carril ya los está enseñando todos. */
    const tope = Number(opts.tope) || 0;
    return { status: 'ok', articulos: tope ? out.slice(0, tope) : out,
             total: out.length, puedeEditar: puedeEditar };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

/**
 * Un artículo por su id, con su contenido — y de paso queda registrada la lectura.
 *
 * El registro va aquí y no en una llamada aparte del cliente porque una llamada aparte se
 * puede no hacer: lo que cuenta como leído es lo que el servidor sirvió.
 */
function artObtener(id, email) {
  try {
    const clave = String(id || '').trim();
    if (!clave) return { status: 'error', error: 'Falta el identificador del artículo.' };
    const puedeEditar = artGate_(email).ok;

    const ss = portalSS_();
    const sheet = artSheet_(ss, false);
    if (!sheet) return { status: 'error', error: 'Todavía no hay artículos publicados.' };
    const last = sheet.getLastRow();
    if (last < 2) return { status: 'error', error: 'Todavía no hay artículos publicados.' };

    const data = sheet.getRange(1, 1, last, sheet.getLastColumn()).getValues();
    const c = artCols_(data[0]);
    const tz = Session.getScriptTimeZone();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][c.id] || '').trim() !== clave) continue;
      const art = artDeFila_(data[i], c, tz, true);
      if (art.estado !== 'publicado' && !puedeEditar) {
        return { status: 'error', error: 'Ese artículo todavía es un borrador.' };
      }
      const plano = artTextoPlano_(art.contenido);
      art.palabras = plano ? plano.split(/\s+/).length : 0;
      art.minutos = Math.max(1, Math.round(art.palabras / 200));
      if (art.estado === 'publicado') artRegistrarVista_(ss, clave, email);
      return { status: 'ok', articulo: art, puedeEditar: puedeEditar };
    }
    return { status: 'error', error: 'No encontramos ese artículo.' };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

// ── ESCRITURA ────────────────────────────────────────────────────────────────

/**
 * Crea o actualiza un artículo. payload: {id?, titulo, resumen, contenido, estado?, asesor}.
 *
 * La fila se reescribe entera (esta hoja es nuestra y no tiene columnas ajenas), pero
 * `Creado`, `Autores` y el ID se conservan de la fila previa: quien corrige la errata de un
 * artículo ajeno no pasa a ser su autor. Lo que sí cambia en cada guardado es `Editado` y
 * `Editado por`, que es justo lo que esas dos columnas dicen que son.
 */
function artGuardar(payload) {
  try {
    const gate = artGate_(payload && payload.asesor);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const titulo = artTexto_(payload && payload.titulo, ART_MAX_TITULO).trim();
    if (!titulo) return { status: 'error', error: 'El artículo necesita un título.' };
    const resumen = artTexto_(payload && payload.resumen, ART_MAX_RESUMEN).trim();
    const contenido = artSanearContenido_(payload && payload.contenido);

    const json = JSON.stringify(contenido);
    if (json.length > ART_MAX_JSON) {
      return { status: 'error', error: 'El artículo es demasiado largo para guardarse de una pieza. ' +
        'Divídelo en dos o quita alguna imagen pegada en grande.' };
    }

    let estado = String((payload && payload.estado) || '').trim().toLowerCase();
    if (ART_ESTADOS.indexOf(estado) < 0) estado = 'borrador';

    const ss = portalSS_();
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) {
      return { status: 'error', error: 'Hay otro guardado en curso. Inténtalo en un momento.' };
    }
    try {
      const sheet = artSheet_(ss, true);
      const width = Math.max(sheet.getLastColumn(), ART_HEADERS.length);
      const c = artCols_(sheet.getRange(1, 1, 1, width).getValues()[0]);
      const id = (payload && payload.id && String(payload.id).trim()) || artNuevoId_();

      // Fila previa, si la hay.
      let fila = -1, previa = null;
      const last = sheet.getLastRow();
      if (last > 1) {
        const ids = sheet.getRange(2, c.id + 1, last - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]).trim() === id) { fila = i + 2; break; }
        }
        if (fila > 0) previa = sheet.getRange(fila, 1, 1, width).getValues()[0];
      }

      const ahora = new Date();
      const row = [];
      for (let i = 0; i < width; i++) row[i] = '';
      row[c.id] = id;
      if (c.titulo > -1)    row[c.titulo] = titulo;
      if (c.resumen > -1)   row[c.resumen] = resumen;
      if (c.contenido > -1) row[c.contenido] = json;
      if (c.estado > -1)    row[c.estado] = estado;
      if (c.autores > -1)   row[c.autores] = (previa && String(previa[c.autores] || '').trim()) || gate.nombre || gate.email;
      if (c.creado > -1)    row[c.creado] = (previa && previa[c.creado] instanceof Date) ? previa[c.creado] : ahora;
      if (c.editado > -1)   row[c.editado] = ahora;
      if (c.editadoPor > -1) row[c.editadoPor] = gate.nombre || gate.email;

      if (fila > 0) sheet.getRange(fila, 1, 1, width).setValues([row]);
      else sheet.appendRow(row);
      SpreadsheetApp.flush();
      artInvalidarCache_();
      return { status: 'ok', id: id, estado: estado, bloques: contenido.bloques.length };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

/** Publica o devuelve a borrador. Celda a celda: no hace falta reescribir la fila. */
function artPublicar(id, publicado, email) {
  try {
    const gate = artGate_(email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const ss = portalSS_();
    const sheet = artSheet_(ss, false);
    if (!sheet) return { status: 'error', error: 'No encontramos la hoja de artículos.' };
    const width = Math.max(sheet.getLastColumn(), ART_HEADERS.length);
    const c = artCols_(sheet.getRange(1, 1, 1, width).getValues()[0]);
    const fila = artFilaDe_(sheet, c, String(id || '').trim());
    if (fila < 0) return { status: 'error', error: 'No encontramos ese artículo.' };
    if (c.estado < 0) return { status: 'error', error: 'La hoja no tiene columna Estado.' };
    sheet.getRange(fila, c.estado + 1).setValue(publicado ? 'publicado' : 'borrador');
    if (c.editado > -1) sheet.getRange(fila, c.editado + 1).setValue(new Date());
    if (c.editadoPor > -1) sheet.getRange(fila, c.editadoPor + 1).setValue(gate.nombre || gate.email);
    artInvalidarCache_();
    return { status: 'ok', estado: publicado ? 'publicado' : 'borrador' };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

function artEliminar(id, email) {
  try {
    const gate = artGate_(email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const ss = portalSS_();
    const sheet = artSheet_(ss, false);
    if (!sheet) return { status: 'error', error: 'No encontramos la hoja de artículos.' };
    const c = artCols_(sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), ART_HEADERS.length)).getValues()[0]);
    const fila = artFilaDe_(sheet, c, String(id || '').trim());
    if (fila < 0) return { status: 'error', error: 'No encontramos ese artículo.' };
    sheet.deleteRow(fila);
    artInvalidarCache_();
    // Las vistas se quedan: son el registro de que alguien lo leyó, y ese hecho no
    // desaparece porque se borre el artículo. La hoja las conserva con su id.
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

function artFilaDe_(sheet, c, id) {
  if (c.id < 0 || !id) return -1;
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const ids = sheet.getRange(2, c.id + 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return -1;
}

// ── REGISTRO DE LECTURA ──────────────────────────────────────────────────────

/**
 * Deja constancia de que alguien leyó un artículo. Idempotente por correo: una fila por
 * persona y artículo, con la primera vez, la última y cuántas.
 *
 * Dos cuidados:
 *   · Una VENTANA de media hora en caché evita que refrescar la pantalla cinco veces cuente
 *     cinco lecturas y, sobre todo, evita cinco escrituras en la hoja por una sola persona
 *     que está leyendo.
 *   · Si no se consigue el candado NO se registra y no pasa nada. Leer un artículo no puede
 *     fallar porque el registro de lectura esté ocupado: el registro es el acompañante, no
 *     el acto.
 */
function artRegistrarVista_(ss, idArticulo, email) {
  try {
    const quien = artQuienLee_(email);
    if (!quien.ok) return false;

    const ventana = 'artVisto_' + idArticulo + '_' + quien.correo;
    try {
      if (CacheService.getScriptCache().get(ventana)) return false;
      CacheService.getScriptCache().put(ventana, '1', 1800);
    } catch (e) {}

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return false;
    try {
      const sheet = artVistasSheet_(ss, true);
      const width = Math.max(sheet.getLastColumn(), ART_VISTAS_HEADERS.length);
      const c = artVistasCols_(sheet.getRange(1, 1, 1, width).getValues()[0]);
      if (c.id < 0 || c.correo < 0) return false;
      const ahora = new Date();

      let fila = -1;
      const last = sheet.getLastRow();
      if (last > 1) {
        const data = sheet.getRange(2, 1, last - 1, width).getValues();
        for (let i = 0; i < data.length; i++) {
          if (String(data[i][c.id] || '').trim() === idArticulo &&
              String(data[i][c.correo] || '').trim().toLowerCase() === quien.correo) { fila = i + 2; break; }
        }
      }

      if (fila > 0) {
        if (c.ultima > -1) sheet.getRange(fila, c.ultima + 1).setValue(ahora);
        if (c.veces > -1) {
          const n = Number(sheet.getRange(fila, c.veces + 1).getValue()) || 1;
          sheet.getRange(fila, c.veces + 1).setValue(n + 1);
        }
      } else {
        const row = [];
        for (let i = 0; i < width; i++) row[i] = '';
        row[c.id] = idArticulo;
        row[c.correo] = quien.correo;
        if (c.nombre > -1) row[c.nombre] = quien.nombre || '';
        if (c.primera > -1) row[c.primera] = ahora;
        if (c.ultima > -1) row[c.ultima] = ahora;
        if (c.veces > -1) row[c.veces] = 1;
        sheet.appendRow(row);
      }
      return true;
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log('artRegistrarVista_: ' + e);
    return false;
  }
}

/** Quién ha leído un artículo. Solo para quien puede publicarlos. */
function artLectores(id, email) {
  try {
    const gate = artGate_(email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const clave = String(id || '').trim();
    const ss = portalSS_();
    const sheet = artVistasSheet_(ss, false);
    if (!sheet) return { status: 'ok', lectores: [], total: 0 };
    const last = sheet.getLastRow();
    if (last < 2) return { status: 'ok', lectores: [], total: 0 };
    const width = Math.max(sheet.getLastColumn(), ART_VISTAS_HEADERS.length);
    const data = sheet.getRange(1, 1, last, width).getValues();
    const c = artVistasCols_(data[0]);
    const tz = Session.getScriptTimeZone();
    const out = [];
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][c.id] || '').trim() !== clave) continue;
      const primera = c.primera > -1 && data[i][c.primera] instanceof Date ? data[i][c.primera] : null;
      out.push({
        correo: String(data[i][c.correo] || '').trim(),
        nombre: c.nombre > -1 ? String(data[i][c.nombre] || '').trim() : '',
        primera: primera ? Utilities.formatDate(primera, tz, 'yyyy-MM-dd HH:mm') : '',
        veces: c.veces > -1 ? (Number(data[i][c.veces]) || 1) : 1
      });
    }
    out.sort(function (a, b) { return String(a.primera).localeCompare(String(b.primera)); });
    return { status: 'ok', lectores: out, total: out.length };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

// ── IMÁGENES ─────────────────────────────────────────────────────────────────

/**
 * Sube una imagen de artículo a Drive y devuelve su URL. payload: {dataUrl, nombre, asesor}.
 *
 * Existe en vez de reutilizar `subirImagenAnuncio` por una sola razón, y es de permisos: esa
 * función exige el bloque 'anuncios', así que quien tuviera 'articulos' y no 'anuncios' —el
 * reparto que esta fase hace posible— no habría podido pegar una imagen en su artículo. La
 * carpeta de Drive y el formato de la URL son los mismos: lo único que cambia es la puerta.
 */
function artSubirImagen(payload) {
  try {
    const gate = artGate_(payload && payload.asesor);
    if (!gate.ok) return { status: 'error', error: gate.error };
    if (!payload || !payload.dataUrl) return { status: 'error', error: 'No se recibió la imagen.' };
    const m = String(payload.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return { status: 'error', error: 'Formato de imagen no válido.' };
    const mime = m[1];
    if (mime.indexOf('image/') !== 0) return { status: 'error', error: 'El archivo no es una imagen.' };
    const bytes = Utilities.base64Decode(m[2]);
    if (bytes.length > 8 * 1024 * 1024) return { status: 'error', error: 'La imagen supera el límite de 8 MB.' };

    const nombre = 'art-' + (String(payload.nombre || 'imagen').replace(/[^\w.\-]+/g, '_')) + '-' + Date.now();
    const file = portalCarpetaAnuncios_().createFile(Utilities.newBlob(bytes, mime, nombre));
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    return { status: 'ok', url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600' };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

// ── ÍNDICE PARA EL BUSCADOR GENERAL ──────────────────────────────────────────

/**
 * Lo que el buscador general necesita para encontrar un artículo: su título, su resumen y
 * su texto como palabras clave. El contenido entero no viaja —un artículo largo pesa más
 * que todo el resto del índice junto—, solo un extracto suficiente para que buscar una
 * frase que sale en el cuerpo lo encuentre.
 *
 * Caché de cinco minutos: el índice lo pide cada pantalla que monta el buscador, y esta
 * lectura recorre la hoja entera con los contenidos dentro.
 */
function artIndiceBuscador(email) {
  try {
    const cacheado = portalCacheGet_('artIndice_v1');
    if (cacheado) return cacheado;

    const ss = portalSS_();
    const sheet = artSheet_(ss, false);
    const resp = { status: 'ok', articulos: [] };
    if (!sheet) return resp;
    const last = sheet.getLastRow();
    if (last < 2) return resp;

    const data = sheet.getRange(1, 1, last, sheet.getLastColumn()).getValues();
    const c = artCols_(data[0]);
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][c.id] || '').trim();
      if (!id) continue;
      const estado = c.estado > -1 ? String(data[i][c.estado] || '').trim().toLowerCase() : '';
      if (estado !== 'publicado') continue;   // un borrador no se busca: todavía no existe
      let contenido = {};
      if (c.contenido > -1 && data[i][c.contenido]) {
        try { contenido = JSON.parse(String(data[i][c.contenido])); } catch (e) {}
      }
      resp.articulos.push({
        id: id,
        titulo: c.titulo > -1 ? String(data[i][c.titulo] || '').trim() : '',
        resumen: c.resumen > -1 ? String(data[i][c.resumen] || '').trim() : '',
        texto: artTextoPlano_(contenido).slice(0, 1200)
      });
    }
    try {
      const json = JSON.stringify(resp);
      if (json.length < 95000) CacheService.getScriptCache().put('artIndice_v1', json, 300);
    } catch (e) {}
    return resp;
  } catch (error) {
    return { status: 'error', error: error.toString(), articulos: [] };
  }
}
