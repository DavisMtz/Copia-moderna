/**
 * =================================================================================================
 * Portal Ventel — backend de LECTURA | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Sirve los datos que consumen las pantallas públicas del Portal (Index.html y Promociones.html).
 * Este script NO está ligado a la hoja del Portal, así que todas las lecturas van por ID
 * (portalSS_()). La AUTORÍA de anuncios y plantillas (menú "📢 Anuncios", Constructor*.html,
 * funciones de escritura) NO vive aquí: sigue en el script ligado a la hoja del Portal.
 *
 * Funciones expuestas al cliente:
 *   fetchToolsData()       → Index.html  (herramientas, paqueterías, formatos, plantillas, anuncios…)
 *   fetchPromoCounts()     → Index.html  (widget "Hoy en promociones")
 *   fetchApplicationData() → Promociones.html (promos, MKP y calendario)
 *   reportBrokenLink(r)    → ambas (botón "Reportar" de las tarjetas → hoja "Reportes" del Portal)
 */

// ── HOJA DEL PORTAL ───────────────────────────────────────────────────────────

// Respaldo en código; lo que manda es la propiedad de script 'PORTAL_SHEET_ID'
// (ver secGuardarConfiguracion en Seguridad.gs).
var PORTAL_SHEET_ID = '1l3cdEOUnD1Rgk1VCDfx48NWd_mcgIQ7Gkt2YhwbRs34';

function portalSheetId_() {
  return secConfig_('PORTAL_SHEET_ID', PORTAL_SHEET_ID);
}

function portalSS_() {
  return SpreadsheetApp.openById(portalSheetId_());
}

// ── CACHÉ ─────────────────────────────────────────────────────────────────────
// Las hojas del Portal cambian poco; servir desde CacheService evita releer 5+
// hojas en cada visita (límite por llave ~100KB; si se excede se sirve sin caché).

var PORTAL_CACHE_TTL_SECONDS = 600; // 10 minutos

function portalCacheGet_(key) {
  try {
    const hit = CacheService.getScriptCache().get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) {}
  return null;
}

function portalCachePut_(key, obj) {
  try {
    const json = JSON.stringify(obj);
    if (json.length < 95000) CacheService.getScriptCache().put(key, json, PORTAL_CACHE_TTL_SECONDS);
  } catch (e) {}
}

// ── DATOS DEL PORTAL (Herramientas, Presentaciones, Paqueterías, Formatos, PdePago, Plantillas, Anuncios) ──

function fetchToolsData() {
  const cached = portalCacheGet_('toolsData_v1');
  if (cached) return cached;
  const data = buildToolsData_();
  if (data.status === 'ok') portalCachePut_('toolsData_v1', data);
  return data;
}

/**
 * Lee una hoja con encabezados en la primera fila y devuelve un arreglo de objetos.
 * @param {Spreadsheet} ss        Hoja de cálculo del Portal.
 * @param {string} sheetName      Nombre de la hoja a leer.
 * @param {Object<string,string[]>} fields  Mapa campoSalida → alias de encabezado.
 * @param {string} requiredKey    Campo cuyo valor vacío hace que la fila se omita.
 */
function readPortalSheet_(ss, sheetName, fields, requiredKey) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (!data.length) return [];

  const hdr = data[0].map(h => h.toString().toLowerCase().trim());
  const idx = {};
  Object.keys(fields).forEach(key => {
    idx[key] = hdr.findIndex(h => fields[key].some(alias => h.includes(alias)));
  });

  const reqIdx = idx[requiredKey];
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (reqIdx < 0 || !row[reqIdx] || !row[reqIdx].toString().trim()) continue;
    const obj = {};
    Object.keys(fields).forEach(key => {
      obj[key] = idx[key] > -1 ? String(row[idx[key]] || '').trim() : '';
    });
    out.push(obj);
  }
  return out;
}

function buildToolsData_() {
  const response = {
    herramientas: [],
    presentaciones: [],
    paqueterias: [],
    formatos: [],
    pdePago: [],
    plantillas: [],
    avisos: [],
    anuncios: [],
    status: 'ok',
    error: null
  };

  try {
    const ss = portalSS_();

    // Hoja: Herramientas — Nombre | Enlace | Como acceder | Descripcion | Claves
    response.herramientas = readPortalSheet_(ss, 'Herramientas', {
      nombre:      ['nombre'],
      enlace:      ['enlace', 'liga', 'link', 'url'],
      comoAcceder: ['acceder', 'acceso', 'como'],
      descripcion: ['descrip'],
      claves:      ['clave']
    }, 'nombre');

    // Hoja: Presentaciones — Nombre | LIGA | DESCRPCION
    // El encabezado de la hoja dice «DESCRPCION» (sin la i). Con el alias 'descrip'
    // esa columna nunca se encontraba y la descripción de las presentaciones llegaba
    // vacía al Portal. 'descr' cubre las dos grafías.
    response.presentaciones = readPortalSheet_(ss, 'Presentaciones', {
      nombre:      ['nombre'],
      liga:        ['liga', 'enlace', 'link', 'url'],
      descripcion: ['descr']
    }, 'nombre');

    // Hoja: Paqueterias — Nombre | Liga | Soms
    response.paqueterias = readPortalSheet_(ss, 'Paqueterias', {
      nombre: ['nombre'],
      liga:   ['liga', 'enlace', 'link', 'url'],
      soms:   ['soms', 'sistema']
    }, 'nombre');

    // Hoja: Formatos — ACCESO | OBSERVACIONES | LIGA
    response.formatos = readPortalSheet_(ss, 'Formatos', {
      acceso:        ['acceso', 'nombre', 'formato'],
      observaciones: ['observ', 'nota'],
      liga:          ['liga', 'enlace', 'link']
    }, 'acceso');

    // Hoja: PdePago — Nombre | Detalles | Liga
    response.pdePago = readPortalSheet_(ss, 'PdePago', {
      nombre:   ['nombre'],
      detalles: ['detalle', 'descrip', 'info'],
      liga:     ['liga', 'enlace', 'link', 'url', 'simulad']
    }, 'nombre');

    // Hoja: Plantillas — Titulo | Tipo | Asunto | Cuerpo | Consideraciones
    response.plantillas = readPortalSheet_(ss, 'Plantillas', {
      titulo:          ['titulo', 'título', 'nombre', 'plantilla'],
      tipo:            ['tipo'],
      asunto:          ['asunto', 'subject'],
      cuerpo:          ['cuerpo', 'body', 'mensaje', 'texto', 'contenido'],
      consideraciones: ['consider', 'nota', 'escalam', 'copia', 'observ']
    }, 'titulo');

    // Anuncios (hoja "Anuncios" en JSON + respaldo legacy "Avisos")
    response.anuncios = readPortalAnuncios_(ss);
    // Compatibilidad: cachés antiguas del cliente aún leen "avisos" (solo banners).
    response.avisos = response.anuncios
      .filter(a => a.formato === 'banner')
      .map(a => ({ mensaje: a.mensaje || '', tipo: a.tono || 'info' }));

  } catch (error) {
    response.status = 'error';
    response.error = error.toString();
    Logger.log('fetchToolsData error: ' + error);
  }

  return response;
}

// ── ANUNCIOS (solo lectura de la hoja "Anuncios" del Portal) ──────────────────
// Cada fila es una publicación: ID | Formato | Activo | Orden | Desde | Hasta | Datos (JSON) | Autor | Creado

var PORTAL_ANUNCIOS_SHEET    = 'Anuncios';
var PORTAL_ANUNCIOS_FORMATOS = ['banner', 'destacado', 'tarjeta', 'modal'];

// Localiza las columnas por encabezado (mismo criterio flexible que readPortalSheet_).
// Es la MISMA lista que portalAnunciosColsW_ (escritura): se dejan las dos porque la
// lectura pública no necesita saber de autoría para pintar un banner, pero desde que
// cada publicación lleva responsable visible, autor/responsable/creado también entran
// aquí. Quien añada una columna las toca las dos.
function portalAnunciosCols_(hdr) {
  const h = hdr.map(x => x.toString().toLowerCase().trim());
  return {
    id:      h.findIndex(x => x.includes('id')),
    formato: h.findIndex(x => x.includes('formato')),
    activo:  h.findIndex(x => x.includes('activo')),
    orden:   h.findIndex(x => x.includes('orden')),
    desde:   h.findIndex(x => x.includes('desde') || x.includes('inicio')),
    hasta:   h.findIndex(x => x.includes('hasta') || x.includes('vigen') || x.includes('fecha')),
    datos:   h.findIndex(x => x.includes('dato') || x.includes('json')),
    autor:   h.findIndex(x => x.includes('autor')),
    responsable: h.findIndex(x => x.includes('responsable')),
    creado:  h.findIndex(x => x.includes('creado') || x.includes('creacion'))
  };
}

/**
 * Nombre legible de quien publicó, para pintarlo en el Portal.
 *
 * Manda la columna "Responsable" (el nombre con el que la persona está dada de alta,
 * que publicarAnuncio guarda desde ahora). Las filas de antes solo tienen el correo:
 * de él se saca un nombre presentable en vez de enseñar la dirección entera, porque
 * el Portal lo ven todos los asesores y un correo ahí es un dato de contacto que
 * nadie pidió publicar. "maria.lopez@…" → "Maria Lopez".
 */
function portalNombreResponsable_(nombre, correo) {
  const n = String(nombre || '').trim();
  if (n) return n;
  const c = String(correo || '').trim();
  if (!c) return '';
  const usuario = c.split('@')[0].replace(/[._-]+/g, ' ').trim();
  if (!usuario) return '';
  return usuario.split(/\s+/).map(function (p) {
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' ');
}

function portalEsActivo_(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'true' || s === 'si' || s === 'sí' || s === '1' || s === 'x' || s === 'activo';
}

/**
 * Lee la hoja "Anuncios" (publicaciones en JSON) y la hoja legacy "Avisos".
 * Devuelve los anuncios visibles: activos, ya iniciados y no expirados, por "Orden".
 */
function readPortalAnuncios_(ss) {
  const now = new Date();
  // "Hasta" es inclusivo de todo su día: un anuncio expira solo cuando su fecha
  // cae en un día ANTERIOR a hoy (una fecha a las 00:00 sigue visible toda la jornada).
  const hoy0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const out = [];

  const sheet = ss.getSheetByName(PORTAL_ANUNCIOS_SHEET);
  if (sheet) {
    // Antes de leer, se le pone ID a lo que no lo tenga: sin esto una fila escrita a
    // mano en el Sheet solo tenía identidad por su POSICIÓN, y ese es el enlace que se
    // rompe en silencio cuando alguien inserta una fila más arriba (ver pubAsegurarIdsAnuncios_).
    pubAsegurarIdsAnuncios_(sheet);
    const data = sheet.getDataRange().getValues();
    if (data.length > 1) {
      const c = portalAnunciosCols_(data[0]);
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (c.activo > -1 && !portalEsActivo_(row[c.activo])) continue;
        if (c.desde > -1 && row[c.desde] instanceof Date && row[c.desde] > now) continue; // programado
        if (c.hasta > -1 && row[c.hasta] instanceof Date && row[c.hasta] < hoy0) continue; // expirado
        let datos = {};
        if (c.datos > -1 && row[c.datos]) {
          try { datos = JSON.parse(String(row[c.datos])); } catch (e) { datos = {}; }
        }
        const formato = c.formato > -1 && row[c.formato]
          ? String(row[c.formato]).trim().toLowerCase() : 'banner';
        if (PORTAL_ANUNCIOS_FORMATOS.indexOf(formato) < 0) continue;
        // `datos` va PRIMERO y las claves de la fila después: la columna manda sobre el
        // JSON. Un `id` o un `responsable` escritos dentro del JSON —a mano, o por una
        // versión futura del constructor— no pueden suplantar los de la hoja.
        out.push(Object.assign({}, datos, {
          id:      pubIdDeFila_(c.id > -1 ? row[c.id] : '', row, c, i),
          formato: formato,
          orden:   c.orden > -1 && row[c.orden] !== '' ? Number(row[c.orden]) || 0 : 0,
          responsable: portalNombreResponsable_(
            c.responsable > -1 ? row[c.responsable] : '',
            c.autor > -1 ? row[c.autor] : ''),
          creado: c.creado > -1 && row[c.creado] instanceof Date
            ? Utilities.formatDate(row[c.creado], Session.getScriptTimeZone(), 'yyyy-MM-dd') : ''
        }));
      }
    }
  }

  // Respaldo de migración: avisos viejos de la hoja "Avisos" → formato banner.
  const sheetA = ss.getSheetByName('Avisos');
  if (sheetA) {
    const dataA = sheetA.getDataRange().getValues();
    if (dataA.length > 1) {
      const hdr = dataA[0].map(h => h.toString().toLowerCase().trim());
      const iMsg   = hdr.findIndex(h => h.includes('mensaje') || h.includes('aviso') || h.includes('texto'));
      const iTipo  = hdr.findIndex(h => h.includes('tipo'));
      const iHasta = hdr.findIndex(h => h.includes('hasta') || h.includes('vigen') || h.includes('fecha'));
      for (let i = 1; i < dataA.length; i++) {
        const row = dataA[i];
        if (iMsg < 0 || !row[iMsg] || !row[iMsg].toString().trim()) continue;
        if (iHasta > -1 && row[iHasta] instanceof Date && row[iHasta] < hoy0) continue;
        out.push({
          // La hoja legacy no tiene columna ID y no se le añade una: es de solo lectura
          // y está en vías de desaparecer. Su identidad sale del CONTENIDO, no de la
          // fila, para que insertar un aviso arriba no le cambie el id —y con él el
          // enlace compartido y el "no volver a mostrarme esto"— a todos los de abajo.
          id:      'avi-' + pubHashCorto_(String(row[iMsg]).trim()),
          formato: 'banner',
          orden:   1000 + i,
          tono:    iTipo > -1 && row[iTipo] ? String(row[iTipo]).trim().toLowerCase() : 'info',
          mensaje: String(row[iMsg]).trim()
        });
      }
    }
  }

  out.sort((a, b) => (a.orden || 0) - (b.orden || 0));
  return out;
}

// ── DATOS DE PROMOCIONES (para Promociones.html) ─────────────────────────────

var PORTAL_CALENDAR_ID = 'liverpool.com.mx_7vl69nu0ep7fp5mkn36bjejheg@group.calendar.google.com';

function fetchApplicationData() {
  const cached = portalCacheGet_('appData_v1');
  if (cached) return cached;
  const data = buildApplicationData_();
  if (data.status === 'success') portalCachePut_('appData_v1', data);
  return data;
}

function buildApplicationData_() {
  const response = {
    promociones: [],
    eventos: [],
    status: 'success',
    error: null
  };

  try {
    const ss = portalSS_();

    // Hoja: Promociones
    const sheetPromos = ss.getSheetByName('Promociones');
    if (sheetPromos) {
      const data = sheetPromos.getDataRange().getValues();
      const headers = data[0].map(h => h.toString().toLowerCase().trim());

      const idxDir  = headers.indexOf('direccion') > -1 ? headers.indexOf('direccion') : headers.findIndex(h => h.includes('direcci'));
      const idxBan  = headers.findIndex(h => h.includes('banner / carrusel'));
      const idxPro  = headers.findIndex(h => h.includes('promoción 2026'));
      const idxDesc = headers.findIndex(h => h.includes('desc mkp'));
      // OJO con "contiene" aquí: el encabezado de la columna E dice «Desc Mkp (Se
      // MARCA el cuadro en color amarillo…)», así que findIndex(h.includes('marca'))
      // enganchaba ESA columna y el monitor enseñaba el texto de Desc Mkp como si
      // fuera la marca del producto. La columna buena se llama "Marca" a secas.
      let idxMarca = headers.indexOf('marca');
      if (idxMarca < 0) idxMarca = headers.findIndex(h => h.includes('marca'));
      const idxVig  = headers.findIndex(h => h.includes('vigencia'));
      const idxLiga = headers.findIndex(h => h.includes('liga'));

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row[idxDir] && !row[idxBan]) continue;
        response.promociones.push({
          origen:    'Promociones',
          direccion: row[idxDir]  || '',
          categoria: row[idxBan]  || '',
          promocion: row[idxPro]  || row[idxDesc] || '',
          marca:     idxMarca > -1 ? row[idxMarca] : '',
          vigencia:  row[idxVig]  || '',
          liga:      row[idxLiga] || '#'
        });
      }
    }

    // Hoja: MKP (Marketplace)
    const sheetMKP = ss.getSheetByName('MKP');
    if (sheetMKP) {
      const dataMKP = sheetMKP.getDataRange().getValues();
      const headersMKP = dataMKP[0].map(h => h.toString().toLowerCase().trim());

      const idxDirMKP = headersMKP.findIndex(h => h.includes('direcci'));
      const idxBanMKP = headersMKP.findIndex(h => h.includes('banner / carrusel'));
      const idxProMKP = headersMKP.findIndex(h => h === 'promoción' || h === 'promocion');
      const idxProMkt = headersMKP.findIndex(h => h.includes('promoción mktplace'));
      const idxVigMKP = headersMKP.findIndex(h => h.includes('vigencia'));
      const idxLigaMKP= headersMKP.findIndex(h => h.includes('liga'));

      for (let i = 1; i < dataMKP.length; i++) {
        const row = dataMKP[i];
        if (!row[idxDirMKP] && !row[idxBanMKP]) continue;
        response.promociones.push({
          origen:    'Marketplace',
          direccion: row[idxDirMKP] || '',
          categoria: row[idxBanMKP] || '',
          promocion: row[idxProMkt] || row[idxProMKP] || '',
          marca:     'Marketplace',
          vigencia:  row[idxVigMKP] || '',
          liga:      row[idxLigaMKP] || '#'
        });
      }
    }

    // Google Calendar (eventos comerciales a 90 días)
    try {
      const cal = CalendarApp.getCalendarById(secConfig_('PORTAL_CALENDAR_ID', PORTAL_CALENDAR_ID));
      if (cal) {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + 90);

        const events = cal.getEvents(start, futureDate);
        response.eventos = events.map(e => ({
          titulo:      e.getTitle(),
          inicio:      e.getStartTime().getTime(),
          fin:         e.getEndTime().getTime(),
          esTodoElDia: e.isAllDayEvent(),
          descripcion: e.getDescription(),
          ubicacion:   e.getLocation()
        }));
      }
    } catch (calError) {
      Logger.log('Error de Calendario: ' + calError);
    }

  } catch (error) {
    response.status = 'error';
    response.error = error.toString();
    Logger.log(error);
  }

  return response;
}

// ── CONTADORES DE PROMOS (widget del dashboard en Index.html) ─────────────────

/**
 * Lo que la portada del Portal enseña de promociones.
 *
 * Los dos contadores de siempre (`activas`, `porTerminar`) siguen igual y con el mismo
 * significado. Desde la portada «Tu turno» se suman dos campos, sin quitar ninguno, para
 * que un cliente viejo siga funcionando contra este servidor y uno nuevo contra el viejo:
 *
 *   promociones → las vigentes, las que terminan antes primero (hasta PROMO_PORTADA_TOPE),
 *                 con los días que les quedan calculados aquí con el MISMO parseVigencia_
 *                 que decide si están activas. El cliente no vuelve a interpretar fechas.
 *   eventos     → el calendario comercial que ya se lee para el Monitor, recortado a lo
 *                 que toca las próximas cuatro semanas.
 *
 * Todo sale de fetchApplicationData(), que ya está en caché: no hay lectura nueva de hojas
 * ni del Calendario.
 */
var PROMO_PORTADA_TOPE = 8;

function fetchPromoCounts() {
  try {
    const data = fetchApplicationData(); // ya cacheado
    const now = new Date();
    const DIA = 86400000;
    let activas = 0, porTerminar = 0;
    const vigentes = [];

    (data.promociones || []).forEach(function (p) {
      const r = parseVigencia_(p.vigencia, now);
      if (r && now >= r.start && now <= r.end) {
        activas++;
        if ((r.end - now) / DIA <= 3) porTerminar++;
        vigentes.push({
          direccion: String(p.direccion || '').trim(),
          categoria: String(p.categoria || '').trim(),
          promocion: String(p.promocion || '').trim(),
          marca:     String(p.marca || '').trim(),
          origen:    String(p.origen || ''),
          vigencia:  String(p.vigencia || ''),
          fin:       r.end.getTime(),
          // 0 = termina hoy, 1 = mañana… (el fin es a las 23:59:59 de su último día)
          dias:      Math.floor((r.end - now) / DIA)
        });
      }
    });
    vigentes.sort(function (a, b) { return a.fin - b.fin; });

    const desde = now.getTime() - DIA, hasta = now.getTime() + 28 * DIA;
    const eventos = (data.eventos || [])
      .filter(function (e) { return e && e.fin >= desde && e.inicio <= hasta; })
      .sort(function (a, b) { return a.inicio - b.inicio; })
      .slice(0, 10)
      .map(function (e) {
        return {
          titulo:      String(e.titulo || ''),
          inicio:      e.inicio,
          fin:         e.fin,
          esTodoElDia: !!e.esTodoElDia,
          descripcion: String(e.descripcion || '').slice(0, 240)
        };
      });

    return {
      status: 'ok', activas: activas, porTerminar: porTerminar,
      promociones: vigentes.slice(0, PROMO_PORTADA_TOPE),
      eventos: eventos
    };
  } catch (error) {
    return { status: 'error', error: error.toString(), activas: 0, porTerminar: 0 };
  }
}

// Mismo formato de vigencia que interpreta Promociones.html ("3 al 15 de junio", "10 de mayo"…)
function parseVigencia_(vigenciaStr, now) {
  if (!vigenciaStr) return null;
  const s = String(vigenciaStr).toLowerCase();
  const year = now.getFullYear();

  let m = s.match(/(\d{1,2})\s*(?:de\s+)?([a-záéíóú]+)?\s*(?:al?|hasta(?:\s+el)?|[-–—])\s*(\d{1,2})\s*(?:de\s+)?([a-záéíóú]+)/i);
  if (m) {
    const d1 = parseInt(m[1]), d2 = parseInt(m[3]);
    let mi2 = monthIdx_(m[4]), mi1 = monthIdx_(m[2]);
    if (mi2 === undefined && mi1 !== undefined) mi2 = mi1;
    if (mi1 === undefined && mi2 !== undefined) mi1 = (d1 <= d2) ? mi2 : (mi2 + 11) % 12;
    if (mi1 !== undefined && mi2 !== undefined) {
      const y2 = (mi2 < mi1) ? year + 1 : year;
      return { start: new Date(year, mi1, d1, 0, 0, 0), end: new Date(y2, mi2, d2, 23, 59, 59) };
    }
  }
  m = s.match(/(\d{1,2})\s*(?:de\s+)?([a-záéíóú]+)/i);
  if (m) {
    const mi = monthIdx_(m[2]);
    if (mi !== undefined) {
      const d = parseInt(m[1]);
      return { start: new Date(year, mi, d, 0, 0, 0), end: new Date(year, mi, d, 23, 59, 59) };
    }
  }
  return null;
}

function monthIdx_(name) {
  if (!name) return undefined;
  const pref = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const n = String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (let i = 0; i < 12; i++) if (n.indexOf(pref[i]) === 0) return i;
  return undefined;
}

// ── REPORTE DE ENLACES CAÍDOS (botón "Reportar" en las tarjetas) ──────────────
// Escribe en la hoja "Reportes" del Portal (única escritura de este archivo).

// ── AUTORÍA DE ANUNCIOS (ESCRITURA) — vista de usuario avanzado ───────────────
// Antes esto vivía SOLO en el script ligado a la hoja del Portal (Constructor.html
// como sidebar). Se porta aquí para que un usuario AVANZADO cree/edite anuncios
// desde la web app (?page=anuncios). Escribe en la hoja "Anuncios" del Portal por
// ID (portalSS_) — el mismo destino que lee readPortalAnuncios_.
// Gate: el que edita debe ser un usuario registrado y AVANZADO (metVerificarAsesor_).

var PORTAL_ANUNCIOS_HEADERS = ['ID', 'Formato', 'Activo', 'Orden', 'Desde', 'Hasta', 'Datos (JSON)', 'Autor', 'Responsable', 'Creado'];

// Carpeta destino de las imágenes de anuncios.
// Manda el ID (fijo y estable); el nombre solo se usa como respaldo si el ID
// no es accesible (carpeta borrada, sin permisos o script en otra cuenta).
// Se puede sobrescribir con la propiedad de script 'PORTAL_ANUNCIOS_FOLDER_ID'.
var PORTAL_ANUNCIOS_FOLDER_ID = '1CPLtO65_xRWgL2IAuOG-n8UFMyMg8R97';
var PORTAL_ANUNCIOS_FOLDER    = 'Portal Ventel';

// Verifica sesión + permiso para publicar anuncios del Portal.
// Devuelve {ok, email, nombre} o {ok:false, error}.
function portalGateAvanzado_(email) {
  try {
    // Una sola puerta para todo el sistema (Seguridad.gs): manda el correo con el que
    // se inició sesión en el portal, que debe estar dado de alta en "Registros".
    //
    // Antes exigía "rol avanzado" a secas; ahora pide el BLOQUE 'anuncios' (Permisos.gs).
    // Para un supervisor no cambia nada —ese bloque viene con su rol— pero ahora se le
    // puede dar a alguien que solo se encarga de comunicación, sin abrirle de paso las
    // métricas del equipo y la revisión de cotizaciones.
    const id = secIdentidadConBloque_(email, 'anuncios');
    return id.ok
      ? { ok: true, email: id.email, nombre: id.nombre }
      : { ok: false, error: id.error };
  } catch (e) {
    Logger.log('portalGateAvanzado_: ' + e);
    return { ok: false, error: 'No pudimos verificar tu cuenta. Vuelve a entrar al sistema e inténtalo de nuevo.' };
  }
}

// Columnas de la hoja Anuncios para ESCRITURA (incluye autor/responsable/creado).
function portalAnunciosColsW_(hdr) {
  return portalAnunciosCols_(hdr);
}

/* Columnas que la hoja tiene que traer sí o sí, con el criterio que las reconoce.
   Existe porque las hojas de antes no las tenían: "Desde" se añadió al programar
   publicaciones y "Responsable" al pintar el autor en el Portal, y en los dos casos
   la alternativa era que el administrador editara el encabezado a mano. */
var PORTAL_ANUNCIOS_COLS_REQ = [
  { nombre: 'Desde',       test: function (s) { return s.includes('desde') || s.includes('inicio'); } },
  { nombre: 'Autor',       test: function (s) { return s.includes('autor'); } },
  { nombre: 'Responsable', test: function (s) { return s.includes('responsable'); } },
  { nombre: 'Creado',      test: function (s) { return s.includes('creado') || s.includes('creacion'); } }
];

function portalAnunciosSheetW_(ss) {
  let sheet = ss.getSheetByName(PORTAL_ANUNCIOS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PORTAL_ANUNCIOS_SHEET);
    sheet.appendRow(PORTAL_ANUNCIOS_HEADERS);
    sheet.getRange(1, 1, 1, PORTAL_ANUNCIOS_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Garantiza las columnas que las hojas viejas no traían. Se añaden de una vez y al
  // final: insertarlas en medio movería de sitio datos que ya están escritos.
  let hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const faltan = PORTAL_ANUNCIOS_COLS_REQ.filter(function (req) {
    return !hdr.some(function (x) { return req.test(String(x).toLowerCase()); });
  });
  if (faltan.length) {
    const desde = sheet.getLastColumn() + 1;
    const maxCols = sheet.getMaxColumns();
    // Una hoja recortada a sus columnas justas no tiene dónde crecer, y getRange()
    // más allá del último borde revienta en vez de estirarla (mismo cuidado que
    // pcAsegurarIds_ en PortalContenido.gs).
    if (desde + faltan.length - 1 > maxCols) sheet.insertColumnsAfter(maxCols, desde + faltan.length - 1 - maxCols);
    sheet.getRange(1, desde, 1, faltan.length)
      .setValues([faltan.map(function (f) { return f.nombre; })])
      .setFontWeight('bold');
  }
  return sheet;
}

// 'YYYY-MM-DD' → Date local (fin de día para Hasta; inicio para Desde). '' si vacío.
function portalParseFechaLocal_(str, inicio) {
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = inicio
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0)
    : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return isNaN(d.getTime()) ? '' : d;
}

function portalFillRow_(arr, len) {
  const out = [];
  for (let i = 0; i < len; i++) out[i] = (arr[i] === undefined || arr[i] === null) ? '' : arr[i];
  return out;
}

function portalFindAnuncioRow_(sheet, c, id) {
  if (c.id < 0) return -1;
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const ids = sheet.getRange(2, c.id + 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return -1;
}

/**
 * Carpeta donde se guardan las imágenes de los anuncios.
 * 1) Intenta abrir la carpeta FIJA por ID (lo normal).
 * 2) Si falla (ID inválido, sin permisos, carpeta en papelera), cae al respaldo
 *    por nombre para que la subida no se rompa, y lo deja en el log.
 */
function portalCarpetaAnuncios_() {
  const folderId = String(secConfig_('PORTAL_ANUNCIOS_FOLDER_ID', PORTAL_ANUNCIOS_FOLDER_ID) || '').trim();
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      Logger.log('No se pudo abrir la carpeta de anuncios por ID (' + folderId + '): ' + e);
    }
  }
  const it = DriveApp.getFoldersByName(PORTAL_ANUNCIOS_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PORTAL_ANUNCIOS_FOLDER);
}

// Invalida la caché del Portal para que el cambio se vea al recargar Index.html.
function portalInvalidarCacheAnuncios_() {
  try { CacheService.getScriptCache().remove('toolsData_v1'); } catch (e) {}
}

/** Crea o actualiza una publicación (JSON). payload: {id?, formato, activo, orden, desde, hasta, datos, asesor}. */
function publicarAnuncio(payload) {
  try {
    const gate = portalGateAvanzado_(payload && payload.asesor);
    if (!gate.ok) return { status: 'error', error: gate.error };
    if (!payload || !payload.formato) throw new Error('Falta el formato del anuncio.');
    const formato = String(payload.formato).trim().toLowerCase();
    if (PORTAL_ANUNCIOS_FORMATOS.indexOf(formato) < 0) throw new Error('Formato no válido: ' + formato);

    const ss = portalSS_();
    const sheet = portalAnunciosSheetW_(ss);
    const width = sheet.getLastColumn();
    const c = portalAnunciosColsW_(sheet.getRange(1, 1, 1, width).getValues()[0]);

    const datos = pubSanearDatos_(payload.datos && typeof payload.datos === 'object' ? payload.datos : {});
    const activo = payload.activo === undefined ? true : !!payload.activo;
    let orden = Number(payload.orden) || 0;
    const id = payload.id && String(payload.id).trim() ? String(payload.id).trim() : pubNuevoIdAnuncio_();

    const rowIdx = portalFindAnuncioRow_(sheet, c, id);

    /* LO NUEVO VA PRIMERO. Hasta ahora una publicación nueva nacía con orden 0 —igual
       que todas las demás—, y como el desempate es el orden de las filas y `appendRow`
       escribe al final, el anuncio recién publicado aparecía el ÚLTIMO del Portal:
       justo debajo de los de la semana pasada. Quien acaba de publicar algo espera
       verlo arriba, y encima ahora la primera tarjeta es la PRINCIPAL (F7), así que el
       sitio de honor se lo quedaba lo más viejo.

       Solo aplica al CREAR y solo si no se pidió un orden concreto: quien escribe un
       número en el constructor manda, y editar una publicación no la mueve de sitio. */
    if (rowIdx < 0 && !Number(payload.orden)) orden = pubOrdenParaNueva_(sheet, c);

    /* Autoría y fecha de alta se fijan al CREAR y no se vuelven a tocar. Hasta ahora
       "Creado" se reescribía en cada guardado, así que la columna decía "modificado por
       última vez" con el nombre de "Creado", y desde que el Portal enseña el responsable
       eso significaría que corregir una errata en el anuncio de otra persona te lo
       adjudica a ti. Si la fila viene de antes y no tiene autor, lo pone quien edita:
       un dato aproximado es mejor que la esquina vacía. */
    let autorPrevio = '', respPrevio = '', creadoPrevio = '';
    if (rowIdx > 0) {
      const previa = sheet.getRange(rowIdx, 1, 1, width).getValues()[0];
      if (c.autor > -1)       autorPrevio  = String(previa[c.autor] || '').trim();
      if (c.responsable > -1) respPrevio   = String(previa[c.responsable] || '').trim();
      if (c.creado > -1)      creadoPrevio = previa[c.creado] instanceof Date ? previa[c.creado] : '';
    }

    const rowValues = [];
    rowValues[c.id]      = id;
    rowValues[c.formato] = formato;
    rowValues[c.activo]  = activo;
    rowValues[c.orden]   = orden;
    if (c.desde > -1) rowValues[c.desde] = portalParseFechaLocal_(payload.desde, true);
    rowValues[c.hasta]   = portalParseFechaLocal_(payload.hasta);
    rowValues[c.datos]   = JSON.stringify(datos);
    if (c.autor > -1)       rowValues[c.autor]       = autorPrevio || gate.email;
    // El nombre legible es lo que se pinta en el Portal; el correo se queda en la hoja
    // para saber a quién preguntarle, pero no viaja a la pantalla pública.
    if (c.responsable > -1) rowValues[c.responsable] = respPrevio || gate.nombre || '';
    if (c.creado > -1)      rowValues[c.creado]      = creadoPrevio || new Date();

    if (rowIdx > 0) sheet.getRange(rowIdx, 1, 1, width).setValues([portalFillRow_(rowValues, width)]);
    else sheet.appendRow(portalFillRow_(rowValues, width));

    portalInvalidarCacheAnuncios_();
    return { status: 'ok', id: id };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

/** Devuelve TODAS las publicaciones (activas, inactivas y expiradas) para el administrador. */
function getAnunciosAdmin(email) {
  try {
    const gate = portalGateAvanzado_(email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const ss = portalSS_();
    const sheet = ss.getSheetByName(PORTAL_ANUNCIOS_SHEET);
    if (!sheet) return { status: 'ok', anuncios: [] };
    pubAsegurarIdsAnuncios_(sheet);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { status: 'ok', anuncios: [] };
    const c = portalAnunciosColsW_(data[0]);
    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const hoy0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const anuncios = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (c.id < 0 || !row[c.id]) continue;
      let datos = {};
      if (c.datos > -1 && row[c.datos]) { try { datos = JSON.parse(String(row[c.datos])); } catch (e) {} }
      const desde = c.desde > -1 && row[c.desde] instanceof Date ? row[c.desde] : null;
      const hasta = c.hasta > -1 && row[c.hasta] instanceof Date ? row[c.hasta] : null;
      const activo = c.activo > -1 ? portalEsActivo_(row[c.activo]) : true;
      let estado;
      if (!activo) estado = 'inactivo';
      else if (desde && desde > now) estado = 'programado';
      else if (hasta && hasta < hoy0) estado = 'expirado';
      else estado = 'activo';
      const creado = c.creado > -1 && row[c.creado] instanceof Date ? row[c.creado] : null;
      anuncios.push({
        id:      String(row[c.id]).trim(),
        formato: c.formato > -1 ? String(row[c.formato]).trim().toLowerCase() : 'banner',
        activo:  activo,
        estado:  estado,
        orden:   c.orden > -1 ? (Number(row[c.orden]) || 0) : 0,
        desde:   desde ? Utilities.formatDate(desde, tz, 'yyyy-MM-dd') : '',
        hasta:   hasta ? Utilities.formatDate(hasta, tz, 'yyyy-MM-dd') : '',
        datos:   datos,
        // Quién y cuándo. Aquí SÍ va el correo —es la pantalla de administración, y
        // saber a quién preguntarle por un anuncio ajeno es media razón para abrirla—;
        // en el Portal público solo viaja el nombre (portalNombreResponsable_).
        autor:       c.autor > -1 ? String(row[c.autor] || '').trim() : '',
        responsable: portalNombreResponsable_(
          c.responsable > -1 ? row[c.responsable] : '',
          c.autor > -1 ? row[c.autor] : ''),
        creado:  creado ? Utilities.formatDate(creado, tz, 'yyyy-MM-dd') : ''
      });
    }
    anuncios.sort((a, b) => (a.orden || 0) - (b.orden || 0));
    return { status: 'ok', anuncios: anuncios };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

function eliminarAnuncio(id, email) {
  try {
    const gate = portalGateAvanzado_(email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const ss = portalSS_();
    const sheet = ss.getSheetByName(PORTAL_ANUNCIOS_SHEET);
    if (!sheet) return { status: 'error', error: 'No encontramos dónde se guardan los anuncios. Avisa al equipo de Ventel.' };
    const c = portalAnunciosColsW_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
    const rowIdx = portalFindAnuncioRow_(sheet, c, String(id).trim());
    if (rowIdx < 0) return { status: 'error', error: 'No se encontró el anuncio.' };
    sheet.deleteRow(rowIdx);
    portalInvalidarCacheAnuncios_();
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

function toggleAnuncio(id, activo, email) {
  try {
    const gate = portalGateAvanzado_(email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const ss = portalSS_();
    const sheet = ss.getSheetByName(PORTAL_ANUNCIOS_SHEET);
    if (!sheet) return { status: 'error', error: 'No encontramos dónde se guardan los anuncios. Avisa al equipo de Ventel.' };
    const c = portalAnunciosColsW_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
    const rowIdx = portalFindAnuncioRow_(sheet, c, String(id).trim());
    if (rowIdx < 0 || c.activo < 0) return { status: 'error', error: 'No se encontró el anuncio.' };
    sheet.getRange(rowIdx, c.activo + 1).setValue(!!activo);
    portalInvalidarCacheAnuncios_();
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

/** Reordena un anuncio (dir: 'up' | 'down') reescribiendo el orden secuencial. */
function moverAnuncio(id, dir, email) {
  try {
    const gate = portalGateAvanzado_(email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const ss = portalSS_();
    const sheet = ss.getSheetByName(PORTAL_ANUNCIOS_SHEET);
    if (!sheet) return { status: 'error', error: 'No encontramos dónde se guardan los anuncios. Avisa al equipo de Ventel.' };
    const width = sheet.getLastColumn();
    const c = portalAnunciosColsW_(sheet.getRange(1, 1, 1, width).getValues()[0]);
    if (c.id < 0 || c.orden < 0) return { status: 'error', error: 'No pudimos reordenar los anuncios. Avisa al equipo de Ventel.' };
    const last = sheet.getLastRow();
    if (last < 3) return { status: 'ok' }; // 0-1 anuncios: nada que mover

    // Lista ordenada actual: [{id, rowIdx}]
    const rango = sheet.getRange(2, 1, last - 1, width).getValues();
    const items = rango.map((row, i) => ({ id: String(row[c.id]).trim(), orden: Number(row[c.orden]) || 0, rowIdx: i + 2 }))
      .filter(x => x.id)
      .sort((a, b) => a.orden - b.orden || a.rowIdx - b.rowIdx);
    const pos = items.findIndex(x => x.id === String(id).trim());
    if (pos < 0) return { status: 'error', error: 'No se encontró el anuncio.' };
    const swap = dir === 'up' ? pos - 1 : pos + 1;
    if (swap < 0 || swap >= items.length) return { status: 'ok' };
    const tmp = items[pos]; items[pos] = items[swap]; items[swap] = tmp;

    // Reescribe el orden secuencial (0..n-1) — pocas filas, escritura barata.
    items.forEach((it, i) => sheet.getRange(it.rowIdx, c.orden + 1).setValue(i));
    portalInvalidarCacheAnuncios_();
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

/** Sube una imagen (data:URL) a Drive y devuelve una URL pública. payload: {dataUrl, nombre, asesor}. */
function subirImagenAnuncio(payload) {
  try {
    const gate = portalGateAvanzado_(payload && payload.asesor);
    if (!gate.ok) return { status: 'error', error: gate.error };
    if (!payload || !payload.dataUrl) throw new Error('No se recibió la imagen.');
    const m = String(payload.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error('Formato de imagen no válido.');
    const mime = m[1];
    if (mime.indexOf('image/') !== 0) throw new Error('El archivo no es una imagen.');
    const bytes = Utilities.base64Decode(m[2]);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('La imagen supera el límite de 8 MB.');

    const nombre = (String(payload.nombre || 'anuncio').replace(/[^\w.\-]+/g, '_')) + '-' + Date.now();
    const blob = Utilities.newBlob(bytes, mime, nombre);
    // Crea el archivo DENTRO de la carpeta destino (no en la raíz del Drive).
    const file = portalCarpetaAnuncios_().createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

    return { status: 'ok', url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200', id: file.getId() };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}

/**
 * Utilidad de diagnóstico: ejecútala una vez desde el editor para confirmar que el
 * script sí puede abrir la carpeta destino y con qué nombre. No la llama el cliente.
 */
function probarCarpetaAnuncios() {
  secSoloInterno_('probarCarpetaAnuncios');
  const f = portalCarpetaAnuncios_();
  const info = 'Carpeta destino: ' + f.getName() + ' — ID: ' + f.getId() + ' — ' + f.getUrl();
  Logger.log(info);
  return info;
}

function reportBrokenLink(report) {
  try {
    // El Portal es público dentro del dominio y esta es su única escritura abierta:
    // se limita a 20 reportes por usuario cada hora para que nadie pueda inflar la hoja.
    let quien = '';
    try { quien = Session.getActiveUser().getEmail() || ''; } catch (e) {}
    const claveLimite = 'reporte_' + (quien || 'anonimo');
    if (secIntentosRevisar_(claveLimite, 20, 3600).bloqueado) {
      return { status: 'error', error: 'Recibimos varios reportes tuyos hace poco. Intenta más tarde.' };
    }
    secIntentosSumar_(claveLimite, 3600);

    const ss = portalSS_();
    let sheet = ss.getSheetByName('Reportes');
    if (!sheet) {
      sheet = ss.insertSheet('Reportes');
      sheet.appendRow(['Fecha', 'Sección', 'Nombre', 'Enlace', 'Usuario']);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    }
    sheet.appendRow([
      new Date(),
      String((report && report.seccion) || '').slice(0, 200),
      String((report && report.nombre) || '').slice(0, 200),
      String((report && report.enlace) || '').slice(0, 500),
      quien
    ]);
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error: error.toString() };
  }
}
