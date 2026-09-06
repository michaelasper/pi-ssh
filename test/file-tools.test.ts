import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, readFileSync, symlinkSync, linkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition,
  createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { createSshFileTools } from '../src/file-tools.ts';
import { fileFixture, text } from './file-fixture.ts';
import { tinyPng } from './images.ts';

const config = (host = 'local', cwd?: string) => ({ host, cwd, connectTimeout: 10 });
const png = tinyPng();

test('all six schemas add only optional host and local routes delegate to native with live cwd', async () => {
  const f = fileFixture();
  try {
    const tools = createSshFileTools(() => config('alpha'));
    const natives = {
      read: createReadToolDefinition('/unused'), write: createWriteToolDefinition('/unused'), edit: createEditToolDefinition('/unused'),
      find: createFindToolDefinition('/unused'), grep: createGrepToolDefinition('/unused'), ls: createLsToolDefinition('/unused'),
    };
    for (const name of Object.keys(tools) as Array<keyof typeof tools>) {
      const { host, ...properties } = tools[name].parameters.properties;
      assert.equal(host.type, 'string');
      assert.deepEqual(properties, natives[name].parameters.properties);
      assert.deepEqual(tools[name].parameters.required, natives[name].parameters.required);
      assert.ok(!('cwd' in properties));
    }
    writeFileSync(join(f.ctx.cwd, 'source.txt'), 'one\ntwo\nthree\n');
    for (const [name, input] of [
      ['read', { path: 'source.txt', offset: 2, limit: 1 }], ['ls', {}],
      ['find', { pattern: '*.txt' }], ['grep', { pattern: 'two' }],
      ['write', { path: 'new/created.txt', content: 'data' }],
    ] as const) {
      const native = natives[name] as ToolDefinition<any, any, any>;
      const tool = tools[name] as ToolDefinition<any, any, any>;
      assert.deepEqual(await tool.execute('test', { ...input, host: 'local' }, undefined, undefined, f.ctx),
        await native.execute('test', input, undefined, undefined, f.ctx));
    }
    const edits = { path: 'source.txt', edits: [{ oldText: 'one', newText: 'ONE' }, { oldText: 'three', newText: 'THREE' }] };
    const result = await tools.edit.execute('test', { ...edits, host: 'local' }, undefined, undefined, f.ctx);
    writeFileSync(join(f.ctx.cwd, 'source.txt'), 'one\ntwo\nthree\n');
    assert.deepEqual(result, await natives.edit.execute('test', edits, undefined, undefined, f.ctx));
    assert.equal(text(await createSshFileTools(() => config()).read.execute('test', { path: 'source.txt' }, undefined, undefined, f.ctx)), 'ONE\ntwo\nTHREE\n');
    const live = { ...f.ctx, cwd: join(f.root, 'beta/work') };
    writeFileSync(join(live.cwd, 'source.txt'), 'live cwd');
    assert.equal(text(await tools.read.execute('test', { path: 'source.txt', host: 'local' }, undefined, undefined, live)), 'live cwd');
  } finally { f.cleanup(); }
});

test('remote defaults, explicit override, home/cwd paths, contents, pagination and native images', async () => {
  const f = fileFixture();
  try {
    const tools = createSshFileTools(() => config('alpha'));
    const run = (tool: { execute: (...args: any[]) => Promise<any> }, input: any, signal?: AbortSignal) => tool.execute('test', input, signal, undefined, f.ctx);
    writeFileSync(join(f.ctx.cwd, 'same.txt'), 'LOCAL');
    await run(tools.write, { path: 'same.txt', content: 'ALPHA' });
    await run(tools.write, { path: 'same.txt', host: 'beta', content: 'BETA' });
    assert.equal(text(await run(tools.read, { path: 'same.txt' })), 'ALPHA');
    assert.equal(text(await run(tools.read, { path: '~/same.txt', host: 'beta' })), 'BETA');
    assert.equal(text(await run(tools.read, { path: 'same.txt', host: 'local' })), 'LOCAL');
    assert.equal(readFileSync(join(f.ctx.cwd, 'same.txt'), 'utf8'), 'LOCAL');
    const cwd = join(f.root, 'alpha/work');
    const configured = createSshFileTools(() => config('beta', cwd));
    await run(configured.write, { host: 'alpha', path: 'nested/a.txt', content: 'one\ntwo\nthree' });
    assert.equal(readFileSync(join(cwd, 'nested/a.txt'), 'utf8'), 'one\ntwo\nthree');
    const page = await run(configured.read, { host: 'alpha', path: '@nested/a.txt', offset: 2, limit: 1 });
    assert.equal(text(page), 'two\n\n[1 more lines in file. Use offset=3 to continue.]');
    await assert.rejects(run(configured.read, { host: 'alpha', path: 'nested/a.txt', offset: 20 }), /beyond end/);
    const lines = Array.from({ length: 2200 }, (_, n) => `line ${n}`).join('\n');
    await run(tools.write, { path: 'long', content: lines });
    const large = await run(tools.read, { path: 'long' });
    assert.equal(large.details.truncation.outputLines, 2000);
    await run(tools.write, { path: "a ' $(touch NEVER)", content: 'x'.repeat(60000) });
    const wide = await run(tools.read, { path: "a ' $(touch NEVER)" });
    assert.equal(wide.details.truncation.firstLineExceedsLimit, true);
    assert.match(text(wide), /host="alpha"/);
    assert.equal(existsSync(join(f.root, 'alpha/home/NEVER')), false);
    writeFileSync(join(f.root, 'alpha/home/picture.png'), png);
    writeFileSync(join(f.ctx.cwd, 'picture.png'), png);
    const image = await run(tools.read, { path: 'picture.png' });
    assert.ok(image.content.some((c: { type: string }) => c.type === 'image'));
    assert.deepEqual(image, await run(tools.read, { path: 'picture.png', host: 'local' }));
    const noVision = Object.create(f.ctx);
    Object.defineProperty(noVision, 'model', { value: { input: ['text'] } });
    const noVisionRemote = await tools.read.execute('image', { path: 'picture.png' }, undefined, undefined, noVision);
    assert.deepEqual(noVisionRemote, await tools.read.execute('image', { path: 'picture.png', host: 'local' }, undefined, undefined, noVision));
    assert.match(text(noVisionRemote), /model does not support images/);
    await assert.rejects(run(tools.write, { path: 'same.txt', content: 'WRONG', host: 'unreachable' }), /publickey/);
    await assert.rejects(run(tools.write, { path: 'same.txt', content: 'WRONG' }, AbortSignal.abort()), /aborted/);
    assert.equal(text(await run(tools.read, { path: 'same.txt' })), 'ALPHA');
    assert.equal(readFileSync(join(f.ctx.cwd, 'same.txt'), 'utf8'), 'LOCAL');
  } finally { f.cleanup(); }
});

test('remote edits preserve native diff/patch/BOM/CRLF, atomic validation, compatibility preparation and mutation serialization', async () => {
  const f = fileFixture();
  try {
    const tools = createSshFileTools(() => config('alpha'));
    const remoteFile = join(f.root, 'alpha/home/edit.txt');
    const initial = '\ufeffone\r\ntwo\r\nthree\r\n';
    writeFileSync(remoteFile, initial);
    writeFileSync(join(f.ctx.cwd, 'edit.txt'), initial);
    const input = { path: 'edit.txt', edits: [{ oldText: 'one', newText: 'two' }, { oldText: 'two', newText: 'one' }] };
    const result = await tools.edit.execute('test', input, undefined, undefined, f.ctx);
    const native = await createEditToolDefinition(f.ctx.cwd).execute('test', input, undefined, undefined, f.ctx);
    assert.deepEqual(result, native);
    assert.equal(readFileSync(remoteFile, 'utf8'), '\ufefftwo\r\none\r\nthree\r\n');
    const before = readFileSync(remoteFile, 'utf8');
    for (const edits of [[], [{ oldText: 'absent', newText: 'x' }], [{ oldText: 'two\r\none', newText: 'x' }, { oldText: 'one', newText: 'y' }]]) {
      await assert.rejects(tools.edit.execute('test', { path: 'edit.txt', edits }, undefined, undefined, f.ctx));
      assert.equal(readFileSync(remoteFile, 'utf8'), before);
    }
    writeFileSync(remoteFile, 'repeat repeat');
    await assert.rejects(tools.edit.execute('test', { path: 'edit.txt', edits: [{ oldText: 'repeat', newText: 'x' }] }, undefined, undefined, f.ctx), /occurrences|unique/);
    assert.equal(readFileSync(remoteFile, 'utf8'), 'repeat repeat');
    assert.deepEqual(tools.edit.prepareArguments!({ path: 'edit.txt', host: 'beta', oldText: 'x', newText: 'y' }),
      { path: 'edit.txt', host: 'beta', edits: [{ oldText: 'x', newText: 'y' }] });
    writeFileSync(remoteFile, 'first\nsecond');
    symlinkSync(remoteFile, join(f.root, 'alpha/home/alias.txt'));
    await Promise.all([
      tools.edit.execute('first', { path: 'edit.txt', edits: [{ oldText: 'first', newText: 'FIRST' }] }, undefined, undefined, f.ctx),
      tools.edit.execute('second', { path: 'alias.txt', edits: [{ oldText: 'second', newText: 'SECOND' }] }, undefined, undefined, f.ctx),
    ]);
    assert.equal(readFileSync(remoteFile, 'utf8'), 'FIRST\nSECOND');
    await Promise.all([
      tools.write.execute('write', { path: 'edit.txt', content: 'fresh' }, undefined, undefined, f.ctx),
      tools.edit.execute('edit', { path: 'alias.txt', edits: [{ oldText: 'fresh', newText: 'edited' }] }, undefined, undefined, f.ctx),
    ]);
    assert.equal(readFileSync(remoteFile, 'utf8'), 'edited');
    linkSync(remoteFile, join(f.root, 'alpha/home/hardlink.txt'));
    await Promise.all([
      tools.write.execute('write', { path: 'edit.txt', content: 'hardlink fresh' }, undefined, undefined, f.ctx),
      tools.edit.execute('edit', { path: 'hardlink.txt', edits: [{ oldText: 'fresh', newText: 'edited' }] }, undefined, undefined, f.ctx),
    ]);
    assert.equal(readFileSync(remoteFile, 'utf8'), 'hardlink edited');
  } finally { f.cleanup(); }
});

test('uncertain remote edits block subsequent mutations, including hard-link aliases, but not reads or other hosts', async () => {
  const f = fileFixture();
  try {
    const tools = createSshFileTools(() => config('drop-write'));
    const remoteFile = join(f.root, 'drop-write/home/file');
    writeFileSync(remoteFile, 'before');
    linkSync(remoteFile, join(f.root, 'drop-write/home/alias'));
    const edit = tools.edit.execute('lost-ack', { path: 'file', edits: [{ oldText: 'before', newText: 'after' }] }, undefined, undefined, f.ctx);
    const queued = tools.write.execute('queued', { path: 'alias', content: 'must not overwrite' }, undefined, undefined, f.ctx);
    await Promise.all([assert.rejects(edit, /outcome is unknown.*restart pi/), assert.rejects(queued, /outcome is unknown.*restart pi/)]);
    assert.equal(readFileSync(remoteFile, 'utf8'), 'uncertain');
    assert.equal(text(await tools.read.execute('inspect', { path: 'file' }, undefined, undefined, f.ctx)), 'uncertain');
    await tools.write.execute('other-host', { host: 'alpha', path: 'file', content: 'independent' }, undefined, undefined, f.ctx);
    assert.equal(readFileSync(join(f.root, 'alpha/home/file'), 'utf8'), 'independent');
  } finally { f.cleanup(); }
});

test('remote ls preserves ordering, hidden entries, symlink stats, limits and errors', async () => {
  const f = fileFixture();
  try {
    const root = join(f.root, 'alpha/home');
    for (const name of ['z', 'A', '.hidden']) writeFileSync(join(root, name), name);
    mkdirSync(join(root, 'directory'));
    symlinkSync(join(root, 'directory'), join(root, 'link'));
    symlinkSync(join(root, 'absent'), join(root, 'broken'));
    const tools = createSshFileTools(() => config('alpha'));
    const native = createLsToolDefinition(root);
    for (const limit of [undefined, 2, 0, 1.5, -1]) {
      const input = { path: '.', limit };
      assert.deepEqual(await tools.ls.execute('test', input, undefined, undefined, f.ctx),
        await native.execute('test', input, undefined, undefined, { ...f.ctx, cwd: root }));
    }
    await assert.rejects(tools.ls.execute('test', { path: 'absent' }, undefined, undefined, f.ctx), /Path not found/);
    await assert.rejects(tools.ls.execute('test', { path: 'z' }, undefined, undefined, f.ctx), /Not a directory/);
  } finally { f.cleanup(); }
});
