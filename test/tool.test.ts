import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBashToolDefinition, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createSshBashTool } from '../src/tool.ts';
import { resolveConfig } from '../src/config.ts';

export function context(cwd: string): ExtensionContext {
  return { cwd, sessionManager: { getSessionId: () => 'test-session', getSessionFile: () => undefined },
    model: { provider: 'test', id: 'test-model' }, thinkingLevel: 'low' } as unknown as ExtensionContext;
}

const text = (result: { content: Array<{ type: string; text?: string }> }) => result.content.map(c => c.text ?? '').join('');

test('local route exactly preserves built-in results, cwd and session environment', async () => {
  const ctx = context(tmpdir());
  const builtin = createBashToolDefinition(ctx.cwd);
  const tool = createSshBashTool(() => resolveConfig({}, {}));
  const input = { command: 'printf "%s\\n" "$PWD" "$PI_SESSION_ID" "$PI_MODEL"; printf stderr >&2' };
  const expected = await builtin.execute('base', input, undefined, undefined, ctx);
  assert.deepEqual(await tool.execute('test', input, undefined, undefined, ctx), expected);
  assert.match(text(expected), /test-session\ntest-model/);
  await assert.rejects(tool.execute('test', { command: 'printf failed >&2; exit 7' }, undefined, undefined, ctx), /failed[\s\S]*code 7/);
});

test('fake SSH integration: routing, streaming, quoting, truncation, failure and cancellation', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pi-ssh-tool-')));
  const oldPath = process.env.PATH;
  try {
    writeFileSync(join(dir, 'ssh'), '#!/bin/sh\nfor arg do last=$arg; done\ncd /\nexec /bin/sh -c "$last"\n', { mode: 0o700 });
    process.env.PATH = `${dir}:${oldPath}`;
    const ctx = context(dir);
    const tool = createSshBashTool(() => resolveConfig({ host: 'build' }, {}));
    const run = (input: { command: string; host?: string; cwd?: string; timeout?: number }, signal?: AbortSignal) =>
      tool.execute('test', input, signal, undefined, ctx);
    assert.equal(text(await run({ command: 'pwd' })).trim(), '/');
    assert.equal(text(await run({ command: 'pwd', host: 'local' })).trim(), dir);
    assert.equal(text(await run({ command: 'pwd', cwd: dir })).trim(), dir);
    assert.equal(text(await run({ command: "printf '%s' \"it's a \\$HOME\"" })), "it's a $HOME");
    const updates: string[] = [];
    const result = await tool.execute('test', { command: 'printf out; printf err >&2' }, undefined,
      update => updates.push(text(update)), ctx);
    assert.match(text(result), /out/);
    assert.match(text(result), /err/);
    assert.ok(updates.some(value => value.includes('out')));
    const large = await run({ command: "printf '%060000d' 0" });
    assert.ok(large.details?.truncation?.truncated);
    assert.ok(text(large).length < 52_000);
    assert.equal(readFileSync(large.details!.fullOutputPath!, 'utf8').length, 60000);
    rmSync(large.details!.fullOutputPath!);
    const lines = await run({ command: 'for ((i=0;i<2100;i++)); do echo "$i"; done' });
    assert.equal(lines.details?.truncation?.truncatedBy, 'lines');
    rmSync(lines.details!.fullOutputPath!);
    await assert.rejects(run({ command: 'printf remote-error >&2; exit 23' }), /remote-error[\s\S]*code 23/);
    await assert.rejects(run({ command: 'printf before; sleep 10', timeout: 0.2 }), /before[\s\S]*timed out after 0.2/);
    await assert.rejects(run({ command: 'sleep 10' }, AbortSignal.timeout(200)), /aborted/);
    await assert.rejects(run({ command: 'touch NEVER' }, AbortSignal.abort()), /aborted/);
    await assert.rejects(run({ command: 'true', timeout: -1 }), /Invalid timeout/);
    await assert.rejects(run({ command: 'true', host: '-bad' }), /host/);
    await assert.rejects(run({ command: 'true', cwd: '/nonexistent-pi-ssh-path' }), /code 1/);
    writeFileSync(join(dir, 'ssh'), '#!/bin/sh\nprintf transport-error >&2\nexit 255\n', { mode: 0o700 });
    await assert.rejects(run({ command: 'true' }), /transport-error[\s\S]*code 255/);
  } finally {
    process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid configuration blocks execution; schema explains remote-only cwd and local override', async () => {
  const tool = createSshBashTool(() => { throw new Error('Invalid SSH configuration'); });
  await assert.rejects(tool.execute('test', { command: 'true' }, undefined, undefined, context(tmpdir())), /Invalid SSH/);
  assert.match(JSON.stringify(tool.parameters.properties.host), /local/);
  assert.match(JSON.stringify(tool.parameters.properties.cwd), /remote/i);
  assert.match(tool.description, /2000/);
  assert.match(tool.description, /50/);
});
