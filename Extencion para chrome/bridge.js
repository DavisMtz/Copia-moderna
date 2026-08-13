/**
 * =============================================================================
 * Ventel Bag Extractor · Puente con el Sistema de Cotizaciones (bridge.js)
 * =============================================================================
 * Entrega la bolsa extraída a la pantalla de cotización sin pasar por el
 * portapapeles ni por la URL.
 *
 * POR QUÉ EXISTE
 * --------------
 * El JSON de una bolsa con imágenes y enlaces a fichas pasa de sobra el largo
 * seguro de una URL, y el portapapeles dentro del iframe de Apps Script depende
 * de un permiso que el navegador no siempre concede. Aquí la bolsa viaja por
 * `chrome.storage.local`: sobrevive al desvío por el inicio de sesión y no tiene
 * límite práctico de tamaño.
 *
 * CÓMO CONVERSAN LAS DOS PARTES
 * -----------------------------
 *   1. La pantalla de cotización (cotizacion.html) anuncia que está lista:
 *        { source: 'ventel-cotizador', type: 'VENTEL_BOLSA_PIDE' }
 *   2. Este puente responde con la bolsa pendiente, si la hay:
 *        { source: 'ventel-extension', type: 'VENTEL_BOLSA_ENTREGA', payload }
 *      o con VENTEL_BOLSA_VACIA para que la pantalla deje de preguntar.
 *   3. Cuando la pantalla confirma que la importó:
 *        { source: 'ventel-cotizador', type: 'VENTEL_BOLSA_IMPORTADA' }
 *      la bolsa se borra del almacenamiento. Una bolsa se cotiza una vez.
 *
 * El puente HABLA PRIMERO NUNCA. Se inyecta en todo *.googleusercontent.com
 * —el subdominio del iframe de Apps Script cambia en cada carga, así que no se
 * puede acotar más— pero mientras nadie se identifique como la pantalla de
 * cotización, no lee el almacenamiento ni emite un solo mensaje. Lo más que
 * podría conseguir otra webapp de Apps Script que imitara el saludo es la lista
 * de artículos de Liverpool: datos públicos de catálogo, sin nada del asesor ni
 * de sus clientes. Ahí se detiene el alcance de este archivo.
 *
 * Hecho por su gran amigo David Martínez "El escritor" · v1.4
 */

(function () {
  'use strict';

  const CLAVE = 'bolsaParaCotizar';

  /**
   * Una bolsa vieja no se entrega: los precios y las promociones de Liverpool
   * cambian sin aviso, y una bolsa de ayer cotizada hoy es una cotización mal
   * hecha. Quince minutos cubren de sobra el camino extraer → iniciar sesión →
   * llegar a la pantalla, que es para lo único que existe este puente.
   */
  const VIGENCIA_MS = 15 * 60 * 1000;

  /** Responde al mismo marco que preguntó, a su origen exacto. */
  function responder(evento, mensaje) {
    const destino = (evento.origin && evento.origin !== 'null') ? evento.origin : '*';
    try {
      evento.source.postMessage(Object.assign({ source: 'ventel-extension' }, mensaje), destino);
    } catch (e) { /* el marco se fue mientras leíamos el almacenamiento */ }
  }

  function entregar(evento) {
    let almacen;
    try {
      almacen = chrome.storage && chrome.storage.local;
    } catch (e) {
      almacen = null;
    }
    if (!almacen) { responder(evento, { type: 'VENTEL_BOLSA_VACIA' }); return; }

    almacen.get(CLAVE, function (guardado) {
      // El contexto de la extensión puede haberse recargado bajo los pies del
      // content script (una actualización, un "Recargar" en chrome://extensions).
      if (chrome.runtime.lastError) { responder(evento, { type: 'VENTEL_BOLSA_VACIA' }); return; }

      const bolsa = guardado && guardado[CLAVE];
      const vigente = bolsa && bolsa.data &&
                      (Date.now() - (bolsa.createdAt || 0)) < VIGENCIA_MS;

      if (!vigente) {
        if (bolsa) { try { almacen.remove(CLAVE); } catch (e) {} }
        responder(evento, { type: 'VENTEL_BOLSA_VACIA' });
        return;
      }

      responder(evento, { type: 'VENTEL_BOLSA_ENTREGA', payload: bolsa.data });
    });
  }

  function olvidar() {
    try { chrome.storage.local.remove(CLAVE); } catch (e) {}
  }

  window.addEventListener('message', function (evento) {
    // Solo se atiende a este mismo marco: un iframe anidado o una ventana ajena
    // no puede pedir la bolsa en nombre de la pantalla de cotización.
    if (evento.source !== window) return;

    const datos = evento.data;
    if (!datos || typeof datos !== 'object' || datos.source !== 'ventel-cotizador') return;

    if (datos.type === 'VENTEL_BOLSA_PIDE') entregar(evento);
    else if (datos.type === 'VENTEL_BOLSA_IMPORTADA') olvidar();
  }, false);
})();
