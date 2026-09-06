# Tool and configuration reference

This reference describes the host-aware file-tool implementation in version 0.2.0. It does not establish that these changes have been published or that a particular check has passed; recorded evidence belongs in [verification](verification.md).

## Package identity

- npm: `@michaelasper/pi-ssh` (public).
- GitHub: `michaelasper/pi-ssh`.
- pi entry point: `src/index.ts`, declared in `package.json` under `pi.extensions`.
- The unscoped npm name `pi-ssh` belongs to an unrelated project.
- Versions `0.1.x` support SSH for bash only, not the file-tool routing described here.

## Compatibility

The compatibility reference is `@earendil-works/pi-coding-agent` **0.85.1**. The extension uses public tool-definition factories, operation interfaces and truncation helpers, without pi-core changes or private imports. Local file calls delegate to all six native implementations. Remote `read`, `write`, `edit` and `ls` reuse native algorithms through operation adapters; remote `find` and `grep` match the native fd/rg behaviour with dedicated adapters and public truncation helpers. The native grep API has no spawn hook.

Peer dependencies use `*` as required by pi package conventions, not as a claim that every pi version works. They are optional peers because pi supplies them at runtime. The extension has no additional production npm dependencies. Exact development versions and the lockfile make contributor installs reproducible.

| Location / operation | Prerequisites |
| --- | --- |
| Local pi | Node.js 22.19+, Bash and OpenSSH on macOS or Linux; Windows is not verified. |
| All remote operations | Bash on `PATH`, a POSIX-compatible login shell and non-interactive SSH authentication. |
| Remote file tools | Python **3.9+**, available as `python3` on the remote `PATH`. |
| Remote `find` | `fd` or `fdfind`, in addition to the remote file-tool prerequisites. |
| Remote `grep` | ripgrep (`rg`), in addition to the remote file-tool prerequisites. |

Search utility lookup checks the remote `PATH` first, then `/opt/homebrew/bin`, `/usr/local/bin`, and `~/.pi/agent/bin`, in that order. The final location uses the **remote** home; it does not require a pi installation there. Missing utilities produce actionable errors. The extension never downloads or installs remote software, provisions credentials, or changes SSH configuration or security settings.

No remote pi or Node.js runtime is required. Remote invocations use a fresh `bash -c`, not an interactive or login Bash session. File helpers are one-shot Python scripts passed on the SSH command line, with JSON requests over stdin. They are not installed as persistent files or a service, and remote files are not mirrored locally.

## Target selection for all seven tools

`bash`, `read`, `write`, `edit`, `find`, `grep` and `ls` accept the same optional string `host`:

| `host` argument | Selected machine |
| --- | --- |
| Omitted, no configured host | Local. |
| Omitted, `--ssh-host` or `PI_SSH_HOST` set | Configured default. |
| `"local"` | Always local, even with an SSH default. |
| Explicit SSH target | That target, overriding the configured host. |

**This changes the previous file-tool default.** With an SSH default, omitted-host file calls now access the remote filesystem, including mutations. [Migration examples](how-to.md#migrate-existing-prompts-and-integrations) show how to retain local access.

Accepted host names use ASCII letters, digits, `_`, `.` and `-`, with no leading `-` or `.`; valid IPv6 addresses are also accepted, including bracketed addresses. Optional usernames use the same ASCII characters and cannot begin with `-` or `.`. Whitespace, control characters, shell metacharacters, URLs and embedded ports/paths are rejected. `local` is reserved; `user@local` or another alias selects SSH to a host actually named `local`.

An SSH error never causes fallback to local execution. Unrelated extension tools and user-entered `!` / `!!` commands are not routed by pi-ssh and remain local.

## bash arguments

| Argument | Type | Meaning |
| --- | --- | --- |
| `command` | Required string | Bash command or script; expanded on the selected machine. |
| `timeout` | Optional number | Whole local invocation timeout in seconds. No default. Must be finite, positive and at most 2,147,483.647, following pi. |
| `host` | Optional string | Target selected as above. |
| `cwd` | Optional string | Absolute POSIX directory for a remote call only. Overrides configured remote cwd. |

Sample call:

```json
{"command": "git status --short", "host": "build", "cwd": "/srv/project", "timeout": 30}
```

A per-call `cwd` on a local bash call is an error; local commands can contain `cd`. `cwd` is literal: spaces and quotes work, but `~`, `$HOME` and shell substitutions are not expanded. Control characters are rejected. Without a per-call or configured remote cwd, bash starts in the remote login directory. Bash behaviour is otherwise unchanged.

## File-tool arguments

Each file tool retains its native arguments and adds **only** optional `host`. No file tool accepts per-call `cwd` or `timeout`.

| Tool | Native arguments | Behaviour |
| --- | --- | --- |
| `read` | Required `path: string`; optional `offset: number`, `limit: number`. | Text and supported images; text offset is one-indexed. |
| `write` | Required `path: string`, `content: string`. | Creates or overwrites a file, creating parent directories. |
| `edit` | Required `path: string`, `edits: { oldText: string, newText: string }[]`. | Multiple replacements in one file, validated against the original contents. |
| `find` | Required `pattern: string`; optional `path: string`, `limit: number`. | Glob search; returns paths relative to the search directory. |
| `grep` | Required `pattern: string`; optional `path: string`, `glob: string`, `ignoreCase: boolean`, `literal: boolean`, `context: number`, `limit: number`. | Content search with paths, line numbers and optional surrounding context. |
| `ls` | Optional `path: string`, `limit: number`. | Alphabetically sorted directory entries, including dotfiles, with `/` on directories. |

`find`, `grep` and `ls` default their `path` to the selected working directory. Grep defaults to regex matching, case-sensitive, with no glob filter or context. `literal: true` selects fixed-string matching. Find and grep preserve the native fd/rg ignore-file and hidden-file semantics; `ls` lists dotfiles rather than applying search ignore filters.

Edit replacements must each identify a unique, non-overlapping region of the original file under native matching and normalisation rules. Replacements are not applied incrementally to find later matches. Validation completes before writing; successful results retain native diff and patch details. Validation-before-write is not a filesystem transaction or rollback guarantee.

Sample calls on an authorised alias `build`:

```json
{"path": "README.md", "host": "build", "offset": 81, "limit": 80}
```

```json
{"path": "notes/status.txt", "content": "ready\n", "host": "build"}
```

```json
{"path": "notes/status.txt", "edits": [{"oldText": "ready", "newText": "complete"}], "host": "build"}
```

```json
{"pattern": "**/*.ts", "path": "src", "host": "build", "limit": 100}
```

```json
{"pattern": "TODO", "path": "src", "glob": "*.ts", "context": 2, "host": "build"}
```

```json
{"path": "/srv/project", "host": "build", "limit": 50}
```

### File paths

| Path form | Local call | Remote call |
| --- | --- | --- |
| Relative, such as `src/main.ts` | Resolved by native pi against the **live session cwd** (`ctx.cwd`). | Resolved against `--ssh-cwd` / `PI_SSH_CWD`, or the remote login directory when unset. |
| Absolute, such as `/srv/project/file.txt` | Local filesystem. | Selected remote filesystem; not a local-to-remote mapping. |
| `~` or `~/project/file.txt` | Local home. | Selected remote account’s home, never the local home. |

The configured remote cwd applies to **any** remote host, including an explicit host override. File tools select another remote directory through `path`; only bash can override `cwd` per call. A previous bash `cd` changes neither subsequent file calls nor the live local session cwd.

Native path conveniences are handled target-aware: leading `@`, supported Unicode-space normalisation and `file://` paths. Read’s filename-variant probes, such as screenshot spacing or Unicode normalisation, use the selected filesystem. A `file://` URI supplies a path, not an SSH target; `host` still selects the machine. Other shell expansion, including `$HOME` and command substitutions in file paths, is not performed. Paths and file contents are data, not interpolated shell commands.

### Output limits and memory

Limits follow native pi 0.85.1 behaviour:

| Tool | Output contract |
| --- | --- |
| `read` | Text is truncated at 2,000 lines or 50 KiB, whichever comes first, after offset/limit selection. Use follow-up calls on the same host for pagination. Supported images: JPEG, PNG, GIF, WebP and BMP, with native image handling and resizing. |
| `find` | Default 1,000 results; `limit` changes the result cap. Output has a 50 KiB cap. |
| `grep` | Default 100 matches; `limit` changes the match cap. Output has a 50 KiB cap; long lines are shortened to 500 characters. |
| `ls` | Default 500 entries; `limit` changes the entry cap. Output has a 50 KiB cap. |
| `write` / `edit` | Native-compatible success messages and details; edit retains its actual result diff. |

Find, grep and ls do not share read’s separate 2,000-line cap. Truncation and result-limit notices retain native details and rendering compatibility. Remote find uses NUL-delimited filenames, preserving whitespace and embedded newlines rather than applying the native line splitter’s trimming. Remote grep preserves Unicode line separators within JSON records and rejects malformed utility output instead of silently discarding it.

**Pagination is not network streaming.** Remote read loads the entire file into memory before native pagination, image processing and truncation. The SSH stdout protocol buffers complete responses, including large file data; grep context can also require full file reads. Output limits bound the returned tool text, not transport or process memory.

### Mutation queue and cancellation

Remote write and edit resolve and canonicalise paths on the selected host. Extension-owned mutations reserve both the **literal SSH target string plus canonical remote path** and the existing file’s device/inode identity, covering the full read–modify–write window. The path reservation bridges file creation; the inode reservation also covers hard links. Symlink and hard-link aliases on the same target share a queue; different target strings remain distinct, even if two aliases reach the same machine. This is not a lock against external editors, bash commands or other processes.

Cancellation prevents unstarted mutations. Once a remote `mkdir` or write is active, it finishes before cancellation releases the queue, like an active native local filesystem mutation. Read/search cancellation terminates the local SSH process tree; arbitrary remote descendants are not guaranteed to stop. Connection failures can leave partial mutations or an uncertain outcome. Without an acknowledgement that a mutation settled, further write/edit operations on the reserved path/inode fail closed until pi restarts. Reads and unrelated targets remain available. Inspect the remote file and ensure the earlier operation has stopped before restarting and retrying. There is no transaction, rollback or exactly-once promise.

## Configuration

| CLI flag | Environment variable | Default |
| --- | --- | --- |
| `--ssh-host` | `PI_SSH_HOST` | `local` |
| `--ssh-cwd` | `PI_SSH_CWD` | Unset: remote login directory |
| `--ssh-connect-timeout` | `PI_SSH_CONNECT_TIMEOUT` | `10` seconds |

Precedence, highest first:

1. Per-call `host`, or bash-only `cwd`, for that field.
2. CLI flag.
3. Environment variable.
4. Built-in default.

Configured cwd follows the same absolute POSIX and literal-path rules as bash `cwd`; it is not expanded like a file-tool `path`. Empty environment values are treated as unset. Empty CLI values are invalid. Connection timeout is decimal integer seconds from 1 to 2,147,483,647; it is not an overall file-operation timeout or the bash command timeout.

Configuration is read after CLI flags become available, on `session_start`, and remains fixed until another session start or reload. There is no pi-ssh-specific configuration file. Invalid startup configuration blocks all seven overridden tools, including explicit local calls; per-call arguments do not bypass it. Extension-owned prompt guidance identifies the active default or configuration error before each agent turn.

## SSH invocation

Bash reuses the native process backend, replacing the local Bash process with `ssh` through `exec`. File transport starts SSH directly with an argument array. Both routes reuse host validation, connection timeout and these options:

```text
-T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=<seconds> -- <host> <remote-script>
```

Authentication is non-interactive. Bash commands receive no interactive stdin; file helpers receive one JSON request over stdin. Both shell boundaries are quoted. For bash, a failed configured `cd` exits before the user command runs. File requests carry paths, search patterns and contents separately from shell syntax.

Normal OpenSSH configuration supplies identities, ports, proxies and multiplexing. The extension does not modify it or explicitly forward environment variables. SSH `SendEnv` / `SetEnv`, server policy and remote startup files may still affect the remote environment. Remote calls remove pi’s injected session metadata from the local client environment; they do not copy the local project or environment to the remote.

## Bash results and errors

Results and streaming use pi’s native bash machinery and result shape. Output combines stdout and stderr; ordering between streams is not guaranteed. The retained tail is bounded to 2,000 lines or 50 KiB. Full truncated output is stored in a **local** temporary file whose size can grow with total output. Its follow-up read must use `host="local"`, even when the command ran remotely:

```json
{"path": "/actual/path/from/the/truncation/notice", "host": "local"}
```

Non-zero exits are tool errors containing output and an exit-code notice. SSH typically uses code 255 for transport errors; a remote program can also exit 255, so that code alone does not identify the cause. Timeout and cancellation are errors, not successful empty output. Their cleanup scope is the local process tree, not arbitrary remote descendants. File transport and protocol errors likewise surface as errors, never local fallback or a successful empty search.

## Tool presentation

Each tool header includes a presentation-only target and, for remote calls, directory annotation. It does not alter the command, path, contents or result details. Omitted configuration is marked “current default”: on a restored transcript it reflects currently loaded configuration, not a durable record of the historical target. Explicit per-call `host` and bash `cwd` remain in recorded arguments.

Native result rendering is preserved. Native edit’s pre-execution local preview is disabled for remote calls so rendering cannot read a similarly named local file. The completed remote edit still shows the actual result diff.

## Local compatibility and scope

All six local file calls delegate to native pi using the live session cwd. Bash local calls use the live cwd and pi’s session environment. There is no persistent remote cwd or shell state between calls. User-entered `!` / `!!` commands and unrelated extension tools remain local, regardless of the pi-ssh default.

Local bash inherits pi’s file-backed `shellPath` and `shellCommandPrefix` settings at session start, including trusted project overrides. Untrusted project shell settings are ignored. These settings never apply remotely; remote bash setup belongs in `command`. SDK-only in-memory settings overrides and another extension’s tool implementation are not inherited. pi-ssh adds no permission prompts or host allowlist and is not a security sandbox.
