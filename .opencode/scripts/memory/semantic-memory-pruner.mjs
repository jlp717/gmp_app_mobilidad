#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const config = valueAfter('--config') || '.opencode/config/semantic-memory-pruner.yaml';
const root = process.cwd();
const memoryDir = path.join(root, '.opencode', 'memory');
const stateDir = path.join(root, '.opencode', 'state');

const summary = {
  config_file: config,
  config_exists: fs.existsSync(path.join(root, config)),
  memory_files: countFiles(memoryDir),
  state_jsonl_files: countFiles(stateDir, (f) => f.endsWith('.jsonl')),
};

if (!apply) {
  console.log(JSON.stringify({ status: 'PASS', mode: 'dry_run', summary }, null, 2));
  process.exit(0);
}

const backup = path.join(root, '.opencode', 'backups', `semantic-memory-pruner-${stamp()}`);
fs.mkdirSync(backup, { recursive: true });
console.log(JSON.stringify({
  status: 'PASS',
  mode: 'apply_noop',
  backup_created: path.relative(root, backup).replace(/\\/g, '/'),
  summary,
  note: 'No pruning rules applied by default; extend config before enabling mutations.',
}, null, 2));

function valueAfter(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function countFiles(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(full, predicate);
    else if (predicate(full)) count += 1;
  }
  return count;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
