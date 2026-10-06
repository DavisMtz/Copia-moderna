/**
 * PORTAL · trazabilidad (Homologación de Procesos 2026) | Portal Ventel en Cloudflare
 * ===================================================================================
 * Port de Trazabilidad.gs. Las seis pestañas de la hoja de Homologación son dos tablas:
 * trazabilidad_secciones (una fila por sección) y trazabilidad_procesos (una por proceso, ya con su
 * ancla estable 'bt-1', 'mkp-12'… y el texto limpio). Lo que en la hoja había que deducir —dónde
 * está la fila de encabezados, qué columna es el nombre, qué número toca— ya viene resuelto en las
 * filas; aquí solo se arma la MISMA respuesta (la de pruebas/trazabilidad_payload_20260926.json).
 *
 * Pública y sin sesión, como en Apps Script. Nunca lanza: si falla devuelve status 'error' y el
 * cliente sigue con su última copia buena.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secConfig } from '../../nucleo/seguridad';

/** Respaldo del id de la hoja de Homologación (propiedad TRAZ_SHEET_ID): viaja en `hojaId`. */
const TRAZ_SHEET_ID = '1EGCG2OaBAPOYPhUdAjIFj3OrDUYoQmIL7S81qEc8tzo';

/**
 * Las seis secciones del Portal. `id` es el de la <section> de Index.html y `prefijo` el de las
 * anclas: no se cambian (el menú, el buscador y los enlaces guardados dependen de ellos).
 */
const TRAZ_SECCIONES = [
  { id: 'bigticket', prefijo: 'bt', label: 'Big Ticket', etiqueta: 'BT' },
  { id: 'softline', prefijo: 'sl', label: 'Soft Line', etiqueta: 'SF' },
  { id: 'slmensajerias', prefijo: 'slm', label: 'SL Mensajerías', etiqueta: 'SF' },
  { id: 'mkp', prefijo: 'mkp', label: 'MarketPlace', etiqueta: 'MKP' },
  { id: 'tienda', prefijo: 'tda', label: 'Tienda Física', etiqueta: 'TDA' },
  { id: 'generales', prefijo: 'gen', label: 'Generales', etiqueta: 'GEN' }
];

const TRAZ_DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Minúsculas, sin acentos y con los espacios colapsados (trazNorm_). */
function trazNorm(v: unknown): string {
  return String(v == null ? '' : v).normalize('NFD').replace(TRAZ_DIACRITICOS, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "N/A", "-", "---" y similares cuentan como celda sin dato (trazEsVacio_). */
function trazEsVacio(s: unknown): boolean {
  const t = trazNorm(s).replace(/[^a-z0-9]/g, '');
  return !t || t === 'na' || t === 'naaplica' || t === 'noaplica';
}

const texto = (v: unknown) => (v === null || v === undefined) ? '' : String(v);

/** Datos de las seis secciones de Trazabilidad. */
export async function fetchTrazabilidadData(ctx: Ctx) {
  const salida: {
    status: string; error: string | null; generado: string; hojaId: string; secciones: any[]; avisos: string[];
  } = {
    status: 'ok',
    error: null,
    generado: new Date().toISOString(),
    hojaId: await secConfig(ctx, 'TRAZ_SHEET_ID', TRAZ_SHEET_ID),
    secciones: [],
    avisos: []
  };

  let secciones: any[], procesos: any[];
  try {
    const [s, p] = await ctx.lote([
      ['SELECT id, label, etiqueta, hoja FROM trazabilidad_secciones ORDER BY orden'],
      ['SELECT id, seccion, num, num_hoja, nombre, reporte, avance, solucion, plataformas, observaciones ' +
       'FROM trazabilidad_procesos ORDER BY seccion, orden, rowid']
    ]);
    secciones = s.filas;
    procesos = p.filas;
  } catch (e: any) {
    salida.status = 'error';
    salida.error = 'No se pudo leer la trazabilidad de la base de datos: ' + String((e && e.message) || e);
    return salida;
  }

  TRAZ_SECCIONES.forEach((cfg) => {
    const fila = secciones.find((x) => String(x.id) === cfg.id) || null;
    const label = (fila && fila.label) || cfg.label;
    const propios = procesos.filter((x) => String(x.seccion) === cfg.id);

    if (!fila && !propios.length) {
      salida.avisos.push('No se encontró la sección "' + label + '" en la base de datos.');
      salida.secciones.push({
        id: cfg.id, prefijo: cfg.prefijo, label, etiqueta: (fila && fila.etiqueta) || cfg.etiqueta,
        hoja: null, tieneAvance: false, procesos: []
      });
      return;
    }

    const lista: any[] = [];
    for (const x of propios) {
      const nombre = texto(x.nombre).trim();
      if (!nombre) continue;
      const nn = trazNorm(nombre);
      if (nn === 'proceso' || nn.indexOf('tiempo p') === 0) continue;   // encabezado repetido
      const num = texto(x.num).trim() || String(lista.length + 1);
      lista.push({
        id: texto(x.id).trim() || (cfg.prefijo + '-' + num),
        num,
        // Número tal cual estaba escrito en la hoja: solo informativo, no se usa para anclar.
        numHoja: texto(x.num_hoja),
        nombre,
        reporte: texto(x.reporte),
        avance: texto(x.avance),
        solucion: texto(x.solucion),
        plataformas: texto(x.plataformas),
        observaciones: texto(x.observaciones)
      });
    }
    const hoja = fila ? (fila.hoja == null ? null : String(fila.hoja)) : null;
    if (!lista.length) salida.avisos.push('Todavía no hay procesos publicados en "' + (hoja || label) + '".');

    salida.secciones.push({
      id: cfg.id,
      prefijo: cfg.prefijo,
      label,
      etiqueta: (fila && fila.etiqueta) || cfg.etiqueta,
      hoja,
      // Sólo BT usa la columna intermedia; si ningún proceso la tiene con dato, no se pinta.
      tieneAvance: lista.some((p) => !!p.avance && !trazEsVacio(p.avance)),
      procesos: lista
    });
  });

  const total = salida.secciones.reduce((n, s) => n + s.procesos.length, 0);
  if (!total) {
    salida.status = 'error';
    salida.error = 'No hay procesos de trazabilidad en la base de datos (las tablas trazabilidad_secciones y ' +
                   'trazabilidad_procesos están vacías).';
  }
  return salida;
}
