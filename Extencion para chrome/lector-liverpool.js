/**
 * =============================================================================
 * Ventel · Vende más — lo que Liverpool trae y no pinta (lector-liverpool.js)
 * =============================================================================
 * Desde la 3.0 la tarjeta no se queda con lo que se ve en las tarjetas de producto
 * (marca, nombre y precio): lee también lo que la página ya trae en su stream de
 * Next.js y no enseña. Medido el 04/10/2026 (documento 18):
 *   · en la FICHA, los carruseles («Jewel | Log in | Complementa con»…) traen de
 *     cada producto su calificación, cuántas opiniones tiene y si lo vende
 *     Liverpool o un vendedor de marketplace;
 *   · en la BÚSQUEDA (/tienda?s=…), `records` trae lo mismo, más si el resultado
 *     es patrocinado y si hay existencia en línea;
 *   · en la BOLSA (/tienda/cart), `lineItems` trae qué artículos hay y cuándo se
 *     agregó cada uno.
 * Con eso el núcleo elige, entre los parecidos, el que tiene respaldo de otros
 * clientes, y sabe qué equipo lleva ya el cliente.
 *
 * Tres cosas que no se ven leyendo el código:
 *   · El stream NO es JSON: son trozos de texto dentro de `self.__next_f.push(
 *     [1,"…"])` que hay que unir EN ORDEN (un objeto puede quedar partido entre
 *     dos). Aquí no se resuelve el grafo entero, como hace el inspector: se busca
 *     la clave que interesa («"products":[», «"records":[», «"lineItems":[») y se
 *     recorta su arreglo. Bastan unos milisegundos.
 *   · El título de un carrusel cambia con la sesión («Jewel | Guest | …», «Jewel |
 *     Log in | …», «Jewel | Login in | PDP Vistos…»): se reconoce por cómo TERMINA.
 *   · De la bolsa se toma SOLO la lista de artículos. El mismo objeto trae la
 *     dirección y el pago del cliente: no se leen, no se guardan, no salen de aquí.
 *
 * Sin DOM ni chrome.*: recibe texto y devuelve datos, para probarlo en Node con
 * páginas reales (pruebas/ext_lector.test.js).
 *
 * Hecho para Ventel · v1.0 · 04/10/2026
 */
(function (raiz) {
  'use strict';

  var MARCA_PUSH = 'self.__next_f.push(';

  /**
   * El texto de cada `self.__next_f.push( … )`, balanceando paréntesis y
   * respetando las comillas (la misma técnica del inspector: una expresión
   * regular no sirve, los trozos traen paréntesis y comillas escapadas).
   */
  function argumentosDePush(codigo) {
    var salida = [], desde = 0;
    while (true) {
      var donde = codigo.indexOf(MARCA_PUSH, desde);
      if (donde === -1) break;
      var i = donde + MARCA_PUSH.length, inicio = i, nivel = 1, comilla = null, escape = false;
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

  /**
   * El stream de una página, ya unido. `codigo` es el HTML entero de una página
   * bajada (una búsqueda, la bolsa) o el texto de los <script> de la ficha abierta.
   */
  function streamDe(codigo) {
    codigo = String(codigo == null ? '' : codigo);
    if (codigo.indexOf(MARCA_PUSH) === -1) return '';
    var args = argumentosDePush(codigo), trozos = [];
    for (var j = 0; j < args.length; j++) {
      try {
        var arr = JSON.parse(args[j]);
        if (Array.isArray(arr) && typeof arr[1] === 'string') trozos.push(arr[1]);
      } catch (e) { /* algunos push llevan variables, no JSON */ }
    }
    return trozos.join('');
  }

  /** El arreglo (u objeto) JSON que abre en `ini`, entero y sin leer de más; null si está cortado. */
  function recortar(s, ini) {
    var prof = 0, enCadena = false, escape = false;
    for (var i = ini; i < s.length; i++) {
      var c = s.charAt(i);
      if (enCadena) {
        if (escape) escape = false;
        else if (c === '\\') escape = true;
        else if (c === '"') enCadena = false;
        continue;
      }
      if (c === '"') enCadena = true;
      else if (c === '[' || c === '{') prof++;
      else if (c === ']' || c === '}') {
        prof--;
        if (prof === 0) return s.slice(ini, i + 1);
      }
    }
    return null;
  }

  /** El arreglo que sigue a `clave` («"records":[») desde `desde`; null si no parsea. */
  function arregloTras(stream, clave, desde) {
    var p = stream.indexOf(clave, desde || 0);
    if (p === -1) return null;
    var cuerpo = recortar(stream, p + clave.length - 1);
    if (!cuerpo) return null;
    try {
      var arr = JSON.parse(cuerpo);
      return Array.isArray(arr) ? { lista: arr, fin: p + clave.length - 1 + cuerpo.length } : null;
    } catch (e) { return null; }
  }

  function numero(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function texto(v, tope) {
    var t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
    return t.length > tope ? t.slice(0, tope) : t;
  }
  /** La calificación (0 a 5) y las opiniones: sin opiniones, la calificación no dice nada. */
  function opinion(promedio, cuantas) {
    var n = numero(cuantas), a = numero(promedio);
    n = n !== null && n > 0 ? Math.round(n) : 0;
    return { cal: n && a !== null ? Math.max(0, Math.min(5, a)) : null, nOp: n };
  }

  // ===========================================================================
  // La ficha: sus carruseles
  // ===========================================================================

  // Por cómo termina el título: lo de en medio cambia con la sesión.
  var CARRUSELES = [
    ['complementa', /complementa con\s*$/i],
    ['otros', /otros clientes compraron\s*$/i],
    ['relacionados', /art[ií]culos relacionados\s*$/i],
    ['masVendidos', /m[aá]s vendidos\s*$/i],
    ['vistos', /vistos recientemente\s*$/i]
  ];

  function productoDeCarrusel(p) {
    if (!p || typeof p !== 'object' || !/^\d{6,}$/.test(String(p.productId || ''))) return null;
    var precios = p.priceInfo || {}, o = opinion(p.rating && p.rating.average, p.rating && p.rating.count);
    return {
      id: String(p.productId),
      marca: texto(p.brand, 80),
      nombre: texto(p.name, 200),
      precio: numero(precios.price != null ? precios.price : precios.promoPrice),
      cal: o.cal, nOp: o.nOp,
      mkp: p.marketplace === true,
      vendedor: texto(p.seller, 60) || null
    };
  }

  /**
   * Los carruseles de una ficha: { complementa: [], otros: [], relacionados: [],
   * masVendidos: [], vistos: [] }, cada producto con su calificación, sus
   * opiniones y quién lo vende. Solo trae los que encontró y pudo leer.
   */
  function carruselesDe(stream) {
    var out = {};
    stream = String(stream || '');
    var re = /"title":"([^"]{0,160})","variant":"[^"]{0,40}","products":\[/g, m;
    while ((m = re.exec(stream))) {
      var clave = null;
      for (var i = 0; i < CARRUSELES.length; i++) if (CARRUSELES[i][1].test(m[1])) { clave = CARRUSELES[i][0]; break; }
      if (!clave || out[clave]) continue;
      var cuerpo = recortar(stream, m.index + m[0].length - 1), lista = null;
      if (!cuerpo) continue;
      try { lista = JSON.parse(cuerpo); } catch (e) { continue; }
      if (!Array.isArray(lista)) continue;
      out[clave] = lista.map(productoDeCarrusel).filter(Boolean);
    }
    return out;
  }

  /** id → { cal, nOp, mkp, vendedor } de todo lo que traen los carruseles de la ficha. */
  function calidadDeFicha(stream) {
    var car = carruselesDe(stream), mapa = {};
    Object.keys(car).forEach(function (k) {
      car[k].forEach(function (p) { if (!mapa[p.id]) mapa[p.id] = { cal: p.cal, nOp: p.nOp, mkp: p.mkp, vendedor: p.vendedor }; });
    });
    return mapa;
  }

  // ===========================================================================
  // La búsqueda: sus resultados
  // ===========================================================================

  /**
   * Los resultados de una búsqueda, en el orden de Liverpool: [{ id, cal, nOp,
   * mkp, patroc, online }]. `online` es false solo si el resultado dice dónde hay
   * existencia y la tienda en línea no está; si no lo dice, null.
   */
  function registrosDe(stream) {
    var r = arregloTras(String(stream || ''), '"records":[');
    if (!r) return [];
    return r.lista.map(function (x) {
      if (!x || typeof x !== 'object' || !/^\d{6,}$/.test(String(x.productId || ''))) return null;
      var ff = x.featureFlags || {}, ri = x.ratingInfo || {};
      var o = opinion(ri.productAvgRating, ri.productRatingCount);
      var tiendas = Array.isArray(x.geoStoreIds) ? x.geoStoreIds : null;
      return {
        id: String(x.productId),
        cal: o.cal, nOp: o.nOp,
        mkp: ff.isMarketPlace === true,
        patroc: ff.isSponsoredRecord === true,
        online: tiendas && tiendas.length ? tiendas.indexOf('online') > -1 : null
      };
    }).filter(Boolean);
  }

  /** id → { cal, nOp, mkp, patroc, online } de los resultados de una búsqueda. */
  function calidadDeBusqueda(stream) {
    var mapa = {};
    registrosDe(stream).forEach(function (r) { if (!mapa[r.id]) mapa[r.id] = { cal: r.cal, nOp: r.nOp, mkp: r.mkp, patroc: r.patroc, online: r.online }; });
    return mapa;
  }

  /** Suma a cada artículo (de un carrusel o de una búsqueda) lo que el stream sabe de él. No pisa lo que ya trae. */
  function enriquecer(items, mapa) {
    if (!mapa) return items || [];
    return (items || []).map(function (it) {
      var d = it && mapa[it.id];
      if (!d) return it;
      var out = {};
      Object.keys(it).forEach(function (k) { out[k] = it[k]; });
      Object.keys(d).forEach(function (k) { if (out[k] === undefined && d[k] !== null && d[k] !== undefined) out[k] = d[k]; });
      return out;
    });
  }

  // ===========================================================================
  // La bolsa: qué lleva ya el cliente
  // ===========================================================================

  /** «2026-10-02 07:14:30.251Z» (así lo escribe Liverpool) → ms; null si no es una fecha. */
  function fecha(v) {
    if (typeof v !== 'string' || !v) return null;
    var t = Date.parse(v.indexOf('T') === -1 ? v.replace(' ', 'T') : v);
    return isFinite(t) ? t : null;
  }

  function articuloDeBolsa(x) {
    if (!x || typeof x !== 'object' || !/^\d{6,}$/.test(String(x.productId || ''))) return null;
    var precio = x.price && typeof x.price === 'object' ? numero(x.price.pesosAmount) : numero(x.price);
    var cantidad = numero(x.quantity);
    return {
      id: String(x.productId),
      sku: /^\d{6,}$/.test(String(x.sku || '')) ? String(x.sku) : null,
      nombre: texto(x.productName, 200),
      marca: texto(x.brand, 80),
      precio: precio,
      cantidad: cantidad !== null && cantidad > 0 ? Math.round(cantidad) : 1,
      agregado: fecha(x.addedAt),
      enExistencia: x.isOnStock !== false
    };
  }

  /**
   * Los artículos de la bolsa: [{ id, sku, nombre, marca, precio, cantidad,
   * agregado, enExistencia }]. [] si la bolsa está vacía; null si la página no
   * trae una bolsa que se pueda leer (no es lo mismo: con null no se concluye nada).
   */
  function bolsaDe(stream) {
    stream = String(stream || '');
    var desde = 0, vacia = false;
    for (var vueltas = 0; vueltas < 8; vueltas++) {
      var r = arregloTras(stream, '"lineItems":[', desde);
      if (!r) {
        var p = stream.indexOf('"lineItems":[', desde);
        if (p === -1) break;
        desde = p + 12;      // ese no parseó: puede haber otro
        continue;
      }
      var items = r.lista.map(articuloDeBolsa).filter(Boolean);
      if (items.length) return items;
      if (!r.lista.length) vacia = true;
      desde = r.fin;
    }
    return vacia ? [] : null;
  }

  raiz.VentelLector = {
    version: '1.0',
    streamDe: streamDe, recortar: recortar,
    carruselesDe: carruselesDe, calidadDeFicha: calidadDeFicha,
    registrosDe: registrosDe, calidadDeBusqueda: calidadDeBusqueda, enriquecer: enriquecer,
    bolsaDe: bolsaDe, fecha: fecha
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
