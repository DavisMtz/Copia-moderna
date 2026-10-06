/**
 * ESTADO DE OPERACIÓN · piezas comunes | Portal Ventel en Cloudflare
 * =================================================================
 * Lo que en Operacion.gs estaba repartido entre «PARÁMETROS», «CATÁLOGOS BASE», «CATÁLOGO»,
 * «INCIDENTES» y «AVISOS A GOOGLE CHAT», más el sustituto de LockService.
 *
 * Diferencias con Apps Script, todas por ser D1:
 *   · Las hojas OperacionReportes/Incidentes/Actualizaciones/Catalogo son las tablas operacion_*.
 *     Ya no hay números de fila: todo se localiza por id y se escribe con UPDATE de las columnas
 *     que el .gs escribía.
 *   · Sin caché (CacheService + generación): D1 contesta en milisegundos y así confirmar una falla
 *     se ve al instante sin tener que invalidar nada. opInvalidarCache_ desaparece.
 *   · LockService.getScriptLock() → conCandado(), un candado con caducidad en la tabla
 *     operacion_candados (migración 0006). Hace falta de verdad: durante una caída llegan muchos
 *     reportes a la vez y sin candado tres personas simultáneas podían no levantar la incidencia, o
 *     levantar dos.
 *   · Los avisos a Google Chat no salen (decisión del proyecto): se registran en la consola.
 */
import type { Ctx } from '../../nucleo/contexto';
import { aFecha, aIso, formatearFecha, MESES_ES } from '../../nucleo/fechas';
import { esAfirmativo } from '../../nucleo/util';
import { uuid } from '../../nucleo/cripto';
import { opCapitalizar, opClave, opLimpiarTexto } from './texto';

// ── PARÁMETROS DE COMPORTAMIENTO (los mismos valores que Operacion.gs) ─────────────────────────

/** Tres PERSONAS distintas en media hora levantan un incidente automático (elegido el 2026-08-08). */
export const OP_UMBRAL_PERSONAS = 3;
export const OP_VENTANA_MIN = 30;

/** El mismo umbral mirando el SERVICIO entero, para cuando cada quien describe la falla a su manera. */
export const OP_UMBRAL_SERVICIO_ACTIVO = true;

/** Lo que lee el público cuando salta un umbral y todavía no ha pasado nadie de supervisión. */
export const OP_AVISO_POSIBLE = 'Es posible que existan problemas con el servicio.';

export function opAvisoPosibleDetalle(): string {
  return OP_AVISO_POSIBLE + ' Varias personas reportaron fallas en los últimos ' +
         OP_VENTANA_MIN + ' minutos y lo estamos revisando.';
}

/** Tope de reportes por persona y hora. */
export const OP_MAX_REPORTES_HORA = 8;
/** Dos reportes idénticos de la MISMA persona en este plazo son el mismo reporte. */
export const OP_MIN_ENTRE_IGUALES = 10;
/** Un «posible» que nadie confirma y deja de recibir reportes se apaga solo pasada esta hora. */
export const OP_HORAS_CADUCA_POSIBLE = 1;

/** Evidencias: tope por archivo y por reporte. */
export const OP_MAX_EVIDENCIAS = 4;
export const OP_MAX_BYTES_EVIDENCIA = 5 * 1024 * 1024;

/** Bloque de permisos que hace falta para confirmar, descartar o actualizar. */
export const OP_BLOQUE = 'operacion';

// ── CATÁLOGOS BASE ─────────────────────────────────────────────────────────────────────────────

/** Los cuatro sistemas de siempre. `publico` decide cuáles se pintan en grande sin sesión. */
export const OP_SISTEMAS_BASE = [
  { clave: 'connect',    nombre: 'Connect',    publico: true,  orden: 1 },
  { clave: 'pagina-app', nombre: 'Página/App', publico: true,  orden: 2 },
  { clave: 'salesforce', nombre: 'Salesforce', publico: false, orden: 3 },
  { clave: 'ccaip',      nombre: 'CCAIP',      publico: false, orden: 4 }
];

/**
 * Estados de un incidente. afecta → cuenta en el semáforo; cierra → deja de estar vivo;
 * publico → se enseña sin sesión ('descartado' NO: anunciar una falsa alarma resta credibilidad).
 */
export const OP_ESTADOS_BASE = [
  { clave: 'posible', nombre: 'Posible problema', tono: 'warn', afecta: true, cierra: false, publico: true,
    detalle: 'Varias personas reportaron lo mismo. Falta que supervisión lo confirme.' },
  { clave: 'confirmado', nombre: 'Confirmado', tono: 'alert', afecta: true, cierra: false, publico: true,
    detalle: 'Supervisión confirmó la falla. Ya se está trabajando en ella.' },
  { clave: 'intermitencia', nombre: 'Intermitencia', tono: 'warn', afecta: true, cierra: false, publico: true,
    detalle: 'Funciona a ratos. Puede fallar sin aviso.' },
  { clave: 'mantenimiento', nombre: 'En mantenimiento', tono: 'info', afecta: true, cierra: false, publico: true,
    detalle: 'Trabajo programado. Se restablece al terminar.' },
  { clave: 'resuelto', nombre: 'Resuelto', tono: 'ok', afecta: false, cierra: true, publico: true,
    detalle: 'El sistema volvió a la normalidad.' },
  { clave: 'descartado', nombre: 'Descartado', tono: 'neutro', afecta: false, cierra: true, publico: false,
    detalle: 'Se revisó y no era una falla del sistema.' }
];

/** Submotivos que se ofrecen desde el primer día, por sistema. */
export const OP_SUBMOTIVOS_BASE: Record<string, string[]> = {
  'connect':    ['No abre / no carga', 'Se cierra solo', 'No deja iniciar sesión', 'Va muy lento', 'No guarda la llamada'],
  'pagina-app': ['No carga la página', 'No aparecen precios', 'No deja agregar a la bolsa', 'Error al pagar', 'Imágenes rotas'],
  'salesforce': ['No abre / no carga', 'No deja iniciar sesión', 'No guarda el caso', 'Va muy lento', 'No encuentra al cliente'],
  'ccaip':      ['No entran llamadas', 'Se corta el audio', 'No deja iniciar sesión', 'No cambia de estado', 'Va muy lento']
};

const TONOS = ['ok', 'info', 'warn', 'alert', 'neutro'];

// ── TIPOS ──────────────────────────────────────────────────────────────────────────────────────

export interface Sistema {
  clave: string; nombre: string; publico: boolean; orden: number; base: boolean; usos: number;
  creado?: string; creadoPor?: string;
}
export interface Submotivo { valor: string; clave: string; base: boolean; usos: number; creadoPor?: string }
export interface Estado {
  clave: string; nombre: string; tono: string; afecta: boolean; cierra: boolean; publico: boolean;
  detalle: string; base: boolean;
}
export interface Catalogo { sistemas: Sistema[]; submotivos: Record<string, Submotivo[]>; estados: Estado[] }

export interface Incidente {
  id: string; clave: string; sistema: string; sistemaClave: string; submotivo: string;
  estado: string; estadoNombre: string; tono: string; afecta: boolean; cierra: boolean; estadoPublico: boolean;
  titulo: string; detalle: string;
  creado: string; creadoPor: string; creadoNombre: string;
  confirmado: string; confirmadoPor: string; confirmadoNombre: string;
  actualizado: string; cerrado: string; origen: string;
  /** Lo que había en la fila tal cual, para escribir solo si nadie la cambió entretanto. */
  crudo: { estado: string; actualizado: string };
}

// ── FECHAS E IDENTIFICADORES ───────────────────────────────────────────────────────────────────

/** opISO_: fecha → ISO, tolerando lo que haya en la columna (ISO, texto de la hoja o vacío). */
export const opISO = (v: unknown): string => aIso(v);

/** opMs_: milisegundos, o 0 si no es fecha. */
export function opMs(v: unknown): number {
  const d = aFecha(v);
  return d ? d.getTime() : 0;
}

/** opDiaClave_: AAAA-MM-DD en hora de México (la zona del proyecto de Apps Script). */
export function opDiaClave(v: unknown): string {
  const ms = opMs(v);
  return ms ? formatearFecha(ms, 'yyyy-MM-dd') : '';
}

/**
 * opHoraClave_: 'AAAA-MM-DD HH' en hora de México. Viaja como TEXTO y el cliente la rotula sin
 * pasar por new Date (doc 01 §9): por eso se formatea aquí y nunca con getHours(), que en el Worker
 * daría la hora UTC y movería el pico de las 11 a las 17.
 */
export function opHoraClave(v: unknown): string {
  const ms = opMs(v);
  return ms ? formatearFecha(ms, 'yyyy-MM-dd HH') : '';
}

/**
 * opEsSi_: ¿un Sí/No de la hoja dice que sí? Acepta 'Si', 'sí', 'x', true, 1 y también '1.0': D1
 * enlaza los números de JS como REAL, y en una columna TEXT un 1 se guarda como '1.0'.
 */
export function opEsSi(v: unknown): boolean {
  return esAfirmativo(v) || (v !== null && v !== '' && Number(v) === 1);
}

/** Sí/No para escribir en una columna TEXT (Aviso): texto, nunca número (ver opEsSi). */
export const opSiNo = (si: boolean): string => (si ? '1' : '0');

/** Identificador corto y ordenable en el tiempo (opId_): 'rep-…', 'inc-…', 'act-…'. */
export function opId(prefijo: string): string {
  return prefijo + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 46656).toString(36);
}

/** Título por omisión de un incidente. */
export function opTitulo(sistema: string, submotivo: string): string {
  if (submotivo) return sistema + ' · ' + submotivo;
  return 'Problemas con ' + sistema;
}

// ── CATÁLOGO (sistemas, submotivos y estados) ──────────────────────────────────────────────────

interface FilaCatalogo {
  tipo: string; sistema_clave: string; valor: string; clave: string; tono: string | null;
  creado: string | null; creado_por: string | null; activo: unknown; usos: number | null;
}

/**
 * Catálogo completo: lo fijo del código más lo que ha ido añadiendo el equipo. Lo de la tabla NUNCA
 * pisa a lo base («connect» escrito a mano es el Connect de siempre, no un duplicado con el que se
 * repartirían los reportes). Memo por petición; se olvida al escribir en el catálogo.
 */
export function opLeerCatalogo(ctx: Ctx): Promise<Catalogo> {
  return ctx.memorizar('op:cat', async () => {
    const filas = await ctx.todas<FilaCatalogo>(
      'SELECT tipo, sistema_clave, valor, clave, tono, creado, creado_por, activo, usos ' +
      'FROM operacion_catalogo ORDER BY rowid');
    // Una fila sin «Activo» cuenta como activa; solo un «No» explícito la retira de la lista.
    const activas = filas.filter((f) => {
      if (!String(f.valor || '').trim()) return false;
      return f.activo === null || f.activo === undefined || String(f.activo).trim() === '' || opEsSi(f.activo);
    });
    const tipo = (f: FilaCatalogo) => String(f.tipo || '').toLowerCase();

    // ── Sistemas ──
    const sistemas: Sistema[] = OP_SISTEMAS_BASE.map((s) => ({
      clave: s.clave, nombre: s.nombre, publico: s.publico, orden: s.orden, base: true, usos: 0
    }));
    const vistos: Record<string, Sistema> = {};
    sistemas.forEach((s) => { vistos[s.clave] = s; });
    activas.filter((f) => tipo(f) === 'sistema').forEach((f) => {
      const clave = String(f.clave || opClave(f.valor));
      if (vistos[clave]) { vistos[clave].usos += Number(f.usos) || 0; return; }
      const s: Sistema = {
        clave, nombre: opCapitalizar(String(f.valor).trim()), publico: false, orden: 50, base: false,
        usos: Number(f.usos) || 0, creado: opISO(f.creado), creadoPor: String(f.creado_por || '')
      };
      vistos[clave] = s;
      sistemas.push(s);
    });

    // ── Submotivos por sistema ──
    const submotivos: Record<string, Submotivo[]> = {};
    Object.keys(OP_SUBMOTIVOS_BASE).forEach((sis) => {
      submotivos[sis] = OP_SUBMOTIVOS_BASE[sis].map((v) => ({ valor: v, clave: opClave(v), base: true, usos: 0 }));
    });
    sistemas.forEach((s) => { if (!submotivos[s.clave]) submotivos[s.clave] = []; });
    activas.filter((f) => tipo(f) === 'submotivo').forEach((f) => {
      const sis = String(f.sistema_clave || '').trim();
      if (!sis) return;
      if (!submotivos[sis]) submotivos[sis] = [];
      const clave = String(f.clave || opClave(f.valor));
      const ya = submotivos[sis].filter((x) => x.clave === clave)[0];
      if (ya) { ya.usos += Number(f.usos) || 0; return; }
      submotivos[sis].push({
        valor: opCapitalizar(String(f.valor).trim()), clave, base: false,
        usos: Number(f.usos) || 0, creadoPor: String(f.creado_por || '')
      });
    });
    // Los más usados primero: la lista se ordena sola según lo que de verdad falla.
    Object.keys(submotivos).forEach((sis) => {
      submotivos[sis].sort((a, b) => (b.usos - a.usos) || a.valor.localeCompare(b.valor, 'es'));
    });

    // ── Estados ──
    const estados: Estado[] = OP_ESTADOS_BASE.map((e) => ({
      clave: e.clave, nombre: e.nombre, tono: e.tono, afecta: e.afecta, cierra: e.cierra,
      publico: e.publico, detalle: e.detalle, base: true
    }));
    const estadosVistos: Record<string, boolean> = {};
    estados.forEach((e) => { estadosVistos[e.clave] = true; });
    activas.filter((f) => tipo(f) === 'estado').forEach((f) => {
      const clave = String(f.clave || opClave(f.valor));
      if (estadosVistos[clave]) return;
      estadosVistos[clave] = true;
      const tono = TONOS.indexOf(String(f.tono)) !== -1 ? String(f.tono) : 'warn';
      estados.push({
        clave, nombre: opCapitalizar(String(f.valor).trim()), tono,
        // Un estado inventado cuenta como «algo pasa» salvo que se declare en verde o neutro.
        afecta: tono !== 'ok' && tono !== 'neutro',
        cierra: tono === 'ok' || tono === 'neutro',
        publico: tono !== 'neutro', detalle: '', base: false
      });
    });

    sistemas.sort((a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es'));
    return { sistemas, submotivos, estados };
  });
}

/** Busca un estado en el catálogo; si no existe, se trata como 'posible' (el primero). */
export function opEstado(catalogo: Catalogo, clave: unknown): Estado {
  const k = opClave(clave);
  return catalogo.estados.filter((e) => e.clave === k)[0] || catalogo.estados[0];
}

/** Busca un sistema por clave o por nombre escrito. */
export function opSistema(catalogo: Catalogo, valor: unknown): Sistema | null {
  const k = opClave(valor);
  return catalogo.sistemas.filter((s) => s.clave === k)[0] || null;
}

/**
 * Registra un valor nuevo en el catálogo, o suma un uso si ya estaba. Devuelve el valor definitivo:
 * si ya existía con esa clave, gana el que se guardó primero. Un UPSERT sustituye a «buscar la fila
 * y escribir la celda», y por eso dos usos simultáneos ya no pueden perder una suma.
 */
export async function opCatalogoRegistrar(ctx: Ctx, tipo: string, sistemaClave: string, valor: unknown,
                                          quien: string, tono?: string): Promise<string> {
  const limpio = opCapitalizar(opLimpiarTexto(valor, 60));
  if (!limpio) return '';
  const clave = opClave(limpio);
  if (!clave) return '';
  const fila = await ctx.una<{ valor: string }>(
    'INSERT INTO operacion_catalogo (tipo, sistema_clave, valor, clave, tono, creado, creado_por, activo, usos) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1) ' +
    'ON CONFLICT(tipo, sistema_clave, clave) DO UPDATE SET usos = COALESCE(operacion_catalogo.usos, 0) + 1, activo = 1 ' +
    'RETURNING valor',
    tipo, sistemaClave || '', limpio, clave, tono || '', ctx.ahoraIso(), quien || '');
  ctx.olvidar('op:cat');
  return String((fila && fila.valor) || limpio).trim();
}

/** Suma un uso a un valor que YA está en el catálogo (o lo da de alta si venía del código). */
export async function opCatalogoSumarUso(ctx: Ctx, tipo: string, sistemaClave: string, valor: unknown, quien: string): Promise<void> {
  try { await opCatalogoRegistrar(ctx, tipo, sistemaClave, valor, quien); } catch (e) {
    console.error('opCatalogoSumarUso', e);
  }
}

// ── INCIDENTES ─────────────────────────────────────────────────────────────────────────────────

export interface FilaIncidente {
  id: string; clave: string | null; sistema: string | null; sistema_clave: string | null; submotivo: string | null;
  estado: string | null; titulo: string | null; detalle: string | null;
  creado: string | null; creado_por: string | null; creado_nombre: string | null;
  confirmado: string | null; confirmado_por: string | null; confirmado_nombre: string | null;
  actualizado: string | null; actualizado_por: string | null; cerrado: string | null; origen: string | null;
}

/** opIncidenteDeFila_: la fila convertida en el objeto que usa todo el módulo. */
export function opIncidenteDeFila(f: FilaIncidente, catalogo: Catalogo): Incidente {
  const estado = opEstado(catalogo, f.estado);
  return {
    id: String(f.id || ''),
    clave: String(f.clave || ''),
    sistema: String(f.sistema || ''),
    sistemaClave: String(f.sistema_clave || ''),
    submotivo: String(f.submotivo || ''),
    estado: estado.clave,
    estadoNombre: estado.nombre,
    tono: estado.tono,
    afecta: estado.afecta,
    cierra: estado.cierra,
    estadoPublico: estado.publico,
    titulo: String(f.titulo || ''),
    detalle: String(f.detalle || ''),
    creado: opISO(f.creado),
    creadoPor: String(f.creado_por || ''),
    creadoNombre: String(f.creado_nombre || ''),
    confirmado: opISO(f.confirmado),
    confirmadoPor: String(f.confirmado_por || ''),
    confirmadoNombre: String(f.confirmado_nombre || ''),
    actualizado: opISO(f.actualizado),
    cerrado: opISO(f.cerrado),
    origen: String(f.origen || 'automatico'),
    crudo: { estado: f.estado == null ? '' : String(f.estado), actualizado: f.actualizado == null ? '' : String(f.actualizado) }
  };
}

/** Las claves de estado que cierran un incidente (base + las que inventó el equipo en verde/neutro). */
function clavesQueCierran(catalogo: Catalogo): string {
  return JSON.stringify(catalogo.estados.filter((e) => e.cierra).map((e) => e.clave));
}

/** Un incidente por id (o null). */
export async function opLeerIncidente(ctx: Ctx, catalogo: Catalogo, id: string): Promise<Incidente | null> {
  const f = await ctx.una<FilaIncidente>('SELECT * FROM operacion_incidentes WHERE id = ?', id);
  return f ? opIncidenteDeFila(f, catalogo) : null;
}

/**
 * Incidentes vivos (los que no han cerrado), en el orden en que se crearon (el de la hoja).
 *
 * El SQL solo descarta lo que seguro está cerrado; el filtro exacto se hace después con el catálogo,
 * igual que en el .gs (un estado desconocido se trata como 'posible' y por tanto sigue vivo).
 *
 * @param caducar true = antes apaga los «posible» abandonados (opCaducarPosibles_), como hacían
 *   todas las lecturas del .gs. Se hace al LEER y no con un disparador, por la misma razón de allá.
 */
export async function opIncidentesVivos(ctx: Ctx, catalogo: Catalogo, caducar = true): Promise<Incidente[]> {
  const leer = async () => (await ctx.todas<FilaIncidente>(
    "SELECT * FROM operacion_incidentes WHERE lower(trim(COALESCE(estado, ''))) NOT IN (SELECT value FROM json_each(?)) ORDER BY rowid",
    clavesQueCierran(catalogo)))
    .map((f) => opIncidenteDeFila(f, catalogo))
    .filter((i) => i.id && !i.cierra);

  const vivos = await leer();
  if (!caducar) return vivos;
  const apagados = await opCaducarPosibles(ctx, vivos);
  return apagados ? leer() : vivos;
}

/**
 * Apaga los «posible» que nadie confirmó y que dejaron de recibir reportes. Devuelve cuántos.
 *
 * Cada cierre va en un lote (transacción) y es CONDICIONAL: solo si la fila sigue exactamente como
 * se leyó. Así, dos pantallas que lean a la vez no dejan dos anotaciones de «se cerró solo», y un
 * reporte que llega en el mismo instante (que renueva `actualizado`) no se pierde contra el cierre.
 */
export async function opCaducarPosibles(ctx: Ctx, vivos: Incidente[]): Promise<number> {
  const limite = Date.now() - OP_HORAS_CADUCA_POSIBLE * 3600 * 1000;
  const pendientes = vivos.filter((i) => {
    if (i.estado !== 'posible' || i.confirmado) return false;
    const ultima = Math.max(opMs(i.actualizado), opMs(i.creado));
    return ultima && ultima < limite;
  });
  if (!pendientes.length) return 0;

  const horas = OP_HORAS_CADUCA_POSIBLE + (OP_HORAS_CADUCA_POSIBLE === 1 ? ' hora' : ' horas');
  for (const i of pendientes) {
    try {
      const ahora = ctx.ahoraIso();
      await ctx.lote([
        ["UPDATE operacion_incidentes SET estado = 'descartado', cerrado = ?, actualizado = ?, detalle = ? " +
         "WHERE id = ? AND COALESCE(estado, '') = ? AND COALESCE(actualizado, '') = ? AND COALESCE(confirmado, '') = ''",
         ahora, ahora, i.detalle || 'Se apagó solo: nadie lo confirmó y dejaron de llegar reportes.',
         i.id, i.crudo.estado, i.crudo.actualizado],
        // La anotación solo entra si el UPDATE de arriba fue el que cerró (lleva su sello exacto).
        ['INSERT INTO operacion_actualizaciones (id, incidente_id, fecha, autor, autor_nombre, estado, nota, aviso) ' +
         "SELECT ?, ?, ?, 'sistema', 'Sistema', 'descartado', ?, 0 " +
         "WHERE EXISTS (SELECT 1 FROM operacion_incidentes WHERE id = ? AND estado = 'descartado' AND cerrado = ?)",
         opId('act'), i.id, ahora, 'Sin reportes nuevos en ' + horas + ' y sin confirmar. Se cerró solo.', i.id, ahora]
      ]);
    } catch (e) {
      console.error('opCaducarPosibles (' + i.id + ')', e);
    }
  }
  return pendientes.length;
}

/**
 * Últimas actualizaciones por incidente. soloAvisadas = solo las que supervisión decidió anunciar:
 * una nota interna («ya llamé al proveedor») no es un comunicado.
 */
export async function opUltimasActualizaciones(ctx: Ctx, ids: string[], soloAvisadas: boolean):
    Promise<Record<string, { fecha: string; nota: string; estado: string }>> {
  const out: Record<string, { fecha: string; nota: string; estado: string }> = {};
  if (!ids || !ids.length) return out;
  const filas = await ctx.todas<{ incidente_id: string; fecha: string; nota: string; estado: string; aviso: unknown }>(
    'SELECT incidente_id, fecha, nota, estado, aviso FROM operacion_actualizaciones ' +
    'WHERE incidente_id IN (SELECT value FROM json_each(?)) ORDER BY rowid', JSON.stringify(ids));
  filas.forEach((f) => {
    const id = String(f.incidente_id || '');
    if (soloAvisadas && !opEsSi(f.aviso)) return;
    const nota = String(f.nota || '').trim();
    if (!nota) return;
    const fecha = opISO(f.fecha);
    if (!out[id] || fecha > out[id].fecha) out[id] = { fecha, nota, estado: String(f.estado || '') };
  });
  return out;
}

// ── CANDADO (lo que era LockService.getScriptLock) ─────────────────────────────────────────────

/** Vida máxima de un candado: si quien lo tiene se cae, a los 15 s queda libre solo. */
const CANDADO_VIDA_MS = 15000;

export class CandadoOcupado extends Error {
  constructor() { super('El sistema está ocupado. Vuelve a intentarlo.'); }
}

/**
 * Ejecuta `fn` con el candado `clave` tomado (lock.waitLock(espera) + releaseLock()).
 *
 * Tomar es un UPSERT condicional: entra quien inserta la fila o quien la encuentra caducada; D1
 * ejecuta las sentencias de una en una, así que dos peticiones nunca lo toman a la vez. Si no se
 * consigue en `esperaMs`, lanza CandadoOcupado (lo mismo que hacía waitLock al agotar la espera).
 */
export async function conCandado<T>(ctx: Ctx, clave: string, esperaMs: number, fn: () => Promise<T>): Promise<T> {
  const dueno = uuid();
  const limite = Date.now() + esperaMs;
  let pausa = 20;
  for (;;) {
    const ahora = Date.now();
    const fila = await ctx.una<{ dueno: string }>(
      'INSERT INTO operacion_candados (clave, dueno, expira) VALUES (?, ?, ?) ' +
      'ON CONFLICT(clave) DO UPDATE SET dueno = excluded.dueno, expira = excluded.expira ' +
      'WHERE operacion_candados.expira <= ? RETURNING dueno',
      clave, dueno, ahora + CANDADO_VIDA_MS, ahora);
    if (fila && fila.dueno === dueno) break;
    if (Date.now() + pausa > limite) throw new CandadoOcupado();
    await new Promise((r) => setTimeout(r, pausa + Math.floor(Math.random() * pausa)));
    pausa = Math.min(250, Math.round(pausa * 1.6));
  }
  try {
    return await fn();
  } finally {
    try {
      await ctx.ejecutar('DELETE FROM operacion_candados WHERE clave = ? AND dueno = ?', clave, dueno);
    } catch (e) {
      console.error('conCandado: no se pudo soltar ' + clave, e);
    }
  }
}

// ── AVISOS A GOOGLE CHAT (no-op en esta versión) ───────────────────────────────────────────────

/** Fecha corta en español para los avisos («6 de octubre, 14:30»). */
function fechaAviso(iso: string): string {
  const d = aFecha(iso);
  if (!d) return '';
  const mes = Number(formatearFecha(d, 'M'));
  return formatearFecha(d, 'd') + ' de ' + MESES_ES[mes - 1] + ', ' + formatearFecha(d, 'HH:mm');
}

/**
 * opAvisarReporte_: aviso de un reporte suelto al espacio de reportes. Los webhooks de Chat son un
 * servicio de Google que esta versión deja fuera: el mensaje se arma igual y se escribe en la consola.
 */
export function opAvisarReporte(datos: {
  reporteId: string; sistema: string; submotivo: string; nombre: string; correo: string; notas: string;
  evidencias: number; incidente: Incidente | null; nuevo: boolean;
}): void {
  const partes = ['*Reporte de falla* · ' + datos.sistema + ' · ' + datos.submotivo];
  partes.push('Reportó: ' + (datos.nombre || datos.correo));
  if (datos.notas) partes.push('Notas: ' + datos.notas.substring(0, 300));
  if (datos.evidencias) partes.push('Capturas adjuntas: ' + datos.evidencias);
  if (datos.incidente) {
    partes.push(datos.nuevo
      ? 'Con este reporte se levantó una incidencia automática.'
      : 'Se sumó a la incidencia «' + (datos.incidente.titulo || datos.incidente.submotivo) + '».');
  } else {
    partes.push('Todavía no hay suficientes reportes para levantar una incidencia.');
  }
  console.log('[operación] Aviso a Chat NO enviado (sin webhooks en esta versión):\n' + partes.join('\n'));
}

/** opAvisarEstado_: comunicado del estado al equipo. Igual: se arma y se registra en la consola. */
export function opAvisarEstado(incidente: Incidente, opciones: { nota?: string; autor?: string; autoDetectado?: boolean; cambioDeEstado?: boolean }): boolean {
  const titulo = incidente.titulo || opTitulo(incidente.sistema, incidente.submotivo);
  const encabezados: Record<string, string> = {
    posible: 'Posible problema', confirmado: 'Falla confirmada', intermitencia: 'Intermitencia',
    mantenimiento: 'Mantenimiento', resuelto: 'Restablecido', descartado: 'Falsa alarma'
  };
  const partes = ['*' + (encabezados[incidente.estado] || incidente.estadoNombre) + '* · ' + incidente.sistema, titulo];
  if (opciones.nota) partes.push('_' + String(opciones.nota).substring(0, 500) + '_');
  const desde = incidente.confirmado || incidente.creado;
  if (desde) partes.push('Desde: ' + fechaAviso(desde) + ' h');
  if (opciones.autor) partes.push('Actualizó: ' + opciones.autor);
  console.log('[operación] Comunicado a Chat NO enviado (sin webhooks en esta versión):\n' + partes.join('\n'));
  return false;
}
