/*
 * Plantillas en «puertas de situación» (26/09/2026).   node pruebas/plantillas.test.js
 *
 * La hoja «Plantillas» (Titulo | Tipo | Asunto | Cuerpo | Consideraciones) la editan personas, y el
 * modelo de app_plantillas.html la lee sin cambiarla. Lo que se rompe sin que se vea:
 *   · una plantilla que desaparece (una regla que no la reconoce y no la manda a «Otros casos»);
 *   · un dato que se pide dos veces, o dos datos distintos que se funden en uno (la «Fecha» de
 *     «Entregas especiales» no es la de «Pedido especial»);
 *   · un texto copiado que pierde un renglón, o que lleva la instrucción que el creador pidió
 *     dejar fuera («(ANEXA EVIDENCIA CSC Y PÁGINA)»);
 *   · Gmail sin seguimientos-cat en CC;
 *   · las cuatro de «Correos a clientes» colándose otra vez en la sección, en el buscador o en la
 *     cuenta del menú;
 *   · lo que teclea el asesor (hay un campo «Tarjeta completa») guardado en el navegador;
 *   · que switchSec, el buscador o ?item= vuelvan a llamar a lo que ya no existe.
 * El caso fijo es la hoja tal como la leyó el Drive del creador el 26/09/2026 (15 filas).
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
const leer = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const index = leer(path.join(PROY, 'Index.html'));
const parcial = leer(path.join(PROY, 'app_plantillas.html'));
const indices = leer(path.join(PROY, 'app_indices.html'));
const comando = leer(path.join(PROY, 'app_comando.html'));
const HOJA = JSON.parse(fs.readFileSync(path.join(__dirname, 'plantillas_hoja_20260926.json'), 'utf8'));
const guion = parcial.slice(parcial.indexOf('<script>') + 8, parcial.lastIndexOf('</script>'));
const estilos = parcial.slice(parcial.indexOf('<style>') + 7, parcial.indexOf('</style>'));
const guionIdx = indices.slice(indices.indexOf('<script>') + 8, indices.lastIndexOf('</script>'));
const texto = (h) => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const sinAcentos = (s) => String(s).normalize('NFD').replace(/[^\s -~]/g, '').toLowerCase();

/* El parcial de verdad, con los índices de verdad, lo que usa del Portal fingido y una ventana a sus piezas. */
function cargar(opts) {
  opts = opts || {};
  const cierre = guion.lastIndexOf('})();');
  const js = guion.slice(0, cierre) +
    'window.__plt = { modelo: modelo, plantilla: plantilla, resolver: resolver, faltan: faltan, gmailUrl: gmailUrl, coincide: coincide, ' +
    'redactorHTML: redactorHTML, abiertaHTML: abiertaHTML, puerta: puerta, grupos: grupos, SITUACIONES: SITUACIONES, ' +
    'consideraciones: consideraciones, enOracion: enOracion, esInstruccion: esInstruccion, correosClienteHTML: correosClienteHTML, ' +
    'VAL: VAL, abierto: abierto, todas: todas, valores: valores, hoy: hoy, faltanHTML: faltanHTML };\n' + guion.slice(cierre);
  const ctx = { console, Date };
  ctx.window = ctx;
  ctx.document = { addEventListener() {}, querySelectorAll() { return []; }, getElementById() { return null; } };
  ctx.esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  ctx.icon = (n) => '<svg class="ic" data-i="' + n + '"></svg>';
  ctx.hilite = (t, q) => ctx.esc(t).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i'), '<mark>$1</mark>');
  ctx.collectBtn = (tipo, nombre) => '<button class="collect-btn" data-ctype="' + tipo + '" data-cname="' + ctx.esc(nombre) + '"></button>';
  ctx.reportBtn = (sec, nombre) => '<button class="btn-report" data-sec="' + sec + '" data-name="' + ctx.esc(nombre) + '"></button>';
  ctx.linkHref = (v) => (v ? String(v) : null);
  ctx.store = { plantillas: [], formatos: opts.formatos || [] };
  const permitidas = opts.permitidas || ['tpl-ticket', 'tpl-edo', 'tpl-edoext', 'tpl-ok'];
  ctx.appActionsPermitidas = () => permitidas.map((id) => ({ id }));
  vm.runInNewContext(guionIdx, ctx, { filename: 'app_indices.html' });
  vm.runInNewContext(js, ctx, { filename: 'app_plantillas.html' });
  return ctx;
}
const W = cargar({ formatos: [{ acceso: 'Directorios de Tienda y CR', liga: 'https://lookerstudio.google.com/u/0/reporting/x' }] });
const P = W.__plt;
const M = P.modelo(HOJA);
const por = (t) => M.filter((p) => p.titulo === t)[0];
const campo = (p, clave) => p.campos.filter((c) => c.clave === clave)[0];

console.log('1) Lo que se ve: 11 plantillas en 8 situaciones; las 4 de «Correos a clientes», fuera');
ok('la hoja del 26/09 trae 15 plantillas: 11 de correo y 4 de Salesforce', HOJA.length === 15 &&
  HOJA.filter((f) => /correo/i.test(f.tipo)).length === 11 && HOJA.filter((f) => /sales/i.test(f.tipo)).length === 4);
const movidas = HOJA.filter((f) => W.AppIndices.correoDeCliente(f)).map((f) => f.titulo + ' → ' + W.AppIndices.correoDeCliente(f).tpl);
ok('las cuatro que el creador mandó a «Correos a clientes» se reconocen, cada una con su plantilla de allá',
  JSON.stringify(movidas) === JSON.stringify(['Correo de Ticket → ticket', 'Solicitud de estado de cuenta PF → edodecuenta',
    'Solicitud de estado de cuenta tarjeta externa PF → edodecuentaextranjera', 'Validacion Prevencion de Fraudes → validacionexitosa']), movidas);
ok('Cotizaciones es un correo al cliente pero se queda (el creador solo quitó esas cuatro)', !!por('Cotizaciones'));
ok('quedan 11, y ninguna de las cuatro', M.length === 11 && !M.some((p) => /ticket|estado de cuenta|validacion/i.test(p.titulo)), M.map((p) => p.titulo));
ok('un caso de Salesforce que diga «ticket» no se va (solo los correos)', !W.AppIndices.correoDeCliente({ titulo: 'Ticket de compra', tipo: 'Sales Force' }));
ok('pltDeLaHoja deja fuera las mismas cuatro (la usa onToolsData)', W.pltDeLaHoja(HOJA).length === 11 && W.pltDeLaHoja(null).length === 0);
const SIT = {
  'Cotizaciones': 'cotizacion', 'Solicitud de pedido especial': 'volumen', 'Diferir pago': 'promocion',
  'Ajuste promociones por error en CSC': 'promocion', 'Articulo de regalo faltante': 'promocion', 'Entregas especiales': 'fecha',
  'Resurtidos y mensajerias': 'llego-mal', 'Resurtidos BT y Recogidos': 'llego-mal',
  'ENR mensajerias externas (Entregas no reconocidas)': 'no-reconoce', 'Digitales': 'digitales', 'Bonificacion | Devolucion': 'devolucion'
};
Object.keys(SIT).forEach((t) => ok('«' + t + '» va a «' + P.SITUACIONES.filter((s) => s.id === SIT[t])[0].nombre + '»', por(t) && por(t).situacion === SIT[t], por(t) && por(t).situacion));
ok('una plantilla nueva que no dice su caso va a «Otros casos» (nunca desaparece)', P.plantilla({ titulo: 'Aviso de cambio de horario', tipo: 'Correo', cuerpo: 'x' }, {}).situacion === 'otros');
ok('las 11 caen en 8 situaciones y «Otros casos» queda vacío', new Set(M.map((p) => p.situacion)).size === 8 && !M.some((p) => p.situacion === 'otros'));
ok('los id son únicos y estables (salen del nombre)', new Set(M.map((p) => p.id)).size === 11 && por('Diferir pago').id === 'plt-diferir-pago');

console.log('2) Cada dato una vez');
const dif = por('Diferir pago');
ok('Diferir pago: [Numero de pedido], [Pedido] y [Numero del pedido] son UN campo que va 3 veces', campo(dif, 'pedido') && campo(dif, 'pedido').usos === 3 && dif.campos.length === 4,
  dif.campos.map((c) => c.etiqueta + '×' + c.usos));
ok('Ajuste promociones: el [Numero] del asunto («…pedido [Numero]») es el pedido', campo(por('Ajuste promociones por error en CSC'), 'pedido').usos === 3);
ok('Bonificación: el pedido va 3 veces y «SKU´s a bonificar» conserva su etiqueta', campo(por('Bonificacion | Devolucion'), 'pedido').usos === 3 &&
  campo(por('Bonificacion | Devolucion'), 'sku').etiqueta === 'SKU´s a bonificar');
const ee = por('Entregas especiales'), pe = por('Solicitud de pedido especial');
ok('Entregas especiales: el pedido del asunto y el del cuerpo son uno; «Fecha deseada» va aparte', campo(ee, 'pedido').usos === 2 &&
  ee.campos.map((c) => c.etiqueta).join('|') === 'Número de pedido|Fecha deseada', ee.campos.map((c) => c.etiqueta));
ok('Pedido especial: [cantidad] son las piezas, [codigo del prodructo] el SKU y la fecha es «de entrega requerida»',
  pe.campos.map((c) => c.etiqueta).join('|') === 'Nombre del cliente|Piezas|SKU|Monto|Fecha de entrega requerida|Método de pago', pe.campos.map((c) => c.etiqueta));
const cuenta = { 'Cotizaciones': 1, 'Solicitud de pedido especial': 6, 'Diferir pago': 4, 'Ajuste promociones por error en CSC': 6, 'Articulo de regalo faltante': 6,
  'Entregas especiales': 2, 'Resurtidos y mensajerias': 10, 'Resurtidos BT y Recogidos': 11, 'ENR mensajerias externas (Entregas no reconocidas)': 8, 'Digitales': 8, 'Bonificacion | Devolucion': 6 };
ok('cuántos datos pide cada una', Object.keys(cuenta).every((t) => por(t).campos.length === cuenta[t]), M.map((p) => p.titulo + ':' + p.campos.length));
ok('ningún corchete se queda sin campo', M.every((p) => p.asunto.concat(p.cuerpo).every((t) => t.t !== 'campo' || !!campo(p, t.clave))));
const bt = por('Resurtidos BT y Recogidos'), rm = por('Resurtidos y mensajerias');
ok('[Si/No] es Sí | No (las tres de Resurtidos BT)', bt.campos.filter((c) => c.tipo === 'opciones' && c.opciones.join('/') === 'Sí/No').length === 3);
ok('[(Mercancía Equivocada, Incompleta, Dañada)] son tres opciones', rm.campos.some((c) => c.tipo === 'opciones' && c.opciones.join('/') === 'Mercancía Equivocada/Incompleta/Dañada'));
ok('«Resurtido o Devolución:» ofrece las dos', rm.campos.some((c) => c.etiqueta === 'Resurtido o Devolución' && c.opciones && c.opciones.join('/') === 'Resurtido/Devolución'));
ok('las preguntas guía («¿Qué daño es?…») son un texto largo, no opciones', rm.campos.some((c) => c.tipo === 'largo' && /Qué daño es/.test(c.guia)));
ok('«si fuera el caso», «en caso…» y «solo para motos» son opcionales',
  campo(rm, 'e:rem hija (si fuera el caso)').opcional && bt.campos.filter((c) => c.opcional).map((c) => c.etiqueta).join('|') === 'Mismo domicilio (en caso que sea diferente ingresarlo)|Número de serie solo para motos');
ok('el primer renglón de un caso («Resurtidos y mensajerias: [Tipo]») se llama «Tipo»', rm.campos[0].etiqueta === 'Tipo' && bt.campos[0].etiqueta === 'Tipo');
ok('formatos: tarjeta, fecha, monto, teléfono y correo', campo(dif, 'e:tarjeta completa').formato === 'tarjeta' && campo(dif, 'e:fecha').formato === 'fecha' &&
  campo(por('Ajuste promociones por error en CSC'), 'e:monto a bonificar').formato === 'monto' && campo(bt, 'e:telefono de contacto').formato === 'tel' &&
  campo(por('Digitales'), 'e:correo cliente').formato === 'correo');
ok('el pedido pide números, pero el SKU no (puede llevar letras)', campo(dif, 'pedido').formato === 'numero' && campo(pe, 'sku').formato === '');

console.log('3) El texto que sale');
const norm1 = (s) => String(s).split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
const sinInstr = (s) => norm1(String(s).replace(/\r\n?/g, '\n').split('\n').filter((l) => !P.esInstruccion(l)).join('\n'));
ok('sin llenar, el cuerpo es el de la hoja renglón por renglón (menos las instrucciones y los espacios del final)',
  M.every((p) => P.resolver(p.cuerpo, {}, p.campos.map((c) => Object.assign({}, c, { opcional: false }))) === sinInstr(p.fila.cuerpo)),
  M.filter((p) => P.resolver(p.cuerpo, {}, p.campos.map((c) => Object.assign({}, c, { opcional: false }))) !== sinInstr(p.fila.cuerpo)).map((p) => p.titulo));
ok('sin llenar, el asunto es el de la hoja', M.filter((p) => p.canal === 'correo').every((p) => P.resolver(p.asunto, {}, p.campos) === String(p.fila.asunto).trim()));
ok('las instrucciones son exactamente dos, y son recordatorio', JSON.stringify(M.map((p) => p.recordatorios).filter((r) => r.length)) ===
  JSON.stringify([['Anexa evidencia CSC y página'], ['Enviar evidencia de SAP y SOMS']]), M.map((p) => p.recordatorios));
ok('…y no salen en el texto copiado', !/ANEXA EVIDENCIA/.test(P.resolver(dif.cuerpo, {}, dif.campos)) && !/ENVIAR EVIDENCIA/.test(P.resolver(por('Bonificacion | Devolucion').cuerpo, {}, [])));
ok('ningún otro renglón en mayúsculas se toma por instrucción (el asunto «PEDIDO … DIFERIR A MES» no cuenta)', HOJA.every((f) => String(f.cuerpo).split('\n').filter((l) => P.esInstruccion(l)).length <= 1) &&
  !P.esInstruccion('PEDIDO [Numero de pedido] DIFERIR A MES'));
const v = { pedido: '1234567890', 'e:fecha': '26/09/2026', 'e:tarjeta completa': '4152313800001234', 'e:promocion solicitada': '12 MSI' };
const sale = P.resolver(dif.cuerpo, v, dif.campos);
ok('lo escrito se pone en TODOS los lugares del dato', (sale.match(/1234567890/g) || []).length === 2 && P.resolver(dif.asunto, v, dif.campos) === 'PEDIDO 1234567890 DIFERIR A MES');
ok('un dato vacío que hace falta sale como [corchete] (para que se note)', /Tarjeta completa: \[Numero de tarjeta\]/.test(P.resolver(dif.cuerpo, { pedido: '1' }, dif.campos)));
ok('un dato opcional vacío sale vacío («Rem Hija (si fuera el caso): »)', /^Rem Hija \(si fuera el caso\): $/m.test(P.resolver(rm.cuerpo, {}, rm.campos)));
ok('«Faltan» cuenta solo lo obligatorio', P.faltan(dif, v).length === 0 && P.faltan(dif, {}).length === 4 && P.faltan(bt, {}).length === 9);
{
  const fb = texto(P.faltanHTML(por('Bonificacion | Devolucion'), {})), fr = texto(P.faltanHTML(rm, { 'e:resurtidos y mensajerias': 'x', pedido: '1', sku: 'x', piezas: '1' }));
  ok('«Faltan» recorta una etiqueta larga en el último espacio («Explicar motivos por…»), no a media palabra', /Explicar motivos por…,/.test(fb) && !/por lo…/.test(fb), fb);
  ok('…y la lista completa va en el title', /title="Número de pedido, Explicar motivos por los que se solicita la dev\/boni, Fecha, Total de compra, Monto a bonificar, SKU´s a bonificar"/.test(P.faltanHTML(por('Bonificacion | Devolucion'), {})));
  ok('…«Mercancía maltratada; Especificar daño…» no sale como «…; E…»', !/; E…/.test(fr), fr);
}

console.log('4) A quién va');
const aj = por('Ajuste promociones por error en CSC');
ok('«SE ENVÍA A SUPERVISORES Y TEAM LEADER» → Para: supervisores y team leader', aj.destino.para === 'supervisores y team leader', aj.destino);
ok('Diferir pago dice «supervisoras»: se respeta', dif.destino.para === 'supervisoras y team leader');
ok('Entregas especiales: Para asesores CR, Copia supervisores y team leader, y la nota del directorio',
  ee.destino.para === 'asesores CR' && ee.destino.copia === 'supervisores y team leader' && JSON.stringify(ee.destino.notas) === JSON.stringify(['Usa el directorio de CR´s']), ee.destino);
ok('los «UNA VEZ QUE…» son «Después», en oración y con las siglas (CTE, SAP) intactas',
  aj.destino.despues[0] === 'Una vez que CTE tenga la mercancía se sube a SAP y se manda evidencia sobre el mismo correo', aj.destino.despues);
ok('seguimientos-cat va en CC en las cuatro que lo nombran', M.filter((p) => p.destino.cc.join() === 'seguimientos-cat@liverpool.com.mx').map((p) => p.titulo).join('|') ===
  'Ajuste promociones por error en CSC|Articulo de regalo faltante|Bonificacion | Devolucion|Entregas especiales');
ok('las consideraciones no pierden ninguna palabra', M.every((p) => {
  const hay = sinAcentos([p.destino.para, p.destino.copia, p.destino.cc.join(' '), p.destino.despues.join(' '), p.destino.notas.join(' '), 'se envia a y copia a'].join(' '));
  return sinAcentos(p.fila.consideraciones).split(/[^a-z0-9@.´-]+/).filter(Boolean).every((w) => hay.indexOf(w.replace(/\.$/, '')) > -1);
}));
const g = P.gmailUrl(aj, { pedido: '99' });
ok('Gmail: asunto, cuerpo y seguimientos-cat en CC', /^https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&su=/.test(g) && /&cc=seguimientos-cat%40liverpool\.com\.mx$/.test(g) &&
  decodeURIComponent(g.split('&su=')[1].split('&')[0]) === 'Ajuste promoción no aplicada (2x1 / 3x2 / o descuento) pedido 99');
ok('Gmail sin CC cuando la hoja no nombra correo', !/&cc=/.test(P.gmailUrl(dif, {})));
ok('Gmail no lleva la instrucción', !/ANEXA/.test(decodeURIComponent(P.gmailUrl(dif, {}))));

console.log('5) El redactor');
const hDif = P.redactorHTML(dif), hBt = P.redactorHTML(bt), hEe = P.redactorHTML(ee), hCot = P.redactorHTML(por('Cotizaciones'));
ok('un correo sin tarjeta: «Abrir en Gmail» (un enlace a Gmail en pestaña nueva) y «Copiar cuerpo»', /<a class="plr-prin" data-pl="gmail" href="https:\/\/mail\.google\.com[^"]*" target="_blank" rel="noopener">/.test(hEe) && /data-pl="copiar-cuerpo"/.test(hEe));
const conT = M.filter((p) => /data-pl="gmail-copia"/.test(P.redactorHTML(p))).map((p) => p.titulo);
ok('las dos que piden la tarjeta completa copian el cuerpo y abren Gmail sin él (decisión del creador)', conT.join('|') === 'Diferir pago|Ajuste promociones por error en CSC', conT);
ok('…en su HTML no hay ningún enlace a Gmail con el cuerpo, y lo dicen («Lleva la tarjeta… Pégalo con Ctrl V»)', !/mail\.google\.com/.test(hDif) && /Lleva la tarjeta: Gmail abre sin el cuerpo/.test(hDif) && /Copiar y abrir Gmail/.test(hDif));
ok('…y el enlace que abren lleva asunto y CC pero no &body=', !/&body=/.test(P.gmailUrl(aj, { 'e:tarjeta completa': '4152313800001234' }, true)) && /&cc=seguimientos-cat/.test(P.gmailUrl(aj, {}, true)));
ok('las demás de correo siguen abriendo Gmail con el cuerpo', M.filter((p) => p.canal === 'correo' && conT.indexOf(p.titulo) < 0).every((p) => /data-pl="gmail" href="[^"]*&amp;body=/.test(P.redactorHTML(p))));
ok('un caso: «Copiar para Salesforce» y nada de Gmail', /data-pl="copiar-sf"/.test(hBt) && !/data-pl="gmail"/.test(hBt) && /Caso · Salesforce/.test(texto(hBt)));
ok('el pedido dice «va 3 veces» y lleva teclado numérico', /Número de pedido<em>va 3 veces<\/em>/.test(hDif) && /data-clave="pedido"[^>]*inputmode="numeric"/.test(hDif));
ok('la fecha tiene «Hoy» y la tarjeta no se autocompleta', /data-pl="hoy" data-clave="e:fecha"/.test(hDif) && /data-clave="e:tarjeta completa"[^>]*autocomplete="off"[^>]*inputmode="numeric"/.test(hDif));
ok('«Antes de enviar» y «Después» van junto a los botones, antes del texto', hDif.indexOf('data-pl="gmail-copia"') > -1 && hDif.indexOf('Antes de enviar') > hDif.indexOf('data-pl="gmail-copia"') && hDif.indexOf('Antes de enviar') < hDif.indexOf('plr-hoja') &&
  P.redactorHTML(aj).indexOf('Después:') < P.redactorHTML(aj).indexOf('plr-hoja'));
ok('la nota del directorio enlaza al de Formatos', /<a class="plr-link" href="https:\/\/lookerstudio[^"]*" target="_blank" rel="noopener">Directorios de Tienda y CR/.test(hEe));
{
  const conCR = cargar({ formatos: [{ acceso: 'Directorio de Tiendas', liga: 'https://x/tiendas' }, { acceso: 'Directorios de Tienda y CR', liga: 'https://x/looker' },
    { acceso: 'Directorio de CR', liga: 'https://x/cr' }] }).__plt;
  ok('con los directorios de la hoja real, la nota lleva al «Directorio de CR» (el que solo trae CR)',
    /href="https:\/\/x\/cr" target="_blank" rel="noopener">Directorio de CR/.test(conCR.redactorHTML(conCR.modelo(HOJA).filter((p) => p.titulo === 'Entregas especiales')[0])));
  const sinCR = cargar({ formatos: [{ acceso: 'Directorio de Tiendas', liga: 'https://x/tiendas' }] }).__plt;
  ok('…y si solo hay el de tiendas, la nota va sin enlace (los correos que pide son los de los CR)',
    !/plr-link/.test(sinCR.redactorHTML(sinCR.modelo(HOJA).filter((p) => p.titulo === 'Entregas especiales')[0])));
}
ok('Para, Copia y CC se ven; supervisores y TL «los escribes tú»', /<dt>Para<\/dt><dd>asesores CR <small>los escribes tú<\/small>/.test(hEe) && /<dt>CC<\/dt><dd><code>seguimientos-cat@liverpool\.com\.mx<\/code>/.test(hEe));
ok('Sí | No son botones que se oprimen, en un grupo con nombre (tres en Resurtidos BT, dos en Resurtidos y mensajerías)', (hBt.match(/role="group" aria-labelledby="[^"]+"/g) || []).length === 3 &&
  (P.redactorHTML(rm).match(/role="group" aria-labelledby="[^"]+"/g) || []).length === 2 && /data-v="Sí" aria-pressed="false"/.test(hBt));
ok('cada campo de texto tiene su <label for> y el botón «Hoy» va fuera de la etiqueta', (hDif.match(/<label class="plr-lbl" for="plt-diferir-pago--[^"]+">/g) || []).length === 4 &&
  !/<label[^>]*>(?:(?!<\/label>)[\s\S])*plr-hoy/.test(hDif) && [...hDif.matchAll(/<label class="plr-lbl" for="([^"]+)"/g)].every((m) => hDif.indexOf('id="' + m[1] + '"') > -1));
ok('«Faltan» se anuncia a los lectores de pantalla (y solo se reescribe si cambia)', /class="plr-estado" data-parte="faltan" aria-live="polite"/.test(hDif) && guion.indexOf('if (f && f.innerHTML !== fh) f.innerHTML = fh;') > -1);
ok('el nombre lleva .plt-name (el buscador lo encuentra) y la estrella y el reporte se quedan', /class="plr-nom plt-name">Diferir pago</.test(hDif) &&
  /data-ctype="plantillas" data-cname="Diferir pago"/.test(hDif) && /class="btn-report" data-sec="Plantillas" data-name="Diferir pago"/.test(hDif));
ok('Cotizaciones pide un solo dato (en singular) y no dice «Faltan» vacío', /<span>1 dato<\/span>/.test(hCot));
P.VAL['plt-diferir-pago'] = { pedido: '777' };
ok('lo escrito vuelve a salir al repintar (vive en la memoria de la página)', /data-clave="pedido" value="777"/.test(P.redactorHTML(dif)) && /<mark class="plr-v es-lleno" data-clave="pedido">777<\/mark>/.test(P.redactorHTML(dif)));
delete P.VAL['plt-diferir-pago'];

console.log('6) Las puertas');
W.store.plantillas = W.pltDeLaHoja(HOJA);
const gs = P.grupos('');
ok('8 puertas, en el orden del viaje del cliente', gs.map((x) => x.s.id).join(' ') === 'cotizacion volumen promocion fecha llego-mal no-reconoce digitales devolucion', gs.map((x) => x.s.id));
const hp = P.puerta(gs[2], '');
ok('«No se aplicó la promoción» enseña sus tres plantillas, cada una con .plt-name y su id', (hp.match(/class="pla-plt" data-a="abrir" data-sit="promocion" data-plt="plt-[a-z0-9-]+"/g) || []).length === 3 &&
  (hp.match(/<b class="plt-name">/g) || []).length === 3);
ok('cada fila dice a quién va y cuántos datos', /A supervisoras y team leader · 4 datos/.test(texto(hp)) && /Caso en Salesforce · 11 datos/.test(texto(P.puerta(gs[4], ''))));
ok('buscar «regalo» deja una puerta con una plantilla', P.grupos('regalo').length === 1 && P.grupos('regalo')[0].ps.map((p) => p.titulo).join() === 'Articulo de regalo faltante');
ok('buscar por la situación («promoción») trae su puerta entera; por un dato («sku»), varias', P.grupos('promoción').some((x) => x.s.id === 'promocion' && x.ps.length === 3) && P.grupos('sku').length >= 5);
ok('nada coincide con «zzz»', P.grupos('zzz').length === 0);
ok('pltCoincide (la cuenta de applySectionSearch) mira también la situación', W.pltCoincide(HOJA[1], 'volumen') && !W.pltCoincide(HOJA[1], 'zzz'));
P.abierto.sit = 'promocion'; P.abierto.plt = {};
const ha = P.abiertaHTML(gs, gs[2], '');
ok('abierta: la tira con «Todas» y las 8, la actual marcada', /data-a="cerrar"/.test(ha) && (ha.match(/class="pla-chip"/g) || []).length === 8 && /data-sit="promocion" aria-current="true"/.test(ha));
ok('abierta: se elige entre sus tres, la primera oprimida', (ha.match(/class="pla-e" data-a="plt"/g) || []).length === 3 && /data-plt="plt-diferir-pago" aria-pressed="true"/.test(ha));
ok('abierta: las otras 10 siguen en la sección (ocultas) para el buscador y ?item=', /<ul class="pla-anclas" hidden>/.test(ha) &&
  (ha.slice(ha.indexOf('pla-anclas')).match(/<b class="plt-name">/g) || []).length === 10 && /\.pla-anclas\{display:none!important\}/.test(estilos));
ok('«Correos a clientes»: las cuatro, cada una a su plantilla de allá', (P.correosClienteHTML().match(/data-pl="cc" data-app="tpl-[a-z]+"/g) || []).length === 4);
ok('…y nada si la sesión no puede abrir «Correos a clientes»', cargar({ permitidas: [] }).__plt.correosClienteHTML() === '');

console.log('7) Lo que escribe el asesor no se guarda');
ok('lo que lleva la tarjeta no pasa por copyText (que lo apuntaría en «Copiados recientes», guardado en el navegador)',
  guion.indexOf("function copiar(p, v, txt, btn){\n    if (llevaTarjeta(p, v)) copiarSinHistorial(txt, btn, 'Copiado al portapapeles');\n    else copyText(txt, btn);") > -1 &&
  guion.indexOf("copiarSinHistorial(resolver(p.cuerpo, v, p.campos), b, 'Cuerpo copiado: pégalo en Gmail con Ctrl V');\n        window.open(gmailUrl(p, v, true), '_blank', 'noopener');") > -1 &&
  (guion.match(/copyText\(/g) || []).length === 1);
ok('el parcial no toca localStorage, sessionStorage, la caché ni la dirección', !/localStorage|sessionStorage|\bLS\.|AppCache|AppUrl|history\.|location\./.test(guion));
ok('los campos no se autocompletan', (hDif.match(/<input /g) || []).length === (hDif.match(/autocomplete="off"/g) || []).length);

console.log('8) El parcial y el build');
ok('Enter recorre los datos en orden, también los Sí/No y las opciones (la marcada o la primera), y las flechas se mueven dentro del grupo',
  guion.indexOf("return c.querySelector('input, textarea') || c.querySelector('.plr-op[aria-pressed=\"true\"]') || c.querySelector('.plr-op');") > -1 &&
  guion.indexOf("if (esOp && t.getAttribute('aria-pressed') !== 'true') t.click();") > -1 && guion.indexOf('esOp && /^Arrow(Left|Right|Up|Down)$/.test(e.key)') > -1);
ok('al abrir, el foco va al primer dato vacío contando las opciones', guion.indexOf('var f = (r ? paradas(r) : []).filter(function(x){ return vacia(x, v); })[0]') > -1);
ok('el buscador y ?item= abren con la tira a la vista (sin scrollIntoView, siempre arriba del redactor)', !/scrollIntoView/.test(guion) && guion.indexOf('abrir(p.situacion, p.id, true, true);') > -1);
ok('la red de seguridad de GSAP cubre también las puertas', guion.indexOf("querySelectorAll('#plt-app > *, #plt-app .pla-puerta')") > -1);
ok('«Todas» se queda fija en la tira y el salto de la página respeta el movimiento reducido', /\.pla-volver\{position:sticky;left:0;/.test(estilos) && guion.indexOf("behavior:reducido() ? 'auto' : 'smooth'") > -1);
ok('sin \\p{…} (el build lo rechaza), ni plantillas `…`', !/\\p\{/.test(guion) && guion.indexOf('`') === -1);
ok('toda caja con display propio que se esconde lleva [hidden] o display:none', /\.pla-anclas\{display:none!important\}/.test(estilos));
ok('respeta el movimiento reducido', /@media \(prefers-reduced-motion: reduce\)\{#plt-app \*\{transition:none!important;animation:none!important\}\}/.test(estilos));
ok('Carbón: el rosa de texto y los iconos de los avisos se aclaran', /\[data-theme="carbon"\] #plt-app\{--pl-ink-brand:#F46BC6\}/.test(estilos) && /\[data-theme="carbon"\] #plt-app \.plr-avisos \.es-antes \.ic/.test(estilos));
ok('alto contraste y densidad compacta', /html\[data-contrast="high"\] \.pla-puerta/.test(estilos) && /html\[data-density="compact"\] \.pla-puertas/.test(estilos));

console.log('9) Index.html, app_indices.html y app_comando.html');
const sec = index.slice(index.indexOf('<section id="sec-plantillas"'), index.indexOf('</section>', index.indexOf('<section id="sec-plantillas"')));
ok('la sección: h1 para lectores, el filtro (que no pide datos: va a la dirección), el esqueleto y el hueco #plt-app', /<h1 class="plt-sr">Plantillas<\/h1>/.test(sec) &&
  /id="flt-plantillas" placeholder="Busca lo que pasó: «regalo», «resurtido»…"[^>]*oninput="filterSec\('plantillas',this\.value\)"/.test(sec) &&
  /id="ld-plantillas"/.test(sec) && /<div id="plt-app"><\/div>/.test(sec) && !/gr-plantillas|plt-chip|rc-plantillas/.test(sec));
ok('el parcial se incluye después del de Devoluciones SAP', index.indexOf("<?!= include('app_plantillas') ?>") > index.indexOf("<?!= include('app_devsap') ?>"));
ok('Index ya no declara renderPlt, applyPltFilters ni las tarjetas de antes', !/function (renderPlt|applyPltFilters|setPltType|pltTipo|pltBodyHtml)\b|pltView|pltType|\.plt-card|\.plt-chip/.test(index));
ok('onToolsData deja fuera las de «Correos a clientes» (y con eso el buscador y la cuenta del menú)', /plantillas: +window\.pltDeLaHoja \? pltDeLaHoja\(data\.plantillas\) : \(data\.plantillas \|\| \[\]\),/.test(index) &&
  /setCount\('plantillas', store\.plantillas\.length\);/.test(index) && /renderPlt\(store\.plantillas\);/.test(index));
ok('switchSec llama a pltAlEntrar y revealTarget a pltRevelar', /if \(id === 'plantillas' && window\.pltAlEntrar\) pltAlEntrar\(\);/.test(index) &&
  /scrollEl\.closest\('#sec-plantillas'\) && window\.pltRevelar\)\{\n    if \(pltRevelar\(scrollEl\)\) return;/.test(index));
ok('elementoDeSeccion encuentra la fila de una puerta o el redactor', /target\.closest\('[^']*\.pla-plt,\.plr,[^']*'\)/.test(index) && /querySelectorAll\('[^']*\.plt-name[^']*'\)/.test(index));
ok('sectionEnter anima las puertas y el redactor', /\.pla-puerta, \.plt-cc, \.pla-tira, \.pla-ab-hd, \.pla-elige, \.plr'\);/.test(index));
ok('coincideEnSeccion le pregunta al parcial', /if \(sec === 'plantillas' && window\.pltCoincide\) return pltCoincide\(item, t\);/.test(index));
ok('filterSec sigue mandando Plantillas a applyPltFilters (ahora en el parcial)', /if \(sec === 'plantillas'\) \{ applyPltFilters\(\); return; \}/.test(index));
ok('la vista de diseño trae cinco plantillas reales (una de «Correos a clientes», que no sale)', /titulo:"Diferir pago"/.test(index) && /titulo:"Correo de Ticket"/.test(index) && !/Confirmación de cambio de domicilio/.test(index));
ok('app_indices exporta correoDeCliente y correosCliente con las cuatro entradas tpl-*', /correoDeCliente: correoDeCliente,\n    correosCliente: CORREOS_CLIENTE,/.test(indices) &&
  W.AppIndices.correosCliente.map((x) => x.app).join() === 'tpl-edoext,tpl-edo,tpl-ticket,tpl-ok' &&
  W.AppIndices.correosCliente.every((x) => W.AppIndices.catalogo.some((f) => f.id === x.app)));
ok('«Ir a sección» encuentra Plantillas por lo que le pasó al cliente', /id:'plantillas'[^\n]*kw:'[^']*promocion[^']*resurtido[^']*'/.test(indices));
ok('el buscador de las demás pantallas tampoco las ofrece', /var plantillas = \(d\.plantillas \|\| \[\]\)\.filter\(function \(r\) \{\n      return !\(window\.AppIndices && AppIndices\.correoDeCliente && AppIndices\.correoDeCliente\(r\)\);/.test(comando) &&
  /mete\(plantillas, +'Plantillas'/.test(comando));

console.log('\n' + (total - fallos) + ' de ' + total + ' comprobaciones' + (fallos ? ' · ' + fallos + ' FALLAN' : ''));
process.exit(fallos ? 1 : 0);
