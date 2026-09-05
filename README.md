<div align="center">

# pi-ssh

**Local when you need it. Remote when you ask.**

Give pi’s bash tool an SSH host—without moving your whole session.

[![npm version][npm-badge]][npm-url]
[![GitHub checks][ci-badge]][ci-url]
[![GitHub release][release-badge]][release-url]
[![Node.js][node-badge]][node-url]

[Quick start](#quick-start) · [Usage](#usage) · [Configuration](#configuration) · [Documentation](#documentation)

</div>

## Quick start

With [pi](https://github.com/earendil-works/pi) installed:

```bash
pi install npm:@michaelasper/pi-ssh
pi
```

Then ask:

> On SSH host `build`, run `uname -s`. Then run `pwd` on my local machine.

Replace `build` with an SSH alias or `user@host` you can already access. pi selects the target through the existing **bash** tool—there is no new tool to learn.

**Requirements:** pi 0.85.1, Node.js 22.19+, local Bash/OpenSSH, and remote Bash with a POSIX-compatible login shell. macOS and Linux are supported; Windows is not verified. Set up SSH keys and verify the host fingerprint outside pi first.

> [!IMPORTANT]
> Only **bash** gains remote execution. File tools and `!` / `!!` commands stay local. `host="local"` always selects your local machine, even with a remote default.

## Usage

### Choose a host per command

Ask in plain language; pi supplies the arguments. Example bash calls:

```json
{"command": "uname -s", "host": "build"}
```

```json
{"command": "git status --short", "host": "local"}
```

Omit `host` to use the session default. With no configuration, that default is local.

### Work in a remote project

Make a remote host and directory the default for the session:

```bash
pi --ssh-host build --ssh-cwd /srv/project
```

Ask “Run the tests” for remote work, or “Run `git status` locally” to switch back for a command. The tool header shows the selected target and remote directory.

To override the directory or limit a single command:

```json
{"command": "npm test", "host": "build", "cwd": "/srv/project", "timeout": 60}
```

`cwd` is remote-only and must be an absolute path. Without a configured remote directory, each call starts in the remote login directory—not your local checkout.

## Configuration

| CLI flag | Environment variable | Default |
| --- | --- | --- |
| `--ssh-host` | `PI_SSH_HOST` | `local` |
| `--ssh-cwd` | `PI_SSH_CWD` | Remote login directory |
| `--ssh-connect-timeout` | `PI_SSH_CONNECT_TIMEOUT` | 10 seconds |

Per-call arguments override CLI flags; CLI flags override environment variables. Keep identities, ports, jump hosts and connection reuse in your normal SSH configuration.

```bash
PI_SSH_HOST=build PI_SSH_CWD=/srv/project pi
```

Need a quick connection check?

```bash
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes build 'bash -c "printf ready"'
```

See the [reference](https://github.com/michaelasper/pi-ssh/blob/main/docs/reference.md) for validation and precedence, or the [how-to guide](https://github.com/michaelasper/pi-ssh/blob/main/docs/how-to.md) for keys, ports and troubleshooting.

## Why pi-ssh?

Keep your checkout and file tools local while running builds or diagnostics on another machine.

- **Switch machines without switching tools.** Per-call targets and a guaranteed local override.
- **Keep your SSH setup.** Existing aliases, keys, gateways and connection reuse still work.
- **Keep familiar bash behaviour.** Streaming output, truncation, timeouts and trusted local shell settings.
- **Install less.** Zero additional production dependencies, no daemon, and nothing to install remotely beyond Bash.

This is not a remote filesystem or a sandbox. Cancelling stops the local SSH client, not necessarily every remote descendant. Full-output files are always stored locally.

## Other installation options

Pin the npm release:

```bash
pi install npm:@michaelasper/pi-ssh@0.1.1
```

Or install from GitHub:

```bash
pi install git:github.com/michaelasper/pi-ssh
```

Already running pi? Use `/reload` after installing. For a checkout, local development, updating or removing the extension, see [installation and maintenance](https://github.com/michaelasper/pi-ssh/blob/main/docs/how-to.md#install-update-or-remove).

## Documentation

| You want to… | Start here |
| --- | --- |
| Run your first remote command | [Tutorial](https://github.com/michaelasper/pi-ssh/blob/main/docs/tutorial.md) |
| Configure a remote project or fix a connection | [How-to guides](https://github.com/michaelasper/pi-ssh/blob/main/docs/how-to.md) |
| Look up arguments, defaults and limits | [Reference](https://github.com/michaelasper/pi-ssh/blob/main/docs/reference.md) |
| Understand execution and trust boundaries | [Explanation](https://github.com/michaelasper/pi-ssh/blob/main/docs/explanation.md) |
| Contribute or reproduce the checks | [Development](https://github.com/michaelasper/pi-ssh/blob/main/docs/development.md) |
| Inspect test and benchmark evidence | [Verification](https://github.com/michaelasper/pi-ssh/blob/main/docs/verification.md) |

[npm-badge]: https://img.shields.io/npm/v/@michaelasper/pi-ssh?color=cb3837
[npm-url]: https://www.npmjs.com/package/@michaelasper/pi-ssh
[ci-badge]: https://github.com/michaelasper/pi-ssh/actions/workflows/ci.yml/badge.svg?branch=main
[ci-url]: https://github.com/michaelasper/pi-ssh/actions/workflows/ci.yml
[release-badge]: https://img.shields.io/github/v/release/michaelasper/pi-ssh
[release-url]: https://github.com/michaelasper/pi-ssh/releases
[node-badge]: https://img.shields.io/node/v/@michaelasper/pi-ssh
[node-url]: https://nodejs.org/
