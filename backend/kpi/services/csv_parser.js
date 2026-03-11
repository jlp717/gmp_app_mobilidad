// csv_parser.js: Parser robusto de CSVs Glacius con detección automática de headers
'use strict';

const fs = require('fs');
const { parse } = require('csv-parse/sync');
const logger = require('../../middleware/logger');

/**
 * Normaliza una cadena: minúsculas + quita acentos/diacríticos.
 * Así "Cód.Interno" matchea con "Cod.Interno".
 */
function normalizeStr(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Marcadores de header por tipo de CSV para detección automática
const HEADER_MARKERS = {
  'Desviacion_Ventas.csv':           ['Periodo', 'CodigoInterno', 'Desviaci'],
  'Clientes_ConCuotaSinCompra.csv':  ['Semana', 'CodigoInterno', 'Cuota'],
  'Desviacion_Referenciacion.csv':   ['Periodo', 'CodigoInterno', 'Desviaci'],
  'Mensaje_Promociones.csv':         ['Periodo', 'Cod.Interno', 'Msg.Marketing'],
  'Altas_Clientes.csv':              ['Periodo', 'CodigoInterno', 'Desviaci'],
  'Mensajes_Clientes.csv':           ['Periodo', 'CodigoInterno', 'AVISO', 'Aviso'],
  'Medios_Clientes.csv':             ['C.Ofi', 'Interno', 'Total Medios'],
};

/**
 * Parsea un archivo CSV Glacius con detección inteligente de delimitador, header y encoding.
 * @param {string} filePath - Ruta al archivo CSV
 * @param {string} fileName - Nombre del archivo (para seleccionar marcadores)
 * @returns {{ headers: string[], rows: object[], skippedLines: number, parseErrors: Array }}
 */
function parseCSV(filePath, fileName) {
  let raw = fs.readFileSync(filePath, 'utf-8');

  // Limpiar BOM si existe
  if (raw.charCodeAt(0) === 0xFEFF) {
    raw = raw.substring(1);
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], skippedLines: 0, parseErrors: [{ line: 0, error: 'Archivo vacío' }] };
  }

  // Detectar delimitador: ; o ,
  const delimiter = detectDelimiter(lines);

  // Detectar fila de header
  const markers = HEADER_MARKERS[fileName] || [];
  let headerLineIdx = findHeaderLine(lines, markers);

  if (headerLineIdx === -1) {
    // Fallback: primera línea con 3+ campos
    headerLineIdx = lines.findIndex((line) => {
      const cols = line.split(delimiter);
      return cols.length >= 3 && cols.some((c) => c.trim().length > 0);
    });
  }

  if (headerLineIdx === -1) {
    return { headers: [], rows: [], skippedLines: lines.length, parseErrors: [{ line: 0, error: 'No se encontró fila de header' }] };
  }

  // Parsear desde la línea de header
  const csvContent = lines.slice(headerLineIdx).join('\n');
  const parseErrors = [];
  let records;

  try {
    records = parse(csvContent, {
      delimiter,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      cast: false, // Hacemos cast manual para manejar comas decimales
      on_record: (record, context) => {
        // Limpiar nombres de columna con caracteres especiales
        const cleaned = {};
        for (const [key, value] of Object.entries(record)) {
          const cleanKey = key.replace(/[^\x20-\x7E\u00C0-\u024F]/g, '').trim();
          cleaned[cleanKey] = value;
        }
        return cleaned;
      },
    });
  } catch (err) {
    logger.error(`[kpi:csv] Error parseando ${fileName}: ${err.message}`);
    return { headers: [], rows: [], skippedLines: lines.length, parseErrors: [{ line: headerLineIdx, error: err.message }] };
  }

  // Extraer headers del primer registro
  const headers = records.length > 0 ? Object.keys(records[0]) : [];

  return {
    headers,
    rows: records,
    skippedLines: headerLineIdx,
    parseErrors,
  };
}

/**
 * Detecta si el delimitador es ; o , analizando las primeras líneas con datos.
 */
function detectDelimiter(lines) {
  // Buscar líneas con contenido real (no títulos de 1 celda)
  const sampleLines = lines.filter((l) => l.includes(';') || (l.split(',').length > 3));

  let semicolons = 0;
  let commas = 0;
  for (const line of sampleLines.slice(0, 10)) {
    semicolons += (line.match(/;/g) || []).length;
    commas += (line.match(/,/g) || []).length;
  }

  return semicolons > commas ? ';' : ',';
}

/**
 * Busca la línea que contiene los marcadores de header del CSV.
 */
function findHeaderLine(lines, markers) {
  if (markers.length === 0) return 0;

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i];
    const matchCount = markers.filter((m) => line.includes(m)).length;
    if (matchCount >= 2) {
      return i;
    }
  }
  return -1;
}

/**
 * Convierte un valor numérico que puede tener coma decimal, espacios, o símbolo €.
 * @param {string} val - Valor bruto del CSV
 * @returns {number|null}
 */
function parseNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  // Limpiar €, %, espacios
  let cleaned = String(val).replace(/[€%\s]/g, '').trim();
  // Manejar coma decimal: si hay coma y no hay punto, reemplazar
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    cleaned = cleaned.replace(',', '.');
  }
  // Si hay ambos (ej: 1.525,14), quitar puntos de miles y coma decimal
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Busca un valor en un registro por posición de columna (letra) o por nombre de header.
 * @param {object} record - Fila parseada como objeto {header: value}
 * @param {string[]} headers - Lista de headers
 * @param {string} columnLetter - Letra de columna (A, B, ..., H, etc.)
 * @param {string[]} [headerNames] - Nombres alternativos del header
 * @returns {string|null}
 */
function getColumnValue(record, headers, columnLetter, headerNames = []) {
  // Primero intentar por nombre de header (con normalización de acentos)
  for (const name of headerNames) {
    const nameNorm = normalizeStr(name);
    for (const h of headers) {
      if (normalizeStr(h).includes(nameNorm)) {
        return record[h] !== undefined ? record[h] : null;
      }
    }
  }

  // Fallback: por posición de columna (A=0, B=1, ..., H=7)
  const colIdx = columnLetter.charCodeAt(0) - 65; // A=0
  if (colIdx >= 0 && colIdx < headers.length) {
    return record[headers[colIdx]] !== undefined ? record[headers[colIdx]] : null;
  }

  return null;
}

module.exports = {
  parseCSV,
  parseNumber,
  getColumnValue,
  normalizeStr,
  detectDelimiter,
  findHeaderLine,
};
