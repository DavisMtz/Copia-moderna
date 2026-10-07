# Portal Ventel en Cloudflare

Maqueta funcional del Portal Ventel corriendo en **Cloudflare Workers + D1 (SQL)** en lugar de
Google Apps Script + Google Sheets. **Las pantallas son las mismas**: se sirven tal cual desde
`Carpeta del proyecto/`, con sus animaciones GSAP, temas y atajos. Lo que cambia es todo lo que hay
debajo.

**En línea:** https://ventel.logidma.com

| Cuenta de la demo | Rol |
| --- | --- |
| `maestro@ventel.example` | Maestro (todo, consola, explorador de datos) |
| `supervisora@ventel.example` · `supervisor@ventel.example` | Supervisor |
| `asesor@ventel.example` (y otros `…@ventel.example`) | Asesor |

**La contraseña de producción no está en el repositorio** (es público y en producción los correos
salen de verdad): la da quien administra la demo. Se cambia con `node scripts/claves-produccion.mjs
[clave]`, que además genera una sal propia (`HASH_SALT`), y aplicando el archivo que deja
(`semilla/99_claves_produccion.local.sql`) a la base remota. En local todas las cuentas usan
`VentelDemo2026`.

La propuesta, con las cifras medidas contra Apps Script, está en
[`Documentacion/19_Propuesta_Portal_Cloudflare.md`](../Documentacion/19_Propuesta_Portal_Cloudflare.md).

## Cómo funciona

```
 Navegador ──► portal-ventel (Worker del borde, ventel.logidma.com)
                 · sirve las 20 pantallas desde el punto de Cloudflare más cercano
                 · módulos compartidos con caché de un año (/vx/p/*)
                 · /api/* ──Service Binding──► portal-ventel-api (Worker junto a la base, Seattle)
                                                 · secEjecutar / secEjecutarLote (google.script.run)
                                                 · D1 «ventel-portal» (SQL) · R2 (imágenes)
```

- **Las pantallas no se tocan.** `scripts/construir.mjs` toma `Carpeta del proyecto/` (vía el build
  de Apps Script de `scripts/build.js`), resuelve los `include()` como lo hacía HtmlService y genera
  `public/pantallas/*.html`. El enrutado `?page=…` es el mismo que el de `/exec`.
- **`google.script.run` → `POST /api/rpc`.** `src/shim/gas-shim.js` reimplementa `google.script.run`,
  `google.script.history` y `google.script.url` con la misma forma, encima de `fetch` y de la History
  API. Va en línea como primer elemento de cada pantalla.
- **Los `.gs` → TypeScript sobre D1.** `src/worker/modulos/*.ts`, una función por cada función que
  llama el navegador, con el mismo nombre, los mismos argumentos y la misma respuesta. El canal, las
  sesiones con llave, la identidad y los permisos por bloques están en `src/worker/nucleo/` y
  `src/worker/rpc.ts`. Convenciones: [`AGENTES.md`](AGENTES.md).
- **Las hojas → tablas.** `migrations/` (una tabla por pestaña de los tres libros, doc 04).

## Qué cambia respecto al original

Lo que depende de Google se resolvió así:

- **Correos**: salen de verdad por **Brevo** desde el dominio **logidma.com** (`ventel@logidma.com`,
  ajuste `BREVO_REMITENTE`) en lugar de Gmail y del alias de grupo del original; es la única diferencia.
  Cada correo queda además en la tabla `correos_salida` con su estado (se ve en el explorador de datos,
  `?page=datos`, como maestro). Nunca se manda a direcciones de ejemplo (`@ventel.example`,
  `@ejemplo.com`). En local no hay clave de Brevo: nada sale. Interruptor de emergencia: propiedad
  `CORREO_ENVIO_REAL = no`. Lo que se puede pedir **sin sesión** (códigos de registro y de
  recuperación) tiene tope: 40 al día y 6 por hora por conexión.
- **PDF**: lo genera **Cloudflare Browser Rendering** (binding `NAVEGADOR` del Worker de API) con la
  misma hoja de la cotización, formato actual (carta) o CCL (A4 apaisado). Se descarga desde la
  consulta y la vista previa y va adjunto en el correo al cliente. En local no hay navegador: la
  pantalla avisa y el correo sale sin adjunto.
- **Google Drive y Sheets**: no se generan hojas («Abrir en Sheets», la hoja CCL editable). Las
  imágenes subidas (anuncios, artículos, evidencias) van a R2 (sin SVG).
- **Calendar, Chat y hojas externas de comercial**: vacíos.

## Trabajar en local

```bash
npm ci                      # en la raíz del repo (lo necesita scripts/build.js)
cd cloudflare && npm ci
npm run construir           # pantallas + islas React → public/
scripts/dev-aislado.sh yo 8787 &          # Worker local con su base D1 (migraciones + semillas)
node scripts/rpc.mjs --como asesor@ventel.example getQuotesForUser '["asesor@ventel.example"]'
node pruebas/recorrido.mjs http://127.0.0.1:8787 /tmp/recorrido   # todas las pantallas, todos los roles
pruebas/todas.sh                  # las pruebas de todos los módulos, cada una con su base nueva
```

Contra producción, el recorrido y la medición necesitan la contraseña: `CLAVE=… node
pruebas/recorrido.mjs https://ventel.logidma.com /tmp/recorrido` y `CLAVE=… node pruebas/medir.mjs
https://ventel.logidma.com` (mide como el doc 15 midió Apps Script).

## Publicar

```bash
scripts/desplegar.sh                         # migraciones remotas + API + borde (no toca los datos)
node scripts/sembrar.mjs                     # regenera los datos de ejemplo con fechas de hoy
scripts/desplegar.sh --semillas              # además recarga los datos de ejemplo en la base remota
scripts/desplegar.sh --semillas --catalogo   # y el catálogo real del Portal
```

`--semillas` vacía y vuelve a llenar las tablas de la demo (cotizaciones, métricas, operación,
artículos…): se pierde lo que se haya hecho en vivo en ellas. Las cuentas y su contraseña de producción
se aplican primero y juntas. Necesita `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`, y la clave de
Brevo como secreto del Worker de API (`npx wrangler secret put BREVO_API_KEY -c wrangler.api.jsonc`).

## Datos

- `semilla/00_usuarios_demo.sql` y `semilla/10_demo.sql`: cuentas y datos ficticios (en git).
- El catálogo real del Portal (herramientas, paqueterías, formatos, planes de pago, plantillas,
  promociones, Marketplace, anuncios) sale de la hoja «Portal Ventel», **sin las columnas de
  contraseñas ni datos de clientes**, y vive solo en la base D1: **no se sube a git** porque el
  repositorio es público. Ver `semilla/LEEME.md`.
- En producción la pantalla Portal es pública como hoy, pero sin el candado del dominio de Google:
  quien tenga la dirección ve el catálogo sin iniciar sesión (decisión del 07/10/2026). Para cerrarlo,
  Cloudflare Access delante de `ventel.logidma.com` (doc 19 §7).
