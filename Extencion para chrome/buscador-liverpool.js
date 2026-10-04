/**
 * =============================================================================
 * Ventel · Vende más — el buscador de liverpool.com.mx (buscador-liverpool.js)
 * =============================================================================
 * Desde la 2.7 la tarjeta no solo lee los carruseles de la ficha: cuando a un
 * tipo natural le falta un buen candidato (la mica del iPhone, la secadora que
 * hace par con la lavadora, el set de la misma fragancia), lo BUSCA en el sitio
 * con la misma búsqueda pública que usaría el asesor (/tienda?s=…).
 *
 * La regla que manda sobre todo lo demás: ESTO NUNCA DEBE HACER QUE LIVERPOOL
 * BLOQUEE LA SESIÓN DE UN ASESOR. Un bloqueo no le quita la tarjeta: le quita el
 * sitio entero en plena llamada. Por eso:
 *   · Caché por búsqueda, 24 h, en chrome.storage.local (la compartan todas las
 *     pestañas): «funda iPhone 16» se repite en cada color y cada día.
 *   · Ritmo: como mucho 4 búsquedas por minuto y 40 por hora, contadas entre
 *     todas las pestañas.
 *   · Freno: cualquier respuesta que no sea 200, o una página «Access Denied»,
 *     apaga las búsquedas 60 minutos.
 *   · Interruptor: el Portal puede apagarlas para todos (ajustes.busqueda en el
 *     paquete de promociones); eso lo decide recomendador.js antes de llamar.
 * La petición la hace la propia página (content script, mismo origen), no el
 * fondo de la extensión: es la que ya se probó que el sitio acepta.
 *
 * Aquí no hay DOM ni chrome.*: todo llega por `dep`, para probarlo en Node.
 *   dep.leer(claves) → Promise<obj>      dep.guardar(obj) → Promise
 *   dep.pedir(url)   → Promise<{ status, texto }>
 *   dep.leerResultados(texto) → { titulo, items: [{ id, marca, nombre, precio, rango, desc, img, href }] }
 *   dep.ahora() → ms
 *
 * Hecho para Ventel · v1.1 · 04/10/2026
 */
(function (raiz) {
  'use strict';

  var CLAVE_CACHE = 'vmBusquedas';
  var CLAVE_PAUSA = 'vmBusquedaPausa';
  var CLAVE_RITMO = 'vmBusquedaRitmo';
  // La forma de lo guardado. Desde la 3.0 cada resultado lleva su calificación, sus
  // opiniones y su vendedor (lector-liverpool.js): lo que guardó la 2.9 no los trae y
  // se da por caducado, en vez de esperar 24 h a que el núcleo pueda elegir por calidad.
  var FORMA = 2;
  var TTL = 24 * 3600000;
  var TOPE_CACHE = 200;
  var TOPE_ITEMS = 24;
  var PAUSA = 60 * 60000;
  var POR_MINUTO = 4;
  var POR_HORA = 40;

  function clave(consulta) {
    return String(consulta || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();
  }

  function crear(dep) {
    var enVuelo = {};

    /** Lo que ya hay en caché para esa búsqueda (null si no hay o caducó). Nunca sale a la red. */
    function deCache(consulta) {
      var k = clave(consulta);
      return dep.leer([CLAVE_CACHE]).then(function (r) {
        var hit = (r[CLAVE_CACHE] || {})[k];
        return hit && hit.v === FORMA && dep.ahora() - hit.en < TTL ? hit.items : null;
      });
    }

    /**
     * Resultados de una búsqueda: de la caché si los hay; si no, de la red, si el
     * ritmo y el freno lo permiten. Devuelve { items, de } o { items: null, motivo }.
     */
    function buscar(consulta) {
      var k = clave(consulta);
      if (!k) return Promise.resolve({ items: null, motivo: 'vacia' });
      if (enVuelo[k]) return enVuelo[k];
      var p = dep.leer([CLAVE_CACHE, CLAVE_PAUSA, CLAVE_RITMO]).then(function (r) {
        var ahora = dep.ahora();
        var cache = r[CLAVE_CACHE] || {};
        var hit = cache[k];
        if (hit && hit.v === FORMA && ahora - hit.en < TTL) return { items: hit.items, de: 'cache' };
        if (r[CLAVE_PAUSA] && r[CLAVE_PAUSA] > ahora) return { items: null, motivo: 'pausa' };
        var ritmo = (r[CLAVE_RITMO] || []).filter(function (t) { return ahora - t < 3600000; });
        var ultimoMinuto = ritmo.filter(function (t) { return ahora - t < 60000; }).length;
        if (ultimoMinuto >= POR_MINUTO || ritmo.length >= POR_HORA) return { items: null, motivo: 'ritmo' };
        ritmo.push(ahora);
        var marca = {}; marca[CLAVE_RITMO] = ritmo;
        return dep.guardar(marca).then(function () {
          return dep.pedir('/tienda?s=' + encodeURIComponent(consulta)).then(null, function () { return null; });
        }).then(function (resp) {
          var leido = null;
          if (resp && resp.status === 200) {
            try { leido = dep.leerResultados(resp.texto); } catch (e) { leido = null; }
          }
          if (!leido || /access denied/i.test(String(leido.titulo || ''))) {
            var freno = {}; freno[CLAVE_PAUSA] = dep.ahora() + PAUSA;
            return dep.guardar(freno).then(function () { return { items: null, motivo: 'freno' }; });
          }
          var items = (leido.items || []).slice(0, TOPE_ITEMS);
          // Se vuelve a leer la caché: otra pestaña pudo guardar algo mientras tanto.
          return dep.leer([CLAVE_CACHE]).then(function (r2) {
            var c2 = r2[CLAVE_CACHE] || {};
            c2[k] = { en: dep.ahora(), v: FORMA, items: items };
            var claves = Object.keys(c2);
            if (claves.length > TOPE_CACHE) {
              claves.sort(function (a, b) { return c2[a].en - c2[b].en; })
                .slice(0, claves.length - TOPE_CACHE).forEach(function (x) { delete c2[x]; });
            }
            var nuevo = {}; nuevo[CLAVE_CACHE] = c2;
            return dep.guardar(nuevo).then(function () { return { items: items, de: 'red' }; });
          });
        });
      }).then(function (res) { delete enVuelo[k]; return res; }, function () { delete enVuelo[k]; return { items: null, motivo: 'error' }; });
      enVuelo[k] = p;
      return p;
    }

    return { buscar: buscar, deCache: deCache };
  }

  raiz.VentelBuscador = {
    crear: crear, clave: clave, FORMA: FORMA,
    TTL: TTL, PAUSA: PAUSA, POR_MINUTO: POR_MINUTO, POR_HORA: POR_HORA, TOPE_CACHE: TOPE_CACHE,
    CLAVES: { cache: CLAVE_CACHE, pausa: CLAVE_PAUSA, ritmo: CLAVE_RITMO }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
