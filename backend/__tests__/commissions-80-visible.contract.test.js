'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '../routes/commissions.js'),
  'utf8',
);

describe('commercial 80 commission visibility', () => {
  test('leader 80 is not short-circuited to empty hidden payloads', () => {
    expect(source).not.toMatch(/Hidden summary for authenticated commercial 80/);
    expect(source).not.toMatch(/Hidden team commission for authenticated commercial 80/);
    expect(source).not.toMatch(/hiddenForCommercial80:\s*true/);
  });
});
