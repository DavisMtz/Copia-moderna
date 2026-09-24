/**
 * =================================================================================================
 * AUDITORÍA AUTOMÁTICA DE COTIZACIONES | Sistema de cotizaciones Ventel
 * =================================================================================================
 * POR QUÉ EXISTE
 * La lista de verificación de la pantalla de revisión era una fila de casillas que alguien tenía
 * que ir palomeando. Una casilla que solo se puede marcar "sí" no verifica nada: mide paciencia,
 * no calidad. Todo lo que se puede comprobar con una regla —que el correo exista como dirección,
 * que el asesor venga con nombre y apellido, que el IVA cuadre— lo comprueba este módulo, y el
 * supervisor solo decide sobre lo que de verdad necesita criterio humano.
 *
 * QUÉ ES Y QUÉ NO ES
 *   · SÍ: reglas deterministas, explicables y reproducibles. Cada punto dice qué miró, qué
 *     encontró y —cuando puede— cómo se corrige. El mismo dato da siempre el mismo veredicto.
 *   · NO: un modelo estadístico que "adivina". En una pantalla que autoriza documentos que van al
 *     cliente, un veredicto que no se puede explicar es peor que no tener veredicto.
 *
 * LOS MODELOS QUE USA (y por qué esos)
 *   · Correo → gramática de RFC 5322 recortada a lo que se usa en la práctica + distancia de
 *     DAMERAU-LEVENSHTEIN contra los dominios frecuentes. Es lo que detecta "gmial.com" o
 *     "hotmial.com": una transposición de dos letras que ningún regex ve, porque es un correo
 *     perfectamente válido... que no existe.
 *   · Nombres → normalización Unicode + reglas de capitalización del español con lista de
 *     partículas (de, del, la, y…). Devuelve la forma corregida, no solo el reproche.
 *   · Teléfono → plan de numeración de México (10 dígitos, indicativo que no arranca en 0/1) más
 *     detección de rellenos (5555555555, 1234567890), que es el error de captura real.
 *   · Dinero → comparación con TOLERANCIA (épsilon), nunca con `===`. Los importes vienen de un
 *     texto ya formateado a dos decimales; exigir igualdad exacta daría falsos errores todo el día.
 *   · Descuentos atípicos → PUNTUACIÓN Z MODIFICADA sobre la mediana y la MAD (desviación absoluta
 *     mediana). La media y la desviación estándar no sirven aquí: con 4 artículos, el propio dato
 *     anómalo desplaza la media y se camufla. La mediana no se mueve.
 *   · Descripción contra la ficha del sitio → COEFICIENTE DE DICE sobre bigramas. Tolera acentos,
 *     orden y palabras de más, que es como se escriben las descripciones a mano.
 *
 * DÓNDE VIVE LA VERDAD
 * Este módulo NO lee la hoja ni la red: recibe datos y devuelve un dictamen. Eso lo hace probable
 * fuera de Apps Script (se verifica en un navegador) y permite que la misma función corra al abrir
 * la revisión Y al guardarla, que es lo que impide que el cliente mienta sobre lo que se verificó.
 *
 * CONSUMIDORES: Revision.gs (getRevisionCotizacion, guardarRevisionCotizacion) y
 * revision_cotizacion.html (pinta los puntos). Ninguno depende de que este archivo exista: ambos
 * comprueban con `typeof` y degradan a la lista manual de siempre.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────
// VOCABULARIO
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Estados de un punto de verificación. El orden importa: es el de gravedad creciente y con él
 * se ordena la lista en pantalla (lo que necesita atención sube).
 *
 *   ok        · la regla se cumplió. NO necesita que nadie lo palomee.
 *   pendiente · la comprobación automática está en marcha (precios contra el sitio).
 *   manual    · no se puede automatizar con lo que hay. Pide criterio humano explícito.
 *   atencion  · algo no encaja pero puede ser legítimo (una razón social, un descuento alto).
 *   mal       · la regla se rompió. Aprobar así exige escribir por qué.
 */
const AUD_ESTADOS = ['ok', 'pendiente', 'manual', 'atencion', 'mal'];

/** Peso de cada punto en el índice de confianza. Suman 100. */
const AUD_PESOS = {
  'cliente-nombre': 8,
  'cliente-correo': 14,
  'cliente-telefono': 8,
  'asesor': 8,
  'precios': 22,
  'totales': 22,
  'articulos': 12,
  'vigencia': 6
};

/** Cuánto de su peso pierde un punto según cómo quedó. */
const AUD_CASTIGO = { ok: 0, pendiente: 0.15, manual: 0.35, atencion: 0.55, mal: 1 };

/**
 * Dominios de correo frecuentes entre los clientes. Solo se usan como ANCLA para detectar
 * erratas por cercanía; que un dominio no esté aquí no lo vuelve inválido.
 */
const AUD_DOMINIOS_COMUNES = [
  'gmail.com', 'hotmail.com', 'hotmail.es', 'hotmail.com.mx', 'outlook.com', 'outlook.es',
  'outlook.com.mx', 'yahoo.com', 'yahoo.com.mx', 'yahoo.es', 'live.com', 'live.com.mx',
  'icloud.com', 'me.com', 'msn.com', 'aol.com', 'prodigy.net.mx', 'liverpool.com.mx'
];

/** Correos de usar y tirar: válidos, pero el cliente no volverá a leer ahí. */
const AUD_DOMINIOS_DESECHABLES = [
  'mailinator.com', 'yopmail.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com',
  'trashmail.com', 'sharklasers.com', 'getnada.com', 'maildrop.cc'
];

/** Buzones de área, no de persona. Llegan, pero nadie los contesta. */
const AUD_BUZONES_GENERICOS = [
  'info', 'ventas', 'contacto', 'noreply', 'no-reply', 'admin', 'soporte', 'facturacion',
  'cobranza', 'atencion', 'compras'
];

/** Partículas que en español van en minúscula dentro de un nombre. */
const AUD_PARTICULAS = ['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos', 'van', 'von', 'di'];

/** Palabras que delatan una razón social: cambian el criterio del nombre del cliente. */
const AUD_MARCAS_EMPRESA = [
  'sa', 'sadecv', 'srl', 'sc', 'sapi', 'scv', 'spr', 'ac', 'sofom', 'grupo', 'corporativo',
  'comercializadora', 'distribuidora', 'servicios', 'industrias', 'constructora'
];

/** IVA vigente. Los precios de la cotización SIEMPRE lo llevan incluido. */
const AUD_IVA = 0.16;

// ─────────────────────────────────────────────────────────────────────────────────────────
// UTILIDADES DE TEXTO
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Texto recortado y con los espacios internos colapsados. */
function audLimpiar_(s) {
  return String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim();
}

/** Minúsculas sin acentos ni diacríticos: la forma en que se comparan nombres y dominios. */
function audPlano_(s) {
  let t = String(s == null ? '' : s);
  // normalize existe en el motor V8 de Apps Script; el respaldo cubre el caso de que no.
  // El rango de diacríticos se construye con una CADENA escapada, no con un literal de regex:
  // escritos como caracteres combinantes de verdad, cualquier guardado del archivo en otra
  // codificación los convierte en basura y la función deja de quitar acentos sin avisar.
  try { t = t.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), ''); }
  catch (e) {
    t = t.replace(/[áàäâã]/gi, 'a').replace(/[éèëê]/gi, 'e').replace(/[íìïî]/gi, 'i')
         .replace(/[óòöôõ]/gi, 'o').replace(/[úùüû]/gi, 'u').replace(/ñ/gi, 'n');
  }
  return t.toLowerCase().trim();
}

/**
 * Distancia de Damerau-Levenshtein (con transposición de adyacentes).
 *
 * La transposición es la razón de usar esta y no la Levenshtein clásica: el error de tecleo más
 * común en un dominio es cruzar dos letras ("gmial", "hotmial", "yaoo"). Para Levenshtein eso son
 * dos operaciones y se confunde con un dominio de verdad distinto; aquí es una sola.
 */
function audDistancia_(a, b) {
  const s = String(a || ''), t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const d = [];
  for (let i = 0; i <= s.length; i++) { d[i] = [i]; }
  for (let j = 0; j <= t.length; j++) { d[0][j] = j; }

  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const costo = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 &&
          s.charAt(i - 1) === t.charAt(j - 2) &&
          s.charAt(i - 2) === t.charAt(j - 1)) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[s.length][t.length];
}

/**
 * Coeficiente de Dice sobre bigramas: 0 = nada que ver, 1 = idénticos.
 * Se usa para comparar la descripción cotizada con el título que publica el sitio. Sirve
 * justamente porque NO exige el mismo orden ni las mismas palabras: "Anillo MAP brillante dorado"
 * y "Anillo Map brillante" comparten casi todos sus bigramas.
 */
function audSimilitud_(a, b) {
  const x = audPlano_(a).replace(/[^a-z0-9 ]/g, ''), y = audPlano_(b).replace(/[^a-z0-9 ]/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;

  const bigramas = function (s) {
    const m = {};
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.substr(i, 2);
      m[g] = (m[g] || 0) + 1;
    }
    return m;
  };
  const ma = bigramas(x), mb = bigramas(y);
  let comunes = 0, na = 0, nb = 0;
  Object.keys(ma).forEach(function (g) { na += ma[g]; if (mb[g]) comunes += Math.min(ma[g], mb[g]); });
  Object.keys(mb).forEach(function (g) { nb += mb[g]; });
  return (na + nb) ? (2 * comunes) / (na + nb) : 0;
}

/** Mediana de una lista de números (no la modifica). */
function audMediana_(nums) {
  const v = (nums || []).filter(function (n) { return typeof n === 'number' && isFinite(n); })
                        .slice().sort(function (a, b) { return a - b; });
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Índices de los valores atípicos por PUNTUACIÓN Z MODIFICADA (Iglewicz & Hoaglin).
 *
 *   z_i = 0.6745 · (x_i − mediana) / MAD        se marca cuando |z_i| > umbral (3.5 por convención)
 *
 * Se eligió sobre la z clásica porque la media y la desviación estándar se contaminan con el
 * propio valor raro: con 5 artículos, un descuento del 90 % arrastra la media hasta casi
 * justificarse a sí mismo. La mediana y la MAD no se mueven.
 * Con menos de 4 datos no se evalúa: no hay "normal" contra el que comparar.
 */
function audAtipicos_(nums, umbral) {
  const v = (nums || []).map(function (n) { return Number(n) || 0; });
  if (v.length < 4) return [];
  const med = audMediana_(v);
  const desv = v.map(function (n) { return Math.abs(n - med); });
  const mad = audMediana_(desv);
  const u = umbral || 3.5;

  // MAD 0 = más de la mitad de los valores son idénticos. Entonces "atípico" es simplemente
  // "distinto de todos los demás", y compararlo contra 0 daría infinito para cualquier variación.
  if (mad === 0) {
    return v.map(function (n, i) { return { n: n, i: i }; })
            .filter(function (o) { return Math.abs(o.n - med) > 1e-9; })
            .map(function (o) { return o.i; });
  }
  const fuera = [];
  v.forEach(function (n, i) {
    if (Math.abs(0.6745 * (n - med) / mad) > u) fuera.push(i);
  });
  return fuera;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// CORREO ELECTRÓNICO
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Valida una dirección de correo y, si parece una errata, propone la corrección.
 *
 * No se intenta cumplir el RFC 5322 al pie de la letra: su gramática admite direcciones con
 * comentarios entre paréntesis y comillas que ningún cliente escribe y ningún servidor de correo
 * corporativo acepta. Se valida lo que de verdad circula, que además es lo que Gmail aceptará
 * cuando el sistema intente enviar la cotización.
 *
 * @param {string} correo
 * @return {{estado:string, mensaje:string, sugerencia:string, dominio:string, detalles:string[]}}
 */
function audValidarCorreo_(correo) {
  const bruto = String(correo == null ? '' : correo).trim();
  const r = { estado: 'ok', mensaje: '', sugerencia: '', dominio: '', detalles: [] };

  if (!bruto) {
    r.estado = 'mal';
    r.mensaje = 'La cotización no tiene correo del cliente: no hay a dónde enviarla.';
    return r;
  }
  if (/[\s]/.test(bruto)) {
    r.estado = 'mal';
    r.mensaje = 'El correo tiene espacios en medio.';
    r.sugerencia = bruto.replace(/\s+/g, '');
    return r;
  }
  const partes = bruto.split('@');
  if (partes.length !== 2 || !partes[0] || !partes[1]) {
    r.estado = 'mal';
    r.mensaje = 'No tiene la forma nombre@dominio.';
    return r;
  }

  const local = partes[0];
  const dominio = partes[1].toLowerCase();
  r.dominio = dominio;

  if (local.length > 64) {
    r.estado = 'mal'; r.mensaje = 'La parte anterior a la @ es demasiado larga.'; return r;
  }
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) {
    r.estado = 'mal';
    r.mensaje = 'La parte anterior a la @ tiene caracteres que no se admiten (acentos, ñ o símbolos).';
    // Un acento en el correo casi siempre es el teclado, no la intención del cliente.
    const limpio = audPlano_(local).replace(/[^a-z0-9.!#$%&'*+/=?^_`{|}~-]/g, '');
    if (limpio) r.sugerencia = limpio + '@' + dominio;
    return r;
  }
  if (local.charAt(0) === '.' || local.charAt(local.length - 1) === '.' || local.indexOf('..') > -1) {
    r.estado = 'mal'; r.mensaje = 'La parte anterior a la @ tiene puntos mal colocados.'; return r;
  }

  if (dominio.length > 255 || dominio.indexOf('.') === -1) {
    r.estado = 'mal'; r.mensaje = 'El dominio no es una dirección completa (le falta el .com, .mx…).'; return r;
  }
  const etiquetas = dominio.split('.');
  for (let i = 0; i < etiquetas.length; i++) {
    const e = etiquetas[i];
    if (!e || e.length > 63 || !/^[a-z0-9-]+$/.test(e) ||
        e.charAt(0) === '-' || e.charAt(e.length - 1) === '-') {
      r.estado = 'mal'; r.mensaje = 'El dominio "' + dominio + '" no es válido.'; return r;
    }
  }
  const tld = etiquetas[etiquetas.length - 1];
  if (!/^[a-z]{2,24}$/.test(tld)) {
    r.estado = 'mal'; r.mensaje = 'La terminación del dominio (.' + tld + ') no es válida.'; return r;
  }

  // A partir de aquí la dirección es VÁLIDA. Lo que sigue son avisos, no errores.
  if (AUD_DOMINIOS_DESECHABLES.indexOf(dominio) > -1) {
    r.estado = 'atencion';
    r.mensaje = 'Es un correo temporal (' + dominio + '): el cliente no volverá a leer ahí.';
    return r;
  }
  if (AUD_BUZONES_GENERICOS.indexOf(audPlano_(local)) > -1) {
    r.estado = 'atencion';
    r.mensaje = 'Es un buzón de área ("' + local + '@"), no de una persona. Confirma que ahí lo van a leer.';
    return r;
  }

  if (AUD_DOMINIOS_COMUNES.indexOf(dominio) === -1) {
    let mejor = '', dist = 99;
    AUD_DOMINIOS_COMUNES.forEach(function (d) {
      const x = audDistancia_(dominio, d);
      if (x < dist) { dist = x; mejor = d; }
    });
    // Umbral 1-2 y solo si el dominio tecleado es tan largo como el candidato: sin esa condición,
    // "uas.mx" se "corregiría" a "aol.com" y se estaría inventando un cliente.
    if (dist > 0 && dist <= 2 && Math.abs(dominio.length - mejor.length) <= 2 && dominio.length >= 5) {
      r.estado = 'atencion';
      r.mensaje = '"' + dominio + '" se parece mucho a "' + mejor + '". Si fue una errata, el correo nunca llegará.';
      r.sugerencia = local + '@' + mejor;
      return r;
    }
  }

  r.mensaje = 'Dirección válida' + (AUD_DOMINIOS_COMUNES.indexOf(dominio) > -1 ? ' y de un dominio conocido.' : '.');
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// NOMBRES DE PERSONA
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Capitaliza un nombre como se escribe en español: cada palabra con inicial mayúscula salvo las
 * partículas (que sí se capitalizan si abren el nombre). Respeta los apellidos con apóstrofo
 * (O'Brien) y los compuestos con guion (Pérez-Gómez).
 */
function audCapitalizarNombre_(nombre) {
  const limpio = audLimpiar_(nombre);
  if (!limpio) return '';
  return limpio.split(' ').map(function (palabra, i) {
    const plano = audPlano_(palabra);
    if (i > 0 && AUD_PARTICULAS.indexOf(plano) > -1) return plano;
    // Iniciales tipo "J." se dejan en mayúscula tal cual.
    return palabra.split(/([-'’])/).map(function (trozo) {
      if (trozo.length <= 1 && /[-'’]/.test(trozo)) return trozo;
      if (!trozo) return trozo;
      return trozo.charAt(0).toUpperCase() + trozo.slice(1).toLowerCase();
    }).join('');
  }).join(' ');
}

/** Palabras "de peso" de un nombre: las que no son partículas ni iniciales sueltas. */
function audPalabrasNombre_(nombre) {
  return audLimpiar_(nombre).split(' ').filter(function (p) {
    if (!p) return false;
    if (AUD_PARTICULAS.indexOf(audPlano_(p)) > -1) return false;
    if (/^[A-Za-zÁÉÍÓÚÑáéíóúñ]\.?$/.test(p)) return false;   // inicial suelta
    return true;
  });
}

/**
 * De un nombre completo saca "nombre + apellido", que es como debe salir el asesor en el
 * documento.
 *
 * No es recortar las dos primeras palabras: en México el orden es nombre(s) + apellido paterno +
 * apellido materno, así que de "David Alejandro Martínez López" lo que se firma es "David
 * Martínez", no "David Alejandro". La regla usa la LONGITUD para decidir dónde empieza el
 * apellido, que es la única señal disponible sin un padrón de nombres:
 *   2 palabras → tal cual              3 → primera + segunda (un nombre, dos apellidos)
 *   4 palabras → primera + tercera     5 o más → primera + la penúltima
 * Es una heurística y puede fallar con nombres compuestos raros; por eso se ofrece como
 * SUGERENCIA que el supervisor acepta o no, nunca como una corrección automática.
 */
function audNombreYApellido_(palabras) {
  const p = palabras || [];
  if (p.length <= 2) return audCapitalizarNombre_(p.join(' '));
  if (p.length === 3) return audCapitalizarNombre_(p[0] + ' ' + p[1]);
  if (p.length === 4) return audCapitalizarNombre_(p[0] + ' ' + p[2]);
  return audCapitalizarNombre_(p[0] + ' ' + p[p.length - 2]);
}

/** ¿El texto parece una razón social y no una persona? */
function audPareceEmpresa_(nombre) {
  const plano = audPlano_(nombre).replace(/[.,]/g, '');
  if (/\b(s\s?a\s?de\s?c\s?v|sa de cv|s de rl|sapi|sofom)\b/.test(plano)) return true;
  const palabras = plano.split(' ');
  for (let i = 0; i < palabras.length; i++) {
    if (AUD_MARCAS_EMPRESA.indexOf(palabras[i]) > -1) return true;
  }
  return false;
}

/**
 * Revisa cómo está ESCRITO un nombre de persona.
 *
 * @param {string} nombre
 * @param {{minPalabras:number, maxPalabras:number, quien:string, exigirExacto:boolean}} op
 * @return {{estado:string, mensaje:string, sugerencia:string, palabras:number, empresa:boolean}}
 */
function audValidarNombrePersona_(nombre, op) {
  const o = op || {};
  const quien = o.quien || 'el nombre';
  const bruto = String(nombre == null ? '' : nombre);
  const limpio = audLimpiar_(bruto);
  const r = { estado: 'ok', mensaje: '', sugerencia: '', palabras: 0, empresa: false };

  if (!limpio) {
    r.estado = 'mal';
    r.mensaje = 'Falta ' + quien + '.';
    return r;
  }

  if (/@/.test(limpio)) {
    r.estado = 'mal';
    r.mensaje = 'En ' + quien + ' quedó un correo electrónico, no un nombre.';
    return r;
  }
  if (/[<>|\\\/{}\[\]=]/.test(limpio)) {
    r.estado = 'atencion';
    r.mensaje = quien.charAt(0).toUpperCase() + quien.slice(1) + ' tiene símbolos que no van en un nombre.';
    r.sugerencia = audCapitalizarNombre_(limpio.replace(/[<>|\\\/{}\[\]=]/g, ' '));
    return r;
  }

  r.empresa = audPareceEmpresa_(limpio);
  const palabras = audPalabrasNombre_(limpio);
  r.palabras = palabras.length;

  const corregido = audCapitalizarNombre_(limpio);
  const problemas = [];

  if (bruto !== limpio) problemas.push('espacios de más');

  // Las reglas de escritura son para NOMBRES DE PERSONA. Una razón social usa siglas, números
  // y mayúsculas con todo derecho ("Grupo ACME SA de CV"): corregirla sería el error.
  if (!r.empresa) {
    if (limpio === limpio.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{2,}/.test(limpio)) problemas.push('está TODO EN MAYÚSCULAS');
    else if (limpio === limpio.toLowerCase() && /[a-záéíóúñ]/.test(limpio)) problemas.push('está todo en minúsculas');
    else if (corregido !== limpio) problemas.push('hay palabras sin la inicial mayúscula');
    if (/\d/.test(limpio)) problemas.push('tiene números');
  }

  // El número de palabras es una regla distinta según de quién sea el nombre.
  if (!r.empresa) {
    if (o.exigirExacto && palabras.length !== o.maxPalabras) {
      r.estado = 'atencion';
      r.mensaje = palabras.length < o.maxPalabras
        ? quien.charAt(0).toUpperCase() + quien.slice(1) + ' viene con una sola palabra: debe llevar nombre y apellido.'
        : quien.charAt(0).toUpperCase() + quien.slice(1) + ' trae ' + palabras.length +
          ' palabras; en el documento debe salir solo nombre y apellido.';
      if (palabras.length > o.maxPalabras) r.sugerencia = audNombreYApellido_(palabras);
      return r;
    }
    if (!o.exigirExacto && palabras.length < (o.minPalabras || 2)) {
      r.estado = 'atencion';
      r.mensaje = quien.charAt(0).toUpperCase() + quien.slice(1) +
        ' solo trae una palabra. Un documento formal lleva al menos nombre y apellido.';
      if (corregido !== limpio) r.sugerencia = corregido;
      return r;
    }
    if (o.maxPalabras && palabras.length > o.maxPalabras) {
      problemas.push('trae ' + palabras.length + ' palabras');
    }
  }

  if (problemas.length) {
    r.estado = 'atencion';
    r.mensaje = quien.charAt(0).toUpperCase() + quien.slice(1) + ': ' + problemas.join(', ') + '.';
    if (corregido !== limpio) r.sugerencia = corregido;
    return r;
  }

  r.mensaje = r.empresa
    ? 'Parece una razón social; se aceptó tal cual está escrita.'
    : 'Bien escrito: ' + palabras.length + ' palabras, capitalización correcta.';
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// TELÉFONO
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Valida un teléfono mexicano de 10 dígitos y lo devuelve formateado.
 *
 * Desde 2019 México usa 10 dígitos sin el 1 ni el 01 delante; los indicativos de área no empiezan
 * en 0 ni en 1. Lo que más aparece en una captura apurada no es un número inválido, sino un
 * relleno (5555555555) o una secuencia (1234567890): esos se detectan aparte porque son
 * formalmente correctos y no llevan a ninguna parte.
 */
function audValidarTelefonoMx_(tel) {
  const bruto = String(tel == null ? '' : tel).trim();
  const r = { estado: 'ok', mensaje: '', sugerencia: '', digitos: '' };

  if (!bruto) {
    r.estado = 'atencion';
    r.mensaje = 'No hay teléfono del cliente. Sin él no hay forma de aclarar dudas de la cotización.';
    return r;
  }

  let d = bruto.replace(/\D/g, '');
  if (d.length === 13 && d.indexOf('521') === 0) d = d.slice(3);        // +52 1 (móvil antiguo)
  else if (d.length === 12 && d.indexOf('52') === 0) d = d.slice(2);    // +52
  else if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);      // 1 + 10
  r.digitos = d;

  if (d.length !== 10) {
    r.estado = 'mal';
    r.mensaje = 'El teléfono tiene ' + d.length + ' dígito(s); en México son 10.';
    return r;
  }
  if (d.charAt(0) === '0' || d.charAt(0) === '1') {
    r.estado = 'mal';
    r.mensaje = 'Ningún indicativo de área en México empieza en ' + d.charAt(0) + '.';
    return r;
  }
  if (/^(\d)\1{9}$/.test(d)) {
    r.estado = 'mal';
    r.mensaje = 'El teléfono son diez veces el mismo dígito: es un relleno, no un número.';
    return r;
  }
  if ('0123456789012345678'.indexOf(d) > -1 || '9876543210987654321'.indexOf(d) > -1) {
    r.estado = 'mal';
    r.mensaje = 'El teléfono es una secuencia seguida de dígitos: es un relleno.';
    return r;
  }

  // Formato local: 2 dígitos de indicativo en las tres grandes zonas metropolitanas, 3 en el resto.
  const lada2 = ['55', '56', '33', '81'];
  r.sugerencia = (lada2.indexOf(d.substr(0, 2)) > -1)
    ? d.substr(0, 2) + ' ' + d.substr(2, 4) + ' ' + d.substr(6, 4)
    : d.substr(0, 3) + ' ' + d.substr(3, 3) + ' ' + d.substr(6, 4);
  r.mensaje = '10 dígitos con indicativo válido (' + r.sugerencia + ').';
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// DINERO
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Total de una línea con sus promociones.
 *
 * Es EXACTAMENTE la misma fórmula que usan `cotizacion.html` al capturar, `consulta_cotizacion`
 * al pintar el documento y `calcularLinea` en la pantalla de revisión. Si aquí se calculara
 * distinto, la auditoría estaría avalando un número que el cliente nunca verá.
 * OJO: el precio ya trae el IVA incluido; el subtotal se obtiene dividiendo, no multiplicando.
 */
function audCalcularLinea_(p) {
  const unitario = parseFloat(p.unitPrice) || 0;
  const cantidad = parseInt(p.quantity, 10) || 0;
  const volumen = unitario * cantidad;
  const pagoUnico = parseFloat(p.costPaymentUnique) || 0;
  const descPublico = parseFloat(p.discountPublicPercent) || 0;
  const adicional = p.additionalDiscountApplied === 'Si';
  const descAdicional = parseFloat(p.additionalDiscountPercent) || 0;

  let total;
  if (pagoUnico > 0 && cantidad > 0 && unitario > 0) {
    total = pagoUnico;
  } else {
    const base = Math.max(0, volumen * (1 - descPublico / 100));
    total = (adicional && descAdicional > 0) ? base * (1 - descAdicional / 100) : base;
    total = Math.max(0, total);
  }

  const ahorro = volumen - total;
  return {
    cantidad: cantidad,
    unitario: unitario,
    volumen: volumen,
    total: total,
    unitarioPromo: cantidad > 0 ? total / cantidad : total,
    ahorro: ahorro,
    porcentaje: volumen > 0 ? (ahorro / volumen) * 100 : 0,
    descPublico: descPublico,
    descAdicional: adicional ? descAdicional : 0
  };
}

/** Redondeo a dos decimales sin los sustos del punto flotante. */
function audCentavos_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Comprueba que subtotal, IVA y total cuadren entre sí y con las líneas.
 *
 * La tolerancia no es un capricho: los tres importes se guardaron leyendo un texto ya formateado
 * a dos decimales (`parseCurrency` sobre lo que se veía en pantalla), así que cada línea puede
 * llevar hasta medio centavo de redondeo. Exigir igualdad exacta marcaría en rojo cotizaciones
 * perfectas todos los días, y una alarma que suena siempre deja de mirarse.
 */
function audValidarTotales_(quote, productos) {
  const q = quote || {};
  const lista = productos || [];
  const r = { estado: 'ok', mensaje: '', filas: [], diferencias: [] };

  const sumaLineas = audCentavos_(lista.reduce(function (acc, p) {
    return acc + audCalcularLinea_(p).total;
  }, 0));

  const subtotal = audCentavos_(q.summarySubtotal);
  const iva = audCentavos_(q.summaryVat);
  const total = audCentavos_(q.summaryTotal);

  // Media centésima por línea + un colchón fijo. Con 40 artículos son 22 centavos: sigue siendo
  // imposible que un error de captura real se cuele por ahí.
  const tol = Math.max(0.05, lista.length * 0.005 + 0.02);

  const esperadoSubtotal = audCentavos_(sumaLineas / (1 + AUD_IVA));
  const esperadoIva = audCentavos_(sumaLineas - esperadoSubtotal);

  const revisa = function (etiqueta, valor, esperado, nota) {
    const dif = audCentavos_(valor - esperado);
    r.filas.push({ etiqueta: etiqueta, valor: valor, esperado: esperado, diferencia: dif, ok: Math.abs(dif) <= tol });
    if (Math.abs(dif) > tol) r.diferencias.push(etiqueta + ': ' + (nota || '') + ' difiere en ' + dif.toFixed(2));
  };

  if (!lista.length) {
    r.estado = 'mal';
    r.mensaje = 'La cotización no tiene artículos, así que no hay nada que sume los totales.';
    return r;
  }

  revisa('Total contra la suma de las líneas', total, sumaLineas, 'lo que suman los artículos');
  revisa('Subtotal (total ÷ 1.16)', subtotal, esperadoSubtotal, 'la base sin IVA');
  revisa('IVA (16 %)', iva, esperadoIva, 'el impuesto');
  revisa('Subtotal + IVA', audCentavos_(subtotal + iva), total, 'la suma de base e impuesto');

  if (total <= 0) {
    r.estado = 'mal';
    r.mensaje = 'El total de la cotización es cero. Nada de esto se puede enviar al cliente.';
    return r;
  }
  if (r.diferencias.length) {
    r.estado = 'mal';
    r.mensaje = 'Los importes no cuadran: ' + r.diferencias.join(' · ') + '.';
    return r;
  }

  r.mensaje = 'Las ' + lista.length + ' líneas suman ' + total.toFixed(2) +
    ', el IVA del 16 % da ' + iva.toFixed(2) + ' y la base ' + subtotal.toFixed(2) + '. Todo cuadra al centavo.';
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// ARTÍCULOS
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Revisa la consistencia interna de las líneas: repetidos, cantidades, descuentos imposibles y
 * descuentos que se salen del patrón del resto de la cotización.
 */
function audValidarArticulos_(productos) {
  const lista = productos || [];
  const r = { estado: 'ok', mensaje: '', hallazgos: [], porArticulo: [] };

  if (!lista.length) {
    r.estado = 'mal';
    r.mensaje = 'La cotización se guardó sin artículos.';
    return r;
  }

  const vistos = {};
  const descuentos = [];

  lista.forEach(function (p, i) {
    const c = audCalcularLinea_(p);
    const avisos = [];
    const sku = String(p.sku || '').trim();
    const desc = String(p.description || '').trim();

    if (!sku) avisos.push('sin SKU');
    else if (!/^[0-9]{6,14}$/.test(sku)) avisos.push('el SKU "' + sku + '" no tiene la forma de un código de Liverpool');

    if (sku) {
      if (vistos[sku] != null) {
        avisos.push('SKU repetido (ya está en la línea ' + (vistos[sku] + 1) + ')');
      } else {
        vistos[sku] = i;
      }
    }

    if (!desc) avisos.push('sin descripción');
    else if (desc.length < 5) avisos.push('descripción demasiado corta ("' + desc + '")');

    if (c.cantidad <= 0) avisos.push('cantidad en cero');
    else if (c.cantidad > 999) avisos.push('cantidad de ' + c.cantidad + ' piezas');

    if (c.unitario <= 0) avisos.push('precio unitario en cero');
    if (c.total <= 0) avisos.push('la línea completa suma cero');

    if (c.descPublico < 0 || c.descPublico > 100) avisos.push('descuento público fuera del rango 0-100 %');
    if (c.descAdicional < 0 || c.descAdicional > 100) avisos.push('descuento adicional fuera del rango 0-100 %');
    if (c.porcentaje > 90) avisos.push('descuento total del ' + c.porcentaje.toFixed(1) + ' %');

    descuentos.push(c.porcentaje);
    r.porArticulo.push({ indice: i, sku: sku, descripcion: desc, avisos: avisos, descuento: c.porcentaje });
    avisos.forEach(function (a) { r.hallazgos.push('Artículo ' + (i + 1) + ': ' + a); });
  });

  // Descuentos que se salen del patrón. No es un error por sí mismo —una promoción puntual es
  // legítima— pero es justo lo que hay que mirar dos veces antes de firmar.
  audAtipicos_(descuentos).forEach(function (i) {
    const p = r.porArticulo[i];
    if (!p) return;
    // Solo se avisa si además es un descuento con peso; una diferencia de medio punto no importa.
    if (Math.abs(p.descuento - audMediana_(descuentos)) < 5) return;
    p.atipico = true;
    r.hallazgos.push('Artículo ' + (i + 1) + ': su descuento (' + p.descuento.toFixed(1) +
      ' %) se sale del patrón del resto de la cotización.');
  });

  // Un SKU repetido o una línea en cero es un error; lo demás es "míralo".
  const grave = r.hallazgos.some(function (h) {
    return /repetido|en cero|suma cero|sin SKU|fuera del rango/.test(h);
  });

  if (r.hallazgos.length) {
    r.estado = grave ? 'mal' : 'atencion';
    r.mensaje = r.hallazgos.length + ' cosa(s) que revisar en los artículos.';
    return r;
  }

  r.mensaje = lista.length + ' artículo(s) con SKU único, cantidades y descuentos dentro de lo normal.';
  return r;
}

/**
 * Separa lo que entró por la extensión de Chrome de lo que se tecleó a mano.
 *
 * La distinción manda en la verificación de precios: un artículo importado trae el enlace de su
 * página, así que el sistema puede ir a leer el precio publicado y compararlo solo. Uno capturado
 * a mano no tiene contra qué compararse —no hay enlace— y ahí la única verificación posible es
 * que una persona lo mire en el sitio. Por eso uno se marca automáticamente y el otro no.
 */
function audOrigenDatos_(productos) {
  const lista = productos || [];
  const importados = [], manuales = [];
  lista.forEach(function (p, i) {
    const url = String(p.productUrl || '').trim();
    if (url) importados.push(i); else manuales.push(i);
  });
  return {
    total: lista.length,
    importados: importados,
    manuales: manuales,
    todosImportados: lista.length > 0 && manuales.length === 0,
    ningunoImportado: importados.length === 0
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// EL DICTAMEN COMPLETO
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Arma un punto de la lista con la forma que espera la pantalla (y la hoja). */
function audPunto_(id, texto, estado, detalle, extra) {
  const p = {
    id: id,
    texto: texto,                                  // la frase de siempre, la que se escribe en la hoja
    estado: estado,                                // ok | pendiente | manual | atencion | mal
    detalle: detalle || '',                        // qué se miró y qué se encontró
    auto: estado !== 'manual',                     // ¿lo resolvió el sistema?
    peso: AUD_PESOS[id] || 5,
    sugerencia: '',
    evidencia: []
  };
  if (extra) {
    Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
  }
  return p;
}

/**
 * Audita una cotización completa y devuelve los puntos de verificación ya resueltos.
 *
 * @param {object} quote      Cabecera de la cotización (la que devuelve getQuoteDetails).
 * @param {object[]} productos Líneas, con productUrl si vinieron de la extensión.
 * @param {{ahora:Date}} [opciones]
 * @return {{puntos:object[], score:number, resumen:string, criticas:string[],
 *           automaticos:number, pendientes:number}}
 */
function audAuditar_(quote, productos, opciones) {
  const q = quote || {};
  const lista = productos || [];
  const op = opciones || {};
  const ahora = op.ahora instanceof Date ? op.ahora : new Date();
  const puntos = [];

  // 1 · Nombre del cliente ---------------------------------------------------------------
  const nom = audValidarNombrePersona_(q.clientName, { quien: 'el nombre del cliente', minPalabras: 2, maxPalabras: 6 });
  puntos.push(audPunto_('cliente-nombre',
    'El nombre del cliente está escrito correctamente',
    nom.estado, nom.mensaje,
    { sugerencia: nom.sugerencia, evidencia: [{ etiqueta: 'En la cotización', valor: String(q.clientName || '(vacío)') }] }));

  // 2 · Correo del cliente ---------------------------------------------------------------
  const cor = audValidarCorreo_(q.clientEmail);
  puntos.push(audPunto_('cliente-correo',
    'El correo del cliente es una dirección válida',
    cor.estado, cor.mensaje,
    { sugerencia: cor.sugerencia, evidencia: [{ etiqueta: 'En la cotización', valor: String(q.clientEmail || '(vacío)') }] }));

  // 3 · Teléfono del cliente -------------------------------------------------------------
  const tel = audValidarTelefonoMx_(q.clientPhone);
  puntos.push(audPunto_('cliente-telefono',
    'El teléfono del cliente tiene 10 dígitos válidos',
    tel.estado, tel.mensaje,
    { evidencia: [{ etiqueta: 'En la cotización', valor: String(q.clientPhone || '(vacío)') }] }));

  // 4 · Asesor ---------------------------------------------------------------------------
  // La regla del negocio: en el documento el asesor sale con NOMBRE y APELLIDO. Ni la firma
  // completa del acta de nacimiento ni solo el nombre de pila.
  // La extensión telefónica salió del sistema (ya no se usa), así que aquí ya no se
  // revisa. Si no se quitara, TODA cotización nueva saldría marcada con "no trae
  // extensión" —un defecto que nadie puede corregir porque el campo ya no existe—, y
  // una auditoría que siempre se queja de lo mismo deja de leerse.
  const ase = audValidarNombrePersona_(q.advisorName, {
    quien: 'el nombre del asesor', maxPalabras: 2, exigirExacto: true
  });
  puntos.push(audPunto_('asesor',
    'El asesor aparece con nombre y apellido',
    ase.estado, ase.mensaje,
    { sugerencia: ase.sugerencia,
      evidencia: [
        { etiqueta: 'Asesor', valor: String(q.advisorName || '(vacío)') },
        { etiqueta: 'Correo', valor: String(q.advisorEmail || '(vacío)') }
      ] }));

  // 5 · Precios contra el sitio ----------------------------------------------------------
  const origen = audOrigenDatos_(lista);
  const puntoPrecios = audPunto_('precios',
    'Precios, promociones y descuentos coinciden con el sitio',
    'pendiente', '', { origen: origen });
  audResolverPrecios_(puntoPrecios, origen, null);
  puntos.push(puntoPrecios);

  // 6 · Totales --------------------------------------------------------------------------
  const tot = audValidarTotales_(q, lista);
  puntos.push(audPunto_('totales',
    'Subtotal, IVA y total general cuadran',
    tot.estado, tot.mensaje,
    { evidencia: tot.filas.map(function (f) {
        return { etiqueta: f.etiqueta, valor: f.valor.toFixed(2) + (f.ok ? '' : ' (se esperaba ' + f.esperado.toFixed(2) + ')'), ok: f.ok };
      }) }));

  // 7 · Consistencia de los artículos ----------------------------------------------------
  const art = audValidarArticulos_(lista);
  puntos.push(audPunto_('articulos',
    'Los artículos no repiten SKU y sus cantidades y descuentos son razonables',
    art.estado, art.mensaje,
    { evidencia: art.hallazgos.slice(0, 12).map(function (h) { return { etiqueta: '', valor: h }; }),
      porArticulo: art.porArticulo }));

  // 8 · Vigencia -------------------------------------------------------------------------
  const vig = audValidarVigencia_(q.timestamp, ahora);
  puntos.push(audPunto_('vigencia',
    'La cotización es reciente y sus precios siguen vigentes',
    vig.estado, vig.mensaje, { dias: vig.dias }));

  return audResumir_(puntos);
}

/** Antigüedad de la cotización: los precios de Liverpool cambian de un día para otro. */
function audValidarVigencia_(timestamp, ahora) {
  const r = { estado: 'ok', mensaje: '', dias: null };
  let fecha = null;
  try { fecha = timestamp ? new Date(timestamp) : null; } catch (e) { fecha = null; }
  if (!fecha || isNaN(fecha.getTime())) {
    r.estado = 'manual';
    r.mensaje = 'La cotización no tiene fecha legible: comprueba a mano que no sea vieja.';
    return r;
  }
  const dias = Math.floor((ahora.getTime() - fecha.getTime()) / 86400000);
  r.dias = dias;
  if (dias < 0) {
    r.estado = 'atencion';
    r.mensaje = 'La fecha de la cotización está en el futuro (' + fecha.toISOString().slice(0, 10) + ').';
    return r;
  }
  if (dias <= 3) {
    r.mensaje = dias === 0 ? 'Se creó hoy.' : 'Se creó hace ' + dias + ' día(s).';
    return r;
  }
  r.estado = 'atencion';
  r.mensaje = 'Se creó hace ' + dias + ' días. Las promociones de Liverpool cambian cada semana: ' +
              'vuelve a comprobar los precios antes de aprobarla.';
  return r;
}

/**
 * Decide en qué queda el punto de "precios" según de dónde salieron los datos y —si ya se
 * consultó el sitio— qué dijo la consulta.
 *
 * Se aisló en su propia función porque se llama DOS veces: al abrir la revisión (cuando todavía
 * no se ha consultado nada) y otra vez cuando vuelven los precios en vivo. Tener una sola
 * función es lo que garantiza que el texto que ve el supervisor y el que se escribe en la hoja
 * digan lo mismo.
 *
 * @param {object} punto Punto a modificar en el sitio.
 * @param {object} origen Resultado de audOrigenDatos_.
 * @param {?object[]} verificaciones [{indice, estado:'coincide'|'difiere'|'sin-dato', ...}]
 */
function audResolverPrecios_(punto, origen, verificaciones) {
  const o = origen || { total: 0, importados: [], manuales: [], todosImportados: false };

  if (!o.total) {
    punto.estado = 'mal';
    punto.detalle = 'No hay artículos cuyos precios comparar.';
    return punto;
  }

  if (!verificaciones) {
    if (o.ningunoImportado) {
      punto.estado = 'manual';
      punto.detalle = 'Los ' + o.total + ' artículos se capturaron a mano (no traen enlace a su página), ' +
        'así que el sistema no puede compararlos solo. Ábrelos en el sitio y confírmalo tú.';
      punto.auto = false;
      return punto;
    }
    punto.estado = 'pendiente';
    punto.detalle = 'Consultando liverpool.com.mx para ' + o.importados.length + ' de ' + o.total + ' artículo(s)…';
    return punto;
  }

  const coinciden = verificaciones.filter(function (v) { return v.estado === 'coincide'; });
  const difieren  = verificaciones.filter(function (v) { return v.estado === 'difiere'; });
  const sinDato   = verificaciones.filter(function (v) { return v.estado === 'sin-dato'; });
  const manuales  = o.manuales.length;

  punto.verificaciones = verificaciones;

  if (difieren.length) {
    punto.estado = 'mal';
    punto.detalle = difieren.length + ' artículo(s) tienen en la cotización un precio distinto del que ' +
      'publica el sitio ahora mismo. Revísalos antes de aprobar.';
    return punto;
  }
  if (manuales || sinDato.length) {
    punto.estado = 'manual';
    punto.auto = false;
    const trozos = [];
    if (coinciden.length) trozos.push(coinciden.length + ' artículo(s) verificados contra el sitio y correctos');
    if (manuales) trozos.push(manuales + ' capturado(s) a mano, sin enlace que consultar');
    if (sinDato.length) trozos.push(sinDato.length + ' que el sitio no dejó leer');
    punto.detalle = trozos.join('; ') + '. Confirma tú los que faltan.';
    return punto;
  }

  punto.estado = 'ok';
  punto.auto = true;
  punto.detalle = 'Los ' + coinciden.length + ' artículos se compararon con liverpool.com.mx y el precio ' +
    'unitario cuadra en todos.';
  return punto;
}

/**
 * Rehace el punto de precios de un dictamen ya calculado con los resultados de la consulta en
 * vivo, y vuelve a puntuar. Lo usan la pantalla (al terminar la consulta) y el servidor
 * (al guardar), para que ambos lleguen al mismo número.
 */
function audAplicarPreciosEnVivo_(auditoria, verificaciones) {
  if (!auditoria || !auditoria.puntos) return auditoria;
  auditoria.puntos.forEach(function (p) {
    if (p.id !== 'precios') return;
    audResolverPrecios_(p, p.origen, verificaciones || []);
  });
  return audResumir_(auditoria.puntos);
}

/**
 * Índice de confianza + resumen. Es un ORDENADOR DE ATENCIÓN, no una nota: dice por dónde
 * empezar a mirar, nunca sustituye la decisión de aprobar (esa la firma una persona).
 */
function audResumir_(puntos) {
  let penalizacion = 0, pesoTotal = 0;
  const criticas = [];
  let automaticos = 0, pendientes = 0, porRevisar = 0;

  puntos.forEach(function (p) {
    const peso = p.peso || 5;
    pesoTotal += peso;
    penalizacion += peso * (AUD_CASTIGO[p.estado] == null ? 0.5 : AUD_CASTIGO[p.estado]);
    if (p.estado === 'ok') automaticos++;
    else if (p.estado === 'pendiente') pendientes++;
    else porRevisar++;
    if (p.estado === 'mal') criticas.push(p.texto + ' → ' + p.detalle);
  });

  const score = pesoTotal ? Math.max(0, Math.min(100, Math.round(100 - (penalizacion / pesoTotal) * 100))) : 0;

  let resumen;
  if (criticas.length) {
    resumen = criticas.length + ' comprobación(es) fallaron. Aprobar así exige que expliques por qué.';
  } else if (porRevisar) {
    resumen = automaticos + ' de ' + puntos.length + ' puntos quedaron verificados solos; ' +
              porRevisar + ' necesitan tu criterio.';
  } else if (pendientes) {
    resumen = 'Verificación automática en curso…';
  } else {
    resumen = 'Los ' + puntos.length + ' puntos se verificaron automáticamente. Nada quedó pendiente.';
  }

  return {
    puntos: puntos,
    score: score,
    resumen: resumen,
    criticas: criticas,
    automaticos: automaticos,
    pendientes: pendientes,
    porRevisar: porRevisar
  };
}

/**
 * Compara UNA línea de la cotización con la ficha que devolvió el sitio.
 * Se usa en el lote de verificación de precios (Revision.gs) y en el comparador de la pantalla.
 *
 * @param {object} producto Línea de la cotización.
 * @param {object} ficha    Resultado de revFichaArticulo.
 * @return {{estado:string, titulo:string, mensaje:string, diferencia:number, similitud:number}}
 */
function audCompararConFicha_(producto, ficha) {
  const c = audCalcularLinea_(producto || {});
  const f = ficha || {};

  if (!f.ok || typeof f.precio !== 'number') {
    return {
      estado: 'sin-dato',
      titulo: 'No se pudo leer el sitio',
      mensaje: f.mensaje || 'La página del artículo no se pudo consultar automáticamente.',
      diferencia: 0,
      similitud: 0
    };
  }

  const dif = audCentavos_(c.unitarioPromo - f.precio);
  const abs = Math.abs(dif);
  const similitud = audSimilitud_(producto.description, f.titulo);

  // Medio peso por pieza es el umbral con el que se trabaja en piso de venta: por debajo es
  // redondeo del propio sitio, no un error de la cotización.
  if (abs > 0.5) {
    return {
      estado: 'difiere',
      titulo: dif > 0 ? 'Cotizado por arriba del sitio' : 'Cotizado por debajo del sitio',
      mensaje: 'Diferencia de ' + abs.toFixed(2) + ' por pieza (' + (abs * c.cantidad).toFixed(2) +
               ' en la línea). Cotizado ' + c.unitarioPromo.toFixed(2) + ' · sitio ' + f.precio.toFixed(2) + '.',
      diferencia: dif,
      similitud: similitud
    };
  }

  // El precio cuadra, pero si el nombre no se parece en nada puede ser el SKU equivocado:
  // dos artículos distintos con el mismo precio es más común de lo que parece.
  if (similitud < 0.34 && String(f.titulo || '').length > 3) {
    return {
      estado: 'difiere',
      titulo: 'El precio cuadra, pero el artículo no parece el mismo',
      mensaje: 'La cotización dice "' + String(producto.description || '') + '" y el sitio "' + f.titulo +
               '". Comprueba que el SKU sea el correcto.',
      diferencia: dif,
      similitud: similitud
    };
  }

  return {
    estado: 'coincide',
    titulo: 'El precio cuadra',
    mensaje: 'Cotizado ' + c.unitarioPromo.toFixed(2) + ' y el sitio publica ' + f.precio.toFixed(2) + '.',
    diferencia: dif,
    similitud: similitud
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// DIAGNÓSTICO
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Casos de prueba que se ejecutan desde el editor de Apps Script. No sustituyen a la
 * verificación en navegador, pero sí contestan en diez segundos a "¿el motor sigue vivo tras
 * tocarle algo?". Devuelve el mismo texto que escribe en el Logger.
 */
function audDiagnostico() {
  secSoloInterno_('audDiagnostico');
  const lineas = [];
  let fallos = 0;
  const comprueba = function (descripcion, obtenido, esperado) {
    const ok = String(obtenido) === String(esperado);
    if (!ok) fallos++;
    lineas.push((ok ? '✔ ' : '✖ ') + descripcion +
      (ok ? '' : '  → esperado "' + esperado + '", obtenido "' + obtenido + '"'));
  };

  // Correo
  comprueba('Correo bueno', audValidarCorreo_('juan.perez@gmail.com').estado, 'ok');
  comprueba('Correo sin arroba', audValidarCorreo_('juanperez.gmail.com').estado, 'mal');
  comprueba('Correo vacío', audValidarCorreo_('').estado, 'mal');
  comprueba('Correo con espacio', audValidarCorreo_('juan perez@gmail.com').estado, 'mal');
  comprueba('Dominio con errata detectado', audValidarCorreo_('juan@gmial.com').estado, 'atencion');
  comprueba('Dominio con errata corregido', audValidarCorreo_('juan@gmial.com').sugerencia, 'juan@gmail.com');
  comprueba('Dominio raro pero legítimo', audValidarCorreo_('a.lopez@uaslp.mx').estado, 'ok');
  comprueba('Buzón genérico', audValidarCorreo_('ventas@empresa.com.mx').estado, 'atencion');
  comprueba('Correo temporal', audValidarCorreo_('x@mailinator.com').estado, 'atencion');
  comprueba('TLD inventado', audValidarCorreo_('x@dominio.c').estado, 'mal');

  // Nombres
  comprueba('Asesor con nombre y apellido',
    audValidarNombrePersona_('David Martínez', { quien: 'el asesor', maxPalabras: 2, exigirExacto: true }).estado, 'ok');
  comprueba('Asesor con nombre completo largo',
    audValidarNombrePersona_('David Alejandro Martínez López', { quien: 'el asesor', maxPalabras: 2, exigirExacto: true }).estado, 'atencion');
  comprueba('Asesor recortado a nombre y apellido',
    audValidarNombrePersona_('David Alejandro Martínez López', { quien: 'el asesor', maxPalabras: 2, exigirExacto: true }).sugerencia, 'David Martínez');
  comprueba('Asesor de tres palabras',
    audValidarNombrePersona_('María López Hernández', { quien: 'el asesor', maxPalabras: 2, exigirExacto: true }).sugerencia, 'María López');
  comprueba('Cliente en mayúsculas',
    audValidarNombrePersona_('MARIA LOPEZ', { quien: 'el cliente', minPalabras: 2, maxPalabras: 6 }).estado, 'atencion');
  comprueba('Cliente corregido',
    audValidarNombrePersona_('maria de la luz lópez', { quien: 'el cliente', minPalabras: 2, maxPalabras: 6 }).sugerencia, 'Maria de la Luz López');
  comprueba('Cliente bien escrito',
    audValidarNombrePersona_('María López Hernández', { quien: 'el cliente', minPalabras: 2, maxPalabras: 6 }).estado, 'ok');
  comprueba('Razón social aceptada',
    audValidarNombrePersona_('Grupo Industrial ACME SA de CV', { quien: 'el cliente', minPalabras: 2, maxPalabras: 6 }).estado, 'ok');

  // Teléfono
  comprueba('Teléfono bueno', audValidarTelefonoMx_('5512345678').estado, 'ok');
  comprueba('Teléfono con +52', audValidarTelefonoMx_('+52 55 1234 5678').estado, 'ok');
  comprueba('Teléfono corto', audValidarTelefonoMx_('55123456').estado, 'mal');
  comprueba('Teléfono de relleno', audValidarTelefonoMx_('5555555555').estado, 'mal');
  comprueba('Teléfono en secuencia', audValidarTelefonoMx_('1234567890').estado, 'mal');

  // Dinero
  const prods = [
    { sku: '1182166315', description: 'Anillo Map brillante', quantity: 2, unitPrice: 399, discountPublicPercent: 30, additionalDiscountApplied: 'No', additionalDiscountPercent: 0, productUrl: 'https://www.liverpool.com.mx/tienda/pdp/x/1' },
    { sku: '1182166316', description: 'Collar Map', quantity: 1, unitPrice: 1000, discountPublicPercent: 0, additionalDiscountApplied: 'No', additionalDiscountPercent: 0, productUrl: 'https://www.liverpool.com.mx/tienda/pdp/y/2' }
  ];
  const totalEsperado = 399 * 2 * 0.7 + 1000;
  const q = {
    clientName: 'María López', clientEmail: 'maria@gmail.com', clientPhone: '5512345678',
    advisorName: 'David Martínez', advisorEmail: 'd@liverpool.com.mx', advisorExt: '1234',
    summaryTotal: totalEsperado,
    summarySubtotal: Math.round((totalEsperado / 1.16) * 100) / 100,
    summaryVat: Math.round((totalEsperado - totalEsperado / 1.16) * 100) / 100,
    timestamp: new Date().toISOString()
  };
  comprueba('Totales que cuadran', audValidarTotales_(q, prods).estado, 'ok');
  const qMal = JSON.parse(JSON.stringify(q));
  qMal.summaryTotal = totalEsperado + 100;
  comprueba('Totales que no cuadran', audValidarTotales_(qMal, prods).estado, 'mal');

  // Artículos
  comprueba('Artículos sanos', audValidarArticulos_(prods).estado, 'ok');
  const dup = prods.concat([{ sku: '1182166315', description: 'Anillo Map brillante', quantity: 1, unitPrice: 399 }]);
  comprueba('SKU repetido', audValidarArticulos_(dup).estado, 'mal');

  // Atípicos
  comprueba('Descuento atípico detectado', audAtipicos_([10, 10.5, 11, 10.2, 85]).join(','), '4');
  comprueba('Sin atípicos', audAtipicos_([10, 10.5, 11, 10.2]).length, 0);

  // Similitud
  comprueba('Similitud alta', audSimilitud_('Anillo MAP brillante dorado', 'Anillo Map brillante') > 0.6, true);
  comprueba('Similitud baja', audSimilitud_('Licuadora Oster 10 velocidades', 'Anillo Map brillante') < 0.3, true);

  // Dictamen completo
  const dictamen = audAuditar_(q, prods);
  comprueba('El dictamen trae 8 puntos', dictamen.puntos.length, 8);
  comprueba('Ya no existe el punto de formato',
    dictamen.puntos.filter(function (p) { return p.id === 'formato'; }).length, 0);
  comprueba('Índice de confianza alto en una cotización sana', dictamen.score >= 80, true);

  const reporte = 'AUDITORÍA AUTOMÁTICA — diagnóstico (' +
    (lineas.length - fallos) + '/' + lineas.length + ')\n' + lineas.join('\n');
  Logger.log(reporte);
  return reporte;
}
