# 05 · Extensión de Chrome «Ventel Extractor de Bolsa»

Extensión Manifest V3 que se instala en el navegador del asesor. Lee `liverpool.com.mx` y
deja los datos dentro del sistema de cotizaciones sin teclear nada.

**Versión declarada:** 1.7 · **Toda la extracción es local**: no manda nada a ningún
servidor propio.

---

## 1. Qué hace, en cuatro funciones

| Función | Botón del popup | Archivo que la implementa |
| --- | --- | --- |
| **Cotizar** — extrae la bolsa y abre una cotización nueva con los artículos ya cargados | `btnCotizar` | `popup.js` + `bridge.js` |
| **Extraer bolsa** — el mismo JSON, para copiar o descargar | `btnExtract` | `popup.js` |
| **Visor avanzado** — todos los campos de cada artículo, incluidos los que la tienda no enseña | `btnViewer` | `deep-extractor.js` + `viewer.js` |
| **Inspector de artículo** — toda la información visible y oculta de una ficha (PDP) | `btnInspector` | `product-inspector.js` + `inspector-ui.js` |
| **Copiar datos de la compra** — resumen de la venta cerrada, listo para pegar | `btnCompra` | `purchase-extractor.js` |

---

## 2. Manifiesto

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
  "action": { "default_popup": "popup.html" }
}
```

**Qué significa cada permiso, y por qué es el mínimo:**

| Permiso | Para qué | Por qué no es más |
| --- | --- | --- |
| `activeTab` | Actuar sobre la pestaña que el usuario tiene delante | No pide acceso permanente a todas las pestañas |
| `scripting` | Inyectar los extractores con `chrome.scripting.executeScript` | Es la API de MV3; sustituye a los content scripts permanentes |
| `storage` | Pasar la bolsa al sistema por `chrome.storage.local` | Ver §3 |
| `host_permissions: liverpool.com.mx` | Leer las páginas de la tienda | Acotado a un solo dominio |
| `content_scripts: googleusercontent.com` | Solo `bridge.js`, para hablar con la webapp | Es el origen desde el que Apps Script sirve el iframe |

> **`all_frames: true` y `run_at: document_start` son necesarios**: la pantalla de Apps
> Script vive dentro de un iframe anidado, y el puente tiene que estar escuchando antes de
> que la pantalla pregunte.

---

## 3. El puente (`bridge.js`) — cómo llega la bolsa a la cotización

**Por qué no se usa el portapapeles ni la URL:** el JSON de una bolsa con imágenes y enlaces
a fichas pasa de sobra el largo seguro de una URL, y el portapapeles dentro del iframe de
Apps Script depende de un permiso que el navegador no siempre concede. La bolsa viaja por
`chrome.storage.local`: **sobrevive al desvío por el inicio de sesión** y no tiene límite
práctico de tamaño.

**Protocolo, en tres mensajes:**

```
1. cotizacion.html  →  { source: 'ventel-cotizador',  type: 'VENTEL_BOLSA_PIDE' }
                       «Estoy lista, ¿hay algo para mí?»

2. bridge.js        →  { source: 'ventel-extension',  type: 'VENTEL_BOLSA_ENTREGA', payload }
                    o  { source: 'ventel-extension',  type: 'VENTEL_BOLSA_VACIA' }
                       (VACIA existe para que la pantalla DEJE de preguntar)

3. cotizacion.html  →  { source: 'ventel-cotizador',  type: 'VENTEL_BOLSA_IMPORTADA' }
                       → el puente BORRA la bolsa del almacenamiento
```

**Dos reglas del protocolo que hay que conservar si lo tocas:**

- **El puente nunca habla primero.** Se inyecta en todo `*.googleusercontent.com`, un origen
  compartido por muchas webapps de Apps Script. Hablar sin que le pregunten sería anunciar
  la bolsa a cualquier script alojado ahí.
- **Una bolsa se cotiza una vez.** Se borra al confirmarse la importación. Sin eso, abrir una
  cotización nueva al día siguiente reviviría la bolsa de ayer.

La URL del sistema se guarda en `chrome.storage.local` bajo la clave `cotizadorUrl` y se
configura desde el propio popup (botón «Guardar enlace»). **Es lo primero que hay que
revisar cuando el botón «Cotizar» no lleva a ningún sitio**: si se redesplegó la webapp, la
URL cambió.

---

## 4. De dónde salen los datos

Liverpool es una aplicación de Next.js. La información **no** está solo en lo que se ve: el
propio HTML trae el objeto completo de cada artículo en el *flight data*
(`self.__next_f.push([...])`). Ahí están el SKU de variante, el SKU general, el precio de
lista, los MSI, el proveedor y todas las imágenes.

Los extractores funden **cuatro fuentes**, en este orden de fiabilidad:

| Fuente | Qué aporta | Fragilidad |
| --- | --- | --- |
| **Flight data** (`self.__next_f.push`) | Lo más completo: SKUs, precios de lista, MSI, proveedor | Alta: cambia con cada despliegue de Liverpool |
| **JSON-LD** (`<script type="application/ld+json">`) | Datos estructurados de producto | Media |
| **Etiquetas `<meta>`** | Título, imagen, precio | Baja |
| **DOM visible** | Lo que el asesor está viendo | Media: depende de clases CSS |

> **Principio del módulo: no se inventan datos.** Lo que no aparece en la página, no aparece
> en la ficha. Si un campo llega vacío, es porque Liverpool no lo publicó — no lo rellenes
> con un valor por defecto.

---

## 5. Los archivos

| Archivo | Líneas | Qué es |
| --- | --- | --- |
| `manifest.json` | — | Manifiesto MV3 |
| `popup.html` / `popup.js` | 561 / 899 | Interfaz de la extensión y orquestación de las cuatro funciones |
| `bridge.js` | 102 | Puente con la webapp. **Único content script permanente** |
| `deep-extractor.js` | 1 011 | `deepExtractFromDOM()` — extracción profunda de la bolsa |
| `product-inspector.js` | 647 | `inspectProductFromDOM()` — ficha de producto completa |
| `purchase-extractor.js` | 843 | `extractPurchaseFromDOM()` + `formatearCompra()` |
| `viewer.html` / `viewer.js` / `viewer.css` | 103 / 722 / 542 | Visor avanzado |
| `inspector.html` / `inspector-ui.js` / `inspector.css` | 138 / 650 / 395 | Inspector de artículo |
| `Mi Bolsa.html` + `Mi Bolsa_files/` | 763 | **Banco de pruebas**: captura de una página real |
| `Captura de pantalla.png` | — | Referencia visual |

### La regla que rompe más gente

> **Las funciones que se inyectan tienen que ser AUTOCONTENIDAS.**

`deepExtractFromDOM`, `inspectProductFromDOM` y `extractPurchaseFromDOM` viajan a la página
con `chrome.scripting.executeScript({ func: ... })`. **Se serializa solo la función**: todos
sus ayudantes tienen que estar dentro. Si sacas un helper fuera «para reutilizarlo», deja de
existir en el momento en que el código llega a la página, y el fallo se ve como «la
extracción no devuelve nada», no como un error de referencia.

Por eso `purchase-extractor.js` separa a propósito dos funciones que no viven en el mismo
mundo: `extractPurchaseFromDOM()` (se inyecta, solo lee) y `formatearCompra(datos)` (corre
en el popup, solo redacta). Cambiar la redacción no obliga a tocar la lectura, y al revés.

---

## 6. Cómo instalarla

1. Descargar y descomprimir la carpeta.
2. Abrir `chrome://extensions`.
3. Activar **Modo de desarrollador** (arriba a la derecha).
4. **Cargar descomprimida** → seleccionar la carpeta `Extencion para chrome`.
5. Fijar el icono en la barra.
6. Abrir el popup → «Guardar enlace» → pegar la URL `/exec` de la webapp.

Dentro del sistema, la pantalla `app_extension_guia.html` enseña estos pasos con maquetas y
el puntero haciendo el clic que toca. Se hizo así porque instalar una extensión sin
empaquetar tiene seis pasos y ninguno es adivinable.

---

## 7. Cómo probarla sin navegar a Liverpool

`Mi Bolsa.html` + `Mi Bolsa_files/` son **una captura completa de una página real** de la
bolsa de compras, guardada con «Página completa». Sirve para probar el extractor sin
depender de que la tienda esté arriba ni de tener una bolsa con artículos.

> **Limitación conocida y ya sufrida:** la extensión **no puede actuar sobre `file://`** —
> `host_permissions` está acotado a `liverpool.com.mx`. Para probar contra la captura hay que
> servirla por HTTP (un servidor estático local) o pegar el cuerpo del extractor en la
> consola de DevTools sobre esa página. Este detalle está anotado también en la memoria del
> proyecto porque el fallo se manifiesta en silencio: la extensión simplemente no hace nada.

---

## 8. Mantenimiento: qué se rompe y cuándo

La extensión depende de la estructura de una web de terceros. **Se va a romper**, y no será
culpa del código. Orden de fragilidad, de más a menos:

| Qué cambia en Liverpool | Qué deja de funcionar | Dónde mirar |
| --- | --- | --- |
| Formato del *flight data* | Casi todo: SKUs, precios de lista, MSI | `deep-extractor.js`, `product-inspector.js` |
| Clases CSS de la bolsa | Extracción de artículos visibles | `deep-extractor.js` |
| Pantalla de «¡Gracias por comprar!» | Copiar datos de la compra | `purchase-extractor.js` |
| Estructura del JSON-LD | Datos de respaldo | Los tres extractores |
| Subdominios de imágenes | Imágenes en la cotización | `IMG_SUBDOMINIOS` en `Correos.gs` *(servidor)* |

**Rutina de diagnóstico cuando deja de extraer:**

1. Abrir la bolsa en Liverpool, F12 → Consola.
2. Pulsar «Extraer bolsa» y leer los avisos: los extractores acumulan `warnings` y los
   imprimen con el prefijo `Ventel Extractor:`.
3. En la consola, buscar `self.__next_f` en el HTML de la página. Si ya no existe o cambió
   de forma, ese es el fallo.
4. Comparar con `Mi Bolsa.html`, que conserva la estructura que funcionaba.

**Al arreglarlo:** sube el número de versión en `manifest.json` y anótalo en la cabecera del
archivo que tocaste — los archivos de esta extensión llevan su propio historial de versiones
en el comentario de cabecera, y es lo que permite saber qué cambió y cuándo.

---

## 9. Seguridad

- **Nada sale hacia fuera.** No hay `fetch` a servidores propios. La extracción es local y el
  único destino de los datos es la webapp del propio sistema, por `chrome.storage.local`.
- **El puente no habla primero** (ver §3).
- **El enlace del artículo acaba en un `src` de iframe** dentro de la pantalla de revisión.
  Quien valida eso es el **servidor** (`REV_HOSTS_ARTICULO` en `Revision.gs`), comparando el
  host exacto. La extensión no es la última línea de defensa, y no debe serlo.
- El popup no pide credenciales ni las almacena. Lo único que guarda es la URL del sistema.

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
