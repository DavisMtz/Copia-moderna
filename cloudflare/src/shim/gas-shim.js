/*
 * =================================================================================================
 * Puente google.script → Cloudflare Worker | Portal Ventel en Cloudflare
 * =================================================================================================
 * Las pantallas de «Carpeta del proyecto» se escribieron para Apps Script y hablan con el servidor
 * por tres APIs que solo existen dentro del iframe de Google:
 *
 *   google.script.run      → llamar a una función del servidor (AppRun la usa para TODO)
 *   google.script.history  → escribir la URL de la ventana de arriba (AppUrl.reflejar, el Portal)
 *   google.script.url      → leer los parámetros de la URL de arriba
 *
 * Este archivo las reimplementa encima del navegador y de POST /api/rpc, con la MISMA forma, para
 * que ninguna pantalla cambie una línea. Lo inyecta scripts/construir.mjs como primer elemento del
 * <head> de cada pantalla, antes de cualquier otro script.
 *
 * Diferencias con Apps Script, todas a favor:
 *   · La página ya no vive en un iframe de googleusercontent: es la ventana de arriba. La URL que
 *     escribe history es la real y no hay límite de activación para navegar.
 *   · Cada llamada es un fetch al Worker más cercano (decenas de ms) en lugar de una ejecución de
 *     Apps Script (1.5–2.3 s medidos en el doc 15).
 *
 * Contrato con el Worker (src/worker/index.ts):
 *   POST /api/rpc  { "fn": "secEjecutar", "args": [llave, nombre, args, actividad, medir] }
 *   → 200 { "ok": true, "v": <respuesta> }  |  200 { "ok": false, "e": "<mensaje>" }
 * Un error llega al withFailureHandler como Error con ese mensaje, igual que en Apps Script (AppRun
 * mira si empieza por SESION_EXPIRADA).
 * =================================================================================================
 */
(function () {
  'use strict';
  if (window.google && window.google.script && window.google.script.__vx) return;

  // La lista la pone scripts/construir.mjs, leída de PARAMS_VISTA en Code.gs.
  var PARAMS_VISTA = /*__PARAMS_VISTA__*/[];
  var RPC = '/api/rpc';

  function errorDeScript(mensaje) {
    var e = new Error(String(mensaje || 'Error desconocido del servidor.'));
    e.name = 'ScriptError';
    return e;
  }

  /** Lo que Apps Script no deja pasar como argumento se limpia igual que él: sin funciones. */
  function serializable(valor) {
    if (valor === undefined || typeof valor === 'function') return null;
    if (valor instanceof Date) throw errorDeScript('No se puede enviar una fecha como argumento.');
    return valor;
  }

  var medidasRed = [];   // [{fn, ms, srv}] para el panel de velocidad (isla React)

  // Al salir de la pantalla, el navegador corta las llamadas en vuelo. En Apps Script eso no llegaba
  // al withFailureHandler (el marco ya no existía); aquí la página aún vive un instante y lo vería
  // como «no se pudo contactar al servidor». Una falla de red se entrega con un respiro y se calla si
  // en ese respiro la página se fue.
  var saliendo = false;
  window.addEventListener('pagehide', function () { saliendo = true; });
  window.addEventListener('pageshow', function () { saliendo = false; });
  function fallaDeRed(error) {
    return new Promise(function (_, rechazar) {
      if (saliendo) return;
      setTimeout(function () { if (!saliendo) rechazar(error); }, 250);
    });
  }

  function llamar(fn, args) {
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var cuerpo;
    try {
      cuerpo = JSON.stringify({ fn: fn, args: (args || []).map(serializable) });
    } catch (e) {
      return Promise.reject(errorDeScript(e && e.message));
    }
    return fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: cuerpo
    }).then(function (r) {
      var srv = -1;
      try {
        var st = r.headers.get('Server-Timing') || '';
        var m = st.match(/app;dur=([\d.]+)/);
        if (m) srv = Number(m[1]);
      } catch (e) {}
      return r.json().then(function (d) { return { d: d, srv: srv, status: r.status }; }, function () {
        return fallaDeRed(errorDeScript('El servidor contestó algo que no se pudo leer (' + r.status + ').'));
      });
    }, function () {
      return fallaDeRed(errorDeScript('No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.'));
    }).then(function (x) {
      var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      var nombre = fn === 'secEjecutar' ? String((args && args[1]) || fn)
                 : fn === 'secEjecutarLote' ? 'lote(' + (((args && args[1]) || []).map(function (i) { return i && i[0]; }).join(',')) + ')'
                 : fn;
      medidasRed.push({ fn: nombre, ms: Math.round(t1 - t0), srv: x.srv, t: Date.now(), ok: !!(x.d && x.d.ok) });
      if (medidasRed.length > 200) medidasRed.splice(0, medidasRed.length - 200);
      try { window.dispatchEvent(new CustomEvent('vx:rpc', { detail: medidasRed[medidasRed.length - 1] })); } catch (e) {}
      if (x.d && x.d.ok) return x.d.v;
      throw errorDeScript((x.d && x.d.e) || ('Error del servidor (' + x.status + ').'));
    });
  }

  /** Un "runner" como el de Apps Script: inmutable, encadenable y con cualquier función colgando. */
  function crearRunner(alExito, alFallo, objetoUsuario) {
    var base = {
      withSuccessHandler: function (f) { return crearRunner(f, alFallo, objetoUsuario); },
      withFailureHandler: function (f) { return crearRunner(alExito, f, objetoUsuario); },
      withUserObject: function (o) { return crearRunner(alExito, alFallo, o); }
    };
    return new Proxy(base, {
      get: function (objetivo, prop) {
        if (Object.prototype.hasOwnProperty.call(objetivo, prop)) return objetivo[prop];
        // 'then' no: un runner no es una promesa (Promise.resolve(runner) no debe esperarlo).
        if (typeof prop !== 'string' || prop === 'then' || prop === 'toJSON') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          llamar(prop, args).then(function (v) {
            if (typeof alExito === 'function') {
              try { alExito(v, objetoUsuario); } catch (e) { setTimeout(function () { throw e; }); }
            }
          }, function (err) {
            if (typeof alFallo === 'function') {
              try { alFallo(err, objetoUsuario); } catch (e) { setTimeout(function () { throw e; }); }
            } else if (window.console) {
              console.error('google.script.run.' + prop + ' falló:', err);
            }
          });
        };
      }
    });
  }

  /* ── google.script.url / history ─────────────────────────────────────────────────────────── */

  function ubicacion() {
    var parameter = {}, parameters = {};
    new URLSearchParams(location.search).forEach(function (v, k) {
      if (!Object.prototype.hasOwnProperty.call(parameter, k)) parameter[k] = v;
      (parameters[k] = parameters[k] || []).push(v);
    });
    return { hash: location.hash.replace(/^#/, ''), parameter: parameter, parameters: parameters };
  }

  /** Apps Script REEMPLAZA la query entera con `params`: aquí igual. */
  function urlDe(params, hash) {
    var sp = new URLSearchParams();
    if (params && typeof params === 'object') {
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        if (v === null || v === undefined) return;
        if (Array.isArray(v)) v.forEach(function (x) { sp.append(k, String(x)); });
        else sp.append(k, String(v));
      });
    }
    var qs = sp.toString();
    var h = (hash === null || hash === undefined || hash === '') ? '' : '#' + String(hash).replace(/^#/, '');
    return location.pathname + (qs ? '?' + qs : '') + h;
  }

  var manejador = null;
  window.addEventListener('popstate', function (e) {
    if (typeof manejador !== 'function') return;
    try { manejador({ state: e.state, location: ubicacion() }); } catch (err) { setTimeout(function () { throw err; }); }
  });

  var history_ = {
    push: function (estado, params, hash) {
      try { window.history.pushState(estado === undefined ? null : estado, '', urlDe(params, hash)); } catch (e) {}
    },
    replace: function (estado, params, hash) {
      try { window.history.replaceState(estado === undefined ? null : estado, '', urlDe(params, hash)); } catch (e) {}
    },
    setChangeHandler: function (f) { manejador = f; }
  };

  var url_ = {
    getLocation: function (cb) {
      var loc = ubicacion();
      setTimeout(function () { if (typeof cb === 'function') cb(loc); }, 0);
    }
  };

  // En una webapp no hay contenedor que cerrar ni redimensionar: se aceptan y no hacen nada.
  var host_ = {
    origin: location.origin,
    close: function () {},
    setHeight: function () {},
    setWidth: function () {},
    editor: { focus: function () {} }
  };

  var script = { __vx: true, history: history_, url: url_, host: host_ };
  Object.defineProperty(script, 'run', { enumerable: true, get: function () { return crearRunner(null, null, undefined); } });
  window.google = window.google || {};
  window.google.script = script;

  /* ── window.__APP__ ─────────────────────────────────────────────────────────────────────────── */
  /*
   * En Apps Script cada pantalla hace `window.__APP__ = <?!= APP_JSON ?>;` y el servidor escribe
   * ahí la URL base y los parámetros de vista. El build cambia esa línea por __vxAppJson(): lo que
   * calculó el Worker al servir la página (window.__VX_APP_JSON__, con el interruptor `reco`) o,
   * si no está, lo mismo calculado aquí desde la URL.
   */
  window.__vxAppJson = function () {
    var desdeServidor = window.__VX_APP_JSON__;
    var o;
    if (desdeServidor && typeof desdeServidor === 'object') {
      o = desdeServidor;
    } else {
      var p = new URLSearchParams(location.search);
      o = {};
      PARAMS_VISTA.forEach(function (n) { o[n] = p.get(n) || ''; });
    }
    // La URL base es SIEMPRE la de esta ventana: así funciona igual en ventel.logidma.com, en
    // *.workers.dev y en local, sin que el servidor tenga que adivinar por qué nombre lo llamaron.
    o.baseUrl = location.origin + '/';
    return o;
  };

  /* Para el panel de velocidad (isla React): lo que tardó cada llamada vista desde el navegador. */
  window.__vxRed = { medidas: function () { return medidasRed.slice(); } };
})();
