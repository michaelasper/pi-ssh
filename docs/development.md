# Develop and verify pi-ssh

Run development commands from a repository checkout, not an installed package. The published package includes source and documentation; tests and development scripts stay in the repository.

## Run the offline checks

```bash
npm ci
npm run check
npm pack --dry-run
```

`npm test` uses Node’s test runner with native TypeScript stripping. It requires no model credentials or SSH server. Tests cover configuration precedence and rejection, both quoting boundaries, local compatibility, simulated SSH execution, output limits, errors, timeout, cancellation and extension startup.

For changes, add a failing behavioural test first, run it, implement the smallest change, and rerun the full suite plus type checks. Keep actual red/green output in ignored `.artifacts/`. Do not commit raw sessions, credentials or private machine names.

## Check a real SSH server

Choose a machine you are authorised to test:

```bash
PI_SSH_TEST_HOST=developer@build npm run test:ssh
```

This opt-in test uses key authentication and strict host-key checking. It creates an isolated `/tmp/pi-ssh-e2e.*` directory remotely, removes it in `finally`, and verifies removal. It exercises quoting, directory selection, errors, local and explicit remote overrides, output truncation, timeout and cancellation. Sleeps are bounded to three seconds because disconnecting cannot guarantee remote process termination.

If the connection is lost before cleanup can finish, inspect and remove the test directory yourself. The test reports failure rather than claiming cleanup succeeded.

## Measure local overhead

```bash
npm run bench
```

The benchmark alternates built-in and wrapped local `:` commands, discards ten warm-up calls per implementation, and reports median and p95 for 100 measured calls each. It separately times 100,000 SSH command constructions. Results are observational; compare repeated runs on the same machine rather than applying a universal threshold.

## Test model usability in isolated pi sessions

This opt-in test makes real model requests and can incur charges. It requires Python 3, the `pi` CLI, existing `openai-codex` authentication and access to `gpt-5.6-luna`:

```bash
PI_SSH_TEST_HOST=developer@build python3 scripts/model-usability.py
```

The runner starts two independent pi processes in fresh temporary working and agent directories. It copies only the selected provider’s credential entry into a mode-0600 temporary auth file, not your settings or session history. The temporary copy is deleted afterwards; authentication refreshes in that copy are not written back to the original file.

Discovery of unrelated extensions, skills, templates, themes and context files is disabled. Only pi-ssh and a test-only safety gate load. The gate allows exactly the three harmless probe commands, caps tool attempts and adds a ten-second command timeout. Each process has a 120-second deadline. This is test isolation, not an OS sandbox; SSH still uses your normal local configuration and agent.

The two prompts differ only in whether they name the SSH target or refer to the configured default. They request a remote success, an intentional remote exit 7 and an explicit local success, without teaching argument names. The runner verifies the actual model identifier, tool arguments, outputs, error flags and final report. It does not silently substitute another model.

Raw prompts, events and stderr are written under ignored `.artifacts/model-usability/`. Inspect them locally; publish only sanitised summaries. A passing scenario is narrow evidence of tool comprehension, not a general model capability benchmark.

## Check packaging

```bash
npm pack --dry-run --json
python3 scripts/package-smoke.py
```

The smoke test needs Python 3.12+ and the `pi` CLI. It packs the source, installs production-only dependencies in a temporary directory, registers that package in isolated pi settings, and checks the live bash schema at session startup without making a model request.

Inspect the file list: `src/`, `README.md`, `docs/` and package metadata belong in the package; `.pi/`, `.artifacts/`, credentials, tests and local dependencies do not. Test `pi install /absolute/path/to/checkout` with a temporary `PI_CODING_AGENT_DIR` rather than modifying personal settings. Do not publish or push as part of verification.
