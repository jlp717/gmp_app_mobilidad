'use strict';

const {
    createVerifiedHardFloorPolicy,
    assertHardPriceFloor,
} = require('../services/pedidos/hard-price-floor');
const {
    createErpTariffFloorPilot,
} = require('../services/pedidos/erp-tariff-floor');

const ISOLATED_PROFILE = Object.freeze({
    profile: 'test',
    verified: true,
    readSchema: 'DSEDAC',
    writeSchema: 'JAVIER',
    tableSet: 'isolated_test',
    writesEnabled: true,
    productionWritesEnabled: false,
    erpExportEnabled: false,
});

function authoritativeRow(overrides = {}) {
    return {
        CODIGOARTICULO: '1009',
        UNIDADMEDIDA: 'KILO',
        TARIFA2_MIN: '4.1240',
        TARIFA2_MAX: '4.1240',
        TARIFA2_VARIANTS: 1,
        ...overrides,
    };
}

function storedLine(overrides = {}) {
    return {
        CODIGOARTICULO: '1009',
        UNIDADMEDIDA: 'KILO',
        CANTIDADENVASES: 1,
        CANTIDADUNIDADES: 5,
        UNIDADESCAJA: 5,
        PRECIOVENTA: '4.1240',
        IMPORTEVENTA: '20.62',
        DESCUENTO_LINEA: 0,
        PORCENTAJEDESCUENTO: 0,
        CLASELINEA: 'VT',
        ...overrides,
    };
}

function pilotWithRows(rows, profile = ISOLATED_PROFILE) {
    const queryFn = jest.fn().mockResolvedValue(rows);
    const pilot = createErpTariffFloorPilot({
        profileProvider: () => profile,
    });
    return { pilot, queryFn };
}

describe('exact hard-price-floor kernel', () => {
    test('applies line and header discounts at exact four-decimal boundary', () => {
        const policy = createVerifiedHardFloorPolicy({
            articleCode: '1009',
            unit: 'KILO',
            minimumUnitPrice: '4.1240',
            sourceFingerprint: 'a'.repeat(64),
            policyStatus: 'VERIFICADA',
            unitStatus: 'VERIFICADA',
        });

        expect(assertHardPriceFloor({
            line: {
                articleCode: '1009',
                unit: 'KILO',
                unitPrice: '5.0914',
                lineDiscountPct: '10.00',
                forceConfirm: true,
                bolsaAvailable: true,
            },
            policy,
            headerDiscountPct: '10.00',
        })).toMatchObject({ allowed: true, minimumUnitPrice: '4.1240' });

        expect(() => assertHardPriceFloor({
            line: {
                articleCode: '1009',
                unit: 'KILO',
                unitPrice: '5.0913',
                lineDiscountPct: '10.00',
                isGift: true,
            },
            policy,
            headerDiscountPct: '10.00',
        })).toThrow(expect.objectContaining({ code: 'HARD_PRICE_FLOOR_BREACH' }));
    });
});

describe('live ERP tariff-2 isolated confirmation pilot', () => {
    test('checks real 1009 KILO evidence, fractional billed quantity and both discounts', async () => {
        const { pilot, queryFn } = pilotWithRows([authoritativeRow()]);

        const result = await pilot.assertOrderFloor({
            queryFn,
            lines: [storedLine({
                CANTIDADUNIDADES: '5.250',
                PRECIOVENTA: '5.1000',
                IMPORTEVENTA: '24.10',
                PORCENTAJEDESCUENTO: '10.00',
            })],
            headerDiscountPct: '10.00',
        });

        expect(result).toMatchObject({ active: true, covered: 1, skipped: [] });
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(queryFn.mock.calls[0][0]).toContain('DSEDAC.ART');
        expect(queryFn.mock.calls[0][0]).toContain('DSEDAC.ARA');
        expect(queryFn.mock.calls[0][1]).toEqual(['2', '1009', '1009']);
    });

    test('blocks zero-price SC and ignores force, gift and bolsa bypass metadata', async () => {
        const { pilot, queryFn } = pilotWithRows([authoritativeRow()]);

        await expect(pilot.assertOrderFloor({
            queryFn,
            lines: [storedLine({
                PRECIOVENTA: '9.9999',
                IMPORTEVENTA: 0,
                CLASELINEA: 'SC',
                forceConfirm: true,
                isGift: true,
                bolsaAvailable: true,
                specialPrice: true,
            })],
            headerDiscountPct: 0,
        })).rejects.toMatchObject({ code: 'HARD_PRICE_FLOOR_BREACH', status: 409 });
    });

    test('matches the writer two-step rounding pipeline instead of one-round arithmetic', async () => {
        const { pilot, queryFn } = pilotWithRows([authoritativeRow({
            TARIFA2_MIN: '0.1000',
            TARIFA2_MAX: '0.1000',
        })]);

        await expect(pilot.assertOrderFloor({
            queryFn,
            lines: [storedLine({
                CANTIDADUNIDADES: 3,
                PRECIOVENTA: '0.3350',
                IMPORTEVENTA: '0.51',
                PORCENTAJEDESCUENTO: '50.00',
            })],
        })).resolves.toMatchObject({ active: true, covered: 1 });
    });

    test('rejects a forged unit and an inconsistent persisted billed amount', async () => {
        const first = pilotWithRows([authoritativeRow()]);
        await expect(first.pilot.assertOrderFloor({
            queryFn: first.queryFn,
            lines: [storedLine({ UNIDADMEDIDA: 'CAJAS', IMPORTEVENTA: '4.12' })],
        })).rejects.toMatchObject({ code: 'HARD_PRICE_FLOOR_UNIT_MISMATCH', status: 409 });

        const second = pilotWithRows([authoritativeRow()]);
        await expect(second.pilot.assertOrderFloor({
            queryFn: second.queryFn,
            lines: [storedLine({ IMPORTEVENTA: '4.12' })],
        })).rejects.toMatchObject({ code: 'HARD_PRICE_FLOOR_BILLING_MISMATCH', status: 409 });
    });

    test.each([
        [
            '3519 blank UOM',
            authoritativeRow({ CODIGOARTICULO: '3519', UNIDADMEDIDA: '' }),
            storedLine({ CODIGOARTICULO: '3519', UNIDADMEDIDA: '', PRECIOVENTA: '20.0000', IMPORTEVENTA: '100.00' }),
            'UNSUPPORTED_MASTER_UNIT',
        ],
        [
            'missing tariff 2',
            authoritativeRow({
                CODIGOARTICULO: '1021', UNIDADMEDIDA: 'UNIDADES',
                TARIFA2_MIN: null, TARIFA2_MAX: null, TARIFA2_VARIANTS: 0,
            }),
            storedLine({ CODIGOARTICULO: '1021', UNIDADMEDIDA: 'UNIDADES', PRECIOVENTA: '1.0000', IMPORTEVENTA: '5.00' }),
            'TARIFF_2_MISSING',
        ],
    ])('rejects uncovered %s explicitly in verified isolated mode', async (_label, row, line, reason) => {
        const { pilot, queryFn } = pilotWithRows([row]);
        await expect(pilot.assertOrderFloor({ queryFn, lines: [line] })).rejects.toMatchObject({
            code: 'HARD_PRICE_FLOOR_UNCOVERED_ARTICLE',
            status: 409,
            details: { articleCode: line.CODIGOARTICULO, reason },
        });
    });

    test('fails closed on missing master evidence, conflicting tariff or broken profile', async () => {
        const missing = pilotWithRows([]);
        await expect(missing.pilot.assertOrderFloor({
            queryFn: missing.queryFn,
            lines: [storedLine()],
        })).rejects.toMatchObject({ code: 'HARD_PRICE_FLOOR_AUTHORITY_UNAVAILABLE', status: 503 });

        const conflict = pilotWithRows([authoritativeRow({
            TARIFA2_MAX: '4.5000',
            TARIFA2_VARIANTS: 2,
        })]);
        await expect(conflict.pilot.assertOrderFloor({
            queryFn: conflict.queryFn,
            lines: [storedLine()],
        })).rejects.toMatchObject({ code: 'HARD_PRICE_FLOOR_AUTHORITY_CONFLICT', status: 503 });

        const invalid = pilotWithRows([], { ...ISOLATED_PROFILE, erpExportEnabled: true });
        await expect(invalid.pilot.assertOrderFloor({
            queryFn: invalid.queryFn,
            lines: [storedLine()],
        })).rejects.toMatchObject({ code: 'HARD_PRICE_FLOOR_PROFILE_UNAVAILABLE', status: 503 });
        expect(invalid.queryFn).not.toHaveBeenCalled();

        const unverifiedQuery = jest.fn();
        const guarded = createErpTariffFloorPilot({
            profileProvider: () => ({ profile: 'unverified', verified: false }),
        });
        await expect(guarded.assertOrderFloor({
            queryFn: unverifiedQuery,
            lines: [storedLine()],
        })).resolves.toEqual({ active: false, covered: 0, skipped: [] });
        await expect(guarded.assertOrderFloor({
            queryFn: unverifiedQuery,
            lines: [storedLine()],
            requireVerifiedProfile: true,
        })).rejects.toMatchObject({ code: 'HARD_PRICE_FLOOR_PROFILE_UNAVAILABLE', status: 503 });
        expect(unverifiedQuery).not.toHaveBeenCalled();
    });

    test('leaves production unchanged and performs no authority query', async () => {
        const queryFn = jest.fn();
        const pilot = createErpTariffFloorPilot({
            profileProvider: () => ({
                profile: 'production',
                verified: true,
                readSchema: 'DSEDAC',
                writeSchema: 'DSEDAC',
                tableSet: 'production',
                writesEnabled: true,
                productionWritesEnabled: true,
                erpExportEnabled: true,
            }),
        });

        await expect(pilot.assertOrderFloor({ queryFn, lines: [storedLine()] }))
            .resolves.toEqual({ active: false, covered: 0, skipped: [] });
        expect(queryFn).not.toHaveBeenCalled();
    });
});
