import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { createSshBashTool } from '../src/tool.ts';
import { resolveConfig } from '../src/config.ts';
import { createSshFileTools } from '../src/file-tools.ts';
import { visibleWidth } from '@earendil-works/pi-tui';

test('tool header distinguishes explicit/local/default targets and cwd without changing arguments', () => {
  initTheme('dark', false);
  const tool = createSshBashTool(() => resolveConfig({ host: 'build', cwd: '/srv/project' }, {}));
  const render = (input: { command?: string; host?: string; cwd?: string }) => {
    const original = { ...input };
    const component = tool.renderCall!(input, {} as Parameters<NonNullable<typeof tool.renderCall>>[1], {
      args: input, state: {}, executionStarted: false, expanded: false,
    } as Parameters<NonNullable<typeof tool.renderCall>>[2]);
    assert.deepEqual(input, original);
    for (const width of [40, 80, 120]) {
      assert.ok(component.render(width).every(line => stripVTControlCharacters(line).length <= width));
    }
    return component.render(200).map(stripVTControlCharacters).join('\n');
  };
  assert.match(render({ command: 'pwd' }), /build.*current default/);
  assert.match(render({ command: 'pwd' }), /\/srv\/project/);
  assert.match(render({ command: 'pwd', host: 'local' }), /Target: local/);
  assert.doesNotMatch(render({ command: 'pwd', host: 'local' }), /\/srv\/project/);
  assert.match(render({ command: 'pwd', host: 'other', cwd: '/tmp' }), /other[\s\S]*\/tmp/);
  assert.ok(render({}).includes('Target:'));
  assert.doesNotThrow(() => render({ host: '-unfinished' }));
});

test('all file headers show targets, wrap safely, retain native results and never preview remote edits locally', () => {
  initTheme('dark', false);
  const theme = { fg: (_color: string, value: string) => value, bg: (_color: string, value: string) => value,
    bold: (value: string) => value } as any;
  const tools = createSshFileTools(() => resolveConfig({ host: 'build', cwd: '/srv/project' }, {}));
  for (const tool of Object.values(tools)) {
    const input = { path: '/local-must-not-be-read/秘密.txt', pattern: '*.txt', edits: [{ oldText: 'a', newText: 'b' }] };
    const state = {};
    const context = { args: input, state, argsComplete: true, executionStarted: false, cwd: '/',
      expanded: false, invalidate: () => assert.fail('remote edit initiated a local preview') } as any;
    const call = tool.renderCall!(input as any, theme, context);
    const output = call.render(200).map(stripVTControlCharacters).join('\n');
    assert.match(output, /SSH "build".*current default/);
    assert.match(output, /\/srv\/project/);
    for (const width of [20, 40, 80, 120]) assert.ok(call.render(width).every(line => visibleWidth(line) <= width));
    assert.deepEqual(state, {}, 'remote header must not invoke native edit preview');
    assert.deepEqual(input.edits, [{ oldText: 'a', newText: 'b' }]);
    const local = tool.renderCall!({ ...input, host: 'local' } as any, theme, { ...context, argsComplete: false, state: {} });
    assert.match(local.render(200).map(stripVTControlCharacters).join('\n'), /Target: local/);
    const result = tool.renderResult!({ content: [{ type: 'text', text: 'done' }], details: { diff: '-1 before\n+1 after', firstChangedLine: 1 } } as any,
      { expanded: true, isPartial: false }, theme, { ...context, isError: false, showImages: false });
    assert.doesNotThrow(() => result.render(80));
  }
});

test('streaming an explicit remote host discards an earlier local edit preview component', () => {
  initTheme('dark', false);
  const theme = { fg: (_color: string, value: string) => value, bg: (_color: string, value: string) => value,
    bold: (value: string) => value } as any;
  const tool = createSshFileTools(() => resolveConfig({}, {})).edit;
  const partial = { path: 'file.txt', edits: [{ oldText: 'before', newText: 'after' }] };
  const state: { callComponent?: unknown } = {};
  const context = { args: partial, state, argsComplete: false, executionStarted: false, cwd: '/',
    expanded: false, invalidate: () => assert.fail('must not preview a remote file locally') } as any;
  tool.renderCall!(partial, theme, context);
  assert.ok(state.callComponent);
  const input = { ...partial, host: 'build' };
  tool.renderCall!(input, theme, { ...context, args: input, argsComplete: true });
  assert.equal(state.callComponent, undefined);
  const result = tool.renderResult!({ content: [{ type: 'text', text: 'edited' }],
    details: { diff: '-1 before\n+1 after', patch: '--- file.txt\n+++ file.txt\n@@ -1 +1 @@\n-before\n+after\n', firstChangedLine: 1 } },
  { expanded: true, isPartial: false }, theme, { ...context, args: input, isError: false });
  const rendered = result.render(80).map(stripVTControlCharacters).join('\n');
  assert.match(rendered, /before/);
  assert.match(rendered, /after/);
});
