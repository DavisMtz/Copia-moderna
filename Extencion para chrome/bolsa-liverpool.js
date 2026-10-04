/**
 * =============================================================================
 * Ventel · Vende más — la bolsa del cliente (bolsa-liverpool.js)
 * =============================================================================
 * Desde la 3.0 la tarjeta sabe qué lleva ya el cliente en la bolsa: en la ficha
 * de un accesorio ofrece lo que le falta al EQUIPO que acaba de meter, y no
 * vuelve a ofrecer lo que ya lleva (recomendador-nucleo.js, contextoConBolsa).
 * La medición local usa la misma lectura para saber si una recomendación acabó
 * en la bolsa (medicion-local.js).
 *
 * La bolsa se lee de la misma página que abre el asesor (/tienda/cart, ~520 KB),
 * SIN abrirla y sin tocarla: solo un GET, nunca se agrega ni se quita nada.
 *
 * Las mismas reglas que el buscador, por lo mismo (un bloqueo de Liverpool le
 * quita al asesor el sitio entero en plena llamada), y dos más:
 *   · SOLO CUANDO CAMBIA. La cabecera de la ficha ya dice cuántos artículos hay
 *     (`header-cart-quantity`). Con cero no se pide nada. Con la misma cuenta que
 *     la última lectura, vale lo guardado (en chrome.storage.local, para todas las
 *     pestañas) durante 15 minutos.
 *   · DE LA MISMA SESIÓN. La misma cuenta no quiere decir la misma bolsa: el asesor
 *     cuelga y la siguiente llamada es de otro cliente, que también lleva un
 *     artículo. Por eso lo guardado lleva la huella de la sesión (`quien`: la
 *     atención del Panel del agente; la calcula recomendador.js) y solo vale si es
 *     la misma. Sin huella no se sabe de quién es, y lo guardado vale 3 minutos.
 *     (Lo destapó la prueba de punta a punta del 04/10/2026: la ficha de un
 *     adaptador tomó la bolsa de la prueba anterior.)
 *   · Ritmo: al menos 20 s entre dos lecturas y como mucho 12 por hora.
 *   · Freno: cualquier respuesta que no sea 200, o «Access Denied», apaga las
 *     lecturas Y las búsquedas 60 minutos (comparten el freno: vmBusquedaPausa).
 *   · Interruptor: el del Portal (ajustes.busqueda) también las apaga; eso lo
 *     decide recomendador.js antes de llamar, igual que con la búsqueda.
 * Y de la bolsa se guarda SOLO la lista de artículos (lector-liverpool.js): la
 * dirección y el pago del cliente no se leen.
 *
 * Aquí no hay DOM ni chrome.*: todo llega por `dep`, para probarlo en Node.
 *   dep.leer(claves) → Promise<obj>      dep.guardar(obj) → Promise
 *   dep.pedir(url)   → Promise<{ status, texto }>
 *   dep.leerBolsa(texto) → [{ id, sku, nombre, marca, precio, cantidad, agregado, enExistencia }] | null
 *   dep.ahora() → ms
 *
 * Hecho para Ventel · v1.0 · 04/10/2026
 */
(function (raiz) {
  'use strict';

  var CLAVE = 'vmBolsa';
  var CLAVE_RITMO = 'vmBolsaRitmo';
  var CLAVE_PAUSA = 'vmBusquedaPausa';   // el mismo freno que la búsqueda
  var VIGENCIA = 15 * 60000;
  var VIGENCIA_SIN_HUELLA = 3 * 60000;
  var SEPARACION = 20000;
  var POR_HORA = 12;
  var PAUSA = 60 * 60000;
  var TOPE_ARTICULOS = 60;

  function crear(dep) {
    var enVuelo = null, clavesEnVuelo = '';

    /** Lo último que se supo de la bolsa, sin salir a la red: { cuenta, quien, en, items } o null. */
    function guardada() {
      return dep.leer([CLAVE]).then(function (r) {
        var g = r[CLAVE];
        return g && typeof g.en === 'number' ? g : null;
      });
    }

    /**
     * La bolsa para la cuenta que enseña la cabecera y la sesión `quien` (su huella,
     * o '' si no se sabe). Devuelve { items, de } con `de`: 'vacia' | 'cache' |
     * 'red', o { items, motivo } si no se pudo leer ahora (`items` es entonces lo
     * guardado si es de la misma cuenta y la misma sesión, o null).
     */
    function leer(cuenta, quien) {
      cuenta = typeof cuenta === 'number' && cuenta >= 0 ? Math.round(cuenta) : null;
      quien = typeof quien === 'string' ? quien : '';
      if (cuenta === null) return Promise.resolve({ items: null, motivo: 'sin-cuenta' });
      if (cuenta === 0) {
        var vacia = {}; vacia[CLAVE] = { cuenta: 0, quien: quien, en: dep.ahora(), items: [] };
        return dep.guardar(vacia).then(function () { return { items: [], de: 'vacia' }; });
      }
      if (enVuelo && clavesEnVuelo === cuenta + '|' + quien) return enVuelo;
      var p = dep.leer([CLAVE, CLAVE_PAUSA, CLAVE_RITMO]).then(function (r) {
        var ahora = dep.ahora();
        var g = r[CLAVE] && r[CLAVE].cuenta === cuenta && (r[CLAVE].quien || '') === quien ? r[CLAVE] : null;
        if (g && ahora - g.en < (quien ? VIGENCIA : VIGENCIA_SIN_HUELLA)) return { items: g.items || null, de: 'cache' };
        // Vieja, pero de la misma cuenta y la misma sesión: sirve de respaldo si ahora no se puede
        // leer (cada artículo lleva su hora). Sin huella no hay respaldo: no se sabe de quién era.
        var deRespaldo = g && quien ? (g.items || null) : null;
        if (r[CLAVE_PAUSA] && r[CLAVE_PAUSA] > ahora) return { items: deRespaldo, motivo: 'pausa' };
        var ritmo = (r[CLAVE_RITMO] || []).filter(function (t) { return ahora - t < 3600000; });
        var ultima = ritmo.length ? Math.max.apply(null, ritmo) : 0;
        if (ahora - ultima < SEPARACION || ritmo.length >= POR_HORA) return { items: deRespaldo, motivo: 'ritmo' };
        ritmo.push(ahora);
        var marca = {}; marca[CLAVE_RITMO] = ritmo;
        return dep.guardar(marca).then(function () {
          return dep.pedir('/tienda/cart').then(null, function () { return null; });
        }).then(function (resp) {
          var bloqueada = !resp || resp.status !== 200 || /access denied/i.test(String(resp.texto || '').slice(0, 3000));
          if (bloqueada) {
            var freno = {}; freno[CLAVE_PAUSA] = dep.ahora() + PAUSA;
            return dep.guardar(freno).then(function () { return { items: deRespaldo, motivo: 'freno' }; });
          }
          var items = null;
          try { items = dep.leerBolsa(resp.texto); } catch (e) { items = null; }
          // Una página que contestó bien pero no trae una bolsa legible (cambió el formato) no es
          // un bloqueo: se anota el intento para no volver a pedir 520 KB cada 20 segundos.
          var nuevo = {};
          nuevo[CLAVE] = { cuenta: cuenta, quien: quien, en: dep.ahora(), items: Array.isArray(items) ? items.slice(0, TOPE_ARTICULOS) : null };
          return dep.guardar(nuevo).then(function () {
            return Array.isArray(items) ? { items: nuevo[CLAVE].items, de: 'red' } : { items: null, motivo: 'ilegible' };
          });
        });
      }).then(function (res) { enVuelo = null; return res; }, function () { enVuelo = null; return { items: null, motivo: 'error' }; });
      enVuelo = p;
      clavesEnVuelo = cuenta + '|' + quien;
      return p;
    }

    return { leer: leer, guardada: guardada };
  }

  raiz.VentelBolsa = {
    crear: crear,
    VIGENCIA: VIGENCIA, VIGENCIA_SIN_HUELLA: VIGENCIA_SIN_HUELLA, SEPARACION: SEPARACION, POR_HORA: POR_HORA, PAUSA: PAUSA,
    CLAVES: { bolsa: CLAVE, ritmo: CLAVE_RITMO, pausa: CLAVE_PAUSA }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
