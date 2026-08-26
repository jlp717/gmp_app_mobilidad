'use strict';
/**
 * OpenTelemetry bootstrap for GMP backend.
 * - Auto-instrumentation (http/express) via NodeSDK when deps are installed.
 * - Manual spans around DB2 ODBC queries (ODBC is NOT auto-instrumented).
 * - OTLP export to OTEL_EXPORTER_OTLP_ENDPOINT (default localhost:4318).
 *
 * Fully guarded: if @opentelemetry/* is not installed or OTEL_ENABLED!=='true',
 * every export degrades to a no-op so the API never breaks on deploy day.
 */

const ENABLED = process.env.OTEL_ENABLED === 'true';

let tracer = null;
let started = false;

if (ENABLED) {
  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
    const { Resource } = require('@opentelemetry/resources');
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'gmp-api',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      }),
      traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
      }),
      instrumentations: [getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      })],
    });
    sdk.start();
    started = true;
    tracer = require('@opentelemetry/api').trace.getTracer('gmp-db2', '1.0.0');
  } catch (err) {
    // ponytail: silent no-op without otel deps. upgrade: npm install + OTEL_ENABLED=true on .230.
    process.stderr.write(JSON.stringify({ service: 'gmp-api', msg: 'otel disabled: ' + err.message, levelLabel: 'warn' }) + String.fromCharCode(10));
  }
}

/**
 * Wrap an async DB2 operation in a span.
 * attrs.statement must be pre-trimmed and MUST NOT contain parameter values.
 */
async function withDbSpan(statement, fn) {
  if (!tracer) return fn();
  return tracer.startActiveSpan('db2.query', async (span) => {
    span.setAttribute('db.system', 'db2');
    span.setAttribute('db.statement', String(statement || '').replace(/\s+/g, ' ').slice(0, 200));
    try {
      const result = await fn(span);
      if (result && Array.isArray(result.rows)) {
        span.setAttribute('db.rows_affected', result.rows.length);
      }
      span.end();
      return result;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: 2, message: err.message }); // 2 = ERROR
      span.end();
      throw err;
    }
  });
}

module.exports = { withDbSpan, isStarted: () => started };
