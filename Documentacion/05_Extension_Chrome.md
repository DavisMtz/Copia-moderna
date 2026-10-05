# 05 · Extensión de Chrome «Ventel Extractor de Bolsa»

Extensión Manifest V3 que se instala en el navegador del asesor. Lee `liverpool.com.mx` y
deja los datos dentro del sistema de cotizaciones sin teclear nada.

**Versión declarada:** 3.0 (04/10/2026) · **Toda la extracción es local**: no manda nada a
ningún servidor propio.

> **Cómo leer este documento.** Las secciones 1 a 9 describen la extensión hasta la 1.7
> (agosto de 2026) y siguen valiendo para sus cinco funciones. Lo que vino después —la tarjeta
> «Vende más con este artículo», de la 2.6 a la 3.0— está en la **§10**, con el manifiesto
> actual y lo que cambió en seguridad.

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
  - **Matiz desde la 2.7:** «Vende más» sí *lee* por su cuenta páginas de `liverpool.com.mx`
    desde la ficha (la búsqueda del sitio y, desde la 3.0, la bolsa). Es lectura del mismo
    sitio con la misma sesión; no envía nada. Ver §10.
- **El puente no habla primero** (ver §3).
- **El enlace del artículo acaba en un `src` de iframe** dentro de la pantalla de revisión.
  Quien valida eso es el **servidor** (`REV_HOSTS_ARTICULO` en `Revision.gs`), comparando el
  host exacto. La extensión no es la última línea de defensa, y no debe serlo.
- El popup no pide credenciales ni las almacena. Lo único que guarda es la URL del sistema.

---

## 10. «Vende más con este artículo» (de la 2.6 a la 3.0)

Una tarjeta que la extensión pinta en cada ficha de Liverpool, debajo de «Agregar a mi bolsa».
Le dice al asesor qué más ofrecer en esa llamada, en tres bloques:

- **Venta incremental:** la misma ficha en más capacidad, o el modelo siguiente.
- **Venta cruzada:** hasta tres complementos que sí le quedan (uno por tipo), con su precio y,
  desde la 3.0, su calificación en Liverpool.
- **Promoción de hoy:** la de la categoría de la ficha y la más fuerte del Monitor.

El porqué de cada regla está en los documentos **17** (las reglas y el corpus) y **18** (la
investigación de la 3.0 y, en su «Estado», lo que se implementó y lo que se midió).

### 10.1 Las piezas

Son content scripts de `https://*.liverpool.com.mx/tienda/*`, en este orden. Viven en el mundo
aislado de la extensión: la página no los ve.

| Archivo | Qué hace |
| --- | --- |
| `product-inspector.js` | Lee la ficha (la misma función del Inspector de artículo). |
| `reglas-venta.js` | La base de reglas (v4): 68 clases de artículo y 349 tipos de complemento. Solo datos. |
| `recomendador-nucleo.js` | Todas las decisiones (2.0). Sin DOM ni `chrome.*`: se prueba en Node. |
| `lector-liverpool.js` | Lee del *flight data* lo que la tarjeta necesita: los carruseles con su calificación, los resultados de una búsqueda y los artículos de la bolsa. |
| `buscador-liverpool.js` | La búsqueda en el sitio, con sus límites y su caché. |
| `bolsa-liverpool.js` | La lectura de la bolsa, con sus límites y su caché. |
| `medicion-local.js` | Los contadores de la medición local. |
| `vendor/gsap.min.js` | GSAP 3.15.0, para la entrada de la tarjeta. |
| `recomendador.js` | Lo que toca la página: lee, pide, pinta y anota. |

Aparte: `fondo.js` y `campana-puente.js` traen las promociones del Portal; `medicion.html`
(con `medicion.js` y `medicion.css`) enseña la medición, y se abre desde el popup
(`popup-medicion.js`).

El manifiesto sigue pidiendo lo mismo que desde la 2.6: `activeTab`, `scripting` y `storage`, y
como sitios `liverpool.com.mx` y `script.google.com` (este último, para comprobar que las
promociones vienen del Portal). **La 3.0 no añadió ningún permiso.**

### 10.2 Lo nuevo de la 3.0

| Qué | Cómo se nota |
| --- | --- |
| **El mejor candidato, no el primero** | Entre los parecidos gana el que tiene respaldo de otros clientes, dentro de límites: los 5 primeros de Liverpool, sin costar un 25 % más y ganando por un cuarto de estrella. Lo que los clientes calificaron mal no se ofrece. La tarjeta enseña «★ 4.8 · 371 opiniones» o «Marketplace». |
| **La bolsa como contexto** | En la ficha de un accesorio, si el equipo se agregó a la bolsa en los últimos 90 minutos, la tarjeta recomienda para ese equipo («Para iPhone 16, que ya va en la bolsa»). Y lo que ya va en la bolsa no se vuelve a ofrecer. |
| **Doce categorías nuevas** | Muñecas, bloques, juegos de mesa, carros de control remoto, guitarras, casas de campaña, scooters, drones, ventiladores, lámparas, termos y computadoras de escritorio. |
| **Medición local** | Cuenta qué se mostró, qué se abrió y qué llegó a la bolsa. Solo en ese navegador (§10.4). |
| **Cuatro errores de la 2.9** | La mochila escolar ya no es maleta, el filtro de agua no es purificador, el cargador de laptop no es de celular y el adaptador del Pencil no es hub. |

### 10.3 Lo que lee de Liverpool por su cuenta

Hasta la 2.6 la extensión solo leía la página abierta. Ahora pide dos páginas más, **siempre al
mismo sitio, con la sesión del asesor y solo para leer**:

| Qué pide | Cuándo | Límites |
| --- | --- | --- |
| La búsqueda del sitio (`/tienda?s=…`), desde la 2.7 | Cuando a los carruseles de la ficha les falta un tipo de complemento | 2 por ficha, 4 por minuto, 40 por hora. Lo encontrado se guarda 24 horas. |
| La bolsa (`/tienda/cart`), desde la 3.0 | Solo si la cabecera dice que la bolsa tiene algo, y cuando esa cuenta cambia | 20 segundos entre lecturas, 12 por hora. Lo leído vale 15 minutos para esa sesión. |

- **Freno:** si Liverpool contesta con un error o con «Access Denied», se dejan de pedir las dos
  cosas durante 60 minutos.
- **Con la pestaña oculta no se pide nada.**
- **Interruptor:** la propiedad de script `VC_BUSQUEDA_EN_VIVO = no` del Portal apaga la búsqueda y
  la lectura de la bolsa para todos los asesores. Llega con las promociones.
- **Nunca agrega, quita ni cambia nada** en la bolsa ni en el sitio.

### 10.4 Lo que guarda, y dónde

Todo en `chrome.storage.local` de ese navegador. **Nada sale de ahí.**

| Clave | Qué guarda |
| --- | --- |
| `ventelPromos` | Las promociones que mandó el Portal. |
| `vmBusquedas` | Los resultados de las búsquedas (24 horas, hasta 200). |
| `vmBolsa` | De la bolsa, **solo los artículos**: identificador, SKU, nombre, marca, precio, cantidad, hora en que se agregó y si hay existencia. Ni el cliente, ni su dirección, ni su teléfono. Lleva una huella de la sesión para no usar la bolsa de un cliente con el siguiente. |
| `vmBusquedaPausa`, `vmBolsaRitmo` | El freno y la cuenta de lecturas. |
| `vmMedicion` | La medición local. |

**La medición local** cuenta, por día y por tipo de complemento:

1. cuántas recomendaciones se mostraron (a la vista y ya asentadas, no las que pasaron de largo);
2. cuántas se abrieron;
3. cuántas llegaron a la bolsa en los 60 minutos siguientes.

No guarda quién es el asesor ni quién es el cliente, y conserva 120 días. Se abre desde el
popup, con el botón **Medición de «Vende más»**: en esa página se **pausa**, se **borra** (pide
confirmar) y se copia el resumen. Empieza a contar sola en cualquier Chrome que cargue la 3.0.

### 10.5 Cómo se prueba

| Qué | Cómo |
| --- | --- |
| Las decisiones | `node pruebas/ext_recomendador.test.js` (481 comprobaciones, con fichas reales). |
| El lector, la bolsa y la medición | `ext_lector`, `ext_bolsa` y `ext_medicion` (`.test.js`). |
| Todo junto | `npm test`. |
| La extensión real en Chrome | `scripts/laboratorio/extension-e2e.mjs`: la carga en un Chrome aparte sobre páginas reales guardadas (21 comprobaciones). Liverpool bloquea a Chrome headless, por eso las páginas van guardadas. |
| Que las pruebas muerden | `Documentacion/anexos-18/implementacion-3.0/mutaciones.cjs`. |

**En vivo:** en la consola de una ficha, eligiendo el contexto de la extensión,
`__ventelVendeMas()` dice qué leyó, qué buscó, qué supo de la bolsa y qué decidió.

**Después de cambiar algo, recargar la extensión no basta:** las pestañas de Liverpool ya
abiertas siguen con el código anterior hasta que se recargan.

### 10.6 Qué se rompe si Liverpool cambia

| Qué cambia | Qué deja de funcionar | Dónde mirar |
| --- | --- | --- |
| El título de los carruseles («…Complementa con») | La venta cruzada desde los carruseles | `carruselesDe` en `lector-liverpool.js` |
| Los `records` de la búsqueda | La calificación de lo buscado (la búsqueda sigue, sin ella) | `registrosDe` |
| Los `lineItems` de la bolsa | La bolsa como contexto y el «en bolsa» de la medición | `bolsaDe` |
| La insignia de la bolsa en la cabecera | Lo mismo: sin cuenta, no se lee la bolsa | `cuentaDeBolsa` en `recomendador.js` |

En todos los casos la tarjeta se queda como en la 2.9: no falla, pierde lo nuevo.

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
