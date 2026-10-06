/**
 * PORTAL · contenido (pantalla «Contenido del Portal») | Portal Ventel en Cloudflare
 * ==================================================================================
 * Port de PortalContenido.gs y de la parte expuesta de PortalPromosComercial.gs.
 *
 * El CATÁLOGO declarativo (PC_COLECCIONES) es el mismo, palabra por palabra: describe cada sección,
 * sus campos, cómo se llaman en pantalla y qué se valida. Lo que cambia es dónde vive cada sección:
 * cada pestaña de la hoja del Portal es una tabla portal_* y cada campo una columna (snake_case:
 * comoAcceder → como_acceder, promocionMkt → promocion_mkt). Con eso se caen solas tres cosas que en
 * la hoja había que cuidar a mano:
 *   · pcAsegurarIds_: toda fila tiene ID (clave primaria). Las filas se identifican por ID, nunca
 *     por posición, igual que allá.
 *   · Las columnas ya no se localizan por alias de encabezado en la HOJA (tienen nombre fijo), así
 *     que `camposSinColumna` siempre va vacío. Los alias siguen viajando al cliente: con ellos el
 *     modo rápido reconoce los encabezados que pega la persona (y aquí, pcEntradaImport los usa con
 *     pcMapaColumnas para las filas que lleguen con encabezados en vez de ids de campo).
 *   · pcConLock_: cada escritura es una sentencia atómica (o un lote en transacción).
 * Se escribe SOLO en las columnas del catálogo: Promociones y MKP tienen columnas que esta pantalla
 * no toca (SKUS Mercaderías, banners de home…) y se quedan como estaban.
 *
 * PERMISO: el bloque 'portal_contenido', exigido en CADA operación.
 */
import type { Ctx } from '../../nucleo/contexto';
import { apuntarBitacora } from '../../nucleo/sistema';
import { formatearFecha, aFecha } from '../../nucleo/fechas';
import { nuevoId } from '../../nucleo/util';
import { puertaBloque, mensajeError, type Puerta } from './comun';

/** Bloque de permisos que exige TODA operación de este archivo. */
const PC_BLOQUE = 'portal_contenido';

/** Tope de filas que se mandan a la pantalla de una sola vez. */
const PC_LIMITE_FILAS = 400;

/** Tope de filas por importación. */
const PC_IMPORT_MAX = 300;

// ── CATÁLOGO DE SECCIONES ───────────────────────────────────────────────────

interface Campo {
  id: string; etiqueta: string; alias: string[]; tipo: 'texto' | 'parrafo' | 'url';
  requerido?: boolean; max?: number; ayuda?: string; sugerencias?: string[];
  /** Columna de la tabla (solo servidor). */
  columna: string;
  /** La celda guarda una fecha ISO que se enseña como 'dd/MM/yyyy HH:mm' (solo servidor). */
  esFecha?: boolean;
}

interface Coleccion {
  id: string; nombre: string; hoja: string; resumen: string; donde: string; prefijo: string;
  titulo: string; subtitulo: string; enlaceCampo: string;
  ordenable: boolean; duplicable: boolean; soloLectura: boolean;
  clave: string[];
  campos: Campo[];
  /** Tabla de D1 que sustituye a la pestaña (solo servidor). */
  tabla: string;
}

/*
 * IMPORTANTE (como en el original): los alias son los mismos con los que se LEÍA cada columna. Ahora
 * los usa el cliente para reconocer lo que se pega, y pcEntradaImport para las filas con encabezados.
 */
const PC_COLECCIONES: Coleccion[] = [
  {
    id: 'herramientas',
    nombre: 'Herramientas',
    hoja: 'Herramientas',
    tabla: 'portal_herramientas',
    resumen: 'Los accesos del día a día: CSC, Salesforce, SOMS, rastreos.',
    donde: 'Portal → Herramientas (y los accesos directos del inicio)',
    prefijo: 'htl',
    titulo: 'nombre', subtitulo: 'descripcion', enlaceCampo: 'enlace',
    ordenable: true, duplicable: true, soloLectura: false,
    clave: ['nombre'],
    campos: [
      { id: 'nombre', columna: 'nombre', etiqueta: 'Nombre', alias: ['nombre'], tipo: 'texto',
        requerido: true, max: 120,
        ayuda: 'Como lo busca el asesor. Corto y reconocible: «Salesforce», no «CRM de la operación».' },
      { id: 'enlace', columna: 'enlace', etiqueta: 'Enlace', alias: ['enlace', 'liga', 'link', 'url'], tipo: 'url', max: 800,
        ayuda: 'Pega la dirección completa. Es lo que abre el botón de la tarjeta.' },
      { id: 'comoAcceder', columna: 'como_acceder', etiqueta: 'Cómo acceder', alias: ['acceder', 'acceso', 'como'], tipo: 'parrafo', max: 400,
        ayuda: 'Con qué credenciales se entra. Ej. «Número de empleado | Liverpool1».' },
      { id: 'descripcion', columna: 'descripcion', etiqueta: 'Descripción', alias: ['descr'], tipo: 'parrafo', max: 900,
        ayuda: 'Para qué sirve. Dos o tres líneas bastan.' },
      { id: 'claves', columna: 'claves', etiqueta: 'Claves', alias: ['clave'], tipo: 'parrafo', max: 300,
        ayuda: 'Palabras con las que alguien podría buscarla aunque no recuerde el nombre.' }
    ]
  },
  {
    id: 'plantillas',
    nombre: 'Plantillas de correo',
    hoja: 'Plantillas',
    tabla: 'portal_plantillas',
    resumen: 'Los textos que el asesor copia para escribirle a un cliente o a supervisión.',
    donde: 'Portal → Plantillas · y la pantalla «Correos a clientes»',
    prefijo: 'plt',
    titulo: 'titulo', subtitulo: 'asunto', enlaceCampo: '',
    ordenable: true, duplicable: true, soloLectura: false,
    clave: ['titulo'],
    campos: [
      { id: 'titulo', columna: 'titulo', etiqueta: 'Título', alias: ['titulo', 'título', 'nombre', 'plantilla'], tipo: 'texto',
        requerido: true, max: 140,
        ayuda: 'Qué resuelve la plantilla. Ej. «Diferir pago».' },
      { id: 'tipo', columna: 'tipo', etiqueta: 'Tipo', alias: ['tipo'], tipo: 'texto', max: 60,
        sugerencias: ['Correo', 'Chat', 'WhatsApp', 'Interno'],
        ayuda: 'Por dónde se manda. Sirve para agrupar en el portal.' },
      { id: 'asunto', columna: 'asunto', etiqueta: 'Asunto', alias: ['asunto', 'subject'], tipo: 'texto', max: 250,
        ayuda: 'Los corchetes se quedan tal cual: [Numero de pedido] le avisa al asesor qué reemplazar.' },
      { id: 'cuerpo', columna: 'cuerpo', etiqueta: 'Cuerpo', alias: ['cuerpo', 'body', 'mensaje', 'texto', 'contenido'], tipo: 'parrafo',
        requerido: true, max: 6000,
        ayuda: 'El texto completo. Los saltos de línea se respetan.' },
      { id: 'consideraciones', columna: 'consideraciones', etiqueta: 'Consideraciones', alias: ['consider', 'nota', 'escalam', 'copia', 'observ'],
        tipo: 'parrafo', max: 900,
        ayuda: 'A quién va, a quién se copia, qué NO se debe prometer.' }
    ]
  },
  {
    id: 'formatos',
    nombre: 'Formatos',
    hoja: 'Formatos',
    tabla: 'portal_formatos',
    resumen: 'Las hojas y formularios que el equipo tiene que llenar.',
    donde: 'Portal → Formatos',
    prefijo: 'fmt',
    titulo: 'acceso', subtitulo: 'observaciones', enlaceCampo: 'liga',
    ordenable: true, duplicable: true, soloLectura: false,
    clave: ['acceso'],
    campos: [
      { id: 'acceso', columna: 'acceso', etiqueta: 'Nombre del formato', alias: ['acceso', 'nombre', 'formato'], tipo: 'texto',
        requerido: true, max: 140,
        ayuda: 'Ej. «Justificación de retardos».' },
      { id: 'observaciones', columna: 'observaciones', etiqueta: 'Observaciones', alias: ['observ', 'nota'], tipo: 'parrafo', max: 600,
        ayuda: 'La regla que hay que saber ANTES de llenarlo. Ej. «Subir el mismo día de la incidencia».' },
      { id: 'liga', columna: 'liga', etiqueta: 'Enlace', alias: ['liga', 'enlace', 'link', 'url'], tipo: 'url', max: 800 }
    ]
  },
  {
    id: 'presentaciones',
    nombre: 'Presentaciones',
    hoja: 'Presentaciones',
    tabla: 'portal_presentaciones',
    resumen: 'El material de capacitación que se comparte con el equipo.',
    donde: 'Portal → Presentaciones',
    prefijo: 'prs',
    titulo: 'nombre', subtitulo: 'descripcion', enlaceCampo: 'liga',
    ordenable: true, duplicable: true, soloLectura: false,
    clave: ['nombre'],
    campos: [
      { id: 'nombre', columna: 'nombre', etiqueta: 'Nombre', alias: ['nombre'], tipo: 'texto', requerido: true, max: 140 },
      { id: 'liga', columna: 'liga', etiqueta: 'Enlace', alias: ['liga', 'enlace', 'link', 'url'], tipo: 'url', max: 800,
        ayuda: 'Comprueba que esté compartida con el dominio, o al asesor le saldrá «Solicitar acceso».' },
      // El encabezado real de la hoja dice «DESCRPCION» (sin la i): por eso el alias es 'descr'.
      { id: 'descripcion', columna: 'descripcion', etiqueta: 'Descripción', alias: ['descr'], tipo: 'parrafo', max: 600 }
    ]
  },
  {
    id: 'paqueterias',
    nombre: 'Paqueterías',
    hoja: 'Paqueterias',
    tabla: 'portal_paqueterias',
    resumen: 'Los rastreos de las paqueterías y su clave en SOMS.',
    donde: 'Portal → Paqueterías',
    prefijo: 'pqt',
    titulo: 'nombre', subtitulo: 'soms', enlaceCampo: 'liga',
    ordenable: true, duplicable: true, soloLectura: false,
    // Una paquetería sale VARIAS veces, una por clave SOMS: la identidad es el par.
    clave: ['nombre', 'soms'],
    campos: [
      { id: 'nombre', columna: 'nombre', etiqueta: 'Paquetería', alias: ['nombre'], tipo: 'texto', requerido: true, max: 120 },
      { id: 'liga', columna: 'liga', etiqueta: 'Enlace de rastreo', alias: ['liga', 'enlace', 'link', 'url'], tipo: 'url', max: 800 },
      { id: 'soms', columna: 'soms', etiqueta: 'Clave SOMS', alias: ['soms', 'sistema'], tipo: 'texto', max: 60,
        ayuda: 'La clave con la que aparece en el sistema. Una paquetería puede tener varias: una fila por clave.' }
    ]
  },
  {
    id: 'pdepago',
    nombre: 'Planes de pago',
    hoja: 'PdePago',
    tabla: 'portal_pdepago',
    resumen: 'Cómo puede pagar el cliente y qué implica cada opción.',
    donde: 'Portal → Planes de pago',
    prefijo: 'pdp',
    titulo: 'nombre', subtitulo: 'detalles', enlaceCampo: 'liga',
    ordenable: true, duplicable: true, soloLectura: false,
    clave: ['nombre'],
    campos: [
      { id: 'nombre', columna: 'nombre', etiqueta: 'Plan', alias: ['nombre'], tipo: 'texto', requerido: true, max: 140 },
      { id: 'detalles', columna: 'detalles', etiqueta: 'Detalles', alias: ['detalle', 'descrip', 'info'], tipo: 'parrafo', max: 900,
        ayuda: 'Explícalo como se lo dirías al cliente.' },
      { id: 'liga', columna: 'liga', etiqueta: 'Simulador o enlace', alias: ['liga', 'enlace', 'link', 'url', 'simulad'],
        tipo: 'url', max: 800 }
    ]
  },
  {
    id: 'promociones',
    nombre: 'Promociones',
    hoja: 'Promociones',
    tabla: 'portal_promociones',
    resumen: 'La promoción vigente por categoría. Alimenta el monitor y el contador del inicio.',
    donde: 'Monitor de promociones · y el widget «Hoy en promociones»',
    prefijo: 'pro',
    titulo: 'categoria', subtitulo: 'direccion,promocion', enlaceCampo: 'liga',
    // Sin reordenar: la ordena el equipo comercial por criterio propio.
    ordenable: false, duplicable: true, soloLectura: false,
    // «Bolsas» de Mujer y «Bolsas» de Hombre son dos promociones distintas.
    clave: ['direccion', 'categoria'],
    campos: [
      { id: 'direccion', columna: 'direccion', etiqueta: 'Dirección', alias: ['direcci'], tipo: 'texto', requerido: true, max: 80,
        sugerencias: ['Mujer', 'Hombre', 'Niños', 'Hogar', 'Belleza', 'Electrónica', 'Deportes'],
        ayuda: 'La gran división comercial. Es lo que agrupa las tarjetas del monitor.' },
      { id: 'categoria', columna: 'categoria', etiqueta: 'Categoría', alias: ['banner / carrusel', 'banner'], tipo: 'texto', max: 120,
        ayuda: 'La categoría concreta: «Bolsas», «Jeans», «Tenis».' },
      // NINGÚN alias puede casar con «Promoción AA 2025 (Referencia…)», la columna del año anterior.
      { id: 'promocion', columna: 'promocion', etiqueta: 'Promoción',
        alias: ['promoción 2026', 'promocion 2026', 'promoción 202', 'promocion 202', '=promoción', '=promocion'],
        tipo: 'parrafo', max: 400,
        ayuda: 'Tal como se le dice al cliente. Ej. «Hasta 50% de descuento y 6 MSI».' },
      // Coincidencia EXACTA a propósito: con "contiene" caería en «Desc Mkp (Se MARCA el cuadro…)».
      { id: 'marca', columna: 'marca', etiqueta: 'Marca', alias: ['=marca'], tipo: 'texto', max: 120 },
      { id: 'vigencia', columna: 'vigencia', etiqueta: 'Vigencia', alias: ['vigencia'], tipo: 'texto', max: 120,
        sugerencias: ['1 al 15 de enero', '10 al 23 de julio'],
        ayuda: 'Escríbela como «10 al 23 de julio». Con ese formato el sistema sabe si sigue viva y la cuenta como activa.' },
      { id: 'liga', columna: 'liga', etiqueta: 'Enlace', alias: ['liga'], tipo: 'url', max: 800,
        ayuda: 'La página de la categoría en liverpool.com.mx.' }
    ]
  },
  {
    id: 'mkp',
    nombre: 'Marketplace',
    hoja: 'MKP',
    tabla: 'portal_mkp',
    resumen: 'Lo mismo que Promociones, pero de Marketplace.',
    donde: 'Monitor de promociones (marcadas como «Marketplace»)',
    prefijo: 'mkp',
    titulo: 'categoria', subtitulo: 'direccion,promocionMkt', enlaceCampo: 'liga',
    ordenable: false, duplicable: true, soloLectura: false,
    clave: ['direccion', 'categoria'],
    campos: [
      { id: 'direccion', columna: 'direccion', etiqueta: 'Dirección', alias: ['direcci'], tipo: 'texto', requerido: true, max: 80,
        sugerencias: ['Mujer', 'Hombre', 'Niños', 'Hogar', 'Belleza', 'Electrónica', 'Deportes'] },
      { id: 'categoria', columna: 'categoria', etiqueta: 'Categoría', alias: ['banner / carrusel', 'banner'], tipo: 'texto', max: 120 },
      { id: 'promocionMkt', columna: 'promocion_mkt', etiqueta: 'Promoción (la que se publica)', alias: ['promoción mktplace', 'mktplace'],
        tipo: 'parrafo', max: 400,
        ayuda: 'Si este campo tiene algo, es LO QUE VE el asesor en el monitor. Manda sobre el de abajo.' },
      { id: 'promocion', columna: 'promocion', etiqueta: 'Promoción (respaldo)', alias: ['=promoción', '=promocion'], tipo: 'parrafo', max: 400,
        ayuda: 'Solo se publica cuando el de arriba está vacío.' },
      { id: 'vigencia', columna: 'vigencia', etiqueta: 'Vigencia', alias: ['vigencia'], tipo: 'texto', max: 120,
        ayuda: 'Formato recomendado: «10 al 23 de julio».' },
      { id: 'liga', columna: 'liga', etiqueta: 'Enlace', alias: ['liga'], tipo: 'url', max: 800 }
    ]
  },
  {
    id: 'reportes',
    nombre: 'Enlaces reportados',
    hoja: 'Reportes',
    tabla: 'portal_reportes',
    resumen: 'Lo que el equipo marcó como roto desde el botón «Reportar» del Portal.',
    donde: 'Lo levantan los asesores desde las tarjetas del Portal',
    prefijo: 'rep',
    titulo: 'nombre', subtitulo: 'seccion', enlaceCampo: 'enlace',
    // Es una bandeja de entrada, no un catálogo: llega sola, se atiende y se archiva.
    ordenable: false, duplicable: false, soloLectura: true,
    clave: ['enlace'],
    campos: [
      { id: 'fecha', columna: 'fecha', esFecha: true, etiqueta: 'Fecha', alias: ['fecha'], tipo: 'texto', max: 60 },
      { id: 'seccion', columna: 'seccion', etiqueta: 'Sección', alias: ['secci'], tipo: 'texto', max: 120 },
      { id: 'nombre', columna: 'nombre', etiqueta: 'Qué se reportó', alias: ['nombre'], tipo: 'texto', max: 200 },
      { id: 'enlace', columna: 'enlace', etiqueta: 'Enlace', alias: ['enlace', 'liga', 'link', 'url'], tipo: 'url', max: 800 },
      { id: 'usuario', columna: 'usuario', etiqueta: 'Quién lo reportó', alias: ['usuario', 'correo'], tipo: 'texto', max: 200 }
    ]
  }
];

/** Busca una sección del catálogo por su id. null si no existe. */
function pcColeccion(id: unknown): Coleccion | null {
  const clave = String(id || '').trim().toLowerCase();
  return PC_COLECCIONES.find((c) => c.id === clave) || null;
}

/** El campo marcado como requerido (el que decide si una fila "existe"). */
function pcCampoRequerido(col: Coleccion): Campo {
  return col.campos.find((c) => c.requerido) || col.campos[0];
}

/** Campos que identifican una fila de esta sección. */
function pcCamposClave(col: Coleccion): string[] {
  return (col.clave && col.clave.length) ? col.clave : [col.titulo];
}

function pcCampo(col: Coleccion, id: string): Campo | undefined {
  return col.campos.find((c) => c.id === id);
}

// ── Puerta y bitácora ───────────────────────────────────────────────────────

function pcGate(ctx: Ctx, email: unknown): Promise<Puerta> {
  return puertaBloque(ctx, email, PC_BLOQUE);
}

/** Apunta el cambio en la bitácora de la Consola. Nunca tumba la operación. */
async function pcApuntar(ctx: Ctx, quien: string, accion: string, coleccion: string, detalle: unknown) {
  await apuntarBitacora(ctx, quien, accion, 'Portal · ' + coleccion, detalle || '');
}

// ── Localización de columnas por encabezado (los alias) ─────────────────────

/** Normaliza un encabezado para compararlo: minúsculas, sin espacios sobrantes. */
function pcNormHdr(v: unknown): string {
  return String(v == null ? '' : v).toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Para cada campo del catálogo, en qué posición de `hdr` está (pcMapaColumnas_): el encabezado
 * CONTIENE el alias; un alias con '=' exige coincidencia exacta; gana el primer alias que encuentra
 * columna, y una columna se asigna UNA sola vez.
 */
export function pcMapaColumnas(col: Coleccion, hdr: unknown[]): Record<string, number> {
  const h = hdr.map(pcNormHdr);
  const tomadas: Record<number, boolean> = {};
  const mapa: Record<string, number> = {};
  col.campos.forEach((campo) => {
    let encontrada = -1;
    for (let a = 0; a < campo.alias.length && encontrada < 0; a++) {
      const alias = campo.alias[a];
      const exacto = alias.charAt(0) === '=';
      const buscado = pcNormHdr(exacto ? alias.slice(1) : alias);
      for (let c = 0; c < h.length; c++) {
        if (tomadas[c] || !h[c]) continue;
        const coincide = exacto ? (h[c] === buscado) : (h[c].indexOf(buscado) !== -1);
        if (coincide) { encontrada = c; break; }
      }
    }
    mapa[campo.id] = encontrada;
    if (encontrada > -1) tomadas[encontrada] = true;
  });
  return mapa;
}

// ── Validación ──────────────────────────────────────────────────────────────

/** Revisa y normaliza un enlace (pcNormalizarUrl_). */
function pcNormalizarUrl(valor: unknown): { ok: true; valor: string; aviso: string } | { ok: false; error: string } {
  const s = String(valor == null ? '' : valor).trim();
  if (!s) return { ok: true, valor: '', aviso: '' };
  if (/^\s*(javascript|data|vbscript|file|blob)\s*:/i.test(s)) {
    return { ok: false, error: 'Ese tipo de enlace no se permite. Usa una dirección http:// o https://.' };
  }
  if (/^https?:\/\//i.test(s)) {
    if (/\s/.test(s)) return { ok: false, error: 'La dirección tiene espacios. Pégala completa, sin cortarla.' };
    return { ok: true, valor: s, aviso: '' };
  }
  if (/^[\w.-]+\.[a-z]{2,}([\/?#].*)?$/i.test(s)) return { ok: true, valor: 'https://' + s, aviso: '' };
  return { ok: true, valor: s, aviso: 'Esto no parece una dirección web, así que el botón del portal no va a abrir nada.' };
}

interface Revision { ok: boolean; valores: Record<string, string>; avisos: string[]; errores: Record<string, string> }

/** Valida los datos que llegan del cliente contra el catálogo (pcValidar_). */
function pcValidar(col: Coleccion, datos: any): Revision {
  const valores: Record<string, string> = {};
  const errores: Record<string, string> = {};
  const avisos: string[] = [];
  const entrada = (datos && typeof datos === 'object') ? datos : {};

  col.campos.forEach((campo) => {
    let v = String(entrada[campo.id] == null ? '' : entrada[campo.id]).trim();
    if (campo.tipo === 'url') {
      const r = pcNormalizarUrl(v);
      if (!r.ok) { errores[campo.id] = r.error; return; }
      v = r.valor;
      if (r.aviso) avisos.push(campo.etiqueta + ': ' + r.aviso);
    }
    if (campo.requerido && !v) { errores[campo.id] = 'Este campo no puede quedar vacío.'; return; }
    if (campo.max && v.length > campo.max) {
      errores[campo.id] = 'Máximo ' + campo.max + ' caracteres (llevas ' + v.length + ').';
      return;
    }
    valores[campo.id] = v;
  });
  return { ok: Object.keys(errores).length === 0, valores, avisos, errores };
}

// ── Lectura ─────────────────────────────────────────────────────────────────

/** Valor de una celda para la pantalla (pcTexto_): las fechas, legibles en hora de México. */
function pcTexto(v: unknown, campo?: Campo): string {
  if (campo && campo.esFecha && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = aFecha(v);
    if (d) return formatearFecha(d, 'dd/MM/yyyy HH:mm');
  }
  return String(v == null ? '' : v).trim();
}

/** Todas las filas de una sección, en el orden en que las ve el asesor. */
async function pcFilas(ctx: Ctx, col: Coleccion): Promise<Record<string, any>[]> {
  return ctx.todas('SELECT * FROM ' + col.tabla + ' ORDER BY orden, rowid');
}

function pcValoresDe(col: Coleccion, fila: Record<string, any>): Record<string, string> {
  const valores: Record<string, string> = {};
  col.campos.forEach((c) => { valores[c.id] = pcTexto(fila[c.columna], c); });
  return valores;
}

function pcViva(col: Coleccion, fila: Record<string, any>): boolean {
  return String(fila[pcCampoRequerido(col).columna] == null ? '' : fila[pcCampoRequerido(col).columna]).trim() !== '';
}

/** Expresión SQL «el campo requerido tiene algo» (mismo criterio que pcViva). */
function pcSqlViva(col: Coleccion): string {
  return "trim(coalesce(" + pcCampoRequerido(col).columna + ", ''), ' ' || char(9) || char(10) || char(13)) <> ''";
}

/**
 * Catálogo de secciones con el conteo de cada una: es lo que pinta el conmutador. Sin caché: el
 * conteo es UNA consulta a D1.
 */
export async function portalContenidoCatalogo(ctx: Ctx, email: string) {
  try {
    const gate = await pcGate(ctx, email);
    if (!gate.ok) return { status: 'error', error: gate.error };

    const conteos: Record<string, number> = {};
    try {
      // Una sola fila con un conteo por sección (D1 no admite un UNION ALL de nueve términos).
      const sql = 'SELECT ' + PC_COLECCIONES.map((col) =>
        '(SELECT COUNT(*) FROM ' + col.tabla + ' WHERE ' + pcSqlViva(col) + ') AS ' + col.id).join(', ');
      const fila = await ctx.una<Record<string, number>>(sql);
      PC_COLECCIONES.forEach((col) => { conteos[col.id] = Number(fila && fila[col.id]) || 0; });
    } catch (e) {
      console.error('portalContenidoCatalogo (conteos)', e);
      PC_COLECCIONES.forEach((col) => { conteos[col.id] = -1; });   // -1 = no se pudo contar
    }

    return {
      status: 'ok',
      quien: gate.nombre || gate.email,
      colecciones: PC_COLECCIONES.map((col) => ({
        id: col.id, nombre: col.nombre, hoja: col.hoja, resumen: col.resumen, donde: col.donde,
        ordenable: !!col.ordenable, duplicable: !!col.duplicable, soloLectura: !!col.soloLectura,
        titulo: col.titulo, subtitulo: col.subtitulo, enlaceCampo: col.enlaceCampo,
        total: conteos[col.id] === undefined ? 0 : conteos[col.id],
        clave: pcCamposClave(col),
        campos: col.campos.map((c) => ({
          id: c.id, etiqueta: c.etiqueta, tipo: c.tipo, requerido: !!c.requerido,
          max: c.max || 0, ayuda: c.ayuda || '', sugerencias: c.sugerencias || [],
          // Los alias viajan para que el modo rápido reconozca los encabezados pegados con EL MISMO
          // criterio del servidor.
          alias: c.alias || []
        }))
      }))
    };
  } catch (error) {
    console.error('portalContenidoCatalogo', error);
    return { status: 'error', error: 'No pudimos leer las secciones del Portal. Inténtalo de nuevo.' };
  }
}

/** Filas de una sección, en el orden en que las ve el asesor. @param p {email, coleccion} */
export async function portalContenidoListar(ctx: Ctx, p: any) {
  try {
    const gate = await pcGate(ctx, p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const col = pcColeccion(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };

    const datos = await pcFilas(ctx, col);
    if (!datos.length) return { status: 'ok', filas: [], truncado: false, total: 0 };

    const filas: Array<{ id: string; fila: number; valores: Record<string, string> }> = [];
    for (let i = 0; i < datos.length; i++) {
      if (!pcViva(col, datos[i])) continue;
      // `fila` era el número de fila en la hoja; aquí, la posición equivalente (informativa).
      filas.push({ id: String(datos[i].id || '').trim(), fila: i + 2, valores: pcValoresDe(col, datos[i]) });
      if (filas.length >= PC_LIMITE_FILAS) break;
    }
    return {
      status: 'ok',
      filas,
      total: filas.length,
      truncado: filas.length >= PC_LIMITE_FILAS,
      // En D1 cada campo del catálogo tiene su columna: nunca falta ninguna.
      camposSinColumna: [] as string[]
    };
  } catch (error) {
    console.error('portalContenidoListar', error);
    return { status: 'error', error: mensajeError(error) };
  }
}

// ── Escritura ───────────────────────────────────────────────────────────────

/**
 * Alta o edición de una fila. Escribe SOLO las columnas del catálogo; las demás se quedan como
 * estaban. @param p {email, coleccion, id?, datos}
 */
export async function portalContenidoGuardar(ctx: Ctx, p: any) {
  try {
    const gate = await pcGate(ctx, p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const col = pcColeccion(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };
    if (col.soloLectura) return { status: 'error', error: 'La sección «' + col.nombre + '» no se edita desde aquí.' };

    const check = pcValidar(col, p && p.datos);
    if (!check.ok) return { status: 'error', error: 'Revisa los campos marcados.', errores: check.errores };

    const idEntrada = String((p && p.id) || '').trim();
    let id = idEntrada;
    let esNueva = false;
    const columnas = col.campos.map((c) => c.columna);
    const valores = col.campos.map((c) => check.valores[c.id]);

    if (idEntrada) {
      const r = await ctx.ejecutar(
        'UPDATE ' + col.tabla + ' SET ' + columnas.map((c) => c + ' = ?').join(', ') + ' WHERE id = ?',
        ...valores, idEntrada);
      if (!r.cambios) {
        // El id venía pero ya no está: alguien la borró mientras esta pestaña la tenía abierta.
        // Volver a crearla en silencio duplicaría lo que otra persona quitó a propósito.
        return { status: 'error',
                 error: 'Esa fila ya no existe: alguien la borró desde la hoja mientras la tenías abierta. Recarga la lista.' };
      }
    } else {
      esNueva = true;
      id = nuevoId(col.prefijo);
      // Al final de la sección, como appendRow: el orden se calcula dentro de la misma sentencia.
      await ctx.ejecutar(
        'INSERT INTO ' + col.tabla + ' (id, orden, ' + columnas.join(', ') + ') VALUES (?, ' +
        '(SELECT COALESCE(MAX(orden), -1) + 1 FROM ' + col.tabla + '), ' + columnas.map(() => '?').join(', ') + ')',
        id, ...valores);
    }

    const rotulo = check.valores[col.titulo] || id;
    await pcApuntar(ctx, gate.email, esNueva ? 'Portal: alta de contenido' : 'Portal: edición de contenido', col.nombre, rotulo);
    return { status: 'ok', id, nueva: esNueva, avisos: check.avisos };
  } catch (error) {
    console.error('portalContenidoGuardar', error);
    return { status: 'error', error: mensajeError(error) };
  }
}

/** Borra una fila. @param p {email, coleccion, id} */
export async function portalContenidoEliminar(ctx: Ctx, p: any) {
  try {
    const gate = await pcGate(ctx, p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const col = pcColeccion(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };

    const id = String((p && p.id) || '').trim();
    // El rótulo se toma en la MISMA sentencia que borra: después ya no hay de dónde sacarlo.
    const titulo = pcCampo(col, col.titulo);
    const borrada = await ctx.una<{ rotulo: unknown }>(
      'DELETE FROM ' + col.tabla + ' WHERE id = ? RETURNING ' + (titulo ? titulo.columna : 'id') + ' AS rotulo', id);
    if (!borrada) return { status: 'error', error: 'Esa fila ya no existe. Recarga la lista.' };

    await pcApuntar(ctx, gate.email, 'Portal: baja de contenido', col.nombre, titulo ? pcTexto(borrada.rotulo, titulo) : id);
    return { status: 'ok' };
  } catch (error) {
    console.error('portalContenidoEliminar', error);
    return { status: 'error', error: mensajeError(error) };
  }
}

/**
 * Copia una fila justo debajo de la original, con un id nuevo. Copia la FILA ENTERA (también las
 * columnas que esta pantalla no gestiona). @param p {email, coleccion, id}
 */
export async function portalContenidoDuplicar(ctx: Ctx, p: any) {
  try {
    const gate = await pcGate(ctx, p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const col = pcColeccion(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };
    if (!col.duplicable) return { status: 'error', error: 'Esta sección no admite duplicar.' };

    const idOrigen = String((p && p.id) || '').trim();
    const fila = await ctx.una<Record<string, any>>('SELECT * FROM ' + col.tabla + ' WHERE id = ?', idOrigen);
    if (!fila) return { status: 'error', error: 'Esa fila ya no existe. Recarga la lista.' };

    const id = nuevoId(col.prefijo);
    const copia: Record<string, any> = Object.assign({}, fila, { id });
    // El título lleva "(copia)" para que las dos filas no sean indistinguibles en la lista.
    const campoTit = pcCampo(col, col.titulo);
    if (campoTit) {
      const tope = campoTit.max || 140;
      let nuevo = String(fila[campoTit.columna] == null ? '' : fila[campoTit.columna]) + ' (copia)';
      if (nuevo.length > tope) nuevo = nuevo.slice(0, tope - 8).trim() + ' (copia)';
      copia[campoTit.columna] = nuevo;
    }
    const columnas = Object.keys(copia).filter((k) => /^[a-z_][a-z0-9_]*$/i.test(k) && k !== 'orden');

    // Justo debajo de la original (insertRowAfter): se corren las de abajo y la copia ocupa orden + 1.
    await ctx.lote([
      ['UPDATE ' + col.tabla + ' SET orden = orden + 1 WHERE orden > (SELECT orden FROM ' + col.tabla + ' WHERE id = ?)', idOrigen],
      ['INSERT INTO ' + col.tabla + ' (orden, ' + columnas.join(', ') + ') VALUES (' +
        '(SELECT orden + 1 FROM ' + col.tabla + ' WHERE id = ?), ' + columnas.map(() => '?').join(', ') + ')',
        idOrigen, ...columnas.map((k) => copia[k])]
    ]);

    await pcApuntar(ctx, gate.email, 'Portal: duplicado de contenido', col.nombre, campoTit ? copia[campoTit.columna] : id);
    return { status: 'ok', id };
  } catch (error) {
    console.error('portalContenidoDuplicar', error);
    return { status: 'error', error: mensajeError(error) };
  }
}

/**
 * Sube o baja una fila un puesto respecto a la lista VISIBLE (las que tienen el campo requerido).
 * El Portal pinta las tarjetas en ese orden: mover la fila ES cambiar lo que el asesor ve primero.
 * @param p {email, coleccion, id, dir}  dir: 'up' | 'down'
 */
export async function portalContenidoMover(ctx: Ctx, p: any) {
  try {
    const gate = await pcGate(ctx, p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const col = pcColeccion(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };
    if (!col.ordenable) return { status: 'error', error: 'El orden de esta sección se lleva desde la hoja.' };

    const dir = String((p && p.dir) || '').toLowerCase();
    if (dir !== 'up' && dir !== 'down') return { status: 'error', error: 'Dirección no válida.' };

    const req = pcCampoRequerido(col).columna;
    const datos = await ctx.todas<Record<string, any>>(
      'SELECT id, orden, ' + req + ' AS req FROM ' + col.tabla + ' ORDER BY orden, rowid');
    if (datos.length < 2) return { status: 'ok' };              // 0 o 1 filas: nada que mover

    const visibles = datos.filter((d) => String(d.req == null ? '' : d.req).trim() !== '');
    const pos = visibles.map((v) => String(v.id || '').trim()).indexOf(String((p && p.id) || '').trim());
    if (pos < 0) return { status: 'error', error: 'Esa fila ya no existe. Recarga la lista.' };
    const destinoPos = dir === 'up' ? pos - 1 : pos + 1;
    if (destinoPos < 0 || destinoPos >= visibles.length) return { status: 'ok' }; // ya está en el borde

    const a = visibles[pos], b = visibles[destinoPos];
    const ordenes = datos.map((d) => Number(d.orden));
    const unicos = ordenes.every((o, i) => Number.isFinite(o) && (i === 0 || o > ordenes[i - 1]));
    if (unicos) {
      // Lo normal: se intercambian los dos «orden».
      await ctx.ejecutar('UPDATE ' + col.tabla + ' SET orden = CASE id WHEN ? THEN ? WHEN ? THEN ? END WHERE id IN (?, ?)',
        a.id, Number(b.orden), b.id, Number(a.orden), a.id, b.id);
    } else {
      // Órdenes repetidos (filas cargadas sin él): se renumera la sección entera con el cambio hecho.
      const ids = datos.map((d) => d.id);
      const ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
      ids[ia] = b.id; ids[ib] = a.id;
      await ctx.ejecutar(
        'UPDATE ' + col.tabla + ' SET orden = CAST(j.key AS INTEGER) FROM json_each(?1) AS j WHERE ' + col.tabla + '.id = j.value',
        JSON.stringify(ids));
    }
    return { status: 'ok' };
  } catch (error) {
    console.error('portalContenidoMover', error);
    return { status: 'error', error: mensajeError(error) };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MODO RÁPIDO — pegar muchas filas de golpe
// ═════════════════════════════════════════════════════════════════════════════
// Los seguros de siempre: identidad por sección (`clave`), comparación sin ruido (mayúsculas,
// acentos, espacios), «sin cambios» no se escribe, duplicados dentro del pegado, NUNCA borra, y
// nada se escribe sin confirmar: aplicar vuelve a calcular el plan en ese momento.

const PC_RE_ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Texto reducido a lo comparable: es lo que decide si dos filas «son la misma». */
function pcClave(v: unknown): string {
  return String(v == null ? '' : v).normalize('NFD').replace(PC_RE_ACENTOS, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function pcClaveDe(col: Coleccion, valores: Record<string, unknown>): string {
  return pcCamposClave(col).map((id) => pcClave(valores[id])).join(' ¦ ');
}

interface PasoPlan {
  n: number; accion: 'nueva' | 'actualiza' | 'igual' | 'duplicada' | 'error'; titulo: string;
  detalle?: string; id?: string; fila?: number; cambios?: string[]; valores?: Record<string, string>; avisos?: string[];
}

/** Compara el plan de importación contra lo que ya hay. No escribe nada (pcPlanImport_). */
function pcPlanImport(col: Coleccion, existentesFilas: Record<string, any>[], entrada: Record<string, string>[]) {
  // Índice de lo que ya existe: clave → {id, fila, valores}. Si la clave está repetida, manda la
  // PRIMERA: es la que el Portal enseña arriba.
  const existentes: Record<string, { id: string; fila: number; valores: Record<string, string> }> = Object.create(null);
  existentesFilas.forEach((f, i) => {
    if (!pcViva(col, f)) return;
    const valores = pcValoresDe(col, f);
    const k = pcClaveDe(col, valores);
    if (!existentes[k]) existentes[k] = { id: String(f.id || '').trim(), fila: i + 2, valores };
  });

  const vistas: Record<string, number> = Object.create(null);
  const plan: PasoPlan[] = [];
  const resumen = { nuevas: 0, actualiza: 0, iguales: 0, duplicadas: 0, errores: 0 };
  const claveCampos = pcCamposClave(col);

  for (let n = 0; n < entrada.length; n++) {
    const check = pcValidar(col, entrada[n]);
    const etiqueta = String((entrada[n] || {})[col.titulo] || (entrada[n] || {})[claveCampos[0]] || '').trim();

    if (!check.ok) {
      const primero = Object.keys(check.errores)[0];
      plan.push({ n, accion: 'error', titulo: etiqueta, detalle: primero + ': ' + check.errores[primero] });
      resumen.errores++;
      continue;
    }

    const k = pcClaveDe(col, check.valores);
    if (!pcClave(k.replace(/¦/g, ''))) {
      plan.push({ n, accion: 'error', titulo: etiqueta, detalle: 'La fila no tiene con qué identificarse.' });
      resumen.errores++;
      continue;
    }

    // Se guarda n+1, NO n: con 0 un duplicado de la primera fila se colaría como nueva.
    if (vistas[k]) {
      plan.push({ n, accion: 'duplicada', titulo: etiqueta,
                  detalle: 'Repetida en lo que pegaste (ya venía en la fila ' + vistas[k] + ').' });
      resumen.duplicadas++;
      continue;
    }
    vistas[k] = n + 1;

    const ya = existentes[k];
    if (!ya) {
      plan.push({ n, accion: 'nueva', titulo: etiqueta, valores: check.valores, avisos: check.avisos });
      resumen.nuevas++;
      continue;
    }

    // Solo cuentan como cambio los campos que VIENEN en el pegado.
    const cambios: string[] = [];
    col.campos.forEach((c) => {
      if (entrada[n][c.id] === undefined) return;
      if (pcClave(check.valores[c.id]) !== pcClave(ya.valores[c.id])) cambios.push(c.etiqueta);
    });

    if (!cambios.length) {
      plan.push({ n, accion: 'igual', titulo: etiqueta, id: ya.id });
      resumen.iguales++;
    } else {
      plan.push({ n, accion: 'actualiza', titulo: etiqueta, id: ya.id, fila: ya.fila,
                  cambios, valores: check.valores, avisos: check.avisos });
      resumen.actualiza++;
    }
  }
  return { plan, resumen };
}

/**
 * Deja la entrada del cliente en filas limpias, o lanza si viene mal (pcEntradaImport_). Las claves
 * que son ids de campo pasan tal cual (lo que manda la pantalla). Las que no, se buscan por
 * ENCABEZADO con los alias del catálogo (pcMapaColumnas), como se localizaban las columnas en la hoja.
 */
function pcEntradaImport(col: Coleccion, filas: unknown): { ok: true; filas: Record<string, string>[] } | { ok: false; error: string } {
  if (!Array.isArray(filas) || !filas.length) return { ok: false, error: 'No llegó ninguna fila.' };
  if (filas.length > PC_IMPORT_MAX) {
    return { ok: false, error: 'Son ' + filas.length + ' filas y el máximo por importación es ' + PC_IMPORT_MAX + '. Pega menos de golpe.' };
  }
  const validos: Record<string, boolean> = {};
  col.campos.forEach((c) => { validos[c.id] = true; });
  return { ok: true, filas: filas.map((f: any) => {
    const limpia: Record<string, string> = {};
    const fila = (f && typeof f === 'object') ? f : {};
    const otras: string[] = [];
    Object.keys(fila).forEach((k) => {
      if (validos[k]) limpia[k] = String(fila[k] == null ? '' : fila[k]).trim();
      else otras.push(k);
    });
    if (otras.length) {
      const mapa = pcMapaColumnas(col, otras);
      col.campos.forEach((c) => {
        if (limpia[c.id] === undefined && mapa[c.id] > -1) {
          const v = fila[otras[mapa[c.id]]];
          limpia[c.id] = String(v == null ? '' : v).trim();
        }
      });
    }
    return limpia;
  });
}

/** Qué pasaría si se importa. NO escribe nada. @param p {email, coleccion, filas} */
export async function portalContenidoAnalizarImport(ctx: Ctx, p: any) {
  try {
    const gate = await pcGate(ctx, p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const col = pcColeccion(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };
    if (col.soloLectura) return { status: 'error', error: 'En «' + col.nombre + '» no se importa nada.' };

    const entrada = pcEntradaImport(col, p && p.filas);
    const r = pcPlanImport(col, await pcFilas(ctx, col), entrada);
    return {
      status: 'ok', plan: r.plan, resumen: r.resumen,
      clave: pcCamposClave(col).map((id) => { const c = pcCampo(col, id); return c ? c.etiqueta : id; })
    };
  } catch (error) {
    console.error('portalContenidoAnalizarImport', error);
    return { status: 'error', error: mensajeError(error) };
  }
}

/**
 * Aplica la importación. Recalcula el plan aquí dentro: entre el análisis y «Aplicar» otra persona
 * pudo tocar la sección. Altas y actualizaciones van en UN lote (transacción), cada grupo en una
 * sola sentencia sobre json_each, que no depende del tope de parámetros de D1.
 * @param p {email, coleccion, filas, actualizar}  actualizar=false → solo altas.
 */
export async function portalContenidoAplicarImport(ctx: Ctx, p: any) {
  try {
    const gate = await pcGate(ctx, p && p.email);
    if (!gate.ok) return { status: 'error', error: gate.error };
    const col = pcColeccion(p && p.coleccion);
    if (!col) return { status: 'error', error: 'Esa sección del Portal no existe.' };
    if (col.soloLectura) return { status: 'error', error: 'En «' + col.nombre + '» no se importa nada.' };

    const entrada = pcEntradaImport(col, p && p.filas);
    const actualizar = p.actualizar !== false;
    const r = pcPlanImport(col, await pcFilas(ctx, col), entrada);
    const sentencias: Array<[string, ...unknown[]]> = [];

    // ── Altas: todas en una sentencia, al final de la sección y en el orden del pegado ──
    const nuevas = r.plan.filter((x) => x.accion === 'nueva');
    if (nuevas.length) {
      const filasNuevas = nuevas.map((x) => {
        const o: Record<string, string> = { id: nuevoId(col.prefijo) };
        col.campos.forEach((c) => { o[c.id] = (x.valores && x.valores[c.id] !== undefined) ? x.valores[c.id] : ''; });
        return o;
      });
      sentencias.push([
        'INSERT INTO ' + col.tabla + ' (id, orden, ' + col.campos.map((c) => c.columna).join(', ') + ') ' +
        "SELECT json_extract(j.value, '$.id'), " +
        '(SELECT COALESCE(MAX(orden), -1) FROM ' + col.tabla + ') + 1 + CAST(j.key AS INTEGER), ' +
        col.campos.map((c) => "json_extract(j.value, '$." + c.id + "')").join(', ') +
        ' FROM json_each(?1) AS j',
        JSON.stringify(filasNuevas)
      ]);
    }

    // ── Actualizaciones: solo las que de verdad cambian, y solo los campos que VIENEN en el pegado ──
    // (en Apps Script se reescribían también los que no venían, con texto vacío; eso contradecía el
    // seguro de «una columna que no trajiste no vacía lo que ya estaba» y aquí no se hace).
    let actualizadas = 0;
    if (actualizar) {
      const cambios = r.plan.filter((x) => x.accion === 'actualiza').map((x) => {
        const o: Record<string, string> = { id: String(x.id || '') };
        col.campos.forEach((c) => {
          if (entrada[x.n][c.id] !== undefined && x.valores && x.valores[c.id] !== undefined) o[c.id] = x.valores[c.id];
        });
        return o;
      });
      actualizadas = cambios.length;
      if (cambios.length) {
        // Un campo que no viene sale NULL de json_extract y coalesce deja lo que había.
        sentencias.push([
          'UPDATE ' + col.tabla + ' SET ' +
          col.campos.map((c) => c.columna + " = coalesce(json_extract(j.value, '$." + c.id + "'), " + c.columna + ')').join(', ') +
          ' FROM json_each(?1) AS j WHERE ' + col.tabla + ".id = json_extract(j.value, '$.id')",
          JSON.stringify(cambios)
        ]);
      }
    }

    if (sentencias.length) await ctx.lote(sentencias);

    await pcApuntar(ctx, gate.email, 'Portal: importación', col.nombre,
      nuevas.length + ' altas · ' + actualizadas + ' actualizadas · ' +
      r.resumen.iguales + ' sin cambios · ' + r.resumen.duplicadas + ' duplicadas · ' +
      r.resumen.errores + ' con error');

    return {
      status: 'ok',
      resumen: {
        nuevas: nuevas.length,
        actualiza: actualizadas,
        omitidasPorNoActualizar: actualizar ? 0 : r.resumen.actualiza,
        iguales: r.resumen.iguales,
        duplicadas: r.resumen.duplicadas,
        errores: r.resumen.errores
      }
    };
  } catch (error) {
    console.error('portalContenidoAplicarImport', error);
    return { status: 'error', error: mensajeError(error) };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PROMOCIONES DE COMERCIAL (PortalPromosComercial.gs)
// ═════════════════════════════════════════════════════════════════════════════
// Leían por id un archivo EXTERNO de Google Sheets del equipo comercial («Home Promociones
// comercial»). Aquí no hay Google Sheets: fallan de forma controlada, con la misma forma que cuando
// la cuenta del sistema no podía abrir el archivo, y dicen qué hacer en su lugar. La puerta se exige
// igual, antes que nada.

const PROMOS_SIN_SHEETS = 'No pudimos abrir el archivo de comercial: esta versión del sistema no se conecta a ' +
  'Google Sheets. Copia las filas de la campaña en la hoja de comercial y pégalas en «Pegar de una hoja»: ' +
  'pasan por el mismo análisis contra duplicados.';

/** Pestañas visibles del archivo de comercial. */
export async function portalPromosHojas(ctx: Ctx, email: string) {
  const gate = await pcGate(ctx, email);
  if (!gate.ok) return { status: 'error', error: gate.error };
  return { status: 'error', error: PROMOS_SIN_SHEETS };
}

/** Filas interpretadas de una pestaña del archivo de comercial. @param p {email, hoja} */
export async function portalPromosLeer(ctx: Ctx, p: any) {
  const gate = await pcGate(ctx, p && p.email);
  if (!gate.ok) return { status: 'error', error: gate.error };
  const nombreHoja = String((p && p.hoja) || '').trim();
  if (!nombreHoja) return { status: 'error', error: 'Falta decir qué pestaña leer.' };
  return { status: 'error', error: PROMOS_SIN_SHEETS };
}
