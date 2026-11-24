#!/bin/zsh
LABEL="com.vijayvignesh.pencil-to-claude"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Relay stopped and removed from login. App files remain in ~/Library/Application Support/PencilToClaude"
