#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  '.opencode/TEAM_TRACE.jsonl',
  '.opencode/state/live-execution.jsonl',
  '.opencode/state/flow-trace.jsonl',
  '.opencode/state/flow-trace-latest.json',
  ...walk(path.join(root, '.opencode', 'state', 'handoffs')).filter((f) => f.endsWith('.json') || f.endsWith('.jsonl')),
];

const counts = { agents: new Map(), tools: new Map(), skills: new Map(), commands: new Map() };
let records = 0;

for (const file of files) {
  const full = path.isAbsolute(file) ? file : path.join(root, file);
  if (!fs.existsSync(full)) continue;
  for (const item of readRecords(full)) {
    records += 1;
    add(counts.agents, item.agent || item.subagent_type || item.specialist_output?.agent);
    add(counts.tools, item.tool || item.tool_name);
    add(counts.skills, item.skill || item.skill_name);
    add(counts.commands, item.command || item.command_name);
  }
}

console.log(JSON.stringify({
  status: 'PASS',
  mode: 'read_only',
  files_considered: files.length,
  records_seen: records,
  note: 'Legacy roster counts can exceed active selectable agents; this index dedupes observed telemetry only.',
  counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, top(v)])),
}, null, 2));

function readRecords(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return [];
  if (file.endsWith('.jsonl')) return raw.split(/\r?\n/).filter(Boolean).flatMap(parseLine);
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.steps || parsed.records || [parsed];
}

function parseLine(line) {
  try { return [JSON.parse(line)]; } catch { return []; }
}

function add(map, value) {
  if (!value) return;
  const name = String(value);
  map.set(name, (map.get(name) || 0) + 1);
}

function top(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, count]) => ({ name, count }));
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
