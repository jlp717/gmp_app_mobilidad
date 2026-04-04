/**
 * Get Facturas Use Case - Facturas Domain
 */
const { UseCase } = require('../../../core/application/use-case');

class GetFacturasUseCase extends UseCase {
  constructor(facturasRepository) {
    super();
    this._repository = facturasRepository;
  }

  async execute({ vendedorCodes, year, month, clientId = null, search = null, clientSearch = null, docSearch = null, dateFrom = null, dateTo = null }) {
    if (!vendedorCodes) {
      throw new ValidationError('vendedorCodes is required');
    }

    const filters = {};
    if (clientId) filters.clientId = clientId;

    const facturas = await this._repository.findByVendor(vendedorCodes, year, month, filters);

    let filtered = facturas;

    if (search) {
      const searchUpper = search.toUpperCase();
      const searchNum = parseFloat(search);
      const isNum = !isNaN(searchNum);
      filtered = filtered.filter(f =>
        f.clienteNombre.toUpperCase().includes(searchUpper) ||
        f.clienteId.toUpperCase().includes(searchUpper) ||
        (isNum && f.numero === searchNum)
      );
    }

    if (clientSearch) {
      const clientSearchUpper = clientSearch.toUpperCase();
      filtered = filtered.filter(f =>
        f.clienteNombre.toUpperCase().includes(clientSearchUpper)
      );
    }

    if (docSearch) {
      const docSearchUpper = docSearch.toUpperCase();
      const docSearchNum = parseFloat(docSearch);
      const isDocNum = !isNaN(docSearchNum);
      filtered = filtered.filter(f =>
        f.serie.toUpperCase().includes(docSearchUpper) ||
        f.clienteId.toUpperCase().includes(docSearchUpper) ||
        (isDocNum && f.numero === docSearchNum)
      );
    }

    if (dateFrom && dateTo) {
      const fromParts = dateFrom.split('-').map(Number);
      const toParts = dateTo.split('-').map(Number);
      const fromDate = new Date(fromParts[0], fromParts[1] - 1, fromParts[2]);
      const toDate = new Date(toParts[0], toParts[1] - 1, toParts[2]);
      filtered = filtered.filter(f => {
        const parts = f.fecha.split('/');
        const facturaDate = new Date(parts[2], parts[1] - 1, parts[0]);
        return facturaDate >= fromDate && facturaDate <= toDate;
      });
    }

    return {
      facturas: filtered,
      total: filtered.length,
      totalImporte: filtered.reduce((sum, f) => sum + f.total, 0),
      totalBase: filtered.reduce((sum, f) => sum + f.base, 0),
      totalIva: filtered.reduce((sum, f) => sum + f.iva, 0)
    };
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { GetFacturasUseCase, ValidationError };
