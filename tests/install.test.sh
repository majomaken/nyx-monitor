#!/usr/bin/env bash
# install.sh against stubs: no real dconf, GNOME or extensions folder is touched.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2] want [$3]"; fail=1; fi; }

run() { # run <enabled-before> [args]: prints what gsettings set got
    local tmp; tmp=$(mktemp -d)
    mkdir -p "$tmp/bin"
    cat > "$tmp/bin/gsettings" <<STUB
#!/usr/bin/env bash
case "\$1" in get) echo "$1" ;; set) echo "\$4" > "$tmp/set" ;; esac
STUB
    printf '#!/usr/bin/env bash\nexit 1\n' > "$tmp/bin/gnome-extensions"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$tmp/bin/glib-compile-schemas"
    chmod +x "$tmp/bin/"*
    PATH="$tmp/bin:$PATH" NYX_EXTENSIONS_DIR="$tmp/ext" bash "$here/install.sh" "${@:2}" >/dev/null
    cat "$tmp/set" 2>/dev/null || echo "(unchanged)"
    [ -L "$tmp/ext/nyx-monitor@majomaken" ] && readlink "$tmp/ext/nyx-monitor@majomaken" > "$tmp/link" && cat "$tmp/link" >&3
    rm -rf "$tmp"
}

exec 3>/dev/null
check "empty list" "$(run '@as []')" "['nyx-monitor@majomaken']"
check "appends to others" "$(run "['a@b', 'c@d']")" "['a@b', 'c@d', 'nyx-monitor@majomaken']"
check "already enabled" "$(run "['nyx-monitor@majomaken']")" "(unchanged)"
exec 3>&1
link=$(run '@as []' 3>&1 >/dev/null)
check "links extension/" "$link" "$here/extension"
exit $fail
