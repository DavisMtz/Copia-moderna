/*
 * El correo con el registro abierto (nucleo/correo.ts), sin servidor:
 *   node pruebas/correo.test.mjs
 * Empaqueta el núcleo del correo con esbuild y lo corre sobre una D1 en memoria (node:sqlite) con las
 * migraciones reales, con un fetch simulado de Brevo: ningún correo sale a la red.
 * Comprueba que una cuenta que se registró sola (rol Asesor, fuera de los dominios de confianza) no le
 * escribe a terceros —el correo se le devuelve a ella, marcado— y que supervisores, maestros, cuentas de
 * liverpool.com.mx y cuentas de la demo envían igual que siempre; y los topes.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CF = join(fileURLToPath(new URL('.', import.meta.url)), '..');
let bien = 0, mal = 0;
function comprueba(texto, ok, detalle) {
  if (ok) { bien++; console.log('  ✔ ' + texto); return; }
  mal++; console.log('  ✘ ' + texto + (detalle === undefined ? '' : '\n      → ' + JSON.stringify(detalle).slice(0, 400)));
}

/** Una D1 de mentira con la API que usa nucleo/contexto.ts, sobre node:sqlite. */
function d1Falsa(db) {
  const preparada = (sql, params = []) => ({
    sql, params,
    bind: (...p) => preparada(sql, p),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => { const f = db.prepare(sql).get(...params); return f === undefined ? null : f; },
    run: async () => { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  });
  return {
    prepare: (sql) => preparada(sql),
    batch: async (lista) => {
      db.exec('BEGIN');
      try {
        const out = lista.map((s) => {
          const st = db.prepare(s.sql);
          if (/^\s*(select|with)\b|\breturning\b/i.test(s.sql)) return { results: st.all(...s.params), meta: { changes: 0 } };
          const r = st.run(...s.params);
          return { results: [], meta: { changes: Number(r.changes) } };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}

const { DatabaseSync } = await import('node:sqlite');
const esbuild = createRequire(join(CF, 'package.json'))('esbuild');
const dir = mkdtempSync(join(tmpdir(), 'correo-prueba-'));
let M;
try {
  const r = await esbuild.build({
    stdin: {
      contents: "export * from './src/worker/nucleo/correo.ts';\nexport { Ctx } from './src/worker/nucleo/contexto.ts';\n" +
        "export { fijarPropiedad } from './src/worker/nucleo/sistema.ts';",
      resolveDir: CF, sourcefile: 'entrada-correo.ts', loader: 'ts'
    },
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false, logLevel: 'silent'
  });
  writeFileSync(join(dir, 'correo.mjs'), r.outputFiles[0].text);
  M = await import(pathToFileURL(join(dir, 'correo.mjs')).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const db = new DatabaseSync(':memory:');
for (const f of readdirSync(join(CF, 'migrations')).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
  db.exec(readFileSync(join(CF, 'migrations', f), 'utf8'));
}
db.exec(readFileSync(join(CF, 'semilla', '00_usuarios_demo.sql'), 'utf8'));
const alta = (email, nombre, rol) => {
  db.prepare("INSERT INTO registros (email, nombre, password_hash, avanzado, password_temporal, alta) VALUES (?, ?, 'x', 0, 0, '2026-10-07T00:00:00Z')").run(email, nombre);
  if (rol) db.prepare("INSERT INTO permisos_sistema (email, rol, permisos, activo) VALUES (?, ?, '', 1)").run(email, rol);
};
alta('visitante@correo-externo.mx', 'Visitante');                 // se registró sola: rol Asesor
alta('jefa@correo-externo.mx', 'Jefa', 'avanzado');                 // promovida a supervisora
alta('persona@liverpool.com.mx', 'Persona de Liverpool');           // dominio de confianza

const env = { DB: d1Falsa(db), BREVO_API_KEY: 'xkeysib-prueba-no-real' };
const ctxDe = (email) => { const c = new M.Ctx(env, null, 'https://ventel.example'); if (email) c.sesion = { email }; return c; };
const ultimaFila = () => db.prepare('SELECT para, asunto, html, estado, detalle FROM correos_salida ORDER BY id DESC LIMIT 1').get();

// Brevo simulado: guarda cada cuerpo y contesta 201.
const enviados = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('api.brevo.com')) throw new Error('fetch inesperado: ' + url);
  enviados.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ messageId: '<prueba-' + enviados.length + '@brevo>' }), { status: 201 });
};
const correo = (extra) => Object.assign({ para: 'cliente@empresa-real.mx', asunto: 'Tu cotización LVP-1', html: '<html><body><p>Hola</p></body></html>', texto: 'Hola', tipo: 'cotizacion', referencia: 'LVP-1' }, extra);
const destinos = (b) => (b.to || []).map((x) => x.email).concat((b.cc || []).map((x) => x.email), (b.bcc || []).map((x) => x.email));

try {
  console.log('Correo con el registro abierto · nucleo/correo.ts');

  console.log('\n■ Quien puede escribirle a terceros, sin cambios');
  for (const [quien, email] of [['cuenta de la demo', 'asesor@ventel.example'], ['supervisora promovida', 'jefa@correo-externo.mx'],
    ['cuenta de liverpool.com.mx', 'persona@liverpool.com.mx'], ['maestro de la demo', 'maestro@ventel.example']]) {
    await M.enviarCorreo(ctxDe(email), correo());
    const b = enviados[enviados.length - 1];
    comprueba(quien + ': sale al cliente, con su asunto', JSON.stringify(destinos(b)) === '["cliente@empresa-real.mx"]' && b.subject === 'Tu cotización LVP-1', { to: destinos(b), subject: b.subject });
  }

  console.log('\n■ Una cuenta que se registró sola');
  let r = await M.enviarCorreo(ctxDe('visitante@correo-externo.mx'), correo({ cc: 'otra@empresa-real.mx', cco: 'copia@empresa-real.mx' }));
  let b = enviados[enviados.length - 1];
  comprueba('el correo se le devuelve a ella: un solo destinatario, sin copias', JSON.stringify(destinos(b)) === '["visitante@correo-externo.mx"]', destinos(b));
  comprueba('el asunto va marcado «[Maqueta]»', b.subject === '[Maqueta] Tu cotización LVP-1', b.subject);
  comprueba('el HTML lleva la nota con a quién iba, dentro del <body>', /<body><div[^>]*>.*Maqueta del Portal Ventel.*cliente@empresa-real\.mx, otra@empresa-real\.mx, copia@empresa-real\.mx/.test(b.htmlContent), b.htmlContent.slice(0, 300));
  comprueba('el texto plano también avisa', /^\[Maqueta: iba para cliente@empresa-real\.mx/.test(b.textContent || ''), b.textContent);
  comprueba('enviarCorreo contesta «enviado», como cualquier envío', r.ok === true && r.estado === 'enviado' && r.simulado === false, r);
  let f = ultimaFila();
  comprueba('correos_salida: el destino real y la nota en el detalle', f.para === 'visitante@correo-externo.mx' && f.estado === 'enviado' && /se le devolvió a visitante@correo-externo\.mx \(iba para cliente@empresa-real\.mx/.test(f.detalle), f);

  await M.enviarCorreo(ctxDe('visitante@correo-externo.mx'), correo({ para: 'Visitante@Correo-Externo.mx' }));
  b = enviados[enviados.length - 1];
  comprueba('a sí misma: sale normal, sin marca', JSON.stringify(destinos(b)) === '["visitante@correo-externo.mx"]' && b.subject === 'Tu cotización LVP-1', { to: destinos(b), subject: b.subject });

  await M.enviarCorreo(ctxDe('visitante@correo-externo.mx'), correo({ para: 'cliente@ejemplo.com' }));
  b = enviados[enviados.length - 1];
  comprueba('a un cliente de ejemplo: también le llega a ella (así ve el correo)', JSON.stringify(destinos(b)) === '["visitante@correo-externo.mx"]' && b.subject.startsWith('[Maqueta]'), { to: destinos(b), subject: b.subject });

  console.log('\n■ Topes de las cuentas del registro abierto');
  // Ya lleva 3 envíos hoy; el tope por cuenta es 15.
  let errores = 0, ultimoError = '';
  for (let i = 0; i < 13; i++) {
    try { await M.enviarCorreo(ctxDe('visitante@correo-externo.mx'), correo()); } catch (e) { errores++; ultimoError = e.message; }
  }
  comprueba('hasta 15 al día por cuenta; el 16.º se rechaza con su motivo', errores === 1 && /tope de 15 correos al día/.test(ultimoError), { errores, ultimoError });
  f = ultimaFila();
  comprueba('el rechazado queda en correos_salida como «omitido», con el motivo', f.estado === 'omitido' && /tope de 15/.test(f.detalle), f);
  const antes = enviados.length;
  await M.enviarCorreo(ctxDe('asesor@ventel.example'), correo());
  comprueba('el tope no toca a las cuentas de confianza', enviados.length === antes + 1);

  console.log('\n■ Ajustes');
  // Como lo guarda la Consola (fijarPropiedad), que además invalida la memoria de 30 s de los ajustes.
  await M.fijarPropiedad(ctxDe('maestro@ventel.example'), 'CORREO_DOMINIOS_CONFIABLES', 'liverpool.com.mx, ventel.example, correo-externo.mx');
  alta('nueva@correo-externo.mx', 'Nueva');
  await M.enviarCorreo(ctxDe('nueva@correo-externo.mx'), correo());
  b = enviados[enviados.length - 1];
  comprueba('CORREO_DOMINIOS_CONFIABLES agrega dominios de confianza', JSON.stringify(destinos(b)) === '["cliente@empresa-real.mx"]' && !b.subject.startsWith('[Maqueta]'), { to: destinos(b), subject: b.subject });

  console.log('\n■ Sin sesión (códigos de registro): van a la dirección que se registra');
  await M.enviarCorreo(ctxDe(null), correo({ para: 'alguien@correo-nuevo.mx', asunto: 'Tu código', tipo: 'cuenta' }));
  b = enviados[enviados.length - 1];
  comprueba('sin cambios: a la dirección pedida y sin marca', JSON.stringify(destinos(b)) === '["alguien@correo-nuevo.mx"]' && b.subject === 'Tu código', { to: destinos(b), subject: b.subject });
} finally {
  globalThis.fetch = fetchReal;
}

console.log('\n' + bien + '/' + (bien + mal) + ' comprobaciones bien' + (mal ? ' · ' + mal + ' FALLARON' : ''));
process.exit(mal ? 1 : 0);
