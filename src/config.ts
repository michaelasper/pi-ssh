import { isIP } from 'node:net';

export interface Config {
  host: string;
  cwd?: string;
  connectTimeout: number;
}

export interface TargetInput {
  host?: string;
  cwd?: string;
}

export function validateHost(value: unknown): string {
  if (typeof value !== 'string' || !value || /[\s\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid SSH host: use an SSH alias or user@host');
  }
  const parts = value.split('@');
  const host = parts.at(-1)!;
  const address = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (parts.length > 2 || (parts.length === 2 && !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(parts[0])) ||
    !(isIP(address) === 6 || /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(host))) {
    throw new Error('Invalid SSH host: use an alias or user@host; configure ports in ~/.ssh/config');
  }
  return value;
}

function validateCwd(value: string): string {
  if (!value.startsWith('/') || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid SSH cwd: expected an absolute POSIX path without control characters');
  }
  return value;
}

export function resolveConfig(
  flags: { host?: string; cwd?: string; connectTimeout?: string },
  env: NodeJS.ProcessEnv,
): Config {
  const host = validateHost(flags.host ?? (env.PI_SSH_HOST || 'local'));
  const rawCwd = flags.cwd ?? (env.PI_SSH_CWD || undefined);
  const rawTimeout = flags.connectTimeout ?? (env.PI_SSH_CONNECT_TIMEOUT || '10');
  const connectTimeout = Number(rawTimeout);
  if (!/^[0-9]+$/.test(rawTimeout) || !Number.isSafeInteger(connectTimeout) ||
    connectTimeout < 1 || connectTimeout > 2_147_483_647) {
    throw new Error('Invalid SSH connection timeout: expected integer seconds from 1 to 2147483647');
  }
  return { host, ...(rawCwd === undefined ? {} : { cwd: validateCwd(rawCwd) }), connectTimeout };
}

export function resolveTarget(input: TargetInput, config: Config): TargetInput & { host: string } {
  const host = validateHost(input.host ?? config.host);
  if (host === 'local') {
    if (input.cwd !== undefined) throw new Error('bash cwd is remote-only; use cd in a local command');
    return { host };
  }
  return { host, cwd: input.cwd === undefined ? config.cwd : validateCwd(input.cwd) };
}
