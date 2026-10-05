# Implementación de la 3.0 — código de LABORATORIO

Lo que se usó el 04/10/2026 para medir la extensión 3.0 (los puntos 1 a 6 del documento 18) contra la 2.9. **No es la extensión ni se carga en ella.** Queda aquí para saber de dónde sale cada cifra y poder repetirla.

**Las cifras están en [`resultados.md`](resultados.md).** Qué significan y qué se decidió con ellas, en el documento 18 («Estado»).

## Qué hay

| Archivo | Qué es |
|---|---|
| `resultados.md` | Todas las cifras medidas, en bruto, y cuándo se midió cada una. |
| `lab.js` | El laboratorio: corre en la pestaña de `liverpool.com.mx/robots.txt` contra el corpus del documento 18. Su cabecera lista las funciones. |
| `armar-banco.cjs` | Junta en un solo archivo las reglas y el núcleo de la 2.9 (de git) y los del árbol de trabajo, más `lab.js`. Ese archivo es el que se sube a la pestaña. |
| `mutaciones.cjs` | Rompe una cosa cada vez en una copia temporal y mira si alguna prueba lo nota. Al final corre la suite contra la 2.9. |
| `clases-2.9-contra-3.0.cjs` | La clase de una lista de nombres en las dos versiones, lado a lado. Para ver qué se mueve al tocar un `noEs`. |
| `nombres-de-prueba.json` | La lista por omisión del anterior: mochilas, maletas y juegos de mesa. |
| `evaluacion-crudo.txt` y `crudo-a-jsonl.cjs` | La primera salida del laboratorio para la evaluación humana, y cómo se pasó a `../evaluacion-humana/datos-evaluacion.jsonl`. |
| `historial/` | Los guiones que hicieron cada cambio a `reglas-venta.js`, con su razón. Se corrieron una vez. |

La prueba de punta a punta (la extensión real en Chrome headless) es de uso general y está en `scripts/laboratorio/extension-e2e.mjs`.

## Cómo se corre

**Sin navegador** (desde la raíz del repo):

```
node Documentacion/anexos-18/implementacion-3.0/mutaciones.cjs
node Documentacion/anexos-18/implementacion-3.0/clases-2.9-contra-3.0.cjs [lista.json]
```

**El laboratorio, en el navegador:**

1. `node Documentacion/anexos-18/implementacion-3.0/armar-banco.cjs` escribe `banco.js` en la carpeta temporal del sistema.
2. Abrir una pestaña en `https://www.liverpool.com.mx/robots.txt`: es del mismo origen que las fichas y no ejecuta los guiones del sitio.
3. Subir `banco.js` con un `<input type=file>` y evaluarlo: `(0, eval)(await archivo.text())`.
4. `await __lab.cargar()` y, por ejemplo, `__lab.sal(__lab.antesDespues())`. La salida de la consola se corta a unos 1,000 caracteres: `__lab.sal` la deja en la página.

## Antes de usarlo

- **El corpus ya no existe.** Vivía en IndexedDB del navegador (`inv2`) y el 04/10/2026 por la tarde apareció vacío. Para volver a medir hay que recolectar de nuevo con `../colector-v2.js`: unas 110 fichas y 280 búsquedas, de solo lectura y con pausa.
- **Lo que se mida, al disco en cuanto salga.** Es lo que salvó los datos de la evaluación humana.
- **La pestaña se descarta sola** si el equipo anda corto de memoria: cambia de identificador y pierde lo cargado. Hay que volver a subir el banco; lo guardado en IndexedDB sigue ahí (mientras exista).
- **Los guiones de `historial/` tienen rutas de la sesión en que se hicieron** (`../wt`). No se vuelven a correr: cada uno comprueba que su cambio no esté ya aplicado y, si lo está, se detiene.
- **Nunca se agrega ni se quita nada de una bolsa** para probar. La bolsa se lee; para probar con artículos se usa una página guardada o la de mentira de la prueba de punta a punta.
