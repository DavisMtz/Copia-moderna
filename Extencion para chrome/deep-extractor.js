/**
 * =============================================================================
 * Ventel · Visor Avanzado — Extractor profundo (deep-extractor.js)
 * =============================================================================
 * Contiene UNA sola función, `deepExtractFromDOM`, que se inyecta tal cual en la
 * pestaña activa con `chrome.scripting.executeScript({ func: ... })`.
 *
 * Por eso la función es autocontenida: todos sus ayudantes viven dentro. Si algo
 * se saca fuera, deja de existir cuando el código viaja a la página.
 *
 * Qué hace, en corto: además de lo que se ve en pantalla, Liverpool deja en el
 * propio HTML el objeto completo de cada artículo (el "flight data" de Next.js,
 * los `self.__next_f.push([...])`). Ahí están el SKU de variante, el SKU general,
 * el precio de lista, los MSI, el proveedor, todas las imágenes... Este archivo
 * recoge esa información, la de JSON-LD, la de las etiquetas <meta> y la visible
 * en el DOM, y la funde en una ficha por artículo.
 *
 * No inventa datos: lo que no aparece en la página, no aparece en la ficha.
 *
 * Hecho por su gran amigo David Martínez "El escritor" · v1.3 · 01/08/2026
 */

/**
 * Extrae absolutamente todo lo que la página deja disponible sobre cada artículo.
 * Se ejecuta DENTRO de la pestaña, no en el popup.
 *
 * @returns {Object} { extractedAt, page, articles[], summary, sources, warnings[] }
 */
function deepExtractFromDOM() {
  const avisos = [];

  // ---------------------------------------------------------------------------
  // 1. UTILIDADES BÁSICAS
  // ---------------------------------------------------------------------------

  /**
   * Devuelve el índice de la comilla que cierra el literal que empieza en `inicio`.
   * Respeta las barras invertidas de escape. -1 si el literal nunca cierra.
   */
  function finDeCadena(texto, inicio) {
    for (let i = inicio + 1; i < texto.length; i++) {
      const c = texto[i];
      if (c === '\\') { i++; continue; }
      if (c === '"') return i;
    }
    return -1;
  }

  function esTextoUtil(v) {
    return typeof v === 'string' && v.trim() !== '';
  }

  function numeroODefecto(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** Limpia texto visible: colapsa espacios y quita saltos de línea. */
  function limpio(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Parsea "$29,999.10" → 29999.10. Comparte criterio con el extractor de bolsa
   * clásico: los centavos son los dos primeros dígitos tras el punto, porque
   * Liverpool repite la cifra en un span de accesibilidad.
   */
  function precioDeTexto(texto) {
    if (!texto) return 0;
    let limpiado = String(texto).trim();
    if (limpiado.includes('.')) {
      const partes = limpiado.split('.');
      const enteros = partes[0].replace(/[^0-9,-]/g, '');
      const decimales = partes[1].replace(/[^0-9]/g, '').substring(0, 2);
      limpiado = enteros + '.' + decimales;
    } else {
      limpiado = limpiado.replace(/[^0-9,-]/g, '');
    }
    limpiado = limpiado.replace(/,/g, '');
    const n = parseFloat(limpiado);
    return isNaN(n) ? 0 : n;
  }

  /** Precio a partir de un contenedor con la estructura de spans de Liverpool. */
  function precioDeNodo(nodo) {
    if (!nodo) return 0;
    let texto = '';
    const spans = nodo.querySelectorAll('span');
    if (spans.length) {
      spans.forEach(s => { if (!s.classList.contains('invisible')) texto += s.textContent; });
    } else {
      texto = nodo.textContent;
    }
    return precioDeTexto(texto);
  }

  /**
   * Convierte un objeto de dinero de commercetools ({centAmount, fractionDigits})
   * en un número de pesos. Acepta también un número suelto.
   */
  function dinero(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'object') {
      if (Number.isFinite(v.pesosAmount)) return v.pesosAmount;
      if (Number.isFinite(v.centAmount)) {
        const dig = Number.isFinite(v.fractionDigits) ? v.fractionDigits : 2;
        return v.centAmount / Math.pow(10, dig);
      }
      if (Number.isFinite(v.amount)) return v.amount;
      if (Number.isFinite(v.value)) return v.value;
    }
    if (typeof v === 'string') {
      const n = precioDeTexto(v);
      return n || null;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // 2. COSECHA DEL "FLIGHT DATA" DE NEXT.JS
  // ---------------------------------------------------------------------------

  /**
   * Reconstruye el stream que Next.js dejó repartido en decenas de
   * `self.__next_f.push([1,"..."])`. Cada push trae un trozo del JSON, así que
   * hay que concatenarlos EN ORDEN: un objeto puede quedar partido entre dos.
   *
   * Se lee del texto de los <script> (no de la variable global) para que también
   * funcione con una página guardada en disco y desde el mundo aislado del
   * content script, que no ve las variables de la página.
   */
  function cosecharFlight() {
    const trozos = [];
    const scripts = document.querySelectorAll('script');

    for (const s of scripts) {
      const t = s.textContent || '';
      if (t.indexOf('__next_f.push') === -1) continue;

      let desde = 0;
      while (true) {
        const p = t.indexOf('__next_f.push', desde);
        if (p === -1) break;

        // El literal es el segundo argumento: push([1,"…"]). Si en los siguientes
        // 30 caracteres no hay comilla, este push no lleva payload (p. ej. push([0])).
        const q = t.indexOf('"', p);
        if (q === -1 || q - p > 30) { desde = p + 13; continue; }

        const fin = finDeCadena(t, q);
        if (fin === -1) { desde = p + 13; continue; }

        try {
          trozos.push(JSON.parse(t.slice(q, fin + 1)));
        } catch (e) { /* trozo ilegible: se ignora, los demás siguen sirviendo */ }

        desde = fin + 1;
      }
    }

    return trozos.join('');
  }

  /**
   * Recorre un texto plano UNA vez y devuelve los fragmentos que son objetos JSON
   * con pinta de artículo (llevan `sku`/`skuId` y algún campo de producto).
   *
   * Se hace con un recorrido con pila en vez de expresiones regulares porque los
   * objetos están anidados y llenos de comillas escapadas: una regex se pierde.
   * Al cerrar cada `}` sabemos exactamente dónde empezaba ese objeto.
   */
  function objetosConPintaDeArticulo(texto) {
    const LLAVES_ID = ['sku', 'skuId', 'skuid', 'variantId', 'productSku'];
    const LLAVES_PROD = ['productName', 'productId', 'productSlug', 'listPrice',
      'salePrice', 'price', 'assets', 'attributes', 'brand', 'name', 'title'];

    const encontrados = [];
    const pila = [];
    const n = texto.length;
    let i = 0;

    while (i < n) {
      const c = texto[i];

      if (c === '"') {
        const fin = finDeCadena(texto, i);
        if (fin === -1) break;

        // ¿Es una llave de objeto? Lo es si tras la comilla de cierre viene ':'
        let j = fin + 1;
        while (j < n && (texto[j] === ' ' || texto[j] === '\n' || texto[j] === '\t' || texto[j] === '\r')) j++;
        if (texto[j] === ':' && pila.length) {
          const llave = texto.slice(i + 1, fin);
          const marco = pila[pila.length - 1];
          if (LLAVES_ID.indexOf(llave) !== -1) marco.id = true;
          else if (LLAVES_PROD.indexOf(llave) !== -1) marco.prod = true;
        }
        i = fin + 1;
        continue;
      }

      if (c === '{') { pila.push({ inicio: i, id: false, prod: false }); i++; continue; }

      if (c === '}') {
        const marco = pila.pop();
        if (marco && marco.id && marco.prod) {
          const largo = i - marco.inicio + 1;
          // Cotas de cordura: ni un objeto vacío ni el documento entero.
          if (largo > 60 && largo < 500000) encontrados.push(texto.slice(marco.inicio, i + 1));
        }
        i++;
        continue;
      }

      i++;
    }

    return encontrados;
  }

  /**
   * Convierte los fragmentos en objetos reales y descarta los falsos positivos
   * (por ejemplo `includedGiftPromotion`, que trae `sku: null`).
   */
  function parsearArticulos(fragmentos) {
    const salida = [];
    for (const frag of fragmentos) {
      let obj;
      try { obj = JSON.parse(frag); } catch (e) { continue; }
      if (!obj || typeof obj !== 'object') continue;

      const sku = obj.sku || obj.skuId || obj.skuid || obj.variantId;
      if (!esTextoUtil(sku)) continue;                    // sku nulo → no es un artículo
      if (!/^\d{4,}$/.test(String(sku).trim()) && !obj.productName && !obj.name) continue;

      salida.push(obj);
    }
    return salida;
  }

  // ---------------------------------------------------------------------------
  // 3. OTRAS FUENTES DE DATOS OCULTOS
  // ---------------------------------------------------------------------------

  /** Todos los <script type="application/ld+json"> ya parseados. */
  function cosecharJsonLd() {
    const salida = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const dato = JSON.parse(s.textContent);
        if (Array.isArray(dato)) salida.push(...dato);
        else salida.push(dato);
      } catch (e) { /* JSON-LD roto: se ignora */ }
    });
    return salida;
  }

  /** __NEXT_DATA__ del router antiguo de Next, si la página lo usa. */
  function cosecharNextData() {
    const s = document.getElementById('__NEXT_DATA__');
    if (!s) return null;
    try { return JSON.parse(s.textContent); } catch (e) { return null; }
  }

  /**
   * Recorre una estructura ya parseada buscando nodos que parezcan un producto.
   * Sirve para JSON-LD y __NEXT_DATA__, donde ya no hay texto que tokenizar.
   */
  function buscarProductosEnObjeto(raiz, limiteNodos) {
    const salida = [];
    const pendientes = [{ v: raiz, prof: 0 }];
    let vistos = 0;

    while (pendientes.length && vistos < limiteNodos) {
      const { v, prof } = pendientes.pop();
      vistos++;
      if (!v || typeof v !== 'object' || prof > 14) continue;

      if (Array.isArray(v)) {
        for (const x of v) pendientes.push({ v: x, prof: prof + 1 });
        continue;
      }

      const tipo = v['@type'];
      const esProducto =
        (tipo === 'Product' || (Array.isArray(tipo) && tipo.indexOf('Product') !== -1)) ||
        (esTextoUtil(v.sku || v.skuId) && (v.productName || v.name || v.title || v.price || v.offers));

      if (esProducto) salida.push(v);

      for (const k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) pendientes.push({ v: v[k], prof: prof + 1 });
      }
    }

    return salida;
  }

  /** Etiquetas <meta> y <link rel=canonical>: og:*, twitter:*, product:*, etc. */
  function cosecharMetas() {
    const metas = {};
    document.querySelectorAll('meta[property], meta[name]').forEach(m => {
      const clave = m.getAttribute('property') || m.getAttribute('name');
      const valor = m.getAttribute('content');
      if (esTextoUtil(clave) && esTextoUtil(valor) && clave !== 'viewport') metas[clave] = valor;
    });
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && canonical.href) metas['link:canonical'] = canonical.href;
    return metas;
  }

  /** Microdatos schema.org incrustados en el HTML ([itemprop]). */
  function cosecharMicrodatos() {
    const salida = {};
    document.querySelectorAll('[itemprop]').forEach(el => {
      const clave = el.getAttribute('itemprop');
      const valor = el.getAttribute('content') || el.getAttribute('src') ||
        el.getAttribute('href') || limpio(el.textContent);
      if (esTextoUtil(clave) && esTextoUtil(valor) && !salida[clave]) {
        salida[clave] = valor.slice(0, 500);
      }
    });
    return salida;
  }

  /**
   * Tablas y listas de definición visibles: en la ficha de producto es donde vive
   * la ficha técnica (material, garantía, modelo...). Se recogen genéricamente
   * para no depender de nombres de clase que Liverpool cambia cada temporada.
   */
  function cosecharEspecificaciones() {
    const specs = [];

    document.querySelectorAll('table tr').forEach(tr => {
      const celdas = tr.querySelectorAll('th, td');
      if (celdas.length === 2) {
        const k = limpio(celdas[0].textContent);
        const v = limpio(celdas[1].textContent);
        if (k && v && k.length < 80 && v.length < 300) specs.push({ campo: k, valor: v });
      }
    });

    document.querySelectorAll('dl').forEach(dl => {
      const dts = dl.querySelectorAll('dt');
      dts.forEach(dt => {
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === 'DD') {
          const k = limpio(dt.textContent);
          const v = limpio(dd.textContent);
          if (k && v && k.length < 80 && v.length < 300) specs.push({ campo: k, valor: v });
        }
      });
    });

    return specs.slice(0, 120);
  }

  // ---------------------------------------------------------------------------
  // 4. LO QUE SÍ SE VE: TARJETAS DE LA BOLSA
  // ---------------------------------------------------------------------------

  /**
   * Lee las tarjetas visibles de la bolsa. Aporta lo que el flight data no tiene:
   * la URL real de la ficha, la imagen que se está mostrando y la cantidad que
   * el usuario acaba de teclear.
   */
  function cosecharTarjetasBolsa() {
    const tarjetas = [];
    const nodos = document.querySelectorAll('[data-testid^="ml-card-product-mybag-"]');

    Array.from(nodos)
      .filter(c => /^ml-card-product-mybag-[0-9a-f-]{36}$/.test(c.getAttribute('data-testid')))
      .forEach(card => {
        const idTarjeta = card.getAttribute('data-testid');
        const uuid = idTarjeta.replace('ml-card-product-mybag-', '');

        const enlace = card.querySelector(`[data-testid="${idTarjeta}-brand-link"]`);
        const urlFicha = resolverUrlFicha(enlace);

        // En /pdp/<slug>/<idProducto>?skuid=<sku> conviven los dos SKU:
        // el del path es el general (padre) y el de `skuid` es el de la variante.
        let skuGeneral = '', skuVariante = '', slug = '';
        if (urlFicha) {
          try {
            const u = new URL(urlFicha);
            const partes = u.pathname.split('/').filter(Boolean);
            skuGeneral = partes[partes.length - 1] || '';
            slug = partes[partes.length - 2] || '';
            skuVariante = u.searchParams.get('skuid') || '';
          } catch (e) { /* URL rara: se queda sin desglosar */ }
        }

        const img = card.querySelector(`[data-testid="product-image-${uuid}"]`);
        let imagen = img ? (img.getAttribute('src') || '') : '';
        if (imagen.startsWith('./') || imagen.startsWith('Mi Bolsa_files')) {
          // Página guardada en disco: la miniatura local no sirve fuera de este equipo.
          imagen = skuVariante ? `https://ss628.liverpool.com.mx/xl/${skuVariante}.jpg` : '';
        }

        const cantidadInput = card.querySelector('input[name="quantity"]');
        const cantidad = cantidadInput ? (parseInt(cantidadInput.value, 10) || 1) : 1;

        const precioOriginal = precioDeNodo(card.querySelector('[data-testid="original"]'));
        const precioDescuento = precioDeNodo(card.querySelector('[data-testid="discounted"]'));
        const totalLinea = precioDeNodo(
          card.querySelector('[data-testid$="-input-cart-item-wrapper-input-cart-item-total"]'));

        let vendidoPor = '';
        card.querySelectorAll('span').forEach(s => {
          const t = limpio(s.textContent);
          if (!vendidoPor && /^Vendido\s+por/i.test(t)) {
            vendidoPor = t.replace(/^Vendido\s+por\s+/i, '');
          }
        });

        // Cualquier data-* de la tarjeta: a veces trae banderas útiles.
        const datos = {};
        Array.from(card.attributes).forEach(a => {
          if (a.name.startsWith('data-') && a.name !== 'data-testid') datos[a.name] = a.value;
        });

        tarjetas.push({
          idLinea: uuid,
          nombre: enlace ? limpio(enlace.textContent) : '',
          urlFicha, skuGeneral, skuVariante, slug,
          imagen, cantidad, precioOriginal, precioDescuento, totalLinea,
          vendidoPor, datos,
          textoVisible: limpio(card.textContent).slice(0, 600)
        });
      });

    return tarjetas;
  }

  /**
   * URL pública de la ficha, o cadena vacía si no se puede saber con certeza.
   * Mismo criterio que el extractor clásico: nunca fabricar un enlace que
   * termine en 404. (Ver popup.js, `resolveProductUrl`.)
   */
  function resolverUrlFicha(enlace) {
    if (!enlace) return '';
    const DOMINIO = 'https://www.liverpool.com.mx';

    const absoluta = enlace.href || '';
    if (/^https?:\/\/([a-z0-9-]+\.)*liverpool\.com\.mx(?::\d+)?(\/|$|\?|#)/i.test(absoluta)) {
      return absoluta.replace(/^http:/i, 'https:');
    }

    const crudo = (enlace.getAttribute('href') || '').trim();
    if (crudo.indexOf('/') === 0 && crudo.indexOf('//') !== 0) return DOMINIO + crudo;

    return '';
  }

  /** Resumen del carrito tal y como se muestra en pantalla. */
  function cosecharResumen() {
    const leer = sel => {
      const el = document.querySelector(sel);
      return el ? precioDeTexto(el.textContent) : 0;
    };
    return {
      subtotal: leer('[data-testid="checkout-payment-summary-subtotal"]'),
      descuento: leer('[data-testid="checkout-payment-summary-discount"]'),
      total: leer('[data-testid="checkout-payment-summary-total"]')
    };
  }

  // ---------------------------------------------------------------------------
  // 5. NORMALIZACIÓN: DE OBJETO CRUDO A FICHA LEGIBLE
  // ---------------------------------------------------------------------------

  /**
   * Traduce un objeto crudo de Liverpool a la ficha que pinta el visor.
   * Todo campo ausente se queda en null: el visor decide qué mostrar según lo
   * que realmente exista, sin secciones vacías ni ceros inventados.
   */
  function normalizar(crudo, origen) {
    const attrs = crudo.attributes || {};
    const cantidad = numeroODefecto(crudo.quantity) || 1;

    const lista = dinero(crudo.listPrice);
    const venta = dinero(crudo.salePrice);
    const actual = dinero(crudo.price) != null ? dinero(crudo.price) : dinero(crudo.currentPrice);
    const totalLinea = dinero(crudo.totalPrice);

    const referencia = lista != null ? lista : venta;
    let ahorroUnitario = null, descuentoPct = null;
    if (referencia != null && actual != null && referencia > actual) {
      ahorroUnitario = Math.round((referencia - actual) * 100) / 100;
      descuentoPct = Math.round((1 - actual / referencia) * 100);
    }

    return {
      idLinea: crudo.id || null,
      skuVariante: crudo.sku || crudo.skuId || null,
      skuGeneral: crudo.productId || crudo.productSlug || null,
      slug: null,
      urlFicha: null,
      nombre: crudo.productName || crudo.name || crudo.title || null,
      nombreInterno: attrs.name || null,
      marca: crudo.brand || attrs.brand || null,
      descripcion: crudo.description || crudo.longDescription || null,

      clasificacion: quitarVacios({
        departamento: crudo.department || attrs.department || null,
        grupoMaterial: crudo.materialGroupId || attrs.materialGroup || null,
        tipoProducto: crudo.productType || attrs.productType || null,
        categoria: crudo.categoryName || null,
        canalDistribucion: crudo.distributionChannelName || null,
        tipoInventario: crudo.inventoryType || null
      }),

      atributos: atributosLegibles(attrs),

      vendedor: quitarVacios({
        esMarketplace: typeof crudo.isMarketplace === 'boolean' ? crudo.isMarketplace
          : (typeof attrs.isMarketPlace === 'boolean' ? attrs.isMarketPlace : null),
        nombre: crudo.sellerName || null,
        id: crudo.sellerId || attrs.supplier || null,
        skuDelVendedor: crudo.sellerSkuId || null,
        skuDelProveedor: attrs.skuSupplier || null
      }),

      cantidad,
      precios: quitarVacios({
        lista, venta, actual,
        totalLinea,
        subtotal: numeroODefecto(crudo.subTotal),
        moneda: (crudo.price && crudo.price.currencyCode) || 'MXN',
        ahorroUnitario,
        descuentoPct
      }),

      planesPago: planesDePago(crudo),
      promociones: promociones(crudo),

      disponibilidad: quitarVacios({
        enStock: typeof crudo.isOnStock === 'boolean' ? crudo.isOnStock : null,
        stockLimitado: typeof crudo.limitedStock === 'boolean' ? crudo.limitedStock : null,
        entregaEstimada: crudo.edd || null,
        restriccionAlcohol: crudo.hasAlcoholRestriction || null,
        restriccionMotocicletas: crudo.hasMotorcyclesRestriction || null
      }),

      imagenes: imagenesDe(crudo),
      fechas: quitarVacios({
        agregado: crudo.addedAt || null,
        modificado: crudo.lastModifiedAt || null
      }),

      fuentes: [origen],
      raw: crudo
    };
  }

  /** Deja fuera claves nulas/vacías para que el visor no pinte filas huecas. */
  function quitarVacios(obj) {
    const salida = {};
    for (const k in obj) {
      const v = obj[k];
      if (v === null || v === undefined || v === '') continue;
      salida[k] = v;
    }
    return salida;
  }

  /**
   * Los atributos varían por departamento (`dimension` en electrónica,
   * `clothingSize` en ropa...), así que se pasan TODOS con nombre legible en vez
   * de elegir a mano un puñado y perder el resto.
   */
  function atributosLegibles(attrs) {
    const NOMBRES = {
      color: 'Color', size: 'Talla', clothingSize: 'Talla',
      shoeSize: 'Talla de calzado', material: 'Material', dimension: 'Dimensión',
      nationality: 'Nacionalidad', isInternational: 'Producto internacional',
      department: 'Departamento', materialGroup: 'Grupo de material',
      productType: 'Tipo de producto', isMarketPlace: 'Marketplace',
      supplier: 'Proveedor', skuSupplier: 'SKU del proveedor',
      promoPrice: 'Precio promocional', name: 'Nombre interno',
      capacity: 'Capacidad', model: 'Modelo', style: 'Estilo',
      gender: 'Género', flavor: 'Sabor', weight: 'Peso'
    };
    // Estos ya tienen su propia sección en la ficha (clasificación, vendedor…):
    // repetirlos aquí solo añadiría ruido.
    const YA_MOSTRADOS = ['department', 'materialGroup', 'productType', 'isMarketPlace',
      'supplier', 'skuSupplier', 'name'];

    const salida = [];
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === '') continue;
      if (YA_MOSTRADOS.indexOf(k) !== -1) continue;
      salida.push({
        clave: k,
        etiqueta: NOMBRES[k] || k,
        valor: typeof v === 'object' ? JSON.stringify(v) : v
      });
    }
    return salida;
  }

  /**
   * Meses sin intereses y pagos fijos. Se leen de `applicablePromotions`, que es
   * donde Liverpool guarda cada plan con su mensualidad ya calculada.
   */
  function planesDePago(crudo) {
    const lista = [];
    const vistos = {};
    const candidatos = []
      .concat(Array.isArray(crudo.applicablePromotions) ? crudo.applicablePromotions : [])
      .concat(crudo.promotion ? [crudo.promotion] : []);

    for (const p of candidatos) {
      const plan = p && p.paymentPlan;
      if (!plan || !Number.isFinite(plan.installments) || plan.installments <= 0) continue;

      const clave = plan.type + '-' + plan.installments;
      if (vistos[clave]) continue;
      vistos[clave] = true;

      lista.push({
        meses: plan.installments,
        pagoMensual: numeroODefecto(plan.installmentPrice),
        totalFinanciado: numeroODefecto(plan.factorPrice),
        tasaFactor: numeroODefecto(plan.factorRate),
        sinIntereses: plan.type === 'monthsWithoutInterest',
        descripcion: p.description || null,
        codigo: p.code || null
      });
    }

    lista.sort((a, b) => a.meses - b.meses);
    return lista;
  }

  /** Promociones que no son planes de pago (descuentos, regalos, cupones). */
  function promociones(crudo) {
    const lista = [];
    const fuente = Array.isArray(crudo.applicablePromotions) ? crudo.applicablePromotions : [];

    for (const p of fuente) {
      if (!p || p.paymentPlan) continue;
      const pct = numeroODefecto(p.discountPercentage) ||
        (numeroODefecto(p.permyriadDiscount) ? p.permyriadDiscount / 100 : null);
      lista.push(quitarVacios({
        descripcion: p.description || null,
        tipo: p.type || null,
        codigo: p.code || null,
        descuentoPct: pct || null,
        compraMinima: numeroODefecto(p.minimumPurchaseAmount) || null,
        skuRegalo: p.giftSku || null
      }));
    }

    // La promoción aplicada viaja aparte y es la que de verdad afecta al precio.
    if (crudo.promotion && crudo.promotion.description && !crudo.promotion.paymentPlan) {
      lista.unshift(quitarVacios({
        descripcion: crudo.promotion.description,
        tipo: crudo.promotion.type || null,
        codigo: crudo.promotion.code || null,
        aplicada: true
      }));
    }

    return lista;
  }

  /**
   * Todas las imágenes del artículo. `assets[].sources[]` trae la galería completa
   * (detalle 1..n, grande, pequeña, miniatura), no solo la que se ve en la bolsa.
   */
  function imagenesDe(crudo) {
    const salida = [];
    const vistas = {};

    const agregar = (url, tipo) => {
      if (!esTextoUtil(url) || vistas[url]) return;
      vistas[url] = true;
      salida.push({ url, tipo: tipo || 'imagen' });
    };

    if (Array.isArray(crudo.assets)) {
      for (const a of crudo.assets) {
        if (!a || !Array.isArray(a.sources)) continue;
        for (const s of a.sources) {
          const clave = (s.key || '');
          let tipo = 'galería';
          if (/thumbnail/i.test(clave)) tipo = 'miniatura';
          else if (/largeImage/i.test(clave)) tipo = 'grande';
          else if (/smallImage/i.test(clave)) tipo = 'pequeña';
          else if (/DetailImg/i.test(clave)) tipo = 'detalle';
          agregar(s.uri, tipo);
        }
      }
    }

    if (Array.isArray(crudo.images)) {
      for (const im of crudo.images) {
        agregar(typeof im === 'string' ? im : (im && (im.url || im.uri)), 'imagen');
      }
    }

    return salida;
  }

  // ---------------------------------------------------------------------------
  // 6. FUSIÓN DE FUENTES
  // ---------------------------------------------------------------------------

  /**
   * Une dos fichas del mismo artículo (por ejemplo la del flight data y la de la
   * tarjeta visible). Gana el valor que ya existía; el nuevo solo rellena huecos.
   */
  function fundir(base, extra) {
    for (const k in extra) {
      const v = extra[k];
      if (v === null || v === undefined || v === '') continue;

      if (k === 'fuentes') {
        v.forEach(f => { if (base.fuentes.indexOf(f) === -1) base.fuentes.push(f); });
        continue;
      }
      if (k === 'raw') {
        base.rawExtra = base.rawExtra || {};
        Object.assign(base.rawExtra, v);
        continue;
      }
      if (Array.isArray(v)) {
        if (!Array.isArray(base[k]) || base[k].length === 0) base[k] = v;
        continue;
      }
      if (typeof v === 'object') {
        base[k] = Object.assign({}, v, base[k] || {});
        continue;
      }
      if (base[k] === null || base[k] === undefined || base[k] === '') base[k] = v;
    }
    return base;
  }

  // ---------------------------------------------------------------------------
  // 7. ORQUESTACIÓN
  // ---------------------------------------------------------------------------

  const fuentes = {};
  const articulos = [];
  const porSku = {};
  const porLinea = {};

  /** Registra una ficha, fundiéndola con la que ya exista para ese artículo. */
  function registrar(ficha) {
    const claveLinea = ficha.idLinea;
    const claveSku = ficha.skuVariante || ficha.skuGeneral;

    let previa = null;
    if (claveLinea && porLinea[claveLinea]) previa = porLinea[claveLinea];
    else if (claveSku && porSku[claveSku]) previa = porSku[claveSku];

    if (previa) {
      fundir(previa, ficha);
    } else {
      articulos.push(ficha);
      previa = ficha;
    }
    if (claveLinea) porLinea[claveLinea] = previa;
    if (claveSku) porSku[claveSku] = previa;
    return previa;
  }

  // --- 7.1 Flight data: la fuente rica -------------------------------------
  let textoFlight = '';
  try {
    textoFlight = cosecharFlight();
  } catch (e) {
    avisos.push('No se pudo leer el flight data de Next.js: ' + e.message);
  }
  fuentes.flightData = { encontrado: textoFlight.length > 0, caracteres: textoFlight.length, articulos: 0 };

  if (textoFlight) {
    try {
      const crudos = parsearArticulos(objetosConPintaDeArticulo(textoFlight));

      // Si el mismo SKU aparece varias veces, nos quedamos con el objeto más completo.
      const mejores = {};
      for (const c of crudos) {
        const clave = (c.id || '') + '|' + (c.sku || c.skuId || '');
        const anterior = mejores[clave];
        if (!anterior || Object.keys(c).length > Object.keys(anterior).length) mejores[clave] = c;
      }

      Object.keys(mejores).forEach(k => registrar(normalizar(mejores[k], 'flight-data')));
      fuentes.flightData.articulos = Object.keys(mejores).length;
    } catch (e) {
      avisos.push('El flight data se leyó pero no se pudo interpretar: ' + e.message);
    }
  }

  // --- 7.2 Tarjetas visibles de la bolsa -----------------------------------
  let tarjetas = [];
  try {
    tarjetas = cosecharTarjetasBolsa();
  } catch (e) {
    avisos.push('Error leyendo las tarjetas de la bolsa: ' + e.message);
  }
  fuentes.tarjetasBolsa = { encontrado: tarjetas.length > 0, articulos: tarjetas.length };

  tarjetas.forEach(t => {
    const ficha = registrar({
      idLinea: t.idLinea,
      skuVariante: t.skuVariante || null,
      skuGeneral: t.skuGeneral || null,
      nombre: t.nombre || null,
      cantidad: t.cantidad,
      precios: {},
      atributos: [],
      planesPago: [],
      promociones: [],
      imagenes: [],
      fuentes: ['bolsa-dom'],
      raw: {}
    });

    // Lo que solo sabe el DOM
    if (!ficha.urlFicha && t.urlFicha) ficha.urlFicha = t.urlFicha;
    if (!ficha.slug && t.slug) ficha.slug = t.slug;
    if (t.cantidad) ficha.cantidad = t.cantidad;
    if (t.vendidoPor) {
      ficha.vendedor = ficha.vendedor || {};
      if (!ficha.vendedor.nombre) ficha.vendedor.nombre = t.vendidoPor;
    }

    ficha.preciosVisibles = quitarVacios({
      original: t.precioOriginal || null,
      conDescuento: t.precioDescuento || null,
      totalLinea: t.totalLinea || null
    });

    if (t.imagen && !ficha.imagenes.some(i => i.url === t.imagen)) {
      ficha.imagenes.unshift({ url: t.imagen, tipo: 'mostrada en la bolsa' });
    }
    if (Object.keys(t.datos).length) ficha.datosTarjeta = t.datos;
  });

  // --- 7.3 JSON-LD y __NEXT_DATA__ (ficha de producto) ---------------------
  const jsonLd = cosecharJsonLd();
  fuentes.jsonLd = { encontrado: jsonLd.length > 0, bloques: jsonLd.length };

  const nextData = cosecharNextData();
  fuentes.nextData = { encontrado: !!nextData };

  let productosEstructurados = [];
  try {
    jsonLd.forEach(b => { productosEstructurados = productosEstructurados.concat(buscarProductosEnObjeto(b, 8000)); });
    if (nextData) productosEstructurados = productosEstructurados.concat(buscarProductosEnObjeto(nextData, 20000));
  } catch (e) {
    avisos.push('Error recorriendo datos estructurados: ' + e.message);
  }

  productosEstructurados.forEach(p => {
    const oferta = Array.isArray(p.offers) ? p.offers[0] : p.offers;
    const ficha = normalizar({
      sku: p.sku || p.skuId || (p.productID || null),
      productId: p.productID || p.mpn || null,
      productName: p.name || p.title || null,
      description: p.description || null,
      brand: (p.brand && (p.brand.name || p.brand)) || null,
      price: oferta ? (oferta.price || oferta.lowPrice) : null,
      listPrice: oferta ? (oferta.highPrice || null) : null,
      images: [].concat(p.image || []),
      attributes: {
        color: p.color || null,
        material: p.material || null,
        size: p.size || null,
        model: p.model || null
      }
    }, 'json-ld');

    if (oferta && oferta.availability) {
      ficha.disponibilidad.disponibilidadDeclarada = String(oferta.availability).replace('https://schema.org/', '');
    }
    if (p.gtin13 || p.gtin || p.mpn) {
      ficha.identificadoresExtra = quitarVacios({ gtin: p.gtin13 || p.gtin || null, mpn: p.mpn || null });
    }
    if (p.aggregateRating) {
      ficha.calificacion = quitarVacios({
        promedio: numeroODefecto(p.aggregateRating.ratingValue),
        opiniones: numeroODefecto(p.aggregateRating.reviewCount || p.aggregateRating.ratingCount)
      });
    }
    if (esTextoUtil(ficha.skuVariante) || esTextoUtil(ficha.nombre)) registrar(ficha);
  });

  // --- 7.4 Ficha de producto: rellenar desde la propia URL y las <meta> ------
  const metas = cosecharMetas();
  const microdatos = cosecharMicrodatos();
  const especificaciones = cosecharEspecificaciones();
  fuentes.metas = { encontrado: Object.keys(metas).length > 0, etiquetas: Object.keys(metas).length };
  fuentes.microdatos = { encontrado: Object.keys(microdatos).length > 0 };
  fuentes.especificaciones = { encontrado: especificaciones.length > 0, filas: especificaciones.length };

  const urlActual = location.href;
  const rutaPdp = /\/pdp\/([^/?#]+)\/(\d+)/i.exec(urlActual) ||
    /\/pdp\/([^/?#]+)\/(\d+)/i.exec(metas['link:canonical'] || metas['og:url'] || '');
  const skuDeUrl = (function () {
    try { return new URL(urlActual).searchParams.get('skuid'); } catch (e) { return null; }
  })();

  if (rutaPdp) {
    // Estamos en una ficha de producto: si nada la registró aún, se crea con lo
    // que da la página, y si ya existía se le completan los huecos.
    const skuGeneral = rutaPdp[2];
    const skuVariante = skuDeUrl || skuGeneral;

    const ficha = registrar({
      idLinea: null,
      skuVariante,
      skuGeneral,
      slug: rutaPdp[1],
      nombre: null,
      atributos: [], planesPago: [], promociones: [], imagenes: [],
      precios: {}, fuentes: ['ficha-dom'], raw: {}
    });

    const h1 = document.querySelector('h1');
    if (!ficha.nombre) ficha.nombre = limpio(h1 ? h1.textContent : '') || metas['og:title'] || document.title || null;
    if (!ficha.descripcion) ficha.descripcion = metas['og:description'] || metas['description'] || null;
    if (!ficha.urlFicha) ficha.urlFicha = metas['link:canonical'] || metas['og:url'] || urlActual;
    if (!ficha.marca) ficha.marca = metas['product:brand'] || microdatos.brand || null;

    const imagenMeta = metas['og:image'] || microdatos.image;
    if (imagenMeta && !ficha.imagenes.some(i => i.url === imagenMeta)) {
      ficha.imagenes.unshift({ url: imagenMeta, tipo: 'principal (og:image)' });
    }

    const precioMeta = metas['product:price:amount'] || microdatos.price;
    if (precioMeta && ficha.precios.actual == null) {
      ficha.precios.actual = precioDeTexto(precioMeta);
      ficha.precios.moneda = metas['product:price:currency'] || 'MXN';
    }

    if (especificaciones.length) ficha.especificaciones = especificaciones;
    if (Object.keys(microdatos).length) ficha.microdatos = microdatos;
  }

  // --- 7.5 Cierre ----------------------------------------------------------
  articulos.forEach(a => {
    // En una ficha de producto el flight data trae también los carruseles de
    // recomendados: se marca cuál es EL artículo de la página para que el visor
    // lo ponga primero y no se confunda con "también te puede interesar".
    a.esPrincipal = !!(rutaPdp && (
      (a.skuGeneral && a.skuGeneral === rutaPdp[2]) ||
      (skuDeUrl && a.skuVariante === skuDeUrl)
    ));
  });

  articulos.sort((a, b) => (b.esPrincipal ? 1 : 0) - (a.esPrincipal ? 1 : 0));

  const LIMITE_ARTICULOS = 120;
  if (articulos.length > LIMITE_ARTICULOS) {
    avisos.push('La página contenía ' + articulos.length + ' artículos (carruseles incluidos); se conservaron los primeros ' + LIMITE_ARTICULOS + '.');
    articulos.length = LIMITE_ARTICULOS;
  }

  articulos.forEach(a => {
    // La imagen principal se decide al final, cuando ya se juntaron todas.
    if (!a.imagenPrincipal && a.imagenes && a.imagenes.length) {
      const grande = a.imagenes.find(i => i.tipo === 'grande') ||
        a.imagenes.find(i => i.tipo === 'mostrada en la bolsa') || a.imagenes[0];
      a.imagenPrincipal = grande.url;
    }
    // Si la ficha no trae enlace pero sí los dos SKU, se puede componer el de la variante.
    if (!a.urlFicha && a.skuGeneral && a.slug) {
      a.urlFicha = 'https://www.liverpool.com.mx/tienda/pdp/' + a.slug + '/' + a.skuGeneral +
        (a.skuVariante ? '?skuid=' + a.skuVariante : '');
    }
    a.totalCampos = contarCampos(a.raw) + contarCampos(a.rawExtra || {});
  });

  function contarCampos(obj, prof) {
    prof = prof || 0;
    if (!obj || typeof obj !== 'object' || prof > 8) return 0;
    let n = 0;
    for (const k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      const v = obj[k];
      if (v && typeof v === 'object') n += contarCampos(v, prof + 1);
      else n += 1;
    }
    return n;
  }

  if (!articulos.length) {
    avisos.push('No se encontró ningún artículo. Abre la bolsa de compras o la ficha de un producto de Liverpool y vuelve a intentarlo.');
  }

  return {
    extractedAt: new Date().toISOString(),
    page: {
      url: urlActual,
      titulo: document.title || '',
      tipo: rutaPdp ? 'ficha de producto' : (tarjetas.length ? 'bolsa de compras' : 'otra'),
      metas
    },
    articles: articulos,
    summary: cosecharResumen(),
    sources: fuentes,
    warnings: avisos
  };
}
