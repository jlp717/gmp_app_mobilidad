'use strict';

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

function resolveRepartoStartupMutationPolicy({ env = {}, repartoRuntime } = {}) {
  const errors = [];
  const migrationsRequested = parseStrictBoolean(
    env.REPARTO_STARTUP_REPARTO_MIGRATIONS,
    'REPARTO_STARTUP_REPARTO_MIGRATIONS',
    errors,
    false,
  );

  if (!repartoRuntime || repartoRuntime.valid !== true) {
    errors.push('reparto runtime must be valid before startup');
  }

  const environment = clean(env.REPARTO_ENVIRONMENT).toLowerCase();
  const tableSet = clean(env.REPARTO_TABLE_SET).toLowerCase();
  const writesRequested = parseStrictBoolean(
    env.REPARTO_WRITES_ENABLED,
    'REPARTO_WRITES_ENABLED',
    errors,
  );
  const capabilityApproved = parseStrictBoolean(
    env.REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED,
    'REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED',
    errors,
    false,
  );

  if (repartoRuntime) {
    if (environment !== repartoRuntime.environment) {
      errors.push('REPARTO_ENVIRONMENT contradicts reparto runtime');
    }
    if (tableSet !== repartoRuntime.tableSet) {
      errors.push('REPARTO_TABLE_SET contradicts reparto runtime');
    }
    if (writesRequested !== repartoRuntime.writesEnabled) {
      errors.push('REPARTO_WRITES_ENABLED contradicts reparto runtime');
    }
    if (capabilityApproved !== repartoRuntime.confirmationCapabilityApproved) {
      errors.push('REPARTO_CONFIRMATION_DB2_CAPABILITY_APPROVED contradicts reparto runtime');
    }
  }

  if (migrationsRequested) {
    if (clean(env.NODE_ENV).toLowerCase() !== 'test') {
      errors.push('startup reparto migrations require NODE_ENV=test');
    }
    if (environment !== 'test') {
      errors.push('startup reparto migrations require REPARTO_ENVIRONMENT=test');
    }
    if (tableSet !== 'isolated_test') {
      errors.push('startup reparto migrations require REPARTO_TABLE_SET=isolated_test');
    }
    if (repartoRuntime?.writesEnabled !== true) {
      errors.push('startup reparto migrations require isolated writes enabled');
    }
    if (capabilityApproved !== true || repartoRuntime?.confirmationCapabilityApproved !== true) {
      errors.push('startup reparto migrations require approved DB2 confirmation capability');
    }
  }

  const valid = errors.length === 0;
  return Object.freeze({
    valid,
    migrationsRequested,
    migrationsAllowed: valid && migrationsRequested,
    errors: Object.freeze(errors),
  });
}

function assertRepartoStartupMutationPolicy(input) {
  const policy = resolveRepartoStartupMutationPolicy(input);
  if (!policy.valid) {
    const error = new Error(`Invalid reparto startup mutation policy: ${policy.errors.join('; ')}`);
    error.code = 'INVALID_REPARTO_STARTUP_MUTATION_POLICY';
    throw error;
  }
  return policy;
}

module.exports = {
  resolveRepartoStartupMutationPolicy,
  assertRepartoStartupMutationPolicy,
};
