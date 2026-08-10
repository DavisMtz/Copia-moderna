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

function opCacheado_(nombre, ttl, productor) {
  try {
    const cache = CacheService.getScriptCache();
    const hit = cache.get('op_g' + opGeneracion_() + '_' + nombre);
    if (hit) return JSON.parse(hit);

    const fresco = productor();
    if (fresco && fresco.success !== false) {
      const json = JSON.stringify(fresco);
      // La clave se recalcula AQUÍ, no arriba: el productor puede haber invalidado la caché
      // por el camino (opCaducarPosibles_ cierra incidencias abandonadas mientras lee), y
      // guardar bajo la generación anterior dejaba la entrada muerta al nacer.
      if (json.length < 95000) cache.put('op_g' + opGeneracion_() + '_' + nombre, json, ttl);
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

/** Cuántos días de historia se pueden pedir. Más de un trimestre no cabe en una barra legible. */
const OP_HISTORIAL_MAX_DIAS = 90;
const OP_HISTORIAL_POR_OMISION = 14;

/** Cuánto se cachea el historial. Es un gráfico por día: no cambia de un segundo a otro. */
const OP_TTL_HISTORIAL = 600;

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

/** Tono de un día a partir de cuánto se reportó y de si hubo algo confirmado. */
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
    dias: dias,
    desde: eje[0],
    hasta: eje[eje.length - 1],
    eje: eje,
    umbral: OP_UMBRAL_PERSONAS,
    sistemas: sistemas,
    totales: totales,
    // El historial de fallas confirmadas, por día. Es lo que se queda publicado para siempre.
    confirmados: confirmadosPorDia,
    resumen: {
      diasLimpios: dias - diasConAlgo,
      diasConIncidencias: diasConAlgo,
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
 * Todo lo que necesita el panel: incidentes vivos, los ya cerrados de los últimos días y los
 * reportes que aún no pertenecen a ningún incidente (los que no llegaron al umbral).
 */
function opPanel(email) {
  try {
    const gate = opGate_(email);
    if (!gate.ok) return { success: false, message: gate.error };

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
      yo: { email: gate.email, nombre: gate.nombre },
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
  } catch (e) {
    Logger.log('opPanel: ' + e + ' · ' + e.stack);
    return { success: false, message: 'No pudimos cargar el panel. Inténtalo de nuevo en un momento.' };
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
