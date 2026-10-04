# 17 · Investigación de venta cruzada: qué se lleva con qué, medido en Liverpool

> **El pedido del creador (04/10/2026):** «… que sigas nutriendo más y potenciando más las recomendaciones que da la extensión de forma inteligente… Investiga a profundidad qué artículos suelen llevarse… Quiero que sea una herramienta que de verdad te pueda dar buenas recomendaciones disponibles en… la página de Liverpool.»
>
> **El resultado: extensión 2.9.** Reglas v3.1 (`reglas-venta.js`) y núcleo 1.4 (`recomendador-nucleo.js`). Solo la extensión.
> - El Portal no se tocó: había otro agente rediseñándolo.
> - El interruptor de la búsqueda (`88ace27`) sigue solo en pruebas, como pidió el creador («no lo subas»).
>
> **Dónde vive cada cosa:**
> - Las reglas y su porqué, en los comentarios de `reglas-venta.js`.
> - Las pruebas, en `pruebas/ext_recomendador.test.js` (252).
> - Las herramientas para repetir la medición, en `pruebas/ext_corpus_medir.js` y `pruebas/ext_corpus_comparar.js` (§9).

---

## 1. En una página

Medido sobre las **mismas 81 fichas reales** de liverpool.com.mx, con el mismo método y con las búsquedas que cada versión pide (§2.5):

| | 2.8 (reglas v2) | **2.9 (reglas v3.1)** |
|---|---|---|
| Fichas cuya clase reconoce | 31 de 81 | **78 de 81** |
| Recomendaciones que muestra | 214 | **203** |
| … de un tipo que la regla conoce («funda», «cápsulas»…) | 67 | **203 (todas)** |
| … de tipo desconocido: lo que trajera el carrusel, sin filtro | **147** | **0** |
| Fichas donde SOLO había de esas | 49 | 0 |
| Recomendaciones que trajo la búsqueda en Liverpool | 29 (en 23 fichas) | **83 (en 61 fichas)** |
| Fichas sin ninguna recomendación | 4 | 6 (a propósito: §8) |
| Clases · tipos de complemento | 16 · 62 | **56 · 281** |

Lo que eso significa en la ficha, con ejemplos reales:

| Ficha | 2.8 recomendaba | 2.9 recomienda |
|---|---|---|
| Cafetera de cápsulas Dolce Gusto | enfriador de aire, licuadora, molino de café | **cápsulas Dolce Gusto**, espumador de leche, tazas |
| Aspiradora robot | tetera, plancha, **panel solar** | nada; un botón para buscar sus repuestos |
| Cepillo dental eléctrico | repuesto, **L-carnitina**, **colágeno** | cabezales, pasta, blanqueador |
| Rasuradora | **smartwatch**, sandalias, playera | aceite para barba, after shave, pomada |
| Lavavajillas | (como si fuera estufa) campana, batería de cocina | regulador, **sal para lavavajillas** |
| Secadora de cabello | (como si fuera de ropa) nada; buscaba «lavadora Conair» | protector de calor, cepillo, alaciadora |
| Proyector | laptop, tablet, control de TV | **pantalla para proyector**, barra de sonido, Roku |
| Bicicleta | «de Polipropileno», **suplemento**, patines | **casco**, candado, luz |
| Cuna | colchón de adulto, mecedora, protector | **colchón para cuna**, protector, sábanas de cuna |
| Lentes de sol | sandalia, pantufla, pijama | traje de baño, sombrero, sandalia |
| Monitor | **anillo inteligente**, audífonos, un celular | teclado, mouse, audífonos |

**Cómo se logró, en cinco ideas:**
1. **La clase primero.** Si no se sabe qué es el artículo, no se recomienda nada (antes se enseñaba lo que trajera el carrusel).
2. **Tipos cerrados.** Lo que la regla no conoce no entra. «Complementa con» mezcla complementos de verdad con lo que el sitio empuja ese día.
3. **Lo que más se vende junto casi nunca está en los carruseles:** las cápsulas, la sal, el casco, el candado TSA. Eso lo trae la búsqueda, con plantillas probadas una por una en Liverpool.
4. **Datos de fuera para decidir QUÉ buscar, y el corpus para decidir CÓMO lo llama Liverpool.** Ninguna cifra externa entró sin comprobarse contra una ficha o una búsqueda reales.
5. **Mejor callar que errar.** Lo que depende del modelo exacto (la tinta de UNA impresora, los repuestos de UNA aspiradora) no se busca solo: queda como botón para que el asesor lo busque con el cliente.

---

## 2. Método

### 2.1 El corpus: 81 fichas reales y lo que Liverpool recomienda en ellas

- **Qué se tomó:** para 81 búsquedas de 60+ categorías (de «cafetera de cápsulas» a «muñeca barbie»), la primera ficha de liverpool.com.mx. De cada una:
  - sus datos: nombre, marca, migas, «Producto», «Modelo comercial», variantes, precio;
  - sus tres carruseles: «Complementa con», «Otros clientes compraron» y «Artículos relacionados». Son lo más cerca que hay de las ventas de Liverpool.
- **Cómo:** desde el Chrome del creador, misma pestaña y misma sesión, en 8 tandas con 3 s entre pedidos. **Ni un bloqueo.** (Chrome headless sí recibe «Access Denied»).
- **Dónde quedó:** en `sessionStorage` de esa pestaña (~1.4 MB), con las 101 búsquedas hechas para probar plantillas.

### 2.2 La investigación de fuera, en tres frentes

Tres investigaciones en paralelo con búsqueda web: hogar y línea blanca, tecnología, y moda y belleza. Buscaban **tasas de compra conjunta (attach rate)** y **canastas**. En moda se calculó el *lift* sobre las 31.8 millones de líneas de compra del conjunto público de H&M. Las cifras y sus fuentes están en §4. **Se tomaron como una lista de qué buscar, no como verdad:**
- casi todas son de EE. UU. o de Europa;
- un *lift* dice que dos cosas se compran juntas, no que una lleve a la otra;
- algunas («la regla del 25 %») no tienen estudio detrás.

### 2.3 Cada plantilla de búsqueda, probada en Liverpool

- **Qué se probó:** 94 plantillas (`buscar: 'cápsulas {sistema}'`) contra el buscador real. Cada una con su conteo: de los 10 primeros resultados, cuántos son del tipo buscado.
- **Por qué importa:** Liverpool nombra las cosas a su manera:
  - las cápsulas son «Set de 16 cápsulas…»;
  - la pantalla es «Pantalla Manual para Proyector»;
  - el protector es «Protector de calor para cabello», no «protector térmico»;
  - el de la barba es «Tratamiento para barba Aceite…».
- **Lo que se ajustó:** las plantillas que traían 0, y las que traían otra cosa, se rehicieron o se pasaron a botón (§5).

### 2.4 El barrido: 102 nombres que NO estaban en el corpus

- **Para qué:** encontrar choques de clasificación que el corpus no tenía. Se escribieron 102 nombres típicos de Liverpool («Traje de baño completo para mujer», «Reloj de pared», «Batería portátil 10000 mAh»…), con su «Producto» y sus migas plausibles.
- **Resultado:** 23 caían en la clase equivocada. De ahí el campo `noEs` (§6).
- **Los 4 que quedan son discutibles, no errores**, y no se fuerzan:
  - silla gamer → muebles de oficina;
  - tetera → cafeteras;
  - centro de lavado y lavasecadora → sin clase (a propósito: con ellas no va una secadora).

### 2.5 Cómo se midió el antes y el después

Las mismas 81 fichas, la misma caché de búsquedas y la misma herramienta (`ext_corpus_comparar.js`) con las reglas y el núcleo de cada versión:
- **2.8 = `main` del 04/10** antes de este cambio. Pidió 9 búsquedas que la caché no tenía y se le hicieron, para no ponerla en desventaja.
- **2.9 = este cambio.** La última medición no hizo ni un pedido: todo salió de la caché.

---

## 3. Lo que enseñó el corpus

| Hallazgo | Consecuencia en las reglas |
|---|---|
| **«Otros clientes compraron» es casi siempre OTRO de lo mismo** (otras cafeteras, otras carriolas). | Sustitutos: van a la venta incremental, nunca a la cruzada. |
| **«Complementa con» trae complementos reales MEZCLADOS con lo que el sitio empuja ese día** (lavavajillas junto a una aspiradora; enfriador y lavadora junto a una cafetera). | Tipos cerrados: lo que la regla no conoce no entra. |
| **Las migas de campaña engañan:** «Buen Fin», «Top deals», «Lo más vendido en tienda», «Outlet», «LANZAMIENTOS» ocupan el lugar de la categoría. | `migaUtil`: se toma la miga más específica que no sea campaña. |
| **La marca de Liverpool Care viene en las 81 fichas,** almohadas y LEGO incluidos. | Liverpool Care solo en las clases de equipos, y desde la 1.4 tampoco en sus accesorios. |
| **El nombre abre con el sustantivo** («Funda para…», «Set de 16 cápsulas…»). | Los tipos se reconocen por la palabra con que ABRE el nombre. |
| **Ni un «agotado» en los carruseles** de las 81 fichas. | El núcleo ya ignora `agotado`, pero la tarjeta aún no lo lee (§8). |
| **Lo más natural casi nunca está en los carruseles:** cápsulas, tinta, casco, candado TSA, sal. | Se buscan (§2.3). |
| **«Producto» a veces dice otra cosa:** el del asador dice «Carbón» (su combustible). | El «Producto» solo decide el tipo de la ficha si el nombre no abre como su clase (1.4). |

---

## 4. Lo que dicen los datos de fuera, y qué se hizo con cada uno

| Hallazgo | Fuente | Qué cambió |
|---|---|---|
| Con el celular se lleva funda el 68 % (87 % con iPhone), mica el 46 %, audífonos el 44 % y batería el 30 %. | [YouGov, accesorios de celular](https://yougov.com/en-us/articles/48154-american-consumers-and-cell-phone-accessories-spending-patterns-and-preferences) | Orden de los tipos del celular: funda, mica, cargador, audífonos, batería. |
| 30 Apple Watch por cada 100 iPhone. | [Counterpoint](https://counterpointresearch.com/en/insights/highest-attach-rate-ever-apple-watch-attach-rate-reached-30-north-america-h1-2022) | El smartwatch entra con el celular, abajo y con tope de precio (0.6). |
| El 40 % compra pantalla y barra de sonido juntas. | [Futuresource](https://www.futuresource-consulting.com/the-source/industry-pulse/the-rhythm-of-choice-new-futuresource-research-explores-headphone-and-soundbar-buying-decisions/) | Barra de sonido, segunda con la pantalla. |
| El control es el accesorio que más vende; 2.46 juegos por cada Switch 2. | [Circana](https://gamedevreports.substack.com/p/circana-the-us-gaming-market-in-december24); [Nintendo, vía Shacknews](https://www.shacknews.com/article/150272/nintendo-switch-2-3-82-million-sales-q1-fy27) | Consola: control primero, luego juego; con la portátil, su estuche. |
| 1.51 lentes por cámara de lente intercambiable. | [CIPA, vía Nikon Rumors](https://nikonrumors.com/2026/02/03/2025-full-year-cipa-numbers-compacts-up-30-in-units-and-49-in-shipped-value.aspx/) | Cámara: lente, memoria SD, mochila, batería. |
| La correa extra es buen negocio en el reloj. | [CNBC](https://www.cnbc.com/2015/06/18/apple-mines-big-profits-from-watch-band.html) | Correa, primer tipo del smartwatch. |
| Microsoft 365 cuesta 14-17 % de una laptop en Liverpool; el antivirus, 2-6 %. | Precios de Liverpool (04/10/2026) | Tipo «software» en laptop, con tope de 0.3. |
| Con colchón nuevo: sábanas 90 %, almohada 86 %, protector 72 %, topper 60 %. | [BedTimes 2022](https://bedtimesmagazine.com/2022/07/purchases-at-the-top/) | Colchón: protector, almohada, sábanas, box y **topper (nuevo)**. |
| El 54 % compra tapete al renovar la sala. | [Houzz](https://www.houzz.com/magazine/see-the-decor-and-building-products-homeowners-buy-the-most-stsetivw-vs~166931175) | Sala: tapete (0.55). |
| Profeco: el no-break no es para línea blanca; el regulador sí. | [Profeco, vía Rallynomics](https://rallynomics.com/mejor-no-break-y-regulador-para-tu-pc-en-mexico-2026-que-dice-profeco/) | **Se quitó el no-break** de refrigerador, lavadora, secadora y lavavajillas. |
| Las chichoneras de cuna están prohibidas en EE. UU. (Safe Sleep for Babies Act) y la AAP las desaconseja. | [Consumer Reports](https://www.consumerreports.org/babies-kids/child-safety/safe-sleep-for-babies-act-inclined-sleeper-crib-bumper-ban-a3847072461/) | **Cuna: nunca una chichonera,** aunque Liverpool la ponga en el carrusel. |
| Calcetas y calzado casi no se asocian (lift 0.6-1.2); pants y playera con tenis, 17-27 %. | [H&M, 31.8 M líneas](https://huggingface.co/datasets/dinhlnd1610/HM-Personalized-Fashion-Recommendations) | Tenis: playera (0.55) y pants (0.50) por encima de calcetas (0.40). |
| Bolsa con cartera, lift 9.6; aretes con collar, 8.7; reloj con pulsera, 20. | H&M (misma fuente) | Bolsa: cartera primero. Joyería: el juego. Reloj de mujer: joyería. |
| Lentes de sol con traje de baño: 12-13 %. | H&M | Lentes: traje de baño, sombrero o gorra, sandalias. |
| Vestido con bolsa o aretes: lift ~1 (débil). | H&M | Pesos moderados en el vestido: zapatillas 0.55, bolsa 0.40, aretes 0.35. |
| Fidelidad de marca: shampoo 45 %, acondicionador 34 %. | [YouGov, cabello](https://yougov.com/en-us/articles/50928-from-brand-loyalty-to-smell-what-shapes-us-consumers-hair-care-choices) | Sin candado de misma marca en shampoo y acondicionador. |
| El perfume es el 35.8 % de los regalos del Día de las Madres. | [Mitofsky](https://www.mitofsky.mx/post/festejos-del-dia-de-la-madre-en-mexico-encuesta-mayo25) | El set de SU línea y la crema corporal de su línea (no «otro perfume»). |
| Las garantías extendidas, vistas con escepticismo por el consumidor. | [Consumer Reports](https://www.consumerreports.org/extended-warranties/steer-clear-extended-warranties/) | Liverpool Care solo en las clases de equipos; nunca en accesorios ni en lo que no tiene clase. |

---

## 5. Lo que se descartó, y por qué

| Descartado | Por qué |
|---|---|
| No-break con línea blanca | Profeco: no es para eso. Lo correcto es el regulador. |
| Chichonera con la cuna | Prohibida en EE. UU.; la AAP la desaconseja. |
| Kit de instalación de minisplit, base para condensadora | No existen en Liverpool ([Home Depot sí vende el kit](https://www.homedepot.com.mx/p/mirage-kit-de-instalacion-para-minisplits-1-y-15-toneladas-kitm1-233211)). Una búsqueda que trae 0 es peor que nada. |
| Soporte de techo para proyector | Liverpool no lo vende: se quitó el tipo. |
| Tapete «para caminadora» | No existe con ese nombre; se busca «tapete deportivo». |
| Buscar sola la tinta, los repuestos, el filtro, el pedestal, el kit de apilado o la batería de la herramienta | Dependen del modelo EXACTO y la búsqueda no puede comprobar que le queden. Quedan como **botón** (`soloSugerir`, 7 tipos). |
| Búsquedas con la marca de la ropa («tenis Sexy jeans mujer») | Traen 0. La ropa se busca por género («blusa para mujer»). |
| Candado de misma marca en shampoo y acondicionador | La fidelidad es baja (45 % y 34 %). |
| Recomendar algo en una ficha cuya clase no se reconoce | Los carruseles traen de todo. La tarjeta se queda con la subida y las promociones. |
| «La regla del 25 %» como dato | Aparece en blogs ([Oberlo](https://www.oberlo.com/blog/upselling-and-cross-selling)), sin estudio detrás. Se queda como **criterio** para el tope de la subida, no como hallazgo. |

---

## 6. Los cambios en el código

### 6.1 `reglas-venta.js`: v2 → v3.1

- **De 16 clases a 56, y de 62 tipos de complemento a 281.** Todas las clases nuevas salieron del corpus:
  - **Tecnología:** smartwatch, proyector, cámara, impresora, audífonos y bocinas por separado.
  - **Línea blanca:** lavavajillas, aire, microondas.
  - **Pequeños electrodomésticos:** cafetera, cocina eléctrica, aspiradora, purificador, plancha.
  - **Hogar:** blancos, sala, oficina, cocina, mesa, asador, herramienta.
  - **Bebés:** carriola, autoasiento, cuna, silla alta.
  - **Deportes y viaje:** bicicleta, ejercicio, pesas, maleta, mochila escolar.
  - **Moda:** traje, bolsa, cartera, reloj, lentes, joyería.
  - **Belleza:** maquillaje, cuidado facial, cabello, barbería, bucal.
- **Opciones nuevas por clase o tipo:**
  - `variables` (el sistema de la cafetera, el formato de la Instax);
  - `requiereVar` (la cápsula tiene que decir «Dolce Gusto»);
  - `soloSugerir` (botón, no búsqueda);
  - `topePrecio` por clase y por tipo;
  - `noEs`.
- **`noEs` (v3.1):** lo que se le parece y no es. Si el nombre o el «Producto» lo dicen, la clase no puntúa; si solo lo dice la miga, la miga no cuenta. 10 clases lo usan:
  - «Traje de baño» no es traje;
  - «Reloj de pared» no es reloj;
  - «Pantalla para proyector» no es pantalla de TV;
  - «Mochila para laptop» no es mochila escolar;
  - «Cámara de seguridad» no es cámara;
  - «Plancha para el cabello» no es plancha de ropa;
  - «Colchón inflable» no es colchón;
  - «Bolsa para dormir» no es bolsa;
  - «Lentes de natación» no son lentes de sol;
  - «Computadoras de escritorio» no es mueble de oficina.
- **`noEs` va anclado al sustantivo que modifica** (`^reloj de pared`, no «de pared» en cualquier lugar). La primera versión, suelta, dejaba SIN clase y sin una sola recomendación a 19 nombres legítimos: «Escritorio para computadora», «Plancha de vapor… suela de acero», «Mochila escolar con portalaptop», «Lentes de sol… de protección UV400». No salía basura, solo silencio, y por eso ni el corpus ni el barrido lo vieron. Lo encontró la revisión final; 13 de esos nombres quedaron en las pruebas.
- **La laptop ya no se queda con todo lo «portátil»:** «Portátil» a secas sí (así viene la MacBook); «Batería portátil», «Disco duro portátil» y «Ventilador portátil» no.
- **Ropa es «por tipo»:** con los jeans va una blusa, que también es ropa. Antes, TODO lo que traía la búsqueda «blusa para mujer» se descartaba como sustituto, en cada jeans y cada playera.
- **Pisos de precio:** el tope general es el doble del artículo. Debajo de $1,500 es al menos 1.5: junto a una sartén de $356, unas espátulas de $424 son normales.

### 6.2 `recomendador-nucleo.js`: 1.2 → 1.4

- `migaUtil` y la lista de campañas.
- **Sin clase, sin complementos**, y sin Liverpool Care.
- `tipoPropio`: el tipo de la propia ficha, por nombre y, si el nombre no abre como su clase, por «Producto». Así ya no se ofrece otro protector solar con un protector solar, y el asador sigue ofreciendo carbón.
- `noEs` al clasificar y al reconocer candidatos.
- **La sección de Mascotas no se clasifica.** Cuenta la MIGA, no el nombre: «Dije de perro» es joyería.
- **La ficha de un ACCESORIO** (una mica en «Celulares», una correa en «Smartwatches»):
  - no lleva Liverpool Care;
  - otro del mismo tipo es un sustituto;
  - sus búsquedas usan el modelo del equipo que dice el nombre, no la clave del accesorio;
  - a un cargador sin modelo no se le pega la funda de UN iPhone.
  - **En las 81 fichas del corpus, ninguna quedó marcada como accesorio:** no hay falsos positivos en artículos principales.
- **«Genérico» no es una marca que buscar** («cargador usb c Genérico»).
- `diceVariables`, `soloSugerir` y el `si` de cada tipo, respetados al elegir y al buscar.

### 6.3 Pruebas: 163 → 252

`pruebas/ext_recomendador.test.js` suma tres secciones:
- **15:** casos recortados del corpus real.
- **16:** el barrido. 27 nombres con su clase, 13 de ellos legítimos que un `noEs` suelto dejaba sin clase, y 18 con la que NO pueden tener.
- **17:** la ficha de un accesorio.

**Las pruebas sí distinguen la versión nueva de la vieja:**
- contra las reglas de la 2.8, fallan 60 de las 252;
- contra la primera v3.1, la del `noEs` suelto, fallan 12.

---

## 7. Las 81 fichas, antes y después

(B) = lo trajo la búsqueda en Liverpool. «Sin clase» = la versión no reconocía el artículo y enseñaba lo que trajera el carrusel.

| Búsqueda | 2.8 | 2.9 |
|---|---|---|
| cafetera de cápsulas | sin clase: enfriador de aire, licuadora, molino | cápsulas Dolce Gusto (B), espumador, tazas (B) |
| licuadora | sin clase: freidora, horno eléctrico, plancha de ropa | freidora, microondas, batidora |
| freidora de aire | sin clase: combo licuadora, microondas, crepera | molde para freidora (B), licuadora, microondas |
| horno de microondas | sin clase: combo licuadora, molino, otro microondas | contenedores de vidrio (B), tostador, regulador (B) |
| aspiradora robot | sin clase: tetera, plancha, panel solar | nada; botón «repuestos aspiradora Koblenz» |
| smartwatch | sin clase: dije de perro, pulsera, collar | correa (B); botones: mica y cargador |
| cámara instantánea | sin clase: papel Instax, estuche, kit | papel Instax mini, estuche, álbum (B) |
| impresora multifuncional | sin clase: audífonos, mochila escolar, mouse y teclado | papel bond (B), regulador; botón «tinta Hp» |
| bocina bluetooth | porta audífonos, cable | micrófono (B), cable |
| audífonos inalámbricos | adaptador (B) | porta audífonos (B), adaptador (B), bocina |
| lavavajillas | como estufa: campana (B), batería de cocina (B) | regulador (B), sal para lavavajillas (B) |
| aire acondicionado | sin clase: otro minisplit, freidora, estufa | regulador (B), control remoto |
| cafetera espresso | sin clase: molino, hervidor, descalcificador | molino, espumador, tazas (B) |
| batidora de pedestal | sin clase: horno, licuadora, combo licuadora | molde (B), licuadora, freidora (B) |
| purificador de aire | sin clase: aspiradora, cafetera, espumador | humidificador; botón «filtro» |
| plancha de vapor | sin clase: cepillo de vapor, generador, cinta métrica | burro de planchar (B), quitapelusas |
| ventilador de torre | sin clase: rebanador, espátulas, batería portátil | nada (sin clase, a propósito) |
| monitor gamer | sin clase: anillo inteligente, audífonos, un celular | teclado (B), mouse (B), audífonos |
| iPad | funda A16 (B), Pencil, adaptador | igual |
| proyector | sin clase: laptop, tablet, control de TV | pantalla para proyector (B), barra, Roku (B) |
| almohada | sin clase: sábanas, cobertor, toalla | sábanas, colcha, protector de almohada (B) |
| edredón | sin clase: sábanas, figura navideña, girasol | sábanas, almohada, funda de almohada |
| juego de sábanas | sin clase: funda decorativa, funda duvet, colcha | funda duvet, almohada, funda de almohada |
| sofá | sin clase: sillón, otro sofá, mesa lateral | mesa lateral, tapete (B), cojín (B) |
| silla de oficina | sin clase: escritorio, organizador, estante | escritorio, organizador, lámpara (B) |
| batería de cocina | sin clase: tabla, caja fuerte, copas | espátulas (B), cuchillos, tabla |
| sartén | sin clase: coladera, pinza, espátulas | espátulas, cuchillos (B), tabla (B) |
| vajilla | sin clase: bowl, plato, taza (de la misma vajilla) | cubiertos, vasos, taza |
| carriola | autoasiento, pañalera (B) | autoasiento, canguro, pañalera (B) |
| autoasiento | sin clase: carriola, relajante, baberos | carriola, protector para asiento (B) |
| cuna | sin clase: colchón de adulto, mecedora, protector | colchón para cuna, protector, sábanas de cuna (B) |
| silla alta | sin clase: andadera, baberos, tapete | set de alimentación, baberos, tapete |
| bicicleta | sin clase: «de Polipropileno», suplemento, patines | casco (B), candado, luz (B) |
| caminadora | sin clase: bicicleta fija, elíptica, estación | tapete, regulador (B), mancuernas |
| mancuernas | sin clase: set, polaina, banco | tapete, banco, guantes |
| tenis para correr (mujer) | calcetas (B), playera, pantalón deportivo | playera, pantalón deportivo, calcetas (B) |
| maleta de viaje | sin clase: toalla Star Wars, sandalia, taza | candado TSA (B), organizadores (B) |
| mochila escolar | sin clase: lonchera, lapicera, mochila portalaptop | lonchera, lapicera, termo (B) |
| bolsa de mano | sin clase: cinturón, chamarra para correr, anillo | cartera (B), cinturón, lentes de sol (B) |
| cartera de piel | sin clase: pantalón, playera, set de playeras | cinturón, tarjetero, llavero (B) |
| reloj para hombre | sin clase: dije de perro, pulsera, collar | caja para reloj (B), cartera (B) |
| lentes de sol | sin clase: sandalia, pantufla, pijama | traje de baño (B), sombrero (B), sandalia |
| aretes de oro | sin clase: collar, dije, medalla | collar, pulsera (B), anillo (B) |
| vestido de fiesta | tenis (B), gorra (B) | zapatillas (B), bolsa clutch (B) |
| jeans de mujer | top, cinturón (B) | playera, tenis (B), chaleco |
| traje para hombre | sin clase: zapato, camisa, chamarra casual | camisa formal, corbata (B), zapato oxford |
| zapatos de vestir | calcetines, playera polo | cinturón, calcetines, limpiador para calzado (B) |
| perfume para hombre | nada | nada; botones: el set y la crema de su línea |
| base de maquillaje | sin clase: corrector, rubor, fijador | primer, polvo, corrector |
| labial | sin clase: brocha, enchinador, brochas | brochas, fijador (B), máscara |
| crema facial | sérum, limpiador, protector solar | igual (otro orden) |
| shampoo | sin clase: tratamiento facial, labial, crema facial | acondicionador, tratamiento, aceite para cabello (B) |
| secadora de cabello | como secadora de ropa: nada | protector de calor (B), cepillo, alaciadora |
| plancha para cabello | sin clase: multiestilizador, rulos, tenaza | protector de calor (B), cepillo, secadora |
| rasuradora | sin clase: smartwatch, sandalias, playera | aceite para barba (B), after shave (B), pomada |
| cepillo dental eléctrico | sin clase: repuesto, L-carnitina, colágeno | cabezales, pasta, blanqueador |
| LEGO | sin clase: otros tres LEGO | nada (sin clase, a propósito) |
| muñeca Barbie | nada | nada |
| asador de carbón | sin clase: utensilios, parrillas, otro asador | set BBQ, funda, carbón (B) |
| taladro | sin clase: organizador, dados, desarmadores | dados, desarmadores, organizador |
| laptop HP | mouse, mochila, disco (B) | igual |
| lavadora | secadora, regulador (B) | secadora, regulador (B), funda |
| refrigerador | regulador (B) | igual |
| perfume Good Girl | set Good Girl (B), crema corporal (B) | igual |
| tenis Nike Air Max | calcetas (B), playera, pants | igual |
| pantalla Samsung 55" | soporte, barra (B), regulador (B) | igual |
| colchón matrimonial | protector, almohada (B), box | igual |
| PS5 | control, GTA VI, audífonos | igual |
| audífonos Sony | porta audífonos, cable | porta audífonos, cable, bocina |
| Galaxy A56 | funda (B), adaptador, un smartwatch Garmin Forerunner | funda (B), adaptador; botones: mica y audífonos |
| iPhone 16 | funda, mica (B), adaptador | igual |
| estufa | campana, batería de cocina (B) | igual |
| secadora de ropa | lavadora, regulador (B) | igual |
| tablet Samsung | funda (B), cargador | igual |
| Nintendo Switch 2 | control, Animal Crossing, audífonos (B) | control, Animal Crossing, funda |
| laptop gamer | mouse, mochila (B), disco (B) | igual |
| cámara mirrorless | sin clase: lente, otra cámara, micrófono | memoria SD (B), mochila para cámara (B), lente |
| barra de sonido | sin clase: otra barra, binoculares, cámara de seguridad | soporte, pantalla, cable HDMI (B) |
| colchón king (con box) | protector, almohada (B), box | protector, almohada (B): ya trae su box |
| perfume para mujer | nada | nada |
| protector solar | sérum (B), otro protector solar (B) | sérum (B), crema hidratante (B) |

---

## 8. Lo que sigue débil

- **Perfume.** Dos de tres fichas se quedan sin recomendación. Lo natural (el set de SU línea) depende de que Liverpool lo tenga; si no, quedan los botones.
- **Juguetes, ventiladores y lo que no tenga clase** muestran solo la subida y las promociones. Es a propósito, y es lo siguiente que habría que cubrir si el creador lo pide.
- **Computadoras de escritorio y «all in one»:** sin clase. Merecen una propia (teclado y mouse, Office, no-break, que aquí SÍ aplica, e impresora), pero sus plantillas habría que probarlas en Liverpool primero.
- **Moda y precio:** con el tope general (el doble), unos tenis de $1,299 no entran junto a una playera de $499. En moda quizá convenga un tope más alto.
- **Accesorios:** la tarjeta ya no se equivoca en ellos, pero ofrece poco (la funda del mismo modelo, un botón).
- **«Agotado»:** el núcleo ignora candidatos marcados `agotado`, pero la tarjeta no lee esa marca. No hizo falta: el corpus no tuvo ni uno.
- **No hay datos de venta propios.** Los pesos son criterio informado por datos de fuera. Lo ideal sería medirlos con las ventas de Ventel: qué se llevó junto en el mismo pedido.

---

## 9. Cómo repetir la medición

1. En el Chrome del asesor, una pestaña de liverpool.com.mx.
2. Concatenar y evaluar en la página, con `(0, eval)(texto)` desde un `<input type=file>`:
   - `product-inspector.js`;
   - `reglas-venta.js`, más `window.VENTEL_REGLAS = VENTEL_REGLAS;`;
   - `recomendador-nucleo.js`;
   - `pruebas/ext_corpus_medir.js`;
   - `pruebas/ext_corpus_comparar.js`.
3. Juntar el corpus: `await __corpusVM([…búsquedas…], { pausa: 3000 })`, en tandas de 10.
4. Medir: `await __despuesVM(Object.keys(JSON.parse(sessionStorage.vmCorpus)), { pausa: 3000 })`.
5. Para comparar con otra versión, evaluar encima sus reglas y su núcleo y repetir el paso 4. Lo buscado ya está en caché: `{ sinRed: true }`.
6. `__accVM()`: qué fichas quedan como accesorio (deben ser 0 en un corpus de artículos principales).

Con freno: cualquier respuesta que no sea 200, o «Access Denied», detiene todo. Con 3 s entre pedidos no hubo ni un bloqueo.
