/**
 * Script de Reversión del Orden del Rutero
 * 
 * PROPÓSITO: 
 * Eliminar todas las configuraciones personalizadas de orden en JAVIER.RUTERO_CONFIG
 * para restaurar el orden original de los clientes en cada día.
 * 
 * Esto afecta especialmente al comercial ID 93 y cualquier otro afectado por
 * las pruebas recientes de reordenamiento y cambio de día.
 * 
 * USO:
 *   cd /opt/gmp-api/backend
 *   node scripts/revert_rutero_order.js [--vendor=93] [--dry-run]
 * 
 * OPCIONES:
 *   --vendor=XX   Solo revertir para el vendedor especificado
 *   --dry-run     Mostrar qué se eliminaría sin hacer cambios
 *   --all         Eliminar TODA la tabla RUTERO_CONFIG (reset completo)
 * 
 * NOTA: El orden original proviene de LACLAE (tabla base), no de RUTERO_CONFIG.
 *       Eliminar las entradas de RUTERO_CONFIG restaura el orden natural.
 */

const { getPool, query } = require('../config/db');
const logger = require('../middleware/logger');

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const deleteAll = args.includes('--all');
const vendorArg = args.find(a => a.startsWith('--vendor='));
const specificVendor = vendorArg ? vendorArg.split('=')[1] : null;

async function revertRuteroOrder() {
    console.log('='.repeat(60));
    console.log('SCRIPT DE REVERSIÓN DEL ORDEN DEL RUTERO');
    console.log('='.repeat(60));
    console.log(`Modo: ${isDryRun ? 'DRY-RUN (solo consulta, sin cambios)' : 'EJECUCIÓN REAL'}`);
    console.log(`Objetivo: ${deleteAll ? 'TODA la tabla' : (specificVendor ? `Vendedor ${specificVendor}` : 'Todos los vendedores con overrides')}`);
    console.log('');

    const pool = getPool();
    if (!pool) {
        console.error('❌ Error: No se pudo inicializar el pool de base de datos');
        process.exit(1);
    }

    let conn;
    try {
        conn = await pool.connect();

        // 1. Primero, verificar qué datos hay en la tabla
        console.log('📊 Analizando configuraciones actuales en JAVIER.RUTERO_CONFIG...\n');
        
        let analysisQuery = `
            SELECT 
                VENDEDOR,
                DIA,
                COUNT(*) as NUM_CLIENTES,
                MIN(ORDEN) as MIN_ORDEN,
                MAX(ORDEN) as MAX_ORDEN
            FROM JAVIER.RUTERO_CONFIG
        `;
        
        if (specificVendor) {
            analysisQuery += ` WHERE VENDEDOR = '${specificVendor}'`;
        }
        
        analysisQuery += ` GROUP BY VENDEDOR, DIA ORDER BY VENDEDOR, DIA`;

        const configStats = await conn.query(analysisQuery);

        if (configStats.length === 0) {
            console.log('✅ No hay configuraciones personalizadas en RUTERO_CONFIG.');
            console.log('   El rutero ya usa el orden original de LACLAE.');
            return;
        }

        console.log('📋 Configuraciones encontradas:\n');
        console.log('┌─────────────┬────────────┬─────────────┬───────────┬───────────┐');
        console.log('│ VENDEDOR    │ DÍA        │ CLIENTES    │ MIN ORDEN │ MAX ORDEN │');
        console.log('├─────────────┼────────────┼─────────────┼───────────┼───────────┤');
        
        let totalConfigs = 0;
        const vendedoresAfectados = new Set();
        
        configStats.forEach(row => {
            const vendedor = (row.VENDEDOR || '').toString().padEnd(11);
            const dia = (row.DIA || '').toString().padEnd(10);
            const numClientes = (row.NUM_CLIENTES || 0).toString().padStart(11);
            const minOrden = (row.MIN_ORDEN || 0).toString().padStart(9);
            const maxOrden = (row.MAX_ORDEN || 0).toString().padStart(9);
            
            console.log(`│ ${vendedor} │ ${dia} │ ${numClientes} │ ${minOrden} │ ${maxOrden} │`);
            totalConfigs += row.NUM_CLIENTES || 0;
            vendedoresAfectados.add(row.VENDEDOR);
        });
        
        console.log('└─────────────┴────────────┴─────────────┴───────────┴───────────┘');
        console.log(`\n📈 Total: ${totalConfigs} configuraciones de ${vendedoresAfectados.size} vendedor(es)`);

        // 2. Listar clientes específicos si es un vendedor concreto
        if (specificVendor) {
            console.log(`\n📝 Detalle de clientes afectados para vendedor ${specificVendor}:\n`);
            
            const clientDetails = await conn.query(`
                SELECT 
                    RC.CLIENTE,
                    RC.DIA,
                    RC.ORDEN,
                    COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as NOMBRE
                FROM JAVIER.RUTERO_CONFIG RC
                LEFT JOIN DSEDAC.CLI C ON RC.CLIENTE = C.CODIGOCLIENTE
                WHERE RC.VENDEDOR = '${specificVendor}'
                ORDER BY RC.DIA, RC.ORDEN
                FETCH FIRST 50 ROWS ONLY
            `);
            
            clientDetails.forEach((row, idx) => {
                if (idx < 20 || idx === clientDetails.length - 1) {
                    console.log(`  ${row.DIA?.padEnd(10)} | Pos ${String(row.ORDEN).padStart(3)} | ${row.CLIENTE} | ${(row.NOMBRE || 'Sin nombre').substring(0, 30)}`);
                } else if (idx === 20) {
                    console.log(`  ... (${clientDetails.length - 21} más)`);
                }
            });
        }

        // 3. Ejecutar la eliminación si no es dry-run
        if (!isDryRun) {
            console.log('\n⚠️  PROCEDIENDO A ELIMINAR CONFIGURACIONES...\n');
            
            await conn.beginTransaction();
            
            let deleteQuery = 'DELETE FROM JAVIER.RUTERO_CONFIG';
            if (specificVendor) {
                deleteQuery += ` WHERE VENDEDOR = '${specificVendor}'`;
            }
            
            await conn.query(deleteQuery);
            await conn.commit();
            
            console.log('✅ ÉXITO: Configuraciones eliminadas correctamente.');
            console.log('   El rutero ahora usa el orden original de LACLAE.');
            console.log('\n📌 NOTA: Es necesario reiniciar el servidor para refrescar la caché:');
            console.log('   pm2 restart gmp-api');
            
        } else {
            console.log('\n🔍 DRY-RUN: No se realizaron cambios.');
            console.log('   Ejecute sin --dry-run para aplicar la reversión.');
        }

    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        if (conn) {
            try { await conn.rollback(); } catch (e) { /* ignore */ }
        }
        process.exit(1);
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { /* ignore */ }
        }
    }
}

// Inicializar conexión y ejecutar
async function main() {
    try {
        // Esperar a que el pool esté listo
        const pool = getPool();
        if (!pool) {
            // El pool puede necesitar tiempo para inicializarse
            console.log('⏳ Esperando inicialización del pool de BD...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        await revertRuteroOrder();
        
    } catch (error) {
        console.error('Error fatal:', error);
        process.exit(1);
    }
    
    // Dar tiempo para que se cierren conexiones
    setTimeout(() => process.exit(0), 1000);
}

main();
