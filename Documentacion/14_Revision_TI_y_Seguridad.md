# 14 · Revisión de TI y Seguridad

> Auditoría del proyecto completo leída desde cuatro perfiles: mesa de servicio,
> TI/Infraestructura, Seguridad de la Información y un par técnico. Fecha: 18/08/2026.
>
> Método: lectura directa de código — 31 archivos `.gs`, 50 vistas HTML, 10 archivos de
> la extensión, 14 documentos y el flujo de integración continua. **No** es un escaneo
> automático. Cada hallazgo lleva su referencia de archivo y línea para que cualquiera
> pueda verificarlo por su cuenta.

---

## 1. Resumen

Ventel es un sistema real y bien construido: control de accesos por rol, bitácora,
freno de fuerza bruta, validación en servidor y manual técnico completo. Un revisor
competente lo reconoce en la primera media hora.

Aun así, una revisión formal va a producir **16 hallazgos**: 3 críticos, 5 altos y
8 medios. Frente a ellos hay 14 controles que ya están puestos y funcionan.

El dato que más pesa: **dos de los tres hallazgos críticos ya estaban documentados
por el propio autor** antes de esta revisión, con causa, riesgo y procedimiento de
corrección (§7 del documento 06). Eso no baja la severidad técnica, pero cambia por
completo cómo se lee el proyecto: los convierte en deuda gestionada y no en descuido.

**El hallazgo que define el destino del proyecto no es de seguridad.** Es que todo
—hojas, archivos, despliegue— cuelga de una cuenta personal de empleado (`V-06`).
La seguridad se remedia con un plan de 30 días; la dependencia de una persona
requiere una decisión organizacional.

---

## 2. Las cuatro preguntas del negocio

### 2.1 ¿Dónde se guarda la información?

**En Google Workspace de Liverpool, íntegramente.**

| Qué | Dónde |
| --- | --- |
| Cotizaciones, clientes, usuarios | Hojas de Google: `Cotizaciones`, `DetalleCotizaciones`, `Registros`, `Atenciones`, `_PermisosSistema` |
| Documentos generados | Copias de plantilla de Sheets, en carpeta de Drive |
| La aplicación | Apps Script en el dominio: `script.google.com/a/liverpool.com.mx/…` |
| Calendario comercial | Calendario de Google del dominio |

No hay base de datos externa, servidor rentado ni almacenamiento de terceros.

**La pregunta de seguimiento incómoda:** *¿de quién son esos archivos?* De una cuenta
personal, no de una cuenta de servicio ni de una unidad compartida. Ver `V-06`.

### 2.2 ¿Quién puede cargar información y quién puede verla?

**Cargar: bien controlado.** 24 capacidades independientes, 3 roles, ajustes por
persona, baja lógica que conserva historial. Y el control se aplica **en el servidor**,
verificado función por función. El propio código nombra el ataque que previene
(`Correos.gs:407`).

**Ver: sí, cualquier asesor puede buscar las cotizaciones de todos.** Es una decisión
de diseño deliberada y documentada — para atender a un cliente cuando su asesor no
está. Es una decisión de negocio y merece ratificación por escrito.

Lo que sí es defecto es que la función que lista y busca **no verifica la sesión en
absoluto**. Ver `V-03`.

### 2.3 ¿Se filtra información a servicios externos?

**Datos del negocio: ninguno.** Las únicas salidas de red del servidor van a Google
Chat (aviso de cotización nueva, con lista blanca de un solo host en `Consola.gs:159`)
y a `liverpool.com.mx` (verificar imágenes y leer fichas). Sin analítica, sin
telemetría, sin rastreo.

**Matiz que hay que decir primero:** las *pantallas* sí cargan librerías desde
`cdnjs.cloudflare.com` y `cdn.jsdelivr.net`, más logotipos de sitios como
`1000marcas.net` y `vectorseek.com`. No reciben datos, pero **ese código se ejecuta
con todos los privilegios dentro de la aplicación** y no está anclado con verificación
de integridad. Ver `V-07`.

### 2.4 La extensión de Chrome

Verificado sobre las 8 681 líneas, buscando toda forma de salida de datos:

```
Búsqueda: fetch( · XMLHttpRequest · sendBeacon · WebSocket · import()
Resultado en los 10 .js de la extensión: 0 coincidencias
```

**La extensión no tiene una sola llamada de red.** No puede enviar nada a ningún
lado. Lee el DOM de la página abierta, guarda en `chrome.storage.local` y abre una
pestaña hacia Apps Script.

Sobre «no modifica la página»: es cierto en el sentido que importa. El botón se crea
con `document.createElement('button')` y se inserta arriba de «Comprar»
(`cart-cotizar-button.js:238-270`). Vive en la memoria del navegador de esa persona.
No toca servidores de Liverpool ni altera lo que ven otros usuarios.

Dos matices honestos: escribe al portapapeles datos de compra (`V-12`) y está
declarada sobre todo `*.googleusercontent.com` (`V-13`).

---

## 3. Registro de hallazgos

### Críticos

| ID | Hallazgo | Evidencia |
| --- | --- | --- |
| `V-01` | **Suplantación de sesión.** La identidad es una cadena en `localStorage` que el servidor no puede verificar. Cualquiera del dominio puede actuar como otro, incluido un maestro. *Ya documentado por el autor.* | `Seguridad.gs:32-34`, `app_core.html:63-66`, `06_Seguridad_y_Permisos.md §2` |
| `V-02` | **Secretos en el código.** Sal de contraseñas y dos webhooks de Chat con llave y token. *Ya documentado por el autor.* Mitigante: el repositorio es privado (verificado contra la API de GitHub). | `Code.gs:29-30`, `Operacion.gs:126` |
| `V-03` | **Lista de cotizaciones sin control de sesión.** `getQuotesForUser` no verifica nada y, con término de búsqueda, recorre la tabla completa. Devuelve folio, cliente, correo del cliente, asesor, total y estatus. | `Code.gs:767`, `Code.gs:829-846`, reconocido en `Monitoreo.gs:353-355` |

**Corrección de `V-01`:** existe en el código — `AUTH_MODO = 'estricto'`. El costo es
operativo (obliga a usar la cuenta corporativa en el navegador) y por eso no está
puesto: en piso se comparten equipos. **Es una decisión de negocio.**

**Corrección de `V-02`:** procedimiento completo en `06_Seguridad_y_Permisos.md §7`.
Incluye **rotar el webhook** — vaciar la constante no lo borra del historial de git.

**Corrección de `V-03`:** añadir `secIdentidadConBloque_(email, 'consultar')` al inicio.
Tres líneas. Es el arreglo con mejor relación esfuerzo/impacto de toda la lista.

### Altos

| ID | Hallazgo | Evidencia |
| --- | --- | --- |
| `V-04` | **Documentos con datos de cliente en `ANYONE_WITH_LINK`.** Nombre, correo y teléfono legibles por quien tenga la liga, dentro o fuera de Liverpool. El autor documentó el riesgo y la solución (`DOMAIN_WITH_LINK`, una línea). | `Formatos.gs:548` y `:535-540`, `Operacion.gs:1769`, `Portal.gs:836`, `Articulos.gs:729` |
| `V-05` | **Alcances OAuth excesivos.** `https://mail.google.com/` da control total del correo; `auth/drive` da todo el Drive. La app solo envía correos y toca sus carpetas. | `appsscript.json` |
| `V-06` | **Todo depende de una cuenta personal.** `executeAs: USER_DEPLOYING`; hojas y carpetas en la unidad personal. Si la cuenta se da de baja, el sistema muere y los archivos entran en eliminación. | `appsscript.json`, `Formatos.gs:519-520`, `Portal.gs:614-615` |
| `V-07` | **CDNs de terceros sin `integrity`.** 20 etiquetas `<script>` hacia Cloudflare y jsDelivr, más imágenes hotlinked. Contradice literalmente «todo se queda en Google». | `Index.html:15-18`, `Promociones.html:8-10`, `inicioDeSesion.html:190-191`, `registro.html:198-199`, `recuperar.html:192-193`, `estado.html:700-701`, `articulo.html:789`, `acerca.html:350`, `app_motion.html:1,4`, `inicio_avanzado.html:7` |
| `V-08` | **Código y publicación fuera del control corporativo.** Repositorio en cuenta personal; `CLASPRC_JSON` publica a producción; `clasp push --force` en cada push a `main`, sin revisión. | `.github/workflows/apps-script-sync.yml`, `README.md` |

**Sobre `V-07`:** el patrón de corrección ya existe en casa — `app_tailwind.html`
documenta exactamente esta migración para Tailwind.

**Sobre `V-06`:** para un equipo de TI éste suele ser el hallazgo número uno, por
encima de los de seguridad. La seguridad es un riesgo; esto es una fecha de caducidad.

### Medios

| ID | Hallazgo | Evidencia |
| --- | --- | --- |
| `V-09` | **Hash de contraseña insuficiente.** SHA-256 de una pasada, mínimo 6 caracteres, sin complejidad. | `Seguridad.gs:442-446`, `Cuentas.gs:488` |
| `V-10` | **Dos funciones más sin control.** `getDashboardStats()` expone métricas por persona; `sendWebhookNotification()` permite publicar avisos falsos en el Chat de supervisión. | `Code.gs:1111`, `Code.gs:1329` |
| `V-11` | **Las pruebas existen pero no corren.** 8 archivos bien escritos que cargan el código real; ningún flujo los ejecuta. Un cambio que las rompa se publica en verde. | `pruebas/`, `.github/workflows/` |
| `V-12` | **La extensión escribe al portapapeles** datos de compra: dirección, forma de pago, últimos 4 dígitos. El portapapeles de Windows tiene historial y sincronización. | `cart-cotizar-button.js:308`, `purchase-extractor.js:341-390` |
| `V-13` | **Patrón de extensión demasiado ancho.** `*.googleusercontent.com` con `all_frames` cubre mucho más que Apps Script. | `manifest.json` |
| `V-14` | **Extensión sin distribución central.** Modo desarrollador, sin actualización automática, sin verificar versión. Muchas empresas bloquean el modo desarrollador por política. | `manifest.json` (sin `key` ni `update_url`) |
| `V-15` | **Identificadores internos en el código.** El mecanismo para sacarlos (`secConfig_`) ya existe. | `Portal.gs:21` y `:316`, `Trazabilidad.gs:38`, `Formatos.gs:25` |
| `V-16` | **Sin aviso de privacidad ni política de retención.** Sin coincidencias en 90 000 líneas para «aviso de privacidad», «ARCO», «retención», «consentimiento». | — |

**Sobre `V-12`:** los últimos 4 dígitos **no son «datos de tarjeta»** en el sentido
regulatorio — PCI DSS permite expresamente el número truncado. Conviene decirlo con
esa precisión: en una empresa que emite 3.6 millones de tarjetas, la palabra «tarjeta»
enciende un protocolo que aquí no aplica.

**Sobre `V-16`:** muy probablemente Ventel ya queda cubierto por el aviso de privacidad
general de Liverpool (mismos datos, misma finalidad). Lo que falta no es un aviso
nuevo, sino que Jurídico lo confirme por escrito.

---

## 4. Lo que está bien hecho

No es cortesía: en una revisión real, lo que se hizo bien determina cuánto crédito se
le da al resto.

1. **Controles en el servidor, no escondiendo botones.** Verificado función por función:
   `secIdentidadMaestra_`, `secIdentidadConBloque_`, `metVerificarAsesor_`. El comentario
   de `Correos.gs:407` nombra el ataque exacto que previene.
2. **Defensas dirigidas contra ataques concretos.** Lista blanca anti-SSRF de un solo
   host (`Consola.gs:159`); lista blanca de hosts de iframe comparando host exacto,
   nunca `includes`; redirección post-login por clave de página y jamás por URL;
   validador de `hostname` exacto en la extensión con el razonamiento escrito al lado
   (`popup.js:450-471`).
3. **Modelo de permisos de verdad.** 24 bloques, 3 roles, ajustes por persona, orden de
   resolución documentado, baja lógica que conserva historial, en hoja separada con la
   razón explicada.
4. **Higiene de autenticación por encima del promedio.** Bloqueo por fuerza bruta
   (8 intentos / 15 min), mensajes que no permiten enumerar usuarios, comparación en
   tiempo constante, escape de HTML. Y un detalle que revela madurez: **una contraseña
   temporal no abre sesión** — emite un vale de un solo uso.
5. **La extensión hace lo que se dice que hace.** Cero red, permisos mínimos, caducidad
   de 15 minutos, cuidado explícito contra XSS (`inspector-ui.js:859`).
6. **Documentación que se autoevalúa.** Un documento titulado «Deuda de seguridad
   conocida»; otra sección, «El límite del modo portal, dicho sin adornos». **Es el
   activo más valioso del proyecto en una revisión.**

---

## 5. Lectura por perfil

### 5.1 Mesa de servicio

Su pregunta real: *¿cuántos tickets me genera y voy a saber contestarlos?*

**A favor:** mensajes de error en español claro que dicen qué hacer; funciones de
diagnóstico en casi todos los archivos; consola para altas y reinicio de contraseñas
sin tocar código.

**En contra:** la instalación manual de la extensión (`V-14`) — y si Liverpool bloquea
el modo desarrollador por política, sencillamente no se puede instalar, **conviene
preguntarlo antes de comprometer fechas**; no hay procedimiento de escalamiento
documentado; el ticket «cerré sesión y sigo dentro» en equipos compartidos no tiene
hoy una respuesta buena.

**Veredicto probable:** favorable con condiciones. Van a pedir un manual de soporte de
una página y una vía de escalamiento. Es el perfil más fácil de convencer y el más
útil como aliado.

### 5.2 TI / Infraestructura

Su pregunta: *¿esto es un sistema de la empresa o el proyecto de una persona?*

**A favor:** no hay que aprovisionar nada — corre sobre Workspace, ya pagado y ya
gobernado. Control de versiones, publicación automatizada y manual técnico los va a
sorprender favorablemente.

**En contra, en su orden de prioridad (que no es el de Seguridad):**

1. Dependencia de cuenta personal (`V-06`) — su hallazgo número uno.
2. Repositorio fuera de la organización (`V-08`).
3. Alcances OAuth (`V-05`) — si hay proceso de aprobación de apps en Workspace,
   `https://mail.google.com/` no pasa, y se rechaza sin leer el código.
4. Sin ambientes separados: hay `main` y ya.
5. Sin plan de respaldo probado — el historial de versiones de Google no es un respaldo.

**Veredicto probable:** «buen trabajo, hay que institucionalizarlo». No van a pedir
apagarlo; van a pedir tomar posesión. **Llegar proponiendo tú la migración cambia la
conversación de "te vamos a auditar" a "cómo te ayudamos".**

### 5.3 Seguridad de la Información

Su pregunta: *¿qué datos hay, quién los alcanza, y qué pasa si esto sale en el periódico?*

**Cómo van a entrar:** no van a leer 90 000 líneas. Van a mirar cuatro cosas, y las
cuatro se ven en diez minutos — manifiesto de permisos, secretos en código,
autenticación y salidas de datos. Las cuatro tienen hallazgo. **El proyecto se ve peor
en los primeros diez minutos de lo que realmente es:** toda la calidad está en la
profundidad, y la profundidad se lee después.

**Lo que van a escalar:** `V-01` (escalada a administrador), `V-03` + `V-04` (juntos
producen la frase «hay datos personales de clientes accesibles sin autenticación») y
`V-02`.

**Contexto en contra:** Liverpool tiene memoria institucional de un incidente — en
diciembre de 2014 sufrió una intrusión con extorsión en la que se obtuvieron datos de
clientes y correos del personal. Es además el tercer emisor de tarjetas de crédito de
México. Un área de Seguridad con ese historial es conservadora por diseño.

**Contexto a favor, y hay que usarlo:** Ventel **no toca datos de tarjeta** y por tanto
**no entra en alcance PCI DSS**. Lo único que se aproxima son los últimos 4 dígitos que
la extensión lee de una pantalla de confirmación, expresamente permitidos por el
estándar.

**Veredicto probable:** plazo de remediación de 30-90 días con seguimiento formal, no
apagado. La documentación de deuda conocida es la mejor carta: suele ser la diferencia
entre un plan acordado y una suspensión preventiva.

### 5.4 Un par técnico

**Lo primero que va a pensar:** esto está muy por encima de lo que suele llegar como
herramienta interna. 90 000 líneas organizadas por dominio, prefijos consistentes,
caché en dos niveles con TTL adaptativo, pruebas que cargan el archivo real, y
comentarios que explican *por qué* y no *qué*. El comentario de `bridge.js`
reconstruyendo por qué falló la v1 y la v2 es mejor ingeniería documentada que la de
muchos repositorios profesionales.

**Lo que te diría de frente:**

- «Te falta el candado de la puerta principal, y lo sabes.» Toda la sofisticación de
  permisos se apoya en una identidad no probada.
- «Cuatro archivos son demasiado grandes.» `Operacion.gs` 3 132 líneas, `Index.html`
  8 502. Navegable hoy por los comentarios; la siguiente persona va a sufrir.
- «El auto-push te va a morder.» Funciona mientras seas uno.
- «Las pruebas están ahí y no corren.» Media hora con el mejor retorno del proyecto.

**Y al final:** «el código no es el problema. El problema es que esto ya dejó de ser un
proyecto personal y todavía está montado como uno. Lo que cuesta no son los hallazgos:
es el cambio de dueño.»

---

## 6. Marco legal aplicable

La **LFPDPPP** se publicó nueva el **20 de marzo de 2025** y entró en vigor al día
siguiente. Cambio clave: **el INAI desapareció como autoridad**; sus funciones pasaron
a la **Secretaría Anticorrupción y Buen Gobierno**. Citar la ley vigente da credibilidad
inmediata.

| Obligación | Estado en Ventel | Qué falta |
| --- | --- | --- |
| Aviso de privacidad | No localizado | Confirmar con Jurídico que el aviso general lo cubre |
| Consentimiento | Implícito en la relación comercial | Ratificación por escrito |
| Derechos ARCO | Sin procedimiento propio | Enlazar con el corporativo |
| Medidas de seguridad | Parcial | Cerrar `V-01`, `V-03`, `V-04` |
| Retención y supresión | Sin política | Definir plazo y purga |
| Transferencias | **Ninguna** | Nada — este punto está limpio |

---

## 7. Plan de trabajo

### Antes de la siguiente junta · 1 día

1. Control de sesión en `getQuotesForUser`, `getDashboardStats`; volver interna
   `sendWebhookNotification`. (`V-03`, `V-10`)
2. `secGuardarConfiguracion()`, vaciar `Code.gs:29-30` y **rotar el webhook**.
   (`V-02`, `V-15`)
3. Servir GSAP y Chart.js desde el proyecto, como ya se hizo con Tailwind. (`V-07`)
4. `ANYONE_WITH_LINK` → `DOMAIN_WITH_LINK` en los cuatro puntos, probando la vista
   previa. (`V-04`)
5. Añadir las pruebas al flujo, bloqueando la publicación si fallan. (`V-11`)

### Dos semanas · requiere probar

1. Reducir OAuth a `gmail.send` y `drive.file`; probar en copia — el alias de remitente
   puede requerir ajuste. (`V-05`)
2. Proteger `main` con revisión obligatoria; desactivar el auto-push. (`V-08`)
3. Restringir el patrón de la extensión; quitar el portapapeles automático.
   (`V-12`, `V-13`)
4. Mínimo de contraseña a 12 caracteres como paliativo. (`V-09`)
5. Manual de soporte de una página y vía de escalamiento.

### Un trimestre · requiere decisiones de otros

1. **Migrar a unidad compartida y cuenta funcional.** El punto más importante. (`V-06`)
2. Trasladar el repositorio a la organización de Liverpool. (`V-08`)
3. Decidir con el negocio si se cierra la suplantación con `AUTH_MODO = 'estricto'`,
   sabiendo el costo operativo. (`V-01`)
4. Publicar la extensión por política de Workspace. (`V-14`)
5. Cerrar con Jurídico el aviso de privacidad y la retención. (`V-16`)
6. Capacitar a una segunda persona.

---

## 8. Cierre

El trabajo es bueno. No «bueno para no ser programador de profesión»: bueno.

Y aun así van a encontrar cosas — 16, según esta revisión. Tres se marcan solas en
cualquier revisión formal, y las tres son reales.

Pero el hallazgo que define el destino del proyecto no es de seguridad: es que todo
cuelga de una cuenta personal. La seguridad se remedia con un plan; la dependencia de
una persona requiere una decisión organizacional, y ésa es la que hay que pedir.

**La recomendación concreta:** abrir la junta con los tres hallazgos críticos y el
plan, antes de enseñar una sola pantalla. Cuesta diez minutos incómodos y compra la
credibilidad del resto de la sesión. Enseñar primero lo bonito y que los problemas
salgan después, en boca de otro, es el guion que hunde proyectos que merecían
aprobarse.

---

## Fuentes externas consultadas

- [KPMG — Nueva LFPDPPP](https://kpmg.com/mx/es/tendencias/2025/04/flash-nueva-ley-federal-de-proteccion-de-datos-personales-en-posesion-de-los-particulares.html)
- [Lexology — eliminación del INAI](https://www.lexology.com/library/detail.aspx?g=e1e85c03-457a-468c-b405-b8777bd5af7d)
- [Forbes México — antecedente 2014](https://forbes.com.mx/liverpool-denuncia-hackeo-su-base-de-datos/)
- [El Financiero — contexto del incidente](https://www.elfinanciero.com.mx/empresas/hackeo-a-liverpool-podria-costarle-mas-de-100-mdp-estiman/)
