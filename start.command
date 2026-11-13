#!/bin/zsh
# Double-click to start the dashboard. Close this window (or press Ctrl-C) to stop it.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (version 22 or newer), then double-click this again."
  read -r "?Press Return to close."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "First run: installing (about a minute)…"
  npm install --no-fund --no-audit || { read -r "?Install failed. Press Return to close."; exit 1; }
fi
npm start
