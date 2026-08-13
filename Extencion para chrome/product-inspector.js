/**
 * =============================================================================
 * Ventel · Inspector de artículo (product-inspector.js)
 * =============================================================================
 * Contiene UNA sola función, `inspectProductFromDOM`, que se inyecta tal cual en
 * la pestaña activa con `chrome.scripting.executeScript({ func: ... })`. Por eso
 * TODO vive dentro de la función: no puede apoyarse en nada de fuera.
 *
 * Saca absolutamente toda la información de una ficha de producto (PDP) de
 * Liverpool: lo que se ve y lo que no. La mina de verdad no es el DOM, es el
 * stream RSC de Next.js (`self.__next_f.push`), donde Liverpool deja el objeto
 * completo del artículo: SKU general, cada variante con su SKU, precios, todas
 * las promociones y planes de meses, las ofertas de cada vendedor del
 * marketplace, las características, el inventario y las políticas.
 *
 * El DOM se usa para lo que el stream NO trae (calificación, código de producto
 * visible, entrega estimada, qué variante está seleccionada) y como respaldo
 * cuando no hay stream.
 *
 * Hecho por su gran amigo David Martínez "El escritor" · v2.0 · 13/08/2026
 */

function inspectProductFromDOM() {
  'use strict';

  var avisos = [];
  function avisar(mensaje) {
    try { console.warn('Ventel Inspector:', mensaje); } catch (e) { /* da igual */ }
    if (avisos.indexOf(mensaje) === -1) avisos.push(mensaje);
  }

  // ===========================================================================
  // Utilidades menudas
  // ===========================================================================
  function qs(selector, raiz) {
    try { return (raiz || document).querySelector(selector); } catch (e) { return null; }
  }
  function qsa(selector, raiz) {
    try { return Array.prototype.slice.call((raiz || document).querySelectorAll(selector)); }
    catch (e) { return []; }
  }
  function texto(nodo) {
    if (!nodo) return null;
    var t = (nodo.textContent || '').replace(/\s+/g, ' ').trim();
    return t || null;
  }
  function atributo(nodo, nombre) { return nodo ? nodo.getAttribute(nombre) : null; }
  function esNada(v) { return v === undefined || v === null || v === '' || v === 'null'; }
  function oNulo(v) { return esNada(v) ? null : v; }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (esNada(v)) return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function esObjeto(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function unicos(lista) {
    var vistos = {}, salida = [];
    for (var i = 0; i < lista.length; i++) {
      var k = String(lista[i]);
      if (!vistos[k]) { vistos[k] = true; salida.push(lista[i]); }
    }
    return salida;
  }
  /**
   * La descripción del catálogo viene con las frases pegadas
   * ("…más accesible.Características destacadas:Pantalla Super Retina…").
   * Se separa solo cuando tras el punto o los dos puntos viene una MAYÚSCULA y
   * antes hay una minúscula o un dígito: así `6.7"` y `U.S.A.` se quedan como
   * están. El texto original sigue intacto en `rawFlightData`.
   */
  function despegarFrases(texto_) {
    if (!texto_) return texto_;
    return String(texto_).replace(/([a-záéíóúüñ0-9])([.:;])([A-ZÁÉÍÓÚÜÑ])/g, '$1$2 $3');
  }

  /** Solo hojas de texto: un <div> que envuelve media página no es una etiqueta. */
  function esHoja(nodo) {
    return !!nodo && !nodo.querySelector('p, span, div, li, a, table, ul');
  }

  /**
   * "$29,999.10" → 29999.10. Mismo criterio que el extractor de bolsa clásico:
   * los centavos son los DOS primeros dígitos tras el punto, porque Liverpool
   * repite la cifra en un span de accesibilidad y si no se acota salen números
   * imposibles.
   */
  function aPrecio(cadena) {
    if (esNada(cadena)) return null;
    var limpio = String(cadena).trim();
    if (limpio.indexOf('.') !== -1) {
      var partes = limpio.split('.');
      var enteros = partes[0].replace(/[^0-9-]/g, '');
      var decimales = partes[1].replace(/[^0-9]/g, '').substring(0, 2);
      limpio = enteros + '.' + decimales;
    } else {
      limpio = limpio.replace(/[^0-9-]/g, '');
    }
    var n = parseFloat(limpio);
    return isFinite(n) ? n : null;
  }

  /** Precio desde un contenedor con la maraña de spans de Liverpool. */
  function precioDeNodo(nodo) {
    if (!nodo) return null;
    var spans = qsa('span', nodo);
    var cadena = '';
    if (spans.length) {
      for (var i = 0; i < spans.length; i++) {
        if (spans[i].classList && spans[i].classList.contains('invisible')) continue;
        if (spans[i].querySelector && spans[i].querySelector('span')) continue; // solo hojas
        cadena += spans[i].textContent;
      }
    }
    if (!cadena.replace(/\s/g, '')) cadena = nodo.textContent || '';
    return aPrecio(cadena);
  }

  // ===========================================================================
  // 1. El stream RSC de Next.js (flight data)
  // ===========================================================================
  /**
   * Los datos viajan en `self.__next_f.push([1,"…"])`. Cada push trae un trozo
   * de un stream de texto que hay que concatenar EN ORDEN, porque un objeto
   * puede quedar partido entre dos pushes.
   */
  function reunirTextoDelStream() {
    var scripts = qsa('script');
    var trozos = [];
    for (var i = 0; i < scripts.length; i++) {
      var codigo = scripts[i].textContent;
      if (!codigo || codigo.indexOf('self.__next_f.push') === -1) continue;
      var argumentos = argumentosDePush(codigo);
      for (var j = 0; j < argumentos.length; j++) {
        try {
          var arr = JSON.parse(argumentos[j]);
          if (Array.isArray(arr) && typeof arr[1] === 'string') trozos.push(arr[1]);
        } catch (e) { /* algunos push llevan variables, no JSON */ }
      }
    }
    return trozos.join('');
  }

  /**
   * Saca el texto de cada `self.__next_f.push( … )` balanceando paréntesis y
   * respetando las comillas. Una expresión regular no sirve: los payloads traen
   * paréntesis y comillas escapadas a montones.
   */
  function argumentosDePush(codigo) {
    var salida = [], desde = 0, marca = 'self.__next_f.push(';
    while (true) {
      var donde = codigo.indexOf(marca, desde);
      if (donde === -1) break;
      var i = donde + marca.length, inicio = i, nivel = 1, comilla = null, escape = false;
      while (i < codigo.length && nivel > 0) {
        var c = codigo.charAt(i);
        if (escape) { escape = false; i++; continue; }
        if (comilla) {
          if (c === '\\') escape = true;
          else if (c === comilla) comilla = null;
        } else if (c === '"' || c === "'" || c === '`') {
          comilla = c;
        } else if (c === '(' || c === '[' || c === '{') {
          nivel++;
        } else if (c === ')' || c === ']' || c === '}') {
          nivel--;
        }
        i++;
      }
      salida.push(codigo.slice(inicio, i - 1));
      desde = i;
    }
    return salida;
  }

  /** Bytes que ocupa un carácter en UTF-8, sin construir buffers. */
  function bytesDeCodigo(cp) {
    if (cp < 0x80) return 1;
    if (cp < 0x800) return 2;
    if (cp < 0x10000) return 3;
    return 4;
  }

  /**
   * Trocea el stream en chunks `<idHex>:<payload>`.
   *
   * El caso que rompe a cualquier parser ingenuo es `<id>:T<longitudHex>,<texto>`:
   * ahí la longitud viene en BYTES utf-8 y el texto PUEDE llevar saltos de línea
   * de verdad, así que partir por "\n" destroza el stream y deja referencias
   * colgando (era justo lo que le pasaba a la versión anterior).
   */
  function trocearStream(stream) {
    var chunks = {};
    var i = 0, total = stream.length;
    while (i < total) {
      var dosPuntos = stream.indexOf(':', i);
      if (dosPuntos === -1) break;
      var id = stream.slice(i, dosPuntos);
      if (!/^[0-9a-f]+$/.test(id)) {           // basura: saltar a la línea siguiente
        var salto = stream.indexOf('\n', i);
        if (salto === -1) break;
        i = salto + 1;
        continue;
      }
      var j = dosPuntos + 1;
      if (stream.charAt(j) === 'T') {
        var coma = stream.indexOf(',', j);
        var bytes = parseInt(stream.slice(j + 1, coma), 16);
        var arranque = coma + 1, gastados = 0, k = arranque;
        while (k < total && gastados < bytes) {
          var cp = stream.codePointAt(k);
          gastados += bytesDeCodigo(cp);
          k += cp > 0xFFFF ? 2 : 1;
        }
        chunks[id] = { etiqueta: 'T', cuerpo: stream.slice(arranque, k) };
        i = k + 1;
        continue;
      }
      var fin = stream.indexOf('\n', j);
      if (fin === -1) fin = total;
      var cuerpo = stream.slice(j, fin);
      var etiqueta = cuerpo.charAt(0);
      if (etiqueta !== 'I' && etiqueta !== 'H' && etiqueta !== 'E') {
        try { cuerpo = JSON.parse(cuerpo); } catch (e) { /* trozo incompleto */ }
      }
      chunks[id] = { etiqueta: etiqueta, cuerpo: cuerpo };
      i = fin + 1;
    }
    return chunks;
  }

  /**
   * Resuelve las referencias del stream: dentro del JSON, un texto "$1a" apunta
   * al chunk 1a. Sin esto el objeto del producto sale lleno de cadenas "$4d2"
   * en vez de datos.
   */
  function crearResolutor(chunks) {
    var visitados = 0, TOPE = 500000;
    var sinResolver = {};
    function resolver(valor, profundidad) {
      if (++visitados > TOPE) return null;                  // freno anti-bucle
      profundidad = profundidad || 0;
      if (profundidad > 60) return null;
      if (typeof valor === 'string') {
        if (valor.length < 2 || valor.charAt(0) !== '$') return valor;
        var tipo = valor.charAt(1);
        if (valor === '$undefined') return null;
        if (tipo === '$') return valor.slice(1);              // "$$" es un "$" literal
        if (tipo === 'L' || tipo === 'S' || tipo === '@') return valor; // módulo/símbolo/promesa
        if (tipo === 'D') return valor.slice(2);              // fecha
        var id = valor.slice(1);
        if (chunks[id]) return resolver(chunks[id].cuerpo, profundidad + 1);
        sinResolver[valor] = true;
        return valor;
      }
      if (Array.isArray(valor)) {
        var lista = [];
        for (var i = 0; i < valor.length; i++) lista.push(resolver(valor[i], profundidad + 1));
        return lista;
      }
      if (esObjeto(valor)) {
        var obj = {};
        for (var clave in valor) {
          if (Object.prototype.hasOwnProperty.call(valor, clave)) {
            obj[clave] = resolver(valor[clave], profundidad + 1);
          }
        }
        return obj;
      }
      return valor;
    }
    resolver.sinResolver = sinResolver;
    resolver.agotado = function () { return visitados > TOPE; };
    return resolver;
  }

  /** Busca en un árbol ya resuelto el primer objeto que tenga esa clave. */
  function buscarPorClave(raiz, clave, profundidad) {
    profundidad = profundidad || 0;
    if (profundidad > 60 || !raiz || typeof raiz !== 'object') return null;
    if (esObjeto(raiz) && Object.prototype.hasOwnProperty.call(raiz, clave)) return raiz;
    for (var k in raiz) {
      if (!Object.prototype.hasOwnProperty.call(raiz, k)) continue;
      var hallado = buscarPorClave(raiz[k], clave, profundidad + 1);
      if (hallado) return hallado;
    }
    return null;
  }

  /**
   * Localiza el bloque del PDP. Se resuelve SOLO el chunk que ya menciona las
   * claves del producto: resolver los ~1700 chunks de la página costaría una
   * eternidad y llenaría la memoria de copias.
   */
  function localizarNodoPdp(chunks, resolver) {
    var pistas = ['"productSpecs"', '"dynamicAttributes"', '"offerColorSet"', '"categoryBreadCrumbs"'];
    var candidatos = [];
    for (var id in chunks) {
      if (!Object.prototype.hasOwnProperty.call(chunks, id)) continue;
      var chunk = chunks[id];
      if (chunk.etiqueta === 'I' || chunk.etiqueta === 'H') continue;
      var comoTexto;
      try {
        comoTexto = typeof chunk.cuerpo === 'string' ? chunk.cuerpo : JSON.stringify(chunk.cuerpo);
      } catch (e) { continue; }
      if (!comoTexto) continue;
      for (var p = 0; p < pistas.length; p++) {
        if (comoTexto.indexOf(pistas[p]) !== -1) {
          candidatos.push({ id: id, tam: comoTexto.length });
          break;
        }
      }
    }
    candidatos.sort(function (a, b) { return b.tam - a.tam; });

    for (var c = 0; c < candidatos.length && c < 6; c++) {
      var arbol;
      try { arbol = resolver(chunks[candidatos[c].id].cuerpo); } catch (e) { continue; }
      var conSpecs = buscarPorClave(arbol, 'productSpecs');
      if (conSpecs && conSpecs.product) return conSpecs;
      var conProducto = buscarPorClave(arbol, 'dynamicAttributes');
      if (conProducto) return { product: conProducto };
    }
    return null;
  }

  // ===========================================================================
  // 2. Traducción del stream al resultado
  // ===========================================================================

  /** Aplana una promoción del stream al formato que pinta la interfaz. */
  function comoPlan(promo, origen) {
    if (!esObjeto(promo)) return null;
    var meses = num(promo.months) || 0;
    var mensual = num(promo.monthlyPrice);
    var precio = num(promo.itemPrice);
    if (mensual === null && precio !== null && meses > 0) mensual = precio / meses;
    var descripcion = String(promo.promotionDescription || '');
    return {
      months: meses,
      monthlyPayment: mensual,
      itemPrice: precio,
      description: oNulo(promo.promotionDescription),
      promoCode: oNulo(promo.promoCode),
      type: oNulo(promo.promotionType),
      // "MSI" viene escrito en la descripción; los planes de 0 meses son pago
      // único y no son un plan de meses de verdad.
      noInterest: meses > 0 && /msi|sin\s+inter[eé]s/i.test(descripcion),
      minPurchaseAmount: num(promo.minPurchaseAmount),
      discountAmount: num(promo.discountAmount),
      origen: origen || null
    };
  }

  /**
   * El mismo plan de meses aparece en varias cubetas del stream (un 3 MSI sale
   * a la vez en `liverpoolEMI` y en `other`). Se juntan por meses + código de
   * promoción + mensualidad, guardando de qué cubetas venía cada uno.
   */
  function agruparPlanes(planes) {
    var porClave = {}, orden = [];
    for (var i = 0; i < planes.length; i++) {
      var p = planes[i];
      var clave = p.months + '|' + p.promoCode + '|' + p.monthlyPayment;
      if (!porClave[clave]) {
        porClave[clave] = {
          months: p.months, monthlyPayment: p.monthlyPayment, itemPrice: p.itemPrice,
          description: p.description, promoCode: p.promoCode, type: p.type,
          noInterest: p.noInterest, minPurchaseAmount: p.minPurchaseAmount,
          discountAmount: p.discountAmount, origen: p.origen, origenes: []
        };
        orden.push(clave);
      }
      if (porClave[clave].origenes.indexOf(p.origen) === -1) porClave[clave].origenes.push(p.origen);
    }
    var salida = [];
    for (var o = 0; o < orden.length; o++) salida.push(porClave[orden[o]]);
    salida.sort(function (a, b) { return (a.months || 0) - (b.months || 0); });
    return salida;
  }

  /** Normaliza una oferta de marketplace. */
  function comoOferta(oferta) {
    if (!esObjeto(oferta)) return null;
    var edd = oferta.marketPlaceEDDMessage || {};
    return {
      sellerId: oNulo(oferta.sellerId),
      sellerName: oNulo(oferta.sellerName),
      offerId: oNulo(oferta.offerId),
      sellerSkuId: oNulo(oferta.sellerSkuId),
      price: num(oferta.price),
      promoPrice: num(oferta.promoPrice),
      salePrice: num(oferta.salePrice),
      listPrice: num(oferta.listPrice),
      minimumPrice: num(oferta.minimumPrice),
      maximumPrice: num(oferta.maximumPrice),
      allowLpPromotions: oferta.allowLpPromotions === true,
      leadTimeToShip: num(oferta.leadTimeToShip),
      totalReviews: num(oferta.totalReviews),
      crossBorder: oNulo(oferta.crossBorder),
      entregaEstimada: oNulo(edd.marketPlaceEDDHome) || oNulo(edd.marketPlaceEDDCNC) ||
                       oNulo(edd.marketPlaceEDDBTHome) || oNulo(edd.marketPlaceEDDBTCNC)
    };
  }

  /**
   * Convierte una variante del stream. Cada variante es un artículo completo:
   * su propio SKU, su vendedor, su precio y sus meses.
   */
  function comoVariante(v) {
    if (!esObjeto(v)) return null;
    var mejorOferta = (v.offers && v.offers.bestOffer) ? comoOferta(v.offers.bestOffer) : null;
    var ofertas = [];
    if (v.offers && Array.isArray(v.offers.offers)) {
      for (var i = 0; i < v.offers.offers.length; i++) {
        var o = comoOferta(v.offers.offers[i]);
        if (o) ofertas.push(o);
      }
    }

    // Todas las cubetas de promociones, cada una etiquetada con su origen: sin
    // la etiqueta no hay forma de saber si un plan es de tarjeta Liverpool o de
    // cualquier otra.
    var planes = [], promos = v.promotions || {};
    var cubetas = ['liverpool', 'liverpoolEMI', 'other', 'otherEMI', 'specialEMI', 'miniPagos', 'specialPromotions'];
    for (var c = 0; c < cubetas.length; c++) {
      var lista = promos[cubetas[c]];
      if (!Array.isArray(lista)) continue;
      for (var j = 0; j < lista.length; j++) {
        var plan = comoPlan(lista[j], cubetas[c]);
        if (plan) planes.push(plan);
      }
    }

    var stock = (v.flags && v.flags.limitedStock) || {};
    var precioLista = num(v.listPrice);
    var precioPromo = num(v.promoPrice);
    var descuento = num(v.discountPercentage);
    if (descuento === null && precioLista && precioPromo && precioLista > precioPromo) {
      descuento = Math.round(((precioLista - precioPromo) / precioLista) * 1000) / 10;
    }

    return {
      sku: oNulo(v.skuId),
      name: oNulo(v.skuName),
      color: oNulo(v.colorName),
      colorComercial: oNulo(v.clothingBrandColor),
      colorHex: oNulo(v.colorHex),
      size: oNulo(v.size),
      listPrice: precioLista,
      promoPrice: precioPromo,
      salePrice: num(v.salePrice),
      sortPrice: num(v.sortPrice),
      price: precioPromo !== null ? precioPromo : num(v.salePrice),
      discountPercent: descuento,
      ahorro: (precioLista !== null && precioPromo !== null && precioLista > precioPromo)
        ? Math.round((precioLista - precioPromo) * 100) / 100 : null,
      inStock: v.isOutOfStock !== true,
      seller: mejorOferta ? {
        name: mejorOferta.sellerName || oNulo(v.bestOfferSellerName),
        sellerId: mejorOferta.sellerId,
        sellerSku: mejorOferta.sellerSkuId,
        offerId: mejorOferta.offerId,
        leadTimeToShip: mejorOferta.leadTimeToShip,
        crossBorder: mejorOferta.crossBorder
      } : (v.bestOfferSellerName ? { name: v.bestOfferSellerName } : null),
      ofertas: ofertas,
      totalOfertas: ofertas.length,
      precioMinimoOfertas: v.offers ? num(v.offers.minimumPrice) : null,
      bestPromotion: comoPlan(v.bestPromotion, 'bestPromotion'),
      paymentPlans: planes,
      images: unicos([].concat(
        Array.isArray(v.galleryImages) ? v.galleryImages : [],
        v.largeImage ? [v.largeImage] : [],
        v.thumbnailImage ? [v.thumbnailImage] : []
      )).filter(Boolean),
      stock: {
        agotado: v.isOutOfStock === true,
        agotadoMarketplace: stock.isMkpOutOfStock === true,
        inventarioLimitado: stock.internalInventory === true || stock.marketplaceInventory === true,
        preventa: stock.presaleInventory === true,
        bajoPedido: stock.backorderInventory === true
      },
      // A nivel variante `availableInStores` sí trae existencias por tienda; el
      // del producto solo trae el id, así que no se puede leer igual.
      tiendas: Array.isArray(v.availableInStores)
        ? v.availableInStores.filter(Boolean).map(function (t) {
            return { tienda: oNulo(t.storeId), existencias: num(t.stock) };
          }) : [],
      cuponesLealtad: v.havingLoyaltyCoupons === true,
      vendedorHibrido: v.hasHybridSeller === true,
      esActual: false     // se marca abajo, cuando ya se sabe la variante abierta
    };
  }

  // ===========================================================================
  // 3. Lectura del DOM visible
  // ===========================================================================

  /**
   * Los `data-testid` del artículo principal llevan el SKU general de prefijo
   * (`99991598622-configurator-price`). Los `blt…-product-price-…` son de los
   * carruseles de recomendados: si no se acota por prefijo, se acaba leyendo el
   * precio de OTRO artículo.
   */
  function escaparCss(valor) {
    return String(valor).replace(/["\\]/g, '\\$&');
  }

  /**
   * Calificación. Ojo: en la página conviven DOS números y no son el mismo.
   * El bloque de reseñas trae el promedio real (`2.8`) y el `aria-label` de las
   * estrellas trae ese promedio ya redondeado a media estrella (`2.5`).
   * Mezclarlos es cambiarle la nota al artículo.
   */
  function leerCalificacionDelDom(skuGeneral) {
    var promedio = null, promedioEstrellas = null, conteo = null;

    var bloqueResenas = qs('.product-generalRate h3, section.product-generalRate h3');
    if (bloqueResenas) {
      var n = parseFloat(String(texto(bloqueResenas) || '').replace(',', '.'));
      if (isFinite(n) && n >= 0 && n <= 5) promedio = n;
    }

    var caja = null;
    if (skuGeneral) caja = qs('[data-testid="' + escaparCss(skuGeneral) + '-review-desktop"]');
    if (!caja) caja = qs('[data-testid$="-review-desktop"]') || qs('[data-testid$="-review-mobile"]');

    if (caja) {
      var conEtiqueta = qsa('[aria-label]', caja);
      if (caja.hasAttribute && caja.hasAttribute('aria-label')) conEtiqueta.unshift(caja);
      for (var i = 0; i < conEtiqueta.length; i++) {
        var etiqueta = atributo(conEtiqueta[i], 'aria-label') || '';
        var m = etiqueta.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:stars?|estrellas?)/i);
        if (m) { promedioEstrellas = parseFloat(m[1]); break; }
      }
      var t = texto(caja) || '';
      var mc = t.match(/\((\d+)\)/);
      if (mc) conteo = parseInt(mc[1], 10);
    }

    if (promedio === null && promedioEstrellas === null && conteo === null) return null;
    return { average: promedio, averageEstrellas: promedioEstrellas, count: conteo };
  }

  /**
   * Precios tal y como se ven. Ojo con el rango: cuando no hay variante
   * elegida, la ficha enseña "$14,346.00 - $15,699.00" y la versión anterior
   * se quedaba con el primero, dando por precio del artículo el de la variante
   * más barata.
   */
  function leerPreciosDelDom(skuGeneral) {
    var salida = {
      current: null, original: null, esRango: false,
      minPromo: null, maxPromo: null, minLista: null, maxLista: null,
      textoPantalla: null
    };
    var caja = null;
    if (skuGeneral) caja = qs('[data-testid="' + escaparCss(skuGeneral) + '-configurator-price"]');
    if (!caja) caja = qs('[data-testid$="-configurator-price"]');
    if (caja) salida.textoPantalla = texto(caja);

    // Nunca buscar precios en todo el documento: `.text-price-primary` sale 113
    // veces en la página y casi todas son tarjetas de carruseles de otros
    // artículos. Se acota al configurador o, como mucho, a su contenedor.
    var raizRango = caja || qs('[data-testid$="-configurator"]');
    if (!raizRango) {
      avisar('No se encontró el bloque de precio del artículo; los precios salen del stream, no de la pantalla.');
      return salida;
    }
    var minTachado = qs('[data-testid$="-price-min-price-range"]', raizRango);
    var maxTachado = qs('[data-testid$="-price-max-price-range"]', raizRango);
    if (minTachado && maxTachado) {
      salida.esRango = true;
      salida.minLista = precioDeNodo(minTachado);
      salida.maxLista = precioDeNodo(maxTachado);
    }

    var principal = qs('.text-price-primary', raizRango);
    if (principal) {
      var crudo = texto(principal) || '';
      // Con guion en medio son dos precios: el rango vigente.
      var trozos = crudo.split(/\s[-–—]\s/);
      if (trozos.length >= 2) {
        salida.esRango = true;
        salida.minPromo = aPrecio(trozos[0]);
        salida.maxPromo = aPrecio(trozos[trozos.length - 1]);
        salida.current = salida.minPromo;
      } else {
        salida.current = precioDeNodo(principal) || aPrecio(crudo);
      }
    }

    if (!salida.esRango) {
      var tachado = qs('[data-testid$="-original-prices"] .line-through', raizRango) ||
                    qs('.line-through', raizRango);
      if (tachado) salida.original = precioDeNodo(tachado);
    } else {
      salida.original = salida.minLista;
    }
    return salida;
  }

  /**
   * Lo que el stream no trae: el estado de los selectores.
   *
   * Tres cosas que no se ven a simple vista en este HTML:
   *  - El color elegido NO se marca en el <button>, sino en un hijo (un icono
   *    `…-check` y un `div` con borde). Mirar la clase del botón no sirve.
   *  - El `<summary>` de cada selector dice en claro qué hay elegido
   *    ("Color: TITANO AZUL") o si no hay nada ("Seleccione una opción").
   *  - El grupo de tallas lleva en su testid el SKU de la variante en foco
   *    (`ml-radio-group-size-picker-1188639000`), y las tallas deshabilitadas
   *    lo están PARA ESE COLOR, no en general.
   */
  function leerSeleccionDelDom() {
    var colores = [], tallas = [];
    var colorElegido = null, tallaElegida = null, skuEnFoco = null, faltaElegir = false;

    var desplegables = qsa('details[data-testid*="picker"]');
    for (var d = 0; d < desplegables.length; d++) {
      var resumen = qs('summary', desplegables[d]);
      if (!resumen) continue;
      var etiquetas = qsa('p', resumen);
      if (etiquetas.length < 2) continue;
      var titulo = (texto(etiquetas[0]) || '').toLowerCase();
      var valor = texto(etiquetas[1]);
      if (!valor) continue;
      if (/seleccione|elige|选择/i.test(valor)) { faltaElegir = true; continue; }
      if (titulo.indexOf('color') !== -1) colorElegido = valor;
      else tallaElegida = valor;
    }

    var botonesColor = qsa('[data-testid*="image-picker"] button, [data-testid="ml-image-picker"] button');
    for (var i = 0; i < botonesColor.length; i++) {
      var boton = botonesColor[i];
      var img = qs('img', boton);
      var pie = qs('p', boton);
      var nombre = texto(pie) || atributo(img, 'alt');
      if (!nombre) continue;
      var marcado = atributo(boton, 'aria-checked') === 'true' ||
                    atributo(boton, 'aria-selected') === 'true' ||
                    atributo(boton, 'aria-current') === 'true' ||
                    !!qs('[data-testid$="-check"]', boton) ||
                    !!qs('.border-prim-500, [class*="border-prim"]', boton) ||
                    String(boton.className || '').indexOf('border-prim') !== -1;
      if (!marcado && colorElegido && nombre.toLowerCase() === colorElegido.toLowerCase()) marcado = true;
      colores.push({
        nombre: nombre,
        imagen: atributo(img, 'src'),
        seleccionado: marcado,
        deshabilitado: boton.disabled === true
      });
    }

    var grupoTallas = qs('[data-testid^="ml-radio-group-size-picker-"]');
    if (grupoTallas) {
      var mFoco = String(atributo(grupoTallas, 'data-testid') || '').match(/ml-radio-group-size-picker-(\d+)/);
      if (mFoco) skuEnFoco = mFoco[1];
    }

    var radios = qsa('[data-testid*="size-picker"] input[type="radio"], [data-testid^="ml-radio-group-size-picker"] input[type="radio"]');
    for (var j = 0; j < radios.length; j++) {
      var radio = radios[j];
      var etiqueta = radio.id ? qs('label[for="' + escaparCss(radio.id) + '"]') : null;
      var valorTalla = radio.value || texto(etiqueta);
      tallas.push({
        valor: valorTalla,
        etiqueta: texto(etiqueta) || radio.value,
        seleccionado: radio.checked === true ||
                      (!!tallaElegida && String(valorTalla).toLowerCase() === tallaElegida.toLowerCase()),
        disponible: radio.disabled !== true
      });
    }
    if (!tallas.length) {
      // Variante dibujada con botones en vez de radios.
      var botonesTalla = qsa('[data-testid*="size-picker"] button');
      for (var k = 0; k < botonesTalla.length; k++) {
        var bt = botonesTalla[k], vt = texto(bt);
        if (!vt || vt.length > 24) continue;
        tallas.push({
          valor: vt,
          etiqueta: vt,
          seleccionado: atributo(bt, 'aria-checked') === 'true' || atributo(bt, 'aria-pressed') === 'true' ||
                        (!!tallaElegida && vt.toLowerCase() === tallaElegida.toLowerCase()),
          disponible: bt.disabled !== true
        });
      }
    }

    return {
      colores: colores,
      tallas: tallas,
      colorElegido: colorElegido,
      tallaElegida: tallaElegida,
      skuEnFoco: skuEnFoco,
      faltaElegir: faltaElegir
    };
  }

  /** Especificaciones tal y como se ven, por si el stream no trae ninguna. */
  function leerEspecificacionesDelDom() {
    var salida = [];
    var tablas = qsa('table');
    for (var i = 0; i < tablas.length; i++) {
      var filas = qsa('tr', tablas[i]);
      for (var f = 0; f < filas.length; f++) {
        var th = qs('th', filas[f]), td = qs('td', filas[f]);
        if (th && td) salida.push({ label: texto(th), value: texto(td), section: null });
      }
    }
    var listas = qsa('dl');
    for (var d = 0; d < listas.length; d++) {
      var dts = qsa('dt', listas[d]), dds = qsa('dd', listas[d]);
      for (var n = 0; n < dts.length; n++) {
        if (dds[n]) salida.push({ label: texto(dts[n]), value: texto(dds[n]), section: null });
      }
    }
    return salida.filter(function (s) { return s.label && s.value; });
  }

  /**
   * Barrido del DOM visible. Es la red de seguridad del inspector: si Liverpool
   * cambia el stream o mete un dato nuevo en pantalla, aquí aparece aunque
   * ninguna sección lo esté buscando por nombre.
   */
  function barrerDom(skuGeneral) {
    var TOPE_BLOQUES = 400, TOPE_TEXTO = 400;
    var bloques = [], pares = [], vistos = {};

    var conTestid = qsa('[data-testid]');
    for (var i = 0; i < conTestid.length && bloques.length < TOPE_BLOQUES; i++) {
      var nodo = conTestid[i];
      var id = atributo(nodo, 'data-testid') || '';
      // Fuera los carruseles de recomendados: son otros artículos.
      if (/^blt[0-9a-f]+/i.test(id)) continue;
      if (skuGeneral && id.indexOf(skuGeneral) === -1 &&
          !/mkp|offer|price|seller|delivery|stock|spec|review|breadcrumb|gallery|picker|buy|add-to-bag|warranty/i.test(id)) continue;
      var t = texto(nodo);
      if (!t || t.length > TOPE_TEXTO) continue;
      bloques.push({ testid: id, texto: t });
    }

    // "Etiqueta: valor" en una misma línea — así aparece el código de producto.
    var hojas = qsa('p, li, span');
    for (var p = 0; p < hojas.length && pares.length < TOPE_BLOQUES; p++) {
      if (!esHoja(hojas[p])) continue;
      var linea = texto(hojas[p]);
      if (!linea || linea.length > 160) continue;
      var m = linea.match(/^([^:]{3,60}):\s*(.+)$/);
      if (!m || m[2].length > 120) continue;
      var clave = m[1].trim() + '=' + m[2].trim();
      if (vistos[clave]) continue;
      vistos[clave] = true;
      pares.push({ label: m[1].trim(), value: m[2].trim() });
    }

    return { bloques: bloques, pares: pares };
  }

  // ===========================================================================
  // 4. Armado del resultado
  // ===========================================================================
  var urlActual = '';
  try { urlActual = window.location.href; } catch (e) { urlActual = ''; }

  var canonica = atributo(qs('link[rel="canonical"]'), 'href') ||
                 atributo(qs('meta[property="og:url"]'), 'content') || null;

  // En una página guardada la URL es file://; entonces manda la canónica, que es
  // la que lleva el SKU general de verdad.
  var urlParaSku = (/^https?:/i.test(urlActual) && /liverpool/i.test(urlActual)) ? urlActual : (canonica || urlActual);

  var slug = null, skuGeneral = null, skuVariante = null;
  try {
    var u = new URL(urlParaSku, 'https://www.liverpool.com.mx');
    var partes = u.pathname.split('/');
    var iPdp = partes.indexOf('pdp');
    if (iPdp !== -1 && partes.length > iPdp + 2) {
      slug = partes[iPdp + 1] || null;
      // En /pdp/<slug>/<id>?skuid=<sku>, el id del path es el SKU general
      // (padre) y `skuid` es el de la variante.
      skuGeneral = partes[iPdp + 2] || null;
    }
    var uAbierta = new URL(urlActual || urlParaSku, 'https://www.liverpool.com.mx');
    skuVariante = uAbierta.searchParams.get('skuid') || null;
  } catch (e) { /* URL rara: se resuelve abajo con el stream */ }

  var esFichaProducto = /\/pdp\//.test(urlParaSku || '') || !!qs('[data-testid$="-configurator"]');

  var resultado = {
    extractedAt: new Date().toISOString(),
    url: urlActual || canonica,
    urlCanonica: canonica,
    isProductPage: esFichaProducto,
    fuentes: {
      flightData: false, chunksFlight: 0, nodoPdp: false,
      jsonLd: false, dom: true, refsSinResolver: []
    },
    product: {
      name: null, brand: null, brandId: null, productType: null,
      skuGeneral: skuGeneral, skuVariante: skuVariante, slug: slug,
      productCode: null, url: canonica,
      description: null, descriptionMeta: null,
      prices: {
        current: null, original: null, currency: 'MXN',
        discountPercent: null, savings: null,
        esRango: false, minPromo: null, maxPromo: null,
        minLista: null, maxLista: null, textoPantalla: null
      },
      images: [], colors: [], sizes: [], variants: [],
      // `skuVariante` es SOLO el `skuid` de la URL. `varianteActual` es la
      // variante que la ficha está mostrando, que puede deducirse aunque la URL
      // no traiga skuid. No se mezclan: confundirlas es lo que hacía que el
      // inspector jurara que había una variante elegida cuando la ficha seguía
      // enseñando un rango de precios.
      varianteActual: null,
      skuTarjetaVendedor: null,
      seleccion: { color: null, talla: null, completa: false },
      seller: { name: null, isMarketplace: false, sellerId: null, sellerSku: null, offerId: null, url: null },
      ofertas: [],
      category: { breadcrumbs: [], enlaces: [], department: null, productType: null, categorias: [] },
      rating: { average: null, averageEstrellas: null, redondeado: false, count: null, source: null },
      cadena: null,
      specifications: [], specSections: [],
      availability: {
        inStock: false, buyButtonEnabled: false, deliveryEstimate: null,
        limitedStock: null, tiendas: [], hasClickAndCollect: false, hasHomeDelivery: false
      },
      paymentPlans: [], promotions: [],
      politicas: { garantia: null, liverpoolCare: null, documentos: [], avisos: {} },
      identifiers: { productId: null, gtin: null, mpn: null, sellerSkuId: null },
      flags: {},
      meta: {},
      dom: { bloques: [], pares: [] },
      rawFlightData: null
    },
    warnings: avisos
  };
  var P = resultado.product;

  // --- 4.1 Metadatos de la cabecera ---------------------------------------
  try {
    var metas = qsa('meta');
    for (var mi = 0; mi < metas.length; mi++) {
      var nombreMeta = atributo(metas[mi], 'name') || atributo(metas[mi], 'property');
      var contenido = atributo(metas[mi], 'content');
      if (!nombreMeta || !contenido) continue;
      if (/^(og:|twitter:|product:|description$|keywords$)/.test(nombreMeta)) P.meta[nombreMeta] = contenido;
    }
    P.descriptionMeta = P.meta['description'] || P.meta['og:description'] || null;
  } catch (e) { avisar('No se pudieron leer los meta tags: ' + e.message); }

  // --- 4.2 El stream ------------------------------------------------------
  var nodoPdp = null;
  try {
    var stream = reunirTextoDelStream();
    if (stream) {
      resultado.fuentes.flightData = true;
      var chunks = trocearStream(stream);
      resultado.fuentes.chunksFlight = Object.keys(chunks).length;
      var resolver = crearResolutor(chunks);
      nodoPdp = localizarNodoPdp(chunks, resolver);
      if (nodoPdp) {
        resultado.fuentes.nodoPdp = true;
        resultado.fuentes.refsSinResolver = Object.keys(resolver.sinResolver).slice(0, 20);
        if (resolver.agotado()) avisar('El stream era enorme y se cortó la resolución; puede faltar algún dato.');
      } else {
        avisar('Se leyó el stream de Next.js pero no se encontró el bloque del producto.');
      }
    } else {
      avisar('Esta página no trae el stream de Next.js; solo se pudo leer lo visible.');
    }
  } catch (e) {
    avisar('Falló la lectura del stream de Next.js: ' + e.message);
  }

  var prod = (nodoPdp && esObjeto(nodoPdp.product)) ? nodoPdp.product : null;

  if (prod) {
    try {
      P.name = oNulo(prod.title) || P.name;
      P.brand = oNulo(prod.brand);
      P.brandId = oNulo(prod.brandId);
      P.productType = oNulo(prod.productType);
      P.description = despegarFrases(oNulo(prod.productDescription));
      P.identifiers.productId = oNulo(prod.id);
      if (!P.skuGeneral) P.skuGeneral = oNulo(prod.id);

      // Precios del catálogo: el rango real de todas las variantes.
      P.prices.minLista = num(prod.minimumListPrice);
      P.prices.maxLista = num(prod.maximumListPrice);
      P.prices.minPromo = num(prod.minimumPromoPrice);
      P.prices.maxPromo = num(prod.maximumPromoPrice);
      P.prices.esRango = P.prices.minPromo !== null && P.prices.maxPromo !== null &&
                         P.prices.minPromo !== P.prices.maxPromo;

      // Colores: el stream trae el SKU de cada color, que es lo que la página
      // nunca enseña. `colorSet` es el catálogo completo y `offerColorSet` lo
      // que de verdad tiene oferta; aquí venían iguales, pero cuando no lo son
      // hay colores que se ven y no se pueden comprar.
      var conOfertaColor = {};
      if (Array.isArray(prod.offerColorSet)) {
        for (var oc = 0; oc < prod.offerColorSet.length; oc++) {
          var refC = prod.offerColorSet[oc] || {};
          if (refC.sku) conOfertaColor[refC.sku] = true;
        }
      }
      var setColores = (Array.isArray(prod.colorSet) && prod.colorSet.length) ? prod.colorSet : prod.offerColorSet;
      if (Array.isArray(setColores)) {
        for (var ci = 0; ci < setColores.length; ci++) {
          var col = setColores[ci] || {};
          P.colors.push({
            name: oNulo(col.colorName),
            hex: oNulo(col.colorHex),
            sku: oNulo(col.sku),
            imageUrl: oNulo(col.thumbnailImage) || oNulo(col.smallImage) || oNulo(col.colorImage),
            largeImage: oNulo(col.largeImage),
            selected: false,
            available: true,
            conOferta: col.sku ? conOfertaColor[col.sku] === true : null
          });
        }
      }

      var conOfertaTalla = {};
      if (Array.isArray(prod.offerSizeSet)) {
        for (var ot = 0; ot < prod.offerSizeSet.length; ot++) {
          var refT = prod.offerSizeSet[ot] || {};
          if (refT.size) conOfertaTalla[refT.size] = true;
        }
      }
      var setTallas = (Array.isArray(prod.sizeSet) && prod.sizeSet.length) ? prod.sizeSet : prod.offerSizeSet;
      if (Array.isArray(setTallas)) {
        for (var si = 0; si < setTallas.length; si++) {
          var tal = setTallas[si] || {};
          P.sizes.push({
            value: oNulo(tal.size),
            label: oNulo(tal.size),
            normalized: oNulo(tal.normalizedSize),
            selected: false,
            available: true,
            conOferta: tal.size ? conOfertaTalla[tal.size] === true : null
          });
        }
      }

      if (Array.isArray(prod.variants)) {
        for (var vi = 0; vi < prod.variants.length; vi++) {
          var vv = comoVariante(prod.variants[vi]);
          if (vv) P.variants.push(vv);
        }
      }

      // Características: los pares atributo/valor, agrupados por sección.
      if (Array.isArray(prod.dynamicAttributes)) {
        var porSeccion = {}, orden = [];
        for (var ai = 0; ai < prod.dynamicAttributes.length; ai++) {
          var at = prod.dynamicAttributes[ai] || {};
          if (esNada(at.attribute) && esNada(at.value)) continue;
          var fila = { label: oNulo(at.attribute), value: oNulo(at.value), section: oNulo(at.section) };
          P.specifications.push(fila);
          var sec = fila.section || 'Otros';
          if (!porSeccion[sec]) { porSeccion[sec] = []; orden.push(sec); }
          porSeccion[sec].push({ label: fila.label, value: fila.value });
        }
        for (var oi = 0; oi < orden.length; oi++) {
          P.specSections.push({ section: orden[oi], items: porSeccion[orden[oi]] });
        }
      }

      // Clasificación
      if (Array.isArray(prod.categoryBreadCrumbs)) {
        for (var bi = 0; bi < prod.categoryBreadCrumbs.length; bi++) {
          var bc = prod.categoryBreadCrumbs[bi] || {};
          if (bc.categoryName) {
            P.category.breadcrumbs.push(bc.categoryName);
            P.category.enlaces.push({ nombre: bc.categoryName, id: oNulo(bc.categoryId), url: null });
          }
        }
      }
      if (Array.isArray(prod.categories)) {
        for (var cgi = 0; cgi < prod.categories.length; cgi++) {
          var cg = prod.categories[cgi] || {};
          P.category.categorias.push({
            id: oNulo(cg.id),
            hoja: oNulo(cg.leaf),
            ruta: Array.isArray(cg.labels) ? cg.labels.join(' > ') : null
          });
        }
      }
      P.category.productType = P.productType;

      if (esObjeto(prod.ratingInfo)) {
        var pa = num(prod.ratingInfo.average), pc = num(prod.ratingInfo.count);
        if (pa !== null || pc !== null) {
          P.rating.average = pa;
          P.rating.count = pc;
          P.rating.source = 'flight';
        }
      }

      // Imágenes: galería del producto + la de cada variante.
      var imagenes = [];
      if (prod.largeImage) imagenes.push({ url: prod.largeImage, type: 'principal', alt: P.name || '' });
      if (Array.isArray(prod.productImages)) {
        for (var ii = 0; ii < prod.productImages.length; ii++) {
          var im = prod.productImages[ii] || {};
          if (im.imageUrl) imagenes.push({ url: im.imageUrl, type: 'producto', alt: P.name || '' });
        }
      }
      for (var vg = 0; vg < P.variants.length; vg++) {
        for (var gi = 0; gi < P.variants[vg].images.length; gi++) {
          imagenes.push({
            url: P.variants[vg].images[gi],
            type: 'variante ' + (P.variants[vg].sku || ''),
            alt: P.variants[vg].name || ''
          });
        }
      }
      var urlsVistas = {};
      for (var fi = 0; fi < imagenes.length; fi++) {
        if (!imagenes[fi].url || urlsVistas[imagenes[fi].url]) continue;
        urlsVistas[imagenes[fi].url] = true;
        P.images.push(imagenes[fi]);
      }

      // Disponibilidad y entrega
      P.availability.inStock = prod.inventoryStatus === true;
      P.availability.tiendas = Array.isArray(prod.availableInStores)
        ? prod.availableInStores.map(function (t) { return t && t.storeId; }).filter(Boolean) : [];
      var expres = prod.expressDeliveryData || {};
      P.availability.hasClickAndCollect = expres.hasClickAndCollect === true;
      P.availability.hasHomeDelivery = expres.hasHomeDelivery === true;
      if (expres.marketplaceDeliveryLabel) P.availability.deliveryEstimate = expres.marketplaceDeliveryLabel;

      P.flags = {
        esMarketplace: prod.isMarketPlace === true,
        esColeccion: prod.isCollection === true,
        esMesaDeRegalos: prod.isGiftRegistryProduct === true,
        tieneGarantias: prod.hasWarranties === true,
        tieneServiciosConfort: prod.hasComfortServices === true,
        tieneProteccionCelular: prod.hasCellularProtection === true,
        tieneRegaloPromocional: prod.hasPromotionalGift === true,
        mensajeRegalo: oNulo(prod.promotionalGiftMessage),
        tallaDeRopa: prod.isClothesSize === true,
        truefit: prod.truefit === true,
        guiaDeTallas: oNulo(prod.sizeGuide),
        promocionales: (prod.flags && prod.flags.promotionFlags) || [],
        atributos: (prod.flags && prod.flags.attributeFlags) || []
      };
      P.seller.isMarketplace = prod.isMarketPlace === true;

      // El objeto crudo se guarda entero: es el respaldo cuando algo no se pintó.
      P.rawFlightData = prod;
    } catch (e) {
      avisar('El bloque del producto vino con una forma inesperada: ' + e.message);
    }

    // Políticas, garantía y avisos legales viven FUERA de `product`.
    try {
      // `brandId` de la raíz es la CADENA (LP = Liverpool, SUB = Suburbia);
      // `product.brandId` es la marca del artículo. Nombres iguales, cosas
      // distintas: se guardan por separado a propósito.
      P.cadena = oNulo(nodoPdp.brandId);
      P.politicas.garantia = oNulo(nodoPdp.warrantyPolicyDetails);
      P.politicas.liverpoolCare = oNulo(nodoPdp.liverpoolCarePolicyDetails);
      if (esObjeto(nodoPdp.tooltipsContent)) P.politicas.avisos = nodoPdp.tooltipsContent;
      var specs = nodoPdp.productSpecs || {};
      if (specs.policies) {
        // Cada política es un elemento de React: ["$","$L4d2",null,{content:"<p>…"}]
        var pila = [specs.policies], vueltas = 0;
        while (pila.length && P.politicas.documentos.length < 12 && vueltas++ < 5000) {
          var actual = pila.pop();
          if (!actual || typeof actual !== 'object') continue;
          if (esObjeto(actual) && typeof actual.content === 'string' && actual.content.length > 40) {
            P.politicas.documentos.push({ titulo: oNulo(actual.title), html: actual.content });
            continue;
          }
          for (var pk in actual) {
            if (Object.prototype.hasOwnProperty.call(actual, pk)) pila.push(actual[pk]);
          }
        }
      }
    } catch (e) { avisar('No se pudieron leer las políticas: ' + e.message); }
  }

  // --- 4.3 Datos estructurados (JSON-LD), si los hay -----------------------
  try {
    var guiones = qsa('script[type="application/ld+json"]');
    for (var li = 0; li < guiones.length; li++) {
      var datos;
      try { datos = JSON.parse(guiones[li].textContent); } catch (e) { continue; }
      resultado.fuentes.jsonLd = true;
      var elementos = Array.isArray(datos) ? datos : [datos];
      for (var ei = 0; ei < elementos.length; ei++) {
        var grafo = (elementos[ei] && elementos[ei]['@graph']) ? elementos[ei]['@graph'] : [elementos[ei]];
        for (var gi2 = 0; gi2 < grafo.length; gi2++) {
          var nodoLd = grafo[gi2] || {};
          if (nodoLd['@type'] !== 'Product') continue;
          if (!P.name) P.name = oNulo(nodoLd.name);
          if (!P.description) P.description = oNulo(nodoLd.description);
          if (!P.skuGeneral) P.skuGeneral = oNulo(nodoLd.sku);
          if (!P.identifiers.mpn) P.identifiers.mpn = oNulo(nodoLd.mpn);
          if (!P.identifiers.gtin) P.identifiers.gtin = oNulo(nodoLd.gtin) || oNulo(nodoLd.gtin13) || oNulo(nodoLd.gtin14);
          if (!P.brand && nodoLd.brand) P.brand = typeof nodoLd.brand === 'string' ? nodoLd.brand : oNulo(nodoLd.brand.name);
          if (nodoLd.aggregateRating && P.rating.average === null) {
            P.rating = {
              average: num(nodoLd.aggregateRating.ratingValue),
              count: num(nodoLd.aggregateRating.reviewCount) || num(nodoLd.aggregateRating.ratingCount),
              source: 'jsonld'
            };
          }
          var oferta = Array.isArray(nodoLd.offers) ? nodoLd.offers[0] : nodoLd.offers;
          if (oferta) {
            if (P.prices.current === null) P.prices.current = num(oferta.price);
            if (oferta.priceCurrency) P.prices.currency = oferta.priceCurrency;
            if (oferta.availability && !P.availability.inStock) {
              P.availability.inStock = String(oferta.availability).indexOf('InStock') !== -1;
            }
          }
        }
      }
    }
  } catch (e) { avisar('Error leyendo los datos estructurados: ' + e.message); }

  // --- 4.4 DOM visible ----------------------------------------------------
  try {
    if (!P.name) {
      var h1 = qs('h1');
      P.name = texto(h1) || (document.title || '').split('|')[0].trim() || null;
      if (!h1) avisar('No hay <h1> en la página; el nombre salió del título del documento.');
    }
    if (!P.brand) {
      P.brand = texto(qs('[data-testid$="-brand-link"] span')) || texto(qs('[data-testid$="-brand-link"]'));
    }

    var hojasTexto = qsa('p, span, div');

    // Código de producto visible (que en Liverpool es el SKU general).
    for (var ti = 0; ti < hojasTexto.length; ti++) {
      if (!esHoja(hojasTexto[ti])) continue;
      var linea = texto(hojasTexto[ti]) || '';
      var mCod = linea.match(/c[oó]digo de producto\s*:?\s*([0-9A-Za-z-]+)/i);
      if (mCod) { P.productCode = mCod[1]; break; }
    }
    if (!P.productCode && P.skuGeneral) P.productCode = P.skuGeneral;
    if (!P.skuGeneral && P.productCode) P.skuGeneral = P.productCode;

    // Precios de pantalla: mandan sobre el catálogo porque son los que ve quien compra.
    var preciosDom = leerPreciosDelDom(P.skuGeneral);
    P.prices.textoPantalla = preciosDom.textoPantalla;
    if (preciosDom.esRango) {
      P.prices.esRango = true;
      if (preciosDom.minPromo !== null) P.prices.minPromo = preciosDom.minPromo;
      if (preciosDom.maxPromo !== null) P.prices.maxPromo = preciosDom.maxPromo;
      if (preciosDom.minLista !== null) P.prices.minLista = preciosDom.minLista;
      if (preciosDom.maxLista !== null) P.prices.maxLista = preciosDom.maxLista;
    }
    if (preciosDom.current !== null) P.prices.current = preciosDom.current;
    if (preciosDom.original !== null) P.prices.original = preciosDom.original;

    // Calificación: el stream la trae vacía casi siempre, la pantalla no.
    var calif = leerCalificacionDelDom(P.skuGeneral);
    if (calif) {
      var tocado = false;
      if (P.rating.average === null && calif.average !== null) { P.rating.average = calif.average; tocado = true; }
      if (P.rating.average === null && calif.averageEstrellas !== null) {
        // Sin el promedio exacto, se usa el de las estrellas y se dice que es redondeado.
        P.rating.average = calif.averageEstrellas;
        P.rating.redondeado = true;
        tocado = true;
      }
      if (calif.averageEstrellas !== null) P.rating.averageEstrellas = calif.averageEstrellas;
      if (P.rating.count === null && calif.count !== null) { P.rating.count = calif.count; tocado = true; }
      if (tocado) P.rating.source = P.rating.source ? P.rating.source + '+dom' : 'dom';
    }

    // Estado de los selectores.
    var seleccion = leerSeleccionDelDom();
    P.seleccion.color = seleccion.colorElegido;
    P.seleccion.talla = seleccion.tallaElegida;
    P.seleccion.completa = !seleccion.faltaElegir && !P.prices.esRango;
    var skuEnFoco = seleccion.skuEnFoco;
    for (var sc = 0; sc < seleccion.colores.length; sc++) {
      var elegido = seleccion.colores[sc];
      var encontrado = false;
      for (var pc = 0; pc < P.colors.length; pc++) {
        var nombreA = String(P.colors[pc].name || '').toLowerCase();
        var nombreB = String(elegido.nombre || '').toLowerCase();
        if (nombreA && nombreB && (nombreA === nombreB || nombreA.indexOf(nombreB) !== -1 || nombreB.indexOf(nombreA) !== -1)) {
          if (elegido.seleccionado) P.colors[pc].selected = true;
          if (elegido.deshabilitado) P.colors[pc].available = false;
          if (!P.colors[pc].imageUrl) P.colors[pc].imageUrl = elegido.imagen;
          encontrado = true;
          break;
        }
      }
      if (!encontrado) {
        P.colors.push({
          name: elegido.nombre, hex: null, sku: null, imageUrl: elegido.imagen,
          largeImage: null, selected: elegido.seleccionado, available: !elegido.deshabilitado
        });
      }
    }
    for (var st = 0; st < seleccion.tallas.length; st++) {
      var tallaDom = seleccion.tallas[st];
      var hallada = false;
      for (var pt = 0; pt < P.sizes.length; pt++) {
        if (String(P.sizes[pt].value || '').toLowerCase() === String(tallaDom.valor || '').toLowerCase()) {
          P.sizes[pt].selected = tallaDom.seleccionado;
          P.sizes[pt].available = tallaDom.disponible;
          hallada = true;
          break;
        }
      }
      if (!hallada && tallaDom.valor) {
        P.sizes.push({
          value: tallaDom.valor, label: tallaDom.etiqueta, normalized: null,
          selected: tallaDom.seleccionado, available: tallaDom.disponible
        });
      }
    }

    // Migas de pan visibles, si el stream no las trajo.
    if (!P.category.breadcrumbs.length) {
      var migas = qsa('[data-testid$="-breadcrumb"] li a, nav[aria-label*="readcrumb"] li a');
      for (var mgi = 0; mgi < migas.length; mgi++) {
        var nombreMiga = texto(migas[mgi]);
        if (nombreMiga) {
          P.category.breadcrumbs.push(nombreMiga);
          P.category.enlaces.push({ nombre: nombreMiga, id: null, url: atributo(migas[mgi], 'href') });
        }
      }
    }
    if (P.category.breadcrumbs.length) {
      P.category.department = P.category.breadcrumbs[0];
      if (!P.category.productType) P.category.productType = P.category.breadcrumbs[P.category.breadcrumbs.length - 1];
    }

    // Vendedor: la tarjeta de marketplace es la única que da el enlace real.
    var enlaceVendedor = qs('[data-testid$="-mkp-seller-link"]');
    if (enlaceVendedor) {
      P.seller.name = texto(enlaceVendedor) || atributo(enlaceVendedor, 'aria-label');
      P.seller.isMarketplace = true;
      P.seller.url = atributo(enlaceVendedor, 'href');
      // El testid de esa tarjeta lleva el SKU de la variante que se está viendo.
      // Se guarda aparte: es una pista, no una selección del comprador.
      var mSku = String(atributo(enlaceVendedor, 'data-testid') || '').match(/^(\d+)-/);
      if (mSku) P.skuTarjetaVendedor = mSku[1];
    }
    if (!P.seller.name) {
      for (var vi2 = 0; vi2 < hojasTexto.length; vi2++) {
        if (!esHoja(hojasTexto[vi2])) continue;
        var lineaV = texto(hojasTexto[vi2]) || '';
        var mv = lineaV.match(/^vendido por:?\s*(.+)$/i);
        if (mv && mv[1].length < 60) {
          P.seller.name = mv[1].trim();
          P.seller.isMarketplace = P.seller.name.toLowerCase() !== 'liverpool';
          break;
        }
      }
    }
    if (!P.seller.name) { P.seller.name = 'Liverpool'; P.seller.isMarketplace = false; }

    // Botón de compra.
    var botonComprar = qs('[data-testid="buy-now-button"], [data-testid="add-to-bag-button"]');
    P.availability.buyButtonEnabled = !!(botonComprar && !botonComprar.disabled);
    if (!P.availability.inStock) P.availability.inStock = P.availability.buyButtonEnabled;

    // Envío y entrega, tal y como los anuncia la ficha.
    var envioAnotado = false;
    for (var di = 0; di < hojasTexto.length; di++) {
      if (!esHoja(hojasTexto[di])) continue;
      var lineaD = texto(hojasTexto[di]) || '';
      if (!lineaD || lineaD.length > 120) continue;
      // "Envío gratis" sale varias veces en la ficha (etiqueta corta arriba y
      // frase larga abajo); se queda solo la primera para no inflar la lista.
      if (/env[ií]o gratis/i.test(lineaD) && !envioAnotado) {
        envioAnotado = true;
        P.promotions.push({ tipo: 'envío', descripcion: lineaD, codigo: null, meses: null, mensualidad: null, sku: null, origen: 'dom' });
      }
      if (!P.availability.deliveryEstimate && /(recibe|llega|entrega)\s+(el|entre|a partir)/i.test(lineaD)) {
        P.availability.deliveryEstimate = lineaD;
      }
    }

    // Imágenes visibles, por si el stream no trajo galería.
    if (!P.images.length) {
      var principalImg = qs('figure[data-testid$="gallery__main__image"] img') || qs('main img');
      if (principalImg && atributo(principalImg, 'src')) {
        P.images.push({ url: atributo(principalImg, 'src'), type: 'principal', alt: atributo(principalImg, 'alt') || '' });
      }
      var miniaturas = qsa('button[data-testid*="thumbnail"] img');
      for (var mi2 = 0; mi2 < miniaturas.length; mi2++) {
        var srcMini = atributo(miniaturas[mi2], 'src');
        if (!srcMini) continue;
        P.images.push({ url: srcMini.replace('/sm/', '/xl/'), type: 'miniatura', alt: atributo(miniaturas[mi2], 'alt') || '' });
      }
    }

    // Especificaciones visibles, solo si el stream no trajo ninguna.
    if (!P.specifications.length) {
      var specsDom = leerEspecificacionesDelDom();
      if (specsDom.length) {
        P.specifications = specsDom;
        P.specSections = [{ section: 'Especificaciones (de la página)', items: specsDom }];
        avisar('Las características salieron del DOM: el stream de Next.js no traía ninguna.');
      }
    }

    if (!P.description) P.description = P.descriptionMeta;

    P.dom = barrerDom(P.skuGeneral);
  } catch (e) {
    avisar('Error leyendo el DOM visible: ' + e.message);
  }

  // --- 4.5 Variante abierta, precios y planes -----------------------------
  try {
    // ¿Cuál de las variantes es la que está en pantalla? De la pista más firme
    // a la más floja: el skuid de la URL, el SKU con el que Liverpool arma el
    // grupo de tallas, el color marcado, la tarjeta del vendedor, y por último
    // el caso trivial de un artículo con una sola variante.
    function variantePorSku(sku) {
      if (!sku) return null;
      for (var n = 0; n < P.variants.length; n++) {
        if (P.variants[n].sku === sku) return P.variants[n];
      }
      return null;
    }
    var colorMarcado = null;
    for (var ce = 0; ce < P.colors.length; ce++) if (P.colors[ce].selected) colorMarcado = P.colors[ce];

    var actual = variantePorSku(P.skuVariante) ||
                 variantePorSku(skuEnFoco || null) ||
                 variantePorSku(colorMarcado && colorMarcado.sku) ||
                 variantePorSku(P.skuTarjetaVendedor) ||
                 (P.variants.length === 1 ? P.variants[0] : null);

    if (actual) {
      actual.esActual = true;
      P.varianteActual = actual.sku;
      // Si el color no venía marcado en el DOM, se marca el de la variante en foco.
      if (!colorMarcado) {
        for (var cm = 0; cm < P.colors.length; cm++) {
          if (P.colors[cm].sku && P.colors[cm].sku === actual.sku) P.colors[cm].selected = true;
        }
      }
      if (!P.prices.esRango) {
        if (P.prices.current === null) P.prices.current = actual.price;
        if (P.prices.original === null) P.prices.original = actual.listPrice;
      }
      P.paymentPlans = agruparPlanes(actual.paymentPlans);
      P.ofertas = actual.ofertas.slice();
      if (actual.seller) {
        if (!P.seller.name) P.seller.name = actual.seller.name;
        P.seller.sellerId = P.seller.sellerId || actual.seller.sellerId || null;
        P.seller.sellerSku = P.seller.sellerSku || actual.seller.sellerSku || null;
        P.seller.offerId = P.seller.offerId || actual.seller.offerId || null;
        P.identifiers.sellerSkuId = actual.seller.sellerSku || null;
      }
      if (actual.stock) P.availability.limitedStock = actual.stock;
    } else if (P.variants.length) {
      // Sin variante elegida la ficha enseña un rango; los meses que se ven en
      // pantalla son los de la variante más barata, así que se dice de dónde
      // salieron en vez de hacerlos pasar por los del artículo.
      var masBarata = null;
      for (var mb = 0; mb < P.variants.length; mb++) {
        var candidata = P.variants[mb];
        if (candidata.price === null) continue;
        if (masBarata === null || candidata.price < masBarata.price) masBarata = candidata;
      }
      if (masBarata) {
        P.paymentPlans = agruparPlanes(masBarata.paymentPlans);
        P.ofertas = masBarata.ofertas.slice();
        avisar('No hay variante seleccionada: los planes de pago mostrados son los de la variante más barata (SKU ' + masBarata.sku + ').');
      }
    }

    // Todas las promociones de todas las variantes, agrupadas.
    //
    // El mismo plan viene repetido en varias cubetas del stream (un 3 MSI sale a
    // la vez en `liverpoolEMI` y en `other`). Antes la clave incluía la cubeta,
    // así que el plan salía dos veces en la lista y parecía que había el doble de
    // promociones de las que hay. Ahora la cubeta es un dato del plan, no parte
    // de su identidad.
    for (var pv = 0; pv < P.variants.length; pv++) {
      var planesV = agruparPlanes(P.variants[pv].paymentPlans);
      for (var pj = 0; pj < planesV.length; pj++) {
        var plan = planesV[pj];
        P.promotions.push({
          tipo: plan.noInterest ? 'msi' : (plan.months > 0 ? 'pagos' : 'pago único'),
          descripcion: plan.description,
          codigo: plan.promoCode,
          meses: plan.months,
          mensualidad: plan.monthlyPayment,
          sku: P.variants[pv].sku,
          origen: plan.origen,
          origenes: plan.origenes
        });
      }
    }

    // Un rango de precios en pantalla significa que falta elegir algo. Decirlo
    // aquí evita que "precio actual" se lea como el precio del artículo cuando
    // en realidad es el de la variante más barata.
    if (P.prices.esRango) {
      avisar('La ficha enseña un RANGO de precios (' +
        (P.prices.minPromo !== null ? '$' + P.prices.minPromo : '?') + ' a ' +
        (P.prices.maxPromo !== null ? '$' + P.prices.maxPromo : '?') +
        ') porque todavía no hay una variante elegida del todo. El precio exacto de cada una está en la tabla de variantes.');
    }

    // Descuento y ahorro, con los precios que hayan quedado.
    if (P.prices.current !== null && P.prices.original !== null && P.prices.original > P.prices.current) {
      P.prices.savings = Math.round((P.prices.original - P.prices.current) * 100) / 100;
      P.prices.discountPercent = Math.round((P.prices.savings / P.prices.original) * 100);
    }
  } catch (e) {
    avisar('Error armando la variante seleccionada: ' + e.message);
  }

  if (!P.url) P.url = canonica || resultado.url;
  if (!P.variants.length && resultado.fuentes.nodoPdp) {
    avisar('El bloque del producto no traía variantes: puede ser un artículo sin color ni talla.');
  }

  return resultado;
}
