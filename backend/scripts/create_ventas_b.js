/**
 * Create JAVIER.VENTAS_B table and populate with B-sales data
 * This table stores "B-sales" (secondary channel sales) per vendor/month
 * to be added to objectives and commissions calculations.
 */
const { query } = require('../config/db');

async function createVentasBTable() {
    console.log('🔧 Creating JAVIER.VENTAS_B table...');

    try {
        // Check if table exists
        try {
            await query(`SELECT 1 FROM JAVIER.VENTAS_B FETCH FIRST 1 ROWS ONLY`, false, false);
            console.log('✅ JAVIER.VENTAS_B already exists.');
            return true;
        } catch (e) {
            // Table doesn't exist, create it
        }

        await query(`
            CREATE TABLE JAVIER.VENTAS_B (
                CODIGOVENDEDOR VARCHAR(10) NOT NULL,
                EJERCICIO INTEGER NOT NULL,
                MES INTEGER NOT NULL,
                IMPORTE DECIMAL(15,2) NOT NULL,
                PRIMARY KEY (CODIGOVENDEDOR, EJERCICIO, MES)
            )
        `);
        console.log('✅ JAVIER.VENTAS_B table created successfully.');
        return true;
    } catch (error) {
        console.error('❌ Error creating table:', error.message);
        return false;
    }
}

async function populateVentasB() {
    console.log('📊 Populating JAVIER.VENTAS_B with historical data...');

    // B-sales data from user's Excel (parsed)
    // Format: { vendor, year, month, amount }
    const bSalesData = [
        // 2025 Data
        { vd: '2', ejercicio: 2025, mes: 1, importe: 1340.22 },
        { vd: '2', ejercicio: 2025, mes: 2, importe: 1541.66 },
        { vd: '3', ejercicio: 2025, mes: 1, importe: 471.10 },
        { vd: '3', ejercicio: 2025, mes: 2, importe: 734.07 },
        { vd: '5', ejercicio: 2025, mes: 1, importe: 15585.45 },
        { vd: '5', ejercicio: 2025, mes: 2, importe: 7588.45 },
        { vd: '13', ejercicio: 2025, mes: 1, importe: 25611.24 },
        { vd: '13', ejercicio: 2025, mes: 2, importe: 14836.08 },
        { vd: '13', ejercicio: 2025, mes: 3, importe: 1681.64 },
        { vd: '13', ejercicio: 2025, mes: 4, importe: 2806.08 },
        { vd: '13', ejercicio: 2025, mes: 5, importe: 8465.63 },
        { vd: '13', ejercicio: 2025, mes: 6, importe: 7583.48 },
        { vd: '13', ejercicio: 2025, mes: 7, importe: 572.88 },
        { vd: '13', ejercicio: 2025, mes: 8, importe: 10998.83 },
        { vd: '13', ejercicio: 2025, mes: 9, importe: 11166.77 },
        { vd: '13', ejercicio: 2025, mes: 10, importe: 19346.10 },
        { vd: '13', ejercicio: 2025, mes: 11, importe: 11679.41 },
        { vd: '13', ejercicio: 2025, mes: 12, importe: 38684.84 },
        { vd: '16', ejercicio: 2025, mes: 1, importe: 68.48 },
        { vd: '20', ejercicio: 2025, mes: 1, importe: 35.40 },
        { vd: '92', ejercicio: 2025, mes: 1, importe: 23.40 },
        { vd: '94', ejercicio: 2025, mes: 1, importe: 12.85 },
        { vd: '97', ejercicio: 2025, mes: 1, importe: 734.57 },
        { vd: '97', ejercicio: 2025, mes: 2, importe: 575.25 },
        { vd: '97', ejercicio: 2025, mes: 5, importe: 2397.60 },
        { vd: '97', ejercicio: 2025, mes: 7, importe: -795.60 },
        { vd: '97', ejercicio: 2025, mes: 11, importe: 12080.24 },
        { vd: '97', ejercicio: 2025, mes: 12, importe: 8163.51 },
        // 2026 Data
        { vd: '13', ejercicio: 2026, mes: 1, importe: 12075.15 },
    ];

    let inserted = 0;
    let skipped = 0;

    for (const row of bSalesData) {
        try {
            // Use MERGE/UPSERT pattern for DB2
            await query(`
                MERGE INTO JAVIER.VENTAS_B AS T
                USING (VALUES ('${row.vd}', ${row.ejercicio}, ${row.mes}, ${row.importe})) 
                    AS S(CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE)
                ON T.CODIGOVENDEDOR = S.CODIGOVENDEDOR 
                   AND T.EJERCICIO = S.EJERCICIO 
                   AND T.MES = S.MES
                WHEN MATCHED THEN 
                    UPDATE SET IMPORTE = S.IMPORTE
                WHEN NOT MATCHED THEN 
                    INSERT (CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE) 
                    VALUES (S.CODIGOVENDEDOR, S.EJERCICIO, S.MES, S.IMPORTE)
            `);
            inserted++;
        } catch (e) {
            console.warn(`⚠️ Skipped ${row.vd}/${row.ejercicio}/${row.mes}: ${e.message}`);
            skipped++;
        }
    }

    console.log(`✅ Inserted/Updated: ${inserted}, Skipped: ${skipped}`);
}

async function verifyData() {
    console.log('\n📋 Verifying VENTAS_B data:');

    const totals = await query(`
        SELECT CODIGOVENDEDOR, EJERCICIO, SUM(IMPORTE) as TOTAL
        FROM JAVIER.VENTAS_B
        GROUP BY CODIGOVENDEDOR, EJERCICIO
        ORDER BY EJERCICIO, CODIGOVENDEDOR
    `, false);

    console.table(totals);

    const grandTotal = await query(`
        SELECT SUM(IMPORTE) as GRAND_TOTAL FROM JAVIER.VENTAS_B
    `, false);

    console.log(`\n💰 Grand Total B-Sales: ${grandTotal[0]?.GRAND_TOTAL}€`);
}

async function main() {
    try {
        const created = await createVentasBTable();
        if (created) {
            await populateVentasB();
            await verifyData();
        }
        console.log('\n✅ VENTAS_B setup complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

main();
