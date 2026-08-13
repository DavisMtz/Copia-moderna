# 07 · Runbook de mantenimiento y operación

Procedimientos operativos. Este es el documento que se abre **con el sistema delante**.

---

## 1. Antes de tocar nada

| Necesitas | Cómo se consigue |
| --- | --- |
| Acceso de **editor** al proyecto de Apps Script | Lo da un maestro o el dueño del libro de cotizaciones |
| Acceso a los **tres libros** de Sheets | Cotizaciones (ligado), Portal, Trazabilidad |
| Rol **maestro** en el sistema | Consola → Roles, o `NOMBRAR_MAESTRO()` desde el editor |
| Acceso a la **carpeta de Drive** de salida | `Cotizaciones CCL generadas` |

**Primer comando siempre:** `revisionMaestra()`. Antes de diagnosticar nada, ten la foto del
sistema.

---

## 2. Anatomía del entorno

| Elemento | Dónde está |
| --- | --- |
| Código fuente (copia local) | `C:\Users\seguimientos\Desktop\Portal Ventel\Carpeta del proyecto` |
| Código en ejecución | El proyecto de Apps Script ligado al libro de cotizaciones |
| Extensión | `C:\Users\seguimientos\Desktop\Portal Ventel\Extencion para chrome` |
| Repositorio | `main` de Repofinal (se publica solo) |
| Registro de errores | Cloud Logging (`exceptionLogging: STACKDRIVER`) |
| Registro de ejecuciones | Editor de Apps Script → Ejecuciones |

> **La copia local y el código en ejecución NO están sincronizados automáticamente.** No hay
> `clasp` configurado. Copiar los archivos al editor es un paso manual. Ver §4.

---

## 3. Diagnóstico: cómo se ejecuta una función desde el editor

Es la herramienta principal de soporte de este sistema.

1. Abrir el proyecto de Apps Script (Extensiones → Apps Script desde el libro de
   cotizaciones).
2. Abrir el archivo que contiene la función.
3. Seleccionarla en el desplegable de la barra superior.
4. **Ejecutar**.
5. **Ver → Registro de ejecución** (o `Ctrl+Enter`).

La primera vez, Google pedirá autorizar los permisos. `revisionMaestra()` los pide **todos de
una vez**, porque toca todos los servicios: es la mejor función para autorizar.

**Catálogo completo de diagnósticos:** ver
[`02_Backend_GoogleAppsScript.md`](02_Backend_GoogleAppsScript.md), sección final.

### Los cinco que más se usan

| Función | Cuándo |
| --- | --- |
| `revisionMaestra()` | **Siempre primero.** ~31 comprobaciones en 10 áreas |
| `permDiagnostico(correo)` | «A fulano no le aparece el botón» |
| `secDiagnostico(correo)` | «No me deja entrar» / dudas de identidad |
| `cotInvalidarCache_()` | «Guardé y no se ve» |
| `opDiagnostico()` | El tablero de estado se comporta raro |

---

## 4. Despliegue

### 4.1 Publicar un cambio de código

1. **Copiar los archivos modificados** al editor de Apps Script (archivo por archivo).
2. Guardar.
3. **Implementar → Gestionar implementaciones**.
4. Editar la implementación **existente** (icono del lápiz).
5. Versión → **Nueva versión**. Describir el cambio.
6. **Implementar**.

> **Edita la implementación existente, no crees una nueva.** Crear una nueva genera **una URL
> distinta**, y la URL vieja se queda sirviendo el código viejo. Todos los enlaces
> repartidos, los favoritos del equipo y la URL guardada en la extensión apuntan a la
> antigua: el resultado es un equipo trabajando con dos versiones a la vez sin saberlo.

7. **Ejecutar `revisionMaestra()`** después de desplegar.
8. Abrir la app y comprobar el cambio con una cuenta que **no** sea maestra.

### 4.2 Configuración del despliegue

| Parámetro | Valor | Consecuencia |
| --- | --- | --- |
| Ejecutar como | **Usuario que implementa** | Todo corre con esa cuenta: los correos salen de ahí y los accesos a Drive/Sheets son los suyos |
| Quién tiene acceso | **Cualquier usuario del dominio** | Solo el dominio de Liverpool |

> **Si cambia la persona que despliega, cambian el remitente de los correos y los permisos
> efectivos sobre Drive.** Es el efecto secundario menos evidente de un re-despliegue hecho
> por otra cuenta.

### 4.3 Actualizar la extensión

1. Editar los archivos en `Extencion para chrome`.
2. **Subir el número de versión** en `manifest.json`.
3. `chrome://extensions` → botón de recargar de la extensión.
4. Reproducir el flujo completo: bolsa → Cotizar → la cotización se abre con artículos.

Como está sin empaquetar, **cada asesor tiene que recargarla por su cuenta**. Avisa al equipo
cuando el cambio importe.

### 4.4 Publicación del repositorio

No hay que hacer `commit` ni `push` a mano. Un hook `Stop` de Claude Code
(`~/.claude/hooks/auto-push-proyecto.ps1`, fuera del repo a propósito) hace `git add -A`,
`commit` y `push origin main` al terminar cada tarea.

Dos consecuencias:

- **Aquí no hay borradores.** Un cambio a medias llega a `main` igual que uno terminado.
- **Si mueves o renombras la carpeta, el hook deja de encontrarla.** Ya pasó una vez; ahora
  avisa en lugar de callarse, pero hay que actualizar la variable `$repo` del script.

**Finales de línea:** el repositorio usa `-text` en `.gitattributes`. Git no normaliza
CRLF/LF; cada archivo conserva los suyos. Es deliberado: sin eso, cualquier herramienta que
reescriba un archivo entero produce un diff con **todas** las líneas modificadas, lo que
entierra el cambio real. El destino es Apps Script, al que los finales de línea le dan igual.

---

## 5. Tareas periódicas

### Cada semana

- [ ] `revisionMaestra()` y revisar que no haya líneas con ✖.
- [ ] Panel de ejecuciones de Apps Script: buscar errores repetidos.
- [ ] Consola → Bitácora: revisar cambios administrativos inesperados.
- [ ] Consola → Roles: confirmar que sigue habiendo **al menos dos maestros**.

### Cada mes

- [ ] Revisar el crecimiento de `Cotizaciones` y `DetalleCotizaciones`. Una hoja muy grande
      hace que la búsqueda global se acerque al límite de tiempo de ejecución.
- [ ] Vaciar la carpeta `Cotizaciones CCL generadas` de PDF antiguos si Drive aprieta.
- [ ] Revisar `OperacionReportes`: reportes sueltos que nunca se convirtieron en incidencia.
- [ ] Probar la extensión contra una bolsa real: es lo que se rompe solo, sin que nadie toque
      nada.
- [ ] Comprobar que el alias `cotizacion@liverpool.com.mx` sigue dado de alta como «Enviar
      como» en la cuenta que despliega.

### Cada trimestre

- [ ] Repasar la lista de personas activas contra la plantilla real (altas y bajas).
- [ ] Revisar cuotas de Apps Script en el panel de Google.
- [ ] Confirmar que los secretos están fuera del código (§7).
- [ ] Exportar una copia manual de las tres pestañas críticas (no hay respaldo automático).

---

## 6. Cuotas de Google que hay que vigilar

| Recurso | Límite típico (Workspace) | Qué lo consume aquí |
| --- | --- | --- |
| Tiempo por ejecución | 6 min | Búsqueda global sobre hojas grandes |
| Correos por día | 1 500 | Cotizaciones + plantillas + códigos de alta |
| `UrlFetch` por día | 100 000 | Auditoría de precios contra liverpool.com.mx |
| Disparadores | 90 min/día | Poco uso hoy |
| Tamaño de caché | 100 KB por valor, 6 h | `Cache.gs` trocea y respeta ambos |

**El primero que se va a alcanzar es el tiempo de ejecución**, en la búsqueda global. Por eso
`busqueda` tiene el TTL más agresivo (90 s) y por eso `PoliticaRevision.gs` dejó fuera a
propósito la regla de «cliente nuevo»: obligaba a recorrer la hoja entera en cada guardado.

---

## 7. Procedimiento: sacar los secretos del código

Deuda pendiente, documentada en
[`06_Seguridad_y_Permisos.md`](06_Seguridad_y_Permisos.md) §7. Cinco minutos.

1. En el editor, ejecutar **`secGuardarConfiguracion()`**. El registro dirá qué se guardó
   (los valores sensibles salen ocultos, solo con su longitud).
2. Configuración del proyecto → **Propiedades del script**. Verificar que están:
   `AUTH_MODO`, `CUENTAS_DOMINIO`, `WEBHOOK_URL`, `HASH_SALT`, `PORTAL_SHEET_ID`,
   `CCL_TEMPLATE_SHEET_ID`, `PORTAL_CALENDAR_ID`.
3. En `Code.gs`, **vaciar** las constantes: `const HASH_SALT = "";` y `const WEBHOOK_URL = "";`
4. Guardar, desplegar nueva versión.
5. **`revisionMaestra()`** → el check *«Seguridad · Secretos fuera del código»* debe pasar.
6. **Rotar el webhook** en Google Chat y guardar el nuevo desde Consola → Ajustes → Avisos.
   El valor viejo ya está en el historial de git; vaciar la constante no lo borra de ahí.

**Comprobación funcional después:** guardar una cotización de prueba (debe llegar el aviso al
chat) e iniciar sesión con una cuenta existente (las contraseñas deben seguir funcionando —
si no, la sal no se copió bien: vuelve a poner el valor en la constante y repite).

---

## 8. Escenarios críticos

### 8.1 Nadie puede entrar al sistema

**Síntoma:** login rechaza a todo el mundo, o nadie tiene permisos.

1. `secDiagnostico('correo@liverpool.com.mx')` → ¿cómo se está resolviendo la identidad?
2. Si `AUTH_MODO` quedó en `estricto` por error: `secFijarModoAuth('portal')`.
3. Si el problema son los permisos: `VER_PERMISOS_GUARDADOS()`.
4. Si no queda ningún maestro: **`NOMBRAR_MAESTRO()`** o `permSembrarMaestro('correo')`.
5. Si la hoja `Registros` perdió una columna: `revisionMaestra()` dice cuál, y se restaura
   desde el historial de versiones del Sheet.

### 8.2 Las cotizaciones no se guardan

1. `revisionMaestra()` → área **BD Cotizaciones**.
2. El error habitual es un encabezado renombrado. El propio código lanza un mensaje que
   nombra los que espera (`Folio`, `Timestamp`, `AsesorCorreo`, `ClienteNombre`,
   `TotalGeneral`…).
3. Restaurar el encabezado desde el historial de versiones.
4. `cotInvalidarCache_()`.

### 8.3 No salen los correos

1. `revisionMaestra()` → área **Correo**.
2. Comprobar que el alias `cotizacion@liverpool.com.mx` sigue como «Enviar como» en la cuenta
   que despliega. Si no lo está, **el sistema envía desde la cuenta propia en vez de
   bloquear** — mira el remitente real de un correo reciente.
3. Revisar la cuota de correos del día.
4. Si es una cotización concreta: `revPuedeEnviarse_(folio)` — es muy probable que
   simplemente **no esté aprobada**, y ese bloqueo es correcto.

### 8.4 El Portal sale vacío

1. `revisionMaestra()` → área **BD Portal**.
2. `diagPromos()` si es el monitor de promociones.
3. `trazDiagnostico()` si son los procesos de trazabilidad.
4. Comprobar que la cuenta que despliega **sigue teniendo acceso** al libro del Portal: es la
   causa más frecuente y no da error, da vacío.
5. Forzar relectura: `diagLimpiarCache()` / `trazInvalidarCache()`.

### 8.5 El formato CCL falla

1. `probarAccesoCcl()`.
2. Comprobar que la plantilla (`CCL_TEMPLATE_SHEET_ID`) existe y es accesible.
3. Comprobar que la pestaña se sigue llamando `Liverpool` (`CCL_SHEET_NAME`).
4. Si cambió la maquetación de la plantilla, hay que revisar `fillCclSheet_`,
   `buildCclProductRow_` y `findCclSubtotalRow_`: **es la única parte del sistema que escribe
   por posición**, porque la plantilla es un documento oficial de maquetación fija.

### 8.6 El tablero de estado marca una falla que no existe

1. `opDiagnostico()`.
2. Abrir Consola / pantalla `operacion` → **descartar** la incidencia. Es lo correcto: el
   umbral automático publica una **sospecha**, y descartarla es parte del flujo previsto, no
   un arreglo.
3. Si se repite sin motivo, revisar `OP_UMBRAL_PERSONAS` (3) y `OP_VENTANA_MIN` (30). **No
   los cambies sin acordarlo**: los valores actuales se eligieron con el usuario el
   2026-08-08 tras probar 2 (demasiadas falsas alarmas) y 5 (demasiado lento).

---

## 9. Mantenimiento programado (apagar un módulo)

Cuando haya que intervenir un subsistema sin tumbar la app entera:

1. Consola → **Módulos**.
2. Apagar el bloque correspondiente. Los bloques marcados **fijo** no se pueden apagar.
3. El módulo desaparece del menú y de los buscadores para todos **salvo el maestro**, que lo
   conserva a propósito para poder volver a encenderlo.
4. Al terminar, encenderlo de nuevo.

El estado vive en la propiedad de script `PERM_MODULOS_OFF`.

---

## 10. Ventanas de cambio recomendadas

| Cambio | Cuándo |
| --- | --- |
| Despliegue de código | Fuera del horario de atención. Una implementación nueva corta las sesiones en curso |
| Cambio de estructura de hojas | Nunca en horario de atención |
| Cambio de `AUTH_MODO` | Con un maestro disponible y probado antes en una cuenta de prueba |
| Rotar `HASH_SALT` | **Nunca sin plan de restablecimiento masivo**: invalida la contraseña de todo el mundo |
| Contenido del Portal / anuncios | En cualquier momento. Solo cambia lo que se lee |

---

## 11. Contactos y escalamiento

| Situación | A quién |
| --- | --- |
| Duda de diseño o de por qué algo está así | `Carpeta del proyecto/README.md`, sección de revisiones |
| Falla funcional del sistema | Equipo Ventel / responsable técnico del proyecto |
| Falla de una plataforma corporativa (Connect, Salesforce, CCAIP) | **No es de este sistema.** Se reporta desde el propio tablero de estado |
| Acceso a hojas o Drive | Dueño del libro de cotizaciones |

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
