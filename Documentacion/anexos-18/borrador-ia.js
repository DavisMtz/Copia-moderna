var CLASES_IA = [
  {
    id: 'muneca', nombre: 'Muñecas',
    migas: /^munecas?\b(?!.*\b(accesorios|ropa|casas?|muebles)\b)|^munecos? bebe\b/,
    producto: /^munecas?\b|^munecos? bebe\b/,
    titulo: /^munecas?\b|^munecos? (bebe|ken)\b|^muneco\b(?=.*\b(barbie|ken|bebe|nenuco|baby|reborn|ksi ?meritos?)\b)|^(barbie|rainbow high|monster high|bratz|baby alive|nenuco|cry babies|l\.?o\.?l\.?( surprise)?)\b(?=.*\bmuneca\b)/,
    noEs: /^munec[ao]s? (de (peluche|nieve|accion|porcelana|ventrilocuo)|inflables?|navidenos?|decorativ[ao]s?|rusas?)\b/,
    complementos: [
      // La ropa es la compra de cajón: le cambia el look sin comprar otra muñeca.
      { tipo: 'ropa', etiqueta: 'Ropa para muñeca', peso: 0.65, palabras: /^((set|paquete|kit|pack) de )?(ropa|ropita|vestidos?|vestuario|moda|outfits?|guardarropa|closet)\b/, requiere: /muneca|doll|barbie|rainbow high|bratz|monster high|nenuco|baby alive|polly|\bl\.?o\.?l\b/, excluye: /\btalla\b|para (nina|nino|mujer|hombre)\b/, buscar: 'ropa para muñeca' },
      // Al bebé de juguete se le «cuida»: carriola, cuna o silla son su pareja natural.
      { tipo: 'carriola', etiqueta: 'Carriola o cuna para muñeca', peso: 0.60, palabras: /^(carriola|cuna|silla|sillita|portabebe|panalera|corral|columpio|tina|banera|cambiador)\b/, requiere: /munec[ao]s?|de juguete/, si: /\bbebe|nenuco|baby|reborn|ksi ?merito|cry ?bab|neonato|recien nacid/, buscar: 'carriola para muñeca' },
      // Muebles y sets de accesorios arman la escena sin ser otra muñeca.
      { tipo: 'accesorios', etiqueta: 'Accesorios y set de juego', peso: 0.50, palabras: /^((set|kit|paquete) de )?(accesorios|muebles|mobiliario)\b|^(set de juego|playset)\b/, requiere: /muneca|barbie|doll|polly|rainbow high|bratz|monster high|\bl\.?o\.?l\b/, excluye: /cabello|pelo|celular|\bauto\b/, buscar: 'accesorios para muñeca' },
      // La casa es el regalo «grande» de las muñecas de moda; con tope para no saltar a la de 6 mil en una de 300.
      { tipo: 'casa', etiqueta: 'Casa de muñecas', peso: 0.45, palabras: /^(casa|casita|mansion|departamento|cuarto|recamara)\b/, requiere: /muneca|barbie|polly|dreamhouse|suenos|doll/, excluye: /campana|perro|gato|mascota|pajaro|jardin/, si: /^(?!.*\b(bebe|nenuco|baby|reborn|neonato)\b)/, topePrecio: 4, buscar: 'casa de muñecas' },
      // El carro (convertible, camper) es complemento clásico de Barbie; solo en esa línea.
      { tipo: 'vehiculo', etiqueta: 'Vehículo para muñeca', peso: 0.35, palabras: /^(auto|carro|coche|convertible|camper|camioneta|vehiculo|jeep|motoneta|avion|yate|lancha)\b/, requiere: /barbie|muneca/, excluye: /montable|\b\d+ ?v\b|rodada|para nin[ao]\b|pedales|control remoto/, si: /barbie|\bken\b/, topePrecio: 4, buscar: 'carro de Barbie' },
      // Las interactivas (hablan, lloran, se iluminan) suelen pedir pilas aparte.
      { tipo: 'pilas', etiqueta: 'Pilas', peso: 0.25, palabras: /^((paquete|pack|set|blister) de (\d+ )?)?pilas?\b/, requiere: /\baaa?\b|alcalinas?|recargables?/, si: /interactiv|habla|sonidos|luces|electronic|baby alive|llora|camina|canta/, buscar: 'pilas AA' }
    ]
  },
  {
    id: 'bloquesConstruccion', nombre: 'Bloques de construcción',
    migas: /^(lego|duplo)\b|^bloques( de construccion| para armar)?$|^(juegos?|juguetes|sets?|kits?) de construccion\b|^(construccion|armables)$/,
    producto: /^(sets?|juegos?|juguetes?|kits?) de (construccion|bloques)\b|^bloques( de construccion| para armar| armables)?$|^(lego|duplo)\b/,
    titulo: /^(lego|duplo|mega ?bloks|mega construx)\b|^(sets?|juegos?|kits?|juguetes?) de (construccion|bloques)\b|^bloques\b(?! (de |para )?(yoga|pilates|ejercicio|notas|hielo|cuchillos)\b)|^(caja|bote|cubeta|tina|bolsa) de (\d+ )?(bloques|ladrillos)\b/,
    noEs: /^bloques? (de |para )?(yoga|pilates|ejercicio|notas|hielo|cuchillos)\b|^lego\b.*\b(llavero|mochila|lonchera|pijama|playera|calcetines|disfraz|videojuego|playstation|ps[45]|xbox|nintendo switch)\b/,
    complementos: [
      // Guardar las piezas es el problema número uno de quien arma: la caja organizadora se pide sola.
      { tipo: 'organizador', etiqueta: 'Caja organizadora', peso: 0.50, palabras: /^(caja|contenedor|organizador|bote|cubo|cesto|canasta|bolsa|tapete)(es|s)?\b/, requiere: /lego|bloques|piezas|juguetes/, excluye: /\b\d{2,} ?(piezas|pzas|pz|pcs)\b/, topePrecio: 1, buscar: 'caja organizadora de juguetes' },
      // Las minifiguras son el antojo barato que acompaña a un set LEGO.
      { tipo: 'minifiguras', etiqueta: 'Minifiguras', peso: 0.40, palabras: /^(minifiguras?|mini ?figuras?)\b/, requiere: /lego/, si: /\blego\b/, buscar: 'minifiguras LEGO' },
      // La base o placa da dónde montar y exhibir lo armado.
      { tipo: 'base', etiqueta: 'Base de construcción', peso: 0.35, palabras: /^(base|placa|bandeja|plataforma)s?\b/, requiere: /lego|bloques|construccion|construir/, buscar: 'base para LEGO' },
      // Los motorizados (trenes, Technic con control, Powered Up) piden pilas AAA que no vienen.
      { tipo: 'pilas', etiqueta: 'Pilas', peso: 0.30, palabras: /^((paquete|pack|set|blister) de (\d+ )?)?pilas?\b/, requiere: /\baaa?\b|alcalinas?|recargables?/, si: /control remoto|\bmotor|powered up|bluetooth|\bapp\b|\btren\b|spike|boost|\brc\b|con luces/, buscar: 'pilas AAA' },
      // El llavero de la misma saga es el detalle de caja para el fan.
      { tipo: 'llavero', etiqueta: 'Llavero LEGO', peso: 0.25, palabras: /^llaveros?\b/, requiere: /lego/, si: /\blego\b/, buscar: 'llavero LEGO' },
      // Libros de ideas y de personajes: el siguiente paso de quien ya armó.
      { tipo: 'libro', etiqueta: 'Libro LEGO', peso: 0.20, palabras: /^libros?\b/, requiere: /lego/, si: /\blego\b/, buscar: 'libro LEGO' }
    ]
  },
  {
    id: 'juegoMesa', nombre: 'Juegos de mesa',
    migas: /^juegos? de (mesa|cartas|tablero|salon|destreza|estrategia)\b|^juegos (familiares|clasicos)$/,
    producto: /^juegos? de (mesa|cartas|tablero|destreza|estrategia)\b/,
    titulo: /^juegos? de (mesa|cartas|tablero|destreza|estrategia|preguntas|palabras|domino|ajedrez|loteria|damas|salon|habilidad|memoria|mimica)\b(?!.*\bexpansion\b)|^(ajedrez|tablero de (ajedrez|damas)|domino|loteria|turista|monopoly|uno|jenga|scrabble|maraton|rummy|rummikub|clue|twister|pictionary|adivina quien|serpientes y escaleras|damas chinas|parchis|backgammon|basta|dixit|catan|dobble|operando|batalla naval|conecta 4|cuatro en linea|risk|stratego|jumanji|exploding kittens|carcassonne)\b(?!.*\bexpansion\b)/,
    noEs: /^(rompecabezas|puzzles?|puzle|barajas?|naipes)\b/,
    variables: {
      juego: [[/catan/, 'Catan'], [/carcassonne/, 'Carcassonne'], [/dixit/, 'Dixit'], [/aventureros al tren|ticket to ride/, 'Aventureros al Tren'], [/exploding kittens/, 'Exploding Kittens'], [/unstable unicorns/, 'Unstable Unicorns'], [/munchkin/, 'Munchkin'], [/king of tokyo/, 'King of Tokyo'], [/wingspan/, 'Wingspan'], [/dominion/, 'Dominion']]
    },
    complementos: [
      // En los juegos «de afición» lo primero que se pide es la expansión del MISMO juego.
      { tipo: 'expansion', etiqueta: 'Expansión', peso: 0.60, palabras: /^(expansion|extension)(es)?\b|^juegos? de (mesa|cartas)\b.*\bexpansion\b/, si: /catan|carcassonne|dixit|aventureros al tren|ticket to ride|exploding kittens|unstable unicorns|munchkin|king of tokyo|wingspan|dominion/, requiereVar: 'juego', buscar: 'expansión {juego}' },
      // El rompecabezas es el otro pasatiempo de la misma tarde en familia, sin competir con el juego.
      { tipo: 'rompecabezas', etiqueta: 'Rompecabezas', peso: 0.40, palabras: /^(rompecabezas|puzzles?|puzle)\b/, buscar: 'rompecabezas' },
      // Una baraja siempre hace falta en la reunión; no se ofrece si la ficha ya es de cartas.
      { tipo: 'baraja', etiqueta: 'Baraja', peso: 0.35, palabras: /^(barajas?|naipes|cartas de poker|mazo de cartas)\b/, excluye: /tarot|oraculo/, si: /^(?!.*\b(cartas|baraja|naipes|uno)\b)/, buscar: 'baraja de cartas' },
      // Los electrónicos (Operando, Simon…) traen pilas de prueba o ninguna.
      { tipo: 'pilas', etiqueta: 'Pilas', peso: 0.30, palabras: /^((paquete|pack|set|blister) de (\d+ )?)?pilas?\b/, requiere: /\baaa?\b|alcalinas?|recargables?/, si: /electronic|operando|simon|bop ?it|\bpilas\b|luces|sonidos|interactiv/, buscar: 'pilas AA' },
      // Los de rol piden su set de dados poliédricos.
      { tipo: 'dados', etiqueta: 'Set de dados', peso: 0.25, palabras: /^((set|kit|bolsa|estuche) de (\d+ )?)?dados\b/, si: /calabozos|dungeons|d&d|\brol\b|pathfinder/, buscar: 'set de dados' }
    ]
  },
  {
    id: 'carroControlRemoto', nombre: 'Carros a control remoto',
    migas: /^(vehiculos?|carros?|autos?|coches?|camionetas?|monster ?trucks?)( a| de| con)? (control remoto|radio ?control|r\/?c)\b/,
    producto: /^(carros?|carritos?|autos?|coches?|vehiculos?|camionetas?|camion(es)?|monster ?trucks?)( a| de| con)? (control remoto|radio ?control|r\/?c)\b/,
    titulo: /^(carros?|carritos?|autos?|coches?|camion(es)?|camionetas?|vehiculos?|monster ?trucks?|buggys?|jeeps?|todo ?terrenos?|cuatrimotos?|motos?|motocicletas?|tanques?|excavadoras?|tractor(es)?|gruas?)\b(?=.*(\bcontrol remoto\b|\bradio ?control|\br\/c\b|\brc\b))/,
    noEs: /^(carros?|autos?|coches?|camionetas?|vehiculos?|jeeps?|cuatrimotos?|motos?|motocicletas?|tractor(es)?)\b.*\b(montables?|(12|24) ?v)\b|^montables?\b/,
    complementos: [
      // Casi todos traen el control (o el carro) sin pilas: es la pregunta obligada.
      { tipo: 'pilas', etiqueta: 'Pilas', peso: 0.75, palabras: /^((paquete|pack|set|blister) de (\d+ )?)?pilas?\b/, requiere: /\baaa?\b|alcalinas?|recargables?/, buscar: 'pilas AA' },
      // Se juega horas: cargador con recargables sale más barato que comprar alcalinas cada semana.
      { tipo: 'cargadorPilas', etiqueta: 'Cargador de pilas', peso: 0.45, palabras: /^cargador(es)?\b/, requiere: /pilas|\baaa?\b/, excluye: /celular|laptop|\bauto\b|inalambrico/, buscar: 'cargador de pilas' },
      // Si el carro usa batería recargable, una segunda duplica el tiempo de juego.
      { tipo: 'bateria', etiqueta: 'Batería extra', peso: 0.40, palabras: /^(baterias?|pilas? recargables? para)\b/, requiere: /control remoto|\brc\b|r\/c|lipo|nimh/, excluye: /power ?bank|portatil|celular|laptop|automotriz|arranque|\blth\b/, si: /recargable|bateria|li-?ion|lipo|nimh|traxxas|1:(8|10|12|14|16)\b/, buscar: 'batería para carro de control remoto' },
      // Muchos cargan por USB y la caja solo trae el cable: falta el cargador de pared.
      { tipo: 'cargadorUsb', etiqueta: 'Cargador de pared USB', peso: 0.30, palabras: /^(cargador|adaptador)(es)?( de pared| usb| de corriente)?\b/, requiere: /pared|usb|corriente/, excluye: /pilas|\baaa?\b|\bauto\b|carro|coche|inalambrico|laptop|portatil/, si: /\busb\b|recargable/, buscar: 'cargador de pared USB' }
    ]
  },
  {
    // Incluye los de techo; lo que solo sirve a los de piso, torre o escritorio se apaga con «si».
    id: 'ventilador', nombre: 'Ventiladores', servicio: true,
    migas: /^ventilador(es)?\b(?! (para|de) (laptop|pc|computadora|gabinete|cpu|auto|mano))/,
    producto: /^ventilador(es)?\b(?! (para|de) (laptop|pc|computadora|gabinete|cpu|consola|auto|carro|mano|cuello))(?!.*\bcalefactor)/,
    titulo: /^(ventilador(es)?|abanicos?|turbo ?ventilador(es)?|circulador(es)? de aire)\b/,
    noEs: /^ventilador(es)? (para (laptop|computadora|pc|gabinete|cpu|consola|ps[45]|xbox|auto|carro|coche|celular|carriola)|de (cpu|gabinete|procesador|laptop|cuello|mano|bolsillo)|calefactor|usb para (laptop|pc))\b|^ventilador(es)?\b.*\b(rgb|(80|92|120|140) ?mm)\b|^abanicos? (de mano|plegables?|de tela|de papel)\b/,
    complementos: [
      // Torre y pedestal rara vez quedan junto al contacto: la extensión resuelve dónde ponerlo.
      { tipo: 'extension', etiqueta: 'Extensión eléctrica', peso: 0.45, palabras: /^(extension(es)?|multicontactos?|barras? multicontactos?|regletas?)\b/, requiere: /electric|contacto|cable|\d+ ?m\b|metros|uso rudo|enchufe/, excluye: /cabello|pestan|pelo|garantia|unas/, si: /^(?!.*\btecho\b)/, buscar: 'extensión eléctrica' },
      // Con un contacto inteligente se programa para que se apague solo de madrugada.
      { tipo: 'contactoInteligente', etiqueta: 'Contacto inteligente', peso: 0.40, palabras: /^(contactos?|enchufes?|clavijas?|tomacorrientes?|toma ?corrientes?) (inteligentes?|wi-?fi|smart)\b|^smart ?plugs?\b/, si: /^(?!.*\b(techo|wi-?fi|inteligente|smart|alexa|app)\b)/, buscar: 'contacto inteligente' },
      // El control remoto de los de torre casi nunca trae pilas.
      { tipo: 'pilas', etiqueta: 'Pilas para el control', peso: 0.35, palabras: /^((paquete|pack|set|blister) de (\d+ )?)?pilas?\b/, requiere: /\baaa?\b|alcalinas?|recargables?/, si: /\bcontrol\b/, buscar: 'pilas AAA' },
      // El aire constante reseca el cuarto; el humidificador lo compensa.
      { tipo: 'humidificador', etiqueta: 'Humidificador', peso: 0.30, palabras: /^(humidificador(es)?|difusor(es)?)\b/, requiere: /humidif|aroma|ultrason|aceite|esencia|vapor/, excluye: /cabello|secadora|pelo/, si: /^(?!.*\b(humidificador|nebulizador|vapor)\b)/, topePrecio: 1, buscar: 'humidificador' },
      // Los de techo con lámpara se venden sin focos.
      { tipo: 'foco', etiqueta: 'Focos', peso: 0.30, palabras: /^((set|paquete|kit|pack|juego) de (\d+ )?)?focos?\b/, excluye: /\bauto\b|\bmoto\b|\bh[47]\b|faro|proyector|escenario/, si: /^(?!.*\bled\b).*\btecho\b(?=.*\b(luz|lampara|focos?|iluminacion)\b)/, buscar: 'foco LED' }
    ]
  },
  {
    // Torre y mini PC piden monitor, cámara y bocinas; el All in One y la iMac ya los traen.
    id: 'computadoraEscritorio', nombre: 'Computadoras de escritorio y All in One', servicio: true,
    migas: /^computadoras? (de escritorio|all[ -]?in[ -]?one|todo en uno|aio)\b|^all[ -]?in[ -]?ones?$|^(pcs?|computadoras?) gamers?$|^desktops?$/,
    producto: /^(computadoras? (de escritorio|all[ -]?in[ -]?one|todo en uno|aio|desktop)|all[ -]?in[ -]?one|pc( de escritorio| gamer)?|desktop|mini ?pc|cpu|imac)\b/,
    titulo: /^(computadora|pc)s?\b(?=.*\b(escritorio|all[ -]?in[ -]?one|aio|todo en uno|desktop|gamer|torre|cpu)\b)|^(all[ -]?in[ -]?one|aio|imac|desktop|mini ?pc|cpu)\b|^mac (mini|studio|pro)\b/,
    noEs: /^(computadoras?|pcs?)\b.*\b(portatil|laptop|notebook|2 en 1|de juguete|infantil|didactica|educativa|para nin[oa]s)\b|^(laptops?|notebooks?|chromebooks?|macbooks?|tablets?|ipad)\b|^cpus? (coolers?|enfriador|disipador|ventilador)\b/,
    complementos: [
      // Una torre o un mini PC no traen pantalla: el monitor es lo primero.
      { tipo: 'monitor', etiqueta: 'Monitor', peso: 0.85, palabras: /^monitor(es)?\b/, excluye: /bebe|presion|arterial|glucosa|cardiac|signos|ritmo|de estudio/, si: /^(?!.*\b(all[ -]?in[ -]?one|aio|todo en uno|imac|monitor|pantalla)\b)/, buscar: 'monitor para computadora' },
      // El no break la protege de apagones y picos de luz, que queman fuentes y discos.
      { tipo: 'noBreak', etiqueta: 'No break / regulador', peso: 0.55, palabras: /^(no ?-?break|ups|regulador(es)?( de voltaje)?|supresor(es)?( de picos)?)\b/, excluye: /\bgas\b|presion|agua|temperatura/, buscar: 'no break' },
      // El kit de la caja es básico; uno inalámbrico es mejora barata y natural.
      { tipo: 'tecladoMouse', etiqueta: 'Teclado y mouse', peso: 0.55, palabras: /^((kit|combo|set|paquete) (de )?)?(teclados?|mouses?|raton(es)?)\b/, excluye: /musical|piano|\d+ teclas|organeta|ipad|tablet|funda|celular|\bpad\b|mousepad|alfombrilla|tapete/, buscar: 'teclado y mouse inalámbrico' },
      // En casa la computadora y la impresora van juntas (tareas, trámites).
      { tipo: 'impresora', etiqueta: 'Impresora', peso: 0.45, palabras: /^(impresoras?|multifuncional(es)?)\b/, excluye: /\b3d\b|etiquetas|termica|fotografica|portatil|tickets|instantanea/, buscar: 'impresora multifuncional' },
      // Office/Microsoft 365 o antivirus casi nunca vienen activados de fábrica.
      { tipo: 'software', etiqueta: 'Microsoft 365 / antivirus', peso: 0.45, palabras: /^((licencia|suscripcion|software|paquete)( digital)?( de| para)? )?(microsoft (365|office)|office (365|hogar|home|20\d\d)|antivirus|norton|mcafee|kaspersky|eset|bitdefender)\b/, buscar: 'Microsoft 365' },
      // La torre no trae cámara: sin ella no hay videollamadas.
      { tipo: 'camaraWeb', etiqueta: 'Cámara web', peso: 0.35, palabras: /^(camaras? web|webcams?|camaras? para (computadora|pc|videollamadas|streaming))\b/, si: /^(?!.*\b(all[ -]?in[ -]?one|aio|todo en uno|imac)\b)/, buscar: 'cámara web' },
      // Torre sin bocinas = computadora muda.
      { tipo: 'bocinas', etiqueta: 'Bocinas', peso: 0.30, palabras: /^(bocinas?|altavoz|altavoces|barras? de sonido)\b/, requiere: /computadora|\bpc\b|usb|escritorio|multimedia|2\.[01]\b|gamer/, excluye: /\bauto\b|carro|\bmoto\b/, si: /^(?!.*\b(all[ -]?in[ -]?one|aio|todo en uno|imac)\b)/, buscar: 'bocinas para computadora' }
    ]
  },
  {
    id: 'casaCampana', nombre: 'Casas de campaña',
    migas: /^(casas?|tiendas?) de campana\b/,
    producto: /^(casas?|tiendas?) de campana\b|^carpas? para acampar\b/,
    titulo: /^(casas?|tiendas?) de campana\b|^carpas?\b(?=.*\b(acampar|camping|campismo|domo|iglu)\b)/,
    noEs: /^(casas?|tiendas?) de campana\b.*\b(para nin[oa]s|infantil(es)?|de juguete|de juego|para (mascotas?|perros?|gatos?)|princesas?)\b|^(tipis?|teepees?)\b/,
    complementos: [
      // Nadie duerme sobre el piso de la casa: la bolsa de dormir es su pareja natural.
      { tipo: 'bolsaDormir', etiqueta: 'Bolsa de dormir', peso: 0.85, palabras: /^((bolsa|saco)s? de dormir|sleeping( bags?)?)\b/, buscar: 'bolsa de dormir' },
      // Aísla del suelo frío y duro; se compra en la misma vuelta.
      { tipo: 'colchon', etiqueta: 'Colchón inflable', peso: 0.65, palabras: /^(colchon(eta)?|cama|tapete|aislante)(es|s)? (inflables?|de aire|autoinflables?|para acampar|de campismo)\b/, excluye: /alberca|piscina|flotador|playa/, buscar: 'colchón inflable' },
      // De noche, dentro de la casa, hace falta luz: lámpara o linterna de campismo.
      { tipo: 'lampara', etiqueta: 'Lámpara para acampar', peso: 0.55, palabras: /^(linternas?|farol(es)?)\b|^(lamparas?|luz|luces)\b(?=.*\b(acampar|campismo|camping)\b)/, buscar: 'lámpara para acampar' },
      // La hielera guarda comida y bebidas todo el fin de semana.
      { tipo: 'hielera', etiqueta: 'Hielera', peso: 0.45, palabras: /^(hieleras?|neveras? portatil(es)?|enfriador(es)? portatil(es)?|coolers?)\b/, topePrecio: 1.5, buscar: 'hielera' },
      // Sillas plegables para la fogata: se cargan junto con la casa.
      { tipo: 'silla', etiqueta: 'Silla plegable', peso: 0.40, palabras: /^sillas?\b/, requiere: /plegable|acampar|campismo|camping|playa|portatil/, excluye: /oficina|gamer|comedor|bebe|\bauto\b|carro|coche|ruedas|escritorio|periquera|mecedora|bano|ducha/, buscar: 'silla plegable para acampar' },
      // Para cocinar en el campamento: asador o estufa portátil.
      { tipo: 'asador', etiqueta: 'Asador portátil', peso: 0.30, palabras: /^(asador(es)?|parrillas?|estufas?|anafres?)\b/, requiere: /portatil|acampar|campismo|camping/, excluye: /electric|induccion/, topePrecio: 1, buscar: 'asador portátil' }
    ]
  },
  {
    // Solo eléctricos y hoverboards: el patín del diablo de impulso no entra (no admite garantía).
    id: 'scooterElectrico', nombre: 'Scooters y patinetas eléctricas', servicio: true,
    migas: /^(scooters?|patin(es)?|patinetes?|patinetas?|monopatin(es)?) electric[oa]s?\b|^hoverboards?$/,
    producto: /^(scooters?|patin(es)?|patinetes?|patinetas?|monopatin(es)?) electric[oa]s?\b|^hoverboards?\b|^(patinetas?|scooters?) (auto ?balanceables?|de equilibrio)\b/,
    titulo: /^(scooters?|patin(es)?|patinetes?|patinetas?|monopatin(es)?|skateboards?|skates?|longboards?)\b(?=.*\belectric[oa]s?\b)|^(hoverboards?|(patinetas?|scooters?) (auto ?balanceables?|de equilibrio))\b/,
    noEs: /^(scooters?|patin(es)?|patinetes?|patinetas?|monopatin(es)?)\b.*\b(de movilidad|para (adultos? mayores|discapacitados)|de dedos|para munecas?|de juguete)\b/,
    complementos: [
      // Va a 25 km/h entre coches: el casco es la primera recomendación.
      { tipo: 'casco', etiqueta: 'Casco', peso: 0.80, palabras: /^cascos?\b/, excluye: /realidad virtual|\bvr\b|audifonos|bebe|soldar|motocicleta|futbol|beisbol|equitacion/, buscar: 'casco para scooter' },
      // Se queda estacionado afuera: sin candado no dura.
      { tipo: 'candado', etiqueta: 'Candado', peso: 0.55, palabras: /^(candados?|cadenas?)\b/, excluye: /maleta|equipaje|\btsa\b|locker|diario|collar|joyeria|plata|\boro\b/, si: /^(?!.*\b(hoverboard|auto ?balanceables?|equilibrio|skate|longboard)\b)/, buscar: 'candado para bicicleta' },
      // Rodilleras y coderas: sobre todo para niños y principiantes.
      { tipo: 'protecciones', etiqueta: 'Rodilleras y coderas', peso: 0.45, palabras: /^((set|kit|juego|paquete) (de )?)?(protecciones|protectores|rodilleras|coderas|munequeras)\b/, requiere: /rodill|coder|patin|scooter|skate|bici|ciclismo/, excluye: /pantalla|celular|colchon|cuna/, buscar: 'rodilleras y coderas' },
      // Quien lo usa para moverse lleva el celular de GPS en el manubrio.
      { tipo: 'soporteCelular', etiqueta: 'Soporte de celular', peso: 0.40, palabras: /^(?=.*(celular|telefono|smartphone))(soportes?|holders?|sujetador(es)?|porta ?celular(es)?)\b/, requiere: /bici|scooter|manubrio|\bmoto/, excluye: /\bauto\b|carro|coche|rejilla|ventila/, si: /^(?!.*\b(hoverboard|auto ?balanceables?|equilibrio|skate|longboard)\b)/, buscar: 'soporte de celular para bicicleta' },
      // Luz extra para ser visto de noche.
      { tipo: 'luces', etiqueta: 'Luces', peso: 0.30, palabras: /^((set|kit|juego) de )?(luz|luces|lamparas?|faros?|linternas?)\b/, requiere: /bici|scooter|ciclismo|manubrio/, si: /^(?!.*\b(hoverboard|auto ?balanceables?|equilibrio)\b)/, buscar: 'luces para bicicleta' },
      // Un segundo cargador (casa y oficina); depende de la marca, por eso solo se sugiere.
      { tipo: 'cargador', etiqueta: 'Cargador extra', peso: 0.30, palabras: /^(cargador(es)?|eliminador(es)?|fuentes? de poder|adaptador(es)? de corriente)\b/, requiere: /scooter|patin|patineta|hoverboard|monopatin/, mismaMarca: true, soloSugerir: true, buscar: 'cargador para scooter {marca}' }
    ]
  },
  {
    id: 'guitarra', nombre: 'Guitarras',
    migas: /^guitarras?\b(?! (de juguete|infantil(es)?)\b)/,
    producto: /^guitarras?\b(?! (de juguete|infantil|electronica|musical)\b)/,
    titulo: /^((paquete|kit|set|combo) (de |con )?)?guitarras?\b/,
    noEs: /^((paquete|kit|set|combo) (de |con )?)?guitarras?\b.*\b(de juguete|didactica|decorativa|miniatura|de carton|para (guitar hero|videojuego|xbox|ps[345]|playstation|wii))\b|^((paquete|kit|set|combo) (de |con )?)?guitarras? (infantil|electronica|musical)\b/,
    variables: {
      tipo: [[/clasica|nylon|criolla/, 'clásica'], [/acustica/, 'acústica'], [/electrica/, 'eléctrica']]
    },
    complementos: [
      // Una eléctrica no suena sin amplificador (salvo que el paquete ya lo traiga).
      { tipo: 'amplificador', etiqueta: 'Amplificador', peso: 0.75, palabras: /^(amplificador(es)?|amp|combo|cubo|bafle)\b/, requiere: /guitarra/, excluye: /\bbajo\b|teatro|estereo|\bauto\b|antena|senal|wi-?fi|audifonos/, si: /^(?=.*\belectr(ica|oacustica)\b)(?!.*\bamplificador\b)/, topePrecio: 1, buscar: 'amplificador para guitarra' },
      // La funda la protege y es lo que se pide para cargarla.
      { tipo: 'funda', etiqueta: 'Funda o estuche', peso: 0.70, palabras: /^(fundas?|estuches?|gig ?bags?|maletas?|case)\b/, requiere: /guitarra/, excluye: /ukulele|violin|celular|iphone/, si: /^(?!.*\b(funda|estuche)\b)/, topePrecio: 0.6, buscar: 'funda para guitarra' },
      // Las cuerdas de fábrica duran poco; un juego de repuesto del MISMO tipo.
      { tipo: 'cuerdas', etiqueta: 'Cuerdas', peso: 0.60, palabras: /^((juego|set|paquete|pack) de )?(cuerdas|encordado|encordadura)\b/, requiere: /guitarra/, excluye: /\bbajo\b|ukulele|violin|requinto|jarana|tenis|raqueta|cello/, requiereVar: 'tipo', buscar: 'cuerdas para guitarra {tipo}' },
      // Sin afinador suena mal desde el primer día.
      { tipo: 'afinador', etiqueta: 'Afinador', peso: 0.55, palabras: /^afinador(es)?\b/, excluye: /piano/, buscar: 'afinador para guitarra' },
      // Cable de instrumento para conectarla al amplificador.
      { tipo: 'cable', etiqueta: 'Cable para instrumento', peso: 0.45, palabras: /^cables?\b/, requiere: /guitarra|instrumento|plug|6\.3|1\/4|jack/, excluye: /hdmi|usb|cargador|iphone|lightning|ethernet|\brca\b|\bred\b|corriente|3\.5/, si: /\belectr(ica|oacustica)\b/, buscar: 'cable para guitarra' },
      // Para tocar de pie hace falta la correa (tahalí).
      { tipo: 'correa', etiqueta: 'Correa', peso: 0.40, palabras: /^(correas?|tahali|straps?)\b/, requiere: /guitarra|bajo|instrumento/, buscar: 'correa para guitarra' },
      // Las púas se pierden: el antojo barato de caja.
      { tipo: 'puas', etiqueta: 'Púas', peso: 0.35, palabras: /^((set|paquete|juego|kit|estuche) de (\d+ )?)?(puas?|plumillas?|plectros?|picks?|unetas?)\b/, requiere: /guitarra|bajo|instrumento|celuloide|dunlop|fender/, buscar: 'púas para guitarra' }
    ]
  },
  {
    id: 'lampara', nombre: 'Lámparas',
    migas: /^(lamparas?|candil(es)?|plafon(es)?|arbotantes?)\b(?!.*\b(solares?|jardin|emergencia|bicicleta|auto|unas|acampar)\b)/,
    producto: /^(lamparas?|candil(es)?|plafon(es)?|arbotantes?)\b/,
    titulo: /^((set|juego|paquete) de (\d+ )?)?(lamparas?|candil(es)?|plafon(es)?|arbotantes?)\b/,
    noEs: /^((set|juego|paquete) de (\d+ )?)?lamparas?\b.*\b(para (bicicleta|bici|auto|carro|coche|moto|acampar|campismo|camping|unas|gel|acuario|pecera)|de (mano|emergencia|cabeza|minero|unas|bolsillo|campismo|seguridad|trabajo)|solar(es)?|uv|antimosquitos|mata ?mosquitos|insecticida|tactica|aro de luz)\b|^lamparas? (de )?aro\b/,
    complementos: [
      // Muchas se venden sin foco; si no es LED integrada, el foco es obligado.
      { tipo: 'foco', etiqueta: 'Focos', peso: 0.70, palabras: /^((set|paquete|kit|pack|juego) de (\d+ )?)?focos?\b/, excluye: /\bauto\b|\bmoto\b|\bh[47]\b|faro|proyector|escenario/, si: /^(?!.*\bled\b)/, buscar: 'foco LED' },
      // Con un contacto inteligente se prende y apaga desde el celular o por horario.
      { tipo: 'contactoInteligente', etiqueta: 'Contacto inteligente', peso: 0.35, palabras: /^(contactos?|enchufes?|clavijas?|tomacorrientes?|toma ?corrientes?) (inteligentes?|wi-?fi|smart)\b|^smart ?plugs?\b/, si: /^(?!.*\b(inteligente|wi-?fi|smart|alexa|bluetooth|recargable|pilas|techo|candil|plafon|arbotante|colgante)\b)/, buscar: 'contacto inteligente' },
      // Las de pie y de buró casi nunca quedan junto al contacto.
      { tipo: 'extension', etiqueta: 'Extensión eléctrica', peso: 0.30, palabras: /^(extension(es)?|multicontactos?|barras? multicontactos?|regletas?)\b/, requiere: /electric|contacto|cable|\d+ ?m\b|metros|uso rudo|enchufe/, excluye: /cabello|pestan|pelo|garantia|unas/, si: /\bde (pie|piso|mesa|escritorio|buro|noche)\b/, buscar: 'extensión eléctrica' },
      // La de escritorio arma el «rincón de estudio» junto con el organizador.
      { tipo: 'organizador', etiqueta: 'Organizador de escritorio', peso: 0.25, palabras: /^organizador(es)? (de|para) escritorio\b|^(portalapices|porta ?lapices|lapicero|bandeja organizadora)\b/, si: /escritorio|estudio|lectura|oficina/, buscar: 'organizador de escritorio' },
      // Las de noche o portátiles de pilas se quedan sin luz si no se llevan pilas.
      { tipo: 'pilas', etiqueta: 'Pilas', peso: 0.25, palabras: /^((paquete|pack|set|blister) de (\d+ )?)?pilas?\b/, requiere: /\baaa?\b|alcalinas?|recargables?/, si: /\bpilas\b|\baaa?\b/, buscar: 'pilas AAA' }
    ]
  },
  {
    id: 'termo', nombre: 'Termos y vasos térmicos',
    migas: /^(termos?|(vasos?|botellas?|tarros?|tazas?) termic[oa]s?)\b(?!.*\b(loncheras?|hieleras?)\b)/,
    producto: /^(termos?|(vasos?|botellas?|tarros?|tazas?) termic[oa]s?|tumblers?)\b/,
    titulo: /^((set|juego|paquete|kit) de (\d+ )?)?(termos?|tumblers?)\b|^((set|juego|paquete|kit) de (\d+ )?)?(vasos?|botellas?|tarros?|tazas?|cilindros?) (termic[oa]s?|con aislamiento|aislad[oa]s?|de doble pared)\b|^(vasos?|botellas?)\b(?=.*\b(stanley|yeti|hydro ?flask|owala|thermos|quencher|rambler|termic[oa]s?)\b)/,
    noEs: /^termos? electric[oa]s?\b|^(vasos?|tazas?) termic[oa]s? desechables?\b/,
    complementos: [
      // Los vasos tipo Quencher usan popote: el de repuesto (o de acero) es la venta más natural.
      { tipo: 'popotes', etiqueta: 'Popotes reutilizables', peso: 0.55, palabras: /^((set|juego|paquete|kit) de (\d+ )?)?popotes?\b/, excluye: /desechables?|papel|fiesta/, si: /\b(vaso|tumbler|quencher|popote|iceflow|\d+ ?oz)\b/, buscar: 'popotes reutilizables' },
      // La funda de silicón protege la base del Stanley y se volvió el accesorio de moda.
      { tipo: 'funda', etiqueta: 'Funda de silicón', peso: 0.45, palabras: /^(fundas?|protector(es)?|botas?|cubiertas?)\b/, requiere: /termo|vaso|stanley|tumbler|botella|quencher/, excluye: /celular|iphone|samsung|laptop|tablet|ipad|pantalla|almohada|colchon|\bcama\b|asiento|\bauto\b|volante|sillon|maleta/, si: /stanley|quencher|tumbler/, topePrecio: 0.6, buscar: 'funda de silicón para vaso Stanley' },
      // Termo y lonchera salen juntos a la oficina o a la escuela.
      { tipo: 'lonchera', etiqueta: 'Lonchera térmica', peso: 0.40, palabras: /^(loncheras?|bolsas? termicas?|bolsas? para (lunch|almuerzo)|portaviandas|bolsos? termicos?|lunch ?bags?)\b/, topePrecio: 1, buscar: 'lonchera térmica' },
      // Café y bebidas dulces dejan residuo: el termo pide cepillo largo para lavarlo.
      { tipo: 'cepillo', etiqueta: 'Cepillo limpiador', peso: 0.35, palabras: /^((set|kit|juego) de (\d+ )?)?cepillos?\b/, requiere: /botellas?|termos?|popotes?|vasos?/, excluye: /dental|dientes|cabello|pelo|mascota|ropa|zapato|calzado|biberon/, topePrecio: 0.5, buscar: 'cepillo para limpiar termos' },
      // Quien lleva té en termo o botella agradece el infusor.
      { tipo: 'infusor', etiqueta: 'Infusor de té', peso: 0.25, palabras: /^infusor(es)?\b/, requiere: /\bte\b|tisana|hierbas|infusion/, si: /^(termos?|botellas?)\b/, topePrecio: 0.5, buscar: 'infusor de té' },
      // Los termos de comida (sopa, guisado) piden cubiertos para llevar.
      { tipo: 'cubiertos', etiqueta: 'Cubiertos portátiles', peso: 0.25, palabras: /^((set|juego|kit|estuche) de (\d+ )?)?cubiertos\b/, requiere: /portatil|viaje|plegable|lunch|estuche|reutilizable|bolsillo/, si: /comida|alimentos|food|sopa|lunch/, topePrecio: 0.5, buscar: 'cubiertos portátiles' }
    ]
  },
  {
    id: 'dron', nombre: 'Drones', servicio: true,
    migas: /^dron(es|e)?\b(?!.*\b(accesorios|refacciones|baterias|helices)\b)/,
    producto: /^(dron(es|e)?|cuadricopteros?)\b/,
    titulo: /^(dron(es|e)?|cuadricopteros?|cuadracopteros?|quadcopters?)\b|^dji\b(?! (baterias?|helices|cargador|mochila|osmo|pocket|action|mic|rc|goggles|lentes|ronin|filtros?|estuche|hub|control)\b)(?=.*\b(dron(es|e)?|mini|air|avata|mavic|neo|flip)\b)/,
    variables: {
      linea: [[/mini ?5 ?pro/, 'Mini 5 Pro'], [/mini ?4 ?pro/, 'Mini 4 Pro'], [/mini ?4k/, 'Mini 4K'], [/mini ?3 ?pro/, 'Mini 3 Pro'], [/mini ?3\b/, 'Mini 3'], [/mini ?2 ?se/, 'Mini 2 SE'], [/mini ?2\b/, 'Mini 2'], [/mini ?se\b/, 'Mini SE'], [/air ?3s/, 'Air 3S'], [/air ?3\b/, 'Air 3'], [/air ?2s/, 'Air 2S'], [/avata ?2/, 'Avata 2'], [/mavic ?3/, 'Mavic 3'], [/\bneo\b/, 'Neo'], [/\bflip\b/, 'Flip']]
    },
    complementos: [
      // Una batería da ~30 min de vuelo: la segunda es la venta más natural. Es del MISMO modelo, por eso solo se sugiere.
      { tipo: 'bateria', etiqueta: 'Batería extra', peso: 0.85, palabras: /^baterias?\b/, requiere: /\bdron|dji|vuelo/, excluye: /portatil|power ?bank|externa|celular|laptop|automotriz/, exacto: true, soloSugerir: true, requiereVar: 'linea', buscar: 'batería {marca} {linea}' },
      // Graba en microSD y casi nunca viene incluida.
      { tipo: 'microsd', etiqueta: 'Memoria microSD', peso: 0.70, palabras: /^(memorias?|tarjetas?( de memoria)?|micro ?sd(hc|xc)?)\b/, requiere: /micro ?sd/, excluye: /\bram\b|ddr/, si: /camara|\b4k\b|\bhd\b|dji|fpv|video|\d+ ?mp\b/, topePrecio: 0.5, buscar: 'memoria micro SD' },
      // Las hélices se despostillan en los primeros vuelos; también dependen del modelo.
      { tipo: 'helices', etiqueta: 'Hélices de repuesto', peso: 0.55, palabras: /^((set|juego|kit|paquete) de (\d+ )?)?(helices|propelas)\b/, exacto: true, soloSugerir: true, requiereVar: 'linea', buscar: 'hélices {marca} {linea}' },
      // Para transportarlo sin golpes: mochila o estuche rígido.
      { tipo: 'mochila', etiqueta: 'Mochila o estuche', peso: 0.50, palabras: /^(mochilas?|estuches?|maletas?|maletin(es)?|bolsas?|fundas?)\b/, requiere: /\bdron|dji/, si: /dji|camara|\b4k\b|plegable|gps|profesional/, topePrecio: 0.5, buscar: 'mochila para dron' },
      // Los DJI cargan control y baterías por USB-C: con power bank se recargan en el campo.
      { tipo: 'powerBank', etiqueta: 'Power bank', peso: 0.35, palabras: /^(power ?banks?|baterias? (portatil(es)?|externas?)|cargador(es)? portatil(es)?|bancos? de (energia|bateria|carga))\b/, si: /dji/, topePrecio: 0.3, buscar: 'power bank' },
      // Los de juguete usan pilas AA en el control.
      { tipo: 'pilas', etiqueta: 'Pilas', peso: 0.30, palabras: /^((paquete|pack|set|blister) de (\d+ )?)?pilas?\b/, requiere: /\baaa?\b|alcalinas?|recargables?/, si: /juguete|para nin[oa]s|infantil|mini dron|syma|paw patrol|spider|hot wheels/, buscar: 'pilas AA' }
    ]
  }
];
