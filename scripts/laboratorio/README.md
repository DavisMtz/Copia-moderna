# Laboratorio de rendimiento de Apps Script

Son los guiones con que se midió todo lo que cuenta `Documentacion/15_Entorno_Apps_Script_Hallazgos_y_Plan.md` (23/09/2026). **No se suben a Apps Script**: viven fuera de `Carpeta del proyecto/`.

## Qué es cada archivo

- `ZZ_Lab.gs` y `ZZ_lab.html`: el laboratorio que se sube a un proyecto aparte (LAB-mini o LAB-grande, ids en el documento 15, §7).
  - Mide la latencia de `google.script.run` en serie y en paralelo.
  - Mide los tamaños que admite cada llamada, en ambos sentidos.
  - Comprueba qué tipos sobreviven el viaje.
  - Revisa el almacenamiento del iframe, la caché de `<script src>` y el historial.
  - Mide el armado de páginas en el servidor.
  - Rutas: ver documento 15, §7.
- `medir.js`: compila con esbuild los parciales reales y compara tamaños (bruto, gzip y brotli), comprobando que nada cambie de significado.
- `medir2.js`: imita la minimización que Google ya hace (sin comentarios ni sangría) y mide cuánto gana esbuild sobre eso.
- `preparar-labs.js`: arma las carpetas `lab-mini` y `lab-grande`. La grande lleva copia del Portal **sin secretos**: anula `HASH_SALT`, `WEBHOOK_URL` y los webhooks de Chat, y renombra `doGet`.
- `variantes.js`: las variantes del proyecto grande (completo, solo `.gs`, `.gs` comprimidos, sin comentarios con las mismas líneas, solo HTML, todo comprimido y la candidata de la Fase 1). Genera también un `.clasp.json` por variante para subirla con `clasp push --force -P var-X.clasp.json`.
- `banco.mjs` (Fase 2): compara dos carpetas del proyecto pantalla por pantalla en Chrome headless. Por ejemplo, la fuente contra `build/`, o el código antes y después de un cambio de cliente.
  - Ensambla cada pantalla como `include()`, con una sesión falsa y un `google.script.run` que siempre falla.
  - Compara excepciones, avisos, llamadas al servidor, texto, estructura y píxeles.
  - Carga dos veces la primera carpeta para medir el ruido: hay barras de progreso que avanzan con el tiempo.
  - Uso: `node scripts/laboratorio/banco.mjs "Carpeta del proyecto" build <carpeta del scratchpad> [Index cotizacion …]`.
  - La salida tiene que ir fuera del repo: si no, se niega.
  - Resultado de la F2 (23/09/2026): las 20 pantallas iguales, con 0 excepciones en ambas carpetas.
  - Desde la F3b apunta cada lote como un solo viaje (`secEjecutarLote:a+b+c`) y guarda en `viajes` la hora de salida de cada uno.
  - **Punto ciego: fuerza el movimiento reducido**, y con él las animaciones de entrada ponen el contenido visible sin animar. Un revelado de GSAP roto NO se ve aquí: para eso están los dos siguientes.
- `revelado-monitor.mjs` y `revelado-portal.mjs` (24/09/2026): el Monitor y el Portal en Chrome headless **sin** movimiento reducido, en dos variantes: con los datos dentro de la página (`__APP__.datos`, F3a) y con los datos llegando por red a los 2 s (como antes de la F3a).
  - El Monitor mide la opacidad de las tarjetas a la vista y de las cifras del día, a 1.5, 3.5 y 7 s y al bajar. El Portal busca textos a la vista con opacidad efectiva < 0.2 mientras baja por la página.
  - Nacieron de la regresión del Monitor del 24/09 (tarjetas invisibles con los datos en la página; ver el §18 del plan 13). Pasarlos después de cualquier cambio que adelante o atrase la llegada de los datos, o que toque un revelado.
  - Uso: `node scripts/laboratorio/revelado-monitor.mjs "Carpeta del proyecto" <scratchpad>/revelado [pagina|red]`. La salida va fuera del repo o se niegan.
- `url-pestanas.mjs` (01/10/2026, F5 del doc 16): lo que `revision_cotizacion` y `cotizado_preview` escriben en la URL, en Chrome headless. Lleva un `google.script.history` con pila de verdad (en `sessionStorage`, para que sobreviva a la recarga) y simula F5 volviendo a pedir la página con los parámetros de la entrada actual, que su servidor inyecta como `doGet`. Comprueba lo que escribe cada gesto, F5 y direcciones raras; sale con código 1 si algo falla. Le pregunta el modo a la página (`AppUrl.APILA_HISTORIAL`, decisión 8): con el interruptor apagado (hoy) comprueba que todo reemplaza y que la pantalla no tiene entradas propias; encendido, además atrás y adelante dentro de la pantalla.
  - Uso: `node scripts/laboratorio/url-pestanas.mjs "Carpeta del proyecto" <scratchpad>/url`. Desde PowerShell con la ruta larga (desde Git Bash no conectó con Chrome).
  - Ojo: su historial es un modelo y no reproduce el fallo de Google: después de que una pantalla se carga de nuevo (F5, o al volver a ella con atrás), el siguiente atrás la deja en blanco (doc 15 §3.6). Eso se mide en Apps Script de verdad: `ZZ_historial.html`.
- `oscuro.mjs` (04/10/2026): la auditoría del tema oscuro (carbón). Abre las 20 pantallas y las secciones del Portal en Chrome headless con el tema que diga `TEMA`, y mide en cada una el contraste de todo texto visible contra su fondo real (compuesto con los ancestros y sus degradados), las superficies claras grandes y los bordes claros. Saca capturas y `informe.json`.
  - Uso: `node scripts/laboratorio/oscuro.mjs "Carpeta del proyecto" <scratchpad>/oscuro-carbon [vista…]`, con `TEMA=carbon` (por omisión) y otra corrida con `TEMA=aurora`. Desde PowerShell con la ruta larga. La salida va fuera del repo o se niega. Las demás variables (datos de prueba, abrir un modal antes de medir, vistas con parámetros) están en la cabecera.
  - `oscuro-diff.mjs <informe carbón> <informe aurora>`: lo que falla SOLO en oscuro. La barra lateral rosa, por ejemplo, es igual en los tres temas y no cuenta.
  - `oscuro-datos.mjs "Carpeta del proyecto" <salida>`: datos de prueba (`mocks.js` para `MOCKS` y `datos-pagina.json` para `DATOS_PAGINA`): cotizaciones de Inicio y Supervisión, la cola de revisión, Atenciones, el Monitor y una revisión cuya auditoría sale del motor REAL (`Revision.gs` + `AuditoriaCotizacion.gs` en un `vm`).
  - `oscuro-estatico.js "Carpeta del proyecto"`: barrido sin navegador de reglas CSS y estilos en línea con fondos claros o tinta oscura FIJOS (no tokens) y sin ajuste para carbón. Lo que pinta un documento o un correo sale a propósito.
  - Lo que se ve sin datos no es todo: los estados con datos, los modales y los paneles se miden con `MOCKS` y `ANTES` (por ejemplo `ANTES="AppSupport.open(); 1"`).
- `ZZ_historial.html` (01/10/2026): la página con que se midió ese fallo en LAB-mini. Apila dos entradas solas al abrir (`paso=1#uno`, `paso=2#dos`) y le cuenta a la ventana de arriba, por `postMessage`, cada aviso de `setChangeHandler`, lo que dice `getLocation` y un latido por segundo. Si deja de latir, el marco está congelado.
  - Se sirve con una ruta en el `doGet` del laboratorio: `if (exp === 'historial') return HtmlService.createHtmlOutputFromFile('ZZ_historial');`. Con `?reparar=reemplazar` usa `replace` en vez de `push`; con `?reparar=sync|micro|push`, prueba a reescribir la dirección dentro del aviso.
  - En la ventana de arriba (consola de Chrome): `window.__lab = []; addEventListener('message', (e) => { if (e.data && e.data.lab === 'f5-historial') __lab.push(e.data); });`. Volver a ponerlo después de cada recarga.
  - **La ventana del navegador tiene que estar visible** (`document.visibilityState`): oculta, el blanco no se pinta y los latidos se frenan.

## Antes de usarlos

- Tienen rutas absolutas a la carpeta temporal de la sesión en que se hicieron (`SCR`, `PROY`). Hay que ajustarlas.
- Necesitan `esbuild@0.28.2` y `acorn@8` (`npm install` en la carpeta donde se corran).
- Para leer resultados desde la página superior, en la consola de Chrome:
  - `performance.getEntriesByType('navigation')[0]`: primer byte y tamaño del documento.
  - Para lo que armó el servidor: decodificar el literal de `goog.script.init("…")` y leer `userHtml`.
- **Nunca** hacer pruebas de concurrencia contra la cuenta dueña de producción en horario de operación. Las 30 ejecuciones simultáneas son de todos los asesores.
