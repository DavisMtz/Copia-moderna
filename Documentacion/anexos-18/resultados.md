# Resultados medidos — investigación de fortalecimiento (04/10/2026)

## Datos de Liverpool (verificado en la pestaña del creador, solo lectura)
- PDP iPhone 16: `crossSellProducts: "$undefined"`; el bloque del producto trae `"source":"VertexAI"`.
- Carruseles en el stream («Jewel | Log in | …»): Artículos relacionados (25), Complementa con (24-25), Más vendidos (23-25), Otros clientes compraron (25), PDP Vistos recientemente (20). Cada producto: productId, name, brand, priceInfo, discountLabel, categories[{id,label}], mainCategory, seller, marketplace, rating{average,count}, hasGift, variants.
- Red de la PDP: sin XHR propias de carrusel; terceros: Criteo, groovinads, jewelml (rerender.jewelml.io core-grid), Pinterest, Facebook, Bing, DoubleClick.
- Búsqueda /tienda?s=: 686 KB, ~1 s; `records` (56) con productId, title, priceInfo, productType, ratingInfo{productRatingCount, productAvgRating}, featureFlags{isMarketPlace, isSponsoredRecord,…}, brand, seller[], categories (rutas), carrouselCategories, mainCategory, geoStoreIds, labels.
- Orden: Destacados (Relevancia|0), Novedades (newArrival|1), Menor precio (sortPrice|0), Mayor precio (sortPrice|1), Mejor calificados (rating|1). URL que funciona: `&sort=rating%7C1` (sortBy, sortby y Ns NO).
- «funda iphone 16»: 1.º = funda TPU MKP «Kiosla Shop» $899 ★0(0); 5.º = Funda de silicón LIV $1,099 ★4.83(6). 30/56 marketplace, 20/56 con opiniones.
- Bolsa: GET /tienda/cart desde la PDP: 200, 519 KB, ~0.5 s. lineItems con id, sku, productName, productSlug, productType, categoryId/categoryName (null), price/salePrice/listPrice, quantity, sellerName, isMarketplace, brand, department, isOnStock, productId, addedAt, lastModifiedAt, limitedStock, edd… La cabecera de la PDP trae la cuenta (`header-cart-quantity` = 2).
- La bolsa real tenía 2 artículos: Bocina JBL Boombox 4 (56.1 h) y Redmi Note 14 Pro+ (61 h, marketplace). Ambos en existencia.

## Datos propios
- DetalleCotizaciones: 42 renglones; Cotizaciones: 17 folios en 8 días (24/09: 1, 25/09: 2, 26/09: 1, 28/09: 2, 29/09: 1, 30/09: 1, 1/10: 1, 3/10: 8); estatus 14 Aprobada, 3 Enviada por Correo. La canasta JBL+Redmi repetida 5 veces (pruebas).
- Registros (Portal): 11 usuarios.
- Doc 14 (TI): «La extensión no tiene una sola llamada de red. No puede enviar nada a ningún lado» (desactualizado desde la 2.7: la búsqueda en vivo hace fetch a liverpool.com.mx). V-16: sin aviso de privacidad ni retención.

## Recolección
- 110 fichas (81 corpus + 21 categorías P5 + 8 accesorios) y 234 búsquedas; 0 bloqueos. Una pestaña de ficha se colgó a la media hora (scripts de Liverpool); se siguió desde robots.txt.

## Punto 2
- Base (bonus 1P 0.15, 16 resultados): 213 recomendaciones; 166 con opción; cambian 105. Hoy: sin opiniones 57, cal 4.56, MKP 57. Alt: sin opiniones 26, cal 4.85, MKP 35. En cambios: opiniones 25.6→69.8; precio ×1.19.
- Solo calificación: cambian 105; MKP alt 52; sin op. 23.
- 56 resultados: 172 con opción; cambian 113; precio ×1.36.
- Tope de precio ≤1.25× hoy: 146 con opción; cambian 87; sin op. 50→22; opiniones 29→81; precio ×0.79.
- **Top-5 de Liverpool + tope 1.25 (recomendada): 140 con opción; cambian 76; sin op. 49→23; cal 4.64→4.85; MKP 47→34; opiniones 26.7→81.3; precio ×0.80.**
- Top-3 + tope 1.25: 132; cambian 62; sin op. 45→26; cal 4.66→4.82; MKP 44→36; precio ×0.76.
- Caso malo sin top-N: tazas para cafetera → «Set de tazas infantil Bob Esponja».
- Prevalencia: 234 búsquedas, 12,297 registros: 0 patrocinados; 0 sin «online»; 52 % con opiniones; 46 % MKP; 43 % con descuento. Carruseles (7,124): 45 % con opiniones, 48 % MKP, 84 % con etiqueta de descuento.
- Categoría vs tipo (complementa+otros, 3,366): 1,076 con tipo; pureza media 85.8 % (93 tipos); 151 «dudosos» (casi todos ruido de categoría); 330 «perdidos» (de 20 revisados, 2-3 reales).
- Más vendidos: aporta tipos nuevos en 9/78 fichas (23 candidatos); riesgo: cartuchos 667 para una Smart Tank.
- Opiniones por carrusel: complementa 60 % con op., prom 25.9, MKP 37 %; masVendidos 62 %, 20.7, 33 %; otros 38 %, 6.7, 50 %; relacionados 41 %, 9.8, 48 %.

## Punto 1 (escenarios)
- S3 adaptador Apple + iPhone: nada → funda + mica iPhone 16. S6 control PS5 + consola: nada → juego + base + audífonos. S7 cápsulas + cafetera: nada → espumador (+ molino por `si` evaluado en el nombre del accesorio).
- S4 correa + Apple Watch: + audífonos. S5 protector + colchón: ≈ igual. S1 funda + iPhone: ≈ igual (búsqueda de audífonos con la marca del equipo, no LACOSTE). S2 mica A57 + A56: el guardia de modelo NO adopta (correcto).
- S9 iPhone con funda en bolsa: quita funda → mica, adaptador, batería. S10 laptop con mouse: quita mouse → mochila, SSD, «Adaptador USB-C a Pencil Apple» (tipo hub débil).
- S11 adaptador + bolsa vieja: con ventana 90 min se ignora; sin ventana adopta la bocina JBL (mal). S12 funda + bolsa vieja: igual.
- De paso: «Filtro purificador de agua» → clase purificador (+Care); «Cargador para laptop» entra como cargador de celular.

## Punto 4
- Muestra: ±2 pp: 457 (5 %), 865 (10 %), 1,537 (20 %). A/B +3 pp: 1,059/brazo (5→8 %), 1,774 (10→13 %). DEFF por asesor 2-3.
- 11 asesores; con 8×30 tarjetas/día: ±2 pp en 4 días; A/B 10→13 % en 15 días. Un solo Chrome a 30/día: ±3 pp (p=10 %) ≈ 13 días.

## Punto 5
- 12 clases, 69 complementos (a ciegas). Clasificación 24/24 fichas reales. Colisiones: 81 corpus → 3 cambios (todos de sin clase a su clase); barrido 102 → 4 cambios (todos de sin clase).
- Plantillas: IA 38/50 pasan (76 %); control v3.1 27/30 (90 %). Fallas IA: 4 por nombre distinto (accesorios muñeca, contacto smart, bocinas, soporte celular), 1 base LEGO, 1 asador (2/10), 6 que Liverpool no vende (cargador scooter ×2, funda Stanley, cepillo termos, batería y hélices DJI).
- «Complementa con» reconocido: IA 55/525 (10.5 %, 35 rompecabezas); v3.1 596/1,663 (35.8 %). En las categorías de la IA el carrusel trae casi puro relleno.
- v2 (una ronda con errores reales y «Complementa con»): 18 cambios; 68 complementos. Clasificación 24/24; colisiones iguales (3, de sin clase). **Plantillas 47/50 (94 %)**; control 27/30. Fallan 3 tipos de LEGO activados por el `si` nuevo: «minifiguras LEGO» 0/10 («Bloques Minifigures», «Lego Minifigures 66815»), «base para construcción» 1/10, «llavero LEGO» 0/10. El agente había dicho que pasaban todas. «Complementa con» reconocido: 63/525 (12 %).
- Muestra humana: 50 fichas (window.__muestraHumana) en el doc 18 §9.
- Errores de la v3.1 de paso: mochila escolar → maleta (miga «Mochilas y maletas deportivas»); filtro de agua → purificador (+Care); cargador para laptop como cargador de celular; «Adaptador de USB-C a Pencil Apple» como hub de laptop.
