// Unit tests for extension/update.js, the pure part of the settings window's «Actualizaciones» page
// Run with tests/run.sh (Node in Docker).
import {test} from 'node:test';
import assert from 'node:assert/strict';

import {formatSize, isReleaseDir, lastError, updateView} from '../extension/update.js';

test('isReleaseDir: a folder inside a release of the channel, not a git checkout', () => {
    assert.equal(isReleaseDir('/home/a/.local/share/nyx-monitor/releases/1.1/extension'), true);
    assert.equal(isReleaseDir('/home/a/.local/share/nyx-monitor/releases/1.10/extension/'), true);
    assert.equal(isReleaseDir('/home/ana/src/nyx-monitor/extension'), false);
    assert.equal(isReleaseDir('/home/a/.local/share/gnome-shell/extensions/nyx-monitor@majomaken'), false);
    assert.equal(isReleaseDir(''), false);
});

test('formatSize: megabytes, rounded, for the download', () => {
    assert.equal(formatSize(97_000_000), '97 MB');
    assert.equal(formatSize(1_400_000), '1,4 MB');
    assert.equal(formatSize(0), '');
    assert.equal(formatSize(undefined), '');
});

test('updateView: what the page says for each answer of nyx-monitor-update check --json', () => {
    const up = updateView('{"installed":"1.1","latest":"1.2","update":true,"dev":false,"notes":"Seis personajes","bytes":97000000}');
    assert.equal(up.state, 'update');
    assert.equal(up.canUpdate, true);
    assert.equal(up.latest, '1.2');
    assert.equal(up.text, 'Hay una versión nueva: la 1.2 (97 MB)');
    assert.equal(up.notes, 'Seis personajes');

    const ok = updateView('{"installed":"1.2","latest":"1.2","update":false,"dev":false,"notes":"","bytes":1}');
    assert.equal(ok.state, 'ok');
    assert.equal(ok.canUpdate, false);
    assert.equal(ok.text, 'Estás al día: versión 1.2');

    const dev = updateView('{"installed":"1.1","latest":"1.2","update":false,"dev":true,"notes":"","bytes":1}');
    assert.equal(dev.state, 'dev');
    assert.equal(dev.canUpdate, false);
    assert.equal(dev.text, 'Instalación de desarrollo: se actualiza con git');

    for (const bad of ['', 'not json', '{"update":true}', null]) {
        const err = updateView(bad);
        assert.equal(err.state, 'error', `${bad} is an error`);
        assert.equal(err.canUpdate, false);
        assert.equal(err.text, 'No pude revisar las actualizaciones. Revisa la conexión e intenta de nuevo.');
    }
});

test('lastError: the updater\'s own last line for the page, without its name, or the fallback', () => {
    const err = 'curl: (22) The requested URL returned error: 404\n' +
        'nyx-monitor-update: la firma de latest.json no es válida; por seguridad no sigo.\n';
    assert.equal(lastError(err, 'F'), 'la firma de latest.json no es válida; por seguridad no sigo.');
    assert.equal(lastError('', 'F'), 'F');
    assert.equal(lastError(undefined, 'F'), 'F');
    assert.equal(lastError('\n  \n', 'F'), 'F');
});
