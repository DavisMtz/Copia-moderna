# 04 · Base de datos · hojas y diccionario de datos

La base de datos son hojas de Google Sheets. Este documento dice dónde vive cada dato, quién
lo escribe y qué pasa si alguien mueve una columna.

---

## 1. Regla número uno

> **Las columnas se localizan por su NOMBRE de encabezado, nunca por su posición.**

Todo el sistema lee así: `headers.indexOf("Folio")`, `pcMapaColumnas_`, `atenIndice_`,
`opIndice_`, `trazMapearColumnas_`. Esto no es purismo: **hay personas ajenas al código
editando estas mismas pestañas a mano**, y una columna insertada desde el Sheet desalinearía
en silencio todas las escrituras nuevas.

Consecuencias prácticas:

- **Puedes reordenar columnas** en una hoja sin romper nada.
- **Puedes añadir columnas** propias: el sistema ignora las que no conoce.
- **No puedes renombrar** un encabezado que el código busca. Eso sí rompe.
- **No puedes renombrar una pestaña** salvo donde hay alias declarados (Trazabilidad y las
  hojas de comercial).

Tres módulos van más allá y **auto-reparan el esquema**: crean la columna que falta en la
primera columna libre y siguen. Son `DetalleCotizaciones` (`ImagenUrl`, `LinkArticulo`),
`Cotizaciones` (las seis de revisión, vía `revAsegurarColumnas_`) y `PortalContenido`
(la columna `ID`, vía `pcAsegurarIds_`).

---

## 2. Mapa de libros

| # | Libro | Cómo se accede | Quién lo lee |
| --- | --- | --- | --- |
| **1** | **BD Cotizaciones** | **Ligado al script** (`getActiveSpreadsheet()`) | Casi todos los `.gs` |
| **2** | **Hoja del Portal** | Por ID: `PORTAL_SHEET_ID` | `Portal.gs`, `PortalContenido.gs` |
| **3** | **Hoja de Trazabilidad** (Homologación) | Por ID: `TRAZ_SHEET_ID` | `Trazabilidad.gs` |
| **4** | **Plantilla CCL** | Por ID: `CCL_TEMPLATE_SHEET_ID` | `Formatos.gs` (se **copia**, no se escribe) |
| **5** | **Home Promociones comercial** | ID que aporta el usuario | `PortalPromosComercial.gs` (**solo lectura**) |

> **El libro 1 está ligado al script.** Es la razón por la que `SpreadsheetApp.getActiveSpreadsheet()`
> funciona sin ID. También significa que **no puedes mover el script a otro libro** sin
> romperlo todo, y que quien tenga acceso al libro tiene acceso al editor de Apps Script.

Los ID de los libros 2, 3 y 4 tienen **respaldo en el código** y **mandan las propiedades de
script** del mismo nombre. Se cambian desde la Consola → Ajustes → Fuentes de datos.

Además hay tres recursos de Drive y un calendario:

| Recurso | Propiedad / constante | Para qué |
| --- | --- | --- |
| Carpeta `Cotizaciones CCL generadas` | `CCL_OUTPUT_FOLDER_NAME` | PDF del formato oficial |
| Carpeta de anuncios | `PORTAL_ANUNCIOS_FOLDER_ID` | Imágenes de los anuncios del Portal |
| Carpeta de evidencias | `opCarpetaEvidencias_()` | Capturas adjuntas a un reporte de falla |
| Calendario comercial | `PORTAL_CALENDAR_ID` | Promociones vigentes |

---

## 3. Libro 1 · BD Cotizaciones (15 pestañas)

### 3.1 `Registros` — las personas

La lista de miembros. **La edita gente**, tiene validaciones de datos y formatos propios.

| Columna | Qué guarda | Notas |
| --- | --- | --- |
| `Nombre` | Nombre completo | |
| `Email` | Correo. **Es la clave** de todo el sistema | Se normaliza a minúsculas |
| `PasswordHash` | SHA-256 con sal | Nunca la contraseña en claro |
| `Avanzado` | Interruptor heredado | Tolera `Si`, `si`, `Sí`, `TRUE`, `x`, `1`, `verdadero` |
| `PasswordTemporal` | Marca de contraseña temporal | La crea `Cuentas.gs` si falta |

> **La configuración de permisos NO va aquí, a propósito.** Va en `_PermisosSistema`. Meter
> configuración del sistema en la hoja que edita gente producía choques silenciosos —una
> columna «Rol» con el puesto de cada quien, una validación que rechaza `Sí` con acento— y
> ninguno se nota hasta que alguien se queda sin sus permisos.

### 3.2 `Cotizaciones` — cabecera de cada cotización

| Columna | Qué guarda | La escribe |
| --- | --- | --- |
| `Folio` | `LVP-…`. **Clave primaria** | `Code.gs` (con `LockService`) |
| `Timestamp` | Fecha y hora | `Code.gs` |
| `AsesorCorreo` | **El de la sesión del Portal**, no la cuenta de Google | `Code.gs` |
| `AsesorNombre`, `Extencion` | Datos del asesor | `Code.gs` |
| `ClienteNombre`, `CorreoCliente`, `Numero` | Datos del cliente | `Code.gs` |
| `Subtotal`, `IVA`, `TotalGeneral` | Importes | `Code.gs` |
| `Estatus` | Estado del folio | `Code.gs` / `Revision.gs` |
| `Observaciones` | Notas | `Code.gs` |
| `LinkPDF` | Enlace al PDF | Solo se escribe **cuando llega uno** |
| `LinkSheetCCL` | Enlace a la hoja CCL generada | `Formatos.gs` |
| `RevisionEstado`, `RevisadoPor`, `RevisadoNombre`, `RevisionFecha`, `RevisionNotas`, `RevisionChecklist` | Revisión | `Revision.gs` (auto-reparables) |

> **Al actualizar, se conserva lo que la función no maneja**, incluidas las **fórmulas** (se
> reescribe la fórmula, no su resultado). Si una función nueva tuya reescribe la fila
> entera, borrará `LinkSheetCCL` y las columnas de revisión.

> **Seguro anti-desalineación:** si `saveQuoteDataToSheets` localiza menos de 5 campos por
> nombre, lanza una excepción con el texto de qué encabezados espera. Es intencionado: mejor
> un error visible que 300 cotizaciones escritas en las columnas equivocadas.

### 3.3 `DetalleCotizaciones` — las partidas

Una fila por artículo. Se identifican por `FolioCotizacion`.

| Columna | Qué guarda |
| --- | --- |
| `FolioCotizacion` | Enlace a la cabecera |
| `SKU` | SKU del artículo |
| `DescripcionProducto` | Descripción |
| `Cantidad` | Unidades |
| `PrecioUnitarioBase` | Precio unitario |
| `CostoPagoUnicoLinea` | Costo de pago único de la línea |
| `DescPublicoPorcentaje` | Descuento público (%) |
| `AplicaDescAdicional` | `Si` / `No` |
| `PorcentajeDescAdicional` | Descuento adicional (%) |
| `ImagenUrl` | Imagen. **Auto-reparable** |
| `LinkArticulo` | Ficha en liverpool.com.mx. **Auto-reparable.** La aporta la extensión |

> **Al reguardar una cotización, sus filas de detalle se BORRAN y se reescriben.** Es la
> forma correcta aquí (una cotización editada puede tener menos artículos que antes), pero
> significa que cualquier columna que añadas a mano en una fila de detalle **se pierde** al
> reguardar. No uses esta hoja para anotaciones manuales.

### 3.4 Resto de pestañas del libro 1

| Pestaña | Columnas | La escribe | Para qué |
| --- | --- | --- | --- |
| `_PermisosSistema` **(oculta)** | `Email`, `Rol`, `Permisos`, `Activo`, `Actualizado`, `Por` | `Permisos.gs` | Rol y ajustes por persona. `Permisos` es JSON: `{"mas":["revisar"],"menos":["anuncios"]}` |
| `_PreferenciasUsuario` | `Email`, `Preferencias`, `Version`, `Actualizado` | `Preferencias.gs` | Una línea por persona. Tema, texto, densidad, accesos fijados |
| `BitacoraConsola` | `Fecha`, `Quien`, `Accion`, `Objetivo`, `Detalle` | `Consola.gs` | Quién cambió qué en la consola. Se leen los últimos 150 |
| `MetricasCorreos` | `Fecha`, `Tipo`, `Referencia`, `AsesorEmail`, `AsesorNombre`, `Para`, `Destinatarios`, `CC`, `CCO`, `Asunto`, `Adjuntos`, `Remitente`, `AliasUsado`, `Resultado`, `Detalle` | `Metricas.gs` | **Fuente única** de métricas de los dos canales de correo |
| `CorreosEnviados` | `Fecha`, `Plantilla`, `Para`, `CC`, `CCO`, `Asunto`, `Asesor`, `Remitente`, `Adjuntos` | `CorreoCliente.gs` | Bitácora de plantillas a clientes. **Aditiva**, no reemplaza a la anterior |
| `Onboarding` | `Correo`, `Pantalla`, `Version`, `Estado`, `PasoFinal`, `TotalPasos`, `Actualizado` | `Onboarding.gs` | Qué tutorial vio cada persona. **No es un candado** |
| `AtencionesPendientes` | `ID`, `Fecha`, `Asesor`, `AsesorNombre`, `Cliente`, `Telefono`, `Correo`, `Tipo`, `Notas`, `HoraPromesa`, `LiberarEn`, `Estado`, `RescatadaPor`, `RescatadaEn`, `CerradaPor`, `CerradaEn`, `Resultado` | `Atenciones.gs` | **Datos personales de clientes.** Ver §6 |
| `AtencionesTipos` | `Tipo`, `Clave`, `Usos`, `Creado`, `Por` | `Atenciones.gs` | Catálogo que **se alimenta solo**: el equipo añade tipos usándolos |
| `OperacionReportes` | `ID`, `Fecha`, `Correo`, `Nombre`, `Sistema`, `SistemaClave`, `Submotivo`, `SubmotivoClave`, `Notas`, `Evidencias`, `IncidenteId`, `Estado` | `Operacion.gs` | Cada aviso individual de un asesor |
| `OperacionIncidentes` | `ID`, `Clave`, `Sistema`, `SistemaClave`, `Submotivo`, `Estado`, `Titulo`, `Detalle`, `Creado`, `CreadoPor`, `CreadoNombre`, `Confirmado`, `ConfirmadoPor`, `ConfirmadoNombre`, `Actualizado`, `ActualizadoPor`, `Cerrado`, `Origen` | `Operacion.gs` | La falla agregada. `Origen` distingue lo automático de lo humano |
| `OperacionActualizaciones` | `ID`, `IncidenteId`, `Fecha`, `Autor`, `AutorNombre`, `Estado`, `Nota`, `Aviso` | `Operacion.gs` | Historial de una incidencia |
| `OperacionCatalogo` | `Tipo`, `SistemaClave`, `Valor`, `Clave`, `Tono`, `Creado`, `CreadoPor`, `Activo`, `Usos` | `Operacion.gs` | Sistemas, motivos y estados. **También se alimenta con el uso** |

---

## 4. Libro 2 · Hoja del Portal (11 pestañas)

Es la que edita el equipo desde la pantalla **Contenido del Portal** (`portal_contenido`).

| Pestaña | Campos que el sistema busca | Notas |
| --- | --- | --- |
| `Herramientas` | Nombre · Enlace · Cómo acceder · Descripción · Claves | |
| `Presentaciones` | Nombre · Liga · Descripción | El encabezado real dice **`DESCRPCION`** (sin la i). Por eso el alias es `descr` |
| `Paqueterias` | Nombre · Liga · Soms | |
| `Formatos` | Acceso · Observaciones · Liga | |
| `PdePago` | Nombre · Detalles · Liga | |
| `Plantillas` | Título · Tipo · Asunto · Cuerpo · Consideraciones | Ya traía columna `ID` |
| `Anuncios` | `ID` · `Formato` · `Activo` · `Orden` · `Desde` · `Hasta` · `Datos` (JSON) · `Autor` · `Creado` | Formatos: `banner`, `destacado`, `tarjeta`, `modal` |
| `Avisos` | *(legado)* | Respaldo antiguo de banners |
| `Promociones` | Dirección · Categoría · Promoción · Marca · Vigencia · Liga | **Tiene columnas que la app NO toca** (SKUS Mercaderías, banners de home) |
| `MKP` | Dirección · Categoría · Promoción MKT · Promoción (respaldo) · Vigencia · Liga | Marketplace |
| `Reportes` | Fecha · Sección · Qué se reportó · Enlace · Quién lo reportó | Lo llena el botón «Reportar» de las tarjetas |

**Los campos se localizan por alias flexibles.** `enlace` acepta `enlace`, `liga`, `link`,
`url`; `descripcion` acepta cualquier encabezado que contenga `descr`. Es lo que permite que
los encabezados los escriban personas.

> **Por qué se escribe celda por celda aquí:** `Promociones` tiene columnas que la pantalla
> no maneja. Reescribir la fila entera las borraría — a diferencia de `publicarAnuncio`, que
> sí es dueño de su hoja y puede reescribir.

> **Las pestañas sin columna `ID` la reciben automáticamente** la primera vez que se abren en
> la pantalla de gestión (`pcAsegurarIds_`), en la primera columna libre. Las lecturas de
> `Portal.gs` localizan sus columnas por encabezado, así que ninguna se entera. El motivo:
> el número de fila cambia en cuanto alguien inserta una fila desde el Sheet, y entonces la
> app editaría o borraría la fila equivocada.

---

## 5. Libro 3 · Trazabilidad (6 pestañas)

Los seis procesos homologados. Cada sección se busca por **alias de pestaña**, así que
tolera variaciones del nombre:

| Sección | Prefijo de anclaje | Alias que se buscan |
| --- | --- | --- |
| Big Ticket | `bt` | `BT`, `Big Ticket`, `BigTicket` |
| Soft Line | `sl` | *(análogo)* |
| SL Mensajerías | `slm` | *(análogo)* |
| MarketPlace | `mkp` | *(análogo)* |
| Tienda | `tda` | *(análogo)* |
| Generales / Devoluciones SAP | `gen` | *(análogo)* |

**Tres reglas de lectura que hay que respetar si tocas este módulo:**

1. **No se asume posición fija de columnas.** Cada hoja tiene su propio número de columnas
   vacías a la izquierda, y BT añade una («Tiempo avance») que las demás no tienen.
2. **El nombre del proceso está en la columna inmediatamente anterior a «Tiempo p/reporte».**
   El encabezado «Proceso» está combinado sobre varias columnas, así que su índice no sirve
   para leer datos. Esa relación sí es constante en las seis hojas.
3. **El número visible es la POSICIÓN de la fila, no el número escrito.** En la hoja hay
   números repetidos y filas sin número, y los anclajes (`bt-1`, `mkp-12`) tienen que ser
   únicos y estables porque el buscador global enlaza a ellos.

Tras editar la hoja, ejecuta `trazInvalidarCache()` para no esperar los 10 minutos de caché.

---

## 6. Datos personales

**`AtencionesPendientes` contiene nombres, teléfonos y correos de clientes reales.** Es la
pestaña más sensible del sistema. Su modelo de privacidad está en el código y hay que
respetarlo:

1. **Por omisión, una atención la ve solo quien la registró.** No es una lista de contactos
   compartida ni un CRM: es la libreta de una persona.
2. **La liberación al pool público es una decisión explícita del asesor, tomada al
   registrar.** Si no la toma, ese registro es privado **para siempre**.
3. En el pool público **no se enseña todo**: `atenVersionPublica_` recorta lo que ve quien no
   es el autor.

Al añadir cualquier lectura nueva sobre esta hoja, pásala por `atenVersionPublica_` o
justifica por escrito por qué no.

También tratan datos de cliente: `Cotizaciones` (nombre, correo, teléfono),
`MetricasCorreos` y `CorreosEnviados` (destinatarios). El tablero público de estado
**no** lleva ninguno, y está verificado.

---

## 7. Qué pasa si alguien rompe una hoja

| Lo que hicieron | Consecuencia | Cómo se arregla |
| --- | --- | --- |
| Insertar o mover una columna | **Nada.** Se busca por nombre | — |
| Renombrar un encabezado que el código busca | Ese campo llega vacío, o falla la escritura | Devuélvele el nombre. `revisionMaestra()` lo señala |
| Renombrar una pestaña | El módulo no la encuentra | Devuélvele el nombre (salvo Trazabilidad, que tiene alias) |
| Borrar la columna `ID` del Portal | Las filas se identifican mal | Se recrea sola al abrir la pantalla de gestión, pero los ID serán nuevos |
| Borrar una fila desde el Sheet | El dato se pierde | No hay papelera propia: usa el historial de versiones de Google Sheets |
| Editar mientras el sistema escribe | Posible pisado | Sin lock salvo folios y contenido del Portal |
| Cambiar el nombre del libro | Nada | Se accede por ID o por vínculo |
| Mover el libro 1 de sitio | Nada | Sigue ligado al script |

**Después de cualquier cambio de estructura, ejecuta `revisionMaestra()`.** Comprueba las
tres bases de datos pestaña por pestaña y dice exactamente qué falta.

---

## 8. Copias de seguridad

**No hay copia de seguridad programada.** Lo que hay:

- **Historial de versiones de Google Sheets** — la vía real de recuperación. Archivo →
  Historial de versiones.
- **Papelera de Drive** — 30 días para un libro borrado.
- **`BitacoraConsola`** — deja rastro de los cambios administrativos, no de los datos.
- **Este repositorio** — respalda el **código**, no los datos.

> **Recomendación pendiente:** una copia programada de las tres pestañas críticas
> (`Registros`, `Cotizaciones`, `DetalleCotizaciones`) a otro libro, con un disparador
> diario. Hoy no existe.

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
