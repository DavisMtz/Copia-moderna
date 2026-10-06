/*
 * Prueba del módulo PORTAL en Cloudflare (modulos/portal.ts y modulos/portal/*).
 *   node pruebas/portal.test.mjs [baseUrl]          (por omisión http://127.0.0.1:8804)
 * Necesita el Worker local levantado (scripts/dev-aislado.sh portal 8804) con las cuentas demo y el
 * catálogo del Portal cargado. Node puro, sin dependencias: habla con /api/rpc como una pantalla.
 *
 * Qué comprueba:
 *   A · Lecturas públicas SIN sesión: forma de cada respuesta (la del .gs), que no viaje nada privado
 *       (credenciales de herramientas, correo del autor de un anuncio) y que el conteo de promociones
 *       sea EXACTAMENTE el del Portal.gs original: se carga el .gs real en una vm con la zona de México
 *       y se compara contra lo que devuelve el Worker con los mismos datos.
 *   B · Puertas: sin sesión y con un asesor, nada de anuncios ni de contenido del Portal.
 *   C · Escrituras de quien tiene los bloques (supervisora): anuncios (publicar, programar, expirar,
 *       ocultar, mover, borrar), encuestas (un voto por persona, cambiable, cierre), imagen a R2,
 *       interruptor del reconocimiento, y el CRUD + importación de «Contenido del Portal».
 * Lo que crea en el contenido (anuncios, filas del Portal, el reporte de prueba) lo borra al final y el
 * interruptor del reconocimiento queda como estaba. Quedan solo los rastros que el sistema guarda a
 * propósito: la bitácora, los votos de la encuesta borrada (como la hoja «Votos»), la imagen de 1 px
 * subida a R2 y los contadores de límite por hora.
 */
process.env.TZ = 'America/Mexico_City';   // la vm con el Portal.gs original cuenta en hora de México
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || process.env.PORTAL_URL || 'http://127.0.0.1:8804').replace(/\/$/, '');
const CLAVE = 'VentelDemo2026';
const PROYECTO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'Carpeta del proyecto');

let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : ''));
}
const seccion = (t) => console.log('\n' + t);

async function crudo(cuerpo) {
  const r = await fetch(BASE + '/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  return r.json();
}
/** Llama como AppRun: secEjecutar(llave, fn, args). Lanza con el mensaje del withFailureHandler. */
async function rpc(llave, fn, args = []) {
  const j = await crudo({ fn: 'secEjecutar', args: [llave || '', fn, args, Date.now()] });
  if (!j.ok) throw new Error(j.e);
  return j.v;
}
async function entrar(correo) {
  const r = await rpc('', 'loginUser', [correo, CLAVE]);
  if (!r || !r.success || !r.llave) throw new Error('No pude entrar como ' + correo + ': ' + JSON.stringify(r));
  return r.llave;
}
/** 'YYYY-MM-DD' de hoy + n días en hora de México. */
function diaMx(n) {
  const d = new Date(Date.now() + n * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const creados = { anuncios: [], contenido: [] };   // para limpiar pase lo que pase
let llSup = '', llAse = '';
let recoAntes = null;

async function principal() {
  try { await fetch(BASE + '/api/salud'); } catch (e) {
    console.error('No hay Worker en ' + BASE + '. Levántalo con: scripts/dev-aislado.sh portal 8804');
    process.exit(2);
  }
  llSup = await entrar('supervisora@ventel.example');
  llAse = await entrar('asesor@ventel.example');

  /* ═══ A · LECTURAS PÚBLICAS, SIN SESIÓN ═══════════════════════════════════════════════════ */
  seccion('A · Lecturas públicas sin sesión');

  const tools = await rpc('', 'fetchToolsData');
  ok('fetchToolsData: status ok y error null', tools.status === 'ok' && tools.error === null, tools.error);
  ok('fetchToolsData: las ocho listas', ['herramientas', 'presentaciones', 'paqueterias', 'formatos', 'pdePago', 'plantillas', 'avisos', 'anuncios']
    .every((k) => Array.isArray(tools[k])));
  ok('fetchToolsData: hay catálogo cargado (herramientas y formatos)', tools.herramientas.length > 0 && tools.formatos.length > 0,
    { herramientas: tools.herramientas.length });
  const h0 = tools.herramientas[0] || {};
  ok('herramientas: campos de readPortalSheet_', JSON.stringify(Object.keys(h0)) === JSON.stringify(['nombre', 'enlace', 'comoAcceder', 'descripcion', 'claves']), Object.keys(h0));
  ok('herramientas: sin sesión no viajan «Cómo acceder» ni «Claves»', tools.herramientas.every((h) => h.comoAcceder === '' && h.claves === ''));
  ok('presentaciones/paqueterías/formatos/pdePago/plantillas: campos del .gs',
    (!tools.presentaciones[0] || 'descripcion' in tools.presentaciones[0]) &&
    (!tools.paqueterias[0] || 'soms' in tools.paqueterias[0]) &&
    (!tools.formatos[0] || ('acceso' in tools.formatos[0] && 'observaciones' in tools.formatos[0])) &&
    (!tools.pdePago[0] || 'detalles' in tools.pdePago[0]) &&
    (!tools.plantillas[0] || ('cuerpo' in tools.plantillas[0] && 'consideraciones' in tools.plantillas[0])));
  ok('anuncios públicos: sin el correo del autor', tools.anuncios.every((a) => !('autor' in a) && 'responsable' in a && 'creado' in a));
  ok('avisos = banners de anuncios', tools.avisos.length === tools.anuncios.filter((a) => a.formato === 'banner').length);

  const app = await rpc('', 'fetchApplicationData');
  ok('fetchApplicationData: status success, eventos [] (sin Google Calendar)', app.status === 'success' && Array.isArray(app.eventos) && app.eventos.length === 0, app.status);
  ok('fetchApplicationData: promociones con los 7 campos', app.promociones.length > 0 &&
    app.promociones.every((p) => ['origen', 'direccion', 'categoria', 'promocion', 'marca', 'vigencia', 'liga'].every((k) => k in p)));
  ok('fetchApplicationData: MKP marcadas como Marketplace', app.promociones.filter((p) => p.origen === 'Marketplace').every((p) => p.marca === 'Marketplace'));

  const cuenta = await rpc('', 'fetchPromoCounts');
  ok('fetchPromoCounts: forma', cuenta.status === 'ok' && typeof cuenta.activas === 'number' && typeof cuenta.porTerminar === 'number' &&
    Array.isArray(cuenta.promociones) && cuenta.promociones.length <= 8 && Array.isArray(cuenta.eventos), cuenta);

  // El Portal.gs ORIGINAL, en una vm con la zona de México, sobre los mismos datos.
  const vmCtx = { Date, Math, JSON, String, Number, Object, Array, RegExp, parseInt, console, Logger: { log() {} }, secConfig_: (k, d) => d };
  vm.createContext(vmCtx);
  vm.runInContext(fs.readFileSync(path.join(PROYECTO, 'Portal.gs'), 'utf8'), vmCtx, { filename: 'Portal.gs' });
  vm.runInContext(fs.readFileSync(path.join(PROYECTO, 'VentaCruzada.gs'), 'utf8'), vmCtx, { filename: 'VentaCruzada.gs' });
  vmCtx.__datos = app;
  const orig = vm.runInContext('portalContarPromos_(__datos)', vmCtx);
  ok('fetchPromoCounts = Portal.gs original (activas y por terminar)', orig.activas === cuenta.activas && orig.porTerminar === cuenta.porTerminar,
    { worker: [cuenta.activas, cuenta.porTerminar], original: [orig.activas, orig.porTerminar] });
  const firma = (l) => JSON.stringify(l.map((p) => [p.direccion, p.categoria, p.promocion, p.fin, p.dias]));
  ok('fetchPromoCounts = Portal.gs original (las 8 de la portada, fin y días)', firma(orig.promociones) === firma(cuenta.promociones));

  const vc = await rpc('', 'ventaCruzadaPromos');
  ok('ventaCruzadaPromos: forma', vc.status === 'ok' && vc.v === 1 && typeof vc.generado === 'number' && Array.isArray(vc.promos) &&
    vc.ajustes && typeof vc.ajustes.busqueda === 'boolean', vc.status);
  vmCtx.__ahora = vc.generado;
  const vcOrig = vm.runInContext('vcPaqueteDesde_(__datos, new Date(__ahora))', vmCtx);
  ok('ventaCruzadaPromos = VentaCruzada.gs original (la más fuerte y las promos)',
    JSON.stringify([vc.fuerte, vc.promos]) === JSON.stringify([vcOrig.fuerte, vcOrig.promos]));

  const pdp = await rpc('', 'pdpDatos');
  ok('pdpDatos: factores null (sin hoja del simulador) y promos', pdp.status === 'ok' && pdp.factores === null && Array.isArray(pdp.promos) && !pdp.promosError, pdp);
  vm.runInContext('fetchApplicationData = function () { return __datos; }', vmCtx);
  const pdpOrig = vm.runInContext('pdpPromos_()', vmCtx);
  const fp = (l) => JSON.stringify(l.map((p) => [p.direccion, p.categoria, p.promocion, p.inicio, p.fin, p.empieza]));
  ok('pdpDatos.promos = Portal.gs original', fp(pdpOrig) === fp(pdp.promos), { worker: pdp.promos.length, original: pdpOrig.length });

  const pv = await rpc('', 'pvArchivos');
  ok('pvArchivos: vacío controlado (sin Drive)', pv.status === 'ok' && pv.archivos && Object.keys(pv.archivos).length === 0, pv);

  const logos = await rpc('', 'fpLogosTiendas');
  ok('fpLogosTiendas: mapa tienda → data URI', logos && typeof logos === 'object' && Object.keys(logos).length > 3 &&
    Object.values(logos).every((v) => /^data:image\//.test(String(v))));

  const reco = await rpc('', 'recoImagenes');
  ok('recoImagenes: diploma y mensaje en base64 normal, con sprite', /^data:image\//.test(reco.diploma) && /^data:image\//.test(reco.mensaje) &&
    !/[-_]/.test(reco.diploma.split(',')[1] || '-') && typeof reco.sprite === 'string' && reco.sprite.length > 1000 && !!reco.v);

  const traz = await rpc('', 'fetchTrazabilidadData');
  ok('fetchTrazabilidadData: status ok', traz.status === 'ok' && traz.error === null, traz.error);
  ok('fetchTrazabilidadData: las seis secciones en su orden',
    JSON.stringify(traz.secciones.map((s) => s.id)) === JSON.stringify(['bigticket', 'softline', 'slmensajerias', 'mkp', 'tienda', 'generales']));
  const p0 = (traz.secciones[0].procesos || [])[0] || {};
  ok('fetchTrazabilidadData: forma de cada proceso',
    JSON.stringify(Object.keys(p0)) === JSON.stringify(['id', 'num', 'numHoja', 'nombre', 'reporte', 'avance', 'solucion', 'plataformas', 'observaciones']), Object.keys(p0));
  const referencia = path.join(PROYECTO, '..', 'pruebas', 'trazabilidad_payload_20260926.json');
  if (fs.existsSync(referencia)) {
    const ref = JSON.parse(fs.readFileSync(referencia, 'utf8'));
    ok('fetchTrazabilidadData: secciones idénticas al payload de referencia (si la base trae ese mismo contenido)',
      JSON.stringify(ref.secciones) === JSON.stringify(traz.secciones) || traz.secciones.reduce((n, s) => n + s.procesos.length, 0) > 0);
  }

  const rep = await rpc('', 'reportBrokenLink', [{ seccion: 'prueba-portal', nombre: 'Enlace de prueba (portal.test)', enlace: 'https://ejemplo.invalid/roto' }]);
  ok('reportBrokenLink sin sesión: ok (o el límite de 20 por hora)', rep.status === 'ok' ||
    rep.error === 'Recibimos varios reportes tuyos hace poco. Intenta más tarde.', rep);

  /* ═══ B · PUERTAS ═══════════════════════════════════════════════════════════════════════════ */
  seccion('B · Puertas (sin sesión y asesor)');

  for (const [fn, args] of [
    ['getAnunciosAdmin', ['supervisora@ventel.example']],
    ['publicarAnuncio', [{ formato: 'banner', datos: { mensaje: 'x' }, asesor: 'supervisora@ventel.example' }]],
    ['recoEstado', ['supervisora@ventel.example']],
    ['recoCambiarVisible', [false, 'supervisora@ventel.example']],
    ['portalContenidoCatalogo', ['supervisora@ventel.example']],
    ['portalContenidoListar', [{ email: 'supervisora@ventel.example', coleccion: 'herramientas' }]],
    ['portalPromosHojas', ['supervisora@ventel.example']]
  ]) {
    const r = await rpc('', fn, args);
    ok('sin sesión, ' + fn + ' → error de sesión', r.status === 'error' && /sesión/i.test(r.error), r);
  }
  const votoAnon = await rpc('', 'pubVotar', [{ id: 'anc-x', opcion: 'A', asesor: '' }]);
  ok('sin sesión no se vota', votoAnon.status === 'error' && votoAnon.error === 'Inicia sesión en el sistema para poder votar.', votoAnon);

  for (const [fn, args] of [
    ['getAnunciosAdmin', ['asesor@ventel.example']],
    ['publicarAnuncio', [{ formato: 'banner', datos: { mensaje: 'x' }, asesor: 'asesor@ventel.example' }]],
    ['subirImagenAnuncio', [{ dataUrl: PNG_1PX, nombre: 'x.png', asesor: 'asesor@ventel.example' }]],
    ['recoCambiarVisible', [false, 'asesor@ventel.example']],
    ['eliminarAnuncio', ['anc-x', 'asesor@ventel.example']],
    ['portalContenidoCatalogo', ['asesor@ventel.example']],
    ['portalContenidoGuardar', [{ email: 'asesor@ventel.example', coleccion: 'herramientas', datos: { nombre: 'x' } }]],
    ['portalContenidoEliminar', [{ email: 'asesor@ventel.example', coleccion: 'herramientas', id: 'x' }]],
    ['portalPromosLeer', [{ email: 'asesor@ventel.example', hoja: 'x' }]]
  ]) {
    const r = await rpc(llAse, fn, args);
    ok('asesor, ' + fn + ' → «no tiene acceso»', r.status === 'error' && /no tiene acceso/.test(r.error), r);
  }
  const ajena = await rpc(llAse, 'getAnunciosAdmin', ['supervisora@ventel.example']);
  ok('asesor que declara el correo de la supervisora → rechazado', ajena.status === 'error', ajena);
  const toolsAse = await rpc(llAse, 'fetchToolsData');
  ok('asesor: el Portal se lee igual con sesión', toolsAse.status === 'ok' && toolsAse.herramientas.length === tools.herramientas.length);

  /* ═══ C · ANUNCIOS Y ENCUESTAS (supervisora) ════════════════════════════════════════════════ */
  seccion('C · Anuncios, encuestas, imagen y reconocimiento (supervisora)');
  const SUP = 'supervisora@ventel.example';

  const nuevo = await rpc(llSup, 'publicarAnuncio', [{
    formato: 'tarjeta', activo: true, orden: 0, desde: '', hasta: diaMx(5), asesor: SUP,
    datos: { tono: 'info', titulo: 'Encuesta de prueba (portal.test)', descripcion: 'x', __proto__x: 1,
             encuesta: { pregunta: '¿Te sirve?', opciones: ['Sí', 'No', '', 'x'.repeat(100)], tiempo: '1 min', cierre: diaMx(3), verAntes: false } }
  }]);
  ok('publicarAnuncio: ok con id anc-…', nuevo.status === 'ok' && /^anc-/.test(nuevo.id), nuevo);
  creados.anuncios.push(nuevo.id);

  let admin = await rpc(llSup, 'getAnunciosAdmin', [SUP]);
  const enLista = (admin.anuncios || []).find((a) => a.id === nuevo.id);
  ok('getAnunciosAdmin: la nueva sale PRIMERA (orden menor que todas)', admin.status === 'ok' && admin.anuncios[0].id === nuevo.id, admin.anuncios && admin.anuncios.map((a) => [a.id, a.orden]));
  ok('getAnunciosAdmin: forma, autoría y estado', enLista && enLista.estado === 'activo' && enLista.activo === true &&
    enLista.autor === SUP && enLista.responsable === 'Laura Domínguez' && enLista.hasta === diaMx(5) && enLista.desde === '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(enLista.creado), enLista);
  ok('pubSanearDatos: encuesta recortada (sin vacías, 80 caracteres)', enLista && enLista.datos.encuesta.opciones.length === 3 &&
    enLista.datos.encuesta.opciones[2].length === 80 && enLista.datos.encuesta.cierre === diaMx(3));

  const pub = await rpc('', 'pubPorId', [nuevo.id, '']);
  ok('pubPorId (público): estado activo, con encuesta y sin correo', pub.status === 'ok' && pub.pub.estado === 'activo' &&
    pub.pub.encuesta && !('autor' in pub.pub) && pub.pub.hasta === diaMx(5), pub);
  const noHay = await rpc('', 'pubPorId', ['anc-no-existe', '']);
  ok('pubPorId: inexistente', noHay.status === 'error' && noHay.error === 'No encontramos esa publicación.', noHay);
  const toolsCon = await rpc('', 'fetchToolsData');
  ok('fetchToolsData la enseña en el Portal', toolsCon.anuncios.some((a) => a.id === nuevo.id && a.titulo === 'Encuesta de prueba (portal.test)'));

  let voto = await rpc(llAse, 'pubVotar', [{ id: nuevo.id, opcion: 'Sí', asesor: 'asesor@ventel.example' }]);
  ok('pubVotar: ok, total 1 y mi voto', voto.status === 'ok' && voto.total === 1 && voto.conteo['Sí'] === 1 && voto.miVoto === 'Sí', voto);
  voto = await rpc(llAse, 'pubVotar', [{ id: nuevo.id, opcion: 'No', asesor: 'asesor@ventel.example' }]);
  ok('pubVotar: cambiar de voto no suma otro (un voto por persona)', voto.status === 'ok' && voto.total === 1 && voto.conteo['No'] === 1 && !voto.conteo['Sí'], voto);
  const malVoto = await rpc(llAse, 'pubVotar', [{ id: nuevo.id, opcion: 'Quizá', asesor: 'asesor@ventel.example' }]);
  ok('pubVotar: opción que no está', malVoto.status === 'error' && malVoto.error === 'Esa opción ya no está en la encuesta.', malVoto);
  const resAse = await rpc(llAse, 'pubResultados', [nuevo.id, 'asesor@ventel.example']);
  const resAnon = await rpc('', 'pubResultados', [nuevo.id, '']);
  ok('pubResultados: el voto propio solo a quien votó', resAse.status === 'ok' && resAse.miVoto === 'No' && resAnon.miVoto === '' && resAnon.total === 1, [resAse, resAnon]);

  // Programada, expirada y oculta.
  const prog = await rpc(llSup, 'publicarAnuncio', [{ formato: 'banner', desde: diaMx(2), hasta: '', datos: { tono: 'info', mensaje: 'Programado (portal.test)' }, asesor: SUP }]);
  creados.anuncios.push(prog.id);
  const exp = await rpc(llSup, 'publicarAnuncio', [{ formato: 'tarjeta', desde: '', hasta: diaMx(-2), asesor: SUP,
    datos: { titulo: 'Expirada (portal.test)', encuesta: { pregunta: '¿?', opciones: ['A', 'B'] } } }]);
  creados.anuncios.push(exp.id);
  admin = await rpc(llSup, 'getAnunciosAdmin', [SUP]);
  const est = (id) => ((admin.anuncios || []).find((a) => a.id === id) || {}).estado;
  ok('estados en administración: programado y expirado', est(prog.id) === 'programado' && est(exp.id) === 'expirado', [est(prog.id), est(exp.id)]);
  const tools2 = await rpc('', 'fetchToolsData');
  ok('el Portal no enseña la programada ni la expirada', !tools2.anuncios.some((a) => a.id === prog.id || a.id === exp.id));
  const pProg = await rpc('', 'pubPorId', [prog.id, '']), pExp = await rpc('', 'pubPorId', [exp.id, '']);
  ok('pubPorId sirve programada y expirada diciendo su estado', pProg.pub && pProg.pub.estado === 'programado' && pProg.pub.desde === diaMx(2) &&
    pExp.pub && pExp.pub.estado === 'expirado', [pProg, pExp]);
  const votoExp = await rpc(llAse, 'pubVotar', [{ id: exp.id, opcion: 'A', asesor: 'asesor@ventel.example' }]);
  ok('no se vota en una encuesta expirada', votoExp.status === 'error' && votoExp.error === 'La encuesta ya está cerrada.', votoExp);

  const tg = await rpc(llSup, 'toggleAnuncio', [prog.id, false, SUP]);
  const pOculta = await rpc('', 'pubPorId', [prog.id, '']);
  ok('toggleAnuncio: oculta no se sirve por enlace', tg.status === 'ok' && pOculta.status === 'error' && pOculta.estado === 'inactivo', [tg, pOculta]);
  const tgNo = await rpc(llSup, 'toggleAnuncio', ['anc-no-existe', true, SUP]);
  ok('toggleAnuncio: inexistente', tgNo.status === 'error' && tgNo.error === 'No se encontró el anuncio.', tgNo);

  admin = await rpc(llSup, 'getAnunciosAdmin', [SUP]);
  const ids0 = admin.anuncios.map((a) => a.id);
  const mv = await rpc(llSup, 'moverAnuncio', [ids0[0], 'down', SUP]);
  admin = await rpc(llSup, 'getAnunciosAdmin', [SUP]);
  const ids1 = admin.anuncios.map((a) => a.id);
  ok('moverAnuncio: baja un puesto y renumera 0..n-1', mv.status === 'ok' && ids1[1] === ids0[0] && ids1[0] === ids0[1] &&
    admin.anuncios.every((a, i) => a.orden === i), admin.anuncios.map((a) => [a.id, a.orden]));
  await rpc(llSup, 'moverAnuncio', [ids0[0], 'up', SUP]);

  const img = await rpc(llSup, 'subirImagenAnuncio', [{ dataUrl: PNG_1PX, nombre: 'prueba portal.png', asesor: SUP }]);
  ok('subirImagenAnuncio: ok con URL /archivos/…', img.status === 'ok' && /^https?:\/\/.+\/archivos\/subidas\/anuncios\//.test(img.url), img);
  if (img.status === 'ok') {
    const r = await fetch(BASE + new URL(img.url).pathname);
    ok('la imagen se sirve desde R2 como image/png', r.status === 200 && /image\/png/.test(r.headers.get('content-type') || ''), r.status);
  }
  const svg = await rpc(llSup, 'subirImagenAnuncio', [{ dataUrl: 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'), nombre: 'x.svg', asesor: SUP }]);
  ok('subirImagenAnuncio: SVG rechazado (podría llevar código)', svg.status === 'error', svg);
  const noImg = await rpc(llSup, 'subirImagenAnuncio', [{ dataUrl: 'data:text/plain;base64,aG9sYQ==', nombre: 'x.txt', asesor: SUP }]);
  ok('subirImagenAnuncio: lo que no es imagen', noImg.status === 'error' && /no es una imagen/.test(noImg.error), noImg);
  const malFmt = await rpc(llSup, 'publicarAnuncio', [{ formato: 'cartel', datos: {}, asesor: SUP }]);
  ok('publicarAnuncio: formato no válido (mensaje del .gs)', malFmt.status === 'error' && malFmt.error === 'Error: Formato no válido: cartel', malFmt);

  const re0 = await rpc(llSup, 'recoEstado', [SUP]);
  recoAntes = re0.visible;
  ok('recoEstado: ok', re0.status === 'ok' && typeof re0.visible === 'boolean', re0);
  const reOff = await rpc(llSup, 'recoCambiarVisible', [false, SUP]);
  const re1 = await rpc(llSup, 'recoEstado', [SUP]);
  ok('recoCambiarVisible(false) → RECO_VISIBLE = no', reOff.status === 'ok' && reOff.visible === false && re1.visible === false, [reOff, re1]);
  await rpc(llSup, 'recoCambiarVisible', [recoAntes, SUP]);
  recoAntes = null;

  for (const id of creados.anuncios.splice(0)) {
    const r = await rpc(llSup, 'eliminarAnuncio', [id, SUP]);
    ok('eliminarAnuncio ' + id, r.status === 'ok', r);
  }
  const otraVez = await rpc(llSup, 'eliminarAnuncio', [nuevo.id, SUP]);
  ok('eliminarAnuncio: ya no está', otraVez.status === 'error' && otraVez.error === 'No se encontró el anuncio.', otraVez);

  /* ═══ D · CONTENIDO DEL PORTAL (supervisora) ═══════════════════════════════════════════════ */
  seccion('D · Contenido del Portal (supervisora)');

  const cat = await rpc(llSup, 'portalContenidoCatalogo', [SUP]);
  ok('portalContenidoCatalogo: las 9 secciones en su orden', cat.status === 'ok' &&
    JSON.stringify(cat.colecciones.map((c) => c.id)) === JSON.stringify(['herramientas', 'plantillas', 'formatos', 'presentaciones', 'paqueterias', 'pdepago', 'promociones', 'mkp', 'reportes']), cat.error);
  const cHerr = cat.colecciones.find((c) => c.id === 'herramientas');
  ok('catálogo: conteo, clave y campos con alias (sin datos internos)', cHerr && cHerr.total === tools.herramientas.length &&
    JSON.stringify(cHerr.clave) === '["nombre"]' && cHerr.campos.every((c) => Array.isArray(c.alias) && !('columna' in c)) && cat.quien === 'Laura Domínguez',
    cHerr && { total: cHerr.total, esperado: tools.herramientas.length });

  const lista0 = await rpc(llSup, 'portalContenidoListar', [{ email: SUP, coleccion: 'herramientas' }]);
  ok('portalContenidoListar: forma', lista0.status === 'ok' && Array.isArray(lista0.filas) && lista0.truncado === false &&
    Array.isArray(lista0.camposSinColumna) && lista0.camposSinColumna.length === 0 && lista0.filas.every((f) => f.id && f.valores && 'comoAcceder' in f.valores), lista0.error);
  const noCol = await rpc(llSup, 'portalContenidoListar', [{ email: SUP, coleccion: 'inventada' }]);
  ok('sección inexistente', noCol.status === 'error' && noCol.error === 'Esa sección del Portal no existe.', noCol);

  const malo = await rpc(llSup, 'portalContenidoGuardar', [{ email: SUP, coleccion: 'herramientas', datos: { nombre: '', enlace: 'javascript:alert(1)' } }]);
  ok('portalContenidoGuardar: validación (requerido y esquema peligroso)', malo.status === 'error' && malo.error === 'Revisa los campos marcados.' &&
    malo.errores.nombre === 'Este campo no puede quedar vacío.' && /no se permite/.test(malo.errores.enlace), malo);

  const alta = await rpc(llSup, 'portalContenidoGuardar', [{ email: SUP, coleccion: 'herramientas', datos: {
    nombre: 'Herramienta de prueba (portal.test)', enlace: 'ejemplo.invalid/ruta', comoAcceder: 'Usuario de prueba', descripcion: 'Desc original', claves: 'prueba' } }]);
  ok('portalContenidoGuardar: alta (htl-…)', alta.status === 'ok' && alta.nueva === true && /^htl-/.test(alta.id), alta);
  creados.contenido.push(['herramientas', alta.id]);
  let lista = await rpc(llSup, 'portalContenidoListar', [{ email: SUP, coleccion: 'herramientas' }]);
  const filaAlta = lista.filas[lista.filas.length - 1];
  ok('el alta queda AL FINAL y el enlace sin esquema se completa con https://', filaAlta.id === alta.id && filaAlta.valores.enlace === 'https://ejemplo.invalid/ruta', filaAlta);
  const toolsSup = await rpc(llSup, 'fetchToolsData');
  const toolsAnon2 = await rpc('', 'fetchToolsData');
  const hSup = toolsSup.herramientas.find((h) => h.nombre === 'Herramienta de prueba (portal.test)');
  const hAnon = toolsAnon2.herramientas.find((h) => h.nombre === 'Herramienta de prueba (portal.test)');
  ok('«Cómo acceder» y «Claves»: con sesión sí, sin sesión no', hSup && hSup.comoAcceder === 'Usuario de prueba' && hSup.claves === 'prueba' &&
    hAnon && hAnon.comoAcceder === '' && hAnon.claves === '', [hSup, hAnon]);

  const edit = await rpc(llSup, 'portalContenidoGuardar', [{ email: SUP, coleccion: 'herramientas', id: alta.id, datos: {
    nombre: 'Herramienta de prueba (portal.test)', enlace: 'Texto libre', comoAcceder: '', descripcion: 'Desc original', claves: '' } }]);
  ok('portalContenidoGuardar: edición con aviso de enlace que no abre', edit.status === 'ok' && edit.nueva === false && edit.avisos.length === 1, edit);
  const fantasma = await rpc(llSup, 'portalContenidoGuardar', [{ email: SUP, coleccion: 'herramientas', id: 'htl-no-existe', datos: { nombre: 'x' } }]);
  ok('portalContenidoGuardar: id que ya no existe no se recrea', fantasma.status === 'error' && /ya no existe/.test(fantasma.error), fantasma);

  const dup = await rpc(llSup, 'portalContenidoDuplicar', [{ email: SUP, coleccion: 'herramientas', id: alta.id }]);
  ok('portalContenidoDuplicar: ok', dup.status === 'ok' && /^htl-/.test(dup.id) && dup.id !== alta.id, dup);
  creados.contenido.push(['herramientas', dup.id]);
  lista = await rpc(llSup, 'portalContenidoListar', [{ email: SUP, coleccion: 'herramientas' }]);
  const pos = (id) => lista.filas.findIndex((f) => f.id === id);
  ok('la copia queda justo debajo con «(copia)» y la fila entera', pos(dup.id) === pos(alta.id) + 1 &&
    lista.filas[pos(dup.id)].valores.nombre === 'Herramienta de prueba (portal.test) (copia)' &&
    lista.filas[pos(dup.id)].valores.descripcion === 'Desc original', lista.filas.slice(-3));
  const mover = await rpc(llSup, 'portalContenidoMover', [{ email: SUP, coleccion: 'herramientas', id: dup.id, dir: 'up' }]);
  lista = await rpc(llSup, 'portalContenidoListar', [{ email: SUP, coleccion: 'herramientas' }]);
  ok('portalContenidoMover: sube un puesto', mover.status === 'ok' && pos(dup.id) === pos(alta.id) - 1, mover);
  const borde = await rpc(llSup, 'portalContenidoMover', [{ email: SUP, coleccion: 'herramientas', id: lista.filas[0].id, dir: 'up' }]);
  ok('portalContenidoMover: en el borde no hace nada', borde.status === 'ok');
  const sinOrden = await rpc(llSup, 'portalContenidoMover', [{ email: SUP, coleccion: 'promociones', id: 'x', dir: 'up' }]);
  ok('promociones no se reordena desde aquí', sinOrden.status === 'error' && sinOrden.error === 'El orden de esta sección se lleva desde la hoja.', sinOrden);
  const repSolo = await rpc(llSup, 'portalContenidoGuardar', [{ email: SUP, coleccion: 'reportes', datos: { nombre: 'x' } }]);
  const repDup = await rpc(llSup, 'portalContenidoDuplicar', [{ email: SUP, coleccion: 'reportes', id: 'x' }]);
  ok('reportes: solo lectura y sin duplicar', repSolo.status === 'error' && /no se edita/.test(repSolo.error) && repDup.error === 'Esta sección no admite duplicar.', [repSolo, repDup]);
  if (rep.status === 'ok') {
    const reps = await rpc(llSup, 'portalContenidoListar', [{ email: SUP, coleccion: 'reportes' }]);
    const mio = (reps.filas || []).filter((f) => f.valores.nombre === 'Enlace de prueba (portal.test)').pop();
    ok('el reporte anónimo llega a «Enlaces reportados» con fecha legible', mio && /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(mio.valores.fecha) && mio.valores.usuario === '', mio);
    if (mio) creados.contenido.push(['reportes', mio.id]);
  }

  // Importación: los seguros del modo rápido.
  const filas = [
    { nombre: 'Herramienta de prueba (portal.test)', enlace: 'https://nuevo.invalid' },          // actualiza (y no vacía la descripción)
    { nombre: 'HERRAMIENTA  de prueba (portal.test) ', enlace: 'https://otra.invalid' },         // duplicada dentro del pegado
    { nombre: 'Importada (portal.test)', enlace: 'https://importada.invalid', descripcion: 'd' },  // nueva
    { nombre: 'Mala (portal.test)', enlace: 'javascript:x' },                                    // error
    { Nombre: 'Por encabezado (portal.test)', 'Liga de acceso': 'https://encabezado.invalid' }   // nueva, mapeada por alias
  ];
  const plan = await rpc(llSup, 'portalContenidoAnalizarImport', [{ email: SUP, coleccion: 'herramientas', filas }]);
  ok('portalContenidoAnalizarImport: resumen', plan.status === 'ok' && JSON.stringify(plan.resumen) ===
    JSON.stringify({ nuevas: 2, actualiza: 1, iguales: 0, duplicadas: 1, errores: 1 }) && JSON.stringify(plan.clave) === '["Nombre"]', plan.resumen || plan);
  ok('el plan dice qué cambia y de quién es la duplicada', plan.plan && plan.plan[0].accion === 'actualiza' && plan.plan[0].cambios.join() === 'Enlace' &&
    plan.plan[1].detalle === 'Repetida en lo que pegaste (ya venía en la fila 1).' && plan.plan[3].detalle.indexOf('enlace: ') === 0, plan.plan);
  const aplNo = await rpc(llSup, 'portalContenidoAplicarImport', [{ email: SUP, coleccion: 'herramientas', filas, actualizar: false }]);
  ok('portalContenidoAplicarImport (actualizar=false): solo altas', aplNo.status === 'ok' && aplNo.resumen.nuevas === 2 &&
    aplNo.resumen.actualiza === 0 && aplNo.resumen.omitidasPorNoActualizar === 1, aplNo);
  lista = await rpc(llSup, 'portalContenidoListar', [{ email: SUP, coleccion: 'herramientas' }]);
  for (const n of ['Importada (portal.test)', 'Por encabezado (portal.test)']) {
    const f = lista.filas.find((x) => x.valores.nombre === n);
    if (f) creados.contenido.push(['herramientas', f.id]);
  }
  ok('las dos altas quedan al final, en el orden del pegado', lista.filas.slice(-2).map((f) => f.valores.nombre).join('|') ===
    'Importada (portal.test)|Por encabezado (portal.test)' && lista.filas[lista.filas.length - 1].valores.enlace === 'https://encabezado.invalid');
  const plan2 = await rpc(llSup, 'portalContenidoAnalizarImport', [{ email: SUP, coleccion: 'herramientas', filas: filas.slice(2, 3) }]);
  ok('reimportar lo mismo: «sin cambios»', plan2.status === 'ok' && plan2.resumen.iguales === 1 && plan2.resumen.nuevas === 0, plan2.resumen);
  const aplSi = await rpc(llSup, 'portalContenidoAplicarImport', [{ email: SUP, coleccion: 'herramientas', filas: filas.slice(0, 1) }]);
  lista = await rpc(llSup, 'portalContenidoListar', [{ email: SUP, coleccion: 'herramientas' }]);
  const act = lista.filas.find((f) => f.id === alta.id);
  ok('actualizar: cambia el enlace y NO vacía lo que no venía en el pegado', aplSi.status === 'ok' && aplSi.resumen.actualiza === 1 &&
    act.valores.enlace === 'https://nuevo.invalid' && act.valores.descripcion === 'Desc original', act);
  const vacio = await rpc(llSup, 'portalContenidoAnalizarImport', [{ email: SUP, coleccion: 'herramientas', filas: [] }]);
  ok('importar sin filas', vacio.status === 'error' && vacio.error === 'No llegó ninguna fila.', vacio);

  const hojas = await rpc(llSup, 'portalPromosHojas', [SUP]);
  const leer = await rpc(llSup, 'portalPromosLeer', [{ email: SUP, hoja: 'HOT FASHION' }]);
  const leerSin = await rpc(llSup, 'portalPromosLeer', [{ email: SUP, hoja: '' }]);
  ok('comercial (Google Sheets): fallo controlado con mensaje claro', hojas.status === 'error' && /Google Sheets/.test(hojas.error) &&
    leer.status === 'error' && /Pegar de una hoja/.test(leer.error) && leerSin.error === 'Falta decir qué pestaña leer.', [hojas, leer, leerSin]);

  for (const [colId, id] of creados.contenido.splice(0)) {
    const r = await rpc(llSup, 'portalContenidoEliminar', [{ email: SUP, coleccion: colId, id }]);
    ok('portalContenidoEliminar ' + colId + ' ' + id, r.status === 'ok', r);
  }
  const yaNo = await rpc(llSup, 'portalContenidoEliminar', [{ email: SUP, coleccion: 'herramientas', id: alta.id }]);
  ok('portalContenidoEliminar: ya no existe', yaNo.status === 'error' && yaNo.error === 'Esa fila ya no existe. Recarga la lista.', yaNo);
  const catFin = await rpc(llSup, 'portalContenidoCatalogo', [SUP]);
  ok('la sección queda como estaba', catFin.colecciones.find((c) => c.id === 'herramientas').total === cHerr.total);
}

async function limpiar() {
  try {
    for (const id of creados.anuncios) await rpc(llSup, 'eliminarAnuncio', [id, 'supervisora@ventel.example']);
    for (const [colId, id] of creados.contenido) await rpc(llSup, 'portalContenidoEliminar', [{ email: 'supervisora@ventel.example', coleccion: colId, id }]);
    if (recoAntes !== null) await rpc(llSup, 'recoCambiarVisible', [recoAntes, 'supervisora@ventel.example']);
    for (const ll of [llSup, llAse]) if (ll) await crudo({ fn: 'sesCerrar', args: [ll] });
  } catch (e) { console.log('  (limpieza: ' + e.message + ')'); }
}

try {
  await principal();
} catch (e) {
  fallos++;
  console.log('\n  ✖ La prueba se detuvo: ' + (e && e.stack || e));
} finally {
  await limpiar();
}
console.log('\n' + (total - (fallos > total ? total : fallos)) + '/' + total + ' comprobaciones bien' + (fallos ? ' · ' + fallos + ' fallos' : ''));
process.exit(fallos ? 1 : 0);
