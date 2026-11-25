#!/usr/bin/env bash
# Builds the release channel of nyx-monitor and publishes it at https://nyx.majomaken.dev. The version is
# extension/metadata.json's version-name; its notes are release/notes/<version>.txt. Host bash + git + jq + tar +
# ssh-keygen, like install.sh. The last step deploys release/ (an nginx image, see release/Dockerfile) with the
# maintainer's deploy script (HS_DEPLOY_SKILL); a fork that runs its own channel replaces that step.
#   bash release.sh --dry-run   build release/site/ only (local changes and new files are included, with a warning)
#   bash release.sh             publish: from a clean main equal to origin/main, tagged v<version>, then deployed
# A release ships exactly what the public main holds, and tag v<version> names that commit: the same version is never
# published from another commit or with other contents (Cloudflare keeps a tarball for a year under its versioned
# name, so a new latest.json would not match it). Raise version-name instead.
# latest.json is signed with the release key (NYX_SIGNING_KEY, default ~/.config/nyx-monitor/release-signing-key,
# never in git): a publish refuses without it, or when the signature does not verify against the key pinned in the
# bin/nyx-monitor-update it ships; a dry run without it warns. A symbolic link is refused anywhere in the tracked tree
# and in place of any file the build reads, since it would ship whatever it points to (the release key included).
# NYX_RELEASE_SITE, NYX_FONTS_DIR (default ~/.local/share/fonts, which holds MesloLGS NF), NYX_LIVE_URL and
# HS_DEPLOY_SKILL are for tests.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
site=${NYX_RELEASE_SITE:-$here/release/site}
fonts=${NYX_FONTS_DIR:-$HOME/.local/share/fonts}
dry=0
[ "${1:-}" = --dry-run ] && dry=1
fail() { echo "$*" >&2; exit 1; }
links=$(git -C "$here" -c core.quotePath=false ls-files -s | awk -F'\t' '$1 ~ /^(120000|160000) / {print $2}')
[ -z "$links" ] || fail "a symbolic link or a submodule is tracked, and a release ships regular files only: $links"

version=$(jq -r '."version-name"' "$here/extension/metadata.json")
[[ $version =~ ^[0-9]+(\.[0-9]+)*$ ]] || { echo "metadata.json has no valid version-name" >&2; exit 1; }
notes=$here/release/notes/$version.txt
[ -s "$notes" ] || { echo "write the notes of $version in release/notes/$version.txt first" >&2; exit 1; }
compgen -G "$fonts/MesloLGS NF*.ttf" >/dev/null || { echo "MesloLGS NF is not in $fonts" >&2; exit 1; }
for f in extension/metadata.json "release/notes/$version.txt" release/fonts/LICENSE.txt release/index.html get.sh \
    bin/nyx-monitor-update; do
    [ ! -L "$here/$f" ] || fail "$f is a symbolic link: a release ships regular files only"
done

tag=v$version
others=()
if [ "$dry" = 1 ]; then
    if [ -n "$(git -C "$here" status --porcelain -- .)" ]; then
        echo "warning: local changes and new files are included in this dry run" >&2
        others=(--others)
    fi
else
    [ -z "$(git -C "$here" status --porcelain -- .)" ] || fail "commit or remove the local changes before a release"
    [ "$(git -C "$here" rev-parse --abbrev-ref HEAD)" = main ] || fail "a release is built from main"
    git -C "$here" fetch -q origin main || fail "could not fetch origin/main"
    head=$(git -C "$here" rev-parse HEAD)
    [ "$head" = "$(git -C "$here" rev-parse FETCH_HEAD)" ] || fail "main is not origin/main: push or pull first"
    shipped=$(git -C "$here" ls-remote -q origin "refs/tags/$tag^{}" "refs/tags/$tag" | sort -k2 | tail -1 | cut -f1)
    [ -z "$shipped" ] || [ "$shipped" = "$head" ] ||
        fail "tag $tag already names another commit: raise version-name in extension/metadata.json"
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
# Tracked files (and, in a dry run with local changes, new ones not ignored): never the compiled schema, never a link.
mapfile -d '' -t ship < <(git -C "$here" ls-files -z --cached "${others[@]}" --exclude-standard -- extension bin)
for f in "${ship[@]}"; do
    [[ $f == *gschemas.compiled ]] && continue
    [ -L "$here/$f" ] && fail "$f is a symbolic link: a release ships regular files only"
    [ -f "$here/$f" ] || continue
    mkdir -p "$stage/$(dirname "$f")"
    cp -p "$here/$f" "$stage/$f"
done
mkdir -p "$stage/fonts"
cp "$fonts"/MesloLGS\ NF*.ttf "$stage/fonts/"
cp "$here/release/fonts/LICENSE.txt" "$stage/fonts/LICENSE.txt"
cat > "$stage/fonts/README.txt" <<'TXT'
MesloLGS NF (github.com/romkatv/powerlevel10k-media): Meslo LG by André Berg, patched with Nerd Fonts glyphs.
Apache License 2.0 (LICENSE.txt), with the Bitstream Vera license of its Menlo and Bitstream Vera Sans Mono origins.
nyx-monitor-update installs it into ~/.local/share/fonts only when the system lacks it.
TXT

rm -rf "$site"
mkdir -p "$site/releases"
file=releases/nyx-monitor-$version.tar.gz
stamp=$(git -C "$here" log -1 --format=%ct)
tar --sort=name --mtime="@$stamp" --owner=0 --group=0 --numeric-owner -C "$stage" -cf - extension bin fonts |
    gzip -n -6 > "$site/$file"
sha=$(sha256sum "$site/$file" | cut -d' ' -f1)
bytes=$(stat -c %s "$site/$file")
jq -n --arg v "$version" --arg f "$file" --arg s "$sha" --argjson b "$bytes" --rawfile n "$notes" \
    --argjson shell "$(jq -c '."shell-version"' "$here/extension/metadata.json")" \
    '{version: $v, file: $f, sha256: $s, bytes: $b, notes: ($n | rtrimstr("\n")), shell: $shell}' > "$site/latest.json"
cp "$here/bin/nyx-monitor-update" "$here/get.sh" "$site/"
key=${NYX_SIGNING_KEY:-$HOME/.config/nyx-monitor/release-signing-key}
if [ -f "$key" ]; then
    ssh-keygen -Y sign -f "$key" -n nyx-monitor "$site/latest.json" 2>/dev/null ||
        { echo "could not sign latest.json with $key" >&2; exit 1; }
elif [ "$dry" = 1 ]; then
    echo "warning: no signing key at $key: latest.json is not signed, so the updater refuses this site" >&2
else
    echo "no signing key at $key: a release must be signed" >&2
    exit 1
fi
sed "s/@VERSION@/$version/" "$here/release/index.html" > "$site/index.html"
printf 'User-agent: *\nDisallow: /\n' > "$site/robots.txt"
echo "built $site: $file, $((bytes / 1000000)) MB, sha256 $sha"

[ "$dry" = 1 ] && exit 0
# Verified against the key the shipped updater pins (never NYX_ALLOWED_SIGNERS): what users will check it with.
signers=$stage/allowed_signers
sed -n "s/^signer='\(.*\)'$/\1/p" "$here/bin/nyx-monitor-update" > "$signers"
ssh-keygen -Y verify -f "$signers" -I nyx-monitor-release -n nyx-monitor -s "$site/latest.json.sig" \
    < "$site/latest.json" >/dev/null 2>&1 ||
    { echo "latest.json's signature does not verify against the key pinned in bin/nyx-monitor-update" >&2; exit 1; }
live=${NYX_LIVE_URL:-https://nyx.majomaken.dev}
case $live in
    https://*) proto=(--proto "=https" --proto-redir "=https") ;;
    file://*) proto=(--proto "=file" --proto-redir "=file") ;;
    *) fail "NYX_LIVE_URL must be https:// (it is $live)" ;;
esac
if served=$(curl "${proto[@]}" -fsS --max-time 20 "$live/latest.json" 2>/dev/null) &&
    [ "$(jq -r .version <<<"$served")" = "$version" ] && [ "$(jq -r .sha256 <<<"$served")" != "$sha" ]; then
    fail "the channel already serves $version with other contents; raise version-name in extension/metadata.json"
fi
git -C "$here" tag -f "$tag" "$head" >/dev/null
git -C "$here" push -q origin "refs/tags/$tag" || fail "could not push tag $tag"
skill=${HS_DEPLOY_SKILL:-$HOME/.claude/skills/deploy-homeserver}
"$skill/scripts/hs-deploy.sh" --path "$here/release" --slug nyx-monitor --subdomain nyx --container-port 80 \
    --bind 172.17.0.1 --yes
