# Work with remote projects

## Default to a remote project

With pi-ssh installed:

```bash
pi --ssh-host build --ssh-cwd /srv/project
```

Or set process-level defaults:

```bash
PI_SSH_HOST=build PI_SSH_CWD=/srv/project pi
```

Ask pi to run local commands with `host: "local"`. To keep an entire session local by default while retaining per-call SSH support:

```bash
pi --ssh-host local
```

A per-call `cwd` overrides the configured remote directory. Use an absolute remote path; `~` and local project paths are not translated. Without a remote directory setting, each call starts in the remote login directory. To override a configured directory with the home directory, supply its absolute path.

Configuration is resolved at session start or reload. Environment changes made inside a bash command do not update the parent pi process. Start a new pi process to change its environment or CLI flags.

## Use a particular key, port or jump host

Keep connection details in your normal SSH configuration:

```sshconfig
Host build
    HostName build.example.net
    User developer
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
    ProxyJump gateway
```

Then use `host: "build"`. Omit `ProxyJump` if no gateway is needed. Do not put a port, path or `ssh://` URL into `host`.

To reuse connections, configure OpenSSH `ControlMaster`, `ControlPath` and `ControlPersist` yourself. Use a private control-socket directory. pi-ssh does not create or own multiplexing masters.

## Bound command duration

Ask pi to pass a `timeout`, in seconds, on the bash call. It bounds the local execution including connection setup. Set the independent connection timeout at startup:

```bash
pi --ssh-connect-timeout 5
```

Cancellation and timeout terminate the local client. For jobs requiring guaranteed remote cleanup, use your remote job supervisor; see [the cancellation boundary](explanation.md#cancellation-is-not-remote-job-control).

## Retrieve truncated output

A truncation notice points to a **local** temporary file, even for remote commands. Use pi’s local `read` tool to inspect it. If using bash instead, set `host: "local"` so a remote default cannot redirect that file access.

## Troubleshoot a failed connection

Run the same alias outside pi:

```bash
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 build 'bash -c "printf ready"'
```

- **Permission denied:** unlock your SSH agent or configure the correct key outside pi.
- **Host key verification failed:** verify the fingerprint independently and repair your known-hosts entry outside pi. Do not disable verification.
- **Bash not found:** install Bash on the authorised remote, or choose a compatible host.
- **Working directory error:** check the absolute remote path and permissions. A failing directory change prevents the command from running.
- **Invalid pi-ssh configuration:** correct the CLI flag or environment variable, then restart or reload. Invalid configuration blocks bash, including local calls; there is no silent fallback.
- **Another bash extension is active:** disable one of the overrides. pi-ssh does not chain other implementations of bash.

To stop loading pi-ssh after a local-path installation, run `pi remove /absolute/path/to/pi-ssh`, then restart or reload. Use the original Git source string when removing a Git installation.
