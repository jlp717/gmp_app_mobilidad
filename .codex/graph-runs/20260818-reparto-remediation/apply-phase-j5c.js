const fs = require('fs');
const file = 'backend/__tests__/repartidor-history-finance-hardening.test.js';
const before = "  getDeliveryStatusColumns: (alias) => mockDeliveryStatusAvailable\n";
const after = "  getDeliveryStatusTable: () => process.env.REPARTO_TABLE_SET === 'isolated_test'\n    ? 'JAVIER.TEST_DELIVERY_STATUS'\n    : 'JAVIER.DELIVERY_STATUS',\n  getDeliveryStatusColumns: (alias) => mockDeliveryStatusAvailable\n";
const original = fs.readFileSync(file, 'utf8');
const count = original.split(before).length - 1;
if (count !== 1) throw new Error(`${file}: expected 1 match, found ${count}`);
fs.writeFileSync(file, original.replace(before, after));
