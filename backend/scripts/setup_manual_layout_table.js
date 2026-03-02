/**
 * Setup ALMACEN_CARGA_MANUAL table for persisting manual load planner layouts.
 * Run once: node backend/scripts/setup_manual_layout_table.js
 */

const { query } = require('../config/db');

async function setup() {
    console.log('Creating JAVIER.ALMACEN_CARGA_MANUAL table...');

    try {
        await query(`
            CREATE TABLE JAVIER.ALMACEN_CARGA_MANUAL (
                ID             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                CODIGOVEHICULO VARCHAR(10)    NOT NULL,
                FECHA_CARGA    DATE           NOT NULL,
                VENDEDOR       VARCHAR(10)    DEFAULT '',
                LAYOUT_JSON    CLOB(1M)       NOT NULL,
                METRICS_JSON   VARCHAR(4000)  DEFAULT '{}',
                CREATED_AT     TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
                UPDATED_AT     TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT UQ_MANUAL_LAYOUT UNIQUE (CODIGOVEHICULO, FECHA_CARGA)
            )
        `);
        console.log('Table created successfully.');
    } catch (err) {
        if (err.message && err.message.includes('already exists')) {
            console.log('Table already exists, skipping.');
        } else {
            console.error('Error creating table:', err.message);
            process.exit(1);
        }
    }

    process.exit(0);
}

setup();
