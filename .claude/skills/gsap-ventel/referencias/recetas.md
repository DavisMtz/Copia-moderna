# Recetas GSAP 3.13 para Ventel

Patrones listos para pegar, ya degradados y ya limpiables. Todas asumen el
guardián de `app_motion.html`:

```js
const reduced = window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function ok() { return typeof window.gsap !== 'undefined' && !reduced; }
```

Antes de usar cualquiera de estas: comprueba que la pieza no exista ya en
`AppMotion` o `VentelLoaders`. Duplicarla es cómo se desincroniza el sistema.

---

## 1. Efectos con nombre: escribir la animación una vez

`gsap.registerEffect()` es la forma profesional de que "aparecer" signifique lo
mismo en todas las pantallas. Se declara una vez en `app_motion.html` y a partir
de ahí se llama por nombre, también dentro de un timeline.

```js
gsap.registerEffect({
  name: 'entra',
  extendTimeline: true,              // permite tl.entra(el, {...})
  defaults: { duration: .55, y: 22, ease: 'power3.out' },
  effect: (targets, cfg) => gsap.from(targets, {
    opacity: 0, y: cfg.y, duration: cfg.duration, ease: cfg.ease,
    force3D: true, overwrite: 'auto', clearProps: 'transform',
    stagger: { amount: Math.min(.45, targets.length * .06) }
  })
});

gsap.effects.entra('[data-animate]');
gsap.timeline().entra('.tarjeta').entra('.pie', { y: 12 }, '-=.3');
```

Con eases de marca:

```js
gsap.registerPlugin(CustomEase);
CustomEase.create('vxSalida', 'M0,0 C0.25,0.1 0.25,1 1,1');
gsap.defaults({ ease: 'power3.out', duration: .5 });   // valores de la casa
```

---

## 2. Movimiento reducido y breakpoints en un solo sitio

Hoy el repositorio consulta `prefers-reduced-motion` a mano en 68 puntos, y esas
consultas leen `.matches` una vez: si alguien cambia el ajuste del sistema con la
app abierta, no se enteran. `gsap.matchMedia()` reacciona y además **revierte
solo** lo que creó cuando la condición deja de cumplirse.

```js
const mm = gsap.matchMedia();

mm.add({
  anima:   '(prefers-reduced-motion: no-preference)',
  escrito: '(min-width: 1025px)'
}, (self) => {
  const { anima, escrito } = self.conditions;
  if (!anima) {                                   // resultado final, sin movimiento
    gsap.set('[data-animate]', { opacity: 1, y: 0, clearProps: 'transform' });
    return;
  }
  gsap.from('[data-animate]', {
    opacity: 0, y: escrito ? 22 : 12, duration: .55, ease: 'power3.out',
    stagger: { amount: .45 }
  });
});

// Al salir de la vista:
mm.revert();
```

---

## 3. Revelado en scroll de una rejilla larga

Un `scrollTrigger` por tarjeta en una rejilla de cien elementos son cien
observadores midiendo en cada scroll. `ScrollTrigger.batch()` agrupa las que
entran juntas y las anima juntas.

```js
if (!ok()) {
  gsap.utils.toArray('[data-reveal]').forEach(el => el.style.opacity = 1);
} else {
  gsap.set('[data-reveal]', { opacity: 0, y: 18 });   // el estado oculto lo pone JS, no el CSS
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 88%',
    batchMax: 12,                                    // techo por tanda
    onEnter: lote => gsap.to(lote, {
      opacity: 1, y: 0, duration: .4, ease: 'power3.out',
      stagger: { amount: .3 }, clearProps: 'transform', overwrite: 'auto'
    })
  });
  requestAnimationFrame(() => ScrollTrigger.refresh());
}
```

`gsap.set` en vez de CSS es lo que cumple el contrato: si GSAP no cargó, esa
línea no corre y las tarjetas nacen visibles.

---

## 4. Tarjeta que se convierte en panel (Flip)

Cuando el elemento **cambia de sitio en el layout** —una atención de la lista
que se abre como panel—, animar `x`/`y` a ojo se rompe en cuanto cambia el ancho.
Flip mide el antes, deja que el DOM haga su cambio, y anima la diferencia.

```js
gsap.registerPlugin(Flip);

function abrirPanel(tarjeta, destino) {
  if (!ok()) { destino.appendChild(tarjeta); return; }
  const estado = Flip.getState(tarjeta, { props: 'borderRadius,backgroundColor' });
  destino.appendChild(tarjeta);                 // el cambio real de layout
  Flip.from(estado, {
    duration: .45, ease: 'power2.inOut',
    absolute: true,                             // evita que arrastre a los hermanos
    onComplete: () => ScrollTrigger.refresh()   // el layout cambió: hay que remedir
  });
}
```

---

## 5. Titular por letras, con máscara (SplitText 3.13)

Ver §7 de la skill: con `autoSplit`, la animación va **dentro** de `onSplit` y se
**devuelve**.

```js
if (ok() && window.SplitText) {
  gsap.registerPlugin(SplitText);
  document.fonts.ready.then(() => {
    SplitText.create('[data-split]', {
      type: 'words,chars',        // nunca 'chars' solo
      autoSplit: true,
      mask: 'chars',
      aria: 'auto',
      onSplit: self => gsap.from(self.chars, {
        yPercent: 110, opacity: 0, duration: .8,
        stagger: { amount: .5 }, ease: 'power4.out'
      })
    });
  });
}
// Sin GSAP o con movimiento reducido: el titular ya está ahí, escrito y legible.
```

---

## 6. Transición entre vistas sin dejar basura

```js
let ctxVista;

function irA(root, pintar, datos) {
  const salida = ok()
    ? gsap.to(root.children, { opacity: 0, y: -10, duration: .18, ease: 'power2.in' })
    : { then: f => f() };

  Promise.resolve(salida).then(() => {
    ctxVista && ctxVista.revert();                 // tweens, triggers y estilos, fuera
    pintar(root, datos);
    ctxVista = gsap.context(() => {
      gsap.effects.entra('[data-animate]');
      ScrollTrigger.batch('[data-reveal]', { start: 'top 88%',
        onEnter: l => gsap.to(l, { opacity: 1, y: 0, stagger: { amount: .3 } }) });
    }, root);                                      // selectores limitados a root
    requestAnimationFrame(() => ScrollTrigger.refresh());
  });
}
```

Al desmontar del todo: `ctxVista.revert()` y
`ScrollTrigger.getAll().forEach(t => t.kill())`.

---

## 7. Espera de datos: primero la salida del loader, luego la entrada

Animar el esqueleto y el contenido a la vez produce dos movimientos peleándose.
El orden correcto es: cerrar la espera, y cuando ha cerrado, entrar.

```js
const hueco = document.querySelector('[data-vx-loader="onda"]');
VentelLoaders.mount(hueco, { mensajes: ['Consultando la hoja…'] });

AppRun.swr('pedidos-' + email, 'listarPedidos', [email], {
  ttl: 5 * 60000,
  onData: function (datos, deCache) {
    pintarTabla(datos);                    // idempotente: repinta, no añade
    VentelLoaders.finish(hueco);           // salida cinematográfica + limpieza
    if (deCache) return;                   // la cascada, solo una vez
    AppMotion.staggerRows(document.querySelectorAll('#tabla tbody tr'));
  }
});
```

El detalle que se escapa siempre: **`onData` se llama dos veces** cuando había
caché —primero con lo guardado, después con la respuesta del servidor—. Si la
animación de entrada va sin el `if (deCache) return`, la tabla vuelve a entrar en
cascada medio segundo después de que la persona ya empezó a leer, y parece un
fallo. `VentelLoaders.finish()` sí puede llamarse dos veces: lleva su propio
seguro (`_vxDone`) y la segunda es un no-op.

Para tapar la pantalla entera mientras no hay **nada** que enseñar, es
`VentelLoader`, no `VentelLoaders`. Son piezas distintas y no se mezclan.

---

## 8. Micro-interacción reutilizable: una timeline, no una por evento

Crear un tween en cada `mouseenter` genera basura y encadena animaciones. Se
construye una vez, pausada, y se guarda en el propio nodo.

```js
function prepararHover(el) {
  if (!ok()) return;
  const tl = gsap.timeline({ paused: true })
    .to(el, { y: -3, scale: 1.02, duration: .22, ease: 'power2.out' })
    .to(el.querySelector('.ic'), { rotate: -6, duration: .22 }, 0);
  el._tl = tl;
  el.addEventListener('mouseenter', () => tl.play());
  el.addEventListener('mouseleave', () => tl.reverse());
  el.addEventListener('focus', () => tl.play());     // teclado, no solo ratón
  el.addEventListener('blur', () => tl.reverse());
}
```

---

## 9. Valores que cambian cada frame: `quickTo`

Para una barra de progreso en vivo o un elemento que sigue al puntero, un
`gsap.to()` por evento crea decenas de tweens por segundo. `quickTo` reutiliza
uno solo.

```js
const aX = gsap.quickTo('#cursor', 'x', { duration: .4, ease: 'power3' });
const aY = gsap.quickTo('#cursor', 'y', { duration: .4, ease: 'power3' });
document.addEventListener('mousemove', e => { aX(e.clientX); aY(e.clientY); });

// Barra de progreso de una subida o de una cola larga (p entre 0 y 1):
const aPct = gsap.quickTo('#barra', 'scaleX', { duration: .3, ease: 'power2.out' });
function avance(p) { aPct(p); }
```

---

## 10. Marquesina infinita (promociones)

Sin `modifiers`, una cinta infinita obliga a recolocar a mano y salta. `wrap`
dobla el valor y el movimiento queda continuo con un solo tween.

```js
if (ok()) {
  gsap.to('.promo-item', {
    xPercent: -100, repeat: -1, duration: 24, ease: 'none',
    modifiers: { xPercent: gsap.utils.wrap(-100, 0) }
  });
}
```

Pausarla cuando no se ve es obligatorio —si no, gasta CPU en una pestaña que
nadie mira:

```js
ScrollTrigger.create({
  trigger: '.promo-cinta',
  onToggle: self => self.isActive ? cinta.play() : cinta.pause()
});
document.addEventListener('visibilitychange',
  () => document.hidden ? cinta.pause() : cinta.play());
```

---

## 11. Gestos unificados con Observer

Rueda, táctil y puntero con una sola API, en vez de tres listeners que se
contradicen entre escritorio y móvil.

```js
gsap.registerPlugin(Observer);

Observer.create({
  target: '.panel-atencion',
  type: 'touch,pointer',
  onUp:   () => cerrarPanel(),
  onDown: () => {},
  tolerance: 12,
  preventDefault: true
});
```

---

## 12. Números que cuentan (y no mienten)

Ya está en `AppMotion.countUp`, y esta es la razón de que anime un objeto y no el
nodo: interpolar el texto directamente produce decimales rotos y formatos
inconsistentes. Se anima un número y se formatea en cada frame; al terminar se
escribe el valor exacto, para que nunca quede un redondeo en pantalla.

```js
AppMotion.countUp(document.querySelector('#kpi-total'), 128450,
  v => '$' + Math.round(v).toLocaleString('es-MX'));
```

---

## 13. Depurar sin publicar

`GSDevTools` (61.9 KB) y `MotionPathHelper` (43.9 KB) son de banco de pruebas.
Se cargan a mano en local mientras se ajusta una animación y **no** se suben:
`clasp push` publica lo que esté en "Carpeta del proyecto", así que un
`<script>` olvidado va derecho a producción.

Para medir sin plugins:

```js
gsap.ticker.add(() => { /* contador de frames propio */ });
console.log(gsap.globalTimeline.getChildren().length);   // ¿cuántos tweens vivos?
console.log(ScrollTrigger.getAll().length);              // ¿cuántos triggers vivos?
```

Esos dos números creciendo al navegar entre vistas es la señal de que falta un
`revert()` o un `kill()`.
