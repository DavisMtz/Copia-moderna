/**
 * =============================================================================
 * Ventel · Vende más — el núcleo (recomendador-nucleo.js)
 * =============================================================================
 * Todas las decisiones de la tarjeta «Vende más con este artículo», sin DOM ni
 * chrome.*: de qué tipo es el artículo, qué complemento SÍ le queda, cuál es el
 * siguiente escalón, qué buscar en liverpool.com.mx y qué promoción del Monitor
 * se le puede decir al cliente.
 *
 * Va aparte de recomendador.js (que lee la ficha, busca y pinta) para poder
 * probarlo en Node con fichas y búsquedas reales: pruebas/ext_recomendador.test.js.
 *
 * Reglas que no se ven leyendo el código y que costaría romper:
 *
 *   1. LOS CANDIDATOS SON DE LIVERPOOL: los carruseles de la ficha y, desde la
 *      2.7, la búsqueda del sitio. Aquí se filtran, se ordenan y se reparten
 *      por tipo; nunca se inventa un producto ni un precio.
 *   2. COMPATIBILIDAD ANTES QUE NADA. En la ficha del iPhone 16, «Complementa
 *      con» ofrecía fundas de iPhone 17e, de Pixel y de Samsung (03/10/2026); en
 *      el Galaxy A56, una «Funda para Apple». Una funda de otro modelo no es
 *      venta cruzada: es una devolución.
 *   3. UNO POR TIPO, Y EL MEJOR DE CADA TIPO: primero el del mismo modelo;
 *      dentro del mismo nivel, el del carrusel antes que el de la búsqueda (el
 *      carrusel dice que la gente lo compra; la búsqueda solo que se llama así).
 *   4. EL MONITOR MANDA EN LAS PROMOCIONES. «La más fuerte» es la cuenta de
 *      notas() del Monitor; el servidor la manda hecha (ventaCruzadaPromos).
 *      La tarjeta enseña dos: la de la categoría de la ficha y la más fuerte
 *      (desde la 2.8, sin frase para copiar).
 *   5. SIN CLASE, SIN COMPLEMENTOS. Si la ficha no es de una clase de las reglas,
 *      los carruseles traen de todo (un rebanador junto a un ventilador): la
 *      tarjeta se queda con la subida y las promociones. Mejor callar que errar.
 *   6. LA FICHA DE UN ACCESORIO NO ES LA DEL EQUIPO (2.9). Una mica en
 *      «Celulares» no lleva Liverpool Care ni otra mica, y sus búsquedas van con
 *      el modelo del equipo que dice su nombre, no con su propia clave.
 *
 * Expone `VentelVM` en el global (el mundo aislado de la extensión, o el
 * contexto de la prueba).
 * Hecho para Ventel · v1.4 · 04/10/2026
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

  /** «iphone 16» → «iPhone 16», «galaxy a56» → «Galaxy A56»; el resto, con mayúscula inicial. */
  function bonito(s) {
    var t = String(s || '').trim();
    if (!t) return '';
    return t.replace(/\biphone\b/gi, 'iPhone').replace(/\bipad\b/gi, 'iPad')
      .replace(/\b([a-z])(\d{1,3}[a-z]?)\b/g, function (_, l, n) { return l.toUpperCase() + n; })
      .replace(/^(?!iPhone\b|iPad\b)./, function (c) { return c.toUpperCase(); });   // «iPhone 16», no «IPhone 16»
  }

  // ===========================================================================
  // ¿Qué tipo de artículo es?
  // ===========================================================================

  // Migas que son una campaña o un escaparate, no una categoría: «Buen Fin Cocina»,
  // «Top deals», «Lo más vendido en tienda», «Outlet Muebles», «LANZAMIENTOS» (medido
  // en el corpus del 04/10/2026: la freidora vivía en «Outlet Muebles»).
  var CAMPANA = /\b(buen fin|hot sale|top deals?|lo mas vendido|mas vendidos?|outlet|otras categorias|lanzamientos?|novedades|nocturna|venta nocturna|ofertas?|promociones?|liquidacion|remate|regreso a clases|dia de las madres|dia del padre|navidad|black friday|cyber|temporada|exclusivos?|gift guide|guia de regalos|regalos?)\b/;

  /** La miga más específica que de verdad es una categoría (de la última hacia atrás). */
  function migaUtil(migas) {
    for (var i = (migas || []).length - 1; i >= 0; i--) {
      var m = norm(migas[i]);
      if (m && !CAMPANA.test(m)) return m;
    }
    return '';
  }

  /**
   * La clase de la ficha. Puntúa tres señales y gana la más alta: la
   * característica «Producto» (3), la miga más específica que no es campaña (2) y
   * el principio del nombre (1). Las campañas no cuentan: «Lo más vendido en tienda».
   */
  // La sección de Mascotas tiene collares, camas y shampoos que no son joyería, colchones
  // ni cuidado del cabello. Solo cuenta la MIGA: «Dije de perro» es joyería de verdad.
  var MASCOTAS = /^(mascotas?|perros?|gatos?)$/;

  function clasificar(ficha, reglas) {
    if (!reglas || !reglas.clases) return null;
    if ((ficha.migas || []).some(function (m) { return MASCOTAS.test(norm(m)); })) return null;
    var ultima = migaUtil(ficha.migas);
    var producto = norm(ficha.producto || '');
    var titulo = norm(ficha.nombre || '');
    var mejor = null, puntos = 0;
    for (var i = 0; i < reglas.clases.length; i++) {
      var c = reglas.clases[i], p = 0;
      // Lo que se le parece y no es («Traje de baño», «Reloj de pared») no puntúa; si
      // solo lo dice la miga («Computadoras de escritorio»), la miga no cuenta.
      if (c.noEs && (c.noEs.test(titulo) || (producto && c.noEs.test(producto)))) continue;
      if (c.producto && producto && c.producto.test(producto)) p += 3;
      if (c.migas && ultima && c.migas.test(ultima) && !(c.noEs && c.noEs.test(ultima))) p += 2;
      if (c.titulo && titulo && c.titulo.test(titulo)) p += 1;
      if (p > puntos) { puntos = p; mejor = c; }
    }
    return mejor;
  }

  /** La clase que delata el nombre de OTRO artículo (un candidato). */
  function claseDeNombre(nombre, reglas) {
    var t = norm(nombre);
    if (!t || !reglas || !reglas.clases) return null;
    for (var i = 0; i < reglas.clases.length; i++) {
      var c = reglas.clases[i];
      if (c.titulo && c.titulo.test(t) && !(c.noEs && c.noEs.test(t))) return c;
    }
    return null;
  }

  // ===========================================================================
  // Datos que se leen del nombre: familia, modelo, plataforma, medidas, género, línea
  // ===========================================================================

  // «apple» cuenta como iPhone y como iPad: una «Funda para Apple» se coló en la
  // ficha del Galaxy A56 cuando solo se miraba la palabra «iphone».
  var FAMILIAS = [
    ['iphone', /\b(iphone|apple)\b/], ['ipad', /\b(ipad|apple)\b/],
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
   * ultra», «moto g15». Sin modelo (null) si el texto solo dice la familia.
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

  var TAMANOS = /\b(individual|matrimonial|queen|king)\b/;
  function tamanoDe(texto) {
    var m = norm(texto).match(TAMANOS);
    return m ? m[1] : null;
  }

  /** Los kilos de un aparato de lavado («22 kg»): sirven para que la secadora haga par. */
  function kilosDe(texto) {
    var m = norm(texto).match(/\b(\d{1,2})\s*kg\b/);
    return m ? parseInt(m[1], 10) : null;
  }

  /** Para quién es: mujer, hombre, niño o unisex (null si no lo dice). */
  function generoDe(texto) {
    var t = norm(texto);
    if (/\bunisex\b/.test(t)) return 'unisex';
    if (/\b(nin[oa]s?|infantil(es)?|bebes?|junior|kids)\b/.test(t)) return 'nino';
    if (/\b(mujer(es)?|dama(s)?|femenin[oa])\b/.test(t)) return 'mujer';
    if (/\b(hombres?|caballeros?|masculin[oa])\b/.test(t)) return 'hombre';
    return null;
  }
  var GENERO_TEXTO = { mujer: 'mujer', hombre: 'hombre', nino: 'niño' };

  // Lo que dice el nombre de un perfume y NO es su línea.
  var GENERICO_PERFUME = /\b(eau de (parfum|toilette|cologne)|edp|edt|perfume|fragancia|colonia|locion|intenso|intense|para|de|del|la|el|mujer|hombre|dama|caballero|unisex|mini|travel|spray|vaporizador|\d+(\.\d+)?\s*ml)\b/g;

  /** La línea de una fragancia: «Eau de parfum Good Girl para mujer» → «good girl». */
  function lineaDe(nombre, marca) {
    var t = norm(nombre);
    norm(marca).split(' ').forEach(function (w) {
      if (w.length > 2) t = t.replace(new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '') + '\\b', 'g'), ' ');
    });
    t = t.replace(GENERICO_PERFUME, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    var palabras = t.split(' ').filter(function (w) { return w.length > 1; }).slice(0, 3);
    return palabras.length ? palabras.join(' ') : null;
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
    var vs = (ficha.variantes || []).filter(function (v) { return v && typeof v.price === 'number'; });
    var elegida = varianteElegida(ficha, vs);
    // La medida del colchón vive en la VARIANTE («Matrimonial»), no en el nombre («Colchón performance»).
    var tamano = null;
    if (clase && clase.id === 'colchon') {
      tamano = tamanoDe((ficha.seleccion && ficha.seleccion.talla) || '') ||
        (elegida ? tamanoDe(elegida.size || '') : null) || tamanoDe(texto);
    }
    var genero = clase && clase.moda ? generoDe((ficha.migas || []).join(' ') + ' ' + (ficha.nombre || '')) : null;
    var linea = clase && clase.id === 'perfume' ? lineaDe(ficha.nombre, ficha.marca) : null;
    var ctx = {
      ficha: ficha,
      clase: clase,
      familias: esEquipo ? familiasDe(texto) : [],
      modelo: modelo,
      plataforma: clase && clase.id === 'consola' ? plataformaDe(texto) : null,
      pulgadas: clase && (clase.id === 'tv' || clase.id === 'laptop') ? pulgadasDe(texto) : null,
      tamano: tamano,
      kilos: clase && (clase.id === 'lavadora' || clase.id === 'secadora') ? kilosDe(texto) : null,
      modeloComercial: esEquipo && ficha.modeloComercial ? norm(ficha.modeloComercial) : null,
      genero: genero,
      linea: linea,
      precioBase: precioBase(ficha)
    };
    ctx.vars = {
      modelo: ficha.modeloComercial ? String(ficha.modeloComercial).trim() : (modelo ? bonito(modelo) : null),
      // «Genérico» no es una marca que buscar («cargador usb c Genérico»).
      marca: ficha.marca && !MARCA_GENERICA.test(norm(ficha.marca)) ? bonito(String(ficha.marca).toLowerCase()) : null,
      pulgadas: ctx.pulgadas ? String(ctx.pulgadas) : null,
      plataforma: ctx.plataforma ? PLATAFORMA_TEXTO[ctx.plataforma] : null,
      tamano: ctx.tamano,
      genero: genero && genero !== 'unisex' ? GENERO_TEXTO[genero] : null,
      linea: linea
    };
    // Variables propias de la clase, declaradas en las reglas: el sistema de una
    // cafetera de cápsulas («Dolce Gusto»), el tipo de una consola portátil…
    if (clase && clase.variables) {
      var fuente = norm(texto + ' ' + (ficha.marca || ''));
      Object.keys(clase.variables).forEach(function (k) {
        var lista = clase.variables[k];
        for (var i = 0; i < lista.length; i++) if (lista[i][0].test(fuente)) { ctx.vars[k] = lista[i][1]; return; }
        ctx.vars[k] = null;
      });
      // La medida de los blancos (king, matrimonial…) también sirve de candado.
      if (!ctx.tamano && ctx.vars.tamano) ctx.tamano = ctx.vars.tamano;
    }
    // ¿La ficha es un ACCESORIO de su clase? Una mica en «Celulares», una correa en
    // «Smartwatches»: su tipo es uno de los complementos de la clase. Entonces no se
    // ofrece Liverpool Care y otro del mismo tipo es un sustituto (mica junto a mica).
    // En las clases «por tipo» todo es del mismo género y ya se resuelve así. Si el
    // nombre abre como la clase («Vaporizador de ropa» en Planchas), es un equipo.
    ctx.accesorio = !!(clase && !clase.sustitutoPorTipo && tipoPropio(ctx).conocido &&
      !(clase.titulo && clase.titulo.test(norm(ficha.nombre || ''))));
    // En un accesorio, el «Modelo comercial» es la clave del accesorio, no el equipo:
    // las búsquedas van con el modelo del equipo que dice el nombre («…para iPhone 16»).
    if (ctx.accesorio) ctx.vars.modelo = modelo ? bonito(modelo) : null;
    return ctx;
  }

  var MARCA_GENERICA = /^(genericos?|genericas?|generic|sin marca|otras? marcas?|varios|varias|n\/?a)$/;

  /**
   * ¿La variante en foco es una ELECCIÓN del asesor o solo la primera del color?
   * Lo es si eligió talla en la ficha, si la abrió por su enlace (?skuid=, que
   * Liverpool no marca como talla elegida: medido el 03/10/2026 con el iPhone 16
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
  // Venta cruzada: tipo, sustituto y compatibilidad de cada candidato
  // ===========================================================================

  /**
   * El tipo de un candidato: el de la regla cuya palabra ABRE su nombre (el
   * sustantivo), con sus `requiere`/`excluye`; o «otro» con su primera palabra.
   * `conocido` dice si salió de la regla.
   */
  function tipoDe(item, clase) {
    var t = norm(item.nombre);
    if (clase) {
      for (var i = 0; i < clase.complementos.length; i++) {
        var c = clase.complementos[i];
        if (!c.palabras.test(t)) continue;
        if (c.requiere && !c.requiere.test(t)) continue;
        if (c.excluye && c.excluye.test(t)) continue;
        return { tipo: c.tipo, etiqueta: c.etiqueta, peso: c.peso, conocido: true, regla: c };
      }
    }
    return { tipo: 'otro:' + (t.split(' ')[0] || '?'), etiqueta: '', peso: 0.2, conocido: false, regla: null };
  }

  /**
   * El tipo de la propia ficha: por su nombre y, si el nombre abre con la marca o la
   * línea («Anthelios UVmune 400…»), por su característica «Producto» («Protector
   * solar»). Sin el respaldo, a un protector solar se le ofrecía otro (04/10/2026).
   * Si el nombre abre como la clase («Asador de carbón…»), la ficha es el artículo
   * principal: ahí «Producto» puede decir otra cosa (el del asador dice «Carbón», su
   * combustible, y el carbón dejaba de ofrecerse).
   */
  function tipoPropio(ctx) {
    var propio = tipoDe({ nombre: ctx.ficha.nombre }, ctx.clase);
    var abreComoClase = !!(ctx.clase && ctx.clase.titulo && ctx.clase.titulo.test(norm(ctx.ficha.nombre || '')));
    if (!propio.conocido && ctx.ficha.producto && !abreComoClase) propio = tipoDe({ nombre: ctx.ficha.producto }, ctx.clase);
    return propio;
  }

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
    // así uno complementa al otro: ahí el sustituto es el del MISMO tipo. En la
    // ficha de un accesorio, también (y además, el equipo mismo no se ofrece).
    if (ctx.clase.sustitutoPorTipo || ctx.accesorio) {
      var propio = tipoPropio(ctx);
      if (propio.conocido && tipoDe(item, ctx.clase).tipo === propio.tipo) return true;
      if (ctx.clase.sustitutoPorTipo) return false;
    }
    // «Combo lavadora + secadora» no complementa a la lavadora: la reemplaza.
    if (/^combo\b/.test(t)) return true;
    var c = claseDeNombre(t, reglas);
    if (c && c.id === ctx.clase.id) return true;
    // Un equipo que no dice su familia: «600E Amoled 6.6 Pulgadas Telcel».
    if (ctx.clase.dispositivo && !/\bpara\b/.test(t) && !esAccesorio(t, ctx.clase) &&
        /\b\d{1,2}(\.\d{1,2})?\s*(pulgadas|")/.test(t)) return true;
    return false;
  }

  /**
   * Qué tan bien le queda al artículo de la ficha:
   *   'exacto'   mismo modelo, plataforma, rango de pulgadas, medida o línea;
   *   'marca'    misma marca, sin modelo de por medio;
   *   'generico' no depende del equipo (un cargador USB-C);
   *   'familia'  misma familia pero sin modelo («Funda para iPhone»: ¿cuál?);
   *   null       no le queda: se descarta.
   * `regla` es la del tipo del candidato (sus candados: mismaMarca, mismaLinea,
   * mismoTamano, mismoGenero).
   */
  var SUFIJO_DE_VARIANTE = /^\s?(pro max|pro\+|pro|plus|ultra|max|mini|air|fe|lite|neo|smart)\b/;

  /** ¿El texto nombra ESE modelo y no otro de su familia? «honor 400» no es «honor 400 lite» ni «honor 4000». */
  function nombraModelo(nt, modelo) {
    for (var i = nt.indexOf(modelo); i > -1; i = nt.indexOf(modelo, i + 1)) {
      var antes = i > 0 ? nt.charAt(i - 1) : ' ';
      var resto = nt.slice(i + modelo.length);
      if (!/[a-z0-9]/.test(antes) && !/^[a-z0-9+]/.test(resto) && !SUFIJO_DE_VARIANTE.test(resto)) return true;
    }
    return false;
  }

  function compatibilidad(item, ctx, regla) {
    var t = String(item.nombre || '');
    var nt = norm(t);
    var marcaFicha = norm(ctx.ficha.marca);
    var mismaMarca = !!marcaFicha && (norm(item.marca) === marcaFicha || nt.indexOf('compatible con ' + marcaFicha) > -1);
    var exacto = false;

    if (ctx.familias.length) {
      var fams = familiasDe(t + ' ' + (item.marca || ''));
      var comun = fams.some(function (f) { return ctx.familias.indexOf(f) > -1; });
      if (fams.length && !comun) return null;
      var m = modeloDe(t);
      if (m && ctx.modelo && m !== ctx.modelo) return null;
      if (m && ctx.modelo && m === ctx.modelo) exacto = true;
      // El «Modelo comercial» de la ficha, dicho tal cual en el candidato, también es exacto:
      // así entran las marcas cuyo modelo no se sabe leer («Funda para Honor 400 Lite»).
      else if (!m && ctx.modeloComercial && ctx.modeloComercial.length > 3 && nombraModelo(nt, ctx.modeloComercial)) exacto = true;
      else if (comun && !mismaMarca) return 'familia';
    }
    if (ctx.plataforma) {
      var p = plataformaDe(t);
      if (p && p !== ctx.plataforma) return null;
      if (p) exacto = true;
    }
    if (ctx.pulgadas) {
      var r = rangoPulgadas(t);
      if (r && (ctx.pulgadas < r[0] || ctx.pulgadas > r[1])) return null;
      if (r) exacto = true;
    }
    if (regla) {
      if (regla.mismaMarca && !mismaMarca) return null;
      if (regla.mismaLinea && ctx.linea) {
        if (nt.indexOf(ctx.linea) === -1) return null;
        exacto = true;
      }
      if (regla.mismoTamano && ctx.tamano) {
        var tam = tamanoDe(t);
        if (tam && tam !== ctx.tamano) return null;
        if (tam) exacto = true;
      }
      if (regla.mismoGenero && ctx.genero && ctx.genero !== 'unisex') {
        var g = generoDe(t);
        if (g && g !== 'unisex' && g !== ctx.genero) return null;
      }
    }
    if (exacto) return 'exacto';
    if (mismaMarca) return 'marca';
    return 'generico';
  }

  var RANGO_COMPAT = { exacto: 0, marca: 1, generico: 2, familia: 3 };

  /**
   * ¿El precio es proporcionado? Tope del tipo, si no el de la clase, si no el
   * general (el doble).
   */
  function precioRazonable(item, ctx, reglas, regla) {
    if (typeof item.precio !== 'number' || !ctx.precioBase) return true;
    var tope = (regla && regla.topePrecio) || (ctx.clase && ctx.clase.topePrecio) || (reglas && reglas.topePrecio) || 2;
    // En lo barato la proporción no dice nada: junto a una sartén de $356, unas espátulas
    // de $519 son un complemento normal (corpus 04/10/2026). Ahí el tope es al menos 1.5.
    if (ctx.precioBase < ((reglas && reglas.pisoProporcion) || 1500)) tope = Math.max(tope, 1.5);
    return item.precio <= ctx.precioBase * tope;
  }

  /** ¿El nombre del candidato dice las variables que la regla exige? («Cápsulas … Dolce Gusto»). */
  function diceVariables(item, ctx, regla) {
    if (!regla || !regla.requiereVar) return true;
    var t = norm(item.nombre + ' ' + (item.marca || ''));
    return [].concat(regla.requiereVar).every(function (v) {
      var valor = ctx.vars[v];
      return !!valor && t.indexOf(norm(valor)) > -1;
    });
  }

  /**
   * Todos los candidatos que sirven, con su tipo y su compatibilidad.
   * `listas`: [{ origen, items, tipoBuscado? }]. Los de una búsqueda solo valen
   * si son del tipo que se buscó: buscar «mica iPhone 16» también trae fundas.
   */
  function candidatos(listas, ctx, reglas, excluir) {
    excluir = excluir || {};
    var vistos = {}, out = [];
    // Sin clase no hay complementos: sin reglas, los carruseles traen de todo (un
    // rebanador junto a un ventilador; una tetera junto a una aspiradora, 04/10/2026).
    // La tarjeta se queda con la subida y la promoción.
    if (!ctx.clase) return out;
    var titulo = norm(ctx.ficha.nombre);
    (listas || []).forEach(function (lista, nLista) {
      (lista.items || []).forEach(function (it) {
        if (!it || !it.id || !it.nombre || it.id === ctx.ficha.id) return;
        if (it.agotado) return;
        var tipo = tipoDe(it, ctx.clase);
        // Un tipo con «si» solo aplica a las fichas que casan: el molino es para la
        // espresso, no para la de cápsulas (aunque Liverpool lo ponga en su carrusel).
        if (tipo.regla && tipo.regla.si && !tipo.regla.si.test(titulo)) return;
        // Con el tipo de artículo reconocido, un complemento que la regla no conoce
        // no ocupa lugar (en el protector solar se colaba un shampoo íntimo).
        if (ctx.clase && !tipo.conocido) return;
        // «Artículos relacionados» son parecidos al artículo: fuera, salvo que sean un
        // complemento reconocido (Liverpool también pone ahí la funda del mismo modelo).
        if (excluir[it.id] && !tipo.conocido) return;
        if (lista.tipoBuscado && tipo.tipo !== lista.tipoBuscado) return;
        var clave = it.id;
        if (vistos[clave]) return;
        if (esSustituto(it, ctx, reglas)) return;
        var c = compatibilidad(it, ctx, tipo.regla);
        if (!c) return;
        // Sabiendo el modelo del equipo, una funda o una mica que no lo dice puede no ser
        // de su medida: mejor la búsqueda (o su sugerencia). Sin modelo, se queda la de la marca,
        // salvo en la ficha de un accesorio: a un cargador no se le pega la funda de UN iPhone.
        if (tipo.regla && tipo.regla.exacto && c !== 'exacto' && (ctx.modelo || ctx.modeloComercial || ctx.accesorio)) return;
        if (!diceVariables(it, ctx, tipo.regla)) return;
        if (!precioRazonable(it, ctx, reglas, tipo.regla)) return;
        vistos[clave] = true;
        out.push(Object.assign({}, it, {
          compat: c, tipo: tipo.tipo, etiquetaTipo: tipo.etiqueta, peso: tipo.peso, conocido: tipo.conocido,
          regla: undefined, origen: lista.origen, nLista: nLista, orden: out.length,
          consulta: lista.consulta || null
        }));
      });
    });
    return out;
  }

  /**
   * El mejor candidato de cada tipo: el del mismo modelo; luego el que no es
   * «familia»; luego el del carrusel antes que el de la búsqueda; luego la marca
   * antes que el genérico; y al final el orden de Liverpool. Para el par de un
   * aparato (secadora de una lavadora), los kilos más parecidos.
   */
  function mejorPorTipo(cands, ctx) {
    var porTipo = {};
    cands.forEach(function (c) { (porTipo[c.tipo] = porTipo[c.tipo] || []).push(c); });
    var mejores = {};
    Object.keys(porTipo).forEach(function (tipo) {
      porTipo[tipo].sort(function (a, b) {
        var ea = a.compat === 'exacto' ? 0 : 1, eb = b.compat === 'exacto' ? 0 : 1;
        if (ea !== eb) return ea - eb;
        var fa = a.compat === 'familia' ? 1 : 0, fb = b.compat === 'familia' ? 1 : 0;
        if (fa !== fb) return fa - fb;
        if (ctx.kilos) {
          var ka = kilosDe(a.nombre), kb = kilosDe(b.nombre);
          var da = ka ? Math.abs(ka - ctx.kilos) : 99, db = kb ? Math.abs(kb - ctx.kilos) : 99;
          if (da !== db) return da - db;
        }
        var oa = a.origen === 'busqueda' ? 1 : 0, ob = b.origen === 'busqueda' ? 1 : 0;
        if (oa !== ob) return oa - ob;
        return (RANGO_COMPAT[a.compat] - RANGO_COMPAT[b.compat]) || (a.orden - b.orden);
      });
      mejores[tipo] = porTipo[tipo][0];
    });
    return mejores;
  }

  /**
   * Hasta `maximo` complementos, UNO POR TIPO: primero los tipos con un
   * candidato del mismo modelo, luego por lo natural que es ofrecerlos (peso).
   */
  function elegirCruzada(listas, ctx, reglas, opciones) {
    var maximo = (opciones && opciones.maximo) || 3;
    var mejores = mejorPorTipo(candidatos(listas, ctx, reglas, opciones && opciones.excluir), ctx);
    return Object.keys(mejores).map(function (k) { return mejores[k]; }).sort(function (a, b) {
      var ea = a.compat === 'exacto' ? 0 : 1, eb = b.compat === 'exacto' ? 0 : 1;
      var fa = a.compat === 'familia' ? 1 : 0, fb = b.compat === 'familia' ? 1 : 0;
      return (fa - fb) || (ea - eb) || (b.peso - a.peso) || (a.orden - b.orden);
    }).slice(0, maximo);
  }

  /** Los tipos que la regla da por naturales para ESTA ficha (respeta `si`), del más al menos natural. */
  function tiposNaturales(ctx) {
    if (!ctx.clase) return [];
    var titulo = norm(ctx.ficha.nombre);
    var propio = tipoPropio(ctx);
    return ctx.clase.complementos.filter(function (c) {
      if (c.si && !c.si.test(titulo)) return false;
      // Nunca el tipo del propio artículo: en un protector solar, «busca un protector solar» es un sustituto.
      return !(propio.conocido && propio.tipo === c.tipo);
    }).sort(function (a, b) { return b.peso - a.peso; });
  }

  /** La búsqueda de un tipo, con la plantilla llena; null si le falta un dato. */
  function consultaDe(regla, ctx) {
    if (!regla || !regla.buscar) return null;
    var falta = false;
    var q = regla.buscar.replace(/\{(\w+)\}/g, function (_, k) {
      var v = ctx.vars[k];
      if (!v) falta = true;
      return v || '';
    }).replace(/\s+/g, ' ').trim();
    return falta || !q ? null : q;
  }

  /**
   * Qué buscar en liverpool.com.mx: de los tres tipos más naturales, los que
   * no tienen un buen candidato (ninguno, o uno «familia», o sin el modelo
   * exacto cuando el tipo lo exige). Como mucho `maximo`.
   */
  function planDeBusquedas(ctx, mejores, maximo) {
    var out = [];
    tiposNaturales(ctx).slice(0, 3).forEach(function (regla) {
      if (out.length >= (maximo || 2)) return;
      // Lo que no se puede comprobar que le quede (la tinta de UNA impresora) no se
      // busca solo: queda como botón, y el asesor elige con el cliente.
      if (regla.soloSugerir) return;
      var b = mejores[regla.tipo];
      var bueno = b && b.compat !== 'familia' && (!regla.exacto || b.compat === 'exacto');
      if (bueno) return;
      var q = consultaDe(regla, ctx);
      if (q) out.push({ tipo: regla.tipo, etiqueta: regla.etiqueta, consulta: q });
    });
    return out;
  }

  /** Búsquedas para abrir en Liverpool de los tipos naturales que se quedaron sin candidato. */
  function sugerirBusquedas(ctx, elegidos, maximo) {
    var hechos = {};
    (elegidos || []).forEach(function (e) { hechos[e.tipo] = true; });
    var out = [];
    tiposNaturales(ctx).forEach(function (regla) {
      if (out.length >= (maximo || 2) || hechos[regla.tipo]) return;
      var q = consultaDe(regla, ctx);
      if (q) out.push({ tipo: regla.tipo, etiqueta: regla.etiqueta, consulta: q });
    });
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
   * más cercano. No aplica donde otro artículo no es «más versión» (perfumes,
   * cuidado facial, ropa y calzado): ahí solo cuenta la capacidad de la ficha.
   */
  function subidaModelo(relacionados, ctx, reglas) {
    var base = ctx.precioBase;
    if (!base || !relacionados || !relacionados.length) return null;
    if (ctx.clase && ctx.clase.sinSubidaDeModelo) return null;
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

  /**
   * La más fuerte del Monitor: la que marcó el Portal (la cuenta de notas() del
   * Monitor) si sigue vigente; si no, la de mayor porcentaje entre las vigentes
   * (en empate, la primera de la hoja). Sin porcentajes, ninguna.
   */
  function promoMasFuerte(paquete, ahora) {
    var fuerte = paquete && paquete.fuerte;
    if (fuerte && fuerte.p > 0 && (!fuerte.f || fuerte.f >= ahora)) return fuerte;
    var vig = promosVigentes(paquete, ahora).filter(function (p) { return p.p > 0; });
    return vig.slice().sort(function (a, b) { return b.p - a.p; })[0] || null;
  }

  function mismaPromo(a, b) {
    return !!(a && b) && norm(a.d) === norm(b.d) && norm(a.c) === norm(b.c) && norm(a.t) === norm(b.t);
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
   * @param {Object} busquedas   (opcional) { consulta: [items] } lo que ya trajo la búsqueda
   */
  function recomendar(ficha, carruseles, paquete, reglas, ahora, busquedas) {
    var ctx = contexto(ficha, reglas);
    carruseles = carruseles || {};
    busquedas = busquedas || {};
    var relacionados = carruseles.relacionados || [];
    var excluir = {};
    relacionados.forEach(function (r) { if (r && r.id) excluir[r.id] = true; });

    var capacidad = subidaCapacidad(ficha);
    var modelo = subidaModelo(relacionados, ctx, reglas);

    var listas = [
      { origen: 'complementa', items: carruseles.complementa || [] },
      { origen: 'otros', items: carruseles.otros || [] }
    ];
    // El plan se decide SIN las búsquedas: así no cambia cuando llegan sus resultados.
    var plan = planDeBusquedas(ctx, mejorPorTipo(candidatos(listas, ctx, reglas, excluir), ctx), 2);
    plan.forEach(function (b) {
      if (busquedas[b.consulta]) {
        listas.push({ origen: 'busqueda', items: busquedas[b.consulta], tipoBuscado: b.tipo, consulta: b.consulta });
      }
    });
    var cruzada = elegirCruzada(listas, ctx, reglas, { maximo: 3, excluir: excluir });
    var sugeridas = sugerirBusquedas(ctx, cruzada, cruzada.length >= 3 ? 1 : 2);

    var deFicha = paquete ? promoParaFicha(paquete, ctx, ahora) : null;
    var fuerte = paquete ? promoMasFuerte(paquete, ahora) : null;
    var horas = paquete && paquete.generado ? (ahora - paquete.generado) / 3600000 : null;

    return {
      clase: ctx.clase ? { id: ctx.clase.id, nombre: ctx.clase.nombre } : null,
      modelo: ctx.vars.modelo,
      precioBase: ctx.precioBase,
      incremental: { capacidad: capacidad, modelo: modelo },
      cruzada: cruzada,
      busquedas: plan,
      sugeridas: sugeridas,
      // La marca de Liverpool Care viene en TODAS las fichas (corpus 04/10/2026: 81 de 81,
      // LEGO y almohadas incluidos): solo se ofrece en las clases de equipos, y no en sus
      // accesorios (una mica de $299 en «Celulares»).
      servicio: !!(ficha.care && ctx.clase && ctx.clase.servicio && !ctx.accesorio),
      promos: {
        hay: !!paquete,
        ficha: deFicha,       // la de su categoría (o su dirección)
        fuerte: fuerte,       // la más fuerte del Monitor
        mismaQueFicha: !!(deFicha && mismaPromo(deFicha.promo, fuerte)),
        horas: horas
      }
    };
  }

  raiz.VentelVM = {
    version: '1.4',
    norm: norm, num: num, pesos: pesos, bonito: bonito,
    clasificar: clasificar, claseDeNombre: claseDeNombre, migaUtil: migaUtil,
    familiasDe: familiasDe, modeloDe: modeloDe, plataformaDe: plataformaDe,
    pulgadasDe: pulgadasDe, rangoPulgadas: rangoPulgadas, tamanoDe: tamanoDe,
    kilosDe: kilosDe, generoDe: generoDe, lineaDe: lineaDe,
    contexto: contexto, precioBase: precioBase, varianteElegida: varianteElegida,
    esSustituto: esSustituto, compatibilidad: compatibilidad, tipoDe: tipoDe,
    candidatos: candidatos, mejorPorTipo: mejorPorTipo, elegirCruzada: elegirCruzada,
    tiposNaturales: tiposNaturales, consultaDe: consultaDe, planDeBusquedas: planDeBusquedas,
    sugerirBusquedas: sugerirBusquedas,
    maxMsi: maxMsi, subidaCapacidad: subidaCapacidad, subidaModelo: subidaModelo,
    promosVigentes: promosVigentes, promoMasFuerte: promoMasFuerte, promoParaFicha: promoParaFicha,
    recomendar: recomendar
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
