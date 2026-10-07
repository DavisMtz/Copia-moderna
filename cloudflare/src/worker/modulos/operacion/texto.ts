/**
 * ESTADO DE OPERACIÓN · utilidades de texto | Portal Ventel en Cloudflare
 * ======================================================================
 * Port literal de la sección «UTILIDADES DE TEXTO» de Operacion.gs. Aquí vive el criterio ÚNICO de
 * agrupación (opMismoMotivo): lo usan el catálogo, la búsqueda del incidente al que pertenece un
 * reporte, el recuento del umbral y las recomendaciones. Si cada uno usara su propio criterio, un
 * reporte podría contar para disparar la alerta y luego no pertenecer a la incidencia que provocó.
 *
 * No se toca nada de la lógica: las mismas expresiones, los mismos umbrales (Dice ≥ 0,7 para «la
 * misma queja», ≥ 0,78 para fundir opciones del catálogo) y la misma regla de que los números no se
 * funden nunca («Error 404» ≠ «Error 403»).
 */

/** Minúsculas, sin acentos, sin puntuación de relleno y con los espacios colapsados. */
export function opNormalizar(texto: unknown): string {
  return String(texto == null ? '' : texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clave estable para agrupar: la normalización con guiones. '' si no queda nada. */
export function opClave(texto: unknown): string {
  return opNormalizar(texto).replace(/ /g, '-').substring(0, 60);
}

/** Caracteres de control: nunca aportan nada y sí ensucian una celda o un mensaje de Chat. */
const OP_RE_CONTROL = /[\u0000-\u001f\u007f]/g;
/** Igual, pero conservando el salto de línea. */
const OP_RE_CONTROL_SIN_SALTO = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/** Recorta y limpia lo que teclea una persona antes de guardarlo tal cual se verá. */
export function opLimpiarTexto(texto: unknown, tope?: number): string {
  return String(texto == null ? '' : texto)
    .replace(OP_RE_CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, tope || 120);
}

/** Notas: conserva los saltos de línea, que ahí sí significan algo. */
export function opLimpiarNotas(texto: unknown, tope?: number): string {
  return String(texto == null ? '' : texto)
    .replace(/\r\n/g, '\n')
    .replace(OP_RE_CONTROL_SIN_SALTO, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, tope || 1200);
}

/** Primera letra en mayúscula, el resto como lo escribió la persona. */
export function opCapitalizar(texto: unknown): string {
  const s = String(texto || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * Distancia de edición con transposiciones (Damerau-Levenshtein, variante OSA).
 * Sirve para no acabar con «No carga», «no carga.» y «No cagra» como tres submotivos distintos.
 */
export function opDistancia(a0: unknown, b0: unknown): number {
  const a = String(a0 || ''), b = String(b0 || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const fila: number[] = [];
  for (let j = 0; j <= b.length; j++) fila[j] = j;

  let anterior: number[] = [];
  for (let i = 1; i <= a.length; i++) {
    const previa = fila.slice();
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      fila[j] = Math.min(fila[j - 1] + 1, previa[j] + 1, previa[j - 1] + costo);
      // Transposición: «carga» ↔ «cagra» es UN error de dedo, no dos.
      if (i > 1 && j > 1 &&
          a.charAt(i - 1) === b.charAt(j - 2) &&
          a.charAt(i - 2) === b.charAt(j - 1)) {
        fila[j] = Math.min(fila[j], anterior[j - 2] + costo);
      }
    }
    anterior = previa;
  }
  return fila[b.length];
}

/**
 * Coeficiente de Dice sobre bigramas: 0 = nada que ver, 1 = idénticos. El orden de las palabras
 * pesa poco: «no carga la bolsa» y «la bolsa no carga» salen casi iguales.
 */
export function opDice(a: unknown, b: unknown): number {
  const na = opNormalizar(a).replace(/ /g, '');
  const nb = opNormalizar(b).replace(/ /g, '');
  if (!na.length || !nb.length) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;

  const bolsa: Record<string, number> = {};
  for (let i = 0; i < na.length - 1; i++) {
    const par = na.substr(i, 2);
    bolsa[par] = (bolsa[par] || 0) + 1;
  }
  let comunes = 0;
  for (let i = 0; i < nb.length - 1; i++) {
    const par = nb.substr(i, 2);
    if (bolsa[par] > 0) { bolsa[par]--; comunes++; }
  }
  return (2 * comunes) / ((na.length - 1) + (nb.length - 1));
}

/** Las cifras de un texto, en orden y separadas: «error 404 en caja 3» → «404|3». */
export function opCifras(texto: unknown): string {
  const m = String(texto || '').match(/\d+/g);
  return m ? m.join('|') : '';
}

/** ¿Estas dos descripciones son la misma queja? Criterio ÚNICO de agrupación del módulo. */
export function opMismoMotivo(a: unknown, b: unknown): boolean {
  if (opCifras(a) !== opCifras(b)) return false;
  return opDice(a, b) >= 0.7;
}

/**
 * ¿Este texto nuevo es en realidad uno que ya existe? Devuelve la opción existente cuando está
 * razonablemente seguro, o null. El umbral de edición se acota también por longitud parecida: sin
 * eso «SOMS» y «SAP» se fundían en uno.
 */
export function opSugerirExistente(texto: unknown, existentes: unknown[]): { valor: string; motivo: string } | null {
  const norm = opNormalizar(texto);
  if (!norm) return null;
  const lista = (existentes || []).filter(Boolean).map((x) => String(x));

  for (let i = 0; i < lista.length; i++) {
    if (opNormalizar(lista[i]) === norm) return { valor: lista[i], motivo: 'igual' };
  }

  let mejor: { valor: string; motivo: string; puntaje: number } | null = null;
  for (let i = 0; i < lista.length; i++) {
    const otro = opNormalizar(lista[i]);
    if (!otro) continue;

    // LOS NÚMEROS NO SE FUNDEN NUNCA: en un mensaje técnico la cifra suele ser justo la parte que
    // lo distingue («Error 404» / «Error 403», «Caja 3» / «Caja 8»).
    if (opCifras(norm) !== opCifras(otro)) continue;

    const dice = opDice(norm, otro);
    const dist = opDistancia(norm, otro);
    const largoParecido = Math.abs(norm.length - otro.length) <= Math.max(2, Math.round(norm.length * 0.34));
    const toleranciaEdicion = norm.length <= 6 ? 1 : (norm.length <= 12 ? 2 : 3);

    const casiIgual = largoParecido && dist <= toleranciaEdicion;
    const muyParecido = dice >= 0.78;
    if (!casiIgual && !muyParecido) continue;

    const puntaje = Math.max(dice, 1 - (dist / Math.max(norm.length, otro.length)));
    if (!mejor || puntaje > mejor.puntaje) {
      mejor = { valor: lista[i], motivo: casiIgual ? 'tipeo' : 'parecido', puntaje };
    }
  }
  return mejor ? { valor: mejor.valor, motivo: mejor.motivo } : null;
}
