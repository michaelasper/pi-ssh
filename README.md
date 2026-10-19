<div align="center">

# pi-ssh

**One set of tools. Your choice of machine.**

Run commands and work with files over SSH, without moving your pi session.

[![npm version][npm-badge]][npm-url]
[![GitHub checks][ci-badge]][ci-url]
[![GitHub release][release-badge]][release-url]
[![Node.js][node-badge]][node-url]
[![MIT licence][license-badge]][license-url]

[Tutorial](docs/tutorial.md) · [How-to](docs/how-to.md) · [Reference](docs/reference.md) · [Explanation](docs/explanation.md)

</div>

pi-ssh adds an optional `host` argument to pi's seven built-in tools. The tools are `bash`, `read`, `write`, `edit`, `find`, `grep`, and `ls`. Name an SSH host to run on that machine. Pass `host="local"` to stay on yours. Omit `host` to follow the session default, which `--ssh-host` or `PI_SSH_HOST` sets.

Your existing SSH setup keeps working. Aliases, keys, jump hosts, and connection reuse come from OpenSSH. There is no file sync, no remote service, and no pi on the remote machine. User-typed `!` commands and other extensions' tools stay local.

> [!WARNING]
> A remote default changes where file writes land. Under `--ssh-host build`, a `write` or `edit` call without `host` changes files on `build`. The footer shows `ssh: build` for the whole session, and `/ssh` prints the resolved target. Use `host="local"` for local files. With no configuration, everything stays local.

Versions before 0.2.0 routed only `bash`. If your prompts assume file tools are always local, read the [migration guide](docs/how-to.md#migrate-existing-prompts-and-integrations).

## Requirements

- Local: pi 1.3.0, Node.js 22.19 or newer, Bash, and OpenSSH on macOS or Linux. Windows is not verified.
- Remote bash: Bash on `PATH` and non-interactive SSH authentication.
- Remote file tools: Python 3.9 or newer on `PATH`. The `find` tool also needs `fd`, and `grep` needs `rg`.

pi-ssh never installs remote software and never changes SSH configuration. Set up keys and verify the host fingerprint outside pi first.

## Quick start

From a checkout of this repository:

```bash
pi -e ./src/index.ts --ssh-host local
```

Then ask:

> On SSH host `build`, run `uname -s`. Then read `/etc/os-release` on that same host. Finally, run `pwd` on my local machine.

Replace `build` with an authorized SSH alias or `user@host`. The [tutorial](docs/tutorial.md) walks through the same flow step by step. For npm or Git installation, see [install, update or remove](docs/how-to.md#install-update-or-remove).

## Documentation

| You want to | Start here |
| --- | --- |
| Run your first remote command and file read | [Tutorial](docs/tutorial.md) |
| Configure a remote project, migrate prompts, or fix a connection | [How-to](docs/how-to.md) |
| Look up arguments, defaults, and limits | [Reference](docs/reference.md) |
| Understand the trust and memory boundaries | [Explanation](docs/explanation.md) |
| Change pi-ssh or cut a release | [Maintainer docs](docs/maintainers/README.md) |

## Licence

[MIT](LICENSE) © 2026 Michael Asper.

[npm-badge]: https://img.shields.io/npm/v/@michaelasper/pi-ssh?color=cb3837
[npm-url]: https://www.npmjs.com/package/@michaelasper/pi-ssh
[ci-badge]: https://github.com/michaelasper/pi-ssh/actions/workflows/ci.yml/badge.svg?branch=main
[ci-url]: https://github.com/michaelasper/pi-ssh/actions/workflows/ci.yml
[release-badge]: https://img.shields.io/github/v/release/michaelasper/pi-ssh
[release-url]: https://github.com/michaelasper/pi-ssh/releases
[node-badge]: https://img.shields.io/node/v/@michaelasper/pi-ssh
[node-url]: https://nodejs.org/
[license-badge]: https://img.shields.io/github/license/michaelasper/pi-ssh
[license-url]: https://github.com/michaelasper/pi-ssh/blob/main/LICENSE
