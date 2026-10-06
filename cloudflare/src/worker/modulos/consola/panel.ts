/**
 * CONSOLA MAESTRA | Portal Ventel en Cloudflare
 * =============================================
 * Port de Consola.gs. Todo lo que antes se hacía abriendo el editor de Apps Script o editando
 * «Registros» a mano, bajo tres reglas que no se rompen nunca:
 *
 *   1. NADA se ejecuta sin pasar por una puerta (consolaAcceso / consolaGate, en comun.ts).
 *   2. NADIE puede dejarse fuera: no se puede quitar el rol maestro a uno mismo, ni darse de baja,
 *      ni retirar al último maestro que queda (consolaCandados).
 *   3. TODO cambio queda apuntado en la bitácora (apuntarBitacora del núcleo, mismos textos).
 *
 * La sal de las contraseñas (HASH_SALT) es de SOLO LECTURA aquí: cambiarla invalida de golpe la
 * contraseña de todo el mundo, y eso no debe estar a un clic de nadie.
 */
import type { Ctx } from '../../nucleo/contexto';
import {
  secNormalizarCorreo, secCorreoValido, secBuscarRegistro, secHashContrasena, secIntentosLimpiar, secConfig
} from '../../nucleo/seguridad';
import {
  permUsuario, permVetoJerarquia, permVetoRol, permBloquesRepartibles, permNormalizarRol, permLimpiarAjustes,
  permBloquesDeRol, permSerializarAjustes, permEscribirFila, permListaMaestros, permBorrarPermisos, permCatalogo,
  permCatalogoPara, permModulosApagados, permFijarModulosApagados, permBloque, permNivelUsuario, permMismoCorreo,
  PERM_IDS, type UsuarioPermisos
} from '../../nucleo/permisos';
import { leerPropiedadJson, fijarPropiedad, borrarPropiedad, apuntarBitacora } from '../../nucleo/sistema';
import { escaparHtml } from '../../nucleo/util';
import { ZONA_MX } from '../../nucleo/fechas';
import { enviarCorreo, DOMINIO_CORREO } from '../../nucleo/correo';
import {
  cuentasDominioPermitido, cuentasAltaUsuario, cuentasActualizarPassword, cuentasMarcarPasswordTemporal,
  cuentasUrlApp, cuentasPlantillaCorreo, cuentasMailP, cuentasMailDatos, cuentasMailBoton,
  cuentasMailNota, consolaPasswordTemporal, CUENTAS_DOMINIO_RESPALDO
} from '../identidad';
import { getFormatSettings, setQuoteFormatEnabled } from '../cotizaciones';
import {
  consolaAcceso, consolaGate, consolaError, consolaPersonas, consolaBitacoraLeer, consolaBitacoraEnRango,
  consolaRangoFechas, consolaDiasDesde, consolaCuotaCorreo, correoEnBandeja, CC_SENDER_NAME_RESPALDO, COLADOR_ES,
  CONSOLA_BITACORA_LIMITE, type AccesoOk
} from './comun';
import { grpListar, GRP_NIVEL_MINIMO } from './grupos';
import { revisionMaestra } from './salud';

// ── Catálogo de ajustes ─────────────────────────────────────────────────────
//
// Lo que se puede tocar desde la pantalla; la consola se dibuja sola a partir de esto.
//   tipo        'opcion' | 'texto' | 'secreto' | 'correo' | 'lista_correos' | 'id_hoja' | 'id_calendario' | 'id_carpeta'
//   secreto     su valor nunca viaja al cliente; solo se dice si está puesto.
//   soloLectura se muestra pero no se guarda desde la consola.
//   soloMaestro ni siquiera con 'adm_ajustes': hace falta ser maestro.
//   sinEfecto   (esta versión) el ajuste se guarda igual, pero ya no cambia nada: lo que en Apps
//               Script apuntaba a Drive, Calendar, Google Chat o a la cuenta de Google. Se le dice a
//               quien lo mira (en su detalle y al guardarlo) y no cuenta como «sin configurar».
//   nota        (esta versión) lo que cambia en cómo se usa, para quien lo lee en la consola.

interface DefAjuste {
  clave: string; nombre: string; grupo: string; detalle: string; tipo: string;
  predeterminado?: string; opciones?: Array<{ valor: string; nombre: string; detalle: string }>;
  marcador?: string; secreto?: boolean; soloLectura?: boolean; soloMaestro?: boolean; opcional?: boolean;
  webhook?: boolean; sinEfecto?: string; nota?: string;
}

/**
 * Remitente de fábrica en esta versión. Los correos salen de verdad por Brevo desde el dominio
 * logidma.com (el único autenticado), así que ya no se usa el alias de grupo de Liverpool.
 */
const MAIL_ALIAS_RESPALDO_CF = 'ventel@' + DOMINIO_CORREO;
/** Ajuste del núcleo (nucleo/correo.ts): la dirección de logidma.com desde la que sale todo. */
const BREVO_REMITENTE_RESPALDO = 'ventel@' + DOMINIO_CORREO;

const SIN_EFECTO_CHAT = 'En esta versión los avisos a Google Chat no salen: se guarda, pero no se usa.';
const SIN_EFECTO_D1 = 'En esta versión los datos viven en la base D1 de Cloudflare: se guarda, pero no se usa.';

const CONSOLA_AJUSTES: DefAjuste[] = [
  {
    clave: 'AUTH_MODO', nombre: 'Modo de autenticación', grupo: 'Identidad',
    detalle: 'Quién decide de quién es la sesión: el correo con el que se entra al portal, o la cuenta de Google del navegador.',
    tipo: 'opcion', predeterminado: 'portal',
    opciones: [
      { valor: 'portal', nombre: 'Portal (recomendado)',
        detalle: 'Manda el correo con el que se inicia sesión en la app. La cuenta de Google solo es respaldo.' },
      { valor: 'auto', nombre: 'Automático',
        detalle: 'La cuenta de Google manda si está dada de alta; si no, se acepta la del portal.' },
      { valor: 'estricto', nombre: 'Estricto',
        detalle: 'Solo se acepta la cuenta de Google y debe estar dada de alta. Ignora el correo del portal.' }
    ],
    sinEfecto: 'En esta versión no hay cuenta de Google: la identidad la decide siempre la llave de sesión del portal, así que se guarda pero no cambia nada.'
  },
  {
    clave: 'CUENTAS_DOMINIO', nombre: 'Dominio permitido en altas', grupo: 'Identidad',
    detalle: 'Solo se pueden crear cuentas con correo de este dominio. Escribe "ninguno" para no restringir.',
    tipo: 'texto', predeterminado: 'liverpool.com.mx', marcador: 'liverpool.com.mx'
  },
  {
    clave: 'HASH_SALT', nombre: 'Sal de contraseñas', grupo: 'Identidad',
    detalle: 'Secreto con el que se cifran las contraseñas. Cambiarlo invalidaría la de todo el mundo, así que desde aquí solo se consulta si está puesto.',
    tipo: 'secreto', secreto: true, soloLectura: true
  },
  {
    clave: 'MAIL_ALIAS', nombre: 'Remitente de las cotizaciones', grupo: 'Correo',
    detalle: 'Alias «Enviar como» con el que salen las cotizaciones y los avisos del sistema. ' +
             'Tiene que estar dado de alta en la cuenta de Gmail que ejecuta el sistema; si no lo está, ' +
             'el correo sale igual desde esa cuenta y solo se pierde el remitente bonito.',
    tipo: 'correo', marcador: MAIL_ALIAS_RESPALDO_CF,
    nota: 'En esta versión los correos salen por Brevo desde el dominio ' + DOMINIO_CORREO +
          ': un remitente de otro dominio se cambia por el «Remitente real (Brevo)».'
  },
  {
    // Ajuste propio de esta versión (lo lee nucleo/correo.ts). No existía en Apps Script.
    clave: 'BREVO_REMITENTE', nombre: 'Remitente real (Brevo)', grupo: 'Correo',
    detalle: 'Dirección de ' + DOMINIO_CORREO + ' desde la que salen de verdad los correos del sistema (es el dominio ' +
             'autenticado en Brevo). Se usa siempre que el remitente que pide una pantalla no es de ese dominio.',
    tipo: 'correo', marcador: BREVO_REMITENTE_RESPALDO
  },
  {
    clave: 'CC_SENDER_NAME', nombre: 'Nombre visible en los correos a clientes', grupo: 'Correo',
    detalle: 'Cómo ve el cliente al remitente en su bandeja: "Ventel Liverpool", no la dirección.',
    tipo: 'texto', marcador: 'Ventel Liverpool'
  },
  {
    clave: 'CORREO_CCO_GLOBAL', nombre: 'Copia oculta global', grupo: 'Correo',
    detalle: 'Buzón que recibe copia oculta de todo lo que el sistema manda: cotizaciones, plantillas ' +
             'a cliente y avisos. Varios, separados por coma. Los correos de SEGURIDAD —contraseñas ' +
             'temporales y códigos de verificación— nunca se copian, y eso no es configurable.',
    tipo: 'lista_correos', soloMaestro: true, opcional: true, marcador: 'monitoreo@liverpool.com.mx'
  },
  {
    clave: 'WEBHOOK_URL', nombre: 'Webhook de cotizaciones', grupo: 'Avisos',
    detalle: 'A dónde se avisa cuando se crea una cotización. Vacío = no se manda nada.',
    tipo: 'secreto', secreto: true, webhook: true, marcador: 'https://chat.googleapis.com/v1/spaces/…',
    sinEfecto: SIN_EFECTO_CHAT
  },
  {
    clave: 'OPERACION_WEBHOOK_ESTADO', nombre: 'Webhook del estado de operación', grupo: 'Avisos',
    detalle: 'A dónde se comunica al equipo que un sistema se cayó, se restableció o entra en mantenimiento. Vacío = no se manda nada.',
    tipo: 'secreto', secreto: true, webhook: true, marcador: 'https://chat.googleapis.com/v1/spaces/…',
    sinEfecto: SIN_EFECTO_CHAT
  },
  {
    clave: 'OPERACION_WEBHOOK_REPORTES', nombre: 'Webhook de reportes sueltos', grupo: 'Avisos',
    detalle: 'Copia de CADA reporte que manda un asesor, uno por uno. Conviene que sea un espacio distinto ' +
             'al de los comunicados: si se mezclan, el aviso que importa se pierde entre los reportes. Vacío = apagado.',
    tipo: 'secreto', secreto: true, webhook: true, marcador: 'https://chat.googleapis.com/v1/spaces/…',
    sinEfecto: SIN_EFECTO_CHAT
  },
  {
    clave: 'PORTAL_SHEET_ID', nombre: 'Hoja del Portal', grupo: 'Fuentes de datos',
    detalle: 'Base de datos del portal: herramientas, paqueterías, formatos, plantillas y anuncios.',
    tipo: 'id_hoja', sinEfecto: SIN_EFECTO_D1
  },
  {
    clave: 'CCL_TEMPLATE_SHEET_ID', nombre: 'Plantilla CCL', grupo: 'Fuentes de datos',
    detalle: 'Hoja de la que se copia el formato oficial CCL Liverpool.',
    tipo: 'id_hoja', sinEfecto: 'En esta versión no se abren hojas de Google Drive: se guarda, pero no se usa.'
  },
  {
    clave: 'TRAZ_SHEET_ID', nombre: 'Hoja de trazabilidad', grupo: 'Fuentes de datos',
    detalle: 'Dónde se guarda el rastro de cambios de las cotizaciones.',
    tipo: 'id_hoja', sinEfecto: SIN_EFECTO_D1
  },
  {
    clave: 'PORTAL_CALENDAR_ID', nombre: 'Calendario comercial', grupo: 'Fuentes de datos',
    detalle: 'Calendario del que salen las promociones vigentes.',
    tipo: 'id_calendario', sinEfecto: 'En esta versión no se consulta el calendario de Google: se guarda, pero no se usa.'
  },
  {
    clave: 'PORTAL_ANUNCIOS_FOLDER_ID', nombre: 'Carpeta de anuncios', grupo: 'Fuentes de datos',
    detalle: 'Carpeta de Drive donde se guardan las imágenes de los anuncios del portal.',
    tipo: 'id_carpeta', sinEfecto: 'En esta versión las imágenes van al almacén de archivos de Cloudflare, no a Drive: se guarda, pero no se usa.'
  }
];

/** Orden de los grupos de ajustes en pantalla. */
const CONSOLA_GRUPOS_AJUSTES = ['Identidad', 'Correo', 'Avisos', 'Fuentes de datos'];

/** Configuraciones que YA tienen su pantalla: desde Ajustes solo se enlazan, no se copian. */
const CONSOLA_AJUSTES_ENLACES = [
  { nombre: 'Formatos de cotización', detalle: 'Qué formatos se pueden usar y cuál sale por defecto.',
    panel: 'formatos', bloque: 'adm_formatos' },
  { nombre: 'Política de revisión', detalle: 'Las reglas que mandan una cotización a revisión: montos, descuentos y excepciones.',
    pagina: 'revision_cotizacion', bloque: 'politica_revision' },
  { nombre: 'Módulos en mantenimiento', detalle: 'Apagar y encender bloques enteros mientras se arregla algo.',
    panel: 'modulos', bloque: 'adm_modulos' }
];

/** Hosts a los que se permite apuntar un webhook (una URL que el SERVIDOR visita: SSRF). */
const CONSOLA_WEBHOOK_HOSTS = ['chat.googleapis.com'];

/** Propiedad con la foto de la última revisión de salud. */
export const CONSOLA_PROP_SALUD = 'CONSOLA_ULTIMA_SALUD';
/** Propiedad con el momento en que se apagó cada módulo: {bloqueId: ISO}. */
const CONSOLA_PROP_MODULOS_DESDE = 'CONSOLA_MODULOS_DESDE';
/** Días que un módulo puede estar apagado antes de que la consola pregunte por él. */
const CONSOLA_MODULO_DIAS_AVISO = 7;
/** Correos que quedan en el día por debajo de los cuales conviene avisar. */
const CONSOLA_CUOTA_BAJA = 60;

/**
 * Valor de respaldo «en el código» de cada ajuste (consolaRespaldoEnCodigo_). En esta versión los
 * identificadores de Drive, Calendar y Chat ya no tienen respaldo: no hay nada a qué apuntar.
 */
function consolaRespaldoEnCodigo(clave: string): string {
  switch (clave) {
    case 'CUENTAS_DOMINIO': return CUENTAS_DOMINIO_RESPALDO;
    case 'MAIL_ALIAS':      return MAIL_ALIAS_RESPALDO_CF;   // en Apps Script, cotizacion@liverpool.com.mx
    case 'BREVO_REMITENTE': return BREVO_REMITENTE_RESPALDO;
    case 'CC_SENDER_NAME':  return CC_SENDER_NAME_RESPALDO;
    case 'AUTH_MODO':       return 'portal';
    default:                return '';
  }
}

interface AjusteSalida {
  clave: string; nombre: string; detalle: string; grupo: string; tipo: string;
  opciones: DefAjuste['opciones'] | null; marcador: string; secreto: boolean; soloMaestro: boolean; opcional: boolean;
  soloLectura: boolean; enPropiedades: boolean; enCodigo: boolean; configurado: boolean; valor: string; pista: string;
}

/**
 * consolaLeerAjustes_: los ajustes con su valor actual, en UNA lectura de propiedades. Los secretos
 * NO viajan: solo se dice si están puestos y cuántos caracteres miden.
 */
async function consolaLeerAjustes(ctx: Ctx, esMaestro?: boolean): Promise<AjusteSalida[]> {
  // Sin dato, lo prudente: los ajustes de solo maestro se pintan en modo consulta.
  const maestro = esMaestro !== false;
  const claves = CONSOLA_AJUSTES.map((a) => a.clave);
  const filas = await ctx.todas<{ clave: string; valor: string }>(
    'SELECT clave, valor FROM propiedades WHERE clave IN (' + claves.map(() => '?').join(', ') + ')', ...claves);
  const props: Record<string, string> = {};
  filas.forEach((f) => { props[f.clave] = f.valor; });

  return CONSOLA_AJUSTES.map((a) => {
    const enProp = props[a.clave];
    const enPropiedades = enProp !== undefined && enProp !== null && enProp !== '';
    // HASH_SALT tiene su respaldo dentro del núcleo (nucleo/seguridad.ts) y no se expone: se sabe
    // que existe, no cuánto mide. El resto, lo que decide secConfig: propiedad o respaldo.
    const respaldoNucleo = a.clave === 'HASH_SALT' && !enPropiedades;
    const efectivo = enPropiedades ? String(enProp) : consolaRespaldoEnCodigo(a.clave);
    const configurado = respaldoNucleo || !!efectivo;
    return {
      clave: a.clave, nombre: a.nombre, grupo: a.grupo, tipo: a.tipo,
      detalle: a.detalle + (a.sinEfecto ? ' ' + a.sinEfecto : '') + (a.nota ? ' ' + a.nota : ''),
      opciones: a.opciones || null, marcador: a.marcador || '',
      secreto: a.secreto === true,
      soloMaestro: a.soloMaestro === true,
      opcional: a.opcional === true || !!a.sinEfecto,
      soloLectura: a.soloLectura === true || (a.soloMaestro === true && !maestro),
      enPropiedades,
      // 'enCodigo' avisa de un secreto que vive en el código y no en las propiedades.
      enCodigo: !enPropiedades && configurado,
      configurado,
      valor: a.secreto ? '' : efectivo,
      pista: a.secreto && configurado
        ? (respaldoNucleo ? 'configurado · respaldo del código' : 'configurado · ' + efectivo.length + ' caracteres')
        : ''
    };
  });
}

/** consolaEnlacesAjustes_: los enlaces que esta persona puede seguir (filtrados por bloque). */
function consolaEnlacesAjustes(bloques: string[]) {
  const mios = bloques || [];
  return CONSOLA_AJUSTES_ENLACES.filter((e) => !e.bloque || mios.indexOf(e.bloque) !== -1)
    .map((e) => ({ nombre: e.nombre, detalle: e.detalle, panel: e.panel || '', pagina: e.pagina || '' }));
}

/** consolaHostDeUrl_: host de una URL https, estrecho a propósito (sin credenciales ni host vacío). */
function consolaHostDeUrl(url: string): string {
  const m = /^https:\/\/([A-Za-z0-9.-]+)(?::\d+)?(?:[\/?#]|$)/.exec(String(url || '').trim());
  if (!m) return '';
  const host = m[1].toLowerCase();
  if (!host || host.indexOf('.') === -1 || host.charAt(host.length - 1) === '.') return '';
  return host;
}

/**
 * consolaValidarAjuste_: comprueba que un valor sirve ANTES de guardarlo. Lo que en Apps Script se
 * comprobaba contra Drive o Calendar (abrir la hoja, buscar el calendario) aquí se valida solo por
 * forma: no hay servicio de Google al que preguntar, y se dice en el aviso.
 */
function consolaValidarAjuste(def: DefAjuste, valor: string): { ok: boolean; valor: string; error: string; aviso: string } {
  const bien = (v: string, aviso?: string) => ({ ok: true, valor: v, error: '', aviso: aviso || '' });
  const mal = (mensaje: string) => ({ ok: false, valor: '', error: mensaje, aviso: '' });

  if (def.tipo === 'opcion') {
    const validas = (def.opciones || []).map((o) => o.valor);
    if (validas.indexOf(valor) === -1) return mal('"' + valor + '" no es una opción válida.');
    return bien(valor);
  }
  if (def.tipo === 'correo') {
    const delDominio = (v: string) => v.endsWith('@' + DOMINIO_CORREO);
    if (def.clave === 'BREVO_REMITENTE') {
      // Lo lee el núcleo, que ignora cualquier dirección que no sea del dominio autenticado.
      if (!valor) return bien('', 'Sin remitente propio: los correos saldrán desde ' + BREVO_REMITENTE_RESPALDO + '.');
      if (!/^[^\s@,;]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(valor)) return mal('"' + valor + '" no parece un correo.');
      if (!delDominio(valor.toLowerCase())) {
        return mal('El remitente real tiene que ser una dirección @' + DOMINIO_CORREO + ': es el único dominio autenticado en Brevo.');
      }
      return bien(valor.toLowerCase());
    }
    if (!valor) return bien('', 'Sin alias: los correos saldrán desde la cuenta que ejecuta el sistema.');
    if (!/^[^\s@,;]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(valor)) return mal('"' + valor + '" no parece un correo.');
    // Como en Gmail con un alias no dado de alta: se guarda, y el correo sale igual desde el remitente real.
    if (!delDominio(valor.toLowerCase())) {
      return bien(valor.toLowerCase(), 'Guardado, pero en esta versión solo se envía desde @' + DOMINIO_CORREO +
        ': los correos saldrán desde el «Remitente real (Brevo)».');
    }
    return bien(valor.toLowerCase());
  }
  if (def.tipo === 'lista_correos') {
    if (!valor) return bien('', 'Sin copia oculta: los correos del sistema van solo a sus destinatarios.');
    const trozos = valor.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    const malos = trozos.filter((x) => !/^[^\s@,;]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(x));
    if (malos.length) return mal('Esto no parece un correo: ' + malos.join(', '));
    if (trozos.length > 5) return mal('Como mucho cinco buzones en copia oculta. Si hacen falta más, usa una lista de distribución.');
    const limpios: string[] = [];
    trozos.forEach((x) => { const c = x.toLowerCase(); if (limpios.indexOf(c) === -1) limpios.push(c); });
    return bien(limpios.join(','),
      'A partir de ahora ' + limpios.join(', ') + ' recibe copia oculta de las cotizaciones, las ' +
      'plantillas a cliente y los avisos. Los correos de seguridad siguen sin copiarse.');
  }
  if (def.clave === 'CUENTAS_DOMINIO') {
    if (!valor || valor.toLowerCase() === 'ninguno') {
      return bien('ninguno', 'Sin restricción de dominio: cualquier correo podrá crearse una cuenta.');
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(valor)) return mal('"' + valor + '" no parece un dominio.');
    return bien(valor.toLowerCase());
  }
  if (def.webhook) {
    if (!valor) {
      return bien('', ({
        WEBHOOK_URL: 'Sin webhook: dejarán de llegar los avisos de cotización nueva.',
        OPERACION_WEBHOOK_ESTADO: 'Sin webhook: el equipo dejará de recibir los avisos de caídas y restablecimientos.',
        OPERACION_WEBHOOK_REPORTES: 'Apagado: los reportes se seguirán guardando, pero no se anunciará ninguno.'
      } as Record<string, string>)[def.clave] || 'Sin webhook: no se mandará nada.');
    }
    const host = consolaHostDeUrl(valor);
    if (!host) return mal('Eso no es una URL completa. Pega la que te da Google Chat, empezando por https://');
    if (CONSOLA_WEBHOOK_HOSTS.indexOf(host) === -1) {
      return mal('El webhook solo puede apuntar a ' + CONSOLA_WEBHOOK_HOSTS.join(' o ') + '. Recibido: ' + host);
    }
    return bien(valor);
  }
  if (def.tipo === 'id_hoja') {
    if (!valor) return bien('', 'Sin identificador: se usará el que quede escrito en el código.');
    if (!/^[A-Za-z0-9_-]{20,}$/.test(valor)) {
      return mal('Eso no parece un identificador de hoja. Es el trozo largo de la URL, entre /d/ y /edit.');
    }
    return bien(valor);   // en Apps Script aquí se abría la hoja: sin Drive no hay qué abrir
  }
  if (def.tipo === 'id_calendario') {
    if (!valor) return bien('', 'Sin calendario: el monitor de promociones se quedará vacío.');
    return bien(valor);
  }
  if (def.tipo === 'id_carpeta') {
    if (!valor) return bien('', 'Sin carpeta: las imágenes de anuncios irán a donde el código decida.');
    return bien(valor);
  }
  if (def.tipo === 'texto') {
    // Fuera saltos de línea y tabuladores: alguno de estos textos acaba en una cabecera de correo.
    return bien(valor.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120));
  }
  return bien(valor);
}

// ── Recomendaciones del resumen ─────────────────────────────────────────────

type Recomendacion = { texto: string; tono: string; accion: string; panel: string; pagina: string };

/**
 * consolaRecomendaciones_: la lista de «esto conviene mirarlo». Todo lo de aquí es BARATO: se
 * calcula en cada apertura de la consola. De la salud se cita la última foto guardada.
 */
async function consolaRecomendaciones(ctx: Ctx, acc: AccesoOk, ajustesYaLeidos: AjusteSalida[] | null): Promise<Recomendacion[]> {
  const out: Recomendacion[] = [];
  const tiene = (s: string) => acc.secciones.indexOf(s) !== -1;
  // Qué sección abre cada panel: no se le ofrece a nadie un botón que no le va a funcionar.
  const SECCION_DE_PANEL: Record<string, string> = {
    miembros: 'roles', permisos: 'roles', modulos: 'modulos', ajustes: 'ajustes', formatos: 'formatos',
    salud: 'salud', metricas: 'metricas', bitacora: 'bitacora'
  };
  const anadir = (texto: string, tono: string, accion: string, destino: { panel?: string; pagina?: string }) => {
    const panel = (destino && destino.panel) || '';
    const seccion = SECCION_DE_PANEL[panel];
    const alcanzable = !panel || !seccion || tiene(seccion);
    out.push({ texto, tono: tono || 'aviso', accion: alcanzable ? (accion || '') : '',
               panel: alcanzable ? panel : '', pagina: (destino && destino.pagina) || '' });
  };

  // 1. Ajustes sin poner o secretos que siguen en el código fuente.
  if (tiene('ajustes')) {
    try {
      (ajustesYaLeidos || await consolaLeerAjustes(ctx, acc.maestro)).forEach((a) => {
        if (a.enCodigo && a.secreto) {
          anadir('«' + a.nombre + '» todavía vive en el código fuente en vez de en las propiedades del script.',
                 'aviso', 'Ir a Ajustes', { panel: 'ajustes' });
        } else if (!a.configurado && !a.soloLectura && !a.opcional) {
          anadir('«' + a.nombre + '» está sin configurar.', 'aviso', 'Ir a Ajustes', { panel: 'ajustes' });
        }
      });
    } catch (e) { console.error('recomendaciones/ajustes', e); }
  }

  // 2. Módulos apagados, con el tiempo que llevan así.
  try {
    const desde = await leerPropiedadJson<Record<string, string>>(ctx, CONSOLA_PROP_MODULOS_DESDE, {});
    for (const id of await permModulosApagados(ctx)) {
      const b = permBloque(id);
      const nombre = (b && b.nombre) || id;
      const dias = consolaDiasDesde(desde && desde[id]);
      if (dias >= CONSOLA_MODULO_DIAS_AVISO) {
        anadir('«' + nombre + '» lleva ' + dias + ' días apagado por mantenimiento: nadie del equipo lo ve.',
               'malo', 'Ir a Módulos', { panel: 'modulos' });
      } else {
        anadir('«' + nombre + '» está apagado por mantenimiento: nadie del equipo lo ve.',
               'aviso', 'Ir a Módulos', { panel: 'modulos' });
      }
    }
  } catch (e) { console.error('recomendaciones/modulos', e); }

  // De aquí para abajo son cifras de la instalación, y esa conversación es de maestros.
  if (!acc.maestro) return out;

  // 3. Envíos fallidos recientes: solo los últimos 200, la pregunta es «¿algo se rompió últimamente?».
  try {
    const corte = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fila = await ctx.una<{ n: number }>(
      'SELECT COUNT(*) AS n FROM (SELECT fecha, resultado FROM metricas_correos ORDER BY id DESC LIMIT 200) ' +
      "WHERE fecha >= ? AND (resultado IS NULL OR resultado NOT LIKE '%enviad%')", corte);
    const fallos = Number((fila && fila.n) || 0);
    if (fallos) anadir(fallos + ' correo(s) fallaron en los últimos siete días.', 'malo', 'Ver en Métricas', { panel: 'metricas' });
  } catch (e) { console.error('recomendaciones/correos', e); }

  // 4. La última revisión de salud (no se corre aquí: se cita la foto que dejó la última).
  try {
    const foto = await leerPropiedadJson<{ fecha?: string; fallos?: number } | null>(ctx, CONSOLA_PROP_SALUD, null);
    if (!foto) {
      anadir('La revisión del sistema no se ha corrido nunca desde la consola.', 'aviso', 'Ir a Salud', { panel: 'salud' });
    } else if (Number(foto.fallos) > 0) {
      const dias = consolaDiasDesde(foto.fecha);
      anadir('La última revisión del sistema (' + (dias <= 0 ? 'hoy' : 'hace ' + dias + ' día(s)') +
             ') dejó ' + foto.fallos + ' problema(s) sin resolver.', 'malo', 'Ir a Salud', { panel: 'salud' });
    } else if (consolaDiasDesde(foto.fecha) > 30) {
      anadir('Hace más de un mes que no se corre la revisión del sistema.', 'aviso', 'Ir a Salud', { panel: 'salud' });
    }
  } catch (e) { console.error('recomendaciones/salud', e); }

  // 5. Cuota de correo: al agotarse, los envíos fallan sin aviso al asesor.
  try {
    const quedan = await consolaCuotaCorreo(ctx);
    if (quedan >= 0 && quedan <= CONSOLA_CUOTA_BAJA) {
      anadir('Quedan ' + quedan + ' correos de la cuota de hoy. Al agotarse, los envíos fallan sin aviso al asesor.', 'malo', '', {});
    }
  } catch { /* nada */ }

  // 6. Altas que nunca entraron: la marca de contraseña temporal se limpia sola al entrar.
  try {
    const pendientes = (await consolaPersonas(ctx)).filter((p) => p.temporal).length;
    if (pendientes) {
      anadir(pendientes + ' persona(s) siguen con la contraseña temporal: nunca han entrado.', 'aviso', 'Ir a Roles', { panel: 'miembros' });
    }
  } catch (e) { console.error('recomendaciones/altas', e); }

  return out;
}

// ── Resumen y miembros ──────────────────────────────────────────────────────

/** consolaResumen_: cuánta gente hay, de qué rol, y (solo maestros) qué tan grande es la base. */
async function consolaResumen(ctx: Ctx, quien: UsuarioPermisos) {
  const esMaestro = !!(quien && quien.maestro === true);
  const miNivel = permNivelUsuario(quien);
  const resumen = {
    miembros: 0, activos: 0, bajas: 0,
    porRol: { normal: 0, avanzado: 0, maestro: 0 } as Record<string, number>,
    // «12 personas» a secas es mentira cuando en el sistema hay 40 y esta persona alcanza a 12.
    alcance: esMaestro ? 'sistema' : 'jerarquia',
    cotizaciones: 0, modulosApagados: (await permModulosApagados(ctx)).length,
    urlApp: '', zonaHoraria: '', cuotaCorreo: -1
  };
  for (const u of await consolaPersonas(ctx)) {
    // Se cuenta lo mismo que se lista.
    if (!esMaestro && u.nivel > miNivel && !permMismoCorreo(u.email, quien && quien.email)) continue;
    resumen.miembros++;
    if (!u.activo) resumen.bajas++; else resumen.activos++;
    if (resumen.porRol[u.rol] !== undefined) resumen.porRol[u.rol]++;
  }
  // Cifras del SISTEMA: esa conversación es de maestros.
  if (!esMaestro) return resumen;
  try {
    const fila = await ctx.una<{ n: number }>('SELECT COUNT(*) AS n FROM cotizaciones');
    resumen.cotizaciones = Number((fila && fila.n) || 0);
  } catch { /* nada */ }
  resumen.urlApp = cuentasUrlApp(ctx);   // ScriptApp.getService().getUrl() → el origen del Worker
  resumen.zonaHoraria = ZONA_MX;
  resumen.cuotaCorreo = await consolaCuotaCorreo(ctx);
  return resumen;
}

/**
 * consolaListaMiembros_: miembros con su rol y sus bloques ya resueltos. NUNCA incluye el hash de la
 * contraseña. Las filas que no se pueden tocar se pintan en gris con el motivo; las de nivel
 * SUPERIOR no se ven (que un supervisor sepa quiénes son los maestros es un mapa que no necesita).
 */
async function consolaListaMiembros(ctx: Ctx, quien: UsuarioPermisos) {
  const miNivel = permNivelUsuario(quien);
  return (await consolaPersonas(ctx)).map((u) => {
    const veto = permVetoJerarquia(quien, u);
    return {
      email: u.email,
      nombre: u.nombre || '',
      rol: u.rol,
      rolNombre: u.rolNombre,
      nivel: u.nivel,
      activo: u.activo,
      heredado: u.heredado === true,
      ajustes: u.ajustes,
      bloques: u.bloques,
      gestionable: veto === '',
      motivo: veto,
      alta: u.alta,
      fila: u.fila
    };
  }).filter((m) => m.nivel <= miNivel || permMismoCorreo(m.email, quien && quien.email))
    .sort((a, b) => (a.nivel !== b.nivel ? b.nivel - a.nivel : COLADOR_ES.compare(a.nombre || a.email, b.nombre || b.email)));
}

/** consolaLeerFormatos_: formatos con su estado (getFormatSettings de Formatos.gs). */
async function consolaLeerFormatos(ctx: Ctx, correo: string) {
  try {
    const r = await getFormatSettings(ctx, correo) as { success: boolean; formats?: unknown[] };
    return r && r.success ? (r.formats || []) : [];
  } catch (e) {
    console.error('consolaLeerFormatos', e);
    return [];
  }
}

// ── Panorama ────────────────────────────────────────────────────────────────

/**
 * Todo lo que la consola necesita al abrirse, en UNA llamada. Cada apartado se calcula SOLO si esta
 * persona lo va a ver.
 */
export async function consolaPanorama(ctx: Ctx, email: string) {
  try {
    const acc = await consolaAcceso(ctx, email);
    if (!acc.ok) return consolaError(acc.error);

    const yo = acc.usuario;
    const tiene = (s: string) => acc.secciones.indexOf(s) !== -1;
    const ajustes = tiene('ajustes') ? await consolaLeerAjustes(ctx, acc.maestro) : [];

    let grupos: unknown[] = [];
    if (tiene('roles') && acc.nivel >= GRP_NIVEL_MINIMO) {
      const g = await grpListar(ctx, acc.email) as { grupos?: unknown[] };
      grupos = g.grupos || [];
    }

    return {
      success: true,
      yo: { email: yo.email, nombre: yo.nombre, rol: yo.rol, rolNombre: yo.rolNombre, bloques: yo.bloques,
            maestro: acc.maestro, nivel: acc.nivel },
      secciones: acc.secciones,
      catalogo: await permCatalogoPara(ctx, yo),
      miembros: tiene('roles') ? await consolaListaMiembros(ctx, yo) : [],
      ajustes,
      gruposAjustes: tiene('ajustes') ? CONSOLA_GRUPOS_AJUSTES.slice() : [],
      enlacesAjustes: tiene('ajustes') ? consolaEnlacesAjustes(yo.bloques) : [],
      grupos,
      formatos: tiene('formatos') ? await consolaLeerFormatos(ctx, acc.email) : [],
      resumen: await consolaResumen(ctx, yo),
      recomendaciones: await consolaRecomendaciones(ctx, acc, ajustes),
      bitacora: tiene('bitacora') ? await consolaBitacoraLeer(ctx, 50, yo) : []
    };
  } catch (e) {
    console.error('consolaPanorama', e);
    return consolaError('No pudimos cargar la consola. Inténtalo de nuevo en un momento.');
  }
}

/** Lista de miembros para refrescar la tabla sin recargar toda la consola. */
export async function consolaMiembros(ctx: Ctx, email: string) {
  try {
    const acc = await consolaAcceso(ctx, email, 'roles');
    if (!acc.ok) return consolaError(acc.error);
    return { success: true, miembros: await consolaListaMiembros(ctx, acc.usuario), resumen: await consolaResumen(ctx, acc.usuario) };
  } catch (e) {
    console.error('consolaMiembros', e);
    return consolaError('No pudimos leer la lista de personas. Inténtalo de nuevo en un momento.');
  }
}

// ── Miembros: candados y escrituras ─────────────────────────────────────────

/** consolaCandados_: lo que impide que la consola se cierre por dentro. '' si el cambio es seguro. */
async function consolaCandados(ctx: Ctx, quien: UsuarioPermisos, objetivo: string, cambio: { rol?: string; activo?: boolean }): Promise<string> {
  const esYo = permMismoCorreo(quien && quien.email, objetivo);
  const actual = await permUsuario(ctx, objetivo);
  if (!actual.encontrado) return 'El correo ' + objetivo + ' no está dado de alta.';

  // 1. JERARQUÍA: decide si esta persona tiene algo que hacer aquí (y cubre el caso de uno mismo).
  const veto = permVetoJerarquia(quien, actual);
  if (veto) return veto;
  // 2. EL ROL QUE SE PIDE: una cosa es a quién alcanzas y otra hasta dónde puedes subirlo.
  if (cambio.rol) {
    const vetoRol = permVetoRol(quien, cambio.rol);
    if (vetoRol) return vetoRol;
  }
  // 3. Sobre uno mismo (la jerarquía ya lo corta; se deja por si un día se relaja aquella regla).
  if (esYo && cambio.rol && cambio.rol !== actual.rol) return 'No puedes cambiarte el rol a ti mismo. Pídeselo a otra persona.';
  if (esYo && cambio.activo === false) return 'No puedes darte de baja a ti mismo.';
  // 4. El último maestro no se va: si no, no queda nadie que pueda nombrar a otro.
  const dejaDeSerMaestro = actual.maestro && ((cambio.rol && cambio.rol !== 'maestro') || cambio.activo === false);
  if (dejaDeSerMaestro && (await permListaMaestros(ctx)).length <= 1) {
    return 'Es el único maestro del sistema. Nombra a otro antes de cambiar este.';
  }
  return '';
}

/**
 * consolaVetoBloques_: ¿los bloques que se piden conceder o retirar están dentro de lo que esta
 * persona puede repartir? El tercer flanco de la escalada de privilegios.
 */
function consolaVetoBloques(quien: UsuarioPermisos, mas: unknown, menos: unknown): string {
  const repartibles = permBloquesRepartibles(quien);
  const fuera = ([] as unknown[]).concat(Array.isArray(mas) ? mas : [], Array.isArray(menos) ? menos : [])
    .map((x) => String(x || '').trim())
    .filter((id) => PERM_IDS.indexOf(id) !== -1 && repartibles.indexOf(id) === -1);
  if (!fuera.length) return '';
  const nombres = fuera.map((id) => { const b = permBloque(id); return (b && b.nombre) || id; });
  return 'No puedes repartir ' + (fuera.length === 1 ? 'el acceso' : 'los accesos') +
         ' "' + nombres.join('", "') + '": no ' + (fuera.length === 1 ? 'lo tienes' : 'los tienes') + ' tú mismo.';
}

/**
 * Guarda el rol, los ajustes de permisos y el alta/baja de un miembro. Solo se aplican las llaves
 * presentes: {email, activo:false} da de baja sin tocar el rol ni los permisos.
 */
export async function consolaGuardarMiembro(ctx: Ctx, email: string, cambio: any) {
  try {
    const acc = await consolaAcceso(ctx, email, 'roles');
    if (!acc.ok) return consolaError(acc.error);

    const c = (cambio && typeof cambio === 'object') ? cambio : {};
    const objetivo = secNormalizarCorreo(c.email);
    if (!objetivo) return consolaError('Falta el correo de la persona que quieres cambiar.');

    // Cambiar permisos por bloque es una facultad distinta de cambiar el rol.
    const tocaPermisos = (c.mas !== undefined || c.menos !== undefined);
    if (tocaPermisos && !acc.maestro && acc.bloques.indexOf('sup_equipo') === -1) {
      return consolaError('Tu cuenta no puede cambiar accesos por bloque.');
    }
    if (tocaPermisos && acc.maestro && acc.bloques.indexOf('adm_permisos') === -1) {
      return consolaError('Tu cuenta maestra no puede cambiar permisos por bloque.');
    }
    if (tocaPermisos) {
      const vetoBloques = consolaVetoBloques(acc.usuario, c.mas, c.menos);
      if (vetoBloques) return consolaError(vetoBloques);
    }

    const pideRol = c.rol !== undefined && c.rol !== null && c.rol !== '';
    const rolPedido = pideRol ? permNormalizarRol(c.rol) : '';
    if (pideRol && !rolPedido) return consolaError('El rol "' + c.rol + '" no existe.');

    const activoPedido = (c.activo === undefined || c.activo === null) ? undefined : (c.activo === true);

    const veto = await consolaCandados(ctx, acc.usuario, objetivo, { rol: rolPedido, activo: activoPedido });
    if (veto) return consolaError(veto);

    const antes = await permUsuario(ctx, objetivo);
    const campos: Record<string, unknown> = {};
    const notas: string[] = [];

    if (rolPedido && rolPedido !== antes.rol) {
      campos.Rol = rolPedido;
      notas.push('rol ' + antes.rol + ' → ' + rolPedido);
    } else if (rolPedido && antes.heredado) {
      // Mismo rol, pero venía heredado de «Avanzado»: se escribe para dejar de adivinar.
      campos.Rol = rolPedido;
    }

    if (tocaPermisos) {
      const ajustes = permLimpiarAjustes({
        mas: c.mas !== undefined ? c.mas : antes.ajustes.mas,
        menos: c.menos !== undefined ? c.menos : antes.ajustes.menos
      });
      // Conceder lo que el rol ya trae, o retirar lo que no trae, solo ensucia la celda.
      const delRol = permBloquesDeRol(rolPedido || antes.rol);
      ajustes.mas = ajustes.mas.filter((id) => delRol.indexOf(id) === -1);
      ajustes.menos = ajustes.menos.filter((id) => delRol.indexOf(id) !== -1);
      const nuevoTexto = permSerializarAjustes(ajustes);
      if (nuevoTexto !== permSerializarAjustes(antes.ajustes)) {
        campos.Permisos = nuevoTexto;
        notas.push('permisos +[' + (ajustes.mas.join(', ') || '—') + '] −[' + (ajustes.menos.join(', ') || '—') + ']');
      }
    }

    if (activoPedido !== undefined && activoPedido !== antes.activo) {
      campos.Activo = activoPedido ? 'Si' : 'No';
      notas.push(activoPedido ? 'reactivado' : 'dado de baja');
    }

    const nombreNuevo = c.nombre !== undefined && c.nombre !== null ? String(c.nombre).trim().slice(0, 200) : '';
    if (nombreNuevo && nombreNuevo !== antes.nombre) {
      campos.Nombre = nombreNuevo;
      notas.push('nombre → ' + nombreNuevo);
    }

    if (!Object.keys(campos).length) {
      return { success: true, sinCambios: true, message: 'No había nada que cambiar.',
               miembros: await consolaListaMiembros(ctx, acc.usuario), resumen: await consolaResumen(ctx, acc.usuario) };
    }

    if (!(await permEscribirFila(ctx, objetivo, campos, acc.email))) {
      return consolaError('No se encontró la fila de ' + objetivo + ' en "Registros".');
    }
    await apuntarBitacora(ctx, acc.email, 'Rol o accesos modificados', objetivo, notas.join(' · '));

    // La lista se relee DESPUÉS de escribir y con el usuario ya actualizado.
    const yoAhora = await permUsuario(ctx, acc.email);
    return {
      success: true,
      message: 'Cambios guardados para ' + objetivo + '.',
      miembros: await consolaListaMiembros(ctx, yoAhora),
      resumen: await consolaResumen(ctx, yoAhora)
    };
  } catch (e) {
    console.error('consolaGuardarMiembro', e);
    return consolaError('No pudimos guardar los cambios. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Alta directa de un miembro, sin el código de verificación por correo. La contraseña se genera aquí
 * y se le manda a esa persona; quien da el alta nunca la ve (salvo que el correo no salga).
 */
export async function consolaAltaMiembro(ctx: Ctx, email: string, datos: any) {
  try {
    const acc = await consolaAcceso(ctx, email, 'roles');
    if (!acc.ok) return consolaError(acc.error);

    const d = (datos && typeof datos === 'object') ? datos : {};
    const nombre = String(d.nombre || '').trim();
    const correo = secNormalizarCorreo(d.email);
    const rol = permNormalizarRol(d.rol) || 'normal';

    // Un alta es la vía más limpia para fabricarse privilegios: aquí no hay a quién «alcanzar».
    const vetoRol = permVetoRol(acc.usuario, rol);
    if (vetoRol) return consolaError(vetoRol);
    const vetoBloques = consolaVetoBloques(acc.usuario, d.mas, d.menos);
    if (vetoBloques) return consolaError(vetoBloques);

    if (!nombre) return consolaError('Escribe el nombre de la persona.');
    if (!secCorreoValido(correo)) return consolaError('El correo "' + (d.email == null ? '' : d.email) + '" no tiene forma de correo.');
    if ((await secBuscarRegistro(ctx, correo)).encontrado) return consolaError('El correo ' + correo + ' ya está dado de alta.');

    // El dominio permitido se respeta también aquí: si no, la consola sería el agujero del registro.
    const dominio = await cuentasDominioPermitido(ctx);
    if (dominio && correo.split('@')[1] !== dominio) {
      return consolaError('Solo se pueden dar de alta correos @' + dominio + '. Cambia el dominio permitido en Ajustes si necesitas otro.');
    }

    const temporal = consolaPasswordTemporal();
    const alta = await cuentasAltaUsuario(ctx, nombre, correo, await secHashContrasena(ctx, temporal));
    if (!alta.success) return consolaError(alta.message);
    // El memo de esta petición dijo «no existe» hace un momento (secBuscarRegistro): se tira.
    ctx.olvidar('perm:');

    // La temporal solo sirve para entrar una vez: al hacerlo, se le pide que elija la suya.
    await cuentasMarcarPasswordTemporal(ctx, correo, true);

    // Rol y accesos concretos en el MISMO paso que el alta.
    const ajustesAlta = permLimpiarAjustes({ mas: d.mas, menos: d.menos });
    const delRol = permBloquesDeRol(rol);
    ajustesAlta.mas = ajustesAlta.mas.filter((id) => delRol.indexOf(id) === -1);
    ajustesAlta.menos = ajustesAlta.menos.filter((id) => delRol.indexOf(id) !== -1);
    const textoAjustes = permSerializarAjustes(ajustesAlta);
    if (rol !== 'normal' || textoAjustes) {
      const campos: Record<string, unknown> = { Rol: rol, Activo: 'Si' };
      if (textoAjustes) campos.Permisos = textoAjustes;
      await permEscribirFila(ctx, correo, campos, acc.email);
    }

    let avisoEnviado = false;
    let avisoError = '';
    if (d.avisar !== false) {
      try {
        await consolaCorreoBienvenida(ctx, correo, nombre, temporal, acc.nombre || acc.email);
        avisoEnviado = true;
      } catch (e: any) {
        avisoError = (e && e.message) || String(e);
        console.error('No se pudo enviar la bienvenida a ' + correo, e);
      }
    }

    await apuntarBitacora(ctx, acc.email, 'Persona dada de alta', correo, 'rol ' + rol +
      (ajustesAlta.mas.length ? ' · accesos +[' + ajustesAlta.mas.join(', ') + ']' : '') +
      (ajustesAlta.menos.length ? ' · accesos −[' + ajustesAlta.menos.join(', ') + ']' : '') +
      (avisoEnviado ? ' · aviso enviado' : ' · SIN aviso'));

    return {
      success: true,
      message: 'Se dio de alta a ' + nombre + '.',
      avisoEnviado,
      avisoError,
      // La contraseña temporal solo se devuelve si el correo NO salió.
      passwordTemporal: avisoEnviado ? '' : temporal,
      miembros: await consolaListaMiembros(ctx, acc.usuario),
      resumen: await consolaResumen(ctx, acc.usuario)
    };
  } catch (e) {
    console.error('consolaAltaMiembro', e);
    return consolaError('No pudimos dar de alta a esa persona. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Restablece la contraseña de un miembro y se la manda por correo. Pasa por la misma jerarquía que
 * editarla: es entregarle a alguien la llave de una cuenta ajena.
 */
export async function consolaResetPassword(ctx: Ctx, email: string, correoObjetivo: string) {
  try {
    const acc = await consolaAcceso(ctx, email, 'roles');
    if (!acc.ok) return consolaError(acc.error);

    const objetivo = secNormalizarCorreo(correoObjetivo);
    const vetoReset = permVetoJerarquia(acc.usuario, await permUsuario(ctx, objetivo));
    if (vetoReset) return consolaError(vetoReset);

    const reg = await secBuscarRegistro(ctx, objetivo);
    if (!reg.encontrado) return consolaError('El correo ' + objetivo + ' no está dado de alta.');

    const temporal = consolaPasswordTemporal();
    if (!(await cuentasActualizarPassword(ctx, objetivo, await secHashContrasena(ctx, temporal)))) {
      return consolaError('No se pudo escribir la contraseña nueva de ' + objetivo + '.');
    }
    await cuentasMarcarPasswordTemporal(ctx, objetivo, true);
    // Si estaba bloqueado por intentos fallidos, la contraseña nueva no le serviría hasta que venciera.
    await secIntentosLimpiar(ctx, objetivo);

    let avisoEnviado = false;
    let avisoError = '';
    try {
      await consolaCorreoReset(ctx, objetivo, reg.nombre, temporal, acc.nombre || acc.email);
      avisoEnviado = true;
    } catch (e: any) {
      avisoError = (e && e.message) || String(e);
      console.error('No se pudo enviar el restablecimiento a ' + objetivo, e);
    }

    await apuntarBitacora(ctx, acc.email, 'Contraseña restablecida', objetivo,
      avisoEnviado ? 'aviso enviado' : 'SIN aviso: ' + avisoError);

    return {
      success: true,
      message: avisoEnviado
        ? 'Se le mandó una contraseña temporal a ' + objetivo + '.'
        : 'Contraseña restablecida, pero el correo no salió. Dictásela en persona.',
      avisoEnviado,
      passwordTemporal: avisoEnviado ? '' : temporal
    };
  } catch (e) {
    console.error('consolaResetPassword', e);
    return consolaError('No pudimos restablecer la contraseña. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Borra a un miembro. La única operación que destruye algo: pide el correo tecleado como
 * confirmación y se niega en los casos caros. Para casi todo lo demás está la BAJA.
 */
export async function consolaEliminarMiembro(ctx: Ctx, email: string, correoObjetivo: string, confirmacion: string) {
  try {
    const acc = await consolaAcceso(ctx, email, 'roles');
    if (!acc.ok) return consolaError(acc.error);

    const objetivo = secNormalizarCorreo(correoObjetivo);
    if (secNormalizarCorreo(confirmacion) !== objetivo) return consolaError('Para borrar hay que escribir el correo completo tal cual.');
    if (objetivo === secNormalizarCorreo(acc.email)) return consolaError('No puedes borrarte a ti mismo.');

    const u = await permUsuario(ctx, objetivo);
    if (!u.encontrado) return consolaError('El correo ' + objetivo + ' no está dado de alta.');
    const vetoBorrar = permVetoJerarquia(acc.usuario, u);
    if (vetoBorrar) return consolaError(vetoBorrar);
    if (u.maestro) {
      return consolaError('No se puede borrar a un maestro. Bájale el rol primero, y así queda claro que fue a propósito.');
    }

    // Con la fila se van sus sesiones abiertas: si un día se vuelve a dar de alta ese correo, una
    // llave vieja no debe abrirle la puerta a la cuenta nueva.
    const r = await ctx.lote([
      ['DELETE FROM registros WHERE email = ?', objetivo],
      ['DELETE FROM sesiones WHERE email = ?', objetivo]
    ]);
    ctx.olvidar('perm:');
    ctx.olvidar('id:');
    if (!r[0] || !r[0].cambios) return consolaError('No se encontró la fila de ' + objetivo + '.');
    // También su fila de permisos: si no, dar de alta ese correo más adelante lo resucitaría con los
    // permisos que tenía antes de ser borrado.
    try { await permBorrarPermisos(ctx, objetivo); } catch (e) {
      console.error('No se pudo borrar la fila de permisos de ' + objetivo, e);
    }
    await apuntarBitacora(ctx, acc.email, 'Persona BORRADA', objetivo, 'nombre "' + (u.nombre || '') + '", rol ' + u.rol);
    return { success: true, message: 'Se borró a ' + objetivo + '.',
             miembros: await consolaListaMiembros(ctx, acc.usuario), resumen: await consolaResumen(ctx, acc.usuario) };
  } catch (e) {
    console.error('consolaEliminarMiembro', e);
    return consolaError('No pudimos borrar a esa persona. Inténtalo de nuevo en un momento.');
  }
}

/**
 * Manda un correo de cuenta con contraseña temporal y dice si SALIÓ de verdad. Va directo a
 * enviarCorreo (con los mismos datos que cuentasEnviarCorreo de identidad, sin copia oculta: es de
 * seguridad) porque aquí importa el estado: un correo 'omitido' —dirección de ejemplo, sin clave de
 * Brevo en este entorno o envío real apagado— no le llegó a nadie, y entonces la contraseña tiene que
 * verse en pantalla, que es el caso «el correo no salió» del original. Si Brevo lo rechaza, lanza.
 */
async function consolaEnviarCorreoCuenta(ctx: Ctx, para: string, asunto: string, html: string, plano: string, referencia: string):
  Promise<{ salio: boolean; motivo: string }> {
  const r = await enviarCorreo(ctx, {
    para, asunto, html, texto: plano, nombreDe: 'Sistema de cotizaciones Ventel', tipo: 'cuenta', referencia
  });
  if (r.estado === 'enviado') return { salio: true, motivo: '' };
  const fila = await correoEnBandeja(ctx, r.id);
  return { salio: false, motivo: (fila && fila.detalle) || 'El correo no salió.' };
}

/** Correo de bienvenida con la contraseña temporal. Es de seguridad: nunca lleva la copia oculta. */
async function consolaCorreoBienvenida(ctx: Ctx, correo: string, nombre: string, temporal: string, quien: string) {
  const url = cuentasUrlApp(ctx, 'login');
  const cuerpo =
    cuentasMailP('Hola ' + escaparHtml(String(nombre || '').split(' ')[0] || '') +
      ', te crearon una cuenta en el sistema de cotizaciones Ventel.', 1) +
    cuentasMailP('Entra con tu correo y esta contraseña temporal. Cámbiala en cuanto puedas desde ' +
      '“¿Olvidaste tu contraseña?”, para que sea tuya y de nadie más.', 2) +
    cuentasMailDatos([['Tu correo', correo], ['Contraseña temporal', temporal], ['Te dio de alta', quien || '']]) +
    cuentasMailBoton('Entrar al sistema', url) +
    cuentasMailNota('Guárdala en un lugar seguro',
      'Esta contraseña llegó por correo, así que trátala como temporal de verdad: cámbiala hoy.', 'aviso');
  return consolaEnviarCorreoCuenta(ctx, correo, 'Tu cuenta del sistema Ventel ya está lista',
    cuentasPlantillaCorreo({ titulo: 'Tu cuenta ya está lista', cuerpo, chip: 'Cuenta creada', tono: 'ok',
                             preheader: 'Contraseña temporal: ' + temporal }),
    'Tu cuenta del sistema Ventel ya está lista.\nCorreo: ' + correo + '\nContraseña temporal: ' + temporal + '\nEntra en: ' + url,
    'alta-consola');
}

/** Correo de contraseña restablecida por un administrador. Tampoco lleva copia oculta. */
async function consolaCorreoReset(ctx: Ctx, correo: string, nombre: string, temporal: string, quien: string) {
  const url = cuentasUrlApp(ctx, 'login');
  const cuerpo =
    cuentasMailP('Hola ' + escaparHtml(String(nombre || '').split(' ')[0] || '') +
      ', un administrador restableció la contraseña de tu cuenta.', 1) +
    cuentasMailP('Entra con esta contraseña temporal y cámbiala enseguida.', 2) +
    cuentasMailDatos([['Tu correo', correo], ['Contraseña temporal', temporal], ['Lo hizo', quien || '']]) +
    cuentasMailBoton('Entrar y cambiarla', url) +
    cuentasMailNota('¿No lo pediste?',
      'Avisa de inmediato al equipo del sistema: alguien con acceso de administrador cambió tu contraseña.', 'alerta');
  await cuentasEnviarCorreo(ctx, correo, 'Se restableció la contraseña de tu cuenta Ventel',
    cuentasPlantillaCorreo({ titulo: 'Contraseña restablecida', cuerpo, chip: 'Seguridad', tono: 'aviso',
                             preheader: 'Contraseña temporal: ' + temporal }),
    'Se restableció tu contraseña del sistema Ventel.\nContraseña temporal: ' + temporal + '\nEntra en: ' + url,
    { tipo: 'cuenta', referencia: 'restablecer-consola' });
}

// ── Ajustes del sistema ─────────────────────────────────────────────────────

/** Lee los ajustes (llamada suelta, para refrescar sin recargar la consola). */
export async function consolaAjustes(ctx: Ctx, email: string) {
  try {
    const gate = await consolaGate(ctx, email, 'adm_ajustes');
    if (!gate.ok) return consolaError(gate.error);
    return { success: true, ajustes: await consolaLeerAjustes(ctx, gate.maestro === true),
             grupos: CONSOLA_GRUPOS_AJUSTES.slice(), enlaces: consolaEnlacesAjustes(gate.bloques) };
  } catch (e) {
    console.error('consolaAjustes', e);
    return consolaError('No pudimos leer los ajustes. Inténtalo de nuevo en un momento.');
  }
}

/** Guarda UN ajuste, validado antes de escribirlo. */
export async function consolaGuardarAjuste(ctx: Ctx, email: string, clave: string, valor: unknown) {
  try {
    const gate = await consolaGate(ctx, email, 'adm_ajustes');
    if (!gate.ok) return consolaError(gate.error);

    const def = CONSOLA_AJUSTES.find((a) => a.clave === clave);
    if (!def) return consolaError('El ajuste "' + clave + '" no existe.');
    if (def.soloLectura) return consolaError('"' + def.nombre + '" no se puede cambiar desde aquí.');
    // El candado por ajuste, exigido en el servidor y no solo pintado en gris.
    if (def.soloMaestro && gate.maestro !== true) return consolaError('"' + def.nombre + '" solo lo cambia una cuenta maestra.');

    const nuevo = String(valor == null ? '' : valor).trim();
    const validacion = consolaValidarAjuste(def, nuevo);
    if (!validacion.ok) return consolaError(validacion.error);

    const antes = await secConfig(ctx, def.clave, consolaRespaldoEnCodigo(def.clave));
    if (validacion.valor === '') await borrarPropiedad(ctx, def.clave);
    else await fijarPropiedad(ctx, def.clave, validacion.valor);
    // secConfig memoriza por petición: lo que se lea después tiene que ver el valor nuevo.
    ctx.olvidar('prop:' + def.clave);

    await apuntarBitacora(ctx, gate.email, 'Ajuste cambiado', def.nombre,
      def.secreto ? '(valor oculto)' : ('"' + antes + '" → "' + validacion.valor + '"'));

    return {
      success: true,
      message: '"' + def.nombre + '" guardado.',
      // Lo que ya no tiene efecto en esta versión se dice al guardarlo, si no hay otro aviso.
      aviso: validacion.aviso || def.sinEfecto || '',
      ajustes: await consolaLeerAjustes(ctx, gate.maestro === true)
    };
  } catch (e) {
    console.error('consolaGuardarAjuste', e);
    return consolaError('No pudimos guardar el ajuste. Inténtalo de nuevo en un momento.');
  }
}

// ── Módulos (mantenimiento) ─────────────────────────────────────────────────

/** Apunta cuándo se apagó un módulo (y lo borra al encenderlo). Nunca revienta la operación. */
async function consolaMarcarModuloDesde(ctx: Ctx, bloqueId: string, apagado: boolean): Promise<void> {
  try {
    const mapa = await leerPropiedadJson<Record<string, string>>(ctx, CONSOLA_PROP_MODULOS_DESDE, {});
    const limpio = (mapa && typeof mapa === 'object') ? mapa : {};
    if (apagado) limpio[bloqueId] = new Date().toISOString();
    else delete limpio[bloqueId];
    await fijarPropiedad(ctx, CONSOLA_PROP_MODULOS_DESDE, JSON.stringify(limpio));
  } catch (e) {
    console.error('consolaMarcarModuloDesde', e);
  }
}

/**
 * Apaga o enciende un bloque para TODO el mundo. El maestro conserva el acceso a lo apagado, y los
 * bloques `fijo` no se pueden apagar.
 */
export async function consolaGuardarModulo(ctx: Ctx, email: string, bloqueId: string, apagado: unknown) {
  try {
    const gate = await consolaGate(ctx, email, 'adm_modulos');
    if (!gate.ok) return consolaError(gate.error);

    const bloque = permBloque(bloqueId);
    if (!bloque) return consolaError('El módulo "' + bloqueId + '" no existe.');
    if (bloque.fijo) return consolaError('"' + bloque.nombre + '" no se puede apagar: la app se quedaría sin puerta de entrada.');

    const actuales = await permModulosApagados(ctx);
    const quiereApagar = apagado === true;
    const yaEsta = actuales.indexOf(bloque.id) !== -1;
    if (quiereApagar === yaEsta) {
      return { success: true, sinCambios: true, apagados: actuales, catalogo: await permCatalogo(ctx) };
    }

    const nuevos = quiereApagar ? actuales.concat([bloque.id]) : actuales.filter((id) => id !== bloque.id);
    const guardados = await permFijarModulosApagados(ctx, nuevos);
    await consolaMarcarModuloDesde(ctx, bloque.id, quiereApagar);
    await apuntarBitacora(ctx, gate.email, quiereApagar ? 'Módulo apagado' : 'Módulo encendido', bloque.nombre,
      quiereApagar ? 'en mantenimiento para todos menos los maestros' : 'de vuelta en servicio');

    return {
      success: true,
      message: '"' + bloque.nombre + '" ' + (quiereApagar ? 'quedó en mantenimiento.' : 'volvió a estar disponible.'),
      apagados: guardados,
      catalogo: await permCatalogo(ctx),
      // Apagar un módulo cambia los bloques efectivos de todo el mundo: la tabla vuelve recalculada.
      miembros: await consolaListaMiembros(ctx, await permUsuario(ctx, gate.email))
    };
  } catch (e) {
    console.error('consolaGuardarModulo', e);
    return consolaError('No pudimos cambiar el módulo. Inténtalo de nuevo en un momento.');
  }
}

// ── Formatos de cotización ──────────────────────────────────────────────────

export async function consolaGuardarFormato(ctx: Ctx, email: string, formatId: string, habilitado: unknown) {
  try {
    const gate = await consolaGate(ctx, email, 'adm_formatos');
    if (!gate.ok) return consolaError(gate.error);

    const r = await setQuoteFormatEnabled(ctx, gate.email, String(formatId == null ? '' : formatId), habilitado === true) as
      { success: boolean; message?: string; formats?: unknown[] };
    if (!r || !r.success) return consolaError((r && r.message) || 'No se pudo guardar el formato.');

    await apuntarBitacora(ctx, gate.email, habilitado ? 'Formato habilitado' : 'Formato deshabilitado', String(formatId || ''), '');
    return { success: true, message: 'Formatos actualizados.', formatos: r.formats };
  } catch (e) {
    console.error('consolaGuardarFormato', e);
    return consolaError('No pudimos guardar el formato. Inténtalo de nuevo en un momento.');
  }
}

// ── Salud y bitácora ────────────────────────────────────────────────────────

/** Corre la revisión maestra completa (salud.ts, adaptada a D1) y la devuelve para pintarla. */
export async function consolaSalud(ctx: Ctx, email: string) {
  try {
    const gate = await consolaGate(ctx, email, 'adm_salud');
    if (!gate.ok) return consolaError(gate.error);

    const reporte = await revisionMaestra(ctx);
    const fallos = (reporte.checks || []).filter((c) => !c.ok).length;
    await apuntarBitacora(ctx, gate.email, 'Revisión del sistema', '', fallos ? fallos + ' problema(s)' : 'todo en orden');

    // Foto de esta corrida para el resumen: el marcador, no el reporte entero.
    try {
      await fijarPropiedad(ctx, CONSOLA_PROP_SALUD, JSON.stringify({
        fecha: new Date().toISOString(), fallos, total: (reporte.checks || []).length
      }));
    } catch (e) {
      console.error('No se pudo guardar la foto de la revisión', e);
    }
    return { success: true, reporte };
  } catch (e) {
    console.error('consolaSalud', e);
    return consolaError('No pudimos correr la revisión. Inténtalo de nuevo en un momento.');
  }
}

export async function consolaBitacora(ctx: Ctx, email: string, limite?: unknown) {
  try {
    const acc = await consolaAcceso(ctx, email, 'bitacora');
    if (!acc.ok) return consolaError(acc.error);
    return { success: true, bitacora: await consolaBitacoraLeer(ctx, Number(limite) || CONSOLA_BITACORA_LIMITE, acc.usuario) };
  } catch (e) {
    console.error('consolaBitacora', e);
    return consolaError('No pudimos leer la bitácora. Inténtalo de nuevo en un momento.');
  }
}

export async function consolaBitacoraRango(ctx: Ctx, email: string, desde: unknown, hasta: unknown) {
  try {
    const acc = await consolaAcceso(ctx, email, 'bitacora');
    if (!acc.ok) return consolaError(acc.error);
    const rango = consolaRangoFechas(desde, hasta);
    if (!rango.ok) return consolaError(rango.error);

    const r = await consolaBitacoraEnRango(ctx, rango.desde, rango.hasta, acc.usuario);
    return {
      success: true,
      bitacora: r.filas,
      truncado: r.truncado,
      sinLlegar: r.sinLlegar === true,
      leidas: r.leidas,
      // Las fechas ya resueltas, para que el CSV y el rótulo digan el rango que se consultó.
      desde: rango.desde.toISOString(),
      hasta: rango.hasta.toISOString()
    };
  } catch (e) {
    console.error('consolaBitacoraRango', e);
    return consolaError('No pudimos leer la bitácora de esas fechas. Inténtalo de nuevo en un momento.');
  }
}
