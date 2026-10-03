# 16 · Plan de transformación del Portal: guía de ejecución

> **Frase de arranque del creador:** «inicia con la transformación del portal ventel».
>
> **REGLA DE ORO: TODO VA PRIMERO A PRUEBAS.**
> - Producción solo con la palabra explícita del creador, fase por fase y después de que él lo haya probado.
> - Pruebas: proyecto `1kTyqcGn…`, lo que sirve su `/dev`.
> - Producción: proyecto `1m1pwHz…`, deployment `AKfycbwGYZs3…`.
>
> **El porqué de cada fase y las cifras medidas están en el doc 15** (`15_Entorno_Apps_Script_Hallazgos_y_Plan.md`). Este documento dice **qué hacer, en qué orden y cómo comprobarlo**.

---

## 0. Al recibir la frase: arranque

1. **Leer la memoria**, en este orden:
   - `transformacion-portal-ventel`
   - `apps-script-entorno-hallazgos`
   - `sesiones-llave-portal`
   - `produccion-y-pruebas-portal`
   - `clasp-appsscript-portal`
   - `autopush-carpeta-proyecto`
   - `registrar-al-terminar-tarea`
2. **Leer §2 (estado) y §3 (fases)** de este documento. El doc 15 solo cuando haga falta el porqué.
3. **Verificar el estado REAL; el documento puede estar atrasado:**
   - `git -C "C:\Users\seguimientos\Desktop\Proyectos\Portal Ventel" log --oneline -8` y `git ls-remote origin refs/heads/main`.
   - Versión que sirve producción: `clasp deployments -P <config de producción>`. La configuración va en el scratchpad (§4).
   - `npm test` (desde la F6: la sintaxis y todas las suites de `pruebas/` de una vez): todo en verde antes de tocar nada. Lo mismo corre en GitHub en cada push (flujo «Pruebas»); `gh run list --workflow pruebas.yml --limit 3` dice cómo salió lo último.
4. **Preguntar al creador SOLO lo que bloquee** (§2, «Decisiones pendientes»). Si nada bloquea, seguir con la primera fase pendiente **en pruebas**.
5. **Al cerrar cada tarea:**
   - entrada en el §18 del plan 13 (qué se cambió, qué se comprobó, qué se dejó fuera);
   - actualizar la tabla del §2 de este documento;
   - actualizar la memoria.

---

## 1. Reglas de trabajo (costaron incidentes; no son opcionales)

1. **El hook sube solo** al terminar cada turno: `git push` a `main` y `clasp push` a **pruebas**, desde `build/` (F1). Puede dispararse a mitad de una tarea.
   - Los cambios grandes se hacen en una **copia de trabajo en el scratchpad**: `cp -r` de `Carpeta del proyecto`, `pruebas`, `scripts`, `package.json` y `node_modules`, quitando `.clasp.json` de la copia.
   - Se prueban ahí y se copian al repo **todos juntos** cuando las suites estén en verde.
2. **Producción** (solo con su palabra): receta en §4.
   - Tras `clasp deploy`, `/exec` puede servir una versión vieja **~1 min**: verificar con `&cb=N`.
   - **Tope de 200 versiones por proyecto**: cada deploy gasta una.
   - El clasificador de permisos a veces bloquea el deploy a producción: no rodearlo, pedir autorización.
3. **Funciones de servidor nuevas:**
   - El navegador las llama por `AppRun` → `secEjecutar` (Sesiones.gs). Toda función pública nueva queda accesible por ese canal.
   - Si es de editor, de diagnóstico o solo la usa el servidor: `secSoloInterno_('nombre')` como **primera línea**, y el nombre en `SES_NO_EXPUESTAS`. `pruebas/sesiones.test.js` falla si falta.
   - Nunca devolver un `Date` al navegador: la respuesta llega `null`, sin error.
   - **Desde la F3b, un `Date` en UNA función de `EN_LOTE` (app_core) tumba el lote entero**: la respuesta completa llega `null` y el cliente rechaza todas las llamadas de ese viaje. Antes de añadir una función a `EN_LOTE`, comprobar que nunca devuelve un `Date`.
4. **HTML:**
   - Nunca meter parciales dentro de una plantilla sin quitar antes sus comentarios: los `<? ?>` dentro de comentarios se EJECUTAN.
   - **Ningún `<script>` puede llegarle a Google con `//` ni `/*`.** Su quitacomentarios no es un analizador: pierde el hilo con una plantilla `` `…` `` (un apóstrofo, un `</svg>`) y corta el primer `//` que encuentra, aunque esté dentro de una cadena. Así se quedó sin cargar el Portal de pruebas el 24/09/2026. El build lo resuelve solo (`sinBarrasCortables`) y falla si no puede. Lo único que no sabe arreglar es una plantilla con etiqueta (`` String.raw`…//…` ``).
   - `include()` sigue siendo la forma segura de armar páginas.
5. **Verificación:**
   - La herramienta de navegador ve el Portal **en blanco** mientras su ventana está oculta (animaciones congeladas): lo visual lo confirma el creador. **Excepción (25/09/2026):** tras `resize_window`, la pestaña pasó a `visible` y la captura enseñó el Portal entero.
   - Medir con `performance` desde la página superior (§4). No se puede entrar con su cuenta: los recorridos con sesión los prueba él.
6. **Capacidad:** pruebas y producción corren como la **misma cuenta dueña**. Una prueba de concurrencia en pruebas gasta el cupo de 30 ejecuciones simultáneas de producción: **solo fuera de horario y con su permiso**.
7. **Datos:** pruebas y producción escriben en **la misma hoja**. Nada de pruebas que escriban basura masiva.

---

## 2. Estado (actualizar al cerrar cada tarea)

| Fase | Qué | Estado | Dónde / commit |
|---|---|---|---|
| F0 | Llave de sesión (2 h de inactividad), 52 candados, V-03, viewport | **En producción (@131, 02/10/2026).** Los asesores inician sesión una vez | `11e77a8` |
| F1 | Build del servidor: `.gs` sin comentarios, mismas líneas | **En producción (@131, 02/10/2026).** El hook, el workflow y `publicar.sh` suben desde `build/`. Medido en pruebas: `doGet` del Portal 2.75 → 2.26 s (−0.49 s) | `2e62a6d` · `7bdc533` |
| F2 | Build del cliente: parciales compilados | **En producción (@131, 02/10/2026).** Peso servido −26 % (Portal −16 %). Banco local: las 20 pantallas se comportan igual que con la fuente. Google sirve los 40 bloques compilados byte a byte. Falta su vistazo en producción, pantalla por pantalla | `d25bb8d` |
| F3a | Portal: respuestas en caché dentro de la página; `AppRun.medidas()` | **En producción (@131, 02/10/2026), con su coste (decisión 5).** Con las cachés calientes, el Portal sin sesión hace 1-2 llamadas al abrir (antes 4-5) y el último dato llega entre los 5.8 y los 8.0 s (≤ 7 s solo si el primer byte baja de ~3 s). **Coste: primer byte +0.47 s** (2.23 → 2.70 s) y `userHtml` +92 KB (Monitor +65 KB) | `557875b` |
| F3a.1 | El `doGet` lee su caché en un solo `getAll`; tope de 100 000 / 150 000 caracteres a lo que viaja en la página | **En producción (@131, 02/10/2026).** Lectura en el servidor 147.5 → 90.5 ms de mediana (A/B alternado, 30 por lado); primer byte sin cambio medible. Va junto con la F3a | `570836a` |
| (arreglo) | Monitor de promociones invisible con los datos en la página: regresión de la F3a que vio el creador | **En producción (@131, 02/10/2026).** Reproducido y corregido; el Portal revisado con la misma sonda. **La F3a no se promueve sin él** | `f02a0ad` |
| (arreglo) | Portal de pruebas en «Cargando datos…»: el quitacomentarios de Google cortaba un `//` dentro de una cadena de Index.html | **En producción (@131, 02/10/2026).** El build quita los comentarios del JS de las páginas y no deja `//` ni `/*` en ningún `<script>`. Las 20 pantallas de `/dev` se leen enteras y Google las sirve byte a byte (380 bloques). Producción no estaba afectada. Va con cualquier promoción hecha con el build actual | `2198c96` |
| F3b | Las llamadas de fondo del arranque viajan en un lote (`secEjecutarLote`); disponibilidad de la plantilla CCL en caché | **En producción (@131, 02/10/2026).** Viajes al abrir las 20 pantallas: 105 → 64 (banco). Lote verificado de punta a punta en pruebas. Falta su vistazo con `AppRun.medidas()` (columna `enLote`) | `7dd7e6f` · `7a05cd7` |
| F3a.2 | Resultados de las encuestas del Portal dentro de la página | **En producción (@131, 02/10/2026).** El `doGet` los lee de la caché de 30 s de los votos (solo si están), con el voto de la cuenta de Google que abre la página; el cliente los usa si no hay sesión o si la sesión es de esa cuenta. Sonda local: la encuesta votada sale con sus barras a los 1.4 s, sin llamar a `pubResultados` (por red, a los 4.2 s aún enseñaba botones). **Sin ver en vivo:** el 01/10 no había ninguna publicación: falta verla con la primera encuesta real | `f004cbc` |
| F4 | Capacidad: cupo de 30 ejecuciones | **Medida el 01/10/2026** con el panel «Ejecuciones» (7 días): como mucho **9-10 a la vez de 30**, contando todo lo de la cuenta y lo de los asesores; ningún segundo con 10 o más. El único error de producción ocurrió con 5. **Con este uso no hace falta la prueba de saturación** (decisión 3). Volver a medir con `scripts/laboratorio/picos-panel.js` si el uso crece | — |
| F5 | Navegación: pendiente #1 en la URL; SPA solo si las cifras lo justifican | **Pendiente #1 en producción (@131, 02/10/2026), con la decisión 8.** `revision_cotizacion` escribe la tarjeta del documento (`?sec=hoja\|google`) y el comparador (`?item=<SKU>[~n]`, `?action=pagina`); `cotizado_preview`, el formato (`?format=`). F5, atrás y adelante vuelven a lo que se miraba. Solo cliente, sin parámetros nuevos. Sonda en Chrome: 40 de 40 (24 fallan con el código anterior). **Medido (Portal y LAB-mini): después de que la página se carga de nuevo (F5, o al volver a ella con atrás desde otra pantalla), el siguiente atrás deja la pantalla en blanco** (fallo conocido de Google, issue 207785211; afecta a las 13 pantallas que apilan en pruebas, 12 de ellas ya en producción; decisión 8). La SPA, sin empezar: depende de las cifras de F1-F3 en producción | `147db71` |
| F6 | Calidad: checkJs y pruebas en CI | **Hecha el 01/10/2026** (no toca el Portal: no hay pruebas/producción). Flujo de GitHub «Pruebas» en cada push (23 suites, ~20 s, en verde) y `npm test` en la PC. `tsc --checkJs` sobre los `.gs` solo hace fallar lo que rompe en ejecución (nombre inexistente, redeclaración, errata en la API…); los ~436 avisos de JS sin tipos se cuentan. Candados nuevos: ningún nombre global repetido entre `.gs` ni entre los `<script>` de una pantalla. El `checkJs` completo del cliente, fuera a propósito (§3, F6) | `7f547ec` · `5a4aafc` · `8122645` |
| F7 | Publicar sin PC (`CLASPRC_JSON`) | Pendiente (decisión del creador) | — |

**Producción hoy: @135 desde el 03/10/2026, ~14:00**, pedida por el creador («sube a producción»). Es la @134 más los íconos de categoría del Monitor (`74b8adb` + `b90ba72`) y el favicon del Portal (`7c9c569`): build de `e600c89`, que era **idéntica a pruebas** (91 de 91). **Desde el 03/10 por la tarde, pruebas va por delante** con «Ver en Google Sheets» en la vista previa (`633a9c9`), que espera su palabra (receta abajo). Antes de subir, el editor de producción era la @134 documentada: 88 archivos iguales y solo cambiaban `Code.gs` (únicamente el favicon), `app_monitor.html` y `Promociones.html`. Después, el editor quedó igual al paquete (91 de 91), el deployment `AKfycbwGYZs3…` apunta a la @135 y el `/exec` sirve el favicon, el panel de los íconos y el revelado `top bottom+=40`. Para volver: `-V 134`. Antes, **@134 desde el 03/10/2026, ~13:38**, pedida por el creador («Sube a producción») después de probar C en pruebas. Es la @133 más «Ir a Vista Previa» sin esperar (opción C, `a522f36`) y login, registro y recuperar sin esperas con la purga de sesiones fuera del login (opción A, `5bb0cbe`). **NO es idéntica a pruebas:** le faltan los íconos del Monitor (`74b8adb`, `b90ba72`) y el favicon (`7c9c569`), que esperan su palabra. **Fuente de la @134** = `500c00e` con estos 8 archivos de `773778c`: `Code.gs`, `app_core.html`, `cotizacion.html`, `cotizado_preview.html`, `inicioDeSesion.html`, `registro.html`, `recuperar.html` y `Sesiones.gs` (los demás no cambiaron). Build con el `build.js` actual; el editor de producción quedó igual al paquete (91 de 91). Para volver: `-V 133`. Antes, **@133 desde el 03/10/2026, 01:01** (build de `500c00e`, idéntico a pruebas: 91 de 91 archivos): lo de la @131 más el Monitor de promociones más visual (`6327112` + `a43ba14`). La @132 es una versión sin descripción que no creó esta sesión y nunca se desplegó. Para volver a lo anterior: `-V 131`. Antes, **@131 desde el 02/10/2026, 15:24** (build de `71c5d2b`, idéntico a pruebas: 90 de 90 archivos). Lleva F0, F1, F2, F3a, F3a.1, F3b, F3a.2, F5, la decisión 8, los dos arreglos y los 10 rediseños (portada «Tu turno», Herramientas, Paqueterías, Formas de Pago, Pago Web, Formatos, Trazabilidad, Devoluciones SAP, Plantillas y Presentaciones). Antes: @130 (PromosAuto, `23144aa`).
- **Volver:** `clasp deploy -P <config de producción> -i AKfycbwGYZs3… -V 130 -d "rollback"`. **Eso no devuelve el código que corre el activador diario**, que corre HEAD: para él, subir la fuente de `23144aa`. Solo la llave de sesión, sin desplegar: `AUTH_SESIONES = no`.
- Lo que falta comprobar después de subir: §18 del plan 13, entrada del 02/10/2026.

**Ojo al promover** (desde el 02/10/2026 todo lo de abajo ya está en producción: estas recetas sirven solo para volver atrás una parte. Y la portada «Tu turno» —`fd41ba1`…`9fd6d08`, etiqueta `respaldo-portada-antes-tu-turno`— entró ANTES que la F0, así que toda copia desde `a50a234` la lleva; F0 + F1 + F2 sin ella = `23144aa` + `git diff 9fd6d08 11e77a8 -- "Carpeta del proyecto"`, probado el 02/10/2026): lo que se sube es `build/`, hecho con el código actual y el `build.js` actual: hoy lleva **F0 + F1 + F2 + F3a + F3a.1 + F3b + F3a.2 + F5 + decisión 8** juntas, más el arreglo del Monitor. Para subir menos:
- **Desde el 03/10/2026 (tarde) `build/` lleva además «Ver en Google Sheets» en la vista previa** (`633a9c9`, a pedido del creador; SOLO EN PRUEBAS, producción @135 no lo tiene). Ver §18 del plan 13.
  - Toca `Formatos.gs` (`previewSheetCcl` devuelve también `url`): **toca el servidor**. Y `cotizado_preview.html`: el aviso y el botón, la barra de 1100 px y `busy: false`.
  - Van juntos, pero ninguno rompe al otro: con la pantalla nueva y el servidor viejo, el botón simplemente no aparece (el panel funciona igual); con el servidor nuevo y la pantalla vieja, no cambia nada.
  - Para promoverlo solo sobre producción: esos dos archivos de `633a9c9` sobre la fuente de la @135 (`e600c89`; los dos son idénticos en `e600c89` y `9caa1f2`) y su build.
  - Para promover otra cosa sin él: worktree en `9caa1f2` y su build.
- **Desde el 03/10/2026 `build/` lleva además login, registro y recuperar sin esperas antes de navegar, y la purga de sesiones fuera del login** (`5bb0cbe`, opción A de la investigación del 03/10, a pedido del creador; en producción desde el 03/10/2026, @134). Ver §18 del plan 13. Toca `inicioDeSesion.html`, `registro.html`, `recuperar.html` y `Sesiones.gs` (**toca el servidor**: `sesPurgar_` ahora la llama `secEjecutarLote`, no `sesCrear_`). No depende de la opción C. Para promover sin ella: worktree en `acfb2d6` y su build. Para promoverla sola sobre producción: esos cuatro archivos de `5bb0cbe` sobre `500c00e` (son idénticos en `500c00e` y `acfb2d6`) y su build.
- **Desde el 03/10/2026 `build/` lleva además «Ir a Vista Previa» sin esperar** (`a522f36`, opción C de la investigación del 03/10, a pedido del creador; en producción desde el 03/10/2026, @134). La cotización navega en el clic y la vista previa guarda al llegar con una ficha (`?guardar=`); el servidor apunta el folio de cada ficha para no dar dos. Ver §18 del plan 13. Toca `Code.gs` (`PARAMS_VISTA`, `cotRecibo*_` y `saveQuoteAndGoToPreview`), `app_core.html` (`PARAMS_VISTA`), `cotizacion.html` y `cotizado_preview.html`: **toca el servidor**, y las cuatro van juntas. Para promover sin ella: worktree en `542ef6c` y su build. Para promoverla sola sobre producción: esos cuatro archivos de `a522f36` sobre `500c00e` (son idénticos en `500c00e` y `542ef6c`) y su build. El minuto en que `/exec` aún sirve la versión vieja, una cotización nueva podría abrir una vista previa vieja que no conoce `guardar` («no sabemos qué cotización mostrar»; el borrador queda): mejor fuera de hora pico.
- **Desde el 03/10/2026 `build/` lleva además el favicon del Portal** (`7c9c569`, a pedido del creador; EN PRODUCCIÓN desde la @135). Solo toca `Code.gs`: `FAVICON_URL`, `conFavicon_()` y las tres salidas de `doGet` (sí toca el servidor). La imagen es un archivo de Drive, `1VtltjIyK1WwHFXYK99c6wJNBB9lTh9bP`, en la carpeta «Proyecto Ventel», legible para liverpool.com.mx: **no borrarlo ni moverlo a un sitio sin ese permiso**, o el Portal vuelve al ícono de Apps Script. Para promoverlo solo sobre producción: desde la @134 (que ya lleva la opción C), `Code.gs` de `7c9c569` sí sirve entero sobre la fuente de la @134, porque su única diferencia con `773778c` es el favicon. Antes de la @134 había que aplicar `git diff 773778c 7c9c569 -- "Carpeta del proyecto/Code.gs"` como parche sobre `500c00e`.
- **Desde el 03/10/2026 `build/` lleva además los íconos de categoría animados del Monitor** (`74b8adb`, y su segunda ronda `b90ba72`: panel de oferta con el ícono grande y detallado; a pedido del creador; EN PRODUCCIÓN desde la @135). Solo cambian `app_monitor.html` y `Promociones.html` (una línea en `pcSet` y el disparo del revelado, `'top bottom+=40'`). Para promover sin ellos: worktree en `8864661` y su build. Para promoverlos solos sobre producción: esos dos archivos de `b90ba72` sobre la fuente de la @134. Ya NO sobre `500c00e`, que dejaría fuera las opciones C y A. No tocan el servidor.
- **Desde el 02/10/2026 `build/` lleva además el Monitor de promociones más visual** (`6327112` + `a43ba14`, rediseño a pedido del creador, no es una fase de este plan; en producción desde el 03/10/2026, @133). Para promover sin él: worktree en la etiqueta `respaldo-monitor-antes-vivo` (= `028d43f`, que ya lleva todo lo anterior) y su build. Para promoverlo solo sobre producción: `Promociones.html` y el parcial nuevo `app_monitor.html` de `a43ba14` sobre `71c5d2b`; no toca el servidor.
- **Desde el 01/10/2026 `build/` lleva también la decisión 8** («solo reemplazar», `10933a0`): ninguna pantalla apila historial. Sin ella: worktree en `1af1e8f` y su build. **Sola sobre producción:** worktree en `23144aa` y, dentro, `git diff 1af1e8f 10933a0 -- "Carpeta del proyecto/app_core.html" "Carpeta del proyecto/Index.html" > d8.patch` y `git apply --3way d8.patch`. `app_core` entra limpio; `Index` entra con un conflicto de contexto en `navUrl` (producción no tiene las líneas de Trazabilidad): quedarse con las líneas de `apila` y resolver a mano (probado el 01/10). Producción hoy no tiene la F5, así que la revisión no apila allí; las otras 12 pantallas sí.
- **Sin la F5** (desde el 01/10/2026): `git worktree add <scratchpad>/sin-f5 7ce4630` (el último commit antes de ella: lleva todo lo anterior) y su build.
- **La F5 sola, sobre lo que hay en producción:** `git worktree add <scratchpad>/solo-f5 23144aa` y, dentro, `revision_cotizacion.html` y `cotizado_preview.html` de `147db71`. Las dos no cambiaron entre `23144aa` y `7ce4630`, y lo que usan de `app_core` (`AppUrl.reflejar`, `alCambiarUrl`, `params`) y `AppOnboarding.definir` ya están en producción, así que no arrastran nada más. Se sube esa carpeta como hoy, sin build: el modelo del quitacomentarios ya dice que Google no cortaría nada en la fuente de las dos.
- **La F3a NUNCA sin el arreglo del Monitor (`f02a0ad`)**: sin él, el Monitor de promociones sale en blanco. Cualquier copia que lleve la F3a y sea anterior a `f02a0ad` necesita `git cherry-pick f02a0ad`.
- **Desde el 24/09/2026 `build/` lleva también la Consola de Herramientas** (`4b9f857`, rediseño de la sección, no es una fase de este plan). Para promover las fases SIN la Consola: `git worktree add <scratchpad>/sin-consola respaldo-herramientas-antes-consola` (= `bf22d81`) y su build. Para promover la Consola sola hacen falta `Index.html`, `app_herramientas.html` y `portal_contenido.html` de `4b9f857`.
- **Desde el 24/09/2026 (tarde) `build/` lleva además el Directorio de Paqueterías** (`c49a3c7`, rediseño de la sección, no es una fase de este plan). Para promover las fases SIN él: `git worktree add <scratchpad>/sin-directorio respaldo-paqueterias-antes-directorio` (= `e2e6cd8`, que ya lleva la Consola) y su build. Para promoverlo solo hacen falta `Index.html` y `app_paqueterias.html` de `c49a3c7`; ese `Index.html` también trae la Consola.
- **Desde el 25/09/2026 `build/` lleva además Formas de Pago en pestañas** (`8bbbbf9`, rediseño de la sección, no es una fase de este plan). Para promover las fases SIN él: `git worktree add <scratchpad>/sin-formaspago respaldo-formaspago-antes-pestanas` (= `5e27d6d`, que ya lleva la Consola, el Directorio y el arreglo del quitacomentarios) y su build. Para promoverlo hacen falta `Index.html`, `app_formaspago.html`, `fp_logos.html` y `Portal.gs` (la función `fpLogosTiendas`) de `8bbbbf9`; ese `Index.html` también trae la Consola y el Directorio.
- **Desde el 25/09/2026 (noche) `build/` lleva además Pago Web en consola** (`5d7eab2`, rediseño de la sección, no es una fase de este plan). Para promover las fases SIN él: `git worktree add <scratchpad>/sin-pdepago respaldo-pdepago-antes-consola` (= `6a149ee`, que ya lleva la Consola, el Directorio, Formas de Pago y el arreglo del quitacomentarios) y su build. Para promoverlo hacen falta `Index.html`, `app_pdepago.html`, `app_indices.html` y `Portal.gs` (`pdpDatos`, `pdpFactores_` y `pdpPromos_`) de `5d7eab2`; ese `Index.html` también trae la Consola, el Directorio y Formas de Pago. En producción la calculadora lee «Pagos Fijos 3.0» con la cuenta que despliega: la del creador la abre (comprobado en la `/dev`); si no pudiera, usa la copia del 30/06/2026 y lo dice.
- **Desde el 26/09/2026 `build/` lleva además Formatos en pestañas por uso** (`822b967`, rediseño de la sección, no es una fase de este plan). Para promover las fases SIN él: `git worktree add <scratchpad>/sin-formatos respaldo-formatos-antes-pestanas` (= `7135926`, que ya lleva la Consola, el Directorio, Formas de Pago, Pago Web y el arreglo del quitacomentarios) y su build. Para promoverlo hacen falta `Index.html`, `app_formatos.html` y `app_indices.html` de `822b967`; ese `Index.html` también trae la Consola, el Directorio, Formas de Pago y Pago Web. No toca el servidor.
- **Desde el 26/09/2026 `build/` lleva además Trazabilidad por situación** (`68dcb53`, rediseño de las seis secciones, no es una fase de este plan). Para promover las fases SIN él: `git worktree add <scratchpad>/sin-trazabilidad respaldo-trazabilidad-antes-situaciones` (= `a9d7bf1`, que ya lleva la Consola, el Directorio, Formas de Pago, Pago Web, Formatos y el arreglo del quitacomentarios) y su build. Para promoverlo hacen falta `Index.html` y `app_trazabilidad.html` de `68dcb53`; ese `Index.html` también trae la Consola, el Directorio, Formas de Pago, Pago Web y Formatos. No toca el servidor: la hoja y `Trazabilidad.gs` siguen igual.
- **Desde el 26/09/2026 `build/` lleva además Devoluciones SAP en consola** (`039a5db`, rediseño de la sección, no es una fase de este plan). Para promover las fases SIN él: `git worktree add <scratchpad>/sin-devsap respaldo-devsap-antes-consola` (= `182a860`, que ya lleva la Consola, el Directorio, Formas de Pago, Pago Web, Formatos, Trazabilidad por situación y el arreglo del quitacomentarios) y su build. Para promoverlo hacen falta `Index.html`, `app_devsap.html`, `app_indices.html` y `app_trazabilidad.html` de `039a5db` (Trazabilidad gana los enlaces a la consola); ese `Index.html` también trae la Consola, el Directorio, Formas de Pago, Pago Web, Formatos y Trazabilidad. No toca el servidor.
- **Desde el 26/09/2026 `build/` lleva además Plantillas en puertas por lo que le pasó al cliente** (`89f6b6f`, rediseño de la sección, no es una fase de este plan). Para promover las fases SIN él: `git worktree add <scratchpad>/sin-plantillas respaldo-plantillas-antes-puertas` (= `37dd7e9`, que ya lleva la Consola, el Directorio, Formas de Pago, Pago Web, Formatos, Trazabilidad por situación, Devoluciones SAP en consola y el arreglo del quitacomentarios) y su build. Para promoverlo hacen falta `Index.html`, `app_indices.html` y `app_comando.html` de `89f6b6f` y `app_plantillas.html` de `0738ef9` (el arreglo del teléfono va encima) (el buscador de las demás pantallas deja de ofrecer las cuatro de «Correos a clientes»); ese `Index.html` también trae lo anterior. No toca el servidor.
- **Desde el 26/09/2026 (noche) `build/` lleva además Presentaciones en consola** (`764f99d`, rediseño de la sección, no es una fase de este plan). Para promover las fases SIN él: `git worktree add <scratchpad>/sin-presentaciones respaldo-presentaciones-antes-consola` (= `cddc5a2`, que ya lleva todo lo anterior, Plantillas incluida) y su build. Para promoverlo hacen falta `Index.html` y `Portal.gs` de `764f99d` y el parcial nuevo `app_presentaciones.html`; ese `Index.html` también trae lo anterior. **Toca el servidor:** `pvArchivos()` (pública, como `pdpDatos`) lee con DriveApp el título, el tipo y la última edición de los archivos de la hoja «Presentaciones», con la cuenta que despliega (el permiso de Drive ya estaba en `appsscript.json`).
- **Sin la F3a.2** (desde el 01/10/2026): `git worktree add <scratchpad>/sin-f3a2 55ebf24` (el último commit antes de ella: lleva todo lo anterior, rediseños incluidos) y su build. La F3a.2 no va sin la F3a (usa `DATOS_INICIALES` y `__APP__.datos`). Toca `Code.gs`, `Publicaciones.gs`, `Index.html` y `app_core.html`; ese `Index.html` trae también todos los rediseños.
- **Sin la F3b:** `git worktree add <scratchpad>/f3a1 5ba5c4c` (el último commit antes de la F3b), `git cherry-pick f02a0ad` dentro, y su build.
- **Sin la F3a.1:** `git worktree add <scratchpad>/f3a e990fff` (el último commit antes de la F3a.1), el mismo `cherry-pick` y su build. No tiene sentido subir la F3a.1 sin la F3a: solo toca su lectura.
- **Sin la F3a (ni la F3a.1):** `git worktree add <scratchpad>/f2 a50a234` (el último commit antes de la F3a) y su build, con la misma receta que abajo.
- **F0 + F1, sin F2:** `git worktree add <scratchpad>/f1 012254b` (el último commit antes de la F2), una unión a `node_modules` dentro (`cmd /c mklink /J`) y `node scripts/build.js` en esa copia: su `build.js` es el de la F1. Se sube su `build/`.
- **F1 sin F0 (ni F2):** `git worktree add <scratchpad>/sin-f0 23144aa` y, desde la copia de `012254b`, `node scripts/build.js --fuente <scratchpad>/sin-f0/"Carpeta del proyecto" --salida <scratchpad>/build-sin-f0 --sin-clasp`. Luego se sube esa carpeta con la configuración de producción.
- **F0 sin F1:** subir `Carpeta del proyecto` de `11e77a8` tal cual. Funciona igual, solo que más lento.
- La F2 no va sin la F1: su build incluye la limpieza de los `.gs`.
- **Desde el 25/09/2026 el build lleva el arreglo del quitacomentarios** (`2198c96`). Una copia vieja compilada con SU `build.js` no lo lleva: compílala con el actual (`node scripts/build.js --fuente <copia>/"Carpeta del proyecto" --salida <scratchpad>/build-x --sin-clasp`), salvo en «F0 + F1, sin F2», que a propósito no compila los `.html`. Lo que se suba sin pasar por el build actual se revisa antes con `node pruebas/quitacomentarios_google.js <carpeta>/*.html`: tiene que decir que Google no cortaría nada.
- Al terminar, `git worktree remove` de cada copia.

**Decisiones pendientes del creador** (preguntar solo cuando toquen):
1. ~~¿F0 a producción?~~ **DECIDIDA el 02/10/2026:** subió con todo lo demás (@131). Los asesores inician sesión una vez; el aviso lo da el creador.
2. ¿Tope absoluto de sesión (p. ej. 12 h) además de las 2 h de inactividad? Acota el daño de una llave robada.
3. Ventana fuera de horario para la prueba de capacidad (F4). **Con el uso medido el 01/10 (máximo 9-10 de 30) no hace falta**; queda por si el uso crece.
4. ¿`CLASPRC_JSON` en GitHub (F7)? Es la llave de la cuenta corporativa en un repo personal.
5. ~~¿F3a a producción con su coste?~~ **DECIDIDA el 02/10/2026: sí**, subió con todo lo de pruebas. El Portal tarda ~0.5 s más en aparecer, a cambio de datos frescos al abrir y 3-4 ejecuciones menos por visita (§3, F3). La F3a.1 le quita ~0.06 s de lectura; el resto es el peso de la página, que ahora tiene tope.
6. ¿`opEstadoSesion` dentro del lote de arranque (F3b)? Hoy sale sola, porque `app_operacion` la retrasa 900 ms a propósito para no competir con el primer pintado. Meterla quitaría 17 de los 64 viajes al abrir las 20 pantallas, pero o la pastilla de estado se pinta 0.9 s antes, o las otras llamadas de fondo esperan 0.9 s más.
7. ¿Alargar la caché de los votos (`PUB_VOTOS_TTL`, hoy 30 s)? Con 30 s, la F3a.2 solo lleva los votos en la página si alguien abrió el Portal en el último medio minuto. Alargarla es seguro para los votos del mismo proyecto (`pubVotar` ya la borra al votar), pero un voto emitido en el otro proyecto (pruebas o producción: misma hoja, cachés separadas) o una edición a mano de la hoja tardaría en verse lo que dure la caché.
8. ~~¿Dejar de apilar historial dentro de las pantallas («solo reemplazar»)?~~ **DECIDIDA el 01/10/2026: sí, A.** Aplicada en pruebas (`10933a0`): `APILAR_HISTORIAL = false` en `app_core` (publicado como `AppUrl.APILA_HISTORIAL`, que también obedece `navUrl` del Portal). Para volver a apilar si Google lo arregla: ponerlo en `true`. (F5; análisis en el §18 del plan 13 y el doc 15 §3.6.)
   - **El problema, medido:** es el fallo conocido de Google (issue 207785211), reproducido en el Portal y en LAB-mini. Cuando una pantalla se carga de nuevo —con F5, **o al volver a ella con atrás desde otra pantalla**—, el siguiente atrás hacia sus pestañas o modales anteriores deja la pantalla **en blanco** y congelada. La app recibe el aviso correcto, pero Google oculta su marco. Solo F5 lo recupera; la app no puede recargarse sola. Hoy apilan 13 pantallas en pruebas, y 12 de ellas también en producción (desde agosto).
   - **A · Solo reemplazar (recomendada):** un interruptor en los dos únicos puntos que apilan (`AppUrl.actualizar` en `app_core` y `navUrl` del Portal). La URL sigue diciendo qué se mira (F5 y enlaces compartidos siguen igual), pero ninguna pantalla crea entradas propias: atrás es siempre una carga completa de la pantalla anterior, y nunca en blanco (medido en LAB-mini). Coste: atrás ya no cierra un modal ni vuelve a la pestaña anterior dentro de la misma pantalla; eso queda en los botones (cerrar, pestañas, Inicio). Abandona a propósito el «atrás → estado anterior» del criterio 1 de la F1 del plan 13. Se revierte en una línea si Google lo arregla.
   - **B · Dejarlo así:** atrás funciona dentro de una pantalla mientras no se recargue; el primer atrás después de una recarga deja al asesor ante una pantalla blanca hasta que pulse F5.
   - Descartado: volver a escribir la dirección desde el aviso (medido: no la recupera) y sondear con `getLocation` (la app ya recibe el aviso; lo que falla es la pantalla, no la dirección).

---

## 3. Fases, en orden

### F0 · Cerrar la seguridad (en producción desde el 02/10/2026, @131)

- **Su prueba en pruebas:**
  1. Entrar con su cuenta.
  2. Usar cotizar, consultar y buscar.
  3. Para ver el vencimiento rápido: `SESION_INACTIVIDAD_MIN = 3` en las propiedades del proyecto de **pruebas**, volver a entrar y esperar a que se tape la pantalla.
  4. Borrar la propiedad.
- **Promoción** (con su palabra): receta de §4.
  - Si ya hay trabajo de F1 o posterior en el repo y solo se quiere F0: `git worktree add <scratchpad>/f0 11e77a8` y promover desde esa carpeta.
- **Después del deploy:**
  - Verificar con `&cb=N` pasado 1 min.
  - **A la mañana siguiente**, revisar en «Ejecuciones» que el activador `promosAutoDisparador` corrió sin error (ya marca `SEC_ENTRADA_='activador'`).
  - Revisar que no haya un aluvión de `SESION_EXPIRADA`.
- **Emergencia:** propiedad `AUTH_SESIONES = no` en producción. Vuelve al comportamiento anterior sin desplegar.
- **Podar versiones** sin deployment desde el historial del proyecto, dejando las de rollback recientes.

### F1 · Build del servidor (la mayor ganancia medida)

> **Hecha en pruebas el 23/09/2026** (`2e62a6d`, `7bdc533`; detalle en el §18 del plan 13). Tres diferencias con lo planeado:
> - La sangría **no** se quita dentro de cadenas y plantillas multilínea. Además, el build compara el árbol sintáctico completo con el del fuente: más estricto que «mismos globales».
> - Un fallo del build borra `build/`, así que no queda nada a medias que se pueda subir.
> - La medición fue del `doGet` y no de las llamadas: la pestaña de la herramienta estaba oculta y el Portal no llama mientras no se ve. Se alternó fuente y build en tres parejas (§4).

- **Objetivo:** subir los `.gs` sin comentarios y **con las mismas líneas**, para que los errores sigan apuntando a la línea del fuente. Medido: ~0.3-0.8 s menos por llamada y por pantalla (doc 15 §3.2, interpolado).
- **Pasos:**
  1. **`package.json`** en la raíz del repo, con devDependencies `esbuild@0.28.2` y `acorn@^8`. Correr `npm install` con el npm portable de `C:\Users\seguimientos\.local\node`. Añadir `node_modules/` y `build/` al `.gitignore`.
  2. **`scripts/build.js`:**
     - Borra y recrea `build/`, hermana de `Carpeta del proyecto` y **nunca dentro**.
     - Copia tal cual `appsscript.json`, `.claspignore` y los `.html` (F2 los compilará).
     - Por cada `.gs`, quita los comentarios con `acorn` (`onComment`) conservando los saltos de línea y quita la sangría. Referencia: `scripts/laboratorio/variantes.js`, `sinComentariosMismasLineas`.
     - **Comprobaciones por archivo:** compila (`new Function`), mismo número de líneas, mismos nombres globales (acorn), y las marcas que busca `verificarVersionDelCodigo` (Admin.gs) siguen presentes.
     - Escribe `build/.clasp.json` con el `scriptId` de `Carpeta del proyecto/.clasp.json` (pruebas) y `rootDir: "."`.
     - Sale con código ≠ 0 si algo falla.
  3. **`pruebas/build.test.js`:** corre el build a una carpeta temporal y comprueba esas invariantes.
  4. **Hook** (`C:\Users\seguimientos\.claude\hooks\auto-push-proyecto.ps1`, fuera del repo). En la sección de Apps Script: `node scripts/build.js` antes de clasp. Si falla, **no sube** y avisa en el `systemMessage`. Si pasa, `clasp push --force` **desde `build/`**. El stdout del hook debe seguir siendo JSON puro.
  5. **Workflow** `apps-script-sync.yml`: `npm ci`, luego `node scripts/build.js`, y `working-directory: build`.
  6. El cambio de destino (hook + workflow + `.gitignore`) va en **un solo commit**.
- **Medir en pruebas, antes y después:** misma pantalla (Portal), 5 cargas cada vez, duración de las llamadas y primer byte (§4).
  - **Criterio:** mediana ≥ 0.3 s menos. Si no mejora, revertir.
- **Reversión:** devolver el hook a su versión anterior (guardar copia) y `git revert` del commit.

### F2 · Build del cliente (menos peso y menos trabajo del navegador)

> **Hecha en pruebas el 23/09/2026** (`d25bb8d`; detalle en el §18 del plan 13). Diferencias con lo planeado:
> - El JS va **sin `minifySyntax`**. Esa opción convertía cadenas con `\n` en plantillas `…` con el salto de línea dentro (2 casos hoy), justo lo que el quitacomentarios de Google estropea. Sin ella, el JS baja un 58 % en vez de un 59 %.
> - El marcado de los parciales **no** se toca, salvo sus comentarios: Google ya le quita la sangría al servir. Tocarlo solo añadía riesgo (`<pre>`, `<textarea>`, `white-space: pre`).
> - Comprobaciones añadidas:
>   - cada bloque es el mismo programa que la fuente, salvo nombres locales (`arbolNormalizado`);
>   - los globales conservan su tipo (`var`, `let`, `function`…);
>   - esbuild elige comillas y, con una cadena que lleva `'` y `"`, puede escribir una plantilla `…` con `//` dentro: el build la reescribe como cadena normal (`plantillasSeguras`).
> - Verificación:
>   - banco local en Chrome headless (`scripts/laboratorio/banco.mjs`): las 20 pantallas, fuente contra build;
>   - en pruebas: las 20 pantallas servidas y su JS leído tal como lo deja Google;
>   - huellas SHA-256: los 40 bloques compilados llegan byte a byte.

- **En `scripts/build.js`:**
  - **Parciales** (`app_*.html`, `*Partial.html`): los bloques `<script>` y `<style>` se compilan con esbuild (`minify`, `charset:'utf8'`, `target:'chrome109'`, `legalComments:'none'`) y el marcado queda sin comentarios ni sangría. Se escriben **como archivos separados**; `include()` los sigue pegando.
  - **Páginas** (plantillas): solo se quitan los comentarios HTML de nivel de marcado. Así además dejan de ejecutarse scriptlets escondidos en ellos. **Desde el 25/09/2026 (`2198c96`)** su JS también pierde comentarios y sangría, y ningún `<script>` sale con `//` ni `/*` (§1, regla 4).
  - Referencia: `scripts/laboratorio/medir.js` y `medir2.js` (`trocear`, `completo`).
- **Comprobaciones:**
  - sintaxis de cada bloque;
  - mismos globales;
  - ningún `</script` en el JS;
  - **ningún `//` ni `/*` dentro de plantillas de texto** de la salida.
- **Verificación en pruebas:** cargar las 20 pantallas y comprobar que responden (llamadas con datos). El «HTML mal formado» solo lo detecta Google al servir.
  - **Visual: lo confirma el creador** pantalla por pantalla.
- **Ganancia esperada:** 19-27 % menos peso por pantalla (doc 15 §3.1). Poca espera, porque la red no es el cuello.

### F3 · Menos llamadas y datos iniciales en la página (lo que más notará el asesor)

> **F3a hecha en pruebas el 24/09/2026** (`557875b`; detalle y cifras en el §18 del plan 13):
> - El `doGet` del Portal y del Monitor deja en `__APP__.datos` lo que ya estaba en CacheService (`DATOS_INICIALES` en `Code.gs`), y `AppRun.swr` lo usa una vez, sin viaje. **Solo lee la caché, nunca construye** (construir sube el primer byte y dos constructores escriben en hojas).
> - `AppRun.medidas()` ya existe (instrumentación del primer punto de abajo), con el tiempo de servidor que devuelve `secEjecutar(…, medir = 1)`.
> - Resultado: con las cachés calientes, el Portal sin sesión hace 1-2 llamadas al abrir y el último dato llega entre los 5.8 y los 8.0 s: el criterio (≤ 7 s) solo se cumple cuando el primer byte baja de ~3 s. **Coste medido: +0.47 s de primer byte.** Solo ~0.15 s son la lectura; el resto, el peso extra de la página.
> - «Por qué arrancan ~1 s después del `load`»: ~0.5 s son del propio Portal (leerse y ejecutarse), el resto del envoltorio de Google. Con copia local, además, `swr` esperaba al primer fotograma.
>
> **F3a.1 hecha en pruebas el 24/09/2026** (`570836a`; detalle en el §18 del plan 13):
> - Un solo `getAll` para todas las claves y un tope de 100 000 caracteres por respuesta y 150 000 en total; lo que no cabe se omite y la pantalla lo pide como antes.
> - Lectura en el servidor: 147.5 → 90.5 ms de mediana (A/B alternado, 30 por lado). El primer byte no cambia de forma medible: ~57 ms quedan por debajo del ruido de Google.
> - Las propiedades siguen siendo dos `getProperty`: `getProperties()` traería el almacén entero, con las sesiones y hasta 500 fichas de revisión.
> - Una trazabilidad troceada (más de 90 000 caracteres) no viaja: el `doGet` pide solo su cabeza.
>
> **F3a.2 hecha en pruebas el 01/10/2026** (`f004cbc`; detalle en el §18 del plan 13). Como la propuesta de abajo, con dos precisiones: el cliente usa lo de la página también **con sesión de la misma cuenta** (si la sesión es de otro correo, se descarta entero y las encuestas se piden como antes, en el lote de la F3b), y la entrada va la última de `DATOS_INICIALES`, para que sea la primera en caer por el tope. `AppRun.dePagina` la apunta en las medidas. Sin verificar en vivo: ese día no había encuestas publicadas.
>
> **F3a.2 · replanteada.** El plan decía «los resultados de las encuestas dentro de `toolsData`», y eso choca con `Publicaciones.gs`: los votos tienen caché propia de 30 s porque `toolsData` vive 10 min en el servidor y 7 días en el navegador, y un resultado de esas edades «miente». Lo que la tarjeta pide al abrir es sobre todo `miVoto`, que decide si se ven botones o barras. Propuesta que respeta las dos cosas:
> - Los totales, en `datos`, leídos de la MISMA caché de 30 s (`pubVotos_<id>`) y solo si ya están: igual de frescos que la llamada de hoy. Cuesta un segundo `getAll` en el `doGet`, solo cuando `toolsData` trae encuestas.
> - `miVoto` sin sesión: con `Session.getActiveUser()`, que es la misma identidad con la que `pubQuienVota_` cuenta ese voto. Nunca viaja `porCorreo` (quién votó qué).
> - Con sesión, `miVoto` depende del correo de la sesión, que el `doGet` no conoce: tiene que ir dentro de la llamada fusionada de la F3b. **Por eso la F3b va antes.**
>
> **F3b hecha en pruebas el 24/09/2026** (`7dd7e6f`, `7a05cd7`; detalle en el §18 del plan 13):
> - No hizo falta una `sesInicio` con nombre: las cuatro llamadas no salen a la vez (cada parcial pide lo suyo a su hora) y dos se repiten después. `AppRun.call` junta en una cola las funciones de `EN_LOTE` y las manda por `secEjecutarLote` (Sesiones.gs), que valida la sesión una vez y responde `{ v, ms }` o `{ e }` por función. Ningún parcial cambió.
> - Viajes al abrir las 20 pantallas: 105 → 64 (banco). En pruebas, `lote[prefsLeer+opEstadoSesion]` en un viaje: 3.1 s en caliente.
> - `getEnabledQuoteFormats` guarda 10 min la disponibilidad de la plantilla CCL (solo si está disponible).
> - Queda fuera `opEstadoSesion` al abrir (decisión 6 del §2).
>
> **Regresión de la F3a, corregida (`f02a0ad`):** con los datos dentro de la página, el Monitor de promociones se quedaba sin tarjetas ni cifras. Un segundo revelado con `gsap.from()` las llevaba «de 0 a 0». El banco no lo vio porque fuerza el movimiento reducido: ver `revelado-monitor.mjs` y `revelado-portal.mjs` en el laboratorio.
>
> **02/10/2026: todo está en producción (@131).** Queda: las comprobaciones de después (§18 del plan 13), volver a medir la F4, la SPA con cifras de producción, la F7 y las decisiones 2, 6 y 7.
>
> El 01/10/2026, el pendiente #1 de la F5 y la decisión 8 («solo reemplazar», `10933a0`) quedaron en pruebas, y la F6 hecha (§3). **Lo que quedaba entonces dependía del creador:**
> - ~~su vistazo en pruebas y su palabra para llevar a producción F0-F3a.2, la F5 y la decisión 8~~: subió el 02/10/2026 (@131), con las decisiones 1 y 5 tomadas; quedan la 2, la 6 y la 7;
> - la **F7** (decisión 4: `CLASPRC_JSON` en GitHub);
> - la SPA de la F5, que espera a que F1-F3 estén en producción y den cifras; después de llevarlas, volver a medir la F4.

- **Instrumentar `AppRun`:**
  - Duración por función, en un anillo en localStorage y en `AppRun.medidas()`.
  - Opcional: un lote agregado cada 30 min a una hoja oculta «Latencias» (n, p50, p90 por función), con la Drive MCP para leerla.
- **Auditar las llamadas del Portal al abrir** (hoy 5-8, y los datos terminan a los ~13 s):
  - fusionar las públicas en una sola `portalInicio()`;
  - servir los datos cacheables **dentro de la página** desde el `doGet`, leyéndolos de CacheService, con el mismo patrón que `APP_JSON`. Cada viaje evitado ahorra ~1.9 s;
  - averiguar por qué las llamadas arrancan ~1 s después de `load`.
- Repetir en las 3 pantallas más usadas: cotización, consulta y dashboard.
- **Criterio:** datos completos del Portal en ≤ 7 s (hoy ≈13 s), medido desde la página superior.

### F4 · Capacidad (el cupo de 30)

> **Medida el 01/10/2026, con el panel «Ejecuciones»** (ni con la API ni con un contador; detalle en el §18 del plan 13):
> - **La API `processes`** (el mismo dato, por programa) **está cerrada**: Google bloquea al cliente de clasp cuando pide el alcance `script.processes` («Esta aplicación está bloqueada»). **Un contador en CacheService** costaría en cada llamada y perdería cuentas justo en el pico. El panel guarda 7 días y, con este volumen, se lee entero: `scripts/laboratorio/picos-panel.js` (se pega en la consola de la página; trae su autoprueba para Node).
> - Dos listas: «Mis ejecuciones» (lo que corre la cuenta dueña en TODOS sus proyectos) **no trae lo que ejecutan los asesores**, aunque corra como ella; eso solo sale en el panel de cada proyecto. Se suman las dos, sin contar dos veces lo del dueño.
> - **Resultado (24/09 19:00 → 01/10 18:54):** 11 324 ejecuciones; de producción, 607 (328 de otras personas). Máximo simultáneo **entre 9 y 10** (la hora de inicio viene al segundo, así que se dan cotas), el 25/09 a las 17:23: 8 del entorno de desarrollo (pruebas, no asesores) y 1 del activador de cada minuto. **Ningún segundo con 10 o más**, 20 s con 8 o más y 137 s con 5 o más. Producción sola: entre 8 y 9, porque una sola pantalla abre de 5 a 8 llamadas casi a la vez.
> - **El único error de producción** (29/09, 9:50:57, `fetchTrazabilidadData`, 0 s) ocurrió con 5 a la vez de lo visible: el cupo no lo explica. Su registro no se leyó (la extensión del navegador bloqueó el texto).
> - **Un «Proyecto sin título» de la cuenta ejecuta `actualizarFecha` cada minuto:** 10 247 veces en la semana (~75 min/día de activadores, 9 errores). No es del Portal; ocupa una de las 30 un par de segundos por minuto.
> - **Con este uso, la prueba de saturación no hace falta.** Volver a medir si el uso crece: al llevar F0-F3 a producción, o si se suman asesores.

- **Medir picos:** hecho con el panel (arriba). El contador en `secEjecutar` se descartó.
  - «too many scripts running simultaneously»: no hizo falta buscarlo; el único error de la semana ocurrió con 5 a la vez.
- **Prueba de saturación** (35-40 llamadas simultáneas): **solo fuera de horario y con su permiso**; afecta a producción (misma cuenta).
- **Mitigación:** la F3 (menos llamadas), llamadas más cortas y caché.

### F5 · Navegación

> **Pendiente #1 hecho en pruebas el 01/10/2026** (`147db71`; detalle en el §18 del plan 13):
> - `revision_cotizacion`: la tarjeta del documento en `?sec=hoja|google`; el comparador en `?item=` (el SKU, con `~2`, `~3`… si se repite y `~n` sin SKU: identidad, no posición) y `?action=pagina` para la página de Liverpool. Abrir y cambiar de pestaña apilan; cerrar y plegar reemplazan. `aplicarUrl` lo repone al pintar y con atrás/adelante, y borra de la barra lo que ya no existe.
> - `cotizado_preview`: `?format=` sin apilar, como cotizacion y correoventel.
> - Sin parámetros nuevos (ya estaban en `PARAMS_VISTA`) ni cambios en el servidor. Prueba `pruebas/url_pestanas.test.js` y sonda `scripts/laboratorio/url-pestanas.mjs` (Chrome headless con un historial de verdad y F5 simulado: 40 de 40; 24 fallan con el código anterior).
> - **Atrás después de una recarga, medido (Portal y LAB-mini):** sin recargar funciona; **después de que la pantalla se carga de nuevo (F5, o al volver a ella con atrás desde otra), el siguiente atrás la deja en blanco**. Es el fallo conocido de Google: decisión 8 del §2. (Una primera lectura, con la ventana del navegador oculta, lo vio como «cambia la dirección y no la pantalla»; era la ventana.)

- **Pendiente #1:** que las pestañas de `revision_cotizacion` y `cotizado_preview` queden en la URL.
  - Usar `google.script.history` (verificado: sobrevive a F5), conservando siempre `page`.
  - Probar Atrás después de F5 (fallo conocido de Google, issue 207785211).
- **SPA** (cambiar de pantalla sin recargar): solo para el recorrido más usado y **después** de ver las cifras de F1-F3.
  - Condición dura: `?page=`, `?next=`, los enlaces compartidos y el `/exec` fijo de la extensión siguen funcionando.

### F6 · Calidad (opcional)

> **Hecha el 01/10/2026** (detalle en el §18 del plan 13):
> - **`npm test`** = `scripts/pruebas.js`: la sintaxis y cada suite en su propio proceso; enseña solo la salida de lo que falla y sale con 1. Las suites nuevas entran solas (`*.test.js`).
> - **Flujo «Pruebas»** (`.github/workflows/pruebas.yml`): `npm ci` + `npm test` con Node 24 en cada push a `main` (menos los que solo tocan documentación) y en cada PR. Sin credenciales. Va aparte de `apps-script-sync.yml`, que sigue en rojo a propósito sin `CLASPRC_JSON`.
> - **`pruebas/tipos.test.js`:** ningún nombre global repetido entre `.gs` (Apps Script los mete todos en un espacio de nombres) y `tsc --checkJs` (TypeScript 7.0.2 + `@types/google-apps-script` 2.0.13, fijos) que solo hace fallar las clases de error que rompen en ejecución. Hoy no encontró ningún fallo real: los candidatos eran falsos positivos (uno aceptado con su porqué).
> - **`pruebas/globales_pantallas.test.js`:** ningún nombre global declarado dos veces entre los `<script>` de una misma pantalla (407 bloques en las 20).
> - **Fuera a propósito:** el `checkJs` completo del JS del cliente. Vive repartido en parciales que se pegan por pantalla, haría falta extraerlo y daría aún más ruido que el servidor; lo peligroso de verdad (los choques entre bloques) ya lo vigila la prueba de arriba.

- Comprobación de tipos con `tsc --checkJs` sobre el JS actual, con JSDoc, sin reescribir.
- Job de GitHub que corra `pruebas/*.test.js`: no necesita credenciales.

### F7 · Publicar sin depender de una PC

- Solo si el creador acepta subir `CLASPRC_JSON`. Entonces el workflow compila (F1/F2) y publica **en pruebas**.

---

## 4. Recetas

**Subir a pruebas.** Lo hace el hook al terminar el turno: compila y sube desde `build/`. Si el build falla, no sube y lo dice; el registro queda en `%TEMP%\auto-push-build.txt`. A mano: `node scripts/build.js` en la raíz del repo y `clasp push --force` desde `build/` (o `./scripts/publicar.sh`, que hace las dos cosas).
- Si falta `node_modules`: `npm ci` en la raíz del repo (con el sandbox desactivado: necesita red).
- Nunca editar `build/` a mano: el siguiente build la borra entera.

**Promover a producción** (solo con su palabra; leer antes el «Ojo al promover» del §2):
1. `node scripts/build.js`. Crear la configuración FUERA del repo, en el scratchpad:
   ```json
   {"scriptId":"1m1pwHzRuIWpUOlSzw7cwrdmbA06_lPEHgkmGpiFdDA6XpO6Y-2jyZCHz","rootDir":"<ruta ABSOLUTA a build/>"}
   ```
2. Subir: `clasp push --force -P <config> -I <ruta a build/.claspignore>`.
3. Verificar 1:1: `clasp pull` a una carpeta temporal y comparar contenido con `build/` (los `.gs` bajan como `.js`).
4. Desplegar: `clasp deploy -P <config> -i AKfycbwGYZs3C-dsZbIWVn27uEaLm_rXQGhiQc9Q54btPxPb-Z1SX0Enx7NlPqKw4STizaOU -d "<qué lleva>"`.
5. Esperar ~1 min y abrir `/exec?page=portal&cb=N`.
6. Anotar la versión en el §18 y en la memoria `produccion-y-pruebas-portal`.

**Rollback:** `clasp deploy -P <config> -i AKfycbwGYZs3… -V <versión anterior> -d "rollback"`.

**Medir una pantalla** (Chrome con la sesión del creador, en la página superior):
```js
const n = performance.getEntriesByType('navigation')[0];
const cb = performance.getEntriesByType('resource').filter(r => r.name.includes('/callback'));
({ ttfb_ms: Math.round(n.responseStart - n.requestStart),
   llamadas_ms: cb.map(r => Math.round(r.duration)),
   fin_ms: Math.max(0, ...cb.map(r => Math.round(r.responseEnd))) })
```
- Repetir 5 veces con `&cb=N` distinto y comparar medianas.
- **Si la pestaña está oculta** (`document.visibilityState === 'hidden'`, lo normal con la herramienta), el Portal no hace sus llamadas. Entonces se mide el `doGet`, que paga la misma carga del código, pidiéndolo desde la página superior:
  ```js
  const base = location.origin + location.pathname, out = [];
  for (let i = 0; i < 11; i++) { const t0 = performance.now();
    const r = await fetch(base + '?page=portal&cb=' + Date.now(), { credentials: 'include', cache: 'no-store' });
    const t1 = performance.now(); const txt = await r.text();
    const m = txt.match(/goog\.script\.init\("((?:[^"\\]|\\.)*)"/);
    const u = m ? JSON.parse(new Function('return "' + m[1] + '"')()).userHtml : '';
    out.push(Math.round(t1 - t0) + (u.length > 300000 ? '' : '!')); }   // '!' = no llegó el Portal
  JSON.stringify(out)
  ```
  - El centinela anterior (`txt.length > 1000000`) medía el sobre entero. Con la F2 el sobre del Portal bajó a 1.07 MB; con la F3 bajaría de 1 MB y todas las muestras saldrían con `!`. Por eso ahora se lee `userHtml` (Portal con F2: 796 KB).
  - La tanda puede quedarse corriendo: se lanza sin `await` guardando las muestras en `window`, y se consultan en otra llamada.
- **Comparar alternando** (A = antes, B = después: A, B, A, B, A, B) y descartar la primera muestra de cada tanda. Google varía con la hora: en la F1, dos tandas seguidas de A dieron 2.65 y 3.11 s. Con una sola tanda por lado, esa deriva se habría leído como efecto del cambio.
- No lanzar la subida y la tanda en la misma respuesta: corren a la vez, y las primeras muestras caen sobre el código anterior.
- **Si el cambio vive dentro de la lectura del `doGet`, el lector bueno es `datosMs`**, no el primer byte: lo mide el propio servidor, sin el ruido del envoltorio. En la F3a.1 bajó ~57 ms de mediana mientras el primer byte oscilaba ±0.3 s entre tandas iguales. Anotar también las claves de `datos` de cada muestra y comparar solo muestras con las mismas: una caché que caduca a mitad de la medición cambia lo que se lee.
- Para leer lo que armó el servidor: decodificar el literal de `goog.script.init("…")` y leer `userHtml` (doc 15 §7). Desde la F3a, `__APP__` va dentro: `userHtml.match(/window\.__APP__ = ([^<]*);<\/script>/)` y `JSON.parse` dan `datos` (qué respuestas viajan) y `datosMs` (lo que costó leerlas).

**Qué llama una pantalla, con nombre** (F3). `performance` da la duración de las llamadas, pero no qué función es. Para eso, un espía en el `XMLHttpRequest` de la página superior, instalado justo después de navegar:
```js
window.__esp = [];
const oS = XMLHttpRequest.prototype.send, oO = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (m, u) { this.__u = String(u); return oO.apply(this, arguments); };
XMLHttpRequest.prototype.send = function (body) {
  try { if (this.__u.includes('/callback')) {
    let fn = '?';
    try { const arr = JSON.parse(new URLSearchParams(typeof body === 'string' ? body : '').get('request'));
          const args = JSON.parse(arr[1]);                       // [llave, función, args, actividad, medir]
          fn = arr[0] === 'secEjecutar' ? args[1] + (args.length > 4 ? '·m' : '')
             // F3b: [llave, [[función, args]…], actividad]
             : arr[0] === 'secEjecutarLote' ? 'lote[' + (args[1] || []).map((x) => x[0]).join('+') + ']'
             : arr[0]; } catch (e) {}
    const reg = { fn, t: Math.round(performance.now()) }, x = this; window.__esp.push(reg);
    this.addEventListener('loadend', () => { reg.ms = Math.round(performance.now() - reg.t); reg.len = (x.responseText || '').length; });
  } } catch (e) {}
  return oS.apply(this, arguments);
};
```
- Nunca lee ni devuelve la llave (`args[0]`).
- El sufijo `·m` (quinto argumento, `medir`) es la huella del cliente de la F3a: si no aparece, pruebas está sirviendo código anterior.
- Un lote (F3b) sale como `lote[a+b]`. Para saber lo que trabajó el servidor en cada función sin leer los datos, basta sacar de la respuesta solo los números: en el `loadend`, `Array.from(x.responseText.matchAll(/\\*"ms\\*":\s*(\d+)/g)).map((m) => +m[1])`, y `/\\*"e\\*":/.test(x.responseText)` dice si alguna falló.
- **La pestaña de la herramienta tiene sesión en pruebas** (24/09/2026): en las pantallas con sesión salen también `prefsLeer`, `opEstadoSesion`… Solo se miran nombres y tiempos, nunca el contenido.
- Las llamadas que salen antes de instalarlo (la de `pubResultados`, al abrir) solo se ven en `performance`, sin nombre.

**Trampas al medir con la herramienta** (costaron varias tandas en la F3):
- **Su pestaña está oculta y no pinta fotogramas.** `AppRun.swr` con copia local espera al siguiente fotograma para revalidar, así que en esa pestaña el Portal no llama. Una captura de pantalla fuerza un fotograma y dispara de golpe lo pendiente. Consecuencias:
  - «0 llamadas» con copia local no distingue un código de otro;
  - la captura tiene que caer **después del DCL** (~4-5 s tras navegar); antes no sirve, porque `swr` aún no ha pedido su fotograma;
  - lo que discrimina la F3a del código anterior: tras esa captura, en la F3a siguen sin salir las `fetch*`, y en el anterior sí.
- **La carga sin copia local sí llama sola**: así se vio que las llamadas salían ~1 s después del `load`.
- Si la captura se cuelga («renderer frozen»), abrir una pestaña nueva por carga y cerrar la vieja.
- **El almacenamiento del iframe no se puede leer desde fuera:** Chrome lo aparta por sitio. Abrir el origen `n-…googleusercontent.com` directamente enseña otro `localStorage`, vacío. `AppRun.medidas()` lo lee el creador en su consola (con el marco `userHtmlFrame` elegido): `console.table(AppRun.medidas())`.
- **Alternar A/B en pruebas:** subir cada variante con `clasp push --force -P <config del scratchpad> -I <su .claspignore>` (el build anterior con `node scripts/build.js --fuente … --salida … --sin-clasp`). **Al terminar, volver a subir el código del repo** (`./scripts/publicar.sh`): si el turno cierra solo con documentación, el hook no corre clasp y pruebas se queda con la variante vieja.

**Comprobar lo que sirve Google** (cada vez que cambie el build o el cliente). La `/dev` de pruebas lleva el dominio: `https://script.google.com/a/macros/liverpool.com.mx/s/AKfycbxSjCvwk_f3pqcmIzyqlsPbPxlEHj91C6gjJdLXdLOS/dev` (sin `/a/macros/liverpool.com.mx` sale «No se encontró la página»). Desde su página superior, con `fetch` **en serie** de las 20 claves de `PAGES` y `PORTAL_PAGES`:
- que ninguna respuesta diga «formato incorrecto» y todas traigan `goog.script.init`;
- el peso de cada `userHtml`, antes y después;
- que cada `<script>` clásico de `userHtml` pase `new Function(bloque)`: es el código tal como lo dejó el quitacomentarios de Google, y el único lugar donde se ve si lo rompió;
- huellas: SHA-256 de cada bloque compilado de `build/` en local y de cada bloque servido con `crypto.subtle.digest`. Si coinciden, Google los sirve byte a byte y lo probado en el banco local es lo que llega (F2: 40 de 40; desde `2198c96`, todos: 380 bloques servidos, 84 de 84 huellas).
- En local, el modelo del quitacomentarios: `node pruebas/quitacomentarios_google.js build/*.html`. El build ya lo garantiza; sirve para lo que se suba sin pasar por él.

**Banco local** (`scripts/laboratorio/banco.mjs`): ensambla las 20 pantallas como `include()` con dos carpetas (p. ej. la fuente y `build/`) y las abre en Chrome headless con una sesión falsa y un `google.script.run` que responde siempre con fallo. Compara excepciones, avisos, llamadas al servidor, texto, estructura y píxeles, y mide el ruido cargando dos veces la primera carpeta. La salida (capturas, perfil) va a una carpeta del scratchpad, nunca al repo. Cubre la carga y los estados de error; los datos reales y los clics los ve el creador.
- **Punto ciego: fuerza el movimiento reducido.** Un revelado de GSAP roto no se ve ahí (así pasó la regresión del Monitor en la F3a). Para eso, `revelado-monitor.mjs` y `revelado-portal.mjs`: datos en la página contra datos por red, sin movimiento reducido. Pasarlos siempre que un cambio adelante o atrase la llegada de los datos, o toque una animación de entrada. Para las encuestas del Portal (F3a.2), `revelado-encuestas.mjs`: dice qué enseña cada encuesta (barras, botones, voto propio) y qué funciones llamó la página. Para lo que una pantalla escribe en la URL (F5), `url-pestanas.mjs`: lleva un `google.script.history` con pila de verdad y simula F5 volviendo a pedir la página con los parámetros de la entrada actual; hoy cubre `revision_cotizacion` y `cotizado_preview`, y su `stub` sirve de plantilla para otra pantalla. En esta PC, lanzarlos desde PowerShell con la ruta larga del scratchpad: desde Git Bash no llegó a conectar con Chrome (01/10/2026).

**Laboratorio:** `scripts/laboratorio/` y los proyectos LAB-mini y LAB-grande (ids en el doc 15 §7). Sus rutas apuntan a un scratchpad viejo y hay que ajustarlas.

---

## 5. Cifras de partida (para saber si una fase sirvió)

| Medida (Portal) | Hoy | Fuente |
|---|---|---|
| Primer byte, producción | 3.2-4.0 s | doc 15 §2 |
| Datos completos, producción | ≈13 s | doc 15 §2 |
| Llamada vacía con el código completo | ~1.9-2.0 s (n = 21) | doc 15 §3.2 |
| Llamada vacía en un proyecto vacío (piso de Google) | ~0.8 s (n = 14) | doc 15 §3.2 |
| Armado de la página en el servidor | 229 ms | doc 15 §3.2 |
