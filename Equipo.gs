/**
 * =====================================================================================
 * GESTIÓN DEL EQUIPO (sin ser maestro) | Sistema de cotizaciones Ventel
 * =====================================================================================
 * Deja que una supervisión maneje los roles y los accesos de SUS ASESORES sin tener que
 * ser maestro y sin poder ampliarse a sí misma.
 *
 * POR QUÉ EXISTE
 * --------------
 * Hasta ahora, cambiar el rol de alguien —o darlo de baja el día que se fue— solo lo
 * podía hacer un maestro desde la consola. En la práctica eso no hacía el sistema más
 * seguro: hacía que circularan cuentas maestras de más, porque la coordinación
 * necesitaba resolver altas y bajas el mismo día y la única llave disponible abría
 * TODO —ajustes, webhook, identificadores de hojas, bitácora—. Un permiso demasiado
 * grande para la tarea acaba repartido más de la cuenta; ese es el riesgo real que
 * este archivo viene a quitar.
 *
 * EL CANDADO, EN UNA FRASE
 * ------------------------
 *   Puedes gestionar a quien NO puede gestionar a nadie.
 *
 * De ahí sale todo lo demás, y por eso está escrito así y no como una lista de casos:
 *
 *   · No puedes tocarte a ti mismo. Ni el rol, ni los bloques, ni el alta.
 *   · No puedes tocar a un maestro.
 *   · No puedes tocar a nadie que tenga 'sup_equipo' —es decir, a otro gestor—, ni
 *     aunque su rol sea de asesor.
 *   · No puedes conceder un bloque que tú no tengas. Nadie reparte lo que no posee.
 *   · No puedes conceder bloques de administración, ni nombrar maestro a nadie.
 *
 * POR QUÉ LA TERCERA REGLA ES LA IMPORTANTE
 * -----------------------------------------
 * Las dos primeras son obvias; la tercera es la que cierra la puerta de atrás. Sin
 * ella existiría este rodeo: a una supervisión a la que un maestro le retiró 'revisar'
 * le bastaría ascender a un asesor de confianza y pedirle que se lo devolviera. Con
 * ella, en el instante en que alguien pasa a poder gestionar —por ascenso o por
 * concesión directa— sale de la jurisdicción de quien lo ascendió, y los dos quedan
 * fuera del alcance del otro. Nadie puede usar a un tercero como espejo para subirse
 * los permisos, que es exactamente lo que había que impedir.
 *
 * Todo cambio queda en la bitácora con el nombre de quien lo hizo. Un permiso
 * delegado sin rastro no es delegación, es un agujero.
 */

/** Roles que una gestión de equipo puede asignar. 'maestro' NUNCA está aquí. */
const EQUIPO_ROLES_ASIGNABLES = ['normal', 'avanzado'];

/**
 * Puerta de entrada de todo este archivo.
 * @return {{ok:boolean, email:string, nombre:string, bloques:string[], error:string}}
 */
function equipoGate_(email) {
  return secIdentidadConBloque_(email, 'sup_equipo');
}

function equipoError_(mensaje) {
  return { success: false, message: mensaje || 'No se pudo completar la operación.' };
}

/**
 * ¿Este miembro puede gestionar a otros? Es la pregunta que define la jurisdicción.
 * Se mira el BLOQUE EFECTIVO y no el rol: alguien puede tener 'sup_equipo' concedido
 * a mano sin ser supervisor, y sigue siendo un gestor a todos los efectos.
 */
function equipoEsGestor_(usuario) {
  return !!usuario && (usuario.maestro === true || (usuario.bloques || []).indexOf('sup_equipo') !== -1);
}

/**
 * ¿Puede `quien` gestionar a `objetivo`? Devuelve el motivo, o '' si sí puede.
 * Un motivo en cristiano y no un booleano: la pantalla tiene que poder explicar por
 * qué una fila está en gris, o parecerá que el sistema falla.
 */
function equipoVeto_(quien, objetivo) {
  if (secNormalizarCorreo_(quien.email) === secNormalizarCorreo_(objetivo.email)) {
    return 'No puedes cambiar tus propios permisos. Pídeselo a un maestro.';
  }
  if (!objetivo.encontrado) return 'Esa persona no está dada de alta.';
  if (objetivo.maestro) return 'Solo un maestro puede cambiar a otro maestro.';
  if (equipoEsGestor_(objetivo)) {
    return 'Esta persona también gestiona equipo. Solo un maestro puede cambiar sus permisos.';
  }
  return '';
}

/**
 * Bloques que ESTA persona puede repartir: los que tiene, sin los de administración.
 *
 * Se calcula a partir de sus bloques efectivos y no de su rol, para que un retiro
 * hecho por un maestro ('menos') se respete también aquí: a quien le quitaron
 * 'anuncios' no puede concedérselo a nadie.
 */
function equipoBloquesRepartibles_(bloquesDeQuien) {
  return (bloquesDeQuien || []).filter(function (id) {
    return PERM_IDS_ADMIN.indexOf(id) === -1;
  });
}

/**
 * Todo lo que el panel de equipo necesita al abrirse, en una sola llamada.
 *
 * @param {string} email Correo de la sesión del portal.
 * @return {{success:boolean, yo:object, asesores:Array, catalogo:object, message:string}}
 */
function equipoPanorama(email) {
  try {
    const gate = equipoGate_(email);
    if (!gate.ok) return equipoError_(gate.error);

    const yo = permUsuario_(gate.email);
    const repartibles = equipoBloquesRepartibles_(yo.bloques);
    const indice = secIndiceRegistros_();

    const gente = Object.keys(indice).map(function (correo) {
      const u = permUsuario_(correo);
      const veto = equipoVeto_(yo, u);
      return {
        email: u.email,
        nombre: u.nombre || (indice[correo].nombre || ''),
        rol: u.rol,
        rolNombre: u.rolNombre,
        activo: u.activo,
        bloques: u.bloques,
        ajustes: u.ajustes,
        // Las filas que no se pueden tocar SE ENSEÑAN igual, en gris y con el motivo.
        // Esconderlas dejaría a la supervisión sin saber quién está en su equipo, y
        // convertiría "no puedo" en "no existe", que son cosas distintas.
        gestionable: veto === '',
        motivo: veto
      };
    }).sort(function (a, b) {
      // Primero quien sí se puede gestionar: es a lo que se viene a esta pantalla.
      if (a.gestionable !== b.gestionable) return a.gestionable ? -1 : 1;
      if (a.activo !== b.activo) return a.activo ? -1 : 1;
      return (a.nombre || a.email).localeCompare(b.nombre || b.email, 'es');
    });

    const apagados = permModulosApagados_();

    return {
      success: true,
      yo: { email: yo.email, nombre: yo.nombre, rol: yo.rol, rolNombre: yo.rolNombre, bloques: yo.bloques },
      asesores: gente,
      catalogo: {
        // Solo lo que esta persona puede repartir: un catálogo con casillas que van a
        // ser rechazadas es un formulario que enseña a desconfiar de sí mismo.
        bloques: PERM_BLOQUES.filter(function (b) { return repartibles.indexOf(b.id) !== -1; })
          .map(function (b) {
            return { id: b.id, nombre: b.nombre, detalle: b.detalle, grupo: b.grupo,
                     apagado: apagados.indexOf(b.id) !== -1 };
          }),
        grupos: PERM_GRUPOS.filter(function (g) { return g !== 'Administración'; }),
        roles: EQUIPO_ROLES_ASIGNABLES.map(function (id) {
          const r = PERM_ROLES[id];
          return { id: r.id, nombre: r.nombre, detalle: r.detalle,
                   bloques: r.bloques.filter(function (b) { return repartibles.indexOf(b) !== -1; }) };
        })
      },
      message: ''
    };
  } catch (e) {
    Logger.log('equipoPanorama error: ' + e + ' · ' + e.stack);
    return equipoError_('No pudimos cargar tu equipo. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Cambia el rol, los accesos o el alta/baja de un asesor.
 *
 * @param {string} email  Correo de quien hace el cambio.
 * @param {object} cambio { email, rol?, mas?[], menos?[], activo? }
 *        Solo se aplica lo que llegue: mandar {email, activo:false} da de baja sin
 *        tocar nada más.
 */
function equipoGuardarMiembro(email, cambio) {
  try {
    const gate = equipoGate_(email);
    if (!gate.ok) return equipoError_(gate.error);

    const c = cambio || {};
    const objetivo = secNormalizarCorreo_(c.email);
    if (!objetivo) return equipoError_('Falta el correo de la persona que quieres cambiar.');

    const yo = permUsuario_(gate.email);
    const antes = permUsuario_(objetivo);

    const veto = equipoVeto_(yo, antes);
    if (veto) return equipoError_(veto);

    // ── Rol ──────────────────────────────────────────────────────────────────
    let rolPedido = '';
    if (c.rol !== undefined && c.rol !== null && c.rol !== '') {
      rolPedido = permNormalizarRol_(c.rol);
      if (!rolPedido) return equipoError_('El rol "' + c.rol + '" no existe.');
      if (EQUIPO_ROLES_ASIGNABLES.indexOf(rolPedido) === -1) {
        return equipoError_('Solo un maestro puede nombrar a otro maestro.');
      }
    }

    // ── Bloques ──────────────────────────────────────────────────────────────
    const repartibles = equipoBloquesRepartibles_(yo.bloques);
    const tocaPermisos = (c.mas !== undefined || c.menos !== undefined);
    let ajustes = antes.ajustes;

    if (tocaPermisos) {
      const pedidoMas = Array.isArray(c.mas) ? c.mas : [];
      const pedidoMenos = Array.isArray(c.menos) ? c.menos : [];

      // Conceder lo que uno no tiene es la definición de subirse los permisos por
      // interpósita persona. Se rechaza con nombre y apellido en vez de filtrarlo en
      // silencio: si la pantalla ofreció esa casilla, hay algo que arreglar arriba.
      const deMas = pedidoMas.filter(function (id) { return repartibles.indexOf(id) === -1; });
      if (deMas.length) {
        const b = permBloque_(deMas[0]);
        return equipoError_('No puedes conceder "' + ((b && b.nombre) || deMas[0]) +
                            '": tú no lo tienes.');
      }

      // Retirar sí se puede aunque uno no lo tenga —quitar nunca amplía a nadie—, pero
      // no sobre bloques de administración, que no son asunto de esta pantalla.
      const menosAdmin = pedidoMenos.filter(function (id) { return PERM_IDS_ADMIN.indexOf(id) !== -1; });
      if (menosAdmin.length) {
        return equipoError_('Los permisos de administración solo los maneja un maestro.');
      }

      ajustes = permLimpiarAjustes_({ mas: pedidoMas, menos: pedidoMenos });

      // Un bloque que ya viene con el rol no necesita concesión, y uno que el rol no da
      // no necesita retiro: guardarlos solo ensucia la celda.
      const delRol = permBloquesDeRol_(rolPedido || antes.rol);
      ajustes.mas = ajustes.mas.filter(function (id) { return delRol.indexOf(id) === -1; });
      ajustes.menos = ajustes.menos.filter(function (id) { return delRol.indexOf(id) !== -1; });

      // Los ajustes de ADMINISTRACIÓN que ya tuviera guardados no se pierden por pasar
      // por aquí: esta pantalla no los enseña, así que tampoco puede borrarlos sin
      // querer. Solo un maestro los pone y solo un maestro los quita.
      (antes.ajustes.mas || []).forEach(function (id) {
        if (PERM_IDS_ADMIN.indexOf(id) !== -1 && ajustes.mas.indexOf(id) === -1) ajustes.mas.push(id);
      });
      (antes.ajustes.menos || []).forEach(function (id) {
        if (PERM_IDS_ADMIN.indexOf(id) !== -1 && ajustes.menos.indexOf(id) === -1) ajustes.menos.push(id);
      });
    }

    // ── ¿En qué queda esa persona? Última comprobación, sobre el resultado ────
    // Se valida el ESTADO FINAL y no solo lo que se pidió: la combinación de un rol
    // nuevo con las excepciones de antes podía dejar a alguien con 'sup_equipo' sin
    // que ninguna de las dos cosas, por separado, lo pareciera.
    const rolFinal = rolPedido || antes.rol;
    const bloquesFinales = permBloquesEfectivos_(rolFinal, ajustes);
    const seVuelveGestor = bloquesFinales.indexOf('sup_equipo') !== -1;

    // Ascender a supervisor SÍ está permitido, y con ello viene la gestión de equipo:
    // es la forma normal de que crezca una coordinación. Lo que no se permite es que
    // eso sirva de rodeo, y no sirve: desde este mismo instante esa persona queda
    // fuera del alcance de quien la ascendió (equipoVeto_ la protege), así que no
    // puede devolverle el favor.
    if (seVuelveGestor && !equipoEsGestor_(antes)) {
      Logger.log('equipo: ' + gate.email + ' asciende a ' + objetivo + ' a gestor de equipo.');
    }

    // ── Escritura ────────────────────────────────────────────────────────────
    const activoPedido = (c.activo === undefined || c.activo === null) ? undefined : (c.activo === true);
    const campos = {};
    const notas = [];

    if (rolPedido && rolPedido !== antes.rol) {
      campos[PERM_COL_ROL] = rolPedido;
      notas.push('rol ' + antes.rol + ' → ' + rolPedido);
    } else if (rolPedido && antes.heredado) {
      campos[PERM_COL_ROL] = rolPedido;   // deja de deducirse de la columna "Avanzado"
    }

    if (tocaPermisos) {
      const nuevoTexto = permSerializarAjustes_(ajustes);
      if (nuevoTexto !== permSerializarAjustes_(antes.ajustes)) {
        campos[PERM_COL_PERMISOS] = nuevoTexto;
        notas.push('permisos +[' + (ajustes.mas.join(', ') || '—') + '] −[' + (ajustes.menos.join(', ') || '—') + ']');
      }
    }

    if (activoPedido !== undefined && activoPedido !== antes.activo) {
      campos[PERM_COL_ACTIVO] = activoPedido ? 'Si' : 'No';
      notas.push(activoPedido ? 'reactivado' : 'dado de baja');
    }

    if (!Object.keys(campos).length) {
      const sinCambios = equipoPanorama(gate.email);
      sinCambios.sinCambios = true;
      sinCambios.message = 'No había nada que cambiar.';
      return sinCambios;
    }

    if (!permEscribirFila_(objetivo, campos)) {
      return equipoError_('No se encontró la fila de ' + objetivo + ' en "' + REGISTROS_SHEET_NAME + '".');
    }

    // La misma bitácora que la consola: un maestro tiene que poder ver, en un solo
    // sitio, quién cambió a quién, lo haya hecho desde la consola o desde aquí.
    consolaBitacoraApuntar_(gate.email, 'Equipo · miembro modificado', objetivo, notas.join(' · '));

    const salida = equipoPanorama(gate.email);
    salida.message = 'Cambios guardados para ' + (antes.nombre || objetivo) + '.';
    return salida;
  } catch (e) {
    Logger.log('equipoGuardarMiembro error: ' + e + ' · ' + e.stack);
    return equipoError_('No pudimos guardar los cambios. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Diagnóstico desde el editor: qué vería y qué podría tocar una cuenta concreta.
 * Se corre a mano cuando alguien dice "no me deja" y hay que saber por qué.
 * @param {string} correo
 */
function equipoDiagnostico(correo) {
  const r = equipoPanorama(correo);
  if (!r.success) { Logger.log('SIN ACCESO: ' + r.message); return r; }
  Logger.log('Gestor: ' + r.yo.nombre + ' (' + r.yo.email + ') · ' + r.yo.rolNombre);
  Logger.log('Puede repartir: ' + r.catalogo.bloques.map(function (b) { return b.id; }).join(', '));
  r.asesores.forEach(function (a) {
    Logger.log((a.gestionable ? '  [sí] ' : '  [no] ') + a.email + ' · ' + a.rolNombre +
               (a.motivo ? ' · ' + a.motivo : ''));
  });
  return r;
}
