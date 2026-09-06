<div align="center">

# pi-ssh

**One set of tools. Your choice of machine.**

Run commands and work with files over SSH—without moving your pi session.

[![npm version][npm-badge]][npm-url]
[![GitHub checks][ci-badge]][ci-url]
[![GitHub release][release-badge]][release-url]
[![Node.js][node-badge]][node-url]
[![MIT licence][license-badge]][license-url]

[Quick start](#quick-start) · [Migration](#migrate-from-bash-only-routing) · [Usage](#usage) · [Documentation](#documentation)

</div>

> [!WARNING]
> **Breaking default-routing change:** `read`, `write`, `edit`, `find`, `grep` and `ls` now follow `--ssh-host` / `PI_SSH_HOST`, just like `bash`. With an SSH default, file calls that omit `host` access or modify the **remote** filesystem. Use `host="local"` for local files. With no configuration, calls remain local.

Host-aware file tools require **0.2.0 or newer**; versions **0.1.x** are bash-only. See the [0.2.0 release notes](docs/release-0.2.0.md) for changes and migration requirements. The checkout instructions below work before npm release approval.

## Why pi-ssh?

Use the same tools to inspect, edit and test a remote project while keeping pi running locally. Choose a remote default for sustained work, or select SSH only when needed.

- **Switch machines without switching tools.** All seven tools accept `host`, with a guaranteed local override.
- **Keep familiar file operations.** Paginated text and image reads, parent-directory creation, multi-block edits and diffs, and filtered searches.
- **Keep your SSH setup.** Existing aliases, keys, gateways and connection reuse still work.
- **Keep familiar bash behaviour.** Streaming output, truncation, timeouts and trusted local shell settings are unchanged.

There is no file synchronisation, persistent remote service or remote pi installation. This is not a sandbox or a remote job supervisor. User-entered `!` / `!!` commands and unrelated extension tools remain local.

## Requirements

- **Local:** [pi](https://github.com/earendil-works/pi) 0.85.1, Node.js 22.19+, Bash and OpenSSH. macOS and Linux are supported; Windows is not verified.
- **Remote bash:** Bash on `PATH`, a POSIX-compatible login shell and non-interactive SSH authentication.
- **Remote file tools:** Python 3.9+ on `PATH`; `find` also needs `fd` or `fdfind`, and `grep` needs ripgrep (`rg`). No remote Node.js or pi is required.

Set up keys and verify the host fingerprint outside pi first. pi-ssh never installs remote utilities or changes SSH configuration or security settings. See [utility lookup and compatibility](docs/reference.md#compatibility) for supported search locations.

## Quick start

From this repository checkout, with pi installed and no other pi-ssh installation active:

```bash
pi -e ./src/index.ts --ssh-host local
```

Then ask:

> On SSH host `build`, run `uname -s`. Then read `/etc/os-release` on that same host. Finally, run `pwd` on my local machine.

This sample assumes a Linux remote with `/etc/os-release`. Replace `build` with an authorised SSH alias or `user@host`. The explicit local session default keeps other calls local; pi uses `host: "build"` for the remote calls.

For persistent checkout loading and existing npm/Git installations, see [installation and maintenance](docs/how-to.md#install-update-or-remove). Install only one source at a time.

## Migrate from bash-only routing

Previously, a remote bash default did not affect file tools. Now, under `pi --ssh-host build --ssh-cwd /srv/project`, this `read` call reads the **remote** README:

```json
{"path": "README.md"}
```

To keep reading the local checkout, add `host`:

```json
{"path": "README.md", "host": "local"}
```

Apply the same change to local `write`, `edit`, `find`, `grep` and `ls` calls in your prompts, templates and integrations. Alternatively, start with `pi --ssh-host local` and explicitly name the SSH host on remote calls, including bash.

**Bash full-output artifacts are always LOCAL.** Read a reported artifact with `{"path": "/actual/path/from/the/notice", "host": "local"}` even when its command ran remotely. See the [migration guide](docs/how-to.md#migrate-existing-prompts-and-integrations).

## Usage

Ask in plain language; pi supplies the arguments. These are sample tool calls, not recorded test results.

### Choose a machine per call

Read a remote file:

```json
{"path": "~/project/README.md", "host": "build", "offset": 1, "limit": 80}
```

Search the local checkout with `grep`, even with a remote default:

```json
{"pattern": "TODO", "path": "src", "host": "local"}
```

An explicit SSH target overrides the configured host. `host="local"` always delegates to native local pi; omitted `host` follows the configured default.

### Work in a remote project

With this checkout installed:

```bash
pi --ssh-host build --ssh-cwd /srv/project
```

Now “Read the README and run the tests” can use remote `read` and `bash` calls without `host`. Relative file paths use `/srv/project`; absolute paths refer to the selected remote filesystem, and `~/` uses that remote account’s home. Nothing is mapped from the local checkout.

File tools add **only `host`**, not per-call `cwd`. Use their existing `path` argument to select another directory. Bash retains its remote-only absolute `cwd` override:

```json
{"command": "npm test", "host": "build", "cwd": "/srv/another-project", "timeout": 60}
```

Headers show the target and remote directory. Omitted configuration is labelled “current default”; restored transcripts do not provide a durable historical target for omitted fields.

## Configuration

| CLI flag | Environment variable | Default |
| --- | --- | --- |
| `--ssh-host` | `PI_SSH_HOST` | `local` |
| `--ssh-cwd` | `PI_SSH_CWD` | Remote login directory |
| `--ssh-connect-timeout` | `PI_SSH_CONNECT_TIMEOUT` | 10 seconds |

Per-call `host` overrides CLI flags; CLI flags override environment variables. The configured remote cwd applies to **every** remote host, including explicit host overrides. Only bash has a per-call `cwd` override.

The [reference](docs/reference.md) lists arguments, path rules and output limits. The [how-to guide](docs/how-to.md) covers keys, ports, missing utilities and connection failures. SSH errors never fall back locally. Failed mutations may be partial; an unacknowledged write blocks further mutations of that file until pi restarts. Inspect the target and confirm the old operation has stopped before restarting and retrying.

## Documentation

| You want to… | Start here |
| --- | --- |
| Run a command and read a file remotely | [Tutorial](docs/tutorial.md) |
| Migrate defaults, configure a project or fix a connection | [How-to guides](docs/how-to.md) |
| Look up arguments, defaults and limits | [Reference](docs/reference.md) |
| Understand memory, mutation and trust boundaries | [Explanation](docs/explanation.md) |
| Contribute or reproduce the checks | [Development](docs/development.md) |
| Inspect recorded checks and their coverage limits | [Verification](docs/verification.md) |

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
