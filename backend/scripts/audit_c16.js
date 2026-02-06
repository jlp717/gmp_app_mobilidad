const { query } = require('../config/db');

async function main() {
    console.log('=== AUDITORÍA C16 v3 ===');

    try {
        // Inspect VENTAS_B columns
        try {
            const cols = await query(`SELECT * FROM JAVIER.VENTAS_B FETCH FIRST 1 ROWS ONLY`, false, false);
            console.log('VENTAS_B Sample:', cols[0]);
        } catch (e) {
            console.log('Error inspecting VENTAS_B:', e.message);
        }

        console.log('\n--- COMERCIAL 16 (FRANCISCO ASENSIO) ---');

        // 1. Base 2025 Normal (LCAADC)
        const c16Sales2025 = await query(`
            SELECT SUM(LCIMVT) as TOTAL
            FROM DSED.LACLAE
            WHERE LCAADC = 2025 AND LCCDVD = '16' AND TPDC='LAC' AND LCTPVT IN ('CC','VC') AND LCCLLN IN ('AB','VT') AND LCSRAB NOT IN ('N','Z')
        `, false, false);
        const base25 = parseFloat(c16Sales2025[0]?.TOTAL || 0);
        console.log('Ventas 2025 (Base N,Z excl):', base25.toLocaleString());

        // 2. B-Sales 2025 (Try ANIO, if fails assume 0)
        let bSales = 0;
        try {
            // Try standard query, if fails we skip
            const c16B = await query(`SELECT SUM(IMPORTE) as TOTAL FROM JAVIER.VENTAS_B WHERE ANIO=2025 AND CODIGOVENDEDOR='16'`, false, false);
            bSales = parseFloat(c16B[0]?.TOTAL || 0);
        } catch (e) { console.log('B-Sales query failed, using 0'); }
        console.log('B-Sales 2025:', bSales.toLocaleString());

        // 3. Total Base
        const totalBase = base25 + bSales;
        console.log('Total Base:', totalBase.toLocaleString());

        // 4. Targets
        const ipcTarget = totalBase * 1.03;
        console.log('Objetivo Comisiones (IPC 3%):', ipcTarget.toLocaleString());
        console.log('Target Growth (Calculated 10%):', (ipcTarget * 1.10).toLocaleString());

        // 5. Ventas Enero 2026
        const c16Sales2026 = await query(`
            SELECT SUM(LCIMVT) as TOTAL
            FROM DSED.LACLAE
            WHERE LCAADC = 2026 AND LCMMDC = 1 AND LCCDVD = '16' AND TPDC='LAC' AND LCTPVT IN ('CC','VC') AND LCCLLN IN ('AB','VT') AND LCSRAB NOT IN ('N','Z')
        `, false, false);
        const salesJan26 = parseFloat(c16Sales2026[0]?.TOTAL || 0);
        console.log('Ventas REALES Enero 2026 (LCAADC):', salesJan26.toLocaleString());

        // 6. B-Sales 2026 (Jan)
        let bSales26 = 0;
        try {
            const c16B26 = await query(`SELECT SUM(IMPORTE) as TOTAL FROM JAVIER.VENTAS_B WHERE ANIO=2026 AND MES=1 AND CODIGOVENDEDOR='16'`, false, false);
            bSales26 = parseFloat(c16B26[0]?.TOTAL || 0);
        } catch (e) { }
        console.log('B-Sales Enero 2026:', bSales26.toLocaleString());

        const totalSales26 = salesJan26 + bSales26;
        console.log('TOTAL REAL 2026:', totalSales26.toLocaleString());

        // Seasonal Target for Jan?
        // Approx 8% of year? Or pure Jan 2025 + 3%?
        // Let's check Jan 2025
        const c16SalesJan25 = await query(`
            SELECT SUM(LCIMVT) as TOTAL
            FROM DSED.LACLAE
            WHERE LCAADC = 2025 AND LCMMDC = 1 AND LCCDVD = '16' AND TPDC='LAC' AND LCTPVT IN ('CC','VC') AND LCCLLN IN ('AB','VT') AND LCSRAB NOT IN ('N','Z')
        `, false, false);
        const jan25 = parseFloat(c16SalesJan25[0]?.TOTAL || 0);
        console.log('Ventas REALES Enero 2025:', jan25.toLocaleString());
        const targetJan26 = jan25 * 1.03;
        console.log('Objetivo Enero 2026 (Jan25 + 3%):', targetJan26.toLocaleString());

        if (totalSales26 > targetJan26) {
            console.log('--> SUPERAVIT (Comisiona)');
        } else {
            console.log('--> DEFICIT (No comisiona)');
            console.log('    Faltan:', (targetJan26 - totalSales26).toLocaleString());
        }

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

main();
