'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  HOST_RUNTIME_KEYS,
  SYNTHETIC_ENV,
  snapshotEnvironment,
  replaceEnvironment,
  restoreEnvironment,
} = require('../../../backend/tests/hermetic/environment.cjs');

function sortedEntries(env) {
  return Object.entries(env).sort(([left], [right]) => left.localeCompare(right));
}

function sameEnvironmentEntries(actual, expected) {
  if (actual.length !== expected.length) return false;
  return actual.every(([key, value], index) => key === expected[index][0] && value === expected[index][1]);
}

function assertEnvironmentMatches(actual, expected) {
  if (!sameEnvironmentEntries(actual, expected)) throw new Error('environment lifecycle restoration failed');
}

test('environment entry comparison rejects added, missing, and changed synthetic entries without exposing them', () => {
  const expected = [['ALPHA', 'one'], ['BETA', 'two']];
  assert.equal(sameEnvironmentEntries(expected, expected), true);
  assert.equal(sameEnvironmentEntries([...expected, ['CANARY_EXTRA', 'synthetic-value']], expected), false);
  assert.equal(sameEnvironmentEntries([expected[0]], expected), false);
  assert.equal(sameEnvironmentEntries([['ALPHA', 'changed'], expected[1]], expected), false);
  let failure;
  try {
    assertEnvironmentMatches([['ALPHA', 'changed'], expected[1]], expected);
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.message, 'environment lifecycle restoration failed');
  assert.doesNotMatch(failure.message, /changed|CANARY_EXTRA|synthetic-value/);
});

test('hermetic environment scrubs separate host and VM values and restores them exactly', () => {
  const host = Object.assign(Object.create(null), {
    PATH: 'synthetic-host-path',
    SystemRoot: 'synthetic-system-root',
    NODE_ENV: 'host-original',
    GMP_HERMETIC_SECRET_CANARY: 'host-canary',
    GENERIC_INTEGRATION_SECRET: 'host-secret',
    NODE_OPTIONS: '--synthetic-host-option',
  });
  const vm = Object.assign(Object.create(null), {
    NODE_ENV: 'vm-original',
    JWT_ACCESS_SECRET: 'vm-original-token',
    GMP_HERMETIC_SECRET_CANARY: 'vm-canary',
    GENERIC_INTEGRATION_SECRET: 'vm-secret',
    NODE_OPTIONS: '--synthetic-vm-option',
  });
  const initialHost = sortedEntries(host);
  const initialVm = sortedEntries(vm);
  const hostSnapshot = snapshotEnvironment(host);
  const vmSnapshot = snapshotEnvironment(vm);

  replaceEnvironment(host, hostSnapshot, HOST_RUNTIME_KEYS);
  replaceEnvironment(vm, vmSnapshot, new Set());

  assert.equal(host.PATH, 'synthetic-host-path');
  assert.equal(host.SystemRoot, 'synthetic-system-root');
  assert.equal(host.GENERIC_INTEGRATION_SECRET, undefined);
  assert.equal(host.GMP_HERMETIC_SECRET_CANARY, undefined);
  assert.equal(host.NODE_OPTIONS, undefined);
  assert.equal(vm.PATH, undefined);
  assert.equal(vm.GENERIC_INTEGRATION_SECRET, undefined);
  assert.equal(vm.GMP_HERMETIC_SECRET_CANARY, undefined);
  assert.equal(vm.NODE_OPTIONS, undefined);
  assert.deepEqual(
    Object.fromEntries(Object.entries(host).filter(([key]) => !HOST_RUNTIME_KEYS.has(key))),
    SYNTHETIC_ENV,
  );
  assert.deepEqual(Object.fromEntries(Object.entries(vm)), SYNTHETIC_ENV);

  restoreEnvironment(host, hostSnapshot);
  restoreEnvironment(vm, vmSnapshot);

  assert.deepEqual(sortedEntries(host), initialHost);
  assert.deepEqual(sortedEntries(vm), initialVm);
  assert.equal(Object.hasOwn(host, 'JWT_ACCESS_SECRET'), false);
});

test('the Jest environment instance restores a pre-existing synthetic canary', async () => {
  const originalHost = snapshotEnvironment(process.env);
  let environment;
  try {
    process.env.QA_H8_LIFECYCLE_CANARY = 'synthetic-host-canary';
    const expectedHost = sortedEntries(process.env);
    environment = new (require('../../../backend/tests/hermetic/environment.cjs'))({
      projectConfig: {
        testEnvironmentOptions: {},
        globals: {},
        fakeTimers: { legacyFakeTimers: false },
      },
    }, {});

    await environment.setup();
    assert.equal(process.env.QA_H8_LIFECYCLE_CANARY, undefined);
    assert.equal(environment.global.process.env.QA_H8_LIFECYCLE_CANARY, undefined);

    await environment.teardown();
    environment = null;
    assertEnvironmentMatches(sortedEntries(process.env), expectedHost);
  } finally {
    if (environment) await environment.teardown();
    restoreEnvironment(process.env, originalHost);
  }
});
