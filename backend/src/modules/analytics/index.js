/**
 * Analytics Module - DDD Entry Point
 */
const { AnalyticsMetrics, GrowthRate, Prediction, TopPerformer } = require('./domain/analytics-metrics');
const { AnalyticsRepository } = require('./domain/analytics-repository');
const { Db2AnalyticsRepository } = require('./infrastructure/db2-analytics-repository');
const { GetAnalyticsUseCase } = require('./application/get-analytics-usecase');
const { GetForecastUseCase } = require('./application/get-forecast-usecase');
const { GetKpiDashboardUseCase } = require('./application/get-kpi-dashboard-usecase');

module.exports = {
  AnalyticsMetrics,
  GrowthRate,
  Prediction,
  TopPerformer,
  AnalyticsRepository,
  Db2AnalyticsRepository,
  GetAnalyticsUseCase,
  GetForecastUseCase,
  GetKpiDashboardUseCase
};
