/**
 * =================================================================================================
 * POLÍTICA DE REVISIÓN | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Decide, en el momento en que se guarda una cotización, si tiene que pasar por la cola de
 * revisión o si puede salir al cliente directamente.
 *
 * POR QUÉ EXISTE
 * Hasta ahora TODA cotización nacía "En Revisión" y ahí se quedaba hasta que un supervisor la
 * abría. Eso está bien para una cotización de $60,000 y es puro trámite para una de $800 hecha
 * por un asesor de siempre a media mañana. La consecuencia real no era la espera: era que la
 * cola se llenaba de casos triviales y los que sí importaban se revisaban con prisa.
 *
 * Ahora supervisión define la regla. La pantalla del panel avanzado escribe aquí.
 *
 * CÓMO DECIDE — tres escalones, en este orden:
 *   1. Interruptor maestro (`exigirRevision`). Si está apagado, NADA pasa por revisión.
 *   2. Lista ordenada de criterios. Gana el PRIMERO que coincide. El orden es la prioridad,
 *      y por eso la pantalla deja moverlos: sin orden explícito, dos reglas que se solapan
 *      ("más de $50,000" y "menos de $5,000 va directo") tienen un resultado que nadie
 *      puede predecir mirando la lista.
 *   3. Si ninguno coincide, manda `accionPorDefecto`.
 *
 * PRINCIPIO: el simulador de la pantalla NO reimplementa esta lógica en JavaScript; llama a
 * `simularPoliticaRevision`, que ejecuta exactamente el mismo `revpolEvaluar_` que decide de
 * verdad. Una pantalla de configuración que calcula su propia vista previa acaba mintiendo el
 * día que las dos copias se separan, y aquí lo que se configura es si un precio sale sin que
 * nadie lo mire.
 *
 * QUEDA FUERA a propósito: una regla de "cliente nuevo". Es un criterio valioso, pero obliga a
 * recorrer la hoja entera de cotizaciones en cada guardado para saber si ese correo ya aparecía,
 * y eso es justo lo que Cache.gs existe para evitar. Se puede añadir después con una lista de
 * clientes conocidos precalculada.
 *
 * DEPENDENCIAS: Seguridad.gs (secIdentidadAvanzada_) y Revision.gs (constantes de estatus).
 * Todas se consultan con `typeof` donde se puede seguir sin ellas: un despliegue parcial degrada
 * al comportamiento de siempre (revisar todo), nunca a "enviar todo sin revisar".
 */

const REVPOL_PROP_KEY = 'revision_politica_v1';

/** Tope de criterios. No es una limitación técnica: una lista que nadie puede leer de un
 *  vistazo deja de ser una política y pasa a ser un sistema opaco. */
const REVPOL_MAX_REGLAS = 20;

/** Cuántos cambios de política se recuerdan. Es el rastro de quién relajó qué y cuándo. */
const REVPOL_MAX_HISTORIAL = 25;

/**
 * Catálogo de criterios configurables. El panel avanzado lo pinta tal cual: para agregar un
 * criterio nuevo se añade aquí y se implementa su caso en `revpolCoincide_`; la pantalla no
 * necesita cambiar.
 */
const REVPOL_TIPOS = [
  {
    id: 'monto',
    nombre: 'Monto de la cotización',
    descripcion: 'Compara el total con IVA contra una cantidad.',
    campos: ['operador', 'valor', 'valor2'],
    unidad: 'moneda'
  },
  {
    id: 'descuento',
    nombre: 'Descuento aplicado',
    descripcion: 'Toma el descuento más alto de todas las líneas y lo compara con un porcentaje.',
    campos: ['operador', 'valor', 'valor2'],
    unidad: 'porcentaje'
  },
  {
    id: 'articulos',
    nombre: 'Número de artículos',
    descripcion: 'Cuántas líneas distintas trae la cotización.',
    campos: ['operador', 'valor', 'valor2'],
    unidad: 'entero'
  },
  {
    id: 'formato',
    nombre: 'Formato de la cotización',
    descripcion: 'Aplica solo a los formatos que elijas.',
    campos: ['formatos'],
    unidad: ''
  },
  {
    id: 'asesor',
    nombre: 'Asesor que cotiza',
    descripcion: 'Aplica solo a los correos que enlistes.',
    campos: ['correos'],
    unidad: ''
  },
  {
    id: 'horario',
    nombre: 'Día y hora',
    descripcion: 'Aplica dentro (o fuera) de una franja horaria y unos días concretos.',
    campos: ['dias', 'desde', 'hasta', 'dentro'],
    unidad: ''
  }
];

const REVPOL_OPERADORES = [
  { id: 'mayor-igual', nombre: 'es mayor o igual a' },
  { id: 'menor',       nombre: 'es menor que' },
  { id: 'entre',       nombre: 'está entre' }
];

const REVPOL_DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Política de arranque: exactamente el comportamiento que el sistema tenía antes de este
 * módulo. Instalar esto no cambia nada hasta que alguien entra al panel y decide otra cosa.
 */
function revpolPorDefecto_() {
  return {
    version: 1,
    exigirRevision: true,
    accionPorDefecto: 'revisar',
    reglas: [],
    actualizadaPor: '',
    actualizadaEn: '',
    historial: []
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// LECTURA Y NORMALIZACIÓN
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lee la política guardada. NUNCA lanza: si el JSON está corrupto o las propiedades no
 * responden, devuelve la política por defecto —que revisa todo—. El modo seguro ante un
 * fallo es revisar de más, jamás enviar de más.
 */
function revpolLeer_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(REVPOL_PROP_KEY);
    if (!raw) return revpolPorDefecto_();
    return revpolNormalizar_(JSON.parse(raw));
  } catch (e) {
    Logger.log('revpolLeer_: no se pudo leer la política (' + e.message + '). Se revisa todo.');
    return revpolPorDefecto_();
  }
}

/**
 * Deja la política en una forma conocida: rellena lo que falte, tira lo que no se reconozca y
 * recorta lo que se pase de rango. Se aplica al leer Y al guardar, de modo que ni un JSON
 * escrito a mano en las propiedades del script puede meter una regla que el motor no entienda.
 */
function revpolNormalizar_(bruta) {
  const base = revpolPorDefecto_();
  const p = (bruta && typeof bruta === 'object') ? bruta : {};

  const politica = {
    version: 1,
    // Solo un `false` explícito apaga la revisión. Un valor ausente o raro deja el modo seguro.
    exigirRevision: p.exigirRevision === false ? false : true,
    accionPorDefecto: (p.accionPorDefecto === 'auto') ? 'auto' : 'revisar',
    reglas: [],
    actualizadaPor: String(p.actualizadaPor || ''),
    actualizadaEn: String(p.actualizadaEn || ''),
    historial: Array.isArray(p.historial) ? p.historial.slice(0, REVPOL_MAX_HISTORIAL) : []
  };

  const crudas = Array.isArray(p.reglas) ? p.reglas.slice(0, REVPOL_MAX_REGLAS) : [];
  crudas.forEach(function (r, i) {
    const limpia = revpolNormalizarRegla_(r, i);
    if (limpia) politica.reglas.push(limpia);
  });

  return politica;
}

/** @return {?object} la regla saneada, o null si el tipo no existe (regla de una versión futura). */
function revpolNormalizarRegla_(r, indice) {
  if (!r || typeof r !== 'object') return null;
  const tipo = String(r.tipo || '');
  if (!REVPOL_TIPOS.some(function (t) { return t.id === tipo; })) return null;

  const regla = {
    id: String(r.id || ('r' + Date.now() + '-' + indice)).slice(0, 40),
    tipo: tipo,
    activa: r.activa === false ? false : true,
    accion: (r.accion === 'auto') ? 'auto' : 'revisar',
    nota: String(r.nota || '').slice(0, 200)
  };

  if (tipo === 'monto' || tipo === 'descuento' || tipo === 'articulos') {
    const op = String(r.operador || 'mayor-igual');
    regla.operador = REVPOL_OPERADORES.some(function (o) { return o.id === op; }) ? op : 'mayor-igual';
    regla.valor = Math.max(0, parseFloat(r.valor) || 0);
    regla.valor2 = Math.max(0, parseFloat(r.valor2) || 0);
    // "Entre 500 y 100" no significa nada: se ordenan solos en vez de rechazar el guardado.
    if (regla.operador === 'entre' && regla.valor2 < regla.valor) {
      const t = regla.valor; regla.valor = regla.valor2; regla.valor2 = t;
    }
    if (tipo === 'articulos') {
      regla.valor = Math.round(regla.valor);
      regla.valor2 = Math.round(regla.valor2);
    }
    if (tipo === 'descuento') {
      regla.valor = Math.min(100, regla.valor);
      regla.valor2 = Math.min(100, regla.valor2);
    }
  }

  if (tipo === 'formato') {
    const catalogo = (typeof QUOTE_FORMATS === 'object' && QUOTE_FORMATS.length)
      ? QUOTE_FORMATS.map(function (f) { return f.id; })
      : ['actual', 'ccl_liverpool'];
    regla.formatos = (Array.isArray(r.formatos) ? r.formatos : [])
      .map(function (f) { return String(f); })
      .filter(function (f) { return catalogo.indexOf(f) > -1; });
  }

  if (tipo === 'asesor') {
    regla.correos = (Array.isArray(r.correos) ? r.correos : [])
      .map(function (c) { return String(c || '').trim().toLowerCase(); })
      .filter(function (c) { return c.indexOf('@') > 0; })
      .slice(0, 50);
  }

  if (tipo === 'horario') {
    regla.dias = (Array.isArray(r.dias) ? r.dias : [])
      .map(function (d) { return parseInt(d, 10); })
      .filter(function (d) { return d >= 0 && d <= 6; });
    if (!regla.dias.length) regla.dias = [0, 1, 2, 3, 4, 5, 6];
    regla.desde = revpolHoraValida_(r.desde, '09:00');
    regla.hasta = revpolHoraValida_(r.hasta, '18:00');
    regla.dentro = r.dentro === false ? false : true;
  }

  return regla;
}

/** 'HH:MM' de 24 h, o el respaldo si no lo es. */
function revpolHoraValida_(v, respaldo) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return respaldo;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return respaldo;
  return (h < 10 ? '0' + h : String(h)) + ':' + m[2];
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// MOTOR DE DECISIÓN
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Contexto evaluable a partir de los datos de una cotización.
 * El descuento se calcula con la MISMA fórmula que usan la pantalla de revisión y el documento
 * del cliente: si aquí se calculara distinto, la regla "revisar si el descuento pasa del 40%"
 * dispararía sobre un número que nadie más ve.
 *
 * @param {object} quoteData Datos tal como llegan de la pantalla de cotización.
 * @param {Date=} cuando Momento a evaluar (por defecto, ahora).
 */
function revpolContextoDeCotizacion_(quoteData, cuando) {
  const q = quoteData || {};
  const productos = Array.isArray(q.products) ? q.products : [];

  let descuentoMax = 0;
  productos.forEach(function (p) {
    const unitario = parseFloat(p.unitPrice) || 0;
    const cantidad = parseInt(p.quantity, 10) || 0;
    const volumen = unitario * cantidad;
    if (volumen <= 0) return;

    const pagoUnico = parseFloat(p.costPaymentUnique) || 0;
    const descPublico = parseFloat(p.discountPublicPercent) || 0;
    const aplicaAdicional = p.additionalDiscountApplied === 'Si';
    const descAdicional = parseFloat(p.additionalDiscountPercent) || 0;

    let total;
    if (pagoUnico > 0 && cantidad > 0 && unitario > 0) {
      total = pagoUnico;
    } else {
      const base = Math.max(0, volumen * (1 - descPublico / 100));
      total = (aplicaAdicional && descAdicional > 0) ? base * (1 - descAdicional / 100) : base;
      total = Math.max(0, total);
    }
    const pct = ((volumen - total) / volumen) * 100;
    if (pct > descuentoMax) descuentoMax = pct;
  });

  return {
    total: parseFloat(q.summaryTotal) || 0,
    descuentoMax: descuentoMax,
    articulos: productos.length,
    formato: String(q.format || ''),
    asesorCorreo: String(q.advisorEmail || '').trim().toLowerCase(),
    fecha: (cuando instanceof Date) ? cuando : new Date()
  };
}

/**
 * Aplica la política a un contexto.
 *
 * @param {object} contexto  De revpolContextoDeCotizacion_ (o del simulador).
 * @param {object=} politica La política a usar; por defecto, la guardada.
 * @return {{revisar:boolean, motivo:string, reglaId:string, origen:string}}
 *         `origen` es 'maestro' | 'regla' | 'defecto': de dónde salió la decisión.
 */
function revpolEvaluar_(contexto, politica) {
  const p = politica || revpolLeer_();

  if (!p.exigirRevision) {
    return {
      revisar: false,
      origen: 'maestro',
      reglaId: '',
      motivo: 'La revisión de cotizaciones está desactivada en el panel de supervisión.'
    };
  }

  for (let i = 0; i < p.reglas.length; i++) {
    const r = p.reglas[i];
    if (!r.activa) continue;
    if (!revpolCoincide_(r, contexto)) continue;
    return {
      revisar: r.accion === 'revisar',
      origen: 'regla',
      reglaId: r.id,
      motivo: 'Criterio ' + (i + 1) + ': ' + revpolDescribirRegla_(r)
    };
  }

  return {
    revisar: p.accionPorDefecto === 'revisar',
    origen: 'defecto',
    reglaId: '',
    motivo: p.accionPorDefecto === 'revisar'
      ? 'Ningún criterio coincide y lo predeterminado es revisar.'
      : 'Ningún criterio coincide y lo predeterminado es enviar directo.'
  };
}

/** ¿Esta regla aplica a este contexto? */
function revpolCoincide_(r, c) {
  switch (r.tipo) {
    case 'monto':      return revpolCompara_(r, c.total);
    case 'descuento':  return revpolCompara_(r, c.descuentoMax);
    case 'articulos':  return revpolCompara_(r, c.articulos);
    case 'formato':    return r.formatos.length > 0 && r.formatos.indexOf(c.formato) > -1;
    case 'asesor':     return r.correos.length > 0 && r.correos.indexOf(c.asesorCorreo) > -1;
    case 'horario':    return revpolCoincideHorario_(r, c.fecha);
    default:           return false;
  }
}

function revpolCompara_(r, valor) {
  const v = parseFloat(valor) || 0;
  if (r.operador === 'menor') return v < r.valor;
  if (r.operador === 'entre') return v >= r.valor && v <= r.valor2;
  return v >= r.valor;   // mayor-igual
}

/**
 * Franja horaria en la ZONA DEL SCRIPT, no la del navegador de quien configuró la regla.
 * Un supervisor que abra el panel desde otro huso escribiría "18:00" pensando en su reloj y
 * la cotización se evaluaría con otro: la hora que manda es la del sistema (America/Mexico_City).
 */
function revpolCoincideHorario_(r, fecha) {
  const tz = Session.getScriptTimeZone();
  const d = (fecha instanceof Date) ? fecha : new Date();

  const dia = parseInt(Utilities.formatDate(d, tz, 'u'), 10) % 7;   // 'u': 1=lunes … 7=domingo
  const minutos = parseInt(Utilities.formatDate(d, tz, 'H'), 10) * 60 +
                  parseInt(Utilities.formatDate(d, tz, 'm'), 10);

  const desde = revpolMinutos_(r.desde);
  const hasta = revpolMinutos_(r.hasta);

  // Una franja que cruza la medianoche (22:00 → 06:00) pertenece al día en que EMPIEZA.
  const cruzaMedianoche = hasta < desde;
  const diaAnterior = (dia + 6) % 7;
  const diaCoincide = cruzaMedianoche
    ? (r.dias.indexOf(dia) > -1 && minutos >= desde) ||
      (r.dias.indexOf(diaAnterior) > -1 && minutos <= hasta)
    : r.dias.indexOf(dia) > -1;

  let dentroFranja;
  if (cruzaMedianoche) dentroFranja = diaCoincide;
  else dentroFranja = diaCoincide && minutos >= desde && minutos <= hasta;

  return r.dentro ? dentroFranja : !dentroFranja;
}

function revpolMinutos_(hhmm) {
  const m = String(hhmm || '00:00').split(':');
  return (parseInt(m[0], 10) || 0) * 60 + (parseInt(m[1], 10) || 0);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// TEXTO LEGIBLE
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Una regla contada en español. Se usa en la lista del panel, en el simulador y —lo importante—
 * en la celda RevisionNotas de la hoja: dentro de seis meses, la pregunta va a ser "¿por qué
 * este folio se aprobó solo?" y la respuesta tiene que estar en la hoja, no en este archivo.
 */
function revpolDescribirRegla_(r) {
  const money = function (n) {
    return (typeof formatCurrencyGS === 'function')
      ? formatCurrencyGS(n)
      : '$' + Number(n || 0).toFixed(2);
  };

  let condicion = '';
  switch (r.tipo) {
    case 'monto':
      condicion = 'el total ' + revpolTextoComparacion_(r, money);
      break;
    case 'descuento':
      condicion = 'el descuento más alto ' + revpolTextoComparacion_(r, function (n) { return n + '%'; });
      break;
    case 'articulos':
      condicion = 'el número de artículos ' + revpolTextoComparacion_(r, function (n) { return String(n); });
      break;
    case 'formato': {
      const nombres = r.formatos.map(function (id) {
        if (typeof QUOTE_FORMATS === 'object' && QUOTE_FORMATS.length) {
          const f = QUOTE_FORMATS.filter(function (x) { return x.id === id; })[0];
          if (f) return f.name;
        }
        return id;
      });
      condicion = 'el formato es ' + (nombres.join(' o ') || '(ninguno)');
      break;
    }
    case 'asesor':
      condicion = 'cotiza ' + (r.correos.join(', ') || '(nadie)');
      break;
    case 'horario': {
      const dias = (r.dias.length === 7)
        ? 'cualquier día'
        : r.dias.map(function (d) { return REVPOL_DIAS[d]; }).join(', ');
      condicion = 'se guarda ' + (r.dentro ? 'dentro' : 'fuera') +
                  ' de ' + r.desde + '–' + r.hasta + ' (' + dias + ')';
      break;
    }
    default:
      condicion = 'condición desconocida';
  }

  const efecto = (r.accion === 'revisar') ? 'pasa a revisión' : 'se envía sin revisar';
  return 'si ' + condicion + ', ' + efecto + '.';
}

function revpolTextoComparacion_(r, fmt) {
  if (r.operador === 'menor') return 'es menor que ' + fmt(r.valor);
  if (r.operador === 'entre') return 'está entre ' + fmt(r.valor) + ' y ' + fmt(r.valor2);
  return 'es mayor o igual a ' + fmt(r.valor);
}

/** Una frase que resume el estado completo de la política, para la cabecera del panel. */
function revpolResumen_(p) {
  if (!p.exigirRevision) {
    return 'La revisión está DESACTIVADA: todas las cotizaciones se pueden enviar en cuanto se guardan.';
  }
  const activas = p.reglas.filter(function (r) { return r.activa; }).length;
  const base = p.accionPorDefecto === 'revisar'
    ? 'Por defecto todo pasa a revisión'
    : 'Por defecto todo se envía sin revisar';
  if (!activas) return base + ' y no hay criterios configurados.';
  return base + ', con ' + activas + (activas === 1 ? ' criterio que lo modifica.' : ' criterios que lo modifican.');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// API PARA LA PANTALLA
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Todo lo que necesita el panel avanzado para pintar la política: la política, el catálogo de
 * criterios disponibles y los formatos reales del sistema.
 */
function getPoliticaRevision(email) {
  try {
    const id = secIdentidadConBloque_(email, 'politica_revision');
    if (!id.ok) {
      return { success: false, message: id.error || 'Solo un usuario avanzado puede ver la política de revisión.' };
    }
    const p = revpolLeer_();
    return {
      success: true,
      politica: p,
      resumen: revpolResumen_(p),
      descripciones: p.reglas.map(revpolDescribirRegla_),
      catalogo: {
        tipos: REVPOL_TIPOS,
        operadores: REVPOL_OPERADORES,
        dias: REVPOL_DIAS,
        formatos: (typeof QUOTE_FORMATS === 'object' && QUOTE_FORMATS.length)
          ? QUOTE_FORMATS.map(function (f) { return { id: f.id, nombre: f.name }; })
          : [{ id: 'actual', nombre: 'Cotización estándar' },
             { id: 'ccl_liverpool', nombre: 'Formato CCL Liverpool' }],
        zonaHoraria: Session.getScriptTimeZone(),
        maxReglas: REVPOL_MAX_REGLAS
      }
    };
  } catch (error) {
    Logger.log('getPoliticaRevision falló: ' + error.message);
    return { success: false, message: 'No pudimos cargar las reglas de revisión. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * Guarda la política completa. Se manda entera y no regla por regla a propósito: el orden es
 * parte del significado, y guardar por partes deja ventanas en las que la política vigente es
 * una mezcla de la vieja y la nueva que nadie escribió.
 *
 * @param {string} email
 * @param {object} politica
 */
function guardarPoliticaRevision(email, politica) {
  try {
    const id = secIdentidadConBloque_(email, 'politica_revision');
    if (!id.ok) {
      return { success: false, message: id.error || 'Solo un usuario avanzado puede cambiar la política de revisión.' };
    }

    const anterior = revpolLeer_();
    const nueva = revpolNormalizar_(politica);

    if (Array.isArray(politica && politica.reglas) && politica.reglas.length > REVPOL_MAX_REGLAS) {
      return { success: false, message: 'La política no puede tener más de ' + REVPOL_MAX_REGLAS + ' criterios.' };
    }

    nueva.actualizadaPor = id.nombre ? (id.nombre + ' (' + id.email + ')') : id.email;
    nueva.actualizadaEn = new Date().toISOString();

    // El historial se conserva de la política ANTERIOR: si viniera del cliente, quien relaja la
    // política podría mandar un historial vacío en la misma petición y borrar su propio rastro.
    nueva.historial = [{
      fecha: nueva.actualizadaEn,
      por: nueva.actualizadaPor,
      que: revpolDiferencias_(anterior, nueva)
    }].concat(anterior.historial || []).slice(0, REVPOL_MAX_HISTORIAL);

    PropertiesService.getScriptProperties().setProperty(REVPOL_PROP_KEY, JSON.stringify(nueva));
    Logger.log('Política de revisión actualizada por ' + nueva.actualizadaPor + ': ' +
               JSON.stringify(nueva.historial[0].que));

    const respuesta = getPoliticaRevision(email);
    respuesta.message = 'Política de revisión guardada.';
    // Apagar la revisión es la clase de cambio del que uno quiere enterarse al hacerlo,
    // no tres semanas después al preguntarse por qué nada llega a la cola.
    if (anterior.exigirRevision && !nueva.exigirRevision) {
      respuesta.aviso = 'La revisión quedó DESACTIVADA: desde ahora toda cotización se puede ' +
                        'enviar al cliente sin que nadie la apruebe, incluidas las que ya estaban en la cola.';
    }
    return respuesta;
  } catch (error) {
    Logger.log('guardarPoliticaRevision falló: ' + error.message + ' Stack: ' + error.stack);
    return { success: false, message: 'No pudimos guardar las reglas de revisión. Inténtalo de nuevo en un momento.' };
  }
}

/** Qué cambió entre dos políticas, en frases cortas para el historial. */
function revpolDiferencias_(a, b) {
  const cambios = [];
  if (a.exigirRevision !== b.exigirRevision) {
    cambios.push(b.exigirRevision ? 'Reactivó la revisión' : 'DESACTIVÓ la revisión');
  }
  if (a.accionPorDefecto !== b.accionPorDefecto) {
    cambios.push('Cambió lo predeterminado a ' +
      (b.accionPorDefecto === 'revisar' ? '"revisar"' : '"enviar directo"'));
  }
  const na = a.reglas.length, nb = b.reglas.length;
  if (na !== nb) cambios.push('Criterios: ' + na + ' → ' + nb);
  else if (JSON.stringify(a.reglas) !== JSON.stringify(b.reglas)) cambios.push('Editó los criterios');
  return cambios.length ? cambios.join(' · ') : 'Sin cambios efectivos';
}

/**
 * Qué pasaría con una cotización de estas características. Lo usa el simulador del panel.
 *
 * Ejecuta el MISMO motor que decide de verdad; si algún día divergen, el simulador deja de
 * servir para lo único que sirve, que es poder confiar en la configuración antes de guardarla.
 *
 * @param {string} email
 * @param {{total:number, descuentoMax:number, articulos:number, formato:string,
 *          asesorCorreo:string, fechaHora:string}} caso
 * @param {object=} politicaBorrador Política sin guardar (para probar antes de aplicar).
 */
function simularPoliticaRevision(email, caso, politicaBorrador) {
  try {
    const id = secIdentidadConBloque_(email, 'politica_revision');
    if (!id.ok) {
      return { success: false, message: id.error || 'Solo un usuario avanzado puede simular la política.' };
    }

    const c = caso || {};
    let fecha = new Date();
    if (c.fechaHora) {
      const parseada = new Date(c.fechaHora);
      if (!isNaN(parseada.getTime())) fecha = parseada;
    }

    const contexto = {
      total: Math.max(0, parseFloat(c.total) || 0),
      descuentoMax: Math.min(100, Math.max(0, parseFloat(c.descuentoMax) || 0)),
      articulos: Math.max(0, parseInt(c.articulos, 10) || 0),
      formato: String(c.formato || ''),
      asesorCorreo: String(c.asesorCorreo || '').trim().toLowerCase(),
      fecha: fecha
    };

    // Si llega un borrador se simula CON ÉL: la gracia es ver el efecto antes de guardar.
    const politica = politicaBorrador ? revpolNormalizar_(politicaBorrador) : revpolLeer_();
    const decision = revpolEvaluar_(contexto, politica);

    return {
      success: true,
      revisar: decision.revisar,
      motivo: decision.motivo,
      origen: decision.origen,
      reglaId: decision.reglaId,
      contexto: {
        total: contexto.total,
        descuentoMax: contexto.descuentoMax,
        articulos: contexto.articulos,
        formato: contexto.formato,
        asesorCorreo: contexto.asesorCorreo,
        // La hora que se DEVUELVE es la del script, que es con la que se decidió.
        hora: Utilities.formatDate(fecha, Session.getScriptTimeZone(), "EEEE dd/MM/yyyy HH:mm")
      }
    };
  } catch (error) {
    Logger.log('simularPoliticaRevision falló: ' + error.message);
    return { success: false, message: 'No pudimos hacer la prueba. Inténtalo de nuevo en un momento.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// ENGANCHE CON EL GUARDADO DE COTIZACIONES
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Decide el estatus con el que nace una cotización. La llama Code.gs al guardar.
 *
 * Ante CUALQUIER problema devuelve "revisar": un fallo en la política nunca puede convertirse
 * en un documento que sale al cliente sin que nadie lo mire.
 *
 * @param {object} quoteData
 * @return {{revisar:boolean, motivo:string, origen:string, reglaId:string}}
 */
function revpolDecidirAlGuardar_(quoteData) {
  try {
    const contexto = revpolContextoDeCotizacion_(quoteData);
    return revpolEvaluar_(contexto);
  } catch (e) {
    Logger.log('revpolDecidirAlGuardar_ falló (' + e.message + '): la cotización pasa a revisión.');
    return { revisar: true, motivo: 'No se pudo evaluar la política; se mandó a revisión por seguridad.',
             origen: 'error', reglaId: '' };
  }
}

/**
 * Escribe en la hoja el sello de una aprobación automática.
 *
 * Deja el MISMO rastro que una aprobación humana —quién, cuándo, con qué notas— porque las
 * pantallas que lo leen (consulta, panel, correo al asesor) no distinguen una de otra, y porque
 * dentro de seis meses la pregunta va a ser "¿quién aprobó esto?" y la respuesta tiene que ser
 * "la política, por esta regla", no una celda vacía.
 *
 * @param {string} folio
 * @param {{motivo:string, origen:string}} decision
 */
function revpolSellarAprobacionAutomatica_(folio, decision) {
  try {
    const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COTIZACIONES_SHEET_NAME);
    if (!hoja || typeof revAsegurarColumnas_ !== 'function') return;

    const headers = revAsegurarColumnas_(hoja);
    const iFolio = headers.indexOf('Folio');
    if (iFolio === -1) return;

    const datos = hoja.getDataRange().getValues();
    let fila = -1;
    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][iFolio]) === String(folio)) { fila = i + 1; break; }
    }
    if (fila === -1) return;

    const escribir = function (col, valor) {
      const idx = headers.indexOf(col);
      if (idx > -1) hoja.getRange(fila, idx + 1).setValue(valor);
    };

    escribir(REV_COLS.estado, REV_ESTATUS_APROBADA);
    escribir(REV_COLS.por, 'politica-automatica@sistema');
    escribir(REV_COLS.nombre, 'Aprobación automática');
    escribir(REV_COLS.fecha, new Date());
    escribir(REV_COLS.notas, 'Aprobada sin revisión humana por la política vigente. ' + decision.motivo);
    escribir(REV_COLS.checklist,
      'No se verificó artículo por artículo: la política del panel de supervisión permitió el ' +
      'envío directo.\nMotivo registrado: ' + decision.motivo);

    Logger.log('Cotización ' + folio + ' aprobada automáticamente. ' + decision.motivo);
  } catch (e) {
    // Si el sello falla, la cotización queda con estatus "Aprobada" pero sin rastro. Se
    // registra fuerte porque es una inconsistencia que hay que poder encontrar después.
    Logger.log('revpolSellarAprobacionAutomatica_ FALLÓ para ' + folio + ': ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// DIAGNÓSTICO
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Comprueba el motor desde el editor de Apps Script: enseña la política vigente y corre unos
 * casos contra una política de prueba para verificar que el orden y las franjas horarias se
 * comportan. No toca lo que hay guardado.
 */
function revpolDiagnostico() {
  secSoloInterno_('revpolDiagnostico');
  const lineas = ['POLÍTICA DE REVISIÓN — diagnóstico'];
  const anota = function (ok, txt) { lineas.push((ok ? '✔ ' : '✖ ') + txt); };

  const vigente = revpolLeer_();
  lineas.push('');
  lineas.push('VIGENTE: ' + revpolResumen_(vigente));
  vigente.reglas.forEach(function (r, i) {
    lineas.push('  ' + (i + 1) + '. ' + (r.activa ? '' : '(apagado) ') + revpolDescribirRegla_(r));
  });
  if (vigente.actualizadaPor) {
    lineas.push('  última edición: ' + vigente.actualizadaPor + ' · ' + vigente.actualizadaEn);
  }

  // Política de prueba: el orden importa y estos dos criterios se solapan a propósito.
  const prueba = revpolNormalizar_({
    exigirRevision: true,
    accionPorDefecto: 'revisar',
    reglas: [
      { id: 'a', tipo: 'descuento', operador: 'mayor-igual', valor: 40, accion: 'revisar' },
      { id: 'b', tipo: 'monto', operador: 'menor', valor: 5000, accion: 'auto' },
      { id: 'c', tipo: 'horario', dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00',
        dentro: false, accion: 'revisar' }
    ]
  });

  lineas.push('');
  lineas.push('CASOS (política de prueba, no se guarda):');

  const lunes10 = new Date(2026, 7, 3, 10, 0, 0);   // lunes 3 ago 2026, 10:00
  const lunes22 = new Date(2026, 7, 3, 22, 0, 0);   // mismo lunes, 22:00

  const casos = [
    { txt: '$900, 10% desc, lunes 10:00 → directo',
      ctx: { total: 900, descuentoMax: 10, articulos: 1, formato: 'actual', asesorCorreo: '', fecha: lunes10 },
      esperado: false },
    { txt: '$900 pero 55% desc → revisar (gana el criterio 1, va antes)',
      ctx: { total: 900, descuentoMax: 55, articulos: 1, formato: 'actual', asesorCorreo: '', fecha: lunes10 },
      esperado: true },
    { txt: '$80,000, 10% desc → revisar (por defecto)',
      ctx: { total: 80000, descuentoMax: 10, articulos: 3, formato: 'actual', asesorCorreo: '', fecha: lunes10 },
      esperado: true },
    { txt: '$900 a las 22:00 → directo (el criterio 2 gana antes que el horario)',
      ctx: { total: 900, descuentoMax: 5, articulos: 1, formato: 'actual', asesorCorreo: '', fecha: lunes22 },
      esperado: false },
    { txt: '$20,000 a las 22:00 → revisar (fuera de horario)',
      ctx: { total: 20000, descuentoMax: 5, articulos: 1, formato: 'actual', asesorCorreo: '', fecha: lunes22 },
      esperado: true }
  ];

  casos.forEach(function (caso) {
    const d = revpolEvaluar_(caso.ctx, prueba);
    anota(d.revisar === caso.esperado, caso.txt + '  [' + d.motivo + ']');
  });

  // El interruptor maestro manda sobre cualquier criterio.
  const apagada = revpolNormalizar_({ exigirRevision: false, accionPorDefecto: 'revisar',
    reglas: [{ id: 'z', tipo: 'monto', operador: 'mayor-igual', valor: 1, accion: 'revisar' }] });
  anota(revpolEvaluar_({ total: 999999, descuentoMax: 0, articulos: 1, formato: 'actual',
                         asesorCorreo: '', fecha: lunes10 }, apagada).revisar === false,
        'Con la revisión apagada, ni una cotización de $999,999 pasa a la cola');

  // Normalización defensiva.
  const rara = revpolNormalizar_({ exigirRevision: 'quizá', accionPorDefecto: 'otra-cosa',
    reglas: [{ tipo: 'inventado' }, { tipo: 'monto', operador: 'entre', valor: 900, valor2: 100 }] });
  anota(rara.exigirRevision === true, 'Un valor raro en el interruptor deja la revisión ENCENDIDA');
  anota(rara.accionPorDefecto === 'revisar', 'Una acción por defecto desconocida cae en "revisar"');
  anota(rara.reglas.length === 1, 'Se descarta la regla de tipo desconocido');
  anota(rara.reglas[0].valor === 100 && rara.reglas[0].valor2 === 900,
        'Un rango al revés (900–100) se ordena solo');

  const reporte = lineas.join('\n');
  Logger.log(reporte);
  return reporte;
}
