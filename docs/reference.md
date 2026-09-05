# Tool and configuration reference

## Compatibility

Tested against `@earendil-works/pi-coding-agent` 0.85.1. The extension uses the public `createBashToolDefinition` API; older versions without that export are unsupported. Peer dependencies use `*` as required by pi package conventions, not as a claim that every pi version works.

Local requirements: Node.js 22.18+, Bash and OpenSSH on macOS or Linux. Remote requirements: Bash on `PATH`, a POSIX-compatible login shell and non-interactive SSH authentication. Windows is not verified. Each remote command starts a fresh `bash -c` process, not an interactive or login Bash session.

## bash arguments

| Argument | Type | Meaning |
| --- | --- | --- |
| `command` | Required string | Bash command or script; expanded on the selected machine. |
| `timeout` | Optional number | Whole local invocation timeout in seconds. No default. Must be finite, positive and at most 2,147,483.647, following pi. |
| `host` | Optional string | SSH alias, hostname, IPv4/IPv6 address or `user@host`. Omitted: configured default. Reserved value `local`: force local execution. |
| `cwd` | Optional string | Absolute POSIX directory for a remote call only. Overrides configured remote cwd. |

```json
{"command": "git status --short", "host": "build", "cwd": "/srv/project", "timeout": 30}
```

A per-call `cwd` on a local call is an error; local commands can contain `cd`. Paths are literal: spaces and quotes work, but `~`, `$HOME` and shell substitutions are not expanded in `cwd`. Control characters are rejected. The configured remote cwd applies to every remote host, including explicit overrides.

Accepted host names use ASCII letters, digits, `_`, `.` and `-`, with no leading `-` or `.`; valid IPv6 addresses are also accepted, including bracketed addresses. Optional usernames use the same ASCII characters and cannot begin with `-` or `.`. Whitespace, control characters, shell metacharacters, URLs and embedded ports/paths are rejected. `local` is reserved; use `user@local` or another alias to SSH to a host actually named `local`.

## Configuration

| CLI flag | Environment variable | Default |
| --- | --- | --- |
| `--ssh-host` | `PI_SSH_HOST` | `local` |
| `--ssh-cwd` | `PI_SSH_CWD` | Unset: remote login directory |
| `--ssh-connect-timeout` | `PI_SSH_CONNECT_TIMEOUT` | `10` seconds |

Precedence, highest first:

1. Per-call `host` / `cwd` for that field.
2. CLI flag.
3. Environment variable.
4. Built-in default.

Empty environment values are treated as unset. Empty CLI values are invalid. Connection timeout is decimal integer seconds from 1 to 2,147,483,647; it is not the bash command timeout. Configuration is read after CLI flags become available, on `session_start`, and remains fixed until another session start or reload. There is no pi-ssh-specific configuration file. Existing pi shell settings are loaded with pi’s project-trust filtering.

Invalid startup configuration blocks all bash calls. Per-call arguments do not bypass a configuration error. The system prompt identifies the active default or configuration error before each agent turn.

## SSH invocation

The local Bash process is replaced with one `ssh` client through `exec`. Its arguments include:

```text
-T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=<seconds> -- <host> <remote-script>
```

SSH receives no interactive input. Both shell boundaries are quoted. The remote script invokes `bash -c`; when `cwd` is set, a failed `cd` exits before any user command runs.

Normal OpenSSH configuration supplies identities, ports, proxies and multiplexing. The extension does not modify that configuration or provision credentials. It does not explicitly forward environment variables; SSH `SendEnv` / `SetEnv`, server policy and remote startup files may still affect the remote environment. Remote calls remove pi’s injected session metadata from the local client environment; they do not copy the local project or environment to the remote.

## Results and errors

Results and streaming use pi’s native bash machinery and result shape. Output combines stdout and stderr; ordering between streams is not guaranteed. The retained tail is bounded to 2,000 lines or 50 KiB. Full truncated output is stored in a local temporary file, whose size can grow with total output.

Non-zero exits are tool errors containing output and an exit-code notice. SSH typically uses code 255 for transport errors; a remote program can also exit 255, so that code alone does not identify the cause. Timeout and cancellation are errors, not successful empty output. Their cleanup scope is the local process tree, not arbitrary remote descendants.

## Tool header

The tool header includes a presentation-only target and remote-directory annotation above the original command. The annotation is not executed. Omitted fields are marked “current default”: on a restored transcript they reflect the currently loaded configuration, not a durable record of the historical target. Explicit per-call `host` and `cwd` are retained in the recorded arguments.

## Local compatibility

`read`, `write`, `edit`, other file tools and user-entered `!` / `!!` commands remain local. Local calls use the live session cwd and pi’s session environment. There is no persistent remote cwd or shell state between calls.

Local calls inherit pi’s file-backed `shellPath` and `shellCommandPrefix` settings at session start, including trusted project overrides. Untrusted project shell settings are ignored. These settings never apply to remote calls; put remote setup in `command`. SDK-only in-memory settings overrides and another extension’s bash implementation are not inherited. The extension adds no permission prompts or host allowlist. It is not a security sandbox.
