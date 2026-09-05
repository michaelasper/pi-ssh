// OpenSSH joins remote argv into a shell string, so both shell boundaries need quoting.
export function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildSshCommand(host: string, command: string, cwd: string | undefined, connectTimeout: number): string {
  // A failing cd must stop the whole script, not just its first command.
  const script = cwd === undefined ? command : `cd -- ${quote(cwd)} || exit $?\n${command}`;
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', `ConnectTimeout=${connectTimeout}`, '--', host, `bash -c ${quote(script)}`];
  // exec replaces the local Bash process; pi retains process-group ownership and cleanup.
  return `exec ssh ${args.map(quote).join(' ')}`;
}
