'use strict';

function db2ConnectionString(options = {}) {
  const dsn = process.env.ODBC_DSN || 'GMP';
  const uid = process.env.ODBC_UID || process.env.DB2_UID;
  const pwd = process.env.ODBC_PASSWORD || process.env.ODBC_PWD || process.env.DB2_PASSWORD;
  const extras = options.extras === undefined ? 'NAM=1;CCSID=1208' : options.extras;
  const mode = String(
    options.mode ||
      process.env.DB2_CONNECTION_MODE ||
      process.env.ODBC_CONNECTION_MODE ||
      'driver',
  ).toLowerCase();

  if (!uid || !pwd) {
    throw new Error('Missing DB2 credentials. Set ODBC_UID and ODBC_PASSWORD in the environment.');
  }

  const parts = mode === 'dsn'
    ? [`DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`]
    : [
        `DRIVER={${process.env.DB2_ODBC_DRIVER || process.env.ODBC_DRIVER || 'iSeries Access ODBC Driver'}}`,
        `SYSTEM=${process.env.IBM_DB2_HOST || process.env.DB2_HOST || process.env.ODBC_HOST || '192.168.1.22'}`,
        `UID=${uid}`,
        `PWD=${pwd}`,
        `DBQ=${process.env.DB2_DBQ || process.env.ODBC_DBQ || 'DSEDAC JAVIER'}`,
        `DefaultLibraries=${process.env.DB2_LIBRARIES || process.env.ODBC_DEFAULT_LIBRARIES || 'DSEDAC JAVIER'}`,
      ];
  for (const part of String(extras || '').split(';')) {
    const clean = part.trim();
    if (clean) parts.push(clean);
  }
  return `${parts.join(';')};`;
}

module.exports = db2ConnectionString;
