// Nyx monitor: a glass card with CPU, RAM and GPU and Nyx beside it (or lying on it), always on
// top of the windows at the bottom-right corner of the screen below the primary one, or of the
// primary when there is none below. Idle mode is translucent and muted, hides while a window is
// fullscreen and lets every click through but the pin's; full mode (Super+Alt+N or the pin) is
// opaque, in full colour, shown over everything, and Nyx reacts to clicks on her.
//
// Every few minutes Nyx has a moment: a pose or a face, a move and a phrase in a speech bubble.
// Her face reacts to a heavy load, and she falls asleep on the card while the keyboard and mouse rest.
// Now and then she cheers with gray pom-poms (two frames). Clicked over and over she pouts, then spins, then blasts off the screen and comes back. A power cut
// (the UPS on battery) or a newly failed systemd unit makes her grab her head, worried. Her look follows
// the time of day (the `schedule` key); with an empty schedule, every hour it moves on to its next form:
// from the hips up, full body, lying on the card.
// Within her slot of the day she changes pose every half hour (`rest-minutes`): her usual look, then her
// resting poses (a coffee, a pencil, a curtsy, a teacup, or Eve's blown kisses at night). Headphones on
// while music plays (MPRIS), and a finger on her lips while an app records the microphone (a meeting:
// no moments, bubbles, faces or sleep then; `meeting-ignore-apps` lists the apps that do not count).
// The `demo` key plays a tour of every look and animation, one step every 10 s.
// The parasol beside the pin (full colour only) turns the beach mode on and off (the `beach` key): Nyx in her
// swimsuits, a new resting pose every `beach-minutes`, two of them lying on the wide card. Moments and naps
// wait meanwhile; now and then a breeze blows her hair and sarong.
// In full colour she also takes a pat (the pointer stroking her head: eyes closed, hearts), can be picked up and
// swings from the spot held until she is dropped, and does a flip on a double click. The standing looks cast a
// shadow on the floor; a notification puts a «!» over her head; a hot CPU or GPU makes her sweat (the sweater
// fans herself); and her head nods while music plays.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {beachStep, CONTEXT_START, contextStep, DEMO_STEP_MS, demoSteps, failedRose, micInUse, momentFor, mprisPlaying,
    parseSchedule, parseUpsStatus, phraseFor, pickGpu, pickMonitor, powerEvent, reaction, reactionPhrases, restIndex, homeRest,
    rotationVariant, secondsToNextSlot, shouldSleep, slotAt, snapshot, SWAY_DOWN, SWAY_SIDE, tapStage, tapStreak, upsQuery, wobbleAt,
    WOBBLE_MS, hopFrames, inHead, patStep, PAT_TRAVEL, swingStep, windAt, GUST_MS, shadowAt, notifyGate, parseMilliC,
    heatStep, HEAT_START, isDoubleTap, flipFrames, nodAt, nodLevel, clipFrame, clipBox, PHRASES} from './stats.js';
import {assetPath, cardTitle, lookFor, NYX_INDEX, resolvePack} from './characters.js';
import {blocksLit, hexRgb, iconColor, paletteFor, ringSweep, statColor, styleFor} from './skins.js';
import {realDir} from './folder.js';

const KEYBINDING = 'nyx-toggle-full';
const LIVE_KEYS = [KEYBINDING, 'phrases', 'sleep-minutes', 'demo', 'ups-name', 'rest-minutes', 'meeting-ignore-apps',
    'pose-auto', 'pose', 'pc-name']; // read when used, no rebuild
const SAMPLE_SECONDS = 2;
const WATCH_SECONDS = 10; // the UPS, systemd's failed units, the mic and the music players
const SLOT_CHECK_SECONDS = 60; // with a schedule she looks at the clock at least this often (a suspend catches up)
const MARGIN = 24;
const CARD_WIDTH = 236;
const OVERLAP = 40; // how far Nyx stands over the card's right edge, less the figure-offset key
const SINK = 12; // how far the lying Nyx sinks into the card's top edge
const PERCH_SINK = 3; // how far a perched pose's hands rest over the card's top edge
const FADE_MS = 200;
const MOMENT_MS = 15000;
const BUBBLE_MS = 7000;
const BUBBLE_MAX_WIDTH = 200;
const REACTION_QUIET_MS = 60000; // a flapping load says its phrase at most once a minute
const HISTORY = 3;
const AWAY_MS = 2200; // how long she stays off screen after blasting off
const WORRY_KINDS = ['outage', 'restored', 'failed']; // the phrases a meeting still lets through
// What floats up from her head: zzz while she sleeps, notes with the headphones, hearts with a blown kiss.
const FLOATS = {
    zzz: {texts: ['z', 'z', 'Z'], every: 700},
    notes: {texts: ['\u266A', '\u266B', '\u266A'], every: 1100},
    heart: {texts: ['\u2665', '\u2665', '\u2665'], every: 1700},
};
const BREATH_MS = 2300; // the resting poses rise and fall this slowly
// Defaults of the keys added since 2026-11-05 (rest-minutes on 2026-11-09, character on 2026-11-24), for a compiled schema older
// than this code (pulled before install.sh ran again): reading a key the schema lacks aborts gnome-shell.
const NEW_KEYS = {
    'rest-minutes': ['uint', 30],
    'meeting-ignore-apps': ['strv', ['org.gnome.VolumeControl', 'org.PulseAudio.pavucontrol', 'com.obsproject.Studio', 'OBS', 'obs']],
    'beach': ['boolean', false],
    'beach-minutes': ['uint', 2],
    'character': ['string', 'nyx'],
    'pose-auto': ['boolean', true],
    'pose': ['string', ''],
    'figure-offset': ['uint', 24],
    'pc-name': ['string', 'SUPER PC'],
    'stats-style': ['string', 'bars'],
    'stats-colors': ['string', 'lavender'],
};
const BEACH_ICON = '\u{F188A}'; // nf-md-umbrella_beach, in MesloLGS NF like the pin
const GEAR_ICON = '\u{F0493}'; // nf-md-cog: the settings window (prefs.js)
const SWAY_AMP = 7; // px at 100 % size: how far her hair tips swing at most (under SWAY_MARGIN)
const SWAY_MARGIN = 8; // px the swing may reach past her look; the effect draws that far out
const SWAY_CELLS = 1024; // the most cells a sway map has (tests/stats.test.mjs checks every map)
const LIMB_TURN = 12; // degrees a hand or the feet turn at most (the wave, the fan, the lying feet)
const HOP_HEIGHT = 30; // px at 100 % size: how high the jump goes
const WIND_AMP = 5; // px at 100 % size: how far a gust of the beach breeze blows her hair
const NOD_AMP = 3; // px at 100 % size: how far her head nods to music
const FLIP_HEIGHT = 56; // px at 100 % size: how high the double-click flip goes
const DRAG_START_PX = 8; // a press that moves farther picks her up
const SHADOW_H = 14; // px at 100 % size: the height of her shadow on the floor
const ALERT_MS = 1600; // how long the «!» of a notification shows
const PAT_HOLD_MS = 900; // a pat ends this long after the pointer stops stroking her head
const STILL_MAP = {cx: 0.5, rows: ['00', '00']}; // a look without a sway map: nothing swings, the nod still works
const COLUMN_GAP = 6; // px between the three columns of the rings and the numbers
const RING_SIZE = 56; // px, a ring gauge's side
const RING_STROKE = 6;
const BLOCK_GAP = 3; // px between the blocks of the blocks style
const ROWS = [
    {id: 'cpu', icon: '\u{F0EE0}', name: 'CPU'},
    {id: 'ram', icon: '\u{F09D1}', name: 'RAM'},
    {id: 'gpu', icon: '\u{F08AE}', name: 'GPU'},
];

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch {
        return null;
    }
}

function findGpuBusyPath() {
    const cards = [];
    try {
        const en = Gio.File.new_for_path('/sys/class/drm')
            .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null))) {
            const name = info.get_name();
            if (!/^card\d+$/.test(name))
                continue;
            const dev = `/sys/class/drm/${name}/device`;
            const vram = readText(`${dev}/mem_info_vram_total`);
            cards.push({
                name,
                vramTotal: vram ? Number(vram.trim()) : 0,
                hasBusy: GLib.file_test(`${dev}/gpu_busy_percent`, GLib.FileTest.EXISTS),
            });
        }
        en.close(null);
    } catch {
        return null;
    }
    const name = pickGpu(cards);
    return name ? `/sys/class/drm/${name}/device/gpu_busy_percent` : null;
}

// One question to upsd (NUT) on localhost; resolves its first reply line, or null on any error. A
// socket and no `upsc` process, so the 10 s check spawns nothing.
function upsAsk(query) {
    return new Promise(resolve => {
        const client = new Gio.SocketClient({timeout: 2});
        client.connect_to_host_async('127.0.0.1', 3493, null, (c, res) => {
            let conn;
            try {
                conn = c.connect_to_host_finish(res);
            } catch {
                resolve(null);
                return;
            }
            const done = line => {
                try {
                    conn.close(null);
                } catch {}
                resolve(line);
            };
            const input = new Gio.DataInputStream({base_stream: conn.get_input_stream()});
            conn.get_output_stream().write_bytes_async(new GLib.Bytes(new TextEncoder().encode(query)),
                GLib.PRIORITY_DEFAULT, null, (out, r) => {
                    try {
                        out.write_bytes_finish(r);
                    } catch {
                        done(null);
                        return;
                    }
                    input.read_line_async(GLib.PRIORITY_DEFAULT, null, (inp, r2) => {
                        try {
                            done(inp.read_line_finish_utf8(r2)[0]);
                        } catch {
                            done(null);
                        }
                    });
                });
        });
    });
}

// systemd's count of failed units on a bus (system or user), or null when it cannot be read.
function failedUnits(bus) {
    return new Promise(resolve => {
        bus.call('org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.freedesktop.systemd1.Manager', 'NFailedUnits']),
            new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 2000, null, (b, res) => {
                try {
                    resolve(b.call_finish(res).recursiveUnpack()[0]);
                } catch {
                    resolve(null);
                }
            });
    });
}

// The PlaybackStatus of every MPRIS player on the session bus (null for one that does not answer).
function playerStatuses(bus) {
    const call = (dest, path, iface, method, params, type) => new Promise(resolve => {
        bus.call(dest, path, iface, method, params, new GLib.VariantType(type), Gio.DBusCallFlags.NONE, 2000, null,
            (b, res) => {
                try {
                    resolve(b.call_finish(res).recursiveUnpack()[0]);
                } catch {
                    resolve(null);
                }
            });
    });
    return call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames', null, '(as)')
        .then(names => Promise.all((names ?? []).filter(n => n.startsWith('org.mpris.MediaPlayer2.')).map(n =>
            call(n, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'PlaybackStatus']), '(v)'))));
}

// The names in a folder, sorted; none when it cannot be read.
function listDir(path) {
    const names = [];
    try {
        const en = Gio.File.new_for_path(path).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null)))
            names.push(info.get_name());
        en.close(null);
    } catch {}
    return names.sort();
}

// The temp*_input of an hwmon folder whose label comes first in `labels`, else its temp1_input, else null.
function hwmonTemp(dir, labels) {
    const inputs = listDir(dir).filter(n => /^temp\d+_input$/.test(n));
    for (const label of labels) {
        const hit = inputs.find(n => readText(`${dir}/${n.replace('_input', '_label')}`)?.trim() === label);
        if (hit)
            return `${dir}/${hit}`;
    }
    return inputs.includes('temp1_input') ? `${dir}/temp1_input` : null;
}

// Where the heat is read: the CPU's control temperature (k10temp's Tctl, zenpower's Tdie, coretemp's package) and
// the junction of the GPU whose load the card shows (its edge when it has none), as hwmon paths or null.
function findTempPaths(gpuBusyPath) {
    let cpu = null;
    for (const hw of listDir('/sys/class/hwmon')) {
        const dir = `/sys/class/hwmon/${hw}`;
        if (['k10temp', 'zenpower', 'coretemp'].includes(readText(`${dir}/name`)?.trim())) {
            cpu = hwmonTemp(dir, ['Tctl', 'Tdie', 'Package id 0']);
            if (cpu)
                break;
        }
    }
    let gpu = null;
    if (gpuBusyPath) {
        const dev = gpuBusyPath.replace(/\/gpu_busy_percent$/, '');
        for (const hw of listDir(`${dev}/hwmon`)) {
            gpu = hwmonTemp(`${dev}/hwmon/${hw}`, ['junction', 'edge']);
            if (gpu)
                break;
        }
    }
    return {cpu, gpu};
}

// The apps recording from a source right now, from the mixer GNOME's own volume menu uses.
function micOutputs() {
    try {
        return Volume.getMixerControl().get_source_outputs()
            .map(o => ({app: o.get_application_id(), name: o.get_name()}));
    } catch {
        return [];
    }
}

// How far past its box (px) a limb layer of a look (as big as the look, turning at `pivot`, 0..1) reaches when it
// turns `deg` either way: the look's pad must cover it, or the effect's offscreen would grow and slip while the
// hand waves or fans.
function limbReach(w, h, [px, py], deg) {
    let reach = 0;
    for (const a of [deg, -deg]) {
        const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
        for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
            const dx = x - px * w, dy = y - py * h;
            const rx = px * w + dx * c - dy * s, ry = py * h + dx * s + dy * c;
            reach = Math.max(reach, -rx, rx - w, -ry, ry - h);
        }
    }
    return reach;
}

// Where the offscreen texture of a look's effect starts and how long it is, along a look of length len: the
// pad (_makeLook) reaches `margin` past each edge, and _clutter_actor_box_enlarge_for_effects ends the box
// on the pixel after the pad's end plus 0.75 and makes it 3 px longer, for a size that does not depend on the
// sub-pixel position (clutter-actor-box.c, clutter-offscreen-effect.c). The box is in the look's own
// coordinates, so turning, moving or squashing the look leaves it as it is.
function offscreenSpan(len, margin) {
    const end = Math.ceil(len + margin + 0.75);
    const size = Math.round(len + 2 * margin) + 3;
    return [end - size, size];
}

// The shader of her motion: each pixel of the look takes its colour from a little in from where it moves to.
// Her hair (the look's sway map, read between its cells) swings out and down with the wobble of the moment and
// is blown sideways by the beach breeze; her head (the head box down to the chin, fading out down the neck) nods
// to music. The swing mirrors stats.js swayWeight and swayOffset; the offset stays inside the look's pad.
const MOTION_DECLARATIONS = `
uniform float nyx_w[${SWAY_CELLS}];
uniform vec2 nyx_grid;
uniform vec4 nyx_map;
uniform float nyx_cx;
uniform vec2 nyx_amp;
uniform vec2 nyx_wind;
uniform vec4 nyx_head;
uniform vec2 nyx_nod;
uniform vec2 nyx_max;
float nyx_at(vec2 cell) {
    return nyx_w[int(cell.y * nyx_grid.x + cell.x)];
}
`;
const MOTION_CODE = `
vec2 tc = cogl_tex_coord.st;
vec2 look = vec2(tc.x * nyx_map.x + nyx_map.y, tc.y * nyx_map.z + nyx_map.w);
vec2 g = clamp(look * nyx_grid - 0.5, vec2(0.0), nyx_grid - 1.0);
vec2 g0 = floor(g);
vec2 g1 = min(g0 + 1.0, nyx_grid - 1.0);
vec2 f = g - g0;
float w = mix(mix(nyx_at(g0), nyx_at(vec2(g1.x, g0.y)), f.x), mix(nyx_at(vec2(g0.x, g1.y)), nyx_at(g1), f.x), f.y);
float side = clamp((look.x - nyx_cx) / ${SWAY_SIDE.toFixed(3)}, -1.0, 1.0);
vec2 off = w * (vec2(side, ${SWAY_DOWN.toFixed(3)}) * nyx_amp + nyx_wind);
float hx = smoothstep(nyx_head.x - 0.05, nyx_head.x, look.x) * (1.0 - smoothstep(nyx_head.y, nyx_head.y + 0.05, look.x));
float hy = 1.0 - smoothstep(nyx_head.z, nyx_head.w, look.y);
off = clamp(off + hx * hy * nyx_nod, -nyx_max, nyx_max);
cogl_texel = texture2D(cogl_sampler, tc - off);
`;

// Her hair, loose clothes and head moving, on one look while any of it moves (_motion). (Clutter.DeformEffect
// would move a mesh instead, but on this mutter it paints nothing, even with one tile and no offset; checked
// 2026-11-06.) setMotion takes px: the swing's reach, the wind's and the nod's offsets.
const MotionEffect = GObject.registerClass(
class NyxMotionEffect extends Shell.GLSLEffect {
    _init(map, w, h, head, margin) {
        super._init();
        const rows = map.rows, cols = rows[0].length;
        const [ox, fw] = offscreenSpan(w, margin), [oy, fh] = offscreenSpan(h, margin);
        const weights = new Array(SWAY_CELLS).fill(0);
        rows.forEach((row, r) => [...row].forEach((d, c) => {
            weights[r * cols + c] = Number(d) / 9;
        }));
        const [x0, y0, x1, y1] = head ?? [0, 0, 0, 0];
        this.set_uniform_float(this.get_uniform_location('nyx_w'), 1, weights);
        this.set_uniform_float(this.get_uniform_location('nyx_grid'), 2, [cols, rows.length]);
        this.set_uniform_float(this.get_uniform_location('nyx_map'), 4, [fw / w, ox / w, fh / h, oy / h]);
        this.set_uniform_float(this.get_uniform_location('nyx_cx'), 1, [map.cx]);
        this.set_uniform_float(this.get_uniform_location('nyx_head'), 4, [x0, x1, y1, y1 + 0.5 * (y1 - y0)]);
        this.set_uniform_float(this.get_uniform_location('nyx_max'), 2, [(margin - 1) / fw, (margin - 1) / fh]);
        this._at = {amp: 'nyx_amp', wind: 'nyx_wind', nod: 'nyx_nod'};
        for (const [k, name] of Object.entries(this._at))
            this._at[k] = this.get_uniform_location(name);
        this._px = [1 / fw, 1 / fh]; // pixels to texture units
        this.setMotion({});
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.TEXTURE_LOOKUP, MOTION_DECLARATIONS, MOTION_CODE, true);
    }

    setMotion({sway = 0, wind = [0, 0], nod = [0, 0]}) {
        this.motion = {sway, wind, nod};
        const [px, py] = this._px;
        this.set_uniform_float(this._at.amp, 2, [sway * px, sway * py]);
        this.set_uniform_float(this._at.wind, 2, [wind[0] * px, wind[1] * py]);
        this.set_uniform_float(this._at.nod, 2, [nod[0] * px, nod[1] * py]);
        this.queue_repaint();
    }
});

function image(path, width, height) {
    return new St.Widget({
        width, height,
        style: `background-image: url("file://${path}"); background-size: ${width}px ${height}px;`,
    });
}

export default class NyxMonitorExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._dir = realDir(this.path); // the release this code came from (folder.js)
        try {
            this._index = JSON.parse(readText(`${this._dir}/characters.json`)) ?? NYX_INDEX;
        } catch (e) {
            console.error(e);
            this._index = NYX_INDEX;
        }
        this._loadPack();
        this._gpuPath = findGpuBusyPath();
        this._tempPaths = findTempPaths(this._gpuPath);
        this._heat = {...HEAT_START}; // hot or not, steadied over two samples (stats.js heatStep)
        this._heatDemo = false; // the demo tour's heat step
        this._nod = null; // the music nod: {since, until} (stats.js nodLevel)
        this._lastAlert = null;
        this._full = false;
        this._inOverview = false;
        this._cpuPrev = null;
        this._momentCount = 0;
        this._phraseN = {};
        this._gen = 0;
        this._token = 0;
        this._timers = new Set();
        this._demoOn = false;
        this._demoVariant = null;
        this._demoRun = 0;
        this._rotateStep = 0;
        this._handPicked = null; // the hour of the schedule slot in which a variant was chosen by hand
        this._shown = null; // the look on screen outside the demo
        this._power = null;
        this._failed = null;
        this._ctx = {...CONTEXT_START}; // music or a meeting, steadied over two checks (stats.js contextStep)
        this._beachIndex = 0; // the pose of the beach series on screen (stats.js beachStep)
        this._beachMem = false; // the beach mode while the compiled schema lacks its key
        // A tour cut short by a log out would otherwise stay switched on.
        if (this._settings.get_boolean('demo'))
            this._settings.set_boolean('demo', false);

        this._build();

        Main.wm.addKeybinding(KEYBINDING, this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._toggleFull());
        this._settings.connectObject('changed', (_s, key) => {
            if (key === 'character') {
                // Another character: her own files, her looks from the start, then a soft fade to her.
                this._stopDemo();
                this._loadPack();
                this._rotateStep = 0;
                this._handPicked = null;
                this._beachIndex = 0;
                this._phraseN = {};
                this._fadeRebuild().catch(e => console.error(e));
            } else if (key === 'demo') {
                if (this._settings.get_boolean('demo'))
                    this._startDemo().catch(e => console.error(e));
                else
                    this._stopDemo();
            } else if (key === 'pose-auto' || key === 'pose') {
                // Fixed (pose-auto off): the chosen look and pose stay. Automatic again: the clock's look and its
                // rotation come back. A crossfade to the pose, or a fade when the look itself changes.
                if (this._lookNow() !== this._shown) {
                    this._fadeRebuild().catch(e => console.error(e));
                } else {
                    this._settleHome();
                    this._scheduleRotation();
                }
            } else if (key === 'pc-name') {
                if (this._title && this._title.text !== this._pack.away) // the launch's away text stays until she is back
                    this._title.text = this._titleText();
            } else if (key === 'beach') {
                this._beachIndex = 0; // the series starts again from its first pose
                this._fadeRebuild().catch(e => console.error(e));
            } else if (!LIVE_KEYS.includes(key)) {
                if (key === 'variant') {
                    this._rotateStep = 0; // a new choice shows as chosen; the rotation starts again from it
                    this._handPicked = this._slotNow()?.hour ?? null; // and holds until the next schedule slot
                } else if (key === 'schedule') {
                    this._handPicked = null; // a new schedule shows at once
                }
                this._rebuild();
            }
        }, this);
        Main.layoutManager.connectObject('monitors-changed', () => this._place(), this);
        global.display.connectObject(
            'in-fullscreen-changed', () => this._updateVisibility(),
            'workareas-changed', () => this._place(), this);
        Main.overview.connectObject(
            'showing', () => {
                this._inOverview = true;
                this._updateVisibility();
            },
            'hidden', () => {
                this._inOverview = false;
                this._updateVisibility();
            }, this);
        // Every notification source, the ones there now and those added later, for the «!» over her head.
        Main.messageTray.connectObject('source-added', (_t, source) => this._watchSource(source), this);
        for (const source of Main.messageTray.getSources())
            this._watchSource(source);

        this._sampleId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SAMPLE_SECONDS, () => {
            this._checkSleep();
            this._sample();
            return GLib.SOURCE_CONTINUE;
        });
        this._sample();
        this._watchId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, WATCH_SECONDS, () => {
            this._watch().catch(e => console.error(e));
            return GLib.SOURCE_CONTINUE;
        });
        this._watch().catch(e => console.error(e));
    }

    disable() {
        Main.wm.removeKeybinding(KEYBINDING);
        this._settings?.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.messageTray.disconnectObject(this);
        for (const source of Main.messageTray.getSources())
            source.disconnectObject(this);
        if (this._sampleId)
            GLib.Source.remove(this._sampleId);
        this._sampleId = 0;
        if (this._demoTimer)
            GLib.Source.remove(this._demoTimer);
        this._demoTimer = 0;
        this._demoOn = false;
        if (this._watchId)
            GLib.Source.remove(this._watchId);
        this._watchId = 0;
        this._destroyUi();
        this._settings = null;
        this._index = this._pack = this._phrases = null;
        this._manifest = null;
        this._swayMaps = null;
        this._ground = null;
        this._timers = null;
    }

    // ---- building ----------------------------------------------------------------------------

    // The character that shows (the `character` key, characters.js resolvePack): her manifest, her sway and ground
    // maps and her phrases, all from her own folder. A map she lacks leaves her still or without a shadow (no file is
    // borrowed from another character); a phrase kind she lacks shows no bubble. A pack whose manifest cannot be read
    // falls back to Nyx.
    _loadPack() {
        const json = file => {
            try {
                return JSON.parse(readText(assetPath(this._dir, this._pack, file)));
            } catch (e) {
                console.error(`nyx-monitor: ${this._pack.dir}/${file}: ${e.message}`);
                return null;
            }
        };
        this._pack = resolvePack(this._index, this._newKey('character'));
        this._manifest = json(this._pack.manifest);
        if (!this._manifest?.variants) {
            this._pack = resolvePack(NYX_INDEX, 'nyx');
            this._manifest = json(this._pack.manifest);
        }
        this._swayMaps = json('sway.json') ?? {}; // a missing file reads as null: no swing, everything else as usual
        this._ground = json('ground.json') ?? {}; // no shadows
        this._phrases = this._pack.phrases ? json(this._pack.phrases) ?? {} : PHRASES;
    }

    _build() {
        const name = this._demoVariant ?? this._lookNow();
        if (!this._demoVariant)
            this._shown = name;
        const look = lookFor(this._manifest, name);
        const spec = this._manifest.variants[look] ?? this._manifest.beach.looks[look];
        this._spec = spec;
        const scale = this._settings.get_int('size') / 100;
        const px = s => s.size.map(n => Math.round(n * scale));
        const [nw, nh] = px(spec);
        const wide = spec.layout === 'top';
        this._wide = wide;
        const cardWidth = wide ? nw : CARD_WIDTH;

        this._sleeping = false;
        this._running = 0;
        this._momentFace = null;
        this._reactFace = null;
        this._face = null;
        this._history = [];
        this._lastReactSay = 0;
        this._bubbleToken = 0;
        this._tapStreak = 0;
        this._tapLast = null;
        this._launching = false;
        this._held = null; // a left-button press that may become a drag: {x, y} where it went down
        this._drag = null;
        this._dragging = false;
        this._grab = null;
        this._patState = null;
        this._patting = false;
        this._patUntil = 0;
        this._hearts = new Set();

        this._root = new St.Widget({name: 'nyxMonitor', reactive: false, layout_manager: new Clutter.FixedLayout()});

        // Card: glass background (blur of what is behind it) and the stats inside.
        this._card = new St.BoxLayout({
            style_class: 'nyx-card', width: cardWidth,
            orientation: Clutter.Orientation.VERTICAL,
        });
        this._card.add_effect(new Shell.BlurEffect({
            name: 'blur', radius: 30, brightness: 0.85, mode: Shell.BlurMode.BACKGROUND,
        }));
        this._inner = new St.BoxLayout({style_class: 'nyx-inner', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._card.add_child(this._inner);

        const header = new St.BoxLayout({style_class: 'nyx-header', x_expand: true});
        this._title = new St.Label({
            style_class: 'nyx-title', text: this._titleText(), x_expand: true, y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._title);
        // The parasol, the gear and the pin live in a layer of their own above her (S13): her look is a rectangle wider
        // than she is, reactive in full colour, and over the card it took their clicks. This empty spot keeps their
        // place in the header; _placeControls puts the layer on it.
        this._controlsSpot = new St.Widget({y_align: Clutter.ActorAlign.CENTER});
        header.add_child(this._controlsSpot);
        this._controls = new St.BoxLayout({style_class: 'nyx-header'});
        if (this._manifest.beach) {
            // The parasol shows in full colour only (see _applyMode); warm while the beach mode is on.
            this._beachBtn = new St.Button({
                style_class: 'nyx-pin', reactive: true, can_focus: false, track_hover: true,
                child: new St.Label({text: BEACH_ICON}),
            });
            if (this._beachOn())
                this._beachBtn.add_style_class_name('nyx-beach-on');
            this._beachBtn.connect('clicked', () => this._toggleBeach());
            this._controls.add_child(this._beachBtn);
        }
        // The gear (full colour only, like the parasol) opens the settings window: the character, her look and how
        // she behaves, applied live while it is open.
        this._gearBtn = new St.Button({
            style_class: 'nyx-pin', reactive: true, can_focus: false, track_hover: true,
            child: new St.Label({text: GEAR_ICON}),
        });
        this._gearBtn.connect('clicked', () => this.openPreferences());
        this._controls.add_child(this._gearBtn);
        this._pin = new St.Button({
            style_class: 'nyx-pin', reactive: true, can_focus: false, track_hover: true,
            child: new St.Label({text: '\u{F0403}'}),
        });
        this._pin.connect('clicked', () => this._toggleFull());
        this._controls.add_child(this._pin);
        this._inner.add_child(header);

        // CPU, RAM and GPU in the chosen style and colours (skins.js, S15): bars or blocks under a line with the icon,
        // the name and the value, or three columns of rings or large numbers with the icon and the name below.
        const style = styleFor(this._newKey('stats-style'));
        this._style = style;
        this._palette = paletteFor(this._newKey('stats-colors'));
        const columns = style === 'rings' || style === 'numbers';
        this._narrow = wide || columns; // a third of the width per stat: used RAM only
        const rows = new St.BoxLayout({
            style_class: columns ? 'nyx-rows-cols' : wide ? 'nyx-rows-wide' : 'nyx-rows',
            orientation: this._narrow ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        // Bars span the card's inner width (or a third of it on the wide card).
        const innerWidth = cardWidth - 32;
        this._trackWidth = wide ? Math.floor((innerWidth - 2 * 14) / 3) : innerWidth;
        const columnWidth = Math.floor((innerWidth - 2 * COLUMN_GAP) / 3);
        this._rows = {};
        for (const r of ROWS) {
            const row = {id: r.id, fraction: 0, color: null, lit: -1};
            const icon = new St.Label({
                style_class: `nyx-icon nyx-icon-${r.id}`, text: r.icon, y_align: Clutter.ActorAlign.CENTER,
                style: `color: ${iconColor(this._palette, r.id)};`,
            });
            const name = new St.Label({style_class: 'nyx-name', text: r.name, y_align: Clutter.ActorAlign.CENTER});
            if (columns) {
                const box = new St.BoxLayout({
                    style_class: 'nyx-row nyx-col', orientation: Clutter.Orientation.VERTICAL, width: columnWidth,
                });
                if (style === 'rings') {
                    const side = Math.min(columnWidth, RING_SIZE);
                    row.ring = new St.DrawingArea({width: side, height: side});
                    row.ring.connect('repaint', area => this._paintRing(area, row));
                    row.value = new St.Label({
                        style_class: 'nyx-ring-value', text: '..',
                        x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                    });
                    const dial = new St.Widget({layout_manager: new Clutter.BinLayout(), x_align: Clutter.ActorAlign.CENTER});
                    dial.add_child(row.ring);
                    dial.add_child(row.value);
                    box.add_child(dial);
                } else {
                    row.value = new St.Label({style_class: 'nyx-big', text: '..', x_align: Clutter.ActorAlign.CENTER});
                    box.add_child(row.value);
                }
                const label = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
                label.add_child(icon);
                label.add_child(name);
                box.add_child(label);
                rows.add_child(box);
            } else {
                const box = new St.BoxLayout({style_class: 'nyx-row', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
                const line = new St.BoxLayout({x_expand: true});
                line.add_child(icon);
                line.add_child(name);
                row.value = new St.Label({
                    style_class: 'nyx-value', text: '..', x_expand: true,
                    x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER,
                });
                line.add_child(row.value);
                box.add_child(line);
                if (style === 'blocks') {
                    const n = wide ? 5 : 10;
                    const width = Math.floor((this._trackWidth - (n - 1) * BLOCK_GAP) / n);
                    const strip = new St.BoxLayout({style_class: 'nyx-blocks'});
                    row.blocks = Array.from({length: n}, () => {
                        const block = new St.Widget({style_class: 'nyx-block', width});
                        strip.add_child(block);
                        return block;
                    });
                    box.add_child(strip);
                } else {
                    const track = new St.Widget({style_class: 'nyx-track', width: this._trackWidth, layout_manager: new Clutter.FixedLayout()});
                    row.fill = new St.Widget({style_class: 'nyx-fill', width: 0});
                    track.add_child(row.fill);
                    box.add_child(track);
                }
                rows.add_child(box);
            }
            this._rows[r.id] = row;
        }
        this._inner.add_child(rows);
        this._root.add_child(this._card);
        Main.layoutManager.addTopChrome(this._root);
        // On the stage, so its size is known; the figure goes in below it.
        this._root.add_child(this._controls);
        this._sizeControlsSpot();
        this._controlsSpot.connect('notify::allocation', () => this._placeControls());
        this._card.connect('notify::allocation', () => this._placeControls());
        this._card.bind_property('translation-x', this._controls, 'translation-x', GObject.BindingFlags.SYNC_CREATE);

        // Nyx's looks: her variant, plus the poses drawn in that outfit (peek, sleep, duck, music...) and
        // her resting poses, if any. The resting, music and meeting poses breathe while they show.
        this._base = this._makeLook(spec, nw, nh);
        this._poses = {};
        for (const [p, key] of Object.entries(spec.poses ?? {})) {
            const ps = this._manifest.poses[key];
            this._poses[p] = this._makeLook(ps, ...px(ps));
        }
        this._restKeys = (spec.rest ?? []).filter(key => this._manifest.poses[key]);
        this._rests = this._restKeys.map(key => this._makeLook(this._manifest.poses[key], ...px(this._manifest.poses[key])));
        for (const l of [...this._rests, this._poses.music, this._poses.meeting].filter(Boolean))
            l.calm = true;
        if (this._beachOn())
            this._base.calm = true; // every pose of the beach series breathes, the first one too
        const looks = [this._base, ...Object.values(this._poses), ...this._rests];
        this._looks = looks;
        // Each look takes clicks, hover and drags in full mode only (see _applyMode); idle Nyx lets them through.
        for (const l of looks) {
            l.group.connect('button-press-event', (_a, event) => this._press(event));
            l.group.connect('motion-event', (_a, event) => this._pointerMove(l, event));
            l.group.connect('button-release-event', () => this._release());
            l.group.connect('leave-event', () => {
                this._patState = null;
                return Clutter.EVENT_PROPAGATE;
            });
        }

        // The card's height comes from its CSS, known only once it is on the stage.
        const [, cardHeight] = this._card.get_preferred_height(cardWidth);
        let width, height;
        if (wide) {
            [width, height] = [nw, nh - SINK + cardHeight];
            this._card.set_position(0, nh - SINK);
        } else {
            // Perched poses sit centred on the card's top edge; the others stand at its right. A pose
            // wider than its look to the left (the standing cheer's pom-poms) carries a negative dx, so
            // she stands on the same spot.
            const perched = looks.filter(l => l.spec.layout === 'perch');
            const beside = looks.filter(l => l.spec.layout !== 'perch');
            const offset = Math.round(this._newKey('figure-offset') * scale); // the room asked for beside the card
            for (const l of beside)
                l.dx = Math.round((l.spec.dx ?? 0) * scale) + offset;
            const pad = Math.max(0, ...perched.map(l => Math.ceil((l.w - CARD_WIDTH) / 2)));
            height = Math.max(cardHeight, ...beside.map(l => l.h), ...perched.map(l => cardHeight + l.h - PERCH_SINK));
            width = pad + CARD_WIDTH - OVERLAP + Math.max(...beside.map(l => l.w + l.dx));
            const cardY = height - cardHeight;
            this._card.set_position(pad, cardY);
            for (const l of beside)
                Object.assign(l, {x: pad + CARD_WIDTH - OVERLAP + l.dx, y: height - l.h});
            for (const l of perched)
                Object.assign(l, {x: pad + Math.round((CARD_WIDTH - l.w) / 2), y: cardY - l.h + PERCH_SINK});
        }
        this._size = [width, height];
        this._root.set_size(width, height);

        // The figure holds every look, one showing at a time (the one she rests in: _home); idle opacity
        // and the muted colour go on it so they cover whichever look shows.
        this._figure = new St.Widget({width, height, layout_manager: new Clutter.FixedLayout()});
        // The standing looks cast a soft shadow on the floor under their feet (assets/ground.json), behind her.
        for (const l of looks) {
            const span = this._ground?.[l.spec.body];
            if (l.spec.layout !== 'beside' || !span)
                continue;
            // St draws a radial gradient as a circle, so the shadow is a square squashed into an ellipse.
            const sw = Math.max(36, Math.round((span.x1 - span.x0) * l.w * 1.25));
            l.shadow = new St.Widget({style_class: 'nyx-shadow', width: sw, height: sw, reactive: false});
            l.shadow.set_pivot_point(0.5, 0.5);
            l.shadow.set_position(Math.round(l.x + (span.x0 + span.x1) / 2 * l.w - sw / 2),
                Math.round(l.y + l.h - sw / 2 - SHADOW_H * scale * 0.15));
            l.shadowFlat = SHADOW_H * scale / sw;
            this._figure.add_child(l.shadow);
            for (const prop of ['translation-x', 'translation-y', 'opacity', 'visible'])
                l.group.connect(`notify::${prop}`, () => this._shadowFollow(l));
        }
        const first = this._home();
        for (const l of looks) {
            l.group.set_position(l.x, l.y);
            this._figure.add_child(l.group);
            if (l !== first) {
                l.group.opacity = 0;
                l.group.hide();
            }
            this._shadowFollow(l);
        }
        this._look = first;
        this._root.insert_child_below(this._figure, this._controls);

        this._bubble = new St.Label({style_class: 'nyx-bubble', opacity: 0, visible: false});
        this._bubble.clutter_text.line_wrap = true;
        this._bubble.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._bubble.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._root.add_child(this._bubble);
        this._floats = [0, 1, 2].map(i => {
            const z = new St.Label({style_class: `nyx-zzz nyx-zzz-${i}`, opacity: 0});
            this._root.add_child(z);
            return z;
        });
        this._floatKind = null;
        this._alertLabel = new St.Label({style_class: 'nyx-alert', text: '!', opacity: 0, visible: false});
        this._root.add_child(this._alertLabel);

        this._applyMode();
        this._place();
        this._refreshFloat();
        this._breathe(first);
        this._fanFor(first);
        this._clipFor(first);
        this._refreshSweat();
        this._refreshNod();
        this._scheduleMoments();
        this._scheduleRotation();
        this._breezeLater();
    }

    // One look of Nyx: limbs under the body (the cuff and the knee hide the joint while they
    // rotate), then the body, the blink frame and the face overlays, all the same size.
    _makeLook(spec, w, h) {
        const group = new St.Widget({width: w, height: h, layout_manager: new Clutter.FixedLayout()});
        group.set_pivot_point(0.5, 1);
        const look = {spec, group, w, h, faces: {}, x: 0, y: 0};
        // Empty and not reactive: it only widens the look's paint volume, for the hair's swing past her edge
        // (MotionEffect), on a look with a hand or feet for the limb's whole layer as it turns, and on a look with a
        // clip for the frames that reach past the still (the cheer's pom-poms).
        const reach = Math.max(0, ...[['hand', 'hand_pivot'], ['feet', 'feet_pivot']]
            .filter(([limb]) => spec[limb]).map(([, pivot]) => limbReach(w, h, spec[pivot], LIMB_TURN)));
        const clipAt = spec.clip ? clipBox(spec.clip, spec.size, w, h) : null;
        look.margin = Math.max(SWAY_MARGIN, Math.ceil(reach) + 1, (clipAt?.reach ?? 0) + 1);
        const m = look.margin;
        group.add_child(new St.Widget({x: -m, y: -m, width: w + 2 * m, height: h + 2 * m}));
        const asset = file => image(assetPath(this._dir, this._pack, file), w, h);
        for (const [limb, pivot] of [['hand', 'hand_pivot'], ['feet', 'feet_pivot']]) {
            if (spec[limb]) {
                look[limb] = asset(spec[limb]);
                look[limb].set_pivot_point(...spec[pivot]);
                group.add_child(look[limb]);
            }
        }
        look.body = asset(spec.body);
        group.add_child(look.body);
        if (spec.alt) {
            // A second frame of the same pose (the cheer's pom-poms down), swapped with the body on the beat.
            look.alt = asset(spec.alt);
            look.alt.opacity = 0;
            group.add_child(look.alt);
        }
        if (spec.clip) {
            // Her video pose (a Wan 2.2 clip, variants.json `clip`): one actor over the body shows the playing frame.
            // The frames are decoded only while the look shows (_clipFor) and dropped when it leaves.
            const {x, y, width, height} = clipAt;
            // Its strip's path is fixed now: on a switch the new character's pack loads while this look still shows for
            // the fade out, and a clip started then must not look in her folder.
            look.clip = {spec: spec.clip, path: assetPath(this._dir, this._pack, spec.clip.strip),
                actor: new Clutter.Actor({x, y, width, height, opacity: 0}), contents: [], made: 0, index: -1};
            group.add_child(look.clip.actor);
        }
        if (spec.blink) {
            look.blink = asset(spec.blink);
            look.blink.opacity = 0;
            group.add_child(look.blink);
        }
        for (const [face, file] of Object.entries(spec.faces ?? {})) {
            look.faces[face] = asset(file);
            look.faces[face].opacity = 0;
            group.add_child(look.faces[face]);
        }
        return look;
    }

    _destroyUi() {
        this._gen++;
        this._running = 0;
        if (this._animId)
            GLib.Source.remove(this._animId);
        this._animId = 0;
        if (this._rotateId)
            GLib.Source.remove(this._rotateId);
        this._rotateId = 0;
        this._stopFloat();
        if (this._breathId)
            GLib.Source.remove(this._breathId);
        this._breathId = 0;
        for (const id of this._timers ?? [])
            GLib.Source.remove(id);
        this._timers?.clear();
        this._dragCancel();
        this._patState = null;
        this._patting = false;
        for (const key of ['_breezeId', '_sweatId', '_fanId']) {
            if (this[key])
                GLib.Source.remove(this[key]);
            this[key] = 0;
        }
        for (const l of this._looks ?? []) {
            this._motionStop(l);
            this._clipRelease(l, false);
        }
        this._hearts?.clear(); // they go with the root; nothing destroys them twice
        this._root?.destroy();
        this._root = this._card = this._inner = this._pin = this._beachBtn = this._gearBtn = this._controls = this._controlsSpot = this._figure = this._bubble = this._title = null;
        this._base = this._look = this._poses = this._rests = this._restKeys = this._looks = this._floats = this._rows = null;
        this._sweat = this._alertLabel = null;
    }

    _rebuild() {
        this._destroyUi();
        this._build();
        this._sample();
    }

    // A soft fade out, the gadget rebuilt with its new look, and a fade back in.
    async _fadeRebuild() {
        const LINEAR = Clutter.AnimationMode.LINEAR;
        if (this._root?.visible && !await this._step(this._gen, this._figure, {opacity: 0, duration: 400, mode: LINEAR}))
            return;
        this._rebuild();
        const target = this._figure.opacity;
        this._figure.opacity = 0;
        this._figure.ease({opacity: target, duration: 400, mode: LINEAR});
    }

    // The screen below the primary one when it is connected, else the primary (stats.js pickMonitor).
    _monitorIndex() {
        const lm = Main.layoutManager;
        return pickMonitor(lm.monitors.map(m => ({x: m.x, y: m.y, width: m.width, height: m.height})), lm.primaryIndex);
    }

    _place() {
        if (!this._root)
            return;
        const wa = Main.layoutManager.getWorkAreaForMonitor(this._monitorIndex());
        this._root.set_position(
            wa.x + wa.width - this._size[0] - MARGIN,
            wa.y + wa.height - this._size[1] - MARGIN);
        this._updateVisibility();
    }

    // ---- modes -------------------------------------------------------------------------------

    // The greeting of the look on screen: a wave with a hand or a wave clip (2B's look has no cut-out hand; a clip
    // whose frames fail to load falls through _move to the hop), the feet swinging when lying, else a hop.
    _greeting() {
        const spec = this._look?.spec ?? this._spec;
        return spec.hand || spec.clip?.once ? 'wave' : spec.feet ? 'feet' : 'hop';
    }

    _toggleFull() {
        this._full = !this._full;
        this._applyMode();
        if (this._full && !this._sleeping)
            this._play(this._greeting());
    }

    _idleOpacity() {
        return this._settings.get_int('idle-opacity') * 255 / 100;
    }

    // The bubble and the zzz stay readable in idle mode: a little above the card's text.
    _textOpacity() {
        return this._full ? 255 : Math.round(Math.min(255, this._idleOpacity() + 70));
    }

    _applyMode() {
        const idle = this._idleOpacity();
        if (this._full) {
            this._card.add_style_class_name('nyx-full');
            this._pin.add_style_class_name('nyx-pin-on');
            this._figure.remove_effect_by_name('muted');
        } else {
            this._card.remove_style_class_name('nyx-full');
            this._pin.remove_style_class_name('nyx-pin-on');
            if (!this._figure.get_effect('muted'))
                this._figure.add_effect_with_name('muted', new Clutter.DesaturateEffect({factor: 0.35}));
        }
        if (this._beachBtn)
            this._beachBtn.visible = this._full;
        this._gearBtn.visible = this._full;
        this._sizeControlsSpot();
        this._inner.opacity = this._full ? 255 : Math.round(Math.min(255, idle + 40));
        this._controls.opacity = this._inner.opacity;
        this._figure.opacity = this._full ? 255 : Math.round(idle);
        for (const l of this._looks)
            l.group.reactive = this._full;
        if (!this._full) {
            this._tapStreak = 0;
            this._held = this._patState = null;
            if (this._dragging) // back to idle while she hangs: she drops to her spot
                this._dragDrop().catch(e => console.error(e));
        }
        if (this._bubble.visible && this._bubble.opacity > 0)
            this._bubble.opacity = this._textOpacity();
        this._updateVisibility();
    }

    // Her name and the PC's (characters.js cardTitle).
    _titleText() {
        return cardTitle(this._pack, this._newKey('pc-name'));
    }

    // The header keeps a spot as big as the buttons that show, so the title leaves them room.
    _sizeControlsSpot() {
        const [, width] = this._controls.get_preferred_width(-1);
        const [, height] = this._controls.get_preferred_height(width);
        this._controlsSpot.set_size(width, height);
    }

    // The buttons' layer over their spot in the header, in the root's coordinates (the card's shake moves both: its
    // translation is bound to the layer's).
    _placeControls() {
        if (!this._controls)
            return;
        let [x, y] = [0, 0];
        for (let a = this._controlsSpot; a && a !== this._root; a = a.get_parent()) {
            const box = a.get_allocation_box();
            x += box.x1;
            y += box.y1;
        }
        this._controls.set_position(Math.round(x), Math.round(y));
    }

    _updateVisibility() {
        if (!this._root)
            return;
        const monitor = Main.layoutManager.monitors[this._monitorIndex()];
        const hide = !this._full && (this._inOverview || Boolean(monitor?.inFullscreen));
        this._root.visible = !hide;
        this._refreshNod();
    }

    // ---- data and reactions ------------------------------------------------------------------

    _sample() {
        if (!this._root?.visible)
            return;
        const s = snapshot(this._cpuPrev, readText('/proc/stat'), readText('/proc/meminfo'),
            this._gpuPath ? readText(this._gpuPath) : null);
        if (s.cpuSample)
            this._cpuPrev = s.cpuSample;
        const values = {
            cpu: s.cpu,
            // A third of the width per stat (the wide card, the columns): used RAM only.
            ram: {...s.ram, text: s.ram.totalText && !this._narrow ? `${s.ram.text} / ${s.ram.totalText}` : s.ram.text},
            gpu: s.gpu,
        };
        for (const [id, row] of Object.entries(this._rows))
            this._showStat(row, values[id]);
        this._react({cpu: s.cpu.fraction, gpu: s.gpu.fraction, ram: s.ram.fraction});
        this._heatSample();
    }

    // One stat in the card's style: its value, then the meter in the palette's colour for its load (styles are set
    // only when the colour or the lit blocks change).
    _showStat(row, v) {
        const fraction = Math.min(1, Math.max(0, v.fraction || 0));
        const color = statColor(this._palette, row.id, v.fraction);
        const changed = color !== row.color;
        row.value.text = v.text;
        row.fraction = fraction;
        row.color = color;
        if (row.fill) {
            row.fill.width = Math.round(this._trackWidth * fraction);
            if (changed)
                row.fill.style = `background-color: ${color};`;
        } else if (row.blocks) {
            const lit = blocksLit(fraction, row.blocks.length);
            if (changed || lit !== row.lit) {
                row.blocks.forEach((b, i) => (b.style = i < lit ? `background-color: ${color};` : null));
                row.lit = lit;
            }
        } else if (row.ring) {
            row.ring.queue_repaint();
        } else if (changed) {
            row.value.style = `color: ${color};`;
        }
    }

    // A ring gauge: a faint full circle, then the load's arc from the top, clockwise, in its colour.
    _paintRing(area, row) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const r = Math.min(w, h) / 2 - RING_STROKE / 2 - 1;
        cr.setLineWidth(RING_STROKE);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setSourceRGBA(1, 1, 1, 0.10);
        cr.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
        cr.stroke();
        const sweep = ringSweep(row.fraction);
        if (sweep > 0 && row.color) {
            cr.setSourceRGBA(...hexRgb(row.color), 1);
            cr.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + sweep);
            cr.stroke();
        }
        cr.$dispose();
    }

    // ---- heat --------------------------------------------------------------------------------

    // The CPU's and the GPU's temperatures, steadied over two samples (stats.js heatStep).
    _heatSample() {
        const t = this._tempPaths;
        if (!t?.cpu && !t?.gpu)
            return;
        const was = this._heat.hot;
        this._heat = heatStep(this._heat, {
            cpu: t.cpu ? parseMilliC(readText(t.cpu)) : null,
            gpu: t.gpu ? parseMilliC(readText(t.gpu)) : null,
        });
        if (this._heat.hot !== was)
            this._setHot(this._heat.hot);
    }

    // Hot: a phrase once for the spell (not asleep, in a meeting or the demo), the sweat drop, and the fan pose of
    // her look when it has one; cool again, both go.
    _setHot(hot) {
        if (!this._root)
            return;
        if (hot && !this._sleeping && !this._demoOn && this._ctx.context !== 'meeting')
            this._say('heat');
        this._refreshSweat();
        this._settleHome();
    }

    // The sweat drop runs down beside her head every 2 s while she is hot (or the demo's heat step), on whichever
    // look shows; never while she sleeps.
    _refreshSweat() {
        if (!this._root)
            return;
        const want = !this._sleeping && (this._heatDemo || (this._heat.hot && !this._demoOn));
        if (!want) {
            if (this._sweatId)
                GLib.Source.remove(this._sweatId);
            this._sweatId = 0;
            if (this._sweat) {
                this._sweat.remove_all_transitions();
                this._sweat.opacity = 0;
            }
            return;
        }
        const s = this._scale();
        this._sweat ??= image(`${this._dir}/assets/nyx-sweat.png`, Math.round(18 * s), Math.round(26 * s));
        if (this._sweatId) {
            this._placeSweat();
            return;
        }
        const d = this._sweat;
        const drip = () => {
            d.remove_all_transitions();
            d.translation_y = 0;
            d.opacity = 0;
            d.ease({opacity: 255, duration: 300, mode: Clutter.AnimationMode.LINEAR});
            d.ease({
                translation_y: Math.round(12 * s), duration: 1500, mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: finished => {
                    if (finished)
                        d.ease({opacity: 0, duration: 250, mode: Clutter.AnimationMode.LINEAR});
                },
            });
            return GLib.SOURCE_CONTINUE;
        };
        this._drip = drip;
        this._placeSweat();
        drip();
        this._sweatId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, drip);
    }

    // The drop sits on the side of her head, in the look on screen so it jumps, swings and flips with her. Moved
    // to another look it starts its run again (taken off a look, its eases stop where they are).
    _placeSweat() {
        const d = this._sweat, look = this._look;
        if (!d || !look?.group)
            return;
        const [x0, y0, x1, y1] = look.spec.head;
        d.set_position(Math.round((x0 + 0.8 * (x1 - x0)) * look.w), Math.round((y0 + 0.65 * (y1 - y0)) * look.h));
        if (d.get_parent() === look.group)
            return;
        d.get_parent()?.remove_child(d);
        look.group.add_child(d);
        if (this._sweatId)
            this._drip?.();
    }

    // The fan pose fans herself: its fan hand turns at the wrist, back and forth, while it shows.
    _fanFor(look) {
        if (this._fanId)
            GLib.Source.remove(this._fanId);
        this._fanId = 0;
        const hot = this._poses?.hot;
        if (hot?.hand && hot !== look) {
            hot.hand.remove_all_transitions();
            hot.hand.rotation_angle_z = 0;
        }
        if (!hot?.hand || hot !== look || this._clipLoops(hot)) // the fan clip fans on its own
            return;
        let out = false;
        const swing = () => {
            out = !out;
            hot.hand.ease({rotation_angle_z: out ? -10 : 3, duration: 280, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE});
            return GLib.SOURCE_CONTINUE;
        };
        swing();
        this._fanId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, swing);
    }

    // ---- video poses ---------------------------------------------------------------------------------

    // The look that shows plays its clip in a loop (its `gap` holds the first frame between plays); a once clip, the
    // wave, plays from _move instead. Every other clip stops on its frame, and lets go of its frames once hidden.
    _clipFor(look) {
        for (const l of this._looks ?? []) {
            if (l === look || !l.clip)
                continue;
            if (l.group.visible)
                this._clipPause(l);
            else
                this._clipRelease(l);
        }
        if (this._clipLoops(look))
            this._clipStart(look);
    }

    _clipLoops(look) {
        return Boolean(look?.clip && !look.clip.spec.once && !look.clip.failed);
    }

    // The frame clock starts now; the strip decodes off the main loop and the clip takes over from the still at its
    // first frame (the still it was rendered from) as soon as it is in.
    _clipStart(look) {
        const c = look.clip;
        if (c.id || c.failed)
            return;
        c.start = null;
        c.id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(1000 / c.spec.fps), () => this._clipTick(look));
        this._clipLoad(look);
    }

    // Resolves when the once clip has played (true, or false if the UI was rebuilt), or null when its frames cannot
    // load, so the caller falls back to the cut-out hand.
    _clipOnce(look, gen) {
        const c = look.clip;
        if (c.failed || gen !== this._gen)
            return Promise.resolve(c.failed ? null : false);
        return new Promise(resolve => {
            const before = c.done;
            // The frames must be in and played well within this, or the hand takes over (a strip that never loads
            // must not hold _running, and with it every moment, forever).
            const limit = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(c.spec.frames / c.spec.fps * 1000) + 3000, () => {
                if (c.done === finish)
                    this._clipRelease(look, null);
                return GLib.SOURCE_REMOVE;
            });
            const finish = ok => {
                GLib.Source.remove(limit);
                before?.(ok);
                resolve(ok === null ? null : gen === this._gen);
            };
            c.done = finish;
            this._clipStart(look);
        });
    }

    _clipLoad(look) {
        const c = look.clip;
        if (c.pixbuf || c.made === c.spec.frames || c.cancel)
            return;
        const cancel = c.cancel = new Gio.Cancellable();
        const fail = e => {
            if (c.cancel === cancel)
                c.cancel = null;
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            console.warn(`nyx-monitor: ${c.spec.strip}: ${e.message}`);
            c.failed = true;
            this._clipRelease(look, null);
        };
        Gio.File.new_for_path(c.path).read_async(GLib.PRIORITY_DEFAULT, cancel, (f, res) => {
            let stream;
            try {
                stream = f.read_finish(res);
            } catch (e) {
                fail(e);
                return;
            }
            GdkPixbuf.Pixbuf.new_from_stream_async(stream, cancel, (_s, res2) => {
                try {
                    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(res2);
                    if (c.cancel === cancel) {
                        c.cancel = null;
                        c.pixbuf = pixbuf;
                    }
                } catch (e) {
                    fail(e);
                } finally {
                    stream.close_async(GLib.PRIORITY_DEFAULT, null, null);
                }
            });
        });
    }

    // One frame of the decoded strip as a texture, made the first time it shows: one upload per tick, not 36 at once.
    _clipContent(c, i) {
        if (!c.contents[i]) {
            const w = c.pixbuf.get_width();
            const h = c.pixbuf.get_height() / c.spec.frames;
            const frame = c.pixbuf.new_subpixbuf(0, i * h, w, h);
            const content = St.ImageContent.new_with_preferred_size(w, h);
            content.set_bytes(global.stage.context.get_backend().get_cogl_context(), frame.read_pixel_bytes(),
                frame.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888, w, h, frame.get_rowstride());
            c.contents[i] = content;
            if (++c.made === c.spec.frames)
                c.pixbuf = null; // every frame is a texture now
        }
        return c.contents[i];
    }

    _clipTick(look) {
        const c = look.clip;
        if (!c?.id)
            return GLib.SOURCE_REMOVE;
        if ((!c.pixbuf && c.made !== c.spec.frames) || !this._root?.visible)
            return GLib.SOURCE_CONTINUE; // still decoding, or nobody can see her
        const now = GLib.get_monotonic_time() / 1000;
        if (c.start === null) {
            c.start = now;
            c.index = 0;
            c.actor.set_content(this._clipContent(c, 0));
            c.actor.opacity = 255;
            for (const part of [look.body, look.hand, look.alt].filter(Boolean))
                part.opacity = 0;
            c.shown = true;
        }
        const {index, done} = clipFrame(c.spec, now - c.start);
        if (done) {
            c.id = 0;
            this._clipRelease(look, true);
            return GLib.SOURCE_REMOVE;
        }
        if (index !== c.index) {
            c.index = index;
            c.actor.set_content(this._clipContent(c, index));
        }
        return GLib.SOURCE_CONTINUE;
    }

    // Stops the frame clock and holds the frame that shows (a crossfade away from her).
    _clipPause(look) {
        const c = look.clip;
        if (c?.id) {
            GLib.Source.remove(c.id);
            c.id = 0;
        }
    }

    // Back to the still and its parts, and the frames go; a waiting once clip learns how it ended (`outcome`).
    _clipRelease(look, outcome = false) {
        const c = look.clip;
        if (!c)
            return;
        this._clipPause(look);
        c.cancel?.cancel();
        c.cancel = null;
        if (c.shown) {
            look.body.opacity = 255;
            if (look.hand)
                look.hand.opacity = 255;
            if (look.alt)
                look.alt.opacity = 0;
            c.actor.opacity = 0;
            c.shown = false;
        }
        c.actor.set_content(null);
        c.contents = [];
        c.made = 0;
        c.pixbuf = null;
        c.index = -1;
        const done = c.done;
        c.done = null;
        done?.(outcome);
    }

    _scale() {
        return this._settings.get_int('size') / 100;
    }

    _react(sample) {
        if (!this._spec.faces || this._demoOn)
            return;
        this._history.push(sample);
        if (this._history.length > HISTORY)
            this._history.shift();
        const r = reaction(this._history);
        const face = r && this._base.faces[r] && this._ctx.context !== 'meeting' ? r : null;
        if (face === this._reactFace)
            return;
        this._reactFace = face;
        this._refreshFace();
        this._settleHome(); // a resting pose gives way to her usual look, where the faces are drawn
        const now = GLib.get_monotonic_time() / 1000;
        if (face && this._look === this._base && !this._sleeping && now - this._lastReactSay > REACTION_QUIET_MS) {
            this._lastReactSay = now;
            this._say(reactionPhrases(face));
        }
    }

    // A reaction wins over a moment's face; no face shows on a pose or while she sleeps.
    _refreshFace() {
        const want = this._look === this._base && !this._sleeping ? this._reactFace ?? this._momentFace : null;
        this._face = want;
        for (const [name, actor] of Object.entries(this._base.faces))
            actor.ease({opacity: name === want ? 255 : 0, duration: FADE_MS, mode: Clutter.AnimationMode.LINEAR});
    }

    // ---- sleep -------------------------------------------------------------------------------

    _checkSleep() {
        if (!this._root || this._demoOn || this._worryActive() || this._ctx.context === 'meeting' || this._beachOn())
            return;
        const idleMs = global.backend.get_core_idle_monitor().get_idletime();
        const asleep = shouldSleep(idleMs, this._settings.get_uint('sleep-minutes'));
        if (asleep && !this._sleeping)
            this._fallAsleep();
        else if (!asleep && this._sleeping)
            this._wakeUp();
    }

    _fallAsleep() {
        this._sleeping = true;
        this._running = 0; // a moment in progress stops at its next step
        this._momentFace = null;
        this._hideBubble();
        const gen = this._gen;
        // The sweater Nyx naps on the card; the others close their eyes where they are.
        if (this._poses.sleep) {
            this._show(this._poses.sleep, gen);
        } else {
            this._show(this._base, gen);
            this._base.blink?.ease({opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.LINEAR});
        }
        this._refreshFace();
        this._refreshFloat();
        this._refreshSweat();
        this._refreshNod();
    }

    // Awake again, back to the look she rests in, with its greeting. `quiet` skips the greeting and its
    // phrase (a meeting woke her up).
    async _wakeUp(quiet = false) {
        this._sleeping = false;
        this._refreshFloat();
        this._refreshSweat();
        this._refreshNod();
        const gen = this._gen;
        this._base.blink?.ease({opacity: 0, duration: FADE_MS, mode: Clutter.AnimationMode.LINEAR});
        if (await this._show(this._home(), gen) && !this._sleeping && !quiet)
            await this._play(this._greeting(), 'wake');
    }

    // ---- what floats up from her head and how she breathes ------------------------------------

    // zzz while she sleeps, else whatever the look on screen floats (notes, hearts), else notes while
    // music plays on a look without headphones drawn, else nothing.
    _refreshFloat() {
        if (!this._floats)
            return;
        const music = this._ctx.context === 'music' && !this._poses.music && !this._demoOn ? 'notes' : null;
        const kind = this._sleeping ? 'zzz' : this._look?.spec.float ?? music;
        if (kind === this._floatKind)
            return;
        this._stopFloat();
        this._floatKind = kind;
        if (FLOATS[kind])
            this._startFloat(kind);
    }

    _startFloat(kind) {
        const {texts, every} = FLOATS[kind];
        const look = this._look;
        const [, y0, x1] = look.spec.head;
        const ax = look.x + x1 * look.w - 12;
        const ay = look.y + y0 * look.h - 6;
        this._floats.forEach((z, k) => {
            z.text = texts[k];
            z.style_class = `nyx-zzz nyx-zzz-${k} nyx-float-${kind}`;
        });
        let i = 0;
        const puff = () => {
            const z = this._floats[i % 3];
            z.remove_all_transitions();
            z.set_position(Math.round(ax + (i % 3) * 7), Math.round(ay));
            z.translation_x = z.translation_y = 0;
            z.opacity = 0;
            i++;
            z.ease({translation_y: -34, translation_x: 14, duration: 2000, mode: Clutter.AnimationMode.EASE_OUT_SINE});
            z.ease({
                opacity: this._textOpacity(), duration: 500, mode: Clutter.AnimationMode.LINEAR,
                onStopped: finished => {
                    if (finished)
                        z.ease({opacity: 0, duration: 1400, mode: Clutter.AnimationMode.LINEAR});
                },
            });
            return GLib.SOURCE_CONTINUE;
        };
        puff();
        this._floatId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, every, puff);
    }

    _stopFloat() {
        if (this._floatId)
            GLib.Source.remove(this._floatId);
        this._floatId = 0;
        this._floatKind = null;
        for (const z of this._floats ?? [])
            z.ease({opacity: 0, duration: FADE_MS, mode: Clutter.AnimationMode.LINEAR});
    }

    // The resting, music and meeting poses rise and fall a little, from her feet, while they show.
    _breathe(look) {
        if (this._breathId)
            GLib.Source.remove(this._breathId);
        this._breathId = 0;
        for (const l of this._looks ?? []) {
            if (l !== look && l.body.scale_y !== 1) {
                l.body.remove_all_transitions();
                l.body.scale_y = 1;
            }
        }
        if (!look?.calm || this._clipLoops(look)) // a clip breathes on its own
            return;
        look.body.set_pivot_point(0.5, 1);
        let up = false;
        const step = () => {
            up = !up;
            look.body.ease({scale_y: up ? 1.012 : 1, duration: BREATH_MS - 100, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE});
            return GLib.SOURCE_CONTINUE;
        };
        step();
        this._breathId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, BREATH_MS, step);
    }

    // ---- speech bubble -----------------------------------------------------------------------

    // In a meeting she keeps quiet, except to warn about the power or a failed service.
    _say(kind) {
        if (!this._bubble || !this._settings.get_boolean('phrases'))
            return;
        if (this._ctx.context === 'meeting' && !WORRY_KINDS.includes(kind))
            return;
        // Each kind starts at a random phrase, then walks its list without repeating back to back. A kind the
        // character has no lines for shows nothing.
        this._phraseN[kind] ??= Math.floor(Math.random() * 1000);
        const text = phraseFor(kind, this._phraseN[kind]++, this._phrases);
        if (!text)
            return;
        this._bubble.text = text;
        this._placeBubble();
        this._bubble.show();
        this._bubble.ease({opacity: this._textOpacity(), duration: 150, mode: Clutter.AnimationMode.LINEAR});
        const token = ++this._bubbleToken;
        this._wait(this._gen, BUBBLE_MS).then(ok => {
            if (ok && token === this._bubbleToken)
                this._hideBubble();
        });
    }

    _hideBubble() {
        this._bubbleToken++;
        const b = this._bubble;
        b?.ease({
            opacity: 0, duration: 250, mode: Clutter.AnimationMode.LINEAR,
            onStopped: finished => {
                if (finished)
                    b.hide();
            },
        });
    }

    // Beside Nyx the bubble floats left of her head over the empty space above the card; on a
    // perched pose it goes right of her head; over the lying Nyx it sits above her head.
    _placeBubble() {
        const b = this._bubble;
        const look = this._look;
        const [x0, y0, x1, y1] = look.spec.head;
        const head = {
            left: look.x + x0 * look.w, right: look.x + x1 * look.w,
            top: look.y + y0 * look.h, height: (y1 - y0) * look.h,
        };
        b.set_width(-1);
        const [, natural] = b.get_preferred_width(-1);
        const w = Math.min(natural, BUBBLE_MAX_WIDTH);
        b.set_width(w);
        const [, h] = b.get_preferred_height(w);
        let x, y, tail;
        if (look.spec.layout === 'perch')
            [x, y, tail] = [head.right - 8, head.top, 'left'];
        else if (look.spec.layout === 'top')
            [x, y, tail] = [head.left, head.top - h - 6, 'left'];
        else
            [x, y, tail] = [head.left + 10 - w, head.top + head.height * 0.15, 'right'];
        b.set_position(Math.round(x), Math.round(y));
        b.style_class = `nyx-bubble nyx-bubble-${tail}`;
    }

    // ---- moments and moves -------------------------------------------------------------------

    _scheduleMoments() {
        const minutes = this._settings.get_uint('animation-minutes');
        if (minutes === 0 || this._beachOn()) // the beach series is her animation meanwhile
            return;
        this._animId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
            this._moment();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // Resolves true after `ms`, false when the UI was rebuilt or removed meanwhile.
    _wait(gen, ms) {
        if (gen !== this._gen)
            return Promise.resolve(false);
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(0, Math.round(ms)), () => {
                this._timers.delete(id);
                resolve(gen === this._gen);
                return GLib.SOURCE_REMOVE;
            });
            this._timers.add(id);
        });
    }

    // Resolves true when the step ran, false when the UI was rebuilt or removed meanwhile.
    _step(gen, actor, props) {
        if (gen !== this._gen || !actor)
            return Promise.resolve(false);
        return new Promise(resolve => {
            actor.ease({...props, onStopped: () => resolve(gen === this._gen)});
        });
    }

    // A look at rest: no offset, no turn, no squash, pivot at her feet (the moves turn on it).
    _resetGroup(group) {
        group.set_pivot_point(0.5, 1);
        group.translation_x = group.translation_y = 0;
        group.rotation_angle_z = 0;
        group.scale_x = group.scale_y = 1;
    }

    // A move cut short (a flip, a drop) leaves her look mid-air or turned: whatever takes over first stills it.
    // Only the moves' eases go; a crossfade of its opacity carries on.
    _still(group, always = false) {
        if (!always && !group.rotation_angle_z && !group.translation_x && !group.translation_y)
            return;
        for (const p of ['rotation-angle-z', 'translation-x', 'translation-y', 'scale-x', 'scale-y'])
            group.remove_transition(p);
        this._resetGroup(group);
    }

    // Her shadow follows her look: sideways with it, smaller and fainter as she rises (stats.js shadowAt), and
    // fading with its crossfade.
    _shadowFollow(look) {
        const s = look.shadow;
        if (!s)
            return;
        const g = look.group;
        const {scale, alpha} = shadowAt(-g.translation_y / this._scale());
        s.visible = g.visible;
        s.opacity = Math.round(alpha * g.opacity);
        s.scale_x = scale;
        s.scale_y = scale * look.shadowFlat;
        s.translation_x = g.translation_x;
    }

    // Crossfades to another look; the card never moves.
    async _show(look, gen) {
        const from = this._look;
        if (from === look || gen !== this._gen)
            return gen === this._gen;
        this._look = look;
        this._refreshFace();
        this._refreshFloat();
        this._breathe(look);
        this._resetGroup(look.group);
        if (look.alt && !look.clip?.shown) {
            look.body.opacity = 255;
            look.alt.opacity = 0;
        }
        look.group.show();
        // Once it shows: an ease on a hidden actor jumps straight to its end.
        this._fanFor(look);
        this._clipFor(look);
        this._placeSweat();
        this._refreshNod();
        look.group.ease({opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.LINEAR});
        const ok = await this._step(gen, from.group, {opacity: 0, duration: FADE_MS, mode: Clutter.AnimationMode.LINEAR});
        if (ok && this._look !== from) {
            from.group.hide();
            this._clipRelease(from);
        }
        return ok;
    }

    async _blinkOnce(gen) {
        const blink = this._base.blink;
        if (!blink || this._look !== this._base || this._face || this._sleeping)
            return gen === this._gen;
        return await this._step(gen, blink, {opacity: 255, duration: 50, mode: Clutter.AnimationMode.LINEAR}) &&
            await this._step(gen, blink, {opacity: 0, delay: 110, duration: 70, mode: Clutter.AnimationMode.LINEAR});
    }

    async _move(gen, move) {
        const look = this._look;
        const SINE = Clutter.AnimationMode.EASE_IN_OUT_SINE;
        if (move === 'wave' && look.clip?.spec.once && !this._face) {
            // Her wave clip, when its frames load; the cut-out hand below stays the fallback.
            const played = await this._clipOnce(look, gen);
            if (played !== null)
                return played;
        }
        if (move === 'wave' && look.hand) {
            // Small, soft swings: the hand is a rigid cut-out turning at the wrist, and wide fast ones
            // looked like a flap (owner's note of 2026-10-30).
            for (const angle of [-11, 8, -11, 8, -11, 8, 0]) {
                if (!await this._step(gen, look.hand, {rotation_angle_z: angle, duration: 230, mode: SINE}))
                    return false;
            }
        } else if (move === 'feet' && look.feet) {
            for (const angle of [6, -4, 6, -4, 0]) {
                if (!await this._step(gen, look.feet, {rotation_angle_z: angle, duration: 280, mode: SINE}))
                    return false;
            }
        } else if (move === 'cheer' && look.alt) {
            // Pom-poms up (the body frame) while she hops, down (the alt frame) as she lands, on the beat.
            for (let i = 0; i < 12; i++) {
                const down = i % 2 === 1;
                if (!look.clip?.shown) { // the cheer clip shakes its own pom-poms
                    look.body.opacity = down ? 0 : 255;
                    look.alt.opacity = down ? 255 : 0;
                }
                if (!await this._step(gen, look.group, {
                    translation_y: down ? 0 : -14, duration: 240,
                    mode: down ? Clutter.AnimationMode.EASE_IN_QUAD : Clutter.AnimationMode.EASE_OUT_QUAD,
                }))
                    return false;
                if (down)
                    this._kick(0.5, look); // each landing swings her hair a little
            }
            if (!look.clip?.shown) {
                look.body.opacity = 255;
                look.alt.opacity = 0;
            }
        } else if (move === 'sway') {
            for (const angle of [-2.5, 2.5, -1.5, 0]) {
                if (!await this._step(gen, look.group, {rotation_angle_z: angle, duration: 300, mode: SINE}))
                    return false;
            }
        } else if (move === 'peep') {
            // A small hop, looking up at a notification; EASE_OUT_BOUNCE first lands at about 36 % of its time.
            this._kick(0.3, look);
            if (!await this._step(gen, look.group, {translation_y: -14, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD}))
                return false;
            this._wait(gen, 95).then(ok => ok && this._kick(0.5, look));
            if (!await this._step(gen, look.group, {translation_y: 0, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_BOUNCE}))
                return false;
        } else {
            // The jump (stats.js hopFrames): a crouch, up stretched, down squashed, two lower rebounds; every
            // take-off and landing swings her hair.
            for (const {kick, land, mode, ...props} of hopFrames(HOP_HEIGHT)) {
                if (kick || land)
                    this._kick(kick ?? land, look);
                if (!await this._step(gen, look.group, {...props, mode: Clutter.AnimationMode[mode]}))
                    return false;
            }
        }
        return true;
    }

    // A short move with blinks around it (full mode, waking up), with an optional phrase.
    async _play(move, phrases) {
        if (this._running || !this._root?.visible)
            return;
        const token = this._running = ++this._token;
        const gen = this._gen;
        try {
            if (phrases)
                this._say(phrases);
            await this._blinkOnce(gen) && await this._move(gen, move) && await this._blinkOnce(gen);
        } finally {
            if (this._running === token)
                this._running = 0;
        }
    }

    // A moment: a pose or a face, a move and a phrase, about 15 s, then back to the look she rests in.
    // None comes on its own while music plays or in a meeting.
    async _moment(forced) {
        if (this._running || this._sleeping || !this._root?.visible || (!forced && (this._demoOn || this._ctx.context)))
            return;
        const m = forced ?? momentFor(this._spec, this._momentCount++);
        const token = this._running = ++this._token;
        const gen = this._gen;
        const live = () => gen === this._gen && this._running === token;
        try {
            const started = GLib.get_monotonic_time();
            if (m.pose && this._poses[m.pose]) {
                if (!await this._show(this._poses[m.pose], gen) || !live())
                    return;
            } else {
                // The faces, the hand and the blink are drawn on her usual look only.
                if (!await this._show(this._base, gen) || !live())
                    return;
                if (!await this._blinkOnce(gen) || !live())
                    return;
                if (m.face && this._base.faces[m.face]) {
                    this._momentFace = m.face;
                    this._refreshFace();
                }
            }
            this._say(m.phrases);
            if (!await this._move(gen, m.move) || !live())
                return;
            const left = MOMENT_MS - (GLib.get_monotonic_time() - started) / 1000;
            if (!await this._wait(gen, left) || !live())
                return;
            if (this._momentFace) {
                this._momentFace = null;
                this._refreshFace();
            }
            if (!await this._show(this._home(), gen) || !live())
                return;
            await this._blinkOnce(gen);
        } finally {
            if (this._running === token)
                this._running = 0;
        }
    }

    // ---- clicks on Nyx (full mode only) -------------------------------------------------------

    // Every click squashes her a little; the second of a double click (the desktop's double-click time) makes her
    // flip instead. A streak of quick clicks sets off a poke at 3, a spin at 6 and the launch at 10 (stats.js
    // tapStage). A click on the sleeping Nyx just wakes her up.
    _tap() {
        if (!this._full || this._launching || !this._look)
            return Clutter.EVENT_STOP;
        if (this._sleeping) {
            this._wakeUp();
            return Clutter.EVENT_STOP;
        }
        const now = GLib.get_monotonic_time() / 1000;
        const quick = isDoubleTap(this._tapLast, now, Clutter.Settings.get_default().double_click_time ?? 400);
        this._tapStreak = tapStreak(this._tapStreak, this._tapLast, now);
        this._tapLast = now;
        const stage = tapStage(this._tapStreak);
        if (!stage && this._tapStreak === 2 && quick) {
            this._flip().catch(e => console.error(e));
            return Clutter.EVENT_STOP;
        }
        this._squish(this._look.group);
        this._kick(0.8);
        if (stage)
            (stage === 'launch' ? this._launch() : this._tapReact(stage)).catch(e => console.error(e));
        return Clutter.EVENT_STOP;
    }

    // A press on her: a click (_tap); with the left button she is picked up if the pointer then moves far enough.
    _press(event) {
        if (this._dragging)
            return Clutter.EVENT_STOP;
        const asleep = this._sleeping;
        const result = this._tap();
        this._held = null;
        if (this._full && !asleep && !this._launching && event.get_button() === Clutter.BUTTON_PRIMARY) {
            const [x, y] = event.get_coords();
            this._held = {x, y};
        }
        return result;
    }

    _pointerMove(look, event) {
        if (!this._full)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        if (this._dragging) {
            this._dragTo(x, y);
            return Clutter.EVENT_STOP;
        }
        if (this._held) {
            if (!(event.get_state() & Clutter.ModifierType.BUTTON1_MASK))
                this._held = null; // released somewhere this look did not hear
            else if (Math.hypot(x - this._held.x, y - this._held.y) > DRAG_START_PX)
                this._dragStart(this._held.x, this._held.y, x, y);
            return Clutter.EVENT_STOP;
        }
        this._hover(look, x, y);
        return Clutter.EVENT_PROPAGATE;
    }

    _release() {
        this._held = null;
        if (!this._dragging)
            return Clutter.EVENT_PROPAGATE;
        this._dragDrop().catch(e => console.error(e));
        return Clutter.EVENT_STOP;
    }

    // ---- a pat on her head (full mode only) ---------------------------------------------------

    // The pointer over her head, at stage x, y: enough stroking starts a pat (stats.js patStep), and every stroke
    // while it lasts holds it for PAT_HOLD_MS more.
    _hover(look, x, y) {
        if (look !== this._look || this._sleeping || this._launching || this._dragging || (this._running && !this._patting)) {
            this._patState = null;
            return;
        }
        const [ok, lx, ly] = look.group.transform_stage_point(x, y);
        if (!ok)
            return;
        const now = GLib.get_monotonic_time() / 1000;
        const sample = {x, y, at: now, inHead: inHead(look.spec.head, lx / look.w, ly / look.h)};
        const {state, pat} = patStep(this._patState, sample, PAT_TRAVEL * this._scale());
        this._patState = state;
        if (this._patting && state) {
            this._patUntil = now + PAT_HOLD_MS;
        } else if (pat && !this._patting) {
            this._patUntil = now + PAT_HOLD_MS;
            this._pat(look).catch(e => console.error(e));
        }
    }

    // Patted: eyes closed (the look's blink frame, where drawn), hearts floating up and a gentle lean side to side,
    // a phrase once, until the strokes stop.
    async _pat(look) {
        if (this._patting)
            return;
        const token = this._running = ++this._token;
        const gen = this._gen;
        const live = () => gen === this._gen && this._running === token;
        const g = look.group;
        this._patting = true;
        try {
            this._still(g);
            this._say('pat');
            look.blink?.ease({opacity: 255, duration: FADE_MS, mode: Clutter.AnimationMode.LINEAR});
            for (let i = 0; live() && GLib.get_monotonic_time() / 1000 < this._patUntil; i++) {
                if (i % 2 === 0) {
                    this._puffHeart(look);
                    g.ease({rotation_angle_z: i % 4 ? -2.2 : 2.2, duration: 600, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE});
                }
                if (!await this._wait(gen, 300))
                    return;
            }
        } finally {
            this._patting = false;
            if (gen === this._gen) {
                look.blink?.ease({opacity: 0, duration: FADE_MS, mode: Clutter.AnimationMode.LINEAR});
                if (this._running === token) {
                    g.ease({rotation_angle_z: 0, duration: 300, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE});
                    this._running = 0;
                    this._settleHome();
                }
            }
        }
    }

    // A heart floats up from somewhere on her head and fades.
    _puffHeart(look) {
        const [x0, y0, x1] = look.spec.head;
        const h = new St.Label({style_class: 'nyx-zzz nyx-zzz-1 nyx-float-heart', text: '♥', opacity: 0});
        this._hearts.add(h);
        this._root.add_child(h);
        h.set_position(Math.round(look.x + (x0 + (0.2 + 0.6 * Math.random()) * (x1 - x0)) * look.w),
            Math.round(look.y + y0 * look.h));
        const done = () => {
            if (this._hearts?.delete(h))
                h.destroy();
        };
        h.ease({translation_y: -40, translation_x: Math.round(10 * (Math.random() - 0.5)), duration: 1600, mode: Clutter.AnimationMode.EASE_OUT_SINE});
        h.ease({
            opacity: this._textOpacity(), duration: 300, mode: Clutter.AnimationMode.LINEAR,
            onStopped: finished => {
                if (finished)
                    h.ease({opacity: 0, duration: 1100, mode: Clutter.AnimationMode.LINEAR, onStopped: done});
                else
                    done();
            },
        });
    }

    // ---- picked up with the mouse (full mode only) ---------------------------------------------

    // The press at px, py has moved to x, y: she hangs from the spot held (her look's pivot there) and follows the
    // pointer, with a pointer grab so she keeps up when it outruns her.
    _dragStart(px, py, x = px, y = py) {
        this._held = null;
        const look = this._look;
        if (!look?.group || this._launching || this._sleeping || this._dragging)
            return;
        const token = this._running = ++this._token; // a moment, a reaction or a pat stops at its next step
        const g = look.group;
        this._dragging = true;
        this._patState = null;
        this._momentFace = null;
        this._refreshFace();
        this._still(g, true);
        const [ok, lx, ly] = g.transform_stage_point(px, py);
        const clamp01 = n => Math.min(1, Math.max(0, n));
        g.set_pivot_point(ok ? clamp01(lx / look.w) : 0.5, ok ? clamp01(ly / look.h) : 0.2);
        const now = GLib.get_monotonic_time() / 1000;
        this._drag = {look, token, x0: px, y0: py, x: px, y: py, lastX: px, vx: 0, t: now, swing: {angle: 0, vel: 0}, turn: 0};
        this._grab = global.stage.grab(g);
        this._kick(0.6, look);
        this._say('drag');
        this._refreshNod();
        const tl = new Clutter.Timeline({actor: g, duration: 1000, repeat_count: -1});
        tl.connect('new-frame', () => this._dragFrame());
        this._drag.tl = tl;
        tl.start();
        this._dragTo(x, y);
    }

    _dragTo(x, y) {
        const d = this._drag;
        if (!d)
            return;
        d.x = x;
        d.y = y;
        d.look.group.translation_x = x - d.x0;
        d.look.group.translation_y = y - d.y0;
    }

    // Each frame of the drag: the pendulum (stats.js swingStep) against the pointer's sideways acceleration, her
    // hair swinging at each end of a wide swing. A lost button (released where no look heard it) drops her.
    _dragFrame() {
        const d = this._drag;
        if (!d)
            return;
        if (this._running !== d.token) {
            this._dragCancel();
            return;
        }
        if (!this._buttonHeld()) {
            this._dragDrop().catch(e => console.error(e));
            return;
        }
        const now = GLib.get_monotonic_time() / 1000;
        const dt = Math.max(0.001, (now - d.t) / 1000);
        d.t = now;
        const vx = (d.x - d.lastX) / dt;
        d.lastX = d.x;
        const smooth = d.vx + (vx - d.vx) * Math.min(1, dt * 12);
        const ax = (smooth - d.vx) / dt;
        d.vx = smooth;
        d.swing = swingStep(d.swing, ax, dt);
        const turn = Math.sign(Math.round(d.swing.vel));
        if (turn && d.turn && turn !== d.turn && Math.abs(d.swing.angle) > 6)
            this._kick(0.5, d.look);
        if (turn)
            d.turn = turn;
        d.look.group.rotation_angle_z = d.swing.angle;
    }

    // Whether the left button is still down (read from the seat, so a release nobody heard still counts).
    _buttonHeld() {
        const [, , mods] = global.get_pointer();
        return Boolean(mods & Clutter.ModifierType.BUTTON1_MASK);
    }

    // Let go: she falls straight down to her spot, turning upright on the way, and lands with the jump's landing
    // (stats.js hopFrames from its squash on), her hair swinging.
    async _dragDrop() {
        const d = this._drag;
        if (!d)
            return;
        this._endDrag(d);
        const {look, token} = d;
        const g = look.group;
        const gen = this._gen;
        const live = () => gen === this._gen && this._running === token && this._looks?.includes(look);
        try {
            const lift = Math.max(0, -g.translation_y);
            const fall = Math.round(Math.min(700, 220 + 22 * Math.sqrt(lift)));
            g.ease({rotation_angle_z: 0, translation_x: 0, duration: Math.round(fall * 0.8), mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            if (!await this._step(gen, g, {translation_y: 0, duration: fall, mode: Clutter.AnimationMode.EASE_IN_QUAD}) || !live())
                return;
            this._still(g, true); // upright and on the spot: the pivot goes back to her feet without a jump
            for (const {kick, land, mode, ...props} of hopFrames(HOP_HEIGHT).slice(3)) {
                if (kick || land)
                    this._kick(kick ?? land, look);
                if (!await this._step(gen, g, {...props, mode: Clutter.AnimationMode[mode]}) || !live())
                    return;
            }
        } finally {
            if (gen === this._gen && this._running === token) {
                this._running = 0;
                this._settleHome();
            }
        }
    }

    // The drag's frames and grab end; she stays where she is (the drop or the cancel takes it from there).
    _endDrag(d) {
        this._drag = null;
        this._dragging = false;
        this._held = null;
        d.tl?.stop();
        this._grab?.dismiss();
        this._grab = null;
        this._refreshNod();
    }

    // A drag cut short (a rebuild, a worry): no fall, she is back on her spot at once.
    _dragCancel() {
        this._held = null;
        const d = this._drag;
        if (!d)
            return;
        this._endDrag(d);
        if (this._running === d.token)
            this._running = 0;
        if (this._looks?.includes(d.look))
            this._still(d.look.group, true);
    }

    // ---- the double-click flip ------------------------------------------------------------------

    // Up with a full turn about her centre (stats.js flipFrames), squashed on landing, one rebound; star eyes on
    // her usual look and a phrase as she lands.
    async _flip() {
        const look = this._look;
        const token = this._running = ++this._token; // a moment in progress stops at its next step
        const gen = this._gen;
        const live = () => gen === this._gen && this._running === token;
        const g = look.group;
        try {
            this._still(g, true);
            for (const {kick, land, mode, pivot, spin, rotation_angle_z: angle, ...props} of flipFrames(Math.round(FLIP_HEIGHT * this._scale()))) {
                if (pivot)
                    g.set_pivot_point(...pivot);
                if (angle !== undefined) {
                    g.remove_transition('rotation-angle-z');
                    g.rotation_angle_z = angle;
                }
                if (spin)
                    g.ease({rotation_angle_z: spin.rotation_angle_z, duration: spin.duration, mode: Clutter.AnimationMode[spin.mode]});
                if (kick || land)
                    this._kick(kick ?? land, look);
                if (land === 1) {
                    if (look === this._base && this._base.faces.stars) {
                        this._momentFace = 'stars';
                        this._refreshFace();
                    }
                    this._say('flip');
                }
                if (!await this._step(gen, g, {...props, mode: Clutter.AnimationMode[mode]}) || !live())
                    return;
            }
            await this._wait(gen, 1400);
        } finally {
            if (gen === this._gen && this._running === token) {
                this._running = 0;
                if (this._momentFace === 'stars') {
                    this._momentFace = null;
                    this._refreshFace();
                }
                this._settleHome();
            }
        }
    }

    _squish(group) {
        group.ease({
            scale_x: 1.06, scale_y: 0.9, duration: 70, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: finished => {
                if (finished && !this._launching)
                    group.ease({scale_x: 1, scale_y: 1, duration: 420, mode: Clutter.AnimationMode.EASE_OUT_ELASTIC});
            },
        });
    }

    // Swings her hair on a look (the one on screen by default): the kick adds to the wobble already going.
    _kick(strength, look = this._look) {
        if (!look?.group || !this._swayMaps?.[look.spec.body])
            return;
        const now = GLib.get_monotonic_time() / 1000;
        look.kicks = [...(look.kicks ?? []).filter(k => now - k.at < WOBBLE_MS), {at: now, strength}];
        this._motion(look);
    }

    // While her hair swings (the kicks), a gust blows (look.gust) or her head nods to music (this._nod, on the look
    // on screen), a MotionEffect deforms the look every frame; it goes once all three are still.
    _motion(look) {
        if (!look?.group || !this._looks?.includes(look))
            return;
        if (!look.fx) {
            look.fx = new MotionEffect(this._swayMaps?.[look.spec.body] ?? STILL_MAP, look.w, look.h, look.spec.head, look.margin);
            look.group.add_effect_with_name('nyx-motion', look.fx);
        }
        if (look.fxTl)
            return;
        look.fxTl = new Clutter.Timeline({actor: look.group, duration: 1000, repeat_count: -1});
        look.fxTl.connect('new-frame', () => this._motionFrame(look));
        look.fxTl.start();
    }

    _motionFrame(look) {
        if (!look.fx)
            return;
        const now = GLib.get_monotonic_time() / 1000;
        const s = this._scale();
        const wobble = wobbleAt(look.kicks ?? [], now);
        const wind = windAt(look.gust, now);
        const nod = look === this._look ? nodLevel(this._nod, now) : {level: 0, done: true};
        if (wobble.done && wind.done && nod.done) {
            this._motionStop(look);
            return;
        }
        const beat = nodAt(now - (this._nod?.since ?? now));
        const reach = NOD_AMP * s * nod.level;
        look.fx.setMotion({
            sway: wobble.value * Math.min(SWAY_AMP * s, look.margin - 1),
            wind: [-WIND_AMP * s * wind.value, -0.3 * WIND_AMP * s * wind.value],
            nod: [reach * beat.x, reach * beat.y],
        });
    }

    _motionStop(look) {
        look.fxTl?.stop();
        look.fxTl = null;
        if (look.fx)
            look.group?.remove_effect(look.fx);
        look.fx = null;
        look.kicks = [];
        look.gust = null;
    }

    // ---- the beach breeze and the music nod -----------------------------------------------------

    // In the beach mode a gust comes every 6 to 14 s (not while she hangs from the mouse).
    _breezeLater() {
        if (this._breezeId)
            GLib.Source.remove(this._breezeId);
        this._breezeId = 0;
        if (!this._beachOn())
            return;
        this._breezeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(6000 + Math.random() * 8000), () => {
            this._breezeId = 0;
            if (this._root?.visible && !this._dragging)
                this._gust(this._look);
            this._breezeLater();
            return GLib.SOURCE_REMOVE;
        });
    }

    // One gust (stats.js windAt) on a look with loose hair or clothes.
    _gust(look) {
        if (!look || !this._swayMaps?.[look.spec.body])
            return;
        look.gust = {at: GLib.get_monotonic_time() / 1000, dur: GUST_MS, strength: 0.75 + 0.25 * Math.random()};
        this._motion(look);
    }

    // While music plays (the MPRIS context) her head nods on the beat, fading in; it fades out when the music
    // stops, she falls asleep, she is picked up or the gadget hides. The demo tour leaves it out.
    _refreshNod() {
        if (!this._looks)
            return;
        const now = GLib.get_monotonic_time() / 1000;
        const want = this._ctx.context === 'music' && !this._sleeping && !this._dragging && !this._demoOn &&
            Boolean(this._root?.visible) && !this._clipLoops(this._look); // the music clip nods on its own
        if (want) {
            if (!this._nod || this._nod.until !== null)
                this._nod = {since: now, until: null};
            this._motion(this._look);
        } else if (this._nod && this._nod.until === null) {
            this._nod.until = now;
        }
    }

    // ---- notifications ----------------------------------------------------------------------------

    // A new notification of a source. Not its 'notification-request-banner': the tray hears that one first and
    // marks the notification acknowledged as it shows the banner, so it would always look seen here.
    _watchSource(source) {
        source.connectObject('notification-added', (_s, notification) => this._onNotification(source, notification), this);
    }

    // A notification that will show a banner puts the «!» over her head (stats.js notifyGate), at most once in 4 s.
    _onNotification(source, notification) {
        if (!this._root)
            return;
        const now = GLib.get_monotonic_time() / 1000;
        const ok = notifyGate({
            acknowledged: notification.acknowledged, urgency: notification.urgency,
            showBanners: source.policy?.showBanners ?? true,
        }, {
            now, last: this._lastAlert, visible: this._root.visible, meeting: this._ctx.context === 'meeting',
            sleeping: this._sleeping, busy: this._launching || this._dragging || this._demoOn,
        });
        if (!ok)
            return;
        this._lastAlert = now;
        this._alert();
    }

    // The «!» pops up over her head for ALERT_MS, and she hops when nothing else plays.
    _alert() {
        const a = this._alertLabel, look = this._look;
        if (!a || !look)
            return;
        const [x0, y0, x1] = look.spec.head;
        a.remove_all_transitions();
        a.set_scale(1, 1);
        const [, aw] = a.get_preferred_width(-1);
        const [, ah] = a.get_preferred_height(-1);
        a.set_pivot_point(0.5, 1);
        a.set_position(Math.round(look.x + (x0 + x1) / 2 * look.w - aw / 2), Math.round(look.y + y0 * look.h - ah + 4));
        a.set_scale(0.3, 0.3);
        a.opacity = 0;
        a.show();
        a.ease({scale_x: 1, scale_y: 1, opacity: this._textOpacity(), duration: 220, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        const gen = this._gen;
        this._wait(gen, ALERT_MS).then(ok => ok && a.ease({
            opacity: 0, duration: 250, mode: Clutter.AnimationMode.LINEAR,
            onStopped: finished => finished && a.hide(),
        }));
        this._play('peep').catch(e => console.error(e));
    }

    // The poke (a pout and a hop) or the spin (dizzy, a full turn on the spot and a wobble), on her
    // usual look, for a few seconds.
    async _tapReact(stage) {
        const token = this._running = ++this._token; // a moment in progress stops at its next step
        const gen = this._gen;
        const live = () => gen === this._gen && this._running === token;
        try {
            if (!await this._show(this._base, gen) || !live())
                return;
            this._still(this._base.group); // a flip cut short by the third click: the poke starts from rest
            const face = stage === 'poke' ? 'pout' : 'dizzy';
            this._momentFace = this._base.faces[face] ? face : null;
            this._refreshFace();
            this._say(stage);
            const g = this._base.group;
            if (stage === 'spin') {
                g.set_pivot_point(0.5, 0.5);
                const turned = await this._step(gen, g, {
                    rotation_angle_z: 360, duration: 750, mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
                });
                if (!turned || !live())
                    return;
                this._resetGroup(g);
                for (const angle of [-7, 5, -3, 0]) {
                    if (!await this._step(gen, g, {rotation_angle_z: angle, duration: 170, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE}) ||
                        !live())
                        return;
                }
            } else if (!await this._move(gen, 'hop') || !live()) {
                return;
            }
            if (!await this._wait(gen, 2500) || !live())
                return;
            this._momentFace = null;
            this._refreshFace();
            if (live())
                await this._show(this._home(), gen);
        } finally {
            if (this._running === token)
                this._running = 0;
        }
    }

    // Too many clicks: she crouches with a determined face, blasts off past the top of the screen,
    // the card shakes and its title says she will be right back. Then she drops back in with a
    // bounce, holding the rubber duck when her look has that pose, and returns to her usual look.
    async _launch() {
        const token = this._running = ++this._token;
        const gen = this._gen;
        const live = () => gen === this._gen && this._running === token;
        const QUAD = Clutter.AnimationMode.EASE_OUT_QUAD;
        // Far enough up to leave the top of the stage (the screen above, when there is one).
        const above = look => -Math.round(this._root.get_transformed_position()[1] + look.y + look.h + 40);
        this._launching = true;
        this._tapStreak = 0;
        let done = false;
        try {
            const base = this._base;
            if (!await this._show(base, gen) || !live())
                return;
            const g = base.group;
            g.remove_all_transitions();
            this._resetGroup(g);
            this._momentFace = base.faces.determined ? 'determined' : null;
            this._refreshFace();
            this._say('launch');
            if (!await this._step(gen, g, {scale_x: 1.14, scale_y: 0.78, duration: 280, mode: QUAD}) || !live())
                return;
            if (!await this._wait(gen, 450) || !live())
                return;
            this._hideBubble();
            g.ease({scale_x: 0.88, scale_y: 1.18, duration: 160, mode: QUAD});
            if (!await this._step(gen, g, {translation_y: above(base), duration: 650, mode: Clutter.AnimationMode.EASE_IN_CUBIC}) ||
                !live())
                return;
            g.remove_all_transitions();
            g.opacity = 0;
            g.hide();
            this._resetGroup(g);
            this._momentFace = null;
            this._refreshFace();
            this._title.text = this._pack.away;
            this._shakeCard(gen);
            if (!await this._wait(gen, AWAY_MS) || !live())
                return;

            const back = this._poses.duck ?? base;
            const bg = back.group;
            this._resetGroup(bg);
            bg.translation_y = above(back);
            bg.opacity = 255;
            bg.show();
            this._look = back;
            this._momentFace = back === base && base.faces.stars ? 'stars' : null;
            this._refreshFace();
            this._title.text = this._titleText();
            // EASE_OUT_BOUNCE first touches the ground at about 36 % of its time: her hair swings then.
            this._wait(gen, 360).then(ok => ok && this._kick(1, back));
            if (!await this._step(gen, bg, {translation_y: 0, duration: 1000, mode: Clutter.AnimationMode.EASE_OUT_BOUNCE}) ||
                !live())
                return;
            this._say(back === base ? 'back' : 'duckback');
            if (!await this._wait(gen, 4500) || !live())
                return;
            this._momentFace = null;
            this._refreshFace();
            if (!await this._show(this._home(), gen) || !live())
                return;
            await this._blinkOnce(gen);
            done = true;
        } finally {
            this._launching = false;
            if (this._running === token)
                this._running = 0;
            if (!done && gen === this._gen && this._looks)
                this._recover();
        }
    }

    // After an interrupted launch: every look at rest, only the current one showing, title back.
    _recover() {
        this._title.text = this._titleText();
        for (const l of this._looks) {
            l.group.remove_all_transitions();
            this._resetGroup(l.group);
            l.group.opacity = l === this._look ? 255 : 0;
            l.group.visible = l === this._look;
        }
        this._refreshFace();
    }

    async _shakeCard(gen) {
        for (const x of [-7, 6, -4, 3, -1, 0]) {
            if (!await this._step(gen, this._card, {translation_x: x, duration: 55, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD}))
                return;
        }
    }

    // ---- demo tour (the `demo` key) -----------------------------------------------------------

    // Every look with its greeting, then every animation on one look, a step every 10 s in full
    // colour (stats.js demoSteps). Load reactions, sleep and the periodic moments pause meanwhile;
    // at the end her look, the mode and the key go back to how they were.
    async _startDemo() {
        if (this._demoOn)
            return;
        this._demoOn = true;
        const run = ++this._demoRun;
        this._demoWasFull = this._full;
        const steps = demoSteps(this._manifest.variants, this._shown ?? lookFor(this._manifest, this._settings.get_string('variant')));
        for (const step of steps) {
            if (!this._demoOn || run !== this._demoRun)
                return;
            if (step.variant !== this._demoVariant) {
                this._demoVariant = step.variant;
                this._full = true;
                this._rebuild();
            } else if (step.act !== 'wake') {
                this._demoReset();
            }
            this._demoNow = step.act; // read by tests/headless.sh to time its shots
            this._demoAct(step);
            await this._demoSleep(this._demoStepMs ?? DEMO_STEP_MS);
        }
        if (run === this._demoRun)
            this._stopDemo();
    }

    _stopDemo() {
        if (!this._demoOn)
            return;
        this._demoOn = false;
        this._demoNow = null;
        this._demoRun++;
        if (this._demoTimer)
            GLib.Source.remove(this._demoTimer);
        this._demoTimer = 0;
        this._demoVariant = null;
        this._heatDemo = false;
        this._full = this._demoWasFull;
        this._rebuild();
        if (this._settings.get_boolean('demo'))
            this._settings.set_boolean('demo', false);
    }

    // Not one of _timers: a rebuild between steps must not cancel the tour's clock.
    _demoSleep(ms) {
        return new Promise(resolve => {
            this._demoTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._demoTimer = 0;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    // Ends whatever the previous step left running and goes back to her usual look.
    _demoReset() {
        this._dragCancel();
        this._running = 0;
        this._momentFace = null;
        this._reactFace = null;
        this._heatDemo = false;
        if (this._sleeping) {
            this._sleeping = false;
            this._refreshFloat();
            if (this._base.blink)
                this._base.blink.opacity = 0;
        }
        this._refreshSweat();
        this._hideBubble();
        this._still(this._look.group); // a flip or a pat cut short by the next step (the pat opens her eyes itself)
        this._show(this._base, this._gen);
        this._refreshFace();
    }

    _demoAct({act, index}) {
        const moments = {
            stars: {move: 'wave', face: 'stars', phrases: 'cheer'},
            peek: {move: 'hop', pose: 'peek', phrases: 'peek'},
            determined: {move: 'hop', face: 'determined', phrases: 'focus'},
            duck: {move: 'sway', pose: 'duck', phrases: 'duck'},
            cheer: {move: 'cheer', pose: 'cheer', phrases: 'cheerleader'},
        };
        const run = promise => promise.catch(e => console.error(e));
        if (act === 'greet') {
            run(this._play(this._greeting(), 'cheer'));
        } else if (moments[act]) {
            run(this._moment(moments[act]));
        } else if (act === 'pout' || act === 'dizzy') {
            this._reactFace = act;
            this._refreshFace();
            this._say(reactionPhrases(act));
        } else if (act === 'poke' || act === 'spin') {
            run(this._tapReact(act));
        } else if (act === 'flip') {
            run(this._flip());
        } else if (act === 'pat') {
            this._patUntil = GLib.get_monotonic_time() / 1000 + 2500;
            run(this._pat(this._look));
        } else if (act === 'alert') {
            this._alert();
        } else if (act === 'heat') {
            this._heatDemo = true;
            this._refreshSweat();
            run(this._show(this._poses.hot ?? this._base, this._gen));
            this._say('heat');
        } else if (act === 'launch') {
            run(this._launch());
        } else if (act === 'outage' || act === 'restored' || act === 'failed') {
            run(this._worry(act));
        } else if (act === 'sleep') {
            this._fallAsleep();
        } else if (act === 'wake') {
            run(this._wakeUp());
        } else if (act === 'rest' && this._rests[index]) {
            run(this._show(this._rests[index], this._gen));
        } else if ((act === 'music' || act === 'meeting') && this._poses[act]) {
            run(this._show(this._poses[act], this._gen));
        }
    }

    // ---- the system: power and failed services ------------------------------------------------

    // Every WATCH_SECONDS: the UPS status from upsd, the failed units of systemd (system and user), the
    // apps recording the mic and the music players. A power or service change makes her react (the first
    // reading is only the baseline); then she settles in the look she rests in: the meeting pose, the
    // headphones, or the resting pose of this part of the day.
    async _watch() {
        if (this._watching)
            return;
        this._watching = true;
        try {
            const query = upsQuery(this._settings.get_string('ups-name'));
            const [reply, sys, user, statuses] = await Promise.all([
                query ? upsAsk(query) : Promise.resolve(null),
                failedUnits(Gio.DBus.system), failedUnits(Gio.DBus.session),
                playerStatuses(Gio.DBus.session).catch(() => []),
            ]);
            if (!this._settings)
                return;
            const power = parseUpsStatus(reply);
            const failed = sys === null || user === null ? null : sys + user;
            const event = powerEvent(this._power, power) ?? (failedRose(this._failed, failed) ? 'failed' : null);
            if (power !== null)
                this._power = power;
            if (failed !== null)
                this._failed = failed;
            const was = this._ctx.context;
            this._ctx = contextStep(this._ctx, {
                mic: micInUse(micOutputs(), this._newKey('meeting-ignore-apps')),
                music: mprisPlaying(statuses),
            });
            this._refreshNod();
            if (this._ctx.context === 'meeting' && was !== 'meeting')
                this._enterMeeting();
            if (event && !this._demoOn)
                await this._worry(event);
            else
                this._settleHome();
        } finally {
            this._watching = false;
        }
    }

    // A meeting starts: a nap ends quietly and the bubble goes away.
    _enterMeeting() {
        if (!this._root || this._demoOn)
            return;
        this._hideBubble();
        if (this._sleeping)
            this._wakeUp(true).catch(e => console.error(e));
    }

    // ---- the look she rests in ------------------------------------------------------------------

    // The meeting pose, the fan pose while the PC is hot, the headphones, the resting pose of this part of the
    // day, or her usual look, each when her look has it drawn; her usual look also while a load reaction lasts.
    // The demo tour always comes back to her usual look.
    _home() {
        if (this._demoOn)
            return this._base;
        const context = this._ctx.context;
        if (context === 'meeting' && this._poses.meeting)
            return this._poses.meeting;
        if (this._heat.hot && this._poses.hot)
            return this._poses.hot;
        if (context && this._poses[context])
            return this._poses[context];
        if (this._reactFace) // a heavy load shows on her usual look, where the faces are drawn
            return this._base;
        if (context === 'meeting') // the screen may be shared: no resting pose, her usual look
            return this._base;
        if (this._beachOn()) {
            const step = beachStep(this._manifest.beach, this._beachIndex);
            return step?.rest >= 0 ? this._rests[step.rest] ?? this._base : this._base;
        }
        return this._rests[this._restPick()] ?? this._base;
    }

    // ---- the beach mode ---------------------------------------------------------------------------

    // On while its key says so (or, with a compiled schema that lacks the key, after a click on the parasol);
    // the demo tour shows her usual looks.
    _beachOn() {
        if (this._demoOn || !this._manifest?.beach)
            return false;
        return this._settings.settings_schema.has_key('beach') ? this._newKey('beach') : this._beachMem;
    }

    // The parasol: the key changes and its handler fades the new look in, from the series' first pose.
    _toggleBeach() {
        const on = !this._beachOn();
        if (this._settings.settings_schema.has_key('beach')) {
            this._settings.set_boolean('beach', on);
            return;
        }
        this._beachMem = on;
        this._beachIndex = 0;
        this._fadeRebuild().catch(e => console.error(e));
    }

    // The next pose of the series: a crossfade within the standing look, or a fade to another look (the
    // lounger, the towel) and back. While a reaction or the launch plays it waits a minute.
    async _beachNext() {
        if (!this._root || this._demoOn || !this._beachOn())
            return;
        if (this._running || this._launching) {
            this._rotateLater(60, () => this._beachNext());
            return;
        }
        this._beachIndex++;
        const step = beachStep(this._manifest.beach, this._beachIndex);
        if (step && step.variant !== this._shown) {
            await this._fadeRebuild(); // its _build schedules the next step
            return;
        }
        this._settleHome();
        this._scheduleRotation();
    }

    // Which resting pose she rests in, -1 for her usual look: the one that fits the clock (stats.js restIndex), or the
    // one fixed in the settings window while `pose-auto` is off (stats.js homeRest).
    _restPick() {
        if (!this._rests.length)
            return -1;
        const auto = this._newKey('pose-auto');
        let pick = -1;
        if (auto) {
            const now = GLib.DateTime.new_now_local();
            const day = Math.floor((now.to_unix() + now.get_utc_offset() / 1e6) / 86400);
            pick = restIndex(this._slots(), now.get_hour(), now.get_minute(), this._newKey('rest-minutes'),
                this._rests.length, day);
        }
        return homeRest(this._restKeys, auto, this._newKey('pose'), pick);
    }

    // A key from NEW_KEYS, or its default while the compiled schema does not have it yet.
    _newKey(key) {
        const [type, fallback] = NEW_KEYS[key];
        return this._settings.settings_schema.has_key(key) ? this._settings[`get_${type}`](key) : fallback;
    }

    // Crossfades to the look she rests in when nothing else holds the stage (a moment, a reaction, a
    // nap, the launch or the demo); those come back to it on their own when they end.
    _settleHome() {
        if (!this._root || this._demoOn || this._running || this._sleeping || this._launching)
            return;
        const home = this._home();
        if (home !== this._look)
            this._show(home, this._gen).catch(e => console.error(e));
        else
            this._refreshFloat();
        this._refreshNod();
    }

    // A power cut or a failed service: she grabs her head (the worry pose; a dizzy face on the looks
    // without it), shivers and says what happened, for a moment's length. The power coming back gets
    // star eyes and a hop. It cuts a moment or a nap short; never a launch.
    async _worry(kind) {
        if (!this._root?.visible || this._launching)
            return;
        this._dragCancel();
        const token = this._running = ++this._token;
        const gen = this._gen;
        const live = () => gen === this._gen && this._running === token;
        this._worryToken = token;
        try {
            this._still(this._look.group);
            if (this._sleeping) {
                this._sleeping = false;
                this._refreshFloat();
                this._refreshSweat();
                if (this._base.blink)
                    this._base.blink.opacity = 0;
            }
            const started = GLib.get_monotonic_time();
            const pose = kind === 'restored' ? null : this._poses.worry;
            if (!await this._show(pose ?? this._base, gen) || !live())
                return;
            if (!pose) {
                const face = kind === 'restored' ? 'stars' : 'dizzy';
                this._momentFace = this._base.faces[face] ? face : null;
                this._refreshFace();
            }
            this._say(kind);
            if (kind === 'restored') {
                if (!await this._move(gen, 'hop') || !live())
                    return;
            } else {
                for (const x of [-4, 4, -3, 3, -2, 0]) {
                    if (!await this._step(gen, this._look.group, {translation_x: x, duration: 70, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD}) ||
                        !live())
                        return;
                }
            }
            const left = MOMENT_MS - (GLib.get_monotonic_time() - started) / 1000;
            if (!await this._wait(gen, left) || !live())
                return;
            this._momentFace = null;
            this._refreshFace();
            if (!await this._show(this._home(), gen) || !live())
                return;
            await this._blinkOnce(gen);
        } finally {
            if (this._running === token)
                this._running = 0;
        }
    }

    // Read from the running token, not a flag: a rebuild drops a reaction without running its finally.
    _worryActive() {
        return this._running !== 0 && this._running === this._worryToken;
    }

    // ---- her look by time of day, or the hourly rotation -------------------------------------

    _slots() {
        return parseSchedule(this._settings.get_strv('schedule'), this._manifest.variants);
    }

    // The schedule's slot for the current local hour, or null when the schedule is empty.
    _slotNow() {
        return slotAt(this._slots(), GLib.DateTime.new_now_local().get_hour());
    }

    // The look she wears now: the schedule's slot, unless a variant was chosen by hand during that
    // slot; without a schedule, the chosen variant at its step of the hourly rotation.
    _lookNow() {
        if (this._beachOn()) {
            const step = beachStep(this._manifest.beach, this._beachIndex);
            if (step)
                return step.variant;
        }
        const variant = lookFor(this._manifest, this._settings.get_string('variant'));
        if (!this._newKey('pose-auto')) // fixed in the settings window: no schedule, no change of form
            return variant;
        const slot = this._slotNow();
        if (slot && this._handPicked !== slot.hour)
            return slot.variant;
        return rotationVariant(this._manifest.variants, variant, this._rotateStep, this._manifest.forms);
    }

    // With a schedule: a look at the clock right after the next slot starts, and at least once a
    // minute. Without one: the next change of form after rotate-minutes.
    _scheduleRotation() {
        if (this._demoOn)
            return;
        if (this._beachOn()) {
            this._rotateLater(this._newKey('beach-minutes') * 60, () => this._beachNext());
            return;
        }
        if (!this._newKey('pose-auto'))
            return;
        const slots = this._slots();
        if (slots.length) {
            const now = GLib.DateTime.new_now_local();
            const left = secondsToNextSlot(slots, now.get_hour(), now.get_minute(), now.get_second());
            this._rotateLater(Math.min(left + 1, SLOT_CHECK_SECONDS));
            return;
        }
        const minutes = this._settings.get_uint('rotate-minutes');
        if (minutes)
            this._rotateLater(minutes * 60);
    }

    _rotateLater(seconds, then = () => this._rotate()) {
        if (this._rotateId)
            GLib.Source.remove(this._rotateId);
        this._rotateId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._rotateId = 0;
            then().catch(e => console.error(e));
            return GLib.SOURCE_REMOVE;
        });
    }

    // Her look changes with a soft fade: to the schedule's look once its slot has moved on (a look
    // chosen by hand lasts until then), else to the next form of the rotation (stats.js
    // rotationVariant). While something plays or she sleeps it waits a minute and tries again.
    async _rotate() {
        if (!this._root || this._demoOn || !this._newKey('pose-auto'))
            return;
        const slot = this._slotNow();
        if (slot) {
            if (this._handPicked !== null && this._handPicked !== slot.hour)
                this._handPicked = null;
            if (this._lookNow() === this._shown) {
                this._scheduleRotation();
                return;
            }
        }
        if (this._running || this._sleeping || this._launching) {
            this._rotateLater(60);
            return;
        }
        const LINEAR = Clutter.AnimationMode.LINEAR;
        if (this._root.visible && !await this._step(this._gen, this._figure, {opacity: 0, duration: 400, mode: LINEAR}))
            return;
        if (!slot)
            this._rotateStep++;
        this._rebuild();
        const target = this._figure.opacity;
        this._figure.opacity = 0;
        this._figure.ease({opacity: target, duration: 400, mode: LINEAR});
    }
}
