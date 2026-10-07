#!/usr/bin/env bash
# Publica el Portal en Cloudflare: base D1 (migraciones), Worker de API y Worker del borde.
#   scripts/desplegar.sh                       → código y migraciones
#   scripts/desplegar.sh --semillas            → además siembra la base REMOTA con los datos de ejemplo
#   scripts/desplegar.sh --semillas --catalogo → y además el catálogo real del Portal
# El catálogo real (semilla/20_catalogo_portal.local.sql) va aparte a propósito: lo que se siembra en
# producción lo ve quien abra la dirección, así que solo se sube cuando se decidió quién puede entrar.
# Las semillas son INSERT: sobre una base que ya tiene datos, antes va scripts/reiniciar-remota.sh --si.
# Necesita CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID en el entorno.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run construir
npx tsc --noEmit
npx wrangler d1 migrations apply ventel-portal --remote -c wrangler.api.jsonc
CATALOGO=0; for a in "$@"; do [ "$a" = "--catalogo" ] && CATALOGO=1; done
if [ "${1:-}" = "--semillas" ]; then
  # Sin la contraseña de producción no se siembra: las cuentas quedarían con la clave local, que está
  # en el repo público, y en producción los correos salen de verdad.
  [ -e semilla/99_claves_produccion.local.sql ] || { echo "Falta semilla/99_claves_produccion.local.sql: corre node scripts/claves-produccion.mjs"; exit 1; }
  # Las cuentas (00) y su contraseña de producción (99) van primero y juntas: así no hay ni un instante
  # en que las cuentas de producción tengan la clave local, que está en el repositorio.
  archivos=(semilla/00_*.sql semilla/99_claves_produccion.local.sql)
  for f in semilla/*.sql; do case "$f" in semilla/00_*|*claves_produccion*) ;; *) archivos+=("$f") ;; esac; done
  for f in "${archivos[@]}"; do
    [ -e "$f" ] || continue
    case "$f" in *catalogo*) [ "$CATALOGO" = "1" ] || { echo "sin catálogo real: $f (usa --catalogo)"; continue; } ;; esac
    echo "semilla remota: $f"
    npx wrangler d1 execute ventel-portal --remote -c wrangler.api.jsonc --file "$f" >/dev/null
  done
fi
npx wrangler deploy -c wrangler.api.jsonc
npx wrangler deploy -c wrangler.produccion.jsonc
curl -s https://ventel.logidma.com/api/salud && echo
