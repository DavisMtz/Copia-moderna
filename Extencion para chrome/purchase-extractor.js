/**
 * =============================================================================
 * Ventel · Datos de la compra — Extractor y redactor (purchase-extractor.js)
 * =============================================================================
 * TERCERA función de la extensión, y la más pequeña de las tres. La principal
 * sigue siendo extraer la bolsa; esta solo entra en escena cuando la venta ya
 * se cerró y hay que dejar constancia de ella en otro lado.
 *
 * Contiene dos funciones que NO viven en el mismo mundo:
 *
 *   1. `extractPurchaseFromDOM()` — se inyecta tal cual en la pestaña con
 *      `chrome.scripting.executeScript({ func: ... })`, así que es autocontenida:
 *      todos sus ayudantes están dentro. Solo LEE la pantalla de "¡Gracias por
 *      comprar!" y devuelve los datos ordenados, sin darles formato.
 *
 *   2. `formatearCompra(datos)` — se ejecuta en el popup y convierte esos datos
 *      en el texto que se copia. Separadas a propósito: cambiar la redacción no
 *      obliga a tocar la lectura de la página, y al revés.
 *
 * DE DÓNDE SALE CADA COSA
 * -----------------------
 * La pantalla de confirmación reparte la información en tres sitios distintos, y
 * ninguno de los tres la tiene completa:
 *
 *   · El DOM visible          → No. de pedido, entrega estimada, dirección, total.
 *                               El número de pedido SOLO está aquí.
 *   · El flight data de Next  → SKU, cantidad, precio de lista, plan de meses,
 *                               vendedor, marca, color, dirección completa.
 *   · El panel del agente     → el folio de la atención, en el aviso de abajo a
 *                               la derecha ("El folio 27105 se ha marcado como
 *                               cerrado.") y en la cookie `x-cs-folio-id`.
 *
 * Se leen los tres y se funden. Lo que no aparece en la página no aparece en el
 * texto: antes que inventar un dato, esta función lo deja fuera y lo anota en
 * `avisos` para que el popup lo diga.
 *
 * MÚLTIPLES PEDIDOS EN UNA SOLA COMPRA
 * -------------------------------------
 * Cuando el envío se reparte, Liverpool no reparte la COMPRA: reparte la
 * CONFIRMACIÓN. Sigue habiendo un solo carrito, una sola dirección y un solo
 * pago (una sola sección `payment-info-card` y `delivery-info-card` en toda la
 * pantalla), pero la pantalla dibuja una sección `order-products-detail` por
 * pedido, cada una con su propio "No. de pedido" y sus propias tarjetas de
 * artículo — que además reinician su numeración en product-0 dentro de cada
 * sección. Por eso `cosecharSecciones()` recorre sección por sección en vez de
 * `document.querySelector` una sola vez: con un pedido no cambia nada, con
 * varios es la única forma de saber cuál artículo es de cuál.
 *
 * Hecho por su gran amigo David Martínez "El escritor" · v1.6 · 10/08/2026
 */

/**
 * Lee la pantalla de compra confirmada de Liverpool.
 * Se ejecuta DENTRO de la pestaña, no en el popup.
 *
 * @returns {Object} { esPantallaDeCompra, pedido, folio, cliente, articulos,
 *                     pago, entrega, page, avisos }
 */
function extractPurchaseFromDOM() {
  const avisos = [];

  // ---------------------------------------------------------------------------
  // 1. UTILIDADES
  // ---------------------------------------------------------------------------

  /** Colapsa espacios y quita saltos de línea. */
  function limpio(t) {
    return (t || '').replace(/\s+/g, ' ').trim();
  }

  function esTextoUtil(v) {
    return typeof v === 'string' && v.trim() !== '';
  }

  function numeroODefecto(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * "$28,479.00" → 28479. Mismo criterio que el resto de la extensión: los
   * centavos son los dos primeros dígitos tras el punto, porque Liverpool repite
   * la cifra en un span de accesibilidad y si no se corta salen números absurdos.
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

  /**
   * Objeto de dinero de commercetools ({centAmount, fractionDigits}) → pesos.
   * Acepta también un número suelto o un texto con símbolo.
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
    }
    if (typeof v === 'string') return precioDeTexto(v) || null;
    return null;
  }

  /** Texto de un selector, ya limpio. Cadena vacía si el nodo no existe. */
  function textoDe(selector, raiz) {
    const el = (raiz || document).querySelector(selector);
    return el ? limpio(el.textContent) : '';
  }

  /**
   * Las fechas del carrito vienen como "2026-08-10 01:39:58.441Z", con espacio
   * en vez de la T de ISO. Se normaliza antes de que ningún Date la interprete
   * a su manera.
   */
  function fechaISO(v) {
    if (!esTextoUtil(v)) return null;
    const d = new Date(String(v).trim().replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  /** Índice de la comilla que cierra el literal abierto en `inicio`. -1 si nunca cierra. */
  function finDeCadena(texto, inicio) {
    for (let i = inicio + 1; i < texto.length; i++) {
      const c = texto[i];
      if (c === '\\') { i++; continue; }
      if (c === '"') return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // 2. FLIGHT DATA DE NEXT.JS: EL CARRITO COMPLETO
  // ---------------------------------------------------------------------------

  /**
   * Reconstruye el stream que Next.js dejó repartido en decenas de
   * `self.__next_f.push([1,"..."])`. Cada push trae un trozo del JSON y hay que
   * concatenarlos EN ORDEN, porque un objeto puede quedar partido entre dos.
   *
   * Se lee del texto de los <script> y no de la variable global para que también
   * funcione con la página guardada en disco y desde el mundo aislado del script
   * inyectado, que no ve las variables de la página.
   *
   * (Misma técnica que `deep-extractor.js`. Está repetida porque cada función
   * viaja sola a la pestaña: lo que se saque fuera deja de existir allá.)
   */
  function cosecharFlight() {
    const trozos = [];

    document.querySelectorAll('script').forEach(s => {
      const t = s.textContent || '';
      if (t.indexOf('__next_f.push') === -1) return;

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
    });

    return trozos.join('');
  }

  /**
   * Devuelve el texto del objeto JSON que empieza en `inicio` (que debe ser una
   * llave de apertura), respetando las cadenas. Null si nunca cierra.
   */
  function recortarObjeto(texto, inicio) {
    let nivel = 0;
    for (let i = inicio; i < texto.length; i++) {
      const c = texto[i];
      if (c === '"') {
        const fin = finDeCadena(texto, i);
        if (fin === -1) return null;
        i = fin;
        continue;
      }
      if (c === '{') nivel++;
      else if (c === '}') {
        nivel--;
        if (nivel === 0) return texto.slice(inicio, i + 1);
      }
    }
    return null;
  }

  /**
   * Saca el carrito de la compra del flight data.
   *
   * Se buscan TODAS las apariciones de `"cart":{` y se elige la primera que
   * parsee y traiga artículos: en la misma página conviven otros objetos
   * llamados igual (los del carrito vacío que pinta el encabezado, por ejemplo).
   */
  function cosecharCarrito(texto) {
    if (!texto) return null;

    let desde = 0;
    while (true) {
      const p = texto.indexOf('"cart":{', desde);
      if (p === -1) return null;

      const inicio = texto.indexOf('{', p + 6);
      const frag = inicio === -1 ? null : recortarObjeto(texto, inicio);
      desde = p + 8;

      if (!frag) continue;
      let obj;
      try { obj = JSON.parse(frag); } catch (e) { continue; }

      if (obj && Array.isArray(obj.lineItems) && obj.lineItems.length) return obj;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. EL FOLIO DE LA ATENCIÓN
  // ---------------------------------------------------------------------------

  /**
   * El folio no es de la compra, es de la atención: lo pone el panel del agente
   * (`.csc-admin-panel`) en el aviso de abajo a la derecha al cerrar el caso.
   *
   * Se busca en dos sitios porque ese aviso se desvanece solo a los pocos
   * segundos:
   *
   *   · El aviso, mientras siga en pantalla. De ahí sale la FRASE COMPLETA, tal
   *     como la escribió el sistema, que es lo que se pega después.
   *   · La cookie `x-cs-folio-id`, que sigue ahí toda la sesión. De ahí sale solo
   *     el NÚMERO: que exista la cookie no prueba que el folio se haya cerrado,
   *     así que no se redacta una frase que la página nunca dijo.
   */
  function cosecharFolio() {
    const PATRON = /\b(?:el\s+)?folio\s+(\d{3,})\b[^.]*\./i;

    const candidatos = document.querySelectorAll(
      '.csc-admin-panel, .MuiSnackbar-root, [role="alert"], [role="status"]');

    for (const nodo of candidatos) {
      const texto = limpio(nodo.textContent);
      if (!texto || texto.length > 400) continue;

      const m = PATRON.exec(texto);
      if (m) {
        // La frase se recorta en el primer punto: el aviso lleva pegado el texto
        // del botón "Finalizar atención" y eso no es parte del mensaje.
        return { numero: m[1], frase: limpio(m[0]), origen: 'aviso del panel del agente' };
      }
    }

    const cookie = /(?:^|;\s*)x-cs-folio-id=(\d+)/.exec(document.cookie || '');
    if (cookie) return { numero: cookie[1], frase: null, origen: 'cookie de la sesión' };

    return { numero: null, frase: null, origen: null };
  }

  // ---------------------------------------------------------------------------
  // 4. LO QUE SE VE EN PANTALLA
  // ---------------------------------------------------------------------------

  /**
   * Liverpool separa la confirmación en una sección `order-products-detail` POR
   * PEDIDO cuando el checkout se reparte en varios envíos: misma dirección, mismo
   * pago y mismo carrito, pero cada sección trae su propio "No. de pedido" y sus
   * propias tarjetas de artículo (que reinician su numeración en product-0 dentro
   * de cada sección, así que agruparlas por sección es la única forma de saber
   * cuál artículo es de cuál pedido).
   *
   * Se busca elemento por elemento y no en el texto de la sección entera: al
   * juntar el texto de todo el bloque, el número queda pegado al nombre del
   * primer artículo ("5010117858Comedor…") porque entre dos nodos no hay espacio
   * que los separe.
   */
  function cosecharSecciones() {
    const PATRON = /pedido\s*:?\s*([A-Za-z0-9-]{4,})/i;
    const secciones = document.querySelectorAll('[data-testid="order-products-detail"]');

    return Array.from(secciones).map(seccion => {
      let numero = null;
      for (const el of seccion.querySelectorAll('h1, h2, h3, h4, p, span, div')) {
        const texto = limpio(el.textContent);
        if (!texto || texto.length > 80) continue;
        const m = PATRON.exec(texto);
        if (m) { numero = m[1]; break; }
      }

      const nodos = seccion.querySelectorAll('[data-testid^="order-products-detail-product-"]');
      const tarjetas = Array.from(nodos)
        .filter(n => /-product-\d+$/.test(n.getAttribute('data-testid')))
        .map(card => {
          const id = card.getAttribute('data-testid');
          const img = card.querySelector(`[data-testid="${id}-image"]`);
          const src = img ? (img.getAttribute('src') || '') : '';

          // La miniatura se llama como el SKU (1187360958.jpg), y eso vale también
          // con la página guardada en disco, donde la ruta es local.
          const porImagen = /(\d{6,})\.(?:jpg|jpeg|png|webp|avif)/i.exec(src);

          return {
            nombre: textoDe(`[data-testid="${id}-title"]`, card) || (img ? limpio(img.getAttribute('alt')) : ''),
            etiquetaEntrega: textoDe(`[data-testid="${id}-subtitle"]`, card),
            entregaEstimada: textoDe(`[data-testid="${id}-description"]`, card),
            sku: porImagen ? porImagen[1] : null,
            imagen: /^https?:/i.test(src) ? src : ''
          };
        });

      return { numero, tarjetas };
    });
  }

  /** Tarjeta "Enviaremos tus productos a:" — alias del domicilio y dirección. */
  function cosecharTarjetaEntrega() {
    const card = document.querySelector('[data-testid="delivery-info-card"]');
    if (!card) return { alias: '', direccion: '' };

    const encabezado = textoDe('h2', card);
    let alias = '';
    card.querySelectorAll('span').forEach(s => {
      const t = limpio(s.textContent);
      if (!alias && t && t !== encabezado) alias = t;
    });

    return { alias, direccion: textoDe('p', card) };
  }

  /**
   * Tarjeta "Información de pago": total, forma de pago y terminación.
   *
   * El nombre del medio de pago ("Liverpool Premium Card") y sus cuatro últimos
   * dígitos ("* 7005") vienen en dos spans sueltos, sin data-testid propio ni
   * clase estable. Por eso se recogen recorriendo los textos que SOBRAN en la
   * tarjeta —los que no son el encabezado, ni el importe, ni el "(IVA incluido)"—
   * en vez de apuntar a un selector que Liverpool cambiaría en la próxima
   * temporada.
   */
  function cosecharTarjetaPago() {
    const vacio = { total: null, ivaIncluido: false, formaDePago: null, terminacion: null };
    const card = document.querySelector('[data-testid="payment-info-card"]');
    if (!card) return vacio;

    const nodoTotal = card.querySelector('[data-testid="price-amount"]');
    const total = nodoTotal ? precioDeTexto(nodoTotal.textContent) : null;
    const textoTotal = nodoTotal ? limpio(nodoTotal.textContent) : '';
    const encabezado = textoDe('h2', card);

    let ivaIncluido = false;
    let formaDePago = null;
    let terminacion = null;

    card.querySelectorAll('span, p').forEach(el => {
      // Solo hojas: si se miran también los contenedores, el mismo texto entra
      // varias veces y el primero en "sobrar" acaba siendo la tarjeta entera.
      if (el.querySelector('span, p')) return;

      const t = limpio(el.textContent);
      if (!t || t === encabezado || t === textoTotal) return;
      if (/iva/i.test(t)) { ivaIncluido = true; return; }
      if (/^[*•·\s-]*\d{4}$/.test(t)) { terminacion = t.replace(/\D/g, ''); return; }
      if (!formaDePago && t.length < 120) formaDePago = t;
    });

    return { total: total || null, ivaIncluido, formaDePago, terminacion };
  }

  /** Saludo: "¡Carolina Angelica, gracias por comprar!" → nombre y correo. */
  function cosecharCliente() {
    const saludo = textoDe('[data-testid="greetings-section"] h1');
    const m = /^¡?\s*([^,!¡]{2,80}?)\s*,\s*gracias/i.exec(saludo);

    let correo = '';
    document.querySelectorAll('[data-testid="greetings-section-message"] strong').forEach(el => {
      const t = limpio(el.textContent);
      if (!correo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) correo = t;
    });

    return { nombre: m ? m[1] : '', correo };
  }

  // ---------------------------------------------------------------------------
  // 5. NORMALIZACIÓN DEL CARRITO
  // ---------------------------------------------------------------------------

  /**
   * El plan de pago REALMENTE elegido. Viaja en `promotion`, no en
   * `applicablePromotions`: esa otra lista son todos los planes que el artículo
   * admitía, y cotizar con ella sería contar meses que el cliente no contrató.
   */
  function planDe(item) {
    const promo = item && item.promotion;
    if (!promo) return null;

    const plan = promo.paymentPlan;
    if (plan && Number.isFinite(plan.installments) && plan.installments > 1) {
      return {
        meses: plan.installments,
        cuota: numeroODefecto(plan.installmentPrice),
        totalFinanciado: numeroODefecto(plan.factorPrice),
        sinIntereses: plan.type === 'monthsWithoutInterest',
        pagoUnico: false,
        descripcion: esTextoUtil(promo.description) ? limpio(promo.description) : null
      };
    }

    if (/pago\s*[úu]nico/i.test(promo.description || '')) {
      return {
        meses: 1, cuota: null, totalFinanciado: null,
        sinIntereses: false, pagoUnico: true,
        descripcion: limpio(promo.description)
      };
    }

    return null;
  }

  /** Un artículo del carrito, con lo que hace falta para redactar y nada más. */
  function articuloDe(item) {
    const attrs = item.attributes || {};
    const precio = dinero(item.price) != null ? dinero(item.price) : dinero(item.salePrice);
    const lista = dinero(item.listPrice);

    return {
      nombre: esTextoUtil(item.productName) ? limpio(item.productName) : (attrs.name || null),
      sku: esTextoUtil(item.sku) ? item.sku : null,
      skuGeneral: item.productId || item.productSlug || null,
      cantidad: numeroODefecto(item.quantity) || 1,
      precio,
      precioLista: lista != null && precio != null && lista > precio ? lista : null,
      totalLinea: dinero(item.totalPrice),
      marca: esTextoUtil(item.brand) ? item.brand : null,
      color: esTextoUtil(attrs.color) ? attrs.color : null,
      talla: esTextoUtil(attrs.size) ? attrs.size : null,
      vendidoPor: esTextoUtil(item.sellerName) ? item.sellerName : null,
      esMarketplace: item.isMarketplace === true,
      entregaEstimada: null,
      imagen: null,
      plan: planDe(item)
    };
  }

  /** Dirección de envío ya desmenuzada, para poder redactarla bien después. */
  function direccionDe(dir) {
    if (!dir) return null;
    const partes = {
      calle: limpio(dir.streetName),
      numero: limpio(dir.streetNumber),
      interior: limpio(dir.internalNumber),
      edificio: limpio(dir.building),
      colonia: limpio(dir.settlement),
      municipio: limpio(dir.cityDetail) || limpio(dir.city),
      estado: limpio(dir.state),
      cp: limpio(dir.zipCode),
      alias: limpio(dir.alias),
      recibe: limpio([dir.firstName, dir.middleName, dir.lastName, dir.secondLastName]
        .filter(esTextoUtil).join(' ')) || limpio(dir.name),
      telefono: limpio(dir.mobileNumber) || limpio(dir.phoneNumber),
      esDomicilio: dir.deliveryType === 'HOME'
    };
    return partes;
  }

  // ---------------------------------------------------------------------------
  // 6. ORQUESTACIÓN
  // ---------------------------------------------------------------------------

  const secciones = cosecharSecciones();
  const tarjetaEntrega = cosecharTarjetaEntrega();
  const tarjetaPago = cosecharTarjetaPago();
  const cliente = cosecharCliente();
  const folio = cosecharFolio();

  let carrito = null;
  try {
    carrito = cosecharCarrito(cosecharFlight());
  } catch (e) {
    avisos.push('No se pudo leer el detalle interno de la compra: ' + e.message);
  }

  const items = carrito && Array.isArray(carrito.lineItems) ? carrito.lineItems : [];
  const articulosCarrito = items.map(articuloDe);
  const articulos = [];

  // --- Fusión: la fecha de entrega solo la sabe el DOM, y a qué pedido pertenece
  // cada artículo solo lo sabe la sección donde apareció la tarjeta -------------
  // Se empareja por SKU (el nombre del archivo de la miniatura) y, si eso falla,
  // por posición GLOBAL entre todas las secciones: las tarjetas salen en el mismo
  // orden que las líneas del carrito, sin importar en cuántos pedidos se repartan.
  let indiceGlobal = 0;
  const pedidos = secciones.map(seccion => {
    const articulosDelPedido = seccion.tarjetas.map(t => {
      let destino = t.sku ? articulosCarrito.find(a => a.sku === t.sku) : null;
      if (!destino && articulosCarrito[indiceGlobal]) destino = articulosCarrito[indiceGlobal];
      indiceGlobal++;

      if (!destino) {
        // Sin carrito legible, la tarjeta es todo lo que hay. Mejor un artículo
        // con nombre y fecha de entrega que ningún artículo.
        destino = {
          nombre: t.nombre || null, sku: t.sku, skuGeneral: null, cantidad: 1,
          precio: null, precioLista: null, totalLinea: null,
          marca: null, color: null, talla: null,
          vendidoPor: null, esMarketplace: false,
          entregaEstimada: t.entregaEstimada || null,
          imagen: t.imagen || null, plan: null
        };
      } else {
        if (t.entregaEstimada) destino.entregaEstimada = t.entregaEstimada;
        if (!destino.nombre && t.nombre) destino.nombre = t.nombre;
        if (!destino.imagen && t.imagen) destino.imagen = t.imagen;
      }

      articulos.push(destino);
      return destino;
    });

    return { numero: seccion.numero, articulos: articulosDelPedido };
  });

  // Artículos que el carrito trae pero ninguna tarjeta reclamó (DOM con menos
  // tarjetas que líneas): se listan sueltos, sin pedido conocido, en vez de
  // perderlos.
  articulosCarrito.forEach(a => { if (articulos.indexOf(a) === -1) articulos.push(a); });

  const numerosPedido = pedidos.map(p => p.numero).filter(Boolean);
  const totalTarjetas = secciones.reduce((suma, s) => suma + s.tarjetas.length, 0);

  const totalCarrito = carrito ? dinero(carrito.totalPrice) : null;
  const resumen = (carrito && carrito.totalPrice) || {};

  const pago = {
    total: tarjetaPago.total != null ? tarjetaPago.total : totalCarrito,
    subtotal: numeroODefecto(resumen.rawSubtotal),
    descuento: numeroODefecto(resumen.savePrice),
    moneda: resumen.currencyCode || 'MXN',
    ivaIncluido: tarjetaPago.ivaIncluido,
    // Solo lo que la página afirma: si no dice con qué se pagó, aquí no se deduce.
    formaDePago: tarjetaPago.formaDePago,
    terminacion: tarjetaPago.terminacion
  };

  // El carrito guarda los mismos datos por su cuenta. Sirve de repuesto para
  // cuando la tarjeta de pago cambie de estructura y deje de dar el nombre.
  const datosTarjeta = (carrito && carrito.payment) || {};
  if (!pago.formaDePago && esTextoUtil(datosTarjeta.creditCardType)) {
    pago.formaDePago = limpio(datosTarjeta.creditCardType);
  }
  if (!pago.terminacion && esTextoUtil(datosTarjeta.creditCardLastFourDigits)) {
    pago.terminacion = limpio(datosTarjeta.creditCardLastFourDigits);
  }

  const direccion = direccionDe(carrito && carrito.shippingAddress);

  const entrega = {
    alias: tarjetaEntrega.alias || (direccion && direccion.alias) || null,
    direccionVisible: tarjetaEntrega.direccion || null,
    direccion,
    recibe: (direccion && direccion.recibe) || null,
    telefono: (direccion && direccion.telefono) || null
  };

  const pedido = {
    // Singular por compatibilidad con quien ya lee `pedido.numero`: solo se llena
    // cuando la compra es de un pedido. Con varios, hay que mirar `pedido.numeros`
    // o el arreglo `pedidos` de abajo, que trae los artículos de cada uno.
    numero: pedidos.length === 1 ? pedidos[0].numero : null,
    numeros: numerosPedido,
    fecha: fechaISO(carrito && (carrito.lastModifiedAt || carrito.createdAt)),
    idCarrito: (carrito && carrito.orderNumber) || null,
    canal: (carrito && carrito.sourceChannel) || null
  };

  if (!cliente.nombre && entrega.recibe) cliente.nombre = entrega.recibe;
  if (!cliente.telefono) cliente.telefono = entrega.telefono || '';

  // --- Avisos: lo que la pantalla no dijo ------------------------------------
  const esPantallaDeCompra = !!(numerosPedido.length || totalTarjetas);

  if (!esPantallaDeCompra) {
    avisos.push('Esta pestaña no es la pantalla de compra confirmada de Liverpool.');
  } else {
    if (!numerosPedido.length) avisos.push('No se encontró el número de pedido en la pantalla.');
    else if (numerosPedido.length < pedidos.length) avisos.push('Esta compra tiene ' + pedidos.length + ' pedidos y alguno se quedó sin número.');
    if (!articulos.length) avisos.push('No se encontró ningún artículo en la compra.');
    if (!folio.numero) avisos.push('No se encontró el folio de la atención: el aviso del panel del agente ya se cerró y la sesión no dejó la cookie del folio.');
    else if (!folio.frase) avisos.push('El aviso del folio ya no estaba en pantalla: se tomó el número de la sesión, sin la frase de cierre.');
    if (!pago.formaDePago) avisos.push('La pantalla no dice con qué forma de pago se liquidó: solo muestra el logotipo de la tarjeta.');
    if (articulos.some(a => !a.entregaEstimada)) avisos.push('Algún artículo se quedó sin fecha estimada de entrega.');
  }

  return {
    extractedAt: new Date().toISOString(),
    esPantallaDeCompra,
    page: { url: location.href, titulo: document.title || '' },
    pedido,
    // Un pedido por sección de la confirmación, cada uno con sus propios
    // artículos. Con un solo pedido trae un único elemento — `formatearCompra`
    // solo cambia de formato cuando hay más de uno.
    pedidos,
    folio,
    cliente,
    articulos,
    pago,
    entrega,
    avisos
  };
}

/**
 * =============================================================================
 * REDACCIÓN — de los datos al texto que se pega
 * =============================================================================
 * Se ejecuta en el popup, nunca dentro de la pestaña.
 *
 * Regla única: una línea solo se escribe si el dato existe. Ni "N/D", ni ceros
 * de relleno, ni secciones vacías. Un texto con huecos se nota y no se pega; uno
 * corto pero cierto sí.
 */
function formatearCompra(datos) {
  const lineas = [];

  const moneda = n => '$' + Number(n || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  /**
   * Los datos del domicilio llegan en MAYÚSCULAS desde el sistema de Liverpool.
   * Pegar "VILLA MORELOS 2A SECCION" en un correo se lee como un grito, así que
   * se pasa a Capital Inicial. Lo que ya viene con mayúsculas y minúsculas se
   * respeta tal cual: ahí alguien ya decidió cómo se escribe.
   */
  function capitalizar(texto) {
    const t = String(texto || '').trim();
    if (!t || t !== t.toUpperCase()) return t;

    const MENORES = ['de', 'del', 'la', 'las', 'los', 'y', 'a', 'en'];
    return t.toLowerCase().split(/\s+/).map((palabra, i) => {
      if (i > 0 && MENORES.indexOf(palabra) !== -1) return palabra;
      return palabra.charAt(0).toUpperCase() + palabra.slice(1);
    }).join(' ');
  }

  /** 5518877822 → "55 1887 7822". Cualquier otro largo se deja como venga. */
  function telefono(t) {
    const d = String(t || '').replace(/\D/g, '');
    if (d.length !== 10) return String(t || '').trim();
    return d.slice(0, 2) + ' ' + d.slice(2, 6) + ' ' + d.slice(6);
  }

  function fechaLarga(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    // Reloj de 24 horas a propósito: con el de 12 la línea acaba en "07:39 p.m. h".
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' h';
  }

  /** El plan de pago, en palabras. */
  function textoPlan(plan) {
    if (!plan) return null;
    if (plan.pagoUnico) return 'Pago en una sola exhibición';

    const base = plan.sinIntereses
      ? plan.meses + ' meses sin intereses'
      : plan.meses + ' pagos fijos';

    return plan.cuota ? base + ' de ' + moneda(plan.cuota) + ' cada uno' : base;
  }

  // Liverpool reparte una misma compra en varios pedidos cuando el envío se
  // divide (mismo cliente, mismo pago, misma dirección; cada pedido con sus
  // propios artículos y su propia entrega). Con uno solo, el texto de abajo sale
  // exactamente igual que antes de saber agrupar por pedido.
  const pedidos = (datos.pedidos && datos.pedidos.length ? datos.pedidos
    : [{ numero: datos.pedido.numero, articulos: datos.articulos || [] }]);
  const variosPedidos = pedidos.length > 1;

  // --- Encabezado ------------------------------------------------------------
  lineas.push('COMPRA CONFIRMADA · LIVERPOOL');
  if (variosPedidos) {
    const numeros = pedidos.map(p => p.numero).filter(Boolean);
    if (numeros.length) lineas.push('Pedidos (' + numeros.length + '): ' + numeros.join(', '));
  } else if (pedidos[0].numero) {
    lineas.push('No. de pedido: ' + pedidos[0].numero);
  }

  const cuando = fechaLarga(datos.pedido.fecha);
  if (cuando) lineas.push('Fecha de la compra: ' + cuando);

  // --- Cliente ---------------------------------------------------------------
  const cliente = [];
  if (datos.cliente.nombre) cliente.push(capitalizar(datos.cliente.nombre));
  if (datos.cliente.correo) cliente.push('Correo: ' + datos.cliente.correo);
  if (datos.cliente.telefono) cliente.push('Teléfono: ' + telefono(datos.cliente.telefono));

  if (cliente.length) {
    lineas.push('', 'CLIENTE', ...cliente);
  }

  // --- Artículos -------------------------------------------------------------
  const articulos = datos.articulos || [];
  if (articulos.length) {
    const piezas = articulos.reduce((suma, a) => suma + (a.cantidad || 1), 0);
    lineas.push('', 'ARTÍCULOS (' + piezas + (piezas === 1 ? ' pieza)' : ' piezas)'));

    // El plan se escribe una sola vez abajo si toda la compra va con el mismo;
    // si cada artículo lleva el suyo, se escribe en cada uno. Repetir "3 meses
    // sin intereses" en cinco líneas seguidas no informa, estorba.
    const planes = articulos.map(a => textoPlan(a.plan)).filter(Boolean);
    const planUnico = planes.length === articulos.length &&
      planes.every(p => p === planes[0]) ? planes[0] : null;

    /** Una línea numerada por artículo, con todo lo que se sepa de él. */
    function escribirArticulo(a, numero) {
      lineas.push(numero + '. ' + (a.nombre || 'Artículo sin nombre'));

      const identidad = [];
      if (a.sku) identidad.push('SKU: ' + a.sku);
      identidad.push('Cantidad: ' + (a.cantidad || 1));
      lineas.push('   ' + identidad.join(' · '));

      if (a.precio != null) {
        let precio = '   Precio: ' + moneda(a.precio);
        if (a.precioLista) precio += ' (antes ' + moneda(a.precioLista) + ')';
        lineas.push(precio);
      }

      const rasgos = [];
      if (a.color) rasgos.push('Color: ' + a.color);
      if (a.talla) rasgos.push('Talla: ' + a.talla);
      if (a.marca) rasgos.push('Marca: ' + capitalizar(a.marca));
      if (rasgos.length) lineas.push('   ' + rasgos.join(' · '));

      if (a.entregaEstimada) lineas.push('   Entrega estimada: ' + a.entregaEstimada);

      if (a.vendidoPor) {
        lineas.push('   Vendido por: ' + a.vendidoPor + (a.esMarketplace ? ' (Marketplace)' : ''));
      }

      const plan = textoPlan(a.plan);
      if (plan && !planUnico) lineas.push('   Plan: ' + plan);
    }

    if (!variosPedidos) {
      articulos.forEach((a, i) => escribirArticulo(a, i + 1));
    } else {
      // Un subtítulo por pedido y numeración corrida entre todos: sigue siendo
      // "la lista de artículos de la compra", solo que ahora dice de cuál pedido
      // es cada uno.
      let numero = 0;
      pedidos.forEach(p => {
        const piezasPedido = (p.articulos || []).reduce((s, a) => s + (a.cantidad || 1), 0);
        lineas.push('', 'Pedido ' + (p.numero || 'sin número') + ' (' +
          piezasPedido + (piezasPedido === 1 ? ' pieza)' : ' piezas)'));
        (p.articulos || []).forEach(a => escribirArticulo(a, ++numero));
      });
    }

    // --- Pago ----------------------------------------------------------------
    const pago = [];
    if (datos.pago.total != null) {
      pago.push('Total: ' + moneda(datos.pago.total) + (datos.pago.ivaIncluido ? ' (IVA incluido)' : ''));
    }
    if (datos.pago.subtotal != null && datos.pago.descuento) {
      pago.push('Subtotal: ' + moneda(datos.pago.subtotal));
      pago.push('Ahorro: ' + moneda(datos.pago.descuento));
    }
    if (datos.pago.formaDePago) {
      pago.push('Forma de pago: ' + datos.pago.formaDePago +
        (datos.pago.terminacion ? ', terminación ' + datos.pago.terminacion : ''));
    }
    if (planUnico) pago.push('Plan: ' + planUnico);

    if (pago.length) lineas.push('', 'PAGO', ...pago);
  }

  // --- Entrega ---------------------------------------------------------------
  const entrega = [];
  const dir = datos.entrega.direccion;

  if (datos.entrega.alias) entrega.push(capitalizar(datos.entrega.alias));

  if (dir) {
    const calle = [capitalizar(dir.calle), dir.numero].filter(Boolean).join(' ');
    const domicilio = [
      calle,
      capitalizar(dir.colonia),
      capitalizar(dir.municipio),
      capitalizar(dir.estado),
      dir.cp ? 'C.P. ' + dir.cp : ''
    ].filter(Boolean).join(', ');
    if (domicilio) entrega.push(domicilio);

    const referencias = [dir.edificio, dir.interior].filter(Boolean).map(capitalizar);
    if (referencias.length) entrega.push('Referencias: ' + referencias.join(', '));
  } else if (datos.entrega.direccionVisible) {
    entrega.push(datos.entrega.direccionVisible);
  }

  if (datos.entrega.recibe) {
    let recibe = 'Recibe: ' + capitalizar(datos.entrega.recibe);
    if (datos.entrega.telefono) recibe += ' · Tel. ' + telefono(datos.entrega.telefono);
    entrega.push(recibe);
  }

  if (entrega.length) lineas.push('', 'ENTREGA', ...entrega);

  // --- Folio -----------------------------------------------------------------
  // Va al final y separado: es lo único de este texto que no habla de Liverpool
  // sino de la atención, y es la frase que cierra el registro.
  if (datos.folio.frase) lineas.push('', datos.folio.frase);
  else if (datos.folio.numero) lineas.push('', 'Folio de la atención: ' + datos.folio.numero + '.');

  return lineas.join('\n');
}
