/**
 * =================================================================================================
 * DIFUSIÓN — correo interno a un grupo | Sistema de cotizaciones Ventel
 * =================================================================================================
 * Fase 9 del plan de cierre (T9.3). Escribir un comunicado y mandárselo a un grupo (Grupos.gs)
 * con el formato del sistema, sin salir de la consola y sin copiar y pegar correos en Gmail.
 *
 * LA LECTURA DEL «EDITOR TIPO GMAIL», QUE EL PLAN DEJÓ DECLARADA Y AQUÍ SE CUMPLE: la libertad
 * es del CUERPO —párrafos con negritas, listas, enlaces, alguna imagen y un botón—; el MARCO
 * —logo, cabecera, pie— lo pone el sistema y no se edita. Así toda difusión sale formal sin
 * depender del pulso de quien la escribe, y quien escribe no tiene que pelearse con el diseño.
 *
 * EL CUERPO VIAJA COMO BLOQUES, NO COMO HTML. Es la misma decisión de los artículos (F8) y por
 * el mismo motivo: aceptar HTML del navegador sería aceptar marcado de terceros para mandarlo
 * a la bandeja de todo el equipo. Con bloques, el servidor sabe qué campos existen, descarta
 * el resto y CONSTRUYE el HTML con las piezas de la plantilla de Cuentas.gs, que escapan el
 * texto una por una. No hay ningún punto por el que el texto de un comunicado deje de ser texto.
 *
 * LOS DESTINATARIOS VAN EN CCO. El «Para» es quien manda. Un comunicado a cuarenta personas con
 * las cuarenta direcciones a la vista es una lista de correo interna repartida en cuarenta
 * bandejas, y basta un «responder a todos» para convertirlo en un hilo de cuarenta.
 *
 * Funciones expuestas al cliente:
 *   difPreparar(email)          → grupos, cuota de correo y remitente, para dibujar la pantalla
 *   difPrevia(email, payload)   → el HTML que se va a enviar, para verlo antes
 *   difEnviar(email, payload)   → lo manda de verdad
 *
 * Los .gs comparten un solo ámbito global: todo lo de aquí lleva prefijo `dif`.
 */

// ── TOPES ────────────────────────────────────────────────────────────────────
//
// Ninguno es burocrático: los tres primeros protegen la cuota y el tamaño del correo, y el
// último es el límite real de lo que Gmail acepta como adjunto en línea sin dar un error raro.

var DIF_MAX_ASUNTO      = 150;
var DIF_MAX_BLOQUES     = 60;
var DIF_MAX_TEXTO       = 4000;    // por bloque
var DIF_MAX_IMAGENES    = 4;
var DIF_MAX_BYTES       = 6 * 1024 * 1024;   // suma de las imágenes en línea
var DIF_MAX_DESTINOS    = 800;
var DIF_TIPO_METRICA    = 'Difusión';

// ── SANEO DEL CUERPO ─────────────────────────────────────────────────────────

/** Texto plano acotado y sin caracteres de control. Mismo criterio que artTexto_ (F8). */
function difTexto_(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .trim()
    .slice(0, max || DIF_MAX_TEXTO);
}

/**
 * Solo https, y se delega en el saneador de artículos cuando está desplegado: es la misma
 * pregunta («¿esta URL se puede poner en un enlace?») y tener dos respuestas distintas en el
 * mismo proyecto es cómo se cuela la tercera.
 */
function difUrlSegura_(u) {
  if (typeof artUrlSegura_ === 'function') return artUrlSegura_(u);
  const s = String(u == null ? '' : u).trim();
  if (!s || s.length > 2000) return '';
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}

/** Partes de un párrafo: {t, negrita?, cursiva?, url?}. El texto nunca deja de ser texto. */
function difPartes_(v) {
  const arr = Array.isArray(v) ? v : [];
  const out = [];
  let total = 0;
  for (let i = 0; i < arr.length && out.length < 200 && total < DIF_MAX_TEXTO; i++) {
    const p = arr[i] || {};
    const t = difTexto_(p.t, DIF_MAX_TEXTO - total);
    if (!t) continue;
    total += t.length;
    const parte = { t: t };
    if (p.negrita === true) parte.negrita = true;
    if (p.cursiva === true) parte.cursiva = true;
    const url = difUrlSegura_(p.url);
    if (url) parte.url = url;
    out.push(parte);
  }
  return out;
}

/**
 * Deja un bloque en su forma canónica, o `null` si no hay nada que enseñar.
 * Un tipo que no esté en esta lista se descarta entero: lo que el servidor no reconoce, no sale.
 */
function difBloque_(b, contadores) {
  b = b || {};
  const tipo = String(b.tipo || '').trim().toLowerCase();

  if (tipo === 'parrafo' || tipo === 'texto') {
    const partes = difPartes_(b.partes);
    return partes.length ? { tipo: 'parrafo', partes: partes } : null;
  }

  if (tipo === 'titulo') {
    const t = difTexto_(b.texto, 160);
    return t ? { tipo: 'titulo', texto: t } : null;
  }

  if (tipo === 'lista') {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40)
      .map(function (it) { return difPartes_(it); })
      .filter(function (p) { return p.length; });
    return items.length ? { tipo: 'lista', ordenada: b.ordenada === true, items: items } : null;
  }

  if (tipo === 'boton') {
    const url = difUrlSegura_(b.url);
    const texto = difTexto_(b.texto, 60) || 'Abrir';
    return url ? { tipo: 'boton', texto: texto, url: url } : null;
  }

  if (tipo === 'nota') {
    const texto = difTexto_(b.texto, 600);
    if (!texto) return null;
    // Los tonos son los tres que entiende cuentasMailTono_; cualquier otro cae al de marca.
    const tono = ['ok', 'warn'].indexOf(String(b.tono || '')) !== -1 ? String(b.tono) : '';
    return { tipo: 'nota', titulo: difTexto_(b.titulo, 80), texto: texto, tono: tono };
  }

  if (tipo === 'imagen') {
    if (contadores.imagenes >= DIF_MAX_IMAGENES) return null;
    const base64 = String(b.base64 || '');
    const mime = String(b.mime || '').toLowerCase();
    if (!base64 || mime.indexOf('image/') !== 0) return null;
    // El tamaño se mide sobre los bytes reales, no sobre la cadena base64 (que abulta un tercio
    // más). Pasarse no da un error de Gmail claro: da un envío que se queda a medias.
    let bytes;
    try { bytes = Utilities.base64Decode(base64); } catch (e) { return null; }
    if (contadores.bytes + bytes.length > DIF_MAX_BYTES) return null;
    contadores.imagenes++;
    contadores.bytes += bytes.length;
    return { tipo: 'imagen', bytes: bytes, mime: mime,
             nombre: difTexto_(b.nombre, 60) || ('imagen' + contadores.imagenes),
             pie: difTexto_(b.pie, 160) };
  }

  if (tipo === 'separador') return { tipo: 'separador' };

  return null;
}

/** Cuerpo entero saneado. Devuelve también qué se descartó, para poder decirlo. */
function difSanear_(bloques) {
  const contadores = { imagenes: 0, bytes: 0 };
  const bruto = Array.isArray(bloques) ? bloques : [];
  const out = [];
  let descartados = 0;
  for (let i = 0; i < bruto.length && out.length < DIF_MAX_BLOQUES; i++) {
    const b = difBloque_(bruto[i], contadores);
    if (b) out.push(b); else descartados++;
  }
  return { bloques: out, descartados: descartados, imagenes: contadores.imagenes, bytes: contadores.bytes };
}

// ── PINTADO DEL CORREO ───────────────────────────────────────────────────────

/** Un trozo de párrafo, ya escapado y con su negrita, cursiva o enlace. */
function difParteHtml_(p) {
  let html = secEscapeHtml_(p.t);
  if (p.negrita) html = '<strong>' + html + '</strong>';
  if (p.cursiva) html = '<em>' + html + '</em>';
  if (p.url) {
    html = '<a href="' + secEscapeHtml_(p.url) + '" target="_blank" ' +
           'style="color:' + CUENTAS_MAIL.brandDeep + ';text-decoration:underline">' + html + '</a>';
  }
  return html;
}

/**
 * Cuerpo HTML del correo a partir de los bloques ya saneados.
 *
 * Se usan las piezas de Cuentas.gs (cuentasMailP_, cuentasMailBoton_, cuentasMailNota_) en vez
 * de escribir HTML nuevo: son las que ya sobreviven a Outlook y al tema oscuro, y son las que
 * alguien seguirá manteniendo. Lo único que se escribe aquí son la lista, el separador y la
 * imagen, que la plantilla no tenía.
 */
function difCuerpoHtml_(bloques, imagenesEnLinea) {
  const M = CUENTAS_MAIL;
  const partes = [];

  bloques.forEach(function (b, i) {
    if (b.tipo === 'parrafo') {
      partes.push(cuentasMailP_(b.partes.map(difParteHtml_).join(''), 1));

    } else if (b.tipo === 'titulo') {
      partes.push('<p style="margin:22px 0 10px;font-family:' + M.fuente + ';font-size:17px;' +
                  'font-weight:700;line-height:1.35;color:' + M.ink + '" class="m-t1">' +
                  secEscapeHtml_(b.texto) + '</p>');

    } else if (b.tipo === 'lista') {
      const etiqueta = b.ordenada ? 'ol' : 'ul';
      const items = b.items.map(function (it) {
        return '<li style="margin:0 0 6px">' + it.map(difParteHtml_).join('') + '</li>';
      }).join('');
      partes.push('<' + etiqueta + ' class="m-t1" style="margin:0 0 16px;padding-left:22px;' +
                  'font-family:' + M.fuente + ';font-size:16px;line-height:1.6;color:' + M.ink + '">' +
                  items + '</' + etiqueta + '>');

    } else if (b.tipo === 'boton') {
      partes.push(cuentasMailBoton_(b.texto, b.url));

    } else if (b.tipo === 'nota') {
      partes.push(cuentasMailNota_(b.titulo, b.texto, b.tono));

    } else if (b.tipo === 'separador') {
      partes.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
                  'style="margin:6px 0 22px"><tr><td class="m-hair" ' +
                  'style="border-top:1px solid ' + M.line + ';font-size:0;line-height:0">&nbsp;</td></tr></table>');

    } else if (b.tipo === 'imagen') {
      /* Imagen EN LÍNEA (cid), no enlazada desde Drive. Una imagen de Drive solo se ve si el
         archivo es público, y en un correo interno eso significa o una imagen rota o un archivo
         del equipo abierto a internet. El adjunto en línea viaja con el correo y se ve siempre.
         Es el patrón de adjuntos de CorreoCliente.gs, con inlineImages en vez de attachments. */
      const cid = 'difimg' + i;
      imagenesEnLinea[cid] = Utilities.newBlob(b.bytes, b.mime, b.nombre).setName(cid);
      partes.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">' +
        '<tr><td align="center"><img src="cid:' + cid + '" alt="' + secEscapeHtml_(b.pie || b.nombre) + '" ' +
        'style="max-width:100%;height:auto;border-radius:10px;display:block"></td></tr>' +
        (b.pie ? '<tr><td align="center" class="m-t3" style="padding-top:6px;font-family:' + M.fuente +
                 ';font-size:12px;color:' + M.inkFaint + '">' + secEscapeHtml_(b.pie) + '</td></tr>' : '') +
        '</table>');
    }
  });

  return partes.join('');
}

/** Texto plano equivalente. Va siempre: hay quien lee el correo sin HTML, y los filtros lo miran. */
function difCuerpoPlano_(bloques, asunto, quien) {
  const lineas = [asunto, ''];
  bloques.forEach(function (b) {
    if (b.tipo === 'parrafo') lineas.push(b.partes.map(function (p) {
      return p.url ? (p.t + ' (' + p.url + ')') : p.t;
    }).join(''), '');
    else if (b.tipo === 'titulo') lineas.push(b.texto.toUpperCase(), '');
    else if (b.tipo === 'lista') {
      b.items.forEach(function (it, n) {
        lineas.push((b.ordenada ? (n + 1) + '. ' : '· ') + it.map(function (p) {
          return p.url ? (p.t + ' (' + p.url + ')') : p.t;
        }).join(''));
      });
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
function difArmar_(payload, quien, imagenesEnLinea) {
  const asunto = difTexto_(payload.asunto, DIF_MAX_ASUNTO);
  const saneado = difSanear_(payload.bloques);
  const cuerpo = difCuerpoHtml_(saneado.bloques, imagenesEnLinea);

  const html = cuentasPlantillaCorreo_({
    titulo: asunto,
    // El pie del sistema dice de parte de quién va: en un comunicado interno, «quién lo manda»
    // es la mitad del mensaje, y el remitente técnico es siempre la cuenta del sistema.
    cuerpo: cuerpo + cuentasMailP_('<span style="color:' + CUENTAS_MAIL.inkFaint + '">Enviado por ' +
            secEscapeHtml_(quien) + ' desde el sistema Ventel.</span>', 3, 0),
    chip: 'Comunicado',
    preheader: payload.resumen ? difTexto_(payload.resumen, 140) : asunto
  });

  return { asunto: asunto, html: html, saneado: saneado,
           plano: difCuerpoPlano_(saneado.bloques, asunto, quien) };
}

// ── GATE ─────────────────────────────────────────────────────────────────────

/** Mismo gate que los grupos (T9.1): sección Roles y NIVEL 2 o superior, nunca un bloque suelto. */
function difAcceso_(email) {
  if (typeof grpAcceso_ !== 'function') {
    return { ok: false, error: 'Grupos.gs no está desplegado: sin grupos no hay a quién difundir.' };
  }
  return grpAcceso_(email);
}

// ── FUNCIONES EXPUESTAS ──────────────────────────────────────────────────────

/** Lo que la pantalla necesita antes de escribir nada: a quién se puede mandar y cuánto queda. */
function difPreparar(email) {
  try {
    const acc = difAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    let cuota = -1;
    try { cuota = MailApp.getRemainingDailyQuota(); } catch (e) {}

    const lista = grpListar(acc.email);
    return {
      success: true,
      grupos: (lista && lista.grupos) || [],
      cuota: cuota,
      // La cuota es de la CUENTA que ejecuta el sistema, no de quien manda: conviene que se
      // vea antes de escribir, porque un comunicado a 200 personas gasta 200.
      remitente: (typeof mailAlias_ === 'function') ? mailAlias_() : '',
      topes: { asunto: DIF_MAX_ASUNTO, bloques: DIF_MAX_BLOQUES, imagenes: DIF_MAX_IMAGENES,
               destinatarios: DIF_MAX_DESTINOS }
    };
  } catch (e) {
    Logger.log('difPreparar error: ' + e);
    return { success: false, message: 'No pudimos preparar la difusión. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * El correo tal como va a salir, para verlo antes de mandarlo.
 *
 * Devuelve HTML, y eso pide una advertencia: la pantalla debe pintarlo en un iframe con
 * `srcdoc` y `sandbox`, NUNCA con innerHTML. No es que este HTML sea peligroso —lo acaba de
 * construir el servidor a partir de bloques, con todo el texto escapado—; es que un correo
 * trae estilos y tablas propias que se comerían la maquetación de la consola.
 */
function difPrevia(email, payload) {
  try {
    const acc = difAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    payload = payload || {};
    const armado = difArmar_(payload, acc.nombre || acc.email, {});
    if (!armado.asunto) return { success: false, message: 'Ponle un asunto antes de ver la vista previa.' };
    if (!armado.saneado.bloques.length) return { success: false, message: 'El comunicado está vacío.' };

    const grupo = payload.grupoId ? grpPorId_(payload.grupoId) : null;
    const destinos = payload.grupoId ? grpCorreosDe_(payload.grupoId) : [];

    return {
      success: true,
      html: armado.html,
      asunto: armado.asunto,
      // En la vista previa las imágenes en línea no se pintan (el cid solo existe dentro del
      // correo). Se dice con todas las letras en vez de enseñar un hueco.
      imagenes: armado.saneado.imagenes,
      descartados: armado.saneado.descartados,
      grupo: grupo ? grupo.nombre : '',
      destinatarios: destinos.length
    };
  } catch (e) {
    Logger.log('difPrevia error: ' + e);
    return { success: false, message: 'No pudimos armar la vista previa.' };
  }
}

/**
 * Manda el comunicado al grupo, en copia oculta.
 *
 * No es idempotente y no puede serlo: dos llamadas son dos correos. Por eso la pantalla lo
 * pide con `llamar()` y espera —nada de guardado optimista— y por eso el envío de prueba
 * existe: para que el ensayo no cueste un comunicado equivocado a cuarenta personas.
 *
 * @param {{grupoId:string, asunto:string, bloques:Array, prueba:boolean=}} payload
 *        `prueba:true` lo manda SOLO a quien lo escribe.
 */
function difEnviar(email, payload) {
  try {
    const acc = difAcceso_(email);
    if (!acc.ok) return { success: false, message: acc.error };

    payload = payload || {};
    const quien = acc.nombre || acc.email;
    const esPrueba = payload.prueba === true;

    const imagenes = {};
    const armado = difArmar_(payload, quien, imagenes);
    if (!armado.asunto) return { success: false, message: 'El comunicado necesita un asunto.' };
    if (!armado.saneado.bloques.length) return { success: false, message: 'El comunicado está vacío.' };

    const grupo = grpPorId_(payload.grupoId);
    if (!grupo && !esPrueba) return { success: false, message: 'Elige a qué grupo se manda.' };

    const destinos = esPrueba ? [] : grpCorreosDe_(payload.grupoId);
    if (!esPrueba && !destinos.length) {
      return { success: false, message: 'Ese grupo no tiene a nadie que pueda recibir correo.' };
    }
    if (destinos.length > DIF_MAX_DESTINOS) {
      return { success: false, message: 'El grupo pasa de ' + DIF_MAX_DESTINOS + ' personas. Pártelo en dos.' };
    }

    /* La cuota se comprueba ANTES. Cada destinatario en copia oculta cuenta uno, así que un
       comunicado a 200 personas con 150 correos de cuota restante no se manda «a medias»:
       Gmail lo rechaza entero y el remitente se queda sin saber a quién le llegó. */
    let cuota = -1;
    try { cuota = MailApp.getRemainingDailyQuota(); } catch (e) {}
    const necesarios = destinos.length + 1;
    if (cuota >= 0 && cuota < necesarios) {
      return { success: false, message: 'Hoy quedan ' + cuota + ' correos de cuota y este comunicado ' +
        'necesita ' + necesarios + '. Espera a mañana o manda a un grupo más pequeño.' };
    }

    /* El «Para» es quien escribe; el grupo va entero en copia oculta.
       `cco:false` es deliberado: la copia oculta GLOBAL no se añade a una difusión. Este correo
       ya va en CCO a todo un grupo interno y queda registrado en métricas y en la bitácora con
       su asunto y su número de destinatarios; sumarle el buzón de vigilancia solo serviría para
       mandárselo dos veces a quien esté en el grupo. */
    const opciones = { cco: false, bcc: destinos.join(','), inline: imagenes };
    if (esPrueba) delete opciones.bcc;

    let remitente = '';
    let error = '';
    try {
      remitente = cuentasEnviarCorreo_(acc.email, (esPrueba ? '[Prueba] ' : '') + armado.asunto,
                                       armado.html, armado.plano, opciones);
    } catch (e) {
      error = e.message || String(e);
    }

    // Métrica y bitácora, con el mismo registro unificado que el resto de los envíos.
    if (typeof metRegistrarEnvio_ === 'function') {
      metRegistrarEnvio_({
        tipo: DIF_TIPO_METRICA,
        referencia: esPrueba ? 'prueba' : (grupo ? grupo.nombre : ''),
        asesorEmail: acc.email, asesorNombre: quien,
        para: acc.email, destinatarios: 1, cc: 0, cco: destinos.length,
        asunto: armado.asunto, adjuntos: armado.saneado.imagenes,
        remitente: remitente, aliasUsado: !!remitente,
        resultado: error ? 'Error' : 'Enviado', detalle: error
      });
    }

    if (error) {
      Logger.log('difEnviar no pudo enviar: ' + error);
      return { success: false, message: 'No pudimos enviar el comunicado: ' + error };
    }

    consolaBitacoraApuntar_(acc.email, esPrueba ? 'Difusión de prueba' : 'Difusión enviada',
      esPrueba ? acc.email : (grupo ? grupo.nombre : ''),
      '«' + armado.asunto + '» · ' + (esPrueba ? 'solo a quien la escribió' : destinos.length + ' destinatario(s)'));

    return {
      success: true,
      message: esPrueba
        ? 'Prueba enviada a ' + acc.email + '. Revísala antes de mandarla al grupo.'
        : 'Comunicado enviado a ' + destinos.length + ' persona(s) de «' + grupo.nombre + '».',
      destinatarios: destinos.length,
      descartados: armado.saneado.descartados
    };
  } catch (e) {
    Logger.log('difEnviar error: ' + e);
    return { success: false, message: 'No pudimos enviar el comunicado. Inténtalo de nuevo en un momento.' };
  }
}

// ── DIAGNÓSTICO (desde el editor) ────────────────────────────────────────────

/** Comprueba que la difusión tiene todo lo que necesita. Ejecutar desde el editor. */
function difDiagnostico() {
  secSoloInterno_('difDiagnostico');
  Logger.log('═══ DIFUSIÓN ═══');
  const piezas = {
    'Grupos.gs': typeof grpListar === 'function',
    'Plantilla de correo (Cuentas.gs)': typeof cuentasPlantillaCorreo_ === 'function',
    'Envío (Cuentas.gs)': typeof cuentasEnviarCorreo_ === 'function',
    'Métricas (Metricas.gs)': typeof metRegistrarEnvio_ === 'function',
    'Bitácora (Consola.gs)': typeof consolaBitacoraApuntar_ === 'function'
  };
  Object.keys(piezas).forEach(function (k) { Logger.log((piezas[k] ? '  ✔ ' : '  ✖ ') + k); });
  try { Logger.log('Cuota de correo restante hoy: ' + MailApp.getRemainingDailyQuota()); } catch (e) {}
  return piezas;
}
