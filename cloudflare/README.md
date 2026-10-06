# Portal Ventel en Cloudflare

Maqueta funcional del Portal Ventel corriendo en **Cloudflare Workers + D1 (SQL)** en lugar de
Google Apps Script + Google Sheets. **Las pantallas son las mismas**: se sirven tal cual desde
`Carpeta del proyecto/`, con sus animaciones GSAP, temas y atajos. Lo que cambia es todo lo que hay
debajo.

**En línea:** https://ventel.logidma.com

| Cuenta de la demo | Rol | Contraseña |
| --- | --- | --- |
| `maestro@ventel.example` | Maestro (todo, consola, explorador de datos) | `VentelDemo2026` |
| `supervisora@ventel.example` · `supervisor@ventel.example` | Supervisor | `VentelDemo2026` |
| `asesor@ventel.example` (y otros `…@ventel.example`) | Asesor | `VentelDemo2026` |

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

## Qué no hace esta versión (a propósito)

Lo que depende de Google se dejó fuera, por decisión del proyecto:

- **Correos**: no salen. Cada correo se guarda completo en la tabla `correos_salida` (se ve en el
  explorador de datos, `?page=datos`, como maestro) y el flujo sigue como si hubiera salido.
- **Google Drive**: no se generan PDF ni hojas CCL en Drive. Las imágenes subidas (anuncios,
  artículos, evidencias) sí funcionan: van a R2.
- **Calendar, Chat y hojas externas de comercial**: vacíos.

## Trabajar en local

```bash
npm ci                      # en la raíz del repo (lo necesita scripts/build.js)
cd cloudflare && npm ci
npm run construir           # pantallas + islas React → public/
scripts/dev-aislado.sh yo 8787 &          # Worker local con su base D1 (migraciones + semillas)
node scripts/rpc.mjs --como asesor@ventel.example getQuotesForUser '["asesor@ventel.example"]'
node pruebas/recorrido.mjs http://127.0.0.1:8787 /tmp/recorrido   # todas las pantallas, todos los roles
```

## Publicar

```bash
scripts/desplegar.sh              # migraciones remotas + API + borde
scripts/desplegar.sh --semillas   # además recarga los datos de la demo en la base remota
```

Necesita `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.

## Datos

- `semilla/00_usuarios_demo.sql` y `semilla/10_demo.sql`: cuentas y datos ficticios (en git).
- El catálogo real del Portal (herramientas, paqueterías, formatos, planes de pago, plantillas,
  promociones, Marketplace, anuncios) sale de la hoja «Portal Ventel», **sin las columnas de
  contraseñas ni datos de clientes**, y vive solo en la base D1: **no se sube a git** porque el
  repositorio es público. Ver `semilla/LEEME.md`.
