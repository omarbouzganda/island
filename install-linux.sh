#!/bin/bash
# ═══════════════════════════════════════════════════
#  FREEISLE — Linux Installer
#  Run this ONCE after downloading the AppImage.
#  It installs Freeisle like a real app:
#    ✅ Desktop icon
#    ✅ App menu entry (Activities / App Grid)
#    ✅ Double-click to open
#    ✅ Pre-creates /mnt/freeisle so disk works
# ═══════════════════════════════════════════════════

set -e

APPIMAGE_NAME="Freeisle-1.1.0.AppImage"
INSTALL_DIR="$HOME/.local/share/freeisle"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
DESKTOP_FILE="$DESKTOP_DIR/freeisle.desktop"

# Find the AppImage next to this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APPIMAGE="$SCRIPT_DIR/$APPIMAGE_NAME"

echo ""
echo "🏝️  Freeisle Installer"
echo "══════════════════════"

# Check AppImage exists
if [ ! -f "$APPIMAGE" ]; then
    echo "❌ Could not find $APPIMAGE_NAME"
    echo "   Make sure both files are in the same folder."
    echo "   Then run: bash install-linux.sh"
    exit 1
fi

echo "✓ Found AppImage: $APPIMAGE"

# 1. Create install directory
mkdir -p "$INSTALL_DIR"
mkdir -p "$DESKTOP_DIR"
mkdir -p "$ICON_DIR"

# 2. Copy AppImage to install dir
echo "→ Installing to $INSTALL_DIR..."
cp "$APPIMAGE" "$INSTALL_DIR/Freeisle.AppImage"
chmod +x "$INSTALL_DIR/Freeisle.AppImage"

# 3. Extract icon from AppImage (AppImages contain a .desktop and icon inside)
echo "→ Extracting icon..."
cd /tmp
"$INSTALL_DIR/Freeisle.AppImage" --appimage-extract > /dev/null 2>&1 || true
# Try to find icon in extracted squashfs-root
ICON_FOUND=""
for f in /tmp/squashfs-root/*.png /tmp/squashfs-root/usr/share/icons/**/*.png /tmp/squashfs-root/*.svg; do
    if [ -f "$f" ]; then
        cp "$f" "$ICON_DIR/freeisle.png" 2>/dev/null && ICON_FOUND="$f" && break
    fi
done
# Cleanup extracted files
rm -rf /tmp/squashfs-root 2>/dev/null || true
cd "$SCRIPT_DIR"

if [ -z "$ICON_FOUND" ]; then
    echo "→ Icon not found inside AppImage — using fallback path"
fi

# 4. Create .desktop file (this is what makes it appear in the app menu)
echo "→ Creating desktop entry..."
cat > "$DESKTOP_FILE" << DESKTOPEOF
[Desktop Entry]
Version=1.1
Type=Application
Name=Freeisle
GenericName=Private Messenger
Comment=Your isle. Your rules. Your freedom.
Exec="$INSTALL_DIR/Freeisle.AppImage" %U
Icon=$ICON_DIR/freeisle.png
Terminal=false
StartupNotify=true
Categories=Network;Chat;InstantMessaging;
Keywords=chat;messenger;private;encrypted;freeisle;
StartupWMClass=freeisle
DESKTOPEOF

chmod +x "$DESKTOP_FILE"

# 5. Also create desktop shortcut on the actual Desktop
DESKTOP_SHORTCUT="$HOME/Desktop/Freeisle.desktop"
if [ -d "$HOME/Desktop" ]; then
    cp "$DESKTOP_FILE" "$DESKTOP_SHORTCUT"
    chmod +x "$DESKTOP_SHORTCUT"
    # Mark as trusted (needed on some distros like Ubuntu/Kali GNOME)
    gio set "$DESKTOP_SHORTCUT" metadata::trusted true 2>/dev/null || true
    echo "✓ Desktop shortcut created"
fi

# 6. Update desktop database so app appears in menu immediately
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
gtk-update-icon-cache "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

# 7. Pre-create /mnt/freeisle so app can mount disk without asking for password
echo "→ Setting up disk mount point..."
if [ ! -d "/mnt/freeisle" ]; then
    sudo mkdir -p /mnt/freeisle 2>/dev/null || true
fi
sudo chmod 777 /mnt/freeisle 2>/dev/null || true

# 8. Add to fstab-friendly sudoers for mount (optional — no password for mount)
# This lets Freeisle mount its disk without a popup every time
SUDOERS_LINE="$USER ALL=(ALL) NOPASSWD: /bin/mount -o loop * /mnt/freeisle, /bin/umount /mnt/freeisle"
if ! sudo grep -q "NOPASSWD.*freeisle" /etc/sudoers 2>/dev/null; then
    echo "$SUDOERS_LINE" | sudo tee -a /etc/sudoers.d/freeisle > /dev/null 2>/dev/null || true
fi

echo ""
echo "══════════════════════════════════════════"
echo "✅  Freeisle installed successfully!"
echo ""
echo "  To open: look in your Applications menu"
echo "           or double-click the desktop icon"
echo ""
echo "  To uninstall: bash uninstall-linux.sh"
echo "══════════════════════════════════════════"
echo ""

# Ask to launch now
read -p "Launch Freeisle now? [Y/n] " answer
answer=${answer:-Y}
if [[ "$answer" =~ ^[Yy] ]]; then
    nohup "$INSTALL_DIR/Freeisle.AppImage" > /dev/null 2>&1 &
    echo "🏝️  Freeisle is starting..."
fi
