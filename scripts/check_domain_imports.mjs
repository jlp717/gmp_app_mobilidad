#!/usr/bin/env node
// Gate de arquitectura: domain/ es Dart puro, sin dependencias de Flutter.
// Sustituto ejecutable hoy de la regla custom_lint `no_flutter_in_domain`
// (tool/gmp_custom_lints) mientras el pin de analyzer de hive_generator
// impida resolver custom_lint. Ver TODO en analysis_options.yaml.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const roots = ['lib'];
const offenders = [];

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory() && !e.startsWith('.')) yield* walk(p);
    else if (e.endsWith('.dart')) yield p;
  }
}

for (const root of roots) {
  for (const file of walk(root)) {
    if (!file.split(sep).includes('domain')) continue;
    const src = readFileSync(file, 'utf8');
    const re = /import\s+['"]package:flutter\/([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      offenders.push(`${file}: import 'package:flutter/${m[1]}'`);
    }
  }
}

if (offenders.length) {
  console.error('[no_flutter_in_domain] FALLA — domain/ depende de Flutter:');
  for (const o of offenders) console.error('  ' + o);
  process.exit(1);
}
console.log('[no_flutter_in_domain] OK — domain/ libre de Flutter');
