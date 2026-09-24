/**
 * =================================================================================================
 * CONTENIDO DEL PORTAL — backend de ESCRITURA | Sistema de cotizaciones Ventel
 * =================================================================================================
 * El Portal (Index.html y Promociones.html) se alimenta de una hoja APARTE —la del
 * Portal, ver Portal.gs— con una pestaña por sección: Herramientas, Presentaciones,
 * Paqueterias, Formatos, PdePago, Plantillas, Promociones, MKP y Reportes.
 *
 * Hasta aquí, Portal.gs sabía LEERLAS todas pero solo sabía ESCRIBIR en "Anuncios".
 * Para cambiar una herramienta, una plantilla de correo o un formato había que abrir
 * el Google Sheet a mano: no había puerta desde la app, así que tampoco había permiso
 * que conceder ni rastro de quién cambió qué. Este archivo pone esa puerta.
 *
 * CÓMO ESTÁ HECHO
 *
 *   Un CATÁLOGO declarativo (PC_COLECCIONES) describe cada pestaña: qué columnas tiene,
 *   cómo se llama cada una en pantalla, de qué tipo es y qué se valida. Todo lo demás
 *   —listar, guardar, borrar, duplicar, reordenar— es UNA sola implementación genérica
 *   que lee ese catálogo. Añadir una sección nueva es añadir una entrada al arreglo,
 *   no escribir otro CRUD.
 *
 * TRES DECISIONES QUE IMPORTAN
 *
 *   1. SE ESCRIBE CELDA POR CELDA, solo en las columnas mapeadas. La hoja Promociones
 *      tiene columnas que esta pantalla no toca (SKUS Mercaderías, #skus, banners de
 *      home). Reescribir la fila entera —como hace publicarAnuncio, que sí es dueño de
 *      su hoja— las borraría.
 *
 *   2. LAS FILAS SE IDENTIFICAN POR UNA COLUMNA "ID", no por su número de fila. El
 *      número de fila cambia en cuanto alguien inserta una fila desde el Sheet, y
 *      entonces la app edita o borra la fila equivocada. Las pestañas que no tenían ID
 *      —todas menos Plantillas y Anuncios— la reciben automáticamente la primera vez
 *      que se abren aquí (pcAsegurarIds_): va en la primera columna libre, y las
 *      lecturas de Portal.gs localizan sus columnas por encabezado, así que ninguna
 *      se entera.
 *
 *   3. ANUNCIOS NO ESTÁ AQUÍ. Ya tiene su constructor (Portal.gs + anuncios.html) con
 *      vista previa, subida de imágenes y programación. Duplicarlo con un formulario
 *      genérico sería peor; la pantalla enlaza al que ya existe.
 *
 * PERMISO: el bloque 'portal_contenido' (Permisos.gs), que viene con el rol Supervisor.
 * El gate se vuelve a exigir en el servidor en CADA operación: lo que decide el cliente
 * es solo qué se dibuja.
 *
 * Funciones expuestas al cliente (portal_contenido.html):
 *   portalContenidoCatalogo(email)      → sección por sección, con conteos
 *   portalContenidoListar(p)            → filas de una sección
 *   portalContenidoGuardar(p)           → alta o edición
 *   portalContenidoEliminar(p)          → baja
 *   portalContenidoDuplicar(p)          → copia de una fila
 *   portalContenidoMover(p)             → subir / bajar una fila
 */

// ── PERMISO Y CONSTANTES ─────────────────────────────────────────────────────

/** Bloque de permisos que exige TODA operación de este archivo. */
var PC_BLOQUE = 'portal_contenido';

/** Encabezado de la columna de identidad que se añade a las pestañas que no la tienen. */
var PC_COL_ID = 'ID';

/** Tope de filas que se mandan a la pantalla de una sola vez. */
var PC_LIMITE_FILAS = 400;

/** Segundos que se guarda el conteo por sección (solo para pintar los números). */
var PC_TTL_CONTEOS = 120;

// ── CATÁLOGO DE SECCIONES ────────────────────────────────────────────────────
/**
 * Una entrada por pestaña gestionable. Los campos:
 *
 *   id            clave interna; viaja en la URL y en las llamadas. No se renombra.
 *   nombre        cómo se llama en pantalla.
 *   hoja          nombre EXACTO de la pestaña en la hoja del Portal.
 *   resumen       qué guarda, en cristiano. Se lee bajo el título de la sección.
 *   donde         dónde lo ve el asesor. Sin esto nadie sabe qué está publicando.
 *   prefijo       prefijo de los IDs que se generan ('htl' → 'htl-mqiepn3t').
 *   titulo        campo que titula la fila en la lista.
 *   subtitulo     campo que se enseña debajo, en gris. '' si no hay.
 *   enlaceCampo   campo de tipo url que alimenta el botón "Abrir". '' si no hay.
 *   ordenable     true = se puede subir/bajar la fila (el Portal respeta el orden).
 *   duplicable    true = se ofrece "Duplicar".
 *   soloLectura   true = se lista y se borra, pero no se edita ni se crea.
 *   campos        columnas editables (abajo).
 *
 * Y cada campo:
 *
 *   id            clave interna del campo.
 *   etiqueta      su nombre en pantalla.
 *   alias         cómo localizar SU COLUMNA por encabezado. Mismo criterio que usa
 *                 Portal.gs al leer: encabezado en minúsculas que CONTIENE el alias.
 *                 Un alias con '=' delante exige coincidencia exacta ('=promoción').
 *                 EL ORDEN IMPORTA: gana el primer alias que encuentra columna.
 *   tipo          'texto' | 'parrafo' | 'url'
 *   requerido     true = sin él no se guarda (y una fila sin él no se lista).
 *   max           tope de caracteres.
 *   ayuda         microcopy bajo el campo.
 *   sugerencias   valores propuestos (datalist) para campos de vocabulario corto.
 *
 * IMPORTANTE: los alias tienen que coincidir con los que usa Portal.gs para LEER esa
 * misma columna. Si divergen, la pantalla escribiría en una columna que el Portal no
 * mira, y el cambio "se guarda" sin verse nunca.
 */
var PC_COLECCIONES = [
  {
    id: 'herramientas',
    nombre: 'Herramientas',
    hoja: 'Herramientas',
    resumen: 'Los accesos del día a día: CSC, Salesforce, SOMS, rastreos.',
    donde: 'Portal → Herramientas (y los accesos directos del inicio)',
    prefijo: 'htl',
    titulo: 'nombre', subtitulo: 'descripcion', enlaceCampo: 'enlace',
    ordenable: true, duplicable: true, soloLectura: false,
    clave: ['nombre'],
    campos: [
      { id: 'nombre', etiqueta: 'Nombre', alias: ['nombre'], tipo: 'texto',
        requerido: true, max: 120,
        ayuda: 'Como lo busca el asesor. Corto y reconocible: «Salesforce», no «CRM de la operación».' },
      { id: 'enlace', etiqueta: 'Enlace', alias: ['enlace', 'liga', 'link', 'url'], tipo: 'url', max: 800,
        ayuda: 'Pega la dirección completa. Es lo que abre el botón de la tarjeta.' },
      { id: 'comoAcceder', etiqueta: 'Cómo acceder', alias: ['acceder', 'acceso', 'como'], tipo: 'parrafo', max: 400,
        ayuda: 'Con qué credenciales se entra. Ej. «Número de empleado | Liverpool1».' },
      { id: 'descripcion', etiqueta: 'Descripción', alias: ['descr'], tipo: 'parrafo', max: 900,
        ayuda: 'Para qué sirve. Dos o tres líneas bastan.' },
      { id: 'claves', etiqueta: 'Claves', alias: ['clave'], tipo: 'parrafo', max: 300,
        ayuda: 'Palabras con las que alguien podría buscarla aunque no recuerde el nombre.' }
    ]
  },
  {
    id: 'plantillas',
    nombre: 'Plantillas de correo',
    hoja: 'Plantillas',
    resumen: 'Los textos que el asesor copia para escribirle a un cliente o a supervisión.',
    donde: 'Portal → Plantillas · y la pantalla «Correos a clientes»',
    prefijo: 'plt',
    titulo: 'titulo', subtitulo: 'asunto', enlaceCampo: '',
    ordenable: true, duplicable: true, soloLectura: false,
    clave: ['titulo'],
    campos: [
      { id: 'titulo', etiqueta: 'Título', alias: ['titulo', 'título', 'nombre', 'plantilla'], tipo: 'texto',
        requerido: true, max: 140,
        ayuda: 'Qué resuelve la plantilla. Ej. «Diferir pago».' },
      { id: 'tipo', etiqueta: 'Tipo', alias: ['tipo'], tipo: 'texto', max: 60,
        sugerencias: ['Correo', 'Chat', 'WhatsApp', 'Interno'],
        ayuda: 'Por dónde se manda. Sirve para agrupar en el portal.' },
      { id: 'asunto', etiqueta: 'Asunto', alias: ['asunto', 'subject'], tipo: 'texto', max: 250,
        ayuda: 'Los corchetes se quedan tal cual: [Numero de pedido] le avisa al asesor qué reemplazar.' },
      { id: 'cuerpo', etiqueta: 'Cuerpo', alias: ['cuerpo', 'body', 'mensaje', 'texto', 'contenido'], tipo: 'parrafo',
        requerido: true, max: 6000,
        ayuda: 'El texto completo. Los saltos de línea se respetan.' },
      { id: 'consideraciones', etiqueta: 'Consideraciones', alias: ['consider', 'nota', 'escalam', 'copia', 'observ'],
        tipo: 'parrafo', max: 900,
        ayuda: 'A quién va, a quién se copia, qué NO se debe prometer.' }
    ]
  },
  {
    id: 'formatos',
    nombre: 'Formatos',
    hoja: 'Formatos',
    resumen: 'Las hojas y formularios que el equipo tiene que llenar.',
    donde: 'Portal → Formatos',
    prefijo: 'fmt',
    titulo: 'acceso', subtitulo: 'observaciones', enlaceCampo: 'liga',
    ordenable: true, duplicable: true, soloLectura: false,
    clave: ['acceso'],
    campos: [
      { id: 'acceso', etiqueta: 'Nombre del formato', alias: ['acceso', 'nombre', 'formato'], tipo: 'texto',
        requerido: true, max: 140,
        ayuda: 'Ej. «Justificación de retardos».' },
      { id: 'observaciones', etiqueta: 'Observaciones', alias: ['observ', 'nota'], tipo: 'parrafo', max: 600,
        ayuda: 'La regla que hay que saber ANTES de llenarlo. Ej. «Subir el mismo día de la incidencia».' },
      { id: 'liga', etiqueta: 'Enlace', alias: ['liga', 'enlace', 'link', 'url'], tipo: 'url', max: 800 }
    ]
  },
  {
    id: 'presentaciones',
    nombre: 'Presentaciones',
    hoja: 'Presentaciones',
    resumen: 'El material de capacitación que se comparte con el equipo.',
    donde: 'Portal → Presentaciones',
    prefijo: 'prs',
    titulo: 'nombre', subtitulo: 'descripcion', enlaceCampo: 'liga',
    ordenable: true, duplicable: true, soloLectura: false,
    clave: ['nombre'],
    campos: [
      { id: 'nombre', etiqueta: 'Nombre', alias: ['nombre'], tipo: 'texto', requerido: true, max: 140 },
      { id: 'liga', etiqueta: 'Enlace', alias: ['liga', 'enlace', 'link', 'url'], tipo: 'url', max: 800,
        ayuda: 'Comprueba que esté compartida con el dominio, o al asesor le saldrá «Solicitar acceso».' },
      // El encabezado real de la hoja dice «DESCRPCION» (sin la i). Por eso el alias es
      // 'descr' y no 'descrip': con 'descrip' esta columna no se encontraba y la
      // descripción de las presentaciones nunca llegaba al Portal.
      { id: 'descripcion', etiqueta: 'Descripción', alias: ['descr'], tipo: 'parrafo', max: 600 }
    ]
  },
  {
    id: 'paqueterias',
    nombre: 'Paqueterías',
    hoja: 'Paqueterias',
    resumen: 'Los rastreos de las paqueterías y su clave en SOMS.',
    donde: 'Portal → Paqueterías',
    prefijo: 'pqt',
    titulo: 'nombre', subtitulo: 'soms', enlaceCampo: 'liga',
    ordenable: true, duplicable: true, soloLectura: false,
    // Una paquetería sale VARIAS veces, una por clave SOMS (Estafeta con ETF y con
    // EFD son dos filas legítimas): la identidad es el par, no el nombre solo.
    clave: ['nombre', 'soms'],
    campos: [
      { id: 'nombre', etiqueta: 'Paquetería', alias: ['nombre'], tipo: 'texto', requerido: true, max: 120 },
      { id: 'liga', etiqueta: 'Enlace de rastreo', alias: ['liga', 'enlace', 'link', 'url'], tipo: 'url', max: 800 },
      { id: 'soms', etiqueta: 'Clave SOMS', alias: ['soms', 'sistema'], tipo: 'texto', max: 60,
        ayuda: 'La clave con la que aparece en el sistema. Una paquetería puede tener varias: una fila por clave.' }
    ]
  },
  {
    id: 'pdepago',
    nombre: 'Planes de pago',
    hoja: 'PdePago',
    resumen: 'Cómo puede pagar el cliente y qué implica cada opción.',
    donde: 'Portal → Planes de pago',
    prefijo: 'pdp',
    titulo: 'nombre', subtitulo: 'detalles', enlaceCampo: 'liga',
    ordenable: true, duplicable: true, soloLectura: false,
    clave: ['nombre'],
    campos: [
      { id: 'nombre', etiqueta: 'Plan', alias: ['nombre'], tipo: 'texto', requerido: true, max: 140 },
      { id: 'detalles', etiqueta: 'Detalles', alias: ['detalle', 'descrip', 'info'], tipo: 'parrafo', max: 900,
        ayuda: 'Explícalo como se lo dirías al cliente.' },
      { id: 'liga', etiqueta: 'Simulador o enlace', alias: ['liga', 'enlace', 'link', 'url', 'simulad'],
        tipo: 'url', max: 800 }
    ]
  },
  {
    id: 'promociones',
    nombre: 'Promociones',
    hoja: 'Promociones',
    resumen: 'La promoción vigente por categoría. Alimenta el monitor y el contador del inicio.',
    donde: 'Monitor de promociones · y el widget «Hoy en promociones»',
    prefijo: 'pro',
    // El subtítulo admite varios campos separados por coma: en una lista de 115
    // promociones, la categoría sola («Bolsas») no dice de qué dirección es.
    titulo: 'categoria', subtitulo: 'direccion,promocion', enlaceCampo: 'liga',
    // Sin reordenar: esta hoja la ordena el equipo comercial por criterio propio y sus
    // celdas llevan color con significado. Mover filas desde aquí lo desbarataría.
    ordenable: false, duplicable: true, soloLectura: false,
    // «Bolsas» de Mujer y «Bolsas» de Hombre son dos promociones distintas: la
    // identidad es el par dirección+categoría. Con la categoría sola, importar
    // machacaría una con la otra.
    clave: ['direccion', 'categoria'],
    campos: [
      { id: 'direccion', etiqueta: 'Dirección', alias: ['direcci'], tipo: 'texto', requerido: true, max: 80,
        sugerencias: ['Mujer', 'Hombre', 'Niños', 'Hogar', 'Belleza', 'Electrónica', 'Deportes'],
        ayuda: 'La gran división comercial. Es lo que agrupa las tarjetas del monitor.' },
      { id: 'categoria', etiqueta: 'Categoría', alias: ['banner / carrusel', 'banner'], tipo: 'texto', max: 120,
        ayuda: 'La categoría concreta: «Bolsas», «Jeans», «Tenis».' },
      // El encabezado lleva el año («Promoción 2026»), así que el alias exacto se
      // rompería solo el 1 de enero. Los de respaldo cubren otros años y las hojas de
      // comercial que la titulan «Promoción» a secas. Ojo: NINGUNO puede casar con
      // «Promoción AA 2025 (Referencia…)», que es la columna del año anterior.
      { id: 'promocion', etiqueta: 'Promoción',
        alias: ['promoción 2026', 'promocion 2026', 'promoción 202', 'promocion 202', '=promoción', '=promocion'],
        tipo: 'parrafo', max: 400,
        ayuda: 'Tal como se le dice al cliente. Ej. «Hasta 50% de descuento y 6 MSI».' },
      // Coincidencia EXACTA a propósito: con "contiene" esto caía en la columna
      // «Desc Mkp (Se MARCA el cuadro en color amarillo…)» y editar la marca
      // habría sobrescrito el descuento de marketplace.
      { id: 'marca', etiqueta: 'Marca', alias: ['=marca'], tipo: 'texto', max: 120 },
      { id: 'vigencia', etiqueta: 'Vigencia', alias: ['vigencia'], tipo: 'texto', max: 120,
        sugerencias: ['1 al 15 de enero', '10 al 23 de julio'],
        ayuda: 'Escríbela como «10 al 23 de julio». Con ese formato el sistema sabe si sigue viva y la cuenta como activa.' },
      { id: 'liga', etiqueta: 'Enlace', alias: ['liga'], tipo: 'url', max: 800,
        ayuda: 'La página de la categoría en liverpool.com.mx.' }
    ]
  },
  {
    id: 'mkp',
    nombre: 'Marketplace',
    hoja: 'MKP',
    resumen: 'Lo mismo que Promociones, pero de Marketplace.',
    donde: 'Monitor de promociones (marcadas como «Marketplace»)',
    prefijo: 'mkp',
    titulo: 'categoria', subtitulo: 'direccion,promocionMkt', enlaceCampo: 'liga',
    ordenable: false, duplicable: true, soloLectura: false,
    clave: ['direccion', 'categoria'],
    campos: [
      { id: 'direccion', etiqueta: 'Dirección', alias: ['direcci'], tipo: 'texto', requerido: true, max: 80,
        sugerencias: ['Mujer', 'Hombre', 'Niños', 'Hogar', 'Belleza', 'Electrónica', 'Deportes'] },
      { id: 'categoria', etiqueta: 'Categoría', alias: ['banner / carrusel', 'banner'], tipo: 'texto', max: 120 },
      { id: 'promocionMkt', etiqueta: 'Promoción (la que se publica)', alias: ['promoción mktplace', 'mktplace'],
        tipo: 'parrafo', max: 400,
        ayuda: 'Si este campo tiene algo, es LO QUE VE el asesor en el monitor. Manda sobre el de abajo.' },
      { id: 'promocion', etiqueta: 'Promoción (respaldo)', alias: ['=promoción', '=promocion'], tipo: 'parrafo', max: 400,
        ayuda: 'Solo se publica cuando el de arriba está vacío.' },
      { id: 'vigencia', etiqueta: 'Vigencia', alias: ['vigencia'], tipo: 'texto', max: 120,
        ayuda: 'Formato recomendado: «10 al 23 de julio».' },
      { id: 'liga', etiqueta: 'Enlace', alias: ['liga'], tipo: 'url', max: 800 }
    ]
  },
  {
    id: 'reportes',
    nombre: 'Enlaces reportados',
    hoja: 'Reportes',
    resumen: 'Lo que el equipo marcó como roto desde el botón «Reportar» del Portal.',
    donde: 'Lo levantan los asesores desde las tarjetas del Portal',
    prefijo: 'rep',
    titulo: 'nombre', subtitulo: 'seccion', enlaceCampo: 'enlace',
    // Es una bandeja de entrada, no un catálogo: llega sola, se atiende y se archiva.
    ordenable: false, duplicable: false, soloLectura: true,
    clave: ['enlace'],
    campos: [
      { id: 'fecha', etiqueta: 'Fecha', alias: ['fecha'], tipo: 'texto', max: 60 },
      { id: 'seccion', etiqueta: 'Sección', alias: ['secci'], tipo: 'texto', max: 120 },
      { id: 'nombre', etiqueta: 'Qué se reportó', alias: ['nombre'], tipo: 'texto', max: 200 },
      { id: 'enlace', etiqueta: 'Enlace', alias: ['enlace', 'liga', 'link', 'url'], tipo: 'url', max: 800 },
      { id: 'usuario', etiqueta: 'Quién lo reportó', alias: ['usuario', 'correo'], tipo: 'texto', max: 200 }
    ]
  }
];

/** Busca una sección del catálogo por su id. null si no existe. */
function pcColeccion_(id) {
  const clave = String(id || '').trim().toLowerCase();
  for (let i = 0; i < PC_COLECCIONES.length; i++) {
    if (PC_COLECCIONES[i].id === clave) return PC_COLECCIONES[i];
  }
  return null;
}

/** El campo marcado como requerido (el que decide si una fila "existe"). */
function pcCampoRequerido_(col) {
  for (let i = 0; i < col.campos.length; i++) if (col.campos[i].requerido) return col.campos[i];
  return col.campos[0];
}

// ── PUERTA DE ENTRADA ────────────────────────────────────────────────────────

/**
 * Verifica sesión + bloque 'portal_contenido'. Es la MISMA puerta que usa el resto del
 * sistema (Seguridad.gs), así que respeta ajustes por persona y módulos apagados por
 * mantenimiento sin que este archivo sepa nada de eso.
 */
function pcGate_(email) {
  try {
    const id = secIdentidadConBloque_(email, PC_BLOQUE);
    return id.ok
      ? { ok: true, email: id.email, nombre: id.nombre }
      : { ok: false, error: id.error };
  } catch (e) {
    Logger.log('pcGate_: ' + e);
    return { ok: false, error: 'No pudimos verificar tu cuenta. Vuelve a entrar al sistema e inténtalo de nuevo.' };
  }
}

/**
 * Serializa las escrituras. Dos supervisores guardando a la vez en la misma pestaña
 * se pisarían: el segundo leería el ancho y la última fila ANTES de que el primero
 * escribiera, y acabarían los dos en el mismo renglón.
 */
function pcConLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Alguien más está guardando en este momento. Espera unos segundos y vuelve a intentarlo.');
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Invalida lo que el Portal tiene cacheado para que el cambio se vea al recargar. */
function pcInvalidarCache_() {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove('toolsData_v1');   // Index.html
    cache.remove('appData_v1');     // Promociones.html
    cache.remove('pcConteos_v1');   // los números de esta misma pantalla
  } catch (e) {}
}

/** Apunta el cambio en la bitácora de la Consola. Nunca tumba la operación. */
function pcApuntar_(quien, accion, coleccion, detalle) {
  try {
    if (typeof consolaBitacoraApuntar_ === 'function') {
      consolaBitacoraApuntar_(quien, accion, 'Portal · ' + coleccion, detalle || '');
    }
  } catch (e) {
    Logger.log('pcApuntar_: ' + e);
  }
}

// ── LOCALIZACIÓN DE COLUMNAS ─────────────────────────────────────────────────

/** Normaliza un encabezado para compararlo: minúsculas, sin espacios sobrantes. */
function pcNormHdr_(v) {
  return String(v == null ? '' : v).toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Resuelve, para cada campo del catálogo, en qué columna vive.
 *
 * Reglas:
 *   · Mismo criterio flexible que Portal.gs al leer: el encabezado CONTIENE el alias.
 *   · Un alias con '=' delante exige coincidencia exacta. Se usa donde "contiene" es
 *     ambiguo: en MKP, 'promoción' está dentro de 'promoción mktplace'.
 *   · Una columna solo se asigna UNA vez. Sin esto, en MKP los dos campos de promoción
 *     apuntarían a la misma celda y editar uno borraría el otro.
 *
 * @return {Object<string,number>} campoId → índice de columna base 0 (-1 = no existe)
 */
function pcMapaColumnas_(col, hdr) {
  const h = hdr.map(pcNormHdr_);
  const tomadas = {};
  const mapa = {};

  col.campos.forEach(function (campo) {
    let encontrada = -1;
    for (let a = 0; a < campo.alias.length && encontrada < 0; a++) {
      const alias = campo.alias[a];
      const exacto = alias.charAt(0) === '=';
      const buscado = pcNormHdr_(exacto ? alias.slice(1) : alias);
      for (let c = 0; c < h.length; c++) {
        if (tomadas[c] || !h[c]) continue;
        const coincide = exacto ? (h[c] === buscado) : (h[c].indexOf(buscado) !== -1);
        if (coincide) { encontrada = c; break; }
      }
    }
    mapa[campo.id] = encontrada;
    if (encontrada > -1) tomadas[encontrada] = true;
  });

  return mapa;
}

/** Índice base 0 de la columna "ID", o -1 si la pestaña todavía no la tiene. */
function pcColumnaId_(hdr) {
  const h = hdr.map(pcNormHdr_);
  for (let c = 0; c < h.length; c++) if (h[c] === 'id') return c;
  return -1;
}

/**
 * Genera un identificador nuevo. El contador evita colisiones cuando se rellenan
 * cien filas dentro del mismo milisegundo (Date.now() no basta ahí).
 */
var PC_SEQ = 0;
function pcNuevoId_(prefijo) {
  PC_SEQ = (PC_SEQ + 1) % 1296;
  return prefijo + '-' + Date.now().toString(36) + PC_SEQ.toString(36);
}

/**
 * Garantiza que la pestaña tenga columna "ID" y que toda fila con contenido tenga uno.
 *
 * Dónde se pone la columna, en este orden:
 *   1. Si ya existe una columna "ID", esa. (Plantillas y Anuncios ya la traían.)
 *   2. La primera columna del ancho actual cuyo encabezado esté vacío Y cuya columna
 *      esté vacía entera. Promociones arrastra encabezados en blanco hasta la Z:
 *      aprovecharlos es más limpio que colgar la columna después de todos ellos.
 *   3. Al final del todo.
 *
 * Es idempotente: después de la primera vez no escribe nada.
 * @return {{colId:number, hdr:Array, width:number}}
 */
function pcAsegurarIds_(sheet, col) {
  let width = Math.max(sheet.getLastColumn(), 1);
  let hdr = sheet.getRange(1, 1, 1, width).getValues()[0];
  let colId = pcColumnaId_(hdr);
  const ultima = sheet.getLastRow();

  if (colId < 0) {
    let destino = -1;
    for (let c = 0; c < width && destino < 0; c++) {
      if (pcNormHdr_(hdr[c])) continue;
      // Encabezado vacío no basta: hay que comprobar que la columna no lleve datos
      // debajo, o el "ID" aterrizaría encima de algo que alguien escribió sin rotular.
      if (ultima > 1) {
        const abajo = sheet.getRange(2, c + 1, ultima - 1, 1).getValues();
        const tieneDatos = abajo.some(function (r) { return String(r[0] || '').trim() !== ''; });
        if (tieneDatos) continue;
      }
      destino = c;
    }
    if (destino < 0) { destino = width; width = width + 1; }

    // Una hoja recortada a sus columnas justas no tiene dónde poner el ID, y
    // getRange() más allá del último borde revienta en vez de crecer sola.
    const maxCols = sheet.getMaxColumns();
    if (destino + 1 > maxCols) sheet.insertColumnsAfter(maxCols, destino + 1 - maxCols);

    sheet.getRange(1, destino + 1).setValue(PC_COL_ID).setFontWeight('bold');
    colId = destino;
    hdr = sheet.getRange(1, 1, 1, width).getValues()[0];
  }

  // Relleno de los que falten. Una sola lectura y una sola escritura del rango.
  if (ultima > 1) {
    const mapa = pcMapaColumnas_(col, hdr);
    const req = pcCampoRequerido_(col);
    const colReq = mapa[req.id];
    const datos = sheet.getRange(2, 1, ultima - 1, width).getValues();
    const ids = [];
    let faltan = 0;
    for (let i = 0; i < datos.length; i++) {
      const actual = String(datos[i][colId] || '').trim();
      const vivo = colReq > -1 && String(datos[i][colReq] || '').trim() !== '';
      if (!actual && vivo) { ids.push([pcNuevoId_(col.prefijo)]); faltan++; }
      else ids.push([actual]);
    }
    if (faltan) sheet.getRange(2, colId + 1, ids.length, 1).setValues(ids);
  }

  return { colId: colId, hdr: hdr, width: width };
}

// ── VALIDACIÓN ───────────────────────────────────────────────────────────────

/**
 * Revisa y normaliza un enlace.
 *
 * Apps Script NO tiene la API `URL` del navegador, así que aquí se valida con
 * expresiones regulares y la comprobación fina se hace en el cliente, que sí la tiene.
 *
 * Tres casos:
 *   · Esquema peligroso  → se rechaza. Hoy el Portal lo neutraliza por accidente
 *     (linkHref antepone https:// a lo que no empiece por http), pero eso es suerte,
 *     no un control: el día que alguien pinte el valor tal cual, es XSS almacenado.
 *   · Sin esquema pero con pinta de dominio → se completa con https://, que es
 *     exactamente lo que hace el Portal al dibujarla. Mejor guardarlo ya resuelto.
 *   · Texto libre → se guarda, pero se DEVUELVE UN AVISO. La hoja arrastra valores
 *     como «Service Center (liverpool.com.mx)», que el Portal convierte en un enlace
 *     que no abre. No se bloquea la edición por un dato que ya existía; se señala.
 */
function pcNormalizarUrl_(valor) {
  const s = String(valor == null ? '' : valor).trim();
  if (!s) return { ok: true, valor: '', aviso: '' };

  if (/^\s*(javascript|data|vbscript|file|blob)\s*:/i.test(s)) {
    return { ok: false, error: 'Ese tipo de enlace no se permite. Usa una dirección http:// o https://.' };
  }
  if (/^https?:\/\//i.test(s)) {
    if (/\s/.test(s)) {
      return { ok: false, error: 'La dirección tiene espacios. Pégala completa, sin cortarla.' };
    }
    return { ok: true, valor: s, aviso: '' };
  }
  if (/^[\w.-]+\.[a-z]{2,}([\/?#].*)?$/i.test(s)) {
    return { ok: true, valor: 'https://' + s, aviso: '' };
  }
  return {
    ok: true, valor: s,
    aviso: 'Esto no parece una dirección web, así que el botón del portal no va a abrir nada.'
  };
}

/**
 * Valida los datos que llegan del cliente contra el catálogo.
 * @return {{ok:boolean, valores:Object, avisos:Array, errores:Object}}
 */
function pcValidar_(col, datos) {
  const valores = {};
  const errores = {};
  const avisos = [];
  const entrada = (datos && typeof datos === 'object') ? datos : {};

  col.campos.forEach(function (campo) {
    let v = entrada[campo.id];
    v = String(v == null ? '' : v).trim();

    if (campo.tipo === 'url') {
      const r = pcNormalizarUrl_(v);
      if (!r.ok) { errores[campo.id] = r.error; return; }
      v = r.valor;
      if (r.aviso) avisos.push(campo.etiqueta + ': ' + r.aviso);
    }

    if (campo.requerido && !v) {
      errores[campo.id] = 'Este campo no puede quedar vacío.';
      return;
    }
    if (campo.max && v.length > campo.max) {
      errores[campo.id] = 'Máximo ' + campo.max + ' caracteres (llevas ' + v.length + ').';
      return;
    }
    valores[campo.id] = v;
  });

  return { ok: Object.keys(errores).length === 0, valores: valores, avisos: avisos, errores: errores };
}

// ── LECTURA ──────────────────────────────────────────────────────────────────

/** Convierte un valor de celda a texto para la pantalla (las fechas, legibles). */
function pcTexto_(v) {
  if (v instanceof Date) {
    try { return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'); }
    catch (e) { return String(v); }
  }
  return String(v == null ? '' : v).trim();
}

/**
 * Catálogo de secciones con el conteo de cada una: es lo que pinta el conmutador.
 * Los conteos se cachean dos minutos — son para orientar, no para cuadrar nada.
 */
function portalContenidoCatalogo(email) {
  try {
    const gate = pcGate_(email);
    if (!gate.ok) return { status: 'error', error: gate.error };

    let conteos = null;
    try {
      const hit = CacheService.getScriptCache().get('pcConteos_v1');
      if (hit) conteos = JSON.parse(hit);
    } catch (e) {}

    if (!conteos) {
      conteos = {};
      const ss = portalSS_();
      PC_COLECCIONES.forEach(function (col) {
        try {
          const sheet = ss.getSheetByName(col.hoja);
          if (!sheet) { conteos[col.id] = -1; return; }   // -1 = la pestaña no existe
          const ultima = sheet.getLastRow();
          if (ultima < 2) { conteos[col.id] = 0; return; }
          const width = Math.max(sheet.getLastColumn(), 1);
          const hdr = sheet.getRange(1, 1, 1, width).getValues()[0];
          const mapa = pcMapaColumnas_(col, hdr);
          const colReq = mapa[pcCampoRequerido_(col).id];
          if (colReq < 0) { conteos[col.id] = 0; return; }
          const vals = sheet.getRange(2, colReq + 1, ultima - 1, 1).getValues();
          conteos[col.id] = vals.filter(function (r) { return String(r[0] || '').trim() !== ''; }).length;
        } catch (e) {
          conteos[col.id] = -1;
        }
      });
      try { CacheService.getScriptCache().put('pcConteos_v1', JSON.stringify(conteos), PC_TTL_CONTEOS); } catch (e) {}
    }

    return {
      status: 'ok',
      quien: gate.nombre || gate.email,
      colecciones: PC_COLECCIONES.map(function (col) {
        return {
          id: col.id, nombre: col.nombre, hoja: col.hoja, resumen: col.resumen, donde: col.donde,
          ordenable: !!col.ordenable, duplicable: !!col.duplicable, soloLectura: !!col.soloLectura,
          titulo: col.titulo, subtitulo: col.subtitulo, enlaceCampo: col.enlaceCampo,
          total: conteos[col.id] === undefined ? 0 : conteos[col.id],
          clave: pcCamposClave_(col),
          campos: col.campos.map(function (c) {
            return {
              id: c.id, etiqueta: c.etiqueta, tipo: c.tipo, requerido: !!c.requerido,
              max: c.max || 0, ayuda: c.ayuda || '', sugerencias: c.sugerencias || [],
              // Los alias viajan al cliente para que el modo rápido reconozca los
              // encabezados que pegas con EL MISMO criterio con el que el servidor
              // localiza las columnas en la hoja. Si divergieran, «Banner / Carrusel»
              // se mapearía bien en un sitio y mal en el otro.
              alias: c.alias || []
            };
          })
        };
      })
    };
  } catch (error) {
    Logger.log('portalContenidoCatalogo: ' + error);
    return { status: 'error', error: 'No pudimos leer las secciones del Portal. Inténtalo de nuevo.' };
  }
}

/**
 * Filas de una sección, en el orden en que las ve el asesor (el de la hoja).
 * @param {{email:string, coleccion:string}} p
 */
function portalContenidoListar(p) {
  try {
    const gate = pcGate_(p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const col = pcColeccion_(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };

    const ss = portalSS_();
    const sheet = ss.getSheetByName(col.hoja);
    if (!sheet) {
      return { status: 'error',
               error: 'La pestaña «' + col.hoja + '» no está en la hoja del Portal. Avisa al equipo de Ventel.' };
    }

    // Asegurar los IDs es una escritura, así que va bajo el mismo candado que el resto.
    // Solo escribe la primera vez: después es una lectura y ya.
    const info = pcConLock_(function () { return pcAsegurarIds_(sheet, col); });

    const ultima = sheet.getLastRow();
    if (ultima < 2) return { status: 'ok', filas: [], truncado: false, total: 0 };

    const datos = sheet.getRange(2, 1, ultima - 1, info.width).getValues();
    const mapa = pcMapaColumnas_(col, info.hdr);
    const req = pcCampoRequerido_(col);
    const colReq = mapa[req.id];

    const faltantes = col.campos.filter(function (c) { return mapa[c.id] < 0; })
                                .map(function (c) { return c.etiqueta; });

    const filas = [];
    for (let i = 0; i < datos.length; i++) {
      if (colReq > -1 && !String(datos[i][colReq] || '').trim()) continue;
      const valores = {};
      col.campos.forEach(function (c) {
        valores[c.id] = mapa[c.id] > -1 ? pcTexto_(datos[i][mapa[c.id]]) : '';
      });
      filas.push({
        id: String(datos[i][info.colId] || '').trim(),
        fila: i + 2,
        valores: valores
      });
      if (filas.length >= PC_LIMITE_FILAS) break;
    }

    return {
      status: 'ok',
      filas: filas,
      total: filas.length,
      truncado: filas.length >= PC_LIMITE_FILAS,
      // Si una columna del catálogo no está en la hoja, la pantalla tiene que decirlo:
      // el campo se dibujaría y lo que se escriba en él no iría a ninguna parte.
      camposSinColumna: faltantes
    };
  } catch (error) {
    Logger.log('portalContenidoListar: ' + error);
    return { status: 'error', error: String(error.message || error) };
  }
}

// ── ESCRITURA ────────────────────────────────────────────────────────────────

/** Localiza la fila de un id. -1 si no está. */
function pcBuscarFila_(sheet, colId, id) {
  const ultima = sheet.getLastRow();
  if (ultima < 2) return -1;
  const ids = sheet.getRange(2, colId + 1, ultima - 1, 1).getValues();
  const buscado = String(id).trim();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === buscado) return i + 2;
  }
  return -1;
}

/**
 * Alta o edición de una fila.
 *
 * Escribe SOLO las columnas del catálogo, una a una. Las demás (SKUS Mercaderías,
 * banners de home, lo que el equipo comercial haya añadido) se quedan como estaban.
 *
 * @param {{email:string, coleccion:string, id:string=, datos:Object}} p
 */
function portalContenidoGuardar(p) {
  try {
    const gate = pcGate_(p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const col = pcColeccion_(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };
    if (col.soloLectura) {
      return { status: 'error', error: 'La sección «' + col.nombre + '» no se edita desde aquí.' };
    }

    const check = pcValidar_(col, p && p.datos);
    if (!check.ok) {
      return { status: 'error', error: 'Revisa los campos marcados.', errores: check.errores };
    }

    return pcConLock_(function () {
      const sheet = portalSS_().getSheetByName(col.hoja);
      if (!sheet) return { status: 'error', error: 'No encontramos la pestaña «' + col.hoja + '».' };

      const info = pcAsegurarIds_(sheet, col);
      const mapa = pcMapaColumnas_(col, info.hdr);
      const idEntrada = String((p && p.id) || '').trim();

      let fila = idEntrada ? pcBuscarFila_(sheet, info.colId, idEntrada) : -1;
      let id = idEntrada;
      let esNueva = false;

      if (idEntrada && fila < 0) {
        // El id venía pero ya no está: alguien borró la fila desde el Sheet mientras
        // esta pestaña la tenía abierta. Volver a crearla en silencio duplicaría lo
        // que otra persona acaba de quitar a propósito.
        return { status: 'error',
                 error: 'Esa fila ya no existe: alguien la borró desde la hoja mientras la tenías abierta. Recarga la lista.' };
      }

      if (fila < 0) {
        esNueva = true;
        id = pcNuevoId_(col.prefijo);
        fila = sheet.getLastRow() + 1;
        sheet.getRange(fila, info.colId + 1).setValue(id);
      }

      col.campos.forEach(function (campo) {
        const c = mapa[campo.id];
        if (c < 0) return;                                   // esa columna no está en la hoja
        if (check.valores[campo.id] === undefined) return;
        sheet.getRange(fila, c + 1).setValue(check.valores[campo.id]);
      });

      pcInvalidarCache_();
      const rotulo = check.valores[col.titulo] || id;
      pcApuntar_(gate.email, esNueva ? 'Portal: alta de contenido' : 'Portal: edición de contenido',
                 col.nombre, rotulo);

      return { status: 'ok', id: id, nueva: esNueva, avisos: check.avisos };
    });
  } catch (error) {
    Logger.log('portalContenidoGuardar: ' + error);
    return { status: 'error', error: String(error.message || error) };
  }
}

/** Borra una fila entera. @param {{email:string, coleccion:string, id:string}} p */
function portalContenidoEliminar(p) {
  try {
    const gate = pcGate_(p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const col = pcColeccion_(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };

    return pcConLock_(function () {
      const sheet = portalSS_().getSheetByName(col.hoja);
      if (!sheet) return { status: 'error', error: 'No encontramos la pestaña «' + col.hoja + '».' };

      const info = pcAsegurarIds_(sheet, col);
      const fila = pcBuscarFila_(sheet, info.colId, String((p && p.id) || '').trim());
      if (fila < 0) return { status: 'error', error: 'Esa fila ya no existe. Recarga la lista.' };

      // Se guarda el rótulo ANTES de borrar: después ya no hay de dónde sacarlo para
      // la bitácora, y "se borró la fila 47" no le sirve a nadie dentro de un mes.
      const mapa = pcMapaColumnas_(col, info.hdr);
      const cTit = mapa[col.titulo];
      const rotulo = cTit > -1 ? pcTexto_(sheet.getRange(fila, cTit + 1).getValue()) : String(p.id);

      sheet.deleteRow(fila);
      pcInvalidarCache_();
      pcApuntar_(gate.email, 'Portal: baja de contenido', col.nombre, rotulo);
      return { status: 'ok' };
    });
  } catch (error) {
    Logger.log('portalContenidoEliminar: ' + error);
    return { status: 'error', error: String(error.message || error) };
  }
}

/**
 * Copia una fila justo debajo de la original, con un id nuevo.
 * Copia la FILA ENTERA (no solo las columnas del catálogo) para no perder lo que
 * viva en las columnas que esta pantalla no gestiona.
 */
function portalContenidoDuplicar(p) {
  try {
    const gate = pcGate_(p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const col = pcColeccion_(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };
    if (!col.duplicable) return { status: 'error', error: 'Esta sección no admite duplicar.' };

    return pcConLock_(function () {
      const sheet = portalSS_().getSheetByName(col.hoja);
      if (!sheet) return { status: 'error', error: 'No encontramos la pestaña «' + col.hoja + '».' };

      const info = pcAsegurarIds_(sheet, col);
      const fila = pcBuscarFila_(sheet, info.colId, String((p && p.id) || '').trim());
      if (fila < 0) return { status: 'error', error: 'Esa fila ya no existe. Recarga la lista.' };

      const valores = sheet.getRange(fila, 1, 1, info.width).getValues()[0];
      const mapa = pcMapaColumnas_(col, info.hdr);
      const id = pcNuevoId_(col.prefijo);
      valores[info.colId] = id;

      // El título lleva "(copia)" para que las dos filas no sean indistinguibles en la
      // lista. Se recorta si con el sufijo se pasa del máximo del campo.
      const cTit = mapa[col.titulo];
      if (cTit > -1) {
        const campoTit = col.campos.filter(function (c) { return c.id === col.titulo; })[0];
        const tope = (campoTit && campoTit.max) || 140;
        let nuevo = String(valores[cTit] || '') + ' (copia)';
        if (nuevo.length > tope) nuevo = nuevo.slice(0, tope - 8).trim() + ' (copia)';
        valores[cTit] = nuevo;
      }

      sheet.insertRowAfter(fila);
      sheet.getRange(fila + 1, 1, 1, info.width).setValues([valores]);

      pcInvalidarCache_();
      pcApuntar_(gate.email, 'Portal: duplicado de contenido', col.nombre, cTit > -1 ? valores[cTit] : id);
      return { status: 'ok', id: id };
    });
  } catch (error) {
    Logger.log('portalContenidoDuplicar: ' + error);
    return { status: 'error', error: String(error.message || error) };
  }
}

/**
 * Sube o baja una fila un puesto. El Portal pinta las tarjetas en el orden de la hoja,
 * así que mover la fila ES cambiar lo que el asesor ve primero.
 *
 * Se usa moveRows y no un intercambio de valores a propósito: moveRows arrastra el
 * formato de la celda, y en estas hojas el color a veces significa algo.
 *
 * "Un puesto" es respecto a la lista VISIBLE, no a la hoja: entre dos filas con
 * contenido puede haber renglones vacíos que el asesor nunca ve.
 *
 * @param {{email:string, coleccion:string, id:string, dir:string}} p  dir: 'up' | 'down'
 */
function portalContenidoMover(p) {
  try {
    const gate = pcGate_(p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const col = pcColeccion_(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };
    if (!col.ordenable) return { status: 'error', error: 'El orden de esta sección se lleva desde la hoja.' };

    const dir = String((p && p.dir) || '').toLowerCase();
    if (dir !== 'up' && dir !== 'down') return { status: 'error', error: 'Dirección no válida.' };

    return pcConLock_(function () {
      const sheet = portalSS_().getSheetByName(col.hoja);
      if (!sheet) return { status: 'error', error: 'No encontramos la pestaña «' + col.hoja + '».' };

      const info = pcAsegurarIds_(sheet, col);
      const ultima = sheet.getLastRow();
      if (ultima < 3) return { status: 'ok' };               // 0 o 1 filas: nada que mover

      const datos = sheet.getRange(2, 1, ultima - 1, info.width).getValues();
      const mapa = pcMapaColumnas_(col, info.hdr);
      const colReq = mapa[pcCampoRequerido_(col).id];

      // Filas con contenido, en el orden en que las ve el asesor.
      const visibles = [];
      for (let i = 0; i < datos.length; i++) {
        if (colReq > -1 && !String(datos[i][colReq] || '').trim()) continue;
        visibles.push({ id: String(datos[i][info.colId] || '').trim(), fila: i + 2 });
      }

      const pos = visibles.map(function (v) { return v.id; }).indexOf(String((p && p.id) || '').trim());
      if (pos < 0) return { status: 'error', error: 'Esa fila ya no existe. Recarga la lista.' };

      const destinoPos = dir === 'up' ? pos - 1 : pos + 1;
      if (destinoPos < 0 || destinoPos >= visibles.length) return { status: 'ok' }; // ya está en el borde

      const origen = visibles[pos].fila;
      const vecina = visibles[destinoPos].fila;

      // moveRows inserta ANTES del índice destino contando la tabla sin mover todavía:
      // hacia arriba el destino es la fila de la vecina; hacia abajo hay que sumar uno
      // más, porque la propia fila que se va sigue contando en ese índice.
      sheet.moveRows(sheet.getRange(origen, 1, 1, info.width), dir === 'up' ? vecina : vecina + 1);

      pcInvalidarCache_();
      return { status: 'ok' };
    });
  } catch (error) {
    Logger.log('portalContenidoMover: ' + error);
    return { status: 'error', error: String(error.message || error) };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MODO RÁPIDO — pegar muchas filas de golpe
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Copiar de una hoja de cálculo y pegar en el Portal. Pegar sin más es la forma
 * más rápida de llenar una sección de basura duplicada, así que TODA importación
 * pasa antes por un análisis que dice, fila por fila, qué va a ocurrir.
 *
 * LOS SEGUROS
 *
 *   1. IDENTIDAD POR SECCIÓN. Cada sección declara en el catálogo qué campos la
 *      identifican (`clave`). No es siempre el título: dos promociones «Bolsas»
 *      son distintas si una es de Mujer y otra de Hombre, y «Estafeta» aparece
 *      varias veces, una por clave SOMS. Comparar por lo que no toca es
 *      exactamente cómo se duplican o se machacan filas.
 *
 *   2. LA COMPARACIÓN IGNORA EL RUIDO. Mayúsculas, acentos, espacios dobles y
 *      espacios al final NO hacen distinta a una fila: en estas hojas «MUJER  » y
 *      «Mujer» son lo mismo, y tratarlos como dos cosas es el duplicado clásico.
 *
 *   3. SE DETECTA LO QUE NO CAMBIA. Si la fila pegada es idéntica a la que ya
 *      está, se marca «sin cambios» y no se escribe. Reimportar la misma hoja dos
 *      veces no debe tocar nada.
 *
 *   4. DUPLICADOS DENTRO DEL PROPIO PEGADO. Si el texto pegado trae dos veces la
 *      misma clave, solo entra la primera.
 *
 *   5. NUNCA BORRA. Lo que está en el Portal y no viene en el pegado se queda.
 *      Una importación no es un reemplazo.
 *
 *   6. NADA SE ESCRIBE SIN CONFIRMAR. Analizar no toca la hoja; el que aplica es
 *      un segundo paso, y el servidor VUELVE A CALCULAR el plan en ese momento en
 *      vez de fiarse del que mandó el cliente.
 */

/** Tope de filas por importación. Más que esto es un trabajo para la hoja, no para la app. */
var PC_IMPORT_MAX = 300;

/**
 * Texto reducido a lo comparable: sin acentos, sin mayúsculas, sin espacios de más.
 * Es lo que decide si dos filas «son la misma».
 */
// El rango de acentos combinantes se construye desde una CADENA, no como literal
// de expresión regular: un carácter combinante suelto en el código fuente se
// corrompe en cuanto el archivo pasa por un editor con otra codificación, y el
// fallo es mudo (deja de quitar acentos y todo se vuelve "distinto").
var PC_RE_ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g');

function pcClave_(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(PC_RE_ACENTOS, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Campos que identifican una fila de esta sección. */
function pcCamposClave_(col) {
  return (col.clave && col.clave.length) ? col.clave : [col.titulo];
}

/** Clave de identidad de un registro, a partir de sus valores por campo. */
function pcClaveDe_(col, valores) {
  return pcCamposClave_(col).map(function (id) { return pcClave_(valores[id]); }).join(' ¦ ');
}

/**
 * Compara el plan de importación contra lo que ya hay en la hoja.
 * No escribe nada: lo usan tanto el análisis como la aplicación (que lo recalcula).
 *
 * @param {Object} col      sección del catálogo
 * @param {Object} info     salida de pcAsegurarIds_ (colId, hdr, width)
 * @param {Sheet}  sheet    pestaña del Portal
 * @param {Array}  entrada  filas del cliente: [{valores por campo}]
 * @return {{plan:Array, resumen:Object}}
 */
function pcPlanImport_(col, info, sheet, entrada) {
  const mapa = pcMapaColumnas_(col, info.hdr);
  const req = pcCampoRequerido_(col);
  const colReq = mapa[req.id];

  // Índice de lo que ya existe: clave → {id, fila, valores}
  const existentes = {};
  const ultima = sheet.getLastRow();
  if (ultima > 1) {
    const datos = sheet.getRange(2, 1, ultima - 1, info.width).getValues();
    for (let i = 0; i < datos.length; i++) {
      if (colReq > -1 && !String(datos[i][colReq] || '').trim()) continue;
      const valores = {};
      col.campos.forEach(function (c) {
        valores[c.id] = mapa[c.id] > -1 ? pcTexto_(datos[i][mapa[c.id]]) : '';
      });
      const k = pcClaveDe_(col, valores);
      // Si la hoja ya trae la clave repetida, manda la PRIMERA: es la que el Portal
      // enseña arriba, y actualizar la de abajo dejaría dos versiones distintas.
      if (!existentes[k]) {
        existentes[k] = { id: String(datos[i][info.colId] || '').trim(), fila: i + 2, valores: valores };
      }
    }
  }

  const vistas = {};
  const plan = [];
  const resumen = { nuevas: 0, actualiza: 0, iguales: 0, duplicadas: 0, errores: 0 };

  for (let n = 0; n < entrada.length; n++) {
    const check = pcValidar_(col, entrada[n]);
    const etiqueta = String((entrada[n] || {})[col.titulo] || (entrada[n] || {})[pcCamposClave_(col)[0]] || '').trim();

    if (!check.ok) {
      const primero = Object.keys(check.errores)[0];
      plan.push({ n: n, accion: 'error', titulo: etiqueta,
                  detalle: primero + ': ' + check.errores[primero] });
      resumen.errores++;
      continue;
    }

    const k = pcClaveDe_(col, check.valores);
    if (!pcClave_(k.replace(/¦/g, ''))) {
      plan.push({ n: n, accion: 'error', titulo: etiqueta, detalle: 'La fila no tiene con qué identificarse.' });
      resumen.errores++;
      continue;
    }

    // Se guarda n+1, NO n: el índice de la primera fila es 0 y `if (vistas[k])` lo
    // daba por «no visto», así que un duplicado de la primera fila pegada se colaba
    // como alta nueva — justo el caso que este seguro tiene que atrapar.
    if (vistas[k]) {
      plan.push({ n: n, accion: 'duplicada', titulo: etiqueta,
                  detalle: 'Repetida en lo que pegaste (ya venía en la fila ' + vistas[k] + ').' });
      resumen.duplicadas++;
      continue;
    }
    vistas[k] = n + 1;

    const ya = existentes[k];
    if (!ya) {
      plan.push({ n: n, accion: 'nueva', titulo: etiqueta, valores: check.valores, avisos: check.avisos });
      resumen.nuevas++;
      continue;
    }

    // Solo cuentan como cambio los campos que VIENEN en el pegado: una columna que
    // no trajiste no debe vaciar lo que ya estaba escrito en el Portal.
    const cambios = [];
    col.campos.forEach(function (c) {
      if (mapa[c.id] < 0) return;
      if (entrada[n][c.id] === undefined) return;
      if (pcClave_(check.valores[c.id]) !== pcClave_(ya.valores[c.id])) cambios.push(c.etiqueta);
    });

    if (!cambios.length) {
      plan.push({ n: n, accion: 'igual', titulo: etiqueta, id: ya.id });
      resumen.iguales++;
    } else {
      plan.push({ n: n, accion: 'actualiza', titulo: etiqueta, id: ya.id, fila: ya.fila,
                  cambios: cambios, valores: check.valores, avisos: check.avisos });
      resumen.actualiza++;
    }
  }

  return { plan: plan, resumen: resumen };
}

/** Deja la entrada del cliente en filas limpias, o lanza si viene mal. */
function pcEntradaImport_(col, filas) {
  if (!filas || !filas.length) throw new Error('No llegó ninguna fila.');
  if (filas.length > PC_IMPORT_MAX) {
    throw new Error('Son ' + filas.length + ' filas y el máximo por importación es ' +
                    PC_IMPORT_MAX + '. Pega menos de golpe.');
  }
  const validos = {};
  col.campos.forEach(function (c) { validos[c.id] = true; });
  return filas.map(function (f) {
    const limpia = {};
    Object.keys(f || {}).forEach(function (k) {
      if (validos[k]) limpia[k] = String(f[k] == null ? '' : f[k]).trim();
    });
    return limpia;
  });
}

/** Qué pasaría si se importa. NO escribe (salvo asegurar la columna ID). */
function portalContenidoAnalizarImport(p) {
  try {
    const gate = pcGate_(p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const col = pcColeccion_(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };
    if (col.soloLectura) return { status: 'error', error: 'En «' + col.nombre + '» no se importa nada.' };

    const entrada = pcEntradaImport_(col, p && p.filas);

    return pcConLock_(function () {
      const sheet = portalSS_().getSheetByName(col.hoja);
      if (!sheet) return { status: 'error', error: 'No encontramos la pestaña «' + col.hoja + '».' };
      const info = pcAsegurarIds_(sheet, col);
      const r = pcPlanImport_(col, info, sheet, entrada);
      return {
        status: 'ok', plan: r.plan, resumen: r.resumen,
        clave: pcCamposClave_(col).map(function (id) {
          const c = col.campos.filter(function (x) { return x.id === id; })[0];
          return c ? c.etiqueta : id;
        })
      };
    });
  } catch (error) {
    Logger.log('portalContenidoAnalizarImport: ' + error);
    return { status: 'error', error: String(error.message || error) };
  }
}

/**
 * Aplica la importación. Recalcula el plan aquí dentro a propósito: entre el
 * análisis y el «Aplicar» pueden haber pasado minutos y otra persona pudo tocar la
 * hoja. Fiarse del plan que manda el cliente sería escribir sobre datos que ya no
 * están donde se creía.
 *
 * @param {{email, coleccion, filas, actualizar:boolean}} p
 *        actualizar=false → solo se dan de alta las nuevas; las que ya existen se dejan.
 */
function portalContenidoAplicarImport(p) {
  try {
    const gate = pcGate_(p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const col = pcColeccion_(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };
    if (col.soloLectura) return { status: 'error', error: 'En «' + col.nombre + '» no se importa nada.' };

    const entrada = pcEntradaImport_(col, p && p.filas);
    const actualizar = p.actualizar !== false;

    return pcConLock_(function () {
      const sheet = portalSS_().getSheetByName(col.hoja);
      if (!sheet) return { status: 'error', error: 'No encontramos la pestaña «' + col.hoja + '».' };

      const info = pcAsegurarIds_(sheet, col);
      const mapa = pcMapaColumnas_(col, info.hdr);
      const r = pcPlanImport_(col, info, sheet, entrada);

      // ── Altas: una sola escritura para todas ──
      const nuevas = r.plan.filter(function (x) { return x.accion === 'nueva'; });
      if (nuevas.length) {
        const bloque = nuevas.map(function (x) {
          const fila = [];
          for (let i = 0; i < info.width; i++) fila[i] = '';
          fila[info.colId] = pcNuevoId_(col.prefijo);
          col.campos.forEach(function (c) {
            if (mapa[c.id] > -1 && x.valores[c.id] !== undefined) fila[mapa[c.id]] = x.valores[c.id];
          });
          return fila;
        });
        sheet.getRange(sheet.getLastRow() + 1, 1, bloque.length, info.width).setValues(bloque);
      }

      // ── Actualizaciones: celda a celda, y solo las que de verdad cambian ──
      let actualizadas = 0;
      if (actualizar) {
        r.plan.forEach(function (x) {
          if (x.accion !== 'actualiza') return;
          col.campos.forEach(function (c) {
            if (mapa[c.id] < 0 || x.valores[c.id] === undefined) return;
            sheet.getRange(x.fila, mapa[c.id] + 1).setValue(x.valores[c.id]);
          });
          actualizadas++;
        });
      }

      pcInvalidarCache_();
      pcApuntar_(gate.email, 'Portal: importación', col.nombre,
                 nuevas.length + ' altas · ' + actualizadas + ' actualizadas · ' +
                 r.resumen.iguales + ' sin cambios · ' + r.resumen.duplicadas + ' duplicadas · ' +
                 r.resumen.errores + ' con error');

      return {
        status: 'ok',
        resumen: {
          nuevas: nuevas.length,
          actualiza: actualizadas,
          omitidasPorNoActualizar: actualizar ? 0 : r.resumen.actualiza,
          iguales: r.resumen.iguales,
          duplicadas: r.resumen.duplicadas,
          errores: r.resumen.errores
        }
      };
    });
  } catch (error) {
    Logger.log('portalContenidoAplicarImport: ' + error);
    return { status: 'error', error: String(error.message || error) };
  }
}

// ── DIAGNÓSTICO ──────────────────────────────────────────────────────────────

/**
 * Ejecútala desde el editor cuando cambies el catálogo o cuando alguien renombre una
 * columna en la hoja del Portal. Comprueba, sección por sección, que cada campo tenga
 * su columna. Un campo sin columna se dibuja en el formulario y lo que se escriba en
 * él no llega a ninguna parte: es el fallo más silencioso que puede tener este archivo.
 */
function pcRevisarCatalogo() {
  secSoloInterno_('pcRevisarCatalogo');
  const ss = portalSS_();
  const problemas = [];
  Logger.log('═══ CONTENIDO DEL PORTAL · columnas por sección ═══');

  PC_COLECCIONES.forEach(function (col) {
    const sheet = ss.getSheetByName(col.hoja);
    if (!sheet) {
      Logger.log('  ✖ ' + col.nombre + ' → falta la pestaña «' + col.hoja + '»');
      problemas.push(col.nombre + ': sin pestaña');
      return;
    }
    const width = Math.max(sheet.getLastColumn(), 1);
    const hdr = sheet.getRange(1, 1, 1, width).getValues()[0];
    const mapa = pcMapaColumnas_(col, hdr);
    const sinColumna = col.campos.filter(function (c) { return mapa[c.id] < 0; });

    if (!sinColumna.length) {
      Logger.log('  ✔ ' + col.nombre + ' → ' + col.campos.length + ' campos localizados' +
                 (pcColumnaId_(hdr) > -1 ? ' · con columna ID' : ' · SIN columna ID todavía'));
    } else {
      Logger.log('  ✖ ' + col.nombre + ' → sin columna: ' +
                 sinColumna.map(function (c) { return c.etiqueta; }).join(', '));
      problemas.push(col.nombre + ': ' + sinColumna.map(function (c) { return c.id; }).join(','));
    }
  });

  Logger.log('───────────────────────────────────────');
  Logger.log(problemas.length ? 'ATENCIÓN: ' + problemas.join(' | ') : 'Catálogo alineado con la hoja del Portal.');
  return problemas;
}
