# pi-ssh 0.2.0

## Breaking change: file tools follow the SSH default

`read`, `write`, `edit`, `find`, `grep` and `ls` now accept optional `host`, just like `bash`. With `--ssh-host` or `PI_SSH_HOST` set to a remote, file calls that omit `host` access or modify that remote filesystem. Versions 0.1.x applied that default only to bash.

- Add `host: "local"` to local file calls in prompts, templates and integrations.
- Alternatively, start pi with `--ssh-host local` and name the SSH host on each remote call.
- File tools add only `host`, not per-call `cwd`. Relative remote paths use `--ssh-cwd` / `PI_SSH_CWD`, or the remote login directory when unset.
- Bash full-output artifacts remain local: always read them with `host: "local"`.
- With no SSH configuration, all seven tools remain local. User-entered `!` / `!!` commands and unrelated extension tools remain local.

See the [migration guide](how-to.md#migrate-existing-prompts-and-integrations) before upgrading.

## Added

- Remote text and image reads, pagination, writes with parent-directory creation, multi-block edits and diffs, directory listings, and fd/rg searches.
- Selected-machine path resolution, including remote home expansion, spaces, quotes and Unicode.
- Serialisation of remote write/edit calls sharing canonical paths, symlinks or hard links within the same literal SSH target.
- Fail-closed mutation handling after an unacknowledged remote write. Inspect the file and confirm the previous operation has stopped before restarting pi and retrying.
- Target-aware tool headers while retaining native local behaviour and native result rendering.

SSH failures never fall back locally. Non-interactive authentication and strict host-key verification remain required. No files are mirrored and no persistent service or remote pi installation is needed.

## Requirements and limits

- Local: pi 0.85.1, Node.js 22.19+, Bash and OpenSSH on macOS or Linux.
- Remote bash: Bash on `PATH` and a POSIX-compatible login shell.
- Remote file tools: Python 3.9+ on `PATH`; `find` also requires `fd` or `fdfind`, and `grep` requires `rg`. The extension does not install utilities.

File payloads and listings are buffered before output truncation. Mutation queues do not coordinate external editors or bash commands, provide rollback, or guarantee termination of arbitrary remote descendants. Windows is unverified. See [verification](verification.md) for recorded checks and coverage limits.

## Install after npm approval

The release workflow stages a verified tarball. Staging alone does not make this version public; a maintainer must approve it on npm with 2FA.

After approval:

```bash
pi install npm:@michaelasper/pi-ssh@0.2.0
```

Install only one pi-ssh source at a time, then restart pi or use `/reload`. See [installation and maintenance](how-to.md#install-update-or-remove).
