const { query } = require('../config/db');

async function main() {
    console.log('=== AUDITORÍA COFC / CMV / COMERCIAL 16 ===');

    try {
        // 1. Check ALL 2026 Quotas in COFC
        console.log('\n--- 1. TABLA DSEDAC.COFC (Ctas Mensuales) 2026 ---');
        const cofc = await query(`
            SELECT * FROM DSEDAC.COFC 
            WHERE ANOCUOTA = 2026
        `, false, false);
        console.log(`Registros COFC 2026: ${cofc.length}`);
        if (cofc.length > 0) {
            console.log('Sample:', cofc[0]);
            const totalQuota = cofc.reduce((sum, r) => sum + (parseFloat(r.IMPORTECUOTA) || 0), 0);
            console.log('TOTAL COFC 2026:', totalQuota.toLocaleString());
        }

        // 2. Check CMV (Cuotas Vendedor)
        console.log('\n--- 2. TABLA DSEDAC.CMV (Objetivos Vendedor) ---');
        const cmv = await query(`
            SELECT * FROM DSEDAC.CMV
        `, false, false); // No year filter? Check structure
        console.log(`Registros CMV: ${cmv.length}`);
        if (cmv.length > 0) {
            console.log('Sample:', cmv[0]);
        }

        // 3. Commercial 16 Audit
        console.log('\n--- 3. DETALLE COMERCIAL 16 (FRANCISCO ASENSIO) ---');
        const c16Sales2025 = await query(`
            SELECT SUM(LCIMVT) as TOTAL
            FROM DSED.LACLAE
            WHERE LCAADC = 2025 AND LCCDVD = '16' AND TPDC='LAC' AND LCTPVT IN ('CC','VC') AND LCCLLN IN ('AB','VT') AND LCSRAB NOT IN ('N','Z','G','D')
        `, false, false);
        const base25 = parseFloat(c16Sales2025[0]?.TOTAL || 0);
        console.log('Ventas 2025 (Base):', base25.toLocaleString());

        const c16Sales2026 = await query(`
            SELECT SUM(LCIMVT) as TOTAL
            FROM DSED.LACLAE
            WHERE LCAADC = 2026 AND LCMMDC = 1 AND LCCDVD = '16' AND TPDC='LAC' AND LCTPVT IN ('CC','VC') AND LCCLLN IN ('AB','VT') AND LCSRAB NOT IN ('N','Z','G','D')
        `, false, false);
        const sat26 = parseFloat(c16Sales2026[0]?.TOTAL || 0);
        console.log('Ventas Enero 2026:', sat26.toLocaleString());

        // Check B Sales
        const c16B = await query(`SELECT SUM(IMPORTE) as TOTAL FROM JAVIER.VENTAS_B WHERE ANIO=2025 AND CODIGOVENDEDOR='16'`, false, false);
        const bSales = parseFloat(c16B[0]?.TOTAL || 0);
        console.log('B-Sales 2025:', bSales.toLocaleString());

        const totalBase = base25 + bSales;
        console.log('Total Base Calculada:', totalBase.toLocaleString());

        const ipc = totalBase * 1.03;
        console.log('Target IPC (3%):', ipc.toLocaleString());

        const growth10 = ipc * 1.10;
        console.log('Target Growth (Calculated 10%):', growth10.toLocaleString());

        // Check if he has manual config
        const conf = await query(`SELECT * FROM JAVIER.OBJ_CONFIG WHERE CODIGOVENDEDOR='16'`, false, false);
        console.log('Config OBJ_CONFIG:', conf[0]);

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

main();
