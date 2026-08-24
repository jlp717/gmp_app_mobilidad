#!/usr/bin/env node
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const timeoutMs = Number(args.find((a) => a.startsWith('--timeout='))?.split('=')[1] || 8000);
const redact = (text) => String(text || '').replace(/(=)[^\s]{24,}/g, '$1[REDACTED]').slice(0, 1200);

const guardvibe = await run('guardvibe', ['--version'], timeoutMs);
if (guardvibe.code !== 0) {
  console.log(JSON.stringify({
    status: 'WARN',
    tool: 'guardvibe-fallback-scan',
    guardvibe_available: false,
    summary: 'GuardVibe executable unavailable; MCP scan must run when server is available.',
    evidence: redact(guardvibe.stderr || guardvibe.stdout || 'guardvibe command not found'),
  }, null, 2));
  process.exit(0);
}

if (args.includes('--check')) {
  console.log(JSON.stringify({
    status: 'PASS',
    tool: 'guardvibe-fallback-scan',
    guardvibe_available: true,
    version: redact(guardvibe.stdout || guardvibe.stderr),
  }, null, 2));
  process.exit(0);
}

const scan = await run('guardvibe', ['scan', '--format', 'json', '.'], timeoutMs);
console.log(JSON.stringify({
  status: scan.code === 0 ? 'PASS' : 'WARN',
  tool: 'guardvibe-fallback-scan',
  guardvibe_available: true,
  output: redact(scan.stdout || scan.stderr),
}, null, 2));

function run(command, commandArgs, timeout) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
