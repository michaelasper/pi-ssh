# Remote working directory

The remote working directory decides where relative paths land on the SSH host. Bash accepts a per-call absolute `cwd`. Every tool honors the configured `--ssh-cwd` default. Without either, relative paths start in the remote login directory.

## Sub-features

- `cwd-per-call` runs bash in the absolute directory named in the call.
- `cwd-configured` anchors relative file paths at the configured remote directory.
- `cwd-login-default` anchors relative paths at the remote login directory when nothing is configured.
- `cwd-missing` stops the command when the per-call directory does not exist.
- `cwd-home` expands `~/` against the remote account home, never the local home.

## How to get to it (user POV)

- Start pi with `--ssh-host <alias> --ssh-cwd /srv/project` and use relative paths.
- Ask for one bash command in a different remote directory.
- Refer to a remote file with a `~/` path.

## Driving it with the sshd harness

Preconditions:

- `npm run test:e2e` reaches either scenario in `test/ssh.e2e.ts`.

- **Per-call cwd.** The bash scenario creates a directory whose name contains spaces, a quote, and a dollar sign, then runs `pwd` with that `cwd`. The output is the directory path exactly.
- **Missing cwd.** The bash scenario passes a nonexistent `cwd` with a command that prints a marker. The result is an error result with code 1 and no marker in the output.
- **Configured cwd.** The file scenario builds its tools with a configured remote cwd and works through relative paths only. Every result lands inside the fixture directory.
- **Login default and home.** The file scenario reads the same file through a `~/` path and through tools with no configured cwd. Both reads return the edited contents.
- **Proof.** Both scenarios pass. The `pwd` output and the two home-relative reads are the observable state.

## Gotchas

- The configured remote cwd applies to every SSH host, including a host named per call. A check that assumes per-host directories will misread correct behavior.
- File tools take no per-call cwd. Passing one is an error by design. Use the `path` argument instead.
- On the loopback harness the remote account is the local user, so the remote home and the local home coincide. The scenario still proves expansion happens on the server side, because the local process never sees the expanded path. Distinct-machine proof needs an authorized external host.
