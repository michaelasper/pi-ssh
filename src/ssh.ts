// ServerAlive bounds dead-peer detection to about 45 seconds of silence at
// the SSH protocol level. Long commands with a live peer are unaffected.
export const SERVER_ALIVE_INTERVAL_SECONDS = 15;
export const SERVER_ALIVE_COUNT_MAX = 3;

// OpenSSH joins remote argv into a shell string, so both shell boundaries need quoting.
export function buildSshArgs(host: string, script: string, connectTimeout: number): string[] {
  return ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', `ServerAliveInterval=${SERVER_ALIVE_INTERVAL_SECONDS}`,
    '-o', `ServerAliveCountMax=${SERVER_ALIVE_COUNT_MAX}`,
    '--', host, `bash -c ${quote(script)}`];
}

export function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildSshCommand(host: string, command: string, cwd: string | undefined, connectTimeout: number): string {
  // A failing cd must stop the whole script, not just its first command.
  const script = cwd === undefined ? command : `cd -- ${quote(cwd)} || exit $?\n${command}`;
  const args = buildSshArgs(host, script, connectTimeout);
  // exec replaces the local Bash process; pi retains process-group ownership and cleanup.
  return `exec ssh ${args.map(quote).join(' ')}`;
}
