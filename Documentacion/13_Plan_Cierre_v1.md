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
  el formato tarjeta = principal). El responsable va pequeño en la esquina inferior
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

*(Sin entradas todavía: el plan se acaba de fijar.)*

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
