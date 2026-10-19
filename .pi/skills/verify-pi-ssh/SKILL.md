---
name: verify-pi-ssh
description: "Verify pi-ssh end to end. Drives the seven host-aware tools (bash, read, write, edit, find, grep, ls) against a throwaway SSH server on loopback and captures the run as evidence. Use before any release, after changing routing or the remote helpers in src/, or when a test that mocks SSH passes but real SSH behavior is in doubt."
---

# Verify pi-ssh

The system under test is the pi extension in `src/`. The user-facing surface is the seven pi tools it replaces. Unit tests mock the SSH transport, so they cannot prove quoting, routing, or cleanup over a real connection. This skill runs the opt-in real-SSH suite, `test/ssh.e2e.ts`, against an sshd that exists only for the run.

## Launch

Run one command from the repo root:

```bash
npm run test:e2e
```

The command runs `scripts/ssh-e2e.sh`. The script generates host and client keys in a temp dir, starts a user-owned sshd on a free loopback port, waits until an authenticated command succeeds, then runs `npm run test:ssh` with `PI_SSH_TEST_HOST=pi-ssh-e2e`. A `PATH` shim adds the isolated client config to every `ssh` call. The run prints `ssh-e2e: sshd ready on 127.0.0.1:<port>` before the test output.

Prerequisites on this machine, which plays both client and server: OpenSSH server and client, Node.js 22.19 or newer, Python 3.9 or newer, `fd`, and `rg`. The script exits with a named error when one is missing. Set `SSHD` to the sshd path when it is not `/usr/sbin/sshd`.

No Docker and no external host are involved. Nothing reads or writes the real `~/.ssh` directory. Two runs can proceed side by side. Each gets its own temp dir, port, and keys.

## Doctor

Run this read-only check when a run looks wrong:

```bash
command -v ssh sshd ssh-keygen python3 fd rg node; /usr/sbin/sshd -V 2>&1 | head -1; node --version
```

On macOS the sshd line reports an OpenSSH version string on stderr. All paths must resolve before the harness is worth driving. If a previous failed run kept its temp dir, read `sshd.log` in that dir before changing anything.

## Drive

The suite in `test/ssh.e2e.ts` is the driver. It calls the real tool definitions from `src/tool.ts` and `src/file-tools.ts`, which spawn the real `ssh` binary. The features map in `features/` names what each scenario proves from the user's point of view. Read the matching feature file before changing a scenario.

To run the suite against a real authorized host instead, skip the harness:

```bash
PI_SSH_TEST_HOST=<ssh-alias> npm run test:ssh
```

Only do this with explicit authorization for that host. The suite creates and removes its own temp fixtures there.

## Evidence

Save the full run output outside the temp dir, because cleanup deletes it:

```bash
mkdir -p .artifacts && npm run test:e2e 2>&1 | tee .artifacts/ssh-e2e.log
```

`.artifacts/` is gitignored. The log is the proof artifact. It records the sshd address and both scenario results. A passing run ends with two named scenarios and `pass 2`. Mutation scenarios prove themselves with a second view. The suite reads every file it writes, checks local files byte for byte, and asserts remote fixture removal over a fresh SSH call.

Record the result in `docs/verification.md` with the command, the date, and the platform. Name skipped coverage as skipped. A green mocked suite is not evidence for this skill.

## Cleanup

The script kills the sshd it started, through its recorded pid, and removes the temp dir on any exit. Never kill sshd by process name. The machine may run a real SSH server. With `PI_SSH_E2E_KEEP=1` a failed run keeps the temp dir and prints its path. Remove that dir by hand after reading `sshd.log`. Cleanup never deletes `.artifacts/`. The evidence log survives.

## Helpers

- `scripts/ssh-e2e.sh` is the harness. Run it through `npm run test:e2e`.
- `test/ssh.e2e.ts` holds the two scenarios. Run it alone with `PI_SSH_TEST_HOST=<alias> npm run test:ssh`.
- `npm run check` runs the mocked suite plus typecheck. It complements this skill and never replaces it.

Keep this skill honest as the tools change. The `/skill:maintain-verification-skill` skill covers that upkeep.
