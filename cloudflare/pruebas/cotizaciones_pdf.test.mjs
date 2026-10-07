/*
 * Prueba del PDF de la cotización SIN Browser Rendering (Node puro; no necesita el Worker levantado).
 *
 *   node pruebas/cotizaciones_pdf.test.mjs
 *
 * En local el binding NAVEGADOR no existe y generarPdf siempre da null, así que el PDF real solo se ve
 * en producción. Esto prueba todo lo demás:
 *   1. Que plantillas.ts sigue siendo copia literal de Correos.gs y app_ccl.html (generar-plantillas).
 *   2. El HTML que se manda a convertir, armado por documentos.ts (empaquetado aquí con esbuild):
 *      formato 'actual' (generateQuoteHtml_) y CCL (réplica de app_ccl.html), con sus importes.
 *   3. Si hay Chromium local (/opt/pw-browsers/chromium), lo convierte a PDF con las MISMAS opciones que
 *      nucleo/pdf.ts (formato en minúsculas, fondos, márgenes, apaisado para el CCL) y con la red
 *      CORTADA: un logotipo o una imagen que no carga no puede romper el PDF.
 * Sale con código 1 si algo falla.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(RAIZ, 'package.json'));
const CHROMIUM = process.env.CHROMIUM || '/opt/pw-browsers/chromium';

let fallos = 0, pasos = 0;
function ok(condicion, mensaje, detalle) {
  pasos++;
  if (condicion) { console.log('  ✔ ' + mensaje); return true; }
  fallos++;
  console.log('  ✘ ' + mensaje + (detalle !== undefined ? '\n      → ' + JSON.stringify(detalle).slice(0, 400) : ''));
  return false;
}
const seccion = (t) => console.log('\n■ ' + t);

/** La cotización tal como la devuelve cotDetalleFolio (la misma de pruebas/cotizaciones.test.mjs). */
const COTIZACION = {
  folio: 'LVP-261006-0042',
  timestamp: '2026-10-06T20:52:04.368Z',
  advisorEmail: 'asesor@ventel.example',
  advisorName: 'Carlos Mendoza',
  advisorExt: '',
  clientName: 'María José <b>González</b>',
  clientEmail: 'maria.gonzalez@example.com',
  clientPhone: '5512345678',
  summarySubtotal: 3522.61,
  summaryVat: 563.62,
  summaryTotal: 4086.23,
  status: 'Aprobada',
  observations: 'Entrega en tienda Perisur.',
  format: 'ccl_liverpool',
  products: [
    { sku: '1094234567', description: 'Pantalla LED 55 pulgadas', quantity: 2, unitPrice: 1500, costPaymentUnique: 0,
      discountPublicPercent: 10, additionalDiscountApplied: 'No', additionalDiscountPercent: 0,
      imageUrl: 'https://ss628.liverpool.com.mx/xl/1094234567.jpg', productUrl: '' },
    { sku: '1102345678', description: 'Barra de sonido', quantity: 1, unitPrice: 899.9, costPaymentUnique: 750,
      discountPublicPercent: 16.66, additionalDiscountApplied: 'No', additionalDiscountPercent: 0, imageUrl: '', productUrl: '' },
    { sku: '1113456789', description: 'Cable HDMI 2 m', quantity: 3, unitPrice: 249.5, costPaymentUnique: 0,
      discountPublicPercent: 0, additionalDiscountApplied: 'Si', additionalDiscountPercent: 15, imageUrl: '', productUrl: '' }
  ]
};
const LOGO_DATOS = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function principal() {
  seccion('Las plantillas siguen siendo copia literal del original');
  let coincide = true;
  try {
    execFileSync('node', [path.join(RAIZ, 'src/worker/modulos/cotizaciones/generar-plantillas.mjs'), '--comprobar'], { stdio: 'pipe' });
  } catch { coincide = false; }
  ok(coincide, 'plantillas.ts = Correos.gs (correo y PDF «actual») + app_ccl.html (CCL)');

  // documentos.ts es TypeScript del Worker: se empaqueta con el esbuild que trae wrangler.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cot-pdf-'));
  const salida = path.join(dir, 'documentos.mjs');
  require('esbuild').buildSync({
    entryPoints: [path.join(RAIZ, 'src/worker/modulos/cotizaciones/documentos.ts')],
    bundle: true, format: 'esm', platform: 'neutral', outfile: salida, logLevel: 'silent'
  });
  const doc = await import(pathToFileURL(salida).href);

  seccion('Formato «actual» (el HTML de generateQuoteHtml_)');
  const actual = doc.documentoActualHtml(COTIZACION, LOGO_DATOS);
  ok(/<!DOCTYPE html>/.test(actual) && actual.includes('COTIZACIÓN') && actual.includes('LVP-261006-0042'),
     'documento completo con el folio');
  ok(actual.includes('06 de octubre de 2026'), 'fecha de emisión en hora de México («06 de octubre de 2026»)');
  ok(actual.includes('María José &lt;b&gt;González&lt;/b&gt;') && !actual.includes('<b>González'), 'los datos del cliente van escapados');
  ok(actual.includes('Púb: 10.00%. Total: $300.00 (10.00% DesTot.)'), 'descuento público con el texto del .gs');
  ok(actual.includes('$149.90 (16.66% DesTot.)'), 'pago único: solo el descuento monetario y su porcentaje');
  ok(actual.includes('Adic: 15.00%. Total: $112.27 (15.00% DesTot.)'), 'descuento adicional con el texto del .gs');
  ok(actual.includes('$3,522.61') && actual.includes('$563.62') && actual.includes('$4,086.23'), 'subtotal, IVA y total guardados');
  ok(actual.includes('Observaciones Adicionales') && actual.includes('Entrega en tienda Perisur.'), 'bloque de observaciones');
  ok(!/src="https?:/.test(actual) && actual.includes(LOGO_DATOS), 'nada remoto: el logotipo va incrustado');
  const sinProductos = doc.documentoActualHtml(Object.assign({}, COTIZACION, { products: [], observations: '' }), LOGO_DATOS);
  ok(sinProductos.includes('No hay productos en esta cotización.') && !sinProductos.includes('Observaciones Adicionales'),
     'sin productos ni observaciones, como el .gs');

  seccion('Formato CCL (la réplica de app_ccl.html)');
  const ccl = doc.documentoCclHtml(COTIZACION, LOGO_DATOS);
  ok(ccl.includes('class="ccl-sheet v-papel"') && !ccl.includes('v-papel hidden'), 'la hoja va visible (sin «hidden»)');
  ok(ccl.includes('06 de octubre de 2026   |   Folio: LVP-261006-0042'), 'fecha y folio como populateCclPreview');
  ok(ccl.includes('Dirigida a: María José &lt;b&gt;González&lt;/b&gt;') && ccl.includes('Correo: maria.gonzalez@example.com') &&
     ccl.includes('Teléfono: 5512345678') && ccl.includes('Observación: Entrega en tienda Perisur.'), 'datos del cliente escapados');
  ok((ccl.match(/<tr>\s*<td class="ccl-txt">/g) || []).length === 3, 'una fila por producto');
  ok(ccl.includes('<td id="ccl-subtotal">$3,522.61</td>') &&
     ccl.includes('<td id="ccl-iva">$563.62</td>') && ccl.includes('<td id="ccl-total">$4,086.23</td>'),
     'totales calculados con las fórmulas de la plantilla');
  ok(ccl.includes('16.66%') && ccl.includes('15.00%') && ccl.includes('<td class="ccl-cen">Si</td>'), 'porcentajes y «Descuento adicional»');
  ok(!/src="https?:/.test(ccl) && !/fonts\.googleapis|<link /.test(ccl), 'nada remoto: sin fuentes web y con el logotipo incrustado');
  const r = doc.computeCclRow({ quantity: 1, unitPrice: 1000, costPaymentUnique: 800, discountPublicPercent: 0,
    additionalDiscountApplied: 'Si', additionalDiscountPercent: 0 });
  ok(Math.abs(r.additionalFraction - 0.2) < 1e-9 && r.discountFraction === 0 && Math.abs(r.total - 800) < 1e-9,
     'pago único con descuento adicional → va a la columna adicional (como buildCclProductRow_)', r);

  seccion('Conversión a PDF con Chromium (las opciones de nucleo/pdf.ts), con la red cortada');
  if (!existsSync(CHROMIUM)) {
    console.log('  · (sin Chromium en ' + CHROMIUM + ': no se convierte)');
  } else {
    const { chromium } = require('playwright-core');
    const nav = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
    try {
      const pagina = await nav.newPage();
      const pedidas = [];
      await pagina.route('**/*', (ruta) => { pedidas.push(ruta.request().url()); return ruta.abort(); });
      const convertir = async (html, op) => {
        const t0 = Date.now();
        await pagina.setContent(html, { waitUntil: 'networkidle', timeout: 20000 });
        const margen = op.margen || '10mm';
        const pdf = await pagina.pdf({ format: op.formato || 'letter', printBackground: true, landscape: !!op.horizontal,
          margin: { top: margen, right: margen, bottom: margen, left: margen } });
        return { pdf, ms: Date.now() - t0, paginas: (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length };
      };
      const a = await convertir(actual, { formato: 'letter', margen: '12mm' });
      ok(a.pdf.subarray(0, 4).toString() === '%PDF' && a.paginas >= 1, `«actual» → PDF carta (${a.pdf.length} bytes, ${a.paginas} pág., ${a.ms} ms)`);
      const c = await convertir(ccl, { formato: 'a4', horizontal: true, margen: '18mm' });
      ok(c.pdf.subarray(0, 4).toString() === '%PDF' && c.paginas === 1, `CCL → PDF A4 apaisado en una página (${c.pdf.length} bytes, ${c.ms} ms)`);
      ok(pedidas.length === 0, 'con el logotipo incrustado el navegador no pidió nada a la red', pedidas);
      // Si el logotipo NO se pudo incrustar (queda la URL remota) y la red no contesta, el PDF sale igual.
      const remoto = await convertir(doc.documentoCclHtml(COTIZACION), { formato: 'a4', horizontal: true, margen: '18mm' });
      ok(remoto.pdf.subarray(0, 4).toString() === '%PDF' && pedidas.some((u) => u.includes('wikimedia')),
         'una imagen que no carga no rompe el PDF', pedidas);
      if (process.env.GUARDAR_PDF) {
        writeFileSync(path.join(process.env.GUARDAR_PDF, 'cotizacion-actual.pdf'), a.pdf);
        writeFileSync(path.join(process.env.GUARDAR_PDF, 'cotizacion-ccl.pdf'), c.pdf);
        console.log('  · PDF guardados en ' + process.env.GUARDAR_PDF);
      }
    } finally {
      await nav.close();
    }
  }
  rmSync(dir, { recursive: true, force: true });

  console.log('\n' + (pasos - fallos) + '/' + pasos + ' comprobaciones bien' + (fallos ? ' · ' + fallos + ' FALLARON' : ''));
  process.exit(fallos ? 1 : 0);
}

principal().catch((e) => { console.error('\nERROR: ' + (e && e.stack || e)); process.exit(1); });
