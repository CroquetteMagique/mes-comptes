#!/bin/bash
# Lancer Mes Comptes sur Mac — double-clic pour démarrer

# Aller dans le dossier du script
cd "$(dirname "$0")"

# Python de l'appli (créé par installer_mac.command), sinon celui du système
PY="./.venv/bin/python3"
if [ ! -x "$PY" ]; then
  PY="$(command -v python3)"
  if [ -z "$PY" ]; then
    osascript -e 'display alert "Python 3 introuvable" message "Lancez d abord installer_mac.command."'
    exit 1
  fi
fi

# Installer les dépendances si besoin
"$PY" -m pip install -r requirements.txt --quiet --exists-action i

# Lancer l'appli
"$PY" app.py
