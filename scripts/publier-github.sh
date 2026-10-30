#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="m4ximeG/stockpilot"
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI manquant. Sur Mac : brew install gh"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "Connexion à GitHub nécessaire."
  gh auth login
fi
if [ ! -d .git ]; then git init -b main; fi
git add .
if ! git diff --cached --quiet; then git commit -m "StockPilot: application de stock pour NAS"; fi
if gh repo view "$REPO" >/dev/null 2>&1; then
  if ! git remote get-url origin >/dev/null 2>&1; then git remote add origin "https://github.com/$REPO.git"; fi
  git branch -M main
  git push -u origin main
else
  gh repo create "$REPO" --public --source=. --remote=origin --push
fi
echo "Dépôt : https://github.com/$REPO"
echo "Suivi du build : https://github.com/$REPO/actions"
