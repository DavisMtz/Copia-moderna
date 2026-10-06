/**
 * PERMISOS POR BLOQUES | Portal Ventel en Cloudflare
 * ==================================================
 * Port de Permisos.gs. El modelo es el mismo, palabra por palabra:
 *   rol → concesiones (mas) → retiros (menos) → módulos apagados.
 * Lo que cambia es dónde vive: la hoja «Registros» es la tabla `registros` y la hoja oculta
 * «_PermisosSistema» es `permisos_sistema`. Ya no hay índices cacheados ni números de fila: cada
 * lectura es una consulta por clave primaria y cada escritura un UPSERT.
 */
import type { Ctx } from './contexto';
import { leerPropiedadConfig, fijarPropiedad } from './sistema';
import { esAfirmativo, normalizarTexto } from './util';

export interface Bloque {
  id: string; nombre: string; grupo: string; detalle: string; pagina: string; admin: boolean; fijo: boolean;
}

export const PERM_BLOQUES: Bloque[] = [
  // ── Portal ──
  { id: 'portal', nombre: 'Portal Ventel', grupo: 'Portal',
    detalle: 'Entrar al portal de información y procesos.', pagina: 'portal', admin: false, fijo: true },
  { id: 'promociones', nombre: 'Monitor de promociones', grupo: 'Portal',
    detalle: 'Ver el calendario comercial y las promociones vigentes.', pagina: 'promociones', admin: false, fijo: false },
  // ── Cotizaciones ──
  { id: 'cotizar', nombre: 'Crear cotizaciones', grupo: 'Cotizaciones',
    detalle: 'Armar una cotización nueva y generar su documento.', pagina: 'cotizacion', admin: false, fijo: false },
  { id: 'consultar', nombre: 'Consultar cotizaciones', grupo: 'Cotizaciones',
    detalle: 'Buscar folios y abrir el detalle de una cotización.', pagina: 'consulta_cotizacion', admin: false, fijo: false },
  { id: 'enviar_cotizacion', nombre: 'Enviar cotizaciones', grupo: 'Cotizaciones',
    detalle: 'Mandar la cotización al cliente por correo.', pagina: 'correoventel', admin: false, fijo: false },
  { id: 'correos_cliente', nombre: 'Correos a clientes', grupo: 'Cotizaciones',
    detalle: 'Usar las plantillas de correo y enviarlas a clientes.', pagina: 'correo_cliente', admin: false, fijo: false },
  { id: 'atenciones', nombre: 'Atenciones pendientes', grupo: 'Cotizaciones',
    detalle: 'Guardar los datos de un cliente cuando la plataforma falla y retomar la atención después.', pagina: 'atenciones', admin: false, fijo: false },
  // ── Supervisión ──
  { id: 'supervision', nombre: 'Panel de supervisión', grupo: 'Supervisión',
    detalle: 'Ver métricas del equipo, actividad y ranking de asesores.', pagina: 'inicio_avanzado', admin: false, fijo: false },
  { id: 'revisar', nombre: 'Revisar cotizaciones', grupo: 'Supervisión',
    detalle: 'Aprobar o rechazar las cotizaciones que caen a revisión.', pagina: 'revision_cotizacion', admin: false, fijo: false },
  { id: 'politica_revision', nombre: 'Política de revisión', grupo: 'Supervisión',
    detalle: 'Cambiar las reglas que mandan una cotización a revisión.', pagina: '', admin: false, fijo: false },
  { id: 'trazabilidad', nombre: 'Trazabilidad', grupo: 'Supervisión',
    detalle: 'Consultar el rastro de cambios de las cotizaciones.', pagina: '', admin: false, fijo: false },
  { id: 'anuncios', nombre: 'Anuncios del Portal', grupo: 'Supervisión',
    detalle: 'Publicar y retirar los anuncios que ve todo el equipo.', pagina: 'anuncios', admin: false, fijo: false },
  { id: 'portal_contenido', nombre: 'Contenido del Portal', grupo: 'Supervisión',
    detalle: 'Editar herramientas, plantillas, formatos y promociones del Portal.', pagina: 'portal_contenido', admin: false, fijo: false },
  { id: 'articulos', nombre: 'Publicar artículos', grupo: 'Supervisión',
    detalle: 'Escribir, publicar y retirar los artículos largos del Portal, y ver quién los ha leído.', pagina: 'articulo', admin: false, fijo: false },
  { id: 'operacion', nombre: 'Estado de operación', grupo: 'Supervisión',
    detalle: 'Confirmar, descartar y actualizar las fallas que reporta el equipo.', pagina: 'operacion', admin: false, fijo: false },
  { id: 'metricas', nombre: 'Métricas y monitoreo', grupo: 'Supervisión',
    detalle: 'Consultar las métricas del sistema: cotizaciones, correos enviados, búsquedas y cambios de personas, con descarga en CSV.', pagina: 'consola', admin: false, fijo: false },
  { id: 'sup_equipo', nombre: 'Roles y accesos', grupo: 'Supervisión',
    detalle: 'Entrar a la Consola para dar de alta personas y cambiar su rol y sus accesos. Solo alcanza a quien esté en tu mismo nivel o por debajo, nunca a tu propia cuenta.', pagina: 'consola', admin: false, fijo: false },
  // ── Administración (solo maestros) ──
  { id: 'adm_miembros', nombre: 'Miembros', grupo: 'Administración',
    detalle: 'Dar de alta, dar de baja y cambiar el rol de las personas.', pagina: '', admin: true, fijo: true },
  { id: 'adm_permisos', nombre: 'Permisos por bloque', grupo: 'Administración',
    detalle: 'Conceder o retirar bloques persona por persona.', pagina: '', admin: true, fijo: true },
  { id: 'adm_ajustes', nombre: 'Ajustes del sistema', grupo: 'Administración',
    detalle: 'Modo de autenticación, dominio, webhook e identificadores de hojas.', pagina: '', admin: true, fijo: true },
  { id: 'adm_modulos', nombre: 'Módulos', grupo: 'Administración',
    detalle: 'Apagar y encender bloques enteros por mantenimiento.', pagina: '', admin: true, fijo: true },
  { id: 'adm_formatos', nombre: 'Formatos de cotización', grupo: 'Administración',
    detalle: 'Habilitar formatos y elegir el predeterminado.', pagina: '', admin: true, fijo: true },
  { id: 'adm_salud', nombre: 'Salud del sistema', grupo: 'Administración',
    detalle: 'Correr la revisión maestra y ver qué está roto.', pagina: '', admin: true, fijo: true },
  { id: 'adm_bitacora', nombre: 'Bitácora', grupo: 'Administración',
    detalle: 'Leer quién cambió qué en la consola y cuándo.', pagina: '', admin: true, fijo: true }
];

export const PERM_GRUPOS = ['Portal', 'Cotizaciones', 'Supervisión', 'Administración'];
export const PERM_IDS = PERM_BLOQUES.map((b) => b.id);
export const PERM_IDS_ADMIN = PERM_BLOQUES.filter((b) => b.admin).map((b) => b.id);
export const PERM_IDS_APP = PERM_BLOQUES.filter((b) => !b.admin).map((b) => b.id);

export interface Rol { id: string; nombre: string; detalle: string; orden: number; nivel: number; bloques: string[] }

export const PERM_ROLES: Record<string, Rol> = {
  normal: {
    id: 'normal', nombre: 'Asesor', detalle: 'Cotiza, consulta y envía. Es el rol de cualquier alta nueva.',
    orden: 1, nivel: 1,
    bloques: ['portal', 'promociones', 'cotizar', 'consultar', 'enviar_cotizacion', 'correos_cliente', 'atenciones']
  },
  avanzado: {
    id: 'avanzado', nombre: 'Supervisor',
    detalle: 'Todo lo del asesor, más métricas, revisión de cotizaciones, el contenido del Portal, el estado de operación y la gestión de roles de su nivel hacia abajo desde la Consola.',
    orden: 2, nivel: 2,
    bloques: ['portal', 'promociones', 'cotizar', 'consultar', 'enviar_cotizacion', 'correos_cliente', 'atenciones',
      'supervision', 'revisar', 'politica_revision', 'trazabilidad', 'anuncios', 'portal_contenido',
      'articulos', 'metricas', 'operacion', 'sup_equipo']
  },
  maestro: {
    id: 'maestro', nombre: 'Maestro', detalle: 'Control total del sistema: personas, permisos, ajustes y módulos.',
    orden: 3, nivel: 3, bloques: PERM_IDS.slice()
  }
};

export const PERM_ROLES_ORDEN = ['normal', 'avanzado', 'maestro'];
export const PERM_PROP_MODULOS = 'PERM_MODULOS_OFF';

export interface Ajustes { mas: string[]; menos: string[] }

export interface UsuarioPermisos {
  encontrado: boolean; email: string; nombre: string; rol: string; rolNombre: string; heredado: boolean;
  activo: boolean; avanzado: boolean; maestro: boolean; bloques: string[]; ajustes: Ajustes;
}

// ── Lectura del modelo ──────────────────────────────────────────────────────

export function permNormalizarRol(valor: unknown): string {
  const s = normalizarTexto(valor);
  if (s === 'maestro' || s === 'master' || s === 'admin' || s === 'administrador') return 'maestro';
  if (s === 'avanzado' || s === 'supervisor') return 'avanzado';
  if (s === 'normal' || s === 'asesor' || s === 'basico') return 'normal';
  return '';
}

export function permRolDeFila(valorRol: unknown, avanzado: boolean): string {
  return permNormalizarRol(valorRol) || (avanzado ? 'avanzado' : 'normal');
}

export function permLimpiarAjustes(obj: any): Ajustes {
  const filtrar = (lista: unknown) => {
    const vistos: Record<string, boolean> = {};
    return (Array.isArray(lista) ? lista : []).map((x) => String(x || '').trim()).filter((id) => {
      if (!id || PERM_IDS.indexOf(id) === -1 || vistos[id]) return false;
      vistos[id] = true;
      return true;
    });
  };
  return { mas: filtrar(obj && obj.mas), menos: filtrar(obj && obj.menos) };
}

export function permParsearAjustes(texto: unknown): Ajustes {
  const vacio = { mas: [], menos: [] };
  if (texto && typeof texto === 'object') return permLimpiarAjustes(texto);
  const s = String(texto == null ? '' : texto).trim();
  if (!s) return vacio;
  try {
    const obj = JSON.parse(s);
    if (!obj || typeof obj !== 'object') return vacio;
    return permLimpiarAjustes(obj);
  } catch {
    // Formato de rescate: "mas:revisar,anuncios | menos:cotizar".
    const out: Ajustes = { mas: [], menos: [] };
    s.split('|').forEach((parte) => {
      const trozos = parte.split(':');
      if (trozos.length < 2) return;
      const llave = trozos[0].trim().toLowerCase();
      const lista = trozos[1].split(',').map((x) => x.trim()).filter(Boolean);
      if (llave === 'mas' || llave === 'más') out.mas = lista;
      if (llave === 'menos') out.menos = lista;
    });
    return permLimpiarAjustes(out);
  }
}

export function permSerializarAjustes(ajustes: any): string {
  const limpio = permLimpiarAjustes(ajustes || {});
  if (!limpio.mas.length && !limpio.menos.length) return '';
  return JSON.stringify(limpio);
}

export function permBloquesDeRol(rol: unknown): string[] {
  const def = PERM_ROLES[permNormalizarRol(rol) || 'normal'] || PERM_ROLES.normal;
  return def.bloques.slice();
}

// ── Jerarquía: se alcanza a quien está en tu mismo NIVEL o por debajo ────────

export function permNivelRol(rol: unknown): number {
  const def = PERM_ROLES[permNormalizarRol(rol) || 'normal'];
  return (def && def.nivel) || PERM_ROLES.normal.nivel;
}

export function permNivelUsuario(usuario: { maestro?: boolean; rol?: string } | null): number {
  if (!usuario) return PERM_ROLES.normal.nivel;
  if (usuario.maestro === true) return PERM_ROLES.maestro.nivel;
  return permNivelRol(usuario.rol);
}

export function permEsGestor(usuario: { maestro?: boolean; bloques?: string[] } | null): boolean {
  return !!usuario && (usuario.maestro === true || (usuario.bloques || []).indexOf('sup_equipo') !== -1);
}

export function permRolesAsignables(usuario: any): string[] {
  const techo = permNivelUsuario(usuario);
  return PERM_ROLES_ORDEN.filter((id) => PERM_ROLES[id].nivel <= techo);
}

export function permMismoCorreo(a: unknown, b: unknown): boolean {
  const norm = (x: unknown) => String(x == null ? '' : x).trim().toLowerCase();
  return norm(a) !== '' && norm(a) === norm(b);
}

/** ¿Puede `quien` gestionar a `objetivo`? Devuelve el motivo en cristiano, o '' si sí. */
export function permVetoJerarquia(quien: any, objetivo: any): string {
  if (!permEsGestor(quien)) return 'Tu cuenta no gestiona roles.';
  if (!objetivo || objetivo.encontrado === false) return 'Esa persona no está dada de alta.';
  if (permMismoCorreo(quien.email, objetivo.email)) {
    return 'No puedes cambiar tus propios permisos. Pídeselo a otra persona de tu nivel o a un maestro.';
  }
  const mio = permNivelUsuario(quien);
  const suyo = permNivelUsuario(objetivo);
  if (suyo > mio) {
    const r = PERM_ROLES[permNormalizarRol(objetivo.rol) || 'normal'] || PERM_ROLES.normal;
    return 'Esta persona tiene un nivel superior al tuyo (' + r.nombre + '). Solo alguien de ese nivel o más puede cambiarla.';
  }
  return '';
}

export function permVetoRol(quien: any, rolPedido: unknown): string {
  const rol = permNormalizarRol(rolPedido);
  if (!rol) return 'El rol "' + rolPedido + '" no existe.';
  if (permRolesAsignables(quien).indexOf(rol) === -1) {
    return 'No puedes asignar el rol ' + PERM_ROLES[rol].nombre + ': está por encima de tu nivel.';
  }
  return '';
}

export function permBloquesRepartibles(usuario: any): string[] {
  const bloques: string[] = (usuario && usuario.bloques) || [];
  if (usuario && usuario.maestro === true) return bloques.slice();
  return bloques.filter((id) => PERM_IDS_ADMIN.indexOf(id) === -1);
}

export function permBloque(id: unknown): Bloque | null {
  const clave = String(id || '').trim();
  return PERM_BLOQUES.find((b) => b.id === clave) || null;
}

/** Módulos apagados por mantenimiento. Los `fijo` se ignoran aunque estén en la lista. */
export async function permModulosApagados(ctx: Ctx): Promise<string[]> {
  return ctx.memorizar('perm:apagados', async () => {
    try {
      const crudo = await leerPropiedadConfig(ctx, PERM_PROP_MODULOS);
      if (!crudo) return [];
      const lista = JSON.parse(crudo);
      if (!Array.isArray(lista)) return [];
      return lista.filter((id) => { const b = permBloque(id); return !!b && !b.fijo; });
    } catch {
      return [];
    }
  });
}

export async function permFijarModulosApagados(ctx: Ctx, lista: unknown): Promise<string[]> {
  const limpia = (Array.isArray(lista) ? lista : []).filter((id) => { const b = permBloque(id); return !!b && !b.fijo; });
  await fijarPropiedad(ctx, PERM_PROP_MODULOS, JSON.stringify(limpia));
  ctx.olvidar('perm:');
  return limpia;
}

/** rol → concesiones → retiros → módulos apagados (en el orden del catálogo). */
export function permBloquesEfectivos(rol: unknown, ajustes: unknown, apagados: string[]): string[] {
  const rolFinal = permNormalizarRol(rol) || 'normal';
  const esMaestro = rolFinal === 'maestro';
  const aj = permParsearAjustes(ajustes);
  const tiene: Record<string, boolean> = {};
  permBloquesDeRol(rolFinal).forEach((id) => { tiene[id] = true; });
  aj.mas.forEach((id) => { tiene[id] = true; });
  aj.menos.forEach((id) => { delete tiene[id]; });
  return PERM_IDS.filter((id) => {
    if (!tiene[id]) return false;
    if (PERM_IDS_ADMIN.indexOf(id) !== -1 && !esMaestro) return false;
    if (!esMaestro && apagados.indexOf(id) !== -1) return false;
    return true;
  });
}

export interface FilaRegistro { email: string; nombre: string; avanzado: number; password_hash: string; password_temporal: number; alta: string | null }
export interface FilaPermisos { email: string; rol: string; permisos: string; activo: number; actualizado: string | null; por: string | null }

/** La fila de «Registros» de alguien (memo por petición). */
export function permFilaRegistro(ctx: Ctx, correo: string): Promise<FilaRegistro | null> {
  const email = String(correo || '').trim().toLowerCase();
  if (!email) return Promise.resolve(null);
  return ctx.memorizar('perm:reg:' + email, () =>
    ctx.una<FilaRegistro>('SELECT * FROM registros WHERE email = ?', email));
}

/** La fila de «_PermisosSistema» de alguien (memo por petición). */
export function permFilaPermisos(ctx: Ctx, correo: string): Promise<FilaPermisos | null> {
  const email = String(correo || '').trim().toLowerCase();
  if (!email) return Promise.resolve(null);
  return ctx.memorizar('perm:fila:' + email, () =>
    ctx.una<FilaPermisos>('SELECT * FROM permisos_sistema WHERE email = ?', email));
}

/** Estado completo de permisos de una persona (permUsuario_). */
export async function permUsuario(ctx: Ctx, email: string): Promise<UsuarioPermisos> {
  const correo = String(email || '').trim().toLowerCase();
  const [fila, perm, apagados] = await Promise.all([
    permFilaRegistro(ctx, correo), permFilaPermisos(ctx, correo), permModulosApagados(ctx)
  ]);
  if (!fila) {
    return { encontrado: false, email: correo, nombre: '', rol: 'normal', rolNombre: PERM_ROLES.normal.nombre,
             heredado: false, activo: false, avanzado: false, maestro: false, bloques: [], ajustes: { mas: [], menos: [] } };
  }
  const rol = permRolDeFila(perm ? perm.rol : '', esAfirmativo(fila.avanzado));
  const ajustes = permParsearAjustes(perm ? perm.permisos : '');
  return {
    encontrado: true,
    email: correo,
    nombre: fila.nombre || '',
    rol,
    rolNombre: (PERM_ROLES[rol] || PERM_ROLES.normal).nombre,
    heredado: !(perm && permNormalizarRol(perm.rol)),
    activo: perm ? Number(perm.activo) !== 0 : true,
    avanzado: rol === 'avanzado' || rol === 'maestro',
    maestro: rol === 'maestro',
    bloques: permBloquesEfectivos(rol, ajustes, apagados),
    ajustes
  };
}

export async function permPuede(ctx: Ctx, email: string, bloqueId: string): Promise<boolean> {
  const u = await permUsuario(ctx, email);
  if (!u.encontrado || !u.activo) return false;
  return u.bloques.indexOf(String(bloqueId || '')) !== -1;
}

// ── Escritura ───────────────────────────────────────────────────────────────

/** Escribe (o crea) la fila de permisos. Solo aplica lo que llegue en `valores`. */
export async function permGuardarPermisos(ctx: Ctx, correo: string, valores: { rol?: unknown; permisos?: unknown; activo?: unknown }, quien?: string): Promise<boolean> {
  const email = String(correo || '').trim().toLowerCase();
  if (!email) return false;
  const actual = await ctx.una<FilaPermisos>('SELECT * FROM permisos_sistema WHERE email = ?', email);
  const rol = (valores.rol !== undefined && valores.rol !== null) ? (permNormalizarRol(valores.rol) || 'normal') : (actual ? actual.rol : '');
  const permisos = (valores.permisos !== undefined && valores.permisos !== null) ? String(valores.permisos) : (actual ? actual.permisos : '');
  const activo = (valores.activo !== undefined && valores.activo !== null) ? (esAfirmativo(valores.activo) ? 1 : 0) : (actual ? Number(actual.activo) : 1);
  await ctx.ejecutar(
    'INSERT INTO permisos_sistema (email, rol, permisos, activo, actualizado, por) VALUES (?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(email) DO UPDATE SET rol = excluded.rol, permisos = excluded.permisos, activo = excluded.activo, ' +
    'actualizado = excluded.actualizado, por = excluded.por',
    email, rol, permisos, activo, ctx.ahoraIso(), quien || '');
  ctx.olvidar('perm:');
  return true;
}

/** Borra la fila de permisos de alguien (al eliminar a un miembro). */
export async function permBorrarPermisos(ctx: Ctx, correo: string): Promise<boolean> {
  const email = String(correo || '').trim().toLowerCase();
  if (!email) return false;
  const r = await ctx.ejecutar('DELETE FROM permisos_sistema WHERE email = ?', email);
  ctx.olvidar('perm:');
  return r.cambios > 0;
}

/**
 * permEscribirFila_: reparte cada campo a donde le toca. Rol/Permisos/Activo → permisos_sistema;
 * Nombre → registros. 'Avanzado' ya no se escribe.
 */
export async function permEscribirFila(ctx: Ctx, email: string, campos: Record<string, unknown>, quien?: string): Promise<boolean> {
  const correo = String(email || '').trim().toLowerCase();
  if (!correo) return false;
  if (!(await permFilaRegistro(ctx, correo))) return false;
  const sistema: { rol?: unknown; permisos?: unknown; activo?: unknown } = {};
  let nombre: unknown;
  for (const clave of Object.keys(campos || {})) {
    if (clave === 'Rol') sistema.rol = campos[clave];
    else if (clave === 'Permisos') sistema.permisos = campos[clave];
    else if (clave === 'Activo') sistema.activo = campos[clave];
    else if (clave === 'Nombre') nombre = campos[clave];
  }
  if (Object.keys(sistema).length) await permGuardarPermisos(ctx, correo, sistema, quien);
  if (nombre !== undefined) {
    await ctx.ejecutar('UPDATE registros SET nombre = ? WHERE email = ?', String(nombre || ''), correo);
    ctx.olvidar('perm:');
  }
  return true;
}

// ── Lo que se expone al navegador ───────────────────────────────────────────

export async function permListaMaestros(ctx: Ctx): Promise<string[]> {
  const filas = await ctx.todas<{ email: string; rol: string }>('SELECT email, rol FROM permisos_sistema');
  return filas.filter((f) => permNormalizarRol(f.rol) === 'maestro').map((f) => f.email);
}

export async function permHayMaestro(ctx: Ctx): Promise<boolean> {
  return (await permListaMaestros(ctx)).length > 0;
}

export async function permCatalogo(ctx: Ctx) {
  const apagados = await permModulosApagados(ctx);
  return {
    grupos: PERM_GRUPOS.slice(),
    bloques: PERM_BLOQUES.map((b) => ({ id: b.id, nombre: b.nombre, detalle: b.detalle, grupo: b.grupo,
      pagina: b.pagina, admin: b.admin, fijo: b.fijo, apagado: apagados.indexOf(b.id) !== -1 })),
    roles: PERM_ROLES_ORDEN.map((id) => {
      const r = PERM_ROLES[id];
      return { id: r.id, nombre: r.nombre, detalle: r.detalle, orden: r.orden, nivel: r.nivel, bloques: r.bloques.slice() };
    }),
    apagados
  };
}

export async function permCatalogoPara(ctx: Ctx, usuario: any) {
  const base = await permCatalogo(ctx);
  const repartibles = permBloquesRepartibles(usuario);
  const asignables = permRolesAsignables(usuario);
  return {
    grupos: base.grupos.filter((g) => base.bloques.some((b) => b.grupo === g && repartibles.indexOf(b.id) !== -1)),
    bloques: base.bloques.filter((b) => repartibles.indexOf(b.id) !== -1),
    roles: base.roles.filter((r) => asignables.indexOf(r.id) !== -1).map((r) => ({
      id: r.id, nombre: r.nombre, detalle: r.detalle, orden: r.orden, nivel: r.nivel,
      bloques: r.bloques.filter((b) => repartibles.indexOf(b) !== -1)
    })),
    apagados: base.apagados
  };
}
