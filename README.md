# Sistema de cotizaciones Ventel

Aplicación de Google Apps Script (HTML Service). Cada pantalla es un archivo `.html` que
el servidor renderiza con `include()`, y la lógica de servidor vive en los `.gs`.

- **Enrutador:** `Code.gs` (`PAGES`, `PARAMS_VISTA`) en el servidor y `AppUrl` en
  `app_core.html` en el cliente. Las dos listas son espejo y tienen que decir lo mismo.
- **Permisos:** `Permisos.gs` define los bloques y los roles; el candado real es
  `secIdentidadConBloque_` en `Seguridad.gs`, que se vuelve a exigir en cada llamada.
  Lo que hace el cliente (`requireBlock`, filtros de menú) es cortesía, no seguridad.
- **Caché y llamadas:** `AppCache` y `AppRun` en `app_core.html`. El patrón por defecto
  es `AppRun.swr`: se pinta lo guardado y se revalida siempre por detrás.
- **Guardado en segundo plano:** `app_guardado.html` (colas, reintentos y deshacer) con
  el indicador delegado a la isla de estado de `app_operacion.html`.
- **Animación:** GSAP 3.13 desde `app_motion.html`, con `MorphSVGPlugin`. Todas las
  pantallas respetan `prefers-reduced-motion`.

---

## Revisiones por segmento

Se va revisando la aplicación por partes. Cada apartado deja escrito qué se comprobó,
qué se corrigió y qué queda como está a propósito.

### Atenciones pendientes — revisado

El módulo que guarda los datos de un cliente cuando una plataforma se cae, para poder
devolverle la llamada después. Vive en tres sitios: el aviso flotante que sale al
reportar una falla, el panel que se abre encima de cualquier pantalla, y la pantalla
completa `atenciones.html`.

**Piezas:** `Atenciones.gs` (servidor), `app_atenciones.html` (cliente),
`atenciones.html` (pantalla completa). Bloque de permiso: `atenciones`.

#### Qué se comprobó

| Punto | Estado |
|---|---|
| Enlaces al sitio correcto | Barra lateral, Portal, Monitor de promociones, buscador general, inicio del asesor, panel de gestión, aviso de falla y pie del panel: todos comprobados |
| Accesible e interpretable por URL | `?action=nueva`, `?sec=` y `?q=`/`?buscar=`, con reescritura de la dirección y atrás/adelante |
| Aparece en el buscador general | Tres entradas de pantalla más un grupo nuevo de resultados con los clientes que esperan llamada |
| Caché y almacenamiento local | `AppRun.swr` sobre `AppCache`, invalidación en cada escritura, enfriamiento del aviso en `localStorage` |
| Cola y guardado en segundo plano | `AppGuardado` con reintentos declarados por operación y deshacer en pantalla; se anuncia en la isla de estado |
| Lenguaje no técnico | Revisado: sin jerga en botones, avisos ni estados vacíos |
| Funciones inteligentes | Precarga por intención, búsqueda por teléfono sin formato, salto entre pestañas al buscar, reserva con cuenta atrás |
| Estilo moderno y fluido (GSAP 3.13) | Movimiento acotado a `transform`/`opacity`, con `contain` donde se anima altura |
| Mapeado por rol y permisos | Bloque `atenciones` en asesor, supervisor y maestro; gate de servidor en las cinco funciones |

#### Qué se corrigió

1. **El aviso de rescate no salía en el Tablero de estado.** `estado.html` tiene el botón
   de reportar una falla y `app_operacion` pide el ofrecimiento de guardar al cliente,
   pero la pantalla no incluía `app_atenciones`: la llamada existía y no encontraba el
   módulo. Justo la pantalla donde más falta hace era la única sin él.

2. **El panel abría con rueda en vez de con la lista.** La caché del panorama se guardaba
   con un minuto de vida, y `AppCache` borra la entrada al leerla caducada. Pasado ese
   minuto, el panel volvía a arrancar vacío —lo contrario de lo que promete su propio
   rótulo, "actualizado hace 5 minutos"—. Ahora se guarda diez minutos, como el resto de
   módulos: `swr` revalida igual en cada apertura, así que la lista sale pintada al
   instante y la comprobación va por detrás.

3. **La tarjeta de Atenciones del panel de gestión marcaba siempre cero.** Leía
   `AppAtenciones.resumen()` en una pantalla donde nadie cargaba el panorama. Ahora se
   precarga al montar el feed y la cifra se repinta cuando llega. `precargar()` devuelve
   la promesa de la lectura para que quien enseñe un número pueda esperarla.

4. **La vista no cabía en un enlace.** La pestaña y la búsqueda vivían solo dentro del
   módulo. Ahora entran por `?sec=` y `?q=`, salen a la barra de direcciones al cambiar
   —la pestaña apila historial, la búsqueda lo reemplaza—, el botón atrás funciona, y hay
   un botón de copiar enlace. El panel entiende los mismos parámetros, así que el mismo
   destino sirve tanto si se abre encima de otra pantalla como si se abre entera.

5. **La pantalla completa no tenía buscador.** El panel sí, y era la misma lista. Ahora la
   pantalla lleva el suyo, con la misma aspa de limpiar y el mismo escalón de Escape.

6. **"Atenciones rescatables" no llevaba a las rescatables.** La entrada del buscador
   general y la del Portal abrían la pantalla en la pestaña de siempre. Ahora pasan
   `sec=publicas`. Lo mismo la tarjeta del panel de gestión cuando lo que cuenta son las
   liberadas.

7. **El buscador general ahora encuentra clientes, no solo la pantalla.** Escribir un
   teléfono en la paleta de comandos devuelve a la persona que lo dejó esperando, con su
   nombre, su tipo de atención y de quién es. Se responde con lo que ya está en memoria o
   en caché —ni una llamada al servidor por tecla— y el resultado abre esa atención ya
   filtrada.

8. **Pulsar "Atenciones" estando ya en la pantalla recargaba la aplicación entera** para
   acabar en el mismo sitio y perder la búsqueda escrita. Ahora actualiza la lista.

9. **Accesibilidad de las pestañas.** Eran botones con `role="tab"` y poco más: sin
   `type`, sin `aria-controls`, sin panel asociado y sin flechas del teclado. Ahora son un
   `tablist` completo, con un solo punto de entrada del tabulador. Los botones de hora
   sugerida nacen con `aria-pressed` en vez de estrenarlo al primer clic.

10. **Registrar desde una pantalla sin lista dejaba la atención sin rastro.** El alta se
    guardaba bien, pero como no había panorama cargado no había nada que repintar y se
    leía como que no se había guardado. Ahora se pide la lista al confirmarse.

11. **El menú lateral no navegaba desde la pantalla completa.** `atenciones.html` era la
    única pantalla de la aplicación sin `window.__APP__`, así que `AppUrl` arrancaba con
    la URL base vacía: `build()` devolvía `null` y cada clic del menú acababa en el aviso
    de "no pudimos abrir la pantalla" en vez de llevar a ninguna parte. El mismo hueco
    dejaba a `param()` leyendo la barra de direcciones del iframe del sandbox en vez de
    la del enlace, así que tampoco llegaba `?action=nueva` —ni habrían llegado `?sec=` ni
    `?q=`—. Se inyectan la base y los parámetros de vista antes de `app_core`, como en el
    resto de pantallas. Auditado: no queda ninguna otra sin la línea.

12. **El Inicio vuelve a ser solo de cotizaciones.** La tarjeta de atenciones partía en
    dos la pantalla que contesta una sola pregunta y obligaba a leer dos listas para
    llegar a la de siempre. Las atenciones siguen a un clic, en el botón de la barra
    lateral que las abre como panel encima —sin llevarse la pantalla— y en el buscador
    general. El Inicio sigue cargando el módulo para eso, y calienta la lista un segundo
    después de arrancar para que ese panel aparezca lleno.

#### Decisiones que se dejan como están (Atenciones)

- **El módulo no escribe la URL; solo avisa.** Cuando vive como panel encima de una
  cotización a medio escribir, reescribir la dirección se llevaría por delante el enlace
  de la pantalla anfitriona. Quien lo monta decide: `atenciones.html` lo lleva a la barra
  de direcciones, el inicio del asesor y el panel se lo callan.
- **Los enlaces de la barra lateral son `<button>` y no `<a>`.** Es del `app_shell`
  entero, no de este módulo, y cambiarlo toca todas las pantallas. Queda anotado para la
  revisión del shell.
- **Atenciones no aparece en el conmutador de "Funciones".** No es un área de trabajo en
  la que uno se queda: es un panel que se abre y se cierra. Su sitio es la barra, debajo
  de Inicio, que es donde está.
- **Los reintentos siguen declarados uno por uno.** Registrar, tomar y finalizar van con
  cero reintentos a propósito: repetir una escritura que crea algo daría de alta al mismo
  cliente dos veces o pisaría una reserva ajena. Solo lo idempotente —fijar unas
  anotaciones— reintenta.

### Portal (`Index.html`) — revisado

La landing pública del equipo: herramientas, paqueterías, formas de pago, formatos,
plantillas y los seis procesos de trazabilidad. Es el único archivo de la aplicación que
no usa el shell ni el motor de búsqueda compartidos —tiene los suyos— y sí carga
`app_core`, `app_prefs`, `app_guardado`, `app_onboarding` y `app_operacion`.

#### Qué se comprobó

| Punto | Estado |
|---|---|
| Enlaces al sitio correcto | Menú lateral, conmutador de áreas, tarjetas y buscador. Un fallo grave corregido (ver abajo) |
| Accesible e interpretable por URL | `?sec=`, `?q=` e `?item=`, con hash, atrás/adelante y ahora también salida a la barra de direcciones |
| Las funciones en el buscador general | Catálogo de pantallas de la app, secciones, promociones y anuncios. Faltaban dos entradas y el icono de una |
| Caché y almacenamiento local | Tres copias locales con stale-while-revalidate (Portal, Trazabilidad, promos); a la principal le faltaban versión y caducidad |
| Lenguaje no técnico | Revisado: avisos, vacíos y errores hablan de conexión y de datos, no de peticiones ni de caché |
| Funciones inteligentes | Ámbitos de búsqueda, accesos fijados, historial de copiados, colecciones y la recomendación nueva de atenciones |
| Estilo moderno y fluido (GSAP 3.13) | GSAP 3.13 con ScrollTrigger y MorphSVG, todo detrás de `GS()`, que respeta «reducir movimiento» |
| Mapeado por rol y permisos | `AppFunciones` decide las áreas y `appActionsPermitidas()` el buscador; la Gestión se pregunta al servidor |

#### Función nueva: «¿Tienes un cliente en la línea?»

Encima del hero, AppOperacion ya pintaba las incidencias vivas. Eso dice **qué pasa**;
faltaba **qué hacer**. Ahora, cuando hay una falla que corta la atención, aparece debajo
una recomendación en color de marca —no en rojo: dos alertas seguidas se leen como una— que
ofrece guardar el nombre y el teléfono del cliente antes de colgar.

Tres condiciones, y las tres importan:

- **Que la falla corte la atención.** Cuentan las incidencias en tono de aviso o de alerta
  (sospecha, confirmada, intermitencia). El mantenimiento programado no: está anunciado y
  nadie está atendiendo a ciegas.
- **Que quien mira tenga sesión y el bloque `atenciones`.** El Portal es la landing
  pública, y ofrecerle su libreta de clientes a un visitante anónimo solo produce un login
  que no venía a hacer.
- **Que no lo haya descartado ya para esa misma falla.** El descarte se guarda con la firma
  de las incidencias vivas, así que si mañana se cae otra cosa —o esta pasa de sospecha a
  confirmada— el aviso vuelve. Un descarte eterno convierte la recomendación en algo que se
  ve una vez en la vida; uno que no se respeta, en la caja que se cierra sin leer.

La caja aparece y se va sola según cambia el estado, sin recargar nada: se suscribe a
`AppOperacion.alCambiar`, que es nuevo y contesta también con lo que haya en caché.

#### Qué se corrigió

1. **Ningún resultado de «Funciones de la app» llevaba a su pantalla.** `goAppAction`
   recibe la entrada completa del catálogo y leía `entrada.page`, pero el destino vive un
   nivel más adentro, en `entrada.act`. Se llamaba siempre a `AppUrl.go(undefined)`, y el
   servidor resuelve como Portal cualquier página que no reconoce. Nadie lo veía como un
   fallo: pulsabas «Nueva cotización», la pantalla parpadeaba y seguías en el Portal, que
   es justo lo que parece cuando un enlace no hace nada.

2. **`AppOperacion` no tenía forma de avisar.** Quien quisiera reaccionar a una incidencia
   solo podía preguntar `estado()` con temporizadores, es decir, adivinar cuánto tarda el
   servidor y equivocarse por los dos lados. Ahora hay `alCambiar(cb)`, que llama también
   con lo que haya en caché y devuelve la función para dejar de escuchar.

3. **La búsqueda de sección entraba por la URL pero no salía.** Se podía llegar a
   «Paqueterías filtrado por guía» desde el buscador general y no se podía copiar ese mismo
   enlace desde el Portal. Ahora el filtro se escribe en la dirección según se teclea
   —reemplazando la entrada, no apilándola: una por tecla dejaría el botón atrás
   inservible— y cambiar de sección la apila con el filtro que esa sección tenga puesto.

4. **La copia local del Portal no tenía versión ni caducidad**, al contrario que la de
   Trazabilidad, que está en el mismo archivo. Una copia de hace meses se pintaba igual, y
   el día que cambiara la forma del dato se habría roto solo para quien ya había entrado
   antes. Ahora lleva versión y siete días, como su vecina.

5. **`icon('clock')` no existía** y `icon()` se cae a la llave inglesa cuando no encuentra
   el nombre: las dos entradas de Atenciones del buscador salían con el icono de
   Herramientas. No parece un fallo —parece una decisión— y manda a buscar al sitio
   equivocado. Auditado el catálogo entero: era el único nombre usado sin definir.

6. **Faltaban dos funciones muy buscadas en voz alta.** «Tablero de estado» (*¿está caído
   o soy yo?*) no lo contestaba nadie, solo salía el historial, que es otra cosa. Y
   «Reportar una falla» no estaba: ahora se ejecuta **sin cambiar de pantalla**, abriendo
   el panel de AppOperacion sobre el Portal, porque mandar a alguien a otra vista para
   avisar de una caída le cobra una carga completa de Apps Script justo cuando menos tiempo
   tiene. Para eso el catálogo admite acciones locales (`act.fn`).

7. **`item` no estaba en `PARAMS_VISTA`.** La paleta de comandos ya construía enlaces
   `portal?sec=…&q=…&item=…` y funcionaban de casualidad, porque el Portal lee la URL real;
   pero `AppUrl.params()` no lo devolvía. Añadido a las dos listas espejo.

#### Decisiones que se dejan como están (Portal)

- **El Portal conserva su propio motor de búsqueda.** `AppBuscar` unificó el criterio de
  coincidencia del resto de la aplicación, y este archivo se quedó fuera. El suyo es bueno
  —tolera erratas, entiende sinónimos y frases, y admite ámbitos por sección—, pero es una
  segunda implementación. Migrarlo es una tarea propia, con sus quince índices y su
  resaltado, y no cabe dentro de una revisión: queda anotado.
- **Los datos siguen guardándose con `lsGet`/`lsSet` y no con `AppCache`.** Son tres copias
  con su propia forma (versión, firma y antigüedad visible) y ya funcionan; pasarlas a
  `AppCache` daría cuota y purga automáticas a cambio de tocar tres módulos que hoy están
  bien. Anotado, no urgente.
- **La recomendación de atenciones enlaza en vez de abrir el formulario aquí.** El módulo
  `app_atenciones` usa los estilos del shell de Cotizaciones, que el Portal no carga: su
  formulario aparecería sin formato. El destino viaja por la URL, que funciona igual desde
  cualquier parte.
