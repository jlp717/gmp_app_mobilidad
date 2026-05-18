// 001_initial_schema.js: Migración inicial — crea tablas kpi_loads, kpi_alerts, kpi_file_audit
'use strict';

const fs = require('fs');
const path = require('path');

exports.up = async (pgClient) => {
  const schemaSQL = fs.readFileSync(
    path.join(__dirname, '..', 'schema.sql'),
    'utf8'
  );
  await pgClient.query(schemaSQL);
  console.log('[migration:001] Schema KPI creado correctamente.');
};

exports.down = async (pgClient) => {
  await pgClient.query(`
    DROP MATERIALIZED VIEW IF EXISTS kpi_alerts_active CASCADE;
    DROP TABLE IF EXISTS kpi_file_audit CASCADE;
    DROP TABLE IF EXISTS kpi_alerts CASCADE;
    DROP TABLE IF EXISTS kpi_loads CASCADE;
  `);
  console.log('[migration:001] Schema KPI eliminado.');
};
