/**
 * =============================================================================
 * Ventel Bag Extractor · Botón "Cotizar" incrustado en la bolsa (cart-cotizar-button.js)
 * =============================================================================
 * Dibuja un botón "Cotizar" justo arriba del botón "Comprar" de la bolsa de
 * Liverpool (liverpool.com.mx/tienda/cart), para no depender de abrir el popup
 * de la extensión. Al pulsarlo hace EXACTAMENTE lo mismo que el botón "Cotizar"
 * del popup (misma extracción, misma clave de `chrome.storage.local`, mismo
 * puente `bridge.js`):
 *
 *   1. Extrae la bolsa del DOM (idéntico a `extractBagFromDOM` de popup.js).
 *   2. La dega en `chrome.storage.local['bolsaParaCotizar']`, que es de donde
 *      `bridge.js` la entrega a la pantalla de cotización dentro del iframe de
 *      Apps Script — así Apps Script la puede leer sin pasar por el portapapeles.
 *   3. La copia TAMBIÉN al portapapeles, como respaldo manual si el puente
 *      fallara (extensión deshabilitada en esa pestaña, política rara).
 *   4. Abre la cotización en una pestaña nueva.
 *
 * No toca la extracción clásica de `popup.js` ni el resto de la extensión: es
 * un disparador adicional para el mismo camino que ya existe y ya funciona.
 *
 * v1.0 · 16/08/2026
 */
(function () {
  'use strict';

  const TESTID_BOTON_COMPRAR = 'checkout-payment-summary-button';
  const ID_BOTON_VENTEL = 'ventel-boton-cotizar';

  /** Misma clave que usa popup.js/bridge.js: una bolsa se cotiza por el mismo camino. */
  const CLAVE_BOLSA = 'bolsaParaCotizar';
  /** Misma clave de configuración que el panel del popup. */
  const CLAVE_URL = 'cotizadorUrl';
  /** Si nadie configuró un enlace propio en el popup, se usa este por defecto. */
  const URL_COTIZADOR_POR_DEFECTO =
    'https://script.google.com/a/liverpool.com.mx/macros/s/AKfycbwGYZs3C-dsZbIWVn27uEaLm_rXQGhiQc9Q54btPxPb-Z1SX0Enx7NlPqKw4STizaOU/exec';

  /**
   * Extrae la bolsa del DOM. Copia literal de `extractBagFromDOM` en popup.js:
   * ahí se inyecta con `chrome.scripting.executeScript` porque el popup no vive
   * en la página; aquí el content script YA vive en la página, así que se llama
   * directo. El cuerpo no se toca para no arriesgar el formato que ya consume
   * el Sistema de Cotizaciones.
   */
  function extractBagFromDOM() {
    const products = [];

    const productCards = document.querySelectorAll('[data-testid^="ml-card-product-mybag-"]');

    const mainCards = Array.from(productCards).filter(card => {
      const testid = card.getAttribute('data-testid');
      return /^ml-card-product-mybag-[0-9a-f-]{36}$/.test(testid);
    });

    mainCards.forEach(card => {
      const cardId = card.getAttribute('data-testid');
      const uuid = cardId.replace('ml-card-product-mybag-', '');

      const brandLink = card.querySelector(`[data-testid="${cardId}-brand-link"]`);
      const productName = brandLink ? brandLink.textContent.trim() : '';

      let sku = '';
      if (brandLink && brandLink.href) {
        const hrefParts = brandLink.href.split('/');
        const lastPart = hrefParts[hrefParts.length - 1];
        sku = lastPart.split('?')[0];
      }

      const productUrl = resolveProductUrl(brandLink);

      const imgEl = card.querySelector(`[data-testid="product-image-${uuid}"]`);
      let imageUrl = '';
      if (imgEl) {
        const src = imgEl.getAttribute('src') || '';
        if (src.startsWith('./') || src.startsWith('Mi Bolsa_files')) {
          imageUrl = `https://ss628.liverpool.com.mx/xl/${sku}.jpg`;
        } else {
          imageUrl = src;
        }
      } else {
        imageUrl = sku ? `https://ss628.liverpool.com.mx/xl/${sku}.jpg` : '';
      }

      const originalPriceEl = card.querySelector(`[data-testid="original"]`);
      let originalPrice = 0;
      if (originalPriceEl) {
        originalPrice = parsePrice(originalPriceEl);
      }

      const discountedPriceEl = card.querySelector(`[data-testid="discounted"]`);
      let discountedPrice = 0;
      if (discountedPriceEl) {
        discountedPrice = parsePrice(discountedPriceEl);
      }

      const totalEl = card.querySelector(`[data-testid$="-input-cart-item-wrapper-input-cart-item-total"]`);
      let totalLine = 0;
      if (totalEl) {
        totalLine = parsePrice(totalEl);
      }

      const quantityInput = card.querySelector('input[name="quantity"]');
      const quantity = quantityInput ? parseInt(quantityInput.value) || 1 : 1;

      if (discountedPrice === 0 && originalPrice === 0 && totalLine > 0) {
        discountedPrice = totalLine / quantity;
        originalPrice = totalLine / quantity;
      } else if (discountedPrice === 0 && originalPrice > 0) {
        discountedPrice = originalPrice;
      } else if (originalPrice === 0 && discountedPrice > 0) {
        originalPrice = discountedPrice;
      }

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

    function parsePrice(container) {
      if (!container) return 0;
      const spans = container.querySelectorAll('span');
      let fullText = '';
      spans.forEach(span => {
        if (span.classList.contains('invisible')) return;
        fullText += span.textContent;
      });
      return parseSimplePrice(fullText);
    }

    function parseSimplePrice(text) {
      if (!text) return 0;

      let cleaned = text.trim();

      if (cleaned.includes('.')) {
        const parts = cleaned.split('.');
        if (parts.length >= 2) {
          const integerPart = parts[0].replace(/[^0-9,-]/g, '');
          const decimalPart = parts[1].replace(/[^0-9]/g, '').substring(0, 2);
          cleaned = integerPart + '.' + decimalPart;
        }
      } else {
        cleaned = cleaned.replace(/[^0-9,-]/g, '');
      }

      cleaned = cleaned.replace(/,/g, '');

      const result = parseFloat(cleaned);
      return isNaN(result) ? 0 : result;
    }

    function resolveProductUrl(link) {
      if (!link) return '';
      const DOMINIO = 'https://www.liverpool.com.mx';

      const absoluta = link.href || '';
      if (/^https?:\/\/([a-z0-9-]+\.)*liverpool\.com\.mx(?::\d+)?(\/|$|\?|#)/i.test(absoluta)) {
        return absoluta.replace(/^http:/i, 'https:');
      }

      const crudo = (link.getAttribute('href') || '').trim();
      if (crudo.indexOf('/') === 0 && crudo.indexOf('//') !== 0) return DOMINIO + crudo;

      return '';
    }
  }

  /** Lee el enlace configurado en el popup; si no hay ninguno, el de por defecto. */
  function leerUrlCotizador() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(CLAVE_URL, guardado => {
          if (chrome.runtime.lastError) { resolve(URL_COTIZADOR_POR_DEFECTO); return; }
          resolve((guardado && guardado[CLAVE_URL]) || URL_COTIZADOR_POR_DEFECTO);
        });
      } catch (e) { resolve(URL_COTIZADOR_POR_DEFECTO); }
    });
  }

  /**
   * Icono + texto del botón. Mismo SVG de "documento" que usa el botón
   * "Cotizar" del popup, para que se reconozca como la misma acción.
   */
  function contenidoBoton(texto) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z">'
      + '</path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line>'
      + '<line x1="16" y1="17" x2="8" y2="17"></line></svg><span>' + texto + '</span>';
  }

  /**
   * Crea el botón "Cotizar". El tamaño/tipografía copian los valores calculados
   * del botón "Comprar" (padding 12px 24px, 15px, radio 4px) para que ocupe el
   * mismo espacio visual; el color es el morado de marca de Ventel (no el rosa
   * de Liverpool) a propósito, para que nadie lo confunda con un botón nativo
   * de la tienda ni lo pulse pensando que va a pagar.
   */
  function crearBoton() {
    const boton = document.createElement('button');
    boton.id = ID_BOTON_VENTEL;
    boton.type = 'button';
    boton.setAttribute('aria-label', 'Cotizar esta bolsa en el Sistema de Cotizaciones Ventel');
    boton.innerHTML = contenidoBoton('Cotizar');

    Object.assign(boton.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      width: '100%',
      boxSizing: 'border-box',
      padding: '12px 24px',
      fontSize: '15px',
      fontWeight: '700',
      fontFamily: 'Roboto, Arial, sans-serif',
      lineHeight: '16.5px',
      borderRadius: '4px',
      border: 'none',
      cursor: 'pointer',
      color: '#ffffff',
      background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
      boxShadow: '0 2px 8px rgba(124, 58, 237, .35)',
      transition: 'filter .15s ease'
    });

    boton.addEventListener('mouseenter', () => { if (!boton.disabled) boton.style.filter = 'brightness(1.08)'; });
    boton.addEventListener('mouseleave', () => { boton.style.filter = 'none'; });
    boton.addEventListener('click', manejarClick);

    return boton;
  }

  async function manejarClick(ev) {
    const boton = ev.currentTarget;
    if (boton.disabled) return;

    boton.disabled = true;
    boton.style.cursor = 'default';
    boton.style.filter = 'none';
    boton.style.opacity = '.75';
    boton.innerHTML = contenidoBoton('Preparando cotización…');

    try {
      const bolsa = extractBagFromDOM();

      if (!bolsa || !bolsa.products || bolsa.products.length === 0) {
        boton.innerHTML = contenidoBoton('Sin artículos que cotizar');
        return;
      }

      const base = await leerUrlCotizador();
      let destino;
      try {
        const u = new URL(base);
        u.searchParams.set('page', 'cotizacion');
        destino = u.toString();
      } catch (e) {
        destino = URL_COTIZADOR_POR_DEFECTO + '?page=cotizacion';
      }

      // No se espera a que termine de guardarse: es la misma red de seguridad
      // que en popup.js, no el camino principal. El principal es abrir la
      // pestaña ya, sin perder el gesto del usuario por un await de más.
      try {
        chrome.storage.local.set({ [CLAVE_BOLSA]: { data: bolsa, createdAt: Date.now() } });
      } catch (e) { /* sin permiso de storage: sigue por el portapapeles */ }

      try { navigator.clipboard.writeText(JSON.stringify(bolsa, null, 2)); } catch (e) {}

      window.open(destino, '_blank', 'noopener');

      boton.innerHTML = contenidoBoton('✅ Cotización enviada');
    } catch (err) {
      console.error('[Ventel] Error al cotizar desde la bolsa:', err);
      boton.innerHTML = contenidoBoton('Error, reintenta');
    } finally {
      setTimeout(() => {
        boton.disabled = false;
        boton.style.cursor = 'pointer';
        boton.style.opacity = '';
        boton.innerHTML = contenidoBoton('Cotizar');
      }, 2500);
    }
  }

  /** Inserta el botón justo arriba de "Comprar" si hace falta (y todavía no está). */
  function insertarSiHaceFalta() {
    const botonComprar = document.querySelector(`[data-testid="${TESTID_BOTON_COMPRAR}"]`);
    if (!botonComprar) return;
    if (document.getElementById(ID_BOTON_VENTEL)) return;

    const contenedor = botonComprar.parentNode;
    if (!contenedor) return;

    contenedor.insertBefore(crearBoton(), botonComprar);
  }

  /**
   * La bolsa es una SPA: se puede llegar por navegación completa o por un
   * cambio de ruta sin recarga (el resumen de pago se monta y desmonta igual
   * en ambos casos). Un MutationObserver cubre los dos sin distinguir uno de
   * otro; el `querySelector` de arriba es barato y aquí se limita con un
   * pequeño debounce para no correrlo en cada micro-mutación del React de
   * Liverpool.
   */
  let idTimeout = null;
  const observador = new MutationObserver(() => {
    clearTimeout(idTimeout);
    idTimeout = setTimeout(insertarSiHaceFalta, 150);
  });

  function iniciar() {
    insertarSiHaceFalta();
    observador.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
