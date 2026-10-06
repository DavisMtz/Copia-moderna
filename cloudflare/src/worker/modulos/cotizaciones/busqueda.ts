/**
 * BÚSQUEDA TOLERANTE A ERRORES (FUZZY) | Portal Ventel en Cloudflare
 * ===================================================================
 * Port literal del final de Code.gs. Que el buscador encuentre aunque se escriba sin acentos
 * ("gonzalez" → "González"), con otras mayúsculas o con dedazos ("jse" → "José"), y que un folio
 * dictado ("lvp2024118", "2024 118") encuentre "LVP-2024-118". El equivalente del navegador vive en
 * app_buscar.html con el mismo criterio: no se toca uno sin el otro.
 */

/** Minúsculas, sin acentos/diacríticos y sin espacios sobrantes. */
export function normalizeText(s: unknown): string {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Solo letras y dígitos: la forma en que se teclean folios y números de pedido. */
export function compactText(s: unknown): string {
  return normalizeText(s).replace(/[^a-z0-9]/g, '');
}

/**
 * Palabras de un texto, partiendo también en la frontera letra/dígito y por los signos del
 * correo: "LVP-2024-118" → ["lvp","2024","118"].
 */
export function searchTokens(s: unknown): string[] {
  return normalizeText(s)
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((t) => t);
}

/** Distancia de edición (Levenshtein) entre dos cadenas ya normalizadas. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev: number[] = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = [i];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[bl];
}

/** Errores de tipeo tolerados según qué tan larga es la palabra buscada. */
export function fuzzyTolerance(len: number): number {
  if (len <= 3) return 0; // palabras muy cortas: coincidencia exacta para no traer ruido
  if (len <= 5) return 1;
  if (len <= 8) return 2;
  return 3;
}

/**
 * Puntúa qué tan bien coincide `term` con `text`. Devuelve -1 si NO hay coincidencia.
 * Semántica AND: cada palabra de la búsqueda debe encontrar algo en el texto. A mayor puntaje,
 * más relevante (una coincidencia literal pesa más que una difusa).
 */
export function fuzzyScore(text: unknown, term: unknown): number {
  const q = normalizeText(term);
  if (!q) return 0;
  const t = normalizeText(text);
  if (!t) return -1;

  // Coincidencia directa de toda la frase. Que TERMINE donde termina una palabra vale aparte:
  // buscando "LVP-2024-118" el folio exacto tiene que ganarle a "LVP-2024-1180".
  const idx = t.indexOf(q);
  if (idx !== -1) {
    const sigue = t.charAt(idx + q.length);
    return 3000 - idx + (sigue === '' || !/[a-z0-9]/.test(sigue) ? 400 : 0);
  }

  // La misma frase con otros separadores: el folio dictado ("lvp2024118", "lvp 2024 118").
  const qc = compactText(term);
  if (qc.length >= 3) {
    const trozos = t.split(' ');
    for (let z = 0; z < trozos.length; z++) {
      const tz = compactText(trozos[z]);
      if (!tz) continue;
      if (tz === qc) return 3300;
      if (tz.indexOf(qc) === 0) return 2900;
    }
    const ic = compactText(text).indexOf(qc);
    if (ic !== -1) return 2600 - ic;
  }

  const qTokens = searchTokens(term);
  const tTokens = searchTokens(text);
  if (qTokens.length === 0 || tTokens.length === 0) return -1;

  let total = 0;
  for (let i = 0; i < qTokens.length; i++) {
    const qt = qTokens[i];
    let best = -1;
    for (let j = 0; j < tTokens.length; j++) {
      const tt = tTokens[j];
      if (tt === qt) { best = Math.max(best, 200); continue; }
      if (tt.indexOf(qt) === 0) { best = Math.max(best, 160); continue; }     // prefijo de palabra
      if (tt.indexOf(qt) !== -1) { best = Math.max(best, 120); continue; }    // dentro de la palabra
      const tol = fuzzyTolerance(qt.length);
      if (tol > 0) {
        const d = levenshtein(qt, tt);
        if (d <= tol) { best = Math.max(best, 90 - d * 10); continue; }
        // Nombres largos con typo: compara contra el inicio de la palabra del texto.
        if (tt.length > qt.length) {
          const d2 = levenshtein(qt, tt.substring(0, qt.length));
          if (d2 <= tol) best = Math.max(best, 70 - d2 * 10);
        }
      }
    }
    if (best < 0) return -1; // esta palabra no encontró nada → la búsqueda no coincide
    total += best;
  }
  return total;
}
