/**
 * DDD Entregas Module - Unit Tests
 * ==================================
 * Tests for MarkDeliveredUseCase and GetAlbaranesUseCase validation logic
 */

'use strict';

jest.mock('../../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { MarkDeliveredUseCase, DeliveryError } = require('../../src/modules/entregas/application/mark-delivered-usecase');
const { GetAlbaranesUseCase } = require('../../src/modules/entregas/application/get-albaranes-usecase');

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// MarkDeliveredUseCase
// =============================================================================

describe('MarkDeliveredUseCase', () => {
  function buildMocks() {
    const mockRepo = {
      markDelivered: jest.fn().mockResolvedValue({ id: 1, status: 'DELIVERED' }),
    };
    const useCase = new MarkDeliveredUseCase(mockRepo);
    return { useCase, mockRepo };
  }

  test('should throw when albaranId is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        albaranId: '',
        repartidorId: 'R01',
      })
    ).rejects.toThrow(DeliveryError);

    await expect(
      useCase.execute({
        albaranId: '',
        repartidorId: 'R01',
      })
    ).rejects.toMatchObject({ code: 'MISSING_ALBARAN_ID' });
  });

  test('should throw when albaranId is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ repartidorId: 'R01' })
    ).rejects.toMatchObject({ code: 'MISSING_ALBARAN_ID' });
  });

  test('should throw when albaranId is null', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ albaranId: null, repartidorId: 'R01' })
    ).rejects.toMatchObject({ code: 'MISSING_ALBARAN_ID' });
  });

  test('should throw when repartidorId is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        albaranId: 'ALB001',
        repartidorId: '',
      })
    ).rejects.toMatchObject({ code: 'MISSING_REPARTIDOR_ID' });
  });

  test('should throw when repartidorId is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ albaranId: 'ALB001' })
    ).rejects.toMatchObject({ code: 'MISSING_REPARTIDOR_ID' });
  });

  test('should throw when repartidorId is null', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ albaranId: 'ALB001', repartidorId: null })
    ).rejects.toMatchObject({ code: 'MISSING_REPARTIDOR_ID' });
  });

  test('should throw when both albaranId and repartidorId are missing', async () => {
    const { useCase } = buildMocks();

    await expect(useCase.execute({})).rejects.toMatchObject({ code: 'MISSING_ALBARAN_ID' });
  });

  test('should call repository with all params on valid input', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.markDelivered.mockResolvedValue({ id: 42, status: 'DELIVERED' });

    const result = await useCase.execute({
      albaranId: 'ALB-2026-001',
      observations: 'Entregado en recepción',
      signaturePath: '/signatures/alb-001.png',
      latitude: 40.4168,
      longitude: -3.7038,
      repartidorId: 'R01',
    });

    expect(result.id).toBe(42);
    expect(mockRepo.markDelivered).toHaveBeenCalledWith({
      albaranId: 'ALB-2026-001',
      observations: 'Entregado en recepción',
      signaturePath: '/signatures/alb-001.png',
      latitude: 40.4168,
      longitude: -3.7038,
      repartidorId: 'R01',
    });
  });

  test('should succeed with only required fields', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.markDelivered.mockResolvedValue({ id: 1, status: 'DELIVERED' });

    const result = await useCase.execute({
      albaranId: 'ALB001',
      repartidorId: 'R01',
    });

    expect(result.status).toBe('DELIVERED');
    expect(mockRepo.markDelivered).toHaveBeenCalled();
  });

  test('should call repository with undefined optional fields when not provided', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.markDelivered.mockResolvedValue({ id: 1, status: 'DELIVERED' });

    await useCase.execute({
      albaranId: 'ALB001',
      repartidorId: 'R01',
    });

    const callArgs = mockRepo.markDelivered.mock.calls[0][0];
    expect(callArgs.observations).toBeUndefined();
    expect(callArgs.signaturePath).toBeUndefined();
    expect(callArgs.latitude).toBeUndefined();
    expect(callArgs.longitude).toBeUndefined();
  });

  test('should pass DeliveryError name correctly', async () => {
    const { useCase } = buildMocks();

    try {
      await useCase.execute({ albaranId: '', repartidorId: 'R01' });
    } catch (err) {
      expect(err.name).toBe('DeliveryError');
    }
  });
});

// =============================================================================
// GetAlbaranesUseCase
// =============================================================================

describe('GetAlbaranesUseCase', () => {
  function buildMocks() {
    const mockRepo = {
      getAlbaranes: jest.fn().mockResolvedValue([]),
    };
    const useCase = new GetAlbaranesUseCase(mockRepo);
    return { useCase, mockRepo };
  }

  test('should throw when repartidorId is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ repartidorId: '' })
    ).rejects.toThrow('repartidorId is required');
  });

  test('should throw when repartidorId is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({})
    ).rejects.toThrow('repartidorId is required');
  });

  test('should throw when repartidorId is null', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ repartidorId: null })
    ).rejects.toThrow('repartidorId is required');
  });

  test('should call repository with correct params', async () => {
    const { useCase, mockRepo } = buildMocks();
    const mockAlbaranes = [
      { id: 'ALB001', clientName: 'Tienda A', status: 'PENDIENTE' },
      { id: 'ALB002', clientName: 'Tienda B', status: 'PENDIENTE' },
    ];
    mockRepo.getAlbaranes.mockResolvedValue(mockAlbaranes);

    const result = await useCase.execute({
      repartidorId: 'R01',
      date: '2026-04-02',
      status: 'PENDIENTE',
    });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('ALB001');
    expect(mockRepo.getAlbaranes).toHaveBeenCalledWith({
      repartidorId: 'R01',
      date: '2026-04-02',
      status: 'PENDIENTE',
    });
  });

  test('should work with only repartidorId (optional params omitted)', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.getAlbaranes.mockResolvedValue([{ id: 'ALB001' }]);

    const result = await useCase.execute({ repartidorId: 'R01' });

    expect(result).toHaveLength(1);
    expect(mockRepo.getAlbaranes).toHaveBeenCalledWith({
      repartidorId: 'R01',
      date: undefined,
      status: undefined,
    });
  });

  test('should return empty array when no albaranes found', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.getAlbaranes.mockResolvedValue([]);

    const result = await useCase.execute({ repartidorId: 'R99' });

    expect(result).toEqual([]);
  });
});
