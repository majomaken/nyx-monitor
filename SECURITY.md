# Security

## Reporting a vulnerability

Please report it privately through GitHub: the repository's **Security** tab, **Report a vulnerability**. Do not open
a public issue for it. You get an answer within a week; a fix ships as a new signed release, and the advisory is
published once users can update.

Only the latest release is supported.

## How updates are protected

Nyx Monitor updates itself from https://nyx.majomaken.dev with `bin/nyx-monitor-update`:

- https only: any other channel URL is refused, and curl may not follow a redirect to plain http.
- `latest.json` names the version, the tarball and its sha256. It is signed with the release key, and the updater
  verifies the signature (`ssh-keygen -Y verify`) before it reads any field. An unsigned, re-signed or edited
  `latest.json` installs nothing and notifies nothing.
- The tarball must match the signed sha256, and the version inside must match, before anything is switched.
- Nothing installs by itself: the daily timer only notifies; installing is a click on «Actualizar» or
  `nyx-monitor-update install`.
- Every release is tag `v<version>` of `main` in this repository, built by `release.sh`.

The release key (ED25519, principal `nyx-monitor-release`, namespace `nyx-monitor`):

```
SHA256:C7GPdZqw26Ka+/rpiTthVP9b7tSiBK8pcVY+JjH6QHI
nyx-monitor-release namespaces="nyx-monitor" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA1TgBokDv/WO7zzyD+NyQZTE5LrqarAGUMOWDHQC/wr
```

The first install (`get.sh`) trusts https alone, since nothing is on the machine yet. To check the channel by hand
before or after it:

```bash
curl --proto '=https' -fsSLO https://nyx.majomaken.dev/latest.json
curl --proto '=https' -fsSLO https://nyx.majomaken.dev/latest.json.sig
echo 'nyx-monitor-release namespaces="nyx-monitor" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA1TgBokDv/WO7zzyD+NyQZTE5LrqarAGUMOWDHQC/wr' > allowed_signers
ssh-keygen -Y verify -f allowed_signers -I nyx-monitor-release -n nyx-monitor -s latest.json.sig < latest.json
```

A new key would ship inside an updater release signed with the current one, announced here.
