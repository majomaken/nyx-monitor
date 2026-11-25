// The characters the widget can show. characters.json lists them in order, each with
// its name, its category (categories.json), the card's title while she is away, a folder of its own (Nyx keeps `assets/`), the manifest of its looks and poses in that
// folder, an optional table of phrases and a portrait for the settings window. Pure logic, shared by extension.js and
// prefs.js, unit tested in tests/characters.test.mjs.

export const DEFAULT_CHARACTER = 'nyx';

// Nyx's entry of characters.json, for an index that cannot be read: the widget and its settings still show her.
export const NYX_INDEX = {nyx: {name: 'Nyx', away: 'NYX · VUELVO YA', dir: 'assets', manifest: 'variants.json',
    portrait: 'nyx-portrait.png'}};

// The card's title (S14): her name in capitals (her `short` one when characters.json gives it, for a long name such as
// «Scarlet: Goddeath»), then the PC's name from the pc-name key as written, trimmed and cut to 20 characters so it fits
// the card; her name alone when it is empty.
export const PC_NAME_MAX = 20;

export function cardTitle(pack, pcName) {
    const name = (pack.short ?? pack.name).toUpperCase();
    const pc = (pcName ?? '').trim().slice(0, PC_NAME_MAX).trim();
    return pc ? `${name} · ${pc}` : name;
}

// The characters grouped for the settings window: the categories of
// categories.json in their order, each with its packs in the order of characters.json. A pack whose category is
// missing or not listed goes to the first category; a category with no packs is left out. Without categories, one
// unnamed group holds them all.
export function groupByCategory(index, categories) {
    const cats = (categories ?? []).length ? categories : [{key: '', name: ''}];
    const groups = cats.map(c => ({key: c.key, name: c.name, packs: []}));
    for (const pack of packList(index))
        (groups.find(g => g.key === pack.category) ?? groups[0]).packs.push(pack);
    return groups.filter(g => g.packs.length);
}

// The pack of `key` from the parsed characters.json, with its key: Nyx when the key is not listed (an old setting, a
// removed pack), else the first one listed; null for an empty index.
export function resolvePack(index, key) {
    const keys = Object.keys(index ?? {});
    const pick = keys.includes(key) ? key : keys.includes(DEFAULT_CHARACTER) ? DEFAULT_CHARACTER : keys[0];
    return pick ? {key: pick, ...index[pick]} : null;
}

// Every pack in the order of characters.json, for the picker in the settings window.
export function packList(index) {
    return Object.keys(index ?? {}).map(key => ({key, ...index[key]}));
}

// A file of a pack, under the extension's folder `root`.
export function assetPath(root, pack, file) {
    return `${root}/${pack.dir}/${file}`;
}

// The looks a manifest offers (its `variants`, in order).
export function looksOf(manifest) {
    return Object.keys(manifest?.variants ?? {});
}

// The manifest's `default` look when it has it, else its first one.
export function defaultLook(manifest) {
    const looks = looksOf(manifest);
    return looks.includes(manifest?.default) ? manifest.default : looks[0];
}

// `name` when the manifest draws it (a look or a beach look), else its default: the `variant` key may still hold the
// look of the character shown before.
export function lookFor(manifest, name) {
    return manifest?.variants?.[name] || manifest?.beach?.looks?.[name] ? name : defaultLook(manifest);
}

// The resting poses a look has drawn (its `rest` list, beach looks too), for the fixed pose of the settings window.
export function restPoses(manifest, look) {
    const spec = manifest?.variants?.[look] ?? manifest?.beach?.looks?.[look];
    return (spec?.rest ?? []).filter(key => manifest?.poses?.[key]);
}

// How the settings window names a resting pose: the manifest's own `labels` entry, else by what she does (the part
// after `rest-`, its outfit suffix ignored). An unknown pose keeps its key.
const POSES = {
    coffee: 'Con café', think: 'Pensando', kiss: 'Lanzando un beso', curtsy: 'Reverencia', tea: 'Con té',
    sit: 'Sentada', stretch: 'Estirándose', lookback: 'Mirando atrás', sidesit: 'Sentada de lado', lean: 'Apoyada',
};

export function poseLabel(manifest, key) {
    if (manifest?.labels?.[key])
        return manifest.labels[key];
    const [prefix, what] = key.split('-');
    return prefix === 'rest' && POSES[what] ? POSES[what] : key;
}

// How the settings window names a look: the manifest's own `labels` entry, else its form (the part before the first
// dash) and its outfit (the rest; the sweater, `chibi` or nothing, goes unnamed). An unknown form keeps the key.
const FORMS = {hips: 'Medio cuerpo', full: 'Cuerpo completo', lying: 'Acostada en la tarjeta'};
const OUTFITS = {'': '', chibi: '', eve: 'Eve', '2b': '2B', zelda: 'Zelda'};

export function lookLabel(manifest, name) {
    if (manifest?.labels?.[name])
        return manifest.labels[name];
    const [form, ...rest] = name.split('-');
    const outfit = rest.join('-');
    if (!FORMS[form] || !(outfit in OUTFITS))
        return name;
    return OUTFITS[outfit] ? `${FORMS[form]} · ${OUTFITS[outfit]}` : FORMS[form];
}
