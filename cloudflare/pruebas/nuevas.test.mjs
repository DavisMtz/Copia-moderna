/*
 * Prueba del explorador de datos (modulos/nuevas.ts): puertas, secretos y la consola de SOLO LECTURA.
 *   node pruebas/nuevas.test.mjs [baseUrl]          (por omisión http://127.0.0.1:8807)
 * Necesita un Worker local levantado (scripts/dev-aislado.sh react 8807) con las cuentas de la semilla.
 * Node puro, sin frameworks. Sale con código 1 si algo falla.
 */
const BASE = (process.argv[2] || process.env.BASE || 'http://127.0.0.1:8807').replace(/\/$/, '');
const CLAVE = 'VentelDemo2026';
// El hash de VentelDemo2026 en la semilla (semilla/00_usuarios_demo.sql): nunca debe salir.
const HASH_SEMILLA = 'f9349a18d1a94e8861fd6ca1093b45e67f90f48aeeb4ee5760a1b960ec971faa';

let fallos = 0, pasadas = 0, saltadas = 0;
function ok(cond, nombre, detalle) {
  if (cond) { pasadas++; console.log('  ✔ ' + nombre); }
  else { fallos++; console.log('  ✖ ' + nombre + (detalle ? '\n      ' + String(detalle).slice(0, 400) : '')); }
}
function saltar(nombre, porque) { saltadas++; console.log('  · ' + nombre + ' (saltada: ' + porque + ')'); }

async function rpc(cuerpo) {
  const r = await fetch(BASE + '/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  return r.json();
}
async function entrar(correo) {
  const j = await rpc({ fn: 'secEjecutar', args: ['', 'loginUser', [correo, CLAVE], 0] });
  if (!j.ok || !j.v || !j.v.success || !j.v.llave) throw new Error('No pude entrar como ' + correo + ': ' + JSON.stringify(j).slice(0, 200));
  return j.v.llave;
}
/** Lo que vería la pantalla: la respuesta de la función (o lanza con el mensaje del servidor). */
async function llamar(llave, fn, args) {
  const j = await rpc({ fn: 'secEjecutar', args: [llave, fn, args, Date.now()] });
  if (!j.ok) throw new Error(j.e);
  return j.v;
}

try {
  const salud = await fetch(BASE + '/api/salud').then((r) => r.json());
  if (!salud.ok) throw new Error('el Worker contesta, pero D1 no');
} catch (e) {
  console.error('✖ No hay Worker en ' + BASE + ' (' + e.message + '). Levántalo con scripts/dev-aislado.sh react 8807.');
  process.exit(1);
}

console.log('\nPuertas');
{
  const sin = await llamar('', 'datosTablas', []);
  ok(sin && sin.success === false && sin.codigo === 'SIN_SESION', 'sin sesión: datosTablas no da datos', JSON.stringify(sin));
  const directa = await rpc({ fn: 'datosConsulta', args: ['', 'SELECT 1'] });
  ok(directa.ok && directa.v.success === false && directa.v.codigo === 'SIN_SESION', 'llamada directa (sin secEjecutar): tampoco', JSON.stringify(directa));
  const vencida = await rpc({ fn: 'secEjecutar', args: ['vs1.' + '0'.repeat(64), 'datosTablas', [], Date.now()] });
  ok(!vencida.ok && /^SESION_EXPIRADA/.test(vencida.e), 'llave inventada: SESION_EXPIRADA', JSON.stringify(vencida));
}

const llaveAsesor = await entrar('asesor@ventel.example');
const llaveSuper = await entrar('supervisora@ventel.example');
const llaveMaestro = await entrar('maestro@ventel.example');

for (const [quien, llave, correo] of [['asesor', llaveAsesor, 'asesor@ventel.example'], ['supervisora', llaveSuper, 'supervisora@ventel.example']]) {
  for (const [fn, args] of [['datosTablas', [correo]], ['datosFilas', [correo, 'registros', {}]], ['datosFila', [correo, 'registros', 1]],
    ['datosConsulta', [correo, 'SELECT 1']], ['datosCorreos', [correo, {}]], ['datosCorreo', [correo, 1]]]) {
    const r = await llamar(llave, fn, args);
    ok(r && r.success === false && r.codigo === 'SIN_PERMISO', quien + ': ' + fn + ' → SIN_PERMISO', JSON.stringify(r));
  }
}
{
  const r = await llamar(llaveMaestro, 'datosTablas', ['asesor@ventel.example']);
  ok(r.success === false, 'maestro declarando el correo de otra persona: no', JSON.stringify(r));
}

console.log('\nTablas y secretos');
const M = 'maestro@ventel.example';
const tablas = await llamar(llaveMaestro, 'datosTablas', [M]);
ok(tablas.success === true && Array.isArray(tablas.tablas), 'maestro: datosTablas responde', JSON.stringify(tablas).slice(0, 300));
const nombres = (tablas.tablas || []).map((t) => t.nombre);
ok(['registros', 'cotizaciones', 'correos_salida', 'propiedades'].every((n) => nombres.includes(n)), 'están las tablas del esquema');
ok(!nombres.some((n) => /^(_cf_|d1_|sqlite_)/i.test(n)), 'sin tablas internas (_cf_*, d1_*, sqlite_*)', nombres.join(','));
ok(tablas.d1 && typeof tablas.d1.ms === 'number' && tablas.d1.consultas >= 1, 'dice lo que tardó D1', JSON.stringify(tablas.d1));
const reg = (tablas.tablas || []).find((t) => t.nombre === 'registros');
ok(reg && reg.columnas.find((c) => c.nombre === 'password_hash').oculta === 'siempre', 'registros.password_hash va marcada como oculta');
ok(reg && reg.columnas.find((c) => c.nombre === 'password_temporal').oculta === '', 'registros.password_temporal (un Sí/No) sí se ve');
const ses = (tablas.tablas || []).find((t) => t.nombre === 'sesiones');
ok(ses && ses.columnas.find((c) => c.nombre === 'huella').oculta === 'siempre', 'sesiones.huella va marcada como oculta');

const filasReg = await llamar(llaveMaestro, 'datosFilas', [M, 'registros', { porPagina: 200 }]);
const iHash = (filasReg.columnas || []).findIndex((c) => c.nombre === 'password_hash');
ok(filasReg.success === true && filasReg.filas.length > 0, 'datosFilas(registros) trae filas', JSON.stringify(filasReg).slice(0, 300));
ok(filasReg.filas.every((f) => f.celdas[iHash] && f.celdas[iHash].$oculto === true), 'password_hash sale como { $oculto } en todas las filas');
ok(!JSON.stringify(filasReg).includes(HASH_SEMILLA.slice(0, 16)), 'el hash no viaja en la respuesta');
const oraculo = await llamar(llaveMaestro, 'datosFilas', [M, 'registros', { filtro: HASH_SEMILLA.slice(0, 10) }]);
ok(oraculo.success === true && oraculo.total === 0, 'filtrar por un trozo del hash no encuentra nada (no hay oráculo)', JSON.stringify(oraculo).slice(0, 200));
const porHash = await llamar(llaveMaestro, 'datosFilas', [M, 'registros', { orden: 'password_hash' }]);
ok(porHash.success === true && porHash.orden === '', 'no se puede ordenar por el hash', porHash.orden);
const pag = await llamar(llaveMaestro, 'datosFilas', [M, 'registros', { porPagina: 3, pagina: 2, orden: 'email', dir: 'desc' }]);
ok(pag.success && pag.filas.length <= 3 && pag.pagina === 2 && pag.total === filasReg.total, 'pagina con orden y dirección', JSON.stringify({ n: pag.filas && pag.filas.length, total: pag.total }));
const filtroOk = await llamar(llaveMaestro, 'datosFilas', [M, 'registros', { filtro: 'maestro@' }]);
ok(filtroOk.success && filtroOk.total === 1, 'el filtro de texto busca en lo visible', JSON.stringify({ total: filtroOk.total }));
const inyeccion = await llamar(llaveMaestro, 'datosFilas', [M, 'registros; DROP TABLE registros', {}]);
ok(inyeccion.success === false && inyeccion.codigo === 'NO_VALIDO', 'una tabla que no existe se rechaza (nada se interpola)', JSON.stringify(inyeccion));
if (filasReg.filas[0] && filasReg.filas[0].rowid != null) {
  const una = await llamar(llaveMaestro, 'datosFila', [M, 'registros', filasReg.filas[0].rowid]);
  const campo = (una.campos || []).find((c) => c.nombre === 'password_hash');
  ok(una.success && campo && campo.valor && campo.valor.$oculto === true, 'datosFila: el hash también sale oculto', JSON.stringify(una).slice(0, 300));
}
const props = await llamar(llaveMaestro, 'datosFilas', [M, 'propiedades', { porPagina: 200 }]);
const secretas = (props.filas || []).filter((f) => /hash|salt|webhook|token|clave|^cta_|^ses_/i.test(String(f.celdas[0])));
if (secretas.length) {
  ok(secretas.every((f) => f.celdas[1] && f.celdas[1].$oculto === true), 'propiedades: el valor de las claves secretas sale oculto (' + secretas.length + ')');
  ok(!JSON.stringify(props).includes('vPe/O5s2aG'), 'la sal de las contraseñas no viaja');
} else saltar('propiedades secretas ocultas', 'la base local no tiene ninguna (HASH_SALT, webhooks…)');

console.log('\nConsola de solo lectura');
const contar = async () => (await llamar(llaveMaestro, 'datosConsulta', [M, 'SELECT COUNT(*) AS n FROM registros'])).filas[0][0];
const antes = await contar();
const uno = await llamar(llaveMaestro, 'datosConsulta', [M, 'SELECT 1 AS uno, \'a;b\' AS texto;']);
ok(uno.success && uno.columnas.join() === 'uno,texto' && uno.filas[0][0] === 1 && uno.filas[0][1] === 'a;b', 'SELECT con «;» final y «;» dentro de un texto', JSON.stringify(uno));
const cte = await llamar(llaveMaestro, 'datosConsulta', [M, 'WITH x(n) AS (SELECT 2) SELECT n * 3 AS seis FROM x']);
ok(cte.success && cte.filas[0][0] === 6, 'WITH … SELECT, con una multiplicación', JSON.stringify(cte));
const conteo = await llamar(llaveMaestro, 'datosConsulta', [M, 'SELECT estatus, COUNT(*) AS n FROM cotizaciones GROUP BY estatus -- comentario al final']);
ok(conteo.success === true, 'COUNT(*) y un comentario al final', JSON.stringify(conteo).slice(0, 200));
const muchas = await llamar(llaveMaestro, 'datosConsulta', [M, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT x FROM c']);
ok(muchas.success && muchas.filas.length === muchas.limite && muchas.truncado === true, 'LIMIT forzado: una consulta sin fin se corta en ' + muchas.limite, JSON.stringify({ n: muchas.filas && muchas.filas.length, t: muchas.truncado }));
ok(muchas.d1 && typeof muchas.d1.ms === 'number', 'la consola dice lo que tardó D1', JSON.stringify(muchas.d1));

const rechazos = [
  ['DELETE FROM registros', /solo lectura|SELECT o WITH/],
  ['UPDATE registros SET nombre = \'x\'', /solo lectura|SELECT o WITH/],
  ['delete from registros', /SELECT o WITH/],
  ['SELECT 1; DELETE FROM registros', /«;»/],
  ['SELECT 1; SELECT 2', /«;»/],
  ['WITH x AS (SELECT 1) DELETE FROM registros', /DELETE/],
  ['WITH x AS (SELECT 1) INSERT INTO cache (clave, valor, expira) SELECT \'a\', \'b\', 1', /INSERT/],
  ['SELECT * FROM registros', /«\*»/],
  ['SELECT r.* FROM registros r', /«\*»/],
  ['SELECT * FROM \'registros\'', /«\*»/],
  ['SELECT password_hash FROM registros', /secreto|password_hash/],
  ['SELECT "password_hash" AS x FROM registros', /secreto|password_hash/],
  ['SELECT email FROM registros a JOIN registros b USING (\'password_hash\')', /secreto|password_hash/],
  ['WITH t(a, b, c) AS (SELECT * FROM registros) SELECT c FROM t', /«\*»/],
  ['SELECT 1, 2, 3, 4, 5, 6 UNION ALL SELECT * FROM registros', /«\*»/],
  ['SELECT huella FROM sesiones', /secreto|huella/],
  ['SELECT valor FROM propiedades', /propiedades|valor/],
  ['SELECT * FROM propiedades', /«\*»/],
  ['SELECT claves FROM portal_herramientas', /secreto|claves/],
  ['PRAGMA table_info(registros)', /SELECT o WITH|PRAGMA/],
  ['SELECT * FROM pragma_table_info(\'registros\') WHERE 0; PRAGMA writable_schema = 1', /«;»/],
  ['ATTACH DATABASE \'x.db\' AS x', /SELECT o WITH|ATTACH/],
  ['SELECT load_extension(\'x\')', /LOAD_EXTENSION/],
  ['SELECT * FROM _cf_KV', /_cf_/],
  ['SELECT * FROM registros WHERE email = ?', /parámetros/],
  ['SELECT 1 /* sin cerrar', /comentario/],
  ['SELECT \'sin cerrar', /comilla/],
  ['', /Escribe/],
];
for (const [sql, espera] of rechazos) {
  const r = await llamar(llaveMaestro, 'datosConsulta', [M, sql]);
  ok(r.success === false && espera.test(String(r.message || '')), 'rechaza: ' + (sql || '(vacía)').slice(0, 70), JSON.stringify(r));
}
const errorSql = await llamar(llaveMaestro, 'datosConsulta', [M, 'SELECT nada FROM tabla_que_no_existe']);
ok(errorSql.success === false && /tabla_que_no_existe/.test(errorSql.message), 'un error de D1 llega en español y sin tumbar nada', errorSql.message);
const replaceFn = await llamar(llaveMaestro, 'datosConsulta', [M, "SELECT replace('hola', 'o', '0') AS r"]);
ok(replaceFn.success && replaceFn.filas[0][0] === 'h0la', 'replace() como función de texto sí se permite', JSON.stringify(replaceFn));
const repetidas = await llamar(llaveMaestro, 'datosConsulta', [M, 'SELECT a.email, b.email FROM registros a JOIN permisos_sistema b ON b.email = a.email LIMIT 1']);
ok(repetidas.success && repetidas.columnas.length === 2 && repetidas.filas[0].length === 2, 'dos columnas con el mismo nombre no se pierden', JSON.stringify(repetidas).slice(0, 200));
const despues = await contar();
ok(antes === despues && antes > 0, 'registros sigue intacta (' + antes + ' filas antes y después)');

console.log('\nBandeja de salida');
const bandeja = await llamar(llaveMaestro, 'datosCorreos', [M, { porPagina: 5 }]);
ok(bandeja.success === true && Array.isArray(bandeja.correos) && typeof bandeja.total === 'number', 'datosCorreos responde', JSON.stringify(bandeja).slice(0, 300));
ok((bandeja.correos || []).every((c) => !('html' in c)), 'la lista no trae el cuerpo de los correos');
ok(Array.isArray(bandeja.estados) && (bandeja.correos || []).every((c) => typeof c.estado === 'string'),
  'cada correo dice qué pasó al mandarlo (estado: enviado / omitido / error)', JSON.stringify(bandeja.estados));
if (bandeja.correos && bandeja.correos.length) {
  const c = await llamar(llaveMaestro, 'datosCorreo', [M, bandeja.correos[0].id]);
  ok(c.success && typeof c.correo.html === 'string' && 'para' in c.correo && 'cco' in c.correo && Array.isArray(c.correo.adjuntos) &&
    typeof c.correo.estado === 'string' && typeof c.correo.proveedorId === 'string', 'datosCorreo trae el correo completo (y su envío)', JSON.stringify(c).slice(0, 300));
  const filtrada = await llamar(llaveMaestro, 'datosCorreos', [M, { filtro: bandeja.correos[0].asunto.slice(0, 12) }]);
  ok(filtrada.success && filtrada.total >= 1, 'el filtro de la bandeja encuentra por asunto');
} else saltar('datosCorreo', 'la bandeja local está vacía');
const noHay = await llamar(llaveMaestro, 'datosCorreo', [M, 999999999]);
ok(noHay.success === false && noHay.codigo === 'NO_VALIDO', 'un correo que no existe: mensaje claro', JSON.stringify(noHay));

console.log('\n' + pasadas + ' bien, ' + fallos + ' mal' + (saltadas ? ', ' + saltadas + ' saltadas' : '') + '.');
process.exit(fallos ? 1 : 0);
