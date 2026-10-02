/*
 * F4 · PICOS DE EJECUCIONES SIMULTÁNEAS, leídos del panel «Ejecuciones» de Apps Script.
 *
 * El cupo: 30 ejecuciones simultáneas POR USUARIO. Con executeAs: USER_DEPLOYING, todo lo que corre como la
 * cuenta dueña compite por las mismas 30: el Portal (producción y pruebas), sus activadores y cualquier otro
 * proyecto de esa cuenta.
 *
 * Por qué el panel y no la API `processes`: es la misma información, pero Google bloquea al cliente de clasp
 * cuando pide el alcance script.processes («Esta aplicación está bloqueada», 01/10/2026). Y un contador dentro
 * del Portal costaría en cada llamada y perdería cuentas justo en el pico.
 *
 * Dos listas, porque ninguna basta sola:
 *   · «Mis ejecuciones» (script.google.com/home/executions): lo que corre TU cuenta en todos los proyectos.
 *     NO trae lo que los asesores ejecutan en las webapps, aunque corra como tú.
 *   · «Ejecuciones» de un proyecto (…/home/projects/<id>/executions): todo lo de ese proyecto, de quien sea.
 * analizar() suma la primera más lo que la segunda trae de otras personas.
 *
 * Límites de lo que mide:
 *   · El panel guarda 7 días.
 *   · La hora de inicio viene al segundo: el máximo se da con cotas (inferior/superior). El real está entre ellas.
 *   · Las webapps de OTROS proyectos que usen otras personas solo se ven en su propio panel: léelas también
 *     con leer('proyecto') en cada una, si las hay con uso.
 *
 * Uso, en la consola del navegador con tu sesión (o con la herramienta de navegador, por partes):
 *   1. Abre «Mis ejecuciones», pega este archivo y ejecuta:            await F4.leer('cuenta')
 *   2. Abre las «Ejecuciones» del proyecto, pega este archivo y:       await F4.leer('proyecto')
 *      leer() trabaja como mucho `presupuestoMs` (25 s) y devuelve su avance: si no dice fin:true, vuelve a
 *      llamarla SIN recargar la página y sigue donde iba. Lo leído vive en sessionStorage (mismo origen), así
 *      que sobrevive al cambio de página.
 *   3. En cualquiera de las dos pestañas:                             F4.analizar()
 *   4. Al terminar:                                                    F4.limpiar()
 * En Node, la autoprueba de la matemática:  node scripts/laboratorio/picos-panel.js --autoprueba
 */
(function (raiz) {
  'use strict';
  const ZONA = 'America/Mexico_City';
  const CUPO = 30;
  const VENTANA_MS = 5 * 60 * 1000;

  // ── Interpretar el panel ────────────────────────────────────────────────────────────────────────
  const MES = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sept: 8, sep: 8, oct: 9, nov: 10, dic: 11 };
  /** «1 oct 2026, 15:42:47» (hora local del navegador) → ms. */
  function aMs(s) {
    const m = /^(\d{1,2}) ([a-zñ]+)\.? (\d{4}), (\d{1,2}):(\d{2}):(\d{2})$/i.exec(String(s || '').trim());
    if (!m) return null;
    const mes = MES[m[2].toLowerCase()];
    if (mes === undefined) return null;
    return new Date(+m[3], mes, +m[1], +m[4], +m[5], +m[6]).getTime();
  }
  /** «8.208 s», «950 ms», «1.2 min» → ms. */
  function durMs(s) {
    const m = /^([\d.,]+) (ms|s|min)$/.exec(String(s || '').trim());
    if (!m) return null;
    const v = parseFloat(m[1].replace(',', '.'));
    return Math.round(m[2] === 'ms' ? v : m[2] === 'min' ? v * 60000 : v * 1000);
  }
  /** Las celdas traen el glifo de un icono (área de uso privado, p. ej. U+E5D4) y un «Se está cargando…». */
  function limpio(s) {
    return String(s || '').replace(/[-]/g, '').replace(/Se está cargando.*$/, '').replace(/\s+/g, ' ').trim();
  }

  // ── La matemática (la cubre la autoprueba) ──────────────────────────────────────────────────────
  /** +1 al empezar, −1 al terminar; a la misma hora, los finales primero: dos que se tocan no se solapan. */
  function barrer(intervalos) {
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
  function tiempoEnOMas(tramos, n) {
    let ms = 0;
    for (const [a, b, nivel] of tramos) if (nivel >= n) ms += b - a;
    return ms;
  }
  function maxPorVentana(tramos, ventanaMs) {
    const v = new Map();
    for (const [a, b, nivel] of tramos) {
      for (let w = Math.floor(a / ventanaMs); w <= Math.floor((b - 1) / ventanaMs); w++) {
        const k = w * ventanaMs;
        if ((v.get(k) || 0) < nivel) v.set(k, nivel);
      }
    }
    return v;
  }
  /** Tramos ordenados y sin solaparse (los da barrer): búsqueda binaria. */
  function nivelEn(tramos, t) {
    let lo = 0, hi = tramos.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, [a, b, nivel] = tramos[mid];
      if (t < a) hi = mid - 1;
      else if (t >= b) lo = mid + 1;
      else return nivel;
    }
    return 0;
  }
  /**
   * Con el inicio al segundo, cada ejecución empezó en algún momento de [s, s+1) y terminó d después.
   *   inferior: [s+1, s+d]   (lo que seguro estuvo corriendo)
   *   central:  [s+0.5, s+0.5+d]
   *   superior: [s, s+d+1]   (lo que pudo estar corriendo)
   */
  function cotas(ej) {
    return {
      inferior: barrer(ej.map((e) => ({ ini: e.ini + 1000, fin: e.ini + e.ms }))),
      central: barrer(ej.map((e) => ({ ini: e.ini + 500, fin: e.ini + 500 + e.ms }))),
      superior: barrer(ej.map((e) => ({ ini: e.ini, fin: e.ini + e.ms + 1000 })))
    };
  }

  // ── Leer el panel (navegador) ───────────────────────────────────────────────────────────────────
  const CLAVE = (tipo) => '__f4_' + tipo;
  function guardado(tipo) {
    try { return JSON.parse(sessionStorage.getItem(CLAVE(tipo)) || 'null'); } catch (e) { return null; }
  }
  function clic(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  }
  const filasDom = () => [...document.querySelectorAll('tr')].filter((t) => t.querySelectorAll('td').length >= 6);
  const firma = () => { const f = filasDom()[0]; return f ? f.textContent.slice(0, 200) : ''; };
  async function esperarCambio(antes) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const a = firma();
      if (a && a !== antes) return true;
    }
    return false;
  }
  const boton = (aria) => document.querySelector('[role="button"][aria-label="' + aria + '"]');
  const apagado = (b) => !b || b.getAttribute('aria-disabled') === 'true';

  /**
   * Lee el panel de la pestaña, página a página. tipo: 'cuenta' («Mis ejecuciones») o 'proyecto'.
   * @param {{presupuestoMs?:number, desdeCero?:boolean}} [opc]
   */
  async function leer(tipo, opc) {
    opc = opc || {};
    if (tipo !== 'cuenta' && tipo !== 'proyecto') throw new Error("tipo: 'cuenta' o 'proyecto'");
    let est = opc.desdeCero ? null : guardado(tipo);
    if (!est || est.fin) {
      est = { tipo, proyecto: tipo === 'proyecto' ? document.title.split(' - ')[0].trim() : '', P: [], F: [], T: [], E: [], filas: [], paginas: 0, fin: false, malas: 0 };
      const primera = boton('Ir a la primera página');
      if (!apagado(primera)) { const a = firma(); clic(primera); await esperarCambio(a); }
    }
    const idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
    const vistas = new Set(est.filas.map((f) => f.join('|')));
    const t0 = Date.now(), presupuesto = opc.presupuestoMs || 25000;
    while (Date.now() - t0 < presupuesto) {
      for (const tr of filasDom()) {
        const c = [...tr.querySelectorAll('td')].map((td) => limpio(td.textContent));
        const proy = tipo === 'cuenta' ? c[0] : est.proyecto;
        const ini = aMs(c[3]), ms = durMs(c[4]);
        if (ini === null || ms === null) { est.malas++; continue; }
        const fila = [idx(est.P, proy), idx(est.F, c[1]), idx(est.T, c[2]), idx(est.E, c[5]), Math.round(ini / 1000), ms];
        const k = fila.join('|');
        if (vistas.has(k)) continue;
        vistas.add(k);
        est.filas.push(fila);
      }
      est.paginas++;
      const sig = boton('Ir a la página siguiente');
      if (apagado(sig)) { est.fin = true; break; }
      const a = firma();
      clic(sig);
      if (!(await esperarCambio(a))) { est.atascada = true; break; }
    }
    est.leido = Date.now();
    sessionStorage.setItem(CLAVE(tipo), JSON.stringify(est));
    const ult = est.filas[est.filas.length - 1];
    return { tipo, fin: est.fin, paginas: est.paginas, filas: est.filas.length, malas: est.malas, atascada: !!est.atascada,
      hasta: ult ? new Date(ult[4] * 1000).toLocaleString('es-MX', { timeZone: ZONA }) : null };
  }

  /** Las filas de un guardado como objetos. */
  function ejecuciones(est) {
    return est.filas.map((f) => ({ proy: est.P[f[0]], fn: est.F[f[1]], tipo: est.T[f[2]], estado: est.E[f[3]], ini: f[4] * 1000, ms: f[5] }));
  }

  /**
   * Junta lo que haya: la cuenta, más lo que el proyecto trae de OTRAS personas (lo que no está en la cuenta).
   * Con una sola lista, analiza esa. Puede recibir las listas ya hechas (para la autoprueba).
   */
  function analizar(listas) {
    const c = listas ? listas.cuenta : guardado('cuenta');
    const p = listas ? listas.proyecto : guardado('proyecto');
    let todas = [], deOtras = 0;
    const cuenta = c ? ejecuciones(c) : [];
    todas = todas.concat(cuenta);
    if (p) {
      const proy = ejecuciones(p);
      const nombre = p.proyecto || (proy[0] && proy[0].proy) || '';
      const enCuenta = new Set(cuenta.filter((e) => e.proy === nombre).map((e) => e.fn + '|' + e.ini + '|' + e.ms));
      const otras = proy.filter((e) => !enCuenta.has(e.fn + '|' + e.ini + '|' + e.ms));
      deOtras = otras.length;
      todas = todas.concat(c ? otras.map((e) => Object.assign({}, e, { proy: e.proy + ' (otras personas)' })) : proy);
    }
    if (!todas.length) return { error: 'No hay nada leído: usa F4.leer(...) primero.' };
    const hora = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const loc = (ms) => hora.format(new Date(ms));
    const k = cotas(todas);
    const m = k.central;
    const enMax = {};
    for (const e of todas) if (e.ini + 500 <= m.tMax && e.ini + 500 + e.ms > m.tMax) enMax[e.proy] = (enMax[e.proy] || 0) + 1;
    const porProy = {};
    for (const e of todas) {
      const q = porProy[e.proy] = porProy[e.proy] || { n: 0, errores: 0, min: 0 };
      q.n++;
      if (e.estado !== 'Completada') q.errores++;
      q.min += e.ms / 60000;
    }
    Object.values(porProy).forEach((q) => { q.min = Math.round(q.min); });
    const errores = todas.filter((e) => e.estado !== 'Completada')
      .map((e) => ({ cuando: loc(e.ini), proy: e.proy, fn: e.fn, estado: e.estado, s: e.ms / 1000, nivelAlEmpezar: nivelEn(m.tramos, e.ini + 500) }))
      .sort((a, b) => b.nivelAlEmpezar - a.nivelAlEmpezar);
    let primero = Infinity, ultimo = -Infinity;
    for (const e of todas) { if (e.ini < primero) primero = e.ini; if (e.ini > ultimo) ultimo = e.ini; }
    const vent = [...maxPorVentana(m.tramos, VENTANA_MS).entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    return {
      ejecuciones: todas.length, deOtrasPersonas: deOtras, desde: loc(primero), hasta: loc(ultimo), cupo: CUPO,
      maxSimultaneas: { inferior: k.inferior.max, central: m.max, superior: k.superior.max },
      cuando: m.tMax !== null ? loc(m.tMax) : null, enElMaximo: enMax,
      segundosConNoMas: Object.fromEntries([5, 8, 10, 15, 20, 25, 30].map((n) => [n, Math.round(tiempoEnOMas(m.tramos, n) / 1000)])),
      picos5min: vent.slice(0, 8).map(([t, n]) => ({ ventana: loc(t), max: n })),
      porProyecto: porProy,
      errores: errores.slice(0, 15), erroresTotal: errores.length
    };
  }

  function limpiar() {
    ['cuenta', 'proyecto'].forEach((t) => { try { sessionStorage.removeItem(CLAVE(t)); } catch (e) {} });
    return 'borrado';
  }

  // ── Autoprueba (Node) ───────────────────────────────────────────────────────────────────────────
  function autoprueba() {
    let total = 0, fallos = 0;
    const ok = (n, c, x) => { total++; if (c) { console.log('  ✔ ' + n); return; } fallos++; console.log('  ✖ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); };
    ok('«1 oct 2026, 15:42:47» → la hora local', new Date(aMs('1 oct 2026, 15:42:47')).getHours() === 15 && new Date(aMs('1 oct 2026, 15:42:47')).getDate() === 1);
    ok('«29 sept 2026, 9:50:57» (sept con t, hora de una cifra)', new Date(aMs('29 sept 2026, 9:50:57')).getMonth() === 8);
    ok('un texto que no es fecha → null', aMs('ayer') === null && aMs('1 xyz 2026, 1:00:00') === null);
    ok('«8.208 s» → 8208 · «950 ms» → 950 · «1.5 min» → 90000', durMs('8.208 s') === 8208 && durMs('950 ms') === 950 && durMs('1.5 min') === 90000);
    ok('«Completada» + glifo U+E5D4 → «Completada»', limpio('Completada') === 'Completada');
    ok('…y sin el «Se está cargando…» de la celda', limpio('CompletadaSe está cargando el component') === 'Completada');
    let b = barrer([{ ini: 0, fin: 10 }, { ini: 5, fin: 15 }, { ini: 10, fin: 20 }]);
    ok('tres en cadena → máximo 2 y tramos [0,5)=1 [5,10)=2 [10,15)=2 [15,20)=1', b.max === 2 && JSON.stringify(b.tramos) === '[[0,5,1],[5,10,2],[10,15,2],[15,20,1]]', b);
    ok('dos que se tocan no son simultáneas', barrer([{ ini: 0, fin: 10 }, { ini: 10, fin: 20 }]).max === 1);
    b = barrer(Array.from({ length: 30 }, (_, i) => ({ ini: 1000 + i, fin: 5000 })));
    ok('30 a la vez → 30, y el tiempo con 30 o más es el tramo común', b.max === 30 && tiempoEnOMas(b.tramos, 30) === 3971 && tiempoEnOMas(b.tramos, 31) === 0);
    const w = maxPorVentana([[290000, 310000, 3], [610000, 620000, 5]], 300000);
    ok('un tramo que cruza el borde de una ventana cuenta en las dos', w.get(0) === 3 && w.get(300000) === 3 && w.get(600000) === 5 && w.size === 3);
    ok('nivel en un instante (búsqueda binaria)', nivelEn([[0, 5, 1], [5, 10, 2], [12, 20, 1]], 5) === 2 && nivelEn([[0, 5, 1], [12, 20, 1]], 7) === 0 && nivelEn([[0, 5, 1], [12, 20, 1]], 19) === 1);
    // Cotas: dos que arrancan en el mismo segundo y duran 0.4 s pueden no haberse tocado nunca.
    const k = cotas([{ ini: 0, ms: 400 }, { ini: 0, ms: 400 }]);
    ok('cotas: dos de 0.4 s en el mismo segundo → inferior 0, superior 2', k.inferior.max === 0 && k.superior.max === 2, [k.inferior.max, k.central.max, k.superior.max]);
    // analizar: la cuenta + lo del proyecto que no está en la cuenta.
    const t = Math.round(Date.parse('2026-09-29T15:50:57Z') / 1000);
    const cuenta = { P: ['Portal', 'Otro'], F: ['doGet', 'reloj'], T: ['Aplicación web', 'A partir del tiempo'], E: ['Completada'], filas: [[0, 0, 0, 0, t, 3000], [1, 1, 1, 0, t, 1500]] };
    const proyecto = { proyecto: 'Portal', P: ['Portal'], F: ['doGet', 'fetchX'], T: ['Aplicación web'], E: ['Completada', 'Error'], filas: [[0, 0, 0, 0, t, 3000], [0, 1, 0, 1, t + 1, 0], [0, 0, 0, 0, t + 1, 2000]] };
    const a = analizar({ cuenta, proyecto });
    ok('analizar: la del dueño no se cuenta dos veces (4 en total, 2 de otras personas)', a.ejecuciones === 4 && a.deOtrasPersonas === 2, a);
    ok('analizar: máximo central 3 y superior 4', a.maxSimultaneas.central === 3 && a.maxSimultaneas.superior === 4, a.maxSimultaneas);
    ok('analizar: el error, con su nivel al empezar', a.erroresTotal === 1 && a.errores[0].fn === 'fetchX' && a.errores[0].proy === 'Portal (otras personas)', a.errores);
    ok('analizar: sin nada leído, lo dice', /leer/.test(analizar({ cuenta: null, proyecto: null }).error));
    console.log(fallos ? '✖ ' + fallos + ' de ' + total + ' fallaron' : '✔ ' + total + ' comprobaciones en verde');
    return fallos;
  }

  const F4 = { leer, analizar, limpiar, autoprueba, _: { aMs, durMs, limpio, barrer, tiempoEnOMas, maxPorVentana, nivelEn, cotas } };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = F4;
    if (typeof require !== 'undefined' && require.main === module && process.argv.includes('--autoprueba')) process.exit(autoprueba() ? 1 : 0);
  } else {
    raiz.F4 = F4;
  }
})(typeof window !== 'undefined' ? window : globalThis);
