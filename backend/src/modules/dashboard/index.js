/**
 * Dashboard Module - DDD Entry Point
 */
const { DashboardMetrics, SalesEvolutionPoint, TopClient, TopProduct } = require('./domain/dashboard-metrics');
const { DashboardRepository } = require('./domain/dashboard-repository');
const { Db2DashboardRepository } = require('./infrastructure/db2-dashboard-repository');
const { GetMetricsUseCase } = require('./application/get-metrics-usecase');
const { GetSalesEvolutionUseCase } = require('./application/get-sales-evolution-usecase');
const { GetTopClientsUseCase } = require('./application/get-top-clients-usecase');
const { GetTopProductsUseCase } = require('./application/get-top-products-usecase');
const { GetRecentSalesUseCase } = require('./application/get-recent-sales-usecase');
const { GetYoYComparisonUseCase } = require('./application/get-yoy-comparison-usecase');
const { GetHierarchyDataUseCase } = require('./application/get-hierarchy-data-usecase');
const { GetClientConditionsUseCase } = require('./application/get-client-conditions-usecase');

module.exports = {
  DashboardMetrics,
  SalesEvolutionPoint,
  TopClient,
  TopProduct,
  DashboardRepository,
  Db2DashboardRepository,
  GetMetricsUseCase,
  GetSalesEvolutionUseCase,
  GetTopClientsUseCase,
  GetTopProductsUseCase,
  GetRecentSalesUseCase,
  GetYoYComparisonUseCase,
  GetHierarchyDataUseCase,
  GetClientConditionsUseCase
};
