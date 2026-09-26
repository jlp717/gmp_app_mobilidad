// migrate.js: Runner de migraciones PostgreSQL — ejecuta up/down de forma atómica
'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const logger = require('../../middleware/logger');

const pool = new Pool({
  connectionString: process.env.KPI_DATABASE_URL || 'postgresql://kpi_user:kpi_pass@localhost:5432/kpi_glacius',
  ssl: process.env.KPI_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS kpi_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT name FROM kpi_migrations ORDER BY id');
  return new Set(rows.map((r) => r.name));
}

async function run(direction = 'up') {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    const files = fs.readdirSync(__dirname)
      .filter((f) => f.match(/^\d{3}_.*\.js$/) && f !== 'migrate.js')
      .sort();

    if (direction === 'up') {
      for (const file of files) {
        if (applied.has(file)) {
          logger.info(`[skip] ${file} ya aplicada`);
          continue;
        }
        const migration = require(path.join(__dirname, file));
        await client.query('BEGIN');
        try {
          await migration.up(client);
          await client.query('INSERT INTO kpi_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          logger.info(`[ok]   ${file} aplicada`);
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error(`[fail] ${file}: ${err.message}`);
          throw err;
        }
      }
    } else if (direction === 'down') {
      for (const file of files.reverse()) {
        if (!applied.has(file)) continue;
        const migration = require(path.join(__dirname, file));
        await client.query('BEGIN');
        try {
          await migration.down(client);
          await client.query('DELETE FROM kpi_migrations WHERE name = $1', [file]);
          await client.query('COMMIT');
          logger.info(`[ok]   ${file} revertida`);
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error(`[fail] ${file}: ${err.message}`);
          throw err;
        }
      }
    }

    logger.info(`Migraciones ${direction} completadas.`);
  } finally {
    client.release();
    await pool.end();
  }
}

const direction = process.argv[2] || 'up';
run(direction).catch((err) => {
  logger.error('Error en migración:', err);
  process.exit(1);
});
