# pi-ssh

Run pi’s bash commands on an SSH host without giving up local execution.

Add `host` to a bash call, or set a default remote for the session. Your existing SSH aliases, keys and connection settings still work. No remote installation beyond Bash, no daemon, no extra runtime dependencies beyond pi’s bundled packages.

```json
{"command": "uname -s", "host": "build"}
```

```json
{"command": "git status --short", "host": "local"}
```

Only the model-callable **bash** tool changes. File tools and `!` / `!!` commands remain local. This is not a remote filesystem or a sandbox.

## Try it

Requirements: pi **0.85.1**, Node.js **22.18+**, local Bash and OpenSSH, and an authorised remote with Bash and a POSIX-compatible login shell. macOS and Linux are the intended local platforms; Windows is not verified.

From a local checkout:

```bash
npm ci
pi -e ./src/index.ts
```

Ask: “On SSH host `build`, run `uname -s`. Then run `pwd` locally.” Replace `build` with your SSH alias. Authenticate and verify the host key outside pi first; pi-ssh never prompts for passwords or accepts unknown keys automatically.

To default bash calls to a remote:

```bash
pi -e ./src/index.ts --ssh-host build --ssh-cwd /srv/project
```

`host="local"` always selects the local machine. Without configuration, omitted `host` means local.

## Install

From a checkout, `pi install .` registers the package with your user settings. Restart pi or use `/reload` in an existing session.

Install from GitHub:

```bash
pi install git:github.com/michaelasper/pi-ssh
```

To pin the initial release:

```bash
pi install git:github.com/michaelasper/pi-ssh@v0.1.0
```

No registry release or remote publication is performed by the development scripts.

## Documentation

- [Your first remote command](docs/tutorial.md) — a short hands-on lesson.
- [Work with remote projects](docs/how-to.md) — defaults, SSH configuration and troubleshooting.
- [Tool and configuration reference](docs/reference.md) — arguments, precedence and limits.
- [Execution and trust boundaries](docs/explanation.md) — why only bash changes and what cancellation means.
- [Development and verification](docs/development.md) — tests, benchmarks and isolated model sessions.
- [Verification results](docs/verification.md) — measured results and coverage limits.
