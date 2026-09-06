# Execution and trust boundaries

## Seven tools, two execution locations

A coding session may need both a local checkout and a remote project. pi-ssh adds a target to the existing bash and file tools rather than moving the entire session. `bash`, `read`, `write`, `edit`, `find`, `grep` and `ls` share the same default, and `host="local"` makes an individual local call unambiguous.

This is a deliberate change from the earlier bash-only design. A remote default now keeps file inspection, edits and commands on the same machine, but it also changes the meaning of old file calls that omitted `host`. Existing prompts and integrations need the [migration step](how-to.md#migrate-existing-prompts-and-integrations). With no SSH default, calls remain local. User-entered `!` / `!!` commands and unrelated extension tools are outside this routing boundary and remain local.

A remote default does not change pi’s local working directory. Local calls use the live session cwd. Remote relative file paths use the configured remote cwd or the remote login directory; absolute paths and home expansion use the selected machine’s filesystem. The local project path may not exist on the server and is never translated automatically. Each call is independent; a previous bash `cd` cannot change the next call.

File tools add only `host` because their native `path` argument already selects a file or search directory. Bash retains its existing per-call remote `cwd`, since an arbitrary command may operate on several paths. The configured remote cwd applies to explicit SSH overrides as well as the default host.

## Reuse native behaviour where the public API permits

The compatibility reference is pi 0.85.1’s public APIs. All six local file calls delegate to native pi. Remote read, write, edit and ls retain the native algorithms through operation adapters, preserving pagination, image handling, edit validation, diffs and result details.

Native path resolution and mutation machinery can touch the local filesystem even when operations are replaced. Remote adapters therefore resolve paths on the remote and run native algorithms with opaque in-memory placeholders, not similarly named local user files. No file is mirrored into the local checkout. Native edit’s local pre-execution preview is disabled for remote calls to prevent a presentation step from reading a local file; the completed result still renders the actual remote diff.

Search needs a separate adapter because native grep has no subprocess spawn hook. Remote find and grep use fd/fdfind and rg respectively, matching pi’s search options, ignore semantics, formatting and details with public truncation helpers. They do not substitute shell globbing or a Python regex engine for those utilities. Missing remote utilities are errors rather than an excuse to change semantics or search locally.

Bash continues to reuse pi’s process backend for streaming updates, bounded output retention, temporary output files, timeouts and local process cleanup. Its existing local shell settings and remote command execution path are unchanged.

## One-shot transport, not a remote installation

Remote bash replaces the local Bash process with OpenSSH through `exec`. File operations launch SSH with an argument array, pass a quoted one-shot Python helper on the remote command line and send a JSON request over stdin. A file-tool call can require multiple one-shot requests, such as path resolution followed by a read or mutation.

There is no persistent helper service, installed helper file, file synchronisation, remote pi/Node runtime, startup connection probe or extension-owned connection pool. Remote Bash, a POSIX-compatible login shell and Python 3.9+ are prerequisites, with fd/fdfind for find and rg for grep. Search lookup includes common installation locations as well as `PATH`, but the extension never installs anything automatically.

Configuration is resolved at session start or reload. Connection reuse remains OpenSSH’s responsibility. This keeps persistent transport state and credential management outside the extension. The historical [bash benchmark](verification.md#performance) concerns the local bash wrapper, not remote file latency or memory use.

## Output limits are not memory limits

Bash’s retained output tail is bounded, but its full-output artifact is a local disk-backed file that can grow until cleaned up. Even after a remote command, reading that artifact requires `host="local"`; a remote default does not move the artifact.

Remote file transport has a different resource profile. Read fetches the entire remote file before native pagination, truncation or image processing. JSON stdout responses are buffered locally; encoded file data and decoded buffers can coexist in memory. Grep context may also require reading full remote files. A small read `limit` therefore bounds returned text, not network transfer or peak memory.

Native text and search output caps protect the model’s context, not every resource involved in producing it. This design prioritises native behaviour without a remote service; it does not promise streaming file access or bounded memory for arbitrarily large files.

## Quoting is not authorisation

For bash, the local shell must not expand a remote command before SSH sends it. The remote login shell must then pass the script intact to Bash. Quoting both boundaries preserves the intended command and literal cwd; rejecting ambiguous host syntax prevents accidental option injection.

File paths, search patterns and contents travel as JSON data, not interpolated shell fragments. File helpers use filesystem APIs and argument arrays for search utilities. A filename containing quotes, dollar signs or shell substitutions is not an instruction to execute them. Path conveniences such as `~/`, leading `@`, Unicode-space normalisation and `file://` handling are target-aware, never local-home expansion before an SSH call.

None of this makes agent-generated work safe in general. Bash intentionally executes arbitrary commands, and write/edit intentionally modify files. SSH credentials authorise access; the remote account’s permissions limit it. The extension runs with pi’s local privileges and can reach SSH hosts your account can access. It adds no host allowlist or permission prompts and is not a sandbox.

Strict host-key verification protects server identity. Batch mode avoids hanging on authentication prompts. Existing SSH configuration remains trusted executable configuration: options such as `ProxyCommand`, `LocalCommand`, forwarding and identity selection can have effects beyond the remote operation. pi-ssh reuses that configuration without replacing or sanitising it, and does not provision credentials or weaken security settings.

## A mutation queue is not a transaction

Parallel write/edit calls could otherwise read the same old contents and overwrite each other’s changes. pi-ssh resolves and canonicalises remote paths on the selected machine, then queues extension-owned mutations by literal SSH target string, reserving both canonical path and existing device/inode identity. The path reservation bridges file creation; the inode reservation catches hard links. The queue covers the entire read–modify–write window. Stable symlink and hard-link aliases on one target share a queue; different targets do not block each other merely because they use the same path.

Literal target strings are intentionally distinct. Two SSH aliases may reach the same machine with different users, configuration or credentials, and pi-ssh does not attempt to prove their equivalence. Conversely, two different aliases for the same account and file do not share this queue.

The queue is not a lock against external editors, bash commands, other extensions or another pi process. Native edit validation checks all replacement blocks before writing, but there is no filesystem transaction, rollback, or protection against every external race. In particular, changing symlinks or files outside the queue can invalidate assumptions about the target.

## Cancellation is not remote job control

Stopping the local SSH process tree interrupts the connection. It does not prove that every remote descendant has stopped. Detached jobs, server policies and signal handling can let remote processes survive.

Read and search calls respond to cancellation by terminating the local SSH process tree. Mutations need a narrower cancellation boundary: an already-started remote `mkdir` or write is allowed to finish before cancellation releases the file queue, like an active native local filesystem mutation. Releasing the queue immediately could let the next call start while the previous write was still finishing. A cancellation result does not mean that no file changed.

For work requiring durable status, retries or guaranteed cleanup, a remote job supervisor is the right owner. pi-ssh makes no exactly-once guarantee. A connection failure may occur after partial or complete side effects. If a mutation’s acknowledgement is lost, the extension cannot prove that the remote writer has stopped; it therefore blocks queued and future mutations of the reserved path/inode until pi restarts. Reads remain available for inspection. Confirm the remote operation has stopped and inspect the file before restarting and retrying. Errors never fall back to local execution.

## Presentation is not historical target storage

Tool headers distinguish local and SSH targets without changing commands, paths or native result details. Fields supplied by configuration are marked “current default”. On restored transcripts, those annotations describe the configuration currently loaded, not necessarily the target used in the historical call.

Explicit `host` and bash `cwd` arguments remain in the transcript. Omitted fields do not become durable routing metadata merely because a header displays them. Extension-owned prompt guidance explains the current defaults and the local artifact boundary, but it does not turn unrelated extension tools into remote tools or rewrite another extension’s instructions.
