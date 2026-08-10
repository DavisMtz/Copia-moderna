/**
 * =====================================================================================
 * GESTIÓN DEL EQUIPO · COMPATIBILIDAD | Sistema de cotizaciones Ventel
 * =====================================================================================
 * Este archivo YA NO decide nada. Es un puente hacia la Consola, que es desde ahora el
 * único sitio donde se gestionan roles y accesos.
 *
 * QUÉ HABÍA AQUÍ Y POR QUÉ SE FUE
 * -------------------------------
 * Había una segunda implementación completa del control de accesos, que servía al
 * apartado "Equipo" del panel avanzado. Funcionaba, pero partía de una doctrina
 * distinta a la de la consola:
 *
 *     Equipo.gs decía:  «puedes gestionar a quien NO puede gestionar a nadie»
 *     La Consola decía: «esto es de maestros»
 *
 * Dos reglas distintas para la misma pregunta, en dos pantallas distintas, sobre las
 * mismas filas de la misma hoja. Eso no es redundancia inofensiva: significaba que la
 * respuesta a "¿puede Ana cambiar a Beto?" dependía de por dónde entrara Ana, y que
 * cualquier arreglo hecho en un lado dejaba el otro como estaba. La regla nueva
 * —alcanzas a quien está en tu nivel o por debajo— tampoco es la de ninguno de los
 * dos, así que mantener las dos copias habría dejado TRES criterios conviviendo.
 *
 * DÓNDE VIVE AHORA
 * ----------------
 *   Permisos.gs   permVetoJerarquia_ · permVetoRol_ · permBloquesRepartibles_
 *                 La regla, escrita una sola vez.
 *   Consola.gs    consolaAcceso_ · consolaGuardarMiembro · consolaAltaMiembro
 *                 La puerta y las operaciones.
 *
 * POR QUÉ NO SE BORRÓ EL ARCHIVO ENTERO
 * -------------------------------------
 * Apps Script sirve el HTML desde el servidor, pero un navegador que dejó la pestaña
 * abierta ayer sigue teniendo el JavaScript viejo cargado, y ese JavaScript llama a
 * `equipoPanorama` y `equipoGuardarMiembro` por su nombre. Si estas funciones
 * desaparecen de golpe, esa pestaña no recibe "esto se movió": recibe un error de
 * función inexistente, que en pantalla se ve como que el sistema se rompió. Estas dos
 * envolturas hacen que esa sesión siga funcionando —con las reglas NUEVAS, porque
 * delegan— hasta que se recargue. Se pueden borrar sin miedo cuando haya pasado
 * tiempo suficiente desde el despliegue.
 */

/**
 * Roles que una gestión de equipo puede asignar.
 * @deprecated Lo decide permRolesAsignables_(usuario) según el nivel de cada quien.
 *   Se conserva porque era una constante global y algo podría seguir leyéndola.
 */
const EQUIPO_ROLES_ASIGNABLES = ['normal', 'avanzado'];

/**
 * @deprecated Usa consolaPanorama. Se traduce la respuesta a la forma que esperaba el
 *   panel avanzado para que una pestaña vieja no se quede en blanco.
 */
function equipoPanorama(email) {
  const r = consolaPanorama(email);
  if (!r || !r.success) return r || { success: false, message: 'No pudimos cargar tu equipo.' };
  return {
    success: true,
    yo: r.yo,
    // El panel viejo llamaba "asesores" a la lista de personas; la consola la llama
    // "miembros". Ya viene recortada por jerarquía desde el servidor.
    asesores: r.miembros,
    catalogo: r.catalogo,
    message: '',
    // Señal para el cliente nuevo: esta pantalla se mudó. El panel avanzado la usa
    // para mandar a la gente a la consola en vez de pintar la tabla otra vez.
    movidoA: 'consola'
  };
}

/**
 * @deprecated Usa consolaGuardarMiembro, que es quien aplica la jerarquía.
 */
function equipoGuardarMiembro(email, cambio) {
  const r = consolaGuardarMiembro(email, cambio);
  if (r && r.success) {
    const panorama = equipoPanorama(email);
    if (panorama && panorama.success) {
      panorama.message = r.message;
      return panorama;
    }
  }
  return r;
}

/**
 * Diagnóstico desde el editor: qué vería y qué podría tocar una cuenta concreta.
 * Se corre a mano cuando alguien dice "no me deja" y hay que saber por qué.
 * @param {string} correo
 */
function equipoDiagnostico(correo) {
  const r = equipoPanorama(correo);
  if (!r.success) { Logger.log('SIN ACCESO: ' + r.message); return r; }
  Logger.log('Gestor: ' + r.yo.nombre + ' (' + r.yo.email + ') · ' + r.yo.rolNombre +
             ' · nivel ' + r.yo.nivel);
  Logger.log('Puede repartir: ' + r.catalogo.bloques.map(function (b) { return b.id; }).join(', '));
  Logger.log('Puede asignar: ' + r.catalogo.roles.map(function (x) { return x.id; }).join(', '));
  (r.asesores || []).forEach(function (a) {
    Logger.log((a.gestionable ? '  [sí] ' : '  [no] ') + a.email + ' · ' + a.rolNombre +
               (a.motivo ? ' · ' + a.motivo : ''));
  });
  return r;
}
