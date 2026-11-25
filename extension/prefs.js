// The settings window of nyx-monitor, opened by the gear on the card (or `gnome-extensions prefs nyx-monitor@majomaken`).
// It runs in a process of its own (GTK 4 and libadwaita), so a fault here never reaches the shell. Every row writes the
// extension's gsettings and the card follows at once, while the window is open:
// the character (every pack in characters.json, grouped by category, with her portrait), her look, size and timings,
// how she behaves, and the updates of the release channel.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {assetPath, groupByCategory, lookFor, lookLabel, looksOf, NYX_INDEX, packList, PC_NAME_MAX, poseLabel, resolvePack,
    restPoses} from './characters.js';
import {realDir} from './folder.js';
import {PALETTES, STYLES} from './skins.js';
import {isReleaseDir, lastError, updateView} from './update.js';

function readJson(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? JSON.parse(new TextDecoder().decode(bytes)) : null;
    } catch (e) {
        console.error(`nyx-monitor prefs: ${path}: ${e.message}`);
        return null;
    }
}

export default class NyxMonitorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        this._settings = settings;
        this._handlers = [];
        this._index = readJson(`${this.path}/characters.json`) ?? NYX_INDEX;
        window.set_default_size(640, 760);
        const pages = {
            characters: this._characterPage(), look: this._lookPage(), card: this._cardPage(),
            behaviour: this._behaviourPage(), updates: this._updatesPage(window),
        };
        for (const [name, page] of Object.entries(pages)) {
            page.set_name(name);
            window.add(page);
        }
        // tests/devkit.sh opens the window on a given page, to shoot it.
        const start = GLib.getenv('NYX_PREFS_PAGE');
        if (start && pages[start]) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                window.set_visible_page(pages[start]);
                return GLib.SOURCE_REMOVE;
            });
        }
        window.connect('close-request', () => {
            for (const id of this._handlers)
                settings.disconnect(id);
            this._handlers = [];
            return false;
        });
    }

    _on(key, callback) {
        this._handlers.push(this._settings.connect(`changed::${key}`, callback));
    }

    _pack() {
        return resolvePack(this._index, this._settings.get_string('character'));
    }

    _manifest(pack) {
        return readJson(assetPath(this.path, pack, pack.manifest)) ?? {variants: {}};
    }

    _spin(key, title, subtitle, lower, upper, step) {
        const row = Adw.SpinRow.new_with_range(lower, upper, step);
        row.set_title(title);
        row.set_subtitle(subtitle);
        this._settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _switch(key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle});
        this._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    // One group per category (categories.json), one card per character in it:
    // her portrait (her initials when it is missing) and her name. The cards of every group act as one set of radio
    // buttons; picking one sets `character`, and a look she does not have falls back to her default one.
    _characterPage() {
        const page = new Adw.PreferencesPage({
            title: 'Personajes', icon_name: 'avatar-default-symbolic',
            description: '¿Quién te acompaña? El widget cambia al instante, sin cerrar sesión.',
        });
        const categories = readJson(`${this.path}/categories.json`) ?? [];
        const cards = new Map();
        let first = null;
        for (const category of groupByCategory(this._index, categories)) {
            const group = new Adw.PreferencesGroup({title: category.name});
            page.add(group);
            const flow = new Gtk.FlowBox({
                selection_mode: Gtk.SelectionMode.NONE, homogeneous: true, min_children_per_line: 2,
                max_children_per_line: 4, column_spacing: 12, row_spacing: 12,
            });
            for (const pack of category.packs) {
                const avatar = new Adw.Avatar({size: 128, text: pack.name, show_initials: true});
                try {
                    avatar.set_custom_image(Gdk.Texture.new_from_filename(assetPath(this.path, pack, pack.portrait)));
                } catch (e) {
                    console.warn(`nyx-monitor prefs: ${pack.key} portrait: ${e.message}`);
                }
                const box = new Gtk.Box({
                    orientation: Gtk.Orientation.VERTICAL, spacing: 10,
                    margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12,
                });
                box.append(avatar);
                box.append(new Gtk.Label({label: pack.name, css_classes: ['title-4']}));
                const card = new Gtk.ToggleButton({child: box, css_classes: ['flat'], tooltip_text: pack.name});
                if (first)
                    card.set_group(first);
                else
                    first = card;
                card.connect('toggled', () => {
                    if (card.active && this._settings.get_string('character') !== pack.key)
                        this._settings.set_string('character', pack.key);
                });
                cards.set(pack.key, card);
                flow.append(card);
            }
            group.add(flow);
        }
        const sync = () => cards.get(this._pack()?.key)?.set_active(true);
        sync();
        this._on('character', sync);
        return page;
    }

    // Her look among the ones her pack draws (refreshed when the character changes), the beach mode when she has one,
    // the time-of-day schedule when it names her looks, then size, transparency and the timings.
    _lookPage() {
        const page = new Adw.PreferencesPage({title: 'Look', icon_name: 'applications-graphics-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Look'});
        page.add(group);
        const combo = new Adw.ComboRow({title: 'Look', subtitle: 'Su forma y su atuendo'});
        const beach = this._switch('beach', 'Modo playa', 'En traje de baño, con una pose nueva cada pocos minutos');
        const schedule = new Adw.ActionRow({title: 'Horario del día'});
        schedule.set_subtitle_lines(3);
        group.add(combo);
        group.add(beach);
        group.add(schedule);
        let looks = [];
        let syncing = false;
        const refresh = () => {
            const pack = this._pack();
            const manifest = this._manifest(pack);
            looks = looksOf(manifest);
            syncing = true;
            combo.set_model(Gtk.StringList.new(looks.map(name => lookLabel(manifest, name))));
            combo.set_selected(Math.max(0, looks.indexOf(lookFor(manifest, this._settings.get_string('variant')))));
            syncing = false;
            group.set_title(`Look de ${pack.name}`);
            beach.set_visible(Boolean(manifest.beach));
            const slots = this._settings.get_strv('schedule')
                .map(entry => /^\s*(\d{1,2})\s*=\s*([\w-]+)\s*$/.exec(entry))
                .filter(m => m && manifest.variants?.[m[2]]);
            schedule.set_visible(slots.length > 0);
            schedule.set_subtitle(`${slots.map(m => `${m[1]} h: ${lookLabel(manifest, m[2])}`).join(' · ')}. ` +
                'Un look elegido aquí dura hasta el siguiente cambio de horario.');
        };
        combo.connect('notify::selected', () => {
            const name = looks[combo.get_selected()];
            if (!syncing && name && name !== this._settings.get_string('variant'))
                this._settings.set_string('variant', name);
        });
        for (const key of ['character', 'variant', 'schedule'])
            this._on(key, refresh);
        refresh();
        page.add(this._poseGroup());

        const size = new Adw.PreferencesGroup({title: 'Tamaño, posición y transparencia'});
        size.add(this._spin('size', 'Tamaño', 'Porcentaje de su tamaño original', 50, 200, 10));
        size.add(this._spin('figure-offset', 'Distancia a la tarjeta',
            'Píxeles hacia la derecha (0 la deja sobre el borde de la tarjeta)', 0, 160, 4));
        size.add(this._spin('idle-opacity', 'Opacidad en reposo', 'Porcentaje, cuando la tarjeta no está en color', 10, 100, 5));
        page.add(size);
        const timing = new Adw.PreferencesGroup({title: 'Cambios con el tiempo'});
        timing.add(this._spin('rotate-minutes', 'Cambia de forma cada', 'Minutos, sin horario del día (0 la deja fija)', 0, 1440, 15));
        timing.add(this._spin('rest-minutes', 'Pose de descanso cada', 'Minutos (0 sin poses de descanso)', 0, 720, 15));
        page.add(timing);
        return page;
    }

    // Automatic (her look and resting poses follow the clock) or fixed: the look chosen above and one of its resting
    // poses stay. Her moments, naps and meetings still come and go.
    _poseGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Pose',
            description: 'Sus reacciones, siestas y reuniones aparecen un momento y luego vuelve a su pose.',
        });
        group.add(this._switch('pose-auto', 'Pose automática',
            'Cambia sola de look y de pose de descanso según la hora'));
        const combo = new Adw.ComboRow({title: 'Pose fija'});
        this._settings.bind('pose-auto', combo, 'sensitive',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);
        group.add(combo);
        let poses = [];
        let syncing = false;
        const refresh = () => {
            const manifest = this._manifest(this._pack());
            poses = ['', ...restPoses(manifest, lookFor(manifest, this._settings.get_string('variant')))];
            syncing = true;
            combo.set_model(Gtk.StringList.new(poses.map(key => key ? poseLabel(manifest, key) : 'Normal')));
            combo.set_selected(Math.max(0, poses.indexOf(this._settings.get_string('pose'))));
            syncing = false;
            combo.set_subtitle(poses.length > 1
                ? 'Con la pose automática apagada se queda en este look y esta pose'
                : 'Este look no tiene poses de descanso');
        };
        combo.connect('notify::selected', () => {
            const key = poses[combo.get_selected()];
            if (!syncing && key !== undefined && key !== this._settings.get_string('pose'))
                this._settings.set_string('pose', key);
        });
        for (const key of ['character', 'variant', 'pose'])
            this._on(key, refresh);
        refresh();
        return group;
    }

    // The card: the PC's name after hers, then how CPU, RAM and GPU show.
    _cardPage() {
        const page = new Adw.PreferencesPage({title: 'Tarjeta', icon_name: 'preferences-desktop-display-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'Nombre',
            description: `Aparece junto al nombre del personaje, como en NYX · SUPER PC. Hasta ${PC_NAME_MAX} caracteres.`,
        });
        const name = new Adw.EntryRow({title: 'Nombre del PC', show_apply_button: true});
        if ('max_length' in name)
            name.max_length = PC_NAME_MAX;
        name.set_text(this._settings.get_string('pc-name'));
        const apply = () => {
            if (name.get_text() !== this._settings.get_string('pc-name'))
                this._settings.set_string('pc-name', name.get_text());
        };
        name.connect('apply', apply);
        name.connect('entry-activated', apply);
        this._on('pc-name', () => {
            if (name.get_text() !== this._settings.get_string('pc-name'))
                name.set_text(this._settings.get_string('pc-name'));
        });
        group.add(name);
        page.add(group);
        page.add(this._statsGroup());
        return page;
    }

    // A style (bars, blocks, rings, large numbers) and a palette, picked from cards that show its colours: the three
    // stats calm, then busy and hot.
    _statsGroup() {
        const group = new Adw.PreferencesGroup({title: 'CPU, RAM y GPU', description: 'Cómo se ven y en qué colores.'});
        const style = new Adw.ComboRow({title: 'Estilo', model: Gtk.StringList.new(STYLES.map(s => s.label))});
        const syncStyle = () => style.set_selected(
            Math.max(0, STYLES.findIndex(s => s.key === this._settings.get_string('stats-style'))));
        syncStyle();
        style.connect('notify::selected', () => {
            const key = STYLES[style.get_selected()]?.key;
            if (key && key !== this._settings.get_string('stats-style'))
                this._settings.set_string('stats-style', key);
        });
        this._on('stats-style', syncStyle);
        group.add(style);

        const flow = new Gtk.FlowBox({
            selection_mode: Gtk.SelectionMode.NONE, homogeneous: true, min_children_per_line: 3,
            max_children_per_line: 5, column_spacing: 8, row_spacing: 8, margin_top: 12,
        });
        const cards = new Map();
        let first = null;
        for (const [key, p] of Object.entries(PALETTES)) {
            const dots = [...['cpu', 'ram', 'gpu'].map(id => p.calm[id]), p.busy, p.hot]
                .map(c => `<span foreground="${c}">\u25CF</span>`).join('');
            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL, spacing: 6,
                margin_top: 10, margin_bottom: 10, margin_start: 10, margin_end: 10,
            });
            box.append(new Gtk.Label({use_markup: true, label: `<span size="x-large">${dots}</span>`}));
            box.append(new Gtk.Label({label: p.label}));
            const card = new Gtk.ToggleButton({child: box, css_classes: ['flat'], tooltip_text: p.label});
            if (first)
                card.set_group(first);
            else
                first = card;
            card.connect('toggled', () => {
                if (card.active && this._settings.get_string('stats-colors') !== key)
                    this._settings.set_string('stats-colors', key);
            });
            cards.set(key, card);
            flow.append(card);
        }
        const sync = () => (cards.get(this._settings.get_string('stats-colors')) ?? cards.get('lavender')).set_active(true);
        sync();
        this._on('stats-colors', sync);
        group.add(flow);
        return group;
    }

    _behaviourPage() {
        const page = new Adw.PreferencesPage({title: 'Comportamiento', icon_name: 'preferences-system-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Lo que hace'});
        group.add(this._switch('phrases', 'Frases', 'Habla en una burbuja de vez en cuando'));
        group.add(this._spin('animation-minutes', 'Un momento cada', 'Minutos entre poses, gestos y frases (0 los apaga)', 0, 120, 1));
        group.add(this._spin('sleep-minutes', 'Se duerme tras', 'Minutos sin teclado ni mouse (0 la mantiene despierta)', 0, 60, 1));
        group.add(this._switch('demo', 'Recorrido de demostración', 'Muestra cada look y cada animación, un paso cada 10 s'));
        page.add(group);
        return page;
    }

    // The release channel: the installed version, then a check and an update
    // through bin/nyx-monitor-update, which sits next to the extension in its release. A development install (a link
    // into a git checkout, install.sh) says so and offers no buttons.
    _updatesPage(window) {
        const page = new Adw.PreferencesPage({title: 'Actualizaciones', icon_name: 'software-update-available-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Nyx Monitor'});
        page.add(group);
        // Every text here may come from the channel or the updater: shown as it is, never parsed as Pango markup
        // (Adw rows and toasts parse it by default, so a note could hide a link).
        group.add(new Adw.ActionRow({
            title: 'Versión instalada', subtitle: this.metadata['version-name'] ?? 'desconocida', use_markup: false,
        }));
        const status = new Adw.ActionRow({title: 'Estado', use_markup: false});
        status.set_subtitle_lines(3);
        const notes = new Adw.ActionRow({title: 'Novedades', visible: false, use_markup: false});
        notes.set_subtitle_lines(8);
        group.add(status);
        group.add(notes);
        const dir = realDir(this.path);
        if (!isReleaseDir(dir)) {
            status.set_subtitle('Instalación de desarrollo: se actualiza con git');
            return page;
        }
        const updater = GLib.build_filenamev([GLib.path_get_dirname(dir), 'bin', 'nyx-monitor-update']);
        const checkBtn = new Gtk.Button({label: 'Buscar actualizaciones', valign: Gtk.Align.CENTER});
        const updateBtn = new Gtk.Button({
            label: 'Actualizar', valign: Gtk.Align.CENTER, css_classes: ['suggested-action'], visible: false,
        });
        status.add_suffix(updateBtn);
        status.add_suffix(checkBtn);
        let latest = '';
        const run = (args, done) => {
            try {
                const proc = Gio.Subprocess.new(['bash', updater, ...args],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                proc.communicate_utf8_async(null, null, (p, res) => {
                    let out = '', err = '', ok = false;
                    try {
                        [, out, err] = p.communicate_utf8_finish(res);
                        ok = p.get_successful();
                    } catch (e) {
                        err = e.message;
                    }
                    done(ok, out ?? '', err ?? '');
                });
            } catch (e) {
                done(false, '', e.message);
            }
        };
        const check = () => {
            checkBtn.set_sensitive(false);
            updateBtn.set_visible(false);
            status.set_subtitle('Buscando una versión nueva…');
            run(['check', '--json'], (ok, out, err) => {
                const view = updateView(out);
                latest = view.latest ?? '';
                status.set_subtitle(view.state === 'error' ? lastError(err, view.text) : view.text);
                notes.set_subtitle(view.notes);
                notes.set_visible(Boolean(view.notes) && view.state === 'update');
                updateBtn.set_visible(view.canUpdate);
                checkBtn.set_sensitive(true);
            });
        };
        updateBtn.connect('clicked', () => {
            checkBtn.set_sensitive(false);
            updateBtn.set_sensitive(false);
            status.set_subtitle(`Descargando e instalando la ${latest}… puede tardar unos minutos.`);
            run(['install'], (ok, out, err) => {
                checkBtn.set_sensitive(true);
                updateBtn.set_sensitive(true);
                if (ok) {
                    updateBtn.set_visible(false);
                    status.set_subtitle(`Cierra sesión y vuelve a entrar para ver la versión ${latest}.`);
                    window.add_toast?.(new Adw.Toast({title: `Versión ${latest} instalada`, use_markup: false}));
                } else {
                    status.set_subtitle(lastError(err, 'No se pudo actualizar.'));
                }
            });
        });
        checkBtn.connect('clicked', check);
        check();
        return page;
    }
}
