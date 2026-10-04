/**
 * =============================================================================
 * Ventel · Vende más — la base de reglas (reglas-venta.js)
 * =============================================================================
 * Qué complementos tiene sentido ofrecer con cada tipo de artículo. Sale de la
 * tabla de la investigación de venta cruzada (octubre de 2026), recortada a lo
 * que la tarjeta usa hoy:
 *
 *   · reconocer de qué TIPO es el artículo de la ficha (celular, pantalla…);
 *   · dar a cada complemento de Liverpool su TIPO, para no enseñar tres fundas
 *     (una por tipo, como en P-Companion de Amazon: tipo → artículo → variedad);
 *   · proponer una BÚSQUEDA en liverpool.com.mx para el tipo que Liverpool no
 *     trajo en sus carruseles (la mica que nadie sugirió).
 *
 * Los candidatos NO salen de aquí: salen de los carruseles que la propia ficha
 * ya pinta («Complementa con», «Otros clientes compraron»). Esta base solo
 * ordena y rellena huecos; la extensión no hace búsquedas automáticas.
 *
 * Las expresiones se aplican sobre texto en minúsculas y sin acentos.
 *   migas     → la ÚLTIMA miga de la ficha («Celulares», «Protectores Solares»).
 *               Las primeras pueden ser una campaña («Regreso a Clases»).
 *   producto  → la característica «Producto» / «Tipo de producto».
 *   titulo    → el principio del nombre. Va anclado a propósito: «Funda para
 *               iPhone» no es un iPhone.
 *   palabras  → de qué tipo es un complemento. Solo cuenta si la palabra EMPIEZA
 *               en las dos primeras del nombre, que en Liverpool son el
 *               sustantivo: «Labial brillante Sérum Rose» es un labial, no un
 *               sérum (pasó en la ficha del protector solar, 04/10/2026).
 *   peso      → qué tan natural es ofrecerlo (0 a 1). Ordena los tipos.
 *   buscar    → plantilla de la búsqueda sugerida. {modelo}, {marca},
 *               {pulgadas}, {plataforma} y {tamano} salen de la ficha; si falta
 *               alguno, esa búsqueda no se propone.
 *   si        → (opcional) el complemento solo aplica si el nombre casa con esto.
 *   sustitutoPorTipo → en esta clase los complementos son de la misma familia
 *               (un sérum con un protector solar): el sustituto es el que tiene
 *               el MISMO tipo, no la misma clase.
 *
 * Es un content script más: define un global en el mundo aislado y nada más.
 * Hecho para Ventel · v1.0 · 04/10/2026
 */

var VENTEL_REGLAS = {
  version: 1,

  // Subida a OTRO modelo (de «Artículos relacionados»): hasta un 25 % más caro,
  // un 35 % en ticket alto, donde los meses sin intereses lo suavizan. Es una
  // regla de la industria, no un dato: se calibra con lo que acepte el cliente.
  // La subida dentro de la MISMA ficha (128 → 512 GB) no tiene tope.
  subida: { tope: 0.25, topeAlto: 0.35, ticketAlto: 10000 },

  clases: [
    {
      id: 'smartphone', nombre: 'Celulares', servicio: true, dispositivo: true,
      migas: /celular|smartphone|telefonia/,
      producto: /smartphone|celular|telefono/,
      titulo: /^(iphone|galaxy [asz]?\d|smartphone|celular|moto [eg]\d|motorola|redmi|xiaomi|pixel|honor|oppo|realme|zte|huawei)\b/,
      complementos: [
        { tipo: 'funda', etiqueta: 'Funda', peso: 0.85, palabras: /\b(funda|case|carcasa|estuche)\b/, buscar: 'funda {modelo}' },
        { tipo: 'mica', etiqueta: 'Mica', peso: 0.80, palabras: /\b(mica|protector|cristal templado|vidrio templado)\b/, buscar: 'mica {modelo}' },
        { tipo: 'cargador', etiqueta: 'Cargador', peso: 0.65, palabras: /\b(cargador|adaptador|cubo)\b/, buscar: 'cargador usb c {marca}' },
        { tipo: 'audifonos', etiqueta: 'Audífonos', peso: 0.55, palabras: /\b(audifonos|airpods|buds|earbuds)\b/, buscar: 'audifonos inalambricos {marca}' },
        { tipo: 'bateria', etiqueta: 'Batería portátil', peso: 0.45, palabras: /\b(bateria|power ?bank)\b/, buscar: 'bateria portatil' },
        { tipo: 'reloj', etiqueta: 'Smartwatch', peso: 0.40, palabras: /\b(smartwatch|reloj|apple watch|galaxy watch)\b/, buscar: 'smartwatch {marca}' }
      ]
    },
    {
      id: 'tablet', nombre: 'Tablets', servicio: true, dispositivo: true,
      migas: /tablet|ipad/,
      producto: /tablet|ipad/,
      titulo: /^(ipad|tablet|galaxy tab|matepad|redmi pad|xiaomi pad)\b/,
      complementos: [
        { tipo: 'funda', etiqueta: 'Funda', peso: 0.80, palabras: /\b(funda|case|carcasa|folio|estuche)\b/, buscar: 'funda {modelo}' },
        { tipo: 'mica', etiqueta: 'Mica', peso: 0.70, palabras: /\b(mica|protector|cristal templado)\b/, buscar: 'mica {modelo}' },
        { tipo: 'lapiz', etiqueta: 'Lápiz', peso: 0.55, palabras: /\b(lapiz|pencil|stylus|pluma)\b/, buscar: 'lapiz {marca}' },
        { tipo: 'teclado', etiqueta: 'Teclado', peso: 0.50, palabras: /\bteclado\b/, buscar: 'teclado {modelo}' },
        { tipo: 'cargador', etiqueta: 'Cargador', peso: 0.45, palabras: /\b(cargador|adaptador)\b/, buscar: 'cargador usb c {marca}' }
      ]
    },
    {
      id: 'laptop', nombre: 'Laptops', servicio: true,
      migas: /laptop|computadoras? portatil|notebook|macbook/,
      producto: /laptop|portatil|notebook/,
      titulo: /^(laptop|macbook|notebook|chromebook|computadora portatil)\b/,
      complementos: [
        { tipo: 'mouse', etiqueta: 'Mouse', peso: 0.70, palabras: /\b(mouse|raton)\b/, buscar: 'mouse inalambrico' },
        { tipo: 'mochila', etiqueta: 'Mochila', peso: 0.70, palabras: /\b(mochila|funda|maletin|portafolio)\b/, buscar: 'mochila para laptop {pulgadas} pulgadas' },
        { tipo: 'almacenamiento', etiqueta: 'Disco externo', peso: 0.45, palabras: /\b(disco|ssd|memoria)\b/, buscar: 'disco duro externo' },
        { tipo: 'audifonos', etiqueta: 'Audífonos', peso: 0.40, palabras: /\b(audifonos|diadema)\b/, buscar: 'audifonos inalambricos' },
        { tipo: 'hub', etiqueta: 'Adaptador', peso: 0.35, palabras: /\b(hub|adaptador|docking)\b/, buscar: 'hub usb c' }
      ]
    },
    {
      id: 'tv', nombre: 'Pantallas', servicio: true,
      migas: /televisiones|pantallas?$|smart tv/,
      producto: /pantalla|television|smart tv/,
      titulo: /^(pantalla|smart tv|television|tv\b)/,
      complementos: [
        { tipo: 'soporte', etiqueta: 'Soporte', peso: 0.80, palabras: /\bsoporte\b/, buscar: 'soporte para pantalla {pulgadas} pulgadas' },
        { tipo: 'barra', etiqueta: 'Barra de sonido', peso: 0.75, palabras: /\b(barra|soundbar|teatro)\b/, buscar: 'barra de sonido {marca}' },
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.60, palabras: /\b(regulador|no ?break|supresor)\b/, buscar: 'regulador de voltaje' },
        { tipo: 'streaming', etiqueta: 'Streaming', peso: 0.40, palabras: /\b(roku|fire tv|chromecast|apple tv|reproductor)\b/, buscar: 'reproductor streaming' },
        { tipo: 'cable', etiqueta: 'Cable HDMI', peso: 0.35, palabras: /\b(cable|hdmi)\b/, buscar: 'cable hdmi' }
      ]
    },
    {
      id: 'consola', nombre: 'Consolas', servicio: true,
      migas: /consolas?/,
      producto: /consola/,
      titulo: /^(consola|playstation|xbox|nintendo switch)\b/,
      complementos: [
        { tipo: 'control', etiqueta: 'Control', peso: 0.85, palabras: /\b(control|joy-?con|dualsense|gamepad)\b/, buscar: 'control {plataforma}' },
        { tipo: 'juego', etiqueta: 'Videojuego', peso: 0.75, palabras: /\b(juego|videojuego)\b/, buscar: 'juego {plataforma}' },
        { tipo: 'audifonos', etiqueta: 'Audífonos gamer', peso: 0.45, palabras: /\b(audifonos|diadema|headset)\b/, buscar: 'audifonos gamer {plataforma}' },
        { tipo: 'base', etiqueta: 'Base de carga', peso: 0.35, palabras: /\b(base|estacion|cargador)\b/, buscar: 'base de carga {plataforma}' }
      ]
    },
    {
      id: 'lineaBlanca', nombre: 'Línea blanca', servicio: true,
      migas: /refrigeradores?|lavadoras?|secadoras?|estufas?|linea blanca|lavavajillas|congeladores?|centros? de lavado/,
      producto: /refrigerador|lavadora|secadora|estufa|lavavajillas|congelador|centro de lavado/,
      titulo: /^(refrigerador|lavadora|secadora|estufa|lavavajillas|congelador|centro de lavado|parrilla)\b/,
      complementos: [
        { tipo: 'regulador', etiqueta: 'Regulador', peso: 0.60, palabras: /\b(regulador|protector|no ?break)\b/, buscar: 'regulador para refrigerador' },
        { tipo: 'secadora', etiqueta: 'Secadora', peso: 0.55, palabras: /\bsecadora\b/, buscar: 'secadora {marca}', si: /^lavadora/ },
        { tipo: 'lavadora', etiqueta: 'Lavadora', peso: 0.55, palabras: /\blavadora\b/, buscar: 'lavadora {marca}', si: /^secadora/ },
        { tipo: 'base', etiqueta: 'Base', peso: 0.40, palabras: /\b(base|pedestal|kit)\b/, buscar: 'base para lavadora' }
      ]
    },
    {
      id: 'colchon', nombre: 'Colchones',
      migas: /colchon/,
      producto: /colchon/,
      titulo: /^(colchon|juego de colchon)\b/,
      complementos: [
        { tipo: 'protector', etiqueta: 'Protector', peso: 0.80, palabras: /\bprotector\b/, buscar: 'protector de colchon {tamano}' },
        { tipo: 'almohada', etiqueta: 'Almohadas', peso: 0.70, palabras: /\balmohada/, buscar: 'almohada' },
        { tipo: 'box', etiqueta: 'Base / box', peso: 0.65, palabras: /\b(box|base|bambalinero)\b/, buscar: 'box {tamano}', si: /^colchon/ },
        { tipo: 'sabanas', etiqueta: 'Sábanas', peso: 0.55, palabras: /\b(sabana|juego de sabanas)/, buscar: 'juego de sabanas {tamano}' }
      ]
    },
    {
      id: 'perfume', nombre: 'Perfumes',
      migas: /perfume|fragancia/,
      producto: /perfume|fragancia|eau de|colonia/,
      titulo: /^(perfume|eau de (parfum|toilette)|fragancia|colonia|locion)\b/,
      complementos: [
        { tipo: 'set', etiqueta: 'Set', peso: 0.65, palabras: /\b(set|estuche|kit|coffret)\b/, buscar: 'set {marca}' },
        { tipo: 'corporal', etiqueta: 'Línea corporal', peso: 0.55, palabras: /\b(body|corporal|crema|locion|desodorante|gel)\b/, buscar: 'crema corporal {marca}' }
      ]
    },
    {
      id: 'carriola', nombre: 'Carriolas',
      migas: /carriola/,
      producto: /carriola/,
      titulo: /^(carriola|sistema de viaje|travel system)\b/,
      complementos: [
        { tipo: 'autoasiento', etiqueta: 'Autoasiento', peso: 0.80, palabras: /\b(autoasiento|portabebe|car ?seat)\b/, buscar: 'autoasiento {marca}' },
        { tipo: 'panalera', etiqueta: 'Pañalera', peso: 0.40, palabras: /\b(panalera|organizador)\b/, buscar: 'panalera' }
      ]
    },
    {
      id: 'cuidadoFacial', nombre: 'Cuidado facial', sustitutoPorTipo: true,
      migas: /protectores? solares?|cuidado facial|cuidado de la piel|dermocosmetic|tratamiento facial|limpieza facial/,
      producto: /protector solar|bloqueador|serum|crema facial|limpiador|agua termal/,
      titulo: /^(protector solar|bloqueador|fotoprotector|serum|crema facial|limpiador|agua termal|tratamiento|contorno de ojos)\b/,
      complementos: [
        { tipo: 'serum', etiqueta: 'Sérum', peso: 0.60, palabras: /\bserum\b/, buscar: 'serum facial {marca}' },
        { tipo: 'solar', etiqueta: 'Protector solar', peso: 0.45, palabras: /\b(protector solar|bloqueador|fotoprotector|fluido solar)\b/, buscar: 'protector solar facial' },
        { tipo: 'hidratante', etiqueta: 'Hidratante', peso: 0.55, palabras: /\b(crema|hidratante|emulsion)\b/, buscar: 'crema hidratante facial {marca}' },
        { tipo: 'limpiador', etiqueta: 'Limpiador', peso: 0.50, palabras: /\b(limpiador|agua micelar|gel limpiador|desmaquillante|espuma)\b/, buscar: 'limpiador facial {marca}' },
        { tipo: 'aguaTermal', etiqueta: 'Agua termal', peso: 0.45, palabras: /\bagua termal\b/, buscar: 'agua termal' },
        { tipo: 'ojos', etiqueta: 'Contorno de ojos', peso: 0.35, palabras: /\bcontorno\b/, buscar: 'contorno de ojos {marca}' }
      ]
    },
    {
      id: 'calzado', nombre: 'Calzado',
      migas: /tenis|zapatos?|calzado|botas?|sandalias?/,
      producto: /tenis|zapato|calzado|bota|sandalia/,
      titulo: /^(tenis|zapato|bota|botin|sandalia|mocasin|flats?)\b/,
      complementos: [
        { tipo: 'calcetines', etiqueta: 'Calcetines', peso: 0.55, palabras: /\b(calcetin|calceta|tines)/, buscar: 'calcetines {marca}' },
        { tipo: 'limpieza', etiqueta: 'Limpieza', peso: 0.40, palabras: /\b(limpiador|kit|impermeabilizante)\b/, buscar: 'limpiador de tenis' }
      ]
    }
  ]
};
