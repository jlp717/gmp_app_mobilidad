'use strict';

const fs = require('fs');
const path = require('path');

const gatePath = path.resolve(__dirname, '..', '..', 'scripts', 'politec-quality-gate.ps1');

describe('Politec quality gate canonical auth contract', () => {
  const source = fs.readFileSync(gatePath, 'utf8');

  test('checks the canonical sid/jti Redis session store rather than removed legacy helpers', () => {
    expect(source).toContain('createAuthClaimsSessionStore');
    expect(source).toContain('canonicalSessionStore');
    expect(source).toContain("const selectedMode = production \\? 'redis'");
    expect(source).toContain("const requiresRedis = production \\|\\| selectedMode === 'redis'");
    expect(source).toContain('canonicalSessionStore\\.isActive');
    expect(source).not.toContain('Test-Contains "backend\\middleware\\auth.js" "AUTH_SESSION_PREFIX"');
    expect(source).not.toContain('Test-Contains "backend\\middleware\\auth.js" "rememberSessionInRedis"');
    expect(source).toContain('Test-NotContains "backend\\middleware\\auth.js" "AUTH_ALLOW_STATELESS_REFRESH_FALLBACK"');
  });

  test('does not fail the repository for ignored, untracked local runtime logs', () => {
    expect(source).toContain('git -C $RootDir ls-files -- $file.Name');
    expect(source).not.toContain('Local log file must live under logs/ and remain untracked');
  });
});
