const fs = require('fs');

function replaceExact(file, before, after, expected = 1) {
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(before).length - 1;
  if (count !== expected) throw new Error(`${file}: expected ${expected} matches, found ${count}`);
  fs.writeFileSync(file, original.split(before).join(after));
}

replaceExact(
  'backend/__tests__/repartidor-route-params.test.js',
  "req.user = { id: '98', code: '98', role: 'JEFE_VENTAS', isJefeVentas: true };",
  "req.user = { id: '98', code: '98', role: 'JEFE_VENTAS', activeMode: 'REPARTIDOR' };",
);
replaceExact(
  'backend/__tests__/repartidor-route-params.test.js',
  'expect(res.status).toBe(400);',
  'expect(res.status).toBe(422);',
);
replaceExact(
  'backend/__tests__/entregas-route-gap-coverage.test.js',
  'expect(invalidId.status).toBe(400);',
  'expect(invalidId.status).toBe(422);',
);
replaceExact(
  'backend/__tests__/repartidor-history-finance-hardening.test.js',
  "  getDeliveryStatusColumns: (alias) => mockDeliveryStatusAvailable\r\n",
  "  getDeliveryStatusTable: () => process.env.REPARTO_TABLE_SET === 'isolated_test'\r\n    ? 'JAVIER.TEST_DELIVERY_STATUS'\r\n    : 'JAVIER.DELIVERY_STATUS',\r\n  getDeliveryStatusColumns: (alias) => mockDeliveryStatusAvailable\r\n",
);
