# Verification results

These are observations from development of version 0.1.0, not cross-platform or model reliability guarantees. Private target names, local paths and raw transcripts are excluded.

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

## Coverage limits

- Real execution was verified from macOS, not Windows. IPv6 syntax is unit-tested; an IPv6 server was not used.
- Interactive authentication, persistent shell state, file synchronisation and remote job supervision are deliberately absent.
- The output tail is bounded by pi; full-output files remain disk-backed and can grow with total command output.
- A public repository or registry release is not created by these checks.
