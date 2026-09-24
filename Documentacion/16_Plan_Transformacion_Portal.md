# 16 · Plan de transformación del Portal: guía de ejecución

> **Frase de arranque del creador:** «inicia con la transformación del portal ventel».
>
> **REGLA DE ORO: TODO VA PRIMERO A PRUEBAS.**
> - Producción solo con la palabra explícita del creador, fase por fase y después de que él lo haya probado.
> - Pruebas: proyecto `1kTyqcGn…`, lo que sirve su `/dev`.
> - Producción: proyecto `1m1pwHz…`, deployment `AKfycbwGYZs3…`.
>
> **El porqué de cada fase y las cifras medidas están en el doc 15** (`15_Entorno_Apps_Script_Hallazgos_y_Plan.md`). Este documento dice **qué hacer, en qué orden y cómo comprobarlo**.

---

## 0. Al recibir la frase: arranque

1. **Leer la memoria**, en este orden:
   - `transformacion-portal-ventel`
   - `apps-script-entorno-hallazgos`
   - `sesiones-llave-portal`
   - `produccion-y-pruebas-portal`
   - `clasp-appsscript-portal`
   - `autopush-carpeta-proyecto`
   - `registrar-al-terminar-tarea`
2. **Leer §2 (estado) y §3 (fases)** de este documento. El doc 15 solo cuando haga falta el porqué.
3. **Verificar el estado REAL; el documento puede estar atrasado:**
   - `git -C "C:\Users\seguimientos\Desktop\Proyectos\Portal Ventel" log --oneline -8` y `git ls-remote origin refs/heads/main`.
   - Versión que sirve producción: `clasp deployments -P <config de producción>`. La configuración va en el scratchpad (§4).
   - `node pruebas/<cada>.test.js` y `node scripts/sintaxis.js`: todo en verde antes de tocar nada.
4. **Preguntar al creador SOLO lo que bloquee** (§2, «Decisiones pendientes»). Si nada bloquea, seguir con la primera fase pendiente **en pruebas**.
5. **Al cerrar cada tarea:**
   - entrada en el §18 del plan 13 (qué se cambió, qué se comprobó, qué se dejó fuera);
   - actualizar la tabla del §2 de este documento;
   - actualizar la memoria.

---

## 1. Reglas de trabajo (costaron incidentes; no son opcionales)

1. **El hook sube solo** al terminar cada turno: `git push` a `main` y `clasp push` a **pruebas**, desde `build/` (F1). Puede dispararse a mitad de una tarea.
   - Los cambios grandes se hacen en una **copia de trabajo en el scratchpad**: `cp -r` de `Carpeta del proyecto`, `pruebas`, `scripts`, `package.json` y `node_modules`, quitando `.clasp.json` de la copia.
   - Se prueban ahí y se copian al repo **todos juntos** cuando las suites estén en verde.
2. **Producción** (solo con su palabra): receta en §4.
   - Tras `clasp deploy`, `/exec` puede servir una versión vieja **~1 min**: verificar con `&cb=N`.
   - **Tope de 200 versiones por proyecto**: cada deploy gasta una.
   - El clasificador de permisos a veces bloquea el deploy a producción: no rodearlo, pedir autorización.
3. **Funciones de servidor nuevas:**
   - El navegador las llama por `AppRun` → `secEjecutar` (Sesiones.gs). Toda función pública nueva queda accesible por ese canal.
   - Si es de editor, de diagnóstico o solo la usa el servidor: `secSoloInterno_('nombre')` como **primera línea**, y el nombre en `SES_NO_EXPUESTAS`. `pruebas/sesiones.test.js` falla si falta.
   - Nunca devolver un `Date` al navegador: la respuesta llega `null`, sin error.
4. **HTML:**
   - Nunca meter parciales dentro de una plantilla sin quitar antes sus comentarios: los `<? ?>` dentro de comentarios se EJECUTAN.
   - Nunca `//` ni `/*` dentro de plantillas de texto `` `…` ``: el quitacomentarios de Google las rompe.
   - `include()` sigue siendo la forma segura de armar páginas.
5. **Verificación:**
   - La herramienta de navegador ve el Portal **en blanco** (animaciones congeladas en su pestaña): lo visual lo confirma el creador.
   - Medir con `performance` desde la página superior (§4). No se puede entrar con su cuenta: los recorridos con sesión los prueba él.
6. **Capacidad:** pruebas y producción corren como la **misma cuenta dueña**. Una prueba de concurrencia en pruebas gasta el cupo de 30 ejecuciones simultáneas de producción: **solo fuera de horario y con su permiso**.
7. **Datos:** pruebas y producción escriben en **la misma hoja**. Nada de pruebas que escriban basura masiva.

---

## 2. Estado (actualizar al cerrar cada tarea)

| Fase | Qué | Estado | Dónde / commit |
|---|---|---|---|
| F0 | Llave de sesión (2 h de inactividad), 52 candados, V-03, viewport | **En pruebas.** Falta que el creador lo pruebe y dé su palabra para producción | pruebas HEAD · `11e77a8` |
| F1 | Build del servidor: `.gs` sin comentarios, mismas líneas | **En pruebas** (hook, workflow y `publicar.sh` suben desde `build/`). Medido: `doGet` del Portal 2.75 → 2.26 s (−0.49 s). Falta su palabra para producción | `2e62a6d` · `7bdc533` |
| F2 | Build del cliente: parciales compilados | **En pruebas.** Peso servido −26 % (Portal −16 %). Banco local: las 20 pantallas se comportan igual que con la fuente. Google sirve los 40 bloques compilados byte a byte. Falta su vistazo, pantalla por pantalla, y su palabra para producción | `d25bb8d` |
| F3 | Menos llamadas por pantalla y datos iniciales en la página | Pendiente | — |
| F4 | Capacidad: cupo de 30 ejecuciones | Pendiente (requiere ventana fuera de horario) | — |
| F5 | Navegación: pendiente #1 en la URL; SPA solo si las cifras lo justifican | Pendiente | — |
| F6 | Calidad: checkJs y pruebas en CI | Pendiente (opcional) | — |
| F7 | Publicar sin PC (`CLASPRC_JSON`) | Pendiente (decisión del creador) | — |

**Producción hoy:** @130 (PromosAuto, commit `23144aa`). No tiene F0, F1 ni F2.

**Ojo al promover:** lo que se sube es `build/`, hecho con el código actual y el `build.js` actual: hoy lleva **F0 + F1 + F2** juntas. Para subir menos:
- **F0 + F1, sin F2:** `git worktree add <scratchpad>/f1 012254b` (el último commit antes de la F2), una unión a `node_modules` dentro (`cmd /c mklink /J`) y `node scripts/build.js` en esa copia: su `build.js` es el de la F1. Se sube su `build/`.
- **F1 sin F0 (ni F2):** `git worktree add <scratchpad>/sin-f0 23144aa` y, desde la copia de `012254b`, `node scripts/build.js --fuente <scratchpad>/sin-f0/"Carpeta del proyecto" --salida <scratchpad>/build-sin-f0 --sin-clasp`. Luego se sube esa carpeta con la configuración de producción.
- **F0 sin F1:** subir `Carpeta del proyecto` de `11e77a8` tal cual. Funciona igual, solo que más lento.
- La F2 no va sin la F1: su build incluye la limpieza de los `.gs`.
- Al terminar, `git worktree remove` de cada copia.

**Decisiones pendientes del creador** (preguntar solo cuando toquen):
1. ¿F0 a producción? Antes, avisar a los asesores: **todos inician sesión una vez**.
2. ¿Tope absoluto de sesión (p. ej. 12 h) además de las 2 h de inactividad? Acota el daño de una llave robada.
3. Ventana fuera de horario para la prueba de capacidad (F4).
4. ¿`CLASPRC_JSON` en GitHub (F7)? Es la llave de la cuenta corporativa en un repo personal.

---

## 3. Fases, en orden

### F0 · Cerrar la seguridad (código hecho, en pruebas)

- **Su prueba en pruebas:**
  1. Entrar con su cuenta.
  2. Usar cotizar, consultar y buscar.
  3. Para ver el vencimiento rápido: `SESION_INACTIVIDAD_MIN = 3` en las propiedades del proyecto de **pruebas**, volver a entrar y esperar a que se tape la pantalla.
  4. Borrar la propiedad.
- **Promoción** (con su palabra): receta de §4.
  - Si ya hay trabajo de F1 o posterior en el repo y solo se quiere F0: `git worktree add <scratchpad>/f0 11e77a8` y promover desde esa carpeta.
- **Después del deploy:**
  - Verificar con `&cb=N` pasado 1 min.
  - **A la mañana siguiente**, revisar en «Ejecuciones» que el activador `promosAutoDisparador` corrió sin error (ya marca `SEC_ENTRADA_='activador'`).
  - Revisar que no haya un aluvión de `SESION_EXPIRADA`.
- **Emergencia:** propiedad `AUTH_SESIONES = no` en producción. Vuelve al comportamiento anterior sin desplegar.
- **Podar versiones** sin deployment desde el historial del proyecto, dejando las de rollback recientes.

### F1 · Build del servidor (la mayor ganancia medida)

> **Hecha en pruebas el 23/09/2026** (`2e62a6d`, `7bdc533`; detalle en el §18 del plan 13). Tres diferencias con lo planeado:
> - La sangría **no** se quita dentro de cadenas y plantillas multilínea. Además, el build compara el árbol sintáctico completo con el del fuente: más estricto que «mismos globales».
> - Un fallo del build borra `build/`, así que no queda nada a medias que se pueda subir.
> - La medición fue del `doGet` y no de las llamadas: la pestaña de la herramienta estaba oculta y el Portal no llama mientras no se ve. Se alternó fuente y build en tres parejas (§4).

- **Objetivo:** subir los `.gs` sin comentarios y **con las mismas líneas**, para que los errores sigan apuntando a la línea del fuente. Medido: ~0.3-0.8 s menos por llamada y por pantalla (doc 15 §3.2, interpolado).
- **Pasos:**
  1. **`package.json`** en la raíz del repo, con devDependencies `esbuild@0.28.2` y `acorn@^8`. Correr `npm install` con el npm portable de `C:\Users\seguimientos\.local\node`. Añadir `node_modules/` y `build/` al `.gitignore`.
  2. **`scripts/build.js`:**
     - Borra y recrea `build/`, hermana de `Carpeta del proyecto` y **nunca dentro**.
     - Copia tal cual `appsscript.json`, `.claspignore` y los `.html` (F2 los compilará).
     - Por cada `.gs`, quita los comentarios con `acorn` (`onComment`) conservando los saltos de línea y quita la sangría. Referencia: `scripts/laboratorio/variantes.js`, `sinComentariosMismasLineas`.
     - **Comprobaciones por archivo:** compila (`new Function`), mismo número de líneas, mismos nombres globales (acorn), y las marcas que busca `verificarVersionDelCodigo` (Admin.gs) siguen presentes.
     - Escribe `build/.clasp.json` con el `scriptId` de `Carpeta del proyecto/.clasp.json` (pruebas) y `rootDir: "."`.
     - Sale con código ≠ 0 si algo falla.
  3. **`pruebas/build.test.js`:** corre el build a una carpeta temporal y comprueba esas invariantes.
  4. **Hook** (`C:\Users\seguimientos\.claude\hooks\auto-push-proyecto.ps1`, fuera del repo). En la sección de Apps Script: `node scripts/build.js` antes de clasp. Si falla, **no sube** y avisa en el `systemMessage`. Si pasa, `clasp push --force` **desde `build/`**. El stdout del hook debe seguir siendo JSON puro.
  5. **Workflow** `apps-script-sync.yml`: `npm ci`, luego `node scripts/build.js`, y `working-directory: build`.
  6. El cambio de destino (hook + workflow + `.gitignore`) va en **un solo commit**.
- **Medir en pruebas, antes y después:** misma pantalla (Portal), 5 cargas cada vez, duración de las llamadas y primer byte (§4).
  - **Criterio:** mediana ≥ 0.3 s menos. Si no mejora, revertir.
- **Reversión:** devolver el hook a su versión anterior (guardar copia) y `git revert` del commit.

### F2 · Build del cliente (menos peso y menos trabajo del navegador)

> **Hecha en pruebas el 23/09/2026** (`d25bb8d`; detalle en el §18 del plan 13). Diferencias con lo planeado:
> - El JS va **sin `minifySyntax`**. Esa opción convertía cadenas con `\n` en plantillas `…` con el salto de línea dentro (2 casos hoy), justo lo que el quitacomentarios de Google estropea. Sin ella, el JS baja un 58 % en vez de un 59 %.
> - El marcado de los parciales **no** se toca, salvo sus comentarios: Google ya le quita la sangría al servir. Tocarlo solo añadía riesgo (`<pre>`, `<textarea>`, `white-space: pre`).
> - Comprobaciones añadidas:
>   - cada bloque es el mismo programa que la fuente, salvo nombres locales (`arbolNormalizado`);
>   - los globales conservan su tipo (`var`, `let`, `function`…);
>   - esbuild elige comillas y, con una cadena que lleva `'` y `"`, puede escribir una plantilla `…` con `//` dentro: el build la reescribe como cadena normal (`plantillasSeguras`).
> - Verificación:
>   - banco local en Chrome headless (`scripts/laboratorio/banco.mjs`): las 20 pantallas, fuente contra build;
>   - en pruebas: las 20 pantallas servidas y su JS leído tal como lo deja Google;
>   - huellas SHA-256: los 40 bloques compilados llegan byte a byte.

- **En `scripts/build.js`:**
  - **Parciales** (`app_*.html`, `*Partial.html`): los bloques `<script>` y `<style>` se compilan con esbuild (`minify`, `charset:'utf8'`, `target:'chrome109'`, `legalComments:'none'`) y el marcado queda sin comentarios ni sangría. Se escriben **como archivos separados**; `include()` los sigue pegando.
  - **Páginas** (plantillas): solo se quitan los comentarios HTML de nivel de marcado. Así además dejan de ejecutarse scriptlets escondidos en ellos.
  - Referencia: `scripts/laboratorio/medir.js` y `medir2.js` (`trocear`, `completo`).
- **Comprobaciones:**
  - sintaxis de cada bloque;
  - mismos globales;
  - ningún `</script` en el JS;
  - **ningún `//` ni `/*` dentro de plantillas de texto** de la salida.
- **Verificación en pruebas:** cargar las 20 pantallas y comprobar que responden (llamadas con datos). El «HTML mal formado» solo lo detecta Google al servir.
  - **Visual: lo confirma el creador** pantalla por pantalla.
- **Ganancia esperada:** 19-27 % menos peso por pantalla (doc 15 §3.1). Poca espera, porque la red no es el cuello.

### F3 · Menos llamadas y datos iniciales en la página (lo que más notará el asesor)

- **Instrumentar `AppRun`:**
  - Duración por función, en un anillo en localStorage y en `AppRun.medidas()`.
  - Opcional: un lote agregado cada 30 min a una hoja oculta «Latencias» (n, p50, p90 por función), con la Drive MCP para leerla.
- **Auditar las llamadas del Portal al abrir** (hoy 5-8, y los datos terminan a los ~13 s):
  - fusionar las públicas en una sola `portalInicio()`;
  - servir los datos cacheables **dentro de la página** desde el `doGet`, leyéndolos de CacheService, con el mismo patrón que `APP_JSON`. Cada viaje evitado ahorra ~1.9 s;
  - averiguar por qué las llamadas arrancan ~1 s después de `load`.
- Repetir en las 3 pantallas más usadas: cotización, consulta y dashboard.
- **Criterio:** datos completos del Portal en ≤ 7 s (hoy ≈13 s), medido desde la página superior.

### F4 · Capacidad (el cupo de 30)

- **Medir picos:**
  - contador aproximado de ejecuciones en curso en `secEjecutar` (CacheService, inicio/fin) con el máximo por ventana de 5 min;
  - el panel «Ejecuciones».
  - Buscar «too many scripts running simultaneously».
- **Prueba de saturación** (35-40 llamadas simultáneas): **solo fuera de horario y con su permiso**; afecta a producción (misma cuenta).
- **Mitigación:** la F3 (menos llamadas), llamadas más cortas y caché.

### F5 · Navegación

- **Pendiente #1:** que las pestañas de `revision_cotizacion` y `cotizado_preview` queden en la URL.
  - Usar `google.script.history` (verificado: sobrevive a F5), conservando siempre `page`.
  - Probar Atrás después de F5 (fallo conocido de Google, issue 207785211).
- **SPA** (cambiar de pantalla sin recargar): solo para el recorrido más usado y **después** de ver las cifras de F1-F3.
  - Condición dura: `?page=`, `?next=`, los enlaces compartidos y el `/exec` fijo de la extensión siguen funcionando.

### F6 · Calidad (opcional)

- Comprobación de tipos con `tsc --checkJs` sobre el JS actual, con JSDoc, sin reescribir.
- Job de GitHub que corra `pruebas/*.test.js`: no necesita credenciales.

### F7 · Publicar sin depender de una PC

- Solo si el creador acepta subir `CLASPRC_JSON`. Entonces el workflow compila (F1/F2) y publica **en pruebas**.

---

## 4. Recetas

**Subir a pruebas.** Lo hace el hook al terminar el turno: compila y sube desde `build/`. Si el build falla, no sube y lo dice; el registro queda en `%TEMP%\auto-push-build.txt`. A mano: `node scripts/build.js` en la raíz del repo y `clasp push --force` desde `build/` (o `./scripts/publicar.sh`, que hace las dos cosas).
- Si falta `node_modules`: `npm ci` en la raíz del repo (con el sandbox desactivado: necesita red).
- Nunca editar `build/` a mano: el siguiente build la borra entera.

**Promover a producción** (solo con su palabra; leer antes el «Ojo al promover» del §2):
1. `node scripts/build.js`. Crear la configuración FUERA del repo, en el scratchpad:
   ```json
   {"scriptId":"1m1pwHzRuIWpUOlSzw7cwrdmbA06_lPEHgkmGpiFdDA6XpO6Y-2jyZCHz","rootDir":"<ruta ABSOLUTA a build/>"}
   ```
2. Subir: `clasp push --force -P <config> -I <ruta a build/.claspignore>`.
3. Verificar 1:1: `clasp pull` a una carpeta temporal y comparar contenido con `build/` (los `.gs` bajan como `.js`).
4. Desplegar: `clasp deploy -P <config> -i AKfycbwGYZs3C-dsZbIWVn27uEaLm_rXQGhiQc9Q54btPxPb-Z1SX0Enx7NlPqKw4STizaOU -d "<qué lleva>"`.
5. Esperar ~1 min y abrir `/exec?page=portal&cb=N`.
6. Anotar la versión en el §18 y en la memoria `produccion-y-pruebas-portal`.

**Rollback:** `clasp deploy -P <config> -i AKfycbwGYZs3… -V <versión anterior> -d "rollback"`.

**Medir una pantalla** (Chrome con la sesión del creador, en la página superior):
```js
const n = performance.getEntriesByType('navigation')[0];
const cb = performance.getEntriesByType('resource').filter(r => r.name.includes('/callback'));
({ ttfb_ms: Math.round(n.responseStart - n.requestStart),
   llamadas_ms: cb.map(r => Math.round(r.duration)),
   fin_ms: Math.max(0, ...cb.map(r => Math.round(r.responseEnd))) })
```
- Repetir 5 veces con `&cb=N` distinto y comparar medianas.
- **Si la pestaña está oculta** (`document.visibilityState === 'hidden'`, lo normal con la herramienta), el Portal no hace sus llamadas. Entonces se mide el `doGet`, que paga la misma carga del código, pidiéndolo desde la página superior:
  ```js
  const base = location.origin + location.pathname, out = [];
  for (let i = 0; i < 11; i++) { const t0 = performance.now();
    const r = await fetch(base + '?page=portal&cb=' + Date.now(), { credentials: 'include', cache: 'no-store' });
    const t1 = performance.now(); const txt = await r.text();
    const m = txt.match(/goog\.script\.init\("((?:[^"\\]|\\.)*)"/);
    const u = m ? JSON.parse(new Function('return "' + m[1] + '"')()).userHtml : '';
    out.push(Math.round(t1 - t0) + (u.length > 300000 ? '' : '!')); }   // '!' = no llegó el Portal
  JSON.stringify(out)
  ```
  - El centinela anterior (`txt.length > 1000000`) medía el sobre entero. Con la F2 el sobre del Portal bajó a 1.07 MB; con la F3 bajaría de 1 MB y todas las muestras saldrían con `!`. Por eso ahora se lee `userHtml` (Portal con F2: 796 KB).
  - La tanda puede quedarse corriendo: se lanza sin `await` guardando las muestras en `window`, y se consultan en otra llamada.
- **Comparar alternando** (A = antes, B = después: A, B, A, B, A, B) y descartar la primera muestra de cada tanda. Google varía con la hora: en la F1, dos tandas seguidas de A dieron 2.65 y 3.11 s. Con una sola tanda por lado, esa deriva se habría leído como efecto del cambio.
- No lanzar la subida y la tanda en la misma respuesta: corren a la vez, y las primeras muestras caen sobre el código anterior.
- Para leer lo que armó el servidor: decodificar el literal de `goog.script.init("…")` y leer `userHtml` (doc 15 §7).

**Comprobar lo que sirve Google** (cada vez que cambie el build o el cliente). Desde la página superior de `/dev`, con `fetch` **en serie** de las 20 claves de `PAGES` y `PORTAL_PAGES`:
- que ninguna respuesta diga «formato incorrecto» y todas traigan `goog.script.init`;
- el peso de cada `userHtml`, antes y después;
- que cada `<script>` clásico de `userHtml` pase `new Function(bloque)`: es el código tal como lo dejó el quitacomentarios de Google, y el único lugar donde se ve si lo rompió;
- huellas: SHA-256 de cada bloque compilado de `build/` en local y de cada bloque servido con `crypto.subtle.digest`. Si coinciden, Google los sirve byte a byte y lo probado en el banco local es lo que llega (F2: 40 de 40).

**Banco local** (`scripts/laboratorio/banco.mjs`): ensambla las 20 pantallas como `include()` con dos carpetas (p. ej. la fuente y `build/`) y las abre en Chrome headless con una sesión falsa y un `google.script.run` que responde siempre con fallo. Compara excepciones, avisos, llamadas al servidor, texto, estructura y píxeles, y mide el ruido cargando dos veces la primera carpeta. La salida (capturas, perfil) va a una carpeta del scratchpad, nunca al repo. Cubre la carga y los estados de error; los datos reales y los clics los ve el creador.

**Laboratorio:** `scripts/laboratorio/` y los proyectos LAB-mini y LAB-grande (ids en el doc 15 §7). Sus rutas apuntan a un scratchpad viejo y hay que ajustarlas.

---

## 5. Cifras de partida (para saber si una fase sirvió)

| Medida (Portal) | Hoy | Fuente |
|---|---|---|
| Primer byte, producción | 3.2-4.0 s | doc 15 §2 |
| Datos completos, producción | ≈13 s | doc 15 §2 |
| Llamada vacía con el código completo | ~1.9-2.0 s (n = 21) | doc 15 §3.2 |
| Llamada vacía en un proyecto vacío (piso de Google) | ~0.8 s (n = 14) | doc 15 §3.2 |
| Armado de la página en el servidor | 229 ms | doc 15 §3.2 |
