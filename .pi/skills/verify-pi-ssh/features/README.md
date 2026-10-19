# pi-ssh verification map

This directory is the maintained source for verifying pi-ssh over a real SSH connection. Read the index first, then use the matching feature file as the recipe.

## Baseline preconditions

- Run `npm run test:e2e` from the repo root. The harness starts a throwaway sshd on loopback.
- The harness prints the port it picked. The alias inside the run is always `pi-ssh-e2e`.
- Python 3.9 or newer, `fd`, and `rg` resolve on this machine. The harness forwards the caller `PATH` into SSH sessions, so the server side finds them too.
- Never drive an SSH host the run did not create, unless the user authorized that host for testing.

## Driving conventions

- The suites in `test/ssh.e2e.ts` are the commands. Feature files name the scenario that carries each proof.
- Treat every command as literal. Keep quoted names and flags unchanged.
- A mutation counts as proven only when a later read on the same target shows the result, and a local check shows the local file unchanged.
- Save proof to `.artifacts/ssh-e2e.log`. Cleanup removes temp state and leaves the log.

## Proof and skip reporting

- Capture the action and the resulting state, not only a final pass line.
- Record the feature ID with every artifact or report.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped scenario as verified through a different one.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with the sshd harness` starts with `Preconditions:` and pairs each behavior with the scenario and observable result.
4. `Gotchas` lists traps that can waste or invalidate a run.

## Features

- [Bash routing](./bash-routing.md) covers remote commands, quoting, exit codes, output limits, timeouts, and cancellation.
- [File tools routing](./file-tools-routing.md) covers read, write, edit, find, grep, and ls on the remote filesystem.
- [Local override](./local-override.md) covers `host="local"` under a remote default and the local full-output artifact rule.
- [Remote working directory](./remote-cwd.md) covers per-call and configured remote cwd, plus home-relative paths.
- [Target visibility](./target-visibility.md) covers the `/ssh` command and the footer status. The unit suite and a real pi launch carry this proof, not the sshd harness.
