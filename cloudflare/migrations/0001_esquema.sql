-- =================================================================================================
-- Portal Ventel · esquema D1 (SQL) que sustituye a las hojas de Google Sheets.
-- =================================================================================================
-- Una tabla por pestaña, con el mismo contenido que describe Documentacion/04_BaseDeDatos_y_Hojas.md.
-- Convenciones (las usa todo src/worker):
--   · Nombres en snake_case sin acentos; en el comentario de cada columna va el encabezado de la hoja.
--   · Fecha y hora: TEXT ISO-8601 en UTC con milisegundos ('2026-10-06T20:14:17.461Z'), lo que da
--     new Date().toISOString(). Ordenan bien como texto. Solo-fecha: 'AAAA-MM-DD'.
--   · Sí/No de la hoja: INTEGER 0/1. Listas y objetos que en la hoja iban como JSON en una celda: TEXT
--     con JSON.
--   · OJO: D1 recibe los números de JavaScript como REAL. En una columna TEXT, un 1 queda '1.0' y un
--     teléfono '5512345678.0': a una columna TEXT se le pasa siempre texto (String(n)).
--   · Las tablas del Portal guardan además `orden` (la posición de la fila en la hoja), porque el
--     Portal y su editor respetan ese orden.
-- =================================================================================================

-- ── Sistema (lo que en Apps Script eran PropertiesService, CacheService y LockService) ──────────

-- Propiedades del script: configuración, interruptores y registros pequeños con prefijo (cta_, rev_…).
CREATE TABLE propiedades (
  clave        TEXT PRIMARY KEY,
  valor        TEXT NOT NULL,
  actualizado  TEXT NOT NULL
);

-- Caché con caducidad (contadores de intentos, marcas de «ya avisé», etc.). `expira` en ms.
CREATE TABLE cache (
  clave   TEXT PRIMARY KEY,
  valor   TEXT NOT NULL,
  expira  INTEGER NOT NULL
);
CREATE INDEX cache_expira ON cache (expira);

-- Contadores atómicos (folios LVP-AAMMDD-XXXX, generaciones de caché…).
CREATE TABLE contadores (
  clave  TEXT PRIMARY KEY,
  valor  INTEGER NOT NULL
);

-- Sesiones (Sesiones.gs). Se guarda la HUELLA de la llave, nunca la llave. Tiempos en ms.
CREATE TABLE sesiones (
  huella   TEXT PRIMARY KEY,
  email    TEXT NOT NULL,
  ultima   INTEGER NOT NULL,   -- última actividad de la persona
  inicio   INTEGER NOT NULL
);
CREATE INDEX sesiones_email ON sesiones (email);
CREATE INDEX sesiones_ultima ON sesiones (ultima);

-- Bandeja de salida: en esta versión los correos NO salen (no hay Gmail). Quedan aquí, completos,
-- para enseñarlos en la demo y en el explorador de datos.
CREATE TABLE correos_salida (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha       TEXT NOT NULL,
  de          TEXT,
  nombre_de   TEXT,
  responder_a TEXT,
  para        TEXT,
  cc          TEXT,
  cco         TEXT,
  asunto      TEXT,
  html        TEXT,
  texto       TEXT,
  adjuntos    TEXT,   -- JSON [{nombre, tipo, bytes}] (solo metadatos)
  tipo        TEXT,   -- 'cotizacion', 'plantilla', 'difusion', 'cuenta', 'revision'…
  referencia  TEXT
);
CREATE INDEX correos_salida_fecha ON correos_salida (fecha);

-- Archivos subidos (imágenes de anuncios y artículos, evidencias): el binario va a R2.
CREATE TABLE archivos (
  clave       TEXT PRIMARY KEY,  -- clave del objeto en R2
  nombre      TEXT,
  tipo        TEXT,
  bytes       INTEGER,
  carpeta     TEXT,
  subido_por  TEXT,
  fecha       TEXT NOT NULL
);

-- ── Libro 1 · BD Cotizaciones ───────────────────────────────────────────────────────────────────

-- «Registros»: las personas. El correo es la clave de todo el sistema (en minúsculas).
CREATE TABLE registros (
  email              TEXT PRIMARY KEY,   -- Email
  nombre             TEXT NOT NULL DEFAULT '',  -- Nombre
  password_hash      TEXT NOT NULL DEFAULT '',  -- PasswordHash (SHA-256 con sal, hex)
  avanzado           INTEGER NOT NULL DEFAULT 0, -- Avanzado (interruptor heredado)
  password_temporal  INTEGER NOT NULL DEFAULT 0, -- PasswordTemporal
  alta               TEXT                        -- Timestamp / Fecha de alta
);

-- «_PermisosSistema» (oculta): rol y ajustes por persona.
CREATE TABLE permisos_sistema (
  email        TEXT PRIMARY KEY,   -- Email
  rol          TEXT NOT NULL DEFAULT '',   -- Rol: normal | avanzado | maestro
  permisos     TEXT NOT NULL DEFAULT '',   -- Permisos: JSON {"mas":[…],"menos":[…]}
  activo       INTEGER NOT NULL DEFAULT 1, -- Activo
  actualizado  TEXT,                        -- Actualizado
  por          TEXT                         -- Por
);

-- «_PreferenciasUsuario»: una línea por persona.
CREATE TABLE preferencias_usuario (
  email         TEXT PRIMARY KEY,
  preferencias  TEXT NOT NULL DEFAULT '{}',  -- JSON
  version       INTEGER NOT NULL DEFAULT 0,
  actualizado   TEXT
);

-- «BitacoraConsola»: quién cambió qué en la consola.
CREATE TABLE bitacora_consola (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha     TEXT NOT NULL,
  quien     TEXT,
  accion    TEXT,
  objetivo  TEXT,
  detalle   TEXT
);
CREATE INDEX bitacora_consola_fecha ON bitacora_consola (fecha);

-- «MetricasCorreos»: fuente única de métricas de los tres canales de correo.
CREATE TABLE metricas_correos (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha                 TEXT NOT NULL,
  tipo                  TEXT,
  referencia            TEXT,
  asesor_email          TEXT,
  asesor_nombre         TEXT,
  para                  TEXT,
  destinatarios         INTEGER,
  cc                    INTEGER,   -- cuántos en copia (el original escribe el número)
  cco                   INTEGER,   -- cuántos en copia oculta
  asunto                TEXT,
  adjuntos              INTEGER,   -- cuántos adjuntos
  remitente             TEXT,
  alias_usado           TEXT,
  resultado             TEXT,
  detalle               TEXT,
  plantilla_modificada  TEXT
);
CREATE INDEX metricas_correos_fecha ON metricas_correos (fecha);
CREATE INDEX metricas_correos_asesor ON metricas_correos (asesor_email);

-- «MetricasBusquedas»: qué busca el equipo.
CREATE TABLE metricas_busquedas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha       TEXT NOT NULL,
  termino     TEXT,
  quien       TEXT,
  nombre      TEXT,
  origen      TEXT,
  resultados  INTEGER
);
CREATE INDEX metricas_busquedas_fecha ON metricas_busquedas (fecha);

-- «Grupos»: listas de personas (no dan permisos). El grupo «Ventel» es virtual (sale de registros).
CREATE TABLE grupos (
  id               TEXT PRIMARY KEY,
  nombre           TEXT NOT NULL,
  detalle          TEXT,
  miembros         TEXT NOT NULL DEFAULT '[]',  -- Miembros (JSON)
  creado           TEXT,
  creado_por       TEXT,
  actualizado      TEXT,
  actualizado_por  TEXT
);

-- «CorreosEnviados»: bitácora de plantillas enviadas a clientes.
CREATE TABLE correos_enviados (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha      TEXT NOT NULL,
  plantilla  TEXT,
  para       TEXT,
  cc         TEXT,
  cco        TEXT,
  asunto     TEXT,
  asesor     TEXT,
  remitente  TEXT,
  adjuntos   TEXT
);

-- «Onboarding»: qué tutorial vio cada persona.
CREATE TABLE onboarding (
  correo       TEXT NOT NULL,
  pantalla     TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  estado       TEXT,
  paso_final   INTEGER,
  total_pasos  INTEGER,
  actualizado  TEXT,
  PRIMARY KEY (correo, pantalla)
);

-- «Cotizaciones»: cabecera de cada cotización.
CREATE TABLE cotizaciones (
  folio               TEXT PRIMARY KEY,   -- Folio (LVP-AAMMDD-XXXX)
  timestamp           TEXT,               -- Timestamp: último guardado
  fecha_envio         TEXT,               -- FechaEnvio: último envío por correo
  asesor_correo       TEXT,               -- AsesorCorreo
  asesor_nombre       TEXT,               -- AsesorNombre
  extencion           TEXT,               -- Extencion (así se llama la columna)
  cliente_nombre      TEXT,               -- ClienteNombre
  correo_cliente      TEXT,               -- CorreoCliente
  numero              TEXT,               -- Numero (teléfono del cliente)
  subtotal            REAL NOT NULL DEFAULT 0,  -- Subtotal
  iva                 REAL NOT NULL DEFAULT 0,  -- IVA
  total_general       REAL NOT NULL DEFAULT 0,  -- TotalGeneral
  estatus             TEXT,               -- Estatus
  observaciones       TEXT,               -- Observaciones
  formato             TEXT,               -- Formato
  link_pdf            TEXT,               -- LinkPDF
  link_sheet_ccl      TEXT,               -- LinkSheetCCL
  revision_estado     TEXT,               -- RevisionEstado
  revisado_por        TEXT,               -- RevisadoPor
  revisado_nombre     TEXT,               -- RevisadoNombre
  revision_fecha      TEXT,               -- RevisionFecha
  revision_notas      TEXT,               -- RevisionNotas
  revision_checklist  TEXT                -- RevisionChecklist (JSON)
);
CREATE INDEX cotizaciones_asesor ON cotizaciones (asesor_correo, timestamp);
CREATE INDEX cotizaciones_timestamp ON cotizaciones (timestamp);
CREATE INDEX cotizaciones_estatus ON cotizaciones (estatus);
CREATE INDEX cotizaciones_revision ON cotizaciones (revision_estado);

-- «DetalleCotizaciones»: las partidas. Al reguardar, las de un folio se borran y se reescriben.
CREATE TABLE detalle_cotizaciones (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  folio_cotizacion           TEXT NOT NULL,      -- FolioCotizacion
  orden                      INTEGER NOT NULL DEFAULT 0,
  sku                        TEXT,               -- SKU
  descripcion_producto       TEXT,               -- DescripcionProducto
  cantidad                   INTEGER NOT NULL DEFAULT 0,  -- Cantidad
  precio_unitario_base       REAL NOT NULL DEFAULT 0,     -- PrecioUnitarioBase
  costo_pago_unico_linea     REAL NOT NULL DEFAULT 0,     -- CostoPagoUnicoLinea
  desc_publico_porcentaje    REAL NOT NULL DEFAULT 0,     -- DescPublicoPorcentaje
  aplica_desc_adicional      TEXT NOT NULL DEFAULT 'No',  -- AplicaDescAdicional ('Si'/'No')
  porcentaje_desc_adicional  REAL NOT NULL DEFAULT 0,     -- PorcentajeDescAdicional
  imagen_url                 TEXT,               -- ImagenUrl
  link_articulo              TEXT                -- LinkArticulo
);
CREATE INDEX detalle_cotizaciones_folio ON detalle_cotizaciones (folio_cotizacion, orden);

-- «AtencionesPendientes»: datos personales de clientes (la tabla más sensible).
CREATE TABLE atenciones_pendientes (
  id             TEXT PRIMARY KEY,
  fecha          TEXT NOT NULL,
  asesor         TEXT,
  asesor_nombre  TEXT,
  cliente        TEXT,
  telefono       TEXT,
  correo         TEXT,
  tipo           TEXT,
  notas          TEXT,
  hora_promesa   TEXT,
  liberar_en     TEXT,
  estado         TEXT,
  rescatada_por  TEXT,
  rescatada_en   TEXT,
  cerrada_por    TEXT,
  cerrada_en     TEXT,
  resultado      TEXT
);
CREATE INDEX atenciones_asesor ON atenciones_pendientes (asesor, estado);
CREATE INDEX atenciones_estado ON atenciones_pendientes (estado, liberar_en);

-- «AtencionesTipos»: catálogo que se alimenta solo.
CREATE TABLE atenciones_tipos (
  clave   TEXT PRIMARY KEY,
  tipo    TEXT NOT NULL,
  usos    INTEGER NOT NULL DEFAULT 0,
  creado  TEXT,
  por     TEXT
);

-- «OperacionReportes»: cada aviso individual de un asesor.
CREATE TABLE operacion_reportes (
  id               TEXT PRIMARY KEY,
  fecha            TEXT NOT NULL,
  correo           TEXT,
  nombre           TEXT,
  sistema          TEXT,
  sistema_clave    TEXT,
  submotivo        TEXT,
  submotivo_clave  TEXT,
  notas            TEXT,
  evidencias       TEXT,   -- JSON
  incidente_id     TEXT,
  estado           TEXT
);
CREATE INDEX operacion_reportes_fecha ON operacion_reportes (fecha);
CREATE INDEX operacion_reportes_incidente ON operacion_reportes (incidente_id);

-- «OperacionIncidentes»: la falla agregada.
CREATE TABLE operacion_incidentes (
  id                 TEXT PRIMARY KEY,
  clave              TEXT,
  sistema            TEXT,
  sistema_clave      TEXT,
  submotivo          TEXT,
  estado             TEXT,
  titulo             TEXT,
  detalle            TEXT,
  creado             TEXT,
  creado_por         TEXT,
  creado_nombre      TEXT,
  confirmado         TEXT,
  confirmado_por     TEXT,
  confirmado_nombre  TEXT,
  actualizado        TEXT,
  actualizado_por    TEXT,
  cerrado            TEXT,
  origen             TEXT
);
CREATE INDEX operacion_incidentes_estado ON operacion_incidentes (estado, creado);

-- «OperacionActualizaciones»: historial de una incidencia.
CREATE TABLE operacion_actualizaciones (
  id            TEXT PRIMARY KEY,
  incidente_id  TEXT NOT NULL,
  fecha         TEXT NOT NULL,
  autor         TEXT,
  autor_nombre  TEXT,
  estado        TEXT,
  nota          TEXT,
  aviso         TEXT
);
CREATE INDEX operacion_actualizaciones_incidente ON operacion_actualizaciones (incidente_id, fecha);

-- «OperacionCatalogo»: sistemas, motivos y estados (también se alimenta con el uso).
CREATE TABLE operacion_catalogo (
  tipo           TEXT NOT NULL,   -- 'sistema' | 'submotivo' | 'estado'…
  sistema_clave  TEXT NOT NULL DEFAULT '',
  valor          TEXT NOT NULL,
  clave          TEXT NOT NULL,
  tono           TEXT,
  creado         TEXT,
  creado_por     TEXT,
  activo         INTEGER NOT NULL DEFAULT 1,
  usos           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tipo, sistema_clave, clave)
);

-- ── Libro 2 · Hoja del Portal ───────────────────────────────────────────────────────────────────
-- Cada colección de PortalContenido.gs (PC_COLECCIONES) es una tabla; sus `campos` son columnas.

CREATE TABLE portal_herramientas (
  id            TEXT PRIMARY KEY,   -- ID (htl-…)
  orden         INTEGER NOT NULL,
  nombre        TEXT NOT NULL,      -- Nombre
  enlace        TEXT,               -- Enlace
  como_acceder  TEXT,               -- Como acceder (en la demo va vacío: llevaba contraseñas)
  descripcion   TEXT,               -- Descripcion
  claves        TEXT                -- Claves
);

CREATE TABLE portal_plantillas (
  id               TEXT PRIMARY KEY,  -- ID (plt-…)
  orden            INTEGER NOT NULL,
  titulo           TEXT NOT NULL,     -- Titulo
  tipo             TEXT,              -- Tipo
  asunto           TEXT,              -- Asunto
  cuerpo           TEXT,              -- Cuerpo
  consideraciones  TEXT               -- Consideraciones
);

CREATE TABLE portal_formatos (
  id             TEXT PRIMARY KEY,   -- ID (fmt-…)
  orden          INTEGER NOT NULL,
  acceso         TEXT NOT NULL,      -- ACCESO
  observaciones  TEXT,               -- OBSERVACIONES
  liga           TEXT                -- LIGA
);

CREATE TABLE portal_presentaciones (
  id           TEXT PRIMARY KEY,   -- ID (prs-…)
  orden        INTEGER NOT NULL,
  nombre       TEXT NOT NULL,      -- Nombre
  liga         TEXT,               -- LIGA
  descripcion  TEXT                -- DESCRPCION (así, sin la i)
);

CREATE TABLE portal_paqueterias (
  id      TEXT PRIMARY KEY,   -- ID (pqt-…)
  orden   INTEGER NOT NULL,
  nombre  TEXT NOT NULL,      -- Nombre
  liga    TEXT,               -- Liga
  soms    TEXT                -- Soms
);

CREATE TABLE portal_pdepago (
  id        TEXT PRIMARY KEY,   -- ID (pdp-…)
  orden     INTEGER NOT NULL,
  nombre    TEXT NOT NULL,      -- Nombre
  detalles  TEXT,               -- Detalles
  liga      TEXT                -- Liga
);

-- «Promociones»: la hoja tiene columnas que la app no toca; se conservan.
CREATE TABLE portal_promociones (
  id            TEXT PRIMARY KEY,   -- ID (pro-…)
  orden         INTEGER NOT NULL,
  direccion     TEXT,               -- Direccion
  categoria     TEXT,               -- Banner / Carrusel
  promocion     TEXT,               -- Promoción 2026
  promocion_aa  TEXT,               -- Promoción AA 2025 (referencia)
  desc_mkp      TEXT,               -- Desc Mkp
  banners_home  TEXT,               -- BANNERS HOME
  marca         TEXT,               -- Marca
  vigencia      TEXT,               -- Vigencia
  liga          TEXT,               -- Liga
  skus          TEXT,               -- SKUS Mercaderías
  num_skus      TEXT                -- #skus
);

-- «MKP»: lo mismo que Promociones, de Marketplace.
CREATE TABLE portal_mkp (
  id             TEXT PRIMARY KEY,   -- ID (mkp-…)
  orden          INTEGER NOT NULL,
  direccion      TEXT,               -- Dirección
  categoria      TEXT,               -- Banner / Carrusel
  promocion      TEXT,               -- Promoción (respaldo)
  promocion_mkt  TEXT,               -- Promoción mktplace (la que se publica)
  vigencia       TEXT,               -- Vigencia
  liga           TEXT,               -- Liga
  skus           TEXT,               -- SKUs
  num_skus       TEXT                -- # de Sku´s
);

-- «Reportes»: enlaces rotos que reporta el equipo.
CREATE TABLE portal_reportes (
  id       TEXT PRIMARY KEY,   -- ID (rep-…)
  orden    INTEGER NOT NULL,
  fecha    TEXT,               -- Fecha
  seccion  TEXT,               -- Sección
  nombre   TEXT,               -- Nombre (qué se reportó)
  enlace   TEXT,               -- Enlace
  usuario  TEXT                -- Usuario
);

-- «Anuncios»: publicaciones del Portal (banner, destacado, tarjeta, modal; encuestas dentro de datos).
CREATE TABLE portal_anuncios (
  id           TEXT PRIMARY KEY,   -- ID (anc-…)
  formato      TEXT NOT NULL,      -- Formato
  activo       INTEGER NOT NULL DEFAULT 1,  -- Activo
  orden        INTEGER NOT NULL DEFAULT 0,  -- Orden
  desde        TEXT,               -- Desde
  hasta        TEXT,               -- Hasta
  datos        TEXT NOT NULL DEFAULT '{}',  -- Datos (JSON)
  autor        TEXT,               -- Autor (correo)
  responsable  TEXT,               -- Responsable (nombre)
  creado       TEXT                -- Creado
);

-- «Votos»: una fila por voto (un voto por persona y publicación, cambiable hasta el cierre).
CREATE TABLE portal_votos (
  publicacion  TEXT NOT NULL,   -- Publicación
  correo       TEXT NOT NULL,   -- Correo
  opcion       TEXT NOT NULL,   -- Opción
  fecha        TEXT NOT NULL,   -- Fecha
  PRIMARY KEY (publicacion, correo)
);

-- «Articulos»: documentación larga; el contenido es JSON de bloques, nunca HTML.
CREATE TABLE portal_articulos (
  id           TEXT PRIMARY KEY,   -- ID (art-…)
  titulo       TEXT NOT NULL,      -- Titulo
  resumen      TEXT,               -- Resumen
  contenido    TEXT NOT NULL DEFAULT '{"v":1,"bloques":[]}',  -- Contenido (JSON)
  estado       TEXT NOT NULL DEFAULT 'borrador',  -- Estado: borrador | publicado
  autores      TEXT,               -- Autores
  creado       TEXT,               -- Creado
  editado      TEXT,               -- Editado
  editado_por  TEXT                -- Editado por
);

-- «ArticulosVistas»: una fila por persona y artículo.
CREATE TABLE portal_articulos_vistas (
  articulo_id  TEXT NOT NULL,   -- ID articulo
  correo       TEXT NOT NULL,   -- Correo
  nombre       TEXT,            -- Nombre
  primera_vez  TEXT,            -- Primera vez
  ultima_vez   TEXT,            -- Ultima vez
  veces        INTEGER NOT NULL DEFAULT 0,  -- Veces
  PRIMARY KEY (articulo_id, correo)
);

-- ── Libro 3 · Trazabilidad (los seis procesos homologados) ──────────────────────────────────────

CREATE TABLE trazabilidad_secciones (
  id            TEXT PRIMARY KEY,   -- 'bigticket', 'softline'…
  orden         INTEGER NOT NULL,
  prefijo       TEXT NOT NULL,      -- 'bt', 'sl'…
  label         TEXT NOT NULL,      -- 'Big Ticket'
  etiqueta      TEXT,               -- 'BT'
  hoja          TEXT,               -- nombre de la pestaña de origen
  tiene_avance  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE trazabilidad_procesos (
  id             TEXT PRIMARY KEY,   -- 'bt-1', 'mkp-12'… (anclas estables del buscador)
  seccion        TEXT NOT NULL,
  orden          INTEGER NOT NULL,
  num            TEXT,
  num_hoja       TEXT,
  nombre         TEXT,
  reporte        TEXT,
  avance         TEXT,
  solucion       TEXT,
  plataformas    TEXT,
  observaciones  TEXT
);
CREATE INDEX trazabilidad_procesos_seccion ON trazabilidad_procesos (seccion, orden);
