/**
 * AUDITORÍA AUTOMÁTICA DE COTIZACIONES | Portal Ventel en Cloudflare
 * =================================================================
 * Port de AuditoriaCotizacion.gs, regla por regla y con los mismos textos.
 *
 * POR QUÉ EXISTE
 * La lista de verificación de la pantalla de revisión era una fila de casillas que alguien tenía que
 * ir palomeando. Una casilla que solo se puede marcar "sí" no verifica nada: mide paciencia, no
 * calidad. Todo lo que se puede comprobar con una regla —que el correo exista como dirección, que el
 * asesor venga con nombre y apellido, que el IVA cuadre— lo comprueba este módulo, y el supervisor
 * solo decide sobre lo que de verdad necesita criterio humano.
 *
 * QUÉ ES Y QUÉ NO ES
 *   · SÍ: reglas deterministas, explicables y reproducibles. El mismo dato da siempre el mismo veredicto.
 *   · NO: un modelo estadístico que "adivina". En una pantalla que autoriza documentos que van al
 *     cliente, un veredicto que no se puede explicar es peor que no tener veredicto.
 *
 * LOS MODELOS QUE USA (y por qué esos)
 *   · Correo → gramática de RFC 5322 recortada a lo que se usa en la práctica + distancia de
 *     DAMERAU-LEVENSHTEIN contra los dominios frecuentes ("gmial.com", "hotmial.com").
 *   · Nombres → normalización Unicode + capitalización del español con lista de partículas.
 *   · Teléfono → plan de numeración de México (10 dígitos) más detección de rellenos.
 *   · Dinero → comparación con TOLERANCIA (épsilon), nunca con `===`.
 *   · Descuentos atípicos → PUNTUACIÓN Z MODIFICADA sobre la mediana y la MAD.
 *   · Descripción contra la ficha del sitio → COEFICIENTE DE DICE sobre bigramas.
 *
 * DÓNDE VIVE LA VERDAD
 * Este módulo NO lee la base ni la red: recibe datos y devuelve un dictamen. Por eso la misma función
 * corre al abrir la revisión Y al guardarla, que es lo que impide que el cliente mienta sobre lo que
 * se verificó.
 */
import { aFecha } from '../../nucleo/fechas';

// ─────────────────────────────────────────────────────────────────────────────────────────
// VOCABULARIO
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Estados de un punto de verificación, en orden de gravedad creciente:
 *   ok        · la regla se cumplió. NO necesita que nadie lo palomee.
 *   pendiente · la comprobación automática está en marcha (precios contra el sitio).
 *   manual    · no se puede automatizar con lo que hay. Pide criterio humano explícito.
 *   atencion  · algo no encaja pero puede ser legítimo (una razón social, un descuento alto).
 *   mal       · la regla se rompió. Aprobar así exige escribir por qué.
 */
export const AUD_ESTADOS = ['ok', 'pendiente', 'manual', 'atencion', 'mal'];

/** Peso de cada punto en el índice de confianza. Suman 100. */
const AUD_PESOS: Record<string, number> = {
  'cliente-nombre': 8,
  'cliente-correo': 14,
  'cliente-telefono': 8,
  'asesor': 8,
  'precios': 22,
  'totales': 22,
  'articulos': 12,
  'vigencia': 6
};

/** Cuánto de su peso pierde un punto según cómo quedó. */
const AUD_CASTIGO: Record<string, number> = { ok: 0, pendiente: 0.15, manual: 0.35, atencion: 0.55, mal: 1 };

/** Dominios frecuentes: solo ANCLA para detectar erratas por cercanía; no estar aquí no invalida. */
const AUD_DOMINIOS_COMUNES = [
  'gmail.com', 'hotmail.com', 'hotmail.es', 'hotmail.com.mx', 'outlook.com', 'outlook.es',
  'outlook.com.mx', 'yahoo.com', 'yahoo.com.mx', 'yahoo.es', 'live.com', 'live.com.mx',
  'icloud.com', 'me.com', 'msn.com', 'aol.com', 'prodigy.net.mx', 'liverpool.com.mx'
];

/** Correos de usar y tirar: válidos, pero el cliente no volverá a leer ahí. */
const AUD_DOMINIOS_DESECHABLES = [
  'mailinator.com', 'yopmail.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com',
  'trashmail.com', 'sharklasers.com', 'getnada.com', 'maildrop.cc'
];

/** Buzones de área, no de persona. Llegan, pero nadie los contesta. */
const AUD_BUZONES_GENERICOS = [
  'info', 'ventas', 'contacto', 'noreply', 'no-reply', 'admin', 'soporte', 'facturacion',
  'cobranza', 'atencion', 'compras'
];

/** Partículas que en español van en minúscula dentro de un nombre. */
const AUD_PARTICULAS = ['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos', 'van', 'von', 'di'];

/** Palabras que delatan una razón social: cambian el criterio del nombre del cliente. */
const AUD_MARCAS_EMPRESA = [
  'sa', 'sadecv', 'srl', 'sc', 'sapi', 'scv', 'spr', 'ac', 'sofom', 'grupo', 'corporativo',
  'comercializadora', 'distribuidora', 'servicios', 'industrias', 'constructora'
];

/** IVA vigente. Los precios de la cotización SIEMPRE lo llevan incluido. */
const AUD_IVA = 0.16;

export interface PuntoAuditoria {
  id: string;
  texto: string;
  estado: string;
  detalle: string;
  auto: boolean;
  peso: number;
  sugerencia: string;
  evidencia: Array<Record<string, unknown>>;
  [extra: string]: any;
}

export interface Dictamen {
  puntos: PuntoAuditoria[];
  score: number | null;
  resumen: string;
  criticas: string[];
  automaticos: number;
  pendientes: number;
  porRevisar: number;
  degradada?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// UTILIDADES DE TEXTO
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Texto recortado y con los espacios internos colapsados (también el espacio duro). */
export function audLimpiar(s: unknown): string {
  return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, ' ').trim();
}

/** Minúsculas sin acentos ni diacríticos: la forma en que se comparan nombres y dominios. */
export function audPlano(s: unknown): string {
  let t = String(s == null ? '' : s);
  // El rango se escribe con escapes, no con los caracteres combinantes: guardado en otra
  // codificación, el archivo dejaría de quitar acentos sin avisar (mismo cuidado que en Apps Script).
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch {
    t = t.replace(/[áàäâã]/gi, 'a').replace(/[éèëê]/gi, 'e').replace(/[íìïî]/gi, 'i')
      .replace(/[óòöôõ]/gi, 'o').replace(/[úùüû]/gi, 'u').replace(/ñ/gi, 'n');
  }
  return t.toLowerCase().trim();
}

/**
 * Distancia de Damerau-Levenshtein (con transposición de adyacentes). La transposición es la razón
 * de usar esta y no la Levenshtein clásica: "gmial" es UNA operación, no dos.
 */
export function audDistancia(a: unknown, b: unknown): number {
  const s = String(a || ''), t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const d: number[][] = [];
  for (let i = 0; i <= s.length; i++) d[i] = [i];
  for (let j = 0; j <= t.length; j++) d[0][j] = j;

  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const costo = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && s.charAt(i - 1) === t.charAt(j - 2) && s.charAt(i - 2) === t.charAt(j - 1)) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[s.length][t.length];
}

/** Coeficiente de Dice sobre bigramas: 0 = nada que ver, 1 = idénticos. Tolera orden y palabras de más. */
export function audSimilitud(a: unknown, b: unknown): number {
  const x = audPlano(a).replace(/[^a-z0-9 ]/g, ''), y = audPlano(b).replace(/[^a-z0-9 ]/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;

  const bigramas = (s: string) => {
    const m: Record<string, number> = {};
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.substr(i, 2);
      m[g] = (m[g] || 0) + 1;
    }
    return m;
  };
  const ma = bigramas(x), mb = bigramas(y);
  let comunes = 0, na = 0, nb = 0;
  Object.keys(ma).forEach((g) => { na += ma[g]; if (mb[g]) comunes += Math.min(ma[g], mb[g]); });
  Object.keys(mb).forEach((g) => { nb += mb[g]; });
  return (na + nb) ? (2 * comunes) / (na + nb) : 0;
}

/** Mediana de una lista de números (no la modifica). */
export function audMediana(nums: unknown[]): number {
  const v = (nums || []).filter((n): n is number => typeof n === 'number' && isFinite(n))
    .slice().sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Índices de los valores atípicos por PUNTUACIÓN Z MODIFICADA (Iglewicz & Hoaglin):
 *   z_i = 0.6745 · (x_i − mediana) / MAD, se marca cuando |z_i| > umbral (3.5 por convención).
 * La media y la desviación estándar se contaminan con el propio valor raro; la mediana y la MAD no.
 * Con menos de 4 datos no se evalúa: no hay "normal" contra el que comparar.
 */
export function audAtipicos(nums: unknown[], umbral?: number): number[] {
  const v = (nums || []).map((n) => Number(n) || 0);
  if (v.length < 4) return [];
  const med = audMediana(v);
  const desv = v.map((n) => Math.abs(n - med));
  const mad = audMediana(desv);
  const u = umbral || 3.5;

  // MAD 0 = más de la mitad de los valores son idénticos: "atípico" es entonces "distinto de todos".
  if (mad === 0) {
    return v.map((n, i) => ({ n, i })).filter((o) => Math.abs(o.n - med) > 1e-9).map((o) => o.i);
  }
  const fuera: number[] = [];
  v.forEach((n, i) => { if (Math.abs(0.6745 * (n - med) / mad) > u) fuera.push(i); });
  return fuera;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// CORREO ELECTRÓNICO
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Valida una dirección de correo y, si parece una errata, propone la corrección. Se valida lo que de
 * verdad circula (lo que un servidor de correo aceptará), no el RFC 5322 al pie de la letra.
 */
export function audValidarCorreo(correo: unknown) {
  const bruto = String(correo == null ? '' : correo).trim();
  const r = { estado: 'ok', mensaje: '', sugerencia: '', dominio: '', detalles: [] as string[] };

  if (!bruto) {
    r.estado = 'mal';
    r.mensaje = 'La cotización no tiene correo del cliente: no hay a dónde enviarla.';
    return r;
  }
  if (/[\s]/.test(bruto)) {
    r.estado = 'mal';
    r.mensaje = 'El correo tiene espacios en medio.';
    r.sugerencia = bruto.replace(/\s+/g, '');
    return r;
  }
  const partes = bruto.split('@');
  if (partes.length !== 2 || !partes[0] || !partes[1]) {
    r.estado = 'mal';
    r.mensaje = 'No tiene la forma nombre@dominio.';
    return r;
  }

  const local = partes[0];
  const dominio = partes[1].toLowerCase();
  r.dominio = dominio;

  if (local.length > 64) {
    r.estado = 'mal'; r.mensaje = 'La parte anterior a la @ es demasiado larga.'; return r;
  }
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) {
    r.estado = 'mal';
    r.mensaje = 'La parte anterior a la @ tiene caracteres que no se admiten (acentos, ñ o símbolos).';
    // Un acento en el correo casi siempre es el teclado, no la intención del cliente.
    const limpio = audPlano(local).replace(/[^a-z0-9.!#$%&'*+/=?^_`{|}~-]/g, '');
    if (limpio) r.sugerencia = limpio + '@' + dominio;
    return r;
  }
  if (local.charAt(0) === '.' || local.charAt(local.length - 1) === '.' || local.indexOf('..') > -1) {
    r.estado = 'mal'; r.mensaje = 'La parte anterior a la @ tiene puntos mal colocados.'; return r;
  }

  if (dominio.length > 255 || dominio.indexOf('.') === -1) {
    r.estado = 'mal'; r.mensaje = 'El dominio no es una dirección completa (le falta el .com, .mx…).'; return r;
  }
  const etiquetas = dominio.split('.');
  for (let i = 0; i < etiquetas.length; i++) {
    const e = etiquetas[i];
    if (!e || e.length > 63 || !/^[a-z0-9-]+$/.test(e) || e.charAt(0) === '-' || e.charAt(e.length - 1) === '-') {
      r.estado = 'mal'; r.mensaje = 'El dominio "' + dominio + '" no es válido.'; return r;
    }
  }
  const tld = etiquetas[etiquetas.length - 1];
  if (!/^[a-z]{2,24}$/.test(tld)) {
    r.estado = 'mal'; r.mensaje = 'La terminación del dominio (.' + tld + ') no es válida.'; return r;
  }

  // A partir de aquí la dirección es VÁLIDA. Lo que sigue son avisos, no errores.
  if (AUD_DOMINIOS_DESECHABLES.indexOf(dominio) > -1) {
    r.estado = 'atencion';
    r.mensaje = 'Es un correo temporal (' + dominio + '): el cliente no volverá a leer ahí.';
    return r;
  }
  if (AUD_BUZONES_GENERICOS.indexOf(audPlano(local)) > -1) {
    r.estado = 'atencion';
    r.mensaje = 'Es un buzón de área ("' + local + '@"), no de una persona. Confirma que ahí lo van a leer.';
    return r;
  }

  if (AUD_DOMINIOS_COMUNES.indexOf(dominio) === -1) {
    let mejor = '', dist = 99;
    AUD_DOMINIOS_COMUNES.forEach((d) => {
      const x = audDistancia(dominio, d);
      if (x < dist) { dist = x; mejor = d; }
    });
    // Umbral 1-2 y solo si el dominio tecleado es tan largo como el candidato: sin esa condición,
    // "uas.mx" se "corregiría" a "aol.com" y se estaría inventando un cliente.
    if (dist > 0 && dist <= 2 && Math.abs(dominio.length - mejor.length) <= 2 && dominio.length >= 5) {
      r.estado = 'atencion';
      r.mensaje = '"' + dominio + '" se parece mucho a "' + mejor + '". Si fue una errata, el correo nunca llegará.';
      r.sugerencia = local + '@' + mejor;
      return r;
    }
  }

  r.mensaje = 'Dirección válida' + (AUD_DOMINIOS_COMUNES.indexOf(dominio) > -1 ? ' y de un dominio conocido.' : '.');
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// NOMBRES DE PERSONA
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Capitaliza un nombre como se escribe en español: inicial mayúscula salvo las partículas (que sí se
 * capitalizan si abren el nombre). Respeta los apóstrofos (O'Brien) y los guiones (Pérez-Gómez).
 */
export function audCapitalizarNombre(nombre: unknown): string {
  const limpio = audLimpiar(nombre);
  if (!limpio) return '';
  return limpio.split(' ').map((palabra, i) => {
    const plano = audPlano(palabra);
    if (i > 0 && AUD_PARTICULAS.indexOf(plano) > -1) return plano;
    return palabra.split(/([-'\u2019])/).map((trozo) => {
      if (trozo.length <= 1 && /[-'\u2019]/.test(trozo)) return trozo;
      if (!trozo) return trozo;
      return trozo.charAt(0).toUpperCase() + trozo.slice(1).toLowerCase();
    }).join('');
  }).join(' ');
}

/** Palabras "de peso" de un nombre: las que no son partículas ni iniciales sueltas. */
function audPalabrasNombre(nombre: unknown): string[] {
  return audLimpiar(nombre).split(' ').filter((p) => {
    if (!p) return false;
    if (AUD_PARTICULAS.indexOf(audPlano(p)) > -1) return false;
    if (/^[A-Za-zÁÉÍÓÚÑáéíóúñ]\.?$/.test(p)) return false;   // inicial suelta
    return true;
  });
}

/**
 * "Nombre + apellido" de un nombre completo (nombre(s) + paterno + materno en México):
 *   2 palabras → tal cual   3 → primera + segunda   4 → primera + tercera   5+ → primera + penúltima.
 * Es una heurística: se ofrece como SUGERENCIA, nunca como corrección automática.
 */
function audNombreYApellido(palabras: string[]): string {
  const p = palabras || [];
  if (p.length <= 2) return audCapitalizarNombre(p.join(' '));
  if (p.length === 3) return audCapitalizarNombre(p[0] + ' ' + p[1]);
  if (p.length === 4) return audCapitalizarNombre(p[0] + ' ' + p[2]);
  return audCapitalizarNombre(p[0] + ' ' + p[p.length - 2]);
}

/** ¿El texto parece una razón social y no una persona? */
function audPareceEmpresa(nombre: unknown): boolean {
  const plano = audPlano(nombre).replace(/[.,]/g, '');
  if (/\b(s\s?a\s?de\s?c\s?v|sa de cv|s de rl|sapi|sofom)\b/.test(plano)) return true;
  const palabras = plano.split(' ');
  for (let i = 0; i < palabras.length; i++) {
    if (AUD_MARCAS_EMPRESA.indexOf(palabras[i]) > -1) return true;
  }
  return false;
}

/** Revisa cómo está ESCRITO un nombre de persona. */
export function audValidarNombrePersona(nombre: unknown, op?: { minPalabras?: number; maxPalabras?: number; quien?: string; exigirExacto?: boolean }) {
  const o = op || {};
  const quien = o.quien || 'el nombre';
  const Quien = quien.charAt(0).toUpperCase() + quien.slice(1);
  const bruto = String(nombre == null ? '' : nombre);
  const limpio = audLimpiar(bruto);
  const r = { estado: 'ok', mensaje: '', sugerencia: '', palabras: 0, empresa: false };

  if (!limpio) {
    r.estado = 'mal';
    r.mensaje = 'Falta ' + quien + '.';
    return r;
  }

  if (/@/.test(limpio)) {
    r.estado = 'mal';
    r.mensaje = 'En ' + quien + ' quedó un correo electrónico, no un nombre.';
    return r;
  }
  if (/[<>|\\\/{}\[\]=]/.test(limpio)) {
    r.estado = 'atencion';
    r.mensaje = Quien + ' tiene símbolos que no van en un nombre.';
    r.sugerencia = audCapitalizarNombre(limpio.replace(/[<>|\\\/{}\[\]=]/g, ' '));
    return r;
  }

  r.empresa = audPareceEmpresa(limpio);
  const palabras = audPalabrasNombre(limpio);
  r.palabras = palabras.length;

  const corregido = audCapitalizarNombre(limpio);
  const problemas: string[] = [];

  if (bruto !== limpio) problemas.push('espacios de más');

  // Las reglas de escritura son para NOMBRES DE PERSONA. Una razón social usa siglas, números y
  // mayúsculas con todo derecho ("Grupo ACME SA de CV"): corregirla sería el error.
  if (!r.empresa) {
    if (limpio === limpio.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{2,}/.test(limpio)) problemas.push('está TODO EN MAYÚSCULAS');
    else if (limpio === limpio.toLowerCase() && /[a-záéíóúñ]/.test(limpio)) problemas.push('está todo en minúsculas');
    else if (corregido !== limpio) problemas.push('hay palabras sin la inicial mayúscula');
    if (/\d/.test(limpio)) problemas.push('tiene números');
  }

  // El número de palabras es una regla distinta según de quién sea el nombre.
  if (!r.empresa) {
    if (o.exigirExacto && palabras.length !== o.maxPalabras) {
      r.estado = 'atencion';
      // `as number`: si faltara maxPalabras, la comparación con undefined da false, como en Apps Script.
      r.mensaje = palabras.length < (o.maxPalabras as number)
        ? Quien + ' viene con una sola palabra: debe llevar nombre y apellido.'
        : Quien + ' trae ' + palabras.length + ' palabras; en el documento debe salir solo nombre y apellido.';
      if (palabras.length > (o.maxPalabras as number)) r.sugerencia = audNombreYApellido(palabras);
      return r;
    }
    if (!o.exigirExacto && palabras.length < (o.minPalabras || 2)) {
      r.estado = 'atencion';
      r.mensaje = Quien + ' solo trae una palabra. Un documento formal lleva al menos nombre y apellido.';
      if (corregido !== limpio) r.sugerencia = corregido;
      return r;
    }
    if (o.maxPalabras && palabras.length > o.maxPalabras) {
      problemas.push('trae ' + palabras.length + ' palabras');
    }
  }

  if (problemas.length) {
    r.estado = 'atencion';
    r.mensaje = Quien + ': ' + problemas.join(', ') + '.';
    if (corregido !== limpio) r.sugerencia = corregido;
    return r;
  }

  r.mensaje = r.empresa
    ? 'Parece una razón social; se aceptó tal cual está escrita.'
    : 'Bien escrito: ' + palabras.length + ' palabras, capitalización correcta.';
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// TELÉFONO
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Valida un teléfono mexicano de 10 dígitos y lo devuelve formateado. Lo que más aparece en una
 * captura apurada no es un número inválido sino un relleno (5555555555) o una secuencia
 * (1234567890): formalmente correctos y que no llevan a ninguna parte.
 */
export function audValidarTelefonoMx(tel: unknown) {
  const bruto = String(tel == null ? '' : tel).trim();
  const r = { estado: 'ok', mensaje: '', sugerencia: '', digitos: '' };

  if (!bruto) {
    r.estado = 'atencion';
    r.mensaje = 'No hay teléfono del cliente. Sin él no hay forma de aclarar dudas de la cotización.';
    return r;
  }

  let d = bruto.replace(/\D/g, '');
  if (d.length === 13 && d.indexOf('521') === 0) d = d.slice(3);        // +52 1 (móvil antiguo)
  else if (d.length === 12 && d.indexOf('52') === 0) d = d.slice(2);    // +52
  else if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);      // 1 + 10
  r.digitos = d;

  if (d.length !== 10) {
    r.estado = 'mal';
    r.mensaje = 'El teléfono tiene ' + d.length + ' dígito(s); en México son 10.';
    return r;
  }
  if (d.charAt(0) === '0' || d.charAt(0) === '1') {
    r.estado = 'mal';
    r.mensaje = 'Ningún indicativo de área en México empieza en ' + d.charAt(0) + '.';
    return r;
  }
  if (/^(\d)\1{9}$/.test(d)) {
    r.estado = 'mal';
    r.mensaje = 'El teléfono son diez veces el mismo dígito: es un relleno, no un número.';
    return r;
  }
  if ('0123456789012345678'.indexOf(d) > -1 || '9876543210987654321'.indexOf(d) > -1) {
    r.estado = 'mal';
    r.mensaje = 'El teléfono es una secuencia seguida de dígitos: es un relleno.';
    return r;
  }

  // Formato local: 2 dígitos de indicativo en las tres grandes zonas metropolitanas, 3 en el resto.
  const lada2 = ['55', '56', '33', '81'];
  r.sugerencia = (lada2.indexOf(d.substr(0, 2)) > -1)
    ? d.substr(0, 2) + ' ' + d.substr(2, 4) + ' ' + d.substr(6, 4)
    : d.substr(0, 3) + ' ' + d.substr(3, 3) + ' ' + d.substr(6, 4);
  r.mensaje = '10 dígitos con indicativo válido (' + r.sugerencia + ').';
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// DINERO
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Total de una línea con sus promociones. Es EXACTAMENTE la fórmula de cotizacion.html,
 * consulta_cotizacion y la pantalla de revisión: si aquí se calculara distinto, la auditoría estaría
 * avalando un número que el cliente nunca verá. OJO: el precio ya trae el IVA incluido.
 */
export function audCalcularLinea(p: any) {
  const unitario = parseFloat(p.unitPrice) || 0;
  const cantidad = parseInt(p.quantity, 10) || 0;
  const volumen = unitario * cantidad;
  const pagoUnico = parseFloat(p.costPaymentUnique) || 0;
  const descPublico = parseFloat(p.discountPublicPercent) || 0;
  const adicional = p.additionalDiscountApplied === 'Si';
  const descAdicional = parseFloat(p.additionalDiscountPercent) || 0;

  let total: number;
  if (pagoUnico > 0 && cantidad > 0 && unitario > 0) {
    total = pagoUnico;
  } else {
    const base = Math.max(0, volumen * (1 - descPublico / 100));
    total = (adicional && descAdicional > 0) ? base * (1 - descAdicional / 100) : base;
    total = Math.max(0, total);
  }

  const ahorro = volumen - total;
  return {
    cantidad,
    unitario,
    volumen,
    total,
    unitarioPromo: cantidad > 0 ? total / cantidad : total,
    ahorro,
    porcentaje: volumen > 0 ? (ahorro / volumen) * 100 : 0,
    descPublico,
    descAdicional: adicional ? descAdicional : 0
  };
}

/** Redondeo a dos decimales sin los sustos del punto flotante. */
function audCentavos(n: unknown): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Comprueba que subtotal, IVA y total cuadren entre sí y con las líneas. La tolerancia no es un
 * capricho: los importes se guardaron leyendo un texto ya formateado a dos decimales, así que cada
 * línea puede llevar hasta medio centavo de redondeo.
 */
export function audValidarTotales(quote: any, productos: any[]) {
  const q = quote || {};
  const lista = productos || [];
  const r = { estado: 'ok', mensaje: '', filas: [] as any[], diferencias: [] as string[] };

  const sumaLineas = audCentavos(lista.reduce((acc, p) => acc + audCalcularLinea(p).total, 0));

  const subtotal = audCentavos(q.summarySubtotal);
  const iva = audCentavos(q.summaryVat);
  const total = audCentavos(q.summaryTotal);

  // Media centésima por línea + un colchón fijo.
  const tol = Math.max(0.05, lista.length * 0.005 + 0.02);

  const esperadoSubtotal = audCentavos(sumaLineas / (1 + AUD_IVA));
  const esperadoIva = audCentavos(sumaLineas - esperadoSubtotal);

  const revisa = (etiqueta: string, valor: number, esperado: number, nota: string) => {
    const dif = audCentavos(valor - esperado);
    r.filas.push({ etiqueta, valor, esperado, diferencia: dif, ok: Math.abs(dif) <= tol });
    if (Math.abs(dif) > tol) r.diferencias.push(etiqueta + ': ' + (nota || '') + ' difiere en ' + dif.toFixed(2));
  };

  if (!lista.length) {
    r.estado = 'mal';
    r.mensaje = 'La cotización no tiene artículos, así que no hay nada que sume los totales.';
    return r;
  }

  revisa('Total contra la suma de las líneas', total, sumaLineas, 'lo que suman los artículos');
  revisa('Subtotal (total ÷ 1.16)', subtotal, esperadoSubtotal, 'la base sin IVA');
  revisa('IVA (16 %)', iva, esperadoIva, 'el impuesto');
  revisa('Subtotal + IVA', audCentavos(subtotal + iva), total, 'la suma de base e impuesto');

  if (total <= 0) {
    r.estado = 'mal';
    r.mensaje = 'El total de la cotización es cero. Nada de esto se puede enviar al cliente.';
    return r;
  }
  if (r.diferencias.length) {
    r.estado = 'mal';
    r.mensaje = 'Los importes no cuadran: ' + r.diferencias.join(' · ') + '.';
    return r;
  }

  r.mensaje = 'Las ' + lista.length + ' líneas suman ' + total.toFixed(2) +
    ', el IVA del 16 % da ' + iva.toFixed(2) + ' y la base ' + subtotal.toFixed(2) + '. Todo cuadra al centavo.';
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// ARTÍCULOS
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Consistencia interna de las líneas: repetidos, cantidades, descuentos imposibles y atípicos. */
export function audValidarArticulos(productos: any[]) {
  const lista = productos || [];
  const r = { estado: 'ok', mensaje: '', hallazgos: [] as string[], porArticulo: [] as any[] };

  if (!lista.length) {
    r.estado = 'mal';
    r.mensaje = 'La cotización se guardó sin artículos.';
    return r;
  }

  const vistos: Record<string, number> = {};
  const descuentos: number[] = [];

  lista.forEach((p, i) => {
    const c = audCalcularLinea(p);
    const avisos: string[] = [];
    const sku = String(p.sku || '').trim();
    const desc = String(p.description || '').trim();

    if (!sku) avisos.push('sin SKU');
    else if (!/^[0-9]{6,14}$/.test(sku)) avisos.push('el SKU "' + sku + '" no tiene la forma de un código de Liverpool');

    if (sku) {
      if (vistos[sku] != null) avisos.push('SKU repetido (ya está en la línea ' + (vistos[sku] + 1) + ')');
      else vistos[sku] = i;
    }

    if (!desc) avisos.push('sin descripción');
    else if (desc.length < 5) avisos.push('descripción demasiado corta ("' + desc + '")');

    if (c.cantidad <= 0) avisos.push('cantidad en cero');
    else if (c.cantidad > 999) avisos.push('cantidad de ' + c.cantidad + ' piezas');

    if (c.unitario <= 0) avisos.push('precio unitario en cero');
    if (c.total <= 0) avisos.push('la línea completa suma cero');

    if (c.descPublico < 0 || c.descPublico > 100) avisos.push('descuento público fuera del rango 0-100 %');
    if (c.descAdicional < 0 || c.descAdicional > 100) avisos.push('descuento adicional fuera del rango 0-100 %');
    if (c.porcentaje > 90) avisos.push('descuento total del ' + c.porcentaje.toFixed(1) + ' %');

    descuentos.push(c.porcentaje);
    r.porArticulo.push({ indice: i, sku, descripcion: desc, avisos, descuento: c.porcentaje });
    avisos.forEach((a) => { r.hallazgos.push('Artículo ' + (i + 1) + ': ' + a); });
  });

  // Descuentos que se salen del patrón: no es un error por sí mismo, pero es lo que hay que mirar
  // dos veces antes de firmar. Solo si además pesa (medio punto de diferencia no importa).
  audAtipicos(descuentos).forEach((i) => {
    const p = r.porArticulo[i];
    if (!p) return;
    if (Math.abs(p.descuento - audMediana(descuentos)) < 5) return;
    p.atipico = true;
    r.hallazgos.push('Artículo ' + (i + 1) + ': su descuento (' + p.descuento.toFixed(1) +
      ' %) se sale del patrón del resto de la cotización.');
  });

  // Un SKU repetido o una línea en cero es un error; lo demás es "míralo".
  const grave = r.hallazgos.some((h) => /repetido|en cero|suma cero|sin SKU|fuera del rango/.test(h));

  if (r.hallazgos.length) {
    r.estado = grave ? 'mal' : 'atencion';
    r.mensaje = r.hallazgos.length + ' cosa(s) que revisar en los artículos.';
    return r;
  }

  r.mensaje = lista.length + ' artículo(s) con SKU único, cantidades y descuentos dentro de lo normal.';
  return r;
}

/**
 * Separa lo que entró por la extensión de Chrome (trae enlace a su página y el sistema puede ir a
 * leer el precio publicado) de lo que se tecleó a mano (solo una persona puede verificarlo).
 */
export function audOrigenDatos(productos: any[]) {
  const lista = productos || [];
  const importados: number[] = [], manuales: number[] = [];
  lista.forEach((p, i) => {
    const url = String(p.productUrl || '').trim();
    if (url) importados.push(i); else manuales.push(i);
  });
  return {
    total: lista.length,
    importados,
    manuales,
    todosImportados: lista.length > 0 && manuales.length === 0,
    ningunoImportado: importados.length === 0
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// EL DICTAMEN COMPLETO
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Arma un punto de la lista con la forma que espera la pantalla (y la columna revision_checklist). */
function audPunto(id: string, texto: string, estado: string, detalle: string, extra?: Record<string, unknown>): PuntoAuditoria {
  const p: PuntoAuditoria = {
    id,
    texto,                       // la frase de siempre
    estado,                      // ok | pendiente | manual | atencion | mal
    detalle: detalle || '',      // qué se miró y qué se encontró
    auto: estado !== 'manual',   // ¿lo resolvió el sistema?
    peso: AUD_PESOS[id] || 5,
    sugerencia: '',
    evidencia: []
  };
  if (extra) Object.keys(extra).forEach((k) => { p[k] = extra[k]; });
  return p;
}

/**
 * Audita una cotización completa y devuelve los puntos de verificación ya resueltos.
 * Versión síncrona de audAuditar (el contrato asíncrono vive en revision.ts y llama a esta).
 * @param quote     Cabecera de la cotización (la forma de getQuoteDetails).
 * @param productos Líneas, con productUrl si vinieron de la extensión.
 */
export function audDictamen(quote: any, productos: any[], opciones?: { ahora?: Date }): Dictamen {
  const q = quote || {};
  const lista = productos || [];
  const op = opciones || {};
  const ahora = op.ahora instanceof Date ? op.ahora : new Date();
  const puntos: PuntoAuditoria[] = [];

  // 1 · Nombre del cliente
  const nom = audValidarNombrePersona(q.clientName, { quien: 'el nombre del cliente', minPalabras: 2, maxPalabras: 6 });
  puntos.push(audPunto('cliente-nombre', 'El nombre del cliente está escrito correctamente', nom.estado, nom.mensaje,
    { sugerencia: nom.sugerencia, evidencia: [{ etiqueta: 'En la cotización', valor: String(q.clientName || '(vacío)') }] }));

  // 2 · Correo del cliente
  const cor = audValidarCorreo(q.clientEmail);
  puntos.push(audPunto('cliente-correo', 'El correo del cliente es una dirección válida', cor.estado, cor.mensaje,
    { sugerencia: cor.sugerencia, evidencia: [{ etiqueta: 'En la cotización', valor: String(q.clientEmail || '(vacío)') }] }));

  // 3 · Teléfono del cliente
  const tel = audValidarTelefonoMx(q.clientPhone);
  puntos.push(audPunto('cliente-telefono', 'El teléfono del cliente tiene 10 dígitos válidos', tel.estado, tel.mensaje,
    { evidencia: [{ etiqueta: 'En la cotización', valor: String(q.clientPhone || '(vacío)') }] }));

  // 4 · Asesor: en el documento sale con NOMBRE y APELLIDO. La extensión telefónica salió del
  // sistema, así que ya no se revisa (toda cotización saldría marcada por un campo que no existe).
  const ase = audValidarNombrePersona(q.advisorName, { quien: 'el nombre del asesor', maxPalabras: 2, exigirExacto: true });
  puntos.push(audPunto('asesor', 'El asesor aparece con nombre y apellido', ase.estado, ase.mensaje,
    { sugerencia: ase.sugerencia,
      evidencia: [
        { etiqueta: 'Asesor', valor: String(q.advisorName || '(vacío)') },
        { etiqueta: 'Correo', valor: String(q.advisorEmail || '(vacío)') }
      ] }));

  // 5 · Precios contra el sitio
  const origen = audOrigenDatos(lista);
  const puntoPrecios = audPunto('precios', 'Precios, promociones y descuentos coinciden con el sitio', 'pendiente', '', { origen });
  audResolverPrecios(puntoPrecios, origen, null);
  puntos.push(puntoPrecios);

  // 6 · Totales
  const tot = audValidarTotales(q, lista);
  puntos.push(audPunto('totales', 'Subtotal, IVA y total general cuadran', tot.estado, tot.mensaje,
    { evidencia: tot.filas.map((f) => ({
      etiqueta: f.etiqueta,
      valor: f.valor.toFixed(2) + (f.ok ? '' : ' (se esperaba ' + f.esperado.toFixed(2) + ')'),
      ok: f.ok
    })) }));

  // 7 · Consistencia de los artículos
  const art = audValidarArticulos(lista);
  puntos.push(audPunto('articulos', 'Los artículos no repiten SKU y sus cantidades y descuentos son razonables',
    art.estado, art.mensaje,
    { evidencia: art.hallazgos.slice(0, 12).map((h) => ({ etiqueta: '', valor: h })), porArticulo: art.porArticulo }));

  // 8 · Vigencia
  const vig = audValidarVigencia(q.timestamp, ahora);
  puntos.push(audPunto('vigencia', 'La cotización es reciente y sus precios siguen vigentes', vig.estado, vig.mensaje,
    { dias: vig.dias }));

  return audResumir(puntos);
}

/** Antigüedad de la cotización: los precios de Liverpool cambian de un día para otro. */
function audValidarVigencia(timestamp: unknown, ahora: Date) {
  const r = { estado: 'ok', mensaje: '', dias: null as number | null };
  // aFecha y no `new Date`: un texto sin zona es hora de México, como lo leía Apps Script.
  const fecha = timestamp ? aFecha(timestamp) : null;
  if (!fecha) {
    r.estado = 'manual';
    r.mensaje = 'La cotización no tiene fecha legible: comprueba a mano que no sea vieja.';
    return r;
  }
  const dias = Math.floor((ahora.getTime() - fecha.getTime()) / 86400000);
  r.dias = dias;
  if (dias < 0) {
    r.estado = 'atencion';
    r.mensaje = 'La fecha de la cotización está en el futuro (' + fecha.toISOString().slice(0, 10) + ').';
    return r;
  }
  if (dias <= 3) {
    r.mensaje = dias === 0 ? 'Se creó hoy.' : 'Se creó hace ' + dias + ' día(s).';
    return r;
  }
  r.estado = 'atencion';
  r.mensaje = 'Se creó hace ' + dias + ' días. Las promociones de Liverpool cambian cada semana: ' +
              'vuelve a comprobar los precios antes de aprobarla.';
  return r;
}

/**
 * Decide en qué queda el punto de "precios" según de dónde salieron los datos y —si ya se consultó el
 * sitio— qué dijo la consulta. Se llama al abrir la revisión y otra vez cuando vuelven los precios en
 * vivo: una sola función garantiza que la pantalla y lo que se guarda digan lo mismo.
 */
function audResolverPrecios(punto: PuntoAuditoria, origen: any, verificaciones: any[] | null): PuntoAuditoria {
  const o = origen || { total: 0, importados: [], manuales: [], todosImportados: false };

  if (!o.total) {
    punto.estado = 'mal';
    punto.detalle = 'No hay artículos cuyos precios comparar.';
    return punto;
  }

  if (!verificaciones) {
    if (o.ningunoImportado) {
      punto.estado = 'manual';
      punto.detalle = 'Los ' + o.total + ' artículos se capturaron a mano (no traen enlace a su página), ' +
        'así que el sistema no puede compararlos solo. Ábrelos en el sitio y confírmalo tú.';
      punto.auto = false;
      return punto;
    }
    punto.estado = 'pendiente';
    punto.detalle = 'Consultando liverpool.com.mx para ' + o.importados.length + ' de ' + o.total + ' artículo(s)…';
    return punto;
  }

  const coinciden = verificaciones.filter((v) => v.estado === 'coincide');
  const difieren = verificaciones.filter((v) => v.estado === 'difiere');
  const sinDato = verificaciones.filter((v) => v.estado === 'sin-dato');
  const manuales = o.manuales.length;

  punto.verificaciones = verificaciones;

  if (difieren.length) {
    punto.estado = 'mal';
    punto.detalle = difieren.length + ' artículo(s) tienen en la cotización un precio distinto del que ' +
      'publica el sitio ahora mismo. Revísalos antes de aprobar.';
    return punto;
  }
  if (manuales || sinDato.length) {
    punto.estado = 'manual';
    punto.auto = false;
    const trozos: string[] = [];
    if (coinciden.length) trozos.push(coinciden.length + ' artículo(s) verificados contra el sitio y correctos');
    if (manuales) trozos.push(manuales + ' capturado(s) a mano, sin enlace que consultar');
    if (sinDato.length) trozos.push(sinDato.length + ' que el sitio no dejó leer');
    punto.detalle = trozos.join('; ') + '. Confirma tú los que faltan.';
    return punto;
  }

  punto.estado = 'ok';
  punto.auto = true;
  punto.detalle = 'Los ' + coinciden.length + ' artículos se compararon con liverpool.com.mx y el precio ' +
    'unitario cuadra en todos.';
  return punto;
}

/**
 * Rehace el punto de precios de un dictamen ya calculado con los resultados de la consulta en vivo y
 * vuelve a puntuar. Lo usan la verificación en lote y el guardado, para que ambos lleguen al mismo número.
 */
export function audAplicarPreciosEnVivo(auditoria: Dictamen, verificaciones: any[] | null): Dictamen {
  if (!auditoria || !auditoria.puntos) return auditoria;
  auditoria.puntos.forEach((p) => {
    if (p.id !== 'precios') return;
    audResolverPrecios(p, p.origen, verificaciones || []);
  });
  return audResumir(auditoria.puntos);
}

/**
 * Índice de confianza + resumen. Es un ORDENADOR DE ATENCIÓN, no una nota: dice por dónde empezar a
 * mirar, nunca sustituye la decisión de aprobar (esa la firma una persona).
 */
export function audResumir(puntos: PuntoAuditoria[]): Dictamen {
  let penalizacion = 0, pesoTotal = 0;
  const criticas: string[] = [];
  let automaticos = 0, pendientes = 0, porRevisar = 0;

  puntos.forEach((p) => {
    const peso = p.peso || 5;
    pesoTotal += peso;
    penalizacion += peso * (AUD_CASTIGO[p.estado] == null ? 0.5 : AUD_CASTIGO[p.estado]);
    if (p.estado === 'ok') automaticos++;
    else if (p.estado === 'pendiente') pendientes++;
    else porRevisar++;
    if (p.estado === 'mal') criticas.push(p.texto + ' → ' + p.detalle);
  });

  const score = pesoTotal ? Math.max(0, Math.min(100, Math.round(100 - (penalizacion / pesoTotal) * 100))) : 0;

  let resumen: string;
  if (criticas.length) {
    resumen = criticas.length + ' comprobación(es) fallaron. Aprobar así exige que expliques por qué.';
  } else if (porRevisar) {
    resumen = automaticos + ' de ' + puntos.length + ' puntos quedaron verificados solos; ' +
              porRevisar + ' necesitan tu criterio.';
  } else if (pendientes) {
    resumen = 'Verificación automática en curso…';
  } else {
    resumen = 'Los ' + puntos.length + ' puntos se verificaron automáticamente. Nada quedó pendiente.';
  }

  return { puntos, score, resumen, criticas, automaticos, pendientes, porRevisar };
}

/**
 * Compara UNA línea de la cotización con la ficha que devolvió el sitio (verificación en lote).
 * @return {estado:'coincide'|'difiere'|'sin-dato', titulo, mensaje, diferencia, similitud}
 */
export function audCompararConFicha(producto: any, ficha: any) {
  const c = audCalcularLinea(producto || {});
  const f = ficha || {};

  if (!f.ok || typeof f.precio !== 'number') {
    return {
      estado: 'sin-dato',
      titulo: 'No se pudo leer el sitio',
      mensaje: f.mensaje || 'La página del artículo no se pudo consultar automáticamente.',
      diferencia: 0,
      similitud: 0
    };
  }

  const dif = audCentavos(c.unitarioPromo - f.precio);
  const abs = Math.abs(dif);
  const similitud = audSimilitud(producto.description, f.titulo);

  // Medio peso por pieza es el umbral con el que se trabaja en piso de venta.
  if (abs > 0.5) {
    return {
      estado: 'difiere',
      titulo: dif > 0 ? 'Cotizado por arriba del sitio' : 'Cotizado por debajo del sitio',
      mensaje: 'Diferencia de ' + abs.toFixed(2) + ' por pieza (' + (abs * c.cantidad).toFixed(2) +
               ' en la línea). Cotizado ' + c.unitarioPromo.toFixed(2) + ' · sitio ' + f.precio.toFixed(2) + '.',
      diferencia: dif,
      similitud
    };
  }

  // El precio cuadra, pero si el nombre no se parece en nada puede ser el SKU equivocado.
  if (similitud < 0.34 && String(f.titulo || '').length > 3) {
    return {
      estado: 'difiere',
      titulo: 'El precio cuadra, pero el artículo no parece el mismo',
      mensaje: 'La cotización dice "' + String(producto.description || '') + '" y el sitio "' + f.titulo +
               '". Comprueba que el SKU sea el correcto.',
      diferencia: dif,
      similitud
    };
  }

  return {
    estado: 'coincide',
    titulo: 'El precio cuadra',
    mensaje: 'Cotizado ' + c.unitarioPromo.toFixed(2) + ' y el sitio publica ' + f.precio.toFixed(2) + '.',
    diferencia: dif,
    similitud
  };
}
