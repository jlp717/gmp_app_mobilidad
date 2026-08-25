const path = require('path');
const r = require(path.join(__dirname, 'eslint-baseline.json'));
const m = {};
let e = 0, w = 0;
for (const f of r) {
  const norm = f.filePath.replace(/\\/g, '/');
  const rel = norm.slice(norm.indexOf('gmp_app_mobilidad/') + 'gmp_app_mobilidad/'.length);
  const parts = rel.split('/');
  const k = parts[0] === 'backend' ? 'backend/' + parts.slice(1, 3).join('/') : parts.slice(0, 2).join('/');
  const fe = f.messages.filter(x => x.severity === 2).length;
  const fw = f.messages.filter(x => x.severity === 1).length;
  e += fe; w += fw;
  m[k] = m[k] || { err: 0, warn: 0, files: 0 };
  m[k].err += fe; m[k].warn += fw; m[k].files++;
}
let out = '# ESLint baseline (codigo producto, vendor excluido)\n';
out += '# Generado: ' + new Date().toISOString() + '\n\n';
for (const [k, v] of Object.entries(m).sort((a, b) => b[1].err - a[1].err)) {
  out += `${k.padEnd(45)} errors=${String(v.err).padStart(5)} warnings=${String(v.warn).padStart(3)} files=${v.files}\n`;
}
out += `\nTOTAL errors=${e} warnings=${w} files=${r.length}\n`;
require('fs').writeFileSync('docs/quality-baseline/eslint-baseline-summary.txt', out);
console.log(out.split('\n').slice(-8).join('\n'));
