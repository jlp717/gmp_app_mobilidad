'use strict';

const fs = require('fs');
const path = require('path');

describe('objectives by-client route contracts', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'objectives.js'),
    'utf8',
  );
  // Tanda 2 (DIP): queries y construccion del payload en service+repo;
  // la ruta conserva auth, cotas, breaker, cache y fill-lock.
  const serviceSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'objectives-service.js'),
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

  test('by-client omits full-year LCMMDC IN so the year predicate stays sargable', () => {
    expect(serviceSource).toContain('buildMonthFilterParameterized');
    expect(serviceSource).toContain('monthPred.filter');
  });

  test('by-client avoids giant DB2 IN clauses and batches per-client lookups', () => {
    expect(serviceSource).toContain('BY_CLIENT_MAX_CLIENT_CODE_IN_PARAMS');
    expect(serviceSource).toContain('using vendor-filter SQL instead of giant IN clause');
    expect(serviceSource).toContain('BY_CLIENT_CODE_BATCH_SIZE');
    expect(serviceSource).toContain('mapChunksWithConcurrency');
    expect(serviceSource).not.toContain('L.LCCDCL IN (${retrievedCodesParams.map(() =>');
    expect(source).not.toContain('L.LCCDCL IN (${retrievedCodesParams.map(() =>');
  });

  test('by-client is protected by a route-level circuit breaker', () => {
    expect(source).toContain("name: 'objectives-by-client'");
    expect(source).toContain('objectivesByClientBreaker.execute');
    expect(source).toContain('Objetivos por cliente no disponibles dentro del timeout seguro');
    expect(source).toContain('timeout: 35000');
  });

  test('by-client finally can release the fill lock without ReferenceError on cacheKey', () => {
    expect(source).toMatch(/async function handleByClientRequest[\s\S]*let cacheKey;[\s\S]*try \{/);
    expect(source).toContain('await endRouteFill(cacheKey, req._byClientFillLock)');
  });

  test('populations and by-client read CLI via comercialErpTable, not DSEDAC.CLI', () => {
    // Tanda 2 (DIP): las lecturas CLI viven en repositories/objectives-repository.js.
    const repoSource = fs.readFileSync(
      path.join(__dirname, '..', 'repositories', 'objectives-repository.js'),
      'utf8',
    );
    expect(repoSource).toMatch(/comercialErpTable\('CLI'\)/);
    expect(repoSource).not.toMatch(/FROM DSEDAC\.CLI/);
    expect(repoSource).not.toMatch(/LEFT JOIN DSEDAC\.CLI/);
    expect(source).not.toMatch(/FROM DSEDAC\.CLI/);
    expect(source).not.toMatch(/LEFT JOIN DSEDAC\.CLI/);
    expect(serviceSource).not.toMatch(/FROM DSEDAC\.CLI/);
    expect(serviceSource).not.toMatch(/LEFT JOIN DSEDAC\.CLI/);
  });

  test('ALL evolution and by-client cannot read the snapshot-derived monthly rollup', () => {
    expect(source).not.toContain("require('../services/laclae-monthly')");
    expect(source).not.toContain('isLaclaeMonthlyReady');
    expect(source).not.toContain('monthlyTable()');
    expect(source).not.toMatch(/WHERE VENDEDOR='ALL'/);
  });

  test('ALL evolution overlays the open month from live LACLAE and honors forceRefresh', () => {
    expect(source).toContain('overlayOpenMonthFromLiveLaclae');
    expect(source).toContain('isCacheBypassRequest');
    expect(source).toContain("FROM ${comercialErpTable('LACLAE')} L");
    expect(source).toContain('AND L.LCMMDC = ?');
    expect(source).toMatch(/if \(!forceRefresh\) \{[\s\S]*cachedResult = await redisCache\.get/);
    expect(source).not.toMatch(/FROM JAVIER\.TEST_LACLAE/);
  });
});
