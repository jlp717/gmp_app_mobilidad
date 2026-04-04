/**
 * KPI Alerts Module - DDD Entry Point
 */
const { KpiAlert } = require('./domain/kpi-alert');
const { KpiAlertRepository } = require('./domain/kpi-alert-repository');
const { Db2KpiAlertRepository } = require('./infrastructure/db2-kpi-alert-repository');
const { CheckKpiAlertsUseCase } = require('./application/check-kpi-alerts-usecase');
const { GetActiveAlertsUseCase } = require('./application/get-active-alerts-usecase');

module.exports = {
  KpiAlert,
  KpiAlertRepository,
  Db2KpiAlertRepository,
  CheckKpiAlertsUseCase,
  GetActiveAlertsUseCase
};
