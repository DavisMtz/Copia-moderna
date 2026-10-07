/**
 * ESTADO DE OPERACIÓN · recomendaciones (Fase 5 · T5.2) | Portal Ventel en Cloudflare
 * ==================================================================================
 * Port de «RECOMENDACIONES» de Operacion.gs. Las dos reglas que no se negocian siguen aquí:
 *   1. Toda recomendación cita su cifra.
 *   2. Las cifras son las mismas que las del gráfico (se cuentan también los reportes que
 *      supervisión acabó descartando), salvo la de sueltos, que mira la misma lista del panel.
 *
 * Una sola pasada por los reportes de la semana y otra por las incidencias; de ahí salen las cuatro
 * (franja horaria, sistema problemático, submotivo reincidente y sueltos agrupables). Aquí NO se
 * caducan sospechas (eso escribe; lo hace opPanel en la misma pantalla): se filtran las que están a
 * punto de apagarse con la misma condición que opCaducarPosibles.
 *
 * Sin caché de 5 min: D1 lo recalcula en el acto y así nunca se recomienda agrupar algo que ya se
 * agrupó.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIdentidadConBloque } from '../../nucleo/seguridad';
import { formatearFecha } from '../../nucleo/fechas';
import { opCapitalizar, opClave, opMismoMotivo, opSugerirExistente } from './texto';
import {
  OP_BLOQUE, OP_HORAS_CADUCA_POSIBLE, OP_UMBRAL_PERSONAS, opHoraClave, opIncidenteDeFila, opLeerCatalogo,
  opMs, opTitulo, type FilaIncidente, type Incidente
} from './comun';

const OP_RECO_DIAS = 7;
const OP_RECO_PERIODO = 'los últimos 7 días';
const OP_RECO_MAX = 6;

/** FRANJA HORARIA: dos horas, seis reportes, tres días distintos y un tercio de lo del sistema. */
const OP_RECO_FRANJA_HORAS = 2;
const OP_RECO_MIN_REPORTES_FRANJA = 6;
const OP_RECO_MIN_DIAS = 3;
const OP_RECO_CONCENTRACION_FRANJA = 0.35;

/** SISTEMA PROBLEMÁTICO: más de un reporte al día de media y la mitad más que el segundo. */
const OP_RECO_MIN_REPORTES_SISTEMA = 8;
const OP_RECO_VENTAJA_SISTEMA = 1.5;

/** SUBMOTIVO REINCIDENTE: cinco reportes y DOS episodios (que volvió, no que duró). */
const OP_RECO_MIN_REPORTES_MOTIVO = 5;
const OP_RECO_MIN_EPISODIOS = 2;

/** SUELTOS AGRUPABLES: dos sueltos de dos personas parecidos a la misma incidencia abierta. */
const OP_RECO_MIN_SUELTOS = 2;
const OP_RECO_MIN_PERSONAS_SUELTOS = 2;

const OP_RECO_TOPE_FRANJA = 2;
const OP_RECO_TOPE_MOTIVO = 2;
const OP_RECO_TOPE_SUELTOS = 3;

interface TramoReco { reportes: number; personas: Record<string, boolean>; dias: Record<string, boolean> }
interface SistemaReco extends TramoReco { nombre: string; horas: TramoReco[] }
interface GrupoMotivo extends TramoReco { texto: string; clave: string }
interface Reco {
  clave: string; titulo: string; evidencia: string; detalle?: string; urgencia: string;
  accion: { texto: string; tipo: string; item: string; inc: string } | null; _peso: number;
}

/** «3 reportes» / «1 reporte», sin el «(s)» que delata que lo escribió una máquina. */
function opRecoPlural(n: number, singular: string, plural: string): string {
  return n + ' ' + (n === 1 ? singular : plural);
}

/** Cuántas VECES volvió: rachas de días consecutivos dentro de los días con reportes. */
function opRecoEpisodios(dias: Record<string, boolean>): number {
  const lista = Object.keys(dias || {}).sort();
  let episodios = 0;
  let previo: number | null = null;
  lista.forEach((d) => {
    const ms = Date.parse(d + 'T00:00:00Z');
    if (isNaN(ms)) return;
    // Día y medio de holgura: separa «el día siguiente» de «dos días después».
    if (previo === null || (ms - previo) > 86400000 * 1.5) episodios++;
    previo = ms;
  });
  return episodios;
}

const opRecoTramoVacio = (): TramoReco => ({ reportes: 0, personas: {}, dias: {} });

function opRecoSumar(tramo: TramoReco, correo: string, dia: string): void {
  tramo.reportes++;
  if (correo) tramo.personas[correo] = true;
  if (dia) tramo.dias[dia] = true;
}

const opRecoCuantos = (obj: Record<string, unknown>): number => Object.keys(obj || {}).length;

/**
 * Mete una queja en su grupo: clave exacta, luego el mismo juez que el formulario
 * (opSugerirExistente) y por último el criterio canónico del umbral (opMismoMotivo).
 */
function opRecoAgrupar(lista: GrupoMotivo[], texto: string): GrupoMotivo {
  const clave = opClave(texto);
  let grupo = lista.filter((g) => g.clave === clave)[0];
  if (!grupo) {
    const sugerido = opSugerirExistente(texto, lista.map((g) => g.texto));
    if (sugerido) grupo = lista.filter((g) => g.texto === sugerido.valor)[0];
  }
  if (!grupo) grupo = lista.filter((g) => opMismoMotivo(texto, g.texto))[0];
  if (!grupo) {
    grupo = { ...opRecoTramoVacio(), texto, clave };
    lista.push(grupo);
  }
  return grupo;
}

const ORDEN_TONO: Record<string, number> = { alert: 3, warn: 2, info: 1, ok: 0, neutro: 0 };

/** ¿Hay algo abierto de este sistema que esté molestando ahora mismo? La más grave manda. */
function opRecoIncidenciaViva(vivasPorSistema: Record<string, Incidente[]>, sisClave: string): Incidente | null {
  const lista = (vivasPorSistema[sisClave] || []).filter((i) => i.afecta);
  if (!lista.length) return null;
  lista.sort((a, b) => (ORDEN_TONO[b.tono] || 0) - (ORDEN_TONO[a.tono] || 0));
  return lista[0];
}

/** Acción «abrir esa incidencia». `item` va vacío: aquí no se señala ningún reporte suelto. */
function opRecoAccionVer(inc: Incidente | null) {
  if (!inc) return null;
  return { texto: 'Ver «' + (inc.titulo || opTitulo(inc.sistema, inc.submotivo)) + '»', tipo: 'ver', item: '', inc: inc.id };
}

/** «las 09:14», en hora de México. */
function opRecoCuando(iso: string): string {
  const ms = opMs(iso);
  if (!ms) return 'hace un rato';
  return 'las ' + formatearFecha(ms, 'HH:mm');
}

/** 1 · FRANJA HORARIA · «esto pasa siempre a la misma hora». */
function opRecoFranjas(sistemas: Record<string, SistemaReco>, vivasPorSistema: Record<string, Incidente[]>): Reco[] {
  const salida: Reco[] = [];
  Object.keys(sistemas).forEach((sisClave) => {
    const S = sistemas[sisClave];
    if (S.reportes < OP_RECO_MIN_REPORTES_FRANJA) return;

    let mejor: { desde: number; hasta: number; reportes: number; personas: Record<string, boolean>; dias: Record<string, boolean> } | null = null;
    for (let h = 0; h + OP_RECO_FRANJA_HORAS <= 24; h++) {
      let reportes = 0;
      const personas: Record<string, boolean> = {};
      const dias: Record<string, boolean> = {};
      for (let k = 0; k < OP_RECO_FRANJA_HORAS; k++) {
        const tramo = S.horas[h + k];
        reportes += tramo.reportes;
        Object.keys(tramo.personas).forEach((c) => { personas[c] = true; });
        Object.keys(tramo.dias).forEach((d) => { dias[d] = true; });
      }
      if (!mejor || reportes > mejor.reportes) {
        mejor = { desde: h, hasta: h + OP_RECO_FRANJA_HORAS, reportes, personas, dias };
      }
    }
    if (!mejor) return;

    const nPersonas = opRecoCuantos(mejor.personas);
    const nDias = opRecoCuantos(mejor.dias);
    const parte = mejor.reportes / S.reportes;
    if (mejor.reportes < OP_RECO_MIN_REPORTES_FRANJA) return;
    if (nDias < OP_RECO_MIN_DIAS) return;
    if (nPersonas < OP_UMBRAL_PERSONAS) return;
    if (parte < OP_RECO_CONCENTRACION_FRANJA) return;

    const viva = opRecoIncidenciaViva(vivasPorSistema, sisClave);
    salida.push({
      clave: 'franja-horaria',
      titulo: S.nombre + ' falla sobre todo de ' + mejor.desde + ' a ' + mejor.hasta + ' h',
      evidencia: opRecoPlural(mejor.reportes, 'reporte', 'reportes') + ' de ' + S.nombre +
                 ' entre las ' + mejor.desde + ' y las ' + mejor.hasta + ' h en ' + OP_RECO_PERIODO,
      detalle: 'Se repitió en ' + opRecoPlural(nDias, 'día distinto', 'días distintos') +
               ', lo reportaron ' + opRecoPlural(nPersonas, 'persona', 'personas') +
               ' y es el ' + Math.round(parte * 100) + ' % de todo lo que se reporta de ' + S.nombre + '.',
      urgencia: viva ? 'alta' : 'media',
      accion: opRecoAccionVer(viva),
      _peso: mejor.reportes
    });
  });
  salida.sort((a, b) => b._peso - a._peso);
  return salida.slice(0, OP_RECO_TOPE_FRANJA);
}

/** 2 · SISTEMA PROBLEMÁTICO · solo la del líder, y solo si le saca de verdad al segundo. */
function opRecoSistema(sistemas: Record<string, SistemaReco>, confirmadasPorSistema: Record<string, number>,
                       vivasPorSistema: Record<string, Incidente[]>): Reco[] {
  const orden = Object.keys(sistemas).map((clave) => {
    const S = sistemas[clave];
    return { clave, nombre: S.nombre, reportes: S.reportes, personas: opRecoCuantos(S.personas), dias: opRecoCuantos(S.dias) };
  }).sort((a, b) => b.reportes - a.reportes);

  if (!orden.length) return [];
  const lider = orden[0];
  const segundo = orden[1] || { reportes: 0, nombre: '' };
  if (lider.reportes < OP_RECO_MIN_REPORTES_SISTEMA) return [];
  if (lider.personas < OP_UMBRAL_PERSONAS) return [];
  if (lider.dias < OP_RECO_MIN_DIAS) return [];
  if (segundo.reportes > 0 && lider.reportes < segundo.reportes * OP_RECO_VENTAJA_SISTEMA) return [];

  const confirmadas = confirmadasPorSistema[lider.clave] || 0;
  const viva = opRecoIncidenciaViva(vivasPorSistema, lider.clave);
  const comparacion = segundo.reportes > 0
    ? ', frente a ' + opRecoPlural(segundo.reportes, 'reporte', 'reportes') + ' de ' + segundo.nombre
    : ', y es el único sistema con reportes';
  const detalle = 'Lo reportaron ' + opRecoPlural(lider.personas, 'persona', 'personas') +
                  ' en ' + opRecoPlural(lider.dias, 'día distinto', 'días distintos') +
                  (confirmadas
                    ? '; ' + opRecoPlural(confirmadas, 'incidencia se confirmó', 'incidencias se confirmaron') + ' en ese plazo.'
                    : '; ninguna incidencia se confirmó en ese plazo.');
  return [{
    clave: 'sistema-problematico',
    titulo: lider.nombre + ' es el sistema que más se reporta',
    evidencia: opRecoPlural(lider.reportes, 'reporte', 'reportes') + ' de ' + lider.nombre +
               ' en ' + OP_RECO_PERIODO + comparacion,
    detalle,
    urgencia: (viva || confirmadas >= 2) ? 'alta' : 'media',
    accion: opRecoAccionVer(viva),
    _peso: lider.reportes
  }];
}

/** 3 · SUBMOTIVO REINCIDENTE · «este fallo concreto ya volvió». */
function opRecoMotivos(motivos: Record<string, GrupoMotivo[]>, sistemas: Record<string, SistemaReco>,
                       usosCatalogo: Record<string, Record<string, { valor: string; usos: number }>>,
                       vivasPorSistema: Record<string, Incidente[]>): Reco[] {
  const salida: Reco[] = [];
  Object.keys(motivos).forEach((sisClave) => {
    const S = sistemas[sisClave];
    if (!S) return;
    motivos[sisClave].forEach((g) => {
      const nPersonas = opRecoCuantos(g.personas);
      const nDias = opRecoCuantos(g.dias);
      const episodios = opRecoEpisodios(g.dias);
      if (g.reportes < OP_RECO_MIN_REPORTES_MOTIVO) return;
      if (nDias < OP_RECO_MIN_DIAS) return;
      if (nPersonas < OP_UMBRAL_PERSONAS) return;
      if (episodios < OP_RECO_MIN_EPISODIOS) return;

      // Con la redacción del catálogo, que es la que el equipo ve al reportar.
      const enCatalogo = (usosCatalogo[sisClave] || {})[g.clave];
      const nombreMotivo = enCatalogo ? enCatalogo.valor : opCapitalizar(g.texto);
      const usos = enCatalogo ? enCatalogo.usos : 0;
      const viva = (vivasPorSistema[sisClave] || []).filter((i) =>
        opClave(i.submotivo) === g.clave || opMismoMotivo(g.texto, i.submotivo))[0] || null;

      salida.push({
        clave: 'submotivo-reincidente',
        titulo: 'El mismo fallo de ' + S.nombre + ' vuelve: «' + nombreMotivo + '»',
        evidencia: opRecoPlural(g.reportes, 'reporte', 'reportes') + ' de «' + nombreMotivo +
                   '» en ' + S.nombre + ' durante ' + OP_RECO_PERIODO + ', repartidos en ' +
                   opRecoPlural(nDias, 'día', 'días') + ' y en ' +
                   opRecoPlural(episodios, 'ocasión separada', 'ocasiones separadas'),
        detalle: 'Lo reportaron ' + opRecoPlural(nPersonas, 'persona', 'personas') + '.' +
                 (usos ? ' Desde que existe la lista de motivos se ha elegido ' + opRecoPlural(usos, 'vez', 'veces') + '.' : ''),
        urgencia: episodios >= 3 ? 'alta' : 'media',
        accion: opRecoAccionVer(viva),
        _peso: g.reportes
      });
    });
  });
  salida.sort((a, b) => b._peso - a._peso);
  return salida.slice(0, OP_RECO_TOPE_MOTIVO);
}

/** 4 · SUELTOS AGRUPABLES · la única con acción: `item` es el suelto e `inc` la incidencia. */
function opRecoSueltos(sueltos: Array<{ id: string; ms: number; correo: string; sistemaClave: string; sistema: string; submotivo: string }>,
                       vivas: Incidente[]): Reco[] {
  if (!sueltos.length || !vivas.length) return [];
  const porIncidencia: Record<string, { inc: Incidente; reportes: typeof sueltos; personas: Record<string, boolean> }> = {};
  sueltos.forEach((s) => {
    const candidatas = vivas.filter((i) => i.sistemaClave === s.sistemaClave);
    if (!candidatas.length) return;
    // La misma escalera que opIncidenteParaReporte: clave exacta, motivo parecido, y por último
    // una de servicio o ya confirmada, que se lleva cualquier reporte de su sistema.
    let inc = candidatas.filter((i) => opClave(i.submotivo) && opClave(i.submotivo) === opClave(s.submotivo))[0];
    if (!inc) inc = candidatas.filter((i) => i.submotivo && opMismoMotivo(s.submotivo, i.submotivo))[0];
    if (!inc) {
      inc = candidatas.filter((i) => !opClave(i.submotivo) || i.estado === 'confirmado' || i.estado === 'mantenimiento')[0];
    }
    if (!inc) return;
    if (!porIncidencia[inc.id]) porIncidencia[inc.id] = { inc, reportes: [], personas: {} };
    porIncidencia[inc.id].reportes.push(s);
    if (s.correo) porIncidencia[inc.id].personas[s.correo] = true;
  });

  const salida: Reco[] = [];
  Object.keys(porIncidencia).forEach((id) => {
    const grupo = porIncidencia[id];
    const nPersonas = opRecoCuantos(grupo.personas);
    if (grupo.reportes.length < OP_RECO_MIN_SUELTOS) return;
    if (nPersonas < OP_RECO_MIN_PERSONAS_SUELTOS) return;
    // El más reciente: es el que encabeza la lista de sueltos del panel.
    grupo.reportes.sort((a, b) => b.ms - a.ms);
    const cabeza = grupo.reportes[0];
    const inc = grupo.inc;
    const titulo = inc.titulo || opTitulo(inc.sistema, inc.submotivo);
    const desde = inc.confirmado || inc.creado;
    salida.push({
      clave: 'sueltos-agrupables',
      titulo: opRecoPlural(grupo.reportes.length, 'reporte suelto es', 'reportes sueltos son') +
              ' la misma falla que «' + titulo + '»',
      evidencia: opRecoPlural(grupo.reportes.length, 'reporte', 'reportes') + ' de ' + cabeza.sistema +
                 ' sin agrupar en las últimas 24 h coinciden con «' + titulo + '», abierta desde ' + opRecoCuando(desde),
      detalle: 'Los enviaron ' + opRecoPlural(nPersonas, 'persona distinta', 'personas distintas') +
               '. Agruparlos deja esa incidencia con el peso real que tiene.',
      urgencia: inc.estado === 'confirmado' ? 'alta' : 'media',
      accion: { texto: 'Agrupar en «' + titulo + '»', tipo: 'elevar', item: cabeza.id, inc: inc.id },
      _peso: grupo.reportes.length
    });
  });
  salida.sort((a, b) => b._peso - a._peso);
  return salida.slice(0, OP_RECO_TOPE_SUELTOS);
}

async function opCalcularRecomendaciones(ctx: Ctx) {
  const catalogo = await opLeerCatalogo(ctx);
  const ahora = Date.now();
  const desdeMs = ahora - OP_RECO_DIAS * 86400000;
  // La MISMA ventana que el panel usa para su lista de sueltos.
  const desdeSueltosMs = ahora - 24 * 3600 * 1000;

  const nombreSistema: Record<string, string> = {};
  const usosCatalogo: Record<string, Record<string, { valor: string; usos: number }>> = {};
  catalogo.sistemas.forEach((s) => {
    nombreSistema[s.clave] = s.nombre;
    usosCatalogo[s.clave] = {};
    (catalogo.submotivos[s.clave] || []).forEach((m) => {
      usosCatalogo[s.clave][m.clave] = { valor: m.valor, usos: Number(m.usos) || 0 };
    });
  });

  // ── PASADA ÚNICA POR LOS REPORTES ──
  const sistemas: Record<string, SistemaReco> = {};
  const motivos: Record<string, GrupoMotivo[]> = {};
  const sueltos: Array<{ id: string; ms: number; correo: string; sistemaClave: string; sistema: string; submotivo: string }> = [];

  const reportes = await ctx.todas<{ id: string; fecha: string; correo: string; sistema: string; sistema_clave: string;
                                     submotivo: string; incidente_id: string; estado: string }>(
    'SELECT id, fecha, correo, sistema, sistema_clave, submotivo, incidente_id, estado FROM operacion_reportes ' +
    'WHERE fecha >= ? ORDER BY rowid', new Date(desdeMs).toISOString());
  reportes.forEach((f) => {
    const ms = opMs(f.fecha);
    if (!ms || ms < desdeMs) return;
    const sisClave = String(f.sistema_clave || '');
    if (!sisClave) return;
    const correo = String(f.correo || '').toLowerCase();

    // Día y hora salen de la MISMA clave que el gráfico por horas, en hora de México.
    const hk = opHoraClave(f.fecha);
    const dia = hk.slice(0, 10);
    const hora = parseInt(hk.slice(11, 13), 10);
    if (!dia || isNaN(hora)) return;

    if (!sistemas[sisClave]) {
      const horas: TramoReco[] = [];
      for (let h = 0; h < 24; h++) horas.push(opRecoTramoVacio());
      sistemas[sisClave] = { ...opRecoTramoVacio(), nombre: nombreSistema[sisClave] || String(f.sistema || '') || sisClave, horas };
    }
    const S = sistemas[sisClave];
    opRecoSumar(S, correo, dia);
    opRecoSumar(S.horas[hora], correo, dia);

    const texto = String(f.submotivo || '').trim();
    if (texto) {
      if (!motivos[sisClave]) motivos[sisClave] = [];
      opRecoSumar(opRecoAgrupar(motivos[sisClave], texto), correo, dia);
    }

    if (!String(f.incidente_id || '') && ms > desdeSueltosMs && String(f.estado || '') !== 'descartado') {
      sueltos.push({ id: String(f.id || ''), ms, correo, sistemaClave: sisClave, sistema: S.nombre, submotivo: texto });
    }
  });

  // ── PASADA ÚNICA POR LAS INCIDENCIAS ── (las confirmadas de la semana y las que siguen abiertas)
  const cierran = JSON.stringify(catalogo.estados.filter((e) => e.cierra).map((e) => e.clave));
  const incidentes = (await ctx.todas<FilaIncidente>(
    "SELECT * FROM operacion_incidentes WHERE (COALESCE(confirmado, '') <> '' AND confirmado >= ?) " +
    "OR lower(trim(COALESCE(estado, ''))) NOT IN (SELECT value FROM json_each(?)) ORDER BY rowid",
    new Date(desdeMs).toISOString(), cierran))
    .map((f) => opIncidenteDeFila(f, catalogo))
    .filter((i) => i.id);

  const confirmadasPorSistema: Record<string, number> = {};
  incidentes.forEach((i) => {
    if (!i.confirmado || opMs(i.confirmado) < desdeMs) return;
    confirmadasPorSistema[i.sistemaClave] = (confirmadasPorSistema[i.sistemaClave] || 0) + 1;
  });

  // Las vivas MENOS las sospechas a punto de apagarse solas (copia de la condición de caducidad).
  const limiteCaduca = ahora - OP_HORAS_CADUCA_POSIBLE * 3600 * 1000;
  const vivas = incidentes.filter((i) => {
    if (i.cierra) return false;
    if (i.estado === 'posible' && !i.confirmado) {
      const ultima = Math.max(opMs(i.actualizado), opMs(i.creado));
      if (ultima && ultima < limiteCaduca) return false;
    }
    return true;
  });
  const vivasPorSistema: Record<string, Incidente[]> = {};
  vivas.forEach((i) => { (vivasPorSistema[i.sistemaClave] = vivasPorSistema[i.sistemaClave] || []).push(i); });

  const recomendaciones = ([] as Reco[])
    .concat(opRecoFranjas(sistemas, vivasPorSistema))
    .concat(opRecoSistema(sistemas, confirmadasPorSistema, vivasPorSistema))
    .concat(opRecoMotivos(motivos, sistemas, usosCatalogo, vivasPorSistema))
    .concat(opRecoSueltos(sueltos, vivas));

  // Primero lo que se puede pulsar, luego lo urgente, luego lo grande.
  const rango: Record<string, number> = { alta: 3, media: 2, baja: 1 };
  recomendaciones.sort((a, b) => {
    const accA = a.accion ? 1 : 0;
    const accB = b.accion ? 1 : 0;
    if (accA !== accB) return accB - accA;
    const uA = rango[a.urgencia] || 0;
    const uB = rango[b.urgencia] || 0;
    if (uA !== uB) return uB - uA;
    return (b._peso || 0) - (a._peso || 0);
  });

  return {
    success: true,
    generado: new Date().toISOString(),
    periodo: OP_RECO_PERIODO,
    recomendaciones: recomendaciones.slice(0, OP_RECO_MAX).map((r) => ({
      clave: r.clave, titulo: r.titulo, evidencia: r.evidencia,
      detalle: r.detalle || '', urgencia: r.urgencia, accion: r.accion || null
    }))
  };
}

/**
 * Recomendaciones para el panel de supervisión (bloque 'operacion').
 * Contrato: { success:true, generado:ISO, periodo, recomendaciones:[{clave, titulo, evidencia,
 * detalle, urgencia, accion}] }. Sin nada que recomendar, lista vacía y success:true.
 */
export async function opRecomendaciones(ctx: Ctx, email?: string) {
  try {
    const gate = await secIdentidadConBloque(ctx, email, OP_BLOQUE);
    if (!gate.ok) return { success: false, message: gate.error };
    return await opCalcularRecomendaciones(ctx);
  } catch (e) {
    console.error('opRecomendaciones', e);
    return { success: false, message: 'No pudimos calcular las recomendaciones en este momento.' };
  }
}
