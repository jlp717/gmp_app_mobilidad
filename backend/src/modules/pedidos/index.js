/**
 * Pedidos Module - DDD Entry Point
 */
const { Product, OrderLine, Cart } = require('./domain/product');
const { PedidosRepository } = require('./domain/pedidos-repository');
const { Db2PedidosRepository } = require('./infrastructure/db2-pedidos-repository');
const { SearchProductsUseCase } = require('./application/search-products-usecase');
const { ConfirmOrderUseCase, ConfirmOrderError } = require('./application/confirm-order-usecase');
const { GetProductDetailUseCase } = require('./application/get-product-detail-usecase');
const { GetPromotionsUseCase } = require('./application/get-promotions-usecase');
const { GetOrderHistoryUseCase } = require('./application/get-order-history-usecase');
const { GetOrderStatsUseCase } = require('./application/get-order-stats-usecase');

module.exports = {
  Product,
  OrderLine,
  Cart,
  PedidosRepository,
  Db2PedidosRepository,
  SearchProductsUseCase,
  ConfirmOrderUseCase,
  ConfirmOrderError,
  GetProductDetailUseCase,
  GetPromotionsUseCase,
  GetOrderHistoryUseCase,
  GetOrderStatsUseCase
};
