/**
 * =============================================================================
 * Ventel · El acceso a la medición desde el popup (popup-medicion.js)
 * =============================================================================
 * Un solo botón: abre medicion.html en una pestaña nueva. Vive en un archivo
 * aparte, como popup-contexto.js y por lo mismo: tocar esto nunca puede romper
 * `extractBagFromDOM` (el extractor clásico, intocable) ni el resto de popup.js.
 * Si algo falla aquí, el popup se queda como estaba.
 *
 * Hecho para Ventel · v1.0 · 04/10/2026
 */
(function () {
  'use strict';
  var boton = document.getElementById('btnMedicion');
  if (!boton) return;
  boton.addEventListener('click', function () {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('medicion.html') });
    } catch (e) { /* sin contexto de extensión: no hay nada que abrir */ }
  });
})();
