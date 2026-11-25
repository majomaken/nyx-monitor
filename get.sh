#!/usr/bin/env bash
# First install of Nyx Monitor for anyone:
#   curl -fsSL https://nyx.majomaken.dev/get.sh | bash
# It downloads the updater from the release channel and runs its install, which also sets up the daily check.
# Later updates come from the gear's «Actualizaciones» page or `nyx-monitor-update install`.
# Everything runs from main, called on the last line, so a download cut halfway runs nothing.
set -euo pipefail

main() {
    local url=${NYX_UPDATE_URL:-https://nyx.majomaken.dev}
    local -a proto
    url=${url%/}
    case $url in
        https://*) proto=(--proto "=https" --proto-redir "=https") ;;
        file://*) proto=(--proto "=file" --proto-redir "=file") ;;
        *) echo "get.sh: el canal de actualizaciones debe ser https:// (es $url)." >&2; exit 1 ;;
    esac
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    curl "${proto[@]}" -fsSL --max-time 60 "$url/nyx-monitor-update" -o "$tmp/nyx-monitor-update"
    NYX_UPDATE_URL=$url bash "$tmp/nyx-monitor-update" install
}

main "$@"
