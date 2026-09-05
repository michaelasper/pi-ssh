import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import extension from '../src/index.ts';
import type { createSshBashTool } from '../src/tool.ts';

test('registers only bash and three flags; resolves defaults after flags become available', async () => {
  const events = new Map<string, Function>();
  const flags: string[] = [];
  let ready = false;
  let tool!: ReturnType<typeof createSshBashTool>;
  const api = {
    registerTool: (value: typeof tool) => { tool = value; },
    registerFlag: (name: string) => { flags.push(name); },
    getFlag: (name: string) => { assert.ok(ready); return name === 'ssh-host' ? 'build' : undefined; },
    on: (name: string, handler: Function) => { events.set(name, handler); },
  } as unknown as ExtensionAPI;
  extension(api);
  assert.equal(tool.name, 'bash');
  assert.deepEqual(flags, ['ssh-host', 'ssh-cwd', 'ssh-connect-timeout']);
  assert.deepEqual([...events.keys()], ['session_start', 'before_agent_start']);
  await assert.rejects(tool.execute('test', { command: 'true' }, undefined, undefined, {} as ExtensionContext), /not initialized/);
  ready = true;
  await events.get('session_start')!({}, { cwd: tmpdir(), isProjectTrusted: () => false });
  const prompt = await events.get('before_agent_start')!({ systemPrompt: 'Original prompt.' }, {});
  assert.ok(prompt.systemPrompt.startsWith('Original prompt.'));
  assert.match(prompt.systemPrompt, /build/);
  assert.match(prompt.systemPrompt, /remain local/);
  assert.match(prompt.systemPrompt, /host="local"/);
});

test('bad configuration remains blocked across startup and reports a useful model instruction', async () => {
  const events = new Map<string, Function>();
  let tool!: ReturnType<typeof createSshBashTool>;
  extension({
    registerTool: (value: typeof tool) => { tool = value; }, registerFlag: () => {},
    getFlag: (name: string) => name === 'ssh-host' ? '-bad' : undefined,
    on: (name: string, handler: Function) => events.set(name, handler),
  } as unknown as ExtensionAPI);
  await events.get('session_start')!({}, {});
  await assert.rejects(tool.execute('test', { command: 'true' }, undefined, undefined, {} as ExtensionContext), /Invalid SSH host/);
  const prompt = await events.get('before_agent_start')!({ systemPrompt: '' }, {});
  assert.match(prompt.systemPrompt, /blocked/i);
});

test('local shell settings honour project trust; prefix and custom shell never apply remotely', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-ssh-settings-'));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousPath = process.env.PATH;
  try {
    const agent = join(root, 'agent');
    mkdirSync(agent);
    mkdirSync(join(root, '.pi'));
    const shell = join(root, 'custom-bash');
    writeFileSync(shell, '#!/bin/sh\nexport PI_SSH_SHELL_TEST=custom\nexec /bin/bash "$@"\n', { mode: 0o700 });
    writeFileSync(join(root, 'ssh'), '#!/bin/sh\nfor arg do last=$arg; done\nexec /bin/sh -c "$last"\n', { mode: 0o700 });
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ shellPath: shell, shellCommandPrefix: 'export PI_SSH_PREFIX_TEST=global' }));
    writeFileSync(join(root, '.pi/settings.json'), JSON.stringify({ shellCommandPrefix: 'export PI_SSH_PREFIX_TEST=project' }));
    process.env.PI_CODING_AGENT_DIR = agent;
    process.env.PATH = `${root}:${previousPath}`;
    const events = new Map<string, Function>();
    let tool!: ReturnType<typeof createSshBashTool>;
    extension({ registerTool: (value: typeof tool) => { tool = value; }, registerFlag: () => {}, getFlag: () => undefined,
      on: (name: string, handler: Function) => events.set(name, handler) } as unknown as ExtensionAPI);
    let trusted = false;
    const ctx = { cwd: root, isProjectTrusted: () => trusted,
      sessionManager: { getSessionId: () => 'test', getSessionFile: () => undefined } } as unknown as ExtensionContext;
    const run = async (host: string) => {
      const result = await tool.execute('test', { command: 'printf "%s:%s" "${PI_SSH_PREFIX_TEST-unset}" "${PI_SSH_SHELL_TEST-unset}"', host }, undefined, undefined, ctx);
      return result.content.map(c => c.type === 'text' ? c.text : '').join('');
    };
    await events.get('session_start')!({}, ctx);
    assert.equal(await run('local'), 'global:custom');
    trusted = true;
    await events.get('session_start')!({}, ctx);
    assert.equal(await run('local'), 'project:custom');
    assert.equal(await run('build'), 'unset:unset');
  } finally {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});
