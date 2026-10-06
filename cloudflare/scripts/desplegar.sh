#!/usr/bin/env bash
# Publica el Portal en Cloudflare: base D1 (migraciones), Worker de API y Worker del borde.
#   scripts/desplegar.sh            → todo
#   scripts/desplegar.sh --semillas → además aplica semilla/*.sql a la base REMOTA (borra y recarga datos demo)
# Necesita CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID en el entorno.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run construir
npx tsc --noEmit
npx wrangler d1 migrations apply ventel-portal --remote -c wrangler.api.jsonc
if [ "${1:-}" = "--semillas" ]; then
  # Sin la contraseña de producción no se siembra: las cuentas quedarían con la clave local, que está
  # en el repo público, y en producción los correos salen de verdad.
  [ -e semilla/99_claves_produccion.local.sql ] || { echo "Falta semilla/99_claves_produccion.local.sql: corre node scripts/claves-produccion.mjs"; exit 1; }
  for f in semilla/*.sql; do
    [ -e "$f" ] || continue
    echo "semilla remota: $f"
    npx wrangler d1 execute ventel-portal --remote -c wrangler.api.jsonc --file "$f" >/dev/null
  done
fi
npx wrangler deploy -c wrangler.api.jsonc
npx wrangler deploy -c wrangler.produccion.jsonc
curl -s https://ventel.logidma.com/api/salud && echo
