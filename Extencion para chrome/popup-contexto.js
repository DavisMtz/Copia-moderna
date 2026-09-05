/**
 * =============================================================================
 * Ventel · Contexto del popup (popup-contexto.js)
 * =============================================================================
 * Dice en qué pantalla de Liverpool está la pestaña abierta y resalta el grupo
 * de botones que sirve ahí. Nada más: NO toca la extracción de la bolsa, ni los
 * botones, ni el almacenamiento. Vive en un archivo aparte a propósito, para
 * que tocar la presentación nunca pueda romper `extractBagFromDOM` (el
 * extractor clásico, intocable) ni el resto de `popup.js`.
 *
 * Si algo falla aquí, el popup se queda como estaba: los tres grupos visibles y
 * usables, sin ninguno atenuado.
 *
 * Hecho por su gran amigo David Martínez "El escritor" · v1.0 · 05/09/2026
 */

(function () {
  'use strict';

  /**
   * Misma clasificación que usa el inspector de pantalla, palabra por palabra:
   * si Liverpool cambia una ruta, los dos sitios tienen que cambiar igual.
   * "Thank You" no sirve como pista: el checkout también lo dice.
   */
  function detectarPantalla(url) {
    var u = String(url || '').toLowerCase();
    if (u.indexOf('/tienda/pdp/') !== -1) return 'pdp';
    if (u.indexOf('checkoutorderconfirmation') !== -1) return 'confirmacion';
    if (u.indexOf('onecheckout') !== -1) return 'checkout';
    if (u.indexOf('/tienda/cart') !== -1) return 'bolsa';
    if (u.indexOf('file://') === 0) return 'archivo';
    if (u.indexOf('liverpool.com.mx') !== -1) return 'liverpool';
    return 'fuera';
  }

  // Qué grupo manda en cada pantalla, y qué se le dice al asesor. `grupo: null`
  // significa "no resaltes nada": los tres quedan igual de disponibles.
  var PANTALLAS = {
    bolsa:        { grupo: 'grupoBolsa',  texto: 'Estás en tu bolsa de Liverpool' },
    pdp:          { grupo: 'grupoFicha',  texto: 'Estás en la ficha de un artículo' },
    confirmacion: { grupo: 'grupoCompra', texto: 'Estás en la compra confirmada' },
    checkout:     { grupo: null, texto: 'Estás en el checkout: la compra todavía no se cierra' },
    archivo:      { grupo: null, texto: 'Archivo local abierto' },
    liverpool:    { grupo: null, texto: 'Estás en Liverpool, en otra pantalla' },
    fuera:        { grupo: null, texto: 'Abre Liverpool para usar la extensión' }
  };

  var GRUPOS = ['grupoBolsa', 'grupoFicha', 'grupoCompra'];

  function pintar(pantalla) {
    var info = PANTALLAS[pantalla] || PANTALLAS.fuera;

    var caja = document.getElementById('ctxPantalla');
    var texto = document.getElementById('ctxTexto');
    if (texto) texto.textContent = info.texto;
    if (caja) caja.classList.toggle('reconocida', !!info.grupo);

    for (var i = 0; i < GRUPOS.length; i++) {
      var el = document.getElementById(GRUPOS[i]);
      if (!el) continue;
      var esElActivo = info.grupo === GRUPOS[i];
      el.classList.toggle('activo', esElActivo);
      // Sin pantalla reconocida no se atenúa nada: atenuar los tres a la vez
      // solo haría que la extensión pareciera rota.
      el.classList.toggle('apagado', !!info.grupo && !esElActivo);
    }
    // El grupo activo sube al principio de la lista con `order` en el CSS: sin
    // eso, en la compra confirmada el botón que toca caía por debajo de los
    // 600px a los que Chrome corta el popup.
  }

  async function arrancar() {
    try {
      var consulta = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = consulta && consulta[0];
      pintar(detectarPantalla(tab && tab.url));
    } catch (e) {
      // Sin permiso para leer la URL (o sin pestaña): se deja todo visible y por
      // igual, que es el comportamiento de siempre.
      pintar('fuera');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }
})();
