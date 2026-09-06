import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Config, validateHost } from './config.ts';
import { buildSshArgs, quote } from './ssh.ts';

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Operation aborted');
}

// Normalize the same input conveniences as pi, but leave home expansion to the remote.
export function remotePathInput(input: string): string {
  if (typeof input !== 'string' || input.includes('\0')) throw new Error('Invalid remote path: expected a string without NUL');
  let path = input.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ').replace(/^@/, '');
  if (path.startsWith('file://')) path = fileURLToPath(path);
  if (path.includes('\0')) throw new Error('Invalid remote path: NUL is not allowed');
  return path;
}

const scripts = new Map<string, string>();
export type RemoteRequest = Record<string, unknown>;
export class RemoteMutationUncertainError extends Error {
  constructor(message: string) {
    super(`${message}. Remote mutation outcome is unknown. Inspect the remote file and restart pi before retrying mutations of this file.`);
    this.name = 'RemoteMutationUncertainError';
  }
}
export interface ResolvedPath { path: string; canonical: string; identity?: string }

/** One-shot, structured transport. Neither file paths nor contents enter shell syntax. */
export class RemoteClient {
  readonly host: string;
  readonly connectTimeout: number;
  readonly signal?: AbortSignal;
  constructor(host: string, connectTimeout: number, signal?: AbortSignal) {
    this.host = host;
    this.connectTimeout = connectTimeout;
    this.signal = signal;
    validateHost(host);
    if (host === 'local') throw new Error('Remote transport cannot target local');
  }

  call<T>(request: RemoteRequest, search = false, mutating = false): Promise<T> {
    throwIfAborted(this.signal);
    const file = search ? 'remote-search.py' : 'remote-fs.py';
    let script = scripts.get(file);
    if (!script) {
      script = readFileSync(new URL(file, import.meta.url), 'utf8');
      scripts.set(file, script);
    }
    const command = 'command -v python3 >/dev/null 2>&1 || { printf "%s\\n" "pi-ssh file tools require Python 3.9+ on the remote PATH; install it explicitly" >&2; exit 127; }\n'
      + `exec python3 -c ${quote(script)}`;
    const env = { ...process.env };
    for (const key of ['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL', 'PI_REASONING_LEVEL']) delete env[key];
    return new Promise<T>((resolve, reject) => {
      const child = spawn('ssh', buildSshArgs(this.host, command, this.connectTimeout), {
        stdio: ['pipe', 'pipe', 'pipe'], detached: true, env,
      });
      const chunks: Buffer[] = [];
      let stderr = Buffer.alloc(0);
      let processError: Error | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const kill = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try { process.kill(-child.pid, signal); } catch { /* Already exited. */ }
      };
      const onAbort = () => {
        // Like native write/edit: do not release the mutation queue while a write can
        // still finish. Let an already-started write/mkdir settle, then report abort.
        if (mutating) return;
        kill('SIGTERM');
        timer = setTimeout(() => kill('SIGKILL'), 250);
        timer.unref();
      };
      this.signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => { stderr = Buffer.concat([stderr, chunk]).subarray(-16 * 1024); });
      child.on('error', error => { processError = error; });
      child.stdin.on('error', error => { processError ??= error; });
      child.on('close', code => {
        this.signal?.removeEventListener('abort', onAbort);
        if (timer) clearTimeout(timer);
        if (this.signal?.aborted && !mutating) return reject(new Error('Operation aborted'));
        const transportError = (message: string) => mutating ? new RemoteMutationUncertainError(message) : new Error(message);
        const diagnostic = stderr.toString('utf8').trim();
        if (code !== 0 || processError) {
          return reject(transportError(`SSH ${JSON.stringify(this.host)} failed (${code ?? 'spawn'}): ${diagnostic || processError?.message || 'connection closed'}`));
        }
        let response;
        try {
          response = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!(response?.ok === true && Object.hasOwn(response, 'value')) &&
              !(response?.ok === false && typeof response.error === 'string')) {
            throw new Error('Invalid remote response (unexpected stdout or incompatible helper)');
          }
        } catch (error) {
          return reject(transportError(`SSH ${JSON.stringify(this.host)}: ${error instanceof Error ? error.message : String(error)}`));
        }
        // A valid response acknowledges that the operation settled, even on OS
        // errors. A transport failure does not: retain a fail-closed reservation.
        if (this.signal?.aborted) return reject(new Error('Operation aborted'));
        if (!response.ok) return reject(new Error(`SSH ${JSON.stringify(this.host)}: ${response.error}`));
        resolve(response.value as T);
      });
      if (this.signal?.aborted) onAbort();
      child.stdin.end(JSON.stringify(request));
    });
  }

  resolve(path: string, cwd: Config['cwd'], read = false): Promise<ResolvedPath> {
    return this.call({ op: 'resolve', path: remotePathInput(path), cwd, read });
  }
}

/** Reserve in call order, resolving symlinks remotely, never through local realpath. */
export class RemoteMutationQueue {
  private registrations = new Map<string, Promise<unknown>>();
  private pending = new Map<string, Promise<void>>();
  private uncertain = new Map<string, RemoteMutationUncertainError>();

  async run<T>(host: string, resolvePath: () => Promise<ResolvedPath>, fn: (path: ResolvedPath) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const registration = (this.registrations.get(host) ?? Promise.resolve()).catch(() => {}).then(async () => {
      throwIfAborted(signal);
      const path = await resolvePath();
      throwIfAborted(signal);
      // Keep BOTH the pathname and inode reservations. The name bridges creation
      // (no inode yet), while dev:ino unifies existing hard-link aliases.
      const keys = [JSON.stringify([host, 'path', path.canonical])];
      if (path.identity) keys.push(JSON.stringify([host, 'inode', path.identity]));
      const previous = Promise.all(keys.map(key => this.pending.get(key))).then(() => {});
      let release!: () => void;
      const next = new Promise<void>(done => { release = done; });
      const tail = previous.then(() => next);
      for (const key of keys) this.pending.set(key, tail);
      return { path, keys, previous, tail, release };
    });
    this.registrations.set(host, registration);
    let reserved: Awaited<typeof registration>;
    try { reserved = await registration; }
    finally { if (this.registrations.get(host) === registration) this.registrations.delete(host); }
    await reserved.previous;
    try {
      throwIfAborted(signal);
      for (const key of reserved.keys) {
        const error = this.uncertain.get(key);
        if (error) throw error;
      }
      return await fn(reserved.path);
    } catch (error) {
      if (error instanceof RemoteMutationUncertainError) {
        for (const key of reserved.keys) this.uncertain.set(key, error);
      }
      throw error;
    } finally {
      reserved.release();
      for (const key of reserved.keys) if (this.pending.get(key) === reserved.tail) this.pending.delete(key);
    }
  }
}
