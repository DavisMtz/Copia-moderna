/**
 * =================================================================================================
 * PREFERENCIAS DE USUARIO | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Guarda la personalización de cada persona —tema, tamaño de texto, densidad, accesos fijados,
 * ajustes del marco lateral— en DOS sitios, y con dos propósitos distintos:
 *
 *   LOCAL (localStorage, del lado del cliente)   Es lo que se lee al pintar. Tiene que estar
 *                                                disponible ANTES del primer fotograma o la
 *                                                pantalla parpadea: se ve el tema claro y medio
 *                                                segundo después salta al oscuro.
 *
 *   NUBE (esta hoja)                             Es lo que hace que la personalización siga a la
 *                                                persona: otro equipo, el navegador de la tienda,
 *                                                un perfil nuevo. Sin esto, "mis ajustes" son en
 *                                                realidad "los ajustes de este navegador".
 *
 * UNA LÍNEA POR PERSONA. No un renglón por cambio: un cambio de tema no es un hecho que haya que
 * conservar, es un estado que se sustituye. Un histórico aquí crecería sin tope (cada clic en el
 * tamaño de letra sería una fila) y no lo lee nadie; para saber quién cambió qué está la bitácora
 * de la consola, que es donde esa pregunta sí tiene sentido.
 *
 * ── POR QUÉ NO SE GUARDA "AL VUELO Y ESPERANDO" ─────────────────────────────────────────────────
 *
 * El flujo evidente sería: el usuario cambia algo → se pide la escritura → se espera la
 * confirmación → se recarga con lo nuevo. Es correcto y se comporta mal, por dos motivos que solo
 * se ven con la app delante:
 *
 *   1. Un google.script.run tarda entre 300 ms y un segundo largo. Ese es el tiempo que estaría
 *      congelado el botón del tamaño de letra. Ajustar la letra es una tarea de tanteo —se pulsa
 *      tres o cuatro veces seguidas hasta dar con el tamaño— y con espera bloqueante se convierte
 *      en cuatro segundos de esperas encadenadas.
 *
 *   2. Recargar la página para aplicar un cambio propio es tirar el trabajo en curso. Si alguien
 *      sube el contraste a mitad de una cotización, la recarga se lleva por delante el formulario.
 *
 * ── LO QUE SE HACE EN SU LUGAR: ESCRITURA OPTIMISTA ─────────────────────────────────────────────
 *
 *      1. Se aplica al instante en pantalla y se escribe en localStorage (síncrono, 0 ms).
 *      2. La escritura a la hoja se encola y sale agrupada un momento después.
 *      3. Al confirmarse, solo se guarda la versión que devolvió el servidor. NO se recarga:
 *         lo local ya ES lo nuevo, recargar solo repintaría lo mismo.
 *      4. Si falla de verdad, se revierte y se avisa. Ese es el único caso en que la persona se
 *         entera de que existe una nube detrás.
 *
 * El usuario nunca espera. La hoja acaba con el mismo contenido que tendría con el flujo
 * bloqueante, porque el orden de las escrituras se respeta (ver la cola en app_prefs.html).
 *
 * ── CONFLICTOS: SE RESUELVEN POR CAMPO, NO POR DOCUMENTO ────────────────────────────────────────
 *
 * Dos pestañas abiertas es el caso normal, no el raro. Si cada una guardara el bloque entero, la
 * segunda en escribir borraría el cambio de la primera aunque hubieran tocado cosas distintas:
 * subes el contraste en una pestaña, cambias el tema en la otra, y el contraste se pierde sin que
 * nadie haya pedido deshacerlo.
 *
 * Por eso cada campo viaja con su marca de tiempo y la fusión es campo por campo: gana el más
 * reciente de CADA UNO. Dos cambios simultáneos sobre campos distintos conviven; sobre el mismo
 * campo gana el último, que es lo que cualquiera esperaría.
 *
 * Todas las funciones llevan el prefijo prefs* para no chocar con nada.
 */

// ── FORMA DE LA HOJA ─────────────────────────────────────────────────────────

const PREFS_HOJA = '_PreferenciasUsuario';
const PREFS_HOJA_COLUMNAS = ['Email', 'Preferencias', 'Version', 'Actualizado'];

/** Tope de tamaño del JSON de una persona. Ver prefsValidar_ para el porqué. */
const PREFS_MAX_BYTES = 4000;

/** Cuánto se cachea la fila de una persona (segundos). */
const PREFS_TTL_CACHE = 300;

// ── CATÁLOGO DE PREFERENCIAS ─────────────────────────────────────────────────
//
// Nada que no esté aquí se guarda. Es deliberado y es la única defensa real de esta hoja: el
// cliente puede mandar lo que quiera —basta abrir la consola del navegador— y sin una lista
// blanca, esta hoja se convierte en almacenamiento gratis de cualquier cosa que a alguien se le
// ocurra colgar de las preferencias, con el nombre de la persona al lado.
//
//   clave     cómo se llama en el cliente y en el JSON.
//   tipo      'opcion' (una de una lista) | 'bandera' (sí/no) | 'lista' (varios textos cortos)
//   valores   opciones admitidas cuando el tipo es 'opcion'.
//   por       valor por omisión. Lo que se aplica cuando esa persona nunca lo ha tocado.
//   tope      número máximo de elementos cuando el tipo es 'lista'.

const PREFS_CAMPOS = [
  { clave: 'tema',        tipo: 'opcion',  valores: ['aurora', 'slate', 'carbon'], por: 'aurora' },
  { clave: 'densidad',    tipo: 'opcion',  valores: ['cozy', 'compact'],           por: 'cozy' },
  { clave: 'textscale',   tipo: 'opcion',  valores: ['sm', 'md', 'lg', 'xl'],      por: 'md' },
  { clave: 'contraste',   tipo: 'opcion',  valores: ['0', '1'],                    por: '0' },
  // Accesos fijados por la persona en su inicio. Son claves de pantalla o de sección, cortas.
  { clave: 'fijados',     tipo: 'lista',   tope: 12,                               por: [] },
  // Marco lateral recogido. Quien trabaja en un portátil de 13" lo deja plegado siempre.
  { clave: 'menuPlegado', tipo: 'bandera',                                         por: false },
  // Pantalla a la que llevar al entrar, dentro de las que esa persona puede abrir. Se valida
  // contra sus permisos AL USARLA, no aquí: los permisos cambian y la preferencia no debería
  // borrarse sola porque alguien perdió un bloque una semana.
  { clave: 'inicio',      tipo: 'texto',   tope: 40,                               por: '' },
  // Onboarding: recorridos ya vistos, para no repetirlos en cada equipo nuevo.
  { clave: 'vistos',      tipo: 'lista',   tope: 24,                               por: [] }
];

const PREFS_INDICE_CAMPOS = (function () {
  const m = {};
  PREFS_CAMPOS.forEach(function (c) { m[c.clave] = c; });
  return m;
})();

/** Valores por omisión, listos para mandar al cliente. */
function prefsPorOmision_() {
  const out = {};
  PREFS_CAMPOS.forEach(function (c) {
    out[c.clave] = (c.tipo === 'lista') ? c.por.slice() : c.por;
  });
  return out;
}

// ── VALIDACIÓN ───────────────────────────────────────────────────────────────

/**
 * Limpia lo que llega del cliente y devuelve solo lo válido.
 *
 * Se descarta en silencio en vez de rechazar la llamada entera. Un campo desconocido casi siempre
 * significa que esa pestaña tiene una versión anterior de la app y manda una preferencia que ya no
 * existe; tumbar el guardado por eso dejaría a esa persona sin poder guardar NINGUNA preferencia
 * hasta que recargue, cuando lo correcto es guardar las que sí entiende.
 *
 * @param {object} crudo  { clave: valor, ... }
 * @return {object} solo las claves conocidas, con el valor ya normalizado.
 */
function prefsValidar_(crudo) {
  const out = {};
  if (!crudo || typeof crudo !== 'object') return out;

  Object.keys(crudo).forEach(function (clave) {
    const def = PREFS_INDICE_CAMPOS[clave];
    if (!def) return;
    const v = crudo[clave];

    if (def.tipo === 'opcion') {
      const s = String(v == null ? '' : v);
      if (def.valores.indexOf(s) !== -1) out[clave] = s;

    } else if (def.tipo === 'bandera') {
      out[clave] = (v === true || v === 'true' || v === 1 || v === '1');

    } else if (def.tipo === 'texto') {
      const s = String(v == null ? '' : v).trim().slice(0, def.tope || 60);
      out[clave] = s;

    } else if (def.tipo === 'lista') {
      if (!Array.isArray(v)) return;
      const vistos = {};
      const lista = [];
      v.forEach(function (x) {
        // Cada elemento es una clave corta, no texto libre: se recorta a 60 caracteres y se
        // quitan los duplicados. Sin el tope, una lista de "fijados" con textos largos llenaría
        // los 4 KB de la celda ella sola.
        const s = String(x == null ? '' : x).trim().slice(0, 60);
        if (!s || vistos[s]) return;
        vistos[s] = true;
        if (lista.length < (def.tope || 20)) lista.push(s);
      });
      out[clave] = lista;
    }
  });

  return out;
}

// ── HOJA ─────────────────────────────────────────────────────────────────────

/**
 * La hoja de preferencias, creándola si hace falta.
 * Oculta a propósito: es estado de la aplicación, no algo que nadie deba editar a mano.
 */
function prefsHoja_(crear) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(PREFS_HOJA);
  if (hoja) return hoja;
  if (!crear) return null;

  hoja = ss.insertSheet(PREFS_HOJA);
  hoja.getRange(1, 1, 1, PREFS_HOJA_COLUMNAS.length).setValues([PREFS_HOJA_COLUMNAS]);
  hoja.setFrozenRows(1);
  hoja.getRange(1, 1, 1, PREFS_HOJA_COLUMNAS.length).setFontWeight('bold');
  // La columna del JSON se deja ancha pero sin ajuste de línea: si se envuelve, una fila ocupa
  // media pantalla y la hoja se vuelve imposible de ojear cuando hay que mirarla de verdad.
  hoja.setColumnWidth(2, 420);
  try { hoja.hideSheet(); } catch (e) {}
  return hoja;
}

/** Clave de caché por persona. */
function prefsClaveCache_(correo) {
  return 'prefs_' + String(correo || '').toLowerCase();
}

/**
 * Fila de una persona: { fila, valores, sellos, version } o null si no tiene.
 * `fila` es el número de renglón en la hoja, para poder escribir sin volver a buscar.
 */
function prefsLeerFila_(correo) {
  const objetivo = String(correo || '').trim().toLowerCase();
  if (!objetivo) return null;

  const hoja = prefsHoja_(false);
  if (!hoja || hoja.getLastRow() < 2) return null;

  // Una sola lectura de rango. Leer celda por celda en un bucle es lo que de verdad hace lentas
  // a las webapps de Apps Script, muy por encima de cualquier caché que se ponga encima.
  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, PREFS_HOJA_COLUMNAS.length).getValues();
  for (let i = 0; i < datos.length; i++) {
    if (String(datos[i][0] || '').trim().toLowerCase() !== objetivo) continue;
    const guardado = prefsParsear_(datos[i][1]);
    return {
      fila: i + 2,
      valores: guardado.valores,
      sellos: guardado.sellos,
      version: Number(datos[i][2]) || 0
    };
  }
  return null;
}

/**
 * Interpreta la celda. Nunca lanza: una celda corrupta —alguien la editó a mano, un guardado a
 * medias— tiene que degradar a "esta persona no tiene preferencias", que es un estado del que la
 * app sabe salir sola, y no reventar el arranque de su sesión.
 */
function prefsParsear_(texto) {
  const vacio = { valores: {}, sellos: {} };
  if (!texto) return vacio;
  try {
    const o = JSON.parse(String(texto));
    if (!o || typeof o !== 'object') return vacio;
    return {
      valores: prefsValidar_(o.v || {}),
      sellos: (o.t && typeof o.t === 'object') ? o.t : {}
    };
  } catch (e) {
    return vacio;
  }
}

/** Serializa valores + sellos para la celda. */
function prefsSerializar_(valores, sellos) {
  return JSON.stringify({ v: valores, t: sellos });
}

// ── LECTURA ──────────────────────────────────────────────────────────────────

/**
 * Preferencias de quien está en sesión, con los valores por omisión ya aplicados.
 *
 * El cliente recibe SIEMPRE el juego completo: así no tiene que saberse los valores por omisión ni
 * mantener una segunda copia de esa tabla, que es de donde salen las diferencias entre lo que
 * pinta el servidor y lo que pinta el navegador.
 *
 * @param {string} email Correo de la sesión del portal.
 */
function prefsLeer(email) {
  try {
    const id = secIdentidad_(email);
    if (!id.ok) return { success: false, message: id.error || 'Tu sesión no es válida.' };

    const cache = CacheService.getUserCache();
    const clave = prefsClaveCache_(id.email);
    let guardado = null;

    try {
      const crudo = cache.get(clave);
      if (crudo) guardado = JSON.parse(crudo);
    } catch (e) { guardado = null; }

    if (!guardado) {
      const fila = prefsLeerFila_(id.email);
      guardado = fila
        ? { valores: fila.valores, sellos: fila.sellos, version: fila.version }
        : { valores: {}, sellos: {}, version: 0 };
      try { cache.put(clave, JSON.stringify(guardado), PREFS_TTL_CACHE); } catch (e) {}
    }

    const prefs = prefsPorOmision_();
    Object.keys(guardado.valores || {}).forEach(function (k) { prefs[k] = guardado.valores[k]; });

    return {
      success: true,
      prefs: prefs,
      sellos: guardado.sellos || {},
      version: guardado.version || 0,
      // Se manda el catálogo para que la pantalla de ajustes pueda pintarse sola y para que el
      // cliente valide con los MISMOS criterios antes de enviar. Es una copia, sí, pero generada
      // desde aquí en cada carga: no puede quedarse desfasada como lo haría una lista escrita a
      // mano en el JavaScript.
      campos: PREFS_CAMPOS.map(function (c) {
        return { clave: c.clave, tipo: c.tipo, valores: c.valores || null,
                 por: (c.tipo === 'lista') ? c.por.slice() : c.por, tope: c.tope || 0 };
      })
    };
  } catch (e) {
    Logger.log('prefsLeer error: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos leer tus preferencias.' };
  }
}

// ── ESCRITURA ────────────────────────────────────────────────────────────────

/**
 * Guarda un puñado de preferencias. Fusiona campo por campo con lo que ya hay.
 *
 * @param {string} email    Correo de la sesión.
 * @param {object} cambios  { clave: valor, ... } — solo lo que cambió, no el juego entero.
 * @param {object=} sellos  { clave: msDesdeEpoch } — cuándo se tocó cada campo EN EL CLIENTE.
 *        Se manda el momento del clic y no el de la llamada porque entre uno y otro puede pasar
 *        casi un segundo, y en ese hueco cabe perfectamente el guardado de otra pestaña. Sin este
 *        dato, quien llegara segundo a la hoja ganaría aunque su clic hubiera sido antes.
 */
function prefsGuardar(email, cambios, sellos) {
  try {
    const id = secIdentidad_(email);
    if (!id.ok) return { success: false, message: id.error || 'Tu sesión no es válida.' };

    const limpios = prefsValidar_(cambios);
    if (!Object.keys(limpios).length) {
      return { success: false, message: 'No había ninguna preferencia válida que guardar.' };
    }

    const ahora = Date.now();
    const sellosNuevos = {};
    Object.keys(limpios).forEach(function (k) {
      const s = Number(sellos && sellos[k]);
      // Un sello del futuro sería un reloj mal puesto en el equipo de esa persona, y dejaría su
      // último cambio ganando para siempre sobre los de las demás pestañas. Se acota al momento
      // del servidor, que es el único reloj en el que se puede confiar aquí.
      sellosNuevos[k] = (s && s > 0 && s <= ahora) ? s : ahora;
    });

    // El bloqueo cubre leer-fusionar-escribir. Sin él, dos pestañas que guardan a la vez leen la
    // misma versión, fusionan cada una sobre esa base y la segunda escribe encima: el cambio de
    // la primera desaparece aunque la fusión por campo estuviera bien hecha.
    const lock = LockService.getScriptLock();
    try { lock.waitLock(15000); } catch (e) {
      return { success: false, message: 'El sistema está ocupado. Vuelve a intentarlo.' };
    }

    try {
      const hoja = prefsHoja_(true);
      const actual = prefsLeerFila_(id.email);

      const valores = (actual && actual.valores) || {};
      const sellosViejos = (actual && actual.sellos) || {};

      Object.keys(limpios).forEach(function (k) {
        const anterior = Number(sellosViejos[k]) || 0;
        // Fusión por campo: solo se pisa si este cambio es MÁS NUEVO que el que ya estaba. Un
        // reintento de la cola del cliente que llega tarde —porque la red se cayó a mitad— no
        // debe deshacer algo que la persona cambió después.
        if (sellosNuevos[k] >= anterior) {
          valores[k] = limpios[k];
          sellosViejos[k] = sellosNuevos[k];
        }
      });

      const texto = prefsSerializar_(valores, sellosViejos);
      if (texto.length > PREFS_MAX_BYTES) {
        return { success: false, message: 'Tus preferencias ocupan demasiado. Quita algún acceso fijado.' };
      }

      const version = ((actual && actual.version) || 0) + 1;
      const fecha = new Date();

      if (actual) {
        hoja.getRange(actual.fila, 1, 1, PREFS_HOJA_COLUMNAS.length)
            .setValues([[id.email, texto, version, fecha]]);
      } else {
        hoja.appendRow([id.email, texto, version, fecha]);
      }

      // La caché se invalida en cuanto la escritura sale bien. Es lo único que evita el clásico
      // "lo guardé y sigue saliendo lo de antes" al abrir otra pantalla dentro del TTL.
      try { CacheService.getUserCache().remove(prefsClaveCache_(id.email)); } catch (e) {}

      const prefs = prefsPorOmision_();
      Object.keys(valores).forEach(function (k) { prefs[k] = valores[k]; });

      // Se devuelve el juego COMPLETO ya fusionado, no un "ok". Así el cliente puede reconciliar
      // sin una segunda llamada, y si otra pestaña había cambiado algo por su cuenta, esa
      // respuesta lo trae de vuelta: la confirmación del guardado es también la sincronización.
      return { success: true, prefs: prefs, sellos: sellosViejos, version: version };

    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    Logger.log('prefsGuardar error: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos guardar tus preferencias.' };
  }
}

/**
 * Devuelve las preferencias a su estado de fábrica. Existe porque la salida a mano —desmarcar
 * doce casillas— es justo cuando alguien acaba dejándose media configuración a medias.
 */
function prefsRestablecer(email) {
  try {
    const id = secIdentidad_(email);
    if (!id.ok) return { success: false, message: id.error || 'Tu sesión no es válida.' };

    const lock = LockService.getScriptLock();
    try { lock.waitLock(15000); } catch (e) {
      return { success: false, message: 'El sistema está ocupado. Vuelve a intentarlo.' };
    }
    try {
      const actual = prefsLeerFila_(id.email);
      if (actual) {
        const hoja = prefsHoja_(true);
        const version = (actual.version || 0) + 1;
        // Se deja la fila con el JSON vacío en vez de borrarla: conserva la versión, y así una
        // pestaña que tuviera datos viejos ve que hay algo MÁS NUEVO que lo suyo y adopta el
        // restablecimiento, en vez de creerse la única fuente y volver a subir lo de antes.
        hoja.getRange(actual.fila, 1, 1, PREFS_HOJA_COLUMNAS.length)
            .setValues([[id.email, prefsSerializar_({}, {}), version, new Date()]]);
        try { CacheService.getUserCache().remove(prefsClaveCache_(id.email)); } catch (e) {}
        return { success: true, prefs: prefsPorOmision_(), sellos: {}, version: version };
      }
      return { success: true, prefs: prefsPorOmision_(), sellos: {}, version: 0 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  } catch (e) {
    Logger.log('prefsRestablecer error: ' + e);
    return { success: false, message: 'No pudimos restablecer tus preferencias.' };
  }
}

// ── DIAGNÓSTICO ──────────────────────────────────────────────────────────────

/**
 * Radiografía desde el editor: qué tiene guardado una persona y desde cuándo.
 * @param {string=} correo
 */
function prefsDiagnostico(correo) {
  const objetivo = secNormalizarCorreo_(correo) || secUsuarioGoogle_();
  Logger.log('═══ PREFERENCIAS ═══');

  const hoja = prefsHoja_(false);
  if (!hoja) {
    Logger.log('La hoja "' + PREFS_HOJA + '" todavía no existe. Se crea sola al primer guardado.');
    return { hoja: false };
  }
  Logger.log('Filas guardadas: ' + Math.max(0, hoja.getLastRow() - 1));

  if (!objetivo) {
    Logger.log('Sin correo que examinar. Llama a prefsDiagnostico("correo@dominio.com").');
    return { hoja: true };
  }

  const fila = prefsLeerFila_(objetivo);
  if (!fila) {
    Logger.log(objetivo + ' no tiene preferencias guardadas: usa todos los valores por omisión.');
    return { hoja: true, fila: null };
  }

  Logger.log('· ' + objetivo + ' · versión ' + fila.version + ' · renglón ' + fila.fila);
  PREFS_CAMPOS.forEach(function (c) {
    const tiene = Object.prototype.hasOwnProperty.call(fila.valores, c.clave);
    const v = tiene ? fila.valores[c.clave] : c.por;
    const sello = fila.sellos[c.clave] ? new Date(Number(fila.sellos[c.clave])).toISOString() : '—';
    Logger.log('    ' + c.clave + ': ' + JSON.stringify(v) +
               (tiene ? '  (tocado ' + sello + ')' : '  (por omisión)'));
  });
  return { hoja: true, fila: fila };
}
