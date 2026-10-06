# Portar un módulo de Apps Script al Worker — guía común

Esta carpeta (`cloudflare/`) es el Portal Ventel corriendo en un **Cloudflare Worker con D1 (SQL)**
en lugar de Google Apps Script + Google Sheets. Las pantallas NO se tocan: son las mismas de
`Carpeta del proyecto/`, servidas tal cual, y un puente (`src/shim/gas-shim.js`) convierte cada
`google.script.run` en un `POST /api/rpc`. Tu trabajo es que **cada función del servidor que llama el
navegador responda exactamente lo mismo que respondía en Apps Script**, leyendo y escribiendo en D1.

Léelo entero antes de empezar. Lee también `Documentacion/01_Arquitectura_General.md`,
`Documentacion/04_BaseDeDatos_y_Hojas.md` y el `README.md` de `Carpeta del proyecto/` en lo que toque a
tu módulo.

## 1. Cómo funciona el canal

- El navegador llama `secEjecutar(llave, nombre, args, actividad, medir)` → `src/worker/rpc.ts` valida la
  llave de sesión, deja `ctx.sesion = { email }` y llama a `REGISTRO[nombre](ctx, ...args)`.
- `REGISTRO` (`src/worker/modulos/indice.ts`) junta el objeto `funciones` que exporta cada archivo de
  grupo. **Solo lo que pongas en `funciones` de tu archivo se puede llamar desde el navegador.** Las
  funciones internas (las que en Apps Script terminaban en `_` o llevaban `secSoloInterno_`) no se
  registran.
- Lo que devuelve tu función le llega al `withSuccessHandler` de la pantalla. Lo que lances
  (`throw new Error('…')`) le llega al `withFailureHandler` con ese mensaje. Igual que en Apps Script.

## 2. Convenciones obligatorias

1. **Firma**: `export async function nombreOriginal(ctx: Ctx, ...mismosArgumentosQueEnGs)`. Mismo nombre,
   mismos argumentos en el mismo orden. Los ayudantes internos: mismo nombre sin el `_` final
   (`revEstadoDeFolio_` → `revEstadoDeFolio`), sin registrarlos.
2. **Forma de la respuesta = la del `.gs`**, campo por campo (nombres, tipos, `success`/`status`,
   mensajes de error en español tal cual). Antes de portar una función, **busca en las pantallas
   (`grep -n "nombreFuncion" "Carpeta del proyecto"/*.html`) cómo usan su respuesta**: es lo que manda.
   Apps Script no puede devolver `Date`: si el `.gs` devolvía fechas, ya las convertía a texto/número;
   haz lo mismo con el mismo formato.
3. **Puertas de seguridad**: las mismas que el `.gs`, con `src/worker/nucleo/seguridad.ts`
   (`secIdentidad`, `secIdentidadConBloque`, `secIdentidadAvanzada`, `secIdentidadMaestra`,
   `secCorreoEfectivo`). Nunca quites una puerta. Respeta la privacidad de atenciones
   (`atenVersionPublica_`) y todo lo que el `.gs` recorta.
4. **Datos en D1**, nunca en memoria global. Esquema: `migrations/0001_esquema.sql` (léelo: cada columna
   dice qué encabezado de la hoja era). Si te falta una tabla o columna, créala en **tu propia
   migración** (número asignado abajo), con `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN`.
   No edites `0001_esquema.sql` ni migraciones ajenas.
5. **Fechas**: en D1 se guardan como ISO UTC (`ctx.ahoraIso()`, `new Date().toISOString()`). Para
   formatear como lo hacía `Utilities.formatDate(…, 'America/Mexico_City', patrón)` usa
   `formatearFecha(fecha, patrón)` de `nucleo/fechas.ts` (mismo patrón Java). Nunca `getHours()`/`getDate()`
   a pelo: el Worker está en UTC. Hay `partesMx`, `fechaDesdeMx`, `inicioDelDiaMx`, `aFecha`, `aIso`.
6. **Columnas por nombre**: en SQL ya no hay posiciones; usa los nombres de columna del esquema. Lo que
   en la hoja eran Sí/No es 0/1; lo que era JSON en una celda es TEXT con JSON (`jsonSeguro`).
7. **Sin caché de datos**: D1 contesta en milisegundos. No portes la caché de `CacheService`
   (generaciones, trozos, TTL): lee directo. Las invalidaciones (`cotInvalidarCache_`, etc.) se vuelven
   no-ops (o desaparecen). La tabla `cache` (`cacheLeer/cacheGuardar/cacheSumar`) es solo para
   contadores con caducidad (límites por hora, intentos) y marcas temporales.
8. **Concurrencia**: `LockService` → `siguienteContador(ctx, clave)` (atómico) o `ctx.lote([...])`
   (varias sentencias en una transacción). Los folios `LVP-AAMMDD-XXXX` salen de `siguienteContador`.
9. **Servicios de Google que no existen aquí** (decisión del usuario: «lo que tenga que venir de Google,
   déjalo en blanco»):
   - **Gmail/MailApp** → `enviarCorreo(ctx, {...})` de `nucleo/correo.ts`: guarda el correo completo en
     `correos_salida` y contesta como enviado. Las métricas y estatus se escriben igual que si hubiera
     salido. Cuota: `CUOTA_CORREO_DIARIA`.
   - **Drive** (PDF, carpetas, hojas CCL, `openQuoteInSheets`, `previewSheetCcl`…) → la función responde
     con la MISMA forma que en un fallo controlado del `.gs` (p. ej. `{success:false, message:'…'}`) con
     un mensaje claro: «Esta versión de demostración no genera archivos en Google Drive.» Nada debe
     lanzar excepciones raras ni dejar la pantalla colgada.
   - **Imágenes subidas** (anuncios, artículos, evidencias) → sí funcionan: `guardarArchivo(ctx, {...})`
     de `nucleo/archivos.ts` (R2), devuelve una URL `/archivos/…` del mismo dominio.
   - **Calendar** → lista vacía. **Webhooks de Chat** → no-op (registra en consola).
   - **UrlFetchApp a liverpool.com.mx** → `fetch` con `AbortSignal.timeout(8000)`; si falla o Liverpool
     bloquea (muy probable desde Cloudflare), degrada exactamente como el `.gs` cuando falla (puntos
     «pendientes», etc.). No inventes datos.
   - **PropertiesService** → `leerPropiedad/fijarPropiedad/borrarPropiedad/propiedadesConPrefijo/
     leerPropiedadJson` (`nucleo/sistema.ts`). `secConfig(ctx, clave, respaldo)` para configuración.
   - **Bitácora de la consola** → `apuntarBitacora(ctx, quien, accion, objetivo, detalle)`.
10. **Escrituras**: actualiza solo las columnas que el `.gs` escribía (regla 5 del doc 00). El detalle
    de una cotización se borra y se reescribe al reguardar (igual que la hoja).
11. **Ids**: `nuevoId(prefijo)` (`nucleo/util.ts`) da ids estilo `htl-msk…`, como `pcNuevoId_`.
12. **Estilo**: TypeScript, comentarios en español con el mismo tono del proyecto, explicando el porqué
    cuando no es obvio. Cuando algo cambia respecto al `.gs` por ser D1/Cloudflare, dilo en un comentario
    de una línea.

## 3. Archivos: quién es dueño de qué

Cada agente edita SOLO sus archivos. Si necesitas algo de otro módulo, impórtalo de su archivo si ya
existe; si no existe todavía, haz una versión local mínima en tu archivo y dilo en tu informe. Nunca
edites archivos de otro agente, `src/worker/nucleo/*`, `rpc.ts`, `index.ts` ni `indice.ts`. Si crees que
el núcleo tiene un error, dilo en tu informe con el arreglo propuesto.

| Agente | Archivos que son suyos | Migración | Puerto local |
| --- | --- | --- | --- |
| identidad | `modulos/identidad.ts` (+ `modulos/identidad/*`) | `0002_identidad.sql` | 8801 |
| cotizaciones | `modulos/cotizaciones.ts` (+ `modulos/cotizaciones/*`) | `0003_cotizaciones.sql` | 8802 |
| revisión | `modulos/revision.ts` (+ `modulos/revision/*`) | `0004_revision.sql` | 8803 |
| portal | `modulos/portal.ts` (+ `modulos/portal/*`) | `0005_portal.sql` | 8804 |
| operación | `modulos/operacion.ts` (+ `modulos/operacion/*`) | `0006_operacion.sql` | 8805 |
| consola | `modulos/consola.ts` (+ `modulos/consola/*`) | `0007_consola.sql` | 8806 |
| react | `modulos/nuevas.ts`, `src/react/*`, `vite.config.*` | `0008_nuevas.sql` | 8807 |
| semilla | `semilla/*` (salvo `portal_ventel.json` y `00_usuarios_demo.sql`), `scripts/sembrar.mjs` | — | 8808 |

Contratos entre módulos que ya existen como esqueleto (el dueño los implementa; los demás los usan):
`revPuedeEnviarse`, `revpolDecidirAlGuardar`, `revpolSellarAprobacionAutomatica`, `audAuditar`
(revisión); `metRegistrarEnvio` (cotizaciones); `monRegistrarBusqueda` (consola);
`emitirValeInicial` (identidad). No cambies su firma.

## 4. Cómo probar

```bash
cd cloudflare
scripts/dev-aislado.sh <tu-nombre> <tu-puerto> &        # Worker local con TU base D1 (migraciones + semillas)
node scripts/rpc.mjs --puerto <tu-puerto> --como asesor@ventel.example <funcion> '<args JSON>'
npx tsc --noEmit                                         # debe quedar sin errores en TUS archivos
```

- Cuentas de prueba (contraseña `VentelDemo2026`): `maestro@ventel.example` (maestro),
  `supervisora@ventel.example` y `supervisor@ventel.example` (supervisores), `asesor@ventel.example` y
  otras `…@ventel.example` (asesores), `paola.jimenez@ventel.example` (dada de baja).
- Si añades una migración: `npx wrangler d1 migrations apply ventel-portal --local --persist-to .wrangler/estado-<tu-nombre>`.
- Para reiniciar tu base: `scripts/dev-aislado.sh <nombre> <puerto> --reiniciar`.
- Wrangler recarga solo al guardar. Si tu servidor muestra un error de compilación en el archivo de OTRO
  agente, espera unos segundos y reintenta: lo está escribiendo.
- Prueba de pantallas en Chromium: `PANTALLAS=dashboard,cotizacion node pruebas/humo.mjs http://127.0.0.1:<puerto>`
  (entra con la UI real de login y lista errores de consola y llamadas fallidas por pantalla).
- Cuando termines, mata tus procesos (`pkill -f "port <tu-puerto>"`).

## 5. Qué entregar

- Todas las funciones de tu grupo que llama el navegador, registradas en `funciones`, sin «El servidor
  no expone la función» en tus pantallas.
- `npx tsc --noEmit` limpio en tus archivos.
- Una prueba tuya en `pruebas/<modulo>.test.mjs` (Node puro, sin frameworks) que levante nada y llame a tu
  servidor local con `fetch` (o reutiliza `scripts/rpc.mjs`) y compruebe las formas de respuesta
  principales y las puertas (un asesor NO puede lo que es de supervisión, sin sesión no hay datos
  privados).
- Informe final breve en español: funciones portadas, qué degradó a «no disponible» y por qué, tablas o
  columnas que añadiste, dependencias con otros módulos y cualquier duda.
- No hagas commit ni push.
