/**
 * =============================================================================
 * Ventel · Vende más — la tarjeta en la ficha (recomendador.js)
 * =============================================================================
 * Content script de liverpool.com.mx/tienda/*. Cuando la pestaña es una ficha de
 * producto, pone debajo de «Agregar a mi bolsa» la tarjeta «Vende más con este
 * artículo»: el siguiente escalón (venta incremental), hasta tres complementos
 * que sí le quedan (venta cruzada) y las promociones del Monitor para decírselas
 * al cliente: la de su categoría y la más fuerte. Las decisiones viven en
 * recomendador-nucleo.js; aquí solo se lee la ficha, se pinta y se anima (GSAP,
 * desde la 2.8).
 *
 * De dónde sale cada cosa:
 *   · el artículo, sus variantes y sus meses: inspectProductFromDOM()
 *     (product-inspector.js, el mismo del inspector del popup, sin tocarlo);
 *   · los candidatos: los carruseles que Liverpool ya pinta en la ficha
 *     («Complementa con», «Otros clientes compraron», «Artículos relacionados»).
 *     Llegan en la página desde el servidor, sin bajar por ella (03/10/2026);
 *   · desde la 2.7, la búsqueda del sitio (buscador-liverpool.js) para los tipos
 *     que los carruseles no trajeron bien: como mucho dos por ficha, DESPUÉS de
 *     pintar, con caché de 24 h, ritmo acotado y freno si el sitio se queja;
 *   · las promociones: chrome.storage.local['ventelPromos'], que deja ahí la
 *     extensión cuando el asesor abre el Portal (campana-puente.js → fondo.js).
 *
 * Tres cosas que se ven en la práctica y no en el código:
 *   · Cada carrusel se lee por el PREFIJO de sus tarjetas (blt…-product-<id>-
 *     card-link), no por su caja: subir por el DOM desde el título acaba, en
 *     cuanto un carrusel trae una sola tarjeta, metiendo las del de al lado.
 *   · Si Liverpool navega sin recargar, el stream de la página es el de la ficha
 *     anterior. Por eso las variantes solo se usan si el id del stream es el de
 *     la URL; si no, la tarjeta se arma con lo que se ve.
 *   · Nada aquí agrega a la bolsa: la sesión del asesor puede estar ligada a un
 *     cliente por el Panel del agente. Todo abre la ficha y el asesor decide.
 *
 * Hecho para Ventel · v1.1 · 03/10/2026
 */
(function () {
  'use strict';
  if (window.top !== window.self || window.__ventelVendeMas) return;
  window.__ventelVendeMas = true;

  var VM = window.VentelVM;
  var REGLAS = window.VENTEL_REGLAS;
  if (!VM || !REGLAS || typeof inspectProductFromDOM !== 'function') return;

  var HOST_ID = 'ventel-vende-mas';
  var CLAVE_PROMOS = 'ventelPromos';
  var CLAVE_PLEGADO = 'vmPlegado';
  var ORIGEN = 'https://www.liverpool.com.mx';

  var estado = {
    url: '',          // la ficha que se leyó (cambia = hay que volver a leer)
    sucio: true,      // el asesor tocó el configurador: la variante pudo cambiar
    ficha: null,
    promos: null,
    plegado: false,
    firma: '',
    resultados: {},   // consulta → resultados de la búsqueda, para ESTA ficha
    intentadas: {},   // consulta → ya se pidió (a la caché o a la red) en esta ficha
    producto: '',     // de qué producto son resultados e intentadas (su id, no su URL)
    buscando: false
  };

  // ── chrome.storage, con red: al recargar la extensión, una pestaña ya abierta
  //    pierde el contexto y cualquier llamada lanza. La tarjeta sigue sin él.
  function leer(claves, cb) {
    try {
      chrome.storage.local.get(claves, function (r) {
        cb((chrome.runtime && chrome.runtime.lastError) ? {} : (r || {}));
      });
    } catch (e) { cb({}); }
  }
  function guardar(obj) { try { chrome.storage.local.set(obj); } catch (e) { /* sin contexto */ } }
  function leerP(claves) { return new Promise(function (r) { leer(claves, r); }); }
  function guardarP(obj) {
    return new Promise(function (r) {
      try { chrome.storage.local.set(obj, function () { r(); }); } catch (e) { r(); }
    });
  }

  function esFicha() { return /^\/tienda\/pdp\/[^/]+\/\d{6,}/.test(location.pathname); }
  function idDeRuta() { var m = location.pathname.match(/\/(\d{6,})\/?$/); return m ? m[1] : null; }
  function textoDe(sel) { var n = document.querySelector(sel); return n ? (n.textContent || '').trim() : ''; }

  // ===========================================================================
  // Lectura de la ficha
  // ===========================================================================

  function especificacion(P, etiquetas) {
    var specs = P.specifications || [];
    for (var i = 0; i < specs.length; i++) {
      if (etiquetas.indexOf(VM.norm(specs[i].label)) > -1 && specs[i].value) return String(specs[i].value).trim();
    }
    return null;
  }

  function migasDelDom() {
    var out = [];
    var nodos = document.querySelectorAll('[data-testid$="-breadcrumb"] li a, nav[aria-label*="readcrumb"] li a');
    for (var i = 0; i < nodos.length; i++) {
      var t = (nodos[i].textContent || '').trim();
      if (t && !/^(inicio|home)$/i.test(t)) out.push(t);
    }
    return out;
  }

  function leerFicha() {
    var r = null;
    try { r = inspectProductFromDOM(); } catch (e) { r = null; }
    var P = r && r.product;
    var id = idDeRuta();
    var configurador = document.querySelector('[data-testid$="-configurator"]');
    var careEnPantalla = !!(configurador && /liverpool care/i.test(configurador.textContent || ''));
    // El stream es de ESTA ficha solo si su id es el de la URL (ver cabecera).
    var deEsta = !!(P && P.identifiers && P.identifiers.productId && String(P.identifiers.productId) === String(id));
    if (!deEsta) {
      return {
        id: id,
        nombre: textoDe('h1'),
        marca: textoDe('[data-testid$="-brand-link"]'),
        migas: migasDelDom(),
        producto: null, modeloComercial: null, precio: null, esRango: false,
        variantes: [], varianteActual: null, seleccion: null, colores: [],
        care: careEnPantalla
      };
    }
    return {
      id: id,
      nombre: P.name || textoDe('h1'),
      marca: P.brand || textoDe('[data-testid$="-brand-link"]'),
      migas: (P.category && P.category.breadcrumbs && P.category.breadcrumbs.length) ? P.category.breadcrumbs : migasDelDom(),
      producto: especificacion(P, ['producto', 'tipo de producto']),
      modeloComercial: especificacion(P, ['modelo comercial']),
      precio: P.prices ? P.prices.current : null,
      esRango: !!(P.prices && P.prices.esRango),
      variantes: P.variants || [],
      varianteActual: P.varianteActual,
      skuUrl: P.skuVariante || null,
      seleccion: P.seleccion,
      colores: P.colors || [],
      care: !!(P.politicas && P.politicas.liverpoolCare) || careEnPantalla
    };
  }

  // ===========================================================================
  // Lectura de un carrusel
  // ===========================================================================

  var TARJETA = 'a[data-testid$="-card-link"]';

  function carrusel(re) {
    var titulos = document.querySelectorAll('h2, h3, p');
    var titulo = null;
    for (var i = 0; i < titulos.length; i++) {
      if (re.test((titulos[i].textContent || '').trim())) { titulo = titulos[i]; break; }
    }
    if (!titulo) return [];

    // La primera tarjeta DESPUÉS del título, y de ella el prefijo de su carrusel.
    var primera = null, cont = titulo;
    for (var k = 0; k < 8 && cont && !primera; k++) {
      cont = cont.parentElement;
      if (!cont) break;
      var enlaces = cont.querySelectorAll(TARJETA);
      for (var j = 0; j < enlaces.length; j++) {
        if (titulo.compareDocumentPosition(enlaces[j]) & Node.DOCUMENT_POSITION_FOLLOWING) { primera = enlaces[j]; break; }
      }
    }
    if (!primera) return [];
    var tid = primera.getAttribute('data-testid') || '';
    var corte = tid.indexOf('-product-');
    if (corte < 1) return [];
    var prefijo = tid.slice(0, corte);

    var vistos = {}, out = [];
    var tarjetas = document.querySelectorAll('a[data-testid^="' + prefijo + '-product-"]');
    for (var t = 0; t < tarjetas.length; t++) {
      var m = (tarjetas[t].getAttribute('data-testid') || '').match(/-product-(\d{6,})-card-link$/);
      if (!m || vistos[m[1]]) continue;
      vistos[m[1]] = true;
      out.push(tarjetaDe(tarjetas[t], m[1]));
    }
    return out;
  }

  /** Una tarjeta de producto de Liverpool (carrusel o búsqueda: la misma forma, marca en h4 y nombre en h3). */
  function tarjetaDe(a, id) {
    var plano = (a.textContent || '').replace(/\s+/g, '');
    var precios = plano.match(/\$[\d,]+(?:\.\d{1,2})?/g) || [];
    var img = a.querySelector('img');
    var h4 = a.querySelector('h4'), h3 = a.querySelector('h3');
    return {
      id: id,
      marca: h4 ? (h4.textContent || '').trim() : '',
      nombre: h3 ? (h3.textContent || '').trim() : '',
      precio: precios[0] ? VM.num(precios[0]) : null,
      rango: /\$[\d,.]+-\$/.test(plano),
      desc: (plano.match(/-(\d{1,2})%/) || [])[1] || null,
      img: img ? (img.currentSrc || img.getAttribute('src')) : null,
      href: a.getAttribute('href') || ''
    };
  }

  /** Los productos de una página de resultados (/tienda?s=…) ya descargada. */
  function resultadosDe(texto) {
    var doc = new DOMParser().parseFromString(String(texto || ''), 'text/html');
    var vistos = {}, items = [];
    var enlaces = doc.querySelectorAll('a[href*="/pdp/"]');
    for (var i = 0; i < enlaces.length; i++) {
      var id = (enlaces[i].getAttribute('href') || '').split('?')[0].split('/').pop();
      if (!/^\d{6,}$/.test(id) || vistos[id] || !enlaces[i].querySelector('h3')) continue;
      vistos[id] = true;
      var it = tarjetaDe(enlaces[i], id);
      it.img = it.img && /^https:/.test(it.img) ? it.img : null;
      items.push(it);
    }
    return { titulo: doc.title || '', items: items };
  }

  function leerCarruseles() {
    return {
      complementa: carrusel(/^complementa con/i),
      otros: carrusel(/^otros clientes compraron/i),
      relacionados: carrusel(/^art[ií]culos relacionados$/i)
    };
  }

  // ===========================================================================
  // Pintado
  // ===========================================================================

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Solo enlaces a liverpool.com.mx: una ficha de Liverpool o, si no, por id. */
  function urlFicha(item) {
    var h = String(item.href || '');
    if (/^\/tienda\/pdp\//.test(h)) return ORIGEN + h;
    if (h.indexOf(ORIGEN + '/tienda/pdp/') === 0) return h;
    return ORIGEN + '/tienda/pdp/x/' + encodeURIComponent(item.id);
  }
  function urlBusqueda(consulta) { return ORIGEN + '/tienda?s=' + encodeURIComponent(consulta); }
  function urlImagen(src) { return /^https:\/\/[\w.-]+\.liverpool\.com\.mx\//.test(String(src || '')) ? src : ''; }

  function fechaCorta(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return d.getDate() + ' ' + meses[d.getMonth()];
  }

  var ISOTIPO = '<g transform="translate(23.970 17.884) scale(0.7648)" fill="#fff"><path d="M23.247 24.0142H14.6304C13.6708 24.0142 13.3633 23.4338 13.3633 22.6437C13.3633 22.0029 13.3605 2.50287 13.3605 2.50287H10.3322V25.3904C10.3322 26.3529 11.174 26.985 11.7975 26.985H23.247V24.0142Z"/><path d="M23.2498 28.1199V31.0993H7.95029C6.90447 31.0993 6.17756 30.3293 6.17756 29.3324C6.18905 28.1601 6.17756 2.50287 6.17756 2.50287H9.19437V26.2696C9.19437 27.3125 9.65407 28.1199 10.947 28.1199H23.2498Z"/><path d="M2 2.5H5.03118V30.1656C5.03118 31.1683 5.53972 32.2285 7.02514 32.2285H23.2498V35.1993H5.60006C3.58885 35.1993 2 33.5559 2 31.5964V2.5Z"/><path d="M14.4953 2.5H17.5265V18.7448C17.5265 19.3367 17.7994 19.8998 18.6614 19.8998H23.2498V22.8793H16.0382C14.9292 22.8793 14.4982 22.1868 14.4982 21.3938V2.5H14.4953Z"/><path d="M27.2923 13.6852C28.252 13.6852 28.5594 14.2656 28.5594 15.0586C28.5594 15.6964 28.5651 35.1993 28.5651 35.1993H31.5934V12.3089C31.5934 11.3493 30.7516 10.7143 30.1281 10.7143H18.6729V13.6852H27.2923Z"/><path d="M18.6729 6.60286H33.9695C35.0154 6.60286 35.7423 7.37286 35.7423 8.36985C35.7308 9.53922 35.7423 35.1993 35.7423 35.1993H32.7255V11.4326C32.7255 10.3897 32.2629 9.58231 30.9728 9.58231H18.6729V6.60286Z"/><path d="M39.9227 35.1993H36.8915V7.53376C36.8915 6.53103 36.383 5.47371 34.8976 5.47371H18.6729V2.5H36.3198C38.3339 2.5 39.9227 4.14344 39.9227 6.10581V35.1993Z"/><path d="M27.4274 35.1993H24.3963V18.9545C24.3963 18.3627 24.1233 17.7967 23.2614 17.7967H18.6758V14.8143H25.8874C26.9965 14.8143 27.4274 15.5096 27.4274 16.3026V35.1993Z"/></g>';
  var ETIQUETA = '<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><path d="M25 9h28a7 7 0 0 1 7 7v32a7 7 0 0 1-7 7H25a5 5 0 0 1-3.6-1.5L5.6 35.5a5 5 0 0 1 0-7L21.4 10.5A5 5 0 0 1 25 9z" fill="#E10098"/><circle cx="15.5" cy="32" r="3.6" fill="#fff"/>' + ISOTIPO + '</svg>';
  var CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ESCUDO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.4 7.5 9.5 4.3-1.1 7.5-5 7.5-9.5V6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m8.8 12 2.2 2.2 4.2-4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var LUPA = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function fila(o) {
    // o: { k, href, nueva, img, ceja, nombre, nota, dif, precio, desc, desde }
    // k: clave estable del renglón; con ella se sabe qué llegó nuevo al repintar.
    var dentro =
      (o.img ? '<img class="img" src="' + esc(o.img) + '" alt="" loading="lazy">' : '<span class="img"></span>') +
      '<span class="tx">' +
        (o.ceja ? '<span class="ceja">' + esc(o.ceja) + '</span>' : '') +
        '<span class="nom">' + esc(o.nombre) + '</span>' +
        (o.nota ? '<span class="nota">' + esc(o.nota) + '</span>' : '') +
      '</span>' +
      '<span class="pr">' +
        (o.dif != null ? '<span class="dif">+' + esc(VM.pesos(o.dif)) + '</span>' : '') +
        (o.precio != null ? '<span class="pz">' + (o.desde ? '<small>desde </small>' : '') + esc(VM.pesos(o.precio)) + '</span>' : '') +
        (o.desc && o.dif == null ? '<span class="dto">-' + esc(o.desc) + '%</span>' : '') +
      '</span>';
    return '<a class="f" href="' + esc(o.href) + '"' + (o.k ? ' data-k="' + esc(o.k) + '"' : '') +
      (o.nueva ? ' target="_blank" rel="noopener"' : '') + '>' + dentro + '</a>';
  }

  function seccionIncremental(m) {
    var filas = '';
    var c = m.incremental.capacidad;
    if (c) {
      var notas = [];
      if (!c.todosLosColores && c.colores.length) notas.push('Solo en ' + c.colores.join(' y '));
      if (c.mensual) notas.push('+' + VM.pesos(c.mensual.monto) + ' al mes a ' + c.mensual.meses + ' MSI');
      filas += fila({
        k: 'c:' + c.sku, href: location.pathname + '?skuid=' + encodeURIComponent(c.sku), nueva: false,
        img: urlImagen(c.imagen), ceja: 'Misma ficha · ' + c.desde, nombre: 'Sube a ' + c.talla,
        nota: notas.join(' · '), dif: c.dif, precio: c.precio
      });
    }
    var s = m.incremental.modelo;
    if (s) {
      filas += fila({
        k: 'm:' + s.id, href: urlFicha(s), nueva: true, img: urlImagen(s.img), ceja: s.marca, nombre: s.nombre,
        dif: s.dif, precio: s.precio, desde: s.rango
      });
    }
    if (!filas) return '';
    return '<section class="sec"><h3>Venta incremental <span>sube la versión</span></h3>' + filas + '</section>';
  }

  function seccionCruzada(m) {
    var filas = m.cruzada.map(function (r) {
      return fila({
        k: 'x:' + r.id, href: urlFicha(r), nueva: true, img: urlImagen(r.img), ceja: r.marca, nombre: r.nombre,
        precio: r.precio, desc: r.desc, desde: r.rango
      });
    }).join('');
    // «Más opciones» de lo que se buscó (la página entera de Liverpool) y las
    // búsquedas de los tipos que se quedaron sin candidato, sin repetir.
    var consultas = [], vistas = {};
    m.cruzada.forEach(function (r) { if (r.origen === 'busqueda' && r.consulta) consultas.push(r.consulta); });
    m.sugeridas.forEach(function (b) { consultas.push(b.consulta); });
    var chips = consultas.filter(function (q) {
      var k = VM.norm(q);
      if (vistas[k]) return false;
      vistas[k] = true;
      return true;
    }).map(function (q) {
      return '<a class="chip" href="' + esc(urlBusqueda(q)) + '" data-k="q:' + esc(VM.norm(q)) + '" target="_blank" rel="noopener">' +
        LUPA + '<span>' + esc(VM.bonito(q)) + '</span></a>';
    }).join('');
    var servicio = m.servicio
      ? '<div class="srv">' + ESCUDO + '<span><b>Liverpool Care</b> · ofrece la protección del equipo; está en esta misma ficha.</span></div>'
      : '';
    if (!filas && !chips && !servicio) return '';
    return '<section class="sec"><h3>Venta cruzada <span>suma el complemento</span></h3>' + filas +
      (chips ? '<div class="chips" aria-label="Búsquedas sugeridas">' + chips + '</div>' : '') + servicio + '</section>';
  }

  function seccionPromos(m) {
    var p = m.promos;
    if (!p.hay) {
      return '<section class="sec camp"><h3>Promoción de hoy</h3>' +
        '<p class="nota-camp">Abre el Portal Ventel para traer las promociones del Monitor.</p></section>';
    }
    // La de su categoría, como siempre, y la más fuerte del Monitor. Si son la
    // misma, se dice una vez, con el sello.
    var html = '';
    if (p.ficha) {
      var pr = p.ficha.promo;
      var donde = p.ficha.por === 'categoria' && pr.c ? pr.c : pr.d;
      html += lineaPromo('cat', 'Hoy en ' + donde, pr, p.mismaQueFicha);
    }
    if (p.fuerte && !p.mismaQueFicha) {
      var lugar = [p.fuerte.d, p.fuerte.c].filter(Boolean).join(' · ');
      html += lineaPromo('fuerte', 'La más fuerte' + (lugar ? ', en ' + lugar : ''), p.fuerte, false);
    }
    if (!html) html = '<p class="nota-camp">El Monitor no tiene promociones vigentes hoy.</p>';
    var viejas = p.horas !== null && p.horas > 24;
    return '<section class="sec camp"><h3>Promoción de hoy</h3>' + html +
      (viejas ? '<p class="nota-camp">Son de hace ' + Math.round(p.horas / 24) + ' día(s): abre el Portal para actualizarlas.</p>' : '') +
      '</section>';
  }

  function lineaPromo(cual, etiqueta, pr, sello) {
    return '<p class="aqui promo" data-k="p:' + cual + ':' + esc(VM.norm([pr.d, pr.c, pr.t].join('|'))) + '">' +
      '<b>' + esc(etiqueta) + ':</b> ' + esc(pr.t) +
      (pr.f ? ' <span class="hasta">· vence el ' + esc(fechaCorta(pr.f)) + '</span>' : '') +
      (sello ? ' <span class="sello">La más fuerte</span>' : '') + '</p>';
  }

  function pintar(m) {
    var titulo = (m.modelo || (estado.ficha && estado.ficha.nombre) || '').replace(/\s+\d+(\.\d+)?\s*pulgadas.*$/i, '');
    var donde = (m.clase && m.clase.nombre) || ((estado.ficha && estado.ficha.migas || []).slice(-1)[0] || '');
    var cuerpo = seccionIncremental(m) + seccionCruzada(m) + seccionPromos(m);
    return '<section class="t' + (estado.plegado ? ' plegada' : '') + '" aria-label="Vende más con este artículo">' +
      '<header class="cab">' + ETIQUETA +
        '<span class="cab-tx"><b>Vende más con este artículo</b><small>' + esc(titulo) + (donde ? ' · ' + esc(donde) : '') + '</small></span>' +
        '<button class="plegar" type="button" data-accion="plegar" aria-expanded="' + (!estado.plegado) + '" aria-label="' + (estado.plegado ? 'Mostrar' : 'Ocultar') + ' recomendaciones">' + CHEVRON + '</button>' +
      '</header>' +
      '<div class="cuerpo"' + (estado.plegado ? ' hidden' : '') + '>' + cuerpo + '</div>' +
    '</section>';
  }

  var CSS =
    ':host{display:block}' +
    '*{box-sizing:border-box}' +
    '.t{color:#333;background:#fff;border:1px solid #e3e3e3;border-radius:8px;font-size:12px;line-height:1.35;overflow:hidden}' +
    '.cab{display:flex;gap:10px;align-items:center;padding:11px 10px 11px 14px}' +
    '.logo{width:28px;height:28px;flex:none}' +
    '.cab-tx{flex:1;min-width:0}' +
    '.cab-tx b{display:block;font-size:13px;color:#1a1a1a;font-weight:600}' +
    '.cab-tx small{display:block;font-size:11px;color:#767676;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.plegar{flex:none;width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:6px;background:none;color:#767676;cursor:pointer}' +
    '.plegar:hover{background:#f4f4f4;color:#333}' +
    '.plegar svg{width:18px;height:18px;transition:transform .2s ease}' +
    '.plegada .plegar svg{transform:rotate(180deg)}' +
    '.cuerpo[hidden]{display:none}' +
    '.sec{padding:0 14px 9px;border-top:1px solid #f0f0f0}' +
    '.sec h3{margin:9px 0 3px;font-size:11.5px;font-weight:600;color:#1a1a1a}' +
    '.sec h3 span{font-weight:400;color:#767676;margin-left:4px}' +
    'a.f{display:grid;grid-template-columns:40px 1fr auto;gap:10px;align-items:center;padding:5px 6px;margin:0 -6px;border-radius:6px;color:inherit;text-decoration:none}' +
    'a.f:hover{background:#f6f6f6}' +
    '.img{width:40px;height:40px;border-radius:6px;background:#f5f5f5;object-fit:contain;display:block}' +
    '.tx{min-width:0}' +
    '.ceja{display:block;font-size:10px;letter-spacing:.03em;color:#767676;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.nom{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;color:#333}' +
    '.nota{display:block;font-size:10.5px;color:#767676}' +
    '.pr{text-align:right;white-space:nowrap}' +
    '.dif{display:block;font-size:11.5px;color:#E10098;font-weight:700}' +
    '.pz{display:block;font-weight:600;color:#1a1a1a}' +
    '.pz small{font-weight:400;color:#767676;font-size:10px}' +
    '.dto{display:block;font-size:10.5px;color:#767676}' +
    '.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}' +
    '.chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#333;background:#fff;border:1px solid #e3e3e3;border-radius:999px;padding:4px 10px 4px 8px;text-decoration:none}' +
    '.chip svg{width:12px;height:12px;color:#767676}' +
    '.chip:hover{border-color:#E10098;color:#E10098}' +
    '.chip:hover svg{color:#E10098}' +
    '.srv{display:flex;gap:8px;align-items:flex-start;margin:8px 0 2px;color:#555;font-size:11.5px}' +
    '.srv svg{width:16px;height:16px;flex:none;color:#E10098;margin-top:1px}' +
    '.srv b{color:#1a1a1a;font-weight:600}' +
    '.camp{background:#fcf4f9;border-top-color:#f5dbeb;padding-bottom:12px}' +
    '.aqui{margin:2px 0 8px;color:#333}' +
    '.aqui:last-child{margin-bottom:2px}' +
    '.aqui b{color:#1a1a1a;font-weight:600}' +
    '.hasta{color:#767676;font-size:11px;white-space:nowrap}' +
    '.sello{display:inline-block;margin-left:2px;padding:1px 7px;border-radius:999px;background:#E10098;color:#fff;font-size:10px;font-weight:600;line-height:1.5;white-space:nowrap;vertical-align:1px}' +
    '.nota-camp{margin:2px 0 4px;color:#767676;font-size:11.5px}' +
    'a:focus-visible,button:focus-visible{outline:2px solid #E10098;outline-offset:2px}';

  // ===========================================================================
  // Movimiento (GSAP 3.15: vendor/gsap.min.js, cargado antes que este archivo)
  // ===========================================================================
  // Al llegar a una ficha, la tarjeta entra: la caja sube y aparece, la etiqueta
  // se asienta y lo de adentro llega en orden de lectura. Lo que trae después la
  // búsqueda entra marcado en rosa, para que el asesor vea qué llegó.
  // Es adorno, y nunca lo único que hace visible algo: todo se pinta visible y
  // GSAP solo lo trae hasta ahí (fromTo + clearProps). Sin GSAP, con «reducir
  // movimiento» o con la pestaña oculta, la tarjeta simplemente está. Si el
  // navegador congela los fotogramas a media entrada, una red de seguridad la
  // termina: así dejó media portada en blanco el mismo patrón en otro proyecto.

  var G = (typeof gsap !== 'undefined' && gsap && typeof gsap.timeline === 'function') ? gsap : null;
  var LIMPIAR = 'opacity,visibility,transform';
  var mov = { url: '', entrada: null };

  function sinMovimiento() {
    if (!G || document.hidden) return true;
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  /** Lleva una animación a su final (todo visible, sin estilos en línea) y la suelta. */
  function terminar(tl) {
    if (!tl) return;
    if (mov.entrada === tl) mov.entrada = null;
    try { tl.progress(1); tl.kill(); } catch (e) { /* nada */ }
  }

  /** Si algo falla a media animación, nada se queda oculto: fuera los estilos en línea. */
  function rescatar(h) {
    try {
      h.removeAttribute('style');
      [].forEach.call(h.shadowRoot.querySelectorAll('[style]'), function (e) { e.removeAttribute('style'); });
    } catch (e) { /* nada */ }
  }

  function entrando() { return !!(mov.entrada && mov.entrada.isActive()); }

  function clavesDe(raiz) {
    var out = {};
    if (raiz) [].forEach.call(raiz.querySelectorAll('[data-k]'), function (e) { out[e.getAttribute('data-k')] = true; });
    return out;
  }

  function entrada(h) {
    terminar(mov.entrada);
    var raiz = h.shadowRoot;
    var logo = raiz.querySelector('.logo');
    // En orden de lectura; plegada, solo la cabecera.
    var piezas = [].slice.call(raiz.querySelectorAll(estado.plegado ? '.cab-tx' : '.cab-tx, .sec h3, a.f, .chips, .srv, .promo, .nota-camp'));
    var sellos = estado.plegado ? [] : [].slice.call(raiz.querySelectorAll('.sello'));
    // Los puntos de partida se escriben YA: gsap.set no espera fotograma. Con
    // fromTo, la caja alcanzaba a verse entera un fotograma antes de entrar
    // (medido en Chrome headless, 03/10/2026).
    G.set(h, { autoAlpha: 0, y: 14 });
    if (logo) G.set(logo, { autoAlpha: 0, scale: 0.4, rotation: -14 });
    if (piezas.length) G.set(piezas, { autoAlpha: 0, y: 8 });
    if (sellos.length) G.set(sellos, { autoAlpha: 0, scale: 0.6 });
    var tl = G.timeline({
      defaults: { ease: 'power2.out', clearProps: LIMPIAR },
      onComplete: function () { programar(30); }   // lo que llegó a media entrada, ahora
    });
    tl.to(h, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0);
    if (logo) tl.to(logo, { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.6, ease: 'back.out(1.7)' }, 0.1);
    if (piezas.length) tl.to(piezas, { autoAlpha: 1, y: 0, duration: 0.34, stagger: { amount: Math.min(0.65, 0.06 * piezas.length) } }, 0.18);
    if (sellos.length) tl.to(sellos, { autoAlpha: 1, scale: 1, duration: 0.4, ease: 'back.out(2.2)' }, '>-0.15');
    mov.entrada = tl;
    setTimeout(function () { if (mov.entrada === tl && tl.progress() < 1) terminar(tl); }, 3000);
  }

  /** Lo que no estaba en el pintado anterior (lo que trajo la búsqueda) entra marcado. */
  function nuevas(raiz, antes) {
    var lista = [].filter.call(raiz.querySelectorAll('[data-k]'), function (e) { return !antes[e.getAttribute('data-k')]; });
    if (!lista.length) return;
    var filas = lista.filter(function (e) { return e.matches('a.f'); });
    G.set(lista, { autoAlpha: 0, x: -10 });
    if (filas.length) G.set(filas, { backgroundColor: 'rgba(225,0,152,0.12)' });
    G.to(lista, { autoAlpha: 1, x: 0, duration: 0.45, ease: 'power3.out', stagger: 0.08, clearProps: LIMPIAR });
    if (filas.length) G.to(filas, { backgroundColor: 'rgba(225,0,152,0)', duration: 1.4, delay: 0.35, ease: 'power1.out', clearProps: 'backgroundColor' });
  }

  /** La ficha por su producto, no por su URL: cambiar color o capacidad (?skuid=) no es otra ficha. */
  function fichaEnPantalla() { return idDeRuta() || location.pathname; }

  function animar(h, primera, antes) {
    if (primera) mov.url = fichaEnPantalla();
    if (sinMovimiento()) { terminar(mov.entrada); return; }
    if (primera) entrada(h);
    else nuevas(h.shadowRoot, antes);
  }

  // ===========================================================================
  // Colocación y ciclo
  // ===========================================================================

  function ancla() {
    var b = document.querySelector('[data-testid="add-to-bag-button"]') ||
            document.querySelector('[data-testid="buy-now-button"]');
    return b ? b.parentElement : null;
  }

  function host(a) {
    var h = document.getElementById(HOST_ID);
    if (!h) {
      h = document.createElement('div');
      h.id = HOST_ID;
      h.attachShadow({ mode: 'open' });
      h.shadowRoot.addEventListener('click', alClic);
      estado.firma = '';
    }
    if (h.previousElementSibling !== a) a.insertAdjacentElement('afterend', h);
    return h;
  }

  function quitar() {
    terminar(mov.entrada);
    mov.url = '';
    var h = document.getElementById(HOST_ID);
    if (h) h.remove();
    estado.firma = '';
  }

  function asegurar() {
    try {
      if (!esFicha()) { quitar(); return; }
      var a = ancla();
      if (!a) return;
      if (estado.producto !== fichaEnPantalla()) {
        // Otro producto: lo buscado para el anterior no le sirve a este. Elegir color o
        // capacidad cambia la URL (?skuid=…&size=…, medido el 03/10/2026), pero es el
        // mismo producto: lo buscado sigue valiendo y no se vuelve a pedir.
        estado.resultados = {};
        estado.intentadas = {};
        estado.producto = fichaEnPantalla();
      }
      if (estado.url !== location.href || estado.sucio || !estado.ficha) {
        estado.ficha = leerFicha();
        estado.url = location.href;
        estado.sucio = false;
      }
      if (!estado.ficha || !estado.ficha.nombre) return;
      var modelo = VM.recomendar(estado.ficha, leerCarruseles(), estado.promos, REGLAS, Date.now(), estado.resultados);
      var html = pintar(modelo);
      var h = host(a);
      var firma = html + '|' + estado.plegado;
      var primera = mov.url !== fichaEnPantalla();   // la primera vez que se pinta ESTE producto
      // A media entrada no se repinta: rehacer el DOM la cortaría (pasa con la
      // búsqueda que sale de la caché). Al terminar, lo nuevo entra marcado.
      if (firma !== estado.firma && !(entrando() && !primera)) {
        var antes = clavesDe(h.shadowRoot);
        h.shadowRoot.innerHTML = '<style>' + CSS + '</style>' + html;
        estado.firma = firma;
        estado.modelo = modelo;
        try { animar(h, primera, antes); } catch (e) { terminar(mov.entrada); rescatar(h); }
      }
      buscarLoQueFalta(modelo.busquedas);
    } catch (e) {
      try { console.warn('Ventel Vende más:', e && e.message); } catch (e2) { /* nada */ }
    }
  }

  // ===========================================================================
  // Búsqueda de lo que les faltó a los carruseles (buscador-liverpool.js)
  // ===========================================================================

  var buscador = window.VentelBuscador ? window.VentelBuscador.crear({
    leer: leerP,
    guardar: guardarP,
    pedir: function (url) {
      // Absoluta y del mismo origen que la ficha: es la búsqueda que haría el asesor.
      return fetch(location.origin + url, { credentials: 'include' }).then(function (r) {
        return r.text().then(function (t) { return { status: r.status, texto: t }; });
      });
    },
    leerResultados: resultadosDe,
    ahora: function () { return Date.now(); }
  }) : null;

  /** El Portal puede apagar la búsqueda para todos (ajustes.busqueda del paquete de promociones). */
  function busquedaEncendida() {
    return !(estado.promos && estado.promos.ajustes && estado.promos.ajustes.busqueda === false);
  }

  /**
   * Primero la caché (no sale a la red), después la red, de una en una, y solo con
   * la pestaña a la vista: una pestaña en segundo plano no necesita la tarjeta y
   * no tiene por qué gastar el ritmo de búsquedas.
   */
  function buscarLoQueFalta(plan) {
    if (!buscador || !plan || !plan.length || estado.buscando) return;
    var producto = fichaEnPantalla();
    var pendientes = plan.filter(function (b) { return !estado.intentadas[b.consulta]; });
    if (!pendientes.length) return;
    estado.buscando = true;
    var siguiente = function (i) {
      if (i >= pendientes.length || fichaEnPantalla() !== producto) { estado.buscando = false; return; }
      var b = pendientes[i];
      estado.intentadas[b.consulta] = true;
      buscador.deCache(b.consulta).then(function (items) {
        if (items) return { items: items };
        if (!busquedaEncendida()) return { items: null };
        if (document.hidden) { estado.intentadas[b.consulta] = false; return { items: null, oculta: true }; }
        return buscador.buscar(b.consulta);
      }).then(function (res) {
        if (fichaEnPantalla() !== producto) { estado.buscando = false; return; }
        if (res && res.oculta) { estado.buscando = false; return; }
        if (res && res.items) {
          estado.resultados[b.consulta] = res.items;
          estado.firma = '';
          asegurar();
        }
        siguiente(i + 1);
      }, function () { siguiente(i + 1); });
    };
    siguiente(0);
  }

  // Con la pestaña de vuelta a la vista, lo que se dejó pendiente se busca.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) programar(200);
  });

  var temporizador = null;
  function programar(ms) {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(function () { temporizador = null; asegurar(); }, ms || 300);
  }

  function alClic(ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-accion]') : null;
    if (!b) return;
    if (b.getAttribute('data-accion') === 'plegar') {
      terminar(mov.entrada);   // lo que pide el asesor no espera a la animación
      estado.plegado = !estado.plegado;
      guardar({ vmPlegado: estado.plegado });
      estado.firma = '';
      asegurar();
    }
  }

  // El asesor cambió color o capacidad: la variante en foco se vuelve a leer.
  document.addEventListener('click', function (ev) {
    var cfg = ev.target && ev.target.closest ? ev.target.closest('[data-testid$="-configurator"]') : null;
    if (cfg && !(ev.target.closest && ev.target.closest('#' + HOST_ID))) {
      estado.sucio = true;
      programar(700);
    }
  }, true);

  try {
    chrome.storage.onChanged.addListener(function (cambios, area) {
      if (area !== 'local') return;
      if (cambios[CLAVE_PROMOS]) { estado.promos = cambios[CLAVE_PROMOS].newValue || null; programar(50); }
    });
  } catch (e) { /* sin contexto de extensión */ }

  // Diagnóstico: desde la consola de DevTools, en el contexto de la extensión,
  // __ventelVendeMas() dice qué leyó la tarjeta y qué decidió.
  window.__ventelVendeMas = function () {
    return { ficha: estado.ficha, carruseles: leerCarruseles(), promos: estado.promos, modelo: estado.modelo };
  };

  leer([CLAVE_PROMOS, CLAVE_PLEGADO], function (r) {
    estado.promos = r[CLAVE_PROMOS] || null;
    estado.plegado = r[CLAVE_PLEGADO] === true;
    asegurar();
    var obs = new MutationObserver(function (mutaciones) {
      for (var i = 0; i < mutaciones.length; i++) {
        var n = mutaciones[i].target;
        if (!(n && n.id === HOST_ID)) { programar(300); return; }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setInterval(asegurar, 2000);
  });
})();
