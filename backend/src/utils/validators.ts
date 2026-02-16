/**
 * VALIDATORS - Input Validation & Sanitization
 *
 * Centralized validation for ALL user inputs.
 * Uses Joi for schema validation + custom sanitizers for SQL safety.
 *
 * WHY: Every query parameter that reaches a SQL query MUST be validated here first.
 * This is the single source of truth for input validation across the entire backend.
 */

import Joi from 'joi';

// ============================================
// REUSABLE CUSTOM VALIDATORS
// ============================================

/**
 * Validates and parses comma-separated vendor codes.
 * Accepts formats: "5", "5,10,15", "ALL"
 * Rejects SQL injection attempts.
 */
export function parseVendorCodes(raw: string): string[] {
  if (!raw || typeof raw !== 'string') {
    throw new Error('vendedorCodes es requerido');
  }

  const trimmed = raw.trim().toUpperCase();

  if (trimmed === 'ALL') {
    return ['ALL'];
  }

  const codes = trimmed.split(',').map(v => v.trim()).filter(v => v.length > 0);

  if (codes.length === 0) {
    throw new Error('vendedorCodes no puede estar vacío');
  }

  // Each code must be alphanumeric (letters, numbers, hyphens only)
  const validCodePattern = /^[A-Z0-9-]+$/;
  for (const code of codes) {
    if (!validCodePattern.test(code)) {
      throw new Error(`Código de vendedor inválido: ${code.substring(0, 20)}`);
    }
    if (code.length > 10) {
      throw new Error(`Código de vendedor demasiado largo: ${code.substring(0, 20)}`);
    }
  }

  return codes;
}

/**
 * Sanitizes a generic code (client, product, vendor, etc.)
 * Only allows alphanumeric + hyphens, max 20 chars
 */
export function sanitizeCode(code: string): string {
  if (!code || typeof code !== 'string') {
    throw new Error('Código es requerido');
  }
  return String(code)
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/--+/g, '-')              // Collapse double hyphens (SQL comment syntax)
    .replace(/^-|-$/g, '')             // Remove leading/trailing hyphens
    .substring(0, 20);
}

/**
 * Sanitizes a search string for LIKE queries.
 * Removes dangerous characters but allows common search patterns.
 */
export function sanitizeSearch(search: string): string {
  if (!search || typeof search !== 'string') {
    return '';
  }
  // Remove SQL-dangerous characters, keep alphanumeric + spaces + common chars
  return search
    .trim()
    .replace(/[;'"\\`\-\-\/\*]/g, '')  // Remove SQL special chars
    .replace(/\s+/g, ' ')               // Normalize whitespace
    .substring(0, 100)                   // Max length
    .toUpperCase();
}

/**
 * Validates a year parameter
 */
export function validateYear(year: unknown): number | undefined {
  if (year === undefined || year === null || year === '') return undefined;
  const num = typeof year === 'string' ? parseInt(year, 10) : Number(year);
  if (isNaN(num) || num < 2000 || num > 2100) {
    throw new Error(`Año inválido: ${year}`);
  }
  return num;
}

/**
 * Validates a month parameter (1-12)
 */
export function validateMonth(month: unknown): number | undefined {
  if (month === undefined || month === null || month === '') return undefined;
  const num = typeof month === 'string' ? parseInt(month, 10) : Number(month);
  if (isNaN(num) || num < 1 || num > 12) {
    throw new Error(`Mes inválido: ${month}`);
  }
  return num;
}

/**
 * Validates a date string (YYYY-MM-DD format)
 */
export function validateDate(date: unknown): string | undefined {
  if (date === undefined || date === null || date === '') return undefined;
  const str = String(date).trim();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(str)) {
    throw new Error(`Fecha inválida (formato YYYY-MM-DD): ${str}`);
  }
  // Verify it's a real date
  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Fecha inválida: ${str}`);
  }
  return str;
}

/**
 * Validates a pagination limit
 */
export function validateLimit(limit: unknown, max: number = 500): number {
  if (limit === undefined || limit === null || limit === '') return 50;
  const num = typeof limit === 'string' ? parseInt(limit, 10) : Number(limit);
  if (isNaN(num)) return 50;
  return Math.min(max, Math.max(1, num));
}

/**
 * Validates a pagination offset
 */
export function validateOffset(offset: unknown): number {
  if (offset === undefined || offset === null || offset === '') return 0;
  const num = typeof offset === 'string' ? parseInt(offset, 10) : Number(offset);
  if (isNaN(num)) return 0;
  return Math.max(0, num);
}

/**
 * Validates a serie (invoice series) - single alphanumeric char(s)
 */
export function validateSerie(serie: string): string {
  if (!serie || typeof serie !== 'string') {
    throw new Error('Serie es requerida');
  }
  const clean = serie.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length === 0 || clean.length > 5) {
    throw new Error(`Serie inválida: ${serie.substring(0, 10)}`);
  }
  return clean;
}

/**
 * Validates a numeric ID (factura number, etc.)
 */
export function validateNumericId(id: unknown, fieldName: string = 'ID'): number {
  if (id === undefined || id === null || id === '') {
    throw new Error(`${fieldName} es requerido`);
  }
  const num = typeof id === 'string' ? parseInt(id, 10) : Number(id);
  if (isNaN(num) || num < 0 || num > 99999999) {
    throw new Error(`${fieldName} inválido: ${id}`);
  }
  return num;
}

/**
 * Validates day-of-week parameter for rutero
 */
export function validateDiaSemana(dia: unknown): string | undefined {
  if (dia === undefined || dia === null || dia === '') return undefined;
  const str = String(dia).trim().toLowerCase();
  const validDays = ['lunes', 'martes', 'miercoles', 'miércoles', 'jueves', 'viernes', 'sabado', 'sábado', 'domingo'];
  if (!validDays.includes(str)) {
    throw new Error(`Día de semana inválido: ${str}`);
  }
  return str;
}

/**
 * Validates agrupacion parameter for statistics
 */
export function validateAgrupacion(agrupacion: unknown): 'cliente' | 'producto' | 'categoria' | 'comercial' | undefined {
  if (agrupacion === undefined || agrupacion === null || agrupacion === '') return undefined;
  const valid = ['cliente', 'producto', 'categoria', 'comercial'];
  const str = String(agrupacion).trim().toLowerCase();
  if (!valid.includes(str)) {
    throw new Error(`Agrupación inválida: ${str}`);
  }
  return str as 'cliente' | 'producto' | 'categoria' | 'comercial';
}

/**
 * Validates tipo parameter for statistics
 */
export function validateTipoEstadistica(tipo: unknown): 'diario' | 'semanal' | 'mensual' | 'anual' | undefined {
  if (tipo === undefined || tipo === null || tipo === '') return undefined;
  const valid = ['diario', 'semanal', 'mensual', 'anual'];
  const str = String(tipo).trim().toLowerCase();
  if (!valid.includes(str)) {
    throw new Error(`Tipo de estadística inválido: ${str}`);
  }
  return str as 'diario' | 'semanal' | 'mensual' | 'anual';
}

/**
 * Validates number of weeks
 */
export function validateSemanas(semanas: unknown): number {
  if (semanas === undefined || semanas === null || semanas === '') return 12;
  const num = typeof semanas === 'string' ? parseInt(semanas, 10) : Number(semanas);
  if (isNaN(num)) return 12;
  return Math.min(52, Math.max(1, num));
}

// ============================================
// QUERY BUILDER HELPERS
// ============================================

/**
 * Builds a parameterized IN clause for vendor codes.
 * Returns { clause: 'TRIM(field) IN (?, ?, ?)', params: ['5', '10', '15'] }
 *
 * WHY: Replaces the dangerous pattern of building IN clauses with string concatenation:
 *   BEFORE: `IN (${vendorList})`  -- SQL injection!
 *   AFTER:  `IN (?, ?, ?)`        -- parameterized, safe
 */
export function buildInClause(field: string, values: string[]): { clause: string; params: string[] } {
  if (!values || values.length === 0) {
    throw new Error('Values array cannot be empty for IN clause');
  }
  const placeholders = values.map(() => '?').join(', ');
  return {
    clause: `${field} IN (${placeholders})`,
    params: values,
  };
}

/**
 * Builds parameterized LIKE conditions for search.
 * Returns { clause: '(field1 LIKE ? OR field2 LIKE ?)', params: ['%SEARCH%', '%SEARCH%'] }
 */
export function buildSearchClause(fields: string[], search: string): { clause: string; params: string[] } {
  const sanitized = sanitizeSearch(search);
  if (!sanitized) {
    return { clause: '', params: [] };
  }
  const pattern = `%${sanitized}%`;
  const conditions = fields.map(f => `${f} LIKE ?`).join(' OR ');
  const params = fields.map(() => pattern);
  return {
    clause: `(${conditions})`,
    params,
  };
}

// ============================================
// JOI SCHEMAS FOR ROUTE VALIDATION
// ============================================

export const schemas = {
  // Facturas list query params
  facturasQuery: Joi.object({
    vendedorCodes: Joi.string().trim().min(1).max(200).required()
      .messages({ 'any.required': 'vendedorCodes es requerido' }),
    year: Joi.number().integer().min(2000).max(2100),
    month: Joi.number().integer().min(1).max(12),
    search: Joi.string().max(100).allow(''),
    clientId: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/),
    limit: Joi.number().integer().min(1).max(500).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }),

  // Facturas summary query params
  facturasSummaryQuery: Joi.object({
    vendedorCodes: Joi.string().trim().min(1).max(200).required(),
    year: Joi.number().integer().min(2000).max(2100),
    month: Joi.number().integer().min(1).max(12),
  }),

  // Facturas years query params
  facturasYearsQuery: Joi.object({
    vendedorCodes: Joi.string().trim().min(1).max(200).required(),
  }),

  // Factura detail route params
  facturaDetailParams: Joi.object({
    serie: Joi.string().trim().min(1).max(5).pattern(/^[A-Za-z0-9]+$/).required(),
    numero: Joi.number().integer().min(0).max(99999999).required(),
    ejercicio: Joi.number().integer().min(2000).max(2100).required(),
  }),

  // Ventas historico query params
  ventasHistoricoQuery: Joi.object({
    cliente: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/),
    producto: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/),
    desde: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
    hasta: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
    comercial: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/),
    limit: Joi.number().integer().min(1).max(500).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }),

  // Ventas estadisticas query params
  ventasEstadisticasQuery: Joi.object({
    tipo: Joi.string().valid('diario', 'semanal', 'mensual', 'anual'),
    desde: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
    hasta: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
    cliente: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/),
    producto: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/),
    comercial: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/),
    agrupacion: Joi.string().valid('cliente', 'producto', 'categoria', 'comercial'),
  }),

  // Ventas semanales query params
  ventasSemanalesQuery: Joi.object({
    semanas: Joi.number().integer().min(1).max(52).default(12),
    cliente: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/),
    comercial: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/),
  }),

  // Dashboard query params
  dashboardQuery: Joi.object({
    codigoVendedor: Joi.string().trim().min(1).max(20).pattern(/^[A-Za-z0-9-]+$/),
    anio: Joi.number().integer().min(2000).max(2100),
    limite: Joi.number().integer().min(1).max(50).default(10),
  }),

  // Rutero query params
  ruteroQuery: Joi.object({
    dia: Joi.string().valid('lunes', 'martes', 'miercoles', 'miércoles', 'jueves', 'viernes', 'sabado', 'sábado', 'domingo'),
  }),

  // Clientes list query params
  clientesQuery: Joi.object({
    limit: Joi.number().integer().min(1).max(1000).default(500),
    offset: Joi.number().integer().min(0).default(0),
    search: Joi.string().max(100).allow(''),
    dia: Joi.string().valid('lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'),
  }),

  // Cliente code param
  clienteCodigoParam: Joi.object({
    codigo: Joi.string().trim().min(1).max(20).pattern(/^[A-Za-z0-9\s-]+$/).required(),
  }),

  // WhatsApp share body
  shareWhatsapp: Joi.object({
    serie: Joi.string().trim().min(1).max(5).pattern(/^[A-Za-z0-9]+$/).required(),
    numero: Joi.number().integer().min(0).required(),
    ejercicio: Joi.number().integer().min(2000).max(2100).required(),
    telefono: Joi.string().min(9).max(20).pattern(/^[0-9+\s-]+$/).required(),
    clienteNombre: Joi.string().max(100).allow(''),
  }),

  // Email share body
  shareEmail: Joi.object({
    serie: Joi.string().trim().min(1).max(5).pattern(/^[A-Za-z0-9]+$/).required(),
    numero: Joi.number().integer().min(0).required(),
    ejercicio: Joi.number().integer().min(2000).max(2100).required(),
    destinatario: Joi.string().email().required(),
    clienteNombre: Joi.string().max(100).allow(''),
  }),

  // ============================================
  // COMMISSIONS
  // ============================================

  commissionsSummaryQuery: Joi.object({
    vendedorCode: Joi.string().trim().min(1).max(200).required()
      .messages({ 'any.required': 'vendedorCode es requerido' }),
    year: Joi.string().max(50).pattern(/^[0-9,\s]+$/),
  }),

  commissionsPayBody: Joi.object({
    vendedorCode: Joi.string().trim().min(1).max(20).pattern(/^[A-Za-z0-9-]+$/).required(),
    year: Joi.number().integer().min(2020).max(2100).required(),
    month: Joi.number().integer().min(0).max(12).default(0),
    amount: Joi.alternatives().try(
      Joi.number(),
      Joi.string().pattern(/^-?[0-9]+\.?[0-9]*$/),
    ).required(),
    generatedAmount: Joi.alternatives().try(
      Joi.number(),
      Joi.string().pattern(/^-?[0-9]+\.?[0-9]*$/),
    ).default(0),
    observaciones: Joi.string().max(500).allow('', null),
    adminCode: Joi.string().max(20).pattern(/^[A-Za-z0-9-]*$/).allow('', null),
    objetivoMes: Joi.alternatives().try(
      Joi.number(),
      Joi.string().pattern(/^-?[0-9]+\.?[0-9]*$/),
    ).default(0),
    ventasSobreObjetivo: Joi.alternatives().try(
      Joi.number(),
      Joi.string().pattern(/^-?[0-9]+\.?[0-9]*$/),
    ).default(0),
  }),

  // ============================================
  // OBJECTIVES
  // ============================================

  objectivesSummaryQuery: Joi.object({
    vendedorCodes: Joi.string().trim().min(1).max(200).required()
      .messages({ 'any.required': 'vendedorCodes es requerido' }),
    year: Joi.number().integer().min(2000).max(2100),
    month: Joi.number().integer().min(1).max(12),
  }),

  objectivesEvolutionQuery: Joi.object({
    vendedorCodes: Joi.string().trim().min(1).max(200).required()
      .messages({ 'any.required': 'vendedorCodes es requerido' }),
    years: Joi.string().max(50).pattern(/^[0-9,\s]+$/),
  }),

  objectivesMatrixQuery: Joi.object({
    clientCode: Joi.string().trim().min(1).max(20).pattern(/^[A-Za-z0-9\s-]+$/).required()
      .messages({ 'any.required': 'clientCode es requerido' }),
    years: Joi.string().max(50).pattern(/^[0-9,\s]+$/),
    startMonth: Joi.number().integer().min(1).max(12),
    endMonth: Joi.number().integer().min(1).max(12),
    productCode: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/).allow(''),
    productName: Joi.string().max(100).allow(''),
    familyCode: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/).allow(''),
    subfamilyCode: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/).allow(''),
    fi1: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/).allow(''),
    fi2: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/).allow(''),
    fi3: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/).allow(''),
    fi4: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/).allow(''),
    fi5: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/).allow(''),
  }),

  objectivesByClientQuery: Joi.object({
    vendedorCodes: Joi.string().trim().min(1).max(200).required()
      .messages({ 'any.required': 'vendedorCodes es requerido' }),
    years: Joi.string().max(50).pattern(/^[0-9,\s]+$/),
    months: Joi.string().max(50).pattern(/^[0-9,\s]+$/),
    city: Joi.string().max(100).allow('', null),
    code: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/).allow('', null),
    nif: Joi.string().max(20).pattern(/^[A-Za-z0-9\s-]*$/).allow('', null),
    name: Joi.string().max(100).allow('', null),
    limit: Joi.number().integer().min(1).max(1000).default(100),
  }),

  // ============================================
  // REPARTIDOR
  // ============================================

  repartidorIdParam: Joi.object({
    repartidorId: Joi.string().trim().min(1).max(200).pattern(/^[A-Za-z0-9,-]+$/).required()
      .messages({ 'any.required': 'repartidorId es requerido' }),
  }),

  clientIdParam: Joi.object({
    clientId: Joi.string().trim().min(1).max(20).pattern(/^[A-Za-z0-9\s-]+$/).required()
      .messages({ 'any.required': 'clientId es requerido' }),
  }),
};
