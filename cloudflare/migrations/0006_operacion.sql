-- =================================================================================================
-- Portal Ventel · migración del módulo de ESTADO DE OPERACIÓN Y ATENCIONES (agente «operación»).
-- =================================================================================================
-- Las tablas operacion_* y atenciones_* ya están en 0001_esquema.sql con todas las columnas de sus
-- hojas. Aquí solo va lo que el port necesita además:

-- Candado con caducidad: sustituye a LockService.getScriptLock() en opReportar, opActualizarIncidente,
-- opCrearIncidente, opElevarReporte y las escrituras de atenciones. Se toma con un UPSERT condicional
-- (entra quien inserta la fila o quien la encuentra caducada) y se suelta borrándola. `expira` en ms.
CREATE TABLE IF NOT EXISTS operacion_candados (
  clave   TEXT PRIMARY KEY,   -- 'operacion' | 'atenciones'
  dueno   TEXT NOT NULL,      -- uuid de la petición que lo tiene
  expira  INTEGER NOT NULL    -- ms: pasado este momento cualquiera puede tomarlo
);

-- Frenos («ya reportaste esto», tope por hora) y «lo que ya reportaste» de la pastilla: por persona.
CREATE INDEX IF NOT EXISTS operacion_reportes_correo ON operacion_reportes (correo, fecha);

-- Umbral automático y vinculación: reportes sueltos de un sistema en la última media hora.
CREATE INDEX IF NOT EXISTS operacion_reportes_sistema ON operacion_reportes (sistema_clave, fecha);

-- Historial por días/horas y recomendaciones: incidencias por fecha de confirmación.
CREATE INDEX IF NOT EXISTS operacion_incidentes_confirmado ON operacion_incidentes (confirmado);
