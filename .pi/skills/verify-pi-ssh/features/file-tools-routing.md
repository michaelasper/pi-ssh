# File tools routing

File tools routing reads, writes, edits, finds, greps, and lists files on the SSH host with the same arguments and results as the local tools, plus an optional `host`.

## Sub-features

- `file-write-read` writes a file remotely and reads the same bytes back.
- `file-edit` applies multiple replacements and returns a diff and a patch.
- `file-find-grep-ls` searches and lists the remote tree with native limits.
- `file-hostile-path` handles spaces, quotes, dollar signs, and Unicode in remote names as data.
- `file-image` returns a remote PNG as an image result.
- `file-alias-queue` serializes concurrent edits through symlink and hard-link aliases.
- `file-errors` surfaces missing files and rejected edits without changing remote content.

## How to get to it (user POV)

- Ask pi to read or change a file on a named SSH host.
- Start pi with `--ssh-host <alias>` and `--ssh-cwd <dir>`, then work with relative paths.
- Ask pi to search a remote project with find or grep.

## Driving it with the sshd harness

Preconditions:

- `npm run test:e2e` reaches the scenario named `real SSH file tools: all routes, native contracts, host-local isolation and cleanup`.
- Python 3.9 or newer, `fd`, and `rg` resolve through the forwarded `PATH`.

- **Both routes.** The scenario runs all six tools twice, once under a remote default and once with the host named per call. A local file with the same name holds different bytes throughout and never changes.
- **Edit contract.** A two-block edit returns a diff that names the file the user passed, not an internal path. An overlapping edit fails and writes nothing.
- **Hostile path.** A file under a directory with spaces, quotes, and shell substitution syntax round-trips. No file named from the substitution appears.
- **Alias queue.** Concurrent edits through a symlink, then a write and edit through a hard link, all land. A final read shows both changes.
- **Limits and image.** A 2,200-line file truncates on read. Grep, find, and ls report their limit fields. A remote PNG returns an image content block.
- **Proof.** The scenario passes, then a fresh SSH call confirms the remote fixture directory is gone.

## Gotchas

- The remote side needs Python 3.9 or newer for every file tool, plus `fd` for find and `rg` for grep. Missing utilities are errors. They never fall back to local execution.
- A read with an offset past the end of the file is an error, not an empty result.
- Concurrent same-file edits only pass because the extension queues them by canonical path and inode. Running the calls in the wrong order in a hand-written check can look like a failure of the queue when it is a failure of the check.
