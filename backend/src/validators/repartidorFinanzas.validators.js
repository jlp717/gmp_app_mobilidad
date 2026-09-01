'use strict';

/**
 * Fuente unica de validacion de entrada para finanzas del repartidor.
 * Todos los esquemas zod y helpers de selector viven AQUI. El route file
 * importa desde este modulo: no duplicar definiciones.
 */
const { z } = require('zod');

const singleCodeSchema = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/);
const numericCodeSchema = z.string().trim().min(1).max(20).regex(/^\d+$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((raw) => {
  const date = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw;
}, 'Fecha invalida');
const idempotencyTokenSchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const liquidacionPdfParamsSchema = z.object({ idempotencyToken: idempotencyTokenSchema });
const liquidacionPdfQuerySchema = z.object({ repartidorId: numericCodeSchema }).strict();
const detailDocIdSchema = z.string().trim().regex(
  /^[A-Za-z0-9]{1,10}-\d{4}-[A-Za-z0-9]{1,10}-\d{1,10}-\d{1,10}-\d{1,10}$/,
);
const moneySchema = z.coerce.number().min(0).max(99999999);

const paramsSchema = z.object({
  repartidorId: singleCodeSchema,
});

const codeListSchema = z.string().trim().min(1).max(500).regex(/^[A-Za-z0-9_,-]+$/);

const listParamsSchema = z.object({
  repartidorId: codeListSchema,
});

const numericParamsSchema = z.object({
  repartidorId: numericCodeSchema,
});

const dailySummaryQuerySchema = z.object({
  date: dateSchema.default(() => new Date().toISOString().slice(0, 10)),
});

const summaryQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()),
  month: z.coerce.number().int().min(1).max(12).default(new Date().getMonth() + 1),
});

// Compat: APK 4.1.2+52 envia solo limit (a veces 200) sin from/to.
// Defaults = ventana ±180 dias; limit se clampea a 100.
const vencimientosDefaultFromIso = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 180);
  return d.toISOString().slice(0, 10);
};
const vencimientosDefaultToIso = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 180);
  return d.toISOString().slice(0, 10);
};
const vencimientosQuerySchema = z.object({
  from: dateSchema.default(vencimientosDefaultFromIso),
  to: dateSchema.default(vencimientosDefaultToIso),
  limit: z.preprocess(
    (raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return 50;
      return Math.min(100, Math.max(1, Math.trunc(n)));
    },
    z.number().int().min(1).max(100),
  ).default(50),
  cursor: z.string().trim().min(1).max(512).optional(),
  clientCode: z.string().trim().max(20).optional(),
  search: z.string().trim().max(80).optional(),
  estado: z.enum(['pendiente', 'vencido', 'cobrado']).optional(),
  tipoDocumento: z.enum(['CAC', 'COC', 'DEV']).optional(),
}).refine((query) => query.from <= query.to, {
  path: ['to'],
  message: 'El final del rango debe ser igual o posterior al inicio',
});

const cobroSchema = z.object({
  entregaId: z.union([z.string(), z.number()]).optional().nullable(),
  codigoCliente: z.string().trim().min(1).max(20),
  nombreCliente: z.string().trim().max(120).optional(),
  codigoRepartidor: singleCodeSchema,
  tipoDocumento: z.string().trim().min(1).max(10),
  origenDocumento: z.string().trim().max(1).optional().default('B'),
  subempresaDocumento: z.string().trim().max(3).optional().default('GMP'),
  ejercicioDocumento: z.coerce.number().int().min(2000).max(2100),
  serieDocumento: z.string().trim().max(5),
  terminalDocumento: z.coerce.number().int().min(0).max(999),
  numeroDocumento: z.coerce.number().int().min(1),
  xdeDocumento: z.coerce.number().int().min(0).max(99).optional().default(1),
  dexDocumento: z.coerce.number().int().min(0).max(99).optional().default(1),
  importeCobrado: moneySchema,
  importePendiente: moneySchema.default(0),
  formaPago: z.string().trim().min(1).max(20),
  pantallaOrigen: z.enum(['RUTERO', 'VENCIMIENTOS']).default('RUTERO'),
  idempotencyToken: idempotencyTokenSchema,
  notas: z.string().trim().max(60).optional(),
});

const legacyLiquidacionSchema = z.object({
  repartidorId: singleCodeSchema,
  date: dateSchema,
  idempotencyToken: idempotencyTokenSchema,
  matricula: z.string().trim().max(20).optional(),
  codigoVehiculo: z.string().trim().max(10).optional(),
  sendEmails: z.boolean().optional().default(true),
  totals: z.object({
    totalEfectivo: moneySchema.default(0),
    totalCheques: moneySchema.default(0),
    totalTarjeta: moneySchema.default(0),
    totalPostdatados: moneySchema.default(0),
    saldoActual: z.coerce.number().min(-99999999).max(99999999).default(0),
    totalCobrosDia: moneySchema.default(0),
    totalAIngresar: moneySchema.default(0),
    ingresoBanco: moneySchema.default(0),
    gastos: moneySchema.default(0),
    efectivo2: moneySchema.default(0),
    entregado2: moneySchema.default(0),
  }),
});

// Liquidation amounts and operation lists are derived exclusively by the
// server-side transaction. Keep this boundary deliberately small so an old
// client cannot make a daily close balance on client supplied totals.
const liquidacionCloseSchema = z.object({
  repartidorId: numericCodeSchema,
  date: dateSchema,
  idempotencyToken: idempotencyTokenSchema,
  matricula: z.string().trim().max(20).optional(),
  codigoVehiculo: z.string().trim().max(10).optional(),
  sendEmails: z.boolean().optional().default(true),
}).strict();

const LIQUIDACION_DERIVED_FIELDS = new Set([
  'totals', 'snapshot', 'deliveries', 'payments', 'expenses', 'adjustments',
  'bankDeposits', 'openingBalance', 'pending', 'balance', 'breakdown',
  'totalEfectivo', 'totalCheques',
  'totalTarjeta', 'totalPostdatados', 'totalCobrosDia', 'totalAIngresar',
  'ingresoBanco', 'gastos', 'efectivo2', 'entregado2', 'saldoActual',
]);

function parseLiquidacionCloseRequest(body) {
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body : body;
  const forbidden = value && typeof value === 'object'
    ? Object.keys(value).filter((key) => LIQUIDACION_DERIVED_FIELDS.has(key))
    : [];
  if (forbidden.length) {
    const error = new Error('Los importes y operaciones de liquidacion los calcula el servidor');
    error.code = 'LIQUIDACION_CLIENT_DERIVED_FIELDS_FORBIDDEN';
    error.statusCode = 422;
    error.details = { fields: forbidden };
    throw error;
  }
  try {
    return liquidacionCloseSchema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError && error.errors.some((item) => item.code === 'unrecognized_keys')) {
      const typed = new Error('El cierre de liquidacion contiene campos no permitidos');
      typed.code = 'LIQUIDACION_CLIENT_FIELDS_FORBIDDEN';
      typed.statusCode = 422;
      typed.details = { fields: error.errors.flatMap((item) => item.keys || []) };
      throw typed;
    }
    throw error;
  }
}

const tiersSchema = z.object({
  tiers: z.array(z.object({
    thresholdPct: z.coerce.number().min(30).max(100),
    commissionPct: z.coerce.number().min(0).max(100),
  })).min(1).max(20),
});

// Defaults sensatos para que el frontend no tenga que mandar siempre los
// rangos: si no se mandan, asumimos "este mes en curso".
const firstDayCurrentMonthIso = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const rangeQuerySchema = z.object({
  from: dateSchema.default(firstDayCurrentMonthIso),
  to: dateSchema.default(todayIso),
}).refine((query) => query.from <= query.to, {
  path: ['to'],
  message: 'El final del rango debe ser igual o posterior al inicio',
});

class UnsupportedRepartidorSelectorError extends Error {
  constructor() {
    super('Usa codigos de repartidor explicitos; el selector ALL no esta soportado');
    this.name = 'UnsupportedRepartidorSelectorError';
    this.code = 'UNSUPPORTED_REPARTIDOR_SELECTOR';
    this.statusCode = 422;
  }
}

function assertExplicitRepartidorSelector(repartidorId) {
  const codes = String(repartidorId || '').split(',').map((code) => code.trim().toUpperCase());
  if (codes.includes('ALL')) throw new UnsupportedRepartidorSelectorError();
}

function normalizedRepartidorSelection(repartidorId) {
  const selected = String(repartidorId || '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
  assertExplicitRepartidorSelector(selected.join(','));
  return selected;
}

module.exports = {
  singleCodeSchema,
  numericCodeSchema,
  dateSchema,
  idempotencyTokenSchema,
  liquidacionPdfParamsSchema,
  liquidacionPdfQuerySchema,
  detailDocIdSchema,
  moneySchema,
  paramsSchema,
  codeListSchema,
  listParamsSchema,
  numericParamsSchema,
  dailySummaryQuerySchema,
  summaryQuerySchema,
  vencimientosDefaultFromIso,
  vencimientosDefaultToIso,
  vencimientosQuerySchema,
  cobroSchema,
  legacyLiquidacionSchema,
  liquidacionCloseSchema,
  LIQUIDACION_DERIVED_FIELDS,
  parseLiquidacionCloseRequest,
  tiersSchema,
  firstDayCurrentMonthIso,
  todayIso,
  rangeQuerySchema,
  UnsupportedRepartidorSelectorError,
  assertExplicitRepartidorSelector,
  normalizedRepartidorSelection,
};
