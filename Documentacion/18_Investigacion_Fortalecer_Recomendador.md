# 18 · Fortalecer «Vende más»: cuatro propuestas probadas antes de implementar

> **El pedido del creador (04/10/2026):** «… quiero que hagas pruebas e investigaciones para el punto 1, el punto 2, el punto 4 y el punto 5 para ver de qué manera se pueden integrar. Haz pruebas reales, haz investigaciones basadas en datos y dame un resultado antes de implementar algo. ¿Qué sí es viable? ¿Qué no? ¿De qué manera mejora y de qué manera no?»
>
> **Las cuatro propuestas** (de la conversación anterior):
> 1. la bolsa como contexto;
> 2. elegir el mejor candidato y no el primero;
> 4. medir qué se acepta;
> 5. usar IA para escribir reglas, no dentro de la tarjeta.
>
> **Nada de esto cambió la extensión ni el Portal.** Todo se probó en laboratorio:
> - el Chrome del creador sobre liverpool.com.mx, **solo leyendo**: no se agregó ni quitó nada de su bolsa;
> - Node;
> - cuatro investigaciones de escritorio con fuentes.
>
> **Cómo leer las etiquetas:**
> - **[medido]**: salió de Liverpool o de datos propios en esta investigación;
> - **[fuente]**: viene de una referencia externa (§10);
> - **[supuesto]**: es una hipótesis que no se pudo medir.

---

## Estado (04/10/2026, por la tarde): implementado en la extensión 3.0

**El pedido que siguió:** «Aplica del 1 al 6, y haces pruebas». Son los seis primeros pasos del §8. El resto de este documento queda como se escribió: es la investigación, de antes de implementar.

| Paso del §8 | Cómo quedó | En qué se apartó de lo propuesto |
|---|---|---|
| **1. Los cuatro errores** | **Corregidos**, cada uno con su prueba sobre la ficha real. | Al probar las clases nuevas salieron dos parientes y se corrigieron también: las mochilas que no son escolares (de dron, de senderismo) y el «Juego de mesa y sillas», que es un mueble. |
| **2. Evaluación humana** | **Lista, sin hacer.** Hoja a ciegas de 209 renglones, su clave y el guion que calcula el resultado, en `anexos-18/evaluacion-humana/`. | Además de las 50 fichas del §9 lleva las 24 de categorías nuevas. Calificarla les toca a 2 o 3 asesores. |
| **3. El mejor candidato** | **Implementado**, con una regla más conservadora que la del §4. | Ver abajo. Se añadió un piso: lo que los clientes calificaron mal no se ofrece. |
| **4. Medición local** | **Implementada.** Cuenta mostradas, abiertas y en la bolsa en 60 minutos; se ve, se pausa y se borra desde el popup. | Cuenta en cualquier Chrome que cargue la 3.0, no solo en el del creador. Sigue sin salir nada de ese navegador. |
| **5. Categorías nuevas con IA** | **Las doce clases están dentro** (de 56 a 68), después de la revisión humana que pedía el §6. | La revisión corrigió el borrador caso por caso, cada vez por una recomendación real que salía mal: a un dron DJI le tocaba la batería de una cámara Canon (la lista está en `resultados.md`). |
| **6. La bolsa como contexto** | **Implementada**, con las tres condiciones del §3: ventana de 90 minutos, guardia de modelo y la condición evaluada sobre el equipo. | Lo guardado de la bolsa lleva una huella de la sesión: la prueba de punta a punta encontró que, con la misma cuenta en la cabecera, un cliente heredaba la bolsa del anterior. |
| **7. Medición central y A/B** | **No se hizo.** Sigue pendiente de TI. | — |

**Por qué la regla de calidad es más conservadora.** La variante del §4 se reprodujo igual (76 cambios de 140). Al revisarlos uno por uno, muchos eran ruido —una opinión de cinco estrellas contra ninguna— o cruzaban de nivel de compatibilidad. En la que se implementó, el primero de Liverpool se queda, salvo que otro de su mismo nivel, entre los cinco primeros, tenga opiniones, no cueste un 25 % más y le gane por un cuarto de estrella. Y el primero de un carrusel que nadie ha calificado se queda siempre: un estreno no tiene opiniones.

**Lo medido [medido], en las mismas 85 fichas que la 2.9 ya reconocía:**

| | 2.9 | 3.0 |
|---|---|---|
| Recomendaciones | 214 | 215 |
| …sin una sola opinión | 71 | 68 |
| Calificación promedio (de las que tienen) | 4.56 | 4.69 |
| Opiniones por recomendación | 27.9 | 40.5 |
| …de marketplace | 72 | 62 |
| …elegidas por calidad | — | 21 |
| Precio promedio | $1,065.57 | $1,008.80 |

**Y en las 24 fichas de categorías nuevas:** la 2.9 no mostraba nada en 23; la 3.0 muestra 54 recomendaciones en 23 de ellas (15 sin opiniones, 19 de marketplace).

La mejora en calidad es más chica que la del §4 (ahí las «sin opiniones» bajaban de 49 a 23): es el precio de no cambiar por ruido. **Siguen siendo indicios:** que un asesor las ofrecería lo dirá la evaluación humana, y que se venden, la medición.

**De cuándo son estas cifras.** Se midieron el 04/10/2026 a las 18:20. Después solo cambiaron tres reglas que no tocan a ninguna de las 110 fichas, cubiertas por las pruebas y no por el laboratorio. **El corpus ya no existe:** vivía en IndexedDB del navegador y esa misma tarde apareció vacío. Repetir la medición pide recolectar de nuevo (§10).

**Lo que no se pudo comprobar:** la lectura de una bolsa con artículos, en vivo y con sesión. La sesión de Liverpool estaba cerrada, y no se agrega nada a una bolsa para probar. Quedó cubierta con una página de bolsa real guardada (14 artículos, leídos todos) y con la prueba de punta a punta.

**Para TI:** desde la 3.0 la extensión lee también la bolsa (`/tienda/cart`), además de la búsqueda que ya leía desde la 2.7. Es lectura del mismo sitio; nada sale del navegador. La frase del documento 14 («no tiene una sola llamada de red») ya lleva su nota, y el detalle está en el documento 05, §10.

**Dónde está cada cosa:**

- las cifras en bruto, lo que encontró cada prueba y el laboratorio: `anexos-18/implementacion-3.0/`;
- la evaluación humana: `anexos-18/evaluacion-humana/`;
- la prueba de punta a punta: `scripts/laboratorio/extension-e2e.mjs`;
- el registro del trabajo: §18 del plan 13.

---

## 1. El veredicto, en una tabla

| Propuesta | ¿Viable? | Cómo mejora | Cómo no mejora, o qué riesgo trae | Esfuerzo |
|---|---|---|---|---|
| **2. El mejor candidato** | **Sí. Es la de mayor valor y menor riesgo.** | Reordenando solo entre los 5 primeros de Liverpool y con tope de precio (+25 %), cambian 76 de 140 elecciones. Las recomendaciones sin una sola opinión bajan de 49 a 23; la calificación sube de 4.64 a 4.85; las de marketplace bajan de 47 a 34; y la alternativa cuesta 20 % menos. **[medido]** | Las estrellas no miden si encaja: sin el límite de los 5 primeros salían unas tazas infantiles de Bob Esponja para una cafetera. Por teléfono el cliente no ve la calificación. Es un indicio de aceptación, no una venta medida. | Medio. Leer los datos estructurados de la página (ya están ahí) y cambiar cómo se ordena. |
| **1. La bolsa como contexto** | **Sí, con condiciones:** ventana de tiempo, guardia de modelo y releerla solo cuando cambie. | En la ficha de un accesorio, la tarjeta pasa de no mostrar nada a mostrar lo correcto. Con el iPhone en la bolsa, el adaptador Apple recibe funda y mica de iPhone 16; con la consola, el control recibe juego y base de carga. Deja de recomendar lo que ya está en la bolsa. **[medido]** | La bolsa real tenía artículos de 56 y 61 horas: sin ventana, contamina la llamada siguiente. Leerla cuesta 519 KB. Hoy no hay forma de saber con qué frecuencia ayuda. | Medio-alto. |
| **4. Medir qué se acepta** | **Sí, por fases. No como envío a un servidor sin TI y Jurídico.** | Los cruces existen: el mismo `productId` está en la tarjeta, la bolsa (con su hora) y la confirmación de compra. **[medido]** Con 11 asesores, ±2 puntos se miden en días. | Hoy no hay línea base propia: las cotizaciones son 42 renglones de prueba. **[medido]** TI destacó que la extensión «no puede enviar nada a ningún lado». Registrar por asesor es dato personal según la LFPDPPP 2025. **[fuente]** Para bandidos (Thompson) no hay tráfico. | Bajo, si se empieza en local; alto, si es central. |
| **5. IA para escribir reglas** | **Sí, fuera de línea y con el banco validando. Nunca en vivo.** | El borrador a ciegas clasificó bien 24 de 24 fichas reales, sin robarle fichas a ninguna clase. Sus plantillas pasaron 38 de 50 (76 %), contra 90 % de las hechas a mano. Tras una ronda de corrección con los errores reales: **47 de 50 (94 %)**. **[medido]** | Falla en cómo nombra Liverpool las cosas y propone lo que Liverpool no vende (baterías sueltas de dron, fundas de Stanley). En vivo serían ~4 s por ficha. **[cálculo con cifras de fuente]** | Bajo por categoría, con revisión humana. |

**Orden recomendado (§8):**
1. medición local y la evaluación humana, para tener una línea base;
2. el mejor candidato;
3. reglas nuevas con IA;
4. la bolsa;
5. medición central, cuando TI lo apruebe.

---

## 2. Lo que se descubrió por el camino

**a) Liverpool entrega mucho más de lo que la extensión lee. [medido]**
- **En la ficha** vienen, ya estructurados, **cinco** carruseles: «Artículos relacionados», «Complementa con», «Otros clientes compraron», «Más vendidos» y «Vistos recientemente».
  - Cada producto trae `productId`, nombre, marca, precio y precio de lista, etiqueta de descuento, **la ruta de categorías con sus identificadores**, vendedor, si es de marketplace y **la calificación con su número de opiniones**.
  - La extensión hoy lee del DOM solo id, marca, nombre y precio.
  - Los carruseles se llaman por dentro «Jewel | Log in | …». En la red aparece `rerender.jewelml.io`, y el bloque del producto dice `"source":"VertexAI"`. **[inferido]** Liverpool arma esas recomendaciones con aprendizaje automático sobre sus propias ventas; por eso siguen siendo la mejor señal que tiene la tarjeta.
- **En la búsqueda** (`/tienda?s=`, ~690 KB, ~1 s) viene `records` con 56 resultados.
  - Cada uno trae calificación, opiniones, `isSponsoredRecord`, `isMarketPlace`, vendedor, rutas de categoría y `geoStoreIds` (incluye «online» si hay existencia en línea).
  - El orden «Mejor calificados» se pide con `&sort=rating%7C1`. `sortBy`, `sortby` y `Ns` no funcionan.
- **La bolsa** (`/tienda/cart`, 519 KB, ~0.5 s) se puede leer desde la ficha sin abrirla.
  - Cada artículo trae `productId`, `productName`, marca, cantidad, `isOnStock`, vendedor y **`addedAt`**.
  - No trae categoría (`categoryName` viene vacío).
  - La cabecera de la ficha muestra cuántos artículos hay (`header-cart-quantity`).

**b) Ventel no tiene historial propio de qué se compra junto. [medido]**
- `DetalleCotizaciones` tiene 42 renglones de 17 folios, repartidos en 8 días entre el 24/09 y el 03/10/2026 (8 del mismo 03/10).
- Casi todos son de prueba: la misma canasta, bocina JBL con Redmi, aparece repetida 5 veces.
- Las ventas reales pasan por el checkout de Liverpool sin dejar rastro por artículo en sistemas de Ventel. **Medir (punto 4) es la única forma de crear ese dato.**

**c) La promesa de «cero red».**
- La revisión de TI (doc 14, §2.4) dice: «La extensión no tiene una sola llamada de red. No puede enviar nada a ningún lado», y lo cuenta como fortaleza.
- Dejó de ser literal en la 2.7: la búsqueda en vivo consulta liverpool.com.mx, aunque solo lee del mismo sitio en el que ya está.
- **Mandar métricas a un servidor sería un cambio de otra naturaleza:** primero hay que avisar a TI y corregir el doc 14.

**d) Cuatro errores de la versión actual, encontrados de paso. [medido]** No se corrigieron: el pedido fue no implementar.

| Ficha | Qué pasa | Por qué |
|---|---|---|
| «Mochila escolar Phase Small para niño» | Recomienda candado TSA y organizadores de viaje | La miga «Mochilas y maletas deportivas» (2 puntos) le gana al nombre (1 punto): cae en «maleta». |
| «Filtro purificador de agua FPA5L» | Se trata como purificador de aire y ofrece Liverpool Care | A la clase le falta excluir «de agua». |
| «Funda para iPhone 16» | Recomienda «Cargador para laptop 1/4 pulgadas» | Al tipo «cargador» del celular le falta excluir «laptop». |
| Laptop HP con mouse en la bolsa | Ofrece «Adaptador de USB-C a Pencil Apple» como «hub» | El tipo «hub» acepta cualquier «adaptador». |

---

## 3. Punto 1 · La bolsa como contexto

**Qué se probó:**
- lectura real de la bolsa desde una ficha;
- un prototipo de laboratorio (`__recomendarConBolsa`) que, en la ficha de un accesorio, toma la clase y el modelo del equipo que está en la bolsa y quita lo que ya está en ella;
- 12 escenarios con fichas y búsquedas reales.

**Qué se puede leer [medido]:** ver §2a. Sin categoría, la clase sale del nombre del artículo de la bolsa: el núcleo ya lo hace bien con «iPhone 16…», «Consola fija ps5…» o «Colchón performance».

**Escenarios [medido]** (lo que muestra la tarjeta hoy → con la bolsa):

| Escenario | Hoy | Con la bolsa (ventana de 90 min) |
|---|---|---|
| Adaptador Apple 20 W, con el iPhone 16 en la bolsa | nada | funda iPhone 16 · mica iPhone 16 |
| Control de PS5, con la consola | nada | juego · base de carga de controles · audífonos |
| Cápsulas Dolce Gusto, con la cafetera | nada | espumador · **molino** (error de diseño, abajo) |
| Correa para Apple Watch, con el reloj | mica · cargador | mica · audífonos · cargador |
| Protector de colchón, con el colchón | almohada | almohada (otra) |
| Funda de iPhone 16, con el iPhone | mica · cargador · audífonos | igual; busca audífonos de la marca **del equipo**, no de la funda (LACOSTE) |
| Mica de **Galaxy A57**, con un **A56** en la bolsa | cable USB-C | **igual: no adopta**, porque el guardia de modelo ve que no le queda |
| iPhone 16 con su funda **ya** en la bolsa | funda · mica · adaptador | mica · adaptador · batería |
| Laptop con un mouse **ya** en la bolsa | mouse · mochila · SSD | mochila · SSD · «hub» malo (§2d) |
| Adaptador Apple con la **bolsa vieja real** (JBL + Redmi, 56-61 h) | nada | con ventana: nada. **Sin ventana: adopta la bocina JBL.** |

**Cómo mejora:**
- En fichas de accesorio, que hoy suelen quedar sin clase, la tarjeta pasa de nada a lo correcto.
- No repite lo que el cliente ya lleva.
- Busca con la marca y el modelo del equipo, no con los del accesorio.

**Cómo no mejora, o qué riesgo trae:**
- **La bolsa no es el cliente actual.** La real tenía artículos de 56 y 61 horas; sin ventana de tiempo contamina la siguiente llamada. La ventana sobre `addedAt` es obligatoria. **[medido]**
- **La condición `si` se evalúa sobre el nombre del accesorio.** «Set de 16 cápsulas *Espresso* Intenso» activó el molino de las cafeteras de espresso. Con contexto adoptado, `si` tiene que mirar al equipo.
- **Cuesta 519 KB por lectura.** Hay que releerla solo cuando cambie la cuenta de la cabecera o tras un «Agregar a mi bolsa».
- **No se sabe con qué frecuencia ayuda.** Ventel no tiene datos de canastas (§2b): lo dirá la medición.
- Al quitar lo que ya está en la bolsa, entran tipos de menor peso. Si son débiles, se ven.
- La bolsa trae también la dirección del cliente. La extensión ya la lee para «Cotizar»; aquí bastan los `lineItems`.

**Veredicto:** viable con las tres condiciones (ventana, guardia de modelo y `si` sobre el equipo). El valor está en las fichas de accesorio. No es lo primero que haría.

---

## 4. Punto 2 · Elegir el mejor candidato, no el primero

**Qué se probó:** las 110 fichas y 234 búsquedas, con los datos estructurados. Para cada recomendación que la tarjeta muestra hoy, se buscó la alternativa del mismo tipo y nivel de compatibilidad con mejor puntaje:
- **promedio bayesiano** de la calificación, con media 4.2 y peso de 5 opiniones (así un 5.0 con una opinión no le gana a un 4.8 con 300);
- **+0.15** si la vende Liverpool;
- castigo si es patrocinado o no tiene existencia en línea.

Esos parámetros (media 4.2, peso 5, +0.15) son un punto de partida, no un ajuste fino. La investigación sugiere poner lo que no tiene opiniones **detrás** de cualquier cosa con al menos una. Aquí recibe la media previa (4.2), así que puede ganarle a un 4.0 con 50 opiniones. Eso explica en parte las 23 recomendaciones que se quedan sin opiniones.

Sin datos de ventas, la calificación y las opiniones son la mejor señal disponible:
- de 0 a 5 opiniones, la probabilidad de compra sube 270 %;
- el punto óptimo está entre 4.2 y 4.5 estrellas;
- la elasticidad de las ventas es 0.42 respecto a la calificación y 0.24 respecto al número de opiniones (§10). **[fuente]**

**Resultados [medido]** (213 recomendaciones; «con opción» = 2 o más candidatos del mismo tipo):

| Variante | Con opción | Cambian | Sin opiniones (hoy → alt.) | Calificación | Marketplace | Precio alt./hoy |
|---|---|---|---|---|---|---|
| Libre, 16 resultados | 166 | 105 | 57 → 26 | 4.56 → 4.85 | 57 → 35 | ×1.19 |
| Libre, sin preferir Liverpool | 166 | 105 | 57 → 23 | 4.56 → 4.85 | 57 → 52 | ×1.18 |
| Libre, los 56 resultados | 172 | 113 | 58 → 23 | 4.57 → 4.86 | 58 → 33 | ×1.36 |
| Tope de precio +25 % | 146 | 87 | 50 → 22 | — | — | ×0.79 |
| **Top-5 de Liverpool + tope +25 % (recomendada)** | **140** | **76** | **49 → 23** | **4.64 → 4.85** | **47 → 34** | **×0.80** |
| Top-3 + tope +25 % | 132 | 62 | 45 → 26 | 4.66 → 4.82 | 44 → 36 | ×0.76 |

**Ejemplos reales** (recomendada):
- regulador de $799 (157 opiniones) → $519 (371 opiniones);
- molino de $1,079 (8) → $551 (30);
- molde para freidora sin opiniones → el mismo modelo, de $199, con 22;
- microondas de $2,924 (101) → $2,339 (145).

**Lo que también se midió:**
- **Patrocinados: 0** en 12,297 resultados de 234 búsquedas. Liverpool subasta lugares con Topsort **[fuente]**, pero no aparecen en lo que lee la tarjeta. No hace falta filtrarlos hoy; conviene dejar el candado por si cambia.
- **Existencia:** el 100 % de los resultados tiene «online». Liverpool no lista lo agotado, así que filtrar no cambia nada hoy. Se deja el candado: recomendar algo agotado daña también la venta principal. **[fuente]**
- **Descuento:** lo lleva el 84 % de los productos de carrusel. No distingue: un letrero que todos tienen no pesa. **[fuente]**
- **Opiniones como indicio de ventas:** en promedio, los productos de «Complementa con» tienen 25.9 opiniones y los de «Más vendidos» 20.7, frente a 6.7 en «Otros clientes compraron» y 9.8 en «Relacionados».
- **¿La categoría de Liverpool puede reemplazar al nombre para decidir el tipo? No.**
  - Cuando el nombre da el tipo, la categoría coincide en el 86 % de los casos.
  - Donde no coinciden, casi siempre el error es de la categoría: «Hornos de Microondas» contra «Hornos de microondas», tipos amplios.
  - De los 330 candidatos que la categoría «rescataría», en una muestra de 20 solo 2 o 3 eran complementos reales. El resto eran sustitutos: otra cafetera, otro microondas.
  - Sirve para confirmar, no para decidir.
- **«Más vendidos» como fuente extra:** aporta tipos nuevos en 9 de 78 fichas. Pero trae lo más vendido de la categoría sin importar el modelo: cartuchos 667 para una Smart Tank, que no los usa. Solo valdría para tipos que no dependen del modelo.

**Cómo mejora:**
- Menos recomendaciones sin respaldo y más productos probados por otros clientes.
- Más de lo que vende Liverpool.
- Con el tope, además, más baratas: más fáciles de aceptar.

**Cómo no mejora, o qué riesgo trae:**
- **La calificación no mide el encaje.** Sin limitarse a los primeros de Liverpool salió «Set de tazas infantil Bob Esponja» para una cafetera.
- **Por teléfono el cliente no ve las estrellas.** El valor está en la calidad de fondo y en menos devoluciones, y eso habría que medirlo. **[supuesto]**
- Preferir lo vendido por Liverpool es una **decisión de negocio** (el descuento de marketplace se maneja distinto), no un dato.

**Veredicto:**
- viable y lo primero en valor;
- leer los carruseles y la búsqueda del stream (ya están en la página);
- reordenar dentro de los 5 primeros de Liverpool por promedio bayesiano, con tope de +25 % sobre el primero;
- dejar los candados de patrocinado y agotado.

---

## 5. Punto 4 · Medir qué se acepta

**El embudo que sí se puede medir [medido]:**
1. **Mostrada:** la tarjeta sabe qué `productId` enseñó.
2. **Clic:** el enlace de la tarjeta.
3. **En bolsa:** el `productId` aparece en `lineItems` con `addedAt` posterior a la tarjeta.
4. **Comprada:** `purchase-extractor.js` ya lee la confirmación con su `productId`.

La unión es el `productId`, el mismo en la ruta de la ficha, en los carruseles, en la bolsa y en la confirmación.

**Cuánto hace falta medir [fuente + cálculo]:**

| Objetivo | Tarjetas mostradas |
|---|---|
| Estimar una tasa con ±2 puntos (95 %) | 457 si es 5 % · 865 si es 10 % · 1,537 si es 20 % |
| Detectar +3 puntos (80 % de potencia) | 1,059 por brazo (5 → 8 %) · 1,774 por brazo (10 → 13 %) |

**Ajustes a esos números:**
- Por agrupar por asesor, hay que multiplicar por 2 a 3.
- El tamaño se fija antes de empezar: mirar a medio camino llevó los falsos positivos a 26 %.

**Cuánto tarda:**
- **Supuesto:** 8 asesores activos de los 11 registrados, con 30 tarjetas al día cada uno.
- Con eso, ±2 puntos salen en **4 días**, y un A/B de 10 % a 13 %, en **15 días**.
- Con un solo Chrome a 30 tarjetas al día, ±3 puntos tardan ~13 días.

**Las fases, de menor a mayor riesgo:**

| Fase | Qué es | Qué necesita |
|---|---|---|
| **A. Piloto local** | Contadores en `chrome.storage` del Chrome del creador: mostradas, clics y en bolsa en ≤60 min. Sin red. | Nada: la promesa de TI se mantiene. |
| **B. Evaluación humana** | 2-3 asesores califican a ciegas la muestra de §9, la de hoy y la reordenada (punto 2) mezcladas. Precisión@3 y acuerdo entre evaluadores (κ o AC1). | Una hoja. Ni datos de clientes ni de asesores. |
| **C. Conteos centrales** | Un evento por recomendación (tipo, posición, versión, día, clic/bolsa/compra), sin asesor ni pedido, a un Apps Script **aparte del Portal**. | Avisar a TI y corregir el doc 14. Plazo de retención. |
| **D. A/B con control** | 10-20 % de fichas sin tarjeta o con una variante. Ventana: la misma llamada (≤60 min). | Haber terminado C. Fuera de temporadas como el Buen Fin. |
| — Bandido (Thompson) | Que los pesos se ajusten solos. | **No viable:** pide 500 eventos al día o más **[fuente]**, y con 11 asesores no se llega. |

**Lo legal y de TI [fuente]:**
- **La ley:** la nueva LFPDPPP rige desde el 21/03/2025 y la autoridad es la Secretaría Anticorrupción y Buen Gobierno.
- **El asesor:** su identificador, aunque vaya en hash, es dato personal. Pide aviso, finalidad, plazo de conservación y derechos ARCO. Si las cifras se usan para evaluar o premiar de forma automatizada, el asesor puede oponerse.
- **Cuando no es dato personal:** los conteos anónimos y agregados por día no lo son si nadie puede reidentificar. Cuidado con los turnos de una sola persona.
- **Qué nunca sale:** nombre, dirección, teléfono o correo del cliente, el número de pedido y las URL completas.
- **Antes de la fase C:** el doc 14 ya pide cerrar con Jurídico el aviso de privacidad (V-16).

**Qué no hace la medición:** no da el efecto causal sin grupo de control. En Amazon, el 75 % de los clics «por recomendación» habrían ocurrido igual. **[fuente]**

**Veredicto:** viable por fases. La A y la B se pueden hacer ya y sin riesgo; la C y la D, con TI.

---

## 6. Punto 5 · IA para escribir reglas, validadas por el banco

**El experimento [medido]:**
- **Quién redactó:** un agente sin acceso a la web ni a Liverpool, solo con el esquema de reglas y dos clases de ejemplo.
- **Qué redactó:** reglas para 12 categorías sin cubrir (muñecas, LEGO, juegos de mesa, carros a control remoto, ventiladores, computadoras de escritorio, casas de campaña, scooters, guitarras, lámparas, termos y drones): 12 clases y 69 complementos.
- **Contra qué se midió:** 24 fichas reales (2 por categoría) y el buscador real.
- **El control:** 30 plantillas de la v3.1 hechas a mano, con el mismo criterio. Una plantilla «pasa» si al menos 3 de los 10 primeros resultados son del tipo buscado.

| Medida | Borrador IA | Control (a mano) |
|---|---|---|
| Fichas reales bien clasificadas | **24 de 24** (incluido un LEGO llamado «Centro de mesa navideño 40743») | — |
| Fichas robadas a otras clases | **0**: en las 81 del corpus y en los 102 nombres del barrido solo cambian las de «sin clase» a su clase nueva | — |
| Plantillas que pasan | **38 de 50 (76 %)** | **27 de 30 (90 %)** |
| Tras una ronda de corrección | **47 de 50 (94 %)**; sigue con 24 de 24 y 0 robadas | — |

**Por qué fallaron las 12:**
- **4: Liverpool lo vende, pero lo nombra distinto:** «Set accesorios para muñeca», «Set contacto Smart», «Bocina gamer», «Soporte para celular».
- **6: Liverpool no lo vende:** cargadores de scooter por marca, fundas de Stanley, cepillos para termos, baterías y hélices sueltas de DJI.
- **2: pocos resultados** del tipo (base para LEGO, asador portátil).

**La ronda de corrección** le devolvió al mismo agente los errores con los nombres reales y lo que Liverpool pone en «Complementa con». Pedirle solo «corrígete» no sirve **[fuente]**.

**Resultado de la ronda:** 18 cambios.
- Ajustó `palabras` a los nombres reales.
- Quitó lo que Liverpool no vende: cargador de scooter, funda y cepillo de termo, hélices de dron.
- Agregó tres complementos que sí aparecen en «Complementa con»: mochila de senderismo, contenedor de acero y cargador de pared para drones DJI.
- Pasan **47 de 50 (94 %)**, comparable al control hecho a mano (90 %).

**Dos matices de esa comparación:**
- Las 30 plantillas de control ya habían pasado por las rondas de validación de la v3.1. El criterio solo comprueba que el buscador traiga cosas que la regex reconoce, no que el complemento tenga sentido.
- Las 24 fichas se tomaron buscando el nombre de la propia categoría («dron», «guitarra eléctrica»): son los casos fáciles. El lado difícil es la prueba de choques, y ahí no se robó ninguna ficha.

**Un hallazgo de método.** El agente aseguró que «ahora pasan todas». La validación independiente encontró **3 fallas nuevas**, todas en tipos de LEGO que su propio cambio activó: «minifiguras LEGO» (Liverpool las llama «Bloques Minifigures»), «llavero LEGO» y «base para construcción».
- Por eso la validación tiene que ser del banco, no del mismo modelo que redacta.
- Además, «Complementa con» reconocido sube de 10.5 % a 12 %.

**«Complementa con» en estas categorías casi no ayuda [medido]:**
- **Ventilador:** trae tetera, tostador y lavadora.
- **Lámpara:** trae cortina y vajilla.
- **Termo:** trae mochilas y un iPhone.
- **Muñecas:** viene vacío.

Las reglas de la IA reconocen el 10.5 % de lo que trae ese carrusel; las de la v3.1, el 35.8 % en su corpus. En estas categorías la búsqueda con plantillas es casi la única fuente.

**Lo que dice la literatura [fuente]:**
- **Sin validar:** un borrador de modelo acierta en el tipo plausible el 65-85 % de las veces y en la búsqueda útil, el 58-67 %.
- **Validado:** tras validar contra el catálogo y una ronda con errores reales, lo que sobrevive llega a 85-90 %. A cambio se descarta entre un tercio y la mitad.
- **Seguridad:** los modelos fallan entre el 35 % y el 88 % de las trampas de seguridad. Hace falta una lista fija de exclusión, como la de la chichonera.
- **En vivo, la espera:** un modelo rápido tarda ~0.9 s en dar la primera palabra y genera ~90 palabras-ficha por segundo. **[fuente]**
- **En vivo, el costo [cálculo, no fuente]:** con esas cifras, ~4 s de espera por ficha y unos US$3,000 por millón de vistas. Redactar 300 categorías fuera de línea costaría unos US$3, una sola vez.

**Veredicto:**
- viable para crecer de 56 clases a muchas más, con este proceso: borrador de IA → banco (clasificación, choques, búsquedas) → una ronda con errores reales → revisión humana → pruebas;
- nunca en vivo;
- la revisión humana sigue siendo obligatoria (seguridad, encaje y lo que el banco no ve).

---

## 7. Lo que ninguna de las cuatro resuelve

- **La calidad de una recomendación la decide el cliente en la llamada.** Todo lo de arriba son indicios hasta que la medición diga otra cosa.
- **Juguetes, ventiladores y lámparas:** aun con reglas nuevas, ni Liverpool sabe qué los complementa (sus carruseles traen relleno). Ahí la tarjeta seguirá siendo más pobre.
- **El asesor:** que diga o no la recomendación no depende del algoritmo.

---

## 8. Qué haría, en este orden

| # | Qué | Por qué en ese lugar | Tamaño |
|---|---|---|---|
| 1 | **Corregir los 4 errores de §2d** (v3.2) | Son defectos de hoy, con prueba clara. | Pequeño |
| 2 | **Evaluación humana (fase B)** con la muestra de §9: la tarjeta de hoy contra la del punto 2, a ciegas | Da una línea base y una comparación en días, sin datos personales ni red. | Pequeño |
| 3 | **Punto 2:** leer los carruseles y la búsqueda del stream, y reordenar en el top-5 con tope de precio | Es lo de mayor valor medido y no toca permisos ni privacidad. | Medio |
| 4 | **Piloto local (fase A)** en el Chrome del creador | Empieza a contar aceptación real sin infraestructura. | Pequeño |
| 5 | **Punto 5:** categorías nuevas con IA y validación | Amplía la cobertura con revisión humana. | Pequeño por categoría |
| 6 | **Punto 1:** la bolsa, con ventana, guardia de modelo y `si` sobre el equipo | Sirve en fichas de accesorio. Necesita los datos de 4 para saber si vale la pena. | Medio-alto |
| 7 | **Fases C y D** (medición central y A/B) | Solo con TI informado y el doc 14 actualizado. | Alto |

---

## 9. Muestra para la evaluación humana (50 fichas reales, 04/10/2026)

Las tres recomendaciones que la tarjeta muestra **hoy**. Para la fase B se mezclan, a ciegas, con las reordenadas del punto 2. Cada asesor marca, por recomendación: «¿la ofrecerías en esta llamada?» (sí/no). Para acuerdo entre evaluadores con κ ±0.10 se recomiendan 150-200 fichas; estas 50 sirven de calibración. **[fuente]**

| # | Ficha (precio) | Recomendación 1 | Recomendación 2 | Recomendación 3 |
|---|---|---|---|---|
| 1 | Cafetera pop deluxe titan ($2,395) | Espumador de leche eléctrico ($324) | Set de tazas americanas 4 piezas ($349) | Termo de acero inoxidable ($459) |
| 2 | Combo licuadora Plus DUO 3 velocidades ($2,799) | Freidora de aire 4.7 L ($2,379) | Horno de microondas ($2,924) | Batidora de inmersión ($529) |
| 3 | Freidora de aire 6 L ($1,756) | Molde para freidora de aire ($199) | Licuadora 2 velocidades ($1,189) | Horno de microondas ($2,664) |
| 4 | Horno de microondas MS32DG ($2,664) | Tapa para microondas ($58) | Licuadora Xtreme Mix ($2,883) | Regulador de voltaje ($799) |
| 5 | Smartwatch Fit 3 con GPS ($1,199) | Correa para smartwatch ($629) | — | — |
| 6 | Cámara instantánea Instax Mini 12 ($1,861) | Papel fotográfico Instax Mini ($479) | Estuche para cámara instantánea ($419) | Álbum Instax Mini 12 ($499) |
| 7 | Multifuncional Smart Tank 580 ($3,399) | Papel bond ecológico ($1,117) | Supresor de picos 90J ($269) | — |
| 8 | Bocina portátil XB100 ($999) | Micrófono profesional inalámbrico ($1,919) | Cable USB-C a USB-A 1 m ($327) | — |
| 9 | Audífonos On-Ear inalámbricos ($989) | Porta audífonos in-ear ($699) | Cable USB-C 1.5 m ($127) | Bocina portátil Go Essential ($725) |
| 10 | Lavavajillas 12 servicios ($7,349) | Regulador de voltaje ($799) | Sal para lavavajillas 5 kg ($599) | — |
| 11 | Minisplit inverter frío 12,000 BTU ($4,986) | Regulador de voltaje ($1,999) | Control remoto para aire ($579) | — |
| 12 | Cafetera espresso ($1,559) | Molino para café de acero ($1,079) | Espumador de leche ($324) | Set de tazas americanas ($349) |
| 13 | Batidora de pedestal 12 velocidades ($2,071) | Set de moldes ($499) | Licuadora reversible ($3,499) | Freidora de aire ($1,756) |
| 14 | Purificador True HEPA ($2,029) | Humidificador 320 ml ($1,199) | — | — |
| 15 | Cepillo de vapor DT7111 ($979) | Burro de planchar de acero ($1,889) | Quitapelusas eléctrico ($742) | — |
| 16 | Monitor gamer 27" ($3,199) | Teclado gamer ($559) | Mouse inalámbrico ($229) | Audífonos in-ear ($447) |
| 17 | iPad A16 11" ($10,999) | Funda para iPad A16 ($1,799) | Pencil (USB-C) ($1,799) | Mouse gamer inalámbrico ($499) |
| 18 | Proyector X8 ($1,800) | Pantalla para proyector ($1,490) | Bocina inalámbrica ($599) | Reproductor de CD ($2,393) |
| 19 | Set de almohada pillow ($647) | Juego de sábanas ($479) | Set de colcha infantil ($720) | Protector de almohada ($479) |
| 20 | Set edredón Confort ($699) | Juego de sábanas de microfibra ($499) | Set de almohada ($659) | Funda para almohada ($511) |
| 21 | Juego de sábanas de poliéster ($479) | Set funda duvet ($719) | Almohada firmeza suave ($709) | Funda para almohada ($145) |
| 22 | Sofá Bishop ($18,199) | Mesa de centro ($10,499) | Tapete ($899) | Cojín decorativo ($223) |
| 23 | Silla de escritorio Misha ($899) | Escritorio ($999) | Organizador de libros ($1,649) | Lámpara de escritorio LED ($419) |
| 24 | Batería de cocina supercook ($2,599) | Set de espátulas ($519) | Cuchillo para chef ($359) | Tabla para picar ($469) |
| 25 | Sartén Easy Titanium ($356) | Set de espátulas ($519) | Set de cuchillos ($381) | Tabla para picar de bambú ($149) |
| 26 | Vajilla para 4 personas ($1,037) | Set de cubiertos ($1,019) | Set de vasos highball ($344) | Set de tazas americanas ($245) |
| 27 | Carriola de bastón ($524) | Autoasiento booster ($740) | Fular para bebé ($649) | Organizador para auto ($758) |
| 28 | Autoasiento booster ($1,899) | Carriola de bastón plegable ($1,399) | Protector para asiento ($949) | Parasol para ventana ($217) |
| 29 | Cuna convertible ($3,617) | Colchón para cuna ($2,589) | Protector de colchón ($197) | Set de sábanas de cuna ($379) |
| 30 | Silla alta Bistro ($1,399) | Set de alimentación 9 piezas ($496) | Set de baberos de silicón ($417) | Tapete de espuma ($599) |
| 31 | Bicicleta de ruta rodada 26 ($2,999) | Casco para ciclismo ($1,199) | Candado de cable ($139) | Lámpara delantera para bicicleta ($799) |
| 32 | Caminadora plegable ($4,399) | Tapete deportivo ($139) | Regulador de voltaje ($799) | Mancuernas 4 kg ($457) |
| 33 | Set de mancuernas 2 piezas ($349) | Tapete deportivo ($639) | Banco doble altura ($509) | Guantes para entrenamiento ($499) |
| 34 | Tenis Galaxy 8 para correr, mujer ($1,119) | Playera deportiva ($140) | Pantalón deportivo ($629) | Calceta para entrenamiento ($236) |
| 35 | Maleta de viaje Kioto ($1,019) | Candado TSA ($299) | Set de bolsas organizadoras ($437) | — |
| 36 | Mochila escolar para niño ($314) | Candado TSA ($299) | Set de bolsas organizadoras ($437) | — |
| 37 | Bolsa shoulder para mujer ($524) | Cartera para mujer ($399) | Cinturón para mujer ($247) | Lentes de sol para mujer ($499) |
| 38 | Cartera para hombre ($699) | Cinturón para hombre ($612) | Tarjetero para hombre ($559) | Llavero de piel ($349) |
| 39 | Reloj Hilfiger para hombre ($2,474) | Caja para reloj ($539) | Cartera para hombre ($1,099) | — |
| 40 | Lentes de sol para hombre ($299) | Traje de baño ($497) | Sombrero para outdoor ($349) | Sandalia para hombre ($461) |
| 41 | Aretes de oro 14 k ($583) | Collar con dije de letra ($879) | Pulsera de plata ($889) | Anillo de plata ($807) |
| 42 | Vestido largo de fiesta ($1,890) | Zapatilla textil ($1,899) | Bolsa clutch para mujer ($899) | — |
| 43 | Traje para hombre ($1,217) | Camisa de vestir ($499) | Corbata ($349) | Zapato derby ($1,499) |
| 44 | Base de maquillaje líquida ($290) | Primer ($154) | Polvo compacto traslúcido ($388) | Corrector ($127) |
| 45 | Crema facial calmante ($194) | Protector solar FPS 50 ($319) | — | — |
| 46 | Shampoo anticaída ($208) | Acondicionador ($175) | Tratamiento mascarilla ($350) | Aceite para cabello ($245) |
| 47 | Secadora de cabello InfinitiPro ($749) | Protector de calor ($199) | Cepillo para cabello ($608) | Alaciadora ($712) |
| 48 | Recortadora de barba y bigote ($546) | Tratamiento para barba ($269) | Loción para después de afeitar ($293) | Repuesto de recortadora ($789) |
| 49 | Cepillo de dientes eléctrico ($535) | Repuesto para cepillo ($351) | Pasta dental 75 ml ($116) | Blanqueador dental ($788) |
| 50 | Asador de carbón ASA-1G ($569) | Set de utensilios para asar ($699) | Funda para asador ($769) | Carbón vegetal 4 kg ($499) |

La fila 36 ya muestra lo que la evaluación cazaría: es uno de los errores de §2d.

---

## 10. Método, reproducibilidad y fuentes

**Cómo se hizo:**
- **El código de laboratorio y las cifras en bruto están en `Documentacion/anexos-18/`**, con un README de cómo correrlo. No es la extensión.
- **Recolector:** `anexos-18/colector-v2.js`. Lee el stream de la ficha y de la búsqueda.
  - 110 fichas: las 81 del corpus del doc 17, 21 de las categorías nuevas y 8 de accesorios.
  - 234 búsquedas, con 3 s entre pedidos y freno ante cualquier bloqueo. **No hubo ni uno.**
  - Una pestaña de ficha se colgó a la media hora, probablemente por los scripts de Liverpool corriendo de fondo **[supuesto]**: con la misma página, el análisis tardó 43 ms. Se siguió desde `robots.txt`, que no ejecuta nada, sin perder lo guardado en IndexedDB.
- **Análisis:** `anexos-18/analisis.js` (puntos 1 y 2) y `anexos-18/validar-ia.js` (punto 5).
- **Borradores de la IA:** `anexos-18/borrador-ia.js` y `anexos-18/borrador-ia-v2.js`. Sin revisión humana.
- **Cifras:** en `anexos-18/resultados.md`.

**Avisos:**
- Las cifras de las cotizaciones se leyeron por consulta, solo columnas de producto y fecha. Un primer intento descargó por error un archivo de 198 bytes con los encabezados de `DetalleCotizaciones`; se revisó (sin datos de clientes) y se borró.
- La investigación de escritorio agotó la cuota de búsquedas web de la sesión (200). Algunas preguntas quedaron con menos fuentes; cada informe lo señala.

**Fuentes principales:**

*Calidad del candidato:*
- Spiegel Research Center (2017), «How Online Reviews Influence Sales»: https://spiegel.medill.northwestern.edu/how-online-reviews-influence-sales/
- Maslowska, Malthouse y Bernritter (2017), *Int. J. of Advertising*: https://experts.illinois.edu/en/publications/too-good-to-be-true-the-role-of-online-reviews-features-in-probab/
- You, Vadakkepatt y Joshi (2015), meta-análisis en *J. of Marketing*: https://www.semanticscholar.org/paper/A-Meta-Analysis-of-Electronic-Word-of-Mouth-You-Vadakkepatt/178e74ae022d9424c6edc1e672fe69e1d3da21a6
- Evan Miller, cómo ordenar por calificación: https://www.evanmiller.org/ranking-items-with-star-ratings.html
- Dash et al. (2024), anuncios patrocinados en Amazon: https://arxiv.org/abs/2407.19099
- Topsort y Liverpool: https://www.topsort.com/customer-blog/liverpool
- AMVO, marketplaces en México: https://amvo.org.mx/reporte-data-en-accion
- Anderson, Fitzsimons y Simester (2006), faltantes de inventario: https://ideas.repec.org/a/inm/ormnsc/v52y2006i11p1751-1763.html
- Anderson y Simester (2001), letreros de oferta: https://ideas.repec.org/a/inm/ormksc/v20y2001i2p121-142.html

*Medición:*
- Sharma, Hofman y Watts, clics causales: https://arxiv.org/abs/1611.09414
- Google Cloud, métricas de recomendaciones: https://docs.cloud.google.com/retail/docs/metrics
- Evan Miller, cómo no hacer un A/B: https://www.evanmiller.org/how-not-to-run-an-ab-test.html
- Microsoft Personalizer: https://learn.microsoft.com/en-us/azure/ai-services/personalizer/where-can-you-use-personalizer
- Basham, nueva LFPDPPP: https://basham.com.mx/en/nueva-ley-federal-de-proteccion-de-datos-personales-en-posesion-de-los-particulares-publicada-en-el-diario-oficial-de-la-federacion/
- DLA Piper, México: https://www.dlapiperdataprotection.com/index.html?t=law&c=MX
- McHugh (2012), κ: https://pmc.ncbi.nlm.nih.gov/articles/PMC3900052/

*IA:*
- COSMO (Amazon): https://www.amazon.science/publications/cosmo-a-large-scale-e-commerce-common-sense-knowledge-generation-and-serving-system-at-amazon
- FolkScope: https://arxiv.org/html/2211.08316v2
- Etiquetado de relaciones con LLM: https://ar5iv.labs.arxiv.org/html/2305.09858
- BEQUE (Taobao): https://arxiv.org/html/2311.03758
- ShoppingComp: https://arxiv.org/html/2511.22978v1
- Precios de Claude: https://platform.claude.com/docs/en/about-claude/pricing
