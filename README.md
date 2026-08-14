# Portal Ventel

Repositorio espejo de la carpeta `Desktop\Portal Ventel`. Todo lo que se edita ahí
se publica en `main` de forma automática al terminar cada tarea.

## Qué hay en cada carpeta

| Carpeta | Qué es |
| --- | --- |
| `Carpeta del proyecto/` | El proyecto de Google Apps Script: el portal, las cotizaciones, la consola y todas las vistas. Tiene su propio [README](Carpeta%20del%20proyecto/README.md) con el detalle. |
| `Extencion para chrome/` | La extensión de Chrome que extrae datos de artículos y compras en Liverpool. Incluye `Mi Bolsa_files/`, una captura de la página real que sirve para probar el extractor sin abrir el navegador. |
| `Documentacion/` | Manual técnico de soporte y mantenimiento, numerado del `00` al `11`. Empieza por [`00_README_Inicio.md`](Documentacion/00_README_Inicio.md). |
| `.claude/skills/` | Instrucciones que Claude Code carga cuando hacen falta: las oficiales de GSAP más las reglas de animación de la casa. Tiene su propio [README](.claude/skills/README.md). |

## Publicación automática

No hace falta hacer `commit` ni `push` a mano. Un hook `Stop` de Claude Code
(`~/.claude/hooks/auto-push-proyecto.ps1`, fuera del repo a propósito) hace
`git add -A`, `commit` y `push origin main` en cuanto termina una tarea.

Dos consecuencias que conviene tener presentes:

- **Aquí no hay borradores.** Un cambio a medias en esta carpeta llega a `main`
  igual que uno terminado.
- **Si mueves o renombras la carpeta, el hook deja de encontrarla.** Ya pasó una
  vez. Ahora avisa en lugar de callarse, pero hay que actualizar la variable
  `$repo` dentro del script.

## De `main` a Google Apps Script

La cadena no se detiene en GitHub. Cada push a `main` que toque
`Carpeta del proyecto/` dispara el workflow
[`apps-script-sync.yml`](.github/workflows/apps-script-sync.yml), que hace
`clasp push` contra el `scriptId` de `Carpeta del proyecto/.clasp.json`. El
resultado: lo que se edita en el escritorio acaba en el proyecto de Apps Script
sin copiar y pegar nada.

**Y sin escritorio también.** Al workflow le da igual de dónde venga el push. Un
archivo editado en github.com desde el móvil llega a Apps Script igual que uno
del hook: publicar deja de depender de estar frente a la PC. La contrapartida es
que entonces la copia local se queda atrás, y el hook `Stop` no lo sabe — hay que
hacer `git pull` al volver a la PC. Está explicado en el §3 del documento 10.

Necesita un secreto de repositorio, `CLASPRC_JSON`. Cómo generarlo, qué hace
exactamente y qué revisar cuando falla está en
[`Documentacion/10_Sincronizacion_Apps_Script.md`](Documentacion/10_Sincronizacion_Apps_Script.md).

Dos advertencias que van juntas con la de arriba: `clasp push --force` **pisa**
cualquier edición hecha a mano en el editor de Apps Script, y subir código no
mueve la URL `/exec` de producción (eso es un despliegue aparte, opcional en el
workflow). Ambas están explicadas en el documento 10.

## Finales de línea

El repositorio usa `-text` en `.gitattributes`: git no normaliza CRLF/LF, cada
archivo conserva los finales que ya trae. Es deliberado. Sin eso, cualquier
herramienta que reescriba un archivo entero produce un diff con **todas** las
líneas modificadas, lo que entierra el cambio real y convierte en conflicto
cualquier otra rama que toque ese archivo. El destino es Apps Script, al que los
finales de línea le dan igual, así que no hay nada que ganar unificándolos.
