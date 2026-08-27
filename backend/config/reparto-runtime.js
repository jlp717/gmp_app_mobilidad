'use strict';

const ALLOWED_ENVIRONMENTS = new Set(['test', 'staging', 'production']);

const { G4_DSEDAC_ERP_MAPPING } = require('./g4-dsedac-erp-mapping');
const ALLOWED_SCHEMAS = new Set(['DSEDAC', 'JAVIER', 'TESTMOVIL']);
const ALLOWED_TABLE_SETS = new Set(['isolated_test', 'production', 'testmovil']);
const SAFE_DSN_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

const TABLE_MAPPINGS = Object.freeze({
  isolated_test: Object.freeze({
    confirmation: Object.freeze({
      confirmations: 'JAVIER.TEST_REPARTO_CONFIRMACIONES',
      lines: 'JAVIER.TEST_REPARTO_LINEAS',
      evidences: 'JAVIER.TEST_REPARTO_EVIDENCIAS',
      confirmationEvidences: 'JAVIER.TEST_REPARTO_CONFIRM_EVIDENCIAS',
    }),
    finance: Object.freeze({
      cobros: 'JAVIER.TEST_REPARTIDOR_COBROS',
      audit: 'JAVIER.TEST_REPARTIDOR_COBROS_AUDIT',
      commissionTiers: 'JAVIER.TEST_REPARTIDOR_COMMISSION_TIERS',
      balances: 'JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES',
      liquidationEmails: 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_EMAILS',
      liquidationOps: 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS',
      expenses: 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_GASTOS',
      adjustments: 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_AJUSTES',
      bankDeposits: 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_INGRESOS',
      liquidationOutbox: 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_OUTBOX',
      liquidationSequence: 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_SEQ',
      commercialCobros: 'JAVIER.TEST_COBROS',
    }),
    routing: Object.freeze({
      order: 'JAVIER.TEST_REPARTIDOR_RUTERO_ORDEN',
      dayOverride: 'JAVIER.TEST_REPARTIDOR_RUTERO_DIA_OVERRIDE',
      moveRequests: 'JAVIER.TEST_REPARTIDOR_RUTERO_MOVE_REQUESTS',
      tracking: 'JAVIER.TEST_REPARTIDOR_RUTERO_TRACKING',
    }),
    notifications: Object.freeze({
      roleTargets: 'JAVIER.TEST_NOTIFICATION_ROLE_TARGETS',
      varianceOutbox: 'JAVIER.TEST_REPARTO_VARIANCE_OUTBOX',
      deliveryStatus: 'JAVIER.TEST_DELIVERY_STATUS',
    }),
  }),
  production: Object.freeze({
    confirmation: Object.freeze({
      confirmations: 'JAVIER.REPARTO_CONFIRMACIONES',
      lines: 'JAVIER.REPARTO_LINEAS',
      evidences: 'JAVIER.REPARTO_EVIDENCIAS',
      confirmationEvidences: 'JAVIER.REPARTO_CONFIRM_EVIDENCIAS',
    }),
    finance: Object.freeze({
      cobros: 'JAVIER.REPARTIDOR_COBROS',
      audit: 'JAVIER.REPARTIDOR_COBROS_AUDIT',
      commissionTiers: 'JAVIER.REPARTIDOR_COMMISSION_TIERS',
      balances: 'JAVIER.REPARTIDOR_FINANCIAL_BALANCES',
      liquidationEmails: 'JAVIER.REPARTIDOR_LIQUIDACION_EMAILS',
      liquidationOps: 'JAVIER.REPARTIDOR_LIQUIDACION_OPS',
      expenses: 'JAVIER.REPARTIDOR_LIQUIDACION_GASTOS',
      adjustments: 'JAVIER.REPARTIDOR_LIQUIDACION_AJUSTES',
      bankDeposits: 'JAVIER.REPARTIDOR_LIQUIDACION_INGRESOS',
      liquidationOutbox: 'JAVIER.REPARTIDOR_LIQUIDACION_OUTBOX',
      liquidationSequence: 'JAVIER.REPARTIDOR_LIQUIDACION_SEQ',
      commercialCobros: 'JAVIER.COBROS',
    }),
    routing: Object.freeze({
      order: 'JAVIER.REPARTIDOR_RUTERO_ORDEN',
      dayOverride: 'JAVIER.REPARTIDOR_RUTERO_DIA_OVERRIDE',
      moveRequests: 'JAVIER.REPARTIDOR_RUTERO_MOVE_REQUESTS',
      tracking: 'JAVIER.REPARTIDOR_RUTERO_TRACKING',
    }),
    notifications: Object.freeze({
      roleTargets: 'JAVIER.NOTIFICATION_ROLE_TARGETS',
      varianceOutbox: 'JAVIER.REPARTO_VARIANCE_OUTBOX',
      deliveryStatus: 'JAVIER.DELIVERY_STATUS',
    }),
  }),
  testmovil: Object.freeze({
    confirmation: Object.freeze({
      confirmations: 'TESTMOVIL.LIQDIACUE',
      lines: 'TESTMOVIL.LIQDIACUE',
      evidences: 'TESTMOVIL.LIQDIACUE',
      confirmationEvidences: 'TESTMOVIL.LIQDIACUE',
    }),
    finance: Object.freeze({
      cobros: 'TESTMOVIL.COBROCABEC',
      audit: 'TESTMOVIL.LIQDIACUE',
      commissionTiers: 'TESTMOVIL.LIQDIACUE',
      balances: 'TESTMOVIL.VENDEDORES',
      liquidationEmails: 'TESTMOVIL.LIQDIACUE',
      liquidationOps: 'TESTMOVIL.LIQUIDIARI',
      expenses: 'TESTMOVIL.LIQDIACUE',
      adjustments: 'TESTMOVIL.LIQDIACUE',
      bankDeposits: 'TESTMOVIL.LIQDIACUE',
      liquidationOutbox: 'TESTMOVIL.LIQDIACUE',
      liquidationSequence: 'TESTMOVIL.LIQDIACUE',
      commercialCobros: 'TESTMOVIL.COBROCABEC',
    }),
    routing: Object.freeze({
      order: 'TESTMOVIL.LIQUIDIARI',
      dayOverride: 'TESTMOVIL.REPARTIDOR_RUTERO_DIA_OVERRIDE',
      moveRequests: 'TESTMOVIL.REPARTIDOR_RUTERO_MOVE_REQUESTS',
      tracking: 'TESTMOVIL.REPARTIDOR_RUTERO_TRACKING',
    }),
    notifications: Object.freeze({
      roleTargets: 'TESTMOVIL.LIQDIACUE',
      varianceOutbox: 'TESTMOVIL.LIQDIACUE',
      deliveryStatus: 'TESTMOVIL.LIQDIACUE',
    }),
  }),
});

const FINANCE_TABLE_KEYS = Object.freeze([
  'cobros',
  'audit',
  'commissionTiers',
  'balances',
  'liquidationEmails',
  'liquidationOps',
  'expenses',
  'adjustments',
  'bankDeposits',
  'liquidationOutbox',
  'liquidationSequence',
  'commercialCobros',
]);
const CANONICAL_TABLE_IDENTIFIER = /^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/;
const CONFIRMATION_TABLE_KEYS = Object.freeze([
  'confirmations', 'lines', 'evidences', 'confirmationEvidences',
]);
const FINANCE_WRITE_TABLE_KEYS = Object.freeze([
  'cobros', 'audit', 'balances', 'liquidationOps', 'expenses', 'adjustments',
  'bankDeposits', 'liquidationOutbox',
]);

function validateConfirmationTableMapping(runtime) {
  const errors = [];
  const confirmation = runtime?.tables?.confirmation;
  const expected = TABLE_MAPPINGS[runtime?.tableSet]?.confirmation;
  if (!runtime?.valid || !confirmation || !expected) {
    return Object.freeze({ valid: false, errors: Object.freeze(['confirmation runtime mapping is unavailable']) });
  }
  if (Object.keys(confirmation).sort().join('|') !== [...CONFIRMATION_TABLE_KEYS].sort().join('|')) {
    errors.push('confirmation table mapping keys do not match the exact allowlist');
  }
  for (const key of CONFIRMATION_TABLE_KEYS) {
    const identifier = confirmation[key];
    if (!CANONICAL_TABLE_IDENTIFIER.test(identifier || '')) {
      errors.push(`confirmation.${key} is not a canonical qualified identifier`);
      continue;
    }
    if (identifier !== expected[key]) {
      errors.push(`confirmation.${key} does not match the versioned ${runtime.tableSet} mapping`);
    }
    if (runtime.tableSet !== 'testmovil' && !identifier.startsWith('JAVIER.')) {
      errors.push(`confirmation.${key} must use the JAVIER application schema`);
    }
    if (runtime.tableSet === 'isolated_test' && !identifier.startsWith('JAVIER.TEST_')) {
      errors.push(`confirmation.${key} must use JAVIER.TEST_* in isolated_test`);
    }
    if (runtime.tableSet === 'testmovil' && !identifier.startsWith('TESTMOVIL.')) {
      errors.push(`confirmation.${key} must use TESTMOVIL.* in testmovil`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function validateFinanceTableMapping(runtime) {
  const errors = [];
  const finance = runtime?.tables?.finance;
  const expected = TABLE_MAPPINGS[runtime?.tableSet]?.finance;
  if (!runtime?.valid || !finance || !expected) {
    return Object.freeze({ valid: false, errors: Object.freeze(['finance runtime mapping is unavailable']) });
  }

  const actualKeys = Object.keys(finance).sort();
  const expectedKeys = [...FINANCE_TABLE_KEYS].sort();
  if (actualKeys.join('|') !== expectedKeys.join('|')) {
    errors.push('finance table mapping keys do not match the exact allowlist');
  }
  for (const key of FINANCE_TABLE_KEYS) {
    const identifier = finance[key];
    if (!CANONICAL_TABLE_IDENTIFIER.test(identifier || '')) {
      errors.push(`finance.${key} is not a canonical qualified identifier`);
      continue;
    }
    if (identifier !== expected[key]) {
      errors.push(`finance.${key} does not match the versioned ${runtime.tableSet} mapping`);
    }
    if (runtime.tableSet === 'isolated_test' && !identifier.startsWith('JAVIER.TEST_')) {
      errors.push(`finance.${key} must use JAVIER.TEST_* in isolated_test`);
    }
    if (runtime.tableSet === 'testmovil' && !identifier.startsWith('TESTMOVIL.')) {
      errors.push(`finance.${key} must use TESTMOVIL.* in testmovil`);
    }
    if (runtime.tableSet === 'testmovil' && identifier === 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS') {
      errors.push('JAVIER.TEST_REPARTIDOR_LIQUIDACION_OPS is BLOCK for G4 testmovil');
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseStrictBoolean(value, name, errors, defaultValue) {
  const raw = clean(value).toLowerCase();
  if (!raw && defaultValue !== undefined) return defaultValue;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  errors.push(`${name} must be explicitly true or false`);
  return false;
}

function parseSchema(value, name, errors) {
  const schema = clean(value).toUpperCase();
  if (!schema || !ALLOWED_SCHEMAS.has(schema)) {
    errors.push(`${name} must be one of: ${Array.from(ALLOWED_SCHEMAS).join(', ')}`);
    return null;
  }
  return schema;
}

function parseBoundedInteger(value, name, min, max, errors) {
  const raw = clean(value);
  if (!/^\d+$/.test(raw)) {
    errors.push(`${name} must be an explicit integer between ${min} and ${max}`);
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    errors.push(`${name} must be an explicit integer between ${min} and ${max}`);
    return null;
  }
  return parsed;
}

function assertAliasMatches(env, alias, canonicalName, canonicalValue, errors) {
  const aliasValue = clean(env[alias]);
  if (!aliasValue) return;
  if (aliasValue.toUpperCase() !== canonicalValue) {
    errors.push(`${alias} contradicts ${canonicalName}`);
  }
}

function resolveRepartoRuntime(env = {}) {
  const errors = [];
  const nodeEnvironment = clean(env.NODE_ENV).toLowerCase();
  const environment = clean(env.REPARTO_ENVIRONMENT).toLowerCase();
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    errors.push('REPARTO_ENVIRONMENT must be explicitly test, staging, or production');
  }

  if (nodeEnvironment === 'test' && environment !== 'test') {
    errors.push('NODE_ENV=test requires REPARTO_ENVIRONMENT=test');
  }
  if (environment === 'test' && nodeEnvironment !== 'test') {
    errors.push('REPARTO_ENVIRONMENT=test requires NODE_ENV=test');
  }
  if (environment === 'production' && nodeEnvironment !== 'production') {
    errors.push('REPARTO_ENVIRONMENT=production requires NODE_ENV=production');
  }
  if (environment === 'staging' && !['production', 'staging'].includes(nodeEnvironment)) {
    errors.push('REPARTO_ENVIRONMENT=staging requires NODE_ENV=staging or production');
  }

  const tableSet = clean(env.REPARTO_TABLE_SET).toLowerCase();
  if (!ALLOWED_TABLE_SETS.has(tableSet)) {
    errors.push('REPARTO_TABLE_SET must be explicitly isolated_test, production, or testmovil');
  }
  if (clean(env.REPARTO_CONFIRMATION_TABLE_SET)) {
    errors.push('REPARTO_CONFIRMATION_TABLE_SET is retired; use only REPARTO_TABLE_SET');
  }

  const evidencePendingTtlHours = parseBoundedInteger(
    env.REPARTO_EVIDENCE_PENDING_TTL_HOURS,
    'REPARTO_EVIDENCE_PENDING_TTL_HOURS',
    1,
    168,
    errors,
  );

  const dsn = clean(env.ODBC_DSN);
  if (!SAFE_DSN_PATTERN.test(dsn)) {
    errors.push('ODBC_DSN is required and must contain only safe DSN characters');
  }

  const readSchema = parseSchema(
    env.REPARTIDOR_FINANCE_READ_SCHEMA,
    'REPARTIDOR_FINANCE_READ_SCHEMA',
    errors,
  );
  const appSchema = parseSchema(
    env.REPARTIDOR_FINANCE_APP_SCHEMA,
    'REPARTIDOR_FINANCE_APP_SCHEMA',
    errors,
  );
  const erpSchema = parseSchema(
    env.REPARTIDOR_FINANCE_ERP_SCHEMA,
    'REPARTIDOR_FINANCE_ERP_SCHEMA',
    errors,
  );

  const writesRequested = parseStrictBoolean(
    env.REPARTO_WRITES_ENABLED,
    'REPARTO_WRITES_ENABLED',
    errors,
  );
  const productionApproval = parseStrictBoolean(
    env.REPARTO_PRODUCTION_WRITES_APPROVED,
    'REPARTO_PRODUCTION_WRITES_APPROVED',
    errors,
    false,
  );
  const productionErpWritesApproved = parseStrictBoolean(
    env.REPARTO_PRODUCTION_ERP_WRITES_APPROVED,
    'REPARTO_PRODUCTION_ERP_WRITES_APPROVED',
    errors,
    false,
  );
  const confirmationCapabilityApproved = parseStrictBoolean(
    env.REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED,
    'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED',
    errors,
    false,
  );
  const productionConfirmationApproved = parseStrictBoolean(
    env.REPARTO_PRODUCTION_CONFIRMATION_APPROVED,
    'REPARTO_PRODUCTION_CONFIRMATION_APPROVED',
    errors,
    false,
  );

  const financeCapabilityRequested = parseStrictBoolean(
    env.REPARTO_FINANCE_DB2_CAPABILITY_APPROVED,
    'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED',
    errors,
    false,
  );
  if (appSchema === 'DSEDAC') {
    errors.push('DSEDAC is never an allowed reparto application write schema');
  }
  if ((environment === 'test' || environment === 'staging') && tableSet !== 'isolated_test' && tableSet !== 'testmovil') {
    errors.push(`${environment} reparto requires REPARTO_TABLE_SET=isolated_test or testmovil`);
  }
  if (tableSet === 'testmovil') {
    if (appSchema !== 'TESTMOVIL' || erpSchema !== 'TESTMOVIL' || readSchema !== 'TESTMOVIL') {
      errors.push('testmovil G4 requires REPARTIDOR_FINANCE_*_SCHEMA=TESTMOVIL');
    }
    if (appSchema === 'JAVIER' || erpSchema === 'JAVIER' || erpSchema === 'DSEDAC' || appSchema === 'DSEDAC') {
      errors.push('testmovil write path cannot use JAVIER or DSEDAC');
    }
  } else {
    if ((environment === 'test' || environment === 'staging') && appSchema !== 'JAVIER') {
      errors.push(`${environment} reparto requires JAVIER app schema`);
    }
    if ((environment === 'test' || environment === 'staging') && erpSchema !== 'JAVIER') {
      errors.push(`${environment} reparto cannot write DSEDAC ERP tables`);
    }
    if (readSchema !== 'DSEDAC') {
      errors.push('reparto reads always require DSEDAC; JAVIER is write/app buffers only');
    }
  }
  if (environment === 'production' && tableSet !== 'production') {
    errors.push('production reparto requires REPARTO_TABLE_SET=production');
  }
  const selectedTables = TABLE_MAPPINGS[tableSet] || null;
  const confirmationMappingValidation = validateConfirmationTableMapping({
    valid: Boolean(selectedTables), tableSet, tables: selectedTables,
  });
  const confirmationTableMappingValid = confirmationMappingValidation.valid;
  const financeMappingValidation = validateFinanceTableMapping({
    valid: Boolean(selectedTables),
    tableSet,
    tables: selectedTables,
  });
  const financeTableMappingValid = financeMappingValidation.valid;
  const financeTargetsDsedac = financeTableMappingValid
    && FINANCE_WRITE_TABLE_KEYS.some((key) => selectedTables.finance[key].startsWith('DSEDAC.'));
  if (financeCapabilityRequested && !financeTableMappingValid) {
    errors.push('REPARTO_FINANCE_DB2_CAPABILITY_APPROVED requires the exact versioned finance table mapping');
  }
  if (financeCapabilityRequested && !writesRequested) {
    errors.push('REPARTO_FINANCE_DB2_CAPABILITY_APPROVED requires REPARTO_WRITES_ENABLED=true');
  }
  if (financeCapabilityRequested && environment !== 'production' && tableSet !== 'isolated_test' && tableSet !== 'testmovil') {
    errors.push('REPARTO_FINANCE_DB2_CAPABILITY_APPROVED requires isolated_test or testmovil outside production');
  }
  if (confirmationCapabilityApproved && tableSet === 'testmovil') {
    errors.push('testmovil G4 blocks confirmation writes');
  }
  if (financeCapabilityRequested && environment === 'production' && tableSet !== 'production') {
    errors.push('REPARTO_FINANCE_DB2_CAPABILITY_APPROVED requires production table set in production');
  }
  if (financeCapabilityRequested && environment === 'production' && financeTargetsDsedac && !productionErpWritesApproved) {
    errors.push('Production finance tables in DSEDAC require REPARTO_PRODUCTION_ERP_WRITES_APPROVED=true');
  }
  if (confirmationCapabilityApproved && !writesRequested) {
    errors.push('REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED requires REPARTO_WRITES_ENABLED=true');
  }
  if (confirmationCapabilityApproved && !confirmationTableMappingValid) {
    errors.push('REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED requires the exact versioned confirmation table mapping');
  }
  if (confirmationCapabilityApproved && environment !== 'production' && tableSet !== 'isolated_test') {
    errors.push('REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED requires isolated_test outside production');
  }
  if (confirmationCapabilityApproved && environment === 'production' && !productionConfirmationApproved) {
    errors.push('Production canonical confirmation requires REPARTO_PRODUCTION_CONFIRMATION_APPROVED=true');
  }
  if (appSchema) {
    assertAliasMatches(env, 'DB2_WRITE_SCHEMA', 'REPARTIDOR_FINANCE_APP_SCHEMA', appSchema, errors);
    assertAliasMatches(
      env,
      'PEDIDOS_CONFIRMATION_SCHEMA',
      'REPARTIDOR_FINANCE_APP_SCHEMA',
      appSchema,
      errors,
    );
  }
  if (readSchema) {
    assertAliasMatches(env, 'DB2_READ_SCHEMA', 'REPARTIDOR_FINANCE_READ_SCHEMA', readSchema, errors);
  }

  if (environment !== 'production' && productionApproval) {
    errors.push('REPARTO_PRODUCTION_WRITES_APPROVED is only valid in production');
  }
  if (environment !== 'production' && productionErpWritesApproved) {
    errors.push('REPARTO_PRODUCTION_ERP_WRITES_APPROVED is only valid in production');
  }
  if (environment !== 'production' && productionConfirmationApproved) {
    errors.push('REPARTO_PRODUCTION_CONFIRMATION_APPROVED is only valid in production');
  }
  if (environment === 'production' && productionConfirmationApproved
      && (!writesRequested || !confirmationCapabilityApproved)) {
    errors.push('REPARTO_PRODUCTION_CONFIRMATION_APPROVED requires requested production confirmation capability');
  }
  if (environment === 'production' && productionErpWritesApproved && (!writesRequested || erpSchema !== 'DSEDAC')) {
    errors.push('REPARTO_PRODUCTION_ERP_WRITES_APPROVED requires requested production writes with ERP schema DSEDAC');
  }
  if (environment === 'production' && writesRequested && !productionApproval) {
    errors.push('Production reparto writes require REPARTO_PRODUCTION_WRITES_APPROVED=true');
  }
  const valid = errors.length === 0;
  const productionWritesEnabled = valid && environment === 'production' && writesRequested
    && productionApproval && (!financeTargetsDsedac || productionErpWritesApproved);
  const writesEnabled = valid && writesRequested
    && (environment !== 'production' || productionWritesEnabled);

  const financeCapabilityApproved = valid && financeCapabilityRequested && writesEnabled
    && financeTableMappingValid
    && (environment !== 'production' || (
      tableSet === 'production'
      && productionApproval
      && (!financeTargetsDsedac || productionErpWritesApproved)
    ));
  const effectiveConfirmationCapabilityApproved = valid && confirmationCapabilityApproved && writesEnabled
    && confirmationTableMappingValid
    && (environment !== 'production' || (tableSet === 'production' && productionConfirmationApproved));
  return Object.freeze({
    valid,
    environment: ALLOWED_ENVIRONMENTS.has(environment) ? environment : 'invalid',
    dsn,
    writesEnabled,
    productionWritesEnabled,
    productionErpWritesApproved,
    productionConfirmationApproved,
    confirmationCapabilityApproved: effectiveConfirmationCapabilityApproved,
    financeCapabilityApproved,
    tableSet: ALLOWED_TABLE_SETS.has(tableSet) ? tableSet : 'invalid',
    tables: selectedTables,
    evidencePendingTtlHours,
    schemas: Object.freeze({
      read: readSchema,
      app: appSchema,
      erp: erpSchema,
    }),
    errors: Object.freeze(errors),
  });
}

function resolveRepartoRouteMode(env = {}) {
  const errors = [];
  const useTsRoutes = parseStrictBoolean(
    env.USE_TS_ROUTES,
    'USE_TS_ROUTES',
    errors,
    false,
  );
  const useDddRoutes = parseStrictBoolean(
    env.USE_DDD_ROUTES,
    'USE_DDD_ROUTES',
    errors,
    true,
  );

  if (useTsRoutes) {
    errors.push('USE_TS_ROUTES is retired; only false is supported');
  }

  if (useTsRoutes && useDddRoutes) {
    errors.push('USE_TS_ROUTES and USE_DDD_ROUTES cannot both be true');
  }

  if (errors.length > 0) {
    return Object.freeze({
      valid: false,
      mode: 'invalid',
      useTsRoutes: false,
      useDddRoutes: false,
      errors: Object.freeze(errors),
    });
  }

  return Object.freeze({
    valid: true,
    mode: useTsRoutes ? 'typescript' : useDddRoutes ? 'ddd' : 'legacy',
    useTsRoutes,
    useDddRoutes,
    errors: Object.freeze([]),
  });
}

function sanitizedRepartoDiagnostic(runtime, routeMode) {
  return Object.freeze({
    valid: runtime.valid && routeMode.valid,
    environment: runtime.environment,
    dsn: runtime.dsn ? 'configured' : 'unset',
    schemas: runtime.schemas,
    writesEnabled: runtime.writesEnabled,
    productionWritesEnabled: runtime.productionWritesEnabled,
    confirmationCapabilityApproved: runtime.confirmationCapabilityApproved,
    productionConfirmationApproved: runtime.productionConfirmationApproved,
    financeCapabilityApproved: runtime.financeCapabilityApproved,
    tableSet: runtime.tableSet,
    evidencePendingTtlHours: runtime.evidencePendingTtlHours,
    productionErpWritesApproved: runtime.productionErpWritesApproved,
    routeMode: routeMode.mode,
    errorCount: runtime.errors.length + routeMode.errors.length,
  });
}

function createRepartoWriteGuard(runtime, options = {}) {
  const requiredCapability = options?.requiredCapability ?? null;
  const capabilityFlags = Object.freeze({
    finance: 'financeCapabilityApproved',
    confirmation: 'confirmationCapabilityApproved',
  });
  if (requiredCapability !== null && !Object.hasOwn(capabilityFlags, requiredCapability)) {
    throw new TypeError('requiredCapability must be finance, confirmation, or null');
  }

  return function repartoWriteGuard(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const writesAllowed = runtime.valid && runtime.writesEnabled;
    const capabilityAllowed = requiredCapability === null
      || runtime[capabilityFlags[requiredCapability]] === true;
    if (writesAllowed && capabilityAllowed) return next();

    const capabilityCode = requiredCapability === 'finance'
      ? 'REPARTO_FINANCE_CAPABILITY_DISABLED'
      : 'REPARTO_CONFIRMATION_CAPABILITY_DISABLED';
    return res.status(503).json({
      success: false,
      code: writesAllowed ? capabilityCode : 'REPARTO_WRITES_DISABLED',
      error: 'Las escrituras de reparto estan bloqueadas por configuracion segura',
    });
  };
}

module.exports = {
  TABLE_MAPPINGS,
  G4_DSEDAC_ERP_MAPPING,
  FINANCE_TABLE_KEYS,
  FINANCE_WRITE_TABLE_KEYS,
  CONFIRMATION_TABLE_KEYS,
  validateFinanceTableMapping,
  validateConfirmationTableMapping,
  resolveRepartoRuntime,
  resolveRepartoRouteMode,
  sanitizedRepartoDiagnostic,
  createRepartoWriteGuard,
};
