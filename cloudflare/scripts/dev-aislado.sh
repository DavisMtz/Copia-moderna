#!/usr/bin/env bash
# Levanta un Worker local con su PROPIA base D1, para que varias personas (o agentes) prueben en
# paralelo sin pisarse.
#   scripts/dev-aislado.sh <nombre> <puerto> [--reiniciar]
# La primera vez (o con --reiniciar) aplica las migraciones y TODAS las semillas (semilla/*.sql, en
# orden). Las veces siguientes solo aplica migraciones nuevas. Deja el estado en .wrangler/estado-<nombre>.
set -euo pipefail
cd "$(dirname "$0")/.."
NOMBRE=${1:?uso: dev-aislado.sh <nombre> <puerto> [--reiniciar]}
PUERTO=${2:?falta el puerto}
ESTADO=".wrangler/estado-$NOMBRE"
if [ "${3:-}" = "--reiniciar" ]; then rm -rf "$ESTADO"; fi
[ -d public/pantallas ] || node scripts/construir.mjs >/dev/null
NUEVO=0; [ -d "$ESTADO" ] || NUEVO=1
npx wrangler d1 migrations apply ventel-portal --local --persist-to "$ESTADO" 2>&1 | grep -E "✅|✘|ERROR|error" || true
if [ "$NUEVO" = "1" ]; then
  for f in semilla/*.sql; do
    [ -e "$f" ] || continue
    npx wrangler d1 execute ventel-portal --local --persist-to "$ESTADO" --file "$f" >/dev/null 2>&1 \
      && echo "semilla: $f" || echo "✘ semilla falló: $f"
  done
fi
exec npx wrangler dev --local --persist-to "$ESTADO" --port "$PUERTO" --inspector-port $((PUERTO + 1000)) --show-interactive-dev-session=false
