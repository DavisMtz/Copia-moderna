// Análisis de la investigación del 04/10/2026 (puntos 1 y 2). Va después del banco inv2 y con
// window.__inv2 ya lleno. NADA de esto es la extensión: es laboratorio.
(function () {
  var VM = window.VentelVM, R = window.VENTEL_REGLAS;
  function aItem(p) { return { id: p.id, marca: p.marca, nombre: p.nombre, precio: p.precio }; }
  function prom(arr, f) { var v = arr.map(f).filter(function (x) { return typeof x === 'number' && isFinite(x); }); return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length * 100) / 100 : null; }

  // id → lo que Liverpool sabe de él (de los carruseles y de las búsquedas)
  function info() {
    var m = {};
    Object.keys(__inv2.fichas).forEach(function (q) { var f = __inv2.fichas[q]; if (!f.stream) return;
      Object.keys(f.stream).forEach(function (k) { f.stream[k].forEach(function (p) {
        m[p.id] = Object.assign(m[p.id] || {}, { cal: p.cal, nOp: p.nOp, mkp: p.mkp, mainCat: p.mainCat, cats: p.cats, desc: p.desc, vendedor: p.vendedor }); }); }); });
    Object.keys(__inv2.busquedas).forEach(function (q) { (__inv2.busquedas[q].recs || []).forEach(function (r) { var a = m[r.id] || {};
      m[r.id] = Object.assign(a, { cal: r.cal, nOp: r.nOp, mkp: r.mkp, patroc: r.patroc, online: r.online, mainCat: a.mainCat || (r.carrCats && r.carrCats[r.carrCats.length - 1]) || r.mainCat, vendedor: r.vendedor }); }); });
    return m;
  }
  window.__info2 = info;
  // Lo que lee HOY la extensión de una búsqueda: las 16 primeras tarjetas, en el orden del DOM.
  function busqItems(q, todos) { var b = __inv2.busquedas[q]; if (!b) return null; var porId = {}; b.recs.forEach(function (r) { porId[r.id] = r; });
    return (todos ? b.recs : b.dom.map(function (id) { return porId[id]; })).filter(Boolean).map(aItem); }
  function carruselesExt(f) { var s = f.stream || {};
    return { complementa: (s.complementa || []).map(aItem), otros: (s.otros || []).map(aItem), relacionados: (s.relacionados || []).map(aItem), masVendidos: (s.masVendidos || []).map(aItem) }; }
  window.__carExt = carruselesExt; window.__busqItems = busqItems;

  /** Las consultas que pide el plan de cada ficha y que aún no se han buscado. */
  window.__planesV2 = function () {
    var faltan = [];
    Object.keys(__inv2.fichas).forEach(function (q) { var f = __inv2.fichas[q]; if (!f.ficha) return;
      var m = VM.recomendar(f.ficha, carruselesExt(f), null, R, Date.now());
      (m.busquedas || []).forEach(function (b) { if (!__inv2.busquedas[b.consulta] && faltan.indexOf(b.consulta) < 0) faltan.push(b.consulta); }); });
    return faltan;
  };

  function bayes(x, m, C) { var n = (x && x.nOp) || 0, a = (x && x.cal) || 0; return (C * m + a * n) / (C + n); }

  /** Punto 2: la elección de hoy frente a una que pondera calificación, vendedor, patrocinio y existencia. */
  window.__p2 = function (opc) {
    opc = opc || {}; var m0 = opc.m == null ? 4.2 : opc.m, C = opc.C == null ? 5 : opc.C, bonus1P = opc.bonus1P == null ? 0.15 : opc.bonus1P, todos = !!opc.todos;
    var I = info(), filas = [];
    Object.keys(__inv2.fichas).forEach(function (q) {
      var f = __inv2.fichas[q]; if (!f.ficha) return;
      var ctx = VM.contexto(f.ficha, R); if (!ctx.clase) return;
      var car = carruselesExt(f), excluir = {};
      car.relacionados.forEach(function (r) { excluir[r.id] = true; });
      var listas = [{ origen: 'complementa', items: car.complementa }, { origen: 'otros', items: car.otros }];
      var plan = VM.planDeBusquedas(ctx, VM.mejorPorTipo(VM.candidatos(listas, ctx, R, excluir), ctx), 2);
      plan.forEach(function (b) { var its = busqItems(b.consulta, todos); if (its) listas.push({ origen: 'busqueda', items: its, tipoBuscado: b.tipo, consulta: b.consulta }); });
      var cruz = VM.elegirCruzada(listas, ctx, R, { maximo: 3, excluir: excluir });
      var cands = VM.candidatos(listas, ctx, R, excluir);
      cruz.forEach(function (rec) {
        var mismos = cands.filter(function (c) { return c.tipo === rec.tipo; });
        var nivel = rec.compat === 'exacto' ? mismos.filter(function (c) { return c.compat === 'exacto'; }) : mismos.filter(function (c) { return c.compat !== 'familia'; });
        var puntua = function (c) { var x = I[c.id] || {}; return bayes(x, m0, C) + (x.mkp ? 0 : bonus1P) - (x.patroc ? 0.5 : 0) - (x.online === false ? 1 : 0); };
        var alt = nivel.slice().sort(function (a, b) { return (puntua(b) - puntua(a)) || (a.orden - b.orden); })[0] || rec;
        var ic = I[rec.id] || {}, ia = I[alt.id] || {};
        filas.push({ q: q, clase: ctx.clase.id, tipo: rec.tipo, n: nivel.length, cambia: alt.id !== rec.id,
          cur: { id: rec.id, nombre: rec.nombre.slice(0, 42), precio: rec.precio, cal: ic.cal, nOp: ic.nOp, mkp: !!ic.mkp, patroc: !!ic.patroc, online: ic.online, origen: rec.origen },
          alt: { id: alt.id, nombre: alt.nombre.slice(0, 42), precio: alt.precio, cal: ia.cal, nOp: ia.nOp, mkp: !!ia.mkp, patroc: !!ia.patroc, online: ia.online, origen: alt.origen } });
      });
    });
    var conOpcion = filas.filter(function (r) { return r.n >= 2; }), cambian = conOpcion.filter(function (r) { return r.cambia; });
    window.__p2filas = filas;
    var ej = function (r) { return r.q + ' · ' + r.tipo + ': ' + r.cur.nombre + ' $' + r.cur.precio + ' ★' + r.cur.cal + '(' + r.cur.nOp + ')' + (r.cur.mkp ? ' MKP' : '') + (r.cur.patroc ? ' PATROC' : '') +
      '  →  ' + r.alt.nombre + ' $' + r.alt.precio + ' ★' + r.alt.cal + '(' + r.alt.nOp + ')' + (r.alt.mkp ? ' MKP' : ''); };
    return { parametros: { m: m0, C: C, bonus1P: bonus1P, todos: todos },
      recomendaciones: filas.length, conOpcion: conOpcion.length, cambian: cambian.length,
      hoy: { calPromConOpiniones: prom(conOpcion, function (r) { return r.cur.nOp > 0 ? r.cur.cal : null; }), sinOpiniones: conOpcion.filter(function (r) { return !r.cur.nOp; }).length,
        marketplace: conOpcion.filter(function (r) { return r.cur.mkp; }).length, patrocinadas: filas.filter(function (r) { return r.cur.patroc; }).length, sinExistenciaEnLinea: filas.filter(function (r) { return r.cur.online === false; }).length },
      alternativa: { calPromConOpiniones: prom(conOpcion, function (r) { return r.alt.nOp > 0 ? r.alt.cal : null; }), sinOpiniones: conOpcion.filter(function (r) { return !r.alt.nOp; }).length,
        marketplace: conOpcion.filter(function (r) { return r.alt.mkp; }).length },
      enLosCambios: { opinionesHoy: prom(cambian, function (r) { return r.cur.nOp || 0; }), opinionesAlt: prom(cambian, function (r) { return r.alt.nOp || 0; }),
        precioAltSobreHoy: prom(cambian, function (r) { return r.cur.precio ? r.alt.precio / r.cur.precio : null; }) },
      ejemplos: cambian.slice(0, 30).map(ej) };
  };

  /** Punto 2: patrocinados, marketplace, existencia y opiniones en TODAS las búsquedas reunidas. */
  window.__p2b = function () {
    var o = { consultas: 0, registros: 0, patroc: 0, consultasConPatroc: 0, patrocEnLas16: 0, mkp: 0, sinOnline: 0, conOpiniones: 0, conDescuento: 0 };
    Object.keys(__inv2.busquedas).forEach(function (q) { var b = __inv2.busquedas[q]; o.consultas++; var hay = false, top = {};
      (b.dom || []).forEach(function (id) { top[id] = 1; });
      (b.recs || []).forEach(function (r) { o.registros++; if (r.patroc) { o.patroc++; hay = true; if (top[r.id]) o.patrocEnLas16++; } if (r.mkp) o.mkp++; if (r.online === false) o.sinOnline++; if (r.nOp > 0) o.conOpiniones++; if (r.lista && r.precio && r.precio < r.lista) o.conDescuento++; });
      if (hay) o.consultasConPatroc++; });
    var car = { productos: 0, conOpiniones: 0, mkp: 0, conDescuento: 0 };
    Object.keys(__inv2.fichas).forEach(function (q) { var f = __inv2.fichas[q]; if (!f.stream) return; ['complementa', 'otros', 'relacionados'].forEach(function (k) { (f.stream[k] || []).forEach(function (p) { car.productos++; if (p.nOp > 0) car.conOpiniones++; if (p.mkp) car.mkp++; if (p.desc) car.conDescuento++; }); }); });
    o.carruseles = car;
    return o;
  };

  /** Punto 2: ¿la categoría de Liverpool confirma el tipo que da el nombre? (carruseles complementa + otros) */
  window.__p2c = function () {
    var porTipo = {}, items = [];
    Object.keys(__inv2.fichas).forEach(function (q) { var f = __inv2.fichas[q]; if (!f.ficha || !f.stream) return;
      var ctx = VM.contexto(f.ficha, R); if (!ctx.clase) return;
      ['complementa', 'otros'].forEach(function (k) { (f.stream[k] || []).forEach(function (p) {
        var t = VM.tipoDe(p, ctx.clase), key = ctx.clase.id + '/' + (t.conocido ? t.tipo : '?');
        (porTipo[key] = porTipo[key] || {})[p.mainCat] = ((porTipo[key] || {})[p.mainCat] || 0) + 1;
        items.push({ q: q, clase: ctx.clase.id, tipo: t.conocido ? t.tipo : '?', mainCat: p.mainCat, nombre: p.nombre.slice(0, 50) }); }); }); });
    // categoría dominante de cada tipo conocido
    var moda = {};
    Object.keys(porTipo).forEach(function (k) { if (/\/\?$/.test(k)) return; var c = porTipo[k], best = null, tot = 0;
      Object.keys(c).forEach(function (cat) { tot += c[cat]; if (!best || c[cat] > c[best]) best = cat; }); moda[k] = { cat: best, pureza: Math.round(c[best] / tot * 100), n: tot }; });
    var catsConocidas = {}; Object.keys(moda).forEach(function (k) { var cl = k.split('/')[0]; (catsConocidas[cl] = catsConocidas[cl] || {})[moda[k].cat] = k.split('/')[1]; });
    var dudosos = items.filter(function (x) { return x.tipo !== '?' && moda[x.clase + '/' + x.tipo] && moda[x.clase + '/' + x.tipo].n >= 3 && x.mainCat !== moda[x.clase + '/' + x.tipo].cat; });
    var perdidos = items.filter(function (x) { return x.tipo === '?' && catsConocidas[x.clase] && catsConocidas[x.clase][x.mainCat]; });
    var conocidos = items.filter(function (x) { return x.tipo !== '?'; });
    return { items: items.length, conTipo: conocidos.length, sinTipo: items.length - conocidos.length,
      purezaMedia: prom(Object.keys(moda).filter(function (k) { return moda[k].n >= 3; }), function (k) { return moda[k].pureza; }),
      tiposConMasDe3: Object.keys(moda).filter(function (k) { return moda[k].n >= 3; }).length,
      dudosos: dudosos.length, ejemplosDudosos: dudosos.slice(0, 20).map(function (x) { return x.clase + '/' + x.tipo + ' «' + x.nombre + '» cat=' + x.mainCat + ' (lo normal: ' + moda[x.clase + '/' + x.tipo].cat + ')'; }),
      perdidos: perdidos.length, ejemplosPerdidos: perdidos.slice(0, 20).map(function (x) { return x.clase + ' «' + x.nombre + '» cat=' + x.mainCat + ' → sería ' + catsConocidas[x.clase][x.mainCat]; }),
      muestraModa: Object.keys(moda).filter(function (k) { return moda[k].n >= 4; }).slice(0, 30).map(function (k) { return k + ' → ' + moda[k].cat + ' ' + moda[k].pureza + '% (n=' + moda[k].n + ')'; }) };
  };

  /** Punto 2: ¿«Más vendidos» trae complementos que los otros carruseles no? */
  window.__p2d = function () {
    var fichas = 0, nuevos = 0, conNuevos = 0, ej = [];
    Object.keys(__inv2.fichas).forEach(function (q) { var f = __inv2.fichas[q]; if (!f.ficha || !f.stream) return; var ctx = VM.contexto(f.ficha, R); if (!ctx.clase) return; fichas++;
      var car = carruselesExt(f), excluir = {}; car.relacionados.forEach(function (r) { excluir[r.id] = true; });
      var base = VM.candidatos([{ origen: 'complementa', items: car.complementa }, { origen: 'otros', items: car.otros }], ctx, R, excluir);
      var tipos = {}; base.forEach(function (c) { tipos[c.tipo] = 1; });
      var mv = VM.candidatos([{ origen: 'masVendidos', items: car.masVendidos }], ctx, R, excluir).filter(function (c) { return !tipos[c.tipo]; });
      if (mv.length) { conNuevos++; nuevos += mv.length; if (ej.length < 12) ej.push(q + ': ' + mv.slice(0, 3).map(function (c) { return c.tipo + ' «' + c.nombre.slice(0, 36) + '»'; }).join(' | ')); } });
    return { fichasConClase: fichas, fichasConTipoNuevo: conNuevos, candidatosDeTipoNuevo: nuevos, ejemplos: ej };
  };

  /** Punto 2: ¿lo que Liverpool llama «Más vendidos» tiene más opiniones? (opiniones como indicio de ventas) */
  window.__p2e = function () {
    var grupos = { masVendidos: [], complementa: [], otros: [], relacionados: [] };
    Object.keys(__inv2.fichas).forEach(function (q) { var f = __inv2.fichas[q]; if (!f.stream) return;
      Object.keys(grupos).forEach(function (k) { (f.stream[k] || []).forEach(function (p) { grupos[k].push(p); }); }); });
    function med(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor(s.length / 2)]; }
    var out = {};
    Object.keys(grupos).forEach(function (k) { var g = grupos[k], n = g.map(function (p) { return p.nOp || 0; });
      out[k] = { productos: g.length, conOpiniones: Math.round(g.filter(function (p) { return p.nOp > 0; }).length / Math.max(1, g.length) * 100) + '%',
        medianaOpiniones: med(n), promedioOpiniones: Math.round(n.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, n.length) * 10) / 10,
        calPromConOpiniones: prom(g, function (p) { return p.nOp > 0 ? p.cal : null; }), marketplace: Math.round(g.filter(function (p) { return p.mkp; }).length / Math.max(1, g.length) * 100) + '%' }; });
    return out;
  };

  // ---------------------------------------------------------------------------------
  // Punto 1 (prototipo de laboratorio): la bolsa como contexto
  // ---------------------------------------------------------------------------------
  function fichaMin(nombre, extra) { return Object.assign({ id: 'bolsa', nombre: nombre, marca: '', migas: [], producto: null, modeloComercial: null, precio: null, esRango: false, variantes: [], colores: [] }, extra || {}); }
  window.__ctxConBolsa = function (ficha, bolsa, opc) {
    opc = opc || {}; var ventana = opc.ventanaMin == null ? 90 : opc.ventanaMin, ahora = opc.ahora || Date.now();
    var vigentes = bolsa.filter(function (b) { return ventana === Infinity || !b.addedAt || (ahora - b.addedAt) <= ventana * 60000; });
    var propio = VM.contexto(ficha, R), ctx = propio, adoptado = null;
    if (!propio.clase || propio.accesorio) {
      for (var i = 0; i < vigentes.length && !adoptado; i++) {
        var b = vigentes[i], c = VM.contexto(fichaMin(b.nombre, { marca: b.marca, precio: b.precio }), R);
        if (!c.clase || c.accesorio) continue;
        var t = VM.tipoDe({ nombre: ficha.nombre }, c.clase); if (!t.conocido) continue;
        // un accesorio que nombra OTRO modelo no se pega a este equipo
        var mAcc = VM.modeloDe(ficha.nombre || ''); if (mAcc && c.modelo && mAcc !== c.modelo) continue;
        adoptado = { bolsa: b, ctx: c };
      }
      if (adoptado) { ctx = Object.assign({}, adoptado.ctx, { ficha: ficha, accesorio: true }); ctx.vars = Object.assign({}, adoptado.ctx.vars); }
    }
    var ids = {}, tipos = {};
    vigentes.forEach(function (b) { ids[b.productId] = true; if (ctx.clase) { var t = VM.tipoDe({ nombre: b.nombre }, ctx.clase); if (t.conocido) tipos[t.tipo] = true; } });
    return { ctx: ctx, adoptado: adoptado ? adoptado.bolsa.nombre : null, vigentes: vigentes.length, ids: ids, tipos: tipos };
  };
  window.__recomendarConBolsa = function (ficha, car, busq, bolsa, opc) {
    var r = window.__ctxConBolsa(ficha, bolsa, opc), ctx = r.ctx;
    if (!ctx.clase) return { clase: null, cruzada: [], plan: [], adoptado: null, vigentes: r.vigentes };
    var excluir = {}; (car.relacionados || []).forEach(function (x) { excluir[x.id] = true; }); Object.keys(r.ids).forEach(function (id) { excluir[id] = true; });
    var filtra = function (items) { return (items || []).filter(function (it) { return !r.ids[it.id] && !r.tipos[VM.tipoDe(it, ctx.clase).tipo]; }); };
    var listas = [{ origen: 'complementa', items: filtra(car.complementa) }, { origen: 'otros', items: filtra(car.otros) }];
    var plan = VM.planDeBusquedas(ctx, VM.mejorPorTipo(VM.candidatos(listas, ctx, R, excluir), ctx), 2).filter(function (b) { return !r.tipos[b.tipo]; });
    plan.forEach(function (b) { if (busq && busq[b.consulta]) listas.push({ origen: 'busqueda', items: filtra(busq[b.consulta]), tipoBuscado: b.tipo, consulta: b.consulta }); });
    var cruz = VM.elegirCruzada(listas, ctx, R, { maximo: 3, excluir: excluir });
    return { clase: ctx.clase.id, modelo: ctx.vars && ctx.vars.modelo, adoptado: r.adoptado, vigentes: r.vigentes, enBolsa: Object.keys(r.tipos),
      cruzada: cruz.map(function (c) { return c.tipo + ': ' + c.nombre.slice(0, 40); }), plan: plan.map(function (b) { return b.consulta; }) };
  };
})();
