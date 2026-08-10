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

#### Decisiones que se dejan como están

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
