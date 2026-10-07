/*
 * Genera plantillas.ts copiando TAL CUAL el HTML aprobado de «Carpeta del proyecto»:
 *   · Correos.gs → el correo de la cotización al cliente (sendQuoteByEmail) y el documento del PDF
 *     'actual' (generateQuoteHtml_).
 *   · app_ccl.html → la réplica del formato CCL Liverpool (estilos, hoja y fila de producto).
 *
 *   node src/worker/modulos/cotizaciones/generar-plantillas.mjs              → reescribe plantillas.ts
 *   node src/worker/modulos/cotizaciones/generar-plantillas.mjs --comprobar  → sale con 1 si plantillas.ts
 *                                                                             ya no coincide con el original
 *
 * Los trozos se localizan por su contenido (no por número de línea) y solo se tocan los nombres de las
 * ayudas (secEscapeHtml_ → escaparHtml) y las fechas, que en el Worker (UTC) se formatean con la zona de
 * México. No lo importa el Worker: es una herramienta de mantenimiento (y la usa la prueba del PDF).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CARPETA = path.resolve(AQUI, '../../../../../Carpeta del proyecto');
const DESTINO = path.join(AQUI, 'plantillas.ts');

const correos = fs.readFileSync(path.join(CARPETA, 'Correos.gs'), 'utf8').split('\n');
const ccl = fs.readFileSync(path.join(CARPETA, 'app_ccl.html'), 'utf8').split('\n');

function fallo(msg) { throw new Error('generar-plantillas: ' + msg); }

/** Índice de la primera línea que cumple `prueba`, a partir de `desde`. */
function buscar(lineas, prueba, desde = 0) {
  for (let i = desde; i < lineas.length; i++) if (prueba(lineas[i])) return i;
  return fallo('no se encontró el ancla ' + prueba);
}

/** Literal de plantilla multilínea que abre con ` al final de la línea `ini` y cierra en la línea «`;». */
function literal(lineas, ini) {
  const a = lineas[ini];
  if (!a.trimEnd().endsWith('`')) fallo('la línea ' + (ini + 1) + ' no abre un literal: ' + a);
  const fin = buscar(lineas, (l) => l.trim() === '`;', ini + 1);
  const cierre = lineas[fin];
  return a.slice(a.lastIndexOf('`') + 1) + '\n' + lineas.slice(ini + 1, fin).join('\n') + '\n' + cierre.slice(0, cierre.indexOf('`'));
}

const ajustar = (s) => s
  .replace(/secEscapeHtml_\(/g, 'escaparHtml(')
  .replace("new Date(quote.timestamp).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })",
           'fechaLargaMx(quote.timestamp)')
  .replace("new Date(data.timestamp).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })",
           'fechaLargaMx(data.timestamp)');

// ── Correos.gs ─────────────────────────────────────────────────────────────

const iHtml = buscar(correos, (l) => l.startsWith('function generateQuoteHtml_('));
const iEnvio = buscar(correos, (l) => l.startsWith('function sendQuoteByEmail('));

const pdfFila = ajustar(literal(correos, buscar(correos, (l) => l.includes('productsHtml += `'), iHtml)));
const lSinPdf = correos[buscar(correos, (l) => l.includes(`productsHtml = '<tr><td colspan="7"`), iHtml)];
const pdfSinProductos = lSinPdf.slice(lSinPdf.indexOf("'"), lSinPdf.lastIndexOf("'") + 1);
const iObs = buscar(correos, (l) => l.includes('const observationsHtml = (data.observations'), iHtml);
const iObsFin = buscar(correos, (l) => l.includes("</div>` : '';"), iObs);
const pdfObservaciones = ajustar(correos[iObs].slice(correos[iObs].lastIndexOf('`') + 1) + '\n' +
  correos.slice(iObs + 1, iObsFin).join('\n') + '\n' + correos[iObsFin].slice(0, correos[iObsFin].indexOf('`')));
const pdfDocumento = ajustar(literal(correos, buscar(correos, (l) => l.includes('const fullHtml = `'), iHtml)));

const correoTarjeta = ajustar(literal(correos, buscar(correos, (l) => l.includes('productsHtml += `'), iEnvio)));
const correoVacio = ajustar(literal(correos, buscar(correos, (l) => l.trim() === 'productsHtml = `', iEnvio)));
const correoCuerpo = ajustar(literal(correos, buscar(correos, (l) => l.includes('const finalHtmlBody = `'), iEnvio)));

// ── app_ccl.html ───────────────────────────────────────────────────────────

const iEstilo = buscar(ccl, (l) => l.trim() === '<style>');
const iEstiloFin = buscar(ccl, (l) => l.trim() === '</style>', iEstilo);
const cclEstilos = ccl.slice(iEstilo + 1, iEstiloFin).join('\n');
const iHoja = buscar(ccl, (l) => l.includes('id="ccl-preview-content"'));
const iScript = buscar(ccl, (l) => l.trim() === '<script>', iHoja);
let cclHoja = ccl.slice(iHoja, iScript).join('\n').replace(/\s+$/, '');
const cclFila = literal(ccl, buscar(ccl, (l) => l.includes('tr.innerHTML = `'), iScript));

// La hoja de la pantalla nace oculta (la pantalla le quita «hidden»); el documento la quiere visible.
if (!cclHoja.includes('class="ccl-sheet v-papel hidden"')) fallo('la hoja CCL cambió de clase');
cclHoja = cclHoja.replace('class="ccl-sheet v-papel hidden"', 'class="ccl-sheet v-papel"');
// Los huecos que llena populateCclPreview (textContent / innerHTML) pasan a ser ${v.…}.
const HUECOS = { 'fecha': 'fecha', 'asesorNombre': 'asesorNombre', 'clienteNombre': 'clienteNombre',
  'clienteEmail': 'clienteEmail', 'clienteTelefono': 'clienteTelefono', 'clienteObservacion': 'clienteObservacion',
  'productos-tbody': 'filas', 'subtotal': 'subtotal', 'iva': 'iva', 'total': 'total' };
for (const [id, clave] of Object.entries(HUECOS)) {
  const re = new RegExp('(<(\\w+)[^>]*\\bid="ccl-' + id + '"[^>]*>)(</\\2>)');
  if (!re.test(cclHoja)) fallo('falta el hueco vacío ccl-' + id);
  cclHoja = cclHoja.replace(re, (m, abre, tag, cierra) => abre + '${v.' + clave + '}' + cierra);
}
for (const [nombre, s] of [['estilos CCL', cclEstilos], ['hoja CCL', cclHoja]]) {
  if (/[`\\]/.test(s) || (nombre === 'estilos CCL' && s.includes('${'))) fallo(nombre + ' trae caracteres que romperían el literal');
}
for (const [n, s] of [['pdfFila', pdfFila], ['pdfDocumento', pdfDocumento], ['correoCuerpo', correoCuerpo], ['correoTarjeta', correoTarjeta]]) {
  if (/secEscapeHtml_|toLocaleDateString|getVerifiedImageUrl/.test(s)) fallo('queda algo sin ajustar en ' + n);
}

// ── plantillas.ts ──────────────────────────────────────────────────────────

const ts = `/**
 * PLANTILLAS HTML DE LA COTIZACIÓN | Portal Ventel en Cloudflare
 * ==============================================================
 * GENERADO por generar-plantillas.mjs (en esta misma carpeta) a partir de «Carpeta del proyecto». No se
 * edita a mano: si cambia el original, se vuelve a generar. Son formatos APROBADOS, copiados TAL CUAL:
 *   · el correo al cliente (sendQuoteByEmail, Correos.gs);
 *   · el documento del PDF 'actual' (generateQuoteHtml_, Correos.gs);
 *   · la réplica del formato CCL Liverpool (app_ccl.html): estilos, hoja y fila de producto.
 * Solo cambian los nombres de las ayudas (secEscapeHtml_ → escaparHtml) y la fecha de emisión, que en el
 * Worker (UTC) se formatea con la zona de México (fechaLargaMx), como lo hacía Apps Script.
 */
import { escaparHtml } from '../../nucleo/util';
import { formatCurrencyGS, fechaLargaMx, formatPercentJS } from './comun';
import type { FilaCcl } from './comun';

// ── Correo al cliente (sendQuoteByEmail) ────────────────────────────────────

/** Una tarjeta de producto (el bucle de productos de sendQuoteByEmail). */
export function tarjetaProductoHtml(v: {
  p: { sku: string; description: string };
  verifiedImgUrl: string; unitPrice: number; quantity: number; costPaymentUnique: number;
  totalMonetaryDiscount: number; effectiveTotalPercentage: number; finalPricePerLine: number;
}): string {
  const { p, verifiedImgUrl, unitPrice, quantity, costPaymentUnique, totalMonetaryDiscount,
          effectiveTotalPercentage, finalPricePerLine } = v;
  return \`${correoTarjeta}\`;
}

/** Lo que va en lugar de las tarjetas cuando la cotización no tiene productos. */
export function sinProductosHtml(): string {
  return \`${correoVacio}\`;
}

/** El correo completo, con el mensaje del asesor ya escapado y las tarjetas ya armadas. */
export function cuerpoCorreoCotizacionHtml(quote: Record<string, any>, productsHtml: string, userMessageHtml: string): string {
  return \`${correoCuerpo}\`;
}

// ── Documento del PDF 'actual' (generateQuoteHtml_) ─────────────────────────

/** Una fila de la tabla de productos del PDF. */
export function filaPdfActualHtml(v: {
  p: { sku: string; description: string };
  quantity: number; unitPrice: number; priceVolume: number; discountDisplayString: string; finalPricePerLine: number;
}): string {
  const { p, quantity, unitPrice, priceVolume, discountDisplayString, finalPricePerLine } = v;
  return \`${pdfFila}\`;
}

/** La fila que va cuando la cotización no tiene productos. */
export const SIN_PRODUCTOS_PDF_ACTUAL = ${pdfSinProductos};

/** El bloque de observaciones (vacío si no hay). */
export function observacionesPdfActualHtml(data: Record<string, any>): string {
  return (data.observations && data.observations.trim() !== '') ? \`${pdfObservaciones}\` : '';
}

/** El documento completo, optimizado para página carta. */
export function documentoPdfActualHtml(data: Record<string, any>, productsHtml: string, observationsHtml: string): string {
  return \`${pdfDocumento}\`;
}

// ── Formato CCL Liverpool (app_ccl.html) ────────────────────────────────────

/** Los estilos de la réplica, tal cual (incluidas sus reglas de impresión). */
export const CCL_ESTILOS = \`${cclEstilos}\`;

/** Lo que va dentro del <tr> de un producto (populateCclPreview). */
export function filaCclHtml(r: FilaCcl): string {
  const escTxt = escaparHtml;
  const formatCurrencyJS = formatCurrencyGS;
  return \`${cclFila}\`;
}

/** La hoja CCL con sus huecos ya llenos (textos escapados, filas armadas). */
export function hojaCclHtml(v: {
  fecha: string; asesorNombre: string; clienteNombre: string; clienteEmail: string; clienteTelefono: string;
  clienteObservacion: string; filas: string; subtotal: string; iva: string; total: string;
}): string {
  return \`${cclHoja}\`;
}
`;

if (process.argv.includes('--comprobar')) {
  const actual = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, 'utf8') : '';
  if (actual !== ts) {
    console.error('plantillas.ts NO coincide con Correos.gs / app_ccl.html: vuelve a generarlo.');
    process.exit(1);
  }
  console.log('plantillas.ts coincide con Correos.gs y app_ccl.html');
} else {
  fs.writeFileSync(DESTINO, ts);
  console.log('plantillas.ts escrito (' + ts.length + ' caracteres)');
}
