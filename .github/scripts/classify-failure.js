#!/usr/bin/env node
/**
 * CI Failure Classifier — GMP App Movilidad
 * 
 * Reads raw CI logs from stdin or a file, classifies the failure,
 * and outputs structured JSON with root cause, file:line details,
 * and suggested fix.
 *
 * Usage:
 *   node .github/scripts/classify-failure.js < /tmp/ci-logs.txt
 *   node .github/scripts/classify-failure.js --file /tmp/flutter-analyze.log
 *   node .github/scripts/classify-failure.js --workflow-run 1234
 *
 * Output: JSON with:
 *   { category, transient, summary, details[], confidence, suggestedFix, fixType }
 */

const CATEGORIES = {
  TRANSIENT: 'transient',
  FLUTTER_ANALYZE: 'flutter-analyze',
  FLUTTER_FORMAT: 'flutter-format',
  TSC_ERROR: 'tsc-error',
  TEST_FAILURE: 'test-failure',
  DEPENDENCY: 'dependency',
  LINT: 'lint',
  SECURITY: 'security',
  INFRASTRUCTURE: 'infrastructure',
  BUILD_ERROR: 'build-error',
  CODEGEN: 'codegen',
  UNKNOWN: 'unknown',
};

// ── Known transient patterns (network, timeouts, rate limits) ──────
const TRANSIENT_PATTERNS = [
  /network error/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /socket hang up/i,
  /timeout/i,
  /429.*rate limit/i,
  /too many requests/i,
  /502.*bad gateway/i,
  /503.*service unavailable/i,
  /504.*gateway timeout/i,
  /npm ERR!.*network/i,
  /Could not resolve dependency/i,
  /pub get.*(error|failed)/i,
  /Unable to.*download/i,
  /Connection refused/i,
  /certificate has expired/i,
  /TLS.*error/i,
  /No space left on device/i,
  /Killed.*OOM/i,
  /Out of memory/i,
  /killed process/i,
];

// ── Flutter analyze error patterns ──────────────────────────────
const FLUTTER_ANALYZE_PATTERNS = [
  {
    regex: /^(.*\.dart):(\d+):(\d+):\s*(error|warning)\s*-\s*(.*)$/gm,
    extract: (m) => ({
      file: m[1],
      line: parseInt(m[2]),
      column: parseInt(m[3]),
      severity: m[4],
      message: m[5].trim(),
    }),
  },
  // Undefined class/member
  {
    regex: /The (method|getter|setter|class|function) ['"](\w+)['"] (isn't|is not) defined/i,
    extract: (m) => ({
      type: 'undefined_reference',
      symbol: m[2],
      message: m[0],
    }),
  },
  // Missing import
  {
    regex: /Undefined\s+(class|name|member)\s+['"]?(\w+)['"]?/i,
    extract: (m) => ({
      type: 'undefined_class',
      symbol: m[2],
      message: m[0],
    }),
  },
];

// ── TypeScript/Node patterns ────────────────────────────────────
const TSC_PATTERNS = [
  {
    regex: /^(.*\.tsx?):(\d+):(\d+)\s*-\s*error\s+(\w+):\s*(.*)$/gm,
    extract: (m) => ({
      file: m[1],
      line: parseInt(m[2]),
      column: parseInt(m[3]),
      code: m[4],
      message: m[5].trim(),
    }),
  },
  {
    regex: /Cannot find (module|name)\s+['"](.*?)['"]/i,
    extract: (m) => ({
      type: 'missing_module',
      module: m[2],
      message: m[0],
    }),
  },
  {
    regex: /Type\s+['"](.*?)['"]\s+is not assignable to type\s+['"](.*?)['"]/i,
    extract: (m) => ({
      type: 'type_mismatch',
      actual: m[1],
      expected: m[2],
      message: m[0],
    }),
  },
];

// ── Jest test failure patterns ───────────────────────────────────
// NOTE: Avoid `s` (dotAll) flag on regexes — V8 can spin on g+s+.*? combos.
const TEST_PATTERNS = [
  {
    regex: /FAIL\s+(.*\.(test|spec)\.(ts|js|dart))/i,
    extract: (m) => ({
      file: m[1],
      type: 'test_failure',
    }),
  },
  {
    // Match ● Test Name then grab next line as detail
    regex: /●\s+(.*)/i,
    extract: (m) => ({
      testName: (m[1] || '').trim(),
      type: 'assertion_failure',
      message: m[0],
    }),
  },
  {
    regex: /Expected:\s+(.*?)\s*\n\s+Received:\s+(.*?)$/im,
    extract: (m) => ({
      type: 'assertion_mismatch',
      expected: (m[1] || '').trim(),
      received: (m[2] || '').trim(),
    }),
  },
  {
    regex: /Cannot find module ['"](.*?)['"]/i,
    extract: (m) => ({
      type: 'missing_test_module',
      module: m[1],
    }),
  },
];

// ── Dependency patterns ─────────────────────────────────────────
const DEPENDENCY_PATTERNS = [
  {
    regex: /Conflicting (dependencies|versions).*?(\w+).*?(\d+\.\d+\.\d+)/i,
    extract: (m) => ({
      type: 'version_conflict',
      package: m[2],
      version: m[3],
    }),
  },
  {
    regex: /version solving failed/i,
    extract: () => ({ type: 'version_solving_failed' }),
  },
  {
    regex: /Because (.*?) depends on (.*?) from (.*)/i,
    extract: (m) => ({
      type: 'dependency_conflict',
      detail: m[0],
    }),
  },
  {
    regex: /npm ERR!.*code\s+(E[A-Z]+)/i,
    extract: (m) => ({
      type: 'npm_error',
      code: m[1],
    }),
  },
];

// ── Security patterns ────────────────────────────────────────────
const SECURITY_PATTERNS = [
  {
    regex: /(\d+)\s*vulnerabilit/i,
    extract: (m) => ({
      type: 'vulnerabilities',
      count: parseInt(m[1]),
    }),
  },
  {
    regex: /Found hardcoded default secrets/i,
    extract: () => ({ type: 'hardcoded_secrets' }),
  },
  {
    regex: /Found \.env files committed/i,
    extract: () => ({ type: 'env_committed' }),
  },
];

// ── Flutter format patterns ─────────────────────────────────────
const FORMAT_PATTERNS = [
  {
    regex: /dart format.*(?:would\s+(?:be\s+)?change|set-exit-if-changed)/i,
    extract: () => ({ type: 'format_needed' }),
  },
];

// ── Codegen patterns ─────────────────────────────────────────────
const CODEGEN_PATTERNS = [
  {
    regex: /build_runner.*failed/i,
    extract: () => ({ type: 'codegen_failed' }),
  },
  {
    regex: /Source line (\d+) of file (.*\.dart) is not a valid annotation/i,
    extract: (m) => ({
      type: 'codegen_annotation_error',
      line: parseInt(m[1]),
      file: m[2],
    }),
  },
  {
    regex: /MissingPluginException/i,
    extract: () => ({ type: 'missing_platform_plugin' }),
  },
];

// ── Infrastructure ───────────────────────────────────────────────
const INFRA_PATTERNS = [
  {
    regex: /Cannot find action.*?\/([^\/]+)@/i,
    extract: (m) => ({
      type: 'missing_action',
      action: m[1],
    }),
  },
  {
    regex: /Cache not found/i,
    extract: () => ({ type: 'cache_miss' }),
  },
  {
    regex: /The (operation|cancellation|policy) was rejected/i,
    extract: () => ({ type: 'policy_rejection' }),
  },
];

// ── Main classifier ─────────────────────────────────────────────
function classify(logText) {
  const results = [];
  let category = CATEGORIES.UNKNOWN;
  let confidence = 0;
  let summary = '';
  let suggestedFix = '';
  let fixType = 'none';
  const details = [];
  const files = new Set();

  // 1. Check transient first (fast path)
  for (const p of TRANSIENT_PATTERNS) {
    const match = logText.match(p);
    if (match) {
      results.push({ category: CATEGORIES.TRANSIENT, reason: match[0] });
    }
  }
  if (results.some(r => r.category === CATEGORIES.TRANSIENT)) {
    // Check if there are ALSO deterministic errors (mixed failure)
    const hasDeterministic = 
      checkPatterns(logText, FLUTTER_ANALYZE_PATTERNS, details, files) ||
      checkPatterns(logText, TSC_PATTERNS, details, files) ||
      checkPatterns(logText, TEST_PATTERNS, details, files);
    
    if (!hasDeterministic) {
      return buildResult(CATEGORIES.TRANSIENT, 0.95, 
        'Transient infrastructure failure (network/timeout/rate-limit). Retry automatically.',
        'No code fix needed. Re-run the workflow.', 'retry',
        details, [...files]);
    }
    // Mixed — note transient but still need deterministic fix
  }

  // 2. Classify deterministic failures
  const checks = [
    { patterns: FLUTTER_ANALYZE_PATTERNS, cat: CATEGORIES.FLUTTER_ANALYZE, label: 'Flutter analyze error' },
    { patterns: FORMAT_PATTERNS, cat: CATEGORIES.FLUTTER_FORMAT, label: 'Flutter format issue' },
    { patterns: TSC_PATTERNS, cat: CATEGORIES.TSC_ERROR, label: 'TypeScript error' },
    { patterns: TEST_PATTERNS, cat: CATEGORIES.TEST_FAILURE, label: 'Test failure' },
    { patterns: DEPENDENCY_PATTERNS, cat: CATEGORIES.DEPENDENCY, label: 'Dependency issue' },
    { patterns: SECURITY_PATTERNS, cat: CATEGORIES.SECURITY, label: 'Security issue' },
    { patterns: CODEGEN_PATTERNS, cat: CATEGORIES.CODEGEN, label: 'Code generation issue' },
    { patterns: INFRA_PATTERNS, cat: CATEGORIES.INFRASTRUCTURE, label: 'Infrastructure issue' },
  ];

  const detectedCategories = new Set();
  
  for (const check of checks) {
    const found = checkPatterns(logText, check.patterns, details, files);
    if (found) {
      detectedCategories.add(check.cat);
    }
  }

  // Determine primary category
  if (detectedCategories.has(CATEGORIES.FLUTTER_ANALYZE)) {
    category = CATEGORIES.FLUTTER_ANALYZE;
    confidence = 0.9;
    fixType = 'auto-fix-dart';
    suggestedFix = generateDartFix(details);
  } else if (detectedCategories.has(CATEGORIES.FLUTTER_FORMAT)) {
    category = CATEGORIES.FLUTTER_FORMAT;
    confidence = 0.95;
    fixType = 'auto-fix-format';
    suggestedFix = 'Run `dart format lib test` to auto-format files.';
  } else if (detectedCategories.has(CATEGORIES.TSC_ERROR)) {
    category = CATEGORIES.TSC_ERROR;
    confidence = 0.9;
    fixType = 'auto-fix-tsc';
    suggestedFix = generateTscFix(details);
  } else if (detectedCategories.has(CATEGORIES.TEST_FAILURE)) {
    category = CATEGORIES.TEST_FAILURE;
    confidence = 0.85;
    fixType = 'needs-review';
    suggestedFix = generateTestFix(details);
  } else if (detectedCategories.has(CATEGORIES.DEPENDENCY)) {
    category = CATEGORIES.DEPENDENCY;
    confidence = 0.8;
    fixType = 'auto-fix-dependency';
    suggestedFix = generateDependencyFix(details, logText);
  } else if (detectedCategories.has(CATEGORIES.SECURITY)) {
    category = CATEGORIES.SECURITY;
    confidence = 0.95;
    fixType = 'needs-review';
    suggestedFix = generateSecurityFix(details);
  } else if (detectedCategories.has(CATEGORIES.CODEGEN)) {
    category = CATEGORIES.CODEGEN;
    confidence = 0.9;
    fixType = 'auto-fix-codegen';
    suggestedFix = 'Run `dart run build_runner build --delete-conflicting-outputs` to regenerate code.';
  } else if (detectedCategories.has(CATEGORIES.INFRASTRUCTURE)) {
    category = CATEGORIES.INFRASTRUCTURE;
    confidence = 0.7;
    fixType = 'retry';
    suggestedFix = 'Infrastructure issue — re-run the workflow. If persistent, check GitHub Actions status.';
  }

  // Build summary from details
  if (details.length > 0) {
    const primary = details[0];
    summary = primary.message || `${category}: ${details.length} issue(s) found`;
    if (files.size > 0) {
      summary += ` in ${[...files].slice(0, 3).join(', ')}`;
    }
  } else {
    summary = `${category}: failure detected but could not parse specific errors`;
  }

  return buildResult(category, confidence, summary, suggestedFix, fixType, details, [...files]);
}

// ── Helpers ──────────────────────────────────────────────────────

function checkPatterns(logText, patterns, details, files) {
  let found = false;
  for (const pattern of patterns) {
    // Reset lastIndex for global regexes
    if (pattern.regex.global) pattern.regex.lastIndex = 0;
    
    let match;
    let iterations = 0;
    const MAX_ITER = 1000; // Safety: prevent infinite loop on pathological regexes
    while ((match = pattern.regex.exec(logText)) !== null) {
      if (++iterations > MAX_ITER) break; // Safety valve
      
      try {
        const extracted = pattern.extract(match);
        if (extracted) {
          details.push(extracted);
          if (extracted.file) files.add(extracted.file);
          found = true;
        }
      } catch (e) {
        // Skip malformed matches
      }
    }
  }
  return found;
}

function buildResult(category, confidence, summary, suggestedFix, fixType, details, files) {
  return JSON.stringify({
    category,
    transient: category === CATEGORIES.TRANSIENT,
    confidence: Math.round(confidence * 100),
    summary,
    autoFixable: ['auto-fix-dart', 'auto-fix-format', 'auto-fix-tsc', 'auto-fix-dependency', 'auto-fix-codegen'].includes(fixType),
    fixType,
    suggestedFix,
    details: details.slice(0, 20),  // cap at 20 to avoid huge output
    files: files.slice(0, 20),
    timestamp: new Date().toISOString(),
  }, null, 2);
}

// ── Fix generators ──────────────────────────────────────────────

function generateDartFix(details) {
  const fixes = [];
  for (const d of details) {
    if (d.type === 'undefined_class' || d.type === 'undefined_reference') {
      fixes.push(`- Add import for '${d.symbol}' in ${d.file || 'the relevant file'}`);
    } else if (d.file && d.line) {
      fixes.push(`- ${d.file}:${d.line}: ${d.message}`);
    }
  }
  if (fixes.length === 0) fixes.push('- Run `dart fix --apply` to auto-fix lint issues');
  fixes.push('- Run `dart format lib test` to fix formatting');
  return fixes.join('\n');
}

function generateTscFix(details) {
  const fixes = [];
  for (const d of details) {
    if (d.type === 'missing_module') {
      fixes.push(`- Install missing module: \`npm install ${d.module}\` (or \`npm install --save-dev ${d.module}\`)`);
    } else if (d.type === 'type_mismatch') {
      fixes.push(`- Fix type: expected '${d.expected}', got '${d.actual}'. Update the type annotation.`);
    } else if (d.file && d.line) {
      fixes.push(`- ${d.file}:${d.line}: ${d.message} (${d.code || ''})`);
    }
  }
  if (fixes.length === 0) fixes.push('- Run `npx tsc --noEmit` locally to see all errors');
  return fixes.join('\n');
}

function generateTestFix(details) {
  const fixes = [];
  for (const d of details) {
    if (d.type === 'assertion_failure') {
      fixes.push(`- Test "${d.testName}" failed. Check assertion logic.`);
    } else if (d.type === 'assertion_mismatch') {
      fixes.push(`- Expected: ${d.expected}`);
      fixes.push(`- Received: ${d.received}`);
    } else if (d.type === 'missing_test_module') {
      fixes.push(`- Missing module '${d.module}'. Add to devDependencies.`);
    } else if (d.file) {
      fixes.push(`- ${d.file}: test failure`);
    }
  }
  if (fixes.length === 0) fixes.push('- Run tests locally with `cd backend && npx jest --verbose` to see details');
  return fixes.join('\n');
}

function generateDependencyFix(details, logText) {
  const fixes = [];
  for (const d of details) {
    if (d.type === 'version_conflict') {
      fixes.push(`- Resolve version conflict for ${d.package} (${d.version}). Check package.json resolutions.`);
    } else if (d.type === 'npm_error' && d.code === 'EUSERVERSION') {
      fixes.push('- Update Node.js version or downgrade package requirement.');
    }
  }
  if (logText.includes('flutter pub get')) {
    fixes.push('- Run `flutter pub get` after updating pubspec.yaml');
  }
  if (logText.includes('npm ci')) {
    fixes.push('- Delete `node_modules` and run `npm ci` again');
    fixes.push('- If package-lock.json is outdated, run `npm install` to regenerate');
  }
  if (fixes.length === 0) fixes.push('- Check package.json for version conflicts');
  return fixes.join('\n');
}

function generateSecurityFix(details) {
  const fixes = [];
  for (const d of details) {
    if (d.type === 'vulnerabilities') {
      fixes.push(`- Run \`cd backend && npm audit fix\` to fix ${d.count} vulnerabilities`);
    } else if (d.type === 'hardcoded_secrets') {
      fixes.push('- Move secrets to GitHub Secrets / .env file (not committed)');
    } else if (d.type === 'env_committed') {
      fixes.push('- Add .env files to .gitignore and remove from tracking: `git rm --cached .env`');
    }
  }
  return fixes.join('\n');
}

// ── CLI entry point ──────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
CI Failure Classifier — GMP App Movilidad
Usage:
  node classify-failure.js < /tmp/ci-logs.txt        # Read from stdin
  node classify-failure.js --file /tmp/logs.txt       # Read from file
  node classify-failure.js --validate                 # Test with sample data
  
Output: JSON with { category, transient, summary, details[], fixType, suggestedFix }
    `);
    process.exit(0);
  }

  if (args.includes('--validate')) {
    // Self-test with known patterns
    const samples = [
      'error - lib/foo.dart:42:3 - The method "bar" isn\'t defined for the class "Baz"',
      'FAIL tests/unit.test.ts\n● some test › Expected: 5\n  Received: 3',
      'error TS2304: Cannot find name "something"',
      'npm ERR! code EUSERVERSION\nnpm ERR! 429 Too Many Requests',
      'dart format set-exit-if-changed would change lib/main.dart',
    ];
    for (const sample of samples) {
      console.error(`--- Testing: ${sample.substring(0, 60)}...`);
      const result = JSON.parse(classify(sample));
      console.error(`  => ${result.category} (confidence: ${result.confidence}%)`);
    }
    console.log(JSON.stringify({ validated: true, patterns: samples.length }));
    process.exit(0);
  }

  let logText = '';
  
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    const fs = require('fs');
    logText = fs.readFileSync(args[fileIdx + 1], 'utf-8');
  } else {
    // Read from stdin
    const chunks = [];
    const stdin = process.stdin;
    if (stdin.isTTY) {
      console.error('No input provided. Pipe logs or use --file. Run with --help for usage.');
      process.exit(1);
    }
    stdin.setEncoding('utf-8');
    stdin.on('data', chunk => chunks.push(chunk));
    stdin.on('end', () => {
      logText = chunks.join('');
      console.log(classify(logText));
    });
    return;  // async — wait for stdin
  }

  console.log(classify(logText));
}

if (require.main === module) {
  main();
}

module.exports = { classify, CATEGORIES };
