# 09 · Solución de problemas · búsqueda por síntoma

Está ordenado por **lo que reporta el usuario**, no por dónde está el fallo. Busca la frase
que te dijeron.

**Antes de nada:** ejecuta `revisionMaestra()`. Resuelve o localiza la mayoría de los casos
de este documento en un minuto.

---

## Índice rápido

| Lo que te dicen | Sección |
| --- | --- |
| «No me deja entrar» | [1](#1-acceso-y-sesión) |
| «No me aparece el botón / la pantalla» | [2](#2-permisos) |
| «Se me va a otra pantalla al hacer clic» | [3](#3-navegación) |
| «Guardé y no se ve» | [4](#4-datos-que-no-aparecen) |
| «No se guarda la cotización» | [5](#5-cotizaciones) |
| «No llega el correo» | [6](#6-correos) |
| «El Portal está vacío» | [7](#7-portal-y-promociones) |
| «La extensión no hace nada» | [8](#8-extensión-de-chrome) |
| «Dice que hay una falla y no la hay» | [9](#9-estado-de-operación) |
| «Se ve raro / sin estilos» | [10](#10-aspecto-visual) |
| «Va lentísimo» | [11](#11-rendimiento) |

---

## 1. Acceso y sesión

### «Correo o contraseña incorrectos» y la contraseña es correcta

| Causa | Comprobación | Solución |
| --- | --- | --- |
| Bloqueo por intentos | 8 fallos en 15 min | **Esperar 15 minutos.** El contador vive en caché y se limpia solo |
| Falta la columna `PasswordHash` | `revisionMaestra()` → BD Cotizaciones | Restaurar el encabezado desde el historial del Sheet |
| `HASH_SALT` cambió | `secDiagnostico(correo)` | **Si se cambió la sal, todas las contraseñas quedaron inválidas.** Hay que restablecer masivamente desde la Consola |
| No está en `Registros` | `VER_CORREOS_REGISTRADOS()` | Darla de alta |

> El mensaje no distingue «no existe» de «contraseña incorrecta», a propósito: evita
> enumerar correos.

### «Demasiados intentos fallidos»

Correcto y esperado. 15 minutos. No hay forma de desbloquear antes desde la interfaz; si es
urgente, el contador está en la caché del script.

### «No me llega el código de registro»

1. Carpeta de spam.
2. ¿El correo es del dominio permitido? (`CUENTAS_DOMINIO`, por defecto `liverpool.com.mx`).
3. ¿Se pidió otro código hace menos de 60 s, o ya van 5 en la última hora? Son frenos
   correctos.
4. `cuentasDiagnostico('correo')`.
5. Revisar la cuota diaria de correos de la cuenta que despliega.

### Nadie puede entrar / no queda ningún maestro

**Rescate desde el editor de Apps Script:**

```
NOMBRAR_MAESTRO()              → restaura el maestro cableado en Permisos.gs
permSembrarMaestro('correo')   → siembra un maestro nuevo
REPARAR_MAESTRO()              → repara su fila de permisos
secFijarModoAuth('portal')     → si AUTH_MODO quedó en 'estricto' por error
```

Después: `VER_PERMISOS_GUARDADOS()` para confirmar.

---

## 2. Permisos

### «A fulano no le aparece el botón»

**Diagnóstico en un paso:** `permDiagnostico('correo@liverpool.com.mx')`. Dice qué bloques
tiene **y de dónde sale cada uno** (del rol, de un `mas`, retirado por un `menos`, o apagado
por mantenimiento).

Causas por orden de frecuencia:

1. **No ha vuelto a entrar** tras el cambio. El servidor ya aplica el cambio; el menú lo
   dibuja el cliente con los bloques que guardó al iniciar sesión. **Cerrar sesión y
   volver a entrar.**
2. **El bloque está apagado por mantenimiento.** Consola → Módulos. Ojo: el maestro **sí** lo
   ve, así que si tú lo ves y la otra persona no, mira aquí.
3. Un ajuste `menos` se lo retira explícitamente.
4. La persona está inactiva (`Activo` = `No`).

### «Entro a la consola y no veo nada»

Correcto si no tienes bloques de administración. **El cascarón se sirve a cualquiera**; el
contenido llega de `consolaPanorama`, que exige el bloque. No es un fallo: es el diseño.

### «Puedo ver la pantalla pero me dice que no tengo permiso al guardar»

También correcto. El cliente esconde por cortesía; el servidor decide. Si la pantalla se ve
pero no deja actuar, lo que falta es el bloque real. Compruébalo con `permDiagnostico`.

---

## 3. Navegación

### «Hago clic y acabo en el Portal»

**Este es el fallo silencioso más característico del proyecto.** El enrutador resuelve como
Portal **cualquier página que no reconoce**, así que un destino mal escrito no da error: te
manda al Portal y parece que el botón «no hizo nada».

1. ¿La clave de página está en **`PAGES`** (`Code.gs`) **y** en **`AppUrl`** (`app_core.html`)?
   Son listas espejo.
2. ¿El código llama a `AppUrl.go()` con el valor correcto? Hubo un caso real:
   `goAppAction` leía `entrada.page` cuando el destino vivía en `entrada.act`, y **ningún**
   resultado del buscador llevaba a su pantalla.

### «Me sale “no pudimos abrir la pantalla” en cada clic del menú»

Casi seguro: **esa pantalla no define `window.__APP__`** antes de `app_core`. `AppUrl` arranca
con la URL base vacía y `build()` devuelve `null`. Es exactamente lo que le pasó a
`atenciones.html`.

La línea es siempre la misma, `window.__APP__ = <?!= APP_JSON ?>;`, y va **antes** del
`include('app_core')`. Si está compuesta a mano (`{ baseUrl: …, folio: … }`), es de antes de
T1.2 y le faltarán parámetros: cámbiala por la línea única en vez de añadirle el que falte.

Comprueba también que `AppUrl.param()` devuelve algo: sin `__APP__`, lee la barra de
direcciones del iframe del sandbox en vez de la del enlace, así que **tampoco llegan los
parámetros de la URL**. Ese fue el síntoma de la consola durante meses: leía `?sec=` y `?q=`
en dos sitios y no le llegaban nunca, porque su `__APP__` solo llevaba `baseUrl`.

### «Cambio de pestaña / abro algo y el botón atrás no me devuelve»

La pantalla escribe en la URL pero **no registra `AppUrl.alCambiarUrl`**: la dirección cambia
y la vista se queda igual. Toda pantalla que apile (`{apilar:true}`) tiene que tener oyente.
Si el oyente existe y aun así falla, mira las cuatro trampas del documento 03 §5 — lo más
probable es que la ausencia del parámetro no esté restaurando el valor por omisión.

### «El botón atrás no funciona» / «Se llena el historial»

Regla del proyecto: **la pestaña apila historial; la búsqueda lo reemplaza.** Una entrada de
historial por cada tecla escrita deja el botón atrás inservible.

### «Comparto el enlace y no abre donde yo estaba»

La pantalla no está escribiendo su estado en la URL. Ver
[`08_Tareas_Frecuentes.md`](08_Tareas_Frecuentes.md) §5.

---

## 4. Datos que no aparecen

### «Guardé y no se ve»

1. **Recarga forzada** (`Ctrl+Shift+R`).
2. Servidor: `cotInvalidarCache_()` — sube la generación e invalida todo de golpe.
3. Si vuelve a pasar siempre en el mismo sitio: **esa escritura no invalida su caché**. Es un
   bug real, no un problema del usuario. Ver [`08`](08_Tareas_Frecuentes.md) §13.

### «El panel abre vacío y luego se llena» / «abre con la rueda»

Caso conocido y ya corregido una vez en atenciones: **`AppCache` borra la entrada al leerla
caducada**. Con un TTL demasiado corto, pasado ese tiempo el panel vuelve a arrancar vacío —
lo contrario de lo que promete su propio rótulo «actualizado hace 5 minutos».

**Solución:** subir el TTL de esa entrada a los 10 minutos que usa el resto de módulos. `swr`
revalida igual en cada apertura, así que la lista sale pintada al instante y la comprobación
va por detrás.

### «Una tarjeta marca siempre cero»

Suele ser que el módulo del que lee **no está precargado en esa pantalla**. Pasó con la
tarjeta de Atenciones del panel de gestión: leía el resumen en una pantalla donde nadie
cargaba el panorama. La solución es precargar al montar y repintar cuando llegue el dato
(`precargar()` devuelve la promesa de la lectura para que quien enseñe un número pueda
esperarla).

### «Datos viejos que no se actualizan nunca»

Si es una copia local sin versión ni caducidad, se pintará siempre igual. **Toda entrada de
`AppCache` debe llevar versión y TTL.** Hubo un caso: la copia local del Portal no los tenía,
y una copia de hace meses se seguía pintando.

---

## 5. Cotizaciones

### «No se guarda»

1. `revisionMaestra()` → **BD Cotizaciones**.
2. El error más común es un **encabezado renombrado**. El código lanza un mensaje que nombra
   los que espera. Restaurar desde el historial de versiones del Sheet.
3. Si el mensaje habla de la hoja `DetalleCotizaciones`, la columna que falta es
   `FolioCotizacion`.

### «Se repitió un folio»

No debería: `generateLvpFolio` usa `LockService`. Si ocurre, comprueba que ese lock sigue en
el código — es el único punto del sistema donde dos asesores simultáneos producirían un
duplicado.

### «Perdí columnas al reguardar»

Al reguardar, **las filas de detalle se borran y se reescriben**. Cualquier anotación manual
en una fila de `DetalleCotizaciones` se pierde. No uses esa hoja para notas.

En la cabecera (`Cotizaciones`) sí se conserva lo que la función no maneja, incluidas las
fórmulas. Si perdiste algo ahí, alguien añadió código que reescribe la fila entera.

### «La auditoría marca todo como pendiente»

Significa que **no pudo consultar liverpool.com.mx**. Comprueba el ámbito
`script.external_request` y prueba `revDiagnosticoFicha(url)` con una ficha concreta. No es
un fallo de la auditoría: es su forma correcta de decir «no pude comprobarlo».

### «Aparece un descuento marcado como atípico y es correcto»

La detección usa **Z modificada sobre mediana y MAD**, no la media. Un descuento muy distinto
al resto de la cotización se señala **para que alguien lo mire**, no se rechaza. Es el
comportamiento esperado.

---

## 6. Correos

### «No llega la cotización al cliente»

1. **¿Está aprobada?** `revPuedeEnviarse_(folio)`. Si no lo está, el bloqueo es correcto: es
   el gate que impide mandar al cliente algo que nadie revisó.
2. `revisionMaestra()` → área **Correo**.
3. Cuota diaria de correos.
4. Revisar el remitente de un correo reciente: si el alias
   `cotizacion@liverpool.com.mx` dejó de estar dado de alta como «Enviar como» en la cuenta
   que despliega, **el sistema envía desde la cuenta propia en vez de bloquear**.

### «El correo llega sin imágenes»

`getVerifiedImageUrl` prueba varios subdominios de Liverpool y cae a un *placeholder*. Si
todas fallan, Liverpool cambió sus subdominios de imágenes: hay que actualizar
`IMG_SUBDOMINIOS` en `Correos.gs`. La caché es de 6 horas.

### «El correo se ve distinto a la vista previa»

No debería: en «Correos a clientes» el **HTML final se arma en el cliente** y el servidor solo
valida y envía (WYSIWYG). Si difieren, algo está reescribiendo el HTML en el servidor.

### «El remitente no es el alias»

Ver arriba: es el respaldo deliberado para no bloquear el envío. Da de alta el alias en la
cuenta que despliega.

---

## 7. Portal y promociones

### «El Portal sale vacío»

1. `revisionMaestra()` → **BD Portal**.
2. **La causa más frecuente: la cuenta que despliega perdió acceso al libro del Portal.** No
   da error, da vacío.
3. ¿Se renombró una pestaña? Los nombres son exactos: `Herramientas`, `Presentaciones`,
   `Paqueterias`, `Formatos`, `PdePago`, `Plantillas`.

### «El monitor de promociones enseña 0»

**`diagPromos()`** existe exactamente para esto: el navegador no puede distinguir «la hoja no
tiene nada» de «la hoja tiene cosas pero no supimos leerlas» — en los dos casos llegan cero
promociones y la pantalla se ve igual. Esta función contesta cuál de las dos es.

Después: `diagLimpiarCache()`.

### «Falta la descripción de una presentación»

Caso documentado: el encabezado real de esa hoja dice **`DESCRPCION`** (sin la i). El alias
del sistema es `descr` para cubrir las dos grafías. Si falla otra columna, mira si su
encabezado tiene una errata y añade el alias.

### «Un proceso de trazabilidad no aparece»

1. `trazDiagnostico()` — dice qué pestaña no encontró y **qué alias buscó**.
2. Si se renombró la pestaña, devuélvele el nombre o añade el alias a `TRAZ_SECCIONES`.
3. Tras editar la hoja: `trazInvalidarCache()`.

### «El enlace del buscador abre la sección pero no señala nada»

Fallo ya corregido una vez: el buscador de destino no sabía encontrar tarjetas de proceso.
Ahora busca primero por **id** de tarjeta y luego por título, porque el nombre sale de una
hoja de cálculo y basta un espacio de más para que la comparación falle.

---

## 8. Extensión de Chrome

### «El botón Cotizar no lleva a ningún sitio»

**Primera comprobación siempre:** la URL guardada en la extensión. Popup → «Guardar enlace».
Si se redesplegó la webapp con una implementación **nueva** en vez de editar la existente, la
URL cambió.

### «Extrae cero artículos»

1. F12 → Consola → buscar avisos con el prefijo `Ventel Extractor:`.
2. Buscar `self.__next_f` en el HTML de la página. Si ya no existe o cambió de forma,
   Liverpool cambió su despliegue y hay que actualizar `deep-extractor.js`.
3. Comparar con `Mi Bolsa.html`, que conserva la estructura que funcionaba.

### «No pasa nada al pulsar»

1. ¿Estás en un dominio `liverpool.com.mx`? `host_permissions` está acotado ahí.
2. **La extensión no actúa sobre `file://`.** Para probar contra la captura local hay que
   servirla por HTTP. El fallo es silencioso: simplemente no hace nada.
3. `chrome://extensions` → ¿hay errores? → recargar la extensión.

### «La bolsa llega vacía a la cotización»

El puente borra la bolsa al confirmarse la importación: **una bolsa se cotiza una vez**. Si
ya se importó, hay que volver a extraerla.

### «Aparece la bolsa de ayer»

Lo contrario: la importación no llegó a confirmarse (`VENTEL_BOLSA_IMPORTADA`), así que no se
borró. Mira la consola de la pantalla de cotización.

---

## 9. Estado de operación

### «Dice que hay una falla y no la hay»

El umbral automático publica una **sospecha**, no un hecho — y por eso el texto dice «Es
posible que existan problemas con el servicio». **Descartarla desde la pantalla `operacion`
es parte del flujo**, no un arreglo.

Si se repite sin motivo, revisa `OP_UMBRAL_PERSONAS` (3) y `OP_VENTANA_MIN` (30), pero **no
los cambies sin acordarlo**: se eligieron tras probar 2 y 5.

### «Se cayó Connect y no salió nada»

- ¿Los reportes fueron de **personas distintas**? Se cuentan personas, no reportes: cinco
  reportes de la misma persona son una persona con un problema.
- ¿Coincidieron en el motivo? Si no, debería entrar el **segundo umbral por servicio**
  (`OP_UMBRAL_SERVICIO_ACTIVO`). Comprueba que sigue en `true`.
- ¿Dentro de la misma ventana de 30 minutos?

### «El gráfico no se actualiza al pulsar recargar»

Fallo ya corregido una vez: `fuerza` se calculaba con una condición que nunca daba verdadero,
así que «recargar» devolvía lo que ya había en caché. Con la caché de horas en 2 minutos,
pasó de inofensivo a visible. Si reaparece, mira ahí.

### «El pico aparece a otra hora»

Las claves de hora viajan como texto `AAAA-MM-DD HH` en hora de la operación y **se rotulan
sin pasar por `new Date`**. Si alguien las convierte a `Date`, se mueven al huso del
navegador y un asesor en otro huso ve el pico de las 11 dibujado a las 9.

### «El tablero de estado se ve sin haber iniciado sesión»

**Correcto y deliberado.** «¿Está caído o soy yo?» hay que poder contestarla justo cuando no
puedes entrar. Está verificado que ahí no viaja ni un correo ni una nota interna.

---

## 10. Aspecto visual

### «Se ve sin estilos»

- ¿Falta `app_theme` o `app_tailwind` en los includes?
- **Tailwind está compilado**, no es el CDN: si usas una clase que no está compilada, **no
  existe**. Hay que añadirla a `app_tailwind.html`.

### «No hay animaciones»

Tres causas legítimas, todas por diseño:

1. El usuario tiene activado **«reducir movimiento»** en su sistema.
2. **GSAP no cargó** (sin red al CDN de jsdelivr). La interfaz sigue funcionando; el loader
   degrada a un giro estático.
3. La pantalla no incluye `app_motion`.

### «Un icono sale como una llave inglesa»

`icon()` cae a la llave inglesa cuando no encuentra el nombre. **Parece una decisión y manda
a buscar al sitio equivocado.** Pasó con `icon('clock')`, que no existía: las dos entradas de
Atenciones salían con el icono de Herramientas. Añade el icono al catálogo de `app_icons`.

### «Dos estados se ven del mismo color»

`app_estatus` es la **fuente única** del color de cada estatus. Fue el motivo de crearlo:
«Aprobada» y «Enviada por Correo» salían las dos verdes, y «En Revisión» y «Folio Generado»
las dos amarillas, así que a simple vista no se distinguía lo autorizado de lo que espera a
alguien. **No pintes estatus a mano en una pantalla.**

### «La pantalla parpadea de claro a oscuro al cargar»

Falta `ViewPrefsPartial` **en el `<head>`, lo antes posible**. Es quien aplica el tema antes
del primer fotograma.

---

## 11. Rendimiento

### «Va lentísimo»

| Causa | Comprobación | Solución |
| --- | --- | --- |
| Hojas muy grandes | Número de filas de `Cotizaciones` | La búsqueda global es lo más caro; considera archivar |
| Caché fría tras una escritura | `cotCacheDiagnostico()` | Normal: la siguiente carga ya va rápida |
| Se usa `AppRun.call` donde debería ir `swr` | Revisar la pantalla | Cambiar a `swr` |
| Valor demasiado grande para la caché | `cotCacheDiagnostico()` | Por encima de ~1.8 MB se sirve **sin caché** a propósito |

### «Se queda cargando para siempre»

1. Editor → **Ejecuciones**: buscar timeouts (límite 6 min).
2. La sospecha habitual es una lectura de hoja dentro de un bucle.
3. Revisar Cloud Logging.

### «Al hacer clic en un botón se congela la pantalla»

Esa escritura no está pasando por `AppGuardado`. Un `google.script.run` directo bloquea entre
300 ms y un segundo largo. Ver [`03_Frontend_y_Vistas.md`](03_Frontend_y_Vistas.md) §6.

---

## 12. Cuando nada de esto sirve

1. **`revisionMaestra()`** y lee el reporte completo, no solo la línea que sospechas.
2. **Editor → Ejecuciones**: filtra por errores en el rango de hora del incidente.
3. **Cloud Logging**: la traza completa de la excepción.
4. **`Carpeta del proyecto/README.md`**: busca el módulo. Puede que el comportamiento sea una
   decisión con motivo escrito, no un fallo.
5. **Historial de git**: `git log --oneline -- "Carpeta del proyecto/<archivo>"` dice qué
   cambió y cuándo.
6. Reproduce con una **cuenta de prueba sin privilegios**: muchos fallos solo se ven desde
   fuera del rol maestro.

**Al resolverlo, escríbelo.** Este documento y el README del proyecto son donde vive lo que
ya se aprendió una vez.

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
