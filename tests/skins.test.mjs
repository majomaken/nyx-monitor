// Unit tests for extension/skins.js: the ways the card shows CPU, RAM and GPU and their colour sets
// Run with tests/run.sh (Node in Docker).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {blocksLit, hexRgb, iconColor, PALETTES, paletteFor, ringSweep, statColor, STYLES, styleFor} from '../extension/skins.js';

const here = dirname(fileURLToPath(import.meta.url));
const STATS = ['cpu', 'ram', 'gpu'];
const HEX = /^#[0-9a-f]{6}$/;
const CARD = [14, 14, 24]; // the card's glass in full colour (stylesheet.css .nyx-full), its darkest

const luminance = hex => {
    const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = hexRgb(hex).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cardLuminance = luminance(`#${CARD.map(c => c.toString(16).padStart(2, '0')).join('')}`);
const contrast = hex => (luminance(hex) + 0.05) / (cardLuminance + 0.05);
const distance = (a, b) => Math.hypot(...hexRgb(a).map((c, i) => (c - hexRgb(b)[i]) * 255));

test('four styles, bars first (the card as it was)', () => {
    assert.deepEqual(STYLES.map(s => s.key), ['bars', 'blocks', 'rings', 'numbers']);
    assert.deepEqual(STYLES.map(s => s.label), ['Barras', 'Bloques', 'Anillos', 'Números grandes']);
    assert.equal(styleFor('rings'), 'rings');
    assert.equal(styleFor('sparkles'), 'bars', 'an unknown style shows the bars');
    assert.equal(styleFor(undefined), 'bars');
});

test('five palettes, lavender first; every one complete, valid and readable on the card', () => {
    assert.deepEqual(Object.keys(PALETTES), ['lavender', 'neon', 'ocean', 'sunset', 'gold']);
    for (const [key, p] of Object.entries(PALETTES)) {
        assert.ok(p.label && !p.label.includes('—'), `${key} has a Spanish name`);
        const colours = [...STATS.map(id => p.calm[id]), ...STATS.map(id => iconColor(p, id)), p.busy, p.hot];
        for (const c of colours) {
            assert.match(c, HEX, `${key}: ${c}`);
            assert.ok(contrast(c) >= 3, `${key}: ${c} reads on the card (${contrast(c).toFixed(2)}:1)`);
        }
        for (const id of STATS) {
            assert.ok(distance(p.calm[id], p.busy) >= 60, `${key}: ${id} calm and busy tell apart`);
            assert.ok(distance(p.calm[id], p.hot) >= 60, `${key}: ${id} calm and hot tell apart`);
        }
        assert.ok(distance(p.busy, p.hot) >= 60, `${key}: busy and hot tell apart`);
    }
    assert.equal(paletteFor('gold'), PALETTES.gold);
    assert.equal(paletteFor('plaid'), PALETTES.lavender, 'an unknown palette shows lavender');
});

test('lavender keeps the colours the card had before the palettes', () => {
    const p = PALETTES.lavender;
    assert.deepEqual(STATS.map(id => p.calm[id]), ['#b7b4ff', '#b7b4ff', '#b7b4ff']);
    assert.deepEqual(STATS.map(id => iconColor(p, id)), ['#aab4ff', '#c9a8ff', '#8fe3d2']);
    assert.equal(p.busy, '#ffd27a');
    assert.equal(p.hot, '#ff7a8a');
});

test('statColor: the stat\'s own colour while calm, the shared busy and hot colours past 60 % and 85 %', () => {
    const p = PALETTES.neon;
    assert.equal(statColor(p, 'ram', 0.2), p.calm.ram);
    assert.equal(statColor(p, 'gpu', 0.59), p.calm.gpu);
    assert.equal(statColor(p, 'cpu', 0.6), p.busy);
    assert.equal(statColor(p, 'cpu', 0.85), p.hot);
    assert.equal(statColor(p, 'cpu', 3), p.hot);
});

test('blocksLit: how many of n blocks light up, rounded, never past the ends', () => {
    assert.equal(blocksLit(0, 10), 0);
    assert.equal(blocksLit(0.04, 10), 0);
    assert.equal(blocksLit(0.05, 10), 1);
    assert.equal(blocksLit(0.5, 10), 5);
    assert.equal(blocksLit(1, 10), 10);
    assert.equal(blocksLit(1.4, 10), 10);
    assert.equal(blocksLit(-1, 10), 0);
    assert.equal(blocksLit(NaN, 5), 0);
    assert.equal(blocksLit(0.5, 5), 3);
});

test('ringSweep: the arc of a ring gauge in radians, a full turn at 100 %', () => {
    assert.equal(ringSweep(0), 0);
    assert.equal(ringSweep(0.25), Math.PI / 2);
    assert.equal(ringSweep(1), 2 * Math.PI);
    assert.equal(ringSweep(2), 2 * Math.PI);
    assert.equal(ringSweep(-0.5), 0);
    assert.equal(ringSweep(NaN), 0);
});

test('hexRgb gives cairo its 0..1 channels', () => {
    assert.deepEqual(hexRgb('#ff0080'), [1, 0, 128 / 255]);
});

test('the stats keys: bars and lavender by default, only those choices, read through the fallbacks (S15)', () => {
    const js = readFileSync(join(here, '..', 'extension', 'extension.js'), 'utf8');
    const schema = readFileSync(join(here, '..', 'extension', 'schemas',
        'org.gnome.shell.extensions.nyx-monitor.gschema.xml'), 'utf8');
    const key = name => new RegExp(`<key name="${name}" type="s">([\\s\\S]*?)</key>`).exec(schema)?.[1] ?? '';
    const choices = block => [...block.matchAll(/<choice value='([^']+)'\/>/g)].map(m => m[1]);
    assert.deepEqual(choices(key('stats-style')), STYLES.map(s => s.key));
    assert.match(key('stats-style'), /<default>'bars'<\/default>/);
    assert.deepEqual(choices(key('stats-colors')), Object.keys(PALETTES));
    assert.match(key('stats-colors'), /<default>'lavender'<\/default>/);
    assert.ok(js.includes("'stats-style': ['string', 'bars']") && js.includes("'stats-colors': ['string', 'lavender']"));
    assert.ok(!/get_string\('stats-(style|colors)'\)/.test(js), 'the stats keys are only read through _newKey');
});
