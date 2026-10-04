/**
 * =============================================================================
 * Ventel · Vende más — la base de reglas (reglas-venta.js)
 * =============================================================================
 * Qué complementos tiene sentido ofrecer con cada tipo de artículo. Sale de la
 * tabla de la investigación de venta cruzada (octubre de 2026) y de medir la
 * tarjeta contra fichas reales de 15 categorías (03/10/2026).
 *
 * Para qué sirve:
 *   · reconocer de qué TIPO es el artículo de la ficha (celular, pantalla…);
 *   · dar a cada candidato su TIPO, para no enseñar tres fundas (una por tipo,
 *     como en P-Companion de Amazon: tipo → artículo → variedad);
 *   · armar la BÚSQUEDA en liverpool.com.mx del tipo que los carruseles no
 *     trajeron bien (la mica, la secadora que hace par, el set de la misma
 *     fragancia). Esa búsqueda la hace la extensión desde la propia ficha.
 *
 * Las expresiones se aplican sobre texto en minúsculas y sin acentos.
 *   migas     → la ÚLTIMA miga de la ficha. Las primeras pueden ser una campaña.
 *   producto  → la característica «Producto» / «Tipo de producto».
 *   titulo    → el principio del nombre (anclado: «Funda para iPhone» no es un iPhone).
 *   palabras  → de qué tipo es un candidato. VA ANCLADO AL PRINCIPIO DEL NOMBRE:
 *               en Liverpool el nombre empieza por el sustantivo. Sin el ancla,
 *               «Funda para secadora» era una secadora y «Labial brillante
 *               Sérum» un sérum (los dos pasaron en fichas reales).
 *   requiere  → (opcional) además tiene que decir esto en algún lado
 *               (una mochila para la laptop dice laptop, portalaptop, computadora…).
 *   excluye   → (opcional) y no puede decir esto (la micro SD no es disco externo).
 *   peso      → qué tan natural es ofrecerlo (0 a 1). Ordena los tipos.
 *   buscar    → plantilla de la búsqueda. {modelo}, {marca}, {pulgadas},
 *               {plataforma}, {tamano}, {linea} y {genero} salen de la ficha; si
 *               falta alguno, esa búsqueda no se hace.
 *   si        → (opcional) el tipo solo aplica si el nombre de la ficha casa con esto.
 *   exacto    → (opcional) sin el MISMO modelo no sirve (fundas, micas): si los
 *               carruseles no lo traen exacto, se busca.
 *   mismaMarca, mismaLinea, mismoTamano, mismoGenero → candados de compatibilidad
 *               que el núcleo comprueba con los datos de la ficha.
 * Y por clase:
 *   sustitutoPorTipo   → los complementos son de la misma familia (sérum y
 *                        protector solar): el sustituto es el del MISMO tipo.
 *   sinSubidaDeModelo  → otro artículo no es «subir la versión» (otro perfume,
 *                        otros tenis): solo cuenta la capacidad de la misma ficha.
 *
 * Es un content script más: define un global en el mundo aislado y nada más.
 * Hecho para Ventel · v2.0 · 03/10/2026
 */

var VENTEL_REGLAS = {
  version: 2,

  // Subida a OTRO modelo (de «Artículos relacionados»): hasta un 25 % más caro,
  // un 35 % en ticket alto, donde los meses sin intereses lo suavizan. La subida
  // dentro de la MISMA ficha (128 → 512 GB) no tiene tope.
  subida: { tope: 0.25, topeAlto: 0.35, ticketAlto: 10000 },

  // Un complemento no debería costar más del doble del artículo (un tratamiento
  // de $7,050 junto a un protector solar de $650). Un tipo puede subirlo.
  topePrecio: 2,

  clases: [
    {
      id: 'smartphone', nombre: 'Celulares', servicio: true, dispositivo: true,
      migas: /celular|smartphone|telefonia/,
      producto: /smartphone|celular|telefono/,
      titulo: /^(iphone|galaxy [asz]?\d|smartphone|celular|moto [eg]\d|motorola|redmi|xiaomi|pixel|honor|oppo|realme|zte|huawei)\b/,
      complementos: [
        { tipo: 'funda', etiqueta: 'Funda', peso: 0.85, palabras: /^(funda|case|carcasa|estuche)\b/, exacto: true, buscar: 'funda {modelo}' },
        { tipo: 'mica', etiqueta: 'Mica', peso: 0.80, palabras: /^(mica|protector|cristal templado|vidrio templado)\b/, exacto: true, buscar: 'mica {modelo}' },
        { tipo: 'cargador', etiqueta: 'Cargador', peso: 0.65, palabras: /^(cargador|adaptador|cubo|cable)\b/, buscar: 'cargador usb c {marca}' },
        { tipo: 'audifonos', etiqueta: 'Audífonos', peso: 0.55, palabras: /^(audifonos|airpods|buds|earbuds)\b/, buscar: 'audífonos inalámbricos {marca}' },
        { tipo: 'bateria', etiqueta: 'Batería portátil', peso: 0.45, palabras: /^(bateria|power ?bank)\b/, buscar: 'batería portátil' },
        { tipo: 'reloj', etiqueta: 'Smartwatch', peso: 0.40, palabras: /^(smartwatch|reloj|apple watch|galaxy watch)\b/, buscar: 'smartwatch {marca}' }
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
        { tipo: 'lapiz', etiqueta: 'Lápiz', peso: 0.55, palabras: /^(lapiz|pencil|stylus|pluma)\b/, buscar: 'lápiz {marca}' },
        { tipo: 'teclado', etiqueta: 'Teclado', peso: 0.50, palabras: /^teclado\b/, buscar: 'teclado {modelo}' },
        { tipo: 'cargador', etiqueta: 'Cargador', peso: 0.45, palabras: /^(cargador|adaptador)\b/, buscar: 'cargador usb c {marca}' }
      ]
    },
    {
      id: 'laptop', nombre: 'Laptops', servicio: true,
      migas: /laptop|computadoras? portatil|notebook|macbook/,
      producto: /laptop|portatil|notebook/,
      titulo: /^(laptop|macbook|notebook|chromebook|computadora portatil)\b/,
      complementos: [
        { tipo: 'mouse', etiqueta: 'Mouse', peso: 0.70, palabras: /^(mouse|raton)\b/, buscar: 'mouse inalámbrico' },
        { tipo: 'mochila', etiqueta: 'Mochila', peso: 0.70, palabras: /^(mochila|maletin|portafolio|funda)\b/,
          requiere: /laptop|portatil|computadora|notebook|macbook/, buscar: 'mochila para laptop {pulgadas} pulgadas' },
        { tipo: 'almacenamiento', etiqueta: 'Disco externo', peso: 0.45, palabras: /^(disco|ssd|memoria usb|unidad)\b/, excluye: /micro ?sd/, buscar: 'disco duro externo' },
        { tipo: 'audifonos', etiqueta: 'Audífonos', peso: 0.40, palabras: /^(audifonos|diadema)\b/, buscar: 'audífonos inalámbricos' },
        { tipo: 'hub', etiqueta: 'Adaptador', peso: 0.35, palabras: /^(hub|adaptador|docking)\b/, buscar: 'hub usb c' }
      ]
    },
    {
      id: 'tv', nombre: 'Pantallas', servicio: true,
      migas: /televisiones|pantallas?$|smart tv/,
      producto: /pantalla|television|smart tv/,
      titulo: /^(pantalla|smart tv|television|tv\b)/,
      complementos: [
        { tipo: 'soporte', etiqueta: 'Soporte', peso: 0.80, palabras: /^soporte\b/, requiere: /pantalla|tv|television|pulgadas/, buscar: 'soporte para pantalla {pulgadas} pulgadas' },
        { tipo: 'barra', etiqueta: 'Barra de sonido', peso: 0.75, palabras: /^(barra|soundbar|teatro)\b/, buscar: 'barra de sonido {marca}' },
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.60, palabras: /^(regulador|no ?break|supresor)\b/, buscar: 'regulador de voltaje' },
        { tipo: 'streaming', etiqueta: 'Streaming', peso: 0.40, palabras: /^(roku|fire tv|chromecast|apple tv|reproductor)\b/, buscar: 'reproductor streaming' },
        { tipo: 'cable', etiqueta: 'Cable HDMI', peso: 0.35, palabras: /^cable\b/, requiere: /hdmi/, buscar: 'cable hdmi' }
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
        { tipo: 'juego', etiqueta: 'Videojuego', peso: 0.75, palabras: /^(juego|videojuego)\b|\bpara (ps5|ps4|playstation \d|xbox series [xs]|xbox one|nintendo switch 2?|switch 2?)$/, buscar: 'juego {plataforma}' }
      ]
    },
    {
      id: 'refrigerador', nombre: 'Refrigeradores', servicio: true,
      migas: /refrigeradores?|congeladores?|frigobar/,
      producto: /refrigerador|congelador|duplex|french door|frigobar/,
      titulo: /^(refrigerador|congelador|frigobar)\b/,
      complementos: [
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.60, palabras: /^(regulador|protector de voltaje|no ?break|supresor)\b/, buscar: 'regulador para refrigerador' },
        { tipo: 'filtro', etiqueta: 'Filtro de agua', peso: 0.35, palabras: /^filtro\b/, requiere: /agua|refrigerador/, mismaMarca: true, buscar: 'filtro de agua para refrigerador {marca}' }
      ]
    },
    {
      id: 'lavadora', nombre: 'Lavadoras', servicio: true,
      migas: /lavadoras?$|lavado y secado/,
      producto: /^lavadora/,
      titulo: /^lavadora\b/,
      complementos: [
        { tipo: 'secadora', etiqueta: 'Secadora', peso: 0.60, palabras: /^secadora\b/, par: true, buscar: 'secadora {marca}' },
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.50, palabras: /^(regulador|protector de voltaje|no ?break|supresor)\b/, buscar: 'regulador para lavadora' },
        { tipo: 'base', etiqueta: 'Pedestal', peso: 0.40, palabras: /^(pedestal|base|kit)\b/, mismaMarca: true, buscar: 'pedestal para lavadora {marca}' }
      ]
    },
    {
      id: 'secadora', nombre: 'Secadoras', servicio: true,
      migas: /secadoras?$/,
      producto: /^secadora/,
      titulo: /^secadora\b/,
      complementos: [
        { tipo: 'lavadora', etiqueta: 'Lavadora', peso: 0.60, palabras: /^lavadora\b/, par: true, buscar: 'lavadora {marca}' },
        { tipo: 'base', etiqueta: 'Kit de apilado', peso: 0.45, palabras: /^(pedestal|base|kit)\b/, mismaMarca: true, buscar: 'kit de apilado {marca}' },
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.40, palabras: /^(regulador|protector de voltaje|no ?break|supresor)\b/, buscar: 'regulador para lavadora' }
      ]
    },
    {
      id: 'estufa', nombre: 'Estufas', servicio: true,
      migas: /estufas?|parrillas?|cocinas? integral/,
      producto: /estufa|parrilla/,
      titulo: /^(estufa|parrilla|cocina integral)\b/,
      complementos: [
        { tipo: 'campana', etiqueta: 'Campana', peso: 0.55, palabras: /^(campana|extractor)\b/, buscar: 'campana {marca}' },
        { tipo: 'bateria', etiqueta: 'Batería de cocina', peso: 0.35, palabras: /^(bateria de cocina|juego de sartenes|sarten)\b/, buscar: 'batería de cocina' }
      ]
    },
    {
      id: 'colchon', nombre: 'Colchones',
      migas: /colchon/,
      producto: /colchon/,
      titulo: /^(colchon|juego de colchon)\b/,
      complementos: [
        { tipo: 'protector', etiqueta: 'Protector', peso: 0.80, palabras: /^protector\b/, mismoTamano: true, buscar: 'protector de colchón {tamano}' },
        { tipo: 'almohada', etiqueta: 'Almohadas', peso: 0.70, palabras: /^almohada/, buscar: 'almohada' },
        { tipo: 'box', etiqueta: 'Base / box', peso: 0.65, palabras: /^(box|base|bambalinero)\b/, mismoTamano: true, si: /^colchon/, buscar: 'box {tamano}' },
        { tipo: 'sabanas', etiqueta: 'Sábanas', peso: 0.55, palabras: /^(sabana|juego de sabanas)/, mismoTamano: true, buscar: 'juego de sábanas {tamano}' }
      ]
    },
    {
      id: 'perfume', nombre: 'Perfumes', sinSubidaDeModelo: true,
      migas: /perfume|fragancia/,
      producto: /perfume|fragancia|eau de|colonia/,
      titulo: /^(perfume|eau de (parfum|toilette)|fragancia|colonia|locion)\b/,
      complementos: [
        { tipo: 'set', etiqueta: 'Set', peso: 0.65, palabras: /^(set|kit|estuche|coffret)\b/, mismaLinea: true, buscar: 'set {linea} {marca}' },
        { tipo: 'corporal', etiqueta: 'Línea corporal', peso: 0.55, palabras: /^(body|crema|locion corporal|leche corporal|desodorante|gel|balsamo corporal|aceite corporal|bruma)\b/,
          mismaMarca: true, buscar: 'crema corporal {linea} {marca}' }
      ]
    },
    {
      id: 'carriola', nombre: 'Carriolas',
      migas: /carriola/,
      producto: /carriola/,
      titulo: /^(carriola|sistema de viaje|travel system)\b/,
      complementos: [
        { tipo: 'autoasiento', etiqueta: 'Autoasiento', peso: 0.80, palabras: /^(autoasiento|portabebe|car ?seat)\b/, buscar: 'autoasiento {marca}' },
        { tipo: 'panalera', etiqueta: 'Pañalera', peso: 0.40, palabras: /^(panalera|organizador)\b/, buscar: 'pañalera' }
      ]
    },
    {
      id: 'cuidadoFacial', nombre: 'Cuidado facial', sustitutoPorTipo: true, sinSubidaDeModelo: true,
      migas: /protectores? solares?|cuidado facial|cuidado de la piel|dermocosmetic|tratamiento facial|limpieza facial/,
      producto: /protector solar|bloqueador|serum|crema facial|limpiador|agua termal/,
      titulo: /^(protector solar|bloqueador|fotoprotector|serum|crema facial|limpiador|agua termal|tratamiento|contorno de ojos)\b/,
      complementos: [
        { tipo: 'serum', etiqueta: 'Sérum', peso: 0.60, palabras: /^serum\b/, buscar: 'sérum facial {marca}' },
        { tipo: 'solar', etiqueta: 'Protector solar', peso: 0.45, palabras: /^(protector solar|bloqueador|fotoprotector|fluido solar)\b/, buscar: 'protector solar facial' },
        { tipo: 'hidratante', etiqueta: 'Hidratante', peso: 0.55, palabras: /^(crema|hidratante|emulsion)\b/, buscar: 'crema hidratante facial {marca}' },
        { tipo: 'limpiador', etiqueta: 'Limpiador', peso: 0.50, palabras: /^(limpiador|agua micelar|gel limpiador|desmaquillante|espuma|jabon)\b/, buscar: 'limpiador facial {marca}' },
        { tipo: 'aguaTermal', etiqueta: 'Agua termal', peso: 0.45, palabras: /^agua termal\b/, buscar: 'agua termal' },
        { tipo: 'ojos', etiqueta: 'Contorno de ojos', peso: 0.35, palabras: /^contorno\b/, buscar: 'contorno de ojos {marca}' },
        { tipo: 'tonico', etiqueta: 'Tónico', peso: 0.30, palabras: /^(tonico|esencia)\b/, buscar: 'tónico facial {marca}' }
      ]
    },
    {
      id: 'audio', nombre: 'Audio', servicio: true,
      migas: /audifonos|bocinas?$|audio/,
      producto: /audifonos|bocina/,
      titulo: /^(audifonos|bocina)\b/,
      complementos: [
        { tipo: 'estuche', etiqueta: 'Estuche', peso: 0.50, palabras: /^(estuche|funda|porta ?audifonos|soporte para audifonos)\b/, buscar: 'estuche para audífonos {marca}' },
        { tipo: 'cargador', etiqueta: 'Cargador', peso: 0.40, palabras: /^(cargador|adaptador|cable)\b/, buscar: 'cargador usb c' }
      ]
    },
    {
      id: 'calzado', nombre: 'Calzado', sinSubidaDeModelo: true, moda: true,
      migas: /tenis|zapatos?|calzado|botas?|sandalias?/,
      producto: /tenis|zapato|calzado|bota|sandalia/,
      titulo: /^(tenis|zapato|bota|botin|sandalia|mocasin|flats?)\b/,
      complementos: [
        { tipo: 'calcetines', etiqueta: 'Calcetines', peso: 0.60, palabras: /^(set de |paquete de )?(calcetin|calceta|tines)/, mismoGenero: true, buscar: 'calcetines {marca} {genero}' },
        { tipo: 'playera', etiqueta: 'Playera', peso: 0.50, palabras: /^(playera|camiseta|jersey)\b/, mismoGenero: true, buscar: 'playera {marca} {genero}' },
        { tipo: 'pants', etiqueta: 'Pants o short', peso: 0.45, palabras: /^(pants|short|jogger|pantalon deportivo|leggings|mallas)\b/, mismoGenero: true, buscar: 'pants {marca} {genero}' },
        { tipo: 'mochila', etiqueta: 'Mochila', peso: 0.35, palabras: /^mochila\b/, buscar: 'mochila {marca}' },
        { tipo: 'gorra', etiqueta: 'Gorra', peso: 0.30, palabras: /^(gorra|cachucha|visera)\b/, buscar: 'gorra {marca}' }
      ]
    },
    {
      id: 'ropa', nombre: 'Ropa', sinSubidaDeModelo: true, moda: true,
      migas: /playeras?|camisas?|blusas?|sudaderas?|chamarras?|pantalones?|jeans|shorts?|faldas?|vestidos?/,
      producto: /playera|camisa|blusa|sudadera|chamarra|pantalon|jeans|short|falda|vestido|polo/,
      titulo: /^(playera|camisa|blusa|sudadera|chamarra|pantalon|jeans|short|falda|vestido|polo)\b/,
      complementos: [
        { tipo: 'inferior', etiqueta: 'Pantalón', peso: 0.55, palabras: /^(pantalon|jeans|short|bermuda|falda)\b/, mismoGenero: true,
          si: /^(playera|camisa|blusa|sudadera|chamarra|polo)/, buscar: 'jeans {marca} {genero}' },
        { tipo: 'superior', etiqueta: 'Playera o camisa', peso: 0.55, palabras: /^(playera|camisa|blusa|polo|top)\b/, mismoGenero: true,
          si: /^(pantalon|jeans|short|bermuda|falda)/, buscar: 'playera {marca} {genero}' },
        { tipo: 'calzado', etiqueta: 'Tenis o zapatos', peso: 0.45, palabras: /^(tenis|zapatos?|botas?|botin|sandalias?|mocasin)\b/, mismoGenero: true, buscar: 'tenis {marca} {genero}' },
        { tipo: 'cinturon', etiqueta: 'Cinturón', peso: 0.35, palabras: /^cinturon\b/, mismoGenero: true, si: /^(pantalon|jeans|short|bermuda)/, buscar: 'cinturón {genero}' },
        { tipo: 'gorra', etiqueta: 'Gorra', peso: 0.30, palabras: /^(gorra|cachucha)\b/, buscar: 'gorra {marca}' }
      ]
    }
  ]
};
