# Verification results

## Release preparation: 0.2.0

After updating version metadata and release documentation:

| Command | Outcome |
| --- | --- |
| `npm run check` | All 53 tests passed, with no failures or skips; strict TypeScript checks passed. |
| `npm run test:package` | The 21-file production tarball passed isolated pi installation and startup; all seven host-aware schemas registered; zero installed production dependencies and zero audit findings. |
| `npm audit --audit-level=low` and `npm audit --omit=dev --audit-level=low` | Both reported zero vulnerabilities. |
| `PI_SSH_TEST_HOST=<authorised-target> npm run test:ssh` | Both scenarios failed at their initial connection because the previously authorised host was unreachable (SSH connection timeout). No test fixtures were created. This release-time rerun does not supersede the earlier successful SSH evidence below. |

Before release preparation, live calls through the installed extension also passed for all six file tools on the authorised remote and locally, including special-character paths, pagination, multi-block edits, a remote PNG read, rejected edits without modification and host isolation. One local read overlapped an edit and failed; a sequential retry passed. All live-test fixtures were removed. No feature implementation changed between those successful checks and release preparation.

Local release logs are retained in ignored `.artifacts/release-0.2.0-{check,package,audit,ssh}.log`. These checks do not establish npm staging or public publication. Consult the [release workflow](https://github.com/michaelasper/pi-ssh/actions/workflows/publish.yml) for hosted verification and staging outcomes; npm still requires maintainer approval.

## Host-aware file tools: implementation verification

The current source adds `host` to read, write, edit, find, grep and ls. These observations are from macOS with Node.js 26.1.0 and pi 0.85.1; they are not cross-platform or model-reliability guarantees. Private target names, fixture paths and raw transcripts are excluded.

Recorded commands:

| Command | Outcome |
| --- | --- |
| `npm run check` | 53 tests passed; zero failed, cancelled or skipped; strict TypeScript checks passed. |
| `npm run test:package` | Production tarball passed isolated pi installation and startup; all seven host-aware schemas registered; both Python helpers included; zero installed production dependencies and zero production audit findings. |
| `PI_SSH_TEST_HOST=<authorised-target> npm run test:ssh` | Both opt-in scenarios passed: existing bash behaviour and all six file tools. Temporary local and remote fixtures were removed and remote removal was asserted. |

The real target was explicitly authorised. Python 3.9.6 and ripgrep 15.2.0 were already installed there. With separate user authorisation, Homebrew installed fd 10.5.0. The extension itself never installs prerequisites. No SSH security, credentials, shell profile or global `PATH` settings were changed; the search helpers found the Homebrew executables through their documented fallback locations. No remote pi installation, persistent helper or file mirror was created.

Coverage includes:

- Six schemas add only optional `host`; native local results and live session cwd; configuration precedence and errors blocking all seven tools.
- Default and explicit remote execution, explicit local override for every tool, configured remote cwd, remote login cwd, absolute paths, selected-machine home expansion, `@`, file URLs, Unicode-space and screenshot conveniences, symlink canonicalisation, special-character paths and literal contents over stdin.
- Native read pagination, line and byte truncation, image results and signature parity for JPEG, PNG, GIF, WebP and BMP (including malformed headers and animated-PNG exclusions). Real SSH image execution used PNG; other formats have local differential signature coverage.
- Native edit multi-replacement matching against the original, overlap/non-unique/missing-match rejection without writing, BOM/CRLF preservation, diffs and unified patches. Concurrent edit/edit and write/edit calls sharing remote symlink or hard-link aliases retain both changes. Queue tests distinguish hosts and unrelated files and recover after acknowledged failures and cancellation. An unacknowledged mutation transport failure blocks queued and future mutations of the affected path/inode until pi restarts; reads remain available for inspection.
- Find and grep differential coverage for ignore rules, nested repositories, glob/regex handling, case/literal flags, context, result limits and byte limits; ls sorting, hidden files, symlinks, skipped stat failures and entry limits. Search output has no artificial 2,000-line cap. Intentional safety differences: remote find uses NUL framing instead of trimming/splitting filenames, and remote grep preserves Unicode line separators in JSON records and rejects malformed utility output rather than silently discarding it.
- Mocked SSH authentication failure, malformed protocol output, missing Python/search utilities, pre-aborted and active cancellation, bounded stderr and subprocess cleanup. Active writes settle before cancellation releases the mutation queue. Real SSH includes existing bash timeout/active-cancellation checks and pre-aborted file mutation.
- Target headers at narrow and wide widths, native result rendering and prevention of local edit previews for remote targets, including a streamed host override arriving after an initial local-default header. A local overflow artifact from remote bash is read with `host="local"`.

Current README, tutorial, how-to, reference, explanation, development and plan guidance were re-read. A source/docs scan found no obsolete guidance claiming that only bash can run remotely; historical bash-only records remain explicitly labelled. The CI workflows now explicitly provision local Python/fd/rg test prerequisites; both YAML files parsed successfully and `git diff --check` passed. No hosted workflow was triggered as part of that implementation verification.

Coverage limits: Windows, the hosted CI matrix and Linux-to-remote execution were not run in this record. There is no multiprocess/external-editor locking, transactional rollback or guarantee of terminating arbitrary remote descendants after disconnect. Complete file payloads and directory listings are buffered before native output limits; pagination is not a bounded-network-transfer promise. The existing model-comprehension and benchmark results below apply to the earlier bash-only implementation, not the new file tools. No release or publication was performed as part of that implementation verification.

Raw local logs are retained in ignored `.artifacts/file-tools-check.log`, `.artifacts/file-tools-focused.log`, `.artifacts/file-tools-ssh-e2e.log` and `.artifacts/file-tools-package.log` and `.artifacts/file-tools-guidance.log`.

## Historical bash-only verification

The following sections describe development and distribution of versions 0.1.0–0.1.2 before the file-tool extension. They are retained as historical evidence, not current file-tool coverage.

## Test-first development

| Increment | Observed red state | Observed green state |
| --- | --- | --- |
| Routing and configuration | New tests failed because the config module did not exist. | 5 tests passed. |
| SSH quoting and directory handling | New tests failed because the command builder did not exist. | 8 tests passed. |
| Tool integration | New tests failed because the tool module did not exist. | 11 tests and strict TypeScript checks passed after correcting test-fixture path canonicalisation and escaping. |
| Extension lifecycle | New tests failed because the entry point did not exist. | 13 tests and strict TypeScript checks passed. |
| Review: local settings | Regression test returned `unset:unset` instead of the configured prefix and shell marker. | 14 tests passed, including trusted/untrusted settings and no remote leakage. |
| Review: target visibility | Regression test rendered only `$ pwd`, without a target or cwd. | 15 tests passed, including non-mutating headers and wrapping at 40, 80 and 120 columns. |

The final 15-test suite and strict TypeScript checks pass. The suite also runs on the declared minimum Node.js version, **22.19.0**, using a temporary isolated Node installation.

Raw red/green logs are retained locally in ignored `.artifacts/01-*` through `.artifacts/06-*`. They are not package contents.

## Real SSH

The opt-in real-host test passed against an authorised SSH server using strict host-key verification. It checked explicit and default remote targeting, explicit local execution, literal quotes and Unicode, remote working directories, non-zero exits, prevention of commands after a failed `cd`, 60,000-byte output with a local full-output file, timeouts, active and pre-aborted cancellation, and remote temporary-directory removal.

The combined scenario took approximately 2.1 seconds, excluding test-runner startup. That is not a fresh-connection latency benchmark; existing SSH configuration can reuse connections. No persistent remote installation was made. Remote descendant termination is not guaranteed or claimed.

## Model comprehension

Two fresh isolated CLI sessions used **`openai-codex/gpt-5.6-luna`**, thinking level **low**, with pi **0.85.1**. Both passed initially and again after the review fixes, with three calls per scenario in each run:

| Scenario | Remote success | Intentional remote failure | Local success |
| --- | --- | --- | --- |
| Explicit SSH target in prompt | Named `host`, output `REMOTE_OK` | Same host, error containing exit 7 and `EXPECTED_FAILURE` | `host="local"`, output `LOCAL_OK` |
| Configured remote default | Omitted `host`, output `REMOTE_OK` | Omitted `host`, error containing exit 7 and `EXPECTED_FAILURE` | `host="local"`, output `LOCAL_OK` |

The prompt pattern was:

> Use the available bash tool to run exactly `printf 'REMOTE_OK\n'` on [SSH target / the configured default machine]. Then run exactly `printf 'EXPECTED_FAILURE\n' >&2; exit 7` on that same machine. That failure is intentional: do not retry or change it. Finally, on the LOCAL machine running pi, run exactly `printf 'LOCAL_OK\n'`. Do not run any other commands or inspect any files. Briefly report the three outcomes and where each ran.

Both final reports correctly distinguished remote success, intentional remote failure and local success. The default-host report was:

```text
- Remote: `REMOTE_OK` — succeeded.
- Remote: `EXPECTED_FAILURE` — exited with code 7 (intentional).
- Local: `LOCAL_OK` — succeeded.
```

A test-only gate restricted execution to those exact probe commands. These are constrained usability checks of the requested model, not evidence that arbitrary weaker models always route correctly or that the model can diagnose an unexpected transport failure.

## Performance

One run on macOS arm64, Node.js 26.1.0, pi 0.85.1:

| Local execution | Samples | Median | p95 |
| --- | ---: | ---: | ---: |
| Built-in bash | 100 | 1.494 ms | 1.624 ms |
| pi-ssh, local route | 100 | 1.490 ms | 1.595 ms |

SSH command construction averaged approximately **0.63 µs** over 100,000 iterations. The local medians differed by approximately **0.004 ms** in this run, within normal run-to-run noise; this is not evidence that the wrapper is faster. Scheduling noise and environment differences preclude a general overhead guarantee. No network acceleration is claimed.

## Packaging

A production tarball containing 12 allowlisted files passed an isolated `pi install` and live startup check. A normal `npm install --omit=dev` installed zero production dependencies and emitted no warnings, with zero production audit findings. The extended bash schema was present without development dependencies, legacy-peer flags or personal pi settings. Strict TypeScript checks also cover the real-host test and benchmark. The initial publication’s [six GitHub Actions jobs](https://github.com/michaelasper/pi-ssh/actions/runs/33984923551) passed on macOS and Linux with Node.js 22, 24 and 26.

The packaging review followed the upstream [pi package guidance](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md): explicit `pi.extensions`, the `pi-package` keyword, narrow published files, optional `*` peers supplied by pi, and no bundled core packages or build/install hooks.

## Dependency review before release

Registry `latest` versions checked: pi **0.85.1**, TypeBox **1.3.27**, TypeScript **7.0.2** and Node typings **26.4.1**. All are pinned for development; `npm outdated` reports no outdated direct dependencies. Both the complete dependency audit and production-only audit report **zero vulnerabilities**. GitHub Actions uses the latest checked checkout **v7.0.1** and setup-node **v7.0.0**, pinned to immutable commits, with audit gates for all severities.

A clean development install still reports the upstream `node-domexception@1.0.0` deprecation notice described in [development guidance](development.md#dependency-security). It is not a security advisory and is absent from production installs. No unsafe transitive override or disabled audit is used to conceal it. The minimum Node version was corrected to **22.19.0** to match pi’s declared engine requirement, and the 15-test suite passed on that exact version.

## npm distribution: 0.1.1

Version 0.1.1 introduces the scoped npm identity `@michaelasper/pi-ssh`; the bash implementation is unchanged from 0.1.0. The README and tutorial now start with npm installation, and the package includes public publish settings plus repository, homepage and issue-tracker metadata. The unscoped npm package is unrelated.

For this distribution, all 15 tests, strict TypeScript checks, both npm audits and the production tarball smoke test passed again. The smoke test handles scoped package names and verifies zero installed production dependencies and no installation warnings. Authentication material is not part of the repository or package.

## Next distribution: 0.1.2

The next version adds the MIT licence, a manifest/discovery regression test and a stage-only OIDC release workflow. All 16 tests, strict TypeScript checks and both npm audits pass. The production smoke test verifies the MIT licence in the 14-file tarball, zero installed production dependencies and no installation warnings.

The workflow separates verification from the OIDC staging job and never approves a release automatically. A verify-only workflow run is not evidence that npm accepted the trusted-publisher configuration; that requires a real staging run followed by maintainer approval. The [release guide](releasing.md) documents this boundary and the catalog requirements.

## Coverage limits

- Real execution was verified from macOS, not Windows. IPv6 syntax is unit-tested; an IPv6 server was not used.
- Interactive authentication, persistent shell state, file synchronisation and remote job supervision are deliberately absent.
- The output tail is bounded by pi; full-output files remain disk-backed and can grow with total command output.
- A public repository or registry release is not created by these checks.
