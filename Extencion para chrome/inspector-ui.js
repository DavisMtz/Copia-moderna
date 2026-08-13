/**
 * =============================================================================
 * Ventel · Inspector de artículo — Interfaz (inspector-ui.js)
 * =============================================================================
 * Pinta la información extraída por `inspectProductFromDOM()` en la página del
 * inspector. Cada sección se muestra solo si trae datos.
 *
 * Hecho por su gran amigo David Martínez "El escritor" · v1.7 · 11/08/2026
 */

(function() {
  'use strict';

  let state = {
    tabId: null,
    data: null
  };

  let temporizadorAviso = null;

  /**
   * Helper para crear elementos del DOM.
   */
  function el(etiqueta, props, hijos) {
    const nodo = document.createElement(etiqueta);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'clase') nodo.className = v;
        else if (k === 'texto') nodo.textContent = v;
        else if (k === 'dataset') Object.assign(nodo.dataset, v);
        else nodo.setAttribute(k, v);
      }
    }
    (hijos || []).forEach(h => {
      if (h === null || h === undefined || h === false) return;
      nodo.appendChild(typeof h === 'string' ? document.createTextNode(h) : h);
    });
    return nodo;
  }

  /**
   * Formateador de moneda.
   */
  function dinero(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    return '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Muestra un aviso temporal en pantalla.
   */
  function aviso(texto) {
    const nodo = document.getElementById('aviso');
    if (!nodo) return;
    nodo.textContent = texto;
    nodo.hidden = false;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => { nodo.hidden = true; }, 3000);
  }

  /**
   * Limpia el contenido de un nodo.
   */
  function vaciar(nodo) {
    while (nodo.firstChild) nodo.removeChild(nodo.firstChild);
  }

  /**
   * Inicializa la vista cargando los datos.
   */
  function init() {
    configurarBotones();
    cargarDatos();
  }

  function cargarDatos() {
    chrome.storage.local.get('productInspection', ({ productInspection }) => {
      if (!productInspection || !productInspection.data) {
        mostrarError('No se encontraron datos de inspección.');
        return;
      }
      state.tabId = productInspection.tabId || null;
      state.data = productInspection.data;
      renderAll(state.data);
    });
  }

  function mostrarError(msj) {
    const hero = document.getElementById('hero');
    if (hero) {
      vaciar(hero);
      hero.appendChild(el('div', { clase: 'alerta alerta-peligro', texto: msj }));
    }
  }

  function renderAll(data) {
    const prod = data.product || {};
    
    renderHeader(data);
    renderHero(prod);
    renderColors(prod.colors);
    renderSizes(prod.sizes);
    renderVariants(prod.variants);
    renderPaymentPlans(prod.paymentPlans);
    renderPromotions(prod.promotions);
    renderSpecifications(prod.specifications);
    renderDescription(prod.description);
    renderCategory(prod.category);
    renderRating(prod.rating);
    renderFullGallery(prod.images);
    renderMeta(prod);
    renderRawData(prod.rawFlightData);
    renderWarnings(data.warnings);
  }

  function renderHeader(data) {
    const prod = data.product || {};
    const origen = document.getElementById('origen');
    if (origen) origen.textContent = prod.name || 'Artículo sin nombre';

    const btnLvp = document.getElementById('btnAbrirLiverpool');
    if (btnLvp && prod.url) {
      btnLvp.href = prod.url;
    }
  }

  function renderHero(prod) {
    const section = document.getElementById('hero');
    if (!section) return;
    vaciar(section);

    // Contenedor de Galería Hero
    const galeriaHero = el('div', { clase: 'hero-galeria' });
    const imgPrincipal = el('img', { clase: 'img-principal', alt: prod.name });
    const tiraThumbs = el('div', { clase: 'tira-thumbs' });
    
    if (prod.images && prod.images.length > 0) {
      imgPrincipal.src = prod.images[0].url;
      prod.images.slice(0, 5).forEach((imgObj) => {
        const thumb = el('img', { 
          clase: 'thumb', 
          src: imgObj.url, 
          alt: imgObj.alt || 'Miniatura'
        });
        thumb.addEventListener('click', () => {
          imgPrincipal.src = imgObj.url;
        });
        tiraThumbs.appendChild(thumb);
      });
    } else {
      imgPrincipal.src = '';
      imgPrincipal.alt = 'Sin imagen';
    }
    
    galeriaHero.appendChild(imgPrincipal);
    galeriaHero.appendChild(tiraThumbs);

    // Contenedor de Info Hero
    const infoHero = el('div', { clase: 'hero-info' });

    if (prod.brand) {
      infoHero.appendChild(el('div', { clase: 'badge-marca', texto: prod.brand.toUpperCase() }));
    }
    
    infoHero.appendChild(el('h2', { clase: 'hero-titulo', texto: prod.name || 'Sin nombre' }));

    const chipsSku = el('div', { clase: 'chips-container' });
    if (prod.skuGeneral) {
      chipsSku.appendChild(el('span', { clase: 'chip monospace', texto: `General: ${prod.skuGeneral}` }));
    }
    if (prod.skuVariante) {
      chipsSku.appendChild(el('span', { clase: 'chip monospace', texto: `Variante: ${prod.skuVariante}` }));
    }
    if (prod.productCode) {
      chipsSku.appendChild(el('span', { clase: 'chip', texto: `Cód: ${prod.productCode}` }));
    }
    infoHero.appendChild(chipsSku);

    // Precios
    const preciosDiv = el('div', { clase: 'bloque-precio' });
    if (prod.prices) {
      const { current, original, discountPercent, savings } = prod.prices;
      if (current !== undefined) {
        preciosDiv.appendChild(el('span', { clase: 'precio-actual', texto: dinero(current) }));
      }
      if (original && original > current) {
        preciosDiv.appendChild(el('span', { clase: 'precio-original', texto: dinero(original) }));
      }
      if (discountPercent) {
        preciosDiv.appendChild(el('span', { clase: 'badge-descuento', texto: `-${discountPercent}%` }));
      }
      if (savings) {
        preciosDiv.appendChild(el('div', { clase: 'ahorro', texto: `Ahorras: ${dinero(savings)}` }));
      }
    }
    infoHero.appendChild(preciosDiv);

    // Vendedor
    if (prod.seller) {
      const v = prod.seller;
      const t = v.isMarketplace ? `Vendido por ${v.name} (Marketplace)` : `Vendido por ${v.name || 'Liverpool'}`;
      infoHero.appendChild(el('div', { clase: 'vendedor-info', texto: t }));
    }

    // Disponibilidad
    if (prod.availability) {
      const av = prod.availability;
      const dot = el('span', { clase: av.inStock ? 'dot-verde' : 'dot-rojo' });
      const t = av.inStock ? 'En stock' : 'Agotado';
      const dispCont = el('div', { clase: 'disponibilidad' }, [dot, t]);
      
      if (av.deliveryEstimate) {
        dispCont.appendChild(el('span', { clase: 'entrega-estimada', texto: ` • Entrega: ${av.deliveryEstimate}` }));
      }
      infoHero.appendChild(dispCont);
    }

    section.appendChild(galeriaHero);
    section.appendChild(infoHero);
  }

  function renderColors(colors) {
    const sec = document.getElementById('secColores');
    if (!sec) return;
    if (!colors || colors.length === 0) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const body = sec.querySelector('.seccion-cuerpo') || sec;
    vaciar(body);

    const grid = el('div', { clase: 'grid-colores' });
    colors.forEach(c => {
      const claseCard = 'card-color' + (c.selected ? ' activo' : '');
      const hijos = [
        el('img', { clase: 'img-color', src: c.imageUrl || '', alt: c.name }),
        el('div', { clase: 'nombre-color', texto: c.name })
      ];
      if (c.sku) {
        hijos.push(el('div', { clase: 'sku-color monospace', texto: c.sku }));
      }
      grid.appendChild(el('div', { clase: claseCard }, hijos));
    });
    body.appendChild(grid);
  }

  function renderSizes(sizes) {
    const sec = document.getElementById('secTallas');
    if (!sec) return;
    if (!sizes || sizes.length === 0) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    
    // Determinar título
    const textValues = sizes.map(s => (s.value || '').toUpperCase());
    const esCapacidad = textValues.some(v => v.includes('GB') || v.includes('TB'));
    const esRopa = textValues.some(v => ['S','M','L','XL','XXL','CH','G','XG'].includes(v));
    const tituloNodo = sec.querySelector('.seccion-titulo');
    if (tituloNodo) {
      if (esCapacidad) tituloNodo.textContent = 'Capacidades';
      else if (esRopa) tituloNodo.textContent = 'Tallas';
      else tituloNodo.textContent = 'Variantes';
    }

    const body = sec.querySelector('.seccion-cuerpo') || sec;
    vaciar(body);

    const contenedor = el('div', { clase: 'contenedor-chips' });
    sizes.forEach(s => {
      let clase = 'chip-pill';
      if (s.selected) clase += ' seleccionado';
      else if (!s.available) clase += ' agotado';
      else clase += ' disponible';

      const hijos = [ s.label || s.value ];
      if (!s.available) {
        hijos.push(el('span', { clase: 'label-agotado', texto: 'Agotado' }));
      }

      contenedor.appendChild(el('div', { clase }, hijos));
    });
    body.appendChild(contenedor);
  }

  function renderVariants(variants) {
    const sec = document.getElementById('secVariantes');
    if (!sec) return;
    if (!variants || variants.length === 0) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const body = sec.querySelector('.seccion-cuerpo') || sec;
    vaciar(body);

    // Ordenar por color y luego talla
    const varsSorted = [...variants].sort((a, b) => {
      const ca = a.color || '';
      const cb = b.color || '';
      if (ca !== cb) return ca.localeCompare(cb);
      const sa = a.size || '';
      const sb = b.size || '';
      return sa.localeCompare(sb);
    });

    const thead = el('thead', null, [
      el('tr', null, [
        el('th', { texto: 'SKU' }),
        el('th', { texto: 'Color' }),
        el('th', { texto: 'Talla/Capacidad' }),
        el('th', { texto: 'Precio lista' }),
        el('th', { texto: 'Precio actual' }),
        el('th', { texto: 'Disponible' })
      ])
    ]);

    const tbody = el('tbody');
    varsSorted.forEach(v => {
      const tr = el('tr', null, [
        el('td', { clase: 'monospace', texto: v.sku || '—' }),
        el('td', { texto: v.color || '—' }),
        el('td', { texto: v.size || '—' }),
        el('td', { texto: v.listPrice ? dinero(v.listPrice) : '—' }),
        el('td', { texto: v.price ? dinero(v.price) : '—' }),
        el('td', null, [
          el('span', { 
            clase: v.inStock ? 'dot-verde' : 'dot-rojo', 
            texto: v.inStock ? ' Sí' : ' No' 
          })
        ])
      ]);
      tbody.appendChild(tr);
    });

    const tabla = el('table', { clase: 'tabla-variantes' }, [thead, tbody]);
    body.appendChild(tabla);
  }

  function renderPaymentPlans(plans) {
    const sec = document.getElementById('secPagos');
    if (!sec) return;
    if (!plans || plans.length === 0) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const body = sec.querySelector('.seccion-cuerpo') || sec;
    vaciar(body);

    const plansSorted = [...plans].sort((a, b) => (a.months || 0) - (b.months || 0));
    
    const grid = el('div', { clase: 'grid-pagos' });
    plansSorted.forEach(p => {
      const esMsi = p.noInterest;
      const claseCard = 'card-pago' + (esMsi ? ' msi' : '');
      const t = esMsi ? `${p.months} meses sin intereses` : `${p.months} pagos fijos`;
      
      const card = el('div', { clase: claseCard }, [
        el('div', { clase: 'monto-pago', texto: dinero(p.monthlyPayment) }),
        el('div', { clase: 'desc-pago', texto: t }),
        p.description ? el('div', { clase: 'extra-pago', texto: p.description }) : null
      ]);
      grid.appendChild(card);
    });
    body.appendChild(grid);
  }

  function renderPromotions(promos) {
    const sec = document.getElementById('secPromos');
    if (!sec) return;
    if (!promos || promos.length === 0) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const body = sec.querySelector('.seccion-cuerpo') || sec;
    vaciar(body);

    const lista = el('ul', { clase: 'lista-promos' });
    promos.forEach(p => {
      const li = el('li', { clase: 'promo-item' }, [
        el('span', { clase: 'promo-desc', texto: p.description || '' })
      ]);
      if (p.type) {
        li.appendChild(el('span', { clase: 'badge-promo', texto: p.type }));
      }
      if (p.code) {
        li.appendChild(el('span', { clase: 'codigo-promo monospace', texto: p.code }));
      }
      lista.appendChild(li);
    });
    body.appendChild(lista);
  }

  function renderSpecifications(specs) {
    const sec = document.getElementById('secSpecs');
    if (!sec) return;
    if (!specs || specs.length === 0) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const body = sec.querySelector('.seccion-cuerpo') || sec;
    vaciar(body);

    const tbody = el('tbody');
    specs.forEach(s => {
      tbody.appendChild(el('tr', null, [
        el('th', { texto: s.label || '' }),
        el('td', { texto: s.value || '' })
      ]));
    });

    const tabla = el('table', { clase: 'tabla-specs' }, [tbody]);
    body.appendChild(tabla);
  }

  function renderDescription(desc) {
    const sec = document.getElementById('secDescripcion');
    if (!sec) return;
    if (!desc || typeof desc !== 'string' || desc.trim() === '') {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const body = sec.querySelector('.seccion-cuerpo') || sec;
    vaciar(body);
    
    // Mostramos como texto plano para evitar innerHTML
    const p = el('p', { clase: 'texto-descripcion', texto: desc });
    body.appendChild(p);
  }

  function renderCategory(cat) {
    const sec = document.getElementById('secCategoria');
    if (!sec) return;
    if (!cat || !cat.breadcrumbs || cat.breadcrumbs.length === 0) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const body = sec.querySelector('.seccion-cuerpo') || sec;
    vaciar(body);

    const bctext = cat.breadcrumbs.join(' > ');
    const bc = el('div', { clase: 'breadcrumbs', texto: bctext });
    body.appendChild(bc);

    if (cat.department || cat.productType) {
      const extras = el('div', { clase: 'categoria-extras' });
      if (cat.department) extras.appendChild(el('span', { clase: 'chip', texto: `Depto: ${cat.department}` }));
      if (cat.productType) extras.appendChild(el('span', { clase: 'chip', texto: `Tipo: ${cat.productType}` }));
      body.appendChild(extras);
    }
  }

  function renderRating(rating) {
    const sec = document.getElementById('secRating');
    if (!sec) return;
    if (!rating || rating.count === undefined || rating.count === null) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const body = sec.querySelector('.seccion-cuerpo') || sec;
    vaciar(body);

    const avg = rating.average || 0;
    const count = rating.count || 0;
    
    const estrellas = el('div', { clase: 'estrellas' });
    for (let i = 1; i <= 5; i++) {
      const cls = i <= Math.round(avg) ? 'estrella llena' : 'estrella vacia';
      estrellas.appendChild(el('span', { clase: cls, texto: '★' }));
    }
    
    const divInfo = el('div', { clase: 'rating-info', texto: `${avg} de 5 (${count} opiniones)` });
    
    body.appendChild(el('div', { clase: 'rating-contenedor' }, [estrellas, divInfo]));
  }

  function renderFullGallery(images) {
    const sec = document.getElementById('secGaleria');
    if (!sec) return;
    if (!images || images.length === 0) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const body = sec.querySelector('.seccion-cuerpo') || sec;
    vaciar(body);

    const top = el('div', { clase: 'galeria-info', texto: `Total de imágenes: ${images.length}` });
    body.appendChild(top);

    const grid = el('div', { clase: 'grid-galeria-full' });
    images.forEach(img => {
      const card = el('a', { clase: 'card-img', href: img.url, target: '_blank' }, [
        el('img', { src: img.url, alt: img.alt || 'Imagen de producto' }),
        el('div', { clase: 'img-tipo', texto: img.type || 'General' })
      ]);
      grid.appendChild(card);
    });
    body.appendChild(grid);
  }

  function renderMeta(prod) {
    const sec = document.getElementById('secMeta');
    if (!sec) return;
    
    const obj = {};
    if (prod.identifiers) {
      if (prod.identifiers.gtin) obj['GTIN'] = prod.identifiers.gtin;
      if (prod.identifiers.mpn) obj['MPN'] = prod.identifiers.mpn;
    }
    if (prod.meta) {
      Object.assign(obj, prod.meta);
    }
    if (prod.slug) obj['Slug'] = prod.slug;

    if (Object.keys(obj).length === 0) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const body = sec.querySelector('.seccion-cuerpo') || sec;
    vaciar(body);

    const tbody = el('tbody');
    for (const k in obj) {
      tbody.appendChild(el('tr', null, [
        el('th', { texto: k }),
        el('td', { texto: obj[k] || '' })
      ]));
    }
    body.appendChild(el('table', { clase: 'tabla-specs' }, [tbody]));
  }

  function renderRawData(rawData) {
    const sec = document.getElementById('rawJson');
    if (!sec) return;
    if (!rawData) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const body = sec.querySelector('pre') || sec;
    vaciar(body);
    body.textContent = JSON.stringify(rawData, null, 2);
  }

  function renderWarnings(warnings) {
    const sec = document.getElementById('avisos');
    if (!sec) return;
    if (!warnings || warnings.length === 0) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    vaciar(sec);

    const ul = el('ul', { clase: 'lista-advertencias' });
    warnings.forEach(w => {
      ul.appendChild(el('li', { texto: w }));
    });
    
    const wrap = el('div', { clase: 'alerta alerta-advertencia' }, [
      el('strong', { texto: 'Advertencias de la extracción:' }),
      ul
    ]);
    sec.appendChild(wrap);
  }

  /**
   * Configura los botones de la barra de acciones.
   */
  function configurarBotones() {
    const btnAct = document.getElementById('btnActualizar');
    if (btnAct) {
      btnAct.addEventListener('click', actualizarDatos);
    }

    const btnExp = document.getElementById('btnExportJson');
    if (btnExp) {
      btnExp.addEventListener('click', exportarJSON);
    }
  }

  async function actualizarDatos() {
    if (!state.tabId) {
      aviso('No se sabe de qué pestaña salió esta inspección. Vuelve a abrir el inspector desde la extensión.');
      return;
    }

    const boton = document.getElementById('btnActualizar');
    if (boton) boton.disabled = true;
    aviso('Actualizando desde la pestaña original...');

    try {
      const resultados = await chrome.scripting.executeScript({
        target: { tabId: state.tabId },
        func: inspectProductFromDOM
      });
      const datos = resultados && resultados[0] && resultados[0].result;
      if (!datos) throw new Error('la pestaña no devolvió datos');

      // Primero se pinta y luego se guarda: si el cupo de almacenamiento falla,
      // los datos frescos ya están en pantalla.
      renderAll(datos);
      aviso('Datos actualizados desde la pestaña original.');
      try {
        await chrome.storage.local.set({ productInspection: { data: datos, tabId: state.tabId, savedAt: Date.now() } });
      } catch (e) { /* no cabe: se muestran igual, solo no sobreviven al cierre */ }
    } catch (e) {
      aviso('No se pudo actualizar: ' + e.message + '. Vuelve a extraer desde el icono de la extensión.');
    }
    if (boton) boton.disabled = false;
  }

  function exportarJSON() {
    if (!state.data) {
      aviso('No hay datos para exportar.');
      return;
    }
    const js = JSON.stringify(state.data, null, 2);
    const blob = new Blob([js], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const prod = state.data.product || {};
    const sku = prod.skuGeneral || 'desconocido';
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `liverpool-${sku}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    aviso('Exportación completada.');
  }

  // Inicializar al cargar
  document.addEventListener('DOMContentLoaded', init);

})();
