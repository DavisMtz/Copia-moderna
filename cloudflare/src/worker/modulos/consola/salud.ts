/**
 * REVISIÓN MAESTRA (salud del sistema) | Portal Ventel en Cloudflare
 * ==================================================================
 * Port de revisionMaestra() de Admin.gs, la que corre la pestaña Salud de la consola. Misma forma de
 * respuesta —{fecha, usuario, url, checks:[{area, nombre, ok, detalle}], ok, duracionMs}— y la
 * misma idea: cualquier línea en rojo dice exactamente qué se rompió.
 *
 * Lo que cambia por ser Cloudflare: en vez de abrir hojas y libros se comprueba que existan las
 * TABLAS de D1 con las columnas que el código espera, cuántas filas tienen, las propiedades clave y
 * las sesiones vivas. Lo que dependía de servicios de Google (Drive, Calendar, Gmail, la cuenta que
 * ejecuta, los webhooks de Chat, la caché de Apps Script) sale en verde con «no aplica en
 * Cloudflare» y el motivo: no es un fallo, es que esa pieza ya no existe.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secConfig, sesObligatorias } from '../../nucleo/seguridad';
import { sesInactividadMs } from '../../nucleo/sesiones';
import {
  leerPropiedad, fijarPropiedad, borrarPropiedad, propiedadesConPrefijo, cacheLeer, cacheGuardar, cacheBorrar, siguienteContador
} from '../../nucleo/sistema';
import {
  PERM_BLOQUES, PERM_GRUPOS, PERM_ROLES_ORDEN, PERM_IDS, permListaMaestros, permModulosApagados
} from '../../nucleo/permisos';
import { ZONA_MX, inicioDelDiaMx } from '../../nucleo/fechas';
import { DOMINIO_CORREO } from '../../nucleo/correo';
import { PAGINAS, PAGINAS_PORTAL, CONSTRUIDO } from '../../generado/rutas';
import { REGISTRO } from '../indice';
import { getEnabledQuoteFormats, getMailSenderInfo, correoCcoGlobal } from '../cotizaciones';
import { cuentasDominioPermitido, cuentasUrlApp, CUENTAS_PREFIJO } from '../identidad';
import { revpolLeer } from '../revision';
import { CONSOLA_SECCIONES, consolaCuotaCorreo } from './comun';
import { grpResumenSalud } from './grupos';

export interface CheckSalud { area: string; nombre: string; ok: boolean; detalle: string }
export interface ReporteSalud {
  fecha: string; usuario: string; url: string; checks: CheckSalud[]; ok?: boolean; duracionMs?: number;
}

const NO_APLICA = 'no aplica en Cloudflare: ';

/** Columnas que el código espera de cada tabla (los encabezados que revisaba checarHoja). */
const COLUMNAS_ESPERADAS: Record<string, string[]> = {
  registros: ['email', 'nombre', 'password_hash', 'avanzado', 'password_temporal'],
  cotizaciones: ['folio', 'timestamp', 'asesor_correo', 'asesor_nombre', 'cliente_nombre', 'correo_cliente',
                 'subtotal', 'iva', 'total_general', 'estatus', 'observaciones'],
  detalle_cotizaciones: ['folio_cotizacion', 'sku', 'descripcion_producto', 'cantidad', 'precio_unitario_base',
                         'costo_pago_unico_linea', 'desc_publico_porcentaje', 'aplica_desc_adicional', 'porcentaje_desc_adicional'],
  metricas_correos: ['fecha', 'tipo', 'referencia', 'asesor_email', 'asesor_nombre', 'para', 'destinatarios', 'cc', 'cco',
                     'asunto', 'adjuntos', 'remitente', 'alias_usado', 'resultado', 'detalle', 'plantilla_modificada'],
  permisos_sistema: ['email', 'rol', 'permisos', 'activo'],
  bitacora_consola: ['fecha', 'quien', 'accion', 'objetivo', 'detalle'],
  metricas_busquedas: ['fecha', 'termino', 'quien', 'nombre', 'origen', 'resultados'],
  grupos: ['id', 'nombre', 'detalle', 'miembros'],
  portal_articulos: ['id', 'titulo', 'resumen', 'contenido', 'estado'],
  portal_articulos_vistas: ['articulo_id', 'correo', 'primera_vez', 'ultima_vez', 'veces'],
  sesiones: ['huella', 'email', 'ultima']
};

/** Propiedades que conviene saber si están puestas o se usa su valor de fábrica. */
const PROPIEDADES_CLAVE = ['HASH_SALT', 'CUENTAS_DOMINIO', 'MAIL_ALIAS', 'BREVO_REMITENTE', 'CORREO_ENVIO_REAL',
  'CC_SENDER_NAME', 'CORREO_CCO_GLOBAL', 'AUTH_SESIONES', 'SESION_INACTIVIDAD_MIN', 'formatos_habilitados', 'PERM_MODULOS_OFF'];

interface Inventario { tablas: Set<string>; columnas: Map<string, string[]>; filas: Map<string, number> }

/** Qué tablas hay, con qué columnas y cuántas filas: lo que en la hoja era abrir cada pestaña. */
async function inventario(ctx: Ctx): Promise<Inventario> {
  const tablas = new Set((await ctx.todas<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'"))
    .map((t) => t.name));
  const nombres = [...tablas].filter((t) => /^[a-z0-9_]+$/.test(t));
  const columnas = new Map<string, string[]>();
  const filas = new Map<string, number>();
  if (!nombres.length) return { tablas, columnas, filas };

  // Columnas: un PRAGMA por tabla, todos en una sola ida a D1.
  const cols = await ctx.lote(nombres.map((t) => ['PRAGMA table_info("' + t + '")'] as [string]));
  nombres.forEach((t, i) => columnas.set(t, (cols[i] ? cols[i].filas : []).map((c: any) => String(c.name))));

  // Filas: un COUNT por tabla en una sola consulta.
  const fila = await ctx.una<Record<string, number>>(
    'SELECT ' + nombres.map((t) => '(SELECT COUNT(*) FROM "' + t + '") AS "' + t + '"').join(', '));
  nombres.forEach((t) => filas.set(t, Number((fila && fila[t]) || 0)));
  return { tablas, columnas, filas };
}

/** checarHoja: que exista la tabla y tenga las columnas que el código espera; devuelve el conteo. */
function checarTabla(inv: Inventario, tabla: string, requeridas?: string[] | null): string {
  if (!inv.tablas.has(tabla)) throw new Error('La tabla "' + tabla + '" NO existe en la base.');
  const n = inv.filas.get(tabla) || 0;
  const hay = inv.columnas.get(tabla) || [];
  const faltan = (requeridas || []).filter((c) => hay.indexOf(c) === -1);
  if (faltan.length) throw new Error(tabla + ': faltan columnas [' + faltan.join(', ') + '] · ' + n + ' filas');
  return n + ' filas' + (requeridas && requeridas.length ? ', columnas completas' : '');
}

function expuesta(nombre: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRO, nombre) && typeof REGISTRO[nombre] === 'function';
}

/** La revisión completa. Nunca lanza: cada comprobación que falla queda en rojo con su motivo. */
export async function revisionMaestra(ctx: Ctx): Promise<ReporteSalud> {
  const inicio = Date.now();
  const reporte: ReporteSalud = { fecha: new Date(inicio).toISOString(), usuario: '', url: '', checks: [] };

  async function check(area: string, nombre: string, fn: () => Promise<string> | string): Promise<void> {
    try {
      const detalle = await fn();
      reporte.checks.push({ area, nombre, ok: true, detalle: detalle || 'OK' });
    } catch (e: any) {
      reporte.checks.push({ area, nombre, ok: false, detalle: (e && e.message) || String(e) });
    }
  }

  let inv: Inventario = { tablas: new Set(), columnas: new Map(), filas: new Map() };
  let inventarioError = '';
  const t0 = Date.now();
  try { inv = await inventario(ctx); } catch (e: any) { inventarioError = (e && e.message) || String(e); }
  const msInventario = Date.now() - t0;
  const filas = (t: string) => inv.filas.get(t) || 0;

  // ── 1. Despliegue ─────────────────────────────────────────────────────────
  await check('Despliegue', 'Cuenta que ejecuta', () => {
    reporte.usuario = 'Worker de Cloudflare';
    return 'Worker de Cloudflare (no hay cuenta de Google que ejecute) · entorno ' + (ctx.env.ENTORNO || 'local') +
           ' · zona horaria ' + ZONA_MX;
  });
  await check('Despliegue', 'URL de la web app', () => {
    reporte.url = cuentasUrlApp(ctx);
    if (!reporte.url) throw new Error('No se conoce el dominio desde el que se sirve la aplicación.');
    return reporte.url + ' · pantallas construidas el ' + CONSTRUIDO;
  });

  // ── 2. Base de datos (lo que era el libro de cotizaciones) ────────────────
  await check('BD Cotizaciones', 'Acceso a la base', () => {
    if (inventarioError) throw new Error('No se pudo leer la base D1: ' + inventarioError);
    return 'D1 «ventel-portal» · ' + inv.tablas.size + ' tablas · inventario en ' + msInventario + ' ms';
  });
  await check('BD Cotizaciones', 'Tabla registros («Registros»)', () => checarTabla(inv, 'registros', COLUMNAS_ESPERADAS.registros));
  await check('BD Cotizaciones', 'Tabla cotizaciones («Cotizaciones»)', () => checarTabla(inv, 'cotizaciones', COLUMNAS_ESPERADAS.cotizaciones));
  await check('BD Cotizaciones', 'Tabla detalle_cotizaciones («DetalleCotizaciones»)',
    () => checarTabla(inv, 'detalle_cotizaciones', COLUMNAS_ESPERADAS.detalle_cotizaciones));

  // ── 3. Portal (antes, un libro aparte por ID) ─────────────────────────────
  await check('BD Portal', 'Acceso a la hoja del Portal', () => NO_APLICA + 'el Portal vive en la misma base D1, no en un libro aparte');
  for (const [tabla, hoja] of [['portal_herramientas', 'Herramientas'], ['portal_presentaciones', 'Presentaciones'],
    ['portal_paqueterias', 'Paqueterias'], ['portal_formatos', 'Formatos'], ['portal_pdepago', 'PdePago'],
    ['portal_plantillas', 'Plantillas']]) {
    await check('BD Portal', 'Tabla ' + tabla + ' («' + hoja + '»)', () => checarTabla(inv, tabla, null));
  }
  for (const [tabla, hoja] of [['portal_anuncios', 'Anuncios'], ['portal_promociones', 'Promociones'],
    ['portal_mkp', 'MKP'], ['portal_reportes', 'Reportes']]) {
    await check('BD Portal', 'Tabla ' + tabla + ' («' + hoja + '», opcional)', () => {
      if (!inv.tablas.has(tabla)) return 'no existe (el portal funciona sin ella)';
      return filas(tabla) + ' filas';
    });
  }
  await check('BD Portal', 'Datos del portal (fetchToolsData)', async () => {
    if (!expuesta('fetchToolsData')) throw new Error('Portal.gs no está portado todavía: el Portal no tendrá datos.');
    const d = await REGISTRO.fetchToolsData(ctx) as any;
    if (!d || d.status !== 'ok') throw new Error((d && d.error) || 'estado ' + (d && d.status));
    const n = (k: string) => (Array.isArray(d[k]) ? d[k].length : 0);
    return n('herramientas') + ' herramientas · ' + n('paqueterias') + ' paqueterías · ' + n('formatos') + ' formatos · ' +
           n('plantillas') + ' plantillas · ' + n('anuncios') + ' anuncios visibles';
  });

  // ── 4. Formatos de cotización ─────────────────────────────────────────────
  await check('Formatos', 'Catálogo de formatos', async () => {
    const r = await getEnabledQuoteFormats(ctx) as any;
    if (!r || !r.success) throw new Error((r && r.message) || 'getEnabledQuoteFormats falló.');
    if (!r.formats.length) throw new Error('Ningún formato habilitado: los asesores no pueden cotizar.');
    return r.formats.map((f: any) => f.id).join(', ') + ' · predeterminado: ' + r.defaultId;
  });
  await check('Formatos', 'Plantilla CCL accesible', () => NO_APLICA + 'no se abren hojas de Google Sheets');
  await check('Formatos', 'Carpeta de salida CCL (Drive)', () => NO_APLICA + 'no se guardan archivos en Google Drive');

  // ── 5. Correo ─────────────────────────────────────────────────────────────
  await check('Correo', 'Remitente de cotizaciones', async () => {
    const info = await getMailSenderInfo(ctx) as any;
    if (!info || !info.success) throw new Error((info && info.message) || 'no se pudo consultar el remitente');
    // Ya no hay alias de Gmail que comprobar: el núcleo manda siempre desde el dominio de envío.
    return 'alias ' + info.alias + ' · sale desde @' + DOMINIO_CORREO + ' (el remitente de otro dominio se cambia por el real)';
  });
  await check('Correo', 'Envío real (Brevo)', async () => {
    const r = await ctx.todas<{ estado: string | null; n: number }>(
      'SELECT estado, COUNT(*) AS n FROM correos_salida WHERE fecha >= ? GROUP BY estado', inicioDelDiaMx().toISOString());
    const hoy: Record<string, number> = {};
    r.forEach((f) => { hoy[String(f.estado || 'sin estado')] = Number(f.n || 0); });
    const cifras = 'hoy: ' + (hoy.enviado || 0) + ' enviado(s), ' + (hoy.omitido || 0) + ' omitido(s), ' +
                   (hoy.error || 0) + ' con error · cuota restante ' + (await consolaCuotaCorreo(ctx));
    if (String(await secConfig(ctx, 'CORREO_ENVIO_REAL', 'si')).trim().toLowerCase() === 'no') {
      throw new Error('Envío real apagado (CORREO_ENVIO_REAL = no): ningún correo sale, todo se queda en la bandeja de salida · ' + cifras);
    }
    if (!ctx.env.BREVO_API_KEY) {
      // En local no hay clave a propósito; en producción, sin ella no sale nada.
      if ((ctx.env.ENTORNO || 'local') === 'produccion') throw new Error('Sin la clave BREVO_API_KEY: los correos no salen · ' + cifras);
      return 'sin clave de Brevo en este entorno (' + (ctx.env.ENTORNO || 'local') + '): los correos quedan en la bandeja de salida · ' + cifras;
    }
    if (hoy.error) throw new Error(hoy.error + ' correo(s) rechazados hoy por el proveedor · ' + cifras);
    return 'clave configurada · ' + cifras + ' · las direcciones de ejemplo nunca se mandan';
  });

  // ── 6. Calendario ─────────────────────────────────────────────────────────
  await check('Calendario', 'Calendario comercial', () => NO_APLICA + 'el calendario de Google no se consulta (las promociones salen sin él)');

  // ── 7. Seguridad ──────────────────────────────────────────────────────────
  await check('Seguridad', 'Modo de autenticación', async () => {
    if (!(await sesObligatorias(ctx))) {
      throw new Error('AUTH_SESIONES=no: el servidor se fía del correo que declara el navegador. Vuelve a ponerlo en «si».');
    }
    return 'sesiones obligatorias · la llave de sesión del portal decide quién llama (AUTH_MODO ' + NO_APLICA.replace(/: $/, '') + ')';
  });
  await check('Seguridad', 'Identidad de Google visible', () => NO_APLICA + 'no hay cuenta de Google; la identidad sale de la llave de sesión');
  await check('Seguridad', 'Secretos fuera del código', async () => {
    if (!(await leerPropiedad(ctx, 'HASH_SALT'))) {
      throw new Error('Aún vive en el código fuente: HASH_SALT. Guárdala en la tabla propiedades con el MISMO valor ' +
                      '(cambiarla invalidaría todas las contraseñas).');
    }
    return 'HASH_SALT está en las propiedades (los webhooks ' + NO_APLICA.replace(/: $/, '') + ')';
  });
  await check('Seguridad', 'Códigos por correo (Cuentas.gs)', async () => {
    if (!expuesta('solicitarCodigoRegistro') || !expuesta('restablecerContrasena')) {
      throw new Error('Cuentas.gs no está portado: no hay alta verificada ni recuperación de contraseña.');
    }
    // Ida y vuelta completa del almacén (escribir, leer, borrar) sin mandar ningún correo.
    const clave = CUENTAS_PREFIJO + 'diag_' + Date.now();
    await fijarPropiedad(ctx, clave, JSON.stringify({ exp: Date.now() + 60000 }));
    const leido = await leerPropiedad(ctx, clave);
    await borrarPropiedad(ctx, clave);
    if (!leido) throw new Error('no se pueden guardar los códigos en las propiedades');
    const dominio = await cuentasDominioPermitido(ctx);
    const vivos = Object.keys(await propiedadesConPrefijo(ctx, CUENTAS_PREFIJO)).length;
    return 'almacén OK · altas ' + (dominio ? 'solo @' + dominio : 'sin restricción de dominio') +
           ' · códigos vigentes ahora: ' + vivos + ' · cuota de correo restante: ' + (await consolaCuotaCorreo(ctx));
  });
  await check('Seguridad', 'Sesiones activas', async () => {
    const limite = await sesInactividadMs(ctx);
    const r = await ctx.una<{ n: number; personas: number }>(
      'SELECT COUNT(*) AS n, COUNT(DISTINCT email) AS personas FROM sesiones WHERE ultima >= ?', Date.now() - limite);
    return Number((r && r.n) || 0) + ' sesión(es) abierta(s) de ' + Number((r && r.personas) || 0) + ' persona(s) · ' +
           'vencen tras ' + Math.round(limite / 60000) + ' min sin actividad';
  });
  await check('Seguridad', 'Propiedades clave', async () => {
    const puestas: string[] = [];
    const fabrica: string[] = [];
    for (const k of PROPIEDADES_CLAVE) ((await leerPropiedad(ctx, k)) ? puestas : fabrica).push(k);
    return (puestas.length ? 'guardadas: ' + puestas.join(', ') : 'ninguna guardada') +
           (fabrica.length ? ' · con su valor de fábrica: ' + fabrica.join(', ') : '');
  });

  // ── 8. Permisos y consola ─────────────────────────────────────────────────
  await check('Permisos', 'Modelo de bloques (Permisos.gs)', () =>
    PERM_BLOQUES.length + ' bloques en ' + PERM_GRUPOS.length + ' grupos · ' + PERM_ROLES_ORDEN.length + ' roles');
  await check('Permisos', 'Hay al menos un maestro', async () => {
    const maestros = await permListaMaestros(ctx);
    if (!maestros.length) {
      throw new Error('NINGUNA cuenta tiene el rol maestro: la consola no se puede abrir. ' +
                      'Nombra uno escribiendo su fila en la tabla permisos_sistema (rol = maestro).');
    }
    return maestros.length + ' maestro(s): ' + maestros.join(', ');
  });
  await check('Permisos', 'Tabla de permisos («_PermisosSistema»)', () =>
    checarTabla(inv, 'permisos_sistema', COLUMNAS_ESPERADAS.permisos_sistema) + ' · fuera de la vista del equipo (tabla de D1, no una hoja)');
  await check('Permisos', 'Módulos en mantenimiento', async () => {
    const off = await permModulosApagados(ctx);
    return off.length ? off.length + ' apagado(s): ' + off.join(', ') + ' — el equipo NO los ve' : 'ninguno: todo en servicio';
  });
  await check('Permisos', 'Consola (Consola.gs)', () => {
    if (!expuesta('consolaPanorama')) throw new Error('Consola.gs no está portado: la pantalla ?page=consola no tendrá datos.');
    if (!PAGINAS['consola']) throw new Error('La página "consola" no está registrada en las rutas.');
    return 'API lista · bitácora: ' + checarTabla(inv, 'bitacora_consola', COLUMNAS_ESPERADAS.bitacora_consola).replace(/ filas.*/, '') + ' movimientos';
  });

  // ── 8b. Estado de operación ───────────────────────────────────────────────
  await check('Operación', 'Módulo de estado (Operacion.gs)', async () => {
    if (!expuesta('opEstadoPublico')) throw new Error('Operacion.gs no está portado: el indicador de estado no tendrá datos.');
    if (!PAGINAS_PORTAL['estado']) throw new Error('La página pública "estado" no está registrada en las rutas.');
    if (!PAGINAS['operacion']) throw new Error('La página "operacion" no está registrada en las rutas.');
    if (PERM_IDS.indexOf('operacion') === -1) throw new Error('Falta el bloque "operacion" en el catálogo: nadie podría confirmar una falla.');
    const r = await REGISTRO.opEstadoPublico(ctx) as any;
    if (!r || !r.success) throw new Error('opEstadoPublico no respondió correctamente.');
    return (r.sistemas || []).length + ' sistemas · ' + (r.incidentes || []).length + ' incidencia(s) viva(s)';
  });
  await check('Operación', 'Webhook de comunicados', () => NO_APLICA + 'los avisos a Google Chat no salen (se registran en el servidor)');
  await check('Operación', 'Webhook de reportes sueltos', () => NO_APLICA + 'los reportes se guardan igual y no se anuncian por Chat');

  // ── 8c. Contenido del equipo ──────────────────────────────────────────────
  await check('Contenido', 'Artículos (Articulos.gs)', () => {
    if (!expuesta('artListar')) throw new Error('Articulos.gs no está portado: la pantalla ?page=articulo se quedará vacía.');
    if (!PAGINAS['articulo']) throw new Error('La página "articulo" no está registrada en las rutas.');
    if (PERM_IDS.indexOf('articulos') === -1) throw new Error('Falta el bloque "articulos" en el catálogo: nadie podría publicar.');
    checarTabla(inv, 'portal_articulos', COLUMNAS_ESPERADAS.portal_articulos);
    const n = filas('portal_articulos');
    return n ? n + ' artículo(s) en la base' : 'módulo listo · todavía no hay ningún artículo';
  });
  await check('Contenido', 'Lecturas de artículos', () => {
    checarTabla(inv, 'portal_articulos_vistas', COLUMNAS_ESPERADAS.portal_articulos_vistas);
    const n = filas('portal_articulos_vistas');
    return n ? n + ' registro(s) de lectura' : 'aún sin registrar ninguna lectura';
  });
  await check('Contenido', 'Votos de publicaciones (Publicaciones.gs)', () => {
    if (!expuesta('pubVotar')) throw new Error('Publicaciones.gs no está portado: las encuestas del Portal no funcionarán.');
    checarTabla(inv, 'portal_votos', null);
    const n = filas('portal_votos');
    return n ? n + ' voto(s)' : 'aún sin votos';
  });
  await check('Contenido', 'Grupos de personas (Grupos.gs)', async () => {
    checarTabla(inv, 'grupos', COLUMNAS_ESPERADAS.grupos);
    const g = await grpResumenSalud(ctx);
    return (g.grupos ? g.grupos + ' grupo(s)' : 'sin grupos propios todavía') +
           ' · «Ventel» (virtual) alcanza a ' + g.ventel + ' persona(s)';
  });

  // ── 8d. Métricas y registros de actividad ─────────────────────────────────
  await check('Métricas', 'Tabla de correos enviados («MetricasCorreos»)', () => {
    const r = checarTabla(inv, 'metricas_correos', COLUMNAS_ESPERADAS.metricas_correos);
    return filas('metricas_correos') ? r.replace(' filas', ' envío(s)') : 'aún sin envíos registrados · columnas completas';
  });
  await check('Métricas', 'Registro de búsquedas', () => {
    checarTabla(inv, 'metricas_busquedas', COLUMNAS_ESPERADAS.metricas_busquedas);
    const n = filas('metricas_busquedas');
    return n ? n + ' búsqueda(s) registradas' : 'aún sin búsquedas registradas';
  });
  await check('Métricas', 'Sección Monitoreo de la consola', () => {
    if (!expuesta('monPanorama')) throw new Error('Monitoreo.gs no está portado: la pestaña Métricas de la consola no tendrá datos.');
    if (PERM_IDS.indexOf('metricas') === -1) throw new Error('Falta el bloque "metricas" en el catálogo: la pestaña no se le abriría a nadie.');
    const seccion = CONSOLA_SECCIONES.find((s) => s.id === 'metricas');
    if (!seccion) throw new Error('Falta la sección "metricas" en las secciones de la consola.');
    return 'API lista · abre con: ' + seccion.bloques.join(' o ');
  });
  await check('Métricas', 'Copia oculta global', async () => {
    const buzones = await correoCcoGlobal(ctx);
    if (!buzones.length) return 'apagada (opcional) · los correos van solo a sus destinatarios';
    const malos = buzones.filter((c) => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c));
    if (malos.length) throw new Error(malos.length + ' dirección(es) no son correos válidos');
    // Se dice CUÁNTOS, no cuáles: quién vigila el correo del equipo se ve en Ajustes, con su puerta.
    return 'activa hacia ' + buzones.length + ' buzón(es) · los correos de seguridad NO se copian';
  });

  // ── 8e. Módulos que nadie miraba ──────────────────────────────────────────
  await check('Módulos', 'Trazabilidad', () => {
    if (!expuesta('fetchTrazabilidadData')) throw new Error('Trazabilidad.gs no está portado: no se podrá consultar el rastro de procesos.');
    checarTabla(inv, 'trazabilidad_secciones', null);
    checarTabla(inv, 'trazabilidad_procesos', null);
    return filas('trazabilidad_secciones') + ' sección(es) · ' + filas('trazabilidad_procesos') + ' proceso(s) en D1';
  });
  await check('Módulos', 'Preferencias de usuario', () => {
    checarTabla(inv, 'preferencias_usuario', null);
    const n = filas('preferencias_usuario');
    return n ? n + ' persona(s) con preferencias guardadas' : 'aún sin preferencias guardadas';
  });
  await check('Módulos', 'Atenciones pendientes', () => {
    if (!expuesta('atencionesPanorama')) throw new Error('Atenciones.gs no está portado: no se podrá rescatar a los clientes de una caída.');
    if (!PAGINAS['atenciones']) throw new Error('La página "atenciones" no está registrada en las rutas.');
    if (PERM_IDS.indexOf('atenciones') === -1) throw new Error('Falta el bloque "atenciones" en el catálogo.');
    return 'módulo y pantalla registrados · ' + filas('atenciones_pendientes') + ' atención(es) guardadas';
  });
  await check('Módulos', 'Revisión y su política', async () => {
    if (!expuesta('guardarRevisionCotizacion')) {
      throw new Error('Revision.gs no está portado: las cotizaciones saldrían sin control.');
    }
    if (!PAGINAS['revision_cotizacion']) throw new Error('La página "revision_cotizacion" no está registrada en las rutas.');
    const pol = await revpolLeer(ctx) as any;
    const reglas = (pol && Array.isArray(pol.reglas)) ? pol.reglas : [];
    return 'política cargada · ' + reglas.length + ' regla(s), ' + reglas.filter((r: any) => r && r.activa !== false).length + ' activa(s)';
  });
  await check('Módulos', 'Auditoría de cotizaciones', () => 'módulo cargado');
  await check('Módulos', 'Caché de identidad', () => NO_APLICA + 'D1 resuelve la identidad en cada llamada, sin caché que calentar');

  // ── 9. Infraestructura ────────────────────────────────────────────────────
  await check('Infra', 'Caché con caducidad (tabla cache)', async () => {
    const clave = 'diag_ping_' + Date.now();
    await cacheGuardar(ctx, clave, 'ok', 60);
    const leido = await cacheLeer(ctx, clave);
    await cacheBorrar(ctx, clave);
    if (leido !== 'ok') throw new Error('la caché no devuelve lo escrito');
    return 'lectura/escritura OK';
  });
  await check('Infra', 'Caché de lectura (Cache.gs)', () => NO_APLICA + 'D1 se lee directo, sin caché de datos que invalidar');
  await check('Infra', 'Contadores atómicos (folios)', async () => {
    const clave = 'diag_salud_' + Date.now();
    const a = await siguienteContador(ctx, clave);
    const b = await siguienteContador(ctx, clave);
    await ctx.ejecutar('DELETE FROM contadores WHERE clave = ?', clave);
    if (b !== a + 1) throw new Error('el contador no avanzó de uno en uno (' + a + ' → ' + b + ')');
    return 'contador atómico OK (lo que hacía LockService)';
  });
  await check('Infra', 'Archivos (R2)', async () => {
    await ctx.env.ARCHIVOS.head('diag/comprobacion');   // no existe: basta con que el almacén conteste
    return 'almacén accesible · ' + filas('archivos') + ' archivo(s) subidos';
  });
  await check('Infra', 'Webhook de Google Chat', () => NO_APLICA + 'las notificaciones a Chat se omiten');

  // ── Resumen ───────────────────────────────────────────────────────────────
  const errores = reporte.checks.filter((c) => !c.ok);
  reporte.ok = errores.length === 0;
  reporte.duracionMs = Date.now() - inicio;
  console.log('REVISIÓN MAESTRA · ' + (reporte.ok ? 'TODO EN ORDEN' : 'ATENCIÓN: ' + errores.length + ' problema(s): ' +
              errores.map((c) => c.nombre).join(' · ')) + ' · ' + reporte.checks.length + ' verificaciones en ' + reporte.duracionMs + ' ms');
  return reporte;
}
