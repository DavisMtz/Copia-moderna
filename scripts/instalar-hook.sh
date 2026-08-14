#!/usr/bin/env bash
#
# Instala un hook que publica en Apps Script solo, al traerte cambios de main.
# ---------------------------------------------------------------------------
# Con esto, publicar deja de ser algo que haya que acordarse de hacer: cada vez
# que hagas `git pull` (o fusiones un PR) en `main` y eso traiga cambios dentro
# de «Carpeta del proyecto/», el código se sube al proyecto de Apps Script con
# tu propia sesión de clasp. Sin secretos y sin pasar por GitHub.
#
# Es opt-in a propósito: los hooks no se versionan, así que nadie se encuentra
# con que su equipo publica solo sin haberlo pedido. Hay que ejecutar esto.
#
# Instalar:    ./scripts/instalar-hook.sh
# Desinstalar: rm .git/hooks/post-merge
#
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS="$(git -C "${RAIZ}" rev-parse --git-path hooks)"
DESTINO="${HOOKS}/post-merge"

if [ -e "${DESTINO}" ]; then
  printf '\033[31mYa existe %s.\033[0m\n' "${DESTINO}" >&2
  printf 'Míralo antes de sobrescribirlo; si no lo necesitas, bórralo y repite.\n' >&2
  exit 1
fi

mkdir -p "${HOOKS}"
cat > "${DESTINO}" <<'HOOK'
#!/usr/bin/env bash
# Publica en Apps Script tras un merge/pull que toque el código del proyecto.
# Lo instaló scripts/instalar-hook.sh. Para quitarlo: rm .git/hooks/post-merge
set -euo pipefail

RAIZ="$(git rev-parse --show-toplevel)"
RAMA="$(git rev-parse --abbrev-ref HEAD)"

# Solo main: publicar desde una rama de trabajo pisaría el proyecto con código
# a medio revisar, que es justo lo que las ramas existen para evitar.
[ "${RAMA}" = "main" ] || exit 0

# Y solo si el merge trajo algo que Apps Script vaya a ver. ORIG_HEAD es donde
# estabas antes del merge, así que este diff es exactamente lo que acaba de entrar.
if git diff --quiet ORIG_HEAD HEAD -- 'Carpeta del proyecto/' 2>/dev/null; then
  exit 0
fi

printf '\033[90m[post-merge] main trae cambios del proyecto: publicando…\033[0m\n'
# Sin `set -e` heredado hacia el script: si la publicación falla, se avisa pero
# NO se rompe el pull, que ya terminó bien y no tiene la culpa.
"${RAIZ}/scripts/publicar.sh" || {
  printf '\033[31m[post-merge] No se pudo publicar. El pull sí funcionó.\033[0m\n' >&2
  printf 'Reintenta a mano con: ./scripts/publicar.sh\n' >&2
}
HOOK

chmod +x "${DESTINO}"
printf '\033[32m✓ Hook instalado en %s\033[0m\n' "${DESTINO}"
printf 'A partir de ahora, un pull/merge en main que toque «Carpeta del proyecto/»\n'
printf 'publica en Apps Script con tu sesión de clasp.\n\n'
printf 'Para quitarlo:  rm %s\n' "${DESTINO}"
