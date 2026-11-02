'use strict';

const {
  normalizeCommercialActor,
  normalizeCommercialPaymentInput,
} = require('../src/modules/cobros/domain/commercial-payment-contract');

describe('commercial payment contract', () => {
  test.each(['COMERCIAL', 'JEFE_VENTAS', 'ADMIN'])('accepts the explicit commercial role %s', (role) => {
    expect(normalizeCommercialActor({ userId: '80', userRole: role })).toEqual({
      userId: '80',
      userRole: role,
    });
  });

  test.each(['REPARTIDOR', 'ALMACEN', '', undefined])('rejects non-commercial role %s', (role) => {
    expect(() => normalizeCommercialActor({ userId: '80', userRole: role }))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN_COMMERCIAL_ROLE', status: 403 }));
  });

  test('never accepts the actor from a payment body when JWT identity is missing', () => {
    expect(() => normalizeCommercialActor({ userId: '', userRole: 'COMERCIAL' }))
      .toThrow(expect.objectContaining({ code: 'AUTHENTICATION_REQUIRED', status: 401 }));
  });

  test.each([
    ['CONTADO', 'CONTADO'],
    ['tj', 'TJ'],
    ['TR', 'TR'],
    ['T0', 'TR'],
  ])('normalizes commercial instrument %s to %s', (paymentMethod, expected) => {
    expect(normalizeCommercialPaymentInput({
      clientCode: 'C001',
      reference: 'CVC:CAC:B:GMP:2026:F:35:22:1:1',
      amount: '738.46',
      paymentMethod,
      saleType: 'CLIENT_VALUE_MUST_BE_IGNORED',
      paymentMode: 'CLIENT_VALUE_MUST_BE_IGNORED',
      observations: 'Cobro entregado por el cliente',
    }).paymentMethod).toBe(expected);
  });

  test.each(['CREDITO', '02', 'EFECTIVO', '', undefined])('rejects unsupported instrument %s', (paymentMethod) => {
    expect(() => normalizeCommercialPaymentInput({
      clientCode: 'C001', reference: 'M-1', amount: 10, paymentMethod,
      saleType: 'CC', paymentMode: 'NORMAL', observations: 'Cobro real',
    })).toThrow(expect.objectContaining({ code: 'INVALID_PAYMENT_METHOD', status: 400 }));
  });

  test.each([0, -1, Infinity, NaN, '1.001', '999999999.999', '1000000000.00'])('rejects unsafe monetary amount %s', (amount) => {
    expect(() => normalizeCommercialPaymentInput({
      clientCode: 'C001', reference: 'M-1', amount, paymentMethod: 'CONTADO',
      saleType: 'CC', paymentMode: 'NORMAL', observations: 'Cobro real',
    })).toThrow(expect.objectContaining({ code: 'INVALID_PAYMENT_AMOUNT', status: 400 }));
  });

  test.each(['', '   ', 'x'.repeat(256)])('requires nonempty observations up to 255 characters', (observations) => {
    expect(() => normalizeCommercialPaymentInput({
      clientCode: 'C001', reference: 'M-1', amount: 10, paymentMethod: 'CONTADO',
      saleType: 'CC', paymentMode: 'NORMAL', observations,
    })).toThrow(expect.objectContaining({ code: 'INVALID_PAYMENT_OBSERVATIONS', status: 400 }));
  });

  test('keeps ERP sale condition and collection instrument independent', () => {
    const payment = normalizeCommercialPaymentInput({
      clientCode: 'C001', reference: 'M-1', amount: 10.25, paymentMethod: 'TJ',
      saleType: 'VC', paymentMode: 'ESPECIAL', observations: 'Pago con tarjeta',
    });
    expect(payment).toEqual(expect.objectContaining({
      amountCents: 1025,
      amount: 10.25,
      paymentMethod: 'TJ',
    }));
    expect(payment).not.toHaveProperty('saleType');
    expect(payment).not.toHaveProperty('paymentMode');
  });
});
