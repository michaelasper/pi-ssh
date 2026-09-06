import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

export function fileFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-ssh-files-')));
  const oldPath = process.env.PATH;
  const oldRoot = process.env.PI_SSH_FAKE_ROOT;
  const bin = join(root, 'bin');
  mkdirSync(bin);
  mkdirSync(join(root, 'only-bash'));
  symlinkSync('/bin/bash', join(root, 'only-bash/bash'));
  for (const host of ['alpha', 'beta', 'local', 'drop-write']) {
    mkdirSync(join(root, host, 'home'), { recursive: true });
    mkdirSync(join(root, host, 'work'));
  }
  writeFileSync(join(bin, 'ssh'), `#!/usr/bin/env python3
import json, os, sys, time, subprocess
args = sys.argv[1:]
assert args[:5] == ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes']
assert args[5:8] == ['-o', 'ConnectTimeout=10', '--']
host, command = args[-2:]
if host == 'missing-python':
    os.environ['PATH'] = os.path.join(os.environ['PI_SSH_FAKE_ROOT'], 'only-bash')
    os.execv('/bin/sh', ['sh', '-c', command])
if host == 'unreachable':
    print('Permission denied (publickey)', file=sys.stderr)
    sys.exit(255)
if host == 'bad-protocol':
    print('login banner, not JSON')
    sys.exit(0)
if host == 'delay':
    json.load(sys.stdin)
    time.sleep(0.4)
    print(json.dumps({'ok': True, 'value': 'settled'}))
    sys.exit(0)
if host == 'hang':
    time.sleep(10)
    sys.exit(0)
root = os.path.join(os.environ['PI_SSH_FAKE_ROOT'], host)
os.chdir(os.path.join(root, 'home'))
os.environ['HOME'] = os.path.join(root, 'home')
if host == 'drop-write':
    request = json.load(sys.stdin)
    if request['op'] == 'write':
        with open(request['path'], 'wb') as target: target.write(b'uncertain')
        sys.exit(255)
    sys.exit(subprocess.run(['/bin/sh', '-c', command], input=json.dumps(request).encode()).returncode)
os.execv('/bin/sh', ['sh', '-c', command])
`, { mode: 0o700 });
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.PI_SSH_FAKE_ROOT = root;
  const ctx = { cwd: join(root, 'local', 'work'),
    sessionManager: { getSessionId: () => 'file-tests', getSessionFile: () => undefined },
  } as unknown as ExtensionContext;
  return { root, ctx, cleanup() {
    process.env.PATH = oldPath;
    if (oldRoot === undefined) delete process.env.PI_SSH_FAKE_ROOT;
    else process.env.PI_SSH_FAKE_ROOT = oldRoot;
    rmSync(root, { recursive: true, force: true });
  } };
}

export function text(result: { content: Array<{ type: string; text?: string }> }) {
  return result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}
