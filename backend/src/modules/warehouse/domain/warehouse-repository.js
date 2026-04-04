/**
 * Warehouse Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class WarehouseRepository extends Repository {
  async getStock({ productCode, warehouse, search, limit, offset }) {
    throw new Error('Method not implemented: getStock');
  }

  async getMovements({ productCode, type, dateFrom, dateTo, limit, offset }) {
    throw new Error('Method not implemented: getMovements');
  }

  async getLowStock(threshold = 10) {
    throw new Error('Method not implemented: getLowStock');
  }

  async registerMovement(movement) {
    throw new Error('Method not implemented: registerMovement');
  }
}

module.exports = { WarehouseRepository };
