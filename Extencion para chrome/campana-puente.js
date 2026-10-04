/**
 * =============================================================================
 * Ventel · Vende más — el lector de promociones del Portal (campana-puente.js)
 * =============================================================================
 * Content script de los marcos de Apps Script (*.googleusercontent.com). Busca
 * el elemento que deja la portada del Portal (app_venta_cruzada.html):
 *   script de tipo application/json, id «ventel-promos-datos»
 * y se lo pasa TAL CUAL al fondo de la extensión (fondo.js), que es quien decide
 * si lo guarda: solo si la pestaña es el Portal (producción o pruebas). Aquí no
 * se confía en nada; se lee y se entrega.
 *
 * Por qué así, y no como bridge.js:
 *   · googleusercontent.com lo comparten TODAS las webapps de Apps Script. Este
 *     marco no puede saber de cuál es; el fondo sí, porque ve la URL de la
 *     pestaña (script.google.com/…/s/<id>/exec). Por eso la decisión vive allá.
 *   · Chrome no reinyecta el content script en el marco interior de Apps Script
 *     cuando navega (la trampa del puente de la bolsa). La portada escribe el
 *     elemento también en la página de arriba, y además aquí se miran los marcos
 *     hijos del mismo origen.
 *   · Solo LEE: nunca escribe en la página ni habla primero con ella.
 *
 * Hecho para Ventel · v1.0 · 04/10/2026
 */
(function () {
  'use strict';
  // Solo los marcos de Apps Script; el resto de googleusercontent (Drive, fotos…) no.
  if (!/(^|\.)[\w-]*script\.googleusercontent\.com$/.test(location.hostname)) return;
  if (window.__ventelCampanaPuente) return;
  window.__ventelCampanaPuente = true;

  var ID = 'ventel-promos-datos';
  var TOPE = 200000;          // más de esto no es un paquete de promociones
  var ultimo = '';
  var vueltas = 0;

  function documentos() {
    var docs = [document];
    var marcos = document.querySelectorAll('iframe');
    for (var i = 0; i < marcos.length; i++) {
      try {
        var d = marcos[i].contentDocument;   // null o excepción si es de otro origen
        if (d) docs.push(d);
      } catch (e) { /* otro origen */ }
    }
    return docs;
  }

  function revisar() {
    var docs = documentos();
    for (var i = 0; i < docs.length; i++) {
      var el = null;
      try { el = docs[i].getElementById(ID); } catch (e) { el = null; }
      if (!el) continue;
      var texto = String(el.textContent || '');
      if (!texto || texto.length > TOPE || texto === ultimo) return;
      ultimo = texto;
      try {
        chrome.runtime.sendMessage({ tipo: 'ventel-promos', datos: texto }, function () {
          // Sin fondo que conteste (extensión recargada): se intenta en la siguiente vuelta.
          if (chrome.runtime.lastError) ultimo = '';
        });
      } catch (e) { ultimo = ''; }
      return;
    }
  }

  // La portada pide las promociones en segundo plano: llegan unos segundos después de
  // cargar. Cada 2 s durante 2 min, y luego cada minuto mientras el Portal siga abierto
  // (el botón «Actualizar» y la copia de media hora las vuelven a escribir).
  function ciclo() {
    revisar();
    vueltas++;
    setTimeout(ciclo, vueltas < 60 ? 2000 : 60000);
  }
  ciclo();
})();
