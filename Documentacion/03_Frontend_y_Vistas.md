# 03 · Frontend · las 40 pantallas y módulos `.html`

Cómo está construido el cliente, qué módulo hace qué y qué reglas hay que respetar para que
una pantalla nueva se comporte como las demás.

---

## 1. Cómo funciona realmente un `include`

`<?!= include('app_core'); ?>` **no** es un import. `include()` (`Code.gs:190`) devuelve el
**contenido de texto** de otro archivo y lo pega ahí mismo durante el render del servidor.

Consecuencias que hay que tener presentes siempre:

- **Todo el JavaScript comparte un único ámbito global.** Por eso cada módulo se envuelve en
  una IIFE y publica una sola variable (`window.AppCache`, `window.AppShell`…).
- **El orden importa y no es negociable.** Un módulo que use `AppRun` tiene que ir después
  de `app_core`. Un módulo que use `AppMotion.toast` tiene que ir después de `app_motion`, o
  comprobar su existencia.
- **Una plantilla revienta si usa una variable que no se le pasó.** De ahí que `PARAMS_VISTA`
  se inyecte entero en todas las pantallas.
- **`window.__APP__` es una línea fija, no una decisión de cada pantalla.** Se escribe
  `window.__APP__ = <?!= APP_JSON ?>;` y ya trae los 16 parámetros. Cuando cada pantalla
  elegía a mano cuáles copiar, la mitad se quedaba solo con `baseUrl` y sus enlaces
  profundos morían en silencio: la consola declaraba soportar `?sec=` y `?q=`, los leía en
  dos sitios, y no le llegaban nunca.
- **Si una pantalla no incluye un módulo, sus funciones no existen ahí.** Ya provocó un fallo
  real: el reporte de falla funcionaba en dieciocho pantallas y habría fallado en la
  decimonovena, porque el Monitor de promociones carga `app_operacion` pero no
  `app_guardado`. Se resolvió con una envoltura que usa la cola cuando está y llama directo
  cuando no. **Una acción no puede funcionar o no según qué includes tenga cada pantalla.**

---

## 2. El orden canónico de includes

Este es el patrón de una pantalla de app completa. Cópialo tal cual al crear una nueva:

```html
<head>
  <?!= include('ViewPrefsPartial'); ?>   <!-- 1. tema ANTES del primer fotograma -->
  <?!= include('app_theme'); ?>          <!-- 2. tokens de diseño + tipografía -->
  <?!= include('app_tailwind'); ?>       <!-- 3. preflight + utilidades -->
  <script>
    window.__APP__ = <?!= APP_JSON ?>;   <!-- igual en TODAS: no se compone a mano -->
  </script>
  <?!= include('app_core'); ?>           <!-- 4. AppUrl · AppSession · AppCache · AppRun -->
  <?!= include('app_prefs'); ?>          <!-- 5. preferencias local + nube -->
  <?!= include('app_guardado'); ?>       <!-- 6. cola de escritura -->
  <?!= include('app_buscar'); ?>         <!-- 7. motor de coincidencia -->
  <?!= include('app_icons'); ?>
  <?!= include('app_estatus'); ?>
  <?!= include('app_motion'); ?>         <!-- 8. GSAP y helpers -->
  <?!= include('app_support'); ?>
  <?!= include('app_shell'); ?>          <!-- 9. marco: barra lateral + topbar -->
  <?!= include('app_comando'); ?>        <!-- 10. buscador general Ctrl+K -->
  <?!= include('LoaderPartial'); ?>
  <?!= include('app_operacion'); ?>      <!-- 11. pastilla de estado (TODAS las pantallas) -->
  <?!= include('app_atenciones'); ?>
</head>
```

> **`window.__APP__` va ANTES de `app_core`.** Si falta, `AppUrl` arranca con la URL base
> vacía, `build()` devuelve `null` y **cada clic del menú acaba en «no pudimos abrir la
> pantalla»**. Es el fallo más caro y menos evidente del frontend. Ya ocurrió con
> `atenciones.html`.

Las páginas **públicas** (`Index`, `Promociones`, `estado`) reciben `APP_URL` en vez de
`baseUrl`, y cargan un subconjunto: no usan `app_shell` ni `app_tailwind`.

---

## 3. Las 21 pantallas (18 con sesión + 3 públicas)

### Con sesión (`PAGES` en `Code.gs`)

| Clave de URL | Archivo | Qué es | Bloque |
| --- | --- | --- | --- |
| `login` | `inicioDeSesion.html` | Acceso | — |
| `registro` | `registro.html` | Alta con código por correo | — |
| `recuperar` | `recuperar.html` | Recuperación de contraseña | — |
| `dashboard` | `inicio.html` | Inicio del asesor | *(sesión)* |
| `inicio_avanzado` | `inicio_avanzado.html` | Panel de supervisión | `supervision` |
| `cotizacion` | `cotizacion.html` | Captura de cotización | `cotizar` |
| `cotizado_preview` | `cotizado_preview.html` | Vista previa del documento | `cotizar` |
| `consulta_cotizacion` | `consulta_cotizacion.html` | Consulta de folios | `consultar` |
| `revision_cotizacion` | `revision_cotizacion.html` | Revisión y aprobación | `revisar` |
| `correoventel` | `correoventel.html` | Envío de la cotización | `enviar_cotizacion` |
| `correo_cliente` | `correo_cliente.html` | Plantillas a clientes | `correos_cliente` |
| `anuncios` | `anuncios.html` | Constructor de anuncios | `anuncios` |
| `portal_contenido` | `portal_contenido.html` | Gestión del contenido del Portal | `portal_contenido` |
| `operacion` | `operacion.html` | Bandeja de supervisión de fallas | `operacion` |
| `consola` | `consola.html` | Consola de administración | `adm_*` / `sup_equipo` / `metricas` |
| `atenciones` | `atenciones.html` | Atenciones pendientes | `atenciones` |
| `articulo` | `articulo.html` | Artículos: lector y editor de la misma vista *(F8)* | *(sesión para leer;* `articulos` *para escribir)* |
| `acerca` | `acerca.html` | «Acerca de»: qué es el Portal, qué puede hacer quien mira, la extensión y los créditos *(F10)* | *(sesión)* |

> El cascarón de `consola`, `portal_contenido` y `atenciones` **se sirve a cualquiera que lo
> pida**, igual que las demás. No enseña nada hasta que el servidor confirma el bloque en
> cada llamada. Servir el cascarón no filtra nada y evita tener dos formas de rutear.

> **`acerca` no llama al servidor.** Es la única pantalla de app que se pinta entera con lo
> que ya viaja en el HTML —el catálogo de funciones de `app_indices`, los instructivos de
> `app_instructivos` y los créditos de `app_creditos`— más la sesión de `localStorage`. Por
> eso **no incluye `app_operacion` ni `app_atenciones`**: los dos traen datos por su cuenta
> al cargar. La única llamada posible es `AppSession.refrescar()`, y solo cuando la sesión
> no sabe qué bloques tiene: mientras no los sepa, `AppSession.can()` contesta que sí a
> todo y la lista «qué puedes hacer tú» sería falsa.

**Las nueve pestañas de la consola** (`?sec=`) y qué las abre. Añadir una exige tocar **cuatro
sitios a la vez** —fila en `CONSOLA_SECCIONES` (`Consola.gs`), botón con `data-panel` y
`data-seccion`, `<section id="panel-…">` y el id en `CNS_PANELES` (`consola.html`)—; si falta
el último, un enlace `?sec=…` compartido no abre nada y no avisa.

| `?sec=` | Pestaña | La abre |
| --- | --- | --- |
| *(vacío)* | Resumen | cualquiera que entre a la consola |
| `miembros` | Roles *(y los **grupos**, F9)* | `adm_miembros` · `adm_permisos` · `sup_equipo` |
| `permisos` | Matriz de accesos | los mismos que Roles |
| `modulos` | Módulos | `adm_modulos` |
| `ajustes` | Ajustes | `adm_ajustes` |
| `formatos` | Formatos | `adm_formatos` |
| `salud` | Salud | `adm_salud` |
| `metricas` | **Métricas y monitoreo** (F9) | `metricas` |
| `bitacora` | Bitácora *(con consulta por fechas, F9)* | `adm_bitacora` · `sup_equipo` |

Dos pestañas comparten sección de servidor (`miembros` y `permisos` son ambas `roles`): el
`?sec=` viaja con el **panel**, no con la sección.

### Públicas (`PORTAL_PAGES`)

| Clave | Archivo | Qué es |
| --- | --- | --- |
| `portal` | `Index.html` (7 242 líneas) | **Landing del equipo.** Es la página por defecto y a la que cae cualquier ruta desconocida |
| `promociones` | `Promociones.html` | Monitor de promociones y calendario comercial |
| `estado` | `estado.html` | **Tablero de estado, público a propósito** |

> `estado` es público porque «¿está caído o soy yo?» hay que poder contestarla justo cuando
> no puedes entrar. Está verificado que por ahí no viaja ni un correo ni una nota interna:
> solo cuántos reportes hubo y qué se confirmó.

---

## 4. Los módulos `app_*` y los parciales

| Módulo | Líneas | Qué provee |
| --- | --- | --- |
| **`app_core`** | 1 996 | `AppUrl`, `AppSession`, `AppCache`, `AppRun`, `requireSession()`, `requireBlock()` |
| **`app_shell`** | 574 | Marco común: barra lateral rosa + topbar. Se monta con `AppShell.mount({active, title})` |
| **`app_comando`** | 2 098 | Buscador general (Ctrl+K o `/`) en todas las pantallas |
| **`app_buscar`** | 599 | Motor de coincidencia compartido: un solo criterio de «esto coincide» para toda la app |
| **`app_guardado`** | 685 | Guardado optimista: colas, reintentos y deshacer |
| **`app_operacion`** | 1 932 | Pastilla de estado, panel y formulario de reporte. **En todas las pantallas** |
| **`app_atenciones`** | 2 240 | Panel de atenciones, superponible sobre cualquier pantalla |
| **`app_motion`** | 159 | GSAP 3.13 + MorphSVG. Todos los helpers de animación |
| **`app_theme`** | 488 | Tokens de diseño y tipografía (Inter + JetBrains Mono) |
| **`app_tailwind`** | 472 | Tailwind **compilado**: preflight + solo las utilidades que se usan |
| **`app_icons`** | 118 | SVG unificados: lienzo 24×24, trazo 1.6, `currentColor` |
| **`app_estatus`** | 225 | Fuente única del color de cada estatus de folio |
| **`app_prefs`** | 473 | Mitad cliente de `Preferencias.gs` |
| **`app_onboarding`** | 586 | Recorrido guiado sobre elementos reales |
| **`app_support`** | 110 | Modal de soporte (sustituye los `mailto`) |
| **`app_auth`** | 1 034 | Escenario visual de login/registro/recuperar |
| **`app_ccl`** | 305 | Réplica en pantalla del formato CCL |
| **`app_estado_historial`** | 607 | Gráfico de barras del historial de estado |
| **`app_extension_guia`** | 722 | Guía paso a paso para instalar la extensión |
| **`LoaderPartial`** | 275 | Loader de marca (isotipo Liverpool, `window.VentelLoader`) |
| **`ViewPrefsPartial`** | 61 | Tema/densidad/texto/contraste **antes del primer fotograma** |

---

## 5. `app_core` — el contrato del cliente

### `AppUrl`

Modelo único de construcción de URLs. **Es el espejo de `PAGES` y `PARAMS_VISTA` del
servidor.** Si añades una página o un parámetro en el servidor y no aquí, la navegación cae
al Portal en silencio.

| Método | Qué hace |
| --- | --- |
| `AppUrl.build(pagina, params)` | Arma la URL. Devuelve `null` si no hay `baseUrl` |
| `AppUrl.go(pagina, params)` | Navega |
| `AppUrl.param(nombre)` | Lee un parámetro de vista. Contesta el estado **vivo**, no el del render |
| `AppUrl.params()` | Todos los parámetros |
| `AppUrl.reflejar(params, opts)` | **Escribe** el estado de la pantalla en la barra (ver abajo) |
| `AppUrl.alCambiarUrl(cb)` | Avisa de atrás/adelante. Admite varios oyentes |
| `AppUrl.declararPagina(clave)` | Qué pantalla está abierta. Sin esto `reflejar` no escribe |
| `AppUrl.irAncla(nombre)` | Baja al apartado, reintentando mientras se pinta |
| `AppUrl.PAGINAS_TRAS_LOGIN` | **Lista blanca** de destinos válidos para `next` |

#### La URL como estado: `reflejar` y su convención

La regla del sistema es que **la URL siempre dice dónde estás y qué estás viendo**, y que un
enlace compartido reproduce ese estado exacto. `AppUrl.reflejar` es la única puerta:

```js
AppUrl.reflejar({ sec: 'bitacora' }, { apilar: true });  // pestaña/sección/abrir algo
AppUrl.reflejar({ q: termino });                         // filtro/búsqueda
AppUrl.reflejar({ inc: '' });                            // quitar el parámetro
```

- **Apila** lo que se lee como ir a otro sitio: pestaña, sección, abrir un elemento o un
  modal. Atrás vuelve al estado anterior.
- **Reemplaza** —con espera interna de 300 ms— lo que solo acota lo que ya hay delante:
  filtros y búsquedas. Apilar un filtro deja una entrada de historial por pulsación y el
  botón atrás inservible.
- Recibe **solo lo que cambió**: conserva el resto de la URL vigente. Es lo que evita
  «cambié el periodo y se me cerró la incidencia abierta».
- Un valor vacío **quita** el parámetro.

Cuatro trampas, las cuatro con cicatriz en este repositorio:

1. **El bucle.** El oyente de atrás repinta; si ese repintado vuelve a escribir la URL, se
   realimenta. El patrón de la casa es un argumento `sinUrl` que el oyente pasa en `true`.
2. **La ausencia significa algo.** Volver a una URL sin el parámetro tiene que restaurar el
   valor por omisión, no dejar la pantalla como estaba. Un `if (p.sec)` sin `else` es el error.
3. **Cerrar también escribe.** Si abrir pone el parámetro, cerrar lo quita —por *todas* las
   vías: botón, Escape, clic fuera, cancelar, guardado optimista—. Si no, F5 resucita lo que
   la persona acababa de cerrar.
4. **Foco y scroll.** El cierre que venga del botón atrás debe pasar por la misma función de
   cierre que restaura el scroll del `body` y devuelve el foco.

Los parámetros de **entrada de un solo uso** (`action`, `ancla`) se consumen al aplicarlos:
`reflejar` conserva lo que no se le pasa, así que uno que no se limpie se queda pegado a la
barra para siempre y contradice al resto del estado.

> **El Portal (`Index.html`) es la excepción deliberada**: tiene maquinaria propia
> (`navUrl`/`restore`/`setChangeHandler`) que ya cumple esta convención. No se migró porque
> funciona y reescribirla es riesgo sin ganancia.
>
> Su estado son tres cosas: la sección (`sec`), el filtro de esa sección (`q`) y la
> **publicación abierta en grande** (`pub`, fase 7). Las tres se escriben en `navUrl`, y no
> donde se decide cada una, porque `google.script.history` reemplaza el juego de parámetros
> ENTERO: lo que no se le pase desaparece de la barra. Antes de centralizarlo, teclear una
> letra en el filtro borraba el `?pub=` que alguien estaba a medio copiar.
>
> Abrir una publicación **apila** historial (es un sitio, se vuelve con «atrás»); cerrarla
> **reemplaza** (si apilara, «atrás» la volvería a abrir). El modal de bienvenida no escribe
> nada: sale solo al entrar, y una dirección que cambia sin que nadie la pida convierte el
> botón atrás en una trampa.

### `AppSession`

Lee la sesión de `localStorage`. Todas las claves llevan el prefijo `ventel-`, porque las
webapps de Apps Script se sirven desde un origen compartido (`*.googleusercontent.com`) y
una clave genérica como `userEmail` chocaría con la de otro script. Las claves viejas se
migran una sola vez al cargar cualquier pantalla.

| Propiedad | Qué es |
| --- | --- |
| `userName`, `userEmail`, `firstName` | Identidad |
| `isAdvanced` | Interruptor heredado |
| `rol` | `normal` / `avanzado` / `maestro`. Si falta, se deduce de `isAdvanced` |
| `isMaster` | Atajo |
| `bloques` | Bloques concedidos |

> **`bloques` no es una credencial.** Cualquiera puede editarlo desde la consola del
> navegador. Solo decide **qué botones se pintan**; el servidor vuelve a resolverlo en cada
> llamada.

> El módulo distingue «no tiene ningún bloque» de «todavía no se lo hemos preguntado al
> servidor». Antes se confundían, y de esa diferencia depende si una función apagada por
> mantenimiento se esconde o se sigue enseñando.

### `AppCache`

Almacén local con **namespace, versión, TTL y respaldo en memoria**. Regla del proyecto:
toda entrada lleva versión y caducidad. Hubo un fallo real por saltarse esto — la copia
local del Portal no las tenía, y una copia de hace meses se pintaba igual, de modo que el
día que cambiara la forma del dato se habría roto solo para quien ya había entrado antes.

> **Trampa documentada:** `AppCache` **borra la entrada al leerla caducada**. Un TTL
> demasiado corto no significa «se revalida antes»: significa que el panel vuelve a arrancar
> vacío. Le pasó al panel de atenciones con un TTL de un minuto; se subió a diez, que es lo
> que usa el resto de módulos. `swr` revalida igual en cada apertura.

### `AppRun`

`google.script.run` como promesa, con **deduplicación** de llamadas idénticas en vuelo.

```js
AppRun.call('nombreFuncion', args, opts)         // promesa simple
AppRun.swr(clave, 'nombreFuncion', args, opts)   // pinta lo cacheado y revalida por detrás
```

**`AppRun` es el ÚNICO camino al servidor.** Fuera de `app_core.html` no queda ni un
`google.script.run` en el proyecto: ninguna pantalla arma el suyo, ningún partial lleva un
envoltorio propio «por si acaso», y no hay atajos que lo rodeen. Esa exclusividad es lo que
hace ciertas tres cosas que antes dependían de que cada pantalla se acordara:

- **Deduplicación.** Dos peticiones idénticas en vuelo son un viaje. Sirve de red contra el
  doble clic en cualquier botón que guarde: dos «Aprobar» seguidos son una decisión, no dos.
- **Un solo indicador.** El disco de la esquina lo enciende y lo apaga `AppRun`. Con
  `busy: false` se calla —para sondeos de fondo, o cuando ya hay un overlay tapando la
  pantalla— y con `busy: 'Guardando'` se cambia el verbo.
- **Un solo camino de error.** Incluido el caso que antes se parcheaba con `try/catch` en
  seis pantallas: si el servidor desplegado todavía no expone la función, `AppRun` **rechaza
  la promesa** en vez de no llamar a ningún manejador. Eso importa porque los esqueletos y
  los chips en línea no tienen tope de seguridad: sin manejador se quedaban brillando para
  siempre.

**`AppRun.swr` es el patrón por defecto.** Úsalo salvo que tengas un motivo escrito para no
hacerlo. Los motivos que ya están escritos en el código, para no volver a discutirlos:

| Motivo | Dónde | Por qué |
| --- | --- | --- |
| El pintado no aguanta repetirse | `revision_cotizacion`, la política de `inicio_avanzado`, cargar una cotización en `cotizacion` | `onData` se llama DOS veces cuando hay copia, y la segunda tiraría las casillas marcadas o lo tecleado |
| El dato no se puede enseñar con retraso | `consulta_cotizacion` | Es el documento que ve el cliente y la pantalla no tiene dónde decir «esto es de hace un rato» |
| La clave es un contrato con otro módulo | `quotes-`, `pendientes-`, `sup-quotes-` | `app_precarga` las calienta guardando **el arreglo** y `app_comando` las lee así; `swr` guarda la respuesta entera. Ahí la llamada va por `AppRun.call` y el guardado se queda escrito en la pantalla |

Esa última fila es la trampa que hay que conocer antes de migrar algo a `swr`: **`swr`
guarda en la caché LA RESPUESTA ENTERA**. Si la clave ya la escribe o la lee alguien más
—un calentador de `app_precarga`, el índice del buscador general—, cambiar a `swr` cambia
la forma de lo guardado y el otro deja de reconocerlo, sin un solo error.

### Guardias

- `requireSession()` — sin sesión, redirige a login.
- `requireBlock(id)` — sin el bloque, esconde. **Cortesía, no seguridad.**

---

## 6. `app_guardado` — escritura optimista

En Apps Script cada escritura es un viaje de medio segundo a un segundo. La cola resuelve
tres cosas: la pantalla no se congela, cerrar la pestaña a medio envío no pierde el cambio
en silencio (hay guardia de salida) y **la política de reintentos queda escrita**.

El indicador se delega a la isla de estado de `app_operacion` — un solo sitio en pantalla
donde mirar.

**Cómo declarar reintentos, con el criterio del proyecto:**

| Tipo de operación | Reintentos | Por qué |
| --- | --- | --- |
| Crea algo (registrar una atención) | **0** | Repetir daría de alta al mismo cliente dos veces |
| Toma o reserva algo | **0** | Repetir pisaría una reserva ajena |
| Avisa a terceros (reportar una falla) | **0** | Reportar avisa por Chat; repetirlo mandaría un segundo aviso por la misma caída |
| Idempotente (fijar unas anotaciones) | **sí** | Repetir deja el mismo resultado |

**Excepciones correctas al guardado en segundo plano**, y las dos están razonadas:

- El **acuse del reporte de falla** espera al servidor: lo que devuelve es información real
  (si el reporte disparó una incidencia, cuánta gente lleva reportando lo mismo) y eso no se
  puede pintar antes de preguntarlo. Lo que se adelanta es el aviso en la pastilla, no el
  resultado.
- **Crear un estado nuevo del catálogo** bloquea el diálogo: el chip recién creado tiene que
  quedar seleccionado, y eso no se puede adelantar sin saber la clave que asigna el servidor.

---

## 7. `app_comando` — el buscador general

Se abre con **Ctrl+K** o **`/`** desde cualquier pantalla. Encuentra funciones de la app y
apartados dentro de ellas, cotizaciones, contenido del Portal, procesos de trazabilidad,
**artículos del equipo**, personas, fallas abiertas, clientes esperando llamada, anuncios
publicados (solo quien los administra) y el catálogo de tiendas y centros de reparto.

**Aprende de lo que abres.** Guarda las **veces** y la **última vez**, y ambas empujan el
puntaje. Las cuatro decisiones del algoritmo, que conviene no deshacer sin leerlas:

1. **Frecuencia con logaritmo.** La diferencia entre abrir algo una vez y diez es enorme;
   entre cien y ciento diez, ninguna. Sin el logaritmo, lo de uso diario aplastaría a lo
   demás para siempre.
2. **Recencia que multiplica, con suelo.** Sumando, una costumbre abandonada seguiría
   mandando en marzo porque las veces acumuladas no bajan nunca. Multiplicando, lo viejo se
   apaga solo; el suelo evita que dos semanas de vacaciones borren seis meses de costumbre.
3. **El empuje tiene tope (55 %).** Sin tope, lo aprendido acabaría ganándole a lo escrito:
   teclearías «bitácora» y saldría «Nueva cotización». **El texto manda; la costumbre
   desempata.**
4. **Reordena, nunca inventa.** Se aplica después de filtrar: jamás hace aparecer algo que no
   coincidía.

Además: la pantalla en la que ya estás baja al final (gastar el primer resultado en «ir a
donde ya estoy» es gastarlo en no hacer nada), y hay **ámbitos** — `fn:`, `cot:`, `portal:`,
`procesos:`, `art:`, `gente:`, `fallas:`, `tienda:` — que se anuncian en el panel vacío,
porque un prefijo que no se enseña existe para quien lea el código y para nadie más. Cada
uno acepta su forma corta y su nombre entero (`cot:` y `cotizaciones:`), porque las dos se
teclean.

> **Un solo motor, dos vestidos.** Hasta la Fase 6 había dos implementaciones y esta guía
> lo anotaba como deuda. Ya no: el buscador del Portal (`Index.html`) puntúa con
> **`AppBuscar`** a través de `puntuaPortal`/`puntuaIndice`, igual que el general. Lo que
> sigue siendo distinto —y a propósito— es la **presentación**: el Portal enseña sus
> resultados en su desplegable con sus secciones, y el general en su paleta. La prueba
> `pruebas/f6_buscador_paridad.test.js` es la que sostiene la unificación: compara el motor
> nuevo contra una copia congelada del viejo y falla si algún resultado se pierde.
>
> **Una fuente nueva son dos altas, no una.** Los dos buscadores arman sus grupos por
> separado y **ninguno avisa si falta**: en `Index.html` se añade un grupo en
> `doGlobalSearch` con su rama de pintado y su rama en el manejador de clic; en
> `app_comando.html`, una fuente en `calcula`, su rama en `pinta` y su destino en `ejecuta`.
> Si los dos puntúan el mismo contenido, **los pesos tienen que ser los mismos** — es lo que
> comprueba la sección 13 de `pruebas/f8_articulos.test.js` para los artículos.

---

## 8. Animación

- **GSAP 3.13** con `MorphSVGPlugin`, cargado desde CDN en `app_motion.html`.
- **Todo pasa por `GS()`**, que respeta `prefers-reduced-motion`. Si GSAP no carga (sin red
  al CDN) o el usuario prefiere menos movimiento, **la interfaz sigue funcionando**: el
  loader degrada a un giro estático y las animaciones no ocurren.
- **Solo se anima `transform` y `opacity`.** Las barras del historial usan `scaleY`, nunca
  `height`. La única excepción es la altura de un detalle desplegable, que es intrínsecamente
  de layout, y ahí se acota con `contain` para que el recálculo no salga de la tarjeta.

---

## 9. Diseño visual

- **Tokens en `app_theme`**: `--brand`, `--surface`, `--ink`, `--line`, `--ok`, `--warn`,
  `--alert`, `--side-*`. **Nunca escribas un color a mano**; si te falta uno, añádelo como
  token.
- **Tres temas + alto contraste**, y todo módulo que use los tokens los hereda sin una línea
  extra.
- **El rosa es acento, no superficie** (regla 60/30/10). Fue un cambio de dirección
  deliberado respecto al diseño anterior.
- **Tipografía: Inter + JetBrains Mono.** Antes eran tres familias. Inter está dibujada para
  pantalla y distingue `1/l/I` y `0/O`, que es justo lo que se lee todo el día aquí (folios
  `LVP-260726-0001` y SKUs). El eje óptico (14..32) ajusta el dibujo al tamaño real: de ahí
  viene el aire «premium», no de una segunda fuente decorativa.
- **Iconos**: 24×24, sin relleno, trazo 1.6, `currentColor`. Heredan color y tamaño del
  contenedor.
- **Tailwind está compilado**, no es el CDN. El CDN descargaba ~100 KB de compilador y
  generaba el CSS en el navegador en cada carga. **Si usas una clase de Tailwind que no esté
  compilada, no existirá**: hay que añadirla a `app_tailwind.html`.

---

## 10. Dependencias externas del cliente

| Recurso | De dónde | Si falla |
| --- | --- | --- |
| GSAP 3.13 + MorphSVG | `cdn.jsdelivr.net` | La interfaz funciona sin animación |
| Inter + JetBrains Mono | `fonts.googleapis.com` | Cae a la tipografía del sistema |

Son las **dos únicas** dependencias de red del frontend. Tailwind ya está compilado dentro
del proyecto precisamente para no ser la tercera.

---

## 11. Reglas para una pantalla nueva

1. Define `window.__APP__ = <?!= APP_JSON ?>;` **antes** de `app_core`. Tal cual, sin
   componerlo a mano.
2. Registra la página en `PAGES` (servidor) **y** en `AppUrl` (cliente). Son espejo.
3. Monta el shell: `AppShell.mount({ active: 'clave', title: 'Título' })` — que además
   declara la página ante `AppUrl`. Una pantalla sin shell la declara ella misma con
   `AppPrecarga.aqui('clave')` o `AppUrl.declararPagina('clave')`, o `reflejar` no escribirá.
4. Pide datos con `AppRun.swr`, no con `AppRun.call`, salvo motivo escrito.
5. Incluye `app_operacion`: la pastilla de estado va en **todas** las pantallas.
6. Si la pantalla escribe, pasa por `AppGuardado` y **declara los reintentos con su motivo**.
7. Da entrada por URL a su estado (`?sec=`, `?q=`) y **escríbelo de vuelta** con
   `AppUrl.reflejar` (§5): la pestaña apila historial, la búsqueda lo reemplaza. Si apilas
   algo, registra `AppUrl.alCambiarUrl` para que el botón atrás cambie la **vista** y no
   solo la dirección, y repasa las cuatro trampas del §5 antes de darlo por hecho.
8. Añade la pantalla al catálogo del buscador general con sus bloques declarados.
9. Usa tokens del tema y `icon()` de `app_icons`. Si pides un icono que no existe, `icon()`
   cae a la llave inglesa: **parece una decisión y manda a buscar al sitio equivocado.**
10. Comprueba `prefers-reduced-motion` usando `GS()` en lugar de llamar a GSAP directamente.

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
