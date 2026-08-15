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
const FP_INDEX = extraeLiteral(INDEX, 'FP_INDEX');
const DEVSAP_INDEX = extraeLiteral(INDEX, 'DEVSAP_INDEX');
const SECTIONS_NAV = extraeLiteral(INDEX, 'SECTIONS_NAV');
const APP_ACTIONS = extraeLiteral(INDEX, 'APP_ACTIONS');
const TIENDA_CR_RAW = extraeLiteral(INDEX, 'TIENDA_CR_RAW');

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
