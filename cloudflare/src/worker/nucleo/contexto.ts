/**
 * Contexto de una petición | Portal Ventel en Cloudflare
 * ======================================================
 * En Apps Script cada google.script.run era una ejecución con globales propias (SEC_SESION_,
 * SEC_ENTRADA_, los índices en memoria…). Aquí todo eso viaja en `ctx`, que reciben TODAS las
 * funciones del servidor como primer argumento:
 *
 *     export async function getQuotesForUser(ctx: Ctx, email: string) { … }
 *
 * Acceso a D1 (sustituye a SpreadsheetApp):
 *     await ctx.todas('SELECT … WHERE a = ?', a)      → filas (arreglo de objetos)
 *     await ctx.una('SELECT … WHERE folio = ?', f)    → una fila o null
 *     await ctx.ejecutar('UPDATE …', x, y)            → { cambios, ultimoId }
 *     await ctx.lote([['INSERT …', a], ['UPDATE …', b]])  → varias en UNA ida (y en transacción)
 * Los parámetros se adaptan solos: undefined → null, booleano → 1/0, Date → ISO, objeto → JSON.
 */
import type { Env } from '../tipos';

export type Sesion = { email: string };

type Valor = string | number | null | ArrayBuffer;

function adaptar(v: unknown): Valor {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (v instanceof ArrayBuffer) return v;
  if (typeof v === 'bigint') return Number(v);
  return JSON.stringify(v);
}

export class Ctx {
  readonly env: Env;
  readonly db: D1Database;
  /** Hora en que empezó la petición (ms). */
  readonly inicio: number;
  /** Origen público de la petición, p. ej. https://ventel.logidma.com */
  readonly origen: string;
  /** Sesión validada en ESTA petición (lo que en Apps Script era SEC_SESION_). */
  sesion: Sesion | null = null;
  /** Cómo entró la petición: 'secEjecutar' (canal), 'directa' o null. */
  entrada: 'secEjecutar' | 'directa' | null = null;
  /** Consultas hechas en esta petición (para medir). */
  consultas = 0;

  private readonly exec: ExecutionContext | null;
  private readonly memo = new Map<string, Promise<unknown>>();

  constructor(env: Env, exec: ExecutionContext | null, origen: string) {
    this.env = env;
    this.db = env.DB;
    this.exec = exec;
    this.origen = origen.replace(/\/$/, '');
    this.inicio = Date.now();
  }

  /** Fecha actual. */
  ahora(): Date { return new Date(); }
  /** Fecha actual en ISO UTC: el formato de todas las columnas de fecha. */
  ahoraIso(): string { return new Date().toISOString(); }

  /** Trabajo que puede terminar después de contestar (métricas, limpiezas). */
  despues(p: Promise<unknown>): void {
    const seguro = p.catch((e) => console.error('[despues]', e));
    if (this.exec) this.exec.waitUntil(seguro);
  }

  /**
   * Memo por petición: la misma lectura pedida dos veces en una llamada se hace una vez (lo que
   * en Apps Script hacía SEC_REGISTROS_CACHE). Se borra sola al acabar la petición.
   */
  memorizar<T>(clave: string, f: () => Promise<T>): Promise<T> {
    if (!this.memo.has(clave)) this.memo.set(clave, f());
    return this.memo.get(clave) as Promise<T>;
  }
  olvidar(prefijo = ''): void {
    for (const k of [...this.memo.keys()]) if (k.startsWith(prefijo)) this.memo.delete(k);
  }

  private preparar(sql: string, params: unknown[]): D1PreparedStatement {
    const st = this.db.prepare(sql);
    return params.length ? st.bind(...params.map(adaptar)) : st;
  }

  async todas<T = Record<string, any>>(sql: string, ...params: unknown[]): Promise<T[]> {
    this.consultas++;
    const r = await this.preparar(sql, params).all<T>();
    return r.results || [];
  }

  async una<T = Record<string, any>>(sql: string, ...params: unknown[]): Promise<T | null> {
    this.consultas++;
    return (await this.preparar(sql, params).first<T>()) ?? null;
  }

  async ejecutar(sql: string, ...params: unknown[]): Promise<{ cambios: number; ultimoId: number }> {
    this.consultas++;
    const r = await this.preparar(sql, params).run();
    return { cambios: r.meta?.changes ?? 0, ultimoId: Number(r.meta?.last_row_id ?? 0) };
  }

  /** Varias sentencias en una sola ida a D1, en transacción (todas o ninguna). */
  async lote(sentencias: Array<[string, ...unknown[]]>): Promise<Array<{ filas: any[]; cambios: number }>> {
    if (!sentencias.length) return [];
    this.consultas++;
    const rs = await this.db.batch(sentencias.map(([sql, ...p]) => this.preparar(sql, p)));
    return rs.map((r) => ({ filas: (r.results as any[]) || [], cambios: r.meta?.changes ?? 0 }));
  }

  /** Una sentencia preparada, para armar lotes a mano. */
  sentencia(sql: string, ...params: unknown[]): D1PreparedStatement {
    return this.preparar(sql, params);
  }
}
