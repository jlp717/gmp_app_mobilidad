const fs = require('fs');

function replaceExact(file, before, after, expected) {
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(before).length - 1;
  if (count !== expected) throw new Error(`${file}: expected ${expected} matches, found ${count}`);
  fs.writeFileSync(file, original.split(before).join(after));
}

function addVendorScopeAfterTitle(file, title) {
  const original = fs.readFileSync(file, 'utf8');
  const start = original.indexOf(title);
  if (start < 0) throw new Error(`${file}: missing title ${title}`);
  const before = "mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };";
  const pos = original.indexOf(before, start);
  if (pos < 0 || pos > start + 500) throw new Error(`${file}: missing scoped fixture after ${title}`);
  const after = "mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR', vendorCodes: ['94'] };";
  fs.writeFileSync(file, original.slice(0, pos) + after + original.slice(pos + before.length));
}

const finance = 'backend/__tests__/reparto-finance-security-v3.test.js';
addVendorScopeAfterTitle(finance, "test('JEFE evidence requires one selected owner");
addVendorScopeAfterTitle(finance, "test('retrieval and receipt reject owner ambiguity");

const liquidacion = 'backend/__tests__/repartidor-liquidacion-route.test.js';
replaceExact(liquidacion,
  "mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', isJefeVentas: true };",
  "mockUser = { id: '7', code: '7', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };", 1);
replaceExact(liquidacion,
  "mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true };",
  "mockUser = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };", 1);

const auth = 'backend/__tests__/middleware/auth-middleware.test.js';
const authOriginal = fs.readFileSync(auth, 'utf8');
const authPattern = /const token = signAccessToken\(validAccessPayload\(\{\s*role: 'REPARTIDOR', isJefeVentas: true, isRepartidor: true,\s*\}\)\);/;
if (!authPattern.test(authOriginal)) throw new Error(`${auth}: inconsistent-token fixture not found`);
fs.writeFileSync(auth, authOriginal.replace(authPattern,
  "const token = await canonicalAccessToken({\r\n            id: 'V001', user: '001', name: 'Driver',\r\n            role: 'REPARTIDOR', isJefeVentas: true, isRepartidor: true,\r\n        }, 'inconsistent-repartidor');"));
