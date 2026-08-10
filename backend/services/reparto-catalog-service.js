'use strict';

/**
 * Validates mutable reparto codes against an injected authoritative catalog.
 * This module deliberately has no DB2 knowledge: an adapter must prove its
 * source and map it into the exact shape below before it can be used here.
 */

class RepartoCatalogError extends Error {
  constructor(message, { code = 'REPARTO_CATALOG_UNAVAILABLE', statusCode = 503, details } = {}) {
    super(message);
    this.name = 'RepartoCatalogError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const CATALOG_KEYS = Object.freeze([
  'statuses',
  'differenceReasons',
  'incidentTypes',
  'paymentMethods',
]);

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function unavailable(message, details) {
  return new RepartoCatalogError(message, {
    code: 'REPARTO_CATALOG_UNAVAILABLE',
    statusCode: 503,
    details,
  });
}

function validateCatalog(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw unavailable('El catalogo de reparto no tiene un formato valido');
  }

  const parsed = {};
  for (const key of CATALOG_KEYS) {
    if (!Array.isArray(raw[key])) {
      throw unavailable('El catalogo de reparto esta incompleto', { missing: key });
    }
    const values = raw[key].map(normalizeCode).filter(Boolean);
    if (values.length === 0 || new Set(values).size !== values.length) {
      throw unavailable('El catalogo de reparto contiene valores vacios o duplicados', { key });
    }
    parsed[key] = new Set(values);
  }
  return parsed;
}

function ensureCatalogPort(catalog) {
  if (!catalog || typeof catalog.load !== 'function') {
    throw new TypeError('A reparto catalog port with load({ signal }) is required');
  }
}

async function loadWithTimeout(catalog, { timeoutMs, signal } = {}) {
  ensureCatalogPort(catalog);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive integer');
  }
  if (signal?.aborted) throw unavailable('La consulta de catalogo fue cancelada');

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abortFromParent, { once: true });

  let timeoutId;
  try {
    const loaded = Promise.resolve().then(() => catalog.load({ signal: controller.signal }));
    const timedOut = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort(new Error('catalog timeout'));
        reject(unavailable('La consulta de catalogo de reparto ha agotado el tiempo'));
      }, timeoutMs);
    });
    const parentCancelled = signal ? new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        reject(unavailable('La consulta de catalogo fue cancelada'));
      }, { once: true });
    }) : null;
    const raw = await Promise.race([loaded, timedOut, parentCancelled].filter(Boolean));
    return validateCatalog(raw);
  } catch (error) {
    if (error instanceof RepartoCatalogError) throw error;
    throw unavailable('No se pudo consultar el catalogo de reparto');
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

function assertAllowed(values, value, field) {
  const code = normalizeCode(value);
  if (!code || !values.has(code)) {
    throw new RepartoCatalogError('Codigo de reparto no reconocido por el catalogo', {
      code: 'REPARTO_CATALOG_VALUE_UNKNOWN',
      statusCode: 422,
      details: { field, value: code || null },
    });
  }
}

function validateCommandAgainstCatalog(command, catalog) {
  const delivery = command?.delivery;
  if (!delivery || typeof delivery !== 'object') {
    throw new TypeError('A reparto confirmation command is required');
  }
  assertAllowed(catalog.statuses, delivery.status, 'delivery.status');
  for (const [index, line] of (delivery.lineas || []).entries()) {
    if (line?.motivoDiferencia) {
      assertAllowed(catalog.differenceReasons, line.motivoDiferencia, `delivery.lineas.${index}.motivoDiferencia`);
    }
  }
  if (delivery.incidencia?.tipo) {
    assertAllowed(catalog.incidentTypes, delivery.incidencia.tipo, 'delivery.incidencia.tipo');
  }
  if (command.cobro?.formaPago) {
    assertAllowed(catalog.paymentMethods, command.cobro.formaPago, 'cobro.formaPago');
  }
  return command;
}

function createRepartoCatalogService({ catalog, timeoutMs = 2500 } = {}) {
  ensureCatalogPort(catalog);
  return Object.freeze({
    async validateConfirmation(command, { signal } = {}) {
      const loadedCatalog = await loadWithTimeout(catalog, { timeoutMs, signal });
      return validateCommandAgainstCatalog(command, loadedCatalog);
    },
  });
}

module.exports = {
  RepartoCatalogError,
  createRepartoCatalogService,
  loadWithTimeout,
  validateCatalog,
  validateCommandAgainstCatalog,
};
