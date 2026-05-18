#!/usr/bin/env node
/**
 * CI Failure Report Generator — GMP App Movilidad
 *
 * Takes classification JSON + workflow context and generates a detailed
 * Markdown report with root cause, exact file:line references, and fix
 * instructions. Used by the self-heal workflow to post PR comments and
 * create GitHub issues.
 *
 * Usage:
 *   node failure-report.js --classification /tmp/class.json --context /tmp/ctx.json
 *   node failure-report.js --stdin   # pipe JSON: { classification: {...}, context: {...} }
 *
 * Output: Markdown report to stdout
 */

function generateReport(classification, context = {}) {
  const {
    category = 'unknown',
    transient = false,
    confidence = 0,
    summary = 'No summary',
    autoFixable = false,
    fixType = 'none',
    suggestedFix = 'No suggested fix',
    details = [],
    files = [],
  } = classification;

  const {
    workflow = 'CI/CD Pipeline',
    runId = 'unknown',
    runUrl = '',
    branch = 'unknown',
    commitSha = '',
    actor = 'unknown',
    failedJobs = [],
  } = context;

  const severity = transient ? '⚪' : (confidence >= 80 ? '🔴' : '🟡');
  const fixLabel = autoFixable ? '🤖 Auto-fixable' : '👤 Manual fix required';
  const emoji = categoryEmoji(category);

  const lines = [];

  // ── Header ──────────────────────────────────────────────────────
  lines.push(`# ${severity} CI Failure Report`);
  lines.push('');
  lines.push(`**Workflow**: [${workflow}](${runUrl})`);
  lines.push(`**Run**: #${runId}`);
  lines.push(`**Branch**: \`${branch}\``);
  lines.push(`**Commit**: \`${commitSha.substring(0, 8)}\``);
  lines.push(`**Triggered by**: ${actor}`);
  lines.push(`**Time**: ${new Date().toISOString()}`);
  lines.push('');

  // ── Classification ──────────────────────────────────────────────
  lines.push('## 📋 Classification');
  lines.push('');
  lines.push(`| Property | Value |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Category | ${emoji} \`${category}\` |`);
  lines.push(`| Confidence | ${confidence}% |`);
  lines.push(`| Transient | ${transient ? '✅ Yes (will auto-retry)' : '❌ No'}`);
  lines.push(`| Fix Type | \`${fixType}\` |`);
  lines.push(`| ${fixLabel} | ${autoFixable ? '✅' : '❌'} |`);
  lines.push('');

  // ── Summary ─────────────────────────────────────────────────────
  lines.push('## 📝 Summary');
  lines.push('');
  lines.push(`> ${summary}`);
  lines.push('');

  // ── Failed Jobs ─────────────────────────────────────────────────
  if (failedJobs.length > 0) {
    lines.push('## ❌ Failed Jobs');
    lines.push('');
    for (const job of failedJobs) {
      lines.push(`- **${job}**`);
    }
    lines.push('');
  }

  // ── Detailed Errors ─────────────────────────────────────────────
  if (details.length > 0) {
    lines.push('## 🔍 Error Details');
    lines.push('');
    lines.push('| # | File | Line | Message |');
    lines.push('|---|------|------|---------|');

    details.forEach((d, i) => {
      const file = d.file ? `\`${shortPath(d.file)}\`` : '-';
      const line = d.line ? `\`${d.line}\`` : d.type ? `\`${d.type}\`` : '-';
      const msg = d.message ? truncate(d.message, 80) : '-';
      lines.push(`| ${i + 1} | ${file} | ${line} | ${msg} |`);
    });
    lines.push('');

    // Affected files
    if (files.length > 0) {
      lines.push('**Affected files:**');
      for (const f of files) {
        lines.push(`- \`${shortPath(f)}\``);
      }
      lines.push('');
    }
  }

  // ── Fix Instructions ────────────────────────────────────────────
  lines.push('## 🛠️ Fix');
  lines.push('');

  if (autoFixable) {
    lines.push('> 🤖 **Auto-fix available** — the self-heal workflow will attempt to apply this automatically.');
    lines.push('');
  }

  if (fixType === 'retry') {
    lines.push('**Action**: Re-run the workflow.');
    lines.push('');
    lines.push('```bash');
    lines.push(`gh run rerun ${runId}`);
    lines.push('```');
    lines.push('');
  }

  lines.push('### Suggested Fix');
  lines.push('');
  lines.push('```');
  lines.push(suggestedFix);
  lines.push('```');
  lines.push('');

  // ── Quick Commands ─────────────────────────────────────────────
  lines.push('## ⚡ Quick Commands');
  lines.push('');
  lines.push('```bash');
  lines.push('# 1. Reproduce locally');
  lines.push(`git checkout ${branch}`);
  lines.push(`git pull origin ${branch}`);
  lines.push('');
  lines.push('# 2. Run the failing check');
  if (category === 'flutter-analyze' || category === 'flutter-format') {
    lines.push('cd backend  # if needed');
    lines.push('flutter analyze');
    lines.push('dart format lib test --set-exit-if-changed');
  } else if (category === 'tsc-error') {
    lines.push('cd backend');
    lines.push('npx tsc --noEmit');
  } else if (category === 'test-failure') {
    lines.push('cd backend && npx jest --verbose');
    lines.push('# Or for Flutter:');
    lines.push('flutter test --no-pub');
  } else if (category === 'dependency') {
    lines.push('cd backend && npm ci');
    lines.push('flutter pub get');
  } else if (category === 'codegen') {
    lines.push('dart run build_runner build --delete-conflicting-outputs');
  } else if (category === 'security') {
    lines.push('cd backend && npm audit');
    lines.push('grep -rn "secret\\|password\\|key" --include="*.{js,ts}" backend/');
  }
  lines.push('');
  lines.push('# 3. Fix & re-run');
  if (autoFixable) {
    lines.push('# Auto-fix commands:');
    if (category === 'flutter-format') lines.push('dart format lib test');
    if (category === 'flutter-analyze') lines.push('dart fix --apply');
    if (category === 'codegen') lines.push('dart run build_runner build --delete-conflicting-outputs');
    if (category === 'dependency' && files.some(f => f.includes('backend'))) lines.push('cd backend && npm audit fix');
  }
  lines.push('```');
  lines.push('');

  // ── Links ──────────────────────────────────────────────────────
  lines.push('## 🔗 Links');
  lines.push('');
  lines.push(`- [Workflow Run](${runUrl})`);
  lines.push(`- [Commit](${context.commitUrl || `${context.repoUrl || ''}/commit/${commitSha}`})`);
  if (context.prUrl) {
    lines.push(`- [Pull Request](${context.prUrl})`);
  }
  lines.push('');

  // ── Footer ─────────────────────────────────────────────────────
  lines.push('---');
  lines.push(`_Generated by CI Failure Reporter | ${new Date().toLocaleString()}_`);

  return lines.join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────

function categoryEmoji(category) {
  const map = {
    'transient': '⚡',
    'flutter-analyze': '🎯',
    'flutter-format': '✏️',
    'tsc-error': '🔷',
    'test-failure': '🧪',
    'dependency': '📦',
    'lint': '🧹',
    'security': '🔒',
    'infrastructure': '⚙️',
    'build-error': '🏗️',
    'codegen': '⚡',
    'unknown': '❓',
  };
  return map[category] || '❓';
}

function shortPath(p) {
  // Shorten absolute paths for readability
  return p.replace(/^.*\/gmp_app_mobilidad\//, '').replace(/^.*\/repositorios\//i, '');
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

// ── CLI ──────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
CI Failure Report Generator — GMP App Movilidad
Usage:
  node failure-report.js --classification /tmp/class.json [--context /tmp/ctx.json]
  node failure-report.js --stdin   # pipe JSON: { classification: {...}, context: {...} }
  
Output: Markdown report to stdout
    `);
    process.exit(0);
  }

  function readJson(path) {
    return JSON.parse(require('fs').readFileSync(path, 'utf-8'));
  }

  let classification = {};
  let context = {};
  let stdinIdx = args.indexOf('--stdin');

  if (stdinIdx !== -1) {
    const chunks = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => {
      const input = JSON.parse(chunks.join(''));
      classification = input.classification || input;
      context = input.context || {};
      console.log(generateReport(classification, context));
    });
    return;
  }

  const classIdx = args.indexOf('--classification');
  if (classIdx !== -1 && args[classIdx + 1]) {
    classification = readJson(args[classIdx + 1]);
  }

  const ctxIdx = args.indexOf('--context');
  if (ctxIdx !== -1 && args[ctxIdx + 1]) {
    context = readJson(args[ctxIdx + 1]);
  }

  if (!classification.category) {
    console.error('No classification provided. Use --classification or --stdin.');
    process.exit(1);
  }

  console.log(generateReport(classification, context));
}

if (require.main === module) {
  main();
}

module.exports = { generateReport };
