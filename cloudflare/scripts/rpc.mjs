/*
 * Llama a una función del servidor como lo haría una pantalla (AppRun → secEjecutar).
 *   node scripts/rpc.mjs [--puerto 8787] [--como correo] [--clave VentelDemo2026] <funcion> '<args JSON>'
 * Ejemplos:
 *   node scripts/rpc.mjs --puerto 8802 --como asesor@ventel.example getQuotesForUser '["asesor@ventel.example"]'
 *   node scripts/rpc.mjs --puerto 8804 fetchToolsData            (sin --como: sin sesión, como el Portal público)
 * Imprime la respuesta en JSON (o el error, con código de salida 1).
 */
const a = process.argv.slice(2);
const op = { puerto: '8787', como: '', clave: 'VentelDemo2026', base: '' };
while (a[0] && a[0].startsWith('--')) { const k = a.shift().slice(2); op[k] = a.shift(); }
const [fn, argsTxt] = a;
if (!fn) { console.error('Falta la función.'); process.exit(2); }
const BASE = op.base || ('http://127.0.0.1:' + op.puerto);

async function rpc(cuerpo) {
  const r = await fetch(BASE + '/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.e);
  return j.v;
}

try {
  let llave = '';
  if (op.como) {
    const login = await rpc({ fn: 'secEjecutar', args: ['', 'loginUser', [op.como, op.clave], 0] });
    if (!login.success) throw new Error('login: ' + login.message);
    llave = login.llave;
  }
  const t0 = Date.now();
  const v = await rpc({ fn: 'secEjecutar', args: [llave, fn, argsTxt ? JSON.parse(argsTxt) : [], Date.now()] });
  console.log(JSON.stringify(v, null, 2));
  console.error('(' + (Date.now() - t0) + ' ms)');
} catch (e) {
  console.error('ERROR: ' + e.message);
  process.exit(1);
}
