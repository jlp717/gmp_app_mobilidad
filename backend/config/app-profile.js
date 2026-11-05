'use strict';

const ALLOWED_APP_ENVIRONMENTS = Object.freeze(['test', 'demo', 'production']);
const APP_ENV_SET = new Set(ALLOWED_APP_ENVIRONMENTS);

const COMMON_ASSIGNMENTS = Object.freeze({
  DB2_READ_SCHEMA: 'DSEDAC',
  DB2_WRITE_SCHEMA: 'JAVIER',
  ERP_READ_SCHEMA: 'DSEDAC',
  PEDIDOS_CONFIRMATION_SCHEMA: 'JAVIER',
  PEDIDOS_ERP_SCHEMA: 'JAVIER',
  REPARTIDOR_FINANCE_READ_SCHEMA: 'DSEDAC',
  REPARTIDOR_FINANCE_APP_SCHEMA: 'JAVIER',
  COMERCIAL_ERP_READ_TEST: 'false',
  ALLOW_DSEDAC_APP_BUFFERS: 'false',
  REPARTO_STARTUP_REPARTO_MIGRATIONS: 'false',
});

const NON_PRODUCTION_SAFETY = Object.freeze({
  REPARTIDOR_FINANCE_ERP_SCHEMA: 'JAVIER',
  REPARTO_WRITES_ENABLED: 'true',
  REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
  REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
  REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
  REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
  REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
  PEDIDOS_EXPORT_TO_SYSTEM: 'false',
  PEDIDOS_DSEDAC_EXPORT_APPROVED: 'false',
  PEDIDOS_DSEDAC_STORAGE_APPROVED: 'false',
  // TEST renders the real commercial documents and keeps intended to/cc,
  // but must never notify customers or staff about acceptance-test payments.
  REPARTO_EMAIL_TEST_SINK: 'reparto-test@localhost',
  REPARTO_EMAIL_TEST_ALLOWLIST: 'reparto-test@localhost',
});

const PRODUCTION_CONTROLLED_FLAGS = Object.freeze([
  'REPARTO_WRITES_ENABLED',
  'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED',
  'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED',
  'REPARTO_PRODUCTION_WRITES_APPROVED',
  'REPARTO_PRODUCTION_ERP_WRITES_APPROVED',
  'REPARTO_PRODUCTION_CONFIRMATION_APPROVED',
  'PEDIDOS_EXPORT_TO_SYSTEM',
  'PEDIDOS_DSEDAC_EXPORT_APPROVED',
  'PEDIDOS_DSEDAC_STORAGE_APPROVED',
]);

const REPARTO_CAPABILITY_FLAGS = Object.freeze([
  'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED',
  'REPARTO_FINANCE_DB2_CAPABILITY_APPROVED',
]);

const PROFILE_ASSIGNMENTS = Object.freeze({
  test: Object.freeze({
    ...COMMON_ASSIGNMENTS,
    NODE_ENV: 'test',
    REPARTO_ENVIRONMENT: 'test',
    REPARTO_TABLE_SET: 'isolated_test',
    ...NON_PRODUCTION_SAFETY,
  }),
  demo: Object.freeze({
    ...COMMON_ASSIGNMENTS,
    NODE_ENV: 'staging',
    REPARTO_ENVIRONMENT: 'staging',
    REPARTO_TABLE_SET: 'isolated_test',
    ...NON_PRODUCTION_SAFETY,
  }),
  production: Object.freeze({
    ...COMMON_ASSIGNMENTS,
    NODE_ENV: 'production',
    REPARTO_ENVIRONMENT: 'production',
    REPARTO_TABLE_SET: 'production',
    REPARTIDOR_FINANCE_ERP_SCHEMA: 'DSEDAC',
    REPARTO_WRITES_ENABLED: 'false',
    REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED: 'false',
    REPARTO_FINANCE_DB2_CAPABILITY_APPROVED: 'false',
    REPARTO_PRODUCTION_WRITES_APPROVED: 'false',
    REPARTO_PRODUCTION_ERP_WRITES_APPROVED: 'false',
    REPARTO_PRODUCTION_CONFIRMATION_APPROVED: 'false',
    PEDIDOS_EXPORT_TO_SYSTEM: 'false',
    PEDIDOS_DSEDAC_EXPORT_APPROVED: 'false',
    PEDIDOS_DSEDAC_STORAGE_APPROVED: 'false',
  }),
});

let appliedPublicProfile = null;

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function strictBooleanString(value, name, errors, fallback = 'false') {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'true' || normalized === 'false') return normalized;
  errors.push(`${name} must be explicitly true or false`);
  return fallback;
}

function resolveAssignments(appEnv, env, errors) {
  const base = PROFILE_ASSIGNMENTS[appEnv];
  if (!base) return Object.freeze({});
  const assignments = { ...base };

  // Production activation deliberately remains a multi-gate manual action.
  // APP_ENV=production alone always resolves to every mutation gate disabled.
  // Existing, reviewed approval flags may be supplied explicitly; no new or
  // implicit approval mechanism is introduced here.
  const controlledFlags = appEnv === 'production'
    ? PRODUCTION_CONTROLLED_FLAGS
    : REPARTO_CAPABILITY_FLAGS;
  if (controlledFlags.length > 0) {
    for (const key of controlledFlags) {
      assignments[key] = strictBooleanString(env[key], key, errors, base[key]);
    }
  }

  return Object.freeze(assignments);
}

function validateControlledProductionFlags(assignments, errors) {
  const repartoWrites = assignments.REPARTO_WRITES_ENABLED === 'true';
  const repartoApproved = assignments.REPARTO_PRODUCTION_WRITES_APPROVED === 'true';
  const confirmationCapability = assignments.REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED === 'true';
  const confirmationApproved = assignments.REPARTO_PRODUCTION_CONFIRMATION_APPROVED === 'true';
  const financeCapability = assignments.REPARTO_FINANCE_DB2_CAPABILITY_APPROVED === 'true';
  const erpWritesApproved = assignments.REPARTO_PRODUCTION_ERP_WRITES_APPROVED === 'true';
  const orderExport = assignments.PEDIDOS_EXPORT_TO_SYSTEM === 'true';
  const orderExportApproved = assignments.PEDIDOS_DSEDAC_EXPORT_APPROVED === 'true';
  const dsedacStorageApproved = assignments.PEDIDOS_DSEDAC_STORAGE_APPROVED === 'true';

  if (repartoWrites && !repartoApproved) {
    errors.push('Production reparto writes require REPARTO_PRODUCTION_WRITES_APPROVED=true');
  }
  if ((confirmationCapability || financeCapability) && !repartoWrites) {
    errors.push('Production DB2 capabilities require REPARTO_WRITES_ENABLED=true');
  }
  if (confirmationCapability !== confirmationApproved) {
    errors.push('Production confirmation capability and approval must be enabled together');
  }
  if (financeCapability && !erpWritesApproved) {
    errors.push('Production finance capability requires REPARTO_PRODUCTION_ERP_WRITES_APPROVED=true');
  }
  if (orderExport || orderExportApproved || dsedacStorageApproved) {
    if (!(orderExport && orderExportApproved && dsedacStorageApproved)) {
      errors.push('Production order export requires all three existing PEDIDOS export approvals');
    }
  }
}

function buildPublicProfile(appEnv, assignments, verified) {
  const erpExportEnabled = assignments.PEDIDOS_EXPORT_TO_SYSTEM === 'true'
    && assignments.PEDIDOS_DSEDAC_EXPORT_APPROVED === 'true'
    && assignments.PEDIDOS_DSEDAC_STORAGE_APPROVED === 'true';
  const writesEnabled = assignments.REPARTO_WRITES_ENABLED === 'true';
  const productionWritesEnabled = appEnv === 'production'
    && writesEnabled
    && assignments.REPARTO_PRODUCTION_WRITES_APPROVED === 'true';
  return Object.freeze({
    profile: appEnv,
    verified,
    readSchema: assignments.DB2_READ_SCHEMA,
    writeSchema: assignments.DB2_WRITE_SCHEMA,
    tableSet: assignments.REPARTO_TABLE_SET,
    erpExportEnabled,
    writesEnabled,
    productionWritesEnabled,
  });
}

function resolveAppProfile(env = {}) {
  const errors = [];
  const appEnv = clean(env.APP_ENV).toLowerCase();
  if (!APP_ENV_SET.has(appEnv)) {
    errors.push('APP_ENV must be explicitly test, demo, or production');
    return Object.freeze({
      valid: false,
      errors: Object.freeze(errors),
      assignments: Object.freeze({}),
      publicProfile: Object.freeze({
        profile: 'unverified',
        verified: false,
        readSchema: null,
        writeSchema: null,
        tableSet: null,
        erpExportEnabled: false,
        writesEnabled: false,
        productionWritesEnabled: false,
      }),
    });
  }

  const assignments = resolveAssignments(appEnv, env, errors);
  const controlled = new Set(appEnv === 'production'
    ? PRODUCTION_CONTROLLED_FLAGS
    : REPARTO_CAPABILITY_FLAGS);
  for (const [key, expected] of Object.entries(assignments)) {
    if (controlled.has(key)) continue;
    const actual = clean(env[key]);
    if (actual && actual.toLowerCase() !== expected.toLowerCase()) {
      const privateRouting = key === 'REPARTO_EMAIL_TEST_SINK' || key === 'REPARTO_EMAIL_TEST_ALLOWLIST';
      errors.push(privateRouting
        ? `${key} contradicts APP_ENV=${appEnv} (local test delivery required)`
        : `${key}=${actual} contradicts APP_ENV=${appEnv} (${expected} required)`);
    }
  }
  if (appEnv === 'production') validateControlledProductionFlags(assignments, errors);

  const valid = errors.length === 0;
  return Object.freeze({
    valid,
    errors: Object.freeze(errors),
    assignments,
    publicProfile: buildPublicProfile(appEnv, assignments, valid),
  });
}

function createInvalidProfileError(errors) {
  const error = new Error(`Invalid APP_ENV profile: ${errors.join('; ')}`);
  error.code = 'INVALID_APP_ENV_PROFILE';
  return error;
}

function applyAppProfile(env = process.env) {
  const result = resolveAppProfile(env);
  if (!result.valid) throw createInvalidProfileError(result.errors);
  for (const [key, value] of Object.entries(result.assignments)) {
    env[key] = value;
  }
  if (env === process.env) {
    appliedPublicProfile = result.publicProfile;
  }
  return result.publicProfile;
}

function sanitizeAppProfile(profileOrResult) {
  const source = profileOrResult?.publicProfile || profileOrResult || {};
  return Object.freeze({
    profile: clean(source.profile) || 'unverified',
    verified: source.verified === true,
    readSchema: source.readSchema || null,
    writeSchema: source.writeSchema || null,
    tableSet: source.tableSet || null,
    erpExportEnabled: source.erpExportEnabled === true,
    writesEnabled: source.writesEnabled === true,
    productionWritesEnabled: source.productionWritesEnabled === true,
  });
}

function getAppliedAppProfile() {
  return sanitizeAppProfile(appliedPublicProfile);
}

function createRuntimeProfileHandler(profileProvider = getAppliedAppProfile) {
  return function runtimeProfileHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      profile: sanitizeAppProfile(profileProvider()),
    });
  };
}

function createAppProfileWriteGuard(
  profileProvider = getAppliedAppProfile,
  { allowUnverifiedForTests = process.env.NODE_ENV === 'test' } = {},
) {
  return function appProfileWriteGuard(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const profile = sanitizeAppProfile(profileProvider());
    // Direct app-factory imports used by legacy unit tests have no executable
    // profile. This explicit test-only exemption preserves those factories;
    // every non-test unverified runtime remains fail-closed.
    if (!profile.verified && allowUnverifiedForTests) return next();
    const writesAllowed = profile.profile === 'production'
      ? profile.productionWritesEnabled
      : profile.writesEnabled;
    if (profile.verified && writesAllowed) return next();
    return res.status(503).json({
      success: false,
      code: 'APP_PROFILE_WRITES_DISABLED',
      error: 'Las escrituras están desactivadas en el entorno activo',
      requestId: req.requestId || null,
    });
  };
}

function isAppProfileApplied() {
  return appliedPublicProfile?.verified === true;
}

function formatStartupBanner(profile) {
  const safe = sanitizeAppProfile(profile);
  return [
    '============================================================',
    ` GMP APP PROFILE: ${safe.profile.toUpperCase()} (${safe.verified ? 'VERIFIED' : 'UNVERIFIED'})`,
    ` READ: ${safe.readSchema || 'UNSET'} | WRITE: ${safe.writeSchema || 'UNSET'} | TABLES: ${safe.tableSet || 'UNSET'}`,
    ` ISOLATED WRITES: ${safe.writesEnabled ? 'ENABLED' : 'DISABLED'} | PROD WRITES: ${safe.productionWritesEnabled ? 'ENABLED' : 'DISABLED'} | ERP EXPORT: ${safe.erpExportEnabled ? 'ENABLED' : 'DISABLED'}`,
    '============================================================',
  ].join('\n');
}

module.exports = {
  ALLOWED_APP_ENVIRONMENTS,
  PROFILE_ASSIGNMENTS,
  applyAppProfile,
  createAppProfileWriteGuard,
  createRuntimeProfileHandler,
  formatStartupBanner,
  getAppliedAppProfile,
  isAppProfileApplied,
  resolveAppProfile,
  sanitizeAppProfile,
};
