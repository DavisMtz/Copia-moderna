/*
 * Prueba del módulo ESTADO DE OPERACIÓN Y ATENCIONES PENDIENTES (agente «operación»).
 *
 *   node pruebas/operacion.test.mjs [baseUrl]          (por omisión http://127.0.0.1:8805)
 *
 * No levanta nada: llama por fetch a un Worker local que ya esté en marcha, igual que las pantallas
 * (POST /api/rpc → secEjecutar). Lo normal es tu base aislada:
 *   scripts/dev-aislado.sh operacion 8805 &
 *
 * Qué comprueba:
 *   · Lo PÚBLICO (tablero e historial) responde sin sesión y no lleva ni un correo ni un nombre.
 *   · Sin sesión no sale nada privado (detalle, panel, atenciones, reportar).
 *   · Tres personas DISTINTAS reportando lo mismo levantan la incidencia «posible»; la misma persona
 *     repitiendo no cuenta.
 *   · Un asesor NO puede nada de supervisión; la supervisora confirma (idempotente ante reintentos),
 *     publica la nota y cierra.
 *   · Las claves del historial por horas son 'AAAA-MM-DD HH' en hora de México.
 *   · Evidencias: se suben a R2 y el reporte solo acepta las nuestras.
 *   · Atenciones: una privada no la ve otro asesor; una liberada sale recortada (sin correos); la
 *     reserva de 15 min impide que la tome otro.
 *
 * Se puede repetir sobre la misma base: cada pasada usa un sistema nuevo con nombre único (con
 * cifras, que nunca se funden con otro) y finaliza o descarta lo que crea. Deja en el catálogo un
 * sistema «Prueba <número>» por pasada: úsala contra tu base aislada, no contra una compartida.
 * El tope de 8 reportes por persona y hora permite unas 8 pasadas por hora.
 */
const BASE = (process.argv[2] || process.env.BASE || 'http://127.0.0.1:8805').replace(/\/$/, '');
const CLAVE = 'VentelDemo2026';
const ZONA = 'America/Mexico_City';

let fallos = 0, pasan = 0;
function ok(cond, que, extra) {
  if (cond) { pasan++; console.log('  ✔ ' + que); }
  else { fallos++; console.log('  ✘ ' + que + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 300) : '')); }
  return !!cond;
}
function seccion(t) { console.log('\n■ ' + t); }

async function rpc(cuerpo) {
  const r = await fetch(BASE + '/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.e);
  return j.v;
}
/** Una función del servidor sin sesión (como el tablero público). */
const publico = (fn, args = []) => rpc({ fn: 'secEjecutar', args: ['', fn, args, Date.now()] });
/** Entra con la UI de siempre (loginUser) y devuelve un llamador con esa sesión. */
async function como(email) {
  const l = await publico('loginUser', [email, CLAVE]);
  if (!l || !l.success) throw new Error('No se pudo entrar como ' + email + ': ' + (l && l.message));
  const f = (fn, args = []) => rpc({ fn: 'secEjecutar', args: [l.llave, fn, args, Date.now()] });
  f.email = email;
  return f;
}

/** Clave de la hora en curso en México, como la arma el servidor ('AAAA-MM-DD HH'). */
function horaMx(fecha = new Date()) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit' }).formatToParts(fecha)) p[x.type] = x.value;
  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour;
}

const NOMBRES = ['Carlos Mendoza', 'Sofía Herrera', 'Jorge Ramírez', 'Valeria Castro', 'Laura Domínguez'];
/** ¿El JSON lleva algún correo o algún nombre de persona? (lo público no puede llevarlos) */
function datosPersonales(obj) {
  const t = JSON.stringify(obj);
  return /@/.test(t) || NOMBRES.some((n) => t.includes(n));
}

const A = 'asesor@ventel.example', S = 'sofia.herrera@ventel.example', J = 'jorge.ramirez@ventel.example';
const V = 'valeria.castro@ventel.example', SUP = 'supervisora@ventel.example';

try {
  console.log('Prueba de operación contra ' + BASE);
  const salud = await fetch(BASE + '/api/salud').then((r) => r.json()).catch(() => null);
  if (!salud || !salud.ok) { console.log('✘ El Worker no contesta en ' + BASE + ' (¿scripts/dev-aislado.sh operacion 8805?)'); process.exit(1); }

  // ── 1. Lo público, sin sesión ──────────────────────────────────────────────────────────────
  seccion('Tablero e historial públicos (sin sesión)');
  const est = await publico('opEstadoPublico');
  ok(est && est.success === true, 'opEstadoPublico responde sin sesión', est);
  ok(Array.isArray(est.sistemas) && est.sistemas.length >= 4 && ['ok', 'warn', 'alert'].includes(est.global),
    'trae los sistemas base y el semáforo global');
  ok(est.sistemas.every((s) => ['clave', 'nombre', 'destacado', 'tono', 'estado', 'estadoNombre', 'incidentes'].every((k) => k in s)),
    'cada sistema tiene la forma del .gs');
  ok(est.sistemas.some((s) => s.clave === 'connect' && s.destacado) && est.sistemas.some((s) => s.clave === 'ccaip' && !s.destacado),
    'Connect destacado y CCAIP en la fila secundaria');
  ok(!datosPersonales(est), 'el tablero público no lleva correos ni nombres');

  const hh = await publico('opHistorialHorasPublico', [24]);
  ok(hh.success && hh.modo === 'horas' && hh.tramos === 24 && hh.eje.length === 24 && hh.totales.length === 24,
    'opHistorialHorasPublico(24): 24 tramos', { modo: hh.modo, tramos: hh.tramos });
  ok(hh.eje.every((k) => /^\d{4}-\d{2}-\d{2} \d{2}$/.test(k)), "las claves de hora son texto 'AAAA-MM-DD HH'", hh.eje.slice(-2));
  const hm = horaMx();
  ok(hh.hasta === hm || hh.hasta === horaMx(new Date(Date.now() - 60000)),
    'la última hora del eje es la hora EN CURSO de México (' + hm + ')', hh.hasta);
  ok(hh.totales.every((t) => ['fecha', 'inicio', 'reportes', 'personas', 'confirmados', 'tono'].every((k) => k in t)) &&
     typeof hh.umbral === 'number' && hh.resumen && 'limpios' in hh.resumen,
    'cada tramo trae fecha, inicio, reportes, personas, confirmados y tono');
  ok(!datosPersonales(hh), 'el historial por horas no lleva correos ni nombres');

  const hd = await publico('opHistorialPublico', [7]);
  ok(hd.success && hd.modo === 'dias' && hd.eje.length === 7 && hd.hasta === hm.slice(0, 10),
    'opHistorialPublico(7): 7 días y el último es hoy en México', { hasta: hd.hasta });
  ok(!datosPersonales(hd), 'el historial por días no lleva correos ni nombres');

  seccion('Sin sesión no sale nada privado');
  const sinDet = await publico('opIncidenteDetalle', ['inc-x', A]);
  ok(sinDet.success === false, 'opIncidenteDetalle sin sesión → no', sinDet);
  ok((await publico('opPanel', [SUP])).success === false, 'opPanel sin sesión → no');
  ok((await publico('atencionesPanorama', [A])).success === false, 'atencionesPanorama sin sesión → no');
  ok((await publico('opReportar', [{ email: A, sistema: 'connect', submotivo: 'Va muy lento' }])).success === false, 'opReportar sin sesión → no');
  ok((await publico('opSubirEvidencia', [{ email: A, dataUrl: 'data:image/png;base64,AAAA' }])).success === false, 'opSubirEvidencia sin sesión → no');
  const sinSes = await publico('opEstadoSesion', [A]);
  ok(sinSes.success === true && sinSes.sesion === false && !('mios' in sinSes) && !('catalogo' in sinSes),
    'opEstadoSesion sin sesión devuelve lo público (sesion:false, sin mios ni catálogo)');

  // ── 2. Tres personas → incidencia ──────────────────────────────────────────────────────────
  seccion('Tres personas distintas reportan lo mismo');
  const a = await como(A), s = await como(S), j = await como(J), v = await como(V), sup = await como(SUP);
  const marca = String(Date.now());
  const sistemaNombre = 'Prueba ' + marca;
  const sistemaClave = 'prueba-' + marca;
  const motivo = 'No responde el sistema de prueba';
  const reporte = (f, extra) => f('opReportar', [Object.assign({ email: f.email, notas: 'Reporte de prueba' }, extra)]);

  const r1 = await reporte(a, { sistema: '', sistemaNuevo: sistemaNombre, submotivoNuevo: motivo });
  if (/varios reportes en la última hora/.test(r1.message || '')) console.log('  (tope de 8 reportes por hora alcanzado: espera o reinicia tu base con --reiniciar)');
  ok(r1.success && !r1.elevado && r1.incidente === null && r1.sistema === sistemaNombre, '1.ª persona: queda registrado', r1);
  const r1b = await reporte(a, { sistema: sistemaClave, submotivo: motivo });
  ok(r1b.success === false && r1b.repetido === true, 'la misma persona repitiendo no cuenta (repetido)', r1b);
  const r2 = await reporte(s, { sistema: sistemaClave, submotivo: motivo });
  ok(r2.success && !r2.elevado, '2.ª persona: todavía no hay incidencia', r2);
  const r3 = await reporte(j, { sistema: sistemaClave, submotivoNuevo: 'no responde el sistema de prueva' });   // con error de dedo
  ok(r3.success && r3.elevado === true && r3.incidente && r3.incidente.estado === 'posible' && r3.incidente.tono === 'warn',
    '3.ª persona (con error de dedo): se levanta la incidencia «posible»', r3);
  ok(r3.submotivo === motivo, 'el error de dedo se funde con el motivo que ya existía', r3.submotivo);
  const incId = r3.incidente && r3.incidente.id;

  const est2 = await publico('opEstadoPublico');
  const incPub = (est2.incidentes || []).find((i) => i.id === incId);
  ok(incPub && incPub.estado === 'posible' && incPub.ultima && /posible que existan problemas/.test(incPub.ultima.nota),
    'el tablero público la enseña como sospecha, con el aviso automático', incPub);
  const sisPub = est2.sistemas.find((x) => x.clave === sistemaClave);
  ok(sisPub && sisPub.tono === 'warn' && !sisPub.destacado, 'el sistema nuevo aparece en la fila secundaria en ámbar', sisPub);
  ok(!datosPersonales(est2), 'y sigue sin correos ni nombres');

  const det = await a('opIncidenteDetalle', [incId, A]);
  ok(det.success && det.incidente.personas === 3 && det.reportes.length === 3, 'con sesión, el detalle trae los 3 reportes de 3 personas', det.incidente);
  ok(det.reportes.some((x) => x.mio && x.correo === A) && det.reportes.every((x) => x.correo && x.nombre),
    'el detalle (con sesión) sí lleva quién reportó y marca el propio');
  ok(det.actualizaciones.some((x) => !x.aviso && /3 personas distintas/.test(x.nota)) && det.actualizaciones.some((x) => x.aviso),
    'deja la anotación pública (aviso) y la interna (con la cifra)');
  ok(det.puedeGestionar === false, 'un asesor no puede gestionar');

  // ── 3. Supervisión ─────────────────────────────────────────────────────────────────────────
  seccion('Puertas de supervisión (un asesor no puede)');
  const neg = (r) => r && r.success === false && /no tiene acceso/.test(r.message || '');
  ok(neg(await a('opPanel', [A])), 'opPanel');
  ok(neg(await a('opRecomendaciones', [A])), 'opRecomendaciones');
  ok(neg(await a('opActualizarIncidente', [{ email: A, id: incId, estado: 'resuelto' }])), 'opActualizarIncidente');
  ok(neg(await a('opCrearIncidente', [{ email: A, sistema: 'connect', submotivo: 'Mantenimiento', estado: 'mantenimiento' }])), 'opCrearIncidente');
  ok(neg(await a('opCrearEstado', [{ email: A, nombre: 'Degradado', tono: 'warn' }])), 'opCrearEstado');
  ok(neg(await a('opElevarReporte', [{ email: A, reporteId: 'rep-x' }])), 'opElevarReporte');
  ok(neg(await a('opDescartarReporte', [{ email: A, reporteId: 'rep-x' }])), 'opDescartarReporte');

  seccion('La supervisora confirma, publica y cierra');
  const panel = await sup('opPanel', [SUP]);
  const incPanel = panel.success && panel.incidentes.find((i) => i.id === incId);
  ok(incPanel && incPanel.personas === 3 && incPanel.reportes === 3 && incPanel.estado === 'posible' && incPanel.origen === 'automatico',
    'el panel la tiene esperando decisión, con 3 personas y 3 reportes', incPanel);
  ok(panel.umbral && panel.umbral.personas === 3 && panel.umbral.minutos === 30 && typeof panel.webhookEstado === 'boolean' &&
     panel.yo && panel.yo.email === SUP && Array.isArray(panel.sueltos) && panel.catalogo && Array.isArray(panel.catalogo.estados),
    'el panel trae umbral, catálogo, sueltos, webhooks y yo');

  const nota = 'Prueba ' + marca + ': ya está el proveedor.';
  const conf = { email: SUP, id: incId, estado: 'confirmado', nota, avisar: true };
  const c1 = await sup('opActualizarIncidente', [conf]);
  ok(c1.success && c1.incidente.estado === 'confirmado' && c1.aviso === true && c1.message === 'Actualizado y avisado al equipo.',
    'confirmar con aviso', c1);
  const c2 = await sup('opActualizarIncidente', [conf]);   // lo que haría la cola al reintentar
  ok(c2.success && c2.incidente.estado === 'confirmado', 'el reintento contesta igual', c2);
  const det2 = await sup('opIncidenteDetalle', [incId, SUP]);
  ok(det2.actualizaciones.filter((x) => x.nota === nota).length === 1, 'y no deja la anotación dos veces (idempotente)',
    det2.actualizaciones.map((x) => x.nota));
  ok(det2.incidente.confirmadoNombre === 'Laura Domínguez' && det2.incidente.confirmado, 'la confirmación queda sellada con quién y cuándo');
  ok((await sup('opActualizarIncidente', [{ email: SUP, id: incId, estado: 'descartado', nota: 'corta' }])).success === false,
    'descartar exige una razón de 10 caracteres');
  ok((await sup('opActualizarIncidente', [{ email: SUP, id: incId, estado: 'inventado-' + marca }])).success === false,
    'un estado que no existe se rechaza');

  const est3 = await publico('opEstadoPublico');
  const incPub3 = est3.incidentes.find((i) => i.id === incId);
  ok(incPub3 && incPub3.estado === 'confirmado' && incPub3.tono === 'alert' && incPub3.ultima && incPub3.ultima.nota === nota,
    'el tablero público enseña la falla confirmada y la nota anunciada', incPub3);

  const sesA = await a('opEstadoSesion', [A]);
  ok(sesA.success && sesA.sesion === true && sesA.puedeGestionar === false && !('revision' in sesA) &&
     sesA.estado && sesA.estado.success && sesA.catalogo && sesA.catalogo.submotivos && sesA.yo.email === A,
    'opEstadoSesion del asesor: estado + catálogo, sin gestionar ni conteo de revisión');
  ok((sesA.mios || []).some((m) => m.incidenteId === incId && m.clave === sistemaClave + '|' + 'no-responde-el-sistema-de-prueba'),
    'y sabe lo que ese asesor ya reportó', sesA.mios);
  const sesS = await sup('opEstadoSesion', [SUP]);
  ok(sesS.success && sesS.puedeGestionar === true && sesS.revision && typeof sesS.revision.pendientes === 'number',
    'opEstadoSesion de la supervisora: puede gestionar y trae el conteo de revisión', sesS.revision);

  const fin = await sup('opActualizarIncidente', [{ email: SUP, id: incId, estado: 'resuelto', nota: 'Restablecido (prueba).', avisar: true }]);
  ok(fin.success && fin.incidente.estado === 'resuelto', 'marcar resuelto', fin);
  ok(!(await publico('opEstadoPublico')).incidentes.some((i) => i.id === incId), 'resuelta, desaparece del tablero público');
  const panel2 = await sup('opPanel', [SUP]);
  ok(panel2.incidentes.some((i) => i.id === incId && i.cierra === true && i.estado === 'resuelto'), 'y queda en «cerradas esta semana»');

  // ── 4. Evidencias ──────────────────────────────────────────────────────────────────────────
  seccion('Evidencias (R2) y reportes sueltos');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const ev = await v('opSubirEvidencia', [{ email: V, dataUrl: png, nombre: 'captura.png' }]);
  ok(ev.success && /\/archivos\/subidas\/evidencias\//.test(ev.url) && ev.id && ev.nombre === 'captura.png', 'opSubirEvidencia guarda la captura', ev);
  if (ev.success) {
    const img = await fetch(BASE + ev.url.replace(/^https?:\/\/[^/]+/, ''));
    ok(img.status === 200 && /image\/png/.test(img.headers.get('content-type') || ''), 'la captura se sirve desde /archivos/');
  }
  ok((await v('opSubirEvidencia', [{ email: V, dataUrl: 'data:application/pdf;base64,JVBERi0=' }])).success === false, 'solo se aceptan imágenes');
  const sueltoRep = await reporte(v, {
    sistema: sistemaClave, submotivoNuevo: 'Con captura ' + marca,
    evidencias: [{ url: ev.url, id: ev.id, nombre: ev.nombre }, { url: 'https://otro.example/archivos/subidas/evidencias/x.png', id: 'x', nombre: 'ajena' }]
  });
  ok(sueltoRep.success && !sueltoRep.incidente, 'un reporte de una sola persona queda suelto', sueltoRep);
  const panel3 = await sup('opPanel', [SUP]);
  const suelto = panel3.sueltos.find((x) => x.id === sueltoRep.reporteId);
  ok(suelto && suelto.evidencias.length === 1 && suelto.evidencias[0].url.startsWith('/archivos/subidas/evidencias/'),
    'el panel lo lista con SOLO la captura nuestra (la ajena se descarta)', suelto && suelto.evidencias);
  const d1 = await sup('opDescartarReporte', [{ email: SUP, reporteId: sueltoRep.reporteId }]);
  const d2 = await sup('opDescartarReporte', [{ email: SUP, reporteId: sueltoRep.reporteId }]);
  ok(d1.success && d2.success, 'descartar el suelto (y repetirlo) funciona: es idempotente');
  ok(!(await sup('opPanel', [SUP])).sueltos.some((x) => x.id === sueltoRep.reporteId), 'descartado, sale de la lista de sueltos');

  const reco = await sup('opRecomendaciones', [SUP]);
  ok(reco.success && Array.isArray(reco.recomendaciones) && reco.periodo === 'los últimos 7 días' && reco.generado,
    'opRecomendaciones responde con su contrato');

  // ── 5. Atenciones ──────────────────────────────────────────────────────────────────────────
  seccion('Atenciones: privacidad, liberación y reserva');
  const priv = await a('atencionRegistrar', [A, { cliente: 'Privado ' + marca, telefono: '55 1234 5678', correo: 'privado@cliente.example', tipo: 'Venta', notas: 'Solo mía' }]);
  ok(priv.success && priv.atencion && priv.atencion.liberarEn === '' && priv.atencion.estado === 'pendiente', 'registrar una atención privada', priv);
  const panS = await s('atencionesPanorama', [S]);
  ok(panS.success && !JSON.stringify(panS).includes(priv.atencion.id) && !JSON.stringify(panS).includes('Privado ' + marca),
    'otro asesor NO ve la atención privada');
  ok((await s('atencionActualizar', [S, priv.atencion.id, { notas: 'x' }])).success === false, 'ni puede editarla');
  ok((await s('atencionRescatar', [S, priv.atencion.id])).success === false, 'ni tomarla');

  const lib = await j('atencionRegistrar', [J, { cliente: 'Liberado ' + marca, telefono: '5598765432', correo: 'liberado@cliente.example', tipo: 'Aclaración', notas: 'Llamar por la factura' }]);
  ok(lib.success, 'otro asesor registra la suya', lib);
  const la = await j('atencionLiberarAhora', [J, lib.atencion.id]);
  ok(la.success && la.liberarEn, 'y la libera ya', la);
  ok((await a('atencionLiberarAhora', [A, lib.atencion.id])).success === false, 'solo su autor puede liberarla');

  const panS2 = await s('atencionesPanorama', [S]);
  const pub = (panS2.publicas || []).find((x) => x.id === lib.atencion.id);
  ok(pub && pub.publica === true && pub.cliente === 'Liberado ' + marca && pub.telefono && pub.notas, 'la liberada aparece en el pool de los demás', pub);
  ok(pub && !('correo' in pub) && !('asesor' in pub) && !('rescatadaPor' in pub) && !JSON.stringify(pub).includes('@'),
    'recortada: sin el correo del cliente ni el del asesor (atenVersionPublica)', pub);
  ok(panS2.reservaMin === 15 && panS2.zonaHoraria === ZONA && Array.isArray(panS2.tipos) && panS2.opcionesLiberar.length === 6,
    'el panorama trae reserva, zona horaria, tipos y opciones de liberación');

  const toma = await s('atencionRescatar', [S, lib.atencion.id]);
  ok(toma.success && toma.atencion && toma.atencion.correo === 'liberado@cliente.example' && toma.atencion.reservaViva === true,
    'tomarla da la ficha completa durante la reserva', toma);
  ok((await a('atencionRescatar', [A, lib.atencion.id])).success === false, 'mientras dura la reserva, nadie más la toma');
  const n1 = await s('atencionActualizar', [S, lib.atencion.id, { notas: 'No contestó' }]);
  const n2 = await s('atencionActualizar', [S, lib.atencion.id, { notas: 'No contestó' }]);
  ok(n1.success && n2.success, 'guardar anotaciones dos veces (lo que reintenta la cola) es inofensivo');
  const cierre = await s('atencionFinalizar', [S, lib.atencion.id, 'Se cerró la venta']);
  ok(cierre.success, 'quien la tomó la finaliza', cierre);
  const panJ = await j('atencionesPanorama', [J]);
  ok((panJ.cerradas || []).some((x) => x.id === lib.atencion.id && x.cerradaPor === S && x.resultado === 'Se cerró la venta'),
    'su autor la ve en el historial de cerradas');

  const finPriv = await a('atencionFinalizar', [A, priv.atencion.id, 'Limpieza de la prueba']);
  ok(finPriv.success, 'limpieza: se finaliza la privada');
  ok((await publico('atencionRegistrar', [A, { cliente: 'X', telefono: '5512345678' }])).success === false, 'sin sesión no se registra nada');
} catch (e) {
  fallos++;
  console.log('\n✘ La prueba se detuvo: ' + (e && e.message));
}

console.log('\n' + pasan + ' comprobaciones bien, ' + fallos + ' mal.');
process.exit(fallos ? 1 : 0);
