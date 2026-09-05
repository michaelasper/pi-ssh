# Implementation and verification plan

## Contract

- Override only the model-callable `bash` tool. `!` / `!!` and file tools stay local.
- Add `host?: string` and `cwd?: string`. Reserve `host: "local"` as the explicit local override. Omitted host uses the configured default, otherwise local. `cwd` is remote-only and must be an absolute POSIX path; omission uses the configured remote cwd or the remote login directory. No persistent remote shell state.
- Configuration: `--ssh-host`, `--ssh-cwd`, `--ssh-connect-timeout`, with matching `PI_SSH_HOST`, `PI_SSH_CWD`, `PI_SSH_CONNECT_TIMEOUT` environment variables. CLI wins over environment. Default connection timeout: 10 seconds. SSH config handles identity, port, proxy, and optional multiplexing. No new config file format.
- Strict host validation excludes option injection, whitespace, shell metacharacters, URLs, and embedded ports/paths. SSH aliases, user@host, and IPv6 are supported.
- Reuse `createBashToolDefinition` and its process backend, streaming, truncation, timeout, cancellation, and result shape. Local calls inherit existing pi file-backed shell settings with project-trust filtering; those settings never apply remotely. Tool headers show target/cwd annotations without mutating commands. A remote spawn hook replaces the local shell with `exec ssh` using quoted argv and a quoted remote `bash -c` script. One SSH client per call; no daemon, startup probes, or output copies.
- Enforce non-interactive SSH and known host keys. Remote Bash and a POSIX-compatible login shell are prerequisites. Never forward session environment explicitly. Cancellation kills the local client, not necessarily all remote descendants.
- Configuration errors must fail closed, not silently route a remote-intended command locally. The model must see the active default and know other tools remain local.

## Evidence plan

Use Node's test runner with TypeScript stripping, strict TypeScript checks, and deterministic tests that run without network/authentication. Record actual red/green test outputs in ignored `.artifacts/`, with a concise public verification summary. Add opt-in real SSH tests, a small benchmark, and a reproducible isolated pi model-session runner. Keep private hostnames and raw transcripts out of the package and public evidence.

## Prerequisites checked

- Installed pi: 0.85.1; matching npm version available.
- Read complete extension, package, and environment-variable documentation, plus SSH/tool-override examples and the installed bash implementation.
- SSH preflight succeeded with BatchMode, strict host-key checks, and a 10-second connection timeout; remote Bash is available.
- Requested model resolved from pi's available catalog to `openai-codex/gpt-5.6-luna`. Actual authenticated execution remains to be verified.

## Milestones

1. Contract and prerequisites.
2. Red–green–refactor: routing/configuration; SSH command construction; tool integration and errors; extension lifecycle.
3. Real SSH behavior and performance.
4. Isolated requested-model usability scenarios.
5. Diataxis documentation, package-install smoke test, privacy and final checks.

## Initial implementation closeout (before publication)

All five milestones are implemented. `docs/verification.md` maps test-first increments, review fixes, SSH behaviour, model comprehension, performance and package checks to recorded results. Final offline suite: 15 passing tests on Node.js 26.1.0 and 22.18.0; strict TypeScript checks pass. Real SSH, isolated requested-model scenarios and production package installation were rerun after the review fixes. No publication or push was performed.
