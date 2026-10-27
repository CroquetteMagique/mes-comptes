#!/bin/bash
# ═══════════════════════════════════════════════════════
#  Mes Comptes — Installateur Mac
#  Lance ce fichier UNE SEULE FOIS depuis le Terminal :
#    bash ~/Downloads/AppComptes/installer_mac.command
# ═══════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP="$HOME/Desktop"
APP_PATH="$DESKTOP/Mes Comptes.app"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║      Installation de Mes Comptes     ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Cherche Python 3 dans les emplacements habituels ────
find_python3() {
  for p in \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 \
    /usr/bin/python3; do
    if [ -x "$p" ] && "$p" --version &>/dev/null 2>&1; then
      echo "$p"; return 0
    fi
  done
  # Dernier recours : PATH courant
  local p; p=$(command -v python3 2>/dev/null)
  [ -n "$p" ] && echo "$p" && return 0
  return 1
}

# ── 1. Python 3 ─────────────────────────────────────────
echo "▶ Recherche de Python 3..."
PYTHON_PATH=$(find_python3)

if [ -z "$PYTHON_PATH" ]; then
  echo "   Python 3 non trouvé sur ce Mac."

  # — Essai via Homebrew —
  BREW=""
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew $(command -v brew 2>/dev/null); do
    [ -x "$b" ] && BREW="$b" && break
  done

  if [ -n "$BREW" ]; then
    echo "   Homebrew détecté → installation de Python 3 via brew..."
    "$BREW" install python3
    PYTHON_PATH=$(find_python3)

  else
    # — Téléchargement de l'installateur officiel python.org —
    echo "   Téléchargement de Python 3.12 depuis python.org..."
    osascript -e 'display notification "Téléchargement de Python 3 en cours..." with title "Mes Comptes"'

    PKG_URL="https://www.python.org/ftp/python/3.12.7/python-3.12.7-macos11.pkg"
    PKG_PATH="/tmp/python3_installer.pkg"

    if curl -L --progress-bar -o "$PKG_PATH" "$PKG_URL"; then
      open "$PKG_PATH"
      osascript << 'DIALOG'
display dialog "L'installateur Python 3 s'est ouvert.

  1. Suivez les étapes d'installation jusqu'à la fin
  2. Revenez dans ce Terminal
  3. Cliquez OK pour continuer" ¬
  buttons {"OK"} default button "OK" ¬
  with title "Mes Comptes — Installation de Python"
DIALOG
      # Mise à jour du PATH après installation PKG
      export PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:/usr/local/bin:$PATH"
      PYTHON_PATH=$(find_python3)
    else
      osascript -e 'display alert "Échec du téléchargement" message "Vérifiez votre connexion internet ou installez Python 3 manuellement depuis https://www.python.org, puis relancez installer_mac.command."'
      echo "❌ Impossible de télécharger Python 3. Vérifiez votre connexion."
      exit 1
    fi
  fi
fi

# Vérification finale
if [ -z "$PYTHON_PATH" ]; then
  osascript -e 'display alert "Python 3 introuvable" message "Relancez installer_mac.command une fois Python 3 installé."'
  echo "❌ Python 3 toujours introuvable. Relancez ce script après installation."
  exit 1
fi

echo "   ✅ Python trouvé : $PYTHON_PATH ($("$PYTHON_PATH" --version 2>&1))"

# ── 2. pip ──────────────────────────────────────────────
echo ""
echo "▶ Vérification de pip..."
if ! "$PYTHON_PATH" -m pip --version &>/dev/null 2>&1; then
  echo "   pip absent → installation..."
  curl -sS https://bootstrap.pypa.io/get-pip.py | "$PYTHON_PATH"
fi
echo "   ✅ pip OK"

# ── 3. Environnement Python propre à l'appli ────────────
# (évite le refus « externally-managed-environment » du Python de Homebrew)
echo ""
echo "▶ Création de l'environnement Python de l'appli..."
if "$PYTHON_PATH" -m venv "$SCRIPT_DIR/.venv"; then
  PYTHON_PATH="$SCRIPT_DIR/.venv/bin/python3"
  "$PYTHON_PATH" -m pip install --upgrade pip --quiet
  echo "   ✅ Environnement créé"
else
  echo "   ⚠️  Environnement impossible, utilisation du Python du système"
fi

# ── 4. Dépendances Python ───────────────────────────────
echo ""
echo "▶ Installation des dépendances (requirements.txt)..."
"$PYTHON_PATH" -m pip install -r "$SCRIPT_DIR/requirements.txt" --quiet --exists-action i
echo "   ✅ dépendances installées"

# ── 5. Droits d'exécution sur les scripts ───────────────
chmod +x "$SCRIPT_DIR/lancer_mac.command"
chmod +x "$SCRIPT_DIR/installer_mac.command"
chmod +x "$SCRIPT_DIR/mise_a_jour_mac.command"

# ── 6. Créer l'app sur le bureau ────────────────────────
echo ""
echo "▶ Création du raccourci bureau..."
rm -rf "$APP_PATH"

TMPSCRIPT=$(mktemp /tmp/mescomptes_XXXXXX.applescript)
cat > "$TMPSCRIPT" << APPLESCRIPT
set scriptDir to "$SCRIPT_DIR"
set pythonPath to "$PYTHON_PATH"

try
  -- Vérifie si le serveur tourne déjà
  do shell script "lsof -i :5757 | grep LISTEN"
  -- Déjà lancé : ouvre juste le navigateur
  open location "http://127.0.0.1:5757"
on error
  -- Lance le serveur en arrière-plan (il ouvre lui-même le navigateur)
  do shell script "cd " & quoted form of scriptDir & " && " & quoted form of pythonPath & " app.py > /tmp/mescomptes.log 2>&1 &"
end try
APPLESCRIPT

osacompile -o "$APP_PATH" "$TMPSCRIPT"
rm -f "$TMPSCRIPT"

echo "   ✅ Raccourci 'Mes Comptes' créé sur le bureau"

# ── 7. Message final ─────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅  Installation terminée !                             ║"
echo "║                                                          ║"
echo "║  'Mes Comptes' est maintenant sur votre bureau.         ║"
echo "║                                                          ║"
echo "║  ⚠️  Première ouverture :                                ║"
echo "║      Clic-droit sur l'icône → Ouvrir                    ║"
echo "║      (protection macOS, une seule fois)                  ║"
echo "║                                                          ║"
echo "║  Ensuite : double-clic suffit à chaque fois.            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

osascript -e 'display notification "Raccourci créé ! Clic-droit → Ouvrir la première fois." with title "✅ Mes Comptes installé"'
