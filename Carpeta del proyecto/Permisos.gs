/**
 * =================================================================================================
 * PERMISOS POR BLOQUES | Sistema de cotizaciones Ventel + Portal Ventel
 * =================================================================================================
 * Hasta aquí el sistema tenía UN solo interruptor: la columna "Avanzado" de la hoja
 * "Registros". Con ella se decidía todo —ver el panel de supervisión, editar la política
 * de revisión, entrar al constructor de anuncios—, así que dar acceso a una cosa
 * significaba darlo a todas. Este archivo parte ese interruptor en BLOQUES.
 *
 * TRES PIEZAS:
 *
 *   1. BLOQUE   Una capacidad concreta de la app ("crear cotizaciones", "revisar",
 *               "gestionar miembros"). Es la unidad mínima que se concede o se quita.
 *
 *   2. ROL      Un paquete de bloques. Hay tres, de menor a mayor:
 *                 normal    → trabajo diario del asesor.
 *                 avanzado  → lo anterior + supervisión, revisión y anuncios.
 *                 maestro   → TODO, incluida la consola de administración. Es el único
 *                             rol que puede cambiar roles y permisos, así que hay que
 *                             repartirlo con cuentagotas.
 *
 *   3. AJUSTE   Concesiones y retiros por persona, encima del rol. Un asesor normal al
 *               que se le deja revisar no necesita que lo suban a avanzado; a un avanzado
 *               se le puede quitar el constructor de anuncios sin bajarlo de rol.
 *
 * DÓNDE VIVE TODO: en una hoja OCULTA propia, "_PermisosSistema", que este archivo
 * crea la primera vez que hace falta:
 *
 *   Email       a quién corresponde la fila
 *   Rol         'normal' | 'avanzado' | 'maestro'   (si está vacío, manda "Avanzado")
 *   Permisos    JSON {"mas":["revisar"],"menos":["anuncios"]}  (vacío = solo el rol)
 *   Activo      'Si' | 'No'  — dar de baja a alguien sin borrar su historial
 *   Actualizado / Por   rastro del último cambio
 *
 * NO va en "Registros" a propósito. Esa hoja es la lista de MIEMBROS y la edita gente:
 * tiene validaciones de datos, formatos y columnas que ya significan otra cosa. Meter
 * ahí la configuración del sistema producía choques silenciosos —una columna "Rol" con
 * el puesto de cada quien, una validación que rechaza `Sí` con acento— y ninguno de
 * esos choques se nota hasta que alguien se queda sin sus permisos.
 *
 * RETROCOMPATIBILIDAD: mientras alguien no tenga fila en la hoja de permisos, manda la
 * columna "Avanzado" de "Registros" exactamente como antes. Así el sistema no cambia de
 * comportamiento el día que se sube este archivo: cambia cuando se usa la consola.
 *
 * ORDEN EN QUE SE DECIDE (de menos a más fuerte; lo último gana):
 *   bloques del rol  →  + los de "mas"  →  − los de "menos"  →  − los módulos apagados
 *
 * El maestro se salta el apagado de módulos: si un módulo se apaga por mantenimiento y
 * eso también dejara fuera al maestro, nadie podría volver a encenderlo.
 *
 * Todas las funciones llevan el prefijo perm* para no chocar con nada.
 */

// ── CATÁLOGO DE BLOQUES ──────────────────────────────────────────────────────
// El orden de este arreglo es el orden en que se pintan en la consola.
//   id        clave interna; es lo que se guarda en "Permisos". NUNCA se renombra.
//   nombre    cómo se llama en pantalla.
//   detalle   qué deja hacer exactamente, en cristiano.
//   grupo     encabezado bajo el que se agrupa en la matriz de permisos.
//   pagina    pantalla que abre (clave de PAGES en Code.gs), '' si no abre ninguna.
//   admin     true = es parte de la Consola; solo el rol maestro los alcanza.
//   fijo      true = no se puede apagar por mantenimiento (o la app queda sin salida).

const PERM_BLOQUES = [
  // ── Portal ────────────────────────────────────────────────────────────────
  { id: 'portal',            nombre: 'Portal Ventel',            grupo: 'Portal',
    detalle: 'Entrar al portal de información y procesos.',
    pagina: 'portal',              admin: false, fijo: true },
  { id: 'promociones',       nombre: 'Monitor de promociones',   grupo: 'Portal',
    detalle: 'Ver el calendario comercial y las promociones vigentes.',
    pagina: 'promociones',         admin: false, fijo: false },

  // ── Cotizaciones ──────────────────────────────────────────────────────────
  { id: 'cotizar',           nombre: 'Crear cotizaciones',       grupo: 'Cotizaciones',
    detalle: 'Armar una cotización nueva y generar su documento.',
    pagina: 'cotizacion',          admin: false, fijo: false },
  { id: 'consultar',         nombre: 'Consultar cotizaciones',   grupo: 'Cotizaciones',
    detalle: 'Buscar folios y abrir el detalle de una cotización.',
    pagina: 'consulta_cotizacion', admin: false, fijo: false },
  { id: 'enviar_cotizacion', nombre: 'Enviar cotizaciones',      grupo: 'Cotizaciones',
    detalle: 'Mandar la cotización al cliente por correo.',
    pagina: 'correoventel',        admin: false, fijo: false },
  { id: 'correos_cliente',   nombre: 'Correos a clientes',       grupo: 'Cotizaciones',
    detalle: 'Usar las plantillas de correo y enviarlas a clientes.',
    pagina: 'correo_cliente',      admin: false, fijo: false },
  // Rescate de atenciones. Va con el trabajo diario del asesor y no con supervisión:
  // quien registra al cliente que se quedó esperando es quien lo tenía en la línea.
  { id: 'atenciones',        nombre: 'Atenciones pendientes',    grupo: 'Cotizaciones',
    detalle: 'Guardar los datos de un cliente cuando la plataforma falla y retomar la atención después.',
    pagina: 'atenciones',          admin: false, fijo: false },

  // ── Supervisión ───────────────────────────────────────────────────────────
  { id: 'supervision',       nombre: 'Panel de supervisión',     grupo: 'Supervisión',
    detalle: 'Ver métricas del equipo, actividad y ranking de asesores.',
    pagina: 'inicio_avanzado',     admin: false, fijo: false },
  { id: 'revisar',           nombre: 'Revisar cotizaciones',     grupo: 'Supervisión',
    detalle: 'Aprobar o rechazar las cotizaciones que caen a revisión.',
    pagina: 'revision_cotizacion', admin: false, fijo: false },
  { id: 'politica_revision', nombre: 'Política de revisión',     grupo: 'Supervisión',
    detalle: 'Cambiar las reglas que mandan una cotización a revisión.',
    pagina: '',                    admin: false, fijo: false },
  { id: 'trazabilidad',      nombre: 'Trazabilidad',             grupo: 'Supervisión',
    detalle: 'Consultar el rastro de cambios de las cotizaciones.',
    pagina: '',                    admin: false, fijo: false },
  { id: 'anuncios',          nombre: 'Anuncios del Portal',      grupo: 'Supervisión',
    detalle: 'Publicar y retirar los anuncios que ve todo el equipo.',
    pagina: 'anuncios',            admin: false, fijo: false },
  { id: 'portal_contenido',  nombre: 'Contenido del Portal',     grupo: 'Supervisión',
    detalle: 'Editar herramientas, plantillas, formatos y promociones del Portal.',
    pagina: 'portal_contenido',    admin: false, fijo: false },
  // REPORTAR una falla no necesita bloque: lo puede hacer cualquiera con sesión, y ponerle
  // permiso sería tanto como pedir autorización para avisar de que algo no funciona. Este
  // bloque es solo para el otro lado del mostrador: decidir qué se le dice al equipo.
  { id: 'operacion',         nombre: 'Estado de operación',      grupo: 'Supervisión',
    detalle: 'Confirmar, descartar y actualizar las fallas que reporta el equipo.',
    pagina: 'operacion',           admin: false, fijo: false },
  // Gestión de roles SIN ser maestro. Da entrada a la Consola —solo a Roles y
  // Bitácora— y deja gestionar a quien esté en el MISMO nivel o por debajo: ver
  // permVetoJerarquia_ más abajo, que es donde vive esa regla para toda la app.
  // Es lo que permite que una coordinación dé de alta a quien entra el lunes o dé de
  // baja a quien se fue el viernes sin despertar a un maestro, que era el motivo real
  // por el que circulaban cuentas maestras de más.
  { id: 'sup_equipo',        nombre: 'Roles y accesos',          grupo: 'Supervisión',
    detalle: 'Entrar a la Consola para dar de alta personas y cambiar su rol y sus accesos. Solo alcanza a quien esté en tu mismo nivel o por debajo, nunca a tu propia cuenta.',
    pagina: 'consola',             admin: false, fijo: false },

  // ── Administración (solo maestros) ───────────────────────────────────────
  { id: 'adm_miembros',      nombre: 'Miembros',                 grupo: 'Administración',
    detalle: 'Dar de alta, dar de baja y cambiar el rol de las personas.',
    pagina: '',                    admin: true,  fijo: true },
  { id: 'adm_permisos',      nombre: 'Permisos por bloque',      grupo: 'Administración',
    detalle: 'Conceder o retirar bloques persona por persona.',
    pagina: '',                    admin: true,  fijo: true },
  { id: 'adm_ajustes',       nombre: 'Ajustes del sistema',      grupo: 'Administración',
    detalle: 'Modo de autenticación, dominio, webhook e identificadores de hojas.',
    pagina: '',                    admin: true,  fijo: true },
  { id: 'adm_modulos',       nombre: 'Módulos',                  grupo: 'Administración',
    detalle: 'Apagar y encender bloques enteros por mantenimiento.',
    pagina: '',                    admin: true,  fijo: true },
  { id: 'adm_formatos',      nombre: 'Formatos de cotización',   grupo: 'Administración',
    detalle: 'Habilitar formatos y elegir el predeterminado.',
    pagina: '',                    admin: true,  fijo: true },
  { id: 'adm_salud',         nombre: 'Salud del sistema',        grupo: 'Administración',
    detalle: 'Correr la revisión maestra y ver qué está roto.',
    pagina: '',                    admin: true,  fijo: true },
  { id: 'adm_bitacora',      nombre: 'Bitácora',                 grupo: 'Administración',
    detalle: 'Leer quién cambió qué en la consola y cuándo.',
    pagina: '',                    admin: true,  fijo: true }
];

/** Orden de los grupos en la matriz de permisos. */
const PERM_GRUPOS = ['Portal', 'Cotizaciones', 'Supervisión', 'Administración'];

/** Todos los identificadores de bloque, para validar lo que llega del cliente. */
const PERM_IDS = PERM_BLOQUES.map(function (b) { return b.id; });

/** Bloques de administración: el rol maestro es el único que los alcanza. */
const PERM_IDS_ADMIN = PERM_BLOQUES.filter(function (b) { return b.admin; })
                                   .map(function (b) { return b.id; });

/** Bloques que NO son de administración. */
const PERM_IDS_APP = PERM_BLOQUES.filter(function (b) { return !b.admin; })
                                 .map(function (b) { return b.id; });

// ── ROLES ────────────────────────────────────────────────────────────────────
// 'normal' es lo que recibe cualquier alta nueva. 'avanzado' es lo que hoy da la
// columna "Avanzado" = Sí, ni un bloque más ni uno menos, para que nadie gane ni
// pierda accesos el día que se sube este archivo.

// NIVEL: es lo mismo que `orden`, con otro nombre porque significa otra cosa. `orden`
// dice en qué posición se pinta el rol en una lista; `nivel` decide a QUIÉN alcanza
// cada quien. Se guardan como dos campos —aunque hoy valgan igual— porque el día que
// se quiera insertar un rol intermedio en la lista sin moverlo de jerarquía, o al
// revés, tocar un campo no debe cambiar en silencio el otro: uno es presentación y el
// otro es una regla de seguridad.
const PERM_ROLES = {
  normal: {
    id: 'normal',
    nombre: 'Asesor',
    detalle: 'Cotiza, consulta y envía. Es el rol de cualquier alta nueva.',
    orden: 1,
    nivel: 1,
    bloques: ['portal', 'promociones', 'cotizar', 'consultar', 'enviar_cotizacion', 'correos_cliente',
              'atenciones']
  },
  avanzado: {
    id: 'avanzado',
    nombre: 'Supervisor',
    detalle: 'Todo lo del asesor, más métricas, revisión de cotizaciones, el contenido del Portal, el estado de operación y la gestión de roles de su nivel hacia abajo desde la Consola.',
    orden: 2,
    nivel: 2,
    bloques: ['portal', 'promociones', 'cotizar', 'consultar', 'enviar_cotizacion', 'correos_cliente',
              'atenciones',
              'supervision', 'revisar', 'politica_revision', 'trazabilidad', 'anuncios', 'portal_contenido',
              'operacion', 'sup_equipo']
  },
  maestro: {
    id: 'maestro',
    nombre: 'Maestro',
    detalle: 'Control total del sistema: personas, permisos, ajustes y módulos.',
    orden: 3,
    nivel: 3,
    // Se calcula abajo para que nunca se quede corto al añadir un bloque nuevo.
    bloques: PERM_IDS.slice()
  }
};

/** Roles en el orden en que se ofrecen en la consola (de menor a mayor poder). */
const PERM_ROLES_ORDEN = ['normal', 'avanzado', 'maestro'];

/** Propiedad de script donde viven los módulos apagados por mantenimiento. */
const PERM_PROP_MODULOS = 'PERM_MODULOS_OFF';

// ── LECTURA DEL MODELO ───────────────────────────────────────────────────────

/**
 * Normaliza el valor de la columna "Rol". Cualquier cosa que no reconozca cae a ''
 * para que el llamador sepa que tiene que mirar la columna "Avanzado".
 * @return {string} 'normal' | 'avanzado' | 'maestro' | ''
 */
function permNormalizarRol_(valor) {
  const s = String(valor == null ? '' : valor).trim().toLowerCase()
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
  if (s === 'maestro' || s === 'master' || s === 'admin' || s === 'administrador') return 'maestro';
  if (s === 'avanzado' || s === 'supervisor') return 'avanzado';
  if (s === 'normal' || s === 'asesor' || s === 'basico') return 'normal';
  return '';
}

/**
 * Rol efectivo de una fila de "Registros". Mientras la columna "Rol" esté vacía
 * manda la columna "Avanzado" de siempre.
 */
function permRolDeFila_(valorRol, avanzado) {
  return permNormalizarRol_(valorRol) || (avanzado ? 'avanzado' : 'normal');
}

/**
 * Lee la columna "Permisos". Tolera basura: si el JSON está roto o alguien escribió
 * a mano en la celda, se ignora en vez de dejar a la persona sin entrar.
 * @return {{mas:string[], menos:string[]}}
 */
function permParsearAjustes_(texto) {
  const vacio = { mas: [], menos: [] };
  const s = String(texto == null ? '' : texto).trim();
  if (!s) return vacio;
  let obj;
  try {
    obj = JSON.parse(s);
  } catch (e) {
    // Formato de rescate: "mas:revisar,anuncios | menos:cotizar" escrito a mano.
    try {
      const out = { mas: [], menos: [] };
      s.split('|').forEach(function (parte) {
        const trozos = parte.split(':');
        if (trozos.length < 2) return;
        const llave = trozos[0].trim().toLowerCase();
        const lista = trozos[1].split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        if (llave === 'mas' || llave === 'más') out.mas = lista;
        if (llave === 'menos') out.menos = lista;
      });
      return permLimpiarAjustes_(out);
    } catch (e2) {
      return vacio;
    }
  }
  if (!obj || typeof obj !== 'object') return vacio;
  return permLimpiarAjustes_(obj);
}

/** Deja solo identificadores de bloque que existen y sin repetidos. */
function permLimpiarAjustes_(obj) {
  const filtrar = function (lista) {
    const vistos = {};
    return (Array.isArray(lista) ? lista : []).map(function (x) {
      return String(x || '').trim();
    }).filter(function (id) {
      if (!id || PERM_IDS.indexOf(id) === -1 || vistos[id]) return false;
      vistos[id] = true;
      return true;
    });
  };
  return { mas: filtrar(obj.mas), menos: filtrar(obj.menos) };
}

/** Serializa los ajustes para la celda. Devuelve '' cuando no hay nada que guardar. */
function permSerializarAjustes_(ajustes) {
  const limpio = permLimpiarAjustes_(ajustes || {});
  if (!limpio.mas.length && !limpio.menos.length) return '';
  return JSON.stringify(limpio);
}

/** Bloques que trae un rol por sí solo. */
function permBloquesDeRol_(rol) {
  const def = PERM_ROLES[permNormalizarRol_(rol) || 'normal'] || PERM_ROLES.normal;
  return def.bloques.slice();
}

// ── JERARQUÍA ────────────────────────────────────────────────────────────────
//
// UNA sola regla, escrita UNA sola vez, para toda la gestión de personas del sistema:
//
//        se alcanza a quien está en tu mismo NIVEL o por debajo.
//
// Antes esta decisión estaba repartida: Equipo.gs decía "los supervisores no se tocan
// entre sí", Consola.gs decía "esto es solo de maestros" y la pantalla decidía por su
// cuenta qué filas pintar en gris. Tres copias que no opinaban lo mismo, y la que de
// verdad mandaba era la última que se hubiera tocado. Al unificar la gestión de roles
// en la Consola, las tres se sustituyen por estas funciones.
//
// Por qué "igual o inferior" y no "estrictamente inferior": una coordinación con dos
// supervisores necesita que uno pueda dar de baja al otro cuando se va, y hasta ahora
// eso obligaba a despertar a un maestro. El riesgo real de que dos iguales se toquen
// se cubre con los candados de abajo (nadie se edita a sí mismo, nadie se sube de
// nivel), que son los que evitan la escalada de privilegios.

/** Nivel numérico de un rol. Lo desconocido cae al más bajo, nunca al más alto. */
function permNivelRol_(rol) {
  const def = PERM_ROLES[permNormalizarRol_(rol) || 'normal'];
  return (def && def.nivel) || PERM_ROLES.normal.nivel;
}

/** Nivel de una persona ya resuelta por permUsuario_. */
function permNivelUsuario_(usuario) {
  if (!usuario) return PERM_ROLES.normal.nivel;
  if (usuario.maestro === true) return PERM_ROLES.maestro.nivel;
  return permNivelRol_(usuario.rol);
}

/**
 * ¿Esta persona gestiona a otras? Se mira el BLOQUE efectivo y no el rol: a alguien se
 * le puede conceder 'sup_equipo' a mano sin subirlo de rol, y desde ese momento es un
 * gestor a todos los efectos.
 */
function permEsGestor_(usuario) {
  return !!usuario && (usuario.maestro === true ||
                       (usuario.bloques || []).indexOf('sup_equipo') !== -1);
}

/**
 * Roles que `quien` puede ASIGNAR: los de su nivel hacia abajo.
 *
 * Es la mitad que la gente olvida. Sin esto, un supervisor no podría editar a un
 * maestro (bien) pero sí podría coger a un asesor y nombrarlo maestro, y con eso
 * fabricarse un cómplice con más poder del que él mismo tiene. Es la vía clásica de
 * escalada de privilegios y se cierra aquí, no en la pantalla.
 */
function permRolesAsignables_(usuario) {
  const techo = permNivelUsuario_(usuario);
  return PERM_ROLES_ORDEN.filter(function (id) { return PERM_ROLES[id].nivel <= techo; });
}

/**
 * ¿Puede `quien` gestionar a `objetivo`? Devuelve el motivo en cristiano, o '' si sí.
 *
 * Se devuelve un texto y no un booleano a propósito: la pantalla tiene que poder
 * explicar por qué una fila está en gris. "No puedo" y "no existe" son cosas distintas
 * y confundirlas hace que el sistema parezca averiado.
 */
function permVetoJerarquia_(quien, objetivo) {
  if (!permEsGestor_(quien)) return 'Tu cuenta no gestiona roles.';
  if (!objetivo || objetivo.encontrado === false) return 'Esa persona no está dada de alta.';

  // Sobre uno mismo, nunca. Quien se equivoca aquí se queda sin la pantalla desde la
  // que deshacerlo, y hay que abrir el editor de Apps Script para rescatarlo.
  if (permMismoCorreo_(quien.email, objetivo.email)) {
    return 'No puedes cambiar tus propios permisos. Pídeselo a otra persona de tu nivel o a un maestro.';
  }

  const mio = permNivelUsuario_(quien);
  const suyo = permNivelUsuario_(objetivo);
  if (suyo > mio) {
    const r = PERM_ROLES[permNormalizarRol_(objetivo.rol) || 'normal'] || PERM_ROLES.normal;
    return 'Esta persona tiene un nivel superior al tuyo (' + r.nombre + '). Solo alguien de ese nivel o más puede cambiarla.';
  }
  return '';
}

/** Comparación de correos que no depende de cómo los escribió cada quien. */
function permMismoCorreo_(a, b) {
  const norm = function (x) { return String(x == null ? '' : x).trim().toLowerCase(); };
  return norm(a) !== '' && norm(a) === norm(b);
}

/**
 * ¿Puede `quien` dejar a alguien con el rol `rolPedido`?
 * @return {string} motivo, o '' si el rol está dentro de su alcance.
 */
function permVetoRol_(quien, rolPedido) {
  const rol = permNormalizarRol_(rolPedido);
  if (!rol) return 'El rol "' + rolPedido + '" no existe.';
  if (permRolesAsignables_(quien).indexOf(rol) === -1) {
    return 'No puedes asignar el rol ' + PERM_ROLES[rol].nombre + ': está por encima de tu nivel.';
  }
  return '';
}

/**
 * Bloques que `quien` puede repartir: los que tiene, menos los de administración.
 *
 * Se calcula sobre los bloques EFECTIVOS y no sobre el rol, para que un retiro hecho
 * por un maestro se respete también aquí: a quien le quitaron 'anuncios' no puede
 * concedérselo a nadie. Nadie reparte lo que no tiene.
 *
 * Los de administración quedan fuera salvo para el maestro, que los tiene todos: son
 * las llaves de la propia consola y no se delegan por partes.
 */
function permBloquesRepartibles_(usuario) {
  const bloques = (usuario && usuario.bloques) || [];
  if (usuario && usuario.maestro === true) return bloques.slice();
  return bloques.filter(function (id) { return PERM_IDS_ADMIN.indexOf(id) === -1; });
}

/**
 * Módulos apagados por mantenimiento (identificadores de bloque). Los bloques
 * marcados como `fijo` se ignoran aunque alguien los haya metido en la lista:
 * apagar "Portal" o la propia consola dejaría al sistema sin puerta de entrada.
 */
function permModulosApagados_() {
  try {
    const crudo = PropertiesService.getScriptProperties().getProperty(PERM_PROP_MODULOS);
    if (!crudo) return [];
    const lista = JSON.parse(crudo);
    if (!Array.isArray(lista)) return [];
    return lista.filter(function (id) {
      const b = permBloque_(id);
      return b && !b.fijo;
    });
  } catch (e) {
    return [];
  }
}

/** Guarda la lista de módulos apagados. Devuelve la lista ya saneada. */
function permFijarModulosApagados_(lista) {
  const limpia = (Array.isArray(lista) ? lista : []).filter(function (id) {
    const b = permBloque_(id);
    return b && !b.fijo;
  });
  PropertiesService.getScriptProperties().setProperty(PERM_PROP_MODULOS, JSON.stringify(limpia));
  return limpia;
}

/** Definición de un bloque por su id (null si no existe). */
function permBloque_(id) {
  const clave = String(id || '').trim();
  for (let i = 0; i < PERM_BLOQUES.length; i++) {
    if (PERM_BLOQUES[i].id === clave) return PERM_BLOQUES[i];
  }
  return null;
}

/**
 * Resuelve los bloques que una persona tiene REALMENTE, aplicando en orden:
 * rol → concesiones → retiros → módulos apagados.
 *
 * @param {string} rol            'normal' | 'avanzado' | 'maestro'
 * @param {object|string} ajustes Objeto {mas,menos} o el texto crudo de la celda.
 * @param {string[]=} apagados    Módulos en mantenimiento (se leen solos si se omite).
 * @return {string[]} identificadores de bloque, en el orden del catálogo.
 */
function permBloquesEfectivos_(rol, ajustes, apagados) {
  const rolFinal = permNormalizarRol_(rol) || 'normal';
  const esMaestro = rolFinal === 'maestro';
  const aj = (ajustes && typeof ajustes === 'object' && !Array.isArray(ajustes))
    ? permLimpiarAjustes_(ajustes)
    : permParsearAjustes_(ajustes);
  const off = Array.isArray(apagados) ? apagados : permModulosApagados_();

  const tiene = {};
  permBloquesDeRol_(rolFinal).forEach(function (id) { tiene[id] = true; });
  aj.mas.forEach(function (id) { tiene[id] = true; });
  aj.menos.forEach(function (id) { delete tiene[id]; });

  return PERM_IDS.filter(function (id) {
    if (!tiene[id]) return false;
    // La consola es territorio exclusivo del maestro: ningún ajuste por persona
    // puede colar a alguien ahí, porque desde dentro podría subirse el rol solo.
    if (PERM_IDS_ADMIN.indexOf(id) !== -1 && !esMaestro) return false;
    // El mantenimiento no encierra al maestro fuera de su propio interruptor.
    if (!esMaestro && off.indexOf(id) !== -1) return false;
    return true;
  });
}

/**
 * Estado completo de permisos de una persona. Es la función que debe usar el resto
 * del sistema; se apoya en el índice de "Registros" de Seguridad.gs, así que no
 * vuelve a leer la hoja si ya se leyó en esta ejecución.
 *
 * @param {string} email Correo (el de la sesión del portal, ya resuelto por secIdentidad_).
 * @return {{encontrado:boolean, email:string, nombre:string, rol:string, rolNombre:string,
 *           activo:boolean, avanzado:boolean, maestro:boolean, bloques:string[],
 *           ajustes:{mas:string[],menos:string[]}}}
 */
function permUsuario_(email) {
  const correo = secNormalizarCorreo_(email);
  // QUIÉN ES: la hoja "Registros" (nombre, alta). QUÉ PUEDE: la hoja oculta de
  // permisos. Son dos preguntas distintas y por eso viven en dos sitios distintos.
  const fila = correo ? secIndiceRegistros_()[correo] : null;

  if (!fila) {
    return {
      encontrado: false, email: correo, nombre: '', rol: 'normal',
      rolNombre: PERM_ROLES.normal.nombre, heredado: false, activo: false,
      avanzado: false, maestro: false, bloques: [], ajustes: { mas: [], menos: [] }
    };
  }

  const perm = permIndicePermisos_()[correo] || null;
  // Sin fila de permisos manda la columna "Avanzado" de siempre: nadie pierde ni gana
  // accesos por el hecho de que la hoja oculta todavía no lo conozca.
  const rol = permRolDeFila_(perm ? perm.rol : '', fila.avanzado);
  const ajustes = permParsearAjustes_(perm ? perm.permisos : '');

  return {
    encontrado: true,
    email: correo,
    nombre: fila.nombre || '',
    rol: rol,
    rolNombre: (PERM_ROLES[rol] || PERM_ROLES.normal).nombre,
    // true = no hay rol guardado y se dedujo de "Avanzado". La consola lo enseña como
    // "heredado" y lo escribe de forma explícita la primera vez que toca a esa persona.
    heredado: !(perm && permNormalizarRol_(perm.rol)),
    activo: perm ? perm.activo !== false : true,
    avanzado: rol === 'avanzado' || rol === 'maestro',
    maestro: rol === 'maestro',
    bloques: permBloquesEfectivos_(rol, ajustes),
    ajustes: ajustes
  };
}

/**
 * ¿Esta persona puede usar este bloque? Puerta única: cualquier función de servidor
 * que exponga una capacidad debería empezar por aquí.
 *
 * @param {string} email    Correo de la sesión del portal.
 * @param {string} bloqueId Identificador del bloque.
 */
function permPuede_(email, bloqueId) {
  const u = permUsuario_(email);
  if (!u.encontrado || !u.activo) return false;
  return u.bloques.indexOf(String(bloqueId || '')) !== -1;
}

/**
 * Los gates de identidad viven en Seguridad.gs (secIdentidadConBloque_ y
 * secIdentidadMaestra_), que es por donde ya pasaba todo el sistema. Estos dos
 * nombres se conservan como atajos con prefijo perm* para quien lea este archivo
 * buscando "cómo se exige un bloque": son la MISMA función, no una segunda
 * implementación —duplicar la decisión es exactamente cómo se acaba con dos
 * respuestas distintas a la misma pregunta—.
 */
function permIdentidadConBloque_(emailCliente, bloqueId) {
  return secIdentidadConBloque_(emailCliente, bloqueId);
}

function permIdentidadMaestra_(emailCliente) {
  return secIdentidadMaestra_(emailCliente);
}

// ── ESCRITURA ────────────────────────────────────────────────────────────────

/** ¿El valor es un "no" en cualquiera de sus formas? (espejo de secEsAfirmativo_). */
function permEsNegativo_(valor) {
  if (valor === false) return true;
  const s = String(valor == null ? '' : valor).trim().toLowerCase()
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
  return s === 'no' || s === 'false' || s === '0' || s === 'falso';
}

/** ¿Es un valor de tipo sí/no, y por tanto traducible a lo que acepte la celda? */
function permEsSiNo_(valor) {
  return secEsAfirmativo_(valor) || permEsNegativo_(valor);
}

/**
 * Traduce un "Sí"/"No" a la forma EXACTA que acepta esa celda.
 *
 * La hoja "Registros" lleva años con una validación de datos en la columna "Avanzado"
 * que solo admite `Si` y `No` —sin acento—. Escribir `Sí` ahí no es un matiz
 * ortográfico: Sheets rechaza la escritura entera con una excepción. Y no se puede
 * asumir la forma sin acento tampoco: otra hoja del mismo sistema podría estar
 * validada con `Sí`, o con `TRUE`.
 *
 * Así que en vez de adivinar, se le pregunta a la celda qué acepta y se le da eso.
 *
 * @param {GoogleAppsScript.Spreadsheet.Range} rango Celda destino (una sola).
 * @param {*} valor Lo que se quería escribir.
 * @return {{ok:boolean, valor:*}} ok:false = la celda no admite ningún sí/no y hay que
 *         saltarse ese campo en vez de reventar la operación completa.
 */
function permValorParaCelda_(rango, valor) {
  if (!permEsSiNo_(valor)) return { ok: true, valor: valor };

  let permitidos = null;
  try {
    const dv = rango.getDataValidation();
    if (dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      permitidos = dv.getCriteriaValues()[0];
    }
  } catch (e) {
    // Sin acceso a la validación no se puede afinar: se escribe tal cual.
    return { ok: true, valor: valor };
  }

  if (!permitidos || !permitidos.length) return { ok: true, valor: valor };

  const quiero = secEsAfirmativo_(valor);
  for (let i = 0; i < permitidos.length; i++) {
    const p = permitidos[i];
    if (quiero ? secEsAfirmativo_(p) : permEsNegativo_(p)) return { ok: true, valor: p };
  }

  // La lista existe pero no contiene ningún sí/no reconocible. Se avisa y se salta:
  // la columna "Rol" es la que manda ahora, así que perder este apunte no rompe nada,
  // mientras que insistir tumbaría el guardado completo.
  Logger.log('permValorParaCelda_: la celda ' + rango.getA1Notation() +
    ' solo admite [' + permitidos.join(', ') + ']; se omite el valor "' + valor + '".');
  return { ok: false, valor: valor };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALMACÉN DE PERMISOS — hoja OCULTA, separada de "Registros"
 * ═══════════════════════════════════════════════════════════════════════════════
 * El primer diseño metía Rol, Permisos y Activo como columnas nuevas de "Registros".
 * Fue un error, y por dos razones que se vieron en cuanto tocó una hoja real:
 *
 *   1. "Registros" es una hoja VIVA que edita gente. Tiene validaciones de datos
 *      (la columna "Avanzado" solo admite `Si`/`No` sin acento, y escribir `Sí`
 *      rechazaba la operación entera), formatos, filtros y columnas que ya
 *      significaban otra cosa —una columna "Rol" con el PUESTO de cada persona
 *      choca de frente con el rol del sistema, y gana la que se escribió al final—.
 *
 *   2. Los permisos no son un dato del negocio: son configuración del sistema. No
 *      deberían estar a un clic de que alguien los ordene, los filtre o los borre
 *      sin darse cuenta.
 *
 * Así que viven aquí, en su propia hoja oculta, con nombres de columna que este
 * archivo controla por completo y sin una sola validación que respetar.
 *
 * "Registros" sigue siendo la lista de MIEMBROS (nombre, correo, contraseña) y su
 * columna "Avanzado" se sigue leyendo como respaldo para quien todavía no tenga
 * fila aquí. Este archivo ya no le escribe NADA a "Registros" salvo el nombre.
 */

/** Hoja donde viven los permisos. El guion bajo avisa de que no es para editar a mano. */
const PERM_HOJA = '_PermisosSistema';
const PERM_HOJA_COLUMNAS = ['Email', 'Rol', 'Permisos', 'Activo', 'Actualizado', 'Por'];

/** Claves de campo que usa el resto del sistema al pedir un cambio. */
const PERM_COL_ROL = 'Rol';
const PERM_COL_PERMISOS = 'Permisos';
const PERM_COL_ACTIVO = 'Activo';

/**
 * Devuelve la hoja de permisos, creándola y ocultándola la primera vez.
 * @param {boolean=} crear false = no la crea si no existe (para lecturas).
 */
function permHoja_(crear) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PERM_HOJA);
  if (sheet) return sheet;
  if (crear === false) return null;

  sheet = ss.insertSheet(PERM_HOJA);
  sheet.getRange(1, 1, 1, PERM_HOJA_COLUMNAS.length).setValues([PERM_HOJA_COLUMNAS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, PERM_HOJA_COLUMNAS.length).setFontWeight('bold');
  sheet.setColumnWidth(1, 260);   // Email
  sheet.setColumnWidth(2, 90);    // Rol
  sheet.setColumnWidth(3, 300);   // Permisos
  sheet.setColumnWidth(4, 70);    // Activo
  sheet.setColumnWidth(5, 160);   // Actualizado
  sheet.setColumnWidth(6, 230);   // Por
  // Se oculta al crearla: no es una hoja de consulta, es el almacén del sistema.
  try { sheet.hideSheet(); } catch (e) {}
  Logger.log('Creada la hoja de permisos "' + PERM_HOJA + '" (oculta).');
  return sheet;
}

/** Índice en memoria de la hoja de permisos, válido solo durante ESTA ejecución. */
var PERM_INDICE_CACHE = null;

/**
 * Lee la hoja de permisos.
 * @return {Object<string, {rol:string, permisos:string, activo:boolean, fila:number}>}
 */
function permIndicePermisos_() {
  if (PERM_INDICE_CACHE) return PERM_INDICE_CACHE;
  const indice = {};
  try {
    const sheet = permHoja_(false);
    if (sheet && sheet.getLastRow() >= 2) {
      const datos = sheet.getRange(2, 1, sheet.getLastRow() - 1, PERM_HOJA_COLUMNAS.length).getValues();
      for (let r = 0; r < datos.length; r++) {
        const correo = secNormalizarCorreo_(datos[r][0]);
        if (!correo || indice[correo]) continue;   // la primera fila gana
        const crudoActivo = String(datos[r][3] || '').trim();
        indice[correo] = {
          rol: String(datos[r][1] || ''),
          permisos: String(datos[r][2] || ''),
          // Vacío = activo. Solo un "No" explícito da de baja.
          activo: !(crudoActivo !== '' && !secEsAfirmativo_(crudoActivo)),
          fila: r + 2
        };
      }
    }
  } catch (e) {
    Logger.log('permIndicePermisos_ error: ' + e);
  }
  PERM_INDICE_CACHE = indice;
  return indice;
}

/**
 * Escribe (o crea) la fila de permisos de alguien. Es el ÚNICO punto que toca la
 * hoja oculta.
 *
 * @param {string} correo   Correo ya normalizado.
 * @param {object} valores  {rol?, permisos?, activo?} — solo se aplica lo que llegue.
 * @param {string=} quien   Quién hizo el cambio (para dejar rastro en la hoja).
 * @return {boolean}
 */
function permGuardarPermisos_(correo, valores, quien) {
  const email = secNormalizarCorreo_(correo);
  if (!email) return false;

  const sheet = permHoja_();
  const actual = permIndicePermisos_()[email] || null;

  const rol = (valores.rol !== undefined && valores.rol !== null)
    ? (permNormalizarRol_(valores.rol) || 'normal')
    : (actual ? actual.rol : '');
  const permisos = (valores.permisos !== undefined && valores.permisos !== null)
    ? String(valores.permisos)
    : (actual ? actual.permisos : '');
  const activo = (valores.activo !== undefined && valores.activo !== null)
    ? (secEsAfirmativo_(valores.activo) ? 'Si' : 'No')
    : (actual ? (actual.activo ? 'Si' : 'No') : 'Si');

  const fila = [email, rol, permisos, activo, new Date(), quien || secUsuarioGoogle_() || ''];

  if (actual) sheet.getRange(actual.fila, 1, 1, PERM_HOJA_COLUMNAS.length).setValues([fila]);
  else sheet.appendRow(fila);

  PERM_INDICE_CACHE = null;
  return true;
}

/**
 * Borra la fila de permisos de alguien. Se llama al eliminar a un miembro: dejarla
 * suelta haría que ese correo, si algún día se vuelve a dar de alta, reapareciera
 * con los permisos de su vida anterior.
 */
function permBorrarPermisos_(correo) {
  const email = secNormalizarCorreo_(correo);
  const actual = email ? permIndicePermisos_()[email] : null;
  if (!actual) return false;

  const sheet = permHoja_(false);
  if (!sheet) return false;
  sheet.deleteRow(actual.fila);
  PERM_INDICE_CACHE = null;
  return true;
}

/**
 * Punto de entrada que usa el resto del sistema (la consola, sobre todo).
 *
 * Reparte cada campo a donde le toca: el rol, los permisos y el alta/baja van a la
 * hoja oculta; el nombre —lo único que sigue siendo un dato del miembro— se queda
 * en "Registros". La columna "Avanzado" ya NO se escribe: es solo un respaldo de
 * lectura, y escribirla era lo que chocaba con la validación de la hoja.
 *
 * @param {string} email  Correo del miembro.
 * @param {object} campos {Rol|Permisos|Activo|Nombre: valor}
 * @return {boolean} true si el miembro existe y se escribió lo que se pidió.
 */
function permEscribirFila_(email, campos) {
  const correo = secNormalizarCorreo_(email);
  if (!correo) return false;
  if (!secBuscarRegistro_(correo).encontrado) return false;

  const sistema = {};
  const registros = {};
  Object.keys(campos || {}).forEach(function (clave) {
    if (clave === PERM_COL_ROL) sistema.rol = campos[clave];
    else if (clave === PERM_COL_PERMISOS) sistema.permisos = campos[clave];
    else if (clave === PERM_COL_ACTIVO) sistema.activo = campos[clave];
    else if (clave === 'Avanzado') { /* ya no se escribe: ver el comentario de arriba */ }
    else registros[clave] = campos[clave];
  });

  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) {
    throw new Error('El sistema está ocupado guardando otro cambio. Inténtalo de nuevo.');
  }

  try {
    if (Object.keys(sistema).length) permGuardarPermisos_(correo, sistema);
    if (Object.keys(registros).length) permEscribirRegistros_(correo, registros);
    return true;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Escribe celdas sueltas en "Registros" (hoy solo el nombre). Respeta las
 * validaciones de datos de la hoja, que es de todo menos nuestra.
 * Se llama SIEMPRE desde dentro del candado de permEscribirFila_.
 */
function permEscribirRegistros_(correo, campos) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REGISTROS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return false;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const iEmail = headers.indexOf('Email');
  if (iEmail === -1) return false;

  const correos = sheet.getRange(2, iEmail + 1, sheet.getLastRow() - 1, 1).getValues();
  for (let r = 0; r < correos.length; r++) {
    if (secNormalizarCorreo_(correos[r][0]) !== correo) continue;
    Object.keys(campos).forEach(function (col) {
      const i = headers.indexOf(col);
      if (i === -1) return;
      const celda = sheet.getRange(r + 2, i + 1);
      const listo = permValorParaCelda_(celda, campos[col]);
      if (listo.ok) celda.setValue(listo.valor);
    });
    SEC_REGISTROS_CACHE = null;
    return true;
  }
  return false;
}

// ── ARRANQUE ─────────────────────────────────────────────────────────────────

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  PASO 1 — LO ÚNICO QUE HAY QUE HACER A MANO PARA ENCENDER LA CONSOLA      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * 1. Cambia el correo de la línea de abajo por el tuyo (el mismo con el que
 *    inicias sesión en la app, el que está en la hoja "Registros").
 * 2. Guarda (Ctrl+S).
 * 3. Arriba, en la lista de funciones, elige  NOMBRAR_MAESTRO  y pulsa Ejecutar.
 * 4. Mira el registro de ejecución: dirá "MAESTRO NOMBRADO".
 *
 * POR QUÉ ESTA FUNCIÓN EXISTE: el botón "Ejecutar" del editor no sabe pasarle
 * argumentos a una función, así que permSembrarMaestro("correo") no se puede
 * ejecutar directamente desde ahí. Esta envoltura no recibe nada y lleva el
 * correo escrito dentro, que es la forma en que el editor sí puede correrla.
 */
const MAESTRO_INICIAL = 'dmartineza02@liverpool.com.mx';

function NOMBRAR_MAESTRO() {
  if (MAESTRO_INICIAL.indexOf('escribe.tu.correo') === 0) {
    throw new Error('Todavía no cambiaste el correo: edita la constante MAESTRO_INICIAL ' +
      'al principio de esta sección (Permisos.gs), guarda y vuelve a ejecutar.');
  }
  return permSembrarMaestro(MAESTRO_INICIAL);
}

/**
 * DIAGNÓSTICO A FONDO — ejecútala si NOMBRAR_MAESTRO dijo que todo salió bien pero la
 * app te sigue tratando como asesor.
 *
 * No adivina: enseña el renglón de encabezados tal cual está en la hoja, la celda
 * exacta donde vive tu rol, lo que hay escrito dentro, y lo que el sistema entiende al
 * leerlo. Casi todos los casos de "no me cambia el rol" son una de estas cuatro cosas,
 * y las cuatro se ven aquí de un vistazo.
 */
function REPARAR_MAESTRO() {
  const correo = secNormalizarCorreo_(MAESTRO_INICIAL);
  Logger.log('═══════════ DIAGNÓSTICO DEL ROL ═══════════');
  Logger.log('Correo a revisar: ' + correo);

  if (!correo || correo.indexOf('escribe.tu.correo') === 0) {
    Logger.log('✖ Todavía no pusiste tu correo en MAESTRO_INICIAL (arriba en este archivo).');
    return;
  }

  // 1. ¿Existe la persona? Eso lo decide "Registros", que es la lista de miembros.
  const reg = secBuscarRegistro_(correo);
  Logger.log('── En la hoja "' + REGISTROS_SHEET_NAME + '" (quién eres) ──');
  if (!reg.encontrado) {
    Logger.log('  ✖ Ese correo NO está dado de alta.');
    Logger.log('  Ejecuta VER_CORREOS_REGISTRADOS, copia el tuyo tal cual y ponlo en MAESTRO_INICIAL.');
    return;
  }
  Logger.log('  Nombre: ' + (reg.nombre || '(sin nombre)'));
  Logger.log('  Columna "Avanzado": ' + (reg.avanzado ? 'sí' : 'no') + '  (solo se usa como respaldo)');

  // 2. ¿Qué puede? Eso lo decide la hoja oculta, y solo la hoja oculta.
  Logger.log('── En la hoja oculta "' + PERM_HOJA + '" (qué puedes) ──');
  const hoja = permHoja_(false);
  if (!hoja) {
    Logger.log('  La hoja todavía no existe. Se creará ahora.');
  } else {
    Logger.log('  Filas guardadas: ' + Math.max(0, hoja.getLastRow() - 1));
    if (hoja.isSheetHidden && !hoja.isSheetHidden()) {
      Logger.log('  (está visible; se puede ocultar a mano, no afecta al funcionamiento)');
    }
  }
  const antes = permIndicePermisos_()[correo] || null;
  Logger.log('  Tu fila: ' + (antes
    ? 'rol "' + antes.rol + '" · activo ' + (antes.activo ? 'sí' : 'NO')
    : '(todavía no tienes fila aquí)'));

  // 3. Reparación: escribir y volver a leer, que es la única prueba que vale.
  Logger.log('── Escribiendo "maestro" y releyendo ──');
  permGuardarPermisos_(correo, { rol: 'maestro', activo: 'Si' }, 'REPARAR_MAESTRO');
  SpreadsheetApp.flush();            // sin esto la relectura puede traer el valor viejo
  PERM_INDICE_CACHE = null;
  SEC_REGISTROS_CACHE = null;

  const u = permUsuario_(correo);
  Logger.log('  Rol leído ahora: ' + u.rol + ' (' + u.rolNombre + ')');
  Logger.log('  ¿Es maestro?     ' + (u.maestro ? 'SÍ' : 'NO'));
  Logger.log('  Bloques:         ' + u.bloques.length + ' de ' + PERM_IDS.length);
  Logger.log('  Consola:         ' + (u.bloques.indexOf('adm_miembros') > -1 ? 'accesible' : 'SIN acceso'));
  Logger.log('───────────────────────────────────────');
  if (u.maestro) {
    Logger.log('TODO EN ORDEN en el servidor.');
    Logger.log('En la app: recarga la pantalla (F5). No hace falta cerrar sesión.');
    Logger.log('Si la consola sigue sin aparecer, es que el navegador tiene la versión');
    Logger.log('vieja de app_core/app_shell: vuelve a desplegar con "Nueva versión".');
  } else {
    Logger.log('✖ Sigue sin quedar. Copia TODO este registro y mándalo para revisarlo.');
  }
  return u;
}

/**
 * Enseña el contenido completo de la hoja oculta de permisos, sin tener que
 * mostrarla en Sheets. Útil para comprobar de un vistazo quién tiene qué.
 */
function VER_PERMISOS_GUARDADOS() {
  const permisos = permIndicePermisos_();
  const correos = Object.keys(permisos).sort();
  Logger.log('═══ HOJA OCULTA "' + PERM_HOJA + '" ═══');
  if (!correos.length) {
    Logger.log('  (vacía) · nadie tiene rol guardado todavía; manda la columna "Avanzado".');
    return [];
  }
  correos.forEach(function (c) {
    const p = permisos[c];
    Logger.log('  ' + c + '  →  rol "' + p.rol + '"' +
      (p.activo ? '' : ' · DADO DE BAJA') +
      (p.permisos ? ' · ajustes ' + p.permisos : ''));
  });
  Logger.log('───────────────────────────────────────');
  Logger.log('Maestros: ' + (permListaMaestros_().join(', ') || 'NINGUNO'));
  return correos;
}

/**
 * ¿Qué correos hay dados de alta? Ejecútala desde el editor si NOMBRAR_MAESTRO te
 * dice que tu correo no está en "Registros": aquí ves cuáles sí están, tal y como
 * están escritos, y puedes copiar el que corresponda.
 */
function VER_CORREOS_REGISTRADOS() {
  const indice = secIndiceRegistros_();
  const correos = Object.keys(indice);
  Logger.log('═══ CORREOS EN LA HOJA "' + REGISTROS_SHEET_NAME + '" ═══');
  if (!correos.length) {
    Logger.log('  (ninguno) · ¿Es la hoja correcta y tiene una columna llamada "Email"?');
    return [];
  }
  correos.sort().forEach(function (c) {
    const fila = indice[c];
    const u = permUsuario_(c);   // junta "Registros" con la hoja oculta de permisos
    Logger.log('  ' + c + '  →  ' + (fila.nombre || '(sin nombre)') +
      ' · rol ' + u.rol + (u.heredado ? ' (heredado de "Avanzado")' : '') +
      (u.activo ? '' : ' · DADO DE BAJA'));
  });
  Logger.log('───────────────────────────────────────');
  Logger.log('Copia el que sea tuyo y pégalo en MAESTRO_INICIAL (Permisos.gs).');
  return correos;
}

/**
 * PASO ÚNICO DE PUESTA EN MARCHA — ejecutar UNA VEZ desde el editor de Apps Script.
 *
 * Nombra al primer maestro. Tiene que hacerse desde el editor a propósito: si la
 * consola pudiera repartir el primer maestro, cualquiera con acceso a la web app
 * podría nombrarse a sí mismo. Después de esta llamada, ese maestro ya puede
 * nombrar a los demás desde la pantalla.
 *
 * Uso:  seleccionar permSembrarMaestro en el editor, ejecutar, y leer el registro.
 *       Si el correo no es el que quieres, edita la constante de abajo.
 *
 * @param {string=} correo Correo del primer maestro. Si se omite, usa la cuenta de
 *        Google que está ejecutando la función.
 */
function permSembrarMaestro(correo) {
  const objetivo = secNormalizarCorreo_(correo) || secUsuarioGoogle_();
  if (!objetivo) {
    throw new Error('No se pudo determinar a quién nombrar maestro. Llama a ' +
      'permSembrarMaestro("tu.correo@dominio.com") con el correo entre comillas.');
  }

  const reg = secBuscarRegistro_(objetivo);
  if (!reg.encontrado) {
    // Un "no está dado de alta" a secas deja a quien lo lee sin saber qué hacer.
    // Se listan los correos que SÍ están para que pueda copiar el suyo: casi siempre
    // el problema es un punto de más, un alias distinto o el dominio equivocado.
    const existentes = Object.keys(secIndiceRegistros_()).sort();
    throw new Error('El correo ' + objetivo + ' no está en la hoja "' + REGISTROS_SHEET_NAME + '".\n' +
      (existentes.length
        ? 'Los que sí están son:\n  ' + existentes.join('\n  ') +
          '\nCopia el tuyo tal cual y ponlo en MAESTRO_INICIAL.'
        : 'La hoja no tiene ningún correo. Crea tu cuenta desde la pantalla de registro y vuelve a ejecutar esto.'));
  }

  // Va a la hoja OCULTA de permisos. No se toca "Registros" ni su columna "Avanzado":
  // esa hoja tiene validaciones que no son nuestras y no hay por qué pelearse con ellas.
  permGuardarPermisos_(objetivo, { rol: 'maestro', activo: 'Si' }, 'permSembrarMaestro');
  SpreadsheetApp.flush();

  const u = permUsuario_(objetivo);
  Logger.log('═══ MAESTRO NOMBRADO ═══');
  Logger.log('  ' + objetivo + ' → rol ' + u.rol + ' (' + u.rolNombre + ')');
  Logger.log('  Bloques: ' + u.bloques.length + '/' + PERM_IDS.length);
  Logger.log('  Guardado en la hoja oculta "' + PERM_HOJA + '".');
  if (!u.maestro) {
    throw new Error('Se escribió el rol pero al releerlo NO quedó como maestro. ' +
      'Ejecuta REPARAR_MAESTRO para ver qué está pasando.');
  }
  Logger.log('  Ya puede abrir la consola en ?page=consola (recarga la app con F5).');
  return u;
}

/**
 * Rol y bloques de quien está usando la app AHORA. La llama cada pantalla al cargar.
 *
 * Existe porque el navegador guarda el rol al iniciar sesión y, sin esto, ese dato se
 * queda congelado: nombras maestro a alguien y su menú sigue siendo el de asesor hasta
 * que cierra sesión y vuelve a entrar. Un permiso que tarda un re-login en notarse es
 * un permiso que parece roto.
 *
 * Es deliberadamente barata —lee el índice de "Registros", que ya está en memoria en
 * casi todas las peticiones— y no revela nada que quien llama no sepa ya de sí mismo.
 *
 * @param {string} emailCliente Correo de la sesión del portal (AppSession.userEmail).
 * @return {{success:boolean, rol:string, rolNombre:string, maestro:boolean,
 *           avanzado:boolean, bloques:string[], nombre:string, activo:boolean, message:string}}
 */
function obtenerPermisosSesion(emailCliente) {
  try {
    const id = secIdentidad_(emailCliente);
    if (!id.ok) {
      // Cuenta dada de baja o sesión inválida: se dice con claridad para que el cliente
      // pueda sacar a esa persona en vez de dejarla con una app que rechaza todo.
      return { success: false, rol: 'normal', rolNombre: '', maestro: false, avanzado: false,
               bloques: [], nombre: '', activo: false, message: id.error };
    }
    return {
      success: true,
      rol: id.rol,
      rolNombre: (PERM_ROLES[id.rol] || PERM_ROLES.normal).nombre,
      maestro: id.maestro,
      avanzado: id.avanzado,
      bloques: id.bloques || [],
      nombre: id.nombre || '',
      activo: true,
      message: ''
    };
  } catch (e) {
    Logger.log('obtenerPermisosSesion error: ' + e);
    return { success: false, rol: 'normal', rolNombre: '', maestro: false, avanzado: false,
             bloques: [], nombre: '', activo: true, message: e.message };
  }
}

/**
 * Qué módulos están apagados por mantenimiento. SIN sesión.
 *
 * POR QUÉ EXISTE
 * --------------
 * El menú de áreas del Portal se apagaba solo para quien había iniciado sesión: sin
 * sesión, AppFunciones enseñaba todo "por si acaso". El resultado era el peor de los
 * dos mundos justo cuando más duele —el Portal es la landing pública y la primera
 * pantalla del día—: un asesor sin sesión veía Promociones en el menú, entraba, hacía
 * el login, y solo entonces se enteraba de que el módulo estaba caído por
 * mantenimiento. Tres pasos para llegar a una puerta cerrada que ya sabíamos que
 * estaba cerrada.
 *
 * QUÉ REVELA
 * ----------
 * Nada que no se vea igual desde fuera. "El monitor de promociones está en
 * mantenimiento" es exactamente lo que descubre cualquiera que intente abrirlo, y es
 * lo mismo que dice el tablero de estado, que también es público a propósito. No
 * viajan correos, ni nombres, ni quién apagó qué: solo la lista de identificadores
 * apagados y el catálogo de nombres para poder decirlo en cristiano.
 *
 * @return {{success:boolean, apagados:string[], nombres:Object<string,string>}}
 */
function obtenerModulosPublicos() {
  try {
    const apagados = permModulosApagados_();
    const nombres = {};
    PERM_BLOQUES.forEach(function (b) {
      if (apagados.indexOf(b.id) !== -1) nombres[b.id] = b.nombre;
    });
    return { success: true, apagados: apagados, nombres: nombres };
  } catch (e) {
    Logger.log('obtenerModulosPublicos error: ' + e);
    // Un fallo aquí NO debe esconder el menú: sin respuesta, el cliente se queda con
    // el criterio de siempre (enseñarlo todo). Esconder de más por un error de lectura
    // sería dejar la landing sin puertas por un problema que no es del usuario.
    return { success: false, apagados: [], nombres: {} };
  }
}

/**
 * Lista de correos con rol maestro. Se recorre la hoja de permisos, no "Registros":
 * el rol maestro solo existe si está escrito, nunca se hereda de "Avanzado".
 */
function permListaMaestros_() {
  const permisos = permIndicePermisos_();
  return Object.keys(permisos).filter(function (correo) {
    return permNormalizarRol_(permisos[correo].rol) === 'maestro';
  });
}

/** ¿Hay al menos un maestro? Lo usa la consola para avisar si el sistema se quedó huérfano. */
function permHayMaestro_() {
  return permListaMaestros_().length > 0;
}

/**
 * Catálogo listo para pintar en el cliente: bloques, grupos, roles y qué está apagado.
 * No lleva datos de nadie, así que puede viajar sin más comprobación que la sesión.
 */
function permCatalogo_() {
  const apagados = permModulosApagados_();
  return {
    grupos: PERM_GRUPOS.slice(),
    bloques: PERM_BLOQUES.map(function (b) {
      return {
        id: b.id, nombre: b.nombre, detalle: b.detalle, grupo: b.grupo,
        pagina: b.pagina, admin: b.admin, fijo: b.fijo,
        apagado: apagados.indexOf(b.id) !== -1
      };
    }),
    roles: PERM_ROLES_ORDEN.map(function (id) {
      const r = PERM_ROLES[id];
      return { id: r.id, nombre: r.nombre, detalle: r.detalle, orden: r.orden,
               nivel: r.nivel, bloques: r.bloques.slice() };
    }),
    apagados: apagados
  };
}

/**
 * Catálogo RECORTADO a lo que una persona concreta puede repartir.
 *
 * La consola la usan ahora dos perfiles con alcance distinto, y enseñarle a un
 * supervisor casillas y roles que el servidor le va a rechazar es un formulario que
 * enseña a desconfiar de sí mismo: se pulsa, falla, y a partir de ahí ya no se sabe
 * qué botones son de verdad. Lo que no se puede conceder, no se pinta.
 *
 * Esto es presentación, no seguridad: cada guardado vuelve a comprobar la jerarquía
 * en el servidor (ver consolaGuardarMiembro). Recortar aquí es para que la pantalla
 * no mienta, no para impedir nada.
 */
function permCatalogoPara_(usuario) {
  const base = permCatalogo_();
  const repartibles = permBloquesRepartibles_(usuario);
  const asignables = permRolesAsignables_(usuario);

  return {
    grupos: base.grupos.filter(function (g) {
      return base.bloques.some(function (b) {
        return b.grupo === g && repartibles.indexOf(b.id) !== -1;
      });
    }),
    bloques: base.bloques.filter(function (b) { return repartibles.indexOf(b.id) !== -1; }),
    roles: base.roles.filter(function (r) { return asignables.indexOf(r.id) !== -1; })
      .map(function (r) {
        // Los bloques de cada rol también se recortan: si no, la ficha del rol
        // promete accesos que quien lo asigna no puede dar.
        return {
          id: r.id, nombre: r.nombre, detalle: r.detalle, orden: r.orden, nivel: r.nivel,
          bloques: r.bloques.filter(function (b) { return repartibles.indexOf(b) !== -1; })
        };
      }),
    apagados: base.apagados
  };
}

// ── DIAGNÓSTICO ──────────────────────────────────────────────────────────────

/**
 * Radiografía del modelo de permisos. Ejecutar desde el editor cuando algo no cuadre.
 * @param {string=} correo Correo a examinar. Si se omite, usa la cuenta de Google.
 */
function permDiagnostico(correo) {
  const objetivo = secNormalizarCorreo_(correo) || secUsuarioGoogle_();
  Logger.log('═══ PERMISOS ═══');
  Logger.log('Bloques definidos: ' + PERM_IDS.length + ' (' + PERM_IDS_APP.length + ' de app, ' +
    PERM_IDS_ADMIN.length + ' de administración)');

  const off = permModulosApagados_();
  Logger.log('Módulos apagados: ' + (off.length ? off.join(', ') : 'ninguno'));

  const maestros = permListaMaestros_();
  Logger.log('Maestros: ' + (maestros.length ? maestros.join(', ') : 'NINGUNO · ejecuta permSembrarMaestro("correo")'));

  if (!objetivo) {
    Logger.log('Sin correo que examinar. Llama a permDiagnostico("correo@dominio.com").');
    return { maestros: maestros, apagados: off };
  }

  const u = permUsuario_(objetivo);
  Logger.log('── ' + objetivo + ' ──');
  if (!u.encontrado) {
    Logger.log('  NO está en "' + REGISTROS_SHEET_NAME + '".');
    return u;
  }
  Logger.log('  Rol: ' + u.rol + ' (' + u.rolNombre + ') · ' + (u.activo ? 'activo' : 'DADO DE BAJA'));
  if (u.ajustes.mas.length) Logger.log('  Concesiones: ' + u.ajustes.mas.join(', '));
  if (u.ajustes.menos.length) Logger.log('  Retiros: ' + u.ajustes.menos.join(', '));
  Logger.log('  Bloques efectivos (' + u.bloques.length + '): ' + u.bloques.join(', '));
  const sinAcceso = PERM_IDS.filter(function (id) { return u.bloques.indexOf(id) === -1; });
  Logger.log('  Sin acceso (' + sinAcceso.length + '): ' + (sinAcceso.join(', ') || '—'));
  return u;
}
