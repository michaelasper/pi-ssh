# Target visibility

Target visibility shows the user which machine calls will hit before any tool runs. The `/ssh` command reports the resolved configuration, and the footer status names a remote default for the whole session.

## Sub-features

- `target-status-remote` shows `ssh: <host>` in the footer under a remote default.
- `target-status-local` shows nothing under a local default.
- `target-status-error` shows `ssh: config error` when configuration is invalid.
- `target-command` answers `/ssh` with the default host, remote cwd, and timeout.

## How to get to it (user POV)

- Start pi with `--ssh-host <alias>` and look at the footer.
- Type `/ssh` in any pi-ssh session.

## Driving it with the sshd harness

Preconditions:

- None. This feature never opens an SSH connection, so the sshd harness does not drive it. The unit suite and a real pi launch carry the proof.

- **Status transitions.** The extension test named `/ssh reports the resolved target and the footer status tracks the default host` drives one extension through remote, local, and broken configurations. It asserts the exact status values and the notice text for each. Run it with `node --test test/extension.test.ts`.
- **Real registration.** Launch pi with the extension and a probe that lists commands. The list contains `ssh`. The 0.5.0 verification record in `docs/maintainers/verification.md` describes the probe.
- **Proof.** The named test passes and the probe prints its success marker.

## Gotchas

- The footer shows the configured default. A per-call `host` still overrides it, and tool headers remain the per-call truth.
- Print and JSON modes have no footer. The status call is a no-op there, and `/ssh` output goes through the notification channel the mode provides.
