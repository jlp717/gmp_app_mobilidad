// csv_parser.test.js: Tests unitarios del parser CSV Glacius
'use strict';

const path = require('path');
const { parseCSV, parseNumber, detectDelimiter, findHeaderLine } = require('../services/csv_parser');

const SAMPLES_DIR = path.join(__dirname, '..', 'csv_samples');

describe('parseNumber', () => {
  test('parsea enteros', () => {
    expect(parseNumber('42')).toBe(42);
  });

  test('parsea decimales con punto', () => {
    expect(parseNumber('1525.14')).toBe(1525.14);
  });

  test('parsea decimales con coma (formato español)', () => {
    expect(parseNumber('1525,14')).toBe(1525.14);
  });

  test('parsea miles con punto y decimal con coma', () => {
    expect(parseNumber('1.525,14')).toBe(1525.14);
  });

  test('ignora símbolo € y espacios', () => {
    expect(parseNumber(' -751,92 € ')).toBe(-751.92);
  });

  test('ignora símbolo %', () => {
    expect(parseNumber('51,92%')).toBe(51.92);
  });

  test('retorna null para vacío', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });

  test('retorna null para texto no numérico', () => {
    expect(parseNumber('CLIENTE 1')).toBeNull();
  });

  test('parsea negativos', () => {
    expect(parseNumber('-3802,02')).toBe(-3802.02);
  });
});

describe('detectDelimiter', () => {
  test('detecta punto y coma', () => {
    const lines = [
      'Periodo;C.Ofi;Oficina;Preventa',
      '11-2024;2999;DIST;10',
    ];
    expect(detectDelimiter(lines)).toBe(';');
  });

  test('detecta coma', () => {
    const lines = [
      'Periodo,C.Ofi,Oficina,Preventa',
      '11-2024,2999,DIST,10',
    ];
    expect(detectDelimiter(lines)).toBe(',');
  });
});

describe('findHeaderLine', () => {
  test('encuentra header por marcadores', () => {
    const lines = [
      'Clientes desviados en Ventas',
      '',
      'Nota:',
      'Clientes con Cuota...',
      '',
      '',
      '',
      '',
      '',
      'Periodo Hasta AA-Actual;C.Ofi;CodigoInterno;Desviación',
      '11-2024;2999;871;-751',
    ];
    const idx = findHeaderLine(lines, ['Periodo', 'CodigoInterno', 'Desviaci']);
    expect(idx).toBe(9);
  });
});

describe('parseCSV - Desviacion_Ventas', () => {
  test('parsea correctamente el CSV de ejemplo', () => {
    const filePath = path.join(SAMPLES_DIR, 'Desviacion_Ventas.csv');
    const result = parseCSV(filePath, 'Desviacion_Ventas.csv');

    expect(result.rows.length).toBe(10);
    expect(result.headers.length).toBeGreaterThanOrEqual(18);

    // Verificar que se pueden leer las columnas clave
    const firstRow = result.rows[0];
    const headers = result.headers;

    // Buscar CodigoInterno (columna H)
    const codigoKey = headers.find(h => h.includes('CodigoInterno') || h.includes('Codigo'));
    expect(firstRow[codigoKey]).toBeDefined();
  });
});

describe('parseCSV - Clientes_ConCuotaSinCompra', () => {
  test('parsea correctamente', () => {
    const filePath = path.join(SAMPLES_DIR, 'Clientes_ConCuotaSinCompra.csv');
    const result = parseCSV(filePath, 'Clientes_ConCuotaSinCompra.csv');

    expect(result.rows.length).toBe(11);
    const headers = result.headers;
    const codigoKey = headers.find(h => h.includes('CodigoInterno'));
    expect(codigoKey).toBeDefined();
  });
});

describe('parseCSV - Medios_Clientes', () => {
  test('parsea correctamente con estructura diferente (sin Periodo)', () => {
    const filePath = path.join(SAMPLES_DIR, 'Medios_Clientes.csv');
    const result = parseCSV(filePath, 'Medios_Clientes.csv');

    expect(result.rows.length).toBe(8);
    const headers = result.headers;
    // Cod.Interno debe estar en la posición G (columna 7)
    const internoKey = headers.find(h => h.includes('Interno'));
    expect(internoKey).toBeDefined();
  });
});

describe('parseCSV - Mensajes_Clientes', () => {
  test('parsea columna AVISO en posición N', () => {
    const filePath = path.join(SAMPLES_DIR, 'Mensajes_Clientes.csv');
    const result = parseCSV(filePath, 'Mensajes_Clientes.csv');

    expect(result.rows.length).toBe(6);
    const headers = result.headers;
    const avisoKey = headers.find(h => h.includes('AVISO') || h.includes('Aviso'));
    expect(avisoKey).toBeDefined();
    expect(result.rows[0][avisoKey]).toContain('Vitrina');
  });
});
