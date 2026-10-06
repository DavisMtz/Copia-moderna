/**
 * LA FICHA Y LA PÁGINA DEL ARTÍCULO EN LIVERPOOL.COM.MX | Portal Ventel en Cloudflare
 * ==================================================================================
 * Port de la parte «en vivo» de Revision.gs (revFichaDeUrl_, revFichasEnParalelo_, revPaginaArticulo y
 * sus ayudantes). UrlFetchApp → fetch con AbortSignal.timeout(8000).
 *
 * POR QUÉ EXISTE — el recuadro en blanco de la pantalla de revisión.
 * La página del artículo NUNCA carga en un <iframe>: liverpool.com.mx responde con
 *     X-Frame-Options: SAMEORIGIN
 *     Content-Security-Policy: frame-ancestors https://gcp-na-app.contentstack.com
 * y esas cabeceras las aplica el NAVEGADOR. La salida es traer el dato DESDE EL SERVIDOR: se pide la
 * página y de su HTML se extrae lo único que la revisión necesita comparar —nombre, imagen, precio con
 * promoción y precio de lista—, o se devuelve la página saneada para pintarla con `srcdoc` en un iframe
 * aislado.
 *
 * DESDE CLOUDFLARE es muy probable que la protección anti-bot de Liverpool conteste «Access Denied»
 * (403). Entonces se degrada EXACTAMENTE como en Apps Script cuando fallaba: ok:false con un motivo
 * legible, la foto del SKU como respaldo y la última ficha buena si alguna vez hubo una. Nunca se
 * inventa un precio: en una pantalla que autoriza documentos, un dato dudoso es peor que ninguno.
 *
 * SEGURIDAD: solo se pide lo que pasa revUrlArticuloSegura (host EXACTO de REV_HOSTS_ARTICULO), y las
 * redirecciones se siguen a mano, comprobando cada salto con la misma regla. UrlFetchApp las seguía
 * solo; aquí un salto fuera de Liverpool se trata como un rechazo del sitio en vez de seguirlo.
 */
import type { Ctx } from '../../nucleo/contexto';
import { cacheLeer, cacheGuardar } from '../../nucleo/sistema';
import { sha256Hex } from '../../nucleo/cripto';
import { revUrlArticuloSegura } from './constantes';

/**
 * La ficha se cachea 15 min: dos supervisores mirando el mismo folio no piden dos veces la página.
 * Esta caché NO es de datos de D1 (regla 7 de AGENTES.md): es de una consulta de red a un sitio ajeno
 * que tarda segundos, y la pantalla lo dice («dato guardado hasta 15 minutos»). Vive en la tabla
 * `cache`, con caducidad, igual que en CacheService.
 */
const REV_FICHA_TTL = 900;

/** Cada petición al sitio espera como mucho esto. */
const REV_TIEMPO_MAX_MS = 8000;

/** Saltos de redirección que se aceptan antes de rendirse (UrlFetchApp también tenía tope). */
const REV_MAX_SALTOS = 5;

/** Cabeceras de una petición de navegador normal. Sin esto, muchos CDN devuelven un 403. */
const REV_FICHA_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
};

/** Subdominios de imagen de Liverpool, en el mismo orden que usa Correos.gs. */
const REV_IMG_SUBDOMINIOS = ['ss571', 'sm571', 'sp514'];

/** Guardián de tamaño de la «última ficha buena» (mismo cupo que en PropertiesService). */
const REV_ULTIMA_TOPE = 500;

/** Tope del HTML que se devuelve. Por encima, el mensaje tarda más que abrir la pestaña. */
const REV_PAGINA_MAX_BYTES = 900000;

/** Lo que se quita SIEMPRE de la página: bloques que no aportan nada a una revisión. */
const REV_PAGINA_FUERA = ['script', 'noscript', 'iframe', 'object', 'embed', 'form', 'template', 'canvas'];

export interface Ficha {
  ok: boolean;
  motivo?: string;
  mensaje?: string;
  codigo?: number;
  titulo?: string;
  imagen?: string;
  imagenRespaldo?: string;
  precio?: number;
  precioLista?: number;
  hayPromo?: boolean;
  url?: string;
  capturada?: string;
  deCache?: boolean;
  ultimaBuena?: { titulo: string; precio: number; precioLista: number; capturada: string } | null;
  [extra: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// LA PETICIÓN
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Host de una hoja de estilo aceptable: Liverpool o un subdominio REAL suyo, por https. */
function revUrlEstiloSegura(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    // Más estricto que el /^https:\/\/[a-z0-9.-]*liverpool\.com\.mx\// de Apps Script, que dejaba
    // pasar "evilliverpool.com.mx": aquí cuenta el host completo o un subdominio de verdad.
    if (host !== 'liverpool.com.mx' && !host.endsWith('.liverpool.com.mx')) return '';
    return u.href;
  } catch {
    return '';
  }
}

/** Un artículo, comprobado otra vez con el analizador de URL que usará fetch (defensa en fondo). */
function revUrlArticuloParaPedir(url: string): string {
  const limpia = revUrlArticuloSegura(url);
  if (!limpia) return '';
  try {
    const u = new URL(limpia);
    return (u.protocol === 'https:' && !u.username && !u.password && revUrlArticuloSegura(u.href)) ? u.href : '';
  } catch {
    return '';
  }
}

/** Mensaje de un fallo de red, en cristiano cuando es el tiempo de espera. */
function revMotivoRed(e: any): string {
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
    return 'el sitio tardó más de ' + Math.round(REV_TIEMPO_MAX_MS / 1000) + ' segundos en contestar';
  }
  return String((e && e.message) || e || 'error de red');
}

/**
 * UrlFetchApp.fetch(url, {muteHttpExceptions:true, followRedirects:true}) con fetch: devuelve el
 * código HTTP sea cual sea y solo LANZA si no hubo respuesta (red caída, tiempo agotado, demasiados
 * saltos). Las redirecciones se siguen a mano y cada destino pasa por `permitido`; uno que no pase se
 * devuelve como lo que es para quien revisa: el sitio no dejó leer la página (código 3xx).
 */
async function revPedir(url: string, permitido: (u: string) => string): Promise<{ codigo: number; html: string; url: string }> {
  let actual = url;
  for (let salto = 0; salto <= REV_MAX_SALTOS; salto++) {
    const resp = await fetch(actual, {
      method: 'GET',
      headers: REV_FICHA_HEADERS,
      redirect: 'manual',
      signal: AbortSignal.timeout(REV_TIEMPO_MAX_MS)
    });
    const destino = resp.headers.get('location');
    if (resp.status >= 300 && resp.status < 400 && destino) {
      try { await resp.body?.cancel(); } catch { /* nada que liberar */ }
      let siguiente = '';
      try { siguiente = permitido(new URL(destino, actual).href); } catch { siguiente = ''; }
      if (!siguiente) return { codigo: resp.status, html: '', url: actual };
      actual = siguiente;
      continue;
    }
    if (resp.status !== 200) {
      try { await resp.body?.cancel(); } catch { /* nada que liberar */ }
      return { codigo: resp.status, html: '', url: actual };
    }
    return { codigo: 200, html: await resp.text(), url: actual };
  }
  throw new Error('demasiadas redirecciones');
}

/** Huella corta de una URL para las claves de caché (en Apps Script era MD5 en base64). */
async function revHuella(url: string): Promise<string> {
  return (await sha256Hex(url)).slice(0, 32);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// «ÚLTIMA FICHA BUENA» (tabla revision_fichas, migración 0004)
// ─────────────────────────────────────────────────────────────────────────────────────────
/*
 * A diferencia de la caché de 15 min, esto sobrevive DÍAS: es lo que se enseña cuando Liverpool
 * bloquea la consulta y no hay nada más reciente que mostrar. En Apps Script eran propiedades del
 * script 'rev-ultima-…'; aquí, una tabla. Solo guarda lo mínimo para pintar un precio con su
 * antigüedad, nunca el HTML.
 */

/** Guarda la última ficha buena de un artículo. Nunca lanza: si falla, se sigue sin ella. */
async function revGuardarUltimaBuena(ctx: Ctx, clave: string, url: string, ficha: Ficha): Promise<void> {
  try {
    const existe = await ctx.una('SELECT 1 AS si FROM revision_fichas WHERE clave = ?', clave);
    if (!existe) {
      // El tope solo frena altas nuevas: actualizar una que ya existía no se bloquea por el cupo.
      const n = await ctx.una<{ n: number }>('SELECT COUNT(*) AS n FROM revision_fichas');
      if (n && Number(n.n) >= REV_ULTIMA_TOPE) return;
    }
    await ctx.ejecutar(
      'INSERT INTO revision_fichas (clave, url, titulo, precio, precio_lista, capturada, actualizado) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(clave) DO UPDATE SET url = excluded.url, titulo = excluded.titulo, ' +
      'precio = excluded.precio, precio_lista = excluded.precio_lista, capturada = excluded.capturada, ' +
      'actualizado = excluded.actualizado',
      clave, url, ficha.titulo || '', ficha.precio, ficha.precioLista, ficha.capturada || ctx.ahoraIso(), ctx.ahoraIso());
  } catch (e) {
    console.error('revGuardarUltimaBuena', e);   // la revisión nunca se cae por esto
  }
}

/** La última ficha buena guardada de un artículo, o null si nunca hubo una. */
async function revUltimaBuena(ctx: Ctx, clave: string): Promise<Ficha['ultimaBuena']> {
  try {
    const f = await ctx.una<{ titulo: string; precio: number; precio_lista: number; capturada: string }>(
      'SELECT titulo, precio, precio_lista, capturada FROM revision_fichas WHERE clave = ?', clave);
    if (!f) return null;
    return { titulo: f.titulo || '', precio: f.precio, precioLista: f.precio_lista, capturada: f.capturada };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// LA FICHA
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * La ficha actual del artículo SIN el control de permiso (lo pone revFichaArticulo), para que la
 * verificación en lote la pueda reusar sin volver a mirar los permisos una vez por artículo.
 */
export async function revFichaDeUrl(ctx: Ctx, url: unknown, sku: unknown): Promise<Ficha> {
  try {
    const limpia = revUrlArticuloSegura(url);
    if (!limpia) {
      return { ok: false, motivo: 'url-invalida', mensaje: 'El enlace guardado no es una dirección de liverpool.com.mx.' };
    }
    const clave = 'rev-ficha-' + await revHuella(limpia);

    const guardada = await cacheLeer(ctx, clave).catch(() => null);
    if (guardada) {
      try {
        const previa = JSON.parse(guardada) as Ficha;
        previa.deCache = true;
        return previa;
      } catch { /* caché corrupta: se vuelve a pedir */ }
    }

    let resp: { codigo: number; html: string };
    try {
      const pedible = revUrlArticuloParaPedir(limpia);
      if (!pedible) throw new Error('dirección no válida');
      resp = await revPedir(pedible, revUrlArticuloParaPedir);
    } catch (e) {
      return { ok: false, motivo: 'sin-red', url: limpia, ultimaBuena: await revUltimaBuena(ctx, clave),
               mensaje: 'No se pudo contactar a liverpool.com.mx (' + revMotivoRed(e) + ').' };
    }

    const codigo = resp.codigo;
    if (codigo !== 200) {
      // 403 casi siempre = protección anti-bot; 404 = el artículo dejó de existir, que es un hallazgo de
      // revisión por sí mismo. En los dos, si alguna vez se leyó bien, se enseña ese precio con su edad.
      return {
        ok: false,
        motivo: codigo === 404 ? 'no-existe' : 'bloqueado',
        codigo,
        url: limpia,
        imagenRespaldo: revImagenPorSku(sku),
        ultimaBuena: await revUltimaBuena(ctx, clave),
        mensaje: codigo === 404
          ? 'Liverpool responde que este artículo ya no existe en su sitio (404). Verifícalo antes de aprobar.'
          : 'Liverpool rechazó la consulta automática (código ' + codigo + '). Ábrelo en una pestaña para compararlo.'
      };
    }

    const ficha = revExtraerFicha(resp.html);
    ficha.url = limpia;
    if (!ficha.imagen) ficha.imagen = revImagenPorSku(sku);
    ficha.capturada = new Date().toISOString();

    if (!ficha.ok) {
      ficha.imagenRespaldo = ficha.imagen;
      ficha.ultimaBuena = await revUltimaBuena(ctx, clave);
      return ficha;   // sin cachear: un fallo de lectura no merece quedarse 15 min
    }

    try { await cacheGuardar(ctx, clave, JSON.stringify(ficha), REV_FICHA_TTL); } catch { /* sin caché se sigue */ }
    // Aparte de la caché corta: esta SÍ se queda días, para el día que Liverpool bloquee.
    await revGuardarUltimaBuena(ctx, clave, limpia, ficha);
    return ficha;
  } catch (error: any) {
    console.error('revFichaDeUrl falló: ' + (error && error.message));
    return { ok: false, motivo: 'error', mensaje: 'No se pudo leer la ficha: ' + (error && error.message) };
  }
}

/**
 * Saca de la página lo poco que hace falta para revisarla: las <meta> og:* para nombre e imagen y el
 * bloque `data-testid="…-configurator-price"` para los precios (`discounted` = lo que se paga,
 * `original` = precio de lista). Si Liverpool rediseña y los testid desaparecen, ok:false en vez de
 * un precio inventado.
 */
export function revExtraerFicha(html: string): Ficha {
  const doc = String(html || '');
  if (doc.length < 500) {
    return { ok: false, motivo: 'vacia', mensaje: 'Liverpool devolvió una página vacía.' };
  }

  const titulo = revLimpiarTitulo(revMetaContenido(doc, 'og:title') || revPrimerH1(doc));
  const imagen = revMetaContenido(doc, 'og:image');

  // Se ancla al testid del configurador, el único que pertenece al producto que se mira (los
  // carruseles de "también te puede interesar" traen sus propios precios). SIN ancla no se lee
  // ningún precio: Apps Script caía al primer precio de la página, y un enlace que redirige a la
  // portada (liverpool.com.mx sin www → /tienda/home) devolvía el de un artículo cualquiera del
  // carrusel como si fuera el cotizado. Ahora eso es «sin precio», que es la verdad.
  const anclaPrecio = doc.search(/data-testid="\d+-configurator-price"/);

  const precio = anclaPrecio > -1 ? revPrecioTrasTestid(doc, 'discounted', anclaPrecio) : null;
  const precioLista = anclaPrecio > -1 ? revPrecioTrasTestid(doc, 'original', anclaPrecio) : null;

  if (precio === null) {
    return {
      ok: false, motivo: 'sin-precio',
      titulo, imagen,
      mensaje: 'Se abrió la página pero no encontramos el precio (Liverpool cambió el diseño de su sitio). ' +
               'Ábrela en una pestaña para compararla a mano.'
    };
  }

  return {
    ok: true,
    titulo,
    imagen,
    precio,
    // Sin descuento activo, Liverpool no pinta el precio tachado: el de lista es el mismo.
    precioLista: (precioLista === null) ? precio : precioLista,
    hayPromo: (precioLista !== null && precioLista > precio + 0.009)
  };
}

/** Contenido de una <meta>, con los atributos en cualquiera de los dos órdenes. */
function revMetaContenido(html: string, prop: string): string {
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let m = html.match(new RegExp('<meta[^>]+(?:property|name)="' + p + '"[^>]*content="([^"]*)"', 'i'));
  if (!m) m = html.match(new RegExp('<meta[^>]+content="([^"]*)"[^>]*(?:property|name)="' + p + '"', 'i'));
  return m ? revDesescapar(m[1]) : '';
}

function revPrimerH1(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? revDesescapar(m[1].replace(/<[^>]+>/g, '')) : '';
}

/**
 * Primer importe en pesos después de un `data-testid`. Liverpool parte el precio en varios <span> y
 * mete comentarios de React en medio: se limpia una ventana CORTA de texto y se busca ahí (si se
 * estira, el precio de "original" se cuela en el de "discounted").
 */
function revPrecioTrasTestid(html: string, testid: string, desde: number): number | null {
  const idx = html.indexOf('data-testid="' + testid + '"', desde || 0);
  if (idx === -1) return null;
  const ventana = html.slice(idx, idx + 500).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '');
  const m = ventana.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

/** "Anillo Map brillante | Gran Barata" → "Anillo Map brillante". */
function revLimpiarTitulo(t: unknown): string {
  return String(t || '').split('|')[0].replace(/\s+/g, ' ').trim();
}

/** Entidades HTML de las <meta>. Son las que aparecen en la práctica. */
function revDesescapar(s: unknown): string {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Imagen oficial del SKU: el respaldo cuando la página no se puede leer. Aunque no haya precio en
 * vivo, ver la foto al lado del nombre cotizado ya detecta el error más común (un SKU mal tecleado).
 */
export function revImagenPorSku(sku: unknown): string {
  const limpio = String(sku == null ? '' : sku).trim().replace(/[^0-9A-Za-z\-]/g, '');
  if (!limpio) return '';
  return 'https://' + REV_IMG_SUBDOMINIOS[0] + '.liverpool.com.mx/xl/' + encodeURIComponent(limpio) + '.jpg';
}

/**
 * Varias fichas a la vez: primero la caché, y lo que falte, en una sola tanda paralela (lo que en
 * Apps Script era UrlFetchApp.fetchAll). Cada artículo responde con SU motivo si falla.
 * @return mapa indice → ficha
 */
export async function revFichasEnParalelo(ctx: Ctx, pedidos: Array<{ indice: number; url: string; sku: string }>): Promise<Record<number, Ficha>> {
  const salida: Record<number, Ficha> = {};
  const lista = (pedidos || []).slice(0, 30);   // tope de cordura: una cotización no tiene 200 líneas

  // Las lecturas de caché van en paralelo: en serie serían treinta idas a D1 una tras otra.
  const conClave = await Promise.all(lista.map(async (p) => ({ ...p, clave: 'rev-ficha-' + await revHuella(p.url) })));
  const guardadas = await Promise.all(conClave.map((p) => cacheLeer(ctx, p.clave).catch(() => null)));

  const faltantes: Array<{ indice: number; url: string; sku: string; clave: string }> = [];
  conClave.forEach((p, i) => {
    const guardada = guardadas[i];
    if (guardada) {
      try {
        const previa = JSON.parse(guardada) as Ficha;
        previa.deCache = true;
        salida[p.indice] = previa;
        return;
      } catch { /* caché corrupta: se vuelve a pedir */ }
    }
    faltantes.push(p);
  });
  if (!faltantes.length) return salida;

  const respuestas = await Promise.allSettled(faltantes.map((p) => {
    const pedible = revUrlArticuloParaPedir(p.url);
    return pedible ? revPedir(pedible, revUrlArticuloParaPedir) : Promise.reject(new Error('dirección no válida'));
  }));

  const escrituras: Array<Promise<unknown>> = [];
  for (let i = 0; i < faltantes.length; i++) {
    const p = faltantes[i];
    const r = respuestas[i];
    if (r.status === 'rejected') {
      salida[p.indice] = { ok: false, motivo: 'sin-red',
        mensaje: 'No se pudo contactar a liverpool.com.mx (' + revMotivoRed(r.reason) + ').' };
      continue;
    }
    const codigo = r.value.codigo;
    if (codigo !== 200) {
      salida[p.indice] = {
        ok: false,
        motivo: codigo === 404 ? 'no-existe' : 'bloqueado',
        codigo,
        url: p.url,
        imagenRespaldo: revImagenPorSku(p.sku),
        mensaje: codigo === 404
          ? 'Liverpool responde que este artículo ya no existe en su sitio (404).'
          : 'Liverpool rechazó la consulta automática (código ' + codigo + ').'
      };
      continue;
    }
    const ficha = revExtraerFicha(r.value.html);
    ficha.url = p.url;
    if (!ficha.imagen) ficha.imagen = revImagenPorSku(p.sku);
    ficha.capturada = new Date().toISOString();
    if (ficha.ok) {
      escrituras.push(cacheGuardar(ctx, p.clave, JSON.stringify(ficha), REV_FICHA_TTL).catch(() => { /* sin caché se sigue */ }));
    }
    salida[p.indice] = ficha;
  }
  await Promise.all(escrituras);
  return salida;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// LA PÁGINA DE LIVERPOOL, DENTRO DEL PORTAL
// ─────────────────────────────────────────────────────────────────────────────────────────
/*
 * Quien tiene prohibido incrustar la página es el navegador del supervisor, no el servidor. El HTML se
 * limpia aquí (fuera scripts, formularios, iframes y manejadores de eventos), se le pone un <base> para
 * que sus imágenes —públicas— sigan resolviendo contra liverpool.com.mx, y la pantalla lo pinta con
 * `srcdoc` en un iframe AISLADO (sandbox vacío: ni scripts ni acceso a este origen). La limpieza es la
 * primera barrera; la de verdad es el aislamiento del iframe.
 */

/**
 * La página del artículo, saneada y lista para `srcdoc`, SIN el control de permiso (lo pone
 * revPaginaArticulo). `limpia` ya pasó revUrlArticuloSegura.
 */
export async function revPaginaDeUrl(ctx: Ctx, limpia: string): Promise<Record<string, unknown>> {
  // Armar esta copia son nueve peticiones (la página y sus hojas de estilo): si dos supervisores
  // miran el mismo artículo, o alguien cierra el visor y lo reabre, no se repiten. En Apps Script iba
  // troceada en CacheService; una fila de la tabla `cache` aguanta el documento entero.
  const claveCache = 'rev-pagina-' + await revHuella(limpia);
  try {
    const crudo = await cacheLeer(ctx, claveCache);
    if (crudo) {
      const previa = JSON.parse(crudo);
      if (previa && previa.html) {
        previa.deCache = true;
        return previa;
      }
    }
  } catch { /* caché ilegible: se vuelve a armar */ }

  let resp: { codigo: number; html: string };
  try {
    const pedible = revUrlArticuloParaPedir(limpia);
    if (!pedible) throw new Error('dirección no válida');
    resp = await revPedir(pedible, revUrlArticuloParaPedir);
  } catch (e) {
    return { ok: false, motivo: 'sin-red', url: limpia,
             mensaje: 'No se pudo contactar a liverpool.com.mx (' + revMotivoRed(e) + ').' };
  }

  const codigo = resp.codigo;
  if (codigo !== 200) {
    return {
      ok: false,
      motivo: codigo === 404 ? 'no-existe' : 'bloqueado',
      codigo, url: limpia,
      mensaje: codigo === 404
        ? 'Liverpool responde que este artículo ya no existe (404).'
        : 'Liverpool rechazó la consulta automática (código ' + codigo + '). Ábrelo en una pestaña.'
    };
  }

  const partes = revPartesPagina(resp.html);
  if (!partes || !partes.cuerpo) {
    return { ok: false, motivo: 'vacia', url: limpia,
             mensaje: 'La página del artículo llegó vacía. Ábrela en una pestaña para verla.' };
  }

  const html = revArmarPaginaIncrustada(partes, limpia, await revHojasDeEstilo(partes.hojas, limpia));
  if (!html) {
    return { ok: false, motivo: 'vacia', url: limpia,
             mensaje: 'No pudimos mostrar la página aquí dentro. Ábrela en una pestaña.' };
  }
  if (html.length > REV_PAGINA_MAX_BYTES) {
    return { ok: false, motivo: 'demasiado-grande', url: limpia, bytes: html.length,
             mensaje: 'La página es muy pesada para verla aquí dentro: se abre más rápido en una pestaña.' };
  }

  const salida = { ok: true, html, bytes: html.length, url: limpia, capturada: new Date().toISOString() };
  try { await cacheGuardar(ctx, claveCache, JSON.stringify(salida), REV_FICHA_TTL); } catch { /* sin caché se sigue igual */ }
  return salida;
}

/**
 * Descompone la página en lo único que hace falta para reconstruirla: su cuerpo ya saneado, sus
 * estilos en línea y las direcciones de sus hojas de estilo. Expresiones regulares sobre HTML están
 * bien AQUÍ porque el resultado no se ejecuta: acaba en un iframe con sandbox vacío.
 */
export function revPartesPagina(html: string): { cuerpo: string; enLinea: string; hojas: string[] } | null {
  let doc = String(html || '');
  if (doc.length < 500) return null;

  // 1 · Fuera los bloques que no pintan nada en una revisión y sí pueden ejecutar cosas.
  REV_PAGINA_FUERA.forEach((tag) => {
    doc = doc.replace(new RegExp('<' + tag + '[^>]*>[\\s\\S]*?<\\/' + tag + '>', 'gi'), '');
    doc = doc.replace(new RegExp('<' + tag + '[^>]*\\/?>', 'gi'), '');
  });

  // 2 · Las precargas de JavaScript ya no apuntan a nada útil y disparan peticiones de más.
  doc = doc.replace(/<link[^>]+rel=["'](?:preload|modulepreload|prefetch)["'][^>]*>/gi, '');

  // 3 · Manejadores en línea y URLs con esquema ejecutable.
  doc = doc.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
           .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
           .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
           .replace(/(href|src|action)\s*=\s*["']\s*(?:javascript|data|vbscript):[^"']*["']/gi, '$1="#"');

  const cabeza = doc.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const cuerpo = doc.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!cuerpo) return null;

  const partes = { cuerpo: cuerpo[1], enLinea: '', hojas: [] as string[] };
  if (cabeza) {
    const estilos = cabeza[1].match(/<style[^>]*>[\s\S]*?<\/style>/gi);
    if (estilos) partes.enLinea = estilos.join('\n');
    const enlaces = cabeza[1].match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || [];
    enlaces.forEach((l) => {
      const m = l.match(/href=["']([^"']+)["']/i);
      if (m) partes.hojas.push(m[1]);
    });
  }
  return partes;
}

/**
 * El contenido de las hojas de estilo de la página. Se DESCARGAN en vez de enlazarlas porque, pedidas
 * a liverpool.com.mx desde otro origen, el navegador las carga pero no aplica sus reglas (comprobado
 * en Apps Script): incrustadas son estilos propios y aplican siempre.
 */
async function revHojasDeEstilo(hrefs: string[], urlOriginal: string): Promise<string[]> {
  const origen = String(urlOriginal || '').replace(/^(https:\/\/[^\/]+).*$/, '$1');
  const lista = (hrefs || []).slice(0, 12).map((h) => {
    if (/^https?:\/\//i.test(h)) return h;
    if (h.indexOf('//') === 0) return 'https:' + h;
    if (h.charAt(0) === '/') return origen + h;
    return origen + '/' + h;
  }).map(revUrlEstiloSegura).filter(Boolean);   // solo del propio Liverpool: la lista la dicta una página ajena

  if (!lista.length) return [];

  const respuestas = await Promise.allSettled(lista.map((u) => revPedir(u, revUrlEstiloSegura)));
  const css: string[] = [];
  respuestas.forEach((r) => {
    // Una hoja que falla no tumba la página.
    if (r.status === 'fulfilled' && r.value.codigo === 200) css.push(r.value.html);
  });
  return css;
}

/**
 * Quita del CSS las reglas que este documento no puede usar (las hojas de un artículo suman ~457 KB
 * de utilidades para TODO el sitio). Conservador: se descarta una regla solo cuando alguna clase o id
 * que EXIGE no aparece en el documento; selectores de etiqueta, :root, @font-face, @keyframes y
 * atributos se conservan. Mismo algoritmo que en Apps Script, recorriendo por índices en vez de
 * concatenar carácter a carácter (el Worker tiene la CPU contada).
 */
export function revPurgarCss(css: string, usa: { clases: Record<string, number>; ids: Record<string, number> }): string {
  return revPurgarBloque(String(css || '').replace(/\/\*[\s\S]*?\*\//g, ''), usa);
}

function revPurgarBloque(texto: string, usa: { clases: Record<string, number>; ids: Record<string, number> }): string {
  let salida = '';
  let inicio = 0;          // dónde empieza el «prelude» (selector o regla @) en curso
  let i = 0;
  const n = texto.length;

  while (i < n) {
    const ch = texto.charCodeAt(i);

    if (ch === 123 /* { */) {
      let prof = 1, j = i + 1;
      while (j < n && prof > 0) {
        const c = texto.charCodeAt(j);
        if (c === 123) prof++;
        else if (c === 125) prof--;
        j++;
      }
      const cuerpo = texto.slice(i + 1, j - 1);
      const sel = texto.slice(inicio, i).trim();
      i = j;
      inicio = j;

      if (!sel) continue;

      if (sel.charAt(0) === '@') {
        const nombre = (sel.match(/^@([a-z-]+)/i) || [])[1] || '';
        if (/^(media|supports|layer|container|scope|document)$/i.test(nombre)) {
          const dentro = revPurgarBloque(cuerpo, usa);
          if (dentro.replace(/\s/g, '')) salida += sel + '{' + dentro + '}';
        } else {
          salida += sel + '{' + cuerpo + '}';        // font-face, keyframes, page, property…
        }
      } else if (revSelectorUsado(sel, usa)) {
        salida += sel + '{' + cuerpo + '}';
      }
      continue;
    }

    if (ch === 59 /* ; */) {
      const pre = texto.slice(inicio, i).trim();
      if (pre.charAt(0) === '@') {
        salida += pre + ';';                           // @import, @charset
        inicio = i + 1;
      }
    }
    i++;
  }
  return salida;
}

/** ¿Alguna de las alternativas del selector puede llegar a coincidir con este documento? */
function revSelectorUsado(selector: string, usa: { clases: Record<string, number>; ids: Record<string, number> }): boolean {
  const partes = String(selector).split(',');
  for (let i = 0; i < partes.length; i++) {
    // Las pseudoclases no aportan nada aquí y sus paréntesis (:not(.x)) enredarían la extracción.
    const parte = partes[i].replace(/::?[a-z-]+(\([^)]*\))?/gi, ' ');
    const clases = (parte.match(/\.(?:\\.|[A-Za-z0-9_-])+/g) || []).map((c) => c.slice(1).replace(/\\(.)/g, '$1'));
    const ids = (parte.match(/#(?:\\.|[A-Za-z0-9_-])+/g) || []).map((c) => c.slice(1).replace(/\\(.)/g, '$1'));

    // Sin clases ni identificadores es un selector de etiqueta, atributo o global: se conserva.
    if (!clases.length && !ids.length) return true;

    let todas = true;
    for (let c = 0; c < clases.length; c++) { if (!usa.clases[clases[c]]) { todas = false; break; } }
    if (todas) for (let d = 0; d < ids.length; d++) { if (!usa.ids[ids[d]]) { todas = false; break; } }
    if (todas) return true;
  }
  return false;
}

/** Clases e identificadores que de verdad aparecen en el documento. */
export function revTokensDelHtml(html: string): { clases: Record<string, number>; ids: Record<string, number> } {
  const usa = { clases: {} as Record<string, number>, ids: {} as Record<string, number> };
  const doc = String(html || '');
  (doc.match(/class="[^"]*"/gi) || []).forEach((a) => {
    a.slice(7, -1).split(/\s+/).forEach((c) => { if (c) usa.clases[c] = 1; });
  });
  (doc.match(/id="[^"]*"/gi) || []).forEach((a) => {
    const v = a.slice(4, -1).trim();
    if (v) usa.ids[v] = 1;
  });
  return usa;
}

/** El documento final que se manda al navegador para incrustarlo con `srcdoc`. */
export function revArmarPaginaIncrustada(partes: { cuerpo: string; enLinea: string }, urlOriginal: string, cssExternos: string[]): string {
  if (!partes || !partes.cuerpo) return '';

  const usa = revTokensDelHtml(partes.cuerpo);
  let css = '';
  (cssExternos || []).forEach((hoja) => {
    const recortada = revPurgarCss(hoja, usa);
    // Si el recorte se lleva casi todo, el análisis se perdió: ante la duda, la hoja entera (pesa más,
    // pero se ve bien, y verse mal es el único fallo que el supervisor no puede compensar).
    css += (recortada.length > hoja.length * 0.02) ? recortada : hoja;
  });

  const base = String(urlOriginal).replace(/^(https:\/\/[^\/]+).*$/, '$1') + '/';

  return '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    // El <base> es para las IMÁGENES y los recursos relativos: esos sí cargan de liverpool.com.mx.
    '<base href="' + base + '">' +
    (css ? '<style>' + css + '</style>' : '') +
    partes.enLinea +
    // Retoque propio: se esconde el andamiaje del sitio (barra, menús, pie, galletas) y se deja el artículo.
    '<style>' +
      'html,body{background:#fff!important;margin:0!important;padding:0!important;overflow-x:hidden!important}' +
      // Las fuentes web del sitio exigen CORS y desde aquí nunca cargan: tipografía del sistema.
      'html,body,*{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif!important}' +
      // Sin su fuente, las ligaduras de Material salen escritas como texto ("chevron_right").
      '[class*="material-icons"],[class*="material-symbols"],[class*="MuiIcon"],' +
      '[class*="Icon-root"]{display:none!important}' +
      'header,footer,[data-testid*="header"],[data-testid*="footer"],' +
      '[id*="onetrust"],[class*="cookie"],[class*="chat"],[id*="chat"],' +
      '[role="banner"],[role="contentinfo"]{display:none!important}' +
      'a{pointer-events:none!important;cursor:default!important;text-decoration:none!important}' +
      // La foto principal ocupa una pantalla entera y deja el precio fuera de la vista: se acota.
      'img{max-width:100%!important;height:auto!important;max-height:320px!important;object-fit:contain!important}' +
      '.__rev-aviso{font:600 13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;' +
        'background:#FDF4E6;color:#7A4A12;border-bottom:1px solid #F0D9B5;padding:10px 16px;' +
        'position:relative;z-index:9}' +
    '</style></head><body>' +
    '<div class="__rev-aviso">Copia de la página de liverpool.com.mx traída por el servidor · ' +
      'los enlaces están desactivados dentro de este recuadro</div>' +
    partes.cuerpo +
    '</body></html>';
}
