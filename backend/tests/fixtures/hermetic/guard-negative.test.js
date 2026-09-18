'use strict';

const net = require('node:net');
const tls = require('node:tls');
const dgram = require('node:dgram');
const http = require('node:http');
const https = require('node:https');
const childProcess = require('node:child_process');

function expectBlocked(callback) {
  expect(callback).toThrow(expect.objectContaining({ code: 'TEST_EXTERNAL_IO_BLOCKED' }));
}

test('the hermetic environment is installed before product imports', () => {
  expect(global.__GMP_HERMETIC_GUARD__).toMatchObject({ code: 'TEST_EXTERNAL_IO_BLOCKED' });
  expect(process.env.GMP_HERMETIC_SECRET_CANARY).toBeUndefined();
  // Import after the environment setup; this product module is deliberately pure.
  const { resolveRepartoRouteMode } = require('../../../config/reparto-runtime');
  expect(resolveRepartoRouteMode({ USE_TS_ROUTES: 'false', USE_DDD_ROUTES: 'false' }).valid).toBe(true);
  expectBlocked(() => require('node:net').connect());
});

test.each([
  ['net', () => net.connect()],
  ['tls', () => tls.connect()],
  ['udp', () => dgram.createSocket()],
  ['http', () => http.request()],
  ['https', () => https.request()],
  ['listen', () => net.createServer().listen()],
  ['child process async', () => childProcess.spawn()],
  ['child process sync', () => childProcess.execSync()],
])('blocks %s without inspecting destinations', (_name, invoke) => {
  expect(global.__GMP_HERMETIC_GUARD__.code).toBe('TEST_EXTERNAL_IO_BLOCKED');
  expectBlocked(invoke);
});

test('blocks fetch synchronously', () => {
  expectBlocked(() => global.fetch());
});
