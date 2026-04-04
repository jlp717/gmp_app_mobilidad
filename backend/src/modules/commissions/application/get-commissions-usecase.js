/**
 * Get Commissions Use Case - Commissions Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetCommissionsUseCase extends UseCase {
  constructor(commissionRepository) {
    super();
    this._repository = commissionRepository;
  }

  async execute({ vendedorCodes, year, month, clientCode = null }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const filters = {};
    if (clientCode) filters.clientCode = clientCode;

    const commissions = await this._repository.findByVendor(vendedorCodes, year, month, filters);

    return {
      commissions,
      total: commissions.length,
      totalImporte: commissions.reduce((sum, c) => sum + c.importe, 0),
      totalComision: commissions.reduce((sum, c) => sum + c.comision, 0)
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetCommissionsUseCase, ValidationError };
