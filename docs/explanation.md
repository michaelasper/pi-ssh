# Execution and trust boundaries

## One tool, two execution locations

A coding session often needs a local checkout and a remote build machine. Moving every tool remotely makes that distinction implicit. pi-ssh instead adds a target to bash and leaves file operations alone. The explicit `host="local"` escape hatch keeps local commands unambiguous even when most commands run remotely.

A default remote is a convenience, not a change to pi’s current working directory. The local project path may not exist on the server, so remote execution starts in the remote login directory unless an absolute remote directory is supplied. Each call is independent; a previous `cd` cannot change the next call.

## Small execution path

pi already handles bounded output retention, streaming updates, temporary output files, command timeouts and local process cleanup. Reusing that implementation keeps these behaviours consistent and avoids a second subprocess framework.

For a remote call, the extension constructs a quoted command and uses `exec` to replace the local Bash process with OpenSSH. No helper daemon, watcher, connection probe or custom pool runs at startup. Configuration is resolved once per session start. Connection reuse remains OpenSSH’s responsibility.

This design trades custom transport features for fewer resources to own and fewer failure modes to test. The [benchmark](verification.md#performance) measures local wrapper overhead rather than promising a network speedup.

## Quoting is not authorisation

The local shell must not expand a remote command before SSH sends it. The remote login shell must then pass the script intact to Bash. Quoting both boundaries preserves the intended command and literal directory names; rejecting ambiguous host syntax prevents accidental option injection.

None of this makes an agent-generated command safe. Bash intentionally executes arbitrary commands. SSH credentials authorise access, and the remote account’s permissions limit what those commands can do. The extension has the same local privileges as pi and can reach any SSH host your account can access.

Strict host-key verification protects server identity. Batch mode avoids hanging on authentication prompts. Existing SSH configuration remains trusted executable configuration: options such as `ProxyCommand`, `LocalCommand`, forwarding and identity selection can have effects beyond the remote script. pi-ssh does not replace or sanitise it.

## Cancellation is not remote job control

Stopping the local SSH client interrupts the connection. It does not prove that every process started remotely has stopped. Detached jobs, server policies and signal handling can let remote descendants survive.

For work that needs durable status, retries or guaranteed cleanup, a remote job supervisor is the right owner. pi-ssh makes no exactly-once guarantee. A connection failure may happen after a command has already performed side effects; blindly retrying a failed mutating command can repeat them.

Full-output files are another ownership boundary: pi stores them locally. Their retained tail is bounded in memory, but the full file can consume disk until cleaned up. Use command timeouts and sensible output volume for long-running jobs.
