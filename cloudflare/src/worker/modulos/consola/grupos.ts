/**
 * GRUPOS DE PERSONAS | Portal Ventel en Cloudflare
 * ================================================
 * Port de Grupos.gs. Un grupo es una lista de personas con nombre, y sirve para dos cosas y ninguna
 * más: copiar sus correos de un clic y elegirlo como destinatario de una difusión.
 *
 * UN GRUPO NO DA PERMISOS. Los permisos son por bloque y por persona (Permisos.gs); una segunda vía
 * convertiría «¿por qué esta persona puede hacer esto?» en dos listas que hay que cruzar.
 *
 * Las membresías van en una columna JSON (tabla `grupos`, columna `miembros`), como en la hoja. El
 * grupo «Ventel» es VIRTUAL: se calcula de `registros` con la gente activa, así que nadie tiene que
 * acordarse de añadir a quien entra al equipo.
 *
 * QUIÉN PUEDE: nivel 2 (supervisor) o superior, no un bloque: 'sup_equipo' se le puede dar a un
 * asesor por excepción y eso no debe hacerle dueño de las listas de correo. El grupo devuelve nombre
 * y correo de sus miembros, NUNCA su rol, su nivel ni sus bloques.
 */
import type { Ctx } from '../../nucleo/contexto';
import { secNormalizarCorreo } from '../../nucleo/seguridad';
import { apuntarBitacora } from '../../nucleo/sistema';
import { aleatorioEntero } from '../../nucleo/cripto';
import { consolaAcceso, consolaPersonas, consolaPersonasPorCorreo, plano, type AccesoOk, type AccesoFallo } from './comun';

const GRP_VENTEL_ID = 'ventel';
/** Nivel mínimo para ver y tocar grupos. 2 = supervisor (PERM_ROLES.avanzado.nivel). */
export const GRP_NIVEL_MINIMO = 2;

// Topes (en la hoja protegían la celda de 50 000 caracteres; se conservan igual).
const GRP_MAX_GRUPOS = 60;
const GRP_MAX_MIEMBROS = 800;
const GRP_MAX_NOMBRE = 60;
const GRP_MAX_DETALLE = 200;

interface GrupoBase {
  id: string; virtual?: boolean; nombre: string; detalle: string; miembros: string[];
  creado: string; creadoPor: string; actualizado: string; actualizadoPor: string;
}
type FilaGrupoD1 = {
  id: string; nombre: string | null; detalle: string | null; miembros: string | null; creado: string | null;
  creado_por: string | null; actualizado: string | null; actualizado_por: string | null;
};

function grpNuevoId(): string {
  return 'grp-' + Date.now().toString(36) + aleatorioEntero(0, 1679615).toString(36);
}

/** grpLimpiarCorreos_: normalizados, sin repetidos y sin huecos, respetando el orden de llegada. */
function grpLimpiarCorreos(lista: unknown): string[] {
  const vistos: Record<string, boolean> = {};
  const out: string[] = [];
  (Array.isArray(lista) ? lista : []).forEach((x) => {
    const correo = secNormalizarCorreo(x);
    if (!correo || vistos[correo]) return;
    vistos[correo] = true;
    out.push(correo);
  });
  return out;
}

/**
 * grpParsearMiembros_: tolera basura igual que permParsearAjustes_. Si el JSON está roto o alguien
 * escribió los correos a mano separados por comas, se recupera lo que se pueda: un grupo vacío se
 * lee como «no hay nadie», y esa respuesta falsa se descubre cuando la difusión no llega a nadie.
 */
function grpParsearMiembros(texto: unknown): string[] {
  const s = String(texto == null ? '' : texto).trim();
  if (!s) return [];
  let lista: unknown[] | null = null;
  try {
    const obj = JSON.parse(s);
    if (Array.isArray(obj)) lista = obj;
    else if (obj && Array.isArray(obj.miembros)) lista = obj.miembros;
  } catch {
    lista = s.split(/[,;\n]/);
  }
  return grpLimpiarCorreos(lista || []);
}

function aGrupo(f: FilaGrupoD1): GrupoBase {
  return {
    id: String(f.id || '').trim(),
    nombre: String(f.nombre || '').trim(),
    detalle: String(f.detalle || '').trim(),
    miembros: grpParsearMiembros(f.miembros),
    creado: f.creado ? String(f.creado) : '',
    creadoPor: String(f.creado_por || ''),
    actualizado: f.actualizado ? String(f.actualizado) : '',
    actualizadoPor: String(f.actualizado_por || '')
  };
}

/** grpLeerFilas_: grupos guardados, en el orden en que se crearon (sin el virtual). */
async function grpLeerFilas(ctx: Ctx): Promise<GrupoBase[]> {
  try {
    const filas = await ctx.todas<FilaGrupoD1>(
      'SELECT id, nombre, detalle, miembros, creado, creado_por, actualizado, actualizado_por FROM grupos ORDER BY rowid');
    return filas.map(aGrupo).filter((g) => g.id);
  } catch (e) {
    console.error('grpLeerFilas', e);
    return [];
  }
}

/** grpVentel_: todas las personas dadas de alta y ACTIVAS (las bajas no reciben el comunicado). */
async function grpVentel(ctx: Ctx): Promise<GrupoBase> {
  const personas = await consolaPersonas(ctx);
  return {
    id: GRP_VENTEL_ID,
    virtual: true,
    nombre: 'Ventel',
    detalle: 'Todas las personas dadas de alta y activas. Se mantiene solo: quien entra al equipo aparece aquí sin que nadie lo añada.',
    miembros: personas.filter((p) => p.activo !== false).map((p) => p.email).sort(),
    creado: '', creadoPor: '', actualizado: '', actualizadoPor: ''
  };
}

/**
 * grpConPersonas_: correos → personas para pintarlos. `alta:false` marca a quien está en la lista
 * pero ya no está dado de alta: se enseña en vez de esconderse.
 */
async function grpConPersonas(ctx: Ctx, correos: string[]): Promise<Array<{ email: string; nombre: string; alta: boolean; activo: boolean }>> {
  const indice = await consolaPersonasPorCorreo(ctx);
  return (correos || []).map((correo) => {
    const p = indice.get(correo);
    return { email: correo, nombre: (p && p.nombre) || '', alta: !!p, activo: !!p && p.activo !== false };
  });
}

/** grpPorId_: un grupo (o el virtual) por su id. `null` si no existe. */
export async function grpPorId(ctx: Ctx, id: unknown): Promise<GrupoBase | null> {
  const clave = String(id == null ? '' : id).trim();
  if (!clave) return null;
  if (clave === GRP_VENTEL_ID) return grpVentel(ctx);
  const f = await ctx.una<FilaGrupoD1>(
    'SELECT id, nombre, detalle, miembros, creado, creado_por, actualizado, actualizado_por FROM grupos WHERE id = ?', clave);
  return f ? aGrupo(f) : null;
}

/**
 * grpCorreosDe_: a quién le llega algo mandado a este grupo (dados de alta y activos). Lo usa la
 * difusión: «a quién le llega» se decide en un solo sitio.
 */
export async function grpCorreosDe(ctx: Ctx, id: unknown): Promise<string[]> {
  const g = await grpPorId(ctx, id);
  if (!g) return [];
  return (await grpConPersonas(ctx, g.miembros)).filter((p) => p.alta && p.activo).map((p) => p.email);
}

/** grpAcceso_: sesión válida, sección Roles de la consola y NIVEL 2 o superior. */
export async function grpAcceso(ctx: Ctx, email: unknown): Promise<AccesoOk | AccesoFallo> {
  const acc = await consolaAcceso(ctx, email, 'roles');
  if (!acc.ok) return { ok: false, error: acc.error };
  if (acc.nivel < GRP_NIVEL_MINIMO) {
    return { ok: false, email: acc.email, nombre: acc.nombre,
             error: 'Los grupos los administra el nivel de supervisión hacia arriba. Tu cuenta gestiona ' +
                    'accesos, pero no las listas de correo del equipo.' };
  }
  return acc;
}

// ── Funciones expuestas ─────────────────────────────────────────────────────

/** Lista de grupos con sus miembros resueltos. El virtual va siempre primero. */
export async function grpListar(ctx: Ctx, email: string) {
  try {
    const acc = await grpAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };

    const todos = [await grpVentel(ctx)].concat(await grpLeerFilas(ctx));
    const salida: Array<Record<string, unknown>> = [];
    for (const g of todos) {
      const personas = await grpConPersonas(ctx, g.miembros);
      salida.push({
        id: g.id,
        virtual: g.virtual === true,
        nombre: g.nombre,
        detalle: g.detalle,
        miembros: personas,
        total: personas.length,
        // Cuántos recibirían de verdad una difusión: «14 personas · 13 reciben correo».
        alcanzables: personas.filter((p) => p.alta && p.activo).length,
        actualizado: g.actualizado,
        actualizadoPor: g.actualizadoPor
      });
    }
    return { success: true, grupos: salida, puedeEditar: true };
  } catch (e) {
    console.error('grpListar', e);
    return { success: false, message: 'No pudimos leer los grupos. Inténtalo de nuevo en un momento.' };
  }
}

/** La lista de vuelta tras escribir, para que la pantalla repinte sin un segundo viaje. */
async function listaDeVuelta(ctx: Ctx, email: string) {
  const r = await grpListar(ctx, email) as { grupos?: unknown[] };
  return r.grupos || [];
}

/**
 * Crea un grupo o cambia su nombre y su descripción. Los miembros van por su propia función:
 * renombrar y repoblar son dos gestos distintos.
 */
export async function grpGuardar(ctx: Ctx, email: string, datos: any) {
  try {
    const acc = await grpAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };

    const d = (datos && typeof datos === 'object') ? datos : {};
    const nombre = String(d.nombre == null ? '' : d.nombre).trim().replace(/\s+/g, ' ');
    const detalle = String(d.detalle == null ? '' : d.detalle).trim().slice(0, GRP_MAX_DETALLE);
    const id = String(d.id == null ? '' : d.id).trim();

    if (nombre.length < 2) return { success: false, message: 'El grupo necesita un nombre de al menos dos letras.' };
    if (nombre.length > GRP_MAX_NOMBRE) {
      return { success: false, message: 'El nombre no puede pasar de ' + GRP_MAX_NOMBRE + ' caracteres.' };
    }
    if (id === GRP_VENTEL_ID) return { success: false, message: '«Ventel» se mantiene solo: es todo el equipo y no se edita.' };
    if (plano(nombre) === plano('Ventel')) return { success: false, message: 'Ese nombre ya lo usa el grupo de todo el equipo.' };

    const filas = await grpLeerFilas(ctx);
    // Nombre único, sin acentos ni mayúsculas: «Coordinación» y «coordinacion» son una trampa.
    const choque = filas.find((g) => g.id !== id && plano(g.nombre) === plano(nombre));
    if (choque) return { success: false, message: 'Ya hay un grupo que se llama «' + choque.nombre + '».' };

    const ahora = ctx.ahoraIso();
    const quien = acc.nombre || acc.email;
    const previo = id ? filas.find((g) => g.id === id) || null : null;
    if (id && !previo) return { success: false, message: 'Ese grupo ya no existe. Actualiza la pantalla.' };

    let resultado: Record<string, unknown>;
    if (previo) {
      // Solo las columnas que este módulo maneja (regla 5 de la casa).
      await ctx.ejecutar('UPDATE grupos SET nombre = ?, detalle = ?, actualizado = ?, actualizado_por = ? WHERE id = ?',
        nombre, detalle, ahora, quien, id);
      await apuntarBitacora(ctx, acc.email, 'Grupo editado', nombre,
        previo.nombre !== nombre ? ('antes «' + previo.nombre + '»') : 'descripción');
      resultado = { success: true, message: 'Grupo «' + nombre + '» guardado.', id };
    } else if (filas.length >= GRP_MAX_GRUPOS) {
      return { success: false, message: 'Ya hay ' + GRP_MAX_GRUPOS + ' grupos. Borra alguno antes de crear otro.' };
    } else {
      const nuevoId = grpNuevoId();
      await ctx.ejecutar(
        'INSERT INTO grupos (id, nombre, detalle, miembros, creado, creado_por, actualizado, actualizado_por) ' +
        "VALUES (?, ?, ?, '[]', ?, ?, ?, ?)", nuevoId, nombre, detalle, ahora, quien, ahora, quien);
      await apuntarBitacora(ctx, acc.email, 'Grupo creado', nombre, detalle || 'sin descripción');
      resultado = { success: true, message: 'Grupo «' + nombre + '» creado.', id: nuevoId };
    }

    resultado.grupos = await listaDeVuelta(ctx, email);
    return resultado;
  } catch (e) {
    console.error('grpGuardar', e);
    return { success: false, message: 'No pudimos guardar el grupo. Inténtalo de nuevo en un momento.' };
  }
}

/** Borra un grupo. El virtual no se puede borrar: no existe como fila. */
export async function grpEliminar(ctx: Ctx, email: string, id: unknown) {
  try {
    const acc = await grpAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };

    const clave = String(id == null ? '' : id).trim();
    if (clave === GRP_VENTEL_ID) {
      return { success: false, message: '«Ventel» no se puede borrar: es la lista de todo el equipo y se calcula sola.' };
    }
    const previo = clave ? await grpPorId(ctx, clave) : null;
    if (!previo) return { success: false, message: 'Ese grupo ya no existe. Actualiza la pantalla.' };

    const r = await ctx.ejecutar('DELETE FROM grupos WHERE id = ?', clave);
    if (!r.cambios) return { success: false, message: 'Ese grupo ya no existe. Actualiza la pantalla.' };
    await apuntarBitacora(ctx, acc.email, 'Grupo borrado', previo.nombre, previo.miembros.length + ' persona(s) en la lista');

    return { success: true, message: 'Grupo «' + previo.nombre + '» borrado.', grupos: await listaDeVuelta(ctx, email) };
  } catch (e) {
    console.error('grpEliminar', e);
    return { success: false, message: 'No pudimos borrar el grupo. Inténtalo de nuevo en un momento.' };
  }
}

/**
 * Fija los miembros de un grupo. Idempotente, y SE FUSIONA, NO SE PISA: con la lista que el cliente
 * veía ANTES de editar (`base`), el servidor aplica solo la diferencia —quién entra y quién sale—
 * sobre lo que hay ahora en la base. Sin `base` se fija la lista tal cual (llamada vieja o a mano).
 *
 * En la hoja la fusión iba dentro de un LockService; aquí la escritura es condicional (solo si los
 * miembros siguen siendo los que se leyeron) y, si otra persona escribió entre medias, se rehace la
 * fusión con lo nuevo. Mismo efecto: dos personas editando el mismo grupo no se pisan.
 */
export async function grpFijarMiembros(ctx: Ctx, email: string, id: unknown, correos: unknown, base?: unknown) {
  try {
    const acc = await grpAcceso(ctx, email);
    if (!acc.ok) return { success: false, message: acc.error };

    const clave = String(id == null ? '' : id).trim();
    if (clave === GRP_VENTEL_ID) {
      return { success: false, message: '«Ventel» se calcula solo: para sacar a alguien, dale de baja en Roles.' };
    }

    const pedidos = grpLimpiarCorreos(correos);
    if (pedidos.length > GRP_MAX_MIEMBROS) {
      return { success: false, message: 'Un grupo no puede pasar de ' + GRP_MAX_MIEMBROS + ' personas.' };
    }

    const indice = await consolaPersonasPorCorreo(ctx);
    const buenos = pedidos.filter((c) => indice.has(c));
    const fuera = pedidos.filter((c) => !indice.has(c));
    const previa = grpLimpiarCorreos(base);
    const conBase = previa.length > 0 || (Array.isArray(base) && base.length === 0);

    for (let intento = 0; intento < 3; intento++) {
      const fila = await ctx.una<{ id: string; nombre: string | null; miembros: string | null }>(
        'SELECT id, nombre, miembros FROM grupos WHERE id = ?', clave);
      if (!fila || !clave) return { success: false, message: 'Ese grupo ya no existe. Actualiza la pantalla.' };
      const actuales = grpParsearMiembros(fila.miembros);
      const nombreGrupo = String(fila.nombre || '').trim();

      let finales = buenos;
      if (conBase) {
        const entran = buenos.filter((x) => previa.indexOf(x) === -1);
        const salen = previa.filter((x) => buenos.indexOf(x) === -1);
        finales = actuales.filter((x) => salen.indexOf(x) === -1)
          .concat(entran.filter((x) => actuales.indexOf(x) === -1));
      }

      /* Veto jerárquico en las ALTAS, no en la lista entera: un supervisor no puede meter en un
         grupo a alguien por encima de su nivel, pero tampoco lo EXPULSA sin querer. La maestra no
         tiene veto. */
      let vetados: string[] = [];
      if (!acc.maestro) {
        vetados = finales.filter((x) => {
          if (actuales.indexOf(x) !== -1) return false;   // ya estaba: no es un alta
          const p = indice.get(x);
          return (p ? p.nivel : 1) > acc.nivel;
        });
        if (vetados.length) finales = finales.filter((x) => vetados.indexOf(x) === -1);
      }

      if (finales.length > GRP_MAX_MIEMBROS) {
        return { success: false, message: 'Un grupo no puede pasar de ' + GRP_MAX_MIEMBROS + ' personas.' };
      }

      const r = await ctx.ejecutar(
        'UPDATE grupos SET miembros = ?, actualizado = ?, actualizado_por = ? WHERE id = ? AND miembros IS ?',
        JSON.stringify(finales), ctx.ahoraIso(), acc.nombre || acc.email, clave, fila.miembros);
      if (!r.cambios) continue;   // alguien escribió entre la lectura y la escritura: se rehace

      const nEntran = finales.filter((x) => actuales.indexOf(x) === -1).length;
      const nSalen = actuales.filter((x) => finales.indexOf(x) === -1).length;
      await apuntarBitacora(ctx, acc.email, 'Miembros de grupo', nombreGrupo,
        'quedan ' + finales.length + (nEntran ? ' · +' + nEntran : '') + (nSalen ? ' · −' + nSalen : ''));

      const avisos: string[] = [];
      if (fuera.length) avisos.push('No se añadieron porque no están dados de alta: ' + fuera.join(', '));
      if (vetados.length) avisos.push('No se añadieron porque están por encima de tu nivel: ' + vetados.join(', '));

      return {
        success: true,
        message: 'Grupo «' + nombreGrupo + '»: ' + finales.length + ' persona(s).',
        aviso: avisos.join(' · '),
        grupos: await listaDeVuelta(ctx, email)
      };
    }
    return { success: false, message: 'Hay otro cambio en curso. Inténtalo en un momento.' };
  } catch (e) {
    console.error('grpFijarMiembros', e);
    return { success: false, message: 'No pudimos guardar los miembros. Inténtalo de nuevo en un momento.' };
  }
}

/** Para la revisión del sistema: cuántos grupos hay y a cuánta gente alcanza «Ventel». */
export async function grpResumenSalud(ctx: Ctx): Promise<{ grupos: number; ventel: number }> {
  const [filas, ventel] = await Promise.all([
    ctx.una<{ n: number }>('SELECT COUNT(*) AS n FROM grupos'), grpVentel(ctx)
  ]);
  return { grupos: Number((filas && filas.n) || 0), ventel: ventel.miembros.length };
}
