// F4 · PICOS DE EJECUCIONES SIMULTÁNEAS, leídos del registro de Google (Apps Script API, «processes»).
//
// Es el panel «Ejecuciones» leído por programa: inicio y duración de cada ejecución, sin tocar el Portal
// ni cobrarle nada a ninguna llamada. Solo lectura. La API no trae identidades (ni correos ni nombres):
// solo función, tipo, estado, nivel de acceso de quien ejecutó, proyecto, inicio y duración.
//
// Por qué dos listas: el cupo de 30 ejecuciones simultáneas es POR USUARIO. Con executeAs: USER_DEPLOYING
// todo lo que corre como la cuenta dueña compite por las mismas 30: el Portal (producción y pruebas) y
// cualquier otro proyecto que corra con esa cuenta.
//   · --script prod|pruebas|<id>   processes:listScriptProcesses → el desglose de UN proyecto
//   · --usuario                     processes.list → lo de la cuenta dueña, todos los proyectos
//
// Uso:
//   node picos.mjs --autoprueba
//   node picos.mjs --auth <archivo de credenciales> [--script prod] [--usuario] [--dias 7] [--salida <carpeta>]
// La credencial necesita el alcance https://www.googleapis.com/auth/script.processes, que el login normal
// de clasp no pide: `clasp -A <archivo> login --extra-scopes https://www.googleapis.com/auth/script.processes`.
// La salida (JSON con los intervalos, sin identidades) va FUERA del repo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = {
  prod: '1m1pwHzRuIWpUOlSzw7cwrdmbA06_lPEHgkmGpiFdDA6XpO6Y-2jyZCHz',
  pruebas: '1kTyqcGnbMJR64HCYe3cI6NbiaNhdFDN0_B8xqzkNM1PZrYG20axLEc1C'
};
const ZONA = 'America/Mexico_City';
const CUPO = 30;
const VENTANA_MS = 5 * 60 * 1000;
const UMBRALES = [10, 15, 20, 25, 30];

// ── Utilidades puras (las cubre la autoprueba) ──────────────────────────────────────────────────

/** "1.234s" (Duration de protobuf en JSON) → ms. Sin duración → null. */
export function duracionMs(d) {
  if (d === undefined || d === null || d === '') return null;
  const m = /^(-?\d+(?:\.\d+)?)s$/.exec(String(d).trim());
  return m ? Math.round(parseFloat(m[1]) * 1000) : null;
}

/**
 * Barrido de eventos: +1 al empezar y −1 al terminar. A la misma hora, los finales van antes que los
 * comienzos: dos ejecuciones que se tocan (una acaba cuando empieza la otra) no cuentan como simultáneas.
 * @param {{ini:number, fin:number}[]} intervalos  en ms
 * @return {{max:number, tMax:number|null, tramos:[number, number, number][]}}  tramos = [desde, hasta, nivel]
 */
export function barrer(intervalos) {
  const ev = [];
  for (const x of intervalos) {
    if (!(x.fin >= x.ini)) continue;
    ev.push([x.ini, +1]);
    ev.push([x.fin, -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let nivel = 0, max = 0, tMax = null, prev = null;
  const tramos = [];
  for (const [t, d] of ev) {
    if (prev !== null && t > prev && nivel > 0) tramos.push([prev, t, nivel]);
    nivel += d;
    prev = t;
    if (nivel > max) { max = nivel; tMax = t; }
  }
  return { max, tMax, tramos };
}

/** Tiempo acumulado (ms) con al menos `n` ejecuciones a la vez. */
export function tiempoEnOMas(tramos, n) {
  let ms = 0;
  for (const [a, b, nivel] of tramos) if (nivel >= n) ms += b - a;
  return ms;
}

/** Máximo nivel por ventana fija de `ventanaMs` (clave = inicio de la ventana, en ms). */
export function maxPorVentana(tramos, ventanaMs) {
  const v = new Map();
  for (const [a, b, nivel] of tramos) {
    for (let w = Math.floor(a / ventanaMs); w <= Math.floor((b - 1) / ventanaMs); w++) {
      const k = w * ventanaMs;
      if ((v.get(k) || 0) < nivel) v.set(k, nivel);
    }
  }
  return v;
}

/** Nivel de concurrencia en el instante `t` (contando las que empiezan justo ahí). Los tramos vienen
 *  ordenados y sin solaparse (los da barrer), así que basta una búsqueda binaria. */
export function nivelEn(tramos, t) {
  let lo = 0, hi = tramos.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, [a, b, nivel] = tramos[mid];
    if (t < a) hi = mid - 1;
    else if (t >= b) lo = mid + 1;
    else return nivel;
  }
  return 0;
}

function percentil(arr, p) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

const hora = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const soloHora = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA, hour: '2-digit', hour12: false });
export const local = (ms) => hora.format(new Date(ms));
const horaDelDia = (ms) => Number(soloHora.format(new Date(ms)));

/** Lo que se cuenta de una lista de procesos de la API. */
export function analizar(procesos, ahora) {
  const terminadas = [], enCurso = [], sinDuracion = [];
  for (const p of procesos) {
    const ini = Date.parse(p.startTime);
    if (isNaN(ini)) continue;
    const ms = duracionMs(p.duration);
    const fila = { ini, fn: p.functionName || '?', tipo: p.processType || '?', estado: p.processStatus || '?', acceso: p.userAccessLevel || '?', proyecto: p.projectName || '' };
    if (fila.estado === 'RUNNING' || fila.estado === 'PAUSED' || fila.estado === 'DELAYED') { enCurso.push(Object.assign(fila, { fin: ahora })); continue; }
    if (ms === null) { sinDuracion.push(fila); continue; }
    terminadas.push(Object.assign(fila, { fin: ini + ms, ms }));
  }
  const b = barrer(terminadas);
  const porVentana = maxPorVentana(b.tramos, VENTANA_MS);
  const ventanas = [...porVentana.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  const agrupar = (clave) => {
    const g = {};
    for (const f of terminadas) {
      const k = f[clave];
      (g[k] = g[k] || []).push(f.ms);
    }
    return Object.fromEntries(Object.entries(g).sort((x, y) => y[1].length - x[1].length)
      .map(([k, arr]) => [k, { n: arr.length, p50ms: percentil(arr, 0.5), p90ms: percentil(arr, 0.9), totalS: Math.round(arr.reduce((s, x) => s + x, 0) / 1000) }]));
  };
  const porHora = {};
  for (const f of terminadas) {
    const h = horaDelDia(f.ini);
    porHora[h] = porHora[h] || { inicios: 0 };
    porHora[h].inicios++;
  }
  for (const [k, nivel] of porVentana) {
    const h = horaDelDia(k);
    porHora[h] = porHora[h] || { inicios: 0 };
    porHora[h].maxSimultaneas = Math.max(porHora[h].maxSimultaneas || 0, nivel);
  }
  const fallidas = terminadas.filter((f) => f.estado === 'FAILED' || f.estado === 'TIMED_OUT' || f.estado === 'UNKNOWN' || f.estado === 'CANCELED');
  const fallos = fallidas.map((f) => ({ cuando: local(f.ini), fn: f.fn, tipo: f.tipo, estado: f.estado, ms: f.ms, nivelAlEmpezar: nivelEn(b.tramos, f.ini) }))
    .sort((x, y) => y.nivelAlEmpezar - x.nivelAlEmpezar);
  // Sin Math.min(...arr): con cientos de miles de ejecuciones desborda la pila.
  let primero = Infinity, ultimo = -Infinity;
  for (const f of terminadas) { if (f.ini < primero) primero = f.ini; if (f.ini > ultimo) ultimo = f.ini; }
  return {
    ejecuciones: terminadas.length,
    enCurso: enCurso.length,
    sinDuracion: sinDuracion.length,
    desde: terminadas.length ? local(primero) : null,
    hasta: terminadas.length ? local(ultimo) : null,
    maxSimultaneas: b.max,
    cuandoMax: b.tMax !== null ? local(b.tMax) : null,
    cupo: CUPO,
    tiempoEnOMas: Object.fromEntries(UMBRALES.map((n) => [n, Math.round(tiempoEnOMas(b.tramos, n) / 1000) + ' s'])),
    picos5min: ventanas.slice(0, 10).map(([k, nivel]) => ({ ventana: local(k), maxSimultaneas: nivel })),
    porHoraLocal: Object.fromEntries(Object.entries(porHora).sort((x, y) => Number(x[0]) - Number(y[0]))),
    porFuncion: agrupar('fn'),
    porTipo: agrupar('tipo'),
    porEstado: agrupar('estado'),
    porAcceso: agrupar('acceso'),
    porProyecto: agrupar('proyecto'),
    fallos: { total: fallos.length, conMasConcurrencia: fallos.slice(0, 15) },
    _intervalos: terminadas.map((f) => [f.ini, f.ms, f.fn, f.tipo, f.estado, f.acceso, f.proyecto])
  };
}

// ── Autoprueba ──────────────────────────────────────────────────────────────────────────────────

function autoprueba() {
  let total = 0, fallos = 0;
  const ok = (n, c, x) => { total++; if (c) { console.log('  ✔ ' + n); return; } fallos++; console.log('  ✖ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); };
  ok('"1.234s" → 1234 ms', duracionMs('1.234s') === 1234);
  ok('"0.000001s" → 0 ms', duracionMs('0.000001s') === 0);
  ok('sin duración → null', duracionMs(undefined) === null && duracionMs('') === null && duracionMs('x') === null);

  let b = barrer([{ ini: 0, fin: 10 }, { ini: 5, fin: 15 }, { ini: 10, fin: 20 }]);
  ok('tres solapadas en cadena → máximo 2', b.max === 2, b);
  ok('…y los tramos son [0,5)=1 [5,10)=2 [10,15)=2 [15,20)=1', JSON.stringify(b.tramos) === '[[0,5,1],[5,10,2],[10,15,2],[15,20,1]]', b.tramos);
  b = barrer([{ ini: 0, fin: 10 }, { ini: 10, fin: 20 }]);
  ok('dos que se tocan (una acaba cuando empieza la otra) no son simultáneas', b.max === 1, b);
  b = barrer(Array.from({ length: 30 }, (_, i) => ({ ini: 1000 + i, fin: 5000 })));
  ok('30 que arrancan casi a la vez → máximo 30', b.max === 30 && b.tMax === 1029, b.max);
  ok('…y el tiempo con 30 o más es el tramo común (5000 − 1029)', tiempoEnOMas(b.tramos, 30) === 3971, tiempoEnOMas(b.tramos, 30));
  ok('…y con 31 o más, cero', tiempoEnOMas(b.tramos, 31) === 0);
  b = barrer([{ ini: 0, fin: 10 }, { ini: 20, fin: 10 }]);
  ok('un intervalo al revés se ignora', b.max === 1);

  const w = maxPorVentana([[290000, 310000, 3], [610000, 620000, 5]], 300000);
  ok('un tramo que cruza el borde de una ventana cuenta en las dos', w.get(0) === 3 && w.get(300000) === 3 && w.get(600000) === 5 && w.size === 3, [...w]);
  ok('nivel en un instante', nivelEn([[0, 5, 1], [5, 10, 2]], 5) === 2 && nivelEn([[0, 5, 1]], 7) === 0);

  const t0 = Date.parse('2026-09-30T15:00:00Z');   // 09:00 en Ciudad de México (UTC−6)
  const procesos = [
    { startTime: new Date(t0).toISOString(), duration: '3s', functionName: 'secEjecutar', processType: 'WEBAPP', processStatus: 'COMPLETED', userAccessLevel: 'NONE', projectName: 'P' },
    { startTime: new Date(t0 + 1000).toISOString(), duration: '1.5s', functionName: 'doGet', processType: 'WEBAPP', processStatus: 'COMPLETED', userAccessLevel: 'NONE', projectName: 'P' },
    { startTime: new Date(t0 + 2000).toISOString(), duration: '2s', functionName: 'secEjecutar', processType: 'WEBAPP', processStatus: 'FAILED', userAccessLevel: 'NONE', projectName: 'P' },
    { startTime: new Date(t0 + 9000).toISOString(), functionName: 'secEjecutar', processType: 'WEBAPP', processStatus: 'RUNNING', userAccessLevel: 'NONE', projectName: 'P' },
    { startTime: new Date(t0 + 9500).toISOString(), functionName: 'promosAutoDisparador', processType: 'TIME_DRIVEN', processStatus: 'COMPLETED', userAccessLevel: 'OWNER', projectName: 'P' }
  ];
  const a = analizar(procesos, t0 + 20000);
  ok('analizar: 3 terminadas, 1 en curso aparte, 1 sin duración aparte', a.ejecuciones === 3 && a.enCurso === 1 && a.sinDuracion === 1, a);
  ok('analizar: máximo 3 a las 09:00:02 (hora de México)', a.maxSimultaneas === 3 && /09:00:02/.test(a.cuandoMax), [a.maxSimultaneas, a.cuandoMax]);
  ok('analizar: la fallida empezó con 3 a la vez', a.fallos.total === 1 && a.fallos.conMasConcurrencia[0].nivelAlEmpezar === 3, a.fallos);
  ok('analizar: hora local 9 con 3 inicios y máximo 3', a.porHoraLocal[9] && a.porHoraLocal[9].inicios === 3 && a.porHoraLocal[9].maxSimultaneas === 3, a.porHoraLocal);
  ok('analizar: por función, secEjecutar 2 y doGet 1', a.porFuncion.secEjecutar.n === 2 && a.porFuncion.doGet.n === 1, a.porFuncion);
  ok('analizar: sin correos ni nombres en la salida', !/@/.test(JSON.stringify(a)));
  console.log(fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde');
  return fallos ? 1 : 0;
}

// ── La API ──────────────────────────────────────────────────────────────────────────────────────

async function tokenDe(archivo, usuario) {
  const rc = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const t = rc.tokens && rc.tokens[usuario || 'default'];
  if (!t) throw new Error('No hay credencial «' + (usuario || 'default') + '» en ' + archivo + '.');
  if (t.access_token && t.expiry_date && t.expiry_date - Date.now() > 120000) return t.access_token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: t.client_id, client_secret: t.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('No se pudo renovar la credencial (' + (j.error || r.status) + '). Vuelve a iniciar sesión con clasp.');
  return j.access_token;
}

async function listar({ tok, scriptId, usuario, desde, hasta }) {
  const out = [];
  let pagina = '', paginas = 0, primera = null;
  do {
    const q = new URLSearchParams({ pageSize: '200' });
    if (usuario) {
      q.set('userProcessFilter.startTime', new Date(desde).toISOString());
      q.set('userProcessFilter.endTime', new Date(hasta).toISOString());
    } else {
      q.set('scriptId', scriptId);
      q.set('scriptProcessFilter.startTime', new Date(desde).toISOString());
      q.set('scriptProcessFilter.endTime', new Date(hasta).toISOString());
    }
    if (pagina) q.set('pageToken', pagina);
    const url = 'https://script.googleapis.com/v1/' + (usuario ? 'processes' : 'processes:listScriptProcesses') + '?' + q;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j.error ? j.error.status + ' · ' + j.error.message : 'HTTP ' + r.status;
      if (r.status === 403 && /scope/i.test(msg)) throw new Error('La credencial no tiene el alcance script.processes: ' + msg);
      throw new Error(msg);
    }
    const ps = j.processes || [];
    if (primera === null) primera = ps.length;
    out.push(...ps);
    pagina = j.nextPageToken || '';
    paginas++;
    if (paginas % 10 === 0) process.stderr.write('  … ' + out.length + ' procesos (' + paginas + ' páginas)\n');
  } while (pagina && paginas < 5000);
  return { procesos: out, paginas, porPagina: primera };
}

async function principal(argv) {
  const opt = { dias: 7 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--autoprueba') return autoprueba();
    if (a === '--usuario') opt.usuario = true;
    else if (a === '--auth') opt.auth = argv[++i];
    else if (a === '--cuenta') opt.cuenta = argv[++i];
    else if (a === '--script') opt.script = argv[++i];
    else if (a === '--dias') opt.dias = Number(argv[++i]);
    else if (a === '--salida') opt.salida = argv[++i];
    else throw new Error('Opción desconocida: ' + a);
  }
  if (!opt.auth) throw new Error('Falta --auth <archivo de credenciales con el alcance script.processes>.');
  // La salida lleva los intervalos de cada ejecución: fuera del repo, que el hook lo sube todo.
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (opt.salida && !path.relative(repo, path.resolve(opt.salida)).startsWith('..')) {
    throw new Error('La salida tiene que ir FUERA del repo: ' + opt.salida);
  }
  const scriptId = opt.usuario ? null : (SCRIPTS[opt.script || 'prod'] || opt.script);
  const hasta = Date.now(), desde = hasta - opt.dias * 86400000;
  const tok = await tokenDe(opt.auth, opt.cuenta);
  const qué = opt.usuario ? 'la cuenta dueña (todos sus proyectos)' : 'el script ' + (opt.script || 'prod');
  console.log('Leyendo las ejecuciones de ' + qué + ' desde ' + local(desde) + ' …');
  const { procesos, paginas, porPagina } = await listar({ tok, scriptId, usuario: opt.usuario, desde, hasta });
  const r = analizar(procesos, Date.now());
  const resumen = Object.assign({ fuente: opt.usuario ? 'processes.list (usuario)' : 'processes:listScriptProcesses (' + (opt.script || 'prod') + ')', pedidoDesde: local(desde), paginas, porPagina }, r);
  const { _intervalos, ...sinIntervalos } = resumen;
  console.log(JSON.stringify(sinIntervalos, null, 2));
  if (opt.salida) {
    fs.mkdirSync(opt.salida, { recursive: true });
    const f = path.join(opt.salida, 'picos-' + (opt.usuario ? 'usuario' : (opt.script || 'prod')) + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(f, JSON.stringify(resumen));
    console.log('Guardado (con los intervalos, sin identidades): ' + f);
  }
  return 0;
}

// Solo como programa: importarlo (para probar `analizar` con datos sintéticos) no lo ejecuta.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  principal(process.argv.slice(2)).then((c) => process.exit(c || 0), (e) => { console.error('✖ ' + (e && e.message || e)); process.exit(1); });
}
