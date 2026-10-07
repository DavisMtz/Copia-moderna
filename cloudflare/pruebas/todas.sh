#!/usr/bin/env bash
# Corre TODAS las pruebas de los módulos contra el código actual, cada una con su propio Worker local y
# su base D1 recién creada (migraciones + semillas), como las corrió cada módulo al portarse.
#   pruebas/todas.sh            → todas (de tres en tres)
#   pruebas/todas.sh portal ... → solo esas
# Deja el detalle en .wrangler/pruebas/<modulo>.log y sale con 1 si alguna falla.
set -uo pipefail
cd "$(dirname "$0")/.."
declare -A PUERTO=([identidad]=8801 [cotizaciones]=8802 [revision]=8803 [portal]=8804 [operacion]=8805 [consola]=8806 [react]=8807)
declare -A PRUEBA=([identidad]=identidad [cotizaciones]=cotizaciones [revision]=revision [portal]=portal [operacion]=operacion [consola]=consola [react]=nuevas)
MODULOS=("$@"); [ ${#MODULOS[@]} -gt 0 ] || MODULOS=(identidad cotizaciones revision portal operacion consola react)
mkdir -p .wrangler/pruebas
npm run --silent construir >/dev/null 2>&1 || { echo "✘ no se pudieron construir las pantallas (npm run construir)"; exit 1; }

correr() {
  local m=$1 p=${PUERTO[$1]} log=.wrangler/pruebas/$1.log
  bash scripts/dev-aislado.sh "$m" "$p" --reiniciar >"$log.servidor" 2>&1 &
  local pid=$!
  for _ in $(seq 1 90); do curl -sf "http://127.0.0.1:$p/api/salud" >/dev/null 2>&1 && break; sleep 1; done
  if node "pruebas/${PRUEBA[$m]}.test.mjs" "http://127.0.0.1:$p" >"$log" 2>&1; then r="✔"; else r="✘"; fi
  # El Worker corre en procesos hijos de npx (wrangler y workerd): se detienen todos los de esa base,
  # además de lo que escuche en su puerto.
  pkill -f "persist-to .wrangler/estado-$m " 2>/dev/null
  kill $(lsof -ti tcp:"$p" 2>/dev/null) $pid 2>/dev/null; wait $pid 2>/dev/null
  echo "$r $m  ($(grep -Eo '[0-9]+ ?/ ?[0-9]+|[0-9]+ (de|of) [0-9]+' "$log" | tail -1))"
  [ "$r" = "✔" ]
}

fallas=0; activos=0
for m in "${MODULOS[@]}"; do
  correr "$m" & activos=$((activos + 1))
  if [ $activos -ge 3 ]; then wait -n || fallas=$((fallas + 1)); activos=$((activos - 1)); fi
done
while [ $activos -gt 0 ]; do wait -n || fallas=$((fallas + 1)); activos=$((activos - 1)); done
# Las que no necesitan Worker (Node puro).
for t in cotizaciones_pdf correo; do
  if node "pruebas/$t.test.mjs" >".wrangler/pruebas/$t.log" 2>&1; then echo "✔ $t"; else echo "✘ $t"; fallas=$((fallas + 1)); fi
done
echo; [ $fallas -eq 0 ] && echo "Todas las pruebas pasaron." || echo "$fallas con fallas: ver .wrangler/pruebas/*.log"
exit $((fallas > 0))
