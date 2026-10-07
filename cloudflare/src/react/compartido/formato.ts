/** Formato de cifras en español de México (1,234 · 38 ms · 1.24 s · 12.5 KB). */

const ENTERO = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const UNO = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DOS = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function numero(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : ENTERO.format(n);
}

/** Milisegundos legibles: «38 ms» por debajo de un segundo; «1.24 s» o «13.0 s» por encima. */
export function tiempo(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 10 && ms % 1 !== 0) return UNO.format(ms) + ' ms';
  if (ms < 1000) return ENTERO.format(Math.round(ms)) + ' ms';
  return (ms < 10000 ? DOS.format(ms / 1000) : UNO.format(ms / 1000)) + ' s';
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return ENTERO.format(n) + ' B';
  if (n < 1024 * 1024) return UNO.format(n / 1024) + ' KB';
  return UNO.format(n / 1024 / 1024) + ' MB';
}

/** «52×» o «3.4×»: cuántas veces cabe lo rápido en lo lento. */
export function veces(lento: number, rapido: number): string {
  if (!(rapido > 0) || !(lento > 0)) return '';
  const v = lento / rapido;
  return (v >= 10 ? ENTERO.format(Math.round(v)) : UNO.format(v)) + '×';
}

export function mediana(valores: number[]): number | null {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const FECHA_HORA = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
});
const HORA = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });

export function fechaHora(iso: string | number | null | undefined): string {
  const t = typeof iso === 'number' ? iso : Date.parse(String(iso || ''));
  return Number.isFinite(t) ? FECHA_HORA.format(t) : String(iso || '');
}

export function hora(iso: string | number | null | undefined): string {
  const t = typeof iso === 'number' ? iso : Date.parse(String(iso || ''));
  return Number.isFinite(t) ? HORA.format(t) : '';
}

/** «hace 3 min», «hace 2 h», o la fecha si ya pasó más de un día. */
export function haceCuanto(iso: string | null | undefined): string {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'hace un momento';
  if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
  return fechaHora(t);
}
