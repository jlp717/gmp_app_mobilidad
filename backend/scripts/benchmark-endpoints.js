/**
 * benchmark-endpoints.js
 * ======================
 * Performance benchmark for GMP Backend API routes.
 *
 * Usage:
 *   node scripts/benchmark-endpoints.js              # simulation mode
 *   node scripts/benchmark-endpoints.js --live       # hits http://localhost:3334/api/health
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── Config ──────────────────────────────────────────────────────────────────
const ROUTES_DIR = path.resolve(__dirname, '..', 'routes');
const SERVICES_DIR = path.resolve(__dirname, '..', 'services');
const SERVER_PORT = process.env.SERVER_PORT || 3334;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function pad(str, len) {
  return (str + ' '.repeat(len)).substring(0, len);
}

function formatMs(ms) {
  return ms < 1 ? (ms * 1000).toFixed(1) + 'μs' : ms.toFixed(2) + 'ms';
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function memUsage() {
  const m = process.memoryUsage();
  return { heapUsed: m.heapUsed, heapTotal: m.heapTotal, rss: m.rss };
}

// ─── Simulation Mode ────────────────────────────────────────────────────────
function runSimulation() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║       GMP Backend — Route Module Benchmark (Simulation)          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const routeFiles = fs.readdirSync(ROUTES_DIR)
    .filter(f => f.endsWith('.js'))
    .sort();

  // 1. Measure require() time per route module
  console.log('┌─ 1. MODULE LOAD TIMES (require) ──────────────────────────────┐');
  console.log(`│ ${pad('File', 28)} │ ${pad('Load Time', 12)} │ ${pad('Lines', 8)} │`);
  console.log('├────────────────────────────────────────────────────────────────┤');

  const loadTimes = [];
  let totalLoadMs = 0;

  for (const file of routeFiles) {
    const filePath = path.join(ROUTES_DIR, file);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').length;

    // Clear require cache
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];

    const start = process.hrtime.bigint();
    try {
      require(filePath);
    } catch (e) {
      // Module may fail without DB — still measure load time
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    totalLoadMs += elapsed;
    loadTimes.push({ file, elapsed, lines });

    console.log(`│ ${pad(file, 28)} │ ${pad(formatMs(elapsed), 12)} │ ${pad(String(lines), 8)} │`);
  }
  console.log('├────────────────────────────────────────────────────────────────┤');
  console.log(`│ ${pad('TOTAL', 28)} │ ${pad(formatMs(totalLoadMs), 12)} │ ${pad(String(loadTimes.reduce((s, l) => s + l.lines, 0)), 8)} │`);
  console.log('└────────────────────────────────────────────────────────────────┘\n');

  // 2. Memory usage before/after
  console.log('┌─ 2. MEMORY IMPACT ────────────────────────────────────────────┐');
  const memBefore = memUsage();
  console.log(`│ Before: heapUsed=${formatBytes(memBefore.heapUsed)}, heapTotal=${formatBytes(memBefore.heapTotal)}, rss=${formatBytes(memBefore.rss)}`);

  // Force another round of requires (cache cleared above)
  for (const file of routeFiles) {
    const filePath = path.join(ROUTES_DIR, file);
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];
    try { require(filePath); } catch (_) {}
  }

  const memAfter = memUsage();
  console.log(`│ After:  heapUsed=${formatBytes(memAfter.heapUsed)}, heapTotal=${formatBytes(memAfter.heapTotal)}, rss=${formatBytes(memAfter.rss)}`);
  console.log(`│ Delta:  heapUsed=${formatBytes(memAfter.heapUsed - memBefore.heapUsed)}, rss=${formatBytes(memAfter.rss - memBefore.rss)}`);
  console.log('└────────────────────────────────────────────────────────────────┘\n');

  // 3. Slowest modules
  console.log('┌─ 3. SLOWEST MODULES (top 5) ──────────────────────────────────┐');
  const sorted = [...loadTimes].sort((a, b) => b.elapsed - a.elapsed).slice(0, 5);
  sorted.forEach((m, i) => {
    console.log(`│ ${i + 1}. ${pad(m.file, 26)} ${pad(formatMs(m.elapsed), 10)} (${m.lines} lines)`);
  });
  console.log('└────────────────────────────────────────────────────────────────┘\n');

  // 4. Summary
  console.log('┌─ 4. SUMMARY ──────────────────────────────────────────────────┐');
  console.log(`│ Route files loaded : ${pad(String(routeFiles.length), 4)}`);
  console.log(`│ Total load time    : ${pad(formatMs(totalLoadMs), 4)}`);
  console.log(`│ Avg per module     : ${pad(formatMs(totalLoadMs / routeFiles.length), 4)}`);
  console.log(`│ Memory delta (rss) : ${pad(formatBytes(memAfter.rss - memBefore.rss), 4)}`);
  console.log('└────────────────────────────────────────────────────────────────┘');
}

// ─── Live Mode ───────────────────────────────────────────────────────────────
async function runLive() {
  const url = `http://localhost:${SERVER_PORT}/api/health`;
  console.log(`Hitting ${url} ...\n`);

  try {
    const http = require('http');
    const iterations = 10;
    const times = [];

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      await new Promise((resolve, reject) => {
        http.get(url, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }).on('error', reject);
      });
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      times.push(elapsed);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const p95 = [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

    console.log(`  Iterations : ${iterations}`);
    console.log(`  Avg        : ${formatMs(avg)}`);
    console.log(`  Min        : ${formatMs(min)}`);
    console.log(`  Max        : ${formatMs(max)}`);
    console.log(`  P95        : ${formatMs(p95)}`);
  } catch (e) {
    console.error(`Live benchmark failed: ${e.message}`);
    console.error('Is the server running on port ' + SERVER_PORT + '?');
    process.exit(1);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
const live = process.argv.includes('--live');
if (live) {
  runLive();
} else {
  runSimulation();
}
