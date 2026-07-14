'use strict';

const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, '../scripts/sql/033_cobros_mirror_tables.sql');
const runtimeCutoverSqlPath = path.join(__dirname, '../scripts/sql/035_cobros_runtime_cutover_javier.sql');
const mirrorTables = ['COBROS_CAB', 'COBROS_LIN', 'COBROS_LIQ'];
const protectedSchemas = ['DSEDAC', 'DSTMOVIL', 'DSTM02', 'DSTD02'];

function withoutSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
}

describe('cobros mirror SQL artifact safety', () => {
  test('033_cobros_mirror_tables.sql is additive, validated, and guarded', () => {
    expect(fs.existsSync(sqlPath)).toBe(true);

    const sql = withoutSqlComments(fs.readFileSync(sqlPath, 'utf8')).replace(/\s+/g, ' ');

    for (const table of mirrorTables) {
      expect(sql).toMatch(new RegExp(`\\b${table}\\b`, 'i'));
      expect(sql).toMatch(new RegExp(`CREATE\\s+TABLE\\s+JAVIER\\.${table}\\b`, 'i'));
      expect(sql).toMatch(new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+\\S+\\s+ON\\s+JAVIER\\.${table}\\b`, 'i'));
      expect(sql).toMatch(new RegExp(`COUNT\\s*\\(\\s*\\*\\s*\\).*FROM\\s+JAVIER\\.${table}\\b`, 'i'));
    }

    expect(sql).toMatch(/FROM\s+QSYS2\.SYSTABLES\b/i);
    expect(sql).toMatch(/FROM\s+QSYS2\.SYSCOLUMNS\b/i);
    expect(sql).toMatch(/\bSIGNAL\s+SQLSTATE\b/i);

    const protectedSchemaNames = protectedSchemas.join('|');
    expect(sql).not.toMatch(new RegExp(`\\b(?:CREATE\\s+TABLE|ALTER\\s+TABLE|DROP\\s+TABLE|TRUNCATE\\s+TABLE|DELETE\\s+FROM|INSERT\\s+INTO|UPDATE|MERGE\\s+INTO)\\s+(?:${protectedSchemaNames})\\.`, 'i'));
    expect(sql).not.toMatch(new RegExp(`\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+\\S+\\s+ON\\s+(?:${protectedSchemaNames})\\.`, 'i'));
    expect(sql).not.toMatch(/\bDROP\s+TABLE\s+JAVIER\.COBROS\b/i);
  });

  test('035_cobros_runtime_cutover_javier.sql creates support tables safely', () => {
    expect(fs.existsSync(runtimeCutoverSqlPath)).toBe(true);

    const rawSql = fs.readFileSync(runtimeCutoverSqlPath, 'utf8');
    const raw = rawSql.replace(/\s+/g, ' ');
    const documentedSql = rawSql.replace(/^\s*--\s?/gm, '').replace(/\s+/g, ' ');
    const sql = withoutSqlComments(rawSql).replace(/\s+/g, ' ');

    for (const table of ['COBROS_NUMERO_COUNTER', 'COBROS_IDEMPOTENCY']) {
      expect(sql).toMatch(new RegExp(`CREATE\\s+TABLE\\s+JAVIER\\.${table}\\b`, 'i'));
      expect(sql).toMatch(new RegExp(`FROM\\s+QSYS2\\.SYSTABLES[\\s\\S]*${table}`, 'i'));
      expect(sql).toMatch(new RegExp(`FROM\\s+QSYS2\\.SYSCOLUMNS[\\s\\S]*${table}`, 'i'));
      expect(sql).toMatch(new RegExp(`COUNT\\s*\\(\\s*\\*\\s*\\)[\\s\\S]*FROM\\s+JAVIER\\.${table}\\b`, 'i'));
    }

    expect(raw).toMatch(/Atomic numbering pattern/i);
    expect(documentedSql).toMatch(/UPDATE\s+JAVIER\.COBROS_NUMERO_COUNTER\s+SET\s+NEXT_NUMERO\s*=\s*NEXT_NUMERO\s*\+\s*1/i);
    expect(sql).toMatch(/SIGNAL\s+SQLSTATE\s+'75035'/i);
    expect(sql).toMatch(/SIGNAL\s+SQLSTATE\s+'75036'/i);
    expect(sql).toMatch(/DROP\s+TABLE\s+JAVIER\.COBROS_IDEMPOTENCY\b/i);
    expect(sql).toMatch(/DROP\s+TABLE\s+JAVIER\.COBROS_NUMERO_COUNTER\b/i);

    const protectedSchemaNames = protectedSchemas.join('|');
    expect(sql).not.toMatch(new RegExp(`\\b(?:CREATE\\s+TABLE|ALTER\\s+TABLE|DROP\\s+TABLE|TRUNCATE\\s+TABLE|DELETE\\s+FROM|INSERT\\s+INTO|UPDATE|MERGE\\s+INTO)\\s+(?:${protectedSchemaNames})\\.`, 'i'));
    expect(sql).not.toMatch(/\bDROP\s+TABLE\s+JAVIER\.COBROS\b/i);
    expect(sql).not.toMatch(/MAX\s*\(\s*NUMERO\s*\)\s*\+\s*1/i);
  });
});
