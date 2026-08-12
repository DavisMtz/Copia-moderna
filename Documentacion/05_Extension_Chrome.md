# Extensión de Chrome — Documentación Total y Exhaustiva (15 Archivos)

> **DOCUMENTACIÓN TÉCNICA Y DIDÁCTICA DE ARQUITECTURA Y MANTENIMIENTO**
> **Sistema Integral Portal Ventel & Extensión Chrome**
> **Autor:** David Martínez (`dmartineza02@liverpool.com.mx`)

---

## 🔌 Cobertura Total de la Extensión de Chrome (v1.7)

Este documento detalla la totalidad de los **15 archivos y recursos** que integran la extensión **Ventel Extractor de Bolsa**.

---

### 📄 1. Manifiesto y Scripts Principales

#### `manifest.json` (Manifiesto de Configuración V3)
Establece `manifest_version: 3`, permisos (`activeTab`, `scripting`, `storage`), host permissions (`*://*.liverpool.com.mx/*`) e inyección automática del content script `bridge.js` en `https://*.googleusercontent.com/*` a nivel `document_start`.

#### `bridge.js` (Puente de Mensajes Asíncronos)
Script inyectado en el dominio de Apps Script. Escucha peticiones `window.postMessage` desde el formulario de cotización. Entrega los productos guardados en `chrome.storage.local` bajo la clave `bolsaParaCotizar` si el sello de tiempo no supera los 15 minutos (`VIGENCIA_MS = 900000`), y los elimina tras recibir la confirmación de importación.

#### `deep-extractor.js` (Motor de Extracción Profunda — 29 Funciones)
Inyectado en la pestaña activa de Liverpool.
- **Mecánica:** Desensambla el stream `self.__next_f.push` de Next.js App Router mediante la función `cosecharFlight()`.
- **Parsing:** Extrae sub-JSONs con un parser basado en pila (`objetosConPintaDeArticulo`), recolecta etiquetas JSON-LD (`cosecharJsonLd`), microdatos (`cosecharMicrodatos`), especificaciones (`cosecharEspecificaciones`) y resumen del carrito (`cosecharResumen`).
- **Normalización:** Mapea las propiedades crudas al esquema unificado Ventel (SKU, descripción, precio unitario base, costo pago único, porcentaje de descuento público, promociones de MSI y galería completa de imágenes).

#### `product-inspector.js` (Motor de Inspección PDP — 9 Funciones)
Inyectado en fichas individuales de producto (PDP).
- **Mecánica:** Extrae título, marca, SKU del producto principal, variante activa, tabla de variantes (colores/tallas con stock), opciones de financiamiento, vendedor marketplace y ruta de migas de pan (breadcrumbs).

#### `purchase-extractor.js` (Extractor de Confirmaciones de Compra — 25 Funciones)
Inyectado en la pantalla "¡Gracias por comprar!".
- **Mecánica:** Extrae el folio de orden, lista de artículos comprados por paquete de entrega, dirección de envío, método de pago y datos del cliente.
- **Formateo:** La función `formatearCompra(datos)` redacta un resumen en texto plano limpio listo para copiarse al portapapeles o descargarse como archivo `.txt`.

---

### 💻 2. Interfaces Gráficas y Visores

#### `popup.html` / `popup.js` (Interfaz del Popup — 14 Funciones)
Interfaz principal de 380px de ancho.
- **Botones:** "Cotizar" (extrae la bolsa y abre el portal), "Extraer Artículos de Bolsa", "Abrir visor avanzado", "Inspeccionar artículo" y "Copiar datos de la compra".
- **Configuración:** Permite guardar la URL base personalizada de la aplicación WebApp (`cotizadorUrl`).

#### `inspector.html` / `inspector-ui.js` / `inspector.css` (Inspector PDP — 26 Funciones)
Pestaña independiente que muestra el análisis detallado de un producto.
- **Secciones:** Hero gallery, selector de colores/tallas, tabla de variantes con indicadores de stock, planes de pago, promociones, especificaciones técnicas, metadatos y visor de JSON crudo colapsable. Permite re-inspeccionar la página en tiempo real y exportar un archivo `.json`.

#### `viewer.html` / `viewer.js` / `viewer.css` (Visor Avanzado de Bolsa — 29 Funciones)
Pestaña independiente para inspección y filtrado avanzado de carritos grandes.
- **Características:** Cuadrícula de tarjetas de producto, barra de búsqueda en tiempo real (`#buscar`), filtros por chip (descuento, MSI, marketplace), ordenamiento por precio/descuento, panel lateral desplegable con el detalle completo del artículo, tabla de campos aplanados (`aplanar()`) y exportación a archivos `.json` o `.csv` (con BOM UTF-8).

---

### 📂 3. Recurso de Pruebas Offline

#### `Mi Bolsa.html` / `Mi Bolsa_files` & `Captura de pantalla.png`
Archivo HTML guardado offline de una bolsa de compras real de Liverpool México. Utilizado como benchmark de pruebas para validar el funcionamiento del extractor `deep-extractor.js` sin necesidad de conexión a internet o cuando el sitio de Liverpool está en mantenimiento.

---

## ✍️ Firma de Responsabilidad Técnica

**David Martínez**  
*Escritor y Arquitecto Principal del Sistema*  
Correo Institucional: `dmartineza02@liverpool.com.mx`  
El Puerto de Liverpool · Equipo Ventel  
*Agosto de 2026*
