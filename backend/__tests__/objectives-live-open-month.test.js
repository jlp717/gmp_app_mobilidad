'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'objectives.js'),
  'utf8',
);

describe('objectives ALL live open-month overlay', () => {
  test('mapping uses comercialErpTable LACLAE, never TEST_LACLAE writes or DSEDAC writes', () => {
    expect(source).toMatch(/FROM \$\{comercialErpTable\('LACLAE'\)\} L/);
    expect(source).toContain('overlayOpenMonthFromLiveLaclae');
    expect(source).not.toMatch(/FROM JAVIER\.TEST_LACLAE/);
    expect(source).not.toMatch(/INSERT INTO DSED\.LACLAE/);
    expect(source).not.toMatch(/INSERT INTO DSEDAC\./);
    expect(source).not.toMatch(/WHERE VENDEDOR='ALL'/);
  });

  test('open month overlay is a live SELECT of current year/month', () => {
    expect(source).toMatch(/async function overlayOpenMonthFromLiveLaclae/);
    expect(source).toMatch(/L\.LCAADC = \?/);
    expect(source).toMatch(/L\.LCMMDC = \?/);
    expect(source).toMatch(/SUM\(L\.LCIMVT\) as SALES/);
    expect(source).toMatch(/if \(useMonthly\) \{[\s\S]*overlayOpenMonthFromLiveLaclae/);
  });

  test('evolution Redis cache is skipped on forceRefresh / X-Force-Refresh', () => {
    expect(source).toContain("require('../middleware/http-cache')");
    expect(source).toContain('isCacheBypassRequest');
    expect(source).toMatch(/const forceRefresh = isCacheBypassRequest\(req\)/);
    expect(source).toMatch(/if \(!forceRefresh\) \{[\s\S]*redisCache\.get\('route', cacheKey\)/);
    expect(source).toMatch(/\{ forceRefresh, now \}/);
  });

  test('cache version busts stale monthly ALL payloads', () => {
    expect(source).toContain("OBJECTIVES_CACHE_VERSION = 'v20260918-mon-sat-all'");
  });
});
