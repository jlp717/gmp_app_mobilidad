'use strict';

const {
  REPARTIDOR_FLEET_SQL,
  createRepartidorFleetDirectory,
  normalizeFleetRows,
} = require('../src/modules/auth/infrastructure/repartidor-fleet-directory');

describe('repartidor fleet directory', () => {
  test('uses the ERP mobility master as the only source of fleet authority', () => {
    expect(REPARTIDOR_FLEET_SQL).toMatch(/FROM\s+DSEDAC\.VDDX/i);
    expect(REPARTIDOR_FLEET_SQL).toMatch(/PERMITEREPARTOSN/i);
    expect(REPARTIDOR_FLEET_SQL).toMatch(/JEFEVENTASSN/i);
    expect(REPARTIDOR_FLEET_SQL).not.toMatch(/FROM\s+DSEDAC\.VEH/i);
    expect(REPARTIDOR_FLEET_SQL).not.toMatch(/FROM\s+DSEDAC\.OPP/i);
    expect(REPARTIDOR_FLEET_SQL).not.toMatch(/HAVING\s+COUNT/i);
  });

  test('deduplicates and canonicalizes only valid fleet codes', () => {
    expect(normalizeFleetRows([
      { CODE: ' 8 ', NAME: 'Ocho' },
      { code: '08', name: 'Ocho duplicado' },
      { CODE: '98', NAME: 'Jefe' },
      { CODE: 'ZZ', NAME: 'Técnico' },
      { CODE: 'A1', NAME: 'Reparto' },
    ])).toEqual([
      { code: '08', name: 'Ocho duplicado' },
      { code: 'A1', name: 'Reparto' },
    ]);
  });

  test('caches the DB2 fleet lookup and supports explicit invalidation', async () => {
    const execute = jest.fn().mockResolvedValue([{ CODE: '44', NAME: 'Repartidor' }]);
    const directory = createRepartidorFleetDirectory({ execute, ttlMs: 60_000 });

    await expect(directory.list()).resolves.toEqual([{ code: '44', name: 'Repartidor' }]);
    await expect(directory.list()).resolves.toEqual([{ code: '44', name: 'Repartidor' }]);
    expect(execute).toHaveBeenCalledTimes(1);

    directory.invalidate();
    await expect(directory.list()).resolves.toEqual([{ code: '44', name: 'Repartidor' }]);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
