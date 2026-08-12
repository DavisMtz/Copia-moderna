# Backend — Documentación Total y Exhaustiva (.gs)

> **DOCUMENTACIÓN TÉCNICA Y DIDÁCTICA DE ARQUITECTURA Y MANTENIMIENTO**
> **Sistema Integral Portal Ventel & Extensión Chrome**
> **Autor:** David Martínez (`dmartineza02@liverpool.com.mx`)

---

## 🏛️ Cobertura del Backend (24 Archivos `.gs` + `appsscript.json`)

Este documento analiza de forma exhaustiva los **24 archivos backend `.gs`** y el manifiesto `appsscript.json` que componen el servidor del Portal Ventel.

---

### 📄 1. `Code.gs` (1,419 líneas) — Enrutamiento, Cotizaciones y Búsqueda
- **Servicio de Páginas:** `doGet(e)` intercepta las peticiones GET, evalúa `e.parameter.page` y rutea hacia `PORTAL_PAGES` (páginas públicas: `portal`, `promociones`, `estado`) o `PAGES` (páginas de la app: `login`, `registro`, `recuperar`, `dashboard`, `inicio_avanzado`, `cotizacion`, `cotizado_preview`, `consulta_cotizacion`, `revision_cotizacion`, `correoventel`, `correo_cliente`, `anuncios`, `portal_contenido`, `operacion`, `consola`, `atenciones`). Inyecta `baseUrl` y el catálogo `PARAMS_VISTA`.
- **Generador de Folios:** `generateLvpFolio(sheet)` genera el folio secuencial diario `LVP-YYMMDD-XXXX` bajo candado `LockService` de 30s.
- **Persistencia de Cotizaciones:** `saveQuoteDataToSheets` escribe las cabeceras en `Cotizaciones` y las partidas en `DetalleCotizaciones`, reparando automáticamente las columnas `Formato`, `ImagenUrl` y `LinkArticulo` si no existen.
- **Buscador Fuzzy:** `fuzzyScore_`, `levenshtein_`, `searchTokens_`, `normalizeText_` y `compactText_` evalúan coincidencias de nombres y folios independientemente de acentos o guiones.

### 📄 2. `Seguridad.gs` (456 líneas) — Autenticación e Identidades
- **Modos de Autenticación (`AUTH_MODO`):** Soporta `portal` (identidad enviada desde el cliente), `auto` (cuenta de Google activa), `estricto` (exige coincidencia entre cliente y Google) y `legado`.
- **Freno a Fuerza Bruta:** `secIntentosRevisar_` limita a máximo 8 intentos fallidos en 15 minutos (900s) utilizando `CacheService` volátil.
- **Criptografía:** `secHashContrasena_` aplica SHA-256 sobre la contraseña concatenada con `HASH_SALT`. La comparación se realiza con `secComparacionSegura_` en tiempo constante.

### 📄 3. `Cuentas.gs` (1,380 líneas) — Registro, OTP y Contraseñas
- **Códigos OTP:** `cuentasEmitirCodigo_` y `cuentasVerificarCodigo_` manejan la verificación por correo electrónico de 6 dígitos numéricos (vigencia 10 min, máximo 5 intentos).
- **Vales de Restablecimiento:** `confirmarCodigoRecuperacion` emite un token de 15 minutos (`vale`) que autoriza cambiar la clave en `restablecerContrasena` o `establecerPasswordInicial`.

### 📄 4. `Cache.gs` (180 líneas) — Caché por Generación
- **Invalidación Relacional:** `cotInvalidarCache_` incrementa `COT_CACHE_GEN` en `ScriptProperties`. Todas las claves de caché dependen de este contador (`cot_g[GEN]_[NOMBRE]`), dejando obsoletas todas las entradas tras cualquier escritura.
- **Fragmentado:** `cotCachePut_` divide payloads JSON >90 KB en trozos de 90 KB (hasta 20 trozos, permitiendo guardar objetos de hasta ~1.8 MB).

### 📄 5. `Permisos.gs` (1,233 líneas) — RBAC y Hoja `_PermisosSistema`
- **Hoja Oculta:** Mantiene los permisos en `_PermisosSistema`.
- **Motor RBAC:** 23 bloques de permisos agrupados en Portal, Cotizaciones, Supervisión y Administración. Permite adiciones (`+mas`) y sustracciones (`-menos`).
- **Módulos Apagados:** `permModulosApagados_` desactiva bloques de forma global por mantenimiento.

### 📄 6. `Admin.gs` (400 líneas) — Diagnóstico de Salud
- **`revisionMaestra()`:** Suite de diagnóstico ejecutando 25 comprobaciones automáticas sobre despliegue, hojas de cálculo, plantillas CCL, alias Gmail, Google Calendar y estado de operación.

### 📄 7. `Operacion.gs` (2,403 líneas) — Tablero de Estado e Incidentes
- **Detección Automática:** Eleva reportes a incidente en estado `posible` si 3 usuarios distintos reportan en 30 minutos (`OP_UMBRAL_PERSONAS = 3`).
- **Grouping Fuzzy:** Combina Damerau-Levenshtein y Sorenson-Dice para agrupar reportes similares.

### 📄 8. `Revision.gs` (1,937 líneas) — Cola de Revisión de Cotizaciones
- **Gate de Servidor:** `revPuedeEnviarse_` impide enviar por correo cotizaciones no aprobadas.
- **Scraping Paralelo:** `revVerificarPreciosLote` utiliza `UrlFetchApp.fetchAll` para consultar precios en vivo en `liverpool.com.mx`.

### 📄 9. `PoliticaRevision.gs` (792 líneas) — Aprobación Automática vs Manual
- Evalúa reglas configurables (monto, descuento, artículos, formato, asesor u horario) para aprobar cotizaciones automáticamente o desviarlas a la cola de revisión manual.

### 📄 10. `Formatos.gs` (837 líneas) — PDF Formato CCL Liverpool
- Clona la plantilla de Spreadsheet `CCL_TEMPLATE_SHEET_ID`, inyecta datos y fórmulas, exporta como PDF y borra la copia temporal en un bloque `finally`.

### 📄 11. `Correos.gs` (849 líneas) — Envío de Cotización por Correo
- Detecta la disponibilidad del alias corporativo `cotizacion@liverpool.com.mx` y envía correos con el PDF adjunto.

### 📄 12. `CorreoCliente.gs` (167 líneas) — Correos a Clientes
- Envía plantillas HTML formateadas a clientes con adjuntos de hasta 20 MB, registrando eventos en `CorreosEnviados`.

### 📄 13. `Consola.gs` (63,015 bytes) — Consola Maestra de Administración
- Administra miembros, asignación jerárquica de permisos, ajustes globales y auditoría en `BitacoraConsola`.

### 📄 14. `Atenciones.gs` (42,922 bytes) — Atenciones Pospuestas
- Gestiona llamadas pospuestas por caídas de sistema con reservas de 15 minutos para evitar colisiones entre asesores.

### 📄 15. `AuditoriaCotizacion.gs` (56,464 bytes) — Auditoría Determinista de 8 Puntos
- Valida nombres, correos desechables, teléfonos a 10 dígitos, matemática de IVA (16%), SKUs duplicados y desviaciones de precio.

### 📄 16. `Portal.gs` / 17. `PortalContenido.gs` / 18. `PortalPromosComercial.gs`
- Servicios del portal público. `PortalContenido.gs` provee un editor genérico para 9 colecciones con análisis de importación masiva. `PortalPromosComercial.gs` interpreta la hoja comercial (>300 pestañas).

### 📄 19. `Preferencias.gs` / 20. `Metricas.gs` / 21. `Onboarding.gs` / 22. `Equipo.gs` / 23. `Trazabilidad.gs` / 24. `DiagnosticoPromos.gs`
- Módulos auxiliares de almacenamiento de UI (`_PreferenciasUsuario`), métricas de correo (`MetricasCorreos`), estado de tutoriales (`Onboarding`), compatibilidad legacy (`Equipo.gs`), trazabilidad de procesos 2026 y diagnóstico de promociones.

### 📄 Manifiesto `appsscript.json`
- Define la ejecución en el motor V8 (`runtimeVersion: "V8"`), la zona horaria `America/Mexico_City`, el registro de excepciones en StackDriver y los permisos OAuth requeridos (Sheets, Drive, External HTTP, Calendar, Send Mail, User Info Email).

---

## ✍️ Firma de Responsabilidad Técnica

**David Martínez**  
*Escritor y Arquitecto Principal del Sistema*  
Correo Institucional: `dmartineza02@liverpool.com.mx`  
El Puerto de Liverpool · Equipo Ventel  
*Agosto de 2026*
