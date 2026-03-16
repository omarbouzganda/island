#!/bin/bash
# Freeisle Uninstaller for Linux
echo "🏝️  Uninstalling Freeisle..."
rm -f "$HOME/.local/share/applications/freeisle.desktop"
rm -f "$HOME/Desktop/Freeisle.desktop"
rm -f "$HOME/.local/share/icons/hicolor/256x256/apps/freeisle.png"
rm -rf "$HOME/.local/share/freeisle"
sudo rm -f /etc/sudoers.d/freeisle 2>/dev/null || true
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "✅ Freeisle removed. Your data in ~/.config/Freeisle is kept."
echo "   To delete data too: rm -rf ~/.config/Freeisle"
