/**
 * Warehouse Module - DDD Entry Point
 */
const { WarehouseStock, WarehouseMovement } = require('./domain/warehouse');
const { WarehouseRepository } = require('./domain/warehouse-repository');
const { Db2WarehouseRepository } = require('./infrastructure/db2-warehouse-repository');
const { GetStockUseCase } = require('./application/get-stock-usecase');
const { GetMovementsUseCase } = require('./application/get-movements-usecase');
const { GetLowStockUseCase } = require('./application/get-low-stock-usecase');
const { RegisterMovementUseCase } = require('./application/register-movement-usecase');

module.exports = {
  WarehouseStock,
  WarehouseMovement,
  WarehouseRepository,
  Db2WarehouseRepository,
  GetStockUseCase,
  GetMovementsUseCase,
  GetLowStockUseCase,
  RegisterMovementUseCase
};
