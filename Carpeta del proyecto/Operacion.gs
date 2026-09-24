/**
 * =================================================================================================
 * ESTADO DE OPERACIÓN | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Responde a una pregunta que hoy se contesta por WhatsApp: "¿soy yo o Connect está caído?".
 *
 * Tres piezas:
 *
 *   1. REPORTAR. Cualquier asesor con sesión levanta la mano: elige el sistema (Connect,
 *      Página/App, Salesforce, CCAIP o uno nuevo), un submotivo, notas opcionales y capturas
 *      opcionales. El reporte se guarda SIEMPRE, aunque el aviso a Chat falle.
 *
 *   2. AGRUPAR SOLO. Varios reportes parecidos no son varios problemas: son el mismo. En
 *      cuanto tres PERSONAS DISTINTAS reportan lo mismo en media hora, el sistema levanta un
 *      incidente en estado "posible" y todo el equipo lo ve. Contar personas y no reportes es
 *      deliberado: quien pulsa tres veces no debe poder alarmar a nadie.
 *
 *   3. CONFIRMAR. Un incidente automático es una SOSPECHA, y se etiqueta como tal. Solo alguien
 *      con el bloque 'operacion' lo confirma, lo marca como intermitencia o lo descarta; y solo
 *      entonces —o cuando esa persona lo pida— sale el aviso al espacio del equipo.
 *
 * REGLA QUE SOSTIENE TODO LO DEMÁS: nada de lo que se enseña sin sesión lleva datos de
 * personas. La vista pública dice QUÉ está fallando y desde cuándo; los reportes, los correos
 * y las evidencias exigen sesión y se resuelven en el servidor, nunca filtrando en el cliente.
 *
 * Las hojas se crean solas la primera vez: no hay que preparar nada a mano.
 */

// ── HOJAS ────────────────────────────────────────────────────────────────────

const OP_SHEET_REPORTES = 'OperacionReportes';
const OP_SHEET_INCIDENTES = 'OperacionIncidentes';
const OP_SHEET_ACTUALIZACIONES = 'OperacionActualizaciones';
const OP_SHEET_CATALOGO = 'OperacionCatalogo';

const OP_COLS_REPORTES = ['ID', 'Fecha', 'Correo', 'Nombre', 'Sistema', 'SistemaClave',
                          'Submotivo', 'SubmotivoClave', 'Notas', 'Evidencias', 'IncidenteId', 'Estado'];

const OP_COLS_INCIDENTES = ['ID', 'Clave', 'Sistema', 'SistemaClave', 'Submotivo', 'Estado',
                            'Titulo', 'Detalle', 'Creado', 'CreadoPor', 'CreadoNombre',
                            'Confirmado', 'ConfirmadoPor', 'ConfirmadoNombre',
                            'Actualizado', 'ActualizadoPor', 'Cerrado', 'Origen'];

const OP_COLS_ACTUALIZACIONES = ['ID', 'IncidenteId', 'Fecha', 'Autor', 'AutorNombre',
                                 'Estado', 'Nota', 'Aviso'];

const OP_COLS_CATALOGO = ['Tipo', 'SistemaClave', 'Valor', 'Clave', 'Tono', 'Creado',
                          'CreadoPor', 'Activo', 'Usos'];

// ── PARÁMETROS DE COMPORTAMIENTO ─────────────────────────────────────────────

/**
 * Cuántas PERSONAS distintas y en cuánto tiempo hacen saltar un incidente automático.
 * Elegido con el usuario el 2026-08-08: tres asesores en media hora. Con dos, un problema
 * de red de una sola sala levantaba bandera para todo el país; con cinco, una caída real
 * tardaba demasiado en hacerse visible.
 */
const OP_UMBRAL_PERSONAS = 3;
const OP_VENTANA_MIN = 30;

/**
 * El mismo umbral, pero mirando el SERVICIO COMPLETO en vez de un motivo concreto.
 *
 * La regla de arriba exige que las tres personas reporten LO MISMO. Cuando un sistema se
 * degrada de verdad, casi nunca se rompe de una sola forma: uno dice "no abre", otro "va
 * lentísimo" y otro "no me deja iniciar sesión". Son tres asesores que no pueden trabajar
 * con Connect, y con la regla por motivo cada uno se quedaba solo en su cubeta y no saltaba
 * nada. Este segundo umbral cuenta personas por SISTEMA, sin mirar el motivo.
 *
 * Se evalúa DESPUÉS del de motivo: cuando las tres coinciden en la misma queja, lo que se
 * levanta es el incidente concreto ("Connect · No abre"), que dice mucho más que uno
 * genérico. Este solo entra cuando el motivo no alcanzó por sí solo.
 *
 * Ponerlo en false devuelve el módulo al comportamiento anterior sin tocar nada más.
 */
const OP_UMBRAL_SERVICIO_ACTIVO = true;

/**
 * Lo que lee el PÚBLICO cuando salta un umbral y todavía no ha pasado nadie de supervisión.
 *
 * Este texto se publica SOLO. No espera aprobación, y es a propósito: los minutos en los que
 * la gente sigue peleándose con un sistema caído son justo los que hay que ahorrarles, y para
 * entonces el supervisor está ocupado con la misma caída. Por eso está redactado como lo que
 * de verdad se sabe en ese momento —una sospecha con respaldo, no un hecho—: si más tarde
 * resulta falsa alarma, nadie tiene que desdecirse de nada.
 *
 * No lleva el número de personas ni quiénes son: sirve para la nota interna, no para la calle.
 */
const OP_AVISO_POSIBLE = 'Es posible que existan problemas con el servicio.';

function opAvisoPosibleDetalle_() {
  return OP_AVISO_POSIBLE + ' Varias personas reportaron fallas en los últimos ' +
         OP_VENTANA_MIN + ' minutos y lo estamos revisando.';
}

/** Tope de reportes por persona y hora. No es castigo: evita que un clic nervioso infle la hoja. */
const OP_MAX_REPORTES_HORA = 8;

/** Dos reportes idénticos de la MISMA persona en este plazo son el mismo reporte. */
const OP_MIN_ENTRE_IGUALES = 10;

/**
 * Un "posible" que nadie confirma y que deja de recibir reportes se apaga solo pasada esta
 * hora. Sin esto, un falso positivo de un martes sigue asustando al equipo el viernes, y a
 * la tercera vez que pasa nadie vuelve a mirar el indicador.
 *
 * Era de 4 horas cuando el aviso solo lo veía el equipo. Ahora que la sospecha se publica
 * sola —sin que nadie la apruebe—, el plazo es también el tiempo que un cliente puede estar
 * leyendo "es posible que existan problemas" por una falsa alarma, y cuatro horas de eso
 * cuestan más credibilidad de la que ahorran. Con una hora sigue habiendo margen de sobra:
 * el reloj se reinicia con CADA reporte nuevo, así que una caída de verdad —que no deja de
 * recibirlos— no se apaga sola mientras siga pasando.
 */
const OP_HORAS_CADUCA_POSIBLE = 1;

/** Evidencias: tope por archivo y por reporte. */
const OP_MAX_EVIDENCIAS = 4;
const OP_MAX_BYTES_EVIDENCIA = 5 * 1024 * 1024;

/** Carpeta de Drive donde viven las capturas. */
const OP_CARPETA_EVIDENCIAS = 'Ventel · Evidencias de operación';

/** Webhooks. Ambos se configuran desde la Consola; vacío = no se manda nada. */
const OPERACION_WEBHOOK_REPORTES = '';
const OPERACION_WEBHOOK_ESTADO =
  'https://chat.googleapis.com/v1/spaces/AAQAF6OTWgk/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=to2OuM8_AR2Ag-TP1cTShZf4u_JiwQ0oPbHmnD7i2ck';

/** Bloque de permisos que hace falta para confirmar, descartar o actualizar (ver Permisos.gs). */
const OP_BLOQUE = 'operacion';

// ── CATÁLOGOS BASE ───────────────────────────────────────────────────────────

/**
 * Los cuatro sistemas de siempre. `publico` decide cuáles se pintan en grande en la pantalla
 * que se ve SIN sesión: fuera de Ventel, "Connect" y "Página/App" es lo único que significa
 * algo. Los demás salen igual, pero en la fila secundaria.
 *
 * Estos cuatro no se pueden borrar. Los que añade la supervisión viven en la hoja de catálogo.
 */
const OP_SISTEMAS_BASE = [
  { clave: 'connect',    nombre: 'Connect',      publico: true,  orden: 1 },
  { clave: 'pagina-app', nombre: 'Página/App',   publico: true,  orden: 2 },
  { clave: 'salesforce', nombre: 'Salesforce',   publico: false, orden: 3 },
  { clave: 'ccaip',      nombre: 'CCAIP',        publico: false, orden: 4 }
];

/**
 * Estados de un incidente.
 *
 *   afecta  → cuenta como "algo va mal" en el semáforo.
 *   cierra  → el incidente deja de estar vivo y ya no agrupa reportes nuevos.
 *   publico → se enseña a quien no tiene sesión. 'descartado' NO: decirle al mundo que hubo
 *             una falsa alarma no informa de nada y resta credibilidad al resto del tablero.
 */
const OP_ESTADOS_BASE = [
  { clave: 'posible', nombre: 'Posible problema', tono: 'warn', afecta: true, cierra: false, publico: true,
    detalle: 'Varias personas reportaron lo mismo. Falta que supervisión lo confirme.' },
  { clave: 'confirmado', nombre: 'Confirmado', tono: 'alert', afecta: true, cierra: false, publico: true,
    detalle: 'Supervisión confirmó la falla. Ya se está trabajando en ella.' },
  { clave: 'intermitencia', nombre: 'Intermitencia', tono: 'warn', afecta: true, cierra: false, publico: true,
    detalle: 'Funciona a ratos. Puede fallar sin aviso.' },
  { clave: 'mantenimiento', nombre: 'En mantenimiento', tono: 'info', afecta: true, cierra: false, publico: true,
    detalle: 'Trabajo programado. Se restablece al terminar.' },
  { clave: 'resuelto', nombre: 'Resuelto', tono: 'ok', afecta: false, cierra: true, publico: true,
    detalle: 'El sistema volvió a la normalidad.' },
  { clave: 'descartado', nombre: 'Descartado', tono: 'neutro', afecta: false, cierra: true, publico: false,
    detalle: 'Se revisó y no era una falla del sistema.' }
];

/**
 * Submotivos que se ofrecen desde el primer día, por sistema. Sin esto, el primer asesor que
 * reporta se encuentra una lista vacía y tiene que inventar la redacción — y esa redacción es
 * la que van a ver todos los demás para siempre.
 */
const OP_SUBMOTIVOS_BASE = {
  'connect':    ['No abre / no carga', 'Se cierra solo', 'No deja iniciar sesión', 'Va muy lento', 'No guarda la llamada'],
  'pagina-app': ['No carga la página', 'No aparecen precios', 'No deja agregar a la bolsa', 'Error al pagar', 'Imágenes rotas'],
  'salesforce': ['No abre / no carga', 'No deja iniciar sesión', 'No guarda el caso', 'Va muy lento', 'No encuentra al cliente'],
  'ccaip':      ['No entran llamadas', 'Se corta el audio', 'No deja iniciar sesión', 'No cambia de estado', 'Va muy lento']
};

// ── UTILIDADES DE TEXTO ──────────────────────────────────────────────────────

/** Minúsculas, sin acentos, sin puntuación de relleno y con los espacios colapsados. */
function opNormalizar_(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clave estable para agrupar: la normalización con guiones. '' si no queda nada. */
function opClave_(texto) {
  return opNormalizar_(texto).replace(/ /g, '-').substring(0, 60);
}

/** Caracteres de control: nunca aportan nada y si ensucian una celda o un mensaje de Chat. */
const OP_RE_CONTROL = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');
/** Igual, pero conservando el salto de linea. */
const OP_RE_CONTROL_SIN_SALTO = new RegExp('[\\u0000-\\u0009\\u000b-\\u001f\\u007f]', 'g');

/** Recorta y limpia lo que teclea una persona antes de guardarlo tal cual se vera. */
function opLimpiarTexto_(texto, tope) {
  return String(texto == null ? '' : texto)
    .replace(OP_RE_CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, tope || 120);
}

/** Notas: conserva los saltos de linea, que ahi si significan algo. */
function opLimpiarNotas_(texto, tope) {
  return String(texto == null ? '' : texto)
    .replace(/\r\n/g, '\n')
    .replace(OP_RE_CONTROL_SIN_SALTO, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, tope || 1200);
}

/** Primera letra en mayúscula, el resto como lo escribió la persona. */
function opCapitalizar_(texto) {
  const s = String(texto || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * Distancia de edición con transposiciones (Damerau-Levenshtein).
 *
 * Se usa para no acabar con "No carga", "no carga." y "No cagra" como tres submotivos
 * distintos en la lista que ve todo el equipo. Es la misma familia de medida que usa la
 * auditoría de cotizaciones; aquí va aparte porque este archivo tiene que poder existir
 * aunque AuditoriaCotizacion.gs no esté en el proyecto.
 */
function opDistancia_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const fila = [];
  for (let j = 0; j <= b.length; j++) fila[j] = j;

  let anterior = [];
  for (let i = 1; i <= a.length; i++) {
    const previa = fila.slice();
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      fila[j] = Math.min(fila[j - 1] + 1, previa[j] + 1, previa[j - 1] + costo);
      // Transposición: "carga" ↔ "cagra" es UN error de dedo, no dos.
      if (i > 1 && j > 1 &&
          a.charAt(i - 1) === b.charAt(j - 2) &&
          a.charAt(i - 2) === b.charAt(j - 1)) {
        fila[j] = Math.min(fila[j], anterior[j - 2] + costo);
      }
    }
    anterior = previa;
  }
  return fila[b.length];
}

/**
 * Coeficiente de Dice sobre bigramas: 0 = nada que ver, 1 = idénticos.
 *
 * La distancia de edición se porta mal con frases: "no carga la bolsa" y "la bolsa no carga"
 * están a 14 ediciones y son lo mismo. Dice mira qué pares de letras comparten, así que el
 * orden de las palabras pesa mucho menos.
 */
function opDice_(a, b) {
  const na = opNormalizar_(a).replace(/ /g, '');
  const nb = opNormalizar_(b).replace(/ /g, '');
  if (!na.length || !nb.length) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;

  const bolsa = {};
  for (let i = 0; i < na.length - 1; i++) {
    const par = na.substr(i, 2);
    bolsa[par] = (bolsa[par] || 0) + 1;
  }
  let comunes = 0;
  for (let i = 0; i < nb.length - 1; i++) {
    const par = nb.substr(i, 2);
    if (bolsa[par] > 0) { bolsa[par]--; comunes++; }
  }
  return (2 * comunes) / ((na.length - 1) + (nb.length - 1));
}

/**
 * ¿Estas dos descripciones son la misma queja?
 *
 * Es el criterio ÚNICO de agrupación: lo usan el catálogo (para no duplicar submotivos),
 * la búsqueda del incidente al que pertenece un reporte y el recuento del umbral. Si cada
 * uno usara su propio umbral, un reporte podría contar para disparar la alerta y luego no
 * pertenecer a la incidencia que él mismo provocó.
 */
function opMismoMotivo_(a, b) {
  if (opCifras_(a) !== opCifras_(b)) return false;
  return opDice_(a, b) >= 0.7;
}

/** Las cifras de un texto, en orden y separadas: "error 404 en caja 3" → "404|3". */
function opCifras_(texto) {
  const m = String(texto || '').match(/\d+/g);
  return m ? m.join('|') : '';
}

/**
 * ¿Este texto nuevo es en realidad uno que ya existe?
 *
 * Devuelve la opción existente cuando está razonablemente seguro, o null. El umbral de
 * edición se acota TAMBIÉN por longitud parecida: sin eso, "SOMS" y "SAP" (2 ediciones sobre
 * cadenas cortas) se fundían en uno, que es exactamente el error que hace desconfiar de un
 * autocompletado.
 *
 * @param {string} texto      Lo que acaba de escribir la persona.
 * @param {string[]} existentes Valores ya guardados.
 * @return {{valor:string, motivo:string}|null}
 */
function opSugerirExistente_(texto, existentes) {
  const norm = opNormalizar_(texto);
  if (!norm) return null;
  const lista = (existentes || []).filter(Boolean);

  for (let i = 0; i < lista.length; i++) {
    if (opNormalizar_(lista[i]) === norm) return { valor: lista[i], motivo: 'igual' };
  }

  let mejor = null;
  for (let i = 0; i < lista.length; i++) {
    const otro = opNormalizar_(lista[i]);
    if (!otro) continue;

    // LOS NÚMEROS NO SE FUNDEN NUNCA. "Error 404" y "Error 403" comparten casi todas sus
    // letras —Dice los da por idénticos— y son dos fallos distintos; lo mismo con "Caja 3"
    // y "Caja 8" o "Sala 12". En un mensaje técnico la cifra suele ser justo la parte que
    // lo distingue, así que si las cifras difieren se descarta la fusión sin más.
    if (opCifras_(norm) !== opCifras_(otro)) continue;

    const dice = opDice_(norm, otro);
    const dist = opDistancia_(norm, otro);
    const largoParecido = Math.abs(norm.length - otro.length) <= Math.max(2, Math.round(norm.length * 0.34));
    const toleranciaEdicion = norm.length <= 6 ? 1 : (norm.length <= 12 ? 2 : 3);

    const casiIgual = largoParecido && dist <= toleranciaEdicion;
    const muyParecido = dice >= 0.78;
    if (!casiIgual && !muyParecido) continue;

    const puntaje = Math.max(dice, 1 - (dist / Math.max(norm.length, otro.length)));
    if (!mejor || puntaje > mejor.puntaje) {
      mejor = { valor: lista[i], motivo: casiIgual ? 'tipeo' : 'parecido', puntaje: puntaje };
    }
  }
  return mejor ? { valor: mejor.valor, motivo: mejor.motivo } : null;
}

// ── ACCESO A LAS HOJAS ───────────────────────────────────────────────────────

/** Devuelve la hoja, creándola con sus encabezados la primera vez que hace falta. */
function opHoja_(nombre, columnas) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(nombre);
  if (!sheet) {
    sheet = ss.insertSheet(nombre);
    sheet.appendRow(columnas);
    sheet.getRange(1, 1, 1, columnas.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // NO se ocultan (a diferencia de _PermisosSistema): esto son datos operativos que un
    // supervisor va a querer mirar, filtrar o exportar tal cual desde la hoja.
    return sheet;
  }
  // Columna añadida en una versión posterior: se agrega al final sin tocar los datos.
  const ancho = Math.max(sheet.getLastColumn(), 1);
  const cabecera = sheet.getRange(1, 1, 1, ancho).getValues()[0].map(function (h) { return String(h).trim(); });
  const faltan = columnas.filter(function (c) { return cabecera.indexOf(c) === -1; });
  if (faltan.length) {
    sheet.getRange(1, ancho + 1, 1, faltan.length).setValues([faltan]).setFontWeight('bold');
  }
  return sheet;
}

/** Índice {columna: posición} a partir de la fila de encabezados. */
function opIndice_(cabecera) {
  const idx = {};
  cabecera.forEach(function (h, i) { idx[String(h).trim()] = i; });
  return idx;
}

/** Lee una hoja entera como objetos. Devuelve [] si está vacía. */
function opLeerHoja_(nombre, columnas) {
  const sheet = opHoja_(nombre, columnas);
  if (sheet.getLastRow() < 2) return [];
  const datos = sheet.getDataRange().getValues();
  const idx = opIndice_(datos.shift());
  return datos.map(function (fila, i) {
    const obj = { _fila: i + 2 };
    columnas.forEach(function (c) { obj[c] = idx[c] === undefined ? '' : fila[idx[c]]; });
    return obj;
  });
}

/** Añade una fila respetando el ORDEN REAL de los encabezados, no el del arreglo. */
function opAgregarFila_(nombre, columnas, valores) {
  const sheet = opHoja_(nombre, columnas);
  const ancho = sheet.getLastColumn();
  const cabecera = sheet.getRange(1, 1, 1, ancho).getValues()[0].map(function (h) { return String(h).trim(); });
  const fila = [];
  for (let i = 0; i < ancho; i++) {
    const clave = cabecera[i];
    fila[i] = (valores[clave] === undefined || valores[clave] === null) ? '' : valores[clave];
  }
  sheet.appendRow(fila);
  return sheet.getLastRow();
}

/**
 * Escribe SOLO las celdas indicadas de una fila.
 *
 * Reescribir la fila entera borraría cualquier columna que alguien haya añadido a mano en la
 * hoja para su propio seguimiento, y esa es justo la clase de pérdida silenciosa que hace que
 * la gente deje de confiar en una herramienta.
 */
function opEscribirCeldas_(nombre, columnas, fila, campos) {
  const sheet = opHoja_(nombre, columnas);
  const ancho = sheet.getLastColumn();
  const cabecera = sheet.getRange(1, 1, 1, ancho).getValues()[0].map(function (h) { return String(h).trim(); });
  Object.keys(campos).forEach(function (clave) {
    const col = cabecera.indexOf(clave);
    if (col === -1) return;
    sheet.getRange(fila, col + 1).setValue(campos[clave]);
  });
}

/** Identificador corto y ordenable en el tiempo. */
function opId_(prefijo) {
  return prefijo + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 46656).toString(36);
}

/** Fecha → ISO, tolerando lo que devuelva la hoja (Date, texto o vacío). */
function opISO_(valor) {
  if (!valor) return '';
  if (valor instanceof Date) return isNaN(valor.getTime()) ? '' : valor.toISOString();
  const d = new Date(valor);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function opMs_(valor) {
  const iso = opISO_(valor);
  return iso ? new Date(iso).getTime() : 0;
}

function opEsSi_(valor) {
  const s = String(valor == null ? '' : valor).trim().toLowerCase();
  return s === 'si' || s === 'sí' || s === 'true' || s === '1' || s === 'x';
}

// ── CATÁLOGO (sistemas, submotivos y estados) ────────────────────────────────

/**
 * Catálogo completo, mezclando lo fijo del código con lo que ha ido añadiendo el equipo.
 *
 * Lo de la hoja NUNCA pisa a lo base: si alguien escribe "connect" como sistema nuevo, se
 * reconoce como el Connect de siempre en vez de crear un duplicado con el que se repartirían
 * los reportes (y entonces ninguno de los dos alcanzaría el umbral).
 */
function opLeerCatalogo_() {
  // Una fila sin "Activo" es una fila recién creada por el propio módulo: cuenta como
  // activa. Solo un "No" explícito —escrito a mano en la hoja para retirar una opción de
  // la lista sin perder su historial— la deja fuera.
  const activas = opLeerHoja_(OP_SHEET_CATALOGO, OP_COLS_CATALOGO).filter(function (f) {
    if (!String(f.Valor || '').trim()) return false;
    return String(f.Activo || '').trim() === '' || opEsSi_(f.Activo);
  });

  // ── Sistemas ──
  const sistemas = OP_SISTEMAS_BASE.map(function (s) {
    return { clave: s.clave, nombre: s.nombre, publico: s.publico, orden: s.orden, base: true, usos: 0 };
  });
  const vistos = {};
  sistemas.forEach(function (s) { vistos[s.clave] = s; });

  activas.filter(function (f) { return String(f.Tipo).toLowerCase() === 'sistema'; })
    .forEach(function (f) {
      const clave = String(f.Clave || opClave_(f.Valor));
      if (vistos[clave]) { vistos[clave].usos += Number(f.Usos) || 0; return; }
      const s = {
        clave: clave, nombre: opCapitalizar_(String(f.Valor).trim()), publico: false,
        orden: 50, base: false, usos: Number(f.Usos) || 0,
        creado: opISO_(f.Creado), creadoPor: String(f.CreadoPor || '')
      };
      vistos[clave] = s;
      sistemas.push(s);
    });

  // ── Submotivos por sistema ──
  const submotivos = {};
  Object.keys(OP_SUBMOTIVOS_BASE).forEach(function (sis) {
    submotivos[sis] = OP_SUBMOTIVOS_BASE[sis].map(function (v) {
      return { valor: v, clave: opClave_(v), base: true, usos: 0 };
    });
  });
  sistemas.forEach(function (s) { if (!submotivos[s.clave]) submotivos[s.clave] = []; });

  activas.filter(function (f) { return String(f.Tipo).toLowerCase() === 'submotivo'; })
    .forEach(function (f) {
      const sis = String(f.SistemaClave || '').trim();
      if (!sis) return;
      if (!submotivos[sis]) submotivos[sis] = [];
      const clave = String(f.Clave || opClave_(f.Valor));
      const ya = submotivos[sis].filter(function (x) { return x.clave === clave; })[0];
      if (ya) { ya.usos += Number(f.Usos) || 0; return; }
      submotivos[sis].push({
        valor: opCapitalizar_(String(f.Valor).trim()), clave: clave, base: false,
        usos: Number(f.Usos) || 0, creadoPor: String(f.CreadoPor || '')
      });
    });

  // Los más usados primero: la lista se ordena sola según lo que de verdad falla.
  Object.keys(submotivos).forEach(function (sis) {
    submotivos[sis].sort(function (a, b) {
      return (b.usos - a.usos) || a.valor.localeCompare(b.valor, 'es');
    });
  });

  // ── Estados ──
  const estados = OP_ESTADOS_BASE.map(function (e) {
    return { clave: e.clave, nombre: e.nombre, tono: e.tono, afecta: e.afecta,
             cierra: e.cierra, publico: e.publico, detalle: e.detalle, base: true };
  });
  const estadosVistos = {};
  estados.forEach(function (e) { estadosVistos[e.clave] = true; });

  activas.filter(function (f) { return String(f.Tipo).toLowerCase() === 'estado'; })
    .forEach(function (f) {
      const clave = String(f.Clave || opClave_(f.Valor));
      if (estadosVistos[clave]) return;
      estadosVistos[clave] = true;
      const tono = ['ok', 'info', 'warn', 'alert', 'neutro'].indexOf(String(f.Tono)) !== -1 ? String(f.Tono) : 'warn';
      estados.push({
        clave: clave, nombre: opCapitalizar_(String(f.Valor).trim()), tono: tono,
        // Un estado que el equipo inventó cuenta como "algo pasa" salvo que se haya
        // declarado con tono verde: nadie crea un estado nuevo para decir que todo va bien.
        afecta: tono !== 'ok' && tono !== 'neutro',
        cierra: tono === 'ok' || tono === 'neutro',
        publico: tono !== 'neutro', detalle: '', base: false
      });
    });

  sistemas.sort(function (a, b) { return (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es'); });
  return { sistemas: sistemas, submotivos: submotivos, estados: estados };
}

/** Busca un estado en el catálogo; si no existe, se trata como 'posible'. */
function opEstado_(catalogo, clave) {
  const k = opClave_(clave);
  const encontrado = catalogo.estados.filter(function (e) { return e.clave === k; })[0];
  return encontrado || catalogo.estados[0];
}

/** Busca un sistema por clave o por nombre escrito. */
function opSistema_(catalogo, valor) {
  const k = opClave_(valor);
  return catalogo.sistemas.filter(function (s) { return s.clave === k; })[0] || null;
}

/**
 * Registra un valor nuevo en el catálogo, o suma un uso si ya estaba.
 * Devuelve el valor definitivo, que puede NO ser el que se escribió: si se parece mucho a
 * uno existente, gana el existente.
 */
function opCatalogoRegistrar_(tipo, sistemaClave, valor, quien, tono) {
  const limpio = opCapitalizar_(opLimpiarTexto_(valor, 60));
  if (!limpio) return '';
  const clave = opClave_(limpio);
  if (!clave) return '';

  const sheet = opHoja_(OP_SHEET_CATALOGO, OP_COLS_CATALOGO);
  const filas = opLeerHoja_(OP_SHEET_CATALOGO, OP_COLS_CATALOGO);
  const iguales = filas.filter(function (f) {
    return String(f.Tipo).toLowerCase() === tipo &&
           String(f.SistemaClave || '') === String(sistemaClave || '') &&
           String(f.Clave || opClave_(f.Valor)) === clave;
  });

  if (iguales.length) {
    const f = iguales[0];
    opEscribirCeldas_(OP_SHEET_CATALOGO, OP_COLS_CATALOGO, f._fila, {
      Usos: (Number(f.Usos) || 0) + 1, Activo: 'Si'
    });
    return String(f.Valor).trim();
  }

  opAgregarFila_(OP_SHEET_CATALOGO, OP_COLS_CATALOGO, {
    Tipo: tipo, SistemaClave: sistemaClave || '', Valor: limpio, Clave: clave,
    Tono: tono || '', Creado: new Date(), CreadoPor: quien || '', Activo: 'Si', Usos: 1
  });
  return limpio;
}

/** Suma un uso a un valor que YA está en el catálogo (o lo da de alta si venía del código). */
function opCatalogoSumarUso_(tipo, sistemaClave, valor, quien) {
  try { opCatalogoRegistrar_(tipo, sistemaClave, valor, quien); } catch (e) {
    Logger.log('opCatalogoSumarUso_: ' + e);
  }
}

// ── INCIDENTES ───────────────────────────────────────────────────────────────

/** Convierte una fila de la hoja en el objeto que viaja al cliente. */
function opIncidenteDeFila_(f, catalogo) {
  const estado = opEstado_(catalogo, f.Estado);
  return {
    id: String(f.ID || ''),
    clave: String(f.Clave || ''),
    sistema: String(f.Sistema || ''),
    sistemaClave: String(f.SistemaClave || ''),
    submotivo: String(f.Submotivo || ''),
    estado: estado.clave,
    estadoNombre: estado.nombre,
    tono: estado.tono,
    afecta: estado.afecta,
    cierra: estado.cierra,
    estadoPublico: estado.publico,
    titulo: String(f.Titulo || ''),
    detalle: String(f.Detalle || ''),
    creado: opISO_(f.Creado),
    creadoPor: String(f.CreadoPor || ''),
    creadoNombre: String(f.CreadoNombre || ''),
    confirmado: opISO_(f.Confirmado),
    confirmadoPor: String(f.ConfirmadoPor || ''),
    confirmadoNombre: String(f.ConfirmadoNombre || ''),
    actualizado: opISO_(f.Actualizado),
    cerrado: opISO_(f.Cerrado),
    origen: String(f.Origen || 'automatico'),
    _fila: f._fila
  };
}

/** Incidentes vivos (los que no han cerrado), ya caducados los "posible" abandonados. */
function opIncidentesVivos_(catalogo) {
  const filas = opLeerHoja_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES);
  return filas.map(function (f) { return opIncidenteDeFila_(f, catalogo); })
              .filter(function (i) { return i.id && !i.cierra; });
}

/**
 * Apaga los "posible" que nadie confirmó y que dejaron de recibir reportes.
 *
 * Se hace al LEER y no con un disparador: un disparador más es una cosa más que se puede
 * quedar sin autorizar y fallar en silencio, y aquí no hay nada urgente que hacer si nadie
 * está mirando la pantalla.
 */
function opCaducarPosibles_(catalogo) {
  const limite = Date.now() - OP_HORAS_CADUCA_POSIBLE * 3600 * 1000;
  const vivos = opIncidentesVivos_(catalogo);
  const pendientes = vivos.filter(function (i) {
    if (i.estado !== 'posible' || i.confirmado) return false;
    const ultima = Math.max(opMs_(i.actualizado), opMs_(i.creado));
    return ultima && ultima < limite;
  });
  if (!pendientes.length) return 0;

  pendientes.forEach(function (i) {
    try {
      opEscribirCeldas_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES, i._fila, {
        Estado: 'descartado',
        Cerrado: new Date(),
        Actualizado: new Date(),
        Detalle: i.detalle || 'Se apagó solo: nadie lo confirmó y dejaron de llegar reportes.'
      });
      opAgregarFila_(OP_SHEET_ACTUALIZACIONES, OP_COLS_ACTUALIZACIONES, {
        ID: opId_('act'), IncidenteId: i.id, Fecha: new Date(),
        Autor: 'sistema', AutorNombre: 'Sistema', Estado: 'descartado',
        Nota: 'Sin reportes nuevos en ' + OP_HORAS_CADUCA_POSIBLE +
              (OP_HORAS_CADUCA_POSIBLE === 1 ? ' hora' : ' horas') + ' y sin confirmar. Se cerró solo.',
        Aviso: 'No'
      });
    } catch (e) {
      Logger.log('opCaducarPosibles_ (' + i.id + '): ' + e);
    }
  });
  opInvalidarCache_();
  return pendientes.length;
}

/** Título por omisión de un incidente, en el idioma del equipo. */
function opTitulo_(sistema, submotivo) {
  if (submotivo) return sistema + ' · ' + submotivo;
  return 'Problemas con ' + sistema;
}

// ── CACHÉ ────────────────────────────────────────────────────────────────────

/**
 * El estado se pinta en TODAS las pantallas, así que se pide muchísimo. Sin caché, cada
 * navegación del equipo entero se traduce en dos lecturas completas de hoja.
 *
 * El TTL es corto a propósito (45 s en la vista pública): esto es información que la gente
 * mira justo cuando algo se está cayendo, y un minuto de retraso ahí se nota. Además toda
 * escritura invalida, así que confirmar una falla se ve al instante.
 */
const OP_CACHE_PROP = 'OP_CACHE_GEN';
const OP_TTL_PUBLICO = 45;
const OP_TTL_SESION = 30;
var OP_GEN_MEMO = null;

function opGeneracion_() {
  if (OP_GEN_MEMO !== null) return OP_GEN_MEMO;
  try {
    OP_GEN_MEMO = PropertiesService.getScriptProperties().getProperty(OP_CACHE_PROP) || '0';
  } catch (e) { OP_GEN_MEMO = '0'; }
  return OP_GEN_MEMO;
}

function opInvalidarCache_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const actual = parseInt(props.getProperty(OP_CACHE_PROP) || '0', 10) || 0;
    const siguiente = String((actual + 1) % 1000000);
    props.setProperty(OP_CACHE_PROP, siguiente);
    OP_GEN_MEMO = siguiente;
  } catch (e) {
    Logger.log('opInvalidarCache_: ' + e.message);
  }
}

/** Clave de una entrada de esta caché. Lleva la generación: invalidar es cambiar de clave. */
function opCacheClave_(nombre) {
  return 'op_g' + opGeneracion_() + '_' + nombre;
}

function opCacheado_(nombre, ttl, productor) {
  try {
    const cache = CacheService.getScriptCache();
    const hit = cache.get(opCacheClave_(nombre));
    if (hit) return JSON.parse(hit);

    const fresco = productor();
    if (fresco && fresco.success !== false) {
      const json = JSON.stringify(fresco);
      // La clave se recalcula AQUÍ, no arriba: el productor puede haber invalidado la caché
      // por el camino (opCaducarPosibles_ cierra incidencias abandonadas mientras lee), y
      // guardar bajo la generación anterior dejaba la entrada muerta al nacer.
      if (json.length < 95000) cache.put(opCacheClave_(nombre), json, ttl);
    }
    return fresco;
  } catch (e) {
    return productor();
  }
}

// =================================================================================================
// API PÚBLICA (sin sesión)
// =================================================================================================

/**
 * Estado de los sistemas para quien NO ha iniciado sesión.
 *
 * Lo que sale de aquí lo puede ver cualquiera que tenga el enlace, así que aquí no entra ni
 * un correo, ni una nota interna, ni una evidencia. Solo: qué sistema, qué le pasa, desde
 * cuándo y la última actualización que supervisión decidió publicar.
 */
function opEstadoPublico() {
  try {
    return opCacheado_('publico', OP_TTL_PUBLICO, function () { return opCalcularEstadoPublico_(); });
  } catch (e) {
    Logger.log('opEstadoPublico: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos consultar el estado en este momento.' };
  }
}

/**
 * opEstadoPublico SOLO si ya está en caché; null si no. La usa el doGet para servir el estado
 * dentro de la página (datosInicialesDePagina_, Code.gs, F3) y por eso no pasa por el
 * productor: ese lee las hojas y puede escribir al caducar incidencias abandonadas.
 */
function opEstadoPublicoEnCache_() {
  try {
    const hit = CacheService.getScriptCache().get(opCacheClave_('publico'));
    return hit ? JSON.parse(hit) : null;
  } catch (e) {
    return null;
  }
}

function opCalcularEstadoPublico_() {
  const catalogo = opLeerCatalogo_();
  opCaducarPosibles_(catalogo);

  const vivos = opIncidentesVivos_(catalogo).filter(function (i) { return i.estadoPublico; });
  const ultimas = opUltimasActualizaciones_(vivos.map(function (i) { return i.id; }), true);

  const sistemas = catalogo.sistemas.map(function (s) {
    const suyos = vivos.filter(function (i) { return i.sistemaClave === s.clave && i.afecta; });
    // Manda el incidente más grave: confirmado antes que intermitencia, y esa antes que
    // una sospecha. Decir "intermitencia" cuando además hay una caída confirmada sería
    // quedarse corto justo cuando más importa.
    const orden = { alert: 3, warn: 2, info: 1, ok: 0, neutro: 0 };
    suyos.sort(function (a, b) { return (orden[b.tono] || 0) - (orden[a.tono] || 0); });
    const peor = suyos[0] || null;

    return {
      clave: s.clave,
      nombre: s.nombre,
      destacado: !!s.publico,
      tono: peor ? peor.tono : 'ok',
      estado: peor ? peor.estado : 'operativo',
      estadoNombre: peor ? peor.estadoNombre : 'Funcionando',
      incidentes: suyos.map(function (i) {
        return {
          id: i.id, titulo: i.titulo || opTitulo_(i.sistema, i.submotivo),
          submotivo: i.submotivo, estado: i.estado, estadoNombre: i.estadoNombre,
          tono: i.tono, desde: i.confirmado || i.creado,
          detalle: i.detalle, ultima: ultimas[i.id] || null
        };
      })
    };
  });

  const afectados = sistemas.filter(function (s) { return s.tono !== 'ok'; });
  const hayAlert = afectados.some(function (s) { return s.tono === 'alert'; });

  /*
   * ¿Todo lo que hay es SOSPECHA? Es decir: saltó un umbral, nadie de supervisión ha pasado
   * todavía y no hay ninguna falla confirmada ni ningún mantenimiento en curso.
   *
   * Importa porque cambia lo que se puede afirmar. "Hay una incidencia en Connect" es una
   * afirmación, y si media hora después resulta que era la red de una sola sala, el tablero
   * queda desmentido y la próxima vez nadie lo mira. Mientras solo hay sospecha se dice lo
   * que de verdad se sabe.
   */
  const queAfectan = vivos.filter(function (i) { return i.afecta; });
  const soloSospecha = !!queAfectan.length && queAfectan.every(function (i) {
    return i.estado === 'posible' && !i.confirmado;
  });

  let resumen;
  if (!afectados.length) {
    resumen = 'Todos los sistemas funcionan con normalidad.';
  } else if (soloSospecha) {
    resumen = OP_AVISO_POSIBLE + (afectados.length === 1
      ? ' Los reportes apuntan a ' + afectados[0].nombre + '.'
      : ' Los reportes apuntan a ' + afectados.length + ' sistemas.');
  } else {
    resumen = afectados.length === 1
      ? 'Hay una incidencia en ' + afectados[0].nombre + '.'
      : 'Hay incidencias en ' + afectados.length + ' sistemas.';
  }

  return {
    success: true,
    consultado: new Date().toISOString(),
    global: !afectados.length ? 'ok' : (hayAlert ? 'alert' : 'warn'),
    sospecha: soloSospecha,
    resumen: resumen,
    sistemas: sistemas,
    incidentes: vivos.filter(function (i) { return i.afecta; }).map(function (i) {
      return {
        id: i.id, sistema: i.sistema, sistemaClave: i.sistemaClave,
        submotivo: i.submotivo, titulo: i.titulo || opTitulo_(i.sistema, i.submotivo),
        estado: i.estado, estadoNombre: i.estadoNombre, tono: i.tono,
        desde: i.confirmado || i.creado, detalle: i.detalle, ultima: ultimas[i.id] || null
      };
    })
  };
}

// =================================================================================================
// HISTORIAL GRÁFICO POR FECHAS
// =================================================================================================
//
// El tablero contesta "¿está caído AHORA?". Esta parte contesta la otra pregunta, que se hace
// igual de a menudo y hasta ahora no tenía respuesta: "¿esto lleva pasando toda la semana?".
//
// Sin historial, cada caída parece la primera. Con él se ve de un vistazo si Connect falla los
// lunes por la mañana, si una incidencia "resuelta" volvió tres veces, o si el mes ha sido
// tranquilo — que es justo lo que hay que llevar a una reunión con el proveedor.
//
// EL SEMÁFORO DE CADA BARRA
// -------------------------
//     0 reportes                          verde   · ese día no pasó nada
//     de 1 al umbral - 1                  ámbar   · hubo ruido, no llegó a incidencia
//     umbral o más, O una falla confirmada rojo   · ese día el sistema falló de verdad
//
// El umbral es el MISMO que dispara un incidente automático (OP_UMBRAL_PERSONAS). Usar aquí un
// número distinto haría que el gráfico y las alertas contaran historias diferentes sobre el
// mismo día, y la primera vez que alguien lo notara dejaría de fiarse de los dos.
//
// Una falla CONFIRMADA pinta el día en rojo aunque hubiera pocos reportes. Es deliberado: que
// solo tres personas reportaran una caída no la hace pequeña, normalmente significa que las
// demás ya habían dejado de intentarlo.

/**
 * Cuántos días de historia se pueden pedir.
 *
 * Treinta, y no noventa como antes. La pregunta que contesta este gráfico es "¿esto lleva
 * pasando?", y esa se contesta con el mes en curso: a los noventa días la tira tiene barras
 * de dos píxeles, ninguna se puede señalar con el ratón y lo único que queda es una mancha
 * de color. Un trimestre es material para un informe, no para una pantalla de operación —y
 * para un informe hace falta una tabla, no barras—.
 */
const OP_HISTORIAL_MAX_DIAS = 30;
const OP_HISTORIAL_POR_OMISION = 14;

/** Cuánto se cachea el historial. Es un gráfico por día: no cambia de un segundo a otro. */
const OP_TTL_HISTORIAL = 600;

/**
 * EL GRÁFICO POR HORAS · lo primero que se enseña
 * ------------------------------------------------
 * El historial por días contesta "¿esto lleva pasando toda la semana?". Es buena pregunta,
 * pero no es la primera: quien abre el tablero casi siempre acaba de tropezarse con algo y lo
 * que necesita saber es a qué hora empezó, si sigue subiendo o si ya está bajando. En una
 * tira de días eso es UNA barra —la de hoy— y no dice nada de eso.
 *
 * Por hora sí se ve: el escalón de las 11:20, la meseta de la comida, el pico de la tarde. Es
 * además la escala en la que se decide algo (avisar al proveedor, mandar a la gente a otro
 * flujo), mientras que la de días solo sirve para contarlo después.
 *
 * TREINTA MINUTOS DE CACHÉ para el día... y dos para las horas: una serie por hora cambia
 * mientras se mira, y enseñarla con diez minutos de retraso durante una caída en curso es
 * justo cuando peor sienta.
 */
const OP_HISTORIAL_MAX_HORAS = 72;
const OP_HISTORIAL_HORAS_POR_OMISION = 24;
const OP_TTL_HISTORIAL_HORAS = 120;

/** Fecha local en formato AAAA-MM-DD, según la zona horaria del script. */
function opDiaClave_(valor) {
  const ms = opMs_(valor);
  if (!ms) return '';
  try {
    return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (e) {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * Clave local de una hora, 'AAAA-MM-DD HH'. Misma zona que opDiaClave_: si una usara la del
 * script y la otra UTC, el gráfico por horas y el de días contarían el mismo reporte en días
 * distintos y no habría forma de darse cuenta mirándolos.
 */
function opHoraClave_(valor) {
  const ms = opMs_(valor);
  if (!ms) return '';
  try {
    return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'yyyy-MM-dd HH');
  } catch (e) {
    return new Date(ms).toISOString().slice(0, 13).replace('T', ' ');
  }
}

/**
 * Tono de un tramo a partir de cuánta gente reportó y de si hubo algo confirmado.
 *
 * Sirve igual para un día que para una hora, y a propósito: el umbral es de PERSONAS
 * distintas, así que aplicado a una hora es incluso más fiel a lo que mide la alerta
 * automática —tres personas en media hora—. Dos escalas con dos criterios distintos
 * pintarían el mismo suceso de dos colores según qué botón estuviera pulsado.
 */
function opTonoDelDia_(reportes, confirmados) {
  if (confirmados > 0) return 'alert';
  if (reportes >= OP_UMBRAL_PERSONAS) return 'alert';
  if (reportes > 0) return 'warn';
  return 'ok';
}

/**
 * Serie por fecha, por sistema y en total.
 *
 * Es PÚBLICA igual que el tablero: la pregunta "¿está caído o soy yo?" tiene que poder
 * contestarse justo cuando no puedes entrar, y la versión histórica de esa pregunta también.
 * Aquí no viaja ni un correo ni una nota interna: solo cuántos reportes hubo cada día y qué se
 * confirmó, que es lo mismo que ya se publica del día de hoy.
 *
 * @param {number=} dias  Cuántos días hacia atrás. Por omisión 14.
 */
function opHistorialPublico(dias) {
  try {
    const n = Math.max(1, Math.min(OP_HISTORIAL_MAX_DIAS, Number(dias) || OP_HISTORIAL_POR_OMISION));
    return opCacheado_('historial_' + n, OP_TTL_HISTORIAL, function () {
      return opCalcularHistorial_(n);
    });
  } catch (e) {
    Logger.log('opHistorialPublico: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos consultar el historial en este momento.' };
  }
}

function opCalcularHistorial_(dias) {
  const catalogo = opLeerCatalogo_();

  // El eje se construye ANTES de mirar los datos, día por día hacia atrás. Si se armara a
  // partir de los reportes, los días sin ninguno no existirían y el gráfico se comprimiría
  // saltándoselos — que es justo al revés de lo que interesa: un día en blanco es un día bueno
  // y tiene que verse, no desaparecer.
  const hoy = new Date();
  const eje = [];
  const posicion = {};
  for (let d = dias - 1; d >= 0; d--) {
    const fecha = new Date(hoy.getTime() - d * 86400000);
    const clave = opDiaClave_(fecha);
    posicion[clave] = eje.length;
    eje.push(clave);
  }
  const desdeMs = opMs_(new Date(hoy.getTime() - (dias - 1) * 86400000)) - 86400000;

  /** Contadores vacíos para una serie completa. */
  const serieVacia = function () {
    return eje.map(function (f) {
      return { fecha: f, reportes: 0, personas: 0, confirmados: 0, tono: 'ok' };
    });
  };

  const porSistema = {};
  catalogo.sistemas.forEach(function (s) {
    porSistema[s.clave] = {
      clave: s.clave, nombre: s.nombre, destacado: !!s.publico,
      dias: serieVacia(), total: 0, diasMalos: 0,
      // Las personas distintas se cuentan por día con un conjunto aparte y se tira al final:
      // lo que viaja al cliente es el número, no la lista de quién reportó.
      _personas: eje.map(function () { return {}; })
    };
  });
  const totales = serieVacia();
  const personasTotales = eje.map(function () { return {}; });

  // ── Reportes ───────────────────────────────────────────────────────────────
  opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES).forEach(function (f) {
    const ms = opMs_(f.Fecha);
    if (!ms || ms < desdeMs) return;
    const clave = opDiaClave_(f.Fecha);
    const i = posicion[clave];
    if (i === undefined) return;

    const sis = String(f.SistemaClave || '');
    const correo = String(f.Correo || '').toLowerCase();

    if (porSistema[sis]) {
      porSistema[sis].dias[i].reportes++;
      porSistema[sis].total++;
      if (correo) porSistema[sis]._personas[i][correo] = true;
    }
    totales[i].reportes++;
    if (correo) personasTotales[i][correo] = true;
  });

  // ── Incidentes confirmados ─────────────────────────────────────────────────
  //
  // Se cuenta por el día en que se CONFIRMÓ, no por el día en que se creó el registro. Un
  // incidente que se abrió a las 23:50 y se confirmó a las 00:10 pertenece al día en que se
  // supo que era real, que es el día del que la gente se acuerda.
  //
  // Y se cuentan también los CERRADOS: aquí está la persistencia pública que pedía el
  // requisito. Una falla confirmada no desaparece del historial cuando se resuelve; el
  // tablero de hoy deja de mostrarla —ya no afecta— pero el gráfico la conserva. Un
  // historial que se borra solo al arreglar las cosas siempre enseña una semana perfecta.
  const confirmadosPorDia = {};
  opLeerHoja_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES).forEach(function (f) {
    const inc = opIncidenteDeFila_(f, catalogo);
    if (!inc.id || !inc.confirmado) return;
    const clave = opDiaClave_(inc.confirmado);
    const i = posicion[clave];
    if (i === undefined) return;

    if (porSistema[inc.sistemaClave]) porSistema[inc.sistemaClave].dias[i].confirmados++;
    totales[i].confirmados++;

    if (!confirmadosPorDia[clave]) confirmadosPorDia[clave] = [];
    confirmadosPorDia[clave].push({
      id: inc.id,
      sistema: inc.sistema,
      sistemaClave: inc.sistemaClave,
      titulo: inc.titulo || opTitulo_(inc.sistema, inc.submotivo),
      estado: inc.estado,
      estadoNombre: inc.estadoNombre,
      confirmado: inc.confirmado,
      cerrado: inc.cerrado,
      // `vigente` distingue "esto sigue pasando" de "esto pasó y se arregló". Las dos cosas
      // se enseñan, pero no significan lo mismo al mirar el gráfico.
      vigente: !inc.cierra
    });
  });

  // ── Cierre: tonos y limpieza ───────────────────────────────────────────────
  const sistemas = catalogo.sistemas.map(function (s) {
    const x = porSistema[s.clave];
    x.dias.forEach(function (d, i) {
      d.personas = Object.keys(x._personas[i]).length;
      // El umbral es de PERSONAS distintas, así que el tono se decide con esa cifra y no con
      // el total de reportes: cinco reportes de la misma persona son una persona con un
      // problema, no un sistema caído. Es la misma regla que usa opEvaluarUmbral_.
      d.tono = opTonoDelDia_(d.personas, d.confirmados);
      if (d.tono !== 'ok') x.diasMalos++;
    });
    delete x._personas;
    return x;
  });

  totales.forEach(function (d, i) {
    d.personas = Object.keys(personasTotales[i]).length;
    d.tono = opTonoDelDia_(d.personas, d.confirmados);
  });

  const diasConAlgo = totales.filter(function (d) { return d.tono !== 'ok'; }).length;

  return {
    success: true,
    consultado: new Date().toISOString(),
    // `modo` y `tramos` son los nombres neutros que también usa la serie por horas, para que
    // el gráfico del cliente no tenga que saber cuál de las dos está pintando salvo para
    // rotular el eje. `dias` se conserva porque ya había código leyéndolo.
    modo: 'dias',
    dias: dias,
    tramos: dias,
    desde: eje[0],
    hasta: eje[eje.length - 1],
    eje: eje,
    umbral: OP_UMBRAL_PERSONAS,
    sistemas: sistemas,
    totales: totales,
    // El historial de fallas confirmadas, por día. Es lo que se queda publicado para siempre.
    confirmados: confirmadosPorDia,
    resumen: {
      limpios: dias - diasConAlgo,
      conIncidencias: diasConAlgo,
      diasLimpios: dias - diasConAlgo,
      diasConIncidencias: diasConAlgo,
      reportes: totales.reduce(function (a, d) { return a + d.reportes; }, 0),
      confirmados: totales.reduce(function (a, d) { return a + d.confirmados; }, 0)
    }
  };
}

/**
 * Serie por HORA, por sistema y en total. La misma forma que el historial por días, para que
 * el gráfico del cliente sea uno solo y no dos que se parecen.
 *
 * Es pública por la misma razón que el resto del tablero: "¿desde qué hora está fallando?" es
 * la versión útil de "¿está caído?", y hay que poder contestarla justo cuando no puedes
 * entrar. No viaja ni un correo ni una nota interna, solo cuántos reportes hubo y qué se
 * confirmó.
 *
 * @param {number=} horas Cuántas horas hacia atrás. Por omisión 24.
 */
function opHistorialHorasPublico(horas) {
  try {
    const n = Math.max(1, Math.min(OP_HISTORIAL_MAX_HORAS,
                                   Number(horas) || OP_HISTORIAL_HORAS_POR_OMISION));
    return opCacheado_('historial_h' + n, OP_TTL_HISTORIAL_HORAS, function () {
      return opCalcularHistorialHoras_(n);
    });
  } catch (e) {
    Logger.log('opHistorialHorasPublico: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos consultar el historial por horas en este momento.' };
  }
}

function opCalcularHistorialHoras_(horas) {
  const catalogo = opLeerCatalogo_();

  // El eje se construye hacia atrás desde la hora EN CURSO, igual que el de días se construye
  // desde hoy: las horas sin ningún reporte tienen que ocupar su hueco. Si el eje saliera de
  // los datos, una madrugada tranquila desaparecería y el pico de la mañana quedaría pegado
  // al de la tarde anterior, que es exactamente la lectura contraria a la verdadera.
  const ahora = new Date();
  const enPunto = new Date(ahora.getTime());
  enPunto.setMinutes(0, 0, 0);

  const eje = [];
  const posicion = {};
  const inicios = [];
  for (let h = horas - 1; h >= 0; h--) {
    const inicio = new Date(enPunto.getTime() - h * 3600000);
    const clave = opHoraClave_(inicio);
    posicion[clave] = eje.length;
    eje.push(clave);
    inicios.push(inicio.toISOString());
  }
  const desdeMs = enPunto.getTime() - (horas - 1) * 3600000;

  const serieVacia = function () {
    return eje.map(function (clave, i) {
      return { fecha: clave, inicio: inicios[i], reportes: 0, personas: 0, confirmados: 0, tono: 'ok' };
    });
  };

  const porSistema = {};
  catalogo.sistemas.forEach(function (s) {
    porSistema[s.clave] = {
      clave: s.clave, nombre: s.nombre, destacado: !!s.publico,
      dias: serieVacia(), total: 0, diasMalos: 0,
      // Las personas distintas se cuentan aparte y el conjunto se tira al final: lo que
      // viaja al cliente es el número, nunca quién reportó.
      _personas: eje.map(function () { return {}; })
    };
  });
  const totales = serieVacia();
  const personasTotales = eje.map(function () { return {}; });

  opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES).forEach(function (f) {
    const ms = opMs_(f.Fecha);
    if (!ms || ms < desdeMs) return;
    const i = posicion[opHoraClave_(f.Fecha)];
    if (i === undefined) return;

    const sis = String(f.SistemaClave || '');
    const correo = String(f.Correo || '').toLowerCase();

    if (porSistema[sis]) {
      porSistema[sis].dias[i].reportes++;
      porSistema[sis].total++;
      if (correo) porSistema[sis]._personas[i][correo] = true;
    }
    totales[i].reportes++;
    if (correo) personasTotales[i][correo] = true;
  });

  // Se cuenta por la hora en que se CONFIRMÓ, igual que el historial por días cuenta por el
  // día de la confirmación: es el momento en que se supo que era real.
  const confirmadosPorHora = {};
  opLeerHoja_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES).forEach(function (f) {
    const inc = opIncidenteDeFila_(f, catalogo);
    if (!inc.id || !inc.confirmado) return;
    const clave = opHoraClave_(inc.confirmado);
    const i = posicion[clave];
    if (i === undefined) return;

    if (porSistema[inc.sistemaClave]) porSistema[inc.sistemaClave].dias[i].confirmados++;
    totales[i].confirmados++;

    if (!confirmadosPorHora[clave]) confirmadosPorHora[clave] = [];
    confirmadosPorHora[clave].push({
      id: inc.id,
      sistema: inc.sistema,
      sistemaClave: inc.sistemaClave,
      titulo: inc.titulo || opTitulo_(inc.sistema, inc.submotivo),
      estado: inc.estado,
      estadoNombre: inc.estadoNombre,
      confirmado: inc.confirmado,
      cerrado: inc.cerrado,
      vigente: !inc.cierra
    });
  });

  const sistemas = catalogo.sistemas.map(function (s) {
    const x = porSistema[s.clave];
    x.dias.forEach(function (d, i) {
      d.personas = Object.keys(x._personas[i]).length;
      d.tono = opTonoDelDia_(d.personas, d.confirmados);
      if (d.tono !== 'ok') x.diasMalos++;
    });
    delete x._personas;
    return x;
  });

  totales.forEach(function (d, i) {
    d.personas = Object.keys(personasTotales[i]).length;
    d.tono = opTonoDelDia_(d.personas, d.confirmados);
  });

  const conAlgo = totales.filter(function (d) { return d.tono !== 'ok'; }).length;

  return {
    success: true,
    consultado: new Date().toISOString(),
    // `modo` es lo que el cliente mira para saber cómo rotular el eje. Los demás nombres
    // son los mismos que en la serie por días a propósito: el gráfico es uno solo.
    modo: 'horas',
    horas: horas,
    tramos: horas,
    desde: eje[0],
    hasta: eje[eje.length - 1],
    desdeISO: inicios[0],
    hastaISO: inicios[inicios.length - 1],
    eje: eje,
    umbral: OP_UMBRAL_PERSONAS,
    sistemas: sistemas,
    totales: totales,
    confirmados: confirmadosPorHora,
    resumen: {
      limpios: horas - conAlgo,
      conIncidencias: conAlgo,
      reportes: totales.reduce(function (a, d) { return a + d.reportes; }, 0),
      confirmados: totales.reduce(function (a, d) { return a + d.confirmados; }, 0)
    }
  };
}

/**
 * Últimas actualizaciones por incidente.
 * @param {boolean} soloAvisadas true = solo las que supervisión decidió anunciar. Una nota
 *        interna ("ya llamé al proveedor") no es lo mismo que un comunicado.
 */
function opUltimasActualizaciones_(ids, soloAvisadas) {
  const out = {};
  if (!ids || !ids.length) return out;
  const buscados = {};
  ids.forEach(function (id) { buscados[id] = true; });

  opLeerHoja_(OP_SHEET_ACTUALIZACIONES, OP_COLS_ACTUALIZACIONES).forEach(function (f) {
    const id = String(f.IncidenteId || '');
    if (!buscados[id]) return;
    if (soloAvisadas && !opEsSi_(f.Aviso)) return;
    const nota = String(f.Nota || '').trim();
    if (!nota) return;
    const fecha = opISO_(f.Fecha);
    if (!out[id] || fecha > out[id].fecha) {
      out[id] = { fecha: fecha, nota: nota, estado: String(f.Estado || '') };
    }
  });
  return out;
}

// =================================================================================================
// API CON SESIÓN
// =================================================================================================

/**
 * Lo que necesita el indicador que vive en todas las pantallas: el estado, el catálogo para
 * poder reportar y si esta persona ya reportó lo que está pasando.
 */
function opEstadoSesion(email) {
  try {
    const id = secIdentidad_(email);
    if (!id.ok) {
      // Sin sesión válida no se cierra la puerta: se devuelve lo público, que es lo que esa
      // persona podría ver de todos modos abriendo la pantalla de estado.
      const publico = opEstadoPublico();
      publico.sesion = false;
      return publico;
    }

    const base = opCacheado_('sesion', OP_TTL_SESION, function () {
      const catalogo = opLeerCatalogo_();
      opCaducarPosibles_(catalogo);
      const publico = opCalcularEstadoPublico_();
      return {
        success: true,
        estado: publico,
        catalogo: {
          sistemas: catalogo.sistemas.map(function (s) {
            return { clave: s.clave, nombre: s.nombre, base: s.base };
          }),
          submotivos: catalogo.submotivos,
          estados: catalogo.estados
        }
      };
    });

    const salida = JSON.parse(JSON.stringify(base));
    salida.sesion = true;
    salida.puedeGestionar = (id.bloques || []).indexOf(OP_BLOQUE) !== -1;
    salida.mios = opReportesDeAsesor_(id.email);
    salida.yo = { email: id.email, nombre: id.nombre };
    // F2 (T2.1) · El conteo de revisiones pendientes para la isla de notificaciones.
    // Va AQUÍ y no dentro de `base`: la parte cacheada se comparte entre todos los
    // usuarios, y un dato que depende del permiso de quien pregunta guardado ahí se
    // le serviría también a quien no lo tiene. Solo viaja si la identidad trae el
    // bloque 'revisar' —el payload de un asesor sin él no lleva ni el campo— y la
    // rama pública (opEstadoPublico) jamás pasa por aquí. Si el conteo falla (-1),
    // el campo se omite y la isla simplemente no pinta el óvalo hasta el siguiente
    // sondeo. Su caché propia vive en revConteoPendientes_ (Revision.gs), así que
    // este añadido no encarece la llamada que la isla ya hace cada 120 s.
    if ((id.bloques || []).indexOf('revisar') !== -1 && typeof revConteoPendientes_ === 'function') {
      const pendientes = revConteoPendientes_();
      if (pendientes >= 0) salida.revision = { pendientes: pendientes };
    }
    return salida;
  } catch (e) {
    Logger.log('opEstadoSesion: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos consultar el estado en este momento.' };
  }
}

/** Identificadores de los incidentes que ESTA persona ya reportó (para no pedirle lo mismo). */
function opReportesDeAsesor_(correo) {
  const desde = Date.now() - 12 * 3600 * 1000;
  const out = [];
  opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES).forEach(function (f) {
    if (String(f.Correo || '').toLowerCase() !== String(correo || '').toLowerCase()) return;
    if (opMs_(f.Fecha) < desde) return;
    out.push({ incidenteId: String(f.IncidenteId || ''), clave: String(f.SistemaClave || '') + '|' + String(f.SubmotivoClave || ''), fecha: opISO_(f.Fecha) });
  });
  return out;
}

/**
 * Guarda un reporte de un asesor y decide si con él ya hay motivo para alertar al equipo.
 *
 * @param {object} payload {
 *   email, sistema, sistemaNuevo, submotivo, submotivoNuevo, notas, evidencias:[{url,id,nombre}]
 * }
 */
function opReportar(payload) {
  const lock = LockService.getScriptLock();
  try {
    payload = payload || {};
    const id = secIdentidad_(payload.email);
    if (!id.ok) return { success: false, message: id.error || 'Inicia sesión para reportar una falla.' };

    // ── Sistema ──
    const catalogo = opLeerCatalogo_();
    let sistemaNombre = '';
    let sistemaClave = '';
    const escrito = opLimpiarTexto_(payload.sistemaNuevo, 60);

    if (escrito) {
      const nombres = catalogo.sistemas.map(function (s) { return s.nombre; });
      const sugerido = opSugerirExistente_(escrito, nombres);
      sistemaNombre = sugerido ? sugerido.valor : opCapitalizar_(escrito);
      const yaExiste = opSistema_(catalogo, sistemaNombre);
      sistemaClave = yaExiste ? yaExiste.clave : opClave_(sistemaNombre);
      if (!yaExiste) opCatalogoRegistrar_('sistema', '', sistemaNombre, id.email);
    } else {
      const s = opSistema_(catalogo, payload.sistema);
      if (!s) return { success: false, message: 'Elige el sistema que está fallando.' };
      sistemaNombre = s.nombre;
      sistemaClave = s.clave;
    }
    if (!sistemaClave) return { success: false, message: 'Elige el sistema que está fallando.' };

    // ── Submotivo ──
    let submotivo = '';
    const subEscrito = opLimpiarTexto_(payload.submotivoNuevo, 60);
    if (subEscrito) {
      const existentes = (catalogo.submotivos[sistemaClave] || []).map(function (x) { return x.valor; });
      const sugerido = opSugerirExistente_(subEscrito, existentes);
      submotivo = sugerido ? sugerido.valor : opCapitalizar_(subEscrito);
      opCatalogoRegistrar_('submotivo', sistemaClave, submotivo, id.email);
    } else {
      submotivo = opLimpiarTexto_(payload.submotivo, 60);
      if (submotivo) opCatalogoSumarUso_('submotivo', sistemaClave, submotivo, id.email);
    }
    if (!submotivo) return { success: false, message: 'Dinos qué es lo que está fallando.' };
    const submotivoClave = opClave_(submotivo);

    const notas = opLimpiarNotas_(payload.notas, 1200);
    const evidencias = opValidarEvidencias_(payload.evidencias);

    // ── Frenos ──
    const freno = opRevisarFrenos_(id.email, sistemaClave, submotivoClave);
    if (!freno.ok) return { success: false, message: freno.message, repetido: !!freno.repetido };

    lock.waitLock(20000);

    const catalogo2 = opLeerCatalogo_();
    const clave = sistemaClave + '|' + submotivoClave;
    const reporteId = opId_('rep');
    const ahora = new Date();

    // ── ¿Ya hay un incidente vivo al que pertenece este reporte? ──
    const incidente = opIncidenteParaReporte_(catalogo2, sistemaClave, submotivo, submotivoClave);

    opAgregarFila_(OP_SHEET_REPORTES, OP_COLS_REPORTES, {
      ID: reporteId, Fecha: ahora, Correo: id.email, Nombre: id.nombre,
      Sistema: sistemaNombre, SistemaClave: sistemaClave,
      Submotivo: submotivo, SubmotivoClave: submotivoClave,
      Notas: notas, Evidencias: JSON.stringify(evidencias),
      IncidenteId: incidente ? incidente.id : '',
      Estado: incidente ? 'vinculado' : 'abierto'
    });
    // Sin esto, opEvaluarUmbral_ vuelve a leer la hoja y puede no ver ESTE reporte todavía:
    // el tercero de tres se perdería justo en el momento en que debía saltar la alerta.
    SpreadsheetApp.flush();

    // ── ¿Este reporte cruza el umbral? ──
    let creado = null;
    let incidenteFinal = incidente;
    if (!incidente) {
      // Primero por motivo: "Connect · No abre" dice mucho más que "Problemas con Connect".
      // Si las tres personas no coincidieron en la queja, se mira el sistema entero.
      creado = opEvaluarUmbral_(catalogo2, sistemaNombre, sistemaClave, submotivo, submotivoClave, id);
      if (!creado) creado = opEvaluarUmbralServicio_(catalogo2, sistemaNombre, sistemaClave);
      if (creado) incidenteFinal = creado;
    } else {
      opEscribirCeldas_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES, incidente._fila, { Actualizado: ahora });
    }

    opInvalidarCache_();

    opAvisarReporte_({
      reporteId: reporteId, sistema: sistemaNombre, submotivo: submotivo,
      nombre: id.nombre, correo: id.email, notas: notas,
      evidencias: evidencias.length, incidente: incidenteFinal, nuevo: !!creado
    });

    // Un incidente que nace de un umbral SÍ se anuncia al equipo, con su etiqueta de sospecha
    // bien clara. Esperar a la confirmación humana para decir algo desperdicia justo los
    // minutos en los que la gente todavía está intentando trabajar contra un sistema caído.
    if (creado) {
      opAvisarEstado_(creado, {
        nota: 'Detectado automáticamente: ' + OP_UMBRAL_PERSONAS + ' personas reportaron ' +
              (creado.submotivo ? 'lo mismo' : 'fallas en este sistema') + ' en menos de ' +
              OP_VENTANA_MIN + ' minutos. Ya está publicado como posible problema; falta confirmar.',
        autoDetectado: true
      });
    }

    return {
      success: true,
      reporteId: reporteId,
      incidente: incidenteFinal ? opIncidentePublico_(incidenteFinal) : null,
      elevado: !!creado,
      sistema: sistemaNombre,
      submotivo: submotivo,
      message: creado
        ? (creado.submotivo
            ? 'Gracias. Varias personas están reportando lo mismo, así que ya avisamos al equipo y se publicó en el tablero.'
            : 'Gracias. Varias personas están reportando fallas en ' + sistemaNombre +
              ', así que ya avisamos al equipo y se publicó en el tablero.')
        : (incidente
            ? 'Gracias. Ya había un reporte abierto por esto y sumamos el tuyo.'
            : 'Gracias. Tu reporte quedó registrado.')
    };
  } catch (e) {
    Logger.log('opReportar: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos guardar tu reporte. Inténtalo de nuevo en un momento.' };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Versión reducida de un incidente para devolver al cliente que acaba de reportar. */
function opIncidentePublico_(i) {
  return {
    id: i.id, sistema: i.sistema, submotivo: i.submotivo,
    titulo: i.titulo || opTitulo_(i.sistema, i.submotivo),
    estado: i.estado, estadoNombre: i.estadoNombre, tono: i.tono, desde: i.confirmado || i.creado
  };
}

/**
 * Frenos antes de aceptar un reporte. No es seguridad: es evitar que la hoja y el chat del
 * equipo se llenen de ruido, que es lo que hace que la gente deje de leerlos.
 */
function opRevisarFrenos_(correo, sistemaClave, submotivoClave) {
  const filas = opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES);
  const ahora = Date.now();
  const mios = filas.filter(function (f) {
    return String(f.Correo || '').toLowerCase() === String(correo).toLowerCase();
  });

  const ultimaHora = mios.filter(function (f) { return ahora - opMs_(f.Fecha) < 3600 * 1000; });
  if (ultimaHora.length >= OP_MAX_REPORTES_HORA) {
    return { ok: false, message: 'Ya mandaste varios reportes en la última hora. Espera un poco antes de mandar otro.' };
  }

  const repetido = mios.filter(function (f) {
    return String(f.SistemaClave || '') === sistemaClave &&
           String(f.SubmotivoClave || '') === submotivoClave &&
           ahora - opMs_(f.Fecha) < OP_MIN_ENTRE_IGUALES * 60 * 1000;
  });
  if (repetido.length) {
    return {
      ok: false, repetido: true,
      message: 'Ya reportaste esto hace unos minutos. Tu reporte sigue en pie, no hace falta repetirlo.'
    };
  }
  return { ok: true };
}

/**
 * Incidente vivo al que corresponde este reporte, si lo hay.
 *
 * Primero por coincidencia exacta de sistema + submotivo. Si no, se acepta un incidente del
 * MISMO sistema cuyo submotivo se parezca mucho: "no carga la página" y "la página no carga"
 * son la misma caída, y tenerlas como dos incidentes reparte los reportes entre ambos y
 * hace que ninguno llegue al umbral.
 */
function opIncidenteParaReporte_(catalogo, sistemaClave, submotivo, submotivoClave) {
  const vivos = opIncidentesVivos_(catalogo).filter(function (i) { return i.sistemaClave === sistemaClave; });
  if (!vivos.length) return null;

  const exacto = vivos.filter(function (i) { return opClave_(i.submotivo) === submotivoClave; })[0];
  if (exacto) return exacto;

  let mejor = null;
  vivos.forEach(function (i) {
    if (!opMismoMotivo_(submotivo, i.submotivo)) return;
    const s = opDice_(submotivo, i.submotivo);
    if (!mejor || s > mejor.s) mejor = { i: i, s: s };
  });
  if (mejor) return mejor.i;

  // Un incidente CONFIRMADO del mismo sistema se lleva cualquier reporte de ese sistema:
  // si Connect está caído entero, da igual con qué palabras lo describa cada quien.
  const confirmado = vivos.filter(function (i) { return i.estado === 'confirmado' || i.estado === 'mantenimiento'; })[0];
  if (confirmado) return confirmado;

  // Y uno de SERVICIO —el que nace del umbral por sistema— tampoco apunta a un motivo, así
  // que recoge igual lo que llegue de ese sistema. Sin esto, los reportes que vienen después
  // se quedarían sueltos y levantarían un segundo incidente por la misma degradación.
  const deServicio = vivos.filter(function (i) { return !opClave_(i.submotivo); })[0];
  return deServicio || null;
}

/**
 * ¿Ya hay suficientes personas distintas reportando lo mismo? Si sí, se crea el incidente.
 *
 * Cuenta CORREOS ÚNICOS, no filas: es la diferencia entre "tres personas no pueden trabajar"
 * y "una persona pulsó tres veces el botón".
 */
function opEvaluarUmbral_(catalogo, sistemaNombre, sistemaClave, submotivo, submotivoClave, identidad) {
  const desde = Date.now() - OP_VENTANA_MIN * 60 * 1000;
  const personas = {};

  opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES).forEach(function (f) {
    if (String(f.SistemaClave || '') !== sistemaClave) return;
    if (String(f.IncidenteId || '')) return;         // ya pertenece a otro incidente
    if (opMs_(f.Fecha) < desde) return;
    // El mismo criterio difuso que agrupa reportes en un incidente: si no, tres formas de
    // escribir la misma queja nunca suman entre sí.
    const mismo = String(f.SubmotivoClave || '') === submotivoClave ||
                  opMismoMotivo_(String(f.Submotivo || ''), submotivo);
    if (!mismo) return;
    personas[String(f.Correo || '').toLowerCase()] = true;
  });

  const cuantas = Object.keys(personas).length;
  if (cuantas < OP_UMBRAL_PERSONAS) return null;

  const incidenteId = opId_('inc');
  const ahora = new Date();
  const titulo = opTitulo_(sistemaNombre, submotivo);

  opAgregarFila_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES, {
    ID: incidenteId, Clave: sistemaClave + '|' + submotivoClave,
    Sistema: sistemaNombre, SistemaClave: sistemaClave, Submotivo: submotivo,
    Estado: 'posible', Titulo: titulo,
    Detalle: opAvisoPosibleDetalle_(),
    Creado: ahora, CreadoPor: 'sistema', CreadoNombre: 'Detección automática',
    Actualizado: ahora, Origen: 'automatico'
  });

  opVincularReportesSueltos_(sistemaClave, submotivo, submotivoClave, incidenteId, desde);
  opAnotarDeteccion_(incidenteId, ahora,
    cuantas + ' personas distintas reportaron «' + submotivo + '» en ' + sistemaNombre +
    ' en menos de ' + OP_VENTANA_MIN + ' minutos.');

  const catalogo2 = opLeerCatalogo_();
  const creado = opIncidentesVivos_(catalogo2).filter(function (i) { return i.id === incidenteId; })[0];
  return creado || null;
}

/**
 * ¿Hay suficientes personas distintas peleándose con el MISMO SISTEMA, aunque cada una lo
 * describa a su manera? Si sí, se levanta un incidente de servicio.
 *
 * Se llama solo cuando el umbral por motivo NO saltó: si tres personas coinciden en la misma
 * queja, el incidente concreto es más útil que este.
 *
 * El incidente que sale de aquí va SIN submotivo, y eso no es un hueco que falte rellenar: es
 * la información que hay. Decir "Connect · No abre" cuando en realidad a cada quien le falla
 * de forma distinta sería inventarse una causa común que nadie ha visto.
 */
function opEvaluarUmbralServicio_(catalogo, sistemaNombre, sistemaClave) {
  if (!OP_UMBRAL_SERVICIO_ACTIVO) return null;

  const desde = Date.now() - OP_VENTANA_MIN * 60 * 1000;
  const personas = {};
  const motivos = {};

  opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES).forEach(function (f) {
    if (String(f.SistemaClave || '') !== sistemaClave) return;
    if (String(f.IncidenteId || '')) return;         // ya pertenece a otro incidente
    if (opMs_(f.Fecha) < desde) return;
    personas[String(f.Correo || '').toLowerCase()] = true;
    const m = String(f.Submotivo || '').trim();
    if (m) motivos[m] = true;
  });

  const cuantas = Object.keys(personas).length;
  if (cuantas < OP_UMBRAL_PERSONAS) return null;

  const incidenteId = opId_('inc');
  const ahora = new Date();

  opAgregarFila_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES, {
    ID: incidenteId, Clave: sistemaClave + '|',
    Sistema: sistemaNombre, SistemaClave: sistemaClave, Submotivo: '',
    Estado: 'posible', Titulo: opTitulo_(sistemaNombre, ''),
    Detalle: opAvisoPosibleDetalle_(),
    Creado: ahora, CreadoPor: 'sistema', CreadoNombre: 'Detección automática',
    Actualizado: ahora, Origen: 'automatico-servicio'
  });

  opVincularReportesSueltos_(sistemaClave, null, '', incidenteId, desde);
  opAnotarDeteccion_(incidenteId, ahora,
    cuantas + ' personas distintas reportaron fallas en ' + sistemaNombre + ' en menos de ' +
    OP_VENTANA_MIN + ' minutos, cada una con un motivo diferente (' +
    Object.keys(motivos).slice(0, 5).join('; ') + ').');

  const catalogo2 = opLeerCatalogo_();
  const creado = opIncidentesVivos_(catalogo2).filter(function (i) { return i.id === incidenteId; })[0];
  return creado || null;
}

/**
 * Las dos anotaciones que deja una detección automática.
 *
 * Van separadas porque tienen públicos distintos: la primera se publica (Aviso: 'Si') y la
 * lee cualquiera que abra el tablero sin sesión, así que dice lo que se sabe sin dar cifras;
 * la segunda es para quien va a decidir qué hacer, y ahí sí importa cuántas personas fueron y
 * con qué palabras lo contaron.
 */
function opAnotarDeteccion_(incidenteId, ahora, notaInterna) {
  opAgregarFila_(OP_SHEET_ACTUALIZACIONES, OP_COLS_ACTUALIZACIONES, {
    ID: opId_('act'), IncidenteId: incidenteId, Fecha: ahora,
    Autor: 'sistema', AutorNombre: 'Detección automática', Estado: 'posible',
    Nota: opAvisoPosibleDetalle_(), Aviso: 'Si'
  });
  opAgregarFila_(OP_SHEET_ACTUALIZACIONES, OP_COLS_ACTUALIZACIONES, {
    ID: opId_('act'), IncidenteId: incidenteId, Fecha: ahora,
    Autor: 'sistema', AutorNombre: 'Detección automática', Estado: 'posible',
    Nota: notaInterna, Aviso: 'No'
  });
}

/**
 * Cuelga del incidente recién creado los reportes que lo provocaron.
 * @param {string|null} submotivo null = todos los del sistema (incidente de servicio).
 */
function opVincularReportesSueltos_(sistemaClave, submotivo, submotivoClave, incidenteId, desde) {
  const porMotivo = submotivo !== null;
  opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES).forEach(function (f) {
    if (String(f.IncidenteId || '')) return;
    if (String(f.SistemaClave || '') !== sistemaClave) return;
    if (opMs_(f.Fecha) < desde) return;
    if (porMotivo) {
      const mismo = String(f.SubmotivoClave || '') === submotivoClave ||
                    opMismoMotivo_(String(f.Submotivo || ''), submotivo);
      if (!mismo) return;
    }
    opEscribirCeldas_(OP_SHEET_REPORTES, OP_COLS_REPORTES, f._fila, {
      IncidenteId: incidenteId, Estado: 'vinculado'
    });
  });
}

// ── EVIDENCIAS ───────────────────────────────────────────────────────────────

/** Deja pasar solo lo que ya subió el propio servidor (URLs de Drive nuestras). */
function opValidarEvidencias_(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, OP_MAX_EVIDENCIAS).map(function (e) {
    const url = String((e && e.url) || '');
    if (!/^https:\/\/drive\.google\.com\//.test(url)) return null;
    return {
      url: url,
      id: String((e && e.id) || '').replace(/[^\w-]/g, ''),
      nombre: opLimpiarTexto_((e && e.nombre) || 'captura', 80)
    };
  }).filter(Boolean);
}

/**
 * Sube una captura pegada desde el portapapeles.
 *
 * Se sube ANTES de mandar el reporte —y no junto con él— porque una captura de pantalla
 * pesa más que todo lo demás junto: si viajaran en la misma llamada, un pegado grande
 * tumbaría el reporte entero y la persona perdería lo que ya había escrito.
 */
function opSubirEvidencia(payload) {
  try {
    payload = payload || {};
    const id = secIdentidad_(payload.email);
    if (!id.ok) return { success: false, message: 'Inicia sesión para adjuntar una captura.' };

    const m = String(payload.dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return { success: false, message: 'Esa imagen no se pudo leer. Vuelve a pegarla.' };
    const mime = m[1];
    if (mime.indexOf('image/') !== 0) return { success: false, message: 'Solo se pueden adjuntar imágenes.' };

    const bytes = Utilities.base64Decode(m[2]);
    if (bytes.length > OP_MAX_BYTES_EVIDENCIA) {
      return { success: false, message: 'La captura pesa más de 5 MB. Recórtala e inténtalo de nuevo.' };
    }

    const nombre = 'evidencia-' + opClave_(id.nombre || id.email) + '-' + Date.now();
    const blob = Utilities.newBlob(bytes, mime, nombre);
    const file = opCarpetaEvidencias_().createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

    return {
      success: true,
      url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600',
      id: file.getId(),
      nombre: opLimpiarTexto_(payload.nombre || 'captura', 80)
    };
  } catch (e) {
    Logger.log('opSubirEvidencia: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos guardar la captura. Inténtalo de nuevo.' };
  }
}

function opCarpetaEvidencias_() {
  const idFijo = String(secConfig_('OPERACION_EVIDENCIAS_FOLDER_ID', '') || '').trim();
  if (idFijo) {
    try { return DriveApp.getFolderById(idFijo); } catch (e) {
      Logger.log('Carpeta de evidencias por identificador no disponible: ' + e);
    }
  }
  const it = DriveApp.getFoldersByName(OP_CARPETA_EVIDENCIAS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(OP_CARPETA_EVIDENCIAS);
}

// =================================================================================================
// DETALLE DE UN INCIDENTE (exige sesión)
// =================================================================================================

/**
 * Todo lo que hay detrás de un incidente: quién lo reportó, con qué palabras, con qué
 * capturas y qué ha ido diciendo supervisión.
 *
 * Exige sesión, y no por burocracia: aquí sí viajan nombres, correos y capturas de pantalla
 * de trabajo real, que es exactamente lo que la vista pública no puede enseñar.
 */
function opIncidenteDetalle(incidenteId, email) {
  try {
    const id = secIdentidad_(email);
    if (!id.ok) return { success: false, message: 'Inicia sesión para ver los reportes y las evidencias.' };

    const idInc = String(incidenteId || '').trim();
    if (!idInc) return { success: false, message: 'No pudimos identificar ese reporte.' };

    const catalogo = opLeerCatalogo_();
    const filas = opLeerHoja_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES);
    const fila = filas.filter(function (f) { return String(f.ID) === idInc; })[0];
    if (!fila) return { success: false, message: 'Ese reporte ya no está disponible.' };

    const inc = opIncidenteDeFila_(fila, catalogo);
    const reportes = opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES)
      .filter(function (f) { return String(f.IncidenteId || '') === idInc; })
      .map(function (f) {
        let evidencias = [];
        try { evidencias = JSON.parse(f.Evidencias || '[]'); } catch (e) { evidencias = []; }
        return {
          id: String(f.ID || ''), fecha: opISO_(f.Fecha),
          nombre: String(f.Nombre || ''), correo: String(f.Correo || ''),
          submotivo: String(f.Submotivo || ''), notas: String(f.Notas || ''),
          evidencias: Array.isArray(evidencias) ? evidencias : [],
          mio: String(f.Correo || '').toLowerCase() === id.email
        };
      })
      .sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || ''); });

    const actualizaciones = opLeerHoja_(OP_SHEET_ACTUALIZACIONES, OP_COLS_ACTUALIZACIONES)
      .filter(function (f) { return String(f.IncidenteId || '') === idInc; })
      .map(function (f) {
        return {
          id: String(f.ID || ''), fecha: opISO_(f.Fecha),
          autor: String(f.Autor || ''), autorNombre: String(f.AutorNombre || ''),
          estado: String(f.Estado || ''),
          estadoNombre: opEstado_(catalogo, f.Estado).nombre,
          tono: opEstado_(catalogo, f.Estado).tono,
          nota: String(f.Nota || ''), aviso: opEsSi_(f.Aviso)
        };
      })
      .sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || ''); });

    return {
      success: true,
      puedeGestionar: (id.bloques || []).indexOf(OP_BLOQUE) !== -1,
      incidente: {
        id: inc.id, sistema: inc.sistema, sistemaClave: inc.sistemaClave, submotivo: inc.submotivo,
        titulo: inc.titulo || opTitulo_(inc.sistema, inc.submotivo), detalle: inc.detalle,
        estado: inc.estado, estadoNombre: inc.estadoNombre, tono: inc.tono,
        afecta: inc.afecta, cerrado: inc.cerrado, creado: inc.creado,
        confirmado: inc.confirmado, confirmadoNombre: inc.confirmadoNombre,
        actualizado: inc.actualizado, origen: inc.origen,
        personas: opContarPersonas_(reportes)
      },
      reportes: reportes,
      actualizaciones: actualizaciones,
      estados: catalogo.estados
    };
  } catch (e) {
    Logger.log('opIncidenteDetalle: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos abrir ese reporte. Inténtalo de nuevo en un momento.' };
  }
}

function opContarPersonas_(reportes) {
  const vistos = {};
  (reportes || []).forEach(function (r) { vistos[String(r.correo || '').toLowerCase()] = true; });
  return Object.keys(vistos).filter(Boolean).length;
}

// =================================================================================================
// PANEL DE SUPERVISIÓN (bloque 'operacion')
// =================================================================================================

/** Puerta única del panel. Todo lo que escribe pasa por aquí. */
function opGate_(email) {
  return secIdentidadConBloque_(email, OP_BLOQUE);
}

/**
 * Cuánto se cachea el cuerpo del panel.
 *
 * Treinta segundos, los mismos que `OP_TTL_SESION`: el panel es el gemelo de supervisión de
 * lo que ya se cachea para el indicador, y dos ventanas distintas para el mismo dato harían
 * que la pantalla y la isla se contradijeran durante medio minuto.
 *
 * Y por debajo de los 45 s con los que el cliente pide `opPanel` (operacion.html, `AppRun.swr`
 * con ttl/maxAge 45000), a propósito: si el servidor guardara MÁS que el cliente, cada vez
 * que la copia del navegador caduca se le serviría una del servidor todavía más vieja y las
 * dos esperas se sumarían. Con 30 s el servidor siempre ha releído más tarde que el cliente,
 * así que la caché de aquí nunca es la que añade retraso. Además toda escritura invalida
 * (opInvalidarCache_), de modo que confirmar o descartar una incidencia se ve al instante.
 */
const OP_TTL_PANEL = 30;

/**
 * Todo lo que necesita el panel: incidentes vivos, los ya cerrados de los últimos días y los
 * reportes que aún no pertenecen a ningún incidente (los que no llegaron al umbral).
 *
 * F5 (T5.2b) · EL CUERPO VA CACHEADO Y `yo` NO.
 *
 * Antes esto releía TRES hojas enteras —incidentes, reportes y catálogo— en cada carga de
 * cada supervisor. Con varias personas mirando el panel a la vez durante una caída (que es
 * justo cuando lo miran), la pantalla tardaba lo que tardan esas lecturas multiplicadas por
 * cuantos estuvieran dentro; esa es parte de la lentitud que obligó a poner esperas.
 *
 * La clave de caché NO lleva el correo. Se miró campo por campo qué depende de quién
 * pregunta y solo `yo` lo hace: incidencias, sueltos, catálogo, umbral y webhooks son
 * idénticos para cualquiera que pase la puerta, porque `opGate_` exige el MISMO bloque a
 * todos. Meter el correo en la clave daría una copia por persona: la primera carga de cada
 * supervisor volvería a costar las tres lecturas —justo lo que se viene a evitar— y en una
 * caída con seis personas dentro habría seis entradas repitiendo el mismo contenido.
 *
 * Así que se cachea SOLO la parte común y `yo` se añade después sobre una copia, exactamente
 * como `opEstadoSesion` hace con `puedeGestionar`, `mios` y `yo`. La copia importa: sin ella
 * se estaría escribiendo el correo de quien preguntó primero dentro del objeto que devuelve
 * la caché en el mismo proceso.
 *
 * Quien no pasa `opGate_` no llega nunca a `opCacheado_`, así que compartir la entrada no
 * abre ninguna puerta: el permiso decide SI recibes el panel, no QUÉ panel recibes.
 */
function opPanel(email) {
  try {
    const gate = opGate_(email);
    if (!gate.ok) return { success: false, message: gate.error };

    const base = opCacheado_('panel', OP_TTL_PANEL, function () { return opCalcularPanel_(); });
    if (!base || base.success === false) return base;

    const salida = JSON.parse(JSON.stringify(base));
    salida.yo = { email: gate.email, nombre: gate.nombre };
    return salida;
  } catch (e) {
    Logger.log('opPanel: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos cargar el panel. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * El cuerpo del panel, sin nada que dependa de quién pregunta.
 *
 * Va sin try/catch propio: lo que falle aquí tiene que subir hasta `opPanel` para que
 * `opCacheado_` NO guarde una respuesta a medias. Guardar un panel roto durante 30 s
 * convierte un fallo de un segundo en medio minuto de pantalla vacía para todo el equipo.
 *
 * OJO CON LA ESCRITURA: `opCaducarPosibles_` apaga aquí mismo las sospechas abandonadas y,
 * cuando apaga alguna, invalida la caché. Es exactamente el caso del que avisa el comentario
 * de `opCacheado_`: la clave se recalcula DESPUÉS del productor, así que este panel —que ya
 * refleja las incidencias recién apagadas— se guarda bajo la generación nueva y no nace
 * muerto. Si algún día se moviera la caducidad fuera de aquí, hay que releer aquel comentario
 * antes de tocar nada.
 */
function opCalcularPanel_() {
  const catalogo = opLeerCatalogo_();
  opCaducarPosibles_(catalogo);

  const todos = opLeerHoja_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES)
    .map(function (f) { return opIncidenteDeFila_(f, catalogo); })
    .filter(function (i) { return i.id; });

  const reportes = opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES);
  const conteo = {};
  const personas = {};
  reportes.forEach(function (f) {
    const inc = String(f.IncidenteId || '');
    if (!inc) return;
    conteo[inc] = (conteo[inc] || 0) + 1;
    if (!personas[inc]) personas[inc] = {};
    personas[inc][String(f.Correo || '').toLowerCase()] = true;
  });

  const desdeCerrados = Date.now() - 7 * 24 * 3600 * 1000;
  const salida = todos.filter(function (i) {
    return !i.cierra || opMs_(i.cerrado || i.actualizado) > desdeCerrados;
  }).map(function (i) {
    return {
      id: i.id, sistema: i.sistema, sistemaClave: i.sistemaClave, submotivo: i.submotivo,
      titulo: i.titulo || opTitulo_(i.sistema, i.submotivo), detalle: i.detalle,
      estado: i.estado, estadoNombre: i.estadoNombre, tono: i.tono,
      afecta: i.afecta, cierra: i.cierra, origen: i.origen,
      creado: i.creado, confirmado: i.confirmado, confirmadoNombre: i.confirmadoNombre,
      actualizado: i.actualizado, cerrado: i.cerrado,
      reportes: conteo[i.id] || 0,
      personas: Object.keys(personas[i.id] || {}).filter(Boolean).length
    };
  }).sort(function (a, b) {
    // Lo que espera una decisión primero; dentro de eso, lo más reciente.
    if (a.cierra !== b.cierra) return a.cierra ? 1 : -1;
    if ((a.estado === 'posible') !== (b.estado === 'posible')) return a.estado === 'posible' ? -1 : 1;
    return (b.actualizado || b.creado || '').localeCompare(a.actualizado || a.creado || '');
  });

  const desdeSueltos = Date.now() - 24 * 3600 * 1000;
  const sueltos = reportes.filter(function (f) {
    return !String(f.IncidenteId || '') && opMs_(f.Fecha) > desdeSueltos &&
           String(f.Estado || '') !== 'descartado';
  }).map(function (f) {
    let evidencias = [];
    try { evidencias = JSON.parse(f.Evidencias || '[]'); } catch (e) { evidencias = []; }
    return {
      id: String(f.ID || ''), fecha: opISO_(f.Fecha),
      nombre: String(f.Nombre || ''), correo: String(f.Correo || ''),
      sistema: String(f.Sistema || ''), sistemaClave: String(f.SistemaClave || ''),
      submotivo: String(f.Submotivo || ''), notas: String(f.Notas || ''),
      evidencias: Array.isArray(evidencias) ? evidencias : []
    };
  }).sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || ''); });

  return {
    success: true,
    incidentes: salida,
    sueltos: sueltos,
    catalogo: {
      sistemas: catalogo.sistemas.map(function (s) { return { clave: s.clave, nombre: s.nombre }; }),
      estados: catalogo.estados
    },
    umbral: { personas: OP_UMBRAL_PERSONAS, minutos: OP_VENTANA_MIN },
    webhookEstado: !!secConfig_('OPERACION_WEBHOOK_ESTADO', OPERACION_WEBHOOK_ESTADO),
    webhookReportes: !!secConfig_('OPERACION_WEBHOOK_REPORTES', OPERACION_WEBHOOK_REPORTES)
  };
}

// =================================================================================================
// RECOMENDACIONES (FASE 5 · T5.2)
// =================================================================================================

/**
 * LO QUE YA SE SABE, DICHO EN VOZ ALTA
 * -------------------------------------
 * El panel enseña incidencias y reportes sueltos; el gráfico enseña barras. Entre las dos
 * cosas hay una lectura que hoy solo hace quien tiene tiempo de mirar mucho rato: "esto pasa
 * todas las mañanas", "este fallo ya volvió tres veces", "estos tres sueltos son la incidencia
 * que tienes abierta arriba". Eso es lo que se calcula aquí, con los datos que YA hay en las
 * hojas de este módulo. Nada sale del proyecto.
 *
 * DOS REGLAS QUE NO SE NEGOCIAN
 *
 *   1. TODA RECOMENDACIÓN CITA SU CIFRA. Sin número no se publica. "Connect va mal" no le
 *      sirve a nadie; "31 reportes de Connect en los últimos 7 días, de 12 personas" se puede
 *      comprobar, discutir y llevar a una reunión.
 *
 *   2. LAS CIFRAS SON LAS MISMAS QUE LAS DEL GRÁFICO. Se cuentan todos los reportes del
 *      periodo, incluidos los que supervisión acabó descartando, exactamente como hace
 *      `opCalcularHistorial_`. Es tentador excluirlos —"no eran fallas de verdad"— pero
 *      entonces la frase diría 14 donde la barra de al lado, en la misma pantalla, dice 16, y
 *      la primera vez que alguien note ese descuadre dejará de creerse las dos cosas. La única
 *      excepción es la recomendación de sueltos, que mira la MISMA lista que pinta el panel
 *      (donde un descartado ya no está) porque su acción es sobre esa lista.
 *
 * POR QUÉ NO SE LLAMA A `opCalcularHistorial_` NI A `opCalcularHistorialHoras_`
 *
 * Se leyeron las dos y se reutiliza de ellas lo que de verdad importa reutilizar: sus claves
 * de tramo (`opHoraClave_`, de donde salen aquí el día y la hora, para que un reporte caiga en
 * el mismo cajón que en el gráfico) y su criterio de gravedad (PERSONAS distintas contra
 * `OP_UMBRAL_PERSONAS`, no filas). Llamarlas, en cambio, volvería a leer la hoja de reportes
 * dos veces más y aun así no serviría: ninguna de las dos series lleva el TEXTO del submotivo,
 * que es lo que necesitan dos de las cuatro recomendaciones, y la de horas está topada en 72 h
 * —tres muestras por franja— cuando "esto pasa todas las mañanas" no se puede afirmar con tres
 * días. Así que aquí se hace UNA sola pasada por reportes y UNA por incidencias, y de esa
 * pasada salen las cuatro. El criterio de aceptación de la fase es justamente ese: que la
 * sección no repita lecturas de hoja.
 *
 * Y NO SE CADUCAN LAS SOSPECHAS AQUÍ. `opCaducarPosibles_` escribe, y escribir invalida la
 * caché. Si esta función lo llamara, cada carga de la pantalla tendría dos productores
 * invalidándose el uno al otro —el panel guarda, las recomendaciones invalidan, el panel
 * vuelve a leer— y la caché no serviría de nada precisamente en la pantalla que se vino a
 * acelerar. Lo caduca `opCalcularPanel_`, que se pide desde la misma pantalla. Lo único que
 * hay que compensar es no recomendar agrupar nada en una sospecha que está a punto de
 * apagarse sola; eso se filtra abajo con la misma condición que usa `opCaducarPosibles_`.
 */

/** Ventana de análisis. Una semana: coge los cinco días laborables enteros más el fin de
 *  semana, que es lo que hace falta para poder decir "todos los lunes" o "todas las mañanas"
 *  sin que una guardia rara de sábado se coma la muestra. Se dice en castellano en `periodo`
 *  para que la pantalla lo cite tal cual y la cifra nunca viaje sin su plazo. */
const OP_RECO_DIAS = 7;
const OP_RECO_PERIODO = 'los últimos 7 días';

/**
 * Cuánto se cachea. Cinco minutos, diez veces más que el panel, y a propósito: el numerador
 * de todo lo de aquí es una semana de reportes, así que un reporte nuevo mueve las cuentas
 * menos de un uno por ciento y una recomendación de hace cinco minutos dice exactamente lo
 * mismo que una recién hecha. Ponerle el TTL del panel obligaría a releer las hojas cada vez
 * que el panel se refresca, que es lo contrario de lo que pide esta fase. Y como toda
 * escritura invalida, confirmar o descartar algo sí recalcula al momento.
 */
const OP_TTL_RECOMENDACIONES = 300;

/** Tope de la lista. Seis: una sección que no cabe de un vistazo se deja de leer entera, y
 *  entonces da igual lo buena que sea la séptima. */
const OP_RECO_MAX = 6;

/**
 * UMBRALES · por qué estos números y no otros
 * --------------------------------------------
 * Una "recomendación" sacada de dos reportes es ruido, y el ruido enseña a ignorar la sección
 * entera: a la tercera vez que alguien la abre y encuentra una obviedad, deja de abrirla y ya
 * no vuelve ni el día que hay algo bueno. Por eso cada una tiene su mínimo escrito, y si no se
 * alcanza, esa recomendación NO SALE. Una lista vacía es una respuesta perfectamente buena.
 *
 * El mínimo de PERSONAS es el de la casa (`OP_UMBRAL_PERSONAS`, tres) en las cuatro. Es la
 * misma frontera que decide si se levanta un incidente automático: por debajo de tres personas
 * distintas lo que hay es alguien con un problema, no un sistema que falla. Si aquí se usara
 * otro número, la sección estaría recomendando sobre patrones que la alerta automática no
 * considera dignos de una bandera, y las dos cosas se contradirían en la misma pantalla.
 */

/** FRANJA HORARIA · ancho de la franja y mínimos. */
const OP_RECO_FRANJA_HORAS = 2;
/** Seis reportes: tres días con dos reportes cada uno. Con menos, una sola mañana mala se
 *  disfraza de costumbre. */
const OP_RECO_MIN_REPORTES_FRANJA = 6;
/** Tres DÍAS DISTINTOS. Es el umbral que de verdad sostiene esta recomendación: dos días son
 *  una casualidad y uno es una caída, no una franja. Sin esto, una caída de 14 reportes un
 *  martes por la mañana dejaría "Connect falla de 9 a 11" en pantalla toda la semana. */
const OP_RECO_MIN_DIAS = 3;
/** Y la franja tiene que CONCENTRAR. Dos horas dentro de una jornada de unas ocho ya se llevan
 *  un 25 % por puro reparto; por debajo de un tercio no hay franja, hay horario de trabajo. */
const OP_RECO_CONCENTRACION_FRANJA = 0.35;

/** SISTEMA PROBLEMÁTICO · más de un reporte al día de media en la semana. Por debajo de eso,
 *  "el que más se reporta" es simplemente el que tuvo un mal día. */
const OP_RECO_MIN_REPORTES_SISTEMA = 8;
/** Y tiene que DESTACAR: la mitad más que el segundo. Con 9 contra 8 el "más problemático"
 *  cambia de nombre cada vez que entra un reporte, y una recomendación que cambia sola cada
 *  media hora no es una conclusión, es un marcador. */
const OP_RECO_VENTAJA_SISTEMA = 1.5;

/** SUBMOTIVO REINCIDENTE · cinco reportes del mismo problema en la semana. */
const OP_RECO_MIN_REPORTES_MOTIVO = 5;
/** Y sobre todo: DOS EPISODIOS. "Reincidente" significa que VOLVIÓ, no que duró. Tres días
 *  seguidos son un problema largo —eso ya lo cuenta la incidencia abierta o el sistema
 *  problemático—; lunes, jueves y viernes son un problema que vuelve, que es otra cosa y pide
 *  otra decisión. Sin este mínimo, esta recomendación repetiría la de arriba con otras
 *  palabras y la sección diría dos veces lo mismo. */
const OP_RECO_MIN_EPISODIOS = 2;

/** SUELTOS AGRUPABLES · dos reportes sueltos, de dos personas distintas, parecidos a la misma
 *  incidencia abierta. Uno solo no basta: puede ser el mismo dedo que ya reportó dentro de la
 *  incidencia, y una recomendación por cada suelto convertiría la sección en una segunda
 *  bandeja de sueltos justo encima de la que ya está ahí abajo. */
const OP_RECO_MIN_SUELTOS = 2;
const OP_RECO_MIN_PERSONAS_SUELTOS = 2;

/** Cuántas recomendaciones como mucho por clave, antes del tope global. Más de dos franjas o
 *  dos motivos seguidos se leen como una lista de datos, no como un consejo. */
const OP_RECO_TOPE_FRANJA = 2;
const OP_RECO_TOPE_MOTIVO = 2;
const OP_RECO_TOPE_SUELTOS = 3;

/** "3 reportes" / "1 reporte", sin el "(s)" que delata que lo escribió una máquina. */
function opRecoPlural_(n, singular, plural) {
  return n + ' ' + (n === 1 ? singular : plural);
}

/**
 * Cuántas VECES volvió: rachas de días consecutivos dentro del conjunto de días con reportes.
 *
 * Lunes-martes-jueves son dos episodios, no tres días: entre el martes y el jueves hubo una
 * jornada de calma y el problema regresó. Es la diferencia entre "sigue roto" y "vuelve", y de
 * ella depende que esta recomendación no sea un duplicado de la del sistema problemático.
 */
function opRecoEpisodios_(dias) {
  const lista = Object.keys(dias || {}).sort();
  let episodios = 0;
  let previo = null;
  lista.forEach(function (d) {
    const ms = Date.parse(d + 'T00:00:00Z');
    if (isNaN(ms)) return;
    // Día y medio de holgura: separa "el día siguiente" de "dos días después" sin que un
    // cambio de horario de verano parta una racha en dos.
    if (previo === null || (ms - previo) > 86400000 * 1.5) episodios++;
    previo = ms;
  });
  return episodios;
}

/** Contadores vacíos de un tramo (una hora del día, o un sistema entero). */
function opRecoTramoVacio_() {
  return { reportes: 0, personas: {}, dias: {} };
}

function opRecoSumar_(tramo, correo, dia) {
  tramo.reportes++;
  if (correo) tramo.personas[correo] = true;
  if (dia) tramo.dias[dia] = true;
}

function opRecoCuantos_(obj) {
  return Object.keys(obj || {}).length;
}

/**
 * Recomendaciones para el panel de supervisión.
 *
 * Contrato (fijo, hay pantalla escrita contra él):
 *   { success:true, generado:ISO, periodo:'los últimos 7 días', recomendaciones:[
 *       { clave, titulo, evidencia, detalle, urgencia, accion } ] }
 *
 * Sin nada que recomendar devuelve `recomendaciones: []` y `success:true`: no tener consejos
 * no es un error, y tratarlo como tal haría que la pantalla pintara una alarma roja los días
 * buenos.
 *
 * La clave de caché no lleva el correo, igual que en `opPanel`: el permiso decide SI recibes
 * las recomendaciones, no CUÁLES. Aquí no hay ni un solo campo que dependa de quién pregunta.
 */
function opRecomendaciones(email) {
  try {
    const gate = opGate_(email);
    if (!gate.ok) return { success: false, message: gate.error };

    return opCacheado_('reco', OP_TTL_RECOMENDACIONES, function () {
      return opCalcularRecomendaciones_();
    });
  } catch (e) {
    Logger.log('opRecomendaciones: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos calcular las recomendaciones en este momento.' };
  }
}

function opCalcularRecomendaciones_() {
  const catalogo = opLeerCatalogo_();
  const ahora = Date.now();
  const desdeMs = ahora - OP_RECO_DIAS * 86400000;
  // La MISMA ventana que usa `opCalcularPanel_` para su lista de sueltos. Tiene que ser la
  // misma: si aquí se mirara más atrás, se recomendaría agrupar un reporte que no está en la
  // pantalla, y quien lea la recomendación no encontrará el botón por ningún lado.
  const desdeSueltosMs = ahora - 24 * 3600 * 1000;

  const nombreSistema = {};
  const usosCatalogo = {};
  catalogo.sistemas.forEach(function (s) {
    nombreSistema[s.clave] = s.nombre;
    usosCatalogo[s.clave] = {};
    (catalogo.submotivos[s.clave] || []).forEach(function (m) {
      usosCatalogo[s.clave][m.clave] = { valor: m.valor, usos: Number(m.usos) || 0 };
    });
  });

  // ── PASADA ÚNICA POR LA HOJA DE REPORTES ───────────────────────────────────
  const sistemas = {};   // clave → { nombre, total, personas, dias, horas[24] }
  const motivos = {};    // clave de sistema → [ grupos de quejas que son la misma ]
  const sueltos = [];

  opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES).forEach(function (f) {
    const ms = opMs_(f.Fecha);
    if (!ms || ms < desdeMs) return;

    const sisClave = String(f.SistemaClave || '');
    if (!sisClave) return;
    const correo = String(f.Correo || '').toLowerCase();

    // Día y hora salen de la MISMA clave que usa el gráfico por horas, y en la misma zona
    // horaria del script. Calcularlos por separado con `new Date().getHours()` metería la
    // zona del servidor y un reporte de las 8:30 caería en la franja de las 14 h.
    const hk = opHoraClave_(f.Fecha);
    const dia = hk.slice(0, 10);
    const hora = parseInt(hk.slice(11, 13), 10);
    if (!dia || isNaN(hora)) return;

    if (!sistemas[sisClave]) {
      const base = opRecoTramoVacio_();
      base.nombre = nombreSistema[sisClave] || String(f.Sistema || '') || sisClave;
      base.horas = [];
      for (let h = 0; h < 24; h++) base.horas.push(opRecoTramoVacio_());
      sistemas[sisClave] = base;
    }
    const S = sistemas[sisClave];
    opRecoSumar_(S, correo, dia);
    opRecoSumar_(S.horas[hora], correo, dia);

    // ── El mismo problema escrito de dos maneras ──
    const texto = String(f.Submotivo || '').trim();
    if (texto) {
      if (!motivos[sisClave]) motivos[sisClave] = [];
      opRecoSumar_(opRecoAgrupar_(motivos[sisClave], texto), correo, dia);
    }

    if (!String(f.IncidenteId || '') && ms > desdeSueltosMs &&
        String(f.Estado || '') !== 'descartado') {
      sueltos.push({
        id: String(f.ID || ''), ms: ms, correo: correo,
        sistemaClave: sisClave, sistema: S.nombre,
        submotivo: texto
      });
    }
  });

  // ── PASADA ÚNICA POR LA HOJA DE INCIDENCIAS ────────────────────────────────
  const incidentes = opLeerHoja_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES)
    .map(function (f) { return opIncidenteDeFila_(f, catalogo); })
    .filter(function (i) { return i.id; });

  const confirmadasPorSistema = {};
  incidentes.forEach(function (i) {
    // Por la fecha de CONFIRMACIÓN, igual que el historial: es el momento en que se supo que
    // era real, y así la cifra que se cita coincide con la del gráfico.
    if (!i.confirmado || opMs_(i.confirmado) < desdeMs) return;
    confirmadasPorSistema[i.sistemaClave] = (confirmadasPorSistema[i.sistemaClave] || 0) + 1;
  });

  // Incidencias a las que tiene sentido mandar reportes: las vivas, MENOS las sospechas que
  // están a punto de apagarse solas. La condición es copia de `opCaducarPosibles_` porque
  // aquí no se caduca nada (ver la cabecera de esta sección): sin este filtro, la pantalla
  // propondría agrupar tres reportes en una incidencia que el propio panel va a cerrar en la
  // misma carga, y el supervisor pulsaría un botón que ya no lleva a ninguna parte.
  const limiteCaduca = ahora - OP_HORAS_CADUCA_POSIBLE * 3600 * 1000;
  const vivas = incidentes.filter(function (i) {
    if (i.cierra) return false;
    if (i.estado === 'posible' && !i.confirmado) {
      const ultima = Math.max(opMs_(i.actualizado), opMs_(i.creado));
      if (ultima && ultima < limiteCaduca) return false;
    }
    return true;
  });
  const vivasPorSistema = {};
  vivas.forEach(function (i) {
    if (!vivasPorSistema[i.sistemaClave]) vivasPorSistema[i.sistemaClave] = [];
    vivasPorSistema[i.sistemaClave].push(i);
  });

  const recomendaciones = []
    .concat(opRecoFranjas_(sistemas, vivasPorSistema))
    .concat(opRecoSistema_(sistemas, confirmadasPorSistema, vivasPorSistema))
    .concat(opRecoMotivos_(motivos, sistemas, usosCatalogo, vivasPorSistema))
    .concat(opRecoSueltos_(sueltos, vivas));

  // ORDEN: primero lo que se puede pulsar, luego lo urgente, luego lo grande. Quien abre esta
  // sección tiene tres minutos entre dos llamadas; lo que exige una decisión ahora va arriba y
  // lo que es para pensar el viernes va abajo.
  const rango = { alta: 3, media: 2, baja: 1 };
  recomendaciones.sort(function (a, b) {
    const accA = a.accion ? 1 : 0;
    const accB = b.accion ? 1 : 0;
    if (accA !== accB) return accB - accA;
    const uA = rango[a.urgencia] || 0;
    const uB = rango[b.urgencia] || 0;
    if (uA !== uB) return uB - uA;
    return (b._peso || 0) - (a._peso || 0);
  });

  const lista = recomendaciones.slice(0, OP_RECO_MAX).map(function (r) {
    // `_peso` solo ordena; no tiene por qué viajar ni significa nada fuera de aquí.
    return {
      clave: r.clave, titulo: r.titulo, evidencia: r.evidencia,
      detalle: r.detalle || '', urgencia: r.urgencia, accion: r.accion || null
    };
  });

  return {
    success: true,
    generado: new Date().toISOString(),
    periodo: OP_RECO_PERIODO,
    recomendaciones: lista
  };
}

/**
 * Mete una queja en el grupo al que pertenece, creándolo si es la primera.
 *
 * Tres criterios, en este orden y por este motivo:
 *   1. La clave exacta: lo que viene del catálogo cae junto sin gastar nada.
 *   2. `opSugerirExistente_`, el mismo juez que usa el FORMULARIO para no duplicar opciones.
 *      Si aquí se agrupara distinto que allí, la pantalla contaría como un problema lo que la
 *      lista de submotivos enseña como dos, o al revés.
 *   3. `opMismoMotivo_`, el criterio canónico del módulo —algo más laxo— que es el que decide
 *      qué reportes cuentan para el umbral y a qué incidencia pertenece cada uno. Agrupar más
 *      estricto que él haría que esta sección dijera "no hay patrón" de un conjunto de
 *      reportes que la alerta automática ya considera el mismo problema.
 */
function opRecoAgrupar_(lista, texto) {
  const clave = opClave_(texto);

  let grupo = lista.filter(function (g) { return g.clave === clave; })[0];

  if (!grupo) {
    const sugerido = opSugerirExistente_(texto, lista.map(function (g) { return g.texto; }));
    if (sugerido) {
      grupo = lista.filter(function (g) { return g.texto === sugerido.valor; })[0];
    }
  }
  if (!grupo) {
    grupo = lista.filter(function (g) { return opMismoMotivo_(texto, g.texto); })[0];
  }
  if (!grupo) {
    grupo = opRecoTramoVacio_();
    grupo.texto = texto;
    grupo.clave = clave;
    lista.push(grupo);
  }
  return grupo;
}

/** ¿Hay algo abierto de este sistema que esté molestando ahora mismo? Sube la urgencia. */
function opRecoIncidenciaViva_(vivasPorSistema, sisClave) {
  const lista = (vivasPorSistema[sisClave] || []).filter(function (i) { return i.afecta; });
  if (!lista.length) return null;
  // La más grave manda: una confirmada dice más que una sospecha.
  const orden = { alert: 3, warn: 2, info: 1, ok: 0, neutro: 0 };
  lista.sort(function (a, b) { return (orden[b.tono] || 0) - (orden[a.tono] || 0); });
  return lista[0];
}

/** Acción "abrir esa incidencia". `item` va vacío: aquí no se señala ningún reporte suelto. */
function opRecoAccionVer_(inc) {
  if (!inc) return null;
  return {
    texto: 'Ver «' + (inc.titulo || opTitulo_(inc.sistema, inc.submotivo)) + '»',
    tipo: 'ver', item: '', inc: inc.id
  };
}

/**
 * 1 · FRANJA HORARIA · "esto pasa siempre a la misma hora".
 *
 * Se recorren franjas de dos horas por sistema y se conserva la mejor de cada uno. Dos horas
 * porque es el ancho en el que se puede hacer algo con la respuesta: reforzar una hora no da
 * tiempo a organizarlo y media jornada ya no es una franja.
 */
function opRecoFranjas_(sistemas, vivasPorSistema) {
  const salida = [];

  Object.keys(sistemas).forEach(function (sisClave) {
    const S = sistemas[sisClave];
    if (S.reportes < OP_RECO_MIN_REPORTES_FRANJA) return;

    let mejor = null;
    for (let h = 0; h + OP_RECO_FRANJA_HORAS <= 24; h++) {
      let reportes = 0;
      const personas = {};
      const dias = {};
      for (let k = 0; k < OP_RECO_FRANJA_HORAS; k++) {
        const tramo = S.horas[h + k];
        reportes += tramo.reportes;
        Object.keys(tramo.personas).forEach(function (c) { personas[c] = true; });
        Object.keys(tramo.dias).forEach(function (d) { dias[d] = true; });
      }
      if (!mejor || reportes > mejor.reportes) {
        mejor = { desde: h, hasta: h + OP_RECO_FRANJA_HORAS, reportes: reportes,
                  personas: personas, dias: dias };
      }
    }
    if (!mejor) return;

    const nPersonas = opRecoCuantos_(mejor.personas);
    const nDias = opRecoCuantos_(mejor.dias);
    const parte = mejor.reportes / S.reportes;

    if (mejor.reportes < OP_RECO_MIN_REPORTES_FRANJA) return;
    if (nDias < OP_RECO_MIN_DIAS) return;
    if (nPersonas < OP_UMBRAL_PERSONAS) return;
    if (parte < OP_RECO_CONCENTRACION_FRANJA) return;

    const viva = opRecoIncidenciaViva_(vivasPorSistema, sisClave);
    salida.push({
      clave: 'franja-horaria',
      titulo: S.nombre + ' falla sobre todo de ' + mejor.desde + ' a ' + mejor.hasta + ' h',
      evidencia: opRecoPlural_(mejor.reportes, 'reporte', 'reportes') + ' de ' + S.nombre +
                 ' entre las ' + mejor.desde + ' y las ' + mejor.hasta + ' h en ' +
                 OP_RECO_PERIODO,
      detalle: 'Se repitió en ' + opRecoPlural_(nDias, 'día distinto', 'días distintos') +
               ', lo reportaron ' + opRecoPlural_(nPersonas, 'persona', 'personas') +
               ' y es el ' + Math.round(parte * 100) + ' % de todo lo que se reporta de ' +
               S.nombre + '.',
      // Alta solo si además hay algo abierto de ese sistema: un patrón horario es material
      // para organizar el turno, no para levantarse de la silla, salvo que ya esté doliendo.
      urgencia: viva ? 'alta' : 'media',
      accion: opRecoAccionVer_(viva),
      _peso: mejor.reportes
    });
  });

  salida.sort(function (a, b) { return b._peso - a._peso; });
  return salida.slice(0, OP_RECO_TOPE_FRANJA);
}

/**
 * 2 · SISTEMA PROBLEMÁTICO · "de todo lo que llega, la mayoría es de este".
 *
 * Sale UNA sola, la del líder, y solo si le saca de verdad al segundo. Un podio completo no
 * es un consejo: es la misma tabla que ya se puede leer en el gráfico.
 */
function opRecoSistema_(sistemas, confirmadasPorSistema, vivasPorSistema) {
  const orden = Object.keys(sistemas).map(function (clave) {
    const S = sistemas[clave];
    return { clave: clave, nombre: S.nombre, reportes: S.reportes,
             personas: opRecoCuantos_(S.personas), dias: opRecoCuantos_(S.dias) };
  }).sort(function (a, b) { return b.reportes - a.reportes; });

  if (!orden.length) return [];
  const lider = orden[0];
  const segundo = orden[1] || { reportes: 0, nombre: '' };

  if (lider.reportes < OP_RECO_MIN_REPORTES_SISTEMA) return [];
  if (lider.personas < OP_UMBRAL_PERSONAS) return [];
  if (lider.dias < OP_RECO_MIN_DIAS) return [];
  if (segundo.reportes > 0 && lider.reportes < segundo.reportes * OP_RECO_VENTAJA_SISTEMA) return [];

  const confirmadas = confirmadasPorSistema[lider.clave] || 0;
  const viva = opRecoIncidenciaViva_(vivasPorSistema, lider.clave);

  const comparacion = segundo.reportes > 0
    ? ', frente a ' + opRecoPlural_(segundo.reportes, 'reporte', 'reportes') + ' de ' + segundo.nombre
    : ', y es el único sistema con reportes';

  const detalle = 'Lo reportaron ' + opRecoPlural_(lider.personas, 'persona', 'personas') +
                  ' en ' + opRecoPlural_(lider.dias, 'día distinto', 'días distintos') +
                  (confirmadas
                    ? '; ' + opRecoPlural_(confirmadas, 'incidencia se confirmó',
                                           'incidencias se confirmaron') + ' en ese plazo.'
                    : '; ninguna incidencia se confirmó en ese plazo.');

  return [{
    clave: 'sistema-problematico',
    titulo: lider.nombre + ' es el sistema que más se reporta',
    evidencia: opRecoPlural_(lider.reportes, 'reporte', 'reportes') + ' de ' + lider.nombre +
               ' en ' + OP_RECO_PERIODO + comparacion,
    detalle: detalle,
    // Con algo abierto ahora, o con dos fallas ya confirmadas en la semana, esto deja de ser
    // una estadística y pasa a ser un problema que alguien tiene que llevar a alguna parte.
    urgencia: (viva || confirmadas >= 2) ? 'alta' : 'media',
    accion: opRecoAccionVer_(viva),
    _peso: lider.reportes
  }];
}

/**
 * 3 · SUBMOTIVO REINCIDENTE · "este fallo concreto ya volvió tres veces".
 *
 * Lo interesante no es que haya muchos reportes, sino que haya PAUSAS entre ellos: algo que se
 * arregla y reaparece no se resuelve con la incidencia de hoy, y esa es la conclusión que
 * ninguna de las otras tres recomendaciones puede dar.
 */
function opRecoMotivos_(motivos, sistemas, usosCatalogo, vivasPorSistema) {
  const salida = [];

  Object.keys(motivos).forEach(function (sisClave) {
    const S = sistemas[sisClave];
    if (!S) return;

    motivos[sisClave].forEach(function (g) {
      const nPersonas = opRecoCuantos_(g.personas);
      const nDias = opRecoCuantos_(g.dias);
      const episodios = opRecoEpisodios_(g.dias);

      if (g.reportes < OP_RECO_MIN_REPORTES_MOTIVO) return;
      if (nDias < OP_RECO_MIN_DIAS) return;
      if (nPersonas < OP_UMBRAL_PERSONAS) return;
      if (episodios < OP_RECO_MIN_EPISODIOS) return;

      // Si el problema existe en el catálogo, se enseña CON LA REDACCIÓN DEL CATÁLOGO: es la
      // que el equipo entero ve al reportar, y llamarlo aquí de otra forma —la que escribió
      // quien lo redactó primero a mano— obligaría a traducir mentalmente entre dos pantallas.
      const enCatalogo = (usosCatalogo[sisClave] || {})[g.clave];
      const nombreMotivo = enCatalogo ? enCatalogo.valor : opCapitalizar_(g.texto);
      const usos = enCatalogo ? enCatalogo.usos : 0;

      // Se busca una incidencia viva de ESE motivo con el criterio canónico, no por texto
      // exacto: si la hay, lo que toca no es abrir otra sino mirar la que está.
      const viva = (vivasPorSistema[sisClave] || []).filter(function (i) {
        return opClave_(i.submotivo) === g.clave || opMismoMotivo_(g.texto, i.submotivo);
      })[0] || null;

      salida.push({
        clave: 'submotivo-reincidente',
        titulo: 'El mismo fallo de ' + S.nombre + ' vuelve: «' + nombreMotivo + '»',
        evidencia: opRecoPlural_(g.reportes, 'reporte', 'reportes') + ' de «' + nombreMotivo +
                   '» en ' + S.nombre + ' durante ' + OP_RECO_PERIODO + ', repartidos en ' +
                   opRecoPlural_(nDias, 'día', 'días') + ' y en ' +
                   opRecoPlural_(episodios, 'ocasión separada', 'ocasiones separadas'),
        detalle: 'Lo reportaron ' + opRecoPlural_(nPersonas, 'persona', 'personas') + '.' +
                 (usos ? ' Desde que existe la lista de motivos se ha elegido ' +
                         opRecoPlural_(usos, 'vez', 'veces') + '.' : ''),
        // Tres regresos ya no son mala suerte: es algo que se está arreglando mal.
        urgencia: episodios >= 3 ? 'alta' : 'media',
        accion: opRecoAccionVer_(viva),
        _peso: g.reportes
      });
    });
  });

  salida.sort(function (a, b) { return b._peso - a._peso; });
  return salida.slice(0, OP_RECO_TOPE_MOTIVO);
}

/**
 * 4 · SUELTOS AGRUPABLES · "estos reportes ya tienen dueño y nadie los ha juntado".
 *
 * Es la única de las cuatro que no describe una tendencia sino un descuido concreto, y por eso
 * es la que lleva acción: `item` es el reporte suelto y `inc` la incidencia a la que se parece.
 *
 * El emparejamiento repite, a propósito, la escalera de `opIncidenteParaReporte_` —clave
 * exacta, luego motivo parecido, y por último una incidencia de servicio o confirmada que se
 * lleva cualquier reporte de su sistema—. Si aquí se emparejara de otra manera, la pantalla
 * propondría agrupaciones que el propio módulo no habría hecho nunca solo, y al revés.
 */
function opRecoSueltos_(sueltos, vivas) {
  if (!sueltos.length || !vivas.length) return [];

  const porIncidencia = {};
  sueltos.forEach(function (s) {
    const candidatas = vivas.filter(function (i) { return i.sistemaClave === s.sistemaClave; });
    if (!candidatas.length) return;

    let inc = candidatas.filter(function (i) {
      return opClave_(i.submotivo) && opClave_(i.submotivo) === opClave_(s.submotivo);
    })[0];
    if (!inc) {
      inc = candidatas.filter(function (i) {
        return i.submotivo && opMismoMotivo_(s.submotivo, i.submotivo);
      })[0];
    }
    if (!inc) {
      // Sin motivo (incidencia de servicio) o ya confirmada: se lleva lo que llegue de su
      // sistema. Si Connect está caído entero da igual con qué palabras lo cuente cada quien.
      inc = candidatas.filter(function (i) {
        return !opClave_(i.submotivo) || i.estado === 'confirmado' || i.estado === 'mantenimiento';
      })[0];
    }
    if (!inc) return;

    if (!porIncidencia[inc.id]) porIncidencia[inc.id] = { inc: inc, reportes: [], personas: {} };
    porIncidencia[inc.id].reportes.push(s);
    if (s.correo) porIncidencia[inc.id].personas[s.correo] = true;
  });

  const salida = [];
  Object.keys(porIncidencia).forEach(function (id) {
    const grupo = porIncidencia[id];
    const nPersonas = opRecoCuantos_(grupo.personas);
    if (grupo.reportes.length < OP_RECO_MIN_SUELTOS) return;
    if (nPersonas < OP_RECO_MIN_PERSONAS_SUELTOS) return;

    // El más reciente: es el que encabeza la lista de sueltos del panel, así que quien siga la
    // recomendación lo tiene delante sin buscar.
    grupo.reportes.sort(function (a, b) { return b.ms - a.ms; });
    const cabeza = grupo.reportes[0];
    const inc = grupo.inc;
    const titulo = inc.titulo || opTitulo_(inc.sistema, inc.submotivo);
    const desde = inc.confirmado || inc.creado;

    salida.push({
      clave: 'sueltos-agrupables',
      titulo: opRecoPlural_(grupo.reportes.length, 'reporte suelto es', 'reportes sueltos son') +
              ' la misma falla que «' + titulo + '»',
      evidencia: opRecoPlural_(grupo.reportes.length, 'reporte', 'reportes') + ' de ' +
                 cabeza.sistema + ' sin agrupar en las últimas 24 h coinciden con «' + titulo +
                 '», abierta desde ' + opRecoCuando_(desde),
      detalle: 'Los enviaron ' + opRecoPlural_(nPersonas, 'persona distinta', 'personas distintas') +
               '. Agruparlos deja esa incidencia con el peso real que tiene.',
      // Sobre una falla ya confirmada corre prisa: cada suelto que se queda fuera es un
      // reporte que no cuenta en lo que se está comunicando al equipo.
      urgencia: inc.estado === 'confirmado' ? 'alta' : 'media',
      accion: {
        texto: 'Agrupar en «' + titulo + '»',
        tipo: 'elevar',
        item: cabeza.id,
        inc: inc.id
      },
      _peso: grupo.reportes.length
    });
  });

  salida.sort(function (a, b) { return b._peso - a._peso; });
  return salida.slice(0, OP_RECO_TOPE_SUELTOS);
}

/** "las 09:14" — la hora local, que es como se habla de esto por WhatsApp. Sin fecha: todo lo
 *  que cita esta recomendación cabe en las últimas 24 h. */
function opRecoCuando_(iso) {
  const ms = opMs_(iso);
  if (!ms) return 'hace un rato';
  try {
    return 'las ' + Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'HH:mm');
  } catch (e) {
    return 'hace un rato';
  }
}

/**
 * Cambia el estado de un incidente y, si se pide, lo anuncia al equipo.
 *
 * El aviso es OPCIONAL a propósito: corregir una errata del título no merece un mensaje a
 * todo el mundo, y si cada cambio avisara, la gente silenciaría el espacio y entonces el
 * aviso que sí importa tampoco llegaría.
 *
 * @param {object} payload { email, id, estado, titulo, detalle, nota, avisar }
 */
function opActualizarIncidente(payload) {
  const lock = LockService.getScriptLock();
  try {
    payload = payload || {};
    const gate = opGate_(payload.email);
    if (!gate.ok) return { success: false, message: gate.error };

    const idInc = String(payload.id || '').trim();
    if (!idInc) return { success: false, message: 'No pudimos identificar ese reporte.' };

    lock.waitLock(20000);

    const catalogo = opLeerCatalogo_();
    const filas = opLeerHoja_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES);
    const fila = filas.filter(function (f) { return String(f.ID) === idInc; })[0];
    if (!fila) return { success: false, message: 'Ese reporte ya no está disponible.' };

    const antes = opIncidenteDeFila_(fila, catalogo);
    const nota = opLimpiarNotas_(payload.nota, 800);
    const cambiaEstado = !!String(payload.estado || '').trim();
    const estado = cambiaEstado ? opEstado_(catalogo, payload.estado) : opEstado_(catalogo, antes.estado);

    if (cambiaEstado && opClave_(payload.estado) !== estado.clave) {
      return { success: false, message: 'Ese estado no existe. Elige uno de la lista o crea uno nuevo.' };
    }
    // Descartar es decirle al equipo "no era nada". Sin una razón escrita, mañana nadie
    // recuerda por qué se cerró y el mismo problema vuelve a levantarse desde cero.
    if (estado.clave === 'descartado' && nota.length < 10) {
      return { success: false, message: 'Escribe por qué lo descartas (al menos 10 caracteres).' };
    }

    const ahora = new Date();
    const campos = { Estado: estado.clave, Actualizado: ahora, ActualizadoPor: gate.email };

    const titulo = opLimpiarTexto_(payload.titulo, 120);
    if (titulo) campos.Titulo = titulo;
    if (payload.detalle !== undefined) campos.Detalle = opLimpiarNotas_(payload.detalle, 800);

    // La fecha de confirmación se sella UNA vez: es el dato que el equipo mira para saber
    // desde cuándo está reconocido el problema, y reescribirlo en cada actualización lo
    // convertiría en "hace un momento" para siempre.
    if (!antes.confirmado && estado.afecta && estado.clave !== 'posible') {
      campos.Confirmado = ahora;
      campos.ConfirmadoPor = gate.email;
      campos.ConfirmadoNombre = gate.nombre;
    }
    if (estado.cierra && !antes.cerrado) campos.Cerrado = ahora;
    if (!estado.cierra && antes.cerrado) campos.Cerrado = '';

    opEscribirCeldas_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES, fila._fila, campos);

    const avisar = payload.avisar === true;
    opAgregarFila_(OP_SHEET_ACTUALIZACIONES, OP_COLS_ACTUALIZACIONES, {
      ID: opId_('act'), IncidenteId: idInc, Fecha: ahora,
      Autor: gate.email, AutorNombre: gate.nombre, Estado: estado.clave,
      Nota: nota, Aviso: avisar ? 'Si' : 'No'
    });

    if (estado.cierra) opCerrarReportesDe_(idInc, estado.clave);

    opInvalidarCache_();

    const catalogo2 = opLeerCatalogo_();
    const despues = opLeerHoja_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES)
      .filter(function (f) { return String(f.ID) === idInc; })
      .map(function (f) { return opIncidenteDeFila_(f, catalogo2); })[0];

    if (avisar && despues) {
      opAvisarEstado_(despues, { nota: nota, autor: gate.nombre, cambioDeEstado: antes.estado !== estado.clave });
    }

    return {
      success: true,
      incidente: despues ? opIncidentePublico_(despues) : null,
      aviso: avisar,
      message: avisar ? 'Actualizado y avisado al equipo.' : 'Actualizado. No se mandó aviso.'
    };
  } catch (e) {
    Logger.log('opActualizarIncidente: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos guardar el cambio. Inténtalo de nuevo en un momento.' };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Marca los reportes de un incidente cerrado, para que dejen de aparecer como pendientes. */
function opCerrarReportesDe_(incidenteId, estado) {
  opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES).forEach(function (f) {
    if (String(f.IncidenteId || '') !== incidenteId) return;
    opEscribirCeldas_(OP_SHEET_REPORTES, OP_COLS_REPORTES, f._fila, { Estado: estado });
  });
}

/**
 * Crea un incidente a mano. Es la puerta para lo que NADIE va a reportar porque se sabe de
 * antemano: un mantenimiento programado del sábado por la noche.
 *
 * @param {object} payload { email, sistema, sistemaNuevo, submotivo, estado, titulo, detalle, nota, avisar }
 */
function opCrearIncidente(payload) {
  const lock = LockService.getScriptLock();
  try {
    payload = payload || {};
    const gate = opGate_(payload.email);
    if (!gate.ok) return { success: false, message: gate.error };

    const catalogo = opLeerCatalogo_();
    let sistemaNombre = '';
    let sistemaClave = '';
    const escrito = opLimpiarTexto_(payload.sistemaNuevo, 60);
    if (escrito) {
      const sugerido = opSugerirExistente_(escrito, catalogo.sistemas.map(function (s) { return s.nombre; }));
      sistemaNombre = sugerido ? sugerido.valor : opCapitalizar_(escrito);
      const ya = opSistema_(catalogo, sistemaNombre);
      sistemaClave = ya ? ya.clave : opClave_(sistemaNombre);
      if (!ya) opCatalogoRegistrar_('sistema', '', sistemaNombre, gate.email);
    } else {
      const s = opSistema_(catalogo, payload.sistema);
      if (!s) return { success: false, message: 'Elige el sistema al que afecta.' };
      sistemaNombre = s.nombre; sistemaClave = s.clave;
    }

    const submotivo = opLimpiarTexto_(payload.submotivo, 60);
    if (!submotivo) return { success: false, message: 'Dinos qué es lo que está pasando.' };
    const estado = opEstado_(catalogo, payload.estado || 'confirmado');

    lock.waitLock(20000);

    const incidenteId = opId_('inc');
    const ahora = new Date();
    const titulo = opLimpiarTexto_(payload.titulo, 120) || opTitulo_(sistemaNombre, submotivo);

    opCatalogoRegistrar_('submotivo', sistemaClave, submotivo, gate.email);

    opAgregarFila_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES, {
      ID: incidenteId, Clave: sistemaClave + '|' + opClave_(submotivo),
      Sistema: sistemaNombre, SistemaClave: sistemaClave, Submotivo: submotivo,
      Estado: estado.clave, Titulo: titulo,
      Detalle: opLimpiarNotas_(payload.detalle, 800),
      Creado: ahora, CreadoPor: gate.email, CreadoNombre: gate.nombre,
      Confirmado: estado.afecta ? ahora : '', ConfirmadoPor: estado.afecta ? gate.email : '',
      ConfirmadoNombre: estado.afecta ? gate.nombre : '',
      Actualizado: ahora, ActualizadoPor: gate.email,
      Cerrado: estado.cierra ? ahora : '', Origen: 'supervision'
    });

    const nota = opLimpiarNotas_(payload.nota, 800);
    const avisar = payload.avisar === true;
    opAgregarFila_(OP_SHEET_ACTUALIZACIONES, OP_COLS_ACTUALIZACIONES, {
      ID: opId_('act'), IncidenteId: incidenteId, Fecha: ahora,
      Autor: gate.email, AutorNombre: gate.nombre, Estado: estado.clave,
      Nota: nota || 'Registrado por supervisión.', Aviso: avisar ? 'Si' : 'No'
    });

    opInvalidarCache_();

    if (avisar) {
      const catalogo2 = opLeerCatalogo_();
      const creado = opLeerHoja_(OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES)
        .filter(function (f) { return String(f.ID) === incidenteId; })
        .map(function (f) { return opIncidenteDeFila_(f, catalogo2); })[0];
      if (creado) opAvisarEstado_(creado, { nota: nota, autor: gate.nombre, cambioDeEstado: true });
    }

    return { success: true, id: incidenteId, message: avisar ? 'Publicado y avisado al equipo.' : 'Publicado.' };
  } catch (e) {
    Logger.log('opCrearIncidente: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos publicarlo. Inténtalo de nuevo en un momento.' };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Da de alta un estado nuevo (por ejemplo "Degradado" o "En validación con el proveedor").
 * El tono elegido es lo que decide si ese estado pinta el semáforo en rojo o en ámbar.
 */
function opCrearEstado(payload) {
  try {
    payload = payload || {};
    const gate = opGate_(payload.email);
    if (!gate.ok) return { success: false, message: gate.error };

    const nombre = opLimpiarTexto_(payload.nombre, 40);
    if (!nombre) return { success: false, message: 'Escribe cómo se va a llamar el estado.' };

    const tono = ['ok', 'info', 'warn', 'alert', 'neutro'].indexOf(String(payload.tono)) !== -1
      ? String(payload.tono) : 'warn';

    const catalogo = opLeerCatalogo_();
    const sugerido = opSugerirExistente_(nombre, catalogo.estados.map(function (e) { return e.nombre; }));
    if (sugerido) {
      return {
        success: false, yaExiste: true, valor: sugerido.valor,
        message: 'Ya existe un estado muy parecido: «' + sugerido.valor + '». Úsalo en vez de crear otro.'
      };
    }

    const valor = opCatalogoRegistrar_('estado', '', nombre, gate.email, tono);
    opInvalidarCache_();
    return { success: true, valor: valor, clave: opClave_(valor), tono: tono };
  } catch (e) {
    Logger.log('opCrearEstado: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos crear el estado. Inténtalo de nuevo.' };
  }
}

/**
 * Convierte un reporte suelto en incidente, sin esperar al umbral.
 * Un supervisor que YA sabe que algo está caído no debería tener que esperar a que otras dos
 * personas se topen con el mismo muro.
 */
function opElevarReporte(payload) {
  try {
    payload = payload || {};
    const gate = opGate_(payload.email);
    if (!gate.ok) return { success: false, message: gate.error };

    const repId = String(payload.reporteId || '').trim();
    const fila = opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES)
      .filter(function (f) { return String(f.ID) === repId; })[0];
    if (!fila) return { success: false, message: 'Ese reporte ya no está disponible.' };
    if (String(fila.IncidenteId || '')) {
      return { success: false, message: 'Ese reporte ya pertenece a una incidencia.' };
    }

    const creado = opCrearIncidente({
      email: payload.email,
      sistema: String(fila.SistemaClave || ''),
      submotivo: String(fila.Submotivo || ''),
      estado: payload.estado || 'confirmado',
      detalle: String(fila.Notas || ''),
      nota: opLimpiarNotas_(payload.nota, 800) || 'Elevado desde el reporte de ' + String(fila.Nombre || '') + '.',
      avisar: payload.avisar === true
    });
    if (!creado.success) return creado;

    opVincularReportesSueltos_(String(fila.SistemaClave || ''), String(fila.Submotivo || ''),
                               String(fila.SubmotivoClave || ''), creado.id,
                               Date.now() - 6 * 3600 * 1000);
    opInvalidarCache_();
    return { success: true, id: creado.id, message: 'Incidencia creada con los reportes relacionados.' };
  } catch (e) {
    Logger.log('opElevarReporte: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos crear la incidencia. Inténtalo de nuevo.' };
  }
}

/** Descarta un reporte suelto sin crear incidencia (era un problema del equipo de esa persona). */
function opDescartarReporte(payload) {
  try {
    payload = payload || {};
    const gate = opGate_(payload.email);
    if (!gate.ok) return { success: false, message: gate.error };

    const repId = String(payload.reporteId || '').trim();
    const fila = opLeerHoja_(OP_SHEET_REPORTES, OP_COLS_REPORTES)
      .filter(function (f) { return String(f.ID) === repId; })[0];
    if (!fila) return { success: false, message: 'Ese reporte ya no está disponible.' };

    opEscribirCeldas_(OP_SHEET_REPORTES, OP_COLS_REPORTES, fila._fila, { Estado: 'descartado' });
    opInvalidarCache_();
    return { success: true, message: 'Reporte descartado.' };
  } catch (e) {
    Logger.log('opDescartarReporte: ' + e);
    return { success: false, message: 'No pudimos descartarlo. Inténtalo de nuevo.' };
  }
}

// =================================================================================================
// AVISOS A GOOGLE CHAT
// =================================================================================================

/** Enlace a la vista de estado, con el incidente abierto si se conoce. */
function opUrlEstado_(incidenteId) {
  try {
    const base = ScriptApp.getService().getUrl();
    if (!base) return '';
    return base + '?page=estado' + (incidenteId ? '&inc=' + encodeURIComponent(incidenteId) : '');
  } catch (e) {
    return '';
  }
}

/** Manda un mensaje a un espacio de Chat. Nunca lanza: un webhook caído no puede tumbar nada. */
function opEnviarWebhook_(url, texto) {
  if (!url) return false;
  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: texto }),
      muteHttpExceptions: true
    });
    return true;
  } catch (e) {
    Logger.log('opEnviarWebhook_: ' + e.message);
    return false;
  }
}

/**
 * Aviso de un reporte suelto. Va a un espacio DISTINTO del de los comunicados: mezclarlos
 * haría que el mensaje que de verdad importa —"Connect está caído"— se perdiera entre veinte
 * reportes individuales.
 */
function opAvisarReporte_(datos) {
  const url = secConfig_('OPERACION_WEBHOOK_REPORTES', OPERACION_WEBHOOK_REPORTES);
  if (!url) return;

  const partes = ['*Reporte de falla* · ' + datos.sistema + ' · ' + datos.submotivo];
  partes.push('Reportó: ' + (datos.nombre || datos.correo));
  if (datos.notas) partes.push('Notas: ' + datos.notas.substring(0, 300));
  if (datos.evidencias) partes.push('Capturas adjuntas: ' + datos.evidencias);
  if (datos.incidente) {
    partes.push(datos.nuevo
      ? 'Con este reporte se levantó una incidencia automática.'
      : 'Se sumó a la incidencia «' + (datos.incidente.titulo || datos.incidente.submotivo) + '».');
    const enlace = opUrlEstado_(datos.incidente.id);
    if (enlace) partes.push('<' + enlace + '|Ver los reportes y las evidencias>');
  } else {
    partes.push('Todavía no hay suficientes reportes para levantar una incidencia.');
  }
  opEnviarWebhook_(url, partes.join('\n'));
}

/**
 * Comunicado del estado de operación al equipo.
 *
 * Tono informativo, en el idioma del equipo y con el enlace que lleva a los reportes y las
 * evidencias: si alguien duda de si lo que le pasa es lo mismo, quiere ver las capturas de
 * los demás, no un identificador.
 */
function opAvisarEstado_(incidente, opciones) {
  const url = secConfig_('OPERACION_WEBHOOK_ESTADO', OPERACION_WEBHOOK_ESTADO);
  if (!url) return false;
  opciones = opciones || {};

  const titulo = incidente.titulo || opTitulo_(incidente.sistema, incidente.submotivo);
  const encabezado = {
    posible:       '⚠️ *Posible problema* · ' + incidente.sistema,
    confirmado:    '🔴 *Falla confirmada* · ' + incidente.sistema,
    intermitencia: '🟡 *Intermitencia* · ' + incidente.sistema,
    mantenimiento: '🔧 *Mantenimiento* · ' + incidente.sistema,
    resuelto:      '✅ *Restablecido* · ' + incidente.sistema,
    descartado:    'ℹ️ *Falsa alarma* · ' + incidente.sistema
  }[incidente.estado] || ('ℹ️ *' + incidente.estadoNombre + '* · ' + incidente.sistema);

  const partes = [encabezado, titulo];

  if (incidente.estado === 'resuelto') {
    partes.push('El servicio volvió a la normalidad. Si te sigue fallando, repórtalo de nuevo.');
  } else if (incidente.estado === 'posible') {
    partes.push('Todavía sin confirmar. Si te está pasando, repórtalo para que lo veamos antes.');
  } else if (incidente.afecta) {
    partes.push('Ya se está trabajando en ello. Te avisamos en cuanto se restablezca.');
  }

  if (opciones.nota) partes.push('_' + opciones.nota.substring(0, 500) + '_');

  const desde = incidente.confirmado || incidente.creado;
  if (desde) {
    const tz = Session.getScriptTimeZone();
    partes.push('Desde: ' + Utilities.formatDate(new Date(desde), tz, "d 'de' MMMM, HH:mm") + ' h');
  }
  if (opciones.autor) partes.push('Actualizó: ' + opciones.autor);

  const enlace = opUrlEstado_(incidente.id);
  if (enlace) partes.push('<' + enlace + '|Ver los reportes y las evidencias del equipo>');

  return opEnviarWebhook_(url, partes.join('\n'));
}

// =================================================================================================
// DIAGNÓSTICO
// =================================================================================================

/**
 * Ejecútala desde el editor si algo no cuadra. No la llama el cliente.
 * Comprueba hojas, catálogo, webhooks y los algoritmos de agrupación.
 */
function opDiagnostico() {
  secSoloInterno_('opDiagnostico');
  const lineas = [];
  const anota = function (etiqueta, ok, detalle) {
    lineas.push((ok ? '✔ ' : '✖ ') + etiqueta + (detalle ? ' — ' + detalle : ''));
  };

  try {
    [[OP_SHEET_REPORTES, OP_COLS_REPORTES], [OP_SHEET_INCIDENTES, OP_COLS_INCIDENTES],
     [OP_SHEET_ACTUALIZACIONES, OP_COLS_ACTUALIZACIONES], [OP_SHEET_CATALOGO, OP_COLS_CATALOGO]]
      .forEach(function (par) {
        const sheet = opHoja_(par[0], par[1]);
        anota('Hoja ' + par[0], true, (sheet.getLastRow() - 1) + ' renglones');
      });

    const cat = opLeerCatalogo_();
    anota('Catálogo', cat.sistemas.length >= 4,
          cat.sistemas.length + ' sistemas · ' + cat.estados.length + ' estados');

    const vivos = opIncidentesVivos_(cat);
    anota('Incidencias vivas', true, vivos.length + '');

    anota('Umbral automático', true,
          OP_UMBRAL_PERSONAS + ' personas / ' + OP_VENTANA_MIN + ' min · por motivo' +
          (OP_UMBRAL_SERVICIO_ACTIVO ? ' y por sistema' : ' (el de sistema está apagado)') +
          ' · se publica sin confirmar');

    // Los algoritmos, con casos que ya han mordido antes.
    anota('Detecta el mismo texto con otro orden',
          opDice_('no carga la pagina', 'la pagina no carga') >= 0.7,
          'Dice = ' + opDice_('no carga la pagina', 'la pagina no carga').toFixed(2));
    anota('Detecta un error de dedo',
          !!opSugerirExistente_('no cagra', ['No carga']),
          'no cagra → No carga');
    anota('NO funde dos siglas distintas',
          !opSugerirExistente_('SOMS', ['SAP']),
          'SOMS ≠ SAP');
    anota('NO funde dos sistemas distintos',
          !opSugerirExistente_('Salesforce', ['Connect']), '');

    const wEstado = secConfig_('OPERACION_WEBHOOK_ESTADO', OPERACION_WEBHOOK_ESTADO);
    const wRep = secConfig_('OPERACION_WEBHOOK_REPORTES', OPERACION_WEBHOOK_REPORTES);
    anota('Webhook de comunicados', !!wEstado, wEstado ? 'configurado' : 'SIN configurar');
    anota('Webhook de reportes sueltos', true, wRep ? 'configurado' : 'apagado (opcional)');

    const url = opUrlEstado_('');
    anota('Enlace público del estado', !!url, url || 'sin despliegue todavía');

    anota('Permiso "' + OP_BLOQUE + '" en el catálogo',
          (typeof PERM_IDS !== 'undefined') && PERM_IDS.indexOf(OP_BLOQUE) !== -1,
          'Permisos.gs');
  } catch (e) {
    anota('Diagnóstico', false, e.message);
  }

  const texto = lineas.join('\n');
  Logger.log(texto);
  return texto;
}
