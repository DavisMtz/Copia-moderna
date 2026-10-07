# 19 · Propuesta: el Portal Ventel en Cloudflare

> **Estado:** maqueta funcional publicada en **https://ventel.logidma.com** (octubre de 2026).
> Código: carpeta `cloudflare/` y extensión 3.1 (`Extencion para chrome/`).
> **No es el Portal oficial.** Es la misma aplicación sobre otra infraestructura, para enseñar cómo se
> vería y cuánto más rápido iría. Las cifras de Apps Script salen de los docs 13 y 15; las de Cloudflare
> se midieron sobre la maqueta publicada (§3).

---

## 1. En una página

El Portal de hoy corre en **Google Apps Script** y guarda todo en **hojas de Google Sheets**. Funciona,
pero cada pantalla y cada dato pagan el arranque del proyecto en los servidores de Google: medido en el
doc 15, **una llamada al servidor tarda ~2 s** aunque no haga nada, y el Portal termina de llegar a los
**≈13 s** en producción.

La maqueta pone **la misma aplicación** sobre **Cloudflare Workers** y una **base de datos SQL (D1)**:

- **Las pantallas son las mismas**, archivo por archivo: mismo diseño, mismas animaciones, mismos atajos
  y los tres temas. Se generan de `Carpeta del proyecto/` sin tocarla.
- **Lo que cambia es lo de abajo**: el servidor (los `.gs`) se reescribió en TypeScript sobre SQL, y un
  puente hace que las pantallas no noten la diferencia.
- **El resultado** se resume en la tabla del §3: llamadas que en Apps Script tardaban segundos tardan
  decenas de milisegundos, y cambiar de pantalla es casi inmediato.

## 2. Qué se construyó

| Pieza | Qué hace |
| --- | --- |
| **Worker del borde** (`portal-ventel`) | Sirve las 20 pantallas desde el punto de Cloudflare más cercano a quien abre el Portal. Los módulos compartidos (estilos y código común) se guardan en el navegador un año: al cambiar de pantalla solo viaja lo propio de esa pantalla. |
| **Worker de API** (`portal-ventel-api`) | Lo que en Apps Script era `google.script.run`: las 131 funciones de los `.gs` que llaman las pantallas, con los mismos nombres, argumentos y respuestas. Corre junto a la base de datos. |
| **Base de datos D1** (`ventel-portal`) | Una tabla por cada pestaña de los tres libros (BD Cotizaciones, Hoja del Portal, Trazabilidad), con índices. |
| **Puente** (`gas-shim.js`) | Reimplementa `google.script.run`, `google.script.history` y `google.script.url` en el navegador: por eso las pantallas no cambian una línea. |
| **Correo** | Sale de verdad por **Brevo**, desde `ventel@logidma.com` (dominio autenticado con SPF y DKIM). Mismo HTML, asunto y copias que el original; la respuesta del cliente le llega al asesor. Cada envío queda registrado con su estado. |
| **PDF** | **Cloudflare Browser Rendering** convierte en PDF la misma hoja de la cotización (formato actual o CCL). Se descarga desde la consulta y la vista previa, y va adjunto en el correo al cliente, como antes desde Drive. |
| **Imágenes** (R2) | Anuncios, artículos y evidencias de fallas: lo que antes iba a carpetas de Drive. |
| **Panel de velocidad** (React) | Un botón discreto en todas las pantallas que enseña cuánto tardó cada llamada, comparado con las cifras medidas de Apps Script y citando su fuente. |
| **Explorador de datos** (React, `?page=datos`, solo maestro) | Las tablas de la base, sus filas, una consola de solo lectura y la bandeja de los correos enviados. |
| **Extensión 3.1** | Lleva la bolsa de liverpool.com.mx a una cotización del Portal nuevo. Sigue funcionando con el de Apps Script. |

## 3. Por qué es más rápido, con cifras

Tres motivos:

1. **No hay arranque por llamada.** En Apps Script cada llamada carga el proyecto entero (doc 15 §2:
   ~1–2.8 s solo en eso). Un Worker ya está en memoria: arranca en milisegundos.
2. **SQL con índices en lugar de hojas.** Apps Script lee la hoja completa para encontrar un folio; D1
   busca por índice. La API corre junto a la base: cada consulta tarda ~10–15 ms.
3. **Pantallas desde el borde y en caché.** El Portal servido por Apps Script pesa 1,175 KB por visita
   (doc 15 §2). Aquí el HTML propio de cada pantalla pesa 15–157 KB y lo común se descarga una vez.

| Qué se mide | Apps Script (fuente) | Cloudflare (maqueta) |
| --- | --- | --- |
| Una llamada al servidor sin trabajo | **773 ms** el mínimo de Google; **1,994 ms** con el código del Portal (doc 15 §3.2, 23/09/2026) | _se completa al publicar la versión final_ |
| Iniciar sesión (llamada completa) | — | 93–190 ms de servidor (06/10/2026, 9 consultas) |
| Primer byte del Portal | 3,225 ms en pruebas · 3,952 ms en producción (doc 15 §2) | _se completa al publicar_ |
| Portal listo para usarse | 3.6 s en pruebas · 4.5 s en producción (doc 15 §2) | _se completa al publicar_ |
| Último dato del Portal | ≈13 s antes de la Fase 3; 5.8–8.0 s después (docs 13 y 15) | _se completa al publicar_ |
| Peso de la página | 1,175 KB por visita (doc 15 §2) | 15–157 KB por pantalla; lo común (1.8 MB) una sola vez |

## 4. Arquitectura

```
 Navegador del asesor
   │  https://ventel.logidma.com/?page=…        (mismo enrutado que /exec?page=…)
   ▼
 Worker del borde ─────────────── punto de Cloudflare más cercano (CDMX, Querétaro…)
   │  · pantallas generadas de «Carpeta del proyecto»
   │  · módulos compartidos con caché de un año
   │  /api/*  (Service Binding, sin salir de la red de Cloudflare)
   ▼
 Worker de API ────────────────── junto a la base de datos (Seattle)
   │  · secEjecutar / secEjecutarLote: el mismo canal que google.script.run
   │  · sesiones con llave, identidad y permisos por bloques (portados tal cual)
   ├──► D1 «ventel-portal» (SQL)
   ├──► R2 (imágenes)
   └──► Brevo (correo, dominio logidma.com)
```

Las reglas de seguridad no cambian: el permiso del cliente es cortesía y la puerta es del servidor, que
vuelve a comprobar la sesión y el bloque en cada llamada (doc 06).

## 5. Qué cambia y qué no

| | Apps Script hoy | Maqueta en Cloudflare |
| --- | --- | --- |
| Pantallas, diseño y animaciones | `Carpeta del proyecto/` | **Las mismas** (se generan de ahí) |
| Servidor | 34 archivos `.gs` | TypeScript, mismas funciones y respuestas |
| Datos | 3 libros de Sheets | Base SQL D1, una tabla por pestaña |
| Quién edita el contenido | El equipo, en el Sheet o en «Contenido del Portal» | Solo desde «Contenido del Portal» (ya no hay Sheet) |
| Correo | Gmail de la cuenta que despliega, alias de grupo | Brevo, dominio logidma.com |
| Archivos | Carpetas de Drive | R2 |
| Acceso | Solo cuentas de liverpool.com.mx (Google) | Cualquiera con la dirección; entra quien tiene cuenta del Portal |
| Cuotas | Las de Apps Script (tiempo, correos, 30 ejecuciones simultáneas) | Las de Cloudflare (§8), muy por encima del uso del equipo |

## 6. Lo que la maqueta no hace (a propósito)

- **Hojas de Google Sheets** («Abrir en Sheets» y la hoja CCL editable): no se generan. El PDF sí (§2).
- **Calendario comercial (Calendar)**, **avisos de Google Chat** y **hojas externas de comercial**:
  vacíos, sin fallar.
- **Datos de clientes y cotizaciones**: son de ejemplo. El catálogo del Portal (herramientas,
  paqueterías, formatos, planes de pago, plantillas, promociones, Marketplace) es el real, **sin las
  columnas de contraseñas**.
- **Tareas programadas** (`PromosAuto.gs`): no se portaron; en Cloudflare serían un Cron Trigger.

## 7. Para llevarlo a producción de verdad

En orden, y el primero no es técnico:

1. **Aprobación de TI y Seguridad de la Información.** Hoy los datos viven en el Google Workspace de
   Liverpool. Moverlos a Cloudflare es sacarlos de ahí: hace falta una cuenta corporativa de Cloudflare
   (no personal), el contrato y la revisión del doc 14 (datos personales de clientes en
   `AtencionesPendientes` y `Cotizaciones`).
2. **Acceso solo para el dominio.** Cloudflare Access con el inicio de sesión de Google de Liverpool
   recupera la regla de hoy («solo cuentas de liverpool.com.mx») antes de llegar al Portal.
3. **Migrar los datos.** Un script lee los tres libros y llena las tablas (el del catálogo ya existe).
   Conviene una semana con los dos sistemas en paralelo.
4. **Correo corporativo.** El dominio de Liverpool autenticado en un proveedor de correo (o la API de
   Gmail), en lugar de logidma.com.
5. **Operación.** Copias de seguridad automáticas de D1 (restauración a cualquier punto de los últimos
   30 días en el plan de pago), registros y alertas de los Workers.
6. **Extensión.** Una versión que apunte al dominio definitivo (es cambiar una constante).

## 8. Costos

Precios publicados por Cloudflare, consultados el 06/10/2026 (Browser Rendering, el 07/10/2026):

| Servicio | Incluido | Después |
| --- | --- | --- |
| Workers, plan de pago | USD 5 al mes con 10 millones de peticiones y 30 millones de ms de CPU | USD 0.30 por millón de peticiones |
| D1 (en el plan de pago) | 25 mil millones de filas leídas, 50 millones escritas y 5 GB al mes | USD 0.001 por millón leídas · USD 1 por millón escritas |
| R2 | 10 GB al mes | USD 0.015 por GB |
| Archivos estáticos (las pantallas) | Gratis e ilimitados | — |
| Browser Rendering (el PDF) | 10 horas de navegador al mes | USD 0.09 por hora |

Un PDF tarda alrededor de un segundo de navegador: las 10 horas incluidas alcanzan para decenas de miles
de PDF al mes. La maqueta corre en el plan de pago base de Workers (USD 5 al mes), que es el que permite
ubicar la API junto a la base. Para el equipo completo lo esperable es ese mismo plan; conviene
confirmarlo con las métricas reales de uso de las primeras semanas.

## 9. Riesgos

| Riesgo | Qué lo mitiga |
| --- | --- |
| Gobierno de datos: información de clientes fuera de Google Workspace | Paso 1 del §7: no se migra sin aprobación de TI |
| Dos versiones que divergen durante la transición | Las pantallas de Cloudflare se generan de `Carpeta del proyecto/`: hay una sola fuente |
| Que el equipo pierda la edición directa en el Sheet | «Contenido del Portal» ya cubre las ocho colecciones; un CSV se puede importar desde ahí |
| Depender de un proveedor nuevo | El código es TypeScript estándar y SQL; la base se exporta con un comando |

## 10. Guion para presentarlo (10 minutos)

1. Abre **https://ventel.logidma.com**: el Portal sin sesión, igual que hoy. Abre el **panel de
   velocidad** (botón ⚡) y enseña lo que tardó cada dato.
2. Entra como **asesor** y arma una **cotización nueva**; guárdala y abre la vista previa.
3. Entra como **supervisora**: la cotización está en **revisión**; apruébala.
4. Envíala por correo a una dirección tuya: llega desde `ventel@logidma.com`.
5. Desde una ficha de liverpool.com.mx, con la **extensión 3.1**, lleva una bolsa a una cotización.
6. Entra como **maestro**: la **consola**, y el **explorador de datos** (`?page=datos`) con las tablas
   SQL y la bandeja de correos enviados.
