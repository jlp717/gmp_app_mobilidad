/**
 * Facturas Module - DDD Entry Point
 */
const { Factura } = require('./domain/factura');
const { FacturasRepository } = require('./domain/facturas-repository');
const { Db2FacturasRepository } = require('./infrastructure/db2-facturas-repository');
const { GetFacturasUseCase } = require('./application/get-facturas-usecase');
const { GetFacturaDetailUseCase } = require('./application/get-factura-detail-usecase');
const { GetFacturaSummaryUseCase } = require('./application/get-factura-summary-usecase');

module.exports = {
  Factura,
  FacturasRepository,
  Db2FacturasRepository,
  GetFacturasUseCase,
  GetFacturaDetailUseCase,
  GetFacturaSummaryUseCase
};
