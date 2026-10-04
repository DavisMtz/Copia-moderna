// Recolector v2 (investigación del 04/10/2026, puntos 1, 2 y 5). Va DESPUÉS de product-inspector.js,
// reglas-venta.js (+ window.VENTEL_REGLAS) y recomendador-nucleo.js. Lee lo ESTRUCTURADO del stream:
//  · en la ficha, los carruseles de Jewel ("products":[…]) con categoría, calificación, vendedor y descuento;
//  · en la búsqueda, "records":[…] con calificación, patrocinado, marketplace, categorías y existencia en línea.
// Guarda en memoria (window.__inv2) y en IndexedDB ('inv2'). Freno ante cualquier no-200 o «Access Denied».
(function () {
  var espera = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var insp = new Function('document', 'location', 'return (' + inspectProductFromDOM.toString() + ')()');

  // ---- IndexedDB mínimo -------------------------------------------------------------
  function idb() { return new Promise(function (ok, mal) { var r = indexedDB.open('inv2', 1); r.onupgradeneeded = function () { r.result.createObjectStore('kv'); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { mal(r.error); }; }); }
  window.__idbSet = async function (k, v) { var db = await idb(); return new Promise(function (ok) { var t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = function () { ok(true); }; t.onerror = function () { ok(false); }; }); };
  window.__idbGet = async function (k) { var db = await idb(); return new Promise(function (ok) { var q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { ok(q.result); }; q.onerror = function () { ok(null); }; }); };

  // ---- Utilidades del stream --------------------------------------------------------
  function arregloDesde(s, ini) { var prof = 0, enCad = false, esc = false;
    for (var i = ini; i < s.length; i++) { var c = s[i];
      if (enCad) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') enCad = false; continue; }
      if (c === '"') enCad = true; else if (c === '[' || c === '{') prof++; else if (c === ']' || c === '}') { prof--; if (prof === 0) return s.slice(ini, i + 1); } }
    return null; }
  function planoDe(html) { return html.replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
  function num(x) { var n = Number(x); return isFinite(n) ? n : null; }

  function recortarProd(p) {
    var pi = p.priceInfo || {};
    return { id: String(p.productId), nombre: p.name || '', marca: p.brand || '', precio: num(pi.price != null ? pi.price : pi.promoPrice), lista: num(pi.originalPrice),
      desc: p.discountLabel || null, cats: (p.categories || []).map(function (c) { return c.label; }), mainCat: p.mainCategory || null,
      vendedor: p.seller || null, mkp: !!p.marketplace, cal: p.rating ? num(p.rating.average) : null, nOp: p.rating ? num(p.rating.count) : null };
  }
  function carruselesStream(plano) {
    var out = {}, re = /"title":"([^"]{0,160})","variant":"[^"]*","products":\[/g, m;
    while ((m = re.exec(plano))) {
      var cuerpo = arregloDesde(plano, m.index + m[0].length - 1), prods;
      try { prods = JSON.parse(cuerpo); } catch (e) { continue; }
      var t = m[1], k = /complementa/i.test(t) ? 'complementa' : /otros clientes/i.test(t) ? 'otros' : /relacionados/i.test(t) ? 'relacionados'
        : /m[aá]s vendidos/i.test(t) ? 'masVendidos' : /vistos/i.test(t) ? 'vistos' : t;
      out[k] = prods.map(recortarProd);
    }
    return out;
  }
  function registros(plano) {
    var p = plano.indexOf('"records":['); if (p < 0) return [];
    var recs; try { recs = JSON.parse(arregloDesde(plano, p + 10)); } catch (e) { return []; }
    return recs.map(function (r) {
      var pi = r.priceInfo || {}, ff = r.featureFlags || {};
      return { id: String(r.productId), nombre: r.title || '', marca: r.brand || '',
        precio: num(pi.salePrice != null ? pi.salePrice : (pi.promoPrice && pi.promoPrice.price)), lista: num(pi.listPrice && pi.listPrice.price),
        cal: r.ratingInfo ? num(r.ratingInfo.productAvgRating) : null, nOp: r.ratingInfo ? num(r.ratingInfo.productRatingCount) : null,
        patroc: !!ff.isSponsoredRecord, mkp: !!ff.isMarketPlace, vendedor: (r.seller || []).join('/'),
        cats: r.categories || [], carrCats: (r.carrouselCategories || []).map(function (c) { return c.label; }), mainCat: r.mainCategory || null,
        online: Array.isArray(r.geoStoreIds) ? r.geoStoreIds.indexOf('online') > -1 : null, tipoProd: r.productType || null };
    });
  }
  // Lo que lee HOY la extensión de una búsqueda: las primeras 16 tarjetas del DOM (buscador-liverpool.js).
  function ordenDom(doc) {
    var out = [], vistos = {};
    doc.querySelectorAll('a[href*="/pdp/"]').forEach(function (a) {
      var id = (a.getAttribute('href') || '').split('?')[0].split('/').pop();
      if (!/^\d{6,}$/.test(id) || vistos[id] || !a.querySelector('h3')) return;
      vistos[id] = 1; out.push(id);
    });
    return out.slice(0, 16);
  }
  // Lo que lee HOY la extensión de los carruseles: el DOM, por el prefijo de sus tarjetas.
  function carruselDom(d, re) {
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
    var ids = [], vistos = {};
    d.querySelectorAll('a[data-testid^="' + tid.slice(0, corte) + '-product-"]').forEach(function (a) {
      var id = (a.getAttribute('href') || '').split('?')[0].split('/').pop(); if (/^\d{6,}$/.test(id) && !vistos[id]) { vistos[id] = 1; ids.push(id); } });
    return ids;
  }
  function especificacion(P, etiquetas) {
    var s = P.specifications || [];
    for (var i = 0; i < s.length; i++) if (etiquetas.indexOf(window.VentelVM.norm(s[i].label)) > -1 && s[i].value) return String(s[i].value).trim();
    return null;
  }
  function ficha(d, url) {
    var r = insp(d, new URL(url)); var P = r.product;
    var id = (url.match(/\/(\d{6,})(?:[/?#]|$)/) || [])[1];
    return { id: id, nombre: P.name, marca: P.brand, migas: (P.category && P.category.breadcrumbs) || [],
      producto: especificacion(P, ['producto', 'tipo de producto']), modeloComercial: especificacion(P, ['modelo comercial']),
      precio: P.prices.current, esRango: !!P.prices.esRango,
      variantes: (P.variants || []).slice(0, 40).map(function (v) { return { sku: v.sku, size: v.size, color: v.color, price: v.price, inStock: v.inStock }; }),
      varianteActual: P.varianteActual, skuUrl: P.skuVariante || null, seleccion: P.seleccion, colores: [],
      care: !!(P.politicas && P.politicas.liverpoolCare), cal: P.rating ? P.rating.average : null, nOp: P.rating ? P.rating.count : null };
  }
  async function bajar(url) {
    var t0 = performance.now(), r = await fetch(url, { credentials: 'include' }), t = await r.text();
    var bloqueado = r.status !== 200 || /access denied/i.test(t.slice(0, 3000));
    return { status: r.status, bloqueado: bloqueado, kb: Math.round(t.length / 1024), ms: Math.round(performance.now() - t0), html: bloqueado ? null : t };
  }

  window.__inv2 = window.__inv2 || { fichas: {}, busquedas: {} };
  window.__inv2Estado = { fase: 'quieto' };

  /** Búsqueda → primera ficha → ficha + carruseles (stream y DOM). No repite lo que ya tiene. */
  window.__colectarV2 = async function (consultas, opciones) {
    opciones = opciones || {}; var pausa = opciones.pausa || 3000;
    window.__inv2Estado = { fase: 'fichas', total: consultas.length, hechas: 0, actual: null, alto: null, red: 0 };
    for (var q = 0; q < consultas.length; q++) {
      var c = consultas[q]; window.__inv2Estado.actual = c;
      if (window.__inv2.fichas[c]) { window.__inv2Estado.hechas++; continue; }
      try {
        var b = await bajar('/tienda?s=' + encodeURIComponent(c)); window.__inv2Estado.red++;
        if (b.bloqueado) { window.__inv2Estado.alto = 'búsqueda ' + b.status; break; }
        var planoB = planoDe(b.html), docB = new DOMParser().parseFromString(b.html, 'text/html');
        var recs = registros(planoB), dom = ordenDom(docB);
        window.__inv2.busquedas[c] = { recs: recs, dom: dom, ms: b.ms, kb: b.kb };
        await espera(pausa);
        var primero = dom[0] || (recs[0] && recs[0].id);
        if (!primero) { window.__inv2.fichas[c] = { error: 'sin resultados' }; window.__inv2Estado.hechas++; continue; }
        var a = docB.querySelector('a[href*="/pdp/"][href*="' + primero + '"]');
        var url = new URL(a ? a.getAttribute('href') : ('/tienda/pdp/x/' + primero), location.origin).href;
        var p = await bajar(url); window.__inv2Estado.red++;
        if (p.bloqueado) { window.__inv2Estado.alto = 'ficha ' + p.status; break; }
        var doc = new DOMParser().parseFromString(p.html, 'text/html'), plano = planoDe(p.html);
        window.__inv2.fichas[c] = { url: url.split('?')[0], kb: p.kb, ms: p.ms, ficha: ficha(doc, url), stream: carruselesStream(plano),
          dom: { complementa: carruselDom(doc, /^complementa con/i), otros: carruselDom(doc, /^otros clientes compraron/i), relacionados: carruselDom(doc, /^art[ií]culos relacionados$/i) } };
        await espera(pausa);
      } catch (e) { window.__inv2.fichas[c] = { error: String(e && e.message || e).slice(0, 160) }; }
      window.__inv2Estado.hechas++;
      if (q % 5 === 4) await window.__idbSet('inv2', window.__inv2);
    }
    await window.__idbSet('inv2', window.__inv2);
    window.__inv2Estado.fase = window.__inv2Estado.alto ? 'frenado' : 'listo'; window.__inv2Estado.actual = null;
    return window.__inv2Estado;
  };

  /** Solo búsquedas (plantillas): registros + orden del DOM. */
  window.__buscarV2 = async function (consultas, opciones) {
    opciones = opciones || {}; var pausa = opciones.pausa || 3000;
    window.__inv2Estado = { fase: 'busquedas', total: consultas.length, hechas: 0, actual: null, alto: null, red: 0 };
    for (var q = 0; q < consultas.length; q++) {
      var c = consultas[q]; window.__inv2Estado.actual = c;
      if (window.__inv2.busquedas[c]) { window.__inv2Estado.hechas++; continue; }
      var b = await bajar('/tienda?s=' + encodeURIComponent(c) + (opciones.extra || '')); window.__inv2Estado.red++;
      if (b.bloqueado) { window.__inv2Estado.alto = 'búsqueda ' + b.status; break; }
      window.__inv2.busquedas[c] = { recs: registros(planoDe(b.html)), dom: ordenDom(new DOMParser().parseFromString(b.html, 'text/html')), ms: b.ms, kb: b.kb };
      window.__inv2Estado.hechas++;
      if (q % 8 === 7) await window.__idbSet('inv2', window.__inv2);
      await espera(pausa);
    }
    await window.__idbSet('inv2', window.__inv2);
    window.__inv2Estado.fase = window.__inv2Estado.alto ? 'frenado' : 'listo'; window.__inv2Estado.actual = null;
    return window.__inv2Estado;
  };
})();
