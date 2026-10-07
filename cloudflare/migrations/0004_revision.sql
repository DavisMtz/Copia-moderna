-- =================================================================================================
-- Portal Ventel · 0004 · Revisión de cotizaciones (Revision.gs / PoliticaRevision.gs)
-- =================================================================================================
-- Lo que en Apps Script vivía en las propiedades del script y no cabe bien en `propiedades`:
--
--   · La «última ficha buena» de cada artículo de liverpool.com.mx (antes, propiedades 'rev-ultima-…'
--     con un cupo de 500). Es lo que la pantalla de revisión enseña —precio y antigüedad— cuando
--     Liverpool bloquea la consulta automática y no hay nada más reciente. Solo lo mínimo para pintar
--     un precio con su edad: nunca el HTML.
--
-- Lo que NO está aquí, a propósito:
--   · La política de revisión: sigue siendo UN documento JSON en `propiedades` (clave
--     'revision_politica_v1', igual que en Apps Script). Se guarda entera porque el orden de los
--     criterios es parte del significado; sin fila, rige la política de arranque (revisar todo).
--   · La caché de 15 min de las fichas y de la página del artículo: va a la tabla `cache`, con caducidad.
--   · Las columnas de revisión de `cotizaciones`: ya existen en 0001_esquema.sql.
-- =================================================================================================

CREATE TABLE IF NOT EXISTS revision_fichas (
  clave         TEXT PRIMARY KEY,   -- 'rev-ficha-' + huella SHA-256 de la URL saneada del artículo
  url           TEXT NOT NULL,      -- la URL del artículo (ya validada contra REV_HOSTS_ARTICULO)
  titulo        TEXT,               -- nombre que publica el sitio
  precio        REAL,               -- precio con promoción (lo que se paga)
  precio_lista  REAL,               -- precio de lista
  capturada     TEXT NOT NULL,      -- cuándo se leyó del sitio (ISO UTC)
  actualizado   TEXT NOT NULL       -- última escritura de la fila (ISO UTC)
);
