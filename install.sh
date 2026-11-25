#!/usr/bin/env bash
# Installs nyx-monitor for this user: links extension/ into GNOME Shell's extensions folder,
# compiles its settings schema and adds it to the enabled list. GNOME on Wayland reads new
# extension code only at login, so the first install (and every code change) needs a log out
# and back in. Host only: it writes into $HOME and the user's dconf.
#   bash install.sh             install or update
#   bash install.sh --remove    disable it and remove the link
set -euo pipefail

uuid=nyx-monitor@majomaken
here=$(cd "$(dirname "$0")" && pwd)
ext_dir=${NYX_EXTENSIONS_DIR:-$HOME/.local/share/gnome-shell/extensions}
dest=$ext_dir/$uuid
enabled=$(gsettings get org.gnome.shell enabled-extensions)

if [ "${1:-}" = --remove ]; then
    gnome-extensions disable "$uuid" 2>/dev/null || true
    [ -L "$dest" ] && rm "$dest"
    echo "Removed. It disappears from the screen now; GNOME forgets it at the next login."
    exit 0
fi

glib-compile-schemas "$here/extension/schemas"
mkdir -p "$ext_dir"
if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "$dest exists and is not a link; move it away first." >&2
    exit 1
fi
ln -sfn "$here/extension" "$dest"

case "$enabled" in
    *"'$uuid'"*) ;;
    "@as []" | "[]") gsettings set org.gnome.shell enabled-extensions "['$uuid']" ;;
    *) gsettings set org.gnome.shell enabled-extensions "${enabled%]}, '$uuid']" ;;
esac

if gnome-extensions info "$uuid" >/dev/null 2>&1; then
    echo "Installed and enabled. Code changes show up after logging out and back in."
else
    echo "Linked and enabled. Log out and back in once so GNOME loads it."
fi
