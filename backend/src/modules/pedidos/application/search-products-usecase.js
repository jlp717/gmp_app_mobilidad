/**
 * Search Products Use Case - Pedidos Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../../middleware/logger');

class SearchProductsUseCase extends UseCase {
  constructor(pedidosRepository) {
    super();
    this._pedidosRepository = pedidosRepository;
  }

  async execute({ vendedorCodes, clientCode, family, marca, search, limit, offset }) {
    if (!clientCode) {
      throw new Error('clientCode is required');
    }
    if (!vendedorCodes) {
      throw new Error('vendedorCodes is required');
    }

    logger.info({ usecase: 'SearchProductsUseCase', clientCode, vendedorCodes }, 'Searching products');

    const result = await this._pedidosRepository.searchProducts({
      vendedorCodes,
      clientCode,
      family,
      marca,
      search,
      limit: limit || 50,
      offset: offset || 0
    });

    logger.info({ usecase: 'SearchProductsUseCase', count: result.count }, 'Products search completed');

    return result;
  }
}

module.exports = { SearchProductsUseCase };
