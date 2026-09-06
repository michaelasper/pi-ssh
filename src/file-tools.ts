import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import {
  createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition,
  createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition,
  type ExtensionContext, type ToolDefinition, type ReadToolInput, type WriteToolInput,
  type EditToolInput, type LsToolInput, type ReadToolOptions,
} from '@earendil-works/pi-coding-agent';
import { Text, Container } from '@earendil-works/pi-tui';
import { Type, type Static, type TObject, type TSchema, type TProperties } from 'typebox';
import { type Config, resolveTarget } from './config.ts';
import { RemoteClient, RemoteMutationQueue, RemoteMutationUncertainError, type ResolvedPath, throwIfAborted } from './remote.ts';
import { detectImageMimeType } from './image-mime.ts';
import { remoteFind, remoteGrep } from './search.ts';
import { quote } from './ssh.ts';

const hostParameter = Type.Optional(Type.String({
  description: 'SSH alias or user@host. Omit to follow --ssh-host / PI_SSH_HOST (normally local). Use "local" to force the local machine.',
}));
const queue = new RemoteMutationQueue();
interface RemoteContext {
  client: RemoteClient;
  resolved: ResolvedPath;
  signal?: AbortSignal;
  ctx: ExtensionContext;
}

function withHost<T extends TSchema & { properties: TProperties }, D, S>(
  native: ToolDefinition<T, D, S>, getConfig: () => Config,
  execute: (input: Parameters<typeof native.execute>[1], remote: RemoteContext) => ReturnType<typeof native.execute>,
) {
  const parameters = Type.Object({ ...native.parameters.properties, host: hostParameter }) as TObject<T['properties'] & { host: typeof hostParameter }>;
  const targetFor = (input: { host?: string }) => resolveTarget({ host: input.host }, getConfig());
  const definition = {
    ...native,
    parameters,
    description: `${native.description} Optional host selects SSH or "local"; omitted host follows the configured default. Remote relative paths use --ssh-cwd / PI_SSH_CWD or the remote login directory. ~ uses the selected machine's home. SSH failures never fall back locally.`,
    promptSnippet: `${native.promptSnippet ?? native.description} (local or SSH via host)`,
    promptGuidelines: [...(native.promptGuidelines ?? []),
      `${native.name}: omitted host follows the SSH default; use host="local" for local files, including bash full-output artifacts. Remote path is on the selected host; use the same host on follow-up calls.`,
    ],
    renderCall(input: Partial<Static<typeof parameters>>, theme: Parameters<NonNullable<typeof native.renderCall>>[1],
      context: Parameters<NonNullable<typeof native.renderCall>>[2]) {
      let annotation = 'Target: unresolved (incomplete arguments or invalid configuration)';
      let local = false;
      try {
        const target = targetFor(input as { host?: string });
        local = target.host === 'local';
        annotation = `Target: ${local ? 'local' : `SSH ${JSON.stringify(target.host)}`}${(input as { host?: string }).host === undefined ? ' (current default)' : ''}`;
        if (!local) annotation += `; cwd: ${JSON.stringify(target.cwd ?? 'remote login directory')} (current default)`;
      } catch { /* Rendering must not hide incomplete calls. Never preview an unresolved target locally. */ }
      if (!local && native.name === 'edit') {
        // Streaming arguments may have initially selected the local default before
        // an explicit remote host arrived. Discard its detached preview component.
        delete (context.state as { callComponent?: unknown }).callComponent;
      }
      const component = new Container();
      component.addChild(new Text(theme.fg('muted', annotation), 0, 0));
      if (local && native.renderCall) {
        // Native edit's pre-execution preview reads LOCAL files. Never run it for SSH.
        component.addChild(native.renderCall(input as Parameters<NonNullable<typeof native.renderCall>>[0], theme, { ...context, lastComponent: undefined }));
      } else {
        const args = input as { path?: string; pattern?: string; offset?: number; limit?: number };
        let text = `${native.name} ${JSON.stringify(args.path ?? '.')}`;
        if (args.pattern !== undefined) text += ` pattern=${JSON.stringify(args.pattern)}`;
        if (args.offset !== undefined) text += ` offset=${args.offset}`;
        if (args.limit !== undefined) text += ` limit=${args.limit}`;
        component.addChild(new Text(theme.fg('toolTitle', text), 0, 0));
      }
      return component;
    },
    async execute(id: string, input: Static<typeof parameters>, signal: Parameters<typeof native.execute>[2],
      onUpdate: Parameters<typeof native.execute>[3], ctx: ExtensionContext) {
      const config = getConfig();
      const target = resolveTarget({ host: (input as { host?: string }).host }, config);
      if (Object.hasOwn(input, 'cwd')) throw new Error(`${native.name} has no per-call cwd; use path and the configured remote cwd`);
      if (target.host === 'local') return native.execute(id, input as Parameters<typeof native.execute>[1], signal, onUpdate, ctx);
      throwIfAborted(signal);
      const client = new RemoteClient(target.host, config.connectTimeout, signal);
      const path = (input as { path?: string }).path ?? '.';
      const resolve = () => client.resolve(path, target.cwd, native.name === 'read');
      const run = (resolved: ResolvedPath) => execute(input as Parameters<typeof native.execute>[1], { client, resolved, ctx, signal });
      return native.name === 'write' || native.name === 'edit'
        ? queue.run(target.host, resolve, run, signal)
        : run(await resolve());
    },
  };
  // Public pi and the extension may resolve separate TypeBox installations. The
  // schema is the native object plus optional host; bridge only this type boundary.
  return definition as unknown as ToolDefinition<typeof parameters, D, S>;
}

// Pi resolves paths and queues mutations through LOCAL fs even with custom ops.
// Use an opaque, nonexistent per-call path for the in-memory native algorithms.
// No remote file is mirrored and no local user path/home participates in execution.
function memoryPath() { return join(tmpdir(), `pi-ssh-memory-${randomUUID()}`, 'file'); }
function memoryContext(remote: RemoteContext): ExtensionContext { return { ...remote.ctx, cwd: '/', model: remote.ctx.model }; }

async function readRemote(input: ReadToolInput, remote: RemoteContext, options?: Pick<ReadToolOptions, 'autoResizeImages'>) {
  const buffer = Buffer.from(await remote.client.call<string>({ op: 'read', path: remote.resolved.path }), 'base64');
  const virtual = memoryPath();
  const native = createReadToolDefinition('/', { ...options, operations: {
    access: async () => { throwIfAborted(remote.signal); },
    readFile: async () => buffer,
    detectImageMimeType: async () => detectImageMimeType(buffer),
  } });
  const result = await native.execute('ssh-read', { ...input, path: virtual }, remote.signal, undefined, memoryContext(remote));
  if (result.details?.truncation?.firstLineExceedsLimit) {
    // Native's fallback interpolates a path as shell syntax and omits host. Supply a
    // safely quoted command AND the selected host, without altering file contents.
    const line = input.offset ? Math.max(1, input.offset) : 1;
    const command = `sed -n '${line}p' ${quote(remote.resolved.path)} | head -c 51200`;
    const notice = result.content.find(part => part.type === 'text');
    const prefix = notice?.type === 'text' ? notice.text.split(' Use bash:')[0] : `[Line ${line} exceeds the 50KB limit.`;
    result.content = [{ type: 'text', text: `${prefix} Use bash with host=${JSON.stringify(remote.client.host)} and command=${JSON.stringify(command)}]` }];
  }
  return result;
}

async function writeRemote(input: WriteToolInput, remote: RemoteContext) {
  const virtual = memoryPath();
  const native = createWriteToolDefinition('/', { operations: {
    mkdir: () => remote.client.call<void>({ op: 'mkdir', path: posix.dirname(remote.resolved.path) }, false, true),
    writeFile: (_path, content) => remote.client.call<void>({ op: 'write', path: remote.resolved.path, data: Buffer.from(content).toString('base64') }, false, true),
  } });
  await native.execute('ssh-write', { ...input, path: virtual }, remote.signal, undefined, memoryContext(remote));
  return { content: [{ type: 'text' as const, text: `Successfully wrote to ${input.path}` }], details: undefined };
}

async function editRemote(input: EditToolInput, remote: RemoteContext) {
  const virtual = memoryPath();
  let buffer: Buffer;
  const native = createEditToolDefinition('/', { operations: {
    access: async () => { buffer = Buffer.from(await remote.client.call<string>({ op: 'read', path: remote.resolved.path, editable: true }), 'base64'); },
    readFile: async () => buffer,
    writeFile: (_path, content) => remote.client.call<void>({ op: 'write', path: remote.resolved.path, data: Buffer.from(content).toString('base64') }, false, true),
  } });
  try {
    const result = await native.execute('ssh-edit', { ...input, path: virtual }, remote.signal, undefined, memoryContext(remote));
    // Only rewrite algorithm-owned headers/messages, never diff body or user text.
    if (result.details?.patch) {
      const prefix = `--- ${virtual}\n+++ ${virtual}\n`;
      if (!result.details.patch.startsWith(prefix)) throw new Error('Unsupported native edit patch format');
      result.details.patch = `--- ${input.path}\n+++ ${input.path}\n${result.details.patch.slice(prefix.length)}`;
    }
    result.content = [{ type: 'text', text: `Successfully replaced ${input.edits.length} block(s) in ${input.path}.` }];
    return result;
  } catch (error) {
    if (error instanceof RemoteMutationUncertainError) throw error;
    throw new Error((error instanceof Error ? error.message : String(error)).replaceAll(virtual, input.path));
  }
}

async function lsRemote(input: LsToolInput, remote: RemoteContext) {
  const virtual = memoryPath();
  const entries = await remote.client.call<Array<{ name: string; directory: boolean | null }>>({ op: 'ls', path: remote.resolved.path });
  const byName = new Map(entries.map(entry => [entry.name, entry.directory]));
  const native = createLsToolDefinition('/', { operations: {
    exists: () => true,
    readdir: () => entries.map(entry => entry.name),
    stat: path => {
      if (path === virtual) return { isDirectory: () => true };
      const directory = byName.get(posix.basename(path));
      if (directory == null) throw new Error('Unable to stat entry');
      return { isDirectory: () => directory };
    },
  } });
  return native.execute('ssh-ls', { ...input, path: virtual }, remote.signal, undefined, memoryContext(remote));
}

export function createSshFileTools(getConfig: () => Config, readOptions?: Pick<ReadToolOptions, 'autoResizeImages'>) {
  return {
    read: withHost(createReadToolDefinition(process.cwd(), readOptions), getConfig, (input, remote) => readRemote(input, remote, readOptions)),
    write: withHost(createWriteToolDefinition(process.cwd()), getConfig, writeRemote),
    edit: withHost(createEditToolDefinition(process.cwd()), getConfig, editRemote),
    find: withHost(createFindToolDefinition(process.cwd()), getConfig, (input, remote) =>
      remoteFind(input, remote.resolved.path, request => remote.client.call(request, true))),
    grep: withHost(createGrepToolDefinition(process.cwd()), getConfig, (input, remote) =>
      remoteGrep(input, remote.resolved.path, request => remote.client.call(request, true))),
    ls: withHost(createLsToolDefinition(process.cwd()), getConfig, lsRemote),
  };
}
