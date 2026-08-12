# Base de Datos — Diccionario Completo de Tablas e Integridad

> **DOCUMENTACIÓN TÉCNICA OFICIAL DE ARQUITECTURA Y MANTENIMIENTO**
> **Sistema Integral Portal Ventel & Extensión Chrome**
> **Autor:** David Martínez (`dmartineza02@liverpool.com.mx`)

---

## 🗂️ Diccionario Técnico de Tablas (Google Sheets)

Esta sección contiene la especificación completa de todos los campos, tipos de datos y reglas para las **27 hojas de cálculo** distribuidas en los 3 libros que conforman la base de datos relacional del ecosistema Ventel.

---

### 📘 Libro 1: Base de Datos Principal del Sistema (Spreadsheet Activo)

#### 1. Hoja: `Registros` (Usuarios del Sistema)
- `Nombre` (`string`): Nombre completo del usuario o asesor.
- `Email` (`string`): Correo electrónico corporativo normalizado (Llave Primaria de Identidad).
- `PasswordHash` (`string`): Hex digest SHA-256 de contraseña concatenada con `HASH_SALT`.
- `Avanzado` (`boolean` / `Si` / `No`): Indica si el usuario tiene nivel jerárquico Supervisor.
- `PasswordTemporal` (`boolean` / `Si` / `No`): Columna auto-reparable. `Si` indica que el usuario debe cambiar su clave al entrar.
- `FechaAlta` (`Date`): Sello de tiempo de creación de la cuenta.

#### 2. Hoja: `Cotizaciones` (Cabeceras de Cotización)
- `Folio` (`string`): Folio único secuencial `LVP-YYMMDD-XXXX` (Llave Primaria).
- `Timestamp` (`Date`): Fecha y hora de generación de la cotización.
- `AsesorCorreo` (`string`): Correo electrónico del asesor que generó la cotización.
- `AsesorNombre` (`string`): Nombre completo del asesor.
- `Extencion` (`string`): Extensión telefónica corporativa del asesor.
- `ClienteNombre` (`string`): Nombre completo del cliente.
- `CorreoCliente` (`string`): Correo electrónico del cliente.
- `Numero` (`string`): Teléfono a 10 dígitos del cliente.
- `Subtotal` (`number`): Importe subtotal en Pesos MXN.
- `IVA` (`number`): Importe de IVA (16%) en Pesos MXN.
- `TotalGeneral` (`number`): Importe total en Pesos MXN.
- `Estatus` (`string`): Estado actual (`Folio Generado`, `En Revisión`, `Aprobada`, `Rechazada`, `Enviada por Correo`).
- `Observaciones` (`string`): Notas adicionales del asesor.
- `LinkPDF` (`string`): URL pública del archivo PDF almacenado en Google Drive.
- `Formato` (`string`): Columna auto-reparable. ID del formato de impresión utilizado (`actual`, `ccl_liverpool`).
- `LinkSheetCCL` (`string`): Columna auto-reparable. URL de la hoja de cálculo CCL generada.
- `RevisionEstado` (`string`): Estado de la revisión (`Aprobada`, `Rechazada`, `En Revisión`).
- `RevisadoPor` (`string`): Correo del supervisor o `politica-automatica@sistema`.
- `RevisadoNombre` (`string`): Nombre del revisor.
- `RevisionFecha` (`Date`): Sello de tiempo de aprobación o rechazo.
- `RevisionNotas` (`string`): Observaciones del supervisor o reglas de política aplicadas.
- `RevisionChecklist` (`string`): Resumen textual del resultado de los 8 puntos de auditoría.

#### 3. Hoja: `DetalleCotizaciones` (Partidas de Producto)
- `FolioCotizacion` (`string`): Llave Foránea conectada con `Cotizaciones.Folio`.
- `SKU` (`string`): Código de producto o variante a 9 o 10 dígitos.
- `DescripcionProducto` (`string`): Nombre o título del producto.
- `Cantidad` (`integer`): Unidades cotizadas.
- `PrecioUnitarioBase` (`number`): Precio unitario original en Pesos MXN.
- `CostoPagoUnicoLinea` (`number`): Importe subtotal de la línea de producto.
- `DescPublicoPorcentaje` (`number`): Porcentaje de descuento público.
- `AplicaDescAdicional` (`string`): `Si` / `No` si aplica descuento de colaborador o tarjeta.
- `PorcentajeDescAdicional` (`number`): Porcentaje de descuento adicional.
- `ImagenUrl` (`string`): Columna auto-reparable. URL de la imagen del producto en CDN Liverpool.
- `LinkArticulo` (`string`): Columna auto-reparable. URL de la ficha del producto en `liverpool.com.mx`.

#### 4. Hojas de Operación: `OperacionReportes`, `OperacionIncidentes`, `OperacionActualizaciones`, `OperacionCatalogo`
- `OperacionReportes`: `ID`, `Fecha`, `Correo`, `Nombre`, `Sistema`, `SistemaClave`, `Submotivo`, `SubmotivoClave`, `Notas`, `Evidencias` (JSON URLs Drive), `IncidenteId`, `Estado`.
- `OperacionIncidentes`: `ID`, `Clave`, `Sistema`, `SistemaClave`, `Submotivo`, `Estado` (`posible`, `confirmado`, `intermitencia`, `mantenimiento`, `resuelto`, `descartado`), `Titulo`, `Detalle`, `Creado`, `CreadoPor`, `Confirmado`, `ConfirmadoPor`, `Actualizado`, `Cerrado`, `Origen`.
- `OperacionActualizaciones`: `ID`, `IncidenteId`, `Fecha`, `Autor`, `AutorNombre`, `Estado`, `Nota`, `Aviso`.
- `OperacionCatalogo`: `Tipo` (`sistema`, `submotivo`, `estado`), `SistemaClave`, `Valor`, `Clave`, `Tono` (`ok`, `info`, `warn`, `alert`, `neutro`), `Creado`, `CreadoPor`, `Activo`, `Usos`.

#### 5. Hoja: `AtencionesPendientes` y `AtencionesTipos`
- `AtencionesPendientes`: `ID` (`AT-XXXX-YYYYY`), `Fecha`, `Asesor`, `AsesorNombre`, `Cliente`, `Telefono`, `Correo`, `Tipo`, `Notas`, `HoraPromesa`, `LiberarEn`, `Estado` (`pendiente`, `rescatada`, `finalizada`), `RescatadaPor`, `RescatadaEn`, `CerradaPor`, `CerradaEn`, `Resultado`.
- `AtencionesTipos`: `Tipo`, `Clave`, `Usos`, `Creado`, `Por`.

#### 6. Hojas de Auditoría y Métricas: `BitacoraConsola`, `MetricasCorreos`, `CorreosEnviados`, `Onboarding`
- `BitacoraConsola`: `Fecha`, `Quien`, `Accion`, `Objetivo`, `Detalle`.
- `MetricasCorreos`: `Fecha`, `Tipo` (`cotizacion`, `cliente`), `Referencia`, `AsesorEmail`, `AsesorNombre`, `Para`, `Destinatarios`, `CC`, `CCO`, `Asunto`, `Adjuntos`, `Remitente`, `AliasUsado`, `Resultado`, `Detalle`.
- `CorreosEnviados`: `Fecha`, `Plantilla`, `To`, `CC`, `CCO`, `Asunto`, `Asesor`, `Remitente`, `Adjuntos`.
- `Onboarding`: `Correo`, `Pantalla`, `Version`, `Estado` (`completado`, `omitido`), `PasoFinal`, `TotalPasos`, `Actualizado`.

#### 7. Hojas Ocultas del Sistema (`_`)
- **`_PermisosSistema`:** `Email`, `Rol` (`normal`, `avanzado`, `maestro`), `Permisos` (JSON `{"mas":[], "menos":[]}`), `Activo` (`Si`/`No`), `Actualizado`, `Por`. Oculta mediante `sheet.hideSheet()`.
- **`_PreferenciasUsuario`:** `Email`, `Preferencias` (JSON validado `{v: schema, t: timestamp, data: {tema, densidad, textscale, contraste, fijados, menuPlegado, inicio, vistos}}`), `Version`, `Actualizado`. Oculta mediante `sheet.hideSheet()`.

---

### 📙 Libro 2: Base de Datos de Portales (`PORTAL_SHEET_ID`)

Contiene 10 pestañas configurables para el contenido dinámico del portal web:
1. `Herramientas`: `Nombre`, `Descripcion`, `Url`, `Icono`, `Categoria`, `Etiqueta`, `Orden`, `Activo`.
2. `Presentaciones`: `Titulo`, `Descripcion`, `Url`, `Icono`, `Seccion`, `Orden`, `Activo`.
3. `Paqueterias`: `Nombre`, `Url`, `Icono`, `Telefono`, `RastrearUrl`, `Orden`, `Activo`.
4. `Formatos`: `Nombre`, `Descripcion`, `Url`, `Categoria`, `Extension`, `Orden`, `Activo`.
5. `PdePago`: `Nombre`, `Descripcion`, `Url`, `Icono`, `Orden`, `Activo`.
6. `Plantillas`: `Titulo`, `Categoria`, `ContenidoHtml`, `Variables`, `Orden`, `Activo`.
7. `Anuncios`: `ID`, `Titulo`, `Subtitulo`, `Contenido`, `ImagenUrl`, `BotonTexto`, `BotonUrl`, `Formato` (`banner`, `destacado`, `tarjeta`, `modal`), `Inicio`, `Fin`, `Activo`, `Orden`.
8. `Promociones`: `Nombre`, `Vigencia`, `Mecanica`, `Legales`, `Seccion`, `Terminado`, `Activo`.
9. `MKP`: `Nombre`, `Vigencia`, `Comision`, `Condiciones`, `Activo`.
10. `Reportes`: `Fecha`, `Elemento`, `Url`, `ReportadoPor`, `Estado`.

---

### 📗 Libro 3: Base de Datos de Trazabilidad (`TRAZ_SHEET_ID`)

Contiene 6 pestañas de procesos de homologación 2026:
- Pestañas: `bigticket`, `softline`, `slmensajerias`, `mkp`, `tienda`, `generales`.
- Esquema de Campos: `NombreProceso`, `ReporteDonde`, `AvanceFallas`, `SolucionDirecta`, `PlataformasInvolucradas`, `Observaciones`.

---

## ✍️ Firma de Responsabilidad Técnica

**David Martínez**  
*Escritor y Arquitecto Principal del Sistema*  
Correo Institucional: `dmartineza02@liverpool.com.mx`  
El Puerto de Liverpool · Equipo Ventel  
*Agosto de 2026*
