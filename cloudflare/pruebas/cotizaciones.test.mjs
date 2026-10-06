/*
 * Prueba del módulo de COTIZACIONES contra un Worker local ya levantado (Node puro, sin frameworks).
 *
 *   scripts/dev-aislado.sh cotizaciones 8802 &
 *   node pruebas/cotizaciones.test.mjs [http://127.0.0.1:8802]
 *
 * Recorre el ciclo de vida completo como lo hacen las pantallas: guarda una cotización de tres
 * artículos (como cotizacion.html), la busca en la lista del asesor, abre su detalle, la busca
 * desde otra cuenta, la reguarda, la envía al cliente y comprueba el estatus, la fecha de envío y
 * la métrica. Y las puertas: sin sesión no hay datos, un asesor no ve la supervisión.
 *
 * Si existe el estado local de D1 (ESTADO, por omisión .wrangler/estado-cotizaciones) se mira
 * además la base con wrangler: la fila del correo en `correos_salida` y la de `metricas_correos`.
 * Sale con código 1 si algo falla.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = (process.argv[2] || process.env.BASE || 'http://127.0.0.1:8802').replace(/\/$/, '');
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTADO = process.env.ESTADO || '.wrangler/estado-cotizaciones';
const CLAVE = 'VentelDemo2026';
const ASESOR = 'asesor@ventel.example';
const OTRA_ASESORA = 'sofia.herrera@ventel.example';
const SUPERVISORA = 'supervisora@ventel.example';

let fallos = 0;
let pasos = 0;
function ok(condicion, mensaje, detalle) {
  pasos++;
  if (condicion) { console.log('  ✔ ' + mensaje); return true; }
  fallos++;
  console.log('  ✘ ' + mensaje + (detalle !== undefined ? '\n      → ' + JSON.stringify(detalle).slice(0, 400) : ''));
  return false;
}
const seccion = (t) => console.log('\n■ ' + t);

// ── El canal, como AppRun ────────────────────────────────────────────────────

async function crudo(cuerpo) {
  const r = await fetch(BASE + '/api/rpc', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo)
  });
  return r.json();
}
/** Llamada por secEjecutar con la llave dada ('' = sin sesión). Lanza con el error del servidor. */
async function rpc(llave, fn, args = []) {
  const j = await crudo({ fn: 'secEjecutar', args: [llave, fn, args, Date.now()] });
  if (!j.ok) throw new Error(j.e);
  return j.v;
}
async function entrar(correo) {
  const r = await rpc('', 'loginUser', [correo, CLAVE]);
  if (!r || !r.success || !r.llave) throw new Error('No se pudo entrar como ' + correo + ': ' + JSON.stringify(r));
  return r.llave;
}

/** Mira la base D1 local con wrangler. Devuelve null si no hay estado local que mirar. */
function d1(sql) {
  if (!existsSync(path.join(RAIZ, ESTADO))) return null;
  const salida = execFileSync('npx', ['wrangler', 'd1', 'execute', 'ventel-portal', '--local', '--persist-to', ESTADO,
    '--json', '--command', sql], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(salida.slice(salida.indexOf('['))).map((r) => r.results);
}

// ── Datos: lo que manda collectQuoteData de cotizacion.html ─────────────────

function cotizacionDePrueba(extra = {}) {
  return Object.assign({
    folio: null,
    advisorName: 'Carlos Mendoza',
    advisorExt: '',
    advisorEmail: ASESOR,
    clientName: 'María José González',
    clientEmail: 'maria.gonzalez@example.com',
    clientPhone: '5512345678',
    products: [
      { sku: '1094234567', imageUrl: '', productUrl: 'https://www.liverpool.com.mx/tienda/pdp/1094234567', quantity: 2,
        description: 'Pantalla LED 55 pulgadas', unitPrice: 1500, costPaymentUnique: 0, discountPublicPercent: 10,
        additionalDiscountApplied: 'No', additionalDiscountPercent: 0 },
      { sku: '1102345678', imageUrl: '', productUrl: '', quantity: 1, description: 'Barra de sonido', unitPrice: 899.9,
        costPaymentUnique: 750, discountPublicPercent: 16.66, additionalDiscountApplied: 'No', additionalDiscountPercent: 0 },
      { sku: '1113456789', imageUrl: '', productUrl: '', quantity: 3, description: 'Cable HDMI 2 m', unitPrice: 249.5,
        costPaymentUnique: 0, discountPublicPercent: 0, additionalDiscountApplied: 'Si', additionalDiscountPercent: 15 }
    ],
    observations: 'Entrega en tienda Perisur.',
    // Lo que calcula la pantalla (calculateRow): 2700 + 750 + 636.225, con el IVA desglosado al 16 %.
    summarySubtotal: 3522.61,
    summaryVat: 563.62,
    summaryTotal: 4086.23,
    format: 'ccl_liverpool',
    status: 'Borrador Vista Previa'
  }, extra);
}

/** AAMMDD de hoy en hora de México: el centro del folio. */
function hoyMx() {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[x.type] = x.value;
  return p.year.slice(-2) + p.month + p.day;
}

// ── La prueba ───────────────────────────────────────────────────────────────

async function principal() {
  console.log('Cotizaciones · ' + BASE);
  const salud = await fetch(BASE + '/api/salud').then((r) => r.json()).catch(() => null);
  if (!salud || !salud.ok) throw new Error('El Worker no contesta en ' + BASE + ' (¿está levantado?).');

  const asesor = await entrar(ASESOR);
  const otra = await entrar(OTRA_ASESORA);
  const sup = await entrar(SUPERVISORA);

  seccion('Sin sesión no hay datos privados');
  const sinSesion = [
    ['getQuotesForUser', [ASESOR]],
    ['buscarCotizaciones', [ASESOR, 'gonzalez', 8]],
    ['getQuoteDetails', ['LVP-000000-0000', ASESOR]],
    ['getQuoteDetailsForEmail', ['LVP-000000-0000', ASESOR]],
    ['getSupervisionQuotes', [SUPERVISORA]],
    ['getDashboardStats', []],
    ['getResumenMetricasCorreos', [SUPERVISORA]],
    ['downloadQuotePdf', ['LVP-000000-0000', null, ASESOR]],
    ['openQuoteInSheets', ['LVP-000000-0000', ASESOR]],
    ['saveQuoteAndGoToPreview', [cotizacionDePrueba()]],
    ['sendQuoteByEmail', [{ to: 'x@example.com', subject: 's', body: 'b', folio: 'LVP-000000-0000', asesor: ASESOR }]]
  ];
  for (const [fn, args] of sinSesion) {
    const r = await rpc('', fn, args);
    ok(r && r.success === false && !r.quotes?.length && !r.quote && !r.stats, fn + ' sin llave → success:false', r);
  }
  // Llamada directa, sin pasar por secEjecutar (como un google.script.run pelón).
  const directa = await crudo({ fn: 'getQuotesForUser', args: [ASESOR] });
  ok(directa.ok && directa.v && directa.v.success === false, 'getQuotesForUser directo (sin canal) → success:false', directa);
  const ajena = await rpc(asesor, 'getQuotesForUser', [SUPERVISORA]);
  ok(ajena.success === false && /otra cuenta/.test(ajena.message || ''), 'la llave de un asesor no sirve con el correo de otra persona', ajena);

  seccion('Formatos');
  const formatos = await rpc(asesor, 'getEnabledQuoteFormats');
  ok(formatos.success === true && Array.isArray(formatos.formats) && formatos.formats.length >= 1 &&
     formatos.formats.every((f) => f.id && f.name && f.description) && !!formatos.defaultId,
     'getEnabledQuoteFormats → {success, formats[{id,name,description}], defaultId}', formatos);

  seccion('Guardar una cotización de 3 artículos (como cotizacion.html)');
  const guardado = await rpc(asesor, 'saveQuoteAndGoToPreview', [cotizacionDePrueba()]);
  const folio = guardado.folio;
  ok(guardado.success === true && new RegExp('^LVP-' + hoyMx() + '-\\d{4}$').test(folio || ''),
     'folio LVP-AAMMDD-XXXX con la fecha de hoy en México (' + folio + ')', guardado);
  ok(typeof guardado.requiereRevision === 'boolean' && typeof guardado.motivoRevision === 'string' &&
     guardado.format === 'ccl_liverpool' && guardado.message === `Datos de cotización ${folio} preparados.`,
     'respuesta con format, requiereRevision, motivoRevision y el mensaje del .gs', guardado);

  seccion('La lista del asesor');
  const lista = await rpc(asesor, 'getQuotesForUser', [ASESOR, null, false]);
  const fila = (lista.quotes || []).find((q) => q.folio === folio);
  ok(lista.success === true && lista.message === null && !!fila, 'getQuotesForUser trae el folio recién guardado', lista);
  if (fila) {
    ok(fila.cliente === 'María José González' && fila.correoCliente === 'maria.gonzalez@example.com' &&
       fila.asesor === 'Carlos Mendoza' && fila.asesorCorreo === ASESOR && fila.total === 4086.23 &&
       fila.formato === 'ccl_liverpool' && /^\d{2} \S+ \d{4}$/.test(fila.fecha) && !!fila.estatus,
       'fila con cliente, correoCliente, asesor, asesorCorreo, fecha («06 oct 2026»), total, estatus y formato', fila);
  }
  const folios = (lista.quotes || []).map((q) => q.folio);
  ok(folios.join() === folios.slice().sort((a, b) => String(b).localeCompare(String(a))).join(),
     'la lista propia va por folio más reciente primero');
  const deOtra = await rpc(otra, 'getQuotesForUser', [OTRA_ASESORA, null, false]);
  ok(deOtra.success === true && !(deOtra.quotes || []).some((q) => q.folio === folio), 'la lista de otra asesora no la incluye', deOtra);

  seccion('El detalle');
  const det = await rpc(asesor, 'getQuoteDetails', [folio, ASESOR]);
  const q = det.quote || {};
  ok(det.success === true && q.folio === folio && q.clientName === 'María José González' && q.clientPhone === '5512345678' &&
     q.summarySubtotal === 3522.61 && q.summaryVat === 563.62 && q.summaryTotal === 4086.23 && q.format === 'ccl_liverpool' &&
     q.advisorEmail === ASESOR && q.observations === 'Entrega en tienda Perisur.' && !isNaN(Date.parse(q.timestamp)) &&
     typeof q.driveLink === 'string' && typeof q.cclSheetLink === 'string',
     'getQuoteDetails → cabecera con totales, formato y timestamp ISO', det);
  ok(q.revision && typeof q.revision.aprobada === 'boolean' && 'estado' in q.revision && 'notas' in q.revision,
     'el detalle lleva el estado de la revisión', q.revision);
  const prods = q.products || [];
  ok(prods.length === 3 && prods[0].sku === '1094234567' && prods[0].quantity === 2 && prods[0].discountPublicPercent === 10 &&
     prods[0].productUrl.includes('liverpool') && prods[1].costPaymentUnique === 750 &&
     prods[2].additionalDiscountApplied === 'Si' && prods[2].additionalDiscountPercent === 15,
     'tres partidas en su orden, con descuentos y pago único', prods);
  const noHay = await rpc(asesor, 'getQuoteDetails', ['LVP-000000-9999', ASESOR]);
  ok(noHay.success === false && noHay.message === 'Cotización no encontrada.', 'un folio que no existe → «Cotización no encontrada.»', noHay);

  seccion('Buscarla desde otra cuenta (búsqueda global y buscador general)');
  const busq = await rpc(otra, 'getQuotesForUser', [OTRA_ASESORA, 'gonzales', false]);
  ok(busq.success === true && (busq.quotes || []).some((x) => x.folio === folio), 'getQuotesForUser con «gonzales» (sin acento, con dedazo) la encuentra', busq);
  const compacto = await rpc(otra, 'getQuotesForUser', [OTRA_ASESORA, folio.replace(/-/g, '').toLowerCase(), false]);
  ok(compacto.success === true && (compacto.quotes || [])[0]?.folio === folio, 'el folio tecleado sin guiones sale primero', compacto);
  const cmd = await rpc(otra, 'buscarCotizaciones', [OTRA_ASESORA, 'María José', 8]);
  const c0 = (cmd.quotes || []).find((x) => x.folio === folio);
  ok(cmd.success === true && !!c0 && Object.keys(c0).sort().join() === 'asesor,asesorCorreo,cliente,correoCliente,estatus,fecha,folio',
     'buscarCotizaciones → filas recortadas a lo que pinta la lista desplegable', cmd);
  const corto = await rpc(otra, 'buscarCotizaciones', [OTRA_ASESORA, 'ma', 8]);
  ok(corto.success === true && corto.quotes.length === 0, 'con menos de 3 letras no se busca', corto);
  // Un término único, para encontrar después su fila en metricas_busquedas (monRegistrarBusqueda).
  const terminoUnico = 'pruebabusq' + randomBytes(4).toString('hex');
  const sinNada = await rpc(otra, 'getQuotesForUser', [OTRA_ASESORA, terminoUnico, false]);
  ok(sinNada.success === true && sinNada.quotes.length === 0, 'una búsqueda sin coincidencias → lista vacía', sinNada);

  seccion('La ficha de la vista previa: un folio por cotización aunque se repita la llamada');
  const ficha = randomBytes(16).toString('hex');
  const v1 = await rpc(asesor, 'saveQuoteAndGoToPreview', [cotizacionDePrueba({ ficha })]);
  const v2 = await rpc(asesor, 'saveQuoteAndGoToPreview', [cotizacionDePrueba({ ficha })]);
  ok(v1.success && v2.success && v1.folio === v2.folio && v2.repetida === true && !v1.repetida,
     'la misma ficha dos veces → el mismo folio, la segunda con repetida:true', [v1, v2]);
  const ficha2 = randomBytes(16).toString('hex');
  const paralelas = await Promise.all([1, 2, 3].map(() => rpc(asesor, 'saveQuoteAndGoToPreview', [cotizacionDePrueba({ ficha: ficha2 })])));
  ok(paralelas.every((r) => r.success) && new Set(paralelas.map((r) => r.folio)).size === 1,
     'tres llamadas A LA VEZ con la misma ficha → un solo folio', paralelas.map((r) => r.folio));
  const sinFicha = await Promise.all([1, 2, 3].map(() => rpc(otra, 'saveQuoteAndGoToPreview', [cotizacionDePrueba({ advisorEmail: OTRA_ASESORA, advisorName: '' })])));
  ok(sinFicha.every((r) => r.success) && new Set(sinFicha.map((r) => r.folio)).size === 3,
     'tres cotizaciones distintas a la vez → tres folios distintos (contador atómico)', sinFicha.map((r) => r.folio));
  const nombreDeRegistro = await rpc(otra, 'getQuoteDetails', [sinFicha[0].folio, OTRA_ASESORA]);
  ok(nombreDeRegistro.quote?.advisorName === 'Sofía Herrera', 'sin advisorName se toma el nombre de registros', nombreDeRegistro.quote?.advisorName);
  const otroFormato = await rpc(asesor, 'saveQuoteAndGoToPreview', [cotizacionDePrueba({ format: 'no-existe' })]);
  ok(otroFormato.success && otroFormato.format === formatos.defaultId, 'un formato que no está habilitado cae al predeterminado', otroFormato);

  seccion('Reguardar (editar) reescribe las partidas y devuelve el folio al inicio del ciclo');
  const editada = await rpc(asesor, 'saveQuoteAndGoToPreview', [cotizacionDePrueba({
    folio: v1.folio, products: cotizacionDePrueba().products.slice(0, 2), summarySubtotal: 2974.14, summaryVat: 475.86, summaryTotal: 3450
  })]);
  const det2 = await rpc(asesor, 'getQuoteDetails', [v1.folio, ASESOR]);
  ok(editada.success && editada.folio === v1.folio && det2.quote?.products?.length === 2 && det2.quote?.summaryTotal === 3450,
     'mismo folio, dos partidas y el total nuevo', [editada, det2.quote?.products?.length]);

  seccion('Un asesor NO ve la supervisión');
  for (const [fn, args] of [['getSupervisionQuotes', [ASESOR]], ['getDashboardStats', []], ['getResumenMetricasCorreos', [ASESOR]],
                            ['getFormatSettings', [ASESOR]], ['setQuoteFormatEnabled', [ASESOR, 'actual', false]]]) {
    const r = await rpc(asesor, fn, args);
    ok(r.success === false && typeof r.message === 'string' && !r.quotes && !r.stats && !r.formats, fn + ' como asesor → success:false', r);
  }

  seccion('La supervisora sí');
  const supQ = await rpc(sup, 'getSupervisionQuotes', [SUPERVISORA]);
  const s0 = (supQ.quotes || []).find((x) => x.folio === folio);
  ok(supQ.success === true && !!s0 && s0.advisorEmail === ASESOR && s0.total === 4086.23 && s0.vat === 563.62 &&
     !isNaN(Date.parse(s0.timestamp)) && 'revisionEstado' in s0 && 'fechaEnvio' in s0 && s0.format === 'ccl_liverpool',
     'getSupervisionQuotes trae todas, con los campos del panel', s0 || supQ);
  const ts = (supQ.quotes || []).map((x) => x.timestamp);
  ok(ts.join() === ts.slice().sort((a, b) => b.localeCompare(a)).join(), 'la supervisión va de la más reciente a la más vieja');
  const stats = await rpc(sup, 'getDashboardStats');
  const st = stats.stats || {};
  ok(stats.success === true && st.currentMonthCount >= 1 && typeof st.previousMonthCount === 'number' &&
     (st.today || []).some((x) => x.folio === folio) && (st.last7Days || []).length >= (st.today || []).length &&
     Array.isArray(st.quotesPerUser) && st.quotesPerUser.every((u) => u.name && u.count > 0) &&
     (st.lastQuotes || []).length <= 5 && (st.lastQuotes || []).every((x) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(x.fecha)),
     'getDashboardStats → KPIs, reparto por asesor, actividad de hoy y de 7 días y las 5 últimas', st);
  const ajustes = await rpc(sup, 'getFormatSettings', [SUPERVISORA]);
  ok(ajustes.success === true && ajustes.formats.length === 2 &&
     ajustes.formats.every((f) => 'enabled' in f && 'available' in f && 'unavailableReason' in f),
     'getFormatSettings → catálogo con enabled/available/unavailableReason', ajustes);

  seccion('Habilitar y deshabilitar formatos (propiedad formatos_habilitados)');
  try {
    const off = await rpc(sup, 'setQuoteFormatEnabled', [SUPERVISORA, 'actual', false]);
    ok(off.success === true && off.formats.find((f) => f.id === 'actual').enabled === false, 'deshabilitar «actual»', off);
    const solo = await rpc(asesor, 'getEnabledQuoteFormats');
    ok(solo.formats.map((f) => f.id).join() === 'ccl_liverpool' && solo.defaultId === 'ccl_liverpool', 'el asesor ya solo ve CCL', solo);
    const ninguno = await rpc(sup, 'setQuoteFormatEnabled', [SUPERVISORA, 'ccl_liverpool', false]);
    ok(ninguno.success === false && ninguno.message === 'Debe quedar al menos un formato habilitado.', 'no se puede quedar sin formatos', ninguno);
    const raro = await rpc(sup, 'setQuoteFormatEnabled', [SUPERVISORA, 'pdf_magico', true]);
    ok(raro.success === false && raro.message === "El formato 'pdf_magico' no existe.", 'un formato que no existe se rechaza', raro);
  } finally {
    await rpc(sup, 'setQuoteFormatEnabled', [SUPERVISORA, 'actual', true]);
    await rpc(sup, 'setQuoteFormatEnabled', [SUPERVISORA, 'ccl_liverpool', true]);
  }

  seccion('Lo que dependía de Google Drive: fallo controlado con mensaje claro');
  const pdf = await rpc(asesor, 'downloadQuotePdf', [folio, null, ASESOR]);
  ok(pdf.success === false && /Google Drive/.test(pdf.message) && /Guardar como PDF/.test(pdf.message), 'downloadQuotePdf → {success:false, message} con la salida de imprimir', pdf);
  const hoja = await rpc(asesor, 'openQuoteInSheets', [folio, ASESOR]);
  ok(hoja.success === false && /Google Drive/.test(hoja.message), 'openQuoteInSheets → {success:false, message}', hoja);
  const previa = await rpc(asesor, 'previewSheetCcl', [folio]);
  ok(previa.success === false && !previa.urlIncrustable, 'previewSheetCcl → {success:false} (la vista previa retira su panel)', previa);

  seccion('Enviarla al cliente');
  const paraCorreo = await rpc(asesor, 'getQuoteDetailsForEmail', [folio, ASESOR]);
  ok(paraCorreo.success === true && paraCorreo.data.folio === folio && paraCorreo.data.clientEmail === 'maria.gonzalez@example.com' &&
     paraCorreo.data.clientName === 'María José González' && paraCorreo.data.format === 'ccl_liverpool' &&
     typeof paraCorreo.data.revision?.aprobada === 'boolean',
     'getQuoteDetailsForEmail → {success, data:{folio, clientName, clientEmail, format, revision}}', paraCorreo);
  const remitente = await rpc(asesor, 'getMailSenderInfo');
  ok(remitente.success === true && remitente.aliasAvailable === true && /@/.test(remitente.alias), 'getMailSenderInfo → alias disponible', remitente);

  const correo = {
    to: 'maria.gonzalez@example.com',
    subject: 'Cotización de Servicios Ventel - Folio ' + folio,
    body: 'Estimado(a) María José González,\n\nLe hago llegar la cotización solicitada con folio ' + folio + '.\n\nSaludos cordiales,',
    folio, format: 'ccl_liverpool', asesor: ASESOR
  };
  let envio = await rpc(asesor, 'sendQuoteByEmail', [correo]);
  if (!envio.success && envio.sinAprobar) {
    // La política pide revisión: la aprueba la supervisora por la puerta del módulo de revisión.
    ok(paraCorreo.data.revision.aprobada === false, 'bloqueada por revisión, como avisaba getQuoteDetailsForEmail', envio);
    const rev = await rpc(sup, 'guardarRevisionCotizacion', [{ folio, email: SUPERVISORA, decision: 'aprobada',
      notas: 'Aprobada por la prueba automática del módulo de cotizaciones.' }]);
    ok(rev && rev.success === true, 'la supervisora la aprueba (guardarRevisionCotizacion)', rev);
    envio = await rpc(asesor, 'sendQuoteByEmail', [correo]);
  }
  ok(envio.success === true && envio.sentFrom === remitente.alias && envio.aliasUsed === true && /Correo enviado/.test(envio.message),
     'sendQuoteByEmail → {success, sentFrom, aliasUsed, message}', envio);
  const trasEnvio = await rpc(asesor, 'getQuoteDetails', [folio, ASESOR]);
  ok(trasEnvio.quote?.status === 'Enviada por Correo', 'el estatus pasa a «Enviada por Correo»', trasEnvio.quote?.status);
  const supTras = await rpc(sup, 'getSupervisionQuotes', [SUPERVISORA]);
  const sTras = (supTras.quotes || []).find((x) => x.folio === folio) || {};
  ok(!isNaN(Date.parse(sTras.fechaEnvio)) && sTras.status === 'Enviada por Correo', 'la supervisión ve la fecha REAL del envío', sTras);
  const met = await rpc(sup, 'getResumenMetricasCorreos', [SUPERVISORA]);
  ok(met.success === true && met.total >= 1 && met.enviados >= 1 && met.recientes[0]?.referencia === folio &&
     met.recientes[0]?.tipo === 'Cotización (PDF)' && /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(met.recientes[0]?.fecha) &&
     (met.porDia || []).length >= 1 && met.porTipo['Cotización (PDF)'] >= 1 && met.porAsesor.some((a) => a.email === ASESOR),
     'getResumenMetricasCorreos cuenta el envío (recientes, porDia, porTipo, porAsesor)', met);
  const malo = await rpc(asesor, 'sendQuoteByEmail', [Object.assign({}, correo, { to: 'esto-no-es-un-correo' })]);
  ok(malo.success === false && malo.message === 'No pudimos enviar el correo. Revisa la dirección del cliente e inténtalo de nuevo.',
     'un destinatario inválido → el mensaje del .gs', malo);
  const faltan = await rpc(asesor, 'sendQuoteByEmail', [{ folio, asesor: ASESOR }]);
  ok(faltan.success === false, 'sin para/asunto/cuerpo no se envía', faltan);

  seccion('La base D1 (bandeja de salida y métricas)');
  const filas = d1(
    "SELECT para, de, nombre_de, responder_a, adjuntos, tipo, estado, instr(html, '¡Tu cotización está lista!') > 0 AS aprobado " +
    `FROM correos_salida WHERE referencia = '${folio}' ORDER BY id DESC LIMIT 1; ` +
    `SELECT resultado, adjuntos, cc, alias_usado FROM metricas_correos WHERE referencia = '${folio}' ORDER BY id; ` +
    `SELECT COUNT(*) AS n FROM detalle_cotizaciones WHERE folio_cotizacion = '${folio}'; ` +
    `SELECT quien, origen FROM metricas_busquedas WHERE termino = '${terminoUnico}'`);
  if (!filas) {
    console.log('  · (sin estado local en ' + ESTADO + ': no se mira la base)');
  } else {
    const [salida, metricas, partidas, busquedas] = filas;
    const c = salida[0] || {};
    ok(c.para === 'maria.gonzalez@example.com' && c.de === remitente.alias && c.nombre_de === 'Cotizaciones Ventel Liverpool' &&
       c.responder_a === ASESOR && c.tipo === 'cotizacion' && c.aprobado === 1,
       'correos_salida: el correo completo, con el HTML aprobado y respuesta al asesor', c);
    ok(/no adjuntado/.test(c.adjuntos || '') && /Google Drive/.test(c.adjuntos || ''), 'sin PDF: la nota va en adjuntos', c.adjuntos);
    // El cliente de la prueba es de un dominio de ejemplo: el núcleo nunca lo manda por Brevo.
    ok(c.estado === 'omitido', 'a una dirección de ejemplo no sale nada de verdad (estado «omitido»)', c.estado);
    ok(metricas.some((m) => m.resultado === 'Enviado' && m.adjuntos === '0' && m.cc === '0' && m.alias_usado === 'Sí') &&
       metricas.some((m) => m.resultado === 'Error'),
       'metricas_correos: el envío («Enviado») y el intento fallido («Error»)', metricas);
    ok(partidas[0]?.n === 3, 'detalle_cotizaciones: tres partidas del folio', partidas);
    ok(busquedas.some((b) => b.quien === OTRA_ASESORA && b.origen === 'cotizaciones'),
       'metricas_busquedas: la búsqueda quedó apuntada (monRegistrarBusqueda, origen «cotizaciones»)', busquedas);
  }

  console.log('\n' + (pasos - fallos) + '/' + pasos + ' comprobaciones bien' + (fallos ? ' · ' + fallos + ' FALLARON' : ''));
  process.exit(fallos ? 1 : 0);
}

principal().catch((e) => { console.error('\nERROR: ' + (e && e.stack || e)); process.exit(1); });
