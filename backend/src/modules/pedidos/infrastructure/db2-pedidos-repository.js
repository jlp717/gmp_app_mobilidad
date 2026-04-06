/**
 * Pedidos Repository Implementation - DB2
 * Wraps existing pedidos.service.js queries with DDD pattern
 */
const { PedidosRepository } = require('../domain/pedidos-repository');
const { Product } = require('../domain/product');
const { Db2ConnectionPool } = require('../../../core/infrastructure/database/db2-connection-pool');
const { getCurrentDate, VENDOR_COLUMN, LACLAE_SALES_FILTER, sanitizeCodeList } = require('../../../../utils/common');

class Db2PedidosRepository extends PedidosRepository {
  constructor(dbPool) {
    super();
    this._db = dbPool || new Db2ConnectionPool();
  }

  async searchProducts({ vendedorCodes, clientCode, family, marca, search, limit = 50, offset = 0 }) {
    // Delegate to legacy service which has tested SQL with proper client-based pricing
    const pedidosService = require('../../../../services/pedidos.service');
    const products = await pedidosService.getProducts({
      search,
      clientCode,
      family,
      marca,
      limit,
      offset
    });
    return { products, count: products.length };
  }

  async getProductDetail({ code, clientCode, vendedorCodes }) {
    // Delegate to legacy service which has tested SQL
    const pedidosService = require('../../../../services/pedidos.service');
    const product = await pedidosService.getProductDetail(code, clientCode);
    return product;
  }

  async getPromotions({ clientCode, vendedorCodes }) {
    // Delegate to legacy service which has correct field mapping and
    // queries both CPESL1 (price promos) and PMRL1/PMPL1 (gift promos)
    const pedidosService = require('../../../../services/pedidos.service');
    return await pedidosService.getActivePromotions(clientCode);
  }

  // NOTE: Cart methods (getCart, addToCart) are NOT implemented.
  // The Flutter app manages cart entirely in-memory via PedidosProvider._lines
  // These methods throw errors to prevent accidental usage
  
  async getCart(userId) {
    throw new Error('Cart is managed in Flutter state (PedidosProvider._lines). No server-side cart needed.');
  }

  async addToCart({ userId, clientCode, productCode, quantity, unit = 'UD' }) {
    throw new Error('Cart is managed in Flutter state (PedidosProvider._lines). Use POST /pedidos/create to submit order.');
  }

  /**
   * Confirm order with transactional integrity.
   * Wraps cabecera + all líneas inserts in a single transaction.
   * If any line insert fails, everything is rolled back.
   */
  async confirmOrder({ userId, clientCode, lines, observations = '' }) {
    const { v4: uuidv4 } = require('uuid');
    const orderId = uuidv4();
    const currentDate = getCurrentDate();
    const year = currentDate.substring(0, 4);

    return this._db.transaction(async (conn) => {
      const cabSql = `
        INSERT INTO JAVIER.PEDIDOS_CAB (
          ID, EJERCICIO, NUMEROPEDIDO, SERIEPEDIDO, CODIGOCLIENTE,
          FECHAPEDIDO, ESTADO, OBSERVACIONES, CODIGO_USUARIO, ORIGEN
        ) VALUES (?, ?, 1, 'M', ?, CURRENT_TIMESTAMP, 'CONFIRMADO', ?, ?, 'APP')
      `;

      await conn.query(cabSql, [orderId, year, clientCode, observations, userId]);

      for (const line of lines) {
        const lineId = uuidv4();
        const linSql = `
          INSERT INTO JAVIER.PEDIDOS_LIN (
            ID, PEDIDO_ID, CODIGOARTICULO, CANTIDAD, UNIDAD, PRECIO
          ) VALUES (?, ?, ?, ?, ?, ?)
        `;
        await conn.query(linSql, [
          lineId, orderId, line.productCode, line.quantity, line.unit || 'UD', line.unitPrice || 0
        ]);
      }

      return { orderId, status: 'CONFIRMADO', linesCount: lines.length };
    });
  }

  async getOrderHistory({ userId, limit = 20, offset = 0, estado = undefined }) {
    // Delegate to legacy service which has correct SQL
    const pedidosService = require('../../../../services/pedidos.service');
    return await pedidosService.getOrders({
      vendedorCode: userId,
      limit,
      offset,
      estado
    });
  }

  async getOrderStats({ userId }) {
    const sql = `
      SELECT
        COUNT(*) as TOTAL,
        SUM(CASE WHEN ESTADO = 'BORRADOR' THEN 1 ELSE 0 END) as BORRADORES,
        SUM(CASE WHEN ESTADO = 'CONFIRMADO' THEN 1 ELSE 0 END) as CONFIRMADOS,
        SUM(CASE WHEN ESTADO = 'ENVIADO' THEN 1 ELSE 0 END) as ENVIADOS,
        SUM(CASE WHEN ESTADO = 'ANULADO' THEN 1 ELSE 0 END) as ANULADOS
      FROM JAVIER.PEDIDOS_CAB
      WHERE CODIGOVENDEDOR = ?
    `;

    const result = await this._db.executeParams(sql, [userId]);
    return result[0] || {};
  }

  // =============================================================================
  // ADDITIONAL METHODS (needed by DDD adapter endpoints)
  // =============================================================================

  async getOrderById(orderId) {
    const pedidosService = require('../../../../services/pedidos.service');
    return await pedidosService.getOrderDetail(parseInt(orderId));
  }

  async createOrder({ userId, clientCode, lines, observations = '' }) {
    const pedidosService = require('../../../../services/pedidos.service');
    return await pedidosService.createOrder({
      clientCode: clientCode,
      clientName: '', // Will be auto-filled by service from DB
      vendedorCode: userId,
      tipoventa: 'CC',
      almacen: 1,
      tarifa: 1,
      observaciones: observations,
      lines: lines,
      origen: 'A'
    });
  }

  async confirmOrderById({ orderId, userId }) {
    const pedidosService = require('../../../../services/pedidos.service');
    return await pedidosService.confirmOrder(parseInt(orderId));
  }

  async updateOrderStatus({ orderId, estado, userId }) {
    const pedidosService = require('../../../../services/pedidos.service');
    return await pedidosService.updateOrderStatus(parseInt(orderId), estado);
  }

  async deleteOrder({ orderId, userId }) {
    const pedidosService = require('../../../../services/pedidos.service');
    return await pedidosService.cancelOrder(parseInt(orderId));
  }
}

module.exports = { Db2PedidosRepository };
