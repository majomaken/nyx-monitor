#!/usr/bin/env bash
# bin/nyx-monitor-update and get.sh against a release channel in a temporary folder (file:// URLs) and stubs: no real
# dconf, GNOME, fonts, systemd or extensions folder is touched. Plain bash, like
# install.test.sh; it needs curl, tar, sha256sum and gjs, which every GNOME machine has.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2] want [$3]"; fail=1; fi; }
has() { if grep -qF -- "$3" <<<"$2"; then echo "ok   $1"; else echo "FAIL $1: [$3] not in [$2]"; fail=1; fi; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
site=$work/site
stubs=$work/stubs
mkdir -p "$site/releases" "$stubs"

# Stubs: each logs its arguments to $work/<name>.log; gsettings keeps the enabled list in $work/enabled.
for name in gnome-extensions fc-cache systemctl gdbus; do
    printf '#!/usr/bin/env bash\necho "$*" >> "%s/%s.log"\n' "$work" "$name" > "$stubs/$name"
done
cat > "$stubs/glib-compile-schemas" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$work/glib-compile-schemas.log"
touch "\$1/gschemas.compiled"
STUB
cat > "$stubs/gsettings" <<STUB
#!/usr/bin/env bash
case "\$1" in get) [ -n "\${FAKE_EMPTY_GET:-}" ] || cat "$work/enabled" 2>/dev/null || echo "@as []" ;; set) echo "\$4" > "$work/enabled" ;; esac
STUB
cat > "$stubs/fc-list" <<STUB
#!/usr/bin/env bash
[ -n "\${FAKE_MESLO:-}" ] && echo "/usr/share/fonts/MesloLGS NF Regular.ttf: MesloLGS NF:style=Regular"
exit 0
STUB
chmod +x "$stubs"/*

# Throwaway release keys: latest.json is signed with $work/key, which $work/allowed_signers trusts (S2).
for k in key other; do ssh-keygen -q -t ed25519 -N '' -C "test-$k" -f "$work/$k"; done
echo "nyx-monitor-release namespaces=\"nyx-monitor\" $(cat "$work/key.pub")" > "$work/allowed_signers"
# sign <file> [key]: writes <file>.sig as release.sh does.
sign() { rm -f "$1.sig"; ssh-keygen -Y sign -f "${2:-$work/key}" -n nyx-monitor "$1" 2>/dev/null; }

# release <version> [notes]: a release as release.sh publishes it, with this checkout's updater and units inside.
release() {
    local v=$1 src=$work/build/$1
    mkdir -p "$src/extension/schemas" "$src/bin" "$src/fonts"
    printf '{"uuid": "nyx-monitor@majomaken", "version-name": "%s"}\n' "$v" > "$src/extension/metadata.json"
    cp "$here/bin/nyx-monitor-update" "$here/bin/nyx-monitor-update.service" "$here/bin/nyx-monitor-update.timer" "$src/bin/"
    echo font > "$src/fonts/MesloLGS NF Regular.ttf"
    tar -czf "$site/releases/nyx-monitor-$v.tar.gz" -C "$src" extension bin fonts
    local sha bytes
    sha=$(sha256sum "$site/releases/nyx-monitor-$v.tar.gz" | cut -d' ' -f1)
    bytes=$(stat -c %s "$site/releases/nyx-monitor-$v.tar.gz")
    printf '{"version": "%s", "file": "releases/nyx-monitor-%s.tar.gz", "sha256": "%s", "bytes": %s, "notes": "%s", "shell": ["50"]}\n' \
        "$v" "$v" "$sha" "$bytes" "${2:-Notas de la $v}" > "$site/latest.json"
    sign "$site/latest.json"
    cp "$here/bin/nyx-monitor-update" "$site/nyx-monitor-update"
    cp "$here/get.sh" "$site/get.sh"
}

home=$work/home
mkdir -p "$home"
ext=$home/.local/share/gnome-shell/extensions/nyx-monitor@majomaken
root=$home/.local/share/nyx-monitor
# up <args>: runs the installed updater (the link in ~/.local/bin) with the stubs and the file:// channel.
env_run() { env -u XDG_STATE_HOME -u XDG_CONFIG_HOME -u XDG_DATA_HOME HOME="$home" PATH="$stubs:$PATH" \
    NYX_UPDATE_URL="file://$site" NYX_ALLOWED_SIGNERS="$work/allowed_signers" "$@"; }
up() { env_run bash "$home/.local/bin/nyx-monitor-update" "$@"; }
target() { readlink "$ext" 2>/dev/null || echo "(none)"; }

# ---- first install through get.sh -------------------------------------------------------------
release 1.1
out=$(env_run bash -c "curl -fsSL file://$site/get.sh | bash" 2>&1 || true)
check "get.sh: the extension links to the 1.1 release" "$(target)" "$root/releases/1.1/extension"
check "get.sh: the updater is on PATH, from the release" "$(readlink "$home/.local/bin/nyx-monitor-update")" \
    "$root/releases/1.1/bin/nyx-monitor-update"
check "get.sh: the extension is enabled" "$(cat "$work/enabled")" "['nyx-monitor@majomaken']"
check "get.sh: its schemas are compiled" "$(cat "$work/glib-compile-schemas.log")" "$root/releases/1.1/extension/schemas"
check "get.sh: the font is installed when fc-list lacks it" "$(ls "$home/.local/share/fonts")" "MesloLGS NF Regular.ttf"
check "get.sh: the daily check timer is installed" "$(ls "$home/.config/systemd/user")" \
    "$(printf 'nyx-monitor-update.service\nnyx-monitor-update.timer')"
has "get.sh: the timer is enabled" "$(cat "$work/systemctl.log")" "--user enable --now nyx-monitor-update.timer"
has "get.sh: asks to log out and in" "$out" "Cierra sesión y vuelve a entrar"

check "get.sh: its body runs from a main function, so a cut download runs nothing" "$(tail -1 "$here/get.sh")" 'main "$@"'

# ---- a channel that is not https is refused before any download (S3) ------------------------------
for u in http://127.0.0.1:9 ftp://127.0.0.1:9; do
    has "updater: $u is refused" "$(env_run env NYX_UPDATE_URL=$u bash "$site/nyx-monitor-update" check 2>&1 || true)" "https://"
    has "get.sh: $u is refused" "$(env_run env NYX_UPDATE_URL=$u bash "$site/get.sh" 2>&1 || true)" "https://"
done

# ---- check -------------------------------------------------------------------------------------
has "check: up to date" "$(up check)" "al día"
has "check --json: no update" "$(up check --json)" '"update":false'
release 1.2 'Seis personajes de \"NIKKE\"'
has "check: a new version" "$(up check)" "1.2"
json=$(up check --json || true)
has "check --json: installed" "$json" '"installed":"1.1"'
has "check --json: latest" "$json" '"latest":"1.2"'
has "check --json: update" "$json" '"update":true'
has "check --json: notes escaped" "$json" '"notes":"Seis personajes de \"NIKKE\""'
has "check --json: not a development install" "$json" '"dev":false'
up check --notify >/dev/null
up check --notify >/dev/null
check "check --notify: one notification per new version" "$(grep -c Notify "$work/gdbus.log")" "1"

# ---- install, prune, rollback ------------------------------------------------------------------
out=$(up install 2>&1 || true)
check "install: the link moves to 1.2" "$(target)" "$root/releases/1.2/extension"
check "install: 1.1 stays for a rollback" "$(ls "$root/releases" | tr '\n' ' ')" "1.1 1.2 "
has "install: asks to log out and in" "$out" "Cierra sesión y vuelve a entrar"
has "install: up to date afterwards" "$(up check --json)" '"update":false'
release 1.3
up install >/dev/null 2>&1
check "install: keeps the three newest, so a shell still on 1.1 keeps its files after two updates" \
    "$(ls "$root/releases" | tr '\n' ' ')" "1.1 1.2 1.3 "
check "install: the updater follows the release" "$(readlink "$home/.local/bin/nyx-monitor-update")" \
    "$root/releases/1.3/bin/nyx-monitor-update"
up rollback >/dev/null 2>&1
check "rollback: back to 1.2" "$(target)" "$root/releases/1.2/extension"
has "status: names the installed version" "$(up status 2>&1)" "1.2"

# ---- version order is numeric ------------------------------------------------------------------
release 1.10
has "check: 1.10 is newer than 1.2" "$(up check --json)" '"update":true'
up install >/dev/null 2>&1
check "install: a fourth release removes the oldest" "$(ls "$root/releases" | tr '\n' ' ')" "1.10 1.2 1.3 "
release 1.9
has "check: 1.9 is not newer than 1.10" "$(up check --json)" '"update":false'

# ---- a tarball that does not match its sha256 is refused --------------------------------------
release 1.11
sed -i 's/"sha256": "[0-9a-f]*"/"sha256": "0000000000000000000000000000000000000000000000000000000000000000"/' "$site/latest.json"
sign "$site/latest.json"
before=$(target)
if up install >/dev/null 2>&1; then rc=0; else rc=$?; fi
check "sha mismatch: install fails" "$([ "$rc" -ne 0 ] && echo failed || echo passed)" "failed"
check "sha mismatch: the link is unchanged" "$(target)" "$before"
check "sha mismatch: nothing unpacked" "$([ -e "$root/releases/1.11" ] && echo yes || echo no)" "no"

# ---- latest.json is trusted only with a valid signature from the release key (S2) -----------------
release 1.12
before=$(target)
notified=$(grep -c Notify "$work/gdbus.log" || true)
# refused <name>: install fails and changes nothing; check --notify announces nothing.
refused() {
    if up install >/dev/null 2>&1; then rc=0; else rc=$?; fi
    check "$1: install refuses" "$([ "$rc" -ne 0 ] && echo refused || echo installed)" "refused"
    check "$1: the link is unchanged" "$(target)" "$before"
    check "$1: nothing unpacked" "$([ -e "$root/releases/1.12" ] && echo yes || echo no)" "no"
    up check --notify >/dev/null 2>&1 || true
    check "$1: no notification" "$(grep -c Notify "$work/gdbus.log" || true)" "$notified"
}
rm -f "$site/latest.json.sig"
refused "unsigned channel"
sign "$site/latest.json" "$work/other"
refused "signed by another key"
has "bad signature: check says why" "$(up check 2>&1 || true)" "firma"
sign "$site/latest.json"
sed -i 's/Notas de la 1.12/Otras notas/' "$site/latest.json"
refused "latest.json changed after signing"
: > "$site/latest.json.sig"
refused "an empty signature"
rm -f "$site/latest.json.sig"
ssh-keygen -Y sign -f "$work/key" -n file "$site/latest.json" 2>/dev/null
refused "signed for another namespace"
printf 'other\n' > "$work/other.json"
sign "$work/other.json"
cp "$work/other.json.sig" "$site/latest.json.sig"
refused "a signature made for another file"
pinned=$(sed -n "s/^signer='\(.*\)'$/\1/p" "$here/bin/nyx-monitor-update")
check "the pinned signer names the release principal and namespace" "$(cut -d' ' -f1-2 <<<"$pinned")" \
    'nyx-monitor-release namespaces="nyx-monitor"'
cut -d' ' -f3- <<<"$pinned" > "$work/pinned.pub"
check "the pinned key is an ed25519 key" "$(ssh-keygen -l -f "$work/pinned.pub" 2>/dev/null | grep -o '(ED25519)')" "(ED25519)"

# ---- prune removes old releases only: a folder or a link of the user's own under releases/ stays (S6) --
mkdir -p "$root/releases/mine" "$work/precious"
echo keep > "$work/precious/file"
ln -s "$work/precious" "$root/releases/0.1"
release 1.20
up install >/dev/null 2>&1
check "prune: old releases go, a folder and a link of the user's own stay" "$(ls "$root/releases" | tr '\n' ' ')" \
    "0.1 1.10 1.20 1.3 mine "
check "prune: what the link points to is untouched" "$(cat "$work/precious/file" 2>/dev/null)" "keep"

# ---- a folder copied by hand (an install from before the channel) moves aside, never deleted ----
rm -rf "$home" "$work/enabled" "$work"/*.log
mkdir -p "$ext"
echo legacy > "$ext/marker"
mkdir -p "$home/.local/bin"
echo mine > "$home/.local/bin/nyx-monitor-update"
release 1.1
FAKE_MESLO=1 env_run bash -c "curl -fsSL file://$site/get.sh | bash" >/dev/null 2>&1
check "own updater file: the link replaces it" "$(readlink "$home/.local/bin/nyx-monitor-update")" \
    "$root/releases/1.1/bin/nyx-monitor-update"
check "own updater file: kept aside as .bak-<date>" "$(cat "$home"/.local/bin/nyx-monitor-update.bak-* 2>/dev/null)" "mine"
check "legacy: the extension now links to the release" "$(target)" "$root/releases/1.1/extension"
check "legacy: the copied folder is kept under releases/legacy-*" "$(cat "$root"/releases/legacy-*/marker 2>/dev/null)" "legacy"
check "legacy: a font already there is not copied again" "$(ls "$home/.local/share/fonts" 2>/dev/null)" ""

# ---- gsettings that prints nothing still leaves a valid list -------------------------------------
rm -rf "$home" "$work/enabled"
release 1.1
FAKE_EMPTY_GET=1 env_run bash -c "curl -fsSL file://$site/get.sh | bash" >/dev/null 2>&1
check "empty gsettings answer: the list holds only the extension" "$(cat "$work/enabled" 2>/dev/null)" "['nyx-monitor@majomaken']"

# ---- a development install (a link into a git checkout) is left alone --------------------------
rm -rf "$home"
mkdir -p "$(dirname "$ext")" "$work/checkout/extension"
printf '{"version-name": "1.1"}\n' > "$work/checkout/extension/metadata.json"
ln -s "$work/checkout/extension" "$ext"
release 1.2
if env_run bash "$site/nyx-monitor-update" install >/dev/null 2>&1; then rc=0; else rc=$?; fi
check "dev install: install refuses" "$([ "$rc" -ne 0 ] && echo refused || echo installed)" "refused"
check "dev install: the link is unchanged" "$(target)" "$work/checkout/extension"
has "dev install: check --json says so" "$(env_run bash "$site/nyx-monitor-update" check --json)" '"dev":true'

# ---- release.sh --dry-run builds a channel the updater installs from (S6) -----------------------
real=$work/real-site
mkdir -p "$work/fonts"
echo ttf > "$work/fonts/MesloLGS NF Regular.ttf"
NYX_RELEASE_SITE=$real NYX_FONTS_DIR=$work/fonts NYX_SIGNING_KEY=$work/key bash "$here/release.sh" --dry-run >/dev/null 2>&1 ||
    echo "FAIL release.sh --dry-run exited non-zero"
version=$(jq -r '."version-name"' "$here/extension/metadata.json")
check "release: latest.json names this checkout's version" "$(jq -r .version "$real/latest.json" 2>/dev/null)" "$version"
file=$(jq -r .file "$real/latest.json" 2>/dev/null)
check "release: the tarball's sha256 is in latest.json" "$(sha256sum "$real/$file" 2>/dev/null | cut -d' ' -f1)" \
    "$(jq -r .sha256 "$real/latest.json" 2>/dev/null)"
check "release: its size too" "$(stat -c %s "$real/$file" 2>/dev/null)" "$(jq -r .bytes "$real/latest.json" 2>/dev/null)"
check "release: notes for this version" "$([ -n "$(jq -r '.notes // empty' "$real/latest.json" 2>/dev/null)" ] && echo yes)" "yes"
listing=$(tar -tzf "$real/$file" 2>/dev/null)
has "release: the extension is inside" "$listing" "extension/metadata.json"
has "release: the categories are inside" "$listing" "extension/categories.json"
has "release: the updater is inside" "$listing" "bin/nyx-monitor-update"
has "release: the timer is inside" "$listing" "bin/nyx-monitor-update.timer"
has "release: the font is inside" "$listing" "fonts/MesloLGS NF Regular.ttf"
has "release: with its Apache-2.0 license text" "$listing" "fonts/LICENSE.txt"
check "release: no compiled schema inside" "$(grep -c gschemas.compiled <<<"$listing")" "0"
check "release: latest.json is signed with the release key" "$(ssh-keygen -Y verify -f "$work/allowed_signers" \
    -I nyx-monitor-release -n nyx-monitor -s "$real/latest.json.sig" < "$real/latest.json" >/dev/null 2>&1 && echo yes)" "yes"
out=$(NYX_RELEASE_SITE=$work/unsigned NYX_FONTS_DIR=$work/fonts NYX_SIGNING_KEY=$work/none bash "$here/release.sh" --dry-run 2>&1 || true)
has "release: a dry run without the key warns" "$out" "not signed"
check "release: and writes no signature" "$([ -e "$work/unsigned/latest.json.sig" ] && echo yes || echo no)" "no"
for f in get.sh nyx-monitor-update index.html robots.txt; do
    check "release: the site serves $f" "$([ -s "$real/$f" ] && echo yes)" "yes"
done
rm -rf "$home"
env_run bash -c "NYX_UPDATE_URL=file://$real; curl -fsSL file://$real/get.sh | NYX_UPDATE_URL=file://$real bash" >/dev/null 2>&1
check "release: get.sh installs it" "$(target)" "$root/releases/$version/extension"
check "release: with its characters" "$([ -f "$root/releases/$version/extension/characters.json" ] && echo yes)" "yes"

# ---- a real publish: signed, from a clean main equal to origin/main, tagged (S2, S5) --------------
# A small project in its own git repo with a bare origin, so the publish rules run on a repo of their own.
proj=$work/proj
mkdir -p "$proj/extension" "$work/live" "$work/hsbin/scripts"
cp -r "$here/bin" "$here/release.sh" "$here/get.sh" "$proj/"
# Its updater pins the throwaway key, as a fork pins its own: a publish verifies against the updater it ships.
sed -i "s|^signer='.*'\$|signer='$(cat "$work/allowed_signers")'|" "$proj/bin/nyx-monitor-update"
mkdir -p "$proj/release"
cp -r "$here/release/notes" "$here/release/fonts" "$here/release/index.html" "$here/release/nginx.conf" "$here/release/Dockerfile" "$proj/release/"
printf '{"uuid": "nyx-monitor@majomaken", "version-name": "%s", "shell-version": ["50"]}\n' "$version" > "$proj/extension/metadata.json"
printf 'release/site/\n' > "$proj/.gitignore"
git -C "$proj" init -q -b main
git -C "$proj" -c user.name=t -c user.email=t@t add -A
git -C "$proj" -c user.name=t -c user.email=t@t commit -qm one
git clone -q --bare "$proj" "$work/origin.git"
git -C "$proj" remote add origin "$work/origin.git"
git -C "$proj" fetch -q origin
git -C "$proj" branch -q -u origin/main
printf '#!/usr/bin/env bash\necho "$*" >> "%s/hs-deploy.log"\n' "$work" > "$work/hsbin/scripts/hs-deploy.sh"
chmod +x "$work/hsbin/scripts/hs-deploy.sh"
publish() { NYX_RELEASE_SITE=$work/pub NYX_FONTS_DIR=$work/fonts NYX_LIVE_URL=file://$work/live \
    HS_DEPLOY_SKILL=$work/hsbin NYX_SIGNING_KEY=${key:-$work/key} NYX_ALLOWED_SIGNERS=${signers:-} \
    bash "$proj/release.sh" 2>&1; }
refuses() { # refuses <name> <words>: the publish fails with those words and deploys nothing
    local out rc
    if out=$(publish); then rc=0; else rc=$?; fi
    check "release: $1 is refused" "$rc" "1"
    has "release: $1, and it says why" "$out" "$2"
    check "release: $1, nothing deployed" "$([ -f "$work/hs-deploy.log" ] && echo deployed || echo none)" "none"
}
deployed() { [ -f "$work/hs-deploy.log" ] && echo deployed || echo none; }
printf '{"version": "%s", "sha256": "0000"}\n' "$version" > "$work/live/latest.json"
refuses "the same version with other contents" "already serves"
printf '{"version": "0.9", "sha256": "0000"}\n' > "$work/live/latest.json"
key=$work/none refuses "a publish without the signing key" "signing key"
key=$work/other refuses "a publish signed by a key the updater does not pin" "does not verify"
echo "nyx-monitor-release namespaces=\"nyx-monitor\" $(cat "$work/other.pub")" > "$work/other_signers"
key=$work/other signers=$work/other_signers refuses "a key that only NYX_ALLOWED_SIGNERS trusts" "does not verify"
echo stray > "$proj/extension/stray.txt"
refuses "an untracked file" "local changes"
rm "$proj/extension/stray.txt"
git -C "$proj" checkout -q -b feature
refuses "a branch other than main" "from main"
git -C "$proj" checkout -q main
git -C "$proj" -c user.name=t -c user.email=t@t commit -q --allow-empty -m two
refuses "main ahead of origin/main" "origin/main"
git -C "$proj" push -q origin main
# A link would ship what it points to: a merged pull request could point one at the release key.
ln -s "$work/key" "$proj/extension/leak"
if out=$(NYX_RELEASE_SITE=$work/dry NYX_FONTS_DIR=$work/fonts NYX_SIGNING_KEY=$work/key \
    bash "$proj/release.sh" --dry-run 2>&1); then rc=0; else rc=$?; fi
check "release: a dry run with a symbolic link is refused" "$rc" "1"
has "release: a dry run with a symbolic link, and it says why" "$out" "symbolic link"
git -C "$proj" add extension/leak
git -C "$proj" -c user.name=t -c user.email=t@t commit -qm link
git -C "$proj" push -q origin main
refuses "a tracked symbolic link" "symbolic link"
check "release: no tarball holds the key a link points to" \
    "$(tar -xzOf "$work/pub/releases/nyx-monitor-$version.tar.gz" 2>/dev/null | grep -c 'OPENSSH PRIVATE KEY' || true)" "0"
git -C "$proj" rm -q extension/leak
git -C "$proj" -c user.name=t -c user.email=t@t commit -qm unlink
git -C "$proj" push -q origin main
# The same holds for every other file the build reads: the font license, the notes, get.sh, the index page.
ln -sf "$work/key" "$proj/release/fonts/LICENSE.txt"
git -C "$proj" add release/fonts/LICENSE.txt
git -C "$proj" -c user.name=t -c user.email=t@t commit -qm license-link
git -C "$proj" push -q origin main
refuses "a tracked link outside extension/ and bin/" "symbolic link"
git -C "$proj" checkout -q HEAD~1 -- release/fonts/LICENSE.txt
git -C "$proj" -c user.name=t -c user.email=t@t commit -qm license-file
git -C "$proj" push -q origin main
# A submodule could carry links of its own once initialized: refused as well.
git -C "$proj" update-index --add --cacheinfo "160000,$(git -C "$proj" rev-parse HEAD),release/sub"
git -C "$proj" -c user.name=t -c user.email=t@t commit -qm submodule
git -C "$proj" push -q origin main
refuses "a tracked submodule" "submodule"
git -C "$proj" rm -q --cached release/sub
git -C "$proj" -c user.name=t -c user.email=t@t commit -qm no-submodule
git -C "$proj" push -q origin main
for f in "release/notes/$version.txt" get.sh release/index.html; do
    ln -sf "$work/key" "$proj/$f"
    if out=$(NYX_RELEASE_SITE=$work/dry NYX_FONTS_DIR=$work/fonts NYX_SIGNING_KEY=$work/key \
        bash "$proj/release.sh" --dry-run 2>&1); then rc=0; else rc=$?; fi
    check "release: a dry run with $f as a link is refused" "$rc" "1"
    git -C "$proj" checkout -q -- "$f"
done
# A name outside ASCII still ships (git quotes such names unless asked not to).
echo hola > "$proj/extension/canción.txt"
NYX_RELEASE_SITE=$work/dry NYX_FONTS_DIR=$work/fonts NYX_SIGNING_KEY=$work/key bash "$proj/release.sh" --dry-run >/dev/null 2>&1 || true
has "release: a file named outside ASCII is inside" "$(tar -tzf "$work/dry/releases/nyx-monitor-$version.tar.gz" 2>/dev/null)" \
    "extension/canción.txt"
rm "$proj/extension/canción.txt"
publish >/dev/null || true
has "release: a clean main equal to origin/main deploys release/ as nyx-monitor at nyx" "$(cat "$work/hs-deploy.log" 2>/dev/null)" \
    "--path $proj/release --slug nyx-monitor --subdomain nyx"
check "release: it tags the commit it shipped in origin" "$(git -C "$work/origin.git" rev-parse -q --verify "refs/tags/v$version^{commit}")" \
    "$(git -C "$proj" rev-parse HEAD)"
check "release: the tarball holds no file outside the commit" "$(tar -tzf "$work/pub/releases/nyx-monitor-$version.tar.gz" | grep -c stray || true)" "0"
rm -f "$work/hs-deploy.log"
git -C "$proj" -c user.name=t -c user.email=t@t commit -q --allow-empty -m three
git -C "$proj" push -q origin main
refuses "the same version from another commit" "tag v$version"
git -C "$proj" tag -d "v$version" >/dev/null
git -C "$proj" -c user.name=t -c user.email=t@t tag -a -m old "v$version" "$(git -C "$proj" rev-list --max-parents=0 HEAD)"
git -C "$proj" push -q -f origin "refs/tags/v$version"
refuses "the same version with an annotated tag on another commit" "tag v$version"

exit $fail
