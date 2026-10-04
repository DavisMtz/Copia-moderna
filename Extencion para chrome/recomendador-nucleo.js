/**
 * =============================================================================
 * Ventel · Vende más — el núcleo (recomendador-nucleo.js)
 * =============================================================================
 * Todas las decisiones de la tarjeta «Vende más con este artículo», sin DOM ni
 * chrome.*: de qué tipo es el artículo, qué complemento SÍ le queda, cuál es el
 * siguiente escalón y qué promoción del Monitor se le puede decir al cliente.
 *
 * Va aparte de recomendador.js (que lee la ficha y pinta) para poder probarlo en
 * Node con datos de fichas reales: pruebas/ext_recomendador.test.js.
 *
 * Tres reglas que no se ven leyendo el código y que costaría romper:
 *
 *   1. LOS CANDIDATOS SON DE LIVERPOOL. Salen de los carruseles que la ficha ya
 *      pinta. Aquí solo se filtran, se ordenan y se reparten por tipo; lo único
 *      que se inventa es una BÚSQUEDA para el tipo que faltó (nunca un producto
 *      ni un precio).
 *   2. COMPATIBILIDAD ANTES QUE NADA. En la ficha del iPhone 16, «Complementa
 *      con» ofrecía fundas de iPhone 17e, de Pixel y de Samsung (03/10/2026). Una
 *      funda de otro modelo no es venta cruzada: es una devolución.
 *   3. EL MONITOR MANDA EN LAS PROMOCIONES. «La más fuerte» es la misma cuenta
 *      que el Monitor hace en notas(): el mayor porcentaje de las vigentes, y en
 *      empate la primera. El servidor la manda ya hecha (ventaCruzadaPromos).
 *
 * Expone `VentelVM` en el global (el mundo aislado de la extensión, o el
 * contexto de la prueba).
 * Hecho para Ventel · v1.0 · 04/10/2026
 */
(function (raiz) {
  'use strict';

  // ===========================================================================
  // Utilidades
  // ===========================================================================

  /** Minúsculas, sin acentos y con un solo espacio: así se compara todo aquí. */
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD')
      .replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();
  }

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(String(v).replace(/[$,\s]/g, ''));
    return isFinite(n) ? n : null;
  }

  function redondear(n) { return Math.round(n * 100) / 100; }

  /** $17,499 o $24,398.85: los centavos solo si los hay, como los enseña Liverpool. */
  function pesos(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    var r = redondear(n);
    return '$' + r.toLocaleString('es-MX', {
      minimumFractionDigits: (r % 1) ? 2 : 0, maximumFractionDigits: 2
    });
  }

  /** «iphone 16» → «iPhone 16»; el resto, con mayúscula inicial. */
  function bonito(s) {
    var t = String(s || '').trim();
    if (!t) return '';
    return t.replace(/\biphone\b/gi, 'iPhone').replace(/\bipad\b/gi, 'iPad')
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }

  // ===========================================================================
  // ¿Qué tipo de artículo es?
  // ===========================================================================

  /**
   * La clase de la ficha. Puntúa tres señales y gana la más alta:
   *   la característica «Producto» (3), la ÚLTIMA miga (2) y el principio del
   *   nombre (1). La primera miga no cuenta: puede ser una campaña («Regreso a
   *   Clases») y entonces todo sería «Regreso a Clases».
   */
  function clasificar(ficha, reglas) {
    if (!reglas || !reglas.clases) return null;
    var migas = ficha.migas || [];
    var ultima = norm(migas[migas.length - 1] || '');
    var producto = norm(ficha.producto || '');
    var titulo = norm(ficha.nombre || '');
    var mejor = null, puntos = 0;
    for (var i = 0; i < reglas.clases.length; i++) {
      var c = reglas.clases[i], p = 0;
      if (c.producto && producto && c.producto.test(producto)) p += 3;
      if (c.migas && ultima && c.migas.test(ultima)) p += 2;
      if (c.titulo && titulo && c.titulo.test(titulo)) p += 1;
      if (p > puntos) { puntos = p; mejor = c; }
    }
    return mejor;
  }

  /** La clase que delata el nombre de OTRO artículo (un candidato de carrusel). */
  function claseDeNombre(nombre, reglas) {
    var t = norm(nombre);
    if (!t || !reglas || !reglas.clases) return null;
    for (var i = 0; i < reglas.clases.length; i++) {
      if (reglas.clases[i].titulo && reglas.clases[i].titulo.test(t)) return reglas.clases[i];
    }
    return null;
  }

  // ===========================================================================
  // Dispositivos: familia, modelo, plataforma, pulgadas
  // ===========================================================================

  var FAMILIAS = [
    ['iphone', /\biphone/], ['ipad', /\bipad/],
    ['samsung', /\b(samsung|galaxy)\b/], ['pixel', /\b(pixel|google)\b/],
    ['xiaomi', /\b(xiaomi|redmi|poco)\b/], ['motorola', /\b(motorola|moto)\b/],
    ['oppo', /\boppo\b/], ['huawei', /\b(huawei|matepad)\b/], ['honor', /\bhonor\b/],
    ['realme', /\brealme\b/], ['zte', /\bzte\b/], ['nokia', /\bnokia\b/], ['tcl', /\btcl\b/]
  ];

  /** Las familias de equipo que nombra un texto («funda para Samsung» → samsung). */
  function familiasDe(texto) {
    var t = norm(texto), out = [];
    for (var i = 0; i < FAMILIAS.length; i++) if (FAMILIAS[i][1].test(t)) out.push(FAMILIAS[i][0]);
    return out;
  }

  /**
   * El modelo concreto: «iphone 16», «iphone 16 pro», «iphone 17e», «galaxy s25
   * ultra», «moto g15». Sin modelo (null) si el texto solo dice la familia:
   * «Funda para iPhone» no dice para cuál.
   */
  function modeloDe(texto) {
    var t = norm(texto);
    var m = t.match(/\b(iphone|ipad|galaxy|pixel|redmi note|redmi|poco|moto)\s?((?:[a-z]{1,2}\s?)?\d{1,3}[a-z]?(?:\s?(?:pro max|pro\+|pro|plus|ultra|max|mini|air|fe|lite|neo))?)(?![\w.])/);
    return m ? (m[1] + ' ' + m[2]).replace(/\s+/g, ' ').trim() : null;
  }

  function plataformaDe(texto) {
    var t = norm(texto);
    if (/\b(ps5|playstation 5)\b/.test(t)) return 'ps5';
    if (/\b(ps4|playstation 4)\b/.test(t)) return 'ps4';
    if (/\bxbox series\b|\bseries [xs]\b/.test(t)) return 'xbox series';
    if (/\bxbox one\b/.test(t)) return 'xbox one';
    if (/\bswitch ?2\b/.test(t)) return 'switch 2';
    if (/\b(nintendo switch|switch)\b/.test(t)) return 'switch';
    return null;
  }
  var PLATAFORMA_TEXTO = { 'ps5': 'PS5', 'ps4': 'PS4', 'xbox series': 'Xbox Series', 'xbox one': 'Xbox One', 'switch 2': 'Nintendo Switch 2', 'switch': 'Nintendo Switch' };

  /** Las pulgadas de UNA pantalla («55 pulgadas», «65"»). */
  function pulgadasDe(texto) {
    var m = norm(texto).match(/\b(\d{2,3})(?:\.\d)?\s*(?:"|''|pulgadas|pulg)/);
    return m ? parseInt(m[1], 10) : null;
  }

  /** El rango que admite un soporte («32 a 84 pulgadas», «32-70"»). */
  function rangoPulgadas(texto) {
    var m = norm(texto).match(/\b(\d{2})\s*(?:"|''|pulgadas|pulg)?\s*(?:a|al|-|hasta)\s*(\d{2,3})\s*(?:"|''|pulgadas|pulg)/);
    if (!m) return null;
    var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    return a < b ? [a, b] : null;
  }

  function tamanoColchon(texto) {
    var m = norm(texto).match(/\b(individual|matrimonial|queen|king)\b/);
    return m ? m[1] : null;
  }

  // ===========================================================================
  // El contexto: lo que se sabe de la ficha, ya interpretado
  // ===========================================================================

  /**
   * @param {Object} ficha  lo que recomendador.js leyó con el inspector:
   *   { id, nombre, marca, migas[], producto, modeloComercial, precio,
   *     variantes[], varianteActual, skuUrl, seleccion, esRango, colores[], care }
   */
  function contexto(ficha, reglas) {
    var clase = clasificar(ficha, reglas);
    var texto = (ficha.nombre || '') + ' ' + (ficha.modeloComercial || '');
    var esEquipo = !!(clase && clase.dispositivo);
    var modelo = esEquipo ? (modeloDe(ficha.modeloComercial || '') || modeloDe(ficha.nombre || '')) : null;
    var ctx = {
      ficha: ficha,
      clase: clase,
      familias: esEquipo ? familiasDe(texto) : [],
      modelo: modelo,
      plataforma: clase && clase.id === 'consola' ? plataformaDe(texto) : null,
      pulgadas: clase && (clase.id === 'tv' || clase.id === 'laptop') ? pulgadasDe(texto) : null,
      tamano: clase && clase.id === 'colchon' ? tamanoColchon(texto) : null,
      precioBase: precioBase(ficha)
    };
    ctx.vars = {
      modelo: ficha.modeloComercial ? String(ficha.modeloComercial).trim() : (modelo ? bonito(modelo) : null),
      marca: ficha.marca ? bonito(String(ficha.marca).toLowerCase()) : null,
      pulgadas: ctx.pulgadas ? String(ctx.pulgadas) : null,
      plataforma: ctx.plataforma ? PLATAFORMA_TEXTO[ctx.plataforma] : null,
      tamano: ctx.tamano
    };
    return ctx;
  }

  /**
   * ¿La variante en foco es una ELECCIÓN del asesor o solo la primera del color?
   * Lo es si eligió talla en la ficha, si la abrió por su enlace (?skuid=, que
   * Liverpool no marca como talla elegida: medido el 04/10/2026 con el iPhone 16
   * de 512 GB) o si la ficha no enseña un rango de precios.
   */
  function varianteElegida(ficha, vs) {
    var actual = null;
    for (var i = 0; i < vs.length; i++) if (vs[i].sku === ficha.varianteActual) actual = vs[i];
    if (!actual) return null;
    var elegida = !!(ficha.seleccion && ficha.seleccion.talla) ||
      !!(ficha.skuUrl && ficha.skuUrl === actual.sku) || !ficha.esRango;
    return elegida ? actual : null;
  }

  /** El precio desde el que se mide una subida: el de la variante elegida o, si la ficha enseña un rango, el más bajo. */
  function precioBase(ficha) {
    var vs = (ficha.variantes || []).filter(function (v) { return v && typeof v.price === 'number'; });
    var elegida = varianteElegida(ficha, vs);
    if (elegida) return elegida.price;
    if (vs.length) return Math.min.apply(null, vs.map(function (v) { return v.price; }));
    return num(ficha.precio);
  }

  // ===========================================================================
  // Venta cruzada
  // ===========================================================================

  function esAccesorio(t, clase) {
    if (!clase) return false;
    for (var i = 0; i < clase.complementos.length; i++) if (clase.complementos[i].palabras.test(t)) return true;
    return false;
  }

  /**
   * ¿Es OTRO artículo del mismo tipo (un sustituto)? Esos van a la venta
   * incremental, nunca a la cruzada: ofrecer un segundo celular no es sumar.
   */
  function esSustituto(item, ctx, reglas) {
    var t = norm(item.nombre);
    if (!t || !ctx.clase) return false;
    // En cuidado facial el sérum y el protector solar son de la misma clase y aun
    // así uno complementa al otro: ahí el sustituto es el del MISMO tipo.
    if (ctx.clase.sustitutoPorTipo) {
      var propio = tipoDe({ nombre: ctx.ficha.nombre }, ctx.clase);
      return !!(propio.conocido && tipoDe(item, ctx.clase).tipo === propio.tipo);
    }
    var c = claseDeNombre(t, reglas);
    if (c && c.id === ctx.clase.id) return true;
    // Un equipo que no dice su familia: «600E Amoled 6.6 Pulgadas Telcel».
    if (ctx.clase.dispositivo && !/\bpara\b/.test(t) && !esAccesorio(t, ctx.clase) &&
        /\b\d{1,2}(\.\d{1,2})?\s*(pulgadas|")/.test(t)) return true;
    return false;
  }

  /**
   * Qué tan bien le queda al artículo de la ficha:
   *   'exacto'   nombra el mismo modelo, plataforma o un rango de pulgadas que lo incluye;
   *   'marca'    misma marca, sin modelo de por medio («Adaptador de corriente» de Apple);
   *   'generico' no depende del equipo (un cargador USB-C);
   *   'familia'  misma familia pero sin modelo («Funda para iPhone»: ¿cuál?);
   *   null       es de otro equipo: se descarta.
   */
  function compatibilidad(item, ctx) {
    var t = String(item.nombre || '');
    if (ctx.familias.length) {
      var fams = familiasDe(t + ' ' + (item.marca || ''));
      var comun = fams.some(function (f) { return ctx.familias.indexOf(f) > -1; });
      if (fams.length && !comun) return null;
      var m = modeloDe(t);
      if (m && ctx.modelo && m !== ctx.modelo) return null;
      if (m && ctx.modelo && m === ctx.modelo) return 'exacto';
      if (comun && norm(item.marca) !== norm(ctx.ficha.marca)) return 'familia';
    }
    if (ctx.plataforma) {
      var p = plataformaDe(t);
      if (p && p !== ctx.plataforma) return null;
      if (p) return 'exacto';
    }
    if (ctx.pulgadas) {
      var r = rangoPulgadas(t);
      if (r && (ctx.pulgadas < r[0] || ctx.pulgadas > r[1])) return null;
      if (r) return 'exacto';
    }
    if (ctx.ficha.marca && norm(item.marca) === norm(ctx.ficha.marca)) return 'marca';
    return 'generico';
  }

  /** Dónde termina la segunda palabra: el tipo tiene que empezar antes de ahí. */
  function finDeLaCabeza(t) {
    var p = t.split(' ');
    return p.length > 2 ? p[0].length + 1 + p[1].length : t.length;
  }

  /**
   * El tipo de complemento de un candidato: el de la regla cuya palabra EMPIEZA
   * en las dos primeras del nombre (el sustantivo, en los nombres de Liverpool),
   * o «otro» con su primera palabra. `conocido` dice si salió de la regla.
   */
  function tipoDe(item, clase) {
    var t = norm(item.nombre);
    var cabeza = finDeLaCabeza(t);
    if (clase) {
      for (var i = 0; i < clase.complementos.length; i++) {
        var c = clase.complementos[i];
        var m = c.palabras.exec(t);
        if (m && m.index <= cabeza) {
          return { tipo: c.tipo, etiqueta: c.etiqueta, peso: c.peso, conocido: true };
        }
      }
    }
    return { tipo: 'otro:' + (t.split(' ')[0] || '?'), etiqueta: '', peso: 0.2, conocido: false };
  }

  var RANGO_COMPAT = { exacto: 0, marca: 1, generico: 2, familia: 3 };

  /**
   * El escalón de un candidato: 0 el mismo modelo; 1 un tipo que la regla da por
   * natural; 2 un tipo que la regla no conoce (lo propuso Liverpool, pero sin
   * respaldo: un shampoo íntimo «complementaba» un protector solar); 3 la misma
   * familia sin modelo («Funda para iPhone»: puede no ser la suya).
   */
  function escalon(c) {
    if (c.compat === 'exacto') return 0;
    if (c.compat === 'familia') return 3;
    return c.conocido ? 1 : 2;
  }

  /**
   * Hasta `maximo` complementos, UNO POR TIPO, por escalón; dentro del escalón,
   * el tipo que más se vende con este artículo, luego la misma marca antes que
   * el genérico, y al final el orden en que los puso Liverpool.
   * @param {Array<{origen:string, items:Array}>} listas «Complementa con» primero.
   */
  function elegirCruzada(listas, ctx, reglas, opciones) {
    var maximo = (opciones && opciones.maximo) || 3;
    var excluir = (opciones && opciones.excluir) || {};
    var vistos = {}, candidatos = [];
    (listas || []).forEach(function (lista) {
      (lista.items || []).forEach(function (it) {
        if (!it || !it.id || !it.nombre || vistos[it.id] || it.id === ctx.ficha.id || excluir[it.id]) return;
        vistos[it.id] = true;
        if (esSustituto(it, ctx, reglas)) return;
        var c = compatibilidad(it, ctx);
        if (!c) return;
        var tipo = tipoDe(it, ctx.clase);
        // Con el tipo de artículo reconocido, un complemento que la regla no conoce
        // no ocupa lugar: el hueco lo llena una búsqueda de un tipo que sí le va
        // (en el protector solar, «limpiador facial» en vez de un labial).
        if (ctx.clase && !tipo.conocido) return;
        candidatos.push(Object.assign({}, it, {
          compat: c, tipo: tipo.tipo, etiquetaTipo: tipo.etiqueta, peso: tipo.peso, conocido: tipo.conocido,
          origen: lista.origen, orden: candidatos.length
        }));
      });
    });
    candidatos.sort(function (a, b) {
      return (escalon(a) - escalon(b)) || (b.peso - a.peso) ||
        (RANGO_COMPAT[a.compat] - RANGO_COMPAT[b.compat]) || (a.orden - b.orden);
    });
    var tipos = {}, out = [];
    for (var i = 0; i < candidatos.length && out.length < maximo; i++) {
      if (tipos[candidatos[i].tipo]) continue;
      tipos[candidatos[i].tipo] = true;
      out.push(candidatos[i]);
    }
    return out;
  }

  /**
   * Búsquedas para los tipos que la regla da por naturales y Liverpool no trajo
   * (la mica del iPhone). Solo si la plantilla se puede llenar entera.
   */
  function sugerirBusquedas(ctx, elegidos, maximo) {
    if (!ctx.clase) return [];
    var hechos = {};
    (elegidos || []).forEach(function (e) { hechos[e.tipo] = true; });
    // Nunca el tipo del propio artículo: en un protector solar, «busca un protector solar» es un sustituto.
    var propio = tipoDe({ nombre: ctx.ficha.nombre }, ctx.clase);
    if (propio.conocido) hechos[propio.tipo] = true;
    var titulo = norm(ctx.ficha.nombre);
    var lista = ctx.clase.complementos.slice().sort(function (a, b) { return b.peso - a.peso; });
    var out = [];
    for (var i = 0; i < lista.length && out.length < (maximo || 2); i++) {
      var c = lista[i];
      if (hechos[c.tipo] || !c.buscar) continue;
      if (c.si && !c.si.test(titulo)) continue;
      var faltaAlgo = false;
      var consulta = c.buscar.replace(/\{(\w+)\}/g, function (_, k) {
        var v = ctx.vars[k];
        if (!v) faltaAlgo = true;
        return v || '';
      }).replace(/\s+/g, ' ').trim();
      if (faltaAlgo || !consulta) continue;
      out.push({ tipo: c.tipo, etiqueta: c.etiqueta, consulta: consulta });
    }
    return out;
  }

  // ===========================================================================
  // Venta incremental
  // ===========================================================================

  /** El plazo más largo SIN intereses de una variante (0 si no tiene). */
  function maxMsi(planes) {
    var n = 0;
    (planes || []).forEach(function (p) {
      if (p && p.noInterest && typeof p.months === 'number' && p.months > n) n = p.months;
    });
    return n;
  }

  // Una capacidad o una medida: «128 GB», «65 pulgadas», «100 ml». Una talla de
  // ropa («M», «28») no tiene unidad y no se ofrece como «sube la versión».
  var UNIDAD = /\d\s*(gb|tb|pulgadas|pulg|ml|lts?|litros|kg|oz|w)\b/i;

  /**
   * El siguiente escalón DENTRO de la ficha: la capacidad o medida inmediata
   * superior que cuesta más. Sin tope de precio (es el ejemplo del 64 → 128 GB),
   * pero con la diferencia a la vista, y al mes solo si las dos variantes tienen
   * meses sin intereses (con el plazo que comparten).
   */
  function subidaCapacidad(ficha) {
    var vs = (ficha.variantes || []).filter(function (v) {
      return v && v.size && typeof v.price === 'number' && v.inStock !== false;
    });
    if (vs.length < 2) return null;
    var base = varianteElegida(ficha, vs) ||
      vs.reduce(function (a, b) { return b.price < a.price ? b : a; });
    if (!UNIDAD.test(base.size)) return null;

    var grupos = {}, colores = {};
    vs.forEach(function (v) {
      if (v.color) colores[v.color] = true;
      var g = grupos[v.size] || (grupos[v.size] = { talla: v.size, precio: v.price, variante: v, colores: [] });
      if (v.price < g.precio) { g.precio = v.price; g.variante = v; }
      if (v.color && g.colores.indexOf(v.color) === -1) g.colores.push(v.color);
    });
    var cands = Object.keys(grupos).map(function (k) { return grupos[k]; }).filter(function (g) {
      return g.talla !== base.size && UNIDAD.test(g.talla) && g.precio > base.price + 0.5;
    }).sort(function (a, b) { return a.precio - b.precio; });
    if (!cands.length) return null;

    var g = cands[0];
    var dif = redondear(g.precio - base.price);
    var mb = maxMsi(base.paymentPlans), mu = maxMsi(g.variante.paymentPlans);
    var meses = (mb && mu) ? Math.min(mb, mu) : 0;
    var totalColores = Object.keys(colores).length;
    return {
      talla: g.talla, desde: base.size, precio: g.precio, dif: dif, sku: g.variante.sku,
      colores: g.colores, todosLosColores: !totalColores || g.colores.length >= totalColores,
      mensual: meses ? { meses: meses, monto: redondear(dif / meses) } : null,
      imagen: (g.variante.images && g.variante.images[0]) || null
    };
  }

  /**
   * El siguiente modelo, de «Artículos relacionados»: misma marca, mismo tipo,
   * más caro pero dentro del tope (25 %, o 35 % en ticket alto). Gana el escalón
   * más cercano: el que el cliente sí puede decir que sí.
   */
  function subidaModelo(relacionados, ctx, reglas) {
    var base = ctx.precioBase;
    if (!base || !relacionados || !relacionados.length) return null;
    var s = (reglas && reglas.subida) || { tope: 0.25, topeAlto: 0.35, ticketAlto: 10000 };
    var tope = base >= s.ticketAlto ? s.topeAlto : s.tope;
    var marca = norm(ctx.ficha.marca);
    var nombre = norm(ctx.ficha.nombre);
    var cands = relacionados.filter(function (r) {
      if (!r || typeof r.precio !== 'number' || r.id === ctx.ficha.id) return false;
      if (!(r.precio > base * 1.02 && r.precio <= base * (1 + tope))) return false;
      if (marca && norm(r.marca) !== marca) return false;
      if (norm(r.nombre) === nombre) return false;
      if (ctx.clase && ctx.clase.titulo && !ctx.clase.titulo.test(norm(r.nombre))) return false;
      if (ctx.modelo && modeloDe(r.nombre) === ctx.modelo) return false;
      return true;
    }).sort(function (a, b) { return a.precio - b.precio; });
    if (!cands.length) return null;
    return Object.assign({}, cands[0], { dif: redondear(cands[0].precio - base), tope: tope });
  }

  // ===========================================================================
  // Promociones del Monitor (llegan del Portal: ventaCruzadaPromos)
  // ===========================================================================

  /** Las que siguen vivas: el paquete puede llevar horas guardado. */
  function promosVigentes(paquete, ahora) {
    var lista = (paquete && Array.isArray(paquete.promos)) ? paquete.promos : [];
    return lista.filter(function (p) { return p && (!p.f || p.f >= ahora); });
  }

  function conMsi(p) { return p.m > 1 ? ' + ' + p.m + ' MSI' : ''; }

  /**
   * La frase de apertura, con las palabras del mensaje del equipo y las cifras
   * del Monitor: la más fuerte y, si la hay, la siguiente de OTRA dirección.
   */
  function fraseApertura(paquete, ahora) {
    var vig = promosVigentes(paquete, ahora).filter(function (p) { return p.p > 0; });
    var fuerte = paquete && paquete.fuerte;
    if (!fuerte || !fuerte.p || (fuerte.f && fuerte.f < ahora)) {
      fuerte = vig.slice().sort(function (a, b) { return b.p - a.p; })[0] || null;
    }
    if (!fuerte || !fuerte.p) return null;
    var otra = vig.filter(function (p) { return norm(p.d) !== norm(fuerte.d); })
      .sort(function (a, b) { return (b.p - a.p) || ((b.m || 0) - (a.m || 0)); })[0] || null;
    var texto = 'Sr. / Srta., hoy tenemos hasta un ' + fuerte.p + '% de descuento' + conMsi(fuerte) +
      (fuerte.d ? ' en ' + fuerte.d : '');
    if (otra) texto += ' o hasta ' + otra.p + '% de descuento' + conMsi(otra) + (otra.d ? ' en ' + otra.d : '');
    return { texto: texto + '…', fuerte: fuerte, otra: otra };
  }

  // Las direcciones del Monitor y cómo se llaman sus cosas en las migas de Liverpool.
  var DIRECCIONES = [
    [/electronica/, /tecnolog|electronic|celular|smartphone|computa|laptop|tablet|pantalla|televis|audio|videojuego|consola|camara|smartwatch/],
    [/hogar|linea blanca|muebles/, /hogar|mueble|cocina|linea blanca|electrodomest|colchon|recamara|bano|decoracion|blancos|refrigerador|lavadora|secadora|estufa/],
    [/belleza|perfum|cosmetic/, /belleza|perfum|fragancia|cosmetic|maquillaje|cuidado facial|cuidado personal|protector(es)? solar|dermo/],
    [/mujer|dama/, /mujer|dama/],
    [/hombre|caballero/, /hombre|caballero/],
    [/nin[oa]s?|bebe|infantil|juguet/, /nin[oa]s?|bebe|infantil|juguet/],
    [/deporte/, /deporte|fitness|bicicleta|ejercicio|entrenamiento/]
  ];

  /**
   * Las formas con las que una palabra puede aparecer en singular: «celulares» →
   * celular, «smartphones» → smartphone. El plural en español suma «s» o «es»
   * según la palabra, así que se prueban las dos y basta con que una coincida.
   */
  function raices(palabra) {
    var out = [palabra];
    if (palabra.length > 4 && /s$/.test(palabra)) out.push(palabra.slice(0, -1));
    if (palabra.length > 5 && /es$/.test(palabra)) out.push(palabra.slice(0, -2));
    return out;
  }

  /**
   * La promoción del Monitor que le toca a ESTA ficha: por categoría (todas sus
   * palabras aparecen en las migas o el nombre), y si no, por dirección. Entre
   * las que empatan, la de mayor porcentaje.
   */
  function promoParaFicha(paquete, ctx, ahora) {
    var vig = promosVigentes(paquete, ahora);
    if (!vig.length) return null;
    var base = norm((ctx.ficha.migas || []).join(' ') + ' ' + (ctx.ficha.producto || '') + ' ' +
      (ctx.clase ? ctx.clase.nombre : '') + ' ' + (ctx.ficha.nombre || ''));
    var conocidas = {};
    base.split(/[^a-z0-9]+/).forEach(function (w) {
      if (w) raices(w).forEach(function (r) { conocidas[r] = true; });
    });
    var mejor = null;
    vig.forEach(function (p) {
      var puntos = 0;
      var palabras = norm(p.c).split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 4; });
      var aparece = function (w) { return raices(w).some(function (r) { return conocidas[r]; }); };
      if (palabras.length && palabras.every(aparece)) puntos = 2;
      if (!puntos) {
        var d = norm(p.d);
        for (var i = 0; i < DIRECCIONES.length; i++) {
          if (DIRECCIONES[i][0].test(d) && DIRECCIONES[i][1].test(base)) { puntos = 1; break; }
        }
      }
      if (!puntos) return;
      if (!mejor || puntos > mejor.puntos || (puntos === mejor.puntos && (p.p || 0) > (mejor.promo.p || 0))) {
        mejor = { promo: p, puntos: puntos, por: puntos === 2 ? 'categoria' : 'direccion' };
      }
    });
    return mejor;
  }

  // ===========================================================================
  // Todo junto
  // ===========================================================================

  /**
   * @param {Object} ficha       ver contexto()
   * @param {Object} carruseles  { complementa:[], otros:[], relacionados:[] } leídos del DOM
   * @param {Object} paquete     las promociones del Portal (o null)
   * @param {Object} reglas      VENTEL_REGLAS
   * @param {number} ahora       ms
   */
  function recomendar(ficha, carruseles, paquete, reglas, ahora) {
    var ctx = contexto(ficha, reglas);
    carruseles = carruseles || {};
    var relacionados = carruseles.relacionados || [];
    var excluir = {};
    relacionados.forEach(function (r) { if (r && r.id) excluir[r.id] = true; });

    var capacidad = subidaCapacidad(ficha);
    var modelo = subidaModelo(relacionados, ctx, reglas);
    var cruzada = elegirCruzada([
      { origen: 'complementa', items: carruseles.complementa || [] },
      { origen: 'otros', items: carruseles.otros || [] }
    ], ctx, reglas, { maximo: 3, excluir: excluir });
    var sugeridas = sugerirBusquedas(ctx, cruzada, cruzada.length >= 3 ? 1 : 2);

    var frase = paquete ? fraseApertura(paquete, ahora) : null;
    var deFicha = paquete ? promoParaFicha(paquete, ctx, ahora) : null;
    var horas = paquete && paquete.generado ? (ahora - paquete.generado) / 3600000 : null;

    return {
      clase: ctx.clase ? { id: ctx.clase.id, nombre: ctx.clase.nombre } : null,
      modelo: ctx.vars.modelo,
      precioBase: ctx.precioBase,
      incremental: { capacidad: capacidad, modelo: modelo },
      cruzada: cruzada,
      sugeridas: sugeridas,
      servicio: !!(ficha.care && (!ctx.clase || ctx.clase.servicio)),
      promos: {
        hay: !!paquete,
        frase: frase,
        ficha: deFicha,
        horas: horas
      }
    };
  }

  raiz.VentelVM = {
    version: '1.0',
    norm: norm, num: num, pesos: pesos, bonito: bonito,
    clasificar: clasificar, claseDeNombre: claseDeNombre,
    familiasDe: familiasDe, modeloDe: modeloDe, plataformaDe: plataformaDe,
    pulgadasDe: pulgadasDe, rangoPulgadas: rangoPulgadas, tamanoColchon: tamanoColchon,
    contexto: contexto, precioBase: precioBase, varianteElegida: varianteElegida,
    esSustituto: esSustituto, compatibilidad: compatibilidad, tipoDe: tipoDe,
    elegirCruzada: elegirCruzada, sugerirBusquedas: sugerirBusquedas,
    maxMsi: maxMsi, subidaCapacidad: subidaCapacidad, subidaModelo: subidaModelo,
    promosVigentes: promosVigentes, fraseApertura: fraseApertura, promoParaFicha: promoParaFicha,
    recomendar: recomendar
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
