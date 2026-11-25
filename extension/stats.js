// Pure parsing and formatting for nyx-monitor. No `gi://` imports, so gjs (the extension) and
// Node (the tests) both load this file. The numbers match herdr's system bar (herdr-sys), so both
// agree.

// /proc/stat: busy = user + system, total = the first seven fields
// (user nice system idle iowait irq softirq), exactly as herdr-sys counts them.
export function parseCpu(procStat) {
    const line = procStat.split('\n').find(l => /^cpu\s/.test(l));
    if (!line)
        return null;
    const f = line.trim().split(/\s+/).slice(1, 8).map(Number);
    if (f.length < 7 || f.some(n => !Number.isFinite(n)))
        return null;
    return {busy: f[0] + f[2], total: f.reduce((a, b) => a + b, 0)};
}

// Busy percent between two samples, truncated like herdr-sys's integer arithmetic.
// null until there is a previous sample.
export function cpuPercent(prev, cur) {
    if (!prev || !cur)
        return null;
    const dt = cur.total - prev.total;
    if (dt <= 0)
        return null;
    return clamp(Math.trunc((cur.busy - prev.busy) * 100 / dt), 0, 100);
}

// /proc/meminfo: used = MemTotal - MemAvailable, in GiB (kB / 1048576).
export function parseMem(meminfo) {
    const kb = key => {
        const m = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
        return m ? Number(m[1]) : null;
    };
    const total = kb('MemTotal');
    const avail = kb('MemAvailable');
    if (total === null || avail === null || total <= 0)
        return null;
    return {usedGiB: (total - avail) / 1048576, totalGiB: total / 1048576};
}

// amdgpu's gpu_busy_percent holds one integer.
export function parseGpuBusy(text) {
    const n = Number.parseInt(String(text).trim(), 10);
    return Number.isFinite(n) ? clamp(n, 0, 100) : null;
}

// cards: [{name, vramTotal, hasBusy}]. The card with the most VRAM wins, so an iGPU that comes
// back in the BIOS is never chosen over the RX 7800 XT.
export function pickGpu(cards) {
    let best = null;
    for (const c of cards) {
        if (!c.hasBusy)
            continue;
        if (!best || (c.vramTotal ?? 0) > (best.vramTotal ?? 0))
            best = c;
    }
    return best ? best.name : null;
}

// One snapshot for the card. Every field is null when its source could not be read.
export function snapshot(prevCpu, procStat, meminfo, gpuText) {
    const cpu = procStat ? parseCpu(procStat) : null;
    const mem = meminfo ? parseMem(meminfo) : null;
    const gpu = gpuText === null || gpuText === undefined ? null : parseGpuBusy(gpuText);
    const cpuPct = cpuPercent(prevCpu, cpu);
    return {
        cpuSample: cpu,
        cpu: {text: cpuPct === null ? '..%' : `${cpuPct}%`, fraction: (cpuPct ?? 0) / 100},
        ram: mem
            ? {text: `${mem.usedGiB.toFixed(1)}G`, fraction: mem.usedGiB / mem.totalGiB,
                totalText: `${mem.totalGiB.toFixed(0)}G`}
            : {text: '?', fraction: 0, totalText: ''},
        gpu: gpu === null ? {text: '-', fraction: 0} : {text: `${gpu}%`, fraction: gpu / 100},
    };
}

// Bar level for colouring: calm below 60 %, busy up to 85 %, hot above.
export function level(fraction) {
    if (fraction >= 0.85)
        return 'hot';
    if (fraction >= 0.6)
        return 'busy';
    return 'calm';
}

// ---- Nyx's personality -----------------------------------------------------------------------

// Phrases for the speech bubble, by kind. Neutral Spanish with tú.
export const PHRASES = {
    cheer: ['¡Vas muy bien!', 'Commit pequeño, commit feliz', 'Un test más y listo',
        'Ese código se ve bonito', '¡Tests en verde, a celebrar!'],
    focus: ['¡Tú puedes con este bug!', 'Lee el error completo, a veces trae la respuesta',
        'Divide el problema en pasos chiquitos', 'Primero que funcione, luego que sea bonito',
        'Un paso a la vez'],
    peek: ['¿Ya hiciste commit?', '¿Ya tomaste agua?', '¿Guardaste el archivo?',
        '¿Y si haces una pausa de 5 minutos?', '¿Ya hiciste git push?'],
    duck: ['Explícale el bug al patito', 'Cuéntale al patito qué esperabas que pasara',
        'El patito escucha sin juzgar'],
    cheerleader: ['¡Tú logras todo lo que te propones, es un hecho!'],
    hot: ['¡Uf, qué calor!', '¡Esto va a tope!'],
    ram: ['¡La RAM está llena!', '¿Cerramos unas pestañas?'],
    wake: ['¡Volviste! A programar', 'Me quedé dormida... ¿seguimos?'],
    // Clicks on her in full mode: a few make her pout, more make her dizzy, too many and she leaves.
    poke: ['¡Oye, eso hace cosquillas!', '¿Me necesitas para algo?', 'Sí, sí, aquí estoy', '¡Ay! ¿Qué pasó?'],
    spin: ['Todo me da vueltas...', '¡Para, que me mareo!', 'Veo tres tarjetas de CPU...'],
    launch: ['¡Suficiente! Me voy', '¡Modo cohete activado!', 'Voy por refuerzos'],
    back: ['Ya volví. ¿Me extrañaste?', 'Fui a ver el disco por dentro', 'Listo, ya se me pasó'],
    duckback: ['Traje refuerzos', 'Él escucha sin hacer clic', 'Ahora somos dos'],
    // The system: the UPS goes on battery or back on line, a systemd unit fails.
    outage: ['¡Se fue la luz! Guarda tu trabajo', '¡Sin luz! La UPS nos sostiene', '¡Apagón! Guarda todo ya'],
    restored: ['¡Volvió la luz!', 'Uf, ya regresó la luz'],
    failed: ['¡Algo falló! Un servicio se cayó', 'Un servicio dejó de funcionar, échale un ojo',
        '¡Ay! Algo se rompió en el sistema'],
    // The moves of 2026-11-06: a pat on her head, picked up with the mouse, the double-click flip, the heat.
    pat: ['Mmm... gracias', 'Me encanta que hagas eso', 'Jeje, otra vez', 'Así se me quita el estrés'],
    drag: ['¡Wiii!', '¡Oye, bájame!', '¿A dónde vamos?', 'Qué vista desde aquí arriba'],
    flip: ['¡Ta-dá!', '¿Viste eso? Diez de diez', '¡Aterrizaje perfecto!'],
    heat: ['¡Qué calor hace aquí adentro!', 'Me estoy derritiendo, ¿y si bajamos la carga?',
        '¿Le subimos a los ventiladores?'],
};

// The n-th phrase of a kind; consecutive counters never repeat a phrase. `table` is the character's own (a pack's
// phrases.json); a kind missing from another character's table gives null, no bubble, never one of Nyx's lines.
export function phraseFor(kind, n, table = PHRASES) {
    const list = table[kind] ?? (table === PHRASES ? PHRASES.cheer : null);
    if (!list?.length)
        return null;
    return list[((n % list.length) + list.length) % list.length];
}

// A face reacts to the load: a full RAM makes her pout, CPU or GPU at the threshold for two samples
// in a row makes her dizzy. history: [{cpu, gpu, ram}] fractions, newest last.
export function reaction(history, threshold = 0.85) {
    const last = history.at(-1);
    if (!last)
        return null;
    if (last.ram >= threshold)
        return 'pout';
    const hot = s => Boolean(s) && (s.cpu >= threshold || s.gpu >= threshold);
    if (hot(last) && hot(history.at(-2)))
        return 'dizzy';
    return null;
}

// The phrase kind a reaction announces itself with.
export function reactionPhrases(face) {
    return face === 'pout' ? 'ram' : 'hot';
}

// The periodic moments, in rotation. A moment may change her pose or face for a while, plays a move
// and says a phrase. Faces and poses exist only for some looks; a pose moment needs that pose drawn.
const MOMENTS = {
    faces: [
        {move: 'wave', face: 'stars', phrases: 'cheer'},
        {move: 'hop', pose: 'peek', phrases: 'peek'},
        {move: 'hop', face: 'determined', phrases: 'focus'},
        {move: 'sway', pose: 'duck', phrases: 'duck'},
    ],
    feet: [{move: 'feet', phrases: 'cheer'}, {move: 'feet', phrases: 'peek'}, {move: 'feet', phrases: 'focus'}],
    hand: [{move: 'wave', phrases: 'cheer'}, {move: 'hop', phrases: 'peek'}, {move: 'wave', phrases: 'focus'}],
    plain: [{move: 'hop', phrases: 'cheer'}, {move: 'sway', phrases: 'peek'}, {move: 'hop', phrases: 'focus'}],
};

// The cheer (gray pom-poms, two frames) joins the rotation of every look that has the pose drawn.
const CHEER = {move: 'cheer', pose: 'cheer', phrases: 'cheerleader'};
// Okane rubs her fingers for money (her `money` pose, a clip): it joins the rotation of a look that has it drawn.
const MONEY = {move: 'hop', pose: 'money', phrases: 'money'};
// A look with faces but without the peek pose (standing, lying) still says the peek phrases.
const NO_POSE = {peek: {move: 'sway', phrases: 'peek'}};

export function momentFor(spec, count) {
    const base = spec.faces ? MOMENTS.faces : spec.feet ? MOMENTS.feet : spec.hand ? MOMENTS.hand : MOMENTS.plain;
    const list = [...base, CHEER, MONEY].flatMap(m => !m.pose || spec.poses?.[m.pose] ? [m] : NO_POSE[m.pose] ? [NO_POSE[m.pose]] : []);
    const m = list[count % list.length];
    // The lying Nyx swings her feet instead of waving, hopping or swaying.
    return spec.feet && ['wave', 'hop', 'sway'].includes(m.move) ? {...m, move: 'feet'} : m;
}

// She falls asleep after `minutes` without keyboard or mouse (0 turns it off).
export function shouldSleep(idleMs, minutes) {
    return minutes > 0 && idleMs >= minutes * 60000;
}

// ---- clicks on Nyx (full mode only) ------------------------------------------------------------

// A click within TAP_GAP_MS of the previous one extends the streak; a longer pause starts over.
export const TAP_GAP_MS = 1000;

export function tapStreak(streak, lastMs, nowMs, gap = TAP_GAP_MS) {
    return lastMs !== null && lastMs !== undefined && nowMs - lastMs <= gap ? streak + 1 : 1;
}

// What a streak sets off as it reaches each step: a poke at 3 clicks, a spin at 6, the launch at 10.
const TAP_STAGES = {3: 'poke', 6: 'spin', 10: 'launch'};

export function tapStage(streak) {
    return TAP_STAGES[streak] ?? null;
}

// ---- the demo tour -----------------------------------------------------------------------------

// One step every DEMO_STEP_MS: first every look with its greeting, then every animation, in this
// order, on a look that has every face and pose.
export const DEMO_STEP_MS = 10000;
export const DEMO_ACTS = ['stars', 'peek', 'determined', 'duck', 'cheer', 'pout', 'dizzy', 'outage', 'restored', 'failed',
    'poke', 'spin', 'flip', 'pat', 'alert', 'heat', 'launch', 'sleep', 'wake'];

// variants: the manifest's variants (in its order). The animations play on `current` when it has
// every face and pose, else on the first look that does. Returns [{variant, act}], plus `index` on
// the steps that show a resting pose.
export function demoSteps(variants, current) {
    const names = Object.keys(variants);
    const rich = v => Boolean(variants[v]?.faces) && ['peek', 'sleep', 'duck'].every(p => variants[v].poses?.[p]);
    const host = rich(current) ? current : names.find(rich);
    // Each look greets; a look that also cheers does it right after, except the host, which cheers
    // among its animations. Then come its resting poses, the headphones and the meeting pose, if drawn.
    const steps = names.flatMap(variant => {
        const v = variants[variant];
        const own = [{variant, act: 'greet'}];
        if (variant !== host && v.poses?.cheer)
            own.push({variant, act: 'cheer'});
        (v.rest ?? []).forEach((_, index) => own.push({variant, act: 'rest', index}));
        for (const act of ['music', 'meeting']) {
            if (v.poses?.[act])
                own.push({variant, act});
        }
        return own;
    });
    if (host)
        steps.push(...DEMO_ACTS.map(act => ({variant: host, act})));
    return steps;
}

// ---- the system: power and failed services -----------------------------------------------------

// The line sent to upsd (NUT, localhost:3493) for one UPS's status; null for a name that could
// smuggle another command in.
export function upsQuery(name) {
    return /^[\w.-]+$/.test(name ?? '') ? `GET VAR ${name} ups.status\nLOGOUT\n` : null;
}

// upsd's reply, e.g. `VAR hikvision ups.status "OB DISCHRG"`: 'battery' when OB is among the flags,
// 'online' when OL is, null when the reply is anything else.
export function parseUpsStatus(reply) {
    const m = /ups\.status "([^"]*)"/.exec(reply ?? '');
    if (!m)
        return null;
    const flags = m[1].split(/\s+/);
    return flags.includes('OB') ? 'battery' : flags.includes('OL') ? 'online' : null;
}

// 'outage' when the power goes (also when it is already gone at the first reading), 'restored' when
// it comes back, null otherwise. A failed read (null) changes nothing.
export function powerEvent(prev, cur) {
    if (cur === 'battery' && prev !== 'battery')
        return 'outage';
    if (cur === 'online' && prev === 'battery')
        return 'restored';
    return null;
}

// systemd's NFailedUnits went up since the last reading; the first reading is only the baseline.
export function failedRose(prev, cur) {
    return prev !== null && prev !== undefined && cur !== null && cur !== undefined && cur > prev;
}

// ---- the beach mode --------------------------------------------------------------------------------

// The step-th pose of the beach series (`beach.steps` in variants.json), wrapping around: a look of its
// own (the horizontal ones, on the wide card) or a resting pose of the look whose `rest` lists it.
// {variant, rest} with rest -1 for the look itself; null for an unknown step or no steps at all.
export function beachStep(beach, index) {
    const steps = beach?.steps ?? [];
    if (!steps.length)
        return null;
    const name = steps[((index % steps.length) + steps.length) % steps.length];
    if (beach.looks?.[name])
        return {variant: name, rest: -1};
    for (const [variant, look] of Object.entries(beach.looks ?? {})) {
        const rest = (look.rest ?? []).indexOf(name);
        if (rest >= 0)
            return {variant, rest};
    }
    return null;
}

// ---- the hourly rotation -----------------------------------------------------------------------

// The forms of a look: from the hips up, full body and lying. The outfit carries over when that form
// exists in it; lying exists only in the sweater. Another character lists her own (`forms` in her manifest).
function formsOf(variants, chosen, own) {
    if (own)
        return own.filter(f => variants[f]);
    const outfit = chosen === 'hips' || chosen === 'full-chibi' || chosen === 'lying-chibi'
        ? null : chosen.replace(/^(hips|full)-/, '');
    const forms = outfit
        ? [`hips-${outfit}`, `full-${outfit}`, 'lying-chibi']
        : ['hips', 'full-chibi', 'lying-chibi'];
    return forms.filter(f => variants[f]);
}

// The look shown at the step-th rotation, counting from the chosen one.
export function rotationVariant(variants, chosen, step, own) {
    const forms = formsOf(variants, chosen, own);
    const start = forms.indexOf(chosen);
    if (start < 0)
        return chosen;
    return forms[(start + step) % forms.length];
}

// ---- the look by time of day -------------------------------------------------------------------

// The `schedule` key: entries 'H=look', each one holding from hour H (0 to 23) until the next entry's
// hour; the last one wraps past midnight to the first. Entries with a bad hour or an unknown look are
// skipped; for a repeated hour the later entry wins. Returns the slots sorted by hour.
export function parseSchedule(entries, variants) {
    const byHour = new Map();
    for (const entry of entries ?? []) {
        const m = /^\s*(\d{1,2})\s*=\s*([\w-]+)\s*$/.exec(entry);
        if (!m || Number(m[1]) > 23 || !variants[m[2]])
            continue;
        byHour.set(Number(m[1]), m[2]);
    }
    return [...byHour].sort((a, b) => a[0] - b[0]).map(([hour, variant]) => ({hour, variant}));
}

// The slot in force at that hour, or null without slots. Before the first slot's hour the last one
// still holds.
export function slotAt(slots, hour) {
    if (!slots.length)
        return null;
    let pick = slots[slots.length - 1];
    for (const s of slots) {
        if (s.hour <= hour)
            pick = s;
    }
    return pick;
}

// Seconds from hour:minute:second until the next slot starts; after the last one, the first one tomorrow.
export function secondsToNextSlot(slots, hour, minute, second) {
    if (!slots.length)
        return null;
    const now = hour * 3600 + minute * 60 + second;
    const next = slots.map(s => s.hour * 3600).find(t => t > now) ?? slots[0].hour * 3600 + 86400;
    return next - now;
}

// ---- resting poses and what she reacts to ------------------------------------------------------

// The resting pose she shows at `hour`:`minute`: -1 for her usual look, else an index into the look's
// rest list of `count` poses. Her slot of the day (the schedule's; the whole day from midnight without
// one) is cut into periods of `restMinutes`: the first one shows her usual look, the next ones walk the
// rest list. Each day carries on where the day before stopped, so a list longer than a slot's periods
// (Eve's four poses in two periods) takes turns over the days. `day` counts local days; a slot that
// started before midnight belongs to the day before. restMinutes 0 keeps her usual look.
export function restIndex(slots, hour, minute, restMinutes, count, day = 0) {
    if (!restMinutes || !count)
        return -1;
    const slot = slotAt(slots, hour);
    const start = slot ? slot.hour : 0;
    const next = slot ? slots.find(s => s.hour > start)?.hour ?? slots[0].hour + 24 : 24;
    const period = Math.floor((((hour - start + 24) % 24) * 60 + minute) / restMinutes);
    if (period === 0)
        return -1;
    const perDay = Math.max(1, Math.ceil((next - start) * 60 / restMinutes) - 1);
    const slotDay = hour < start ? day - 1 : day;
    return (((slotDay * perDay + period - 1) % count) + count) % count;
}

// The resting pose she rests in (an index into `restKeys`, the look's rest list; -1 for her usual look): with `auto`
// the clock's pick (`autoIndex`, from restIndex); without it the pose chosen in the settings window, or her usual
// look when this look has not drawn that pose.
export function homeRest(restKeys, auto, chosen, autoIndex) {
    return auto ? autoIndex : restKeys.indexOf(chosen);
}

// A meeting: some app records the microphone and it is not on the ignore list, matched by its
// application id or its name, without case (GNOME's own mic indicator skips the volume control apps
// by id the same way). outputs: [{app, name}], the source outputs of the mixer.
export function micInUse(outputs, ignored) {
    const skip = new Set((ignored ?? []).map(s => s.toLowerCase()));
    return (outputs ?? []).some(o => ![o.app, o.name].some(v => v && skip.has(v.toLowerCase())));
}

// Music: some MPRIS player reports Playing. statuses: each player's PlaybackStatus (null when unread).
export function mprisPlaying(statuses) {
    return (statuses ?? []).includes('Playing');
}

// What she reacts to, steadied over two checks in a row either way, so a short beep or a pause between
// songs changes nothing: 'meeting' (it wins over music), 'music' or null. sample: {mic, music}.
export const CONTEXT_START = Object.freeze({context: null, next: null, seen: 0});

export function contextStep(prev, sample) {
    const want = sample.mic ? 'meeting' : sample.music ? 'music' : null;
    if (want === prev.context)
        return {context: want, next: want, seen: 0};
    const seen = want === prev.next ? prev.seen + 1 : 1;
    return seen >= 2 ? {context: want, next: want, seen: 0} : {context: prev.context, next: want, seen};
}

// ---- where the gadget lives -------------------------------------------------------------------

// The screen right below the primary one when there is one (the small screen under the ultrawide),
// else the primary. monitors: [{x, y, width, height}]; returns an index into it.
export function pickMonitor(monitors, primary) {
    const p = monitors[primary];
    if (!p)
        return primary;
    let best = primary;
    let bestY = Infinity;
    monitors.forEach((m, i) => {
        const overlap = Math.min(m.x + m.width, p.x + p.width) - Math.max(m.x, p.x);
        if (i !== primary && m.y >= p.y + p.height && overlap > 0 && m.y < bestY) {
            best = i;
            bestY = m.y;
        }
    });
    return best;
}

// ---- her hair's swing and the jump ------------------------------------------------------------

// How much a spot of a look swings, 0 to 1, from its sway map (assets/sway.json: rows of digits 0-9, one per
// cell), read between the cell centres and held at the edge outside the map. u, v: 0..1 across the look.
export function swayWeight(map, u, v) {
    const rows = map?.rows;
    if (!rows?.length)
        return 0;
    const R = rows.length, C = rows[0].length;
    const x = clamp(u * C - 0.5, 0, C - 1), y = clamp(v * R - 0.5, 0, R - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(C - 1, x0 + 1), y1 = Math.min(R - 1, y0 + 1);
    const at = (c, r) => Number(rows[r][c]) / 9;
    const fx = x - x0, fy = y - y0;
    const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
    const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
    return top * (1 - fy) + bottom * fy;
}

// Where a spot moves, in pixels: out from her head's centre (map.cx) and down, by its weight, the wobble's
// value right now (wobbleAt) and the amplitude. A negative value tucks the hair in and lifts it.
export const SWAY_SIDE = 0.1; // how far from her head's centre (0..1 across the look) the swing is fully outward
export const SWAY_DOWN = 0.6; // how much it drops, against how far it goes out

export function swayOffset(map, u, v, value, amp) {
    const w = swayWeight(map, u, v) * value * amp;
    const out = clamp((u - (map?.cx ?? 0.5)) / SWAY_SIDE, -1, 1);
    return [w * out, w * SWAY_DOWN];
}

export const WOBBLE_MS = 1200; // a kick has died away by then
const WOBBLE_PERIOD_MS = 400;
const WOBBLE_DECAY_MS = 280;

// The swing of her hair: each kick ({at, strength}, times in ms) is a damped spring that swings out first;
// kicks add up. done once every kick has died away.
export function wobbleAt(kicks, now) {
    let value = 0;
    let done = true;
    for (const {at, strength} of kicks) {
        const dt = now - at;
        if (dt < WOBBLE_MS)
            done = false;
        if (dt >= 0 && dt < WOBBLE_MS)
            value += strength * Math.exp(-dt / WOBBLE_DECAY_MS) * Math.sin(2 * Math.PI * dt / WOBBLE_PERIOD_MS);
    }
    return {value: done ? 0 : value, done};
}

// The jump, as eases on her look (scale pivot at her feet): a crouch, stretched on the way up, the fall,
// squashed on landing, two lower rebounds, then at rest. land (and kick, on take-off) is how hard that frame
// kicks her hair. Modes are Clutter.AnimationMode names.
export function hopFrames(height = 30) {
    const f = (scale_x, scale_y, translation_y, duration, mode, extra = {}) =>
        ({scale_x, scale_y, translation_y, duration, mode, ...extra});
    const OUT = 'EASE_OUT_QUAD', IN = 'EASE_IN_QUAD';
    const r1 = -Math.round(height * 0.4), r2 = -Math.round(height * 0.15);
    return [
        f(1.1, 0.86, 0, 110, OUT),
        f(0.9, 1.14, -height, 240, OUT, {kick: 0.4}),
        f(0.95, 1.07, 0, 200, IN),
        f(1.16, 0.82, 0, 80, OUT, {land: 1}),
        f(0.96, 1.06, r1, 170, OUT),
        f(1, 1, 0, 150, IN),
        f(1.08, 0.92, 0, 70, OUT, {land: 0.6}),
        f(0.98, 1.03, r2, 120, OUT),
        f(1, 1, 0, 110, IN),
        f(1.04, 0.96, 0, 60, OUT, {land: 0.3}),
        f(1, 1, 0, 220, OUT),
    ];
}

// ---- the moves of 2026-11-06 ---------------------------------------------------------------------

// Her head for a pat: the head box (0..1 across the look) from its top down to the chin, the swing's line too.
export function inHead(head, u, v) {
    const [x0, y0, x1, y1] = head;
    return u >= x0 && u <= x1 && v >= y0 && v <= y0 + 0.8 * (y1 - y0);
}

// A pat: the pointer moving over her head (sample: x, y in px, at in ms, inHead) for PAT_DWELL_MS and travelPx
// of travel. Leaving her head or a pause longer than PAT_GAP_MS starts it over. Returns {state, pat}.
export const PAT_DWELL_MS = 700;
export const PAT_TRAVEL = 120; // px at 100 % size
const PAT_GAP_MS = 400;

export function patStep(state, sample, travelPx = PAT_TRAVEL) {
    if (!sample.inHead)
        return {state: null, pat: false};
    if (!state || sample.at - state.last.at > PAT_GAP_MS)
        return {state: {since: sample.at, last: sample, travel: 0}, pat: false};
    const travel = state.travel + Math.hypot(sample.x - state.last.x, sample.y - state.last.y);
    return {
        state: {since: state.since, last: sample, travel},
        pat: travel >= travelPx && sample.at - state.since >= PAT_DWELL_MS,
    };
}

// Held by the mouse she swings like a pendulum (angle in degrees, clockwise on screen, so her feet go left)
// against the pointer's sideways acceleration ax (px/s²), damped; dt in seconds, cut into small steps.
export const SWING_MAX = 35;
const SWING_K = 60, SWING_DAMP = 5, SWING_GAIN = 0.12;

export function swingStep({angle, vel}, ax, dt) {
    const n = Math.max(1, Math.ceil(dt * 120));
    const h = Math.min(dt, 0.25) / n; // a stalled frame swings a quarter of a second at most
    for (let i = 0; i < n; i++) {
        vel += (-SWING_K * angle - SWING_DAMP * vel + SWING_GAIN * ax) * h;
        angle += vel * h;
        if (Math.abs(angle) > SWING_MAX) {
            angle = Math.sign(angle) * SWING_MAX;
            vel = 0;
        }
    }
    return {angle, vel};
}

// A gust of the beach breeze ({at, dur, strength}, ms): rises from still, peaks midway with a light flutter,
// dies down. value is how far her hair is blown, done once it is over.
export const GUST_MS = 3500;

export function windAt(gust, now) {
    if (!gust)
        return {value: 0, done: true};
    const dt = now - gust.at;
    if (dt < 0)
        return {value: 0, done: false};
    if (dt >= gust.dur)
        return {value: 0, done: true};
    const envelope = Math.sin(Math.PI * dt / gust.dur) ** 2;
    const flutter = 1 + 0.2 * Math.sin(2 * Math.PI * 1.7 * dt / 1000);
    return {value: gust.strength * envelope * flutter, done: false};
}

// Her shadow on the floor as she rises `lift` px (at 100 % size): smaller and fainter, gone at SHADOW_FADE_PX.
export const SHADOW_FADE_PX = 160;

export function shadowAt(lift) {
    const k = clamp(1 - Math.max(0, lift) / SHADOW_FADE_PX, 0, 1);
    return {scale: 0.5 + 0.5 * k, alpha: k};
}

// A notification makes her look up with a «!» when it would show a banner (as messageTray.js decides: not
// acknowledged, not low urgency, banners on for its app, which Do Not Disturb turns off, unless critical), outside
// the quiet times, at most once per ALERT_GAP_MS. n: {acknowledged, urgency (0 low .. 3 critical), showBanners};
// ctx: {now, last, visible, meeting, sleeping, busy}.
export const ALERT_GAP_MS = 4000;

export function notifyGate(n, ctx) {
    if (n.acknowledged || n.urgency === 0)
        return false;
    if (!n.showBanners && n.urgency !== 3)
        return false;
    if (!ctx.visible || ctx.meeting || ctx.sleeping || ctx.busy)
        return false;
    return ctx.last === null || ctx.last === undefined || ctx.now - ctx.last >= ALERT_GAP_MS;
}

// hwmon's temp*_input: millidegrees. null for no reading (empty, garbage, an unwired 0, past 150 °C).
export function parseMilliC(text) {
    const n = Number.parseInt(String(text ?? '').trim(), 10);
    if (!Number.isFinite(n) || n <= 0 || n > 150000)
        return null;
    return n / 1000;
}

// Hot when the CPU (Tctl) or the GPU (junction) is over its line for two samples in a row; cool again when both
// are under the lower lines for two samples. sample: {cpu, gpu} in °C, null when unread.
export const HEAT = Object.freeze({cpuOn: 85, cpuOff: 78, gpuOn: 80, gpuOff: 72});
export const HEAT_START = Object.freeze({hot: false, seen: 0});

export function heatStep(prev, {cpu, gpu}) {
    const c = cpu ?? -Infinity, g = gpu ?? -Infinity;
    const want = prev.hot ? !(c < HEAT.cpuOff && g < HEAT.gpuOff) : c >= HEAT.cpuOn || g >= HEAT.gpuOn;
    if (want === prev.hot)
        return {hot: prev.hot, seen: 0};
    const seen = prev.seen + 1;
    return seen >= 2 ? {hot: want, seen: 0} : {hot: prev.hot, seen};
}

// The second click of a double click: within the desktop's double-click time of the one before.
export function isDoubleTap(lastMs, nowMs, doubleMs) {
    return lastMs !== null && lastMs !== undefined && nowMs - lastMs <= doubleMs;
}

// The double-click flip, as eases on her look: a crouch, a push off, up and down while `spin` turns her a full
// circle about her centre (its own ease over her time in the air), squashed on landing, one rebound, at rest.
// pivot is set before a frame (always at scale 1, so nothing jumps); rotation_angle_z is set at once.
export function flipFrames(height = 56) {
    const f = (scale_x, scale_y, translation_y, duration, mode, extra = {}) =>
        ({scale_x, scale_y, translation_y, duration, mode, ...extra});
    const OUT = 'EASE_OUT_QUAD', IN = 'EASE_IN_QUAD', AIR = 290;
    return [
        f(1.12, 0.84, 0, 120, OUT),
        f(1, 1, 0, 60, OUT, {kick: 0.5}),
        f(1, 1, -height, AIR, OUT, {pivot: [0.5, 0.5], spin: {rotation_angle_z: -360, duration: 2 * AIR, mode: 'EASE_IN_OUT_SINE'}}),
        f(1, 1, 0, AIR, IN),
        f(1.18, 0.8, 0, 80, OUT, {pivot: [0.5, 1], rotation_angle_z: 0, land: 1}),
        f(0.96, 1.05, -Math.round(height * 0.2), 160, OUT),
        f(1, 1, 0, 140, IN),
        f(1.05, 0.95, 0, 60, OUT, {land: 0.4}),
        f(1, 1, 0, 220, OUT),
    ];
}

// Her head nodding to music on a steady beat (MPRIS gives no tempo): down quickly a quarter into each beat, back
// up by the next, with a slight groove to alternate sides. {x, y}, 0 to 1 of the nod's reach.
export const NOD_BPM = 96;

export function nodAt(ms, bpm = NOD_BPM) {
    const beats = Math.max(0, ms) * bpm / 60000;
    const k = Math.floor(beats), t = beats - k;
    const y = t < 0.25 ? Math.sin(t / 0.25 * Math.PI / 2) : Math.cos((t - 0.25) / 0.75 * Math.PI / 2);
    return {x: (k % 2 ? -0.35 : 0.35) * y, y};
}

// How much of the nod shows: it fades in over NOD_FADE_MS after the music starts (nod.since) and out after it
// stops (nod.until, null while it plays); done once faded out.
export const NOD_FADE_MS = 500;

export function nodLevel(nod, now) {
    if (!nod)
        return {level: 0, done: true};
    const up = clamp((now - nod.since) / NOD_FADE_MS, 0, 1);
    if (nod.until === null || nod.until === undefined)
        return {level: up, done: false};
    const down = clamp(1 - (now - nod.until) / NOD_FADE_MS, 0, 1);
    return {level: Math.min(up, down), done: now - nod.until >= NOD_FADE_MS};
}

function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

// ---- video poses -------------------------------------------------------------------------------

// Which frame of a look's clip shows `ms` after it started (variants.json `clip`: frames, fps, gap, once). A looping
// clip plays, then holds its first frame (where it began and ends) for `gap` ms, and again; a once clip (the wave)
// plays a single time and is done.
export function clipFrame(clip, ms) {
    // Counted in frames, not in milliseconds per frame: 1000 / 12 is not exact, and a modulo of it drifts a frame.
    const at = Math.max(0, ms) * clip.fps / 1000 + 1e-9;
    if (clip.once)
        return at >= clip.frames ? {index: 0, done: true} : {index: Math.floor(at), done: false};
    const p = at % (clip.frames + (clip.gap ?? 0) * clip.fps / 1000);
    return {index: p >= clip.frames ? 0 : Math.floor(p), done: false};
}

// Where a look's clip sits on the look, in the look's own pixels at its drawn size (`w` x `h` for a PNG of `size`).
// variants.json `box` [x, y, width, height] lets the frames reach past the look's tight edge on the left, the right
// and the top, so the cheer's pom-poms and the wave's hand are not cut; without it the clip covers the look. `reach`
// is how far it goes past any edge, which the look's paint pad must cover.
export function clipBox(clip, size, w, h) {
    const [bx, by, bw, bh] = clip.box ?? [0, 0, ...size];
    const sx = w / size[0], sy = h / size[1];
    const x = Math.round(bx * sx), y = Math.round(by * sy);
    const width = Math.round(bw * sx), height = Math.round(bh * sy);
    return {x, y, width, height, reach: Math.max(0, -x, -y, x + width - w, y + height - h)};
}
