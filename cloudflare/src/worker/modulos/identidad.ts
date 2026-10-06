/**
 * IDENTIDAD Y CUENTAS | Portal Ventel en Cloudflare
 * =================================================
 * Funciones del navegador que vienen de Code.gs (loginUser), Permisos.gs (obtenerPermisosSesion,
 * obtenerModulosPublicos), Sesiones.gs (sesTocar, sesCerrar), Cuentas.gs (alta, recuperación,
 * contraseña inicial), Equipo.gs, Preferencias.gs y Onboarding.gs.
 *
 * Cada .gs grande tiene su archivo en modulos/identidad/:
 *   cuentas.ts       Cuentas.gs  (códigos, vales, altas, contraseñas y las plantillas de correo)
 *   preferencias.ts  Preferencias.gs
 *   onboarding.ts    Onboarding.gs
 *   equipo.ts        Equipo.gs   (puente hacia la consola)
 *
 * PARA OTROS MÓDULOS (la consola, sobre todo): todo lo que exporta cuentas.ts se reexporta desde
 * aquí, sin registrarlo. Lo que en Apps Script se usaba desde Consola.gs, Admin.gs y Difusion.gs:
 *   cuentasAltaUsuario(ctx, nombre, correo, passwordHash)      → {success, message}
 *   cuentasActualizarPassword(ctx, correo, passwordHash)       → boolean
 *   cuentasMarcarPasswordTemporal(ctx, correo, esTemporal)     → boolean (nunca lanza)
 *   cuentasPasswordEsTemporal(ctx, correo)                     → boolean
 *   cuentasDominioPermitido(ctx)                               → '' si no hay restricción
 *   consolaPasswordTemporal()                                  → 'ABC-2345-XYZ'
 *   cuentasEnviarAviso(ctx, correo, nombre, textos)
 *   cuentasEnviarCorreo(ctx, para, asunto, html, texto, extra) → remitente usado; LANZA si Brevo rechaza
 *   cuentasPlantillaCorreo · cuentasMailP · cuentasMailDatos · cuentasMailBoton · cuentasMailNota ·
 *   cuentasMailChip · cuentasMailTono · cuentasUrlApp(ctx, pagina) · CUENTAS_MAIL · CUENTAS_PREFIJO
 */
import type { Ctx } from '../nucleo/contexto';
import type { FuncionRpc } from '../rpc';
import {
  secIdentidad, secNormalizarCorreo, secHashContrasena, secComparacionSegura,
  secIntentosRevisar, secIntentosSumar, secIntentosLimpiar
} from '../nucleo/seguridad';
import { permUsuario, PERM_ROLES, PERM_BLOQUES, permModulosApagados } from '../nucleo/permisos';
import { sesParaCliente, sesTocar, sesCerrar } from '../nucleo/sesiones';
import {
  emitirValeInicial, solicitarCodigoRegistro, confirmarCodigoRegistro, solicitarCodigoRecuperacion,
  confirmarCodigoRecuperacion, restablecerContrasena, establecerPasswordInicial
} from './identidad/cuentas';
import { prefsLeer, prefsGuardar, prefsRestablecer } from './identidad/preferencias';
import { onbEstado, onbMarcar, onbReiniciar } from './identidad/onboarding';
import { equipoPanorama, equipoGuardarMiembro } from './identidad/equipo';

export * from './identidad/cuentas';
export * from './identidad/preferencias';
export * from './identidad/onboarding';
export * from './identidad/equipo';

const LOGIN_MAX_INTENTOS = 8;
const LOGIN_VENTANA_SEGUNDOS = 900;

// ── Permisos.gs ─────────────────────────────────────────────────────────────

export async function obtenerPermisosSesion(ctx: Ctx, emailCliente?: string) {
  try {
    const id = await secIdentidad(ctx, emailCliente);
    if (!id.ok) {
      return { success: false, rol: 'normal', rolNombre: '', maestro: false, avanzado: false,
               bloques: [], nombre: '', activo: false, message: id.error };
    }
    return { success: true, rol: id.rol, rolNombre: (PERM_ROLES[id.rol] || PERM_ROLES.normal).nombre,
             maestro: id.maestro, avanzado: id.avanzado, bloques: id.bloques || [], nombre: id.nombre || '',
             activo: true, message: '' };
  } catch (e: any) {
    return { success: false, rol: 'normal', rolNombre: '', maestro: false, avanzado: false,
             bloques: [], nombre: '', activo: true, message: e.message };
  }
}

export async function obtenerModulosPublicos(ctx: Ctx) {
  try {
    const apagados = await permModulosApagados(ctx);
    const nombres: Record<string, string> = {};
    PERM_BLOQUES.forEach((b) => { if (apagados.indexOf(b.id) !== -1) nombres[b.id] = b.nombre; });
    return { success: true, apagados, nombres };
  } catch {
    return { success: false, apagados: [], nombres: {} };
  }
}

// ── Code.gs · loginUser ─────────────────────────────────────────────────────

export async function loginUser(ctx: Ctx, email: string, password: string) {
  try {
    const correo = secNormalizarCorreo(email);
    if (!correo || !password) return { success: false, message: 'Correo o contraseña incorrectos.' };

    const bloqueo = await secIntentosRevisar(ctx, correo, LOGIN_MAX_INTENTOS);
    if (bloqueo.bloqueado) {
      return { success: false, message: 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.' };
    }

    const fila = await ctx.una<{ email: string; nombre: string; password_hash: string; password_temporal: number }>(
      'SELECT email, nombre, password_hash, password_temporal FROM registros WHERE email = ?', correo);
    if (!fila) {
      await secIntentosSumar(ctx, correo, LOGIN_VENTANA_SEGUNDOS);
      return { success: false, message: 'Correo o contraseña incorrectos.' };
    }

    const hash = await secHashContrasena(ctx, password);
    if (!secComparacionSegura(hash, String(fila.password_hash || '').trim())) {
      await secIntentosSumar(ctx, correo, LOGIN_VENTANA_SEGUNDOS);
      return { success: false, message: 'Correo o contraseña incorrectos.' };
    }

    const permisos = await permUsuario(ctx, correo);
    if (permisos.activo === false) {
      return { success: false, message: 'Tu cuenta está dada de baja. Pide al administrador que la reactive.' };
    }
    await secIntentosLimpiar(ctx, correo);

    // CONTRASEÑA TEMPORAL: la credencial es correcta pero no abre sesión; se entrega un vale de
    // un solo uso con el que la pantalla pide la contraseña definitiva (establecerPasswordInicial).
    if (Number(fila.password_temporal) === 1) {
      try {
        const vale = await emitirValeInicial(ctx, correo);
        return {
          success: true, debeCambiarPassword: true,
          message: 'Entraste con una contraseña temporal. Elige la tuya para continuar.',
          userName: fila.nombre, userEmail: correo, vale: vale.vale, expiraSegundos: vale.expiraSegundos
        };
      } catch (e) {
        console.error('No se pudo emitir el vale de contraseña inicial', e);
      }
    }

    let sesionNueva;
    try {
      sesionNueva = await sesParaCliente(ctx, correo);
    } catch {
      return { success: false, message: 'No pudimos abrir tu sesión. Inténtalo de nuevo en un momento.' };
    }

    return {
      success: true,
      message: 'Inicio de sesión exitoso.',
      userName: fila.nombre,
      userEmail: correo,
      llave: sesionNueva.llave,
      inactividadMin: sesionNueva.inactividadMin,
      isAdvanced: permisos.avanzado,
      rol: permisos.rol,
      rolNombre: permisos.rolNombre || '',
      isMaster: permisos.maestro === true,
      bloques: permisos.bloques || []
    };
  } catch (error: any) {
    console.error('loginUser', error);
    return { success: false, message: 'No pudimos iniciar tu sesión en este momento. Inténtalo de nuevo en un minuto.' };
  }
}

// emitirValeInicial(ctx, correo) → {vale, expiraSegundos}: el vale de contraseña inicial (propósito
// 'inicial', CUENTAS_VALE_MINUTOS) vive en identidad/cuentas.ts y se reexporta desde aquí.

// ── Registro de funciones expuestas al navegador ────────────────────────────

export const funciones: Record<string, FuncionRpc> = {
  // Code.gs · Permisos.gs · Sesiones.gs
  loginUser,
  obtenerPermisosSesion,
  obtenerModulosPublicos,
  sesTocar,
  sesCerrar,
  // Cuentas.gs (pantallas registro, recuperar e inicio de sesión: se llaman SIN sesión)
  solicitarCodigoRegistro,
  confirmarCodigoRegistro,
  solicitarCodigoRecuperacion,
  confirmarCodigoRecuperacion,
  restablecerContrasena,
  establecerPasswordInicial,
  // Equipo.gs (puente hacia la consola)
  equipoPanorama,
  equipoGuardarMiembro,
  // Preferencias.gs
  prefsLeer,
  prefsGuardar,
  prefsRestablecer,
  // Onboarding.gs
  onbEstado,
  onbMarcar,
  onbReiniciar
};
