/**
 * =============================================================================
 * Ventel · Inspector de artículo (product-inspector.js)
 * =============================================================================
 * Contiene UNA sola función, `inspectProductFromDOM`, que se inyecta tal cual en
 * la pestaña activa con `chrome.scripting.executeScript({ func: ... })`.
 *
 * Extrae absolutamente toda la información visible y oculta de una ficha de
 * producto (PDP) de Liverpool: nombre, marca, SKUs (general y por variante),
 * colores disponibles, tallas/capacidades, precios, imágenes, vendedor,
 * especificaciones, planes de pago, y todo lo que el flight data de Next.js
 * y los datos estructurados revelen.
 *
 * Hecho por su gran amigo David Martínez "El escritor" · v1.7 · 11/08/2026
 */

function inspectProductFromDOM() {
  const warnings = [];
  const addWarning = (msg) => {
    console.warn("Ventel Extractor:", msg);
    warnings.push(msg);
  };

  // --- Utilidades del DOM ---
  const qs = (selector, parent = document) => parent.querySelector(selector);
  const qsa = (selector, parent = document) => Array.from(parent.querySelectorAll(selector) || []);
  const getText = (el) => el ? el.textContent.trim() : null;
  const getAttr = (el, attr) => el ? el.getAttribute(attr) : null;

  /**
   * Parsea "$29,999.10" → 29999.10. Comparte criterio con el extractor de bolsa
   * clásico: los centavos son los dos primeros dígitos tras el punto, porque
   * Liverpool repite la cifra en un span de accesibilidad.
   */
  const parsePrice = (str) => {
    if (!str) return null;
    let limpiado = String(str).trim();
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
    return isNaN(n) ? null : n;
  };

  /** Precio a partir de un contenedor con la estructura de spans de Liverpool. */
  const parsePriceFromNode = (nodo) => {
    if (!nodo) return null;
    let texto = '';
    const spans = nodo.querySelectorAll('span');
    if (spans.length) {
      spans.forEach(s => { if (!s.classList.contains('invisible')) texto += s.textContent; });
    } else {
      texto = nodo.textContent;
    }
    return parsePrice(texto);
  };

  const currentUrl = window.location.href;
  const urlObj = new URL(currentUrl, window.location.origin); // Maneja file:// si es local
  const isProductPage = currentUrl.includes('/pdp/') || currentUrl.includes('file://');

  // Estructura principal de respuesta
  const result = {
    extractedAt: new Date().toISOString(),
    url: currentUrl,
    isProductPage: isProductPage,
    product: {
      name: null,
      brand: null,
      skuGeneral: null,
      skuVariante: null,
      slug: null,
      description: null,
      url: null,
      productCode: null,
      
      prices: {
        current: null,
        original: null,
        currency: 'MXN',
        discountPercent: null,
        savings: null
      },
      
      images: [],
      colors: [],
      sizes: [],
      variants: [],
      
      seller: {
        name: null,
        isMarketplace: false,
        sellerId: null,
        sellerSku: null
      },
      
      category: {
        breadcrumbs: [],
        department: null,
        productType: null
      },
      
      rating: {
        average: null,
        count: null
      },
      
      specifications: [],
      
      availability: {
        inStock: false,
        buyButtonEnabled: false,
        deliveryEstimate: null
      },
      
      paymentPlans: [],
      promotions: [],
      identifiers: {
        gtin: null,
        mpn: null
      },
      
      meta: {},
      rawFlightData: null
    },
    warnings: warnings
  };

  try {
    // 1. Nombre del producto
    const h1 = qs('h1');
    if (h1) {
      result.product.name = getText(h1);
    } else {
      result.product.name = document.title.split('|')[0].trim();
      addWarning("No se encontró <h1>, usando título del documento");
    }

    // 2. Marca
    const brandEl = qs("a[data-testid$='-brand-link'] span");
    if (brandEl) {
      result.product.brand = getText(brandEl);
    }

    // 3 & 4. SKUs y Slug desde URL
    // Formato URL: /pdp/slug-del-producto/1234567890?skuid=0987654321
    const pathParts = urlObj.pathname.split('/');
    const pdpIndex = pathParts.indexOf('pdp');
    if (pdpIndex !== -1 && pathParts.length > pdpIndex + 2) {
      result.product.slug = pathParts[pdpIndex + 1];
      result.product.skuGeneral = pathParts[pdpIndex + 2];
    }
    
    // SKU Variante desde query params
    const skuidParam = urlObj.searchParams.get('skuid');
    if (skuidParam) {
      result.product.skuVariante = skuidParam;
    }

    // Código de producto desde texto en la página
    const pElements = qsa('p');
    for (const p of pElements) {
      const text = getText(p);
      if (text && text.toLowerCase().includes('código de producto:')) {
        const parts = text.split(':');
        if (parts.length > 1) {
          result.product.productCode = parts[1].trim();
        }
        break;
      }
    }

    // 5. Precios
    // Precio actual: intentar primero con parseo de nodo (estructura de spans),
    // luego con texto plano como respaldo.
    const currentPriceSpans = qsa('span.text-price-primary');
    if (currentPriceSpans.length > 0) {
      result.product.prices.current = parsePriceFromNode(currentPriceSpans[0]) || parsePrice(getText(currentPriceSpans[0]));
    }

    // Precio original (tachado)
    const originalPriceContainers = qsa("[data-testid$='-original-prices'], [data-testid$='-configurator-price-min-price-range']");
    for (const container of originalPriceContainers) {
      const strikeSpans = qsa(".line-through", container);
      if (strikeSpans.length > 0) {
        result.product.prices.original = parsePrice(getText(strikeSpans[0]));
        break;
      }
    }

    // Calcular descuentos si tenemos ambos precios
    if (result.product.prices.current && result.product.prices.original && result.product.prices.original > result.product.prices.current) {
      result.product.prices.savings = result.product.prices.original - result.product.prices.current;
      result.product.prices.discountPercent = Math.round((result.product.prices.savings / result.product.prices.original) * 100);
    }

    // 6. Imágenes (DOM)
    // Imagen principal
    const mainImg = qs("figure[data-testid^='pdp-'][data-testid$='gallery__main__image'] img");
    if (mainImg) {
      const src = getAttr(mainImg, 'src');
      if (src) {
        result.product.images.push({
          url: src,
          type: 'main',
          alt: getAttr(mainImg, 'alt') || ''
        });
      }
    }

    // Miniaturas
    const thumbnails = qsa("button[data-testid^='pdp-'][data-testid$='__thumbnail-'] img");
    thumbnails.forEach(img => {
      const src = getAttr(img, 'src');
      if (src) {
        // Intentar obtener la versión grande reemplazando /sm/ por /xl/ si aplica
        const largeUrl = src.replace('/sm/', '/xl/');
        result.product.images.push({
          url: largeUrl,
          type: 'thumbnail',
          alt: getAttr(img, 'alt') || ''
        });
      }
    });

    // 7. Colores
    const colorButtons = qsa("div[data-testid='ml-image-picker'] button");
    colorButtons.forEach(btn => {
      const img = qs("img", btn);
      const textP = qs("p.text-caption", btn);
      const colorName = getText(textP) || (img ? getAttr(img, 'alt') : 'Desconocido');
      const isSelected = btn.classList.contains('active') || getAttr(btn, 'aria-selected') === 'true' || getAttr(btn, 'aria-current') === 'true';
      
      result.product.colors.push({
        name: colorName,
        imageUrl: img ? getAttr(img, 'src') : null,
        selected: isSelected,
        sku: null // Se intentará enriquecer más adelante con flight data
      });
    });

    // 8. Tallas / Capacidades
    const sizeInputs = qsa("div[data-testid^='ml-radio-group-size-picker'] input[type='radio']");
    sizeInputs.forEach(input => {
      const val = input.value;
      const isAvailable = !input.disabled;
      const isSelected = input.checked;
      
      // Buscar label asociado
      const id = input.id;
      let labelText = val;
      if (id) {
        const label = qs(`label[for='${id}']`);
        if (label) labelText = getText(label) || val;
      }
      
      result.product.sizes.push({
        value: val,
        label: labelText,
        available: isAvailable,
        selected: isSelected
      });
    });

    // 9. Información del vendedor
    const mkpSellerLink = qs("a[data-testid$='-mkp-seller-link'] span");
    if (mkpSellerLink) {
      result.product.seller.isMarketplace = true;
      result.product.seller.name = getText(mkpSellerLink);
    } else {
      // Buscar texto 'Vendido por'
      const allDivs = qsa('div, p, span');
      let foundSeller = false;
      for (const el of allDivs) {
        const txt = getText(el);
        if (txt && txt.startsWith('Vendido por')) {
          result.product.seller.name = txt.replace('Vendido por', '').trim();
          result.product.seller.isMarketplace = result.product.seller.name.toLowerCase() !== 'liverpool';
          foundSeller = true;
          break;
        }
      }
      
      if (!foundSeller) {
        // Por defecto, si no es marketplace evidente, es Liverpool
        result.product.seller.name = 'Liverpool';
        result.product.seller.isMarketplace = false;
      }
    }

    // 10. Breadcrumbs
    const breadcrumbLinks = qsa("nav[data-testid$='-breadcrumb'] ul li a span");
    result.product.category.breadcrumbs = breadcrumbLinks.map(span => getText(span)).filter(Boolean);
    
    if (result.product.category.breadcrumbs.length > 0) {
      result.product.category.department = result.product.category.breadcrumbs[0];
      if (result.product.category.breadcrumbs.length > 1) {
        result.product.category.productType = result.product.category.breadcrumbs[result.product.category.breadcrumbs.length - 1];
      }
    }

    // 11. Ratings
    const reviewDiv = qs("div[data-testid$='-review-desktop']");
    if (reviewDiv) {
      const reviewText = getText(reviewDiv);
      // Buscar patrón "(N)" o similar para conteo de reseñas
      const countMatch = reviewText.match(/\((\d+)\)/);
      if (countMatch) {
        result.product.rating.count = parseInt(countMatch[1], 10);
      }
      
      // Estrellas (esto es complejo porque depende de las clases o SVGs, intentaremos extraer del texto o atributos)
      const stars = qsa("svg", reviewDiv);
      // Implementación básica, dependiente de estructura exacta, omitida en favor de JSON-LD
    }

    // 12. Especificaciones
    const specToggle = qs("button[data-testid='ml-list-item-specs']");
    // Aunque no esté abierto, a veces el DOM existe. Buscaremos tablas o listas de descripción.
    const specTables = qsa("table");
    specTables.forEach(table => {
      const rows = qsa("tr", table);
      rows.forEach(row => {
        const th = qs("th", row);
        const td = qs("td", row);
        if (th && td) {
          result.product.specifications.push({
            label: getText(th),
            value: getText(td)
          });
        }
      });
    });
    
    const dlElements = qsa("dl");
    dlElements.forEach(dl => {
      const dts = qsa("dt", dl);
      const dds = qsa("dd", dl);
      dts.forEach((dt, i) => {
        if (dds[i]) {
          result.product.specifications.push({
            label: getText(dt),
            value: getText(dds[i])
          });
        }
      });
    });

    // 13. Descripción (DOM y Meta)
    const metaDesc = qs("meta[name='description']") || qs("meta[property='og:description']");
    if (metaDesc) {
      result.product.description = getAttr(metaDesc, 'content');
    }

    // 14 & 15. Disponibilidad y Envío
    const buyButton = qs("button[data-testid='buy-now-button']");
    result.product.availability.buyButtonEnabled = buyButton && !buyButton.disabled;
    result.product.availability.inStock = result.product.availability.buyButtonEnabled;

    const deliveryTags = qsa("span");
    for (const span of deliveryTags) {
      const text = getText(span);
      if (text && text.toLowerCase().includes('envío gratis')) {
        result.product.promotions.push({
          type: 'shipping',
          description: text,
          code: null
        });
      }
      if (text && (text.toLowerCase().includes('recibe el') || text.toLowerCase().includes('llega el'))) {
        result.product.availability.deliveryEstimate = text;
      }
    }

    // 18. Meta Tags Generales
    const metaTags = qsa("meta");
    metaTags.forEach(meta => {
      const name = getAttr(meta, 'name') || getAttr(meta, 'property');
      const content = getAttr(meta, 'content');
      if (name && content && (name.startsWith('og:') || name.startsWith('twitter:') || name.startsWith('product:'))) {
        result.product.meta[name] = content;
      }
    });
    
    const canonical = qs("link[rel='canonical']");
    if (canonical) {
      result.product.url = getAttr(canonical, 'href');
    }

    // =========================================================================
    // 17. Parseo de JSON-LD (Datos Estructurados)
    // =========================================================================
    const jsonLdScripts = qsa("script[type='application/ld+json']");
    jsonLdScripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        
        // Manejar tanto array de objetos como objeto único
        const items = Array.isArray(data) ? data : [data];
        
        items.forEach(item => {
          // A veces los datos vienen en un array @graph
          const graphItems = item['@graph'] ? item['@graph'] : [item];
          
          graphItems.forEach(node => {
            if (node['@type'] === 'Product') {
              if (!result.product.name) result.product.name = node.name;
              if (!result.product.description) result.product.description = node.description;
              if (node.sku && !result.product.skuGeneral) result.product.skuGeneral = node.sku;
              if (node.mpn) result.product.identifiers.mpn = node.mpn;
              if (node.gtin || node.gtin13 || node.gtin14) {
                result.product.identifiers.gtin = node.gtin || node.gtin13 || node.gtin14;
              }
              
              if (node.brand) {
                result.product.brand = typeof node.brand === 'string' ? node.brand : node.brand.name;
              }
              
              if (node.aggregateRating) {
                result.product.rating.average = parseFloat(node.aggregateRating.ratingValue);
                result.product.rating.count = parseInt(node.aggregateRating.reviewCount || node.aggregateRating.ratingCount);
              }
              
              if (node.offers) {
                const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
                if (!result.product.prices.current && offer.price) {
                  result.product.prices.current = parseFloat(offer.price);
                }
                if (offer.priceCurrency) {
                  result.product.prices.currency = offer.priceCurrency;
                }
                if (offer.availability) {
                  result.product.availability.inStock = offer.availability.includes('InStock');
                }
              }
            }
          });
        });
      } catch (e) {
        addWarning(`Error parseando JSON-LD: ${e.message}`);
      }
    });

    // =========================================================================
    // 16. Parseo de Next.js Flight Data (Técnica "deep-extractor")
    // =========================================================================
    
    // Función auxiliar para reconstruir cadenas grandes escapadas
    function finDeCadena(str, inicio) {
      let escapado = false;
      for (let i = inicio; i < str.length; i++) {
        if (escapado) { escapado = false; continue; }
        if (str[i] === '\\') { escapado = true; continue; }
        if (str[i] === '"') return i;
      }
      return -1;
    }

    try {
      const scripts = qsa("script");
      let flightDataString = "";
      
      // Buscar fragmentos de flight data (self.__next_f.push)
      scripts.forEach(script => {
        const text = script.textContent;
        if (text && text.includes("self.__next_f.push")) {
          // Extraer los argumentos del push
          const matches = text.matchAll(/self\.__next_f\.push\((.*?)\);?/gs);
          for (const match of matches) {
            try {
              // match[1] suele ser [1, "CADENA JSON ESCAPADA"]
              const arr = JSON.parse(match[1]);
              if (Array.isArray(arr) && arr.length > 1 && typeof arr[1] === "string") {
                const payload = arr[1];
                // Los payloads útiles suelen empezar con "T", "S", o un número seguido de ":"
                if (/^[0-9]+:/.test(payload) || payload.startsWith("T") || payload.startsWith("S") || payload.startsWith("[")) {
                   flightDataString += payload + "\n";
                }
              }
            } catch (e) {
              // Silencioso, algunos push tienen variables en vez de JSON
            }
          }
        }
      });

      if (flightDataString) {
        // Encontrar objetos con pinta de artículo en el texto en crudo
        // Buscamos patrones como "productId", "skuId", "productName"
        const objetosConPintaDeArticulo = [];
        
        let pos = 0;
        while (pos < flightDataString.length) {
          const match = flightDataString.indexOf('{"', pos);
          if (match === -1) break;
          
          // Buscar el cierre del objeto
          let llavesAbiertas = 1;
          let i = match + 2;
          let dentroDeCadena = false;
          
          while (i < flightDataString.length && llavesAbiertas > 0) {
            if (!dentroDeCadena && flightDataString[i] === '"') {
              dentroDeCadena = true;
            } else if (dentroDeCadena && flightDataString[i] === '"' && flightDataString[i-1] !== '\\') {
              dentroDeCadena = false;
            } else if (!dentroDeCadena && flightDataString[i] === '{') {
              llavesAbiertas++;
            } else if (!dentroDeCadena && flightDataString[i] === '}') {
              llavesAbiertas--;
            }
            i++;
          }
          
          if (llavesAbiertas === 0) {
            const jsonStr = flightDataString.substring(match, i);
            try {
              // Intentar parsear si el objeto parece contener info de producto
              if (jsonStr.includes('"skuId"') || jsonStr.includes('"productId"') || jsonStr.includes('"listPrice"')) {
                // Reemplazar algunos escapes comunes en el stream de Next.js
                let cleanStr = jsonStr.replace(/\\"/g, '"');
                // Esto es un intento burdo, muchas veces el JSON está mal formado dentro del stream si lo extraemos así.
                // Mejor vamos a usar RegExp para extraer propiedades clave si el parseo falla.
                try {
                   const obj = JSON.parse(jsonStr);
                   objetosConPintaDeArticulo.push(obj);
                } catch(pe) {
                   // Extracción por fuerza bruta de propiedades si falla el parse
                   const regexExtractor = (key) => {
                     const r = new RegExp(`"${key}"\\s*:\\s*("[^"]+"|\\d+|true|false|null)`);
                     const m = r.exec(jsonStr);
                     if (m) {
                       let val = m[1];
                       if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                       if (val === 'true') val = true;
                       if (val === 'false') val = false;
                       if (val === 'null') val = null;
                       if (!isNaN(Number(val)) && typeof val !== 'boolean' && val !== null) val = Number(val);
                       return val;
                     }
                     return null;
                   };
                   
                   const skuId = regexExtractor("skuId");
                   if (skuId) {
                     objetosConPintaDeArticulo.push({
                       skuId,
                       listPrice: regexExtractor("listPrice"),
                       promoPrice: regexExtractor("promoPrice"),
                       colorHex: regexExtractor("colorHex"),
                       size: regexExtractor("size"),
                       inStock: regexExtractor("inStock")
                     });
                   }
                }
              }
            } catch (e) {
              // Silencioso
            }
            pos = i;
          } else {
            pos = match + 1;
          }
        }
        
        // Enriquecer datos con lo encontrado
        let mainProductObj = null;
        
        for (const obj of objetosConPintaDeArticulo) {
          // Si encontramos un objeto de producto principal
          if (obj.productId && obj.productName) {
            mainProductObj = obj;
            result.product.rawFlightData = obj; // Guardamos una copia
            
            // Enriquecer datos básicos si nos faltaban
            if (!result.product.skuGeneral) result.product.skuGeneral = obj.productId;
            if (!result.product.brand && obj.brand) result.product.brand = obj.brand;
            
            // Planes de pago a veces vienen aquí
            if (obj.paymentPlans && Array.isArray(obj.paymentPlans)) {
              // No lo extraemos completo por brevedad, pero la estructura existe
            }
          }
          
          // Enriquecer o crear variantes
          if (obj.skuId || obj.sku) {
            const skuId = obj.skuId || obj.sku;
            const existingVariant = result.product.variants.find(v => v.sku === skuId);
            
            const variantData = existingVariant || {
              sku: skuId,
              color: null,
              size: null,
              price: null,
              listPrice: null,
              inStock: true,
              images: []
            };
            
            if (obj.colorHex || obj.color) variantData.color = obj.colorHex || obj.color;
            if (obj.size) variantData.size = obj.size;
            if (obj.promoPrice !== undefined) variantData.price = obj.promoPrice;
            if (obj.listPrice !== undefined) variantData.listPrice = obj.listPrice;
            if (obj.inStock !== undefined) variantData.inStock = obj.inStock;
            
            if (!existingVariant) {
              result.product.variants.push(variantData);
            }
          }
        }
        
        // Extraer imágenes completas desde urls CDN 
        // Si no encontramos buenas imágenes, armamos URLs basados en los SKUs descubiertos
        if (result.product.images.length === 0 && result.product.skuGeneral) {
           result.product.images.push({
             url: `https://ss628.liverpool.com.mx/xl/${result.product.skuGeneral}.jpg`,
             type: 'main',
             alt: result.product.name || 'Producto'
           });
        }
        
        // Enlazar SKUs de variantes a los colores encontrados visualmente
        if (result.product.colors.length > 0 && result.product.variants.length > 0) {
          // Intento heurístico: si tenemos un color seleccionado visualmente y sabemos el SKU variante
          const selectedColor = result.product.colors.find(c => c.selected);
          if (selectedColor && result.product.skuVariante) {
            selectedColor.sku = result.product.skuVariante;
          }
        }

      }
    } catch (e) {
      addWarning(`Error procesando Flight Data: ${e.message}`);
    }

  } catch (err) {
    addWarning(`Error crítico durante la extracción: ${err.message}\n${err.stack}`);
  }

  return result;
}
