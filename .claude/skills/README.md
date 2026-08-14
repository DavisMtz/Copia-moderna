# Skills del repositorio

Instrucciones que Claude Code carga solo cuando hacen falta. Viven aquí, dentro
del repositorio, y no en la carpeta personal de nadie: así valen para todo el
equipo, en cualquier máquina, y en las sesiones de claude.ai/code —que arrancan
un contenedor nuevo cada vez y pierden cualquier instalación local.

## Qué hay

| Carpeta | Origen | Para qué |
|---|---|---|
| `gsap-ventel/` | Propia | **Las reglas de la casa.** Manda sobre las demás |
| `gsap-core/` | GreenSock | API base: `to`, `from`, `fromTo`, eases, stagger |
| `gsap-timeline/` | GreenSock | Timelines, parámetro de posición, etiquetas, anidado |
| `gsap-scrolltrigger/` | GreenSock | Animación ligada al scroll, anclajes, `scrub` |
| `gsap-plugins/` | GreenSock | SplitText, MorphSVG, DrawSVG, Flip, Draggable, Observer… |
| `gsap-utils/` | GreenSock | `gsap.utils`: `clamp`, `mapRange`, `wrap`, `snap`… |
| `gsap-performance/` | GreenSock | 60 fps, transform vs layout, `quickTo` |
| `gsap-react/`, `gsap-frameworks/` | GreenSock | **No aplican aquí.** No hay npm ni React |

`gsap-llms.txt` es el índice que publica GreenSock para agentes; se guarda por
referencia.

## Cuál se lee primero

`gsap-ventel` explica **este proyecto**: el contrato de degradación cuando el CDN
no contesta, las piezas que ya existen (`AppMotion`, `VentelLoader`,
`VentelLoaders`, `VentelTruck`), lo que cambia por estar dentro del iframe de
Apps Script y la versión fijada de GSAP. Las oficiales explican **la librería**.
Cuando se contradigan, gana la de la casa: casi siempre es porque la oficial
supone un proyecto con bundler y aquí no lo hay.

## De dónde salen las oficiales y cómo se actualizan

Son las skills oficiales de GreenSock, copiadas de
[`greensock/gsap-skills`](https://github.com/greensock/gsap-skills) (commit
`aed9cfd`, 21 de abril de 2026), licencia MIT — el texto completo está en
`LICENSE-gsap-skills.txt`.

Están copiadas y no instaladas con un gestor a propósito: sin ellas dentro del
repositorio, cada sesión nueva en la web empezaría sin ellas.

Para actualizarlas:

```bash
git clone --depth 1 https://github.com/greensock/gsap-skills /tmp/gsap-skills
cp -r /tmp/gsap-skills/skills/gsap-* .claude/skills/
cp /tmp/gsap-skills/skills/llms.txt .claude/skills/gsap-llms.txt
cp /tmp/gsap-skills/LICENSE .claude/skills/LICENSE-gsap-skills.txt
```

No se tocan a mano: cualquier regla propia va en `gsap-ventel`, o el siguiente
`cp` se la lleva por delante.

## Añadir una skill nueva

Una carpeta con un `SKILL.md` que empiece por su cabecera:

```markdown
---
name: nombre-en-minusculas
description: Qué enseña y —sobre todo— cuándo debe leerse. Aquí es donde se
  decide si la skill se activa o no: nombra las palabras que usará quien
  pregunte, no las que usarías tú al documentarla.
---
```

Lo largo (tablas, recetas, referencias) va en archivos aparte que el `SKILL.md`
menciona, para que solo se lean cuando de verdad hacen falta.
