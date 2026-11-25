// The extension folder is a link into a release unpacked by bin/nyx-monitor-update (or into a checkout, by install.sh).
// Read once, it keeps every later load in the release the running code came from, even after an update repoints the
// link while the session runs. Shared by extension.js and prefs.js.

import GLib from 'gi://GLib';

export function realDir(path) {
    try {
        const target = GLib.file_read_link(path);
        return GLib.path_is_absolute(target) ? target : GLib.build_filenamev([GLib.path_get_dirname(path), target]);
    } catch (e) {
        return path;
    }
}
