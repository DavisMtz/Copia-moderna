/**
 * POLÍTICA DE REVISIÓN | Portal Ventel en Cloudflare
 * =================================================
 * Port de PoliticaRevision.gs. Decide, en el momento en que se guarda una cotización, si tiene que
 * pasar por la cola de revisión o si puede salir al cliente directamente.
 *
 * CÓMO DECIDE — tres escalones, en este orden:
 *   1. Interruptor maestro (`exigirRevision`). Si está apagado, NADA pasa por revisión.
 *   2. Lista ordenada de criterios. Gana el PRIMERO que coincide: el orden es la prioridad.
 *   3. Si ninguno coincide, manda `accionPorDefecto`.
 *
 * PRINCIPIO: el simulador de la pantalla NO reimplementa esta lógica; llama a simularPoliticaRevision,
 * que ejecuta exactamente el mismo revpolEvaluar que decide de verdad.
 *
 * DÓNDE VIVE: igual que en Apps Script, un solo documento JSON en las propiedades del script (tabla
 * `propiedades`, clave revision_politica_v1). Se guarda ENTERA a propósito: el orden de los criterios
 * es parte del significado, y guardar por partes dejaría ventanas con una mezcla que nadie escribió.
 * Sin fila guardada rige la política de arranque (revisar todo).
 *
 * El modo seguro ante CUALQUIER fallo es revisar de más, jamás enviar de más.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIdentidadConBloque } from '../../nucleo/seguridad';
import { leerPropiedad, fijarPropiedad } from '../../nucleo/sistema';
import { aFecha, formatearFecha, partesMx, ZONA_MX } from '../../nucleo/fechas';
import { REV_ESTATUS_APROBADA, REV_POR_AUTOMATICA, REV_NOMBRE_AUTOMATICA } from './constantes';
import { QUOTE_FORMATS, formatCurrencyGS } from './datos';

export const REVPOL_PROP_KEY = 'revision_politica_v1';

/** Tope de criterios: una lista que nadie puede leer de un vistazo deja de ser una política. */
const REVPOL_MAX_REGLAS = 20;

/** Cuántos cambios de política se recuerdan: el rastro de quién relajó qué y cuándo. */
const REVPOL_MAX_HISTORIAL = 25;

/** Catálogo de criterios configurables. El panel avanzado lo pinta tal cual. */
export const REVPOL_TIPOS = [
  { id: 'monto', nombre: 'Monto de la cotización', descripcion: 'Compara el total con IVA contra una cantidad.',
    campos: ['operador', 'valor', 'valor2'], unidad: 'moneda' },
  { id: 'descuento', nombre: 'Descuento aplicado',
    descripcion: 'Toma el descuento más alto de todas las líneas y lo compara con un porcentaje.',
    campos: ['operador', 'valor', 'valor2'], unidad: 'porcentaje' },
  { id: 'articulos', nombre: 'Número de artículos', descripcion: 'Cuántas líneas distintas trae la cotización.',
    campos: ['operador', 'valor', 'valor2'], unidad: 'entero' },
  { id: 'formato', nombre: 'Formato de la cotización', descripcion: 'Aplica solo a los formatos que elijas.',
    campos: ['formatos'], unidad: '' },
  { id: 'asesor', nombre: 'Asesor que cotiza', descripcion: 'Aplica solo a los correos que enlistes.',
    campos: ['correos'], unidad: '' },
  { id: 'horario', nombre: 'Día y hora',
    descripcion: 'Aplica dentro (o fuera) de una franja horaria y unos días concretos.',
    campos: ['dias', 'desde', 'hasta', 'dentro'], unidad: '' }
];

export const REVPOL_OPERADORES = [
  { id: 'mayor-igual', nombre: 'es mayor o igual a' },
  { id: 'menor', nombre: 'es menor que' },
  { id: 'entre', nombre: 'está entre' }
];

export const REVPOL_DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export interface Regla {
  id: string; tipo: string; activa: boolean; accion: 'auto' | 'revisar'; nota: string;
  operador?: string; valor?: number; valor2?: number;
  formatos?: string[]; correos?: string[];
  dias?: number[]; desde?: string; hasta?: string; dentro?: boolean;
}

export interface Politica {
  version: number;
  exigirRevision: boolean;
  accionPorDefecto: 'auto' | 'revisar';
  reglas: Regla[];
  actualizadaPor: string;
  actualizadaEn: string;
  historial: any[];
}

export interface ContextoPolitica {
  total: number; descuentoMax: number; articulos: number; formato: string; asesorCorreo: string; fecha: Date;
}

export interface Decision { revisar: boolean; motivo: string; origen: string; reglaId: string }

/** Política de arranque: exactamente el comportamiento de antes de existir este módulo (revisar todo). */
export function revpolPorDefecto(): Politica {
  return {
    version: 1,
    exigirRevision: true,
    accionPorDefecto: 'revisar',
    reglas: [],
    actualizadaPor: '',
    actualizadaEn: '',
    historial: []
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// LECTURA Y NORMALIZACIÓN
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Lee la política guardada. NUNCA lanza: ante cualquier problema, la de arranque (revisa todo). */
export async function revpolLeer(ctx: Ctx): Promise<Politica> {
  try {
    const raw = await leerPropiedad(ctx, REVPOL_PROP_KEY);
    if (!raw) return revpolPorDefecto();
    return revpolNormalizar(JSON.parse(raw));
  } catch (e: any) {
    console.error('revpolLeer: no se pudo leer la política (' + (e && e.message) + '). Se revisa todo.');
    return revpolPorDefecto();
  }
}

/**
 * Deja la política en una forma conocida: rellena lo que falte, tira lo que no se reconozca y recorta
 * lo que se pase de rango. Se aplica al leer Y al guardar.
 */
export function revpolNormalizar(bruta: any): Politica {
  const p = (bruta && typeof bruta === 'object') ? bruta : {};

  const politica: Politica = {
    version: 1,
    // Solo un `false` explícito apaga la revisión. Un valor ausente o raro deja el modo seguro.
    exigirRevision: p.exigirRevision === false ? false : true,
    accionPorDefecto: (p.accionPorDefecto === 'auto') ? 'auto' : 'revisar',
    reglas: [],
    actualizadaPor: String(p.actualizadaPor || ''),
    actualizadaEn: String(p.actualizadaEn || ''),
    historial: Array.isArray(p.historial) ? p.historial.slice(0, REVPOL_MAX_HISTORIAL) : []
  };

  const crudas = Array.isArray(p.reglas) ? p.reglas.slice(0, REVPOL_MAX_REGLAS) : [];
  crudas.forEach((r: any, i: number) => {
    const limpia = revpolNormalizarRegla(r, i);
    if (limpia) politica.reglas.push(limpia);
  });

  return politica;
}

/** La regla saneada, o null si el tipo no existe (regla de una versión futura). */
function revpolNormalizarRegla(r: any, indice: number): Regla | null {
  if (!r || typeof r !== 'object') return null;
  const tipo = String(r.tipo || '');
  if (!REVPOL_TIPOS.some((t) => t.id === tipo)) return null;

  const regla: Regla = {
    id: String(r.id || ('r' + Date.now() + '-' + indice)).slice(0, 40),
    tipo,
    activa: r.activa === false ? false : true,
    accion: (r.accion === 'auto') ? 'auto' : 'revisar',
    nota: String(r.nota || '').slice(0, 200)
  };

  if (tipo === 'monto' || tipo === 'descuento' || tipo === 'articulos') {
    const op = String(r.operador || 'mayor-igual');
    regla.operador = REVPOL_OPERADORES.some((o) => o.id === op) ? op : 'mayor-igual';
    regla.valor = Math.max(0, parseFloat(r.valor) || 0);
    regla.valor2 = Math.max(0, parseFloat(r.valor2) || 0);
    // "Entre 500 y 100" no significa nada: se ordenan solos en vez de rechazar el guardado.
    if (regla.operador === 'entre' && regla.valor2 < regla.valor) {
      const t = regla.valor; regla.valor = regla.valor2; regla.valor2 = t;
    }
    if (tipo === 'articulos') {
      regla.valor = Math.round(regla.valor);
      regla.valor2 = Math.round(regla.valor2);
    }
    if (tipo === 'descuento') {
      regla.valor = Math.min(100, regla.valor);
      regla.valor2 = Math.min(100, regla.valor2);
    }
  }

  if (tipo === 'formato') {
    const catalogo = QUOTE_FORMATS.map((f) => f.id);
    regla.formatos = (Array.isArray(r.formatos) ? r.formatos : [])
      .map((f: unknown) => String(f))
      .filter((f: string) => catalogo.indexOf(f) > -1);
  }

  if (tipo === 'asesor') {
    regla.correos = (Array.isArray(r.correos) ? r.correos : [])
      .map((c: unknown) => String(c || '').trim().toLowerCase())
      .filter((c: string) => c.indexOf('@') > 0)
      .slice(0, 50);
  }

  if (tipo === 'horario') {
    regla.dias = (Array.isArray(r.dias) ? r.dias : [])
      .map((d: unknown) => parseInt(String(d), 10))
      .filter((d: number) => d >= 0 && d <= 6);
    if (!regla.dias!.length) regla.dias = [0, 1, 2, 3, 4, 5, 6];
    regla.desde = revpolHoraValida(r.desde, '09:00');
    regla.hasta = revpolHoraValida(r.hasta, '18:00');
    regla.dentro = r.dentro === false ? false : true;
  }

  return regla;
}

/** 'HH:MM' de 24 h, o el respaldo si no lo es. */
function revpolHoraValida(v: unknown, respaldo: string): string {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return respaldo;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return respaldo;
  return (h < 10 ? '0' + h : String(h)) + ':' + m[2];
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// MOTOR DE DECISIÓN
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Contexto evaluable a partir de los datos de una cotización. El descuento se calcula con la MISMA
 * fórmula que usan la pantalla de revisión y el documento del cliente.
 */
export function revpolContextoDeCotizacion(quoteData: any, cuando?: Date): ContextoPolitica {
  const q = quoteData || {};
  const productos = Array.isArray(q.products) ? q.products : [];

  let descuentoMax = 0;
  productos.forEach((p: any) => {
    const unitario = parseFloat(p.unitPrice) || 0;
    const cantidad = parseInt(p.quantity, 10) || 0;
    const volumen = unitario * cantidad;
    if (volumen <= 0) return;

    const pagoUnico = parseFloat(p.costPaymentUnique) || 0;
    const descPublico = parseFloat(p.discountPublicPercent) || 0;
    const aplicaAdicional = p.additionalDiscountApplied === 'Si';
    const descAdicional = parseFloat(p.additionalDiscountPercent) || 0;

    let total: number;
    if (pagoUnico > 0 && cantidad > 0 && unitario > 0) {
      total = pagoUnico;
    } else {
      const base = Math.max(0, volumen * (1 - descPublico / 100));
      total = (aplicaAdicional && descAdicional > 0) ? base * (1 - descAdicional / 100) : base;
      total = Math.max(0, total);
    }
    const pct = ((volumen - total) / volumen) * 100;
    if (pct > descuentoMax) descuentoMax = pct;
  });

  return {
    total: parseFloat(q.summaryTotal) || 0,
    descuentoMax,
    articulos: productos.length,
    formato: String(q.format || ''),
    asesorCorreo: String(q.advisorEmail || '').trim().toLowerCase(),
    fecha: (cuando instanceof Date) ? cuando : new Date()
  };
}

/**
 * Aplica la política a un contexto. `origen` dice de dónde salió la decisión:
 * 'maestro' | 'regla' | 'defecto'.
 */
export function revpolEvaluar(contexto: ContextoPolitica, p: Politica): Decision {
  if (!p.exigirRevision) {
    return {
      revisar: false,
      origen: 'maestro',
      reglaId: '',
      motivo: 'La revisión de cotizaciones está desactivada en el panel de supervisión.'
    };
  }

  for (let i = 0; i < p.reglas.length; i++) {
    const r = p.reglas[i];
    if (!r.activa) continue;
    if (!revpolCoincide(r, contexto)) continue;
    return {
      revisar: r.accion === 'revisar',
      origen: 'regla',
      reglaId: r.id,
      motivo: 'Criterio ' + (i + 1) + ': ' + revpolDescribirRegla(r)
    };
  }

  return {
    revisar: p.accionPorDefecto === 'revisar',
    origen: 'defecto',
    reglaId: '',
    motivo: p.accionPorDefecto === 'revisar'
      ? 'Ningún criterio coincide y lo predeterminado es revisar.'
      : 'Ningún criterio coincide y lo predeterminado es enviar directo.'
  };
}

/** ¿Esta regla aplica a este contexto? */
function revpolCoincide(r: Regla, c: ContextoPolitica): boolean {
  switch (r.tipo) {
    case 'monto': return revpolCompara(r, c.total);
    case 'descuento': return revpolCompara(r, c.descuentoMax);
    case 'articulos': return revpolCompara(r, c.articulos);
    case 'formato': return (r.formatos || []).length > 0 && (r.formatos || []).indexOf(c.formato) > -1;
    case 'asesor': return (r.correos || []).length > 0 && (r.correos || []).indexOf(c.asesorCorreo) > -1;
    case 'horario': return revpolCoincideHorario(r, c.fecha);
    default: return false;
  }
}

function revpolCompara(r: Regla, valor: unknown): boolean {
  const v = parseFloat(String(valor)) || 0;
  if (r.operador === 'menor') return v < (r.valor as number);
  if (r.operador === 'entre') return v >= (r.valor as number) && v <= (r.valor2 as number);
  return v >= (r.valor as number);   // mayor-igual
}

/**
 * Franja horaria en la ZONA DEL SISTEMA (America/Mexico_City), no la del navegador de quien configuró
 * la regla. El Worker corre en UTC: día y hora salen de partesMx, no de getDay()/getHours().
 */
function revpolCoincideHorario(r: Regla, fecha: Date): boolean {
  const d = (fecha instanceof Date) ? fecha : new Date();
  const p = partesMx(d);
  const dia = p.diaSemana;                 // 0 = domingo … 6 = sábado ('u' % 7 en Apps Script)
  const minutos = p.hora * 60 + p.minuto;
  const dias = r.dias || [];

  const desde = revpolMinutos(r.desde);
  const hasta = revpolMinutos(r.hasta);

  // Una franja que cruza la medianoche (22:00 → 06:00) pertenece al día en que EMPIEZA.
  const cruzaMedianoche = hasta < desde;
  const diaAnterior = (dia + 6) % 7;
  const diaCoincide = cruzaMedianoche
    ? (dias.indexOf(dia) > -1 && minutos >= desde) || (dias.indexOf(diaAnterior) > -1 && minutos <= hasta)
    : dias.indexOf(dia) > -1;

  const dentroFranja = cruzaMedianoche ? diaCoincide : (diaCoincide && minutos >= desde && minutos <= hasta);
  return r.dentro ? dentroFranja : !dentroFranja;
}

function revpolMinutos(hhmm: unknown): number {
  const m = String(hhmm || '00:00').split(':');
  return (parseInt(m[0], 10) || 0) * 60 + (parseInt(m[1], 10) || 0);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// TEXTO LEGIBLE
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Una regla contada en español. Se usa en el panel, en el simulador y —lo importante— en
 * revision_notas: dentro de seis meses la pregunta será "¿por qué este folio se aprobó solo?".
 */
export function revpolDescribirRegla(r: Regla): string {
  let condicion = '';
  switch (r.tipo) {
    case 'monto':
      condicion = 'el total ' + revpolTextoComparacion(r, formatCurrencyGS);
      break;
    case 'descuento':
      condicion = 'el descuento más alto ' + revpolTextoComparacion(r, (n) => n + '%');
      break;
    case 'articulos':
      condicion = 'el número de artículos ' + revpolTextoComparacion(r, (n) => String(n));
      break;
    case 'formato': {
      const nombres = (r.formatos || []).map((id) => {
        const f = QUOTE_FORMATS.filter((x) => x.id === id)[0];
        return f ? f.name : id;
      });
      condicion = 'el formato es ' + (nombres.join(' o ') || '(ninguno)');
      break;
    }
    case 'asesor':
      condicion = 'cotiza ' + ((r.correos || []).join(', ') || '(nadie)');
      break;
    case 'horario': {
      const dias = (r.dias || []).length === 7 ? 'cualquier día' : (r.dias || []).map((d) => REVPOL_DIAS[d]).join(', ');
      condicion = 'se guarda ' + (r.dentro ? 'dentro' : 'fuera') + ' de ' + r.desde + '–' + r.hasta + ' (' + dias + ')';
      break;
    }
    default:
      condicion = 'condición desconocida';
  }

  const efecto = (r.accion === 'revisar') ? 'pasa a revisión' : 'se envía sin revisar';
  return 'si ' + condicion + ', ' + efecto + '.';
}

function revpolTextoComparacion(r: Regla, fmt: (n: number | undefined) => string): string {
  if (r.operador === 'menor') return 'es menor que ' + fmt(r.valor);
  if (r.operador === 'entre') return 'está entre ' + fmt(r.valor) + ' y ' + fmt(r.valor2);
  return 'es mayor o igual a ' + fmt(r.valor);
}

/** Una frase que resume el estado completo de la política, para la cabecera del panel. */
export function revpolResumen(p: Politica): string {
  if (!p.exigirRevision) {
    return 'La revisión está DESACTIVADA: todas las cotizaciones se pueden enviar en cuanto se guardan.';
  }
  const activas = p.reglas.filter((r) => r.activa).length;
  const base = p.accionPorDefecto === 'revisar'
    ? 'Por defecto todo pasa a revisión'
    : 'Por defecto todo se envía sin revisar';
  if (!activas) return base + ' y no hay criterios configurados.';
  return base + ', con ' + activas + (activas === 1 ? ' criterio que lo modifica.' : ' criterios que lo modifican.');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// API PARA LA PANTALLA (inicio_avanzado.html · sección «Política de revisión»)
// ─────────────────────────────────────────────────────────────────────────────────────────

/** La política, el catálogo de criterios y los formatos reales del sistema. */
export async function getPoliticaRevision(ctx: Ctx, email: string) {
  try {
    const id = await secIdentidadConBloque(ctx, email, 'politica_revision');
    if (!id.ok) {
      return { success: false, message: id.error || 'Solo un usuario avanzado puede ver la política de revisión.' };
    }
    const p = await revpolLeer(ctx);
    return {
      success: true,
      politica: p,
      resumen: revpolResumen(p),
      descripciones: p.reglas.map((r) => revpolDescribirRegla(r)),
      catalogo: {
        tipos: REVPOL_TIPOS,
        operadores: REVPOL_OPERADORES,
        dias: REVPOL_DIAS,
        formatos: QUOTE_FORMATS.map((f) => ({ id: f.id, nombre: f.name })),
        zonaHoraria: ZONA_MX,
        maxReglas: REVPOL_MAX_REGLAS
      }
    } as Record<string, any>;
  } catch (error: any) {
    console.error('getPoliticaRevision falló: ' + (error && error.message));
    return { success: false, message: 'No pudimos cargar las reglas de revisión. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * Guarda la política completa (entera y no regla por regla: el orden es parte del significado).
 * El historial se toma de la política ANTERIOR, nunca del cliente: si no, quien relaja la política
 * podría mandar un historial vacío en la misma petición y borrar su propio rastro.
 */
export async function guardarPoliticaRevision(ctx: Ctx, email: string, politica: any) {
  try {
    const id = await secIdentidadConBloque(ctx, email, 'politica_revision');
    if (!id.ok) {
      return { success: false, message: id.error || 'Solo un usuario avanzado puede cambiar la política de revisión.' };
    }

    const anterior = await revpolLeer(ctx);
    const nueva = revpolNormalizar(politica);

    if (Array.isArray(politica && politica.reglas) && politica.reglas.length > REVPOL_MAX_REGLAS) {
      return { success: false, message: 'La política no puede tener más de ' + REVPOL_MAX_REGLAS + ' criterios.' };
    }

    nueva.actualizadaPor = id.nombre ? (id.nombre + ' (' + id.email + ')') : id.email;
    nueva.actualizadaEn = new Date().toISOString();
    nueva.historial = [{
      fecha: nueva.actualizadaEn,
      por: nueva.actualizadaPor,
      que: revpolDiferencias(anterior, nueva)
    }].concat(anterior.historial || []).slice(0, REVPOL_MAX_HISTORIAL);

    await fijarPropiedad(ctx, REVPOL_PROP_KEY, JSON.stringify(nueva));
    console.log('Política de revisión actualizada por ' + nueva.actualizadaPor + ': ' + JSON.stringify(nueva.historial[0].que));

    const respuesta: Record<string, any> = await getPoliticaRevision(ctx, email);
    respuesta.message = 'Política de revisión guardada.';
    // Apagar la revisión es la clase de cambio del que uno quiere enterarse al hacerlo.
    if (anterior.exigirRevision && !nueva.exigirRevision) {
      respuesta.aviso = 'La revisión quedó DESACTIVADA: desde ahora toda cotización se puede ' +
                        'enviar al cliente sin que nadie la apruebe, incluidas las que ya estaban en la cola.';
    }
    return respuesta;
  } catch (error: any) {
    console.error('guardarPoliticaRevision falló: ' + (error && error.message));
    return { success: false, message: 'No pudimos guardar las reglas de revisión. Inténtalo de nuevo en un momento.' };
  }
}

/** Qué cambió entre dos políticas, en frases cortas para el historial. */
function revpolDiferencias(a: Politica, b: Politica): string {
  const cambios: string[] = [];
  if (a.exigirRevision !== b.exigirRevision) {
    cambios.push(b.exigirRevision ? 'Reactivó la revisión' : 'DESACTIVÓ la revisión');
  }
  if (a.accionPorDefecto !== b.accionPorDefecto) {
    cambios.push('Cambió lo predeterminado a ' + (b.accionPorDefecto === 'revisar' ? '"revisar"' : '"enviar directo"'));
  }
  const na = a.reglas.length, nb = b.reglas.length;
  if (na !== nb) cambios.push('Criterios: ' + na + ' → ' + nb);
  else if (JSON.stringify(a.reglas) !== JSON.stringify(b.reglas)) cambios.push('Editó los criterios');
  return cambios.length ? cambios.join(' · ') : 'Sin cambios efectivos';
}

/**
 * Qué pasaría con una cotización de estas características (el simulador del panel). Ejecuta el MISMO
 * motor que decide de verdad; si llega un borrador sin guardar, se simula CON ÉL.
 */
export async function simularPoliticaRevision(ctx: Ctx, email: string, caso: any, politicaBorrador?: any) {
  try {
    const id = await secIdentidadConBloque(ctx, email, 'politica_revision');
    if (!id.ok) {
      return { success: false, message: id.error || 'Solo un usuario avanzado puede simular la política.' };
    }

    const c = caso || {};
    let fecha = new Date();
    if (c.fechaHora) {
      // aFecha y no `new Date`: el "2026-10-06T14:30" del simulador es hora de México, como lo leía
      // Apps Script (zona del script); el Worker interpretaría hora UTC.
      const parseada = aFecha(c.fechaHora);
      if (parseada) fecha = parseada;
    }

    const contexto: ContextoPolitica = {
      total: Math.max(0, parseFloat(c.total) || 0),
      descuentoMax: Math.min(100, Math.max(0, parseFloat(c.descuentoMax) || 0)),
      articulos: Math.max(0, parseInt(c.articulos, 10) || 0),
      formato: String(c.formato || ''),
      asesorCorreo: String(c.asesorCorreo || '').trim().toLowerCase(),
      fecha
    };

    const politica = politicaBorrador ? revpolNormalizar(politicaBorrador) : await revpolLeer(ctx);
    const decision = revpolEvaluar(contexto, politica);

    return {
      success: true,
      revisar: decision.revisar,
      motivo: decision.motivo,
      origen: decision.origen,
      reglaId: decision.reglaId,
      contexto: {
        total: contexto.total,
        descuentoMax: contexto.descuentoMax,
        articulos: contexto.articulos,
        formato: contexto.formato,
        asesorCorreo: contexto.asesorCorreo,
        // La hora que se DEVUELVE es la del sistema, que es con la que se decidió.
        hora: formatearFecha(fecha, 'EEEE dd/MM/yyyy HH:mm')
      }
    };
  } catch (error: any) {
    console.error('simularPoliticaRevision falló: ' + (error && error.message));
    return { success: false, message: 'No pudimos hacer la prueba. Inténtalo de nuevo en un momento.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// ENGANCHE CON EL GUARDADO DE COTIZACIONES (contratos que usa el módulo de cotizaciones)
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Decide el estatus con el que nace una cotización. La llama saveQuoteAndGoToPreview al guardar.
 * Ante CUALQUIER problema devuelve "revisar": un fallo en la política nunca puede convertirse en un
 * documento que sale al cliente sin que nadie lo mire.
 */
export async function revpolDecidirAlGuardar(ctx: Ctx, quoteData: any): Promise<{ revisar: boolean; motivo: string; origen: string; reglaId: string }> {
  try {
    const contexto = revpolContextoDeCotizacion(quoteData);
    return revpolEvaluar(contexto, await revpolLeer(ctx));
  } catch (e: any) {
    console.error('revpolDecidirAlGuardar falló (' + (e && e.message) + '): la cotización pasa a revisión.');
    return { revisar: true, motivo: 'No se pudo evaluar la política; se mandó a revisión por seguridad.',
             origen: 'error', reglaId: '' };
  }
}

/**
 * Escribe el sello de una aprobación automática: el MISMO rastro que una aprobación humana —quién,
 * cuándo, con qué notas—, porque dentro de seis meses la pregunta va a ser "¿quién aprobó esto?" y
 * la respuesta tiene que ser "la política, por esta regla", no una celda vacía. Va DESPUÉS de guardar
 * la cotización (el guardado limpia las columnas de revisión). No toca `estatus`: el guardado ya lo
 * dejó en "Aprobada". Nunca lanza.
 */
export async function revpolSellarAprobacionAutomatica(ctx: Ctx, folio: string, decision: { motivo: string; origen: string; reglaId?: string }): Promise<void> {
  try {
    const motivo = String(decision && decision.motivo != null ? decision.motivo : '');
    const texto = 'No se verificó artículo por artículo: la política del panel de supervisión permitió el ' +
                  'envío directo.\nMotivo registrado: ' + motivo;
    const r = await ctx.ejecutar(
      'UPDATE cotizaciones SET revision_estado = ?, revisado_por = ?, revisado_nombre = ?, revision_fecha = ?, ' +
      'revision_notas = ?, revision_checklist = ? WHERE folio = ?',
      REV_ESTATUS_APROBADA, REV_POR_AUTOMATICA, REV_NOMBRE_AUTOMATICA, ctx.ahoraIso(),
      'Aprobada sin revisión humana por la política vigente. ' + motivo,
      // revision_checklist es JSON en D1 (0001_esquema.sql); `texto` es lo que en la hoja iba en la celda.
      JSON.stringify({ v: 1, tipo: 'automatica', texto, origenDecision: String((decision && decision.origen) || ''),
                       reglaId: String((decision && decision.reglaId) || '') }),
      String(folio == null ? '' : folio));
    if (r.cambios) console.log('Cotización ' + folio + ' aprobada automáticamente. ' + motivo);
  } catch (e: any) {
    // Si el sello falla, la cotización queda "Aprobada" pero sin rastro: se registra fuerte.
    console.error('revpolSellarAprobacionAutomatica FALLÓ para ' + folio + ': ' + (e && e.message));
  }
}
