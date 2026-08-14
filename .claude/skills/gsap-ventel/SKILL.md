---
name: gsap-ventel
description: Uso profesional y avanzado de GSAP 3.13 en el sistema de cotizaciones Ventel (Google Apps Script HTML Service). Reglas de la casa por encima de las skills oficiales gsap-*. Úsala siempre que se toque animación, movimiento, transición, entrada de pantalla, loader o espera, modal o panel, revelado en scroll, ScrollTrigger, SplitText, MorphSVG, DrawSVG, Flip, o cuando algo "parpadea", "salta", "se queda oculto" o "va lento" al animar. También al revisar un PR que toque cualquier `.html` de "Carpeta del proyecto".
license: MIT
---

# GSAP 3.13 en Ventel — reglas de la casa

## Cuándo se usa

Antes de escribir o revisar cualquier animación en este repositorio. Las skills
oficiales de GreenSock (`gsap-core`, `gsap-timeline`, `gsap-scrolltrigger`,
`gsap-plugins`, `gsap-utils`, `gsap-performance`) explican **la librería**; esta
explica **este proyecto**, y manda sobre ellas cuando se contradicen.

Dos de las oficiales no aplican aquí y hay que ignorarlas: `gsap-react` y
`gsap-frameworks`. Este proyecto no tiene npm, ni bundler, ni React, ni Vue. Si
una skill sugiere `import { gsap } from "gsap"` o `useGSAP()`, está fuera de
contexto: aquí GSAP llega por `<script>` desde el CDN y vive en `window`.

---

## 1. El contrato irrenunciable: la app nunca se queda oculta

Es la regla que gobierna todo lo demás. Una pantalla de Apps Script se sirve
dentro de un iframe con el CDN de Cloudflare como dependencia externa, en una
red corporativa que a veces lo bloquea. Si la animación es la que revela el
contenido, un CDN caído deja la pantalla en blanco y el trabajo parado.

De ahí las tres condiciones que se comprueban en cada revisión:

1. **El contenido es visible sin GSAP.** Nunca se parte de `opacity: 0` en CSS
   para que GSAP lo suba. Se parte de visible y se anima con `gsap.from()` /
   `fromTo()`, o el estado oculto lo pone JavaScript **solo después** de
   confirmar que GSAP cargó.
2. **`prefers-reduced-motion` se respeta siempre**, y respetar no es "no
   animar": es enseñar el resultado final de inmediato.
3. **Sin GSAP y con movimiento reducido se degrada igual**: el mismo camino de
   código, para que solo haya dos estados que probar y no cuatro.

El guardián canónico ya existe en `app_motion.html` y se copia, no se reinventa:

```js
const reduced = window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function ok() { return typeof window.gsap !== 'undefined' && !reduced; }
// ...
if (!ok()) { items.forEach(el => el.style.opacity = 1); return; }
```

---

## 2. No reinventes el motor: lo que ya está escrito

Antes de escribir un `gsap.to()` suelto, busca si la pieza ya existe. Casi
siempre existe, y duplicarla es cómo se desincroniza el sistema.

| Necesidad | Pieza | Archivo |
|---|---|---|
| Entrada escalonada de una pantalla | `AppMotion.enter(root)` sobre `[data-animate]` | `app_motion.html` |
| Filas de tabla en cascada | `AppMotion.staggerRows(rows)` | `app_motion.html` |
| KPI que cuenta hasta su valor | `AppMotion.countUp(el, valor, fmt)` | `app_motion.html` |
| Abrir/cerrar modal o panel | `AppMotion.modalIn/modalOut(overlay, card)` | `app_motion.html` |
| Micro-feedback y error | `AppMotion.pop(el)`, `AppMotion.shake(el)` | `app_motion.html` |
| Aviso flotante | `AppMotion.toast(msg, tipo)` | `app_motion.html` |
| Tapar la pantalla entera mientras no hay nada | `VentelLoader` | `LoaderPartial.html` |
| Esperar datos con el HTML ya pintado | `VentelLoaders` (`isotipo`, `cajas`, `onda`) | `app_loaders.html` |
| Espera sin depender del CDN | `VentelTruck` (100 % CSS a propósito) | `TruckLoaderPartial.html` |
| Geometría del isotipo (no pegar los 4 KB del trazado) | `VentelLoader.marca` | `LoaderPartial.html` |

Si la animación nueva se va a usar en más de una pantalla, su sitio es
`app_motion.html`, no la pantalla.

---

## 3. Carga: la versión está fijada y el origen debe ser uno solo

El proyecto está clavado en **3.13.0** (publicada el 30 de abril de 2025; la
versión que estrenó el reescrito de SplitText y la primera con **todos** los
plugins gratis tras la compra por Webflow). Existen versiones más nuevas —3.15.0
es la actual—, pero aquí la versión se sube a propósito y en un solo cambio, no
pantalla por pantalla: un `.html` con 3.13 y otro con 3.15 significa dos motores
distintos en la misma sesión.

Nunca uses `latest` ni un rango: sin bundler ni `package-lock`, la URL **es** el
lockfile.

Todos los plugins de 3.13.0 están en cdnjs, **MorphSVG incluido**
(`.../3.13.0/MorphSVGPlugin.min.js`, 200 OK, 16.6 KB). Traerlo desde jsDelivr
—como aún hacen `Index.html`, `Promociones.html` y `app_motion.html`— añade un
segundo dominio: otro DNS, otro TLS y un segundo punto de fallo para nada. Al
tocar esos archivos, unifica en cdnjs.

Carga solo el plugin que la pantalla usa. La tabla completa de URLs y pesos, y
qué carga hoy cada pantalla, está en `referencias/cdn-3.13.md`.

El registro va siempre defendido, porque el plugin puede no haber llegado:

```js
if (window.gsap && window.MorphSVGPlugin) gsap.registerPlugin(MorphSVGPlugin);
```

`gsap.registerPlugin()` es obligatorio para todos los plugins salvo el núcleo, y
`ScrollTrigger` no es una excepción aunque a veces parezca funcionar sin él.

---

## 4. Apps Script: lo que cambia respecto a una página normal

- **Todo corre dentro de un iframe** (`userCodeAppPanel`). `window.innerHeight`
  es el alto del iframe, no el de la ventana del navegador. `position: fixed` se
  ancla al iframe. No intentes leer ni animar la página padre.
- **ScrollTrigger funciona con el `scroller` por defecto** —está comprobado en
  `Index.html`— porque el que scrollea es el propio iframe. Si algún día la vista
  scrollea dentro de un `div` con `overflow:auto`, hay que pasarle
  `scroller: elemento`; sin eso los `start`/`end` se miden contra el sitio
  equivocado y los revelados disparan todos a la vez.
- **No metas `ScrollSmoother` ni `normalizeScroll()`.** Reescriben el scroll de
  un contenedor que aquí no es del todo nuestro, y el resultado dentro del iframe
  es peor que el scroll nativo.
- **`include()` puede insertar el mismo partial dos veces.** Todo módulo de
  animación se auto-monta de forma idempotente. La convención ya existe: marcar
  el nodo con `data-vx-listo` y salir si ya está (`app_loaders.html:423`), o el
  seguro `_vxDone` que usa `finish()`.
- **`google.script.run` no bloquea el hilo**, pero pintar la respuesta sí. Anima
  *después* de pintar, en el mismo frame no: `requestAnimationFrame` primero, o
  el primer fotograma sale a destiempo.

---

## 5. Escalonado: `amount`, casi nunca un número fijo

La lección más cara del proyecto, ya escrita en `app_motion.html`: `stagger: .09`
es un escalón **por elemento**. En una tarjeta de cuatro bloques es un suspiro;
en el panel de supervisión, con dieciocho, el último aparece casi dos segundos
tarde y la persona ya está leyendo mientras el pie todavía se dibuja. Una tabla
de doscientas filas tarda nueve segundos en terminar de entrar.

```js
stagger: { amount: Math.min(.45, items.length * .06) }
```

`amount` reparte un tiempo **total** entre los que haya: cuatro o dieciocho, la
entrada acaba a la vez. El `Math.min` pone el techo. Usa un escalón fijo solo
cuando el número de elementos esté acotado por diseño (los cuatro estados de un
selector, los siete días de una semana).

Para rejillas, `stagger: { grid: 'auto', from: 'center', amount: .5 }`.

---

## 6. Ciclo de vida: lo que se crea hay que poder matarlo

Esta app repinta secciones enteras sin recargar. Cada repintado que crea tweens y
ScrollTriggers sin limpiar los anteriores deja triggers apuntando a nodos que ya
no existen: cálculos en cada scroll, `refresh()` cada vez más caro y revelados
que no disparan.

Hoy el repositorio llama a `ScrollTrigger.refresh()` en una veintena de sitios y
no mata nada en ninguno. Se sostiene por las banderas `…RevealsReady`, que
impiden construir dos veces; es frágil. En código nuevo, agrupa por
`gsap.context()`:

```js
let ctx;                                  // uno por vista
function pintarVista(root, datos) {
  ctx && ctx.revert();                    // deshace tweens, triggers y estilos
  render(root, datos);
  ctx = gsap.context(() => {
    gsap.from('[data-animate]', { opacity: 0, y: 22, duration: .55,
      ease: 'power3.out', stagger: { amount: .45 } });
    ScrollTrigger.batch('[data-reveal]', {
      start: 'top 88%',
      onEnter: b => gsap.to(b, { opacity: 1, y: 0, stagger: { amount: .3 } })
    });
  }, root);                               // los selectores se limitan a root
  requestAnimationFrame(() => ScrollTrigger.refresh());
}
```

Tres cosas que hace ese bloque y conviene no perder:

- `ctx.revert()` es la única limpieza que devuelve además los estilos inline.
- `ScrollTrigger.batch()` en vez de un trigger por tarjeta: en una rejilla de
  cien elementos son cien observadores contra uno, y las que entran juntas se
  animan juntas.
- El `refresh()` va **después de pintar y dentro de un rAF**. Llamado en el mismo
  frame mide un layout a medio hacer.

Al salir de la vista: `ctx.revert()`. Al cambiar de pantalla completa:
`ScrollTrigger.getAll().forEach(t => t.kill())`.

---

## 7. SplitText 3.13: `autoSplit` sin `onSplit` es un fallo latente

3.13 reescribió SplitText —la mitad de peso, accesibilidad de serie y máscaras—.
Dos opciones nuevas cambian cómo se escribe:

- **`autoSplit: true`** vuelve a partir el texto cuando carga la fuente o cambia
  el ancho. Al hacerlo, **destruye los nodos anteriores**.
- **`onSplit(self)`** corre en cada partición. La animación se crea **dentro** y
  se **devuelve**, para que SplitText la limpie y sincronice al repartir.

Por eso esto es un fallo esperando a pasar (`estado.html:1092`): con
`autoSplit: true`, el `tl.from(split.chars, …)` de fuera anima nodos que la
siguiente partición ya tiró. En un titular corto y una fuente en caché no se ve;
en móvil al girar, o con la fuente llegando tarde, el titular se queda a medias.

```js
SplitText.create(titulo, {
  type: 'words,chars',      // nunca 'chars' solo: el navegador parte a mitad de palabra
  autoSplit: true,
  mask: 'chars',            // 3.13: envuelve en overflow:clip, el revelado sale limpio
  aria: 'auto',             // por defecto: aria-label en el original, aria-hidden en los trozos
  onSplit(self) {
    return gsap.from(self.chars, {   // devolver = limpieza y sincronía automáticas
      yPercent: 110, opacity: 0, duration: .8,
      stagger: { amount: .5 }, ease: 'power4.out'
    });
  }
});
```

Complementos: parte después de `document.fonts.ready` si no usas `autoSplit`;
`font-kerning: none` en el titular evita el salto de kerning; SplitText no
funciona sobre `<text>` de SVG; y con movimiento reducido no partas nada —enseña
el titular y ya.

---

## 8. Rendimiento: el presupuesto de esta app

Vale lo que dice `gsap-performance`; encima, lo propio de aquí:

- **Transform y opacity, nada más.** `x`/`y`/`scale`/`rotation`. Animar `width`,
  `height`, `top` o `left` provoca layout en cada frame, y aquí muchas vistas son
  rejillas grandes.
- **`clearProps: 'transform'` al terminar** una entrada. Si no, cada tarjeta
  queda con una capa de composición viva para siempre; con doscientas, el scroll
  se arrastra. Ya se usa en `AppMotion.enter`.
- **`overwrite: 'auto'`** en cualquier animación que pueda dispararse dos veces
  (hover, revalidación de `AppRun.swr`, reintento de guardado). Sin eso se
  encadenan dos tweens sobre la misma propiedad y el elemento tiembla.
- **`gsap.quickTo()`** para lo que se actualiza cada frame (seguidores del ratón,
  barras de progreso en vivo): reutiliza un tween en vez de crear uno por evento.
- **Un timeline pausado y reutilizado** vale más que crear uno en cada
  `mouseenter`. Guárdalo en el nodo y haz `play()` / `reverse()`.
- **Sin `will-change` preventivo.** Solo en lo que anima de verdad, y quitándolo
  después.

---

## 9. Anti-patrones concretos, con su porqué

| No hagas | Por qué |
|---|---|
| `opacity: 0` en CSS y "ya lo sube GSAP" | Si el CDN falla, la pantalla queda en blanco |
| `stagger: .09` en listas de tamaño variable | El último elemento entra segundos tarde |
| `autoSplit: true` con la animación fuera de `onSplit` | Anima nodos ya destruidos |
| Un `scrollTrigger` por tarjeta en una rejilla | Usa `ScrollTrigger.batch()` |
| `ScrollTrigger.refresh()` en el mismo frame del render | Mide un layout a medio hacer |
| Crear timelines sin `gsap.context()` en vistas que repintan | Se acumulan y no se pueden matar |
| Segundo CDN solo para MorphSVG | cdnjs ya lo sirve en 3.13.0 |
| `@keyframes` para un morph o un ease de verdad | El movimiento bueno está en la interpolación |
| Animar el skeleton y el contenido a la vez | Primero `VentelLoaders.finish()`, luego la entrada |
| `ScrollSmoother` / `normalizeScroll()` | Pelean con el scroll del iframe de Apps Script |

---

## 10. Checklist antes de dar por buena una animación

- [ ] Con el CDN bloqueado (DevTools → Network → Block request domain), ¿se lee
      todo el contenido?
- [ ] Con `prefers-reduced-motion: reduce` forzado, ¿aparece el resultado final
      sin movimiento?
- [ ] ¿Existe ya la pieza en `AppMotion` / `VentelLoaders`?
- [ ] ¿El escalonado usa `amount` y tiene techo?
- [ ] ¿Los ScrollTriggers y timelines mueren al salir de la vista?
- [ ] ¿Solo se animan transform y opacity, con `clearProps` al final?
- [ ] ¿La versión sigue siendo 3.13.0 y desde cdnjs?
- [ ] ¿Se registró el plugin y se comprobó antes que existe?
- [ ] Si hay SplitText: ¿`onSplit` devuelve la animación? ¿`aria` correcto?
- [ ] ¿Se probó con datos reales, no con tres filas de ejemplo?

---

## Referencias

- `referencias/cdn-3.13.md` — URLs y pesos de todos los plugins 3.13.0, y qué
  carga hoy cada pantalla.
- `referencias/recetas.md` — recetas listas para pegar, ya degradadas.
- Skills oficiales de GreenSock instaladas al lado: `gsap-core`,
  `gsap-timeline`, `gsap-scrolltrigger`, `gsap-plugins`, `gsap-utils`,
  `gsap-performance`.
