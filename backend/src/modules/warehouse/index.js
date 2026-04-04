/**
 * Warehouse Module - DDD Entry Point
 */
const { WarehouseStock, WarehouseMovement } = require('./domain/warehouse');
const { WarehouseRepository } = require('./domain/warehouse-repository');
const { Db2WarehouseRepository } = require('./infrastructure/db2-warehouse-repository');
const { GetStockUseCase } = require('./application/get-stock-usecase');
const { GetMovementsUseCase } = require('./application/get-movements-usecase');

module.exports = {
  WarehouseStock,
  WarehouseMovement,
  WarehouseRepository,
  Db2WarehouseRepository,
  GetStockUseCase,
  GetMovementsUseCase
};
