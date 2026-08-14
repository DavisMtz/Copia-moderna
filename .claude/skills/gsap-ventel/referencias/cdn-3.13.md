# GSAP 3.13.0 desde CDN — URLs, pesos y qué carga cada pantalla

Datos medidos contra cdnjs el 14 de agosto de 2026. Todos los archivos
responden **200** en `3.13.0`: desde que Webflow liberó GSAP (abril de 2025) no
hay plugins de pago, ni token, ni registro privado.

## 1. Plantilla de carga

```html
<!-- Núcleo. Siempre primero. -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/gsap.min.js"></script>
<!-- Solo los plugins que ESTA pantalla usa. -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/ScrollTrigger.min.js"></script>
<script>
  if (window.gsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
</script>
```

El patrón general de la URL:

```
https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/<Archivo>.min.js
```

Reglas: la versión va escrita (nunca `latest`), el origen es cdnjs y solo cdnjs,
y `gsap.min.js` va antes que cualquier plugin.

## 2. Tabla de archivos

«Comprimido» es lo que viaja de verdad por la red (gzip; brotli en el núcleo).

| Archivo | Sin comprimir | Comprimido | Para qué |
|---|---:|---:|---|
| `gsap.min.js` | 72.4 KB | 25.6 KB | Núcleo. Obligatorio. Incluye CSSPlugin, Snap y los eases base |
| `ScrollTrigger.min.js` | 44.2 KB | 17.9 KB | Revelados y anclajes al hacer scroll |
| `MorphSVGPlugin.min.js` | 16.6 KB | 7.6 KB | Morfismo del isotipo (loaders) |
| `SplitText.min.js` | 7.2 KB | 3.4 KB | Titulares por letra, palabra o línea |
| `DrawSVGPlugin.min.js` | 4.4 KB | 2.2 KB | Trazos de SVG que se dibujan |
| `Observer.min.js` | 10.0 KB | 4.3 KB | Gestos unificados (rueda, táctil, puntero) |
| `Flip.min.js` | 25.0 KB | 9.6 KB | Animar un cambio de layout (tarjeta → panel) |
| `Draggable.min.js` | 35.5 KB | 13.5 KB | Arrastrar y soltar |
| `InertiaPlugin.min.js` | 7.3 KB | 3.2 KB | Inercia al soltar (necesita Draggable) |
| `MotionPathPlugin.min.js` | 21.7 KB | 9.7 KB | Mover algo por un trazado |
| `ScrollToPlugin.min.js` | 4.1 KB | 2.0 KB | Desplazar a una posición con ease |
| `CustomEase.min.js` | 7.1 KB | 3.7 KB | Curvas de aceleración propias |
| `EasePack.min.js` | 2.4 KB | 1.3 KB | Rough, SlowMo, ExpoScale |
| `CustomWiggle.min.js` | 2.3 KB | 1.2 KB | Oscilación (necesita CustomEase) |
| `CustomBounce.min.js` | 2.1 KB | 1.1 KB | Rebote (necesita CustomEase) |
| `TextPlugin.min.js` | 10.6 KB | 3.6 KB | Sustituir texto letra a letra |
| `ScrambleTextPlugin.min.js` | 11.7 KB | 4.0 KB | Texto que se descifra |
| `Physics2DPlugin.min.js` | 2.2 KB | 1.2 KB | Velocidad, gravedad, ángulo |
| `PhysicsPropsPlugin.min.js` | 2.0 KB | 1.1 KB | Física por propiedad suelta |
| `CSSRulePlugin.min.js` | 1.7 KB | 1.0 KB | Pseudoelementos (`::before`) |
| `EaselPlugin.min.js` | 4.8 KB | 2.2 KB | EaselJS / canvas |
| `PixiPlugin.min.js` | 6.6 KB | 2.9 KB | PixiJS |
| `ScrollSmoother.min.js` | 13.4 KB | 5.5 KB | **No usar aquí** (pelea con el iframe) |
| `GSDevTools.min.js` | 61.9 KB | 22.8 KB | Solo en depuración local, nunca publicado |
| `MotionPathHelper.min.js` | 43.9 KB | 15.2 KB | Solo en depuración local |
| `all.min.js` | 319.4 KB | 121.5 KB | **No usar**: trae los 25 plugins |

`all.min.js` cuesta cinco veces lo que el núcleo. En una app que la gente abre
decenas de veces al día, y con Apps Script añadiendo su propia latencia de
arranque, no se justifica nunca.

## 3. Qué carga hoy cada pantalla

| Archivo del proyecto | Carga | Origen |
|---|---|---|
| `app_motion.html` | gsap, MorphSVGPlugin | cdnjs + **jsDelivr** |
| `Index.html` | gsap, ScrollTrigger, SplitText, MorphSVGPlugin | cdnjs |
| `Promociones.html` | gsap, ScrollTrigger, MorphSVGPlugin | cdnjs + **jsDelivr** |
| `estado.html` | ScrollTrigger, SplitText | cdnjs |
| `inicioDeSesion.html` | SplitText, DrawSVGPlugin | cdnjs |
| `recuperar.html` | SplitText, DrawSVGPlugin | cdnjs |
| `registro.html` | SplitText, DrawSVGPlugin | cdnjs |

Dos cosas que leer en esta tabla:

1. **MorphSVG viene de jsDelivr en dos archivos** —`app_motion.html` y
   `Promociones.html`—. Es herencia de cuando el plugin era de pago y no estaba
   en cdnjs; ya lo está. Mantenerlo así obliga al navegador a resolver un dominio
   más y añade un segundo servicio que puede caerse. Al tocar esos archivos,
   cámbialo a
   `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/MorphSVGPlugin.min.js`.
   `Index.html` ya está unificado en cdnjs: sirve de ejemplo del resultado.
2. **`estado.html` y las pantallas de sesión no cargan `gsap.min.js`**, y está
   bien: lo trae `app_motion.html` por `include()`. Cargarlo otra vez no es solo
   peso duplicado — un segundo `gsap` global sobrescribiría el primero y los
   tweens ya creados quedarían huérfanos. Antes de añadir un `<script>` de GSAP a
   una pantalla, comprueba qué partials incluye.

## 4. Subir de versión

Aunque 3.15.0 sea la última (abril de 2026), aquí la versión se sube en un solo
cambio y con las siete pantallas a la vez. Sin `package.json` que las mantenga
alineadas, la URL es el lockfile, y dos versiones conviviendo en una sesión
significan dos motores distintos animando la misma pantalla.

El procedimiento: sustituir `3.13.0` en los siete archivos, comprobar los
loaders (`isotipo` es el que más depende de MorphSVG), los titulares con
SplitText de las tres pantallas de sesión, y los revelados de `Index.html` y
`Promociones.html` con datos reales.
