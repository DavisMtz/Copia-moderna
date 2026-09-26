/*
 * Formatos en pestañas por uso (26/09/2026).   node pruebas/formatos_pestanas.test.js
 *
 * La sección sale de la hoja «Formatos» (ACCESO | OBSERVACIONES | LIGA), que editan personas:
 * cada formato se reconoce por su nombre y su enlace. El comportamiento vive en app_formatos.html.
 * Lo que se rompe sin que se vea:
 *   · una hoja de respuestas juntada con el formulario equivocado (el asesor revisa otro caso);
 *   · «Hacer una copia» en algo que no se copia, o la copia que pierde el id;
 *   · una fila nueva que no cae en ningún grupo y desaparece;
 *   · que el buscador, ?item= o switchSec vuelvan a llamar a lo que ya no existe;
 *   · que el segundo Enter de una hoja de respuestas abra el formulario (o al revés).
 * (formatos_cache.test.js es OTRA cosa: la caché de los formatos de cotización.)
 * Esta carpeta queda fuera de "Carpeta del proyecto": clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');
let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
}

const index = fs.readFileSync(path.join(PROY, 'Index.html'), 'utf8').replace(/\r\n/g, '\n');
const parcial = fs.readFileSync(path.join(PROY, 'app_formatos.html'), 'utf8').replace(/\r\n/g, '\n');
const indices = fs.readFileSync(path.join(PROY, 'app_indices.html'), 'utf8').replace(/\r\n/g, '\n');
const guion = parcial.slice(parcial.indexOf('<script>') + 8, parcial.lastIndexOf('</script>'));
const estilos = parcial.slice(parcial.indexOf('<style>') + 7, parcial.indexOf('</style>'));

/* Saca el texto de una función por su nombre (cuenta llaves, respeta cadenas). */
function fuente(nombre, texto) {
  texto = texto || guion;
  const i = texto.indexOf('function ' + nombre + '(');
  if (i < 0) return '';
  let d = 0, j = texto.indexOf('{', i), q = null;
  for (; j < texto.length; j++) {
    const c = texto[j];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && texto[j + 1] === '/') { j = texto.indexOf('\n', j); continue; }
    if (c === '{') d++;
    if (c === '}' && --d === 0) return texto.slice(i, j + 1);
  }
  return '';
}
const var_ = (nombre) => { const m = new RegExp('var ' + nombre + ' = ([\\s\\S]*?);\\n').exec(guion); return m ? m[1] : 'undefined'; };

/* El modelo y la fila del parcial, evaluados de verdad en un contexto aparte. */
const ctx = { console };
vm.runInNewContext(
  ['RESPUESTA', 'VACIAS', 'GRUPOS', 'REGLAS', 'TIPO'].map((n) => 'var ' + n + ' = ' + var_(n) + ';').join('\n') + '\n' +
  fuente('linkHref', index) + '\n' +
  'function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }\n' +
  'function icon(n){ return "<i:" + n + ">"; }\n' +
  'function hilite(t){ return esc(t); }\n' +
  'function collectBtn(tipo, nombre){ return "<star:" + tipo + ":" + nombre + ">"; }\n' +
  'function reportBtn(sec, nombre, liga){ return "<flag:" + sec + ":" + nombre + ":" + liga + ">"; }\n' +
  ['norm', 'tipoDe', 'copiaDe', 'alias', 'palabras', 'regla', 'grupoDe', 'esInstruccion', 'modelo', 'marca', 'dominio', 'fila'].map((n) => fuente(n)).join('\n') +
  '\nthis.api = { tipoDe, copiaDe, palabras, grupoDe, esInstruccion, modelo, fila, GRUPOS, TIPO };', ctx);
const A = ctx.api;

/* La hoja «Formatos» al 26/09/2026, tal cual (ACCESO, OBSERVACIONES, LIGA). */
const HOJA = [
  ["Cotizaciones", "Enviar antes al personal a cargo para autorizar el envió", "https://docs.google.com/spreadsheets/d/1vt8VzN4qp08zpOjagGGKSIpGbo2-sYxjV2YZfAOKqhE/edit?gid=2020430648#gid=2020430648"],
  ["Justificacion de retardos", "Subir la petición el mismo dia de la incidencia", "https://docs.google.com/forms/d/e/1FAIpQLSfoY5QR9xK64FWPi4kTI2om6bL-b3QoQq6LgmZBSAqdbw-lWw/viewform"],
  ["Permutas", "Solicitud para intercambiar el horario con un compañero.", "https://docs.google.com/forms/d/e/1FAIpQLSfA2KQ5Aa9Xmlp6EJ6J8gRRn6n67ke-H_HDWi8Es43TNaGYPw/viewform"],
  ["CAU", "Para desbloqueo de plataformas y cambio de contraseñas", "https://docs.google.com/forms/d/e/1FAIpQLSc5nQM9wD5PchWbIrLJqA82GV1lGgQPG2PzkgbjGXhuJ9ATmA/viewform"],
  ["Ticket de compra Liverpool", "Hacer una copia de este formato para editar, se hace copia de la info de FMS en la 2a pestaña del formato y se valida la info que este correcta en la 1a hoja, esta es la que se envia al cliente del correo postventaomnicanal", "https://docs.google.com/spreadsheets/d/1K1PYubMIpyIS5Ua8kE5GvMdGXPmziCjkuFkcjfS5FCc/edit?gid=1994657492#gid=1994657492"],
  ["Ticket de compra Suburbia", "Hacer una copia de este formato para editar, se hace copia de la info de FMS en la 2a pestaña del formato y se valida la info que este correcta en la 1a hoja, esta es la que se envia al cliente del correo postventaomnicanal, En caso que no te permita por FMS hacer el llenado manual", "https://docs.google.com/spreadsheets/d/1J7meFE4VR_B4M7CO7snhvrhv_MYR70y-MXLJT8JndPw/edit?gid=1994657492#gid=1994657492"],
  ["Vinculacion de Mesa de regalos", "Compras donde el cliente no ingreso el pedido al evento se puede solicitar se vincule por medio del drive", "https://docs.google.com/forms/d/e/1FAIpQLSecY6Qbdn64-yygX3N79NKkhzD9fk68Hl3AFUO5rA0zyPbZrg/viewform"],
  ["Directorio C&C", "Puedes encontar los correos del personal de C&C de las tiendas", "https://docs.google.com/spreadsheets/d/1ucVaAaIuKpg0kBf_gWAM5Z49CT3IIQwKPJeQyAGeXo8/edit?gid=1034482830#gid=1034482830"],
  ["Directorio de Tiendas", "Tienes la informacion mas relevantes de los contactos de las tiendas", "https://docs.google.com/spreadsheets/d/1RdfIDzXICHPzNBoWMqcBdAtMXe9rWf8a9_zLZa5FQkA/edit?gid=24678195#gid=24678195"],
  ["Directorio de CR", "Tienes los correos de los CR (Bodegas) mas importantes.", "https://docs.google.com/spreadsheets/d/1-Cy20vU8AsMLe3idVDnkC4RqH1MKG-QZT4Lu2qsjyDA/edit?gid=475610702#gid=475610702"],
  ["Sobregiro Formulario", "Formulario para solicitar el sobregiro a tarjetas Liverpool departamental", "https://docs.google.com/forms/d/e/1FAIpQLScp3qV0jN1zlwKMndbR9IHaDrQ2qaBvAvmSf0bbzqZ59ad8xA/viewform"],
  ["Hoja de Break", "Puedes colocar el tiempo que deseas tomar para tu descanso.", "https://docs.google.com/spreadsheets/d/1XEM7W5Ng5SyX7VjQnYR6djc6ucc74XfYacLKHRCTCDA/edit?gid=823445949#gid=823445949"],
  ["Formulario Centros de servicio (CS)", "Formulario para escalar informacion de garantias o instalacion de un bigticket", "https://docs.google.com/forms/d/e/1FAIpQLSfmaHpOuZhwu0erXrWlj-hl7ndJnCyRlte2cWs_0bQVO96wlw/viewform"],
  ["Formulario de Error de transferencias", "Aqui puedes reportar el uso inadecuado de transferencias a nuestra area.", "https://docs.google.com/forms/d/e/1FAIpQLSfyDrdKW450raX6rkfdK4XB-7U7R_MR5lfvlAb0HF88ZGH9kg/viewform?pli=1&pli=1"],
  ["Secciones Participantes MdR", "Aqui podemos consultar las seccion, direcciones, categorias que participan en casa mesa de regalo segun su tipo.", "https://docs.google.com/spreadsheets/d/1-CFx_hGT8WCjvnWzLRD6X7lx1HVJxrvZtsnYU7LgRf8/edit?gid=0#gid=0"],
  ["Sobregiro Drive Resultados", "", "https://docs.google.com/spreadsheets/d/1v1RHpN9rbHTldM2cdYAQ8qTXBR3OYw-R4-I_UJ6GZmE/edit?gid=1526269313#gid=1526269313"],
  ["Respuestas de Vinculacion a MDR", "", "https://docs.google.com/spreadsheets/d/15Y6duNVzgdqDNmx9eMA1bCOpQ3f0BO2pGmk9XrSaEO0/edit?gid=599003470#gid=599003470"],
  ["Respuestas de Pedidos sin regalo", "", "https://docs.google.com/spreadsheets/d/1-PXoK_sH4kN3pMdC3Wmhu-bKBgkabQibTqObGNWKWdg/edit?gid=0#gid=0"],
  ["Categorias de Garantia de satisfaccion", "", "https://docs.google.com/spreadsheets/d/13oRPQdLh4ptOmUlBfORA7t7deiUiU3ro60kcbs58Qlk/edit?gid=755171097#gid=755171097"],
  ["Respuestas/ Espejo centros de servicio (CS)", "", "https://docs.google.com/spreadsheets/d/1HZ8v_tN9FLRjXSOBU2a9sANo5m0GQ5EtcgontLO9sDE/edit?gid=0#gid=0"],
  ["Guardias de Area de soporte CCL (Ventas)", "", "https://docs.google.com/spreadsheets/d/1lzUNJObqEagmHCro4wfU0VaIj82JlDcLznI8uw9tCko/edit?gid=1838827861#gid=1838827861"],
  ["Logística PostVenta (Uniformulario) 2026", "", "https://docs.google.com/spreadsheets/d/18T6nD3o4G4pXiuTVA3C72vamUoQqD8XRCci_8Kiy6N4/edit?gid=455805556#gid=455805556"],
  ["Espejo de Resurtidos", "", "https://docs.google.com/spreadsheets/d/1QWIwdf5rsBjjPW7GmLRReZohqbAeryRTkETtS0OV_yM/edit?gid=186592386#gid=186592386"],
  ["Espejo Concluidos | Incidencias Logística PostVenta (Uniformulario) 2024", "", "https://docs.google.com/spreadsheets/d/1CL5kWRU3yY9j77FBC6vOCtXhadC2FbsYmy04V40ZWb0/edit?gid=1518835979#gid=1518835979"],
  ["Directorio Liverpool//SBB Actualizado", "", "https://docs.google.com/spreadsheets/d/1HAmRVhWrqscZn04SGR424IF-l8Nk-oJcFw1WuAZkFUo/edit?hl=es&forcehl=1&gid=0#gid=0"],
  ["Directorios de Tienda y CR", "", "https://lookerstudio.google.com/u/0/reporting/5b36f7b7-b8d2-4ff4-9d96-fd12ebeaecf6/page/p_td1whyghpd"],
  ["Trazabilidad Homologación Procesos 2026", "", "https://docs.google.com/spreadsheets/d/1EGCG2OaBAPOYPhUdAjIFj3OrDUYoQmIL7S81qEc8tzo/edit?gid=1943419342#gid=1943419342"],
  ["Casos | Rechazos Trazabilidad", "", "https://docs.google.com/spreadsheets/d/1dZCoWVLezEBWaagcISftQ89sexAlPjI-r4-eir1gNoc/edit?gid=0#gid=0"]
].map(([acceso, observaciones, liga]) => ({ acceso, observaciones, liga }));

console.log('1 · Tipo por el enlace');
{
  const casos = [
    ['https://docs.google.com/forms/d/e/1FAIpQLSc5nQ/viewform', 'form'],
    ['https://forms.gle/abc123', 'form'],
    ['https://docs.google.com/spreadsheets/d/1RdfIDzXICHPzNBo/edit#gid=0', 'hoja'],
    ['https://docs.google.com/document/d/1abc/edit', 'doc'],
    ['https://docs.google.com/presentation/d/1abc/edit', 'pres'],
    ['https://lookerstudio.google.com/u/0/reporting/5b36f7b7/page/p_1', 'tablero'],
    ['https://drive.google.com/drive/folders/1abc', 'drive'],
    ['https://www.liverpool.com.mx', 'web'],
    [null, 'sin']
  ];
  casos.forEach(([u, t]) => ok((u || '(sin enlace)').slice(0, 52) + ' → ' + t, A.tipoDe(u) === t, A.tipoDe(u)));
}

console.log('2 · «Hacer una copia» va directo al «Copiar documento» de Google');
{
  const lista = A.modelo(HOJA);
  const tk = lista.filter((x) => x.copia);
  ok('solo los dos tickets (su observación pide copia)', tk.length === 2 && tk.every((x) => /^Ticket de compra/.test(x.nombre)), tk.map((x) => x.nombre));
  ok('la copia es /copy sobre el mismo id, sin edit?gid=…', tk.every((x) => x.copia === x.href.replace(/\/edit.*$/, '/copy')) && tk[0].copia === 'https://docs.google.com/spreadsheets/d/1K1PYubMIpyIS5Ua8kE5GvMdGXPmziCjkuFkcjfS5FCc/copy', tk.map((x) => x.copia));
  ok('un formulario no se copia aunque la observación lo diga', A.copiaDe('https://docs.google.com/forms/d/e/1FAIpQLSabcdefghijklmnop/viewform', 'Hacer una copia') === null);
  ok('«copiar» o «copias» sin la palabra «copia» sola no cuentan', A.copiaDe('https://docs.google.com/spreadsheets/d/1abcdefghijklmnopqrstuvwxyz/edit', 'Se pueden copiar datos') === null);
  ok('«copia» con acento o mayúsculas sí cuenta', !!A.copiaDe('https://docs.google.com/document/d/1abcdefghijklmnopqrstuvwxyz/edit', 'HAZ UNA COPIA'));
}

console.log('3 · Cada hoja de respuestas con SU formulario, o sola');
{
  const lista = A.modelo(HOJA);
  const de = (n) => lista.find((x) => x.nombre === n);
  const resp = (n) => (de(n) ? de(n).respuestas.map((r) => r.nombre) : null);
  ok('Sobregiro Formulario ← Sobregiro Drive Resultados', JSON.stringify(resp('Sobregiro Formulario')) === '["Sobregiro Drive Resultados"]', resp('Sobregiro Formulario'));
  ok('Vinculación de Mesa de regalos ← Respuestas de Vinculación a MDR (MDR = mesa de regalos)', JSON.stringify(resp('Vinculacion de Mesa de regalos')) === '["Respuestas de Vinculacion a MDR"]', resp('Vinculacion de Mesa de regalos'));
  ok('Formulario Centros de servicio (CS) ← Respuestas/ Espejo centros de servicio (CS)', JSON.stringify(resp('Formulario Centros de servicio (CS)')) === '["Respuestas/ Espejo centros de servicio (CS)"]', resp('Formulario Centros de servicio (CS)'));
  ok('«Respuestas de Pedidos sin regalo» se queda SOLA (regalo ≠ regalos)', !!de('Respuestas de Pedidos sin regalo') && de('Respuestas de Pedidos sin regalo').grupo === 'seguimiento');
  ok('ninguna otra se junta: 3 pares, 25 formatos de 28 filas', lista.length === 25 && lista.reduce((n, x) => n + x.respuestas.length, 0) === 3, lista.length);
  const dudosa = A.modelo([
    { acceso: 'Alta de garantía', liga: 'https://docs.google.com/forms/d/e/1FAIpQLSa/viewform' },
    { acceso: 'Baja de garantía', liga: 'https://docs.google.com/forms/d/e/1FAIpQLSb/viewform' },
    { acceso: 'Respuestas garantía', liga: 'https://docs.google.com/spreadsheets/d/1abcdefghijklmnopqrstuvwxyz/edit' }
  ]);
  ok('si dos formularios comparten la palabra, la hoja no se junta con ninguno', dudosa.length === 3 && dudosa.every((x) => !x.respuestas.length));
  ok('un formulario nunca es hoja de respuestas (aunque se llame «Resultados…»)', A.modelo([{ acceso: 'Resultados del curso', liga: 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform' }])[0].grupo !== 'seguimiento');
}

console.log('4 · Grupos por uso');
{
  const lista = A.modelo(HOJA);
  const cuenta = (g) => lista.filter((x) => x.grupo === g).length;
  const esperado = { cliente: 8, contactos: 6, tuyo: 4, seguimiento: 5, otros: 2 };
  Object.keys(esperado).forEach((g) => ok(g + ': ' + esperado[g], cuenta(g) === esperado[g], lista.filter((x) => x.grupo === g).map((x) => x.nombre)));
  const en = (n, g) => ok('«' + n + '» → ' + g, (lista.find((x) => x.nombre === n) || {}).grupo === g, (lista.find((x) => x.nombre === n) || {}).grupo);
  en('Ticket de compra Suburbia', 'cliente');
  en('Secciones Participantes MdR', 'cliente');
  en('Categorias de Garantia de satisfaccion', 'cliente');
  en('Guardias de Area de soporte CCL (Ventas)', 'contactos');
  en('Directorios de Tienda y CR', 'contactos');
  en('CAU', 'tuyo');
  en('Hoja de Break', 'tuyo');
  en('Casos | Rechazos Trazabilidad', 'seguimiento');
  en('Formulario de Error de transferencias', 'otros');
  ok('una fila que no se reconoce va a «Otros formatos» (nunca desaparece)', A.grupoDe('Minuta semanal', '', false) === 'otros');
  ok('el nombre manda sobre la observación', A.grupoDe('Directorio de tiendas', 'Para dar al cliente el horario', false) === 'contactos');
  ok('si el nombre no dice nada, decide la observación', A.grupoDe('Hoja 7', 'Se le envía al cliente por correo', false) === 'cliente');
  ok('los grupos van en el orden que dio el creador', A.GRUPOS.map((g) => g.id).join() === 'cliente,contactos,tuyo,seguimiento,otros');
}

console.log('5 · Observaciones que son instrucción');
{
  const lista = A.modelo(HOJA);
  const instr = lista.filter((x) => x.instruccion).map((x) => x.nombre).sort();
  ok('cuatro: Cotizaciones, los dos tickets y Justificación de retardos', JSON.stringify(instr) === JSON.stringify(['Cotizaciones', 'Justificacion de retardos', 'Ticket de compra Liverpool', 'Ticket de compra Suburbia']), instr);
  ok('«Para desbloqueo…» describe, no ordena', A.esInstruccion('Para desbloqueo de plataformas y cambio de contraseñas') === false);
}

console.log('6 · La fila que se pinta');
{
  const lista = A.modelo(HOJA);
  const sob = A.fila(lista.find((x) => x.nombre === 'Sobregiro Formulario'), '');
  ok('lleva el nombre real de su hoja de respuestas (el buscador y ?item= llegan con él)', /class="fmt-rnom">Sobregiro Drive Resultados</.test(sob));
  const iPrin = sob.indexOf('class="fmt-prin fmt-ir"'), iResp = sob.indexOf('class="fmt-rir fmt-ir"');
  ok('el formulario va antes que sus respuestas: el segundo Enter de la fila abre el formulario', iPrin > 0 && iResp > iPrin, [iPrin, iResp]);
  ok('«Llenar el formulario» con el enlace de la hoja', sob.includes('>Llenar el formulario<') && sob.includes('href="https://docs.google.com/forms/d/e/1FAIpQLScp3qV0jN1zlwKMndbR9IHaDrQ2qaBvAvmSf0bbzqZ59ad8xA/viewform"'));
  const tk = A.fila(lista.find((x) => x.nombre === 'Ticket de compra Liverpool'), '');
  ok('el ticket: «Hacer una copia» a /copy y «Ver el original» a la hoja', /class="fmt-prin fmt-ir" href="[^"]*\/copy"/.test(tk) && />Hacer una copia</.test(tk) && /class="fmt-sec" href="[^"]*\/edit\?gid=1994657492/.test(tk));
  ok('el reporte y la colección llevan el nombre y la liga ORIGINAL', tk.includes('<flag:Formatos:Ticket de compra Liverpool:https://docs.google.com/spreadsheets/d/1K1PYubMIpyIS5Ua8kE5GvMdGXPmziCjkuFkcjfS5FCc/edit') && tk.includes('<star:formatos:Ticket de compra Liverpool>'));
  const sin = A.fila(A.modelo([{ acceso: 'Formato de prueba', observaciones: '', liga: 'Pedir a supervisión' }])[0], '');
  ok('sin enlace: «Sin enlace» sin botón', /class="fmt-prin is-off"/.test(sin) && !/fmt-ir/.test(sin));
  ok('las instrucciones llevan su marca', /class="fmt-obs es-instr"/.test(tk));
}

console.log('6b · El filtro no busca en la LIGA');
{
  /* Otro contexto: el norm() de Index (t llega normalizado con él) va en window.norm; el del parcial
     se queda como norm. todas() y coincide() se evalúan de verdad sobre la hoja. */
  const c2 = { console, Map, Set };
  vm.runInNewContext(
    'var window = {}; window.norm = (function(){ ' + fuente('norm', index) + ' return norm; })();\n' +
    ['RESPUESTA', 'VACIAS', 'GRUPOS', 'REGLAS', 'TIPO'].map((n) => 'var ' + n + ' = ' + var_(n) + ';').join('\n') + '\n' +
    fuente('linkHref', index) + '\n' +
    ['norm', 'tipoDe', 'copiaDe', 'alias', 'palabras', 'regla', 'grupoDe', 'esInstruccion', 'modelo', 'todas', 'coincide'].map((n) => fuente(n)).join('\n') +
    '\nvar memo = null, memoDe = null, porFila = new Map();' +
    '\nthis.api = { coincide: coincide, setStore: function(f){ store = { formatos: f }; }, norm: window.norm };\nvar store = { formatos: [] };', c2);
  const B = c2.api;
  B.setStore(HOJA);
  const filtra = (q) => HOJA.filter((f) => B.coincide(f, B.norm(q))).map((f) => f.acceso);
  ok('«cs» → solo el formulario de Centros de servicio y su hoja de respuestas', JSON.stringify(filtra('cs').sort()) === JSON.stringify(['Formulario Centros de servicio (CS)', 'Respuestas/ Espejo centros de servicio (CS)']), filtra('cs'));
  ok('«tablero» → el tablero de Looker', JSON.stringify(filtra('tablero')) === '["Directorios de Tienda y CR"]', filtra('tablero'));
  const forms = HOJA.filter((f) => /docs\.google\.com\/forms\//.test(f.liga)).map((f) => f.acceso);
  ok('«formulario» → los 7 formularios, aunque su nombre no lo diga', forms.length === 7 && forms.every((n) => filtra('formulario').includes(n)), filtra('formulario'));
  ok('«docs» y «google» no encuentran nada (están en todas las ligas)', filtra('docs').length === 0 && filtra('google').length === 0);
  ok('«copia» → los dos tickets', JSON.stringify(filtra('copia').sort()) === JSON.stringify(['Ticket de compra Liverpool', 'Ticket de compra Suburbia']), filtra('copia'));
  ok('«sobregiro» → el formulario y su hoja de resultados', filtra('sobregiro').length === 2);
}

console.log('6c · Segundo Enter, iconos y teléfono');
{
  const lista = A.modelo(HOJA);
  const sob = A.fila(lista.find((x) => x.nombre === 'Sobregiro Formulario'), '');
  ok('el formulario dice qué hará el segundo Enter', sob.includes('data-accion="llenar el formulario «Sobregiro Formulario»"'));
  ok('su hoja de respuestas también', sob.includes('data-accion="abrir «Sobregiro Drive Resultados»"'));
  const tk = A.fila(lista.find((x) => x.nombre === 'Ticket de compra Liverpool'), '');
  ok('el ticket: «hacer una copia de…»', tk.includes('data-accion="hacer una copia de «Ticket de compra Liverpool»"'));
  const ics = A.GRUPOS.map((g) => g.ic);
  ok('cada pestaña con su icono (clock e history son el mismo dibujo)', new Set(ics).size === ics.length && !(ics.includes('clock') && ics.includes('history')), ics);
  ok('con poco ancho se va la palabra, no la cifra', /@container fmt \(max-width:65em\)\{[^@]*\.fmt-nw\{display:none\}/.test(estilos) && !/\.fmt-tab small\{display:none\}/.test(estilos));
  ok('en Carbón el botón no se aclara al pasar el cursor (4.5:1)', !/\[data-theme="carbon"\] \.fmt-prin:hover\{background:var\(--brand-bright\)\}/.test(estilos));
  ok('el destino del buscador lleva una marca fija (.es-destino)', /\.fmt-fila\.es-destino\{/.test(estilos) && /classList\.add\('es-destino'\)/.test(guion));
}

console.log('7 · Marcado de la sección');
{
  const i0 = index.indexOf('<section id="sec-formatos"'), i1 = index.indexOf('</section>', i0);
  const sec = index.slice(i0, i1);
  ok('la sección existe una vez', i0 > 0 && index.indexOf('<section id="sec-formatos"', i0 + 1) < 0);
  ok('h1 solo para lectores de pantalla, sin encabezado visible', /<h1 class="fmt-sr">Formatos<\/h1>/.test(sec) && !/sec-head|sec-eyebrow|sec-title/.test(sec));
  ok('el filtro de siempre (filterSec) con nombre accesible', /aria-label="Filtrar formatos" oninput="filterSec\('formatos',this\.value\)"/.test(sec));
  ok('conserva rc-, ld- y gr-formatos y trae la pista de Enter', /id="rc-formatos"/.test(sec) && /id="ld-formatos" class="fmt-sk"/.test(sec) && /id="gr-formatos" class="fmt-cuerpo"/.test(sec) && /id="fmtEnter" hidden/.test(sec));
  ok('la vista de diseño trae filas reales (un formulario con su hoja de respuestas)', /acceso:'Sobregiro Formulario'/.test(index) && /acceso:'Sobregiro Drive Resultados'/.test(index) && !/Formato de Devolución/.test(index));
}

console.log('8 · Enganches con el guion grande');
{
  const cuerpo = (nombre) => fuente(nombre, index);
  ok('Index incluye el parcial', /<\?!= include\('app_formatos'\) \?>/.test(index));
  ok('switchSec llama a fmtAlEntrar', /if \(id === 'formatos' && window\.fmtAlEntrar\) fmtAlEntrar\(\);/.test(cuerpo('switchSec')));
  ok('revealTarget pasa por fmtRevelar y reconoce a.fmt-ir para el segundo Enter', /fmtRevelar\(scrollEl\)/.test(cuerpo('revealTarget')) && /a\.fmt-ir/.test(cuerpo('revealTarget')));
  ok('elementoDeSeccion busca .fmt-nom y .fmt-rnom y sube a .fmt-resp o .fmt-fila', /\.fmt-nom,\.fmt-rnom/.test(cuerpo('elementoDeSeccion')) && /\.fmt-resp,\.fmt-fila/.test(cuerpo('elementoDeSeccion')));
  ok('sectionEnter anima pestañas y hoja visible', /\.fmt-tabs, \.fmt-hoja:not\(\[hidden\]\)/.test(cuerpo('sectionEnter')));
  ok('el menú cuenta formatos con fmtContar', /setCount\('formatos', window\.fmtContar \? fmtContar\(store\.formatos\) : store\.formatos\.length\);/.test(index));
  ok('Index ya no define renderF (el del parcial no se pisa)', !/function renderF\(/.test(index));
  const viejas = ['fmt-card', 'fmt-head', 'fmt-emoji', 'fmt-name'].filter((c) => new RegExp('\\.' + c + '\\b|class="[^"]*\\b' + c + '\\b').test(index));
  ok('no queda CSS ni marcado de las tarjetas viejas', viejas.length === 0, viejas);
  ok('el parcial publica renderF, fmtContar, fmtAlEntrar y fmtRevelar', ['renderF', 'fmtContar', 'fmtAlEntrar', 'fmtRevelar'].every((n) => new RegExp('window\\.' + n + ' = function').test(guion)));
  ok('[hidden] le gana a la hoja y a la pista', /\.fmt-hoja\[hidden\]\{display:none\}/.test(estilos) && /\.fmt-enter\[hidden\]\{display:none\}/.test(estilos));
  ok('cambiar de pestaña no repinta (el destino del buscador sigue siendo el mismo nodo)', !/renderF|innerHTML/.test(fuente('elegir')));
  ok('Enter con un solo formato que coincidió por su hoja de respuestas abre esa hoja', /set\.has\(x\.fila\) \? null : x\.respuestas\.filter/.test(guion) && /window\.open\(unica\.href, '_blank', 'noopener'\)/.test(guion));
  ok('pestañas con el patrón de ARIA (tablist, tab, tabpanel, aria-controls)', /role="tablist"/.test(guion) && /role="tab"/.test(guion) && /role="tabpanel"/.test(guion) && /aria-controls="fmt-p-/.test(guion));
  ok('el buscador encuentra la sección por lo que tiene dentro', /id:'formatos'[^\n]*kw:'[^']*formularios[^']*directorio[^']*sobregiro/.test(indices));
  ok('filterSec y applySectionSearch filtran Formatos con fmtCoincide (sin LIGA)', /coincideEnSeccion\(sec, item, t\)/.test(cuerpo('filterSec')) && /coincideEnSeccion\(sec, item, t\)/.test(cuerpo('applySectionSearch')) && /sec === 'formatos' && window\.fmtCoincide/.test(cuerpo('coincideEnSeccion')));
  ok('clearPendingOpen quita la marca fija del destino', /es-destino/.test(cuerpo('clearPendingOpen')));
  ok('la pista del segundo Enter usa el data-accion del enlace', /getAttribute\('data-accion'\)/.test(cuerpo('revealTarget')));
  ok('las filas reales de la vista de diseño van rotuladas como reales', /Filas REALES de la hoja «Formatos»/.test(index));
}

console.log('\n' + '─'.repeat(45));
if (fallos) { console.log('✖ ' + fallos + ' de ' + total + ' comprobaciones fallaron'); process.exit(1); }
console.log('TODO OK · ' + total + ' comprobaciones');
