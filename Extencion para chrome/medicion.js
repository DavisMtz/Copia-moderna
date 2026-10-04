/**
 * =============================================================================
 * Ventel · Medición de «Vende más» — la página (medicion.js)
 * =============================================================================
 * Pinta lo que medicion-local.js lleva contado en chrome.storage.local
 * ['vmMedicion'] de ESTE navegador. No pide nada a ningún sitio: lee el almacén,
 * escribe en la página y, si el asesor lo pide, copia el resumen al portapapeles.
 *
 * Todo se escribe con textContent: aquí no entra HTML de fuera.
 *
 * Hecho para Ventel · v1.0 · 04/10/2026
 */
(function () {
  'use strict';

  var M = window.VentelMedicion;
  var REGLAS = (typeof VENTEL_REGLAS !== 'undefined') ? VENTEL_REGLAS : null;
  if (!M) return;

  var $ = function (id) { return document.getElementById(id); };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var actual = null;        // el estado guardado, tal cual
  var confirmando = null;   // el temporizador de «¿Seguro?»

  function leer() {
    return new Promise(function (ok) {
      try {
        chrome.storage.local.get([M.CLAVE], function (r) { ok((chrome.runtime.lastError || !r) ? null : r[M.CLAVE]); });
      } catch (e) { ok(null); }
    });
  }
  function guardar(e) {
    return new Promise(function (ok) {
      var o = {}; o[M.CLAVE] = e;
      try { chrome.storage.local.set(o, function () { ok(); }); } catch (x) { ok(); }
    });
  }

  function el(etiqueta, clase, texto) {
    var n = document.createElement(etiqueta);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = String(texto);
    return n;
  }
  function vaciar(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function miles(n) { return Number(n || 0).toLocaleString('es-MX'); }

  /** «lun 5 oct», de «2026-10-05» (la fecha ya viene en hora local). */
  function diaBonito(k) {
    var p = String(k).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? k : DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()];
  }
  function fechaLarga(ms) {
    var d = new Date(ms);
    return d.getDate() + ' de ' + ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][d.getMonth()] + ' de ' + d.getFullYear();
  }

  /**
   * La tasa con su margen: «8.3 % (± 4.5)». El margen es el del intervalo de 95 %
   * para una proporción; con menos de 30 mostradas no se da tasa: sería inventar.
   */
  function tasa(n, de) {
    if (!de) return null;
    if (de < 30) return { texto: 'muy pocas para una tasa', corta: '—' };
    var p = n / de;
    var margen = 1.96 * Math.sqrt(p * (1 - p) / de) * 100;
    var pct = (Math.round(p * 1000) / 10).toLocaleString('es-MX') + ' %';
    return { texto: pct + ' (± ' + (Math.round(margen * 10) / 10).toLocaleString('es-MX') + ')', corta: pct };
  }

  /** «Celulares · Funda», de «smartphone/funda» (con las reglas de la extensión). */
  function nombreDeTipo(clave) {
    var p = String(clave || '').split('/');
    if (!REGLAS || p.length !== 2) return clave;
    for (var i = 0; i < REGLAS.clases.length; i++) {
      var c = REGLAS.clases[i];
      if (c.id !== p[0]) continue;
      for (var j = 0; j < c.complementos.length; j++) {
        if (c.complementos[j].tipo === p[1]) return c.nombre + ' · ' + c.complementos[j].etiqueta;
      }
      return c.nombre + ' · ' + p[1];
    }
    return clave;
  }

  function paso(cifra, etiqueta, pie, fuerte) {
    var caja = el('div', 'paso');
    caja.appendChild(el('span', 'paso-cifra', miles(cifra)));
    caja.appendChild(el('span', 'paso-etiqueta', etiqueta));
    var linea = el('span', 'paso-tasa');
    if (fuerte) { linea.appendChild(el('strong', null, fuerte)); linea.appendChild(document.createTextNode(' ' + pie)); }
    else linea.textContent = pie;
    caja.appendChild(linea);
    return caja;
  }
  function tarjeta(cifra, etiqueta) {
    var caja = el('div', 'tarjeta-resumen');
    caja.appendChild(el('span', 'tarjeta-cifra', cifra));
    caja.appendChild(el('span', 'tarjeta-etiqueta', etiqueta));
    return caja;
  }
  function tabla(encabezados, filas) {
    var envoltura = el('div', 'tabla-scroll'), t = el('table', 'tabla-variantes');
    var cab = el('thead'), tr = el('tr');
    encabezados.forEach(function (h, i) { var th = el('th', i ? 'num' : null, h); th.scope = 'col'; tr.appendChild(th); });
    cab.appendChild(tr); t.appendChild(cab);
    var cuerpo = el('tbody');
    filas.forEach(function (f) {
      var r = el('tr', f.clase || null);
      f.celdas.forEach(function (c, i) {
        var td = el(i ? 'td' : 'th', i ? 'num' + (c && c.gris ? ' tasa-celda' : '') : null, c && c.gris ? c.texto : c);
        if (!i) td.scope = 'row';
        r.appendChild(td);
      });
      cuerpo.appendChild(r);
    });
    t.appendChild(cuerpo); envoltura.appendChild(t);
    return envoltura;
  }

  function pintar(estado) {
    actual = estado;
    var r = M.resumen(estado), t = r.total;
    $('origen').textContent = (r.desde ? 'Desde el ' + fechaLarga(r.desde) + ' · ' : '') + 'solo en este navegador';

    var avisos = $('avisos');
    vaciar(avisos);
    if (r.pausada) {
      var a = el('div', 'alerta alerta-aviso');
      a.appendChild(el('strong', null, 'La medición está en pausa'));
      a.appendChild(document.createTextNode('La tarjeta sigue funcionando igual; solo dejó de contar. Toca «Reanudar» para que vuelva a hacerlo.'));
      avisos.appendChild(a);
    }
    $('btnPausar').textContent = r.pausada ? 'Reanudar' : 'Pausar';

    var hay = t.tarjetas > 0;
    $('vacio').hidden = hay;
    $('contenido').hidden = !hay;
    $('btnCopiar').disabled = !hay;
    $('btnBorrar').disabled = !hay;
    if (!hay) return;

    var embudo = $('embudo');
    vaciar(embudo);
    var tc = tasa(t.clics, t.mostradas), tb = tasa(t.enBolsa, t.mostradas);
    embudo.appendChild(paso(t.mostradas, 'recomendaciones mostradas', 'en ' + miles(t.conCruzada) + ' de ' + miles(t.tarjetas) + ' fichas con tarjeta'));
    embudo.appendChild(paso(t.clics, 'abiertas', tc ? (tc.corta === '—' ? tc.texto : 'de las mostradas') : 'de las mostradas', tc && tc.corta !== '—' ? tc.texto : null));
    embudo.appendChild(paso(t.enBolsa, 'en la bolsa en 60 minutos', tb ? (tb.corta === '—' ? tb.texto : 'de las mostradas') : 'de las mostradas', tb && tb.corta !== '—' ? tb.texto : null));

    var cifras = $('cifras');
    vaciar(cifras);
    cifras.appendChild(tarjeta(miles(t.subidas), 'subidas de versión mostradas'));
    cifras.appendChild(tarjeta(miles(t.subidasClic), 'subidas abiertas'));
    cifras.appendChild(tarjeta(miles(t.subidasEnBolsa), 'subidas en la bolsa'));
    cifras.appendChild(tarjeta(miles(t.chips), 'búsquedas sugeridas abiertas'));

    var dias = r.dias.slice().reverse().slice(0, 31);
    var cuerpoDias = $('secDias').querySelector('.seccion-cuerpo');
    vaciar(cuerpoDias);
    var filasDias = dias.map(function (d) {
      return { celdas: [diaBonito(d.dia), miles(d.tarjetas), miles(d.mostradas), miles(d.clics), miles(d.enBolsa), miles(d.subidas), miles(d.subidasClic)] };
    });
    filasDias.push({ clase: 'fila-total', celdas: ['Total', miles(t.tarjetas), miles(t.mostradas), miles(t.clics), miles(t.enBolsa), miles(t.subidas), miles(t.subidasClic)] });
    cuerpoDias.appendChild(tabla(['Día', 'Fichas con tarjeta', 'Mostradas', 'Abiertas', 'En la bolsa', 'Subidas mostradas', 'Subidas abiertas'], filasDias));
    if (r.dias.length > dias.length) cuerpoDias.appendChild(el('p', 'nota-seccion', 'Se ven los últimos 31 días; el total y «Copiar resumen» los llevan todos.'));

    var cuerpoTipos = $('secTipos').querySelector('.seccion-cuerpo');
    vaciar(cuerpoTipos);
    $('conteoTipos').textContent = r.tipos.length ? String(r.tipos.length) : '';
    if (!r.tipos.length) cuerpoTipos.appendChild(el('p', 'nota-seccion nota-arriba', 'Todavía no se ha mostrado ningún complemento.'));
    else {
      cuerpoTipos.appendChild(tabla(['Tipo', 'Mostradas', 'Abiertas', '% abiertas', 'En la bolsa', '% en la bolsa'], r.tipos.map(function (x) {
        var a = tasa(x.clics, x.mostradas), b = tasa(x.enBolsa, x.mostradas);
        return { celdas: [nombreDeTipo(x.tipo), miles(x.mostradas), miles(x.clics), { gris: true, texto: a ? a.corta : '' }, miles(x.enBolsa), { gris: true, texto: b ? b.corta : '' }] };
      })));
      cuerpoTipos.appendChild(el('p', 'nota-seccion', 'La tasa de un tipo aparece cuando lleva al menos 30 mostradas.'));
    }
  }

  var temporizadorAviso = null;
  function avisar(texto) {
    var a = $('aviso');
    a.textContent = texto;
    a.hidden = false;
    if (temporizadorAviso) clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(function () { a.hidden = true; }, 2600);
  }

  $('btnCopiar').addEventListener('click', function () {
    if (!actual) return;
    var texto = M.comoTexto(actual);
    var listo = function () { avisar('Resumen copiado: pégalo en una hoja de cálculo'); };
    var fallo = function () { avisar('No se pudo copiar el resumen'); };
    try { navigator.clipboard.writeText(texto).then(listo, fallo); } catch (e) { fallo(); }
  });

  $('btnPausar').addEventListener('click', function () {
    leer().then(function (e) {
      var r = M.resumen(e);
      var nuevo = (e && e.v === 1) ? e : { v: 1, desde: Date.now(), pausada: false, dias: {}, tipos: {}, recientes: [] };
      nuevo.pausada = !r.pausada;
      return guardar(nuevo).then(function () { pintar(nuevo); avisar(nuevo.pausada ? 'Medición en pausa' : 'Medición reanudada'); });
    });
  });

  // Borrar pide confirmar en el mismo botón (sin ventanas del navegador): el segundo
  // toque, dentro de unos segundos, es el que borra.
  $('btnBorrar').addEventListener('click', function () {
    var b = $('btnBorrar');
    if (!confirmando) {
      b.textContent = '¿Borrar todo? Toca otra vez';
      b.classList.add('btn-confirmar');
      confirmando = setTimeout(function () { confirmando = null; b.textContent = 'Borrar todo'; b.classList.remove('btn-confirmar'); }, 4000);
      return;
    }
    clearTimeout(confirmando); confirmando = null;
    b.textContent = 'Borrar todo'; b.classList.remove('btn-confirmar');
    var limpio = { v: 1, desde: Date.now(), pausada: !!(actual && actual.pausada), dias: {}, tipos: {}, recientes: [] };
    guardar(limpio).then(function () { pintar(limpio); avisar('Medición borrada'); });
  });

  // Si la tarjeta cuenta algo mientras esta página está abierta, se actualiza sola.
  try {
    chrome.storage.onChanged.addListener(function (cambios, area) {
      if (area === 'local' && cambios[M.CLAVE]) pintar(cambios[M.CLAVE].newValue || null);
    });
  } catch (e) { /* sin contexto de extensión */ }

  leer().then(pintar);
})();
