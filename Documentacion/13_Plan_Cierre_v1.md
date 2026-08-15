# 13 · Plan de cierre — versión 1.0

**Este es el plan vigente de todo el repositorio.** Sustituye al
[`12_Plan_de_Mejora.md`](12_Plan_de_Mejora.md), que queda cerrado como registro histórico:
lo que aquella auditoría dejó pendiente y sigue valiendo la pena está absorbido aquí (se
indica dónde); lo que no, queda descartado con motivo. Al terminar este plan, el sistema
pasa de v0.9 a **v1.0 de pruebas**, y comienza la etapa de pruebas e implementación del
portal con el equipo.

> **Cómo se usa este documento.** Antes de empezar una tarea, lee su fase completa —objetivo,
> tareas, criterios y riesgos—. Al terminarla, escribe en el §18 qué se hizo, qué se comprobó
> y qué se dejó fuera a propósito. La regla viene del plan anterior y se queda: un plan sin
> registro es una lista de buenas intenciones.

Fecha de elaboración: 14 de agosto de 2026. Derivado del recorrido completo del código
(los anclajes `archivo:línea` de este documento salen de esa lectura, no de memoria) y de la
definición de alcance dictada por el creador del proyecto.

---

## 1. Alcance: qué entra y qué NO entra

### Entra (los 16 frentes)

| # | Frente | Fase |
| --- | --- | --- |
| R1 | URL dinámica y deep-linking en todo el sitio, con acceso según sesión | F1 |
| R2 | Navegación: Cotizaciones por rol, separar Correo a clientes, Gestión depurada, hora en supervisión | F1 |
| R3 | Isla dinámica con notificaciones (contador de revisiones pendientes) | F2 |
| R4 | Revisión: política contraída + refactor de claridad de la pantalla | F3 |
| R5 | Loader animado GSAP del módulo «estado del servicio por fechas» | F4 |
| R6 | Publicaciones 2.0: principal/especiales, encuestas, responsable, ID compartible | F7 |
| R8 | Ayuda del modo rápido en Contenido del Portal | F12 |
| R9 | Operación: loaders por sección, recomendaciones, tablero embebido | F4 · F5 |
| R10 | Consola: grupos, difundir, métricas/monitoreo, bitácora por fechas, salud, ajustes | F9 |
| R11 | Loader temático de Atenciones (sin tocar nada más del módulo) | F4 |
| R12 | CCO global configurable (solo maestro) en todos los correos salientes | F9 |
| R13 | Validación contra liverpool.com.mx: investigar el 403, o botón de salida | F11 |
| R14 | Fusión de índices de los dos buscadores, presentaciones intactas | F6 |
| R15 | Pantalla «Acerca de» | F10 |
| R16 | Artículos: publicaciones largas con documentos incrustados y registro de lectura | F8 |
| R17 | Cierre: onboardings, permisos y disponibilidad por rol, pruebas | F12 · F13 |

### NO entra, por decisión explícita del creador (no volver a proponerlo sin motivo nuevo)

- **Atenciones no se toca** salvo el loader temático (R11). Descartados: la notificación o
  correo al agotarse el tiempo de una atención, y la función de reloj que revisara
  pendientes cada hora.
- **Contenido del Portal se queda como está** (solo recibe la ayuda del modo rápido, R8).
- **Editar/eliminar publicaciones desde el Portal**: propuesto y retirado en la misma
  definición. Los anuncios se siguen administrando desde su constructor.
- **La pantalla de inicio del asesor está bien como está** en contenido; solo la toca la
  fase F1 en navegación.

### NO entra, por decisión de ESTE plan (con motivo; el creador puede revertirlas)

- Del plan 12: los loaders en las 15 pantallas que no los usan (rendimiento decreciente
  sobre algo ya resuelto) y Gemini para redactar correos (más riesgo que ganancia) —
  descartes que aquel plan ya había razonado y este confirma.
- El «índice invertido para la búsqueda de folios» (12 §5) queda fuera de la v1.0: es
  optimización, no función, y la fusión de buscadores (F6) no depende de él.

### Absorbido del plan 12

| Pendiente del 12 | Dónde queda aquí |
| --- | --- |
| F1.2 `ViewPrefsPartial` donde falta | T13.3 (barrido final de consistencia) |
| F1.3 Fijar versión de Chart.js | T13.4 |
| Fase 2: instrumentación, `app_support`, accesibilidad en shell, esqueletos | T13.4 (lo que siga pendiente al llegar) |
| Fase 3: estado en la URL (3 de 19 pantallas) | **F1 entera** — ahora es el frente principal |
| Fase 3: recorrido guiado en Consola/Revisión/Operación/Atenciones | T12.2 |
| Fase 3: carga diferida de `app_comando` | T6.4 |
| Fase 4: M3 (cotización al shell) | Fuera de v1.0 — riesgo sobre el PDF del cliente; se retoma en v1.x |
| Fase 4: política de revisión que se mide sola | T5.2 comparte el patrón; la medición de la política queda para v1.x |

---

## 2. Cómo leer las fases

Cada fase trae: **objetivo**, **tareas numeradas con anclajes** (`archivo:línea` del estado
actual), **criterios de aceptación** (qué se comprueba antes de dar por hecha la fase),
**perfil profesional** (los roles y aptitudes que exige hacerla con calidad — si una persona
los reúne todos, la hace una persona), **esfuerzo** (S = horas, M = 1–3 días, L = una
semana, XL = varias semanas de trabajo efectivo) y **dependencias**.

El orden de las fases es de dependencia lógica, con dos reglas dictadas por el alcance:
lo rápido y desbloqueante primero, **lo más pesado hacia el final** (F8 Artículos es la obra
grande), y **los permisos y la disponibilidad por rol como cierre** (F13), cuando ya existe
todo lo que hay que repartir.

Reglas transversales que aplican a TODA fase (vienen del proyecto, no de este plan):

1. `PAGES` (`Code.gs`) y `AppUrl.PAGINAS` (`app_core.html`) son espejo; `PARAMS_VISTA`
   vive por triplicado (`Code.gs:124`, `app_core.html:745`, lista `PASAN` en
   `Index.html:4719`) y las tres listas se tocan juntas.
2. El permiso del cliente es cortesía; el candado es `secIdentidadConBloque_` en cada
   llamada de servidor.
3. Toda escritura invalida su caché; columnas por nombre, nunca por posición; filas
   celda a celda.
4. Animación solo `transform`/`opacity`, vía `GS()`/`conGsap()`, con degradación sin CDN y
   `prefers-reduced-motion` (skill `gsap-ventel` y documento 11).
5. Nombres de servidor nuevos con prefijo propio (`grp*`, `mon*`, `pub*`, `art*`…): los
   `.gs` comparten ámbito global.

### Vía rápida (se pueden hacer ya, en cualquier orden, sin esperar a su fase)

- **T1.6a** Hora además de fecha en la tabla de supervisión — una línea (`inicio_avanzado.html:1292`).
- **T3.1** Política de revisión contraída con carga perezosa.
- **T4.2** Loader temático de Atenciones.
- **T12.1** Iconito de ayuda del modo rápido.
- **T11.2** Botón «Abrir la página de Liverpool» mientras se resuelve la investigación T11.1.

---

## 3. FASE 1 · URL viva en todo el sitio y navegación por rol *(R1 + R2)* — esfuerzo L

**Objetivo.** Que la URL siempre diga dónde estás y qué estás viendo; que un enlace
compartido reproduzca ese estado exacto; que quien llega sin sesión pase por el login y
**aterrice en lo que le compartieron**, no en el inicio; y que la entrada «Cotizaciones»
lleve a cada quien a su inicio (asesor → inicio de cotizar; supervisión o mayor → panel
avanzado).

Hoy solo 4 de ~18 pantallas escriben estado en la URL (Index, consola, estado,
portal_contenido); el resto solo lee al arrancar. El login pierde todos los parámetros
(`app_core.html:1093` solo lleva la clave de página en `?next=`; `goNextOrHome`
`app_core.html:965-969` navega sin parámetros).

### Tareas

- **T1.1 — Helper central de estado en URL** en `app_core.html`, junto a `AppUrl`:
  - `AppUrl.reflejar(params, {apilar})` que envuelva `actualizar()` (`app_core.html:1009-1022`)
    con la convención única: **pestaña/sección apila historial, filtro/búsqueda reemplaza**
    (con debounce ≥300 ms, como ya hace Index con 350 ms en `Index.html:3413-3416`).
  - Corregir la **lectura viva**: `AppUrl.param()` (`app_core.html:975-978`) devuelve el
    valor del render aunque `actualizar()` ya haya cambiado la URL — cachear el último
    estado escrito. `estado.html:1506` ya arrastra este defecto (reescribe `inc` con el
    valor viejo).
  - Toda pantalla que apile DEBE registrar `AppUrl.alCambiarUrl` (hoy `portal_contenido`
    apila sin oyente y el botón atrás cambia la dirección sin cambiar la vista).
- **T1.2 — Write-back pantalla por pantalla**, con el helper de T1.1. Puntos de enganche ya
  localizados: `Promociones.html` `switchTab`(1753) y su buscador (pestaña + `?q` + deep-link
  `?promo=`, parámetro declarado en `PARAMS_VISTA` y hoy **sin ningún consumidor**);
  `estado.html` `abrirDetalle`(1239) escribe/borra `?inc`; `inicio.html` buscador (600-612);
  `inicio_avanzado.html` pestaña activa + `supSearch`(2493) + filtros de la tabla;
  `cotizacion.html` folio+`action=edit` al cargar/generar (1696-1701); `consulta_cotizacion`
  escribe `?folio` cuando llega por localStorage (821-826); `correoventel` folio/formato
  (155-156); `correo_cliente` `?tpl` al elegir plantilla (943); `anuncios`, `operacion` y
  `atenciones` su sección/filtros (atenciones ya cumple: es el modelo a seguir,
  `README.md` del proyecto, revisión de Atenciones §4). **Qué portal está abierto**
  (Index o Promociones) ya persiste por `?page=` — lo que esta tarea añade es que
  también persista **en qué punto** de ese portal estabas (pestaña, filtro, promoción),
  que es lo que hoy se pierde.
- **T1.3 — Estado profundo a través del login.** En `requireSession`
  (`app_core.html:1090-1095`) serializar `AppUrl.params()` junto al `next` (o en
  `sessionStorage`); en `goNextOrHome` (965-969) reponerlos. La lista blanca
  `PAGINAS_TRAS_LOGIN` (955-959) sigue validando la página — `next` **nunca** acepta URLs,
  solo claves; cada parámetro repuesto se sanea. Cerrar los dos huecos que mandan a login
  sin `next`: `inicio.html:124` y el buscador del Portal (`Index.html:4709-4710`).
- **T1.4 — Acceso según sesión, también en el servidor.** `consulta_cotizacion.html` no
  tiene guardia ninguna y `getQuoteDetails` (`Code.gs:867-874`) no exige identidad: **un
  enlace profundo con folio muestra la cotización completa sin sesión.** Añadir
  `requireSession('consulta_cotizacion')` en la pantalla y gate de servidor en la función.
  Antes de cerrar, verificar que la extensión de Chrome y el flujo de vista previa no
  dependan de ese acceso anónimo; si dependen, darles un camino con credencial propia.
  Las tres páginas públicas (portal, promociones, estado) **siguen públicas a propósito**.
- **T1.5 — «Cotizaciones» por rol.** El conmutador del shell apunta fijo a `dashboard`
  (`app_shell.html:294` y 346) aunque el resolutor por rol ya existe (`AppUrl.homePage()`,
  `app_core.html:938-942`, usado por login, Portal y buscador). Cambiar ambos puntos a
  `homePage()` y actualizar `data-precarga` (273/318) para calentar la página correcta.
  Con eso: asesor → `inicio.html` (que ya es el inicio de cotizar: Nueva cotización +
  Enviar cotización); supervisión o mayor → `inicio_avanzado` (todas las enviadas, su
  inicio y su apartado de Revisión, que ya existen como pestañas).
- **T1.6 — Fecha Y hora en supervisión.**
  - **a)** `inicio_avanzado.html:1292`: `toLocaleDateString` → añadir
    `{hour:'2-digit', minute:'2-digit'}` (el ISO ya trae la hora, `Code.gs:1176`; el CSV de
    la misma pantalla ya la exporta en 1338).
  - **b)** El `Timestamp` es del **último guardado**, no del envío (se pisa en `Code.gs:639`).
    Añadir columna `FechaEnvio` en la hoja Cotizaciones, escrita en `sendQuoteByEmail`
    donde ya se localiza la fila y se escribe el Estatus (`Correos.gs:721-739`), y mostrarla
    en el panel para las enviadas. Documentar la columna en el documento 04.
- **T1.7 — Separar «Enviar correo a clientes» de Cotizaciones** en la barra lateral: sacar
  el enlace del apartado Cotizaciones (`app_shell.html:363`) a un apartado propio (el
  conmutador de áreas ya lo trata como área aparte, `app_shell.html:295`). `apartado()`
  (322-328) colapsa rótulos sin enlaces, así que un apartado de un solo ítem es seguro.
- **T1.8 — Gestión solo gestión.** El apartado Gestión ya se arma del catálogo `GESTION`
  filtrado por bloques (`app_core.html:1841-1870`), que hoy cumple razonablemente el
  requisito. La tarea es la depuración: revisar el catálogo entrada por entrada tras T1.7
  (nada ajeno a gestión se queda; nada de gestión queda fuera), y dejar escrito que toda
  pantalla nueva de este plan entra al menú **por ese catálogo** — las fases posteriores
  lo alimentan y T13.1 lo verifica al consolidar bloques.

### Criterios de aceptación

1. En cada pantalla — incluidas las dos públicas del Portal (Index y Promociones):
   cambiar pestaña/filtro/elemento → la URL cambia; F5 → se restaura el mismo estado;
   botón atrás → estado anterior (no solo la dirección).
2. Copiar la URL en cualquier estado, abrirla en ventana privada → login → **aterrizas en
   ese estado exacto**.
3. `?folio=` sin sesión ya no muestra datos de cliente; con sesión y bloque, sí.
4. Supervisor pulsa «Cotizaciones» → panel avanzado; asesor → inicio de cotizar. Las tres
   puertas (login, Portal, shell) se comportan igual.
5. La tabla de supervisión muestra `dd/mm/aaaa HH:mm`; una cotización editada después de
   enviada **no** cambia su fecha de envío.

### Perfil profesional

Ingeniería frontend senior de JavaScript sin framework (History API dentro del sandbox de
Apps Script: `google.script.history/url`), con criterio de arquitectura de información y
navegación; ingeniería backend Apps Script para T1.4/T1.6b; **revisión de seguridad web**
para T1.3/T1.4 (redirectores abiertos, saneo de parámetros, control de acceso por llamada).

**Dependencias:** ninguna. Es la fase cimiento: F2, F7 y F8 usan sus deep-links.
**Riesgos mayores:** `history.replaceState` del iframe no sirve (solo `google.script.history`);
las tres listas espejo de parámetros; el guard de `next` es superficie de seguridad.

---

## 4. FASE 2 · La isla dinámica notifica *(R3)* — esfuerzo M

**Objetivo.** Que la pastilla de estado (`app_operacion.html`, presente en ~19 pantallas)
gane un segundo óvalo con el número de cotizaciones pendientes de revisar —solo para quien
revisa—, que al pasar el mouse se expanda **hacia el lado y hacia arriba** mostrando dos
filas (arriba: «1 revisión» + relojito; abajo: «Operando con normalidad»), que cada fila
navegue a su pantalla, y que el mecanismo quede **genérico** para futuras notificaciones.

### Tareas

- **T2.1 — Conteo en servidor.** `revContarPendientes(email)` junto a `revListaPendientes`
  (`Revision.gs:290-325`), reutilizando `revEsPendiente_` (343-351) para que el número de
  la isla y la cola digan lo mismo, con gate `secIdentidadConBloque_(email,'revisar')`.
  Entrega: **dentro de `opEstadoSesion`** (`Operacion.gs:1309-1347`), añadido **fuera de la
  parte cacheada compartida** (mismo patrón que `salida.puedeGestionar`, línea 1339) y solo
  si la identidad tiene el bloque — así viaja en la llamada que la isla ya hace cada 120 s
  y no se añade ni un viaje. Con caché de servidor propia (patrón `opCacheado_`) e
  invalidación al guardar revisión/cotización (`cotInvalidarCache_` ya se llama ahí).
  **Nunca en la rama pública** (`opEstadoPublico`).
- **T2.2 — Registro de fuentes de notificación.** Generalizar el patrón
  `AppGuardado.delegarIndicador` (`app_guardado.html:669-673`) y la máquina de estados
  `isla` (`app_operacion.html:784-951`) hacia un registro con prioridades: guardado en
  curso > notificaciones > estado. Definir quién posee cada píxel: hoy `pintarPastilla()`
  reconstruye `innerHTML` completo (955-1006) y `entrarEnIsla/salirDeIsla` restauran
  clase y contenido — el óvalo nuevo debe **sobrevivir a ese ciclo**.
- **T2.3 — UI y animación.** Segundo óvalo tipo pastilla con el número (plantilla visual:
  el `.op-cont` existente, CSS 240-246); hover: GSAP expande ancho (como hoy, 735-748) y
  **alto** — una sola dueña por propiedad animada (regla ya escrita en 201-211: hoy el
  ancho ya tiene dos dueños, no sumar un tercero); el número se desliza del borde derecho
  a la fila superior junto a un icono de relojito (de `app_icons`, lienzo 24×24 trazo 1.6).
  Click por zonas: fila revisión → `AppUrl.go('inicio_avanzado', {ancla:'pend-lista'})`;
  fila operación → panel/tablero como hoy (1234-1240). Al quitar el mouse, vuelve al
  estado compacto. Fallbacks obligatorios: CSS puro sin GSAP, versión estática con
  `prefers-reduced-motion`, y **gesto táctil** (un tap expande, segundo tap navega) porque
  el móvil no tiene hover (CSS 519-531).
- **T2.4 — Visibilidad.** El óvalo solo se pinta con `AppSession.canStrict('revisar')`
  (`app_core.html:123-127`) — `can()` es permisivo con sesiones viejas y enseñaría el
  contador a quien no debe; el candado real sigue siendo el gate del servidor de T2.1.

### Criterios de aceptación

1. Supervisor con 3 pendientes ve «3» en el óvalo en cualquier pantalla; aprueba una y el
   número baja en la siguiente revalidación (sin recargar).
2. Asesor sin bloque `revisar` jamás ve el óvalo, y su payload de `opEstadoSesion` no trae
   el conteo.
3. Guardar algo en segundo plano (la isla prestada al guardado) y volver: el óvalo
   reaparece intacto.
4. Con `prefers-reduced-motion` todo funciona sin animación; en móvil se llega a ambos
   destinos por tap.

### Perfil profesional

Ingeniería frontend con dominio real de GSAP (timelines, coordinación de ejes, MorphSVG ya
presente en la pastilla) y microinteracciones; diseño de interacción para los estados de la
pastilla; ingeniería backend Apps Script con cuidado de caché compartida (la parte cacheada
de `opEstadoSesion` se comparte entre usuarios: un dato por-permiso ahí sería una fuga);
accesibilidad (táctil, reduced motion, tamaños de toque).

**Dependencias:** ninguna dura — el mecanismo de anclas que usa T2.3 **ya existe**
(`?ancla=` en `PARAMS_VISTA` + `AppUrl.irAncla`, `app_core.html:1046-1063`, disparado al
cargar en 2074-2077); solo hay que dar `id="pend-lista"` a la cola en `inicio_avanzado`.
F1 conviene antes para heredar su convención de URL, pero no bloquea.

---

## 5. FASE 3 · Revisión: política contraída y pantalla más clara *(R4)* — esfuerzo M

**Objetivo.** La política de revisión aparece **contraída** y solo consulta el servidor al
abrirla; la pantalla de revisión enseña lo mismo que hoy pero con jerarquía visual que se
lea de un vistazo.

### Tareas

- **T3.1 — Política contraída con carga perezosa.** En `inicio_avanzado.html` la sección
  `#pol-seccion` (474-497) está siempre expandida y `polCargar()` se dispara al inicializar
  la pantalla (2065) aunque nadie mire la sección. Convertir la cabecera `.pol-head` en
  botón con `aria-expanded`/`aria-controls` reutilizando el patrón ya probado de la propia
  app (`revision_cotizacion.html` `.rev-toggle`/`.rev-panel`, CSS 105-118, con bandera de
  primera apertura como `prepararSheet` 2119-2125). Al expandir por primera vez →
  `polCargar()` (ya es re-entrante: lo usa `#pol-recargar`). Cuidar el repintado con el
  cuerpo plegado: el guardado optimista por `AppGuardado` (clave `politica-revision`,
  2028-2056) puede repintar en cualquier momento, y el resumen de cabecera necesita
  fuente sin abrir el editor.
- **T3.2 — Refactor de claridad de `revision_cotizacion.html`.** Mismo contenido, mejor
  lectura. Reglas del refactor: **conservar todos los `id`** (todo el JS referencia ids
  literales: `rev-folio`, `rev-items`, `rev-gen-*`, `rev-prog-*`, `rev-viewer`…; reordenar
  jerarquía es seguro, renombrar no), conservar los overrides de `[data-theme="carbon"]`,
  los patrones ARIA y `prefers-reduced-motion`. Dirección del rediseño: cabecera con lo
  decisivo (folio, estatus, score) siempre visible; agrupar «Datos de la cotización» en
  bloques escaneables con las marcas de veredicto alineadas; riel de decisión sticky con
  el avance y los botones; tarjetas secundarias (Sheets CCL) colapsadas como ya están.
  Entregar antes una maqueta (puede ser HTML estático con datos de muestra — la pantalla
  ya tiene modo de vista de diseño) y validarla con quien revisa a diario.

### Criterios de aceptación

1. Abrir el panel avanzado con bloque de política: **cero** llamadas a
   `getPoliticaRevision` hasta expandir la sección; al expandir, carga y edita igual que hoy.
2. Guardar la política con la sección plegada no rompe el repintado ni el resumen.
3. En la pantalla de revisión: mismo dato disponible que hoy (checklist, score, artículos,
   visor, decisión), verificable punto por punto contra una captura del antes; el flujo
   aprobar/rechazar intacto (`guardarRevisionCotizacion` no se toca).

### Perfil profesional

Diseño UI/UX con criterio de jerarquía tipográfica y densidad de información (pantalla de
trabajo experta, no marketing); ingeniería frontend CSS (grid, sticky, tokens del tema);
QA manual con el flujo real de revisión.

**Dependencias:** ninguna. T3.1 es vía rápida.

---

## 6. FASE 4 · Loaders con oficio *(R5 + R9a + R11)* — esfuerzo M

**Objetivo.** Tres esperas que hoy son genéricas pasan a contar qué está pasando: el
historial de estado con una escena de «análisis de reportes», Atenciones con un «asesor
telefónico», y la pantalla de Operación con esqueletos por sección.

### Tareas

- **T4.1 — Escena «verificando reportes».** Registrar un tema nuevo en `SCENES` de
  `app_loaders.html` (registro desde 219; textos por tema 934-941): una persona ante su
  monitor revisando gráficas/reportes, dibujada con los SVG de la casa (24×24, trazo 1.6,
  `currentColor`), animada con GSAP (timeline: barras que suben, hoja que pasa, gesto de
  verificación). Engancharla en `app_estado_historial.html` sustituyendo el esqueleto
  estático (`esqueleto()` 552-565 / `esperar()` 567-584), conservando `cuerpoEspera()`
  (537-544, la cabecera de rangos sobrevive al cambio de rango) y la guarda de respuestas
  cruzadas (595-609). **El partial es compartido**: la escena aparecerá también en el
  tablero público (`estado.html:704`) — diseñarla para ambos contextos. Tope de seguridad
  de 45 s como todo `VentelFX`.
- **T4.2 — Escena «asesor telefónico»** para Atenciones. Punto exacto:
  `app_atenciones.html:1153` (`Cargando tus atenciones…` con `v-spinner`). Mismo registro
  en `SCENES` (persona con diadema ante su equipo, información que va llegando). Es el
  **único** cambio permitido en el módulo de Atenciones.
- **T4.3 — Esqueletos por sección en Operación.** `operacion.html` pinta cuatro secciones
  de golpe en un único `#opp-contenido` (200) con un solo esqueleto global (fx en la
  llamada, 301). Partir el contenedor en cuatro (`#opp-esperan`, `#opp-vivas`,
  `#opp-sueltos`, `#opp-cerradas`), montar `VentelFX.skeleton` por contenedor siguiendo el
  patrón ya usado para KPIs (`skKpis`, 295, con `done()` en `onData` **y** `onError`), y
  reescribir `pintar()` (327-374) para escribir cada sección en su contenedor. Respetar el
  contrato swr+fx: si hay caché, `swr` pinta primero y **no** se monta esqueleto
  (`app_core.html:1742-1748`); quitar el fx global de la llamada para no duplicar.

### Criterios de aceptación

1. Primera carga sin caché: cada espera muestra su escena/esqueleto; con caché: se pinta
   lo guardado al instante, sin esqueleto ni parpadeo.
2. Sin CDN de GSAP y con `prefers-reduced-motion`: versión quieta y legible, nunca un
   hueco.
3. Ninguna escena queda montada más de 45 s si el servidor no contesta.

### Perfil profesional

Motion design con GSAP (timelines orquestadas, stagger, degradación) e ilustración SVG
con el sistema de iconos de la casa; ingeniería frontend para el contrato swr+fx.

**Dependencias:** ninguna. T4.2 es vía rápida.

---

## 7. FASE 5 · Operación inteligente *(R9b + R9c)* — esfuerzo M

**Objetivo.** La pantalla de Operación recomienda con los datos que ya tiene, y el tablero
público se consulta **sin salir de la pantalla**.

### Tareas

- **T5.1 — Tablero embebido.** El botón «Ver tablero público» navega
  (`operacion.html:860` → `AppUrl.go('estado')`). Cambiarlo a un overlay/panel en la misma
  pantalla que reutilice los datos ya presentes (`AppOperacion.estado()/alCambiar`,
  `app_operacion.html:1891-1916`) y monte el historial con `AppEstadoHistorial.montar`
  (montable en cualquier host, como ya hace `inicio_avanzado`). **No duplicar el markup de
  `estado.html`**: extraer a partial lo que se reutilice, o pintar una vista compacta
  propia con los mismos datos — dos tableros que divergen es justo lo que el partial de
  historial evita. La ruta `estado` **se conserva** (los webhooks de Chat generan
  `?page=estado&inc=`, `Operacion.gs:2238-2246`).
- **T5.2 — Recomendaciones con algoritmos locales.** Nueva función junto a `opPanel`
  (`Operacion.gs`, tras 1953), envuelta en `opCacheado_` (731), que cruce lo que ya existe:
  series por hora/día/sistema (`opCalcularHistorial_` 964-1119, `opCalcularHistorialHoras_`
  1132-1274), similitud Dice/Levenshtein (238-359) para reincidencia del mismo submotivo,
  y usos por submotivo del catálogo (523-527). Recomendaciones de arranque: franja horaria
  con más reportes recurrentes por sistema; sistema más problemático del periodo;
  submotivo reincidente (mismo problema que vuelve); reportes sueltos que se parecen a
  una incidencia abierta (sugerir agruparlos — `opSugerirExistente_` ya existe para el
  formulario). Todo local, nada sale del proyecto. UI: sección nueva entre `#opp-kpis` y
  el contenido, con su propia clave swr y su esqueleto (T4.3). Aprovechar de paso para
  envolver `opPanel` en `opCacheado_` (hoy relee las tres hojas en cada carga: es parte
  de la lentitud que motivó los loaders).
- **T5.3 — Exporte de incidencias.** Las descargas por tipo/hora/categoría/plataforma que
  el alcance da por buenas se apoyan en el único patrón probado: CSV generado en cliente
  (Blob + enlace, como `inicio_avanzado.html:1324-1364`). Verificar que cubren tipo, hora,
  categoría y plataforma; añadir la que falte como columnas del mismo CSV.

### Criterios de aceptación

1. «Ver tablero público» abre el tablero encima de Operación en <1 s con datos ya cargados;
   cerrar devuelve al mismo scroll; el deep-link `?page=estado&inc=` externo sigue vivo.
2. Las recomendaciones citan su evidencia («14 reportes de Connect entre 9 y 11 h los
   lunes») y no repiten lecturas de hoja (verificable por tiempos: la sección no encarece
   la carga del panel).

### Perfil profesional

Ingeniería backend con gusto por análisis de datos (agregación temporal, similitud de
cadenas, umbrales) y redacción de recomendaciones legibles en lenguaje de negocio;
ingeniería frontend para el overlay.

**Dependencias:** T4.3 (contenedores por sección).

---

## 8. FASE 6 · Un solo motor de búsqueda, dos vestidos *(R14)* — esfuerzo L

**Objetivo.** Fusionar los **índices y el motor** de los dos buscadores para que ambos
encuentren todo lo que hoy encuentra cualquiera de los dos — conservando **intactas** las
dos presentaciones: el panel glasmórfico de `app_comando` con su FLIP, y el dropdown del
Portal con su animación.

La dirección ya estaba decidida en el plan 12 (§1): migrar el Portal a `AppBuscar`, no al
revés. `AppBuscar` es el motor superior (Damerau con transposición, forma compacta de
folios, frontera letra/dígito, siglas, sinónimos ampliables, resaltado NFD fiel, espejo en
servidor `Code.gs:1269-1315`).

### Tareas

- **T6.1 — El Portal adopta `AppBuscar`.** Incluir `app_buscar` en `Index.html`
  (includes 1373-1405; es autónomo, ya corre fuera del shell en `Promociones.html:1057`).
  Sustituir el motor propio: `buildQuery`→`AppBuscar.consulta`, `scoreMatch`→
  `AppBuscar.puntua` con pesos por campo y **`exigirTodas:false`** (el default descartaría
  parciales que hoy se muestran penalizadas), `hilite`→`AppBuscar.resalta`; borrar
  `levLE/fuzzyHit/norm` (5263-5377). Pasar `SEARCH_SYNONYMS` (5266-5306) por
  `AppBuscar.agregaSinonimos` como ya hace Promociones. **Sin tocar el render**: el armado
  de HTML por grupo y su animación (4900-4993) solo consumen resultados. Recalibrar el
  orden relativo de grupos (las escalas de puntaje cambian ~1-30 → ~48-100) y conservar
  las reglas dependientes del orden (re-rank de promociones 4878-4882, `sd-top`).
- **T6.2 — Los índices exclusivos del Portal llegan al buscador general.** Extraer a un
  partial común (patrón `app_buscar`) los cuatro índices hardcodeados en `Index.html`:
  Formas de Pago (`FP_INDEX` 2884-2893), Devoluciones SAP (`DEVSAP_INDEX` 2909-2919),
  Tienda/CR con su ranking numérico (2923-2973 + `scoreTiendaCR` 4567-4589 — esa rama por
  número exacto/prefijo es «la mejor versión» y se conserva), y navegación granular a
  secciones del Portal (`SECTIONS_NAV` 2865-2881). `app_comando` los indexa en su
  Directorio (`calcula()`/749-885); un resultado de estos desde otra pantalla navega con
  `portal?sec=&q=&item=` (mecanismo ya existente en `ejecuta()`, 1745-1754).
- **T6.3 — Desduplicar el catálogo de funciones.** `CATALOGO` (app_comando:321-420) y
  `APP_ACTIONS` (Index:4614-4665) son la misma lista dos veces con divergencias. Queda la
  versión de `app_comando` (más completa: apartados internos, memoria de uso), extraída a
  fuente común, **parametrizando la política sin sesión por superficie** (el Portal ofrece
  todo→login; el cmdk solo portal/estado — es decisión deliberada de UX, no se pierde).
  Unificar también el armador del índice de trazabilidad (hoy dos:
  `indexaTraz` 936-956 vs `trazReconstruirIndices` 6241-6259) y el parser de ámbitos
  aceptando las dos sintaxis (`cot:` con dos puntos y primera palabra sin ellos).
- **T6.4 — Peso de página.** Del plan 12: carga diferida de `app_comando` (~300 KB en 16
  pantallas). Al tocar toda esta zona es el momento: diferir el panel hasta el primer
  Ctrl+K/`/` sin perder el atajo.

### Criterios de aceptación

1. Batería de búsquedas de paridad (mínimo 30 casos reales: folios con typo
   «cotizaicon», «lvp2024», «cr 96», «cc», plantillas, procesos, tiendas, formas de pago,
   devoluciones SAP): **cada término encuentra en ambos buscadores lo mejor de lo que
   cualquiera de los dos encontraba antes.**
2. Visual: grabación antes/después de ambos buscadores — indistinguibles en apertura,
   animación y estilo.
3. El espejo del servidor (`normalizeText_`/`searchTokens_`) sigue diciendo lo mismo que el
   cliente (sus casos de prueba pasan), y las claves de caché contrato
   (`quotes-`/`pendientes-`/`sup-quotes-`) conservan su forma de arreglo.
4. Los kw largos de trazabilidad (hasta 240 palabras, sobre el umbral de memoización de
   160 caracteres de `preparaCampo`) no degradan el tecleo: precalcular campos preparados
   o acortar los kw, y medirlo.

### Perfil profesional

Ingeniería frontend senior con experiencia en motores de búsqueda en cliente
(tokenización, fuzzy, ranking, memoización, performance por pulsación); disciplina de
refactor sin regresión visual; QA con batería de paridad.

**Dependencias:** ninguna dura; conviene después de F1 para heredar deep-links del Portal.

---

## 9. FASE 7 · Publicaciones 2.0 *(R6)* — esfuerzo L

**Objetivo.** Cada publicación del Portal tiene identidad (ID estable y responsable
visible), jerarquía (una **principal**, las demás **especiales**), un enlace compartible
que la abre en grande, y la tarjeta puede ser una **encuesta** con resultados en gráfica.

### Tareas

- **T7.1 — Saneo del modelo.** IDs persistentes para TODAS las filas: hoy una fila creada
  a mano recibe `anc-row-`+i **posicional** (cambia al insertar filas — un enlace roto en
  silencio) y los avisos legacy `avi-`+i igual. Asegurar IDs al leer (patrón
  `pcAsegurarIds_` de `PortalContenido.gs:464-513`). Guardar también el **nombre legible**
  del autor (`publicarAnuncio` ya escribe el email `gate.email`, `Portal.gs:592`; el
  `gate.nombre` hoy se descarta) y devolver autor/creado en las dos lecturas
  (`portalAnunciosCols_` 185-196 y `getAnunciosAdmin` 634-643, que hoy los omiten).
  En el Portal se pinta el **nombre**, no el correo.
- **T7.2 — Principal y especiales + responsable.** Lo pedido dice «la tarjeta queda como
  publicación principal y las otras como especiales». **Interpretación elegida, declarada
  aquí:** UNA publicación en formato tarjeta —la primera por columna Orden— se pinta como
  **principal** (tamaño destacado en la rejilla de `renderAnuncios`,
  `Index.html:3735-3790`); todas las demás publicaciones (tarjetas restantes, banners,
  destacados) quedan como **especiales**. Es la lectura posicional sobre el mecanismo de
  orden existente (columna Orden + regla «solo un modal»), elegida para no inventar un
  segundo criterio de prioridad que choque con el que ya hay; **validar la maqueta con el
  creador antes de cerrar la tarea** por si su intención era jerarquía por formato (todo
  el formato tarjeta = principal). *(Validado el 15/08/2026: el creador eligió esta misma
  interpretación entre las tres que se le enseñaron. Ver el §18.)* El responsable va pequeño en la esquina inferior
  derecha de cada plantilla (tarjeta 3771-3781, destacado 3745-3753, modal 3799-3808;
  CSS junto a `.anc-card` 879-894).
- **T7.3 — ID compartible.** Parámetro nuevo `pub` en las tres listas espejo
  (`Code.gs:124`, `app_core.html:745`, `PASAN` Index:4719). Al abrir
  `?page=portal&pub=anc-xxx`, `restore()` (Index:3310-3362) llama a `expandTarjeta`
  (3831-3852: **ya es** el modal expandido por ID) y la URL se escribe al expandir/cerrar
  (F1). Para publicaciones fuera de `store.anuncios` (expiradas/programadas): endpoint
  `pubPorId(id)` en `Portal.gs` que devuelva UNA publicación con sus reglas de visibilidad;
  el modal indica si ya no está vigente. Botón «Copiar enlace» en el modal. La pantalla
  aparte «publicación» **no** se construye: el modal expandido sobre el Portal cumple el
  requisito con una pantalla menos que mantener (decisión reversible en v1.x si el modal
  queda corto).
- **T7.4 — Encuestas.** Subtipo de la tarjeta: en el constructor (`anuncios.html`), al
  elegir tarjeta aparece la opción «encuesta» con: pregunta, n opciones (tope 6 —
  **decisión de este plan** para que la gráfica quepa en la tarjeta y en móvil;
  ampliable si hace falta), tiempo estimado y cierre (fecha/duración). Cabe en `Datos (JSON)` sin tocar el esquema de columnas
  (`buildDatos` 819-837 / `cargarEnForm` 953-991 se extienden simétricamente, con vista
  previa). **Los votos NO van en la fila del anuncio** (`publicarAnuncio` reescribe la
  fila entera con `setValues`, `Portal.gs:596` — editar machacaría votos): hoja nueva
  `Votos` (una fila por voto: idPublicación, correo, opción, fecha), escritura con
  `LockService` y rate-limit clonando `reportBrokenLink` (758-788), dedupe por correo de
  sesión (un voto por persona, cambiable hasta el cierre). Lectura de resultados con
  llamada propia de TTL corto — **fuera** de `fetchToolsData` y su doble caché (script
  10 min + localStorage 7 días), o la gráfica mentiría. Resultados: barras simples con los
  tokens del tema (sin librerías nuevas), visibles tras votar o al cierre.
- **T7.5 — Llenado asistido del constructor.** Sin servicios externos: plantillas de
  arranque por tipo (aviso de mantenimiento, promoción, comunicado, encuesta) que
  precargan tono/estructura; autocompletado de vigencia («esta semana», «hasta el
  domingo»); duplicar-y-editar ya existe (953-1011) — promoverlo en la UI; avisos de
  calidad en vivo (imagen faltante, CTA sin URL, vigencia vencida) reutilizando la
  validación existente.

### Criterios de aceptación

1. Compartir el enlace de una publicación → login si hace falta (F1) → se abre expandida.
   Con una expirada, lo dice con esas palabras.
2. Insertar una fila a mano en el Sheet no cambia el ID de ninguna publicación existente.
3. Dos personas votando a la vez no pierden votos (prueba de concurrencia); editar el
   anuncio después no borra resultados; nadie vota dos veces con la misma sesión.
4. El responsable se ve en cada formato, con nombre, discreto.
5. Clientes con la caché vieja del Portal (7 días) no se rompen: el formato encuesta
   degrada a tarjeta informativa si el cliente no lo entiende (compat como
   `Index.html:3576-3578`).

### Perfil profesional

Ingeniería backend Apps Script con cuidado de concurrencia (locks, dedupe, rate-limit) y
diseño de modelo sobre Sheets; ingeniería frontend UI; diseño visual para la jerarquía de
tarjetas y la gráfica con tokens; redacción UX en español para plantillas y estados.

**Dependencias:** F1 (parámetro `pub`, write-back de URL).

---

## 10. FASE 8 · Artículos *(R16)* — esfuerzo XL (la obra grande; por eso va aquí y no antes)

**Objetivo.** Publicaciones largas de verdad: texto estructurado con imágenes, tablas e
hipervínculos, documentos de Google (Slides/Docs) incrustados a partir de un enlace pegado,
firma de autores, registro de quién lo ha visto, creación con la misma interfaz de
lectura, y presencia en el buscador general y en el Index.

### Tareas

- **T8.1 — Modelo y permiso.** Hoja nueva `Articulos` (ID estable, título, resumen,
  contenido, estado borrador/publicado, autores, creado, editado) + hoja `ArticulosVistas`
  (idArtículo, correo, primeraVez, veces). Contenido en **JSON de bloques versionado**
  (`{v:1, bloques:[{tipo:'texto'|'imagen'|'tabla'|'documento'|'separador', …}]}`), nunca
  HTML crudo del editor: es lo que permite pintarlo seguro y evolucionarlo. Bloque nuevo
  de permiso `articulos` («Publicar artículos», grupo Supervisión, incluido en el rol
  avanzado por defecto — receta de F13.1). Gate de escritura por bloque; **lectura para
  cualquier sesión**.
- **T8.2 — Render seguro.** Los artículos los leen todos: el pintado **escapa todo texto**
  y solo construye DOM desde el JSON de bloques (nada de `innerHTML` con contenido de
  terceros). Hipervínculos: texto visible + URL válida (`https:` solamente), con el saneo
  de URL ya inventado en `revUrlArticuloSegura_` como referencia. Imágenes: pegar/adjuntar
  → `subirImagenAnuncio` (`Portal.gs:722-745`, carpeta Drive ya existente) y referencia
  por URL de Drive. Tablas: pegado desde Sheets/Excel → parser TSV que **ya existe**
  (`parsearPegado`, `portal_contenido.html:1292`) reutilizado para generar el bloque tabla.
- **T8.3 — Documentos incrustados.** Al pegar un enlace de Google Slides/Docs (o Sheets),
  absorber el ID con un extractor de patrones de URL de Google, validar que la sesión
  puede verlo, y pintar el visor embebido (`/preview`/`/embed` — el patrón iframe de
  Google ya se usa en la revisión para la hoja CCL) con botón de pantalla completa.
  Varios documentos por artículo, ordenables (el reordenado FLIP del constructor de
  anuncios, `anuncios.html:1056-1232`, es el precedente). Aviso claro cuando el documento
  no es visible para el lector (permisos de Drive los administra Drive, no el Portal).
- **T8.4 — Lector y editor, una sola interfaz.** Pantalla nueva `articulo`
  (registrada en `PAGES` + `AppUrl.PAGINAS`, con `?art=<id>` en las tres listas espejo):
  el lector pinta los bloques; con el bloque de permiso `articulos` aparece «Editar» y la
  misma vista se vuelve editable (escribir, pegar, adjuntar, insertar documento, mover
  bloques). Guardado por `AppGuardado` con motivo escrito de reintentos. Firma al pie:
  autores y último editor (de la hoja, no tecleada). Al abrir como lector se registra la
  vista (idempotente por correo) y quien tiene el permiso puede ver la lista de lectores.
- **T8.5 — Distribución.** Los artículos entran al índice del buscador general (F6) como
  grupo propio con título/resumen; en el Index, sección o carril «Artículos» con los
  recientes, y «Crear artículo» visible solo con el permiso. Las publicaciones actuales
  del Portal siguen exactamente igual (F7 no cambia con F8).

### Criterios de aceptación

1. Un supervisor crea un artículo con texto, dos imágenes pegadas, una tabla pegada de
   Sheets, una presentación y un Docs incrustados, hipervínculos con texto — y un asesor
   lo lee, lo pone en pantalla completa y queda registrado como lector.
2. Contenido hostil (script en el texto, URL `javascript:`) queda inerte: revisión de
   seguridad del render con casos escritos.
3. El artículo aparece en el buscador general por título y contenido, y su URL compartida
   pasa por login y aterriza en el artículo (F1).
4. Un artículo con documento que el lector no puede ver lo dice con esas palabras (no un
   recuadro en blanco: la lección del iframe de Liverpool, `Revision.gs:790-810`).

### Perfil profesional

Ingeniería frontend senior (editor por bloques sin librerías: contenteditable acotado o
formulario por bloques — decisión de diseño técnico documentada antes de escribir);
**seguridad web** (XSS, saneo de URLs, render de contenido de terceros); ingeniería
backend Apps Script (modelo, locks, vistas); diseño UI de lectura (tipografía larga);
QA con banco de contenido hostil.

**Dependencias:** F1 (deep-links y sesión), F6 (indexación), T7.1 (patrones de ID/autor).

---

## 11. FASE 9 · Consola: grupos, difusión, métricas y ajustes *(R10 + R12)* — esfuerzo XL

**Objetivo.** La consola cierra el círculo administrativo: personas agrupadas y
alcanzables por correo masivo bien hecho, una sección de métricas que responde «¿cuánto y
quién?», bitácora exportable, salud al día, ajustes centralizados y el CCO global.

### Tareas

- **T9.1 — Grupos de usuarios.** Modelo nuevo (hoja `Grupos` + membresías; patrón de hoja
  administrada `consolaBitacoraHoja_`, `Consola.gs:122-137`). El grupo **«Ventel» es
  virtual**: todos los registrados, servido desde `secIndiceRegistros_`
  (`Seguridad.gs:126-180`) sin mantenimiento manual. UI en la pestaña Roles
  (`consola.html:481-521`). Gate de edición por **NIVEL**, no por bloque:
  `permNivelUsuario_ >= 2` (supervisor y superior) — el bloque `sup_equipo` puede tenerlo
  un asesor por excepción y no debe bastar. Toda acción se apunta en la bitácora
  (`consolaBitacoraApuntar_`).
- **T9.2 — Copiar correos.** Botón en el grupo: `navigator.clipboard.writeText` con los
  correos separados por coma — el formato que Gmail pega directo en Para/CCO. La lista ya
  está en el cliente (`D.miembros`, `consola.html:732-743`).
- **T9.3 — Difundir información.** Composición de correo interno: asunto y cuerpo de
  **redacción libre «casi como en Gmail»** —párrafos con negritas/listas, imágenes en
  línea, algún botón— con vista previa y envío al grupo elegido. **Lectura elegida del
  «editor tipo Gmail», declarada aquí:** la libertad es del cuerpo (contenteditable
  acotado a ese repertorio); el marco —logo, cabecera, pie— lo pone el sistema y no se
  edita, para que toda difusión salga formal sin depender del pulso de quien redacta.
  La plantilla base **ya existe** y es la correcta: `cuentasPlantillaCorreo_` + helpers
  `cuentasMailP_`/`cuentasMailDatos_`/`cuentasMailBoton_`/`cuentasMailNota_`
  (`Cuentas.gs:886-976, 1146` — logo, profesional, sobria; distinta de la rosa de
  clientes, a propósito). Envío por
  `cuentasEnviarCorreo_` (983) en CCO a los miembros (no exponer la lista en Para),
  imágenes con el patrón de adjuntos de `CorreoCliente.gs:81-90`, registro en
  `MetricasCorreos` (tipo `difusion`) y en la bitácora. Mismo gate de nivel que T9.1.
  Cuota diaria de correo visible antes de enviar (ya está en `resumen.cuotaCorreo`).
- **T9.4 — Sección «Métricas» con subsección «Monitoreo».** Fila nueva en
  `CONSOLA_SECCIONES` (`Consola.gs:237-245`) + pestaña en `consola.html` + **bloque nuevo
  `metricas`** (F13.1) con recorte: supervisor ve lo prudente (su alcance jerárquico, como
  ya recortan `consolaBitacoraLeer_`/`consolaListaMiembros_`), maestro ve todo. Contenido:
  - **Cotizaciones**: conteos y lista filtrable por asesor (AsesorCorreo), correo del
    cliente, teléfono (Numero), rango de fechas y horas — columnas ya existentes
    (`Code.gs:421-437`). Carga **bajo demanda**, nunca dentro de `consolaPanorama`
    (leer Cotizaciones entera es lo más caro de la app; el panorama ya carga en una
    llamada con caché de 15 min y no debe engordar).
  - **Correos**: sobre la hoja `MetricasCorreos` (15 columnas: ya guarda Asunto, Para,
    CC, CCO, Tipo, Referencia=plantilla, Resultado, fecha con hora) — filtros por rango/
    asesor/tipo y detalle por envío: asunto, hacia dónde, a qué hora, y **si se modificó
    la plantilla** (columna nueva: `CorreoCliente.gs` compara el cuerpo enviado contra la
    plantilla base al registrar).
  - **Búsquedas**: hoy no se registran en ningún lado (`Logger.log` efímero). Registrar
    término+usuario+fecha en hoja nueva desde `getQuotesForUser`/`buscarCotizaciones`
    (`Code.gs:697/837`) con escritura **best-effort que jamás revienta** (patrón
    `metRegistrarEnvio_`) y muestreo si el volumen pega al rendimiento — medido, no
    supuesto.
  - **Cambios de usuarios**: ya están en `BitacoraConsola`; vista filtrada aquí.
  - **Descarga de informes**: CSV en cliente (patrón `inicio_avanzado.html:1324-1364`)
    en cada sub-vista.
- **T9.5 — Bitácora por fechas.** `consolaBitacoraRango(email, desde, hasta)` junto a
  `consolaBitacoraLeer_` (`Consola.gs:153-200`), conservando el recorte jerárquico para
  supervisores y la lectura desde el final (las hojas crecen sin tope); UI de rango +
  descarga CSV junto a `#cns-recargar-bitacora` (`consola.html:630`).
- **T9.6 — CCO global (solo maestro).** Ajuste nuevo `CORREO_CCO_GLOBAL` en
  `CONSOLA_AJUSTES` (`Consola.gs:37-102`) con validación de lista de correos
  (`consolaValidarAjuste_` 1101) y **campo nuevo `soloMaestro` en el catálogo de ajustes**,
  exigido en `consolaGuardarAjuste` (1026) con `acc.maestro` — hoy el gate `adm_ajustes`
  no distingue por ajuste. Inserción del bcc en las **cuatro** rutas de envío:
  `Correos.gs:687-716` (cotizaciones), `CorreoCliente.gs:95-122` (plantillas a cliente),
  `Cuentas.gs:992-1008` y `Revision.gs:695-709` (avisos). **Exclusión escrita y probada:**
  los correos de seguridad (contraseñas temporales de bienvenida/reset, códigos de
  verificación de Cuentas) **NO llevan el CCO** — copiar credenciales a un buzón de
  monitoreo sería un agujero, y la decisión queda comentada en el código.
- **T9.7 — Ajustes centralizados.** Mover a `CONSOLA_AJUSTES` con `secConfig_` los que
  viven en código: `MAIL_ALIAS` (`Correos.gs:10`) y `CC_SENDER_NAME`
  (`CorreoCliente.gs:18`); enlazar desde Ajustes las configuraciones que ya tienen casa
  propia (formatos habilitados, política de revisión) en lugar de duplicarlas.
- **T9.8 — Salud al día.** Añadir a `revisionMaestra` (`Admin.gs:19-319`, helper
  `check(area,nombre,fn)`) las áreas que hoy no cubre: Metricas (hoja y columnas),
  Trazabilidad (hoja de homologación), Preferencias, Atenciones, Revisión/Política,
  Auditoría, CacheIdentidad — y las nuevas de este plan (Grupos, Votos, Articulos,
  CCO configurado válido). La consola las pinta sin cambios (agrupa por `c.area`).
- **T9.9 — Resumen con recomendaciones.** Mover los avisos de «Requiere atención» del
  cliente (`consola.html:1065-1083`) al servidor dentro de `consolaPanorama` y ampliarlos
  con datos reales: módulo apagado hace >N días, errores de envío recientes
  (MetricasCorreos.Resultado), checks de salud fallando, cuota de correo cerca del tope,
  altas sin primer acceso. Cada recomendación con su acción («ir a Módulos»).
- **T9.10 — Módulos, revisión acotada.** Lo pedido: «ver si hay que actualizar algo».
  Comprobar que los bloques nuevos de este plan (`articulos`, `metricas`) aparecen en la
  pestaña Módulos y se pueden apagar por mantenimiento (salen solos del catálogo
  `PERM_BLOQUES` si nacen con `fijo:false` — verificar esa decisión por bloque en T13.1),
  que las pantallas nuevas respetan el módulo apagado, y corregir lo que el barrido
  encuentre. Si no hay nada, se anota «revisado, sin cambios» en el §18 y listo.

### Criterios de aceptación

1. Supervisor: crea grupo, mueve gente de su nivel hacia abajo, copia correos y los pega
   en Gmail listos; un asesor con `sup_equipo` NO puede tocar grupos.
2. Difusión: correo de prueba con imagen y botón llega con el formato profesional, los
   destinatarios van en CCO, y el envío queda en métricas y bitácora.
3. Monitoreo responde en <5 s con filtros sobre datos reales y descarga CSV; un supervisor
   no ve nada fuera de su alcance jerárquico (probado con dos cuentas).
4. Con CCO global configurado, un envío de cotización y uno de plantilla llegan copiados
   al buzón configurado; el correo de reset de contraseña NO.
5. `revisionMaestra()` pasa en verde sobre el proyecto real con las áreas nuevas.

### Perfil profesional

Ingeniería backend Apps Script senior (modelo, jerarquías, cuotas, rendimiento sobre
hojas grandes); ingeniería frontend para la sección nueva; **seguridad** (gates por nivel,
exclusiones del CCO, no exponer listas de correo); diseño de plantillas HTML de email
(compatibilidad de clientes de correo); analítica de producto para definir los informes.

**Dependencias:** T13.1 define los bloques nuevos — se acuerdan aquí y se consolidan allá.

---

## 12. FASE 10 · «Acerca de» *(R15)* — esfuerzo M

**Objetivo.** Un lugar que explique qué es el Portal, qué puede hacer **quien lo está
viendo** (según sus permisos), la extensión y por qué importa, y quiénes lo hicieron.

### Tareas

- **T10.1 — Dónde vive.** Pantalla `acerca` en `PAGES` + `AppUrl.PAGINAS`, con entrada
  discreta en el pie de la barra lateral (`app_shell.html`, junto a tutorial/temas) y en
  el Portal (footer). Accesible con sesión; sin bloque propio (es informativa).
- **T10.2 — Contenido.** Secciones: propósito del sistema (con animación GSAP de entrada
  sobria, patrón de `estado.html` pero ligera); **qué puedes hacer tú** — las funciones se
  pintan filtradas por `AppSession` igual que el menú, con un instructivo corto por
  función y enlace directo (reutilizar el catálogo unificado de T6.3: es la misma lista);
  la extensión de Chrome — qué hace, por qué instalarla, enlace a la guía existente
  (`app_extension_guia`); créditos — las personas que participaron (lista mantenible en
  una hoja o constante, no hardcodeada en el markup) y la línea de soporte
  (`app_support` ya da el modal de contacto).
- **T10.3 — Los blogs/artículos de importancia** que se pedían aquí **son la fase F8**:
  desde «Acerca de» se enlaza a los artículos, no se duplica el mecanismo.

### Criterios de aceptación

1. Un asesor y un maestro ven listas de funciones distintas, cada una completa para su
   sesión.
2. La pantalla carga sin llamadas pesadas (contenido estático + sesión local).

### Perfil profesional

Redacción UX en español (es una pantalla de texto: el oficio principal aquí es escribir
claro); diseño visual; ingeniería frontend ligera.

**Dependencias:** T6.3 (catálogo unificado de funciones), F8 para el enlace a artículos.

---

## 13. FASE 11 · La validación Liverpool *(R13)* — esfuerzo S (investigación acotada)

**Estado real, para no re-investigar lo sabido:** la consulta automática vive en
`Revision.gs` — `revFichaArticulo`/`revFichaDeUrl_` (837-918) pide la ficha del artículo
con `UrlFetchApp` y cabeceras de navegador (`REV_FICHA_HEADERS`, 816-822); cuando
liverpool.com.mx responde **403 es su protección anti-bot** rechazando a los servidores de
Google (el comentario en 896 ya lo dice). El iframe directo **jamás** va a funcionar
(`X-Frame-Options`/CSP, explicado en 790-810). Ya existe una degradación parcial: mensaje
«Ábrelo en una pestaña para compararlo» e imagen de respaldo por SKU.

### Tareas

- **T11.1 — Spike de investigación, con tope de 1 día y salida escrita.** Probar, por
  orden de probabilidad:
  1. Los **endpoints JSON** que usa la propia página (la app Next.js de Liverpool carga
     datos por API; la extensión ya lee ese flight data en el navegador) — puede que la
     protección anti-bot no cubra igual a las APIs que al HTML.
  2. Variar la petición del servidor (cabeceras completas de navegador, `Referer`,
     orden de cabeceras) — poco probable contra anti-bot moderno, pero es barato de probar.
  3. **Verificación desde el cliente**: el navegador del supervisor SÍ puede pedir a
     liverpool.com.mx… pero no desde el sandbox del Portal (CORS). La vía real del lado
     cliente es la **extensión de Chrome** (ya tiene permisos de host y ya extrae fichas):
     un mensaje de la extensión hacia la pantalla de revisión con el precio en vivo.
     Anotar su costo real (solo funciona con la extensión instalada).
  El resultado del spike se escribe en el §18: qué se probó, qué respondió cada vía, y la
  decisión. **Si ninguna vía es confiable, se acepta el fallback y no se insiste** — la
  pantalla ya compara bien cuando el fetch pasa, y el 403 no es un bug nuestro.
- **T11.2 — Fallback de primera clase.** Independiente del resultado: cuando la consulta
  responde `bloqueado`, la ficha muestra un botón visible **«Abrir la página de
  Liverpool»** (la URL saneada ya está en la respuesta: `url`, y el saneador es
  `revUrlArticuloSegura_`) en lugar del texto pasivo actual, más el precio de la última
  captura en caché si existe, con su antigüedad rotulada.

### Criterios de aceptación

1. Documento corto de decisión en el §18 con evidencia por vía probada.
2. Con el 403 presente, el revisor llega a la página del artículo en un clic desde la
   ficha, sin buscarla a mano.

### Perfil profesional

Ingeniería con experiencia en scraping/HTTP y protecciones anti-bot (saber **cuándo
parar**); criterio de producto para aceptar el fallback.

**Dependencias:** ninguna. Puede correr en paralelo con cualquier fase.

---

## 14. FASE 12 · Onboardings y ayuda al día *(R8 + R17a)* — esfuerzo M

**Objetivo.** La ayuda alcanza a lo nuevo: el modo rápido explicado donde se usa, y los
recorridos guiados actualizados a todo lo que este plan añade.

### Tareas

- **T12.1 — Ayuda del modo rápido.** OJO: los botones «Nueva entrada»/«Modo rápido» están
  en **`portal_contenido.html`** (315-318), no en `Promociones.html` (ese es el Monitor
  público). La pantalla **ni siquiera incluye `app_onboarding`** (includes 378-392):
  añadir el include, poner el iconito de ayuda junto a los botones (precedente visual:
  `onb-lanzador-plano`, `cotizacion.html:276`), registrar el tour con
  **`AppOnboarding.definir`** (NO `auto`: es ayuda bajo demanda, no un tour que se lanza
  solo y se «consume» al cerrarse por accidente) y, como los pasos señalan el interior del
  drawer, el handler abre primero `abrirImport()` (1373) y luego `ver()`. El tour cuenta:
  qué es el modo rápido, pegar de una hoja, traer de comercial (solo visible en
  promociones/mkp — sus pasos se caen solos en otras secciones, comportamiento del
  motor), analizar sin miedo (no escribe nada) y aplicar. Probar el caso Escape con
  drawer + tour abiertos (los dos listeners de teclado pueden cerrarse a la vez).
- **T12.2 — Recorridos nuevos y actualizados.** Los 7 tours existentes siguen en
  `version:1` y no mencionan nada posterior. Al cerrar cada fase de este plan, la fase
  deja su tour al día — esta tarea consolida: tours nuevos para consola (con Métricas),
  operacion (con recomendaciones y tablero embebido), revision_cotizacion (tras el
  refactor), anuncios (con encuestas), y las pantallas nuevas (articulo, acerca);
  actualización de los existentes que cambiaron (portal con publicación principal y
  artículos; supervision con la política contraída). **Subir `version` escalonado, no
  todos a la vez**: cada subida re-lanza ese tour a todo el mundo una vez, y siete a la
  vez es fatiga de tutorial.

### Criterios de aceptación

1. El iconito aparece junto a los botones solo en esa pantalla, lanza el tour con el
   drawer abierto y no interfiere con Escape.
2. Cada pantalla nueva o cambiada de este plan tiene tour vigente que menciona lo nuevo;
   el calendario de subida de versiones quedó escrito en el §18.

### Perfil profesional

Redacción UX en español (microcopy de pasos); ingeniería frontend ligera sobre el motor
existente; criterio de didáctica (qué merece paso y qué estorba).

**Dependencias:** las fases cuyo contenido documenta (se ejecuta al final, en paralelo con F13).

---

## 15. FASE 13 · Cierre: permisos, consistencia y v1.0 *(R17)* — esfuerzo L

**Objetivo.** Con todo construido, repartirlo: qué bloque abre cada cosa, qué trae cada
rol, y la pasada final de consistencia que convierte esto en la v1.0 de pruebas.

### Tareas

- **T13.1 — Consolidación de bloques nuevos.** Alta en `PERM_BLOQUES`
  (`Permisos.gs:64-149`) de los bloques acordados en sus fases: `articulos` (Supervisión,
  en rol avanzado), `metricas` (Supervisión, en rol avanzado con recorte; maestro todo),
  `grupos` si se decide separarlo de la regla de nivel (por defecto NO: la regla de nivel
  ≥2 de T9.1 basta y un bloque más es un bloque que administrar). Receta completa por
  bloque: entrada en el catálogo → rol que lo trae por defecto (`PERM_ROLES`, el maestro
  lo hereda solo vía `PERM_IDS`) → gate de servidor en cada función → espejo cliente
  (menú `GESTION`/`AREAS` en `app_core.html:1822-1870`, catálogo del buscador, pantallas)
  → fila en la matriz de la consola (sale sola del catálogo) → documento 06 actualizado.
- **T13.2 — Matriz final rol × función.** Tabla escrita (documento 06) de TODO el sistema
  tras este plan: cada pantalla/función × asesor/supervisor/maestro, con los ajustes
  «solo maestro» (CCO) marcados. Verificación con **tres cuentas de prueba reales** (una
  por rol) recorriendo la app entera: lo que se ve, lo que no, y que cada candado de
  servidor responde `sin-permiso` a quien no debe (no solo botón escondido).
- **T13.3 — Los temas de cada información.** Barrido de consistencia visual/temática por
  pantalla (el pendiente «corregir los temas de cada información»): las 11 pantallas sin
  `ViewPrefsPartial` lo reciben (lista en 12 §F1.2 — primera línea del `<head>`), tokens
  en lugar de colores a mano donde el barrido los encuentre, y los tres temas + alto
  contraste probados en las pantallas tocadas por este plan.
- **T13.4 — Deuda heredada del 12 que sigue viva.** Chart.js con versión fijada
  (`inicio_avanzado.html:7`); `app_support` en login/registro/recuperar; accesibilidad de
  shell (saltar al contenido, `<main>` con id, foco por token). Lo que no quepa se anota
  como v1.x con motivo, no se deja en silencio.
- **T13.5 — Pruebas y foto final.** `node --check` sobre los `.gs`; las suites de
  `pruebas/` en verde; `revisionMaestra()` en verde con los checks nuevos (T9.8); batería
  de paridad de búsqueda (F6) archivada como prueba repetible; smoke manual del flujo
  completo (cotizar → revisar → aprobar → enviar → métricas) con las tres cuentas.
  Actualizar los documentos 00–06 con lo nuevo (páginas, hojas, bloques, parámetros).
  Etiquetar **v1.0-pruebas** y arrancar el periodo de pruebas con el equipo.

### Criterios de aceptación

1. La matriz rol × función está escrita y verificada con las tres cuentas; ningún gate de
   servidor confía en el cliente.
2. `revisionMaestra()` en verde; suites en verde; documentación al día.
3. Existe la etiqueta v1.0-pruebas y una lista corta y honesta de «no entró, por qué».

### Perfil profesional

Ingeniería de seguridad/permisos (modelo de autorización, pruebas por rol); QA de
sistema (plan de pruebas, cuentas de rol, regresión); documentación técnica.

**Dependencias:** todas las anteriores; F12 corre en paralelo con esta fase, y la foto
final T13.5 es lo último de todo — espera también a F12. Es el cierre a propósito.

---

## 16. Orden de ejecución y paralelismo

```
F1 URL y navegación ──┬─► F2 Isla ─────────────┐
                      ├─► F7 Publicaciones ────┤
F3 Revisión ══════════╡                        ├─► F8 Artículos ─► F10 Acerca de ─┐
F4 Loaders ═══════════╡  F5 Operación ─────────┤                                  ├─► F12 ∥ F13
F11 Liverpool ════════╡  F6 Buscadores ────────┘                                  │   (cierre)
F9 Consola (arranca tras F1; larga, corre en paralelo con F5–F8) ─────────────────┘
```

Las fases con `══` no dependen de nadie: son el frente paralelo mientras F1 avanza.
F12 (onboardings) y F13 (permisos y v1.0) corren **en paralelo** al final; dentro de F13,
la foto final T13.5 es lo último de todo y espera también a F12.
La vía rápida del §2 puede despacharse en los primeros días.

---

## 17. Mapa requisito → fase (verificación de cobertura)

R1→F1 · R2→F1 · R3→F2 · R4→F3+T2.1 · R5→T4.1 · R6→F7 · R7→sin cambios (a propósito) ·
R8→T12.1 · R9→T4.3+F5 · R10→F9 · R11→T4.2 · R12→T9.6 · R13→F11 · R14→F6 · R15→F10 ·
R16→F8 · R17→F12+F13.

---

## 18. Registro de ejecución

Lo que se ha hecho de verdad, en orden. Cada entrada dice **qué se cambió, qué se comprobó
y qué se dejó fuera a propósito**. Mismo formato que el registro del documento 12.

<!-- Las entradas nuevas van arriba, con la más reciente primero. -->

### 2026-08-15 — F8, segunda tanda: el editor deja de parecer un formulario, y los artículos dibujan

**Por qué esta tanda.** El editor de la tanda anterior funcionaba y se leía mal: cada bloque
en una caja gris idéntica con su rótulo encima, de modo que un párrafo, un subtítulo y una
tabla se veían igual y había que **imaginarse** el artículo. Encima era incoherente con la
propia casa: el constructor de anuncios tiene vista previa desde siempre.

**Qué se cambió.**

- **El editor se parece al artículo.** Cada bloque se escribe con la misma tipografía con la
  que se va a leer: el subtítulo se teclea grande y en Archivo, el párrafo con su medida y su
  interlineado. El «chrome» del bloque —mover, quitar— se fue al **margen izquierdo** y solo
  aparece al enfocar o pasar por encima. Primero se puso arriba a la derecha y **tapaba las
  últimas palabras de la primera línea justo al enfocar el bloque**, o sea exactamente cuando
  se está escribiendo ahí; reservarle sitio dentro habría estrechado la medida de lectura y
  empujarlo al aparecer habría hecho saltar el texto bajo el cursor. El rótulo del tipo se
  quitó a la vez: si el editor se parece al resultado, un subtítulo ya se ve que lo es.
- **Los ajustes opcionales se esconden.** El enlace de un párrafo, el nivel de un subtítulo y
  el «numerada» de una lista solo salen con el bloque enfocado —o si ya llevan algo—. Con
  ellos siempre a la vista, cada párrafo arrastraba un campo vacío debajo.
- **Vista previa, barra de trabajo y cifras en vivo.** La previa usa **la misma función de
  render** que el lector, no una imitación —una imitación es lo que acaba mintiendo—. La barra
  fija de arriba dice dónde estás, si hay cambios sin guardar, y tiene una sola acción
  primaria. Y el panel cuenta palabras, minutos de lectura y bloques según se escribe, que es
  lo que contesta «¿me estoy pasando?» sin tener que guardar y salir.
- **Insertar entre bloques**, con un `+` que aparece al acercarse: es donde la gente quiere
  añadir algo, y evita añadir al final y subirlo a base de flechas. El cursor cae dentro del
  bloque nuevo, y al mover uno el foco viaja con él. `Enter` al final de un párrafo abre el
  siguiente; `Ctrl+S` guarda, porque quien escribe algo largo lo pulsa por reflejo y sin
  atajo el navegador ofrece «guardar la página».
- **Motor de diagramas (draw.io / diagrams.net).** Bloque nuevo `diagrama` para dibujar
  flujos, con sus cajas, flechas y textos editables. Se guarda **el XML**, no una imagen: un
  flujo se corrige más veces de las que se dibuja, y así no hay que subir y versionar un PNG
  por cada retoque. Se dibuja a pantalla completa y se lee incrustado, y el visor es **el
  mismo componente** que el editor cambiando un parámetro, así que lo que se ve mientras se
  dibuja es lo que verá quien lea. La conversación con el iframe es el protocolo `proto=json`
  de diagrams.net, **comprobando el `origin` en cada mensaje**: un `message` lo puede mandar
  cualquier ventana y este maneja el contenido de un artículo del equipo. Si diagrams.net no
  responde en seis segundos —la red de la oficina bloquea dominios—, se dice con esas
  palabras en vez de dejar un marco en blanco.
- **Visor con oficio.** Barra de progreso de lectura (dentro del iframe de Apps Script no hay
  barra de la ventana que sirva de referencia), índice de subtítulos con scroll-spy, revelado
  de bloques al entrar en pantalla, y zoom de imágenes. Todo bajo las reglas del documento 11
  y de la skill `gsap-ventel`: **el contenido es visible sin GSAP** —el estado oculto lo pone
  JavaScript y solo si GSAP cargó—, `prefers-reduced-motion` enseña el resultado final sin
  movimiento, el escalonado usa `amount` con techo, todo vive en un `gsap.context` que se
  revierte al cambiar de artículo, y `ScrollTrigger` se carga de cdnjs en la **misma versión
  fijada (3.13.0)** con el registro defendido.
- **Lo nuevo va primero** (`pubOrdenParaNueva_`). Una publicación nueva nacía con orden 0 como
  todas, y al desempatar por posición de fila aparecía la ÚLTIMA del Portal, debajo de las de
  la semana pasada. Ahora nace con uno menos que el menor que haya: una escritura en vez de
  renumerar la hoja entera. Solo al crear, y solo si no se pidió un orden concreto —quien
  escribe un número manda, y editar no mueve de sitio—. Importa el doble desde F7, porque la
  primera tarjeta es la **principal**: el sitio de honor se lo quedaba lo más viejo.

**Qué se comprobó.** Las baterías suben a **209 comprobaciones** (99 en F7 + 110 en F8), con
casos nuevos para el orden —incluido que editar no reordene y que un orden a mano se respete—
y para el diagrama: XML válido en sus dos formas, alto acotado por arriba y por abajo, y
rechazo de lo que no es un diagrama (`<script>`, un SVG con manejador, HTML suelto, texto
libre y uno de 25 000 caracteres que reventaría la celda). El editor se revisó **en el
navegador** con el CSS real a 1568 px, y de ahí salieron los tres arreglos de arriba.

**Qué queda pendiente y hay que decir.**

- **El visor no se ha visto en pantalla**: la extensión del navegador se desconectó a mitad de
  la revisión. El editor sí se revisó así; el visor comparte tokens y patrones con lo ya
  verificado, pero no es lo mismo que haberlo mirado.
- **Los diagramas no se han probado contra Apps Script.** El iframe anidado y el `postMessage`
  deberían comportarse como el iframe de Google Sheets de la revisión, que ya funciona ahí,
  pero es una dependencia externa nueva y hay que verla en `/dev` antes de contarlo como
  cerrado.
- Sigue faltando lo mismo que la tanda anterior: **el alta en el buscador general**, que son
  dos altas (Ctrl+K e Index tienen armados distintos).

### 2026-08-15 — F8, primera tanda: los artículos existen (falta repartirlos)

**Qué se cambió.**

- **T8.1 · Modelo y permiso.** `Articulos.gs` (nuevo) con dos hojas —`Articulos` y
  `ArticulosVistas`— y el contenido guardado como **JSON de bloques versionado**
  (`{v:1, bloques:[…]}`), nunca HTML. La decisión ordena todo lo demás: guardar el HTML de
  un editor sería guardar código de terceros para pintarlo en la pantalla de todo el
  equipo. Con bloques, el servidor sabe qué campos existen y descarta el resto, y el
  cliente construye nodos en vez de asignar `innerHTML`. Bloque de permiso `articulos`
  («Publicar artículos», grupo Supervisión, en el rol avanzado): **escribir** pasa por él,
  **leer** no —los artículos son para todos—. Va aparte de `anuncios` a propósito: un
  anuncio cabe en una tarjeta y se retira solo; un artículo es documentación que el equipo
  va a citar durante meses.
- **T8.2 · Render seguro.** Cada bloque se pinta con `createElement` + `textContent`; los
  hipervínculos son `<a>` con el `href` ya validado. Solo `https:` — ni `javascript:`, ni
  `data:`, ni `//host` (protocolo relativo, el disfraz clásico), ni URLs con comillas o
  espacios, que son las que se escapan del atributo. La regla está escrita **dos veces a
  propósito**, en el servidor (`artUrlSegura_`) y en el cliente (`urlSegura`): el servidor
  sanea al guardar, pero el cliente pinta también lo que tiene en memoria mientras se
  edita. Se comprobó que `revUrlArticuloSegura_` **no** servía para reutilizar: tiene los
  hosts cableados a liverpool.com.mx, así que habría devuelto vacío para todo enlace de un
  artículo, docs.google.com incluido.
- **T8.3 · Documentos incrustados.** Al pegar un enlace de Docs, Slides, Sheets o Drive se
  extrae **el ID** —no la URL, que arrastra `/edit`, `#slide=`, `?usp=sharing` y a veces el
  correo de quien la copió— y se arma el visor `/preview` con `referrerpolicy="no-referrer"`.
  El aviso de «si esto se queda en blanco es que Drive no te da permiso» va **siempre
  visible**, no solo al fallar: un iframe sin permiso no avisa de nada, se queda en blanco,
  y desde fuera no se distingue de «está cargando». Es la lección del iframe de la revisión,
  repetida a conciencia; y de paso se descubrió que `VentelFX.section().fail(msg)` **ignora
  el mensaje** (`app_loaders.html`), así que apoyarse en él habría sido no avisar de nada.
- **T8.4 · Lector y editor, una sola vista.** Pantalla `articulo` registrada en `PAGES`,
  `AppUrl.PAGINAS`, `PAGINAS_TRAS_LOGIN` y `NOMBRES_PAGINA`, con `art` añadido a las **tres
  listas espejo**. El lector pinta los bloques; quien tiene el permiso ve «Editar» y la
  misma vista se vuelve editable. **El editor es un formulario por bloques y no un
  `contenteditable`**, y es la decisión técnica que la fase pedía declarar: un
  contenteditable produce el HTML que se le antoje a cada navegador, así que guardarlo
  obliga a limpiar HTML ajeno —el trabajo que nadie gana—. Se paga con un editor menos «de
  revista» y se cobra que el artículo se pinta igual dentro y fuera. Guardado por
  `AppGuardado` con el motivo de los reintentos escrito: con id es actualización y se puede
  repetir; sin id, cada intento **crea** un artículo. La firma sale de la hoja y la autoría
  se fija al crear: quien corrige la errata de un artículo ajeno no pasa a ser su autor. La
  lectura se registra en el servidor —no en una llamada aparte que se puede no hacer— con
  una ventana de media hora para que refrescar cinco veces no cuente cinco lecturas.
- **T8.5 · A medias: el carril del Portal, sí; el buscador, no.** El Portal tiene ya su
  franja «Artículos del equipo», que es el camino de los lectores: la entrada del menú de
  Gestión solo la ve quien publica. Se pide aparte de `fetchToolsData`, con caché de una
  hora, porque los artículos cambian de mes en mes y no había por qué hacer más lenta la
  pantalla que todo el mundo abre primero.

**Qué se comprobó.** `pruebas/f8_articulos.test.js` (nuevo): **95 comprobaciones** sobre
los fuentes reales. La mitad es el **banco de contenido hostil** que pedía el criterio 2:
`javascript:` en todas sus formas (mayúsculas, con espacios delante, tras un tabulador,
partido por un salto de línea), `data:text/html`, protocolo relativo, `vbscript:`, comillas
que cierran el atributo, `<script>` dentro del texto —que se guarda como texto y no se
pierde—, tipos de bloque inventados, y URLs falsas de Google (`docs.google.com.evil.example`,
la misma sobre http, y la que lleva `docs.google.com` en el camino y no en el host). La otra
mitad cubre permisos (borradores que no se listan ni se sirven), autoría que no se reescribe,
el registro de lectura y el tope de tamaño, que **se dice en vez de truncar en silencio**.
Pasan también las cinco baterías previas y `scripts/sintaxis.js` sobre los 74 archivos.

**Qué queda de esta fase.** El alta en el **buscador general**, que son dos altas y no una:
`app_comando` (Ctrl+K) tiene su propio armado y el Index el suyo (`FUENTES_INDICE`), y
ninguno avisa si falta. El servidor ya sirve lo que hace falta (`artIndiceBuscador`, con
título, resumen y el texto plano del cuerpo), así que es trabajo de cliente. Con eso se
cierra el criterio 3 de la fase, que hoy está a medias: la URL compartida sí funciona
—`art` viaja en las tres listas y sobrevive al login—, pero el artículo todavía no aparece
al buscarlo.

**Qué se dejó fuera a propósito.**

- **El parser de pegado tabular está duplicado**, no compartido. El de
  `portal_contenido.html` vive dentro del `<script>` de su pantalla, y moverlo a un include
  obliga a tocar y volver a probar esa pantalla entera. Queda anotado con nombre y con la
  regla escrita al lado: si se toca uno, se tocan los dos.
- **Un enlace por párrafo, no por frase.** Enlazar tres palabras sueltas dentro de un
  párrafo exigiría un editor de texto rico, que es justo lo que esta fase decidió no ser.
  El modelo ya lo admite (las partes de un párrafo son independientes); lo que falta es la
  interfaz, y puede llegar después sin migrar nada.
- **Reordenar bloques es con flechas, no arrastrando.** El FLIP del constructor de anuncios
  se miró y está atado a su lista (llama a `moverAnuncio`, usa su selector y su clave de
  cola); reescribirlo aquí era más riesgo que valor para una lista que casi siempre tiene
  menos de veinte elementos.

### 2026-08-15 — F7 completa: cada publicación tiene nombre, sitio y quien responde por ella

**Qué se cambió.**

- **T7.1 · Saneo del modelo** (`Portal.gs`, `Publicaciones.gs` nuevo). Hasta hoy una fila
  escrita a mano en el Sheet no tenía identidad propia: se le daba `anc-row-`+i, o sea **su
  posición**. Eso convertía «insertar una fila arriba» en «cambiarle el identificador a
  todas las de abajo», y desde que una publicación tiene enlace propio eso es un enlace que
  empieza a llevar a otra publicación —sin error, sin aviso y sin forma de enterarse—.
  Ahora `pubAsegurarIdsAnuncios_` le escribe un ID a lo que no lo tenga, también desde la
  lectura pública del Portal, con `LockService` para que dos visitantes a la vez no se
  pisen los huecos; si no consigue el candado **no escribe** y la lectura sigue con un id
  derivado del CONTENIDO de la fila, que tampoco es posicional. Los avisos legacy de la hoja
  `Avisos` pasan de `avi-`+i a `avi-`+huella del mensaje por la misma razón.
  Se añadió la columna **`Responsable`** (el nombre legible; el correo se queda en `Autor`),
  y las dos lecturas —la pública y la de administración— ya devuelven autoría y fecha de
  alta. En el Portal se pinta el **nombre**: el correo es un dato de contacto que nadie pidió
  publicar en una pantalla que ve todo el equipo.
  De paso se corrigió algo que la tarea no pedía y que el requisito volvía urgente:
  `publicarAnuncio` reescribía `Creado` en **cada** guardado, así que la columna decía
  «modificado por última vez» con nombre de «Creado». Con el responsable a la vista, eso
  significaría que corregir una errata en el anuncio de otra persona **te lo adjudica**.
  Autoría y fecha se fijan ahora al crear y no se vuelven a tocar.
- **T7.2 · Principal y especiales.** La primera tarjeta por columna Orden se pinta al doble
  de ancho, con la imagen mayor y un distintivo; las demás quedan como especiales. Se leyó
  la jerarquía del **orden que ya existía** en vez de añadir una casilla «es la principal»
  al constructor: dos criterios de prioridad sobre la misma rejilla acaban
  contradiciéndose, y el día que la casilla y el orden no coincidan ninguno de los dos
  explica lo que se ve. **Validado con el creador el 15 de agosto de 2026**, como pedía la
  tarea: se le enseñaron las tres maquetas —una principal por orden, todo el formato tarjeta
  como principal, y una casilla en el constructor— y eligió la primera, que es la
  implementada. La tarea queda cerrada; si algún día se prefiere otra, se decide en la
  función `esPrincipal` de `renderAnuncios` y el CSS ya distingue las dos clases.
- **T7.3 · ID compartible.** Parámetro `pub` en las tres listas espejo (`Code.gs`,
  `app_core.html`, `PASAN` de Index) y endpoint `pubPorId`, que sirve una publicación por su
  id **incluidas las expiradas y las programadas**, diciendo en qué estado están para que el
  modal lo escriba con palabras. Las **ocultas** no se sirven: apagar una publicación es la
  forma que tiene quien administra de retirarla, y servirla por la puerta de atrás dejaría
  esa decisión sin efecto. Botón «Copiar enlace» en el modal y en cada fila del constructor.
  La pantalla aparte no se construyó, como decía el plan.
- **T7.4 · Encuestas.** Subtipo de la tarjeta —no un formato nuevo—, que es lo que hace que
  un cliente con la copia local de hace seis días la siga pintando como la tarjeta
  informativa que también es. Hasta seis opciones, tiempo estimado y cierre. **Los votos van
  en su propia hoja** (`Votos`, una fila por voto) porque `publicarAnuncio` reescribe la fila
  del anuncio entera y editar el anuncio se los llevaría por delante. Escritura con
  `LockService`, un voto por persona **cambiable hasta el cierre**, y límite de 40 por
  persona y hora clonado de `reportBrokenLink`, que era hasta hoy la única escritura abierta
  del Portal. Los resultados se leen con una llamada propia de **30 segundos** de caché,
  fuera de `fetchToolsData` y su doble caché (10 min de script + 7 días en el navegador):
  una gráfica de votos servida con esa edad no está desactualizada, miente. La gráfica son
  dos `div` y un porcentaje con los tokens del tema —una librería entera para pintar seis
  rectángulos es peso servido en todas las visitas al Portal a cambio de nada—.
- **T7.5 · Llenado asistido** (`anuncios.html`). Cuatro plantillas de arranque
  (mantenimiento, promoción, comunicado, encuesta) que dejan resueltos formato, tono y
  estructura —la parte cara de publicar no es teclear el texto, es decidir qué formato le
  toca a un aviso—; atajos de vigencia («solo hoy», «hasta el domingo», «un mes»), que es
  donde se colaba la errata al escribir `yyyy-mm-dd` a mano; una **revisión en vivo** que
  avisa de lo que el servidor acepta pero en el Portal se lee mal (tarjeta sin imagen, botón
  con texto y sin enlace, fecha ya pasada, dos opciones iguales en una encuesta); y
  «Duplicar», que ya existía, promovido en la ayuda del bloque de plantillas.

**Qué se comprobó.** `pruebas/f7_publicaciones.test.js` (nuevo): **94 comprobaciones** que
cargan `Portal.gs` y `Publicaciones.gs` reales sobre una hoja de cálculo fingida, en el
mismo contexto, que es como conviven en Apps Script. Cubren los criterios de aceptación que
no exigen desplegar: que insertar una fila a mano **no le cambie el ID a nadie** (criterio
2); que dos personas votando a la vez **no pierdan votos**, que editar el anuncio después no
borre resultados y que nadie vote dos veces con la misma sesión (criterio 3); que las
expiradas se sirvan y las ocultas no; que la respuesta de resultados **no diga quién votó
qué**; y que `pub` esté en las tres listas espejo. Pasan también las cuatro baterías que ya
había (`estado_inicial`, `f6_buscador_paridad`, `ttl_cache`, `cache_identidad`) y
`scripts/sintaxis.js` sobre los 72 archivos.

**Cuatro fallos encontrados revisando lo escrito, antes de subir.**

- **El modal de bienvenida tapaba el enlace compartido.** Los dos usan el mismo overlay, y
  como los datos del Portal llegan *después* de leer la URL, quien abría
  `?page=portal&pub=…` veía aparecer encima el saludo automático —que además se marcaba como
  visto, así que tampoco volvía a salir—. Ahora el saludo se calla si hay una publicación
  pedida por enlace.
- **La carga inicial abría la publicación dos veces**: una al leer los parámetros que
  inyecta el servidor y otra cuando contestaba `getLocation`, porque entre las dos la
  variable de «publicación abierta» seguía vacía y las dos se creían la primera.
- **Votar desde el modal apagaba los botones de la tarjeta de detrás.** La misma encuesta
  está en dos sitios a la vez; todo lo que la toca trabaja ahora sobre los dos.
- **Los avisos no se veían.** Se habían escrito con `AppMotion.toast`, y el Portal no
  incluye `app_motion`: eran mensajes que nadie iba a leer. Van por `showToast`, que es el
  aviso de esa pantalla.

**Qué se dejó fuera a propósito.**

- **La casilla «es la principal» en el constructor**, que era la tercera maqueta que se le
  enseñó al creador. Se descartó por lo mismo que la descartaba el plan: convive con la
  columna Orden, así que serían dos criterios de prioridad sobre la misma rejilla, y el día
  que no coincidan ninguno de los dos explica lo que se ve en el inicio.
- **Los banners legacy descartados vuelven a aparecer una vez.** Su id cambia de posicional
  a huella del mensaje, y el «no volver a mostrarme esto» del navegador va por id. Es el
  precio de una sola vez por arreglar un identificador que se rompía en cada inserción de
  fila; se prefirió eso a conservar un id que no significaba nada.
- **La encuesta no manda avisos ni recuerda votar.** No estaba pedido y toca el terreno que
  el alcance dejó fuera (§1: nada de correos ni relojes que revisen pendientes).
- **Los resultados no se refrescan solos** mientras se mira la tarjeta. Se piden una vez por
  carga y se actualizan con la respuesta del propio voto, que es el único momento en que el
  número cambia para quien está mirando. Una encuesta que se repinta sola cada pocos
  segundos es una llamada al servidor por cada tarjeta del inicio a cambio de un número que
  nadie está esperando.

### 2026-08-15 — F6 completa: un solo motor de búsqueda, dos vestidos

**Qué se cambió.**

- **T6.1 · El Portal adopta `AppBuscar`** (`Index.html`). Se retiró el motor propio
  —`buildQuery` + `scoreMatch` + `fuzzyHit` + `levLE`— y las 13 llamadas pasan por dos
  funciones nuevas, `puntuaPortal` y `puntuaIndice`. Los **pesos de campo son los mismos
  que usa el buscador general para el mismo tipo de dato** (nombre 3 · sub 1 · kw 1.4 en
  los índices; nombre 3 · sub 1.2 · extra .7 en el contenido del Portal), y esa es la
  razón de copiarlos: si los dos buscadores puntúan el mismo contenido con pesos
  distintos, la paridad se arregla caso a caso para siempre en vez de una sola vez.
  `hilite` delega en `AppBuscar.resalta`, lo que de paso apaga dos fallos latentes: un
  resultado que salía por «guia» contra «Guía» se pintaba **sin una sola marca** —se lee
  como un resultado que no viene a cuento—, y el resaltado anterior corría una expresión
  regular por palabra **sobre el HTML que él mismo acababa de escribir**, así que buscar
  «mark», «amp» o «quot» marcaba por dentro de las etiquetas y corrompía el desplegable.
  Los ocho bloques de índices, que eran copias letra por letra, quedaron en una tabla que
  hace visible lo que la copia escondía: Formas de Pago corta en 6 resultados y los demás
  en 5.
- **Tres arreglos en el motor compartido** (`app_buscar.html`), que salieron de la
  batería de paridad y no de una lectura:
  - **Los sinónimos no servían de nada.** `puntua` devolvía 0 si ninguna palabra
    *escrita* acertaba, y eso ocurría **antes** de mirar el diccionario: las más de
    ochenta entradas de sinónimos eran decorado. Quien escribe «clabe» busca
    «Transferencia BBVA», donde la palabra «clabe» no aparece. Ahora, y solo cuando el
    llamador ha pedido `exigirTodas:false` —es decir, en un buscador y nunca al filtrar
    una tabla—, un acercamiento por sinónimo puntúa bajo en vez de desaparecer.
  - **Los restos de una letra inundaban la lista.** La partición por frontera
    letra/dígito deja «fbl5n» en «fbl · 5 · n», y esa «n» suelta encaja en casi
    cualquier texto: la clave más específica del Portal devolvía las ocho formas de pago.
    Se descartan los restos de una letra, conservando los que la persona escribió sueltos
    («iphone 5»), donde el número sí es parte de la pregunta.
  - **Los sinónimos se buscan también por la palabra como se escribió**, no solo por sus
    trozos: el diccionario está escrito con los términos tal cual se teclean —«fbl5n»,
    «msi», «med»—, así que la entrada más específica era justo la que no se encontraba a
    sí misma.
- **T6.2 · `app_indices.html`, fuente común** (nuevo, incluido en 16 pantallas). Se
  llevaron ahí los cuatro índices que vivían dentro de `Index.html` —Formas de Pago,
  el glosario de Devoluciones SAP, el catálogo de 167 Tiendas y Centros de Reparto con su
  `scoreTiendaCR`, y las secciones navegables— y ahora **los indexa también el buscador
  general**. No era una extracción por limpieza: es contenido que se busca a diario
  —«¿cuál es la CLABE?», «¿qué leyenda va en esta devolución?», «¿qué número es la CR de
  Guadalajara?»— y que desde una cotización o desde Ctrl+K **no se podía encontrar**.
  Un resultado de estos navega con `portal?sec=…&item=…` llevando el **id** de la tarjeta
  y no el nombre, porque el nombre viene de una hoja y basta un espacio de más para que
  la comparación falle. Tienda/CR entra con su propio grupo y **copia el número en vez de
  navegar**: no hay pantalla a la que ir, y nueve de cada diez veces ese resultado se lee
  para dictarlo por teléfono.
- **T6.3 · Un solo catálogo de funciones.** `CATALOGO` (app_comando) y `APP_ACTIONS`
  (Index) eran la misma lista dos veces, y **ya habían divergido**: el buscador del Portal
  no ofrecía «Portal Ventel», «Monitor de promociones» ni «Inicio de gestión», y el
  general no ofrecía «Atenciones rescatables» ni «Historial del servicio». Nadie lo
  notaba, porque para verlo hay que buscar la misma palabra en los dos sitios y comparar.
  Quedan 27 entradas en una sola fuente, con la **política sin sesión parametrizada por
  superficie** y con su porqué escrito: el Portal ofrece todo lo que no exija identidad
  —un visitante que elige «Nueva cotización» pasa por el login y aterriza *en la
  cotización*—, y el buscador general solo lo público, porque allí no existe ese puente.
  Esa política dejó de ser dos ids escritos a mano en un `if` y es ahora una marca
  declarativa. Se unificaron también el **armador del índice de trazabilidad** (dos
  criterios distintos sobre la misma hoja: uno se saltaba los procesos sin nombre y el
  otro no) y el **parser de ámbitos**, que ahora entiende las dos sintaxis de la casa.
- **T6.4 · Peso de página.** Lo que la tarea pedía —«diferir el panel hasta el primer
  Ctrl+K/`/` sin perder el atajo»— **ya estaba hecho**: `construye()` tiene un solo
  llamador, `abrir()` (`app_comando.html:1898`), y lo único que corre al cargar es
  registrar un `keydown` y poner el botón (`arranca()`, 2116-2135). Se midió con
  `scripts/peso.js`, que resuelve los `include()` como hace el servidor. Ver abajo lo que
  queda pendiente de decidir.
- **Herramientas nuevas.** `scripts/sintaxis.js` comprueba los 26 `.gs` y los bloques de
  guion de los `.html` (99 bloques) —hasta ahora un paréntesis suelto no se veía hasta
  desplegar—; `scripts/peso.js` da el peso servido de cada pantalla.

**Nueve regresiones encontradas y arregladas antes de subir.** El cambio pasó por una
revisión adversaria de cinco lentes sobre el diff completo, con cada hallazgo verificado
por otra lectura que intentaba refutarlo: quince propuestos, cuatro refutados, once
confirmados sobre nueve defectos distintos. Las que importan:

- **El descarte de restos de una letra rompía el filtro de tablas en seis pantallas.**
  Vivía en `consulta()`, que es común a todas las superficies. Un asesor tecleando
  «lvp1» para encontrar LVP-260726-0001 se quedaba sin el «1» y la tabla le devolvía
  **todos** los folios; «pantallas 4k» dejaba pasar también las Full HD. Filtrando una
  tabla, el resto no sobra: **estrecha**. Ahora `consulta()` devuelve las dos lecturas
  —`palabras` (lo que se escribió) y `nucleo` (sin restos)— y decide `puntua`, que es el
  único que sabe si está filtrando o buscando.
- **El empujón por sinónimo se sumaba.** Una consulta cuyo diccionario expande a seis
  términos juntaba 8 × 6 y adelantaba a un resultado que sí contenía lo escrito. Ahora
  cuenta el mejor, no la suma: el tope es lo que el comentario promete.
- **Los sinónimos cortos enganchaban a media palabra**: «cr» dentro de «desCRipción»,
  «sl» dentro de «traSLado». Ahora el sinónimo tiene que empezar la palabra, y solo
  puede ir en medio si tiene cinco letras o más —que es lo que hace falta para alcanzar
  «rEENVÍO» desde «envio» sin regalarle puntos a media lista.
- **«cr 96» encajaba en el patrón de folio** y apagaba el grupo de tiendas justo en la
  consulta para la que se creó.
- **`'__home'` se comparaba sin resolver**, así que «Panel de cotizaciones» no se
  apartaba estando ya en esa pantalla y se quedaba con el primer resultado, el que se
  abre con Enter sin mirar.
- **Copiar el número de tienda fallaba en silencio** si el navegador negaba el
  portapapeles: el panel prometía «↵ Copiar» y no pasaba nada. Ahora hay respaldo y aviso.
- **`«constructor:»` se tomaba por un ámbito**, porque los diccionarios de alias heredan
  de `Object.prototype`.
- **«Atenciones rescatables» salía dos veces** en el buscador general —como función y
  como apartado—, con el mismo destino, y partía en dos claves la costumbre de uso.
- **Llegar desde Ctrl+K a Formas de Pago tardaba 3 segundos en resaltar la tarjeta**: el
  Portal esperaba a que se «llenara» una sección que no sale de ninguna hoja.

Las cuatro que se refutaron también dejaron algo: dos culpaban a la fase de un orden que
ya existía antes (`Math.max(mejorCot, 400)`, previo al refactor) y una describía un
camino que ninguna llamada alcanza. Se anotan aquí para no volver a levantarlas.

**Qué se comprobó.** La batería de paridad del criterio 1 existe y vive en
`pruebas/f6_buscador_paridad.test.js`: **50 términos reales × 13 fuentes**, con el motor
viejo copiado letra por letra dentro de la prueba como referencia congelada. Resultado:
**ninguna coincidencia perdida, 73 resultados nuevos** y tres coincidencias por parecido
de letras que el motor nuevo descarta a propósito —«fraudes» encontraba «grandes» por dos
sustituciones—. La prueba distingue las dos cosas: una pérdida literal o por sinónimo
falla la suite; una que solo salía por parecido se anota aparte para mirarla. También se
comprueba que el número exacto de una tienda gana siempre («cr 96» → CR GUADALAJARA), que
la preferencia de tipo empuja y no filtra («tienda 96» llega a la misma), que los 17
destinos con elemento apuntan a un id que existe de verdad en `Index.html`, que ningún
destino del catálogo se perdió en la fusión (21 del Portal + 22 del general), que todos
los parámetros están en `PARAMS_VISTA`, y que **el filtro de tablas no cambió** —las seis
pantallas que usan `AppBuscar` para filtrar listas siguen exigiendo todas las palabras—.
El criterio 4 (los `kw` de 240 palabras) se midió: preparar el campo una vez en vez de
retokenizarlo en cada pulsación es **4-5 veces más rápido** con 120 procesos y 8
pulsaciones, y da exactamente el mismo puntaje. Las cuatro suites en verde y los 100
bloques de guion sin errores de sintaxis.

Y se cerró el hueco por el que se coló la peor de las regresiones: **ningún término de la
batería mezclaba una palabra larga con la partición letra/dígito**, que es exactamente la
forma del fallo. Ahora hay tres bloques nuevos que lo cubren —el filtro de tablas con
«lvp1» y «pantallas 4k», los sinónimos cortos a media palabra, y el parser de ámbitos
contra las propiedades heredadas—, escritos como los casos que fallaban.

**Correcciones al plan** (los anclajes eran del 14 de agosto y el código se movió):

- «Borrar `levLE`/`fuzzyHit`/`norm`» era **incorrecto en los tres**. `norm` la usan una
  veintena de sitios ajenos al buscador —el filtro por sección, el salto al elemento
  exacto, el módulo de Colecciones— y su alfabeto es lo que hace seguro meter su salida
  en un atributo HTML. `levLE` y `fuzzyHit` las usa `scoreTiendaCR`, que el propio plan
  manda conservar: se mudaron con él, no se borraron.
- Los índices *hardcodeados* de `Index.html` no eran cuatro: los bloques de puntuación
  son **ocho** (Formas de Pago, Devoluciones SAP y los seis de trazabilidad).
- El espejo del servidor no está en `Code.gs:1269-1315` sino en **1348-1496**, y las
  claves `quotes-` / `pendientes-` / `sup-quotes-` **no existen en ningún `.gs`**: son
  claves de `localStorage` que gestiona `AppCache` en `app_core.html`. El criterio 3 se
  cumple por construcción —no se tocó ni el servidor ni esas claves— y se dejó anotado
  para que nadie vuelva a buscarlas donde no están.
- El peso de `app_comando` no son «~300 KB»: son **116 KB por pantalla**, sobre pantallas
  que ya pesan ~1 MB servidas.

**Qué se dejó fuera a propósito.**

- **La descarga diferida de `app_comando` + `app_indices` (157 KB, ~16 % de cada
  pantalla) NO se hizo, y es una decisión que le toca al creador.** En Apps Script
  `include()` pega el partial dentro del HTML: no hay forma de aplazar los bytes sin
  pedirlos después al servidor con `google.script.run`. Eso convertiría el primer Ctrl+K
  en una espera de red de entre 300 y 800 ms —y en dejar de funcionar si la llamada
  falla— para un atajo que hoy abre al instante. Cambiar el peso por eso no es
  evidentemente bueno y no se hace sin decidirlo.
- **Las dos memorias de búsqueda siguen sin hablarse**: el buscador general aprende de la
  costumbre (`ventel-cmdk-uso`) y el del Portal guarda sus últimas búsquedas
  (`ventel-recent`, tope 5). Unificarlas es otra conversación —qué significa «lo que
  sueles abrir» en una portada pública— y no la pedía esta fase.
- **La forma suelta del ámbito no se activó en el buscador general.** Sus ámbitos son
  «estado», «equipo», «cotizaciones», «portal»… que son también el nombre de las
  pantallas que ese mismo buscador ofrece: aceptarla convertiría «estado de cuenta» en
  «búscame *de cuenta* dentro de las fallas». El parser es uno solo y entiende las dos
  sintaxis; lo que cambia por superficie es cuál se acepta, y está escrito con su porqué.
- **`scoreTiendaCR` no se fusionó con el motor general.** Su rama de número exacto
  (+100 sobre los 14+10 del mejor nombre posible) es lo que hace que «96» resuelva
  siempre, y el plan la marca como «la mejor versión». Se movió tal cual.
- Lo que exige un navegador —el aspecto del desplegable, la grabación antes/después del
  criterio 2, el orden que se percibe al teclear— queda para la comprobación manual sobre
  el despliegue.

### 2026-08-15 — F5 completa: Operación recomienda, y el tablero se consulta sin salir

**Qué se cambió.**

- **T5.1 · Tablero embebido** (`operacion.html`). «Ver el tablero público» deja de navegar
  —en Apps Script eso recarga la webapp entera, 2-5 s, y al volver se habían perdido el
  scroll, el modal a medio escribir y la sección por la que se iba— y abre un panel sobre
  la misma pantalla. Los datos **ya están en el navegador**: salen de
  `AppOperacion.alCambiar`, que entrega también lo que hay en caché, así que se pinta en
  el primer fotograma sin pedir nada nuevo. El gráfico es el partial de siempre
  (`AppEstadoHistorial.montar`), no una tercera copia. Y el markup de `estado.html` **no
  se duplica**: es una vista compacta propia que reutiliza las clases de esta pantalla y
  copia las PALABRAS —si el supervisor leyera otro titular que el equipo, no estaría
  comprobando lo que cree—. La ruta `estado` sigue intacta, con sus enlaces de Chat.
  Estado en la URL con `sec=tablero` (abrir apila, cerrar quita), periodo en `?rango`,
  cierre por aspa/Escape/fondo devolviendo scroll y foco, y Escape en cadena: visor →
  modal → tablero.
- **T5.2 · Recomendaciones con algoritmos locales** (`Operacion.gs` + `operacion.html`).
  `opRecomendaciones(email)` cruza lo que ya existe —claves de tramo horario, similitud
  Dice/Damerau, catálogo de submotivos— en **una sola pasada por cada hoja**, y saca las
  cuatro del plan: la franja horaria que concentra los reportes de un sistema, el sistema
  más problemático, el submotivo que reincide (por parecido, no por igualdad literal: «no
  abre» y «no carga» son el mismo problema escrito por dos personas) y los reportes
  sueltos que se parecen a una incidencia abierta, con su botón para agruparlos.
  **Cada una cita su evidencia** —«12 reportes de Connect entre las 9 y las 11 h en los
  últimos 7 días»—, que es lo que hace que se le crea, y **todas tienen umbral escrito**:
  seis reportes repartidos en tres días distintos y tres personas, o no sale. Una caída de
  un martes ya no se disfraza de costumbre. Con la lista vacía la sección **no se pinta**:
  un recuadro que dice «sin recomendaciones» ocuparía el mejor sitio de la pantalla los
  días buenos, que son la mayoría.
- **T5.2b · `opPanel` cacheado.** Releía las TRES hojas en cada carga de cada supervisor;
  durante una caída, con varias personas mirando, eso se multiplicaba — y es parte de la
  lentitud que obligó a poner esperas. Se parte en puerta y cuerpo: el cuerpo va en
  `opCacheado_` con clave **compartida**, y `yo` se añade después sobre una copia. Meter
  el correo en la clave habría dado una copia por persona, y entonces la primera carga de
  cada supervisor volvería a costar las tres lecturas, que es justo lo que se evita.
- **T5.3 · Exporte CSV** (`operacion.html`). La pantalla no exportaba nada: llevar una
  caída a una reunión obligaba a transcribir las tarjetas a mano. CSV generado en el
  cliente con el patrón probado de la casa (Blob + enlace, BOM UTF-8 para que Excel abra
  los acentos). Las cuatro columnas que pedía el alcance **no existían con ese nombre** y
  se resolvieron declarándolo: «Plataforma» ← `sistema`, «Categoría» ← `submotivo`,
  «Hora» en columna propia y en 24 h —suelta, que es lo que permite repetir en Excel el
  análisis por franjas— y «Tipo» ← Incidencia | Reporte suelto, que es la distinción que
  de verdad separa las filas.

**Qué se comprobó.** Los 26 `.gs` y los bloques `<script>` de las pantallas pasan
comprobación de sintaxis; las tres suites en verde. El contrato entre servidor y pantalla
se fijó por escrito ANTES de repartir el trabajo y se verificó campo por campo al juntarlo.
Cada agente montó su banco de pruebas: la caché del panel (segunda consulta, cero lecturas;
`yo` correcto por persona), los umbrales de cada recomendación (9 contra 8 no publica nada;
una sospecha caducada no se propone), y el CSV con comas, comillas y saltos de línea dentro
de las notas.

**Qué se dejó fuera a propósito.**

- El detalle por incidencia no se replica dentro del tablero embebido: las incidencias son
  de solo lectura ahí y el detalle sigue viviendo en `estado.html`, adonde lleva el botón
  del pie llevándose el periodo que se esté mirando. Duplicarlo era el segundo tablero que
  el plan quiere evitar.
- El exporte saca lo que el panel tiene cargado (incidencias vivas, cerradas de 7 días y
  sueltos de 24 h). Un histórico más ancho necesita una función de servidor nueva.
- Los umbrales se eligieron con criterio, no con datos de producción, y están pensados para
  **pecar de callados**. Son constantes con nombre y con su porqué encima, para que
  bajarlos sea una decisión informada de una línea.
- Los criterios que exigen el navegador —que el tablero abra en <1 s, el aspecto del panel,
  la descarga real del CSV— quedan para la comprobación manual sobre el despliegue.

### 2026-08-15 — Una sola espera a la vista: se acabaron los dos loaders superpuestos

Lo reportó el creador: «en algunas pantallas se ven dos loaders, el normal de siempre y
el que se añadió después, animado con GSAP». Un recorrido de las diecinueve pantallas
encontró que **la causa no estaba en ninguna pantalla**: eran cuatro fallos de
coordinación entre las capas, y por eso el síntoma salía en tantos sitios distintos.

**Lo que pasaba.**

1. El isotipo de arranque **nace visible** con la página y cada pantalla lo apaga con
   `hide()`, que lo desvanece en **360 ms**. Pero todas apagan y montan su propia espera
   en el mismo tick, así que las dos capas se cruzaban SIEMPRE. Y `tl.pause()` vivía
   dentro del temporizador: el isotipo seguía **girando mientras se iba**, que es lo que
   lo hacía leerse como un segundo loader encendido y no como un fundido.
2. `AppUrl.go` llamaba a `VentelFX.overlay` **a pelo** en vez de pasar por
   `VentelLoader.show()`, saltándose las dos cosas que hace el partial: cerrar la escena
   abierta y retirar el isotipo. Por eso los **once** sitios que encienden su escena y
   acto seguido navegan —«Cotizaciones», «Enviar un Correo», Atenciones, el buscador
   general— dejaban dos escenas a pantalla completa superpuestas medio segundo, **y con
   títulos distintos**, porque la primera no sabía a dónde iba.
3. El disco de la esquina (`AppBusy`) va a `z-index 10001`, por delante de todo, y su
   guardia solo miraba el isotipo: se pintaba **encima de la escena temática durante
   toda la espera**. La única defensa era acordarse de escribir `busy:false` llamada por
   llamada, que es una regla que se olvida en cuanto alguien añade una pantalla.
4. Y `.vfx-cover` **no es opaco** —78 % de superficie con `blur(3px)`—, así que lo que
   quedara debajo se seguía viendo desenfocado. Eso convertía cualquier solape «corto»
   en uno que duraba lo que durase el servidor.

**Qué se cambió.** Cuatro arreglos en tres archivos compartidos, cero en las pantallas:

- `LoaderPartial` estrena **`retirarArranque()`**: quita el isotipo al instante, sin
  transición y con la animación parada. Es la pieza que faltaba, y ya existía a medias
  —estaba encerrada dentro de `show()`, así que solo se beneficiaba quien entraba por
  ahí—. Además `hide()` pausa la animación de inmediato.
- `VentelFX` la llama al montar **cualquier** espera (`overlay`, `section`, `skeleton`):
  quien enciende una espera nueva es quien sabe que la genérica ya no hace falta. Cubre
  incluso a una pantalla que se olvide de llamar a `hide()`.
- `AppUrl.go` pasa por `VentelLoader.show({pagina})`.
- `AppBusy` mira también `.vfx-overlay`, y se retira si algo pasa a taparlo **después**
  de estar puesto; un observador lo devuelve cuando la escena se va.

Y tres solapes que sí eran de su pantalla: **portal_contenido** enseñaba *dos camiones a
la vez* toda la carga (el CSS del esqueleto y la escena de GSAP encima, en contenedores
anidados) — se queda el esqueleto, que dibuja la forma de lo que llega, y hereda el texto
que aportaba la escena; **consulta_cotizacion** y **cotizado_preview** arrastraban un
`#loading-overlay` heredado en el marcado, visible desde el primer fotograma, que se ha
retirado con su CSS; y en cotizado_preview el apagado del arranque estaba en un `finally`,
o sea DESPUÉS de montar la escena de la hoja — ahora va antes, y el relevo entre las dos
escenas se encadena en vez de solaparse.

**Qué se comprobó.** Los 26 `.gs` y los bloques `<script>` de las pantallas pasan
comprobación de sintaxis; las tres suites en verde.

**Qué se dejó fuera a propósito.**

- El disco de la esquina sigue conviviendo con una escena de **sección** (`.vfx-cover`),
  no solo con las de pantalla completa: son sitios distintos de la pantalla, y callarlo
  ante cualquier sección escondería el aviso de otra llamada que sí siguiera en vuelo.
  Donde narraba lo mismo dos veces se resolvió con `busy:false` en esa llamada.
- El relevo entre dos escenas cuesta los ~480 ms que tarda `done()` en irse. Un
  `swap()` en el motor, que solapara salida y entrada sin que coincidan, ahorraría el
  encadenado a mano; queda anotado como mejora del motor, no de las pantallas.
- Todo esto se verificó leyendo el código: el aspecto real solo se confirma publicando.

### 2026-08-15 — F4 completa: tres esperas que cuentan qué está pasando

**Qué se cambió.**

- **T4.1 · Escena «reportes»** (`app_loaders.html` + `app_estado_historial.html`).
  Nace `SCENES.reportes`: una persona ante su monitor, barras que crecen escalonadas,
  una hoja de reporte que entra y sale, y la palomita de verificado al cerrar cada
  vuelta. Se engancha en el historial de estado sustituyendo el esqueleto estático,
  con `cuerpoEspera()` intacto —la cabecera de periodos sobrevive a la espera, que es
  la razón por la que existe— y la guarda de respuestas cruzadas sin tocar.
  **Decisión de diseño, tomada a propósito y comentada:** la escena sale solo en la
  PRIMERA carga, donde el hueco está vacío y las cuatro filas del esqueleto eran un
  número inventado; al CAMBIAR de periodo sigue el esqueleto, que trae exactamente las
  filas que había y no hace encoger y volver a crecer la tarjeta por una espera que
  suele ser de medio segundo. El partial es compartido, así que la escena aparece
  también en el tablero público: está dibujada para los dos contextos.
- **T4.2 · Escena «asesor»** (`app_loaders.html` + `app_atenciones.html`). Una asesora
  con diadema y fichas de cliente que van llegando. Sustituye las tres tarjetas grises
  del esqueleto, que eran otro número inventado —quien abre Atenciones puede tener cero
  pendientes o doce—, así que el salto de maquetación que el esqueleto venía a evitar lo
  daba él mismo al aterrizar la lista. Es el **único** cambio permitido en el módulo.
- **T4.3 · Esqueletos por sección** (`operacion.html`). El único `#opp-contenido` se
  parte en cuatro (`#opp-esperan`, `#opp-vivas`, `#opp-sueltos`, `#opp-cerradas`), cada
  uno con su rótulo ya escrito y su esqueleto propio, y `pintar()` vuelca cada sección
  en el suyo. Ahora se ve **cuál** de las cuatro esperas va lenta, que era el problema.
  Se quitó el `fx` global de la llamada para no duplicar, y los cinco manejadores se
  cierran en `onData` **y** en `onError`.
- **Fuga preexistente, cerrada de paso** (`app_loaders.html`). `stopAll()` solo mataba
  lo que `build()` devuelve, pero cuatro escenas veteranas (`radar`, `camion`, `percha`,
  `etiqueta`) crean además tweens sueltos con `repeat:-1` que no devuelven: seguían
  latiendo para siempre contra un SVG ya retirado del documento, una fuga por cada
  espera y justo en las pantallas que más se abren. `build()` pasa a envolverse en un
  `gsap.context()` que `stopAll()` mata — `kill()` y no `revert()`, porque en la rama de
  error la escena sigue en pantalla y revertir la haría saltar al fallar.

**Qué se comprobó.** Los 26 `.gs` y los bloques `<script>` de todas las pantallas pasan
comprobación de sintaxis; las tres suites de `pruebas/` en verde. El comportamiento de
`gsap.context().kill()` —que corta los tweens sueltos sin revertir estilos— se verificó
**ejecutando GSAP de verdad**, no razonándolo.

**Qué se dejó fuera a propósito.**

- El mapa `PANTALLAS` no se tocó: es para la espera de NAVEGAR a una pantalla, y estas
  dos escenas son esperas dentro de una pantalla ya abierta. Si algún día se quiere que
  navegar a `estado` o a `atenciones` saque la escena nueva, el cambio va ahí.
- `VentelFX.skeleton` sigue sin un `kind` que dibuje un reporte suelto con su chip y sus
  miniaturas, y sin `opts.title` para rotular la espera; el rótulo lo pone la pantalla.
  Si el patrón se repite, su sitio es el motor.
- El número de filas de cada esqueleto de Operación (2/2/3/1) es un juicio, no una
  medida sobre datos reales.
- Los criterios de F4 que exigen el navegador —el aspecto real de las escenas, el CDN
  bloqueado, `prefers-reduced-motion`— quedan para la comprobación manual sobre el
  despliegue, como el resto de lo que depende de `google.script.*`.

### 2026-08-15 — Las dos lentes de revisión de T1.2 que faltaban, ya pasadas

La entrada de T1.2 dejó anotado que las lentes de **regresión** y **alcance** no habían
llegado a reportar. Se pasaron, y encontraron tres cosas — las tres corregidas:

- **`operacion`: el enlace profundo se gastaba contra la copia en caché.** `AppRun.swr`
  avisa DOS veces cuando hay copia local (primero con `deCache=true`, luego con la
  respuesta del servidor), pero `onData` se declaró con un solo parámetro y tiraba el
  aviso. La guarda de «aplicar el enlace una sola vez» se consumía contra una copia que
  puede tener 45 s, así que una incidencia nacida dentro de esa ventana no se encontraba,
  `olvidarUrl()` **borraba** `action`/`inc`/`item` de la barra, y cuando un segundo
  después llegaba el dato bueno ya no quedaba ni modal ni enlace del que tirar. Ahora el
  `deCache` viaja hasta la decisión y el intento queda pendiente para el pintado fresco
  — que es justo lo que la pantalla hermana `anuncios` ya hacía bien.
- **El arreglo anterior del diálogo de `anuncios` NO arreglaba nada.** Se dio por buena
  una corrección que mataba los tweens del cierre; comprobado ejecutando GSAP, vaciar una
  línea de tiempo hace que COMPLETE en el fotograma siguiente, así que **adelantaba** el
  apagado de 220 ms a 16 ms en vez de evitarlo, y el comentario que lo acompañaba
  afirmaba lo contrario. La cura no cabía en `anuncios`: está en `AppMotion.modalIn`
  (`app_motion.html`), que ahora cancela el cierre en vuelo matando la LÍNEA entera
  —`tl.kill()` no dispara `onComplete`—, y de paso cubre a todos los modales de la app.
- **`Promociones` repintaba de más.** El oyente de atrás reconstruía la lista entera
  aunque lo único que cambiara fuese la tarjeta enfocada: cada «atrás» vaciaba el
  contenedor, relanzaba la cascada de entrada de todas las tarjetas y las barras de
  vigencia desde cero. Ahora se compara antes de repintar, y el foco se resuelve sobre
  las tarjetas que ya están.

También salió un defecto latente del motor: `buildCard` sembraba el primer subtítulo
desde `copy.steps[0]` pero nunca desde `opts.steps[0]`, así que quien pasa pasos propios
sin `sub` —el historial, porque solo él sabe qué periodo se está pidiendo— arrancaba con
el subtítulo en blanco hasta la primera rotación, a los 2,6 s: en una espera de un
segundo, nunca. Corregido.

Lo que las dos lentes **no** encontraron también cuenta: no falta ni un `id` en los trece
archivos de T1.2, ninguna línea eliminada se llevó por delante una función o un botón,
todos los manejadores que ganaron una bandera booleana están envueltos para que el
`Event` no se cuele en su sitio, las cuatro prohibiciones de alcance se respetaron, y los
tres formularios con trabajo en riesgo —el borrador de cotización, el `state.dirty` de
anuncios y el correo a medio redactar— pasan por su guardia en los tres caminos.

### 2026-08-15 — F1 verificada en el despliegue real: los criterios que faltaban, cerrados

La entrada de abajo dejó tres criterios de F1 pendientes de comprobación manual, porque
`google.script.history` no existe fuera del iframe de Apps Script y no se pueden verificar
sin publicar. **El creador del proyecto los ha comprobado sobre el despliegue real y
confirma que funcionan**: el criterio 1 (cambiar pestaña o filtro escribe la URL, F5
restaura el mismo estado, atrás devuelve el estado anterior y no solo la dirección), el 2
(copiar la URL en cualquier estado, abrirla sin sesión, pasar por el login y aterrizar en
ese estado exacto) y el 4 (las tres puertas —login, Portal y shell— llevan a cada rol a su
inicio).

Con eso **F1 queda cerrada del todo**, no solo escrita. Es el único criterio de cierre que
este plan no puede darse a sí mismo: lo que depende de `google.script.*` solo lo confirma
quien tiene el despliegue delante.

### 2026-08-15 — T1.2 y **F1 completa**: la URL viva en todo el sitio

**Qué se cambió.**

- **Cimiento que el plan no anotaba y que T1.2 necesitaba antes de nada.**
  `window.__APP__` se componía a mano en cada pantalla eligiendo qué parámetros
  copiar, y la mitad se quedaba solo con `baseUrl`. Como dentro del iframe de Apps
  Script la barra de direcciones es la del sandbox y no la del enlace, esas
  pantallas tenían los enlaces profundos **muertos sin que nada lo dijera**: la
  consola declara soportar `?sec=` y `?q=`, los lee en dos sitios, y no le llegaban
  nunca. Ahora el servidor arma el objeto entero (`appEstadoInicialJson_`, `Code.gs`)
  y las diecinueve pantallas escriben la misma línea, así que añadir un parámetro a
  `PARAMS_VISTA` lo pone en todas de una vez.
  De regalo se cerró un **agujero de seguridad real**: esos valores salen de la URL
  y se imprimían con `<?!= ?>`, que no escapa, así que un enlace con
  `?folio=</script><script>…` cerraba la etiqueta y ejecutaba código en la sesión de
  quien lo abriera. El serializador escapa `<`, `>`, `&` y los dos separadores de
  línea que JSON deja pasar crudos.
- **Tres parámetros nuevos** en las tres listas espejo (`Code.gs`, `app_core`, la
  lista `PASAN` del Index): `estatus` para la tabla de supervisión, `dir` y `origen`
  para el Monitor de promociones.
- **T1.2 · Write-back en las trece pantallas** que faltaban, con la convención de
  T1.1: pestaña/sección/abrir un elemento **apilan**, filtro/búsqueda **reemplazan**,
  valor vacío **quita**, y toda pantalla que apila registra su oyente de atrás — que
  restaura la VISTA, no solo la dirección.
  `Promociones` estrena las cinco (pestaña, búsqueda, dirección, origen y la tarjeta
  enfocada); su clave `promo` se deriva del **contenido** de la fila y no de su
  posición, porque el Monitor no tiene ids en la hoja y un índice posicional deja el
  enlace apuntando a otra promoción en cuanto alguien inserta una fila (la misma
  lección que T7.1). `inicio` y `consola` leían `q` y no lo escribían nunca — la
  asimetría inversa. `cotizacion` fija su folio en cuanto el servidor se lo da y lo
  suelta al degradarse a nueva. `operacion` y `estado` recuerdan qué modal o qué
  incidencia hay abierta y, sobre todo, lo quitan al cerrar; de paso se cerró el
  defecto vivo que el plan anotaba en `estado` (el `?inc` cerrado revivía al cambiar
  de periodo). `anuncios` recuerda formato, filtro y qué publicación se edita, sin
  pisar un formulario sucio. `atenciones` y `consola` migran las **dos últimas**
  llamadas directas a `actualizar()` que quedaban en el proyecto. El **Portal
  conserva a propósito su maquinaria propia** —ya cumple la convención, migrarla es
  riesgo sin ganancia— y solo se le cerró el hueco de Trazabilidad, cuyo buscador
  filtraba sin reflejar.

**Qué se comprobó.** Los 26 `.gs` y los bloques `<script>` de los 20 HTML tocados
pasan comprobación de sintaxis (extractor con neutralización de `<?!= ?>`); las dos
suites previas de `pruebas/` siguen en verde y la nueva
`pruebas/estado_inicial.test.js` cubre el escape y el contrato con 28 comprobaciones,
incluidos los casos hostiles. Verificado por barrido: ninguna llamada a `reflejar()`
usa un nombre fuera de los 16 del contrato, no queda ni un `actualizar()` directo
fuera de `app_core`, y toda pantalla que apila tiene oyente de atrás.

Revisión adversarial en seis lentes con refutación por escéptico. **Corrieron cuatro
lentes** (trampas, convención, corrección JS, privacidad) y **cayeron por límite de
sesión las otras dos (regresión y alcance) junto con TODOS los refutadores**, así
que los hallazgos se verificaron **a mano contra el código**, uno por uno, antes de
tocar nada. La lente de privacidad no encontró nada: ningún dato personal viaja
ahora en una URL. Los otros cinco eran reales y van corregidos en el mismo commit:
en `Promociones` cada flecha del teclado apilaba una entrada —tres lentes lo
encontraron por separado—, así que salir del Monitor pedía un «atrás» por tecla; en
`Promociones` y `consola`, pulsar la pestaña ya abierta apilaba entradas gemelas y
el botón atrás parecía averiado; en `atenciones` el `?action=nueva` dejó de borrarse
de rebote al migrar a `reflejar` y un F5 reabría el formulario que el asesor había
cerrado; en el panel avanzado el `?ancla` no se consumía y contradecía al `?sec` que
esta misma tarea empezó a escribir; y en `anuncios`, el botón atrás con la pregunta
de «cambios sin guardar» delante la cerraba y la reabría en la misma vuelta
síncrona, dejándola invisible y sin nadie que pudiera contestarla.

**Qué se dejó fuera a propósito.**

- **La cobertura de la revisión quedó incompleta**: las lentes de *regresión* y
  *alcance* no llegaron a reportar. Se cubrieron a mano solo sus partes mecánicas
  (contrato de parámetros, `actualizar()` residuales, correspondencia apila↔oyente).
  Queda pendiente pasarlas cuando haya cuota; se anota aquí para que no se dé por
  revisado lo que no se revisó.
- El filtro de **Asesor** de la tabla de supervisión no viaja en la URL: compara por
  nombre para mostrar, y un nombre propio en un enlace compartido es dato de más.
- Fuera del alcance de T1.2 y anotados: la casilla «ver bajas» y el cajón de ficha de
  la consola; el filtro por plataforma de Trazabilidad (pediría un parámetro nuevo);
  el botón «Ver tablero público» de Operación, que **rehará la F5** y no conviene
  escribirle un estado ahora.
- Dos huecos que viven en `app_atenciones.html`, **intocable** por decisión de
  alcance: el `?action` no se limpia al cerrar el modal desde dentro del módulo, y el
  módulo cambia de pestaña por su cuenta en dos sitios sin avisar, así que la URL se
  queda atrás hasta el siguiente cambio. Se arreglan cuando esa fase toque el módulo.
- **Los criterios de aceptación 1, 2 y 4 de F1 siguen pendientes de comprobación
  manual sobre el despliegue real**: `google.script.history` no existe fuera del
  iframe de Apps Script, así que apilado, restauración por F5 y botón atrás solo se
  pueden verificar publicando. Es la comprobación que cierra formalmente la fase.

### 2026-08-15 — F3 completa: la política se abre cuando se va a mirar, y la revisión se lee de un vistazo

**Qué se cambió.**

- **T3.1 · Política contraída con carga perezosa** (`inicio_avanzado.html`). La
  cabecera de `#pol-seccion` deja de ser un rótulo y pasa a ser el interruptor de
  la sección: un `<button>` con `aria-expanded`/`aria-controls` dentro del
  encabezado, y el cuerpo —editor, simulador, historial y barra de guardado—
  metido en un `#pol-panel` que pliega con `grid-template-rows: 0fr → 1fr`, el
  mismo patrón ya probado en `.rev-panel` de la revisión de cotizaciones. Nace
  **plegada** y `getPoliticaRevision` no se llama hasta la primera apertura: antes
  se pedía al inicializar la pantalla, la mirara alguien o no, y eso costaba una
  lectura de hoja y un editor entero montados en cada entrada al panel, además de
  empujar hacia abajo lo que sí se mira a diario, que es la cola de pendientes.
  «Descartar cambios» se queda fuera del botón (un botón dentro de otro no es HTML
  válido) y solo se ofrece con la sección abierta y algo que descartar.
- **T3.1 · La cabecera dice la verdad con el cuerpo cerrado.** El resumen se
  separó del repintado del editor (`polResumenTexto` + `polPintarCabecera`), que
  era la condición para poder plegar: `polPintar` reconstruye el editor y no puede
  ser quien mantenga informada a una cabecera cuyo cuerpo quizá no se ha abierto
  nunca. Dos decisiones dentro: el resumen describe **lo guardado** —lo que está
  rigiendo—, no el borrador, porque una cabecera que contara cambios sin aplicar
  diría que el sistema hace algo que aún no hace; y como con la sección plegada la
  barra de guardado no se ve, la cabecera estrena un distintivo «Cambios sin
  guardar» que es lo que impide plegar y olvidarse. `polPintar` además se blindó
  para no montar el editor sin política en memoria. Llegar con `?ancla=pol-seccion`
  abre la sección sola: ese enlace es alguien pidiendo la política a propósito.
- **T3.2 · Refactor de claridad de `revision_cotizacion.html`.** Mismo contenido,
  otra jerarquía:
  - **Cabecera pegada arriba** con los tres datos que no pueden perderse de vista
    al decidir —folio, estatus e **índice de confianza**, que se mudó del riel a
    la cabecera—. Con treinta artículos en la lista esos datos quedaban tres
    pantallas más arriba justo en el momento de aprobar. Se mantiene de una fila a
    propósito; el material es el de las barras pegadas de la casa (fondo de la app
    al 88 % con desenfoque, como `.topbar` y `.fp-nav`).
  - **Tira de contexto** bajo la cabecera con la frase del índice y la instrucción
    de la pantalla: se leen al llegar y se van con el scroll, que es lo que permite
    que la cabecera de arriba sea corta. El número nunca queda solo, que era la
    razón escrita de que el índice llevara frase.
  - **Riel de decisión de verdad alcanzable**: se ancla bajo la cabecera y, si su
    contenido no cabe, scrollea por dentro (`max-height` + `overflow`). Antes se
    pegaba al borde superior, así que con muchos puntos de verificación el riel era
    más alto que la pantalla y los botones de decidir quedaban fuera de alcance.
  - **Datos de la cotización en dos grupos** («A quién va dirigida» / «Qué es esta
    cotización») y las marcas de veredicto **alineadas al borde derecho** de su
    celda en vez de pegadas al final de cada valor: caen todas en la misma vertical
    y se ven de una pasada.
  - Las dos barras pegadas se coordinan **midiéndose**, no suponiéndose: la del
    shell y la de la revisión cambian de alto con el ancho, el zoom y el salto de
    línea, así que su altura viaja por `--rev-top`/`--rev-head-h` con
    `ResizeObserver`. Con eso el riel se ancla justo debajo y los saltos a un
    elemento (`scroll-margin-top`) no quedan medio tapados.

**Qué se comprobó.** Ningún `id` perdido en las dos pantallas (comparación
automática contra `HEAD`: 0 bajas en `revision_cotizacion`, y las 3 altas de
`inicio_avanzado` son las piezas nuevas del interruptor). Ninguna palabra de texto
visible desaparece de la pantalla de revisión —criterio 3, verificado por
comparación de todo el texto estático contra el original, no a ojo—; en la política
solo cae el «Cargando la política…», que ya no describe nada. `guardarRevisionCotizacion`
no aparece en el diff. Criterio 1 verificado en código: la única llamada a
`getPoliticaRevision` vive en `polCargar`, y a `polCargar` solo se llega desde la
primera apertura y desde «Descartar cambios». Markup de las dos pantallas bien
anidado y sin botones anidados (validador de pila propio), los bloques `<script>`
pasan comprobación de sintaxis con los scriptlets neutralizados, los 26 `.gs` en
verde con `node --check` y las dos suites de `pruebas/` en verde (40 + 44
comprobaciones). Conservados los overrides de `[data-theme="carbon"]` —con entrada
nueva para el distintivo—, `prefers-reduced-motion` y la regla de impresión, que
ahora además despega cabecera y riel: en papel no hay scroll y un riel con
`overflow` impreso se dejaría fuera lo que no cupiera.

**Qué se dejó fuera a propósito.**

- **La maqueta previa validada «con quien revisa a diario» no se hizo, y es lo que
  queda pendiente de F3.** El plan la daba por barata porque «la pantalla ya tiene
  modo de vista de diseño»: **ese modo no existe** —se buscó en toda la pantalla y
  en el proyecto—. En su lugar el refactor se hizo conservador y reversible (mismo
  contenido, mismos `id`, ningún cambio en el flujo de decisión), de forma que el
  antes/después se compara con el propio `git` y revertirlo es un `git revert`. La
  validación con quien revisa a diario sigue siendo condición para dar la fase por
  buena en producción; es una conversación, no una tarea de código.
- El resumen de la política describe lo guardado y no el borrador (decisión de
  arriba): con la sección abierta, mover un interruptor ya no cambia el texto de la
  cabecera al instante. Lo que hay sin aplicar lo dicen el distintivo y la barra.
- Plegar la sección con cambios sin guardar esconde el botón «Guardar la política»
  hasta volver a abrirla. Se avisa con el distintivo en lugar de impedir el plegado:
  bloquear un plegado por un borrador es peor trato que avisar de él.
- Dentro del riel, la tarjeta de decisión no se fijó al fondo: con textarea y dos
  botones es demasiado alta para pegarla sin comerse la lista de verificaciones que
  hay que atender **antes** de decidir. El riel acotado ya la deja siempre a un
  scroll corto.
- El recorrido guiado de supervisión sigue en `version: 1` y su paso señala la
  política, que ahora está plegada. Actualizarlo es **T12.2**, que consolida los
  tours de todas las fases y escalona las subidas de versión; adelantarlo aquí
  gastaría una de esas subidas por una sola pantalla.
- Los criterios que exigen el navegador —que no salga ni una llamada al abrir el
  panel (comprobable en la pestaña de red), el plegado en móvil, y el antes/después
  punto por punto de la revisión— quedan para la comprobación manual sobre el
  despliegue real de Apps Script, como el resto de criterios que dependen de
  `google.script.*`.

### 2026-08-15 — F2 completa: la isla dinámica notifica

**Qué se cambió.**

- **T2.1 · Conteo en servidor** (`Revision.gs`). Nacen `revContarPendientes(email)`
  —puerta pública con gate `secIdentidadConBloque_(email,'revisar')`— y el interno
  `revConteoPendientes_()`, que cuenta con el MISMO criterio que la cola
  (`revEsPendiente_` sobre `leerSupervision_`), así el óvalo y la lista dicen lo
  mismo. Caché en dos capas sin lecturas nuevas: la lista sale de la entrada
  compartida `'supervision'` del panel (Cache.gs) y el conteo se guarda aparte con
  la generación de la BD en la clave (patrón `opCacheado_`) — guardar una revisión
  o una cotización llama a `cotInvalidarCache_`, la generación cambia y la
  siguiente consulta recuenta. Entrega: dentro de `opEstadoSesion`
  (`Operacion.gs`), añadido FUERA de la parte cacheada compartida (mismo sitio que
  `salida.puedeGestionar`) y solo si la identidad trae el bloque; el payload de un
  asesor sin `revisar` no lleva ni el campo, y `opEstadoPublico` no pasa por ahí.
  Viaja en la llamada que la isla ya hace cada 120 s: cero viajes nuevos.
- **T2.2 · Registro de fuentes** (`app_operacion.html`). La esquina deja de ser un
  elemento y pasa a ser una zona (`.op-zona`) con prioridades escritas: guardado en
  curso > notificaciones > estado. Los óvalos de notificación son nodos HERMANOS de
  la pastilla —la isla del guardado reconstruye el innerHTML de la pastilla entero,
  y un hermano repintado desde su registro sobrevive al préstamo—. El registro es
  genérico: cada fuente declara `{id, cuenta, icono, rotulo(n), aria(n), ir}`,
  cuenta 0 la retira, y las pantallas pueden sumar las suyas con
  `AppOperacion.notificar(fuente)`. La fila de revisiones es la primera fuente, no
  la única.
- **T2.3 · UI y animación.** Óvalo con relojito (geometría `clock` de `app_icons`,
  lienzo 24×24 trazo 1.6, en línea porque el Portal no incluye ese partial),
  número con la plantilla visual de `.op-cont` y rótulo plegado. Al apuntar la
  zona, la fila se vuelve columna invertida: cada notificación es una fila encima
  de la pastilla («1 revisión» arriba, el estado de siempre abajo), el viaje del
  óvalo lo anima GSAP con FLIP (solo transform, `overwrite:'auto'`,
  `clearProps` al terminar) y los rótulos se despliegan por CSS. Dueñas repartidas
  sin pisarse: CSS posee el max-width de los rótulos, GSAP el transform de los
  óvalos; el ancho de la pastilla conserva sus dos dueñas históricas y no ganó una
  tercera (su despliegue en zona abierta va por la clase `.op-desplegada` de
  siempre, y `pintarPastilla` borra de paso cualquier estilo en línea del hover).
  Click por zonas: fila de revisión → `AppUrl.go('inicio_avanzado',
  {ancla:'pend-lista'})`; la pastilla sigue abriendo su panel. Fallbacks: sin GSAP
  el cambio de sitio es un salto y los rótulos transicionan por CSS; con
  `prefers-reduced-motion` todo llega puesto (transiciones a .01ms); en táctil el
  primer toque abre la zona y el segundo navega (`hover: none`). En
  `inicio_avanzado`, llegar con un ancla que vive en la pestaña Revisión activa esa
  pestaña y relanza `irAncla` — sin eso el ancla apuntaba a un panel con
  `display:none` y el scroll no movía nada (la cola ya tenía `id="pend-lista"`).
- **T2.4 · Visibilidad.** El óvalo solo se pinta con
  `AppSession.canStrict('revisar')` — `can()` daría el beneficio de la duda a
  sesiones viejas—; el candado real sigue siendo el gate del servidor de T2.1: sin
  bloque, el dato ni llega al navegador.

**Qué se comprobó.** `node --check` en verde sobre los `.gs` tocados; los bloques
`<script>` de los dos HTML modificados pasan comprobación de sintaxis; las dos
suites de `pruebas/` en verde (40 + 44 comprobaciones). Revisión adversarial en
cuatro lentes: corrieron dos (apego al plan y corrección JS) con 5 hallazgos; las
otras dos (GSAP y servidor) y los verificadores cayeron por límite de sesión, así
que los 5 se verificaron A MANO contra el código y las lentes caídas se cubrieron
con el checklist de la skill `gsap-ventel` y el razonado de caché/gates ya escrito
en el código: 4 eran reales y menores —repintado de óvalos no idempotente (tiraba
el foco), FLIP no interrumpible (salto visual al entrar y salir rápido), toque
tragado en táctil durante un guardado, y rótulo de la pastilla sin transición al
abrir la zona— y se corrigieron en una segunda tanda; el quinto era la decisión de
diseño del registro, documentada abajo. Verificado en código que `estado.html`
solo oculta `.op-pill`, así que el óvalo también notifica en el tablero (donde el
estado sí es redundante pero el conteo no).

**Qué se dejó fuera a propósito.**

- El registro de prioridades NO absorbe la maquinaria del guardado: la isla sigue
  entrando por `AppGuardado.delegarIndicador` y las notificaciones por su registro,
  con el contrato de prioridades (guardado > notificaciones > estado) escrito en el
  código y cumplido por construcción —los óvalos son hermanos de la pastilla y la
  zona no se abre con la isla puesta—. Refundir el guardado dentro del registro era
  reescribir una máquina probada para ganar una simetría que hoy no compra nada;
  se revisa si algún día una TERCERA fuente lo pide.
- El texto de la fila inferior sigue siendo el de la máquina de estado («Sistemas
  operando», no el literal «Operando con normalidad» de la maqueta): inventar un
  segundo rótulo para el mismo estado es justo lo que la pastilla evita.
- Los óvalos siguen visibles durante un guardado (el dato no se pierde); lo que se
  bloquea con la isla puesta es ABRIR la zona, porque sus filas de navegación no
  tienen sentido debajo de un «Enviando…».
- El criterio 1 (el número baja sin recargar) y el gesto táctil se dejan para la
  comprobación manual sobre el despliegue real de Apps Script, como el resto de
  criterios que exigen `google.script.*`.

<!-- Esta entrada se quedó sin su encabezado y quedaban dos «Qué se cambió»
     seguidos sin saber dónde empezaba cada uno. Se le pone título; la fecha sale
     del commit que la trajo (a4c69fd), no de una suposición. Lo que aquí quedó
     pendiente —T1.2— está resuelto en la entrada de más arriba. -->
### 2026-08-15 — F1, primera tanda: la URL viva, el login que devuelve y el folio con candado

**Qué se cambió.**

- **T1.1 · Helper central de estado en URL** (`app_core.html`). Nace
  `AppUrl.reflejar(params, {apilar, ancla})`: recibe solo lo que cambió, conserva el
  resto de la URL vigente, apila para pestaña/sección y reemplaza con debounce de
  300 ms para filtros. `AppUrl.param()` ahora contesta el estado VIVO (caché
  `urlViva` que escriben `actualizar()` y el botón atrás), no el del render.
  `alCambiarUrl` admite varios oyentes sobre un único `setChangeHandler` (antes el
  segundo oyente dejaba sordo al primero). Nuevo `AppUrl.declararPagina()`, alimentado
  por `AppShell.mount` y `AppPrecarga.aqui`, para que `reflejar()` nunca escriba una
  URL sin `page`. Corregidos los dos defectos anotados en el plan: `estado.html`
  ya no reescribe `inc` con el valor viejo al cambiar de rango (usa `reflejar`), y
  `portal_contenido` —que apilaba sin oyente— registra `alCambiarUrl`: el botón
  atrás ahora SÍ cambia de sección, la carga inicial ya no apila una entrada
  fantasma, y abrir la sección ya abierta no duplica historial.
- **T1.3 · Estado profundo a través del login.** `requireSession(pagina)` manda al
  login el `next` MÁS todos los parámetros de vista de la pantalla; `goNextOrHome`
  los repone saneados (solo claves de `PARAMS_VISTA`, valores acotados a 200
  caracteres, jamás `next` de vuelta). La lista blanca `PAGINAS_TRAS_LOGIN` sigue
  mandando y `next` sigue siendo clave, nunca URL. El `__APP__` del login expone
  ahora los 13 parámetros de vista (el servidor ya los inyectaba; el login los
  tiraba). Cerrados los dos huecos que iban a login sin `next`: `inicio.html`
  (ahora `requireSession('dashboard')`) y el buscador del Portal (`goAppAction` en
  `Index.html` pasa `next` + parámetros de la acción cuando el destino está en la
  lista blanca).
- **T1.4 · Acceso según sesión, también en el servidor.** `consulta_cotizacion.html`
  estrena `requireSession('consulta_cotizacion')` (con T1.3, el enlace profundo
  sobrevive al login con su folio). En servidor, `getQuoteDetails(folio, email)`
  exige identidad registrada (`secIdentidad_`); la lectura interna con caché se
  mudó a `cotDetalleFolio_` (privada) y a ella pasaron los llamadores internos de
  `Correos.gs`, `Revision.gs` y `Formatos.gs`, que ya traen su propio gate. El
  barrido de la misma superficie tapó tres puertas hermanas que el plan no
  enumeraba pero el criterio 3 sí exige: `getQuoteDetailsForEmail`,
  `downloadQuotePdf` (el PDF ES la cotización) y `openQuoteInSheets`, todas con el
  mismo candado; y `generateQuoteHtml` pasó a `generateQuoteHtml_` (era interna y
  quedaba expuesta a `google.script.run` entregando la cotización completa). Los 9
  puntos de llamada en 7 pantallas pasan ahora `AppSession.userEmail`.
- **T1.5 · «Cotizaciones» por rol.** El conmutador del shell y el enlace «Inicio»
  del panel usan `AppUrl.homePage()` (asesor → inicio de cotizar; supervisión o
  mayor → panel avanzado); `data-precarga` calienta la página resuelta y ya no se
  precarga la pantalla en la que se está parado.
- **T1.6 · Fecha Y hora en supervisión.** a) La tabla muestra fecha + `HH:mm`.
  b) Columna nueva `FechaEnvio` (auto-reparable, patrón de `Formato`), escrita solo
  en `sendQuoteByEmail` vía `setQuoteColumnValue_`; `leerSupervision_` la sirve en
  ISO; el panel enseña la fecha de ENVÍO para las enviadas —con la línea
  «Guardada:» debajo solo si se editó después de enviar— y el CSV ganó la columna.
  Documentada en el documento 04 junto a la aclaración de que `Timestamp` es del
  último guardado.
- **T1.7 · Correos separados.** «Enviar correo a clientes» salió del apartado
  Cotizaciones a un apartado propio «Correos» en la barra lateral.
- **T1.8 · Gestión solo gestión.** Catálogo `GESTION` revisado entrada por entrada
  tras T1.7: las nueve entradas son de gestión, nada ajeno ni faltante. Quedó
  escrita EN el catálogo la regla de que toda pantalla nueva del plan entra al menú
  por él.

**Qué se comprobó.** `node --check` en verde sobre los 26 `.gs`; los bloques
`<script>` de los 13 HTML tocados pasan comprobación de sintaxis (extractor con
neutralización de `<?!= ?>`); las dos suites de `pruebas/` en verde (40 + 44
comprobaciones). Verificado en código que la extensión de Chrome NO llama a
`getQuoteDetails` (solo valida la URL del web app) y que la vista previa exige el
bloque `cotizar`, así que el candado de T1.4 no les quita nada; las tres páginas
públicas (portal, promociones, estado) siguen públicas y sin cambios de acceso.
`saveQuoteDataToSheets` parte de la fila existente al actualizar, así que
`FechaEnvio` sobrevive a las ediciones (criterio 5).

**Qué se dejó fuera a propósito.**

- **T1.2 (write-back pantalla por pantalla) es la siguiente acción**: ya tiene el
  helper listo y los puntos de enganche anotados en el plan. Con ella deben migrar
  a `reflejar()` los `actualizar()` directos que quedan (consola) y declararse
  `AppPrecarga.aqui`/`AppUrl.declararPagina` en las pantallas sin shell que
  empiecen a escribir (Index, Promociones).
- `FechaEnvio` se REESCRIBE al reenviar: refleja el último envío real. Editar no
  la toca, que es lo que pide el criterio.
- `registro.html` y `recuperar.html` no arrastran el estado profundo (solo el
  login, que es la puerta que usan los enlaces compartidos); si se quiere que
  «crear cuenta» también lo conserve, es una tarea nueva.
- Los criterios de aceptación 1, 2 y 4 de F1 requieren el despliegue real de Apps
  Script (google.script.history no corre fuera): la comprobación manual queda para
  el cierre de la fase, después de T1.2.

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
