/**
 * DIFUSIÓN — correo interno a un grupo | Portal Ventel en Cloudflare
 * =================================================================
 * Port de Difusion.gs. Escribir un comunicado y mandárselo a un grupo con el formato del sistema.
 *
 * EL CUERPO VIAJA COMO BLOQUES, NUNCA COMO HTML: el servidor sabe qué campos existen, descarta el
 * resto y CONSTRUYE el HTML con las piezas de la plantilla del sistema (las de Cuentas.gs, que
 * exporta el módulo de identidad), que escapan el texto una por una. LOS DESTINATARIOS VAN EN CCO y
 * el «Para» es quien escribe. LA CUOTA SE COMPRUEBA ANTES. Y hay envío de prueba porque el envío
 * real no es idempotente.
 *
 * En esta versión el correo sale por Brevo (nucleo/correo.ts) y queda además completo en la bandeja
 * de salida (correos_salida); las direcciones de ejemplo nunca se mandan.
 *
 * IMÁGENES. En Apps Script iban EN LÍNEA (cid) y no enlazadas, para que viajaran con el correo sin
 * abrir ningún archivo del equipo a internet. Brevo no admite imágenes en línea por su API, así que
 * se conserva lo importante —la imagen viaja CON el correo y no queda publicada en ningún sitio—:
 * va como adjunto (PNG, JPG o GIF, los formatos que Brevo acepta) y en el cuerpo queda su rótulo en
 * lugar de un hueco roto. Los topes (cuántas, cuánto pesan) son los mismos.
 */
import type { Ctx } from '../../nucleo/contexto';
import { enviarCorreo, type Adjunto } from '../../nucleo/correo';
import { apuntarBitacora } from '../../nucleo/sistema';
import { escaparHtml } from '../../nucleo/util';
import { deBase64 } from '../../nucleo/cripto';
import { metRegistrarEnvio, mailAlias } from '../cotizaciones';
import { CUENTAS_MAIL, cuentasMailP, cuentasMailBoton, cuentasMailNota, cuentasPlantillaCorreo } from '../identidad';
import { consolaCuotaCorreo, correoEnBandeja } from './comun';
import { grpAcceso, grpListar, grpPorId, grpCorreosDe } from './grupos';
import { artUrlSegura } from './articulos';

// Topes: los tres primeros protegen la cuota y el tamaño del correo; el último es lo que Gmail acepta
// como imágenes en línea sin un error raro.
const DIF_MAX_ASUNTO = 150;
const DIF_MAX_BLOQUES = 60;
const DIF_MAX_TEXTO = 4000;   // por bloque
const DIF_MAX_IMAGENES = 4;
const DIF_MAX_BYTES = 6 * 1024 * 1024;   // suma de las imágenes en línea
const DIF_MAX_DESTINOS = 800;
const DIF_TIPO_METRICA = 'Difusión';
/** Imágenes que pueden viajar adjuntas (las extensiones que Brevo admite), con su extensión. */
const DIF_IMAGEN_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif' };

type Parte = { t: string; negrita?: true; cursiva?: true; url?: string };
type Bloque =
  | { tipo: 'parrafo'; partes: Parte[] }
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'lista'; ordenada: boolean; items: Parte[][] }
  | { tipo: 'boton'; texto: string; url: string }
  | { tipo: 'nota'; titulo: string; texto: string; tono: string }
  | { tipo: 'imagen'; bytes: number; mime: string; nombre: string; pie: string; base64: string }
  | { tipo: 'separador' };

// ── Saneo del cuerpo ────────────────────────────────────────────────────────

/** Texto plano acotado y sin caracteres de control. */
function difTexto(v: unknown, max?: number): string {
  return String(v == null ? '' : v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, max || DIF_MAX_TEXTO);
}

/** Solo https: la misma pregunta que en los artículos, con la misma respuesta. */
function difUrlSegura(u: unknown): string {
  return artUrlSegura(u);
}

function difPartes(v: unknown): Parte[] {
  const arr = Array.isArray(v) ? v : [];
  const out: Parte[] = [];
  let total = 0;
  for (let i = 0; i < arr.length && out.length < 200 && total < DIF_MAX_TEXTO; i++) {
    const p = arr[i] || {};
    const t = difTexto(p.t, DIF_MAX_TEXTO - total);
    if (!t) continue;
    total += t.length;
    const parte: Parte = { t };
    if (p.negrita === true) parte.negrita = true;
    if (p.cursiva === true) parte.cursiva = true;
    const url = difUrlSegura(p.url);
    if (url) parte.url = url;
    out.push(parte);
  }
  return out;
}

/** Un bloque en su forma canónica, o null. Un tipo que no esté aquí se descarta entero. */
function difBloque(b: any, contadores: { imagenes: number; bytes: number }): Bloque | null {
  b = (b && typeof b === 'object') ? b : {};
  const tipo = String(b.tipo || '').trim().toLowerCase();

  if (tipo === 'parrafo' || tipo === 'texto') {
    const partes = difPartes(b.partes);
    return partes.length ? { tipo: 'parrafo', partes } : null;
  }
  if (tipo === 'titulo') {
    const t = difTexto(b.texto, 160);
    return t ? { tipo: 'titulo', texto: t } : null;
  }
  if (tipo === 'lista') {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).map((it: unknown) => difPartes(it))
      .filter((p: Parte[]) => p.length);
    return items.length ? { tipo: 'lista', ordenada: b.ordenada === true, items } : null;
  }
  if (tipo === 'boton') {
    const url = difUrlSegura(b.url);
    const texto = difTexto(b.texto, 60) || 'Abrir';
    return url ? { tipo: 'boton', texto, url } : null;
  }
  if (tipo === 'nota') {
    const texto = difTexto(b.texto, 600);
    if (!texto) return null;
    const tono = ['ok', 'warn'].indexOf(String(b.tono || '')) !== -1 ? String(b.tono) : '';
    return { tipo: 'nota', titulo: difTexto(b.titulo, 80), texto, tono };
  }
  if (tipo === 'imagen') {
    if (contadores.imagenes >= DIF_MAX_IMAGENES) return null;
    const base64 = String(b.base64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    const mime = String(b.mime || '').toLowerCase();
    const ext = DIF_IMAGEN_EXT[mime];
    if (!base64 || !ext) return null;   // otro formato no podría viajar adjunto: se descarta y se dice
    // El tamaño se mide sobre los bytes reales, no sobre la cadena base64.
    let bytes = 0;
    try { bytes = deBase64(base64).length; } catch { return null; }
    if (contadores.bytes + bytes > DIF_MAX_BYTES) return null;
    contadores.imagenes++;
    contadores.bytes += bytes;
    // Nombre con la extensión de su formato: sin ella el proveedor rechazaría el correo entero.
    let nombre = (difTexto(b.nombre, 60) || ('imagen' + contadores.imagenes)).replace(/[\\\/:*?"<>|]+/g, '_');
    if (!new RegExp('\\.(' + ext + (ext === 'jpg' ? '|jpeg' : '') + ')$', 'i').test(nombre)) {
      nombre = nombre.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.' + ext;
    }
    return { tipo: 'imagen', bytes, mime, nombre, pie: difTexto(b.pie, 160), base64 };
  }
  if (tipo === 'separador') return { tipo: 'separador' };
  return null;
}

/** Cuerpo entero saneado, con lo que se descartó para poder decirlo. */
function difSanear(bloques: unknown) {
  const contadores = { imagenes: 0, bytes: 0 };
  const bruto = Array.isArray(bloques) ? bloques : [];
  const out: Bloque[] = [];
  let descartados = 0;
  for (let i = 0; i < bruto.length && out.length < DIF_MAX_BLOQUES; i++) {
    const b = difBloque(bruto[i], contadores);
    if (b) out.push(b); else descartados++;
  }
  return { bloques: out, descartados, imagenes: contadores.imagenes, bytes: contadores.bytes };
}

// ── Pintado del correo ──────────────────────────────────────────────────────

function difParteHtml(p: Parte): string {
  let html = escaparHtml(p.t);
  if (p.negrita) html = '<strong>' + html + '</strong>';
  if (p.cursiva) html = '<em>' + html + '</em>';
  if (p.url) {
    html = '<a href="' + escaparHtml(p.url) + '" target="_blank" ' +
           'style="color:' + CUENTAS_MAIL.brandDeep + ';text-decoration:underline">' + html + '</a>';
  }
  return html;
}

/** Cuerpo HTML a partir de los bloques ya saneados, con las piezas de la plantilla del sistema. */
function difCuerpoHtml(bloques: Bloque[], adjuntas: Adjunto[]): string {
  const M = CUENTAS_MAIL;
  const partes: string[] = [];
  bloques.forEach((b, i) => {
    if (b.tipo === 'parrafo') {
      partes.push(cuentasMailP(b.partes.map(difParteHtml).join(''), 1));
    } else if (b.tipo === 'titulo') {
      partes.push('<p style="margin:22px 0 10px;font-family:' + M.fuente + ';font-size:17px;' +
                  'font-weight:700;line-height:1.35;color:' + M.ink + '" class="m-t1">' + escaparHtml(b.texto) + '</p>');
    } else if (b.tipo === 'lista') {
      const etiqueta = b.ordenada ? 'ol' : 'ul';
      const items = b.items.map((it) => '<li style="margin:0 0 6px">' + it.map(difParteHtml).join('') + '</li>').join('');
      partes.push('<' + etiqueta + ' class="m-t1" style="margin:0 0 16px;padding-left:22px;' +
                  'font-family:' + M.fuente + ';font-size:16px;line-height:1.6;color:' + M.ink + '">' +
                  items + '</' + etiqueta + '>');
    } else if (b.tipo === 'boton') {
      partes.push(cuentasMailBoton(b.texto, b.url));
    } else if (b.tipo === 'nota') {
      partes.push(cuentasMailNota(b.titulo, b.texto, b.tono));
    } else if (b.tipo === 'separador') {
      partes.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
                  'style="margin:6px 0 22px"><tr><td class="m-hair" ' +
                  'style="border-top:1px solid ' + M.line + ';font-size:0;line-height:0">&nbsp;</td></tr></table>');
    } else if (b.tipo === 'imagen') {
      // La imagen viaja ADJUNTA (ver la cabecera) y aquí queda su rótulo, en el sitio donde iba.
      adjuntas.push({ nombre: b.nombre, tipo: b.mime, bytes: b.bytes, base64: b.base64 });
      partes.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="m-soft" ' +
        'style="margin:0 0 18px;background:' + M.surface2 + ';border:1px solid ' + M.line + ';border-radius:12px">' +
        '<tr><td class="m-t2" style="padding:12px 16px;font-family:' + M.fuente + ';font-size:13px;line-height:1.5;' +
        'color:' + M.inkSoft + '"><strong class="m-t1" style="color:' + M.ink + '">Imagen adjunta:</strong> ' +
        escaparHtml(b.nombre) + (b.pie ? '<br>' + escaparHtml(b.pie) : '') + '</td></tr></table>');
    }
  });
  return partes.join('');
}

/** Texto plano equivalente. Va siempre: hay quien lee el correo sin HTML. */
function difCuerpoPlano(bloques: Bloque[], asunto: string, quien: string): string {
  const partesDe = (it: Parte[]) => it.map((p) => p.url ? (p.t + ' (' + p.url + ')') : p.t).join('');
  const lineas: string[] = [asunto, ''];
  bloques.forEach((b) => {
    if (b.tipo === 'parrafo') lineas.push(partesDe(b.partes), '');
    else if (b.tipo === 'titulo') lineas.push(b.texto.toUpperCase(), '');
    else if (b.tipo === 'lista') {
      b.items.forEach((it, n) => lineas.push((b.ordenada ? (n + 1) + '. ' : '· ') + partesDe(it)));
      lineas.push('');
    }
    else if (b.tipo === 'boton') lineas.push(b.texto + ': ' + b.url, '');
    else if (b.tipo === 'nota') lineas.push((b.titulo ? b.titulo + ': ' : '') + b.texto, '');
    else if (b.tipo === 'imagen') lineas.push('[imagen' + (b.pie ? ': ' + b.pie : '') + ']', '');
    else if (b.tipo === 'separador') lineas.push('———', '');
  });
  lineas.push('Enviado por ' + quien + ' desde el sistema Ventel.');
  return lineas.join('\n');
}

/** El correo completo, con el marco del sistema. */
function difArmar(payload: any, quien: string, adjuntas: Adjunto[]) {
  const asunto = difTexto(payload.asunto, DIF_MAX_ASUNTO);
  const saneado = difSanear(payload.bloques);
  const cuerpo = difCuerpoHtml(saneado.bloques, adjuntas);
  const html = cuentasPlantillaCorreo({
    titulo: asunto,
    // En un comunicado interno, «quién lo manda» es la mitad del mensaje.
    cuerpo: cuerpo + cuentasMailP('<span style="color:' + CUENTAS_MAIL.inkFaint + '">Enviado por ' +
            escaparHtml(quien) + ' desde el sistema Ventel.</span>', 3, 0),
    chip: 'Comunicado',
    preheader: payload.resumen ? difTexto(payload.resumen, 140) : asunto
  });
  return { asunto, html, saneado, plano: difCuerpoPlano(saneado.bloques, asunto, quien) };
}

// ── Funciones expuestas ─────────────────────────────────────────────────────

/** Lo que la pantalla necesita antes de escribir nada: a quién se puede mandar y cuánto queda. */
export async function difPreparar(ctx: Ctx, email: string) {
  try {
    // Mismo gate que los grupos: sección Roles y NIVEL 2 o superior, nunca un bloque suelto.
    const acc = await grpAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };

    const cuota = await consolaCuotaCorreo(ctx);
    const lista = await grpListar(ctx, acc.email) as { grupos?: unknown[] };
    return {
      success: true,
      grupos: (lista && lista.grupos) || [],
      cuota,
      remitente: await mailAlias(ctx),
      topes: { asunto: DIF_MAX_ASUNTO, bloques: DIF_MAX_BLOQUES, imagenes: DIF_MAX_IMAGENES, destinatarios: DIF_MAX_DESTINOS }
    };
  } catch (e) {
    console.error('difPreparar', e);
    return { success: false, message: 'No pudimos preparar la difusión. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * El correo tal como va a salir. Devuelve HTML: la pantalla lo pinta en un iframe con `srcdoc` y
 * `sandbox`, nunca con innerHTML.
 */
export async function difPrevia(ctx: Ctx, email: string, payload: any) {
  try {
    const acc = await grpAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };

    const p = (payload && typeof payload === 'object') ? payload : {};
    const armado = difArmar(p, acc.nombre || acc.email, []);
    if (!armado.asunto) return { success: false, message: 'Ponle un asunto antes de ver la vista previa.' };
    if (!armado.saneado.bloques.length) return { success: false, message: 'El comunicado está vacío.' };

    const grupo = p.grupoId ? await grpPorId(ctx, p.grupoId) : null;
    const destinos = p.grupoId ? await grpCorreosDe(ctx, p.grupoId) : [];
    return {
      success: true,
      html: armado.html,
      asunto: armado.asunto,
      imagenes: armado.saneado.imagenes,
      descartados: armado.saneado.descartados,
      grupo: grupo ? grupo.nombre : '',
      destinatarios: destinos.length
    };
  } catch (e) {
    console.error('difPrevia', e);
    return { success: false, message: 'No pudimos armar la vista previa.' };
  }
}

/**
 * Manda el comunicado al grupo, en copia oculta. No es idempotente: dos llamadas son dos correos.
 * `prueba:true` lo manda SOLO a quien lo escribe.
 */
export async function difEnviar(ctx: Ctx, email: string, payload: any) {
  try {
    const acc = await grpAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };

    const p = (payload && typeof payload === 'object') ? payload : {};
    const quien = acc.nombre || acc.email;
    const esPrueba = p.prueba === true;

    const imagenes: Adjunto[] = [];
    const armado = difArmar(p, quien, imagenes);
    if (!armado.asunto) return { success: false, message: 'El comunicado necesita un asunto.' };
    if (!armado.saneado.bloques.length) return { success: false, message: 'El comunicado está vacío.' };

    const grupo = await grpPorId(ctx, p.grupoId);
    if (!grupo && !esPrueba) return { success: false, message: 'Elige a qué grupo se manda.' };

    const destinos = esPrueba ? [] : await grpCorreosDe(ctx, p.grupoId);
    if (!esPrueba && !destinos.length) return { success: false, message: 'Ese grupo no tiene a nadie que pueda recibir correo.' };
    if (destinos.length > DIF_MAX_DESTINOS) {
      return { success: false, message: 'El grupo pasa de ' + DIF_MAX_DESTINOS + ' personas. Pártelo en dos.' };
    }

    /* La cuota se comprueba ANTES: cada destinatario en copia oculta cuenta uno, y un comunicado que
       no cabe no se manda «a medias». */
    const cuota = await consolaCuotaCorreo(ctx);
    const necesarios = destinos.length + 1;
    if (cuota >= 0 && cuota < necesarios) {
      return { success: false, message: 'Hoy quedan ' + cuota + ' correos de cuota y este comunicado ' +
        'necesita ' + necesarios + '. Espera a mañana o manda a un grupo más pequeño.' };
    }

    /* El «Para» es quien escribe; el grupo va entero en copia oculta. La copia oculta GLOBAL no se
       añade a una difusión: ya va a todo un grupo interno y queda en métricas y bitácora. */
    // enviarCorreo LANZA si el proveedor rechaza el envío, como GmailApp.sendEmail: se trata igual.
    let remitente = '';
    let error = '';
    try {
      const r = await enviarCorreo(ctx, {
        para: acc.email,
        asunto: (esPrueba ? '[Prueba] ' : '') + armado.asunto,
        html: armado.html,
        texto: armado.plano,
        cco: esPrueba ? '' : destinos.join(','),
        de: await mailAlias(ctx),
        nombreDe: 'Sistema de cotizaciones Ventel',
        adjuntos: imagenes,
        tipo: 'difusion',
        referencia: esPrueba ? 'prueba' : (grupo ? grupo.nombre : '')
      });
      // El remitente que cuenta la métrica es el real (el núcleo lo fuerza al dominio de envío).
      const fila = await correoEnBandeja(ctx, r.id);
      remitente = (fila && fila.de) || '';
    } catch (e: any) {
      error = (e && e.message) || String(e);
      remitente = '';
    }

    await metRegistrarEnvio(ctx, {
      tipo: DIF_TIPO_METRICA,
      referencia: esPrueba ? 'prueba' : (grupo ? grupo.nombre : ''),
      asesorEmail: acc.email, asesorNombre: quien,
      para: acc.email, destinatarios: 1, cc: 0, cco: destinos.length,
      asunto: armado.asunto, adjuntos: armado.saneado.imagenes,
      remitente, aliasUsado: !!remitente,
      resultado: error ? 'Error' : 'Enviado', detalle: error
    });

    if (error) {
      console.error('difEnviar no pudo enviar: ' + error);
      return { success: false, message: 'No pudimos enviar el comunicado: ' + error };
    }

    await apuntarBitacora(ctx, acc.email, esPrueba ? 'Difusión de prueba' : 'Difusión enviada',
      esPrueba ? acc.email : (grupo ? grupo.nombre : ''),
      '«' + armado.asunto + '» · ' + (esPrueba ? 'solo a quien la escribió' : destinos.length + ' destinatario(s)'));

    return {
      success: true,
      message: esPrueba
        ? 'Prueba enviada a ' + acc.email + '. Revísala antes de mandarla al grupo.'
        : 'Comunicado enviado a ' + destinos.length + ' persona(s) de «' + (grupo ? grupo.nombre : '') + '».',
      destinatarios: destinos.length,
      descartados: armado.saneado.descartados
    };
  } catch (e) {
    console.error('difEnviar', e);
    return { success: false, message: 'No pudimos enviar el comunicado. Inténtalo de nuevo en un momento.' };
  }
}
