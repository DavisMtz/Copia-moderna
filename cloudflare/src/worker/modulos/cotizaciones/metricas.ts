/**
 * MÉTRICAS DE CORREOS ENVIADOS | Portal Ventel en Cloudflare
 * ==========================================================
 * Port de Metricas.gs. Registro unificado de TODOS los correos que salen de la app (cotizaciones,
 * plantillas a cliente, difusiones) en la tabla `metricas_correos`, fuente única para medir la
 * actividad por asesor, por día y por tipo. En esta versión los correos no salen de verdad
 * (nucleo/correo.ts), pero la métrica se escribe igual que si hubieran salido.
 *
 * Contrato que usan otros módulos: metRegistrarEnvio(ctx, ev). Nunca lanza.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIdentidad, secIdentidadConBloque } from '../../nucleo/seguridad';
import { formatearFecha } from '../../nucleo/fechas';

/** Gate de sesión de los envíos: quien manda debe tener una sesión válida del Portal. */
export async function metVerificarAsesor(ctx: Ctx, email: unknown): Promise<{
  ok: boolean; email: string; nombre: string; avanzado: boolean; error: string;
}> {
  const id = await secIdentidad(ctx, email);
  return { ok: id.ok, email: id.email, nombre: id.nombre, avanzado: id.avanzado, error: id.error || '' };
}

/**
 * Una fila en metricas_correos. Nunca lanza: si falla solo se registra, para no tumbar el envío
 * (que ya se realizó).
 * @param ev {tipo, referencia, asesorEmail, asesorNombre, para, destinatarios, cc, cco, asunto,
 *            adjuntos, remitente, aliasUsado, resultado, detalle, plantillaModificada}
 */
export async function metRegistrarEnvio(ctx: Ctx, ev: Record<string, any>): Promise<void> {
  const e = ev || {};
  try {
    await ctx.ejecutar(
      'INSERT INTO metricas_correos (fecha, tipo, referencia, asesor_email, asesor_nombre, para, destinatarios, ' +
      'cc, cco, asunto, adjuntos, remitente, alias_usado, resultado, detalle, plantilla_modificada) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ctx.ahoraIso(),
      e.tipo || '',
      e.referencia || '',
      e.asesorEmail || '',
      e.asesorNombre || '',
      e.para || '',
      Number(e.destinatarios) || 0,
      // CC, CCO y Adjuntos son conteos en columnas TEXT: como texto, para que D1 no guarde '2.0'.
      String(e.cc || 0),
      String(e.cco || 0),
      e.asunto || '',
      String(e.adjuntos || 0),
      e.remitente || '',
      e.aliasUsado ? 'Sí' : 'No',
      e.resultado || '',
      e.detalle || '',
      e.plantillaModificada || '');
    // (Aquí Apps Script tiraba la caché del resumen; en D1 no hay caché que tirar.)
  } catch (err) {
    console.error('metRegistrarEnvio no pudo registrar la métrica', err);
  }
}

const RESUMEN_VACIO = () => ({
  success: true, total: 0, enviados: 0, errores: 0, porTipo: {}, porDia: [], porAsesor: [], recientes: []
});

/**
 * Resumen de métricas para el panel avanzado. Solo con el bloque de supervisión.
 * @return { success, total, enviados, errores, porTipo, porDia, porAsesor, recientes }
 */
export async function getResumenMetricasCorreos(ctx: Ctx, solicitanteEmail: string) {
  try {
    const who = await secIdentidadConBloque(ctx, solicitanteEmail, 'supervision');
    if (!who.ok) return { success: false, message: who.error || 'Solo los usuarios avanzados pueden ver las métricas de correos.' };
    return await calcularResumenMetricas(ctx);
  } catch (error) {
    console.error('getResumenMetricasCorreos', error);
    return { success: false, message: 'No pudimos calcular el resumen. Inténtalo de nuevo en un momento.' };
  }
}

/** El mismo cálculo de Metricas.gs, con la agregación hecha por D1 en vez de leer la hoja entera. */
async function calcularResumenMetricas(ctx: Ctx) {
  try {
    // "Enviado" es lo que contiene /enviad/i (LIKE ya ignora mayúsculas en ASCII).
    const OK = "(resultado LIKE '%enviad%')";
    const [totales, tipos, asesores, horas, ultimas] = await Promise.all([
      ctx.una<{ total: number; enviados: number }>(
        `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN ${OK} THEN 1 ELSE 0 END), 0) AS enviados FROM metricas_correos`),
      ctx.todas<{ tipo: string; n: number }>(
        "SELECT COALESCE(NULLIF(tipo, ''), '—') AS tipo, COUNT(*) AS n, MIN(id) AS primero " +
        'FROM metricas_correos GROUP BY 1 ORDER BY primero'),
      // SQLite: con MIN(id) en la consulta, la columna suelta (asesor_nombre) sale de esa misma fila,
      // que es el nombre de la primera aparición, como hacía el mapa de Metricas.gs.
      ctx.todas<{ email: string; nombre: string; total: number; enviados: number; primero: number }>(
        "SELECT COALESCE(NULLIF(asesor_email, ''), '—') AS email, MIN(id) AS primero, asesor_nombre AS nombre, " +
        `COUNT(*) AS total, SUM(CASE WHEN ${OK} THEN 1 ELSE 0 END) AS enviados FROM metricas_correos GROUP BY 1`),
      // Por hora UTC y no por día: el día se decide en hora de México (México no cambia de horario y
      // sus desfases son de horas enteras, así que cada hora cae entera en un solo día local).
      ctx.todas<{ h: string; n: number }>('SELECT substr(fecha, 1, 13) AS h, COUNT(*) AS n FROM metricas_correos GROUP BY 1'),
      ctx.todas('SELECT fecha, tipo, referencia, asesor_email, asesor_nombre, para, asunto, resultado ' +
        'FROM metricas_correos ORDER BY id DESC LIMIT 20')
    ]);

    const total = Number(totales?.total) || 0;
    if (!total) return RESUMEN_VACIO();
    const enviados = Number(totales?.enviados) || 0;

    const porTipo: Record<string, number> = {};
    tipos.forEach((t) => { porTipo[String(t.tipo)] = Number(t.n) || 0; });

    const porDiaMap: Record<string, number> = {};
    horas.forEach((x) => {
      const h = String(x.h || '');
      const d = /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(h) ? new Date(h + ':00:00Z') : null;
      if (!d || isNaN(d.getTime())) return;
      const dia = formatearFecha(d, 'yyyy-MM-dd');
      porDiaMap[dia] = (porDiaMap[dia] || 0) + (Number(x.n) || 0);
    });
    const porDia = Object.keys(porDiaMap).sort().slice(-30).map((d) => ({ dia: d, total: porDiaMap[d] }));

    // Mismo orden que Metricas.gs: por total, y a igualdad, por primera aparición.
    const porAsesor = asesores
      .sort((a, b) => a.primero - b.primero)
      .map((a) => ({ email: String(a.email), nombre: String(a.nombre || ''), total: Number(a.total) || 0, enviados: Number(a.enviados) || 0 }))
      .sort((a, b) => b.total - a.total);

    const recientes = ultimas.map((row) => ({
      fecha: formatearFecha(row.fecha, 'dd/MM/yyyy HH:mm'),
      tipo: String(row.tipo || ''),
      referencia: String(row.referencia || ''),
      asesor: String(row.asesor_nombre || row.asesor_email || ''),
      para: String(row.para || ''),
      asunto: String(row.asunto || ''),
      resultado: String(row.resultado || '')
    }));

    return { success: true, total, enviados, errores: total - enviados, porTipo, porDia, porAsesor, recientes };
  } catch (e) {
    console.error('getResumenMetricasCorreos error', e);
    return { success: false, message: 'No pudimos leer las métricas. Inténtalo de nuevo en un momento.' };
  }
}
