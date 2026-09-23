'use strict';

/**
 * Capture API contract shape for GET /pedidos/families(+ /detailed)
 * via service layer (same SQL as routes). Read-only.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { initDb, closePool } = require('../config/db');
const pedidosService = require('../services/pedidos.service');

async function main() {
  await initDb();
  try {
    const [codes, detailed] = await Promise.all([
      pedidosService.getFamilies(),
      pedidosService.getFamiliesDetailed(),
    ]);
    const impulso = (detailed || []).find((f) => f.code === '003' || f.isImpulso);
    const contract = {
      capturedAt: new Date().toISOString(),
      endpoints: {
        'GET /api/pedidos/families': {
          success: true,
          families: 'string[]',
          sampleCount: (codes || []).length,
          sampleHead: (codes || []).slice(0, 12),
          includesImpulsoCode003: (codes || []).includes('003'),
        },
        'GET /api/pedidos/families/detailed': {
          success: true,
          families: [
            {
              code: 'string',
              name: 'string',
              prefamily: 'string',
              artCount: 'number',
              isNestle: 'boolean',
              isImpulso: 'boolean',
            },
          ],
          sampleCount: (detailed || []).length,
          sampleHead: (detailed || []).slice(0, 8),
          impulso,
        },
      },
    };
    const outDir = path.resolve(__dirname, '../../docs/audits/2026-09-23-pedidos-families');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'api-contract-families.json');
    fs.writeFileSync(outFile, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      wrote: outFile,
      familiesCount: (codes || []).length,
      detailedCount: (detailed || []).length,
      impulso,
    }, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
