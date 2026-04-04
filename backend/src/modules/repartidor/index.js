/**
 * Repartidor Module - DDD Entry Point
 */
const { DeliveryRoute, DeliveryItem } = require('./domain/delivery');
const { RepartidorRepository } = require('./domain/repartidor-repository');
const { Db2RepartidorRepository } = require('./infrastructure/db2-repartidor-repository');
const { GetDeliveryRoutesUseCase } = require('./application/get-delivery-routes-usecase');
const { GetDeliveryDetailUseCase } = require('./application/get-delivery-detail-usecase');
const { UpdateDeliveryStatusUseCase } = require('./application/update-delivery-status-usecase');

module.exports = {
  DeliveryRoute,
  DeliveryItem,
  RepartidorRepository,
  Db2RepartidorRepository,
  GetDeliveryRoutesUseCase,
  GetDeliveryDetailUseCase,
  UpdateDeliveryStatusUseCase
};
