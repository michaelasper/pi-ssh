// Test-only safety gate: usability sessions may run only these three harmless probes.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function guard(pi: ExtensionAPI) {
  let calls = 0;
  const commands = new Set([
    "printf 'REMOTE_OK\\n'",
    "printf 'EXPECTED_FAILURE\\n' >&2; exit 7",
    "printf 'LOCAL_OK\\n'",
  ]);
  pi.on('tool_call', event => {
    calls++;
    const input = event.input as Record<string, unknown>;
    if (calls > 8 || event.toolName !== 'bash' || typeof input.command !== 'string' ||
      !commands.has(input.command) || input.cwd !== undefined ||
      (input.host !== undefined && input.host !== 'local' && input.host !== process.env.PI_SSH_TEST_HOST)) {
      return { block: true, terminate: true, reason: 'Usability test safety gate: only the exact requested probe commands and target are permitted.' };
    }
    input.timeout = 10;
  });
}
