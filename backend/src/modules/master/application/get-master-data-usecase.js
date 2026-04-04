/**
 * Get Master Data Use Case - Master Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetMasterDataUseCase extends UseCase {
  constructor(masterRepository) {
    super();
    this._repository = masterRepository;
  }

  async execute({ type }) {
    if (type) {
      const data = await this._repository.getByType(type);
      return {
        type,
        data: data.map(d => ({
          type: d.type,
          code: d.code,
          name: d.name,
          description: d.description,
          active: d.isActive,
          extra: d.extra
        })),
        total: data.length
      };
    }

    const all = await this._repository.getAll();
    return {
      data: {
        families: all.families.map(d => ({ code: d.code, name: d.name })),
        tarifas: all.tarifas.map(d => ({ code: d.code, name: d.name })),
        vendors: all.vendors.map(d => ({ code: d.code, name: d.name })),
        payment_conditions: all.payment_conditions.map(d => ({
          code: d.code,
          name: d.name,
          description: d.description,
          active: d.isActive,
          extra: d.extra
        }))
      }
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetMasterDataUseCase, ValidationError };
