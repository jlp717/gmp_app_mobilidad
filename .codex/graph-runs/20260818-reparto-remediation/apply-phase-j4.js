const fs = require('fs');

function replaceExact(file, before, after, expected) {
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(before).length - 1;
  if (count !== expected) {
    throw new Error(`${file}: expected ${expected} matches, found ${count}`);
  }
  fs.writeFileSync(file, original.split(before).join(after));
}

replaceExact(
  'backend/__tests__/reparto-finance-security-v3.test.js',
  "mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', isJefeVentas: true };",
  "mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };",
  2,
);
replaceExact(
  'backend/__tests__/reparto-finance-security-v3.test.js',
  "mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };",
  "mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', vendorCodes: ['94'] };",
  2,
);
replaceExact(
  'backend/__tests__/repartidor-liquidacion-route.test.js',
  "mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', isJefeVentas: true };",
  "mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };",
  1,
);
replaceExact(
  'backend/__tests__/repartidor-liquidacion-route.test.js',
  "mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true };",
  "mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };",
  1,
);
replaceExact(
  'backend/__tests__/middleware/auth-middleware.test.js',
  "const token = signAccessToken(validAccessPayload({\n            role: 'REPARTIDOR', isJefeVentas: true, isRepartidor: true,\n        }));",
  "const token = await canonicalAccessToken({\n            id: 'V001', user: '001', name: 'Driver',\n            role: 'REPARTIDOR', isJefeVentas: true, isRepartidor: true,\n        }, 'inconsistent-repartidor');",
  1,
);
