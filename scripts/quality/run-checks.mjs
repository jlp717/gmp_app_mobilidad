#!/usr/bin/env node
/**
 * Portable, privacy-preserving quality checks.
 * Child output is represented only by byte count and SHA-256, never echoed.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile as fsReadFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative } from 'node:path';
import { platform as hostPlatform } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCE_EXTENSIONS = new Set([
  '.cjs', '.css', '.dart', '.js', '.json', '.mjs', '.ps1', '.sh', '.ts', '.tsx', '.yaml', '.yml',
]);
const PROTECTED_COMPONENTS = new Set(['.git', '.cline', 'node_modules', 'test', 'tests', '__tests__']);
const MAX_BYTES = 1024 * 1024;
const SHELL_META = /[()\0\r\n&|<>^%!\"]/;

function createOutputDigest() {
  const hash = createHash('sha256');
  let bytes = 0;
  return {
    add(chunk) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      hash.update(buffer);
      return bytes;
    },
    metadata() {
      return { bytes, sha256: hash.digest('hex') };
    },
  };
}

function emptyOutputMetadata() {
  const output = createOutputDigest();
  return output.metadata();
}

export function resolveTool(command, platform = hostPlatform()) {
  if (platform !== 'win32') return command;
  if (command === 'npm' || command === 'npx') return `${command}.cmd`;
  if (command === 'flutter') return 'flutter.bat';
  return command;
}

function safeWindowsBatchArgs(command, args) {
  if (SHELL_META.test(command) || args.some((arg) => SHELL_META.test(arg))) {
    throw new Error('unsafe Windows batch argument');
  }
  const quote = (value) => value === '' || /\s/.test(value) ? `"${value}"` : value;
  // `call` keeps a quoted .cmd/.bat path and its argv intact under cmd /c.
  return ['call', quote(command), ...args.map(quote)];
}

export function terminateOwnTree(child, platform, signal = 'SIGTERM', {
  spawnImpl = spawn,
  onCleanup = () => {},
} = {}) {
  if (!child.pid) return;
  if (platform === 'win32') {
    let fallbackUsed = false;
    const fallbackToChild = () => {
      if (fallbackUsed) return;
      fallbackUsed = true;
      try {
        child.kill('SIGTERM');
        onCleanup('fallback-child-only');
      } catch {
        onCleanup('termination-unconfirmed');
      }
    };
    try {
      const taskkill = spawnImpl('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore', windowsHide: true, shell: false,
      });
      taskkill.once('error', fallbackToChild);
      taskkill.once('close', (code) => {
        if (code !== 0) fallbackToChild();
      });
      taskkill.unref?.();
      onCleanup('tree-termination-requested');
    } catch {
      fallbackToChild();
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

export async function runCommand(command, args = [], options = {}) {
  const platform = options.platform ?? hostPlatform();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const graceMs = options.graceMs ?? 250;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  const spawnImpl = options.spawnImpl ?? spawn;
  const terminateImpl = options.terminateImpl ?? terminateOwnTree;
  const resolved = resolveTool(command, platform);
  let executable = resolved;
  let executableArgs = args;
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    try {
      executable = process.env.ComSpec || 'cmd.exe';
      executableArgs = ['/d', '/c', ...safeWindowsBatchArgs(resolved, args)];
    } catch (error) {
      return { status: 'WARN', exitCode: 2, reason: error.message, output: emptyOutputMetadata() };
    }
  }

  return new Promise((resolve) => {
    const output = createOutputDigest();
    let stopReason = null;
    let settled = false;
    let timer;
    let forceTimer;
    let hardDeadline;
    let child;
    let onData;
    let cleanup = 'not-requested';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (hardDeadline) clearTimeout(hardDeadline);
      if (child && onData) {
        child.stdout.removeListener('data', onData);
        child.stderr.removeListener('data', onData);
      }
      resolve({ ...result, cleanup, output: output.metadata() });
    };
    try {
      child = spawnImpl(executable, executableArgs, {
        cwd: options.cwd,
        detached: platform !== 'win32',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: platform === 'win32' && /\.(cmd|bat)$/i.test(resolved),
      });
    } catch (error) {
      finish({ status: 'WARN', exitCode: 127, reason: `tool-missing:${error.code || 'spawn'}` });
      return;
    }
    const stop = (reason) => {
      if (stopReason || settled) return;
      stopReason = reason;
      terminateImpl(child, platform, 'SIGTERM', { onCleanup: (state) => { cleanup = state; } });
      forceTimer = setTimeout(() => {
        terminateImpl(child, platform, 'SIGKILL', { onCleanup: (state) => { cleanup = state; } });
      }, graceMs);
      hardDeadline = setTimeout(() => {
        finish({ status: 'BLOCKED', exitCode: reason === 'output-limit' ? 125 : 124, reason });
      }, graceMs + 2_000);
    };
    onData = (chunk) => {
      if (settled) return;
      if (output.add(chunk) > maxOutputBytes) stop('output-limit');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    timer = setTimeout(() => stop('timeout'), timeoutMs);
    child.once('error', (error) => {
      finish({ status: 'WARN', exitCode: 127, reason: `tool-missing:${error.code || 'spawn'}` });
    });
    child.once('close', (code, signal) => {
      if (stopReason) {
        finish({ status: 'BLOCKED', exitCode: stopReason === 'output-limit' ? 125 : 124, reason: stopReason });
      } else if (code === 0) {
        finish({ status: 'PASS', exitCode: 0 });
      } else {
        finish({ status: 'BLOCKED', exitCode: code ?? 1, reason: signal ? `signal:${signal}` : 'nonzero' });
      }
    });
  });
}

function extensionAllowed(path) {
  const dot = path.lastIndexOf('.');
  return dot >= 0 && SOURCE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

export function isProtectedPath(path) {
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  const parts = normalized.split('/');
  const name = parts.at(-1) || '';
  return parts.some((part) => PROTECTED_COMPONENTS.has(part)) ||
    name.startsWith('.env') ||
    name.endsWith('.pem') || name.endsWith('.key') || name.endsWith('.p12') ||
    name.endsWith('.pfx') || name.endsWith('.jks') || name.endsWith('.keystore') ||
    /^tokens.*\.json$/i.test(name) || name.includes('credential') ||
    name === 'cline_mcp_settings.json' || name === 'credenciales.md';
}

function normalizedRelativePath(path) {
  if (/[\0\r\n]/.test(path)) return null;
  const result = normalize(path).replaceAll('\\', '/');
  return !result || isAbsolute(result) || result === '..' || result.startsWith('../') ? null : result;
}

async function hasSymlinkAncestor(root, relativePath) {
  let current = root;
  for (const part of relativePath.split('/')) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function findingsFor(content, path) {
  const findings = [];
  const rule = /\b(JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|ODBC_PWD|SSH_GMP_PASSWORD)\s*=\s*['\"]?[A-Za-z0-9_./+=-]{12,}/g;
  for (const match of content.matchAll(rule)) {
    findings.push({
      path,
      line: content.slice(0, match.index).split('\n').length,
      rule: 'hardcoded-secret-assignment',
    });
  }
  return findings;
}

export async function scanSecrets({ root, paths, readFile = fsReadFile, maxBytes = MAX_BYTES }) {
  const findings = [];
  const errors = [];
  const skipped = [];
  for (const candidate of paths) {
    const relativePath = normalizedRelativePath(candidate);
    if (!relativePath) {
      skipped.push({ path: '<unsafe-or-outside-root>', reason: 'outside-root' });
      continue;
    }
    if (isProtectedPath(relativePath)) {
      skipped.push({ path: relativePath, reason: 'protected' });
      continue;
    }
    if (!extensionAllowed(relativePath)) {
      skipped.push({ path: relativePath, reason: 'unsupported-extension' });
      continue;
    }
    const absolutePath = join(root, relativePath);
    try {
      if (await hasSymlinkAncestor(root, relativePath)) {
        skipped.push({ path: relativePath, reason: 'symlink' });
        continue;
      }
      const stat = await lstat(absolutePath);
      if (!stat.isFile()) {
        skipped.push({ path: relativePath, reason: 'not-regular-file' });
        continue;
      }
      if (stat.size > maxBytes) {
        errors.push({ path: relativePath, reason: 'oversized' });
        continue;
      }
      const content = await readFile(absolutePath, 'utf8');
      findings.push(...findingsFor(content, relativePath));
    } catch (error) {
      errors.push({ path: relativePath, reason: `read-error:${error.code || 'unknown'}` });
    }
  }
  return { ok: errors.length === 0 && findings.length === 0, findings, errors, skipped };
}

async function trackedPaths(root) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', root, 'ls-files', '-z'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve(Buffer.concat(chunks).toString('utf8').split('\0').filter(Boolean))
      : reject(new Error(`git-ls-files-exit:${code}`)));
  });
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args[args.indexOf('--check') + 1];
  const root = args.includes('--root') ? args[args.indexOf('--root') + 1] : process.cwd();
  if (check === 'secrets') {
    try {
      const result = await scanSecrets({ root, paths: await trackedPaths(root) });
      process.stdout.write(`${JSON.stringify({ status: result.ok ? 'PASS' : 'BLOCKED', findings: result.findings, errors: result.errors, skippedCount: result.skipped.length })}\n`);
      process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ status: 'WARN', reason: `scanner-unavailable:${error.code || 'unknown'}` })}\n`);
      process.exitCode = 2;
    }
    return;
  }
  if (check === 'politec') {
    const result = await runCommand('pwsh', ['-NoProfile', '-File', 'scripts/politec-quality-gate.ps1'], { cwd: root });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode;
    return;
  }
  if (check === 'tooling') {
    const result = await runCommand('node', ['--version'], { cwd: root });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode;
    return;
  }
  process.stderr.write('Usage: run-checks.mjs --check secrets|politec|tooling [--root PATH]\n');
  process.exitCode = 2;
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === '') {
  main();
}
