import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, rmSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createSshBashTool } from '../src/tool.ts';
import { resolveConfig } from '../src/config.ts';
import { quote } from '../src/ssh.ts';
import { createSshFileTools } from '../src/file-tools.ts';
import { RemoteClient } from '../src/remote.ts';
import { tinyPng } from './images.ts';

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

test('real SSH file tools: all routes, native contracts, host-local isolation and cleanup', { timeout: 120000 }, async () => {
  const root = text(await run('mktemp -d /tmp/pi-ssh-files.XXXXXXXX')).trim();
  assert.match(root, /^\/tmp\/pi-ssh-files\.[a-zA-Z0-9]+$/);
  const localRoot = mkdtempSync(join(tmpdir(), 'pi-ssh-local-files-'));
  const fileCtx = { ...ctx, cwd: localRoot };
  const files = createSshFileTools(() => resolveConfig({ host, cwd: root }, {}));
  const explicit = createSshFileTools(() => resolveConfig({ host: 'local', cwd: root }, {}));
  try {
    for (const [tools, extras] of [[files, {}], [explicit, { host }]] as const) {
      // Every remote tool is exercised both via configured default and explicit override.
      const input = { path: 'same.txt', content: 'one\ntwo\nthree\n', ...extras };
      writeFileSync(join(localRoot, 'same.txt'), 'LOCAL');
      await tools.write.execute('write', input, undefined, undefined, fileCtx);
      assert.equal(text(await tools.read.execute('read', { path: 'same.txt', ...extras }, undefined, undefined, fileCtx)), input.content);
      const edited = await tools.edit.execute('edit', { path: 'same.txt', edits: [
        { oldText: 'one', newText: 'ONE' }, { oldText: 'three', newText: 'THREE' },
      ], ...extras }, undefined, undefined, fileCtx);
      assert.match(edited.details!.diff, /ONE/);
      assert.match(edited.details!.patch!, /^--- same.txt\n\+\+\+ same.txt\n/);
      assert.equal(text(await tools.find.execute('find', { pattern: '*.txt', ...extras }, undefined, undefined, fileCtx)), 'same.txt');
      assert.equal(text(await tools.grep.execute('grep', { pattern: 'ONE', ...extras }, undefined, undefined, fileCtx)), 'same.txt:1: ONE');
      assert.equal(text(await tools.ls.execute('ls', { ...extras }, undefined, undefined, fileCtx)), 'same.txt');
      assert.equal(readFileSync(join(localRoot, 'same.txt'), 'utf8'), 'LOCAL');
    }
    // Explicit local always wins, for all six tools even with the SSH default.
    await files.write.execute('local', { host: 'local', path: 'local.txt', content: 'LOCAL' }, undefined, undefined, fileCtx);
    await files.edit.execute('local', { host: 'local', path: 'local.txt', edits: [{ oldText: 'LOCAL', newText: 'LOCAL_EDITED' }] }, undefined, undefined, fileCtx);
    assert.equal(text(await files.read.execute('local', { host: 'local', path: 'local.txt' }, undefined, undefined, fileCtx)), 'LOCAL_EDITED');
    assert.match(text(await files.find.execute('local', { host: 'local', pattern: 'local.txt' }, undefined, undefined, fileCtx)), /local.txt/);
    assert.match(text(await files.grep.execute('local', { host: 'local', pattern: 'LOCAL_EDITED' }, undefined, undefined, fileCtx)), /local.txt:1: LOCAL_EDITED/);
    assert.match(text(await files.ls.execute('local', { host: 'local' }, undefined, undefined, fileCtx)), /local.txt/);
    assert.equal(text(await run(`test ! -e ${quote(`${root}/local.txt`)} && printf isolated`)), 'isolated');
    const hostile = "sub dir/a ' $HOME $(touch NEVER) `touch NEVER` λ.txt";
    await files.write.execute('quoted', { path: hostile, content: '\ufefffirst\r\nsecond\r\n' }, undefined, undefined, fileCtx);
    await files.edit.execute('quoted', { path: hostile, edits: [{ oldText: 'first', newText: 'FIRST' }] }, undefined, undefined, fileCtx);
    assert.equal(text(await files.read.execute('quoted', { path: hostile }, undefined, undefined, fileCtx)), '\ufeffFIRST\r\nsecond\r\n');
    assert.match(text(await files.find.execute('quoted', { pattern: 'sub dir/**/*.txt' }, undefined, undefined, fileCtx)), /\$HOME/);
    assert.match(text(await files.grep.execute('quoted', { pattern: 'FIRST', path: hostile }, undefined, undefined, fileCtx)), /FIRST/);
    assert.match(text(await files.ls.execute('quoted', { path: 'sub dir' }, undefined, undefined, fileCtx)), /\$HOME/);
    assert.equal(text(await run(`test ! -e ${quote(`${root}/NEVER`)} && printf safe`)), 'safe');
    assert.equal(existsSync(join(localRoot, 'sub dir')), false);
    const home = text(await run('pwd')).trim();
    const homePath = `~/${posix.relative(home, root)}/same.txt`;
    assert.equal(text(await files.read.execute('home', { path: homePath }, undefined, undefined, fileCtx)), 'ONE\ntwo\nTHREE\n');
    const loginFiles = createSshFileTools(() => resolveConfig({ host }, {}));
    assert.equal(text(await loginFiles.read.execute('login', { path: `${posix.relative(home, root)}/same.txt` }, undefined, undefined, fileCtx)), 'ONE\ntwo\nTHREE\n');
    assert.equal(text(await files.read.execute('absolute', { path: `${root}/same.txt`, offset: 2, limit: 1 }, undefined, undefined, fileCtx)), 'two\n\n[2 more lines in file. Use offset=3 to continue.]');
    await assert.rejects(files.read.execute('offset', { path: 'same.txt', offset: 99 }, undefined, undefined, fileCtx), /beyond end/);
    await assert.rejects(files.edit.execute('invalid', { path: 'same.txt', edits: [
      { oldText: 'ONE\ntwo', newText: 'x' }, { oldText: 'two', newText: 'y' },
    ] }, undefined, undefined, fileCtx));
    await run(`ln -s ${quote(`${root}/same.txt`)} ${quote(`${root}/alias.txt`)}`);
    await Promise.all([
      files.edit.execute('first', { path: 'same.txt', edits: [{ oldText: 'ONE', newText: 'one' }] }, undefined, undefined, fileCtx),
      files.edit.execute('second', { path: 'alias.txt', edits: [{ oldText: 'THREE', newText: 'three' }] }, undefined, undefined, fileCtx),
    ]);
    assert.equal(text(await files.read.execute('concurrent', { path: 'same.txt' }, undefined, undefined, fileCtx)), 'one\ntwo\nthree\n');
    await run(`ln ${quote(`${root}/same.txt`)} ${quote(`${root}/hardlink.txt`)}`);
    await Promise.all([
      files.write.execute('hardlink-write', { path: 'same.txt', content: 'fresh' }, undefined, undefined, fileCtx),
      files.edit.execute('hardlink-edit', { path: 'hardlink.txt', edits: [{ oldText: 'fresh', newText: 'edited' }] }, undefined, undefined, fileCtx),
    ]);
    assert.equal(text(await files.read.execute('hardlink', { path: 'same.txt' }, undefined, undefined, fileCtx)), 'edited');
    await files.write.execute('large', { path: 'large.txt', content: 'match\n'.repeat(2200) }, undefined, undefined, fileCtx);
    assert.ok((await files.read.execute('large', { path: 'large.txt' }, undefined, undefined, fileCtx)).details?.truncation?.truncated);
    assert.equal((await files.grep.execute('limit', { path: 'large.txt', pattern: 'match', limit: 2 }, undefined, undefined, fileCtx)).details?.matchLimitReached, 2);
    assert.equal((await files.find.execute('limit', { pattern: '*.txt', limit: 1 }, undefined, undefined, fileCtx)).details?.resultLimitReached, 1);
    assert.equal((await files.ls.execute('limit', { limit: 1 }, undefined, undefined, fileCtx)).details?.entryLimitReached, 1);
    // Binary setup uses the same safe transport; read returns pi's native image result.
    await new RemoteClient(host!, 10).call({ op: 'write', path: `${root}/image.png`, data: tinyPng().toString('base64') }, false, true);
    assert.ok((await files.read.execute('image', { path: 'image.png' }, undefined, undefined, fileCtx)).content.some(c => c.type === 'image'));
    await assert.rejects(files.write.execute('cancel', { path: 'never', content: 'never' }, AbortSignal.abort(), undefined, fileCtx), /aborted/);
    assert.equal(text(await run(`test ! -e ${quote(`${root}/never`)} && printf clean`)), 'clean');
    await assert.rejects(files.read.execute('missing', { path: 'missing' }, undefined, undefined, fileCtx), /No such file/);
    // Even a remote bash overflow produces a LOCAL artifact, readable with host=local.
    const overflow = await run("printf '%060000d' 0");
    try {
      const artifact = await files.read.execute('artifact', { path: overflow.details!.fullOutputPath!, host: 'local' }, undefined, undefined, fileCtx);
      assert.ok(artifact.details?.truncation?.firstLineExceedsLimit);
    } finally { rmSync(overflow.details!.fullOutputPath!); }
  } finally {
    try {
      await run(`rm -rf -- ${quote(root)}`);
      assert.equal(text(await run(`test ! -e ${quote(root)} && printf cleaned`)), 'cleaned');
    } finally { rmSync(localRoot, { recursive: true, force: true }); }
  }
});
