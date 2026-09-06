import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RemoteClient, RemoteMutationQueue, remotePathInput } from '../src/remote.ts';
import { fileFixture } from './file-fixture.ts';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

test('remote paths use selected home/login/cwd, canonical symlinks, screenshot variants and literal data', async () => {
  const f = fileFixture();
  try {
    const client = new RemoteClient('alpha', 10);
    const home = join(f.root, 'alpha/home');
    assert.equal((await client.resolve('~/a', undefined)).path, `${home}/a`);
    assert.equal((await client.resolve('@./x/../a', undefined)).path, `${home}/a`);
    assert.equal((await client.resolve('a', `${f.root}/alpha/work`)).path, `${f.root}/alpha/work/a`);
    assert.equal((await client.resolve('/absolute/$HOME', undefined)).path, '/absolute/$HOME');
    assert.equal((await client.resolve('~other/a', undefined)).path, `${home}/~other/a`);
    assert.equal(remotePathInput('@\u00a0a'), ' a');
    assert.equal(remotePathInput(pathToFileURL('/foo bar').href), '/foo bar');
    assert.throws(() => remotePathInput('a\0b'), /NUL/);
    mkdirSync(`${home}/real`);
    symlinkSync(`${home}/real`, `${home}/alias`);
    assert.equal((await client.resolve('alias/new', undefined)).canonical, `${home}/real/new`);
    const screenshot = `${home}/Capture d’écran 10.00.00\u202fAM.png`;
    writeFileSync(screenshot, 'image');
    assert.equal((await client.resolve('Capture d’écran 10.00.00 AM.png', undefined, true)).path, screenshot);
    const name = `${home}/a ' \" $HOME $(touch NEVER) \`touch NEVER\`\nλ`;
    const content = 'Literal $(touch NEVER)\n\0λ' + 'x'.repeat(300000);
    await client.call({ op: 'write', path: name, data: Buffer.from(content).toString('base64') }, false, true);
    assert.equal(Buffer.from(await client.call<string>({ op: 'read', path: name }), 'base64').toString(), content);
    assert.equal(existsSync(`${home}/NEVER`), false);
  } finally { f.cleanup(); }
});

test('transport failures, malformed stdout, missing paths, pre/active cancellation do not fall back', async () => {
  const f = fileFixture();
  try {
    await assert.rejects(new RemoteClient('unreachable', 10).resolve('a', undefined), /publickey/);
    await assert.rejects(new RemoteClient('missing-python', 10).resolve('a', undefined), /require Python 3.9\+.*install it explicitly/);
    await assert.rejects(new RemoteClient('bad-protocol', 10).resolve('a', undefined), /SSH.*JSON|SSH.*Unexpected/);
    await assert.rejects(new RemoteClient('alpha', 10).call({ op: 'read', path: '/missing-pi-ssh-test-file' }), /No such file/);
    assert.throws(() => new RemoteClient('-unsafe', 10), /Invalid SSH host/);
    assert.throws(() => new RemoteClient('local', 10), /cannot target local/);
    assert.throws(() => new RemoteClient('alpha', 10, AbortSignal.abort()).resolve('never', undefined), /aborted/);
    await assert.rejects(new RemoteClient('hang', 10, AbortSignal.timeout(100)).resolve('never', undefined), /aborted/);
    const start = performance.now();
    await assert.rejects(new RemoteClient('delay', 10, AbortSignal.timeout(100)).call({ op: 'write' }, false, true), /aborted/);
    assert.ok(performance.now() - start >= 350, 'active mutations must settle before abort releases their queue');
  } finally { f.cleanup(); }
});

test('mutation queue preserves registration order, canonical aliases, independent hosts/files, failures and aborts', async () => {
  const q = new RemoteMutationQueue();
  const slowResolve = deferred();
  const active = deferred();
  const started = deferred();
  const order: string[] = [];
  const path = (canonical: string) => ({ path: canonical, canonical });
  const first = q.run('alpha', async () => { await slowResolve.promise; return path('/file'); }, async () => {
    order.push('first'); started.resolve(); await active.promise; throw new Error('failed');
  });
  // Attach rejection handling immediately, not after releasing a deferred promise.
  const failed = assert.rejects(first, /failed/);
  const second = q.run('alpha', async () => path('/file'), async () => { order.push('second'); });
  await q.run('beta', async () => path('/file'), async () => { order.push('other-host'); });
  assert.deepEqual(order, ['other-host']);
  slowResolve.resolve();
  await started.promise;
  await q.run('alpha', async () => path('/different'), async () => { order.push('other-file'); });
  const controller = new AbortController();
  const cancelled = assert.rejects(q.run('alpha', async () => path('/file'), async () => { assert.fail('cancelled mutation ran'); }, controller.signal), /aborted/);
  controller.abort();
  active.resolve();
  await Promise.all([failed, second, cancelled]);
  assert.deepEqual(order, ['other-host', 'first', 'other-file', 'second']);
  await assert.rejects(q.run('alpha', async () => { throw new Error('resolution failed'); }, async () => {}), /resolution failed/);
  await q.run('alpha', async () => path('/file'), async () => { order.push('recovered'); });
  assert.equal(order.at(-1), 'recovered');
});
