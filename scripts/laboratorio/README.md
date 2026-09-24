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

## Antes de usarlos

- Tienen rutas absolutas a la carpeta temporal de la sesión en que se hicieron (`SCR`, `PROY`). Hay que ajustarlas.
- Necesitan `esbuild@0.28.2` y `acorn@8` (`npm install` en la carpeta donde se corran).
- Para leer resultados desde la página superior, en la consola de Chrome:
  - `performance.getEntriesByType('navigation')[0]`: primer byte y tamaño del documento.
  - Para lo que armó el servidor: decodificar el literal de `goog.script.init("…")` y leer `userHtml`.
- **Nunca** hacer pruebas de concurrencia contra la cuenta dueña de producción en horario de operación. Las 30 ejecuciones simultáneas son de todos los asesores.
