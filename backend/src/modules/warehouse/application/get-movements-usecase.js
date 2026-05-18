/**
 * Get Movements Use Case - Warehouse Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetMovementsUseCase extends UseCase {
  constructor(warehouseRepository) {
    super();
    this._repository = warehouseRepository;
  }

  async execute({ productCode, type, dateFrom, dateTo, limit = 50, offset = 0 }) {
    const movements = await this._repository.getMovements({
      productCode, type, dateFrom, dateTo, limit, offset
    });

    return {
      movements,
      total: movements.length,
      hasMore: movements.length >= limit
    };
  }
}

module.exports = { GetMovementsUseCase };
