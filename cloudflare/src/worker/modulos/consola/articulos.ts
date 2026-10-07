/**
 * ARTÍCULOS — publicaciones largas del Portal | Portal Ventel en Cloudflare
 * ========================================================================
 * Port de Articulos.gs. El contenido se guarda como JSON DE BLOQUES VERSIONADO, nunca como HTML:
 *
 *     { v: 1, bloques: [ {tipo:'titulo', texto:'…'}, {tipo:'texto', partes:[…]}, … ] }
 *
 * El servidor sabe qué campos existen y de qué tipo son —y descarta el resto—, y el cliente
 * CONSTRUYE nodos del DOM: no hay ningún punto por el que el texto de un artículo deje de ser texto.
 *
 * Tablas: `portal_articulos` (hoja «Articulos») y `portal_articulos_vistas` («ArticulosVistas»).
 * Escribir pide el bloque 'articulos'; leer, solo haber entrado.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secIdentidad, secIdentidadConBloque } from '../../nucleo/seguridad';
import { cacheLeer, cacheGuardar } from '../../nucleo/sistema';
import { formatearFecha } from '../../nucleo/fechas';
import { guardarArchivo } from '../../nucleo/archivos';
import { aleatorioEntero } from '../../nucleo/cripto';

const ART_BLOQUE_PERM = 'articulos';   // permiso de ESCRITURA; leer puede cualquier sesión
const ART_ESTADOS = ['borrador', 'publicado'];

/* Topes. ART_MAX_JSON venía del límite de una celda de Sheets; se conserva para que el editor se
   comporte igual (un artículo que allá no cabía, aquí tampoco). */
const ART_MAX_JSON = 45000;
const ART_MAX_BLOQUES = 200;
const ART_MAX_TEXTO = 6000;
const ART_MAX_TITULO = 160;
const ART_MAX_RESUMEN = 400;
const ART_MAX_FILAS_TAB = 60;
const ART_MAX_COLS_TAB = 12;
const ART_MAX_DIAGRAMA = 20000;
const ART_DOC_CLASES = ['documento', 'presentacion', 'hoja', 'archivo'];

const ART_SIN_SESION = 'Entra al sistema para leer los artículos del equipo.';

type FilaArticulo = {
  id: string; titulo: string | null; resumen: string | null; contenido: string | null; estado: string | null;
  autores: string | null; creado: string | null; editado: string | null; editado_por: string | null;
};

function artNuevoId(): string {
  return 'art-' + Date.now().toString(36) + aleatorioEntero(0, 1679615).toString(36);
}

/** artGate_: puerta de ESCRITURA. Leer artículos no pasa por aquí. */
async function artGate(ctx: Ctx, email: unknown): Promise<{ ok: true; email: string; nombre: string } | { ok: false; error: string }> {
  try {
    const id = await secIdentidadConBloque(ctx, email, ART_BLOQUE_PERM);
    return id.ok ? { ok: true, email: id.email, nombre: id.nombre } : { ok: false, error: id.error };
  } catch (e) {
    console.error('artGate', e);
    return { ok: false, error: 'No pudimos verificar tu cuenta. Vuelve a entrar al sistema e inténtalo de nuevo.' };
  }
}

/**
 * artQuienLee_: identidad de quien LEE. En Apps Script, sin correo declarado se caía a la cuenta de
 * Google; aquí ese papel lo hace la sesión del portal (secIdentidad la usa sola).
 */
async function artQuienLee(ctx: Ctx, email: unknown): Promise<{ ok: true; correo: string; nombre: string } | { ok: false }> {
  try {
    const id = await secIdentidad(ctx, email);
    if (id.ok) return { ok: true, correo: id.email, nombre: id.nombre || '' };
  } catch { /* sin identidad */ }
  return { ok: false };
}

/** artHaySesion_: puerta de LECTURA. No pide bloque, pero sí haber entrado. */
async function artHaySesion(ctx: Ctx, email: unknown): Promise<boolean> {
  try { return (await artQuienLee(ctx, email)).ok === true; } catch { return false; }
}

// ── Saneo del contenido (la aduana) ─────────────────────────────────────────

/**
 * artUrlSegura_: solo https. Ni `javascript:`, ni `data:`, ni protocolo relativo. Se comprueba el
 * principio de la cadena YA RECORTADA.
 */
export function artUrlSegura(u: unknown): string {
  const s = String(u == null ? '' : u).trim();
  if (!s) return '';
  if (!/^https:\/\/[^\s"'<>]+$/i.test(s)) return '';
  if (s.length > 2000) return '';
  return s;
}

function artTexto(v: unknown, max?: number): string {
  return String(v == null ? '' : v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, max || ART_MAX_TEXTO);
}

/** Un párrafo es una lista de PARTES: {t} o {t, url}. */
function artPartes(v: unknown): Array<{ t: string; url?: string }> {
  const arr = Array.isArray(v) ? v : [];
  const out: Array<{ t: string; url?: string }> = [];
  let total = 0;
  for (let i = 0; i < arr.length && out.length < 200; i++) {
    const p = arr[i] || {};
    const t = artTexto(p.t, ART_MAX_TEXTO - total);
    if (!t) continue;
    total += t.length;
    const url = artUrlSegura(p.url);
    out.push(url ? { t, url } : { t });
    if (total >= ART_MAX_TEXTO) break;
  }
  return out;
}

/** artDocDeUrl_: tipo de documento de Google y su ID (se guarda el ID, no la URL pegada). */
function artDocDeUrl(url: unknown): { clase: string; docId: string } | null {
  const s = String(url || '').trim();
  if (!/^https:\/\/(docs|drive)\.google\.com\//i.test(s)) return null;
  const m = s.match(/\/(document|presentation|spreadsheets|file)\/d\/([a-zA-Z0-9_-]{10,})/);
  if (!m) return null;
  const clase = m[1] === 'document' ? 'documento' : m[1] === 'presentation' ? 'presentacion'
              : m[1] === 'spreadsheets' ? 'hoja' : 'archivo';
  return { clase, docId: m[2] };
}

/** artBloque_: un bloque saneado, o null. Tipo desconocido: se descarta entero, no se adivina. */
function artBloque(b: any): Record<string, unknown> | null {
  if (!b || typeof b !== 'object') return null;
  const tipo = String(b.tipo || '').trim().toLowerCase();

  if (tipo === 'titulo') {
    const texto = artTexto(b.texto, ART_MAX_TITULO);
    if (!texto) return null;
    return { tipo: 'titulo', texto, nivel: Number(b.nivel) === 3 ? 3 : 2 };
  }
  if (tipo === 'texto') {
    const partes = artPartes(b.partes);
    return partes.length ? { tipo: 'texto', partes } : null;
  }
  if (tipo === 'lista') {
    const items = (Array.isArray(b.items) ? b.items : []).map((it: unknown) => artPartes(it))
      .filter((p: unknown[]) => p.length).slice(0, 60);
    return items.length ? { tipo: 'lista', items, ordenada: b.ordenada === true } : null;
  }
  if (tipo === 'imagen') {
    const url = artUrlSegura(b.url);
    if (!url) return null;
    return { tipo: 'imagen', url, alt: artTexto(b.alt, 200), pie: artTexto(b.pie, 300) };
  }
  if (tipo === 'tabla') {
    const filas: string[][] = (Array.isArray(b.filas) ? b.filas : []).slice(0, ART_MAX_FILAS_TAB)
      .map((f: unknown) => (Array.isArray(f) ? f : []).slice(0, ART_MAX_COLS_TAB).map((c) => artTexto(c, 500)))
      .filter((f: string[]) => f.length);
    if (!filas.length) return null;
    // Todas las filas con el mismo ancho: una tabla dentada se pinta rota.
    const ancho = filas.reduce((m, f) => Math.max(m, f.length), 0);
    filas.forEach((f) => { while (f.length < ancho) f.push(''); });
    return { tipo: 'tabla', filas, encabezado: b.encabezado !== false };
  }
  if (tipo === 'documento') {
    let clase = String(b.clase || '').trim().toLowerCase();
    let docId = String(b.docId || '').trim();
    if (!docId && b.url) {
      const d = artDocDeUrl(b.url);
      if (d) { clase = d.clase; docId = d.docId; }
    }
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(docId)) return null;
    if (ART_DOC_CLASES.indexOf(clase) < 0) clase = 'archivo';
    return { tipo: 'documento', clase, docId, titulo: artTexto(b.titulo, 200) };
  }
  if (tipo === 'diagrama') {
    // XML de draw.io guardado como TEXTO; se pinta en el iframe de diagrams.net, nunca en el DOM.
    const xml = String(b.xml == null ? '' : b.xml).trim();
    if (!xml || xml.length > ART_MAX_DIAGRAMA) return null;
    if (!/^<(mxfile|mxGraphModel)[\s>]/i.test(xml)) return null;
    return { tipo: 'diagrama', xml, titulo: artTexto(b.titulo, 200),
             alto: Math.min(900, Math.max(240, Number(b.alto) || 420)) };
  }
  if (tipo === 'separador') return { tipo: 'separador' };
  return null;
}

/** artSanearContenido_: contenido completo saneado y versionado. Nunca lanza. */
function artSanearContenido(c: any): { v: 1; bloques: Array<Record<string, unknown>> } {
  const bruto = (c && Array.isArray(c.bloques)) ? c.bloques : [];
  const bloques: Array<Record<string, unknown>> = [];
  for (let i = 0; i < bruto.length && bloques.length < ART_MAX_BLOQUES; i++) {
    const b = artBloque(bruto[i]);
    if (b) bloques.push(b);
  }
  return { v: 1, bloques };
}

/** artTextoPlano_: texto plano de un artículo, para que el buscador lo encuentre por su contenido. */
function artTextoPlano(contenido: any): string {
  const partes: string[] = [];
  ((contenido && contenido.bloques) || []).forEach((b: any) => {
    if (!b) return;
    if (b.tipo === 'titulo') partes.push(b.texto);
    else if (b.tipo === 'texto') partes.push((b.partes || []).map((p: any) => p && p.t).join(''));
    else if (b.tipo === 'lista') (b.items || []).forEach((it: any) => partes.push((it || []).map((p: any) => p && p.t).join('')));
    else if (b.tipo === 'tabla') (b.filas || []).forEach((f: any) => partes.push((f || []).join(' ')));
    else if (b.tipo === 'imagen') { if (b.pie) partes.push(b.pie); }
    else if (b.tipo === 'documento' || b.tipo === 'diagrama') { if (b.titulo) partes.push(b.titulo); }
  });
  return partes.join(' ').replace(/\s+/g, ' ').trim();
}

function contenidoDe(f: FilaArticulo): any {
  if (!f.contenido) return { v: 1, bloques: [] };
  try { return JSON.parse(String(f.contenido)); } catch { return { v: 1, bloques: [] }; }
}

/** artDeFila_: fila → artículo. `conContenido` a false para las listas (pesa mucho). */
function artDeFila(f: FilaArticulo, conContenido: boolean): Record<string, any> {
  const contenido = contenidoDe(f);
  const estado = String(f.estado || '').trim().toLowerCase();
  const art: Record<string, any> = {
    id: String(f.id || '').trim(),
    titulo: String(f.titulo || '').trim(),
    resumen: String(f.resumen || '').trim(),
    estado: ART_ESTADOS.indexOf(estado) > -1 ? estado : 'borrador',
    autores: String(f.autores || '').trim(),
    // Fechas como día en hora de México (Utilities.formatDate con la zona del script).
    creado: f.creado ? formatearFecha(f.creado, 'yyyy-MM-dd') : '',
    editado: f.editado ? formatearFecha(f.editado, 'yyyy-MM-dd') : '',
    editadoPor: String(f.editado_por || '').trim()
  };
  if (conContenido) {
    art.contenido = artSanearContenido(contenido);
  } else {
    const plano = artTextoPlano(contenido);
    art.palabras = plano ? plano.split(/\s+/).length : 0;
    art.minutos = Math.max(1, Math.round(art.palabras / 200));
    art.bloques = ((contenido && contenido.bloques) || []).length;
  }
  return art;
}

const COLUMNAS = 'id, titulo, resumen, contenido, estado, autores, creado, editado, editado_por';

// ── Lectura ─────────────────────────────────────────────────────────────────

/**
 * Lista de artículos. Los PUBLICADOS los ve cualquiera con sesión; los BORRADORES, solo quien puede
 * publicar. `total` es cuántos podía ver esta persona antes del tope (el carril del Portal lo usa).
 */
export async function artListar(ctx: Ctx, email: string, opts?: any) {
  try {
    const o = (opts && typeof opts === 'object') ? opts : {};
    if (!(await artHaySesion(ctx, email))) {
      return { status: 'error', error: ART_SIN_SESION, articulos: [], total: 0, puedeEditar: false };
    }
    const puedeEditar = (await artGate(ctx, email)).ok;
    const filas = await ctx.todas<FilaArticulo>('SELECT ' + COLUMNAS + ' FROM portal_articulos ORDER BY rowid');
    if (!filas.length) return { status: 'ok', articulos: [], puedeEditar };

    const out: Array<Record<string, any>> = [];
    for (const f of filas) {
      if (!String(f.id || '').trim()) continue;
      const art = artDeFila(f, false);
      if (art.estado !== 'publicado' && !puedeEditar) continue;
      out.push(art);
    }
    // Lo más reciente primero (el orden estable deja los empates como estaban, igual que en V8).
    out.sort((a, b) => String(b.editado || b.creado).localeCompare(String(a.editado || a.creado)));
    const tope = Number(o.tope) || 0;
    return { status: 'ok', articulos: tope ? out.slice(0, tope) : out, total: out.length, puedeEditar };
  } catch (e: any) {
    console.error('artListar', e);
    return { status: 'error', error: String(e) };
  }
}

/**
 * Un artículo con su contenido, y de paso queda registrada la lectura: lo que cuenta como leído es
 * lo que el servidor sirvió.
 */
export async function artObtener(ctx: Ctx, id: unknown, email: string) {
  try {
    const clave = String(id == null ? '' : id).trim();
    if (!clave) return { status: 'error', error: 'Falta el identificador del artículo.' };
    if (!(await artHaySesion(ctx, email))) return { status: 'error', error: ART_SIN_SESION, sinSesion: true };
    const puedeEditar = (await artGate(ctx, email)).ok;

    const hay = await ctx.una<{ id: string }>('SELECT id FROM portal_articulos LIMIT 1');
    if (!hay) return { status: 'error', error: 'Todavía no hay artículos publicados.' };

    const f = await ctx.una<FilaArticulo>('SELECT ' + COLUMNAS + ' FROM portal_articulos WHERE id = ?', clave);
    if (!f) return { status: 'error', error: 'No encontramos ese artículo.' };

    const art = artDeFila(f, true);
    if (art.estado !== 'publicado' && !puedeEditar) return { status: 'error', error: 'Ese artículo todavía es un borrador.' };
    const plano = artTextoPlano(art.contenido);
    art.palabras = plano ? plano.split(/\s+/).length : 0;
    art.minutos = Math.max(1, Math.round(art.palabras / 200));
    // En el original faltaba: la pantalla usa `bloques` para decidir entre «N min de lectura» y «Sin contenido»,
    // y el lector siempre decía «Sin contenido» en la firma aunque el artículo sí tuviera texto.
    art.bloques = ((art.contenido && art.contenido.bloques) || []).length;
    if (art.estado === 'publicado') await artRegistrarVista(ctx, clave, email);
    return { status: 'ok', articulo: art, puedeEditar };
  } catch (e: any) {
    console.error('artObtener', e);
    return { status: 'error', error: String(e) };
  }
}

// ── Escritura ───────────────────────────────────────────────────────────────

/**
 * Crea o actualiza un artículo. payload: {id?, titulo, resumen, contenido, estado?, asesor}.
 * `creado`, `autores` y el ID se conservan de la fila previa: quien corrige la errata de un artículo
 * ajeno no pasa a ser su autor. Lo que cambia en cada guardado es `editado` y `editado_por`.
 */
export async function artGuardar(ctx: Ctx, payload: any) {
  try {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const gate = await artGate(ctx, p.asesor);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const titulo = artTexto(p.titulo, ART_MAX_TITULO).trim();
    if (!titulo) return { status: 'error', error: 'El artículo necesita un título.' };
    const resumen = artTexto(p.resumen, ART_MAX_RESUMEN).trim();
    const contenido = artSanearContenido(p.contenido);

    const json = JSON.stringify(contenido);
    if (json.length > ART_MAX_JSON) {
      return { status: 'error', error: 'El artículo es demasiado largo para guardarse de una pieza. ' +
        'Divídelo en dos o quita alguna imagen pegada en grande.' };
    }

    let estado = String(p.estado || '').trim().toLowerCase();
    if (ART_ESTADOS.indexOf(estado) < 0) estado = 'borrador';

    const id = (p.id && String(p.id).trim()) || artNuevoId();
    const ahora = ctx.ahoraIso();
    const firma = gate.nombre || gate.email;
    // Una sola sentencia: si la fila ya existe, autores y creado se quedan como estaban.
    await ctx.ejecutar(
      'INSERT INTO portal_articulos (id, titulo, resumen, contenido, estado, autores, creado, editado, editado_por) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET titulo = excluded.titulo, resumen = excluded.resumen, ' +
      'contenido = excluded.contenido, estado = excluded.estado, ' +
      "autores = COALESCE(NULLIF(TRIM(portal_articulos.autores), ''), excluded.autores), " +
      "creado = COALESCE(NULLIF(portal_articulos.creado, ''), excluded.creado), " +
      'editado = excluded.editado, editado_por = excluded.editado_por',
      id, titulo, resumen, json, estado, firma, ahora, ahora, firma);
    return { status: 'ok', id, estado, bloques: contenido.bloques.length };
  } catch (e: any) {
    console.error('artGuardar', e);
    return { status: 'error', error: String(e) };
  }
}

/** Publica o devuelve a borrador. */
export async function artPublicar(ctx: Ctx, id: unknown, publicado: unknown, email: string) {
  try {
    const gate = await artGate(ctx, email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const estado = publicado ? 'publicado' : 'borrador';
    const r = await ctx.ejecutar('UPDATE portal_articulos SET estado = ?, editado = ?, editado_por = ? WHERE id = ?',
      estado, ctx.ahoraIso(), gate.nombre || gate.email, String(id == null ? '' : id).trim());
    if (!r.cambios) return { status: 'error', error: 'No encontramos ese artículo.' };
    return { status: 'ok', estado };
  } catch (e: any) {
    console.error('artPublicar', e);
    return { status: 'error', error: String(e) };
  }
}

/** Borra un artículo. Las vistas se quedan: alguien lo leyó, y ese hecho no desaparece. */
export async function artEliminar(ctx: Ctx, id: unknown, email: string) {
  try {
    const gate = await artGate(ctx, email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const r = await ctx.ejecutar('DELETE FROM portal_articulos WHERE id = ?', String(id == null ? '' : id).trim());
    if (!r.cambios) return { status: 'error', error: 'No encontramos ese artículo.' };
    return { status: 'ok' };
  } catch (e: any) {
    console.error('artEliminar', e);
    return { status: 'error', error: String(e) };
  }
}

// ── Registro de lectura ─────────────────────────────────────────────────────

/**
 * artRegistrarVista_: una fila por persona y artículo, con la primera vez, la última y cuántas.
 * Una ventana de media hora evita que refrescar la pantalla cinco veces cuente cinco lecturas. Si
 * algo falla no se registra y no pasa nada: el registro es el acompañante, no el acto.
 */
async function artRegistrarVista(ctx: Ctx, idArticulo: string, email: unknown): Promise<boolean> {
  try {
    const quien = await artQuienLee(ctx, email);
    if (!quien.ok) return false;
    const ventana = 'artVisto_' + idArticulo + '_' + quien.correo;
    try {
      if (await cacheLeer(ctx, ventana)) return false;
      await cacheGuardar(ctx, ventana, '1', 1800);
    } catch { /* sin ventana, se registra igual */ }
    const ahora = ctx.ahoraIso();
    await ctx.ejecutar(
      'INSERT INTO portal_articulos_vistas (articulo_id, correo, nombre, primera_vez, ultima_vez, veces) VALUES (?, ?, ?, ?, ?, 1) ' +
      'ON CONFLICT(articulo_id, correo) DO UPDATE SET ultima_vez = excluded.ultima_vez, ' +
      'veces = (CASE WHEN portal_articulos_vistas.veces > 0 THEN portal_articulos_vistas.veces ELSE 1 END) + 1',
      idArticulo, quien.correo, quien.nombre || '', ahora, ahora);
    return true;
  } catch (e) {
    console.error('artRegistrarVista', e);
    return false;
  }
}

/** Quién ha leído un artículo. Solo para quien puede publicarlos. */
export async function artLectores(ctx: Ctx, id: unknown, email: string) {
  try {
    const gate = await artGate(ctx, email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const clave = String(id == null ? '' : id).trim();
    const filas = await ctx.todas<{ correo: string; nombre: string | null; primera_vez: string | null; veces: number | null }>(
      'SELECT correo, nombre, primera_vez, veces FROM portal_articulos_vistas WHERE articulo_id = ? ORDER BY rowid', clave);
    const out = filas.map((f) => ({
      correo: String(f.correo || '').trim(),
      nombre: String(f.nombre || '').trim(),
      primera: f.primera_vez ? formatearFecha(f.primera_vez, 'yyyy-MM-dd HH:mm') : '',
      veces: Number(f.veces) || 1
    }));
    out.sort((a, b) => String(a.primera).localeCompare(String(b.primera)));
    return { status: 'ok', lectores: out, total: out.length };
  } catch (e: any) {
    console.error('artLectores', e);
    return { status: 'error', error: String(e) };
  }
}

// ── Imágenes ────────────────────────────────────────────────────────────────

/**
 * Sube una imagen de artículo y devuelve su URL. payload: {dataUrl, nombre, asesor}. En Apps Script
 * iba a la carpeta de anuncios en Drive; aquí va al almacén de archivos (R2) y se sirve desde el
 * mismo dominio en /archivos/….
 *
 * SVG no se acepta: allá vivía en el dominio de Drive, pero aquí se serviría desde el mismo origen
 * que la app, y un SVG puede llevar código.
 */
export async function artSubirImagen(ctx: Ctx, payload: any) {
  try {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const gate = await artGate(ctx, p.asesor);
    if (!gate.ok) return { status: 'error', error: gate.error };
    if (!p.dataUrl) return { status: 'error', error: 'No se recibió la imagen.' };
    const m = String(p.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return { status: 'error', error: 'Formato de imagen no válido.' };
    const mime = m[1].toLowerCase();
    if (mime.indexOf('image/') !== 0) return { status: 'error', error: 'El archivo no es una imagen.' };
    if (mime === 'image/svg+xml') return { status: 'error', error: 'Las imágenes SVG no se pueden subir. Usa PNG, JPG, GIF o WebP.' };
    // Tamaño real aproximado sin decodificar (3 bytes por cada 4 caracteres de base64).
    const bytes = Math.floor(m[2].replace(/=+$/, '').length * 3 / 4);
    if (bytes > 8 * 1024 * 1024) return { status: 'error', error: 'La imagen supera el límite de 8 MB.' };

    const nombre = 'art-' + String(p.nombre || 'imagen').replace(/[^\w.\-]+/g, '_') + '-' + Date.now();
    const archivo = await guardarArchivo(ctx, {
      datos: String(p.dataUrl), tipo: mime, nombre, carpeta: 'articulos', subidoPor: gate.email, maxBytes: 8 * 1024 * 1024
    });
    return { status: 'ok', url: archivo.url };
  } catch (e: any) {
    console.error('artSubirImagen', e);
    return { status: 'error', error: String(e) };
  }
}

// ── Índice para el buscador general ─────────────────────────────────────────

/**
 * Título, resumen y un extracto del texto de cada artículo publicado, para el buscador general.
 * Sin sesión devuelve vacío (no error): quien busca desde el Portal público no ve artículos. Sin
 * caché: D1 lee la tabla directo.
 */
export async function artIndiceBuscador(ctx: Ctx, email: string) {
  try {
    if (!(await artHaySesion(ctx, email))) return { status: 'ok', articulos: [] };
    const filas = await ctx.todas<FilaArticulo>(
      "SELECT " + COLUMNAS + " FROM portal_articulos WHERE lower(trim(estado)) = 'publicado' ORDER BY rowid");
    const resp: { status: string; articulos: Array<Record<string, string>> } = { status: 'ok', articulos: [] };
    for (const f of filas) {
      const id = String(f.id || '').trim();
      if (!id) continue;
      resp.articulos.push({
        id,
        titulo: String(f.titulo || '').trim(),
        resumen: String(f.resumen || '').trim(),
        texto: artTextoPlano(contenidoDe(f)).slice(0, 1200)
      });
    }
    return resp;
  } catch (e: any) {
    console.error('artIndiceBuscador', e);
    return { status: 'error', error: String(e), articulos: [] };
  }
}

/** Para la revisión del sistema: cuántos artículos y lecturas hay. */
export async function artResumenSalud(ctx: Ctx): Promise<{ articulos: number; vistas: number }> {
  const [a, v] = await Promise.all([
    ctx.una<{ n: number }>('SELECT COUNT(*) AS n FROM portal_articulos'),
    ctx.una<{ n: number }>('SELECT COUNT(*) AS n FROM portal_articulos_vistas')
  ]);
  return { articulos: Number((a && a.n) || 0), vistas: Number((v && v.n) || 0) };
}
