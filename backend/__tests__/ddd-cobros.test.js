/**
 * DDD Cobros Module - Unit Tests
 * ===============================
 * Tests for RegisterPaymentUseCase and GetPendientesUseCase validation logic
 */

'use strict';

jest.mock('../../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { RegisterPaymentUseCase, PaymentError } = require('../../src/modules/cobros/application/register-payment-usecase');
const { GetPendientesUseCase } = require('../../src/modules/cobros/application/get-pendientes-usecase');

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// RegisterPaymentUseCase
// =============================================================================

describe('RegisterPaymentUseCase', () => {
  function buildMocks() {
    const mockRepo = {
      registerPayment: jest.fn().mockResolvedValue({ id: 1, status: 'REGISTERED' }),
    };
    const useCase = new RegisterPaymentUseCase(mockRepo);
    return { useCase, mockRepo };
  }

  test('should throw when clientCode is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        clientCode: '',
        amount: 100,
        paymentMethod: 'EFECTIVO',
        userId: '01',
      })
    ).rejects.toThrow(PaymentError);

    await expect(
      useCase.execute({
        clientCode: '',
        amount: 100,
        paymentMethod: 'EFECTIVO',
        userId: '01',
      })
    ).rejects.toMatchObject({ code: 'MISSING_CLIENT_CODE' });
  });

  test('should throw when clientCode is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        amount: 100,
        paymentMethod: 'EFECTIVO',
        userId: '01',
      })
    ).rejects.toMatchObject({ code: 'MISSING_CLIENT_CODE' });
  });

  test('should throw when paymentMethod is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        clientCode: 'C001',
        amount: 100,
        paymentMethod: '',
        userId: '01',
      })
    ).rejects.toMatchObject({ code: 'MISSING_PAYMENT_METHOD' });
  });

  test('should throw when paymentMethod is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        clientCode: 'C001',
        amount: 100,
        userId: '01',
      })
    ).rejects.toMatchObject({ code: 'MISSING_PAYMENT_METHOD' });
  });

  test('should throw when amount is negative', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        clientCode: 'C001',
        amount: -50,
        paymentMethod: 'EFECTIVO',
        userId: '01',
      })
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  test('should throw when amount is zero', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        clientCode: 'C001',
        amount: 0,
        paymentMethod: 'EFECTIVO',
        userId: '01',
      })
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  test('should throw when amount is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        clientCode: 'C001',
        paymentMethod: 'EFECTIVO',
        userId: '01',
      })
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  test('should throw when amount is null', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        clientCode: 'C001',
        amount: null,
        paymentMethod: 'EFECTIVO',
        userId: '01',
      })
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  test('should call repository with correct params on valid input', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.registerPayment.mockResolvedValue({ id: 42, status: 'REGISTERED' });

    const result = await useCase.execute({
      clientCode: 'C001',
      amount: 250.50,
      paymentMethod: 'TARJETA',
      reference: 'REF-12345',
      observations: 'Pago parcial',
      userId: '01',
    });

    expect(result.id).toBe(42);
    expect(mockRepo.registerPayment).toHaveBeenCalledWith({
      clientCode: 'C001',
      amount: 250.50,
      paymentMethod: 'TARJETA',
      reference: 'REF-12345',
      observations: 'Pago parcial',
      userId: '01',
    });
  });

  test('should succeed with minimal required fields', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.registerPayment.mockResolvedValue({ id: 1, status: 'REGISTERED' });

    const result = await useCase.execute({
      clientCode: 'C001',
      amount: 100,
      paymentMethod: 'EFECTIVO',
    });

    expect(result.id).toBe(1);
    expect(mockRepo.registerPayment).toHaveBeenCalled();
  });

  test('should accept decimal amounts', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.registerPayment.mockResolvedValue({ id: 1, status: 'REGISTERED' });

    await useCase.execute({
      clientCode: 'C001',
      amount: 99.99,
      paymentMethod: 'EFECTIVO',
    });

    const callArgs = mockRepo.registerPayment.mock.calls[0][0];
    expect(callArgs.amount).toBe(99.99);
  });

  test('should pass PaymentError name correctly', async () => {
    const { useCase } = buildMocks();

    try {
      await useCase.execute({
        clientCode: 'C001',
        amount: -10,
        paymentMethod: 'EFECTIVO',
      });
    } catch (err) {
      expect(err.name).toBe('PaymentError');
    }
  });
});

// =============================================================================
// GetPendientesUseCase
// =============================================================================

describe('GetPendientesUseCase', () => {
  function buildMocks() {
    const mockRepo = {
      getPendientes: jest.fn().mockResolvedValue([]),
    };
    const useCase = new GetPendientesUseCase(mockRepo);
    return { useCase, mockRepo };
  }

  test('should throw when clientCode is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ clientCode: '' })
    ).rejects.toThrow('clientCode is required');
  });

  test('should throw when clientCode is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({})
    ).rejects.toThrow('clientCode is required');
  });

  test('should throw when clientCode is null', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ clientCode: null })
    ).rejects.toThrow('clientCode is required');
  });

  test('should call repository with correct clientCode', async () => {
    const { useCase, mockRepo } = buildMocks();
    const mockPendientes = [
      { id: 1, amount: 500, dueDate: '2026-04-15' },
      { id: 2, amount: 250, dueDate: '2026-05-01' },
    ];
    mockRepo.getPendientes.mockResolvedValue(mockPendientes);

    const result = await useCase.execute({ clientCode: 'C001' });

    expect(result).toHaveLength(2);
    expect(result[0].amount).toBe(500);
    expect(mockRepo.getPendientes).toHaveBeenCalledWith('C001');
  });

  test('should return empty array when no pendientes found', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.getPendientes.mockResolvedValue([]);

    const result = await useCase.execute({ clientCode: 'C999' });

    expect(result).toEqual([]);
  });
});
