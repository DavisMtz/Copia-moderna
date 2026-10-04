/**
 * =============================================================================
 * Ventel · el fondo de la extensión (fondo.js, service worker)
 * =============================================================================
 * Hoy hace una sola cosa: recibe las promociones del Monitor que lee
 * campana-puente.js en el Portal y las guarda en chrome.storage.local
 * ['ventelPromos'], de donde las toma la tarjeta «Vende más» de cada ficha.
 *
 * La regla que lo justifica: googleusercontent.com es de TODAS las webapps de
 * Apps Script, así que cualquiera podría dejar un elemento con ese id. El marco
 * no sabe de qué webapp es; el fondo sí, porque ve la URL de la PESTAÑA
 * (sender.tab.url, que Chrome solo da con el permiso de script.google.com). Se
 * guarda únicamente si esa URL es un despliegue del Portal:
 *   · producción  AKfycbwGYZs3… (el /exec de asesores y extensión)
 *   · pruebas     AKfycbxSjCvwk… (la /dev del entorno de desarrollo)
 *   · el que el asesor haya configurado en el popup («Guardar enlace»)
 * Y aun así se sanea: textos recortados, números acotados, nada de HTML ni
 * enlaces (la tarjeta arma los suyos y escribe todo con escape).
 *
 * Hecho para Ventel · v1.0 · 03/10/2026
 */
'use strict';

var PORTAL_DESPLIEGUES = [
  'AKfycbwGYZs3C-dsZbIWVn27uEaLm_rXQGhiQc9Q54btPxPb-Z1SX0Enx7NlPqKw4STizaOU',  // producción
  'AKfycbxSjCvwk_f3pqcmIzyqlsPbPxlEHj91C6gjJdLXdLOS'                          // pruebas (/dev)
];
var CLAVE_PROMOS = 'ventelPromos';
var DIA = 86400000;

/** El id de despliegue de una URL de webapp de Apps Script, o null. */
function despliegueDe(url) {
  var m = String(url || '').match(/^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/([\w-]+)\/(?:exec|dev)(?:[/?#]|$)/);
  return m ? m[1] : null;
}

function texto(v, n) {
  var t = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) : t;
}
function entero(v, min, max) {
  var n = Math.round(Number(v));
  return isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

function promoLimpia(p) {
  if (!p || typeof p !== 'object') return null;
  var f = Number(p.f);
  var limpia = {
    d: texto(p.d, 60), c: texto(p.c, 80), t: texto(p.t, 140),
    p: entero(p.p, 0, 100), m: entero(p.m, 0, 48),
    f: isFinite(f) && f > 0 ? f : null,
    k: p.k === 'mkp' ? 'mkp' : ''
  };
  return (limpia.d || limpia.c || limpia.t) ? limpia : null;
}

/** El paquete saneado, o null si no tiene la forma que manda el Portal. */
function sanear(crudo, ahora) {
  var d;
  try { d = typeof crudo === 'string' ? JSON.parse(crudo) : crudo; } catch (e) { return null; }
  if (!d || typeof d !== 'object' || d.v !== 1 || !Array.isArray(d.promos)) return null;
  var generado = Number(d.generado);
  if (!isFinite(generado) || generado < ahora - 7 * DIA || generado > ahora + DIA) return null;
  var promos = [];
  for (var i = 0; i < d.promos.length && promos.length < 200; i++) {
    var p = promoLimpia(d.promos[i]);
    if (p) promos.push(p);
  }
  // Los ajustes del Portal: hoy, solo si la tarjeta puede buscar en liverpool.com.mx.
  // Encendida salvo que el Portal diga expresamente que no.
  var ajustes = { busqueda: !(d.ajustes && d.ajustes.busqueda === false) };
  return { v: 1, generado: generado, fuerte: promoLimpia(d.fuerte), promos: promos, ajustes: ajustes };
}

function leer(claves) {
  return new Promise(function (resolver) {
    chrome.storage.local.get(claves, function (r) { resolver(chrome.runtime.lastError ? {} : (r || {})); });
  });
}

/** ¿El mensaje viene de un marco de Apps Script dentro de una pestaña del Portal? */
function deDondeViene(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return Promise.resolve(null);
  var marco = String(sender.url || sender.origin || '');
  if (!/^https:\/\/[\w-]*script\.googleusercontent\.com(\/|$)/.test(marco)) return Promise.resolve(null);
  var id = despliegueDe(sender.tab && sender.tab.url);
  if (!id) return Promise.resolve(null);
  if (PORTAL_DESPLIEGUES.indexOf(id) > -1) return Promise.resolve(id);
  return leer(['cotizadorUrl']).then(function (r) {
    return despliegueDe(r.cotizadorUrl) === id ? id : null;
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, responder) {
  if (!msg || msg.tipo !== 'ventel-promos') return false;
  deDondeViene(sender).then(function (id) {
    if (!id) { responder({ ok: false, motivo: 'origen' }); return; }
    var ahora = Date.now();
    var paquete = sanear(msg.datos, ahora);
    if (!paquete) { responder({ ok: false, motivo: 'forma' }); return; }
    return leer([CLAVE_PROMOS]).then(function (r) {
      var actual = r[CLAVE_PROMOS];
      // Nunca se pisa una copia más nueva con una más vieja (dos pestañas del Portal,
      // producción y pruebas, publican cada una a su hora).
      if (actual && Number(actual.generado) > paquete.generado) { responder({ ok: true, guardado: false }); return; }
      paquete.despliegue = id;
      var cambio = {};
      cambio[CLAVE_PROMOS] = paquete;
      chrome.storage.local.set(cambio, function () {
        responder({ ok: !chrome.runtime.lastError, guardado: !chrome.runtime.lastError });
      });
    });
  }).catch(function () { responder({ ok: false, motivo: 'error' }); });
  return true;   // la respuesta llega después
});
