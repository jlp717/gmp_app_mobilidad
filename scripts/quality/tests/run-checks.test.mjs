import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  resolveTool,
  runCommand,
  scanSecrets,
  terminateOwnTree,
} from '../run-checks.mjs';

test('propagates a child exit code without printing child output', async () => {
  const result = await runCommand(process.execPath, [
    '-e',
    "console.log('synthetic-token-should-not-appear'); process.exit(17)",
  ]);

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.exitCode, 17);
  assert.equal(result.output.bytes > 0, true);
  assert.equal(result.output.sha256.length, 64);
  assert.equal(JSON.stringify(result).includes('synthetic-token-should-not-appear'), false);
});

test('reports a missing tool as WARN with a nonzero exit', async () => {
  const result = await runCommand('definitely-not-an-installed-gmp-tool', ['--version']);
  assert.equal(result.status, 'WARN');
  assert.notEqual(result.exitCode, 0);
});

test('times out only its own child and reports BLOCKED', async () => {
  const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
    timeoutMs: 30,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'timeout');
  assert.notEqual(result.exitCode, 0);
});

test('escalates a POSIX child that ignores SIGTERM within the own-tree deadline', {
  skip: process.platform === 'win32',
}, async () => {
  const startedAt = Date.now();
  const result = await runCommand(process.execPath, [
    '-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 5000)",
  ], { timeoutMs: 30, graceMs: 20 });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.exitCode, 124);
  assert.equal(result.reason, 'timeout');
  assert.equal(Date.now() - startedAt < 2_500, true);
});

test('blocks unbounded child output without retaining its body', async () => {
  const result = await runCommand(process.execPath, [
    '-e',
    "process.stdout.write('synthetic-output-'.repeat(10000)); setTimeout(() => {}, 5000)",
  ], { timeoutMs: 2_000, maxOutputBytes: 128, graceMs: 20 });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.exitCode, 125);
  assert.equal(result.reason, 'output-limit');
  assert.equal(result.output.bytes > 128, true);
  assert.equal(JSON.stringify(result).includes('synthetic-output-'), false);
});

test('uses the explicit Windows command shim and shell-free argv', () => {
  assert.equal(resolveTool('npm', 'win32'), 'npm.cmd');
  assert.equal(resolveTool('flutter', 'win32'), 'flutter.bat');
  assert.equal(resolveTool('npm', 'linux'), 'npm');
});

test('rejects Windows batch metacharacters before process creation', async () => {
  const result = await runCommand('npm', ['run', 'safe&(unsafe)'], { platform: 'win32' });
  assert.equal(result.status, 'WARN');
  assert.equal(result.exitCode, 2);
  assert.equal(result.reason, 'unsafe Windows batch argument');
});

test('rejects a NUL Windows batch argument before process creation', async () => {
  const result = await runCommand('npm', ['run', 'unsafe\0argument'], { platform: 'win32' });
  assert.equal(result.status, 'WARN');
  assert.equal(result.exitCode, 2);
  assert.equal(result.reason, 'unsafe Windows batch argument');
});

test('falls back to the direct child and reports unconfirmed tree cleanup when taskkill errors', async () => {
  const taskkill = new EventEmitter();
  taskkill.unref = () => {};
  const calls = [];
  const child = { pid: 9876, kill: (signal) => calls.push(signal) };
  const cleanup = [];
  terminateOwnTree(child, 'win32', 'SIGTERM', {
    spawnImpl: () => {
      queueMicrotask(() => taskkill.emit('error', new Error('synthetic taskkill failure')));
      return taskkill;
    },
    onCleanup: (state) => cleanup.push(state),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['SIGTERM']);
  assert.deepEqual(cleanup, ['tree-termination-requested', 'fallback-child-only']);
});

test('ignores late stream data after completion instead of writing a finalized digest', async () => {
  const child = new EventEmitter();
  child.pid = 42;
  child.kill = () => {};
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const resultPromise = runCommand('synthetic', [], { spawnImpl: () => child });
  queueMicrotask(() => child.emit('close', 0, null));
  const result = await resultPromise;
  child.stdout.emit('data', Buffer.from('late-synthetic-output'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.status, 'PASS');
  assert.equal(result.output.bytes, 0);
});

test('runs a real Windows batch path with spaces and an empty argument', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'gmp quality batch '));
  const batch = join(root, 'return code.cmd');
  await writeFile(batch, '@echo off\r\nif "%~2"=="" exit /b %1\r\nexit /b 1\r\n');
  const result = await runCommand(batch, ['17', ''], { platform: 'win32' });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.exitCode, 17);
});

test('excludes protected and symlink paths before reading, and redacts findings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gmp-quality-'));
  const sourceDir = join(root, 'src');
  await mkdir(sourceDir);
  await writeFile(
    join(sourceDir, 'candidate.js'),
    'const JWT_ACCESS_SECRET = "synthetic-secret-value-123456";\n',
  );
  await writeFile(join(root, '.env'), 'DO_NOT_READ=synthetic-secret-value-123456\n');
  await symlink(sourceDir, join(root, 'linked-src'), 'junction');

  const reads = [];
  const result = await scanSecrets({
    root,
    paths: [
      'src/candidate.js',
      '.env',
      'cline_mcp_settings.json',
      'CREDENCIALES.md',
      'linked-src/candidate.js',
      'src/candidate.js\n',
    ],
    readFile: async (path, encoding) => {
      reads.push(path);
      return readFile(path, encoding);
    },
  });

  assert.deepEqual(reads.map((path) => path.endsWith('candidate.js')), [true]);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0], {
    path: 'src/candidate.js',
    line: 1,
    rule: 'hardcoded-secret-assignment',
  });
  assert.equal(JSON.stringify(result).includes('synthetic-secret-value-123456'), false);
  assert.equal(result.skipped.some((item) => item.path === '.env' && item.reason === 'protected'), true);
  assert.equal(result.skipped.some((item) => item.path === 'cline_mcp_settings.json' && item.reason === 'protected'), true);
  assert.equal(result.skipped.some((item) => item.path === 'CREDENCIALES.md' && item.reason === 'protected'), true);
  assert.equal(result.skipped.some((item) => item.path.startsWith('linked-src/') && item.reason === 'symlink'), true);
  assert.equal(result.skipped.some((item) => item.path === '<unsafe-or-outside-root>'), true);
});

test('makes oversized eligible files explicit instead of passing silently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gmp-quality-'));
  await writeFile(join(root, 'large.js'), 'x'.repeat(128));
  const result = await scanSecrets({ root, paths: ['large.js'], maxBytes: 64 });
  assert.deepEqual(result.errors, [{ path: 'large.js', reason: 'oversized' }]);
  assert.equal(result.ok, false);
});
