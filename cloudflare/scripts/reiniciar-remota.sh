#!/usr/bin/env bash
# Borra TODAS las tablas de la base D1 REMOTA (incluida d1_migrations), para volver a crearla desde cero
# con las migraciones y las semillas (scripts/desplegar.sh --semillas). Solo tiene sentido en la maqueta:
# sus datos son de ejemplo. Hace falta cuando una migración ya aplicada cambió de contenido.
#   scripts/reiniciar-remota.sh --si
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${1:-}" = "--si" ] || { echo "Esto borra la base remota entera. Repite con --si."; exit 1; }
tablas=$(npx wrangler d1 execute ventel-portal --remote -c wrangler.api.jsonc --json \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'" \
  | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j[0].results.map((r)=>r.name).join("\n"))})')
[ -n "$tablas" ] || { echo "La base remota ya está vacía."; exit 0; }
sql=""
while IFS= read -r t; do sql+="DROP TABLE IF EXISTS \"$t\";"; done <<< "$tablas"
echo "Se borran $(wc -l <<< "$tablas") tablas."
npx wrangler d1 execute ventel-portal --remote -c wrangler.api.jsonc --command "$sql" >/dev/null
echo "Base remota vacía."
