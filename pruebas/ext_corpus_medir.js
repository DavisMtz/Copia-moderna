/*
 * «Vende más» · junta el CORPUS: fichas reales de liverpool.com.mx con lo que el propio sitio
 * recomienda en ellas («Complementa con», «Otros clientes compraron», «Artículos relacionados»).
 * Con él se midieron las reglas v3 (documento 17). NO es una prueba de Node: corre en el navegador.
 *
 * Cómo se usa (en una pestaña de liverpool.com.mx con la sesión normal del asesor):
 *   1. Inyectar, en este orden y en el mundo de la página: product-inspector.js, reglas-venta.js
 *      (más «window.VENTEL_REGLAS = VENTEL_REGLAS;»), recomendador-nucleo.js y este archivo.
 *      Lo más simple: concatenarlos en un solo archivo y evaluarlo con (0, eval)(texto) desde un
 *      <input type=file> (así se hizo el 04/10/2026).
 *   2. await __corpusVM(['cafetera de capsulas', 'licuadora', …], { pausa: 3000 })
 *      Por cada búsqueda toma la PRIMERA ficha y la guarda recortada en sessionStorage['vmCorpus']
 *      (por pestaña: sobrevive a recargar, muere al cerrarla).
 *   3. __resumenVM() dice qué decide hoy la tarjeta en cada ficha (sin búsquedas).
 *
 * Con freno: si Liverpool contesta algo que no es 200 o «Access Denied», se detiene todo. Con la
 * pausa de 3 s, 81 fichas en 8 tandas no dieron ni un bloqueo (04/10/2026).
 */
(function () {
  var CLAVE = 'vmCorpus';
  function leerCorpus() { try { return JSON.parse(sessionStorage.getItem(CLAVE) || '{}'); } catch (e) { return {}; } }
  function guardarCorpus(c) { try { sessionStorage.setItem(CLAVE, JSON.stringify(c)); return true; } catch (e) { return false; } }
  var espera = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var insp = new Function('document', 'location', 'return (' + inspectProductFromDOM.toString() + ')()');

  async function bajar(url) {
    var r = await fetch(url, { credentials: 'include' });
    var t = await r.text();
    var bloqueado = r.status !== 200 || /access denied/i.test(t.slice(0, 3000));
    return { status: r.status, bloqueado: bloqueado, kb: Math.round(t.length / 1024), doc: bloqueado ? null : new DOMParser().parseFromString(t, 'text/html') };
  }
  function tarjetas(raiz, selector) {
    var out = [], vistos = {};
    raiz.querySelectorAll(selector).forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var id = href.split('?')[0].split('/').pop();
      if (!/^\d{6,}$/.test(id) || vistos[id]) return;
      vistos[id] = 1;
      var h4 = a.querySelector('h4'), h3 = a.querySelector('h3');
      var texto = (a.textContent || '').replace(/\s+/g, ' ');
      var plano = texto.replace(/\s+/g, '');
      var pr = plano.match(/\$[\d,]+(?:\.\d{1,2})?/g) || [];
      out.push({ id: id, marca: h4 ? h4.textContent.trim() : '', nombre: h3 ? h3.textContent.trim() : '',
        precio: pr[0] ? window.VentelVM.num(pr[0]) : null, rango: /\$[\d,.]+-\$/.test(plano) || undefined,
        desc: (plano.match(/-(\d{1,2})%/) || [])[1] || undefined, href: href.split('?')[0],
        marcaEstado: /agotad|sin existencia|no disponible|pr[oó]ximamente/i.test(texto) ? texto.match(/agotad\w*|sin existencias?|no disponible|pr[oó]ximamente/i)[0] : undefined });
    });
    return out;
  }
  // El carrusel cuyo título casa con `re`: sus tarjetas comparten el prefijo de data-testid.
  function carrusel(d, re) {
    var titulos = d.querySelectorAll('h2, h3, p'), titulo = null;
    for (var i = 0; i < titulos.length; i++) if (re.test((titulos[i].textContent || '').trim())) { titulo = titulos[i]; break; }
    if (!titulo) return [];
    var primera = null, cont = titulo;
    for (var k = 0; k < 8 && cont && !primera; k++) {
      cont = cont.parentElement; if (!cont) break;
      var enl = cont.querySelectorAll('a[data-testid$="-card-link"]');
      for (var j = 0; j < enl.length; j++) if (titulo.compareDocumentPosition(enl[j]) & Node.DOCUMENT_POSITION_FOLLOWING) { primera = enl[j]; break; }
    }
    if (!primera) return [];
    var tid = primera.getAttribute('data-testid') || '', corte = tid.indexOf('-product-');
    if (corte < 1) return [];
    return tarjetas(d, 'a[data-testid^="' + tid.slice(0, corte) + '-product-"]');
  }
  function especificacion(P, etiquetas) {
    var s = P.specifications || [];
    for (var i = 0; i < s.length; i++) if (etiquetas.indexOf(window.VentelVM.norm(s[i].label)) > -1 && s[i].value) return String(s[i].value).trim();
    return null;
  }
  function recortarVariante(v) {
    if (!v) return v;
    var o = {};
    ['skuId', 'sku', 'id', 'size', 'color', 'price', 'listPrice', 'image', 'imagen', 'available', 'disponible', 'stock'].forEach(function (k) { if (v[k] !== undefined) o[k] = v[k]; });
    if (v.paymentPlans) o.paymentPlans = (v.paymentPlans || []).filter(function (p) { return p && p.noInterest; }).slice(0, 6);
    return o;
  }
  function ficha(d, url) {
    var r = insp(d, new URL(url)); var P = r.product;
    var id = (url.match(/\/(\d{6,})(?:[/?#]|$)/) || [])[1];
    return { id: id, nombre: P.name, marca: P.brand, migas: (P.category && P.category.breadcrumbs) || [],
      producto: especificacion(P, ['producto', 'tipo de producto']), modeloComercial: especificacion(P, ['modelo comercial']),
      precio: P.prices.current, esRango: !!P.prices.esRango, variantes: (P.variants || []).slice(0, 40).map(recortarVariante),
      varianteActual: P.varianteActual, skuUrl: P.skuVariante || null, seleccion: P.seleccion, colores: (P.colors || []).slice(0, 12),
      care: !!(P.politicas && P.politicas.liverpoolCare) };
  }

  /** Junta fichas en el corpus. No repite las que ya tiene. Se detiene ante cualquier bloqueo. */
  window.__corpusVM = async function (consultas, opciones) {
    opciones = opciones || {};
    var pausa = opciones.pausa || 3000;
    var corpus = leerCorpus(), salida = [];
    window.__corpusEstado = { total: consultas.length, hechas: 0, actual: null, alto: null };
    for (var q = 0; q < consultas.length; q++) {
      var c = consultas[q];
      window.__corpusEstado.actual = c;
      if (corpus[c] && !opciones.forzar) { salida.push({ q: c, deCache: true }); window.__corpusEstado.hechas++; continue; }
      try {
        var b = await bajar('/tienda?s=' + encodeURIComponent(c));
        if (b.bloqueado) { window.__corpusEstado.alto = 'búsqueda ' + b.status; salida.push({ q: c, error: window.__corpusEstado.alto }); break; }
        await espera(pausa);
        var lista = tarjetas(b.doc, 'a[href*="/pdp/"]').filter(function (x) { return x.nombre; });
        if (!lista.length) { salida.push({ q: c, error: 'sin resultados' }); window.__corpusEstado.hechas++; continue; }
        var url = new URL(lista[0].href, location.origin).href;
        var p = await bajar(url);
        if (p.bloqueado) { window.__corpusEstado.alto = 'ficha ' + p.status; salida.push({ q: c, error: window.__corpusEstado.alto }); break; }
        await espera(pausa);
        var f = ficha(p.doc, url);
        var car = { complementa: carrusel(p.doc, /^complementa con/i), otros: carrusel(p.doc, /^otros clientes compraron/i), relacionados: carrusel(p.doc, /^art[ií]culos relacionados$/i) };
        corpus[c] = { url: url.split('?')[0], kb: p.kb, ficha: f, car: car, busqueda: lista.slice(0, 10).map(function (x) { return { id: x.id, marca: x.marca, nombre: x.nombre, precio: x.precio }; }) };
        if (!guardarCorpus(corpus)) { window.__corpusEstado.alto = 'sessionStorage lleno'; salida.push({ q: c, error: 'sin espacio' }); break; }
        salida.push({ q: c, ok: true, carr: car.complementa.length + '/' + car.otros.length + '/' + car.relacionados.length });
      } catch (e) {
        salida.push({ q: c, error: String(e && e.message || e).slice(0, 120) });
      }
      window.__corpusEstado.hechas++;
    }
    window.__corpusEstado.actual = null;
    return salida;
  };

  /** Las dos primeras palabras del nombre, sin acentos: así nombra Liverpool el TIPO de artículo. */
  function cabeza(nombre) {
    var w = window.VentelVM.norm(nombre).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
    if (!w.length) return '';
    if (w.length > 2 && /^(de|para|con)$/.test(w[1])) return w.slice(0, 3).join(' ');
    return w.slice(0, 2).join(' ');
  }

  /** Lo que hoy decide la tarjeta (sin búsquedas) y de qué tipo son los complementos que Liverpool trae. */
  window.__resumenVM = function (consultas, ahora) {
    var corpus = leerCorpus();
    return (consultas || Object.keys(corpus)).filter(function (c) { return corpus[c]; }).map(function (c) {
      var e = corpus[c], f = e.ficha, car = e.car;
      var m = window.VentelVM.recomendar(f, car, null, window.VENTEL_REGLAS, ahora || Date.now());
      var cuenta = {};
      (car.complementa || []).concat(car.otros || []).forEach(function (it) {
        var k = cabeza(it.nombre); if (!k) return;
        (cuenta[k] = cuenta[k] || { n: 0, ej: it.nombre.slice(0, 48), precio: it.precio }).n++;
      });
      var top = Object.keys(cuenta).sort(function (a, b) { return cuenta[b].n - cuenta[a].n; }).slice(0, 10)
        .map(function (k) { return k + ' ×' + cuenta[k].n; });
      var agotados = (car.complementa || []).concat(car.otros || []).filter(function (x) { return x.marcaEstado; }).length;
      return {
        q: c, ficha: (f.nombre || '').slice(0, 52), precio: f.precio, migas: (f.migas || []).slice(-2).join(' > '), prod: f.producto,
        clase: m.clase ? m.clase.id : null, carr: (car.complementa || []).length + '/' + (car.otros || []).length + '/' + (car.relacionados || []).length,
        cruz: m.cruzada.map(function (r) { return r.tipo + ': ' + r.nombre.slice(0, 40) + ' $' + r.precio; }),
        plan: (m.busquedas || []).map(function (b) { return b.consulta; }),
        sube: m.incremental.modelo ? m.incremental.modelo.nombre.slice(0, 36) + ' +' + m.incremental.modelo.dif : null,
        tiposLiverpool: top, agotados: agotados || undefined
      };
    });
  };
})();
