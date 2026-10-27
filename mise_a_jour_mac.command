#!/bin/bash
# ═══════════════════════════════════════════════════════
#  Mes Comptes — Mise à jour Mac
#  Double-cliquez pour récupérer les dernières mises à jour
# ═══════════════════════════════════════════════════════

cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     Mise à jour de Mes Comptes       ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Vérifier que git est disponible
if ! command -v git &>/dev/null; then
  echo "❌ git non trouvé — normalement installé avec les outils Xcode."
  osascript -e 'display alert "git introuvable" message "Relancez installer_mac.command pour réparer l installation."'
  exit 1
fi

# Récupérer les mises à jour
echo "▶ Connexion au serveur..."
git fetch origin 2>&1

UPDATES=$(git log HEAD..origin/main --oneline 2>/dev/null | wc -l | tr -d ' ')

if [ "$UPDATES" = "0" ]; then
  echo ""
  echo "✅ Vous avez déjà la dernière version, rien à faire."
  osascript -e 'display notification "Vous avez déjà la dernière version." with title "Mes Comptes"'
else
  echo "▶ $UPDATES mise(s) à jour disponible(s)..."
  git pull origin main
  echo ""
  echo "✅ Application mise à jour avec succès !"
  osascript -e "display notification \"$UPDATES mise(s) à jour installée(s) !\" with title \"✅ Mes Comptes mis à jour\""
fi

echo ""
