# Contributing to Nyx Monitor

Thanks for helping. Anyone can propose a change: fork the repository, work on a branch, and open a pull request to
`main`. The maintainer reviews and merges; releases are made only by the maintainer, signed with the release key, so
you never need a key or access to the server.

## Set up

You need GNOME Shell 50 on Wayland to run it, plus Docker for the unit tests.

```bash
git clone https://github.com/<you>/nyx-monitor && cd nyx-monitor
bash install.sh            # links extension/ into GNOME's extensions folder and enables it
```

GNOME loads extension code only at login, so log out and back in after each change you want to see, or use the nested
shell, which needs no log out: `sudo dnf install mutter-devkit` (Fedora) once, then `bash tests/devkit.sh` (see the
README's Tests section). If you had installed a release with `get.sh`, run `bash install.sh` anyway: a development
install is a link into your checkout, and the updater leaves it alone.

## Tests

Run these before opening a pull request; CI runs the first four on every pull request.

```bash
bash tests/run.sh            # unit tests, Node in Docker
bash tests/install.test.sh   # install.sh, with stubs
bash tests/update.test.sh    # the updater, get.sh and release.sh (needs curl, gjs, jq, ssh-keygen)
bash tests/site.test.sh      # the release site's nginx config, in Docker
bash tests/headless.sh       # every state in a headless GNOME Shell, with screenshots in local/ (optional, host only)
```

A change in behaviour comes with a test that fails without it. Pure logic lives in `extension/stats.js`,
`characters.js`, `skins.js` and `update.js` (no `gi` imports), so it can be unit tested in Node; the shell scripts are
tested with stubs in a temporary folder, never against the real session.

## Conventions

- Code, comments and docs in English. Everything the user sees (the card, the phrases, the settings window, the
  updater's messages) in Spanish, neutral and using tú.
- Keep a pull request to one topic, with a clear title and a description of what changes for the user.
- Do not add dependencies the user would have to install: the extension uses only GNOME's own libraries, and the
  updater only bash, curl, tar, sha256sum, gjs and ssh-keygen.
- Never commit secrets, local paths or generated files (`release/site/`, `local/`, `gschemas.compiled`).

## Characters

A new character is a folder under `extension/characters/<key>/` and an entry in `extension/characters.json`; the
README's Characters section has the format, and `tests/characters.test.mjs` checks every pack. A new category is a line
in `extension/categories.json`.

Only add art you made yourself or may share, and say where it comes from in the pull request and in `NOTICE`. The art
is not covered by the GPL; each character keeps its own terms there.

## Security

Report vulnerabilities privately, as `SECURITY.md` explains, not in a public issue.

## License

By contributing you agree that your code is released under the GNU General Public License, version 2 or (at your
option) any later version, like the rest of the project.
