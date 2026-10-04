// Datos de prueba para el banco del tema oscuro: genera <salida>/mocks.js (window.__responder, para MOCKS de oscuro.mjs) y datos-pagina.json (DATOS_PAGINA).
// La auditoría de Revisión sale del motor REAL (Revision.gs + AuditoriaCotizacion.gs en un vm).
//   node scripts/laboratorio/oscuro-datos.mjs "Carpeta del proyecto" <salida FUERA del repo>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const [, , PROY, SALIDA] = process.argv;
fs.mkdirSync(SALIDA, { recursive: true });

const ctx = { Logger: { log() {} }, console, DEFAULT_FORMAT_ID: 'ccl_liverpool' };
vm.createContext(ctx);
for (const f of ['Revision.gs', 'AuditoriaCotizacion.gs']) {
  vm.runInContext(fs.readFileSync(path.join(PROY, f), 'utf8'), ctx, { filename: f });
}

const ahora = new Date('2026-10-04T12:00:00-06:00').getTime();
const dia = 86400000;
const iso = (ms) => new Date(ms).toISOString();

const productosCrudos = [
  { sku: '1145789322', description: 'Pantalla Samsung 55" Crystal UHD 4K', quantity: 1, unitPrice: 10999, costPaymentUnique: 0, discountPublicPercent: 15, additionalDiscountApplied: 'No', additionalDiscountPercent: 0, imageUrl: '', productUrl: 'https://www.liverpool.com.mx/tienda/pdp/pantalla/1145789322' },
  { sku: '1098234411', description: 'Barra de sonido LG 2.1 canales', quantity: 2, unitPrice: 3499, costPaymentUnique: 0, discountPublicPercent: 10, additionalDiscountApplied: 'Sí', additionalDiscountPercent: 5, imageUrl: '', productUrl: '' },
  { sku: '1077665544', description: 'Soporte de pared articulado', quantity: 1, unitPrice: 899, costPaymentUnique: 199, discountPublicPercent: 0, additionalDiscountApplied: 'No', additionalDiscountPercent: 0, imageUrl: '', productUrl: 'https://ejemplo.com/no-liverpool' }
];
const quote = {
  folio: 'LVP-261004-0042', timestamp: iso(ahora - 3 * 3600000),
  advisorName: 'Ana Pérez', advisorEmail: 'ana.perez@liverpool.com.mx', advisorExt: '4821',
  clientName: 'María Fernanda López', clientEmail: 'mafer.lopez@correo', clientPhone: '55 1234 567',
  summarySubtotal: 15214.66, summaryVat: 2434.34, summaryTotal: 17649, observations: 'Entrega a domicilio en CDMX.',
  format: 'ccl_liverpool', status: 'En Revisión', products: productosCrudos
};
const productos = productosCrudos.map((p, i) => ({
  indice: i, sku: p.sku, description: p.description, quantity: p.quantity, unitPrice: p.unitPrice,
  costPaymentUnique: p.costPaymentUnique, discountPublicPercent: p.discountPublicPercent,
  additionalDiscountApplied: p.additionalDiscountApplied, additionalDiscountPercent: p.additionalDiscountPercent,
  imageUrl: '', productUrl: /liverpool\.com\.mx/.test(p.productUrl) ? p.productUrl : '',
  urlDescartada: !!p.productUrl && !/liverpool\.com\.mx/.test(p.productUrl)
}));
const auditoria = vm.runInContext('revAuditar_', ctx)(quote, productos);

const revision = {
  success: true,
  revisor: { email: 'banco@ventel.test', nombre: 'Banco de Pruebas' },
  quote: Object.assign({}, quote, { driveLink: '' }),
  products: productos,
  sheetEmbedUrl: '', sheetUrl: '', hojaIncrustable: false,
  checklistGeneral: auditoria.puntos, auditoria,
  revision: { estado: 'pendiente', por: '', nombre: '', fecha: '', notas: '', aprobada: false }
};
delete revision.quote.products;

const ESTADOS = [['En Revisión', ''], ['Aprobada', 'aprobada'], ['Enviada por Correo', 'aprobada'], ['Rechazada', 'rechazada'], ['Pendiente', ''], ['Aprobada', 'aprobada']];
const CLIENTES = ['María Fernanda López', 'Jorge Ramírez', 'Lucía Hernández', 'Pedro Sánchez', 'Valeria Gómez', 'Ricardo Torres', 'Sofía Morales', 'Daniel Castro'];
const quotes = CLIENTES.map((c, i) => ({
  folio: 'LVP-26100' + (4 - (i % 3)) + '-00' + (42 - i), cliente: c, correoCliente: c.split(' ')[0].toLowerCase() + '@correo.com',
  asesor: i === 3 ? 'Luis Ortega' : 'Banco de Pruebas', asesorCorreo: i === 3 ? 'luis.ortega@liverpool.com.mx' : 'banco@ventel.test',
  fecha: new Date(ahora - i * dia).toLocaleDateString('es-MX'), total: 1999 + i * 3517.5,
  estatus: ESTADOS[i % ESTADOS.length][0], revisionEstado: ESTADOS[i % ESTADOS.length][1], formato: i % 2 ? 'ccl_liverpool' : 'clasico'
}));
const supervision = quotes.map((q, i) => ({
  folio: q.folio, timestamp: iso(ahora - i * dia), advisorName: q.asesor, advisorEmail: q.asesorCorreo,
  clientName: q.cliente, clientEmail: q.correoCliente, subtotal: q.total / 1.16, vat: q.total - q.total / 1.16, total: q.total,
  status: q.estatus, revisionEstado: q.revisionEstado, revisionPor: q.revisionEstado ? 'Supervisión Ventel' : '',
  fechaEnvio: q.estatus === 'Enviada por Correo' ? iso(ahora - i * dia + 3600000) : '', format: q.formato, observations: ''
}));
const pendientes = supervision.filter((q) => !q.revisionEstado && q.status !== 'Rechazada').map((q) => ({
  folio: q.folio, timestamp: q.timestamp, advisorName: q.advisorName, clientName: q.clientName, total: q.total, status: q.status, revisionEstado: q.revisionEstado
}));
const aten = (id, o) => Object.assign({ id, fecha: iso(ahora - 2 * 3600000), asesor: 'banco@ventel.test', asesorNombre: 'Banco de Pruebas',
  cliente: 'Cliente ' + id, telefono: '5512345678', correo: 'cliente' + id + '@correo.com', tipo: 'Cotización pendiente', notas: 'Llamar para confirmar el envío.',
  horaPromesa: '17:00', liberarEn: '', estado: 'pendiente', rescatadaPor: '', rescatadaEn: '', cerradaPor: '', cerradaEn: '', resultado: '',
  reservaViva: false, reservaRestanteMs: 0, liberada: false }, o);
const atenciones = {
  success: true, yo: { email: 'banco@ventel.test', nombre: 'Banco de Pruebas' },
  mias: [aten('A1', {}), aten('A2', { tipo: 'Seguimiento de pedido', horaPromesa: '', liberarEn: iso(ahora + 3600000) })],
  publicas: [aten('P1', { asesor: 'luis.ortega@liverpool.com.mx', asesorNombre: 'Luis Ortega', liberada: true, liberarEn: iso(ahora - 600000) })],
  cerradas: [aten('C1', { estado: 'cerrada', cerradaPor: 'banco@ventel.test', cerradaEn: iso(ahora - dia), resultado: 'Se concretó la venta' })],
  tipos: ['Cotización pendiente', 'Seguimiento de pedido', 'Devolución'], opcionesLiberar: [], horasSugeridas: ['14:00', '15:00', '16:00', '17:00'],
  reservaMin: 15, zonaHoraria: 'America/Mexico_City', ahora: iso(ahora)
};

const actividad = supervision.slice(0, 5).map((q) => ({ advisorName: q.advisorName, clientName: q.clientName, folio: q.folio }));
const RESPUESTAS = {
  getDashboardStats: { success: true, stats: { currentMonthCount: 42, previousMonthCount: 37,
    quotesPerUser: [{ name: 'Ana Pérez', count: 12 }, { name: 'Luis Ortega', count: 9 }, { name: 'Banco de Pruebas', count: 8 }, { name: 'Sofía Ruiz', count: 7 }, { name: 'Otros', count: 6 }],
    last7Days: actividad, today: actividad.slice(0, 2), lastQuotes: [] } },
  getQuotesForUser: { success: true, quotes },
  getSupervisionQuotes: { success: true, quotes: supervision },
  revListaPendientes: { success: true, quotes: pendientes, message: '' },
  revContarPendientes: { success: true, pendientes: pendientes.length, message: '' },
  getRevisionCotizacion: revision,
  atencionesPanorama: atenciones
};
const js = `window.__RESPUESTAS = ${JSON.stringify(RESPUESTAS)};
window.__responder = function (fn) { return Object.prototype.hasOwnProperty.call(window.__RESPUESTAS, fn) ? JSON.parse(JSON.stringify(window.__RESPUESTAS[fn])) : undefined; };`;
fs.writeFileSync(path.join(SALIDA, 'mocks.js'), js);

// El Monitor con los datos dentro de la página (F3a), como revelado-monitor.mjs: 50 promociones
// vigentes hoy de varias direcciones y dos eventos del calendario comercial (uno en curso).
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const hoy = new Date(); const d = hoy.getDate(), m = MESES[hoy.getMonth()];
const DIRS = ['MULTIMEDIA', 'HOGAR', 'DEPORTES', 'MUJER', 'HOMBRE', 'BEBÉS', 'INFANTILES', 'DIVERSOS'];
const promos = [];
for (let i = 0; i < 50; i++) {
  promos.push({ direccion: DIRS[i % DIRS.length], categoria: 'Categoría ' + (i + 1), promocion: 'Hasta ' + (10 + (i % 6) * 5) + '% de descuento',
    marca: i % 3 ? 'Marca ' + i : '', vigencia: Math.max(1, d - 3) + ' al ' + Math.min(28, d + (i % 7)) + ' de ' + m,
    liga: 'https://www.liverpool.com.mx', origen: i % 4 ? 'Promociones' : 'Marketplace' });
}
const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
const MONITOR = { status: 'success', error: null, promociones: promos, eventos: [
  { titulo: 'GRADUACIONES: SL 15% ME O 9 MSI', inicio: hoy0 - dia, fin: hoy0 + 6 * dia, esTodoElDia: true, ubicacion: '', descripcion: '' },
  { titulo: 'GRAN BARATA: HASTA 40% DE DESC', inicio: hoy0 + 8 * dia, fin: hoy0 + 20 * dia, esTodoElDia: true, ubicacion: '', descripcion: '' }] };
fs.writeFileSync(path.join(SALIDA, 'datos-pagina.json'), JSON.stringify({ Promociones: { fetchApplicationData: MONITOR } }));
console.log('mocks.js', js.length, 'bytes · auditoría:', auditoria.score, auditoria.resumen && auditoria.resumen.slice(0, 80), '· puntos', auditoria.puntos.length);
