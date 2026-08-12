# Extensión de Chrome — Referencia Técnica Detallada (v1.7)

> **DOCUMENTACIÓN TÉCNICA OFICIAL DE ARQUITECTURA Y MANTENIMIENTO**
> **Sistema Integral Portal Ventel & Extensión Chrome**
> **Autor:** David Martínez (`dmartineza02@liverpool.com.mx`)

---

## 🔌 Estructura del Proyecto de Extensión (Manifest V3)

La extensión **Ventel Extractor de Bolsa** comprende **13 archivos fuente** que implementan la inyección de scripts, la desestructuración de streams de datos, el puente de mensajes asíncronos y dos visores avanzados independientes.

---

## 🛠️ Catálogo Completo de Archivos y Funciones

### 📄 1. `manifest.json` — Manifiesto de Configuración V3
```json
{
  "manifest_version": 3,
  "name": "Ventel Extractor de Bolsa",
  "version": "1.7",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["*://*.liverpool.com.mx/*"],
  "content_scripts": [{
    "matches": ["https://*.googleusercontent.com/*"],
    "js": ["bridge.js"],
    "all_frames": true,
    "run_at": "document_start"
  }],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Extraer Bolsa Ventel"
  }
}
```

---

### 📄 2. `bridge.js` — Content Script Puente en Google Apps Script
Inyectado a nivel `document_start` en `https://*.googleusercontent.com/*`.
- **Constantes:** `CLAVE = 'bolsaParaCotizar'`, `VIGENCIA_MS = 900000` (15 minutos).
- **`responder(evento, mensaje)`:** `(evento: MessageEvent, mensaje: Object) -> void`. Envía respuesta mediante `evento.source.postMessage` con `source: 'ventel-extension'`.
- **`entregar(evento)`:** `(evento: MessageEvent) -> void`. Lee `bolsaParaCotizar` de `chrome.storage.local`, valida el sello de tiempo (15 min) y responde `VENTEL_BOLSA_ENTREGA` o `VENTEL_BOLSA_VACIA`.
- **`olvidar()`:** `() -> void`. Elimina `CLAVE` de `chrome.storage.local` tras recibir la confirmación `VENTEL_BOLSA_IMPORTADA` de la WebApp.
- **Contrato de Mensajes Window `postMessage`:**
  - Peticiones Inbound (`source: 'ventel-cotizador'`): `VENTEL_BOLSA_PIDE`, `VENTEL_BOLSA_IMPORTADA`.
  - Respuestas Outbound (`source: 'ventel-extension'`): `VENTEL_BOLSA_ENTREGA` (con payload), `VENTEL_BOLSA_VACIA`.

---

### 📄 3. `deep-extractor.js` — Motor de Extracción Profunda (29 Funciones)
Función Principal Exportada: `deepExtractFromDOM()`. Inyectada en la pestaña activa de `liverpool.com.mx`.

| Función Interna | Retorno | Descripción |
| :--- | :--- | :--- |
| `finDeCadena(texto, inicio)` | `number` | Encuentra el índice de comilla doble de cierre respetando barras de escape. |
| `esTextoUtil(v)` | `boolean` | Retorna `true` si la variable es una cadena no vacía. |
| `numeroODefecto(v)` | `number\|null` | Convierte la entrada a número finito o `null`. |
| `limpio(t)` | `string` | Elimina espacios duplicados y caracteres extremos. |
| `precioDeTexto(texto)` | `number\|null` | Parsea cadenas monetarias (ej. "$29,999.10" -> 29999.10). |
| `precioDeNodo(nodo)` | `number\|null` | Parsea el precio de un contenedor DOM ignorando spans `.invisible`. |
| `dinero(v)` | `number\|null` | Normaliza objetos de dinero commercetools o montos numéricos a Pesos MXN. |
| `cosecharFlight()` | `string` | Reconstruye el stream `self.__next_f.push` concatenando fragmentos de script. |
| `objetosConPintaDeArticulo(texto)` | `Array<string>` | Parser basado en pila que extrae sub-JSONs que contengan claves de producto. |
| `parsearArticulos(fragmentos)` | `Array<Object>` | Parsea arreglos de cadenas a objetos JSON nativos. |
| `cosecharJsonLd()` | `Array<Object>` | Parsea etiquetas `<script type="application/ld+json">`. |
| `cosecharNextData()` | `Object\|null` | Parsea el contenido de la etiqueta `#__NEXT_DATA__`. |
| `buscarProductosEnObjeto(raiz, lim)`| `Array<Object>` | Búsqueda BFS en grafo de objetos por nodos `@type: "Product"`. |
| `cosecharMetas()` | `Object` | Extrae etiquetas `<meta>` y enlace canónico `link[rel="canonical"]`. |
| `cosecharMicrodatos()` | `Array<Object>` | Recolecta atributos `[itemprop]` de la estructura HTML. |
| `cosecharEspecificaciones()` | `Object` | Extrae especificaciones técnicas de tablas `<table>` y listas `<dl>`. |
| `cosecharTarjetasBolsa()` | `Array<Object>` | Scraping de tarjetas de producto en el carrito (`[data-testid^="ml-card-product-mybag-"]`). |
| `resolverUrlFicha(enlace)` | `string` | Construye la URL absoluta de la ficha en el dominio de Liverpool. |
| `cosecharResumen()` | `Object` | Lee el resumen financiero del carrito (Subtotal, Descuento, Total). |
| `normalizar(crudo, origen)` | `Object` | Normaliza un objeto crudo extraído al esquema de artículo unificado Ventel. |
| `quitarVacios(obj)` | `Object` | Limpia propiedades nulas o vacías de un objeto. |
| `atributosLegibles(attrs)` | `Object` | Mapea claves técnicas de atributos a etiquetas legibles en español. |
| `planesDePago(crudo)` | `Array<Object>` | Extrae opciones de financiamiento y meses sin intereses (MSI). |
| `promociones(crudo)` | `Array<Object>` | Extrae promociones y descuentos aplicados. |
| `imagenesDe(crudo)` | `Array<string>` | Recolecta la galería completa de imágenes en alta resolución. |
| `fundir(base, extra)` | `Object` | Fusiona objetos de producto duplicados sin sobrescribir datos existentes. |
| `registrar(ficha)` | `void` | Registro y deduplicación en el catálogo final de extracción. |
| `contarCampos(obj, prof)` | `number` | Calcula recursivamente la profundidad y conteo de campos para métricas. |

---

### 📄 4. `product-inspector.js` — Motor de Inspección PDP (9 Funciones)
Función Principal Exportada: `inspectProductFromDOM()`. Inyectada en fichas de producto.
- **Funciones:** `addWarning(msg)`, `qs(selector, parent)`, `qsa(selector, parent)`, `getText(el)`, `getAttr(el, attr)`, `parsePrice(str)`, `parsePriceFromNode(nodo)`, `finDeCadena(str, inicio)`.

---

### 📄 5. `purchase-extractor.js` — Extractor de Compras (25 Funciones)
Funciones Principales Exportadas: `extractPurchaseFromDOM()` e `formatearCompra(datos)`. Inyectadas en la pantalla "¡Gracias por comprar!".
- **Funciones de Extracción:** `cosecharFlight()`, `recortarObjeto()`, `cosecharCarrito()`, `cosecharFolio()`, `cosecharSecciones()`, `cosecharTarjetaEntrega()`, `cosecharTarjetaPago()`, `cosecharCliente()`, `planDe()`, `articuloDe()`, `direccionDe()`.
- **Funciones de Formato:** `capitalizar()`, `telefono()`, `fechaLarga()`, `textoPlan()`.

---

### 📄 6. `popup.js` — Controlador del Popup (14 Funciones)
Orquesta las inyecciones desde la interfaz del popup de la extensión.
- **Funciones:** `showStatus()`, `formatMoney()`, `renderResult()`, `saveLastExtraction()`, `restoreLastExtraction()`, `extractBagFromDOM()`, `extraerDeLaPestanaActiva()`, `normalizarUrlCotizador()`, `leerUrlCotizador()`, `alternarConfig()`, `precargarConfig()`, `guardarParaElVisor()`, `renderCompra()`, `restoreBtnHTML()`.

---

### 📄 7. `inspector-ui.js` — Controlador UI del Inspector PDP (26 Funciones)
Controla la vista independiente de inspección de producto (`inspector.html`).
- **Funciones:** `el()`, `dinero()`, `aviso()`, `vaciar()`, `init()`, `cargarDatos()`, `mostrarError()`, `renderAll()`, `renderHeader()`, `renderHero()`, `renderColors()`, `renderSizes()`, `renderVariants()`, `renderPaymentPlans()`, `renderPromotions()`, `renderSpecifications()`, `renderDescription()`, `renderCategory()`, `renderRating()`, `renderFullGallery()`, `renderMeta()`, `renderRawData()`, `renderWarnings()`, `configurarBotones()`, `actualizarDatos()`, `exportarJSON()`.

---

### 📄 8. `viewer.js` — Controlador UI del Visor Avanzado (29 Funciones)
Controla la vista independiente del visor de bolsa (`viewer.html`).
- **Funciones:** `el()`, `dinero()`, `fecha()`, `siNo()`, `aviso()`, `precioActual()`, `precioLista()`, `porcentajeDescuento()`, `aplicarDatos()`, `pintarOrigen()`, `pintarResumen()`, `pintarDiagnostico()`, `textoBuscable()`, `pasaFiltro()`, `ordenar()`, `render()`, `mostrarVacio()`, `tarjetaArticulo()`, `abrirPanel()`, `cerrarPanel()`, `seccion()`, `tablaCampos()`, `seccionesDe()`, `aplanar()`, `seccionTodosLosCampos()`, `descargar()`, `celdaCsv()`, `exportarCsv()`, `valorAtributo()`.

---

## ✍️ Firma de Responsabilidad Técnica

**David Martínez**  
*Escritor y Arquitecto Principal del Sistema*  
Correo Institucional: `dmartineza02@liverpool.com.mx`  
El Puerto de Liverpool · Equipo Ventel  
*Agosto de 2026*
