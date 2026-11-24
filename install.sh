#!/bin/zsh
# Installs the Pencil → Claude relay so it starts at login and restarts if it crashes.
set -euo pipefail
SRC="${0:A:h}"
DEST="$HOME/Library/Application Support/PencilToClaude"
APP="$DEST/PencilRelay.app"
LABEL="com.vijayvignesh.pencil-to-claude"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="${PENCIL_NODE:-$(command -v node)}"
NODE="${NODE:A}"   # resolve symlinks: the firewall rule is for the real binary

mkdir -p "$DEST/public" "$DEST/data" "$APP/Contents/MacOS"
cp "$SRC/server.mjs" "$DEST/"
cp -R "$SRC/public/." "$DEST/public/"
[ -f "$DEST/data/config.json" ] || cp "$SRC/data/config.json" "$DEST/data/" 2>/dev/null || true

swiftc -O -o "$APP/Contents/MacOS/PencilRelay" "$SRC/launcher/main.swift"
cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>$LABEL</string>
  <key>CFBundleName</key><string>PencilRelay</string>
  <key>CFBundleExecutable</key><string>PencilRelay</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Pastes your iPad drawings into the Claude app.</string>
</dict></plist>
PL
codesign --force --sign - --identifier "$LABEL" "$APP"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$APP/Contents/MacOS/PencilRelay</string>
    <string>$DEST</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PENCIL_NODE</key><string>$NODE</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/PencilToClaude.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/PencilToClaude.log</string>
</dict></plist>
PL

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. Logs: ~/Library/Logs/PencilToClaude.log"
