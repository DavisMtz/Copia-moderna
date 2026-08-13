/**
 * =====================================================================================
 * DIAGNÓSTICO DEL MONITOR DE PROMOCIONES
 * =====================================================================================
 *
 * Para qué: el monitor abre pero enseña 0 promociones. Este archivo contesta la única
 * pregunta que decide dónde está el fallo — ¿el servidor devuelve filas o no? —, porque
 * el navegador no puede distinguir "la hoja no tiene nada" de "la hoja tiene cosas pero
 * no supimos leerlas": en los dos casos llegan cero promociones y la pantalla se ve igual.
 *
 * Cómo se usa: pega este archivo en el editor de Apps Script, elige `diagPromos` en el
 * selector de funciones, pulsa Ejecutar y abre el Registro de ejecución (Ver → Registro).
 *
 * No escribe nada en ninguna hoja: solo lee y reporta.
 */
function diagPromos() {
  const L = [];
  const di = function (s) { L.push(s); };

  di('===== DIAGNÓSTICO DEL MONITOR DE PROMOCIONES =====');
  di('Fecha de la prueba: ' + new Date());
  di('');

  // ── 1. ¿Llegamos a la hoja del Portal? ────────────────────────────────────────
  let ss = null;
  try {
    ss = portalSS_();
    di('1. Hoja del Portal .......... OK  «' + ss.getName() + '»');
    di('   Pestañas: ' + ss.getSheets().map(function (h) { return h.getName(); }).join(' | '));
  } catch (e) {
    di('1. Hoja del Portal .......... FALLA: ' + e.message);
    di('   >>> Sin esto no hay promociones. Revisa PORTAL_SHEET_ID y los permisos.');
    Logger.log(L.join('\n'));
    return L.join('\n');
  }
  di('');

  // ── 2. Encabezados reales ────────────────────────────────────────────────────
  // Aquí es donde se rompe casi siempre: Portal.gs NO lee por posición, busca cada
  // columna por TEXTO. Si el encabezado se renombró (el caso típico: «Promoción 2026»
  // pasa a decir 2027 al cambiar el año), el índice sale -1, `row[-1]` es undefined y
  // el bucle descarta TODAS las filas — con status 'success' y cero promociones.
  ['Promociones', 'MKP'].forEach(function (nombre) {
    const sh = ss.getSheetByName(nombre);
    if (!sh) { di('2. Hoja «' + nombre + '» ......... NO EXISTE'); return; }
    const valores = sh.getDataRange().getValues();
    if (!valores.length) { di('2. Hoja «' + nombre + '» ......... VACÍA'); return; }
    const headers = valores[0].map(function (h) { return h.toString().toLowerCase().trim(); });
    di('2. Hoja «' + nombre + '»: ' + valores.length + ' filas (1 de encabezado + ' + (valores.length - 1) + ' de datos)');
    di('   Encabezados: ' + JSON.stringify(headers));

    let buscados;
    if (nombre === 'Promociones') {
      buscados = {
        'direccion (idxDir)':        headers.indexOf('direccion') > -1 ? headers.indexOf('direccion') : headers.findIndex(function (h) { return h.indexOf('direcci') > -1; }),
        'banner / carrusel (idxBan)': headers.findIndex(function (h) { return h.indexOf('banner / carrusel') > -1; }),
        'promoción 2026 (idxPro)':    headers.findIndex(function (h) { return h.indexOf('promoción 2026') > -1; }),
        'desc mkp (idxDesc)':         headers.findIndex(function (h) { return h.indexOf('desc mkp') > -1; }),
        'vigencia (idxVig)':          headers.findIndex(function (h) { return h.indexOf('vigencia') > -1; }),
        'liga (idxLiga)':             headers.findIndex(function (h) { return h.indexOf('liga') > -1; })
      };
    } else {
      buscados = {
        'direcci (idxDirMKP)':        headers.findIndex(function (h) { return h.indexOf('direcci') > -1; }),
        'banner / carrusel (idxBan)': headers.findIndex(function (h) { return h.indexOf('banner / carrusel') > -1; }),
        'promoción mktplace':         headers.findIndex(function (h) { return h.indexOf('promoción mktplace') > -1; }),
        'vigencia (idxVig)':          headers.findIndex(function (h) { return h.indexOf('vigencia') > -1; }),
        'liga (idxLiga)':             headers.findIndex(function (h) { return h.indexOf('liga') > -1; })
      };
    }
    Object.keys(buscados).forEach(function (k) {
      const v = buscados[k];
      di('   ' + (v < 0 ? '  *** NO ENCONTRADA *** ' : '   columna ' + v + '  ') + '<- ' + k);
    });

    // Las dos que deciden si una fila se conserva o se tira.
    const clave = (nombre === 'Promociones')
      ? ['direccion (idxDir)', 'banner / carrusel (idxBan)']
      : ['direcci (idxDirMKP)', 'banner / carrusel (idxBan)'];
    if (buscados[clave[0]] < 0 && buscados[clave[1]] < 0) {
      di('   >>> CAUSA PROBABLE: faltan LAS DOS columnas que deciden si la fila se guarda.');
      di('       El filtro «if (!row[idxDir] && !row[idxBan]) continue» descarta todo.');
    }
    di('');
  });

  // ── 3. Lo que devolvería el servidor al navegador ────────────────────────────
  let data = null;
  try {
    data = buildApplicationData_();
  } catch (e) {
    di('3. buildApplicationData_ .... EXCEPCIÓN: ' + e.message);
    Logger.log(L.join('\n'));
    return L.join('\n');
  }
  di('3. buildApplicationData_ (lectura REAL, sin caché)');
  di('   status ....... ' + data.status);
  di('   error ........ ' + data.error);
  di('   promociones .. ' + data.promociones.length);
  di('   eventos ...... ' + data.eventos.length);
  if (data.promociones.length) {
    di('   Primeras 3 promociones tal como las recibe el navegador:');
    data.promociones.slice(0, 3).forEach(function (p, i) {
      di('     [' + i + '] ' + JSON.stringify(p));
    });
  } else {
    di('   >>> El servidor devuelve CERO promociones: el fallo está en la hoja o en los');
    di('       encabezados de arriba, NO en Promociones.html.');
  }
  di('');

  // ── 4. Vigencias: ¿las entiende el cliente? ──────────────────────────────────
  // El monitor solo cuenta como ACTIVA la promoción cuya vigencia sabe convertir en
  // dos fechas y que además abarca el día de hoy. Una hoja llena de filas con un
  // formato de fecha que el cliente no reconoce se ve exactamente igual que una hoja
  // vacía: cero tarjetas y contadores a cero.
  if (data.promociones.length) {
    di('4. Vigencias (texto tal cual está en la hoja)');
    const vistos = {};
    data.promociones.forEach(function (p) {
      const v = String(p.vigencia || '(vacía)');
      vistos[v] = (vistos[v] || 0) + 1;
    });
    Object.keys(vistos).slice(0, 15).forEach(function (v) {
      di('   ' + vistos[v] + '×  «' + v + '»');
    });
    const sinVigencia = data.promociones.filter(function (p) { return !String(p.vigencia || '').trim(); }).length;
    if (sinVigencia) {
      di('   >>> ' + sinVigencia + ' promociones SIN vigencia: nunca saldrán como activas.');
    }
  }
  di('');

  // ── 5. Caché ─────────────────────────────────────────────────────────────────
  // fetchApplicationData sirve de CacheService durante 10 min. Si se guardó una
  // respuesta vacía, el monitor la repetirá aunque la hoja ya esté bien.
  const enCache = portalCacheGet_('appData_v1');
  di('5. Caché del servidor (appData_v1)');
  if (enCache) {
    di('   HAY copia en caché con ' + (enCache.promociones ? enCache.promociones.length : '?') + ' promociones.');
    if (data.promociones.length && (!enCache.promociones || !enCache.promociones.length)) {
      di('   >>> La caché está VACÍA pero la hoja SÍ tiene datos: ejecuta diagLimpiarCache().');
    }
  } else {
    di('   Sin copia en caché (la próxima carga lee la hoja directamente).');
  }

  di('');
  di('===== FIN =====');
  Logger.log(L.join('\n'));
  return L.join('\n');
}

/** Tira la copia en caché para que la siguiente carga vuelva a leer la hoja. */
function diagLimpiarCache() {
  try { CacheService.getScriptCache().remove('appData_v1'); } catch (e) {}
  try { CacheService.getScriptCache().remove('toolsData_v1'); } catch (e) {}
  Logger.log('Caché de promociones limpiada. Recarga el monitor.');
}
