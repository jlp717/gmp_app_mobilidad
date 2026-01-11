/**
 * SCRIPT: EXPLORAR COBROS PENDIENTES
 * Consulta DSEDAC.CAC y DSEDAC.CVC para listar cobros pendientes por cliente
 * Genera salida en console.table y opcionalmente CSV
 * 
 * Uso: node scripts/cobros/explore_cobros_pendientes.js [CODIGO_CLIENTE]
 * Ejemplo: node scripts/cobros/explore_cobros_pendientes.js 9900
 */

const odbc = require('odbc');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Configuración ODBC desde variables de entorno o valores por defecto
const DB_CONFIG = `DSN=GMP;UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

/**
 * Obtiene cobros pendientes de un cliente
 */
async function obtenerCobrosPendientes(codigoCliente) {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     EXPLORADOR DE COBROS PENDIENTES                          ║');
    console.log('║     Consulta DSEDAC.CAC + DSEDAC.CVC                         ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        // Query principal: cobros pendientes con JOIN a CVC
        const query = `
            SELECT
                CAC.SUBEMPRESAALBARAN,
                CAC.EJERCICIOALBARAN,
                CAC.SERIEALBARAN,
                CAC.TERMINALALBARAN,
                CAC.NUMEROALBARAN,
                CAC.NUMEROFACTURA,
                CAC.SERIEFACTURA,
                CAC.ANODOCUMENTO,
                CAC.MESDOCUMENTO,
                CAC.DIADOCUMENTO,
                CAC.IMPORTETOTAL,
                COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) as IMPORTE_PENDIENTE,
                CAC.CODIGOTIPOALBARAN,
                CAC.CODIGOFORMAPAGO
            FROM DSEDAC.CAC
            LEFT JOIN DSEDAC.CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
                AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
            WHERE TRIM(CAC.CODIGOCLIENTEFACTURA) = ?
                AND COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) > 0
            ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC, CAC.DIADOCUMENTO DESC
            FETCH FIRST 100 ROWS ONLY
        `;

        console.log(`🔍 Buscando cobros pendientes para cliente: ${codigoCliente}\n`);
        
        const resultado = await conn.query(query, [codigoCliente.trim().toUpperCase()]);
        
        if (resultado.length === 0) {
            console.log('✅ No se encontraron cobros pendientes para este cliente.\n');
            return [];
        }

        // Procesar resultados
        const cobros = resultado.map(row => ({
            Tipo: Number(row.NUMEROFACTURA) > 0 ? 'FACTURA' : 'ALBARÁN',
            Referencia: Number(row.NUMEROFACTURA) > 0 
                ? `${row.SERIEFACTURA}-${row.NUMEROFACTURA}` 
                : `ALB-${row.NUMEROALBARAN}`,
            Fecha: `${String(row.DIADOCUMENTO).padStart(2, '0')}/${String(row.MESDOCUMENTO).padStart(2, '0')}/${row.ANODOCUMENTO}`,
            ImporteTotal: parseFloat(row.IMPORTETOTAL || 0).toFixed(2),
            ImportePendiente: parseFloat(row.IMPORTE_PENDIENTE || 0).toFixed(2),
            FormaPago: row.CODIGOFORMAPAGO || 'N/A',
            Ejercicio: row.EJERCICIOALBARAN
        }));

        // Mostrar tabla
        console.log('📋 COBROS PENDIENTES:\n');
        console.table(cobros);

        // Resumen
        const totalPendiente = cobros.reduce((sum, c) => sum + parseFloat(c.ImportePendiente), 0);
        const totalAlbaranes = cobros.filter(c => c.Tipo === 'ALBARÁN').length;
        const totalFacturas = cobros.filter(c => c.Tipo === 'FACTURA').length;

        console.log('\n📊 RESUMEN:');
        console.log(`   Total documentos: ${cobros.length}`);
        console.log(`   Albaranes: ${totalAlbaranes}`);
        console.log(`   Facturas: ${totalFacturas}`);
        console.log(`   Total pendiente: ${totalPendiente.toFixed(2)} €\n`);

        return cobros;

    } catch (error) {
        console.error('❌ Error consultando cobros pendientes:', error.message);
        throw error;
    } finally {
        await conn.close();
    }
}

/**
 * Exporta resultados a CSV
 */
function exportarCSV(cobros, codigoCliente) {
    if (cobros.length === 0) return;

    const filename = `cobros_pendientes_${codigoCliente}_${Date.now()}.csv`;
    const filepath = path.join(__dirname, '../../', filename);
    
    const headers = Object.keys(cobros[0]).join(';');
    const rows = cobros.map(c => Object.values(c).join(';'));
    const csv = [headers, ...rows].join('\n');

    fs.writeFileSync(filepath, csv, 'utf8');
    console.log(`📁 CSV exportado: ${filepath}\n`);
}

/**
 * Listar todos los clientes con cobros pendientes (sin filtro)
 */
async function listarTodosLosPendientes() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     RESUMEN DE TODOS LOS COBROS PENDIENTES                   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        const query = `
            SELECT
                CAC.CODIGOCLIENTEFACTURA as CLIENTE,
                COUNT(*) as NUM_DOCUMENTOS,
                SUM(COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL)) as TOTAL_PENDIENTE
            FROM DSEDAC.CAC
            LEFT JOIN DSEDAC.CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
                AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
            WHERE COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) > 0
                AND CAC.ANODOCUMENTO >= 2024
            GROUP BY CAC.CODIGOCLIENTEFACTURA
            ORDER BY TOTAL_PENDIENTE DESC
            FETCH FIRST 50 ROWS ONLY
        `;

        const resultado = await conn.query(query);

        const resumen = resultado.map(row => ({
            Cliente: String(row.CLIENTE).trim(),
            NumDocumentos: row.NUM_DOCUMENTOS,
            TotalPendiente: parseFloat(row.TOTAL_PENDIENTE || 0).toFixed(2) + ' €'
        }));

        console.log('📋 TOP 50 CLIENTES CON MÁS COBROS PENDIENTES:\n');
        console.table(resumen);

        return resumen;

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await conn.close();
    }
}

// Ejecución principal
async function main() {
    const args = process.argv.slice(2);
    const codigoCliente = args[0];
    const exportar = args.includes('--csv');

    try {
        if (codigoCliente && !codigoCliente.startsWith('--')) {
            const cobros = await obtenerCobrosPendientes(codigoCliente);
            if (exportar) {
                exportarCSV(cobros, codigoCliente);
            }
        } else {
            await listarTodosLosPendientes();
        }
    } catch (error) {
        console.error('Error en ejecución:', error);
        process.exit(1);
    }
}

main();
