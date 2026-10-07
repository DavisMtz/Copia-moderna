/**
 * =============================================================================
 * Ventel Bag Extractor - Chrome Extension (popup.js)
 * =============================================================================
 * Inyecta un content script en la pestaña activa para extraer los artículos
 * de la bolsa de compras de Liverpool y genera un JSON compatible con el
 * Sistema de Cotizaciones Ventel.
 *
 * Hecho por su gran amigo David Martínez "El escritor" · v1.2 · 30/07/2026
 *
 * v1.2 — cada artículo viaja ahora con `productUrl`, el enlace a su ficha en
 *        liverpool.com.mx, que la pantalla de revisión del sistema usa para abrir el
 *        producto sin salir de la app. Todo lo demás (precios, descuentos, imágenes,
 *        resumen del carrito, copiar y descargar) funciona exactamente igual.
 *
 * v1.4 — botón "Cotizar": extrae la bolsa y abre una cotización nueva en el sistema
 *        con los artículos ya cargados. La bolsa viaja por `chrome.storage.local` y
 *        la recoge `bridge.js` dentro de la pantalla; si no hay sesión, el sistema
 *        manda al login y vuelve solo. Copiar y Descargar el JSON siguen intactos:
 *        el camino manual no se toca porque es el que funciona cuando algo falla.
 *
 * v1.5 — botón "Copiar datos de la compra": en la pantalla de "¡Gracias por comprar!"
 *        arma el resumen de la venta ya cerrada (pedido, artículos, entrega estimada,
 *        pago, plan y folio de la atención) listo para pegar. Es una función aparte,
 *        en `purchase-extractor.js`, y no toca nada de la extracción de bolsa.
 *
 * v1.6 — "Copiar datos de la compra" ahora detecta cuando el envío se repartió en
 *        varios pedidos (misma compra, varias secciones "No. de pedido" en la
 *        pantalla) y los redacta todos en un solo texto, agrupados por pedido.
 *
 * v1.7 — botón "Inspeccionar artículo": desde la ficha de un producto de Liverpool
 *        abre una ventana dedicada con TODO lo que se puede saber del artículo.
 *        Colores y tallas/capacidades, SKU general y por variante, galería completa,
 *        planes de pago, vendedor, especificaciones y el objeto crudo del flight data.
 *        Usa `inspectProductFromDOM` (product-inspector.js) y lo pinta en
 *        `inspector.html` + `inspector-ui.js`. Función aparte, no toca nada de las
 *        anteriores.
 *
 * v3.1 · 06/10/2026 · Portal en Cloudflare (ventel.logidma.com) — «Guardar enlace»
 *        acepta también https://ventel.logidma.com/ (con o sin barra final, con o sin
 *        `?page=…`: siempre se guarda la raíz), además del /exec de Apps Script, que
 *        sigue valiendo. Si no hay ningún enlace guardado, «Cotizar» va al Portal nuevo,
 *        igual que el botón incrustado en la bolsa. Extracción y resultados, intactos.
 */

const btnCotizar = document.getElementById('btnCotizar');
const btnExtract = document.getElementById('btnExtract');
const btnViewer = document.getElementById('btnViewer');
const btnInspector = document.getElementById('btnInspector');
const btnCopy = document.getElementById('btnCopy');
const btnDownload = document.getElementById('btnDownload');
const txtJson = document.getElementById('txtJson');
const statusEl = document.getElementById('status');
const resultContainer = document.getElementById('resultContainer');
const itemCountEl = document.getElementById('itemCount');
const statItemsEl = document.getElementById('statItems');
const statTotalEl = document.getElementById('statTotal');
const btnConfigToggle = document.getElementById('btnConfigToggle');
const configPanel = document.getElementById('configPanel');
const inpCotizadorUrl = document.getElementById('inpCotizadorUrl');
const btnConfigSave = document.getElementById('btnConfigSave');
const btnCompra = document.getElementById('btnCompra');
// El botón de extraer se sustituye por un spinner mientras trabaja y luego hay
// que devolverlo a su sitio. Se guarda su marcado REAL al arrancar en vez de
// escribirlo a mano en `restoreBtnHTML`: así, cuando el popup cambia de diseño,
// el botón no vuelve con el texto de la versión anterior.
const HTML_BTN_EXTRACT = btnExtract ? btnExtract.innerHTML : '';
const btnCompraCopy = document.getElementById('btnCompraCopy');
const btnCompraDownload = document.getElementById('btnCompraDownload');
const txtCompra = document.getElementById('txtCompra');
const compraContainer = document.getElementById('compraContainer');
const compraPedido = document.getElementById('compraPedido');
const compraAvisos = document.getElementById('compraAvisos');

/** Clave donde espera la bolsa hasta que la pantalla de cotización la recoge. */
const CLAVE_BOLSA = 'bolsaParaCotizar';
/** Clave del enlace del sistema (el Portal, o el /exec de Apps Script), configurado una vez por equipo. */
const CLAVE_URL = 'cotizadorUrl';
/** El Portal en Cloudflare (3.1): su host EXACTO y la dirección a la que va «Cotizar» si no hay enlace guardado. */
const HOST_PORTAL = 'ventel.logidma.com';
const URL_COTIZADOR_POR_DEFECTO = 'https://' + HOST_PORTAL + '/';

/**
 * Última extracción mostrada en el popup (la de este momento o la que se restauró
 * al abrirlo). Es la que usa "Cotizar" cuando la pestaña activa ya no es la bolsa.
 */
let extraccionActual = null;

/**
 * Muestra un mensaje de estado temporal en el popup.
 */
function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = 'status-msg ' + (isError ? 'status-error' : 'status-success');
  if (!isError) {
    setTimeout(() => { statusEl.className = 'status-msg'; }, 4000);
  }
}

/**
 * Formatea un número como moneda MXN.
 */
function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Pinta el resultado de una extracción en el popup (resumen + JSON).
 */
function renderResult(data) {
  const jsonStr = JSON.stringify(data, null, 2);
  txtJson.value = jsonStr;
  extraccionActual = data;

  const lineCount = data.products.length;
  const totalPieces = data.products.reduce((sum, p) => sum + (p.quantity || 1), 0);

  // Total de la bolsa: usar el resumen del carrito; si no existe, sumar las líneas
  let total = data.summary && data.summary.total > 0 ? data.summary.total : 0;
  if (!total) {
    total = data.products.reduce((sum, p) => sum + (p.totalLine || p.costPaymentUnique || 0), 0);
  }

  statItemsEl.textContent = totalPieces;
  statTotalEl.textContent = formatMoney(total);
  itemCountEl.textContent = lineCount + ' artículo(s)';
  resultContainer.style.display = 'flex';
}

/**
 * Guarda la última extracción para que sobreviva al cerrar el popup.
 */
function saveLastExtraction(data) {
  try {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ lastExtraction: data });
    }
  } catch (e) { /* sin permiso de storage: no pasa nada */ }
}

/**
 * Al abrir el popup, restaura la última extracción si existe.
 */
(function restoreLastExtraction() {
  try {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('lastExtraction', ({ lastExtraction }) => {
        if (lastExtraction && lastExtraction.products && lastExtraction.products.length > 0) {
          renderResult(lastExtraction);
        }
      });
    }
  } catch (e) { /* sin permiso de storage: no pasa nada */ }
})();

/**
 * Función que se inyecta en la pestaña activa para leer el DOM de la bolsa.
 * Esta función se ejecuta en el contexto de la página de Liverpool.
 */
function extractBagFromDOM() {
  const products = [];

  // Buscar todas las tarjetas de producto en la bolsa
  // Cada tarjeta tiene un data-testid que empieza con "ml-card-product-mybag-"
  const productCards = document.querySelectorAll('[data-testid^="ml-card-product-mybag-"]');

  // Filtrar solo las tarjetas principales (sin sufijo adicional como -image, -price, etc.)
  const mainCards = Array.from(productCards).filter(card => {
    const testid = card.getAttribute('data-testid');
    // Solo las tarjetas raíz: "ml-card-product-mybag-{uuid}" (sin más guiones después del uuid)
    return /^ml-card-product-mybag-[0-9a-f-]{36}$/.test(testid);
  });

  mainCards.forEach(card => {
    const cardId = card.getAttribute('data-testid');
    const uuid = cardId.replace('ml-card-product-mybag-', '');

    // --- NOMBRE DEL PRODUCTO ---
    const brandLink = card.querySelector(`[data-testid="${cardId}-brand-link"]`);
    const productName = brandLink ? brandLink.textContent.trim() : '';

    // --- SKU (del href del link) ---
    let sku = '';
    if (brandLink && brandLink.href) {
      // URL format: .../pdp/slug/1175126411?skuid=1175126411
      const hrefParts = brandLink.href.split('/');
      const lastPart = hrefParts[hrefParts.length - 1]; // "1175126411?skuid=1175126411"
      sku = lastPart.split('?')[0];
    }

    // --- ENLACE A LA FICHA DEL ARTÍCULO ---
    // Es el mismo <a> del que ya sale el SKU, así que no cuesta una consulta extra al DOM
    // ni cambia nada de lo anterior: solo se conserva la URL completa en vez de tirarla.
    // El Sistema de Cotizaciones la usa para abrir el producto dentro de la pantalla de
    // revisión. Si no se puede sacar una URL real de Liverpool se deja VACÍA: inventar
    // una que lleve a un 404 es peor que no traer enlace.
    const productUrl = resolveProductUrl(brandLink);

    // --- IMAGEN ---
    const imgEl = card.querySelector(`[data-testid="product-image-${uuid}"]`);
    let imageUrl = '';
    if (imgEl) {
      const src = imgEl.getAttribute('src') || '';
      // Si es una URL relativa de archivo local, construir la URL real de Liverpool
      if (src.startsWith('./') || src.startsWith('Mi Bolsa_files')) {
        imageUrl = `https://ss628.liverpool.com.mx/xl/${sku}.jpg`;
      } else {
        imageUrl = src;
      }
    } else {
      imageUrl = sku ? `https://ss628.liverpool.com.mx/xl/${sku}.jpg` : '';
    }

    // --- PRECIO ORIGINAL (tachado) ---
    const originalPriceEl = card.querySelector(`[data-testid="original"]`);
    let originalPrice = 0;
    if (originalPriceEl) {
      originalPrice = parsePrice(originalPriceEl);
    }

    // --- PRECIO CON DESCUENTO ---
    const discountedPriceEl = card.querySelector(`[data-testid="discounted"]`);
    let discountedPrice = 0;
    if (discountedPriceEl) {
      discountedPrice = parsePrice(discountedPriceEl);
    }

    // --- TOTAL POR LÍNEA ---
    const totalEl = card.querySelector(`[data-testid$="-input-cart-item-wrapper-input-cart-item-total"]`);
    let totalLine = 0;
    if (totalEl) {
      totalLine = parsePrice(totalEl);
    }

    // --- CANTIDAD ---
    const quantityInput = card.querySelector('input[name="quantity"]');
    const quantity = quantityInput ? parseInt(quantityInput.value) || 1 : 1;

    // --- CORRECCIÓN INTELIGENTE PARA PRECIOS DIRECTOS (SIN DESCUENTO) ---
    if (discountedPrice === 0 && originalPrice === 0 && totalLine > 0) {
      discountedPrice = totalLine / quantity;
      originalPrice = totalLine / quantity;
    } else if (discountedPrice === 0 && originalPrice > 0) {
      discountedPrice = originalPrice;
    } else if (originalPrice === 0 && discountedPrice > 0) {
      originalPrice = discountedPrice;
    }

    // --- VENDIDO POR (PROVEEDOR EXTERNO) ---
    let soldBy = '';
    const spans = card.querySelectorAll('span');
    for (let i = 0; i < spans.length; i++) {
      const text = spans[i].textContent.trim();
      if (text.startsWith('Vendido por')) {
        soldBy = text.replace(/^Vendido\s+por\s+/i, '').trim();
        break;
      }
    }

    products.push({
      sku,
      description: productName,
      quantity,
      unitPrice: originalPrice,
      discountedUnitPrice: discountedPrice,
      costPaymentUnique: discountedPrice * quantity,
      totalLine,
      imageUrl,
      productUrl,
      soldBy
    });
  });

  // --- RESUMEN DEL CARRITO ---
  let subtotal = 0;
  let discount = 0;
  let total = 0;

  const subtotalEl = document.querySelector('[data-testid="checkout-payment-summary-subtotal"]');
  if (subtotalEl) subtotal = parseSimplePrice(subtotalEl.textContent);

  const discountEl = document.querySelector('[data-testid="checkout-payment-summary-discount"]');
  if (discountEl) discount = parseSimplePrice(discountEl.textContent);

  const totalEl = document.querySelector('[data-testid="checkout-payment-summary-total"]');
  if (totalEl) total = parseSimplePrice(totalEl.textContent);

  return {
    extractedAt: new Date().toISOString(),
    source: 'Liverpool Bolsa',
    products,
    summary: { subtotal, discount, total }
  };

  /**
   * Parsea el precio desde un contenedor que tiene la estructura de Liverpool:
   * <span>$<!-- -->29,999</span><span><!-- -->.10</span>
   */
  function parsePrice(container) {
    if (!container) return 0;
    // Obtener todos los spans hijos directos
    const spans = container.querySelectorAll('span');
    let fullText = '';
    spans.forEach(span => {
      // Saltar spans invisibles que solo contienen "."
      if (span.classList.contains('invisible')) return;
      fullText += span.textContent;
    });
    return parseSimplePrice(fullText);
  }

  /**
   * Parsea un string de precio como "$29,999.10" o "29,99910" a un número float.
   */
  function parseSimplePrice(text) {
    if (!text) return 0;

    let cleaned = text.trim();

    // Si contiene un punto decimal, limpiamos cualquier sufijo de accesibilidad duplicado
    if (cleaned.includes('.')) {
      const parts = cleaned.split('.');
      if (parts.length >= 2) {
        // La parte entera de la izquierda (ej. "$9,499")
        const integerPart = parts[0].replace(/[^0-9,-]/g, '');
        // Los centavos son siempre los primeros 2 caracteres después del punto (ej. "00" de "009499")
        const decimalPart = parts[1].replace(/[^0-9]/g, '').substring(0, 2);
        cleaned = integerPart + '.' + decimalPart;
      }
    } else {
      // Si no tiene punto, quitar todo excepto números, comas y signos negativos
      cleaned = cleaned.replace(/[^0-9,-]/g, '');
    }

    // Eliminar las comas de separación de miles
    cleaned = cleaned.replace(/,/g, '');

    const result = parseFloat(cleaned);
    return isNaN(result) ? 0 : result;
  }

  /**
   * Devuelve la URL pública de la ficha del artículo, o cadena vacía si no se puede
   * saber con certeza.
   *
   * Tres escenarios reales:
   *   1. Bolsa en vivo (liverpool.com.mx)  → `link.href` ya es la URL absoluta buena.
   *   2. Página guardada con Ctrl+S        → Chrome reescribe los href a absolutos, así
   *                                          que también sirve el caso 1.
   *   3. href relativo en un archivo local → `link.href` resuelve a `file:///…`; ahí se
   *                                          usa el atributo crudo sobre el dominio real.
   * Cualquier otra cosa devuelve '' a propósito: el sistema distingue "sin enlace" de
   * "enlace que no se pudo abrir", y una URL inventada rompería esa distinción.
   */
  function resolveProductUrl(link) {
    if (!link) return '';
    const DOMINIO = 'https://www.liverpool.com.mx';

    const absoluta = link.href || '';
    // Host completo, no "contiene liverpool.com.mx": así no cuela un dominio parecido.
    if (/^https?:\/\/([a-z0-9-]+\.)*liverpool\.com\.mx(?::\d+)?(\/|$|\?|#)/i.test(absoluta)) {
      return absoluta.replace(/^http:/i, 'https:');
    }

    const crudo = (link.getAttribute('href') || '').trim();
    if (crudo.indexOf('/') === 0 && crudo.indexOf('//') !== 0) return DOMINIO + crudo;

    return '';
  }
}

/**
 * Extrae la bolsa de la pestaña activa. Devuelve también si la pestaña PARECÍA la
 * bolsa de Liverpool, porque quien llama decide qué hacer con eso: "Extraer" avisa
 * y lo intenta igual, y "Cotizar" prefiere la última extracción antes que mandar
 * una bolsa vacía al sistema.
 */
async function extraerDeLaPestanaActiva() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { data: null, pareceLiverpool: false, sinPestana: true };

  const url = tab.url || '';
  const pareceLiverpool = url.includes('liverpool.com.mx') || url.startsWith('file://');

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractBagFromDOM
  });

  const data = (results && results[0] && results[0].result) || null;
  return { data, pareceLiverpool, sinPestana: false };
}

/**
 * Manejador del botón "Extraer"
 */
btnExtract.addEventListener('click', async () => {
  btnExtract.disabled = true;
  btnExtract.innerHTML = '<span class="spinner"></span> Extrayendo...';
  statusEl.className = 'status-msg';

  try {
    const { data, pareceLiverpool, sinPestana } = await extraerDeLaPestanaActiva();

    if (sinPestana) {
      showStatus('No se encontró una pestaña activa.', true);
      btnExtract.disabled = false;
      btnExtract.innerHTML = restoreBtnHTML();
      return;
    }

    // Aviso preventivo si la pestaña no parece ser de Liverpool ni un archivo local
    if (!pareceLiverpool) {
      showStatus('⚠️ Esta pestaña no parece ser la bolsa de Liverpool. Intentando de todos modos...', true);
    }

    if (data) {
      if (data.products.length === 0) {
        showStatus('No se encontraron artículos en la bolsa. Asegúrate de estar en la página correcta.', true);
      } else {
        renderResult(data);
        saveLastExtraction(data);

        // Se avisa si algún artículo se quedó sin enlace: el sistema puede cotizarlo
        // igual, pero quien revise no podrá abrir su ficha desde la pantalla de revisión.
        const sinEnlace = data.products.filter(p => !p.productUrl).length;
        const aviso = sinEnlace
          ? ` (${sinEnlace} sin enlace a la ficha)`
          : '';

        // Auto-copiar al portapapeles para ahorrar un clic
        try {
          await navigator.clipboard.writeText(txtJson.value);
          showStatus('✅ ' + data.products.length + ' artículo(s) extraídos' + aviso + ' y JSON copiado al portapapeles.');
        } catch (e) {
          showStatus('✅ ' + data.products.length + ' artículo(s) extraídos' + aviso + ' correctamente.');
        }
      }
    } else {
      showStatus('No se pudieron extraer datos. ¿Estás en la bolsa de Liverpool?', true);
    }
  } catch (err) {
    console.error('Error al extraer:', err);
    showStatus('Error: ' + err.message, true);
  }

  btnExtract.disabled = false;
  btnExtract.innerHTML = restoreBtnHTML();
});

/**
 * =============================================================================
 * COTIZAR: de la bolsa al Sistema de Cotizaciones sin pasos manuales
 * =============================================================================
 */

/**
 * Valida y deja en su forma canónica el enlace del sistema.
 *
 * Nunca se construye ni se completa la URL a mano: se parsea con `URL` y se
 * compara el host EXACTO. Un `includes('script.google.com')` dejaría pasar
 * `https://otro-sitio.com/?x=script.google.com`, y esta URL es a la que se manda
 * al asesor con su bolsa. Del enlace pegado se conservan solo origen y ruta: los
 * parámetros los pone la extensión, y así da igual que se copie con la barra de
 * direcciones llena de `?page=...`.
 *
 * 3.1 · El Portal en Cloudflare (https://ventel.logidma.com/) es la opción principal.
 * Se compara el ORIGEN exacto (esquema, host y puerto) y de lo pegado no se conserva
 * ni la ruta: la raíz es el Portal y el enrutado va en `?page=…`, que pone la extensión.
 * El /exec de Apps Script sigue valiendo, para quien aún use el sistema viejo.
 */
function normalizarUrlCotizador(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return { ok: false, message: 'Escribe la URL del sistema antes de guardar.' };

  let u;
  try {
    u = new URL(texto);
  } catch (e) {
    return { ok: false, message: 'Eso no es una dirección válida. Cópiala completa desde la barra del navegador.' };
  }

  if (u.protocol !== 'https:') {
    return { ok: false, message: 'La dirección debe empezar con https://' };
  }
  if (u.origin === 'https://' + HOST_PORTAL) {
    return { ok: true, url: URL_COTIZADOR_POR_DEFECTO };
  }
  if (u.hostname !== 'script.google.com') {
    return { ok: false, message: 'Debe ser la dirección del Portal Ventel (ventel.logidma.com) o, si aún usas el sistema de Apps Script, la de script.google.com.' };
  }
  if (/\/dev$/.test(u.pathname)) {
    return { ok: false, message: 'Esa es la URL /dev, que solo abre a quien edita el código. Usa la del Portal (ventel.logidma.com) o la que termina en /exec.' };
  }
  if (!/\/exec$/.test(u.pathname)) {
    return { ok: false, message: 'La dirección de Apps Script debe terminar en /exec (o usa la del Portal: ventel.logidma.com).' };
  }

  return { ok: true, url: u.origin + u.pathname };
}

/** Lee el enlace guardado. Devuelve '' si todavía no se ha configurado. */
function leerUrlCotizador() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(CLAVE_URL, guardado => {
        if (chrome.runtime.lastError) { resolve(''); return; }
        resolve((guardado && guardado[CLAVE_URL]) || '');
      });
    } catch (e) { resolve(''); }
  });
}

/** Abre o cierra el panel de configuración. */
function alternarConfig(forzarAbierto) {
  const abrir = typeof forzarAbierto === 'boolean'
    ? forzarAbierto
    : !configPanel.classList.contains('abierto');
  configPanel.classList.toggle('abierto', abrir);
  btnConfigToggle.setAttribute('aria-expanded', String(abrir));
  if (abrir) inpCotizadorUrl.focus();
}

btnConfigToggle.addEventListener('click', () => alternarConfig());

btnConfigSave.addEventListener('click', () => {
  const resultado = normalizarUrlCotizador(inpCotizadorUrl.value);
  if (!resultado.ok) {
    showStatus(resultado.message, true);
    inpCotizadorUrl.focus();
    return;
  }
  chrome.storage.local.set({ [CLAVE_URL]: resultado.url }, () => {
    inpCotizadorUrl.value = resultado.url;
    alternarConfig(false);
    showStatus('✅ Enlace guardado. Ya puedes usar el botón Cotizar.');
  });
});

inpCotizadorUrl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); btnConfigSave.click(); }
});

/** Deja el enlace ya escrito en el panel al abrir el popup. */
(async function precargarConfig() {
  const url = await leerUrlCotizador();
  if (url) inpCotizadorUrl.value = url;
})();

/**
 * Manejador del botón "Cotizar"
 * -----------------------------------------------------------------------------
 * Extrae, deja la bolsa esperando en `chrome.storage.local` y abre la pantalla de
 * cotización. Quien recoge la bolsa del otro lado es `bridge.js`, ya dentro de la
 * página: aquí no se sabe —ni hace falta saber— si el asesor tiene la sesión
 * abierta. Si no la tiene, el propio sistema lo manda al login y vuelve a la
 * cotización al terminar; la bolsa sigue esperando mientras tanto.
 *
 * El folio NO se pide desde aquí a propósito: lo emite el servidor al guardar la
 * cotización, bajo candado y con el correo del asesor. Emitirlo al abrir la
 * pantalla llenaría la hoja de folios de cotizaciones que nunca existieron.
 */
btnCotizar.addEventListener('click', async () => {
  const htmlOriginal = btnCotizar.innerHTML;
  btnCotizar.disabled = true;
  btnCotizar.innerHTML = '<span class="spinner"></span> Preparando la cotización...';
  statusEl.className = 'status-msg';

  try {
    // Sin enlace guardado (3.1) se va al Portal nuevo, igual que el botón incrustado en la
    // bolsa; el que el asesor guardó en el panel de abajo manda siempre.
    const base = (await leerUrlCotizador()) || URL_COTIZADOR_POR_DEFECTO;

    // Se extrae de nuevo en vez de reutilizar lo que ya está a la vista: los precios
    // y las promociones de Liverpool cambian solos, y cotizar la bolsa de hace un
    // rato es cotizar mal.
    let bolsa = null;
    let aviso = '';
    try {
      const { data } = await extraerDeLaPestanaActiva();
      if (data && data.products.length > 0) bolsa = data;
    } catch (e) {
      // La pestaña activa puede ser una donde no se permite inyectar (chrome://,
      // la Web Store). No es un error todavía: abajo está el respaldo.
      console.warn('No se pudo extraer de la pestaña activa:', e);
    }

    if (bolsa) {
      renderResult(bolsa);
      saveLastExtraction(bolsa);
    } else if (extraccionActual && extraccionActual.products && extraccionActual.products.length > 0) {
      bolsa = extraccionActual;
      aviso = ' Se usó la última extracción: revisa precios y cantidades antes de enviar.';
    } else {
      showStatus('No hay artículos que cotizar. Abre tu bolsa de Liverpool y vuelve a intentarlo.', true);
      return;
    }

    await new Promise((resolve, reject) => {
      chrome.storage.local.set(
        { [CLAVE_BOLSA]: { data: bolsa, createdAt: Date.now() } },
        () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        }
      );
    });

    // Red de seguridad: si el puente no llegara a entregar la bolsa (la extensión
    // deshabilitada en esa pestaña, un Chrome con políticas raras), el asesor no se
    // queda a cero. El botón "Importar desde Bolsa (JSON)" de la pantalla lee el
    // portapapeles solo, así que el camino manual sigue a un clic de distancia.
    try { await navigator.clipboard.writeText(JSON.stringify(bolsa, null, 2)); } catch (e) {}

    const destino = new URL(base);
    destino.searchParams.set('page', 'cotizacion');
    // La pantalla espera la bolsa y avisa si no llega (misma marca que el botón incrustado).
    destino.searchParams.set('origen', 'extension');

    showStatus('✅ ' + bolsa.products.length + ' artículo(s) listos. Abriendo la cotización...' + aviso);
    await chrome.tabs.create({ url: destino.toString() });
  } catch (err) {
    console.error('Error al cotizar:', err);
    showStatus('Error: ' + err.message, true);
  } finally {
    // En 'finally' y no al final del bloque: arriba hay varios 'return' tempranos
    // (falta el enlace, no hay artículos) y sin esto el botón se quedaría girando
    // para siempre justo en los casos en los que hay que volver a intentarlo.
    btnCotizar.disabled = false;
    btnCotizar.innerHTML = htmlOriginal;
  }
});

/**
 * Guarda la extracción profunda para que la lea `viewer.html`.
 *
 * Una ficha de producto con muchos carruseles puede pasarse del cupo de
 * `chrome.storage.local`. Si eso ocurre se reintenta sin los objetos crudos:
 * se pierde la pestaña "Datos completos", pero el visor abre igual en vez de
 * quedarse en un error.
 */
async function guardarParaElVisor(data, tabId) {
  try {
    await chrome.storage.local.set({ deepExtraction: { data, tabId, savedAt: Date.now() } });
  } catch (e) {
    const ligero = JSON.parse(JSON.stringify(data));
    ligero.articles.forEach(a => { delete a.raw; delete a.rawExtra; });
    ligero.warnings = (ligero.warnings || []).concat(
      'La extracción era demasiado grande para el almacenamiento: se guardó sin los objetos crudos de cada artículo.');
    await chrome.storage.local.set({ deepExtraction: { data: ligero, tabId, savedAt: Date.now() } });
  }
}

/**
 * Manejador del botón "Abrir visor avanzado"
 * -----------------------------------------------------------------------------
 * Segunda función de la extensión. No comparte nada con la extracción de arriba:
 * inyecta `deepExtractFromDOM` (deep-extractor.js), guarda el resultado y abre
 * `viewer.html` en una pestaña nueva, que es donde se pinta todo.
 *
 * Se guarda también el `tabId` para que el visor pueda repetir la extracción con
 * su botón "Actualizar" sin volver a pasar por aquí.
 */
btnViewer.addEventListener('click', async () => {
  const htmlOriginal = btnViewer.innerHTML;
  btnViewer.disabled = true;
  btnViewer.innerHTML = '<span class="spinner" style="border-color: rgba(100,116,139,.35); border-top-color:#64748b;"></span> Analizando la página...';
  statusEl.className = 'status-msg';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showStatus('No se encontró una pestaña activa.', true);
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: deepExtractFromDOM
    });

    const data = results && results[0] && results[0].result;
    if (!data) {
      showStatus('La pestaña no devolvió datos. ¿Está abierta la bolsa o una ficha de producto?', true);
      return;
    }

    await guardarParaElVisor(data, tab.id);

    if (data.articles.length === 0) {
      // Se abre igual: el visor explica qué fuentes encontró y cuáles no, que es
      // justo lo que hace falta para saber por qué no salió nada.
      showStatus('No se encontraron artículos; el visor te muestra qué se detectó en la página.', true);
    } else {
      showStatus('✅ ' + data.articles.length + ' artículo(s) analizados. Abriendo el visor...');
    }

    await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
  } catch (err) {
    console.error('Error al abrir el visor:', err);
    showStatus('Error: ' + err.message, true);
  } finally {
    // Igual que en "Cotizar": con los 'return' de arriba (sin pestaña, sin datos)
    // el botón se quedaba deshabilitado y había que cerrar y abrir el popup.
    btnViewer.disabled = false;
    btnViewer.innerHTML = htmlOriginal;
  }
});

/**
 * =============================================================================
 * INSPECCIONAR ARTÍCULO: toda la información de una ficha de producto
 * =============================================================================
 * Cuarta función de la extensión. Inyecta `inspectProductFromDOM`
 * (product-inspector.js) en la pestaña activa, guarda el resultado y abre
 * `inspector.html` en una pestaña nueva.
 *
 * Solo tiene sentido en una ficha de producto (/pdp/…), no en la bolsa: para
 * eso está el visor avanzado. Si la pestaña no es una ficha, se avisa y no se
 * abre nada.
 */
btnInspector.addEventListener('click', async () => {
  const htmlOriginal = btnInspector.innerHTML;
  btnInspector.disabled = true;
  btnInspector.innerHTML = '<span class="spinner" style="border-color: rgba(100,116,139,.35); border-top-color:#64748b;"></span> Inspeccionando el artículo...';
  statusEl.className = 'status-msg';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showStatus('No se encontró una pestaña activa.', true);
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: inspectProductFromDOM
    });

    const data = results && results[0] && results[0].result;
    if (!data) {
      showStatus('La pestaña no devolvió datos. ¿Está abierta la ficha de un producto de Liverpool?', true);
      return;
    }

    if (!data.isProductPage) {
      showStatus('Esta pestaña no parece ser la ficha de un producto de Liverpool. Abre un artículo y vuelve a intentarlo.', true);
      return;
    }

    // Guardar para que inspector.html lo lea.
    try {
      await chrome.storage.local.set({ productInspection: { data, tabId: tab.id, savedAt: Date.now() } });
    } catch (e) {
      // Si el objeto es demasiado grande (galería enorme), se reintenta sin rawFlightData.
      const ligero = JSON.parse(JSON.stringify(data));
      if (ligero.product) delete ligero.product.rawFlightData;
      ligero.warnings = (ligero.warnings || []).concat(
        'Los datos crudos se omitieron por exceder el almacenamiento.');
      await chrome.storage.local.set({ productInspection: { data: ligero, tabId: tab.id, savedAt: Date.now() } });
    }

    const nombre = (data.product && data.product.name) || 'artículo';
    showStatus('✅ ' + nombre + ' inspeccionado. Abriendo el inspector...');
    await chrome.tabs.create({ url: chrome.runtime.getURL('inspector.html') });
  } catch (err) {
    console.error('Error al inspeccionar:', err);
    showStatus('Error: ' + err.message, true);
  } finally {
    btnInspector.disabled = false;
    btnInspector.innerHTML = htmlOriginal;
  }
});

/**
 * =============================================================================
 * DATOS DE LA COMPRA: el resumen de la venta ya cerrada
 * =============================================================================
 * Tercera función, y la más corta. Inyecta `extractPurchaseFromDOM`
 * (purchase-extractor.js) en la pantalla de "¡Gracias por comprar!", redacta el
 * resumen con `formatearCompra` y lo deja copiado.
 *
 * No comparte NADA con la extracción de bolsa ni con el visor: ni el
 * almacenamiento, ni el JSON, ni el cuadro de resultados. La bolsa sigue siendo
 * lo principal y esto no le quita un clic.
 *
 * Deliberadamente NO se guarda nada entre usos. El folio pertenece a una
 * atención concreta y volver a ver el de ayer en pantalla es la manera más fácil
 * de pegarlo en el caso equivocado.
 */

/** Deja el texto en el cuadro y pinta el aviso de lo que la página no dijo. */
function renderCompra(datos, texto) {
  txtCompra.value = texto;

  const numeros = (datos.pedido && datos.pedido.numeros) || (datos.pedido.numero ? [datos.pedido.numero] : []);
  compraPedido.textContent = numeros.length > 1 ? numeros.length + ' pedidos: ' + numeros.join(', ')
    : numeros.length === 1 ? 'Pedido ' + numeros[0]
    : 'Sin pedido';

  compraAvisos.textContent = (datos.avisos || []).join(' ');
  compraContainer.style.display = 'flex';
}

btnCompra.addEventListener('click', async () => {
  const htmlOriginal = btnCompra.innerHTML;
  btnCompra.disabled = true;
  btnCompra.innerHTML = '<span class="spinner" style="border-color: rgba(100,116,139,.35); border-top-color:#64748b;"></span> Leyendo la compra...';
  statusEl.className = 'status-msg';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showStatus('No se encontró una pestaña activa.', true);
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPurchaseFromDOM
    });

    const datos = results && results[0] && results[0].result;
    if (!datos) {
      showStatus('La pestaña no devolvió datos. ¿Está abierta la pantalla de compra confirmada?', true);
      return;
    }

    if (!datos.esPantallaDeCompra) {
      // Se muestra el motivo en vez de un "no se pudo": casi siempre es que la
      // pestaña activa no era la del "¡Gracias por comprar!".
      compraContainer.style.display = 'none';
      showStatus('Esta pantalla no es la confirmación de compra de Liverpool. Ábrela y vuelve a intentarlo.', true);
      return;
    }

    const texto = formatearCompra(datos);
    renderCompra(datos, texto);

    // Copiar es el objetivo del botón, no un extra: quien lo pulsa es porque ya
    // va a pegar el resumen en otro lado.
    try {
      await navigator.clipboard.writeText(texto);
      showStatus('✅ Datos de la compra copiados al portapapeles.');
    } catch (e) {
      showStatus('✅ Resumen listo. Cópialo con el botón de abajo.');
    }
  } catch (err) {
    console.error('Error al leer la compra:', err);
    showStatus('Error: ' + err.message, true);
  } finally {
    btnCompra.disabled = false;
    btnCompra.innerHTML = htmlOriginal;
  }
});

btnCompraCopy.addEventListener('click', () => {
  if (!txtCompra.value) return;
  txtCompra.select();
  navigator.clipboard.writeText(txtCompra.value)
    .then(() => showStatus('✅ Datos de la compra copiados al portapapeles.'))
    .catch(() => {
      document.execCommand('copy');
      showStatus('✅ Datos de la compra copiados al portapapeles.');
    });
});

btnCompraDownload.addEventListener('click', () => {
  if (!txtCompra.value) return;
  const blob = new Blob([txtCompra.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const pedido = (compraPedido.textContent || '').replace(/[^0-9A-Za-z-]/g, '') || 'sin-pedido';
  a.href = url;
  a.download = 'compra-' + pedido + '-' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
  URL.revokeObjectURL(url);
  showStatus('✅ Archivo descargado.');
});

/**
 * Manejador del botón "Copiar JSON"
 */
btnCopy.addEventListener('click', () => {
  txtJson.select();
  navigator.clipboard.writeText(txtJson.value).then(() => {
    showStatus('✅ JSON copiado al portapapeles.');
    btnCopy.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> ¡Copiado!';
    setTimeout(() => {
      btnCopy.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copiar JSON';
    }, 2000);
  }).catch(() => {
    // Fallback para navegadores más antiguos
    document.execCommand('copy');
    showStatus('✅ JSON copiado al portapapeles.');
  });
});

/**
 * Manejador del botón "Descargar" — guarda el JSON como archivo .json
 */
btnDownload.addEventListener('click', () => {
  if (!txtJson.value) return;
  const blob = new Blob([txtJson.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fecha = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = 'bolsa-ventel-' + fecha + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showStatus('✅ Archivo descargado.');
});

function restoreBtnHTML() {
  return HTML_BTN_EXTRACT;
}
