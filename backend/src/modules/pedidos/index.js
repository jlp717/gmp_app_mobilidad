/**
 * Pedidos Module - DDD Entry Point
 */
const { Product, OrderLine, Cart } = require('./domain/product');
const { PedidosRepository } = require('./domain/pedidos-repository');
const { Db2PedidosRepository } = require('./infrastructure/db2-pedidos-repository');

module.exports = {
  Product,
  OrderLine,
  Cart,
  PedidosRepository,
  Db2PedidosRepository
};
