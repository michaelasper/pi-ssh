# Local override

The local override keeps one call on the machine running pi while the session default points at an SSH host, by passing `host="local"`.

## Sub-features

- `local-override-bash` runs a command locally under a remote default.
- `local-override-files` keeps all six file tools local under a remote default.
- `local-artifact-read` reads a bash full-output file, which is always local, from a remote-default session.

## How to get to it (user POV)

- Start pi with `--ssh-host <alias>` and ask for one file or command on the local machine.
- Ask pi to open the full output of a truncated remote command.

## Driving it with the sshd harness

Preconditions:

- `npm run test:e2e` reaches either scenario in `test/ssh.e2e.ts`.

- **Bash override.** The bash scenario runs `printf pi-ssh-local` with `host: 'local'` under a remote default. The output returns and `pwd` in the fake-SSH unit suite stays in the local session directory.
- **File override.** The file scenario writes, edits, reads, finds, greps, and lists a local file under a remote default. A remote check afterward proves no file with that name exists on the server side.
- **Artifact read.** The file scenario produces a 60,000-byte remote command, then reads the reported full-output path with `host: 'local'`. The read returns the first-line truncation notice from the local file.
- **Proof.** Both scenarios pass. The local file bytes and the remote absence check are the observable state.

## Gotchas

- Omitting `host` under a remote default targets the remote machine. Only the literal value `local` forces local execution.
- Reading a full-output artifact without the override reads the remote filesystem and fails or, worse, finds an unrelated file. Checks must pin `host: 'local'` for artifacts.
- User-typed `!` commands stay local by design. They are not part of this feature and the suite does not drive them.
