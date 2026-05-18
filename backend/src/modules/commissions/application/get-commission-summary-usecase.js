/**
 * Get Commission Summary Use Case - Commissions Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetCommissionSummaryUseCase extends UseCase {
  constructor(commissionRepository) {
    super();
    this._repository = commissionRepository;
  }

  async execute({ vendedorCodes, year }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const summary = await this._repository.getSummary(vendedorCodes, year);

    return {
      summary: summary || [],
      totalVentas: (summary || []).reduce((s, row) => s + parseFloat(row.TOTAL_VENTAS || 0), 0),
      totalComisiones: (summary || []).reduce((s, row) => s + parseFloat(row.TOTAL_COMISIONES || 0), 0)
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetCommissionSummaryUseCase, ValidationError };
