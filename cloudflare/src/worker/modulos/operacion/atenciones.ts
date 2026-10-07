/**
 * ATENCIONES POSPUESTAS Y PENDIENTES | Portal Ventel en Cloudflare
 * ================================================================
 * Port de Atenciones.gs: la libreta para devolverle la llamada a un cliente que se quedó a medias
 * porque la plataforma falló.
 *
 * PRIVACIDAD (doc 04 §6), intacta:
 *   1. Por omisión una atención la ve SOLO quien la registró.
 *   2. Pasa al pool público solo si el asesor lo decidió al registrar (o pulsa «Liberar ya»). Si no,
 *      es privada para siempre.
 *   3. En el pool viaja atenVersionPublica: sin el correo del cliente ni el del asesor.
 * La consulta SQL de atencionesPanorama solo trae filas candidatas (mías, tomadas o cerradas por mí y
 * las que tienen liberación programada); quién ve qué lo decide la MISMA lógica del .gs, en JS.
 *
 * Diferencias con Apps Script: las hojas AtencionesPendientes/AtencionesTipos son las tablas
 * atenciones_pendientes/atenciones_tipos; LockService → conCandado('atenciones'); la hora fija de
 * liberación se resuelve en hora de México con fechaDesdeMx (el Worker está en UTC).
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIdentidadConBloque } from '../../nucleo/seguridad';
import { aFecha, aIso, fechaDesdeMx, partesMx, ZONA_MX } from '../../nucleo/fechas';
import { uuid } from '../../nucleo/cripto';
import { CandadoOcupado, conCandado } from './comun';

// ── FORMA Y TOPES ──────────────────────────────────────────────────────────────────────────────

const ATEN_BLOQUE = 'atenciones';
const ATEN_TIPOS_BASE = ['Venta', 'Seguimiento', 'Aclaración', 'Otro'];

const ATEN_MAX_NOMBRE = 90;
const ATEN_MAX_NOTAS = 600;
const ATEN_MAX_TIPO = 40;
const ATEN_MAX_RESULTADO = 400;
/** Cuántas cerradas se devuelven (las abiertas van todas). */
const ATEN_TOPE_CERRADAS = 30;
/** Techo de seguridad de atenciones abiertas por asesor (dobles clics, pestañas que reintentan). */
const ATEN_MAX_ABIERTAS = 50;

/** Opciones de liberación: relativa ('min', desde el registro) o fija ('hora', fin de turno). */
const ATEN_LIBERAR_OPCIONES = [
  { tipo: 'nunca',    min: 0,   nombre: 'Nunca · solo yo la veo' },
  { tipo: 'relativa', min: 30,  nombre: 'A los 30 minutos' },
  { tipo: 'relativa', min: 60,  nombre: 'En 1 hora' },
  { tipo: 'relativa', min: 120, nombre: 'En 2 horas' },
  { tipo: 'relativa', min: 240, nombre: 'En 4 horas' },
  { tipo: 'hora',     hora: '', nombre: 'A una hora fija del día…' }
];
const ATEN_HORAS_SUGERIDAS = ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

/** «Tomar» reserva la atención 15 minutos; vencida, vuelve sola al pool (se calcula al leer). */
const ATEN_RESERVA_MIN = 15;

/** Lo que tarda como mucho en conseguirse el candado (lock.waitLock(15000) en el .gs). */
const ATEN_ESPERA_CANDADO = 15000;
const ATEN_OCUPADO = 'El sistema está ocupado. Vuelve a intentarlo.';

// ── UTILIDADES ─────────────────────────────────────────────────────────────────────────────────

function atenError(mensaje?: string) {
  return { success: false, message: mensaje || 'No se pudo completar la operación.' };
}

/** Puerta de entrada: sesión válida y bloque concedido. */
function atenGate(ctx: Ctx, email: unknown) {
  return secIdentidadConBloque(ctx, email, ATEN_BLOQUE);
}

function atenId(): string {
  return 'AT-' + uuid().split('-')[0].toUpperCase() + '-' + (Date.now() % 100000);
}

/** Quita caracteres de control y recorta. Los saltos de línea se conservan en las notas. */
function atenLimpiar(texto: unknown, tope?: number, conSaltos?: boolean): string {
  let s = String(texto == null ? '' : texto);
  s = conSaltos
    ? s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    : s.replace(/[\u0000-\u001f\u007f]/g, '');
  return s.trim().slice(0, tope || 200);
}

/** Normaliza un teléfono conservando lo que se puede marcar. No se valida contra un formato. */
function atenTelefono(valor: unknown): string {
  return String(valor == null ? '' : valor).replace(/[^\d+()\-\s.ext]/gi, '').trim().slice(0, 40);
}

/** ¿Tiene al menos los dígitos suficientes para ser un teléfono al que llamar? */
function atenTelefonoUtil(valor: unknown): boolean {
  return String(valor || '').replace(/\D/g, '').length >= 7;
}

/** Hora del día válida → {h, m}, o null. Acepta «17:00», «17», «5:30» y «17.30». */
function atenParsearHora(valor: unknown): { h: number; m: number } | null {
  const s = String(valor == null ? '' : valor).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\s*[:.\s]?\s*(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (!(h >= 0 && h <= 23) || !(min >= 0 && min <= 59)) return null;
  return { h, m: min };
}

/**
 * CUÁNDO se libera una atención: Date, o '' si es privada para siempre.
 * La hora fija se resuelve en la zona de la OPERACIÓN (México), no la del Worker (UTC) ni la del
 * navegador; si ya pasó hoy, es la de mañana. La relativa se cuenta desde `base`.
 */
function atenLiberarEnDesde(d: any, base: Date): Date | '' {
  const hm = atenParsearHora(d && d.liberarHora);
  if (hm) {
    const p = partesMx(base);
    let objetivo = fechaDesdeMx(p.anio, p.mes, p.dia, hm.h, hm.m);
    if (isNaN(objetivo.getTime())) return '';   // mejor privada que a deshora
    if (objetivo.getTime() <= base.getTime()) objetivo = new Date(objetivo.getTime() + 86400000);
    return objetivo;
  }
  const minutos = Math.max(0, Math.min(1440, Number(d && d.liberarMin) || 0));
  return minutos > 0 ? new Date(base.getTime() + minutos * 60000) : '';
}

const atenISO = (v: unknown): string => aIso(v);

function atenMs(v: unknown): number {
  const d = aFecha(v);
  return d ? d.getTime() : 0;
}

/** Fecha para la columna: ISO, o NULL si no hay (lo que era una celda en blanco). */
const aColumna = (v: Date | ''): string | null => (v ? v.toISOString() : null);

// ── TIPOS DE ATENCIÓN (catálogo que se alimenta solo) ──────────────────────────────────────────

function atenClave(texto: unknown): string {
  return String(texto == null ? '' : texto).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/** Tipos: los base más los que ha usado el equipo, por uso (este desplegable se abre con prisa). */
async function atenTipos(ctx: Ctx): Promise<Array<{ nombre: string; clave: string; usos: number }>> {
  const filas = await ctx.todas<{ tipo: string; usos: number }>('SELECT tipo, usos FROM atenciones_tipos ORDER BY rowid');
  const vistos: Record<string, boolean> = {};
  const lista: Array<{ nombre: string; clave: string; usos: number }> = [];
  filas.forEach((f) => {
    const nombre = String(f.tipo || '').trim();
    if (!nombre) return;
    const clave = atenClave(nombre);
    if (vistos[clave]) return;
    vistos[clave] = true;
    lista.push({ nombre, clave, usos: Number(f.usos) || 0 });
  });
  ATEN_TIPOS_BASE.forEach((nombre) => {
    const clave = atenClave(nombre);
    if (vistos[clave]) return;
    vistos[clave] = true;
    lista.push({ nombre, clave, usos: 0 });
  });
  lista.sort((a, b) => (a.usos !== b.usos ? b.usos - a.usos : a.nombre.localeCompare(b.nombre, 'es')));
  return lista;
}

/**
 * Apunta el uso de un tipo, creándolo si es nuevo. Devuelve el nombre TAL COMO SE GUARDÓ la primera
 * vez («venta», «Venta» y «VENTA» son una sola entrada). Un UPSERT sustituye a buscar-y-escribir.
 */
async function atenTipoRegistrar(ctx: Ctx, nombre: unknown, quien: string): Promise<string> {
  const limpio = atenLimpiar(nombre, ATEN_MAX_TIPO);
  if (!limpio) return '';
  try {
    const fila = await ctx.una<{ tipo: string }>(
      'INSERT INTO atenciones_tipos (clave, tipo, usos, creado, por) VALUES (?, ?, 1, ?, ?) ' +
      'ON CONFLICT(clave) DO UPDATE SET usos = COALESCE(atenciones_tipos.usos, 0) + 1 RETURNING tipo',
      atenClave(limpio), limpio, ctx.ahoraIso(), quien || '');
    return String((fila && fila.tipo) || limpio);
  } catch (e) {
    console.error('atenTipoRegistrar', e);
  }
  return limpio;
}

// ── LECTURA ────────────────────────────────────────────────────────────────────────────────────

interface Atencion {
  id: string; fecha: string; asesor: string; asesorNombre: string; cliente: string; telefono: string;
  correo: string; tipo: string; notas: string; horaPromesa: string; liberarEn: string; estado: string;
  rescatadaPor: string; rescatadaEn: string; cerradaPor: string; cerradaEn: string; resultado: string;
  reservaViva?: boolean; reservaRestanteMs?: number; liberada?: boolean;
}

/** La fila convertida en el objeto que viaja al cliente (atenDeFila_). */
function atenDeFila(f: Record<string, any>): Atencion {
  return {
    id: String(f.id || ''),
    fecha: atenISO(f.fecha),
    asesor: String(f.asesor || '').toLowerCase(),
    asesorNombre: String(f.asesor_nombre || ''),
    cliente: String(f.cliente || ''),
    telefono: String(f.telefono || ''),
    correo: String(f.correo || ''),
    tipo: String(f.tipo || ''),
    notas: String(f.notas || ''),
    horaPromesa: String(f.hora_promesa || ''),
    liberarEn: atenISO(f.liberar_en),
    estado: String(f.estado || 'pendiente').toLowerCase(),
    rescatadaPor: String(f.rescatada_por || '').toLowerCase(),
    rescatadaEn: atenISO(f.rescatada_en),
    cerradaPor: String(f.cerrada_por || '').toLowerCase(),
    cerradaEn: atenISO(f.cerrada_en),
    resultado: String(f.resultado || '')
  };
}

/** ¿Ya está liberada al pool? Sin fecha de liberación es privada PARA SIEMPRE. */
function atenLiberada(a: Atencion, ahora?: number): boolean {
  if (!a.liberarEn) return false;
  if (a.estado !== 'pendiente') return false;
  return atenMs(a.liberarEn) <= (ahora || Date.now());
}

/** ¿Hay una reserva VIVA sobre esta atención? */
function atenReservaViva(a: Atencion | null, ahora?: number): boolean {
  if (!a || !a.rescatadaPor) return false;
  if (a.estado !== 'pendiente') return false;
  const desde = atenMs(a.rescatadaEn);
  if (!desde) return false;
  return (desde + ATEN_RESERVA_MIN * 60000) > (ahora || Date.now());
}

/** Milisegundos que le quedan a la reserva. 0 si no hay ninguna viva. */
function atenReservaRestante(a: Atencion, ahora?: number): number {
  if (!atenReservaViva(a, ahora)) return 0;
  return (atenMs(a.rescatadaEn) + ATEN_RESERVA_MIN * 60000) - (ahora || Date.now());
}

/** Liberada, pendiente y sin reserva viva. Una reserva VENCIDA no estorba: ese es el punto. */
function atenTomable(a: Atencion, ahora?: number): boolean {
  return atenLiberada(a, ahora) && !atenReservaViva(a, ahora);
}

/**
 * Versión pública: lo justo para poder llamar. El correo del cliente NO viaja (para telefonear no
 * hace falta y es el dato con el que se arma una lista de distribución); tampoco el del asesor.
 */
function atenVersionPublica(a: Atencion) {
  return {
    id: a.id,
    fecha: a.fecha,
    asesorNombre: a.asesorNombre,
    cliente: a.cliente,
    telefono: a.telefono,
    tipo: a.tipo,
    // Las notas SÍ van: son el contexto de la llamada.
    notas: a.notas,
    horaPromesa: a.horaPromesa,
    liberarEn: a.liberarEn,
    estado: a.estado,
    publica: true,
    reservaViva: false
  };
}

/** Localiza una atención por ID (sin distinguir mayúsculas, como el .gs). */
async function atenBuscar(ctx: Ctx, id: unknown): Promise<{ idReal: string; datos: Atencion } | null> {
  const objetivo = String(id || '').trim().toUpperCase();
  if (!objetivo) return null;
  const f = await ctx.una('SELECT * FROM atenciones_pendientes WHERE upper(trim(id)) = ? LIMIT 1', objetivo);
  return f ? { idReal: String(f.id), datos: atenDeFila(f) } : null;
}

/**
 * ¿Puede esta persona operar sobre esta atención? El motivo, o '' si sí. Casos legítimos: es suya,
 * la tiene tomada con la reserva viva, o está liberada y libre (va a rescatarla ahora).
 */
function atenVeto(a: Atencion | null, yo: string): string {
  if (!a) return 'Esa atención ya no existe.';
  const mio = String(yo || '').toLowerCase();
  if (a.asesor === mio) return '';
  if (a.rescatadaPor === mio && atenReservaViva(a)) return '';
  if (atenTomable(a)) return '';
  if (a.rescatadaPor && atenReservaViva(a)) {
    return 'Otro asesor la tomó hace un momento. Vuelve a intentarlo en unos minutos.';
  }
  return 'Esta atención es de otro asesor.';
}

/** Escribe columnas sueltas de una atención (atenEscribirCeldas_). */
async function atenEscribir(ctx: Ctx, idReal: string, campos: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(campos);
  if (!cols.length) return;
  await ctx.ejecutar('UPDATE atenciones_pendientes SET ' + cols.map((c) => c + ' = ?').join(', ') + ' WHERE id = ?',
    ...cols.map((c) => campos[c]), idReal);
}

/** Corre `fn` con el candado de atenciones; si no se consigue, el mismo aviso que el .gs. */
async function conCandadoAtenciones<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T | ReturnType<typeof atenError>> {
  try {
    return await conCandado(ctx, 'atenciones', ATEN_ESPERA_CANDADO, fn);
  } catch (e) {
    if (e instanceof CandadoOcupado) return atenError(ATEN_OCUPADO);
    throw e;
  }
}

/** Filas que pueden interesarle a `yo`: el filtro exacto (privacidad incluida) se hace en JS. */
function filasCandidatas(ctx: Ctx, yo: string) {
  return ctx.todas(
    'SELECT * FROM atenciones_pendientes ' +
    'WHERE lower(asesor) = ? OR lower(rescatada_por) = ? OR lower(cerrada_por) = ? ' +
    "   OR (COALESCE(liberar_en, '') <> '' AND lower(COALESCE(NULLIF(trim(estado), ''), 'pendiente')) = 'pendiente') " +
    'ORDER BY rowid', yo, yo, yo);
}

// ── API DEL NAVEGADOR ──────────────────────────────────────────────────────────────────────────

/** Todo lo que la pantalla de atenciones necesita, en una llamada. */
export async function atencionesPanorama(ctx: Ctx, email?: string) {
  try {
    const gate = await atenGate(ctx, email);
    if (!gate.ok) return atenError(gate.error);

    const yo = String(gate.email || '').toLowerCase();
    const ahora = Date.now();
    const mias: Atencion[] = [];
    const publicas: ReturnType<typeof atenVersionPublica>[] = [];
    const cerradas: Atencion[] = [];

    (await filasCandidatas(ctx, yo)).forEach((f) => {
      const a = atenDeFila(f);
      if (!a.id) return;
      a.reservaViva = atenReservaViva(a, ahora);
      a.reservaRestanteMs = atenReservaRestante(a, ahora);
      a.liberada = atenLiberada(a, ahora);

      const esAutor = (a.asesor === yo);
      const laTengoYo = (a.rescatadaPor === yo) && a.reservaViva;

      if (a.estado !== 'pendiente') {
        // Las cerradas las ve quien participó: quien la registró, la tomó o la cerró.
        if (esAutor || a.rescatadaPor === yo || a.cerradaPor === yo) cerradas.push(a);
        return;
      }
      // Propias: las que registré yo y las que tengo tomadas ahora mismo.
      if (esAutor || laTengoYo) { mias.push(a); return; }
      // De otra persona: al pool solo si está liberada y libre, y RECORTADA.
      if (atenTomable(a, ahora)) publicas.push(atenVersionPublica(a));
    });

    // La más antigua primero: es a la que más lleva esperando el cliente.
    mias.sort((a, b) => atenMs(a.fecha) - atenMs(b.fecha));
    publicas.sort((a, b) => atenMs(a.fecha) - atenMs(b.fecha));
    cerradas.sort((a, b) => atenMs(b.cerradaEn) - atenMs(a.cerradaEn));

    return {
      success: true,
      yo: { email: yo, nombre: gate.nombre || '' },
      mias,
      publicas,
      cerradas: cerradas.slice(0, ATEN_TOPE_CERRADAS),
      tipos: (await atenTipos(ctx)).map((t) => t.nombre),
      opcionesLiberar: ATEN_LIBERAR_OPCIONES.slice(),
      horasSugeridas: ATEN_HORAS_SUGERIDAS.slice(),
      reservaMin: ATEN_RESERVA_MIN,
      // La zona de la operación, para que quien esté en otro huso sepa que «las 17:00» no son las suyas.
      zonaHoraria: ZONA_MX,
      ahora: new Date().toISOString()
    };
  } catch (e) {
    console.error('atencionesPanorama', e);
    return atenError('No pudimos leer tus atenciones pendientes. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Registra una atención pendiente.
 * @param datos { cliente, telefono, correo, tipo, notas, horaPromesa, liberarMin | liberarHora }
 */
export async function atencionRegistrar(ctx: Ctx, email?: string, datos?: any) {
  try {
    const gate = await atenGate(ctx, email);
    if (!gate.ok) return atenError(gate.error);

    const d = datos || {};
    const cliente = atenLimpiar(d.cliente, ATEN_MAX_NOMBRE);
    const telefono = atenTelefono(d.telefono);
    if (!cliente) return atenError('Escribe el nombre del cliente.');
    if (!atenTelefonoUtil(telefono)) return atenError('Hace falta un teléfono al que devolverle la llamada.');

    // El correo es opcional; si no tiene forma de correo se descarta en vez de rechazar el registro.
    let correo = String(d.correo || '').trim().toLowerCase().slice(0, 120);
    if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) correo = '';

    const yo = String(gate.email || '').toLowerCase();

    return await conCandadoAtenciones(ctx, async () => {
      const abiertas = Number((await ctx.una<{ n: number }>(
        'SELECT COUNT(*) AS n FROM atenciones_pendientes ' +
        "WHERE lower(asesor) = ? AND lower(COALESCE(NULLIF(trim(estado), ''), 'pendiente')) = 'pendiente'", yo))?.n || 0);
      if (abiertas >= ATEN_MAX_ABIERTAS) {
        return atenError('Tienes ' + abiertas + ' atenciones abiertas. Cierra algunas antes de registrar más.');
      }

      const tipo = await atenTipoRegistrar(ctx, d.tipo || 'Otro', yo);
      const ahora = new Date();
      // Admite las dos formas: `liberarMin` (relativa) o `liberarHora` (fija del día).
      const liberarEn = atenLiberarEnDesde(d, ahora);
      const id = atenId();
      const notas = atenLimpiar(d.notas, ATEN_MAX_NOTAS, true);
      const horaPromesa = atenLimpiar(d.horaPromesa, 40);

      await ctx.ejecutar(
        'INSERT INTO atenciones_pendientes (id, fecha, asesor, asesor_nombre, cliente, telefono, correo, tipo, notas, ' +
        'hora_promesa, liberar_en, estado, rescatada_por, rescatada_en, cerrada_por, cerrada_en, resultado) ' +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', '', NULL, '', NULL, '')",
        id, ahora.toISOString(), yo, gate.nombre || '', cliente, telefono, correo, tipo, notas, horaPromesa, aColumna(liberarEn));

      return {
        success: true,
        message: 'Guardado. Tienes los datos de ' + cliente + ' para retomar la atención.',
        atencion: {
          id, fecha: ahora.toISOString(), asesor: yo, asesorNombre: gate.nombre || '',
          cliente, telefono, correo, tipo, notas, horaPromesa,
          liberarEn: liberarEn ? liberarEn.toISOString() : '',
          estado: 'pendiente', rescatadaPor: '', cerradaPor: '', resultado: ''
        }
      };
    });
  } catch (e) {
    console.error('atencionRegistrar', e);
    return atenError('No pudimos guardar la atención. Inténtalo de nuevo.');
  }
}

/**
 * Cambia notas, tipo, hora de promesa o liberación. Fijar valores es idempotente: el cliente lo
 * reintenta (app_atenciones: guardar anotaciones, reintentos 2) sin riesgo.
 * @param cambios { notas?, tipo?, horaPromesa?, liberarMin?, liberarHora? }
 */
export async function atencionActualizar(ctx: Ctx, email?: string, id?: string, cambios?: any) {
  try {
    const gate = await atenGate(ctx, email);
    if (!gate.ok) return atenError(gate.error);
    const yo = String(gate.email || '').toLowerCase();

    return await conCandadoAtenciones(ctx, async () => {
      const hallado = await atenBuscar(ctx, id);
      const veto = atenVeto(hallado && hallado.datos, yo);
      if (veto) return atenError(veto);
      if (hallado!.datos.estado !== 'pendiente') return atenError('Esa atención ya está finalizada.');

      const c = cambios || {};
      const campos: Record<string, unknown> = {};
      if (c.notas !== undefined) campos.notas = atenLimpiar(c.notas, ATEN_MAX_NOTAS, true);
      if (c.horaPromesa !== undefined) campos.hora_promesa = atenLimpiar(c.horaPromesa, 40);
      if (c.tipo !== undefined) campos.tipo = await atenTipoRegistrar(ctx, c.tipo, yo);

      // La liberación solo la decide QUIEN LA REGISTRÓ, y la relativa se cuenta desde el REGISTRO
      // (si no, a base de retoques se aplazaría la liberación indefinidamente).
      if (c.liberarMin !== undefined || c.liberarHora !== undefined) {
        if (hallado!.datos.asesor !== yo) {
          return atenError('Solo quien registró la atención puede cambiar cuándo se libera.');
        }
        const base = new Date(atenMs(hallado!.datos.fecha) || Date.now());
        campos.liberar_en = aColumna(atenLiberarEnDesde(c, base));
      }

      if (!Object.keys(campos).length) return { success: true, sinCambios: true, message: 'No había nada que cambiar.' };
      await atenEscribir(ctx, hallado!.idReal, campos);
      return { success: true, message: 'Atención actualizada.' };
    });
  } catch (e) {
    console.error('atencionActualizar', e);
    return atenError('No pudimos actualizar la atención.');
  }
}

/** LIBERA YA una atención propia al pool, sin esperar a la hora configurada. Solo su autor. */
export async function atencionLiberarAhora(ctx: Ctx, email?: string, id?: string) {
  try {
    const gate = await atenGate(ctx, email);
    if (!gate.ok) return atenError(gate.error);
    const yo = String(gate.email || '').toLowerCase();

    return await conCandadoAtenciones(ctx, async () => {
      const hallado = await atenBuscar(ctx, id);
      if (!hallado) return atenError('Esa atención ya no existe.');
      const a = hallado.datos;
      if (a.asesor !== yo) return atenError('Solo quien registró la atención puede liberarla.');
      if (a.estado !== 'pendiente') return atenError('Esa atención ya está finalizada.');
      if (atenLiberada(a)) return { success: true, sinCambios: true, message: 'Esa atención ya estaba liberada.' };

      const ahora = new Date();
      await atenEscribir(ctx, hallado.idReal, { liberar_en: ahora.toISOString() });
      return {
        success: true,
        liberarEn: ahora.toISOString(),
        message: 'Liberada. Cualquier asesor puede tomarla y llamar a ' + a.cliente + '.'
      };
    });
  } catch (e) {
    console.error('atencionLiberarAhora', e);
    return atenError('No pudimos liberar la atención.');
  }
}

/**
 * TOMA una atención liberada: la reserva quince minutos. Es una carrera (dos asesores con la misma
 * tarjeta en pantalla): el candado y la relectura dentro de él impiden que los dos llamen.
 */
export async function atencionRescatar(ctx: Ctx, email?: string, id?: string) {
  try {
    const gate = await atenGate(ctx, email);
    if (!gate.ok) return atenError(gate.error);
    const yo = String(gate.email || '').toLowerCase();

    return await conCandadoAtenciones(ctx, async () => {
      const hallado = await atenBuscar(ctx, id);
      if (!hallado) return atenError('Esa atención ya no existe.');
      const a = hallado.datos;
      const ahora = new Date();

      if (a.asesor === yo) return atenError('Esta atención ya es tuya.');
      if (a.estado !== 'pendiente') return atenError('Esa atención ya está finalizada.');
      if (!atenLiberada(a, ahora.getTime())) return atenError('Esa atención todavía no está liberada.');
      // Solo estorba una reserva VIVA y de OTRA persona: la propia se renueva.
      if (atenReservaViva(a, ahora.getTime()) && a.rescatadaPor !== yo) {
        return atenError('Otro asesor la tomó hace un momento. Actualiza la lista.');
      }

      await atenEscribir(ctx, hallado.idReal, { rescatada_por: yo, rescatada_en: ahora.toISOString() });

      // La ficha COMPLETA, ya con el correo del cliente: mientras dure la reserva hace falta todo.
      a.rescatadaPor = yo;
      a.rescatadaEn = ahora.toISOString();
      a.reservaViva = true;
      a.reservaRestanteMs = ATEN_RESERVA_MIN * 60000;
      a.liberada = true;
      return {
        success: true,
        message: 'La tienes ' + ATEN_RESERVA_MIN + ' minutos. Llama a ' + a.cliente + '.',
        reservaMin: ATEN_RESERVA_MIN,
        atencion: a
      };
    });
  } catch (e) {
    console.error('atencionRescatar', e);
    return atenError('No pudimos rescatar la atención.');
  }
}

/** Cierra una atención. `resultado` es opcional a propósito. */
export async function atencionFinalizar(ctx: Ctx, email?: string, id?: string, resultado?: string) {
  try {
    const gate = await atenGate(ctx, email);
    if (!gate.ok) return atenError(gate.error);
    const yo = String(gate.email || '').toLowerCase();

    return await conCandadoAtenciones(ctx, async () => {
      const hallado = await atenBuscar(ctx, id);
      const veto = atenVeto(hallado && hallado.datos, yo);
      if (veto) return atenError(veto);
      if (hallado!.datos.estado !== 'pendiente') {
        return { success: true, sinCambios: true, message: 'Esa atención ya estaba finalizada.' };
      }
      await atenEscribir(ctx, hallado!.idReal, {
        estado: 'finalizada',
        cerrada_por: yo,
        cerrada_en: new Date().toISOString(),
        resultado: atenLimpiar(resultado, ATEN_MAX_RESULTADO, true)
      });
      return { success: true, message: 'Atención finalizada.' };
    });
  } catch (e) {
    console.error('atencionFinalizar', e);
    return atenError('No pudimos finalizar la atención.');
  }
}

/** Dos cifras y la más urgente (inicio del asesor y feed de supervisión). */
export async function atencionesResumen(ctx: Ctx, email?: string) {
  try {
    const gate = await atenGate(ctx, email);
    if (!gate.ok) return { success: false, mias: 0, publicas: 0 };

    const yo = String(gate.email || '').toLowerCase();
    const ahora = Date.now();
    let mias = 0, publicas = 0, masVieja = 0, clienteViejo = '';
    (await filasCandidatas(ctx, yo)).forEach((f) => {
      const a = atenDeFila(f);
      if (!a.id || a.estado !== 'pendiente') return;
      // Mismo criterio que el panorama: una reserva vencida deja de ser «mía».
      if (a.asesor === yo || (a.rescatadaPor === yo && atenReservaViva(a, ahora))) {
        mias++;
        const ms = atenMs(a.fecha);
        if (ms && (!masVieja || ms < masVieja)) { masVieja = ms; clienteViejo = a.cliente; }
      } else if (atenTomable(a, ahora)) {
        publicas++;
      }
    });
    return {
      success: true, mias, publicas,
      masVieja: masVieja ? new Date(masVieja).toISOString() : '',
      clienteMasViejo: clienteViejo
    };
  } catch (e) {
    console.error('atencionesResumen', e);
    return { success: false, mias: 0, publicas: 0 };
  }
}
