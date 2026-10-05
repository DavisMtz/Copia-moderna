// Ajustes a las clases nuevas tras validarlas con las fichas reales (04/10/2026):
//  · scooter: el «casco» era uno cerrado de motociclismo;
//  · guitarra: a la clásica le tocaba la funda de la eléctrica;
//  · dron: sus complementos pedían «dji» en el NOMBRE, y el nombre del DJI no lo dice (lo dice la marca).
const fs = require('fs');
const path = require('path');
const ruta = path.join(__dirname, '..', 'wt', 'Extencion para chrome', 'reglas-venta.js');
let s = fs.readFileSync(ruta, 'utf8');
function cambia(a, b) { const n = s.split(a).length - 1; if (n !== 1) throw new Error(n + ' veces: ' + a.slice(0, 70)); s = s.replace(a, b); }

// --- scooter ---
cambia("{ tipo: 'casco', etiqueta: 'Casco', peso: 0.80, palabras: /^cascos?\\b/, excluye: /realidad virtual|\\bvr\\b|audifonos|bebe|soldar|motocicleta|futbol|beisbol|equitacion/, buscar: 'casco para scooter' },",
  "// El de ciclismo: «casco para scooter» trae cascos cerrados de motociclismo (04/10/2026).\n" +
  "        { tipo: 'casco', etiqueta: 'Casco', peso: 0.80, palabras: /^cascos?\\b/, excluye: /realidad virtual|\\bvr\\b|audifonos|bebe|soldar|motocicl|motorsport|\\bmotos?\\b|abatible|cerrado|integral|futbol|beisbol|equitacion/, buscar: 'casco para bicicleta' },");

// --- guitarra: la funda, de su tipo ---
cambia("{ tipo: 'funda', etiqueta: 'Funda o estuche', peso: 0.70, palabras: /^(fundas?|estuches?|gig ?bags?|maletas?|case)\\b/, requiere: /guitarra/, excluye: /ukulele|violin|celular|iphone/, si: /^(?!.*\\b(funda|estuche)\\b)/, topePrecio: 0.6, buscar: 'funda para guitarra' },",
  "{ tipo: 'funda', etiqueta: 'Funda o estuche', peso: 0.70, palabras: /^(fundas?|estuches?|gig ?bags?|maletas?|case)\\b/, requiere: /guitarra/, excluye: /ukulele|violin|celular|iphone|electric|\\bbajo\\b/, si: /^(?!.*\\belectric)(?!.*\\b(funda|estuche)\\b)/, topePrecio: 0.6, buscar: 'funda para guitarra' },\n" +
  "        // La de la eléctrica es otra: más angosta. A una clásica le tocaba la «Funda guitarra eléctrica» (04/10/2026).\n" +
  "        { tipo: 'fundaElectrica', etiqueta: 'Funda o estuche', peso: 0.70, palabras: /^(fundas?|estuches?|gig ?bags?|maletas?|case)\\b/, requiere: /guitarra.*electric|electric.*guitarra/, si: /^(?=.*\\belectric)(?!.*\\b(funda|estuche)\\b)/, topePrecio: 0.6, buscar: 'funda para guitarra' },");

// --- dron: lo que no es de juguete, sin pedirle «dji» al nombre ---
const NO_JUGUETE = "/^(?!.*\\b(juguete|infantil|para nin[oa]s|mini dron|syma|paw patrol|spider|hot wheels)\\b)/";
cambia("requiere: /micro ?sd/, excluye: /\\bram\\b|ddr/, si: /camara|\\b4k\\b|\\bhd\\b|dji|fpv|video|\\d+ ?mp\\b/, topePrecio: 0.5, buscar: 'memoria micro SD' },",
  "requiere: /micro ?sd/, excluye: /\\bram\\b|ddr/, si: " + NO_JUGUETE + ", topePrecio: 0.5, buscar: 'memoria micro SD' },");
cambia("requiere: /\\bdron|dji|camara/, si: /dji|camara|\\b4k\\b|plegable|gps|profesional/, topePrecio: 0.5, buscar: 'mochila para dron' },",
  "requiere: /\\bdron|dji|camara/, si: " + NO_JUGUETE + ", topePrecio: 0.5, buscar: 'mochila para dron' },");
cambia("excluye: /dji|\\bdron|intelligent|flight|vuelo/, si: /dji/, topePrecio: 0.3, buscar: 'power bank' },",
  "excluye: /dji|\\bdron|intelligent|flight|vuelo/, si: " + NO_JUGUETE + ", topePrecio: 0.3, buscar: 'power bank' },");
cambia("excluye: /pilas|\\baaa?\\b|\\bauto\\b|carro|coche|inalambrico|laptop|solar|power ?bank|mah\\b/, si: /dji/, buscar: 'cargador de pared USB' },",
  "excluye: /pilas|\\baaa?\\b|\\bauto\\b|carro|coche|inalambrico|laptop|solar|power ?bank|mah\\b/, si: " + NO_JUGUETE + ", buscar: 'cargador de pared USB' },");
// el comentario de la clase: por qué no se mira «dji»
cambia("        // Graba en microSD y casi nunca viene incluida.",
  "        // Lo de un dron de verdad (no de juguete). El `si` no pide «dji»: se evalúa sobre el NOMBRE, y\n" +
  "        // el del DJI no lo dice («Drone Mini 5 Pro FMC RC2»): se quedaba sin nada (04/10/2026).\n" +
  "        // Graba en microSD y casi nunca viene incluida.");
fs.writeFileSync(ruta, s);
const vm = require('vm'); const ctx = vm.createContext({}); vm.runInContext(s, ctx);
console.log('ok · clases', ctx.VENTEL_REGLAS.clases.length, '· tipos', ctx.VENTEL_REGLAS.clases.reduce((a, c) => a + c.complementos.length, 0));
