/**
 * =================================================================================================
 * VENTA CRUZADA — las promociones del Monitor para la extensión de Chrome | Sistema de cotizaciones Ventel
 * =================================================================================================
 * La extensión «Ventel Extractor de Bolsa» (desde la 2.6) pone en cada ficha de liverpool.com.mx
 * la tarjeta «Vende más con este artículo». Su apartado «Promoción de hoy» dice la promoción del
 * Monitor que le toca a esa ficha y la frase de apertura para el cliente, armada con la más fuerte
 * del Monitor. Es lo que pidió el equipo (04/10/2026): «la campaña que vaya con lo que el monitor
 * de descuentos tiene como descuento más agresivo».
 *
 * CÓMO LLEGA A LA EXTENSIÓN
 *   La portada del Portal (Index, parcial app_venta_cruzada.html) pide ventaCruzadaPromos() y deja
 *   la respuesta en un <script type="application/json" id="ventel-promos-datos">. La extensión lo
 *   lee con su content script de googleusercontent.com, y su service worker solo lo guarda si la
 *   pestaña es el Portal (producción o pruebas). Ni red nueva ni permisos nuevos de este lado.
 *
 * QUÉ ES «LA MÁS FUERTE»
 *   La misma cuenta que hace el Monitor en notas() (app_monitor.html): de las vigentes, en el orden
 *   de la hoja, la de mayor porcentaje, y en empate la primera. El porcentaje se lee con la MISMA
 *   regla (vcPctDe_ es pctDe), que no confunde «SOBRETASA 9MSI CON 2.97%» con un 97 %; los meses,
 *   con la de las tarjetas del Monitor (vcMsiDe_).
 *
 * POR QUÉ NO VA DENTRO DE LA PÁGINA (F3)
 *   Lo que viaja en la página lo paga el primer byte de CADA visita, y esto pesa unos 20 KB. La
 *   extensión no necesita más que una copia cada media hora: la portada la guarda en el navegador
 *   30 min y solo entonces vuelve a preguntar. Una llamada de fondo cada media hora por asesor
 *   cuesta menos que 20 KB en cada apertura del Portal.
 *
 * Pública y sin sesión, como fetchPromoCounts: son las promociones que ya enseña el Monitor.
 * Sale de fetchApplicationData(), que ya está en caché (appData_v1): no hay lectura nueva de hojas.
 */

/** Cuántas promociones viajan: las de mayor porcentaje. El resto no cabe en una tarjeta. */
var VC_TOPE_PROMOS = 120;
/** Tope del texto de cada promoción (el Monitor enseña frases cortas; esto es por si alguien pega un párrafo). */
var VC_TOPE_TEXTO = 140;

/** El porcentaje más alto de un texto. Es pctDe de app_monitor.html, letra por letra. */
function vcPctDe_(t) {
  const n = (String(t || '').match(/(?<![\d.,])\d{1,3}(?=\s*%)/g) || []).map(function (x) { return parseInt(x, 10); });
  return n.length ? Math.max.apply(null, n) : 0;
}

/** Los meses sin intereses de un texto, como los lee la tarjeta del Monitor: N, 1 si dice «MSI» sin cifra, o 0. */
function vcMsiDe_(t) {
  const m = String(t || '').match(/(\d{1,2})\s*msi/i);
  if (m) return parseInt(m[1], 10);
  return /\bmsi\b/i.test(String(t || '')) ? 1 : 0;
}

function vcRecorta_(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trim() + '…' : t;
}

/** Una promoción vigente, con nombres de una letra: viajan 120 y la extensión las guarda. */
function vcCorta_(v) {
  return {
    d: vcRecorta_(v.direccion, 60),
    c: vcRecorta_(v.categoria, 80),
    t: vcRecorta_(v.promocion, VC_TOPE_TEXTO),
    p: vcPctDe_(v.promocion),
    m: vcMsiDe_(v.promocion),
    f: v.fin,
    k: v.origen === 'Marketplace' ? 'mkp' : ''
  };
}

/**
 * El paquete para la extensión, sobre los datos del Monitor ya leídos.
 *   fuerte  → la más fuerte del Monitor (null si ninguna vigente trae porcentaje)
 *   promos  → las vigentes, de mayor a menor porcentaje (estable: en empate, el orden de la hoja)
 */
function vcPaqueteDesde_(data, now) {
  const vigentes = portalVigentes_(data || {}, now);
  let fuerte = null;
  vigentes.forEach(function (v) {
    const x = vcPctDe_(v.promocion);
    if (!fuerte || x > fuerte.pct) fuerte = { v: v, pct: x };
  });
  const promos = vigentes.map(vcCorta_)
    .sort(function (a, b) { return b.p - a.p; })
    .slice(0, VC_TOPE_PROMOS);
  return {
    status: 'ok',
    v: 1,
    generado: now.getTime(),
    fuerte: fuerte && fuerte.pct ? vcCorta_(fuerte.v) : null,
    promos: promos
  };
}

/** Lo que pide la portada para la extensión. Nunca lanza. */
function ventaCruzadaPromos() {
  try {
    const data = fetchApplicationData();
    if (!data || data.status === 'error') {
      return { status: 'error', error: 'No se pudieron leer las promociones del Monitor.' };
    }
    return vcPaqueteDesde_(data, new Date());
  } catch (e) {
    Logger.log('ventaCruzadaPromos: ' + e);
    return { status: 'error', error: 'No se pudieron leer las promociones del Monitor.' };
  }
}
