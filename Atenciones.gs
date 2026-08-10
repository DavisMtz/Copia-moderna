/**
 * =================================================================================================
 * ATENCIONES POSPUESTAS Y PENDIENTES | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Rescate de clientes que se quedaron a medias porque la plataforma falló.
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * Un asesor está atendiendo a alguien por teléfono, Connect se cae y la atención se corta. Hasta
 * ahora ese cliente se perdía en un papel, en la memoria del asesor o en nada. Cuando el sistema
 * volvía —media hora después, o al día siguiente— nadie sabía a quién había que devolver la
 * llamada. La venta no se caía por la falla: se caía porque nadie apuntó el teléfono.
 *
 * Este archivo es la libreta. Se registra al cliente en veinte segundos, mientras sigue en línea,
 * y queda una lista a la que volver cuando el sistema se recupere.
 *
 * PRIVACIDAD, Y POR QUÉ ES LO PRIMERO QUE SE DECIDE
 * -------------------------------------------------
 * Aquí dentro hay nombres, teléfonos y correos de clientes reales. Eso obliga a dos cosas:
 *
 *   1. Por omisión, una atención la ve SOLO quien la registró. No es una lista de contactos
 *      compartida ni un CRM: es la libreta de una persona.
 *
 *   2. Si el asesor quiere, puede decidir que pasado un tiempo se libere al POOL PÚBLICO, para que
 *      cualquier compañero la rescate y termine él la atención. Es una decisión suya, explícita y
 *      tomada al registrar. Si no la toma, ese registro es privado PARA SIEMPRE.
 *
 * La liberación no es un castigo por tardar: es lo que permite que el cliente reciba su llamada
 * aunque quien lo atendió salga de turno, sin obligar a nadie a compartir su cartera.
 *
 * QUÉ SE VE EN EL POOL PÚBLICO
 * ----------------------------
 * Lo justo para poder llamar: nombre, teléfono, tipo y cuánto lleva esperando. Las notas del
 * asesor SÍ viajan —son el contexto de la llamada, sin ellas el rescate es inútil— pero el correo
 * del cliente no: para telefonear no hace falta, y es el dato con el que se arma una lista de
 * distribución. Lo que no se necesita, no se reparte.
 *
 * Todas las funciones llevan el prefijo aten* para no chocar con nada.
 */

// ── FORMA DE LAS HOJAS ───────────────────────────────────────────────────────

const ATEN_HOJA = 'AtencionesPendientes';
const ATEN_COLUMNAS = [
  'ID', 'Fecha', 'Asesor', 'AsesorNombre',
  'Cliente', 'Telefono', 'Correo', 'Tipo', 'Notas', 'HoraPromesa',
  'LiberarEn', 'Estado', 'RescatadaPor', 'RescatadaEn',
  'CerradaPor', 'CerradaEn', 'Resultado'
];

/** Tipos de atención que ha usado el equipo. Se alimenta sola: ver atenTipoRegistrar_. */
const ATEN_HOJA_TIPOS = 'AtencionesTipos';
const ATEN_COLUMNAS_TIPOS = ['Tipo', 'Clave', 'Usos', 'Creado', 'Por'];

/** Bloque de permisos que abre este módulo. */
const ATEN_BLOQUE = 'atenciones';

/** Tipos con los que arranca el sistema. El equipo añade los suyos usándolos. */
const ATEN_TIPOS_BASE = ['Venta', 'Seguimiento', 'Aclaración', 'Otro'];

/** Topes de texto. Una libreta, no un expediente. */
const ATEN_MAX_NOMBRE = 90;
const ATEN_MAX_NOTAS = 600;
const ATEN_MAX_TIPO = 40;
const ATEN_MAX_RESULTADO = 400;

/** Cuántas atenciones cerradas se devuelven al cliente (las abiertas van todas). */
const ATEN_TOPE_CERRADAS = 30;

/**
 * Techo de atenciones abiertas por asesor.
 *
 * No es una regla de negocio: es un tope de seguridad. Este formulario se abre justo después de un
 * reporte de falla, que es el momento de más nervios de la jornada, y sin tope un doble clic
 * repetido o una pestaña que reintenta puede llenar la hoja de duplicados. Cincuenta abiertas a la
 * vez no le pasan a nadie que esté usando esto de verdad.
 */
const ATEN_MAX_ABIERTAS = 50;

/**
 * Opciones de liberación que ofrece la pantalla.
 *
 * DOS FORMAS DE DECIR CUÁNDO, porque son dos preguntas distintas:
 *
 *   RELATIVA ('min')   "dale hora y media y si no, que la tome quien pueda". Se cuenta
 *                      desde el registro. Es lo que sirve cuando lo que importa es no
 *                      hacer esperar al cliente más de un rato.
 *
 *   FIJA ('hora')      "hasta las 17:00". Es lo que sirve de verdad al final del turno:
 *                      quien sale a las cinco no quiere decir "en tres horas" —tendría
 *                      que calcularlo, y el cálculo cambia según a qué hora registre—,
 *                      quiere decir la hora a la que se va. A partir de ahí, si no le dio
 *                      tiempo, que el cliente reciba su llamada de otro compañero.
 *
 * La hora fija se resuelve contra la zona horaria del SCRIPT y no la del navegador: ver
 * atenLiberarEnDesde_. Las horas del turno son las de la operación, no las del reloj del
 * equipo desde el que se registra.
 */
const ATEN_LIBERAR_OPCIONES = [
  { tipo: 'nunca',    min: 0,   nombre: 'Nunca · solo yo la veo' },
  { tipo: 'relativa', min: 30,  nombre: 'A los 30 minutos' },
  { tipo: 'relativa', min: 60,  nombre: 'En 1 hora' },
  { tipo: 'relativa', min: 120, nombre: 'En 2 horas' },
  { tipo: 'relativa', min: 240, nombre: 'En 4 horas' },
  { tipo: 'hora',     hora: '',  nombre: 'A una hora fija del día…' }
];

/** Horas sugeridas de fin de turno, para no obligar a teclear la hora a mano. */
const ATEN_HORAS_SUGERIDAS = ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

// ── UTILIDADES ───────────────────────────────────────────────────────────────

function atenError_(mensaje) {
  return { success: false, message: mensaje || 'No se pudo completar la operación.' };
}

/** Puerta de entrada: sesión válida y bloque concedido. */
function atenGate_(email) {
  return secIdentidadConBloque_(email, ATEN_BLOQUE);
}

function atenId_() {
  return 'AT-' + Utilities.getUuid().split('-')[0].toUpperCase() + '-' + (Date.now() % 100000);
}

/** Quita caracteres de control y recorta. Los saltos de línea se conservan en las notas. */
function atenLimpiar_(texto, tope, conSaltos) {
  var s = String(texto == null ? '' : texto);
  s = conSaltos
    ? s.replace(new RegExp('[\\u0000-\\u0009\\u000b-\\u001f\\u007f]', 'g'), '')
    : s.replace(new RegExp('[\\u0000-\\u001f\\u007f]', 'g'), '');
  return s.trim().slice(0, tope || 200);
}

/**
 * Normaliza un teléfono conservando lo que se puede marcar.
 *
 * NO se valida contra un formato mexicano ni se rechaza lo que no encaje. Este dato se teclea con
 * el cliente esperando en la línea y llega como llega: con espacios, con guiones, con extensión,
 * a veces con el prefijo del país. Rechazar un teléfono "mal escrito" en ese momento es perder al
 * cliente por un guion. Se guarda lo que se pueda marcar y ya.
 */
function atenTelefono_(valor) {
  var s = String(valor == null ? '' : valor).replace(/[^\d+()\-\s.ext]/gi, '').trim();
  return s.slice(0, 40);
}

/** ¿Tiene al menos los dígitos suficientes para ser un teléfono al que llamar? */
function atenTelefonoUtil_(valor) {
  return String(valor || '').replace(/\D/g, '').length >= 7;
}

/**
 * ¿Es una hora del día válida? Devuelve {h, m} o null.
 * Acepta "17:00", "17", "5:30" y "17.30", porque las cuatro se teclean.
 */
function atenParsearHora_(valor) {
  const s = String(valor == null ? '' : valor).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\s*[:.\s]?\s*(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (!(h >= 0 && h <= 23) || !(min >= 0 && min <= 59)) return null;
  return { h: h, m: min };
}

/** Formatea {h, m} como "HH:MM", que es como se guarda y se enseña. */
function atenHoraTexto_(hm) {
  const dos = function (n) { return (n < 10 ? '0' : '') + n; };
  return dos(hm.h) + ':' + dos(hm.m);
}

/**
 * Calcula CUÁNDO se libera una atención.
 *
 * @param {object} d      { liberarMin?, liberarHora? } — lo que mandó el cliente.
 * @param {Date}   base   Momento del registro (o el original, al editar).
 * @return {Date|string}  La fecha de liberación, o '' si es privada para siempre.
 *
 * La hora fija se resuelve contra la ZONA HORARIA DEL SCRIPT. Es lo que hace que "hasta
 * las 17:00" signifique las cinco de la operación y no las cinco del reloj del equipo
 * desde el que se registra: un asesor conectado desde otro huso —o con la zona mal
 * puesta, que pasa más de lo que parece— liberaría su atención con horas de diferencia
 * respecto a lo que él creyó elegir, y el resto del equipo no tendría forma de saberlo.
 *
 * Si la hora elegida YA PASÓ hoy, se entiende que es la de mañana. Registrar a las 17:30
 * algo "hasta las 17:00" solo puede querer decir el turno siguiente; interpretarlo como
 * hoy lo dejaría liberado en el mismo instante de crearlo, que es justo lo contrario de
 * lo que se pidió.
 */
function atenLiberarEnDesde_(d, base) {
  const hm = atenParsearHora_(d && d.liberarHora);
  if (hm) {
    const tz = Session.getScriptTimeZone();

    // Se arma una cadena ISO con el DESFASE HORARIO EXPLÍCITO y se deja que la parsee el
    // motor. Es la única forma de construir "las 17:00 de la zona X" sin ambigüedad: sin
    // el desfase, `new Date('2026-08-10 17:00')` se interpreta en la zona del servidor de
    // Apps Script, que no tiene por qué ser la de la operación, y la atención se liberaba
    // con horas de diferencia respecto a lo que el asesor creyó elegir.
    //
    // El día también sale de `tz` y no de UTC: cerca de medianoche los dos no coinciden y
    // la liberación caería un día entero fuera.
    //
    // El desfase se toma en el instante de `base`, así que respeta el horario de verano
    // vigente ese día. Queda un hueco de una hora los dos días del año en que el horario
    // cambia entre el registro y la liberación; no se compensa a propósito, porque
    // hacerlo bien exige una tabla de transiciones y el error máximo es que una atención
    // se libere una hora antes o después de lo previsto, una vez al año.
    const dia = Utilities.formatDate(base, tz, 'yyyy-MM-dd');
    const desfase = Utilities.formatDate(base, tz, 'Z');            // p. ej. "-0600"
    const iso = dia + 'T' + atenHoraTexto_(hm) + ':00' +
                desfase.slice(0, 3) + ':' + desfase.slice(3);       // "-06:00"

    let objetivo = new Date(iso);
    if (isNaN(objetivo.getTime())) return '';   // no debería pasar; mejor privada que a deshora

    if (objetivo.getTime() <= base.getTime()) {
      objetivo = new Date(objetivo.getTime() + 86400000);   // ya pasó: es la de mañana
    }
    return objetivo;
  }

  const minutos = Math.max(0, Math.min(1440, Number(d && d.liberarMin) || 0));
  return minutos > 0 ? new Date(base.getTime() + minutos * 60000) : '';
}

function atenISO_(valor) {
  if (valor instanceof Date) return valor.toISOString();
  var s = String(valor == null ? '' : valor).trim();
  if (!s) return '';
  var d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function atenMs_(valor) {
  var iso = atenISO_(valor);
  if (!iso) return 0;
  var d = new Date(iso);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// ── HOJAS ────────────────────────────────────────────────────────────────────

function atenHoja_(nombre, columnas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.getRange(1, 1, 1, columnas.length).setValues([columnas]);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, columnas.length).setFontWeight('bold');
  }
  return hoja;
}

/** Índice cabecera → posición, para no depender del orden de las columnas en la hoja. */
function atenIndice_(cabecera) {
  var m = {};
  cabecera.forEach(function (c, i) { m[String(c).trim()] = i; });
  return m;
}

/** Todas las filas como objetos. Una sola lectura de rango. */
function atenLeerHoja_(nombre, columnas) {
  var hoja = atenHoja_(nombre, columnas);
  if (hoja.getLastRow() < 2) return { hoja: hoja, indice: atenIndice_(columnas), filas: [] };
  var datos = hoja.getRange(1, 1, hoja.getLastRow(), Math.max(columnas.length, hoja.getLastColumn()))
                  .getValues();
  var indice = atenIndice_(datos[0]);
  return { hoja: hoja, indice: indice, filas: datos.slice(1) };
}

/** Escribe campos sueltos de una fila ya localizada (1 = primera fila de datos). */
function atenEscribirCeldas_(hoja, indice, filaDatos, campos) {
  Object.keys(campos).forEach(function (col) {
    var c = indice[col];
    if (c === undefined) return;
    hoja.getRange(filaDatos + 1, c + 1).setValue(campos[col]);
  });
}

// ── TIPOS DE ATENCIÓN ────────────────────────────────────────────────────────

function atenClave_(texto) {
  return String(texto == null ? '' : texto).trim().toLowerCase()
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/\s+/g, ' ');
}

/**
 * Tipos disponibles: los base más los que el equipo ha ido usando, ordenados por uso.
 *
 * Se ordena por uso y no alfabéticamente porque este desplegable se abre con un cliente esperando:
 * lo que se usa cada día tiene que estar arriba, no en la letra que le toque.
 */
function atenTipos_() {
  var lectura = atenLeerHoja_(ATEN_HOJA_TIPOS, ATEN_COLUMNAS_TIPOS);
  var i = lectura.indice;
  var vistos = {};
  var lista = [];

  lectura.filas.forEach(function (f) {
    var nombre = String(f[i['Tipo']] || '').trim();
    if (!nombre) return;
    var clave = atenClave_(nombre);
    if (vistos[clave]) return;
    vistos[clave] = true;
    lista.push({ nombre: nombre, clave: clave, usos: Number(f[i['Usos']]) || 0 });
  });

  ATEN_TIPOS_BASE.forEach(function (nombre) {
    var clave = atenClave_(nombre);
    if (vistos[clave]) return;
    vistos[clave] = true;
    lista.push({ nombre: nombre, clave: clave, usos: 0 });
  });

  lista.sort(function (a, b) {
    if (a.usos !== b.usos) return b.usos - a.usos;
    return a.nombre.localeCompare(b.nombre, 'es');
  });
  return lista;
}

/**
 * Apunta el uso de un tipo, creándolo si es nuevo. El catálogo se alimenta solo: nadie tiene que
 * ir a una pantalla de administración a dar de alta "Cambio de domicilio" antes de poder usarlo.
 */
function atenTipoRegistrar_(nombre, quien) {
  var limpio = atenLimpiar_(nombre, ATEN_MAX_TIPO);
  if (!limpio) return '';
  var clave = atenClave_(limpio);

  try {
    var lectura = atenLeerHoja_(ATEN_HOJA_TIPOS, ATEN_COLUMNAS_TIPOS);
    var i = lectura.indice;
    for (var f = 0; f < lectura.filas.length; f++) {
      if (atenClave_(lectura.filas[f][i['Tipo']]) !== clave) continue;
      atenEscribirCeldas_(lectura.hoja, i, f + 1,
        { 'Usos': (Number(lectura.filas[f][i['Usos']]) || 0) + 1 });
      // Se devuelve el nombre TAL COMO SE GUARDÓ la primera vez, no como lo escribió quien
      // teclea ahora: si no, "venta", "Venta" y "VENTA" acabarían siendo tres entradas del
      // desplegable que significan lo mismo.
      return String(lectura.filas[f][i['Tipo']] || limpio);
    }
    lectura.hoja.appendRow([limpio, clave, 1, new Date(), quien || '']);
  } catch (e) {
    Logger.log('atenTipoRegistrar_ error: ' + e);
  }
  return limpio;
}

// ── LECTURA ──────────────────────────────────────────────────────────────────

/** Convierte una fila en el objeto que viaja al cliente. */
function atenDeFila_(f, i) {
  var liberarEn = atenISO_(f[i['LiberarEn']]);
  return {
    id: String(f[i['ID']] || ''),
    fecha: atenISO_(f[i['Fecha']]),
    asesor: String(f[i['Asesor']] || '').toLowerCase(),
    asesorNombre: String(f[i['AsesorNombre']] || ''),
    cliente: String(f[i['Cliente']] || ''),
    telefono: String(f[i['Telefono']] || ''),
    correo: String(f[i['Correo']] || ''),
    tipo: String(f[i['Tipo']] || ''),
    notas: String(f[i['Notas']] || ''),
    horaPromesa: String(f[i['HoraPromesa']] || ''),
    liberarEn: liberarEn,
    estado: String(f[i['Estado']] || 'pendiente').toLowerCase(),
    rescatadaPor: String(f[i['RescatadaPor']] || '').toLowerCase(),
    rescatadaEn: atenISO_(f[i['RescatadaEn']]),
    cerradaPor: String(f[i['CerradaPor']] || '').toLowerCase(),
    cerradaEn: atenISO_(f[i['CerradaEn']]),
    resultado: String(f[i['Resultado']] || '')
  };
}

/** ¿Esta atención ya está liberada al pool público? */
function atenLiberada_(a, ahora) {
  if (!a.liberarEn) return false;             // el asesor eligió "nunca": privada para siempre
  if (a.estado !== 'pendiente') return false;
  return atenMs_(a.liberarEn) <= (ahora || Date.now());
}

/**
 * Versión pública de una atención: lo justo para poder llamar.
 *
 * El correo del cliente NO viaja. Para telefonear no hace falta, y es el dato con el que se arma
 * una lista de distribución; quien rescate la atención y necesite escribirle, lo pedirá en la
 * llamada. Menos datos repartidos es menos superficie que cuidar.
 */
function atenVersionPublica_(a) {
  return {
    id: a.id,
    fecha: a.fecha,
    asesorNombre: a.asesorNombre,
    cliente: a.cliente,
    telefono: a.telefono,
    tipo: a.tipo,
    // Las notas SÍ van: son el contexto de la llamada. Sin ellas, quien rescata marca sin saber
    // de qué hablaba el cliente, y eso no es un rescate, es empezar de cero.
    notas: a.notas,
    horaPromesa: a.horaPromesa,
    liberarEn: a.liberarEn,
    estado: a.estado,
    publica: true
  };
}

/**
 * Todo lo que la pantalla de atenciones necesita, en una llamada.
 *
 * @param {string} email Correo de la sesión.
 */
function atencionesPanorama(email) {
  try {
    var gate = atenGate_(email);
    if (!gate.ok) return atenError_(gate.error);

    var yo = String(gate.email || '').toLowerCase();
    var ahora = Date.now();

    var lectura = atenLeerHoja_(ATEN_HOJA, ATEN_COLUMNAS);
    var i = lectura.indice;

    var mias = [];
    var publicas = [];
    var cerradas = [];

    lectura.filas.forEach(function (f) {
      var a = atenDeFila_(f, i);
      if (!a.id) return;

      var esMia = (a.asesor === yo) || (a.rescatadaPor === yo);

      if (a.estado !== 'pendiente') {
        // Las cerradas solo las ve quien participó: el que la registró o el que la rescató.
        if (esMia) cerradas.push(a);
        return;
      }

      if (esMia) { mias.push(a); return; }

      // De otra persona: solo aparece si está liberada y nadie la ha rescatado todavía.
      if (atenLiberada_(a, ahora) && !a.rescatadaPor) publicas.push(atenVersionPublica_(a));
    });

    // Las propias, la más antigua primero: es a la que más lleva esperando el cliente, y es la
    // que hay que devolver antes. Ordenar por más reciente enterraría justo la más urgente.
    mias.sort(function (a, b) { return atenMs_(a.fecha) - atenMs_(b.fecha); });
    publicas.sort(function (a, b) { return atenMs_(a.fecha) - atenMs_(b.fecha); });
    cerradas.sort(function (a, b) { return atenMs_(b.cerradaEn) - atenMs_(a.cerradaEn); });

    return {
      success: true,
      yo: { email: yo, nombre: gate.nombre || '' },
      mias: mias,
      publicas: publicas,
      cerradas: cerradas.slice(0, ATEN_TOPE_CERRADAS),
      tipos: atenTipos_().map(function (t) { return t.nombre; }),
      opcionesLiberar: ATEN_LIBERAR_OPCIONES.slice(),
      horasSugeridas: ATEN_HORAS_SUGERIDAS.slice(),
      // La zona de la operación viaja para poder rotularla en pantalla: sin ella, quien
      // esté en otro huso no tiene forma de saber que "las 17:00" no son las suyas.
      zonaHoraria: (function () { try { return Session.getScriptTimeZone(); } catch (e) { return ''; } })(),
      ahora: new Date().toISOString()
    };
  } catch (e) {
    Logger.log('atencionesPanorama error: ' + e + ' · ' + e.stack);
    return atenError_('No pudimos leer tus atenciones pendientes. Inténtalo de nuevo en un momento.');
  }
}

// ── REGISTRO ─────────────────────────────────────────────────────────────────

/**
 * Registra una atención pendiente.
 *
 * @param {string} email  Correo de la sesión.
 * @param {object} datos  { cliente, telefono, correo, tipo, notas, horaPromesa, liberarMin }
 *        liberarMin: minutos hasta hacerla pública. 0 o ausente = privada para siempre.
 */
function atencionRegistrar(email, datos) {
  try {
    var gate = atenGate_(email);
    if (!gate.ok) return atenError_(gate.error);

    var d = datos || {};
    var cliente = atenLimpiar_(d.cliente, ATEN_MAX_NOMBRE);
    var telefono = atenTelefono_(d.telefono);

    if (!cliente) return atenError_('Escribe el nombre del cliente.');
    if (!atenTelefonoUtil_(telefono)) {
      return atenError_('Hace falta un teléfono al que devolverle la llamada.');
    }

    // El correo es opcional. Si viene y no tiene forma de correo, se descarta en vez de rechazar
    // el registro entero: el dato importante es el teléfono, y perder la atención por un correo
    // mal tecleado sería exactamente el fallo que este módulo viene a evitar.
    var correo = String(d.correo || '').trim().toLowerCase().slice(0, 120);
    if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) correo = '';

    var yo = String(gate.email || '').toLowerCase();

    var lock = LockService.getScriptLock();
    try { lock.waitLock(15000); } catch (e) {
      return atenError_('El sistema está ocupado. Vuelve a intentarlo.');
    }

    try {
      var lectura = atenLeerHoja_(ATEN_HOJA, ATEN_COLUMNAS);
      var i = lectura.indice;

      var abiertas = 0;
      for (var f = 0; f < lectura.filas.length; f++) {
        var fila = lectura.filas[f];
        if (String(fila[i['Asesor']] || '').toLowerCase() !== yo) continue;
        if (String(fila[i['Estado']] || 'pendiente').toLowerCase() !== 'pendiente') continue;
        abiertas++;
      }
      if (abiertas >= ATEN_MAX_ABIERTAS) {
        return atenError_('Tienes ' + abiertas + ' atenciones abiertas. Cierra algunas antes de registrar más.');
      }

      var tipo = atenTipoRegistrar_(d.tipo || 'Otro', yo);
      var ahora = new Date();
      // Admite las dos formas: `liberarMin` (relativa) o `liberarHora` (fija del día).
      var liberarEn = atenLiberarEnDesde_(d, ahora);

      var id = atenId_();
      var registro = {};
      registro['ID'] = id;
      registro['Fecha'] = ahora;
      registro['Asesor'] = yo;
      registro['AsesorNombre'] = gate.nombre || '';
      registro['Cliente'] = cliente;
      registro['Telefono'] = telefono;
      registro['Correo'] = correo;
      registro['Tipo'] = tipo;
      registro['Notas'] = atenLimpiar_(d.notas, ATEN_MAX_NOTAS, true);
      registro['HoraPromesa'] = atenLimpiar_(d.horaPromesa, 40);
      registro['LiberarEn'] = liberarEn;
      registro['Estado'] = 'pendiente';
      registro['RescatadaPor'] = '';
      registro['RescatadaEn'] = '';
      registro['CerradaPor'] = '';
      registro['CerradaEn'] = '';
      registro['Resultado'] = '';

      // Se arma la fila siguiendo el orden REAL de la cabecera y no el de ATEN_COLUMNAS: si
      // alguien añade una columna a mano en medio de la hoja, los datos siguen cayendo donde
      // toca en vez de desplazarse todos una posición.
      var cabecera = lectura.hoja.getRange(1, 1, 1, lectura.hoja.getLastColumn()).getValues()[0];
      var fila2 = cabecera.map(function (c) {
        var k = String(c).trim();
        return Object.prototype.hasOwnProperty.call(registro, k) ? registro[k] : '';
      });
      lectura.hoja.appendRow(fila2);

      return {
        success: true,
        message: 'Guardado. Tienes los datos de ' + cliente + ' para retomar la atención.',
        atencion: {
          id: id, fecha: ahora.toISOString(), asesor: yo, asesorNombre: gate.nombre || '',
          cliente: cliente, telefono: telefono, correo: correo, tipo: tipo,
          notas: registro['Notas'], horaPromesa: registro['HoraPromesa'],
          liberarEn: liberarEn ? liberarEn.toISOString() : '',
          estado: 'pendiente', rescatadaPor: '', cerradaPor: '', resultado: ''
        }
      };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  } catch (e) {
    Logger.log('atencionRegistrar error: ' + e + ' · ' + e.stack);
    return atenError_('No pudimos guardar la atención. Inténtalo de nuevo.');
  }
}

// ── EDICIÓN Y CIERRE ─────────────────────────────────────────────────────────

/**
 * Localiza una atención por ID.
 * @return {{fila:number, datos:object, hoja:Sheet, indice:object}|null}
 */
function atenBuscar_(id) {
  var objetivo = String(id || '').trim().toUpperCase();
  if (!objetivo) return null;
  var lectura = atenLeerHoja_(ATEN_HOJA, ATEN_COLUMNAS);
  var i = lectura.indice;
  for (var f = 0; f < lectura.filas.length; f++) {
    if (String(lectura.filas[f][i['ID']] || '').trim().toUpperCase() !== objetivo) continue;
    return { fila: f + 1, datos: atenDeFila_(lectura.filas[f], i), hoja: lectura.hoja, indice: i };
  }
  return null;
}

/**
 * ¿Puede esta persona operar sobre esta atención? Devuelve el motivo, o '' si sí.
 *
 * Tres casos legítimos: es suya, la rescató, o está liberada y libre (va a rescatarla ahora). Todo
 * lo demás es alguien pidiendo por ID una atención que no le corresponde, cosa que no se puede
 * impedir en el cliente porque el ID viaja en la propia respuesta.
 */
function atenVeto_(a, yo) {
  if (!a) return 'Esa atención ya no existe.';
  var mio = String(yo || '').toLowerCase();
  if (a.asesor === mio) return '';
  if (a.rescatadaPor === mio) return '';
  if (atenLiberada_(a) && !a.rescatadaPor) return '';
  return 'Esta atención es de otro asesor.';
}

/**
 * Cambia las notas, el tipo, la hora de promesa o la liberación de una atención propia.
 *
 * @param {string} email
 * @param {string} id
 * @param {object} cambios { notas?, tipo?, horaPromesa?, liberarMin? }
 */
function atencionActualizar(email, id, cambios) {
  try {
    var gate = atenGate_(email);
    if (!gate.ok) return atenError_(gate.error);

    var yo = String(gate.email || '').toLowerCase();
    var lock = LockService.getScriptLock();
    try { lock.waitLock(15000); } catch (e) {
      return atenError_('El sistema está ocupado. Vuelve a intentarlo.');
    }

    try {
      var hallado = atenBuscar_(id);
      var veto = atenVeto_(hallado && hallado.datos, yo);
      if (veto) return atenError_(veto);
      if (hallado.datos.estado !== 'pendiente') {
        return atenError_('Esa atención ya está finalizada.');
      }

      var c = cambios || {};
      var campos = {};

      if (c.notas !== undefined) campos['Notas'] = atenLimpiar_(c.notas, ATEN_MAX_NOTAS, true);
      if (c.horaPromesa !== undefined) campos['HoraPromesa'] = atenLimpiar_(c.horaPromesa, 40);
      if (c.tipo !== undefined) campos['Tipo'] = atenTipoRegistrar_(c.tipo, yo);

      // La liberación solo la decide QUIEN LA REGISTRÓ. Quien rescata puede añadir notas —está
      // trabajando la atención— pero no puede volver a soltarla al pool ni retenerla: esa
      // decisión es de quien tiene la relación con el cliente.
      if (c.liberarMin !== undefined || c.liberarHora !== undefined) {
        if (hallado.datos.asesor !== yo) {
          return atenError_('Solo quien registró la atención puede cambiar cuándo se libera.');
        }
        // La RELATIVA se cuenta desde el REGISTRO y no desde ahora: "que se libere en 1
        // hora" significa una hora desde que el cliente se quedó esperando. Contarlo
        // desde el momento de editar permitiría aplazar la liberación indefinidamente a
        // base de retoques, sin querer.
        //
        // La FIJA no tiene ese problema —una hora del día es la misma se calcule cuando
        // se calcule— pero se resuelve contra la misma base para que "las 17:00" de una
        // atención registrada ayer siga siendo la de ayer y no salte a hoy al editarla.
        var base = new Date(atenMs_(hallado.datos.fecha) || Date.now());
        campos['LiberarEn'] = atenLiberarEnDesde_(c, base);
      }

      if (!Object.keys(campos).length) {
        return { success: true, sinCambios: true, message: 'No había nada que cambiar.' };
      }

      atenEscribirCeldas_(hallado.hoja, hallado.indice, hallado.fila, campos);
      return { success: true, message: 'Atención actualizada.' };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  } catch (e) {
    Logger.log('atencionActualizar error: ' + e + ' · ' + e.stack);
    return atenError_('No pudimos actualizar la atención.');
  }
}

/**
 * Toma una atención liberada para atenderla uno mismo.
 *
 * Es una operación de carrera: dos asesores pueden pulsar "Rescatar" a la vez sobre la misma
 * tarjeta, porque los dos la tienen en pantalla. El bloqueo y la relectura DENTRO del bloqueo son
 * lo que impide que los dos llamen al mismo cliente con un minuto de diferencia.
 */
function atencionRescatar(email, id) {
  try {
    var gate = atenGate_(email);
    if (!gate.ok) return atenError_(gate.error);

    var yo = String(gate.email || '').toLowerCase();
    var lock = LockService.getScriptLock();
    try { lock.waitLock(15000); } catch (e) {
      return atenError_('El sistema está ocupado. Vuelve a intentarlo.');
    }

    try {
      var hallado = atenBuscar_(id);
      if (!hallado) return atenError_('Esa atención ya no existe.');
      var a = hallado.datos;

      if (a.asesor === yo) return atenError_('Esta atención ya es tuya.');
      if (a.estado !== 'pendiente') return atenError_('Esa atención ya está finalizada.');
      if (!atenLiberada_(a)) return atenError_('Esa atención todavía no está liberada.');
      if (a.rescatadaPor) {
        return atenError_('Otro asesor la rescató hace un momento. Actualiza la lista.');
      }

      atenEscribirCeldas_(hallado.hoja, hallado.indice, hallado.fila, {
        'RescatadaPor': yo,
        'RescatadaEn': new Date()
      });

      // Se devuelve la ficha COMPLETA, ya con el correo del cliente: a partir de ahora esta
      // atención es suya y necesita todo lo que necesitaría el asesor original.
      a.rescatadaPor = yo;
      a.rescatadaEn = new Date().toISOString();
      return { success: true, message: 'La atención es tuya. Llama a ' + a.cliente + '.', atencion: a };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  } catch (e) {
    Logger.log('atencionRescatar error: ' + e + ' · ' + e.stack);
    return atenError_('No pudimos rescatar la atención.');
  }
}

/**
 * Cierra una atención.
 * @param {string} email
 * @param {string} id
 * @param {string=} resultado  Cómo acabó. Opcional: obligar a escribir aquí haría que la gente
 *        dejara las atenciones abiertas para no rellenar un campo, y una lista sucia no se usa.
 */
function atencionFinalizar(email, id, resultado) {
  try {
    var gate = atenGate_(email);
    if (!gate.ok) return atenError_(gate.error);

    var yo = String(gate.email || '').toLowerCase();
    var lock = LockService.getScriptLock();
    try { lock.waitLock(15000); } catch (e) {
      return atenError_('El sistema está ocupado. Vuelve a intentarlo.');
    }

    try {
      var hallado = atenBuscar_(id);
      var veto = atenVeto_(hallado && hallado.datos, yo);
      if (veto) return atenError_(veto);
      if (hallado.datos.estado !== 'pendiente') {
        return { success: true, sinCambios: true, message: 'Esa atención ya estaba finalizada.' };
      }

      atenEscribirCeldas_(hallado.hoja, hallado.indice, hallado.fila, {
        'Estado': 'finalizada',
        'CerradaPor': yo,
        'CerradaEn': new Date(),
        'Resultado': atenLimpiar_(resultado, ATEN_MAX_RESULTADO, true)
      });

      return { success: true, message: 'Atención finalizada.' };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  } catch (e) {
    Logger.log('atencionFinalizar error: ' + e + ' · ' + e.stack);
    return atenError_('No pudimos finalizar la atención.');
  }
}

// ── RESUMEN (para el inicio y el feed de supervisión) ────────────────────────

/**
 * Dos cifras y la más urgente. Lo usan el inicio del asesor y el feed de supervisión, que quieren
 * saber si hay algo pendiente sin traerse la lista entera.
 */
function atencionesResumen(email) {
  try {
    var gate = atenGate_(email);
    if (!gate.ok) return { success: false, mias: 0, publicas: 0 };

    var yo = String(gate.email || '').toLowerCase();
    var ahora = Date.now();
    var lectura = atenLeerHoja_(ATEN_HOJA, ATEN_COLUMNAS);
    var i = lectura.indice;

    var mias = 0, publicas = 0, masVieja = 0, clienteViejo = '';

    lectura.filas.forEach(function (f) {
      var a = atenDeFila_(f, i);
      if (!a.id || a.estado !== 'pendiente') return;
      if (a.asesor === yo || a.rescatadaPor === yo) {
        mias++;
        var ms = atenMs_(a.fecha);
        if (ms && (!masVieja || ms < masVieja)) { masVieja = ms; clienteViejo = a.cliente; }
      } else if (atenLiberada_(a, ahora) && !a.rescatadaPor) {
        publicas++;
      }
    });

    return {
      success: true, mias: mias, publicas: publicas,
      masVieja: masVieja ? new Date(masVieja).toISOString() : '',
      clienteMasViejo: clienteViejo
    };
  } catch (e) {
    Logger.log('atencionesResumen error: ' + e);
    return { success: false, mias: 0, publicas: 0 };
  }
}

// ── DIAGNÓSTICO ──────────────────────────────────────────────────────────────

/** Radiografía desde el editor. @param {string=} correo */
function atencionesDiagnostico(correo) {
  var objetivo = secNormalizarCorreo_(correo) || secUsuarioGoogle_();
  Logger.log('═══ ATENCIONES ═══');

  var lectura = atenLeerHoja_(ATEN_HOJA, ATEN_COLUMNAS);
  var i = lectura.indice;
  var ahora = Date.now();
  var total = 0, abiertas = 0, liberadas = 0, rescatadas = 0, privadas = 0;

  lectura.filas.forEach(function (f) {
    var a = atenDeFila_(f, i);
    if (!a.id) return;
    total++;
    if (a.estado !== 'pendiente') return;
    abiertas++;
    if (a.rescatadaPor) rescatadas++;
    if (!a.liberarEn) privadas++;
    else if (atenLiberada_(a, ahora)) liberadas++;
  });

  Logger.log('Registradas: ' + total + ' · abiertas: ' + abiertas);
  Logger.log('  privadas para siempre: ' + privadas);
  Logger.log('  liberadas al pool y libres: ' + (liberadas - rescatadas));
  Logger.log('  rescatadas por otro asesor: ' + rescatadas);
  Logger.log('Tipos en uso: ' + atenTipos_().map(function (t) {
    return t.nombre + '(' + t.usos + ')';
  }).join(', '));

  if (objetivo) {
    var r = atencionesResumen(objetivo);
    Logger.log('· ' + objetivo + ' → ' + r.mias + ' propias, ' + r.publicas + ' rescatables');
  }
  return { total: total, abiertas: abiertas };
}
