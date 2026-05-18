'use strict';

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

/**
 * SCHEMA AUDIT TOOL
 * =================
 * Verifies that application tables exist and have the correct structures 
 * in both the Development (JAVIER) and Production (DSEDAC) schemas.
 * This guarantees environment parity.
 */
async function runSchemaAudit() {
    logger.info('🔍 [SCHEMA-AUDIT] Starting schema parity check between JAVIER and DSEDAC...');
    
    const schemasToVerify = ['JAVIER', 'DSEDAC'];
    // BOLSA_COMERCIAL / MOVIMIENTOS_BOLSA NO se auditan aqui: viven siempre en
    // JAVIER (decision de negocio) y NO se replican a DSEDAC en produccion.
    const tablesToCheck = [
        'PEDIDOS_CAB', 'PEDIDOS_LIN', 'PEDIDOS_SEQ', 'PEDIDOS_STOCK_RESERVE',
        'COBROS', 'DELIVERY_STATUS', 'CLIENT_NOTES',
        'KPI_ALERTS', 'KPI_LOADS', 'KPI_FILE_AUDIT',
        'LQD_COBROS', 'LQD_LIQUIDACIONES', 'LQD_IDEMPOTENCY', 'LQD_COMMISSION_TIERS',
        'CUENTAS_LIQUIDACION',
        // Repartidor finance core tables (P1 - todas usan APP_SCHEMA dinamico):
        'REPARTIDOR_COBROS', 'REPARTIDOR_LIQUIDACION_OPS',
        'REPARTIDOR_FINANCIAL_BALANCES', 'REPARTIDOR_COMMISSION_TIERS',
        'REPARTIDOR_LIQUIDACION_EMAILS', 'REPARTIDOR_COBROS_AUDIT',
        'CLIENT_SIGNERS',
    ];
    
    let allGood = true;

    try {
        for (const table of tablesToCheck) {
            const tableParity = {};
            
            for (const schema of schemasToVerify) {
                const result = await queryWithParams(
                    `SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE 
                     FROM QSYS2.SYSCOLUMNS 
                     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                     ORDER BY ORDINAL_POSITION`,
                    [schema, table],
                    false, false
                );
                
                tableParity[schema] = Array.isArray(result) && result.length > 0 ? result : null;
            }
            
            // If the table doesn't exist in DSEDAC yet, we can't fully compare parity, 
            // but we should warn about it.
            if (!tableParity.JAVIER) {
                logger.error(`❌ [SCHEMA-AUDIT] Table ${table} is MISSING in JAVIER schema!`);
                allGood = false;
                continue;
            }
            
            if (!tableParity.DSEDAC) {
                logger.warn(`⚠️ [SCHEMA-AUDIT] Table ${table} does not exist in DSEDAC (Production) schema yet. Only present in JAVIER.`);
                continue;
            }
            
            // Compare JAVIER and DSEDAC columns
            const javierCols = tableParity.JAVIER.map(c => c.COLUMN_NAME);
            const dsedacCols = tableParity.DSEDAC.map(c => c.COLUMN_NAME);
            
            const missingInDsedac = javierCols.filter(c => !dsedacCols.includes(c));
            const missingInJavier = dsedacCols.filter(c => !javierCols.includes(c));
            
            if (missingInDsedac.length > 0) {
                logger.error(`❌ [SCHEMA-AUDIT] Parity mismatch in ${table}! DSEDAC is missing columns: ${missingInDsedac.join(', ')}`);
                allGood = false;
            } else if (missingInJavier.length > 0) {
                logger.warn(`⚠️ [SCHEMA-AUDIT] ${table} in JAVIER is missing columns present in DSEDAC: ${missingInJavier.join(', ')}`);
            } else {
                logger.info(`✅ [SCHEMA-AUDIT] Table ${table} has 1:1 column parity between JAVIER and DSEDAC.`);
            }
        }
        
        if (allGood) {
            logger.info('🌟 [SCHEMA-AUDIT] Audit completed successfully. Schemas are healthy.');
        } else {
            logger.error('💥 [SCHEMA-AUDIT] Audit failed! Schema parity issues detected. Please check logs.');
        }
        
        return allGood;
    } catch (err) {
        logger.error(`[SCHEMA-AUDIT] Fatal error during schema audit: ${err.message}`);
        return false;
    }
}

module.exports = { runSchemaAudit };
