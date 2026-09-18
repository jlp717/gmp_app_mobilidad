'use strict';

const { TestEnvironment } = require('jest-environment-node');

const BLOCK_CODE = 'TEST_EXTERNAL_IO_BLOCKED';
const MARKER = Symbol.for('gmp.hermetic-io-guard');
const HOST_RUNTIME_KEYS = new Set([
  'PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT',
  'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
  'LOCALAPPDATA', 'APPDATA', 'ProgramData', 'OS', 'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION',
]);
const SYNTHETIC_ENV = Object.freeze({
  NODE_ENV: 'test',
  TZ: 'UTC',
  JWT_ACCESS_SECRET: 'isolated-test-access-secret',
  JWT_REFRESH_SECRET: 'isolated-test-refresh-secret',
  JEST_WORKER_ID: 'isolated',
});

function blocked(operation) {
  const error = new Error(`Hermetic test blocked ${operation}`);
  error.code = BLOCK_CODE;
  return error;
}

function replace(target, property, operation, restorers) {
  if (!target || typeof target[property] !== 'function') return;
  const original = target[property];
  target[property] = function hermeticBlockedOperation() {
    throw blocked(operation);
  };
  restorers.push(() => { target[property] = original; });
}

function snapshotEnvironment(env) {
  return new Map(Object.entries(env));
}

function replaceEnvironment(env, snapshot, allowedKeys) {
  for (const key of Object.keys(env)) delete env[key];
  for (const key of allowedKeys) {
    if (snapshot.has(key)) env[key] = snapshot.get(key);
  }
  for (const [key, value] of Object.entries(SYNTHETIC_ENV)) env[key] = value;
}

function restoreEnvironment(env, snapshot) {
  for (const key of Object.keys(env)) delete env[key];
  for (const [key, value] of snapshot) env[key] = value;
}

class HermeticEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.restorers = [];
    this.hostEnvSnapshot = null;
    this.vmEnvSnapshot = null;
  }

  async setup() {
    await super.setup();

    // Jest maintains a VM process.env which can differ from this host-side
    // environment. Capture both before any synthetic value is written.
    this.hasSeparateVmEnv = this.global.process.env !== process.env;
    this.hostEnvSnapshot = snapshotEnvironment(process.env);
    this.vmEnvSnapshot = this.hasSeparateVmEnv
      ? snapshotEnvironment(this.global.process.env)
      : null;
    replaceEnvironment(process.env, this.hostEnvSnapshot, HOST_RUNTIME_KEYS);
    if (this.hasSeparateVmEnv) {
      replaceEnvironment(this.global.process.env, this.vmEnvSnapshot, new Set());
    }

    const net = require('node:net');
    const tls = require('node:tls');
    const dgram = require('node:dgram');
    const http = require('node:http');
    const https = require('node:https');
    const childProcess = require('node:child_process');

    replace(net, 'connect', 'net.connect', this.restorers);
    replace(net, 'createConnection', 'net.createConnection', this.restorers);
    replace(net.Socket && net.Socket.prototype, 'connect', 'net.Socket.connect', this.restorers);
    replace(net.Server && net.Server.prototype, 'listen', 'net.Server.listen', this.restorers);
    replace(tls, 'connect', 'tls.connect', this.restorers);
    replace(tls.TLSSocket && tls.TLSSocket.prototype, 'connect', 'tls.TLSSocket.connect', this.restorers);
    replace(tls.Server && tls.Server.prototype, 'listen', 'tls.Server.listen', this.restorers);
    replace(dgram, 'createSocket', 'dgram.createSocket', this.restorers);
    replace(http, 'request', 'http.request', this.restorers);
    replace(http, 'get', 'http.get', this.restorers);
    replace(https, 'request', 'https.request', this.restorers);
    replace(https, 'get', 'https.get', this.restorers);
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
      replace(childProcess, name, `child_process.${name}`, this.restorers);
    }

    const originalFetch = this.global.fetch;
    this.global.fetch = function hermeticBlockedFetch() { throw blocked('fetch'); };
    this.restorers.push(() => { this.global.fetch = originalFetch; });
    this.global.__GMP_HERMETIC_GUARD__ = Object.freeze({
      code: BLOCK_CODE,
      marker: MARKER.description,
    });
  }

  async teardown() {
    try {
      for (const restore of this.restorers.reverse()) restore();
      restoreEnvironment(process.env, this.hostEnvSnapshot);
      if (this.hasSeparateVmEnv) {
        restoreEnvironment(this.global.process.env, this.vmEnvSnapshot);
      }
      delete this.global.__GMP_HERMETIC_GUARD__;
    } finally {
      await super.teardown();
    }
  }

}

module.exports = HermeticEnvironment;
module.exports.BLOCK_CODE = BLOCK_CODE;
module.exports.HOST_RUNTIME_KEYS = HOST_RUNTIME_KEYS;
module.exports.SYNTHETIC_ENV = SYNTHETIC_ENV;
module.exports.snapshotEnvironment = snapshotEnvironment;
module.exports.replaceEnvironment = replaceEnvironment;
module.exports.restoreEnvironment = restoreEnvironment;
