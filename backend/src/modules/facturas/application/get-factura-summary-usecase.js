/**
 * Get Factura Summary Use Case - Facturas Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetFacturaSummaryUseCase extends UseCase {
  constructor(facturasRepository) {
    super();
    this._repository = facturasRepository;
  }

  async execute({ vendedorCodes, year, month, dateFrom = null, dateTo = null }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const summary = await this._repository.getSummary(vendedorCodes, year, month);

    return {
      totalFacturas: parseInt(summary.NUM_FACTURAS) || 0,
      totalImporte: parseFloat(summary.TOTAL) || 0,
      totalBase: parseFloat(summary.BASE) || 0,
      totalIva: parseFloat(summary.IVA) || 0
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetFacturaSummaryUseCase, ValidationError };
