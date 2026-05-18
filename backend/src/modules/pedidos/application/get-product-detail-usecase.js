/**
 * Get Product Detail Use Case - Pedidos Domain
 */
const { UseCase } = require('../../../core/application/use-case');
const logger = require('../../../../middleware/logger');

class GetProductDetailUseCase extends UseCase {
  constructor(pedidosRepository) {
    super();
    this._pedidosRepository = pedidosRepository;
  }

  async execute({ code, clientCode, vendedorCodes }) {
    if (!code) {
      throw new Error('Product code is required');
    }

    logger.info({ usecase: 'GetProductDetailUseCase', code }, 'Fetching product detail');

    const product = await this._pedidosRepository.getProductDetail({
      code,
      clientCode,
      vendedorCodes
    });

    if (!product) {
      logger.warn({ usecase: 'GetProductDetailUseCase', code }, 'Product not found');
    }

    return product;
  }
}

module.exports = { GetProductDetailUseCase };
