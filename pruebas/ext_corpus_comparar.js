/*
 * «Vende más» · lo que la tarjeta recomienda en cada ficha del corpus (sessionStorage['vmCorpus'],
 * ver ext_corpus_medir.js), CON las búsquedas que pida su plan, igual que en la ficha real.
 * Con esto se midieron la 2.8 y la 2.9 sobre las mismas 81 fichas (documento 17, §7). NO es una
 * prueba de Node: corre en el navegador.
 *
 * Cómo se usa (pestaña de liverpool.com.mx con el corpus ya juntado):
 *   1. Inyectar reglas-venta.js (más «window.VENTEL_REGLAS = VENTEL_REGLAS;»),
 *      recomendador-nucleo.js y este archivo. Para medir OTRA versión, se inyectan sus reglas y su
 *      núcleo encima: lo buscado queda en caché y la comparación no vuelve a pedir nada.
 *   2. await __despuesVM(Object.keys(JSON.parse(sessionStorage.vmCorpus)), { pausa: 3000 })
 *      Cada resultado: clase, recomendaciones («B·» = vino de la búsqueda; «otro:» = tipo que la
 *      regla no conoce), las plantillas con cuántos de los 10 primeros resultados son del tipo
 *      buscado, los botones de búsqueda y la subida.
 *      { sinRed: true } usa solo la caché (sessionStorage['vmBusq']).
 *   3. __accVM() lista las fichas que el núcleo trata como ACCESORIO de su clase (desde la 1.4).
 *
 * Con freno, como el otro: cualquier respuesta que no sea 200, o «Access Denied», detiene todo.
 */
(function () {
  var espera = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function leer(k) { try { return JSON.parse(sessionStorage.getItem(k) || '{}'); } catch (e) { return {}; } }
  function tarjetas(doc) {
    var out = [], vistos = {};
    doc.querySelectorAll('a[href*="/pdp/"]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var id = href.split('?')[0].split('/').pop();
      if (!/^\d{6,}$/.test(id) || vistos[id]) return;
      vistos[id] = 1;
      var h4 = a.querySelector('h4'), h3 = a.querySelector('h3');
      if (!h3) return;
      var plano = (a.textContent || '').replace(/\s+/g, '');
      var pr = plano.match(/\$[\d,]+(?:\.\d{1,2})?/g) || [];
      out.push({ id: id, marca: h4 ? h4.textContent.trim() : '', nombre: h3.textContent.trim(), precio: pr[0] ? window.VentelVM.num(pr[0]) : null, href: href.split('?')[0] });
    });
    return out.slice(0, 16);
  }
  function corto(r) { return (r.origen === 'busqueda' ? 'B·' : '') + r.tipo + ': ' + r.nombre.slice(0, 34) + ' $' + r.precio; }

  window.__despuesVM = async function (consultas, opciones) {
    opciones = opciones || {};
    var pausa = opciones.pausa || 3000;
    var corpus = leer('vmCorpus'), cache = leer('vmBusq'), salida = [];
    window.__despuesEstado = { total: consultas.length, hechas: 0, actual: null, alto: null, red: 0 };
    for (var q = 0; q < consultas.length; q++) {
      var c = consultas[q], e = corpus[c];
      window.__despuesEstado.actual = c;
      if (!e) { salida.push({ q: c, error: 'no está en el corpus' }); continue; }
      var m0 = window.VentelVM.recomendar(e.ficha, e.car, null, window.VENTEL_REGLAS, Date.now());
      var busquedas = {}, prueba = [];
      for (var i = 0; i < (m0.busquedas || []).length; i++) {
        var b = m0.busquedas[i];
        if (!cache[b.consulta] && !opciones.sinRed) {
          var r = await fetch('/tienda?s=' + encodeURIComponent(b.consulta), { credentials: 'include' });
          var t = await r.text();
          window.__despuesEstado.red++;
          if (r.status !== 200 || /access denied/i.test(t.slice(0, 3000))) { window.__despuesEstado.alto = r.status; break; }
          cache[b.consulta] = tarjetas(new DOMParser().parseFromString(t, 'text/html'));
          try { sessionStorage.setItem('vmBusq', JSON.stringify(cache)); } catch (x) { /* lleno */ }
          await espera(pausa);
        }
        if (cache[b.consulta]) {
          busquedas[b.consulta] = cache[b.consulta];
          // ¿La plantilla trae lo que dice? De los primeros 10, cuántos son del tipo buscado.
          var ctx = window.VentelVM.contexto(e.ficha, window.VENTEL_REGLAS);
          var del = cache[b.consulta].slice(0, 10).filter(function (it) { return window.VentelVM.tipoDe(it, ctx.clase).tipo === b.tipo; }).length;
          prueba.push(b.consulta + ' ' + del + '/' + Math.min(10, cache[b.consulta].length));
        }
      }
      if (window.__despuesEstado.alto) { salida.push({ q: c, error: 'freno ' + window.__despuesEstado.alto }); break; }
      var m = window.VentelVM.recomendar(e.ficha, e.car, null, window.VENTEL_REGLAS, Date.now(), busquedas);
      salida.push({ q: c, clase: m.clase ? m.clase.id : null, cruz: m.cruzada.map(corto), plantillas: prueba,
        sug: m.sugeridas.map(function (s) { return s.consulta; }),
        sube: m.incremental.modelo ? m.incremental.modelo.nombre.slice(0, 30) + ' +' + m.incremental.modelo.dif : (m.incremental.capacidad ? m.incremental.capacidad.talla + ' +' + m.incremental.capacidad.dif : null) });
      window.__despuesEstado.hechas++;
    }
    window.__despuesEstado.actual = null;
    window.__despuesRes = (window.__despuesRes || []).concat(salida);
    return salida;
  };

  // Qué fichas del corpus quedan marcadas como ACCESORIO de su clase (sin Liverpool Care).
  window.__accVM = function () {
    var corpus = leer('vmCorpus');
    return Object.keys(corpus).map(function (q) {
      var f = corpus[q].ficha, c = window.VentelVM.contexto(f, window.VENTEL_REGLAS);
      return c.accesorio ? (c.clase.id + ' <- ' + f.nombre) : null;
    }).filter(Boolean);
  };
})();
