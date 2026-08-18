const fs = require('fs');

function transform(file, replacements) {
  let value = fs.readFileSync(file, 'utf8');
  for (const [before, after, expected] of replacements) {
    const count = value.split(before).length - 1;
    if (count !== expected) throw new Error(`${file}: expected ${expected} matches, found ${count}`);
    value = value.split(before).join(after);
  }
  fs.writeFileSync(file, value);
}

transform('backend/__tests__/repartidor-route-params.test.js', [
  ['expect(res.status).toBe(400);', 'expect(res.status).toBe(422);', 1],
]);
transform('backend/__tests__/entregas-route-gap-coverage.test.js', [
  ['expect(invalidId.status).toBe(400);', 'expect(invalidId.status).toBe(422);', 1],
]);
transform('backend/__tests__/repartidor-history-finance-hardening.test.js', [
  ["  getDeliveryStatusColumns: (alias) => mockDeliveryStatusAvailable\r\n",
   "  getDeliveryStatusTable: () => process.env.REPARTO_TABLE_SET === 'isolated_test'\r\n    ? 'JAVIER.TEST_DELIVERY_STATUS'\r\n    : 'JAVIER.DELIVERY_STATUS',\r\n  getDeliveryStatusColumns: (alias) => mockDeliveryStatusAvailable\r\n", 1],
]);
