# nyx-monitor

A desktop gadget for GNOME Shell 50 (Wayland): Nyx, the spirit of the Super PC, beside a glass card with three
numbers: CPU busy %, RAM used and GPU busy %. It sits on top of every window at the bottom-right corner of the
screen right below the primary one when there is one, else of the primary monitor, and it moves by itself when
screens come and go. Other characters can take her place, grouped in categories, and a gear on the card opens its
settings.

Free software under the GNU General Public License, version 2 or (at your option) any later version (`LICENSE`).
The art and the fonts keep their own terms (`NOTICE`). Contributions are welcome: see `CONTRIBUTING.md`, and
`SECURITY.md` to report a vulnerability.

## Install

GNOME 50 on Wayland. One line downloads the updater from the release channel and installs the latest release:

```bash
curl --proto '=https' -fsSL https://nyx.majomaken.dev/get.sh | bash
```

Then log out and back in. Updates come from the gear's «Actualizaciones» page or the command line:

```bash
nyx-monitor-update check     # is there a newer version? (--json for the settings window, --notify for the timer)
nyx-monitor-update install   # download, verify and switch to it
nyx-monitor-update rollback  # back to the previous release
nyx-monitor-update status
```

How an update is trusted:

- The channel is https only: the updater and `get.sh` refuse any other URL, and curl may not follow a redirect to
  plain http.
- `latest.json` (the version, the tarball's name and its sha256) is signed with the release key and verified with
  `ssh-keygen -Y verify` before any field is read. The public key is pinned in `bin/nyx-monitor-update`; its
  fingerprint is `SHA256:C7GPdZqw26Ka+/rpiTthVP9b7tSiBK8pcVY+JjH6QHI` (ED25519, principal `nyx-monitor-release`,
  namespace `nyx-monitor`). `SECURITY.md` shows how to check it by hand.
- The tarball must match that sha256 and carry that version before anything is switched.
- Nothing installs by itself: a daily user timer (`nyx-monitor-update.timer`) only checks and sends a notification
  once per new version; installing is always a click on «Actualizar» or the command.
- Every release on the channel is tag `v<version>` of this repository's `main`.

Each release is unpacked, untouched, in `~/.local/share/nyx-monitor/releases/<version>/` (`extension/`, `bin/`,
`fonts/`); the extension folder and `~/.local/bin/nyx-monitor-update` are links into the current one. The previous
release and the three newest stay, so a rollback works and the running shell keeps its files after two updates in
one session. The settings live in dconf and survive every update. A folder copied by hand moves to
`releases/legacy-<date>/`, and a file of your own at `~/.local/bin/nyx-monitor-update` to
`nyx-monitor-update.bak-<date>`; neither is deleted. MesloLGS NF (the card's icons) is installed into
`~/.local/share/fonts` when the system lacks it. The running shell keeps reading its own release
(`extension/folder.js` pins the link at enable), so a new version shows after logging out and back in.

For development, link the checkout itself:

```bash
bash install.sh          # links extension/ into ~/.local/share/gnome-shell/extensions, enables it
bash install.sh --remove
```

GNOME on Wayland loads new extension code only at login: log out and back in after the first install and after every
code change. Assets and CSS are also read at login. The updater leaves a development install alone («Instalación de
desarrollo: se actualiza con git»).

## What she does

- **Idle**: Nyx at 60 % opacity and slightly muted, the card translucent. Clicks pass through the whole gadget except
  the pin. It hides while a window is fullscreen (games) and in the overview.
- **Full colour**: `Super+Alt+N` or a click on the pin (top-right of the card). Opaque, in full colour, shown even
  over fullscreen windows; Nyx waves. Same shortcut or pin to go back.
- **Characters and the gear**: the card can show another character instead of Nyx. Okane (a playful paisa obsessed
  with money) ships beside her, and six NIKKE characters as stills. The gear on the card, in full colour, opens the
  settings window: the character (a card with her portrait each, grouped by category), her look, size, transparency
  and timings, a fixed pose, her distance from the card (`figure-offset`), the PC's name after hers on the card
  (`pc-name`), how CPU, RAM and GPU show (bars, blocks, rings or large numbers, in five palettes), how she behaves,
  and the updates. Every change shows on the card at once. The same window opens with
  `gnome-extensions prefs nyx-monitor@majomaken`.
- **Clicks** (full colour only; idle Nyx lets them through): each click squashes her a little. Clicks less than a
  second apart add up: at 3 she pouts, at 6 she spins on the spot and gets dizzy, at 10 she crouches, blasts off past
  the top of the screen, the card shakes and reads "NYX · VUELVO YA", and two seconds later she drops back in with a
  bounce, holding the rubber duck when her look has that pose ("Traje refuerzos").
- **Hair swing and jump**: every click, every landing of a jump, of the cheer's hops and of the drop back after the
  blast-off swings her hair (and the sarong of the beach swimsuit): out from her head and down, a damped spring that
  settles in about 1.2 s; the face and the body stay put. The hop is a bigger jump: a crouch, up stretched, down
  squashed, two lower rebounds, about 1.5 s.
- **More moves** (the first three in full colour only):
  - *Pat*: stroke her head with the pointer for a moment; she closes her eyes, hearts float up and she leans gently
    side to side until you stop ("Mmm... gracias").
  - *Drag*: press the left button on her and move; she hangs from the spot held and swings like a pendulum as you
    move, her hair swinging at each end. Let go and she drops straight to her spot and lands with the jump's squash
    and rebounds.
  - *Double click*: a jump with a full turn in the air, star eyes and "¡Ta-dá!". A third quick click still pokes.
  - *Shadow*: the full-body standing looks cast a soft shadow under their feet; it shrinks and fades as she jumps or
    is lifted.
  - *Notification*: a new notification that shows a banner (not with Do Not Disturb, not low urgency) puts a «!» over
    her head and she hops, at most once every 4 s; never in a meeting, asleep or while hidden.
  - *Heat*: CPU Tctl at 85 °C or more, or the GPU junction at 80 °C or more, for two samples in a row: a sweat drop
    runs down beside her head on every look, and in the sweater, 2B and Eve hips looks she fans herself with a paper
    fan, and she says it once. Both under 78 °C and 72 °C for two samples cools her down.
  - *Music nod*: while music plays her head nods on a steady 96 BPM beat (MPRIS gives no tempo), fading in and out.
  - *Breeze*: in the beach mode a gust blows her hair and the sarong sideways every 6 to 14 s.
- **Moments**: every 5 minutes Nyx has a moment of about 15 s, in rotation: a wave with star eyes and a cheerful
  phrase; peeking over the card ("¿Ya hiciste commit?"); a determined face with a push to keep going; holding a rubber
  duck ("Explícale el bug al patito"); cheering with gray pom-poms, raised as she hops and lowered as she lands, with
  "¡Tú logras todo lo que te propones, es un hecho!". The phrases show in a speech bubble by her head. Every look has
  the four faces (stars, determined, dizzy, pout) and closed eyes. The four hips looks have every pose (peek, nap,
  duck, worry, cheer); the standing ones have the cheer and the worry, and say the peek phrases with a sway; the lying
  Nyx swings her feet in every moment.
- **Reactions**: RAM at 85 % or more and she pouts; CPU or GPU at 85 % or more for two samples in a row and she gets
  dizzy. Back to normal when the load drops.
- **Sleep**: after 3 minutes without keyboard or mouse the hips looks nap on the card with floating zzz; standing she
  closes her eyes where she is, and lying she dozes off over her book. The next input wakes her with a hop and a
  phrase.
- **Power cuts and errors**: every 10 s she asks a NUT UPS server (upsd on localhost:3493, over a socket, no process
  spawned; `ups-name`, empty to stop) and systemd's count of failed units (system and user, over D-Bus). When the UPS
  goes on battery or a new unit fails, she grabs her head with a worried face, shivers and says what happened ("¡Se
  fue la luz! Guarda tu trabajo", "¡Algo falló! Un servicio se cayó") for about 15 s, even out of a nap. When the
  power comes back: star eyes, a hop and "¡Volvió la luz!". Units that had already failed when she started do not
  count.
- **Time of day** (`schedule`): her look follows the clock, with a soft fade when a slot starts: 0 to 6 lying on the
  card (`lying-chibi`), 6 to 12 the sweater (`hips`), 12 to 18 the gothic dress (`hips-2b`), 18 to 0 the Eve suit
  (`hips-eve`). She checks the clock at least once a minute, so a suspend catches up. Choosing a variant by hand shows
  it until the next slot starts. While a moment plays or she sleeps the change waits a minute.
- **Resting poses**: within each slot she changes pose every half hour (`rest-minutes`) with a soft fade. The slot
  opens with her usual look for the first half hour, then her resting poses take turns: the sweater holds a coffee
  mug, thinks with a pencil on her chin and blows a kiss; the gothic dress curtsies holding her skirt, sips from a
  teacup and blows a kiss; Eve blows a kiss from the hips up at night. Each day carries on where the day before
  stopped. Poses no longer shown stay in the assets, listed under each look's `shelved`. A moment, a load reaction or
  a nap shows her usual look for a while and comes back.
- **Video poses**: eleven looks move like a drawn animation, from Wan 2.2 clips. Her usual look waves for real, and
  the sweater's cheer, worry, nap, headphones, fan, coffee and pencil, and 2B's tea and curtsy, loop while they show.
  While a clip plays, its own motion replaces the breathing, the fan hand, the music nod and the cheer's two frames;
  hops, drags, the hair swing, the bubble and the shadow go on over it.
- **Music and meetings** (checked every 10 s, two checks in a row before a change either way): while a music player
  says it is playing (MPRIS, any app), she wears gray headphones with her eyes closed and notes float up; while an app
  records the microphone she raises a finger to her lips and winks, and keeps quiet: no moments, phrases, faces or
  naps (a power cut or a failed service still speaks). The meeting wins over music. Apps on `meeting-ignore-apps`
  (the volume controls GNOME skips, and OBS) do not count.
- **Beach mode** (`beach`): with the card unlocked, a small parasol shows beside the pin. A click puts Nyx in her
  swimsuits and the parasol turns warm; another click brings her look back. Every 2 minutes (`beach-minutes`) a new
  pose fades in, twelve in turns. The mode lasts until then, also in idle mode, and survives a log out.
- **Rotation** (only with an empty `schedule`): every hour her look moves on to its next form with a soft fade: from
  the hips up, full body, lying on the card, and around again.
- **Demo tour** (`demo`): one step every 10 s in full colour, about 7 minutes, through every look, pose and
  animation; at the end her look and mode come back and the key turns itself off.

Built as an extension because Mutter has no layer-shell: Conky and other X11 desktop widgets do not stay put on GNOME
Wayland. It reads `/proc/stat`, `/proc/meminfo` and amdgpu's `gpu_busy_percent` (the card with the most VRAM) every
2 s, and skips reads while hidden. For the heat it also reads two hwmon temperatures: the CPU's (`k10temp` Tctl, or
`zenpower` Tdie, or `coretemp`'s package) and that card's junction.

## Settings

The gear covers the usual ones. Every key, from a terminal:

```bash
# The schema is not installed system-wide, so plain gsettings cannot find it: always pass its folder.
nyx() { gsettings --schemadir ~/.local/share/gnome-shell/extensions/nyx-monitor@majomaken/schemas "$@"; }
nyx set org.gnome.shell.extensions.nyx-monitor character okane       # a key of extension/characters.json
nyx set org.gnome.shell.extensions.nyx-monitor variant hips-eve      # Nyx: hips | hips-eve | hips-2b | hips-zelda | full-chibi | full-eve | full-2b | full-zelda | lying-chibi
nyx set org.gnome.shell.extensions.nyx-monitor schedule "['0=lying-chibi', '6=hips', '12=hips-2b', '18=hips-eve']"  # 'H=look' from hour H
nyx set org.gnome.shell.extensions.nyx-monitor schedule "[]"         # no schedule: the chosen variant and the hourly rotation
nyx set org.gnome.shell.extensions.nyx-monitor animation-minutes 10  # 0 turns moments off
nyx set org.gnome.shell.extensions.nyx-monitor phrases false         # no speech bubble
nyx set org.gnome.shell.extensions.nyx-monitor sleep-minutes 0       # 0 keeps her awake
nyx set org.gnome.shell.extensions.nyx-monitor idle-opacity 45       # 10 to 100
nyx set org.gnome.shell.extensions.nyx-monitor size 80               # percent of the drawn image
nyx set org.gnome.shell.extensions.nyx-monitor nyx-toggle-full "['<Super><Alt>n']"
nyx set org.gnome.shell.extensions.nyx-monitor demo true             # the tour, then it switches itself off
nyx set org.gnome.shell.extensions.nyx-monitor rotate-minutes 30     # 0 keeps her in the chosen form (default 60)
nyx set org.gnome.shell.extensions.nyx-monitor ups-name ''           # stop watching the UPS
nyx set org.gnome.shell.extensions.nyx-monitor rest-minutes 60       # minutes per resting pose (default 30); 0 keeps her usual look
nyx set org.gnome.shell.extensions.nyx-monitor meeting-ignore-apps "['org.gnome.VolumeControl', 'com.obsproject.Studio', 'obs']"
nyx set org.gnome.shell.extensions.nyx-monitor beach true            # beach mode on
nyx set org.gnome.shell.extensions.nyx-monitor beach-minutes 5       # minutes per beach pose (default 2)
nyx set org.gnome.shell.extensions.nyx-monitor pose-auto false       # keep the chosen look and pose
nyx set org.gnome.shell.extensions.nyx-monitor pose rest-sit         # the resting pose kept while pose-auto is off
nyx set org.gnome.shell.extensions.nyx-monitor figure-offset 48      # px further right of the card (0 to 160, default 24)
nyx set org.gnome.shell.extensions.nyx-monitor pc-name 'MI PC'       # the card reads NYX · MI PC (at most 20 characters)
nyx set org.gnome.shell.extensions.nyx-monitor stats-style rings     # bars | blocks | rings | numbers
nyx set org.gnome.shell.extensions.nyx-monitor stats-colors neon     # lavender | neon | ocean | sunset | gold
```

Changes apply at once (the gadget rebuilds itself). Every Nyx variant is semi-chibi: from the hips up (`hips-*`) and
full body with matching boots (`full-*`), in the sweater, `eve` (glossy black suit with gold lines), `2b` (black
gothic dress) and `zelda` (blue explorer tunic).

## Characters

`extension/characters.json` lists the characters in order: name, an optional `short` name for the card, the card's
title while she is away, her `category`, her folder, the manifest in it, an optional `phrases.json` and a square
portrait for the settings window. Nyx keeps `extension/assets/` and the phrases in `stats.js`; the others live in
`extension/characters/<key>/`. `extension/characters.js` resolves the `character` key (an unknown one shows Nyx) and
the `variant` key (a look the character lacks shows her manifest's `default`). A manifest has Nyx's shape
(`variants`, `poses`, optional `beach`) plus `default` and `forms` (the hourly rotation's order). Faces, blink, hand,
feet, sway, ground, beach and phrases are optional: what a character lacks is skipped, never borrowed from Nyx, and a
phrase kind she has no lines for shows no bubble. Nyx's time-of-day `schedule` names her looks, so it does not apply to
another character.

`extension/categories.json` lists the categories in order (`nyx`, then `nikke`); the window's «Personajes» page shows
one group per category (`characters.js` `groupByCategory`; a pack with an unknown category goes to the first one). A
new category is a line in `categories.json`. A `short` name has at most 10 characters (the tests check it).

- **Okane**: `hips` (default) with her wave clip, `full`, a nap, three resting poses and clips for the cheer, the
  worry, the heat, the meeting's shh and her own `money` moment.
- **NIKKE**: six stills (Anis: Star, Crown, Marian: Queen, Rapi: Red Hood, Scarlet: Goddeath, Flora), each with a
  `hips` look (the default, from the hips up) and a `full` one, no poses, clips or phrases. Picked from Prydwen's tier
  list (Story tab, 23 November 2026): six of its eight SSS characters, the tie broken by the Bossing rating. The art is the official
  full-body art, © SHIFT UP (see `NOTICE`).

To add a character: a folder under `extension/characters/<key>/` with `variants.json`, the PNGs it names (each at its
`size`), a 256x256 portrait and optionally `phrases.json` (kinds from `stats.js` `PHRASES`, plus `money`), then an
entry in `characters.json` with its `category`. `tests/characters.test.mjs` checks every pack listed there. Only art
you made or may share (`CONTRIBUTING.md`).

## Layout

- `extension/extension.js`: the gadget (St widgets in `addTopChrome`, keybinding, timers, animations), the moments,
  the speech bubble, the reactions and sleep.
- `extension/stats.js`: pure logic, no `gi` imports, shared by gjs and the tests: parsing and formatting, the phrases
  (Spanish), `reaction`, `momentFor`, `phraseFor`, `shouldSleep`, the sway and nod maths.
- `extension/characters.js`, `characters.json`, `categories.json`: the characters and their categories; pure, shared
  by the extension, the settings window and the tests.
- `extension/prefs.js`: the settings window behind the gear (GTK 4 and libadwaita, in its own process): pages
  Personajes, Look, Tarjeta, Comportamiento and Actualizaciones (runs the release's `bin/nyx-monitor-update`).
- `extension/update.js`: what the «Actualizaciones» page says for each answer of the updater; pure, unit tested.
- `extension/folder.js`: the real folder behind the extension's link, read once at enable.
- `extension/skins.js`: the stats' styles and palettes; pure, shared by the extension, the window and the tests.
- `extension/assets/`: Nyx's cut-outs and `variants.json` (layout, size, blink frame, hand or feet layer and its
  pivot, face overlays, head box for the bubble, the poses drawn in each look, the resting poses in `rest`, the beach
  mode in `beach`); `nyx-clip-<look>.png`, the video poses, one vertical strip of 36 frames (12 fps) per look, decoded
  off the main loop only while its look shows; `sway.json`, a sway map per body PNG for the hair swing, the breeze and
  the nod, drawn by a `Shell.GLSLEffect` (`Clutter.DeformEffect` paints nothing on GNOME 50); `ground.json`, where the
  soles of each standing look touch the floor, for the shadow.
- `bin/nyx-monitor-update`, its `.service` and `.timer`, and `get.sh`: the updater, the daily check and the first
  install (host bash + curl + tar + sha256sum + gjs + ssh-keygen).
- `release.sh` and `release/`: the release channel's builder, its nginx image, the font license and the notes of
  each version.

## Tests

```bash
bash tests/run.sh            # unit tests (Node in Docker, version in .nvmrc)
bash tests/install.test.sh   # install.sh against stub gsettings
bash tests/update.test.sh    # the updater, get.sh and release.sh on a file:// channel, with stubs and throwaway keys
bash tests/site.test.sh      # release/nginx.conf in the release image's nginx (Docker)
bash tests/headless.sh       # every state in a throwaway headless GNOME Shell (host only)
NYX_CHARACTER=okane bash tests/headless.sh local/okane-shots   # another character: her looks, poses, clips, a live switch
bash tests/devkit.sh okane   # the widget live in a nested GNOME window (mutter-devkit), gear and settings included
```

CI runs the first four on every pull request and on `main`. `headless.sh` starts `gnome-shell --headless` with its own
D-Bus and XDG folders and a 3440x1440 virtual monitor, so nothing in the real session changes; it forces each state
through Eval for every variant, checks the music and meeting detection for real, and saves screenshots in `local/`.
`devkit.sh` runs `gnome-shell --devkit` with the same isolation and stays open until its window is closed; while it
runs, `tests/devkit.sh eval 'JS'`, `shot NAME`, `set KEY VALUE`, `get KEY` and `prefs` drive it from another
terminal. Needs `mutter-devkit`. To see the «Actualizaciones» page as a user does, point it at an unpacked release and
a local channel: `NYX_DEVKIT_EXTENSION=<root>/releases/<v>/extension NYX_ROOT=<root> NYX_UPDATE_URL=file://<site>
NYX_ALLOWED_SIGNERS=<file> NYX_PREFS_PAGE=updates bash tests/devkit.sh`.

## Releasing (maintainer)

1. Raise `version-name` in `extension/metadata.json` and write `release/notes/<version>.txt` (Spanish, one paragraph:
   what the user sees in the «Actualizaciones» page). Merge to `main` and push.
2. `bash release.sh --dry-run` builds `release/site/` (the tarball, `latest.json` and its signature, `get.sh`, the
   updater, `index.html`, `robots.txt`). `bash release.sh` publishes: it refuses unless the checkout is a clean `main`
   equal to `origin/main`, signs `latest.json` with the release key (`~/.config/nyx-monitor/release-signing-key`,
   never in git) and checks it against the key pinned in the updater, pushes tag `v<version>`, then deploys
   `release/` (nginx 1.28 alpine) with the maintainer's deploy script as `nyx.majomaken.dev`, unlisted (`noindex`).
   Everyone's daily check sees it within a day.
3. A version is published once: Cloudflare keeps each tarball for a year, so `release.sh` refuses a version the
   channel already serves with another sha256, or a tag that already names another commit. Any change, even a
   one-line fix, raises `version-name`.

A fork that runs its own channel puts its own public key in `bin/nyx-monitor-update` (`signer`), its URL as the
default `NYX_UPDATE_URL`, and replaces the deploy step at the end of `release.sh`.
