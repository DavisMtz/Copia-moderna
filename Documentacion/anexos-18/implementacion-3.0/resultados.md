# Resultados medidos — implementación de la extensión 3.0 (04/10/2026)

Las cifras en bruto de lo que se midió al implementar los puntos 1 a 6 del documento 18. Lo que significan está en el propio documento 18 («Estado»).

## Cuándo se midió cada cosa

Importa, porque **el corpus ya no existe** y estas cifras no se pueden repetir sin recolectar de nuevo.

- **Laboratorio** (pestaña de `robots.txt`, corpus `inv2`: 110 fichas y 274 búsquedas): última corrida el **04/10/2026 a las 18:20**. El código de ese momento ya tenía los cuatro errores corregidos, la elección por calidad con su piso, las doce clases nuevas, los tres ajustes del dron, el monitor y el foco.
- **Después de esa corrida cambiaron tres cosas**, que el laboratorio ya no midió:
  - los `noEs` de `maleta`, `mochilaEscolar` y `juegoMesa`;
  - la subida de versión del dron (`subidaMismaVar`);
  - la cabecera y el número de versión de las reglas.

  Ninguna toca las cifras de abajo: el corpus tenía una sola mochila y una sola maleta, que conservan su clase; los dos juegos de mesa también; y la subida de versión no entra en la venta cruzada. Están cubiertas por las pruebas unitarias (sección 20 de `ext_recomendador.test.js`) y por la prueba de punta a punta.
- **El corpus** vivía en IndexedDB del navegador y apareció vacío hacia las 18:35 (la sesión de Liverpool también se había cerrado). Los datos de la evaluación humana ya estaban en disco, comprobados con una huella contra la pestaña.

## Antes y después

Qué recomienda cada versión en las 110 fichas, con los mismos carruseles y las mismas búsquedas (los 24 primeros resultados, que es lo que guarda la extensión).

| | 2.9 | 3.0 | 3.0 sin `calidad` |
|---|---|---|---|
| Fichas con clase | 85 | 106 | 106 |
| Fichas sin ninguna recomendación | 28 | 7 | 7 |
| Recomendaciones | 214 | 263 | 264 |
| …sin una sola opinión | 71 (33 %) | 81 (31 %) | 87 (33 %) |
| Calificación promedio (de las que tienen) | 4.56 | 4.73 | 4.60 |
| Opiniones por recomendación | 27.9 | 37.0 | 26.1 |
| …de marketplace | 72 (34 %) | 78 (30 %) | 88 (33 %) |
| …traídas por la búsqueda | 94 | 127 | 127 |
| …elegidas por calidad | 0 | 28 | 0 |
| Precio promedio | $1,065.57 | $959.63 | $1,000.57 |

Cambia lo recomendado en 47 de las 110 fichas. Solo por la calidad (la 3.0 con y sin ella), en 29.

**Las mismas 85 fichas que la 2.9 ya reconocía** (la comparación limpia):

| | 2.9 | 3.0 | 3.0 sin `calidad` |
|---|---|---|---|
| Recomendaciones | 214 | 215 | 216 |
| …sin una sola opinión | 71 | 68 | 73 |
| Calificación promedio | 4.56 | 4.69 | 4.56 |
| Opiniones por recomendación | 27.9 | 40.5 | 27.9 |
| …de marketplace | 72 | 62 | 73 |
| …elegidas por calidad | 0 | 21 | 0 |
| Precio promedio | $1,065.57 | $1,008.80 | $1,052.09 |

En la 3.0 son 84 con clase: el «Filtro purificador de agua» dejó de pasar por purificador (era uno de los cuatro errores).

**Las 24 fichas de las doce categorías nuevas:**

| | 2.9 | 3.0 |
|---|---|---|
| Fichas con clase | 2 (las dos, mal) | 24 |
| Fichas sin ninguna recomendación | 23 | 1 |
| Recomendaciones | 2 | 54 |
| …sin una sola opinión | 0 | 15 |
| Calificación promedio | 4.96 | 4.88 |
| …de marketplace | 1 | 19 |
| …traídas por la búsqueda | 2 | 37 |
| …elegidas por calidad | 0 | 8 |

- Las dos que la 2.9 «reconocía» eran la lámpara de escritorio (como oficina) y el vaso térmico (como mesa: le ofrecía cubiertos).
- La que se queda sin nada es un Mega Bloks de $195: nada de lo que encaja cuesta lo proporcionado.

## Clases

- **26 fichas cambian de clase:** 22 pasan de no tener a su clase nueva; la mochila escolar deja de ser maleta; la lámpara de escritorio y el vaso térmico pasan a su clase; el filtro de agua se queda sin clase.
- **Barrido de 102 nombres fuera del corpus:** 4 cambios, los cuatro de «sin clase» a una clase nueva (muñeca Barbie, LEGO Star Wars, ventilador portátil USB y computadora todo en uno).
- **Reglas:** de 56 clases y 281 tipos a **68 clases y 349 tipos**.

## Plantillas de búsqueda de las clases nuevas

El criterio del documento 18: una plantilla pasa si al menos 3 de los 10 primeros resultados son del tipo buscado.

- **Pasan 54 de 54.** Para llegar ahí se quitaron tres tipos del LEGO (minifiguras, base y llavero), se cambió «casco para scooter» por «casco para bicicleta» y se trajeron de Liverpool las búsquedas que faltaban en el corpus.
- Las más justas, con 3 de 10: accesorios para muñeca, caja organizadora de juguetes, cuerdas para guitarra clásica, púas, y la batería del dron (que solo es botón).
- Dron: micro SD 9, mochila 4, power bank 9, cargador de pared USB 9. Foco LED 8. Monitor para computadora 8.

## Lo que encontró la revisión de las clases nuevas

Cada uno salió de mirar la recomendación real, y lleva su caso en `reglas-venta.js`:

| Ficha | Lo que salía | Qué se hizo |
|---|---|---|
| Scooter eléctrico | Un casco cerrado de motociclismo | Se busca el de bicicleta y se excluyen los de moto. |
| Guitarra clásica | La funda de la eléctrica | Dos tipos de funda, según la guitarra. |
| Dron DJI | Nada: sus complementos pedían «dji» en el nombre, y el nombre no lo dice | La condición mira que no sea de juguete. |
| DJI Mini 5 Pro | El estuche de una cámara instantánea (Stitch) | La mochila es de dron, o de cámara si es mochila. |
| DJI Lito X1 | La batería de una cámara Canon, llamada «Batería portátil 9967b002aa» | El power bank tiene que decir que lo es (mAh, USB…). |
| DJI (los dos) | El cargador de una cámara Sony, llamado «Cargador pared» | El cargador tiene que decir USB. |
| DJI Mini 5 Pro | «Subir» a un Mini 4 Pro con más accesorios (la generación anterior) | La subida es el mismo modelo en un paquete mayor. |
| Mini PC | Un monitor portátil de 16 pulgadas | Fuera: es la segunda pantalla de una laptop. |
| Lámpara de pie | Un foco «vela» de base delgada, más caro que la lámpara | Solo focos de rosca común. |
| «Juego de mesa y sillas para jardín» | Clase «juegos de mesa» | Es un mueble: se queda sin clase. |
| «Mochila para drone», de senderismo, táctica | Clase «mochila escolar» (lonchera y lapicera) | Se quedan sin clase. |

## La elección por calidad

- **La variante del documento 18** (entre los 5 primeros, con tope de precio) se reprodujo igual: 76 cambios de 140. Al revisarlos uno por uno, muchos eran ruido (una opinión de 5 estrellas contra ninguna) o cruzaban de nivel de compatibilidad.
- **La que se implementó es más conservadora.** El primero de Liverpool se queda, salvo que otro:
  - sea de su mismo nivel de compatibilidad (y, en el par de un aparato, de los mismos kilos);
  - esté entre los 5 primeros de ese nivel;
  - tenga opiniones;
  - no cueste más de un 25 % sobre el primero;
  - y le gane por un cuarto de estrella (promedio bayesiano, con +0.15 si lo vende Liverpool).

  Y el primero de un carrusel que nadie ha calificado se queda siempre: un estreno no tiene opiniones.
- **El piso** (3.3 de promedio bayesiano) se añadió al ver que la cafetera de cápsulas ofrecía en primer lugar un espumador de 2.5 estrellas con 8 opiniones, sin nadie que lo relevara. En las 110 fichas quita **2** recomendaciones: ese espumador (entra uno de 4.0 con 16 opiniones, de la búsqueda) y una pulsera de 1.8 con 6 (entra otra de la misma búsqueda).

## La bolsa como contexto (13 escenarios con fichas reales)

| Escenario | Sin la bolsa | Con la bolsa |
|---|---|---|
| Adaptador de Apple + iPhone 16 en la bolsa | Nada | Funda y mica de iPhone 16 |
| Control de PS5 + consola | Nada | Juego, base de carga y audífonos |
| Control de PS5 + iPhone y consola | Nada | Adopta la consola, no el iPhone |
| Funda de iPhone 16 (Lacoste) + iPhone 16 | Busca audífonos «Lacoste» | Busca audífonos «Apple» |
| Correa de Apple Watch + el reloj | Mica y cargador | Lo mismo, más audífonos |
| Protector de colchón + su colchón | Una almohada | La misma: adopta el colchón, pero cambia poco |
| iPhone 16 con su funda ya en la bolsa | Funda, mica y cargador | Mica, cargador y audífonos; avisa de la funda |
| Laptop con un mouse en la bolsa | Mouse, mochila y disco | Mochila, disco e impresora |
| Mica de Galaxy A57 + Galaxy A56 | — | No adopta: no es su modelo |
| Cápsulas Dolce Gusto + cafetera Nespresso o espresso | — | No adopta: no es su sistema |
| Adaptador de Apple + Redmi recién agregado | — | No adopta: otra familia |
| Adaptador de Apple + bolsa de hace 56 y 61 horas | — | La ignora (ventana de 90 minutos) |

## Prueba de punta a punta

`scripts/laboratorio/extension-e2e.mjs`: la extensión real en Chrome headless sobre 14 páginas reales guardadas. **21 comprobaciones en verde**; Chrome la carga como 3.0 sin avisos ni errores.

Lo que encontró en sus corridas, y ya está corregido:

- la bolsa guardada de un cliente se reutilizaba con el siguiente si la cabecera decía la misma cuenta → lo guardado lleva la huella de la sesión;
- se buscaba «audífonos Lacoste» antes de que llegara la bolsa → las búsquedas esperan a la bolsa;
- se contaba como «mostrada» una tarjeta que solo pasó un instante → cuenta al asentarse;
- al adaptador de Apple se le ofrecía un AirTag como «subida de versión»;
- una lectura colgada no se soltaba → tope de 15 segundos;
- al DJI Mini 5 Pro se le ofrecía «subir» a un Mini 4 Pro.

## Otras comprobaciones

- **Mutaciones** (`mutaciones.cjs`): se rompe una cosa cada vez (25 roturas: el piso, el margen, la ventana de la bolsa, la huella de la sesión, la hoja sin revolver, κ mal calculada…). **Las 25 se detectan.** La suite del recomendador contra las reglas y el núcleo de la 2.9 falla.
- **El lector de la bolsa contra una bolsa real:** una página de bolsa guardada el 01/09/2026 (14 artículos). Los lee todos, con sus ocho campos y su fecha, y no guarda nada del cliente.
- **En el navegador, sin sesión** (se había cerrado): el lector saca los cuatro carruseles de una ficha en vivo (25, 22, 25 y 24 artículos, con su calificación). La bolsa vacía de un invitado no trae el objeto de la bolsa; la extensión no la pide cuando la cabecera dice cero.
- **Lecturas a liverpool.com.mx en esta implementación:** unas 25, todas de solo lectura (las búsquedas que faltaban y unas comprobaciones desde la pestaña; 14 páginas de invitado para la prueba de punta a punta). Ningún bloqueo. No se agregó ni se quitó nada de ninguna bolsa.

## Lo que no se midió

- **Si un asesor ofrecería estas recomendaciones:** es la evaluación humana (`../evaluacion-humana/`), que está lista y sin hacer.
- **Si se venden:** lo empieza a contar la medición local de la extensión.
- **La lectura de una bolsa con artículos, en vivo y con sesión:** la sesión de Liverpool estaba cerrada y no se agrega nada a una bolsa para probar. Quedó cubierta por la bolsa real guardada y por la prueba de punta a punta.
