#!/usr/bin/env bash
# Opens nyx-monitor in a nested GNOME Shell in a window on this desktop (mutter-devkit, `gnome-shell --devkit`), to see
# and click it live without logging out: the gear, the settings window, a switch of character. Same isolation as
# tests/headless.sh: its own D-Bus and XDG folders (the real dconf and extensions are never touched), document portal
# and gvfs shadowed on the private bus, the real session's FUSE mounts checked at the end. Unsafe mode only so Eval and
# Screenshot answer on that private bus.
#
# Host only: the gnome-shell and mutter-devkit binaries (`sudo dnf install mutter-devkit` once).
#   tests/devkit.sh [character]           default: nyx. Runs until the devkit window is closed, or for
#                                         NYX_DEVKIT_SECONDS when set. The window shows the devkit's own monitor (resize
#                                         the window to resize it); no --virtual-monitor, or the widget would sit on a
#                                         second monitor the window never shows.
# While a session runs, $NYX_DEVKIT_DIR (default <repo>/local/nyx-devkit) holds its env, so another terminal can drive it:
#   tests/devkit.sh eval 'JS'             Eval in the nested shell; `n` is the extension object
#   tests/devkit.sh shot NAME             screenshot of the nested monitor into $NYX_DEVKIT_DIR/NAME.png
#   tests/devkit.sh set KEY VALUE         gsettings set on the extension's schema (also: get KEY)
#   tests/devkit.sh prefs                 opens the settings window (NYX_PREFS_PAGE, set when the session starts, picks
#                                         its page: characters, look, card, behaviour, updates)
# NYX_DEVKIT_EXTENSION links another extension folder instead of this checkout's (a release unpacked under
# $NYX_ROOT/releases/<v>/, to see the «Actualizaciones» page as a user does); NYX_UPDATE_URL, NYX_ROOT and
# NYX_ALLOWED_SIGNERS reach the settings window's updater.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
state=${NYX_DEVKIT_DIR:-$here/local/nyx-devkit}
mkdir -p "$state"
state=$(cd "$state" && pwd)
schema=org.gnome.shell.extensions.nyx-monitor

case ${1:-} in
eval | shot | set | get | prefs)
    [ -f "$state/env" ] || { echo "no devkit session is running ($state/env is missing)" >&2; exit 1; }
    set -a
    . "$state/env"
    set +a
    cmd=$1
    shift
    case $cmd in
    eval)
        gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \
            "const n = Main.extensionManager.lookup('nyx-monitor@majomaken').stateObj; $1" ;;
    shot)
        gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
            --method org.gnome.Shell.Screenshot.Screenshot false false "$state/$1.png" >/dev/null
        echo "$state/$1.png" ;;
    set) GSETTINGS_SCHEMA_DIR=$here/extension/schemas gsettings set "$schema" "$@" ;;
    get) GSETTINGS_SCHEMA_DIR=$here/extension/schemas gsettings get "$schema" "$@" ;;
    prefs) gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \
        "Main.extensionManager.lookup('nyx-monitor@majomaken').stateObj.openPreferences()" ;;
    esac
    exit
    ;;
esac

character=${1:-nyx}
wallpaper=$(gsettings get org.gnome.desktop.background picture-uri-dark 2>/dev/null || echo "''")

tmp=$(mktemp -d)
trap 'rm -rf "$tmp" "$state/env"' EXIT
export XDG_CONFIG_HOME=$tmp/config XDG_DATA_HOME=$tmp/data XDG_CACHE_HOME=$tmp/cache XDG_STATE_HOME=$tmp/state
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_DATA_HOME/dbus-1/services"
# See tests/headless.sh: a document portal or gvfs started on the private bus would mount over the real session's.
for name in org.freedesktop.portal.Documents org.gtk.vfs.Daemon; do
    printf '[D-BUS Service]\nName=%s\nExec=/bin/false\n' "$name" > "$XDG_DATA_HOME/dbus-1/services/$name.service"
done
runtime=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
real_mounts() { findmnt -rn -o TARGET,FSTYPE | grep "^$runtime/" | sort; }
mounts_before=$(real_mounts)
extension=${NYX_DEVKIT_EXTENSION:-$here/extension}
glib-compile-schemas "$extension/schemas"
ln -s "$extension" "$XDG_DATA_HOME/gnome-shell/extensions/nyx-monitor@majomaken"
[ -d "$HOME/.local/share/fonts" ] && ln -s "$HOME/.local/share/fonts" "$XDG_DATA_HOME/fonts"

inner() {
    set -euo pipefail
    gsettings set org.gnome.shell enabled-extensions "['nyx-monitor@majomaken']"
    gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
    gsettings set org.gnome.desktop.interface color-scheme 'prefer-dark'
    gsettings set org.gnome.desktop.background picture-uri-dark "$NYX_WALLPAPER"
    gsettings set org.gnome.desktop.background picture-uri "$NYX_WALLPAPER"
    GSETTINGS_SCHEMA_DIR=$NYX_HERE/extension/schemas gsettings set "$NYX_SCHEMA" character "$NYX_CHARACTER"

    local display=nyx-devkit-$$
    gnome-shell --devkit --wayland --no-x11 --unsafe-mode --wayland-display "$display" >"$NYX_STATE/shell.log" 2>&1 &
    local pid=$!
    gdbus wait --session --timeout 60 org.gnome.Shell.Screenshot
    # One monitor, the one the window shows: the widget goes to it.
    local r
    for _ in $(seq 60); do
        r=$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \
            "Main.layoutManager.monitors.length" 2>/dev/null) || true
        [ "$r" = "(true, '1')" ] && break
        sleep 0.5
    done
    [ "$r" = "(true, '1')" ] || echo "the nested shell has $r monitors, expected 1: the widget may not show in the window" >&2
    # The settings window is a D-Bus activated service (org.gnome.Shell.Extensions): it opens in the nested shell.
    dbus-update-activation-environment WAYLAND_DISPLAY="$display" ${NYX_UPDATE_URL:+NYX_UPDATE_URL="$NYX_UPDATE_URL"} \
        ${NYX_ROOT:+NYX_ROOT="$NYX_ROOT"} ${NYX_PREFS_PAGE:+NYX_PREFS_PAGE="$NYX_PREFS_PAGE"} \
        ${NYX_ALLOWED_SIGNERS:+NYX_ALLOWED_SIGNERS="$NYX_ALLOWED_SIGNERS"}
    printf 'DBUS_SESSION_BUS_ADDRESS=%q\nXDG_CONFIG_HOME=%q\nXDG_DATA_HOME=%q\nXDG_CACHE_HOME=%q\nXDG_STATE_HOME=%q\n' \
        "$DBUS_SESSION_BUS_ADDRESS" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" > "$NYX_STATE/env"
    echo "devkit is running ($NYX_CHARACTER). Close its window to end it; drive it with tests/devkit.sh eval|shot|set|get."
    if [ -n "${NYX_DEVKIT_SECONDS:-}" ]; then
        (sleep "$NYX_DEVKIT_SECONDS" && kill "$pid" 2>/dev/null) &
    fi
    wait "$pid" || true
}

export NYX_STATE=$state NYX_HERE=$here NYX_WALLPAPER=$wallpaper NYX_CHARACTER=$character NYX_SCHEMA=$schema
status=0
dbus-run-session -- bash -c "$(declare -f inner); inner" || status=$?

if [ "$(real_mounts)" != "$mounts_before" ]; then
    echo "the run changed the real session's mounts under $runtime:" >&2
    diff <(echo "$mounts_before") <(real_mounts) >&2 || true
    if ! findmnt "$runtime/doc" >/dev/null && grep -q " fuse.portal$" <<<"$mounts_before"; then
        systemctl --user restart xdg-document-portal.service && echo "restarted xdg-document-portal" >&2
    fi
    status=1
fi
grep -i -E "nyx|JS ERROR|Extension .* had error" "$state/shell.log" || echo "no errors from nyx-monitor in shell.log"
exit "$status"
