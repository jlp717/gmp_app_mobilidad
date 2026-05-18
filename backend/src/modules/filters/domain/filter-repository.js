/**
 * Filter Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class FilterRepository extends Repository {
  async findByType(type, vendorCodes) {
    throw new Error('Method not implemented: findByType');
  }

  async findAll(vendorCodes) {
    throw new Error('Method not implemented: findAll');
  }

  async getActive(type, vendorCodes) {
    throw new Error('Method not implemented: getActive');
  }
}

module.exports = { FilterRepository };
