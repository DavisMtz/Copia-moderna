#!/usr/bin/env bash
#
# Publicar en Apps Script DESDE TU EQUIPO, sin ningún secreto de por medio.
# ---------------------------------------------------------------------------
# Por qué existe: `clasp push` habla con la API de Apps Script de Google, y esa
# API exige un token OAuth de la cuenta dueña del script. Un runner de GitHub
# arranca limpio —sin navegador y sin sesión de Google—, así que para publicar
# desde GitHub no hay más remedio que guardarle la credencial en un secreto.
# No es una decisión de diseño de este repositorio: es cómo funciona el acceso
# de Google.
#
# La única forma real de publicar SIN secretos es hacerlo desde una máquina que
# ya tenga la sesión iniciada. Eso es lo que hace este script: usa el
# ~/.clasprc.json que te dejó `clasp login` y sube exactamente lo mismo que
# subiría el flujo de GitHub.
#
# Uso:
#   ./scripts/publicar.sh                 sube el código al proyecto
#   ./scripts/publicar.sh <deploymentId>  además apunta ese despliegue de
#                                         producción (/exec) al código nuevo
#
# La primera vez, y solo la primera:
#   1. npm install --global @google/clasp@3.3.0
#   2. Activa «API de Google Apps Script» en
#      https://script.google.com/home/usersettings
#   3. clasp login
#
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROYECTO="${RAIZ}/Carpeta del proyecto"
DEPLOYMENT_ID="${1:-}"

rojo()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[90m%s\033[0m\n' "$*"; }

# ── Comprobaciones previas ────────────────────────────────────────────────
# Cada una falla con la instrucción exacta que la arregla. El error crudo de
# clasp cuando falta algo de esto no dice nada útil.

if ! command -v clasp >/dev/null 2>&1; then
  rojo "No encuentro clasp."
  rojo "Instálalo una vez con:  npm install --global @google/clasp@3.3.0"
  exit 1
fi

if [ ! -f "${PROYECTO}/.clasp.json" ]; then
  rojo "No encuentro «Carpeta del proyecto/.clasp.json»."
  rojo "¿Estás ejecutando esto dentro del repositorio?"
  exit 1
fi

if ! clasp show-authorized-user >/dev/null 2>&1; then
  rojo "No hay sesión de Google iniciada en clasp."
  rojo "Ejecuta:  clasp login"
  rojo ""
  rojo "Si ya lo hiciste y sigue fallando, casi siempre falta activar"
  rojo "«API de Google Apps Script» en https://script.google.com/home/usersettings"
  exit 1
fi

CUENTA="$(clasp show-authorized-user 2>/dev/null | tail -n1)"
gris "Publicando como: ${CUENTA}"
gris "Proyecto:        $(basename "${PROYECTO}")"
echo

# ── Subida ────────────────────────────────────────────────────────────────
# --force evita la pregunta interactiva del manifiesto. Lo que sube y lo que no
# lo decide «Carpeta del proyecto/.claspignore», igual que en el flujo de GitHub:
# este script no aplica reglas propias, para que local y CI no puedan divergir.
cd "${PROYECTO}"
clasp push --force

verde "✓ Código subido. La URL /dev ya sirve esta versión."

# ── Despliegue de producción (opcional) ───────────────────────────────────
# `clasp push` deja el código en el proyecto al instante, pero la URL /exec
# sigue sirviendo la versión congelada del despliegue hasta que se apunta a una
# nueva. Quien no pase el id simplemente no toca producción, y se le dice.
if [ -n "${DEPLOYMENT_ID}" ]; then
  clasp deploy --deploymentId "${DEPLOYMENT_ID}" \
               --description "local $(git -C "${RAIZ}" rev-parse --short HEAD)"
  verde "✓ Despliegue de producción (/exec) apuntando al código nuevo."
else
  gris "Producción (/exec) sin tocar: sigue en su versión anterior."
  gris "Para actualizarla:  ./scripts/publicar.sh <deploymentId>"
  gris "El id sale de:      clasp list-deployments"
fi
