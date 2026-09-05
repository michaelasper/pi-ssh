import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createSshBashTool } from '../src/tool.ts';
import { resolveConfig } from '../src/config.ts';
import { quote } from '../src/ssh.ts';

const host = process.env.PI_SSH_TEST_HOST;
if (!host) throw new Error('Set PI_SSH_TEST_HOST to an authorized SSH target; this test is intentionally opt-in');
const tool = createSshBashTool(() => resolveConfig({ host }, {}));
const ctx = { cwd: tmpdir(), sessionManager: { getSessionId: () => 'ssh-e2e', getSessionFile: () => undefined } } as unknown as ExtensionContext;
const run = (command: string, extras: { host?: string; cwd?: string; timeout?: number } = {}, signal?: AbortSignal) =>
  tool.execute('e2e', { command, timeout: 15, ...extras }, signal, undefined, ctx);
const text = (result: Awaited<ReturnType<typeof run>>) => result.content.map(c => c.type === 'text' ? c.text : '').join('');

test('real SSH: success, cwd, quoting, failures, output limits, timeout and cancellation', { timeout: 60000 }, async () => {
  assert.equal(text(await run('printf pi-ssh-remote')), 'pi-ssh-remote');
  assert.equal(text(await run('printf pi-ssh-local', { host: 'local' })), 'pi-ssh-local');
  assert.equal(text(await run('printf pi-ssh-explicit', { host })), 'pi-ssh-explicit');
  const root = text(await run('mktemp -d /tmp/pi-ssh-e2e.XXXXXXXX')).trim();
  assert.match(root, /^\/tmp\/pi-ssh-e2e\.[a-zA-Z0-9]+$/);
  const cwd = `${root}/it's a $literal directory`;
  try {
    await run(`mkdir -- ${quote(cwd)}`);
    assert.equal(text(await run('pwd', { cwd })).trim(), cwd);
    assert.equal(text(await run(`printf '%s' ${quote("literal $HOME `id` 'quotes'\nλ")}`, { cwd })), "literal $HOME `id` 'quotes'\nλ");
    await assert.rejects(run('printf error >&2; exit 17'), /error[\s\S]*code 17/);
    await assert.rejects(run('printf SHOULD_NOT_RUN; true', { cwd: `${root}/missing` }), error =>
      error instanceof Error && /code 1/.test(error.message) && !error.message.includes('SHOULD_NOT_RUN'));
    const large = await run("printf '%060000d' 0");
    assert.ok(large.details?.truncation?.truncated);
    assert.equal(readFileSync(large.details!.fullOutputPath!, 'utf8').length, 60000);
    rmSync(large.details!.fullOutputPath!);
    // Bounded sleeps: even if remote descendants survive disconnect, they exit within 3 seconds.
    await assert.rejects(run('printf waiting; sleep 3', { timeout: 0.5 }), /waiting[\s\S]*timed out/);
    await assert.rejects(run('sleep 3', {}, AbortSignal.timeout(500)), /aborted/);
    await assert.rejects(run(`touch ${quote(`${root}/never`)}`, {}, AbortSignal.abort()), /aborted/);
    assert.equal(text(await run(`test ! -e ${quote(`${root}/never`)} && printf clean`)), 'clean');
  } finally {
    await run(`rm -rf -- ${quote(root)}`);
    assert.equal(text(await run(`test ! -e ${quote(root)} && printf cleaned`)), 'cleaned');
  }
});
