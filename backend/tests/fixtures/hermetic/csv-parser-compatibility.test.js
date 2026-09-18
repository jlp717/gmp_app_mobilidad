'use strict';

const fs = require('node:fs');

jest.mock('../../../middleware/logger', () => ({
  error: jest.fn(),
}));

const { parseCSV, parseNumber, getColumnValue } = require('../../../kpi/services/csv_parser');
const logger = require('../../../middleware/logger');

describe('KPI CSV parser compatibility and header safety', () => {
  let readFile;

  beforeEach(() => {
    readFile = jest.spyOn(fs, 'readFileSync');
  });

  afterEach(() => {
    readFile.mockRestore();
  });

  test('preserves BOM, semicolon, diacritics, quoted fields and textual amounts', () => {
    readFile.mockReturnValue(
      '\uFEFFInforme sintético\nPeriodo;CodigoInterno;Desviaci\u00F3n \u20AC;Nota\n2026;A-1;"1.525,14";"texto; con separador"\n',
    );
    const parsed = parseCSV('/synthetic/glacius.csv', 'Desviacion_Ventas.csv');
    expect(parsed.skippedLines).toBe(1);
    expect(parsed.headers).toEqual(['Periodo', 'CodigoInterno', 'Desviación', 'Nota']);
    expect(parsed.rows).toHaveLength(1);
    expect(getColumnValue(parsed.rows[0], parsed.headers, 'B', ['CódigoInterno', 'CodigoInterno'])).toBe('A-1');
    expect(parsed.rows[0].Nota).toBe('texto; con separador');
    expect(parseNumber(parsed.rows[0].Desviación)).toBe(1525.14);
  });

  test('accepts comma-delimited and irregular synthetic records without converting values', () => {
    readFile.mockReturnValue('Codigo,Importe,Comentario\nA1,"12,50","ok"\nA2,7\n');
    const parsed = parseCSV('/synthetic/comma.csv', 'unrecognized.csv');
    expect(parsed.headers).toEqual(['Codigo', 'Importe', 'Comentario']);
    expect(parsed.rows[0]).toMatchObject({ Codigo: 'A1', Importe: '12,50', Comentario: 'ok' });
    expect(parsed.rows[1].Codigo).toBe('A2');
    expect(parseNumber(parsed.rows[0].Importe)).toBe(12.5);
  });

  test('reports an empty synthetic input without reading a real customer file', () => {
    readFile.mockReturnValue('\uFEFF\n  \n');
    expect(parseCSV('/synthetic/empty.csv', 'unrecognized.csv')).toEqual({
      headers: [], rows: [], skippedLines: 0,
      parseErrors: [{ line: 0, error: 'Archivo vacío' }],
    });
  });

  test('keeps reserved headers as own data properties and never mutates Object.prototype', () => {
    readFile.mockReturnValue('__proto__,constructor,prototype,Normal\npolluted,ctor,proto,ok\n');
    const row = parseCSV('/synthetic/reserved.csv', 'unrecognized.csv').rows[0];
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(row, '__proto__')).toBe(true);
    expect(row.__proto__).toBe('polluted');
    expect(row.constructor).toBe('ctor');
    expect(row.prototype).toBe('proto');
    expect(row.Normal).toBe('ok');
  });

  test('returns a parse error and logs only the synthetic malformed input failure', () => {
    readFile.mockReturnValue('Periodo;CodigoInterno;Desviaci\n2026;A-1;"unterminated');
    const parsed = parseCSV('/synthetic/malformed.csv', 'Desviacion_Ventas.csv');
    expect(parsed.rows).toEqual([]);
    expect(parsed.parseErrors).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
