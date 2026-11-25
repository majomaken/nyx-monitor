// Unit tests for extension/characters.js and every character pack listed in extension/characters.json
// Run with tests/run.sh (Node in Docker).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {PHRASES} from '../extension/stats.js';
import {assetPath, cardTitle, DEFAULT_CHARACTER, defaultLook, groupByCategory, lookFor, lookLabel, looksOf, packList, poseLabel,
    resolvePack, restPoses} from '../extension/characters.js';

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, '..', 'extension');
const index = JSON.parse(readFileSync(join(extension, 'characters.json'), 'utf8'));
const categories = JSON.parse(readFileSync(join(extension, 'categories.json'), 'utf8'));

const INDEX = {
    nyx: {name: 'Nyx', away: 'NYX · VUELVO YA', dir: 'assets', manifest: 'variants.json', portrait: 'nyx-portrait.png'},
    tia: {name: 'Tía', away: 'TÍA', dir: 'characters/tia', manifest: 'variants.json', portrait: 'p.png'},
};

test('resolvePack: a listed character, else Nyx, else the first one listed', () => {
    assert.equal(resolvePack(INDEX, 'tia').key, 'tia');
    assert.equal(resolvePack(INDEX, 'tia').dir, 'characters/tia');
    assert.equal(resolvePack(INDEX, 'nobody').key, DEFAULT_CHARACTER);
    assert.equal(resolvePack(INDEX, undefined).key, 'nyx');
    assert.equal(resolvePack({tia: INDEX.tia}, 'nyx').key, 'tia');
    assert.equal(resolvePack({}, 'nyx'), null);
});

test('packList keeps the order of characters.json, for the picker in the settings window', () => {
    assert.deepEqual(packList(INDEX).map(p => [p.key, p.name]), [['nyx', 'Nyx'], ['tia', 'Tía']]);
});

test('assetPath puts a file in its character folder', () => {
    assert.equal(assetPath('/ext', resolvePack(INDEX, 'nyx'), 'nyx-hips.png'), '/ext/assets/nyx-hips.png');
    assert.equal(assetPath('/ext', resolvePack(INDEX, 'tia'), 'a.png'), '/ext/characters/tia/a.png');
});

test('looks: the manifest lists them; its default, else the first; an unknown look falls back to it', () => {
    const manifest = {default: 'full', variants: {hips: {}, full: {}}, beach: {looks: {beach: {}}}};
    assert.deepEqual(looksOf(manifest), ['hips', 'full']);
    assert.equal(defaultLook(manifest), 'full');
    assert.equal(defaultLook({variants: {hips: {}, full: {}}}), 'hips');
    assert.equal(defaultLook({default: 'gone', variants: {hips: {}}}), 'hips');
    assert.equal(lookFor(manifest, 'hips'), 'hips');
    assert.equal(lookFor(manifest, 'beach'), 'beach', 'a beach look is a look too');
    assert.equal(lookFor(manifest, 'hips-eve'), 'full', "another character's look is not hers");
    assert.equal(lookFor(manifest, ''), 'full');
});

test('characters.json lists Nyx first, in her own assets folder, and every pack names what it needs', () => {
    assert.equal(Object.keys(index)[0], 'nyx');
    assert.equal(index.nyx.dir, 'assets');
    assert.equal(cardTitle(resolvePack(index, 'nyx'), 'SUPER PC'), 'NYX · SUPER PC', 'the card reads as it always did');
    for (const [key, p] of Object.entries(index)) {
        assert.match(key, /^[a-z][a-z0-9-]*$/, `${key} is a plain key`);
        for (const field of ['name', 'away', 'dir', 'manifest', 'portrait'])
            assert.ok(typeof p[field] === 'string' && p[field], `${key} has ${field}`);
        assert.ok(!('title' in p), `${key}: the title comes from her name and the pc-name key`);
        assert.ok(!p.dir.split('/').includes('..') && !p.dir.startsWith('/'), `${key} stays inside the extension`);
    }
});

test('groupByCategory: categories in their order, each with its packs in the order of characters.json (S2)', () => {
    const cats = [{key: 'nyx', name: 'Nyx'}, {key: 'nikke', name: 'NIKKE'}, {key: 'empty', name: 'Vacía'}];
    const idx = {
        nyx: {...INDEX.nyx, category: 'nyx'},
        rapi: {...INDEX.tia, name: 'Rapi', category: 'nikke'},
        tia: {...INDEX.tia, category: 'nyx'},
        stray: {...INDEX.tia, name: 'Stray', category: 'gone'},
        bare: {...INDEX.tia, name: 'Bare'},
    };
    const groups = groupByCategory(idx, cats);
    assert.deepEqual(groups.map(g => [g.key, g.name, g.packs.map(p => p.key)]),
        [['nyx', 'Nyx', ['nyx', 'tia', 'stray', 'bare']], ['nikke', 'NIKKE', ['rapi']]],
        'an unknown or missing category goes to the first one; an empty category is left out');
    assert.equal(groups[1].packs[0].name, 'Rapi', 'each pack keeps its fields');
    assert.deepEqual(groupByCategory(idx, []).map(g => [g.key, g.packs.length]), [['', 5]], 'no categories: one unnamed group');
    assert.deepEqual(groupByCategory({}, cats), []);
});

test('categories.json lists Nyx first, then NIKKE, with plain unique keys, and every pack names one of them (S2)', () => {
    assert.deepEqual(categories.slice(0, 2).map(c => [c.key, c.name]), [['nyx', 'Nyx'], ['nikke', 'NIKKE']]);
    const keys = categories.map(c => c.key);
    assert.equal(new Set(keys).size, keys.length, 'unique keys');
    for (const c of categories) {
        assert.match(c.key, /^[a-z][a-z0-9-]*$/, `${c.key} is a plain key`);
        assert.ok(typeof c.name === 'string' && c.name.trim(), `${c.key} has a name`);
    }
    for (const [key, p] of Object.entries(index))
        assert.ok(keys.includes(p.category), `${key} names a listed category (${p.category})`);
    assert.equal(index.nyx.category, 'nyx');
    assert.equal(index.okane.category, 'nyx', 'Okane is a house character');
});

test('lookLabel names a look for the settings window: its form, then its outfit; the manifest may name it itself', () => {
    assert.equal(lookLabel({}, 'hips'), 'Medio cuerpo');
    assert.equal(lookLabel({}, 'hips-eve'), 'Medio cuerpo · Eve');
    assert.equal(lookLabel({}, 'hips-2b'), 'Medio cuerpo · 2B');
    assert.equal(lookLabel({}, 'full-chibi'), 'Cuerpo completo');
    assert.equal(lookLabel({}, 'full-zelda'), 'Cuerpo completo · Zelda');
    assert.equal(lookLabel({}, 'lying-chibi'), 'Acostada en la tarjeta');
    assert.equal(lookLabel({}, 'full'), 'Cuerpo completo');
    assert.equal(lookLabel({}, 'odd-one'), 'odd-one', 'an unknown form keeps its key');
    assert.equal(lookLabel({labels: {hips: 'Con abrigo'}}, 'hips'), 'Con abrigo');
});

test('cardTitle: her name in capitals, then the PC\'s name as written, trimmed to 20 characters (S14)', () => {
    assert.equal(cardTitle(INDEX.nyx, 'SUPER PC'), 'NYX · SUPER PC');
    assert.equal(cardTitle(resolvePack(INDEX, 'tia'), '  Majo PC '), 'TÍA · Majo PC');
    assert.equal(cardTitle(INDEX.nyx, ''), 'NYX', 'no PC name: her name alone');
    assert.equal(cardTitle(INDEX.nyx, '   '), 'NYX');
    assert.equal(cardTitle(INDEX.nyx, undefined), 'NYX');
    assert.equal(cardTitle(INDEX.nyx, 'ESTACIÓN DE TRABAJO PRINCIPAL'), 'NYX · ESTACIÓN DE TRABAJO', 'cut at 20, then trimmed');
    assert.equal(cardTitle({name: 'Scarlet: Goddeath', short: 'Scarlet'}, 'SUPER PC'), 'SCARLET · SUPER PC',
        'a long name has a short one for the card');
});

test('every name on the card fits: her short name, else her name, at most 10 characters (S3)', () => {
    for (const [key, p] of Object.entries(index))
        assert.ok((p.short ?? p.name).length <= 10, `${key}: «${p.short ?? p.name}» fits the card`);
});

test('restPoses lists the resting poses a look has drawn, for the fixed pose of the settings window (S12)', () => {
    const manifest = {
        variants: {hips: {rest: ['rest-sit', 'rest-gone', 'rest-stretch']}, full: {}},
        beach: {looks: {beach: {rest: ['beach-drink']}}},
        poses: {'rest-sit': {}, 'rest-stretch': {}, 'beach-drink': {}},
    };
    assert.deepEqual(restPoses(manifest, 'hips'), ['rest-sit', 'rest-stretch'], 'a pose the manifest lacks is left out');
    assert.deepEqual(restPoses(manifest, 'full'), [], 'a look without resting poses');
    assert.deepEqual(restPoses(manifest, 'beach'), ['beach-drink']);
    assert.deepEqual(restPoses(manifest, 'nobody'), []);
    assert.deepEqual(restPoses(null, 'hips'), []);
});

test('poseLabel names a resting pose in Spanish, whatever the outfit; the manifest may name it itself (S12)', () => {
    assert.equal(poseLabel({}, 'rest-coffee'), 'Con café');
    assert.equal(poseLabel({}, 'rest-kiss-2b'), 'Lanzando un beso');
    assert.equal(poseLabel({}, 'rest-kiss-eve'), 'Lanzando un beso');
    assert.equal(poseLabel({}, 'rest-curtsy-2b'), 'Reverencia');
    assert.equal(poseLabel({}, 'rest-sit'), 'Sentada');
    assert.equal(poseLabel({}, 'rest-stretch'), 'Estirándose');
    assert.equal(poseLabel({}, 'rest-lookback'), 'Mirando atrás');
    assert.equal(poseLabel({}, 'rest-odd'), 'rest-odd', 'an unknown pose keeps its key');
    assert.equal(poseLabel({labels: {'rest-sit': 'En el borde'}}, 'rest-sit'), 'En el borde');
});

test('every resting pose of every pack has a Spanish name in the settings window (S12)', () => {
    for (const pack of packList(index)) {
        const manifest = JSON.parse(readFileSync(join(extension, pack.dir, pack.manifest), 'utf8'));
        for (const look of looksOf(manifest))
            for (const key of restPoses(manifest, look))
                assert.notEqual(poseLabel(manifest, key), key, `${pack.key}: ${key} has a name`);
    }
});

// ---- the contract every pack keeps (S3, S7, S8) --------------------------------------------------

const STRIP_BUDGET = 80 * 1024 * 1024; // per pack
const STRIP_FILE_MAX = 5 * 1000 * 1000; // the repo's limit per file
const KINDS = [...Object.keys(PHRASES), 'money'];

const pngSize = path => {
    const png = readFileSync(path);
    assert.equal(png.toString('latin1', 1, 4), 'PNG', `${path} is a PNG`);
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

for (const pack of packList(index)) {
    const dir = join(extension, pack.dir);
    const file = name => join(dir, name);
    test(`pack ${pack.key}: every look and pose it names is on disk at its size, with its clip, portrait and phrases`, () => {
        const manifest = JSON.parse(readFileSync(file(pack.manifest), 'utf8'));
        const {variants, poses = {}} = manifest;
        assert.ok(looksOf(manifest).length, `${pack.key} has looks`);
        if (manifest.default !== undefined)
            assert.ok(variants[manifest.default], `${pack.key} default look ${manifest.default} exists`);
        for (const form of manifest.forms ?? [])
            assert.ok(variants[form], `${pack.key} form ${form} is a look`);
        const named = new Set([pack.manifest, pack.portrait, pack.phrases, 'sway.json', 'ground.json']);
        let strips = 0;
        const looks = [...Object.entries(variants), ...Object.entries(manifest.beach?.looks ?? {}), ...Object.entries(poses)];
        for (const [name, v] of looks) {
            for (const key of [...Object.values(v.poses ?? {}), ...(v.rest ?? []), ...(v.shelved ?? [])])
                assert.ok(poses[key], `${pack.key} ${name} -> ${key} exists`);
            assert.ok(['beside', 'top', 'perch'].includes(v.layout), `${pack.key} ${name} layout`);
            assert.equal(v.head?.length, 4, `${pack.key} ${name} has a head box`);
            for (const f of [v.body, v.blink, v.hand, v.feet, v.alt, ...Object.values(v.faces ?? {})].filter(Boolean)) {
                assert.deepEqual(pngSize(file(f)), v.size, `${pack.key} ${f} is ${v.size}`);
                named.add(f);
            }
            if (v.clip) {
                const {strip, frames, fps} = v.clip;
                const [, , bw, bh] = v.clip.box ?? [0, 0, ...v.size];
                assert.equal(frames, 36, `${pack.key} ${name}: three seconds of frames`);
                assert.equal(fps, 12, `${pack.key} ${name}: 12 fps`);
                assert.deepEqual(pngSize(file(strip)), [bw, bh * frames], `${pack.key} ${strip} is ${frames} frames of ${bw}x${bh}`);
                const bytes = statSync(file(strip)).size;
                assert.ok(bytes < STRIP_FILE_MAX, `${pack.key} ${strip} is under 5 MB`);
                if (!named.has(strip))
                    strips += bytes;
                named.add(strip);
            }
        }
        assert.ok(strips < STRIP_BUDGET, `${pack.key} strips weigh ${(strips / 1048576).toFixed(1)} MiB, under 80`);
        const [pw, ph] = pngSize(file(pack.portrait));
        assert.ok(pw === ph && pw >= 128, `${pack.key} portrait is square, ${pw}x${ph}`);
        if (pack.phrases) {
            const table = JSON.parse(readFileSync(file(pack.phrases), 'utf8'));
            for (const [kind, lines] of Object.entries(table)) {
                assert.ok(KINDS.includes(kind), `${pack.key} phrase kind ${kind} is one the extension says`);
                assert.ok(Array.isArray(lines) && lines.length && lines.every(l => typeof l === 'string' && l.trim()),
                    `${pack.key} ${kind} lines`);
                assert.ok(lines.every(l => !l.includes('\u2014')), `${pack.key} ${kind}: no em dash`);
            }
        }
        if (pack.dir !== 'assets') // Nyx keeps shelved stills and full-body sources on disk; a new pack holds no leftovers
            for (const f of readdirSync(dir))
                assert.ok(named.has(f), `${pack.key}: ${f} is used by the pack`);
    });
}
