# Your first remote command

This tutorial runs one harmless command remotely, then one locally. You need pi 0.85.1, Node.js 22.19+, and an SSH alias named `build` for a machine you are authorised to use. The remote needs Bash.

## 1. Check the connection

In your terminal, run:

```bash
ssh build 'bash -c "printf remote-ready"'
```

Verify any new host-key fingerprint through a trusted channel before accepting it. Complete key or agent authentication outside pi. You should see `remote-ready`.

Now check that the connection works without a prompt:

```bash
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes build 'printf remote-ready'
```

You should again see `remote-ready`.

## 2. Start pi with the extension

Install the npm package and start a fresh session:

```bash
pi install npm:@michaelasper/pi-ssh
pi
```

pi may report that the extension overrides bash. That is expected.

## 3. Run remotely

Ask pi:

> On SSH host build, run `printf remote-ready`.

The bash call should use `host: "build"` and return `remote-ready`.

## 4. Run locally

Ask:

> On the local machine running pi, run `printf local-ready`. Explicitly select local execution.

The bash call should use `host: "local"` and return `local-ready`.

You have used the same tool on two machines. For a project with repeated remote commands, continue with [setting a default remote](how-to.md#default-to-a-remote-project).
