/**
 * Base Repository Interface - DDD Domain Pattern
 * All repository implementations must follow this contract
 */
class Repository {
  async findById(id) {
    throw new Error('Method not implemented: findById');
  }

  async findAll(filter = {}) {
    throw new Error('Method not implemented: findAll');
  }

  async save(entity) {
    throw new Error('Method not implemented: save');
  }

  async delete(id) {
    throw new Error('Method not implemented: delete');
  }
}

module.exports = { Repository };
