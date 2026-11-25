// How the card shows CPU, RAM and GPU: a style (the `stats-style` key) and a colour
// set (the `stats-colors` key). Pure logic, shared by extension.js (which draws them) and prefs.js (which offers them),
// unit tested in tests/skins.test.mjs.

import {level} from './stats.js';

// In the order the settings window lists them; bars is the card as it always was.
export const STYLES = [
    {key: 'bars', label: 'Barras'},
    {key: 'blocks', label: 'Bloques'},
    {key: 'rings', label: 'Anillos'},
    {key: 'numbers', label: 'Números grandes'},
];

// Each palette: a calm colour per stat (and an icon colour, the calm one unless it says otherwise), then the busy
// (60 %) and hot (85 %) colours all three share. Lavender is the card's colours before the palettes.
export const PALETTES = {
    lavender: {
        label: 'Lavanda',
        icon: {cpu: '#aab4ff', ram: '#c9a8ff', gpu: '#8fe3d2'},
        calm: {cpu: '#b7b4ff', ram: '#b7b4ff', gpu: '#b7b4ff'},
        busy: '#ffd27a', hot: '#ff7a8a',
    },
    neon: {label: 'Neón', calm: {cpu: '#22e6ff', ram: '#ff4fd8', gpu: '#7dff5a'}, busy: '#ffe14d', hot: '#ff3860'},
    ocean: {label: 'Océano', calm: {cpu: '#6ec8ff', ram: '#7fe7d0', gpu: '#9fb8ff'}, busy: '#ffd27a', hot: '#ff7a8a'},
    sunset: {label: 'Atardecer', calm: {cpu: '#ffb38a', ram: '#ff8fb1', gpu: '#ffd39a'}, busy: '#ff9f43', hot: '#ff4d5e'},
    gold: {label: 'Oro', calm: {cpu: '#ffd56b', ram: '#f2c14e', gpu: '#ffe7a3'}, busy: '#ff7f2a', hot: '#ff3d5a'},
};

// The style of `key`, bars for anything else.
export function styleFor(key) {
    return STYLES.some(s => s.key === key) ? key : 'bars';
}

// The palette of `key`, lavender for anything else.
export function paletteFor(key) {
    return PALETTES[key] ?? PALETTES.lavender;
}

export function iconColor(palette, id) {
    return palette.icon?.[id] ?? palette.calm[id];
}

// The colour of a stat at `fraction` of its load: its own while calm, the shared busy or hot one past it.
export function statColor(palette, id, fraction) {
    const lvl = level(fraction);
    return lvl === 'calm' ? palette.calm[id] : palette[lvl];
}

const unit = fraction => (Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0);

// How many of `n` blocks light up at `fraction`.
export function blocksLit(fraction, n) {
    return Math.round(unit(fraction) * n);
}

// The arc of a ring gauge at `fraction`, in radians.
export function ringSweep(fraction) {
    return unit(fraction) * 2 * Math.PI;
}

// '#rrggbb' as cairo's 0..1 channels.
export function hexRgb(hex) {
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
}
