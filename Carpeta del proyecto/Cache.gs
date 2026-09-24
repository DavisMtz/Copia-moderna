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
 *      Ese TTL se ajusta solo: el mismo contador de generación ya sabe cada cuánto cambian los
 *      datos de verdad, así que los valores de COT_TTL son la referencia, no una cifra fija
 *      (ver cotTtl_). En hora pico se acorta; de madrugada o en fin de semana se estira.
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

/**
 * Segundos de vida por tipo de dato (tope de CacheService: 21600 = 6 h).
 * Son el punto de partida, no el valor final: cotTtl_ los mueve dentro de una banda según el
 * ritmo real de escritura. Ajustar aquí sigue siendo la forma de subir o bajar todo el tramo.
 */
var COT_TTL = {
  listaAsesor: 180,   // "mis cotizaciones": el propio asesor las quiere ver recién guardadas
  busqueda: 90,       // búsqueda global: barrido completo + fuzzy, lo más caro de todo
  supervision: 240,   // panel de supervisión: mismo dato para todos los avanzados
  metricas: 600,      // métricas de correos: agregado de 30 días, tolera estar un rato viejo
  remitente: 21600    // alias de Gmail: cambia casi nunca
};

/**
 * Los que NO se ajustan solos, porque no salen de la hoja de Cotizaciones y el ritmo de escritura
 * no dice nada sobre ellos. `remitente` lo escribe Correos.gs en la caché del usuario.
 */
var COT_TTL_FIJOS = { remitente: true };

// ── Generación y ritmo de escritura ───────────────────────────────────────────

var COT_GEN_PROP = 'COT_CACHE_GEN';
var COT_ESTADO_MEMO = null;   // una sola lectura de propiedades por ejecución

/** Peso del hueco más reciente al promediar el ritmo; el resto es historia. */
var COT_RITMO_ALFA = 0.35;
var COT_RITMO_TOPE = 21600;   // un hueco de más de 6 h ya no dice nada nuevo

/** Banda en la que cotTtl_ puede mover cada valor de COT_TTL. */
var COT_TTL_FACTOR_MIN = 0.5;
var COT_TTL_FACTOR_MAX = 6;
var COT_TTL_PISO = 60;        // por debajo de esto la caché deja de amortizar
var COT_TTL_TECHO = 21600;    // tope duro de CacheService

function cotAhora_() { return Math.floor(Date.now() / 1000); }

/**
 * Estado de la BD, guardado en UNA sola propiedad con formato "gen|ultima|ritmo":
 *   gen      contador que forma parte de todas las claves
 *   ultima   epoch en segundos de la última escritura
 *   ritmo    media suavizada de segundos entre escrituras (0 = todavía no se sabe)
 *
 * Va todo junto a propósito: medir el ritmo no cuesta ni una llamada más a PropertiesService que
 * antes. El formato viejo ("12", sin barras) se lee igual —gen=12 y sin historial—, así que un
 * proyecto ya desplegado no necesita migración: el TTL simplemente arranca en su valor base.
 */
function cotEstado_() {
  if (COT_ESTADO_MEMO) return COT_ESTADO_MEMO;
  let partes = [];
  try {
    partes = String(PropertiesService.getScriptProperties().getProperty(COT_GEN_PROP) || '').split('|');
  } catch (e) {
    partes = [];
  }
  COT_ESTADO_MEMO = {
    gen: String(parseInt(partes[0], 10) || 0),
    ultima: parseInt(partes[1], 10) || 0,
    ritmo: parseInt(partes[2], 10) || 0
  };
  return COT_ESTADO_MEMO;
}

/** Generación actual de la BD. Cambia cada vez que alguien escribe. */
function cotGeneracion_() {
  return cotEstado_().gen;
}

/**
 * Invalida TODA la caché de la BD de cotizaciones. Llamar SIEMPRE después de una escritura
 * correcta (nunca antes: si la escritura falla, la caché vigente sigue siendo la verdad).
 * De paso anota cuándo ocurrió y cada cuánto vienen ocurriendo, que es lo que alimenta cotTtl_.
 */
function cotInvalidarCache_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const partes = String(props.getProperty(COT_GEN_PROP) || '').split('|');
    const actual = parseInt(partes[0], 10) || 0;
    const ultima = parseInt(partes[1], 10) || 0;
    const ritmoPrevio = parseInt(partes[2], 10) || 0;

    const ahora = cotAhora_();
    const siguiente = String((actual + 1) % 1000000);

    // El hueco entre esta escritura y la anterior es la única medida real de cada cuánto cambian
    // los datos. Se promedia suavizado para que ni una ráfaga de tres guardados seguidos ni una
    // pausa suelta para comer decidan por sí solas la caducidad de todo el mundo.
    let ritmo = ritmoPrevio;
    if (ultima > 0 && ahora >= ultima) {
      const hueco = Math.min(Math.max(ahora - ultima, 1), COT_RITMO_TOPE);
      ritmo = ritmoPrevio > 0
        ? Math.round(ritmoPrevio * (1 - COT_RITMO_ALFA) + hueco * COT_RITMO_ALFA)
        : hueco;
    }

    props.setProperty(COT_GEN_PROP, siguiente + '|' + ahora + '|' + ritmo);
    COT_ESTADO_MEMO = { gen: siguiente, ultima: ahora, ritmo: ritmo };
  } catch (e) {
    // Sin generación no hay invalidación fina; los TTL cortos acotan el daño.
    Logger.log('No se pudo invalidar la caché de cotizaciones: ' + e.message);
  }
}

/**
 * Caducidad efectiva de una entrada: parte del valor base de COT_TTL y lo acerca al tiempo que
 * de verdad tarda el dato en cambiar.
 *
 * `ritmo` dice cada cuánto se escribe; `silencio`, cuánto lleva sin escribirse. Manda el mayor de
 * los dos: en plena jornada gana el ritmo (TTL corto, los datos se mueven y una lectura vieja se
 * nota) y de madrugada o en fin de semana gana el silencio (TTL largo, releer la hoja entera para
 * devolver exactamente lo mismo es tirar cuota). El resultado nunca se aleja más de la mitad ni de
 * seis veces el valor base, así que COT_TTL sigue mandando y un ritmo mal medido no puede hacer
 * daño: en el peor caso la red de seguridad tarda unos minutos más o menos en saltar.
 *
 * @param {number} baseSegundos  Valor de COT_TTL para ese tipo de dato.
 * @return {number} Segundos, dentro de [COT_TTL_PISO, COT_TTL_TECHO].
 */
function cotTtl_(baseSegundos) {
  const base = Math.max(parseInt(baseSegundos, 10) || 300, 1);
  const est = cotEstado_();
  if (!est.ritmo || !est.ultima) return Math.min(base, COT_TTL_TECHO);   // sin historial, base tal cual

  const silencio = Math.max(0, cotAhora_() - est.ultima);
  const calma = Math.max(Math.max(est.ritmo, silencio), COT_TTL_PISO);
  const ttl = Math.min(Math.max(calma, base * COT_TTL_FACTOR_MIN), base * COT_TTL_FACTOR_MAX);
  return Math.min(Math.round(ttl), COT_TTL_TECHO);
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
 *
 * Aquí —y solo aquí— el TTL pasa por cotTtl_: todo lo que entra por este envoltorio sale de la
 * hoja de Cotizaciones, que es justo el dato cuyo ritmo de cambio conocemos. Quien necesite una
 * caducidad exacta (diagnósticos, la copia de una página externa) llama a cotCachePut_ directo.
 *
 * @param {string} nombre       Clave lógica (sin generación ni prefijo).
 * @param {number} ttlSegundos  Vida base de la entrada; se ajusta al ritmo real de escritura.
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
  if (cacheable) cotCachePut_(nombre, fresco, cotTtl_(ttlSegundos));
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
  secSoloInterno_('cotCacheDiagnostico');
  const est = cotEstado_();
  const antes = est.gen;
  const silencio = est.ultima ? Math.max(0, cotAhora_() - est.ultima) : null;

  // Antes de invalidar: así se ve la caducidad tal como la están usando las pantallas ahora.
  const ttl = {};
  Object.keys(COT_TTL).forEach(function (k) {
    const fijo = !!COT_TTL_FIJOS[k];
    ttl[k] = { base: COT_TTL[k], efectivo: fijo ? COT_TTL[k] : cotTtl_(COT_TTL[k]), fijo: fijo };
  });

  cotCachePut_('_diag', { hola: 'mundo', t: new Date().toISOString() }, 60);
  const leido = cotCacheGet_('_diag');
  cotInvalidarCache_();
  const despues = cotGeneracion_();

  Logger.log('Generación: %s → %s (deben ser distintas)', antes, despues);
  Logger.log('Escritura/lectura: %s', leido ? 'OK ✔' : 'FALLÓ ✖');
  Logger.log('Tras invalidar, la clave vieja ya no se ve: %s', cotCacheGet_('_diag') ? '✖ sigue ahí' : '✔');
  Logger.log('Ritmo de escritura: %s', est.ritmo
    ? est.ritmo + ' s entre cambios · ' + silencio + ' s desde el último'
    : 'sin historial todavía (los TTL se quedan en su valor base)');
  Object.keys(ttl).forEach(function (k) {
    Logger.log('  TTL %s: %s s (base %s)%s', k, ttl[k].efectivo, ttl[k].base, ttl[k].fijo ? ' · fijo' : '');
  });

  return {
    generacionAntes: antes, generacionDespues: despues, ok: !!leido,
    ritmo: est.ritmo, silencio: silencio, ttl: ttl
  };
}
