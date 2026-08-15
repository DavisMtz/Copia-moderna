# 01 · Arquitectura general

Cómo encajan las piezas y por qué están así. Léelo antes de tocar código: casi todos los
errores caros de este proyecto vinieron de cambiar algo sin saber quién más dependía de ello.

---

## 1. El modelo mental correcto

Portal Ventel **no es** una aplicación cliente-servidor normal. Es un **monolito sin
servidor** hospedado en Google Apps Script, con estas consecuencias que condicionan todo:

- **No hay base de datos.** Hay Google Sheets. Las lecturas son caras, las escrituras son
  caras y lentas, y **hay personas ajenas al código editando las mismas pestañas a mano**.
  Por eso todo el sistema localiza columnas por nombre y no por posición.
- **No hay sesión de servidor.** Apps Script no da cookies ni tokens propios. La sesión
  vive en `localStorage` del navegador, y el servidor **vuelve a resolver la identidad en
  cada llamada** contra la hoja `Registros`. Esto no es un descuido: está documentado y
  asumido en `Seguridad.gs`.
- **Cada pantalla es una carga completa.** No hay SPA ni router de cliente. Navegar de una
  pantalla a otra es una petición `doGet` nueva y una evaluación de plantilla completa. De
  ahí la obsesión del proyecto con la caché: cada carga que se ahorra es medio segundo real
  para el asesor con un cliente al teléfono.
- **Hay cuotas.** Tiempo de ejecución, envíos de correo, llamadas `UrlFetch`. Un bucle que
  lee una hoja dentro de otro bucle no es «poco elegante»: se come la cuota del día.

---

## 2. Las tres capas y sus fronteras

```
┌──────────────────────────────────────────────────────────────────────────┐
│  NAVEGADOR DEL ASESOR                                                    │
│                                                                          │
│  ┌────────────────────────┐        ┌──────────────────────────────────┐  │
│  │ Extensión de Chrome    │        │ Pantalla servida por Apps Script │  │
│  │ (Manifest V3)          │        │ (iframe *.googleusercontent.com) │  │
│  │                        │        │                                  │  │
│  │ popup.js               │        │ app_core.html  → AppUrl/AppRun/  │  │
│  │ deep-extractor.js      │        │                  AppCache        │  │
│  │ product-inspector.js   │        │ app_shell.html → marco común     │  │
│  │ purchase-extractor.js  │        │ app_*.html     → 20 módulos      │  │
│  │                        │        │ <pantalla>.html                  │  │
│  │        bridge.js  ──── postMessage ───→  cotizacion.html            │  │
│  └────────────────────────┘        └──────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                │ chrome.storage.local              │ google.script.run
                │ (la bolsa extraída)               │ (todas las llamadas)
                ▼                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  GOOGLE APPS SCRIPT (V8) · 24 archivos .gs                               │
│                                                                          │
│   Code.gs ──── doGet() ──── enrutador (PAGES / PORTAL_PAGES)             │
│      │                                                                   │
│      ├── Seguridad.gs ── identidad ── Permisos.gs ── bloques y roles     │
│      ├── Cache.gs ────── CacheService con generación                     │
│      └── módulos de dominio (cotizaciones, portal, operación, …)         │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  GOOGLE WORKSPACE                                                        │
│  Sheets (3 libros) · Drive (PDF, imágenes, evidencias) · Gmail ·         │
│  Calendar (calendario comercial) · Chat (webhooks) · UrlFetch (liverpool)│
└──────────────────────────────────────────────────────────────────────────┘
```

**La frontera que importa:** todo lo que está en el navegador es **sugerencia**. Todo lo que
está en `.gs` es **decisión**. Un menú que esconde un botón no protege nada; el gate del
servidor sí.

---

## 3. El ciclo de una petición

Qué pasa exactamente cuando alguien abre `…/exec?page=cotizacion&folio=LVP-0042`.

1. **`doGet(e)`** (`Code.gs:126`) recibe el evento. Está envuelto en `try/catch`: si algo
   falla al renderizar, el asesor ve una tarjeta con un mensaje en cristiano en lugar de la
   pantalla amarilla de error de Apps Script.
2. **`servirPagina_(e)`** decide la plantilla:
   - Si la clave está en `PORTAL_PAGES` (`portal`, `promociones`, `estado`) → página
     **pública**, sin sesión, y recibe la variable `APP_URL`.
   - Si está en `PAGES` (16 pantallas) → página **de app**, y recibe `baseUrl`.
   - **Si no está en ninguna → cae al Portal.** Esta es la razón número uno de que un enlace
     roto «parezca funcionar»: la pantalla parpadea y acabas en el Portal.
3. Se inyectan **los 17 parámetros de vista** (`PARAMS_VISTA`) en la plantilla, **todos**,
   aunque esa pantalla use uno solo. No es desperdicio: una plantilla de Apps Script revienta
   al evaluar una variable que no se le pasó, y así añadir un parámetro es una línea en una
   lista en vez de una cacería por 40 archivos. Además se inyecta el juego entero ya
   serializado (`APP_JSON`, de `appEstadoInicialJson_`), que es lo que las pantallas pegan
   en `window.__APP__`.
4. La plantilla se evalúa. Cada `<?!= include('app_core'); ?>` inserta el contenido de otro
   archivo HTML **en el momento del render**, en el servidor. No son módulos: es
   concatenación de texto. Por eso el orden de los `include` importa y por eso todo el
   JavaScript del cliente comparte un único ámbito global.
5. En el navegador, `app_core.html` construye `AppUrl`, `AppSession`, `AppCache` y `AppRun`
   a partir de `window.__APP__`, que la pantalla definió **antes** del include con la línea
   `window.__APP__ = <?!= APP_JSON ?>;` — idéntica en las diecinueve. Antes cada pantalla
   componía ese objeto a mano eligiendo qué copiar, y la mitad se quedaba solo con
   `baseUrl`: sus enlaces profundos estaban muertos sin que nada lo dijera.
6. A partir de ahí, cada dato se pide con `AppRun.swr(...)`: se pinta al instante lo que
   haya en `AppCache` y se revalida contra el servidor por detrás.

> **Trampa conocida.** Una pantalla que olvide definir `window.__APP__` arranca con la URL
> base vacía: `AppUrl.build()` devuelve `null` y **cada clic del menú acaba en «no pudimos
> abrir la pantalla»**. Ya pasó con `atenciones.html`. Si una pantalla nueva no navega,
> esto es lo primero que hay que mirar.

---

## 4. Ciclo de vida de una cotización

Es el flujo central del sistema y toca ocho archivos. Consérvalo en la cabeza.

```
 1. CAPTURA          cotizacion.html
                     (opcional: la extensión inyecta la bolsa por bridge.js)
                            │
 2. GUARDADO         saveQuoteAndGoToPreview()            Code.gs
                     · genera folio LVP-#### con LockService
                     · escribe Cotizaciones + DetalleCotizaciones
                     · invalida la caché (cotInvalidarCache_)
                            │
 3. DECISIÓN         revpolDecidirAlGuardar_()            PoliticaRevision.gs
                     · interruptor maestro → reglas en orden → acción por defecto
                     ├── va a revisión → estatus "En Revisión"
                     └── aprobada automáticamente → se sella y sigue
                            │
 4. AUDITORÍA        audAuditar_()                        AuditoriaCotizacion.gs
                     · correo, nombre, teléfono, totales, IVA, descuentos atípicos
                     · comparación contra la ficha real de liverpool.com.mx
                            │
 5. REVISIÓN         revision_cotizacion.html             Revision.gs
                     · el supervisor aprueba o rechaza con observaciones
                     · avisa al asesor por correo
                            │
 6. DOCUMENTO        generateQuotePdfBlob()               Formatos.gs
                     ├── 'actual'        → HTML → PDF     Correos.gs
                     └── 'ccl_liverpool' → copia la hoja plantilla → PDF
                            │
 7. ENVÍO            sendQuoteByEmail()                   Correos.gs
                     · GATE: revPuedeEnviarse_() bloquea lo no aprobado
                     · registra la métrica                Metricas.gs
```

**El punto de control que no se puede saltar es el paso 7.** `Correos.gs` pregunta a
`revPuedeEnviarse_()` (`Revision.gs`) antes de enviar. Si añades un canal de salida nuevo,
tiene que pasar por ahí o habrás abierto una puerta para mandar al cliente una cotización
que nadie aprobó.

---

## 5. Mapa de dependencias entre módulos

Quién llama a quién. Las flechas van del que depende al que provee.

```
                        ┌─────────────┐
                        │ Seguridad.gs│  identidad · configuración · hashes
                        └──────┬──────┘
                               │ lo usa TODO
                        ┌──────▼──────┐
                        │ Permisos.gs │  22 bloques · 3 roles · jerarquía
                        └──────┬──────┘
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
  ┌───────────┐         ┌────────────┐         ┌─────────────┐
  │ Consola.gs│         │  Code.gs   │         │ Operacion.gs│
  │  (admin)  │         │ (núcleo)   │         │  (estado)   │
  └───────────┘         └─────┬──────┘         └─────────────┘
                              │
   ┌──────────┬───────────────┼───────────────┬──────────────┐
   ▼          ▼               ▼               ▼              ▼
Revision   Formatos       Correos        Cache.gs      Atenciones
   │          │               │
   ▼          │               ▼
Auditoria     │            Metricas
Cotizacion    │
              ▼
        (Drive: PDF/CCL)

  Portal.gs ── PortalContenido.gs ── PortalPromosComercial.gs   ← el Portal, aparte
  Trazabilidad.gs                                                ← lee su propio libro
```

Notas que ahorran sustos:

- **`Seguridad.gs` y `Permisos.gs` son el cuello de botella de todo.** Un cambio ahí afecta
  a las 40 pantallas. Es el sitio del proyecto donde hay que ir más despacio.
- **`Equipo.gs` ya no decide nada.** Es un puente de compatibilidad hacia la Consola. Si
  buscas la lógica de gestión de equipo, está en `Permisos.gs` + `Consola.gs`.
- **El Portal es un mundo aparte.** No usa el shell ni el buscador compartido: tiene los
  suyos. Está documentado como decisión consciente en `Carpeta del proyecto/README.md`.
- Los módulos se consultan con `typeof` donde pueden funcionar sin el otro, para que un
  despliegue parcial no tumbe el sistema entero.

---

## 6. Estrategia de caché (las tres capas)

Es lo que hace usable un sistema montado sobre hojas de cálculo. Hay **tres** cachés y se
confunden con facilidad.

| Capa | Dónde vive | Quién la controla | Cómo se invalida |
| --- | --- | --- | --- |
| **Servidor · datos de cotización** | `CacheService` (script) | `Cache.gs` | **Generación**: un contador en propiedades sube en cada escritura y toda la caché queda obsoleta de golpe |
| **Servidor · Portal / operación / trazabilidad** | `CacheService` (script) | `Portal.gs`, `Operacion.gs`, `Trazabilidad.gs` | Función explícita: `portalInvalidarCacheAnuncios_()`, `opInvalidarCache_()`, `trazInvalidarCache()` |
| **Cliente** | `localStorage` | `AppCache` (`app_core.html`) | Versión + TTL por entrada, y borrado explícito tras cada escritura |

**TTL del servidor para cotizaciones** (`COT_TTL` en `Cache.gs`), con el motivo de cada uno:

| Dato | TTL | Por qué |
| --- | --- | --- |
| `listaAsesor` | 180 s | El asesor quiere ver su cotización recién guardada. |
| `busqueda` | 90 s | Barrido completo + *fuzzy*: lo más caro de todo. |
| `supervision` | 240 s | El mismo dato sirve para todos los supervisores. |
| `metricas` | 600 s | Agregado de 30 días; tolera estar un rato viejo. |
| `remitente` | 21600 s (6 h) | El alias de Gmail no cambia casi nunca. |

Otros TTL relevantes: Portal **600 s**; historial de operación por días **600 s**, por horas
**120 s** (una serie por hora cambia mientras se mira, y enseñarla con diez minutos de
retraso durante una caída es justo cuando peor sienta).

**Límites de `CacheService` que la capa respeta:** ~100 KB por valor y 6 h de expiración.
Los valores grandes se guardan troceados (`COT_CACHE_TROZO = 90000`, máximo 20 trozos ≈
1.8 MB); por encima de eso se sirve sin caché en lugar de fallar.

---

## 7. Concurrencia

- **Folios.** `generateLvpFolio()` usa `LockService`. Es el único punto donde dos asesores
  guardando a la vez producirían un duplicado, y está protegido.
- **Contenido del Portal.** `pcConLock_()` envuelve las escrituras.
- **Todo lo demás no tiene lock**, y es una decisión consciente: son escrituras de fila
  propia (una atención, un reporte, una preferencia) donde una colisión real es
  improbable y el coste del lock, permanente.
- **El riesgo vivo no es el código, es la gente**: alguien con el Sheet abierto insertando
  una columna mientras el sistema escribe. Contra eso protege la búsqueda de columnas por
  nombre, no un lock.

---

## 8. Servicios externos de los que depende

| Servicio | Para qué | Si se cae… |
| --- | --- | --- |
| **Google Sheets** | Toda la persistencia | El sistema no funciona. |
| **Google Drive** | PDF generados, imágenes de anuncios, evidencias de operación | No se generan documentos; el resto sigue. |
| **Gmail** | Cotizaciones al cliente, códigos de alta, avisos de revisión | No salen correos; el resto sigue. |
| **Google Calendar** | Calendario comercial de promociones | El monitor de promociones pierde el calendario. |
| **Google Chat (webhooks)** | Aviso de cotización nueva, comunicados de operación | Nadie se entera por chat; queda registrado igual. |
| **`liverpool.com.mx` (UrlFetch)** | Auditoría de precios y fichas de artículo en revisión | La auditoría marca los puntos como «pendiente», no falla. |

Los `oauthScopes` declarados en `appsscript.json` cubren exactamente esto: `spreadsheets`,
`drive`, `script.external_request`, `calendar.readonly`, `script.send_mail`,
`userinfo.email` y `mail.google.com`.

---

## 9. Configuración del despliegue

Del `appsscript.json`, y cada valor tiene consecuencias:

| Clave | Valor | Qué implica |
| --- | --- | --- |
| `runtimeVersion` | `V8` | Se puede usar sintaxis moderna. El código mezcla `const`/`let` con `var` por herencia. |
| `timeZone` | `America/Mexico_City` | **Todas las fechas del servidor son hora de México.** Ver la trampa de abajo. |
| `exceptionLogging` | `STACKDRIVER` | Los errores van a Cloud Logging, no solo al registro de ejecución. |
| `webapp.executeAs` | `USER_DEPLOYING` | El script corre **siempre** con la cuenta que desplegó. Los correos salen de ahí y los permisos de Drive/Sheets son los de esa cuenta. |
| `webapp.access` | `DOMAIN` | Solo el dominio de Liverpool puede abrir la webapp. |

> **Trampa de husos horarios.** Las claves de hora del historial de operación viajan como
> texto `AAAA-MM-DD HH` en hora de la operación, y se rotulan **sin pasar por `new Date`**.
> Interpretarlas como fecha las movería al huso del navegador, y un asesor en otro huso
> vería el pico de las 11 dibujado a las 9. Si tocas el gráfico, respeta esto.

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
