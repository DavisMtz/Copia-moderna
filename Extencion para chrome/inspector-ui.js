/**
 * =============================================================================
 * Ventel · Inspector de artículo — Interfaz (inspector-ui.js)
 * =============================================================================
 * Pinta lo que devuelve `inspectProductFromDOM()`. Cada sección se muestra solo
 * si trae datos, y se escribe SIEMPRE dentro de su `.seccion-cuerpo`: la versión
 * anterior vaciaba la <section> entera, así que borraba el <h2> y además usaba
 * clases que no existían en la hoja de estilos. De ahí que "no funcionara bien".
 *
 * Hecho por su gran amigo David Martínez "El escritor" · v2.0 · 13/08/2026
 */

(function () {
  'use strict';

  var estado = { tabId: null, datos: null };
  var temporizadorAviso = null;

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  function el(etiqueta, props, hijos) {
    var nodo = document.createElement(etiqueta);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'clase') nodo.className = v;
        else if (k === 'texto') nodo.textContent = v;
        else if (k === 'dataset') { for (var d in v) nodo.dataset[d] = v[d]; }
        else if (k === 'onclick') nodo.addEventListener('click', v);
        else nodo.setAttribute(k, v);
      }
    }
    (hijos || []).forEach(function (h) {
      if (h === null || h === undefined || h === false) return;
      nodo.appendChild(typeof h === 'string' ? document.createTextNode(h) : h);
    });
    return nodo;
  }

  function vaciar(nodo) { while (nodo && nodo.firstChild) nodo.removeChild(nodo.firstChild); }

  /** El cuerpo de una sección. Nunca se devuelve la sección entera: se borraría el título. */
  function cuerpo(idSeccion) {
    var sec = document.getElementById(idSeccion);
    if (!sec) return null;
    var caja = sec.querySelector('.seccion-cuerpo');
    if (!caja) { caja = el('div', { clase: 'seccion-cuerpo' }); sec.appendChild(caja); }
    vaciar(caja);
    return caja;
  }

  function mostrar(idSeccion, visible, conteo) {
    var sec = document.getElementById(idSeccion);
    if (!sec) return;
    sec.hidden = !visible;
    // Queda anotado si la sección tiene datos: el filtro necesita distinguir
    // "vacía de origen" de "escondida porque no casa con la búsqueda".
    sec.dataset.conDatos = visible ? 'si' : 'no';
    var marca = sec.querySelector('[data-conteo]');
    if (marca) marca.textContent = (visible && conteo !== undefined && conteo !== null) ? String(conteo) : '';
  }

  /** Sin acentos y en minúsculas: nadie escribe "batería" con tilde en un buscador. */
  function normalizar(t) {
    return String(t || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  function dinero(n) {
    if (n === null || n === undefined || !isFinite(Number(n))) return '—';
    return '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function textoODash(v) { return (v === null || v === undefined || v === '') ? '—' : String(v); }

  function aviso(texto) {
    var nodo = document.getElementById('aviso');
    if (!nodo) return;
    nodo.textContent = texto;
    nodo.hidden = false;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(function () { nodo.hidden = true; }, 3500);
  }

  /** Tabla de dos columnas etiqueta/valor, el formato que más se repite aquí. */
  function tablaPares(pares, claseExtra) {
    var tbody = el('tbody');
    pares.forEach(function (par) {
      if (!par) return;
      var valor = par[1];
      if (valor === null || valor === undefined || valor === '') return;
      var celda = (typeof valor === 'object' && valor.nodeType)
        ? el('td', null, [valor])
        : el('td', { texto: String(valor) });
      tbody.appendChild(el('tr', null, [el('td', { texto: par[0] }), celda]));
    });
    if (!tbody.childNodes.length) return null;
    return el('table', { clase: 'tabla-specs' + (claseExtra ? ' ' + claseExtra : '') }, [tbody]);
  }

  function chip(texto, clase) {
    return el('span', { clase: 'chip' + (clase ? ' ' + clase : ''), texto: texto });
  }

  // ---------------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------------
  function iniciar() {
    configurarBotones();
    cargarDatos();
  }

  function cargarDatos() {
    chrome.storage.local.get('productInspection', function (guardado) {
      var paquete = guardado && guardado.productInspection;
      if (!paquete || !paquete.data) {
        mostrarVacio('No hay ninguna inspección guardada. Abre la ficha de un artículo en Liverpool y pulsa «Inspeccionar artículo» en la extensión.');
        return;
      }
      estado.tabId = paquete.tabId || null;
      estado.datos = paquete.data;
      pintarTodo(estado.datos);
    });
  }

  function mostrarVacio(mensaje) {
    var hero = document.getElementById('hero');
    if (!hero) return;
    vaciar(hero);
    hero.classList.add('hero-vacio');
    hero.appendChild(el('div', { clase: 'alerta alerta-aviso' }, [
      el('strong', { texto: 'Sin datos que mostrar' }),
      el('p', { texto: mensaje })
    ]));
  }

  // ---------------------------------------------------------------------------
  // Pintado
  // ---------------------------------------------------------------------------
  function pintarTodo(datos) {
    var p = (datos && datos.product) || {};

    pintarCabecera(datos, p);
    pintarAvisos(datos.warnings);
    pintarHero(p);
    pintarResumen(datos, p);
    pintarIdentidad(datos, p);
    pintarPrecios(p);
    pintarVariantes(p);
    pintarColores(p);
    pintarTallas(p);
    pintarPagos(p);
    pintarPromociones(p);
    pintarOfertas(p);
    pintarCaracteristicas(p);
    pintarDescripcion(p);
    pintarClasificacion(p);
    pintarCalificacion(p);
    pintarDisponibilidad(p);
    pintarGaleria(p);
    pintarPoliticas(p);
    pintarMeta(p);
    pintarBarridoDom(p);
    pintarFuentes(datos);
    pintarCrudo(p.rawFlightData);
    construirIndice();
    aplicarFiltro(document.getElementById('buscar').value || '');
  }

  function pintarCabecera(datos, p) {
    var origen = document.getElementById('origen');
    if (origen) {
      var partes = [];
      if (p.brand) partes.push(p.brand);
      if (p.skuGeneral) partes.push('SKU ' + p.skuGeneral);
      if (datos.extractedAt) {
        var f = new Date(datos.extractedAt);
        if (!isNaN(f.getTime())) partes.push('leído ' + f.toLocaleString('es-MX'));
      }
      origen.textContent = partes.join(' · ') || 'Artículo sin identificar';
    }
    var boton = document.getElementById('btnAbrirLiverpool');
    if (boton) {
      var destino = p.url || datos.urlCanonica || datos.url;
      if (destino && /^https?:/i.test(destino)) boton.href = destino;
      else boton.setAttribute('aria-disabled', 'true');
    }
    document.title = (p.name ? p.name + ' · ' : '') + 'Inspector Ventel';
  }

  function pintarAvisos(avisos) {
    var caja = document.getElementById('avisos');
    if (!caja) return;
    vaciar(caja);
    if (!avisos || !avisos.length) { caja.hidden = true; return; }
    caja.hidden = false;
    var lista = el('ul', { clase: 'lista-avisos' });
    avisos.forEach(function (a) { lista.appendChild(el('li', { texto: a })); });
    caja.appendChild(el('div', { clase: 'alerta alerta-aviso' }, [
      el('strong', { texto: avisos.length === 1 ? 'Un detalle a tener en cuenta' : 'Detalles a tener en cuenta' }),
      lista
    ]));
  }

  function pintarHero(p) {
    var hero = document.getElementById('hero');
    if (!hero) return;
    vaciar(hero);
    hero.classList.remove('hero-vacio');

    // --- Galería ---
    var galeria = el('div', { clase: 'hero-galeria' });
    var marco = el('div', { clase: 'hero-imagen-principal' });
    var imagenes = p.images || [];
    var principal = el('img', { alt: p.name || 'Artículo', src: imagenes.length ? imagenes[0].url : '' });
    if (!imagenes.length) {
      marco.appendChild(el('span', { clase: 'sin-imagen', texto: 'Sin imagen' }));
    } else {
      marco.appendChild(principal);
    }
    galeria.appendChild(marco);

    if (imagenes.length > 1) {
      var tira = el('div', { clase: 'hero-miniaturas' });
      imagenes.slice(0, 12).forEach(function (img, i) {
        var mini = el('button', {
          clase: 'miniatura' + (i === 0 ? ' activa' : ''),
          type: 'button',
          'aria-label': 'Ver imagen ' + (i + 1)
        }, [el('img', { src: img.url, alt: img.alt || '' })]);
        mini.addEventListener('click', function () {
          principal.src = img.url;
          Array.prototype.forEach.call(tira.children, function (c) { c.classList.remove('activa'); });
          mini.classList.add('activa');
        });
        tira.appendChild(mini);
      });
      galeria.appendChild(tira);
    }

    // --- Ficha ---
    var info = el('div', { clase: 'hero-info' });
    if (p.brand) info.appendChild(el('p', { clase: 'hero-marca', texto: p.brand }));
    info.appendChild(el('h2', { clase: 'hero-titulo', texto: p.name || 'Artículo sin nombre' }));

    var claves = el('div', { clase: 'tira-chips' });
    if (p.skuGeneral) claves.appendChild(chip('SKU general ' + p.skuGeneral, 'chip-fuerte'));
    if (p.varianteActual) claves.appendChild(chip('Variante ' + p.varianteActual));
    if (p.skuVariante && p.skuVariante !== p.varianteActual) claves.appendChild(chip('skuid ' + p.skuVariante));
    if (claves.childNodes.length) info.appendChild(claves);

    info.appendChild(bloquePrecio(p));

    // Vendedor y estado
    var estadoLinea = el('div', { clase: 'hero-estado' });
    var enStock = p.availability && p.availability.inStock;
    estadoLinea.appendChild(el('span', { clase: 'estado-punto' }, [
      el('span', { clase: 'stock-dot ' + (enStock ? 'disponible' : 'agotado') }),
      el('span', { texto: enStock ? 'Disponible' : 'Sin existencias' })
    ]));
    if (p.seller && p.seller.name) {
      var vendedor = p.seller.isMarketplace
        ? 'Marketplace · ' + p.seller.name
        : 'Vendido por ' + p.seller.name;
      if (p.seller.url) {
        estadoLinea.appendChild(el('a', { href: p.seller.url, target: '_blank', rel: 'noopener', texto: vendedor }));
      } else {
        estadoLinea.appendChild(el('span', { texto: vendedor }));
      }
    }
    info.appendChild(estadoLinea);

    if (p.seleccion && (p.seleccion.color || p.seleccion.talla)) {
      var elegido = [];
      if (p.seleccion.color) elegido.push('Color: ' + p.seleccion.color);
      if (p.seleccion.talla) elegido.push('Talla: ' + p.seleccion.talla);
      info.appendChild(el('p', { clase: 'hero-nota', texto: 'En pantalla → ' + elegido.join(' · ') }));
    }
    if (p.description) {
      info.appendChild(el('p', { clase: 'hero-descripcion', texto: recortar(p.description, 320) }));
    }

    hero.appendChild(galeria);
    hero.appendChild(info);
  }

  /** Un precio de verdad. `null > null` y `18999 > null` mienten los dos. */
  function esNumero(v) { return v !== null && v !== undefined && isFinite(Number(v)); }

  function bloquePrecio(p) {
    var precios = p.prices || {};
    var caja = el('div', { clase: 'bloque-precio' });

    var hayRango = precios.esRango && esNumero(precios.minPromo) && esNumero(precios.maxPromo) &&
                   precios.minPromo !== precios.maxPromo;

    if (hayRango) {
      caja.appendChild(el('span', { clase: 'precio-actual', texto: dinero(precios.minPromo) + ' – ' + dinero(precios.maxPromo) }));
      caja.appendChild(el('span', { clase: 'precio-nota', texto: 'rango: falta elegir variante' }));
      if (esNumero(precios.minLista) && esNumero(precios.maxLista)) {
        caja.appendChild(el('span', { clase: 'precio-original', texto: dinero(precios.minLista) + ' – ' + dinero(precios.maxLista) }));
      }
    } else {
      caja.appendChild(el('span', { clase: 'precio-actual', texto: dinero(precios.current) }));
      // Solo se tacha un precio de lista cuando existen los DOS números y el de
      // lista es mayor. Sin esta guarda se tachaba un precio ausente.
      if (esNumero(precios.original) && esNumero(precios.current) && precios.original > precios.current) {
        caja.appendChild(el('span', { clase: 'precio-original', texto: dinero(precios.original) }));
      }
    }
    if (precios.discountPercent) {
      caja.appendChild(el('span', { clase: 'insignia-descuento', texto: '−' + precios.discountPercent + '%' }));
    }
    if (precios.savings) {
      caja.appendChild(el('span', { clase: 'precio-ahorro', texto: 'Ahorro ' + dinero(precios.savings) }));
    }
    return caja;
  }

  function recortar(t, n) {
    var limpio = String(t).replace(/\s+/g, ' ').trim();
    return limpio.length > n ? limpio.slice(0, n - 1) + '…' : limpio;
  }

  function pintarResumen(datos, p) {
    var caja = document.getElementById('resumen');
    if (!caja) return;
    vaciar(caja);
    // Cifras que no se pisen entre sí: antes convivían "3 planes de pago" y
    // "9 promociones", que son lo mismo contado de dos maneras distintas.
    var vendedores = {};
    (p.variants || []).forEach(function (v) { if (v.seller && v.seller.name) vendedores[v.seller.name] = true; });
    var mejor = null;
    (p.paymentPlans || []).forEach(function (plan) {
      if (!plan.noInterest) return;
      if (!mejor || plan.months > mejor.months) mejor = plan;
    });

    var fichas = [
      ['Variantes', (p.variants || []).length],
      ['Características', (p.specifications || []).length],
      ['Imágenes', (p.images || []).length],
      ['Vendedores', Object.keys(vendedores).length]
    ];
    if (mejor) fichas.push(['Mejor plan a meses', mejor.months + ' × ' + dinero(mejor.monthlyPayment)]);
    if (p.rating && esNumero(p.rating.average)) fichas.push(['Calificación', p.rating.average + ' / 5']);
    fichas.forEach(function (f) {
      caja.appendChild(el('div', { clase: 'tarjeta-resumen' }, [
        el('span', { clase: 'tarjeta-cifra', texto: String(f[1]) }),
        el('span', { clase: 'tarjeta-etiqueta', texto: f[0] })
      ]));
    });
  }

  /**
   * Identidad. Liverpool llama de cuatro maneras al MISMO número (SKU general,
   * "código de producto", id de catálogo y a veces el de la URL). Antes salían
   * las cuatro filas con el mismo valor repetido y parecía que había cuatro
   * claves distintas. Ahora cada número aparece UNA vez, con todos sus nombres.
   */
  function pintarIdentidad(datos, p) {
    var caja = cuerpo('secIdentidad');
    if (!caja) return;
    var ident = p.identifiers || {};

    // Se agrupan los alias por valor: mismo número, una sola fila.
    var alias = [
      ['SKU general (padre)', p.skuGeneral],
      ['código de producto', p.productCode],
      ['id de catálogo', ident.productId],
      ['SKU de la variante en pantalla', p.varianteActual],
      ['skuid de la URL', p.skuVariante],
      ['SKU de la tarjeta del vendedor', p.skuTarjetaVendedor]
    ];
    var porValor = {}, ordenValores = [];
    alias.forEach(function (a) {
      var valor = a[1];
      if (valor === null || valor === undefined || valor === '') return;
      if (!porValor[valor]) { porValor[valor] = []; ordenValores.push(valor); }
      porValor[valor].push(a[0]);
    });

    var filas = [
      ['Nombre', p.name],
      ['Marca', p.brand],
      ['Cadena', p.cadena === 'LP' ? 'Liverpool (LP)' : (p.cadena === 'SUB' ? 'Suburbia (SUB)' : p.cadena)]
    ];
    ordenValores.forEach(function (valor) {
      var nombres = porValor[valor];
      var etiqueta = nombres[0].charAt(0).toUpperCase() + nombres[0].slice(1);
      var celda = el('span', null, [
        el('span', { clase: 'mono valor-clave', texto: valor }),
        nombres.length > 1
          ? el('span', { clase: 'alias-clave', texto: 'también llamado ' + nombres.slice(1).join(', ') })
          : null
      ]);
      filas.push([etiqueta, celda]);
    });
    filas.push(['SKU del vendedor (marketplace)', ident.sellerSkuId]);
    filas.push(['GTIN', ident.gtin]);
    filas.push(['MPN', ident.mpn]);
    if (p.url && /^https?:/i.test(p.url)) {
      filas.push(['Ficha', el('a', { href: p.url, target: '_blank', rel: 'noopener', texto: p.url })]);
    }

    var tabla = tablaPares(filas);
    if (tabla) caja.appendChild(tabla);
    mostrar('secIdentidad', !!tabla);
  }

  /**
   * Precios. Cuando la ficha muestra un rango, el mínimo y el máximo YA son
   * "el precio más bajo y más alto del catálogo": repetirlos en cuatro filas
   * más era el ruido que hacía ilegible esta tabla.
   */
  function pintarPrecios(p) {
    var caja = cuerpo('secPrecios');
    if (!caja) return;
    var pr = p.prices || {};
    var filas;

    if (pr.esRango) {
      filas = [
        ['Precio en pantalla', dinero(pr.minPromo) + '  a  ' + dinero(pr.maxPromo)],
        ['Precio de lista', (esNumero(pr.minLista) && esNumero(pr.maxLista)) ? dinero(pr.minLista) + '  a  ' + dinero(pr.maxLista) : null],
        ['Descuento de la variante más barata', pr.discountPercent ? pr.discountPercent + '%  (ahorro ' + dinero(pr.savings) + ')' : null],
        ['Moneda', pr.currency]
      ];
      caja.appendChild(el('p', { clase: 'nota-seccion nota-arriba', texto: 'La ficha enseña un rango porque todavía no hay una variante elegida del todo. El precio exacto de cada una está en la tabla de variantes.' }));
    } else {
      filas = [
        ['Precio actual', esNumero(pr.current) ? dinero(pr.current) : null],
        ['Precio de lista', esNumero(pr.original) ? dinero(pr.original) : null],
        ['Descuento', pr.discountPercent ? pr.discountPercent + '%' : null],
        ['Ahorro', pr.savings ? dinero(pr.savings) : null],
        ['Moneda', pr.currency]
      ];
    }

    var tabla = tablaPares(filas);
    if (tabla) caja.appendChild(tabla);
    mostrar('secPrecios', !!tabla);
  }

  function pintarVariantes(p) {
    var caja = cuerpo('secVariantes');
    var variantes = p.variants || [];
    if (!caja || !variantes.length) { mostrar('secVariantes', false); return; }

    var cabecera = el('thead', null, [el('tr', null, [
      el('th', { texto: 'SKU' }),
      el('th', { texto: 'Color' }),
      el('th', { texto: 'Talla / capacidad' }),
      el('th', { clase: 'num', texto: 'Lista' }),
      el('th', { clase: 'num', texto: 'Precio' }),
      el('th', { clase: 'num', texto: 'Desc.' }),
      el('th', { texto: 'Vendedor' }),
      el('th', { texto: 'Mejor plan' }),
      el('th', { texto: 'Existencias' })
    ])]);

    var cuerpoTabla = el('tbody');
    variantes.forEach(function (v) {
      var color = v.colorComercial || v.color || '—';
      if (v.colorComercial && v.color && v.colorComercial !== v.color) color = v.colorComercial + ' (' + v.color + ')';
      var mejor = v.bestPromotion && v.bestPromotion.months
        ? v.bestPromotion.months + ' × ' + dinero(v.bestPromotion.monthlyPayment)
        : '—';
      var muestra = v.colorHex
        ? el('span', { clase: 'muestra-color', style: 'background:' + v.colorHex, title: v.colorHex })
        : null;

      var fila = el('tr', { clase: v.esActual ? 'fila-activa' : '' }, [
        el('td', { clase: 'mono' }, [
          document.createTextNode(v.sku || '—'),
          v.esActual ? el('span', { clase: 'etiqueta-mini', texto: 'en pantalla' }) : null
        ]),
        el('td', null, [muestra, document.createTextNode(color)]),
        el('td', { texto: textoODash(v.size) }),
        el('td', { clase: 'num', texto: v.listPrice !== null ? dinero(v.listPrice) : '—' }),
        el('td', { clase: 'num', texto: v.price !== null ? dinero(v.price) : '—' }),
        el('td', { clase: 'num', texto: v.discountPercent ? v.discountPercent + '%' : '—' }),
        el('td', { texto: (v.seller && v.seller.name) || '—' }),
        el('td', { texto: mejor }),
        el('td', null, [
          el('span', { clase: 'stock-dot ' + (v.inStock ? 'disponible' : 'agotado') }),
          document.createTextNode(v.inStock ? 'Sí' : 'No')
        ])
      ]);
      cuerpoTabla.appendChild(fila);
    });

    caja.appendChild(el('div', { clase: 'tabla-scroll' }, [
      el('table', { clase: 'tabla-variantes' }, [cabecera, cuerpoTabla])
    ]));
    mostrar('secVariantes', true, variantes.length);
  }

  function pintarColores(p) {
    var caja = cuerpo('secColores');
    var colores = p.colors || [];
    if (!caja || !colores.length) { mostrar('secColores', false); return; }

    // Cada color es en realidad una variante: enseñar su precio aquí ahorra
    // tener que cruzarlo a mano con la tabla de variantes.
    var porSku = {};
    (p.variants || []).forEach(function (v) { porSku[v.sku] = v; });

    var rejilla = el('div', { clase: 'colores-rejilla' });
    colores.forEach(function (c) {
      var v = porSku[c.sku];
      var marco = el('div', { clase: 'color-img' });
      if (c.imageUrl) marco.appendChild(el('img', { src: c.imageUrl, alt: c.name || 'Color' }));
      else if (c.hex) marco.style.background = c.hex;

      rejilla.appendChild(el('div', { clase: 'color-swatch' + (c.selected ? ' activo' : '') }, [
        marco,
        el('span', { clase: 'color-nombre', texto: c.name || '—' }),
        (v && v.size) ? el('span', { clase: 'color-dato', texto: v.size }) : null,
        (v && esNumero(v.price)) ? el('span', { clase: 'color-precio', texto: dinero(v.price) }) : null,
        c.sku ? el('span', { clase: 'color-sku mono', texto: c.sku }) : null,
        (c.conOferta === false) ? el('span', { clase: 'color-dato', texto: 'sin oferta' }) : null,
        c.selected ? el('span', { clase: 'etiqueta-mini', texto: 'en pantalla' }) : null
      ]));
    });
    caja.appendChild(rejilla);
    mostrar('secColores', true);
  }

  function pintarTallas(p) {
    var caja = cuerpo('secTallas');
    var tallas = p.sizes || [];
    if (!caja || !tallas.length) { mostrar('secTallas', false); return; }

    var rejilla = el('div', { clase: 'tallas-rejilla' });
    tallas.forEach(function (t) {
      var clase = 'talla-chip';
      if (t.selected) clase += ' activo';
      if (!t.available) clase += ' agotado';
      rejilla.appendChild(el('span', { clase: clase, texto: t.label || t.value || '—' }));
    });
    caja.appendChild(rejilla);
    caja.appendChild(el('p', { clase: 'nota-seccion', texto: 'Las tallas marcadas como agotadas lo están para el color que la ficha tiene en foco, no necesariamente para todo el artículo.' }));
    mostrar('secTallas', true);
  }

  function pintarPagos(p) {
    var caja = cuerpo('secPagos');
    var planes = (p.paymentPlans || []).filter(function (x) { return x.months > 0; });
    var unico = (p.paymentPlans || []).filter(function (x) { return !x.months; });
    if (!caja || (!planes.length && !unico.length)) { mostrar('secPagos', false); return; }

    if (planes.length) {
      var rejilla = el('div', { clase: 'planes-rejilla' });
      planes.forEach(function (plan) {
        rejilla.appendChild(el('div', { clase: 'plan' + (plan.noInterest ? ' msi' : '') }, [
          el('span', { clase: 'plan-monto', texto: dinero(plan.monthlyPayment) }),
          el('span', { clase: 'plan-titulo', texto: plan.months + (plan.noInterest ? ' meses sin intereses' : ' pagos') }),
          el('span', { clase: 'plan-detalle', texto: plan.description || '' }),
          el('span', {
            clase: 'plan-detalle',
            texto: [nombresDeCubetas(plan.origenes, plan.origen),
                    plan.promoCode ? 'código ' + plan.promoCode : null,
                    plan.minPurchaseAmount ? 'compra mínima ' + dinero(plan.minPurchaseAmount) : null
                   ].filter(Boolean).join(' · ')
          })
        ]));
      });
      caja.appendChild(rejilla);
    }
    if (unico.length) {
      caja.appendChild(el('p', {
        clase: 'nota-seccion',
        texto: 'Además admite pago único' + (unico[0].promoCode ? ' (código ' + unico[0].promoCode + ')' : '') + '.'
      }));
    }
    mostrar('secPagos', true);
  }

  /** "liverpoolEMI" y compañía son cubetas del catálogo; en pantalla, tarjetas. */
  var NOMBRE_CUBETA = {
    liverpool: 'Tarjeta Liverpool',
    liverpoolEMI: 'Tarjeta Liverpool a meses',
    other: 'Otras tarjetas',
    otherEMI: 'Otras tarjetas a meses',
    specialEMI: 'Meses especiales',
    miniPagos: 'Mini pagos',
    specialPromotions: 'Promociones especiales',
    bestPromotion: 'La que anuncia la ficha'
  };

  function nombresDeCubetas(origenes, origen) {
    var lista = (origenes && origenes.length) ? origenes : (origen ? [origen] : []);
    return lista.map(function (o) { return NOMBRE_CUBETA[o] || o; }).join(' · ');
  }

  /**
   * Promociones por variante. Solo los planes de MESES: el "pago único" no es
   * una promoción, es no tener ninguna, y llenaba la tabla de filas con guiones.
   */
  function pintarPromociones(p) {
    var caja = cuerpo('secPromos');
    var promos = (p.promotions || []).filter(function (x) { return x.meses > 0; });
    var envios = (p.promotions || []).filter(function (x) { return x.tipo === 'envío'; });
    if (!caja || (!promos.length && !envios.length)) { mostrar('secPromos', false); return; }

    // Para poner nombre a cada SKU sin obligar a cruzar tablas a mano.
    var nombrePorSku = {};
    (p.variants || []).forEach(function (v) {
      nombrePorSku[v.sku] = [v.colorComercial || v.color, v.size].filter(Boolean).join(' / ');
    });

    if (envios.length) {
      var tira = el('div', { clase: 'tira-chips' });
      envios.forEach(function (e) { tira.appendChild(chip(e.descripcion, 'chip-acento')); });
      caja.appendChild(tira);
    }

    if (promos.length) {
      var cabecera = el('thead', null, [el('tr', null, [
        el('th', { texto: 'Variante' }),
        el('th', { clase: 'num', texto: 'Meses' }),
        el('th', { clase: 'num', texto: 'Mensualidad' }),
        el('th', { texto: 'Con qué tarjeta' }),
        el('th', { texto: 'Código' })
      ])]);
      var cuerpoTabla = el('tbody');
      promos.forEach(function (pr) {
        var etiquetaSku = nombrePorSku[pr.sku]
          ? nombrePorSku[pr.sku] + '  ·  ' + pr.sku
          : (pr.sku || '—');
        cuerpoTabla.appendChild(el('tr', null, [
          el('td', { texto: etiquetaSku }),
          el('td', { clase: 'num' }, [chip(pr.meses + ' MSI', 'chip-acento')]),
          el('td', { clase: 'num', texto: esNumero(pr.mensualidad) ? dinero(pr.mensualidad) : '—' }),
          el('td', { texto: nombresDeCubetas(pr.origenes, pr.origen) || '—' }),
          el('td', { clase: 'mono', texto: textoODash(pr.codigo) })
        ]));
      });
      caja.appendChild(el('div', { clase: 'tabla-scroll' }, [
        el('table', { clase: 'tabla-variantes' }, [cabecera, cuerpoTabla])
      ]));
    }

    var unicos = (p.promotions || []).filter(function (x) { return x.tipo === 'pago único'; });
    if (unicos.length) {
      caja.appendChild(el('p', { clase: 'nota-seccion', texto: 'Todas las variantes admiten además pago único (sin meses).' }));
    }
    mostrar('secPromos', true, promos.length);
  }

  function pintarOfertas(p) {
    var caja = cuerpo('secOfertas');
    var ofertas = p.ofertas || [];
    if (!caja || !ofertas.length) { mostrar('secOfertas', false); return; }

    ofertas.forEach(function (o) {
      var tabla = tablaPares([
        ['Vendedor', o.sellerName],
        ['Id del vendedor', o.sellerId],
        ['Id de la oferta', o.offerId],
        ['SKU del vendedor', o.sellerSkuId],
        ['Precio', o.promoPrice !== null ? dinero(o.promoPrice) : (o.price !== null ? dinero(o.price) : null)],
        ['Precio de lista', o.listPrice !== null ? dinero(o.listPrice) : null],
        ['Rango histórico', (o.minimumPrice !== null && o.maximumPrice !== null) ? dinero(o.minimumPrice) + ' – ' + dinero(o.maximumPrice) : null],
        ['Días para enviar', o.leadTimeToShip],
        ['Admite promociones Liverpool', o.allowLpPromotions ? 'Sí' : 'No'],
        ['Reseñas del vendedor', o.totalReviews],
        ['Entrega estimada', o.entregaEstimada],
        ['Importación', o.crossBorder]
      ]);
      if (tabla) caja.appendChild(el('div', { clase: 'ficha-oferta' }, [tabla]));
    });
    mostrar('secOfertas', !!caja.childNodes.length);
  }

  function pintarCaracteristicas(p) {
    var caja = cuerpo('secSpecs');
    var secciones = p.specSections || [];
    var total = (p.specifications || []).length;
    if (!caja || !total) { mostrar('secSpecs', false); return; }

    if (!secciones.length) secciones = [{ section: 'Características', items: p.specifications }];
    secciones.forEach(function (s) {
      var tabla = tablaPares((s.items || []).map(function (it) { return [it.label, it.value]; }));
      if (!tabla) return;
      caja.appendChild(el('div', { clase: 'grupo-specs' }, [
        el('h3', { clase: 'titulo-grupo', texto: s.section || 'Otros' }),
        tabla
      ]));
    });
    mostrar('secSpecs', true, total);
  }

  function pintarDescripcion(p) {
    var caja = cuerpo('secDescripcion');
    if (!caja || !p.description) { mostrar('secDescripcion', false); return; }
    caja.appendChild(el('p', { clase: 'texto-largo', texto: p.description }));
    if (p.descriptionMeta && p.descriptionMeta !== p.description) {
      caja.appendChild(el('p', { clase: 'nota-seccion', texto: 'Meta descripción: ' + p.descriptionMeta }));
    }
    mostrar('secDescripcion', true);
  }

  function pintarClasificacion(p) {
    var caja = cuerpo('secCategoria');
    var cat = p.category || {};
    if (!caja || (!(cat.breadcrumbs || []).length && !(cat.categorias || []).length)) {
      mostrar('secCategoria', false);
      return;
    }
    if ((cat.breadcrumbs || []).length) {
      caja.appendChild(el('p', { clase: 'migas', texto: cat.breadcrumbs.join('  ›  ') }));
    }
    var tabla = tablaPares([
      ['Departamento', cat.department],
      // "Soft Line" / "Hard Line" es la división interna de Liverpool, no la
      // categoría del artículo: sin decirlo, se lee como si el teléfono fuera
      // de mercería.
      ['División interna de Liverpool', cat.productType]
    ]);
    if (tabla) caja.appendChild(tabla);
    (cat.categorias || []).forEach(function (c) {
      caja.appendChild(el('p', { clase: 'nota-seccion', texto: (c.ruta || c.hoja || '') + (c.id ? '  ·  ' + c.id : '') }));
    });
    mostrar('secCategoria', true);
  }

  function pintarCalificacion(p) {
    var caja = cuerpo('secRating');
    var r = p.rating || {};
    if (!caja || (!esNumero(r.average) && !esNumero(r.averageEstrellas) && !esNumero(r.count))) {
      mostrar('secRating', false);
      return;
    }

    // Sin promedio NO se pintan estrellas: cinco estrellas vacías se leen como
    // "0 de 5", que es una calificación, no una ausencia de dato.
    var fila = el('div', { clase: 'rating-fila' });
    if (esNumero(r.average)) {
      var estrellas = el('div', { clase: 'estrellas', 'aria-hidden': 'true' });
      var llenas = Math.round(Number(r.averageEstrellas !== null && r.averageEstrellas !== undefined ? r.averageEstrellas : r.average));
      for (var i = 1; i <= 5; i++) {
        estrellas.appendChild(el('span', { clase: 'estrella' + (i <= llenas ? ' llena' : ''), texto: '★' }));
      }
      fila.appendChild(estrellas);
      fila.appendChild(el('span', { texto: r.average + ' de 5' + (r.redondeado ? ' (redondeado)' : '') }));
    } else {
      fila.appendChild(el('span', { texto: 'Sin promedio publicado' }));
    }
    if (esNumero(r.count)) fila.appendChild(el('span', { clase: 'rating-conteo', texto: r.count + ' opiniones' }));
    caja.appendChild(fila);

    if (esNumero(r.averageEstrellas) && esNumero(r.average) && r.averageEstrellas !== r.average) {
      caja.appendChild(el('p', { clase: 'nota-seccion', texto: 'Las estrellas de la ficha muestran ' + r.averageEstrellas + ', que es el promedio redondeado a media estrella.' }));
    }
    if (r.source) caja.appendChild(el('p', { clase: 'nota-seccion', texto: 'Origen del dato: ' + r.source }));
    mostrar('secRating', true);
  }

  function pintarDisponibilidad(p) {
    var caja = cuerpo('secDisponibilidad');
    var a = p.availability || {};
    var limite = a.limitedStock || {};
    if (!caja) return;
    var tabla = tablaPares([
      ['Existencias', a.inStock ? 'Sí' : 'No'],
      ['Botón de compra activo', a.buyButtonEnabled ? 'Sí' : 'No'],
      ['Entrega estimada', a.deliveryEstimate],
      ['Recoger en tienda', a.hasClickAndCollect ? 'Sí' : null],
      ['Entrega a domicilio', a.hasHomeDelivery ? 'Sí' : null],
      ['Tiendas', (a.tiendas || []).join(', ')],
      ['Inventario limitado', limite.inventarioLimitado ? 'Sí' : null],
      ['Preventa', limite.preventa ? 'Sí' : null],
      ['Bajo pedido', limite.bajoPedido ? 'Sí' : null],
      ['Agotado en marketplace', limite.agotadoMarketplace ? 'Sí' : null]
    ]);
    if (tabla) caja.appendChild(tabla);

    // Las banderas del catálogo dichas en cristiano. "Talla De Ropa" en un
    // teléfono no significa nada para nadie; que el selector de tallas use el
    // formato de ropa, sí.
    var ETIQUETA_BANDERA = {
      esMarketplace: 'Lo vende un tercero por marketplace',
      esColeccion: 'Se vende como colección de varios artículos',
      esMesaDeRegalos: 'Se puede añadir a una mesa de regalos',
      tieneGarantias: 'Ofrece garantía extendida de pago',
      tieneServiciosConfort: 'Ofrece servicios de instalación o armado',
      tieneProteccionCelular: 'Ofrece seguro de protección para celular',
      tieneRegaloPromocional: 'Trae un regalo promocional',
      tallaDeRopa: 'El selector de tallas usa el formato de ropa',
      truefit: 'Tiene probador de tallas Truefit'
    };
    var banderas = p.flags || {};
    var activas = Object.keys(ETIQUETA_BANDERA).filter(function (k) { return banderas[k] === true; });
    if (activas.length) {
      var tira = el('div', { clase: 'tira-chips' });
      activas.forEach(function (k) { tira.appendChild(chip(ETIQUETA_BANDERA[k])); });
      caja.appendChild(el('h3', { clase: 'titulo-grupo', texto: 'Qué admite este artículo' }));
      caja.appendChild(tira);
    }
    if (banderas.mensajeRegalo) {
      caja.appendChild(el('p', { clase: 'nota-seccion', texto: 'Regalo: ' + banderas.mensajeRegalo }));
    }
    mostrar('secDisponibilidad', !!caja.childNodes.length);
  }

  function separarCamello(clave) {
    return String(clave).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function pintarGaleria(p) {
    var caja = cuerpo('secGaleria');
    var imagenes = p.images || [];
    if (!caja || !imagenes.length) { mostrar('secGaleria', false); return; }

    var rejilla = el('div', { clase: 'galeria-completa' });
    imagenes.forEach(function (img) {
      rejilla.appendChild(el('a', { clase: 'galeria-item', href: img.url, target: '_blank', rel: 'noopener' }, [
        el('span', { clase: 'galeria-img' }, [el('img', { src: img.url, alt: img.alt || 'Imagen del artículo' })]),
        el('span', { clase: 'galeria-tipo', texto: img.type || 'imagen' })
      ]));
    });
    caja.appendChild(rejilla);
    mostrar('secGaleria', true, imagenes.length);
  }

  /** Las claves de los avisos vienen en inglés dentro del catálogo. */
  var TITULO_AVISO = {
    latest_parts: 'Últimas piezas',
    limited_pieces: 'Piezas limitadas',
    electronic_purse: 'Monedero electrónico',
    exclusive_package: 'Paquete exclusivo',
    cross_border: 'Producto de importación',
    free_shipping: 'Envío gratis'
  };

  /** Título de una política: el primer <strong> del propio documento. */
  function tituloDePolitica(html, respaldo) {
    var m = String(html || '').match(/<strong[^>]*>([^<]{3,80})<\/strong>/i);
    if (m) return m[1].trim();
    return respaldo;
  }

  function pintarPoliticas(p) {
    var caja = cuerpo('secPoliticas');
    var pol = p.politicas || {};
    if (!caja) return;
    var hayAlgo = false;

    function bloqueHtml(titulo, html) {
      if (!html) return;
      hayAlgo = true;
      // Nada de innerHTML con texto que viene de una página ajena: se pasa a
      // texto plano y se conserva el salto de párrafo.
      var plano = String(html)
        .replace(/<\s*(br|\/p|\/li|\/div)\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (!plano) return;
      caja.appendChild(el('details', { clase: 'politica' }, [
        el('summary', { texto: titulo }),
        el('p', { clase: 'texto-largo', texto: plano })
      ]));
    }

    bloqueHtml('Garantía', pol.garantia);
    bloqueHtml('Liverpool Care', pol.liverpoolCare);
    (pol.documentos || []).forEach(function (d, i) {
      bloqueHtml(d.titulo || tituloDePolitica(d.html, 'Condiciones de entrega ' + (i + 1)), d.html);
    });
    var avisosTexto = pol.avisos || {};
    Object.keys(avisosTexto).forEach(function (k) {
      bloqueHtml(TITULO_AVISO[k] || separarCamello(k.replace(/_/g, ' ')), avisosTexto[k]);
    });

    mostrar('secPoliticas', hayAlgo);
  }

  function pintarMeta(p) {
    var caja = cuerpo('secMeta');
    var meta = p.meta || {};
    var claves = Object.keys(meta);
    if (!caja || !claves.length) { mostrar('secMeta', false); return; }
    var tabla = tablaPares(claves.map(function (k) { return [k, meta[k]]; }));
    if (tabla) caja.appendChild(tabla);
    mostrar('secMeta', !!tabla);
  }

  function pintarBarridoDom(p) {
    var caja = cuerpo('secDom');
    var dom = p.dom || {};
    var pares = dom.pares || [];
    var bloques = dom.bloques || [];
    if (!caja || (!pares.length && !bloques.length)) { mostrar('secDom', false); return; }

    if (pares.length) {
      caja.appendChild(el('h3', { clase: 'titulo-grupo', texto: 'Pares «etiqueta: valor» de la página' }));
      var tabla = tablaPares(pares.map(function (x) { return [x.label, x.value]; }));
      if (tabla) caja.appendChild(tabla);
    }
    if (bloques.length) {
      caja.appendChild(el('h3', { clase: 'titulo-grupo', texto: 'Bloques del artículo' }));
      var lista = el('div', { clase: 'lista-bloques' });
      bloques.forEach(function (b) {
        lista.appendChild(el('div', { clase: 'bloque-dom' }, [
          el('span', { clase: 'bloque-id mono', texto: b.testid }),
          el('span', { clase: 'bloque-texto', texto: b.texto })
        ]));
      });
      caja.appendChild(lista);
    }
    mostrar('secDom', true, pares.length + bloques.length);
  }

  function pintarFuentes(datos) {
    var caja = document.getElementById('cuerpoFuentes');
    if (!caja) return;
    vaciar(caja);
    var f = datos.fuentes || {};
    var tabla = tablaPares([
      ['Stream de Next.js encontrado', f.flightData ? 'Sí' : 'No'],
      ['Trozos leídos del stream', f.chunksFlight],
      ['Bloque del producto localizado', f.nodoPdp ? 'Sí' : 'No'],
      ['Datos estructurados (JSON-LD)', f.jsonLd ? 'Sí' : 'No'],
      ['Referencias sin resolver', (f.refsSinResolver || []).join(' ')],
      ['URL leída', datos.url],
      ['URL canónica', datos.urlCanonica]
    ]);
    if (tabla) caja.appendChild(tabla);
  }

  function pintarCrudo(crudo) {
    var pre = document.getElementById('rawJson');
    var seccion = document.getElementById('rawSection');
    if (!pre || !seccion) return;
    if (!crudo) { seccion.hidden = true; return; }
    seccion.hidden = false;
    try {
      pre.textContent = JSON.stringify(crudo, null, 2);
    } catch (e) {
      pre.textContent = 'No se pudo mostrar el JSON: ' + e.message;
    }
  }

  // ---------------------------------------------------------------------------
  // Índice y filtro
  // ---------------------------------------------------------------------------
  function construirIndice() {
    var indice = document.getElementById('indice');
    if (!indice) return;
    vaciar(indice);
    var secciones = document.querySelectorAll('.seccion-inspector');
    Array.prototype.forEach.call(secciones, function (sec) {
      if (sec.hidden) return;
      var titulo = sec.querySelector('h2');
      if (!titulo) return;
      var nombre = (titulo.childNodes[0] && titulo.childNodes[0].textContent || titulo.textContent).trim();
      var enlace = el('a', { clase: 'indice-item', href: '#' + sec.id, texto: nombre });
      enlace.addEventListener('click', function (ev) {
        ev.preventDefault();
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      indice.appendChild(enlace);
    });
  }

  var SELECTOR_FILAS = 'tbody tr, .bloque-dom, .color-swatch, .talla-chip, .plan, .galeria-item, .politica, .grupo-specs';

  /** Texto normalizado del nodo, cacheado: el filtro corre en cada tecla. */
  function textoBuscable(nodo) {
    if (nodo.__buscable === undefined) nodo.__buscable = normalizar(nodo.textContent);
    return nodo.__buscable;
  }

  /**
   * Filtro sobre todo lo pintado. Oculta filas y bloques que no casen y esconde
   * la sección cuando se queda sin nada. Solo mira secciones que TIENEN datos:
   * una vacía de origen no debe reaparecer por culpa de una búsqueda.
   */
  function aplicarFiltro(consulta) {
    var texto = normalizar(String(consulta || '').trim());
    // Los bloques de diagnóstico marcados como filtrables entran también: el
    // barrido del DOM es justo donde se busca cuando falta algo.
    var secciones = document.querySelectorAll('.seccion-inspector, [data-filtrable="si"]');
    var algoVisible = false;

    Array.prototype.forEach.call(secciones, function (sec) {
      if (sec.dataset.conDatos !== 'si') { sec.hidden = true; return; }
      if (!texto) {
        sec.hidden = false;
        algoVisible = true;
        if (sec.tagName === 'DETAILS') sec.open = false;   // vuelve a plegarse al limpiar
        Array.prototype.forEach.call(sec.querySelectorAll(SELECTOR_FILAS), function (f) { f.hidden = false; });
        return;
      }
      var filas = sec.querySelectorAll(SELECTOR_FILAS);
      if (!filas.length) {
        sec.hidden = textoBuscable(sec).indexOf(texto) === -1;
        if (!sec.hidden) algoVisible = true;
        return;
      }
      var visibles = 0;
      Array.prototype.forEach.call(filas, function (fila) {
        var casa = textoBuscable(fila).indexOf(texto) !== -1;
        fila.hidden = !casa;
        if (casa) visibles++;
      });
      sec.hidden = visibles === 0;
      // Un resultado dentro de un bloque plegado es un resultado invisible.
      if (visibles && sec.tagName === 'DETAILS') sec.open = true;
      if (visibles) algoVisible = true;
    });

    var sinNada = document.getElementById('sinResultados');
    if (sinNada) {
      sinNada.hidden = !texto || algoVisible;
      if (!sinNada.hidden) sinNada.textContent = 'Nada coincide con «' + consulta + '». Borra el filtro para ver todo otra vez.';
    }
    construirIndice();
  }

  // ---------------------------------------------------------------------------
  // Acciones
  // ---------------------------------------------------------------------------
  function configurarBotones() {
    var actualizar = document.getElementById('btnActualizar');
    if (actualizar) actualizar.addEventListener('click', actualizarDatos);

    var exportar = document.getElementById('btnExportJson');
    if (exportar) exportar.addEventListener('click', exportarJSON);

    var copiar = document.getElementById('btnCopiar');
    if (copiar) copiar.addEventListener('click', copiarResumen);

    var buscar = document.getElementById('buscar');
    if (buscar) {
      buscar.addEventListener('input', function () { aplicarFiltro(buscar.value); });
    }
  }

  async function actualizarDatos() {
    if (!estado.tabId) {
      aviso('No se sabe de qué pestaña salió esta inspección. Vuelve a abrir el inspector desde la extensión.');
      return;
    }
    var boton = document.getElementById('btnActualizar');
    if (boton) boton.disabled = true;
    aviso('Actualizando desde la pestaña original…');

    try {
      var resultados = await chrome.scripting.executeScript({
        target: { tabId: estado.tabId },
        func: inspectProductFromDOM
      });
      var datos = resultados && resultados[0] && resultados[0].result;
      if (!datos) throw new Error('la pestaña no devolvió datos');

      // Primero se pinta y luego se guarda: si el cupo de almacenamiento falla,
      // los datos frescos ya están en pantalla.
      estado.datos = datos;
      pintarTodo(datos);
      aviso('Datos actualizados desde la pestaña original.');
      try {
        await chrome.storage.local.set({ productInspection: { data: datos, tabId: estado.tabId, savedAt: Date.now() } });
      } catch (e) { /* no cabe: se ven igual, solo no sobreviven al cierre */ }
    } catch (e) {
      aviso('No se pudo actualizar: ' + e.message + '. Vuelve a extraer desde el icono de la extensión.');
    }
    if (boton) boton.disabled = false;
  }

  function exportarJSON() {
    if (!estado.datos) { aviso('No hay datos para exportar.'); return; }
    var texto = JSON.stringify(estado.datos, null, 2);
    var blob = new Blob([texto], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var sku = (estado.datos.product && estado.datos.product.skuGeneral) || 'desconocido';
    var a = document.createElement('a');
    a.href = url;
    a.download = 'liverpool-' + sku + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    aviso('Exportación completada.');
  }

  /** Resumen en texto plano, para pegarlo en una cotización sin reescribir nada. */
  function armarResumen() {
    var p = (estado.datos && estado.datos.product) || {};
    var pr = p.prices || {};
    var lineas = [];
    lineas.push(p.name || 'Artículo');
    if (p.brand) lineas.push('Marca: ' + p.brand);
    if (p.skuGeneral) lineas.push('SKU general: ' + p.skuGeneral);
    if (p.varianteActual) lineas.push('SKU variante: ' + p.varianteActual);
    if (pr.esRango) lineas.push('Precio: ' + dinero(pr.minPromo) + ' a ' + dinero(pr.maxPromo) + ' (falta elegir variante)');
    else lineas.push('Precio: ' + dinero(pr.current) + (pr.original ? ' (lista ' + dinero(pr.original) + ')' : ''));
    if (p.seller && p.seller.name) lineas.push('Vendedor: ' + p.seller.name + (p.seller.isMarketplace ? ' (marketplace)' : ''));
    if (p.availability) lineas.push('Existencias: ' + (p.availability.inStock ? 'sí' : 'no'));

    var msi = (p.paymentPlans || []).filter(function (x) { return x.noInterest; });
    if (msi.length) {
      lineas.push('Meses sin intereses: ' + msi.map(function (m) {
        return m.months + ' × ' + dinero(m.monthlyPayment);
      }).join(', '));
    }
    if ((p.variants || []).length > 1) {
      lineas.push('');
      lineas.push('Variantes:');
      p.variants.forEach(function (v) {
        lineas.push('  · ' + (v.sku || '—') + '  ' + [v.colorComercial || v.color, v.size].filter(Boolean).join(' / ') +
          '  ' + dinero(v.price) + (v.seller && v.seller.name ? '  — ' + v.seller.name : ''));
      });
    }
    if ((p.specifications || []).length) {
      lineas.push('');
      lineas.push('Características:');
      p.specifications.forEach(function (s) { lineas.push('  · ' + s.label + ': ' + s.value); });
    }
    if (p.url) { lineas.push(''); lineas.push(p.url); }
    return lineas.join('\n');
  }

  async function copiarResumen() {
    if (!estado.datos) { aviso('No hay datos para copiar.'); return; }
    var texto = armarResumen();
    try {
      await navigator.clipboard.writeText(texto);
      aviso('Resumen copiado al portapapeles.');
    } catch (e) {
      // Sin permiso de portapapeles: se cae al truco del textarea.
      var area = document.createElement('textarea');
      area.value = texto;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); aviso('Resumen copiado al portapapeles.'); }
      catch (e2) { aviso('No se pudo copiar: ' + e2.message); }
      document.body.removeChild(area);
    }
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
