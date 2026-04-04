/**
 * Get Low Stock Use Case - Warehouse Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetLowStockUseCase extends UseCase {
  constructor(warehouseRepository) {
    super();
    this._repository = warehouseRepository;
  }

  async execute({ threshold = 10 }) {
    const lowStock = await this._repository.getLowStock(threshold);

    return lowStock;
  }
}

module.exports = { GetLowStockUseCase };
