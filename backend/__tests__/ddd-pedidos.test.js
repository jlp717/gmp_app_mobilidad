/**
 * DDD Pedidos Module - Unit Tests
 * ================================
 * Tests for SearchProductsUseCase, ConfirmOrderUseCase, GetProductDetailUseCase,
 * and GetPromotionsUseCase validation logic
 */

'use strict';

jest.mock('../../middleware/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { SearchProductsUseCase } = require('../../src/modules/pedidos/application/search-products-usecase');
const { ConfirmOrderUseCase, ConfirmOrderError } = require('../../src/modules/pedidos/application/confirm-order-usecase');
const { GetProductDetailUseCase } = require('../../src/modules/pedidos/application/get-product-detail-usecase');
const { GetPromotionsUseCase } = require('../../src/modules/pedidos/application/get-promotions-usecase');

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// SearchProductsUseCase
// =============================================================================

describe('SearchProductsUseCase', () => {
  function buildMocks() {
    const mockRepo = {
      searchProducts: jest.fn().mockResolvedValue({ products: [], count: 0 }),
    };
    const useCase = new SearchProductsUseCase(mockRepo);
    return { useCase, mockRepo };
  }

  test('should throw when clientCode is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        vendedorCodes: '01',
        clientCode: '',
      })
    ).rejects.toThrow('clientCode is required');
  });

  test('should throw when clientCode is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        vendedorCodes: '01',
      })
    ).rejects.toThrow('clientCode is required');
  });

  test('should throw when vendedorCodes is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        clientCode: 'C001',
        vendedorCodes: '',
      })
    ).rejects.toThrow('vendedorCodes is required');
  });

  test('should throw when vendedorCodes is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        clientCode: 'C001',
      })
    ).rejects.toThrow('vendedorCodes is required');
  });

  test('should throw when both clientCode and vendedorCodes are missing', async () => {
    const { useCase } = buildMocks();

    await expect(useCase.execute({})).rejects.toThrow('clientCode is required');
  });

  test('should call repository with correct params on valid input', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.searchProducts.mockResolvedValue({
      products: [{ code: 'P001', name: 'Product 1' }],
      count: 1,
    });

    const result = await useCase.execute({
      clientCode: 'C001',
      vendedorCodes: '01',
      family: 'EMBUTIDOS',
      marca: 'PREMIUM',
      search: 'jamón',
      limit: 20,
      offset: 10,
    });

    expect(result.count).toBe(1);
    expect(mockRepo.searchProducts).toHaveBeenCalledWith({
      clientCode: 'C001',
      vendedorCodes: '01',
      family: 'EMBUTIDOS',
      marca: 'PREMIUM',
      search: 'jamón',
      limit: 20,
      offset: 10,
    });
  });

  test('should use default limit and offset when not provided', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.searchProducts.mockResolvedValue({ products: [], count: 0 });

    await useCase.execute({
      clientCode: 'C001',
      vendedorCodes: '01',
    });

    const callArgs = mockRepo.searchProducts.mock.calls[0][0];
    expect(callArgs.limit).toBe(50);
    expect(callArgs.offset).toBe(0);
  });
});

// =============================================================================
// ConfirmOrderUseCase
// =============================================================================

describe('ConfirmOrderUseCase', () => {
  function buildMocks() {
    const mockRepo = {
      confirmOrder: jest.fn().mockResolvedValue({ orderId: 1, status: 'CONFIRMADO' }),
    };
    const useCase = new ConfirmOrderUseCase(mockRepo);
    return { useCase, mockRepo };
  }

  test('should throw when userId is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        userId: '',
        clientCode: 'C001',
        lines: [{ productCode: 'P001', quantity: 1 }],
      })
    ).rejects.toThrow(ConfirmOrderError);

    await expect(
      useCase.execute({
        userId: '',
        clientCode: 'C001',
        lines: [{ productCode: 'P001', quantity: 1 }],
      })
    ).rejects.toMatchObject({ code: 'MISSING_USER_ID' });
  });

  test('should throw when clientCode is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        userId: '01',
        clientCode: '',
        lines: [{ productCode: 'P001', quantity: 1 }],
      })
    ).rejects.toMatchObject({ code: 'MISSING_CLIENT_CODE' });
  });

  test('should throw when lines is empty array', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        userId: '01',
        clientCode: 'C001',
        lines: [],
      })
    ).rejects.toMatchObject({ code: 'EMPTY_ORDER' });
  });

  test('should throw when lines is null', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        userId: '01',
        clientCode: 'C001',
        lines: null,
      })
    ).rejects.toMatchObject({ code: 'EMPTY_ORDER' });
  });

  test('should throw when lines is not an array', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        userId: '01',
        clientCode: 'C001',
        lines: 'not-an-array',
      })
    ).rejects.toMatchObject({ code: 'EMPTY_ORDER' });
  });

  test('should throw when line has no productCode', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        userId: '01',
        clientCode: 'C001',
        lines: [{ quantity: 1 }],
      })
    ).rejects.toMatchObject({ code: 'INVALID_LINE' });
  });

  test('should throw when line has empty productCode', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        userId: '01',
        clientCode: 'C001',
        lines: [{ productCode: '', quantity: 1 }],
      })
    ).rejects.toMatchObject({ code: 'INVALID_LINE' });
  });

  test('should throw when line has negative quantity', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        userId: '01',
        clientCode: 'C001',
        lines: [{ productCode: 'P001', quantity: -5 }],
      })
    ).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
  });

  test('should throw when line has zero quantity', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        userId: '01',
        clientCode: 'C001',
        lines: [{ productCode: 'P001', quantity: 0 }],
      })
    ).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
  });

  test('should throw when line has missing quantity', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        userId: '01',
        clientCode: 'C001',
        lines: [{ productCode: 'P001' }],
      })
    ).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
  });

  test('should validate second line item and report correct line number', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({
        userId: '01',
        clientCode: 'C001',
        lines: [
          { productCode: 'P001', quantity: 1 },
          { productCode: 'P002', quantity: -1 },
        ],
      })
    ).rejects.toThrow('Line 2: quantity must be greater than 0');
  });

  test('should call repository on valid input', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.confirmOrder.mockResolvedValue({ orderId: 42, status: 'CONFIRMADO' });

    const result = await useCase.execute({
      userId: '01',
      clientCode: 'C001',
      lines: [
        { productCode: 'P001', quantity: 5 },
        { productCode: 'P002', quantity: 3 },
      ],
      observations: 'Rush order',
    });

    expect(result.orderId).toBe(42);
    expect(mockRepo.confirmOrder).toHaveBeenCalledWith({
      userId: '01',
      clientCode: 'C001',
      lines: [
        { productCode: 'P001', quantity: 5 },
        { productCode: 'P002', quantity: 3 },
      ],
      observations: 'Rush order',
    });
  });

  test('should default observations to empty string when not provided', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.confirmOrder.mockResolvedValue({ orderId: 1, status: 'CONFIRMADO' });

    await useCase.execute({
      userId: '01',
      clientCode: 'C001',
      lines: [{ productCode: 'P001', quantity: 1 }],
    });

    const callArgs = mockRepo.confirmOrder.mock.calls[0][0];
    expect(callArgs.observations).toBe('');
  });
});

// =============================================================================
// GetProductDetailUseCase
// =============================================================================

describe('GetProductDetailUseCase', () => {
  function buildMocks() {
    const mockRepo = {
      getProductDetail: jest.fn().mockResolvedValue({ code: 'P001', name: 'Product 1' }),
    };
    const useCase = new GetProductDetailUseCase(mockRepo);
    return { useCase, mockRepo };
  }

  test('should throw when product code is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ code: '', clientCode: 'C001', vendedorCodes: '01' })
    ).rejects.toThrow('Product code is required');
  });

  test('should throw when product code is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ clientCode: 'C001', vendedorCodes: '01' })
    ).rejects.toThrow('Product code is required');
  });

  test('should call repository with correct params on valid input', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.getProductDetail.mockResolvedValue({
      code: 'P001',
      name: 'Jamón Ibérico',
      price: 25.50,
    });

    const result = await useCase.execute({
      code: 'P001',
      clientCode: 'C001',
      vendedorCodes: '01',
    });

    expect(result.code).toBe('P001');
    expect(mockRepo.getProductDetail).toHaveBeenCalledWith({
      code: 'P001',
      clientCode: 'C001',
      vendedorCodes: '01',
    });
  });

  test('should return null when product not found', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.getProductDetail.mockResolvedValue(null);

    const result = await useCase.execute({
      code: 'P999',
      clientCode: 'C001',
      vendedorCodes: '01',
    });

    expect(result).toBeNull();
  });
});

// =============================================================================
// GetPromotionsUseCase
// =============================================================================

describe('GetPromotionsUseCase', () => {
  function buildMocks() {
    const mockRepo = {
      getPromotions: jest.fn().mockResolvedValue([]),
    };
    const useCase = new GetPromotionsUseCase(mockRepo);
    return { useCase, mockRepo };
  }

  test('should throw when clientCode is missing', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ clientCode: '', vendedorCodes: '01' })
    ).rejects.toThrow('clientCode is required');
  });

  test('should throw when clientCode is undefined', async () => {
    const { useCase } = buildMocks();

    await expect(
      useCase.execute({ vendedorCodes: '01' })
    ).rejects.toThrow('clientCode is required');
  });

  test('should call repository with correct params on valid input', async () => {
    const { useCase, mockRepo } = buildMocks();
    const mockPromos = [
      { codigoArticulo: 'ART001', precio: 5.50, precioCosto: 3.20 },
    ];
    mockRepo.getPromotions.mockResolvedValue(mockPromos);

    const result = await useCase.execute({
      clientCode: 'C001',
      vendedorCodes: '01',
    });

    expect(result).toHaveLength(1);
    expect(result[0].codigoArticulo).toBe('ART001');
    expect(mockRepo.getPromotions).toHaveBeenCalledWith({
      clientCode: 'C001',
      vendedorCodes: '01',
    });
  });

  test('should return empty array when no promotions found', async () => {
    const { useCase, mockRepo } = buildMocks();
    mockRepo.getPromotions.mockResolvedValue([]);

    const result = await useCase.execute({
      clientCode: 'C001',
      vendedorCodes: '01',
    });

    expect(result).toEqual([]);
  });
});
