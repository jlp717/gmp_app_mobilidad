'use strict';

const {
  resolveCommercialPricePolicy,
  assertCommercialPriceNetFloor,
  CommercialPricePolicyError,
  createCommercialPricePolicyService,
} = require('../services/commercial-price-policy');

describe('commercial owned price policy', () => {
  test('uses the maximum of verified basic tariff, manual minimum and exact cost-margin floor', () => {
    const policy = resolveCommercialPricePolicy({
      articleCode: '1009', saleUnit: 'KILO', erpUnit: 'KILO',
      tariffState: 'PRESENTE', tariffCode: 2, tariffPrice: '0.9000',
      policyUnit: 'KILO', unitState: 'VERIFICADA', minimumOrigin: 'MANUAL',
      minimumPrice: '0.9500', manufacturingCost: '0.8000', targetMarginPct: '20.0000', revision: 4,
    });
    expect(policy.effectiveFloor).toBe('1.0000');
    expect(policy.provenance).toEqual(['ERP_TARIFA_2', 'OWN_MINIMUM', 'OWN_COST_MARGIN']);
  });

  test('does not invent a 20 percent margin when the optional pair is absent', () => {
    const policy = resolveCommercialPricePolicy({
      articleCode: '1009', saleUnit: 'KILO', erpUnit: 'KILO', tariffState: 'PRESENTE', tariffCode: 2, tariffPrice: '4.1240',
      policyUnit: 'KILO', unitState: 'VERIFICADA', minimumOrigin: 'ERP_BASE', revision: 0,
    });
    expect(policy.costMarginFloor).toBeNull();
    expect(policy.effectiveFloor).toBe('4.1240');
  });

  test('never treats a blank ERP unit as CAJAS and requires a manager-confirmed policy unit', () => {
    expect(() => resolveCommercialPricePolicy({
      articleCode: '1001', saleUnit: 'CAJAS', erpUnit: '', tariffState: 'PRESENTE', tariffCode: 2, tariffPrice: '6.9000',
      unitState: 'NO_VERIFICADA', minimumOrigin: 'ERP_BASE', revision: 0,
    })).toThrow(expect.objectContaining({ code: 'COMMERCIAL_PRICE_POLICY_UOM_UNVERIFIED' }));
  });

  test('rejects a net price below the exact effective floor after both discounts', () => {
    const policy = resolveCommercialPricePolicy({
      articleCode: '1009', saleUnit: 'KILO', erpUnit: 'KILO', tariffState: 'PRESENTE', tariffCode: 2, tariffPrice: '1.0000',
      policyUnit: 'KILO', unitState: 'VERIFICADA', minimumOrigin: 'ERP_BASE', revision: 0,
    });
    expect(() => assertCommercialPriceNetFloor({ policy, unitPrice: '1.2345', lineDiscountPct: '10.00', headerDiscountPct: '10.00' }))
      .toThrow(expect.objectContaining({ code: 'HARD_PRICE_FLOOR_BREACH' }));
  });

  test('rejects a partial cost-margin pair', () => {
    expect(() => resolveCommercialPricePolicy({
      articleCode: '1009', saleUnit: 'KILO', erpUnit: 'KILO', tariffState: 'PRESENTE', tariffCode: 2, tariffPrice: '1.0000',
      policyUnit: 'KILO', unitState: 'VERIFICADA', manufacturingCost: '0.8', minimumOrigin: 'ERP_BASE', revision: 0,
    })).toThrow(CommercialPricePolicyError);
  });

  const verified = (extra = {}) => ({ articleCode: '1009', saleUnit: 'KILO', erpUnit: 'KILO', tariffState: 'PRESENTE', tariffCode: 2, tariffPrice: '0.9000', policyUnit: 'KILO', unitState: 'VERIFICADA', minimumOrigin: 'ERP_BASE', revision: 0, ...extra });

  test('zero cost, zero margin and zero minimum remain explicit values', () => {
    expect(resolveCommercialPricePolicy(verified({ manufacturingCost: 0, targetMarginPct: 0, minimumPrice: 0, minimumOrigin: 'MANUAL' })))
      .toMatchObject({ costMarginFloor: '0.0000', ownedMinimumFloor: '0.0000', effectiveFloor: '0.9000' });
  });

  test.each(['ENVASE', 'ENVASES', 'CAJA'])('supports existing box alias %s', (alias) => {
    expect(resolveCommercialPricePolicy(verified({ saleUnit: alias, erpUnit: 'CAJAS', policyUnit: 'CAJAS' })).saleUnit).toBe('CAJAS');
  });

  test.each(['KILOGRAMO', 'KILOGRAMOS', 'KILOS'])('supports existing kilo alias %s', (alias) => {
    expect(resolveCommercialPricePolicy(verified({ saleUnit: alias })).saleUnit).toBe('KILO');
  });

  test('a known changed master unit conflicts instead of omitting the ERP floor', () => {
    expect(() => resolveCommercialPricePolicy(verified({ erpUnit: 'CAJAS', minimumPrice: '0.1', minimumOrigin: 'MANUAL' })))
      .toThrow(expect.objectContaining({ code: 'COMMERCIAL_PRICE_POLICY_UOM_MISMATCH' }));
  });

  test('an explicitly manager-verified unit establishes the ERP tariff unit for a blank master', () => {
    expect(resolveCommercialPricePolicy(verified({ erpUnit: '', saleUnit: 'UNIDADES', policyUnit: 'UNIDADES' })))
      .toMatchObject({ baseErpFloor: '0.9000', effectiveFloor: '0.9000' });
  });

  test('alternative tariff is informative and owned policy remains effective', () => {
    expect(resolveCommercialPricePolicy(verified({ tariffCode: 7, tariffState: 'ALTERNATIVA', tariffPrice: '9', minimumPrice: '1', minimumOrigin: 'MANUAL' })))
      .toMatchObject({ baseErpFloor: null, effectiveFloor: '1.0000' });
  });

  test('ceil4 rounds the rational margin floor upward', () => {
    expect(resolveCommercialPricePolicy(verified({ manufacturingCost: '1', targetMarginPct: '33.3333' })).costMarginFloor).toBe('1.5000');
    expect(resolveCommercialPricePolicy(verified({ manufacturingCost: '1', targetMarginPct: '30' })).costMarginFloor).toBe('1.4286');
  });

  test.each([null, undefined, '', {}, false, '1e3', '1.00001', '9'.repeat(100000)])('invalid required net price yields a typed error, case %#', (unitPrice) => {
    expect(() => assertCommercialPriceNetFloor({ policy: resolveCommercialPricePolicy(verified()), unitPrice }))
      .toThrow(expect.objectContaining({ code: 'COMMERCIAL_PRICE_POLICY_INVALID' }));
  });

  test.each([{ manufacturingCost: '1', targetMarginPct: '100' }, { manufacturingCost: '-1', targetMarginPct: 0 }, { manufacturingCost: '9999999', targetMarginPct: '99.9999' }])('rejects invalid margin or overflow %p', (extra) => {
    expect(() => resolveCommercialPricePolicy(verified(extra))).toThrow(CommercialPricePolicyError);
  });

  test('net comparison is exact at four-decimal and two-discount boundary', () => {
    const policy = resolveCommercialPricePolicy(verified({ tariffPrice: '0.8100' }));
    expect(assertCommercialPriceNetFloor({ policy, unitPrice: 1, lineDiscountPct: 10, headerDiscountPct: 10 })).toMatchObject({ allowed: true, netUnitPrice: '0.81' });
    expect(() => assertCommercialPriceNetFloor({ policy, unitPrice: '0.9999', lineDiscountPct: 10, headerDiscountPct: 10 })).toThrow(expect.objectContaining({ code: 'HARD_PRICE_FLOOR_BREACH' }));
  });

  test('a client-supplied policy cannot disable or replace the floor', () => {
    expect(() => assertCommercialPriceNetFloor({ policy: { enforceable: false }, unitPrice: 0 }))
      .toThrow(expect.objectContaining({ code: 'COMMERCIAL_PRICE_POLICY_UNVERIFIED' }));
  });

  test.each([
    { minimumOrigin: 'ERP_BASE', minimumPrice: '9' },
    { minimumOrigin: 'ERP_BASE', minimumPrice: '0' },
    { minimumOrigin: 'MANUAL', minimumPrice: null },
    { minimumOrigin: 'MANUAL', minimumPrice: undefined },
    { minimumOrigin: undefined, minimumPrice: null },
    { minimumOrigin: 'UNKNOWN', minimumPrice: '9' },
  ])('persisted origin/minimum inconsistency fails closed, case %#', (changes) => {
    expect(() => resolveCommercialPricePolicy(verified(changes)))
      .toThrow(expect.objectContaining({ code: 'COMMERCIAL_PRICE_POLICY_INVALID', details: { field: 'minimumOrigin/minimumPrice' } }));
  });
});

describe('manager policy service', () => {
  const actor = { code: '80', role: 'JEFE_VENTAS' };
  const key = 'adf45c52-0c3a-47e1-a814-02ae4d4fb825';
  const body = (extra = {}) => ({ confirmed: true, expectedRevision: 0, reason: 'Revisión de coste', policyUnit: 'KILO', manufacturingCost: '0.8000', targetMarginPct: '20', minimumPrice: null, minimumOrigin: 'ERP_BASE', ...extra });
  const current = { articleCode: '1009', erpUnit: 'KILO', tariffState: 'PRESENTE', tariffCode: 2, tariffPrice: '0.9', unitState: 'NO_VERIFICADA', minimumOrigin: 'ERP_BASE', minimumPrice: null, revision: 0 };
  function setup() {
    const repository = { list: jest.fn(), audit: jest.fn(), update: jest.fn(async (input, derive) => {
      derive(current);
      return { articleCode: input.articleCode, revision: 1, replayed: false };
    }) };
    const invalidate = jest.fn();
    return { repository, invalidate, service: createCommercialPricePolicyService({ repository, invalidate }) };
  }
  test.each(['COMERCIAL', 'REPARTIDOR', 'JEFE', 'DIRECTOR'])('role %s cannot list, audit or mutate private data', async (role) => {
    const { service, repository } = setup();
    await expect(service.listPricePolicies({}, { ...actor, role, isJefeVentas: true })).rejects.toMatchObject({ status: 403 });
    await expect(service.getPricePolicyAudit('1009', {}, { ...actor, role })).rejects.toMatchObject({ status: 403 });
    await expect(service.updatePricePolicy('1009', body(), key, { ...actor, role })).rejects.toMatchObject({ status: 403 });
    expect(repository.update).not.toHaveBeenCalled();
  });
  test('confirmed typed values and actor are normalized before persistence', async () => {
    const { service, repository, invalidate } = setup();
    await expect(service.updatePricePolicy('1009', body(), key, actor)).resolves.toEqual({ articleCode: '1009', revision: 1, replayed: false });
    expect(repository.update.mock.calls[0][0]).toMatchObject({ actor, targetMarginPct: '20.0000', manufacturingCost: '0.8000', minimumPrice: null, expectedRevision: 0 });
    expect(invalidate).toHaveBeenCalledWith('1009', 1);
  });
  test.each([
    { confirmed: false }, { policyUnit: '' }, { policyUnit: 'ENVASES' }, { expectedRevision: '0' },
    { expectedRevision: 0.5 }, { expectedRevision: -1 }, { expectedRevision: 2147483647 },
    { manufacturingCost: null }, { manufacturingCost: '' }, { manufacturingCost: true },
    { targetMarginPct: '100' }, { minimumPrice: '1.23456', minimumOrigin: 'MANUAL' },
    { minimumPrice: '1', minimumOrigin: 'ERP_BASE' }, { reason: '' }, { reason: 'x\ny' },
    { role: 'ADMIN' }, { minimumOrigin: 'MANUAL', minimumPrice: null },
  ])('invalid edit is rejected before repository, case %#', async (changes) => {
    const { service, repository } = setup();
    await expect(service.updatePricePolicy('1009', body(changes), key, actor)).rejects.toMatchObject({ code: 'COMMERCIAL_PRICE_POLICY_INVALID', status: 422 });
    expect(repository.update).not.toHaveBeenCalled();
  });
  test('clearing the complete optional pair and setting a manual zero are explicit operations', async () => {
    const { service, repository } = setup();
    await service.updatePricePolicy('1009', body({ manufacturingCost: null, targetMarginPct: null, minimumPrice: '0', minimumOrigin: 'MANUAL' }), key, actor);
    expect(repository.update.mock.calls[0][0].changes).toMatchObject({ manufacturingCost: null, targetMarginPct: null, minimumPrice: '0.0000' });
  });
  test.each(['', 'a'.repeat(97), 'not-a-uuid'])('invalid nonce is rejected: case %#', async (nonce) => {
    const { service, repository } = setup();
    await expect(service.updatePricePolicy('1009', body(), nonce, actor)).rejects.toMatchObject({ status: 422 });
    expect(repository.update).not.toHaveBeenCalled();
  });
  test('one unverified unit remains visible and does not fail the whole manager list', async () => {
    const { service, repository } = setup();
    repository.list.mockResolvedValue({ total: 2, items: [current, { ...current, articleCode: '1001', erpUnit: '          ' }] });
    const result = await service.listPricePolicies({ page: '1', pageSize: '25', unitState: 'NO_VERIFICADA' }, actor);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ effectiveFloor: '0.9000' });
    expect(result.items[1]).toMatchObject({ effectiveFloor: null, enforceable: false, erpUnit: '          ', coverageError: expect.any(String) });
  });
  test.each([{ page: '1 OR 1=1' }, { pageSize: '101' }, { unitState: 'ALL' }, { q: ['a'] }])('invalid filters never reach persistence, case %#', async (query) => {
    const { service, repository } = setup();
    await expect(service.listPricePolicies(query, actor)).rejects.toMatchObject({ status: 422 });
    expect(repository.list).not.toHaveBeenCalled();
  });
});
