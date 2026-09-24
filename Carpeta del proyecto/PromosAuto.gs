/**
 * =================================================================================================
 * PROMOCIONES AUTOMÁTICAS — la hoja de comercial entra sola al Portal | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Hasta ahora, para que el monitor tuviera las promociones al día alguien entraba a «Contenido del
 * Portal» → Promociones (o Marketplace), escogía la pestaña de comercial, pulsaba «Analizar» y
 * aplicaba. Una pestaña cada vez, y dos veces por pestaña (tienda y Marketplace van a hojas
 * distintas). Este archivo hace ese mismo recorrido solo, una vez al día:
 *
 *   1. Lee TODAS las pestañas visibles del archivo de comercial con el mismo intérprete del
 *      botón manual (promosInterpretar_), así que entiende exactamente lo mismo que él.
 *   2. Se queda con las filas que están vigentes hoy o que arrancan en los próximos
 *      PROMOS_AUTO_DIAS días (30 por defecto). Lo decide la vigencia de CADA FILA, leída con el
 *      mismo parser que usa el monitor (parseVigencia_): lo que entra es justo lo que el monitor
 *      pintará como «En curso» o «Próxima». Si la fila no trae vigencia legible, se toma la del
 *      nombre de la pestaña («HOT FASHION 10-17 AGOSTO»).
 *   3. Las da de alta o las actualiza en las hojas Promociones y MKP del Portal, con el mismo
 *      plan de importación del botón manual (pcPlanImport_), sin duplicar.
 *   4. Borra de esas dos hojas las promociones cuya vigencia TERMINÓ hace más de
 *      PROMOS_AUTO_DIAS días.
 *
 * DECISIONES QUE NO SON OBVIAS
 *
 *   · LA IDENTIDAD LLEVA LA VIGENCIA. El botón manual identifica una fila por dirección +
 *     categoría. Aquí eso no sirve: la campaña de hoy y la que arranca en 20 días suelen tener
 *     «Mujer · Bolsas» las dos, y la segunda machacaría a la primera — el monitor perdería la
 *     promoción que está corriendo. Por eso la automatización usa dirección + categoría +
 *     vigencia: conviven las dos, una corrida repetida da «sin cambios» y un texto corregido
 *     en comercial da «actualiza». El catálogo (PC_COLECCIONES) NO se toca: el pegado manual
 *     sigue exactamente igual.
 *   · EL AÑO. Las vigencias se escriben sin año («5 al 12 de enero») y parseVigencia_ les pone
 *     el año en curso. En diciembre eso convertiría una promoción de enero en «vieja» y se
 *     borraría. promosAutoAjustarAnio_ la corre un año si queda a más de medio año de hoy.
 *   · LO QUE NO SE PUEDE FECHAR NO SE JUZGA. Una fila del Portal con la vigencia vacía o
 *     ilegible no se borra nunca; una fila de comercial sin fecha no se importa. Las dos se
 *     cuentan en el resumen.
 *   · FILAS SIN DIRECCIÓN. El botón manual le pregunta al supervisor qué dirección ponerles
 *     (las hojas «Beauty Day» traen un 7). Aquí no hay a quién preguntar: se cuentan y se
 *     quedan fuera; siguen pudiéndose meter a mano.
 *   · SIN SESIÓN. Un disparador no tiene usuario, así que aquí no se pasa por pcGate_: se usan
 *     directamente las piezas internas del importador. Por eso NINGUNA función de este archivo
 *     está expuesta al cliente (todas acaban en «_» salvo las de editor, que no reciben datos).
 *
 * CÓMO SE ENCIENDE (una sola vez, y SOLO en el proyecto de PRODUCCIÓN — pruebas escribe en la
 * misma hoja del Portal y un disparador en cada proyecto correría dos veces):
 *   Editor de Apps Script → Activadores (reloj) → Añadir activador → función
 *   «promosAutoDisparador» → Según tiempo → Temporizador diario → 6 a 7 a. m.
 *   Crearlo a mano desde ahí no exige añadir permisos al manifiesto (hacerlo por código sí, y
 *   obligaría a reautorizar la webapp que usan los asesores).
 *
 * Funciones para el editor:
 *   promosAutoSimular()    → qué haría hoy, SIN escribir nada. Mírala antes de encenderlo.
 *   promosAutoCorrerAhora() → lo hace ya, igual que el disparador.
 *   promosAutoDisparador()  → la que llama el activador diario.
 */

// ── AJUSTES ──────────────────────────────────────────────────────────────────

/** Ventana en días: hacia delante (qué se importa) y hacia atrás (qué se borra). */
var PROMOS_AUTO_DIAS = 30;

/** Quién firma en la bitácora de la Consola. */
var PROMOS_AUTO_FIRMA = 'sistema · promociones automáticas';

/** Dónde queda el resumen de la última corrida (propiedad de script). */
var PROMOS_AUTO_PROP_ULTIMA = 'PROMOS_AUTO_ULTIMA';

var PROMOS_AUTO_DIA_MS = 86400000;

function promosAutoDias_() {
  const n = parseInt(secConfig_('PROMOS_AUTO_DIAS', PROMOS_AUTO_DIAS), 10);
  return (n > 0 && n < 366) ? n : PROMOS_AUTO_DIAS;
}

// ── REGLAS PURAS (sin Sheets: las cubre pruebas/promos_auto.test.js) ─────────

/**
 * Corrige el año que parseVigencia_ supone. Si el rango queda a más de medio año de hoy,
 * casi seguro es del año de al lado: «5 al 12 de enero» leído en diciembre es del enero que
 * viene, y «10 al 20 de diciembre» leído en enero es del diciembre que pasó.
 * @return {{start:Date,end:Date}|null}
 */
function promosAutoAjustarAnio_(r, hoy) {
  if (!r) return null;
  const medioAnio = 183 * PROMOS_AUTO_DIA_MS;
  let s = new Date(r.start.getTime()), e = new Date(r.end.getTime());
  function mover(anios) {
    s = new Date(s.getFullYear() + anios, s.getMonth(), s.getDate(), s.getHours(), s.getMinutes(), s.getSeconds());
    e = new Date(e.getFullYear() + anios, e.getMonth(), e.getDate(), e.getHours(), e.getMinutes(), e.getSeconds());
  }
  if (hoy.getTime() - e.getTime() > medioAnio) mover(1);
  else if (s.getTime() - hoy.getTime() > medioAnio) mover(-1);
  return { start: s, end: e };
}

/** Rango de una vigencia tal como está en la celda (texto o fecha), con el año corregido. */
function promosAutoRango_(vigencia, hoy) {
  if (vigencia instanceof Date) {
    if (isNaN(vigencia.getTime())) return null;
    const d = vigencia;
    return {
      start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0),
      end:   new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)
    };
  }
  const txt = String(vigencia == null ? '' : vigencia).trim();
  if (!txt) return null;
  return promosAutoAjustarAnio_(parseVigencia_(txt, hoy), hoy);
}

/** Inicio del día de hoy (00:00), para que «termina hoy» siga contando como vigente. */
function promosAutoInicioDelDia_(hoy) {
  return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
}

/** ¿Se importa? Vigente hoy, o arranca dentro de la ventana. */
function promosAutoEntra_(r, hoy, dias) {
  if (!r) return false;
  const limite = new Date(promosAutoInicioDelDia_(hoy).getTime() + (dias + 1) * PROMOS_AUTO_DIA_MS - 1);
  return r.end.getTime() >= promosAutoInicioDelDia_(hoy).getTime() && r.start.getTime() <= limite.getTime();
}

/** ¿Se borra? Terminó hace MÁS de `dias` días. */
function promosAutoVieja_(r, hoy, dias) {
  if (!r) return false;
  return r.end.getTime() < promosAutoInicioDelDia_(hoy).getTime() - dias * PROMOS_AUTO_DIA_MS;
}

/**
 * Un rango escrito como lo espera el monitor: «10 al 17 de agosto» o
 * «24 de julio al 9 de agosto». Sin año, igual que el resto de la hoja.
 */
function promosAutoTextoRango_(r) {
  const m1 = PROMOS_MESES[r.start.getMonth()], m2 = PROMOS_MESES[r.end.getMonth()];
  const d1 = r.start.getDate(), d2 = r.end.getDate();
  if (m1 === m2 && r.start.getFullYear() === r.end.getFullYear()) {
    return d1 === d2 ? (d1 + ' de ' + m1) : (d1 + ' al ' + d2 + ' de ' + m1);
  }
  return d1 + ' de ' + m1 + ' al ' + d2 + ' de ' + m2;
}

/**
 * Rango de fechas del NOMBRE de una pestaña, solo si trae días explícitos: «10-17 AGOSTO»,
 * «GBV Etapa 3 (24 jul-09 agos)», «26 de Julio al 01 Agosto».
 *
 * No se usa promosRangoDelNombre_ a propósito: esa se escribió para ORDENAR la lista del
 * botón manual y, a falta de días, toma la última palabra como mes («Abrigos» → abril,
 * «Junior» → junio). Para ordenar da igual; para ESCRIBIR una vigencia sería inventarla.
 * @return {{start:Date,end:Date}|null}
 */
function promosAutoRangoPestana_(nombre, hoy) {
  const s = pcClave_(nombre);
  const m = s.match(/(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})?\s*(?:-|–|al?)\s*(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})/);
  if (!m) return null;
  function mes(t) {
    if (!t) return -1;
    for (let i = 0; i < 12; i++) if (PROMOS_MESES[i].indexOf(t.slice(0, 3)) === 0) return i;
    return -1;
  }
  const d1 = parseInt(m[1], 10), d2 = parseInt(m[3], 10);
  let m1 = mes(m[2]), m2 = mes(m[4]);
  if (m2 < 0) return null;                 // el segundo tiene que ser un mes de verdad
  if (m[2] && m1 < 0) return null;         // «10 hot - 17 agosto»: no es un rango
  if (m1 < 0) m1 = (d1 <= d2) ? m2 : (m2 + 11) % 12;
  if (d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return null;
  const anio = hoy.getFullYear();
  const a2 = (m2 < m1) ? anio + 1 : anio;
  return promosAutoAjustarAnio_({ start: new Date(anio, m1, d1, 0, 0, 0),
                                  end: new Date(a2, m2, d2, 23, 59, 59) }, hoy);
}

/**
 * Filtra las filas interpretadas de UNA pestaña. Muta `vigencia` cuando la toma del nombre
 * de la pestaña, para que lo que se guarde sea legible por el monitor.
 *
 * @param {Array<Object>} filas     salida de promosInterpretar_ (promociones o mkp)
 * @param {{start,end}|null} rangoPestana  rango deducido del nombre, ya con el año corregido
 * @return {{entran:Array, fuera:number, sinFecha:number, deLaPestana:number}}
 */
function promosAutoFiltrar_(filas, rangoPestana, hoy, dias) {
  const out = { entran: [], fuera: 0, sinFecha: 0, deLaPestana: 0 };
  (filas || []).forEach(function (f) {
    let r = promosAutoRango_(f.vigencia, hoy);
    // Solo se rellena una celda VACÍA. Si comercial escribió algo que no se entiende
    // («Por confirmar»), eso se respeta y la fila se queda fuera: no se le inventa fecha.
    if (!r && rangoPestana && String(f.vigencia == null ? '' : f.vigencia).trim() === '') {
      f.vigencia = promosAutoTextoRango_(rangoPestana);
      r = rangoPestana;
      out.deLaPestana++;
    }
    if (!r) { out.sinFecha++; return; }
    if (promosAutoEntra_(r, hoy, dias)) out.entran.push(f);
    else out.fuera++;
  });
  return out;
}

// ── EL RECORRIDO ─────────────────────────────────────────────────────────────

/**
 * Lee el archivo de comercial y devuelve, por sección, las filas que tocan hoy.
 * No escribe nada.
 */
function promosAutoRecolectar_(hoy, dias) {
  const ss = promosComercialSS_();
  const colProm = pcColeccion_('promociones');
  const colMkp  = pcColeccion_('mkp');

  const res = {
    archivo: ss.getName(),
    filas: { promociones: [], mkp: [] },
    pestanas: [],
    sinDireccion: 0, sinFecha: 0, fuera: 0
  };

  ss.getSheets().forEach(function (sh) {
    if (sh.isSheetHidden()) return;
    const nombre = sh.getName();
    const reporte = { hoja: nombre, promociones: 0, mkp: 0, nota: '' };
    res.pestanas.push(reporte);

    try {
      const ultimaFila = Math.min(sh.getLastRow(), PROMOS_MAX_FILAS);
      const ultimaCol  = Math.max(sh.getLastColumn(), 1);
      if (ultimaFila < 2) { reporte.nota = 'vacía'; return; }

      const datos = sh.getRange(1, 1, ultimaFila, ultimaCol).getValues();
      const r = promosInterpretar_(datos, colProm, colMkp);
      if (!r.tablas.length) { reporte.nota = 'sin tabla de promociones'; return; }

      const rangoPestana = promosAutoRangoPestana_(nombre, hoy);

      ['promociones', 'mkp'].forEach(function (tipo) {
        const f = promosAutoFiltrar_(r[tipo], rangoPestana, hoy, dias);
        f.entran.forEach(function (fila) { res.filas[tipo].push(fila); });
        reporte[tipo] = f.entran.length;
        res.sinFecha += f.sinFecha;
        res.fuera += f.fuera;
        res.sinDireccion += ((r.pendientes && r.pendientes[tipo]) || []).length;
      });
    } catch (e) {
      reporte.nota = 'no se pudo leer: ' + (e && e.message || e);
      Logger.log('promosAutoRecolectar_ «' + nombre + '»: ' + e);
    }
  });

  return res;
}

/**
 * Da de alta / actualiza las filas en UNA hoja del Portal y borra las viejas.
 * Mismo plan y misma forma de escribir que portalContenidoAplicarImport, con la identidad
 * ampliada a la vigencia (ver cabecera).
 */
function promosAutoAplicarSeccion_(tipo, filas, hoy, dias, simular) {
  const base = pcColeccion_(tipo);
  const col = {};
  Object.keys(base).forEach(function (k) { col[k] = base[k]; });
  col.clave = ['direccion', 'categoria', 'vigencia'];

  const sheet = portalSS_().getSheetByName(col.hoja);
  if (!sheet) throw new Error('No encontramos la pestaña «' + col.hoja + '» del Portal.');

  // En simulación no se escribe NI la columna ID: se lee lo que haya.
  let info;
  if (simular) {
    const width = Math.max(sheet.getLastColumn(), 1);
    const hdr = sheet.getRange(1, 1, 1, width).getValues()[0];
    info = { colId: pcColumnaId_(hdr), hdr: hdr, width: width };
  } else {
    info = pcAsegurarIds_(sheet, col);
  }
  const mapa = pcMapaColumnas_(col, info.hdr);

  // Un campo que llega vacío es una columna que esa pestaña de comercial no trae (muchas no
  // tienen «Marca» ni «Liga»), no una orden de borrar lo que ya está en el Portal. Se quita
  // de la entrada, y pcPlanImport_ ya ignora lo que no viene. La clave se queda siempre.
  const entrada = filas.map(function (f) {
    const limpia = {};
    Object.keys(f).forEach(function (k) {
      if (col.clave.indexOf(k) !== -1 || String(f[k] == null ? '' : f[k]).trim() !== '') limpia[k] = f[k];
    });
    return limpia;
  });

  const r = entrada.length ? pcPlanImport_(col, info, sheet, entrada)
                         : { plan: [], resumen: { nuevas: 0, actualiza: 0, iguales: 0, duplicadas: 0, errores: 0 } };
  const salida = {
    hoja: col.hoja,
    nuevas: r.resumen.nuevas, actualizadas: r.resumen.actualiza, iguales: r.resumen.iguales,
    duplicadas: r.resumen.duplicadas, errores: r.resumen.errores,
    borradas: 0, sinFechaEnPortal: 0, ejemplosBorradas: [],
    ejemplosErrores: r.plan.filter(function (x) { return x.accion === 'error'; })
                          .slice(0, 5).map(function (x) { return x.titulo + ': ' + x.detalle; })
  };

  if (!simular) {
    // ── Altas: una sola escritura para todas ──
    const nuevas = r.plan.filter(function (x) { return x.accion === 'nueva'; });
    if (nuevas.length) {
      const bloque = nuevas.map(function (x) {
        const fila = [];
        for (let i = 0; i < info.width; i++) fila[i] = '';
        if (info.colId > -1) fila[info.colId] = pcNuevoId_(col.prefijo);
        col.campos.forEach(function (c) {
          if (mapa[c.id] > -1 && x.valores[c.id] !== undefined) fila[mapa[c.id]] = x.valores[c.id];
        });
        return fila;
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, bloque.length, info.width).setValues(bloque);
    }
    // ── Actualizaciones: solo las celdas que cambian ──
    r.plan.forEach(function (x) {
      if (x.accion !== 'actualiza') return;
      col.campos.forEach(function (c) {
        if (mapa[c.id] < 0 || x.valores[c.id] === undefined) return;
        sheet.getRange(x.fila, mapa[c.id] + 1).setValue(x.valores[c.id]);
      });
    });
  }

  // ── Limpieza: lo que terminó hace más de `dias` días ──
  const cVig = mapa.vigencia, cReq = mapa[pcCampoRequerido_(col).id];
  const ultima = sheet.getLastRow();
  const aBorrar = [];
  if (cVig > -1 && ultima > 1) {
    const datos = sheet.getRange(2, 1, ultima - 1, info.width).getValues();
    for (let i = 0; i < datos.length; i++) {
      const fila = datos[i];
      const tieneAlgo = fila.some(function (v) { return String(v == null ? '' : v).trim() !== ''; });
      if (!tieneAlgo) continue;
      const rango = promosAutoRango_(fila[cVig], hoy);
      if (!rango) {
        if (cReq > -1 && String(fila[cReq] || '').trim()) salida.sinFechaEnPortal++;
        continue;
      }
      if (promosAutoVieja_(rango, hoy, dias)) {
        aBorrar.push(i + 2);
        if (salida.ejemplosBorradas.length < 5) {
          salida.ejemplosBorradas.push([fila[mapa.direccion], fila[mapa.categoria], pcTexto_(fila[cVig])]
            .filter(function (v) { return String(v || '').trim(); }).join(' · '));
        }
      }
    }
  }
  salida.borradas = aBorrar.length;

  // De abajo hacia arriba, agrupando filas contiguas: borrar la 10 antes que la 40
  // movería la 40 a la 39 y se llevaría una fila buena.
  if (!simular && aBorrar.length) {
    let i = aBorrar.length - 1;
    while (i >= 0) {
      let fin = aBorrar[i], ini = fin;
      while (i > 0 && aBorrar[i - 1] === ini - 1) { i--; ini = aBorrar[i]; }
      sheet.deleteRows(ini, fin - ini + 1);
      i--;
    }
  }

  return salida;
}

/**
 * La corrida completa. `simular:true` no escribe nada (ni bitácora, ni caché, ni resumen).
 * @return {Object} resumen legible, también lo que queda en PROMOS_AUTO_ULTIMA
 */
function promosAutoCorrer_(opts) {
  const simular = !!(opts && opts.simular);
  const hoy = (opts && opts.hoy) || new Date();
  const dias = promosAutoDias_();
  const inicio = Date.now();

  const rec = promosAutoRecolectar_(hoy, dias);

  const secciones = pcConLock_(function () {
    return {
      promociones: promosAutoAplicarSeccion_('promociones', rec.filas.promociones, hoy, dias, simular),
      mkp:         promosAutoAplicarSeccion_('mkp',         rec.filas.mkp,         hoy, dias, simular)
    };
  });

  const resumen = {
    cuando: Utilities.formatDate(hoy, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    simulacion: simular,
    dias: dias,
    archivo: rec.archivo,
    pestanasLeidas: rec.pestanas.length,
    pestanas: rec.pestanas,
    comercial: { sinDireccion: rec.sinDireccion, sinFecha: rec.sinFecha, fueraDeVentana: rec.fuera },
    promociones: secciones.promociones,
    mkp: secciones.mkp,
    segundos: Math.round((Date.now() - inicio) / 1000)
  };

  if (!simular) {
    const tocoAlgo = ['promociones', 'mkp'].some(function (t) {
      const s = secciones[t];
      return s.nuevas || s.actualizadas || s.borradas;
    });
    if (tocoAlgo) pcInvalidarCache_();
    // Cero filas en TODO el archivo casi nunca es «no hay promociones»: suele ser que
    // comercial cambió el formato y el intérprete dejó de entenderlo. La limpieza sigue
    // corriendo, así que el Portal se iría vaciando en silencio; que al menos quede dicho.
    if (!rec.filas.promociones.length && !rec.filas.mkp.length) {
      pcApuntar_(PROMOS_AUTO_FIRMA, 'Portal: actualización automática — AVISO', 'Promociones y Marketplace',
                 'No se encontró ninguna promoción vigente o próxima en ' + rec.pestanas.length +
                 ' pestañas de comercial. Revisa si cambió el formato de la hoja (promosRevisarHojas).');
    }
    pcApuntar_(PROMOS_AUTO_FIRMA, 'Portal: actualización automática', 'Promociones y Marketplace',
      ['promociones', 'mkp'].map(function (t) {
        const s = secciones[t];
        return s.hoja + ': ' + s.nuevas + ' altas, ' + s.actualizadas + ' actualizadas, ' + s.borradas + ' borradas';
      }).join(' · ') + ' · ' + rec.pestanas.length + ' pestañas leídas');
    try {
      PropertiesService.getScriptProperties().setProperty(PROMOS_AUTO_PROP_ULTIMA,
        JSON.stringify(resumen).slice(0, 8500));
    } catch (e) { Logger.log('promosAuto: no se guardó el resumen: ' + e); }
  }

  return resumen;
}

/** Vuelca un resumen en el registro de ejecución, legible a simple vista. */
function promosAutoLog_(r) {
  Logger.log('═══ Promociones automáticas · ' + r.cuando + (r.simulacion ? ' · SIMULACIÓN (no se escribió nada)' : '') + ' ═══');
  Logger.log('Ventana: vigentes hoy o que arrancan en ' + r.dias + ' días; se borran las que terminaron hace más de ' + r.dias + ' días.');
  Logger.log('Archivo de comercial: ' + r.archivo + ' · ' + r.pestanasLeidas + ' pestañas visibles');
  r.pestanas.forEach(function (p) {
    Logger.log('   · ' + p.hoja + ' → tienda ' + p.promociones + ', mkp ' + p.mkp + (p.nota ? '  (' + p.nota + ')' : ''));
  });
  Logger.log('Se quedaron fuera en comercial: ' + r.comercial.fueraDeVentana + ' fuera de la ventana, ' +
             r.comercial.sinFecha + ' sin fecha legible, ' + r.comercial.sinDireccion + ' sin dirección.');
  ['promociones', 'mkp'].forEach(function (t) {
    const s = r[t];
    Logger.log('► ' + s.hoja + ': ' + s.nuevas + ' altas · ' + s.actualizadas + ' actualizadas · ' + s.iguales +
               ' sin cambios · ' + s.duplicadas + ' repetidas · ' + s.errores + ' con error · ' + s.borradas +
               ' borradas por viejas · ' + s.sinFechaEnPortal + ' sin fecha (se respetan)');
    s.ejemplosBorradas.forEach(function (x) { Logger.log('      borrada: ' + x); });
    s.ejemplosErrores.forEach(function (x) { Logger.log('      error: ' + x); });
  });
  Logger.log('Tardó ' + r.segundos + ' s.');
}

// ── PUNTOS DE ENTRADA (editor y activador) ───────────────────────────────────

/** Qué haría hoy, sin escribir nada. */
function promosAutoSimular() {
  secSoloInterno_('promosAutoSimular');
  const r = promosAutoCorrer_({ simular: true });
  promosAutoLog_(r);
  return r;
}

/** Lo hace ya, igual que el activador diario. */
function promosAutoCorrerAhora() {
  secSoloInterno_('promosAutoCorrerAhora');
  const r = promosAutoCorrer_({ simular: false });
  promosAutoLog_(r);
  return r;
}

/** La llama el activador diario. Un fallo queda en la bitácora, no se traga. */
function promosAutoDisparador(e) {
  // Un activador real trae su triggerUid. Se acepta aunque Google no informe la cuenta activa en
  // ese contexto: si alguien lo forzara desde el navegador, solo correría la misma actualización
  // diaria. Se marca la entrada (como doGet) para que las funciones con candado que llama después
  // —promosAutoCorrerAhora— sepan que las llamó el servidor. Sin marca, el activador fallaría justo
  // cuando Google no informa la cuenta. Cualquier otra llamada pasa por el candado de siempre.
  if (e && e.triggerUid) SEC_ENTRADA_ = 'activador';
  else secSoloInterno_('promosAutoDisparador');
  try {
    promosAutoCorrerAhora();
  } catch (e) {
    Logger.log('promosAutoDisparador: ' + (e && e.stack || e));
    pcApuntar_(PROMOS_AUTO_FIRMA, 'Portal: actualización automática FALLÓ', 'Promociones y Marketplace',
               String(e && e.message || e));
    throw e;   // que Apps Script también lo marque como ejecución fallida (y avise por correo)
  }
}
