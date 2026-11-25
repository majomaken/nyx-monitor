// The pure part of the settings window's «Actualizaciones» page: what it says
// for each answer of `nyx-monitor-update check --json`. No gi imports, unit tested in tests/updates.test.mjs.

// True when the extension's real folder is a release unpacked by bin/nyx-monitor-update, false for a git checkout
// linked by install.sh (a development install, updated with git).
export function isReleaseDir(dir) {
    return /\/nyx-monitor\/releases\/[0-9][0-9.]*\/extension\/?$/.test(dir ?? '');
}

// A download size in megabytes, the Spanish way (1,4 MB); '' when unknown.
export function formatSize(bytes) {
    if (!bytes)
        return '';
    const mb = bytes / 1e6;
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1).replace('.', ',')} MB`;
}

// The updater's own last error line, without its name, for the page (it says why: the connection, a bad signature);
// the fallback when it printed nothing.
export function lastError(err, fallback) {
    const lines = (err ?? '').split('\n').map(l => l.trim()).filter(Boolean);
    const last = lines.length ? lines[lines.length - 1].replace(/^nyx-monitor-update: /, '') : '';
    return last || fallback;
}

const ERROR = 'No pude revisar las actualizaciones. Revisa la conexión e intenta de nuevo.';

// The page's state from the updater's JSON: 'update' (with the version and its size), 'ok', 'dev' or 'error'.
export function updateView(output) {
    let info;
    try {
        info = JSON.parse(output);
    } catch (e) {
        info = null;
    }
    if (!info || typeof info.latest !== 'string' || !info.latest)
        return {state: 'error', canUpdate: false, text: ERROR, notes: ''};
    const notes = info.notes ?? '';
    if (info.dev)
        return {state: 'dev', canUpdate: false, text: 'Instalación de desarrollo: se actualiza con git', notes, latest: info.latest};
    if (info.update) {
        const size = formatSize(info.bytes);
        return {state: 'update', canUpdate: true, latest: info.latest, notes,
            text: `Hay una versión nueva: la ${info.latest}${size ? ` (${size})` : ''}`};
    }
    return {state: 'ok', canUpdate: false, latest: info.latest, notes, text: `Estás al día: versión ${info.installed || info.latest}`};
}
