/**
 * =============================================================================
 * Ventel · Vende más — la medición local (medicion-local.js)
 * =============================================================================
 * ¿Sirven las recomendaciones? Hasta la 2.9 no había forma de saberlo: las ventas
 * pasan por el checkout de Liverpool sin dejar rastro por artículo en ningún
 * sistema de Ventel (documento 18, §2b). Desde la 3.0 la tarjeta cuenta, EN ESTE
 * NAVEGADOR y nada más:
 *   · mostradas: las recomendaciones que el asesor tuvo a la vista;
 *   · clics:     las que abrió;
 *   · en bolsa:  las que aparecieron en la bolsa en los 60 minutos siguientes
 *                (el mismo id de producto, agregado DESPUÉS de mostrarse).
 * Es la fase A del documento 18: un piloto local. No hay red: todo vive en
 * chrome.storage.local de este Chrome y se ve en medicion.html. Lo que se guarda
 * son ids de producto de Liverpool, tipos de complemento y horas; nada del
 * cliente ni del asesor, y nada sale del equipo. Mandar esto a un servidor sería
 * otra cosa (fase C): pide avisar a TI y a Jurídico antes.
 *
 * Tres cosas que no se ven leyendo el código:
 *   · «En bolsa» es un INDICIO, no una venta, y no prueba que la tarjeta la causó:
 *     sin un grupo de control no se sabe cuántas se habrían agregado igual.
 *   · La misma recomendación en la misma ficha no cuenta dos veces en media hora:
 *     la tarjeta se repinta cada pocos segundos y el asesor recarga la ficha.
 *   · La hora de la bolsa es la del servidor de Liverpool y la de «mostrada» es la
 *     de este equipo: se toleran 5 minutos de desfase entre los dos relojes.
 *
 * Aquí no hay DOM ni chrome.*: todo llega por `dep`, para probarlo en Node.
 *   dep.leer(claves) → Promise<obj>      dep.guardar(obj) → Promise      dep.ahora() → ms
 *
 * Hecho para Ventel · v1.0 · 04/10/2026
 */
(function (raiz) {
  'use strict';

  var CLAVE = 'vmMedicion';
  var VENTANA_BOLSA = 60 * 60000;
  var REPETIDA = 30 * 60000;
  var DESFASE = 5 * 60000;
  var TOPE_RECIENTES = 400;
  var TOPE_DIAS = 120;
  var CONTADORES = ['tarjetas', 'conCruzada', 'mostradas', 'clics', 'enBolsa', 'subidas', 'subidasClic', 'subidasEnBolsa', 'chips'];

  function vacio(ahora) {
    return { v: 1, desde: ahora, pausada: false, dias: {}, tipos: {}, recientes: [] };
  }

  /** El día en hora LOCAL (la del asesor): «2026-10-04». */
  function diaDe(ms) {
    var d = new Date(ms);
    var dos = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate());
  }

  function sano(e, ahora) {
    if (!e || typeof e !== 'object' || e.v !== 1) return vacio(ahora);
    if (!e.dias || typeof e.dias !== 'object') e.dias = {};
    if (!e.tipos || typeof e.tipos !== 'object') e.tipos = {};
    if (!Array.isArray(e.recientes)) e.recientes = [];
    return e;
  }

  function crear(dep) {
    // Una escritura detrás de otra: dos avisos seguidos (mostrar y, enseguida, un clic) leerían
    // el mismo estado y el segundo pisaría al primero.
    var cola = Promise.resolve();
    function cambiar(fn) {
      var paso = cola.then(function () {
        return dep.leer([CLAVE]).then(function (r) {
          var ahora = dep.ahora();
          var e = sano(r[CLAVE], ahora);
          var res = fn(e, ahora);
          if (res === false) return null;      // nada que guardar
          podar(e, ahora);
          var o = {}; o[CLAVE] = e;
          return dep.guardar(o).then(function () { return res; });
        });
      }).then(null, function () { return null; });
      cola = paso;
      return paso;
    }

    function podar(e, ahora) {
      e.recientes = e.recientes.filter(function (x) { return ahora - x.t < 24 * 3600000; });
      if (e.recientes.length > TOPE_RECIENTES) e.recientes = e.recientes.slice(e.recientes.length - TOPE_RECIENTES);
      var dias = Object.keys(e.dias).sort();
      while (dias.length > TOPE_DIAS) delete e.dias[dias.shift()];
    }
    function dia(e, ahora) {
      var k = diaDe(ahora);
      if (!e.dias[k]) { e.dias[k] = {}; CONTADORES.forEach(function (c) { e.dias[k][c] = 0; }); }
      return e.dias[k];
    }
    function tipo(e, clave) {
      if (!clave) return null;
      return e.tipos[clave] || (e.tipos[clave] = { m: 0, c: 0, b: 0 });
    }

    /**
     * La tarjeta de la ficha `fichaId` estuvo a la vista con estas recomendaciones:
     *   recs: [{ k: 'x' cruzada | 'c' sube capacidad | 'm' sube modelo, id, sku?, tipo?: 'clase/tipo',
     *            pos?, origen?, calidad?: bool, equipo?: bool }]
     */
    function mostrar(fichaId, recs) {
      fichaId = String(fichaId || '');
      if (!fichaId) return Promise.resolve(null);
      return cambiar(function (e, ahora) {
        if (e.pausada) return false;
        var d = dia(e, ahora), nuevas = 0, cruzadas = 0;
        var deEsta = e.recientes.filter(function (x) { return x.f === fichaId && ahora - x.t < REPETIDA; });
        var yaVista = deEsta.length > 0;
        var yaConCruzada = deEsta.some(function (x) { return x.k === 'x'; });
        (recs || []).forEach(function (r) {
          if (!r || !r.id || !/^[xcm]$/.test(r.k)) return;
          var id = String(r.id), sku = r.sku ? String(r.sku) : null;
          var repetida = deEsta.some(function (x) { return x.k === r.k && x.id === id && x.sku === sku; });
          if (repetida) return;
          e.recientes.push({ t: ahora, f: fichaId, k: r.k, id: id, sku: sku, tp: r.tipo || null, pos: typeof r.pos === 'number' ? r.pos : null,
            o: r.origen || null, q: r.calidad ? 1 : 0, e: r.equipo ? 1 : 0, clic: 0, bolsa: 0 });
          nuevas++;
          if (r.k === 'x') { cruzadas++; d.mostradas++; var t = tipo(e, r.tipo); if (t) t.m++; } else d.subidas++;
        });
        if (!yaVista) {
          // Una ficha sin nada que recomendar también es una tarjeta: se anota con un renglón vacío.
          if (!nuevas) e.recientes.push({ t: ahora, f: fichaId, k: '-', id: '', sku: null, tp: null, pos: null, o: null, q: 0, e: 0, clic: 0, bolsa: 0 });
          d.tarjetas++;
        }
        // La venta cruzada puede llegar después (la trae la búsqueda): la ficha cuenta una vez.
        if (cruzadas && !yaConCruzada) d.conCruzada++;
        return (nuevas || !yaVista) ? { nuevas: nuevas } : false;
      });
    }

    /** El asesor abrió una recomendación (k, id) de la ficha, o una búsqueda sugerida (k = 'q'). */
    function clic(fichaId, k, id, sku) {
      fichaId = String(fichaId || '');
      return cambiar(function (e, ahora) {
        if (e.pausada) return false;
        var d = dia(e, ahora);
        if (k === 'q') { d.chips++; return { chip: true }; }
        id = String(id || ''); sku = sku ? String(sku) : null;
        var x = null;
        for (var i = e.recientes.length - 1; i >= 0 && !x; i--) {
          var c = e.recientes[i];
          if (c.f === fichaId && c.k === k && c.id === id && c.sku === sku) x = c;
        }
        if (!x || x.clic) return false;        // sin haberse mostrado, o ya contada
        x.clic = ahora;
        if (k === 'x') { d.clics++; var t = tipo(e, x.tp); if (t) t.c++; } else d.subidasClic++;
        return { clic: true };
      });
    }

    /**
     * La bolsa, tal como se acaba de leer: lo que se mostró y aparece en ella, agregado
     * después de mostrarse y dentro de la hora, cuenta como «en bolsa» (una sola vez).
     */
    function bolsa(items) {
      if (!Array.isArray(items) || !items.length) return Promise.resolve(null);
      return cambiar(function (e, ahora) {
        if (e.pausada) return false;
        var d = dia(e, ahora), hallados = 0;
        e.recientes.forEach(function (x) {
          if (x.bolsa || x.k === '-') return;
          var esta = items.some(function (b) {
            if (!b || typeof b.agregado !== 'number') return false;
            if (b.agregado < x.t - DESFASE || b.agregado - x.t > VENTANA_BOLSA) return false;
            // La subida de capacidad es el MISMO producto en otra variante: se reconoce por el SKU.
            return x.k === 'c' ? (!!x.sku && String(b.sku) === x.sku) : String(b.id) === x.id;
          });
          if (!esta) return;
          x.bolsa = ahora;
          hallados++;
          if (x.k === 'x') { d.enBolsa++; var t = tipo(e, x.tp); if (t) t.b++; } else d.subidasEnBolsa++;
        });
        return hallados ? { enBolsa: hallados } : false;
      });
    }

    function pausar(si) {
      return cambiar(function (e) { e.pausada = !!si; return { pausada: e.pausada }; });
    }
    function borrar() {
      var o = {}; o[CLAVE] = vacio(dep.ahora());
      cola = cola.then(function () { return dep.guardar(o); }).then(null, function () { return null; });
      return cola;
    }
    function estado() {
      return cola.then(function () { return dep.leer([CLAVE]); }).then(function (r) { return sano(r[CLAVE], dep.ahora()); });
    }

    return { mostrar: mostrar, clic: clic, bolsa: bolsa, pausar: pausar, borrar: borrar, estado: estado };
  }

  /** Los totales y las tasas de un estado guardado, para pintarlos o copiarlos. */
  function resumen(e) {
    e = sano(e, 0);
    var tot = {};
    CONTADORES.forEach(function (c) { tot[c] = 0; });
    var dias = Object.keys(e.dias).sort().map(function (k) {
      var d = e.dias[k], fila = { dia: k };
      CONTADORES.forEach(function (c) { fila[c] = d[c] || 0; tot[c] += d[c] || 0; });
      return fila;
    });
    var tasa = function (n, de) { return de ? Math.round(n / de * 1000) / 10 : null; };
    var tipos = Object.keys(e.tipos).map(function (k) {
      var t = e.tipos[k];
      return { tipo: k, mostradas: t.m || 0, clics: t.c || 0, enBolsa: t.b || 0, tasaClic: tasa(t.c || 0, t.m || 0), tasaBolsa: tasa(t.b || 0, t.m || 0) };
    }).sort(function (a, b) { return b.mostradas - a.mostradas || (a.tipo < b.tipo ? -1 : 1); });
    return {
      desde: e.desde || null, pausada: !!e.pausada, total: tot,
      tasaClic: tasa(tot.clics, tot.mostradas), tasaBolsa: tasa(tot.enBolsa, tot.mostradas),
      tasaSubidaClic: tasa(tot.subidasClic, tot.subidas), tasaSubidaBolsa: tasa(tot.subidasEnBolsa, tot.subidas),
      dias: dias, tipos: tipos
    };
  }

  /** El resumen como texto separado por tabuladores: se pega tal cual en una hoja de cálculo. */
  function comoTexto(e) {
    var r = resumen(e), lineas = [];
    lineas.push(['Día', 'Tarjetas', 'Con venta cruzada', 'Recomendaciones mostradas', 'Clics', 'En bolsa (60 min)', 'Subidas mostradas', 'Subidas con clic', 'Subidas en bolsa', 'Búsquedas sugeridas abiertas'].join('\t'));
    r.dias.forEach(function (d) { lineas.push([d.dia].concat(CONTADORES.map(function (c) { return d[c]; })).join('\t')); });
    lineas.push(['Total'].concat(CONTADORES.map(function (c) { return r.total[c]; })).join('\t'));
    lineas.push('');
    lineas.push(['Tipo de complemento', 'Mostradas', 'Clics', 'En bolsa'].join('\t'));
    r.tipos.forEach(function (t) { lineas.push([t.tipo, t.mostradas, t.clics, t.enBolsa].join('\t')); });
    return lineas.join('\n');
  }

  raiz.VentelMedicion = {
    crear: crear, resumen: resumen, comoTexto: comoTexto, diaDe: diaDe,
    CLAVE: CLAVE, VENTANA_BOLSA: VENTANA_BOLSA, REPETIDA: REPETIDA, DESFASE: DESFASE, CONTADORES: CONTADORES
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
