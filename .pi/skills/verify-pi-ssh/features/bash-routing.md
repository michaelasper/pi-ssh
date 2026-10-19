# Bash routing

Bash routing runs a shell command on the SSH host and returns its output, exit status, and truncation notices the same way a local command would.

## Sub-features

- `bash-default-remote` runs on the configured host when the call omits `host`.
- `bash-explicit-remote` runs on the host named in the call.
- `bash-quoting` passes quotes, dollar signs, backticks, newlines, and Unicode as literal data.
- `bash-exit-code` reports a non-zero exit as an error result with the code in structured content.
- `bash-output-limit` truncates large output and writes the full text to a local file.
- `bash-timeout-abort` ends the call on timeout or cancellation and runs nothing further.

## How to get to it (user POV)

- Ask pi to run a command on a named SSH host.
- Start pi with `--ssh-host <alias>` and ask for a command without naming a machine.
- Cancel a running remote command from the pi interface.

## Driving it with the sshd harness

Preconditions:

- `npm run test:e2e` reaches `sshd ready` and starts the scenario named `real SSH: success, cwd, quoting, failures, output limits, timeout and cancellation`.

- **Default and explicit remote.** The scenario runs `printf pi-ssh-remote` with the configured default and `printf pi-ssh-explicit` with the host named. Both outputs return exactly.
- **Quoting.** The scenario prints a string that contains a dollar sign, backticks, single quotes, a newline, and a Greek letter. The output matches the input byte for byte.
- **Exit code.** The scenario exits 17 after writing to stderr. The result is an error result and the text names code 17.
- **Output limit.** The scenario prints 60,000 bytes. The result reports truncation. The local full-output file holds all 60,000 bytes.
- **Timeout and abort.** The scenario times out a 3 second sleep at half a second and aborts a second sleep. A file the aborted command would create does not exist afterward.
- **Proof.** The scenario passes and its name appears in `.artifacts/ssh-e2e.log` with a check mark.

## Gotchas

- A non-zero exit resolves as an error result in pi 1.3. It does not throw. Timeouts and aborts still throw.
- Remote descendants of a killed command can outlive the disconnect. The scenario keeps sleeps at 3 seconds so stragglers exit on their own.
- The full-output file is local even when the command ran remotely. Checks must read it locally.
