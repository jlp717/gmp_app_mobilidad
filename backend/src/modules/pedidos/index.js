/**
 * Pedidos Module - DDD Entry Point
 */
const { Product, OrderLine, Cart } = require('./domain/product');

module.exports = {
  Product,
  OrderLine,
  Cart
};
