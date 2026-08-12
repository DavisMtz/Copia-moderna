# Backend — Referencia Técnica Detallada (Google Apps Script)

> **DOCUMENTACIÓN TÉCNICA OFICIAL DE ARQUITECTURA Y MANTENIMIENTO**
> **Sistema Integral Portal Ventel & Extensión Chrome**
> **Autor:** David Martínez (`dmartineza02@liverpool.com.mx`)

---

## 📚 Catálogo Exhaustivo de Funciones Backend (.gs)

Esta sección contiene el catálogo completo y detallado de las **más de 500 funciones y auxiliares** contenidas en los 24 archivos backend `.gs` del proyecto.

---

### 📄 1. `Code.gs` (1,419 líneas) — Enrutamiento, CRUD y Buscador

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `getScriptUrl()` | Pública | Ninguno | `string \| null` | Obtiene la URL del despliegue mediante `ScriptApp.getService().getUrl()`. |
| `doGet(e)` | Pública | `e: Object` | `HtmlOutput` | Handler HTTP GET. Rutas públicas y privadas con manejo de excepciones y fallbacks. |
| `servirPagina_(e)` | Privada | `e: Object` | `HtmlOutput` | Enrutador maestro. Inyecta `baseUrl` y `PARAMS_VISTA` en plantillas HTML. |
| `include(filename)` | Pública | `filename: string` | `string` | Helper para inclusión modular en plantillas (`<?!= include('file.html'); ?>`). |
| `getUserEmail(correoPortal)` | Pública | `correoPortal: string` | `string \| null` | Resuelve el correo efectivo del usuario actual vía `secCorreoEfectivo_`. |
| `registerUser(name, email, pass)` | Deprecada | `name, email, pass` | `Object` | Retorna aviso notificando que el alta requiere código OTP de 6 dígitos. |
| `loginUser(email, password)` | Pública | `email, password` | `Object` | Valida credenciales, bloquea intentos fallidos, verifica hash SHA-256 y emite vales. |
| `generateLvpFolio(sheet)` | Pública | `sheet: Sheet` | `string` | Genera folios secuenciales `LVP-YYMMDD-XXXX` con reinicio diario bajo ScriptLock. |
| `saveQuoteDataToSheets(quote, status, pdfLink)` | Pública | `quote, status, pdfLink` | `void` | Persiste cabecera y partidas en Sheets. Auto-crea columnas y limpia caché. |
| `saveQuoteAndGoToPreview(quoteData)` | Pública | `quoteData: Object` | `Object` | Adquiere ScriptLock, asigna folio, evalúa reglas de política y prepara vista previa. |
| `getQuotesForUser(email, term, forzar)` | Pública | `email, term, forzar` | `Object` | Consulta cotizaciones de un asesor o globales con caché relacional (`cotCacheado_`). |
| `leerCotizacionesDeUsuario_(email, term)` | Privada | `email, term` | `Object` | Lector directo de la hoja `Cotizaciones` con algoritmo de puntuación fuzzy. |
| `buscarCotizaciones(email, term, limit)` | Pública | `email, term, limit` | `Object` | Endpoint ligero para paleta de comandos y barra superior (límite 8-25). |
| `getQuoteDetails(folio)` | Pública | `folio: string` | `Object` | Retorna cabecera, partidas, enlaces Drive y estado de revisión para un folio. |
| `leerDetalleCotizacion_(folio)` | Privada | `folio: string` | `Object` | Lector directo de partidas e imágenes de la hoja `DetalleCotizaciones`. |
| `getDashboardStats()` | Pública | `Ninguno` | `Object` | Estadísticas consolidadas (totales del mes, top asesores, actividad 7 días). |
| `calcularDashboardStats_()` | Privada | `Ninguno` | `Object` | Cálculo estadístico directo sobre `Cotizaciones`. |
| `getSupervisionQuotes(email)` | Pública | `email: string` | `Object` | Lista de cotizaciones para el panel de supervisión (requiere bloque `supervision`). |
| `leerSupervision_()` | Privada | `Ninguno` | `Object` | Lector directo para supervisión. |
| `sendWebhookNotification(folio, data, st)` | Pública | `folio, data, st` | `void` | Envía mensaje con formato card a Google Chat mediante Webhook HTTP POST. |
| `normalizeText_(s)` | Privada | `s: any` | `string` | Normaliza a minúsculas, descompone acentos NFD y colapsa espacios. |
| `compactText_(s)` | Privada | `s: any` | `string` | Remueve caracteres no alfanuméricos (`[^a-z0-9]`). |
| `searchTokens_(s)` | Privada | `s: any` | `Array<string>` | Tokeniza palabras separando transiciones entre letras y números. |
| `levenshtein_(a, b)` | Privada | `a, b: string` | `number` | Calcula la distancia de edición de Levenshtein entre dos cadenas. |
| `fuzzyTolerance_(len)` | Privada | `len: number` | `number` | Retorna la tolerancia de ediciones permitidas según el largo de la palabra. |
| `fuzzyScore_(text, term)` | Privada | `text, term: string` | `number` | Algoritmo de relevancia fuzzy (evalúa exacto, compacto, prefijo y Levenshtein). |

---

### 📄 2. `Seguridad.gs` (456 líneas) — Modos de Autenticación y Criptografía

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `secConfig_(clave, respaldo)` | Privada | `clave, respaldo` | `any` | Lee propiedad de `PropertiesService` con valor de respaldo en código. |
| `secGuardarConfiguracion()` | Utilidad | Ninguno | `Object` | Guarda constantes sensibles (`HASH_SALT`, `WEBHOOK_URL`) en ScriptProperties. |
| `secFijarModoAuth(modo)` | Utilidad | `modo: string` | `string` | Cambia el modo de autenticación (`portal`, `auto`, `estricto`, `legado`). |
| `secUsuarioGoogle_()` | Privada | Ninguno | `string` | Obtiene el correo de la cuenta de Google activa (`Session.getActiveUser()`). |
| `secNormalizarCorreo_(email)` | Privada | `email: any` | `string` | Normaliza correos a minúsculas sin espacios. |
| `secEsAfirmativo_(valor)` | Privada | `valor: any` | `boolean` | Retorna `true` si el valor equivale a `si`, `true`, `1`, `x`. |
| `secIndiceRegistros_()` | Privada | Ninguno | `Object` | Indiza la hoja `Registros` en memoria por la duración de la ejecución. |
| `secBuscarRegistro_(email)` | Privada | `email: string` | `Object` | Busca la existencia y datos de un usuario en el índice de `Registros`. |
| `secIdentidad_(emailCliente)` | Privada | `emailCliente: string` | `Object` | Resuelve la identidad activa del usuario según el modo `AUTH_MODO`. |
| `secIdentidadAvanzada_(email)` | Privada | `email: string` | `Object` | Gate que valida `ok: true` y rol `avanzado`/`maestro`. |
| `secIdentidadConBloque_(email, bloque)` | Privada | `email, bloque` | `Object` | Gate que valida que el usuario posea el bloque de permisos solicitado. |
| `secIdentidadMaestra_(email)` | Privada | `email: string` | `Object` | Gate exclusivo para administradores maestros (`maestro: true`). |
| `secCorreoEfectivo_(email)` | Privada | `email: string` | `string` | Retorna el correo válido a estampar en transacciones. |
| `secIntentosRevisar_(clave, max, seg)` | Privada | `clave, max, seg` | `Object` | Verifica intentos fallidos de login en `CacheService`. |
| `secIntentosSumar_(clave, seg)` | Privada | `clave, seg` | `number` | Incrementa el contador de intentos fallidos en caché. |
| `secIntentosLimpiar_(clave)` | Privada | `clave: string` | `void` | Resetea el contador de intentos fallidos. |
| `secEscapeHtml_(texto)` | Privada | `texto: any` | `string` | Escapa caracteres HTML especiales (`&`, `<`, `>`, `"`, `'`). |
| `secComparacionSegura_(a, b)` | Privada | `a, b: string` | `boolean` | Comparación de cadenas en tiempo constante (Anti Timing Attacks). |
| `secHashContrasena_(password)` | Privada | `password: string` | `string` | Genera digest SHA-256 de contraseña + `HASH_SALT`. |
| `secCorreoValido_(email)` | Privada | `email: string` | `boolean` | Valida la sintaxis de correo electrónico con expresión regular. |
| `secDiagnostico(correoPortal)` | Utilidad | `correoPortal: string` | `Object` | Revisa el funcionamiento del motor de seguridad e identidades. |

---

### 📄 3. `Cuentas.gs` (1,380 líneas) — Verificación OTP y Ciclo de Vida

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `solicitarCodigoRegistro(nombre, email, pass)` | Pública | `nombre, email, pass` | `Object` | Valida dominio y emite código de 6 dígitos a correo. |
| `confirmarCodigoRegistro(email, codigo)` | Pública | `email, codigo` | `Object` | Valida OTP de 6 dígitos, crea cuenta en `Registros` y envía bienvenida. |
| `solicitarCodigoRecuperacion(email)` | Pública | `email: string` | `Object` | Emite código de recuperación de contraseña de 6 dígitos. |
| `confirmarCodigoRecuperacion(email, codigo)` | Pública | `email, codigo` | `Object` | Valida OTP y genera un token `vale` de 15 minutos de vigencia. |
| `restablecerContrasena(email, vale, nueva)` | Pública | `email, vale, nueva` | `Object` | Consume el `vale`, actualiza la contraseña en Sheets y limpia temporales. |
| `establecerPasswordInicial(email, vale, nueva)` | Pública | `email, vale, nueva` | `Object` | Define contraseña definitiva al iniciar sesión con clave temporal. |
| `cuentasEmitirCodigo_(prop, correo, datos, textos)` | Privada | `prop, correo, datos, textos` | `Object` | Orquestador de emisión de códigos OTP con límites por hora (max 5/hr). |
| `cuentasVerificarCodigo_(prop, correo, cod)` | Privada | `prop, correo, cod` | `Object` | Valida OTP de 6 dígitos (vigencia 10 min, max 5 intentos). |
| `cuentasAltaUsuario_(nombre, correo, hash)` | Privada | `nombre, correo, hash` | `Object` | Inserción lock-protected en la hoja `Registros`. |
| `cuentasActualizarPassword_(correo, hash)` | Privada | `correo, hash` | `boolean` | Actualización de hash de contraseña en Sheets. |
| `cuentasMarcarPasswordTemporal_(correo, temp)` | Privada | `correo, temp` | `boolean` | Setea la bandera `PasswordTemporal` en Sheets. |
| `cuentasPasswordEsTemporal_(correo)` | Privada | `correo: string` | `boolean` | Revisa si el usuario requiere cambio obligatorio de clave. |
| `cuentasPlantillaCorreo_(op)` | Privada | `op: Object` | `string` | Plantilla HTML responsiva de 600px para correos de cuenta. |
| `cuentasPreviaCorreos(enviarA)` | Utilidad | `enviarA: string` | `string` | Genera archivo HTML en Drive con vista previa de plantillas. |
| `cuentasLimpiarTodo()` | Utilidad | Ninguno | `number` | Elimina todas las propiedades `cta_*` de ScriptProperties. |

---

### 📄 4. `Cache.gs` (180 líneas) — Caché por Generación y Fragmentado

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `cotGeneracion_()` | Privada | Ninguno | `string` | Lee el contador global `COT_CACHE_GEN` en `ScriptProperties`. |
| `cotInvalidarCache_()` | Privada | Ninguno | `void` | Incrementa `COT_CACHE_GEN`, invalidando de golpe toda la caché del sistema. |
| `cotClave_(nombre)` | Privada | `nombre: string` | `string` | Construye clave versionada (`cot_g[GEN]_[NOMBRE]`). |
| `cotCacheGet_(nombre)` | Privada | `nombre: string` | `Object \| null` | Recupera payload de `CacheService` ensamblando trozos si fue fragmentado. |
| `cotCachePut_(nombre, obj, ttl)` | Privada | `nombre, obj, ttl` | `void` | Guarda en `CacheService` fragmentando objetos >90 KB en trozos de 90 KB. |
| `cotCacheado_(nombre, ttl, prod, acc, forz)` | Privada | `nombre, ttl, prod...` | `any` | Wrapper maestro de lectura/escritura en caché. |
| `cotHash_(texto)` | Privada | `texto: string` | `string` | Genera digest MD5 de 16 caracteres para claves de caché. |
| `cotCacheDiagnostico()` | Utilidad | Ninguno | `Object` | Prueba ciclos de lectura, escritura e invalidación en `CacheService`. |

---

### 📄 5. `Permisos.gs` (1,233 líneas) — Motor RBAC y Hoja `_PermisosSistema`

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `obtenerPermisosSesion(email)` | Pública | `email: string` | `Object` | Endpoint para el frontend con rol, bloques permitidos y banderas. |
| `obtenerModulosPublicos()` | Pública | Ninguno | `Object` | Endpoint público que lista módulos apagados por mantenimiento. |
| `permBloquesEfectivos_(rol, aj, apagados)` | Privada | `rol, aj, apagados` | `Array<string>` | Calcula los bloques finales (`rol + mas - menos - apagados`). |
| `permUsuario_(email)` | Privada | `email: string` | `Object` | Resuelve el objeto de permisos completo cruzando `Registros` y `_PermisosSistema`. |
| `permPuede_(email, bloqueId)` | Privada | `email, bloqueId` | `boolean` | Verifica si el usuario cuenta con un bloque activo específico. |
| `permVetoJerarquia_(quien, objetivo)` | Privada | `quien, objetivo` | `string` | Previene que un usuario modifique a otros de jerarquía superior o a sí mismo. |
| `permEscribirFila_(email, campos)` | Privada | `email, campos` | `boolean` | Escribe cambios de rol y permisos en `_PermisosSistema` y `Registros`. |
| `NOMBRAR_MAESTRO()` | Utilidad | Ninguno | `Object` | Asigna rol `maestro` al correo configurado en `MAESTRO_INICIAL`. |
| `REPARAR_MAESTRO()` | Utilidad | Ninguno | `Object` | Repara inconsistencias en la matriz de administradores maestros. |
| `VER_PERMISOS_GUARDADOS()` | Utilidad | Ninguno | `Array<string>` | Imprime en Logger el contenido completo de `_PermisosSistema`. |

---

### 📄 6. `Admin.gs` (400 líneas) — Diagnóstico Maestro de Salud

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `revisionMaestra()` | Utilidad | Ninguno | `Object` | Suite de salud ejecutando **25 comprobaciones** en 9 subsistemas. |
| `verificarVersionDelCodigo()` | Utilidad | Ninguno | `Object` | Audita el espacio de nombres buscando archivos `.gs` duplicados u obsoletos. |
| `getSystemHealth(email)` | Pública | `email: string` | `Object` | Endpoint de supervisión que ejecuta `revisionMaestra()` si es `avanzado`. |

---

### 📄 7. `Operacion.gs` (2,403 líneas) — Incidentes e Indicadores de Salud

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `opEstadoPublico()` | Pública | Ninguno | `Object` | Estado simplificado de los sistemas para la vista pública sin sesión. |
| `opEstadoSesion(email)` | Pública | `email: string` | `Object` | Estado detallado con reportes propios del asesor para usuarios autenticados. |
| `opReportar(payload)` | Pública | `payload: Object` | `Object` | Registra falla, aplica límites de tasa y evalúa umbrales de elevación. |
| `opSubirEvidencia(payload)` | Pública | `payload: Object` | `Object` | Decodifica imagen base64 y la guarda en la carpeta de Drive de Operación. |
| `opIncidenteDetalle(id, email)` | Pública | `id, email` | `Object` | Detalle completo de un incidente con evidencias y bitácora de novedades. |
| `opPanel(email)` | Pública | `email: string` | `Object` | Datos para el panel del supervisor de operación (`operacion`). |
| `opActualizarIncidente(payload)` | Pública | `payload: Object` | `Object` | Actualiza estado/notas de incidente y publica aviso a Google Chat. |
| `opCrearIncidente(payload)` | Pública | `payload: Object` | `Object` | Alta manual de incidente por parte del supervisor. |
| `opDistancia_(a, b)` | Privada | `a, b: string` | `number` | Distancia de Damerau-Levenshtein tolerando transposiciones de letras. |
| `opDice_(a, b)` | Privada | `a, b: string` | `number` | Coeficiente de Sorenson-Dice sobre bigramas para evaluar similitud. |
| `opEvaluarUmbral_(cat, sis, sub, id)` | Privada | `cat, sis...` | `Object` | Eleva a incidente automático si 3 personas distintas reportan en 30 min. |
| `opCaducarPosibles_(catalogo)` | Privada | `catalogo: Object` | `number` | Cierra incidentes `posible` sin confirmar tras 1 hora de inactividad. |

---

### 📄 8. `Revision.gs` (1,937 líneas) — Cola de Revisión y Scraping

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `revPuedeEnviarse_(folio)` | Pública | `folio: string` | `Object` | Gate invocado por `Correos.gs` para impedir enviar cotizaciones no aprobadas. |
| `getRevisionCotizacion(folio, email)` | Pública | `folio, email` | `Object` | Carga datos para la pantalla de revisión (sin pasar por caché). |
| `guardarRevisionCotizacion(payload)` | Pública | `payload: Object` | `Object` | Aprueba/Rechaza cotización, escribe en Sheets y notifica al asesor. |
| `revVerificarPreciosLote(folio, email)` | Pública | `folio, email` | `Object` | Scraping paralelo con `UrlFetchApp.fetchAll` comparando precios cotizados. |
| `revPaginaArticulo(url, sku, email)` | Pública | `url, sku, email` | `Object` | Descarga HTML de Liverpool, purga código peligroso y prepara iframe `srcdoc`. |
| `revPurgarCss_(css, usa)` | Privada | `css, usa` | `string` | Elimina reglas CSS no utilizadas para aligerar la vista purgada. |

---

### 📄 9. `PoliticaRevision.gs` (792 líneas) — Motor de Reglas Automáticas

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `getPoliticaRevision(email)` | Pública | `email: string` | `Object` | Retorna las reglas de revisión configuradas para la consola de supervisión. |
| `guardarPoliticaRevision(email, pol)` | Pública | `email, pol` | `Object` | Guarda nuevas reglas, calcula diferencias y registra en historial. |
| `simularPoliticaRevision(email, caso, borrador)` | Pública | `email, caso...` | `Object` | Prueba reglas en borrador sobre cotizaciones de prueba sin guardar cambios. |
| `revpolDecidirAlGuardar_(quoteData)` | Privada | `quoteData` | `Object` | Evaluado en `Code.gs` al guardar cotización. Cae a `revisar: true` ante fallos. |
| `revpolSellarAprobacionAutomatica_(folio, dec)` | Privada | `folio, dec` | `void` | Estampa estado `Aprobada` y sello de política en `Cotizaciones`. |

---

### 📄 10. `Formatos.gs` (837 líneas) — Exportador PDF Formato CCL

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `getEnabledQuoteFormats()` | Pública | Ninguno | `Object` | Retorna los formatos de impresión habilitados para los asesores. |
| `setQuoteFormatEnabled(email, id, en)` | Pública | `email, id, en` | `Object` | Habilita o deshabilita un formato desde la consola de administración. |
| `generateQuotePdfBlob(folio, formatId)` | Pública | `folio, formatId` | `Blob` | Genera blob PDF según el formato seleccionado. |
| `generateCclPdfBlob_(folio)` | Privada | `folio: string` | `Blob` | Clona plantilla de Spreadsheet (`CCL_TEMPLATE_SHEET_ID`), inyecta datos y exporta PDF. |
| `fillCclSheet_(sheet, quote)` | Privada | `sheet, quote` | `void` | Rellena celdas, ajusta filas de tabla y actualiza fórmulas `SUMA`. |
| `downloadQuotePdf(folio, formatId)` | Pública | `folio, formatId` | `Object` | Genera PDF y lo retorna codificado en base64 para descarga en navegador. |

---

### 📄 11. `Correos.gs` (849 líneas) — Envío de Cotización por Correo

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `getMailSenderInfo()` | Pública | Ninguno | `Object` | Verifica disponibilidad del alias `cotizacion@liverpool.com.mx`. |
| `generateQuoteHtml(folio)` | Pública | `folio: string` | `Object` | Genera representación HTML estilizada de la cotización para vista previa. |
| `sendQuoteByEmail(emailData)` | Pública | `emailData: Object` | `Object` | Valida gate de revisión, adjunta PDF, envía correo vía Gmail/MailApp y registra métricas. |
| `getVerifiedImageUrl(sku, pref)` | Pública | `sku, pref` | `string` | Verifica disponibilidad de imágenes en 9 subdominios de Liverpool en paralelo. |

---

### 📄 12. `CorreoCliente.gs` (167 líneas) — Plantillas de Correo a Clientes

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `enviarCorreoPlantilla(payload)` | Pública | `payload: Object` | `Object` | Envía correos con plantillas HTML a clientes con adjuntos de hasta 20 MB. |
| `ccListaCorreos_(input, tag, max)` | Privada | `input, tag, max` | `Array<string>` | Parsea, limpia y valida listas de correos (To, CC, CCO). |
| `registrarCorreoClienteEnviado_(...)` | Privada | Varios | `void` | Escribe registro en la hoja de bitácora `CorreosEnviados`. |

---

### 📄 13. `Consola.gs` (63,015 bytes) — Consola Maestra de Administración

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `consolaPanorama(email)` | Pública | `email: string` | `Object` | Retorna todos los datos de administración (miembros, ajustes, salud, bitácora). |
| `consolaGuardarMiembro(email, cambio)` | Pública | `email, cambio` | `Object` | Actualiza rol, permisos personalizados y estado de un usuario. |
| `consolaAltaMiembro(email, datos)` | Pública | `email, datos` | `Object` | Alta de usuario con generación de contraseña temporal y correo de bienvenida. |
| `consolaResetPassword(email, objetivo)` | Pública | `email, objetivo` | `Object` | Resetea contraseña de un miembro generando clave temporal. |
| `consolaEliminarMiembro(email, obj, conf)` | Pública | `email, obj, conf` | `Object` | Elimina fila de miembro de `Registros` y `_PermisosSistema`. |
| `consolaGuardarAjuste(email, clave, val)` | Pública | `email, clave, val` | `Object` | Valida y guarda propiedad en `PropertiesService` registrando bitácora. |
| `consolaGuardarModulo(email, id, ap)` | Pública | `email, id, ap` | `Object` | Apaga o enciende un módulo por mantenimiento global. |

---

### 📄 14. `Atenciones.gs` (42,922 bytes) — Rescate de Atenciones Pospuestas

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `atencionesPanorama(email)` | Pública | `email: string` | `Object` | Retorna atenciones propias, públicas y cerradas del usuario. |
| `atencionRegistrar(email, datos)` | Pública | `email, datos` | `Object` | Guarda nueva atención pospuesta en `AtencionesPendientes`. |
| `atencionLiberarAhora(email, id)` | Pública | `email, id` | `Object` | Libera una atención propia al pool público de atenciones. |
| `atencionRescatar(email, id)` | Pública | `email, id` | `Object` | Reserva una atención del pool público por 15 minutos para el asesor. |
| `atencionFinalizar(email, id, res)` | Pública | `email, id, res` | `Object` | Cierra atención registrando el resultado final. |

---

### 📄 15. `AuditoriaCotizacion.gs` (56,464 bytes) — Auditoría Determinista de 8 Puntos

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `audAuditar_(quote, prods, op)` | Privada | `quote, prods, op` | `Object` | Evalúa 8 puntos: nombre, correo, teléfono, asesor, precios, totales, SKUs y vigencia. |
| `audValidarCorreo_(correo)` | Privada | `correo: string` | `Object` | Detecta correos desechables/genéricos y propone correcciones ortográficas. |
| `audValidarTotales_(quote, prods)` | Privada | `quote, prods` | `Object` | Revisa matemática de IVA (16%) y subtotal con margen de tolerancia. |
| `audValidarArticulos_(prods)` | Privada | `prods: Array` | `Object` | Detecta SKUs duplicados, cantidades anormales y descuentos atípicos. |
| `audDiagnostico()` | Utilidad | Ninguno | `string` | Suite de pruebas para validar las reglas gramaticales y matemáticas desde editor. |

---

### 📄 16. `Portal.gs` / 17. `PortalContenido.gs` / 18. `PortalPromosComercial.gs`

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `fetchToolsData()` | Pública | Ninguno | `Object` | Servidor de herramientas, plantillas y anuncios (caché 600s). |
| `fetchApplicationData()` | Pública | Ninguno | `Object` | Servidor de promociones, MKP y eventos de Google Calendar (90 días). |
| `portalContenidoGuardar(p)` | Pública | `p: Object` | `Object` | Editor celda por celda para 9 colecciones del portal (`PortalContenido.gs`). |
| `portalContenidoAplicarImport(p)` | Pública | `p: Object` | `Object` | Importación masiva con análisis previo de duplicados. |
| `portalPromosLeer(p)` | Pública | `p: Object` | `Object` | Intérprete de hojas comerciales (>300 pestañas en `PortalPromosComercial.gs`). |

---

### 📄 19. `Preferencias.gs` / 20. `Metricas.gs` / 21. `Onboarding.gs` / 22. `Equipo.gs` / 23. `Trazabilidad.gs` / 24. `DiagnosticoPromos.gs`

| Función | Tipo | Parámetros | Retorno | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `prefsGuardar(email, cambios, sellos)` | Pública | `email, cambios...` | `Object` | Guarda tema/UI del usuario en `_PreferenciasUsuario`. |
| `getResumenMetricasCorreos(email)` | Pública | `email: string` | `Object` | Reporte estadístico de correos enviados en `MetricasCorreos`. |
| `onbMarcar(email, datos)` | Pública | `email, datos` | `Object` | Registra tutoriales guiados vistos/omitidos en `Onboarding`. |
| `equipoPanorama(email)` | Pública | `email: string` | `Object` | Capa de compatibilidad obsoleta delegando a `Consola.gs`. |
| `fetchTrazabilidadData()` | Pública | Ninguno | `Object` | Lector de las 6 pestañas de homologación de procesos 2026. |
| `diagPromos()` | Utilidad | Ninguno | `string` | Verificación de estructura y caché del monitor de promociones. |

---

## ✍️ Firma de Responsabilidad Técnica

**David Martínez**  
*Escritor y Arquitecto Principal del Sistema*  
Correo Institucional: `dmartineza02@liverpool.com.mx`  
El Puerto de Liverpool · Equipo Ventel  
*Agosto de 2026*
