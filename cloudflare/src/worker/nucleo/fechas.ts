/**
 * Fechas en hora de México | Portal Ventel en Cloudflare
 * ======================================================
 * El proyecto de Apps Script tenía timeZone = America/Mexico_City: TODAS las fechas del servidor
 * se formateaban en hora de México (Utilities.formatDate). En un Worker el reloj es UTC, así que
 * nada se formatea con getHours()/getDate() a pelo: se usa esto.
 *
 *   formatearFecha(fecha, 'dd/MM/yyyy HH:mm')   ≡ Utilities.formatDate(fecha, 'America/Mexico_City', …)
 *   partesMx(fecha)                             → { anio, mes, dia, hora, minuto, segundo, diaSemana }
 *   fechaDesdeMx(2026, 10, 6, 14, 30)           → Date (esa hora LOCAL de México)
 *   aFecha(valor)                               → Date | null (ISO, ms, Date o 'dd/MM/yyyy HH:mm:ss')
 *
 * El patrón es el de Java SimpleDateFormat (el de Utilities.formatDate): yyyy yy MMMM MMM MM M dd d
 * EEEE EEE HH H hh h mm m ss s SSS a Z X y texto entre comillas simples. Los nombres de mes y día
 * salen en INGLÉS, igual que en Apps Script; para español están MESES_ES y DIAS_ES.
 */
export const ZONA_MX = 'America/Mexico_City';

export const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MESES_CORTOS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const MESES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];
const DIAS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const formateadores = new Map<string, Intl.DateTimeFormat>();
function formateador(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
    });
    formateadores.set(zona, f);
  }
  return f;
}

export interface PartesFecha {
  anio: number; mes: number; dia: number; hora: number; minuto: number; segundo: number;
  ms: number; diaSemana: number; desfaseMin: number;
}

const DIAS_CORTOS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Componentes de la fecha en la zona dada (mes 1–12, diaSemana 0=domingo). */
export function partesMx(fecha: Date | string | number, zona = ZONA_MX): PartesFecha {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  const p: Record<string, string> = {};
  for (const x of formateador(zona).formatToParts(d)) p[x.type] = x.value;
  const anio = Number(p.year), mes = Number(p.month), dia = Number(p.day);
  const hora = Number(p.hour) % 24, minuto = Number(p.minute), segundo = Number(p.second);
  const comoUtc = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo);
  const desfaseMin = Math.round((comoUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  return { anio, mes, dia, hora, minuto, segundo, ms: d.getUTCMilliseconds(),
           diaSemana: DIAS_CORTOS_EN.indexOf(p.weekday), desfaseMin };
}

/** La fecha que corresponde a esa hora LOCAL de México (mes 1–12). */
export function fechaDesdeMx(anio: number, mes: number, dia: number, hora = 0, minuto = 0, segundo = 0, ms = 0, zona = ZONA_MX): Date {
  const supuesta = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo, ms);
  // Dos pasadas bastan para cualquier zona (México no tiene horario de verano desde 2022).
  let t = supuesta - partesMx(new Date(supuesta), zona).desfaseMin * 60000;
  t = supuesta - partesMx(new Date(t), zona).desfaseMin * 60000;
  return new Date(t);
}

/** Medianoche (hora de México) del día de `fecha`, desplazada `dias` días. */
export function inicioDelDiaMx(fecha: Date | string | number = new Date(), dias = 0): Date {
  const p = partesMx(fecha);
  return fechaDesdeMx(p.anio, p.mes, p.dia + dias);
}

const dos = (n: number) => String(n).padStart(2, '0');

/** Utilities.formatDate(fecha, zona, patrón), con la zona de México por omisión. */
export function formatearFecha(fecha: Date | string | number | null | undefined, patron: string, zona = ZONA_MX): string {
  const d = aFecha(fecha);
  if (!d) return '';
  const p = partesMx(d, zona);
  let out = '';
  let i = 0;
  while (i < patron.length) {
    const c = patron[i];
    if (c === "'") {
      const fin = patron.indexOf("'", i + 1);
      if (fin === i + 1) { out += "'"; i += 2; continue; }
      out += patron.slice(i + 1, fin === -1 ? patron.length : fin);
      i = fin === -1 ? patron.length : fin + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(c)) { out += c; i++; continue; }
    let n = 1;
    while (patron[i + n] === c) n++;
    i += n;
    switch (c) {
      case 'y': out += n === 2 ? dos(p.anio % 100) : String(p.anio).padStart(n, '0'); break;
      case 'M': out += n >= 4 ? MESES_EN[p.mes - 1] : n === 3 ? MESES_EN[p.mes - 1].slice(0, 3) : String(p.mes).padStart(n, '0'); break;
      case 'd': out += String(p.dia).padStart(n, '0'); break;
      case 'E': out += n >= 4 ? DIAS_EN[p.diaSemana] : DIAS_EN[p.diaSemana].slice(0, 3); break;
      case 'u': out += String(p.diaSemana === 0 ? 7 : p.diaSemana); break;
      case 'H': out += String(p.hora).padStart(n, '0'); break;
      case 'k': out += String(p.hora === 0 ? 24 : p.hora).padStart(n, '0'); break;
      case 'h': out += String(p.hora % 12 === 0 ? 12 : p.hora % 12).padStart(n, '0'); break;
      case 'K': out += String(p.hora % 12).padStart(n, '0'); break;
      case 'm': out += String(p.minuto).padStart(n, '0'); break;
      case 's': out += String(p.segundo).padStart(n, '0'); break;
      case 'S': out += String(p.ms).padStart(3, '0').slice(0, Math.max(n, 3)).padEnd(n, '0'); break;
      case 'a': out += p.hora < 12 ? 'AM' : 'PM'; break;
      case 'Z': case 'X': {
        const s = p.desfaseMin < 0 ? '-' : '+';
        const a = Math.abs(p.desfaseMin);
        out += s + dos(Math.floor(a / 60)) + (c === 'X' && n >= 3 ? ':' : '') + dos(a % 60);
        break;
      }
      case 'z': out += 'CST'; break;
      default: out += c.repeat(n);
    }
  }
  return out;
}

/**
 * Convierte lo que venga a Date, o null. Acepta Date, milisegundos, ISO ('2026-10-06T20:14:17Z' o
 * sin zona, que se toma como hora de México), y el texto que dejaba Sheets: 'dd/MM/yyyy[ HH:mm[:ss]]'
 * en hora de México.
 */
export function aFecha(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return fechaDesdeMx(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
  if (m) return fechaDesdeMx(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +((m[7] || '0').padEnd(3, '0')));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** ISO UTC de lo que venga (o '' si no es fecha): para guardar en D1. */
export function aIso(v: unknown): string {
  const d = aFecha(v);
  return d ? d.toISOString() : '';
}
