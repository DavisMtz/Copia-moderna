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
 * CÓMO CONVERSAN LAS DOS PARTES (v2)
 * -----------------------------------
 * La v1 usaba `window.postMessage` entre este content script (mundo aislado) y
 * el script de la pantalla (mundo principal). En producción no llegaba: el
 * asesor seguía viendo el modal manual de "Importar → Aceptar". Un mundo
 * aislado NO comparte objetos de JavaScript con la página, así que depender de
 * que ambos lados coincidan en la identidad exacta de `window` para un mensaje
 * es frágil. Lo único que un content script SÍ comparte de verdad con la
 * página es el DOM, así que ahora la entrega es un elemento del DOM:
 *
 *   1. Este puente lee `chrome.storage.local['bolsaParaCotizar']` en cuanto el
 *      documento está listo.
 *   2. Si hay una bolsa vigente (menos de 15 minutos), la borra del
 *      almacenamiento (se entrega una sola vez) y escribe su JSON dentro de
 *      `<script type="application/json" id="ventel-bolsa-datos">` al final del
 *      `<head>`. Ese tipo de `<script>` no se ejecuta nunca — es solo un lugar
 *      donde dejar datos que la página SÍ puede leer con un `document.getElementById`
 *      normal, sin permisos ni orígenes de por medio.
 *   3. La pantalla de cotización (cotizacion.html) busca ese elemento con un
 *      `setInterval` corto tras arrancar; si aparece, lo lee, lo borra del DOM y
 *      sigue con lo suyo. Si no aparece en unos segundos, asume que no hay
 *      extensión (o no hay bolsa) y no vuelve a intentarlo.
 *
 * Ámbito: lo más que podría conseguir otra webapp de Apps Script que se cargara
 * en un `*.googleusercontent.com` es la lista de artículos de Liverpool que el
 * propio asesor puso en su bolsa — datos públicos de catálogo, sin nada del
 * asesor ni de sus clientes.
 *
 * Hecho por su gran amigo David Martínez "El escritor" · v2.0
 */
(function () {
  'use strict';

  const CLAVE = 'bolsaParaCotizar';
  const ID_ELEMENTO = 'ventel-bolsa-datos';

  /**
   * Una bolsa vieja no se entrega: los precios y las promociones de Liverpool
   * cambian sin aviso, y una bolsa de ayer cotizada hoy es una cotización mal
   * hecha. Quince minutos cubren de sobra el camino extraer → iniciar sesión →
   * llegar a la pantalla, que es para lo único que existe este puente.
   */
  const VIGENCIA_MS = 15 * 60 * 1000;

  function entregarSiHay() {
    // Ya se entregó en esta misma carga de página (no debería llamarse dos
    // veces, pero por si acaso: entregar dos elementos sería peor que ninguno).
    if (document.getElementById(ID_ELEMENTO)) return;

    let almacen;
    try {
      almacen = chrome.storage && chrome.storage.local;
    } catch (e) {
      almacen = null;
    }
    if (!almacen) return;

    almacen.get(CLAVE, function (guardado) {
      // El contexto de la extensión puede haberse recargado bajo los pies del
      // content script (una actualización, un "Recargar" en chrome://extensions).
      if (chrome.runtime.lastError) return;

      const bolsa = guardado && guardado[CLAVE];
      const vigente = bolsa && bolsa.data &&
                      (Date.now() - (bolsa.createdAt || 0)) < VIGENCIA_MS;

      if (!vigente) {
        if (bolsa) { try { almacen.remove(CLAVE); } catch (e) {} }
        return;
      }

      // Se borra ANTES de escribirla en el DOM: una bolsa se cotiza una vez.
      // Si la pestaña se cerrara justo después, es preferible perder esa
      // bolsa a que reaparezca duplicada en la siguiente cotización.
      try { almacen.remove(CLAVE); } catch (e) {}

      let json;
      try { json = JSON.stringify(bolsa.data); } catch (e) { return; }

      const elemento = document.createElement('script');
      elemento.type = 'application/json';
      elemento.id = ID_ELEMENTO;
      elemento.textContent = json;
      (document.head || document.documentElement).appendChild(elemento);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', entregarSiHay);
  } else {
    entregarSiHay();
  }
})();
