# 08 · Tareas frecuentes · recetas paso a paso

Cada receta cubre **todos los sitios que hay que tocar**, incluidos los espejo que no son
evidentes. Sigue los pasos en orden; el último de cada receta es siempre la comprobación.

---

## 1. Dar de alta a una persona

**Vía normal (Consola):** Consola → Roles → Alta. Se manda un correo de bienvenida con
contraseña temporal, y el sistema obliga a cambiarla al primer acceso.

**Requisitos:** tener `adm_miembros` o `sup_equipo`, y que el correo sea del dominio
permitido (`CUENTAS_DOMINIO`, por defecto `liverpool.com.mx`).

**Si la Consola no está disponible:** añadir la fila a `Registros` a mano con `Nombre`,
`Email` y `Avanzado` = `No`. Esa persona podrá registrarse con el flujo de código por correo.
**No inventes un `PasswordHash` a mano**: se escribe con la sal y no hay forma práctica de
generarlo desde el Sheet.

**Comprobación:** `permDiagnostico('correo')` debe listar los bloques del rol `normal`.

---

## 2. Cambiar el rol o los accesos de alguien

1. Consola → **Roles** → buscar a la persona.
2. Cambiar el rol, o conceder/retirar bloques sueltos (los ajustes `mas` / `menos`).
3. **La persona tiene que volver a entrar** para que su navegador refresque los bloques
   guardados. El servidor ya aplica el cambio inmediatamente; lo que se queda viejo es el
   menú que dibuja el cliente.

**Límites que la consola aplicará sola:** solo alcanzas a quien esté en tu mismo nivel o por
debajo, nunca a tu propia cuenta, y no puedes conceder un rol por encima del tuyo ni repartir
bloques que no tienes.

**Comprobación:** `permDiagnostico('correo')` dice **de dónde sale cada bloque** (del rol, de
un `mas`, o retirado por un `menos`).

---

## 3. Añadir un bloque de permiso nuevo

Toca **cuatro sitios**. Saltarse cualquiera deja el bloque a medias.

1. **`Permisos.gs` → `PERM_BLOQUES`**: añadir la entrada.

   ```js
   { id: 'mi_bloque', nombre: 'Nombre en pantalla', grupo: 'Supervisión',
     detalle: 'Qué deja hacer exactamente, en cristiano.',
     pagina: 'mi_pantalla',   // '' si no abre ninguna
     admin: false, fijo: false },
   ```

   - El `id` **nunca se renombra** después: se guarda como texto en la columna `Permisos` de
     cada persona.
   - El `grupo` debe existir en `PERM_GRUPOS`.
   - `detalle` se lee en la matriz de la consola: escríbelo para quien no programa.

2. **`Permisos.gs` → `PERM_ROLES`**: añadir el `id` a los roles que deban tenerlo.
   `maestro` **no** hace falta: se calcula desde la lista completa.

3. **El gate en el servidor**: en cada función que el bloque protege,
   `secIdentidadConBloque_(email, 'mi_bloque')`.

4. **El cliente**: `requireBlock('mi_bloque')` en la pantalla y la entrada correspondiente en
   el catálogo del buscador general (`app_comando`), declarando sus bloques.

**Comprobación:** `revisionMaestra()` → área **Permisos**; y `permDiagnostico(correo)` con
una cuenta que deba tenerlo y otra que no.

---

## 4. Añadir una pantalla nueva

Toca **dos listas espejo**. Es el fallo silencioso más común del proyecto.

1. **Crear el archivo** `mi_pantalla.html` siguiendo el orden canónico de includes
   ([`03_Frontend_y_Vistas.md`](03_Frontend_y_Vistas.md) §2). **`window.__APP__` antes de
   `app_core`.**

2. **Servidor — `Code.gs` → `PAGES`:**

   ```js
   'mi_pantalla': { file: 'mi_pantalla', title: 'Mi pantalla - Sistema Ventel' },
   ```

3. **Cliente — `app_core.html` → `AppUrl`:** registrar la misma clave.

   > Si haces solo el paso 2, la pantalla existe pero el menú no sabe llegar. Si haces solo
   > el paso 3, cada clic **cae al Portal en silencio**: el enrutador resuelve como Portal
   > cualquier página que no reconoce.

4. **Permiso**: crear su bloque (§3) o reutilizar uno, y ponerlo en `pagina` de ese bloque.

5. **Menú**: `AppShell.mount({ active: 'mi_pantalla', title: '…' })`.

6. **Buscador general**: añadirla al catálogo de `app_comando` con sus bloques.

7. **Si necesita un parámetro nuevo en la URL**: ver §5.

**Comprobación:** entrar con una cuenta sin el bloque (no debe verla ni poder abrirla por
URL) y con una que lo tenga; probar el botón atrás del navegador.

---

## 5. Añadir un parámetro de vista a la URL

Son **tres listas espejo** y el sistema no avisa cuando dejan de decir lo mismo:

1. **`Code.gs` → `PARAMS_VISTA`**: añadir el nombre al arreglo.
2. **`app_core.html` → `AppUrl`**: añadirlo a su lista espejo, para que `AppUrl.params()` lo
   devuelva.
3. **`Index.html` → `PASAN`**: para que el buscador del Portal lo arrastre al navegar.
4. Documentar en el comentario de `PARAMS_VISTA` **qué va en él**, siguiendo el criterio ya
   establecido (identidad / modificador / filtro aplicado / término de búsqueda).

> Se inyecta en **todas** las plantillas, aunque solo lo use una. Es a propósito: una
> plantilla de Apps Script revienta al evaluar una variable que no se le pasó, y así añadir
> un parámetro es una línea en una lista en vez de una cacería por 40 archivos.

> **No hay que tocar ninguna pantalla.** Todas escriben `window.__APP__ = <?!= APP_JSON ?>;`,
> que trae el juego entero, así que el parámetro nuevo llega a las diecinueve por el paso 1.
> Antes cada pantalla elegía a mano qué copiar y añadir un parámetro exigía acordarse de
> inyectarlo en cada una: el día que se olvidaba, el enlace profundo moría en silencio.

**Caso real:** `item` funcionaba «de casualidad» porque el Portal lee la URL real, pero
`AppUrl.params()` no lo devolvía. Se añadió a las dos listas.

**Comprobación:** construir un enlace con el parámetro, abrirlo en una pestaña nueva y
comprobar que la pantalla arranca ya situada. Después, cambiar de estado dentro de la
pantalla y verificar que la barra de direcciones se actualiza.

---

## 6. Añadir una sección editable al Portal

Gracias al catálogo declarativo, **no hay que escribir otro CRUD**.

1. Crear la pestaña en la hoja del Portal con sus encabezados.
2. **`PortalContenido.gs` → `PC_COLECCIONES`**: añadir una entrada.

   ```js
   { id: 'mi_seccion', nombre: 'Mi sección', hoja: 'MiPestana',
     resumen: 'Qué guarda, en cristiano.',
     donde:   'Dónde lo ve el asesor.',
     prefijo: 'mis', titulo: 'nombre', subtitulo: 'descripcion',
     enlaceCampo: 'liga',
     campos: [
       { id: 'nombre', etiqueta: 'Nombre', alias: ['nombre'], tipo: 'texto',
         requerido: true, max: 140 },
       { id: 'liga', etiqueta: 'Enlace', alias: ['liga','enlace','link','url'],
         tipo: 'url', max: 800 }
     ] },
   ```

   - **`alias`** son los encabezados que se aceptan. Pon todas las variantes que la gente
     escribe de verdad: los encabezados de esas hojas los escriben personas.
   - **`donde`** no es decorativo: sin él nadie sabe qué está publicando.

3. Si el Portal debe **leerla**, añadir la lectura en `Portal.gs → buildToolsData_()` con los
   mismos alias.

4. La columna `ID` se crea sola la primera vez que se abre la sección (`pcAsegurarIds_`).

**Comprobación:** `pcRevisarCatalogo()` y `revisionMaestra()` → área **BD Portal**.

---

## 7. Añadir un formato de cotización

1. **`Formatos.gs` → `QUOTE_FORMATS`**: añadir `{ id, nombre, … }`. El `id` se guarda en las
   preferencias y en la URL: no se renombra.
2. Implementar su generador y enchufarlo en `generateQuotePdfBlob(folio, formatId)`.
3. Añadir su comprobación de disponibilidad en `checkFormatAvailability_(formatId)`.
4. Habilitarlo desde Consola → Formatos.

> **Los formatos que ya salen al cliente (`actual`, `ccl_liverpool`) no se tocan.** Reproducen
> documentos aprobados; un ajuste «estético» cambia lo que recibe un cliente real.

**Comprobación:** generar un PDF de un folio de prueba con el formato nuevo y con los dos
existentes, y comparar que los viejos salen idénticos.

---

## 8. Cambiar la política de revisión

**No se toca el código.** Se hace desde la pantalla de supervisión (bloque
`politica_revision`).

1. Panel de supervisión → Política de revisión.
2. Ajustar el interruptor maestro, los criterios y su **orden** (el orden **es** la prioridad:
   gana el primero que coincide) y la acción por defecto.
3. **Usar el simulador** antes de guardar. No reimplementa la lógica: llama a
   `simularPoliticaRevision`, que ejecuta el mismo evaluador que decide de verdad.

Si tienes que tocarla desde el editor, vive en la propiedad `revision_politica_v1`.
Diagnóstico: `revpolDiagnostico()`.

---

## 9. Cambiar los umbrales del estado de operación

En `Operacion.gs`:

| Constante | Valor actual | Qué controla |
| --- | --- | --- |
| `OP_UMBRAL_PERSONAS` | `3` | Personas distintas que disparan una incidencia |
| `OP_VENTANA_MIN` | `30` | Ventana de conteo, en minutos |
| `OP_UMBRAL_SERVICIO_ACTIVO` | `true` | Segundo umbral por sistema, sin mirar el motivo |
| `OP_AVISO_POSIBLE` | *(texto)* | Lo que lee el público al saltar el umbral |

> **Los valores actuales se eligieron con el usuario el 2026-08-08**, tras probar 2
> (un problema de red de una sola sala levantaba bandera nacional) y 5 (una caída real
> tardaba demasiado en verse). **No los cambies sin acordarlo.**

Poner `OP_UMBRAL_SERVICIO_ACTIVO = false` devuelve el módulo al comportamiento anterior sin
tocar nada más.

**Cuidado con el texto público:** está redactado como **sospecha con respaldo**, no como
hecho, para que si resulta falsa alarma nadie tenga que desdecirse. **No lleva el número de
personas ni quiénes son** — eso es para la nota interna, no para la calle.

---

## 10. Añadir un aviso o anuncio al Portal

Pantalla `anuncios` (bloque `anuncios`). Cuatro formatos: `banner`, `destacado`, `tarjeta`,
`modal`. Admite programación (`Desde` / `Hasta`), orden y subida de imágenes.

**No lo hagas editando la hoja `Anuncios` a mano**: la columna `Datos` es JSON y el
constructor la escribe con su forma.

Si no aparece: `portalInvalidarCacheAnuncios_()` (la caché del Portal es de 10 minutos).

---

## 11. Editar los procesos de trazabilidad

**Se editan en la hoja de Homologación, no en el código.** Ese fue justo el motivo de
`Trazabilidad.gs`: antes eran ~1 800 líneas de HTML dentro de `Index.html` que había que
editar y volver a desplegar cada vez que Operaciones cambiaba un tiempo.

1. Editar la hoja.
2. Ejecutar **`trazInvalidarCache()`** para no esperar los 10 minutos.
3. `trazDiagnostico()` si algo no aparece: dice qué pestaña no encontró y qué alias buscó.

**No cambies el orden de las filas sin motivo**: el número visible es la **posición**, y los
anclajes (`bt-1`, `mkp-12`) son enlaces que el buscador global reparte.

---

## 12. Añadir una plantilla de correo a clientes

1. Añadir el `id` a **`CC_PLANTILLAS_VALIDAS`** en `CorreoCliente.gs`.
2. Añadir la plantilla en `correo_cliente.html` (el HTML final se arma en el cliente, WYSIWYG:
   lo que se ve en la vista previa es exactamente lo que se envía).
3. El servidor **valida y envía**, no maqueta.

**Comprobación:** enviar a tu propio correo y revisar el resultado en Gmail y en móvil.

> La plantilla de cotización **no** va aquí: esa se envía con su PDF desde `correoventel.html`.

---

## 13. Invalidar cachés (chuleta)

| Qué | Cómo | Alcance |
| --- | --- | --- |
| Cotizaciones y búsquedas | `cotInvalidarCache_()` | Sube la generación: **invalida todo de golpe** |
| Portal (anuncios) | `portalInvalidarCacheAnuncios_()` | Solo anuncios |
| Promociones | `diagLimpiarCache()` | Monitor de promociones |
| Trazabilidad | `trazInvalidarCache()` | Los seis procesos |
| Operación | `opInvalidarCache_()` | Estado e historial |
| Contenido del Portal | `pcInvalidarCache_()` | Conteos por sección |
| Cliente (un navegador) | `Ctrl+Shift+R`, o borrar las claves `ventel-*` de `localStorage` | Solo ese equipo |

> **Toda escritura nueva que añadas tiene que invalidar su caché.** Si no, el usuario ve su
> propio cambio desaparecer al recargar y abre un ticket que no vas a poder reproducir.

---

## 14. Restaurar un dato borrado por error

1. Abrir el libro afectado.
2. **Archivo → Historial de versiones → Ver historial de versiones**.
3. Localizar la versión anterior al borrado y **copiar de ahí las filas concretas**.

> **No restaures el libro entero** si el sistema siguió trabajando desde entonces: te
> llevarías por delante todo lo escrito después. Copia solo lo que falta.

Si el libro entero desapareció: Papelera de Drive, 30 días.

---

## 15. Sacar a alguien del sistema

1. Consola → Roles → **dar de baja** (pone `Activo` = `No` en `_PermisosSistema`).
2. **No borres la fila de `Registros`**: su historial de cotizaciones la referencia por
   correo, y borrarla deja folios sin autor.
3. Comprobar que no era el último maestro — la consola lo impedirá, pero conviene saberlo
   antes.
4. Si tenía atenciones abiertas, liberarlas al pool público para que alguien las retome.

**Comprobación:** `permDiagnostico('correo')` debe reportarla como inactiva.

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
