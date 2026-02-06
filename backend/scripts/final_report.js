const { query } = require('../config/db');
const fs = require('fs');
const path = require('path');

// CONFIG
const IPC = 1.03;

async function getBSales(year) {
    try {
        const rows = await query(`SELECT CODIGOVENDEDOR, SUM(IMPORTE) as TOTAL FROM JAVIER.VENTAS_B WHERE EJERCICIO=${year} GROUP BY CODIGOVENDEDOR`, false, false);
        const map = {};
        rows.forEach(r => {
            map[r.CODIGOVENDEDOR.trim()] = parseFloat(r.TOTAL);
        });
        return map;
    } catch (e) { return {}; }
}

async function getGrowthConfig() {
    try {
        const rows = await query(`SELECT CODIGOVENDEDOR, TARGET_PERCENTAGE FROM JAVIER.OBJ_CONFIG`, false, false);
        const map = {};
        rows.forEach(r => {
            map[r.CODIGOVENDEDOR.trim()] = parseFloat(r.TARGET_PERCENTAGE);
        });
        return map;
    } catch (e) { return {}; }
}

async function getVendorNames() {
    try {
        const rows = await query(`SELECT TRIM(VCCDVD) as ID, TRIM(VCNMVV) as NAME FROM DSEDAC.VDC`, false, false);
        const map = {};
        rows.forEach(r => {
            map[r.ID] = r.NAME;
            map[r.ID.replace(/^0+/, '')] = r.NAME; // Support unpadded
        });
        return map;
    } catch (e) { return {}; }
}

async function main() {
    console.log('Generando Informe Final...');

    // 0. Get Vendor Names
    const vendorNames = await getVendorNames();

    // 1. Get 2025 Sales (LCAADC, Filtered)
    const salesRows = await query(`
        SELECT 
            LCCDVD as VENDOR, 
            SUM(LCIMVT) as TOTAL
        FROM DSED.LACLAE L
        WHERE LCAADC = 2025
          AND TPDC = 'LAC'
          AND LCTPVT IN ('CC', 'VC') 
          AND LCCLLN IN ('AB', 'VT') 
          AND LCSRAB NOT IN ('N', 'Z', 'G', 'D')
        GROUP BY LCCDVD
        ORDER BY LCCDVD
    `, false, false);

    const bSales2025 = await getBSales(2025);
    const growthMap = await getGrowthConfig();

    let output = `# INFORME DE OBJETIVOS Y COMISIONES 2026\n`;
    output += `Generado: ${new Date().toLocaleString()}\n`;
    output += `Criterios:\n`;
    output += `- Ventas 2025: Fecha Documento (LCAADC), Filtros (Excluye N,Z,G,D), Incluye Ventas B.\n`;
    output += `- Objetivo Comisiones (Cobrar): Base 2025 * ${IPC} (IPC 3%).\n`;
    output += `- Objetivo Ventas (Apretar): Base 2025 * ${IPC} * (1 + Growth%).\n\n`;

    output += `| ID | Comercial | Base 2025 (App) | Ventas B | Total Base | % Crec. | Obj. COMISIONES (IPC) | Obj. VENTAS (Total) |\n`;
    output += `|---|---|---|---|---|---|---|---|\n`;

    let totalBaseApp = 0;
    let totalB = 0;
    let totalCombined = 0;
    let totalCommTarget = 0;
    let totalSalesTarget = 0;

    for (const row of salesRows) {
        const id = row.VENDOR.trim();
        // Skip specialized/internal codes if needed? Keeping all for now.
        const name = vendorNames[id] || 'DESCONOCIDO';

        const baseApp = parseFloat(row.TOTAL) || 0;
        // Normalize ID for B-sales (remove leading zeros)
        const idNorm = id.replace(/^0+/, '');
        const b = (bSales2025[id] || 0) + (bSales2025[idNorm] || 0); // Check both keys

        const totalBase = baseApp + b;
        const growth = growthMap[id] !== undefined ? growthMap[id] : 10.0; // Default 10%

        const commTarget = totalBase * IPC;
        const salesTarget = commTarget * (1 + (growth / 100));

        output += `| ${id} | ${name} | ${baseApp.toLocaleString('es-ES', { minimumFractionDigits: 2 })} € | ${b.toLocaleString('es-ES', { minimumFractionDigits: 2 })} € | ${totalBase.toLocaleString('es-ES', { minimumFractionDigits: 2 })} € | ${growth}% | **${commTarget.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €** | ${salesTarget.toLocaleString('es-ES', { minimumFractionDigits: 2 })} € |\n`;

        totalBaseApp += baseApp;
        totalB += b;
        totalCombined += totalBase;
        totalCommTarget += commTarget;
        totalSalesTarget += salesTarget;
    }

    output += `| | **TOTALES** | **${totalBaseApp.toLocaleString('es-ES')} €** | **${totalB.toLocaleString('es-ES')} €** | **${totalCombined.toLocaleString('es-ES')} €** | - | **${totalCommTarget.toLocaleString('es-ES')} €** | **${totalSalesTarget.toLocaleString('es-ES')} €** |\n`;

    const filePath = path.join(__dirname, '../../INFORME_VENTAS_2026.md');
    fs.writeFileSync(filePath, output);
    console.log(`Informe guardado en: ${filePath}`);
    process.exit(0);
}

main();
