# Implementation and verification plan

## Current scope: host-aware file tools

Extend the existing SSH bash override to `read`, `write`, `edit`, `find`, `grep` and `ls` using public pi 0.85.1 APIs. This plan records requirements and verification work, not completion evidence. Actual results and coverage limits belong in [docs/verification.md](docs/verification.md).

### Routing and paths

- All seven tools accept optional `host`. An explicit SSH target overrides the configured host; `host="local"` always selects native local execution. Omitted host follows `--ssh-host` / `PI_SSH_HOST`, otherwise local.
- **Breaking change:** with an SSH default, omitted-host file calls now access or modify the remote filesystem. Prominently document migration for prompts and integrations that assumed file tools were always local.
- Add only `host` to file-tool arguments, not per-call `cwd`. Preserve every native file argument. Bash retains its existing remote-only absolute `cwd` override.
- Local paths use the live session cwd. Remote relative paths use `--ssh-cwd` / `PI_SSH_CWD`, or the remote login directory. The configured remote cwd applies to every SSH host, including explicit overrides. Absolute paths refer to the selected filesystem; `~/` uses the selected machine’s home, never the local home for SSH.
- Handle native leading-`@`, Unicode-space and file-URI conveniences target-aware. Do not translate local project paths, mirror files or retain remote shell state.

### Native contracts and presentation

- Delegate all six local file tools to native pi. Reuse public native algorithms and operation adapters for remote read, write, edit and ls.
- Preserve read pagination, truncation and supported images; write parent-directory creation; edit multi-replacement validation against the original, non-overlap checks and actual result diffs; find/grep filtering and limits; ls ordering, dotfiles and limits.
- Match native fd/rg search semantics with dedicated adapters and public truncation helpers because grep has no spawn hook. Do not silently replace the search engine or download remote utilities.
- Preserve native result shapes, details and rendering. Disable native local edit previews for remote calls so rendering does not read local user files; show the actual remote result diff.
- Show target and remote directory in headers without changing arguments. Mark omitted configuration as “current default”; restored transcripts do not durably record historical targets for omitted fields.
- Update extension-owned prompt guidance for all seven tools. Bash full-output artifacts remain **local**, and their read calls require `host="local"`. Unrelated extension tools and user-entered `!` / `!!` commands remain local.

### Transport and safety boundaries

- Reuse existing configuration precedence, host validation, OpenSSH configuration, `BatchMode=yes`, `StrictHostKeyChecking=yes` and connection timeout. CLI flags override matching environment variables; the default connection timeout remains 10 seconds. Do not provision credentials or alter security settings.
- Keep existing bash behaviour, local shell settings with project-trust filtering, streaming, timeouts and cancellation. Do not explicitly forward local session environment to remote operations.
- Remote prerequisites: Bash, a POSIX-compatible login shell, Python 3.9+ on `PATH`, fd/fdfind for find and rg for grep. Search lookup checks remote `PATH`, `/opt/homebrew/bin`, `/usr/local/bin`, then the remote `~/.pi/agent/bin`. No remote pi/Node installation is required.
- File helpers are one-shot Python scripts passed on the SSH command line with JSON requests over stdin. Paths, contents and patterns are data, not interpolated shell commands. No persistent helper files, remote service or file mirroring.
- SSH, configuration and protocol errors fail closed. Never route failed remote work locally. Surface actionable missing-utility errors; the extension never installs software automatically.
- Canonicalise mutation paths remotely and queue extension-owned write/edit operations by literal SSH target plus canonical path and existing device/inode identity, covering the full read–modify–write window. Stable symlink and hard-link aliases on one target share a queue; different target strings stay distinct. This is not an external-editor lock, transaction or rollback facility.
- Preserve cancellation: read/search cancellation terminates the local SSH process tree, without promising to stop arbitrary remote descendants. An active mkdir/write finishes before cancellation releases the queue, like native local filesystem mutation. Connection failures may leave partial side effects. An unacknowledged mutation blocks further writes/edits of the reserved path/inode until restart; inspect the file and confirm the old operation has stopped before restarting and retrying.
- Document resource limits honestly: remote read loads the whole file before native pagination, images and truncation. The stdout protocol buffers complete responses, so memory can grow despite bounded tool output. This is not network-streamed file reading.

### Exclusions

No pi-core changes, new remote shell tool, unrelated extension-tool routing, file synchronisation, persistent remote service, automatic software installation, credential provisioning, or publishing/releasing as part of this work.

## Milestones and required evidence

1. **Shared routing and remote infrastructure:** tests for configuration precedence, selected-machine path/home handling, safe transport, cancellation, failures and host-aware canonical-path mutation serialisation.
2. **Read/write/edit:** native local compatibility and remote text/image reads, pagination, truncation, parent creation, multi-replacement validation and diff/patch details.
3. **Find/grep/ls:** local/default/explicit remote routes, native filtering and limits, missing utilities and errors, special-character paths and local isolation.
4. **Integration and documentation:** seven-tool target presentation and prompt guidance; migration and local artifact examples; successful `npm run check`, `npm run test:package` and authorised opt-in real-SSH tests with cleanup evidence.

Do not treat a requirement listed here as a passed test. Keep unrun or blocked verification explicit.

## Evidence plan

Use Node’s test runner with TypeScript stripping, strict TypeScript checks, unit tests and mocked SSH transport without model credentials or an SSH server. Local Python 3.9+, fd/fdfind and rg are required for helper and native-comparison tests. Preserve relevant bash regressions alongside the six file-tool schemas and route matrices.

Run opt-in real SSH coverage with `PI_SSH_TEST_HOST` against an authorised target using isolated remote and local temporary fixtures. Exercise all six file operations, explicit/default/local routing, quoting, paths, image and text contracts, mutation sequencing, errors, limits and local isolation. Verify remote fixture cleanup; report connection loss or unavailable prerequisites rather than claiming an unrun scenario passed. Do not install software or weaken SSH settings to make a check pass without separate authorisation.

Run `npm run check` and `npm run test:package`. Inspect package contents for the helper sources and all seven live schemas, without publishing. Re-read current documentation and extension-owned guidance for obsolete claims that file tools stay local. Record commands, actual outcomes and coverage limits in `docs/verification.md`; keep private target names, credentials, raw logs and transcripts in ignored local artifacts, not public docs or package contents.

The existing local bash benchmark and isolated model-usability runner remain available. Their historical results and bash-only scenarios are not evidence of remote file performance or model comprehension of file-tool routing.

## Historical bash-only implementation

The original plan overrode only bash, leaving file tools and `!` / `!!` local. Its five milestones covered contract/prerequisites, test-first routing and SSH integration, real SSH and performance, isolated model usability, and documentation/package checks. Its pre-publication closeout is historical, not completion of the current file-tool work.

[docs/verification.md](docs/verification.md) retains the recorded initial results, subsequent distribution notes and coverage limits. In particular, the npm `0.1.1` distribution retained the original bash-only implementation. The [release guide](docs/releasing.md) remains maintainer reference; it does not authorise publication of this extension work.
