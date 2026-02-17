/**
 * TESTS: VALIDATORS - Input Validation & SQL Injection Prevention
 *
 * Tests every validator function to ensure:
 * 1. Valid inputs are accepted and properly formatted
 * 2. SQL injection payloads are REJECTED
 * 3. Edge cases (empty, null, undefined, boundary values) are handled
 * 4. Helper functions (buildInClause, buildSearchClause) produce safe output
 */

import {
  parseVendorCodes,
  sanitizeCode,
  sanitizeSearch,
  validateYear,
  validateMonth,
  validateDate,
  validateLimit,
  validateOffset,
  validateSerie,
  validateNumericId,
  validateDiaSemana,
  validateAgrupacion,
  validateTipoEstadistica,
  validateSemanas,
  buildInClause,
  buildSearchClause,
} from '../utils/validators';

// ============================================
// parseVendorCodes
// ============================================
describe('parseVendorCodes', () => {
  // Valid inputs
  test('accepts single numeric code', () => {
    expect(parseVendorCodes('5')).toEqual(['5']);
  });

  test('accepts multiple comma-separated codes', () => {
    expect(parseVendorCodes('5,10,15')).toEqual(['5', '10', '15']);
  });

  test('accepts codes with spaces and trims them', () => {
    expect(parseVendorCodes(' 5 , 10 , 15 ')).toEqual(['5', '10', '15']);
  });

  test('accepts "ALL" keyword', () => {
    expect(parseVendorCodes('ALL')).toEqual(['ALL']);
  });

  test('accepts "all" case-insensitive', () => {
    expect(parseVendorCodes('all')).toEqual(['ALL']);
  });

  test('accepts alphanumeric codes', () => {
    expect(parseVendorCodes('A1,B2,C3')).toEqual(['A1', 'B2', 'C3']);
  });

  test('accepts codes with hyphens', () => {
    expect(parseVendorCodes('VEN-01,VEN-02')).toEqual(['VEN-01', 'VEN-02']);
  });

  // SQL injection payloads - MUST ALL THROW
  test('rejects SQL injection: single quote', () => {
    expect(() => parseVendorCodes("1'; DROP TABLE--")).toThrow();
  });

  test('rejects SQL injection: UNION SELECT', () => {
    expect(() => parseVendorCodes("1 UNION SELECT * FROM--")).toThrow();
  });

  test('rejects SQL injection: OR 1=1', () => {
    expect(() => parseVendorCodes("1' OR '1'='1")).toThrow();
  });

  test('rejects SQL injection: comment injection', () => {
    expect(() => parseVendorCodes("1/*comment*/")).toThrow();
  });

  test('rejects SQL injection: semicolon', () => {
    expect(() => parseVendorCodes("1;DELETE FROM users")).toThrow();
  });

  test('rejects SQL injection: backslash', () => {
    expect(() => parseVendorCodes("1\\")).toThrow();
  });

  // Edge cases
  test('throws on empty string', () => {
    expect(() => parseVendorCodes('')).toThrow();
  });

  test('throws on null/undefined', () => {
    expect(() => parseVendorCodes(null as any)).toThrow();
    expect(() => parseVendorCodes(undefined as any)).toThrow();
  });

  test('throws on code longer than 10 chars', () => {
    expect(() => parseVendorCodes('12345678901')).toThrow();
  });

  test('filters out empty entries from trailing comma', () => {
    expect(parseVendorCodes('5,10,')).toEqual(['5', '10']);
  });
});

// ============================================
// sanitizeCode
// ============================================
describe('sanitizeCode', () => {
  test('trims and uppercases', () => {
    expect(sanitizeCode('  abc  ')).toBe('ABC');
  });

  test('removes special characters', () => {
    expect(sanitizeCode("a'b;c")).toBe('ABC');
  });

  test('allows hyphens', () => {
    expect(sanitizeCode('CLI-001')).toBe('CLI-001');
  });

  test('truncates to 20 chars', () => {
    expect(sanitizeCode('A'.repeat(30))).toHaveLength(20);
  });

  test('throws on empty string', () => {
    expect(() => sanitizeCode('')).toThrow();
  });

  test('removes SQL injection characters', () => {
    const result = sanitizeCode("'; DROP TABLE users; --");
    // All dangerous characters stripped, only alphanumeric remains
    expect(result).not.toContain("'");
    expect(result).not.toContain(';');
    expect(result).not.toContain('--');
    expect(result).toMatch(/^[A-Z0-9-]*$/);
  });
});

// ============================================
// sanitizeSearch
// ============================================
describe('sanitizeSearch', () => {
  test('uppercases search string', () => {
    expect(sanitizeSearch('test')).toBe('TEST');
  });

  test('removes quotes', () => {
    expect(sanitizeSearch("it's a test")).toBe('ITS A TEST');
  });

  test('removes SQL comment markers', () => {
    expect(sanitizeSearch('test--comment')).toBe('TESTCOMMENT');
  });

  test('removes semicolons', () => {
    expect(sanitizeSearch('test; DROP')).toBe('TEST DROP');
  });

  test('truncates to 100 chars', () => {
    expect(sanitizeSearch('A'.repeat(200))).toHaveLength(100);
  });

  test('normalizes whitespace', () => {
    expect(sanitizeSearch('  hello   world  ')).toBe('HELLO WORLD');
  });

  test('returns empty for null/undefined/empty', () => {
    expect(sanitizeSearch('')).toBe('');
    expect(sanitizeSearch(null as any)).toBe('');
    expect(sanitizeSearch(undefined as any)).toBe('');
  });
});

// ============================================
// validateYear
// ============================================
describe('validateYear', () => {
  test('accepts valid years', () => {
    expect(validateYear(2026)).toBe(2026);
    expect(validateYear('2026')).toBe(2026);
    expect(validateYear(2000)).toBe(2000);
    expect(validateYear(2100)).toBe(2100);
  });

  test('returns undefined for empty/null/undefined', () => {
    expect(validateYear(undefined)).toBeUndefined();
    expect(validateYear(null)).toBeUndefined();
    expect(validateYear('')).toBeUndefined();
  });

  test('throws on invalid year', () => {
    expect(() => validateYear(1999)).toThrow();
    expect(() => validateYear(2101)).toThrow();
    expect(() => validateYear('abc')).toThrow();
  });
});

// ============================================
// validateMonth
// ============================================
describe('validateMonth', () => {
  test('accepts 1-12', () => {
    expect(validateMonth(1)).toBe(1);
    expect(validateMonth(12)).toBe(12);
    expect(validateMonth('6')).toBe(6);
  });

  test('returns undefined for empty/null', () => {
    expect(validateMonth(undefined)).toBeUndefined();
  });

  test('throws on invalid month', () => {
    expect(() => validateMonth(0)).toThrow();
    expect(() => validateMonth(13)).toThrow();
    expect(() => validateMonth('abc')).toThrow();
  });
});

// ============================================
// validateDate
// ============================================
describe('validateDate', () => {
  test('accepts YYYY-MM-DD format', () => {
    expect(validateDate('2026-02-14')).toBe('2026-02-14');
    expect(validateDate('2026-01-01')).toBe('2026-01-01');
  });

  test('returns undefined for empty/null', () => {
    expect(validateDate(undefined)).toBeUndefined();
    expect(validateDate('')).toBeUndefined();
  });

  test('throws on invalid format', () => {
    expect(() => validateDate('14/02/2026')).toThrow();
    expect(() => validateDate('2026-2-14')).toThrow();
    expect(() => validateDate('not-a-date')).toThrow();
  });
});

// ============================================
// validateLimit / validateOffset
// ============================================
describe('validateLimit', () => {
  test('defaults to 50', () => {
    expect(validateLimit(undefined)).toBe(50);
    expect(validateLimit('')).toBe(50);
  });

  test('clamps to min 1', () => {
    expect(validateLimit(-5)).toBe(1);
    expect(validateLimit(0)).toBe(1);
  });

  test('clamps to max (default 500)', () => {
    expect(validateLimit(9999)).toBe(500);
  });

  test('respects custom max', () => {
    expect(validateLimit(100, 50)).toBe(50);
  });

  test('parses string numbers', () => {
    expect(validateLimit('25')).toBe(25);
  });
});

describe('validateOffset', () => {
  test('defaults to 0', () => {
    expect(validateOffset(undefined)).toBe(0);
  });

  test('clamps to min 0', () => {
    expect(validateOffset(-10)).toBe(0);
  });

  test('parses string numbers', () => {
    expect(validateOffset('100')).toBe(100);
  });
});

// ============================================
// validateSerie
// ============================================
describe('validateSerie', () => {
  test('accepts alphanumeric serie', () => {
    expect(validateSerie('A')).toBe('A');
    expect(validateSerie('F1')).toBe('F1');
  });

  test('uppercases and trims', () => {
    expect(validateSerie(' a ')).toBe('A');
  });

  test('throws on empty', () => {
    expect(() => validateSerie('')).toThrow();
  });

  test('throws on too long', () => {
    expect(() => validateSerie('ABCDEF')).toThrow();
  });

  test('strips SQL injection chars from serie', () => {
    // After stripping non-alphanumeric, "A' OR '1" becomes "AOR1" which is valid
    const result = validateSerie("A' OR '1");
    expect(result).toBe('AOR1');
    expect(result).not.toContain("'");
  });
});

// ============================================
// validateNumericId
// ============================================
describe('validateNumericId', () => {
  test('accepts valid numbers', () => {
    expect(validateNumericId(123)).toBe(123);
    expect(validateNumericId('456')).toBe(456);
    expect(validateNumericId(0)).toBe(0);
  });

  test('throws on empty/null', () => {
    expect(() => validateNumericId(undefined, 'test')).toThrow();
    expect(() => validateNumericId('', 'test')).toThrow();
  });

  test('throws on non-numeric', () => {
    expect(() => validateNumericId('abc', 'test')).toThrow();
  });

  test('throws on negative', () => {
    expect(() => validateNumericId(-1, 'test')).toThrow();
  });

  test('throws on exceeding max', () => {
    expect(() => validateNumericId(999999999, 'test')).toThrow();
  });
});

// ============================================
// validateDiaSemana
// ============================================
describe('validateDiaSemana', () => {
  test('accepts valid days', () => {
    expect(validateDiaSemana('lunes')).toBe('lunes');
    expect(validateDiaSemana('MARTES')).toBe('martes');
    expect(validateDiaSemana('miércoles')).toBe('miércoles');
  });

  test('returns undefined for empty', () => {
    expect(validateDiaSemana(undefined)).toBeUndefined();
    expect(validateDiaSemana('')).toBeUndefined();
  });

  test('throws on invalid day', () => {
    expect(() => validateDiaSemana('notaday')).toThrow();
    expect(() => validateDiaSemana('monday')).toThrow();
  });
});

// ============================================
// validateAgrupacion
// ============================================
describe('validateAgrupacion', () => {
  test('accepts valid values', () => {
    expect(validateAgrupacion('cliente')).toBe('cliente');
    expect(validateAgrupacion('producto')).toBe('producto');
    expect(validateAgrupacion('categoria')).toBe('categoria');
    expect(validateAgrupacion('comercial')).toBe('comercial');
  });

  test('returns undefined for empty', () => {
    expect(validateAgrupacion(undefined)).toBeUndefined();
  });

  test('throws on invalid', () => {
    expect(() => validateAgrupacion('invalid')).toThrow();
  });
});

// ============================================
// validateTipoEstadistica
// ============================================
describe('validateTipoEstadistica', () => {
  test('accepts valid values', () => {
    expect(validateTipoEstadistica('diario')).toBe('diario');
    expect(validateTipoEstadistica('semanal')).toBe('semanal');
    expect(validateTipoEstadistica('mensual')).toBe('mensual');
    expect(validateTipoEstadistica('anual')).toBe('anual');
  });

  test('throws on invalid', () => {
    expect(() => validateTipoEstadistica('hourly')).toThrow();
  });
});

// ============================================
// validateSemanas
// ============================================
describe('validateSemanas', () => {
  test('defaults to 12', () => {
    expect(validateSemanas(undefined)).toBe(12);
  });

  test('clamps to 1-52', () => {
    expect(validateSemanas(0)).toBe(1);
    expect(validateSemanas(100)).toBe(52);
  });

  test('parses string', () => {
    expect(validateSemanas('8')).toBe(8);
  });
});

// ============================================
// buildInClause
// ============================================
describe('buildInClause', () => {
  test('builds correct parameterized IN clause', () => {
    const result = buildInClause('TRIM(COL)', ['A', 'B', 'C']);
    expect(result.clause).toBe('TRIM(COL) IN (?, ?, ?)');
    expect(result.params).toEqual(['A', 'B', 'C']);
  });

  test('works with single value', () => {
    const result = buildInClause('COL', ['X']);
    expect(result.clause).toBe('COL IN (?)');
    expect(result.params).toEqual(['X']);
  });

  test('throws on empty array', () => {
    expect(() => buildInClause('COL', [])).toThrow();
  });

  test('never produces string concatenation in output', () => {
    const result = buildInClause('COL', ["'; DROP TABLE", "1 OR 1=1"]);
    // The clause should ONLY contain ? placeholders, never the actual values
    expect(result.clause).not.toContain('DROP');
    expect(result.clause).not.toContain('OR');
    expect(result.clause).toBe('COL IN (?, ?)');
    // Values are safely in params array (handled by ODBC driver)
    expect(result.params).toContain("'; DROP TABLE");
  });
});

// ============================================
// buildSearchClause
// ============================================
describe('buildSearchClause', () => {
  test('builds parameterized LIKE clause', () => {
    const result = buildSearchClause(['UPPER(NAME)', 'CODE'], 'test');
    expect(result.clause).toBe('(UPPER(NAME) LIKE ? OR CODE LIKE ?)');
    expect(result.params).toEqual(['%TEST%', '%TEST%']);
  });

  test('sanitizes search input', () => {
    const result = buildSearchClause(['NAME'], "test'; DROP TABLE--");
    // The search should be sanitized (quotes and -- removed)
    expect(result.params[0]).not.toContain("'");
    expect(result.params[0]).not.toContain('--');
  });

  test('returns empty for empty search', () => {
    const result = buildSearchClause(['NAME'], '');
    expect(result.clause).toBe('');
    expect(result.params).toEqual([]);
  });

  test('never puts raw values in clause', () => {
    const result = buildSearchClause(['A', 'B'], 'dangerous');
    expect(result.clause).not.toContain('dangerous');
    expect(result.clause).not.toContain('DANGEROUS');
  });
});

// ============================================
// SQL INJECTION COMPREHENSIVE ATTACK SUITE
// ============================================
describe('SQL Injection Attack Suite', () => {
  const sqlInjectionPayloads = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "1' UNION SELECT * FROM information_schema.tables--",
    "' OR 1=1--",
    "admin'--",
    "1; DELETE FROM users",
    "' OR '' = '",
    "1' AND '1' = '1",
    "%' AND 1=1--",
    "' HAVING 1=1--",
    "' ORDER BY 1--",
    "1/**/UNION/**/SELECT/**/1,2,3--",
    "'; EXEC xp_cmdshell('dir')--",
    "1'; WAITFOR DELAY '0:0:10'--",
    "' AND SUBSTRING(@@version,1,1)='M'",
  ];

  test.each(sqlInjectionPayloads)(
    'parseVendorCodes rejects: %s',
    (payload) => {
      expect(() => parseVendorCodes(payload)).toThrow();
    }
  );

  test.each(sqlInjectionPayloads)(
    'sanitizeSearch removes dangerous chars from: %s',
    (payload) => {
      const result = sanitizeSearch(payload);
      // Result should never contain unescaped quotes or comment markers
      expect(result).not.toContain("'");
      expect(result).not.toContain('"');
      expect(result).not.toContain('--');
      expect(result).not.toContain(';');
      expect(result).not.toContain('/*');
      expect(result).not.toContain('*/');
    }
  );

  test.each(sqlInjectionPayloads)(
    'sanitizeCode strips injection from: %s',
    (payload) => {
      const result = sanitizeCode(payload);
      // Only alphanumeric + single hyphens should remain
      expect(result).not.toContain("'");
      expect(result).not.toContain(';');
      expect(result).not.toContain('=');
      expect(result).not.toContain('--');
      expect(result).toMatch(/^[A-Z0-9]([A-Z0-9-]*[A-Z0-9])?$/);
    }
  );

  // validateSerie strips non-alphanumeric chars. Some injection payloads
  // produce valid alphanumeric results after stripping (e.g. "admin'--" -> "ADMIN").
  // That's fine because the dangerous chars are REMOVED, not passed to SQL.
  test('validateSerie strips dangerous chars from injection payloads', () => {
    // These specific payloads should throw because they're >5 chars or empty after strip
    expect(() => validateSerie("'; DROP TABLE users; --")).toThrow(); // too long
    expect(() => validateSerie("1' UNION SELECT * FROM information_schema.tables--")).toThrow(); // too long
    expect(() => validateSerie("1; DELETE FROM users")).toThrow(); // too long
    expect(() => validateSerie("1/**/UNION/**/SELECT/**/1,2,3--")).toThrow(); // too long
    expect(() => validateSerie("'; EXEC xp_cmdshell('dir')--")).toThrow(); // too long
    expect(() => validateSerie("1'; WAITFOR DELAY '0:0:10'--")).toThrow(); // too long
    expect(() => validateSerie("' AND SUBSTRING(@@version,1,1)='M'")).toThrow(); // too long

    // Short payloads that leave valid alphanumeric chars still get sanitized
    const result = validateSerie("A' OR");
    expect(result).toBe('AOR'); // quotes stripped, result is alphanumeric
    expect(result).not.toContain("'");
  });
});

// ============================================
// JOI SCHEMAS - Commissions, Objectives, Repartidor
// ============================================
import { schemas } from '../utils/validators';

describe('Joi Schemas - Commissions', () => {
  describe('commissionsSummaryQuery', () => {
    it('accepts valid query', () => {
      const { error } = schemas.commissionsSummaryQuery.validate({
        vendedorCode: '5',
        year: '2026',
      });
      expect(error).toBeUndefined();
    });

    it('requires vendedorCode', () => {
      const { error } = schemas.commissionsSummaryQuery.validate({});
      expect(error).toBeDefined();
    });

    it('accepts comma-separated years', () => {
      const { error } = schemas.commissionsSummaryQuery.validate({
        vendedorCode: 'ALL',
        year: '2025, 2026',
      });
      expect(error).toBeUndefined();
    });

    it('rejects SQL injection in year', () => {
      const { error } = schemas.commissionsSummaryQuery.validate({
        vendedorCode: '5',
        year: "2026; DROP TABLE",
      });
      expect(error).toBeDefined();
    });
  });

  describe('commissionsPayBody', () => {
    it('accepts valid payment body', () => {
      const { error } = schemas.commissionsPayBody.validate({
        vendedorCode: '5',
        year: 2026,
        month: 1,
        amount: 100.50,
        generatedAmount: 120,
      });
      expect(error).toBeUndefined();
    });

    it('accepts string amounts', () => {
      const { error } = schemas.commissionsPayBody.validate({
        vendedorCode: '5',
        year: 2026,
        amount: '150.75',
        generatedAmount: '200',
      });
      expect(error).toBeUndefined();
    });

    it('rejects missing required fields', () => {
      const { error } = schemas.commissionsPayBody.validate({
        vendedorCode: '5',
      });
      expect(error).toBeDefined();
    });

    it('rejects SQL injection in vendor code', () => {
      const { error } = schemas.commissionsPayBody.validate({
        vendedorCode: "5'; DROP TABLE--",
        year: 2026,
        amount: 100,
      });
      expect(error).toBeDefined();
    });
  });
});

describe('Joi Schemas - Objectives', () => {
  describe('objectivesSummaryQuery', () => {
    it('accepts valid query', () => {
      const { error } = schemas.objectivesSummaryQuery.validate({
        vendedorCodes: '5,10',
        year: 2026,
        month: 2,
      });
      expect(error).toBeUndefined();
    });

    it('requires vendedorCodes', () => {
      const { error } = schemas.objectivesSummaryQuery.validate({
        year: 2026,
      });
      expect(error).toBeDefined();
    });
  });

  describe('objectivesEvolutionQuery', () => {
    it('accepts valid query', () => {
      const { error } = schemas.objectivesEvolutionQuery.validate({
        vendedorCodes: 'ALL',
        years: '2024,2025,2026',
      });
      expect(error).toBeUndefined();
    });
  });

  describe('objectivesMatrixQuery', () => {
    it('accepts valid matrix query', () => {
      const { error } = schemas.objectivesMatrixQuery.validate({
        clientCode: 'CLI001',
        years: '2026',
        startMonth: 1,
        endMonth: 6,
        fi1: 'CAT1',
      });
      expect(error).toBeUndefined();
    });

    it('requires clientCode', () => {
      const { error } = schemas.objectivesMatrixQuery.validate({
        years: '2026',
      });
      expect(error).toBeDefined();
    });

    it('rejects invalid month range', () => {
      const { error } = schemas.objectivesMatrixQuery.validate({
        clientCode: 'CLI001',
        startMonth: 13,
      });
      expect(error).toBeDefined();
    });
  });

  describe('objectivesByClientQuery', () => {
    it('accepts valid by-client query', () => {
      const { error } = schemas.objectivesByClientQuery.validate({
        vendedorCodes: '5',
        years: '2026',
        months: '1,2,3',
        city: 'MADRID',
        limit: 50,
      });
      expect(error).toBeUndefined();
    });

    it('defaults limit to 100', () => {
      const { value } = schemas.objectivesByClientQuery.validate({
        vendedorCodes: '5',
      });
      expect(value.limit).toBe(100);
    });
  });
});

describe('Joi Schemas - Repartidor', () => {
  describe('repartidorIdParam', () => {
    it('accepts single ID', () => {
      const { error } = schemas.repartidorIdParam.validate({
        repartidorId: '1',
      });
      expect(error).toBeUndefined();
    });

    it('accepts comma-separated IDs', () => {
      const { error } = schemas.repartidorIdParam.validate({
        repartidorId: '1,2,3',
      });
      expect(error).toBeUndefined();
    });

    it('requires repartidorId', () => {
      const { error } = schemas.repartidorIdParam.validate({});
      expect(error).toBeDefined();
    });

    it('rejects SQL injection', () => {
      const { error } = schemas.repartidorIdParam.validate({
        repartidorId: "1'; DROP TABLE--",
      });
      expect(error).toBeDefined();
    });
  });

  describe('clientIdParam', () => {
    it('accepts valid client ID', () => {
      const { error } = schemas.clientIdParam.validate({
        clientId: 'CLI001',
      });
      expect(error).toBeUndefined();
    });

    it('requires clientId', () => {
      const { error } = schemas.clientIdParam.validate({});
      expect(error).toBeDefined();
    });
  });
});
