import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveConfig, resolveTarget, validateHost } from '../src/config.ts';

test('local by default; explicit host beats default; local override', () => {
  const config = resolveConfig({}, {});
  assert.deepEqual(config, { host: 'local', connectTimeout: 10 });
  assert.deepEqual(resolveTarget({}, config), { host: 'local' });
  const remote = resolveConfig({}, { PI_SSH_HOST: 'build' });
  assert.deepEqual(resolveTarget({}, remote), { host: 'build', cwd: undefined });
  assert.equal(resolveTarget({ host: 'alice@other' }, remote).host, 'alice@other');
  assert.deepEqual(resolveTarget({ host: 'local' }, remote), { host: 'local' });
});

test('CLI overrides environment; empty environment values are unset', () => {
  assert.deepEqual(resolveConfig({ host: 'cli', cwd: '/srv/cli', connectTimeout: '3' }, {
    PI_SSH_HOST: 'env', PI_SSH_CWD: '/srv/env', PI_SSH_CONNECT_TIMEOUT: '20',
  }), { host: 'cli', cwd: '/srv/cli', connectTimeout: 3 });
  assert.deepEqual(resolveConfig({}, { PI_SSH_HOST: '', PI_SSH_CWD: '', PI_SSH_CONNECT_TIMEOUT: '' }),
    { host: 'local', connectTimeout: 10 });
});

test('remote cwd precedence; default remote cwd never affects local', () => {
  const config = resolveConfig({ host: 'build', cwd: '/srv/default' }, {});
  assert.equal(resolveTarget({}, config).cwd, '/srv/default');
  assert.equal(resolveTarget({ cwd: '/srv/override' }, config).cwd, '/srv/override');
  assert.deepEqual(resolveTarget({ host: 'local' }, config), { host: 'local' });
  assert.throws(() => resolveTarget({ host: 'local', cwd: '/tmp' }, config), /remote-only/);
});

test('accept aliases, users, IP addresses; reject ambiguous or injectable hosts', () => {
  for (const host of ['local', 'build-server', 'alice@build.example', '127.0.0.1', '::1', 'user@[2001:db8::1]']) {
    assert.equal(validateHost(host), host);
  }
  for (const host of ['', '-oProxyCommand=evil', 'host;touch x', 'host\n', ' user@host', 'ssh://host',
    'host:/tmp', 'host:22', 'a@b@c', 'user@-host', '$(id)', 'host`id`', 'host/path', 'a\\b', null, 1]) {
    assert.throws(() => validateHost(host), /host/i, String(host));
  }
});

test('reject invalid timeout and paths rather than silently falling back', () => {
  for (const value of ['0', '-1', 'NaN', 'Infinity', '1.2', '1e2', ' 2', '2147483648', '']) {
    assert.throws(() => resolveConfig({ connectTimeout: value }, {}), /timeout/i, value);
  }
  for (const cwd of ['', 'relative', '~/project', '/tmp\0bad', '/tmp\nnew']) {
    assert.throws(() => resolveConfig({ cwd }, {}), /cwd/i);
  }
  assert.throws(() => resolveConfig({ host: '' }, {}), /host/i);
  assert.equal(resolveConfig({ cwd: "/srv/it's a $project" }, {}).cwd, "/srv/it's a $project");
});
