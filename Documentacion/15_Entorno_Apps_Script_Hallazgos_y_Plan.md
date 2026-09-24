# 15 · El entorno de Apps Script a fondo — hallazgos medidos y plan

> **Fecha:** 23/09/2026 · **Estado:** investigación cerrada, plan propuesto (nada del plan está aplicado todavía).
> **Cómo leer las etiquetas:**
> - **[MEDIDO]** lo medimos nosotros el 23/09/2026 (Portal real o laboratorio).
> - **[OFICIAL]** documentación de Google.
> - **[COMUNIDAD]** experimentos publicados por terceros.
> - **[PROYECTO]** lo aprendió este proyecto en incidentes anteriores.
> - **[INFERENCIA]** razonamiento sin prueba directa.
>
> Las cifras se dan como rangos o medianas con su número de muestras. En Apps Script **el ruido entre un minuto y otro es de ±300-500 ms**; una sola muestra no prueba nada.

---

## 0. Resumen para decidir

1. **Hay un problema de seguridad grave y es lo primero que hay que arreglar.** Google le manda a cada página los nombres de las **176 funciones públicas** del servidor, y **cualquier persona del dominio puede ejecutarlas** desde la consola del navegador con los permisos del dueño. 60 no las usa ninguna pantalla. Entre ellas:
   - `permSembrarMaestro(correo)`: nombra **maestro** a quien se pida.
   - `secGuardarConfiguracion()`: devuelve `HASH_SALT` y el webhook.
   - `secFijarModoAuth(modo)`: cambia la autenticación.
   - `sendWebhookNotification`: publica en el Chat.
   - `cuentasLimpiarTodo`: borra los códigos pendientes.

   Ver §3.12 y la Fase 0.
2. **La lentitud del Portal no está en el HTML ni en la red: está en el tamaño del código del servidor.**
   - Cada ejecución (cada pantalla y cada `google.script.run`) paga por cargar el proyecto.
   - Una llamada vacía tarda **~0.8 s en un proyecto vacío y ~1.8-2.0 s en uno con el código del Portal** (medianas de 14 y 21 muestras).
   - Armar la pantalla del Portal con sus 14 `include` cuesta solo **229 ms** en el servidor.
   - Por la red, 1.2 MB llegan en **9 ms**.
3. **Lo que más ayuda, medido:**
   - **Quitar los comentarios de los `.gs` conservando los números de línea** (1,185 KB → 669 KB) baja cada llamada **~300-800 ms**.
   - **Juntar o evitar llamadas** en la carga de cada pantalla. El Portal hace 8 llamadas y los datos terminan de llegar a los **13 s**.
4. **Lo que ayuda poco:**
   - Minificar el HTML de las pantallas: 19-27 % menos peso, pero Google ya quita los comentarios.
   - Ensamblar las páginas de antemano: ahorra 0.1 s y es arriesgado.
5. **Lo que NO sirve, comprobado:**
   - Servir JavaScript compartido con `<script src="…/exec?asset">`: carga, pero **nunca se guarda en caché** (cada carga es una ejecución de 1.5-2.2 s).
   - Service workers: imposibles.
   - Vite: choca con las etiquetas `<? ?>`.
6. **Riesgo de capacidad:**
   - Con «ejecutar como yo», **todos los asesores comparten las 30 ejecuciones simultáneas de la cuenta dueña**. La comunidad midió errores por encima de ~29.
   - Cada carga del Portal lanza 8 llamadas en paralelo.
   - No lo medimos para no afectar producción; hay que probarlo fuera de horario.
7. **Trampas operativas nuevas:**
   - Tras `clasp deploy`, `/exec` **puede servir una versión vieja ~1 minuto**.
   - Hay un **tope de 200 versiones** (producción va en la @130).
   - Los `<meta viewport>` escritos en el HTML **se ignoran**: 17 pantallas no lo tienen.
   - Un `Date` en lo que devuelve el servidor convierte **toda la respuesta en `null`**, sin error.

---

## 1. Cómo se investigó

- **Tres investigaciones en paralelo:**
  - Documentación oficial: más de 40 páginas de developers.google.com y el código de clasp 3.3.0.
  - Experimentos publicados por la comunidad: Tanaike, McPherson, Stack Overflow, Issue Tracker y verificación con `curl` contra cuatro webapps públicas ajenas.
  - Todo lo que este proyecto ya había aprendido: 45 memorias, `Documentacion/`, el código y la extensión.
- **Mediciones en vivo** del Portal (pruebas `/dev` y producción `/exec`) con Chrome real y la API `performance`, que lee el documento superior.
- **Dos proyectos de laboratorio** en el Drive del creador, visibles solo para él:
  - **LAB-mini**: un proyecto casi vacío, para medir el piso de la plataforma.
  - **LAB-grande**: una copia del Portal **sin secretos**. Se usó para medir cuánto cuesta cada parte del proyecto.
  - Detalles y cómo repetir las pruebas en §7.
- **Límite de las mediciones:**
  - Las herramientas del navegador no ven dentro del iframe de Google. Lo interno se midió con código propio dentro del laboratorio.
  - La latencia de red de las PCs de los asesores **no se midió**: todo salió de esta máquina.

---

## 2. Dónde se va el tiempo hoy (línea base) [MEDIDO]

**Pantalla Portal (`?page=portal`):**

| Qué | Pruebas `/dev` | Producción `/exec` |
|---|---|---|
| Primer byte (el servidor arma la página) | 3,225 ms | 3,952 ms |
| Pantalla lista (DOMContentLoaded) | 3.6 s | 4.5 s |
| Llamadas `google.script.run` al abrir | 6 (2.9-6.6 s cada una) | 8 (2.7-6.5 s cada una) |
| Cuándo arrancan las llamadas | — | a los 6.3-6.7 s (≈1 s después de `load`) |
| **Cuándo termina de llegar el último dato** | — | **≈13 s** |
| Documento recibido | 1,175 KB | 1,175 KB |

**Descomposición del primer byte**, con los laboratorios:

| Parte | Costo | Fuente |
|---|---|---|
| Piso de la plataforma (autenticación, envoltorio de Google) | ~0.95 s | LAB-mini: 964 ms con `doGet` de 19 ms |
| **Cargar el código del proyecto del Portal** | **~1-2.8 s** | LAB-grande: 1.1-3.8 s con `doGet` de 12-49 ms |
| Armar la pantalla (plantilla + 14 `include`) | 0.23 s | `servirPagina_('portal')` medido dentro del `doGet` |
| Transferir 1.2 MB en esta red | ~0.01 s | `performance`: 9 ms |

**Conclusión:** de ~4 s de espera inicial, casi todo es plataforma más tamaño del proyecto. Cada llamada de datos vuelve a pagar el tamaño del proyecto.

---

## 3. Hallazgos por tema

### 3.1 Cómo entrega Google una pantalla

- **La pantalla viaja dentro de la página de Google como texto JavaScript con doble escape.** [MEDIDO + COMUNIDAD]
  - El `/exec` devuelve un envoltorio con `goog.script.init("…")`. Dentro va un JSON con `functionNames`, `sandboxHost`, `callbackTimeout`, `userHtml`, etc.
  - `userHtml` del Portal: **880 KB**. Escapado ocupa **1,167 KB (+26 %)**: `<` → `\x3c`, `"` → `\\\x22`.
  - Luego el iframe lo escribe con `document.open()/write()`.
- **Google ya quita comentarios (HTML, JS y CSS) y la sangría, pero conserva saltos de línea y nombres.** [MEDIDO + COMUNIDAD]
  - En el Portal servido no quedó ningún comentario ni ninguna sangría de 4+ espacios. Quedan 27,680 saltos de línea y nombres locales como `activacionViva`.
  - **Esto corrige algo que se dijo antes en la conversación** («el código llega con todos sus comentarios»): no llega.
- **Cada pantalla recibe la lista de las 176 funciones públicas del servidor** (`functionNames`). [MEDIDO] Consecuencia de seguridad en §3.12.
- **Caché y compresión** [COMUNIDAD]:
  - El HTML se sirve `no-store` (nunca se cachea) y solo con gzip.
  - Antes de nuestro HTML carga siempre un script síncrono de Google (`jsapi` → `loader.js`).
  - Los scripts de Google (`warden`, `mae_html_user`, ~480 KB) se revalidan en cada carga.
- **En esta máquina el navegador recibe todo descomprimido** (lo hace un agente de seguridad). Por la red viaja comprimido. [PROYECTO]
- **`callbackTimeout` del Portal: 1,830,000 ms (30.5 min).** [MEDIDO] La comunidad reporta 390,000 en otros proyectos.

### 3.2 El costo del tamaño del proyecto (el hallazgo central) [MEDIDO]

Misma función vacía (`labNoop`) en variantes del mismo proyecto. Llamadas en serie; **en todas las filas se descarta la primera de cada corrida** («en frío»). Se da la mediana y, entre paréntesis, el rango p25-p75:

| Variante del proyecto | Peso | Llamada vacía | Muestras |
|---|---|---|---|
| LAB-mini (solo el laboratorio) | ~10 KB | **773 ms** (559-818) | 14 (`/exec`) |
| Solo HTML del Portal | 3,554 KB | 914 ms (820-971) | 7 (`/dev`) |
| `.gs` sin comentarios, mismas líneas (sin HTML) | 669 KB | **964 ms** (786-1,162) | 7 (`/exec`) |
| `.gs` comprimidos con esbuild (sin HTML) | 574 KB | 1,219 ms (1,179-1,354) | 7 (`/dev`) |
| Candidata (`.gs` sin comentarios + parciales compilados + HTML) | 3,514 KB | 1,384 ms (1,051-1,551) | 7 (`/exec`) |
| Solo `.gs` originales (sin HTML) | 1,185 KB | 1,451 ms (1,293-1,542) | 7 (`/dev`) |
| Todo comprimido (`.gs` + HTML) | 2,329 KB | 1,584 ms (1,247-1,663) | 14 (`/exec`) |
| Portal completo, en `/dev` | 4,739 KB | 1,832 ms (1,689-1,989) | 7 (`/dev`) |
| **Portal completo (como producción)** | 4,739 KB | **1,994 ms** (1,773-2,481) | 21 (`/exec`) |

Las filas `/dev` y `/exec` se midieron en momentos distintos. Comparar sobre todo dentro de la misma columna de despliegue.

- **Lo que más pesa es el código `.gs`.** Con solo HTML el costo es casi el del proyecto vacío. Con solo `.gs` sube ~0.7 s.
- **Quitar comentarios de los `.gs` baja cada llamada ~0.3-0.8 s.**
  - Conservar las líneas da casi lo mismo que comprimir del todo, y los errores de Stackdriver siguen apuntando a la línea del fuente.
  - **Ojo, es una interpolación:** no se midió la combinación exacta que desplegaría la Fase 1 (`.gs` sin comentarios con el HTML original).
    - La acotan dos saltos medidos: completo → candidata, ~0.6 s en `/exec`; y solo `.gs` → `.gs` sin comentarios, ~0.5 s.
    - La Fase 1 lo confirma en pruebas antes de ir a producción.
- **El primer byte varía demasiado para comparar variantes con 5 muestras** (full 1,093-2,219 ms; candidata 1,350-2,576 ms). La latencia de las llamadas es la medida confiable.
- **Ensamblar la pantalla de antemano** (sin `include` en tiempo de ejecución) bajó el armado de 229 a 115 ms. Insignificante frente al resto.
- [OFICIAL] «Avoid libraries in UI-heavy scripts… increase script startup time». Mover código a librerías **no** es solución.

### 3.3 `google.script.run`

- **Latencia mínima de la plataforma: ~0.7 s por llamada** (489-1,014 ms en el proyecto vacío). [MEDIDO] La primera llamada tras cargar sale «en frío»: 1.7-3.0 s.
- **Las llamadas en paralelo sí corren a la vez.** [MEDIDO] 8 juntas tardaron 0.9-1.1 s en el proyecto vacío y 1.8-3.0 s en el grande. La idea previa de que «las llamadas van de una en una» era falsa.
  - [OFICIAL] Máximo **10 simultáneas por página**; la 11.ª espera.
- **Tamaños** [MEDIDO, todos llegaron sin error]:

  | Tamaño | Devolver (servidor → navegador) | Enviar (navegador → servidor) |
  |---|---|---|
  | 1 MB | 0.75-2.3 s | 1.0-1.3 s |
  | 10 MB | 2.6-3.2 s | 6.1-6.7 s |
  | 20 MB | 5.0-5.3 s | 12.9-13.1 s |
  | 40 MB | 5.5-6.4 s | — |

  Enviar es ~2.5× más lento que recibir.
- **Trampa silenciosa: si lo que devuelve el servidor contiene un `Date` (aunque sea anidado), llega `null` completo, sin error.** [MEDIDO + OFICIAL]
  - `getValues()` devuelve `Date` en las celdas con fecha.
  - Regla: convertir fechas a texto o número antes de devolver.
- **Cada llamada:** 2 serializaciones JSON, 2 `postMessage` y una petición HTTP desde la página de Google. [COMUNIDAD]

### 3.4 Concurrencia y cuotas

- **30 ejecuciones simultáneas por usuario y 1,000 por script.** [OFICIAL]
  - Con `executeAs: USER_DEPLOYING` corre todo como la cuenta dueña. **Todos los asesores comparten esas 30.** [COMUNIDAD, confianza media-alta]
  - Tanaike midió errores («Service invoked too many times… exec qps») por encima de ~29 simultáneas.
  - **Cálculo:** cada carga del Portal lanza 8 llamadas de 2.7-6.5 s. Con 4 personas abriendo pantallas a la vez ya son 32. El proyecto lo registra como «no pudimos conectar»: vale la pena revisar si parte de esos errores era esto. [INFERENCIA]
  - **No se midió en producción a propósito:** saturar la cuenta dueña habría afectado a los asesores en línea.
- **Tope de 200 versiones por proyecto.** [OFICIAL]
  - Producción va en la **@130**, y cada `clasp deploy` gasta una.
  - Al llegar a 200 ya no se puede desplegar hasta borrar versiones que no use ningún deployment. Se borran desde el historial del proyecto.
- **Otras cuotas de Workspace** [OFICIAL]:
  - 6 min por ejecución.
  - 6 h/día de activadores.
  - 100,000 llamadas `UrlFetch`/día.
  - 1,500 destinatarios de correo/día.
  - Propiedades: 9 KB por valor y 500 KB por almacén.
  - CacheService: 100 KB por valor (medido por terceros: 102,400 bytes pasan, 102,401 no), máximo 6 h y 1,000 entradas.

### 3.5 Almacenamiento del navegador dentro del iframe [MEDIDO]

- **El origen es por proyecto:** `n-<hash>-0lu-script.googleusercontent.com`.
  - `/dev` y `/exec` del mismo proyecto **comparten** origen y almacenamiento.
  - **Pruebas y producción tienen orígenes distintos**: no comparten sesión ni caché local.
  - El prefijo `ventel-` de las claves partía de una premisa falsa (que el origen se compartía con otras webapps), pero no hace daño.
- **Disponibles:** localStorage, sessionStorage, IndexedDB y Cache API, con una cuota informada de 10 GB. Sobreviven a recargar.
- **Service workers: imposibles.** No hay forma de poner un archivo propio en ese origen. [COMUNIDAD]
- **Riesgo sin probar:** si una política corporativa bloquea cookies de terceros, el almacenamiento podría fallar. Hay que revisar `chrome://policy` en una PC de asesor. [COMUNIDAD]

### 3.6 URL e historial

- **`google.script.history.push(estado, params, hash)` cambia la URL real de la barra** (por ejemplo `…/exec?exp=panel&paso=2#ancla-lab`). **Recargar la conserva** y `google.script.url.getLocation` la lee. [MEDIDO] Con esto se puede cerrar el pendiente #1 (las pestañas no quedaban en la URL).
- **Fallo abierto en Google:** tras F5, el botón Atrás puede dejar la pantalla en blanco (issue 207785211). [COMUNIDAD, no verificado aquí]
- Dentro del iframe, `window.location` es el del iframe interno (`/userCodeAppPanel`), no la URL del usuario. [PROYECTO + COMUNIDAD]

### 3.7 Recursos compartidos entre pantallas

- **`<script src="…/exec?asset=…">` con ContentService: carga, pero no se guarda en caché.** [MEDIDO + OFICIAL]
  - 3 cargas seguidas tardaron 2,249, 1,514 y 1,864 ms. Cada carga es una ejecución completa y una de las 30.
  - Google redirige a una URL de un solo uso (`no-store`).
- **Guardar el código compartido en IndexedDB** (bajarlo una vez por `google.script.run` y reusarlo) es viable. [MEDIDO + COMUNIDAD]
  - Pero **aquí la red no es el cuello de botella**, así que el beneficio sería de lectura del código en el navegador, no de espera.
  - Queda como opción, no como prioridad.
- **CDN (jsDelivr):** solo sirve repositorios públicos. El nuestro es privado.

### 3.8 Plantillas y armado de páginas

- **`include()` pega el parcial sin evaluarlo** (`createHtmlOutputFromFile().getContent()`). [PROYECTO + OFICIAL]
- **En una plantilla, las etiquetas `<? ?>` se ejecutan aunque estén dentro de comentarios.** [MEDIDO]
  - Al ensamblar la pantalla del Portal sin quitar comentarios, Google respondió «Contenido HTML con formato incorrecto».
  - Causa: un `<?!= include('app_atenciones') ?>` citado en un comentario de JS se ejecutó e insertó un `</script>` en mitad del código.
  - **Regla: nunca ensamblar parciales dentro de una plantilla sin quitar antes sus comentarios.**
- **Google valida el HTML de salida** y rechaza el mal formado. [OFICIAL]
- **Los `<meta>` escritos en el HTML se ignoran.** Solo cuentan los de `addMetaTag` (viewport y tres más). [OFICIAL]
  - `servirPagina_` solo lo aplica a las 3 páginas públicas.
  - **Las 17 pantallas de la app no tienen viewport**: en celular probablemente se ven a ancho de escritorio. [INFERENCIA, falta probar en un teléfono]
- **Los bucles dentro de plantillas son caros:** una tabla de 1000 filas hecha con scriptlets tardó ~25 s, contra ~0 s armada en GS. [COMUNIDAD] Los `include` sueltos no son el problema.

### 3.9 Despliegues

- **Justo después de `clasp deploy -i`, `/exec` puede seguir sirviendo una versión anterior durante alrededor de un minuto** (una vez sirvió incluso la @1). [MEDIDO, dos veces]
  - Para verificar un despliegue: esperar y abrir con un parámetro nuevo (`&cb=N`).
- **`/dev` sirve el último código guardado (HEAD)** y solo lo pueden abrir editores. [OFICIAL]
- **clasp 3.3.0** [MEDIDO + OFICIAL]:
  - `create-script` sobrescribe el `appsscript.json` local, y `--type webapp` falla (se arregla en la 3.4.0).
  - Ya no transpila TypeScript.
  - Con `-P` muestra rutas relativas extrañas, pero sube con el nombre correcto (verificado bajando el proyecto).
- **Un proyecto con `oauthScopes: []`** no pide autorización y puede usar HtmlService, ContentService y PropertiesService. [MEDIDO] Útil para laboratorios.

### 3.10 El quitacomentarios de Google tiene un fallo

- **Trata `//` dentro de una plantilla de texto de JS (`` `…` ``) como comentario y rompe el código.** Issue 156139610, abierto desde 2020. [COMUNIDAD]
  - **El código actual del Portal no tiene ninguno** (102 bloques revisados). [MEDIDO]
  - La salida de esbuild probada tampoco lo introdujo. [MEDIDO]
  - **El build debe comprobarlo siempre**, porque un compilador puede convertir `'https://' + x` en `` `https://${x}` ``.

### 3.11 La extensión de Chrome y el iframe

- **El iframe interno (`/blank`) es una URL real.** Google lo llena con `document.open()/write()`, y eso **borra los listeners y el DOM** que un content script hubiera puesto antes. [COMUNIDAD + especificación HTML]
  - Explica por qué los puentes v1-v3 fallaban.
  - Valida el diseño de la v4: escribir desde el marco de fuera en `userHtmlFrame.contentDocument`, reintentando.
- **El popup de la extensión rechaza URLs `/dev`**, así que hoy no se puede apuntar la extensión a pruebas. [PROYECTO] Opciones:
  - un deployment versionado en pruebas;
  - o permitir `/dev` en el popup solo para pruebas.

### 3.12 Seguridad: funciones públicas sin candado [MEDIDO en el código]

- **Toda función sin `_` al final se puede llamar desde el navegador.** Google envía su nombre a cada página. [OFICIAL + MEDIDO]
- **176 públicas, 116 usadas por alguna pantalla, 60 sin uso en el cliente.** Las que se revisaron completas y **no tienen candado**:

| Función | Qué permite a cualquier persona del dominio |
|---|---|
| `permSembrarMaestro(correo)` | **Nombrarse maestro** (rol más alto). Su comentario dice «desde el editor a propósito», pero nada lo impide. |
| `secGuardarConfiguracion()` | **Leer `HASH_SALT` y el webhook** (los devuelve). |
| `secFijarModoAuth(modo)` | Cambiar el modo de autenticación de todo el sistema. |
| `sendWebhookNotification(…)` | Publicar cualquier mensaje en el Chat de la empresa. |
| `saveQuoteDataToSheets(…)` | Escribir cotizaciones directamente en la hoja. |
| `cuentasLimpiarTodo()` | Borrar todos los códigos de verificación en curso. |
| `cuentasPreviaCorreos(enviarA)` | Enviar correos de prueba a cualquier dirección. |
| `NOMBRAR_MAESTRO`, `REPARAR_MAESTRO`, `VER_CORREOS_REGISTRADOS`, `VER_PERMISOS_GUARDADOS` | Ejecutar herramientas de editor; las dos últimas listan datos. |
| `promosAutoCorrerAhora` / `promosAutoSimular` / `promosAutoDisparador` | Forzar la actualización automática (añadidas el 23/09; mismo defecto). |
| ~25 funciones `*Diagnostico`, `diagLimpiarCache`, `idcRefrescar`, `trazInvalidarCache` | Diagnósticos y vaciado de cachés. |

- Revisadas y **sin riesgo**: `registerUser` (ya obsoleta, no crea nada), `equipoGuardarMiembro` (delega en una función con candado) y `consolaAjustes` (con candado).
- No se explotó nada: se leyó el código. **Arreglo en la Fase 0.**

### 3.13 Documentación interna desactualizada (detectado en la revisión)

- **El puente v1 (`postMessage`) sigue descrito como vigente** en los documentos 01, 05 y 09. Lo real hoy es la v4 con el manifest 2.4.
- **Doc 10:** dice que el flujo de GitHub «ya no se pone en rojo» y que el repo «es público». Hoy falla en rojo (falta `CLASPRC_JSON`) y el repo es privado.
- **§18 del plan 13:** no tenía entrada para la @127-@129 ni para la retirada de «Acerca» (se añade con este trabajo).
- **Rutas y cifras viejas:**
  - `Desktop\Portal Ventel` en lugar de `Desktop\Proyectos\Portal Ventel`.
  - «21 pantallas».
  - Números de línea de `doGet` y de `getQuotesForUser`.
- **`cotizacion.html`:** conserva comentarios con hipótesis que ya se descartaron (el modal como causa).

---

## 4. Descartado, con motivo

| Idea | Por qué no |
|---|---|
| Vite / bundler de páginas completas | No convive con `<? ?>`. Para lo que hace falta basta esbuild por bloque. |
| Ensamblar las pantallas de antemano | Ahorra 0.1 s y ejecuta scriptlets ocultos en comentarios (§3.8). |
| JS compartido por `<script src>` | No se cachea y gasta una ejecución por carga (§3.7). |
| Mover código a librerías | Google advierte que arrancan más lento. |
| Comprimir los `.gs` a una sola línea | Casi la misma ganancia que quitar comentarios, pero los errores dejan de señalar la línea. |
| TypeScript ahora | clasp 3 ya no lo transpila. Queda como mejora de calidad (Fase 6), no de velocidad. |
| Caché de código en IndexedDB como palanca principal | Funciona, pero ahorra bytes, y aquí los bytes son baratos. |

---

## 5. El plan

**Reglas para todas las fases:**
- Cada una va primero a **pruebas**, se mide contra la línea base de §2 y pasa a **producción solo con palabra del creador**.
- Cada despliegue gasta una de las 200 versiones.
- Todo cambio de código se registra en el §18 del plan 13.

### Fase 0 · Seguridad y arreglos rápidos (urgente, pequeña)

- **Candado «solo editor» en las herramientas de editor.**
  - Una función `soloEditor_(nombre)` que compara la cuenta activa con la efectiva:
    - en el editor y en los activadores son la misma;
    - en la webapp, la activa es el visitante.
  - Va como primera línea de: `permSembrarMaestro`, `NOMBRAR_MAESTRO`, `REPARAR_MAESTRO`, `secGuardarConfiguracion`, `secFijarModoAuth`, `cuentasLimpiarTodo`, `cuentasPreviaCorreos`, `VER_*`, los `*Diagnostico`, las de caché y las tres de PromosAuto.
  - Renombrarlas con `_` no sirve: desaparecerían del menú «Ejecutar» del editor.
- **Pasar a privadas (`_`) las que solo usa el servidor**, tras comprobar quién las llama: `sendWebhookNotification`, `saveQuoteDataToSheets`, `generateLvpFolio`, `generateQuotePdfBlob`, `formatCurrencyGS`, `revContarPendientes`…
- **Viewport:** `addMetaTag('viewport', …)` también en las 17 pantallas de la app. Probar en un teléfono.
- **Versiones:** apuntar cuáles usan los deployments activos y borrar las que no desde el historial del proyecto. Queda como tarea periódica.
- **Cómo se comprueba:**
  - Desde la consola de una pantalla, `google.script.run.permSembrarMaestro(...)` debe fallar con «solo desde el editor».
  - Desde el editor debe seguir funcionando.
  - Las 8 suites en verde.
- **Esfuerzo:** horas.
- **Reversión:** `-V` al deployment anterior.

### Fase 1 · Build del servidor: `.gs` sin comentarios (la mayor ganancia medida)

- **Qué se hace:**
  - La fuente sigue intacta en `Carpeta del proyecto/`.
  - Un `scripts/build.js` genera `build/` (carpeta hermana, en `.gitignore`) con los `.gs` sin comentarios **y con las mismas líneas**. Localiza los comentarios con `acorn`.
  - clasp sube desde `build/`.
- **El cambio de destino va en un solo commit:** `build/.clasp.json`, el hook (`~/.claude/hooks/auto-push-proyecto.ps1`: primero build, luego push desde `build/`; si el build falla, no sube y avisa) y el paso de build del workflow.
- **Comprobaciones del build:**
  - Cada `.gs` de salida compila.
  - Tiene el mismo número de líneas.
  - Declara los mismos nombres globales.
  - `verificarVersionDelCodigo` sigue viendo sus marcas.
- **Ganancia esperada:** ~0.3-0.8 s menos por llamada y por pantalla (§3.2). Se confirma en pruebas midiendo la misma pantalla antes y después, con 16+ muestras.
- **Riesgos:**
  - Los errores de Stackdriver muestran el código sin comentarios, pero en la misma línea.
  - Si alguien edita a mano en el editor de Apps Script, el siguiente push lo pisa (esto ya pasa hoy).

### Fase 2 · Build del cliente: parciales compilados

- **Parciales** (`app_*.html`, `*Partial.html`): el JS y el CSS se compilan con esbuild.
  - Opciones: `charset: utf8`, `target: chrome109`, `legalComments: none`.
  - Los nombres globales no cambian (verificado).
  - Se escriben **como archivos separados**, nunca ensamblados en las plantillas.
- **Páginas:** solo se quitan los comentarios HTML del marcado, lo que además evita ejecutar scriptlets ocultos en ellos.
- **Comprobaciones:** sintaxis; globales idénticos; que no aparezca `</script` ni `//` dentro de plantillas de texto (§3.10); `sintaxis.js`; las suites.
- **Ganancia:** 19-27 % menos peso por pantalla y menos trabajo para el navegador. Poca espera, porque la red no es el cuello.
- **Verificación visual en pruebas, pantalla por pantalla.** En el laboratorio no se pudo: allí las pantallas salen en blanco por falta de datos.

### Fase 3 · Menos llamadas y más cortas (la mayor ganancia para el usuario)

- **Instrumentar `AppRun`:** duración de cada llamada por función, y cuánto trabajó el servidor (la respuesta lleva el tiempo de servidor). Se guarda una muestra.
- **Auditar las 8 llamadas del Portal y las de las pantallas más usadas:**
  - cuáles se pueden fusionar en un solo `…Inicio()` por pantalla;
  - cuáles pueden ir **ya dentro de la página** desde el `doGet`, leyendo de CacheService (rápido), para no pagar ~1.9 s de viaje de ida y vuelta;
  - por qué las llamadas arrancan ~1 s después de `load`.
- **Métrica:** tiempo hasta el último dato del Portal (hoy ≈13 s).

### Fase 4 · Capacidad: el cupo de 30

- **Medir el pico de ejecuciones simultáneas en hora pico:** panel «Ejecuciones» y un contador en CacheService.
- **Buscar «too many scripts running simultaneously»** en los registros.
- **Probar fuera de horario** qué pasa con 35-40 ejecuciones simultáneas (4 pestañas × 10 llamadas).
- **Mitigación principal:** la Fase 3 (menos llamadas por pantalla) y llamadas más cortas.

### Fase 5 · Navegación

- **Pendiente #1:** pestañas y filtros en la URL con `google.script.history` (verificado que sobrevive a F5). Probar Atrás tras F5 (fallo conocido).
- **SPA (cambiar de pantalla sin recargar):** hoy cada cambio cuesta 2.5-4 s de primer byte más la cascada de Google.
  - Se decide **con las cifras de las Fases 1-3**, empezando por el recorrido más usado.
  - Condición dura: `?page=`, `?next=`, los enlaces compartidos y el `/exec` fijo de la extensión deben seguir funcionando.

### Fase 6 · Calidad (opcional)

- Comprobación de tipos con TypeScript sobre el JS actual (`checkJs` + JSDoc), sin reescribir.
- Las suites de `pruebas/` en el workflow de GitHub. Ese paso no necesita credenciales.

### Fase 7 · Publicar sin depender de una PC

- Dar de alta `CLASPRC_JSON`. **Es decisión del creador:** es la llave de la cuenta corporativa en un GitHub personal, y el token puede caducar por política.
- Con ella, el workflow compila (Fases 1 y 2) y publica en pruebas.

---

## 6. Decisiones que le tocan al creador

1. **Fase 0** (seguridad): aplicarla y **llevarla a producción cuanto antes**.
2. Aceptar que **lo publicado ya no será idéntico a la fuente** (Fases 1 y 2). La fuente sigue siendo la única que se edita.
3. **Ventana fuera de horario** para la prueba de capacidad (Fase 4).
4. **`CLASPRC_JSON`** (Fase 7).
5. **Conservar o borrar los laboratorios** (§7).

---

## 7. Laboratorio y cómo repetir las mediciones

- **LAB-mini:** `1_ZfmADmH4YXq_V1OwayDeM10AXb_vBlXX9NDZTs7g1P23cz3ewGxEAIy`.
  - `/exec`: `AKfycbxngvSED-3bDFFG7OGFuqcegtGutuTyo6fORNsxjlY6249SWvrIGPVupJPN16SmlSDnUw`.
  - `/dev`: `AKfycbx0Aqi9iXKM4cfAicNLl6tWXWfG82ra7XjzXLQXQedV`.
- **LAB-grande:** `1oX4A114LpawkoXGEYRqZXC0dAZJypsu8c-IWbOy08roBiykLC3yFmkbp`.
  - `/exec`: `AKfycbyGCzpkPobuOLTAk_EaUn2YvB_QrNUa4cP54v8gfevS4l6b61tvmiZ-pfWN_h6j27Vp8w` (va en la @9).
  - `/dev`: `AKfycbxXHfIW2Ot604BuhDh2aMeXQVF9GmGGF98vVqIBAXIh`.
  - **Estado al terminar:** el código actual (HEAD, el que sirve `/dev`) quedó vacío, solo con el laboratorio. Pero **su `/exec` sigue apuntando a la @9, y las versiones @1-@9 conservan la copia del Portal** (sin secretos: `HASH_SALT` y los webhooks anulados). **Recomendado: borrar el proyecto** cuando ya no haga falta.
- **Acceso:** los dos son `MYSELF` (solo el creador), con `oauthScopes: []`. Se pueden borrar sin consecuencias.
- **Rutas del laboratorio (`ZZ_Lab.gs`):**
  - `?solo=noop&v=<etiqueta>`: latencia (8 en serie + 8 en paralelo).
  - Sin `solo`: todas las pruebas (tamaños, tipos, almacenamiento, historial).
  - `?solo=asset`: caché del `<script src>`.
  - `?exp=ver`: últimos resultados guardados.
  - `?exp=render&page=X` y `?exp=plantilla&f=X`: armado en el servidor.
- **Los guiones están en `scripts/laboratorio/`**: el código del laboratorio y los medidores de peso. Ahí mismo están las variantes y cómo regenerarlas.
- **Para leer métricas desde fuera del iframe:** `performance.getEntriesByType('navigation')[0]` en la página superior. Para leer lo que armó el servidor: decodificar el literal `goog.script.init("…")` y buscar `userHtml`.
