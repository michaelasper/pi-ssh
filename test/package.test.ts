import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

test('package retains public discovery metadata and the distributed MIT licence', () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.name, '@michaelasper/pi-ssh');
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.keywords.includes('pi-package'));
  assert.equal(pkg.publishConfig.access, 'public');
  assert.ok(pkg.files.includes('LICENSE'));
  assert.match(readFileSync(new URL('LICENSE', root), 'utf8'), /^MIT License\n/);
  assert.deepEqual(pkg.pi.extensions, ['./src/index.ts']);
  for (const entry of pkg.pi.extensions) assert.ok(existsSync(new URL(entry, root)));
});
