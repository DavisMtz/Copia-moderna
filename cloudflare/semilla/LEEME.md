# Semillas de la base D1

`scripts/dev-aislado.sh` aplica en orden todos los `semilla/*.sql` a una base local nueva.

| Archivo | Qué es | ¿En git? |
| --- | --- | --- |
| `00_usuarios_demo.sql` | Cuentas ficticias de la demo (contraseña `VentelDemo2026`) | Sí |
| `portal_ventel.json` | Catálogo REAL de la hoja «Portal Ventel» (herramientas, paqueterías, formatos, planes de pago, plantillas, promociones, MKP, anuncios), sin contraseñas ni datos de clientes | **No**: el repo es público |
| `10_demo.sql` | Datos de la demo, TODOS ficticios (lo genera `scripts/sembrar.mjs`) | Sí |
| `20_catalogo_portal.local.sql` | El catálogo real del Portal convertido a SQL (lo genera `scripts/sembrar.mjs`) | **No** |
| `*.local.sql` | Todo lo que se genera a partir del catálogo real | **No** |

Para regenerar `portal_ventel.json` hace falta acceso a la hoja en Google Drive (exportarla como XLSX y
convertirla sin las columnas «Como acceder» y «Claves»).

## Regenerar la demo: `scripts/sembrar.mjs`

`10_demo.sql` y `20_catalogo_portal.local.sql` **no se editan a mano**: los escribe `scripts/sembrar.mjs` (Node puro, sin
dependencias). Se aplican en orden junto con `00_usuarios_demo.sql` (`dev-aislado.sh` ya lo hace con una base nueva).

```bash
cd cloudflare
node scripts/sembrar.mjs                          # genera los dos archivos y los comprueba en una base en memoria
node scripts/sembrar.mjs --solo=demo              # solo 10_demo.sql
node scripts/sembrar.mjs --solo=catalogo          # solo 20_catalogo_portal.local.sql
node scripts/sembrar.mjs --ahora=2026-10-06T14:00 # fija «ahora» (hora de México si no lleva zona)
node scripts/sembrar.mjs --sin-validar            # no aplica el resultado a node:sqlite para comprobarlo

scripts/dev-aislado.sh semilla 8808 --reiniciar   # base local NUEVA con migraciones + todas las semillas
```

Es **determinista**: con el mismo «ahora» sale exactamente el mismo archivo. Las fechas son **relativas a «ahora»** (por omisión,
la hora en punto más reciente, hora de México), así que la demo siempre llega «hasta hoy»: regenerar es la forma de refrescarla.
`10_demo.sql` empieza vaciando las tablas que llena (cotizaciones, métricas, operación, atenciones, bitácora, grupos, onboarding,
artículos, votos, trazabilidad, y de la bandeja de salida solo lo marcado «Dato de ejemplo»), por lo que aplicarlo de nuevo no
duplica nada; no toca cuentas, permisos, ajustes ni el catálogo del Portal.

### Qué genera `10_demo.sql` (todo ficticio)

| Tabla(s) | Qué lleva |
| --- | --- |
| `cotizaciones`, `detalle_cotizaciones`, `contadores` | ~160 cotizaciones de los últimos 75 días con sus partidas: folios `LVP-AAMMDD-XXXX` consecutivos por día, más trabajo en días hábiles y de 9 a 21 h, varias hoy y esta semana. Estatus `En Revisión`, `Aprobada`, `Rechazada`, `Enviada por Correo` (y algún `Folio Generado` heredado) con sus columnas de revisión y `fecha_envio` coherentes; importes con la fórmula de la pantalla y de la auditoría. Artículos reales de Liverpool (`pruebas/ext_*`) y genéricos con SKU de 10 dígitos. Clientes y teléfonos ficticios, correos `@ejemplo.com` |
| `metricas_correos`, `correos_enviados`, `correos_salida` | Un envío por cada cotización enviada (más reenvíos y 3 intentos fallidos), ~55 plantillas a clientes, difusiones a grupos; remitente `ventel@logidma.com` (Brevo) y alias «Sí». En la bandeja de salida, los últimos 12 envíos de cotización con el HTML aprobado (estado `omitido`, detalle «Dato de ejemplo») |
| `metricas_busquedas` | ~300 búsquedas de cotizaciones (clientes, folios, correos) |
| `operacion_*` | 9 incidencias en 30 días (2 abiertas hoy: Connect confirmada y Salesforce «en observación»; el resto resueltas o descartadas) con ~40 reportes, su historial, reportes sueltos y el catálogo con uso |
| `atenciones_pendientes`, `atenciones_tipos` | ~25 atenciones: privadas, liberadas al pool, programadas y cerradas (algunas rescatadas por otra persona) |
| `portal_articulos`, `portal_articulos_vistas` | 3 artículos publicados y 1 borrador, con lecturas |
| `portal_anuncios`, `portal_votos` | Una encuesta activa con votos, un banner, un destacado programado y una tarjeta ya vencida |
| `grupos`, `bitacora_consola`, `onboarding` | 3 grupos; ~40 apuntes de bitácora; tutoriales vistos por el maestro y la supervisión (los asesores los ven todos) |
| `trazabilidad_secciones`, `trazabilidad_procesos` | Las seis secciones de `pruebas/trazabilidad_payload_20260926.json` |

Cada forma (JSON de bloques de artículos, `Datos (JSON)` de anuncios, `RevisionChecklist`, `metricas_correos`…) se copia de lo que
escribe el módulo correspondiente; el script lo comprueba contra `migrations/` y rechaza tablas o columnas que no existan y
números en columnas `TEXT` (D1 los guardaría como `1.0`).

### Qué genera `20_catalogo_portal.local.sql` (real, fuera de git)

Sale de `portal_ventel.json` y vuelca herramientas, presentaciones, paqueterías, formatos, planes de pago, plantillas,
promociones, Marketplace y el anuncio de la hoja a sus tablas `portal_*`. Los encabezados se localizan con los mismos alias que
`PortalContenido.gs` (coincidencia «contiene», o exacta con `=`; una columna se asigna una sola vez), `orden` es la posición de la
fila en la hoja (0 = la primera), la hora de las fechas se toma como hora de México y pasa a ISO UTC, y «Como acceder» / «Claves»
de las herramientas se dejan **vacías** (llevaban contraseñas). Añade unos pocos enlaces reportados y apuntes de bitácora sobre
elementos reales del catálogo. Sin `portal_ventel.json`, el script lo avisa y solo genera `10_demo.sql`.
