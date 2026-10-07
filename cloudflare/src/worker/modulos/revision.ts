/**
 * REVISIÓN, POLÍTICA Y AUDITORÍA | Portal Ventel en Cloudflare
 * ============================================================
 * Port de Revision.gs, PoliticaRevision.gs y AuditoriaCotizacion.gs.
 *
 * Una cotización recién guardada NO está lista para salir al cliente: la política (politica.ts) decide
 * si nace "En Revisión" o aprobada sola. Si va a revisión, un usuario con el bloque 'revisar' la abre
 * en ?page=revision_cotizacion&folio=…, verifica artículo por artículo con ayuda de la auditoría
 * automática (auditoria.ts) y la APRUEBA o la RECHAZA con observaciones. Solo entonces se desbloquea
 * el envío por correo (revPuedeEnviarse) y se avisa al asesor.
 *
 * Archivos del módulo:
 *   revision.ts              ← Revision.gs y el registro de funciones del navegador (este archivo)
 *   revision/politica.ts     ← PoliticaRevision.gs
 *   revision/auditoria.ts    ← AuditoriaCotizacion.gs
 *   revision/liverpool.ts    ← la ficha y la página en vivo de liverpool.com.mx
 *   revision/datos.ts        ← lecturas de cotizaciones (el detalle lo da cotizaciones/comun.ts) y la cola
 *   revision/constantes.ts   ← estatus y validación de URLs
 *
 * Contratos que usan otros módulos (no cambiar la firma sin avisar):
 *   revPuedeEnviarse(ctx, folio)                 → {ok, message}           (Correos: antes de enviar)
 *   revpolDecidirAlGuardar(ctx, quoteData)       → {revisar, motivo, origen, reglaId}  (Code: al guardar)
 *   revpolSellarAprobacionAutomatica(ctx, folio, decision)                 (Code: aprobada sola)
 *   audAuditar(ctx, quote, productos, opciones)  → {puntos, score, resumen, criticas, automaticos, pendientes, porRevisar}
 * Y los ayudantes que en Apps Script otros archivos llamaban con `typeof`:
 *   revEstadoDeFolio(ctx, folio)   (Correos.gs · getQuoteDetailsForEmail)
 *   revConteoPendientes(ctx)       (Operacion.gs · opEstadoSesion, la isla de notificaciones)
 *   revUrlPantalla(ctx, folio)     (Code.gs · sendWebhookNotification)
 *   revpolLeer(ctx)                (Code.gs · getQuoteDetails, para revisionDesactivada)
 *
 * Columnas que escribe en `cotizaciones`: revision_estado, revisado_por, revisado_nombre,
 * revision_fecha (ISO UTC), revision_notas, revision_checklist (JSON con `texto`, la lista legible
 * que en la hoja iba en la celda) y estatus. revAsegurarColumnas_ desaparece: en D1 ya existen.
 */
import type { Ctx } from '../nucleo/contexto';
import type { FuncionRpc } from '../rpc';
import { secIdentidadConBloque } from '../nucleo/seguridad';
import { enviarCorreo } from '../nucleo/correo';
import { escaparHtml } from '../nucleo/util';
import { aIso, formatearFecha } from '../nucleo/fechas';
import {
  REV_ESTATUS_APROBADA, REV_ESTATUS_RECHAZADA, REV_ESTATUS_ENVIADA,
  revUrlArticuloSegura, revSheetId, revUrlEmbedSheet
} from './revision/constantes';
import { audDictamen, audAplicarPreciosEnVivo, audCompararConFicha, type Dictamen } from './revision/auditoria';
import { revpolLeer, getPoliticaRevision, guardarPoliticaRevision, simularPoliticaRevision } from './revision/politica';
import { revFichaDeUrl, revFichasEnParalelo, revPaginaDeUrl } from './revision/liverpool';
import { revLeerDetalle, revFilasCola, revAliasCorreo, revCcoGlobal, formatCurrencyGS } from './revision/datos';

export {
  REV_ESTATUS_PENDIENTE, REV_ESTATUS_APROBADA, REV_ESTATUS_RECHAZADA, REV_ESTATUS_ENVIADA,
  REV_HOSTS_ARTICULO, revUrlArticuloSegura
} from './revision/constantes';
export { revpolDecidirAlGuardar, revpolSellarAprobacionAutomatica, revpolLeer } from './revision/politica';

/**
 * Lista de verificación de RESPALDO: solo entra en juego si la auditoría automática revienta, y
 * entonces la pantalla se comporta como antes —casillas que se palomean a mano—, que es mejor que
 * quedarse sin poder aprobar ninguna cotización.
 */
const REV_CHECKLIST_GENERAL = [
  { id: 'cliente-nombre', texto: 'El nombre del cliente está escrito correctamente' },
  { id: 'cliente-correo', texto: 'El correo del cliente es una dirección válida' },
  { id: 'cliente-telefono', texto: 'El teléfono del cliente tiene 10 dígitos válidos' },
  { id: 'asesor', texto: 'El asesor aparece con nombre y apellido, y su extensión es correcta' },
  { id: 'precios', texto: 'Precios, promociones y descuentos coinciden con el sitio' },
  { id: 'totales', texto: 'Subtotal, IVA y total general cuadran' }
];

// ─────────────────────────────────────────────────────────────────────────────────────────
// URLS DE LA APP
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * URL absoluta de una pantalla para un folio. La base sale del origen de la petición (lo que en
 * Apps Script era ScriptApp.getService().getUrl()); el folio se codifica.
 */
function revUrlDeFolio(ctx: Ctx, pagina: string, folio: unknown): string {
  const base = ctx.origen ? ctx.origen + '/' : '';
  if (!base) return '';
  return base + '?page=' + encodeURIComponent(pagina) + '&folio=' + encodeURIComponent(String(folio || ''));
}

/** URL de la pantalla de revisión (la que va en el aviso de nueva cotización). */
export function revUrlPantalla(ctx: Ctx, folio: unknown): string { return revUrlDeFolio(ctx, 'revision_cotizacion', folio); }

/** URL de la consulta de la cotización (la que va en el correo al asesor). */
export function revUrlConsulta(ctx: Ctx, folio: unknown): string { return revUrlDeFolio(ctx, 'consulta_cotizacion', folio); }

// ─────────────────────────────────────────────────────────────────────────────────────────
// ESTADO DE REVISIÓN DE UN FOLIO
// ─────────────────────────────────────────────────────────────────────────────────────────

export interface EstadoRevision {
  existe: boolean; estatus: string; estado: string; por: string; nombre: string; fecha: string;
  notas: string; aprobada: boolean;
}

/** Las columnas de `cotizaciones` que hacen falta para saber el estado de revisión. */
interface FilaEstado {
  estatus: string | null; revision_estado: string | null; revisado_por: string | null;
  revisado_nombre: string | null; revision_fecha: string | null; revision_notas: string | null;
}

function revEstadoVacio(): EstadoRevision {
  return { existe: false, estatus: '', estado: '', por: '', nombre: '', fecha: '', notas: '', aprobada: false };
}

/** El estado de revisión a partir de la fila de `cotizaciones`. */
function revEstadoDeFila(fila: FilaEstado | null): EstadoRevision {
  if (!fila) return revEstadoVacio();
  const estado = String(fila.revision_estado || '');
  const estatus = String(fila.estatus || '');
  return {
    existe: true,
    estatus,
    estado,
    por: String(fila.revisado_por || ''),
    nombre: String(fila.revisado_nombre || ''),
    fecha: aIso(fila.revision_fecha) || String(fila.revision_fecha || ''),
    notas: String(fila.revision_notas || ''),
    // La verdad la manda RevisionEstado. "Estatus" solo cuenta para las cotizaciones ANTERIORES a la
    // revisión, que ya se habían enviado al cliente: bloquearlas ahora rompería trabajo terminado.
    aprobada: estado
      ? (estado === REV_ESTATUS_APROBADA)
      : (estatus === REV_ESTATUS_APROBADA || estatus === REV_ESTATUS_ENVIADA)
  };
}

/**
 * Estado de revisión de un folio, leído directo de D1 (lo usan los gates que deciden si un correo
 * puede salir: ahí un dato de hace tres minutos no sirve). Nunca lanza.
 */
export async function revEstadoDeFolio(ctx: Ctx, folio: unknown): Promise<EstadoRevision> {
  try {
    const fila = await ctx.una<FilaEstado>(
      'SELECT estatus, revision_estado, revisado_por, revisado_nombre, revision_fecha, revision_notas ' +
      'FROM cotizaciones WHERE folio = ?', String(folio == null ? '' : folio));
    return revEstadoDeFila(fila);
  } catch (e: any) {
    console.error('revEstadoDeFolio falló para ' + folio + ': ' + (e && e.message));
    return revEstadoVacio();
  }
}

/**
 * Puerta que usa el envío por correo antes de mandar una cotización al cliente. Es EL punto de
 * control que no se puede saltar (doc 01 §4): todo canal de salida tiene que pasar por aquí.
 */
export async function revPuedeEnviarse(ctx: Ctx, folio: string): Promise<{ ok: boolean; message: string }> {
  const est = await revEstadoDeFolio(ctx, folio);
  if (!est.existe) {
    return { ok: false, message: 'No se encontró la cotización ' + folio + '.' };
  }
  if (est.aprobada) return { ok: true, message: '' };

  // Un RECHAZO es una decisión que tomó una persona mirando el documento. Apagar la revisión afloja la
  // regla general; no borra ese "no". El asesor corrige, vuelve a guardar y la política decide de nuevo.
  if (est.estado === REV_ESTATUS_RECHAZADA) {
    return { ok: false, message: 'Esta cotización fue RECHAZADA en la revisión' +
      (est.nombre ? ' por ' + est.nombre : '') + '. Corrígela y pídela de nuevo a revisión antes de enviarla.' };
  }

  // La revisión pudo apagarse DESPUÉS de que este folio entrara a la cola: si supervisión la
  // desactivó, lo que estaba esperando también sale.
  try {
    if ((await revpolLeer(ctx)).exigirRevision === false) return { ok: true, message: '' };
  } catch (e: any) {
    console.error('revPuedeEnviarse: no se pudo leer la política (' + (e && e.message) + '); se exige revisión.');
  }

  return { ok: false, message: 'Esta cotización todavía está EN REVISIÓN. Un usuario avanzado debe aprobarla antes de que se pueda enviar al cliente.' };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// COLA DE REVISIÓN
// ─────────────────────────────────────────────────────────────────────────────────────────

/** "En Revisión", "en revision" y "EN  REVISIÓN" son el mismo estado. */
function revClaveEstado(valor: unknown): string {
  return String(valor == null ? '' : valor)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/\s+/g, '-');
}

/* Estados que el sistema reconoce, y de ellos los que siguen esperando a una persona. Es el mismo
   criterio que app_estatus.html usa en el cliente: si allí se añade un estado, aquí también. */
const REV_ESTADOS_CONOCIDOS = ['en-revision', 'folio-generado', 'pendiente', 'aprobada', 'autorizada', 'rechazada', 'enviada-por-correo'];
const REV_ESTADOS_PENDIENTES = ['en-revision', 'folio-generado', 'pendiente'];

/** ¿Este folio sigue esperando a que alguien lo apruebe o lo rechace? */
export function revEsPendiente(estatus: unknown, revisionEstado: unknown): boolean {
  const k = revClaveEstado(estatus);
  // Una cotización ya ENVIADA está cerrada, diga lo que diga la columna de revisión.
  if (k === 'enviada-por-correo') return false;
  const kRev = revClaveEstado(revisionEstado);
  const elegida = REV_ESTADOS_CONOCIDOS.indexOf(kRev) !== -1 ? kRev : k;
  return REV_ESTADOS_PENDIENTES.indexOf(elegida) !== -1;
}

/**
 * La cola de pendientes para quien puede revisar (bloque 'revisar'). Existe aparte de
 * getSupervisionQuotes porque son dos permisos distintos: quien solo revisa necesita saber qué hay
 * por revisar, no el historial del equipo ni los importes de lo ya cerrado. El permiso más pequeño
 * trae el dato más pequeño que lo hace útil.
 */
export async function revListaPendientes(ctx: Ctx, email: string) {
  try {
    const id = await secIdentidadConBloque(ctx, email, 'revisar');
    if (!id.ok) {
      return { success: false, quotes: [], message: id.error || 'No tienes permiso para revisar cotizaciones.' };
    }
    const pendientes = (await revFilasCola(ctx))
      .filter((q) => revEsPendiente(q.status, q.revisionEstado))
      .map((q) => ({
        folio: q.folio,
        timestamp: q.timestamp,
        advisorName: q.advisorName,
        clientName: q.clientName,
        total: q.total,
        status: q.status,
        revisionEstado: q.revisionEstado
      }));
    return { success: true, quotes: pendientes, message: '' };
  } catch (e: any) {
    console.error('revListaPendientes error: ' + (e && e.message));
    return { success: false, quotes: [], message: 'No pudimos cargar la cola de revisión.' };
  }
}

/**
 * CUÁNTAS cotizaciones siguen esperando revisión, SIN puerta: quien llama (opEstadoSesion,
 * revContarPendientes) ya comprobó el bloque. -1 si no se pudo leer, para distinguir "cero" de "no se
 * sabe". Sin la caché por generación de Apps Script: D1 cuenta en milisegundos.
 */
export async function revConteoPendientes(ctx: Ctx): Promise<number> {
  try {
    return (await revFilasCola(ctx)).filter((q) => revEsPendiente(q.status, q.revisionEstado)).length;
  } catch (e: any) {
    console.error('revConteoPendientes: ' + (e && e.message));
    return -1;
  }
}

/**
 * El conteo con su puerta. En Apps Script era solo interna (secSoloInterno_ y SES_NO_EXPUESTAS): por
 * eso se exporta para otros módulos pero NO se registra en `funciones`.
 */
export async function revContarPendientes(ctx: Ctx, email: string) {
  try {
    const id = await secIdentidadConBloque(ctx, email, 'revisar');
    if (!id.ok) {
      return { success: false, pendientes: 0, message: id.error || 'No tienes permiso para revisar cotizaciones.' };
    }
    const n = await revConteoPendientes(ctx);
    if (n < 0) return { success: false, pendientes: 0, message: 'No se pudieron leer las cotizaciones.' };
    return { success: true, pendientes: n, message: '' };
  } catch (e: any) {
    console.error('revContarPendientes error: ' + (e && e.message));
    return { success: false, pendientes: 0, message: 'No pudimos contar la cola de revisión.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// VERIFICACIÓN AUTOMÁTICA
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Contrato: el dictamen de una cotización (AuditoriaCotizacion.gs · audAuditar_). */
export async function audAuditar(ctx: Ctx, quote: any, productos: any[], opciones?: any): Promise<any> {
  return audDictamen(quote, productos, opciones);
}

/**
 * Dictamen con respaldo: si el motor de auditoría revienta, la pantalla vuelve a la lista de casillas
 * manuales de siempre. Una revisión más tosca es aceptable; quedarse sin poder aprobar, no.
 */
function revAuditar(quote: any, productos: any[]): Dictamen {
  try {
    return audDictamen(quote, productos);
  } catch (e: any) {
    console.error('revAuditar: el motor de auditoría falló (' + (e && e.message) + '); se usa la lista manual.');
  }
  return {
    puntos: REV_CHECKLIST_GENERAL.map((it) => ({
      id: it.id, texto: it.texto, estado: 'manual', detalle: '', auto: false,
      peso: 100 / REV_CHECKLIST_GENERAL.length, sugerencia: '', evidencia: []
    })),
    score: null,
    resumen: 'La verificación automática no está disponible: revisa los puntos a mano.',
    criticas: [], automaticos: 0, pendientes: 0, porRevisar: REV_CHECKLIST_GENERAL.length,
    degradada: true
  };
}

/**
 * Las líneas con el enlace YA SANEADO: lo que llega a la pantalla es incrustable o viene vacío. Se
 * distingue "no traía enlace" (cotización vieja) de "traía uno que no se puede abrir aquí" (algo que
 * hay que mirar).
 *
 * La auditoría corre SIEMPRE sobre estas líneas: un enlace que no es de liverpool.com.mx cuenta como
 * captura a mano, que es la verdad. (Apps Script ya lo hacía así al abrir la revisión, pero al guardar
 * y en la verificación en lote auditaba las líneas crudas, y un artículo con enlace ajeno podía quedar
 * como «verificado» sin que nadie lo comparara. Aquí las tres rutas usan las mismas líneas.)
 */
function revProductosParaRevision(productos: any[]) {
  return (productos || []).map((p, i) => {
    const seguro = revUrlArticuloSegura(p.productUrl || '');
    return {
      indice: i,
      sku: p.sku || '',
      description: p.description || '',
      quantity: p.quantity || 0,
      unitPrice: p.unitPrice || 0,
      costPaymentUnique: p.costPaymentUnique || 0,
      discountPublicPercent: p.discountPublicPercent || 0,
      additionalDiscountApplied: p.additionalDiscountApplied || 'No',
      additionalDiscountPercent: p.additionalDiscountPercent || 0,
      imageUrl: p.imageUrl || '',
      productUrl: seguro,
      urlDescartada: !seguro && !!String(p.productUrl || '').trim()
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// LECTURA PARA LA PANTALLA DE REVISIÓN
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Todo lo que necesita revision_cotizacion.html en UNA llamada. Sin caché a propósito: es la pantalla
 * donde se decide si un documento sale al cliente.
 */
export async function getRevisionCotizacion(ctx: Ctx, folio: string, email: string) {
  try {
    if (!folio) return { success: false, message: 'Falta el folio de la cotización.' };

    const id = await secIdentidadConBloque(ctx, email, 'revisar');
    if (!id.ok) {
      return { success: false, sinPermiso: true, message: id.error || 'Solo un usuario avanzado puede revisar cotizaciones.' };
    }

    // El estado sale de la fila tal cual (revEstadoDeFolio_), no de quote.revision: ese trae el ajuste
    // de «revisión desactivada» que hace la consulta, y aquí se enseña lo que decidió una persona.
    const [det, estado] = await Promise.all([revLeerDetalle(ctx, folio), revEstadoDeFolio(ctx, folio)]);
    if (!det.success) return { success: false, message: det.message || 'Cotización no encontrada.' };

    const quote = det.quote;
    const productos = revProductosParaRevision(quote.products);
    const auditoria = revAuditar(quote, productos);

    return {
      success: true,
      revisor: { email: id.email, nombre: id.nombre },
      quote: {
        folio: quote.folio,
        timestamp: quote.timestamp,
        advisorName: quote.advisorName,
        advisorEmail: quote.advisorEmail,
        advisorExt: quote.advisorExt,
        clientName: quote.clientName,
        clientEmail: quote.clientEmail,
        clientPhone: quote.clientPhone,
        summarySubtotal: quote.summarySubtotal,
        summaryVat: quote.summaryVat,
        summaryTotal: quote.summaryTotal,
        observations: quote.observations,
        format: quote.format,
        status: quote.status,
        driveLink: quote.driveLink || ''
      },
      products: productos,
      sheetEmbedUrl: revUrlEmbedSheet(quote.cclSheetLink || ''),
      sheetUrl: String(quote.cclSheetLink || ''),
      hojaIncrustable: !!revSheetId(quote.cclSheetLink || '').id,
      // Los puntos llegan YA RESUELTOS: la pantalla los pinta, no los calcula, y al guardar se
      // vuelven a calcular aquí.
      checklistGeneral: auditoria.puntos,
      auditoria,
      revision: {
        estado: estado.estado,
        por: estado.por,
        nombre: estado.nombre,
        fecha: estado.fecha,
        notas: estado.notas,
        aprobada: estado.aprobada
      }
    };
  } catch (error: any) {
    console.error('getRevisionCotizacion falló: ' + (error && error.message));
    return { success: false, message: 'No pudimos abrir la revisión. Inténtalo de nuevo en un momento.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// ESCRITURA DE LA DECISIÓN
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Cierra la revisión de una cotización: la aprueba o la rechaza.
 * @param payload {folio, email, decision:'aprobada'|'rechazada', notas, checklist, verificaciones}
 */
export async function guardarRevisionCotizacion(ctx: Ctx, payload: any) {
  const p = payload || {};
  try {
    const folio = String(p.folio || '').trim();
    if (!folio) return { success: false, message: 'Falta el folio de la cotización.' };

    const id = await secIdentidadConBloque(ctx, p.email, 'revisar');
    if (!id.ok) {
      return { success: false, sinPermiso: true, message: id.error || 'Solo un usuario avanzado puede cerrar una revisión.' };
    }

    const decision = String(p.decision || '').trim().toLowerCase();
    if (decision !== 'aprobada' && decision !== 'rechazada') {
      return { success: false, message: 'La decisión debe ser "aprobada" o "rechazada".' };
    }

    const notas = String(p.notas || '').trim();
    // Rechazar sin decir por qué deja al asesor sin nada que corregir.
    if (decision === 'rechazada' && notas.length < 10) {
      return { success: false, message: 'Para rechazar hay que escribir la observación de qué se debe corregir (mínimo 10 caracteres).' };
    }
    if (notas.length > 4000) {
      return { success: false, message: 'Las observaciones son demasiado largas (máximo 4000 caracteres).' };
    }

    const nuevoEstado = (decision === 'aprobada') ? REV_ESTATUS_APROBADA : REV_ESTATUS_RECHAZADA;
    const ahora = new Date();

    // La auditoría se REHACE aquí, con los datos de la base y no con los que mande la pantalla: el
    // cliente puede llamar a esta función desde la consola con el dictamen que se le antoje.
    let auditoria: Dictamen | null = null;
    try {
      const previo = await revLeerDetalle(ctx, folio);
      if (previo.success) {
        auditoria = revAuditar(previo.quote, revProductosParaRevision(previo.quote.products));
        // Las verificaciones de la pantalla solo ahorran volver a pedirle a Liverpool lo que ya contestó.
        if (p.verificaciones) auditoria = audAplicarPreciosEnVivo(auditoria, p.verificaciones);
      }
    } catch (e: any) {
      console.error('guardarRevisionCotizacion: no se pudo auditar ' + folio + ' (' + (e && e.message) + ').');
    }

    // Aprobar con comprobaciones falladas se PUEDE —hay casos legítimos— pero no en silencio: queda por
    // escrito quién lo aprobó, con qué falla y por qué.
    if (auditoria && auditoria.criticas && auditoria.criticas.length && decision === 'aprobada' && notas.length < 10) {
      return {
        success: false,
        requiereJustificacion: true,
        criticas: auditoria.criticas,
        message: 'La verificación automática encontró ' + auditoria.criticas.length +
                 ' problema(s): ' + auditoria.criticas.join(' · ') +
                 ' Si aun así hay que aprobarla, escribe en las observaciones por qué (mínimo 10 caracteres).'
      };
    }

    // Una sola sentencia: D1 la aplica entera o no la aplica (lo que en Apps Script cuidaba el
    // LockService). Si dos supervisores deciden a la vez, gana la última, igual que allá.
    const r = await ctx.ejecutar(
      'UPDATE cotizaciones SET revision_estado = ?, revisado_por = ?, revisado_nombre = ?, revision_fecha = ?, ' +
      'revision_notas = ?, revision_checklist = ?, estatus = ? WHERE folio = ?',
      nuevoEstado, id.email, id.nombre || id.email, ahora.toISOString(), notas,
      revChecklistJson(p.checklist, auditoria),
      // El estatus visible del panel también cambia, para que la lista diga en qué punto está.
      nuevoEstado, folio);
    if (!r.cambios) throw new Error('No se encontró la cotización ' + folio + '.');

    // El aviso al asesor va DESPUÉS de escribir: si el correo falla, la revisión no se pierde.
    let avisoCorreo = '';
    try {
      const det = await revLeerDetalle(ctx, folio);
      avisoCorreo = await revNotificarAsesor(ctx, det.success ? det.quote : null, folio, nuevoEstado, id, notas, ahora);
    } catch (e: any) {
      console.error('No se pudo avisar al asesor de la revisión de ' + folio + ': ' + (e && e.message));
      avisoCorreo = 'La revisión quedó guardada, pero no se pudo enviar el aviso por correo al asesor (' + (e && e.message) + ').';
    }

    return {
      success: true,
      message: (nuevoEstado === REV_ESTATUS_APROBADA)
        ? 'Cotización aprobada. El envío por correo ya está desbloqueado.'
        : 'Cotización rechazada. Se avisó al asesor con tus observaciones.',
      avisoCorreo,
      revision: {
        estado: nuevoEstado,
        por: id.email,
        nombre: id.nombre || id.email,
        fecha: ahora.toISOString(),
        notas,
        aprobada: nuevoEstado === REV_ESTATUS_APROBADA
      }
    };
  } catch (error: any) {
    console.error('guardarRevisionCotizacion falló: ' + (error && error.message));
    return { success: false, message: 'No pudimos guardar la revisión. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * La lista de verificación en texto LEGIBLE (lo que en Apps Script iba en la celda RevisionChecklist):
 * el dictamen automático primero, con el veredicto del servidor, y luego lo que confirmó la persona.
 * Es lo que contesta, meses después, "¿esto se revisó de verdad?".
 */
function revChecklistTexto(checklist: any, auditoria: Dictamen | null): string {
  const c = checklist || {};
  const lineas: string[] = [];
  try {
    if (auditoria && auditoria.puntos) {
      if (auditoria.score != null) {
        lineas.push('Índice de confianza de la verificación automática: ' + auditoria.score + '/100');
      }
      const simbolo: Record<string, string> = { ok: '✔', atencion: '⚠', mal: '✖', manual: '○', pendiente: '…' };
      auditoria.puntos.forEach((pt) => {
        lineas.push((simbolo[pt.estado] || '·') + ' ' + String(pt.texto || pt.id || '') + (pt.detalle ? ' — ' + pt.detalle : ''));
      });
      lineas.push('— Confirmado por quien revisó:');
    }

    (c.general || []).forEach((item: any) => {
      lineas.push((item.ok ? '✔ ' : '✖ ') + String(item.texto || item.id || ''));
    });
    const arts = c.articulos || [];
    const verificados = arts.filter((a: any) => a && a.ok).length;
    if (arts.length) {
      lineas.push('— Artículos verificados: ' + verificados + ' de ' + arts.length);
      arts.forEach((a: any) => {
        lineas.push('   ' + (a.ok ? '✔' : '✖') + ' ' + String(a.sku || '') + ' · ' + String(a.description || ''));
      });
    }
  } catch {
    return '(no se pudo leer la lista de verificación)';
  }
  const texto = lineas.join('\n');
  // Se recorta muy por debajo de lo que aguanta la columna para no convertirla en un volcado.
  return texto.length > 8000 ? texto.slice(0, 8000) + '\n…(recortado)' : texto;
}

/**
 * revision_checklist en D1 es JSON (0001_esquema.sql). Lleva el texto legible de siempre y, al lado,
 * lo mínimo estructurado que sale del cálculo del SERVIDOR (nunca lo que dijo la pantalla).
 */
function revChecklistJson(checklist: any, auditoria: Dictamen | null): string {
  let verificados = 0, total = 0;
  try {
    const arts = Array.isArray(checklist && checklist.articulos) ? checklist.articulos : [];
    total = arts.length;
    verificados = arts.filter((a: any) => a && a.ok).length;
  } catch { /* el texto ya lo dice */ }
  return JSON.stringify({
    v: 1,
    tipo: 'revision',
    texto: revChecklistTexto(checklist, auditoria),
    score: auditoria && auditoria.score != null ? auditoria.score : null,
    puntos: auditoria && auditoria.puntos ? auditoria.puntos.map((pt) => ({ id: pt.id, estado: pt.estado })) : [],
    articulos: { verificados, total }
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// AVISO AL ASESOR
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Avisa por correo al asesor dueño de la cotización: qué se decidió, quién y con qué notas.
 * Sale por Brevo desde logidma.com en lugar de GmailApp/MailApp (nucleo/correo.ts) y queda además en
 * `correos_salida`; a un destinatario de ejemplo (@ventel.example) no se manda, solo se registra.
 * Si Brevo rechaza el envío, enviarCorreo LANZA como lanzaba MailApp.sendEmail: quien llama lo
 * convierte en `avisoCorreo` y la decisión, que ya quedó escrita, no se pierde.
 * @return '' si salió bien, o el motivo por el que no se pudo enviar.
 */
async function revNotificarAsesor(ctx: Ctx, quote: any, folio: string, estado: string,
  revisor: { email: string; nombre: string }, notas: string, fecha: Date): Promise<string> {
  const para = quote && quote.advisorEmail ? String(quote.advisorEmail).trim() : '';
  if (!para) return 'La cotización no tiene correo de asesor registrado: no se envió aviso.';

  const aprobada = (estado === REV_ESTATUS_APROBADA);
  const asunto = (aprobada ? '\u2705 Cotización aprobada · ' : '\u26a0\ufe0f Cotización rechazada · ') + folio;
  const urlConsulta = revUrlConsulta(ctx, folio);

  const html = revPlantillaAviso({
    aprobada,
    folio,
    cliente: quote.clientName || '',
    total: quote.summaryTotal,
    revisorNombre: revisor.nombre || revisor.email,
    revisorEmail: revisor.email,
    fecha,
    notas,
    url: urlConsulta
  });

  const plano = (aprobada ? 'Tu cotización ' + folio + ' fue APROBADA.' : 'Tu cotización ' + folio + ' fue RECHAZADA.') +
    '\nRevisó: ' + (revisor.nombre || revisor.email) + ' (' + revisor.email + ')' +
    '\nFecha: ' + formatearFecha(fecha, 'dd/MM/yyyy HH:mm') +
    (notas ? '\nObservaciones: ' + notas : '') +
    (urlConsulta ? '\n\nVer la cotización: ' + urlConsulta : '');

  // Copia oculta global (T9.6): un aviso de aprobación o rechazo es justo lo que se querrá releer.
  const cco = await revCcoGlobal(ctx, [para]);
  // El alias se trata como disponible (lo que en Apps Script era la rama de GmailApp con `from`):
  // el núcleo lo deja en logidma.com si viniera de otro dominio. Sin `responderA`, como el original:
  // el pie del aviso pide escribir directamente a quien revisó.
  const envio = await enviarCorreo(ctx, {
    para, asunto, html, texto: plano, cco,
    de: await revAliasCorreo(ctx),
    nombreDe: 'Sistema de cotizaciones Ventel',
    tipo: 'revision',
    referencia: folio
  });
  console.log('Aviso de revisión ' + envio.estado + ' para ' + para + ' (' + folio + ')');
  return '';
}

/** Cuerpo HTML del aviso. Tabla de 560 px y estilos en línea: es lo único que sobrevive a Outlook. */
function revPlantillaAviso(o: {
  aprobada: boolean; folio: string; cliente: string; total: unknown; revisorNombre: string;
  revisorEmail: string; fecha: Date; notas: string; url: string;
}): string {
  const acento = o.aprobada ? '#0F7B47' : '#B4451F';
  const fondo = o.aprobada ? '#E7F6EE' : '#FDEDE6';
  const titulo = o.aprobada ? 'Tu cotización fue aprobada' : 'Tu cotización necesita correcciones';
  const bajada = o.aprobada
    ? 'Ya puedes enviarla al cliente desde el sistema.'
    : 'No se envió al cliente. Corrige lo señalado y vuelve a pedir la revisión.';
  const esc = escaparHtml;
  const fechaTxt = formatearFecha(o.fecha, "dd/MM/yyyy 'a las' HH:mm");
  const totalTxt = formatCurrencyGS(o.total);

  return '' +
  '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>' + esc(titulo) + '</title></head>' +
  '<body style="margin:0;padding:24px 12px;background:#F4F5F7;">' +
  '<table cellpadding="0" cellspacing="0" border="0" role="presentation" ' +
    'style="width:100%;max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E7EC;' +
    'border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1B2330;">' +

    '<tr><td style="background:#E10098;padding:18px 24px;">' +
      '<div style="color:#FFFFFF;font-size:13px;letter-spacing:.08em;text-transform:uppercase;">Sistema de cotizaciones Ventel</div>' +
      '<div style="color:#FFFFFF;font-size:19px;font-weight:bold;margin-top:4px;">Resultado de la revisión</div>' +
    '</td></tr>' +

    '<tr><td style="padding:24px;">' +
      '<div style="background:' + fondo + ';border-left:4px solid ' + acento + ';border-radius:8px;padding:14px 16px;">' +
        '<div style="color:' + acento + ';font-size:17px;font-weight:bold;">' + esc(titulo) + '</div>' +
        '<div style="color:#3C4655;font-size:14px;line-height:1.5;margin-top:4px;">' + esc(bajada) + '</div>' +
      '</div>' +

      '<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;margin-top:20px;font-size:14px;">' +
        '<tr><td style="color:#5B6572;padding:6px 0;width:34%;">Folio</td>' +
            '<td style="padding:6px 0;font-weight:bold;">' + esc(o.folio) + '</td></tr>' +
        '<tr><td style="color:#5B6572;padding:6px 0;">Cliente</td>' +
            '<td style="padding:6px 0;">' + esc(o.cliente || 'N/A') + '</td></tr>' +
        '<tr><td style="color:#5B6572;padding:6px 0;">Total</td>' +
            '<td style="padding:6px 0;">' + esc(totalTxt) + '</td></tr>' +
        '<tr><td style="color:#5B6572;padding:6px 0;">Revisó</td>' +
            '<td style="padding:6px 0;">' + esc(o.revisorNombre) +
              '<br><span style="color:#5B6572;font-size:12px;">' + esc(o.revisorEmail) + '</span></td></tr>' +
        '<tr><td style="color:#5B6572;padding:6px 0;">Fecha</td>' +
            '<td style="padding:6px 0;">' + esc(fechaTxt) + '</td></tr>' +
      '</table>' +

      (o.notas
        ? '<div style="margin-top:20px;">' +
            '<div style="color:#5B6572;font-size:12px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;">Observaciones de la revisión</div>' +
            '<div style="background:#F7F8FA;border:1px solid #E4E7EC;border-radius:8px;padding:14px 16px;' +
              'font-size:14px;line-height:1.6;white-space:pre-wrap;">' + esc(o.notas) + '</div>' +
          '</div>'
        : '') +

      (o.url
        ? '<div style="margin-top:24px;">' +
            '<a href="' + esc(o.url) + '" style="display:inline-block;background:#E10098;color:#FFFFFF;' +
              'text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:8px;">' +
              'Abrir la cotización</a>' +
          '</div>'
        : '') +
    '</td></tr>' +

    '<tr><td style="border-top:1px solid #E4E7EC;padding:16px 24px;color:#5B6572;font-size:11px;line-height:1.5;">' +
      'Mensaje automático del Sistema de cotizaciones Ventel. No respondas a este correo: ' +
      'escribe directamente a quien revisó tu cotización.' +
    '</td></tr>' +

  '</table></body></html>';
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// FICHA, PÁGINA Y PRECIOS EN VIVO (la lógica de red vive en revision/liverpool.ts)
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * La ficha actual del artículo en liverpool.com.mx para compararla con la cotización. El correo de
 * la sesión evita que la función quede como relay de descargas abierto a cualquiera.
 */
export async function revFichaArticulo(ctx: Ctx, url: string, sku: string, email: string) {
  try {
    const id = await secIdentidadConBloque(ctx, email, 'revisar');
    if (!id.ok) {
      return { ok: false, motivo: 'sin-permiso', mensaje: 'Solo un usuario avanzado puede consultar la ficha del artículo.' };
    }
    return await revFichaDeUrl(ctx, url, sku);
  } catch (error: any) {
    console.error('revFichaArticulo falló: ' + (error && error.message));
    return { ok: false, motivo: 'error', mensaje: 'No se pudo leer la ficha: ' + (error && error.message) };
  }
}

/**
 * Compara CONTRA EL SITIO el precio de todos los artículos que traen enlace, en una sola llamada (en
 * paralelo). Es lo que permite que el punto "los precios coinciden con el sitio" se marque solo.
 */
export async function revVerificarPreciosLote(ctx: Ctx, folio: string, email: string) {
  try {
    const id = await secIdentidadConBloque(ctx, email, 'revisar');
    if (!id.ok) {
      return { ok: false, sinPermiso: true, mensaje: id.error || 'Solo un usuario avanzado puede verificar precios.' };
    }
    if (!folio) return { ok: false, mensaje: 'Falta el folio.' };

    const det = await revLeerDetalle(ctx, folio);
    if (!det.success) return { ok: false, mensaje: det.message || 'Cotización no encontrada.' };

    const productos = det.quote.products || [];
    const pedidos: Array<{ indice: number; url: string; sku: string }> = [];
    productos.forEach((p, i) => {
      const u = revUrlArticuloSegura(p.productUrl || '');
      if (u) pedidos.push({ indice: i, url: u, sku: p.sku || '' });
    });

    if (!pedidos.length) {
      return { ok: true, verificaciones: [], sinEnlaces: true,
               mensaje: 'Ningún artículo trae enlace a su página: no hay nada que comparar solo.' };
    }

    const fichas = await revFichasEnParalelo(ctx, pedidos);
    const verificaciones = pedidos.map((ped) => {
      const ficha: any = fichas[ped.indice] || { ok: false, mensaje: 'No se obtuvo respuesta del sitio.' };
      const cmp = audCompararConFicha(productos[ped.indice], ficha);
      return {
        indice: ped.indice,
        sku: ped.sku,
        estado: cmp.estado,
        titulo: cmp.titulo,
        mensaje: cmp.mensaje,
        diferencia: cmp.diferencia,
        similitud: cmp.similitud,
        precioSitio: (ficha && typeof ficha.precio === 'number') ? ficha.precio : null,
        tituloSitio: (ficha && ficha.titulo) ? ficha.titulo : '',
        deCache: !!(ficha && ficha.deCache)
      };
    });

    // El dictamen se vuelve a resumir con los precios ya comprobados, para que el índice que ve el
    // supervisor sea el mismo número que calculará el servidor al guardar.
    const auditoria = audAplicarPreciosEnVivo(revAuditar(det.quote, revProductosParaRevision(productos)), verificaciones);
    return { ok: true, verificaciones, auditoria };
  } catch (error: any) {
    console.error('revVerificarPreciosLote falló: ' + (error && error.message));
    return { ok: false, mensaje: 'No se pudieron verificar los precios: ' + (error && error.message) };
  }
}

/**
 * La página del artículo, saneada y lista para incrustarse con `srcdoc` en un iframe aislado.
 */
export async function revPaginaArticulo(ctx: Ctx, url: string, sku: string, email: string) {
  try {
    const id = await secIdentidadConBloque(ctx, email, 'revisar');
    if (!id.ok) {
      return { ok: false, motivo: 'sin-permiso', mensaje: 'Solo un usuario avanzado puede abrir la página del artículo aquí dentro.' };
    }
    const limpia = revUrlArticuloSegura(url);
    if (!limpia) {
      return { ok: false, motivo: 'url-invalida', mensaje: 'El enlace guardado no es una dirección de liverpool.com.mx.' };
    }
    return await revPaginaDeUrl(ctx, limpia);
  } catch (error: any) {
    console.error('revPaginaArticulo falló: ' + (error && error.message));
    return { ok: false, motivo: 'error', mensaje: 'No se pudo preparar la página: ' + (error && error.message) };
  }
}

/**
 * La hoja de Google Sheets de la cotización (formato CCL), leída por el servidor para pintarla en el
 * portal. Esta versión no usa Google Drive: responde con la forma de un fallo controlado del original
 * (ok:false + mensaje) y la pantalla ofrece abrirla en Google con el botón de siempre.
 */
export async function revHojaCotizacion(ctx: Ctx, folio: string, email: string) {
  try {
    const id = await secIdentidadConBloque(ctx, email, 'revisar');
    if (!id.ok) {
      return { ok: false, sinPermiso: true, mensaje: id.error || 'Solo un usuario avanzado puede ver la hoja.' };
    }
    if (!folio) return { ok: false, mensaje: 'Falta el folio.' };

    const det = await revLeerDetalle(ctx, folio);
    if (!det.success) return { ok: false, mensaje: det.message || 'Cotización no encontrada.' };

    const ref = revSheetId(det.quote.cclSheetLink || '');
    if (!ref.id) {
      return { ok: false, motivo: 'sin-hoja',
               mensaje: 'Esta cotización no tiene documento en Google Sheets (solo las del formato CCL lo llevan).' };
    }
    // SpreadsheetApp.openById no existe aquí (decisión: lo que venga de Google queda en blanco).
    return { ok: false, motivo: 'sin-acceso', url: det.quote.cclSheetLink || '',
             embedUrl: revUrlEmbedSheet(det.quote.cclSheetLink || ''),
             mensaje: 'Esta versión de demostración no genera archivos en Google Drive.' };
  } catch (error: any) {
    console.error('revHojaCotizacion falló: ' + (error && error.message));
    return { ok: false, mensaje: 'No pudimos leer el documento. Inténtalo de nuevo en un momento.' };
  }
}

// ── Registro de funciones expuestas al navegador ────────────────────────────
// Fuera a propósito: revContarPendientes (solo interna en Apps Script) y los diagnósticos de editor
// (revDiagnostico, revDiagnosticoFicha, revpolDiagnostico, audDiagnostico).

export const funciones: Record<string, FuncionRpc> = {
  // Revision.gs
  getRevisionCotizacion,
  guardarRevisionCotizacion,
  revListaPendientes,
  revFichaArticulo,
  revPaginaArticulo,
  revHojaCotizacion,
  revVerificarPreciosLote,
  // PoliticaRevision.gs
  getPoliticaRevision,
  guardarPoliticaRevision,
  simularPoliticaRevision
};
