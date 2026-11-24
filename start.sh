#!/bin/zsh
# Start (or restart) the Pencil → Claude relay and print the iPad link.
# Safe to run any time: it never rebuilds PencilRelay.app, so your Accessibility permission stays.
set -uo pipefail
SRC="${0:A:h}"
DEST="$HOME/Library/Application Support/PencilToClaude"
LABEL="com.vijayvignesh.pencil-to-claude"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/PencilToClaude.log"
DOMAIN="gui/$(id -u)"

# First time (or after uninstall): do the full install instead.
if [ ! -x "$DEST/PencilRelay.app/Contents/MacOS/PencilRelay" ] || [ ! -f "$PLIST" ]; then
  echo "Relay not installed yet: running install.sh…"
  "$SRC/install.sh" || exit 1
else
  # Pick up any edits made in this project folder.
  cp "$SRC/server.mjs" "$DEST/"
  cp -R "$SRC/public/." "$DEST/public/"
  # Something else holding the port (e.g. a manual `node server.mjs`)? Stop it.
  pids=$(lsof -tiTCP:8787 -sTCP:LISTEN 2>/dev/null || true)
  for p in ${(f)pids}; do
    [[ "$(ps -o comm= -p $p)" == *node* ]] && ! launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -q "pid = $p" && kill "$p"
  done
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "$DOMAIN/$LABEL"
  else
    launchctl bootstrap "$DOMAIN" "$PLIST"
  fi
fi

# Wait for it to answer, then report.
TOKEN=$(/usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["token"])' "$DEST/data/config.json" 2>/dev/null || true)
for i in {1..20}; do
  reply=$(curl -s -m 2 -XPOST -H "X-Token: $TOKEN" http://localhost:8787/api/status 2>/dev/null) && [ -n "$reply" ] && break
  sleep 0.5
done

if [ -z "${reply:-}" ]; then
  echo "✗ Relay didn't start. Last log lines:"; tail -n 8 "$LOG"; exit 1
fi
echo "✓ Relay running."
if [[ "$reply" == *error* ]]; then
  echo "! But macOS is blocking it: $reply"
  echo "  Enable PencilRelay in System Settings → Privacy & Security → Accessibility, then run ./start.sh again."
fi
echo "iPad link:"
echo "  http://$(scutil --get LocalHostName).local:8787/?t=$TOKEN"
