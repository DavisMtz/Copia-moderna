// Laboratorio de la implementación de la 3.0 (04/10/2026): mide en la pestaña de
// liverpool.com.mx/robots.txt contra window.__inv2, el corpus que juntó la investigación del
// documento 18 (110 fichas con sus carruseles y sus búsquedas). NO es la extensión.
//
// Se carga dentro del banco (armar-banco.cjs), que deja dos versiones lado a lado: __lab.v29 (reglas y
// núcleo de la 2.9) y __lab.n (los del árbol de trabajo). Lo que hay:
//   L.cargar()                    trae el corpus de IndexedDB ("inv2") a window.__inv2
//   L.clases(a, b)                qué fichas cambian de clase entre dos versiones
//   L.medir(ver, opc)             qué recomienda una versión en cada ficha (con las búsquedas de su plan)
//   L.resumen(med), L.diferencias(a, b), L.antesDespues()
//   L.plantillas(ver, clases)     de los 10 primeros resultados de cada búsqueda, cuántos son del tipo buscado
//   L.buscar(consultas, ms)       trae de Liverpool las búsquedas que falten (solo lectura, con pausa y freno)
//   L.escenarios()                la bolsa como contexto, con fichas reales
//   L.p2(opc)                     el punto 2 tal como lo midió el documento 18, con sus variantes
//   L.evaluacion()                los datos de la hoja de la evaluación humana (JSONL) y su huella
//   L.sal(objeto)                 lo escribe en <pre id="__sal">: la salida de la consola se corta a ~1000 caracteres
//
// OJO: el corpus vivía en IndexedDB y el 04/10/2026 por la tarde apareció vacío (sitio sin
// almacenamiento persistente). Lo que se mida, al disco en cuanto salga. Para volver a medir hay
// que recolectar de nuevo con ../colector-v2.js.
(function () {
  var L = window.__lab;
  var AHORA = Date.now();
  function inv() { return window.__inv2; }

  L.sal = function (o) {
    var p = document.getElementById('__sal');
    if (!p) {
      var art = document.createElement('article'); art.innerHTML = '<pre id="__sal" style="white-space:pre-wrap"></pre>';
      document.body.insertBefore(art, document.body.firstChild); p = document.getElementById('__sal');
    }
    p.textContent = typeof o === 'string' ? o : JSON.stringify(o, null, 1);
    return p.textContent.length + ' caracteres';
  };

  function idb() { return new Promise(function (ok, mal) { var r = indexedDB.open('inv2', 1); r.onupgradeneeded = function () { r.result.createObjectStore('kv'); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { mal(r.error); }; }); }
  L.idbGet = async function (k) { var db = await idb(); return new Promise(function (ok) { var q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { ok(q.result); }; q.onerror = function () { ok(null); }; }); };
  L.idbSet = async function (k, v) { var db = await idb(); return new Promise(function (ok) { var t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = function () { ok(true); }; t.onerror = function () { ok(false); }; }); };
  L.cargar = async function () { if (!window.__inv2) window.__inv2 = await L.idbGet('inv2'); return { fichas: Object.keys(inv().fichas).length, busquedas: Object.keys(inv().busquedas).length }; };

  function prom(arr, f) { var v = arr.map(f).filter(function (x) { return typeof x === 'number' && isFinite(x); }); return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length * 100) / 100 : null; }

  // ---- los datos, con la forma que lee la extensión ----------------------------------------------
  function plano(p) { return { id: p.id, marca: p.marca, nombre: p.nombre, precio: p.precio }; }
  function rico(p) { return { id: p.id, marca: p.marca, nombre: p.nombre, precio: p.precio, cal: p.cal, nOp: p.nOp, mkp: !!p.mkp, patroc: p.patroc === true ? true : undefined, online: p.online === false ? false : undefined, vendedor: p.vendedor || undefined }; }
  L.car = function (f, conDatos) {
    var s = f.stream || {}, m = conDatos ? rico : plano;
    return { complementa: (s.complementa || []).map(m), otros: (s.otros || []).map(m), relacionados: (s.relacionados || []).map(m), masVendidos: (s.masVendidos || []).map(m) };
  };
  /** Los resultados de una búsqueda: n = 'dom' (las 16 que guardó el recolector), o los n primeros registros. */
  L.busq = function (q, n, conDatos) {
    var b = inv().busquedas[q]; if (!b) return null;
    var m = conDatos ? rico : plano, porId = {};
    b.recs.forEach(function (r) { porId[r.id] = r; });
    var lista = n === 'dom' ? b.dom.map(function (id) { return porId[id]; }).filter(Boolean) : b.recs.slice(0, n || 24);
    return lista.map(m);
  };
  /** ¿El orden del DOM es el de los registros? */
  L.ordenes = function () {
    var iguales = 0, distintas = [], total = 0;
    Object.keys(inv().busquedas).forEach(function (q) { var b = inv().busquedas[q]; if (!b.dom || !b.recs) return; total++;
      var ok = b.dom.every(function (id, i) { return b.recs[i] && b.recs[i].id === id; });
      if (ok) iguales++; else if (distintas.length < 6) distintas.push(q + ': dom ' + b.dom.slice(0, 4).join(',') + ' | recs ' + b.recs.slice(0, 4).map(function (r) { return r.id; }).join(',')); });
    return { busquedas: total, mismoOrden: iguales, ejemplosDistintos: distintas };
  };

  // id → lo que Liverpool sabe de él (igual que en analisis.js del documento 18)
  L.info = function () {
    var m = {};
    Object.keys(inv().fichas).forEach(function (q) { var f = inv().fichas[q]; if (!f.stream) return;
      Object.keys(f.stream).forEach(function (k) { f.stream[k].forEach(function (p) {
        m[p.id] = Object.assign(m[p.id] || {}, { cal: p.cal, nOp: p.nOp, mkp: p.mkp, vendedor: p.vendedor }); }); }); });
    Object.keys(inv().busquedas).forEach(function (q) { (inv().busquedas[q].recs || []).forEach(function (r) { var a = m[r.id] || {};
      m[r.id] = Object.assign(a, { cal: r.cal, nOp: r.nOp, mkp: r.mkp, patroc: r.patroc, online: r.online, vendedor: r.vendedor }); }); });
    return m;
  };

  // ---- 1. ¿Cambió la clase de alguna ficha? -------------------------------------------------------
  L.clases = function (a, b) {
    a = a || 'v29'; b = b || 'n';
    var cambios = [], total = 0, conA = 0, conB = 0;
    Object.keys(inv().fichas).forEach(function (q) { var f = inv().fichas[q]; if (!f.ficha) return; total++;
      var ca = L[a].VM.contexto(f.ficha, L[a].R).clase, cb = L[b].VM.contexto(f.ficha, L[b].R).clase;
      if (ca) conA++; if (cb) conB++;
      if ((ca && ca.id) !== (cb && cb.id)) cambios.push(q + ': ' + (ca ? ca.id : null) + ' → ' + (cb ? cb.id : null) + ' («' + f.ficha.nombre.slice(0, 44) + '»)'); });
    return { fichas: total, conClaseA: conA, conClaseB: conB, cambios: cambios };
  };

  // ---- 3. Lo que recomienda una versión en cada ficha, con las búsquedas de su plan (de la caché) ----
  /**
   * opc.reglas: otras reglas (p. ej. las mismas sin `calidad`); opc.n: cuántos resultados de la
   * búsqueda (24 = lo que guarda la extensión); opc.conDatos: los artículos llevan calificación.
   */
  L.medir = function (ver, opc) {
    opc = opc || {};
    var V = L[ver], R = opc.reglas || V.R, n = opc.n || 24, conDatos = opc.conDatos !== false, out = {}, faltan = {};
    Object.keys(inv().fichas).forEach(function (q) {
      var f = inv().fichas[q]; if (!f.ficha) return;
      var car = L.car(f, conDatos);
      var m0 = V.VM.recomendar(f.ficha, car, null, R, AHORA), bs = {};
      (m0.busquedas || []).forEach(function (b) { var its = L.busq(b.consulta, n, conDatos); if (its) bs[b.consulta] = its; else faltan[b.consulta] = (faltan[b.consulta] || []).concat([q]); });
      var m = V.VM.recomendar(f.ficha, car, null, R, AHORA, bs);
      out[q] = { clase: m.clase ? m.clase.id : null, nombre: f.ficha.nombre, precio: f.ficha.precio, servicio: m.servicio,
        cruz: m.cruzada.map(function (r) { return { id: r.id, tipo: r.tipo, nombre: r.nombre, marca: r.marca, precio: r.precio, cal: r.cal, nOp: r.nOp, mkp: r.mkp, origen: r.origen, compat: r.compat, enLugarDe: r.enLugarDe }; }),
        plan: (m.busquedas || []).map(function (b) { return b.consulta; }), sug: (m.sugeridas || []).map(function (b) { return b.consulta; }),
        sube: m.incremental.modelo ? m.incremental.modelo.nombre : (m.incremental.capacidad ? m.incremental.capacidad.talla : null) };
    });
    L.ultimoFaltan = faltan;
    return out;
  };
  /** Resumen de una medición: cuántas recomendaciones, con qué respaldo. */
  L.resumen = function (med) {
    var recs = [], fichas = 0, conClase = 0, sinRec = 0;
    Object.keys(med).forEach(function (q) { fichas++; if (med[q].clase) conClase++; if (!med[q].cruz.length) sinRec++; med[q].cruz.forEach(function (r) { recs.push(r); }); });
    var conOp = recs.filter(function (r) { return r.nOp > 0; });
    return { fichas: fichas, conClase: conClase, sinRecomendacion: sinRec, recomendaciones: recs.length,
      sinOpiniones: recs.length - conOp.length, calPromedio: prom(conOp, function (r) { return r.cal; }),
      opinionesPromedio: prom(recs, function (r) { return r.nOp || 0; }), marketplace: recs.filter(function (r) { return r.mkp; }).length,
      deBusqueda: recs.filter(function (r) { return r.origen === 'busqueda'; }).length, porCalidad: recs.filter(function (r) { return r.enLugarDe; }).length,
      precioPromedio: prom(recs, function (r) { return r.precio; }) };
  };
  /** En qué fichas cambia lo recomendado entre dos mediciones. */
  L.diferencias = function (a, b) {
    var out = [];
    Object.keys(a).forEach(function (q) {
      var x = a[q], y = b[q]; if (!y) return;
      var ix = x.cruz.map(function (r) { return r.id; }).join(','), iy = y.cruz.map(function (r) { return r.id; }).join(',');
      if (ix === iy && x.clase === y.clase) return;
      var corto = function (r) { return r.tipo + ': ' + r.nombre.slice(0, 38) + ' $' + r.precio + ' ★' + (r.cal == null ? '-' : r.cal) + '(' + (r.nOp || 0) + ')' + (r.mkp ? ' MKP' : '') + (r.origen === 'busqueda' ? ' B' : ''); };
      var enY = {}, enX = {}; y.cruz.forEach(function (r) { enY[r.id] = 1; }); x.cruz.forEach(function (r) { enX[r.id] = 1; });
      out.push(q + ' [' + x.clase + (x.clase !== y.clase ? ' → ' + y.clase : '') + ']\n   − ' + (x.cruz.filter(function (r) { return !enY[r.id]; }).map(corto).join(' | ') || '(nada)') +
        '\n   + ' + (y.cruz.filter(function (r) { return !enX[r.id]; }).map(corto).join(' | ') || '(nada)'));
    });
    return out;
  };

  // ---- 5. Plantillas de búsqueda: ¿lo que se busca trae lo que se dice? (punto 5) --------------------
  L.NUEVAS = ['muneca', 'bloquesConstruccion', 'juegoMesa', 'carroControlRemoto', 'guitarra', 'casaCampana', 'scooterElectrico', 'dron', 'ventilador', 'lampara', 'termo', 'computadoraEscritorio'];
  /** Por cada ficha (de las clases dadas) y cada tipo natural: de los 10 primeros resultados, cuántos son del tipo. */
  L.plantillas = function (ver, soloClases) {
    var V = L[ver || 'n'], out = [], faltan = [], vistas = {};
    Object.keys(inv().fichas).forEach(function (q) {
      var f = inv().fichas[q]; if (!f.ficha) return;
      var ctx = V.VM.contexto(f.ficha, V.R); if (!ctx.clase) return;
      if (soloClases && soloClases.indexOf(ctx.clase.id) === -1) return;
      V.VM.tiposNaturales(ctx).forEach(function (regla) {
        var c = V.VM.consultaDe(regla, ctx); if (!c) return;
        var clave = ctx.clase.id + '/' + regla.tipo + '/' + c; if (vistas[clave]) return; vistas[clave] = 1;
        var b = inv().busquedas[c];
        if (!b) { if (faltan.indexOf(c) < 0) faltan.push(c); out.push({ clase: ctx.clase.id, tipo: regla.tipo, consulta: c, falta: true, boton: !!regla.soloSugerir }); return; }
        var top = b.recs.slice(0, 10);
        var del = top.filter(function (r) { return V.VM.tipoDe(r, ctx.clase).tipo === regla.tipo; }).length;
        out.push({ clase: ctx.clase.id, tipo: regla.tipo, consulta: c, del: del, de: top.length, boton: !!regla.soloSugerir, primeros: top.slice(0, 3).map(function (r) { return r.nombre.slice(0, 36); }) });
      });
    });
    return { filas: out, faltan: faltan };
  };
  // Una pausa que la pestaña oculta no frena: el temporizador vive en un Worker.
  var relojW = null;
  function pausa(ms) {
    return new Promise(function (ok) {
      try {
        if (!relojW) relojW = new Worker(URL.createObjectURL(new Blob(['onmessage=function(e){setTimeout(function(){postMessage(0)},e.data)}'], { type: 'text/javascript' })));
        relojW.onmessage = function () { ok(); };
        relojW.postMessage(ms);
      } catch (e) { setTimeout(ok, ms); }
    });
  }
  function recortarStream(s, ini) { var prof = 0, enCad = false, esc = false;
    for (var i = ini; i < s.length; i++) { var c = s[i];
      if (enCad) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') enCad = false; continue; }
      if (c === '"') enCad = true; else if (c === '[' || c === '{') prof++; else if (c === ']' || c === '}') { prof--; if (prof === 0) return s.slice(ini, i + 1); } }
    return null; }
  /** Busca en Liverpool lo que falte (solo lectura), con 3 s entre pedidos y freno ante cualquier bloqueo. Guarda en IndexedDB. */
  L.buscar = async function (consultas, ms) {
    L.estadoBusqueda = { total: consultas.length, hechas: 0, alto: null, actual: null };
    for (var i = 0; i < consultas.length; i++) {
      var c = consultas[i]; L.estadoBusqueda.actual = c;
      if (inv().busquedas[c]) { L.estadoBusqueda.hechas++; continue; }
      var r = await fetch('/tienda?s=' + encodeURIComponent(c), { credentials: 'include' }), t = await r.text();
      if (r.status !== 200 || /access denied/i.test(t.slice(0, 3000))) { L.estadoBusqueda.alto = 'búsqueda ' + r.status; break; }
      var st = L.n.Lector.streamDe(t), p = st.indexOf('"records":['), recs = [];
      if (p > -1) { try { recs = JSON.parse(recortarStream(st, p + 10)).map(function (x) { var pi = x.priceInfo || {}, ff = x.featureFlags || {}, ri = x.ratingInfo || {};
        return { id: String(x.productId), nombre: x.title || '', marca: x.brand || '', precio: pi.salePrice != null ? Number(pi.salePrice) : (pi.promoPrice ? Number(pi.promoPrice.price) : null),
          cal: ri.productRatingCount > 0 ? Number(ri.productAvgRating) : null, nOp: Number(ri.productRatingCount) || 0, patroc: !!ff.isSponsoredRecord, mkp: !!ff.isMarketPlace,
          online: Array.isArray(x.geoStoreIds) ? x.geoStoreIds.indexOf('online') > -1 : null }; }); } catch (e) { recs = []; } }
      var doc = new DOMParser().parseFromString(t, 'text/html'), dom = [], vistos = {};
      doc.querySelectorAll('a[href*="/pdp/"]').forEach(function (a) { var id = (a.getAttribute('href') || '').split('?')[0].split('/').pop(); if (/^\d{6,}$/.test(id) && !vistos[id] && a.querySelector('h3')) { vistos[id] = 1; dom.push(id); } });
      inv().busquedas[c] = { recs: recs, dom: dom.slice(0, 16), kb: Math.round(t.length / 1024), nueva: '2026-10-04 tarde' };
      L.estadoBusqueda.hechas++;
      if (i % 6 === 5) await L.idbSet('inv2', inv());
      await pausa(ms || 3000);
    }
    await L.idbSet('inv2', inv());
    L.estadoBusqueda.actual = null; L.estadoBusqueda.listo = true;
    return L.estadoBusqueda;
  };

  // ---- 4. La bolsa como contexto: escenarios con fichas y búsquedas reales ---------------------------
  /** Un artículo de bolsa a partir de una ficha del corpus (o de un objeto suelto), agregado hace `min` minutos. */
  L.deBolsa = function (x, min) {
    var f = typeof x === 'string' ? inv().fichas[x].ficha : x;
    return { id: String(f.id), sku: f.sku || null, nombre: f.nombre, marca: f.marca, precio: f.precio, cantidad: 1, agregado: AHORA - (min == null ? 10 : min) * 60000, enExistencia: true };
  };
  L.conBolsa = function (q, bolsa, ver) {
    var V = L[ver || 'n'], f = inv().fichas[q], car = L.car(f, true), faltan = [];
    var una = function (b) {
      var m0 = V.VM.recomendar(f.ficha, car, null, V.R, AHORA, {}, b), bs = {};
      (m0.busquedas || []).forEach(function (x) { var its = L.busq(x.consulta, 24, true); if (its) bs[x.consulta] = its; else faltan.push(x.consulta); });
      var m = V.VM.recomendar(f.ficha, car, null, V.R, AHORA, bs, b);
      return { clase: m.clase ? m.clase.id : null, equipo: m.bolsa && m.bolsa.equipo ? (m.bolsa.equipo.modelo || m.bolsa.equipo.nombre.slice(0, 30)) + ' [' + m.bolsa.equipo.clase.id + ']' : null,
        enBolsa: m.bolsa ? m.bolsa.tipos : undefined, servicio: m.servicio,
        cruz: m.cruzada.map(function (r) { return r.tipo + ': ' + r.nombre.slice(0, 44) + ' $' + r.precio + (r.origen === 'busqueda' ? ' B' : '') + ' ' + r.compat; }),
        plan: (m.busquedas || []).map(function (x) { return x.consulta; }), sug: (m.sugeridas || []).map(function (x) { return x.consulta; }) };
    };
    return { ficha: f.ficha.nombre.slice(0, 60) + ' (' + f.ficha.marca + ')', sin: una(null), con: una(bolsa), faltan: faltan };
  };
  L.escenarios = function () {
    var S = {}, B = L.deBolsa;
    var watch = { id: '900000001', nombre: 'Apple Watch SE 3 GPS caja de aluminio 44 mm', marca: 'APPLE', precio: 6249 };
    var mouse = { id: '900000002', nombre: 'Mouse inalámbrico 400 silencioso AZ7B2AA', marca: 'HP', precio: 399 };
    var jbl = { id: '1184854987', nombre: 'Bocina portátil Jbl BOOMBOX 4 bluetooth', marca: 'JBL', precio: 7699.3 };
    var redmi = { id: '99982859613', nombre: 'Smartphone Xiaomi Redmi Note 14 Pro+ AMOLED 6.6 pulgadas', marca: 'XIAOMI', precio: 7455 };
    S['1 funda iPhone 16 + iPhone 16'] = L.conBolsa('funda iphone 16', [B('iphone 16')]);
    S['2 mica + Galaxy A56'] = L.conBolsa('mica galaxy a56', [B('samsung galaxy a56')]);
    S['3 cargador Apple + iPhone 16'] = L.conBolsa('cargador apple 20w', [B('iphone 16')]);
    S['4 correa Apple Watch + reloj'] = L.conBolsa('correa apple watch', [B(watch)]);
    S['5 protector de colchón + colchón'] = L.conBolsa('protector de colchon matrimonial', [B('colchon matrimonial')]);
    S['6 control PS5 + consola'] = L.conBolsa('control ps5', [B('consola playstation 5')]);
    S['7 cápsulas + cafetera de cápsulas'] = L.conBolsa('capsulas dolce gusto', [B('cafetera de capsulas')]);
    S['8 cápsulas + cafetera ESPRESSO (no es su sistema)'] = L.conBolsa('capsulas dolce gusto', [B('cafetera espresso')]);
    S['9 iPhone 16 con su funda en la bolsa'] = L.conBolsa('iphone 16', [B('funda iphone 16')]);
    S['10 laptop con un mouse en la bolsa'] = L.conBolsa('laptop hp', [B(mouse)]);
    S['11 cargador Apple + bolsa VIEJA (JBL y Redmi, 56 y 61 h)'] = L.conBolsa('cargador apple 20w', [B(jbl, 56 * 60), B(redmi, 61 * 60)]);
    S['12 cargador Apple + Redmi reciente (otra familia)'] = L.conBolsa('cargador apple 20w', [B(redmi, 5)]);
    S['13 control PS5 + iPhone y consola (el más reciente que le queda)'] = L.conBolsa('control ps5', [B('iphone 16', 2), B('consola playstation 5', 20)]);
    return S;
  };

  // ---- 2. El punto 2, como en el documento 18 (analisis.js), con sus variantes ----------------------
  function bayes(x, m, C) { var n = (x && x.nOp) || 0, a = (x && x.cal) || 0; return (C * m + a * n) / (C + n); }
  L.p2 = function (opc) {
    opc = opc || {};
    var ver = opc.ver || 'v29', V = L[ver], VM = V.VM, R = V.R;
    var m0 = opc.m == null ? 4.2 : opc.m, C = opc.C == null ? 5 : opc.C, bonus1P = opc.bonus1P == null ? 0.15 : opc.bonus1P;
    var n = opc.n || 'dom', top = opc.top || null, topDef = opc.topDef || 'aceptados', tope = opc.tope || null, nivelDef = opc.nivelDef || 'p2';
    var I = L.info(), filas = [];
    Object.keys(inv().fichas).forEach(function (q) {
      var f = inv().fichas[q]; if (!f.ficha) return;
      var ctx = VM.contexto(f.ficha, R); if (!ctx.clase) return;
      var car = L.car(f), excluir = {};
      car.relacionados.forEach(function (r) { excluir[r.id] = true; });
      var listas = [{ origen: 'complementa', items: car.complementa }, { origen: 'otros', items: car.otros }];
      var plan = VM.planDeBusquedas(ctx, VM.mejorPorTipo(VM.candidatos(listas, ctx, R, excluir), ctx), 2);
      plan.forEach(function (b) { var its = L.busq(b.consulta, n); if (its) listas.push({ origen: 'busqueda', items: its, tipoBuscado: b.tipo, consulta: b.consulta }); });
      // la posición de cada artículo en SU lista (el orden de Liverpool)
      var posDe = {};
      listas.forEach(function (l, nl) { l.items.forEach(function (it, i) { if (posDe[nl + ':' + it.id] == null) posDe[nl + ':' + it.id] = i; }); });
      var cruz = VM.elegirCruzada(listas, ctx, R, { maximo: 3, excluir: excluir });
      var cands = VM.candidatos(listas, ctx, R, excluir);
      cruz.forEach(function (rec) {
        var mismos = cands.filter(function (c) { return c.tipo === rec.tipo; });
        var nivel;
        if (nivelDef === 'p2') nivel = rec.compat === 'exacto' ? mismos.filter(function (c) { return c.compat === 'exacto'; }) : mismos.filter(function (c) { return c.compat !== 'familia'; });
        else if (nivelDef === 'compat') nivel = mismos.filter(function (c) { return c.compat === rec.compat; });
        else {
          // estricto: el mismo nivel de compatibilidad y, en un par de aparatos, los mismos kilos de distancia
          var dk = function (c) { if (!ctx.kilos) return 0; var k = VM.kilosDe(c.nombre); return k ? Math.abs(k - ctx.kilos) : 99; };
          nivel = mismos.filter(function (c) { return c.compat === rec.compat && dk(c) === dk(rec); });
        }
        if (top) {
          if (topDef === 'aceptados') nivel = nivel.slice(0, top);
          else nivel = nivel.filter(function (c) { return c.id === rec.id || posDe[c.nLista + ':' + c.id] < top; });
        }
        if (tope) nivel = nivel.filter(function (c) { return c.id === rec.id || (typeof c.precio === 'number' && typeof rec.precio === 'number' && c.precio <= rec.precio * tope); });
        if (!nivel.some(function (c) { return c.id === rec.id; })) nivel = [rec].concat(nivel);
        var puntua = function (c) { var x = I[c.id] || {}; return bayes(x, m0, C) + (x.mkp ? 0 : bonus1P) - (x.patroc ? 0.5 : 0) - (x.online === false ? 1 : 0); };
        // Para quitarle el lugar al primero de Liverpool: con opiniones (si se pide) y ganándole por un margen.
        // El primero de un CARRUSEL que no tiene opiniones se queda: lo puso ahí la venta de Liverpool (un estreno no tiene opiniones).
        if (opc.carruselSinOp && rec.origen !== 'busqueda' && !((I[rec.id] || {}).nOp > 0)) nivel = [rec];
        if (opc.altConOp) nivel = nivel.filter(function (c) { return c.id === rec.id || ((I[c.id] || {}).nOp > 0); });
        if (opc.margen) nivel = nivel.filter(function (c) { return c.id === rec.id || puntua(c) >= puntua(rec) + opc.margen; });
        var alt = nivel.slice().sort(function (a, b) { return (puntua(b) - puntua(a)) || (a.orden - b.orden); })[0] || rec;
        var ic = I[rec.id] || {}, ia = I[alt.id] || {};
        filas.push({ q: q, clase: ctx.clase.id, tipo: rec.tipo, n: nivel.length, cambia: alt.id !== rec.id,
          cur: { id: rec.id, nombre: rec.nombre.slice(0, 42), precio: rec.precio, cal: ic.cal, nOp: ic.nOp, mkp: !!ic.mkp, origen: rec.origen, compat: rec.compat, pos: posDe[rec.nLista + ':' + rec.id] },
          alt: { id: alt.id, nombre: alt.nombre.slice(0, 42), precio: alt.precio, cal: ia.cal, nOp: ia.nOp, mkp: !!ia.mkp, origen: alt.origen, compat: alt.compat, pos: posDe[alt.nLista + ':' + alt.id] } });
      });
    });
    var conOpcion = filas.filter(function (r) { return r.n >= 2; }), cambian = conOpcion.filter(function (r) { return r.cambia; });
    L.p2filas = filas;
    var ej = function (r) { return r.q + ' · ' + r.tipo + ': ' + r.cur.nombre + ' $' + r.cur.precio + ' ★' + r.cur.cal + '(' + r.cur.nOp + ')' + (r.cur.mkp ? ' MKP' : '') + ' [' + r.cur.origen + '#' + r.cur.pos + ' ' + r.cur.compat + ']' +
      '  →  ' + r.alt.nombre + ' $' + r.alt.precio + ' ★' + r.alt.cal + '(' + r.alt.nOp + ')' + (r.alt.mkp ? ' MKP' : '') + ' [' + r.alt.origen + '#' + r.alt.pos + ' ' + r.alt.compat + ']'; };
    if (opc.corto) return { p: [nivelDef, 'top' + top, topDef, 'tope' + tope, 'margen' + (opc.margen || 0), opc.altConOp ? 'altConOp' : '', 'n' + n, 'bono' + bonus1P].join(' '),
      recs: filas.length, cambian: filas.filter(function (r) { return r.cambia; }).length,
      sinOp: filas.filter(function (r) { return !r.cur.nOp; }).length + '→' + filas.filter(function (r) { return !r.alt.nOp; }).length,
      cal: prom(filas, function (r) { return r.cur.nOp > 0 ? r.cur.cal : null; }) + '→' + prom(filas, function (r) { return r.alt.nOp > 0 ? r.alt.cal : null; }),
      mkp: filas.filter(function (r) { return r.cur.mkp; }).length + '→' + filas.filter(function (r) { return r.alt.mkp; }).length,
      opEnCambios: prom(cambian, function (r) { return r.cur.nOp || 0; }) + '→' + prom(cambian, function (r) { return r.alt.nOp || 0; }),
      precio: prom(cambian, function (r) { return r.cur.precio ? r.alt.precio / r.cur.precio : null; }),
      masCaras: cambian.filter(function (r) { return r.alt.precio > r.cur.precio; }).length,
      ejemplos: opc.ejemplos ? cambian.slice(0, opc.ejemplos).map(ej) : undefined };
    return { parametros: { ver: ver, m: m0, C: C, bonus1P: bonus1P, n: n, top: top, topDef: topDef, tope: tope, nivelDef: nivelDef },
      recomendaciones: filas.length, conOpcion: conOpcion.length, cambian: cambian.length,
      hoy: { cal: prom(conOpcion, function (r) { return r.cur.nOp > 0 ? r.cur.cal : null; }), sinOpiniones: conOpcion.filter(function (r) { return !r.cur.nOp; }).length, marketplace: conOpcion.filter(function (r) { return r.cur.mkp; }).length },
      alternativa: { cal: prom(conOpcion, function (r) { return r.alt.nOp > 0 ? r.alt.cal : null; }), sinOpiniones: conOpcion.filter(function (r) { return !r.alt.nOp; }).length, marketplace: conOpcion.filter(function (r) { return r.alt.mkp; }).length },
      enLosCambios: { opinionesHoy: prom(cambian, function (r) { return r.cur.nOp || 0; }), opinionesAlt: prom(cambian, function (r) { return r.alt.nOp || 0; }),
        precioAltSobreHoy: prom(cambian, function (r) { return r.cur.precio ? r.alt.precio / r.cur.precio : null; }),
        cruzanOrigen: cambian.filter(function (r) { return r.cur.origen !== r.alt.origen; }).length, cruzanCompat: cambian.filter(function (r) { return r.cur.compat !== r.alt.compat; }).length },
      ejemplos: opc.ejemplos ? cambian.slice(0, opc.ejemplos).map(ej) : undefined };
  };

  // ---- 6. Antes y después, en las mismas fichas ---------------------------------------------------
  L.antesDespues = function () {
    var a = L.medir('v29', {}), fa = Object.keys(L.ultimoFaltan);
    var b = L.medir('n', {}), fb = Object.keys(L.ultimoFaltan);
    var c = L.medir('n', { reglas: Object.assign({}, L.n.R, { calidad: null }) });
    var sub = function (med, f) { var o = {}; Object.keys(med).forEach(function (q) { if (f(q)) o[q] = med[q]; }); return o; };
    var conClaseAntes = function (q) { return !!a[q].clase; };
    var nuevas = function (q) { return L.NUEVAS.indexOf(b[q].clase) > -1; };
    L.medA = a; L.medB = b; L.medC = c;
    return { todas: { v29: L.resumen(a), n: L.resumen(b), nSinCalidad: L.resumen(c) },
      conClaseEnLa29: { v29: L.resumen(sub(a, conClaseAntes)), n: L.resumen(sub(b, conClaseAntes)), nSinCalidad: L.resumen(sub(c, conClaseAntes)) },
      clasesNuevas: { v29: L.resumen(sub(a, nuevas)), n: L.resumen(sub(b, nuevas)) },
      clases: L.clases('v29', 'n'), fichasQueCambian: L.diferencias(a, b).length, soloPorCalidad: L.diferencias(c, b).length,
      busquedasQueFaltan: { v29: fa, n: fb } };
  };

  // ---- 7. La muestra para la evaluación humana (documento 18, §9) -----------------------------------
  L.MUESTRA = [['Cafetera pop deluxe titan', 2395], ['Combo licuadora Plus DUO 3 velocidades', 2799], ['Freidora de aire 6 L', 1756], ['Horno de microondas MS32DG', 2664],
    ['Smartwatch Fit 3 con GPS', 1199], ['Cámara instantánea Instax Mini 12', 1861], ['Multifuncional Smart Tank 580', 3399], ['Bocina portátil XB100', 999],
    ['Audífonos On-Ear inalámbricos', 989], ['Lavavajillas 12 servicios', 7349], ['Minisplit inverter frío 12,000 BTU', 4986], ['Cafetera espresso', 1559],
    ['Batidora de pedestal 12 velocidades', 2071], ['Purificador True HEPA', 2029], ['Cepillo de vapor DT7111', 979], ['Monitor gamer 27', 3199],
    ['iPad A16 11', 10999], ['Proyector X8', 1800], ['Set de almohada pillow', 647], ['Set edredón Confort', 699], ['Juego de sábanas de poliéster', 479],
    ['Sofá Bishop', 18199], ['Silla de escritorio Misha', 899], ['Batería de cocina supercook', 2599], ['Sartén Easy Titanium', 356], ['Vajilla para 4 personas', 1037],
    ['Carriola de bastón', 524], ['Autoasiento booster', 1899], ['Cuna convertible', 3617], ['Silla alta Bistro', 1399], ['Bicicleta de ruta rodada 26', 2999],
    ['Caminadora plegable', 4399], ['Set de mancuernas 2 piezas', 349], ['Tenis Galaxy 8 para correr, mujer', 1119], ['Maleta de viaje Kioto', 1019],
    ['Mochila escolar para niño', 314], ['Bolsa shoulder para mujer', 524], ['Cartera para hombre', 699], ['Reloj Hilfiger para hombre', 2474], ['Lentes de sol para hombre', 299],
    ['Aretes de oro 14 k', 583], ['Vestido largo de fiesta', 1890], ['Traje para hombre', 1217], ['Base de maquillaje líquida', 290], ['Crema facial calmante', 194],
    ['Shampoo anticaída', 208], ['Secadora de cabello InfinitiPro', 749], ['Recortadora de barba y bigote', 546], ['Cepillo de dientes eléctrico', 535], ['Asador de carbón ASA-1G', 569]];
  function sinAcentos(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  /** A qué ficha del corpus corresponde cada renglón del §9: por precio y por palabras del nombre. */
  L.emparejar = function () {
    var fichas = Object.keys(inv().fichas).filter(function (q) { return inv().fichas[q].ficha; }), usadas = {}, out = [], dudas = [];
    L.MUESTRA.forEach(function (m, i) {
      var pal = sinAcentos(m[0]).split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
      var cands = fichas.filter(function (q) { var p = inv().fichas[q].ficha.precio; return !usadas[q] && typeof p === 'number' && Math.abs(p - m[1]) < 1; })
        .map(function (q) { var f = inv().fichas[q].ficha, n = sinAcentos(f.nombre + ' ' + f.marca + ' ' + q); return { q: q, pts: pal.filter(function (w) { return n.indexOf(w) > -1; }).length }; })
        .sort(function (x, y) { return y.pts - x.pts; });
      if (!cands.length || cands[0].pts === 0 || (cands[1] && cands[1].pts === cands[0].pts)) dudas.push((i + 1) + ' ' + m[0] + ' $' + m[1] + ' → ' + (cands.map(function (c) { return c.q + '(' + c.pts + ')'; }).join(', ') || 'nada'));
      if (cands.length && cands[0].pts > 0) { usadas[cands[0].q] = 1; out.push(cands[0].q); } else out.push(null);
    });
    return { claves: out, dudas: dudas };
  };
  function limpio(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function djb2(t) { var h = 5381; for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h; }
  /**
   * Los datos de la hoja, una ficha por renglón (JSONL, el formato de datos-evaluacion.jsonl): la
   * unión de lo que recomiendan la 2.9 (`a`) y la nueva (`b`), con su posición en cada una (0 = no
   * la recomienda). Va en JSON y no en columnas porque get_page_text aplana los tabuladores.
   * `huellas` (djb2 por renglón) sirve para comprobar que la copia al disco quedó igual.
   */
  L.evaluacion = function () {
    var e = L.emparejar(), a = L.medir('v29', {}), b = L.medir('n', {}), I = L.info(), lineas = [], n = 0;
    var enMuestra = {}; e.claves.forEach(function (q) { if (q) enMuestra[q] = 1; });
    var bloques = [{ nombre: 'muestra', claves: e.claves.filter(Boolean) },
      { nombre: 'nuevas', claves: Object.keys(b).filter(function (q) { return !enMuestra[q] && L.NUEVAS.indexOf(b[q].clase) > -1; }) }];
    bloques.forEach(function (bl) { bl.claves.forEach(function (q) {
      n++; var f = inv().fichas[q].ficha, ra = (a[q] || { cruz: [] }).cruz, rb = (b[q] || { cruz: [] }).cruz, vistos = {}, orden = [];
      var ficha = { f: n, bloque: bl.nombre, consulta: q, id: String(f.id), precio: f.precio, claseA: (a[q] && a[q].clase) || null, claseB: (b[q] && b[q].clase) || null,
        marca: limpio(f.marca), nombre: limpio(f.nombre), recs: [] };
      ra.forEach(function (r, i) { vistos[r.id] = { r: r, a: i + 1, b: 0 }; orden.push(r.id); });
      rb.forEach(function (r, i) { if (vistos[r.id]) vistos[r.id].b = i + 1; else { vistos[r.id] = { r: r, a: 0, b: i + 1 }; orden.push(r.id); } });
      orden.forEach(function (id) { var v = vistos[id], r = v.r, x = I[id] || {};
        ficha.recs.push({ id: String(r.id), a: v.a, b: v.b, tipo: r.tipo, precio: r.precio, cal: x.nOp > 0 && x.cal != null ? x.cal : null, nOp: x.nOp || 0, mkp: !!x.mkp,
          origen: r.origen, marca: limpio(r.marca), nombre: limpio(r.nombre) }); });
      lineas.push(JSON.stringify(ficha));
    }); });
    return { dudas: e.dudas, fichas: n, texto: lineas.join('\n'), huellas: lineas.map(djb2), huella: djb2(lineas.join('\n')) };
  };
})();
