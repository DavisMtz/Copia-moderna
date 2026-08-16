# Portal Ventel · Manual técnico de soporte y mantenimiento

Documentación para la persona que tenga que **dar soporte, actualizar o mantener** este
sistema. No asume que conozcas el proyecto: asume que sabes leer código y que alguien te
acaba de entregar las llaves.

| | |
| --- | --- |
| **Sistema** | Portal Ventel — cotizaciones, portal de información, operación y extensión de Chrome |
| **Organización** | El Puerto de Liverpool · Equipo Ventel |
| **Plataforma** | Google Apps Script (runtime V8) + Google Sheets + Chrome Extension (Manifest V3) |
| **Zona horaria del proyecto** | `America/Mexico_City` |
| **Carpeta raíz** | `C:\Users\seguimientos\Desktop\Portal Ventel` |
| **Estado** | v0.9 — pruebas de control / producción inicial |
| **En desarrollo desde** | Mayo 2025 |
| **Documentación revisada** | Agosto 2026 |

---

## 1. Qué es esto, en una página

Portal Ventel son **tres piezas que se usan juntas** y se despliegan por separado:

1. **La webapp de Apps Script** (`Carpeta del proyecto/`). Es el 90 % del sistema. Sirve
   todas las pantallas, guarda las cotizaciones, manda los correos, controla los permisos
   y publica el tablero de estado.
2. **La extensión de Chrome** (`Extencion para chrome/`). Se instala en el navegador del
   asesor. Lee la bolsa de compras de `liverpool.com.mx` y la deja caer dentro de una
   cotización nueva sin teclear nada.
3. **Las hojas de cálculo**. Son la base de datos. No hay servidor SQL, no hay Firestore:
   son pestañas de Google Sheets y por eso mucha gente ajena al código puede romperlas
   (ver [`04_BaseDeDatos_y_Hojas.md`](04_BaseDeDatos_y_Hojas.md)).

El flujo que justifica todo lo demás:

```
El asesor entra al Portal  →  arma una cotización  →  el sistema decide si necesita
revisión  →  un supervisor la aprueba  →  se genera el PDF  →  se envía al cliente.
```

Alrededor de ese flujo hay cuatro subsistemas que crecieron después y que hoy pesan tanto
como él: **permisos por bloques**, **estado de operación** (¿está caído Connect o soy yo?),
**atenciones pendientes** (rescatar al cliente que se quedó colgado en una caída) y la
**consola de administración**.

---

## 2. Inventario verificado

Conteo real de archivos, hecho sobre el repositorio, no estimado.

| Ubicación | Contenido | Cantidad |
| --- | --- | --- |
| `Carpeta del proyecto/` | Backend Apps Script (`.gs`) | **31** |
| `Carpeta del proyecto/` | Pantallas y módulos (`.html`) | **46** |
| `Carpeta del proyecto/` | Manifiesto `appsscript.json` | 1 |
| `Carpeta del proyecto/` | `README.md`, `.gitattributes`, `.claude/settings.json` | 3 |
| `Extencion para chrome/` | Código de la extensión (`.js`, `.html`, `.css`, `manifest.json`) | **13** |
| `Extencion para chrome/Mi Bolsa_files/` | Captura de una página real de Liverpool para probar sin navegador | banco de pruebas |
| `Documentacion/` | Este manual | 14 documentos |

Cifras clave del modelo, también verificadas contra el código:

- **24 bloques de permisos** en 4 grupos (`PERM_BLOQUES`, `Permisos.gs`).
- **3 roles**: `normal` (Asesor), `avanzado` (Supervisor), `maestro`.
- **4 modos de autenticación**: `portal`, `auto`, `estricto`, `legado`.
- **18 parámetros de vista** en el contrato de URLs (`PARAMS_VISTA`, `Code.gs`).
- **17 páginas de app** con sesión + **3 páginas públicas** del Portal.
- **~45 comprobaciones** en 13 áreas dentro de `revisionMaestra()` (el total exacto varía:
  hay dos bucles que generan un check por pestaña del Portal).
- **3 libros de Google Sheets** en uso + 1 plantilla + 1 archivo externo de comercial.

---

## 3. Los catorce documentos

| # | Documento | Léelo cuando… |
| --- | --- | --- |
| 00 | **`00_README_Inicio.md`** (este) | Es tu primer día. |
| 01 | [`01_Arquitectura_General.md`](01_Arquitectura_General.md) | Necesitas entender cómo encajan las piezas antes de tocar nada. |
| 02 | [`02_Backend_GoogleAppsScript.md`](02_Backend_GoogleAppsScript.md) | Vas a modificar lógica de servidor. Referencia archivo por archivo. |
| 03 | [`03_Frontend_y_Vistas.md`](03_Frontend_y_Vistas.md) | Vas a tocar una pantalla, el menú, la caché del cliente o la navegación. |
| 04 | [`04_BaseDeDatos_y_Hojas.md`](04_BaseDeDatos_y_Hojas.md) | Alguien movió una columna, o necesitas saber dónde vive un dato. |
| 05 | [`05_Extension_Chrome.md`](05_Extension_Chrome.md) | La extensión dejó de extraer, o Liverpool cambió su página. |
| 06 | [`06_Seguridad_y_Permisos.md`](06_Seguridad_y_Permisos.md) | «A fulano no le aparece el botón», o vas a añadir una capacidad nueva. |
| 07 | [`07_Guia_de_Mantenimiento_y_Operacion.md`](07_Guia_de_Mantenimiento_y_Operacion.md) | Vas a desplegar, o algo está roto en producción. **Runbook.** |
| 08 | [`08_Tareas_Frecuentes.md`](08_Tareas_Frecuentes.md) | Tienes que hacer un cambio concreto y quieres la receta exacta. |
| 09 | [`09_Solucion_de_Problemas.md`](09_Solucion_de_Problemas.md) | Tienes un síntoma y no sabes de dónde viene. **Búscalo por síntoma.** |
| 10 | [`10_Sincronizacion_Apps_Script.md`](10_Sincronizacion_Apps_Script.md) | Vas a montar (o se te rompió) la publicación automática de `main` hacia Apps Script, o necesitas publicar un cambio sin tener la PC delante. |
| 11 | [`11_Animacion_GSAP.md`](11_Animacion_GSAP.md) | Vas a tocar una animación, un loader o una transición, o algo «parpadea», «salta» o se queda oculto al animar. |
| 12 | [`12_Plan_de_Mejora.md`](12_Plan_de_Mejora.md) | **Cerrado.** Registro histórico de la auditoría de agosto de 2026 y de lo ejecutado entonces. |
| 13 | [`13_Plan_Cierre_v1.md`](13_Plan_Cierre_v1.md) | **El plan vigente.** Vas a empezar cualquier tarea nueva: búscala ahí, lee su fase y registra lo hecho en su §18. |

---

## 4. Ruta para el técnico que llega nuevo

**Primeros 30 minutos — orientación (no toques nada todavía).**

1. Lee este documento entero y el capítulo 1 y 2 de
   [`01_Arquitectura_General.md`](01_Arquitectura_General.md).
2. Abre `Carpeta del proyecto/README.md`. No es un README de cortesía: contiene el registro
   de revisiones por módulo, con **qué se corrigió y qué se dejó como está a propósito**.
   Cuando algo te parezca mal diseñado, búscalo ahí antes de «arreglarlo»: es muy probable
   que ya se haya decidido, con motivo escrito.
3. Abre `Code.gs` y lee `PAGES`, `PORTAL_PAGES` y `PARAMS_VISTA` (líneas 56–124). Ese es el
   mapa de rutas de todo el sistema.

**Siguientes 2 horas — acceso real.**

4. Consigue acceso de edición al proyecto de Apps Script y a los tres libros de Sheets.
5. En el editor de Apps Script, ejecuta **`revisionMaestra()`** (`Admin.gs`). Autoriza
   todos los permisos cuando Google los pida. El registro de ejecución te dirá, línea por
   línea, qué está sano y qué está roto **hoy**. Es la mejor foto del sistema que existe.
6. Ejecuta `VER_CORREOS_REGISTRADOS()` y `VER_PERMISOS_GUARDADOS()` (`Permisos.gs`) para
   ver quién es quién.

**Antes de tu primer cambio.**

7. Lee [`08_Tareas_Frecuentes.md`](08_Tareas_Frecuentes.md). Si tu cambio está ahí, sigue la
   receta: cubre los sitios espejo que hay que tocar a la vez y que no son evidentes.
8. Lee la sección «Reglas que no se rompen» de abajo.

---

## 5. Reglas que no se rompen

Estas ocho reglas condensan los errores que ya se cometieron una vez en este proyecto. No
son estilo: cada una tiene una avería detrás.

1. **`PAGES` (servidor, `Code.gs`) y `AppUrl` (cliente, `app_core.html`) son listas espejo.**
   Si añades una página en una y no en la otra, la navegación cae al Portal en silencio: el
   enrutador resuelve como Portal cualquier página que no reconoce. No falla, no avisa,
   simplemente no va a donde dijiste.

2. **El permiso del cliente es cortesía; el candado es del servidor.** `requireBlock()`,
   los filtros de menú y los botones escondidos solo deciden **qué se dibuja**. El candado
   real es `secIdentidadConBloque_()` (`Seguridad.gs`), y se vuelve a exigir en **cada**
   llamada. Una función nueva expuesta al cliente sin gate de servidor es un agujero, por
   mucho que su botón esté escondido.

3. **Los formatos de cotización que ya salen al cliente no se tocan.** El PDF `actual` y el
   formato oficial `ccl_liverpool` reproducen documentos aprobados. Un ajuste «estético»
   ahí cambia lo que recibe un cliente real.

4. **Las columnas se localizan por su NOMBRE de encabezado, nunca por su posición.** Todo
   el sistema lee así (`indexOf("Folio")`, `pcMapaColumnas_`, `atenIndice_`, `opIndice_`).
   Si escribes `fila[3]`, funcionará hasta que alguien inserte una columna en el Sheet, y
   entonces fallará en silencio escribiendo el dato equivocado.

5. **Al actualizar una fila se escribe celda por celda, solo en las columnas que manejas.**
   Reescribir la fila entera borra columnas de otros módulos (`LinkSheetCCL`, las de
   revisión) y convierte fórmulas en valores muertos.

6. **Toda escritura invalida la caché.** `cotInvalidarCache_()`, `pcInvalidarCache_()`,
   `opInvalidarCache_()`, `trazInvalidarCache()`. Si guardas sin invalidar, el usuario ve
   su propio cambio desaparecer al recargar y abre un ticket que no vas a poder reproducir.

7. **Los secretos van en las propiedades del script, no en el código.** Ejecuta
   `secGuardarConfiguracion()` (`Seguridad.gs`). Ver la nota de deuda pendiente en
   [`06_Seguridad_y_Permisos.md`](06_Seguridad_y_Permisos.md) §6.

8. **En esta carpeta no hay borradores.** Un hook `Stop` de Claude Code
   (`~/.claude/hooks/auto-push-proyecto.ps1`) hace `git add -A`, `commit` y `push origin main`
   al terminar cada tarea. Un cambio a medias llega a `main` igual que uno terminado — y
   desde `main` entra solo al proyecto de Apps Script
   ([`10_Sincronizacion_Apps_Script.md`](10_Sincronizacion_Apps_Script.md)). Si trabajas en
   algo que no debe verse todavía, hazlo en una rama.

---

## 6. Glosario

Términos que aparecen por todo el código y que no significan lo que parece.

| Término | Qué es aquí |
| --- | --- |
| **Bloque** | Unidad mínima de permiso (`cotizar`, `revisar`, `adm_ajustes`). Se concede o se quita. No confundir con «rol». |
| **Rol** | Paquete de bloques: `normal`, `avanzado`, `maestro`. |
| **Ajuste** (de permisos) | Concesión (`mas`) o retiro (`menos`) por persona, **encima** del rol. |
| **Módulo apagado** | Bloque desactivado globalmente por mantenimiento. El maestro se lo salta a propósito. |
| **Incidencia** | Falla de un sistema corporativo (Connect, Salesforce…) confirmada o sospechada. |
| **Reporte** | Aviso individual de un asesor. Tres reportes de personas distintas en 30 min crean una incidencia sola. |
| **Atención** | Cliente que se quedó sin atender por una caída, y al que hay que devolver la llamada. |
| **Pool público** | Atenciones que su autor liberó para que cualquier compañero las rescate. |
| **Vale** | Token de un solo uso que separa «probé que el correo es mío» de «escribo la contraseña nueva». |
| **Generación** | Contador que sube en cada escritura y sirve para invalidar toda la caché de golpe. |
| **SWR** | *stale-while-revalidate*: se pinta lo guardado al instante y se revalida por detrás. Patrón por defecto del cliente. |
| **Shell** | Marco común de las pantallas de app (`app_shell.html`): barra lateral, cabecera, isla de estado. El Portal **no** lo usa. |
| **Flight data** | Los `self.__next_f.push([...])` que Next.js deja en el HTML de Liverpool. De ahí saca la extensión los datos que la página no enseña. |

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
