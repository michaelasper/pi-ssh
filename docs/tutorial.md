# Your first remote command and file read

This tutorial runs a harmless command and reads an existing file remotely, then runs a command locally. It does not modify remote files.

You need:

- pi 0.85.1, Node.js 22.19+, and local Bash/OpenSSH on macOS or Linux.
- A version 0.2.0 checkout, with no other pi-ssh installation active. Versions `0.1.x` are bash-only and cannot run the file-tool step.
- An SSH alias named `build` for a Linux machine you are authorised to use, with `/etc/os-release`, Bash, a POSIX-compatible login shell and Python 3.9+ on `PATH`.

This exercise does not use find or grep; those remote tools additionally require fd/fdfind and rg respectively. The extension does not install prerequisites automatically.

## 1. Check the connection

In your terminal, run:

```bash
ssh build 'bash -c "printf remote-ready"'
```

Verify any new host-key fingerprint through a trusted channel before accepting it. Complete key or agent authentication outside pi. You should see `remote-ready`.

Now check that the connection works without a prompt and that Python is available:

```bash
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 build 'bash -c "python3 --version"'
```

You should see a Python version of **3.9 or newer**. If either check fails, stop and use the [troubleshooting guide](how-to.md#troubleshoot-a-failed-connection-or-file-call). Do not disable host-key checking.

## 2. Start pi with the checkout

From the repository directory, start a fresh session:

```bash
pi -e ./src/index.ts --ssh-host local
```

pi may warn that the extension overrides bash and file tools. That is expected. The explicit local session default overrides any inherited `PI_SSH_HOST`, so calls without `host` stay local during this exercise.

## 3. Run remotely

Ask pi:

> On SSH host build, run `printf remote-ready`.

The bash call should use `host: "build"` and return `remote-ready`. Its header should identify SSH target `build`.

## 4. Read a remote file

Ask:

> Use the read tool to read the first five lines of `/etc/os-release` on SSH host build.

The read call should look like this:

```json
{"path": "/etc/os-release", "host": "build", "offset": 1, "limit": 5}
```

You should see the beginning of the remote machine’s operating-system description. This is the remote file, even if your local machine has a file with the same path. A pagination notice is expected when the file contains more than five lines.

## 5. Run locally

Ask:

> On the local machine running pi, run `printf local-ready`. Explicitly select local execution.

The bash call should use `host: "local"` and return `local-ready`. Its header should identify the local target.

You have selected machines through the existing bash and read tools without moving your session or copying a project. File calls add only `host`, not a per-call `cwd`. For repeated remote work, continue with [setting a default remote](how-to.md#default-to-a-remote-project). That default applies to all seven tools, including write and edit; keep using `host="local"` for local files and bash full-output artifacts.
