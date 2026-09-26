'use strict';

/**
 * Tier-1: whitelist de identificadores SQL.
 * Enumera la lista permitida y prueba rechazo de inyeccion.
 */

const {
  ValidationError,
  ALLOWED_SQL_TABLES,
  ALLOWED_SQL_COLUMNS,
  ALLOWED_SQL_FRAGMENTS,
  ALLOWED_MATRIX_LEVELS,
  ALLOWED_SQL_IDENTIFIERS,
  assertIdentifier,
} = require('../utils/sql-identifiers');

describe('sql-identifiers whitelist', () => {
  test('expone listas explicitas no vacias', () => {
    expect(Array.isArray(ALLOWED_SQL_TABLES)).toBe(true);
    expect(Array.isArray(ALLOWED_SQL_COLUMNS)).toBe(true);
    expect(Array.isArray(ALLOWED_SQL_FRAGMENTS)).toBe(true);
    expect(Array.isArray(ALLOWED_MATRIX_LEVELS)).toBe(true);
    expect(ALLOWED_SQL_IDENTIFIERS.length).toBe(
      ALLOWED_SQL_TABLES.length
        + ALLOWED_SQL_COLUMNS.length
        + ALLOWED_SQL_FRAGMENTS.length
        + ALLOWED_MATRIX_LEVELS.length,
    );
  });

  test('cubre los puntos Tier-1 (objectives/warehouse/clients/dashboard)', () => {
    for (const table of ['DSEDAC.FAM', 'DSEDAC.FI1', 'DSEDAC.FI5', 'JAVIER.TEST_FI3']) {
      expect(ALLOWED_SQL_IDENTIFIERS).toContain(table);
    }
    for (const table of [
      'JAVIER.ALMACEN_CAMIONES_CONFIG',
      'JAVIER.ALMACEN_ART_DIMENSIONES',
      'JAVIER.ALMACEN_PERSONAL',
      'JAVIER.ALMACEN_CARGA_HISTORICO',
      'JAVIER.ALMACEN_CARGA_MANUAL',
      'JAVIER.ALMACEN_CONFIG_GLOBAL',
    ]) {
      expect(ALLOWED_SQL_IDENTIFIERS).toContain(table);
    }
    for (const column of ['FRAGIL', 'APILABLE', 'TEMPERATURA', 'MAX_APILADO', 'DETALLES_JSON']) {
      expect(ALLOWED_SQL_IDENTIFIERS).toContain(column);
    }
    expect(ALLOWED_SQL_IDENTIFIERS).toContain('TRIM(A.CODIGOFAMILIA) as family1');
    expect(ALLOWED_SQL_IDENTIFIERS).toContain('A.CODIGOFAMILIA');
    for (const level of ['vendor', 'client', 'product', 'family1', 'subfamily']) {
      expect(ALLOWED_SQL_IDENTIFIERS).toContain(level);
    }
  });

  test('acepta cada entrada de la whitelist (case-insensitive)', () => {
    for (const entry of ALLOWED_SQL_IDENTIFIERS) {
      expect(assertIdentifier(entry)).toBe(String(entry).trim());
      expect(assertIdentifier(String(entry).toLowerCase())).toBe(String(entry).toLowerCase());
    }
  });

  test('rechaza inyeccion con ValidationError 400', () => {
    const attacks = [
      'users; DROP',
      'FI1; DROP TABLE DSEDAC.CLI',
      'X OR 1=1',
      'A.CODIGO; DELETE FROM CLI',
      "FAM' OR '1'='1",
      '"FAM"',
      '`FAM`',
      'FAM -- comment',
      'FAM/*comment*/',
      '',
      '   ',
      null,
      undefined,
      'DSEDAC.CLI',
      'JAVIER.CO BROS',
      'vendor, (SELECT password FROM users)',
    ];
    for (const attack of attacks) {
      let error = null;
      try {
        assertIdentifier(attack);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.name).toBe('ValidationError');
      expect(error.status).toBe(400);
      expect(error.code).toBe('INVALID_SQL_IDENTIFIER');
    }
  });
});
