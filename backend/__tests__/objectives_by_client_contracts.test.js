'use strict';

const fs = require('fs');
const path = require('path');

describe('objectives by-client route contracts', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'objectives.js'),
    'utf8',
  );

  test('commercial objectives helper routes require authentication', () => {
    expect(source).toMatch(/router\.get\('\/populations',\s*verifyToken,/);
    expect(source).toMatch(/router\.get\('\/by-client',\s*verifyToken,/);
  });

  test('by-client clamps the result size instead of defaulting to unbounded lists', () => {
    expect(source).toContain('const BY_CLIENT_DEFAULT_LIMIT = 100;');
    expect(source).toContain('const BY_CLIENT_MAX_LIMIT = 250;');
    expect(source).toContain('clampByClientLimit(limit)');
    expect(source).not.toMatch(/limit\s*\?\s*parseInt\(limit\)\s*:\s*1000/);
  });

  test('by-client avoids giant DB2 IN clauses and batches per-client lookups', () => {
    expect(source).toContain('BY_CLIENT_MAX_CLIENT_CODE_IN_PARAMS');
    expect(source).toContain('using vendor-filter SQL instead of giant IN clause');
    expect(source).toContain('BY_CLIENT_CODE_BATCH_SIZE');
    expect(source).toContain('mapChunksWithConcurrency');
    expect(source).not.toContain('L.LCCDCL IN (${retrievedCodesParams.map(() =>');
  });

  test('by-client is protected by a route-level circuit breaker', () => {
    expect(source).toContain("name: 'objectives-by-client'");
    expect(source).toContain('objectivesByClientBreaker.execute');
    expect(source).toContain('Objetivos por cliente no disponibles dentro del timeout seguro');
  });
});
