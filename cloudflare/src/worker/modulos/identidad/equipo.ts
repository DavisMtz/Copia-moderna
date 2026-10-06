/**
 * GESTIÓN DEL EQUIPO · COMPATIBILIDAD | Portal Ventel en Cloudflare
 * =================================================================
 * Port de Equipo.gs. Este archivo YA NO decide nada: es un puente hacia la Consola, el único sitio
 * donde se gestionan roles y accesos (la regla de jerarquía vive en nucleo/permisos.ts). Se
 * conserva porque el buscador de la barra de comandos (app_comando.html) sigue pidiendo
 * `equipoPanorama` para encontrar personas del equipo.
 *
 * En Apps Script llamaba a la función GLOBAL consolaPanorama. Aquí la «global» es la que esté
 * registrada en REGISTRO (la implementa el módulo de la consola). Mientras esa función no exista,
 * se usa una versión local mínima con la misma puerta y la misma lista que la consola
 * (consolaAcceso_ + consolaListaMiembros_ + permCatalogoPara_), para que el buscador funcione igual.
 */
import type { Ctx } from '../../nucleo/contexto';
import type { FuncionRpc } from '../../rpc';
import { REGISTRO } from '../indice';
import { secIdentidad } from '../../nucleo/seguridad';
import {
  permUsuario, permNivelUsuario, permVetoJerarquia, permMismoCorreo, permCatalogoPara, type UsuarioPermisos
} from '../../nucleo/permisos';

/** La función del navegador registrada con ese nombre por otro módulo (las «globales» de Apps Script). */
function funcionGlobal(nombre: string): FuncionRpc | null {
  return Object.prototype.hasOwnProperty.call(REGISTRO, nombre) ? REGISTRO[nombre] : null;
}

// ── Versión local mínima de la consola (solo lo que equipoPanorama devuelve) ─

/** Secciones de la consola con contenido propio y los bloques que las abren (CONSOLA_SECCIONES). */
const SECCIONES_CONSOLA: Array<{ id: string; bloques: string[] }> = [
  { id: 'roles',    bloques: ['adm_miembros', 'adm_permisos', 'sup_equipo'] },
  { id: 'modulos',  bloques: ['adm_modulos'] },
  { id: 'ajustes',  bloques: ['adm_ajustes'] },
  { id: 'formatos', bloques: ['adm_formatos'] },
  { id: 'salud',    bloques: ['adm_salud'] },
  { id: 'bitacora', bloques: ['adm_bitacora', 'sup_equipo'] },
  { id: 'metricas', bloques: ['metricas'] }
];

/** consolaListaMiembros_: miembros con rol y bloques resueltos, recortados por jerarquía. Sin hashes. */
async function equipoListaMiembros(ctx: Ctx, quien: UsuarioPermisos) {
  const filas = await ctx.todas<{ email: string; nombre: string; alta: string | null }>(
    'SELECT email, nombre, alta FROM registros');
  const miNivel = permNivelUsuario(quien);

  const miembros = await Promise.all(filas.map(async (fila) => {
    const correo = String(fila.email || '').trim().toLowerCase();
    const u = await permUsuario(ctx, correo);
    const veto = permVetoJerarquia(quien, u);
    return {
      email: correo,
      nombre: u.nombre || fila.nombre || '',
      rol: u.rol,
      rolNombre: u.rolNombre,
      nivel: permNivelUsuario(u),
      activo: u.activo,
      heredado: u.heredado === true,
      ajustes: u.ajustes,
      bloques: u.bloques,
      // Las filas que no se pueden tocar se pintan igual, con el motivo.
      gestionable: veto === '',
      motivo: veto,
      alta: String(fila.alta || ''),
      fila: 0   // en la hoja era el número de renglón; en D1 no hay renglones
    };
  }));

  return miembros
    // Por encima de tu nivel no se ve ni existe (la propia fila siempre se ve).
    .filter((m) => m.nivel <= miNivel || permMismoCorreo(m.email, quien && quien.email))
    // Primero por poder, luego alfabético.
    .sort((a, b) => (a.nivel !== b.nivel) ? b.nivel - a.nivel
      : (a.nombre || a.email).localeCompare(b.nombre || b.email, 'es'));
}

/** Lo que consolaPanorama devolvería para estos tres campos (yo, catalogo, miembros). */
async function equipoPanoramaLocal(ctx: Ctx, email: string) {
  try {
    const id = await secIdentidad(ctx, email);
    if (!id.ok) return { success: false, message: id.error || 'Tu sesión no es válida.' };

    const yo = await permUsuario(ctx, id.email);
    const secciones = SECCIONES_CONSOLA
      .filter((s) => s.bloques.some((b) => (yo.bloques || []).indexOf(b) !== -1))
      .map((s) => s.id);
    // 'resumen' se le abre a cualquiera: quien entra tiene que traer al menos una sección con fondo.
    if (!secciones.length) return { success: false, message: 'Tu cuenta no tiene acceso a la Consola.' };

    return {
      success: true,
      yo: {
        email: yo.email, nombre: yo.nombre, rol: yo.rol, rolNombre: yo.rolNombre,
        bloques: yo.bloques, maestro: yo.maestro === true, nivel: permNivelUsuario(yo)
      },
      catalogo: await permCatalogoPara(ctx, yo),
      miembros: secciones.indexOf('roles') !== -1 ? await equipoListaMiembros(ctx, yo) : []
    };
  } catch (e) {
    console.error('equipoPanorama (versión local)', e);
    return { success: false, message: 'No pudimos cargar la consola. Inténtalo de nuevo en un momento.' };
  }
}

// ── Lo que se expone al navegador ───────────────────────────────────────────

/**
 * @deprecated en el original: usa consolaPanorama. Se traduce la respuesta a la forma que esperaba
 * el panel avanzado (y que hoy usa el buscador de personas de la barra de comandos).
 */
export async function equipoPanorama(ctx: Ctx, email: string) {
  const consolaPanorama = funcionGlobal('consolaPanorama');
  const r: any = consolaPanorama ? await consolaPanorama(ctx, email) : await equipoPanoramaLocal(ctx, email);
  if (!r || !r.success) return r || { success: false, message: 'No pudimos cargar tu equipo.' };
  return {
    success: true,
    yo: r.yo,
    // El panel viejo llamaba "asesores" a la lista de personas; la consola la llama "miembros".
    // Ya viene recortada por jerarquía desde el servidor.
    asesores: r.miembros,
    catalogo: r.catalogo,
    message: '',
    // Señal para el cliente nuevo: esta pantalla se mudó a la consola.
    movidoA: 'consola'
  };
}

/** @deprecated en el original: usa consolaGuardarMiembro, que es quien aplica la jerarquía. */
export async function equipoGuardarMiembro(ctx: Ctx, email: string, cambio: unknown) {
  const consolaGuardarMiembro = funcionGlobal('consolaGuardarMiembro');
  // Sin la consola no hay quién aplique la jerarquía: no se guarda nada (consolaError_ por omisión).
  if (!consolaGuardarMiembro) return { success: false, message: 'No se pudo completar la operación.' };
  const r: any = await consolaGuardarMiembro(ctx, email, cambio);
  if (r && r.success) {
    const panorama: any = await equipoPanorama(ctx, email);
    if (panorama && panorama.success) {
      panorama.message = r.message;
      return panorama;
    }
  }
  return r;
}
