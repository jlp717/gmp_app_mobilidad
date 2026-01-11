/**
 * SCRIPT: EXPLORAR CLIENTES MOROSOS ("EN ROJO")
 * Detecta clientes que superan límite de crédito o tienen mora > N días
 * 
 * Reglas de moroso:
 * 1. Importe pendiente > límite de crédito del cliente
 * 2. Días de mora > DIAS_MORA_LIMITE (por defecto 30)
 * 
 * Uso: node scripts/cobros/explore_clientes_morosos.js [--dias=30] [--csv]
 */

const odbc = require('odbc');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const DB_CONFIG = `DSN=GMP;UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

// Configuración por defecto
const DIAS_MORA_LIMITE = 30;

async function explorarClientesMorosos(diasMoraLimite = DIAS_MORA_LIMITE) {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     DETECTOR DE CLIENTES MOROSOS ("EN ROJO")                 ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    console.log(`📊 Parámetros:`);
    console.log(`   - Días mora límite: ${diasMoraLimite}`);
    console.log('');

    const conn = await odbc.connect(DB_CONFIG);

    try {
        // Query para detectar morosos
        // Combina información de cliente (CLI) con cobros pendientes (CAC/CVC)
        const query = `
            SELECT
                CLI.CODCLI as CODIGO_CLIENTE,
                TRIM(CLI.NOMCLI) as NOMBRE_CLIENTE,
                COALESCE(CLI.LIMCRECLI, 0) as LIMITE_CREDITO,
                COALESCE(PEND.TOTAL_PENDIENTE, 0) as TOTAL_PENDIENTE,
                COALESCE(PEND.NUM_DOCUMENTOS, 0) as NUM_DOCUMENTOS,
                PEND.FECHA_MAS_ANTIGUA,
                CASE 
                    WHEN PEND.TOTAL_PENDIENTE > COALESCE(CLI.LIMCRECLI, 0) AND CLI.LIMCRECLI > 0 
                    THEN 'EXCEDE_LIMITE'
                    WHEN PEND.DIAS_MORA > ${diasMoraLimite}
                    THEN 'MORA_EXCESIVA'
                    ELSE 'OK'
                END as ESTADO,
                COALESCE(PEND.DIAS_MORA, 0) as DIAS_MORA
            FROM DSEDAC.CLI CLI
            INNER JOIN (
                SELECT
                    CAC.CODIGOCLIENTEFACTURA as CLIENTE,
                    SUM(COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL)) as TOTAL_PENDIENTE,
                    COUNT(*) as NUM_DOCUMENTOS,
                    MIN(CAC.ANODOCUMENTO * 10000 + CAC.MESDOCUMENTO * 100 + CAC.DIADOCUMENTO) as FECHA_MAS_ANTIGUA,
                    DAYS(CURRENT_DATE) - DAYS(
                        DATE(
                            MIN(CAC.ANODOCUMENTO) || '-' ||
                            LPAD(CAST(MIN(CAC.MESDOCUMENTO) AS VARCHAR(2)), 2, '0') || '-' ||
                            LPAD(CAST(MIN(CAC.DIADOCUMENTO) AS VARCHAR(2)), 2, '0')
                        )
                    ) as DIAS_MORA
                FROM DSEDAC.CAC
                LEFT JOIN DSEDAC.CVC 
                    ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
                    AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
                    AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
                    AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
                WHERE COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) > 0
                GROUP BY CAC.CODIGOCLIENTEFACTURA
            ) PEND ON TRIM(CLI.CODCLI) = TRIM(PEND.CLIENTE)
            WHERE (
                PEND.TOTAL_PENDIENTE > COALESCE(CLI.LIMCRECLI, 0) AND CLI.LIMCRECLI > 0
            ) OR (
                PEND.DIAS_MORA > ${diasMoraLimite}
            )
            ORDER BY PEND.TOTAL_PENDIENTE DESC
            FETCH FIRST 100 ROWS ONLY
        `;

        console.log('🔍 Buscando clientes morosos...\n');

        let morosos = [];

        try {
            morosos = await conn.query(query);
        } catch (queryError) {
            // Si la query compleja falla, intentamos una versión simplificada
            console.log('⚠️  Query compleja falló, intentando versión simplificada...\n');

            const querySimple = `
                SELECT
                    CAC.CODIGOCLIENTEFACTURA as CODIGO_CLIENTE,
                    COUNT(*) as NUM_DOCUMENTOS,
                    SUM(COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL)) as TOTAL_PENDIENTE,
                    MIN(CAC.ANODOCUMENTO) as ANO_MAS_ANTIGUO,
                    MIN(CAC.MESDOCUMENTO) as MES_MAS_ANTIGUO
                FROM DSEDAC.CAC
                LEFT JOIN DSEDAC.CVC 
                    ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
                    AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
                    AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
                    AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
                WHERE COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) > 0
                    AND CAC.ANODOCUMENTO <= YEAR(CURRENT_DATE) - 1
                GROUP BY CAC.CODIGOCLIENTEFACTURA
                HAVING SUM(COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL)) > 1000
                ORDER BY TOTAL_PENDIENTE DESC
                FETCH FIRST 50 ROWS ONLY
            `;

            morosos = await conn.query(querySimple);

            // Añadir campos faltantes
            morosos = morosos.map(m => ({
                ...m,
                NOMBRE_CLIENTE: 'N/A',
                LIMITE_CREDITO: 0,
                ESTADO: 'MORA_ANTIGUA',
                DIAS_MORA: 365
            }));
        }

        if (morosos.length === 0) {
            console.log('✅ No se encontraron clientes morosos según los criterios.\n');
            return [];
        }

        // Formatear resultados
        const resultados = morosos.map(row => ({
            Codigo: String(row.CODIGO_CLIENTE).trim(),
            Nombre: String(row.NOMBRE_CLIENTE || 'N/A').trim().substring(0, 30),
            LimiteCredito: parseFloat(row.LIMITE_CREDITO || 0).toFixed(2) + ' €',
            TotalPendiente: parseFloat(row.TOTAL_PENDIENTE || 0).toFixed(2) + ' €',
            NumDocs: row.NUM_DOCUMENTOS || 0,
            DiasMora: row.DIAS_MORA || 0,
            Estado: row.ESTADO || 'MOROSO'
        }));

        console.log('🔴 CLIENTES MOROSOS DETECTADOS:\n');
        console.table(resultados);

        // Estadísticas
        const excedenLimite = resultados.filter(r => r.Estado === 'EXCEDE_LIMITE').length;
        const moraExcesiva = resultados.filter(r => r.Estado === 'MORA_EXCESIVA').length;
        const totalDeuda = morosos.reduce((sum, m) => sum + parseFloat(m.TOTAL_PENDIENTE || 0), 0);

        console.log('\n📊 ESTADÍSTICAS:');
        console.log(`   Clientes que exceden límite: ${excedenLimite}`);
        console.log(`   Clientes con mora > ${diasMoraLimite} días: ${moraExcesiva}`);
        console.log(`   Total morosos: ${resultados.length}`);
        console.log(`   Deuda total morosos: ${totalDeuda.toFixed(2)} €\n`);

        // Clasificación por riesgo
        console.log('⚠️  CLASIFICACIÓN POR RIESGO:');

        const altoRiesgo = resultados.filter(r =>
            parseFloat(r.TotalPendiente) > 5000 || r.DiasMora > 90
        );
        const medioRiesgo = resultados.filter(r =>
            parseFloat(r.TotalPendiente) > 1000 && parseFloat(r.TotalPendiente) <= 5000
        );

        if (altoRiesgo.length > 0) {
            console.log(`   🔴 ALTO RIESGO (>5000€ o >90 días): ${altoRiesgo.length} clientes`);
            altoRiesgo.slice(0, 5).forEach(c => {
                console.log(`      - ${c.Codigo}: ${c.TotalPendiente} (${c.DiasMora} días)`);
            });
        }

        if (medioRiesgo.length > 0) {
            console.log(`   🟡 MEDIO RIESGO (1000-5000€): ${medioRiesgo.length} clientes`);
        }

        return resultados;

    } catch (error) {
        console.error('❌ Error detectando morosos:', error.message);
        throw error;
    } finally {
        await conn.close();
    }
}

/**
 * Exportar a CSV
 */
function exportarCSV(morosos) {
    if (morosos.length === 0) return;

    const filename = `clientes_morosos_${Date.now()}.csv`;
    const filepath = path.join(__dirname, '../../', filename);

    const headers = Object.keys(morosos[0]).join(';');
    const rows = morosos.map(m => Object.values(m).join(';'));
    const csv = [headers, ...rows].join('\n');

    fs.writeFileSync(filepath, csv, 'utf8');
    console.log(`\n📁 CSV exportado: ${filepath}`);
}

// Ejecución principal
async function main() {
    const args = process.argv.slice(2);

    // Parsear argumentos
    let diasMora = DIAS_MORA_LIMITE;
    let exportar = false;

    args.forEach(arg => {
        if (arg.startsWith('--dias=')) {
            diasMora = parseInt(arg.split('=')[1]) || DIAS_MORA_LIMITE;
        }
        if (arg === '--csv') {
            exportar = true;
        }
    });

    try {
        const morosos = await explorarClientesMorosos(diasMora);
        if (exportar) {
            exportarCSV(morosos);
        }
    } catch (error) {
        console.error('Error en ejecución:', error);
        process.exit(1);
    }
}

main();
