/**
 * CUENTAS: VERIFICACIÓN POR CÓDIGO Y RECUPERACIÓN DE CONTRASEÑA | Portal Ventel en Cloudflare
 * ==========================================================================================
 * Port de Cuentas.gs. Dos flujos, un solo mecanismo: un código temporal de 6 dígitos enviado al
 * correo.
 *
 *   ALTA (registro)         solicitarCodigoRegistro → [correo con código] → confirmarCodigoRegistro
 *                           La cuenta NO se crea hasta que el código se confirma.
 *
 *   RECUPERACIÓN            solicitarCodigoRecuperacion → confirmarCodigoRecuperacion (devuelve un
 *                           vale de un solo uso) → restablecerContrasena (con ese vale).
 *
 *   PRIMERA CONTRASEÑA      loginUser detecta una temporal y emite un vale (emitirValeInicial) →
 *                           establecerPasswordInicial (con ese vale) cambia la contraseña y abre sesión.
 *
 * DÓNDE VIVEN LOS CÓDIGOS
 * Igual que en Apps Script: en las propiedades del script (tabla `propiedades`), con el prefijo
 * cta_ y la HUELLA del correo en la clave, guardando el HASH del código y nunca el código en claro.
 * Se quedó ahí a propósito (y no en una tabla nueva): la revisión de salud de la consola cuenta los
 * códigos vivos por ese prefijo (Admin.gs), y así sigue funcionando sin coordinar nada.
 *
 * FRENOS (todos del lado del servidor)
 *   · 60 s entre envíos al mismo correo, y como máximo 5 códigos por hora.
 *   · 5 intentos por código; al agotarlos el código muere y hay que pedir otro.
 *   · El código caduca a los 10 minutos; el vale de cambio de contraseña, a los 15.
 *   · Comparación en tiempo constante (secComparacionSegura), como en el login.
 * Diferencia con Apps Script: allá cada ejecución leía-modificaba-escribía la propiedad sin
 * candado, y la concurrencia real era pequeña. Un Worker atiende cientos de peticiones a la vez,
 * así que leer «int: 0» en cien peticiones paralelas regalaría cien intentos. Por eso aquí el
 * intento se APARTA con una suma atómica en D1 antes de comparar, y el envío del código solo se
 * guarda si nadie escribió entre la lectura y la escritura (comparar-y-cambiar).
 *
 * LOS CORREOS
 * Salen DE VERDAD por Brevo, desde logidma.com (enviarCorreo del núcleo), y quedan además completos en
 * correos_salida con su estado; a direcciones de ejemplo, o sin clave de Brevo (en local), no sale
 * nada y quedan 'omitido'. Si Brevo rechaza el envío, enviarCorreo lanza igual que MailApp.sendEmail
 * y aquí se trata igual que allá (el código se retira y se avisa con el mismo mensaje).
 * La plantilla y sus piezas son las MISMAS de Cuentas.gs, carácter por carácter. Se exportan porque
 * la consola (bienvenida y restablecimiento con contraseña temporal) y la difusión las reutilizan.
 */
import type { Ctx } from '../../nucleo/contexto';
import { enviarCorreo, type Adjunto } from '../../nucleo/correo';
import {
  secConfig, secNormalizarCorreo, secHashContrasena, secComparacionSegura, secCorreoValido,
  secBuscarRegistro, secIdentidad, secIntentosLimpiar, secEscapeHtml, secEsAfirmativo
} from '../../nucleo/seguridad';
import { leerPropiedad, fijarPropiedad, borrarPropiedad } from '../../nucleo/sistema';
import { aleatorioHex, aleatorioEntero } from '../../nucleo/cripto';
import { formatearFecha } from '../../nucleo/fechas';
import { sesParaCliente } from '../../nucleo/sesiones';
import { PERM_ROLES } from '../../nucleo/permisos';
import { mailAlias, correoAplicarCco } from '../cotizaciones';   // Correos.gs (mailAlias_, correoAplicarCco_)

// ── Parámetros (los de Cuentas.gs) ──────────────────────────────────────────

/** Dominio corporativo exigido en las altas nuevas. La propiedad CUENTAS_DOMINIO manda. */
export const CUENTAS_DOMINIO_RESPALDO = 'liverpool.com.mx';

export const CUENTAS_CODIGO_MINUTOS = 10;    // vigencia del código
export const CUENTAS_VALE_MINUTOS = 15;      // vigencia del vale de cambio de contraseña
export const CUENTAS_MAX_INTENTOS = 5;       // intentos de verificación por código
export const CUENTAS_REENVIO_SEGUNDOS = 60;  // espera mínima entre dos envíos
export const CUENTAS_MAX_POR_HORA = 5;       // códigos por correo y propósito en una hora
export const CUENTAS_PREFIJO = 'cta_';       // prefijo de las propiedades (para purgarlas y contarlas)

/** La columna PasswordTemporal de «Registros» es `registros.password_temporal` (0/1). */
export const CUENTAS_COL_TEMPORAL = 'password_temporal';

/**
 * Dominio permitido para altas nuevas ('' si se desactivó).
 * Para quitar la restricción hay que poner la propiedad CUENTAS_DOMINIO en 'ninguno' (o '*'):
 * dejarla vacía no sirve, porque secConfig devolvería el respaldo del código.
 */
export async function cuentasDominioPermitido(ctx: Ctx): Promise<string> {
  const valor = secNormalizarCorreo(await secConfig(ctx, 'CUENTAS_DOMINIO', CUENTAS_DOMINIO_RESPALDO)).replace(/^@/, '');
  if (valor === 'ninguno' || valor === '*' || valor === 'todos') return '';
  return valor;
}

// ── Almacén efímero de códigos y vales ──────────────────────────────────────

/** Lo que se guarda por código o vale (mismas llaves cortas que en Apps Script). */
export interface RegistroCuenta {
  c: string;        // hash del código o del vale
  exp: number;      // caducidad (ms)
  int?: number;     // intentos fallidos
  env?: number;     // envíos en la ventana de una hora
  ini?: number;     // inicio de esa ventana (ms)
  ult?: number;     // último envío (ms)
  dat?: any;        // carga útil para el paso siguiente (nombre, hash de la contraseña…)
}

/** Huella corta del correo: la clave de la propiedad no expone la dirección. */
async function cuentasHuella(ctx: Ctx, texto: unknown): Promise<string> {
  return (await secHashContrasena(ctx, 'huella:' + secNormalizarCorreo(texto))).slice(0, 24);
}

/** cta_<propósito>_<huella>. Propósitos: registro, recuperacion, vale, inicial. */
export async function cuentasClave(ctx: Ctx, proposito: string, correo: unknown): Promise<string> {
  return CUENTAS_PREFIJO + proposito + '_' + await cuentasHuella(ctx, correo);
}

/** Hash del código/vale. Mismo algoritmo y sal que las contraseñas, con su propio prefijo. */
export function cuentasHash(ctx: Ctx, tipo: string, valor: unknown): Promise<string> {
  return secHashContrasena(ctx, tipo + ':' + String(valor || ''));
}

function cuentasInterpretar(crudo: string | null): RegistroCuenta | null {
  if (!crudo) return null;
  try {
    const reg = JSON.parse(crudo);
    return reg && typeof reg === 'object' ? reg as RegistroCuenta : null;
  } catch {
    return null;
  }
}

async function cuentasLeerConTexto(ctx: Ctx, clave: string): Promise<{ crudo: string | null; reg: RegistroCuenta | null }> {
  const crudo = await leerPropiedad(ctx, clave);
  return { crudo, reg: cuentasInterpretar(crudo) };
}

export async function cuentasLeer(ctx: Ctx, clave: string): Promise<RegistroCuenta | null> {
  try { return (await cuentasLeerConTexto(ctx, clave)).reg; } catch { return null; }
}

export async function cuentasGuardar(ctx: Ctx, clave: string, obj: RegistroCuenta): Promise<void> {
  await fijarPropiedad(ctx, clave, JSON.stringify(obj));
}

export async function cuentasBorrar(ctx: Ctx, clave: string): Promise<void> {
  try { await borrarPropiedad(ctx, clave); } catch { /* nada */ }
}

/**
 * Escribe el registro SOLO si la propiedad sigue como se leyó (`antes` = null: no existía).
 * Es el candado que en Apps Script no hacía falta: si otra petición escribió en medio, no se pisa
 * y quien llama vuelve a decidir con lo que hay ahora.
 */
async function cuentasGuardarSi(ctx: Ctx, clave: string, antes: string | null, obj: RegistroCuenta): Promise<boolean> {
  const texto = JSON.stringify(obj);
  const r = antes === null
    ? await ctx.ejecutar(
        'INSERT INTO propiedades (clave, valor, actualizado) VALUES (?, ?, ?) ON CONFLICT(clave) DO NOTHING',
        clave, texto, ctx.ahoraIso())
    : await ctx.ejecutar(
        'UPDATE propiedades SET valor = ?, actualizado = ? WHERE clave = ? AND valor = ?',
        texto, ctx.ahoraIso(), clave, antes);
  return r.cambios > 0;
}

/** Suma un intento en el mismo UPDATE que lo lee: dos peticiones nunca apartan el mismo número. */
async function cuentasApartarIntento(ctx: Ctx, clave: string): Promise<RegistroCuenta | null> {
  const fila = await ctx.una<{ valor: string }>(
    "UPDATE propiedades SET valor = json_set(valor, '$.int', COALESCE(json_extract(valor, '$.int'), 0) + 1), " +
    'actualizado = ? WHERE clave = ? AND json_valid(valor) RETURNING valor',
    ctx.ahoraIso(), clave);
  return cuentasInterpretar(fila ? fila.valor : null);
}

/**
 * Borra los códigos y vales caducados. Se llama al emitir uno nuevo: sin esto la tabla iría
 * creciendo con basura que ya no sirve para nada. Se conservan una hora de más: el contador de
 * envíos por hora vive en el mismo registro y borrarlo al caducar el código regalaría reintentos.
 */
async function cuentasPurgar(ctx: Ctx, salvo = ''): Promise<void> {
  try {
    await ctx.ejecutar(
      'DELETE FROM propiedades WHERE substr(clave, 1, ?) = ? AND clave <> ? AND ' +
      "(CASE WHEN json_valid(valor) THEN COALESCE(json_extract(valor, '$.exp'), 0) ELSE 0 END) < ?",
      CUENTAS_PREFIJO.length, CUENTAS_PREFIJO, salvo, Date.now() - 3600000);
  } catch (e) {
    console.error('cuentasPurgar', e);
  }
}

/** Código de 6 dígitos. Utilities.getUuid + SHA-256 → el generador criptográfico del Worker, sin sesgo. */
function cuentasGenerarCodigo(): string {
  const tope = Math.floor(0x100000000 / 1000000) * 1000000;
  const b = new Uint32Array(1);
  do { crypto.getRandomValues(b); } while (b[0] >= tope);
  return String(b[0] % 1000000).padStart(6, '0');
}

/** Vale de un solo uso: 40 caracteres hexadecimales, el mismo formato que los dos UUID de Apps Script. */
function cuentasNuevoVale(): string {
  return aleatorioHex(20);
}

/** d••••@liverpool.com.mx — para confirmar a dónde fue el código sin publicarlo entero. */
export function cuentasEnmascarar(correo: unknown): string {
  const c = secNormalizarCorreo(correo);
  const at = c.indexOf('@');
  if (at < 1) return c;
  const usuario = c.slice(0, at);
  const visible = usuario.slice(0, usuario.length > 3 ? 2 : 1);
  return visible + '•'.repeat(Math.max(3, usuario.length - visible.length)) + c.slice(at);
}

// ── Emisión y verificación ──────────────────────────────────────────────────

/**
 * Genera un código, lo guarda hasheado y lo manda por correo.
 * @param proposito 'registro' | 'recuperacion'
 * @param correo    destinatario ya normalizado
 * @param datos     carga útil que se recuperará al confirmar (nombre, hash…)
 * @param textos    { asunto, titulo, chip, intro, cierre }
 */
async function cuentasEmitirCodigo(ctx: Ctx, proposito: string, correo: string, datos: any, textos: TextosCodigo) {
  const clave = await cuentasClave(ctx, proposito, correo);

  // Leer → decidir → escribir solo si nadie se adelantó. Si otra petición escribió en medio, la
  // vuelta siguiente ya ve su envío y contesta con el freno, como si hubieran llegado en fila.
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const ahora = Date.now();
    const { crudo, reg: previo } = await cuentasLeerConTexto(ctx, clave);

    // Freno 1: no dos correos seguidos. Evita usar el sistema para bombardear un buzón.
    if (previo && previo.ult && (ahora - previo.ult) < CUENTAS_REENVIO_SEGUNDOS * 1000) {
      const espera = Math.ceil((CUENTAS_REENVIO_SEGUNDOS * 1000 - (ahora - previo.ult)) / 1000);
      return {
        success: false,
        esperaSegundos: espera,
        message: 'Ya te enviamos un código hace un momento. Espera ' + espera + ' segundos para pedir otro.'
      };
    }

    // Freno 2: tope por hora. La ventana arranca con el primer envío y se reinicia sola.
    let envios = 0, ventana = ahora;
    if (previo && previo.ini && (ahora - previo.ini) < 3600000) {
      envios = previo.env || 0;
      ventana = previo.ini;
      if (envios >= CUENTAS_MAX_POR_HORA) {
        return {
          success: false,
          message: 'Pediste demasiados códigos en la última hora. Inténtalo más tarde o avisa al equipo del sistema.'
        };
      }
    }

    const codigo = cuentasGenerarCodigo();
    const registro: RegistroCuenta = {
      c: await cuentasHash(ctx, proposito, codigo),
      exp: ahora + CUENTAS_CODIGO_MINUTOS * 60000,
      int: 0,
      env: envios + 1,
      ini: ventana,
      ult: ahora,
      dat: datos || {}
    };

    await cuentasPurgar(ctx, clave);
    if (!(await cuentasGuardarSi(ctx, clave, crudo, registro))) continue;

    try {
      // La caducidad se pasa al correo para poder decir la hora exacta ("vence a las 14:32 h").
      await cuentasEnviarCodigo(ctx, correo, codigo, Object.assign({ expira: registro.exp }, textos || {}), proposito);
    } catch (e) {
      // Si el correo no salió, el código no sirve para nada: se retira para no dejar al asesor
      // esperando un mensaje que nunca va a llegar.
      await cuentasBorrar(ctx, clave);
      console.error('cuentasEmitirCodigo (' + proposito + ') no pudo enviar:', e);
      return { success: false, message: 'No pudimos enviar el correo con el código. Inténtalo de nuevo en un minuto.' };
    }

    console.log('Código de ' + proposito + ' enviado a ' + correo + ' (envío ' + registro.env + ' de la hora).');
    return {
      success: true,
      message: 'Te enviamos un código de 6 dígitos a ' + cuentasEnmascarar(correo) + '.',
      correoMascara: cuentasEnmascarar(correo),
      expiraSegundos: CUENTAS_CODIGO_MINUTOS * 60,
      reenvioSegundos: CUENTAS_REENVIO_SEGUNDOS
    };
  }
  return { success: false, message: 'El sistema está ocupado. Inténtalo de nuevo en unos segundos.' };
}

interface PruebaCodigo { ok: boolean; datos: any; message: string; intentosRestantes?: number }

/**
 * Comprueba un código. NO borra el registro si acierta: eso lo decide quien llama, cuando la
 * operación de verdad (crear la cuenta, emitir el vale) ya salió bien.
 */
async function cuentasVerificarCodigo(ctx: Ctx, proposito: string, correo: string, codigo: unknown): Promise<PruebaCodigo> {
  const clave = await cuentasClave(ctx, proposito, correo);
  const reg = await cuentasLeer(ctx, clave);
  const limpio = String(codigo == null ? '' : codigo).replace(/\D/g, '');

  if (!reg || !reg.c) {
    return { ok: false, datos: null, message: 'No hay ningún código activo para ese correo. Pide uno nuevo.' };
  }
  if (Date.now() > Number(reg.exp || 0)) {
    await cuentasBorrar(ctx, clave);
    return { ok: false, datos: null, message: 'El código caducó. Pide uno nuevo.' };
  }
  if ((reg.int || 0) >= CUENTAS_MAX_INTENTOS) {
    await cuentasBorrar(ctx, clave);
    return { ok: false, datos: null, message: 'Demasiados intentos con ese código. Pide uno nuevo.' };
  }
  if (limpio.length !== 6) {
    return { ok: false, datos: null, message: 'El código son 6 dígitos.' };
  }

  // El intento se aparta ANTES de comparar: así el tope de 5 vale aunque lleguen cien a la vez.
  // Lo que se compara es lo que devolvió la suma (si entre medias se emitió otro código, manda ese).
  const apartado = await cuentasApartarIntento(ctx, clave);
  if (!apartado || !apartado.c) {
    return { ok: false, datos: null, message: 'No hay ningún código activo para ese correo. Pide uno nuevo.' };
  }
  const usados = apartado.int || 0;
  if (usados > CUENTAS_MAX_INTENTOS) {
    await cuentasBorrar(ctx, clave);
    return { ok: false, datos: null, message: 'Demasiados intentos con ese código. Pide uno nuevo.' };
  }

  if (!secComparacionSegura(await cuentasHash(ctx, proposito, limpio), apartado.c)) {
    const restantes = CUENTAS_MAX_INTENTOS - usados;
    if (restantes <= 0) {
      await cuentasBorrar(ctx, clave);
      return { ok: false, datos: null, message: 'Código incorrecto. Se agotaron los intentos: pide un código nuevo.' };
    }
    return {
      ok: false,
      datos: null,
      intentosRestantes: restantes,
      message: 'Código incorrecto. Te ' + (restantes === 1 ? 'queda 1 intento' : 'quedan ' + restantes + ' intentos') + '.'
    };
  }

  return { ok: true, datos: apartado.dat || {}, message: '' };
}

// ── Consultas y escrituras en «Registros» (tabla registros) ─────────────────

/** ¿Ese correo ya tiene cuenta? */
export async function cuentasCorreoRegistrado(ctx: Ctx, correo: string): Promise<boolean> {
  return (await secBuscarRegistro(ctx, correo)).encontrado;
}

/** Tras escribir en registros, lo memorizado en esta petición quedó viejo. */
function cuentasOlvidar(ctx: Ctx): void {
  ctx.olvidar('perm:');
  ctx.olvidar('id:');
}

/**
 * Alta real de un usuario. Es el único punto que escribe en registros al crear una cuenta (la
 * consola también pasa por aquí).
 * LockService + releer la hoja → un INSERT que no pisa: la clave primaria hace la comprobación
 * «dentro del bloqueo». Las columnas opcionales Verificado/FechaVerificacion no existen en D1.
 */
export async function cuentasAltaUsuario(ctx: Ctx, nombre: string, correo: string, passwordHash: string): Promise<{ success: boolean; message: string }> {
  const email = secNormalizarCorreo(correo);
  const r = await ctx.ejecutar(
    'INSERT INTO registros (email, nombre, password_hash, avanzado, password_temporal, alta) VALUES (?, ?, ?, 0, 0, ?) ' +
    'ON CONFLICT(email) DO NOTHING',
    email, String(nombre == null ? '' : nombre), String(passwordHash || ''), ctx.ahoraIso());
  if (!r.cambios) return { success: false, message: 'El correo electrónico ya está registrado.' };
  cuentasOlvidar(ctx);
  console.log('Usuario dado de alta: ' + email);
  return { success: true, message: 'Usuario registrado exitosamente.' };
}

/** Escribe el hash nuevo de contraseña. @return si encontró la fila. */
export async function cuentasActualizarPassword(ctx: Ctx, correo: string, passwordHash: string): Promise<boolean> {
  const r = await ctx.ejecutar('UPDATE registros SET password_hash = ? WHERE email = ?',
    String(passwordHash || ''), secNormalizarCorreo(correo));
  cuentasOlvidar(ctx);
  return r.cambios > 0;
}

/**
 * Marca o desmarca que la contraseña de este correo es temporal (la consola la marca al dar de
 * alta o restablecer; elegir la propia la desmarca). Nunca lanza: lo peor es que no se pida el cambio.
 */
export async function cuentasMarcarPasswordTemporal(ctx: Ctx, correo: string, esTemporal: boolean): Promise<boolean> {
  try {
    const r = await ctx.ejecutar('UPDATE registros SET password_temporal = ? WHERE email = ?',
      esTemporal ? 1 : 0, secNormalizarCorreo(correo));
    cuentasOlvidar(ctx);
    return r.cambios > 0;
  } catch (e) {
    console.error('cuentasMarcarPasswordTemporal', e);
    return false;
  }
}

/**
 * ¿La contraseña de este correo es una temporal pendiente de cambiar? Ante cualquier duda responde
 * NO: equivocarse hacia el «sí» dejaría a alguien atrapado en la pantalla de cambio sin motivo.
 */
export async function cuentasPasswordEsTemporal(ctx: Ctx, correo: string): Promise<boolean> {
  try {
    const fila = await ctx.una<{ password_temporal: number }>(
      'SELECT password_temporal FROM registros WHERE email = ?', secNormalizarCorreo(correo));
    return !!fila && secEsAfirmativo(fila.password_temporal);
  } catch {
    return false;
  }
}

/** Hash actual de la contraseña de un correo ('' si no lo encuentra). Sin memo: puede haber cambiado. */
export async function cuentasHashActual(ctx: Ctx, correo: string): Promise<string> {
  try {
    const fila = await ctx.una<{ password_hash: string }>(
      'SELECT password_hash FROM registros WHERE email = ?', secNormalizarCorreo(correo));
    return fila ? String(fila.password_hash || '').trim() : '';
  } catch {
    return '';
  }
}

/**
 * Contraseña temporal legible (consolaPasswordTemporal_ de Consola.gs, la usan el alta y el
 * restablecimiento de la consola): sin caracteres que se confundan al dictarla (0/O, 1/l/I) y en
 * tres bloques. Math.random → generador criptográfico del Worker.
 */
export function consolaPasswordTemporal(): string {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const numeros = '23456789';
  const trozo = (fuente: string, n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) s += fuente.charAt(aleatorioEntero(0, fuente.length - 1));
    return s;
  };
  return trozo(letras, 3) + '-' + trozo(numeros, 4) + '-' + trozo(letras, 3);
}

// =================================================================================================
// ALTA DE CUENTA CON VERIFICACIÓN POR CORREO
// =================================================================================================

/**
 * Paso 1 del alta: valida los datos y manda el código. La cuenta todavía NO existe; el nombre y el
 * hash de la contraseña quedan guardados junto al código y se usan al confirmar. La contraseña en
 * claro nunca se almacena, ni siquiera de forma temporal.
 */
export async function solicitarCodigoRegistro(ctx: Ctx, name: string, email: string, password: string) {
  try {
    const nombre = String(name || '').trim();
    const correo = secNormalizarCorreo(email);
    const clave = String(password == null ? '' : password);

    if (nombre.length < 3) return { success: false, campo: 'name', message: 'Escribe tu nombre completo.' };
    if (!secCorreoValido(correo)) return { success: false, campo: 'email', message: 'El correo electrónico no tiene un formato válido.' };

    const dominio = await cuentasDominioPermitido(ctx);
    if (dominio && correo.slice(-(dominio.length + 1)) !== '@' + dominio) {
      return { success: false, campo: 'email', message: 'Solo se pueden crear cuentas con un correo @' + dominio + '.' };
    }
    if (clave.length < 6) return { success: false, campo: 'password', message: 'La contraseña debe tener al menos 6 caracteres.' };
    if (await cuentasCorreoRegistrado(ctx, correo)) {
      return { success: false, campo: 'email', message: 'Ese correo ya tiene cuenta. Inicia sesión o recupera tu contraseña.' };
    }

    return await cuentasEmitirCodigo(ctx, 'registro', correo, { nombre, hash: await secHashContrasena(ctx, clave) }, {
      titulo: 'Confirma tu correo',
      chip: 'Alta de cuenta',
      intro: 'Estás creando tu cuenta en el Sistema de cotizaciones Ventel. Escribe este código para terminar:',
      asunto: 'Tu código para crear la cuenta · Ventel',
      cierre: 'Si no fuiste tú quien pidió crear una cuenta, ignora este mensaje: sin el código no se crea nada.'
    });
  } catch (error) {
    console.error('solicitarCodigoRegistro', error);
    return { success: false, message: 'No pudimos iniciar tu registro. Inténtalo de nuevo en un minuto.' };
  }
}

/** Paso 2 del alta: comprueba el código y, solo entonces, crea la cuenta. */
export async function confirmarCodigoRegistro(ctx: Ctx, email: string, codigo: string) {
  try {
    const correo = secNormalizarCorreo(email);
    if (!secCorreoValido(correo)) return { success: false, message: 'Correo no válido.' };

    const prueba = await cuentasVerificarCodigo(ctx, 'registro', correo, codigo);
    if (!prueba.ok) return { success: false, message: prueba.message, intentosRestantes: prueba.intentosRestantes };

    const alta = await cuentasAltaUsuario(ctx, prueba.datos.nombre, correo, prueba.datos.hash);
    await cuentasBorrar(ctx, await cuentasClave(ctx, 'registro', correo));   // de un solo uso, salga bien o mal
    if (!alta.success) return alta;

    try {
      await cuentasEnviarAviso(ctx, correo, prueba.datos.nombre, {
        titulo: 'Tu cuenta ya está lista',
        chip: 'Cuenta creada',
        tono: 'ok',
        preheader: 'Ya puedes iniciar sesión en el Sistema de cotizaciones Ventel.',
        intro: 'Se creó tu cuenta en el Sistema de cotizaciones Ventel con este correo. Ya puedes iniciar sesión y empezar a cotizar.',
        asunto: 'Cuenta creada · Sistema de cotizaciones Ventel',
        datos: [['Nombre', prueba.datos.nombre || '']],
        cta: { texto: 'Iniciar sesión', pagina: 'login' },
        alerta: {
          titulo: '¿No reconoces esta cuenta?',
          texto: 'Si no fuiste tú quien se registró con este correo, avisa al equipo del sistema para que la demos de baja.',
          tono: 'warn'
        },
        cierre: 'Guarda tu contraseña en un sitio seguro: nadie del equipo puede verla, solo se puede restablecer.'
      });
    } catch (e) {
      console.error('Aviso de alta no enviado (la cuenta sí se creó):', e);
    }

    return {
      success: true,
      message: 'Cuenta verificada y creada.',
      userEmail: correo,
      userName: prueba.datos.nombre
    };
  } catch (error) {
    console.error('confirmarCodigoRegistro', error);
    return { success: false, message: 'No pudimos confirmar tu código. Inténtalo de nuevo en un minuto.' };
  }
}

// =================================================================================================
// RECUPERACIÓN DE CONTRASEÑA
// =================================================================================================

/**
 * Paso 1: manda el código a un correo que SÍ tenga cuenta. Se dice claramente cuando el correo no
 * está dado de alta (decisión de uso interno: el asesor necesita saber que se equivocó de dirección).
 */
export async function solicitarCodigoRecuperacion(ctx: Ctx, email: string) {
  try {
    const correo = secNormalizarCorreo(email);
    if (!secCorreoValido(correo)) {
      return { success: false, campo: 'email', message: 'El correo electrónico no tiene un formato válido.' };
    }

    const reg = await secBuscarRegistro(ctx, correo);
    if (!reg.encontrado) {
      return {
        success: false,
        campo: 'email',
        message: 'Ese correo no está dado de alta en el sistema. Revisa que esté bien escrito o crea una cuenta.'
      };
    }

    return await cuentasEmitirCodigo(ctx, 'recuperacion', correo, { nombre: reg.nombre }, {
      titulo: 'Recupera tu contraseña',
      chip: 'Recuperar acceso',
      intro: 'Pediste cambiar la contraseña de tu cuenta en el Sistema de cotizaciones Ventel. Escribe este código para continuar:',
      asunto: 'Tu código para recuperar la contraseña · Ventel',
      cierre: 'Si no fuiste tú, ignora este mensaje: tu contraseña sigue igual mientras nadie use el código.'
    });
  } catch (error) {
    console.error('solicitarCodigoRecuperacion', error);
    return { success: false, message: 'No pudimos enviarte el código. Inténtalo de nuevo en un minuto.' };
  }
}

/**
 * Paso 2: comprueba el código y entrega un vale de un solo uso para cambiar la contraseña. El
 * código se retira en el acto: a partir de aquí manda el vale.
 */
export async function confirmarCodigoRecuperacion(ctx: Ctx, email: string, codigo: string) {
  try {
    const correo = secNormalizarCorreo(email);
    if (!secCorreoValido(correo)) return { success: false, message: 'Correo no válido.' };

    const prueba = await cuentasVerificarCodigo(ctx, 'recuperacion', correo, codigo);
    if (!prueba.ok) return { success: false, message: prueba.message, intentosRestantes: prueba.intentosRestantes };

    const vale = cuentasNuevoVale();
    const ahora = Date.now();
    await cuentasGuardar(ctx, await cuentasClave(ctx, 'vale', correo), {
      c: await cuentasHash(ctx, 'vale', vale),
      exp: ahora + CUENTAS_VALE_MINUTOS * 60000,
      int: 0,
      env: 1,
      ini: ahora,
      ult: ahora,
      dat: { nombre: prueba.datos.nombre || '' }
    });
    await cuentasBorrar(ctx, await cuentasClave(ctx, 'recuperacion', correo));

    return {
      success: true,
      message: 'Código verificado. Ahora elige tu contraseña nueva.',
      vale,
      expiraSegundos: CUENTAS_VALE_MINUTOS * 60
    };
  } catch (error) {
    console.error('confirmarCodigoRecuperacion', error);
    return { success: false, message: 'No pudimos verificar tu código. Inténtalo de nuevo en un minuto.' };
  }
}

/** Paso 3: cambia la contraseña. Exige el vale emitido en el paso 2, que se quema al usarse. */
export async function restablecerContrasena(ctx: Ctx, email: string, vale: string, nueva: string) {
  try {
    const correo = secNormalizarCorreo(email);
    const clave = String(nueva == null ? '' : nueva);
    if (!secCorreoValido(correo)) return { success: false, message: 'Correo no válido.' };
    if (clave.length < 6) return { success: false, campo: 'password', message: 'La contraseña debe tener al menos 6 caracteres.' };

    const claveVale = await cuentasClave(ctx, 'vale', correo);
    const reg = await cuentasLeer(ctx, claveVale);
    if (!reg || !reg.c) {
      return { success: false, expirado: true, message: 'La verificación caducó. Vuelve a pedir un código.' };
    }
    if (Date.now() > Number(reg.exp || 0)) {
      await cuentasBorrar(ctx, claveVale);
      return { success: false, expirado: true, message: 'La verificación caducó. Vuelve a pedir un código.' };
    }
    if (!secComparacionSegura(await cuentasHash(ctx, 'vale', vale), reg.c)) {
      await cuentasBorrar(ctx, claveVale);
      console.log('Vale de recuperación inválido para ' + correo);
      return { success: false, expirado: true, message: 'La verificación no es válida. Vuelve a pedir un código.' };
    }

    const hashNuevo = await secHashContrasena(ctx, clave);
    if (secComparacionSegura(hashNuevo, await cuentasHashActual(ctx, correo))) {
      return { success: false, campo: 'password', message: 'Esa ya es tu contraseña actual. Elige una distinta.' };
    }

    const cambiada = await cuentasActualizarPassword(ctx, correo, hashNuevo);
    await cuentasBorrar(ctx, claveVale);
    if (!cambiada) {
      return { success: false, message: 'No encontramos tu cuenta al guardar la contraseña. Avisa al equipo del sistema.' };
    }

    // El bloqueo por intentos fallidos ya no tiene sentido: la contraseña es otra.
    await secIntentosLimpiar(ctx, correo);

    try {
      await cuentasEnviarAviso(ctx, correo, (reg.dat && reg.dat.nombre) || '', {
        titulo: 'Tu contraseña se actualizó',
        chip: 'Contraseña actualizada',
        tono: 'ok',
        preheader: 'Cambio confirmado. Si no fuiste tú, avisa al equipo del sistema.',
        intro: 'La contraseña de tu cuenta en el Sistema de cotizaciones Ventel acaba de cambiar. Si fuiste tú, no tienes que hacer nada más: entra con la contraseña nueva.',
        asunto: 'Tu contraseña de Ventel cambió',
        cta: { texto: 'Iniciar sesión', pagina: 'login' },
        alerta: {
          titulo: 'Si NO fuiste tú, actúa ahora',
          texto: 'Alguien más pudo entrar a tu correo. Avisa de inmediato al equipo del sistema y cambia también la contraseña de tu cuenta de correo.',
          tono: 'warn'
        }
      });
    } catch (e) {
      console.error('Aviso de cambio de contraseña no enviado (la contraseña sí cambió):', e);
    }

    // La eligió la persona: deja de ser temporal, si es que lo era.
    await cuentasMarcarPasswordTemporal(ctx, correo, false);

    console.log('Contraseña restablecida para ' + correo);
    return { success: true, message: 'Tu contraseña se actualizó. Ya puedes iniciar sesión.', userEmail: correo };
  } catch (error) {
    console.error('restablecerContrasena', error);
    return { success: false, message: 'No pudimos actualizar tu contraseña. Inténtalo de nuevo en un minuto.' };
  }
}

// =================================================================================================
// PRIMERA CONTRASEÑA (tras entrar con una temporal)
// =================================================================================================

/**
 * Vale de contraseña inicial: lo emite loginUser cuando la credencial es correcta pero temporal
 * (en Code.gs iba en línea dentro de loginUser). Se guarda en cta_inicial_<huella> con
 * {c: hash('vale', vale), exp, ini}; lo consume establecerPasswordInicial. Lanza si no se pudo
 * guardar: loginUser lo atrapa y deja entrar con normalidad.
 */
export async function emitirValeInicial(ctx: Ctx, correo: string): Promise<{ vale: string; expiraSegundos: number }> {
  const email = secNormalizarCorreo(correo);
  const vale = cuentasNuevoVale();
  const ahora = Date.now();
  await cuentasGuardar(ctx, await cuentasClave(ctx, 'inicial', email), {
    c: await cuentasHash(ctx, 'vale', vale),
    exp: ahora + CUENTAS_VALE_MINUTOS * 60000,
    ini: ahora
  });
  console.log('Login con contraseña temporal: ' + email + ' — se pedirá contraseña nueva.');
  return { vale, expiraSegundos: CUENTAS_VALE_MINUTOS * 60 };
}

/**
 * Cambia la contraseña temporal por la definitiva y ABRE LA SESIÓN. Devuelve exactamente lo mismo
 * que un login correcto, para que la pantalla guarde la sesión y entre sin pedir credenciales.
 */
export async function establecerPasswordInicial(ctx: Ctx, email: string, vale: string, nueva: string) {
  try {
    const correo = secNormalizarCorreo(email);
    const clave = String(nueva == null ? '' : nueva);
    if (!secCorreoValido(correo)) return { success: false, message: 'Correo no válido.' };
    if (clave.length < 6) {
      return { success: false, campo: 'password', message: 'La contraseña debe tener al menos 6 caracteres.' };
    }

    const claveVale = await cuentasClave(ctx, 'inicial', correo);
    const reg = await cuentasLeer(ctx, claveVale);
    if (!reg || !reg.c || Date.now() > Number(reg.exp || 0)) {
      await cuentasBorrar(ctx, claveVale);
      return { success: false, expirado: true,
               message: 'Se acabó el tiempo para elegir tu contraseña. Vuelve a entrar con la temporal.' };
    }
    if (!secComparacionSegura(await cuentasHash(ctx, 'vale', vale), reg.c)) {
      await cuentasBorrar(ctx, claveVale);
      console.log('Vale de primera contraseña inválido para ' + correo);
      return { success: false, expirado: true,
               message: 'La verificación no es válida. Vuelve a entrar con la contraseña temporal.' };
    }

    // Que no repita la temporal: es justo la que hay que dejar de usar.
    const hashNuevo = await secHashContrasena(ctx, clave);
    if (secComparacionSegura(hashNuevo, await cuentasHashActual(ctx, correo))) {
      return { success: false, campo: 'password',
               message: 'Esa es la contraseña temporal. Elige una distinta, solo tuya.' };
    }

    if (!(await cuentasActualizarPassword(ctx, correo, hashNuevo))) {
      return { success: false, message: 'No encontramos tu cuenta al guardar la contraseña. Avisa al equipo del sistema.' };
    }
    await cuentasMarcarPasswordTemporal(ctx, correo, false);
    await cuentasBorrar(ctx, claveVale);
    await secIntentosLimpiar(ctx, correo);

    // Sesión: el vale que se acaba de consumir PRUEBA quién es, así que se abre la llave aquí y se
    // resuelve la identidad con ella (SEC_SESION_ de Apps Script = ctx.sesion).
    let sesionNueva;
    try {
      sesionNueva = await sesParaCliente(ctx, correo);
      ctx.sesion = { email: correo };
    } catch (eSesion) {
      console.error('establecerPasswordInicial: no se pudo abrir la sesión', eSesion);
      return { success: false, message: 'Tu contraseña se guardó, pero no pudimos abrir la sesión. Inicia sesión de nuevo.' };
    }
    const id = await secIdentidad(ctx, correo);
    if (!id.ok) {
      return { success: false, message: id.error || 'Tu contraseña se guardó, pero no pudimos abrir la sesión. Inicia sesión de nuevo.' };
    }

    console.log('Primera contraseña establecida para ' + correo);
    return {
      success: true,
      message: 'Listo. Esta es tu contraseña a partir de ahora.',
      userName: id.nombre,
      userEmail: id.email,
      llave: sesionNueva.llave,
      inactividadMin: sesionNueva.inactividadMin,
      isAdvanced: id.avanzado,
      rol: id.rol,
      rolNombre: PERM_ROLES[id.rol] ? PERM_ROLES[id.rol].nombre : '',
      isMaster: id.maestro === true,
      bloques: id.bloques || []
    };
  } catch (error) {
    console.error('establecerPasswordInicial', error);
    return { success: false, message: 'No pudimos guardar tu contraseña. Inténtalo de nuevo en un minuto.' };
  }
}

// =================================================================================================
// CORREOS
// =================================================================================================
/*
 * LENGUAJE VISUAL DE LOS CORREOS DE CUENTA (de Cuentas.gs)
 * Mismos tokens que la app: neutros fríos para texto y superficies, y el rosa #E10098 reservado al
 * acento. Tablas para maquetar y estilos EN LÍNEA (lo único que respetan Gmail, Outlook y los
 * clientes móviles), 600 px de ancho, preheader oculto, el <style> solo añade tema oscuro y todo
 * correo sale con su versión en texto plano construida con los mismos datos.
 */

/** Paleta del correo. Espejo de los tokens claros de app_theme.html (no inventar colores). */
export const CUENTAS_MAIL = {
  bg:        '#EDF1F6',   // lienzo detrás de la tarjeta
  surface:   '#FFFFFF',
  surface2:  '#F7F9FC',   // cajas dentro de la tarjeta
  line:      '#E4E9F0',
  ink:       '#1B2330',
  inkSoft:   '#5C6B7E',
  inkFaint:  '#6B7684',   // más oscuro que --ink-faint de la app: aquí hay texto de 11 px (AA)
  brand:     '#E10098',
  brandDeep: '#A8006F',
  brandTint: '#FDE7F4',
  ok:        '#15803D',
  okTint:    '#EAF7EF',
  warn:      '#9A5B00',
  warnTint:  '#FDF4E7',
  fuente:    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,Helvetica,sans-serif",
  mono:      "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace",
  logo:      'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Liverpool_logo.svg/1280px-Liverpool_logo.svg.png'
};

/** Colores de un tono semántico: 'brand' (acción), 'ok' (confirmado), 'warn' (atención). */
export function cuentasMailTono(tono?: string): { ink: string; tint: string; marca: string } {
  const M = CUENTAS_MAIL;
  if (tono === 'ok')   return { ink: M.ok,        tint: M.okTint,    marca: '✓' };
  if (tono === 'warn') return { ink: M.warn,      tint: M.warnTint,  marca: '!' };
  return { ink: M.brandDeep, tint: M.brandTint, marca: '•' };
}

/** Fecha y hora legibles para el cuerpo del correo (formato numérico: el mes saldría en inglés). */
export function cuentasMailFecha(fecha?: Date): string {
  return formatearFecha(fecha || new Date(), "dd/MM/yyyy 'a las' HH:mm");
}

/** Solo la hora (para "vence a las 14:32 h"). */
export function cuentasMailHora(fecha?: Date): string {
  return formatearFecha(fecha || new Date(), 'HH:mm');
}

/**
 * URL de una pantalla de la app para un botón del correo. ScriptApp.getService().getUrl() → el
 * origen de esta petición (el dominio que ve la gente). '' si no se conoce: entonces no hay botón.
 */
export function cuentasUrlApp(ctx: Ctx, pagina?: string): string {
  const base = String((ctx && ctx.origen) || '').replace(/\/$/, '');
  if (!base) return '';
  const p = String(pagina || '').trim();
  return p ? base + '/?page=' + encodeURIComponent(p) : base + '/';
}

// ── Piezas de la plantilla ──────────────────────────────────────────────────
// Cada pieza devuelve HTML ya seguro: el texto se escapa aquí, no en quien llama.

/** Texto de vista previa en la bandeja (los espacios de ancho cero evitan que se rellene con el cuerpo). */
export function cuentasMailPreheader(texto?: string): string {
  if (!texto) return '';
  return '<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;' +
         'font-size:1px;line-height:1px;color:transparent;mso-hide:all">' +
         secEscapeHtml(texto) + '&#8203;&nbsp;'.repeat(69) + '</div>';
}

/** Párrafo del cuerpo. nivel: 1 = principal, 2 = secundario, 3 = letra pequeña. */
export function cuentasMailP(html: string, nivel?: number, margen?: number | null): string {
  const M = CUENTAS_MAIL;
  const n = nivel || 1;
  const est = ({
    1: 'font-size:16px;line-height:1.6;color:' + M.ink,
    2: 'font-size:15px;line-height:1.6;color:' + M.inkSoft,
    3: 'font-size:13px;line-height:1.6;color:' + M.inkFaint
  } as Record<number, string>)[n];
  const clase = ({ 1: 'm-t1', 2: 'm-t2', 3: 'm-t3' } as Record<number, string>)[n];
  return '<p class="' + clase + '" style="margin:0 0 ' + (margen == null ? 16 : margen) + 'px;' + est + '">' + html + '</p>';
}

/** Distintivo de estado. Lleva texto siempre: el color por sí solo no informa. */
export function cuentasMailChip(texto?: string, tono?: string): string {
  if (!texto) return '';
  const t = cuentasMailTono(tono);
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr>' +
    '<td style="padding:6px 12px;border-radius:999px;background:' + t.tint + '">' +
      '<span style="font-family:' + CUENTAS_MAIL.fuente + ';font-size:11px;font-weight:700;' +
      'letter-spacing:.1em;text-transform:uppercase;color:' + t.ink + '">' +
      t.marca + '&nbsp;&nbsp;' + secEscapeHtml(texto) + '</span>' +
    '</td></tr></table>';
}

/** Botón sólido a prueba de clientes: el color va en el <td> (Outlook ignora el fondo del <a>). */
export function cuentasMailBoton(texto: string, url: string): string {
  if (!url) return '';
  const M = CUENTAS_MAIL;
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 22px"><tr>' +
    '<td align="center" bgcolor="' + M.brand + '" style="border-radius:10px">' +
      '<a href="' + secEscapeHtml(url) + '" target="_blank" ' +
      'style="display:inline-block;padding:13px 28px;font-family:' + M.fuente + ';font-size:15px;' +
      'font-weight:700;line-height:1;color:#FFFFFF;text-decoration:none;border-radius:10px">' +
      secEscapeHtml(texto) + '</a>' +
    '</td></tr></table>';
}

/** Ficha de datos del evento (cuenta, fecha…). @param filas pares [etiqueta, valor] */
export function cuentasMailDatos(filas: unknown[][]): string {
  const M = CUENTAS_MAIL;
  const utiles = (filas || []).filter((f) => f && f[1]);
  if (!utiles.length) return '';

  // Las clases m-t2/m-t1 son imprescindibles: sin ellas, en tema oscuro el valor desaparece.
  const cuerpo = utiles.map((f, i) => {
    const borde = i ? 'border-top:1px solid ' + M.line + ';' : '';
    return '<tr>' +
      '<td class="m-hair m-t2" style="' + borde + 'padding:10px 0 10px 16px;font-family:' + M.fuente + ';' +
      'font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;' +
      'color:' + M.inkSoft + ';white-space:nowrap;vertical-align:top">' + secEscapeHtml(f[0]) + '</td>' +
      '<td class="m-hair m-t1" align="right" style="' + borde + 'padding:10px 16px 10px 12px;font-family:' + M.fuente + ';' +
      'font-size:14px;font-weight:600;color:' + M.ink + ';vertical-align:top">' + secEscapeHtml(f[1]) + '</td>' +
    '</tr>';
  }).join('');

  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="m-soft" ' +
    'style="margin:0 0 22px;background:' + M.surface2 + ';border:1px solid ' + M.line + ';border-radius:12px">' +
    cuerpo + '</table>';
}

/** Recuadro de aviso con barra lateral de color (seguridad, "si no fuiste tú"…). */
export function cuentasMailNota(titulo: string | undefined, texto: string | undefined, tono?: string): string {
  if (!texto) return '';
  const M = CUENTAS_MAIL;
  const t = cuentasMailTono(tono);
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="margin:0 0 20px;background:' + t.tint + ';border-radius:12px">' +
    '<tr><td style="padding:14px 16px;border-left:3px solid ' + t.ink + ';border-radius:12px">' +
      (titulo
        ? '<div style="font-family:' + M.fuente + ';font-size:13px;font-weight:700;color:' + t.ink + ';margin-bottom:4px">' +
          secEscapeHtml(titulo) + '</div>'
        : '') +
      '<div style="font-family:' + M.fuente + ';font-size:13px;line-height:1.6;color:#3F4A57">' +
      secEscapeHtml(texto) + '</div>' +
    '</td></tr></table>';
}

// ── Envío ───────────────────────────────────────────────────────────────────

export interface CuentasExtraCorreo {
  /** Pide la copia oculta global (CORREO_CCO_GLOBAL). Opt-in: los correos de seguridad no la llevan. */
  cco?: boolean;
  bcc?: string;
  adjuntos?: Adjunto[];
  responderA?: string;
  remitente?: string;
  /** Propios de esta versión: etiquetan la fila de correos_salida. */
  tipo?: string;
  referencia?: string;
}

/**
 * cuentasEnviarCorreo_: Gmail con alias o MailApp → Brevo (enviarCorreo del núcleo). No hay alias de
 * grupo que comprobar (GmailApp.getAliases): el remitente de logidma.com (mailAlias) siempre está
 * disponible, así que se va siempre por «la vía del alias» y se contesta con él, como allá.
 * Si Brevo rechaza el envío, LANZA (como MailApp.sendEmail): quien llama decide qué decirle a la persona.
 * El modo captura de Apps Script (CUENTAS_MAIL_CAPTURA) sobra: todo correo queda entero en correos_salida.
 */
export async function cuentasEnviarCorreo(ctx: Ctx, para: string, asunto: string, html: string, textoPlano: string,
                                          extra: CuentasExtraCorreo = {}): Promise<string> {
  const opciones: { bcc?: string } = { bcc: extra.bcc || '' };
  if (extra.cco === true) await correoAplicarCco(ctx, opciones, [para]);
  const alias = await mailAlias(ctx);
  await enviarCorreo(ctx, {
    para,
    asunto,
    html,
    texto: textoPlano,
    cco: opciones.bcc || '',
    de: alias,
    nombreDe: extra.remitente || 'Sistema de cotizaciones Ventel',
    responderA: extra.responderA,
    adjuntos: extra.adjuntos,
    tipo: extra.tipo || 'cuenta',
    referencia: extra.referencia
  });
  return alias;
}

export interface TextosCodigo { asunto?: string; titulo?: string; chip?: string; intro?: string; cierre?: string; expira?: number }

/**
 * Correo con el código. El código va en el cuerpo, nunca en el asunto (el asunto se lee en la
 * lista de la bandeja). A propósito NO lleva botón: el código se teclea en la misma pestaña.
 */
export async function cuentasEnviarCodigo(ctx: Ctx, correo: string, codigo: string, textos: TextosCodigo, referencia?: string): Promise<string> {
  const M = CUENTAS_MAIL;
  const asunto = textos.asunto || 'Tu código de verificación · Ventel';
  const hora = textos.expira ? cuentasMailHora(new Date(textos.expira)) : '';

  const html = cuentasPlantillaCorreo({
    titulo: textos.titulo || 'Tu código de verificación',
    chip: textos.chip || 'Código de verificación',
    tono: 'brand',
    // La bandeja muestra esto antes de abrir: el dato que el asesor está esperando.
    preheader: 'Tu código de 6 dígitos, válido ' + CUENTAS_CODIGO_MINUTOS + ' minutos.',
    cuerpo:
      cuentasMailP(secEscapeHtml(textos.intro || 'Usa este código para continuar:'), 1, 20) +

      // El código: lo más grande del correo. Monoespaciada para que no se confunda 0 con O.
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="m-soft" ' +
      'style="margin:0 0 22px;background:' + M.surface2 + ';border:1px solid ' + M.line + ';border-radius:14px">' +
        '<tr><td align="center" style="padding:24px 16px 20px">' +
          '<div class="m-t3" style="font-family:' + M.fuente + ';font-size:11px;font-weight:700;' +
          'letter-spacing:.14em;text-transform:uppercase;color:' + M.inkFaint + ';margin-bottom:12px">' +
          'Tu código</div>' +
          '<div class="m-code" style="font-family:' + M.mono + ';font-size:38px;font-weight:700;line-height:1.1;' +
          'letter-spacing:.28em;text-indent:.28em;color:' + M.brand + '">' + secEscapeHtml(codigo) + '</div>' +
        '</td></tr>' +
        '<tr><td align="center" class="m-hair" style="padding:11px 16px;border-top:1px solid ' + M.line + '">' +
          '<span class="m-t2" style="font-family:' + M.fuente + ';font-size:12px;font-weight:600;color:' + M.inkSoft + '">' +
          (hora ? 'Vence a las ' + hora + ' h' : 'Vence en ' + CUENTAS_CODIGO_MINUTOS + ' minutos') +
          '&nbsp; · &nbsp;Un solo uso</span>' +
        '</td></tr>' +
      '</table>' +

      cuentasMailP('Tecléalo en la pestaña donde lo pediste. Si ya la cerraste, vuelve a empezar y pide otro código.', 2, 20) +

      cuentasMailNota('Nadie te va a pedir este código',
        'Ni por teléfono, ni por chat, ni por correo. El equipo Ventel nunca te lo va a preguntar: si alguien lo hace, no se lo des.',
        'warn') +

      (textos.cierre ? cuentasMailP(secEscapeHtml(textos.cierre), 3, 0) : '')
  });

  const plano = [
    textos.titulo || 'Tu código de verificación',
    '',
    textos.intro || 'Usa este código para continuar:',
    '',
    '    ' + codigo,
    '',
    (hora ? 'Vence a las ' + hora + ' h' : 'Vence en ' + CUENTAS_CODIGO_MINUTOS + ' minutos') + '. Un solo uso.',
    '',
    'Nadie del equipo Ventel te va a pedir este código por teléfono, chat ni correo.',
    'No lo compartas con nadie.',
    '',
    textos.cierre || ''
  ].join('\n');

  // Sin copia oculta global: es un correo de seguridad.
  return cuentasEnviarCorreo(ctx, correo, asunto, html, plano, { tipo: 'cuenta', referencia: referencia || 'codigo' });
}

export interface TextosAviso {
  titulo?: string; intro?: string; cierre?: string; asunto?: string;
  chip?: string; tono?: string; preheader?: string;
  datos?: unknown[][];
  cta?: { texto?: string; pagina?: string };
  alerta?: { titulo?: string; texto?: string; tono?: string };
}

/**
 * Correo informativo, sin código dentro (cuenta creada, contraseña cambiada), con la ficha del
 * evento y un botón hacia la pantalla a la que va.
 */
export async function cuentasEnviarAviso(ctx: Ctx, correo: string, nombre: string, textos: TextosAviso): Promise<string> {
  const pila = String(nombre || '').trim();
  const saludo = pila ? 'Hola, ' + secEscapeHtml(pila.split(' ')[0]) + ':' : 'Hola:';
  const url = textos.cta ? cuentasUrlApp(ctx, textos.cta.pagina) : '';
  // Una sola lectura del reloj: las dos versiones del mismo correo con la misma hora.
  const cuando = cuentasMailFecha(new Date()) + ' h';

  const filas: unknown[][] = (textos.datos || []).slice();
  filas.push(['Cuenta', correo]);
  filas.push(['Fecha y hora', cuando]);

  const html = cuentasPlantillaCorreo({
    titulo: textos.titulo || 'Aviso de tu cuenta',
    chip: textos.chip || '',
    tono: textos.tono || 'ok',
    preheader: textos.preheader || textos.intro || '',
    cuerpo:
      cuentasMailP(saludo, 1, 12) +
      cuentasMailP(secEscapeHtml(textos.intro || ''), 1, 22) +
      cuentasMailDatos(filas) +
      cuentasMailBoton((textos.cta && textos.cta.texto) || '', url) +
      (textos.alerta
        ? cuentasMailNota(textos.alerta.titulo, textos.alerta.texto, textos.alerta.tono || 'warn')
        : '') +
      (textos.cierre ? cuentasMailP(secEscapeHtml(textos.cierre), 3, 0) : '')
  });

  const plano = [
    textos.titulo || 'Aviso de tu cuenta',
    '',
    (pila ? 'Hola, ' + pila.split(' ')[0] + ':' : 'Hola:'),
    '',
    textos.intro || '',
    '',
    'Cuenta: ' + correo,
    'Fecha y hora: ' + cuando + ' (hora del centro de México)',
    '',
    (url ? ((textos.cta && textos.cta.texto) || 'Abrir el sistema') + ': ' + url + '\n' : ''),
    (textos.alerta ? textos.alerta.texto + '\n' : ''),
    textos.cierre || ''
  ].join('\n');

  // Estos avisos SÍ llevan la copia oculta global: dicen que una cuenta se creó o que su
  // contraseña cambió, nunca cuál es.
  return cuentasEnviarCorreo(ctx, correo, textos.asunto || 'Aviso de tu cuenta · Ventel', html, plano,
                             { cco: true, tipo: 'cuenta', referencia: 'aviso' });
}

/**
 * Marco del correo: cabecera con la marca, distintivo de estado, título, cuerpo y pie. Recibe HTML
 * ya escapado por las piezas de arriba; el único texto que escapa aquí es el título.
 */
export function cuentasPlantillaCorreo(op: { titulo?: string; cuerpo?: string; chip?: string; tono?: string; preheader?: string }): string {
  const M = CUENTAS_MAIL;
  const o = op || {};

  return '' +
  '<!DOCTYPE html><html lang="es"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    // Sin esto, iOS y Outlook oscurecen el correo por su cuenta y revientan los contrastes.
    '<meta name="color-scheme" content="light dark">' +
    '<meta name="supported-color-schemes" content="light dark">' +
    '<title>' + secEscapeHtml(o.titulo || '') + '</title>' +
    // Outlook de escritorio no entiende la pila de fuentes moderna: se le fija Arial.
    '<!--[if mso]><style>body,table,td,p,a,h1,div{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->' +
    '<style>' +
      // Móvil: menos aire lateral, para no perder ancho de lectura en 375 px.
      '@media only screen and (max-width:620px){' +
        '.m-pad{padding-left:22px !important;padding-right:22px !important}' +
        '.m-code{font-size:32px !important;letter-spacing:.2em !important;text-indent:.2em !important}' +
      '}' +
      // Tema oscuro: se redefinen los tokens, no se invierten los colores.
      '@media (prefers-color-scheme:dark){' +
        '.m-bg{background:#111519 !important}' +
        '.m-card{background:#1C2027 !important;border-color:#2C313A !important}' +
        '.m-soft{background:#22272F !important;border-color:#2C313A !important}' +
        '.m-hair{border-color:#2C313A !important}' +
        '.m-t1{color:#F1EDEF !important}' +
        '.m-t2{color:#C3CAD3 !important}' +
        '.m-t3{color:#96A0AC !important}' +
        '.m-logo{filter:brightness(0) invert(1)}' +
      '}' +
    '</style>' +
  '</head>' +
  '<body class="m-bg" style="margin:0;padding:0;width:100%;background:' + M.bg + ';' +
  '-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">' +
    cuentasMailPreheader(o.preheader) +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="m-bg" ' +
    'style="background:' + M.bg + '">' +
      '<tr><td align="center" style="padding:32px 12px">' +

        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="m-card" ' +
        'style="width:100%;max-width:600px;background:' + M.surface + ';border:1px solid ' + M.line + ';' +
        'border-radius:16px;overflow:hidden;font-family:' + M.fuente + '">' +

          // Filete de marca: el único bloque rosa lleno del correo.
          '<tr><td style="height:4px;background:' + M.brand + ';line-height:4px;font-size:0">&nbsp;</td></tr>' +

          // Cabecera: logo + de qué sistema viene esto.
          '<tr><td class="m-pad" style="padding:26px 34px 0">' +
            '<img src="' + M.logo + '" width="104" alt="Liverpool" class="m-logo" ' +
            'style="display:block;width:104px;max-width:104px;height:auto;border:0;' +
            'font-family:' + M.fuente + ';font-size:15px;font-weight:700;color:' + M.brand + '">' +
            '<div class="m-t3" style="margin-top:12px;font-size:11px;font-weight:700;letter-spacing:.16em;' +
            'text-transform:uppercase;color:' + M.inkFaint + '">Sistema de cotizaciones Ventel</div>' +
          '</td></tr>' +

          // Estado y título.
          '<tr><td class="m-pad" style="padding:20px 34px 0">' +
            cuentasMailChip(o.chip, o.tono) +
            '<h1 class="m-t1" style="margin:0 0 18px;font-size:25px;line-height:1.25;letter-spacing:-.01em;' +
            'font-weight:700;color:' + M.ink + '">' + secEscapeHtml(o.titulo || '') + '</h1>' +
          '</td></tr>' +

          '<tr><td class="m-pad" style="padding:0 34px 8px">' + (o.cuerpo || '') + '</td></tr>' +

          // Pie.
          '<tr><td class="m-pad m-hair" style="padding:18px 34px 26px;border-top:1px solid ' + M.line + '">' +
            '<p class="m-t3" style="margin:0 0 6px;font-size:12px;line-height:1.6;color:' + M.inkSoft + '">' +
            '<strong style="font-weight:700">Sistema de cotizaciones Ventel</strong> · Liverpool</p>' +
            '<p class="m-t3" style="margin:0;font-size:11px;line-height:1.6;color:' + M.inkSoft + '">' +
            'Correo automático: no respondas a este mensaje. Las horas son del centro de México. ' +
            'Si algo no cuadra, avisa al equipo del sistema.</p>' +
          '</td></tr>' +

        '</table>' +

      '</td></tr>' +
    '</table>' +
  '</body></html>';
}
