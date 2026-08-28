# Recursos externos del Portal Ventel · enlaces

Inventario de **todo lo que el sistema lee o escribe fuera de su propio código**: hojas de
cálculo, calendario, carpetas de Drive, correo y servicios externos.

Los ID que aparecen aquí están **duplicados a propósito**: viven como constante en el código
(el respaldo) y como *Propiedad de script* del mismo nombre (la que manda). Se cambian desde
**Consola → Ajustes → Fuentes de datos**, nunca editando el `.gs`.

> Corte del **28/08/2026**. Verificado contra las Propiedades de script del proyecto y contra
> el código en `Carpeta del proyecto/`.

---

## 1. El proyecto en sí

| Qué | Valor / enlace |
| --- | --- |
| **Proyecto Apps Script** | `1m1pwHzRuIWpUOlSzw7cwrdmbA06_lPEHgkmGpiFdDA6XpO6Y-2jyZCHz` · [abrir editor](https://script.google.com/home/projects/1m1pwHzRuIWpUOlSzw7cwrdmbA06_lPEHgkmGpiFdDA6XpO6Y-2jyZCHz/edit) |
| **Web app en producción** (@121) | https://script.google.com/a/liverpool.com.mx/macros/s/AKfycbwGYZs3C-dsZbIWVn27uEaLm_rXQGhiQc9Q54btPxPb-Z1SX0Enx7NlPqKw4STizaOU/exec |
| **Despliegue de pruebas** (@HEAD) | `AKfycbxBIufpjoQMbzjw8ELNeHc-arU07ELLynKxxlKFtPk` |
| Acceso | Dominio `liverpool.com.mx`, se ejecuta **como quien despliega** |

---

## 2. Hojas de cálculo · dónde se guardan y se leen los datos

### 2.1 · BD Cotizaciones — el libro principal ✍️ escribe y lee

- **Cómo se accede:** ligado al script, `SpreadsheetApp.getActiveSpreadsheet()`. **No tiene ID
  en el código ni en las propiedades**, por eso es el único sin enlace en esta lista.
- **Cómo abrirlo:** editor de Apps Script → **Información general**, o desde la hoja →
  *Extensiones → Apps Script*.
- **Enlace:** `https://docs.google.com/spreadsheets/d/________/edit` ← *pendiente de pegar*
- **17 pestañas.** Solo `Registros` la edita gente; el resto las escribe el sistema.

| Pestaña | La usa | Guarda |
| --- | --- | --- |
| `Registros` | `Code.gs`, `Cuentas.gs` | Las personas: nombre, correo, hash de contraseña |
| `Cotizaciones` | `Code.gs`, `Revision.gs` | Cabecera de cada cotización |
| `DetalleCotizaciones` | `Code.gs` | Las partidas de cada cotización |
| `_PermisosSistema` *(oculta)* | `Permisos.gs` | Rol y permisos por persona |
| `_PreferenciasUsuario` | `Preferencias.gs` | Tema, densidad, accesos fijados |
| `BitacoraConsola` | `Consola.gs` | Quién cambió qué en la consola |
| `MetricasCorreos` | `Metricas.gs` | Fuente única de métricas de correo |
| `MetricasBusquedas` | `Monitoreo.gs` | Qué busca el equipo |
| `Grupos` | `Grupos.gs` | Listas de personas para copiar y difundir |
| `CorreosEnviados` | `CorreoCliente.gs` | Bitácora de plantillas a cliente |
| `Onboarding` | `Onboarding.gs` | Qué tutorial vio cada quien |
| `AtencionesPendientes` | `Atenciones.gs` | Pendientes con **datos de clientes** |
| `AtencionesTipos` | `Atenciones.gs` | Catálogo que se alimenta con el uso |
| `OperacionReportes` | `Operacion.gs` | Cada aviso de falla de un asesor |
| `OperacionIncidentes` | `Operacion.gs` | La falla agregada |
| `OperacionActualizaciones` | `Operacion.gs` | Historial de una incidencia |
| `OperacionCatalogo` | `Operacion.gs` | Sistemas, motivos y estados |

### 2.2 · Hoja del Portal ✍️ escribe y lee

- **ID:** `1l3cdEOUnD1Rgk1VCDfx48NWd_mcgIQ7Gkt2YhwbRs34` · propiedad `PORTAL_SHEET_ID`
- **Enlace:** https://docs.google.com/spreadsheets/d/1l3cdEOUnD1Rgk1VCDfx48NWd_mcgIQ7Gkt2YhwbRs34/edit
- **La usan:** `Portal.gs`, `PortalContenido.gs`, `Publicaciones.gs`, `Articulos.gs`
- Se edita desde la app en *Contenido del Portal* (`portal_contenido`).
- **14 pestañas:**

| Pestaña | Alimenta |
| --- | --- |
| `Herramientas` | Portal → Herramientas y los accesos directos del inicio |
| `Plantillas` | Portal → Plantillas · pantalla «Correos a clientes» |
| `Formatos` | Portal → Formatos |
| `Presentaciones` | Portal → Presentaciones |
| `Paqueterias` | Portal → Paqueterías |
| `PdePago` | Portal → Planes de pago |
| `Promociones` | Monitor de promociones · widget «Hoy en promociones» |
| `MKP` | Monitor de promociones (Marketplace) |
| `Anuncios` | Publicaciones del Portal: banner, destacado, tarjeta, modal, encuesta |
| `Votos` | Un renglón por voto de encuesta |
| `Articulos` | Artículos, con el contenido en JSON de bloques |
| `ArticulosVistas` | Quién leyó cada artículo |
| `Reportes` | El botón «Reportar» de las tarjetas |
| `Avisos` | *(legado)* respaldo antiguo de banners |

### 2.3 · Hoja de Trazabilidad / Homologación 📖 solo lectura

- **ID:** `1EGCG2OaBAPOYPhUdAjIFj3OrDUYoQmIL7S81qEc8tzo` · propiedad `TRAZ_SHEET_ID`
- **Enlace:** https://docs.google.com/spreadsheets/d/1EGCG2OaBAPOYPhUdAjIFj3OrDUYoQmIL7S81qEc8tzo/edit
- **La usa:** `Trazabilidad.gs`
- **6 pestañas**, buscadas por alias de nombre: Big Ticket (`BT`), Soft Line
  (`SL logistica interna`), SL Mensajerías, MarketPlace (`MKP`), Tienda Física, Generales.
- Tras editarla, corre `trazInvalidarCache()` para no esperar los 15 min de caché.

### 2.4 · Plantilla CCL Liverpool 📋 se copia, no se escribe

- **ID:** `1zD_0TiN7EBKfYIjNWzAH77pYJ021GGqilI1jUJ000sI` · propiedad `CCL_TEMPLATE_SHEET_ID`
- **Enlace:** https://docs.google.com/spreadsheets/d/1zD_0TiN7EBKfYIjNWzAH77pYJ021GGqilI1jUJ000sI/edit
- **La usa:** `Formatos.gs` · pestaña `Liverpool`
- De aquí sale el formato oficial: se hace una **copia temporal**, se llena, se exporta a PDF y
  la copia se borra.

### 2.5 · Home Promociones comercial 📖 solo lectura

- **ID:** lo aporta el usuario desde la pantalla; respaldo en código
  `1rZCrNpNAiuh1rFwH9YpWz0n7TIgviFmwwxnQFFIj7SE` (`PROMOS_COMERCIAL_ID`)
- **Enlace:** https://docs.google.com/spreadsheets/d/1rZCrNpNAiuh1rFwH9YpWz0n7TIgviFmwwxnQFFIj7SE/edit
- **La usa:** `PortalPromosComercial.gs`
- Es el archivo de comercial. Las **pestañas son fechas** («10-17 AGOSTO») y el sistema
  interpreta el nombre para saber cuál está vigente. Nunca se escribe en él.

---

## 3. Calendario

| Qué | Valor |
| --- | --- |
| **Calendario comercial** 📖 solo lectura | `liverpool.com.mx_7vl69nu0ep7fp5mkn36bjejheg@group.calendar.google.com` |
| Propiedad | `PORTAL_CALENDAR_ID` |
| Lo usa | `Portal.gs` (promociones vigentes) y `Admin.gs` (diagnóstico) |
| Permiso | `calendar.readonly`: la cuenta que ejecuta necesita que se lo compartan |
| Enlace | https://calendar.google.com/calendar/embed?src=liverpool.com.mx_7vl69nu0ep7fp5mkn36bjejheg%40group.calendar.google.com |

---

## 4. Carpetas de Drive

| Carpeta | Cómo se localiza | Para qué |
| --- | --- | --- |
| **Anuncios del Portal** | ID `1CPLtO65_xRWgL2IAuOG-n8UFMyMg8R97` (`PORTAL_ANUNCIOS_FOLDER_ID`); respaldo por nombre `Portal Ventel` | Imágenes de las publicaciones. Se comparten «cualquiera con el enlace, lector» |
| ↳ enlace | https://drive.google.com/drive/folders/1CPLtO65_xRWgL2IAuOG-n8UFMyMg8R97 | |
| **Cotizaciones CCL generadas** | **Por nombre** (`CCL_OUTPUT_FOLDER_NAME`). Si no existe, se crea | Los PDF del formato oficial CCL |
| **Ventel · Evidencias de operación** | Propiedad `OPERACION_EVIDENCIAS_FOLDER_ID`, hoy **vacía**; respaldo por nombre. Si no existe, se crea | Capturas que adjunta un asesor al reportar una falla |
| **Instalador de la extensión Chrome** | ID `1NSPE-03rT4G5iO5soZeEiScexSY_ZJ4l`, fijo en `app_extension_guia.html` | De aquí baja el equipo el ZIP de la extensión |
| ↳ enlace | https://drive.google.com/drive/folders/1NSPE-03rT4G5iO5soZeEiScexSY_ZJ4l | |

Drive se usa además **sin carpeta fija** en dos sitios:

- `Articulos.gs` y `Portal.gs` suben imágenes y las comparten con enlace público de lectura.
- `Cuentas.gs` crea un HTML suelto («Ventel · vista previa de correos de cuenta») cuando se
  pide la vista previa de los correos de cuenta. Es diagnóstico, no producción.

---

## 5. Correo

| Qué | Valor |
| --- | --- |
| Remitente de las cotizaciones | Alias «Enviar como», propiedad `MAIL_ALIAS` (ej. `ventel@liverpool.com.mx`) |
| Nombre visible al cliente | `CC_SENDER_NAME` (ej. «Ventel Liverpool») |
| Copia oculta global | `CORREO_CCO_GLOBAL` — hoy **sin configurar**. Los correos de seguridad nunca se copian |
| Grupo de cotizaciones | https://groups.google.com/a/liverpool.com.mx/g/cotizacion *(en `correo_cliente.html`)* |
| Dominio de las cuentas | `CUENTAS_DOMINIO` = `liverpool.com.mx` |

Lo mandan `Correos.gs`, `CorreoCliente.gs`, `Cuentas.gs`, `Difusion.gs` y `Revision.gs`: con
`GmailApp` si el alias existe, con `MailApp` si no.

---

## 6. Servicios externos que el sistema llama

| Destino | Quién llama | Para qué |
| --- | --- | --- |
| **Google Chat · webhook de cotizaciones** | `Code.gs` | Avisar cuando se crea una cotización. `WEBHOOK_URL`, espacio `AAQAF6OTWgk` |
| **Google Chat · webhook de reportes** | `Operacion.gs` | Copia de cada reporte suelto. `OPERACION_WEBHOOK_REPORTES`, espacio `AAQAxdb1Mfc` |
| **Google Chat · webhook de estado** | `Operacion.gs` | Caídas, restablecimientos y mantenimientos. `OPERACION_WEBHOOK_ESTADO` — hoy **sin configurar** |
| `docs.google.com/…/export?format=pdf` | `Formatos.gs` | Exportar la copia CCL a PDF con el token del script |
| `liverpool.com.mx/tienda/pdp/…` | `Revision.gs` | Traer la ficha del artículo para revisar la cotización |
| `gcp-na-app.contentstack.com` | `revision_cotizacion.html` | Imágenes y datos de la ficha |
| `ss628.liverpool.com.mx/xl/{sku}.jpg` | Extensión Chrome | Imagen del artículo por SKU |
| `drive.google.com/thumbnail?id=…` | Portal y artículos | Miniaturas de lo subido a Drive |
| `embed.diagrams.net` | `articulo.html` | Editor de diagramas draw.io dentro de un artículo |

> ⚠️ Las URL de webhook **llevan `key` y `token` dentro**: son secretos y por eso aquí solo va
> el identificador del espacio. El valor completo vive en las Propiedades de script y en
> Consola → Ajustes → Avisos. Solo se aceptan webhooks a `chat.googleapis.com`
> (`CONSOLA_WEBHOOK_HOSTS`).

Los hosts a los que puede salir la **extensión de Chrome** están declarados en su
`manifest.json`: `*.liverpool.com.mx/tienda/*`, `*.googleusercontent.com` y el `/exec` del
Portal.

---

## 7. Permisos que pide el proyecto

De `appsscript.json` — la lista corta de *todo* lo que puede tocar:

| Permiso | Qué habilita |
| --- | --- |
| `spreadsheets` | Los cinco libros de arriba |
| `drive` | Las carpetas, las imágenes y las copias de la plantilla CCL |
| `calendar.readonly` | El calendario comercial |
| `script.external_request` | Los webhooks, la exportación a PDF y las fichas de Liverpool |
| `script.send_mail` + `mail.google.com` | Cotizaciones, plantillas, difusión y avisos |
| `userinfo.email` | Saber quién entró |

---

## 8. Lo que NO es una fuente externa

Para no buscarlo donde no está:

- **`CacheService`** y **`PropertiesService`** guardan caché y ajustes dentro del propio
  proyecto. Ahí viven `COT_CACHE_GEN`, `OP_CACHE_GEN`, `IDC_CACHE_GEN`, `HASH_SALT`,
  `formatos_habilitados`, `revision_politica_v1`, `PERM_MODULOS_OFF`, `AUTH_MODO` y
  `CONSOLA_ULTIMA_SALUD`.
- **`LockService`** solo serializa escrituras; no guarda nada.
- Los logotipos de tiendas en `Index.html` salen de sitios públicos ajenos (Wikimedia,
  1000marcas, vectorseek). Son decoración, no datos.
