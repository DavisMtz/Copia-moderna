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
- `url-pestanas.mjs` (01/10/2026, F5 del doc 16): lo que `revision_cotizacion` y `cotizado_preview` escriben en la URL, en Chrome headless. Lleva un `google.script.history` con pila de verdad (en `sessionStorage`, para que sobreviva a la recarga) y simula F5 volviendo a pedir la página con los parámetros de la entrada actual, que su servidor inyecta como `doGet`. Comprueba apilar/reemplazar, F5, atrás y adelante, y direcciones raras; sale con código 1 si algo falla.
  - Uso: `node scripts/laboratorio/url-pestanas.mjs "Carpeta del proyecto" <scratchpad>/url`. Desde PowerShell con la ruta larga (desde Git Bash no conectó con Chrome).
  - Ojo: su historial es un modelo. El de Google se mide en el `/dev`: ahí, tras F5, atrás cambia la dirección y la app no se entera (doc 15 §3.6).

## Antes de usarlos

- Tienen rutas absolutas a la carpeta temporal de la sesión en que se hicieron (`SCR`, `PROY`). Hay que ajustarlas.
- Necesitan `esbuild@0.28.2` y `acorn@8` (`npm install` en la carpeta donde se corran).
- Para leer resultados desde la página superior, en la consola de Chrome:
  - `performance.getEntriesByType('navigation')[0]`: primer byte y tamaño del documento.
  - Para lo que armó el servidor: decodificar el literal de `goog.script.init("…")` y leer `userHtml`.
- **Nunca** hacer pruebas de concurrencia contra la cuenta dueña de producción en horario de operación. Las 30 ejecuciones simultáneas son de todos los asesores.
