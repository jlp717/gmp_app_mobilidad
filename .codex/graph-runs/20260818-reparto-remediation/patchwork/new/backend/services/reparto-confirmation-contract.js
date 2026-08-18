'use strict';

const { z } = require('zod');

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
const EVIDENCE_ID_PATTERN = /^ev_[a-f0-9]{64}$/;
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const DIFFERENCE_REASONS = [
  'PRODUCTO_FALTANTE',
  'PRODUCTO_DANADO',
  'RECHAZO_CLIENTE',
  'CLIENTE_AUSENTE',
  'DIRECCION_INCORRECTA',
  'ACCESO_IMPOSIBLE',
  'OTRO',
];
const INCIDENT_TYPES = [
  'CLIENTE_AUSENTE',
  'DIRECCION_INCORRECTA',
  'ACCESO_IMPOSIBLE',
  'VEHICULO',
  'PRODUCTO_DANADO',
  'RECHAZO_CLIENTE',
  'OTRO',
];

class RepartoContractError extends Error {
  constructor(message, { code = 'INVALID_DELIVERY_PAYLOAD', statusCode = 422 } = {}) {
    super(message);
    this.name = 'RepartoContractError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeCode(value) {
  return String(value || '').trim();
}

function normalizeComparableCode(value) {
  const code = normalizeCode(value);
  if (!/^\d+$/.test(code)) return code.toUpperCase();
  return code.replace(/^0+/, '') || '0';
}

function codesMatch(left, right) {
  const a = normalizeComparableCode(left);
  const b = normalizeComparableCode(right);
  return Boolean(a && b && a === b);
}

function isValidDniNie(raw) {
  const value = normalizeCode(raw).toUpperCase();
  if (/^\d{8}[A-Z]$/.test(value)) {
    const number = Number(value.slice(0, 8));
    return DNI_LETTERS[number % 23] === value.at(-1);
  }
  if (/^[XYZ]\d{7}[A-Z]$/.test(value)) {
    const prefix = { X: '0', Y: '1', Z: '2' }[value[0]];
    const number = Number(`${prefix}${value.slice(1, 8)}`);
    return DNI_LETTERS[number % 23] === value.at(-1);
  }
  return false;
}

const strictText = (max) => z.string().trim().min(1).max(max);
const quantitySchema = z.number().finite().min(0).max(9999999);
const evidenceIdSchema = z.string().trim().regex(EVIDENCE_ID_PATTERN, {
  message: 'Identificador de evidencia invalido',
});

const receiverSchema = z.object({
  nombre: strictText(100),
  apellidos: strictText(160),
  dni: strictText(16).transform((value) => value.toUpperCase()).refine(isValidDniNie, {
    message: 'DNI o NIE invalido',
  }),
}).strict();

const lineSchema = z.object({
  lineaId: strictText(40),
  codigoArticulo: strictText(40),
  cantidadPedida: quantitySchema.positive(),
  cantidadEntregada: quantitySchema,
  cantidadRechazada: quantitySchema,
  cantidadPendiente: quantitySchema,
  motivoDiferencia: z.enum(DIFFERENCE_REASONS).nullable().optional(),
  observaciones: z.string().trim().max(500).optional(),
}).strict().superRefine((line, ctx) => {
  const accounted = line.cantidadEntregada + line.cantidadRechazada + line.cantidadPendiente;
  if (Math.abs(accounted - line.cantidadPedida) > 0.0001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cantidadEntregada'],
      message: 'Las cantidades entregada, rechazada y pendiente deben conservar la cantidad pedida',
    });
  }
  const differs = line.cantidadRechazada > 0 || line.cantidadPendiente > 0;
  if (differs && !line.motivoDiferencia) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['motivoDiferencia'],
      message: 'Cada diferencia requiere un motivo estructurado',
    });
  }
  if (!differs && line.motivoDiferencia) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['motivoDiferencia'],
      message: 'No se admite motivo de diferencia sin cantidades rechazadas o pendientes',
    });
  }
});

const incidenceSchema = z.object({
  tipo: z.enum(INCIDENT_TYPES),
  motivo: strictText(500),
  observaciones: z.string().trim().max(1000).optional(),
}).strict();

const deliverySchema = z.object({
  itemId: strictText(160),
  status: z.enum(['ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO']),
  occurredAt: z.string().datetime({ offset: true }),
  repartidorId: z.string().trim().min(1).max(20).optional(),
  receiver: receiverSchema.optional(),
  lineas: z.array(lineSchema).min(0).max(250),
  firma: evidenceIdSchema.optional(),
  evidencias: z.array(evidenceIdSchema).max(20).optional().default([]),
  observaciones: z.string().trim().max(1000).optional(),
  incidencia: incidenceSchema.optional(),
  latitud: z.number().finite().min(-90).max(90).optional(),
  longitud: z.number().finite().min(-180).max(180).optional(),
  forceUpdate: z.literal(false).optional(),
}).strict().superRefine((delivery, ctx) => {
  const received = delivery.status !== 'NO_ENTREGADO';
  if (received && !delivery.receiver) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['receiver'], message: 'Receptor requerido' });
  }
  if (received && !delivery.firma) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['firma'], message: 'Firma requerida' });
  }
  if (delivery.status === 'NO_ENTREGADO') {
    if (!delivery.incidencia || !delivery.observaciones) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['incidencia'],
        message: 'La no entrega requiere incidencia estructurada y observaciones',
      });
    }
    if (delivery.receiver || delivery.firma) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receiver'],
        message: 'Una no entrega no puede declarar receptor ni firma',
      });
    }
  }

  if (delivery.lineas.length === 0
    && delivery.status !== 'ENTREGADO'
    && delivery.status !== 'NO_ENTREGADO') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lineas'],
      message: 'Solo ENTREGADO (prepago 0 €) o NO_ENTREGADO admiten documento sin lineas',
    });
  }

  const delivered = delivery.lineas.reduce((sum, item) => sum + item.cantidadEntregada, 0);
  const rejected = delivery.lineas.reduce((sum, item) => sum + item.cantidadRechazada, 0);
  const pending = delivery.lineas.reduce((sum, item) => sum + item.cantidadPendiente, 0);
  if (delivery.status === 'ENTREGADO' && (rejected > 0 || pending > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'ENTREGADO exige todas las unidades entregadas' });
  }
  if (delivery.status === 'PARCIAL' && (delivered <= 0 || rejected + pending <= 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'PARCIAL exige unidades entregadas y diferencia pendiente o rechazada' });
  }
  if (delivery.status === 'NO_ENTREGADO' && (delivered > 0 || rejected > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'NO_ENTREGADO exige todas las unidades pendientes' });
  }
  if (delivery.status === 'RECHAZADO' && (delivered > 0 || pending > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'RECHAZADO exige todas las unidades rechazadas' });
  }

  const lineIds = new Set();
  for (const item of delivery.lineas) {
    if (lineIds.has(item.lineaId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lineas'], message: 'lineaId duplicado' });
      break;
    }
    lineIds.add(item.lineaId);
  }

  const evidenceIds = new Set();
  for (const evidenceId of delivery.evidencias) {
    if (evidenceIds.has(evidenceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidencias'],
        message: 'No se admiten evidencias duplicadas',
      });
      break;
    }
    evidenceIds.add(evidenceId);
  }
  if (delivery.firma && evidenceIds.has(delivery.firma)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['firma'],
      message: 'La firma no puede repetirse como evidencia fotografica',
    });
  }

  const occurredAt = new Date(delivery.occurredAt).getTime();
  if (occurredAt > Date.now() + (5 * 60 * 1000)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['occurredAt'], message: 'occurredAt no puede estar en el futuro' });
  }
});

const paymentSchema = z.object({
  entregaId: z.union([z.string(), z.number()]).optional().nullable(),
  importeCobrado: z.number().finite().positive().max(99999999),
  formaPago: strictText(20),
  notas: z.string().trim().max(500).optional(),
}).strict();
const confirmationSchema = z.object({
  delivery: deliverySchema,
  cobro: paymentSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.cobro && !['ENTREGADO', 'PARCIAL'].includes(value.delivery.status)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cobro'], message: 'El estado no admite cobro' });
  }
  if (value.cobro?.entregaId && String(value.cobro.entregaId).trim() !== value.delivery.itemId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cobro', 'entregaId'], message: 'entregaId no coincide con delivery.itemId' });
  }
});

function parseIdempotencyKey(raw) {
  const value = normalizeCode(raw);
  if (!value) {
    throw new RepartoContractError('Idempotency-Key es obligatorio', {
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      statusCode: 400,
    });
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new RepartoContractError('Idempotency-Key invalido', {
      code: 'INVALID_IDEMPOTENCY_KEY',
      statusCode: 422,
    });
  }
  return value;
}

function parseConfirmationBody(raw) {
  const parsed = confirmationSchema.safeParse(raw);
  if (!parsed.success) {
    const error = new RepartoContractError('Confirmacion de entrega invalida');
    error.details = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw error;
  }
  return parsed.data;
}

function buildActor(user, body) {
  const current = user || {};
  const userId = normalizeCode(current.id || current.user || current.code);
  const ownRepartidorId = normalizeCode(current.code || current.id || current.user);
  if (!userId || !ownRepartidorId) {
    throw new RepartoContractError('Contexto autenticado incompleto', {
      code: 'AUTHENTICATED_ACTOR_REQUIRED',
      statusCode: 401,
    });
  }

  const requested = normalizeCode(
    body.delivery.repartidorId || ownRepartidorId,
  );
  const role = normalizeCode(current.role).toUpperCase();
  const activeMode = normalizeCode(current.activeMode).toUpperCase();
  // ADMIN or JEFE supervising Perfil Reparto may confirm for the selected driver.
  const privileged = role === 'ADMIN'
    || (role === 'JEFE_VENTAS' && activeMode === 'REPARTIDOR');
  if (!privileged && !codesMatch(ownRepartidorId, requested)) {
    throw new RepartoContractError('La entrega no pertenece al repartidor autenticado', {
      code: 'DELIVERY_OWNERSHIP_REQUIRED',
      statusCode: 403,
    });
  }

  return Object.freeze({
    userId,
    repartidorId: privileged ? requested : ownRepartidorId,
    role,
    privileged,
  });
}

function buildConfirmationCommand({ user, headers, body }) {
  const idempotencyKey = parseIdempotencyKey(headers?.['idempotency-key']);
  const parsed = parseConfirmationBody(body);
  const actor = buildActor(user, parsed);
  const repartidorId = actor.repartidorId;

  return {
    idempotencyKey,
    actor,
    delivery: {
      ...parsed.delivery,
      repartidorId,
      forceUpdate: false,
      idempotencyToken: idempotencyKey,
    },
    cobro: parsed.cobro ? {
      ...parsed.cobro,
    } : undefined,
  };
}

module.exports = {
  RepartoContractError,
  buildConfirmationCommand,
  codesMatch,
  EVIDENCE_ID_PATTERN,
  isValidDniNie,
  DIFFERENCE_REASONS,
  INCIDENT_TYPES,
};
