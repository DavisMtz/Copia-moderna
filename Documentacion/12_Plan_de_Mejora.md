# 12 · Plan de mejora por fases

Plan de trabajo derivado de la auditoría de agosto de 2026, y **registro de lo que se ha
hecho de verdad**. Los dos usos van juntos a propósito: un plan sin registro se convierte
en una lista de buenas intenciones, y un registro sin plan no dice hacia dónde iba nadie.

> **Cómo se usa este documento.** Antes de empezar una tarea, lee su fase. Al terminarla,
> escribe en el §6 qué se hizo, qué se comprobó y qué se dejó fuera. Si algo se decidió
> **no** hacer, también va ahí: media auditoría se pierde por no anotar los descartes y
> volver a discutirlos seis meses después.

---

## 1. El criterio que ordena todo: qué multiplica y qué no

La auditoría encontró ocho huecos. No valen lo mismo, y el orden **no** sale de cuál es más
urgente ni de cuál cuesta menos, sino de **cuánto arrastra detrás cada uno**.

| | Cambio | Tocas | Mejora |
| --- | --- | --- | --- |
| **M1** | Identidad y permisos en `CacheService` | 2 funciones | 43 puntos de llamada → toda función de servidor → **las 19 pantallas, sin abrir ninguna** |
| **M2** | `ViewPrefsPartial` en las pantallas que no lo tienen | 11 líneas | Enciende tema, densidad, escala de texto y alto contraste, que ya existen y hoy se descartan |
| **M3** | `app_shell` en las tres pantallas de cotización | 3 pantallas | Marco, navegación y **precarga por intención**, que vive dentro del shell y por eso no les llega |

Lo demás mejora exactamente lo suyo. Está en las fases 2 a 4 y es igual de necesario, pero
no antes que esto.

**Lo que se decidió NO priorizar**, para que no vuelva a la mesa sin motivo nuevo:

- Las cuatro variantes de loader en las 15 pantallas que no las usan. Rendimiento
  decreciente sobre algo ya resuelto.
- Estados vacíos ilustrados. Pulido legítimo, ganancia funcional baja.
- Migrar el buscador del Portal a `AppBuscar`. Quince índices y su resaltado, sobre un motor
  que la propia documentación describe como bueno. Que haya dos motores es deuda; que uno
  funcione bien es un hecho.
- Gemini para redactar correos al cliente. Es el de más riesgo y menos ganancia de los
  cuatro usos propuestos. El resumen para quien revisa vale más y arriesga menos.

---

## 2. Fase 1 · Los multiplicadores

### F1.1 — Identidad y permisos en `CacheService` (M1)

**El problema.** `SEC_REGISTROS_CACHE` (`Seguridad.gs`) y `PERM_INDICE_CACHE`
(`Permisos.gs`) son variables globales de JavaScript. En Apps Script las globales viven **lo
que dura una ejecución**, y cada `google.script.run` es una ejecución nueva. El memo sirve
dentro de una llamada y se tira al acabar, así que **toda llamada al servidor relee dos hojas
enteras antes de hacer su trabajo**.

No falla nunca. Solo hace que todo tarde, y crece con la plantilla: cada persona nueva alarga
la hoja que se relee en cada clic de todo el mundo.

**Cómo se arregla.** Con el patrón que el proyecto ya tiene inventado en `Cache.gs`:
una **generación** en propiedades del script que forma parte de todas las claves, de modo que
una escritura deja obsoleta toda la caché de golpe. Se añade una capa entre el memo y la hoja:

```
memo de ejecución  →  CacheService (nuevo)  →  hoja
```

**Las cuatro reglas que hacen que esta caché no pueda mentir** — son las de `Cache.gs`,
aplicadas al caso:

1. **Invalidación por escritura, no por tiempo.** Toda función que escribe en `Registros` o
   en la hoja de permisos llama a `idcInvalidar_()`.
2. **TTL corto además de lo anterior**, como red de seguridad para quien edite la hoja a mano
   —que aquí pasa—. 600 s: corto para que una edición manual se cure sola en un descanso,
   largo para cortar el 99 % de las lecturas.
3. **Nunca se cachea un índice vacío.** Una hoja que falló al leerse y un sistema sin nadie
   dado de alta se ven igual, y guardar el segundo deja a todo el mundo fuera durante el TTL.
4. **Si `CacheService` falla, se lee la hoja.** La caché jamás puede ser la causa de que algo
   no funcione: quitarla entera solo hace la app más lenta.

> **La regla de seguridad que no se puede saltar.** `permGuardarPermisos_` y
> `permBorrarPermisos_` usan `.fila` del índice **para escribir** (`getRange(actual.fila…)`,
> `deleteRow(actual.fila)`). Un número de fila cacheado que ya no corresponde —porque alguien
> borró una fila a mano— haría que se escribieran los permisos de una persona **encima de
> otra**. Los caminos de escritura leen la hoja siempre, sin pasar por la caché. Esta es la
> diferencia entre que este cambio sea seguro o que corrompa datos.

**Archivos:** `CacheIdentidad.gs` (nuevo), `Seguridad.gs`, `Permisos.gs`, `Cuentas.gs`,
`Consola.gs`.

**Cómo se comprueba:** `idcDiagnostico()` desde el editor, y `revisionMaestra()` sin
regresiones. La prueba real es de comportamiento: cambiar un permiso en la Consola y
verificar que se aplica **en la llamada siguiente**, no al cabo de diez minutos.

### F1.2 — `ViewPrefsPartial` donde falta (M2)

Once pantallas incluyen `app_theme` —el CSS que *reacciona* a `[data-theme]`— y no
`ViewPrefsPartial`, que es lo único que *pone* ese atributo. `app_prefs.html:161` solo aplica
las cuatro claves de apariencia `if (… && window.VentelPrefs)`, así que en esas pantallas el
valor llega desde la nube y se descarta.

Es una línea por pantalla, como **primer** elemento del `<head>`: si va después de que se
pinte algo, el parpadeo sustituye al problema en vez de resolverlo.

**Pantallas:** `inicio`, `inicio_avanzado`, `cotizacion`, `cotizado_preview`,
`consulta_cotizacion`, `revision_cotizacion`, `correoventel`, `correo_cliente`, `operacion`,
`consola`, `atenciones`.

### F1.3 — Fijar la versión de Chart.js

`inicio_avanzado.html:7` carga `https://cdn.jsdelivr.net/npm/chart.js` **sin versión**. Es la
tercera dependencia de red del frontend, que la documentación dice que no existe. El proyecto
fija GSAP en `3.13.0` y llama a esa URL «el lockfile de este proyecto»; esto se coló sin esa
disciplina y se rompe solo el día que publiquen un cambio de API.

No mejora nada hoy. Evita perder el panel de supervisión un martes cualquiera.

---

## 3. Fase 2 · Medir y propagar

- **Instrumentación de tiempos por función de servidor.** Va junto a F1.1 y no después: sin
  el antes y el después sobre el mismo botón, la mejora hay que creérsela.
- **`app_support` en las 12 pantallas sin él**, empezando por `login`, `registro` y
  `recuperar`: quien no consigue entrar es justo quien necesita escribir al equipo.
- **Accesibilidad en el shell, no pantalla por pantalla:** enlace «saltar al contenido»,
  `<main>` con `id`, anillo de foco por token. Puesto en el marco llega solo a 13 pantallas
  (16 tras M3); puesto a mano hay que acordarse 16 veces y alguien no se acordará.
- **Esqueletos de `app_loaders`** donde hoy hay rueda o nada.

---

## 4. Fase 3 · Consistencia del cliente

- **Migrar a `AppRun.swr`** las 13 pantallas que llaman `google.script.run` directo.
  *Nota de la auditoría:* se verificó si esto rescataba precarga desperdiciada y **no es el
  caso** — el registro de calentadores es coherente y las 9 pantallas con calentador sí leen
  su caché. Lo que compra es deduplicación, un solo mensaje de «sin conexión» en toda la app,
  y borrar cuatro reimplementaciones a mano del mismo patrón. Vale la pena por menos de lo
  que parecía.
- **Carga diferida de `app_comando` y `app_atenciones`** (~300 KB menos en 16 pantallas).
- **Estado en la URL** en las pantallas con pestañas o filtros. Hoy lo cumplen 3 de 19.
- **Recorrido guiado** en Consola, Revisión, Operación y Atenciones.
- **Que `revisionMaestra()` regenere las cifras de la documentación**, para que el manual no
  se desactualice: que se regenere.

---

## 5. Fase 4 · Proyecto propio

- **M3: las tres pantallas de cotización al shell.** Separar antes «estilos del documento» de
  «estilos de la pantalla»: comparten CSS con el PDF que sale al cliente, y ese no se toca.
- **Índice invertido** para la búsqueda de folios (hoy barrido completo + *fuzzy*, TTL 90 s).
- **Política de revisión que se mide sola:** guardar el resultado de cada regla para poder
  decir «esta regla mandó 340 a revisión y el 98 % se aprobó sin cambios, ¿subimos el
  umbral?». De la sección de inteligencia, la de mejor relación valor/riesgo: usa datos que
  ya existen y no manda nada fuera.

---

## 6. Registro de ejecución

Lo que se ha hecho de verdad, en orden. Cada entrada dice **qué se cambió, qué se comprobó y
qué se dejó fuera a propósito**.

<!-- Las entradas nuevas van arriba, con la más reciente primero. -->

### F1.1 · Identidad y permisos en CacheService — *hecho*

**Qué se cambió**

1. **`CacheIdentidad.gs` (archivo nuevo, ~200 líneas).** Capa de caché con generación para
   los dos índices de identidad, calcada del patrón de `Cache.gs`: `idcGeneracion_()`,
   `idcInvalidar_()`, `idcLeer_()`, `idcGuardar_()` y `idcDiagnostico()`. Vive aparte y no
   dentro de `Cache.gs` porque aquel archivo está documentado como «capa única de caché para
   las lecturas de la hoja de Cotizaciones», y mezclar identidad ahí habría hecho que dos
   dominios compartieran contador de generación: una cotización guardada tiraría la caché de
   permisos sin motivo.

2. **`Seguridad.gs · secIndiceRegistros_()`.** Se intercala la caché entre el memo de
   ejecución y la hoja. La lectura de la hoja queda **exactamente igual**; lo único nuevo es
   mirar la caché antes y guardar después.

3. **`Permisos.gs · permIndicePermisos_(desdeHoja)`.** Igual, más un parámetro nuevo. Los
   caminos de escritura (`permGuardarPermisos_`, `permBorrarPermisos_`) lo llaman con `true`
   y saltan la caché: usan `.fila` para escribir, y una fila cacheada que ya no corresponde
   escribiría encima de otra persona.

4. **Invalidación en los seis puntos de escritura.** Dos ya anulaban el memo y ahora también
   suben la generación (`permEscribirRegistros_`, el borrado de la Consola); cuatro no
   invalidaban nada y ahora sí (`permGuardarPermisos_`, `permBorrarPermisos_`,
   `cuentasAltaUsuario_`, la reparación de maestro).

5. **`pruebas/cache_identidad.test.js` (nuevo).** 40 comprobaciones con el mismo enfoque que
   `ttl_cache.test.js`: se carga el archivo **real** en un contexto con stubs y se simulan
   ejecuciones distintas de Apps Script, que es justo lo que no se puede probar a mano.

**Qué se comprobó**

| Punto | Cómo | Estado |
|---|---|---|
| El índice sobrevive al viaje por JSON | Lectura de código | `alta` era el riesgo: un `Date` no sobrevive a `JSON.parse`. `Consola.gs:431` ya era defensivo (`instanceof Date` → `String()`), así que el resultado es idéntico. El resto son cadenas, booleanos y números |
| Ningún camino de escritura usa fila cacheada | Auditoría de los 7 llamadores | Los dos que usan `.fila` para escribir pasan `true`. Los otros cinco son de solo lectura. `permEscribirRegistros_` y el borrado de la Consola rebuscan el correo en la hoja por su cuenta |
| El dato sobrevive entre ejecuciones | Prueba §2 | Es el motivo de todo el cambio |
| Índice vacío nunca se cachea | Prueba §3 | Ni al guardar ni al leer, por si llegara de una versión anterior |
| Invalidar deja obsoletas las dos entradas | Prueba §4 | Y persiste entre ejecuciones |
| Alta de usuario entra a la primera | Prueba §5 | No espera al TTL |
| La generación da la vuelta (999999 → 0) | Prueba §6 | La clave sigue siendo válida |
| Guardián de tamaño | Prueba §7 | Con 4 000 personas no cachea y lo anota; con un índice normal sí |
| `CacheService` caído | Prueba §8 | No lanza; devuelve `null` y el llamador va a la hoja |
| `PropertiesService` caído | Prueba §9 | La generación cae a `'0'` y se sigue funcionando |
| JSON corrupto en caché | Prueba §10 | Devuelve `null` en vez de tumbar la llamada |
| El TTL caduca solo | Prueba §11 | Comprobado a los 599 s y a los 601 s |
| Sin regresiones | `ttl_cache.test.js` | 44/44 siguen pasando |
| Sintaxis | `node --check` sobre los 26 `.gs` | Compilan; sin nombres de función duplicados entre archivos |
| Despliegue parcial | Lectura de código | Las llamadas desde otros archivos van con `typeof`, como el resto del proyecto |

**Lo que NO se ha comprobado todavía**, y hace falta hacerlo en el proyecto real:

- **`idcDiagnostico()` contra las hojas de verdad**, para ver el tamaño real de los dos índices.
  Si alguno se acercara al tope de 90 KB estaría sirviéndose sin caché y este trabajo no
  serviría de nada — la función lo avisa en el registro.
- **La prueba de comportamiento:** cambiar un permiso en la Consola y verificar que se aplica
  en la llamada siguiente, no a los diez minutos.
- **La ganancia real en milisegundos.** Se sabe cuántas lecturas de hoja se ahorran; no cuánto
  tiempo. Esa es la tarea de instrumentación de la fase 2, y por eso va pegada a esta.

**Qué se dejó fuera a propósito**

- **Sin troceado.** `Cache.gs` trocea porque guarda todas las cotizaciones; aquí un índice de
  ~100 personas ronda los 10 KB, muy por debajo del límite de 100 KB. Hay un guardián de
  tamaño que **no cachea** si no cabe, en vez de fallar. Si el equipo pasa de ~800 personas,
  la salida es copiar el troceado de `Cache.gs`, no subir el límite.
- **Sin TTL adaptativo.** `cotTtl_` mide el ritmo de escritura porque las cotizaciones se
  escriben todo el día. Los permisos cambian unas cuantas veces al mes: no hay ritmo que
  medir y el TTL fijo de 600 s es más fácil de razonar.
- **`cuentasActualizarPassword_` y `cuentasMarcarPasswordTemporal_` no invalidan.** El índice
  no guarda contraseñas —solo nombre, avanzado, alta y fila—, así que un cambio de contraseña
  no lo deja obsoleto. Invalidar ahí tiraría la caché de todo el equipo por un dato que la
  caché ni siquiera contiene.

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
