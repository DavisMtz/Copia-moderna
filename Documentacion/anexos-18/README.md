# Anexos del documento 18 — código de LABORATORIO

Esto **no es la extensión** ni se carga en ella. Es lo que se usó el 04/10/2026 para las pruebas del documento 18, guardado para poder repetirlas.

| Archivo | Qué es |
|---|---|
| `colector-v2.js` | Recolector para la pestaña de Liverpool. Lee del stream los 5 carruseles de la ficha y los `records` de la búsqueda, con freno ante bloqueos, y guarda en IndexedDB. |
| `analisis.js` | Punto 2 (`__p2`, `__p2b`, `__p2c`, `__p2d`, `__p2e`) y prototipo del punto 1 (`__ctxConBolsa`, `__recomendarConBolsa`). |
| `validar-ia.js` | Punto 5: clasificación, choques, plantillas contra el buscador y control. |
| `borrador-ia.js` / `borrador-ia-v2.js` | Las 12 clases que redactó un modelo a ciegas, y su versión tras una ronda de corrección con datos reales. **Sin revisión humana**: no copiarlas tal cual a `reglas-venta.js`. |
| `resultados.md` | Todas las cifras medidas, en bruto. |

**Lo que vino después de la investigación** (la extensión 3.0, el mismo día) tiene su carpeta:

| Carpeta | Qué es |
|---|---|
| `implementacion-3.0/` | El laboratorio con que se midió la 3.0 contra la 2.9, sus cifras y las pruebas de que las pruebas muerden. |
| `evaluacion-humana/` | La hoja a ciegas de la fase B, su clave y el guion que calcula el resultado. **Lista, sin hacer.** |

Las doce clases del borrador ya están en `reglas-venta.js` (v4), **revisadas**: la versión buena es la de ahí, no la de `borrador-ia-v2.js`.

## Cómo se corrió

1. **Abrir una pestaña** en `https://www.liverpool.com.mx/robots.txt`. No ejecuta los scripts del sitio; una pestaña de ficha se colgó a la media hora.
2. **Concatenar y evaluar en esa página**, con `(0, eval)(texto)` desde un `<input type=file>`:
   - `product-inspector.js`;
   - `reglas-venta.js`, más `window.VENTEL_REGLAS = VENTEL_REGLAS;`;
   - `recomendador-nucleo.js`;
   - `colector-v2.js`;
   - y, aparte, `analisis.js` y `validar-ia.js`.
3. **Recolectar:** `await __colectarV2([...consultas], { pausa: 3000 })`. Recupera lo guardado con `await __idbGet('inv2')`.
4. **Búsquedas del plan:** `__planesV2()`, y después `__buscarV2(...)`.
   - Con la pestaña oculta, Chrome frena los `setTimeout`. En la investigación se usó un temporizador en un Worker creado desde un Blob.

**No navegues a una URL `gviz … out:csv` de Google Sheets: descarga un archivo.** Léela con `fetch` desde una página de docs.google.com.
