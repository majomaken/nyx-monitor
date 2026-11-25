// Unit tests for extension/stats.js and the asset manifest. Run with tests/run.sh (Node in Docker).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {cpuPercent, level, momentFor, parseCpu, parseGpuBusy, parseMem, PHRASES, phraseFor, pickGpu, pickMonitor,
    reaction, reactionPhrases, shouldSleep, snapshot, TAP_GAP_MS, tapStage, tapStreak, DEMO_ACTS, DEMO_STEP_MS,
    demoSteps, failedRose, parseSchedule, parseUpsStatus, powerEvent, rotationVariant, secondsToNextSlot, slotAt,
    upsQuery, restIndex, homeRest, micInUse, mprisPlaying, contextStep, CONTEXT_START, beachStep,
    swayWeight, swayOffset, wobbleAt, WOBBLE_MS, hopFrames, inHead, patStep, PAT_DWELL_MS, swingStep, SWING_MAX, windAt,
    GUST_MS, shadowAt, SHADOW_FADE_PX, notifyGate, ALERT_GAP_MS, parseMilliC, heatStep, HEAT, HEAT_START, isDoubleTap,
    flipFrames, nodAt, NOD_BPM, nodLevel, NOD_FADE_MS, clipFrame, clipBox} from '../extension/stats.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = name => readFileSync(join(here, 'fixtures', name), 'utf8');
const assets = join(here, '..', 'extension', 'assets');

test('parseCpu counts user+system as busy over the first seven fields, like herdr-sys', () => {
    assert.deepEqual(parseCpu(fixture('proc-stat-a.txt')), {busy: 1369272, total: 20724687});
    assert.deepEqual(parseCpu(fixture('proc-stat-b.txt')), {busy: 1369332, total: 20726303});
});

test('parseCpu ignores per-core lines and rejects garbage', () => {
    assert.deepEqual(parseCpu('cpu0 1 2 3 4 5 6 7\ncpu  10 0 10 80 0 0 0 0\n'), {busy: 20, total: 100});
    assert.equal(parseCpu('nothing here'), null);
    assert.equal(parseCpu('cpu  1 2 x 4 5 6 7'), null);
});

test('cpuPercent truncates the delta and needs two samples', () => {
    const a = parseCpu(fixture('proc-stat-a.txt'));
    const b = parseCpu(fixture('proc-stat-b.txt'));
    assert.equal(cpuPercent(a, b), 3); // 6000 / 1616 = 3.71, integer division as in bash
    assert.equal(cpuPercent(null, b), null);
    assert.equal(cpuPercent(b, b), null);
    assert.equal(cpuPercent({busy: 0, total: 0}, {busy: 500, total: 100}), 100);
});

test('parseMem is MemTotal minus MemAvailable in GiB', () => {
    const m = parseMem(fixture('meminfo.txt'));
    assert.equal(m.usedGiB.toFixed(1), '18.7');
    assert.equal(m.totalGiB.toFixed(0), '31');
    assert.equal(parseMem('MemTotal: 100 kB\n'), null);
});

test('parseGpuBusy reads the sysfs integer and clamps it', () => {
    assert.equal(parseGpuBusy('8\n'), 8);
    assert.equal(parseGpuBusy('140'), 100);
    assert.equal(parseGpuBusy(''), null);
});

test('pickGpu prefers the card with the most VRAM that reports busy percent', () => {
    const cards = [
        {name: 'card0', vramTotal: 536870912, hasBusy: true}, // iGPU
        {name: 'card1', vramTotal: 17163091968, hasBusy: true}, // RX 7800 XT
        {name: 'card2', vramTotal: 34359738368, hasBusy: false},
    ];
    assert.equal(pickGpu(cards), 'card1');
    assert.equal(pickGpu([]), null);
});

test('snapshot formats the three rows the way the card shows them', () => {
    const prev = parseCpu(fixture('proc-stat-a.txt'));
    const s = snapshot(prev, fixture('proc-stat-b.txt'), fixture('meminfo.txt'), '8\n');
    assert.equal(s.cpu.text, '3%');
    assert.equal(s.ram.text, '18.7G');
    assert.equal(s.ram.totalText, '31G');
    assert.equal(s.gpu.text, '8%');
    assert.ok(Math.abs(s.ram.fraction - 0.605) < 0.01);
    const first = snapshot(null, fixture('proc-stat-a.txt'), null, null);
    assert.equal(first.cpu.text, '..%');
    assert.equal(first.ram.text, '?');
    assert.equal(first.gpu.text, '-');
});

test('level colours bars calm, busy and hot', () => {
    assert.equal(level(0.2), 'calm');
    assert.equal(level(0.6), 'busy');
    assert.equal(level(0.9), 'hot');
});

test('reaction pouts on a full RAM and gets dizzy on two hot samples in a row', () => {
    const calm = {cpu: 0.2, gpu: 0.1, ram: 0.5};
    const hot = {cpu: 0.9, gpu: 0.1, ram: 0.5};
    assert.equal(reaction([]), null);
    assert.equal(reaction([calm, calm]), null);
    assert.equal(reaction([calm, {cpu: 0.2, gpu: 0.1, ram: 0.86}]), 'pout');
    assert.equal(reaction([calm, hot]), null, 'one hot sample is a spike');
    assert.equal(reaction([hot, hot]), 'dizzy');
    assert.equal(reaction([hot, {cpu: 0.1, gpu: 0.95, ram: 0.5}]), 'dizzy', 'CPU then GPU still counts');
    assert.equal(reaction([hot, {...hot, ram: 0.9}]), 'pout', 'a full RAM wins');
    assert.equal(reaction([hot]), null);
    assert.equal(reactionPhrases('pout'), 'ram');
    assert.equal(reactionPhrases('dizzy'), 'hot');
});

test('phraseFor walks each list without repeating back to back', () => {
    const fixed = ['cheerleader']; // the owner's exact words, on purpose the only phrase of its kind
    for (const [kind, list] of Object.entries(PHRASES)) {
        if (fixed.includes(kind)) {
            assert.equal(list.length, 1, `${kind} keeps the owner's one phrase`);
            continue;
        }
        assert.ok(list.length >= 2, `${kind} has at least two phrases`);
        for (let n = 0; n < list.length * 2; n++)
            assert.notEqual(phraseFor(kind, n), phraseFor(kind, n + 1), `${kind} ${n}`);
        assert.equal(phraseFor(kind, -1), list.at(-1));
    }
    assert.equal(phraseFor('missing', 0), PHRASES.cheer[0]);
    const all = Object.values(PHRASES).flat();
    assert.ok(all.every(p => !p.includes('—')), 'no em dashes');
});

test('momentFor rotates poses and faces only for the looks that have them', () => {
    const sweater = {faces: {stars: 'a'}, hand: 'h', poses: {peek: 'peek', sleep: 'sleep', duck: 'duck'}};
    const four = [0, 1, 2, 3].map(i => momentFor(sweater, i));
    assert.deepEqual(four.map(m => m.face ?? m.pose), ['stars', 'peek', 'determined', 'duck']);
    assert.deepEqual(momentFor(sweater, 4), four[0]);
    const facesOnly = [0, 1, 2, 3].map(i => momentFor({faces: {stars: 'a'}}, i));
    assert.deepEqual(facesOnly.map(m => m.face ?? m.phrases), ['stars', 'peek', 'determined', 'stars'],
        'without the peek pose she says the peek phrases in place, and the duck moment is left out');
    assert.ok(facesOnly.every(m => !m.pose), 'no pose moment without the pose');
    const lying = [0, 1, 2].map(i => momentFor({faces: {stars: 'a'}, feet: 'f'}, i));
    assert.ok(lying.every(m => m.move === 'feet'), 'the lying Nyx swings her feet in every moment');
    assert.deepEqual(lying.map(m => m.face ?? m.phrases), ['stars', 'peek', 'determined']);
    for (const spec of [{hand: 'h'}, {feet: 'f'}, {}]) {
        for (let i = 0; i < 6; i++) {
            const m = momentFor(spec, i);
            assert.ok(!m.pose && !m.face, 'outfits and lying have no poses or faces');
            assert.ok(PHRASES[m.phrases], `${m.phrases} is a phrase kind`);
        }
    }
    assert.equal(momentFor({feet: 'f'}, 0).move, 'feet');
    assert.equal(momentFor({hand: 'h'}, 0).move, 'wave');
    assert.ok(['hop', 'sway'].includes(momentFor({}, 0).move));
});

test('momentFor adds the cheer with its phrase to every look that has the pose', () => {
    const cheer = {move: 'cheer', pose: 'cheer', phrases: 'cheerleader'};
    const rich = {faces: {stars: 'a'}, hand: 'h', poses: {peek: 'p', sleep: 's', duck: 'd', cheer: 'c'}};
    assert.deepEqual([0, 1, 2, 3, 4].map(i => momentFor(rich, i).face ?? momentFor(rich, i).pose),
        ['stars', 'peek', 'determined', 'duck', 'cheer']);
    const handOnly = {hand: 'h', poses: {cheer: 'c'}};
    assert.deepEqual(momentFor(handOnly, 3), cheer, 'an outfit without faces still cheers');
    assert.equal([0, 1, 2].map(i => momentFor({hand: 'h'}, i)).filter(m => m.pose).length, 0, 'no pose, no cheer');
    assert.deepEqual(PHRASES.cheerleader, ['¡Tú logras todo lo que te propones, es un hecho!']);
});

test('shouldSleep after the idle minutes, never when set to 0', () => {
    assert.equal(shouldSleep(179999, 3), false);
    assert.equal(shouldSleep(180000, 3), true);
    assert.equal(shouldSleep(10 ** 9, 0), false);
});

test('tapStreak grows while the clicks come close together and restarts after a pause', () => {
    assert.equal(tapStreak(0, null, 5000), 1, 'the first click starts a streak');
    assert.equal(tapStreak(1, 5000, 5000 + TAP_GAP_MS), 2, 'a click right at the gap still counts');
    assert.equal(tapStreak(7, 5000, 5000 + TAP_GAP_MS + 1), 1, 'a pause starts over');
    let streak = 0;
    let last = null;
    for (let t = 0; t < 10 * 400; t += 400) {
        streak = tapStreak(streak, last, t);
        last = t;
    }
    assert.equal(streak, 10);
});

test('tapStage fires a poke at 3 clicks, a spin at 6 and the launch at 10, once each', () => {
    const stages = Array.from({length: 14}, (_, i) => tapStage(i + 1));
    assert.deepEqual(stages.map((s, i) => s && `${i + 1}:${s}`).filter(Boolean), ['3:poke', '6:spin', '10:launch']);
    for (const kind of ['poke', 'spin', 'launch', 'back', 'duckback'])
        assert.ok(PHRASES[kind]?.length >= 2, `${kind} has phrases`);
});

test('pickMonitor prefers the screen right below the primary, else the primary', () => {
    const ultrawide = {x: 0, y: 0, width: 3440, height: 1440};
    const below = {x: 878, y: 1440, width: 1920, height: 1080}; // the 15.6" screen under the ultrawide
    assert.equal(pickMonitor([ultrawide, below], 0), 1);
    assert.equal(pickMonitor([below, ultrawide], 1), 0, 'order in the list does not matter');
    assert.equal(pickMonitor([ultrawide], 0), 0, 'alone, the primary');
    assert.equal(pickMonitor([ultrawide, {x: 3440, y: 0, width: 1920, height: 1080}], 0), 0, 'a screen beside it is ignored');
    assert.equal(pickMonitor([ultrawide, {x: 0, y: -1080, width: 1920, height: 1080}], 0), 0, 'a screen above it is ignored');
    assert.equal(pickMonitor([ultrawide, {x: 3500, y: 1440, width: 1920, height: 1080}], 0), 0,
        'a screen lower but off to the side is ignored');
    const far = {x: 0, y: 3000, width: 1920, height: 1080};
    assert.equal(pickMonitor([ultrawide, far, below], 0), 2, 'the closest screen below wins');
    assert.equal(pickMonitor([], 0), 0);
});

test('demoSteps shows every look once, then every animation on a look that has them all', () => {
    const {variants} = JSON.parse(readFileSync(join(assets, 'variants.json'), 'utf8'));
    const names = Object.keys(variants);
    const steps = demoSteps(variants, 'hips-2b');
    const tour = steps.slice(0, steps.length - DEMO_ACTS.length);
    assert.deepEqual(tour.filter(s => s.act === 'greet').map(s => s.variant), names, 'every look greets once, in order');
    const cheers = names.filter(n => n !== 'hips-2b' && variants[n].poses?.cheer);
    assert.ok(cheers.includes('full-eve') && cheers.includes('hips'), 'standing and hips looks cheer in the tour');
    for (const n of cheers) {
        const i = tour.findIndex(s => s.variant === n && s.act === 'greet');
        assert.deepEqual(tour[i + 1], {variant: n, act: 'cheer'}, `${n} cheers right after its greeting`);
    }
    // Then each look shows its resting poses in order, its headphones and its meeting pose.
    let extra = 0;
    for (const n of names) {
        const own = tour.filter(s => s.variant === n && !['greet', 'cheer'].includes(s.act));
        const want = [...(variants[n].rest ?? []).map((_, index) => ({variant: n, act: 'rest', index})),
            ...['music', 'meeting'].filter(a => variants[n].poses?.[a]).map(act => ({variant: n, act}))];
        assert.deepEqual(own, want, `${n} shows its resting and context poses`);
        extra += want.length;
    }
    assert.equal(tour.filter(s => s.variant === 'hips-eve' && s.act === 'rest').length, 1, 'Eve shows her one rest');
    assert.equal(tour.filter(s => s.variant === 'hips' && s.act === 'rest').length, 3, 'the sweater shows its three');
    assert.equal(tour.length, names.length + cheers.length + extra, 'nothing else in the look tour');
    const acts = steps.slice(tour.length);
    assert.ok(acts.every(s => s.variant === 'hips-2b'), 'the animations play on the look in use when it has them all');
    assert.deepEqual(acts.map(s => s.act), DEMO_ACTS);
    for (const act of ['stars', 'peek', 'determined', 'duck', 'cheer', 'pout', 'dizzy', 'outage', 'restored', 'failed', 'poke',
        'spin', 'flip', 'pat', 'alert', 'heat', 'launch', 'sleep', 'wake'])
        assert.ok(DEMO_ACTS.includes(act), `${act} is in the tour`);
    assert.ok(DEMO_ACTS.indexOf('wake') === DEMO_ACTS.indexOf('sleep') + 1, 'she wakes right after sleeping');
    assert.ok(demoSteps(variants, 'full-eve').slice(-DEMO_ACTS.length).every(s => s.variant === 'hips'),
        'a look without faces or poses falls back to the first look that has them');
    assert.equal(DEMO_STEP_MS, 10000);
    assert.deepEqual(demoSteps({plain: {}}, 'plain'), [{variant: 'plain', act: 'greet'}], 'no rich look, no animations');
});

test('parseUpsStatus reads upsd\'s reply: on battery when OB is among the flags', () => {
    assert.equal(parseUpsStatus('VAR hikvision ups.status "OL"'), 'online');
    assert.equal(parseUpsStatus('VAR hikvision ups.status "OL CHRG"'), 'online');
    assert.equal(parseUpsStatus('VAR hikvision ups.status "OB DISCHRG"'), 'battery');
    assert.equal(parseUpsStatus('VAR hikvision ups.status "OB LB"'), 'battery');
    assert.equal(parseUpsStatus('ERR UNKNOWN-UPS'), null);
    assert.equal(parseUpsStatus(null), null);
});

test('upsQuery asks one variable and logs out, and refuses names that would break the protocol', () => {
    assert.equal(upsQuery('hikvision'), 'GET VAR hikvision ups.status\nLOGOUT\n');
    for (const bad of ['', 'a b', 'x\nFSD', 'ups;rm'])
        assert.equal(upsQuery(bad), null, JSON.stringify(bad));
});

test('powerEvent fires once when the power goes and once when it comes back', () => {
    assert.equal(powerEvent('online', 'battery'), 'outage');
    assert.equal(powerEvent(null, 'battery'), 'outage', 'already on battery when the gadget starts');
    assert.equal(powerEvent('battery', 'battery'), null);
    assert.equal(powerEvent('battery', 'online'), 'restored');
    assert.equal(powerEvent('online', 'online'), null);
    assert.equal(powerEvent(null, 'online'), null);
    assert.equal(powerEvent('online', null), null, 'a failed read says nothing');
    assert.equal(powerEvent('battery', null), null);
});

test('failedRose only when more units have failed than before', () => {
    assert.equal(failedRose(1, 2), true);
    assert.equal(failedRose(2, 2), false);
    assert.equal(failedRose(3, 1), false);
    assert.equal(failedRose(null, 4), false, 'the first reading is the baseline');
    assert.equal(failedRose(2, null), false);
});

test('rotationVariant cycles hips, full body and lying, keeping the outfit when it exists', () => {
    const {variants} = JSON.parse(readFileSync(join(assets, 'variants.json'), 'utf8'));
    const cycle = chosen => [0, 1, 2, 3].map(step => rotationVariant(variants, chosen, step));
    assert.deepEqual(cycle('hips-2b'), ['hips-2b', 'full-2b', 'lying-chibi', 'hips-2b']);
    assert.deepEqual(cycle('full-eve'), ['full-eve', 'lying-chibi', 'hips-eve', 'full-eve'], 'starts at the chosen form');
    assert.deepEqual(cycle('hips'), ['hips', 'full-chibi', 'lying-chibi', 'hips']);
    assert.deepEqual(cycle('lying-chibi'), ['lying-chibi', 'hips', 'full-chibi', 'lying-chibi']);
    assert.deepEqual(cycle('hips-zelda'), ['hips-zelda', 'full-zelda', 'lying-chibi', 'hips-zelda']);
    assert.equal(rotationVariant({solo: {}}, 'solo', 5), 'solo', 'an unknown name stays put');
    for (const kind of ['outage', 'restored', 'failed'])
        assert.ok(PHRASES[kind]?.length >= 2, `${kind} has phrases`);
});

test('parseSchedule sorts the slots by hour and skips bad hours and unknown looks', () => {
    const variants = {hips: {}, 'hips-2b': {}, 'hips-eve': {}, 'lying-chibi': {}};
    assert.deepEqual(parseSchedule(['18=hips-eve', '6=hips', ' 12 = hips-2b ', '0=lying-chibi'], variants), [
        {hour: 0, variant: 'lying-chibi'}, {hour: 6, variant: 'hips'},
        {hour: 12, variant: 'hips-2b'}, {hour: 18, variant: 'hips-eve'},
    ]);
    assert.deepEqual(parseSchedule(['24=hips', '7=nobody', 'hips', '-1=hips', '9=hips'], variants),
        [{hour: 9, variant: 'hips'}], 'only the valid entry stays');
    assert.deepEqual(parseSchedule(['6=hips', '6=hips-eve'], variants), [{hour: 6, variant: 'hips-eve'}],
        'a repeated hour keeps the later entry');
    assert.deepEqual(parseSchedule([], variants), [], 'an empty list turns the schedule off');
    assert.deepEqual(parseSchedule(undefined, variants), []);
});

test('slotAt holds each slot until the next one and wraps the last one past midnight', () => {
    const slots = [{hour: 6, variant: 'hips'}, {hour: 12, variant: 'hips-2b'}, {hour: 18, variant: 'hips-eve'}];
    const at = hour => slotAt(slots, hour)?.variant;
    assert.equal(at(6), 'hips');
    assert.equal(at(11), 'hips');
    assert.equal(at(12), 'hips-2b');
    assert.equal(at(17), 'hips-2b');
    assert.equal(at(18), 'hips-eve');
    assert.equal(at(23), 'hips-eve');
    assert.equal(at(3), 'hips-eve', 'before the first hour the night slot still holds');
    assert.equal(slotAt(slots, 3).hour, 18, 'and it is the same slot, so a hand-picked look waits it out');
    assert.equal(slotAt([], 9), null);
});

test('secondsToNextSlot counts to the next hour on the list, tomorrow after the last one', () => {
    const slots = [{hour: 0, variant: 'lying-chibi'}, {hour: 6, variant: 'hips'}, {hour: 18, variant: 'hips-eve'}];
    assert.equal(secondsToNextSlot(slots, 5, 59, 30), 30);
    assert.equal(secondsToNextSlot(slots, 6, 0, 0), 12 * 3600, 'a slot that just started counts to the next');
    assert.equal(secondsToNextSlot(slots, 23, 0, 0), 3600, 'the 0 slot is tomorrow');
    assert.equal(secondsToNextSlot([{hour: 9, variant: 'hips'}], 10, 0, 0), 23 * 3600, 'a single slot comes back tomorrow');
    assert.equal(secondsToNextSlot([], 10, 0, 0), null);
});

test('the default schedule is the owner\'s day: lying, sweater, 2B and Eve', () => {
    const {variants} = JSON.parse(readFileSync(join(assets, 'variants.json'), 'utf8'));
    const schema = readFileSync(join(here, '..', 'extension', 'schemas',
        'org.gnome.shell.extensions.nyx-monitor.gschema.xml'), 'utf8');
    const block = /<key name="schedule" type="as">\s*<default>([^<]+)<\/default>/.exec(schema);
    assert.ok(block, 'the schema has a schedule key with a default');
    const entries = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    assert.deepEqual(parseSchedule(entries, variants), [
        {hour: 0, variant: 'lying-chibi'}, {hour: 6, variant: 'hips'},
        {hour: 12, variant: 'hips-2b'}, {hour: 18, variant: 'hips-eve'},
    ], 'every default entry is valid');
});

const pngSize = file => {
    const png = readFileSync(join(assets, file));
    assert.equal(png.toString('latin1', 1, 4), 'PNG', `${file} is a PNG`);
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

// The Wan 2.2 clips of 2026-11-06 the owner approved: each one plays on its
// look as a vertical strip of frames the size of that look's PNG, so size, dx, head box, shadow and sway map still fit.
const CLIP_LOOKS = ['hips', 'cheer', 'worry', 'sleep', 'music', 'hot', 'rest-coffee', 'rest-tea-2b', 'rest-think',
    'rest-curtsy-2b', 'rest-sidesit', 'rest-kiss',
    // the second batch (S5): the same poses in the other outfits, and the sweater's look back and meeting
    'rest-kiss-2b', 'rest-kiss-eve', 'rest-lookback', 'rest-lookback-2b', 'rest-lookback-eve', 'rest-sidesit-2b',
    'music-2b', 'music-eve', 'hot-2b', 'hot-eve', 'cheer-2b', 'cheer-eve', 'cheer-zelda', 'worry-2b', 'worry-eve',
    'worry-zelda', 'meeting', 'meeting-2b', 'meeting-eve', 'rest-lean-eve', 'sleep-2b', 'sleep-eve', 'sleep-zelda',
    'hips-eve', 'hips-zelda', 'hips-2b'];
// 38 strips at about 1.7 MB come to some 65 MB; every file stays far under the repo's 5 MB limit
const CLIP_BUDGET = 80 * 1024 * 1024;
const CLIP_FILE_MAX = 5 * 1000 * 1000;
const CLIP_REACH = 64; // px past the look, at most (build_clips.py pads by as much)

test('clips: the approved Wan clips play on their looks, as strips of frames sized like the look', () => {
    const {variants, poses} = JSON.parse(readFileSync(join(assets, 'variants.json'), 'utf8'));
    const looks = {...poses, ...variants};
    const withClip = Object.entries({...variants, ...poses}).filter(([, v]) => v.clip).map(([k]) => k);
    assert.deepEqual(withClip.sort(), [...CLIP_LOOKS].sort(), 'exactly the approved looks carry a clip');
    for (const name of CLIP_LOOKS) {
        const {clip, size} = looks[name];
        assert.match(clip.strip, /^nyx-clip-[a-z0-9-]+\.png$/, `${name} strip name`);
        assert.equal(clip.fps, 12, `${name} plays at 12 fps`);
        assert.equal(clip.frames, 36, `${name} has three seconds of frames`);
        assert.ok(Number.isInteger(clip.gap) && clip.gap >= 0, `${name} gap is whole milliseconds`);
        assert.equal(Boolean(clip.once), name.startsWith('hips'), `${name}: only the waves play once`);
        assert.ok(statSync(join(assets, clip.strip)).size < CLIP_FILE_MAX, `${clip.strip} is under 5 MB`);
        // A clip's frames may reach past the look on the left, the right and the top (the cheer's pom-poms, the wave's
        // hand), so nothing is cut at the still's tight edge; the bottom stays the look's fade or ledge cut.
        const [bx, by, bw, bh] = clip.box ?? [0, 0, ...size];
        assert.ok(bx <= 0 && by <= 0 && bx + bw >= size[0] && by + bh === size[1], `${name} box ${clip.box} holds the look`);
        assert.ok(clipBox(clip, size, ...size).reach <= CLIP_REACH, `${name} reaches at most ${CLIP_REACH} px past the look`);
        assert.deepEqual(pngSize(clip.strip), [bw, bh * clip.frames], `${clip.strip} is ${clip.frames} frames of ${bw}x${bh}`);
    }
    // the owner, 2026-11-07: «Una cosita revisa el video de porras en el gnome porque quedo cómo recortado en la
    // animación en el borde de los pompones»
    assert.ok(looks.cheer.clip.box?.[0] < 0, 'the cheer clip reaches past the look, where the pom-poms shake');
    const strips = readdirSync(assets).filter(f => f.startsWith('nyx-clip-'));
    assert.deepEqual(strips.sort(), CLIP_LOOKS.map(n => looks[n].clip.strip).sort(), 'no strip left over');
    const bytes = strips.reduce((sum, f) => sum + statSync(join(assets, f)).size, 0);
    assert.ok(bytes < CLIP_BUDGET, `the strips weigh ${(bytes / 1048576).toFixed(1)} MB, under 80 MB`);
});

const unit = (pair, what) => assert.ok(pair.every(n => n >= 0 && n <= 1), `${what} is normalised`);

test('variants.json matches the PNGs on disk and the schema choices', () => {
    const {variants, poses} = JSON.parse(readFileSync(join(assets, 'variants.json'), 'utf8'));
    // Nyx's nine looks; the `variant` key holds any character's look since 2026-11-24, so the schema lists none.
    assert.deepEqual(Object.keys(variants).sort(), ['full-2b', 'full-chibi', 'full-eve', 'full-zelda', 'hips', 'hips-2b',
        'hips-eve', 'hips-zelda', 'lying-chibi']);
    const used = new Set();
    for (const [name, v] of Object.entries(variants)) {
        for (const [pose, key] of Object.entries(v.poses ?? {})) {
            assert.ok(['peek', 'sleep', 'duck', 'worry', 'cheer', 'music', 'meeting', 'hot'].includes(pose),
                `${name} pose ${pose} is one the extension uses`);
            assert.ok(poses[key], `${name} pose ${pose} -> ${key} exists`);
            assert.equal(poses[key].layout, ['peek', 'sleep'].includes(pose) ? 'perch' : 'beside', `${key} layout`);
            assert.equal(Boolean(poses[key].alt), pose === 'cheer', `${key}: only the cheer has a second frame`);
            used.add(key);
        }
        for (const key of v.rest ?? []) {
            assert.ok(poses[key], `${name} rest ${key} exists`);
            assert.ok(['beside', 'perch'].includes(poses[key].layout), `${key} stands beside the card or sits on it`);
            assert.ok(!poses[key].alt, `${key} is one frame`);
            used.add(key);
        }
        for (const key of v.shelved ?? []) {  // kept on disk, never shown
            assert.ok(poses[key], `${name} shelved ${key} exists`);
            used.add(key);
        }
    }
    const {beach} = JSON.parse(readFileSync(join(assets, 'variants.json'), 'utf8'));
    for (const look of Object.values(beach?.looks ?? {}))
        for (const key of look.rest ?? [])
            used.add(key);
    assert.deepEqual([...used].sort(), Object.keys(poses).sort(), 'every pose belongs to a look');
    for (const [name, p] of Object.entries(poses))
        if (p.float !== undefined)
            assert.ok(['notes', 'heart'].includes(p.float), `${name} floats something the extension draws`);
    const all = [...Object.entries(variants), ...Object.entries(beach?.looks ?? {}), ...Object.entries(poses)];
    for (const [name, v] of all) {
        assert.ok(['beside', 'top', 'perch'].includes(v.layout), `${name} layout`);
        const files = [v.body, v.blink, v.hand, v.feet, v.alt, ...Object.values(v.faces ?? {})].filter(Boolean);
        for (const f of files)
            assert.deepEqual(pngSize(f), v.size, `${f} size`);
        assert.equal(Boolean(v.hand), Boolean(v.hand_pivot), `${name} hand and pivot go together`);
        assert.equal(Boolean(v.feet), Boolean(v.feet_pivot), `${name} feet and pivot go together`);
        for (const key of ['hand_pivot', 'feet_pivot'])
            if (v[key])
                unit(v[key], `${name} ${key}`);
        assert.equal(v.head?.length, 4, `${name} has a head box`);
        unit(v.head, `${name} head`);
        assert.ok(v.head[0] < v.head[2] && v.head[1] < v.head[3], `${name} head box is ordered`);
    }
    for (const [name, v] of Object.entries(variants)) {
        assert.deepEqual(Object.keys(v.faces ?? {}).sort(), ['determined', 'dizzy', 'pout', 'stars'],
            `${name} has the faces momentFor and reaction use`);
        assert.ok(v.blink, `${name} closes her eyes to blink and to sleep`);
    }
    for (const name of ['hips', 'hips-eve', 'hips-2b'])
        assert.deepEqual(Object.keys(variants[name].poses).filter(p => p !== 'hot').sort(),
            ['cheer', 'duck', 'meeting', 'music', 'peek', 'sleep', 'worry'], `${name} has every pose`);
    // The heat (2026-11-06): only the sweater fans herself, the fan in a hand layer that turns at her wrist.
    assert.deepEqual(['hips', 'hips-eve', 'hips-2b', 'hips-zelda'].filter(n => variants[n].poses?.hot), ['hips', 'hips-eve', 'hips-2b'],
        'the sweater, Eve and 2B fan themselves');
    for (const name of ['hips', 'hips-eve', 'hips-2b']) {
        const hot = poses[variants[name].poses.hot];
        assert.ok(hot.hand && hot.hand_pivot && hot.layout === 'beside' && hot.size[1] === 440, `${name}: a hips-up pose with its fan hand`);
        assert.ok(hot.hand_pivot[0] < 0.3 && hot.hand_pivot[1] > hot.head[3], `${name}: the wrist is at her side, below her head`);
    }
    assert.deepEqual(Object.keys(variants['hips-zelda'].poses).sort(), ['cheer', 'duck', 'peek', 'sleep', 'worry'],
        'the fourth outfit has no resting or context poses yet');
    // The standing full-body poses left on 2026-11-07 at the owner's word: «las poses de pie también quitemoslas de el
    // widged esos si no borras nada y guarda los videos pero las de pie no las mostremos ya».
    // The side-sit on the card left on 2026-11-09 at the owner's word, in every outfit: «quitemos esta pose porfa, no
    // borres nada solo que no quiero que este ni esa ni otras versiones de esa que salgan ahí».
    assert.deepEqual(variants.hips.rest, ['rest-coffee', 'rest-think', 'rest-kiss'],
        'sweater: a coffee, a pencil, then the blown kiss, in turns over the days');
    assert.deepEqual(variants['hips-2b'].rest, ['rest-curtsy-2b', 'rest-tea-2b', 'rest-kiss-2b'],
        '2B: a curtsy, a teacup, then the blown kiss');
    // Her side-sit left on 2026-11-06 at the owner's word: «esta porfa no la muestres que no me gusta cómo se ve».
    assert.deepEqual(variants['hips-eve'].rest, ['rest-kiss-eve'], 'Eve: the blown kiss at night');
    const shelved = {hips: ['rest-lookback', 'rest-sidesit'], 'hips-2b': ['rest-lookback-2b', 'rest-sidesit-2b'],
        'hips-eve': ['rest-lookback-eve', 'rest-lean-eve']};
    for (const [look, names] of Object.entries(shelved))
        assert.deepEqual(variants[look].shelved, names, `${look} keeps its hidden poses on the shelf`);
    for (const name of Object.values(shelved).flat()) {
        assert.ok(Object.values(variants).every(v => !(v.rest ?? []).includes(name)), `${name} is shelved: not shown`);
        const pose = poses[name];
        assert.ok(pose && [pose.body, pose.clip?.strip].every(f => existsSync(join(assets, f))),
            `${name}: its still and its clip are kept`);
    }
    for (const name of ['hips-zelda', 'full-chibi', 'full-eve', 'full-2b', 'full-zelda', 'lying-chibi'])
        assert.equal(variants[name].rest, undefined, `${name} has no resting poses`);
    for (const role of ['music', 'music-2b', 'music-eve'])
        assert.equal(poses[role].float, 'notes', `${role} floats notes`);
    for (const kiss of ['rest-kiss', 'rest-kiss-2b', 'rest-kiss-eve'])
        assert.equal(poses[kiss].float, 'heart', `${kiss}: the blown kiss floats a heart`);
    assert.ok(variants['hips-zelda'].poses?.cheer, 'the fourth outfit cheers too');
    for (const name of ['full-chibi', 'full-eve', 'full-2b', 'full-zelda'])
        assert.deepEqual(Object.keys(variants[name].poses ?? {}).sort(), ['cheer', 'worry'], `${name} cheers and worries standing`);
    // dx shifts a pose left (a wider one, so she keeps her spot) or right (Eve's narrower full-body rests,
    // centred where her hips look stands), always less than the card's width.
    for (const [name, p] of Object.entries(poses))
        if (p.dx !== undefined)
            assert.ok(Number.isInteger(p.dx) && Math.abs(p.dx) < 150 && (p.dx <= 0 || name.startsWith('rest-') || name.startsWith('beach-')),
                `${name} dx: left by less than the card, or right for a resting pose`);
});

test('restIndex: each slot opens with her usual look, then the resting poses take turns every restMinutes', () => {
    const slots = [{hour: 0, variant: 'lying-chibi'}, {hour: 6, variant: 'hips'}, {hour: 12, variant: 'hips-2b'},
        {hour: 18, variant: 'hips-eve'}];
    const day = (d, count) => Array.from({length: 24}, (_, h) => restIndex(slots, h, 0, 120, count, d));
    // Two resting poses: the same order every day, 2 h each after 2 h of her usual look.
    assert.deepEqual(day(0, 2).slice(6, 12), [-1, -1, 0, 0, 1, 1], 'sweater: wave, coffee, pencil');
    assert.deepEqual(day(9, 2).slice(12, 18), [-1, -1, 0, 0, 1, 1], 'the same every day');
    // Four (Eve at night): two a night, the other two the next night.
    assert.deepEqual(day(0, 4).slice(18, 24), [-1, -1, 0, 0, 1, 1]);
    assert.deepEqual(day(1, 4).slice(18, 24), [-1, -1, 2, 2, 3, 3]);
    assert.deepEqual(day(2, 4).slice(18, 24), [-1, -1, 0, 0, 1, 1]);
    assert.equal(restIndex(slots, 7, 0, 0, 2, 0), -1, 'restMinutes 0 keeps her usual look');
    assert.equal(restIndex(slots, 9, 0, 120, 0, 0), -1, 'a look without resting poses keeps her usual look');
    // A slot that crosses midnight belongs to the day it started.
    const night = [{hour: 6, variant: 'hips'}, {hour: 20, variant: 'hips-eve'}];
    assert.equal(restIndex(night, 22, 0, 120, 4, 5), 0, 'the evening slot of day 5 starts its turn at 22');
    assert.equal(restIndex(night, 0, 0, 120, 4, 6), (5 * 4 + 1) % 4, 'past midnight it is still the evening before');
    // Longer periods: 3 h in a 6 h slot leave one resting period, so the poses alternate by day.
    assert.deepEqual([0, 1, 2].map(d => restIndex(slots, 10, 0, 180, 2, d)), [0, 1, 0]);
    // Without a schedule the whole day is one slot from midnight.
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(h => restIndex([], h, 0, 120, 2, 0)), [-1, -1, 0, 0, 1, 1]);
    // Every half hour (the owner, 2026-11-09: «cámbialo a cada media hora»): the sweater's 6 to 12 holds twelve
    // periods, her usual look first, then her three poses in turn; the next day carries on where this one stopped.
    const halves = d => Array.from({length: 12}, (_, i) => restIndex(slots, 6 + Math.floor(i / 2), (i % 2) * 30, 30, 3, d));
    assert.deepEqual(halves(0), [-1, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1]);
    assert.deepEqual(halves(1), [-1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
    assert.equal(restIndex(slots, 6, 29, 30, 3, 0), -1, 'her usual look until 6:30');
    assert.equal(restIndex(slots, 6, 30, 30, 3, 0), 0, 'the coffee from 6:30');
    assert.equal(restIndex(slots, 11, 59, 30, 3, 0), 1, 'the last half hour of the slot');
});

test('micInUse: any app recording that is not on the ignore list, by id or name, without case', () => {
    const ignored = ['org.gnome.VolumeControl', 'org.PulseAudio.pavucontrol', 'com.obsproject.Studio', 'OBS'];
    assert.equal(micInUse([], ignored), false, 'nothing recording');
    assert.equal(micInUse([{app: null, name: 'Firefox'}], ignored), true, 'a call in the browser');
    assert.equal(micInUse([{app: 'org.PulseAudio.pavucontrol', name: 'pavucontrol'}], ignored), false, 'the level meter');
    assert.equal(micInUse([{app: null, name: 'obs'}], ignored), false, 'OBS by name, any case');
    assert.equal(micInUse([{app: 'com.obsproject.Studio', name: null}, {app: null, name: 'zoom'}], ignored), true,
        'OBS and a meeting at once is a meeting');
    assert.equal(micInUse([{app: null, name: null}], ignored), true, 'an app with no name still counts');
    assert.equal(micInUse([{app: null, name: 'Firefox'}], null), true, 'no ignore list');
});

test('mprisPlaying: some player is Playing', () => {
    assert.equal(mprisPlaying(['Paused', 'Playing']), true);
    assert.equal(mprisPlaying(['Paused', 'Stopped', null]), false);
    assert.equal(mprisPlaying([]), false);
    assert.equal(mprisPlaying(null), false);
});

test('contextStep changes after two checks in a row either way, and a meeting wins over music', () => {
    const run = samples => samples.reduce((st, s) => [...st, contextStep(st.at(-1), s)], [CONTEXT_START]).slice(1)
        .map(st => st.context);
    const off = {mic: false, music: false};
    const music = {mic: false, music: true};
    const meet = {mic: true, music: true};
    assert.deepEqual(run([music, music, music]), [null, 'music', 'music'], 'music after two checks');
    assert.deepEqual(run([music, off, music, off]), [null, null, null, null], 'a flicker changes nothing');
    assert.deepEqual(run([music, music, off, off]), [null, 'music', 'music', null], 'and back after two checks');
    assert.deepEqual(run([music, music, meet, meet]), [null, 'music', 'music', 'meeting'], 'a meeting wins');
    assert.deepEqual(run([meet, music, meet, meet]), [null, null, null, 'meeting'], 'two in a row of the same');
    assert.deepEqual(CONTEXT_START, {context: null, next: null, seen: 0});
});

test('the rest and meeting keys have their defaults in the schema', () => {
    const schema = readFileSync(join(here, '..', 'extension', 'schemas',
        'org.gnome.shell.extensions.nyx-monitor.gschema.xml'), 'utf8');
    assert.match(schema, /<key name="rest-minutes" type="u">\s*<range min="0" max="720"\/>\s*<default>30<\/default>/);
    assert.ok(!schema.includes('"rest-hours"'), 'rest-minutes replaced rest-hours on 2026-11-09');
    const block = /<key name="meeting-ignore-apps" type="as">\s*<default>([^<]+)<\/default>/.exec(schema);
    assert.ok(block, 'the schema has meeting-ignore-apps with a default');
    const apps = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    for (const app of ['org.gnome.VolumeControl', 'org.PulseAudio.pavucontrol', 'com.obsproject.Studio', 'OBS'])
        assert.ok(apps.includes(app), `${app} is ignored by default`);
});

test('the extension\'s fallbacks for the new keys match the schema defaults', () => {
    const js = readFileSync(join(here, '..', 'extension', 'extension.js'), 'utf8');
    const schema = readFileSync(join(here, '..', 'extension', 'schemas',
        'org.gnome.shell.extensions.nyx-monitor.gschema.xml'), 'utf8');
    const ignore = /<key name="meeting-ignore-apps" type="as">\s*<default>\[([^\]]+)\]<\/default>/.exec(schema)[1];
    const quoted = [...ignore.matchAll(/'([^']+)'/g)].map(m => `'${m[1]}'`).join(', ');
    assert.ok(js.includes(`'meeting-ignore-apps': ['strv', [${quoted}]]`), 'meeting-ignore-apps fallback');
    assert.ok(js.includes("'rest-minutes': ['uint', 30]"), 'rest-minutes fallback');
    assert.ok(!js.includes("'rest-hours'"), 'nothing reads the retired rest-hours key');
    assert.ok(!/get_(uint|strv)\('(rest-minutes|meeting-ignore-apps)'\)/.test(js), 'the new keys are only read through _newKey');
});

test('the character key: in the schema with its default, read through the fallbacks; variant takes any look', () => {
    const js = readFileSync(join(here, '..', 'extension', 'extension.js'), 'utf8');
    const schema = readFileSync(join(here, '..', 'extension', 'schemas',
        'org.gnome.shell.extensions.nyx-monitor.gschema.xml'), 'utf8');
    assert.match(schema, /<key name="character" type="s">\s*<default>'nyx'<\/default>/, 'Nyx unless another is chosen');
    assert.ok(js.includes("'character': ['string', 'nyx']"), 'character fallback');
    assert.ok(!/get_string\('character'\)/.test(js), 'the character key is only read through _newKey');
    const variant = /<key name="variant" type="s">([\s\S]*?)<\/key>/.exec(schema)[1];
    assert.ok(!variant.includes('<choices>'), "variant holds the current character's look, whichever it is");
    assert.match(variant, /<default>'hips'<\/default>/);
});

test('homeRest: automatic keeps the clock\'s pick; a fixed pose stays, her usual look when this look lacks it (S12)', () => {
    const keys = ['rest-sit', 'rest-stretch', 'rest-lookback'];
    assert.equal(homeRest(keys, true, 'rest-stretch', 2), 2, 'automatic: the clock decides');
    assert.equal(homeRest(keys, true, 'rest-stretch', -1), -1);
    assert.equal(homeRest(keys, false, 'rest-stretch', -1), 1, 'fixed: the chosen pose, whatever the clock says');
    assert.equal(homeRest(keys, false, 'rest-lookback', 0), 2);
    assert.equal(homeRest(keys, false, '', 1), -1, 'fixed on her usual look');
    assert.equal(homeRest(keys, false, 'rest-coffee', 1), -1, 'a pose of another look: her usual look');
    assert.equal(homeRest([], false, 'rest-sit', -1), -1);
});

test('the pose keys: automatic by default, no fixed pose, read through the fallbacks and applied live (S12)', () => {
    const js = readFileSync(join(here, '..', 'extension', 'extension.js'), 'utf8');
    const schema = readFileSync(join(here, '..', 'extension', 'schemas',
        'org.gnome.shell.extensions.nyx-monitor.gschema.xml'), 'utf8');
    assert.match(schema, /<key name="pose-auto" type="b">\s*<default>true<\/default>/);
    assert.match(schema, /<key name="pose" type="s">\s*<default>''<\/default>/);
    assert.ok(js.includes("'pose-auto': ['boolean', true]"), 'pose-auto fallback');
    assert.ok(js.includes("'pose': ['string', '']"), 'pose fallback');
    assert.ok(!/get_(boolean|string)\('pose(-auto)?'\)/.test(js), 'the pose keys are only read through _newKey');
    const live = /const LIVE_KEYS = \[([^\]]*)\]/.exec(js)[1];
    assert.ok(live.includes("'pose-auto'") && live.includes("'pose'"), 'a pose change crossfades, it does not rebuild');
});

test('figure-offset: 24 px further right by default, 0 to 160, read through the fallbacks (S13)', () => {
    const js = readFileSync(join(here, '..', 'extension', 'extension.js'), 'utf8');
    const schema = readFileSync(join(here, '..', 'extension', 'schemas',
        'org.gnome.shell.extensions.nyx-monitor.gschema.xml'), 'utf8');
    assert.match(schema, /<key name="figure-offset" type="u">\s*<range min="0" max="160"\/>\s*<default>24<\/default>/);
    assert.ok(js.includes("'figure-offset': ['uint', 24]"), 'figure-offset fallback');
    assert.ok(!/get_uint\('figure-offset'\)/.test(js), 'figure-offset is only read through _newKey');
});

test('pc-name: SUPER PC by default, read through the fallbacks, applied live without a rebuild (S14)', () => {
    const js = readFileSync(join(here, '..', 'extension', 'extension.js'), 'utf8');
    const schema = readFileSync(join(here, '..', 'extension', 'schemas',
        'org.gnome.shell.extensions.nyx-monitor.gschema.xml'), 'utf8');
    assert.match(schema, /<key name="pc-name" type="s">\s*<default>'SUPER PC'<\/default>/);
    assert.ok(js.includes("'pc-name': ['string', 'SUPER PC']"), 'pc-name fallback');
    assert.ok(!/get_string\('pc-name'\)/.test(js), 'pc-name is only read through _newKey');
    assert.ok(/const LIVE_KEYS = \[[^\]]*'pc-name'/.test(js), 'a new name changes the text, it does not rebuild');
    assert.ok(!js.includes('_pack.title'), 'the title comes from cardTitle');
});

test('beachStep walks the beach series: a look of its own, or a resting pose of the look that lists it, wrapping', () => {
    const beach = {
        looks: {beach: {rest: ['beach-drink', 'beach-hat']}, 'beach-lounger': {}},
        steps: ['beach', 'beach-drink', 'beach-lounger', 'beach-hat'],
    };
    assert.deepEqual(beachStep(beach, 0), {variant: 'beach', rest: -1}, 'the first step is the standing look itself');
    assert.deepEqual(beachStep(beach, 1), {variant: 'beach', rest: 0}, 'a resting pose of the standing look');
    assert.deepEqual(beachStep(beach, 2), {variant: 'beach-lounger', rest: -1}, 'a horizontal look of its own');
    assert.deepEqual(beachStep(beach, 3), {variant: 'beach', rest: 1});
    assert.deepEqual(beachStep(beach, 4), beachStep(beach, 0), 'it wraps around');
    assert.deepEqual(beachStep(beach, 9), beachStep(beach, 1));
    assert.equal(beachStep({looks: {}, steps: ['nowhere']}, 0), null, 'an unknown step');
    assert.equal(beachStep(undefined, 0), null, 'no beach section');
    assert.equal(beachStep({looks: {beach: {}}, steps: []}, 3), null, 'no steps');
});

test('the beach section: a standing look with its resting poses and two horizontal looks, every pose once in the series', () => {
    const {beach, poses} = JSON.parse(readFileSync(join(assets, 'variants.json'), 'utf8'));
    assert.ok(beach, 'variants.json has a beach section');
    assert.deepEqual(Object.keys(beach.looks).sort(), ['beach', 'beach-lounger', 'beach-towel']);
    assert.equal(beach.looks.beach.layout, 'beside', 'the standing look stands beside the card');
    for (const name of ['beach-lounger', 'beach-towel']) {
        assert.equal(beach.looks[name].layout, 'top', `${name} lies on a wide card, like the lying Nyx`);
        assert.equal(beach.looks[name].rest, undefined, `${name} is one pose`);
    }
    const rests = beach.looks.beach.rest;
    assert.deepEqual([...rests].sort(), ['beach-ball-c', 'beach-cheer-a', 'beach-drink-b', 'beach-hat-c', 'beach-icecream-b',
        'beach-kiss-c', 'beach-sunglasses-b', 'beach-wave-b', 'beach-wave-c'].sort(),
    'the two other sheets, the three finals and the four new poses');
    for (const key of rests)
        assert.equal(poses[key].layout, 'beside', `${key} stands beside the card`);
    // Hips-up like the other looks since 2026-11-07, at the owner's word: «De hecho re haz las de bikini para que esten
    // cómo las otras». Raised arms (the pom-poms) may reach a little higher; the full-body stills stay on disk.
    for (const [name, p] of [['beach', beach.looks.beach], ...rests.map(key => [key, poses[key]])])
        assert.ok(p.size[1] >= 440 && p.size[1] <= 450, `${name} is hips-up (${p.size[1]} px tall)`);
    for (const file of ['nyx-beach.png', ...['wave-b', 'wave-c', 'cheer-a', 'kiss-c', 'hat-c', 'ball-c'].map(n => `nyx-pose-beach-${n}.png`)])
        assert.ok(existsSync(join(assets, file)), `${file}: the full-body still stays on disk`);
    assert.equal(beach.steps.length, 12, 'twelve poses in the series');
    assert.deepEqual([...beach.steps].sort(), [...Object.keys(beach.looks), ...rests].sort(), 'every pose once');
    beach.steps.forEach((name, i) => assert.ok(beachStep(beach, i), `step ${i} (${name}) resolves`));
    assert.equal(beach.steps[0], 'beach', 'the series opens with her waving in the sarong');
    assert.equal(poses['beach-kiss-c'].float, 'heart', 'the blown kiss floats a heart');
});

test('the beach keys: in the schema with their defaults, and read through the fallbacks', () => {
    const js = readFileSync(join(here, '..', 'extension', 'extension.js'), 'utf8');
    const schema = readFileSync(join(here, '..', 'extension', 'schemas',
        'org.gnome.shell.extensions.nyx-monitor.gschema.xml'), 'utf8');
    assert.match(schema, /<key name="beach" type="b">\s*<default>false<\/default>/, 'the beach mode starts off');
    assert.match(schema, /<key name="beach-minutes" type="u">\s*<range min="1" max="60"\/>\s*<default>2<\/default>/,
        'a new beach pose every 2 minutes');
    assert.ok(js.includes("'beach': ['boolean', false]"), 'beach fallback');
    assert.ok(js.includes("'beach-minutes': ['uint', 2]"), 'beach-minutes fallback');
    assert.ok(!/get_(boolean|uint)\('beach(-minutes)?'\)/.test(js), 'the beach keys are only read through _newKey');
    assert.ok(js.includes('\\u{F188A}'), 'the parasol glyph (nf-md-umbrella_beach) is on the card');
});

test('sway.json: a map for every look and pose, shaped like its PNG, still on her face and moving somewhere', () => {
    const {variants, poses, beach} = JSON.parse(readFileSync(join(assets, 'variants.json'), 'utf8'));
    const sway = JSON.parse(readFileSync(join(assets, 'sway.json'), 'utf8'));
    const specs = [...Object.values(variants), ...Object.values(poses), ...Object.values(beach.looks)];
    for (const spec of specs) {
        const map = sway[spec.body];
        assert.ok(map, `${spec.body} has a sway map`);
        assert.ok(map.cx >= 0 && map.cx <= 1, `${spec.body} cx is normalised`);
        const cols = map.rows[0].length;
        for (const row of map.rows)
            assert.match(row, new RegExp(`^[0-9]{${cols}}$`), `${spec.body}: rows of digits of one width`);
        const [w, h] = pngSize(spec.body);
        assert.ok(Math.abs(cols / map.rows.length - w / h) < 0.15 * w / h, `${spec.body}: the map has the PNG's shape`);
        assert.ok(cols * map.rows.length <= 1024, `${spec.body}: fits the 1024 cells of the shader`);
        // The swing ramps from her chin down: nothing moves in the top half of her head box.
        const still = Math.floor((spec.head[1] + (spec.head[3] - spec.head[1]) / 2) * map.rows.length);
        assert.ok(map.rows.slice(0, still).every(r => /^0+$/.test(r)), `${spec.body}: her face stays put`);
        assert.ok(map.rows.some(r => /[1-9]/.test(r)), `${spec.body}: something sways`);
    }
    assert.equal(Object.keys(sway).length, specs.length, 'no map left for a PNG that is gone');
});

test('swayWeight reads the map between its cells, 0 to 1, and holds the edge value outside it', () => {
    const map = {cx: 0.5, rows: ['09', '09']};
    assert.equal(swayWeight(map, 0, 0.5), 0, 'a still cell');
    assert.equal(swayWeight(map, 1, 0.5), 1, 'a 9 is the full swing');
    assert.ok(Math.abs(swayWeight(map, 0.5, 0.5) - 0.5) < 1e-9, 'halfway between the two cell centres');
    assert.equal(swayWeight(map, -0.2, 0.5), 0, 'left of the map: its left edge');
    assert.equal(swayWeight(map, 1.3, 0.5), 1, 'right of the map: its right edge');
    assert.equal(swayWeight(null, 0.5, 0.5), 0, 'no map, no swing');
});

test('swayOffset swings out from her head\'s centre and down, by the weight and the wobble', () => {
    const map = {cx: 0.5, rows: ['9999']};
    const [lx, ly] = swayOffset(map, 0.05, 0.5, 1, 6);
    const [rx, ry] = swayOffset(map, 0.95, 0.5, 1, 6);
    assert.ok(lx < 0 && rx > 0, 'out to each side');
    assert.ok(Math.abs(lx + rx) < 1e-9, 'the same on both sides');
    assert.ok(ly > 0 && Math.abs(ly - ry) < 1e-9, 'down on both sides');
    assert.ok(Math.abs(rx) <= 6 && ry <= 6, 'never past the amplitude');
    const [bx, by] = swayOffset(map, 0.95, 0.5, -1, 6);
    assert.ok(bx < 0 && by < 0, 'a negative wobble tucks it in and lifts it');
    assert.deepEqual(swayOffset({cx: 0.5, rows: ['0000']}, 0.95, 0.5, 1, 6), [0, 0], 'a still spot stays still');
});

test('wobbleAt: each kick swings out first, dies away and is over after WOBBLE_MS; kicks add up', () => {
    const k = [{at: 1000, strength: 1}];
    assert.equal(wobbleAt(k, 1000).value, 0, 'starts at rest');
    assert.ok(wobbleAt(k, 1080).value > 0.3, 'swings out first');
    const peaks = [];
    for (let t = 1000; t < 1000 + WOBBLE_MS; t += 5)
        peaks.push(Math.abs(wobbleAt(k, t).value));
    assert.ok(Math.max(...peaks) <= 1, 'never past its strength');
    assert.ok(Math.max(...peaks.slice(-20)) < 0.05, 'nearly still by the end');
    assert.equal(wobbleAt(k, 1000 + WOBBLE_MS - 1).done, false);
    assert.deepEqual(wobbleAt(k, 1000 + WOBBLE_MS), {value: 0, done: true}, 'over');
    const two = [{at: 1000, strength: 1}, {at: 1000, strength: 0.5}];
    assert.ok(Math.abs(wobbleAt(two, 1080).value - 1.5 * wobbleAt(k, 1080).value) < 1e-9, 'kicks add up');
    assert.ok(wobbleAt([{at: 2000, strength: 1}], 1500).value === 0, 'a kick to come does nothing yet');
    assert.deepEqual(wobbleAt([], 1000), {value: 0, done: true});
});

test('hopFrames: a crouch, stretched on the way up, squashed on each landing, two lower rebounds, at rest at the end', () => {
    const f = hopFrames(30);
    for (const k of f)
        for (const key of ['scale_x', 'scale_y', 'translation_y', 'duration', 'mode'])
            assert.ok(k[key] !== undefined, `every frame sets ${key}`);
    assert.ok(f[0].scale_y < 1 && f[0].translation_y === 0, 'a crouch first');
    const ups = f.filter((k, i) => i > 0 && k.translation_y < f[i - 1].translation_y);
    assert.equal(ups.length, 3, 'the jump and two rebounds');
    assert.ok(ups.every(k => k.scale_y > 1 && k.scale_x < 1), 'stretched on the way up');
    assert.equal(ups[0].translation_y, -30, 'the jump is as high as asked');
    assert.ok(ups[0].translation_y < ups[1].translation_y && ups[1].translation_y < ups[2].translation_y && ups[2].translation_y < 0,
        'each rebound lower than the one before');
    const lands = f.filter(k => k.land);
    assert.equal(lands.length, 3, 'three landings');
    assert.ok(lands.every(k => k.scale_y < 1 && k.scale_x > 1 && k.translation_y === 0), 'squashed on the ground');
    assert.ok(lands[0].land > lands[1].land && lands[1].land > lands[2].land, 'each landing kicks her hair less');
    assert.deepEqual([f.at(-1).scale_x, f.at(-1).scale_y, f.at(-1).translation_y], [1, 1, 0], 'at rest at the end');
    const total = f.reduce((n, k) => n + k.duration, 0);
    assert.ok(total >= 1300 && total <= 1800, `about 1.5 s (${total} ms)`);
    assert.ok(f.every(k => /^EASE_|^LINEAR$/.test(k.mode)), 'Clutter animation mode names');
    assert.equal(hopFrames(10).find(k => k.translation_y < 0).translation_y, -10, 'the height scales the jump');
});

// ---- the moves of 2026-11-06: pat, drag, breeze, shadow, notification, heat, flip, music nod ----------------

test('the new moves have their phrases', () => {
    for (const kind of ['pat', 'drag', 'flip', 'heat'])
        assert.ok(PHRASES[kind]?.length >= 2, `${kind} has phrases`);
});

test('inHead and patStep: a pat is the pointer moving over her head for a while, not a quick pass', () => {
    const head = [0.2, 0.1, 0.8, 0.5]; // the chin at 0.1 + 0.8 x 0.4 = 0.42
    assert.equal(inHead(head, 0.5, 0.3), true, 'over her face');
    assert.equal(inHead(head, 0.5, 0.45), false, 'below her chin');
    assert.equal(inHead(head, 0.1, 0.3), false, 'beside her head');
    let s = null, pat = false;
    for (let t = 0; t <= 800; t += 100) { // rubbing 40 px back and forth every 100 ms
        ({state: s, pat} = patStep(s, {x: (t / 100) % 2 ? 40 : 0, y: 0, at: t, inHead: true}));
        if (t < PAT_DWELL_MS)
            assert.equal(pat, false, `not yet at ${t} ms`);
    }
    assert.equal(pat, true, 'patted after the dwell, with enough travel');
    s = null;
    for (let i = 0; i <= 2; i++)
        ({state: s, pat} = patStep(s, {x: i * 150, y: 0, at: i * 100, inHead: true}));
    assert.equal(pat, false, 'a quick pass is no pat');
    s = null;
    for (let t = 0; t <= 2000; t += 100)
        ({state: s, pat} = patStep(s, {x: 10, y: 10, at: t, inHead: true}));
    assert.equal(pat, false, 'a pointer at rest over her head is no pat');
    const going = {since: 0, last: {x: 0, y: 0, at: 900}, travel: 500};
    assert.equal(patStep(going, {x: 0, y: 0, at: 950, inHead: false}).state, null, 'off her head: over');
    ({state: s, pat} = patStep(going, {x: 40, y: 0, at: 1400, inHead: true}));
    assert.ok(!pat && s.travel === 0 && s.since === 1400, 'a pause starts it over');
    const half = {since: 0, last: {x: 0, y: 0, at: 900}, travel: 100};
    assert.equal(patStep(half, {x: 30, y: 0, at: 1000, inHead: true}).pat, true, '130 px at 100 % size');
    assert.equal(patStep(half, {x: 30, y: 0, at: 1000, inHead: true}, 240).pat, false, 'a bigger Nyx needs more travel');
});

test('swingStep: she lags behind the push of the pointer, swings back and settles, never past SWING_MAX', () => {
    assert.deepEqual(swingStep({angle: 0, vel: 0}, 0, 1 / 60), {angle: 0, vel: 0}, 'still without a push');
    let s = {angle: 0, vel: 0};
    for (let i = 0; i < 6; i++)
        s = swingStep(s, 8000, 1 / 60);
    assert.ok(s.angle > 1, 'a push to the right turns her clockwise (her feet lag to the left)');
    let crossed = false;
    for (let i = 0; i < 90; i++) {
        s = swingStep(s, 0, 1 / 60);
        crossed ||= s.angle < 0;
    }
    assert.ok(crossed, 'she swings back past the middle');
    for (let i = 0; i < 400; i++)
        s = swingStep(s, 0, 1 / 60);
    assert.ok(Math.abs(s.angle) < 0.5, 'and settles');
    s = {angle: 0, vel: 0};
    for (let i = 0; i < 120; i++)
        s = swingStep(s, 1e6, 1 / 60);
    assert.ok(Math.abs(s.angle) <= SWING_MAX, 'held at SWING_MAX');
    s = swingStep({angle: 20, vel: 0}, 0, 0.5);
    assert.ok(Math.abs(s.angle) <= SWING_MAX && Number.isFinite(s.vel), 'a stalled frame does not blow up');
});

test('windAt: a gust rises from still, peaks midway with a light flutter, and is over after its length', () => {
    const g = {at: 1000, dur: GUST_MS, strength: 1};
    assert.deepEqual(windAt(null, 0), {value: 0, done: true});
    assert.equal(windAt(g, 1000).value, 0, 'starts still');
    assert.deepEqual(windAt(g, 500), {value: 0, done: false}, 'a gust to come');
    const mid = windAt(g, 1000 + GUST_MS / 2).value;
    assert.ok(mid > 0.6, 'strong midway');
    const vals = [];
    for (let t = 1000; t < 1000 + GUST_MS; t += 10)
        vals.push(windAt(g, t).value);
    assert.ok(vals.every(v => v >= 0) && Math.max(...vals) <= 1.25, 'one way, the flutter small');
    assert.ok(vals.slice(-5).every(v => v < 0.02), 'dies down at the end');
    assert.deepEqual(windAt(g, 1000 + GUST_MS), {value: 0, done: true});
    assert.ok(Math.abs(windAt({...g, strength: 0.5}, 1000 + GUST_MS / 2).value - mid / 2) < 1e-9, 'scales with the strength');
});

test('shadowAt: full under her feet, smaller and fainter as she rises, gone high up', () => {
    assert.deepEqual(shadowAt(0), {scale: 1, alpha: 1});
    assert.deepEqual(shadowAt(-5), {scale: 1, alpha: 1}, 'below the ground counts as on it');
    const a = shadowAt(30), b = shadowAt(90);
    assert.ok(a.scale < 1 && b.scale < a.scale && a.alpha < 1 && b.alpha < a.alpha, 'shrinks and fades');
    assert.deepEqual(shadowAt(SHADOW_FADE_PX), {scale: 0.5, alpha: 0});
    assert.deepEqual(shadowAt(1000), {scale: 0.5, alpha: 0});
});

test('notifyGate: notifications that would show a banner, outside the quiet times, at most one per ALERT_GAP_MS', () => {
    const n = {acknowledged: false, urgency: 1, showBanners: true};
    const ctx = {now: 10000, last: null, visible: true, meeting: false, sleeping: false, busy: false};
    assert.equal(notifyGate(n, ctx), true);
    assert.equal(notifyGate({...n, acknowledged: true}, ctx), false, 'already seen');
    assert.equal(notifyGate({...n, urgency: 0}, ctx), false, 'low urgency shows no banner');
    assert.equal(notifyGate({...n, showBanners: false}, ctx), false, 'banners off for that app, or Do Not Disturb');
    assert.equal(notifyGate({...n, showBanners: false, urgency: 3}, ctx), true, 'a critical one still shows');
    for (const k of ['meeting', 'sleeping', 'busy'])
        assert.equal(notifyGate(n, {...ctx, [k]: true}), false, k);
    assert.equal(notifyGate(n, {...ctx, visible: false}), false, 'the gadget is hidden');
    assert.equal(notifyGate(n, {...ctx, last: 10000 - ALERT_GAP_MS + 1}), false, 'too soon after the last one');
    assert.equal(notifyGate(n, {...ctx, last: 10000 - ALERT_GAP_MS}), true);
});

test('parseMilliC reads hwmon millidegrees, and nothing that is not a reading', () => {
    assert.equal(parseMilliC('58375\n'), 58.375);
    for (const bad of ['', null, undefined, 'abc'])
        assert.equal(parseMilliC(bad), null, String(bad));
    assert.equal(parseMilliC('0'), null, 'an unwired sensor reads 0');
    assert.equal(parseMilliC('200000'), null, 'nothing past 150 °C');
});

test('heatStep: hot after two samples over the line, cool after two under the lower one', () => {
    let s = heatStep(HEAT_START, {cpu: 90, gpu: 50});
    assert.equal(s.hot, false, 'one sample is not enough');
    s = heatStep(s, {cpu: 90, gpu: 50});
    assert.equal(s.hot, true, 'the CPU is hot');
    s = heatStep(heatStep(s, {cpu: 80, gpu: 50}), {cpu: 80, gpu: 50});
    assert.equal(s.hot, true, 'between the two lines she stays hot');
    s = heatStep(s, {cpu: 70, gpu: 50});
    assert.equal(s.hot, true);
    s = heatStep(s, {cpu: 70, gpu: 50});
    assert.equal(s.hot, false, 'two cool samples');
    s = heatStep(heatStep(HEAT_START, {cpu: 50, gpu: HEAT.gpuOn}), {cpu: 50, gpu: HEAT.gpuOn});
    assert.equal(s.hot, true, 'the GPU junction alone');
    let t = HEAT_START;
    for (let i = 0; i < 6; i++)
        t = heatStep(t, {cpu: i % 2 ? 90 : 60, gpu: 40});
    assert.equal(t.hot, false, 'a flapping reading never flips her');
    t = HEAT_START;
    for (let i = 0; i < 4; i++)
        t = heatStep(t, {cpu: null, gpu: null});
    assert.equal(t.hot, false, 'without sensors, never hot');
    assert.ok(HEAT.cpuOff < HEAT.cpuOn && HEAT.gpuOff < HEAT.gpuOn, 'a gap between the lines');
    assert.deepEqual([HEAT.cpuOn, HEAT.gpuOn], [85, 80]);
});

test('isDoubleTap: a second click within the double-click time', () => {
    assert.equal(isDoubleTap(null, 1000, 400), false);
    assert.equal(isDoubleTap(1000, 1400, 400), true);
    assert.equal(isDoubleTap(1000, 1401, 400), false);
});

test('flipFrames: a crouch, a full turn about her centre in the air, squashed on landing, at rest at the end', () => {
    const f = flipFrames(56);
    for (const k of f)
        for (const key of ['scale_x', 'scale_y', 'translation_y', 'duration', 'mode'])
            assert.ok(k[key] !== undefined, `every frame sets ${key}`);
    const i = f.findIndex(k => k.spin);
    const spin = f[i];
    assert.ok(f.slice(0, i).some(k => k.scale_y < 1), 'a crouch before the take-off');
    assert.deepEqual(spin.pivot, [0.5, 0.5], 'she turns about her centre');
    assert.equal(Math.abs(spin.spin.rotation_angle_z), 360, 'a full turn');
    assert.equal(spin.translation_y, -56, 'as high as asked');
    const land = f.findIndex(k => k.land === 1);
    assert.equal(spin.spin.duration, f.slice(i, land).reduce((n, k) => n + k.duration, 0), 'the turn lasts her time in the air');
    assert.deepEqual(f[land].pivot, [0.5, 1], 'she lands on her feet');
    assert.equal(f[land].rotation_angle_z, 0, 'upright again');
    assert.ok(f[land].scale_y < 1 && f[land].translation_y === 0, 'squashed on the ground');
    for (const [j, k] of f.entries())
        if (k.pivot && j > 0)
            assert.deepEqual([f[j - 1].scale_x, f[j - 1].scale_y], [1, 1], `frame ${j}: the pivot moves at scale 1, so nothing jumps`);
    assert.deepEqual([f.at(-1).scale_x, f.at(-1).scale_y, f.at(-1).translation_y], [1, 1, 0], 'at rest at the end');
    assert.ok(f.slice(0, i + 1).some(k => k.kick), 'her hair swings at the take-off');
    const total = f.reduce((n, k) => n + k.duration, 0);
    assert.ok(total >= 1000 && total <= 1700, `about 1.3 s (${total} ms)`);
    assert.ok(f.every(k => /^EASE_|^LINEAR$/.test(k.mode)) && /^EASE_|^LINEAR$/.test(spin.spin.mode), 'Clutter animation mode names');
});

test('nodAt: down on each beat and back up, a slight groove to alternate sides', () => {
    const beat = 60000 / NOD_BPM;
    assert.deepEqual(nodAt(0), {x: 0, y: 0});
    assert.ok(Math.abs(nodAt(beat * 0.25).y - 1) < 1e-9, 'all the way down a quarter into the beat');
    assert.ok(nodAt(beat * 0.99).y < 0.05, 'back up by the next beat');
    assert.ok(nodAt(beat * 0.25).x > 0 && nodAt(beat * 1.25).x < 0, 'the groove alternates');
    assert.ok(Math.abs(nodAt(beat * 1.25).x) < nodAt(beat * 1.25).y, 'the groove is smaller than the nod');
    const ys = [];
    for (let t = 0; t < beat * 4; t += 5)
        ys.push(nodAt(t).y);
    assert.ok(ys.every(y => y >= 0 && y <= 1));
    assert.ok(NOD_BPM >= 80 && NOD_BPM <= 120, 'a relaxed tempo');
});

test('nodLevel fades the nod in when the music starts and out when it stops', () => {
    assert.deepEqual(nodLevel(null, 0), {level: 0, done: true});
    assert.equal(nodLevel({since: 1000, until: null}, 1000).level, 0);
    assert.equal(nodLevel({since: 1000, until: null}, 1000 + NOD_FADE_MS).level, 1);
    assert.equal(nodLevel({since: 1000, until: null}, 99999).done, false, 'it goes on while the music plays');
    const off = {since: 0, until: 5000};
    assert.equal(nodLevel(off, 5000 + NOD_FADE_MS / 2).level, 0.5);
    assert.deepEqual(nodLevel(off, 5000 + NOD_FADE_MS), {level: 0, done: true});
});

test('ground.json: the feet of every look that stands on the floor, and none for the hips-up, perched or lying ones', () => {
    const {variants, poses, beach} = JSON.parse(readFileSync(join(assets, 'variants.json'), 'utf8'));
    const ground = JSON.parse(readFileSync(join(assets, 'ground.json'), 'utf8'));
    const specs = [...Object.values(variants), ...Object.values(poses), ...Object.values(beach.looks)];
    const standing = spec => spec.layout === 'beside' && spec.size[1] >= 540; // full body, feet at the bottom
    for (const spec of specs) {
        const g = ground[spec.body];
        assert.equal(Boolean(g), standing(spec), `${spec.body}: a shadow only where she stands on the floor`);
        if (g)
            assert.ok(g.x0 >= 0 && g.x1 <= 1 && g.x1 - g.x0 >= 0.15, `${spec.body}: her feet span ${g.x0}-${g.x1}`);
    }
    assert.equal(Object.keys(ground).length, specs.filter(standing).length, 'no span left for a PNG that is gone');
    const [w, h] = pngSize('nyx-sweat.png');
    assert.ok(w < h && h <= 40, 'the sweat drop is a small upright drop');
});

test('clipBox places a clip on its look, scaled with the look, and says how far it reaches past it', () => {
    assert.deepEqual(clipBox({}, [406, 442], 406, 442), {x: 0, y: 0, width: 406, height: 442, reach: 0},
        'a clip without a box covers the look');
    const clip = {box: [-20, -12, 446, 454]};
    assert.deepEqual(clipBox(clip, [406, 442], 406, 442), {x: -20, y: -12, width: 446, height: 454, reach: 20});
    assert.deepEqual(clipBox(clip, [406, 442], 203, 221), {x: -10, y: -6, width: 223, height: 227, reach: 10},
        'at half size the box halves');
    assert.equal(clipBox({box: [0, -30, 406, 472]}, [406, 442], 406, 442).reach, 30, 'the top counts too');
});

test('clipFrame steps through the frames at the clip fps, from the time the clip started', () => {
    const clip = {frames: 36, fps: 12, gap: 0};
    assert.deepEqual(clipFrame(clip, 0), {index: 0, done: false});
    assert.deepEqual(clipFrame(clip, 1000 / 12 - 1), {index: 0, done: false});
    assert.deepEqual(clipFrame(clip, 1000 / 12), {index: 1, done: false});
    assert.deepEqual(clipFrame(clip, 2999), {index: 35, done: false});
    assert.deepEqual(clipFrame(clip, -50), {index: 0, done: false}, 'a clock that went back holds the first frame');
});

test('clipFrame loops with no gap, and holds the first frame for the gap between plays', () => {
    assert.deepEqual(clipFrame({frames: 36, fps: 12, gap: 0}, 3000), {index: 0, done: false});
    assert.deepEqual(clipFrame({frames: 36, fps: 12, gap: 0}, 3000 + 1000 / 12), {index: 1, done: false});
    const rest = {frames: 36, fps: 12, gap: 4000};
    assert.deepEqual(clipFrame(rest, 3000), {index: 0, done: false}, 'the gap starts on the first frame');
    assert.deepEqual(clipFrame(rest, 6999), {index: 0, done: false}, 'and holds it');
    assert.deepEqual(clipFrame(rest, 7000 + 1000 / 12), {index: 1, done: false}, 'then plays again');
});

test('clipFrame plays a once clip a single time and says when it is done', () => {
    const wave = {frames: 36, fps: 12, gap: 0, once: true};
    assert.deepEqual(clipFrame(wave, 1500), {index: 18, done: false});
    assert.deepEqual(clipFrame(wave, 3000), {index: 0, done: true});
    assert.deepEqual(clipFrame(wave, 9000), {index: 0, done: true});
});

// ---- characters -----------------------------------------------------------------------------------

test("phraseFor reads a character's own table: a kind she lacks shows no bubble, never Nyx's line", () => {
    const okane = {cheer: ['¡Eso es!'], money: ['Eso vale plata', 'Yo se lo fío']};
    assert.equal(phraseFor('money', 1, okane), 'Yo se lo fío');
    assert.equal(phraseFor('cheer', 7, okane), '¡Eso es!');
    assert.equal(phraseFor('duck', 0, okane), null, 'no duck lines: no bubble');
    assert.equal(phraseFor('duck', 0, {}), null);
    assert.equal(phraseFor('missing', 0), PHRASES.cheer[0], "Nyx's own table keeps its cheer fallback");
    assert.equal(phraseFor('peek', 0, PHRASES), PHRASES.peek[0]);
});

test('the money moment joins the rotation of a look that has the money pose drawn, and no other', () => {
    const plain = {poses: {cheer: 'cheer', money: 'money'}};
    const all = [0, 1, 2, 3, 4].map(i => momentFor(plain, i));
    assert.deepEqual(all.filter(m => m.pose === 'money'), [{move: 'hop', pose: 'money', phrases: 'money'}]);
    assert.ok(all.some(m => m.pose === 'cheer'), 'she still cheers');
    assert.equal(all.length, new Set(all.map(m => JSON.stringify(m))).size, 'five different moments');
    const nyx = JSON.parse(readFileSync(join(assets, 'variants.json'), 'utf8')).variants;
    for (const [name, spec] of Object.entries(nyx))
        for (let i = 0; i < 12; i++)
            assert.notEqual(momentFor(spec, i).pose, 'money', `${name} has no money pose`);
});

test("rotationVariant follows a character's own forms when her manifest lists them", () => {
    const variants = {hips: {}, full: {}};
    assert.deepEqual([0, 1, 2].map(step => rotationVariant(variants, 'hips', step, ['hips', 'full'])), ['hips', 'full', 'hips']);
    assert.deepEqual([0, 1].map(step => rotationVariant(variants, 'full', step, ['hips', 'full', 'lying'])), ['full', 'hips'],
        'a form she lacks is skipped');
    assert.equal(rotationVariant(variants, 'beach', 3, ['hips', 'full']), 'beach', 'a look outside the forms stays put');
    assert.equal(rotationVariant(variants, 'hips', 1), 'hips', "without forms, Nyx's forms: Okane's hips has none of them");
});
