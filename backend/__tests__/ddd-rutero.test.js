/**
 * DDD Rutero Module - Unit Tests
 * ================================
 * Tests for UpdateOrderUseCase and GetRutaConfigUseCase validation logic
 */

'use strict';

jest.mock('../../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { UpdateOrderUseCase, RutaConfigError } = require('../../src/modules/rutero/application/update-order-usecase');
const { GetRutaConfigUseCase } = require('../../src/modules/rutero/application/get-ruta-config-usecase');

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// UpdateOrderUseCase
// =============================================================================

describe('UpdateOrderUseCase', () => {
  function buildMocks() {
    const mockRepo = {
      updateOrder: jest.fn().mockResolvedValue({ configId: 1, newOrder: 5, success: true }),
    };
    const useCase = new UpdateOrderUseCase(mockRepo);
    return { useCase, mockRepo };
  }

  test('should throw when configId is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ configId: '', newOrder: 5 })
    ).rejects.toThrow(RutaConfigError);

    await expect(
      useCase.execute({ configId: '', newOrder: 5 })
    ).rejects.toMatchObject({ code: 'MISSING_CONFIG_ID' });
  });

  test('should throw when configId is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ newOrder: 5 })
    ).rejects.toMatchObject({ code: 'MISSING_CONFIG_ID' });
  });

  test('should throw when configId is null', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ configId: null, newOrder: 5 })
    ).rejects.toMatchObject({ code: 'MISSING_CONFIG_ID' });
  });

  test('should throw when newOrder is negative', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ configId: 1, newOrder: -1 })
    ).rejects.toMatchObject({ code: 'INVALID_ORDER' });
  });

  test('should throw when newOrder is -100', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ configId: 1, newOrder: -100 })
    ).rejects.toMatchObject({ code: 'INVALID_ORDER' });
  });

  test('should throw when newOrder is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ configId: 1 })
    ).rejects.toMatchObject({ code: 'INVALID_ORDER' });
  });

  test('should throw when newOrder is null', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ configId: 1, newOrder: null })
    ).rejects.toMatchObject({ code: 'INVALID_ORDER' });
  });

  test('should accept newOrder of 0', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.updateOrder.mockResolvedValue({ configId: 1, newOrder: 0, success: true });

    const result = await useCase.execute({ configId: 1, newOrder: 0 });

    expect(result.success).toBe(true);
    expect(mockRepo.updateOrder).toHaveBeenCalledWith({ configId: 1, newOrder: 0 });
  });

  test('should accept positive newOrder', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.updateOrder.mockResolvedValue({ configId: 1, newOrder: 10, success: true });

    const result = await useCase.execute({ configId: 1, newOrder: 10 });

    expect(result.newOrder).toBe(10);
    expect(mockRepo.updateOrder).toHaveBeenCalledWith({ configId: 1, newOrder: 10 });
  });

  test('should call repository with correct params on valid input', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.updateOrder.mockResolvedValue({ configId: 42, newOrder: 7, success: true });

    const result = await useCase.execute({ configId: 42, newOrder: 7 });

    expect(result.configId).toBe(42);
    expect(result.newOrder).toBe(7);
    expect(mockRepo.updateOrder).toHaveBeenCalledWith({ configId: 42, newOrder: 7 });
  });

  test('should pass RutaConfigError name correctly', async () => {
    const { useCase } = buildMocks();

    try {
      await useCase.execute({ configId: '', newOrder: 5 });
    } catch (err) {
      expect(err.name).toBe('RutaConfigError');
    }
  });

  test('should accept float newOrder (e.g. 2.5)', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.updateOrder.mockResolvedValue({ configId: 1, newOrder: 2.5, success: true });

    const result = await useCase.execute({ configId: 1, newOrder: 2.5 });

    expect(result.newOrder).toBe(2.5);
  });
});

// =============================================================================
// GetRutaConfigUseCase
// =============================================================================

describe('GetRutaConfigUseCase', () => {
  function buildMocks() {
    const mockRepo = {
      getRutaConfig: jest.fn().mockResolvedValue([]),
    };
    const useCase = new GetRutaConfigUseCase(mockRepo);
    return { useCase, mockRepo };
  }

  test('should throw when vendorCode is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ vendorCode: '' })
    ).rejects.toThrow('vendorCode is required');
  });

  test('should throw when vendorCode is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({})
    ).rejects.toThrow('vendorCode is required');
  });

  test('should throw when vendorCode is null', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ vendorCode: null })
    ).rejects.toThrow('vendorCode is required');
  });

  test('should call repository with correct params', async () => {
    const { useCase, mockRepo } = buildMocks();
    const mockConfig = [
      { id: 1, clientCode: 'C001', orden: 1, direccion: 'Calle Mayor 1' },
      { id: 2, clientCode: 'C002', orden: 2, direccion: 'Calle Mayor 2' },
    ];
    mockRepo.getRutaConfig.mockResolvedValue(mockConfig);

    const result = await useCase.execute({
      vendorCode: '01',
      date: '2026-04-02',
    });

    expect(result).toHaveLength(2);
    expect(result[0].clientCode).toBe('C001');
    expect(mockRepo.getRutaConfig).toHaveBeenCalledWith({
      vendorCode: '01',
      date: '2026-04-02',
    });
  });

  test('should work without optional date parameter', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.getRutaConfig.mockResolvedValue([{ id: 1 }]);

    const result = await useCase.execute({ vendorCode: '01' });

    expect(result).toHaveLength(1);
    expect(mockRepo.getRutaConfig).toHaveBeenCalledWith({
      vendorCode: '01',
      date: undefined,
    });
  });

  test('should return empty array when no config found', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.getRutaConfig.mockResolvedValue([]);

    const result = await useCase.execute({ vendorCode: '99' });

    expect(result).toEqual([]);
  });
});
