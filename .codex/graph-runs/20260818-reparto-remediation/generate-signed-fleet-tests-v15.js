'use strict';

const fs = require('fs');
const path = require('path');
const { createTwoFilesPatch } = require('diff');
const root = path.resolve(__dirname, '../../..');
const files = new Map();

function state(relative) {
  if (!files.has(relative)) {
    const text = fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
    files.set(relative, { original: text, next: text });
  }
  return files.get(relative);
}

function once(relative, before, after) {
  const file = state(relative);
  const count = file.next.split(before).length - 1;
  if (count !== 1) throw new Error(`${relative}: expected one match, found ${count}`);
  file.next = file.next.replace(before, after);
}

once(
  'backend/__tests__/auth-claims-resolver.test.js',
  `    getVendorVisibilityScope: jest.fn(async (code, { role }) => (\n      role === 'JEFE_VENTAS' ? [code, '051', 'UNK'] : [code]\n    )),`,
  `    getVendorVisibilityScope: jest.fn(async (code, { role }) => (\n      role === 'JEFE_VENTAS' ? [code, '051', 'UNK'] : [code]\n    )),\n    listRepartidorFleet: jest.fn(async () => [\n      { code: String(user?.code || '050').trim().toUpperCase(), name: 'Repartidor' },\n      { code: '051', name: 'Otro' },\n    ]),`,
);
once('backend/__tests__/auth-claims-resolver.test.js', 'targets claims version 3', 'targets claims version 4');
once('backend/__tests__/auth-claims-resolver.test.js', 'expect(AUTH_CLAIMS_VERSION).toBe(3);', 'expect(AUTH_CLAIMS_VERSION).toBe(4);');
once(
  'backend/__tests__/auth-claims-resolver.test.js',
  `      vendedorCodes: ['050'],\n      tipoVendedor:`,
  `      vendedorCodes: ['050'],\n      repartidorCodes: [],\n      tipoVendedor:`,
);
once(
  'backend/__tests__/auth-claims-resolver.test.js',
  `    expect(Object.isFrozen(claims.vendorCodes)).toBe(true);`,
  `    expect(Object.isFrozen(claims.vendorCodes)).toBe(true);\n    expect(Object.isFrozen(claims.repartidorCodes)).toBe(true);`,
);

once(
  'backend/__tests__/auth-claims-login-handler.test.js',
  `    vendorCodes: Object.freeze(['050']), vendedorCodes: Object.freeze(['050']),`,
  `    vendorCodes: Object.freeze(['050']), vendedorCodes: Object.freeze(['050']),\n    repartidorCodes: Object.freeze(['050']),`,
);
once(
  'backend/__tests__/auth-claims-login-handler.test.js',
  `        vendorCodes: ['050'], vendedorCodes: ['050'],\n        tipoVendedor:`,
  `        vendorCodes: ['050'], vendedorCodes: ['050'], repartidorCodes: ['050'],\n        tipoVendedor:`,
);
once(
  'backend/__tests__/auth-claims-login-handler.test.js',
  `      vendedorCodes: ['050'],\n      tipoVendedor:`,
  `      vendedorCodes: ['050'],\n      repartidorCodes: ['050'],\n      tipoVendedor:`,
);

once(
  'backend/__tests__/auth.test.js',
  `    getVendorVisibilityScope: jest.fn(),\n    logLoginAttempt: jest.fn(),`,
  `    getVendorVisibilityScope: jest.fn(),\n    listRepartidorFleet: jest.fn(),\n    logLoginAttempt: jest.fn(),`,
);
once(
  'backend/__tests__/auth.test.js',
  `            expect(authRoutes.repartidoresAccess({ role: 'ADMIN' })).toBe('FLEET');`,
  `            expect(authRoutes.repartidoresAccess({ role: 'ADMIN' })).toBe('DENIED');\n            expect(authRoutes.repartidoresAccess({ role: 'ADMIN', activeMode: 'REPARTIDOR' })).toBe('FLEET');`,
);
once('backend/__tests__/middleware/auth-middleware.test.js', 'expect(req.user.claimsVersion).toBe(3);', 'expect(req.user.claimsVersion).toBe(4);');

{
  const file = state('backend/__tests__/reparto-finance-fleet-authorization.test.js');
  file.next = file.next.replace(/vendorCodes:/g, 'repartidorCodes:');
  file.next = file.next.replace(
    /\{ id: 'V08', code: '08', role: 'REPARTIDOR' \}/g,
    `{ id: 'V08', code: '08', role: 'REPARTIDOR', repartidorCodes: ['08'] }`,
  );
  file.next = file.next.replace(
    /\{ id: 'A1', code: '1', role: 'ADMIN' \}/g,
    `{ id: 'A1', code: '1', role: 'ADMIN', activeMode: 'REPARTIDOR', repartidorCodes: ['77'] }`,
  );
}

{
  const file = state('backend/__tests__/chatbot_reparto_scope.test.js');
  file.next = file.next.replace(/vendorCodes:/g, 'repartidorCodes:');
}

let output = '';
for (const [relative, file] of files) {
  if (file.original === file.next) continue;
  output += `diff --git a/${relative} b/${relative}\n`;
  output += createTwoFilesPatch(`a/${relative}`, `b/${relative}`, file.original, file.next, '', '', { context: 1 })
    .replace(/^={67}\n/, '');
}
process.stdout.write(output);
