'use strict';

const fs = require('fs');
const path = require('path');

describe('BE-14 backend hygiene', () => {
  test('does not stack default helmet over createSecurityHeaders and has no req.log', () => {
    const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    expect(source).toMatch(/createSecurityHeaders\(\)/);
    expect(source).not.toMatch(/app\.use\(helmet\(\)\)/);
    expect(source).not.toMatch(/req\.log\s*=/);
  });

  test('PM2 ecosystem only runs gmp-api', () => {
    const config = require('../ecosystem.config');
    expect(config.apps.map((entry) => entry.name)).toEqual(['gmp-api']);
  });
});
