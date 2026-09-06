# Develop and verify pi-ssh

Run development commands from a repository checkout, not an installed package. The package includes source and documentation; tests and development scripts stay in the repository. This guide describes how to run checks, not evidence that they passed. Record actual commands, outcomes, prerequisites and coverage limits in [verification](verification.md); historical bash-only results do not verify the file-tool extension.

## Run the offline checks

```bash
npm ci
npm run check
npm pack --dry-run
```

`npm run check` runs `npm test` and strict TypeScript checks. `npm test` uses Node’s test runner with native TypeScript stripping. It requires no model credentials or SSH server, but the file-helper and search tests need **local Python 3.9+, fd/fdfind and rg**. Provision those explicitly before running the suite; native differential tests need an executable named `fd`, so provide a temporary `fd` symlink when your distribution calls it `fdfind`. Dependency installation with `npm ci` requires registry access unless cached. The CI and release-verification jobs explicitly provision these local test utilities; this is separate from runtime behaviour, which never installs remote prerequisites.

Unit and mocked-transport coverage includes:

- All six file schemas add only optional `host`; native arguments and local delegation use the live session cwd.
- Default, explicit remote and explicit local routing; CLI/environment precedence, invalid configuration and startup guidance for all seven tools.
- Target-aware relative, absolute, home, leading-`@`, Unicode-space and file-URI paths; quoting and literal file contents across transport boundaries.
- Text pagination, byte/line limits, image handling, write parent creation, multi-replacement edit validation and native diff/patch details.
- Find/grep parity with native fd/rg semantics, ignore rules, filters, limits and errors; ls sorting, dotfiles and limits.
- Host-aware write/edit serialisation, canonical paths, symlink/hard-link aliases, cancellation, unavailable utilities and SSH/protocol failures without local fallback. Unacknowledged mutations block subsequent mutations of the same path/inode while allowing inspection.
- Target headers and native rendering compatibility, including no local edit-preview reads for remote calls.

Mock SSH fixtures run helpers against isolated local directories. They test the protocol and routing but do not establish real network, authentication or server behaviour.

For changes, add a failing behavioural test first, run it, implement the smallest change, and rerun the full suite plus type checks. Keep actual red/green output in ignored `.artifacts/`. Do not commit raw sessions, credentials or private machine names.

## Check a real SSH server

Choose a machine you are authorised to test. It needs Bash, a POSIX-compatible login shell, Python 3.9+ on `PATH`, fd/fdfind and rg in the [supported lookup locations](reference.md#compatibility). Confirm key authentication and the host fingerprint outside pi. Missing prerequisites are blockers to resolve explicitly, not permission to install software or change SSH security settings automatically:

```bash
PI_SSH_TEST_HOST=developer@build npm run test:ssh
```

`PI_SSH_TEST_HOST` is mandatory; the test is intentionally opt-in. It uses normal SSH configuration with batch authentication, strict host-key checking and the configured connection timeout. Fixtures use isolated remote `/tmp/pi-ssh-e2e.*` and `/tmp/pi-ssh-files.*` directories plus a separate local temporary directory. Cleanup runs in `finally` and checks removal of the remote fixtures.

The bash scenario exercises quoting, directory selection, errors, routing, output truncation, timeout and cancellation. The file-tool scenario exercises all six tools through default and explicit remote routes and explicit local overrides, verifies local/remote isolation, and covers native read/edit/search/list contracts, special-character paths, home and cwd handling, parent creation, images, output limits, canonical-path mutation serialisation, errors and pre-aborted mutation. It also reads a remote bash command’s **local** overflow artifact with `host="local"`.

Bash sleeps are bounded to three seconds because disconnecting cannot guarantee remote descendant termination. In-flight mutation cancellation is covered separately by mocked-transport tests; do not infer a rollback or external-editor lock from a successful real-host run.

If the connection is lost before cleanup can finish, inspect and remove the reported test directory yourself. The test reports failure rather than claiming cleanup succeeded. Record unavailable targets or utilities, unrun scenarios and incomplete cleanup as coverage limits, not passes. Keep private hostnames and raw output out of public evidence.

## Measure local overhead

```bash
npm run bench
```

The benchmark alternates built-in and wrapped local `:` commands, discards ten warm-up calls per implementation, and reports median and p95 for 100 measured calls each. It separately times 100,000 SSH command constructions. Results are observational; compare repeated runs on the same machine rather than applying a universal threshold. This measures the bash wrapper, not file-tool throughput, full-file buffering or remote network performance.

## Test model usability in isolated pi sessions

This opt-in test makes real model requests and can incur charges. It requires Python 3, the `pi` CLI, existing `openai-codex` authentication and access to `gpt-5.6-luna`:

```bash
PI_SSH_TEST_HOST=developer@build python3 scripts/model-usability.py
```

The runner starts two independent pi processes in fresh temporary working and agent directories. It copies only the selected provider’s credential entry into a mode-0600 temporary auth file, not your settings or session history. The temporary copy is deleted afterwards; authentication refreshes in that copy are not written back to the original file.

Discovery of unrelated extensions, skills, templates, themes and context files is disabled. Only pi-ssh and a test-only safety gate load. The gate allows exactly the three harmless probe commands, caps tool attempts and adds a ten-second command timeout. Each process has a 120-second deadline. This is test isolation, not an OS sandbox; SSH still uses your normal local configuration and agent.

The two prompts differ only in whether they name the SSH target or refer to the configured default. They request a remote success, an intentional remote exit 7 and an explicit local success, without teaching argument names. The runner verifies the actual model identifier, tool arguments, outputs, error flags and final report. It does not silently substitute another model.

Raw prompts, events and stderr are written under ignored `.artifacts/model-usability/`. Inspect them locally; publish only sanitised summaries. These existing scenarios exercise bash only, not model comprehension of the six new file schemas. A passing scenario is narrow evidence of tool comprehension, not a general model capability benchmark.

## Check packaging

```bash
npm pack --dry-run --json
npm run test:package
```

The smoke test needs local Python 3.12+ and registry access for installation/audit; this is separate from the remote helper’s Python 3.9+ requirement. `npm run test:package` uses the development pi CLI from `node_modules/.bin`. It packs the source, performs a normal production-only install in a temporary directory, rejects install warnings or duplicate dependencies, runs a production audit, registers that package in isolated pi settings, and checks all seven live host-aware schemas at session startup without making a model request. It checks that only bash has a `cwd` argument.

Inspect the file list: `src/` (including the one-shot Python helpers), `README.md`, `LICENSE`, `docs/` and package metadata belong in the package; `.pi/`, `.artifacts/`, credentials, tests and local dependencies do not. Test `pi install /absolute/path/to/checkout` with a temporary `PI_CODING_AGENT_DIR` rather than modifying personal settings. Do not publish or push as part of verification.

For maintainer-only OIDC staging, npm approval and pi.dev catalog discovery, see [the release guide](releasing.md).

## Dependency security

```bash
npm outdated
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
```

The CI audit gates include all advisory severities. Core pi imports are optional `*` peers, not bundled dependencies. There are no third-party runtime dependencies, installation hooks or build steps in the distributed extension.

npm 12’s `allowScripts` policy explicitly denies the reviewed, unnecessary development install hooks for `@google/genai` (a no-op), `protobufjs` (a dependency-version warning) and `esbuild` (binary preparation; platform binaries are already optional dependencies). Historical dependency-check results are recorded in [verification](verification.md); rerun the checks for current changes rather than assuming those results still apply. npm’s audit is not disabled. Older npm releases do not enforce this policy; it is not a sandbox.

A clean development install may emit an upstream `node-domexception@1.0.0` deprecation notice through pi’s Google provider dependency chain. This is not a vulnerability advisory and does not affect the dependency-free production install. Do not force incompatible transitive overrides merely to hide that notice.
