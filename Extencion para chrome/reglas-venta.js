/**
 * =============================================================================
 * Ventel · Vende más — la base de reglas (reglas-venta.js)
 * =============================================================================
 * Qué complementos tiene sentido ofrecer con cada tipo de artículo.
 *
 * De dónde sale (v3, 04/10/2026):
 *   · el CORPUS de Liverpool: 81 fichas reales de 60 categorías, con lo que el
 *     propio sitio pone en «Complementa con» y «Otros clientes compraron»
 *     (sus ventas). De ahí los tipos que de verdad se llevan juntos y cómo los
 *     nombra Liverpool (el sustantivo con que abre el nombre);
 *   · la investigación de venta cruzada por categoría (attach rate y canasta),
 *     tomada como lista de lo que hay que buscar, no como verdad: todo tipo
 *     nuevo se comprobó contra el corpus o contra una búsqueda en Liverpool;
 *   · la v2 (03/10/2026), medida contra fichas reales de 15 categorías.
 *
 * Lo que enseñó el corpus y explica varias reglas:
 *   · «Otros clientes compraron» es casi siempre OTRO de lo mismo (otras
 *     cafeteras, otras carriolas): sustitutos, que van a la venta incremental.
 *   · «Complementa con» trae complementos de verdad (molino para el espresso,
 *     funda y utensilios para el asador, escritorio para la silla) MEZCLADOS con
 *     lo que el sitio empuja ese día (17 lavavajillas junto a una aspiradora).
 *     Por eso los tipos van cerrados: lo que la regla no conoce no entra.
 *   · Lo que más vende como complemento casi nunca está en los carruseles: las
 *     cápsulas de la cafetera, la tinta, el casco de la bicicleta, el candado de
 *     la maleta. Eso lo trae la búsqueda.
 *
 * Para qué sirve:
 *   · reconocer de qué TIPO es el artículo de la ficha (celular, cafetera…);
 *   · dar a cada candidato su TIPO, para no enseñar tres fundas (una por tipo,
 *     como en P-Companion de Amazon: tipo → artículo → variedad);
 *   · armar la BÚSQUEDA en liverpool.com.mx del tipo que los carruseles no
 *     trajeron bien. Esa búsqueda la hace la extensión desde la propia ficha.
 *
 * Las expresiones se aplican sobre texto en minúsculas y sin acentos (la ñ queda n).
 *   migas     → la miga más específica que NO es campaña («Buen Fin Cocina»,
 *               «Outlet Muebles» y «Lo más vendido en tienda» no cuentan).
 *   producto  → la característica «Producto» / «Tipo de producto».
 *   titulo    → el principio del nombre (anclado: «Funda para iPhone» no es un iPhone).
 *               También dice si un CANDIDATO es de esta clase (un sustituto).
 *   noEs      → (opcional) lo que se le parece y no es («Traje de baño», «Reloj de
 *               pared»): si el nombre o el «Producto» lo dicen, la clase no puntúa.
 *               VA ANCLADO AL SUSTANTIVO que modifica: suelto, «de acero» sacaba de
 *               Planchas a una plancha «con suela de acero», y «computadora» a un
 *               «Escritorio para computadora». Suelto, solo lo que no admite duda.
 *   palabras  → de qué tipo es un candidato. VA ANCLADO AL PRINCIPIO DEL NOMBRE:
 *               en Liverpool el nombre empieza por el sustantivo.
 *   requiere  → (opcional) además tiene que decir esto en algún lado.
 *   excluye   → (opcional) y no puede decir esto.
 *   peso      → qué tan natural es ofrecerlo (0 a 1). Ordena los tipos y decide qué se busca.
 *   buscar    → plantilla de la búsqueda. {modelo}, {marca}, {pulgadas}, {plataforma},
 *               {tamano}, {linea}, {genero} y las `variables` de la clase salen de la
 *               ficha; si falta alguno, esa búsqueda no se hace.
 *   si        → (opcional) el tipo solo aplica si el nombre de la ficha casa con esto.
 *   exacto    → (opcional) sin el MISMO modelo no sirve (fundas, micas).
 *   requiereVar → (opcional) el candidato tiene que nombrar esa variable de la ficha
 *               (las cápsulas, el sistema de la cafetera: «Dolce Gusto»).
 *   soloSugerir → (opcional) no se busca solo: queda como botón de búsqueda. Para lo
 *               que no se puede comprobar que le quede (la tinta de UNA impresora).
 *   topePrecio → (opcional) cuánto puede costar respecto al artículo (0.5 = la mitad).
 *   mismaMarca, mismaLinea, mismoTamano, mismoGenero, par → candados de compatibilidad.
 * Y por clase:
 *   sustitutoPorTipo   → los complementos son de la misma familia (sábanas y
 *                        edredón; base y polvo): el sustituto es el del MISMO tipo.
 *   sinSubidaDeModelo  → otro artículo no es «subir la versión» (otro perfume,
 *                        otro vestido): solo cuenta la capacidad de la misma ficha.
 *   variables          → datos propios de la clase que se leen del nombre: [[regex, 'Texto']].
 *   topePrecio         → el tope de precio de sus complementos, si el tipo no dice otro.
 *
 * El ORDEN de las clases importa: ante un empate gana la primera, y las más
 * específicas van antes (el smartwatch antes que el reloj, la secadora de
 * cabello antes que la de ropa).
 *
 * Es un content script más: define un global en el mundo aislado y nada más.
 * Además (v3.1, el mismo día): un barrido de 102 nombres típicos que NO estaban en
 * el corpus encontró 23 que caían en la clase equivocada («Traje de baño» como
 * traje de vestir, «Batería portátil» como laptop, «Reloj de pared» como reloj de
 * pulsera). De ahí `noEs`. Los 4 que quedan son discutibles, no errores.
 *
 * Hecho para Ventel · v3.1 · 04/10/2026
 */

var VENTEL_REGLAS = {
  version: 3,

  // Subida a OTRO modelo (de «Artículos relacionados»): hasta un 25 % más caro,
  // un 35 % en ticket alto, donde los meses sin intereses lo suavizan. La subida
  // dentro de la MISMA ficha (128 → 512 GB) no tiene tope.
  subida: { tope: 0.25, topeAlto: 0.35, ticketAlto: 10000 },

  // Un complemento no debería costar más del doble del artículo (un tratamiento
  // de $7,050 junto a un protector solar de $650). Un tipo o una clase pueden bajarlo.
  topePrecio: 2,
  // Debajo de este precio la proporción no dice nada: el tope es al menos 1.5.
  pisoProporcion: 1500,

  // Cuál de los parecidos se ofrece (núcleo 2.0, elegirPorCalidad). El primero de Liverpool
  // se queda, salvo que otro de su mismo tipo y su mismo nivel de compatibilidad lo supere con
  // evidencia. Medido el 04/10/2026 sobre 110 fichas reales y 213 recomendaciones (documento 18):
  //   media, peso   → promedio bayesiano de la calificación: cada artículo arranca con `peso`
  //                   opiniones de `media` estrellas (un 5.0 con una opinión no le gana a un
  //                   4.8 con 300);
  //   bonoLiverpool → lo que suma que lo venda Liverpool y no un vendedor de marketplace (es
  //                   una decisión de negocio: el descuento de marketplace se maneja distinto);
  //   castigoPatrocinado → lo que resta un resultado patrocinado (hoy no hay ni uno en lo que
  //                   lee la tarjeta: 0 en 12,297; queda el candado por si cambia);
  //   top           → solo entre los 5 primeros de su nivel, en el orden de Liverpool;
  //   topePrecio    → nunca uno que cueste más de un 25 % sobre el primero;
  //   margen        → y le tiene que ganar por un cuarto de estrella. Con menos, casi todos los
  //                   cambios eran ruido (una opinión de 5 contra ninguna) o subían el precio.
  // Con esto cambian 24 de 213: las que pasan a ofrecerse tienen en promedio 136 opiniones
  // (las que dejan, 12) y cuestan un tercio menos. Sin `calidad`, gana siempre el primero.
  calidad: { media: 4.2, peso: 5, bonoLiverpool: 0.15, castigoPatrocinado: 0.5, top: 5, topePrecio: 1.25, margen: 0.25 },

  clases: [
    // =========================================================================
    // Tecnología
    // =========================================================================
    {
      id: 'smartphone', nombre: 'Celulares', servicio: true, dispositivo: true,
      migas: /celular|smartphone|telefonia/,
      producto: /smartphone|celular|telefono/,
      titulo: /^(iphone|galaxy [asz]?\d|smartphone|celular|moto [eg]\d|motorola|redmi|xiaomi|pixel|honor|oppo|realme|zte|huawei)\b/,
      complementos: [
        { tipo: 'funda', etiqueta: 'Funda', peso: 0.85, palabras: /^(funda|case|carcasa|estuche)\b/, exacto: true, buscar: 'funda {modelo}' },
        { tipo: 'mica', etiqueta: 'Mica', peso: 0.80, palabras: /^(mica|protector|cristal templado|vidrio templado)\b/, exacto: true, buscar: 'mica {modelo}' },
        // Lo que abre igual y no carga un teléfono: en la funda del iPhone 16 el «cargador» era un
        // «Cargador para laptop 1/4 pulgadas», y detrás venían un cable de audio y un Thunderbolt
        // (su «Complementa con» del 04/10/2026). «…para celular y laptop» sí pasa.
        { tipo: 'cargador', etiqueta: 'Cargador', peso: 0.65, palabras: /^(cargador|adaptador|cubo|cable)\b/,
          excluye: /\bpara (laptop|notebook|macbook|computadora)\b|thunderbolt|hdmi|vga|displayport|ethernet|rj45|auxiliar|3\.5 ?mm|\baudio\b|pencil|lapiz|rubik|\bpilas?\b|impresora/,
          topePrecio: 0.4, buscar: 'cargador usb c {marca}' },
        { tipo: 'audifonos', etiqueta: 'Audífonos', peso: 0.55, palabras: /^(audifonos|airpods|buds|earbuds)\b/, topePrecio: 0.6, buscar: 'audífonos inalámbricos {marca}' },
        { tipo: 'bateria', etiqueta: 'Batería portátil', peso: 0.45, palabras: /^(bateria|power ?bank)\b/, topePrecio: 0.4, buscar: 'batería portátil' },
        // Un reloj de casi el precio del teléfono no es «sumar el complemento» (el
        // Garmin de $6,649 junto al Galaxy A56 de $7,199, 03/10/2026).
        { tipo: 'reloj', etiqueta: 'Smartwatch', peso: 0.40, palabras: /^(smartwatch|reloj inteligente|apple watch|galaxy watch)\b/, topePrecio: 0.6, buscar: 'smartwatch {marca}' }
      ]
    },
    {
      id: 'tablet', nombre: 'Tablets', servicio: true, dispositivo: true,
      migas: /tablet|ipad/,
      producto: /tablet|ipad/,
      titulo: /^(ipad|tablet|galaxy tab|matepad|redmi pad|xiaomi pad)\b/,
      complementos: [
        { tipo: 'funda', etiqueta: 'Funda', peso: 0.80, palabras: /^(funda|case|carcasa|folio|estuche)\b/, exacto: true, buscar: 'funda {modelo}' },
        { tipo: 'mica', etiqueta: 'Mica', peso: 0.70, palabras: /^(mica|protector|cristal templado)\b/, exacto: true, buscar: 'mica {modelo}' },
        { tipo: 'lapiz', etiqueta: 'Lápiz', peso: 0.55, palabras: /^(lapiz|pencil|apple pencil|stylus|pluma)\b/, buscar: 'lápiz {marca}' },
        // Del mismo modelo: el Magic Keyboard del iPad Air no es el del iPad A16 (corpus 04/10/2026).
        { tipo: 'teclado', etiqueta: 'Teclado', peso: 0.50, palabras: /^(teclado|magic keyboard|funda de teclado)\b/, exacto: true, buscar: 'teclado {modelo}' },
        { tipo: 'cargador', etiqueta: 'Cargador', peso: 0.45, palabras: /^(cargador|adaptador)\b/,
          excluye: /\bpara (laptop|notebook|macbook|computadora)\b|thunderbolt|hdmi|vga|displayport|ethernet|rj45|auxiliar|3\.5 ?mm|\baudio\b|pencil|lapiz|\bpilas?\b|impresora/,
          topePrecio: 0.4, buscar: 'cargador usb c {marca}' },
        { tipo: 'mouse', etiqueta: 'Mouse', peso: 0.30, palabras: /^(mouse|magic mouse)\b/, topePrecio: 0.3, buscar: 'mouse inalámbrico {marca}' },
        // Solo las Android con ranura (investigación): el iPad no la lleva.
        { tipo: 'memoria', etiqueta: 'Memoria micro SD', peso: 0.30, palabras: /^(memoria|tarjeta de memoria|micro ?sd)\b/, si: /^(?!ipad)/, topePrecio: 0.25, buscar: 'memoria micro sd 128 gb' }
      ]
    },
    {
      id: 'smartwatch', nombre: 'Smartwatches', servicio: true,
      migas: /smartwatch|relojes inteligentes|wearables?|pulseras? de actividad/,
      producto: /smartwatch|reloj inteligente|pulsera (de actividad|inteligente)|smart ?band/,
      titulo: /^(smartwatch|reloj inteligente|apple watch|galaxy watch|pulsera (de actividad|inteligente)|smart ?band|amazfit|garmin)\b/,
      complementos: [
        { tipo: 'correa', etiqueta: 'Correa', peso: 0.65, palabras: /^(correa|extensible|pulso|malla)\b/, mismaMarca: true, topePrecio: 0.5, buscar: 'correa para smartwatch {marca}' },
        { tipo: 'mica', etiqueta: 'Mica', peso: 0.50, palabras: /^(mica|protector|cristal templado)\b/, requiere: /smartwatch|reloj|watch/, excluye: /tablet|smartphone|celular|laptop|ipad/, topePrecio: 0.3, buscar: 'mica para smartwatch {marca}' },
        { tipo: 'cargador', etiqueta: 'Cargador', peso: 0.40, palabras: /^(cargador|base de carga|cable)\b/,
          excluye: /\bpara (laptop|notebook|macbook|computadora)\b|thunderbolt|hdmi|vga|displayport|ethernet|rj45|auxiliar|3\.5 ?mm|\baudio\b|\bpilas?\b|impresora/,
          topePrecio: 0.4, buscar: 'cargador smartwatch {marca}' },
        { tipo: 'audifonos', etiqueta: 'Audífonos', peso: 0.40, palabras: /^(audifonos|airpods|buds|earbuds)\b/, mismaMarca: true, topePrecio: 1, buscar: 'audífonos inalámbricos {marca}' }
      ]
    },
    {
      id: 'laptop', nombre: 'Laptops', servicio: true,
      migas: /laptops?|computadoras? portatil|notebook|macbook/,
      // «Portátil» a secas sí (así viene la MacBook); «Batería portátil», «Ventilador portátil» no.
      producto: /laptop|notebook|chromebook|macbook|^(computadora )?portatil$/,
      titulo: /^(laptop|macbook|notebook|chromebook|computadora portatil)\b/,
      complementos: [
        { tipo: 'mouse', etiqueta: 'Mouse', peso: 0.70, palabras: /^(mouse|raton)\b/, buscar: 'mouse inalámbrico' },
        { tipo: 'mochila', etiqueta: 'Mochila', peso: 0.70, palabras: /^(mochila|maletin|portafolio|funda)\b/,
          requiere: /laptop|portatil|computadora|notebook|macbook/, buscar: 'mochila para laptop {pulgadas} pulgadas' },
        { tipo: 'almacenamiento', etiqueta: 'Disco externo', peso: 0.45, palabras: /^(disco|ssd|memoria usb|unidad)\b/, excluye: /micro ?sd/, buscar: 'disco duro externo' },
        // Office y antivirus: 14-17 % y 2-6 % del precio de la laptop en Liverpool (investigación).
        { tipo: 'software', etiqueta: 'Microsoft 365 o antivirus', peso: 0.45, palabras: /^(microsoft 365|office|antivirus|norton|mcafee|kaspersky|eset)\b/, topePrecio: 0.3, buscar: 'microsoft 365' },
        { tipo: 'audifonos', etiqueta: 'Audífonos', peso: 0.40, palabras: /^(audifonos|diadema)\b/, buscar: 'audífonos inalámbricos' },
        // «Adaptador» a secas no basta: pasaba por hub el «Adaptador de USB-C a Pencil Apple»
        // (04/10/2026). Tiene que decir que da puertos o salida de video o de red.
        { tipo: 'hub', etiqueta: 'Hub USB-C', peso: 0.35, palabras: /^(hub|adaptador|docking)\b/,
          requiere: /\bhub\b|docking|multipuerto|puertos|\d ?en ?1\b|hdmi|ethernet|rj45|vga|displayport|lector/,
          excluye: /pencil|lapiz|\bcorriente\b|\bviaje\b|celular|iphone/, buscar: 'hub usb c' },
        { tipo: 'teclado', etiqueta: 'Teclado gamer', peso: 0.35, palabras: /^teclado\b/, si: /gamer/, buscar: 'teclado gamer' },
        { tipo: 'silla', etiqueta: 'Silla gamer', peso: 0.30, palabras: /^silla gamer\b/, si: /gamer/, topePrecio: 0.4, buscar: 'silla gamer' },
        // Liverpool vende la multifuncional junto a la laptop (corpus: 2 de 7 en «Otros clientes compraron»).
        { tipo: 'impresora', etiqueta: 'Impresora', peso: 0.25, palabras: /^(multifuncional|impresora)\b/, topePrecio: 0.35, buscar: 'multifuncional de tinta' }
      ]
    },
    {
      id: 'monitor', nombre: 'Monitores', servicio: true,
      migas: /monitores?$/,
      producto: /^monitor/,
      titulo: /^monitor\b/,
      complementos: [
        { tipo: 'teclado', etiqueta: 'Teclado', peso: 0.55, palabras: /^teclado\b/, buscar: 'teclado inalámbrico' },
        { tipo: 'mouse', etiqueta: 'Mouse', peso: 0.55, palabras: /^(mouse|raton)\b/, buscar: 'mouse inalámbrico' },
        { tipo: 'soporte', etiqueta: 'Soporte', peso: 0.45, palabras: /^(soporte|brazo)\b/, requiere: /monitor/, buscar: 'soporte para monitor' },
        { tipo: 'audifonos', etiqueta: 'Audífonos gamer', peso: 0.40, palabras: /^(audifonos|diadema|headset)\b/, si: /gamer/, buscar: 'audífonos gamer' },
        { tipo: 'cable', etiqueta: 'Cable', peso: 0.30, palabras: /^cable\b/, requiere: /hdmi|displayport|usb c/, buscar: 'cable hdmi' },
        { tipo: 'webcam', etiqueta: 'Cámara web', peso: 0.30, palabras: /^(camara web|webcam)\b/, buscar: 'cámara web 1080p' }
      ]
    },
    {
      id: 'tv', nombre: 'Pantallas', servicio: true,
      migas: /televisiones|pantallas?$|smart tv/,
      producto: /pantalla|television|smart tv/,
      titulo: /^(pantalla|smart tv|television|tv\b)/,
      noEs: /^pantalla( [a-z]+)? (de |para )?(proyeccion|proyector)/,
      complementos: [
        { tipo: 'soporte', etiqueta: 'Soporte', peso: 0.80, palabras: /^soporte\b/, requiere: /pantalla|tv|television|pulgadas/, buscar: 'soporte para pantalla {pulgadas} pulgadas' },
        { tipo: 'barra', etiqueta: 'Barra de sonido', peso: 0.75, palabras: /^(barra|soundbar|teatro)\b/, buscar: 'barra de sonido {marca}' },
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.60, palabras: /^(regulador|no ?break|supresor)\b/, buscar: 'regulador de voltaje' },
        // Casi todas ya son smart (investigación): el streaming va al final.
        { tipo: 'streaming', etiqueta: 'Streaming', peso: 0.25, palabras: /^(roku|fire tv|chromecast|apple tv|reproductor)\b/, buscar: 'reproductor streaming' },
        { tipo: 'cable', etiqueta: 'Cable HDMI', peso: 0.35, palabras: /^cable\b/, requiere: /hdmi/, buscar: 'cable hdmi' }
      ]
    },
    {
      id: 'proyector', nombre: 'Proyectores', servicio: true,
      migas: /proyectores?/,   // la miga es «Proyectores y monitores»
      producto: /proyector/,
      titulo: /^proyector\b/,
      complementos: [
        // «Pantalla Proyector Manual», «Pantalla Manual para Proyector» (búsqueda, 04/10/2026).
        { tipo: 'pantalla', etiqueta: 'Pantalla para proyector', peso: 0.65, palabras: /^pantalla\b/, requiere: /proyector|proyeccion/, buscar: 'pantalla para proyector' },
        { tipo: 'bocina', etiqueta: 'Bocina o barra', peso: 0.50, palabras: /^(barra de sonido|bocina)\b/, topePrecio: 0.5, buscar: 'bocina bluetooth' },
        // Sin soporte: Liverpool no tiene de techo para proyector, la búsqueda trae los de TV (investigación).
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.25, palabras: /^(regulador|no ?break|supresor)\b/, buscar: 'regulador de voltaje' },
        { tipo: 'streaming', etiqueta: 'Streaming', peso: 0.40, palabras: /^(roku|fire tv|chromecast|apple tv|reproductor)\b/, buscar: 'reproductor streaming' },
        { tipo: 'cable', etiqueta: 'Cable HDMI', peso: 0.30, palabras: /^cable\b/, requiere: /hdmi/, buscar: 'cable hdmi' }
      ]
    },
    {
      id: 'consola', nombre: 'Consolas', servicio: true,
      migas: /consolas?/,
      producto: /consola/,
      titulo: /^(consola|playstation|xbox|nintendo switch)\b/,
      // El orden importa: un juego se reconoce también por «para PS5» al final,
      // así que antes van los que también lo dicen (control, audífonos, base).
      complementos: [
        { tipo: 'control', etiqueta: 'Control', peso: 0.85, palabras: /^(control|joy-?con|dualsense|gamepad)\b/, buscar: 'control {plataforma}' },
        { tipo: 'audifonos', etiqueta: 'Audífonos gamer', peso: 0.45, palabras: /^(audifonos|diadema|headset)\b/, buscar: 'audífonos gamer {plataforma}' },
        { tipo: 'base', etiqueta: 'Base de carga', peso: 0.35, palabras: /^(base|estacion|cargador)\b/, buscar: 'base de carga {plataforma}' },
        // La portátil se lleva su estuche y su mica (Switch: corpus, 2 de 4 en «Otros clientes compraron»).
        { tipo: 'estuche', etiqueta: 'Estuche', peso: 0.55, palabras: /^(estuche|funda|case)\b/, si: /switch|portatil/, buscar: 'estuche {plataforma}' },
        { tipo: 'mica', etiqueta: 'Mica', peso: 0.40, palabras: /^(mica|protector de pantalla)\b/, si: /switch|portatil/, buscar: 'mica {plataforma}' },
        { tipo: 'juego', etiqueta: 'Videojuego', peso: 0.75, palabras: /^(juego|videojuego)\b|\bpara (ps5|ps4|playstation \d|xbox series [xs]|xbox one|nintendo switch 2?|switch 2?)$/, buscar: 'juego {plataforma}' }
      ]
    },
    {
      id: 'camara', nombre: 'Cámaras', servicio: true,
      migas: /camaras? (fotograficas?|instantaneas?|digitales?|de accion|deportivas?)|fotografia/,
      producto: /camara|gopro/,
      titulo: /^(camara (instantanea|digital|fotografica|reflex|mirrorless|sin espejo|de accion|deportiva|compacta)|gopro|instax)\b/,
      // La de seguridad y la web no llevan lente, papel ni mochila de cámara.
      noEs: /^camaras? (de )?(seguridad|vigilancia|videovigilancia|web|ip|espia|reversa|tablero)\b|^camaras? (para|de) (auto|coche)|^(web ?cam|dashcam)/,
      variables: {
        formato: [[/instax mini|\bmini (\d+|evo|link|se)\b/, 'instax mini'], [/instax wide|\bwide \d+/, 'instax wide'],
          [/instax square|\bsquare\b/, 'instax square'], [/polaroid/, 'polaroid']]
      },
      complementos: [
        // La instantánea vive de su película: la del MISMO formato (mini, wide, square).
        // En Liverpool la película se llama «Papel fotográfico Instax mini» (corpus e investigación).
        { tipo: 'pelicula', etiqueta: 'Papel fotográfico', peso: 0.85, palabras: /^(pelicula|papel fotografico|papel instax|film|cartucho)\b/, si: /instantanea|instax|polaroid/,
          requiereVar: 'formato', buscar: 'papel {formato}' },
        // Cada una con lo suyo: al elegir por calificación, a una mirrorless le tocaban el «Estuche
        // para cámara instantánea» y una memoria MICRO SD (04/10/2026). El estuche de la
        // instantánea es otro tipo; la micro SD, de la cámara de acción.
        { tipo: 'estuche', etiqueta: 'Estuche', peso: 0.55, palabras: /^(estuche|funda|bolsa|mochila)\b/, requiere: /camara|fotograf/, excluye: /instantanea|instax|polaroid/,
          si: /^(?!.*(instantanea|instax|polaroid))/, topePrecio: 0.5, buscar: 'estuche para cámara' },
        { tipo: 'estucheInstantanea', etiqueta: 'Estuche', peso: 0.55, palabras: /^(estuche|funda|bolsa)\b/, requiere: /instantanea|instax|polaroid/,
          si: /instantanea|instax|polaroid/, topePrecio: 0.5, buscar: 'estuche para cámara' },
        { tipo: 'memoria', etiqueta: 'Memoria SD', peso: 0.60, palabras: /^(memoria|tarjeta de memoria|sd)\b/, excluye: /micro ?sd|\busb\b|\bram\b|ddr/, si: /digital|reflex|mirrorless|sin espejo|compacta/, buscar: 'memoria sd 128 gb' },
        { tipo: 'microsd', etiqueta: 'Memoria micro SD', peso: 0.60, palabras: /^(memoria|tarjeta de memoria|micro ?sd)\b/, requiere: /micro ?sd/, si: /accion|deportiva|gopro/, buscar: 'memoria micro sd 128 gb' },
        { tipo: 'lente', etiqueta: 'Lente', peso: 0.45, palabras: /^(lente|objetivo)\b/, si: /reflex|mirrorless|sin espejo/, mismaMarca: true, buscar: 'lente {marca}' },
        { tipo: 'bateria', etiqueta: 'Batería extra', peso: 0.40, palabras: /^(bateria|pila recargable)\b/, si: /digital|reflex|mirrorless|sin espejo|accion|deportiva|gopro/, mismaMarca: true, topePrecio: 0.3, buscar: 'batería para cámara {marca}' },
        { tipo: 'tripie', etiqueta: 'Tripié', peso: 0.40, palabras: /^(tripie|tripode|estabilizador|monopie|gimbal)\b/, si: /digital|reflex|mirrorless|sin espejo|accion|deportiva|gopro/, buscar: 'tripié para cámara' },
        { tipo: 'microfono', etiqueta: 'Micrófono', peso: 0.30, palabras: /^microfono\b/, si: /mirrorless|sin espejo|reflex|accion/, buscar: 'micrófono para cámara' },
        { tipo: 'album', etiqueta: 'Álbum', peso: 0.30, palabras: /^(album|portarretrato|marco)\b/, si: /instantanea|instax|polaroid/, buscar: 'álbum instax' }
      ]
    },
    {
      id: 'impresora', nombre: 'Impresoras', servicio: true,
      migas: /impresoras?|multifuncionales?/,
      producto: /impresora|multifuncional/,
      titulo: /^(impresora|multifuncional)\b/,
      complementos: [
        // La tinta de UNA impresora no se puede adivinar: botón de búsqueda, no artículo.
        { tipo: 'tinta', etiqueta: 'Tinta', peso: 0.85, palabras: /^(tinta|cartucho|botella de tinta|toner|kit de tinta)\b/, mismaMarca: true, soloSugerir: true, buscar: 'tinta {marca}' },
        { tipo: 'papel', etiqueta: 'Papel', peso: 0.50, palabras: /^(papel|hojas)\b/, buscar: 'papel bond carta' },
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.30, palabras: /^(regulador|no ?break|supresor)\b/, buscar: 'regulador de voltaje' }
      ]
    },
    {
      id: 'audifonos', nombre: 'Audífonos', servicio: true,
      migas: /audifonos/,
      producto: /audifonos/,
      titulo: /^(audifonos|airpods|diadema)\b/,
      complementos: [
        // La funda para AirPods solo con unos AirPods (en unos Sony salía una, corpus 04/10/2026).
        { tipo: 'estuche', etiqueta: 'Estuche', peso: 0.50, palabras: /^(estuche|funda|porta ?audifonos|soporte para audifonos)\b/, excluye: /airpod/, si: /^(?!.*airpods)/, buscar: 'estuche para audífonos' },
        { tipo: 'fundaAirpods', etiqueta: 'Funda', peso: 0.55, palabras: /^(estuche|funda)\b/, requiere: /airpod/, si: /airpods/, buscar: 'funda para {modelo}' },
        { tipo: 'cargador', etiqueta: 'Cargador', peso: 0.40, palabras: /^(cargador|adaptador|cable)\b/,
          excluye: /\bpara (laptop|notebook|macbook|computadora)\b|thunderbolt|hdmi|vga|displayport|ethernet|rj45|pencil|lapiz|\bpilas?\b|impresora/,
          topePrecio: 0.5, buscar: 'cargador usb c' },
        // Liverpool los vende juntos (corpus: 15 bocinas en «Complementa con» de unos Sony).
        { tipo: 'bocina', etiqueta: 'Bocina', peso: 0.35, palabras: /^bocina\b/, topePrecio: 1, buscar: 'bocina bluetooth {marca}' }
      ]
    },
    {
      id: 'bocina', nombre: 'Bocinas', servicio: true,
      migas: /bocinas?|barras? de sonido|audio/,
      producto: /bocina|barra de sonido/,
      titulo: /^(bocina|barra de sonido|soundbar)\b/,
      complementos: [
        { tipo: 'pantalla', etiqueta: 'Pantalla', peso: 0.35, palabras: /^pantalla\b/, si: /^(barra|soundbar)/, buscar: 'pantalla smart tv {marca}' },
        { tipo: 'soporte', etiqueta: 'Soporte', peso: 0.40, palabras: /^soporte\b/, si: /^(barra|soundbar)/, buscar: 'soporte para barra de sonido' },
        { tipo: 'cable', etiqueta: 'Cable óptico o HDMI', peso: 0.35, palabras: /^cable\b/, requiere: /optico|hdmi/, si: /^(barra|soundbar)/, buscar: 'cable hdmi' },
        { tipo: 'microfono', etiqueta: 'Micrófono', peso: 0.40, palabras: /^microfono\b/, si: /^bocina/, buscar: 'micrófono inalámbrico' },
        { tipo: 'cargador', etiqueta: 'Cargador', peso: 0.30, palabras: /^(cargador|adaptador|cable)\b/,
          excluye: /\bpara (laptop|notebook|macbook|computadora)\b|thunderbolt|hdmi|vga|displayport|ethernet|rj45|pencil|lapiz|\bpilas?\b|impresora/,
          topePrecio: 0.5, buscar: 'cargador usb c' }
      ]
    },

    // =========================================================================
    // Línea blanca
    // =========================================================================
    {
      id: 'refrigerador', nombre: 'Refrigeradores', servicio: true,
      migas: /refrigeradores?|congeladores?|frigobar/,
      producto: /refrigerador|congelador|duplex|french door|frigobar/,
      titulo: /^(refrigerador|congelador|frigobar)\b/,
      complementos: [
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.60, palabras: /^(regulador|protector de voltaje|supresor)\b/, buscar: 'regulador para refrigerador' },
        { tipo: 'filtro', etiqueta: 'Filtro de agua', peso: 0.35, palabras: /^filtro\b/, requiere: /agua|refrigerador/, mismaMarca: true, soloSugerir: true, buscar: 'filtro de agua para refrigerador {marca}' }
      ]
    },
    {
      id: 'lavavajillas', nombre: 'Lavavajillas', servicio: true,
      migas: /lavavajillas/,
      producto: /lavavajillas/,
      titulo: /^lavavajillas\b/,
      complementos: [
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.55, palabras: /^(regulador|protector de voltaje|supresor)\b/, buscar: 'regulador de voltaje' },
        // Detergente no hay en Liverpool; sal sí (Teka, búsqueda 04/10/2026).
        { tipo: 'consumibles', etiqueta: 'Sal o detergente', peso: 0.50, palabras: /^(sal|detergente|pastillas|capsulas|abrillantador)\b/, requiere: /lavavajillas|lavaloza/, buscar: 'sal para lavavajillas' }
      ]
    },
    {
      id: 'lavadora', nombre: 'Lavadoras', servicio: true,
      migas: /lavadoras?$|lavado y secado/,
      producto: /^lavadora/,
      titulo: /^lavadora\b/,
      complementos: [
        { tipo: 'secadora', etiqueta: 'Secadora', peso: 0.60, palabras: /^secadora\b/, excluye: /cabello|pelo/, par: true, buscar: 'secadora {marca}' },
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.50, palabras: /^(regulador|protector de voltaje|supresor)\b/, buscar: 'regulador para lavadora' },
        { tipo: 'base', etiqueta: 'Pedestal', peso: 0.40, palabras: /^(pedestal|base|kit)\b/, mismaMarca: true, soloSugerir: true, buscar: 'pedestal para lavadora {marca}' },
        // Liverpool la vende junto a la lavadora (corpus: «Complementa con», 2 de 7).
        { tipo: 'funda', etiqueta: 'Funda', peso: 0.30, palabras: /^funda\b/, requiere: /lavadora/, buscar: 'funda para lavadora' }
      ]
    },
    {
      id: 'secadoraCabello', nombre: 'Aparatos para el cabello', sustitutoPorTipo: true, sinSubidaDeModelo: true,
      migas: /secadoras? de cabello|alaciadoras?|rizadoras?|aparatos (para el|de) cabello|cuidado del cabello electrico|planchas? para cabello/,
      producto: /secadora de (cabello|pelo)|alaciadora|rizadora|tenaza|cepillo (de aire|alaciador|secador)|multiestilizador|plancha para (cabello|pelo)/,
      titulo: /^(secadora (de|para) (cabello|pelo)|alaciadora|rizadora|tenaza|cepillo (de aire|alaciador|secador)|multiestilizador|plancha (de|para) (cabello|pelo)|ondulador)\b/,
      complementos: [
        // Liverpool lo llama «Protector de calor para cabello» (Moroccanoil, Olaplex; búsqueda 04/10/2026).
        { tipo: 'protector', etiqueta: 'Protector de calor', peso: 0.70, palabras: /^(protector (termico|de calor)|spray (protector|termico)|termoprotector|serum de proteccion termica)\b/, buscar: 'protector de calor para cabello' },
        { tipo: 'cepillo', etiqueta: 'Cepillo', peso: 0.50, palabras: /^(cepillo|peine)\b/, excluye: /aire|alaciador|secador|electrico|dental|dientes/, topePrecio: 0.6, buscar: 'cepillo para cabello' },
        { tipo: 'secadora', etiqueta: 'Secadora', peso: 0.45, palabras: /^secadora (de|para) (cabello|pelo)\b/, buscar: 'secadora de cabello {marca}' },
        { tipo: 'alaciadora', etiqueta: 'Alaciadora', peso: 0.40, palabras: /^(alaciadora|plancha (de|para) (cabello|pelo))\b/, buscar: 'alaciadora {marca}' },
        { tipo: 'rizadora', etiqueta: 'Rizadora', peso: 0.30, palabras: /^(rizadora|tenaza|ondulador)\b/, buscar: 'rizadora de cabello' }
      ]
    },
    {
      id: 'secadora', nombre: 'Secadoras', servicio: true,
      migas: /secadoras?$/,
      producto: /^secadora(?! (de|para) (cabello|pelo))/,
      titulo: /^secadora\b(?! (de|para) (cabello|pelo))/,
      complementos: [
        { tipo: 'lavadora', etiqueta: 'Lavadora', peso: 0.60, palabras: /^lavadora\b/, par: true, buscar: 'lavadora {marca}' },
        { tipo: 'base', etiqueta: 'Kit de apilado', peso: 0.45, palabras: /^(pedestal|base|kit)\b/, mismaMarca: true, soloSugerir: true, buscar: 'kit de apilado {marca}' },
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.40, palabras: /^(regulador|protector de voltaje|supresor)\b/, buscar: 'regulador para lavadora' }
      ]
    },
    {
      id: 'estufa', nombre: 'Estufas', servicio: true,
      migas: /estufas?$|parrillas?$|cocinas? integral/,
      producto: /estufa|parrilla|cocina integral/,
      titulo: /^(estufa|parrilla (de|a) (gas|induccion|empotre)|cocina integral)\b/,
      complementos: [
        { tipo: 'campana', etiqueta: 'Campana', peso: 0.60, palabras: /^(campana|extractor|combo campana)\b/, buscar: 'campana {marca}' },
        { tipo: 'bateria', etiqueta: 'Batería de cocina', peso: 0.35, palabras: /^(bateria de cocina|juego de sartenes|set de sartenes|sarten)\b/, topePrecio: 0.6, buscar: 'batería de cocina' }
      ]
    },
    {
      id: 'microondas', nombre: 'Hornos de microondas', servicio: true,
      migas: /hornos? de microondas|microondas/,
      producto: /microondas/,
      titulo: /^(horno de microondas|microondas)\b/,
      complementos: [
        { tipo: 'contenedores', etiqueta: 'Contenedores', peso: 0.45, palabras: /^(set (de )?contenedores|contenedor|refractario|recipiente|tapa para microondas)\b/, topePrecio: 0.6, buscar: 'set de contenedores de vidrio' },
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.30, palabras: /^(regulador|supresor)\b/, buscar: 'regulador de voltaje' },
        { tipo: 'electro', etiqueta: 'Otro electrodoméstico', peso: 0.30, palabras: /^(licuadora|combo licuadora|freidora|cafetera|tostador|sandwichera|hervidor|tetera electrica)\b/, topePrecio: 1.2, buscar: 'freidora de aire' }
      ]
    },
    {
      id: 'aire', nombre: 'Aire acondicionado', servicio: true,
      migas: /aire acondicionado|minisplit|climatizacion/,
      producto: /aire acondicionado|minisplit|mini split/,
      titulo: /^(aire acondicionado|minisplit|mini split|clima)\b/,
      complementos: [
        { tipo: 'regulador', etiqueta: 'Protector de voltaje', peso: 0.70, palabras: /^(regulador|protector de voltaje|supresor)\b/, buscar: 'protector de voltaje para minisplit' },
        // El kit de instalación y la base para condensadora no están en Liverpool (investigación,
        // 04/10/2026); el control sí (corpus: 7 en «Otros clientes compraron»).
        { tipo: 'control', etiqueta: 'Control remoto', peso: 0.40, palabras: /^control remoto\b/, requiere: /aire|minisplit|clima/, topePrecio: 0.2, buscar: 'control remoto para minisplit' }
      ]
    },

    // =========================================================================
    // Pequeños electrodomésticos
    // =========================================================================
    {
      id: 'cafetera', nombre: 'Cafeteras', servicio: true,
      migas: /cafeteras?/,
      producto: /cafetera/,
      titulo: /^(cafetera|maquina de (cafe|espresso))\b/,
      variables: {
        sistema: [[/vertuo/, 'Vertuo'], [/nespresso/, 'Nespresso'], [/dolce gusto/, 'Dolce Gusto'], [/keurig|k-cup/, 'Keurig'], [/tassimo/, 'Tassimo']]
      },
      complementos: [
        // Lo que se lleva quien compra una de cápsulas son las cápsulas de SU sistema.
        // No están nunca en sus carruseles (corpus): las trae la búsqueda.
        // Liverpool las nombra «Set de 16 cápsulas Latte Macchiato» (búsqueda, 04/10/2026).
        { tipo: 'capsulas', etiqueta: 'Cápsulas', peso: 0.85, palabras: /^((set|caja|paquete) (de )?(\d+ )?)?(capsulas?|cafe en capsulas?)\b/, si: /capsula|dolce gusto|nespresso|vertuo|keurig|tassimo/,
          requiereVar: 'sistema', buscar: 'cápsulas {sistema}' },
        { tipo: 'molino', etiqueta: 'Molino para café', peso: 0.60, palabras: /^(molino|molinillo)\b/, requiere: /cafe/, si: /espresso|express|goteo|filtro|prensa|barista|italiana/, buscar: 'molino para café' },
        { tipo: 'espumador', etiqueta: 'Espumador de leche', peso: 0.50, palabras: /^(espumador|jarra espumadora|batidor espumador|aeroccino)\b/, buscar: 'espumador de leche' },
        // Sin las infantiles: la mejor calificada de «set de tazas para café» era un «Set de tazas
        // infantil Bob Esponja» (04/10/2026).
        { tipo: 'tazas', etiqueta: 'Tazas', peso: 0.40, palabras: /^(set de tazas|juego de tazas|taza|tazas|mug)\b/, excluye: /infantil|\bnin[oa]s?\b|\bbebes?\b|entrenador/, topePrecio: 0.5, buscar: 'set de tazas para café' },
        { tipo: 'termo', etiqueta: 'Termo', peso: 0.30, palabras: /^(termo|vaso termico)\b/, topePrecio: 0.5, buscar: 'termo para café' }
      ]
    },
    {
      // Licuadora, batidora, freidora, procesador, horno eléctrico…: Liverpool los
      // vende juntos (corpus: el microondas aparece 7 veces junto a la licuadora y
      // 8 junto a la freidora). Cada aparato es un tipo: otro DISTINTO complementa,
      // el mismo es sustituto.
      id: 'cocinaElectrica', nombre: 'Electrodomésticos de cocina', servicio: true, sustitutoPorTipo: true,
      migas: /licuadoras?|batidoras?|freidoras?|procesadores? de alimentos|extractores? de jugos?|hornos? electricos?|tostadores?|sandwicheras?|ollas? (de coccion|electricas?|de presion electrica)|electrodomesticos de cocina|pequenos electrodomesticos/,
      producto: /licuadora|batidora|freidora|procesador de alimentos|extractor de jugos|horno electrico|tostador|sandwichera|olla (de coccion|electrica)|parrilla electrica|waflera|crepera/,
      titulo: /^((set|combo) )?(licuadora|batidora|freidora|procesador de alimentos|extractor de jugos?|horno electrico|tostador|sandwichera|olla (de coccion|electrica|de presion electrica)|parrilla electrica|waflera|crepera)\b/,
      complementos: [
        { tipo: 'accesorios', etiqueta: 'Accesorios', peso: 0.55, palabras: /^(accesorios|set de accesorios|kit de accesorios|vaso|jarra|moldes?|papel para freidora|canasta|rejilla|atomizador)\b/,
          requiere: /freidora|aceite/, si: /^freidora/, topePrecio: 0.5, buscar: 'molde para freidora de aire' },
        // Con la batidora de pedestal van los moldes y sus aditamentos (investigación).
        { tipo: 'moldes', etiqueta: 'Moldes para hornear', peso: 0.50, palabras: /^((set|juego) (de )?)?moldes?\b/, si: /batidora/, topePrecio: 0.4, buscar: 'moldes para hornear' },
        { tipo: 'aditamentos', etiqueta: 'Aditamentos', peso: 0.40, palabras: /^(aditamentos?|accesorio para batidora|gancho|globo)\b/, si: /batidora/, mismaMarca: true, topePrecio: 0.6, buscar: 'aditamento para batidora {marca}' },
        { tipo: 'licuadora', etiqueta: 'Licuadora', peso: 0.45, palabras: /^((set|combo) )?licuadora\b/, buscar: 'licuadora {marca}' },
        { tipo: 'freidora', etiqueta: 'Freidora de aire', peso: 0.45, palabras: /^freidora\b/, buscar: 'freidora de aire {marca}' },
        { tipo: 'microondas', etiqueta: 'Horno de microondas', peso: 0.40, palabras: /^(horno de microondas|microondas)\b/, topePrecio: 2, buscar: 'horno de microondas' },
        { tipo: 'batidora', etiqueta: 'Batidora', peso: 0.40, palabras: /^batidora\b/, buscar: 'batidora {marca}' },
        { tipo: 'procesador', etiqueta: 'Procesador', peso: 0.35, palabras: /^procesador de alimentos\b/, buscar: 'procesador de alimentos' },
        { tipo: 'horno', etiqueta: 'Horno eléctrico', peso: 0.30, palabras: /^horno electrico\b/, buscar: 'horno eléctrico' },
        { tipo: 'tostador', etiqueta: 'Tostador', peso: 0.25, palabras: /^(tostador|sandwichera|waflera)\b/, buscar: 'tostador' }
      ]
    },
    {
      id: 'aspiradora', nombre: 'Aspiradoras', servicio: true,
      migas: /aspiradoras?/,
      producto: /aspiradora/,
      titulo: /^aspiradora\b/,
      complementos: [
        // Los repuestos son por modelo: los de su carrusel sí (Liverpool los empareja); buscarlos,
        // no (la búsqueda trajo filtros de otra línea de la marca). Queda como botón.
        { tipo: 'repuestos', etiqueta: 'Repuestos', peso: 0.70, palabras: /^(set (de )?repuestos|kit (de )?repuestos|repuesto|filtro|cepillo lateral|bolsas?|mopa)\b/, mismaMarca: true, topePrecio: 0.5, soloSugerir: true, buscar: 'repuestos aspiradora {marca}' }
      ]
    },
    {
      id: 'purificador', nombre: 'Purificadores y humidificadores', servicio: true, sustitutoPorTipo: true,
      migas: /purificadores?|humidificadores?|deshumidificadores?|calidad del aire/,
      producto: /purificador|humidificador|deshumidificador/,
      titulo: /^(purificador|humidificador|deshumidificador)\b/,
      // Los de AGUA no son de esta clase: el «Filtro purificador de agua FPA5L» («Producto:
      // Filtro/purificador agua», miga «Despachadores y Purificadores de Agua») caía aquí y se le
      // ofrecía Liverpool Care (04/10/2026). Anclado: «…con tanque de agua» no lo saca.
      noEs: /^(filtros?[ \/]+)?(purificador(es|a)?|filtros?|despachador(es)?|dispensador(es)?)( [a-z0-9+-]+){0,2}? (de |para )?agua\b/,
      complementos: [
        // Del modelo exacto: botón de búsqueda (la de la marca trajo purificadores, no filtros).
        { tipo: 'filtro', etiqueta: 'Filtro de repuesto', peso: 0.75, palabras: /^(filtro|repuesto)\b/, mismaMarca: true, topePrecio: 0.6, soloSugerir: true, buscar: 'filtro para purificador de aire' },
        { tipo: 'humidificador', etiqueta: 'Humidificador', peso: 0.35, palabras: /^humidificador\b/, topePrecio: 0.8, buscar: 'humidificador' },
        { tipo: 'purificador', etiqueta: 'Purificador', peso: 0.30, palabras: /^purificador\b/, topePrecio: 1, buscar: 'purificador de aire' }
      ]
    },
    {
      id: 'plancha', nombre: 'Planchas', servicio: true, sinSubidaDeModelo: true,
      migas: /planchas?$|vaporizadores?|cuidado de la ropa/,
      producto: /plancha|vaporizador|central de vapor|generador de vapor|cepillo de vapor/,
      titulo: /^(plancha|vaporizador|central de vapor|generador de vapor|cepillo de vapor)\b(?! (de|para) (cabello|pelo|asar|cocinar)| de (acero|hierro))/,
      // «Plancha para EL cabello» (con artículo) se le escapaba al título y ganaba por la miga.
      noEs: /^planchas?( [a-z0-9-]+){0,3} (de |para )(el )?(cabello|pelo)|^planchas? (de |para )(asar|cocinar)|^planchas? (de|en) (acero|hierro)|^plancha (asadora|parrilla)|hot ?cakes|crepas?\b|tortillas|sandwich|panini|hierro fundido/,
      complementos: [
        { tipo: 'burro', etiqueta: 'Burro de planchar', peso: 0.65, palabras: /^(burro|tabla) (de|para) planchar\b/, buscar: 'burro de planchar' },
        { tipo: 'quitapelusas', etiqueta: 'Quitapelusas', peso: 0.45, palabras: /^(quitapelusas|rasuradora de pelusa|removedor de pelusa)\b/, buscar: 'quitapelusas' },
        { tipo: 'vapor', etiqueta: 'Cepillo de vapor', peso: 0.30, palabras: /^(cepillo de vapor|vaporizador)\b/, si: /^plancha/, buscar: 'cepillo de vapor' }
      ]
    },

    // =========================================================================
    // Hogar
    // =========================================================================
    {
      id: 'colchon', nombre: 'Colchones',
      migas: /colchon/,
      producto: /colchon/,
      titulo: /^(colchon|juego de colchon|juego de box)\b/,
      noEs: /^colchon(es)? (inflables?|de aire|para (campismo|acampar|perros?|gatos?|mascotas?|cuna|bebe)|de (yoga|cuna|bebe))|^colchoneta/,
      complementos: [
        { tipo: 'protector', etiqueta: 'Protector', peso: 0.80, palabras: /^protector\b/, mismoTamano: true, buscar: 'protector de colchón {tamano}' },
        { tipo: 'almohada', etiqueta: 'Almohadas', peso: 0.70, palabras: /^(set de )?almohadas?\b/, buscar: 'almohada' },
        { tipo: 'box', etiqueta: 'Base / box', peso: 0.65, palabras: /^(box|base|bambalinero)\b/, mismoTamano: true, si: /^colchon/, buscar: 'box {tamano}' },
        { tipo: 'sabanas', etiqueta: 'Sábanas', peso: 0.55, palabras: /^(sabana|juego de sabanas)/, mismoTamano: true, buscar: 'juego de sábanas {tamano}' },
        // 6 de cada 10 que compran colchón se llevan un topper en el año (BedTimes, 2022).
        { tipo: 'topper', etiqueta: 'Topper', peso: 0.45, palabras: /^(topper|cubrecolchon|pillow top)\b/, mismoTamano: true, buscar: 'topper {tamano}' },
        { tipo: 'pie', etiqueta: 'Pie de cama', peso: 0.25, palabras: /^pie de cama\b/, buscar: 'pie de cama' }
      ]
    },
    {
      // Sábanas, edredón, colcha, almohada…: unas complementan a las otras (corpus:
      // el juego de sábanas trae edredón, colcha y fundas). El sustituto es el del
      // MISMO tipo.
      id: 'blancos', nombre: 'Blancos', sustitutoPorTipo: true, sinSubidaDeModelo: true,
      migas: /almohadas?|edredones?|sabanas|colchas?|duvets?|cobertores?|frazadas?|ropa de cama|blancos/,
      producto: /almohada|edredon|sabana|colcha|duvet|cobertor|frazada|protector de almohada/,
      titulo: /^((set|juego) (de )?)?(almohadas?|edredon|sabanas?|colcha|duvet|funda duvet|cobertor|frazada|cobija)\b/,
      variables: { tamano: [[/\bking\b/, 'king'], [/\bqueen\b/, 'queen'], [/matrimonial/, 'matrimonial'], [/individual/, 'individual']] },
      complementos: [
        { tipo: 'sabanas', etiqueta: 'Sábanas', peso: 0.65, palabras: /^((set|juego) (de )?)?sabanas?\b/, mismoTamano: true, buscar: 'juego de sábanas {tamano}' },
        { tipo: 'edredon', etiqueta: 'Edredón o colcha', peso: 0.55, palabras: /^((set|juego) (de )?)?(edredon|colcha|duvet|funda duvet)\b/, mismoTamano: true, buscar: 'edredón {tamano}' },
        { tipo: 'almohada', etiqueta: 'Almohada', peso: 0.50, palabras: /^((set|juego) (de )?)?almohadas?\b/, buscar: 'almohada' },
        { tipo: 'protector', etiqueta: 'Protector', peso: 0.40, palabras: /^(protector (de|para) (almohada|colchon)|funda para almohada)\b/, buscar: 'protector de almohada' },
        { tipo: 'cojin', etiqueta: 'Cojín decorativo', peso: 0.35, palabras: /^((set|juego) (de )?)?cojin(es)?\b/, buscar: 'cojín decorativo' },
        { tipo: 'frazada', etiqueta: 'Frazada', peso: 0.30, palabras: /^(frazada|cobertor|cobija|manta)\b/, buscar: 'frazada' }
      ]
    },
    {
      id: 'sala', nombre: 'Salas', sinSubidaDeModelo: true,
      migas: /salas?$|sofas?|sillones?|love ?seats?|salas modulares/,
      producto: /sofa|sala|sillon|love ?seat|seccional/,
      titulo: /^(sofa|sala|love ?seat|seccional|sofa cama)\b/,
      complementos: [
        { tipo: 'mesa', etiqueta: 'Mesa de centro o lateral', peso: 0.55, palabras: /^mesa (de centro|lateral|auxiliar|de cafe)\b/, topePrecio: 0.6, buscar: 'mesa de centro' },
        { tipo: 'cojin', etiqueta: 'Cojines', peso: 0.50, palabras: /^((set|juego) (de )?)?cojin(es)?\b/, topePrecio: 0.3, buscar: 'cojín decorativo' },
        { tipo: 'sillon', etiqueta: 'Sillón', peso: 0.45, palabras: /^(sillon|silla ocasional|reposet)\b/, topePrecio: 0.8, buscar: 'sillón' },
        // Más de la mitad de quienes renuevan la casa compra tapete (Houzz, 2023).
        { tipo: 'tapete', etiqueta: 'Tapete', peso: 0.55, palabras: /^(tapete|alfombra)\b/, topePrecio: 0.6, buscar: 'tapete para sala' },
        { tipo: 'lampara', etiqueta: 'Lámpara', peso: 0.30, palabras: /^lampara\b/, topePrecio: 0.4, buscar: 'lámpara de pie' }
      ]
    },
    {
      id: 'oficina', nombre: 'Muebles de oficina', sustitutoPorTipo: true, sinSubidaDeModelo: true,
      migas: /sillas? (para|de) oficina|sillas? gamer|escritorios?|muebles de oficina|home office/,
      producto: /silla (de escritorio|de oficina|gamer|ejecutiva)|escritorio/,
      titulo: /^(silla (de escritorio|de oficina|gamer|ejecutiva|secretarial)|escritorio)\b/,
      // «Computadoras de escritorio» es una miga de Computación, no un mueble.
      noEs: /^(computadora|all in one|todo en uno|pc|cpu|imac|mini pc)\b|^computadoras? de escritorio/,
      complementos: [
        { tipo: 'escritorio', etiqueta: 'Escritorio', peso: 0.65, palabras: /^escritorio\b/, buscar: 'escritorio' },
        { tipo: 'silla', etiqueta: 'Silla', peso: 0.60, palabras: /^silla (de escritorio|de oficina|gamer|ejecutiva|secretarial)\b/, buscar: 'silla de escritorio' },
        { tipo: 'librero', etiqueta: 'Librero', peso: 0.40, palabras: /^(librero|estante|repisa|organizador)\b/, buscar: 'librero' },
        { tipo: 'lampara', etiqueta: 'Lámpara de escritorio', peso: 0.35, palabras: /^lampara\b/, requiere: /escritorio|mesa|led/, buscar: 'lámpara de escritorio' },
        { tipo: 'tapete', etiqueta: 'Tapete para silla', peso: 0.25, palabras: /^tapete\b/, requiere: /silla|oficina|escritorio/, buscar: 'tapete para silla' }
      ]
    },
    {
      id: 'cocina', nombre: 'Baterías y sartenes',
      migas: /baterias? de cocina|sartenes?|ollas?$|cacerolas?|utensilios de cocina/,
      producto: /^bateria( de cocina)?$|sarten|^olla(?! electrica)|cacerola|wok/,   // «Batería portátil» es del celular
      titulo: /^((set|juego) (de )?)?(bateria de cocina|sartenes?|olla(?! (electrica|de coccion))|cacerola|wok)\b/,
      complementos: [
        { tipo: 'utensilios', etiqueta: 'Utensilios', peso: 0.65, palabras: /^((set|juego) (de )?)?(utensilios|espatulas?|pinzas?|cucharones?)\b/, topePrecio: 0.6, buscar: 'set de utensilios de cocina' },
        { tipo: 'cuchillos', etiqueta: 'Cuchillos', peso: 0.50, palabras: /^((set|juego) (de )?)?cuchillos?\b/, topePrecio: 0.8, buscar: 'set de cuchillos' },
        { tipo: 'tabla', etiqueta: 'Tabla para picar', peso: 0.40, palabras: /^tabla (para|de) picar\b/, topePrecio: 0.4, buscar: 'tabla para picar' },
        { tipo: 'contenedores', etiqueta: 'Contenedores', peso: 0.35, palabras: /^((set|juego) (de )?)?(contenedores?|refractarios?)\b/, topePrecio: 0.6, buscar: 'set de contenedores' }
      ]
    },
    {
      id: 'mesa', nombre: 'Vajillas y mesa', sustitutoPorTipo: true, sinSubidaDeModelo: true,
      migas: /vajillas?|juegos? de vajillas|cubiertos|cristaleria|mesa y bar/,
      producto: /vajilla|cubiertos|copas|vasos|platos/,
      titulo: /^((set|juego) (de )?)?(vajilla|cubiertos|copas?|vasos?|platos?)\b/,
      complementos: [
        { tipo: 'cubiertos', etiqueta: 'Cubiertos', peso: 0.65, palabras: /^((set|juego) (de )?)?cubiertos\b/, buscar: 'set de cubiertos' },
        { tipo: 'copas', etiqueta: 'Copas o vasos', peso: 0.50, palabras: /^((set|juego) (de )?)?(copas?|vasos?)\b/, buscar: 'set de copas' },
        { tipo: 'tazas', etiqueta: 'Tazas', peso: 0.40, palabras: /^((set|juego) (de )?)?tazas?\b/, buscar: 'set de tazas' },
        { tipo: 'vajilla', etiqueta: 'Vajilla', peso: 0.40, palabras: /^vajilla\b/, buscar: 'vajilla' },
        { tipo: 'mantel', etiqueta: 'Mantel', peso: 0.25, palabras: /^(mantel|camino de mesa|individuales?)\b/, buscar: 'mantel' }
      ]
    },
    {
      id: 'asador', nombre: 'Asadores', sinSubidaDeModelo: true,
      migas: /asadores?|parrillas? (de carbon|de gas)|bbq/,
      producto: /asador|parrilla de carbon|barbecue/,
      titulo: /^(asador|parrilla de carbon|grill)\b/,
      complementos: [
        { tipo: 'utensilios', etiqueta: 'Utensilios', peso: 0.70, palabras: /^((set|juego|kit) (de )?)?(utensilios|bbq|asador)\b/, requiere: /utensilio|bbq|pinza|espatula|asar/, topePrecio: 0.7, buscar: 'set de utensilios para asador' },
        { tipo: 'funda', etiqueta: 'Funda', peso: 0.60, palabras: /^funda\b/, requiere: /asador|parrilla|grill/, topePrecio: 0.5, buscar: 'funda para asador' },
        { tipo: 'carbon', etiqueta: 'Carbón', peso: 0.40, palabras: /^(carbon|briquetas?)\b/, buscar: 'carbón para asador' },
        { tipo: 'encendedor', etiqueta: 'Encendedor', peso: 0.30, palabras: /^(encendedor|chimenea de encendido)\b/, buscar: 'encendedor para asador' },
        { tipo: 'termometro', etiqueta: 'Termómetro', peso: 0.30, palabras: /^termometro\b/, buscar: 'termómetro para carne' }
      ]
    },
    {
      id: 'herramienta', nombre: 'Herramientas', servicio: true,
      migas: /herramientas? electricas?|taladros?|rotomartillos?|atornilladores?|esmeriles?|sierras?/,
      producto: /taladro|rotomartillo|atornillador|esmeril|sierra|lijadora/,
      titulo: /^(taladro|rotomartillo|atornillador|esmeril|sierra (circular|caladora)|lijadora)\b/,
      complementos: [
        { tipo: 'brocas', etiqueta: 'Juego de brocas', peso: 0.70, palabras: /^((set|juego|kit) (de )?)?(brocas?|puntas?|discos?|dados)\b/, topePrecio: 0.6, buscar: 'juego de brocas' },
        { tipo: 'desarmadores', etiqueta: 'Desarmadores', peso: 0.45, palabras: /^((set|juego|kit) (de )?)?desarmadores?\b/, topePrecio: 0.5, buscar: 'set de desarmadores' },
        { tipo: 'bateria', etiqueta: 'Batería', peso: 0.45, palabras: /^(bateria|cargador)\b/, mismaMarca: true, topePrecio: 0.8, soloSugerir: true, buscar: 'batería {marca}' },
        { tipo: 'caja', etiqueta: 'Caja de herramientas', peso: 0.40, palabras: /^(caja|organizador|maletin)\b/, requiere: /herramienta/, buscar: 'caja de herramientas' },
        { tipo: 'proteccion', etiqueta: 'Protección', peso: 0.25, palabras: /^(lentes de seguridad|guantes|careta)\b/, buscar: 'lentes de seguridad' }
      ]
    },

    // =========================================================================
    // Bebés
    // =========================================================================
    {
      id: 'carriola', nombre: 'Carriolas',
      migas: /carriola/,
      producto: /carriola/,
      titulo: /^(carriola|sistema de viaje|travel system)\b/,
      complementos: [
        { tipo: 'autoasiento', etiqueta: 'Autoasiento', peso: 0.80, palabras: /^(autoasiento|portabebe|car ?seat)\b/, buscar: 'autoasiento {marca}' },
        { tipo: 'canguro', etiqueta: 'Canguro', peso: 0.50, palabras: /^(canguro|fular|cargador para bebe|portabebe ergonomico)\b/, buscar: 'canguro para bebé' },
        { tipo: 'panalera', etiqueta: 'Pañalera', peso: 0.40, palabras: /^(panalera|organizador|bolsa panalera)\b/, buscar: 'pañalera' },
        { tipo: 'cuna', etiqueta: 'Cuna de viaje', peso: 0.35, palabras: /^(cuna de viaje|corral)\b/, buscar: 'cuna de viaje' },
        { tipo: 'lluvia', etiqueta: 'Protector para lluvia', peso: 0.25, palabras: /^(protector (para|de) lluvia|cubierta)\b/, buscar: 'protector para lluvia carriola' }
      ]
    },
    {
      id: 'autoasiento', nombre: 'Autoasientos',
      migas: /autoasientos?|sillas? para auto/,
      producto: /autoasiento|silla para auto|portabebe/,
      titulo: /^(autoasiento|silla para auto|portabebe|booster)\b/,
      complementos: [
        { tipo: 'base', etiqueta: 'Base', peso: 0.50, palabras: /^base\b/, requiere: /autoasiento|portabebe|isofix/, mismaMarca: true, buscar: 'base para autoasiento' },
        { tipo: 'carriola', etiqueta: 'Carriola', peso: 0.50, palabras: /^carriola\b/, topePrecio: 2.5, buscar: 'carriola {marca}' },
        { tipo: 'protector', etiqueta: 'Protector de asiento', peso: 0.40, palabras: /^protector\b/, requiere: /asiento|auto/, buscar: 'protector de asiento para auto' },
        { tipo: 'espejo', etiqueta: 'Espejo para auto', peso: 0.30, palabras: /^espejo\b/, requiere: /bebe|auto/, buscar: 'espejo para auto bebé' },
        { tipo: 'parasol', etiqueta: 'Parasol', peso: 0.25, palabras: /^(parasol|cortina|sombrilla)\b/, requiere: /auto|ventana|coche/, buscar: 'parasol para auto' }
      ]
    },
    {
      id: 'cuna', nombre: 'Cunas',
      migas: /cunas?|colechos?|moises/,
      producto: /cuna|colecho|moises|bambineto/,
      titulo: /^(cuna|colecho|moises|bambineto)\b(?! de viaje)/,
      complementos: [
        { tipo: 'colchon', etiqueta: 'Colchón para cuna', peso: 0.80, palabras: /^colchon\b/, requiere: /cuna|bebe|colecho/, buscar: 'colchón para cuna' },
        // Nunca chichoneras: prohibidas en EE. UU. desde 2022 y desaconsejadas por la AAP.
        { tipo: 'protector', etiqueta: 'Protector de colchón', peso: 0.50, palabras: /^protector\b/, requiere: /colchon|impermeable/, excluye: /chichonera|acolchad/, buscar: 'protector de colchón para cuna' },
        { tipo: 'sabanas', etiqueta: 'Sábanas para cuna', peso: 0.50, palabras: /^((set|juego) (de )?)?sabanas?\b/, requiere: /cuna|bebe/, buscar: 'sábanas para cuna' },
        { tipo: 'monitor', etiqueta: 'Monitor de bebé', peso: 0.45, palabras: /^(monitor|baby monitor)\b/, buscar: 'monitor para bebé' },
        { tipo: 'movil', etiqueta: 'Móvil', peso: 0.30, palabras: /^movil\b/, buscar: 'móvil para cuna' }
      ]
    },
    {
      id: 'sillaAlta', nombre: 'Sillas altas',
      migas: /sillas? altas?|periqueras?/,
      producto: /silla alta|periquera/,
      titulo: /^(silla alta|periquera|silla para comer)\b/,
      complementos: [
        { tipo: 'alimentacion', etiqueta: 'Set de alimentación', peso: 0.60, palabras: /^((set|kit) (de )?)?(alimentacion|platos?|vajilla infantil|cucharas?)\b/, buscar: 'set de alimentación para bebé' },
        { tipo: 'baberos', etiqueta: 'Baberos', peso: 0.50, palabras: /^((set|juego) (de )?)?baberos?\b/, buscar: 'baberos' },
        { tipo: 'tapete', etiqueta: 'Tapete', peso: 0.30, palabras: /^tapete\b/, buscar: 'tapete para bebé' }
      ]
    },

    // =========================================================================
    // Deportes y viaje
    // =========================================================================
    {
      id: 'bicicleta', nombre: 'Bicicletas',
      migas: /ciclismo|bicicletas?$/,
      producto: /^bicicleta(?! (fija|estatica|de spinning))/,
      titulo: /^bicicleta\b(?! (fija|estatica|de spinning|spinning|recumbente))/,
      complementos: [
        { tipo: 'casco', etiqueta: 'Casco', peso: 0.80, palabras: /^casco\b/, buscar: 'casco para bicicleta' },
        { tipo: 'candado', etiqueta: 'Candado', peso: 0.55, palabras: /^(candado|cadena)\b/, buscar: 'candado para bicicleta' },
        { tipo: 'luces', etiqueta: 'Luces', peso: 0.45, palabras: /^(luz|luces|lampara|set de luces)\b/, requiere: /bici/, buscar: 'luces para bicicleta' },
        { tipo: 'bomba', etiqueta: 'Bomba de aire', peso: 0.40, palabras: /^(bomba|inflador)\b/, requiere: /bici|aire/, buscar: 'bomba para bicicleta' },
        { tipo: 'anfora', etiqueta: 'Ánfora', peso: 0.30, palabras: /^(anfora|botella|cilindro|portabotella|termo)\b/, buscar: 'ánfora deportiva' },
        { tipo: 'guantes', etiqueta: 'Guantes', peso: 0.25, palabras: /^guantes?\b/, buscar: 'guantes para ciclismo' }
      ]
    },
    {
      id: 'ejercicio', nombre: 'Aparatos de ejercicio', servicio: true,
      migas: /caminadoras?|elipticas?|bicicletas? (fijas?|de spinning|estaticas?)|aparatos de ejercicio|estaciones de gimnasio/,
      producto: /caminadora|eliptica|bicicleta (fija|de spinning|estatica)|estacion de gimnasio/,
      titulo: /^(caminadora|eliptica|bicicleta (fija|estatica|de spinning|spinning|recumbente)|estacion (de )?gimnasio|escaladora|remo)\b/,
      complementos: [
        // «Tapete para caminadora» no existe en Liverpool (investigación); el deportivo sí (corpus).
        { tipo: 'tapete', etiqueta: 'Tapete', peso: 0.60, palabras: /^tapete\b/, buscar: 'tapete deportivo' },
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.45, palabras: /^(regulador|supresor)\b/, si: /caminadora/, buscar: 'regulador de voltaje' },
        { tipo: 'lubricante', etiqueta: 'Lubricante', peso: 0.35, palabras: /^(lubricante|silicon)\b/, si: /caminadora/, buscar: 'lubricante para caminadora' },
        { tipo: 'mancuernas', etiqueta: 'Mancuernas', peso: 0.40, palabras: /^((set|juego|par) (de )?)?(mancuernas?|pesas)\b/, topePrecio: 0.3, buscar: 'mancuernas' },
        { tipo: 'monitor', etiqueta: 'Monitor de ritmo', peso: 0.30, palabras: /^(banda de ritmo|monitor cardiaco|smartwatch|pulsera)\b/, topePrecio: 0.3, buscar: 'monitor de ritmo cardiaco' },
        { tipo: 'accesorio', etiqueta: 'Accesorio', peso: 0.25, palabras: /^(rueda abdominal|ligas?|bandas? de resistencia|cuerda para saltar)\b/, buscar: 'ligas de resistencia' }
      ]
    },
    {
      id: 'pesas', nombre: 'Pesas',
      migas: /pesas|mancuernas|kettlebells?|discos y barras/,
      producto: /mancuerna|pesa|kettlebell|barra olimpica|disco de peso/,
      titulo: /^((set|juego|par) (de )?)?(mancuernas?|pesas|kettlebell|pesa rusa|barra olimpica|discos? de peso)\b/,
      complementos: [
        { tipo: 'tapete', etiqueta: 'Tapete', peso: 0.60, palabras: /^tapete\b/, buscar: 'tapete deportivo' },
        { tipo: 'banco', etiqueta: 'Banco', peso: 0.55, palabras: /^(banco|banca)\b/, buscar: 'banco para pesas' },
        { tipo: 'guantes', etiqueta: 'Guantes', peso: 0.40, palabras: /^guantes?\b/, buscar: 'guantes para gimnasio' },
        { tipo: 'accesorio', etiqueta: 'Accesorio', peso: 0.35, palabras: /^(cuerda para saltar|ligas?|bandas? de resistencia|disco deslizante|rueda abdominal)\b/, buscar: 'cuerda para saltar' }
      ]
    },
    {
      id: 'maleta', nombre: 'Maletas', sinSubidaDeModelo: true,
      migas: /maletas?|equipaje|viaje/,
      producto: /maleta|equipaje/,
      titulo: /^((set|juego) (de )?)?maletas?\b/,
      // Una mochila no es maleta aunque su miga sea «Mochilas y maletas deportivas»: a la
      // «Mochila escolar Phase Small para niño» se le ofrecía el candado TSA (04/10/2026).
      noEs: /^mochilas?\b/,
      complementos: [
        { tipo: 'candado', etiqueta: 'Candado', peso: 0.60, palabras: /^candado\b/, buscar: 'candado para maleta' },
        { tipo: 'organizador', etiqueta: 'Organizador', peso: 0.50, palabras: /^((set|juego) (de )?)?(organizadores?|cubos?|bolsas? organizadoras?)\b/, buscar: 'organizador para maleta' },
        { tipo: 'almohada', etiqueta: 'Almohada de viaje', peso: 0.40, palabras: /^(almohada de viaje|cojin de viaje|almohada para cuello)\b/, buscar: 'almohada de viaje' },
        { tipo: 'neceser', etiqueta: 'Neceser', peso: 0.35, palabras: /^(neceser|cosmetiquera|bolsa de aseo)\b/, buscar: 'neceser' },
        { tipo: 'etiqueta', etiqueta: 'Etiqueta o báscula', peso: 0.25, palabras: /^(etiqueta|bascula|identificador)\b/, buscar: 'báscula para maleta' },
        { tipo: 'funda', etiqueta: 'Funda', peso: 0.25, palabras: /^(funda|cubierta)\b/, requiere: /maleta|equipaje/, buscar: 'funda para maleta' }
      ]
    },
    {
      id: 'mochilaEscolar', nombre: 'Mochilas escolares',
      migas: /mochilas?( escolares)?$|escolares/,
      producto: /mochila/,
      titulo: /^mochila\b(?! (para|con) (laptop|portalaptop))/,
      noEs: /^mochilas? (para|con) (laptop|portalaptop|camara)|^mochilas? (de hidratacion|antirrobo|ejecutiva|portabebe)|panalera|hidratacion/,
      complementos: [
        { tipo: 'lonchera', etiqueta: 'Lonchera', peso: 0.70, palabras: /^lonchera\b/, topePrecio: 0.8, buscar: 'lonchera térmica' },
        { tipo: 'lapicera', etiqueta: 'Lapicera', peso: 0.55, palabras: /^(lapicera|estuche escolar|cosmetiquera)\b/, topePrecio: 0.5, buscar: 'lapicera' },
        { tipo: 'termo', etiqueta: 'Termo o botella', peso: 0.40, palabras: /^(termo|botella|cilindro|vaso)\b/, topePrecio: 0.5, buscar: 'termo infantil' },
        { tipo: 'papeleria', etiqueta: 'Papelería', peso: 0.30, palabras: /^((set|kit) (de )?)?(papeleria|utiles|colores|plumones)\b/, topePrecio: 0.5, buscar: 'set de papelería' }
      ]
    },

    // =========================================================================
    // Moda y accesorios
    // =========================================================================
    {
      id: 'calzado', nombre: 'Calzado', sinSubidaDeModelo: true, moda: true,
      migas: /tenis|zapatos?|calzado|botas?|sandalias?|mocasines/,
      producto: /tenis|zapato|calzado|bota|sandalia|mocasin/,
      titulo: /^(tenis|zapato|bota|botin|sandalia|mocasin|flats?|zapatilla)\b/,
      complementos: [
        { tipo: 'calcetines', etiqueta: 'Calcetines', peso: 0.40, palabras: /^(set de |paquete de )?(calcetin|calceta|tines)/, mismoGenero: true, buscar: 'calcetines {marca} {genero}' },
        { tipo: 'playera', etiqueta: 'Playera', peso: 0.55, palabras: /^(playera|camiseta|jersey)\b/, mismoGenero: true, si: /^tenis/, buscar: 'playera {marca} {genero}' },
        { tipo: 'pants', etiqueta: 'Pants o short', peso: 0.50, palabras: /^(pants|short|jogger|pantalon deportivo|leggings|mallas)\b/, mismoGenero: true, si: /^tenis/, buscar: 'pants {marca} {genero}' },
        // Con zapatos de vestir va el cinturón de piel (corpus: 3 de 7 en «Complementa con»).
        { tipo: 'cinturon', etiqueta: 'Cinturón', peso: 0.55, palabras: /^cinturon\b/, mismoGenero: true, si: /^(zapato|mocasin|bota|botin)/, buscar: 'cinturón de piel {genero}' },
        // «Kit cuidado y limpieza para calzado» (Crep Protect, investigación 04/10/2026).
        { tipo: 'cuidado', etiqueta: 'Cuidado del calzado', peso: 0.30, palabras: /^(kit|limpiador|betun|grasa|crema para calzado|repelente|espuma limpiadora)\b/, requiere: /calzado|tenis|zapato|piel|sneaker/, buscar: 'limpiador para calzado' },
        { tipo: 'mochila', etiqueta: 'Mochila', peso: 0.30, palabras: /^mochila\b/, si: /^tenis/, buscar: 'mochila {marca}' },
        { tipo: 'gorra', etiqueta: 'Gorra', peso: 0.25, palabras: /^(gorra|cachucha|visera)\b/, si: /^tenis/, buscar: 'gorra {marca}' }
      ]
    },
    {
      id: 'traje', nombre: 'Trajes', sinSubidaDeModelo: true, moda: true,
      migas: /trajes?$|sacos? formales?/,
      producto: /^traje|saco formal|smoking/,
      titulo: /^(traje|saco formal|smoking)\b/,
      // Con un traje de baño no va una corbata.
      noEs: /^trajes? (de )?(bano|neopreno|buzo|natacion|dormir|bebe|bautizo|charro)\b|disfraz/,
      complementos: [
        { tipo: 'camisa', etiqueta: 'Camisa de vestir', peso: 0.65, palabras: /^camisa\b/, requiere: /vestir|formal|manga larga/, buscar: 'camisa de vestir para hombre' },
        { tipo: 'corbata', etiqueta: 'Corbata', peso: 0.55, palabras: /^(corbata|corbatin|mono)\b/, buscar: 'corbata' },
        { tipo: 'zapatos', etiqueta: 'Zapatos de vestir', peso: 0.50, palabras: /^(zapato|mocasin)\b/, buscar: 'zapatos de vestir para hombre' },
        { tipo: 'cinturon', etiqueta: 'Cinturón', peso: 0.45, palabras: /^cinturon\b/, buscar: 'cinturón de piel para hombre' },
        { tipo: 'calcetines', etiqueta: 'Calcetines', peso: 0.30, palabras: /^(set de |paquete de )?(calcetin|calceta)/, buscar: 'calcetines de vestir' },
        { tipo: 'mancuernillas', etiqueta: 'Mancuernillas', peso: 0.25, palabras: /^(mancuernillas|pisacorbatas)\b/, buscar: 'mancuernillas' }
      ]
    },
    {
      // Por tipo: con los jeans va una blusa, que también es «ropa». Sin esto, todo lo que
      // traía la búsqueda «blusa para mujer» se descartaba como sustituto (04/10/2026).
      id: 'ropa', nombre: 'Ropa', sustitutoPorTipo: true, sinSubidaDeModelo: true, moda: true,
      migas: /playeras?|camisas?|blusas?|sudaderas?|chamarras?|pantalones?|jeans|shorts?|faldas?|vestidos?/,
      producto: /playera|camisa|blusa|sudadera|chamarra|pantalon|jeans|short|falda|vestido|polo/,
      titulo: /^(playera|camisa|blusa|sudadera|chamarra|pantalon|jeans|short|falda|vestido|polo)\b/,
      complementos: [
        { tipo: 'inferior', etiqueta: 'Pantalón', peso: 0.55, palabras: /^(pantalon|jeans|short|bermuda|falda)\b/, mismoGenero: true,
          si: /^(playera|camisa|blusa|sudadera|chamarra|polo)/, buscar: 'jeans para {genero}' },
        { tipo: 'superior', etiqueta: 'Playera o blusa', peso: 0.55, palabras: /^(playera|camisa|blusa|polo|top)\b/, mismoGenero: true,
          si: /^(pantalon|jeans|short|bermuda|falda)/, buscar: 'blusa para {genero}' },
        { tipo: 'chamarra', etiqueta: 'Chamarra o blazer', peso: 0.35, palabras: /^(chamarra|chaleco|sueter|cardigan|blazer|saco)\b/, mismoGenero: true, si: /^(jeans|pantalon|playera|blusa|vestido)/, buscar: 'blazer {genero}' },
        // Con un vestido de fiesta van los zapatos, la bolsa de mano y los aretes (el corpus
        // no los trae: «Complementa con» del vestido eran playeras y jeans).
        { tipo: 'zapatillas', etiqueta: 'Zapatillas', peso: 0.55, palabras: /^(zapatilla|sandalia|tacon|stiletto)\b/, si: /^vestido/, buscar: 'zapatillas para mujer' },
        { tipo: 'bolsa', etiqueta: 'Bolsa de fiesta', peso: 0.40, palabras: /^(bolsa|clutch|cartera de mano)\b/, si: /^vestido/, buscar: 'bolsa de fiesta' },
        { tipo: 'aretes', etiqueta: 'Aretes', peso: 0.35, palabras: /^(aretes|arracadas|collar)\b/, si: /^vestido/, buscar: 'aretes de fantasía' },
        { tipo: 'calzado', etiqueta: 'Tenis o zapatos', peso: 0.40, palabras: /^(tenis|zapatos?|botas?|botin|sandalias?|mocasin)\b/, mismoGenero: true, si: /^(playera|camisa|blusa|sudadera|pantalon|jeans|short|polo)/, buscar: 'tenis para {genero}' },
        { tipo: 'cinturon', etiqueta: 'Cinturón', peso: 0.35, palabras: /^cinturon\b/, mismoGenero: true, si: /^(pantalon|jeans|short|bermuda)/, buscar: 'cinturón {genero}' },
        { tipo: 'gorra', etiqueta: 'Gorra', peso: 0.25, palabras: /^(gorra|cachucha)\b/, si: /^(playera|sudadera|short)/, buscar: 'gorra {marca}' }
      ]
    },
    {
      id: 'bolsa', nombre: 'Bolsas', sinSubidaDeModelo: true, moda: true,
      migas: /bolsas?( de mano)?$|accesorios y bolsas|bolsos/,
      producto: /^bolsa|bolso|clutch/,
      titulo: /^(bolsa|bolso|clutch)\b(?! (de|para) (dormir|basura|regalo|aseo|panalera))/,
      noEs: /^bolsas? (de |para )(dormir|basura|regalo|aseo|hielo|agua caliente|lavanderia|ropa sucia|mandado|super|almacenamiento|vacio)|^bolsas? (hermeticas?|ziploc|organizadoras?|termicas? para (alimentos|comida|lunch))|panalera/,
      complementos: [
        { tipo: 'cartera', etiqueta: 'Cartera', peso: 0.65, palabras: /^(cartera|monedero|tarjetero)\b/, mismaMarca: true, buscar: 'cartera {marca}' },
        { tipo: 'cinturon', etiqueta: 'Cinturón', peso: 0.40, palabras: /^cinturon\b/, mismoGenero: true, buscar: 'cinturón para mujer' },
        { tipo: 'lentes', etiqueta: 'Lentes de sol', peso: 0.35, palabras: /^lentes (de sol|solares)\b/, mismoGenero: true, buscar: 'lentes de sol para mujer' },
        { tipo: 'mascada', etiqueta: 'Mascada', peso: 0.30, palabras: /^(mascada|panoleta|bufanda)\b/, buscar: 'mascada' },
        { tipo: 'aretes', etiqueta: 'Aretes', peso: 0.35, palabras: /^(aretes|arracadas|broqueles)\b/, buscar: 'aretes para mujer' },
        { tipo: 'llavero', etiqueta: 'Llavero', peso: 0.25, palabras: /^(llavero|charm)\b/, buscar: 'llavero {marca}' }
      ]
    },
    {
      id: 'cartera', nombre: 'Carteras', sinSubidaDeModelo: true, moda: true,
      migas: /carteras?|tarjeteros?|monederos?/,
      producto: /cartera|tarjetero|monedero/,
      titulo: /^(cartera|monedero|billetera)\b/,   // el tarjetero la complementa (corpus: 2 en «Otros clientes compraron»)
      complementos: [
        // El cinturón es lo que Liverpool vende con la cartera (corpus: 10 de 25 en
        // «Complementa con»; la tarjeta ofrecía un pantalón y una playera).
        { tipo: 'cinturon', etiqueta: 'Cinturón', peso: 0.75, palabras: /^cinturon\b/, mismoGenero: true, buscar: 'cinturón de piel {genero}' },
        { tipo: 'tarjetero', etiqueta: 'Tarjetero', peso: 0.40, palabras: /^(tarjetero|porta ?tarjetas)\b/, buscar: 'tarjetero de piel' },
        { tipo: 'llavero', etiqueta: 'Llavero', peso: 0.30, palabras: /^llavero\b/, buscar: 'llavero de piel' },
        { tipo: 'guantes', etiqueta: 'Guantes', peso: 0.25, palabras: /^guantes\b/, mismoGenero: true, buscar: 'guantes de piel' }
      ]
    },
    {
      id: 'reloj', nombre: 'Relojes', sinSubidaDeModelo: true, moda: true,
      migas: /relojes?$/,
      producto: /^reloj(?! inteligente)/,
      titulo: /^reloj\b(?! inteligente)/,
      noEs: /^reloj(es)? (de )?(pared|mesa|escritorio|cocina|arena|buro|chimenea)\b|^reloj(es)? (despertador|checador|cucu)|^despertador/,
      complementos: [
        { tipo: 'estuche', etiqueta: 'Estuche para relojes', peso: 0.40, palabras: /^(estuche|caja|organizador|alhajero|relojero)\b/, requiere: /reloj/, buscar: 'estuche para relojes' },
        { tipo: 'cartera', etiqueta: 'Cartera', peso: 0.40, palabras: /^cartera\b/, mismoGenero: true, si: /hombre|caballero/, buscar: 'cartera de piel para hombre' },
        { tipo: 'cinturon', etiqueta: 'Cinturón', peso: 0.35, palabras: /^cinturon\b/, mismoGenero: true, si: /hombre|caballero/, buscar: 'cinturón de piel para hombre' },
        // Con el reloj de mujer va la joyería del mismo tono (H&M: collar lift 8.3, pulsera hasta 20).
        { tipo: 'joyeria', etiqueta: 'Collar o pulsera', peso: 0.45, palabras: /^(collar|aretes|pulsera|brazalete|esclava|anillo)\b/, si: /mujer|dama/, buscar: 'pulsera para mujer' },
        { tipo: 'extensible', etiqueta: 'Extensible', peso: 0.30, palabras: /^(extensible|correa)\b/, requiere: /reloj/, mismaMarca: true, topePrecio: 0.5, buscar: 'extensible para reloj {marca}' },
        { tipo: 'lentes', etiqueta: 'Lentes de sol', peso: 0.25, palabras: /^lentes (de sol|solares)\b/, mismoGenero: true, buscar: 'lentes de sol {genero}' }
      ]
    },
    {
      id: 'lentes', nombre: 'Lentes', sinSubidaDeModelo: true, moda: true,
      migas: /lentes|solares|armazones/,
      producto: /lentes|armazon/,
      titulo: /^(lentes|armazon|gafas)\b/,
      noEs: /natacion|goggles|realidad virtual|^lentes (de |para )?(seguridad|proteccion|contacto|lectura|nieve|ski|esqui|vr|3d)\b/,
      complementos: [
        // Los lentes de sol se compran con lo del verano (H&M: traje de baño 12-13 % en mujer,
        // bolsa de playa lift 3.3). El estuche casi siempre viene incluido.
        { tipo: 'banio', etiqueta: 'Traje de baño', peso: 0.45, palabras: /^(traje de bano|bikini|bermuda de bano|short de bano)\b/, mismoGenero: true, si: /sol|solares/, buscar: 'traje de baño {genero}' },
        { tipo: 'gorra', etiqueta: 'Sombrero o gorra', peso: 0.40, palabras: /^(gorra|sombrero|cachucha)\b/, buscar: 'sombrero' },
        { tipo: 'playa', etiqueta: 'Bolsa de playa', peso: 0.30, palabras: /^bolsa\b/, requiere: /playa/, si: /sol|solares/, buscar: 'bolsa de playa' },
        { tipo: 'estuche', etiqueta: 'Estuche', peso: 0.35, palabras: /^(estuche|funda)\b/, requiere: /lentes|gafas|anteojos/, buscar: 'estuche para lentes' },
        { tipo: 'sandalias', etiqueta: 'Sandalias', peso: 0.30, palabras: /^(sandalias?|chanclas?)\b/, mismoGenero: true, si: /sol|solares/, buscar: 'sandalias {genero}' },
        { tipo: 'limpieza', etiqueta: 'Limpiador', peso: 0.25, palabras: /^(limpiador|kit de limpieza|pano|toallitas)\b/, requiere: /lentes|cristales|pantallas/, buscar: 'limpiador para lentes' }
      ]
    },
    {
      id: 'joyeria', nombre: 'Joyería', sustitutoPorTipo: true, sinSubidaDeModelo: true, moda: true,
      migas: /joyeria|aretes|collares?|anillos?|pulseras?|dijes?|arracadas/,
      producto: /arete|collar|anillo|pulsera|dije|arracada|cadena|gargantilla|brazalete/,
      titulo: /^((set|juego) (de )?)?(aretes?|arracadas|collar|anillo(?! inteligente)|pulsera(?! (de actividad|inteligente))|dije|colgante|cadena|gargantilla|brazalete|medalla)\b/,
      complementos: [
        { tipo: 'collar', etiqueta: 'Collar o dije', peso: 0.60, palabras: /^((set|juego) (de )?)?(collar|cadena|gargantilla|dije|colgante|medalla)\b/, buscar: 'collar con dije' },
        { tipo: 'aretes', etiqueta: 'Aretes', peso: 0.55, palabras: /^((set|juego) (de )?)?(aretes?|arracadas|broqueles)\b/, buscar: 'aretes' },
        { tipo: 'pulsera', etiqueta: 'Pulsera', peso: 0.45, palabras: /^(pulsera|brazalete|esclava)\b/, buscar: 'pulsera' },
        { tipo: 'anillo', etiqueta: 'Anillo', peso: 0.35, palabras: /^anillo\b/, excluye: /inteligente|compromiso/, buscar: 'anillo' },
        { tipo: 'alhajero', etiqueta: 'Alhajero', peso: 0.30, palabras: /^(alhajero|joyero|organizador de joyeria)\b/, buscar: 'alhajero' }
      ]
    },

    // =========================================================================
    // Belleza y cuidado personal
    // =========================================================================
    {
      id: 'perfume', nombre: 'Perfumes', sinSubidaDeModelo: true,
      migas: /perfume|fragancia/,
      producto: /perfume|fragancia|eau de|colonia/,
      titulo: /^(perfume|eau de (parfum|toilette|cologne)|fragancia|colonia|locion|elixir|parfum)\b/,
      complementos: [
        { tipo: 'set', etiqueta: 'Set', peso: 0.65, palabras: /^(set|kit|estuche|coffret)\b/, mismaLinea: true, buscar: 'set {linea} {marca}' },
        { tipo: 'corporal', etiqueta: 'Línea corporal', peso: 0.55, palabras: /^(body|crema|locion corporal|leche corporal|desodorante|gel|balsamo corporal|aceite corporal|bruma|after shave)\b/,
          mismaMarca: true, buscar: 'crema corporal {linea} {marca}' }
        // La bolsa de regalo (el perfume es el 35.8 % de los regalos del Día de las Madres,
        // Mitofsky 2025) no está en la tienda en línea: su búsqueda no trajo ninguna (04/10/2026).
      ]
    },
    {
      id: 'maquillaje', nombre: 'Maquillaje', sustitutoPorTipo: true, sinSubidaDeModelo: true,
      // Migas exactas: «Sets Maquillaje» trajo una crema facial (corpus) y «Base» a secas
      // también es la de la cama.
      migas: /^(maquillaje( y skincare)?|labiales?|bases de maquillaje|correctores?|polvos?|rubores?|sombras?( para ojos)?|mascaras? de pestanas|delineadores?|rostro|ojos|labios)$/,
      producto: /^(base (de maquillaje|liquida|en polvo|en barra)|corrector|polvo|primer|rubor|blush|bronceador|iluminador|sombra|paleta|mascara|rimel|delineador|labial|brillo|gloss|tinta para labios|fijador)/,
      titulo: /^(base de maquillaje|base liquida|corrector|polvo (compacto|traslucido|suelto)|primer|rubor|blush|bronceador|iluminador|sombra|paleta de sombras|mascara (de|para) pestanas|rimel|delineador|labial|brillo labial|gloss|tinta para labios|spray fijador|fijador de maquillaje)\b/,
      complementos: [
        { tipo: 'primer', etiqueta: 'Primer', peso: 0.55, palabras: /^(primer|prebase)\b/, si: /^(base|corrector|polvo)/, buscar: 'primer de maquillaje {marca}' },
        { tipo: 'polvo', etiqueta: 'Polvo', peso: 0.50, palabras: /^polvo\b/, si: /^(base|corrector)/, buscar: 'polvo compacto {marca}' },
        { tipo: 'fijador', etiqueta: 'Fijador', peso: 0.45, palabras: /^(spray fijador|fijador|bruma fijadora)\b/, buscar: 'spray fijador de maquillaje' },
        { tipo: 'corrector', etiqueta: 'Corrector', peso: 0.45, palabras: /^corrector\b/, si: /^(base|polvo|primer)/, buscar: 'corrector {marca}' },
        { tipo: 'brochas', etiqueta: 'Brochas', peso: 0.45, palabras: /^((set|kit|juego) (de )?)?(brochas?|esponjas?|pinceles?|beauty blender)\b/, topePrecio: 1, buscar: 'set de brochas para maquillaje' },
        { tipo: 'rubor', etiqueta: 'Rubor o iluminador', peso: 0.35, palabras: /^(rubor|blush|bronceador|iluminador|contorno)\b/, buscar: 'rubor {marca}' },
        { tipo: 'mascara', etiqueta: 'Máscara de pestañas', peso: 0.40, palabras: /^(mascara (de|para) pestanas|rimel)\b/, si: /^(sombra|paleta|delineador|labial|brillo|gloss|tinta)/, buscar: 'máscara para pestañas {marca}' },
        { tipo: 'delineador', etiqueta: 'Delineador', peso: 0.35, palabras: /^delineador\b/, si: /^(labial|brillo|gloss|tinta|sombra|paleta|mascara|rimel)/, buscar: 'delineador {marca}' },
        { tipo: 'labial', etiqueta: 'Labial', peso: 0.30, palabras: /^(labial|brillo labial|gloss|tinta para labios)\b/, si: /^(base|polvo|sombra|paleta|mascara|rimel|delineador de ojos)/, buscar: 'labial {marca}' },
        { tipo: 'desmaquillante', etiqueta: 'Desmaquillante', peso: 0.35, palabras: /^(desmaquillante|agua micelar|toallitas desmaquillantes|balsamo desmaquillante)\b/, buscar: 'desmaquillante {marca}' }
      ]
    },
    {
      id: 'cuidadoFacial', nombre: 'Cuidado facial', sustitutoPorTipo: true, sinSubidaDeModelo: true,
      migas: /protectores? solares?|cuidado facial|cuidado de la piel|dermocosmetic|tratamiento facial|limpieza facial|skincare/,
      producto: /protector solar|bloqueador|serum|crema facial|limpiador|agua termal|gel facial/,
      titulo: /^(protector solar|bloqueador|fotoprotector|serum|crema facial|limpiador|agua termal|tratamiento facial|contorno de ojos|gel facial)\b/,
      complementos: [
        { tipo: 'serum', etiqueta: 'Sérum', peso: 0.60, palabras: /^serum\b/, buscar: 'sérum facial {marca}' },
        { tipo: 'solar', etiqueta: 'Protector solar', peso: 0.55, palabras: /^(protector solar|bloqueador|fotoprotector|fluido solar)\b/, buscar: 'protector solar facial' },
        { tipo: 'hidratante', etiqueta: 'Hidratante', peso: 0.55, palabras: /^(crema|hidratante|emulsion)\b/, excluye: /corporal|manos|cabello|pies/, buscar: 'crema hidratante facial {marca}' },
        { tipo: 'limpiador', etiqueta: 'Limpiador', peso: 0.50, palabras: /^(limpiador|agua micelar|gel limpiador|desmaquillante|espuma|jabon)\b/, buscar: 'limpiador facial {marca}' },
        { tipo: 'aguaTermal', etiqueta: 'Agua termal', peso: 0.45, palabras: /^agua termal\b/, buscar: 'agua termal' },
        { tipo: 'ojos', etiqueta: 'Contorno de ojos', peso: 0.35, palabras: /^contorno\b/, buscar: 'contorno de ojos {marca}' },
        { tipo: 'tonico', etiqueta: 'Tónico', peso: 0.30, palabras: /^(tonico|esencia)\b/, buscar: 'tónico facial {marca}' }
      ]
    },
    {
      id: 'cabello', nombre: 'Cuidado del cabello', sustitutoPorTipo: true, sinSubidaDeModelo: true,
      migas: /shampoos?|acondicionadores?|tratamientos? capilares?|cuidado del cabello|cabello$/,
      producto: /shampoo|acondicionador|tratamiento capilar|mascarilla capilar|aceite (capilar|para cabello)/,
      titulo: /^((set|kit) (de )?)?(shampoo|acondicionador|tratamiento capilar|mascarilla (capilar|para cabello)|aceite (capilar|para cabello)|serum capilar|crema para peinar)\b/,
      complementos: [
        { tipo: 'acondicionador', etiqueta: 'Acondicionador', peso: 0.65, palabras: /^acondicionador\b/, buscar: 'acondicionador {marca}' },
        { tipo: 'tratamiento', etiqueta: 'Tratamiento', peso: 0.55, palabras: /^(tratamiento|mascarilla)\b/, requiere: /cabello|capilar|pelo|keratina/, excluye: /facial|rostro|corporal|barba/, buscar: 'tratamiento capilar {marca}' },
        { tipo: 'aceite', etiqueta: 'Aceite o sérum', peso: 0.50, palabras: /^(aceite (capilar|para (el )?cabello)|serum capilar|elixir)\b/, buscar: 'aceite para cabello' },
        { tipo: 'shampoo', etiqueta: 'Shampoo', peso: 0.45, palabras: /^shampoo\b/, buscar: 'shampoo {marca}' },
        { tipo: 'termico', etiqueta: 'Protector de calor', peso: 0.30, palabras: /^(protector (termico|de calor)|spray (protector|termico)|serum de proteccion termica)\b/, buscar: 'protector de calor para cabello' },
        { tipo: 'cepillo', etiqueta: 'Cepillo', peso: 0.25, palabras: /^(cepillo|peine)\b/, excluye: /aire|alaciador|secador|electrico|dental|dientes/, buscar: 'cepillo para cabello' }
      ]
    },
    {
      id: 'barberia', nombre: 'Rasuradoras y recortadoras', servicio: true, sinSubidaDeModelo: true,
      migas: /barberia|rasuradoras?|recortadoras?|afeitadoras?|cuidado personal masculino/,
      producto: /rasuradora|recortadora|afeitadora|trimmer/,
      titulo: /^(rasuradora|recortadora|afeitadora|trimmer|maquina para cortar cabello|cortadora de cabello)\b/,
      complementos: [
        // «Tratamiento para barba Aceite…», «Kit shampoo para barba y aceite» (búsqueda, 04/10/2026).
        { tipo: 'aceite', etiqueta: 'Aceite para barba', peso: 0.55, palabras: /^(aceite|balsamo|serum|tratamiento|kit)\b/, requiere: /barba/, buscar: 'aceite para barba' },
        { tipo: 'aftershave', etiqueta: 'After shave', peso: 0.50, palabras: /^(after ?shave|locion (para despues|after)|balsamo after)\b/, buscar: 'after shave' },
        { tipo: 'repuesto', etiqueta: 'Cuchillas de repuesto', peso: 0.45, palabras: /^(cuchillas?|cabezales?|repuestos?|navajas?)\b/, mismaMarca: true, buscar: 'cuchillas de repuesto {marca}' },
        { tipo: 'pomada', etiqueta: 'Pomada o cera', peso: 0.35, palabras: /^(pomada|cera|gel fijador)\b/, buscar: 'pomada para cabello' },
        { tipo: 'perfume', etiqueta: 'Perfume', peso: 0.30, palabras: /^(eau de (toilette|parfum)|perfume|colonia)\b/, si: /hombre|caballero|barba/, topePrecio: 2, buscar: 'perfume para hombre' }
      ]
    },
    {
      id: 'bucal', nombre: 'Cuidado bucal', servicio: true, sinSubidaDeModelo: true,
      migas: /cuidado bucal|cepillos? (de dientes|dentales?)|blanqueadores? (bucales|dentales)|higiene bucal/,
      producto: /cepillo (dental|de dientes)|irrigador/,
      titulo: /^(cepillo (dental|de dientes)( electrico)?|irrigador)\b/,
      complementos: [
        { tipo: 'cabezales', etiqueta: 'Cabezales de repuesto', peso: 0.80, palabras: /^(cabezales?|repuestos?|recambios?)\b/, mismaMarca: true, buscar: 'cabezales de repuesto {marca}' },
        { tipo: 'pasta', etiqueta: 'Pasta dental', peso: 0.50, palabras: /^(pasta dental|crema dental|dentifrico)\b/, buscar: 'pasta dental' },
        { tipo: 'blanqueador', etiqueta: 'Blanqueador', peso: 0.40, palabras: /^(blanqueador|kit blanqueador|tiras blanqueadoras)\b/, buscar: 'blanqueador dental' },
        { tipo: 'irrigador', etiqueta: 'Irrigador', peso: 0.35, palabras: /^(irrigador|hilo dental)\b/, si: /^cepillo/, buscar: 'irrigador dental' }
      ]
    }
  ]
};
