/*
 * Prueba del módulo CONSOLA Y ADMINISTRACIÓN en Cloudflare (modulos/consola.ts y modulos/consola/*).
 *   node pruebas/consola.test.mjs [baseUrl]          (por omisión http://127.0.0.1:8806)
 * Necesita el Worker local levantado (scripts/dev-aislado.sh consola 8806) con las cuentas demo.
 * Node puro, sin dependencias: habla con /api/rpc como una pantalla (secEjecutar con llave de sesión).
 *
 * Qué comprueba:
 *   A · Puertas: sin sesión no hay datos privados; un asesor no entra a nada de la consola ni de
 *       supervisión; la supervisora solo ve sus secciones; declarar otro correo no sirve.
 *   B · Jerarquía (Permisos.gs): una supervisora no toca a un maestro, no se da permisos a sí misma,
 *       no asigna el rol maestro, no reparte bloques de administración, no restablece ni borra a un
 *       maestro; nadie se deja fuera (darse de baja a uno mismo).
 *   C · Formas de las respuestas que pinta consola.html (panorama, miembros, ajustes, bitácora, salud).
 *   D · Ciclo completo de un miembro: alta con contraseña temporal, cambio de rol y accesos, baja y
 *       reactivación, restablecimiento y borrado, con los textos de bitácora del original.
 *   E · Ajustes (validaciones), módulos y formatos.
 *   F · Grupos (Ventel virtual, fusión con `base`, veto jerárquico) y difusión (bloques saneados,
 *       prueba y envío al grupo en CCO).
 *   G · Monitoreo y el contrato monRegistrarBusqueda (vía getQuotesForUser de cotizaciones).
 *   H · Correo a clientes (enviarCorreoPlantilla) y artículos.
 * Todas las direcciones son de ejemplo (@ventel.example, @ejemplo.com): el núcleo nunca las manda de
 * verdad. Lo que se crea se borra al final y los ajustes tocados vuelven a como estaban. Quedan los
 * rastros que el sistema guarda a propósito: bitácora, métricas, bandeja de salida y lecturas.
 */
const BASE = (process.argv[2] || process.env.CONSOLA_URL || 'http://127.0.0.1:8806').replace(/\/$/, '');
const CLAVE = 'VentelDemo2026';
const M = 'maestro@ventel.example';
const S = 'supervisora@ventel.example';
const A = 'asesor@ventel.example';
const SUFIJO = Date.now().toString(36);
const NUEVO = 'prueba.consola.' + SUFIJO + '@ventel.example';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let total = 0, fallos = 0;
function ok(nombre, cond, extra) {
  total++;
  if (cond) { console.log('  ✔ ' + nombre); return; }
  fallos++;
  console.log('  ✖ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : ''));
}
const seccion = (t) => console.log('\n' + t);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(llave, fn, args = []) {
  const r = await fetch(BASE + '/api/rpc', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fn: 'secEjecutar', args: [llave || '', fn, args, Date.now()] })
  });
  const j = await r.json();
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
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + n * 86400000));
}
const negado = (r) => !!r && r.success === false && typeof r.message === 'string' && r.message.length > 0;

const limpiar = { miembro: false, grupo: '', articulo: '', ajustes: {}, modulo: false, formato: false };
let llM = '', llS = '', llA = '';

async function principal() {
  try { await fetch(BASE + '/api/salud'); } catch {
    console.error('No hay Worker en ' + BASE + '. Levántalo con: scripts/dev-aislado.sh consola 8806');
    process.exit(2);
  }
  [llM, llS, llA] = [await entrar(M), await entrar(S), await entrar(A)];

  /* ═══ A · PUERTAS ═══════════════════════════════════════════════════════════════════════ */
  seccion('A · Puertas');
  for (const fn of ['consolaPanorama', 'consolaMiembros', 'consolaBitacora', 'grpListar', 'difPreparar', 'monPanorama']) {
    const r = await rpc('', fn, [M]);
    ok('sin sesión, ' + fn + ' no da datos', negado(r) && /sesi[oó]n/i.test(r.message), r);
  }
  const sinSesionArt = await rpc('', 'artListar', ['', {}]);
  ok('sin sesión, artListar: error y sin artículos', sinSesionArt.status === 'error' && (sinSesionArt.articulos || []).length === 0, sinSesionArt);
  const sinSesionIdx = await rpc('', 'artIndiceBuscador', ['']);
  ok('sin sesión, artIndiceBuscador: ok y vacío (degradación del Portal público)', sinSesionIdx.status === 'ok' && sinSesionIdx.articulos.length === 0, sinSesionIdx);
  const sinSesionCorreo = await rpc('', 'enviarCorreoPlantilla', [{ plantilla: 'ticket', to: 'x@ejemplo.com', asunto: 'x', htmlBody: '<p>x</p>', asesor: A }]);
  ok('sin sesión, enviarCorreoPlantilla: status error', sinSesionCorreo.status === 'error', sinSesionCorreo);

  for (const [fn, args] of [
    ['consolaPanorama', [A]], ['consolaGuardarMiembro', [A, { email: 'sofia.herrera@ventel.example', activo: false }]],
    ['consolaAltaMiembro', [A, { nombre: 'X', email: 'x@ventel.example' }]], ['consolaResetPassword', [A, 'sofia.herrera@ventel.example']],
    ['consolaGuardarAjuste', [A, 'CUENTAS_DOMINIO', 'ninguno']], ['consolaGuardarModulo', [A, 'cotizar', true]],
    ['consolaSalud', [A]], ['grpListar', [A]], ['difEnviar', [A, { grupoId: 'ventel', asunto: 'x', bloques: [{ tipo: 'titulo', texto: 'x' }] }]],
    ['monCotizaciones', [A, {}]], ['monBusquedas', [A, {}]], ['consolaBitacoraRango', [A, diaMx(-1), diaMx(0)]]
  ]) {
    ok('asesor NO puede ' + fn, negado(await rpc(llA, fn, args)));
  }
  for (const [fn, args] of [['artGuardar', [{ titulo: 'x', asesor: A }]], ['artLectores', ['art-x', A]],
    ['artEliminar', ['art-x', A]], ['artSubirImagen', [{ dataUrl: 'data:image/png;base64,' + PNG_1PX, asesor: A }]]]) {
    const r = await rpc(llA, fn, args);
    ok('asesor NO puede ' + fn + ' (bloque «articulos»)', r.status === 'error' && /Publicar art/.test(r.error), r);
  }
  const ajena = await rpc(llS, 'consolaPanorama', [M]);
  ok('declarar el correo de otra cuenta no sirve', negado(ajena) && /otra cuenta/.test(ajena.message), ajena);
  for (const fn of ['consolaGuardarAjuste', 'consolaGuardarModulo', 'consolaGuardarFormato', 'consolaSalud', 'consolaAjustes']) {
    const r = await rpc(llS, fn, fn === 'consolaGuardarAjuste' ? [S, 'CUENTAS_DOMINIO', 'ninguno'] : [S, 'promociones', true]);
    ok('supervisora NO puede ' + fn + ' (solo maestro)', negado(r) && /maestro/.test(r.message), r);
  }

  /* ═══ B · JERARQUÍA ═════════════════════════════════════════════════════════════════════ */
  seccion('B · Jerarquía y candados');
  const casos = [
    ['no toca a un maestro', 'consolaGuardarMiembro', [S, { email: M, activo: false }], /nivel superior/],
    ['no se da permisos a sí misma', 'consolaGuardarMiembro', [S, { email: S, rol: 'maestro' }], /tus propios permisos/],
    ['no reparte bloques que no tiene', 'consolaGuardarMiembro', [S, { email: A, mas: ['adm_ajustes'], menos: [] }], /No puedes repartir/],
    ['no asigna el rol maestro', 'consolaGuardarMiembro', [S, { email: A, rol: 'maestro' }], /por encima de tu nivel/],
    ['no da de alta a un maestro', 'consolaAltaMiembro', [S, { nombre: 'X', email: 'x.' + SUFIJO + '@ventel.example', rol: 'maestro' }], /por encima de tu nivel/],
    ['no restablece la contraseña de un maestro', 'consolaResetPassword', [S, M], /nivel superior/],
    ['no borra a un maestro', 'consolaEliminarMiembro', [S, M, M], /nivel superior/]
  ];
  for (const [nombre, fn, args, rx] of casos) {
    const r = await rpc(llS, fn, args);
    ok('supervisora ' + nombre, negado(r) && rx.test(r.message), r);
  }
  const yoBaja = await rpc(llM, 'consolaGuardarMiembro', [M, { email: M, activo: false }]);
  ok('el maestro no se da de baja a sí mismo', negado(yoBaja), yoBaja);
  const yoBorro = await rpc(llM, 'consolaEliminarMiembro', [M, M, M]);
  ok('nadie se borra a sí mismo', negado(yoBorro) && /ti mismo/.test(yoBorro.message), yoBorro);
  const malConfirmado = await rpc(llM, 'consolaEliminarMiembro', [M, 'sofia.herrera@ventel.example', 'otra@ventel.example']);
  ok('borrar exige teclear el correo exacto', negado(malConfirmado) && /tal cual/.test(malConfirmado.message), malConfirmado);

  /* ═══ C · FORMAS ════════════════════════════════════════════════════════════════════════ */
  seccion('C · Formas de las respuestas');
  const pM = await rpc(llM, 'consolaPanorama', [M]);
  ok('panorama maestro: success, yo, catálogo y las 8 secciones', pM.success && pM.yo && pM.yo.maestro === true && pM.yo.nivel === 3 &&
     ['resumen', 'roles', 'modulos', 'ajustes', 'formatos', 'salud', 'bitacora', 'metricas'].every((s) => pM.secciones.includes(s)), pM.secciones);
  ok('panorama maestro: listas presentes', ['miembros', 'ajustes', 'gruposAjustes', 'enlacesAjustes', 'grupos', 'formatos', 'recomendaciones', 'bitacora']
    .every((k) => Array.isArray(pM[k])), Object.keys(pM));
  ok('panorama maestro: catálogo con 24 bloques y 3 roles', pM.catalogo.bloques.length === 24 && pM.catalogo.roles.length === 3);
  const m0 = pM.miembros[0] || {};
  ok('miembro: campos del original y sin hash de contraseña', ['email', 'nombre', 'rol', 'rolNombre', 'nivel', 'activo', 'heredado', 'ajustes', 'bloques', 'gestionable', 'motivo', 'alta', 'fila']
    .every((k) => k in m0) && !('password_hash' in m0) && !JSON.stringify(pM).includes('password_hash'), m0);
  ok('miembros: el nivel más alto primero', pM.miembros.every((m, i, a) => i === 0 || a[i - 1].nivel >= m.nivel));
  ok('resumen maestro: cifras del sistema', pM.resumen.alcance === 'sistema' && typeof pM.resumen.cotizaciones === 'number' &&
     pM.resumen.zonaHoraria === 'America/Mexico_City' && pM.resumen.cuotaCorreo >= 0, pM.resumen);
  const sal = pM.ajustes.find((a) => a.clave === 'HASH_SALT');
  ok('ajustes: la sal es de solo lectura y su valor no viaja', sal && sal.soloLectura === true && sal.valor === '' && sal.secreto === true, sal);
  ok('ajustes: el formato de un ajuste es el del original', pM.ajustes.every((a) => ['clave', 'nombre', 'detalle', 'grupo', 'tipo', 'opciones', 'marcador', 'secreto',
    'soloMaestro', 'opcional', 'soloLectura', 'enPropiedades', 'enCodigo', 'configurado', 'valor', 'pista'].every((k) => k in a)));
  ok('formatos: id, name, enabled, available', pM.formatos.length >= 1 && pM.formatos.every((f) => 'id' in f && 'name' in f && 'enabled' in f && 'available' in f), pM.formatos);
  ok('recomendaciones: texto, tono, accion, panel, pagina', pM.recomendaciones.every((x) => ['texto', 'tono', 'accion', 'panel', 'pagina'].every((k) => k in x)));

  const pS = await rpc(llS, 'consolaPanorama', [S]);
  ok('panorama supervisora: solo resumen, roles, bitácora y métricas', pS.success &&
     JSON.stringify([...pS.secciones].sort()) === JSON.stringify(['bitacora', 'metricas', 'resumen', 'roles']), pS.secciones);
  ok('supervisora: no ve a ningún maestro en la lista', pS.miembros.length > 0 && pS.miembros.every((m) => m.nivel <= 2) && !pS.miembros.some((m) => m.email === M));
  ok('supervisora: su propia fila no es gestionable', (pS.miembros.find((m) => m.email === S) || {}).gestionable === false);
  ok('supervisora: catálogo sin bloques de administración ni rol maestro', !pS.catalogo.bloques.some((b) => b.admin) && !pS.catalogo.roles.some((r) => r.id === 'maestro'));
  ok('supervisora: sin ajustes, formatos ni cifras de instalación', pS.ajustes.length === 0 && pS.formatos.length === 0 &&
     pS.resumen.alcance === 'jerarquia' && pS.resumen.urlApp === '' && pS.resumen.cuotaCorreo === -1, pS.resumen);

  const miem = await rpc(llS, 'consolaMiembros', [S]);
  ok('consolaMiembros: miembros + resumen', miem.success && Array.isArray(miem.miembros) && miem.resumen);
  const aj = await rpc(llM, 'consolaAjustes', [M]);
  ok('consolaAjustes: ajustes, grupos y enlaces', aj.success && aj.ajustes.length > 10 && aj.grupos.length === 4 && Array.isArray(aj.enlaces));

  const salud = await rpc(llM, 'consolaSalud', [M]);
  const checks = (salud.reporte && salud.reporte.checks) || [];
  ok('consolaSalud: reporte con fecha, url, ok y duración', salud.success && /^\d{4}-\d\d-\d\dT/.test(salud.reporte.fecha) &&
     typeof salud.reporte.ok === 'boolean' && typeof salud.reporte.duracionMs === 'number' && salud.reporte.url.length > 0, salud.reporte && { ...salud.reporte, checks: checks.length });
  ok('consolaSalud: cada comprobación con área, nombre, ok y detalle', checks.length > 40 &&
     checks.every((c) => c.area && c.nombre && typeof c.ok === 'boolean' && typeof c.detalle === 'string'));
  ok('consolaSalud: lo que era de Google sale «no aplica en Cloudflare», en verde', checks.filter((c) => /no aplica en Cloudflare/.test(c.detalle)).length >= 8 &&
     checks.filter((c) => /no aplica en Cloudflare/.test(c.detalle)).every((c) => c.ok));
  ok('consolaSalud: tablas clave comprobadas', ['Tabla registros («Registros»)', 'Tabla cotizaciones («Cotizaciones»)', 'Tabla de permisos («_PermisosSistema»)']
    .every((n) => (checks.find((c) => c.nombre === n) || {}).ok === true), checks.filter((c) => /Tabla/.test(c.nombre)).map((c) => [c.nombre, c.ok]));

  /* ═══ D · CICLO DE UN MIEMBRO ═══════════════════════════════════════════════════════════ */
  seccion('D · Ciclo de un miembro');
  const ajustes0 = await rpc(llM, 'consolaAjustes', [M]);
  const dom0 = ajustes0.ajustes.find((a) => a.clave === 'CUENTAS_DOMINIO');
  limpiar.ajustes.CUENTAS_DOMINIO = dom0.enPropiedades ? dom0.valor : 'liverpool.com.mx';
  const dom = await rpc(llM, 'consolaGuardarAjuste', [M, 'CUENTAS_DOMINIO', 'ventel.example']);
  ok('dominio de altas → ventel.example (para no tocar direcciones reales)', dom.success, dom);

  const ajeno = await rpc(llS, 'consolaAltaMiembro', [S, { nombre: 'X', email: 'x@otro-dominio.com.mx' }]);
  ok('alta con dominio no permitido: rechazada', negado(ajeno) && /Solo se pueden dar de alta/.test(ajeno.message), ajeno);
  const alta = await rpc(llS, 'consolaAltaMiembro', [S, { nombre: 'Prueba Consola', email: NUEVO, rol: 'normal', mas: ['supervision'], menos: ['promociones'], avisar: true }]);
  limpiar.miembro = !!alta.success;
  ok('alta por la supervisora: success, aviso y lista de vuelta', alta.success && typeof alta.avisoEnviado === 'boolean' && Array.isArray(alta.miembros) && alta.resumen, alta);
  const nuevoEnLista = (alta.miembros || []).find((m) => m.email === NUEVO);
  ok('alta: rol asesor con su excepción guardada en el mismo paso', nuevoEnLista && nuevoEnLista.rol === 'normal' &&
     JSON.stringify(nuevoEnLista.ajustes) === JSON.stringify({ mas: ['supervision'], menos: ['promociones'] }), nuevoEnLista);
  // A una dirección de ejemplo el correo nunca sale: la contraseña temporal se enseña (caso «el correo no salió»).
  ok('alta: el correo a una dirección de ejemplo no sale y la temporal se devuelve', alta.avisoEnviado === false && /^[A-Z]{3}-\d{4}-[A-Z]{3}$/.test(alta.passwordTemporal), alta);
  const repetida = await rpc(llS, 'consolaAltaMiembro', [S, { nombre: 'Otra', email: NUEVO }]);
  ok('alta repetida: rechazada', negado(repetida) && /ya está dado de alta/.test(repetida.message), repetida);
  const login = await rpc('', 'loginUser', [NUEVO, alta.passwordTemporal]);
  ok('con la temporal se entra y se pide elegir contraseña', login.success === true && login.debeCambiarPassword === true, login);

  const rol = await rpc(llS, 'consolaGuardarMiembro', [S, { email: NUEVO, rol: 'avanzado', mas: [], menos: [] }]);
  ok('subir a supervisor (su mismo nivel)', rol.success && (rol.miembros.find((m) => m.email === NUEVO) || {}).rol === 'avanzado', rol.message);
  const igual = await rpc(llS, 'consolaGuardarMiembro', [S, { email: NUEVO, rol: 'avanzado' }]);
  ok('guardar lo mismo: sinCambios', igual.success && igual.sinCambios === true, igual);
  const baja = await rpc(llS, 'consolaGuardarMiembro', [S, { email: NUEVO, activo: false }]);
  ok('dar de baja', baja.success && (baja.miembros.find((m) => m.email === NUEVO) || {}).activo === false, baja.message);
  const reac = await rpc(llS, 'consolaGuardarMiembro', [S, { email: NUEVO, activo: true }]);
  ok('reactivar', reac.success && (reac.miembros.find((m) => m.email === NUEVO) || {}).activo === true, reac.message);
  const reset = await rpc(llS, 'consolaResetPassword', [S, NUEVO]);
  ok('restablecer contraseña: success y temporal nueva (el correo de ejemplo no sale)', reset.success && reset.avisoEnviado === false &&
     /^[A-Z]{3}-\d{4}-[A-Z]{3}$/.test(reset.passwordTemporal) && reset.passwordTemporal !== alta.passwordTemporal, reset);
  const borra = await rpc(llS, 'consolaEliminarMiembro', [S, NUEVO, NUEVO.toUpperCase()]);
  limpiar.miembro = !borra.success;
  ok('borrar (la confirmación no distingue mayúsculas)', borra.success && !(borra.miembros || []).some((m) => m.email === NUEVO), borra.message);

  const bit = await rpc(llM, 'consolaBitacora', [M, 150]);
  const deNuevo = bit.bitacora.filter((b) => b.objetivo === NUEVO).map((b) => b.accion);
  ok('bitácora: los textos del original para todo el ciclo', ['Persona dada de alta', 'Rol o accesos modificados', 'Contraseña restablecida', 'Persona BORRADA']
    .every((t) => deNuevo.includes(t)), deNuevo);
  ok('bitácora: fecha ISO, quien, accion, objetivo, detalle', bit.bitacora.every((b) => /^\d{4}-\d\d-\d\dT/.test(b.fecha) && 'quien' in b && 'detalle' in b));
  const rango = await rpc(llS, 'consolaBitacoraRango', [S, diaMx(-1), diaMx(0)]);
  ok('bitácora por fechas (supervisora): forma y día completo en hora de México', rango.success && Array.isArray(rango.bitacora) &&
     typeof rango.truncado === 'boolean' && typeof rango.leidas === 'number' && /T0[56]:00:00\.000Z$/.test(rango.desde), rango.desde);
  ok('bitácora de la supervisora: sin los cambios de ajustes del maestro', !rango.bitacora.some((b) => b.accion === 'Ajuste cambiado'));
  const invertido = await rpc(llM, 'consolaBitacoraRango', [M, diaMx(0), diaMx(-3)]);
  ok('rango invertido: mensaje del original', negado(invertido) && /posterior/.test(invertido.message), invertido);

  /* ═══ E · AJUSTES, MÓDULOS Y FORMATOS ═══════════════════════════════════════════════════ */
  seccion('E · Ajustes, módulos y formatos');
  for (const [clave, valor, rx] of [
    ['WEBHOOK_URL', 'https://evil.example/x', /solo puede apuntar/], ['WEBHOOK_URL', 'https://chat.googleapis.com@evil.example/', /URL completa/],
    ['HASH_SALT', 'x', /no se puede cambiar/], ['AUTH_MODO', 'raro', /opción válida/], ['CORREO_CCO_GLOBAL', 'a@b.com, mal', /no parece un correo/],
    ['PORTAL_SHEET_ID', 'corto', /identificador de hoja/], ['BREVO_REMITENTE', 'otro@gmail.com', /logidma\.com/], ['NO_EXISTE', 'x', /no existe/]
  ]) {
    const r = await rpc(llM, 'consolaGuardarAjuste', [M, clave, valor]);
    ok('ajuste ' + clave + ' = ' + JSON.stringify(valor) + ' → rechazado', negado(r) && rx.test(r.message), r);
  }
  const cal0 = ajustes0.ajustes.find((a) => a.clave === 'PORTAL_CALENDAR_ID');
  limpiar.ajustes.PORTAL_CALENDAR_ID = cal0.enPropiedades ? cal0.valor : '';
  const cal = await rpc(llM, 'consolaGuardarAjuste', [M, 'PORTAL_CALENDAR_ID', 'calendario@ejemplo.com']);
  ok('ajuste sin efecto en Cloudflare: se guarda y lo avisa', cal.success && /no se usa/.test(cal.aviso) && Array.isArray(cal.ajustes), cal);

  const off = await rpc(llM, 'consolaGuardarModulo', [M, 'promociones', true]);
  limpiar.modulo = !!off.success;
  ok('apagar «Monitor de promociones»: apagados, catálogo y miembros recalculados', off.success && off.apagados.includes('promociones') &&
     off.catalogo.apagados.includes('promociones') && !(off.miembros.find((m) => m.email === A) || { bloques: ['promociones'] }).bloques.includes('promociones'), off.message);
  const permisoAsesor = await rpc(llA, 'obtenerPermisosSesion', []);
  ok('el asesor ya no tiene el bloque apagado', permisoAsesor.success && !permisoAsesor.bloques.includes('promociones'));
  const on = await rpc(llM, 'consolaGuardarModulo', [M, 'promociones', false]);
  limpiar.modulo = !on.success;
  ok('encenderlo de nuevo', on.success && !on.apagados.includes('promociones'), on.message);
  const fijo = await rpc(llM, 'consolaGuardarModulo', [M, 'portal', true]);
  ok('un bloque fijo no se apaga', negado(fijo) && /no se puede apagar/.test(fijo.message), fijo);

  const f0 = (pM.formatos.find((f) => f.id === 'actual') || {}).enabled;
  if (f0 === true) {
    const fOff = await rpc(llM, 'consolaGuardarFormato', [M, 'actual', false]);
    limpiar.formato = !!fOff.success;
    ok('deshabilitar el formato «actual»', fOff.success && (fOff.formatos.find((f) => f.id === 'actual') || {}).enabled === false, fOff);
    const fOn = await rpc(llM, 'consolaGuardarFormato', [M, 'actual', true]);
    limpiar.formato = !fOn.success;
    ok('volver a habilitarlo', fOn.success && (fOn.formatos.find((f) => f.id === 'actual') || {}).enabled === true, fOn);
  }

  /* ═══ F · GRUPOS Y DIFUSIÓN ═════════════════════════════════════════════════════════════ */
  seccion('F · Grupos y difusión');
  const lista0 = await rpc(llS, 'grpListar', [S]);
  const ventel = lista0.grupos[0];
  ok('el primero es «Ventel», virtual, solo con gente activa', lista0.success && ventel.id === 'ventel' && ventel.virtual === true &&
     !ventel.miembros.some((p) => p.email === 'paola.jimenez@ventel.example') && ventel.total === ventel.alcanzables, ventel && { total: ventel.total, alcanzables: ventel.alcanzables });
  ok('un grupo no enseña rol, nivel ni bloques de nadie', !JSON.stringify(lista0).match(/"(rol|nivel|bloques)"/));
  const nombreG = 'Prueba consola ' + SUFIJO;
  const g = await rpc(llS, 'grpGuardar', [S, { nombre: nombreG, detalle: 'De la prueba automática' }]);
  limpiar.grupo = g.id || '';
  ok('crear grupo: success, id y la lista de vuelta', g.success && /^grp-/.test(g.id) && g.grupos.some((x) => x.id === g.id), g.message);
  const choque = await rpc(llS, 'grpGuardar', [S, { nombre: nombreG.toUpperCase() }]);
  ok('nombre repetido (sin distinguir mayúsculas): rechazado', negado(choque) && /Ya hay un grupo/.test(choque.message), choque);
  const fij = await rpc(llS, 'grpFijarMiembros', [S, g.id, [A, 'SOFIA.HERRERA@ventel.example', M, 'nadie.' + SUFIJO + '@ventel.example'], []]);
  const gFij = (fij.grupos || []).find((x) => x.id === g.id) || { miembros: [] };
  ok('fijar miembros: los de alta entran, el maestro queda vetado, el inexistente fuera', fij.success &&
     JSON.stringify(gFij.miembros.map((p) => p.email)) === JSON.stringify([A, 'sofia.herrera@ventel.example']) &&
     /no están dados de alta/.test(fij.aviso) && /por encima de tu nivel/.test(fij.aviso), fij);
  const masM = await rpc(llM, 'grpFijarMiembros', [M, g.id, [A, 'sofia.herrera@ventel.example', M], [A, 'sofia.herrera@ventel.example']]);
  ok('el maestro sí puede añadir a un maestro', masM.success && ((masM.grupos || []).find((x) => x.id === g.id) || { miembros: [] }).miembros.some((p) => p.email === M), masM.message);
  const viejaBase = await rpc(llS, 'grpFijarMiembros', [S, g.id, [A], [A, 'sofia.herrera@ventel.example']]);
  const gBase = ((viejaBase.grupos || []).find((x) => x.id === g.id) || { miembros: [] }).miembros.map((p) => p.email);
  ok('fusión con `base`: quitar a una persona no expulsa a quien añadió otro', viejaBase.success &&
     JSON.stringify(gBase) === JSON.stringify([A, M]), gBase);
  const virtual = await rpc(llS, 'grpFijarMiembros', [S, 'ventel', []]);
  ok('«Ventel» no se edita', negado(virtual), virtual);

  const payload = {
    grupoId: g.id, asunto: 'Prueba <b>automática</b> ' + SUFIJO,
    bloques: [
      { tipo: 'titulo', texto: 'Orden del día' },
      { tipo: 'parrafo', partes: [{ t: 'Hola ' }, { t: 'equipo', negrita: true }, { t: ' <script>alert(1)</script>' }, { t: 'enlace', url: 'https://ventel.logidma.com/' }] },
      { tipo: 'boton', texto: 'Malo', url: 'http://inseguro.example' },
      { tipo: 'imagen', base64: PNG_1PX, mime: 'image/png', nombre: 'grafica', pie: 'Pie' },
      { tipo: 'html', contenido: '<iframe>' }
    ]
  };
  const prep = await rpc(llS, 'difPreparar', [S]);
  ok('difPreparar: grupos, cuota, remitente y topes', prep.success && prep.grupos.length >= 2 && typeof prep.cuota === 'number' &&
     typeof prep.remitente === 'string' && prep.topes && prep.topes.destinatarios === 800, prep);
  const previa = await rpc(llS, 'difPrevia', [S, payload]);
  ok('difPrevia: HTML armado en el servidor, con el texto escapado', previa.success && previa.html.includes('&lt;script&gt;') &&
     !previa.html.includes('<script>') && !previa.html.includes('inseguro.example') && previa.descartados === 2 && previa.imagenes === 1 &&
     previa.destinatarios === 2, { ...previa, html: (previa.html || '').length });
  const prueba = await rpc(llS, 'difEnviar', [S, { ...payload, prueba: true }]);
  ok('difEnviar de prueba: solo a quien la escribe', prueba.success && prueba.destinatarios === 0 && /Prueba enviada/.test(prueba.message), prueba);
  const real = await rpc(llS, 'difEnviar', [S, payload]);
  ok('difEnviar al grupo: destinatarios en CCO y bloques descartados contados', real.success && real.destinatarios === 2 && real.descartados === 2, real);
  const vacio = await rpc(llS, 'difEnviar', [S, { grupoId: g.id, asunto: 'x', bloques: [{ tipo: 'boton', url: 'javascript:alert(1)' }] }]);
  ok('un comunicado sin bloques válidos no sale', negado(vacio) && /vacío/.test(vacio.message), vacio);

  const borraG = await rpc(llS, 'grpEliminar', [S, g.id]);
  if (borraG.success) limpiar.grupo = '';
  ok('borrar el grupo', borraG.success && !borraG.grupos.some((x) => x.id === g.id), borraG.message);
  const bitG = (await rpc(llM, 'consolaBitacora', [M, 150])).bitacora.map((b) => b.accion);
  ok('bitácora de grupos y difusión con los textos del original', ['Grupo creado', 'Miembros de grupo', 'Grupo borrado', 'Difusión de prueba', 'Difusión enviada']
    .every((t) => bitG.includes(t)), bitG.slice(0, 12));

  /* ═══ G · MONITOREO ═════════════════════════════════════════════════════════════════════ */
  seccion('G · Monitoreo y registro de búsquedas');
  const monM = await rpc(llM, 'monPanorama', [M]);
  ok('monPanorama maestro: alcance del sistema, personas, tipos y rango', monM.success && monM.alcance === 'sistema' && monM.personas.length > 0 &&
     monM.tiposCorreo.includes('Difusión') && /^\d{4}-\d\d-\d\d$/.test(monM.rangoPorDefecto.desde) && monM.rangoPorDefecto.hasta === diaMx(0), monM.rangoPorDefecto);
  const monS = await rpc(llS, 'monPanorama', [S]);
  ok('monPanorama supervisora: alcance jerárquico, sin el maestro', monS.success && monS.alcance === 'jerarquia' && !monS.personas.some((p) => p.email === M));

  // El buscador de cotizaciones apunta lo que se teclea (monRegistrarBusqueda); los prefijos afinan UNA fila.
  const termino = 'zqk' + SUFIJO.slice(-4);
  await rpc(llA, 'getQuotesForUser', [A, termino.slice(0, 3)]);
  await rpc(llA, 'getQuotesForUser', [A, termino]);
  await rpc(llM, 'getQuotesForUser', [M, 'maestro-' + termino]);
  let busq = null;
  for (let i = 0; i < 10; i++) {
    busq = await rpc(llM, 'monBusquedas', [M, { texto: termino }]);
    if (busq.success && busq.filas.length >= 2) break;
    await esperar(400);
  }
  const delAsesor = (busq.filas || []).filter((f) => f.quien === A);
  ok('búsquedas: una sola fila por lo que el asesor tecleó, con el término largo', delAsesor.length === 1 && delAsesor[0].termino === termino, busq.filas);
  ok('búsquedas: forma común de las consultas', busq.success && ['filas', 'total', 'truncado', 'leidas', 'desde', 'hasta', 'porDefecto', 'completado', 'candidatas', 'top']
    .every((k) => k in busq), Object.keys(busq));
  const busqS = await rpc(llS, 'monBusquedas', [S, { texto: termino }]);
  ok('la supervisora no ve lo que buscó el maestro', busqS.success && busqS.filas.length >= 1 && !busqS.filas.some((f) => f.quien === M), busqS.filas);
  const sinSesionBusq = await rpc('', 'getQuotesForUser', [A, 'anonimo-' + termino]).catch(() => null);
  await esperar(500);
  const anon = await rpc(llM, 'monBusquedas', [M, { texto: 'anonimo-' + termino }]);
  ok('sin sesión no se apunta ninguna búsqueda', anon.success && anon.filas.length === 0, sinSesionBusq && anon.filas);

  const correos = await rpc(llM, 'monCorreos', [M, { tipo: 'Difusión' }]);
  ok('monCorreos: las difusiones de la prueba, con errores y enviados contados', correos.success && correos.filas.some((f) => f.asunto.includes(SUFIJO)) &&
     typeof correos.errores === 'number' && typeof correos.enviados === 'number', correos.filas && correos.filas.slice(0, 2));
  const cot = await rpc(llS, 'monCotizaciones', [S, { desde: diaMx(-30) }]);
  ok('monCotizaciones: total en dinero y «hasta hoy» completado', cot.success && typeof cot.total === 'number' && cot.completado === 'hasta hoy', { ...cot, filas: (cot.filas || []).length });
  const cambios = await rpc(llS, 'monCambios', [S, { texto: nombreG }]);
  ok('monCambios: los cambios de la supervisora sobre el grupo', cambios.success && cambios.filas.length >= 2, cambios.filas && cambios.filas.length);
  const horas = await rpc(llM, 'monCorreos', [M, { desde: diaMx(0), hasta: diaMx(0), horaDesde: '18:00', horaHasta: '09:00' }]);
  ok('horas invertidas: mensaje del original', negado(horas) && /hora de inicio/.test(horas.message), horas);

  /* ═══ H · CORREO A CLIENTES Y ARTÍCULOS ═════════════════════════════════════════════════ */
  seccion('H · Correo a clientes y artículos');
  const cc = await rpc(llA, 'enviarCorreoPlantilla', [{
    plantilla: 'ticket', to: ['cliente.' + SUFIJO + '@ejemplo.com'], cc: 'copia@ejemplo.com', asunto: 'Tu ticket ' + SUFIJO,
    asuntoPlantilla: 'Tu ticket', htmlBody: '<p>Hola</p>', adjuntos: [{ nombre: 'ticket.png', mime: 'image/png', base64: PNG_1PX }], asesor: A
  }]);
  ok('enviarCorreoPlantilla: status ok y remitente', cc.status === 'ok' && /@/.test(cc.sentFrom), cc);
  const ccCot = await rpc(llA, 'enviarCorreoPlantilla', [{ plantilla: 'cotizacion', to: 'x@ejemplo.com', asunto: 'x', htmlBody: '<p>x</p>', asesor: A }]);
  ok('la plantilla de cotización no se acepta aquí (mensaje del original)', ccCot.status === 'error' && /Las cotizaciones se envían desde/.test(ccCot.error), ccCot);
  const ccMal = await rpc(llA, 'enviarCorreoPlantilla', [{ plantilla: 'ticket', to: 'a@ejemplo.com,b@ejemplo.com,c@ejemplo.com,d@ejemplo.com', asunto: 'x', htmlBody: '<p>x</p>', asesor: A }]);
  ok('máximo tres destinatarios en Para', ccMal.status === 'error' && /Máximo 3/.test(ccMal.error), ccMal);
  const metPl = await rpc(llM, 'monCorreos', [M, { tipo: 'Plantilla cliente', texto: SUFIJO }]);
  ok('la métrica del envío dice que el asunto se modificó', metPl.success && metPl.filas.some((f) => f.plantillaModificada === 'Sí'), metPl.filas);

  const art = await rpc(llS, 'artGuardar', [{
    titulo: 'Artículo de prueba ' + SUFIJO, resumen: 'Resumen', estado: 'borrador', asesor: S,
    contenido: { v: 1, bloques: [{ tipo: 'titulo', texto: 'Título' }, { tipo: 'texto', partes: [{ t: 'Hola ' }, { t: 'malo', url: 'javascript:alert(1)' }] },
      { tipo: 'imagen', url: 'http://inseguro.example/x.png' }, { tipo: 'html', x: 1 }, { tipo: 'separador' }] }
  }]);
  limpiar.articulo = art.id || '';
  ok('artGuardar: id, estado y bloques saneados', art.status === 'ok' && /^art-/.test(art.id) && art.estado === 'borrador' && art.bloques === 3, art);
  const listaA = await rpc(llA, 'artListar', [A, {}]);
  ok('el asesor no ve el borrador', listaA.status === 'ok' && !listaA.articulos.some((x) => x.id === art.id) && listaA.puedeEditar === false);
  const obtA = await rpc(llA, 'artObtener', [art.id, A]);
  ok('ni lo abre por su id', obtA.status === 'error' && /borrador/.test(obtA.error), obtA);
  const pub = await rpc(llS, 'artPublicar', [art.id, true, S]);
  ok('artPublicar', pub.status === 'ok' && pub.estado === 'publicado', pub);
  const obt = await rpc(llA, 'artObtener', [art.id, A]);
  ok('artObtener (asesor): contenido sin el enlace javascript:', obt.status === 'ok' && obt.articulo.contenido.v === 1 &&
     !JSON.stringify(obt.articulo.contenido).includes('javascript') && obt.articulo.autores === 'Laura Domínguez' && /^\d{4}-\d\d-\d\d$/.test(obt.articulo.creado), obt.articulo);
  const lect = await rpc(llS, 'artLectores', [art.id, S]);
  ok('artLectores: el asesor aparece como lector', lect.status === 'ok' && lect.lectores.some((l) => l.correo === A && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(l.primera)), lect);
  const idx = await rpc(llA, 'artIndiceBuscador', [A]);
  ok('artIndiceBuscador: el publicado aparece con su texto', idx.status === 'ok' && idx.articulos.some((x) => x.id === art.id && x.texto.includes('Hola')), idx.articulos.length);
  const img = await rpc(llS, 'artSubirImagen', [{ dataUrl: 'data:image/png;base64,' + PNG_1PX, nombre: 'prueba.png', asesor: S }]);
  ok('artSubirImagen: URL de /archivos/ servida desde R2', img.status === 'ok' && /\/archivos\/subidas\/articulos\//.test(img.url), img);
  if (img.url) {
    const r = await fetch(BASE + img.url.replace(/^https?:\/\/[^/]+/, ''));
    ok('la imagen se sirve como image/png', r.ok && /image\/png/.test(r.headers.get('content-type') || ''), r.status);
  }
  const svg = await rpc(llS, 'artSubirImagen', [{ dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', asesor: S }]);
  ok('un SVG no se sube (se serviría desde el mismo origen)', svg.status === 'error', svg);
  const del = await rpc(llS, 'artEliminar', [art.id, S]);
  if (del.status === 'ok') limpiar.articulo = '';
  ok('artEliminar', del.status === 'ok', del);
}

async function deshacer() {
  try {
    if (limpiar.miembro) await rpc(llM, 'consolaEliminarMiembro', [M, NUEVO, NUEVO]);
    if (limpiar.grupo) await rpc(llM, 'grpEliminar', [M, limpiar.grupo]);
    if (limpiar.articulo) await rpc(llM, 'artEliminar', [limpiar.articulo, M]);
    if (limpiar.modulo) await rpc(llM, 'consolaGuardarModulo', [M, 'promociones', false]);
    if (limpiar.formato) await rpc(llM, 'consolaGuardarFormato', [M, 'actual', true]);
    for (const [clave, valor] of Object.entries(limpiar.ajustes)) await rpc(llM, 'consolaGuardarAjuste', [M, clave, valor]);
  } catch (e) {
    console.log('  (no se pudo deshacer todo: ' + e.message + ')');
  }
}

try {
  await principal();
} catch (e) {
  fallos++;
  console.log('\n✖ La prueba se detuvo: ' + (e && e.stack || e));
} finally {
  if (llM) await deshacer();
}
console.log('\n' + (total - fallos) + '/' + total + ' comprobaciones correctas' + (fallos ? ' · ' + fallos + ' fallo(s)' : ''));
process.exit(fallos ? 1 : 0);
