'use strict';

const fs = require('fs');
const path = require('path');
const { createErpTariffFloorPilot } = require('../services/pedidos/erp-tariff-floor');

function confirmOrderSource() {
    const source = fs.readFileSync(
        path.join(__dirname, '../services/pedidos/index.js'),
        'utf8',
    );
    const start = source.indexOf('async function confirmOrder(');
    const end = source.indexOf('\nasync function cancelOrder(', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('hard floor confirmation integration contract', () => {
    test('returns terminal replay before tariff authority reads or side effects', () => {
        const source = confirmOrderSource();
        const replay = source.indexOf("if (currentState === 'CONFIRMADO')");
        const floor = source.indexOf('await assertErpTariffFloorForOrder({');
        const bolsa = source.indexOf('validateOrderWithBolsa');
        const stock = source.indexOf('getStockBatch');

        expect(replay).toBeGreaterThan(-1);
        expect(replay).toBeLessThan(floor);
        expect(replay).toBeLessThan(bolsa);
        expect(replay).toBeLessThan(stock);
    });

    test('preflights before legacy bolsa validation and preserves typed floor errors', () => {
        const source = confirmOrderSource();
        const preflight = source.indexOf('await assertErpTariffFloorForOrder({');
        const legacyBolsa = source.indexOf('const bolsaResult = await bolsaService.validateOrderWithBolsa');
        const typedRethrow = source.indexOf("startsWith('HARD_PRICE_FLOOR_')");

        expect(preflight).toBeGreaterThan(-1);
        expect(preflight).toBeLessThan(legacyBolsa);
        expect(typedRethrow).toBeGreaterThan(legacyBolsa);
        expect(source.slice(typedRethrow, typedRethrow + 180)).toContain('throw bolsaErr');
        expect(source.slice(preflight, legacyBolsa))
            .toMatch(/if\s*\(\s*!exportToSystem\s*&&\s*!floorPreflight\.active\s*\)/);
    });

    test('revalidates locked lines and locked header discount before any ledger or stock side effect', () => {
        const source = confirmOrderSource();
        const tx = source.indexOf('withLocalConfirmationTransaction(async (conn)');
        const local = source.slice(tx);
        const replay = local.indexOf("lockedInitialState === 'CONFIRMADO'");
        const lines = local.indexOf('await readOrderLinesForMutation(queryFn, id)');
        const discount = local.indexOf('const lockedGlobalDiscountPct');
        const floor = local.indexOf('await assertErpTariffFloorForOrder({');
        const claim = local.indexOf('await claimLocalOrderForConfirmation(queryFn, id)');
        const audit = local.indexOf('await appendOrderStateEvent(queryFn');
        const bolsa = local.indexOf('await bolsaService.validateOrderWithBolsa');
        const stock = local.indexOf('const lockedStock = await getStockBatch');
        const confirm = local.indexOf('const confirmedResult = await conn.query');
        const reserve = local.indexOf('await replaceStockReservationLines');
        const ledger = local.indexOf('await bolsaService.applyOrderMovementsWith');

        expect(tx).toBeGreaterThan(-1);
        expect(replay).toBeLessThan(lines);
        expect(lines).toBeLessThan(discount);
        expect(discount).toBeLessThan(floor);
        expect(floor).toBeLessThan(claim);
        expect(claim).toBeLessThan(audit);
        expect(floor).toBeLessThan(audit);
        expect(floor).toBeLessThan(bolsa);
        expect(floor).toBeLessThan(stock);
        expect(floor).toBeLessThan(confirm);
        expect(floor).toBeLessThan(reserve);
        expect(floor).toBeLessThan(ledger);
        expect(local.slice(floor, floor + 260)).toMatch(/queryFn,[\s\S]*lines:\s*lockedLines,[\s\S]*headerDiscountPct:\s*lockedGlobalDiscountPct/);
        expect(local).toMatch(/validateOrderWithBolsa\([\s\S]*lockedLines,[\s\S]*queryFn/);
    });

    test('keeps the TEST pilot inactive for production without querying tariff authority', async () => {
        const queryFn = jest.fn();
        const pilot = createErpTariffFloorPilot({
            profileProvider: () => ({ profile: 'production', verified: true }),
        });

        await expect(pilot.assertOrderFloor({
            queryFn,
            lines: [{ CODIGOARTICULO: 'ART001' }],
            requireVerifiedProfile: true,
        })).resolves.toEqual({ active: false, covered: 0, skipped: [] });
        expect(queryFn).not.toHaveBeenCalled();
    });

    test('both public confirm routes require a verified pilot profile server-side', () => {
        const legacy = fs.readFileSync(path.join(__dirname, '../routes/pedidos.js'), 'utf8');
        const ddd = fs.readFileSync(path.join(__dirname, '../src/shared/routes/ddd-adapters.js'), 'utf8');
        const legacyConfirm = legacy.slice(legacy.indexOf("router.put('/:id/confirm'"), legacy.indexOf("router.delete('/:id'"));
        const dddConfirm = ddd.slice(ddd.indexOf("router.put('/:id/confirm'"), ddd.indexOf("router.put('/:id/lines'"));

        expect(legacyConfirm).toContain('requireTariffFloorPilotProfile: true');
        expect(dddConfirm).toContain('requireTariffFloorPilotProfile: true');
        expect(legacyConfirm).not.toMatch(/requireTariffFloorPilotProfile:\s*req\./);
        expect(dddConfirm).not.toMatch(/requireTariffFloorPilotProfile:\s*req\./);
    });
});
