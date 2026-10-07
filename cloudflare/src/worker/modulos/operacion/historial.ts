/**
 * ESTADO DE OPERACIÓN · historial gráfico | Portal Ventel en Cloudflare
 * ====================================================================
 * Port de «HISTORIAL GRÁFICO POR FECHAS» de Operacion.gs: opHistorialPublico (por días) y
 * opHistorialHorasPublico (por horas). Las dos devuelven la MISMA forma para que el gráfico del
 * cliente (app_estado_historial.html) sea uno solo.
 *
 * Son PÚBLICAS, igual que el tablero: no viaja ni un correo ni una nota interna, solo cuántos
 * reportes hubo, de cuántas personas (el número, nunca la lista) y qué se confirmó.
 *
 * TRAMPA DE HUSOS (doc 01 §9): las claves viajan como texto 'AAAA-MM-DD' / 'AAAA-MM-DD HH' en hora
 * de México, formateadas con formatearFecha (el Worker está en UTC). El eje por horas arranca en la
 * hora en punto DE MÉXICO, calculada con partesMx/fechaDesdeMx y no con setMinutes().
 *
 * Sin caché (en Apps Script eran 10 min para días y 2 min para horas): D1 lo calcula en el acto.
 */
import type { Ctx } from '../../nucleo/contexto';
import { fechaDesdeMx, partesMx } from '../../nucleo/fechas';
import {
  OP_UMBRAL_PERSONAS, opLeerCatalogo, opIncidenteDeFila, opDiaClave, opHoraClave, opMs, opTitulo,
  type FilaIncidente
} from './comun';

const OP_HISTORIAL_MAX_DIAS = 30;
const OP_HISTORIAL_POR_OMISION = 14;
const OP_HISTORIAL_MAX_HORAS = 72;
const OP_HISTORIAL_HORAS_POR_OMISION = 24;

interface Tramo { fecha: string; inicio?: string; reportes: number; personas: number; confirmados: number; tono: string }

/** Tono de un tramo: el umbral es de PERSONAS distintas, el mismo que dispara la alerta automática. */
function opTonoDelDia(reportes: number, confirmados: number): string {
  if (confirmados > 0) return 'alert';
  if (reportes >= OP_UMBRAL_PERSONAS) return 'alert';
  if (reportes > 0) return 'warn';
  return 'ok';
}

/**
 * El cálculo común a las dos escalas: recibe el eje ya construido (claves en orden), la función que
 * da la clave de una fecha y el inicio de la ventana, y devuelve sistemas, totales y confirmados.
 */
async function opCalcularSerie(ctx: Ctx, eje: string[], inicios: string[] | null, claveDe: (v: unknown) => string, desdeMs: number) {
  const catalogo = await opLeerCatalogo(ctx);
  const posicion: Record<string, number> = {};
  eje.forEach((c, i) => { posicion[c] = i; });

  // Por horas cada tramo lleva además `inicio` (ISO), igual que en el .gs.
  const serieVacia = (): Tramo[] => eje.map((f, i) => (inicios
    ? { fecha: f, inicio: inicios[i], reportes: 0, personas: 0, confirmados: 0, tono: 'ok' }
    : { fecha: f, reportes: 0, personas: 0, confirmados: 0, tono: 'ok' }));

  const porSistema: Record<string, any> = {};
  catalogo.sistemas.forEach((s) => {
    porSistema[s.clave] = {
      clave: s.clave, nombre: s.nombre, destacado: !!s.publico,
      dias: serieVacia(), total: 0, diasMalos: 0,
      // Las personas se cuentan con un conjunto aparte que se tira al final: viaja el número.
      _personas: eje.map(() => ({} as Record<string, boolean>))
    };
  });
  const totales = serieVacia();
  const personasTotales = eje.map(() => ({} as Record<string, boolean>));

  // ── Reportes ── (el SQL acota por fecha; la pertenencia exacta al tramo la decide la clave)
  const desdeIso = new Date(desdeMs).toISOString();
  const reportes = await ctx.todas<{ fecha: string; sistema_clave: string; correo: string }>(
    'SELECT fecha, sistema_clave, correo FROM operacion_reportes WHERE fecha >= ?', desdeIso);
  reportes.forEach((f) => {
    const ms = opMs(f.fecha);
    if (!ms || ms < desdeMs) return;
    const i = posicion[claveDe(f.fecha)];
    if (i === undefined) return;
    const sis = String(f.sistema_clave || '');
    const correo = String(f.correo || '').toLowerCase();
    if (porSistema[sis]) {
      porSistema[sis].dias[i].reportes++;
      porSistema[sis].total++;
      if (correo) porSistema[sis]._personas[i][correo] = true;
    }
    totales[i].reportes++;
    if (correo) personasTotales[i][correo] = true;
  });

  // ── Incidentes confirmados ── por la fecha de CONFIRMACIÓN, y también los ya cerrados: una falla
  // confirmada no desaparece del historial cuando se resuelve.
  const confirmados: Record<string, any[]> = {};
  const incidentes = await ctx.todas<FilaIncidente>(
    "SELECT * FROM operacion_incidentes WHERE COALESCE(confirmado, '') <> '' AND confirmado >= ? ORDER BY rowid", desdeIso);
  incidentes.forEach((f) => {
    const inc = opIncidenteDeFila(f, catalogo);
    if (!inc.id || !inc.confirmado) return;
    const clave = claveDe(inc.confirmado);
    const i = posicion[clave];
    if (i === undefined) return;
    if (porSistema[inc.sistemaClave]) porSistema[inc.sistemaClave].dias[i].confirmados++;
    totales[i].confirmados++;
    if (!confirmados[clave]) confirmados[clave] = [];
    confirmados[clave].push({
      id: inc.id,
      sistema: inc.sistema,
      sistemaClave: inc.sistemaClave,
      titulo: inc.titulo || opTitulo(inc.sistema, inc.submotivo),
      estado: inc.estado,
      estadoNombre: inc.estadoNombre,
      confirmado: inc.confirmado,
      cerrado: inc.cerrado,
      // «Esto sigue pasando» frente a «esto pasó y se arregló».
      vigente: !inc.cierra
    });
  });

  // ── Cierre: tonos y limpieza ──
  const sistemas = catalogo.sistemas.map((s) => {
    const x = porSistema[s.clave];
    x.dias.forEach((d: Tramo, i: number) => {
      d.personas = Object.keys(x._personas[i]).length;
      d.tono = opTonoDelDia(d.personas, d.confirmados);
      if (d.tono !== 'ok') x.diasMalos++;
    });
    delete x._personas;
    return x;
  });
  totales.forEach((d, i) => {
    d.personas = Object.keys(personasTotales[i]).length;
    d.tono = opTonoDelDia(d.personas, d.confirmados);
  });
  const conAlgo = totales.filter((d) => d.tono !== 'ok').length;
  return { sistemas, totales, confirmados, conAlgo };
}

/**
 * Serie por fecha, por sistema y en total. PÚBLICA.
 * @param dias Cuántos días hacia atrás (1–30). Por omisión 14.
 */
export async function opHistorialPublico(ctx: Ctx, dias?: unknown) {
  try {
    const n = Math.max(1, Math.min(OP_HISTORIAL_MAX_DIAS, Number(dias) || OP_HISTORIAL_POR_OMISION));
    // El eje se construye ANTES de mirar los datos: un día sin reportes es un día bueno y tiene
    // que verse, no desaparecer.
    const hoy = Date.now();
    const eje: string[] = [];
    for (let d = n - 1; d >= 0; d--) eje.push(opDiaClave(hoy - d * 86400000));
    const desdeMs = (hoy - (n - 1) * 86400000) - 86400000;

    const r = await opCalcularSerie(ctx, eje, null, opDiaClave, desdeMs);
    return {
      success: true,
      consultado: new Date().toISOString(),
      modo: 'dias',
      dias: n,
      tramos: n,
      desde: eje[0],
      hasta: eje[eje.length - 1],
      eje,
      umbral: OP_UMBRAL_PERSONAS,
      sistemas: r.sistemas,
      totales: r.totales,
      confirmados: r.confirmados,
      resumen: {
        limpios: n - r.conAlgo,
        conIncidencias: r.conAlgo,
        diasLimpios: n - r.conAlgo,
        diasConIncidencias: r.conAlgo,
        reportes: r.totales.reduce((a, d) => a + d.reportes, 0),
        confirmados: r.totales.reduce((a, d) => a + d.confirmados, 0)
      }
    };
  } catch (e) {
    console.error('opHistorialPublico', e);
    return { success: false, message: 'No pudimos consultar el historial en este momento.' };
  }
}

/**
 * Serie por HORA, por sistema y en total. PÚBLICA. La misma forma que la de días.
 * @param horas Cuántas horas hacia atrás (1–72). Por omisión 24.
 */
export async function opHistorialHorasPublico(ctx: Ctx, horas?: unknown) {
  try {
    const n = Math.max(1, Math.min(OP_HISTORIAL_MAX_HORAS, Number(horas) || OP_HISTORIAL_HORAS_POR_OMISION));
    // La hora EN CURSO en punto, en hora de México (en Apps Script, setMinutes(0,0,0) en la zona
    // del proyecto). Las horas sin reportes ocupan su hueco: el eje no sale de los datos.
    const p = partesMx(new Date());
    const enPunto = fechaDesdeMx(p.anio, p.mes, p.dia, p.hora).getTime();
    const eje: string[] = [];
    const inicios: string[] = [];
    for (let h = n - 1; h >= 0; h--) {
      const inicio = enPunto - h * 3600000;
      eje.push(opHoraClave(inicio));
      inicios.push(new Date(inicio).toISOString());
    }
    const desdeMs = enPunto - (n - 1) * 3600000;

    const r = await opCalcularSerie(ctx, eje, inicios, opHoraClave, desdeMs);
    return {
      success: true,
      consultado: new Date().toISOString(),
      modo: 'horas',
      horas: n,
      tramos: n,
      desde: eje[0],
      hasta: eje[eje.length - 1],
      desdeISO: inicios[0],
      hastaISO: inicios[inicios.length - 1],
      eje,
      umbral: OP_UMBRAL_PERSONAS,
      sistemas: r.sistemas,
      totales: r.totales,
      confirmados: r.confirmados,
      resumen: {
        limpios: n - r.conAlgo,
        conIncidencias: r.conAlgo,
        reportes: r.totales.reduce((a, d) => a + d.reportes, 0),
        confirmados: r.totales.reduce((a, d) => a + d.confirmados, 0)
      }
    };
  } catch (e) {
    console.error('opHistorialHorasPublico', e);
    return { success: false, message: 'No pudimos consultar el historial por horas en este momento.' };
  }
}
