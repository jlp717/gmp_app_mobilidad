/**
 * Get Filters Use Case - Filters Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetFiltersUseCase extends UseCase {
  constructor(filterRepository) {
    super();
    this._repository = filterRepository;
  }

  async execute({ type, vendorCodes, activeOnly = false }) {
    if (!vendorCodes) {
      throw new ValidationError('vendorCodes is required');
    }

    if (type) {
      const filters = activeOnly
        ? await this._repository.getActive(type, vendorCodes)
        : await this._repository.findByType(type, vendorCodes);

      return {
        type,
        filters: filters.map(f => ({
          code: f.code,
          name: f.name,
          type: f.type,
          order: f.order,
          active: f.isActive,
          description: f.description
        })),
        total: filters.length
      };
    }

    const filters = await this._repository.findAll(vendorCodes);
    const groupedByType = {};
    filters.forEach(f => {
      if (!groupedByType[f.type]) {
        groupedByType[f.type] = [];
      }
      groupedByType[f.type].push({
        code: f.code,
        name: f.name,
        type: f.type,
        order: f.order,
        active: f.isActive,
        description: f.description
      });
    });

    return {
      filters: groupedByType,
      total: filters.length
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetFiltersUseCase, ValidationError };
