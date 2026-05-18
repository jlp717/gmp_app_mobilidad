/**
 * Input Validator - Zod-based request validation
 * Centralized validation schemas for all endpoints
 */
const logger = require('../../../../middleware/logger');

let z;
try {
  z = require('zod');
} catch (e) {
  logger.warn('[Validator] Zod not available. Run: npm install zod');
}

const Schemas = {
  login: z ? z.object({
    username: z.string().min(1).max(50).regex(/^[a-zA-Z0-9 ]+$/, 'Invalid username format'),
    password: z.string().min(1).max(100)
  }) : null,

  clientCode: z ? z.object({
    clientCode: z.string().min(1).max(20).regex(/^[a-zA-Z0-9]+$/, 'Invalid client code format')
  }) : null,

  vendorCode: z ? z.object({
    vendorCode: z.string().min(1).max(10).regex(/^[a-zA-Z0-9]+$/, 'Invalid vendor code format')
  }) : null,

  productCode: z ? z.object({
    productCode: z.string().min(1).max(50).regex(/^[a-zA-Z0-9\-_]+$/, 'Invalid product code format')
  }) : null,

  pagination: z ? z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  }) : null,

  dateRange: z ? z.object({
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
  }).refine(data => new Date(data.fromDate) <= new Date(data.toDate), {
    message: 'fromDate must be before toDate'
  }) : null,

  pedidoConfirm: z ? z.object({
    clientCode: z.string().min(1).max(20),
    lines: z.array(z.object({
      productCode: z.string().min(1),
      quantity: z.number().positive(),
      unit: z.string().max(10).optional()
    })).min(1, 'At least one line required')
  }) : null,

  cobroRegister: z ? z.object({
    clientCode: z.string().min(1).max(20),
    amount: z.number().positive(),
    paymentMethod: z.string().max(50),
    reference: z.string().max(100).optional()
  }) : null,

  entregaConfirm: z ? z.object({
    albaranId: z.string().min(1),
    observations: z.string().max(512).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional()
  }) : null
};

function validate(schemaName) {
  const schema = Schemas[schemaName];
  if (!schema) {
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    try {
      const source = { ...req.body, ...req.query, ...req.params };
      const validated = schema.parse(source);
      req.validatedData = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        logger.warn(`[Validation] Failed for ${schemaName}: ${JSON.stringify(errors)}`);
        return res.status(400).json({
          error: 'Validation failed',
          details: errors
        });
      }
      next(error);
    }
  };
}

function validateBody(schemaName) {
  const schema = Schemas[schemaName];
  if (!schema) return (req, res, next) => next();

  return (req, res, next) => {
    try {
      req.validatedBody = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        return res.status(400).json({ error: 'Validation failed', details: errors });
      }
      next(error);
    }
  };
}

function validateQuery(schemaName) {
  const schema = Schemas[schemaName];
  if (!schema) return (req, res, next) => next();

  return (req, res, next) => {
    try {
      req.validatedQuery = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        return res.status(400).json({ error: 'Invalid query parameters', details: errors });
      }
      next(error);
    }
  };
}

module.exports = { Schemas, validate, validateBody, validateQuery };
