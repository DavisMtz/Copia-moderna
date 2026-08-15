# 02 · Backend · los 24 archivos `.gs`

Referencia archivo por archivo. Para cada uno: **qué hace**, **qué expone al cliente**,
**qué no puedes romper** y **dónde tocar** si vienes a cambiar algo.

Todos los archivos comparten un único ámbito global de Apps Script: una constante declarada
en `Code.gs` es visible desde `Correos.gs`. Por eso casi todos los módulos prefijan sus
funciones internas (`sec*`, `perm*`, `op*`, `aten*`, `pc*`, `cot*`, `rev*`, `revpol*`,
`aud*`, `cuentas*`, `consola*`, `traz*`, `prefs*`, `onb*`, `met*`). **Respeta el prefijo al
añadir funciones**: es lo único que evita colisiones en un espacio de nombres plano.

Convención del proyecto: una función que termina en `_` es **interna** (Apps Script no la
expone a `google.script.run`). Una función sin guion bajo final es **llamable desde el
cliente**, y por tanto **necesita su gate de permisos dentro**.

---

## Índice por responsabilidad

| Área | Archivos |
| --- | --- |
| **Núcleo y enrutado** | `Code.gs` |
| **Identidad y permisos** | `Seguridad.gs`, `Permisos.gs`, `Cuentas.gs`, `Consola.gs`, `Equipo.gs` |
| **Cotizaciones** | `Code.gs`, `Formatos.gs`, `Correos.gs`, `CorreoCliente.gs`, `Metricas.gs` |
| **Revisión y calidad** | `Revision.gs`, `AuditoriaCotizacion.gs`, `PoliticaRevision.gs` |
| **Portal** | `Portal.gs`, `Publicaciones.gs`, `PortalContenido.gs`, `PortalPromosComercial.gs`, `Trazabilidad.gs`, `DiagnosticoPromos.gs` |
| **Operación y atenciones** | `Operacion.gs`, `Atenciones.gs` |
| **Infraestructura** | `Cache.gs`, `Preferencias.gs`, `Onboarding.gs`, `Admin.gs` |

---

## 1. `Code.gs` — núcleo y enrutador (1 418 líneas)

El archivo más antiguo y el más central. Contiene el enrutador, el CRUD de cotizaciones y
el motor de búsqueda difusa.

**Constantes que definen el sistema**

| Constante | Línea | Qué es |
| --- | --- | --- |
| `REGISTROS_SHEET_NAME` / `COTIZACIONES_SHEET_NAME` / `DETALLE_COTIZACIONES_SHEET_NAME` | 21–23 | Nombres de las tres pestañas centrales |
| `HASH_SALT` | 29 | Sal de contraseñas. **Respaldo**: manda la propiedad de script del mismo nombre |
| `WEBHOOK_URL` | 30 | Webhook de Chat para cotización nueva. **Respaldo**, igual que la anterior |
| `LOGIN_MAX_INTENTOS` / `LOGIN_VENTANA_SEGUNDOS` | 33–34 | 8 intentos fallidos → bloqueo de 15 minutos |
| `PAGES` | 56 | **16 pantallas con sesión** |
| `PORTAL_PAGES` | 89 | **3 pantallas públicas**: `portal`, `promociones`, `estado` |
| `PARAMS_VISTA` | 124 | **17 parámetros** del contrato de URLs |

**Contrato de `PARAMS_VISTA`** — el criterio de qué va en cada uno, para que la lista no se
llene de sinónimos:

| Parámetro | Significa |
| --- | --- |
| `folio` | **Identidad** de una cotización: lo que la pantalla abre |
| `action` | Qué hacer con ella (`edit`). Modificador, no identidad |
| `format` | Formato del documento a generar |
| `q` | Filtro **ya aplicado** sobre una tabla que está en pantalla |
| `buscar` | Término con el que **abrir el buscador general** encima. Distinto de `q` |
| `tpl` | Plantilla preseleccionada en «Correos a clientes» |
| `sec` | Sección/pestaña abierta dentro de una pantalla con varias |
| `ancla` | A qué apartado bajar al cargar |
| `inc` | Incidencia a abrir en el tablero de estado |
| `next` | A dónde volver tras el login. **Es una clave de página, jamás una URL** |
| `promo`, `item`, `rango` | Promoción, tarjeta y periodo del gráfico |
| `estatus` | Filtro por estatus de la tabla de supervisión |
| `dir`, `origen` | Filtros por dirección y por origen del Monitor de promociones |
| `pub` | **Identidad** de una publicación del Portal, abierta en grande. Como `promo`, sale de la hoja y no de la posición de la fila. Va aparte de `item` porque `item` señala DENTRO de una sección y una publicación se abre venga uno de donde venga |

> `next` solo acepta claves de la lista blanca `AppUrl.PAGINAS_TRAS_LOGIN` del cliente. Es
> lo que impide usarlo como redirección abierta hacia fuera del sistema.

> `promo` es una clave **derivada del contenido** de la fila (dirección + categoría +
> promoción, normalizado), no su posición: el Monitor no tiene ids en la hoja, y un índice
> posicional deja el enlace apuntando a otra promoción en cuanto alguien inserta una fila.

**`appEstadoInicialJson_(baseUrl, e)`** — arma el `window.__APP__` de todas las pantallas: la
URL base más los 16 parámetros de esta petición, serializados. Escapa `<`, `>`, `&` y los dos
separadores de línea que JSON deja pasar crudos (U+2028/U+2029). Ese escape no es cosmético:
los valores vienen de la URL y se imprimen con `<?!= ?>`, que no escapa, así que sin él un
enlace con `?folio=</script><script>…` cerraba la etiqueta y ejecutaba código en la sesión de
quien lo abriera. Cubierto por `pruebas/estado_inicial.test.js`.

**Funciones expuestas al cliente**

| Función | Qué hace |
| --- | --- |
| `registerUser` / `loginUser` | Alta y autenticación (ver `Cuentas.gs` para el flujo con código) |
| `saveQuoteAndGoToPreview(quoteData)` | Guarda y decide revisión. **Puerta de entrada de toda cotización** |
| `getQuotesForUser(email, termino, forzar)` | «Mis cotizaciones», con caché |
| `buscarCotizaciones(email, termino, limite)` | Búsqueda global difusa |
| `getQuoteDetails(folio)` | Detalle completo, cabecera + partidas |
| `getDashboardStats()` | Números del panel |
| `getSupervisionQuotes(email)` | Cola de supervisión |
| `getUserEmail(correoPortal)` | Correo efectivo de la sesión |
| `include(filename)` | Inserción de parciales en el render |

**Motor de búsqueda difusa** (líneas 1293–1370): `normalizeText_`, `compactText_`,
`searchTokens_`, `levenshtein_`, `fuzzyTolerance_`, `fuzzyScore_`. La tolerancia a erratas
**depende de la longitud** de la palabra: exigir la misma distancia a «BT» y a
«MarketPlace» daría o demasiados falsos positivos o ninguna tolerancia útil.

**Lo que no puedes romper**

- `saveQuoteDataToSheets` arma la fila **por nombre de columna** y, al actualizar, parte de
  lo que ya tenía la fila. Además **devuelve las fórmulas, no su resultado**, en las
  columnas que no maneja: reescribir el valor calculado convertiría la fórmula en un dato
  muerto. Si tocas esa función, conserva las dos cosas.
- Hay un seguro: si localiza menos de 5 campos por nombre, **lanza excepción** en vez de
  escribir una fila desalineada. No lo quites.
- `generateLvpFolio` usa `LockService`. Sin él, dos asesores guardando a la vez comparten
  folio.

---

## 2. `Seguridad.gs` — identidad y configuración (455 líneas)

Capa **única** de identidad. Antes cada archivo resolvía esto por su cuenta y de forma
distinta (`isAdvancedUser` comparaba `'Si'` exacto, `portalGateAvanzado_` comparaba en
minúsculas), lo que producía que la misma persona tuviera permiso en una pantalla y no en
otra.

**Quién manda:** la sesión del **Portal** (`AppSession.userEmail`, validado contra
`Registros`). La cuenta de Google del navegador **no** decide la identidad; solo es
respaldo cuando el navegador no declara correo (ejecuciones desde el editor, disparadores,
diagnósticos).

**Los cuatro modos de autenticación** (propiedad de script `AUTH_MODO`):

| Modo | Comportamiento |
| --- | --- |
| `portal` *(predeterminado)* | Manda el correo del portal; debe estar en `Registros`. Sin correo declarado, cae a la cuenta de Google |
| `auto` | La cuenta de Google manda si está registrada; si no, se acepta la del portal |
| `estricto` | **Solo** cuenta de Google, y debe estar registrada. Ignora el correo del portal |
| `legado` | Como `portal` pero sin respaldo a Google. Compatibilidad |

> **Consciente y documentado:** en modo `portal` el correo lo declara el navegador. El
> servidor comprueba que exista en `Registros`, pero **no puede probar que sea de quien
> dice ser**. Es el precio de que la sesión sea la del portal y no la de Google. Ver
> [`06_Seguridad_y_Permisos.md`](06_Seguridad_y_Permisos.md) §5.

**Funciones clave**

| Función | Uso |
| --- | --- |
| `secConfig_(clave, respaldo)` | Lee propiedad de script; si no existe, usa el valor del código |
| `secGuardarConfiguracion()` | **Ejecutar una vez a mano** para sacar los secretos del código |
| `secFijarModoAuth(modo)` | Cambia `AUTH_MODO` |
| `secIdentidad_(email)` | Identidad base |
| `secIdentidadConBloque_(email, bloqueId)` | **El candado real de toda la app** |
| `secIdentidadMaestra_(email)` | Exige rol maestro |
| `secComparacionSegura_(a, b)` | Comparación en tiempo constante (contraseñas y códigos) |
| `secHashContrasena_(password)` | SHA-256 con sal |
| `secIntentosRevisar_` / `secIntentosSumar_` / `secIntentosLimpiar_` | Freno de fuerza bruta |
| `secDiagnostico(correo)` | Diagnóstico desde el editor |

`SEC_REGISTROS_CACHE` es un índice en memoria válido **solo durante esa ejecución**: una
llamada puede resolver la identidad dos veces y sin él se leería la hoja completa dos veces
por petición.

---

## 3. `Permisos.gs` — bloques, roles y jerarquía (1 232 líneas)

Parte en **22 bloques** el interruptor único que antes era la columna «Avanzado».

**Orden en que se decide** (de menos a más fuerte; lo último gana):

```
bloques del rol → + los de "mas" → − los de "menos" → − los módulos apagados
```

El **maestro se salta el apagado de módulos**: si apagar un módulo también dejara fuera al
maestro, nadie podría volver a encenderlo.

**Retrocompatibilidad:** mientras alguien no tenga fila en `_PermisosSistema`, manda la
columna «Avanzado» de `Registros` exactamente como antes. El sistema no cambió de
comportamiento el día que se subió este archivo: cambia cuando se usa la consola.

**La regla de jerarquía**, escrita una sola vez y usada por toda la app:

- `permVetoJerarquia_(quien, objetivo)` — alcanzas a quien esté en tu **mismo nivel o por
  debajo**, nunca a tu propia cuenta.
- `permVetoRol_(quien, rolPedido)` — no puedes conceder un rol por encima del tuyo.
- `permBloquesRepartibles_(usuario)` — no puedes repartir bloques que no tienes.

**Utilidades de rescate** (ejecutar desde el editor; ver también §Admin):

| Función | Para qué |
| --- | --- |
| `NOMBRAR_MAESTRO()` | Restaura el rol maestro al correo cableado en el archivo |
| `REPARAR_MAESTRO()` | Repara la fila de permisos del maestro |
| `VER_PERMISOS_GUARDADOS()` | Vuelca la hoja de permisos al registro |
| `VER_CORREOS_REGISTRADOS()` | Vuelca los correos dados de alta |
| `permSembrarMaestro(correo)` | Siembra un maestro nuevo |

**No puedes romper:** los `id` de bloque **nunca se renombran** — están guardados como texto
en la columna `Permisos` de cada persona. Renombrar `cotizar` deja sin permiso a todo el que
lo tuviera concedido a mano. Para añadir un bloque, ver
[`08_Tareas_Frecuentes.md`](08_Tareas_Frecuentes.md) §3.

---

## 4. `Cuentas.gs` — alta y recuperación por código (1 379 líneas)

Dos flujos, un solo mecanismo: código temporal de **6 dígitos** al correo.

```
ALTA           solicitarCodigoRegistro → [correo] → confirmarCodigoRegistro
               La cuenta NO existe hasta confirmar el código.

RECUPERACIÓN   solicitarCodigoRecuperacion → confirmarCodigoRecuperacion (devuelve VALE)
               → restablecerContrasena(email, vale, nueva)
```

El **vale** separa «probé que el correo es mío» de «escribo la contraseña nueva»: así el
código no viaja otra vez ni se queda dando vueltas en el cliente.

**Dónde viven los códigos:** en las **propiedades del script**, no en la hoja — son datos
efímeros y en la hoja los vería cualquiera con acceso al archivo. Se guarda el **hash**, no
el código. Con seis dígitos el hash no es barrera criptográfica, pero evita que un código
quede a la vista en la pantalla de propiedades. Cada registro caduca solo y se purga al
emitir el siguiente (`cuentasPurgar_`).

**Frenos, todos del lado del servidor**

| Freno | Valor |
| --- | --- |
| Espera entre envíos al mismo correo | 60 s |
| Máximo de códigos por correo y propósito | 5 por hora |
| Intentos por código | 5; al sexto muere el código |
| Vigencia del código | 10 minutos |
| Vigencia del vale | 15 minutos |
| Dominio permitido en altas | `liverpool.com.mx` (`ninguno` = sin restricción) |

`cuentasPreviaCorreos(enviarA)` te manda a ti mismo una muestra de **todas** las plantillas
de correo del módulo; úsala tras cualquier cambio de redacción. `cuentasLimpiarTodo()`
borra los códigos pendientes.

---

## 5. `Consola.gs` — administración (1 329 líneas)

Expone como funciones lo que antes se hacía abriendo el editor o editando `Registros` a
mano. **Tres reglas que no se rompen nunca:**

1. **Nada se ejecuta sin gate.** Cada función resuelve identidad y exige un bloque concreto.
2. **Nadie puede dejarse fuera.** No se puede quitar el rol maestro a uno mismo, ni darse de
   baja, ni retirar al último maestro. Un sistema de permisos que permite cerrarse por
   dentro es un sistema que un día hay que arreglar desde el editor.
3. **Todo cambio queda apuntado** en `BitacoraConsola` (últimos 150 movimientos).

**Secciones y qué bloque abre cada una** (`CONSOLA_SECCIONES`):

| Sección | Bloques que la abren |
| --- | --- |
| Resumen | *(cualquiera que entre)* |
| Roles | `adm_miembros`, `adm_permisos`, `sup_equipo` |
| Módulos | `adm_modulos` |
| Ajustes | `adm_ajustes` |
| Formatos | `adm_formatos` |
| Salud | `adm_salud` |
| Bitácora | `adm_bitacora`, `sup_equipo` |

**Los 11 ajustes editables** (`CONSOLA_AJUSTES`), agrupados:

- **Identidad** — `AUTH_MODO`, `CUENTAS_DOMINIO`, `HASH_SALT` *(solo lectura)*.
- **Avisos** — `WEBHOOK_URL`, `OPERACION_WEBHOOK_ESTADO`, `OPERACION_WEBHOOK_REPORTES`.
- **Fuentes de datos** — `PORTAL_SHEET_ID`, `CCL_TEMPLATE_SHEET_ID`, `TRAZ_SHEET_ID`,
  `PORTAL_CALENDAR_ID`, `PORTAL_ANUNCIOS_FOLDER_ID`.

> `HASH_SALT` es **deliberadamente de solo lectura**: cambiarlo invalida de golpe la
> contraseña de todo el mundo, y eso no debe estar a un clic de nadie.

> Los webhooks solo pueden apuntar a `chat.googleapis.com` (`CONSOLA_WEBHOOK_HOSTS`). Un
> webhook es una URL que **el servidor** visita: dejarlo libre convertiría la consola en un
> trampolín para alcanzar cualquier cosa que este proyecto vea desde dentro de Google.
> **No amplíes esa lista sin entender que eso es una SSRF.**

---

## 6. `Equipo.gs` — compatibilidad (103 líneas)

**Ya no decide nada.** Es un puente hacia la Consola. Había aquí una segunda implementación
completa del control de accesos, con una doctrina distinta («puedes gestionar a quien no
puede gestionar a nadie» frente a «esto es de maestros»), de modo que la respuesta a «¿puede
Ana cambiar a Beto?» dependía de por dónde entrara Ana.

Si buscas esa lógica: `Permisos.gs` (la regla) y `Consola.gs` (la puerta).

---

## 7. `Cache.gs` — caché de lectura con generación (179 líneas)

| Pieza | Qué hace |
| --- | --- |
| `cotGeneracion_()` | Generación actual de la BD; sube en cada escritura |
| `cotInvalidarCache_()` | **Sube la generación → toda la caché queda obsoleta de golpe** |
| `cotCacheado_(nombre, ttl, productor, aceptar, forzar)` | Envoltura principal de lectura |
| `cotCacheGet_` / `cotCachePut_` | Lectura/escritura con troceado |
| `cotCacheDiagnostico()` | Estado desde el editor |

Troceado: `COT_CACHE_TROZO = 90000` (< 100 KB por valor), máximo 20 trozos (~1.8 MB). Por
encima, se sirve sin caché en vez de fallar.

---

## 8. `Revision.gs` — revisión de cotizaciones (1 936 líneas)

Una cotización recién guardada **no** está lista para salir: nace en «En Revisión». Aquí
vive el estado de revisión, el **gate que usa `Correos.gs`** para no dejar salir lo no
aprobado, el aviso al asesor y la incrustación segura de la ficha del artículo.

**Columnas que añade a `Cotizaciones`** (`REV_COLS`): `RevisionEstado`, `RevisadoPor`,
`RevisadoNombre`, `RevisionFecha`, `RevisionNotas`, `RevisionChecklist`, más
`LinkArticulo` en el detalle. `revAsegurarColumnas_()` las crea si faltan.

**Seguridad del iframe.** El enlace del artículo llega desde la extensión y acaba dentro de
un `src` de iframe. `REV_HOSTS_ARTICULO = ['liverpool.com.mx', 'www.liverpool.com.mx']` se
compara por **host exacto o subdominio real, nunca con `includes`**. Sin esa lista, una
celda con `javascript:…` sería ejecución de código en la sesión de quien revisa. **No
relajes esta comprobación.**

**Funciones expuestas:** `revListaPendientes`, `getRevisionCotizacion`,
`guardarRevisionCotizacion`, `revFichaArticulo`, `revVerificarPreciosLote`,
`revHojaCotizacion`, `revPaginaArticulo`. Diagnósticos: `revDiagnostico()`,
`revDiagnosticoFicha(url)`.

`REV_CHECKLIST_GENERAL` es la lista de **respaldo**: solo entra si `AuditoriaCotizacion.gs`
no está en el proyecto, y entonces la pantalla vuelve a ser casillas que se palomean a mano.

---

## 9. `AuditoriaCotizacion.gs` — auditoría automática (1 187 líneas)

Sustituye las casillas que solo se podían marcar «sí» por reglas **deterministas,
explicables y reproducibles**. Cada punto dice qué miró, qué encontró y —cuando puede— cómo
se corrige. Deliberadamente **no** es un modelo estadístico: en una pantalla que autoriza
documentos que van al cliente, un veredicto que no se puede explicar es peor que ninguno.

**Los modelos que usa y por qué esos**

| Comprobación | Método | Por qué ese |
| --- | --- | --- |
| Correo | RFC 5322 recortado + **Damerau-Levenshtein** contra dominios frecuentes | Detecta `gmial.com`: una transposición que ningún regex ve porque es un correo válido… que no existe |
| Nombres | Normalización Unicode + capitalización del español con partículas (`de`, `del`, `la`, `y`…) | Devuelve la forma corregida, no solo el reproche |
| Teléfono | Plan de numeración de México (10 dígitos, indicativo que no arranca en 0/1) + detección de rellenos (`5555555555`) | El error real de captura es el relleno |
| Dinero | Comparación con **tolerancia (épsilon)**, nunca `===` | Los importes vienen de texto ya formateado a dos decimales; exigir igualdad exacta daría falsos errores todo el día |
| Descuentos atípicos | **Z modificada** sobre mediana y **MAD** | Con 4 artículos, el propio dato anómalo desplaza la media y se camufla. La mediana no se mueve |
| Descripción vs. ficha | **Coeficiente de Dice** sobre bigramas | Tolera acentos y orden de palabras |

**Estados de un punto:** `ok`, `pendiente`, `manual`, `atencion`, `mal`, con pesos
(`AUD_PESOS`) y castigos (`AUD_CASTIGO`) que producen la puntuación global. `AUD_IVA = 0.16`.

Diagnóstico: `audDiagnostico()`.

---

## 10. `PoliticaRevision.gs` — quién pasa por la cola (791 líneas)

Decide, **en el momento de guardar**, si una cotización va a revisión o sale directa.
Antes todas nacían «En Revisión», lo que llenaba la cola de casos triviales y hacía que los
importantes se revisaran con prisa.

**Tres escalones, en este orden:**

1. Interruptor maestro `exigirRevision`. Apagado → nada pasa por revisión.
2. **Lista ordenada** de criterios: gana el **primero** que coincide. El orden **es** la
   prioridad, y por eso la pantalla deja moverlos.
3. Si ninguno coincide, manda `accionPorDefecto`.

> **Principio que no se rompe:** el simulador de la pantalla **no** reimplementa la lógica
> en JavaScript. Llama a `simularPoliticaRevision`, que ejecuta el mismo `revpolEvaluar_`
> que decide de verdad. Una pantalla de configuración que calcula su propia vista previa
> acaba mintiendo el día que las dos copias se separan — y aquí lo que se configura es si
> un precio sale sin que nadie lo mire.

La política se guarda en la propiedad de script `revision_politica_v1`, no en una hoja.
Diagnóstico: `revpolDiagnostico()`.

---

## 11. `Formatos.gs` — formatos y PDF (836 líneas)

| Formato | `id` | Cómo se genera |
| --- | --- | --- |
| PDF del sistema | `actual` | HTML → PDF (`generateQuoteHtml` en `Correos.gs`) |
| Oficial CCL Liverpool | `ccl_liverpool` | **Copia la hoja plantilla**, la llena y la exporta a PDF |

El camino del CCL es el mismo que se hacía a mano, y por eso conserva la fidelidad del
formato. Constantes: `CCL_TEMPLATE_SHEET_ID`, `CCL_SHEET_NAME = "Liverpool"`,
`CCL_OUTPUT_FOLDER_NAME = "Cotizaciones CCL generadas"`, `CCL_LINK_COLUMN = "LinkSheetCCL"`.
Predeterminado: `DEFAULT_FORMAT_ID = "actual"`. Los formatos habilitados viven en la
propiedad `formatos_habilitados`.

**Expuestas:** `getFormatSettings`, `setQuoteFormatEnabled`, `getEnabledQuoteFormats`,
`generateQuotePdfBlob`, `openQuoteInSheets`, `previewSheetCcl`, `downloadQuotePdf`.
Diagnóstico: `probarAccesoCcl()`.

> `fillCclSheet_` escribe en **posiciones concretas** de la plantilla, porque la plantilla
> es un documento oficial con maquetación fija. Es la excepción a la regla de «localiza por
> nombre»: aquí el nombre no existe. Si cambia la plantilla, hay que revisar
> `buildCclProductRow_` y `findCclSubtotalRow_`.

---

## 12. `Correos.gs` — cotización al cliente (848 líneas)

Genera el HTML de la cotización y la envía con su PDF. Remitente: el alias
`cotizacion@liverpool.com.mx` si está dado de alta como «Enviar como» en la cuenta que
ejecuta el script; si no, se envía desde la cuenta propia para no bloquear el envío.

**Aquí está el gate de salida:** `sendQuoteByEmail` consulta `revPuedeEnviarse_()` antes de
mandar nada. Es el punto que impide que salga al cliente una cotización sin aprobar.

`getVerifiedImageUrl(sku, preferredUrl)` prueba varios subdominios de imágenes de Liverpool
(`IMG_SUBDOMINIOS`) y cae a un *placeholder*; cachea 6 h, porque las imágenes de catálogo no
cambian de sitio.

---

## 13. `CorreoCliente.gs` — plantillas a clientes (166 líneas)

El asesor llena la plantilla en el navegador, la revisa y confirma; **el HTML final llega ya
armado desde el cliente** (idéntico a la vista previa, WYSIWYG) y aquí solo se valida y se
envía. Plantillas válidas: `ticket`, `edodecuenta`, `edodecuentaextranjera`,
`validacionexitosa`, `formato`, `textoplano`.

La plantilla de cotización **no** se acepta aquí: esa va con su PDF desde `correoventel.html`.
Bitácora propia: hoja `CorreosEnviados`.

---

## 14. `Metricas.gs` — métricas de correo (175 líneas)

Registro unificado de **todos** los correos que salen (cotizaciones + plantillas), en la
hoja `MetricasCorreos`. Es **aditivo**: no reemplaza la bitácora `CorreosEnviados`.

Exige que el correo del asesor **exista en `Registros`**; si no, el envío se rechaza en el
servidor. Es la traducción de «debe estar logueado» a un sistema sin token de servidor.

---

## 15. `Portal.gs` — backend de **lectura** del Portal (788 líneas)

Sirve los datos de las pantallas públicas. **No está ligado a la hoja del Portal**: todas
las lecturas van por ID (`PORTAL_SHEET_ID`, con respaldo en código).

**Expuestas:** `fetchToolsData()` (herramientas, presentaciones, paqueterías, formatos,
formas de pago, plantillas, anuncios), `fetchPromoCounts()`, `fetchApplicationData()`
(promos, MKP y calendario), `reportBrokenLink(report)`.

**Escritura de anuncios** (sí vive aquí, porque `Portal.gs` es dueño de esa hoja):
`publicarAnuncio`, `getAnunciosAdmin`, `eliminarAnuncio`, `toggleAnuncio`, `moverAnuncio`,
`subirImagenAnuncio`. Formatos de anuncio: `banner`, `destacado`, `tarjeta`, `modal`.

Las columnas se localizan por **alias** flexibles (`['enlace','liga','link','url']`) porque
los encabezados de esas hojas los escriben personas. Hay un caso real documentado: la hoja
`Presentaciones` tiene el encabezado `DESCRPCION` (sin la i), y por eso el alias es `descr`
y no `descrip`.

**Autoría.** La lectura pública devuelve `responsable` (el nombre legible de quien publicó,
nunca el correo) y `creado`; la de administración devuelve además `autor` (el correo). Las
tres se fijan al crear y no se pisan al editar: ver el §4 del documento 04.

---

## 15 bis. `Publicaciones.gs` — identidad, enlace compartible y encuestas (fase 7)

Lo que la fase 7 le puso encima a los anuncios. Va aparte de `Portal.gs` para que ese
archivo siga siendo «leer la hoja del Portal y escribir sus anuncios»; los `.gs` comparten
ámbito global, así que todo lo de aquí lleva prefijo `pub`.

**Expuestas:** `pubPorId(id, email)`, `pubResultados(id, email)`, `pubVotar({id, opcion, asesor})`.

Tres cosas, y cada una resuelve un problema que se veía como «el enlace no funciona»:

1. **Identidad.** `pubAsegurarIdsAnuncios_` le pone ID a las filas que no lo traen (las que
   alguien crea a mano en el Sheet). Corre también desde la lectura pública, con
   `LockService`; si no consigue el candado no escribe, y el id sale del contenido de la
   fila (`pubIdDeFila_`) en vez de su posición.
2. **Enlace compartible.** `pubPorId` sirve UNA publicación por su id, incluidas las
   **expiradas** y las **programadas**, diciendo en qué estado están para que el Portal lo
   escriba con palabras. Las **ocultas** no se sirven: apagar una publicación es la forma de
   retirarla, y servirla por la puerta de atrás dejaría esa decisión sin efecto.
3. **Encuestas.** Subtipo de la tarjeta (`Datos.encuesta`: pregunta, hasta 6 opciones,
   tiempo estimado, cierre). Los votos van en la hoja `Votos` —nunca en la fila del
   anuncio— con candado, dedupe por correo y límite por hora. Los resultados se leen con
   una llamada propia de **30 segundos de caché**, deliberadamente fuera de `fetchToolsData`
   y su doble caché (10 min de script + 7 días en el navegador): una gráfica de votos con
   esa edad no está desactualizada, miente.

Pruebas: `pruebas/f7_publicaciones.test.js` (94 comprobaciones sobre los fuentes reales).

---

## 16. `PortalContenido.gs` — backend de **escritura** del Portal (1 299 líneas)

Antes, para cambiar una herramienta o una plantilla había que abrir el Google Sheet a mano:
no había puerta desde la app, así que tampoco permiso que conceder ni rastro de quién cambió
qué. Este archivo pone esa puerta.

**Cómo está hecho:** un catálogo declarativo (`PC_COLECCIONES`) describe cada pestaña —qué
columnas tiene, cómo se llama en pantalla, de qué tipo es, qué se valida— y **todo lo demás
es una sola implementación genérica**. Añadir una sección es añadir una entrada al arreglo,
no escribir otro CRUD.

**Tres decisiones que importan**

1. **Se escribe celda por celda**, solo en las columnas mapeadas. La hoja `Promociones`
   tiene columnas que esta pantalla no toca (SKUS Mercaderías, banners de home);
   reescribir la fila entera las borraría.
2. **Las filas se identifican por una columna `ID`**, no por número de fila — que cambia en
   cuanto alguien inserta una fila desde el Sheet. Las pestañas que no la tenían la reciben
   automáticamente (`pcAsegurarIds_`) en la primera columna libre.
3. **Anuncios no está aquí.** Ya tiene su constructor con vista previa y programación.

Permiso: bloque `portal_contenido`. Límite `PC_LIMITE_FILAS = 400`.
Diagnóstico: `pcRevisarCatalogo()`.

---

## 17. `PortalPromosComercial.gs` — importación desde comercial (388 líneas)

Las promociones nacen en un archivo de comercial («Home Promociones comercial»), con **más
de 300 pestañas** y ninguna igual a otra: la fila de encabezados está en la 14, en la 13 o
en la 3; las columnas cambian de sitio; una pestaña puede traer dos tablas (tienda y
Marketplace); entre medias hay notas y totales que no son promociones.

Por eso aquí no se lee «la fila 14 de la columna G»: se **busca** la fila de encabezados, se
localiza cada columna por su nombre y se descarta lo que no tiene pinta de promoción
(`promosAnalizarFila_` puntúa las columnas candidatas).

**No escribe nada.** Devuelve filas normalizadas que entran por el mismo embudo que el
pegado manual (`portalContenidoAnalizarImport` → `portalContenidoAplicarImport`), con sus
mismos seguros contra duplicados. Diagnóstico: `promosRevisarHojas()`.

---

## 18. `Trazabilidad.gs` — procesos homologados (416 líneas)

Los seis procesos (Big Ticket, Soft Line, SL Mensajerías, MarketPlace, Tienda, Generales)
vivían escritos a mano dentro de `Index.html`: ~1 800 líneas de HTML que había que editar y
**volver a desplegar** cada vez que Operaciones cambiaba un tiempo. Ahora la verdad está en
la hoja de Homologación (`TRAZ_SHEET_ID`) y el Portal solo pinta.

**Cómo lee la hoja, y por qué así:**

1. No se asume posición fija de columnas: cada hoja tiene su propio número de columnas
   vacías a la izquierda y BT añade una («Tiempo avance») que las demás no tienen.
2. El nombre del proceso está en la columna **inmediatamente anterior** a «Tiempo
   p/reporte»: el encabezado «Proceso» está combinado sobre varias columnas, así que su
   índice no sirve. Esa relación sí es constante en las seis hojas.
3. El número que se muestra es la **posición** de la fila, no el número escrito: en la hoja
   hay números repetidos y filas sin número, y los anclajes (`bt-1`, `mkp-12`) tienen que
   ser únicos y estables porque el buscador global enlaza a ellos.

Cada sección se busca por **alias** de pestaña (`['BT', 'Big Ticket', 'BigTicket']`).
Utilidades: `trazInvalidarCache()`, `trazDiagnostico()`.

---

## 19. `Operacion.gs` — estado del servicio (2 402 líneas)

El archivo más grande. Responde «¿está caído Connect o soy yo?».

**Cuatro hojas:** `OperacionReportes`, `OperacionIncidentes`, `OperacionActualizaciones`,
`OperacionCatalogo`.

**El umbral automático** — la decisión de diseño central:

| Parámetro | Valor | Motivo |
| --- | --- | --- |
| `OP_UMBRAL_PERSONAS` | **3** | Con dos, un problema de red de una sola sala levantaba bandera nacional. Con cinco, una caída real tardaba demasiado en verse |
| `OP_VENTANA_MIN` | **30** | Ventana de conteo |
| `OP_UMBRAL_SERVICIO_ACTIVO` | `true` | Segundo umbral **por sistema, sin mirar el motivo** |

El segundo umbral existe porque cuando un sistema se degrada de verdad casi nunca se rompe
de una sola forma: uno dice «no abre», otro «va lentísimo», otro «no me deja entrar». Son
tres personas que no pueden trabajar con Connect, y con la regla por motivo cada una se
quedaba sola en su cubeta. Se evalúa **después** del de motivo, porque un incidente concreto
(«Connect · No abre») dice mucho más que uno genérico.

**Se cuentan PERSONAS distintas, no reportes.** Cinco reportes de la misma persona son una
persona con un problema, no un sistema caído. Es la misma regla que colorea el gráfico: usar
dos criterios pintaría el mismo suceso de dos colores según qué botón estuviera pulsado.

El texto que se publica solo al saltar un umbral es `OP_AVISO_POSIBLE = 'Es posible que
existan problemas con el servicio.'` — redactado como una **sospecha con respaldo**, no como
un hecho, para que si resulta falsa alarma nadie tenga que desdecirse. **No lleva el número
de personas ni quiénes son**: eso es para la nota interna, no para la calle.

**Público vs. privado:** `opEstadoPublico()`, `opHistorialPublico(dias)` y
`opHistorialHorasPublico(horas)` se sirven **sin sesión**, a propósito: la pregunta hay que
poder contestarla justo cuando no puedes entrar. Está verificado que por ahí no viaja ni un
correo ni una nota interna. `opPanel(email)` y las escrituras exigen el bloque `operacion`.

**Reportar no necesita bloque**: lo puede hacer cualquiera con sesión. Ponerle permiso sería
pedir autorización para avisar de que algo no funciona.

Diagnóstico: `opDiagnostico()`.

---

## 20. `Atenciones.gs` — rescate de clientes (1 005 líneas)

Un asesor está atendiendo por teléfono, Connect se cae y la atención se corta. La venta no
se caía por la falla: se caía porque **nadie apuntó el teléfono**. Este archivo es la
libreta.

**Privacidad, y es lo primero que se decide.** Aquí dentro hay nombres, teléfonos y correos
de clientes reales:

1. Por omisión, una atención la ve **solo quien la registró**. No es un CRM compartido: es
   la libreta de una persona.
2. El asesor puede decidir —**explícitamente y al registrar**— que pasado un tiempo se
   libere al **pool público** para que un compañero la rescate. Si no lo decide, ese
   registro es privado **para siempre**.

La liberación no es un castigo por tardar: es lo que permite que el cliente reciba su
llamada aunque quien lo atendió salga de turno.

| Parámetro | Valor |
| --- | --- |
| Hoja | `AtencionesPendientes` (+ `AtencionesTipos`, que se alimenta sola) |
| Bloque | `atenciones` |
| Reserva al rescatar | 15 min (`ATEN_RESERVA_MIN`) |
| Máximo de abiertas | 50 · Tope de cerradas visibles | 30 |
| Topes de texto | nombre 90 · notas 600 · tipo 40 · resultado 400 |

**Expuestas:** `atencionesPanorama`, `atencionRegistrar`, `atencionActualizar`,
`atencionLiberarAhora`, `atencionRescatar`, `atencionFinalizar`, `atencionesResumen`.
Las cinco de escritura tienen gate de servidor. Diagnóstico: `atencionesDiagnostico(correo)`.

> **Política de reintentos, deliberada:** registrar, tomar y finalizar van con **cero
> reintentos**. Repetir una escritura que crea algo daría de alta al mismo cliente dos veces
> o pisaría una reserva ajena. Solo lo idempotente —fijar unas anotaciones— reintenta.

---

## 21. `Preferencias.gs` — personalización (476 líneas)

Guarda tema, tamaño de texto, densidad y accesos fijados en **dos sitios**: `localStorage`
(lo que se lee al pintar, disponible antes del primer fotograma o la pantalla parpadea) y la
hoja `_PreferenciasUsuario` (lo que hace que la personalización siga a la persona a otro
equipo). **Una línea por persona**, no un renglón por cambio.

**Escritura optimista**, y está explicado por qué no se hace «al vuelo y esperando»: un
`google.script.run` tarda entre 300 ms y un segundo, y ajustar la letra es una tarea de
tanteo de tres o cuatro clics seguidos. Además, recargar para aplicar un cambio propio se
lleva por delante una cotización a medio escribir.

1. Se aplica al instante y se escribe en `localStorage` (síncrono, 0 ms).
2. La escritura a la hoja se encola y sale agrupada.
3. Al confirmarse **no se recarga**: lo local ya es lo nuevo.
4. Si falla de verdad, se revierte y se avisa.

---

## 22. `Onboarding.gs` — tutoriales vistos (212 líneas)

Una fila por persona y pantalla, en la hoja `Onboarding`. Se guarda en hoja y no solo en el
navegador porque `localStorage` se borra al limpiar caché y se queda en el equipo de la
sucursal: quien entra desde otra computadora no debería volver a ver el tutorial de
bienvenida como si fuera nuevo.

**Omitir cuenta como visto**: quien salta el recorrido está diciendo «ya sé usar esto».
**Esto no es un candado**: si la hoja falla, el cliente cae a lo que tenga en el navegador.
El peor caso es un tutorial de más o de menos.

---

## 23. `Admin.gs` — salud del sistema (399 líneas)

**`revisionMaestra()` es la herramienta más valiosa del proyecto.** Ejecútala desde el
editor: Google pedirá autorizar todos los permisos de una vez (porque toca todos los
servicios) y dejará en el registro un reporte legible.

**~31 comprobaciones en 10 áreas:** Despliegue · BD Cotizaciones · BD Portal · Formatos ·
Correo · Calendario · Seguridad · Permisos · Operación · Infra. Cualquier línea con ✖ dice
exactamente qué se rompió.

Córrela **después de cualquier cambio de hojas o columnas y después de cada re-despliegue.**

También: `verificarVersionDelCodigo()` y `getSystemHealth(email)` (lo que consume la sección
Salud de la consola).

---

## 24. `DiagnosticoPromos.gs` — diagnóstico del monitor (159 líneas)

Contesta la única pregunta que decide dónde está el fallo cuando el monitor abre y enseña 0
promociones: **¿el servidor devuelve filas o no?** El navegador no puede distinguir «la hoja
no tiene nada» de «la hoja tiene cosas pero no supimos leerlas»: en los dos casos llegan
cero promociones y la pantalla se ve igual.

`diagPromos()` no escribe nada. `diagLimpiarCache()` fuerza relectura.

---

## Catálogo completo de diagnósticos

Todas se ejecutan desde el editor de Apps Script (seleccionar función → Ejecutar → Ver
registro de ejecución).

| Función | Archivo | Qué contesta |
| --- | --- | --- |
| `revisionMaestra()` | `Admin.gs` | **Salud general.** Empieza siempre por aquí |
| `secDiagnostico(correo)` | `Seguridad.gs` | Cómo se está resolviendo la identidad |
| `permDiagnostico(correo)` | `Permisos.gs` | Qué bloques tiene esa persona y de dónde salen |
| `consolaDiagnostico()` | `Consola.gs` | Estado de la consola |
| `cuentasDiagnostico(correo)` | `Cuentas.gs` | Flujo de códigos y correos |
| `cuentasPreviaCorreos(enviarA)` | `Cuentas.gs` | Muestra de todas las plantillas de correo |
| `cotCacheDiagnostico()` | `Cache.gs` | Estado de la caché y su generación |
| `revDiagnostico()` / `revDiagnosticoFicha(url)` | `Revision.gs` | Revisión y lectura de una ficha concreta |
| `audDiagnostico()` | `AuditoriaCotizacion.gs` | Reglas de auditoría |
| `revpolDiagnostico()` | `PoliticaRevision.gs` | Política vigente |
| `probarAccesoCcl()` | `Formatos.gs` | Plantilla y carpeta del formato CCL |
| `probarCarpetaAnuncios()` | `Portal.gs` | Carpeta de Drive de anuncios |
| `pcRevisarCatalogo()` | `PortalContenido.gs` | Catálogo de secciones editables |
| `promosRevisarHojas()` | `PortalPromosComercial.gs` | Pestañas del archivo de comercial |
| `diagPromos()` / `diagLimpiarCache()` | `DiagnosticoPromos.gs` | Monitor de promociones |
| `trazDiagnostico()` / `trazInvalidarCache()` | `Trazabilidad.gs` | Las seis hojas de procesos |
| `opDiagnostico()` | `Operacion.gs` | Estado de operación |
| `atencionesDiagnostico(correo)` | `Atenciones.gs` | Atenciones pendientes |
| `prefsDiagnostico(correo)` | `Preferencias.gs` | Preferencias de esa persona |
| `equipoDiagnostico(correo)` | `Equipo.gs` | Puente de compatibilidad |
| `NOMBRAR_MAESTRO()` / `REPARAR_MAESTRO()` | `Permisos.gs` | **Rescate de acceso** |
| `VER_PERMISOS_GUARDADOS()` / `VER_CORREOS_REGISTRADOS()` | `Permisos.gs` | Volcado de quién es quién |
| `secGuardarConfiguracion()` | `Seguridad.gs` | Mueve los secretos a propiedades |
| `secFijarModoAuth(modo)` | `Seguridad.gs` | Cambia el modo de autenticación |
| `cotInvalidarCache_()` | `Cache.gs` | Vacía la caché de lectura |

---

> **Creador del proyecto: David Martínez** | Asesor Ventel | Escritor
