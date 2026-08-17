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
 * CÓMO CONVERSAN LAS DOS PARTES (v3)
 * -----------------------------------
 * La v1 usaba `window.postMessage` entre este content script (mundo aislado) y
 * el script de la pantalla (mundo principal): no llegaba, porque un mundo
 * aislado no comparte objetos de JavaScript con la página. La v2 pasó a dejar
 * los datos en el DOM (`<script type="application/json" id="ventel-bolsa-datos">`),
 * que SÍ es compartido de verdad — pero seguía sin llegar, y la razón salió
 * hasta probarlo en Chrome real con capturas visibles superpuestas a la
 * pantalla: Apps Script NO pone el HTML de la webapp en el frame donde este
 * content script corre (`userCodeAppPanel`, en `*.googleusercontent.com`).
 * Ese frame es solo el marco; el contenido real vive en un SEGUNDO iframe
 * interno (`userHtmlFrame`) que arranca en `about:blank` y navega ~1 a 1.5
 * segundos después a otra URL — del MISMO origen que el frame externo, pero
 * Chrome no vuelve a inyectar un content script ahí solo porque coincida el
 * patrón del manifest si esa navegación ocurre dentro de un iframe que ya
 * existía sin ella (en la práctica, para esta combinación de Apps Script no
 * llegaba una segunda inyección). Escribir el elemento en el frame externo
 * dejaba los datos en un documento que `cotizacion.html` nunca lee, aunque
 * ambos frames se vean superpuestos en la misma pantalla.
 *
 * El arreglo: en vez de depender de una segunda inyección del content script,
 * este puente localiza ese iframe interno desde el frame externo (accesible
 * porque es el mismo origen — confirmado en pruebas: `contentDocument` no
 * lanza error de origen cruzado) y escribe el elemento DIRECTAMENTE en su
 * documento. Como el iframe interno tarda en navegar, se reintenta cada 300 ms
 * hasta encontrar uno cuyo `location.href` ya no sea `about:blank`. Si no
 * apareciera ningún iframe así (otra variante de Apps Script sin ese frame
 * intermedio), se cae al comportamiento v2: escribir en el propio documento.
 *
 *   1. Este puente lee `chrome.storage.local['bolsaParaCotizar']` en cuanto el
 *      documento está listo.
 *   2. Si hay una bolsa vigente (menos de 15 minutos), la borra del
 *      almacenamiento (se entrega una sola vez) y escribe su JSON dentro de
 *      `<script type="application/json" id="ventel-bolsa-datos">` al final del
 *      `<head>` del documento correcto (el iframe interno de contenido, o el
 *      propio si no lo encuentra). Ese tipo de `<script>` no se ejecuta nunca
 *      — es solo un lugar donde dejar datos que la página SÍ puede leer con un
 *      `document.getElementById` normal, sin permisos ni orígenes de por medio.
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
 * Hecho por su gran amigo David Martínez "El escritor" · v3.0
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

  const MAX_INTENTOS_FRAME = 15;
  const ESPERA_FRAME_MS = 300;

  /** El iframe interno de Apps Script, ya navegado a su contenido real (no about:blank). */
  function frameDeContenido() {
    let iframes;
    try { iframes = document.querySelectorAll('iframe'); } catch (e) { return null; }
    for (let i = 0; i < iframes.length; i++) {
      let doc;
      try { doc = iframes[i].contentDocument; } catch (e) { continue; }
      if (doc && doc.location && doc.location.href && doc.location.href !== 'about:blank') {
        return doc;
      }
    }
    return null;
  }

  function escribirElemento(doc, bolsa) {
    if (doc.getElementById(ID_ELEMENTO)) return;

    let json;
    try { json = JSON.stringify(bolsa.data); } catch (e) { return; }

    const elemento = doc.createElement('script');
    elemento.type = 'application/json';
    elemento.id = ID_ELEMENTO;
    elemento.textContent = json;
    (doc.head || doc.documentElement).appendChild(elemento);
  }

  /**
   * El iframe interno tarda en navegar (visto entre 1 y 1.5 s en pruebas), así
   * que se reintenta. Si se agotan los intentos sin encontrarlo, se entrega en
   * el propio documento — el comportamiento de la v2, por si esta variante de
   * Apps Script no usa ese iframe intermedio.
   */
  function entregar(bolsa) {
    let intentos = 0;
    (function intentar() {
      const doc = frameDeContenido();
      if (doc) { escribirElemento(doc, bolsa); return; }

      intentos++;
      if (intentos >= MAX_INTENTOS_FRAME) { escribirElemento(document, bolsa); return; }
      setTimeout(intentar, ESPERA_FRAME_MS);
    })();
  }

  function entregarSiHay() {
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

      entregar(bolsa);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', entregarSiHay);
  } else {
    entregarSiHay();
  }
})();
