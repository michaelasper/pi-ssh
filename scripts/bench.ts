import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { createBashToolDefinition, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createSshBashTool } from '../src/tool.ts';
import { resolveConfig } from '../src/config.ts';
import { buildSshCommand } from '../src/ssh.ts';

const ctx = { cwd: tmpdir(), sessionManager: { getSessionId: () => 'bench', getSessionFile: () => undefined } } as unknown as ExtensionContext;
const builtin = createBashToolDefinition(ctx.cwd);
const config = resolveConfig({}, {});
const wrapper = createSshBashTool(() => config);
const samples: Record<string, number[]> = { builtin: [], wrapper: [] };
for (let i = -10; i < 100; i++) {
  // Alternate order to reduce bias from warmup and system drift.
  for (const key of i % 2 === 0 ? ['builtin', 'wrapper'] : ['wrapper', 'builtin']) {
    const start = performance.now();
    await (key === 'builtin' ? builtin : wrapper).execute('bench', { command: ':' }, undefined, undefined, ctx);
    if (i >= 0) samples[key].push(performance.now() - start);
  }
}
const summary = (values: number[]) => {
  values.sort((a, b) => a - b);
  return { n: values.length, medianMs: values[Math.floor(values.length / 2)], p95Ms: values[Math.floor(values.length * 0.95)] };
};
const start = performance.now();
for (let i = 0; i < 100_000; i++) buildSshCommand('build', 'printf ok', '/srv/project', 10);
const constructionMicroseconds = (performance.now() - start) * 1000 / 100_000;
console.log(JSON.stringify({ node: process.version, platform: `${process.platform}/${process.arch}`,
  builtin: summary(samples.builtin), wrapper: summary(samples.wrapper), constructionMicroseconds }, null, 2));
