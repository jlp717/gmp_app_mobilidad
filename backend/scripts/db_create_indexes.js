/**
 * GMP App - DB2 Index Creation Script
 * ===================================
 * Creates all necessary indexes for production performance
 * Run: node scripts/db_create_indexes.js
 */

'use strict';

const { getPool, initDb } = require('../config/db');
const logger = require('../middleware/logger');

const INDEXES_TO_CREATE = [
    // Dashboard & Metrics
    {
        name: 'IDX_VENTAS_VENDEDOR_FECHA',
        table: 'JAVIER.VENTAS',
        columns: 'VENDEDOR, FECHA',
        comment: 'Dashboard queries by vendor + date'
    },
    {
        name: 'IDX_VENTAS_CLIENTE_FECHA',
        table: 'JAVIER.VENTAS', 
        columns: 'CLIENTE, FECHA',
        comment: 'Client sales history'
    },
    {
        name: 'IDX_VENTAS_ARTICULO_FECHA',
        table: 'JAVIER.VENTAS',
        columns: 'ARTICULO, FECHA',
        comment: 'Product sales tracking'
    },
    // Cobros
    {
        name: 'IDX_COBROS_CLIENTE',
        table: 'JAVIER.COBROS',
        columns: 'CLIENTE',
        comment: 'Collections by client'
    },
    {
        name: 'IDX_COBROS_VENDEDOR_FECHA',
        table: 'JAVIER.COBROS',
        columns: 'VENDEDOR, FECHA',
        comment: 'Collections by vendor'
    },
    // Pedidos
    {
        name: 'IDX_PEDIDOS_CLIENTE',
        table: 'JAVIER.PEDIDOS_CAB',
        columns: 'CLIENTE',
        comment: 'Orders by client'
    },
    {
        name: 'IDX_PEDIDOS_VENDEDOR_FECHA',
        table: 'JAVIER.PEDIDOS_CAB',
        columns: 'VENDEDOR, FECHA',
        comment: 'Orders by vendor + date'
    },
    {
        name: 'IDX_PEDIDOS_ESTADO',
        table: 'JAVIER.PEDIDOS_CAB',
        columns: 'ESTADO',
        comment: 'Order status filtering'
    },
    // Rutero
    {
        name: 'IDX_RUTERO_VENDEDOR_DIA',
        table: 'JAVIER.RUTERO_CONFIG',
        columns: 'VENDEDOR, DIA',
        comment: 'Route planning by vendor + day'
    },
    {
        name: 'IDX_RUTERO_CLIENTE',
        table: 'JAVIER.RUTERO_CONFIG',
        columns: 'CLIENTE',
        comment: 'Route by client'
    },
    // Entregas
    {
        name: 'IDX_ENTREGAS_ALBARAN',
        table: 'JAVIER.ENTREGAS',
        columns: 'ALBARAN_SERIE, ALBARAN_NUMERO',
        comment: 'Delivery lookup by invoice'
    },
    {
        name: 'IDX_ENTREGAS_REPARTIDOR_FECHA',
        table: 'JAVIER.ENTREGAS',
        columns: 'REPARTIDOR, FECHA_ENTREGA',
        comment: 'Deliveries by repartidor'
    },
    // Commissions
    {
        name: 'IDX_COMMISSION_VENDEDOR_YEAR',
        table: 'JAVIER.COMMISSION_PAYMENTS',
        columns: 'VENDEDOR_CODIGO, ANIO',
        comment: 'Commission queries by vendor'
    },
    // LACLAE
    {
        name: 'IDX_LACLAE_VENDEDOR',
        table: 'JAVIER.LACLAE_VISITS',
        columns: 'VENDEDOR',
        comment: 'LACLAE by vendor'
    },
    {
        name: 'IDX_LACLAE_CLIENTE',
        table: 'JAVIER.LACLAE_VISITS',
        columns: 'CLIENTE',
        comment: 'LACLAE by client'
    },
];

async function createIndexes() {
    let pool;
    
    try {
        logger.info('🔄 Initializing DB connection...');
        await initDb();
        pool = getPool();
        
        if (!pool) {
            throw new Error('Failed to get DB pool');
        }
        
        logger.info(`✅ Connected to DB2, starting index creation...`);
        
        let created = 0;
        let skipped = 0;
        let errors = 0;
        
        for (const idx of INDEXES_TO_CREATE) {
            const sql = `CREATE INDEX ${idx.name} ON ${idx.table}(${idx.columns})`;
            
            try {
                const conn = await pool.connect();
                
                try {
                    await conn.query(sql);
                    logger.info(`✅ Created index: ${idx.name} on ${idx.table} (${idx.columns})`);
                    created++;
                } catch (err) {
                    if (err.message && (err.message.includes('SQL0601') || err.message.includes('duplicate'))) {
                        logger.info(`⏭️  Index exists: ${idx.name}`);
                        skipped++;
                    } else {
                        logger.warn(`⚠️  Error creating ${idx.name}: ${err.message}`);
                        errors++;
                    }
                } finally {
                    try { await conn.close(); } catch (_) {}
                }
            } catch (connErr) {
                logger.error(`❌ Connection error for ${idx.name}: ${connErr.message}`);
                errors++;
            }
        }
        
        logger.info('═'.repeat(50));
        logger.info(`📊 Index Creation Summary:`);
        logger.info(`   Created: ${created}`);
        logger.info(`   Skipped (already exists): ${skipped}`);
        logger.info(`   Errors: ${errors}`);
        logger.info('═'.repeat(50));
        
        if (errors > 0 && created === 0) {
            logger.error('❌ Critical errors - no indexes created');
            process.exit(1);
        }
        
        logger.info('✅ Index creation complete');
        process.exit(0);
        
    } catch (err) {
        logger.error(`❌ Fatal error: ${err.message}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    createIndexes();
}

module.exports = { createIndexes, INDEXES_TO_CREATE };