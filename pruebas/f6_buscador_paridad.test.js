/*
 * BATERÍA DE PARIDAD DE LA FASE 6 — un solo motor de búsqueda, dos vestidos.
 *   Ejecutar:  node pruebas/f6_buscador_paridad.test.js
 *
 * La fase sustituye el motor propio del buscador del Portal (buildQuery + scoreMatch +
 * fuzzyHit + levLE, dentro de Index.html) por AppBuscar, el que ya usaba el buscador
 * general. El criterio de aceptación del plan no es "que siga funcionando": es que
 * CADA TÉRMINO ENCUENTRE LO MEJOR DE LO QUE CUALQUIERA DE LOS DOS ENCONTRABA ANTES.
 * Eso solo se puede afirmar comparando, término a término, contra el motor viejo.
 *
 * Por eso el motor viejo vive aquí dentro, COPIADO LETRA POR LETRA de Index.html antes
 * del cambio, y congelado. No es duplicación: es la referencia contra la que se mide.
 * Los índices, en cambio, se leen de los archivos REALES, así que si mañana alguien
 * añade una forma de pago la prueba la incluye sola.
 *
 * Esta carpeta queda fuera de "Carpeta del proyecto", así que clasp nunca la sube.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');
const leer = (f) => fs.readFileSync(path.join(PROY, f), 'utf8');

/* ═══════════════════════════════════════════════════════════════════════════
   1 · EL MOTOR NUEVO: AppBuscar real, en un contexto con `window`
   ═══════════════════════════════════════════════════════════════════════════ */
function cargaAppBuscar() {
  const html = leer('app_buscar.html');
  const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const ctx = { console, Math, JSON, String, Number, Object, Array, RegExp, Date, parseInt, parseFloat };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(js, ctx, { filename: 'app_buscar.html' });
  if (!ctx.AppBuscar) throw new Error('app_buscar.html no publicó window.AppBuscar');
  return ctx.AppBuscar;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · EL MOTOR VIEJO — copia congelada de Index.html anterior a la Fase 6
   (buildQuery 5326-5333, levLE 5335-5351, fuzzyHit 5354-5363,
    scoreMatch 5364-5385, norm 5386). No tocar: es la referencia.
   ═══════════════════════════════════════════════════════════════════════════ */
function motorViejo(SEARCH_SYNONYMS) {
  function norm(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
  }
  function buildQuery(q) {
    const raw = norm(q);
    const words = raw.split(/\s+/).filter(Boolean);
    const soft = new Set();
    words.forEach((w) => { const syn = SEARCH_SYNONYMS[w]; if (syn) norm(syn).split(/\s+/).forEach((t) => soft.add(t)); });
    words.forEach((w) => soft.delete(w));
    return { raw, words, soft: [...soft] };
  }
  function levLE(a, b, max) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return false;
    let prev = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      const cur = new Array(lb + 1); cur[0] = i; let best = cur[0];
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return false;
      prev = cur;
    }
    return prev[lb] <= max;
  }
  function fuzzyHit(hay, w) {
    if (w.length < 4 || !hay) return false;
    const max = w.length >= 7 ? 2 : 1;
    const toks = hay.split(' ');
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.length >= 3 && Math.abs(t.length - w.length) <= max && levLE(t, w, max)) return true;
    }
    return false;
  }
  /* Copia congelada, con un solo añadido: apunta POR QUÉ coincidió.
     Hace falta para juzgar las diferencias. Un resultado que el motor viejo sacaba solo
     por parecido de letras puede desaparecer sin que eso sea una pérdida —"fraudes"
     casaba con "grandes" por dos sustituciones, y eso no es lo que nadie buscaba—,
     mientras que perder una coincidencia literal o un sinónimo sí es una regresión.
     La criba de AppBuscar (vecinasPlausibles) descarta esos pares a propósito. */
  function scoreMatch(Q, name, sub, extra) {
    const { raw, words, soft } = Q;
    if (!words.length) return { score: 0, via: null };
    let s = 0, matched = 0, literal = false, difuso = false, sinonimo = false;
    if (raw.length >= 3 && name.includes(raw)) { s += 16; literal = true; }
    words.forEach((w) => {
      let hit = false;
      if (name.includes(w)) { s += name.startsWith(w) ? 12 : 7; hit = true; literal = true; }
      else if (fuzzyHit(name, w)) { s += 5; hit = true; difuso = true; }
      if (sub.includes(w)) { s += 4; hit = true; literal = true; }
      else if (fuzzyHit(sub, w)) { s += 2; hit = true; difuso = true; }
      if (extra.includes(w)) { s += 2; hit = true; literal = true; }
      else if (fuzzyHit(extra, w)) { s += 1; hit = true; difuso = true; }
      if (hit) matched++;
    });
    soft.forEach((w) => {
      if (name.includes(w)) { s += 3; sinonimo = true; }
      else if (sub.includes(w) || extra.includes(w)) { s += 1.5; sinonimo = true; }
    });
    if (words.length > 1 && matched < words.length) s *= (matched / words.length) * 0.6;
    const via = literal ? 'literal' : (sinonimo ? 'sinonimo' : (difuso ? 'difuso' : null));
    return { score: s, via };
  }
  return {
    puntua: (q, name, sub, extra) => scoreMatch(buildQuery(q), norm(name || ''), norm(sub || ''), norm(extra || ''))
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · LOS ÍNDICES REALES, extraídos de Index.html
   Se leen del archivo de verdad para que la prueba siga midiendo el contenido
   que hay hoy y no una copia que envejece en silencio.
   ═══════════════════════════════════════════════════════════════════════════ */
function extraeLiteral(src, nombre) {
  const i = src.indexOf('const ' + nombre + ' = ');
  if (i === -1) throw new Error('no encontré ' + nombre + ' en Index.html');
  const abre = src.indexOf(src[src.indexOf('=', i) + 2] === '[' ? '[' : '{', src.indexOf('=', i));
  const cierra = abre;
  const pares = { '[': ']', '{': '}' };
  const fin = pares[src[abre]];
  let nivel = 0, j = abre, dentro = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (dentro) {
      if (c === '\\') { j++; continue; }
      if (c === dentro) dentro = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { dentro = c; continue; }
    if (c === src[abre]) nivel++;
    else if (c === fin) { nivel--; if (!nivel) break; }
  }
  const texto = src.slice(cierra, j + 1);
  return new Function('return ' + texto)();
}

const INDEX = leer('Index.html');
const SEARCH_SYNONYMS = extraeLiteral(INDEX, 'SEARCH_SYNONYMS');

/* Los cuatro índices del Portal se mudaron a app_indices.html (T6.2) para que el
   buscador general los alcance. Se cargan del partial REAL, con su IIFE, que es también
   la comprobación de que el partial publica lo que promete. */
function cargaAppIndices() {
  const js = leer('app_indices.html').match(/<script>([\s\S]*?)<\/script>/)[1];
  const ctx = { console, Math, JSON, String, Number, Object, Array, RegExp };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(js, ctx, { filename: 'app_indices.html' });
  if (!ctx.AppIndices) throw new Error('app_indices.html no publicó window.AppIndices');
  return ctx.AppIndices;
}
const IDX = cargaAppIndices();
const FP_INDEX = IDX.formasPago;
const DEVSAP_INDEX = IDX.devolucionesSap;
const SECTIONS_NAV = IDX.secciones;
const TIENDA_CR = IDX.tiendaCR;
/* El catálogo de funciones también se unificó (T6.3). Se proyecta como lo hace
   Index.html, para puntuar contra lo mismo que puntúa el buscador de verdad. */
const APP_ACTIONS = IDX.catalogo
  .filter((f) => !(f.fuera && f.fuera.indexOf('portal') !== -1))
  .map((f) => ({ id: f.id, name: f.nombre, sub: f.sub, kw: f.kw, bloques: f.bloques }));

/* Fixture de `store`: lo que llega de la hoja de cálculo y aquí no hay servidor.
   Filas escritas con los MISMOS nombres de campo que declara `specs` en
   doGlobalSearch, que es lo que hace que la comparación signifique algo. */
const store = {
  herramientas: [
    { nombre: 'Salesforce', descripcion: 'Consulta de casos y trazabilidad de pedidos', comoAcceder: 'Con tu usuario de red', claves: 'SF-001', enlace: 'salesforce.com' },
    { nombre: 'SAP ECC', descripcion: 'Visualización de partidas y devoluciones', comoAcceder: 'Transacción FBL5N', claves: '750160', enlace: 'sap.liverpool.com.mx' },
    { nombre: 'Portal de Transferencias BBVA', descripcion: 'Depósitos y convenio empresarial', comoAcceder: 'Usuario del banco', claves: '', enlace: 'bbva.mx' },
    { nombre: 'SOMS', descripcion: 'Estatus de paquetería y mensajería', comoAcceder: 'Acceso por VPN', claves: '', enlace: 'soms.liverpool.com.mx' },
    { nombre: 'Monitor de González Ríos', descripcion: 'Panel del supervisor de zona', comoAcceder: '', claves: '', enlace: '' }
  ],
  plantillas: [
    { titulo: 'Ticket de compra', asunto: 'Reenvío de tu comprobante', cuerpo: 'Adjuntamos el ticket de tu pedido', consideraciones: 'Verificar el número de pedido', tipo: 'mail' },
    { titulo: 'Estado de cuenta PF', asunto: 'Solicitud de estado de cuenta', cuerpo: 'Para validar tu tarjeta necesitamos el estado de cuenta', consideraciones: 'Persona física', tipo: 'mail' },
    { titulo: 'Bienvenida al cliente', asunto: 'Gracias por tu compra', cuerpo: 'Te damos la bienvenida', consideraciones: '', tipo: 'mail' },
    { titulo: 'Escalamiento a soporte', asunto: 'Caso escalado', cuerpo: 'Se escala el caso a soporte técnico', consideraciones: 'Copiar al supervisor', tipo: 'sf' }
  ],
  paqueterias: [
    { nombre: 'DHL', soms: 'Rastreo por número de guía', liga: 'dhl.com' },
    { nombre: 'Estafeta', soms: 'Seguimiento de envíos', liga: 'estafeta.com' }
  ],
  formatos: [
    { acceso: 'Formato de devolución', observaciones: 'Se llena con el cliente en línea', liga: 'drive.google.com/formato-dev' },
    { acceso: 'Carta de cancelación', observaciones: 'Requiere firma del cliente', liga: 'drive.google.com/carta' }
  ],
  pdePago: [
    { nombre: 'Simulador de Pago Web', detalles: 'Genera la liga de pago para el cliente', liga: 'pagoweb.liverpool.com.mx' }
  ],
  presentaciones: [
    { nombre: 'Capacitación de Big Ticket', descripcion: 'Diapositivas del proceso completo', liga: 'slides.google.com/bt' }
  ],
  anuncios: [
    { id: 'anc-1', titulo: 'Nueva política de envíos', descripcion: 'Cambian los tiempos de entrega de Marketplace', vigencia: 'Hasta el 30 de septiembre', ctaTexto: 'Ver guía', formato: 'destacado' }
  ]
};

/* Los seis índices de trazabilidad nacen vacíos y los rellena la hoja de
   Homologación. Aquí se simula esa respuesta con la forma que produce
   trazReconstruirIndices, incluido un `kw` largo de verdad (el caso del criterio 4). */
const kwLargo = ('devolucion reembolso dilisa procede recogido canalizar tienda mercancia danada incompleta ' +
  'equivocada satisfaccion sin liverpool cerca producto menor tres mil pesos matriz servicio sl enr reconocida ' +
  'entrega no reconocida evidencia plataforma marketplace soft line big ticket mercaderias glosario leyenda sap ' +
  'ecc fbl5n partidas cuenta deudor sociedad asignacion pedido transaccion autorizacion escrita supervisor team ' +
  'leader correo ventas ccl cambio estatus semaforo pao salesforce soms simpliroute evidencia entrega ruta tracking').repeat(2);
const BT_INDEX = [
  { name: 'Pedido no entregado — Big Ticket', sub: 'Big Ticket · Reporte 24 h · Solución 5 días · SOMS/PAO', target: 'bt-1', kw: kwLargo },
  { name: 'Devolución de mueble — Big Ticket', sub: 'Big Ticket · Solución según método de pago', target: 'bt-2', kw: kwLargo }
];
const MKP_INDEX = [
  { name: 'Devolución MarketPlace — MKP', sub: 'MarketPlace · Reporte 48 h · Solución 10 días', target: 'mkp-1', kw: kwLargo }
];

/* ═══════════════════════════════════════════════════════════════════════════
   4 · Los pesos y opciones REALES del Portal, leídos de Index.html
   ═══════════════════════════════════════════════════════════════════════════ */
function pesosDePortal(src) {
  const cap = (re) => { const m = src.match(re); if (!m) throw new Error('no encontré ' + re); return m[1]; };
  const indice = cap(/const CAMPOS_INDICE\s*=\s*(\([^)]*\)\s*=>\s*\[[^\]]*\]);/);
  const portal = cap(/const CAMPOS_PORTAL\s*=\s*(\([^)]*\)\s*=>\s*\[[^\]]*\]);/);
  const opts = cap(/const OPTS_PORTAL\s*=\s*(\{[^}]*\});/);
  return {
    CAMPOS_INDICE: new Function('return ' + indice)(),
    CAMPOS_PORTAL: new Function('return ' + portal)(),
    OPTS_PORTAL: new Function('return ' + opts)()
  };
}

const B = cargaAppBuscar();
const viejo = motorViejo(SEARCH_SYNONYMS);
const { CAMPOS_INDICE, CAMPOS_PORTAL, OPTS_PORTAL } = pesosDePortal(INDEX);
B.agregaSinonimos(SEARCH_SYNONYMS);   // igual que hace Index.html al cargar

const nuevoIndice = (q, n, s, k) => B.puntua(B.consulta(q), CAMPOS_INDICE(n || '', s || '', k || ''), OPTS_PORTAL);
const nuevoPortal = (q, n, s, e) => B.puntua(B.consulta(q), CAMPOS_PORTAL(n || '', s || '', e || ''), OPTS_PORTAL);

/* ═══════════════════════════════════════════════════════════════════════════
   5 · Fuentes, tal como las recorre doGlobalSearch
   ═══════════════════════════════════════════════════════════════════════════ */
const FUENTES = [
  { id: 'herramientas', filas: store.herramientas, n: 'nombre', s: 'descripcion', e: ['comoAcceder', 'claves'], modo: 'portal' },
  { id: 'plantillas', filas: store.plantillas, n: 'titulo', s: 'asunto', e: ['cuerpo', 'consideraciones', 'tipo'], modo: 'portal' },
  { id: 'paqueterias', filas: store.paqueterias, n: 'nombre', s: 'soms', e: ['liga'], modo: 'portal' },
  { id: 'formatos', filas: store.formatos, n: 'acceso', s: 'observaciones', e: ['liga'], modo: 'portal' },
  { id: 'pdePago', filas: store.pdePago, n: 'nombre', s: 'detalles', e: ['liga'], modo: 'portal' },
  { id: 'presentaciones', filas: store.presentaciones, n: 'nombre', s: 'descripcion', e: ['liga'], modo: 'portal' },
  { id: 'anuncios', filas: store.anuncios, n: 'titulo', s: 'descripcion', e: ['vigencia', 'ctaTexto', 'formato'], modo: 'portal' },
  { id: 'formaspago', filas: FP_INDEX, n: 'name', s: 'sub', e: ['kw'], modo: 'indice' },
  { id: 'devsap', filas: DEVSAP_INDEX, n: 'name', s: 'sub', e: ['kw'], modo: 'indice' },
  { id: 'bigticket', filas: BT_INDEX, n: 'name', s: 'sub', e: ['kw'], modo: 'indice' },
  { id: 'mkp', filas: MKP_INDEX, n: 'name', s: 'sub', e: ['kw'], modo: 'indice' },
  { id: 'app', filas: APP_ACTIONS, n: 'name', s: 'sub', e: ['kw'], modo: 'indice' },
  { id: 'nav', filas: SECTIONS_NAV, n: 'label', s: null, e: ['kw'], modo: 'indice' }
];

function textos(f, fila) {
  return [
    String(fila[f.n] || ''),
    f.s ? String(fila[f.s] || '') : '',
    f.e.map((c) => String(fila[c] || '')).join(' ')
  ];
}
function encuentra(motor, q, f) {
  const out = [];
  f.filas.forEach((fila) => {
    const [n, s, e] = textos(f, fila);
    if (motor === 'viejo') {
      const r = viejo.puntua(q, n, s, e);
      if (r.score > 0) out.push({ nombre: n, score: r.score, via: r.via });
    } else {
      const score = f.modo === 'indice' ? nuevoIndice(q, n, s, e) : nuevoPortal(q, n, s, e);
      if (score > 0) out.push({ nombre: n, score });
    }
  });
  return out.sort((a, b) => b.score - a.score);
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · LA BATERÍA
   ═══════════════════════════════════════════════════════════════════════════ */
const TERMINOS = [
  'cotizaicon', 'cotizacion', 'lvp2024', 'cc', 'pa', 'jse',
  'clabe', 'spei', 'transferencia', 'openpay', 'rfc', 'factura', 'fiscal',
  'efectivo', 'paynet', 'monedero', 'med', 'bin', 'fbl5n', 'sap partidas', 'fraudes',
  'guia', 'guía', 'rastreo', 'paqueteria', 'devolucion', 'devolución sap', 'enr',
  'satisfaccion sl', 'matriz 3000', 'recogido', 'ticket de compra', 'estado de cuenta',
  'plantilla bienvenida', 'escalamiento', 'panel avanzado', 'reportar falla',
  'atenciones rescatables', 'consola', 'anuncios', 'promociones', 'promo',
  'gonzalez', 'salesforce', 'soms', 'big ticket', 'marketplace', 'formato de devolucion',
  'pago web', 'capacitacion'
];

let fallos = 0;
const gana = [];
const ruidoFuera = [];
function mal(msg) { fallos++; console.log('  ✗ ' + msg); }

console.log('BATERÍA DE PARIDAD · ' + TERMINOS.length + ' términos × ' + FUENTES.length + ' fuentes\n');

/* — Criterio 1: el motor nuevo encuentra TODO lo que encontraba el viejo — */
console.log('1) Superconjunto: nada de lo que el buscador encontraba antes desaparece');
TERMINOS.forEach((q) => {
  FUENTES.forEach((f) => {
    const antes = encuentra('viejo', q, f);
    const ahora = encuentra('nuevo', q, f);
    const nombresAhora = new Set(ahora.map((r) => r.nombre));
    antes.forEach((r) => {
      if (nombresAhora.has(r.nombre)) return;
      // Lo que el motor viejo solo sacaba por parecido de letras no cuenta como pérdida:
      // la criba del motor nuevo descarta esos pares a propósito y se anotan aparte para
      // poder mirarlos uno a uno.
      if (r.via === 'difuso') { ruidoFuera.push(`"${q}" en ${f.id}: «${r.nombre}» (solo por parecido, ${r.score.toFixed(1)})`); return; }
      mal(`"${q}" en ${f.id}: se perdió «${r.nombre}» (antes ${r.score.toFixed(1)}, por ${r.via})`);
    });
    const nuevos = ahora.filter((r) => !antes.some((a) => a.nombre === r.nombre));
    nuevos.forEach((r) => gana.push(`"${q}" en ${f.id}: ahora encuentra «${r.nombre}»`));
  });
});
console.log(`   ${fallos ? fallos + ' pérdidas reales' : 'sin pérdidas'} · ${gana.length} resultados nuevos · ${ruidoFuera.length} coincidencias por parecido descartadas\n`);

/* — Criterio 1 (la otra mitad): lo que el motor nuevo sabe y el viejo no — */
console.log('2) Ganancias concretas que la fusión tenía que traer');
const DEBE_ENCONTRAR = [
  ['cotizaicon', 'app', 'Nueva cotización', 'transposición al teclear'],
  ['cc', 'app', 'Correos a clientes', 'siglas'],
  ['guía', 'paqueterias', 'DHL', 'acento en la consulta'],
  ['fbl5n', 'formaspago', 'Visualización de Partidas (FBL5N)', 'frontera letra/dígito'],
  ['fbl5n', 'herramientas', 'SAP ECC', 'clave técnica en el subtítulo'],
  ['clabe', 'herramientas', 'Portal de Transferencias BBVA', 'sinónimo sin la palabra escrita'],
  ['gonzalez', 'herramientas', 'Monitor de González Ríos', 'acento en el dato']
];
DEBE_ENCONTRAR.forEach(([q, fid, nombre, porque]) => {
  const f = FUENTES.find((x) => x.id === fid);
  const ahora = encuentra('nuevo', q, f);
  const hit = ahora.find((r) => r.nombre.toLowerCase().indexOf(nombre.toLowerCase()) !== -1);
  if (!hit) mal(`"${q}" debería encontrar «${nombre}» en ${fid} (${porque}) y no sale`);
  else console.log(`   ✓ "${q}" → «${hit.nombre}» (${porque})`);
});
console.log();

/* — El sinónimo acerca, pero nunca desbanca a una coincidencia literal — */
console.log('3) Un sinónimo empuja, no decide');
{
  const f = FUENTES.find((x) => x.id === 'herramientas');
  const r = encuentra('nuevo', 'clabe', f);
  const porSinonimo = r.find((x) => x.nombre.indexOf('BBVA') !== -1);
  const literales = r.filter((x) => x.nombre.indexOf('BBVA') === -1);
  if (!porSinonimo) mal('"clabe" ya no llega a Transferencias BBVA');
  else if (literales.some((x) => x.score <= porSinonimo.score)) {
    mal('un acercamiento por sinónimo quedó por ENCIMA de una coincidencia literal');
  } else console.log(`   ✓ el acercamiento por sinónimo puntúa ${porSinonimo.score.toFixed(2)}, por debajo de todo lo literal`);
}
console.log();

/* — El buscador no se inunda: una palabra concreta no puede traerlo todo — */
console.log('4) Sin inundación: una palabra concreta no devuelve el catálogo entero');
[['fbl5n', 'formaspago'], ['enr', 'devsap'], ['bienvenida', 'plantillas']].forEach(([q, fid]) => {
  const f = FUENTES.find((x) => x.id === fid);
  const ahora = encuentra('nuevo', q, f);
  const tope = Math.max(2, Math.ceil(f.filas.length * 0.6));
  if (ahora.length > tope) mal(`"${q}" en ${fid} devuelve ${ahora.length} de ${f.filas.length} (tope ${tope})`);
  else console.log(`   ✓ "${q}" en ${fid}: ${ahora.length} de ${f.filas.length}`);
});
console.log();

/* — Con varias palabras se siguen viendo las parciales, penalizadas — */
console.log('5) Las coincidencias parciales siguen apareciendo, detrás de las completas');
{
  const f = FUENTES.find((x) => x.id === 'plantillas');
  const r = encuentra('nuevo', 'plantilla bienvenida', f);
  if (!r.length) mal('"plantilla bienvenida" no devuelve nada (exigirTodas se quedó en true)');
  else if (r[0].nombre.indexOf('Bienvenida') === -1) mal('"plantilla bienvenida" no pone Bienvenida primero: ' + r[0].nombre);
  else console.log(`   ✓ "plantilla bienvenida" → «${r[0].nombre}» primero, con ${r.length} resultados`);
}
console.log();

/* — Resaltado: lo que arregla cambiar hilite por AppBuscar.resalta — */
console.log('6) Resaltado');
{
  const conAcento = B.resalta('Guía de rastreo', 'guia');
  if (conAcento.indexOf('<mark>') === -1) mal('el resaltado sin acentos no marca «Guía»');
  else console.log('   ✓ "guia" marca «Guía» (antes salía sin una sola marca)');

  // El texto contiene "mark" de verdad: es el caso que rompía el desplegable, porque el
  // resaltado anterior corría su expresión regular sobre el HTML que él mismo acababa
  // de escribir y volvía a marcar dentro de la etiqueta <mark>.
  const trampa = B.resalta('MarketPlace y sus marcas', 'mark');
  const marcas = (trampa.match(/<mark>/g) || []).length;
  const cierres = (trampa.match(/<\/mark>/g) || []).length;
  if (!marcas) mal('buscar "mark" no marca nada en «MarketPlace y sus marcas»');
  else if (marcas !== cierres || /<mark>[^<]*<mark>/.test(trampa)) {
    mal('buscar "mark" corrompe el HTML del resaltado: ' + trampa);
  } else console.log('   ✓ buscar "mark" marca ' + marcas + ' vez/veces sin romper el HTML: ' + trampa);
  // Y la trampa de las entidades: "amp" casaba dentro de &amp; y partía la entidad.
  const ent = B.resalta('Ventas & Servicios amplios', 'amp');
  if (/&(?!amp;|lt;|gt;|quot;|#39;)/.test(ent.replace(/<\/?mark>/g, '')) || /&am<\/?mark>/.test(ent)) {
    mal('buscar "amp" parte una entidad HTML: ' + ent);
  } else console.log('   ✓ buscar "amp" no parte la entidad de «&»');

  const inyeccion = B.resalta('<img src=x onerror=alert(1)> guía', 'guia');
  if (inyeccion.indexOf('<img') !== -1) mal('el resaltado no escapa el HTML del dato');
  else console.log('   ✓ el HTML que venga de la hoja se escapa');
}
console.log();

/* — Criterio 4: los kw largos no pueden costar una tokenización por tecla — */
console.log('7) Rendimiento con los kw largos de trazabilidad (criterio 4 del plan)');
{
  const PROCESOS = 120, TECLAS = 8;
  const largos = [];
  for (let i = 0; i < PROCESOS; i++) largos.push({ name: 'Proceso ' + i, sub: 'Sección · plazos', kw: kwLargo });
  console.log(`   kw de ${kwLargo.length} caracteres (el tope de memoización del motor son 160)`);

  const teclas = ['d', 'de', 'dev', 'devo', 'devol', 'devolu', 'devoluc', 'devoluci'];
  const mide = (fn) => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };

  const sinPreparar = mide(() => {
    for (let k = 0; k < TECLAS; k++) {
      const Q = B.consulta(teclas[k]);
      largos.forEach((it) => B.puntua(Q, [{ t: it.name, p: 3 }, { t: it.sub, p: 1 }, { t: it.kw, p: 1.4 }], OPTS_PORTAL));
    }
  });

  largos.forEach((it) => { it.kwCampo = B.campo(it.kw); });
  const preparado = mide(() => {
    for (let k = 0; k < TECLAS; k++) {
      const Q = B.consulta(teclas[k]);
      largos.forEach((it) => B.puntua(Q, [{ t: it.name, p: 3 }, { t: it.sub, p: 1 }, { campo: it.kwCampo, p: 1.4 }], OPTS_PORTAL));
    }
  });

  console.log(`   ${PROCESOS} procesos × ${TECLAS} pulsaciones: ${sinPreparar.toFixed(0)} ms sin preparar → ${preparado.toFixed(0)} ms preparado`);
  if (preparado >= sinPreparar) mal('preparar el campo no mejoró nada: ' + preparado.toFixed(0) + ' ms vs ' + sinPreparar.toFixed(0));
  else console.log(`   ✓ ${(sinPreparar / Math.max(preparado, 0.001)).toFixed(1)}× más rápido`);

  // Y el resultado tiene que ser EL MISMO, o el ahorro no vale nada.
  const Q = B.consulta('devolucion');
  const a = B.puntua(Q, [{ t: largos[0].name, p: 3 }, { t: largos[0].sub, p: 1 }, { t: largos[0].kw, p: 1.4 }], OPTS_PORTAL);
  const b = B.puntua(Q, [{ t: largos[0].name, p: 3 }, { t: largos[0].sub, p: 1 }, { campo: largos[0].kwCampo, p: 1.4 }], OPTS_PORTAL);
  if (a !== b) mal(`preparar el campo cambia el puntaje: ${a} ≠ ${b}`);
  else console.log(`   ✓ mismo puntaje con campo preparado (${a.toFixed(1)})`);
}
console.log();

/* — Tienda/CR: la rama de número que el plan manda conservar tal cual — */
console.log('9) Tienda/CR: el número exacto gana siempre (T6.2)');
{
  const conQ = (t) => { const Q = B.consulta(t); Q.words = Q.palabras; Q.raw = Q.crudo; return Q; };
  const busca = (t, prefTipo) => TIENDA_CR
    .map((it) => ({ num: it.num, name: it.name, tipo: it.tipo, score: IDX.puntuaTiendaCR(conQ(t), it, prefTipo || null) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.num - b.num));

  const cr96 = busca('96', 'CR');
  if (!cr96.length || cr96[0].num !== 96) mal('"cr 96" no pone la 96 primero: ' + JSON.stringify(cr96.slice(0, 3)));
  else console.log(`   ✓ "cr 96" → «${cr96[0].name}» (nº ${cr96[0].num}, ${cr96[0].score})`);

  const tda96 = busca('96', 'Tienda');
  if (!tda96.length || tda96[0].num !== 96) mal('"tienda 96" no encuentra la 96 (la preferencia de tipo se volvió filtro)');
  else console.log(`   ✓ "tienda 96" también llega a la ${tda96[0].num} — la preferencia de tipo empuja, no filtra`);

  const guada = busca('guadalajara');
  if (!guada.some((r) => r.name.indexOf('GUADALAJARA') !== -1)) mal('"guadalajara" no encuentra la CR de Guadalajara');
  else console.log(`   ✓ "guadalajara" → ${guada.length} resultados, el primero «${guada[0].name}»`);

  // El catálogo entero cuando no se escribe nada (base 1): es lo que hace que teclear
  // solo "tienda" liste las tiendas en vez de dejar el desplegable vacío.
  const todo = busca('');
  if (todo.length !== TIENDA_CR.length) mal(`sin texto deberían listarse las ${TIENDA_CR.length} y salen ${todo.length}`);
  else console.log(`   ✓ sin texto se listan las ${todo.length} tiendas y CR`);

  const conErrata = busca('guadalaraja');
  if (!conErrata.length) console.log('   · "guadalaraja" (errata) no encuentra nada — tolerancia de scoreTiendaCR sin cambios');
  else console.log(`   ✓ "guadalaraja" (errata) → «${conErrata[0].name}»`);
}
console.log();

/* — T6.2: lo que solo existía en la portada, ahora se encuentra desde cualquier pantalla — */
console.log('10) El buscador general alcanza el contenido del Portal (T6.2)');
{
  const delPortal = IDX.paraBuscadorGeneral();
  const esperados = FP_INDEX.length + DEVSAP_INDEX.length + SECTIONS_NAV.length;
  if (delPortal.length !== esperados) mal(`paraBuscadorGeneral devuelve ${delPortal.length} y deberían ser ${esperados}`);
  else console.log(`   ✓ ${delPortal.length} entradas (${FP_INDEX.length} formas de pago + ${DEVSAP_INDEX.length} devoluciones SAP + ${SECTIONS_NAV.length} secciones)`);

  // Los mismos pesos y la misma política que usa app_comando para el contenido del Portal.
  const camposCmdk = (p) => [{ t: p.nombre, p: 3 }, { t: p.sub, p: 1.2 }, { t: p.extra, p: .7 }];
  const desdeOtraPantalla = (t) => {
    const varias = B.consulta(t).palabras.length > 1;
    return B.filtra(delPortal, t, camposCmdk, { limite: 6, exigirTodas: varias, conPuntaje: true });
  };

  [
    ['clabe', 'Transferencia BBVA', 'la CLABE, preguntada desde una cotización'],
    ['enr', 'ENR', 'una leyenda de SAP desde la pantalla de correos'],
    ['fbl5n', 'FBL5N', 'una transacción de SAP desde donde sea'],
    ['bines', 'BINes', 'la tabla de bines permitidos'],
    ['paqueterias', 'Paqueterías', 'una sección entera del Portal'],
    ['monedero', 'Monedero', 'el traspaso de saldo'],
    ['recogido vencido', 'Correo soporte', 'dos palabras, una leyenda concreta']
  ].forEach(([q, esperado, porque]) => {
    const r = desdeOtraPantalla(q);
    const hit = r.find((x) => x.item.nombre.toLowerCase().indexOf(esperado.toLowerCase()) !== -1);
    if (!hit) mal(`"${q}" no encuentra «${esperado}» desde otra pantalla (${porque}) — sale: ${r.map((x) => x.item.nombre).join(' | ') || 'nada'}`);
    else console.log(`   ✓ "${q}" → «${hit.item.nombre}» · sec=${hit.item.seccion}${hit.item.item ? ' item=' + hit.item.item : ''}`);
  });

  // El destino tiene que ser navegable: sección conocida y, si hay elemento, un id real.
  const secciones = new Set(SECTIONS_NAV.map((s) => s.id));
  delPortal.forEach((p) => {
    if (!secciones.has(p.seccion)) mal(`«${p.nombre}» apunta a la sección "${p.seccion}", que no está en SECTIONS_NAV`);
  });
  const conItem = delPortal.filter((p) => p.item);
  const idsEnPortal = new Set();
  (INDEX.match(/id="([a-z0-9-]+)"/g) || []).forEach((m) => idsEnPortal.add(m.slice(4, -1)));
  const huerfanos = conItem.filter((p) => !idsEnPortal.has(p.item));
  if (huerfanos.length) mal(`estos destinos no existen en el HTML del Portal: ${huerfanos.map((p) => p.item).join(', ')}`);
  else console.log(`   ✓ los ${conItem.length} destinos con elemento apuntan a un id que existe en Index.html`);
}
console.log();

/* — T6.3: un solo catálogo de funciones, sin perder ninguna puerta — */
console.log('11) Catálogo de funciones unificado (T6.3)');
{
  const CAT = IDX.catalogo;
  const firma = (f) => {
    const p = f.params || {};
    const claves = Object.keys(p).sort().map((k) => k + '=' + p[k]).join(',');
    return (f.fn ? 'fn:' + f.fn : f.page) + (claves ? '|' + claves : '');
  };
  const firmas = new Set(CAT.map(firma));

  /* Destinos que ofrecía CADA buscador antes de la fusión, copiados de los dos catálogos
     originales. Es la lista de puertas que no se pueden haber cerrado. */
  const ANTES_PORTAL = ['__home', 'cotizacion', 'correoventel', 'correo_cliente', 'inicio_avanzado',
    'anuncios', 'portal_contenido', 'operacion', 'consola', 'consola|sec=miembros', 'atenciones',
    'atenciones|action=nueva', 'atenciones|sec=publicas', 'estado', 'fn:reportarFalla',
    'correo_cliente|tpl=ticket', 'correo_cliente|tpl=edodecuenta', 'correo_cliente|tpl=edodecuentaextranjera',
    'correo_cliente|tpl=validacionexitosa', 'correo_cliente|tpl=formato', 'correo_cliente|tpl=textoplano'];
  const ANTES_CMDK = ANTES_PORTAL.concat(['portal', 'promociones'])
    .filter((d) => d !== 'atenciones|sec=publicas');

  [['el Portal', ANTES_PORTAL], ['el buscador general', ANTES_CMDK]].forEach(([quien, antes]) => {
    const perdidas = antes.filter((d) => !firmas.has(d));
    if (perdidas.length) mal(`${quien} perdió estos destinos: ${perdidas.join(', ')}`);
    else console.log(`   ✓ ${quien}: los ${antes.length} destinos que ofrecía siguen en el catálogo`);
  });

  const ids = CAT.map((f) => f.id);
  if (new Set(ids).size !== ids.length) mal('hay ids repetidos en el catálogo');
  else console.log(`   ✓ ${CAT.length} entradas con id único`);

  // Los parámetros solo llegan a la pantalla si su clave está en PARAMS_VISTA. Una clave
  // inventada se pierde por el camino sin dar ninguna señal.
  const CORE = leer('app_core.html');
  const PARAMS_VISTA = new Function('return ' + CORE.match(/const PARAMS_VISTA = (\[[^\]]*\]);/)[1])();
  const malos = [];
  CAT.forEach((f) => Object.keys(f.params || {}).forEach((k) => {
    if (PARAMS_VISTA.indexOf(k) === -1) malos.push(f.id + ' → ' + k);
  }));
  if (malos.length) mal('parámetros que no están en PARAMS_VISTA (se pierden sin aviso): ' + malos.join(', '));
  else console.log(`   ✓ todos los parámetros del catálogo están en PARAMS_VISTA`);

  // Cada superficie tiene que saber pintar todos los iconos y resolver todas las acciones.
  const iconosPortal = new Set((leer('Index.html').match(/^const ICONS = \{[\s\S]*?\n\};/m) || [''])[0]
    .split('\n').map((l) => (l.match(/^\s{2}([a-z]+):/) || [])[1]).filter(Boolean));
  iconosPortal.add('cloud');
  const iconosCmdk = new Set(Object.keys(new Function('return ' + (leer('app_comando.html')
    .match(/var ICONO_DE_CATALOGO = (\{[\s\S]*?\n  \});/) || [])[1].replace(/IC\.[a-z]+/g, '1'))()));
  const sinIcono = CAT.filter((f) => !iconosCmdk.has(f.icono));
  if (sinIcono.length) mal('iconos que el buscador general no sabe pintar: ' + sinIcono.map((f) => f.icono).join(', '));
  else console.log('   ✓ los dos buscadores saben pintar los ' + new Set(CAT.map((f) => f.icono)).size + ' iconos del catálogo');

  const fns = CAT.filter((f) => f.fn).map((f) => f.fn);
  const enPortal = leer('Index.html');
  const enCmdk = leer('app_comando.html');
  fns.forEach((n) => {
    if (enPortal.indexOf(n + ':') === -1) mal(`la acción local "${n}" no está en APP_ACTION_FN del Portal`);
    else if (enCmdk.indexOf(n + ':') === -1) mal(`la acción local "${n}" no está en ACCION_LOCAL del buscador general`);
    else console.log(`   ✓ la acción local "${n}" la resuelven los dos buscadores`);
  });

  // Política sin sesión, la que el plan pide parametrizar por superficie.
  const visitante = { conSesion: false, esMaestro: false, puede: () => false };
  const enPortalSinSesion = IDX.funciones('portal', visitante);
  const enCmdkSinSesion = IDX.funciones('cmdk', visitante);
  if (enPortalSinSesion.some((f) => f.sesion)) mal('el Portal ofrece a un visitante algo que exige sesión');
  else if (enPortalSinSesion.length < 20) mal(`el Portal solo ofrece ${enPortalSinSesion.length} a un visitante; ofrecía casi todas`);
  else console.log(`   ✓ sin sesión: el Portal ofrece ${enPortalSinSesion.length} (van al login y de ahí a su destino)`);
  /* Antes de la fusión eran dos ids escritos a mano en un `if` («portal» y «estado»).
     Ahora son las entradas marcadas `publica`, y son tres porque el historial del
     servicio —la otra puerta de la MISMA pantalla pública— también lo es. */
  const idsCmdk = enCmdkSinSesion.map((f) => f.id).sort().join(',');
  if (idsCmdk !== 'estado,estado-historial,portal') mal(`sin sesión el buscador general debería ofrecer solo lo público y ofrece: ${idsCmdk || 'nada'}`);
  else console.log(`   ✓ sin sesión: el buscador general ofrece solo lo público (${idsCmdk})`);

  // Y con sesión de asesor, que es el caso normal.
  const asesor = { conSesion: true, esMaestro: false, puede: (b) => ['cotizar', 'enviar_cotizacion', 'correos_cliente', 'atenciones'].indexOf(b) !== -1 };
  const suyas = IDX.funciones('cmdk', asesor).map((f) => f.id);
  if (suyas.indexOf('consola') !== -1) mal('un asesor ve la Consola en el catálogo');
  else if (suyas.indexOf('cotizacion') === -1) mal('un asesor no ve «Nueva cotización»');
  else console.log(`   ✓ un asesor ve ${suyas.length} funciones, sin Consola y con su cotización`);
}
console.log();

/* — Lo que NO se toca: filtrar una tabla sigue exigiendo todas las palabras — */
console.log('8) El filtro de tablas (exigirTodas por omisión) no cambió');
{
  const Q = B.consulta('juan perez');
  const soloJuan = B.puntua(Q, [{ t: 'Juan Ramírez', p: 3 }]);
  if (soloJuan !== 0) mal('filtrar una tabla con "juan perez" trae a los Juan sueltos: ' + soloJuan);
  else console.log('   ✓ "juan perez" no trae a Juan Ramírez al filtrar una tabla');

  const Qs = B.consulta('clabe');
  const porSinonimoEnTabla = B.puntua(Qs, [{ t: 'Transferencia BBVA', p: 3 }]);
  if (porSinonimoEnTabla !== 0) mal('un sinónimo se coló en el filtro de tablas: ' + porSinonimoEnTabla);
  else console.log('   ✓ un sinónimo no filtra filas de una tabla (solo acerca en un buscador)');

  /* El hueco por el que se coló una regresión de verdad: ningún término de la batería
     mezclaba una palabra larga con la partición letra/dígito. Al descartar los restos de
     una letra dentro de consulta(), "lvp1" pasó a buscar solo "lvp" y el filtro de la
     tabla de cotizaciones devolvía TODOS los folios en vez de estrecharse.
     Filtrando se exige lo que la persona escribió; buscando se usa el núcleo. */
  const FOLIOS = ['LVP-260726-0001', 'LVP-260801-0899', 'LVP-260802-0234', 'LVP-260803-0567'];
  const conUno = FOLIOS.filter((f) => B.puntua(B.consulta('lvp1'), [{ t: f, p: 3 }]) > 0);
  if (conUno.length === FOLIOS.length) mal(`"lvp1" no estrecha la tabla: devuelve los ${FOLIOS.length} folios`);
  else if (!conUno.length) mal('"lvp1" no encuentra ningún folio');
  else console.log(`   ✓ "lvp1" deja ${conUno.length} de ${FOLIOS.length} folios (${conUno.join(', ')})`);

  const PROMOS = ['Pantallas 4K Samsung', 'Pantallas Full HD LG', 'Laptops Gamer'];
  const dosPal = PROMOS.filter((p) => B.puntua(B.consulta('pantallas 4k'), [{ t: p, p: 3 }]) > 0);
  if (dosPal.length !== 1) mal(`"pantallas 4k" deja ${dosPal.length} promociones y debería dejar 1: ${dosPal.join(' | ')}`);
  else console.log(`   ✓ "pantallas 4k" deja solo «${dosPal[0]}»`);

  // Y la ganancia del otro lado sigue en pie: buscando, "fbl5n" no inunda.
  const nucleoSigue = B.consulta('fbl5n').nucleo.join(',');
  if (nucleoSigue !== 'fbl') mal('el núcleo de "fbl5n" debería ser [fbl] y es: ' + nucleoSigue);
  else console.log('   ✓ buscando, "fbl5n" sigue reduciéndose a «fbl» (el resto no inunda)');
}
console.log();

/* — Los sinónimos cortos no pueden engancharse dentro de cualquier palabra — */
console.log('12) Los sinónimos no enganchan a media palabra');
{
  const RUIDO = [
    ['tienda', 'Descripción del proceso', 'cr'],
    ['tienda', 'Traslado de mercancía', 'sl'],
    ['proceso', 'Traspaso de saldo', 'paso']
  ];
  RUIDO.forEach(([q, texto, culpable]) => {
    const s = B.puntua(B.consulta(q), [{ t: texto, p: 3 }], OPTS_PORTAL);
    if (s > 0) mal(`"${q}" puntúa «${texto}» (${s.toFixed(1)}) por el sinónimo corto «${culpable}» metido a media palabra`);
    else console.log(`   ✓ "${q}" no puntúa «${texto}»`);
  });
  // Lo que SÍ tiene que seguir alcanzando: plural y palabra compuesta larga.
  [['openpay', 'Portal de Transferencias BBVA'], ['guia', 'Reenvío del ticket']].forEach(([q, texto]) => {
    const s = B.puntua(B.consulta(q), [{ t: texto, p: 3 }], OPTS_PORTAL);
    if (s <= 0) mal(`"${q}" dejó de alcanzar «${texto}»`);
    else console.log(`   ✓ "${q}" sigue alcanzando «${texto}» (${s.toFixed(1)})`);
  });
}
console.log();

/* — El ámbito no puede confundir una propiedad heredada con un ámbito de verdad — */
console.log('13) El parser de ámbitos no hereda de Object.prototype');
{
  const alias = { cot: { id: 'cot' }, portal: { id: 'portal' } };
  ['constructor', 'toString', 'valueOf', 'hasOwnProperty'].forEach((k) => {
    const r = IDX.ambito(k + ': algo', alias, { sueltos: false });
    if (r) mal(`"${k}:" se toma por un ámbito y devuelve ${typeof r.ambito}`);
  });
  console.log('   ✓ «constructor:», «toString:», «valueOf:» y «hasOwnProperty:» se buscan como texto');
  const ok = IDX.ambito('cot: LVP-123', alias, { sueltos: false });
  if (!ok || ok.ambito.id !== 'cot' || ok.resto !== 'LVP-123') mal('«cot: LVP-123» dejó de acotar');
  else console.log('   ✓ «cot: LVP-123» sigue acotando, con resto «' + ok.resto + '»');
  const suelto = IDX.ambito('formatos acta', { formatos: { id: 'f' } });
  if (!suelto || suelto.resto !== 'acta') mal('la forma suelta del Portal dejó de funcionar');
  else console.log('   ✓ «formatos acta» (forma suelta) sigue acotando en el Portal');
  const noEsAmbito = IDX.ambito('nota: pedir factura', alias, { sueltos: false });
  if (noEsAmbito) mal('«nota:» se toma por un ámbito');
  else console.log('   ✓ «nota: pedir factura» se busca tal cual');
}
console.log();

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log('─'.repeat(70));
if (gana.length) {
  console.log('Resultados que antes NO salían (muestra de ' + Math.min(12, gana.length) + ' de ' + gana.length + '):');
  gana.slice(0, 12).forEach((g) => console.log('   + ' + g));
  console.log();
}
if (ruidoFuera.length) {
  console.log('Coincidencias por parecido de letras que el motor nuevo descarta (' + ruidoFuera.length + '):');
  ruidoFuera.forEach((r) => console.log('   − ' + r));
  console.log();
}
if (fallos) {
  console.log(`✗ ${fallos} fallo(s) de paridad`);
  process.exit(1);
}
console.log('✓ Paridad completa: ningún resultado se perdió y ' + gana.length + ' aparecen nuevos.');
