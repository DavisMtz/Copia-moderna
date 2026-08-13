/**
 * =================================================================================================
 * CACHÉ DE LECTURA | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Capa única de caché para las lecturas de la hoja de Cotizaciones. Existe porque cada pantalla
 * que se abre relee TODA la hoja (getDataRange().getValues()): con unos cientos de folios eso son
 * segundos de espera y cuota consumida, en datos que cambian pocas veces al día.
 *
 * Reglas que hacen que esta caché no pueda mentir:
 *
 *   1. INVALIDACIÓN POR ESCRITURA, no por tiempo. Toda función que escribe en la BD llama a
 *      cotInvalidarCache_(). Eso incrementa una "generación" que forma parte de TODAS las claves,
 *      así que la siguiente lectura ya no encuentra nada y va a la hoja. Es lo único que evita el
 *      clásico "guardé la cotización y sigue saliendo la anterior".
 *   2. TTL corto además de lo anterior, como red de seguridad si alguien edita la hoja a mano.
 *   3. Nunca se cachea una respuesta de error ni una operación de escritura.
 *   4. Si CacheService falla o el valor no cabe, se sirve el dato leyendo la hoja. La caché jamás
 *      es la causa de que algo no funcione: quitarla entera solo hace la app más lenta.
 *
 * Límites reales de CacheService que esta capa respeta: ~100 KB por valor y 6 h de expiración.
 * Los valores grandes (todas las cotizaciones para el panel de supervisión) se guardan troceados.
 */

// ── Parámetros ────────────────────────────────────────────────────────────────

var COT_CACHE_PREFIJO = 'cot';
var COT_CACHE_TROZO = 90000;    // < 100 KB por valor
var COT_CACHE_MAX_TROZOS = 20;  // ~1.8 MB; más que eso se sirve sin caché

/** Segundos de vida por tipo de dato (tope de CacheService: 21600 = 6 h). */
var COT_TTL = {
  listaAsesor: 180,   // "mis cotizaciones": el propio asesor las quiere ver recién guardadas
  busqueda: 90,       // búsqueda global: barrido completo + fuzzy, lo más caro de todo
  supervision: 240,   // panel de supervisión: mismo dato para todos los avanzados
  metricas: 600,      // métricas de correos: agregado de 30 días, tolera estar un rato viejo
  remitente: 21600    // alias de Gmail: cambia casi nunca
};

// ── Generación (invalidación por escritura) ───────────────────────────────────

var COT_GEN_PROP = 'COT_CACHE_GEN';
var COT_GEN_MEMO = null;   // una sola lectura de propiedades por ejecución

/** Generación actual de la BD. Cambia cada vez que alguien escribe. */
function cotGeneracion_() {
  if (COT_GEN_MEMO !== null) return COT_GEN_MEMO;
  try {
    COT_GEN_MEMO = PropertiesService.getScriptProperties().getProperty(COT_GEN_PROP) || '0';
  } catch (e) {
    COT_GEN_MEMO = '0';
  }
  return COT_GEN_MEMO;
}

/**
 * Invalida TODA la caché de la BD de cotizaciones. Llamar SIEMPRE después de una escritura
 * correcta (nunca antes: si la escritura falla, la caché vigente sigue siendo la verdad).
 */
function cotInvalidarCache_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const actual = parseInt(props.getProperty(COT_GEN_PROP) || '0', 10) || 0;
    const siguiente = String((actual + 1) % 1000000);
    props.setProperty(COT_GEN_PROP, siguiente);
    COT_GEN_MEMO = siguiente;
  } catch (e) {
    // Sin generación no hay invalidación fina; los TTL cortos acotan el daño.
    Logger.log('No se pudo invalidar la caché de cotizaciones: ' + e.message);
  }
}

function cotClave_(nombre) {
  return COT_CACHE_PREFIJO + '_g' + cotGeneracion_() + '_' + nombre;
}

// ── Lectura / escritura troceada ──────────────────────────────────────────────

function cotCacheGet_(nombre) {
  try {
    const cache = CacheService.getScriptCache();
    const clave = cotClave_(nombre);
    const cabeza = cache.get(clave);
    if (!cabeza) return null;
    if (cabeza.indexOf('trozos:') !== 0) return JSON.parse(cabeza);

    const total = parseInt(cabeza.substring(7), 10);
    const claves = [];
    for (let i = 0; i < total; i++) claves.push(clave + '#' + i);
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

function cotCachePut_(nombre, objeto, ttlSegundos) {
  try {
    const json = JSON.stringify(objeto);
    const cache = CacheService.getScriptCache();
    const clave = cotClave_(nombre);
    const ttl = Math.min(ttlSegundos || 300, 21600);

    if (json.length <= COT_CACHE_TROZO) {
      cache.put(clave, json, ttl);
      return;
    }
    const mapa = {};
    let cursor = 0, indice = 0;
    while (cursor < json.length) {
      if (indice >= COT_CACHE_MAX_TROZOS) return;   // demasiado grande: se sirve sin caché
      let fin = Math.min(cursor + COT_CACHE_TROZO, json.length);
      // No partir un par suplente (emojis y acentos raros en observaciones).
      if (fin < json.length) {
        const code = json.charCodeAt(fin - 1);
        if (code >= 0xD800 && code <= 0xDBFF) fin--;
      }
      mapa[clave + '#' + indice] = json.substring(cursor, fin);
      cursor = fin;
      indice++;
    }
    mapa[clave] = 'trozos:' + indice;
    cache.putAll(mapa, ttl);
  } catch (e) {
    // Cuota, tamaño o servicio no disponible: no es fatal, simplemente no hay caché.
    Logger.log('cotCachePut_ (' + nombre + '): ' + e.message);
  }
}

/**
 * Envoltorio estándar: devuelve lo cacheado o ejecuta `productor` y lo guarda.
 * Solo se cachea cuando `aceptar` lo aprueba — por omisión, respuestas con success !== false.
 * @param {string} nombre       Clave lógica (sin generación ni prefijo).
 * @param {number} ttlSegundos  Vida de la entrada.
 * @param {function} productor  Función que lee la hoja y arma la respuesta.
 * @param {function=} aceptar   Recibe la respuesta; devuelve true si es cacheable.
 * @param {boolean=} forzar     true = ignora lo cacheado y relee (botón "Actualizar"), pero
 *                              deja el resultado fresco en la caché para los demás.
 */
function cotCacheado_(nombre, ttlSegundos, productor, aceptar, forzar) {
  const hit = forzar ? null : cotCacheGet_(nombre);
  if (hit !== null && hit !== undefined) return hit;

  const fresco = productor();
  const cacheable = aceptar ? aceptar(fresco) : !!(fresco && fresco.success !== false);
  if (cacheable) cotCachePut_(nombre, fresco, ttlSegundos);
  return fresco;
}

/** Clave corta y estable para un texto libre (términos de búsqueda). */
function cotHash_(texto) {
  try {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(texto || ''), Utilities.Charset.UTF_8);
    return bytes.map(function (b) { return ((b & 0xFF) + 0x100).toString(16).slice(1); }).join('').substring(0, 16);
  } catch (e) {
    return String(texto || '').replace(/[^a-z0-9]/gi, '').substring(0, 16).toLowerCase();
  }
}

/**
 * Diagnóstico manual: ejecutar desde el editor para ver si la caché responde.
 * No forma parte del flujo de la app.
 */
function cotCacheDiagnostico() {
  const antes = cotGeneracion_();
  cotCachePut_('_diag', { hola: 'mundo', t: new Date().toISOString() }, 60);
  const leido = cotCacheGet_('_diag');
  cotInvalidarCache_();
  const despues = cotGeneracion_();
  Logger.log('Generación: %s → %s (deben ser distintas)', antes, despues);
  Logger.log('Escritura/lectura: %s', leido ? 'OK ✔' : 'FALLÓ ✖');
  Logger.log('Tras invalidar, la clave vieja ya no se ve: %s', cotCacheGet_('_diag') ? '✖ sigue ahí' : '✔');
  return { generacionAntes: antes, generacionDespues: despues, ok: !!leido };
}
