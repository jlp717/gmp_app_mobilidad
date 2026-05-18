/**
 * Get Stock Use Case - Warehouse Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetStockUseCase extends UseCase {
  constructor(warehouseRepository) {
    super();
    this._repository = warehouseRepository;
  }

  async execute({ productCode, warehouse, search = '', limit = 100, offset = 0 }) {
    const stock = await this._repository.getStock({ productCode, warehouse, search, limit, offset });

    const lowStock = stock.filter(s => s.isLowStock);
    const outOfStock = stock.filter(s => s.isOutOfStock);

    return {
      stock,
      total: stock.length,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
      hasMore: stock.length >= limit
    };
  }
}

module.exports = { GetStockUseCase };
