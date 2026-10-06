/**
 * ESTADO DE OPERACIÓN Y ATENCIONES PENDIENTES | Portal Ventel en Cloudflare
 * ========================================================================
 * Port de Operacion.gs y Atenciones.gs. Contesta «¿soy yo o Connect está caído?» y guarda al cliente
 * que se quedó a medias cuando algo se cae.
 *
 *   1. REPORTAR: cualquier asesor con sesión levanta la mano (sistema, submotivo, notas, capturas).
 *   2. AGRUPAR SOLO: en cuanto tres PERSONAS DISTINTAS reportan lo mismo en media hora (o el mismo
 *      sistema, cada una a su manera) se levanta una incidencia «posible» que todo el equipo ve.
 *   3. CONFIRMAR: solo quien tiene el bloque 'operacion' confirma, descarta o actualiza.
 *
 * REGLA QUE SOSTIENE TODO LO DEMÁS: nada de lo que se enseña sin sesión (opEstadoPublico,
 * opHistorialPublico, opHistorialHorasPublico) lleva correos, nombres, notas internas ni evidencias.
 * Se recorta aquí, en el servidor, campo por campo igual que el .gs.
 *
 * Archivos del módulo:
 *   operacion/texto.ts            normalización y criterio único de agrupación
 *   operacion/comun.ts            parámetros, catálogo, incidencias, candado y avisos (no-op)
 *   operacion/historial.ts        opHistorialPublico / opHistorialHorasPublico
 *   operacion/recomendaciones.ts  opRecomendaciones
 *   operacion/atenciones.ts       Atenciones.gs entero
 * Todas las funciones del navegador se registran en `funciones`, al final de este archivo.
 */
import type { Ctx } from '../nucleo/contexto';
import type { FuncionRpc } from '../rpc';
import { secIdentidad, secIdentidadConBloque } from '../nucleo/seguridad';
import { guardarArchivo } from '../nucleo/archivos';
import { jsonSeguro } from '../nucleo/util';
import {
  opCapitalizar, opClave, opDice, opLimpiarNotas, opLimpiarTexto, opMismoMotivo, opSugerirExistente
} from './operacion/texto';
import {
  CandadoOcupado, OP_AVISO_POSIBLE, OP_BLOQUE, OP_MAX_BYTES_EVIDENCIA, OP_MAX_EVIDENCIAS, OP_MAX_REPORTES_HORA,
  OP_MIN_ENTRE_IGUALES, OP_UMBRAL_PERSONAS, OP_UMBRAL_SERVICIO_ACTIVO, OP_VENTANA_MIN,
  conCandado, opAvisarEstado, opAvisarReporte, opAvisoPosibleDetalle, opCatalogoRegistrar, opCatalogoSumarUso,
  opEsSi, opEstado, opId, opISO, opIncidenteDeFila, opSiNo, opIncidentesVivos, opLeerCatalogo, opLeerIncidente, opMs, opSistema,
  opTitulo, opUltimasActualizaciones, type Catalogo, type FilaIncidente, type Incidente
} from './operacion/comun';
import { opHistorialHorasPublico, opHistorialPublico } from './operacion/historial';
import { revConteoPendientes } from './revision';   // Revision.gs revConteoPendientes_ (dueño: agente de revisión)
import { opRecomendaciones } from './operacion/recomendaciones';
import {
  atencionActualizar, atencionFinalizar, atencionLiberarAhora, atencionRegistrar, atencionRescatar,
  atencionesPanorama, atencionesResumen
} from './operacion/atenciones';

export { opHistorialPublico, opHistorialHorasPublico, opRecomendaciones };
export { atencionesPanorama, atencionRegistrar, atencionActualizar, atencionFinalizar, atencionLiberarAhora,
         atencionRescatar, atencionesResumen };

/** Cuánto se espera el candado de operación (lock.waitLock(20000) en el .gs). */
const OP_ESPERA_CANDADO = 20000;

const ORDEN_TONO: Record<string, number> = { alert: 3, warn: 2, info: 1, ok: 0, neutro: 0 };

/** Puerta única del panel de supervisión. Todo lo que escribe pasa por aquí. */
function opGate(ctx: Ctx, email: unknown) {
  return secIdentidadConBloque(ctx, email, OP_BLOQUE);
}

/** Versión reducida de un incidente para devolver al cliente que acaba de reportar o actualizar. */
function opIncidentePublico(i: Incidente) {
  return {
    id: i.id, sistema: i.sistema, submotivo: i.submotivo,
    titulo: i.titulo || opTitulo(i.sistema, i.submotivo),
    estado: i.estado, estadoNombre: i.estadoNombre, tono: i.tono, desde: i.confirmado || i.creado
  };
}

// =================================================================================================
// API PÚBLICA (sin sesión)
// =================================================================================================

async function opCalcularEstadoPublico(ctx: Ctx) {
  const catalogo = await opLeerCatalogo(ctx);
  // Las sospechas abandonadas se apagan aquí mismo, al leer (opCaducarPosibles_).
  const vivos = (await opIncidentesVivos(ctx, catalogo, true)).filter((i) => i.estadoPublico);
  // Solo las actualizaciones que supervisión decidió ANUNCIAR: una nota interna no es un comunicado.
  const ultimas = await opUltimasActualizaciones(ctx, vivos.map((i) => i.id), true);

  const sistemas = catalogo.sistemas.map((s) => {
    const suyos = vivos.filter((i) => i.sistemaClave === s.clave && i.afecta);
    // Manda el más grave: confirmado antes que intermitencia, y esa antes que una sospecha.
    suyos.sort((a, b) => (ORDEN_TONO[b.tono] || 0) - (ORDEN_TONO[a.tono] || 0));
    const peor = suyos[0] || null;
    return {
      clave: s.clave,
      nombre: s.nombre,
      destacado: !!s.publico,
      tono: peor ? peor.tono : 'ok',
      estado: peor ? peor.estado : 'operativo',
      estadoNombre: peor ? peor.estadoNombre : 'Funcionando',
      incidentes: suyos.map((i) => ({
        id: i.id, titulo: i.titulo || opTitulo(i.sistema, i.submotivo),
        submotivo: i.submotivo, estado: i.estado, estadoNombre: i.estadoNombre,
        tono: i.tono, desde: i.confirmado || i.creado,
        detalle: i.detalle, ultima: ultimas[i.id] || null
      }))
    };
  });

  const afectados = sistemas.filter((s) => s.tono !== 'ok');
  const hayAlert = afectados.some((s) => s.tono === 'alert');

  // ¿Todo lo que hay es SOSPECHA? Entonces solo se dice lo que de verdad se sabe.
  const queAfectan = vivos.filter((i) => i.afecta);
  const soloSospecha = !!queAfectan.length && queAfectan.every((i) => i.estado === 'posible' && !i.confirmado);

  let resumen: string;
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
    resumen,
    sistemas,
    incidentes: vivos.filter((i) => i.afecta).map((i) => ({
      id: i.id, sistema: i.sistema, sistemaClave: i.sistemaClave,
      submotivo: i.submotivo, titulo: i.titulo || opTitulo(i.sistema, i.submotivo),
      estado: i.estado, estadoNombre: i.estadoNombre, tono: i.tono,
      desde: i.confirmado || i.creado, detalle: i.detalle, ultima: ultimas[i.id] || null
    }))
  };
}

/**
 * Estado de los sistemas para quien NO ha iniciado sesión (el tablero ?page=estado). Lo puede ver
 * cualquiera con el enlace: qué sistema, qué le pasa, desde cuándo y lo que supervisión publicó.
 */
export async function opEstadoPublico(ctx: Ctx) {
  try {
    return await opCalcularEstadoPublico(ctx);
  } catch (e) {
    console.error('opEstadoPublico', e);
    return { success: false, message: 'No pudimos consultar el estado en este momento.' };
  }
}

// =================================================================================================
// API CON SESIÓN
// =================================================================================================

/** Lo que ESTA persona reportó en las últimas 12 h (para no pedirle lo mismo). */
async function opReportesDeAsesor(ctx: Ctx, correo: string) {
  const desde = Date.now() - 12 * 3600 * 1000;
  const filas = await ctx.todas<{ incidente_id: string; sistema_clave: string; submotivo_clave: string; fecha: string }>(
    'SELECT incidente_id, sistema_clave, submotivo_clave, fecha FROM operacion_reportes ' +
    'WHERE correo = ? AND fecha >= ? ORDER BY rowid', String(correo || '').toLowerCase(), new Date(desde).toISOString());
  return filas.filter((f) => opMs(f.fecha) >= desde).map((f) => ({
    incidenteId: String(f.incidente_id || ''),
    clave: String(f.sistema_clave || '') + '|' + String(f.submotivo_clave || ''),
    fecha: opISO(f.fecha)
  }));
}

/**
 * Lo que necesita la pastilla que vive en todas las pantallas: el estado, el catálogo para poder
 * reportar y lo que esta persona ya reportó. Sin sesión válida se devuelve lo público.
 */
export async function opEstadoSesion(ctx: Ctx, email?: string) {
  try {
    const id = await secIdentidad(ctx, email);
    if (!id.ok) {
      const publico: Record<string, unknown> = await opEstadoPublico(ctx);
      publico.sesion = false;
      return publico;
    }

    const catalogo = await opLeerCatalogo(ctx);
    const publico = await opCalcularEstadoPublico(ctx);
    const salida: Record<string, unknown> = {
      success: true,
      estado: publico,
      catalogo: {
        sistemas: catalogo.sistemas.map((s) => ({ clave: s.clave, nombre: s.nombre, base: s.base })),
        submotivos: catalogo.submotivos,
        estados: catalogo.estados
      },
      sesion: true,
      puedeGestionar: (id.bloques || []).indexOf(OP_BLOQUE) !== -1,
      mios: await opReportesDeAsesor(ctx, id.email),
      yo: { email: id.email, nombre: id.nombre }
    };
    // El conteo de revisiones pendientes de la isla de notificaciones: SOLO viaja a quien tiene
    // el bloque 'revisar' (el de un asesor sin él no lleva ni el campo). Si falla, se omite.
    if ((id.bloques || []).indexOf('revisar') !== -1) {
      const pendientes = await revConteoPendientes(ctx);
      if (pendientes >= 0) salida.revision = { pendientes };
    }
    return salida;
  } catch (e) {
    console.error('opEstadoSesion', e);
    return { success: false, message: 'No pudimos consultar el estado en este momento.' };
  }
}

// ── REPORTAR ───────────────────────────────────────────────────────────────────────────────────

interface FilaReporteSuelto { id: string; fecha: string; correo: string; submotivo: string; submotivo_clave: string }

/** Reportes de un sistema que todavía no pertenecen a ninguna incidencia, desde `desdeMs`. */
async function opReportesSueltos(ctx: Ctx, sistemaClave: string, desdeMs: number): Promise<FilaReporteSuelto[]> {
  return (await ctx.todas<FilaReporteSuelto>(
    'SELECT id, fecha, correo, submotivo, submotivo_clave FROM operacion_reportes ' +
    "WHERE sistema_clave = ? AND COALESCE(incidente_id, '') = '' AND fecha >= ? ORDER BY rowid",
    sistemaClave, new Date(desdeMs).toISOString())).filter((f) => opMs(f.fecha) >= desdeMs);
}

/** ¿Este reporte cuenta como «lo mismo»? El mismo criterio difuso que agrupa en un incidente. */
function esMismoMotivo(f: FilaReporteSuelto, submotivo: string, submotivoClave: string): boolean {
  return String(f.submotivo_clave || '') === submotivoClave || opMismoMotivo(String(f.submotivo || ''), submotivo);
}

/**
 * Frenos antes de aceptar un reporte: tope por hora y «ya reportaste esto». No es seguridad: evita
 * que la tabla y el chat del equipo se llenen de ruido.
 */
async function opRevisarFrenos(ctx: Ctx, correo: string, sistemaClave: string, submotivoClave: string):
    Promise<{ ok: boolean; message?: string; repetido?: boolean }> {
  const ahora = Date.now();
  const mios = await ctx.todas<{ fecha: string; sistema_clave: string; submotivo_clave: string }>(
    'SELECT fecha, sistema_clave, submotivo_clave FROM operacion_reportes WHERE correo = ? AND fecha >= ?',
    String(correo).toLowerCase(), new Date(ahora - 3600 * 1000).toISOString());
  const ultimaHora = mios.filter((f) => ahora - opMs(f.fecha) < 3600 * 1000);
  if (ultimaHora.length >= OP_MAX_REPORTES_HORA) {
    return { ok: false, message: 'Ya mandaste varios reportes en la última hora. Espera un poco antes de mandar otro.' };
  }
  const repetido = mios.filter((f) =>
    String(f.sistema_clave || '') === sistemaClave &&
    String(f.submotivo_clave || '') === submotivoClave &&
    ahora - opMs(f.fecha) < OP_MIN_ENTRE_IGUALES * 60 * 1000);
  if (repetido.length) {
    return { ok: false, repetido: true, message: 'Ya reportaste esto hace unos minutos. Tu reporte sigue en pie, no hace falta repetirlo.' };
  }
  return { ok: true };
}

/**
 * Incidente vivo al que corresponde este reporte, si lo hay: coincidencia exacta, luego un motivo
 * muy parecido del mismo sistema, luego uno confirmado/en mantenimiento del sistema, y por último
 * uno de servicio (sin submotivo), que recoge cualquier reporte de su sistema.
 */
function opIncidenteParaReporte(vivosTodos: Incidente[], sistemaClave: string, submotivo: string, submotivoClave: string): Incidente | null {
  const vivos = vivosTodos.filter((i) => i.sistemaClave === sistemaClave);
  if (!vivos.length) return null;
  const exacto = vivos.filter((i) => opClave(i.submotivo) === submotivoClave)[0];
  if (exacto) return exacto;
  let mejor: { i: Incidente; s: number } | null = null;
  vivos.forEach((i) => {
    if (!opMismoMotivo(submotivo, i.submotivo)) return;
    const s = opDice(submotivo, i.submotivo);
    if (!mejor || s > mejor.s) mejor = { i, s };
  });
  if (mejor) return (mejor as { i: Incidente }).i;
  const confirmado = vivos.filter((i) => i.estado === 'confirmado' || i.estado === 'mantenimiento')[0];
  if (confirmado) return confirmado;
  return vivos.filter((i) => !opClave(i.submotivo))[0] || null;
}

/**
 * Crea la incidencia automática, cuelga de ella los reportes que la provocaron y deja las dos
 * anotaciones de la detección: la pública (Aviso: sí, sin cifras) y la interna (con cuántas
 * personas y con qué palabras). Todo en un lote: o se crea entera o no se crea.
 */
async function opCrearAutomatico(ctx: Ctx, catalogo: Catalogo, datos: {
  sistemaNombre: string; sistemaClave: string; submotivo: string; submotivoClave: string;
  origen: string; vincular: string[]; notaInterna: string;
}): Promise<Incidente | null> {
  const incidenteId = opId('inc');
  const ahora = ctx.ahoraIso();
  await ctx.lote([
    ['INSERT INTO operacion_incidentes (id, clave, sistema, sistema_clave, submotivo, estado, titulo, detalle, ' +
     'creado, creado_por, creado_nombre, actualizado, origen) ' +
     "VALUES (?, ?, ?, ?, ?, 'posible', ?, ?, ?, 'sistema', 'Detección automática', ?, ?)",
     incidenteId, datos.sistemaClave + '|' + datos.submotivoClave, datos.sistemaNombre, datos.sistemaClave,
     datos.submotivo, opTitulo(datos.sistemaNombre, datos.submotivo), opAvisoPosibleDetalle(), ahora, ahora, datos.origen],
    ["UPDATE operacion_reportes SET incidente_id = ?, estado = 'vinculado' " +
     "WHERE id IN (SELECT value FROM json_each(?)) AND COALESCE(incidente_id, '') = ''",
     incidenteId, JSON.stringify(datos.vincular)],
    ['INSERT INTO operacion_actualizaciones (id, incidente_id, fecha, autor, autor_nombre, estado, nota, aviso) ' +
     "VALUES (?, ?, ?, 'sistema', 'Detección automática', 'posible', ?, 1)",
     opId('act'), incidenteId, ahora, opAvisoPosibleDetalle()],
    ['INSERT INTO operacion_actualizaciones (id, incidente_id, fecha, autor, autor_nombre, estado, nota, aviso) ' +
     "VALUES (?, ?, ?, 'sistema', 'Detección automática', 'posible', ?, 0)",
     opId('act'), incidenteId, ahora, datos.notaInterna]
  ]);
  return opLeerIncidente(ctx, catalogo, incidenteId);
}

/**
 * ¿Ya hay suficientes personas distintas reportando LO MISMO? Cuenta CORREOS ÚNICOS, no filas: la
 * diferencia entre «tres personas no pueden trabajar» y «una persona pulsó tres veces».
 */
async function opEvaluarUmbral(ctx: Ctx, catalogo: Catalogo, sistemaNombre: string, sistemaClave: string,
                               submotivo: string, submotivoClave: string): Promise<Incidente | null> {
  const desde = Date.now() - OP_VENTANA_MIN * 60 * 1000;
  const mismos = (await opReportesSueltos(ctx, sistemaClave, desde)).filter((f) => esMismoMotivo(f, submotivo, submotivoClave));
  const personas: Record<string, boolean> = {};
  mismos.forEach((f) => { personas[String(f.correo || '').toLowerCase()] = true; });
  const cuantas = Object.keys(personas).length;
  if (cuantas < OP_UMBRAL_PERSONAS) return null;

  return opCrearAutomatico(ctx, catalogo, {
    sistemaNombre, sistemaClave, submotivo, submotivoClave, origen: 'automatico',
    vincular: mismos.map((f) => f.id),
    notaInterna: cuantas + ' personas distintas reportaron «' + submotivo + '» en ' + sistemaNombre +
                 ' en menos de ' + OP_VENTANA_MIN + ' minutos.'
  });
}

/**
 * ¿Hay suficientes personas peleándose con el MISMO SISTEMA, aunque cada una lo cuente a su manera?
 * Se llama solo si el umbral por motivo no saltó. La incidencia va SIN submotivo: inventarse una
 * causa común que nadie ha visto sería peor.
 */
async function opEvaluarUmbralServicio(ctx: Ctx, catalogo: Catalogo, sistemaNombre: string, sistemaClave: string): Promise<Incidente | null> {
  if (!OP_UMBRAL_SERVICIO_ACTIVO) return null;
  const desde = Date.now() - OP_VENTANA_MIN * 60 * 1000;
  const sueltos = await opReportesSueltos(ctx, sistemaClave, desde);
  const personas: Record<string, boolean> = {};
  const motivos: string[] = [];
  sueltos.forEach((f) => {
    personas[String(f.correo || '').toLowerCase()] = true;
    const m = String(f.submotivo || '').trim();
    if (m && motivos.indexOf(m) === -1) motivos.push(m);
  });
  const cuantas = Object.keys(personas).length;
  if (cuantas < OP_UMBRAL_PERSONAS) return null;

  return opCrearAutomatico(ctx, catalogo, {
    sistemaNombre, sistemaClave, submotivo: '', submotivoClave: '', origen: 'automatico-servicio',
    vincular: sueltos.map((f) => f.id),
    notaInterna: cuantas + ' personas distintas reportaron fallas en ' + sistemaNombre + ' en menos de ' +
                 OP_VENTANA_MIN + ' minutos, cada una con un motivo diferente (' + motivos.slice(0, 5).join('; ') + ').'
  });
}

/**
 * Deja pasar solo las capturas que subió el propio servidor (en el .gs: URLs de Drive nuestras).
 * Aquí: rutas /archivos/subidas/evidencias/… que existan en la tabla `archivos`. Se guardan como
 * ruta relativa, que sirve igual en local, en workers.dev y en el dominio propio.
 */
async function opValidarEvidencias(ctx: Ctx, lista: unknown): Promise<Array<{ url: string; id: string; nombre: string }>> {
  if (!Array.isArray(lista)) return [];
  const candidatas = lista.slice(0, OP_MAX_EVIDENCIAS).map((e: any) => {
    const url = String((e && e.url) || '');
    const m = url.match(/^(?:https?:\/\/[^/?#]+)?\/archivos\/(subidas\/evidencias\/[^?#]+)$/);
    if (!m) return null;
    let clave = '';
    try { clave = decodeURIComponent(m[1]); } catch { return null; }
    if (clave.indexOf('..') !== -1) return null;
    return { clave, nombre: opLimpiarTexto((e && e.nombre) || 'captura', 80) };
  }).filter(Boolean) as Array<{ clave: string; nombre: string }>;
  if (!candidatas.length) return [];
  const existen = new Set((await ctx.todas<{ clave: string }>(
    "SELECT clave FROM archivos WHERE carpeta = 'evidencias' AND clave IN (SELECT value FROM json_each(?))",
    JSON.stringify(candidatas.map((c) => c.clave)))).map((f) => f.clave));
  return candidatas.filter((c) => existen.has(c.clave))
    .map((c) => ({ url: '/archivos/' + c.clave, id: c.clave, nombre: c.nombre }));
}

/**
 * Guarda un reporte y decide si con él ya hay motivo para alertar al equipo.
 * @param payload { email, sistema, sistemaNuevo, submotivo, submotivoNuevo, notas, evidencias:[{url,id,nombre}] }
 *
 * El cliente lo manda con cero reintentos; aun así, el freno «ya reportaste esto» se comprueba
 * DENTRO del candado, así que ni un doble envío simultáneo de la misma persona deja dos reportes.
 * Diferencia menor con el .gs: el catálogo se toca después de los frenos, para que un reporte
 * rechazado no sume usos a la lista de motivos.
 */
export async function opReportar(ctx: Ctx, payload?: any) {
  try {
    payload = payload || {};
    const id = await secIdentidad(ctx, payload.email);
    if (!id.ok) return { success: false, message: id.error || 'Inicia sesión para reportar una falla.' };

    // ── Sistema ──
    const catalogo = await opLeerCatalogo(ctx);
    let sistemaNombre = '';
    let sistemaClave = '';
    let sistemaNuevo = false;
    const escrito = opLimpiarTexto(payload.sistemaNuevo, 60);
    if (escrito) {
      const sugerido = opSugerirExistente(escrito, catalogo.sistemas.map((s) => s.nombre));
      sistemaNombre = sugerido ? sugerido.valor : opCapitalizar(escrito);
      const yaExiste = opSistema(catalogo, sistemaNombre);
      sistemaClave = yaExiste ? yaExiste.clave : opClave(sistemaNombre);
      sistemaNuevo = !yaExiste;
    } else {
      const s = opSistema(catalogo, payload.sistema);
      if (!s) return { success: false, message: 'Elige el sistema que está fallando.' };
      sistemaNombre = s.nombre;
      sistemaClave = s.clave;
    }
    if (!sistemaClave) return { success: false, message: 'Elige el sistema que está fallando.' };

    // ── Submotivo ── (si se parece mucho a uno existente, gana el existente)
    let submotivo = '';
    const subEscrito = opLimpiarTexto(payload.submotivoNuevo, 60);
    if (subEscrito) {
      const existentes = (catalogo.submotivos[sistemaClave] || []).map((x) => x.valor);
      const sugerido = opSugerirExistente(subEscrito, existentes);
      submotivo = sugerido ? sugerido.valor : opCapitalizar(subEscrito);
    } else {
      submotivo = opLimpiarTexto(payload.submotivo, 60);
    }
    if (!submotivo) return { success: false, message: 'Dinos qué es lo que está fallando.' };
    const submotivoClave = opClave(submotivo);

    const notas = opLimpiarNotas(payload.notas, 1200);
    const evidencias = await opValidarEvidencias(ctx, payload.evidencias);

    return await conCandado(ctx, 'operacion', OP_ESPERA_CANDADO, async () => {
      // ── Frenos ──
      const freno = await opRevisarFrenos(ctx, id.email, sistemaClave, submotivoClave);
      if (!freno.ok) return { success: false, message: freno.message, repetido: !!freno.repetido };

      // ── El catálogo se alimenta con el uso ──
      if (sistemaNuevo) await opCatalogoRegistrar(ctx, 'sistema', '', sistemaNombre, id.email);
      if (subEscrito) await opCatalogoRegistrar(ctx, 'submotivo', sistemaClave, submotivo, id.email);
      else await opCatalogoSumarUso(ctx, 'submotivo', sistemaClave, submotivo, id.email);

      const catalogo2 = await opLeerCatalogo(ctx);
      const reporteId = opId('rep');
      const ahora = ctx.ahoraIso();

      // ── ¿Ya hay un incidente vivo al que pertenece? ── (sin caducar, como en el .gs: un reporte
      // nuevo sobre una sospecha que nadie ha mirado la mantiene viva)
      const incidente = opIncidenteParaReporte(await opIncidentesVivos(ctx, catalogo2, false), sistemaClave, submotivo, submotivoClave);

      const insertar: [string, ...unknown[]] = [
        'INSERT INTO operacion_reportes (id, fecha, correo, nombre, sistema, sistema_clave, submotivo, submotivo_clave, ' +
        'notas, evidencias, incidente_id, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        reporteId, ahora, id.email, id.nombre, sistemaNombre, sistemaClave, submotivo, submotivoClave,
        notas, JSON.stringify(evidencias), incidente ? incidente.id : '', incidente ? 'vinculado' : 'abierto'];

      // ── ¿Este reporte cruza el umbral? ── Primero por motivo («Connect · No abre» dice mucho
      // más que «Problemas con Connect»); si no, por servicio.
      let creado: Incidente | null = null;
      let incidenteFinal: Incidente | null = incidente;
      if (!incidente) {
        await ctx.lote([insertar]);
        creado = await opEvaluarUmbral(ctx, catalogo2, sistemaNombre, sistemaClave, submotivo, submotivoClave);
        if (!creado) creado = await opEvaluarUmbralServicio(ctx, catalogo2, sistemaNombre, sistemaClave);
        if (creado) incidenteFinal = creado;
      } else {
        await ctx.lote([insertar, ['UPDATE operacion_incidentes SET actualizado = ? WHERE id = ?', ahora, incidente.id]]);
      }

      opAvisarReporte({
        reporteId, sistema: sistemaNombre, submotivo, nombre: id.nombre, correo: id.email, notas,
        evidencias: evidencias.length, incidente: incidenteFinal, nuevo: !!creado
      });
      // La incidencia que nace de un umbral SÍ se anuncia, con su etiqueta de sospecha bien clara.
      if (creado) {
        opAvisarEstado(creado, {
          nota: 'Detectado automáticamente: ' + OP_UMBRAL_PERSONAS + ' personas reportaron ' +
                (creado.submotivo ? 'lo mismo' : 'fallas en este sistema') + ' en menos de ' +
                OP_VENTANA_MIN + ' minutos. Ya está publicado como posible problema; falta confirmar.',
          autoDetectado: true
        });
      }

      return {
        success: true,
        reporteId,
        incidente: incidenteFinal ? opIncidentePublico(incidenteFinal) : null,
        elevado: !!creado,
        sistema: sistemaNombre,
        submotivo,
        message: creado
          ? (creado.submotivo
              ? 'Gracias. Varias personas están reportando lo mismo, así que ya avisamos al equipo y se publicó en el tablero.'
              : 'Gracias. Varias personas están reportando fallas en ' + sistemaNombre +
                ', así que ya avisamos al equipo y se publicó en el tablero.')
          : (incidente
              ? 'Gracias. Ya había un reporte abierto por esto y sumamos el tuyo.'
              : 'Gracias. Tu reporte quedó registrado.')
      };
    });
  } catch (e) {
    if (!(e instanceof CandadoOcupado)) console.error('opReportar', e);
    return { success: false, message: 'No pudimos guardar tu reporte. Inténtalo de nuevo en un momento.' };
  }
}

// ── EVIDENCIAS ─────────────────────────────────────────────────────────────────────────────────

const EXTENSIONES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/**
 * Sube una captura pegada desde el portapapeles, ANTES de mandar el reporte (una captura pesa más
 * que todo lo demás junto). En Apps Script iba a una carpeta de Drive; aquí va a R2 (guardarArchivo)
 * y se sirve desde el mismo dominio en /archivos/….
 */
export async function opSubirEvidencia(ctx: Ctx, payload?: any) {
  try {
    payload = payload || {};
    const id = await secIdentidad(ctx, payload.email);
    if (!id.ok) return { success: false, message: 'Inicia sesión para adjuntar una captura.' };

    const m = String(payload.dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return { success: false, message: 'Esa imagen no se pudo leer. Vuelve a pegarla.' };
    const mime = m[1].toLowerCase();
    if (mime.indexOf('image/') !== 0) return { success: false, message: 'Solo se pueden adjuntar imágenes.' };

    const b64 = m[2];
    const bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0));
    if (bytes > OP_MAX_BYTES_EVIDENCIA) {
      return { success: false, message: 'La captura pesa más de 5 MB. Recórtala e inténtalo de nuevo.' };
    }
    // Solo formatos de captura. Un SVG servido desde nuestro propio dominio podría llevar código.
    const ext = EXTENSIONES[mime];
    if (!ext) return { success: false, message: 'Ese formato de imagen no se puede adjuntar. Usa una captura PNG o JPG.' };

    const guardado = await guardarArchivo(ctx, {
      datos: payload.dataUrl, tipo: mime, carpeta: 'evidencias', subidoPor: id.email,
      nombre: 'evidencia-' + opClave(id.nombre || id.email) + '-' + Date.now() + '.' + ext,
      maxBytes: OP_MAX_BYTES_EVIDENCIA
    });
    return {
      success: true,
      url: guardado.url,
      id: guardado.clave,
      nombre: opLimpiarTexto(payload.nombre || 'captura', 80)
    };
  } catch (e) {
    console.error('opSubirEvidencia', e);
    return { success: false, message: 'No pudimos guardar la captura. Inténtalo de nuevo.' };
  }
}

// =================================================================================================
// DETALLE DE UN INCIDENTE (exige sesión)
// =================================================================================================

/**
 * Todo lo que hay detrás de un incidente: quién lo reportó, con qué palabras, con qué capturas y
 * qué ha ido diciendo supervisión. Exige sesión: aquí sí viajan nombres, correos y capturas.
 */
export async function opIncidenteDetalle(ctx: Ctx, incidenteId?: string, email?: string) {
  try {
    const id = await secIdentidad(ctx, email);
    if (!id.ok) return { success: false, message: 'Inicia sesión para ver los reportes y las evidencias.' };

    const idInc = String(incidenteId || '').trim();
    if (!idInc) return { success: false, message: 'No pudimos identificar ese reporte.' };

    const catalogo = await opLeerCatalogo(ctx);
    const inc = await opLeerIncidente(ctx, catalogo, idInc);
    if (!inc) return { success: false, message: 'Ese reporte ya no está disponible.' };

    const reportes = (await ctx.todas('SELECT * FROM operacion_reportes WHERE incidente_id = ? ORDER BY rowid', idInc))
      .map((f) => {
        const evidencias = jsonSeguro<unknown>(f.evidencias || '[]', []);
        return {
          id: String(f.id || ''), fecha: opISO(f.fecha),
          nombre: String(f.nombre || ''), correo: String(f.correo || ''),
          submotivo: String(f.submotivo || ''), notas: String(f.notas || ''),
          evidencias: Array.isArray(evidencias) ? evidencias : [],
          mio: String(f.correo || '').toLowerCase() === id.email
        };
      })
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    const actualizaciones = (await ctx.todas('SELECT * FROM operacion_actualizaciones WHERE incidente_id = ? ORDER BY rowid', idInc))
      .map((f) => {
        const est = opEstado(catalogo, f.estado);
        return {
          id: String(f.id || ''), fecha: opISO(f.fecha),
          autor: String(f.autor || ''), autorNombre: String(f.autor_nombre || ''),
          estado: String(f.estado || ''),
          estadoNombre: est.nombre,
          tono: est.tono,
          nota: String(f.nota || ''), aviso: opEsSi(f.aviso)
        };
      })
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    const vistos: Record<string, boolean> = {};
    reportes.forEach((r) => { vistos[String(r.correo || '').toLowerCase()] = true; });

    return {
      success: true,
      puedeGestionar: (id.bloques || []).indexOf(OP_BLOQUE) !== -1,
      incidente: {
        id: inc.id, sistema: inc.sistema, sistemaClave: inc.sistemaClave, submotivo: inc.submotivo,
        titulo: inc.titulo || opTitulo(inc.sistema, inc.submotivo), detalle: inc.detalle,
        estado: inc.estado, estadoNombre: inc.estadoNombre, tono: inc.tono,
        afecta: inc.afecta, cerrado: inc.cerrado, creado: inc.creado,
        confirmado: inc.confirmado, confirmadoNombre: inc.confirmadoNombre,
        actualizado: inc.actualizado, origen: inc.origen,
        personas: Object.keys(vistos).filter(Boolean).length
      },
      reportes,
      actualizaciones,
      estados: catalogo.estados
    };
  } catch (e) {
    console.error('opIncidenteDetalle', e);
    return { success: false, message: 'No pudimos abrir ese reporte. Inténtalo de nuevo en un momento.' };
  }
}

// =================================================================================================
// PANEL DE SUPERVISIÓN (bloque 'operacion')
// =================================================================================================

/** El cuerpo del panel: incidencias vivas, las cerradas de la semana y los reportes sueltos de 24 h. */
async function opCalcularPanel(ctx: Ctx) {
  const catalogo = await opLeerCatalogo(ctx);
  await opIncidentesVivos(ctx, catalogo, true);   // apaga las sospechas abandonadas (opCaducarPosibles_)

  const desdeCerrados = Date.now() - 7 * 24 * 3600 * 1000;
  const cierran = JSON.stringify(catalogo.estados.filter((e) => e.cierra).map((e) => e.clave));
  const todos = (await ctx.todas<FilaIncidente>(
    "SELECT * FROM operacion_incidentes WHERE lower(trim(COALESCE(estado, ''))) NOT IN (SELECT value FROM json_each(?)) " +
    "OR COALESCE(NULLIF(cerrado, ''), NULLIF(actualizado, ''), '') >= ? ORDER BY rowid",
    cierran, new Date(desdeCerrados).toISOString()))
    .map((f) => opIncidenteDeFila(f, catalogo))
    .filter((i) => i.id && (!i.cierra || opMs(i.cerrado || i.actualizado) > desdeCerrados));

  // Reportes y personas distintas por incidencia, contados por D1.
  const conteo: Record<string, { n: number; p: number }> = {};
  if (todos.length) {
    (await ctx.todas<{ id: string; n: number; p: number }>(
      'SELECT incidente_id AS id, COUNT(*) AS n, ' +
      "COUNT(DISTINCT CASE WHEN COALESCE(correo, '') <> '' THEN lower(correo) END) AS p " +
      'FROM operacion_reportes WHERE incidente_id IN (SELECT value FROM json_each(?)) GROUP BY incidente_id',
      JSON.stringify(todos.map((i) => i.id)))).forEach((f) => { conteo[f.id] = { n: Number(f.n) || 0, p: Number(f.p) || 0 }; });
  }

  const incidentes = todos.map((i) => ({
    id: i.id, sistema: i.sistema, sistemaClave: i.sistemaClave, submotivo: i.submotivo,
    titulo: i.titulo || opTitulo(i.sistema, i.submotivo), detalle: i.detalle,
    estado: i.estado, estadoNombre: i.estadoNombre, tono: i.tono,
    afecta: i.afecta, cierra: i.cierra, origen: i.origen,
    creado: i.creado, confirmado: i.confirmado, confirmadoNombre: i.confirmadoNombre,
    actualizado: i.actualizado, cerrado: i.cerrado,
    reportes: conteo[i.id] ? conteo[i.id].n : 0,
    personas: conteo[i.id] ? conteo[i.id].p : 0
  })).sort((a, b) => {
    // Lo que espera una decisión primero; dentro de eso, lo más reciente.
    if (a.cierra !== b.cierra) return a.cierra ? 1 : -1;
    if ((a.estado === 'posible') !== (b.estado === 'posible')) return a.estado === 'posible' ? -1 : 1;
    return (b.actualizado || b.creado || '').localeCompare(a.actualizado || a.creado || '');
  });

  const desdeSueltos = Date.now() - 24 * 3600 * 1000;
  const sueltos = (await ctx.todas(
    "SELECT * FROM operacion_reportes WHERE COALESCE(incidente_id, '') = '' AND fecha > ? " +
    "AND COALESCE(estado, '') <> 'descartado' ORDER BY rowid", new Date(desdeSueltos).toISOString()))
    .filter((f) => opMs(f.fecha) > desdeSueltos)
    .map((f) => {
      const evidencias = jsonSeguro<unknown>(f.evidencias || '[]', []);
      return {
        id: String(f.id || ''), fecha: opISO(f.fecha),
        nombre: String(f.nombre || ''), correo: String(f.correo || ''),
        sistema: String(f.sistema || ''), sistemaClave: String(f.sistema_clave || ''),
        submotivo: String(f.submotivo || ''), notas: String(f.notas || ''),
        evidencias: Array.isArray(evidencias) ? evidencias : []
      };
    })
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  return {
    success: true,
    incidentes,
    sueltos,
    catalogo: {
      sistemas: catalogo.sistemas.map((s) => ({ clave: s.clave, nombre: s.nombre })),
      estados: catalogo.estados
    },
    umbral: { personas: OP_UMBRAL_PERSONAS, minutos: OP_VENTANA_MIN },
    // En esta versión los avisos a Google Chat no salen (no-op), así que el panel lo dice tal cual:
    // «Sin webhook configurado: los avisos al equipo no saldrán».
    webhookEstado: false,
    webhookReportes: false
  };
}

/** Todo lo que necesita la bandeja de supervisión. Sin caché: D1 lo lee en el acto. */
export async function opPanel(ctx: Ctx, email?: string) {
  try {
    const gate = await opGate(ctx, email);
    if (!gate.ok) return { success: false, message: gate.error };
    const base = await opCalcularPanel(ctx);
    return { ...base, yo: { email: gate.email, nombre: gate.nombre } };
  } catch (e) {
    console.error('opPanel', e);
    return { success: false, message: 'No pudimos cargar el panel. Inténtalo de nuevo en un momento.' };
  }
}

// ── ACTUALIZAR / CREAR / ELEVAR / DESCARTAR ────────────────────────────────────────────────────

/**
 * Cambia el estado de un incidente y, si se pide, lo anuncia. El aviso es OPCIONAL: corregir una
 * errata no merece un mensaje a todo el mundo. Una nota con aviso es además lo que publica el
 * tablero (la «última actualización» que ve el público).
 * @param payload { email, id, estado, titulo, detalle, nota, avisar }
 *
 * IDEMPOTENTE: la bandeja la manda por la cola con 2 reintentos (operacion.html). Si la respuesta se
 * perdió y llega otra vez la misma petición, se reconoce (misma última anotación de la misma persona
 * hace menos de 2 min y la fila ya como se pide) y se contesta igual sin escribir dos veces.
 */
export async function opActualizarIncidente(ctx: Ctx, payload?: any) {
  try {
    payload = payload || {};
    const gate = await opGate(ctx, payload.email);
    if (!gate.ok) return { success: false, message: gate.error };

    const idInc = String(payload.id || '').trim();
    if (!idInc) return { success: false, message: 'No pudimos identificar ese reporte.' };

    return await conCandado(ctx, 'operacion', OP_ESPERA_CANDADO, async () => {
      const catalogo = await opLeerCatalogo(ctx);
      const antes = await opLeerIncidente(ctx, catalogo, idInc);
      if (!antes) return { success: false, message: 'Ese reporte ya no está disponible.' };

      const nota = opLimpiarNotas(payload.nota, 800);
      const cambiaEstado = !!String(payload.estado || '').trim();
      const estado = cambiaEstado ? opEstado(catalogo, payload.estado) : opEstado(catalogo, antes.estado);
      if (cambiaEstado && opClave(payload.estado) !== estado.clave) {
        return { success: false, message: 'Ese estado no existe. Elige uno de la lista o crea uno nuevo.' };
      }
      // Descartar sin una razón escrita: mañana nadie recuerda por qué se cerró.
      if (estado.clave === 'descartado' && nota.length < 10) {
        return { success: false, message: 'Escribe por qué lo descartas (al menos 10 caracteres).' };
      }

      const avisar = payload.avisar === true;
      const titulo = opLimpiarTexto(payload.titulo, 120);
      const detalle = payload.detalle !== undefined ? opLimpiarNotas(payload.detalle, 800) : undefined;
      const respuesta = (inc: Incidente | null) => ({
        success: true,
        incidente: inc ? opIncidentePublico(inc) : null,
        aviso: avisar,
        message: avisar ? 'Actualizado y avisado al equipo.' : 'Actualizado. No se mandó aviso.'
      });

      // ¿Es un reintento de algo que ya se aplicó?
      const ultima = await ctx.una<{ autor: string; estado: string; nota: string; aviso: unknown; fecha: string }>(
        'SELECT autor, estado, nota, aviso, fecha FROM operacion_actualizaciones WHERE incidente_id = ? ORDER BY rowid DESC LIMIT 1', idInc);
      if (ultima && String(ultima.autor || '') === gate.email && String(ultima.estado || '') === estado.clave &&
          String(ultima.nota || '') === nota && opEsSi(ultima.aviso) === avisar &&
          Date.now() - opMs(ultima.fecha) < 120000 && antes.estado === estado.clave &&
          (!titulo || antes.titulo === titulo) && (detalle === undefined || antes.detalle === detalle)) {
        return respuesta(antes);
      }

      const ahora = ctx.ahoraIso();
      const campos: Record<string, unknown> = { estado: estado.clave, actualizado: ahora, actualizado_por: gate.email };
      if (titulo) campos.titulo = titulo;
      if (detalle !== undefined) campos.detalle = detalle;
      // La confirmación se sella UNA vez: es el «desde cuándo está reconocido».
      if (!antes.confirmado && estado.afecta && estado.clave !== 'posible') {
        campos.confirmado = ahora;
        campos.confirmado_por = gate.email;
        campos.confirmado_nombre = gate.nombre;
      }
      if (estado.cierra && !antes.cerrado) campos.cerrado = ahora;
      if (!estado.cierra && antes.cerrado) campos.cerrado = null;

      const cols = Object.keys(campos);
      const sentencias: Array<[string, ...unknown[]]> = [
        ['UPDATE operacion_incidentes SET ' + cols.map((c) => c + ' = ?').join(', ') + ' WHERE id = ?',
         ...cols.map((c) => campos[c]), idInc],
        ['INSERT INTO operacion_actualizaciones (id, incidente_id, fecha, autor, autor_nombre, estado, nota, aviso) ' +
         'VALUES (?, ?, ?, ?, ?, ?, ?, ?)', opId('act'), idInc, ahora, gate.email, gate.nombre, estado.clave, nota, opSiNo(avisar)]
      ];
      // Los reportes de un incidente cerrado dejan de aparecer como pendientes.
      if (estado.cierra) sentencias.push(['UPDATE operacion_reportes SET estado = ? WHERE incidente_id = ?', estado.clave, idInc]);
      await ctx.lote(sentencias);

      const despues = await opLeerIncidente(ctx, catalogo, idInc);
      if (avisar && despues) {
        opAvisarEstado(despues, { nota, autor: gate.nombre, cambioDeEstado: antes.estado !== estado.clave });
      }
      return respuesta(despues);
    });
  } catch (e) {
    if (!(e instanceof CandadoOcupado)) console.error('opActualizarIncidente', e);
    return { success: false, message: 'No pudimos guardar el cambio. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * El cuerpo de opCrearIncidente, sin puerta ni candado (lo comparten opCrearIncidente y
 * opElevarReporte, que ya tienen los dos).
 */
async function opCrearIncidenteInterno(ctx: Ctx, gate: { email: string; nombre: string }, payload: any):
    Promise<{ success: boolean; id?: string; message: string }> {
  const catalogo = await opLeerCatalogo(ctx);
  let sistemaNombre = '';
  let sistemaClave = '';
  let sistemaNuevo = false;
  const escrito = opLimpiarTexto(payload.sistemaNuevo, 60);
  if (escrito) {
    const sugerido = opSugerirExistente(escrito, catalogo.sistemas.map((s) => s.nombre));
    sistemaNombre = sugerido ? sugerido.valor : opCapitalizar(escrito);
    const ya = opSistema(catalogo, sistemaNombre);
    sistemaClave = ya ? ya.clave : opClave(sistemaNombre);
    sistemaNuevo = !ya;
  } else {
    const s = opSistema(catalogo, payload.sistema);
    if (!s) return { success: false, message: 'Elige el sistema al que afecta.' };
    sistemaNombre = s.nombre;
    sistemaClave = s.clave;
  }

  const submotivo = opLimpiarTexto(payload.submotivo, 60);
  if (!submotivo) return { success: false, message: 'Dinos qué es lo que está pasando.' };
  const estado = opEstado(catalogo, payload.estado || 'confirmado');

  if (sistemaNuevo) await opCatalogoRegistrar(ctx, 'sistema', '', sistemaNombre, gate.email);
  await opCatalogoRegistrar(ctx, 'submotivo', sistemaClave, submotivo, gate.email);

  const incidenteId = opId('inc');
  const ahora = ctx.ahoraIso();
  const titulo = opLimpiarTexto(payload.titulo, 120) || opTitulo(sistemaNombre, submotivo);
  const nota = opLimpiarNotas(payload.nota, 800);
  const avisar = payload.avisar === true;

  await ctx.lote([
    ['INSERT INTO operacion_incidentes (id, clave, sistema, sistema_clave, submotivo, estado, titulo, detalle, ' +
     'creado, creado_por, creado_nombre, confirmado, confirmado_por, confirmado_nombre, actualizado, actualizado_por, ' +
     "cerrado, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'supervision')",
     incidenteId, sistemaClave + '|' + opClave(submotivo), sistemaNombre, sistemaClave, submotivo, estado.clave, titulo,
     opLimpiarNotas(payload.detalle, 800), ahora, gate.email, gate.nombre,
     estado.afecta ? ahora : null, estado.afecta ? gate.email : '', estado.afecta ? gate.nombre : '',
     ahora, gate.email, estado.cierra ? ahora : null],
    ['INSERT INTO operacion_actualizaciones (id, incidente_id, fecha, autor, autor_nombre, estado, nota, aviso) ' +
     'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
     opId('act'), incidenteId, ahora, gate.email, gate.nombre, estado.clave, nota || 'Registrado por supervisión.', opSiNo(avisar)]
  ]);

  if (avisar) {
    const creado = await opLeerIncidente(ctx, await opLeerCatalogo(ctx), incidenteId);
    if (creado) opAvisarEstado(creado, { nota, autor: gate.nombre, cambioDeEstado: true });
  }
  return { success: true, id: incidenteId, message: avisar ? 'Publicado y avisado al equipo.' : 'Publicado.' };
}

/**
 * Crea un incidente a mano: lo que NADIE va a reportar porque se sabe de antemano (un
 * mantenimiento programado). @param payload { email, sistema, sistemaNuevo, submotivo, estado,
 * titulo, detalle, nota, avisar }. Sin reintentos en el cliente (crear avisa al equipo).
 */
export async function opCrearIncidente(ctx: Ctx, payload?: any) {
  try {
    payload = payload || {};
    const gate = await opGate(ctx, payload.email);
    if (!gate.ok) return { success: false, message: gate.error };
    return await conCandado(ctx, 'operacion', OP_ESPERA_CANDADO, () => opCrearIncidenteInterno(ctx, gate, payload));
  } catch (e) {
    if (!(e instanceof CandadoOcupado)) console.error('opCrearIncidente', e);
    return { success: false, message: 'No pudimos publicarlo. Inténtalo de nuevo en un momento.' };
  }
}

/** Da de alta un estado nuevo; el tono decide si pinta el semáforo en rojo o en ámbar. */
export async function opCrearEstado(ctx: Ctx, payload?: any) {
  try {
    payload = payload || {};
    const gate = await opGate(ctx, payload.email);
    if (!gate.ok) return { success: false, message: gate.error };

    const nombre = opLimpiarTexto(payload.nombre, 40);
    if (!nombre) return { success: false, message: 'Escribe cómo se va a llamar el estado.' };
    const tono = ['ok', 'info', 'warn', 'alert', 'neutro'].indexOf(String(payload.tono)) !== -1 ? String(payload.tono) : 'warn';

    const catalogo = await opLeerCatalogo(ctx);
    const sugerido = opSugerirExistente(nombre, catalogo.estados.map((e) => e.nombre));
    if (sugerido) {
      return {
        success: false, yaExiste: true, valor: sugerido.valor,
        message: 'Ya existe un estado muy parecido: «' + sugerido.valor + '». Úsalo en vez de crear otro.'
      };
    }
    const valor = await opCatalogoRegistrar(ctx, 'estado', '', nombre, gate.email, tono);
    return { success: true, valor, clave: opClave(valor), tono };
  } catch (e) {
    console.error('opCrearEstado', e);
    return { success: false, message: 'No pudimos crear el estado. Inténtalo de nuevo.' };
  }
}

/**
 * Convierte un reporte suelto en incidente sin esperar al umbral, y le cuelga los reportes
 * parecidos de las últimas 6 h. Todo dentro del candado: dos supervisores que pulsan a la vez sobre
 * el mismo reporte no crean dos incidencias.
 */
export async function opElevarReporte(ctx: Ctx, payload?: any) {
  try {
    payload = payload || {};
    const gate = await opGate(ctx, payload.email);
    if (!gate.ok) return { success: false, message: gate.error };
    const repId = String(payload.reporteId || '').trim();

    return await conCandado(ctx, 'operacion', OP_ESPERA_CANDADO, async () => {
      const fila = await ctx.una('SELECT * FROM operacion_reportes WHERE id = ?', repId);
      if (!fila) return { success: false, message: 'Ese reporte ya no está disponible.' };
      if (String(fila.incidente_id || '')) return { success: false, message: 'Ese reporte ya pertenece a una incidencia.' };

      // Cambio deliberado respecto al .gs: la nota por omisión llevaba el NOMBRE de quien reportó y,
      // con el aviso marcado (lo normal al elevar), salía en el tablero PÚBLICO. Si se va a anunciar,
      // va sin nombre; los reportes con sus nombres siguen en el detalle, que exige sesión.
      const avisar = payload.avisar === true;
      const creado = await opCrearIncidenteInterno(ctx, gate, {
        email: payload.email,
        sistema: String(fila.sistema_clave || ''),
        submotivo: String(fila.submotivo || ''),
        estado: payload.estado || 'confirmado',
        detalle: String(fila.notas || ''),
        nota: opLimpiarNotas(payload.nota, 800) || (avisar
          ? 'Elevado desde un reporte del equipo.'
          : 'Elevado desde el reporte de ' + String(fila.nombre || '') + '.'),
        avisar
      });
      if (!creado.success) return creado;

      // opVincularReportesSueltos_: mismo sistema, motivo igual o parecido, últimas 6 h.
      const desde = Date.now() - 6 * 3600 * 1000;
      const submotivo = String(fila.submotivo || '');
      const submotivoClave = String(fila.submotivo_clave || '');
      const ids = (await opReportesSueltos(ctx, String(fila.sistema_clave || ''), desde))
        .filter((f) => esMismoMotivo(f, submotivo, submotivoClave)).map((f) => f.id);
      if (ids.length) {
        await ctx.ejecutar("UPDATE operacion_reportes SET incidente_id = ?, estado = 'vinculado' " +
          "WHERE id IN (SELECT value FROM json_each(?)) AND COALESCE(incidente_id, '') = ''", creado.id, JSON.stringify(ids));
      }
      return { success: true, id: creado.id, message: 'Incidencia creada con los reportes relacionados.' };
    });
  } catch (e) {
    if (!(e instanceof CandadoOcupado)) console.error('opElevarReporte', e);
    return { success: false, message: 'No pudimos crear la incidencia. Inténtalo de nuevo.' };
  }
}

/** Descarta un reporte suelto sin crear incidencia. Idempotente (la cola lo reintenta). */
export async function opDescartarReporte(ctx: Ctx, payload?: any) {
  try {
    payload = payload || {};
    const gate = await opGate(ctx, payload.email);
    if (!gate.ok) return { success: false, message: gate.error };
    const repId = String(payload.reporteId || '').trim();
    const r = await ctx.ejecutar("UPDATE operacion_reportes SET estado = 'descartado' WHERE id = ?", repId);
    if (!r.cambios) return { success: false, message: 'Ese reporte ya no está disponible.' };
    return { success: true, message: 'Reporte descartado.' };
  } catch (e) {
    console.error('opDescartarReporte', e);
    return { success: false, message: 'No pudimos descartarlo. Inténtalo de nuevo.' };
  }
}

// ── Registro de funciones expuestas al navegador ───────────────────────────────────────────────
// (opDiagnostico y atencionesDiagnostico eran solo del editor —secSoloInterno_— y no se registran.)

export const funciones: Record<string, FuncionRpc> = {
  // Estado de operación · públicas (el tablero ?page=estado se ve sin sesión)
  opEstadoPublico,
  opHistorialPublico,
  opHistorialHorasPublico,
  // Estado de operación · con sesión
  opEstadoSesion,
  opReportar,
  opSubirEvidencia,
  opIncidenteDetalle,
  // Estado de operación · supervisión (bloque 'operacion')
  opPanel,
  opRecomendaciones,
  opActualizarIncidente,
  opCrearIncidente,
  opCrearEstado,
  opElevarReporte,
  opDescartarReporte,
  // Atenciones pendientes (bloque 'atenciones')
  atencionesPanorama,
  atencionRegistrar,
  atencionActualizar,
  atencionLiberarAhora,
  atencionRescatar,
  atencionFinalizar,
  atencionesResumen
};
