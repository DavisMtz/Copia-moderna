# 11 · Animación con GSAP 3.13

Dónde vive el movimiento de la aplicación, qué reglas tiene y por qué. Este
documento es el mapa; el detalle operativo está en las *skills* de
[`.claude/skills/`](../.claude/skills/README.md), que es lo que lee Claude Code
cuando alguien le pide tocar una animación.

---

## 1. Por qué esto está escrito

La animación de esta aplicación no es decoración. Un sistema que consulta hojas
de cálculo tiene esperas largas e inevitables, y lo que se enseña durante esa
espera decide si la persona cree que la app está trabajando o que se colgó. Por
eso hay cuatro familias de loaders y un motor central en vez de un `fade` suelto
en cada pantalla.

Y por eso hay una regla que no se negocia: **la app nunca se queda oculta**.
GSAP llega por CDN, dentro de un iframe de Apps Script, en redes corporativas que
a veces bloquean Cloudflare. Si la animación es lo que revela el contenido, un
CDN caído deja a alguien mirando una pantalla en blanco con un cliente al
teléfono. Todo lo demás sale de ahí.

---

## 2. Las piezas

| Pieza | Archivo | Qué resuelve |
|---|---|---|
| `AppMotion` | `app_motion.html` | El motor: entradas, cascadas, modales, contadores, avisos |
| `VentelLoader` | `LoaderPartial.html` | Tapa la pantalla entera cuando no hay **nada** que enseñar |
| `VentelLoaders` | `app_loaders.html` | El HTML ya está pintado y solo faltan los datos |
| `VentelTruck` | `TruckLoaderPartial.html` | Lo mismo, **100 % CSS**: funciona aunque el CDN no conteste |

Las tres primeras familias usan GSAP porque el movimiento bueno está en la
interpolación —un morph, un escalonado repartido y un *ease* de verdad no se
escriben con `@keyframes`—. La cuarta es CSS a propósito, para que quede al menos
un loader completo cuando GSAP no llega.

Nada de esto se duplica en una pantalla. Si una animación va a usarse en más de
un sitio, su lugar es `app_motion.html`.

---

## 3. La versión está fijada

Todo el proyecto usa **GSAP 3.13.0** desde cdnjs. No hay `package.json` ni
bundler: la URL **es** el lockfile, así que nunca se escribe `latest` ni un
rango, y la versión se sube en un solo cambio con todas las pantallas a la vez.
Dos pantallas con motores distintos en la misma sesión es un problema difícil de
ver y fácil de crear.

Desde que Webflow compró GSAP (abril de 2025), **todos los plugins son
gratuitos**, incluidos SplitText y MorphSVG. Si alguna guía antigua pide un token
de Club GreenSock o un registro privado de npm, está caducada.

La tabla completa de URLs, pesos y qué carga hoy cada pantalla está en
[`.claude/skills/gsap-ventel/referencias/cdn-3.13.md`](../.claude/skills/gsap-ventel/referencias/cdn-3.13.md).

---

## 4. Las tres condiciones de cada animación

1. **Se lee sin GSAP.** Nunca se parte de `opacity: 0` en el CSS esperando que
   GSAP lo suba. Se parte de visible y se anima con `from()`, o el estado oculto
   lo pone JavaScript después de comprobar que GSAP cargó.
2. **`prefers-reduced-motion` se respeta**, y respetarlo significa enseñar el
   resultado final de inmediato, no quedarse a medias.
3. **Sin GSAP y con movimiento reducido se comportan igual**, por el mismo camino
   de código: dos estados que probar en vez de cuatro.

Se comprueban con el navegador: DevTools → Network → *Block request domain*
sobre `cdnjs.cloudflare.com`, y DevTools → Rendering → *Emulate
prefers-reduced-motion*.

---

## 5. Lo que hay pendiente

Tres cosas conocidas, anotadas aquí para que no se redescubran:

- **MorphSVG se trae de jsDelivr** en `Index.html`, `Promociones.html` y
  `app_motion.html`. Es herencia de cuando el plugin era de pago y no estaba en
  cdnjs; ya lo está. Mantener dos CDN añade otro DNS, otro TLS y otro punto de
  fallo para nada.
- **Los ScrollTrigger no se matan nunca.** Hay una veintena de
  `ScrollTrigger.refresh()` repartidos y ningún `kill()`. Hoy se sostiene por las
  banderas `…RevealsReady`, que evitan construir dos veces; en cuanto una vista
  repinte de verdad, empezarán a acumularse triggers apuntando a nodos muertos.
  El camino es `gsap.context()` por vista y `revert()` al salir.
- **`estado.html:1092` usa `autoSplit: true` con la animación fuera de
  `onSplit()`.** Con SplitText 3.13, cada re-partición (al cargar la fuente o al
  girar el móvil) destruye los nodos que ese *tween* está animando.

---

## 6. Para trabajar con Claude Code

Las instrucciones están instaladas en el repositorio, en `.claude/skills/`: las
ocho oficiales de GreenSock más `gsap-ventel`, que es la de la casa y manda sobre
las demás. Se cargan solas cuando la conversación toca animación; no hay que
invocarlas.

Están copiadas dentro del repositorio y no instaladas con un gestor porque las
sesiones de claude.ai/code arrancan un contenedor nuevo cada vez: cualquier
instalación local se pierde, y lo que está en git no.
