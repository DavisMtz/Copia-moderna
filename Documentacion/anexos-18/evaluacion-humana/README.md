# Evaluación humana de «Vende más» (fase B del documento 18)

**Qué es.** La comprobación de que lo que recomienda la tarjeta es algo que un asesor ofrecería en la llamada. Compara la extensión 2.9 con la 3.0 **en las mismas fichas y a ciegas**: quien califica no sabe de qué versión es cada recomendación.

**Estado (04/10/2026): el instrumento está listo y probado; la evaluación NO se ha hecho.** La tienen que calificar 2 o 3 asesores. Hasta entonces, lo que se sabe de la 3.0 son las cifras del laboratorio (calificación, opiniones, marketplace), que son indicios, no la opinión de quien vende.

**Qué no es.** No mide ventas ni clics: eso lo empieza a contar la medición local de la propia extensión (fase A). Tampoco evalúa a los asesores: se evalúa a la tarjeta.

## Qué hay aquí

| Archivo | Qué es | ¿Se comparte con quien califica? |
|---|---|---|
| `hoja-evaluacion.csv` | Lo que se califica: 209 renglones, uno por cada pareja artículo → recomendación. | **Sí** |
| `clave.csv` | De qué versión es cada renglón y en qué lugar de la tarjeta salía. | **No** |
| `datos-evaluacion.jsonl` | Lo que midió el laboratorio: qué recomienda cada versión en 74 fichas reales. | No hace falta |
| `armar-hoja.cjs` | Vuelve a armar la hoja y la clave a partir de los datos (siempre salen iguales). | — |
| `calcular.cjs` | Saca el resultado de las hojas ya contestadas. | — |

Las pruebas del instrumento están en `pruebas/ext_evaluacion.test.js` (57 comprobaciones).

## Qué se califica

- **Las 50 fichas del §9 del documento 18** (cafetera, minisplit, cuna, traje…): 153 renglones. La 2.9 muestra 136 recomendaciones y la 3.0, 135; 118 son las mismas. **Las dos versiones difieren en 15 de las 50 fichas.**
- **24 fichas de las doce categorías nuevas** (muñecas, drones, guitarras, lámparas…): 56 renglones. La 2.9 no reconocía estas fichas (en 23 no mostraba nada); la 3.0 muestra 54 recomendaciones.

Si las dos versiones recomiendan lo mismo, se califica una sola vez y cuenta para las dos.

## Cómo se hace

Unos 40 minutos por persona.

1. **Sube `hoja-evaluacion.csv` a Google Sheets** (Archivo → Importar) y haz **una copia por evaluador**. Que no vean las respuestas de los demás: el acuerdo entre ellos es parte del resultado.
2. **Cada evaluador llena la columna «¿La ofrecerías en esta llamada?»** con `sí` o `no`. Las instrucciones para darle están abajo.
3. **Descarga cada copia como CSV** (Archivo → Descargar → Valores separados por comas) y guárdalas aquí como `evaluador-1.csv`, `evaluador-2.csv`…
4. **Calcula:**

   ```
   node calcular.cjs evaluador-1.csv evaluador-2.csv evaluador-3.csv
   ```

   También vale una sola hoja con una columna por persona (`Evaluador 1`, `Evaluador 2`…). Con `--json` sale lo mismo como datos.

No hace falta el nombre de nadie: basta «evaluador 1». La hoja no lleva datos de clientes.

### Instrucciones para quien califica (para copiar tal cual)

> Imagina que un cliente te llama por el artículo de la columna **«El cliente está viendo»**. Cada renglón trae un artículo que la tarjeta «Vende más» podría recomendarte.
>
> Escribe **sí** si se lo ofrecerías en esa llamada, y **no** si no: porque no le queda, no tiene que ver, se ve de mala calidad o simplemente no lo dirías.
>
> - Usa los enlaces si necesitas ver el artículo.
> - No lo pienses de más: es tu primera impresión como asesor.
> - No hay respuestas correctas ni se evalúa a nadie. Se evalúa a la tarjeta.
> - No lo comentes con los otros evaluadores hasta que todos terminen.
> - Si algo te llama la atención, anótalo en «Comentario».

## Cómo se lee el resultado

- **Precisión:** de lo que la tarjeta mostró, qué parte ofrecería el asesor. Con varios evaluadores, cada renglón vale la proporción de «sí».
- **Útiles por ficha (de 3):** cuántas recomendaciones ofrecibles deja la tarjeta en cada ficha. Aquí una ficha sin recomendaciones cuenta como cero; en la precisión no cuenta.
- **Diferencia (3.0 − 2.9):** ficha por ficha, con un intervalo de 95 % (remuestreo de fichas) y una prueba de signos. El informe solo dice «sale mejor» o «sale peor» **cuando coinciden las dos pruebas**; si solo una lo dice, escribe «apunta a».
- **Acuerdo entre evaluadores:** qué tanto coinciden más allá del azar.
  - **κ** (de Cohen con dos evaluadores, de Fleiss con más) es la medida de siempre, pero se hunde cuando casi todo es «sí».
  - **AC1** (de Gwet) no tiene ese problema. Por eso se dan las dos.
  - Lectura de κ (McHugh, la referencia del documento 18): menos de 0.40 es un acuerdo mínimo. En ese caso las cifras dependen de quién califique: conviene repasar el criterio juntos y repetir.
- **«Lo que ningún evaluador ofrecería»:** la lista de trabajo. Cada renglón es una regla por revisar, y dice qué versión lo recomienda.

## Límites

- **Son pocas fichas.** Sirven de calibración. Para medir el acuerdo con un error de ±0.10 hacen falta 150 a 200 fichas (documento 18, §9).
- **La comparación tiene poca fuerza:** las versiones solo difieren en 15 de las 50 fichas. Sirve para comprobar que la 3.0 no empeora y para cazar errores, más que para medir cuánto mejora.
- **Las 24 fichas de categorías nuevas son los casos fáciles:** se buscaron por el nombre de la categoría («dron», «guitarra eléctrica»).
- **La calificación de Liverpool va a la vista en todos los renglones por igual.** La 3.0 la usa para elegir, así que un evaluador que confíe en las estrellas le dará ventaja. Es deliberado: el cliente también las ve.
- **Los datos son del 04/10/2026.** Precios y existencias cambian, y algún enlace puede dejar de servir.

## De dónde salen los datos

- **Las fichas, los carruseles y las búsquedas** son los que recolectó la investigación del documento 18 en liverpool.com.mx (110 fichas, solo lectura).
- **La 2.9** se reprodujo con sus reglas y su núcleo (commit `6f8ab4c`) sobre esos mismos datos, y **la 3.0** con los de esta carpeta de trabajo: función `L.evaluacion()` de `../implementacion-3.0/lab.js`.
- **La búsqueda** entra con los 24 primeros resultados, que es lo que guarda la extensión. Por eso alguna recomendación «de hoy» no coincide con la tabla del §9, que se armó con 16.
- **Las 50 fichas del §9** se emparejaron por precio y nombre. Una apareció bajo dos consultas (los audífonos Sony): se tomó la primera.
- **La copia al disco se comprobó con una huella** (`djb2`) contra la pestaña del laboratorio: 283 renglones, idénticos.
- **El corpus ya no existe en el navegador:** vivía en IndexedDB y apareció vacío esa misma tarde. Para volver a medir hay que recolectar de nuevo con `../colector-v2.js` (unas 390 lecturas).
