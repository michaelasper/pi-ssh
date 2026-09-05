import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { buildSshCommand, quote } from '../src/ssh.ts';

test('POSIX quote roundtrips metacharacters, newlines, empty strings and Unicode', () => {
  for (const value of ['', "it's quoted", '$HOME `id` $(id); & | <> \\ "', 'a\nb', 'λ']) {
    const result = spawnSync('/bin/sh', ['-c', `printf %s ${quote(value)}`], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, value);
  }
});

test('ssh receives exact options and one quoted remote Bash script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-ssh-argv-'));
  try {
    writeFileSync(join(dir, 'ssh'), '#!/bin/sh\nprintf "%s\\0" "$@"\n', { mode: 0o700 });
    const script = 'printf "%s\\n" "$HOME"; printf "%s" "a\'b"\nexit 7';
    const result = spawnSync('/bin/sh', ['-c', buildSshCommand('user@build', script, undefined, 9)], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    const args = result.stdout.split('\0').slice(0, -1);
    assert.deepEqual(args.slice(0, -1), ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=9', '--', 'user@build']);
    assert.equal(args.at(-1), `bash -c ${quote(script)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('remote cwd is literal; failed cd cannot be bypassed by semicolons', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-ssh-cwd-'));
  try {
    const cwd = join(dir, "it's a $HOME `id` directory");
    mkdirSync(cwd);
    writeFileSync(join(dir, 'ssh'), '#!/bin/sh\nfor arg do last=$arg; done\nexec /bin/sh -c "$last"\n', { mode: 0o700 });
    const run = (path: string, command: string) => spawnSync('/bin/sh', ['-c', buildSshCommand('build', command, path, 10)], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8',
    });
    assert.equal(run(cwd, 'pwd').stdout.trim(), cwd);
    const failure = run(join(dir, 'missing'), 'printf WRONG; printf STILL_WRONG');
    assert.notEqual(failure.status, 0);
    assert.equal(failure.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
