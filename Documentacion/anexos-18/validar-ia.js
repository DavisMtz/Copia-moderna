// Punto 5: validar contra Liverpool unas clases redactadas por IA (y, de control, plantillas hechas a mano).
// Va después del banco inv2 y de analisis.js, con window.CLASES_IA definido. Laboratorio, no extensión.
(function () {
  var VM = window.VentelVM, R = window.VENTEL_REGLAS;
  function reglasCon(clases) { return Object.assign({}, R, { clases: R.clases.concat(clases) }); }

  /** Plantillas de una clase rellenadas con las variables de una ficha real: [{tipo, consulta}] */
  function plantillas(clase, ficha, Rx) {
    var ctx = VM.contexto(ficha, Rx); if (!ctx.clase || ctx.clase.id !== clase.id) { ctx = Object.assign({}, ctx, { clase: clase }); }
    var out = [];
    clase.complementos.forEach(function (regla) {
      if (regla.si && !regla.si.test(VM.norm(ficha.nombre || ''))) return;
      var q = VM.consultaDe(regla, ctx); if (q) out.push({ tipo: regla.tipo, consulta: q, soloSugerir: !!regla.soloSugerir });
    });
    return out;
  }

  /** De los 10 primeros resultados (orden del DOM, como la extensión), cuántos son del tipo buscado. */
  function acierto(clase, p, umbral) {
    var b = __inv2.busquedas[p.consulta]; if (!b) return null;
    var porId = {}; b.recs.forEach(function (r) { porId[r.id] = r; });
    var top = b.dom.slice(0, 10).map(function (id) { return porId[id]; }).filter(Boolean);
    var del = top.filter(function (r) { return VM.tipoDe(r, clase).tipo === p.tipo; });
    return { tipo: p.tipo, consulta: p.consulta, total: top.length, delTipo: del.length, pasa: top.length > 0 && del.length >= (umbral || 3),
      categorias: Array.from(new Set(top.map(function (r) { return (r.carrCats && r.carrCats[r.carrCats.length - 1]) || r.mainCat; }))).slice(0, 4),
      primeros: top.slice(0, 3).map(function (r) { return r.nombre.slice(0, 44); }) };
  }

  /** Todas las consultas que hay que buscar para validar (las de la IA y las de control). */
  window.__p5Consultas = function (esperado, control) {
    var Rx = reglasCon(window.CLASES_IA), qs = [];
    Object.keys(esperado).forEach(function (q) { var f = __inv2.fichas[q]; if (!f || !f.ficha) return;
      var clase = window.CLASES_IA.filter(function (c) { return c.id === esperado[q]; })[0]; if (!clase) return;
      plantillas(clase, f.ficha, Rx).forEach(function (p) { if (qs.indexOf(p.consulta) < 0) qs.push(p.consulta); }); });
    (control || []).forEach(function (p) { if (qs.indexOf(p.consulta) < 0) qs.push(p.consulta); });
    return qs.filter(function (q) { return !__inv2.busquedas[q]; });
  };

  /** Plantillas de CONTROL: las de la v3.1 que pide el corpus, una por tipo y hasta `n`, repartidas entre clases. */
  window.__p5Control = function (n) {
    var vistos = {}, porClase = {}, out = [];
    window.__qs81.forEach(function (q) { var f = __inv2.fichas[q]; if (!f || !f.ficha) return; var ctx = VM.contexto(f.ficha, R); if (!ctx.clase) return;
      VM.tiposNaturales(ctx).forEach(function (regla) { if (regla.soloSugerir) return; var c = VM.consultaDe(regla, ctx); if (!c || vistos[c]) return; vistos[c] = 1;
        (porClase[ctx.clase.id] = porClase[ctx.clase.id] || []).push({ claseId: ctx.clase.id, tipo: regla.tipo, consulta: c }); }); });
    // ronda: uno de cada clase, luego el segundo de cada clase…
    var clases = Object.keys(porClase);
    for (var r = 0; out.length < n && r < 6; r++) clases.forEach(function (k) { if (out.length < n && porClase[k][r]) out.push(porClase[k][r]); });
    return out;
  };

  /** El resultado del experimento. */
  window.__p5 = function (esperado, control, umbral) {
    var Rx = reglasCon(window.CLASES_IA), res = {};
    // (a) ¿clasifica bien las fichas reales de sus categorías?
    res.clasificacion = Object.keys(esperado).map(function (q) { var f = __inv2.fichas[q]; if (!f || !f.ficha) return q + ': sin ficha';
      var c = VM.contexto(f.ficha, Rx).clase; return (c && c.id === esperado[q] ? 'OK  ' : 'MAL ') + q + ' → ' + (c ? c.id : 'sin clase') + ' («' + f.ficha.nombre.slice(0, 46) + '»)'; });
    // (b) ¿roba fichas de otras clases? (las 81 del corpus)
    res.colisiones = window.__qs81.filter(function (q) { return __inv2.fichas[q] && __inv2.fichas[q].ficha; }).map(function (q) {
      var f = __inv2.fichas[q].ficha, a = VM.contexto(f, R).clase, b = VM.contexto(f, Rx).clase; return [q, a ? a.id : null, b ? b.id : null]; })
      .filter(function (x) { return x[1] !== x[2]; }).map(function (x) { return x[0] + ': ' + x[1] + ' → ' + x[2]; });
    // (c) plantillas de la IA en el buscador real
    var ia = [];
    Object.keys(esperado).forEach(function (q) { var f = __inv2.fichas[q]; if (!f || !f.ficha) return;
      var clase = window.CLASES_IA.filter(function (c) { return c.id === esperado[q]; })[0]; if (!clase) return;
      plantillas(clase, f.ficha, Rx).forEach(function (p) { if (ia.some(function (x) { return x.consulta === p.consulta; })) return; var a = acierto(clase, p, umbral); if (a) { a.clase = clase.id; ia.push(a); } }); });
    res.plantillasIA = { total: ia.length, pasan: ia.filter(function (x) { return x.pasa; }).length, detalle: ia };
    // (c') control: las de la v3.1, con el mismo criterio
    var ctl = (control || []).map(function (p) { var clase = R.clases.filter(function (c) { return c.id === p.claseId; })[0]; var a = acierto(clase, p, umbral); if (a) a.clase = p.claseId; return a; }).filter(Boolean);
    res.plantillasControl = { total: ctl.length, pasan: ctl.filter(function (x) { return x.pasa; }).length, detalle: ctl };
    // (d) ¿sus tipos reconocen lo que Liverpool pone en «Complementa con»?
    var tot = 0, conTipo = 0, ej = {};
    Object.keys(esperado).forEach(function (q) { var f = __inv2.fichas[q]; if (!f || !f.stream) return;
      var clase = window.CLASES_IA.filter(function (c) { return c.id === esperado[q]; })[0]; if (!clase) return;
      (f.stream.complementa || []).forEach(function (p) { tot++; var t = VM.tipoDe(p, clase); if (t.conocido) { conTipo++; ej[clase.id + '/' + t.tipo] = (ej[clase.id + '/' + t.tipo] || 0) + 1; } }); });
    res.complementaReconocido = { productos: tot, conTipo: conTipo, porTipo: ej };
    return res;
  };
})();
