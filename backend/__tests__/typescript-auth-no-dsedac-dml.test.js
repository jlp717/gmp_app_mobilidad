'use strict';

const fs = require('fs');
const path = require('path');

describe('retired TypeScript auth route safety', () => {
  test('contains no DSEDAC data mutation statement', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'auth.ts'), 'utf8');

    expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+INTO?\s+DSEDAC\.|\b(?:UPDATE|DELETE)\s+DSEDAC\./i);
    expect(source).toContain('Legacy plaintext PIN authenticated without automatic migration');
  });

  test('does not expose a command that activates the retired TypeScript route mode', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));

    expect(packageJson.scripts).not.toHaveProperty('start:ts');
  });
});
