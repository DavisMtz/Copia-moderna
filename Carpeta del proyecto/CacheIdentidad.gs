/**
 * =================================================================================================
 * CACHÉ DE IDENTIDAD | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Capa de caché para los DOS índices que resuelven quién es cada quien:
 *
 *   · secIndiceRegistros_()   (Seguridad.gs)  → hoja "Registros"          → QUIÉN eres
 *   · permIndicePermisos_()   (Permisos.gs)   → hoja "_PermisosSistema"   → QUÉ puedes hacer
 *
 * POR QUÉ EXISTE
 *
 * Los dos índices ya se guardaban en una variable global (SEC_REGISTROS_CACHE,
 * PERM_INDICE_CACHE), pero en Apps Script una global vive LO QUE DURA UNA EJECUCIÓN, y cada
 * google.script.run es una ejecución nueva. El memo servía dentro de una llamada y se tiraba al
 * acabar, así que TODA llamada al servidor releía las dos hojas enteras antes de hacer su trabajo.
 *
 * No fallaba nunca: solo hacía que todo tardara. Y crecía con la plantilla, porque cada persona
 * nueva alarga la hoja que se relee en cada clic de todo el mundo. Son 43 puntos del código los
 * que resuelven identidad; este archivo los abarata todos a la vez.
 *
 * Queda así:  memo de ejecución  →  CacheService (esto)  →  hoja
 *
 * POR QUÉ NO ESTÁ DENTRO DE Cache.gs
 *
 * Aquel archivo está documentado como "capa única de caché para las lecturas de la hoja de
 * Cotizaciones" y tiene su propio contador de generación. Meter identidad ahí haría que los dos
 * dominios compartieran contador: guardar una cotización tiraría la caché de permisos sin ningún
 * motivo, y al revés. Son ritmos de cambio distintos —una hoja se escribe todo el día, la otra
 * unas veces al mes— y por eso llevan contadores separados.
 *
 * LAS CUATRO REGLAS QUE HACEN QUE ESTA CACHÉ NO PUEDA MENTIR
 *
 *   1. INVALIDACIÓN POR ESCRITURA, no por tiempo. Toda función que escribe en "Registros" o en la
 *      hoja de permisos llama a idcInvalidar_(). Eso sube una "generación" que forma parte de
 *      todas las claves, así que la siguiente lectura no encuentra nada y va a la hoja.
 *   2. TTL CORTO ADEMÁS de lo anterior, como red de seguridad para quien edite la hoja a mano
 *      —que aquí pasa, y a menudo—. Ver IDC_TTL para el porqué del número.
 *   3. NUNCA SE CACHEA UN ÍNDICE VACÍO. Una hoja que falló al leerse y un sistema sin nadie dado
 *      de alta producen exactamente el mismo objeto vacío. Guardar el segundo dejaría a TODO EL
 *      MUNDO fuera del sistema durante el TTL, y sin ningún error que lo explicara.
 *   4. SI CacheService FALLA, SE LEE LA HOJA. La caché jamás puede ser la causa de que algo no
 *      funcione: quitarla entera solo hace la app más lenta.
 *
 * LA REGLA DE SEGURIDAD QUE NO SE PUEDE SALTAR
 *
 * permGuardarPermisos_ y permBorrarPermisos_ usan el campo `.fila` del índice PARA ESCRIBIR
 * (getRange(actual.fila…), deleteRow(actual.fila)). Un número de fila cacheado que ya no
 * corresponde —porque alguien borró una fila en la hoja a mano— haría que se escribieran los
 * permisos de una persona ENCIMA DE OTRA. Por eso esos dos caminos llaman a
 * permIndicePermisos_(true) y leen la hoja siempre. Es la diferencia entre que esta caché sea
 * una mejora o una corrupción de datos.
 */

// ── Parámetros ────────────────────────────────────────────────────────────────

var IDC_PREFIJO  = 'idc';
var IDC_GEN_PROP = 'IDC_CACHE_GEN';

/**
 * Vida de cada entrada, en segundos.
 *
 * Es SOLO una red de seguridad: todas las escrituras que pasan por la app invalidan de forma
 * explícita, así que un cambio hecho desde la Consola se aplica en la llamada siguiente y no
 * espera a esto. El TTL solo cubre el caso de quien edita la hoja a mano, por fuera del sistema.
 *
 * 600 s es el punto donde las dos cosas que importan se cruzan: con cien llamadas en diez minutos
 * se ahorran 99 de cada 100 lecturas de hoja (subirlo a seis horas ahorraría un 0.98 % más, que no
 * se nota), y una edición manual se cura sola en un descanso en vez de convertirse en el ticket de
 * "a fulano no le aparece el botón" que nadie sabe reproducir. Para no esperar ni eso, está
 * idcRefrescar().
 */
var IDC_TTL = 600;

/**
 * Tope de tamaño por entrada. CacheService admite ~100 KB por valor; por encima de esto NO se
 * cachea, se sirve leyendo la hoja.
 *
 * A diferencia de Cache.gs, aquí no hay troceado, y es deliberado: aquel archivo guarda TODAS las
 * cotizaciones y lo necesita, mientras que un índice de un centenar de personas ronda los 10 KB.
 * Añadir troceado sería código que no se ejercita nunca. Si el equipo crece por encima de las ~800
 * personas, la salida es copiar el troceado de Cache.gs, no subir este número.
 */
var IDC_MAX_BYTES = 90000;

/** Una sola lectura de propiedades por ejecución. */
var IDC_GEN_MEMO = null;

// ── Generación ────────────────────────────────────────────────────────────────

/** Generación actual. Cambia cada vez que alguien escribe en "Registros" o en la hoja de permisos. */
function idcGeneracion_() {
  if (IDC_GEN_MEMO !== null) return IDC_GEN_MEMO;
  try {
    IDC_GEN_MEMO = String(parseInt(PropertiesService.getScriptProperties().getProperty(IDC_GEN_PROP), 10) || 0);
  } catch (e) {
    // Sin propiedades no hay generación estable. Se usa 0 y manda el TTL.
    IDC_GEN_MEMO = '0';
  }
  return IDC_GEN_MEMO;
}

/**
 * Invalida TODA la caché de identidad y permisos.
 *
 * Llamar SIEMPRE DESPUÉS de una escritura correcta, nunca antes: si la escritura falla, lo que
 * hay cacheado sigue siendo la verdad y tirarlo solo provoca una relectura para obtener lo mismo.
 *
 * De paso limpia los memos de ejecución de los dos módulos, para que una función que escribe y
 * vuelve a leer dentro de la MISMA llamada —la Consola hace justo eso: guarda y devuelve la lista
 * ya actualizada— no se encuentre con el índice de antes del cambio.
 */
function idcInvalidar_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const siguiente = String(((parseInt(props.getProperty(IDC_GEN_PROP), 10) || 0) + 1) % 1000000);
    props.setProperty(IDC_GEN_PROP, siguiente);
    IDC_GEN_MEMO = siguiente;
  } catch (e) {
    // Sin generación no hay invalidación fina; el TTL corto acota el daño.
    Logger.log('idcInvalidar_: no se pudo subir la generación: ' + e.message);
  }

  // Los memos viven en otros archivos; se tocan con guarda por si el despliegue es parcial.
  try { if (typeof SEC_REGISTROS_CACHE !== 'undefined') SEC_REGISTROS_CACHE = null; } catch (e) {}
  try { if (typeof PERM_INDICE_CACHE  !== 'undefined') PERM_INDICE_CACHE  = null; } catch (e) {}
}

function idcClave_(nombre) {
  return IDC_PREFIJO + '_g' + idcGeneracion_() + '_' + nombre;
}

// ── Lectura y escritura ───────────────────────────────────────────────────────

/**
 * @param {string} nombre  Clave lógica ('registros' | 'permisos').
 * @return {?Object} el índice guardado, o null si no hay nada válido.
 */
function idcLeer_(nombre) {
  try {
    const crudo = CacheService.getScriptCache().get(idcClave_(nombre));
    if (!crudo) return null;
    const obj = JSON.parse(crudo);
    // Un objeto vacío no debería haberse guardado (ver idcGuardar_), pero si llegara de una
    // versión anterior se descarta: es indistinguible de "la hoja no se pudo leer".
    if (!obj || typeof obj !== 'object' || !Object.keys(obj).length) return null;
    return obj;
  } catch (e) {
    return null;   // caché caída o JSON corrupto: que lo resuelva la hoja
  }
}

/**
 * Guarda un índice. No guarda nada si viene vacío (regla 3) ni si no cabe (ver IDC_MAX_BYTES).
 * @param {string} nombre
 * @param {Object} indice
 */
function idcGuardar_(nombre, indice) {
  try {
    if (!indice || typeof indice !== 'object') return;

    // REGLA 3. Un índice vacío significa una de dos cosas —no hay nadie dado de alta, o la hoja
    // no se pudo leer— y desde aquí no se distinguen. Guardarlo dejaría a todo el mundo sin
    // acceso durante el TTL, con la hoja llena y sin un solo error en el registro.
    if (!Object.keys(indice).length) return;

    const json = JSON.stringify(indice);
    if (json.length > IDC_MAX_BYTES) {
      Logger.log('idcGuardar_ (' + nombre + '): ' + json.length + ' bytes, no cabe. Se sirve sin caché.');
      return;
    }
    CacheService.getScriptCache().put(idcClave_(nombre), json, IDC_TTL);
  } catch (e) {
    // Cuota, tamaño o servicio caído. No es fatal: simplemente no hay caché.
    Logger.log('idcGuardar_ (' + nombre + '): ' + e.message);
  }
}

// ── Utilidades para personas ──────────────────────────────────────────────────

/**
 * Fuerza que la próxima lectura vaya a la hoja. Es la salida para cuando alguien edita
 * "Registros" o la hoja de permisos A MANO y no quiere esperar los 600 s del TTL.
 *
 * Se puede ejecutar desde el editor de Apps Script sin miedo: lo peor que hace es provocar una
 * relectura de dos hojas.
 */
function idcRefrescar() {
  idcInvalidar_();
  Logger.log('Caché de identidad refrescada. La próxima llamada leerá las hojas.');
  return { success: true, generacion: idcGeneracion_() };
}

/**
 * Diagnóstico manual: ejecutar desde el editor para ver si la caché responde.
 * No forma parte del flujo de la app.
 */
function idcDiagnostico() {
  const antes = idcGeneracion_();

  // Ida y vuelta con un índice de mentira que sí tiene claves (uno vacío no se guarda a propósito).
  idcGuardar_('_diag', { 'prueba@ventel': { nombre: 'Prueba', fila: 2 } });
  const leido = idcLeer_('_diag');

  // Y el guardián de la regla 3: esto NO debe quedar guardado.
  idcGuardar_('_diag_vacio', {});
  const vacio = idcLeer_('_diag_vacio');

  idcInvalidar_();
  const despues = idcGeneracion_();

  const registros = (typeof secIndiceRegistros_ === 'function') ? secIndiceRegistros_() : {};
  const permisos  = (typeof permIndicePermisos_ === 'function') ? permIndicePermisos_()  : {};
  const bytesReg  = JSON.stringify(registros).length;
  const bytesPer  = JSON.stringify(permisos).length;

  Logger.log('Generación: %s → %s (deben ser distintas)', antes, despues);
  Logger.log('Escritura/lectura: %s', leido ? 'OK ✔' : 'FALLÓ ✖');
  Logger.log('Índice vacío rechazado: %s', vacio ? '✖ se guardó (mal)' : '✔');
  Logger.log('Tras invalidar, la clave vieja ya no se ve: %s', idcLeer_('_diag') ? '✖ sigue ahí' : '✔');
  Logger.log('Registros: %s personas · %s bytes (tope %s)', Object.keys(registros).length, bytesReg, IDC_MAX_BYTES);
  Logger.log('Permisos:  %s filas    · %s bytes (tope %s)', Object.keys(permisos).length,  bytesPer, IDC_MAX_BYTES);
  if (bytesReg > IDC_MAX_BYTES || bytesPer > IDC_MAX_BYTES) {
    Logger.log('⚠ Un índice ya no cabe: se está sirviendo sin caché. Toca copiar el troceado de Cache.gs.');
  }

  return {
    generacionAntes: antes, generacionDespues: despues,
    ok: !!leido, rechazaVacio: !vacio,
    personas: Object.keys(registros).length, bytesRegistros: bytesReg,
    filasPermisos: Object.keys(permisos).length, bytesPermisos: bytesPer,
    tope: IDC_MAX_BYTES, ttl: IDC_TTL
  };
}
