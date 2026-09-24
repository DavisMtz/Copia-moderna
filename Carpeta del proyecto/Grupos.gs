/**
 * =================================================================================================
 * GRUPOS DE PERSONAS | Sistema de cotizaciones Ventel + Portal Ventel
 * =================================================================================================
 * Fase 9 del plan de cierre (T9.1 y T9.2). Un grupo es una lista de personas con nombre:
 * «Turno matutino», «Coordinación», «Los que atienden Connect». Sirve para dos cosas y ninguna
 * más: copiar sus correos de un clic para pegarlos en Gmail (T9.2) y elegirlo como destinatario
 * de una difusión interna (T9.3, Difusion.gs).
 *
 * UN GRUPO NO DA PERMISOS. Es deliberado y conviene que se lea aquí antes de que a alguien le
 * parezca buena idea: los permisos se conceden por bloque y por persona (Permisos.gs), y añadir
 * una segunda vía —«los del grupo X pueden revisar»— convertiría dos listas en la respuesta a
 * «¿por qué esta persona puede hacer esto?». Un grupo es una lista de correos, y solo eso.
 *
 * DÓNDE VIVE: hoja «Grupos» del libro de cotizaciones, la misma que ya alberga «Registros» y
 * «BitacoraConsola», creada la primera vez que hace falta (mismo patrón que consolaBitacoraHoja_).
 *
 * LAS MEMBRESÍAS VAN EN UNA COLUMNA, NO EN UNA SEGUNDA HOJA. Se consideró la hoja aparte
 * (idGrupo, correo) y se descartó: un grupo es del tamaño de un equipo, cabe de sobra en una
 * celda —el mismo patrón de JSON en celda que ya usa la columna «Permisos» de _PermisosSistema—,
 * y con una sola hoja no existen filas huérfanas que limpiar cuando se borra un grupo ni dos
 * escrituras que puedan quedarse a medias. A cambio, cambiar un miembro reescribe la celda
 * entera; con un lock y listas de decenas de correos, eso no es un problema medible.
 *
 * EL GRUPO «VENTEL» ES VIRTUAL. No tiene fila: se calcula de secIndiceRegistros_ cada vez que se
 * pide. Es la lista que más se va a usar —«mándaselo a todos»— y la única que sería un error
 * mantener a mano: el día que alguien entra al equipo, nadie se acuerda de añadirlo al grupo, y
 * la difusión que importa sale sin él.
 *
 * QUIÉN PUEDE: nivel 2 (supervisor) o superior — permNivelUsuario_, no un bloque. La diferencia
 * importa: el bloque 'sup_equipo' se le puede conceder a un asesor por excepción para que dé de
 * alta a quien entra el lunes, y eso no debería convertirlo en dueño de las listas de correo de
 * toda la empresa. También la LECTURA pide nivel 2, y no solo la edición: un grupo es una lista
 * de destinatarios que se copia y se pega, y una lista recortada por jerarquía —sin la gente por
 * encima de quien mira— es peor que ninguna, porque el correo saldría sin ellos sin que nadie se
 * entere. Por eso el grupo devuelve nombre y correo de sus miembros, pero NUNCA su rol, su nivel
 * ni sus bloques: lo que la regla de jerarquía protege es el mapa de quién manda, no la
 * existencia de un compañero.
 *
 * Funciones expuestas al cliente:
 *   grpListar(email)                    → grupos con sus miembros ya resueltos
 *   grpGuardar(email, datos)            → crear o renombrar
 *   grpEliminar(email, id)              → borrar (el virtual no se puede)
 *   grpFijarMiembros(email, id, correos)→ deja la lista exactamente como se manda (idempotente)
 *
 * Los .gs comparten un solo ámbito global: todo lo de aquí lleva prefijo `grp`.
 */

// ── MODELO ───────────────────────────────────────────────────────────────────

var GRP_SHEET   = 'Grupos';
var GRP_HEADERS = ['ID', 'Nombre', 'Detalle', 'Miembros (JSON)', 'Creado', 'Creado por',
                   'Actualizado', 'Actualizado por'];

/** Identificador del grupo virtual. No es un id que se pueda guardar en la hoja. */
var GRP_VENTEL_ID = 'ventel';

/** Nivel mínimo para ver y tocar grupos. 2 = supervisor (PERM_ROLES.avanzado.nivel). */
var GRP_NIVEL_MINIMO = 2;

/* Topes. Una celda de Sheets aguanta 50 000 caracteres y pasarse no da error: trunca en
   silencio, que es la peor forma de fallar. Con 800 correos de 40 caracteres el JSON ronda
   los 34 000, así que el tope de miembros es el que protege de verdad la celda. */
var GRP_MAX_GRUPOS   = 60;
var GRP_MAX_MIEMBROS = 800;
var GRP_MAX_NOMBRE   = 60;
var GRP_MAX_DETALLE  = 200;

/** Memo de esta ejecución: una misma llamada puede leer los grupos dos veces. */
var GRP_CACHE = null;

/**
 * Quién está activo, resuelto UNA vez por ejecución.
 *
 * `permUsuario_` no toca la hoja —los dos índices que usa están memoizados—, pero sí recompone
 * rol, ajustes y bloques efectivos en cada llamada. Sin este mapa, pintar diez grupos de
 * veinticinco personas sobre una plantilla de doscientas hacía ese trabajo unas cuatrocientas
 * veces por apertura de la consola, y la consola se abre a diario.
 */
var GRP_ACTIVOS_CACHE = null;

function grpActivos_() {
  if (GRP_ACTIVOS_CACHE) return GRP_ACTIVOS_CACHE;
  const mapa = {};
  const indice = secIndiceRegistros_();
  Object.keys(indice).forEach(function (correo) {
    let activo = true;
    try { activo = permUsuario_(correo).activo !== false; } catch (e) {}
    mapa[correo] = activo;
  });
  GRP_ACTIVOS_CACHE = mapa;
  return mapa;
}

// ── UTILIDADES DE HOJA ───────────────────────────────────────────────────────

/** Devuelve la hoja, creándola con sus encabezados la primera vez. */
function grpHoja_(crear) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(GRP_SHEET);
  if (sheet || !crear) return sheet;

  sheet = ss.insertSheet(GRP_SHEET);
  sheet.getRange(1, 1, 1, GRP_HEADERS.length).setValues([GRP_HEADERS]);
  sheet.getRange(1, 1, 1, GRP_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 320);
  sheet.setColumnWidth(4, 460);
  return sheet;
}

/** Columnas por NOMBRE de encabezado, nunca por posición (regla 4 de la casa). */
function grpCols_(hdr) {
  const h = (hdr || []).map(function (x) { return String(x).toLowerCase().trim(); });
  const buscar = function (test) { return h.findIndex(test); };
  return {
    id:        buscar(function (x) { return x === 'id'; }),
    nombre:    buscar(function (x) { return x.indexOf('nombre') === 0; }),
    detalle:   buscar(function (x) { return x.indexOf('detalle') > -1; }),
    miembros:  buscar(function (x) { return x.indexOf('miembro') > -1; }),
    creado:    buscar(function (x) { return x === 'creado'; }),
    creadoPor: buscar(function (x) { return x.indexOf('creado por') > -1; }),
    actualizado:    buscar(function (x) { return x === 'actualizado'; }),
    actualizadoPor: buscar(function (x) { return x.indexOf('actualizado por') > -1; })
  };
}

function grpNuevoId_() {
  return 'grp-' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
}

function grpInvalidarCache_() { GRP_CACHE = null; }

/**
 * Lee la columna de miembros. Tolera basura igual que permParsearAjustes_: si el JSON está
 * roto o alguien escribió los correos a mano separados por comas, se recupera lo que se pueda
 * en vez de dejar el grupo vacío —un grupo vacío se lee como «no hay nadie», y esa es una
 * respuesta falsa que se descubre cuando la difusión no llega a nadie.
 */
function grpParsearMiembros_(texto) {
  const s = String(texto == null ? '' : texto).trim();
  if (!s) return [];
  let lista = null;
  try {
    const obj = JSON.parse(s);
    if (Array.isArray(obj)) lista = obj;
    else if (obj && Array.isArray(obj.miembros)) lista = obj.miembros;
  } catch (e) {
    lista = s.split(/[,;\n]/);
  }
  return grpLimpiarCorreos_(lista || []);
}

/** Correos normalizados, sin repetidos y sin huecos. El orden de llegada se respeta. */
function grpLimpiarCorreos_(lista) {
  const vistos = {};
  const out = [];
  (Array.isArray(lista) ? lista : []).forEach(function (x) {
    const correo = secNormalizarCorreo_(x);
    if (!correo || vistos[correo]) return;
    vistos[correo] = true;
    out.push(correo);
  });
  return out;
}

/** Nombre normalizado para comparar: sin acentos, sin mayúsculas, sin dobles espacios. */
function grpClaveNombre_(nombre) {
  return String(nombre == null ? '' : nombre).trim().toLowerCase()
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/\s+/g, ' ');
}

// ── LECTURA ──────────────────────────────────────────────────────────────────

/** Grupos guardados, tal cual están en la hoja (sin el virtual y sin resolver personas). */
function grpLeerFilas_() {
  if (GRP_CACHE) return GRP_CACHE;

  const out = [];
  try {
    const sheet = grpHoja_(false);
    if (sheet && sheet.getLastRow() >= 2) {
      const ancho = Math.max(sheet.getLastColumn(), GRP_HEADERS.length);
      const datos = sheet.getRange(1, 1, sheet.getLastRow(), ancho).getValues();
      const c = grpCols_(datos.shift());
      if (c.id > -1) {
        datos.forEach(function (f, i) {
          const id = String(f[c.id] || '').trim();
          if (!id) return;
          out.push({
            id: id,
            nombre: c.nombre > -1 ? String(f[c.nombre] || '').trim() : '',
            detalle: c.detalle > -1 ? String(f[c.detalle] || '').trim() : '',
            miembros: c.miembros > -1 ? grpParsearMiembros_(f[c.miembros]) : [],
            creado: (c.creado > -1 && f[c.creado] instanceof Date) ? f[c.creado].toISOString() : '',
            creadoPor: c.creadoPor > -1 ? String(f[c.creadoPor] || '') : '',
            actualizado: (c.actualizado > -1 && f[c.actualizado] instanceof Date) ? f[c.actualizado].toISOString() : '',
            actualizadoPor: c.actualizadoPor > -1 ? String(f[c.actualizadoPor] || '') : '',
            fila: i + 2
          });
        });
      }
    }
  } catch (e) {
    Logger.log('grpLeerFilas_ error: ' + e);
  }

  GRP_CACHE = out;
  return out;
}

/**
 * El grupo «Ventel»: todas las personas dadas de alta y ACTIVAS.
 *
 * Las bajas se quedan fuera a propósito. Un grupo es una lista de destinatarios, y a quien ya
 * no trabaja aquí no se le manda el comunicado del lunes; su fila sigue en «Registros» porque
 * su historial de cotizaciones tiene que seguir cuadrando, que es otra cosa.
 */
function grpVentel_() {
  const activos = grpActivos_();
  const correos = Object.keys(activos).filter(function (correo) { return activos[correo]; });
  return {
    id: GRP_VENTEL_ID,
    virtual: true,
    nombre: 'Ventel',
    detalle: 'Todas las personas dadas de alta y activas. Se mantiene solo: quien entra al equipo aparece aquí sin que nadie lo añada.',
    miembros: correos.sort(),
    creado: '', creadoPor: '', actualizado: '', actualizadoPor: ''
  };
}

/**
 * Resuelve correos a personas para pintarlos. No viaja el rol ni el nivel ni los bloques: ver
 * la cabecera de este archivo.
 *
 * `alta:false` marca a quien está en la lista pero ya no está dado de alta —se fue, o se
 * escribió mal el correo—. Se enseña en vez de esconderse: una lista que adelgaza sola es
 * exactamente lo que hace que nadie confíe en ella.
 */
function grpConPersonas_(correos) {
  const indice = secIndiceRegistros_();
  const activos = grpActivos_();
  return (correos || []).map(function (correo) {
    const fila = indice[correo];
    return {
      email: correo,
      nombre: (fila && fila.nombre) || '',
      alta: !!fila,
      activo: !!fila && activos[correo] !== false
    };
  });
}

/** Un grupo (o el virtual) por su id, ya con las personas resueltas. `null` si no existe. */
function grpPorId_(id) {
  const clave = String(id || '').trim();
  if (!clave) return null;
  if (clave === GRP_VENTEL_ID) return grpVentel_();
  const filas = grpLeerFilas_();
  for (let i = 0; i < filas.length; i++) if (filas[i].id === clave) return filas[i];
  return null;
}

/**
 * Correos a los que se le manda algo a este grupo: los que siguen dados de alta y activos.
 * Es lo que usa la difusión (Difusion.gs); pasa por aquí para que «a quién le llega» se
 * decida en un solo sitio.
 */
function grpCorreosDe_(id) {
  const g = grpPorId_(id);
  if (!g) return [];
  return grpConPersonas_(g.miembros)
    .filter(function (p) { return p.alta && p.activo; })
    .map(function (p) { return p.email; });
}

// ── GATE ─────────────────────────────────────────────────────────────────────

/**
 * Puerta de todas las funciones de este archivo: sesión válida, entrada a la consola por la
 * sección Roles, y NIVEL 2 o superior.
 *
 * @return {{ok:boolean, email:string, nombre:string, usuario:Object, nivel:number, error:string}}
 */
function grpAcceso_(email) {
  const acc = consolaAcceso_(email, 'roles');
  if (!acc.ok) return { ok: false, error: acc.error };
  if (acc.nivel < GRP_NIVEL_MINIMO) {
    return { ok: false, email: acc.email, nombre: acc.nombre,
             error: 'Los grupos los administra el nivel de supervisión hacia arriba. Tu cuenta gestiona ' +
                    'accesos, pero no las listas de correo del equipo.' };
  }
  return acc;
}

// ── FUNCIONES EXPUESTAS ──────────────────────────────────────────────────────

/** Lista de grupos con sus miembros resueltos. El virtual va siempre primero. */
function grpListar(email) {
  try {
    const acc = grpAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    const salida = [grpVentel_()].concat(grpLeerFilas_()).map(function (g) {
      const personas = grpConPersonas_(g.miembros);
      return {
        id: g.id,
        virtual: g.virtual === true,
        nombre: g.nombre,
        detalle: g.detalle,
        miembros: personas,
        total: personas.length,
        // Cuántos recibirían de verdad una difusión. Cuando no coincide con el total, la
        // pantalla lo dice: «14 personas · 13 reciben correo» explica por qué el envío
        // reporta un número más bajo que la lista.
        alcanzables: personas.filter(function (p) { return p.alta && p.activo; }).length,
        actualizado: g.actualizado,
        actualizadoPor: g.actualizadoPor
      };
    });

    return { success: true, grupos: salida, puedeEditar: true };
  } catch (e) {
    Logger.log('grpListar error: ' + e);
    return { success: false, message: 'No pudimos leer los grupos. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * Crea un grupo o cambia su nombre y su descripción. Los miembros van por su propia función:
 * renombrar y repoblar son dos gestos distintos y mezclarlos hace que un guardado a medias
 * deje el grupo con el nombre nuevo y la gente vieja.
 *
 * @param {{id:string=, nombre:string, detalle:string=}} datos
 */
function grpGuardar(email, datos) {
  try {
    const acc = grpAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    datos = datos || {};
    const nombre = String(datos.nombre == null ? '' : datos.nombre).trim().replace(/\s+/g, ' ');
    const detalle = String(datos.detalle == null ? '' : datos.detalle).trim().slice(0, GRP_MAX_DETALLE);
    const id = String(datos.id == null ? '' : datos.id).trim();

    if (nombre.length < 2) return { success: false, message: 'El grupo necesita un nombre de al menos dos letras.' };
    if (nombre.length > GRP_MAX_NOMBRE) {
      return { success: false, message: 'El nombre no puede pasar de ' + GRP_MAX_NOMBRE + ' caracteres.' };
    }
    if (id === GRP_VENTEL_ID) {
      return { success: false, message: '«Ventel» se mantiene solo: es todo el equipo y no se edita.' };
    }
    if (grpClaveNombre_(nombre) === grpClaveNombre_('Ventel')) {
      return { success: false, message: 'Ese nombre ya lo usa el grupo de todo el equipo.' };
    }

    /* El candado protege la ESCRITURA y nada más. Componer la respuesta —que vuelve a leer y a
       resolver a toda la gente— dentro del `try` la dejaba dentro del candado, porque el
       `finally` se ejecuta después de evaluar el `return`: dos personas guardando a la vez se
       esperaban la una a la otra por un trabajo que no tocaba la hoja. */
    let resultado = null;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      return { success: false, message: 'Hay otro cambio en curso. Inténtalo en un momento.' };
    }
    try {
      grpInvalidarCache_();
      const filas = grpLeerFilas_();

      // Nombre único, comparado sin acentos ni mayúsculas: dos grupos «Coordinación» y
      // «coordinacion» en la misma lista son una trampa para quien va a elegir destinatario.
      const choque = filas.filter(function (g) {
        return g.id !== id && grpClaveNombre_(g.nombre) === grpClaveNombre_(nombre);
      })[0];
      if (choque) return { success: false, message: 'Ya hay un grupo que se llama «' + choque.nombre + '».' };

      const sheet = grpHoja_(true);
      const ancho = Math.max(sheet.getLastColumn(), GRP_HEADERS.length);
      const c = grpCols_(sheet.getRange(1, 1, 1, ancho).getValues()[0]);
      const ahora = new Date();
      const quien = acc.nombre || acc.email;
      const previo = id ? filas.filter(function (g) { return g.id === id; })[0] : null;

      if (id && !previo) return { success: false, message: 'Ese grupo ya no existe. Actualiza la pantalla.' };

      if (previo) {
        // Celda a celda, solo en las columnas que este módulo maneja (regla 5 de la casa).
        if (c.nombre > -1)         sheet.getRange(previo.fila, c.nombre + 1).setValue(nombre);
        if (c.detalle > -1)        sheet.getRange(previo.fila, c.detalle + 1).setValue(detalle);
        if (c.actualizado > -1)    sheet.getRange(previo.fila, c.actualizado + 1).setValue(ahora);
        if (c.actualizadoPor > -1) sheet.getRange(previo.fila, c.actualizadoPor + 1).setValue(quien);
        SpreadsheetApp.flush();
        grpInvalidarCache_();
        consolaBitacoraApuntar_(acc.email, 'Grupo editado', nombre,
          previo.nombre !== nombre ? ('antes «' + previo.nombre + '»') : 'descripción');
        resultado = { success: true, message: 'Grupo «' + nombre + '» guardado.', id: id };
      } else if (filas.length >= GRP_MAX_GRUPOS) {
        return { success: false, message: 'Ya hay ' + GRP_MAX_GRUPOS + ' grupos. Borra alguno antes de crear otro.' };
      } else {

        const nuevoId = grpNuevoId_();
        const fila = [];
        for (let i = 0; i < ancho; i++) fila[i] = '';
        fila[c.id] = nuevoId;
        if (c.nombre > -1)         fila[c.nombre] = nombre;
        if (c.detalle > -1)        fila[c.detalle] = detalle;
        if (c.miembros > -1)       fila[c.miembros] = '[]';
        if (c.creado > -1)         fila[c.creado] = ahora;
        if (c.creadoPor > -1)      fila[c.creadoPor] = quien;
        if (c.actualizado > -1)    fila[c.actualizado] = ahora;
        if (c.actualizadoPor > -1) fila[c.actualizadoPor] = quien;
        sheet.appendRow(fila);
        SpreadsheetApp.flush();
        grpInvalidarCache_();

        consolaBitacoraApuntar_(acc.email, 'Grupo creado', nombre, detalle || 'sin descripción');
        resultado = { success: true, message: 'Grupo «' + nombre + '» creado.', id: nuevoId };
      }
    } finally {
      lock.releaseLock();
    }

    // Ya sin candado: la lista de vuelta, para que la pantalla repinte sin un segundo viaje.
    resultado.grupos = grpListar(email).grupos || [];
    return resultado;
  } catch (e) {
    Logger.log('grpGuardar error: ' + e);
    return { success: false, message: 'No pudimos guardar el grupo. Inténtalo de nuevo en un momento.' };
  }
}

/** Borra un grupo. El virtual no se puede borrar: no existe como fila. */
function grpEliminar(email, id) {
  try {
    const acc = grpAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    const clave = String(id || '').trim();
    if (clave === GRP_VENTEL_ID) {
      return { success: false, message: '«Ventel» no se puede borrar: es la lista de todo el equipo y se calcula sola.' };
    }

    let resultado = null;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      return { success: false, message: 'Hay otro cambio en curso. Inténtalo en un momento.' };
    }
    try {
      grpInvalidarCache_();
      const previo = grpLeerFilas_().filter(function (g) { return g.id === clave; })[0];
      if (!previo) return { success: false, message: 'Ese grupo ya no existe. Actualiza la pantalla.' };

      grpHoja_(true).deleteRow(previo.fila);
      SpreadsheetApp.flush();
      grpInvalidarCache_();

      consolaBitacoraApuntar_(acc.email, 'Grupo borrado', previo.nombre,
        previo.miembros.length + ' persona(s) en la lista');
      resultado = { success: true, message: 'Grupo «' + previo.nombre + '» borrado.' };
    } finally {
      lock.releaseLock();
    }

    resultado.grupos = grpListar(email).grupos || [];
    return resultado;
  } catch (e) {
    Logger.log('grpEliminar error: ' + e);
    return { success: false, message: 'No pudimos borrar el grupo. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * Fija los miembros de un grupo. Idempotente: repetir la misma llamada deja lo mismo, que es lo
 * que permite reintentarla sin miedo a duplicar a nadie.
 *
 * SE FUSIONA, NO SE PISA. El cliente manda la lista que él ve (`correos`) y, si puede, la lista
 * que veía ANTES de tocar nada (`base`). Con las dos, el servidor aplica solo la diferencia
 * —quién entra y quién sale— sobre lo que hay ahora mismo en la hoja. Sin esto, dos personas
 * con la consola abierta se pisaban: la segunda en guardar mandaba su copia entera y borraba, sin
 * enterarse, a quien la primera acababa de añadir. Con la base, cada una hace su cambio y los dos
 * quedan. Sin `base` —una llamada vieja o hecha a mano— se conserva el comportamiento de fijar
 * la lista tal cual.
 *
 * Los correos que no estén dados de alta se descartan y se dicen: añadir a alguien que no
 * existe deja un grupo que promete un destinatario que nunca va a recibir nada.
 *
 * @param {Array<string>=} base  la lista que el cliente tenía antes de editar.
 */
function grpFijarMiembros(email, id, correos, base) {
  try {
    const acc = grpAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    const clave = String(id || '').trim();
    if (clave === GRP_VENTEL_ID) {
      return { success: false, message: '«Ventel» se calcula solo: para sacar a alguien, dale de baja en Roles.' };
    }

    const pedidos = grpLimpiarCorreos_(correos);
    if (pedidos.length > GRP_MAX_MIEMBROS) {
      return { success: false, message: 'Un grupo no puede pasar de ' + GRP_MAX_MIEMBROS + ' personas.' };
    }

    const indice = secIndiceRegistros_();
    const buenos = pedidos.filter(function (c) { return !!indice[c]; });
    const fuera  = pedidos.filter(function (c) { return !indice[c]; });

    let resultado = null;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      return { success: false, message: 'Hay otro cambio en curso. Inténtalo en un momento.' };
    }
    try {
      grpInvalidarCache_();
      const previo = grpLeerFilas_().filter(function (g) { return g.id === clave; })[0];
      if (!previo) return { success: false, message: 'Ese grupo ya no existe. Actualiza la pantalla.' };

      const sheet = grpHoja_(true);
      const ancho = Math.max(sheet.getLastColumn(), GRP_HEADERS.length);
      const c = grpCols_(sheet.getRange(1, 1, 1, ancho).getValues()[0]);
      const ahora = new Date();
      const quien = acc.nombre || acc.email;

      /* Fusión con lo que hay AHORA en la hoja (ver la cabecera de la función). Solo se aplican
         las diferencias respecto de lo que el cliente tenía delante. */
      const previa = grpLimpiarCorreos_(base);
      let finales = buenos;
      if (previa.length || (base && base.length === 0)) {
        const entran = buenos.filter(function (x) { return previa.indexOf(x) === -1; });
        const salen  = previa.filter(function (x) { return buenos.indexOf(x) === -1; });
        finales = previo.miembros
          .filter(function (x) { return salen.indexOf(x) === -1; })
          .concat(entran.filter(function (x) { return previo.miembros.indexOf(x) === -1; }));
      }

      /* Veto jerárquico en las ALTAS, no en la lista entera (criterio 1 de la fase).
         Un supervisor no puede meter en un grupo a alguien por encima de su nivel —no debería
         ni saber quién es—, pero tampoco puede EXPULSARLO sin querer: por eso se filtra lo que
         entra y se respeta lo que ya estaba. La maestra no tiene veto. */
      let vetados = [];
      if (!acc.maestro) {
        const miNivel = acc.nivel;
        vetados = finales.filter(function (x) {
          if (previo.miembros.indexOf(x) !== -1) return false;   // ya estaba: no es un alta
          let nivel = 1;
          try { nivel = permNivelUsuario_(permUsuario_(x)); } catch (e) {}
          return nivel > miNivel;
        });
        if (vetados.length) {
          finales = finales.filter(function (x) { return vetados.indexOf(x) === -1; });
        }
      }

      if (finales.length > GRP_MAX_MIEMBROS) {
        return { success: false, message: 'Un grupo no puede pasar de ' + GRP_MAX_MIEMBROS + ' personas.' };
      }

      const buenosFinal = finales;
      if (c.miembros > -1)       sheet.getRange(previo.fila, c.miembros + 1).setValue(JSON.stringify(buenosFinal));
      if (c.actualizado > -1)    sheet.getRange(previo.fila, c.actualizado + 1).setValue(ahora);
      if (c.actualizadoPor > -1) sheet.getRange(previo.fila, c.actualizadoPor + 1).setValue(quien);
      SpreadsheetApp.flush();
      grpInvalidarCache_();

      const nEntran = buenosFinal.filter(function (x) { return previo.miembros.indexOf(x) === -1; }).length;
      const nSalen  = previo.miembros.filter(function (x) { return buenosFinal.indexOf(x) === -1; }).length;
      consolaBitacoraApuntar_(acc.email, 'Miembros de grupo', previo.nombre,
        'quedan ' + buenosFinal.length + (nEntran ? ' · +' + nEntran : '') + (nSalen ? ' · −' + nSalen : ''));

      const avisos = [];
      if (fuera.length) avisos.push('No se añadieron porque no están dados de alta: ' + fuera.join(', '));
      if (vetados.length) avisos.push('No se añadieron porque están por encima de tu nivel: ' + vetados.join(', '));

      resultado = {
        success: true,
        message: 'Grupo «' + previo.nombre + '»: ' + buenosFinal.length + ' persona(s).',
        aviso: avisos.join(' · ')
      };
    } finally {
      lock.releaseLock();
    }

    resultado.grupos = grpListar(email).grupos || [];
    return resultado;
  } catch (e) {
    Logger.log('grpFijarMiembros error: ' + e);
    return { success: false, message: 'No pudimos guardar los miembros. Inténtalo de nuevo en un momento.' };
  }
}

// ── DIAGNÓSTICO (desde el editor) ────────────────────────────────────────────

/** Qué grupos hay y a cuánta gente alcanzan. Ejecutar desde el editor de Apps Script. */
function grpDiagnostico() {
  secSoloInterno_('grpDiagnostico');
  Logger.log('═══ GRUPOS ═══');
  const ventel = grpVentel_();
  Logger.log('Ventel (virtual): ' + ventel.miembros.length + ' persona(s) activas.');
  const filas = grpLeerFilas_();
  if (!filas.length) {
    Logger.log('No hay grupos creados todavía.');
    return { ventel: ventel.miembros.length, grupos: 0 };
  }
  filas.forEach(function (g) {
    Logger.log('  · ' + g.nombre + ' → ' + g.miembros.length + ' miembro(s), alcanzables ' +
               grpCorreosDe_(g.id).length);
  });
  return { ventel: ventel.miembros.length, grupos: filas.length };
}
