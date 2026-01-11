/**
 * SCRIPT: EXPLORAR CLIENTES CON CTR PENDIENTE
 * Detecta clientes con Contra Reembolso (CTR) pendiente de cobro
 * 
 * Uso: node scripts/cobros/explore_clientes_ctr.js
 */

const odbc = require('odbc');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const DB_CONFIG = `DSN=GMP;UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

// Códigos de forma de pago que representan Contra Reembolso
// Ajustar según la configuración de tu empresa
const CODIGOS_CTR = ['CTR', 'CR', 'CONTRAREEM', 'REEMBOLSO', '03', '3'];

async function explorarClientesCTR() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     CLIENTES CON CONTRA REEMBOLSO (CTR) PENDIENTE            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const conn = await odbc.connect(DB_CONFIG);

    try {
        // Primero, exploramos los códigos de forma de pago existentes
        console.log('🔍 Explorando códigos de forma de pago...\n');

        const formasPago = await conn.query(`
            SELECT DISTINCT 
                CAC.CODIGOFORMAPAGO,
                COUNT(*) as CANTIDAD
            FROM DSEDAC.CAC
            WHERE CAC.ANODOCUMENTO >= 2024
            GROUP BY CAC.CODIGOFORMAPAGO
            ORDER BY CANTIDAD DESC
            FETCH FIRST 20 ROWS ONLY
        `);

        console.log('📋 Formas de pago encontradas:');
        console.table(formasPago.map(f => ({
            Codigo: String(f.CODIGOFORMAPAGO || '').trim() || '(vacío)',
            Cantidad: f.CANTIDAD
        })));

        // Buscar CTR pendientes
        console.log('\n🔍 Buscando albaranes CTR pendientes de cobro...\n');

        // Construir condición para CTR (buscamos cualquier código que contenga "CTR" o similares)
        const queryCtPendientes = `
            SELECT
                CAC.CODIGOCLIENTEFACTURA as CLIENTE,
                CAC.NUMEROALBARAN,
                CAC.NUMEROFACTURA,
                CAC.SERIEFACTURA,
                CAC.ANODOCUMENTO,
                CAC.MESDOCUMENTO,
                CAC.DIADOCUMENTO,
                CAC.IMPORTETOTAL,
                COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) as IMPORTE_PENDIENTE,
                CAC.CODIGOFORMAPAGO
            FROM DSEDAC.CAC
            LEFT JOIN DSEDAC.CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CAC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CAC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CAC.SERIEFACTURA
                AND CVC.NUMERODOCUMENTO = CAC.NUMEROFACTURA
            WHERE (
                UPPER(TRIM(CAC.CODIGOFORMAPAGO)) LIKE '%CTR%'
                OR UPPER(TRIM(CAC.CODIGOFORMAPAGO)) LIKE '%REEMB%'
                OR UPPER(TRIM(CAC.CODIGOFORMAPAGO)) LIKE '%CONTRA%'
                OR TRIM(CAC.CODIGOFORMAPAGO) IN ('03', '3')
            )
            AND COALESCE(CVC.IMPORTEPENDIENTE, CAC.IMPORTETOTAL) > 0
            AND CAC.ANODOCUMENTO >= 2024
            ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC, CAC.DIADOCUMENTO DESC
            FETCH FIRST 100 ROWS ONLY
        `;

        const ctrPendientes = await conn.query(queryCtPendientes);

        if (ctrPendientes.length === 0) {
            console.log('✅ No se encontraron CTR pendientes de cobro.\n');

            // Intentar búsqueda alternativa por código específico
            console.log('🔄 Intentando búsqueda alternativa...');
            const alternativa = await conn.query(`
                SELECT COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE CAC.ANODOCUMENTO >= 2024
                    AND COALESCE(CAC.IMPORTETOTAL, 0) > 0
            `);
            console.log(`   Total albaranes 2024+: ${alternativa[0]?.TOTAL || 0}`);
            return [];
        }

        const resultados = ctrPendientes.map(row => ({
            Cliente: String(row.CLIENTE).trim(),
            Referencia: Number(row.NUMEROFACTURA) > 0
                ? `FAC ${row.SERIEFACTURA}-${row.NUMEROFACTURA}`
                : `ALB ${row.NUMEROALBARAN}`,
            Fecha: `${String(row.DIADOCUMENTO).padStart(2, '0')}/${String(row.MESDOCUMENTO).padStart(2, '0')}/${row.ANODOCUMENTO}`,
            Importe: parseFloat(row.IMPORTE_PENDIENTE || 0).toFixed(2) + ' €',
            FormaPago: String(row.CODIGOFORMAPAGO || '').trim()
        }));

        console.log('📋 CTR PENDIENTES DE COBRO:\n');
        console.table(resultados);

        // Resumen por cliente
        const porCliente = {};
        ctrPendientes.forEach(row => {
            const cli = String(row.CLIENTE).trim();
            if (!porCliente[cli]) {
                porCliente[cli] = { documentos: 0, total: 0 };
            }
            porCliente[cli].documentos++;
            porCliente[cli].total += parseFloat(row.IMPORTE_PENDIENTE || 0);
        });

        console.log('\n📊 RESUMEN POR CLIENTE:');
        console.table(Object.entries(porCliente).map(([cliente, data]) => ({
            Cliente: cliente,
            Documentos: data.documentos,
            TotalPendiente: data.total.toFixed(2) + ' €'
        })));

        // Total global
        const totalCTR = ctrPendientes.reduce((sum, r) => sum + parseFloat(r.IMPORTE_PENDIENTE || 0), 0);
        console.log(`\n💰 TOTAL CTR PENDIENTE: ${totalCTR.toFixed(2)} €`);
        console.log(`   Total documentos: ${ctrPendientes.length}\n`);

        return resultados;

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await conn.close();
    }
}

// Ejecución
explorarClientesCTR().catch(console.error);
