const { query, initDb } = require('../config/db');

async function testCommissions() {
    await initDb();
    console.log("=== Testing Commissions for Excluded Vendor 93 ===");
    // Simulate what calculateVendorData does
    const vendor = '93';
    const year = 2026;

    // Check if excluded
    const rows = await query(`
        SELECT TRIM(CODIGOVENDEDOR) as CODE
        FROM JAVIER.COMMISSION_EXCEPTIONS
        WHERE EXCLUIDO_COMISIONES = 'Y'
    `);
    const excluded = rows.map(r => r.CODE.replace(/^0+/, ''));
    console.log("Excluded vendors list:", excluded);
    console.log("Is 93 excluded?", excluded.includes('93'));

    // Check if 93 has sales
    const sales = await query(`SELECT COUNT(*) as CNT FROM DSED.LACLAE WHERE LCCDVD = '93' AND LCAADC = 2026`);
    console.log("Sales count for 93 in 2026:", sales[0].CNT);

    // Check if 93 appears in the list of vendors for Jefe de Ventas (ALL)
    const allVendors = await query(`
        SELECT DISTINCT RTRIM(L.LCCDVD) as VENDOR_CODE
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (2026, 2025)
          AND L.LCCDVD IS NOT NULL
          AND L.LCCDVD <> ''
    `);
    const codes = allVendors.map(v => v.VENDOR_CODE);
    console.log("Is 93 in allVendors list?", codes.includes('93'));

    process.exit(0);
}

testCommissions();
