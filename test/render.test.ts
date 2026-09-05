import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { initTheme } from '@earendil-works/pi-coding-agent';
import { createSshBashTool } from '../src/tool.ts';
import { resolveConfig } from '../src/config.ts';

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
