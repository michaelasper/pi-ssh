# Work with remote projects

These guides describe the host-aware file tools in version 0.2.0. For arguments and limits, use the [reference](reference.md). For a first read-only exercise, use the [tutorial](tutorial.md).

## Install, update or remove

### Try the host-aware file tools from a checkout

Versions `0.1.x` are bash-only; they do not include the six host-aware file tools. To try version 0.2.0 before npm release approval, use a checkout containing the changes:

```bash
cd /absolute/path/to/pi-ssh
npm ci
pi -e ./src/index.ts --ssh-host local
```

`--ssh-host local` overrides an inherited SSH default while you try the extension. For persistent loading from that checkout, run `pi install .`, then restart pi. Install only one source at a time; remove an old npm, Git or local installation before switching sources to avoid duplicate tool overrides.

### Manage an existing npm or Git installation

The public package name is scoped:

```bash
pi install npm:@michaelasper/pi-ssh
```

Check the installed version’s release notes for its capabilities. Staged npm versions are not installable until a maintainer approves them. After approval, you can select version 0.2.0 explicitly with `pi install npm:@michaelasper/pi-ssh@0.2.0`.

The unscoped npm package `pi-ssh` is a different project. To reproduce the historical bash-only release:

```bash
pi install npm:@michaelasper/pi-ssh@0.1.1
```

Update an unpinned npm installation:

```bash
pi update npm:@michaelasper/pi-ssh
```

Pinned installations remain pinned; install a different explicit version to change them. To remove a package, pass the same source string used at installation:

```bash
pi remove npm:@michaelasper/pi-ssh
```

Git installation is available with `pi install git:github.com/michaelasper/pi-ssh`. Restart pi or use `/reload` after changing a package installation. For local-path removal, use `pi remove /absolute/path/to/pi-ssh`; for a Git or pinned npm installation, use its original source string.

## Migrate existing prompts and integrations

> [!WARNING]
> With `--ssh-host build` or `PI_SSH_HOST=build`, **all seven tools** now default to that remote. Previously, only bash did. An unchanged `write` or `edit` call without `host` can now modify a remote file instead of a local one.

Choose one of these migration strategies:

1. **Keep a remote default.** Add `host: "local"` to every local `read`, `write`, `edit`, `find`, `grep` and `ls` call. Update prompts, templates, integrations and instructions that say file tools are always local.
2. **Keep calls local unless explicitly remote.** Start with `pi --ssh-host local`, then supply an SSH host on each remote call, including bash. There is no separate bash-only default setting.

For example, under `pi --ssh-host build --ssh-cwd /srv/project`, this `read` call now reads `/srv/project/README.md` **remotely**:

```json
{"path": "README.md"}
```

To preserve its former local behaviour:

```json
{"path": "README.md", "host": "local"}
```

Use the same `host` on follow-up file calls and read pagination. Do not add `cwd` to file calls; retain the native `path` argument. Explicit remote hosts override the default, while the configured remote directory still applies to them.

Always add `host: "local"` when reading a bash full-output artifact. Those artifacts remain local even when the command ran remotely. Neither `!` / `!!` commands nor unrelated extension tools become remote.

## Default to a remote project

With version 0.2.0 or newer installed, replace `build` and `/srv/project` with your authorised target and remote project directory:

```bash
pi --ssh-host build --ssh-cwd /srv/project
```

Or set process-level defaults:

```bash
PI_SSH_HOST=build PI_SSH_CWD=/srv/project pi
```

Now omitted-host bash and file calls use that remote. Ask “Read the remote README, then inspect my local README using `host: "local"`” to distinguish the two. Local file paths resolve against the live pi session cwd, not the remote project.

Use an absolute path for `--ssh-cwd`; `~` and `$HOME` are not expanded in this setting. Without it, relative paths use the remote login directory. File paths themselves may use `~/` for the selected remote account’s home:

```json
{"path": "~/another-project/README.md", "host": "build"}
```

For another project on an explicit SSH target, use an absolute file path:

```json
{"path": "/srv/other-project/README.md", "host": "other-build"}
```

The configured cwd applies to every remote host, so a relative path on `other-build` would still use `/srv/project`. Only bash supports a per-call absolute `cwd`; a bash `cd` never changes a later file call’s base directory. There is no local-to-remote path translation or file synchronisation.

Configuration is resolved at session start or reload. Environment changes inside a bash command do not update the parent pi process. Start a new pi process to change its environment or CLI flags.

## Use a particular key, port or jump host

Keep connection details in your normal SSH configuration. Example:

```sshconfig
Host build
    HostName build.example.net
    User developer
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
    ProxyJump gateway
```

Then use `host: "build"`. Omit `ProxyJump` if no gateway is needed. Do not put a port, path or `ssh://` URL into `host`.

To reuse connections, configure OpenSSH `ControlMaster`, `ControlPath` and `ControlPersist` yourself. Use a private control-socket directory. pi-ssh does not create or own multiplexing masters, change authentication, or disable strict host-key verification.

## Prepare remote file utilities

Check an authorised alias outside pi without changing it:

```bash
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 build 'bash -c "python3 --version"'
```

Python must be 3.9 or newer and available as `python3` on the remote non-interactive `PATH`. Remote find also needs `fd` or `fdfind`; remote grep needs `rg`. Their lookup checks remote `PATH`, then `/opt/homebrew/bin`, `/usr/local/bin` and the remote `~/.pi/agent/bin`.

If a utility is missing, ask the machine’s owner or administrator to provision it explicitly, or choose a compatible target. pi-ssh never installs it automatically. A directory named `~/.pi/agent/bin` is only a lookup location; no remote pi or Node.js installation is needed.

## Bound command duration

Ask pi to pass a `timeout`, in seconds, on the bash call. It bounds local execution including connection setup. Set the separate connection timeout at startup:

```bash
pi --ssh-connect-timeout 5
```

The connection timeout applies to SSH connections for all seven tools, not to the total duration of a file operation. File tools do not add a per-call timeout. Use pi’s cancellation control to stop a read or search.

Read/search cancellation and bash timeout stop the local SSH process tree, not necessarily every remote descendant. Already-started remote `mkdir` and write operations finish before cancellation releases their mutation queue. Do not treat cancellation as rollback. For jobs requiring guaranteed remote cleanup, use a remote job supervisor; see [the cancellation boundary](explanation.md#cancellation-is-not-remote-job-control).

## Retrieve truncated output

A bash truncation notice points to a **local** temporary file, even for remote commands. Ask pi to read the actual reported path with an explicit local target:

```json
{"path": "/actual/path/from/the/truncation/notice", "host": "local", "offset": 1, "limit": 100}
```

Continue with `offset` and the same local host. If using bash instead, also set `host: "local"`. Otherwise an SSH default would send the artifact path to the remote filesystem.

For a truncated **remote file read**, keep its remote host and original path on subsequent pages. These pages still transfer the entire file before native truncation; a small `limit` is not a network or memory limit. Narrow large searches by path, pattern or glob rather than assuming the returned text cap bounds resource use.

## Troubleshoot a failed connection or file call

Run the same alias outside pi:

```bash
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 build 'bash -c "printf ready"'
```

- **Permission denied:** unlock your SSH agent or configure the correct key outside pi.
- **Host key verification failed:** verify the fingerprint independently and repair your known-hosts entry outside pi. Do not disable verification.
- **Bash or Python unavailable:** explicitly provision the prerequisites on an authorised remote, or choose a compatible host. Python must be 3.9+ on `PATH` for file tools; bash-only calls do not require it.
- **Missing fd/fdfind or rg:** provision the required search utility explicitly and make it visible in a [supported location](reference.md#compatibility). The extension does not download it.
- **Working directory or file error:** verify the selected host, configured remote base directory, path and permissions. Absolute file paths and `~/` refer to that machine, not your local checkout. A failed bash `cd` prevents its command from running.
- **Unexpected stdout or invalid helper response:** check whether remote startup configuration prints extra output for non-interactive SSH. File operations require a JSON response; unsolicited stdout can corrupt it.
- **Remote mutation outcome is unknown:** read the target to inspect it and confirm that the earlier remote operation has stopped. Then restart pi before retrying. Queued and future write/edit calls for that path/inode are blocked after an unacknowledged mutation; do not bypass the guard with bash or another tool.
- **Invalid pi-ssh configuration:** correct the CLI flag or environment variable, then restart or reload. Invalid configuration blocks all seven tools, even explicit local calls.
- **Another extension overrides the same tool:** disable one of the overrides. pi-ssh delegates local work to native pi, not to another extension’s implementation.

An SSH or protocol failure never falls back to the local machine or becomes a successful empty search. After a failed or cancelled mutation, inspect the target before retrying: a connection failure may occur after a partial or complete write. Extension-owned queues coordinate write/edit calls, not external editors or bash commands, and provide no transaction or rollback guarantee.
