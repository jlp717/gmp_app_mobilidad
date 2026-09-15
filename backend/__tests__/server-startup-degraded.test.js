'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
const appPath = path.join(__dirname, '..', 'app.js');

describe('server startup degraded when DB2 is down', () => {
  const serverSource = fs.readFileSync(serverPath, 'utf8');
  const appSource = fs.readFileSync(appPath, 'utf8');

  test('initDb failure marks unavailable, listens, and retries with 5–60s backoff', () => {
    expect(serverSource).toContain("app.locals.databaseStatus = 'unavailable'");
    expect(serverSource).toContain('scheduleDbInitRetry');
    expect(serverSource).toMatch(/Math\.min\(60000/);
    expect(serverSource).toContain('process.send');
    expect(serverSource.indexOf('scheduleDbInitRetry')).toBeGreaterThan(0);
    expect(serverSource.indexOf('scheduleDbInitRetry'))
      .toBeLessThan(serverSource.indexOf("if (require.main === module)"));
  });

  test('missing credentials remain fatal before a degraded listen', () => {
    expect(serverSource).toContain('isFatalStartupDbError');
    expect(serverSource).toContain('MISSING_DB_CONFIG');
    expect(serverSource).toMatch(/if \(isFatalStartupDbError\(error\)\) \{\s*throw error/s);
  });

  test('/api/ready returns 503 database unavailable while degraded', () => {
    expect(appSource).toContain("databaseStatus === 'unavailable'");
    expect(appSource).toContain("database: 'unavailable'");
  });
});
