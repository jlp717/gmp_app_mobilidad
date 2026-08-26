'use strict';

class DsedacWriteError extends Error {
  constructor(operation = 'WRITE') {
    super('DSEDAC write blocked: ' + operation);
    this.name = 'DsedacWriteError';
    this.code = 'DSEDAC_WRITE_BLOCKED';
    this.statusCode = 403;
    this.isOperational = true;
  }
}

const WRITE_TARGET_PATTERN = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?|ALTER\s+(?:TABLE|VIEW|INDEX|SCHEMA|ALIAS)|DROP\s+(?:TABLE|VIEW|INDEX|SCHEMA|ALIAS)|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|INDEX|SCHEMA|ALIAS)|REPLACE\s+INTO)\s+(?:"DSEDAC"|DSEDAC)\s*\./i;
const SET_SCHEMA_PATTERN = /\bSET\s+(?:CURRENT\s+)?SCHEMA\s*(?:=\s*)?(?:"DSEDAC"|'DSEDAC'|DSEDAC|\?)(?![A-Z0-9_])/i;

function stripSqlComments(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
}

function assertNoDsedacWrite(sql) {
  const statement = stripSqlComments(sql);
  const writeMatch = WRITE_TARGET_PATTERN.exec(statement);
  if (writeMatch) throw new DsedacWriteError(writeMatch[1].toUpperCase());
  if (SET_SCHEMA_PATTERN.test(statement)) throw new DsedacWriteError('SET SCHEMA');
}

module.exports = {
  DsedacWriteError,
  assertNoDsedacWrite,
};
