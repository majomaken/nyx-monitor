#!/usr/bin/env bash
# Renders nyx-monitor in a throwaway headless GNOME Shell and saves screenshots, so the extension
# can be seen without logging out. The shell gets its own D-Bus, its own XDG folders (the real
# dconf and extensions are never touched) and a 3440x1440 virtual monitor like the ultrawide.
# It runs in unsafe mode only so the script may call Eval and Screenshot on that private bus.
#
# Host only: it runs the gnome-shell binary, which no container provides.
#   tests/headless.sh [out_dir] [variant ...]   defaults: <repo>/local/nyx-monitor-shots, every variant
#   NYX_CHARACTER=okane tests/headless.sh [out_dir] [look ...]   another character (a key of extension/characters.json):
#   every look of her pack (default) with each of its poses and resting poses, its clips playing, the money moment,
#   a meeting (no resting pose), sleep, and a live switch to Nyx and back; shots named <character>-<look>-<state>.png.
#   Then the settings of round 2 on her first look: a fixed pose, the pin
#   reachable over her, the card's name and the stat skins (shots <character>-r2-*.png). NYX_SETTINGS_ONLY=1 runs
#   only those, on the first look given.
# For each variant it forces the states through Eval (full mode, a moment, the faces and poses of the
# looks that have them, the resting, music and meeting poses, the click reactions, the hair swing and the jump,
# the double-click flip, a pat, a drag and its drop, a notification, the heat, the music nod, sleep and waking up),
# saves <variant>-<state>.png, a crop of the gadget's corner of each in crops/, and shell.log (the shell's
# stderr, where JS errors land). After the demo and the schedule checks it walks the beach mode (beach-*.png). At the end a fake music player (tests/fake-mpris.py) and a real mic
# recording (pw-record, a few seconds into /dev/null) check the detection end to end.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-$here/local/nyx-monitor-shots}
shift || true
character=${NYX_CHARACTER:-nyx}
if [ "$character" = nyx ]; then
    variants=${*:-hips hips-eve hips-2b hips-zelda full-chibi full-eve full-2b full-zelda lying-chibi}
else
    pack_dir=$(jq -r --arg c "$character" '.[$c].dir // empty' "$here/extension/characters.json")
    [ -n "$pack_dir" ] || { echo "no character '$character' in extension/characters.json" >&2; exit 2; }
    variants=${*:-$(jq -r '.variants | keys_unsorted | join(" ")' "$here/extension/$pack_dir/variants.json")}
fi
mkdir -p "$out"
out=$(cd "$out" && pwd)
rm -f "$out"/*.png
wallpaper=$(gsettings get org.gnome.desktop.background picture-uri-dark 2>/dev/null || echo "''")

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export XDG_CONFIG_HOME=$tmp/config XDG_DATA_HOME=$tmp/data XDG_CACHE_HOME=$tmp/cache XDG_STATE_HOME=$tmp/state
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions"
# The private session shares the real XDG_RUNTIME_DIR (the Wayland socket and PipeWire live there). A document
# portal or gvfs started on its bus mounts over the real session's $XDG_RUNTIME_DIR/doc or gvfs and unmounts it
# on exit, and then no Flatpak app starts (2026-11-09, Zoom, Telegram and Spotify). These service files shadow
# the system ones on the private bus, which looks in $XDG_DATA_HOME first.
mkdir -p "$XDG_DATA_HOME/dbus-1/services"
for name in org.freedesktop.portal.Documents org.gtk.vfs.Daemon; do
    printf '[D-BUS Service]\nName=%s\nExec=/bin/false\n' "$name" > "$XDG_DATA_HOME/dbus-1/services/$name.service"
done
runtime=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
real_mounts() { findmnt -rn -o TARGET,FSTYPE | grep "^$runtime/" | sort; }
mounts_before=$(real_mounts)
glib-compile-schemas "$here/extension/schemas"
ln -s "$here/extension" "$XDG_DATA_HOME/gnome-shell/extensions/nyx-monitor@majomaken"
# The icons come from MesloLGS NF, installed per user; fontconfig looks for it under XDG_DATA_HOME.
[ -d "$HOME/.local/share/fonts" ] && ln -s "$HOME/.local/share/fonts" "$XDG_DATA_HOME/fonts"

inner() {
    set -euo pipefail
    nyx_set() { GSETTINGS_SCHEMA_DIR=$NYX_HERE/extension/schemas gsettings set org.gnome.shell.extensions.nyx-monitor "$@"; }
    gsettings set org.gnome.shell enabled-extensions "['nyx-monitor@majomaken']"
    gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
    gsettings set org.gnome.desktop.interface color-scheme 'prefer-dark'
    gsettings set org.gnome.desktop.background picture-uri-dark "$NYX_WALLPAPER"
    gsettings set org.gnome.desktop.background picture-uri "$NYX_WALLPAPER"
    set -- $NYX_VARIANTS
    nyx_set character "$NYX_CHARACTER"
    # Another character's run forces every moment it shows: none comes on its own between a forced pose and its shot.
    [ "$NYX_CHARACTER" = nyx ] || nyx_set animation-minutes 0
    nyx_set schedule "[]" # each shot shows the variant it names; the schedule gets its own check at the end
    nyx_set rest-minutes 0  # her usual look at any hour; the resting poses are forced below
    nyx_set variant "$1"

    gnome-shell --headless --wayland --no-x11 --unsafe-mode --wayland-display "nyx-test-$$" \
        --virtual-monitor 3440x1440 >"$NYX_OUT/shell.log" 2>&1 &
    local pid=$!
    gdbus wait --session --timeout 40 org.gnome.Shell.Screenshot
    sleep 8 # extension enabled, two samples taken

    local failed=0
    N="Main.extensionManager.lookup('nyx-monitor@majomaken').stateObj"
    ev() {
        local r
        r=$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Eval "const n = $N; $1; 'ok'" 2>&1) || true
        case $r in "(true,"*) ;; *) echo "Eval failed: $1 -> $r" >&2; failed=$((failed + 1)) ;; esac
    }
    # The value of a JS expression about the gadget, as Eval prints it ('true', a number, a JSON-quoted string).
    ev_value() {
        gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
            --method org.gnome.Shell.Eval "const n = $N; $1" 2>/dev/null | sed -n "s/^(true, '\(.*\)')\$/\1/p"
    }
    shot() { gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.Screenshot false false "$NYX_OUT/$1.png" >/dev/null; }
    # Take one real sample, then stop the samples and the idle clock from undoing a forced state
    # between Eval and shot.
    freeze() { ev "delete n._sample; n._sample(); n._sample = () => {}; n._checkSleep = () => {}"; }
    # Waits up to 30 s until a JS expression about the gadget is true (fixed sleeps drift with load).
    wait_for() {
        local i r
        for i in $(seq 300); do
            r=$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
                --method org.gnome.Shell.Eval "const n = $N; Boolean($1)" 2>&1) || true
            [ "$r" = "(true, 'true')" ] && return 0
            sleep 0.1
        done
        echo "timed out waiting for: $1" >&2
        failed=$((failed + 1))
    }
    # The value of a JS expression about the gadget, as text.
    val() {
        gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \
            "const n = $N; String($1)" 2>/dev/null | sed -E "s/^\(true, '(.*)'\)$/\1/" | jq -r .
    }
    # True when the reactive actor at the centre of `actor` (a JS expression) is that actor or inside it: nothing
    # reactive covers it, so a click there reaches it.
    reachable() {
        val "(() => { const a = $1; const [x, y] = a.get_transformed_position(); const [w, h] = a.get_transformed_size();
            const hit = global.stage.get_actor_at_pos(1, Math.round(x + w / 2), Math.round(y + h / 2));
            return hit === a || a.contains(hit); })()"
    }
    # Only the look she rests in shows, its crossfade done (a fade takes a few frames, slower headless).
    SETTLED="n._look.group.opacity === 255 && n._looks.every(l => l === n._look || !l.group.visible || !l.group.opacity)"
    # Round 2 (S12 to S15), on the look shown, in full colour.
    settings_run() {
        local c=$NYX_CHARACTER look=$1
        # No nap from the idle clock (a slow run passes its minutes) and no context from the 10 s watch: this private
        # session shares the real PipeWire, so a call on the desktop would put her in her meeting pose.
        ev "delete n._restPick; n._checkSleep = () => {}; n._watch = async () => {}; n._ctx = {context: null, next: null, seen: 0}; n._settleHome()"
        # S12: a fixed pose stays, comes back after a moment, and holds the look against the change of form.
        local pose
        pose=$(val "n._restKeys[n._restKeys.length - 1] ?? ''")
        nyx_set pose "'$pose'"
        nyx_set pose-auto false
        wait_for "n._running === 0 && n._look === (n._rests[n._restKeys.indexOf('$pose')] ?? n._base) && $SETTLED"
        shot "$c-r2-pose-fixed"
        ev "n._moment({move: 'hop', pose: n._poses.cheer ? 'cheer' : undefined})"
        wait_for "n._running !== 0"
        wait_for "n._running === 0 && n._look === (n._rests[n._restKeys.indexOf('$pose')] ?? n._base)"
        ev "n._rotate()"
        sleep 1.2
        ev "if (n._shown !== '$look') throw new Error('a fixed pose let the look change to ' + n._shown)"
        nyx_set pose "''"
        wait_for "n._look === n._base"
        # S13: the pin takes the click even with her widest resting pose in front of the card.
        local wide
        wide=$(val "n._restKeys.length ? n._restKeys.reduce((a, k, i) => n._rests[i].w > n._rests[n._restKeys.indexOf(a)].w ? k : a) : ''")
        [ -n "$wide" ] && nyx_set pose "'$wide'"
        wait_for "n._running === 0 && n._look === (n._rests[n._restKeys.indexOf('$wide')] ?? n._base) && $SETTLED"
        [ "$(val "n._full")" = true ] || ev "n._toggleFull()"
        sleep 0.45
        shot "$c-r2-pin"
        [ "$(reachable n._pin)" = true ] || { echo "the pin is covered (pose $wide)" >&2; failed=$((failed + 1)); }
        [ "$(reachable n._gearBtn)" = true ] || { echo "the gear is covered (pose $wide)" >&2; failed=$((failed + 1)); }
        nyx_set pose "''"
        nyx_set pose-auto true
        wait_for "n._look === n._base && $SETTLED"
        # S14: the PC's name changes live, her name kept, without a rebuild.
        ev "n._r2root = n._root"
        nyx_set pc-name "'MAJO PC'"
        wait_for "n._title.text === n._pack.name.toUpperCase() + ' · MAJO PC'"
        ev "if (n._root !== n._r2root) throw new Error('a new name rebuilt the card')"
        shot "$c-r2-name"
        nyx_set pc-name "'SUPER PC'"
        wait_for "n._title.text === n._pack.name.toUpperCase() + ' · SUPER PC'"
        # S15: each style in a palette of its own, sampled for real (the look loop's freeze stubs the sample).
        local style palette label
        while read -r style palette label; do
            nyx_set stats-style "'$style'"
            nyx_set stats-colors "'$palette'"
            wait_for "n._root && n._style === '$style' && n._palette.label === '$label'"
            ev "delete n._sample; n._sample()"
            wait_for "n._rows.cpu.color && n._rows.ram.value.text !== '..'"
            ev "if (Object.keys(n._rows).join() !== 'cpu,ram,gpu') throw new Error('rows: ' + Object.keys(n._rows))"
            sleep 0.5
            shot "$c-r2-style-$style-$palette"
        done <<'STYLES'
bars neon Neón
blocks gold Oro
rings ocean Océano
numbers sunset Atardecer
STYLES
        nyx_set stats-style "'bars'"
        nyx_set stats-colors "'lavender'"
        wait_for "n._root && n._style === 'bars' && n._palette.label === 'Lavanda'"
    }
    # Another character's pack: every look with its poses, rests and clips.
    pack_run() {
        local c=$NYX_CHARACTER v p i
        ev "if (n._pack.key !== '$c' || n._title.text !== n._titleText()) throw new Error('the pack on screen is ' + n._pack.key)"
        shot "$c-$1-idle"
        ev "if (n._gearBtn.visible) throw new Error('the gear shows in idle mode')"
        ev "n._toggleFull()"
        sleep 0.45
        ev "if (!n._gearBtn.visible) throw new Error('no gear in full colour')"
        shot "$c-$1-full-greet"
        wait_for "n._running === 0"
        local first=$1
        [ -z "${NYX_SETTINGS_ONLY:-}" ] || set --
        for v in "$@"; do
            nyx_set variant "$v"
            wait_for "n._shown === '$v' && n._root"
            sleep 1.5
            freeze
            shot "$c-$v-full"
            for p in $(val "Object.keys(n._poses).join(' ')"); do
                # Held like a moment holds it, or the 10 s watch settles her back home between the pose and its shot.
                ev "n._running = ++n._token; n._show(n._poses['$p'], n._gen)"
                wait_for "n._look === n._poses['$p'] && (!n._clipLoops(n._look) || (n._look.clip.shown && n._look.clip.index >= 12))"
                sleep 0.4 # the crossfade
                shot "$c-$v-pose-$p"
            done
            reset
            for i in $(seq 0 $(( $(val "n._rests.length") - 1 ))); do
                ev "n._restPick = () => $i; n._settleHome()"
                wait_for "n._look === n._rests[$i]"
                sleep 0.6
                shot "$c-$v-rest-$i"
            done
            # A meeting: never a resting pose (the screen may be shared), no bubble.
            ev "n._restPick = () => 0; n._ctx = {context: 'meeting', next: 'meeting', seen: 0}; n._settleHome(); n._say('cheer')"
            sleep 0.9
            ev "if (n._rests.includes(n._look) || n._look !== (n._poses.meeting ?? n._base)) throw new Error('a resting pose in a meeting')"
            ev "if (n._bubble.visible && n._bubble.opacity > 0) throw new Error('a phrase showed in a meeting')"
            shot "$c-$v-meeting"
            ev "delete n._restPick; n._restPick = () => -1; n._ctx = {context: null, next: null, seen: 0}; n._settleHome()"
            wait_for "n._look === n._base && n._running === 0"
            # Her greeting: the wave clip when the look has one.
            if [ "$(val "Boolean(n._base.clip?.spec.once)")" = true ]; then
                ev "n._play(n._greeting())"
                wait_for "n._base.clip.shown && n._base.clip.index >= 12"
                shot "$c-$v-clip-wave"
                wait_for "!n._base.clip.shown && n._running === 0"
            fi
            if [ "$(val "Boolean(n._poses.money)")" = true ]; then
                ev "n._moment({move: 'hop', pose: 'money', phrases: 'money'})"
                wait_for "n._look === n._poses.money && n._bubble.visible"
                ev "if (!n._phrases.money.includes(n._bubble.text)) throw new Error('not her money line: ' + n._bubble.text)"
                sleep 1.2
                shot "$c-$v-moment-money"
                reset
            fi
            ev "n._moment({move: n._greeting(), phrases: 'duck'})"
            sleep 0.6
            ev "if (n._bubble.visible && n._bubble.opacity > 0) throw new Error('a line she does not have: ' + n._bubble.text)"
            reset
            ev "n._fallAsleep()"
            sleep 1.2
            shot "$c-$v-sleep"
            ev "if (n._poses.sleep && n._look !== n._poses.sleep) throw new Error('she does not nap in her sleep pose')"
            ev "n._wakeUp(true)"
            wait_for "!n._sleeping && n._look === n._base"
            ev "delete n._restPick"
        done
        nyx_set variant "$first"
        wait_for "n._shown === '$first' && n._root && n._running === 0"
        settings_run "$first"
        # A clip loads from the folder of the character its look was drawn for: on a switch the new pack loads first
        # and the old looks stay on screen for the fade out, so one may start its clip then (the meeting pose did,
        # 2026-11-24 in the devkit: «okane-clip-meeting.png … assets/… No such file»).
        # A pack of stills only (the NIKKE ones) has no clip to load: nothing to check.
        if [ "$(ev_value "Object.values(n._poses).some(l => l.clip && !l.clip.spec.once)")" = true ]; then
            ev "n._r2clip = Object.values(n._poses).find(l => l.clip && !l.clip.spec.once); n._clipRelease(n._r2clip, null); n._r2clip.clip.failed = false; n._r2pack = n._pack; n._pack = {...n._pack, dir: 'assets'}; n._clipLoad(n._r2clip)"
            wait_for "n._r2clip.clip.pixbuf || n._r2clip.clip.failed"
            ev "n._pack = n._r2pack; if (n._r2clip.clip.failed) throw new Error('a clip looked in another character folder')"
        fi
        # A live switch of character, as the settings window does it, and back.
        nyx_set character nyx
        wait_for "n._pack.key === 'nyx' && n._root && n._title.text === 'NYX · SUPER PC'"
        sleep 1.2
        shot "$c-switch-nyx"
        nyx_set character "$c"
        wait_for "n._pack.key === '$c' && n._root && n._title.text === n._titleText()"
        sleep 1.2
        shot "$c-switch-back"
    }
    # Ends a forced moment and goes back to her usual look.
    reset() { ev "n._running = 0; n._momentFace = null; n._reactFace = null; n._hideBubble(); n._show(n._base, n._gen); n._refreshFace()"; sleep 0.6; }

    wait_for "n && n._root" # a slow start (a service timing out on the private bus) outlasts the 8 s above
    sleep 4
    if [ "$NYX_CHARACTER" != nyx ]; then
        pack_run "$@"
        kill "$pid"
        wait "$pid" 2>/dev/null || true
        [ "$failed" -eq 0 ] || { echo "$failed Eval calls failed" >&2; return 1; }
        return 0
    fi
    shot "$1-idle"
    ev "n._toggleFull()"
    sleep 0.45
    shot "$1-full-greet"
    sleep 2.5
    for v in "$@"; do
        nyx_set variant "$v"
        sleep 1.5
        freeze
        shot "$v-full"
        # The floor shadow: under the standing feet of the full-body looks, none under the hips-up or lying ones.
        case $v in
        full-*) ev "const s = n._look.shadow; if (!s || !s.visible || s.opacity < 200) throw new Error('no shadow under her feet')" ;;
        *) ev "if (n._look.shadow) throw new Error('a shadow on a look whose feet do not show')" ;;
        esac
        ev "n._moment({move: n._greeting(), phrases: 'cheer'})"
        sleep 0.55
        shot "$v-moment"
        reset
        # Every look has the faces; the hips looks also have the peek and duck poses.
        ev "n._moment({move: n._greeting(), face: 'stars', phrases: 'cheer'})"
        sleep 0.7
        shot "$v-moment-stars"
        reset
        case $v in hips*)
            ev "n._moment({move: 'hop', pose: 'peek', phrases: 'peek'})"
            sleep 0.9
            shot "$v-moment-peek"
            reset
            ev "n._moment({move: 'sway', pose: 'duck', phrases: 'duck'})"
            sleep 0.9
            shot "$v-moment-duck"
            reset ;;
        esac
        ev "n._moment({move: 'hop', face: 'determined', phrases: 'focus'})"
        sleep 0.9
        shot "$v-moment-determined"
        reset
        ev "n._history = []; n._react({cpu: 0.95, gpu: 0.2, ram: 0.4}); n._react({cpu: 0.9, gpu: 0.3, ram: 0.4})"
        sleep 0.5
        shot "$v-react-dizzy"
        reset
        ev "n._history = []; n._lastReactSay = 0; n._react({cpu: 0.1, gpu: 0.1, ram: 0.92})"
        sleep 0.5
        shot "$v-react-pout"
        reset
        for kind in outage failed restored; do  # the UPS on battery, a failed unit, the power back
            ev "n._worry('$kind')"
            sleep 0.9
            shot "$v-worry-$kind"
            reset
        done
        case $v in hips|hips-2b|hips-eve)
            # Each resting pose of the day, then the headphones (notes float) and the meeting's shh.
            local n_rest=3 i
            [ "$v" = hips-eve ] && n_rest=1
            for i in $(seq 0 $((n_rest - 1))); do
                ev "n._restPick = () => $i; n._settleHome()"
                sleep 0.9
                shot "$v-rest-$i"
            done
            ev "delete n._restPick; n._ctx = {context: 'music', next: 'music', seen: 0}; n._settleHome()"
            sleep 1.6
            shot "$v-music"
            ev "n._ctx = {context: 'meeting', next: 'meeting', seen: 0}; n._settleHome(); n._say('cheer')"
            sleep 0.9
            shot "$v-meeting"
            ev "if (n._bubble.visible && n._bubble.opacity > 0) throw new Error('a phrase showed in a meeting')"
            ev "n._ctx = {context: null, next: null, seen: 0}; n._settleHome()"
            sleep 0.6
            ev "if (n._look !== n._base) throw new Error('not back to her usual look')" ;;
        *)  # no headphones drawn: notes float over her usual look
            ev "n._ctx = {context: 'music', next: 'music', seen: 0}; n._settleHome()"
            sleep 1.2
            shot "$v-music-notes"
            ev "if (n._floatKind !== 'notes') throw new Error('no notes with music')"
            ev "n._ctx = {context: null, next: null, seen: 0}; n._settleHome()" ;;
        esac
        case $v in hips)  # the Wan clips: a resting pose loops, her usual look waves once
            ev "n._restPick = () => 0; n._settleHome()"  # rest-coffee, a clip with a gap
            wait_for "n._look === n._rests[0] && n._look.clip?.shown"
            ev "const l = n._look; if (l.body.opacity !== 0 || l.clip.actor.opacity !== 255) throw new Error('the still shows under the clip')"
            ev "if (n._breathId) throw new Error('a clip look breathes on top of its clip')"
            wait_for "n._look.clip.index >= 12"
            shot "$v-clip-coffee"
            ev "delete n._restPick; n._ctx = {context: 'music', next: 'music', seen: 0}; n._settleHome()"
            wait_for "n._look === n._poses.music && n._look.clip?.shown && n._look.clip.index > 0"
            shot "$v-clip-music"
            ev "const c = n._rests[0].clip; if (c.shown || c.id || c.contents.length || c.pixbuf) throw new Error('the coffee clip kept its frames')"
            ev "if (n._nod?.until === null) throw new Error('the music clip nods and the shader nods too')"
            ev "n._ctx = {context: null, next: null, seen: 0}; n._restPick = () => -1; n._settleHome()"
            wait_for "n._look === n._base && n._running === 0"
            ev "n._play('wave')"
            wait_for "n._base.clip.shown && n._base.clip.index >= 12"
            shot "$v-clip-wave"
            ev "if (n._base.hand.rotation_angle_z !== 0) throw new Error('the cut-out hand turns under the wave clip')"
            wait_for "!n._base.clip.shown && n._running === 0"
            ev "const l = n._base; if (l.body.opacity !== 255 || l.clip.actor.opacity !== 0 || l.clip.contents.length) throw new Error('the still did not come back after the wave')"
            ev "delete n._restPick; n._settleHome()" ;;
        esac
        case $v in hips-2b)  # 2B's look has no cut-out hand: her greeting is her wave clip (T7)
            ev "if (n._greeting() !== 'wave') throw new Error('hips-2b greets with ' + n._greeting())"
            ev "n._ctx = {context: null, next: null, seen: 0}; n._restPick = () => -1; n._settleHome()"
            wait_for "n._look === n._base && n._running === 0"
            ev "n._play(n._greeting())"
            wait_for "n._base.clip.shown && n._base.clip.index >= 12"
            shot "$v-clip-wave"
            wait_for "!n._base.clip.shown && n._running === 0"
            ev "const l = n._base; if (l.body.opacity !== 255 || l.clip.actor.opacity !== 0 || l.clip.contents.length) throw new Error('the still did not come back after the hips-2b wave')"
            ev "delete n._restPick; n._settleHome()" ;;
        esac
        case $v in hips|hips-eve|hips-2b|hips-zelda|full-*)  # the cheer, both frames
            ev "n._moment({move: 'cheer', pose: 'cheer', phrases: 'cheerleader'})"
            case $v in hips)  # the cheer clip reaches past the still, so the pom-poms are not cut (2026-11-07)
                wait_for "n._look === n._poses.cheer && n._look.clip?.shown && n._look.clip.index >= 3"
                ev "const l = n._poses.cheer, a = l.clip.actor; if (a.x >= 0 || a.x + a.width <= l.w || l.margin <= -a.x) throw new Error('the cheer clip is cut at the still: x ' + a.x + ' width ' + a.width + ' margin ' + l.margin)" ;;
            esac
            sleep 0.55
            shot "$v-cheer-a"
            sleep 0.24
            shot "$v-cheer-b"
            reset ;;
        esac
        # The hourly rotation, forced: the next form of this look fades in, then back to the chosen one.
        ev "n._rotate()"
        sleep 1.3
        shot "$v-rotated"
        ev "n._rotateStep = 0; n._rebuild()"
        sleep 0.8
        # Clicks in full mode: a poke at 3, a spin at 6, the launch at 10 (gone, then back).
        ev "n._tapStreak = 0; n._tapLast = null; for (let i = 0; i < 3; i++) n._tap()"
        sleep 0.6
        shot "$v-tap-poke"
        reset
        ev "n._tapStreak = 0; n._tapLast = null; for (let i = 0; i < 6; i++) n._tap()"
        sleep 0.4
        shot "$v-tap-spin"
        sleep 1.5
        reset
        ev "n._tapStreak = 0; n._tapLast = null; for (let i = 0; i < 10; i++) n._tap()"
        sleep 0.45
        shot "$v-tap-crouch"
        sleep 1.4
        shot "$v-tap-gone"
        sleep 3.0
        shot "$v-tap-back"
        reset
        # Her hair swings: a click puts the motion effect on her look and it goes once the swing has died away.
        # Held at its peak, out and in, for two shots; the effect draws past her edge (its offscreen is her look
        # plus its pad on each side, 8 px or as far as a turning hand reaches, plus the 3 px Clutter adds).
        wait_for "!n._launching"  # the launch above still holds the clicks until she has landed and waited
        ev "n._tapStreak = 0; n._tapLast = null; n._tap()"
        ev "if (!n._look.fx || n._look.group.get_effect('nyx-motion') !== n._look.fx) throw new Error('no swing on a click')"
        wait_for "!n._look.fx && !n._look.group.get_effect('nyx-motion')"
        sleep 0.5
        shot "$v-sway-rest"
        ev "n._kick(1); n._look.fxTl.stop(); n._look.fx.setMotion({sway: 7})"
        sleep 0.3
        shot "$v-sway-out"
        ev "const [ok, fw] = n._look.fx.get_target_size(); if (!ok || fw !== n._look.w + 2 * n._look.margin + 3) throw new Error('the swing is not drawn past her edge: ' + fw + ' for ' + n._look.w + ' and a margin of ' + n._look.margin)"
        ev "n._look.fx.setMotion({sway: -7})"
        sleep 0.3
        shot "$v-sway-in"
        ev "n._look.fxTl.start()"
        wait_for "!n._look.fx"
        # The double-click flip: two quick clicks, a full turn high in the air, then at rest.
        ev "n._tapStreak = 0; n._tapLast = null; n._tap(); n._tap()"
        sleep 0.42
        ev "const g = n._look.group; if (!n._running || g.translation_y > -20 || g.rotation_angle_z === 0) throw new Error('no flip on a double click: ' + g.translation_y + ' ' + g.rotation_angle_z)"
        shot "$v-flip-air"
        wait_for "!n._running"
        ev "const g = n._look.group; if (g.rotation_angle_z !== 0 || g.translation_y !== 0 || g.scale_x !== 1 || g.scale_y !== 1) throw new Error('the flip did not end at rest')"
        # A pat: the pointer strokes her head (fed to the hover handler as stage points, back and forth); her
        # eyes close and hearts float up; once the strokes stop she is at rest with her eyes open.
        local i
        for i in $(seq 12); do
            ev "const l = n._look, [x0, y0, x1, y1] = l.spec.head, [sx, sy] = l.group.get_transformed_position(); n._hover(l, sx + (x0 + (x1 - x0) * ($i % 2 ? 0.3 : 0.7)) * l.w, sy + (y0 + 0.4 * (y1 - y0)) * l.h)"
            sleep 0.1
        done
        shot "$v-pat"
        ev "if (!n._patting || !n._hearts.size || (n._look.blink && n._look.blink.opacity === 0)) throw new Error('no pat: ' + n._patting + ' ' + n._hearts.size)"
        wait_for "!n._patting && !n._running"
        sleep 0.5
        ev "const l = n._look; if (l.group.rotation_angle_z !== 0 || (l.blink && l.blink.opacity !== 0)) throw new Error('the pat did not end at rest')"
        # Picked up: she hangs from the spot held and swings as the pointer moves; let go, she drops to her spot
        # and lands. The button is reported held while the test moves her (no real pointer here).
        ev "n._buttonHeld = () => true; const l = n._look, [sx, sy] = l.group.get_transformed_position(); n._dragX = sx + l.w / 2; n._dragY = sy + l.h * 0.15; n._dragStart(n._dragX, n._dragY)"
        for i in 1 2 3 4 5 6 7 8; do
            ev "n._dragTo(n._dragX - $i * 28, n._dragY - $i * 10)"
            sleep 0.05
        done
        sleep 0.12
        ev "const g = n._look.group, s = n._drag?.swing; if (!n._dragging || !n._grab || g.translation_x > -150 || !s || Math.abs(s.angle) + Math.abs(s.vel) < 2 || Math.abs(g.rotation_angle_z - s.angle) > 0.01) throw new Error('not hanging and swinging: ' + g.translation_x + ' ' + JSON.stringify(s))"
        shot "$v-drag"
        ev "delete n._buttonHeld; n._release()"
        wait_for "!n._dragging && !n._running"
        ev "const g = n._look.group; if (n._grab || g.rotation_angle_z !== 0 || g.translation_x !== 0 || g.translation_y !== 0 || g.scale_y !== 1) throw new Error('the drop did not end at rest')"
        # A grab lost (the button found up on a frame) drops her too.
        ev "const l = n._look, [sx, sy] = l.group.get_transformed_position(); n._dragStart(sx + l.w / 2, sy + 20, sx + l.w / 2 - 40, sy - 30)"
        wait_for "!n._dragging && !n._running && !n._grab"
        ev "const g = n._look.group; if (g.translation_x !== 0 || g.translation_y !== 0) throw new Error('a lost grab left her mid-air')"
        # A notification: a «!» pops over her head and she hops.
        ev "n._lastAlert = null; Main.notify('Prueba', 'Nyx mira')"
        sleep 0.3
        ev "if (!n._alertLabel.visible || n._alertLabel.opacity === 0) throw new Error('no «!» on a notification')"
        shot "$v-alert"
        sleep 1.9
        # Hot: a sweat drop on every look, the sweater, 2B and Eve fan themselves; cooled down, back to her usual look.
        ev "n._heat = {hot: true, seen: 0}; n._setHot(true)"
        sleep 1.0
        shot "$v-heat"
        ev "if (!n._sweat || !n._sweatId || n._sweat.get_parent() !== n._look.group) throw new Error('no sweat drop')"
        # With a fan clip (the sweater's) the clip fans and the cut-out hand stays still; without one the hand swings.
        case $v in hips|hips-2b|hips-eve) ev "const l = n._look; if (l !== n._poses.hot || (n._clipLoops(l) ? n._fanId : !n._fanId)) throw new Error('$v does not fan herself, or fans twice')" ;; esac
        ev "n._heat = {hot: false, seen: 0}; n._setHot(false)"
        sleep 0.6
        ev "if (n._sweatId || n._fanId || n._look !== n._home()) throw new Error('still hot after cooling down')"
        # Music: her head nods through the motion effect (held at the bottom of a beat for the shot); it goes
        # once the music stops.
        ev "n._ctx = {context: 'music', next: 'music', seen: 0}; n._settleHome()"
        sleep 0.9
        # A music pose with a clip (the sweater's) nods in the clip, so the shader's nod stays off there.
        ev "if (n._clipLoops(n._look) ? n._nod?.until === null : (!n._look.fx || !n._look.fxTl || !n._nod || n._nod.until !== null)) throw new Error('no nod with music, or two')"
        ev "if (!n._clipLoops(n._look)) { n._look.fxTl.stop(); n._look.fx.setMotion({nod: [1, 3]}); }"
        sleep 0.2
        shot "$v-nod"
        ev "if (!n._clipLoops(n._look)) n._look.fxTl.start(); n._ctx = {context: null, next: null, seen: 0}; n._settleHome()"
        wait_for "!n._look.fx && n._look === n._home()"
        # The bigger jump: stretched on the way up, squashed on landing, at rest at the end.
        ev "n._moment({move: 'hop', phrases: 'cheer'})"
        sleep 0.3
        shot "$v-jump-up"
        sleep 0.25
        shot "$v-jump-land"
        sleep 1.4
        ev "const g = n._look.group; if (g.scale_x !== 1 || g.scale_y !== 1 || g.translation_y !== 0) throw new Error('the jump did not end at rest')"
        wait_for "!n._look.sway"
        reset
        ev "n._fallAsleep()"
        sleep 1.8
        shot "$v-sleep"
        ev "n._wakeUp()"
        sleep 0.7
        shot "$v-wake"
        sleep 1.5
        reset
    done
    ev "n._toggleFull()"
    ev "n._fallAsleep()"
    sleep 1.8
    shot "$v-sleep-idle"
    # The demo tour, sped up to 1.3 s a step: every look, then every animation; at the end the key
    # turns itself off and her look and mode come back.
    nyx_get() { GSETTINGS_SCHEMA_DIR=$NYX_HERE/extension/schemas gsettings get org.gnome.shell.extensions.nyx-monitor "$@"; }
    local before
    before=$(nyx_get variant)
    ev "n._watch()"  # one real check of the UPS and the failed units (errors land in shell.log)
    ev "n._demoStepMs = 1300"
    nyx_set demo true
    wait_for "n._demoVariant === Object.keys(n._manifest.variants)[2]"
    sleep 0.6
    shot "demo-look3"
    wait_for "n._demoNow === 'cheer'"
    sleep 0.55
    shot "demo-cheer"
    wait_for "n._demoVariant === 'full-eve' && n._demoNow === 'cheer'"
    sleep 0.55
    shot "demo-cheer-full"
    wait_for "n._demoNow === 'outage'"
    sleep 0.9
    shot "demo-outage"
    wait_for "n._demoNow === 'flip'"
    sleep 0.42
    shot "demo-flip"
    wait_for "n._demoNow === 'pat'"
    sleep 0.8
    shot "demo-pat"
    wait_for "n._demoNow === 'alert'"
    sleep 0.3
    shot "demo-alert"
    wait_for "n._demoNow === 'heat'"
    sleep 0.6
    ev "if (!n._sweatId || n._look !== (n._poses.hot ?? n._base)) throw new Error('no heat in the demo')"
    shot "demo-heat"
    wait_for "n._demoNow === 'launch'"
    sleep 0.45
    shot "demo-launch"
    wait_for "n._demoNow === 'sleep'"
    sleep 1.0
    shot "demo-sleep"
    wait_for "!n._demoOn"
    sleep 0.8
    shot "demo-end"
    [ "$(nyx_get demo)" = false ] || { echo "demo key still on after the tour" >&2; failed=$((failed + 1)); }
    [ "$(nyx_get variant)" = "$before" ] || { echo "demo changed the variant" >&2; failed=$((failed + 1)); }
    ev "if (n._demoOn || n._full || n._demoVariant || n._heatDemo || n._sweatId) throw new Error('demo left state behind')"
    # The schedule: an all-day slot shows its look at once; a variant chosen by hand holds over it for
    # the rest of that slot, also when the clock check runs.
    nyx_set schedule "['0=hips-zelda']"
    wait_for "n._shown === 'hips-zelda' && n._handPicked === null"
    sleep 0.6
    shot "schedule"
    local hand=full-eve
    [ "$before" = "'full-eve'" ] && hand=hips
    nyx_set variant "$hand"
    wait_for "n._shown === '$hand' && n._handPicked === 0"
    ev "n._rotate()"
    sleep 0.5
    ev "if (n._shown !== '$hand' || !n._rotateId) throw new Error('the clock check dropped a look chosen by hand')"
    nyx_set schedule "[]"
    wait_for "n._shown === '$hand' && n._handPicked === null"
    # The beach mode: the parasol shows in full colour only; a click puts on the swimsuits and the series
    # walks its twelve poses (two of them on the wide card), with no moments meanwhile; a second click
    # brings her look back.
    ev "if (n._beachBtn.visible) throw new Error('the parasol shows in idle mode')"
    ev "n._toggleFull()"
    sleep 0.5
    ev "if (!n._beachBtn.visible) throw new Error('no parasol in full colour')"
    shot "beach-parasol"
    ev "n._beachBtn.emit('clicked', 1)"
    wait_for "n._shown === 'beach' && n._look === n._base"
    sleep 0.9
    shot "beach-00"
    ev "if (n._animId) throw new Error('moments are scheduled in the beach mode')"
    ev "if (!n._beachBtn.has_style_class_name('nyx-beach-on')) throw new Error('the parasol is not lit')"
    # The breeze: a gust is due every 6 to 14 s; a forced one blows her hair and sarong (held at its peak for
    # the shot) and the effect goes once it has died down.
    ev "if (!n._breezeId) throw new Error('no breeze in the beach mode')"
    ev "n._gust(n._look)"
    ev "if (!n._look.fx || !n._look.gust) throw new Error('no gust on her look')"
    ev "n._look.fxTl.stop(); n._look.fx.setMotion({wind: [-5, -1.5]})"
    sleep 0.3
    shot "beach-breeze"
    ev "n._look.fxTl.start()"
    wait_for "!n._look.fx"
    local step
    for step in 01 02 03 04 05 06 07 08 09 10 11; do
        ev "n._beachNext()"
        sleep 1.3
        shot "beach-$step"
    done
    ev "if (n._shown !== 'beach' || n._look !== n._rests[n._rests.length - 1]) throw new Error('the series did not end on its last pose')"
    ev "n._beachNext()"
    wait_for "n._shown === 'beach' && n._look === n._base"
    ev "n._beachBtn.emit('clicked', 1)"
    wait_for "!n._beachOn() && n._manifest.variants[n._shown]"
    sleep 0.9
    shot "beach-off"
    ev "if (n._breezeId) throw new Error('the breeze outlived the beach mode')"
    ev "n._toggleFull()"
    # Detection end to end, on the sweater: a player on this bus reporting Playing puts the headphones on
    # within two checks; an app recording the mic (the real one, through PipeWire) makes it a meeting.
    nyx_set variant hips
    wait_for "n._shown === 'hips'"
    python3 "$NYX_HERE/tests/fake-mpris.py" & local player=$!
    wait_for "n._ctx.context === 'music' && n._look === n._poses.music"
    sleep 1.2
    shot "live-music"
    kill "$player"
    wait_for "n._ctx.context === null && n._look === n._base"
    if command -v pw-record >/dev/null; then
        timeout 40 pw-record /dev/null & local rec=$!
        wait_for "n._ctx.context === 'meeting' && n._look === n._poses.meeting"
        sleep 0.6 # the crossfade
        shot "live-meeting"
        kill "$rec" 2>/dev/null || true
        wait_for "n._ctx.context === null"
    fi
    kill "$pid"
    wait "$pid" 2>/dev/null || true
    [ "$failed" -eq 0 ] || { echo "$failed Eval calls failed" >&2; return 1; }
}

export NYX_OUT=$out NYX_VARIANTS=$variants NYX_HERE=$here NYX_WALLPAPER=$wallpaper NYX_CHARACTER=$character
status=0
dbus-run-session -- bash -c "$(declare -f inner); inner" || status=$?

# The real session's FUSE mounts must come out of the run as they went in.
if [ "$(real_mounts)" != "$mounts_before" ]; then
    echo "the run changed the real session's mounts under $runtime:" >&2
    diff <(echo "$mounts_before") <(real_mounts) >&2 || true
    if ! findmnt "$runtime/doc" >/dev/null && grep -q " fuse.portal$" <<<"$mounts_before"; then
        systemctl --user restart xdg-document-portal.service && echo "restarted xdg-document-portal" >&2
    fi
    status=1
fi

# One crop per shot at full size (the gadget's corner, bubble and zzz included) in crops/, to look at
# each state in detail.
python3 - "$out" <<'EOF' || echo "no crops (python3 with Pillow needed)"
import glob, os, sys
from PIL import Image
out = sys.argv[1]
crops = os.path.join(out, "crops")
os.makedirs(crops, exist_ok=True)
for old in glob.glob(os.path.join(crops, "*.png")):
    os.remove(old)
shots = glob.glob(os.path.join(out, "*.png"))
for p in shots:
    im = Image.open(p)
    im.crop((im.width - 700, im.height - 760, im.width, im.height)).save(os.path.join(crops, os.path.basename(p)))
print("crops/:", len(shots), "images")
EOF
grep -i -E "nyx|JS ERROR|Extension .* had error" "$out/shell.log" || echo "no errors from nyx-monitor in shell.log"
exit "$status"
