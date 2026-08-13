/**
 * =============================================================================
 * Ventel · Visor avanzado de artículos (viewer.js)
 * =============================================================================
 * Pinta lo que `deep-extractor.js` sacó de la página: una tarjeta por artículo y
 * un panel con TODOS sus campos, incluidos los que la tienda no enseña.
 *
 * El visor es deliberadamente dinámico: no da por hecho qué campos existen.
 * Cada sección se dibuja solo si trae datos, y al final siempre hay una tabla
 * con el objeto crudo aplanado, para que un campo nuevo de Liverpool aparezca
 * solo, sin tocar este archivo.
 *
 * Hecho por su gran amigo David Martínez "El escritor" · v1.3 · 01/08/2026
 */

const estado = {
  datos: null,      // resultado completo de la extracción
  tabId: null,      // pestaña de la que salió, para el botón Actualizar
  filtro: 'todos',
  busqueda: '',
  orden: 'orden',
  visibles: []
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Crea un elemento con propiedades e hijos. Nunca usa innerHTML: el texto que
 *  llega viene de una página externa y solo debe tratarse como texto. */
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

function dinero(n, moneda) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    (moneda && moneda !== 'MXN' ? ' ' + moneda : '');
}

function fecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function siNo(v) {
  if (v === true) return 'Sí';
  if (v === false) return 'No';
  return String(v);
}

let temporizadorAviso = null;
function aviso(texto) {
  const nodo = document.getElementById('aviso');
  nodo.textContent = texto;
  nodo.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { nodo.hidden = true; }, 3000);
}

/** Precio de referencia de un artículo, mirando primero lo estructurado y
 *  cayendo a lo que se ve en pantalla si no hubo flight data. */
function precioActual(a) {
  const p = a.precios || {};
  if (Number.isFinite(p.actual)) return p.actual;
  if (Number.isFinite(p.venta)) return p.venta;
  if (Number.isFinite(p.lista)) return p.lista;
  const v = a.preciosVisibles || {};
  if (Number.isFinite(v.conDescuento)) return v.conDescuento;
  if (Number.isFinite(v.original)) return v.original;
  return null;
}

function precioLista(a) {
  const p = a.precios || {};
  const ref = Number.isFinite(p.lista) ? p.lista : p.venta;
  const act = precioActual(a);
  if (Number.isFinite(ref) && Number.isFinite(act) && ref > act) return ref;
  const v = a.preciosVisibles || {};
  if (Number.isFinite(v.original) && Number.isFinite(act) && v.original > act) return v.original;
  return null;
}

function porcentajeDescuento(a) {
  if (Number.isFinite(a.precios && a.precios.descuentoPct)) return a.precios.descuentoPct;
  const lista = precioLista(a), act = precioActual(a);
  if (Number.isFinite(lista) && Number.isFinite(act) && lista > 0 && lista > act) {
    return Math.round((1 - act / lista) * 100);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------------

chrome.storage.local.get('deepExtraction', ({ deepExtraction }) => {
  if (!deepExtraction || !deepExtraction.data) {
    document.getElementById('origen').textContent = 'Sin extracción guardada';
    mostrarVacio(true);
    return;
  }
  estado.tabId = deepExtraction.tabId || null;
  aplicarDatos(deepExtraction.data);
});

function aplicarDatos(datos) {
  estado.datos = datos;
  pintarOrigen();
  pintarResumen();
  pintarDiagnostico();
  render();
}

function pintarOrigen() {
  const d = estado.datos;
  const partes = [];
  if (d.page && d.page.tipo) partes.push(d.page.tipo);
  if (d.page && d.page.url) partes.push(d.page.url);
  partes.push('extraído el ' + fecha(d.extractedAt));
  const nodo = document.getElementById('origen');
  nodo.textContent = partes.join(' · ');
  nodo.title = partes.join('\n');
}

function pintarResumen() {
  const d = estado.datos;
  const cont = document.getElementById('resumen');
  cont.textContent = '';

  const articulos = d.articles || [];
  const piezas = articulos.reduce((s, a) => s + (Number(a.cantidad) || 0), 0);

  let total = d.summary && d.summary.total ? d.summary.total : 0;
  if (!total) {
    total = articulos.reduce((s, a) => {
      const act = precioActual(a);
      return s + (Number.isFinite(act) ? act * (Number(a.cantidad) || 1) : 0);
    }, 0);
  }

  const campos = articulos.reduce((s, a) => s + (a.totalCampos || 0), 0);

  const tarjeta = (etiqueta, valor, pie) => el('dl', { clase: 'dato' }, [
    el('dt', { texto: etiqueta }),
    el('dd', {}, [document.createTextNode(valor), pie ? el('small', { texto: pie }) : null])
  ]);

  cont.appendChild(tarjeta('Artículos', String(articulos.length), articulos.length === 1 ? '1 ficha' : 'fichas distintas'));
  cont.appendChild(tarjeta('Piezas', String(piezas), 'unidades sumadas'));
  cont.appendChild(tarjeta('Valor', dinero(total), d.summary && d.summary.total ? 'total de la bolsa' : 'suma de los artículos'));
  cont.appendChild(tarjeta('Campos', String(campos), 'datos leídos del DOM'));
}

function pintarDiagnostico() {
  const d = estado.datos;
  const cuerpo = document.getElementById('diagnosticoCuerpo');
  cuerpo.textContent = '';

  const ETIQUETAS = {
    flightData: 'Datos internos de Next.js (flight data)',
    tarjetasBolsa: 'Tarjetas visibles de la bolsa',
    jsonLd: 'JSON-LD (schema.org)',
    nextData: '__NEXT_DATA__',
    metas: 'Etiquetas <meta>',
    microdatos: 'Microdatos itemprop',
    especificaciones: 'Tablas de ficha técnica'
  };

  const rejilla = el('div', { clase: 'fuentes' });
  for (const clave in (d.sources || {})) {
    const f = d.sources[clave];
    const detalles = [];
    if (Number.isFinite(f.articulos)) detalles.push(f.articulos + ' artículo(s)');
    if (Number.isFinite(f.caracteres)) detalles.push(f.caracteres.toLocaleString('es-MX') + ' caracteres');
    if (Number.isFinite(f.bloques)) detalles.push(f.bloques + ' bloque(s)');
    if (Number.isFinite(f.etiquetas)) detalles.push(f.etiquetas + ' etiqueta(s)');
    if (Number.isFinite(f.filas)) detalles.push(f.filas + ' fila(s)');

    rejilla.appendChild(el('div', { clase: 'fuente' }, [
      el('span', { clase: 'punto ' + (f.encontrado ? 'si' : 'no') }),
      el('span', {}, [
        el('strong', { texto: ETIQUETAS[clave] || clave }),
        document.createTextNode(detalles.length ? ' — ' + detalles.join(', ') : (f.encontrado ? ' — presente' : ' — no encontrado'))
      ])
    ]));
  }
  cuerpo.appendChild(rejilla);

  if (d.warnings && d.warnings.length) {
    const lista = el('ul', { clase: 'avisos' });
    d.warnings.forEach(w => lista.appendChild(el('li', { texto: w })));
    cuerpo.appendChild(lista);
  }
}

// ---------------------------------------------------------------------------
// Rejilla de artículos
// ---------------------------------------------------------------------------

function textoBuscable(a) {
  if (a._buscable) return a._buscable;
  const trozos = [a.nombre, a.nombreInterno, a.marca, a.skuVariante, a.skuGeneral, a.descripcion];
  (a.atributos || []).forEach(at => trozos.push(at.etiqueta, at.valor));
  if (a.vendedor) trozos.push(a.vendedor.nombre, a.vendedor.skuDelProveedor, a.vendedor.skuDelVendedor);
  a._buscable = trozos.filter(Boolean).join(' ').toLowerCase();
  return a._buscable;
}

function pasaFiltro(a) {
  if (estado.filtro === 'descuento') return Number.isFinite(porcentajeDescuento(a)) && porcentajeDescuento(a) > 0;
  if (estado.filtro === 'msi') return (a.planesPago || []).some(p => p.sinIntereses);
  if (estado.filtro === 'marketplace') return !!(a.vendedor && a.vendedor.esMarketplace);
  return true;
}

function ordenar(lista) {
  const copia = lista.slice();
  if (estado.orden === 'precio-desc') copia.sort((x, y) => (precioActual(y) || 0) - (precioActual(x) || 0));
  else if (estado.orden === 'precio-asc') copia.sort((x, y) => (precioActual(x) || 0) - (precioActual(y) || 0));
  else if (estado.orden === 'descuento') copia.sort((x, y) => (porcentajeDescuento(y) || 0) - (porcentajeDescuento(x) || 0));
  else if (estado.orden === 'nombre') copia.sort((x, y) => String(x.nombre || '').localeCompare(String(y.nombre || ''), 'es'));
  return copia;
}

function render() {
  const rejilla = document.getElementById('rejilla');
  rejilla.textContent = '';

  const todos = (estado.datos && estado.datos.articles) || [];
  const q = estado.busqueda.trim().toLowerCase();
  const filtrados = todos.filter(a => pasaFiltro(a) && (!q || textoBuscable(a).includes(q)));
  estado.visibles = ordenar(filtrados);

  document.getElementById('conteo').textContent = estado.visibles.length === todos.length
    ? `${todos.length} artículo(s)`
    : `${estado.visibles.length} de ${todos.length} artículo(s)`;

  mostrarVacio(todos.length === 0 || estado.visibles.length === 0, todos.length > 0);

  estado.visibles.forEach((a, i) => rejilla.appendChild(tarjetaArticulo(a, i)));
}

function mostrarVacio(mostrar, hayDatos) {
  const vacio = document.getElementById('vacio');
  vacio.hidden = !mostrar;
  if (mostrar && hayDatos) {
    document.getElementById('vacioTexto').textContent =
      'Ningún artículo coincide con la búsqueda o el filtro activo.';
  }
}

function tarjetaArticulo(a, indice) {
  const figura = el('div', { clase: 'articulo-figura' });
  if (a.imagenPrincipal) {
    figura.appendChild(el('img', { src: a.imagenPrincipal, alt: a.nombre || 'Artículo', loading: 'lazy' }));
  } else {
    figura.appendChild(el('span', { clase: 'sin-imagen', texto: 'Sin imagen' }));
  }

  const insignias = el('div', { clase: 'insignias' });
  const pct = porcentajeDescuento(a);
  if (a.esPrincipal) insignias.appendChild(el('span', { clase: 'insignia principal', texto: 'Artículo de la página' }));
  if (Number.isFinite(pct) && pct > 0) insignias.appendChild(el('span', { clase: 'insignia', texto: '-' + pct + '%' }));
  if (a.vendedor && a.vendedor.esMarketplace) insignias.appendChild(el('span', { clase: 'insignia neutra', texto: 'Marketplace' }));
  if (insignias.childNodes.length) figura.appendChild(insignias);

  const skus = el('div', { clase: 'skus' });
  if (a.skuVariante) skus.appendChild(el('span', { clase: 'sku-chip', title: 'SKU de la variante' }, [
    document.createTextNode('Variante '), el('b', { texto: a.skuVariante })]));
  if (a.skuGeneral && a.skuGeneral !== a.skuVariante) skus.appendChild(el('span', { clase: 'sku-chip', title: 'SKU general (producto padre)' }, [
    document.createTextNode('General '), el('b', { texto: a.skuGeneral })]));

  const act = precioActual(a);
  const lista = precioLista(a);
  const precio = el('div', { clase: 'precio-bloque' }, [
    el('span', { clase: 'precio-actual', texto: dinero(act, a.precios && a.precios.moneda) }),
    lista ? el('span', { clase: 'precio-lista', texto: dinero(lista) }) : null,
    Number.isFinite(pct) && pct > 0 ? el('span', { clase: 'precio-descuento', texto: 'Ahorras ' + dinero(lista - act) }) : null
  ]);

  const msi = (a.planesPago || []).filter(p => p.sinIntereses);
  const pie = el('div', { clase: 'articulo-pie' }, [
    el('span', { texto: 'Cantidad: ' + (a.cantidad || 1) }),
    el('span', { texto: msi.length ? 'Hasta ' + msi[msi.length - 1].meses + ' MSI' : (a.totalCampos ? a.totalCampos + ' campos' : '') })
  ]);

  const tarjeta = el('button', { clase: 'articulo', type: 'button', dataset: { indice: String(indice) } }, [
    figura,
    a.marca ? el('span', { clase: 'articulo-marca', texto: a.marca }) : null,
    el('span', { clase: 'articulo-nombre', texto: a.nombre || a.nombreInterno || '(sin nombre)' }),
    skus.childNodes.length ? skus : null,
    precio,
    pie
  ]);

  tarjeta.addEventListener('click', () => abrirPanel(a));
  return tarjeta;
}

// ---------------------------------------------------------------------------
// Panel de detalle
// ---------------------------------------------------------------------------

let articuloAbierto = null;

function abrirPanel(a) {
  articuloAbierto = a;

  document.getElementById('panelMarca').textContent = a.marca || (a.esPrincipal ? 'Artículo de la página' : 'Artículo');
  document.getElementById('panelTitulo').textContent = a.nombre || a.nombreInterno || a.skuVariante || 'Artículo';

  const cuerpo = document.getElementById('panelCuerpo');
  cuerpo.textContent = '';
  cuerpo.scrollTop = 0;
  seccionesDe(a).forEach(s => { if (s) cuerpo.appendChild(s); });

  const enlace = document.getElementById('btnAbrirFicha');
  if (a.urlFicha) { enlace.href = a.urlFicha; enlace.removeAttribute('aria-disabled'); enlace.style.display = ''; }
  else { enlace.removeAttribute('href'); enlace.style.display = 'none'; }

  document.getElementById('velo').hidden = false;
  document.getElementById('panel').hidden = false;
  document.getElementById('btnCerrar').focus();
}

function cerrarPanel() {
  document.getElementById('velo').hidden = true;
  document.getElementById('panel').hidden = true;
  articuloAbierto = null;
}

/** Sección con título y contenido; devuelve null si no hay nada que enseñar. */
function seccion(titulo, contenido) {
  if (!contenido) return null;
  return el('section', { clase: 'seccion' }, [el('h3', { texto: titulo }), contenido]);
}

/** Tabla de dos columnas a partir de una lista [etiqueta, valor]. */
function tablaCampos(filas) {
  const utiles = filas.filter(f => f && f[1] !== null && f[1] !== undefined && f[1] !== '' && f[1] !== '—');
  if (!utiles.length) return null;

  const cuerpo = el('tbody');
  utiles.forEach(([k, v, esNumero]) => {
    cuerpo.appendChild(el('tr', {}, [
      el('th', { scope: 'row', texto: k }),
      el('td', { clase: esNumero ? 'num' : null, texto: String(v) })
    ]));
  });
  return el('table', { clase: 'tabla-campos' }, [cuerpo]);
}

function seccionesDe(a) {
  const p = a.precios || {};
  const v = a.preciosVisibles || {};
  const vend = a.vendedor || {};
  const disp = a.disponibilidad || {};
  const clas = a.clasificacion || {};

  const secciones = [];

  // --- Identificadores ---
  secciones.push(seccion('Identificadores', tablaCampos([
    ['SKU de variante', a.skuVariante],
    ['SKU general (producto)', a.skuGeneral],
    ['SKU del proveedor', vend.skuDelProveedor],
    ['SKU del vendedor', vend.skuDelVendedor],
    ['Id de línea en la bolsa', a.idLinea],
    ['Slug en la URL', a.slug],
    ['GTIN', a.identificadoresExtra && a.identificadoresExtra.gtin],
    ['MPN', a.identificadoresExtra && a.identificadoresExtra.mpn],
    ['Nombre interno', a.nombreInterno],
    ['Enlace a la ficha', a.urlFicha]
  ])));

  // --- Precios ---
  const pct = porcentajeDescuento(a);
  const act = precioActual(a);
  const lista = precioLista(a);
  secciones.push(seccion('Precios', tablaCampos([
    ['Precio de lista', Number.isFinite(p.lista) ? dinero(p.lista, p.moneda) : null, true],
    ['Precio de venta', Number.isFinite(p.venta) && p.venta !== p.lista ? dinero(p.venta, p.moneda) : null, true],
    ['Precio actual (unitario)', Number.isFinite(act) ? dinero(act, p.moneda) : null, true],
    ['Descuento', Number.isFinite(pct) && pct > 0 ? pct + '%' : null, true],
    ['Ahorro por pieza', Number.isFinite(lista) && Number.isFinite(act) ? dinero(lista - act) : null, true],
    ['Cantidad', a.cantidad, true],
    ['Total de la línea', Number.isFinite(p.totalLinea) ? dinero(p.totalLinea, p.moneda) : null, true],
    ['Subtotal (lista × cantidad)', Number.isFinite(p.subtotal) ? dinero(p.subtotal, p.moneda) : null, true],
    ['Precio tachado en pantalla', Number.isFinite(v.original) ? dinero(v.original) : null, true],
    ['Precio mostrado en pantalla', Number.isFinite(v.conDescuento) ? dinero(v.conDescuento) : null, true],
    ['Total mostrado en pantalla', Number.isFinite(v.totalLinea) ? dinero(v.totalLinea) : null, true],
    ['Moneda', p.moneda]
  ])));

  // --- Meses sin intereses / pagos fijos ---
  if ((a.planesPago || []).length) {
    const lista2 = el('div', { clase: 'lista-planes' });
    a.planesPago.forEach(pl => {
      lista2.appendChild(el('div', { clase: 'plan' + (pl.sinIntereses ? ' sin-intereses' : ''), title: pl.descripcion || '' }, [
        el('b', { texto: dinero(pl.pagoMensual) }),
        document.createTextNode(pl.meses + (pl.sinIntereses ? ' meses sin intereses' : ' pagos fijos'))
      ]));
    });
    secciones.push(seccion('Planes de pago', lista2));
  }

  // --- Promociones ---
  if ((a.promociones || []).length) {
    const filas = a.promociones.map((pr, i) => [
      (pr.aplicada ? '★ ' : '') + (pr.tipo || 'promoción') + (pr.codigo ? ' · ' + pr.codigo : ''),
      pr.descripcion || (pr.descuentoPct ? pr.descuentoPct + '%' : '') || ('#' + (i + 1))
    ]);
    secciones.push(seccion('Promociones', tablaCampos(filas)));
  }

  // --- Atributos ---
  if ((a.atributos || []).length) {
    secciones.push(seccion('Atributos del artículo',
      tablaCampos(a.atributos.map(at => [at.etiqueta, typeof at.valor === 'boolean' ? siNo(at.valor) : at.valor]))));
  }

  // --- Clasificación ---
  secciones.push(seccion('Clasificación', tablaCampos([
    ['Departamento', clas.departamento],
    ['Grupo de material', clas.grupoMaterial],
    ['Tipo de producto', clas.tipoProducto],
    ['Categoría', clas.categoria],
    ['Canal de distribución', clas.canalDistribucion],
    ['Tipo de inventario', clas.tipoInventario]
  ])));

  // --- Vendedor ---
  secciones.push(seccion('Vendedor', tablaCampos([
    ['Es marketplace', vend.esMarketplace === undefined ? null : siNo(vend.esMarketplace)],
    ['Vendido por', vend.nombre],
    ['Id del vendedor / proveedor', vend.id]
  ])));

  // --- Disponibilidad ---
  secciones.push(seccion('Disponibilidad', tablaCampos([
    ['En existencia', disp.enStock === undefined ? null : siNo(disp.enStock)],
    ['Stock limitado', disp.stockLimitado === undefined ? null : siNo(disp.stockLimitado)],
    ['Entrega estimada', disp.entregaEstimada],
    ['Disponibilidad declarada', disp.disponibilidadDeclarada],
    ['Restricción de alcohol', disp.restriccionAlcohol === undefined ? null : siNo(disp.restriccionAlcohol)],
    ['Restricción de motocicletas', disp.restriccionMotocicletas === undefined ? null : siNo(disp.restriccionMotocicletas)]
  ])));

  // --- Descripción ---
  if (a.descripcion) {
    secciones.push(seccion('Descripción', el('p', { clase: 'nota', texto: a.descripcion })));
  }

  // --- Ficha técnica visible ---
  if ((a.especificaciones || []).length) {
    secciones.push(seccion('Ficha técnica', tablaCampos(a.especificaciones.map(e => [e.campo, e.valor]))));
  }

  // --- Imágenes ---
  if ((a.imagenes || []).length) {
    const galeria = el('div', { clase: 'galeria' });
    a.imagenes.forEach(im => {
      galeria.appendChild(el('a', { href: im.url, target: '_blank', rel: 'noopener', title: im.tipo + ' · ' + im.url }, [
        el('img', { src: im.url, alt: im.tipo, loading: 'lazy' })
      ]));
    });
    const bloque = el('div', {}, [
      galeria,
      el('p', { clase: 'nota', texto: a.imagenes.length + ' imagen(es). Clic para abrir en tamaño completo.' })
    ]);
    secciones.push(seccion('Imágenes', bloque));
  }

  // --- Fechas ---
  if (a.fechas && (a.fechas.agregado || a.fechas.modificado)) {
    secciones.push(seccion('Historial en la bolsa', tablaCampos([
      ['Agregado', fecha(a.fechas.agregado)],
      ['Última modificación', fecha(a.fechas.modificado)]
    ])));
  }

  // --- Todos los campos (aplanado) ---
  secciones.push(seccionTodosLosCampos(a));

  // --- JSON crudo ---
  const crudo = a.rawExtra ? { raw: a.raw, extra: a.rawExtra } : a.raw;
  if (crudo && Object.keys(crudo).length) {
    const detalle = el('details', {}, [
      el('summary', { clase: 'nota', texto: 'Ver JSON crudo del artículo' }),
      el('pre', { clase: 'json-crudo', texto: JSON.stringify(crudo, null, 2) })
    ]);
    secciones.push(seccion('Origen', detalle));
  }

  // --- Fuentes ---
  if ((a.fuentes || []).length) {
    secciones.push(seccion('De dónde salió', el('p', { clase: 'nota', texto: a.fuentes.join(' · ') })));
  }

  return secciones;
}

/**
 * Aplana el objeto crudo a pares ruta/valor. Es la red de seguridad del visor:
 * cualquier campo que Liverpool añada mañana aparece aquí sin tocar el código.
 */
function aplanar(obj, prefijo, salida, prof) {
  salida = salida || [];
  prof = prof || 0;
  if (salida.length > 1200 || prof > 10) return salida;

  if (obj === null || typeof obj !== 'object') {
    salida.push([prefijo, obj === null ? 'null' : String(obj)]);
    return salida;
  }

  if (Array.isArray(obj)) {
    if (!obj.length) { salida.push([prefijo, '[ ]']); return salida; }
    obj.slice(0, 60).forEach((x, i) => aplanar(x, prefijo + '[' + i + ']', salida, prof + 1));
    if (obj.length > 60) salida.push([prefijo + '[…]', '+' + (obj.length - 60) + ' elementos más']);
    return salida;
  }

  const claves = Object.keys(obj);
  if (!claves.length) { salida.push([prefijo, '{ }']); return salida; }
  claves.forEach(k => aplanar(obj[k], prefijo ? prefijo + '.' + k : k, salida, prof + 1));
  return salida;
}

function seccionTodosLosCampos(a) {
  const fuente = a.rawExtra ? Object.assign({}, a.raw, a.rawExtra) : a.raw;
  if (!fuente || !Object.keys(fuente).length) return null;

  const filas = aplanar(fuente, '', [], 0);
  if (!filas.length) return null;

  const buscador = el('input', {
    clase: 'buscador-campos', type: 'search',
    placeholder: 'Filtrar entre ' + filas.length + ' campos…', 'aria-label': 'Filtrar campos'
  });

  const cuerpo = el('tbody');
  const tabla = el('table', { clase: 'tabla-campos' }, [cuerpo]);

  const pintar = (q) => {
    cuerpo.textContent = '';
    const term = (q || '').toLowerCase();
    let mostradas = 0;
    for (const [ruta, valor] of filas) {
      if (term && !(ruta.toLowerCase().includes(term) || String(valor).toLowerCase().includes(term))) continue;
      if (mostradas >= 400) break;
      cuerpo.appendChild(el('tr', {}, [
        el('th', { scope: 'row' }, [el('code', { texto: ruta })]),
        el('td', { texto: valor.length > 300 ? valor.slice(0, 300) + '…' : valor })
      ]));
      mostradas++;
    }
    if (!mostradas) {
      cuerpo.appendChild(el('tr', {}, [el('td', { colspan: '2', clase: 'nota', texto: 'Ningún campo coincide.' })]));
    }
  };

  buscador.addEventListener('input', () => pintar(buscador.value));
  pintar('');

  const bloque = el('details', {}, [
    el('summary', { clase: 'nota', texto: 'Todos los campos (' + filas.length + ')' }),
    buscador,
    tabla
  ]);

  return seccion('Datos completos', bloque);
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------

function descargar(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function celdaCsv(v) {
  if (v === null || v === undefined) return '""';
  return '"' + String(v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
}

function exportarCsv() {
  const columnas = [
    ['SKU variante', a => a.skuVariante],
    ['SKU general', a => a.skuGeneral],
    ['Nombre', a => a.nombre],
    ['Marca', a => a.marca],
    ['Cantidad', a => a.cantidad],
    ['Precio lista', a => precioLista(a) || precioActual(a)],
    ['Precio actual', a => precioActual(a)],
    ['Descuento %', a => porcentajeDescuento(a)],
    ['Total línea', a => (a.precios && a.precios.totalLinea) || null],
    ['Color', a => valorAtributo(a, 'color')],
    ['Talla', a => valorAtributo(a, 'clothingSize') || valorAtributo(a, 'size')],
    ['Material', a => valorAtributo(a, 'material')],
    ['Dimensión', a => valorAtributo(a, 'dimension')],
    ['SKU proveedor', a => a.vendedor && a.vendedor.skuDelProveedor],
    ['Marketplace', a => a.vendedor && a.vendedor.esMarketplace ? 'Sí' : 'No'],
    ['Vendido por', a => a.vendedor && a.vendedor.nombre],
    ['Departamento', a => a.clasificacion && a.clasificacion.departamento],
    ['MSI máximo', a => {
      const msi = (a.planesPago || []).filter(p => p.sinIntereses);
      return msi.length ? msi[msi.length - 1].meses : null;
    }],
    ['Imagen', a => a.imagenPrincipal],
    ['URL ficha', a => a.urlFicha]
  ];

  const lineas = [columnas.map(c => celdaCsv(c[0])).join(',')];
  estado.visibles.forEach(a => lineas.push(columnas.map(c => celdaCsv(c[1](a))).join(',')));

  // El BOM hace que Excel abra los acentos bien de un doble clic.
  descargar('articulos-ventel-' + new Date().toISOString().slice(0, 10) + '.csv',
    '﻿' + lineas.join('\r\n'), 'text/csv;charset=utf-8');
  aviso('CSV descargado con ' + estado.visibles.length + ' artículo(s).');
}

function valorAtributo(a, clave) {
  const at = (a.atributos || []).find(x => x.clave === clave);
  return at ? at.valor : null;
}

// ---------------------------------------------------------------------------
// Acciones de la interfaz
// ---------------------------------------------------------------------------

document.getElementById('buscar').addEventListener('input', ev => {
  estado.busqueda = ev.target.value;
  render();
});

document.getElementById('orden').addEventListener('change', ev => {
  estado.orden = ev.target.value;
  render();
});

document.querySelectorAll('.chip[data-filtro]').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip[data-filtro]').forEach(c => c.classList.remove('activo'));
    chip.classList.add('activo');
    estado.filtro = chip.dataset.filtro;
    render();
  });
});

document.getElementById('btnCerrar').addEventListener('click', cerrarPanel);
document.getElementById('velo').addEventListener('click', cerrarPanel);
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && !document.getElementById('panel').hidden) cerrarPanel();
});

document.getElementById('btnCopiarFicha').addEventListener('click', () => {
  if (!articuloAbierto) return;
  navigator.clipboard.writeText(JSON.stringify(articuloAbierto, null, 2))
    .then(() => aviso('Ficha copiada al portapapeles.'))
    .catch(() => aviso('No se pudo copiar.'));
});

document.getElementById('btnJson').addEventListener('click', () => {
  if (!estado.datos) return;
  descargar('visor-ventel-' + new Date().toISOString().slice(0, 10) + '.json',
    JSON.stringify(estado.datos, null, 2), 'application/json');
  aviso('JSON completo descargado.');
});

document.getElementById('btnCsv').addEventListener('click', exportarCsv);

document.getElementById('btnActualizar').addEventListener('click', async () => {
  const boton = document.getElementById('btnActualizar');
  if (!estado.tabId) { aviso('No se sabe de qué pestaña salió esta extracción. Vuelve a abrir el visor desde la extensión.'); return; }

  boton.disabled = true;
  try {
    const resultados = await chrome.scripting.executeScript({
      target: { tabId: estado.tabId },
      func: deepExtractFromDOM
    });
    const datos = resultados && resultados[0] && resultados[0].result;
    if (!datos) throw new Error('la pestaña no devolvió datos');

    // Primero se pinta y luego se guarda: si el cupo de almacenamiento falla,
    // los datos frescos ya están en pantalla.
    aplicarDatos(datos);
    aviso('Datos actualizados desde la pestaña original.');
    try {
      await chrome.storage.local.set({ deepExtraction: { data: datos, tabId: estado.tabId, savedAt: Date.now() } });
    } catch (e) { /* no cabe: se muestran igual, solo no sobreviven al cierre */ }
  } catch (e) {
    aviso('No se pudo actualizar: ' + e.message + '. Vuelve a extraer desde el icono de la extensión.');
  }
  boton.disabled = false;
});
