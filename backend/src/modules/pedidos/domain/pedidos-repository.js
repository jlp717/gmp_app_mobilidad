/**
 * Pedidos Repository Interface
 */
const { Repository } = require('../../../core/domain/repository');

class PedidosRepository extends Repository {
  async searchProducts({ vendedorCodes, clientCode, family, marca, search, limit, offset }) {
    throw new Error('Method not implemented: searchProducts');
  }

  async getProductDetail({ code, clientCode, vendedorCodes }) {
    throw new Error('Method not implemented: getProductDetail');
  }

  async getPromotions({ clientCode, vendedorCodes }) {
    throw new Error('Method not implemented: getPromotions');
  }

  async getCart(userId) {
    throw new Error('Method not implemented: getCart');
  }

  async addToCart({ userId, clientCode, productCode, quantity, unit }) {
    throw new Error('Method not implemented: addToCart');
  }

  async confirmOrder({ userId, clientCode, lines, observations }) {
    throw new Error('Method not implemented: confirmOrder');
  }

  async getOrderHistory({ userId, limit, offset }) {
    throw new Error('Method not implemented: getOrderHistory');
  }

  async getOrderStats({ userId }) {
    throw new Error('Method not implemented: getOrderStats');
  }
}

module.exports = { PedidosRepository };
