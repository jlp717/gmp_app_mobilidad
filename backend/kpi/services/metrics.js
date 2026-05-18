// metrics.js: Métricas Prometheus y OpenTelemetry para el módulo KPI Glacius
'use strict';

const logger = require('../../middleware/logger');

// Métricas en memoria (compatible con Prometheus text format)
const metrics = {
  etl_runs_total: { type: 'counter', help: 'Total de ejecuciones ETL', value: 0 },
  etl_runs_failed: { type: 'counter', help: 'Ejecuciones ETL fallidas', value: 0 },
  etl_duration_seconds: { type: 'gauge', help: 'Duración última ejecución ETL (s)', value: 0 },
  etl_alerts_generated: { type: 'gauge', help: 'Alertas generadas en última ejecución', value: 0 },
  etl_files_processed: { type: 'gauge', help: 'Archivos procesados en última ejecución', value: 0 },
  api_requests_total: { type: 'counter', help: 'Total requests a API KPI', value: 0 },
  api_cache_hits: { type: 'counter', help: 'Cache hits Redis', value: 0 },
  api_cache_misses: { type: 'counter', help: 'Cache misses Redis', value: 0 },
  api_latency_ms: { type: 'gauge', help: 'Latencia última request API (ms)', value: 0 },
  csv_parse_errors: { type: 'counter', help: 'Errores de parsing CSV', value: 0 },
  active_alerts_total: { type: 'gauge', help: 'Total alertas activas', value: 0 },
  active_clients_total: { type: 'gauge', help: 'Clientes con alertas activas', value: 0 },
};

function incrementMetric(name, amount = 1) {
  if (metrics[name]) {
    metrics[name].value += amount;
  }
}

function setMetric(name, value) {
  if (metrics[name]) {
    metrics[name].value = value;
  }
}

/**
 * Genera output en formato Prometheus text exposition.
 */
function getPrometheusMetrics() {
  const lines = [];
  for (const [name, m] of Object.entries(metrics)) {
    const fullName = `kpi_glacius_${name}`;
    lines.push(`# HELP ${fullName} ${m.help}`);
    lines.push(`# TYPE ${fullName} ${m.type}`);
    lines.push(`${fullName} ${m.value}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Middleware Express para contabilizar requests a /api/kpi.
 */
function metricsMiddleware(req, res, next) {
  const start = Date.now();
  incrementMetric('api_requests_total');

  res.on('finish', () => {
    setMetric('api_latency_ms', Date.now() - start);
  });

  next();
}

/**
 * Registra resultado de una ejecución ETL en las métricas.
 */
function recordETLRun({ success, duration, alertsGenerated, filesProcessed }) {
  incrementMetric('etl_runs_total');
  if (!success) incrementMetric('etl_runs_failed');
  setMetric('etl_duration_seconds', duration / 1000);
  setMetric('etl_alerts_generated', alertsGenerated);
  setMetric('etl_files_processed', filesProcessed);
}

module.exports = {
  incrementMetric,
  setMetric,
  getPrometheusMetrics,
  metricsMiddleware,
  recordETLRun,
  metrics,
};
