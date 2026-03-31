/**
 * VERIFICACIÓN VENTAS_B
 * =====================
 * Ejecutar: node scripts/verify_ventas_b.js
 * 
 * Muestra el estado actual de la tabla VENTAS_B después de los cambios,
 * con una tabla comercial por comercial de lo que debe salir en la app.
 */

const { query, initDb } = require('../config/db');

async function main() {
    await initDb();
    
    console.log('\n' + '='.repeat(100));
    console.log('VERIFICACIÓN VENTAS_B - Estado actual de la tabla');
    console.log('='.repeat(100));
    
    // 1. Todos los registros de la tabla
    const allRows = await query(`
        SELECT CODIGOVENDEDOR, EJERCICIO, MES, IMPORTE
        FROM JAVIER.VENTAS_B
        ORDER BY CODIGOVENDEDOR, EJERCICIO, MES
    `);
    
    console.log('\n📋 TODOS LOS REGISTROS EN VENTAS_B:\n');
    console.log('  VENDEDOR | AÑO  | MES | IMPORTE');
    console.log('  ' + '-'.repeat(40));
    allRows.forEach(r => {
        console.log(`  ${String(r.CODIGOVENDEDOR).padStart(8)} | ${r.EJERCICIO} | ${String(r.MES).padStart(3)} | ${parseFloat(r.IMPORTE).toFixed(2)}`);
    });
    console.log(`\n  Total registros: ${allRows.length}`);
    
    // 2. Totales por vendedor/año
    const totals = await query(`
        SELECT CODIGOVENDEDOR, EJERCICIO, 
               SUM(IMPORTE) as TOTAL,
               COUNT(*) as NUM_MESES,
               MIN(MES) as MES_MIN,
               MAX(MES) as MES_MAX
        FROM JAVIER.VENTAS_B
        GROUP BY CODIGOVENDEDOR, EJERCICIO
        ORDER BY CODIGOVENDEDOR, EJERCICIO
    `);
    
    console.log('\n' + '='.repeat(100));
    console.log('TOTALES POR VENDEDOR/AÑO:');
    console.log('='.repeat(100));
    console.log('\n  VENDEDOR | AÑO  | TOTAL VENTAS B | MESES | RANGO');
    console.log('  ' + '-'.repeat(60));
    totals.forEach(r => {
        console.log(`  ${String(r.CODIGOVENDEDOR).padStart(8)} | ${r.EJERCICIO} | ${parseFloat(r.TOTAL).toFixed(2).padStart(16)}€ | ${String(r.NUM_MESES).padStart(5)} | ${r.MES_MIN}-${r.MES_MAX}`);
    });
    
    // 3. Tabla detallada comercial por comercial - LO QUE DEBE SALIR EN LA APP
    console.log('\n' + '='.repeat(100));
    console.log('TABLA DETALLADA POR COMERCIAL - LO QUE DEBE APARECER EN LA APP');
    console.log('='.repeat(100));
    
    const vendedores = [...new Set(allRows.map(r => String(r.CODIGOVENDEDOR)))].sort((a, b) => parseInt(a) - parseInt(b));
    
    for (const vendedor of vendedores) {
        const rows2025 = allRows.filter(r => String(r.CODIGOVENDEDOR) === vendedor && r.EJERCICIO === 2025);
        const rows2026 = allRows.filter(r => String(r.CODIGOVENDEDOR) === vendedor && r.EJERCICIO === 2026);
        
        const total2025 = rows2025.reduce((s, r) => s + parseFloat(r.IMPORTE), 0);
        const total2026 = rows2026.reduce((s, r) => s + parseFloat(r.IMPORTE), 0);
        const target2026 = total2025 * 1.03; // IPC 3%
        
        console.log(`\n  ┌─────────────────────────────────────────────────────────────────┐`);
        console.log(`  │ COMERCIAL ${vendedor.padStart(68)}│`);
        console.log(`  ├─────────────────────────────────────────────────────────────────┤`);
        console.log(`  │ Ventas B 2025 (base objetivo): ${parseFloat(total2025).toFixed(2).padStart(34)}€ │`);
        console.log(`  │ Objetivo 2026 (ventas B):      ${parseFloat(target2026).toFixed(2).padStart(34)}€ │`);
        console.log(`  │ Ventas B 2026 (acumulado):     ${parseFloat(total2026).toFixed(2).padStart(34)}€ │`);
        console.log(`  └─────────────────────────────────────────────────────────────────┘`);
        
        // Detalle mensual 2025
        console.log(`\n    Detalle 2025 (afecta al objetivo 2026):`);
        console.log(`    MES | VENTAS B 2025`);
        console.log(`    ` + '-'.repeat(25));
        for (let m = 1; m <= 12; m++) {
            const row = rows2025.find(r => r.MES === m);
            const val = row ? parseFloat(row.IMPORTE).toFixed(2) : '—';
            console.log(`    ${String(m).padStart(3)} | ${String(val).padStart(13)}€`);
        }
        
        // Detalle mensual 2026
        console.log(`\n    Detalle 2026 (ventas reales):`);
        console.log(`    MES | VENTAS B 2026 | Se suma a LACLAE`);
        console.log(`    ` + '-'.repeat(45));
        for (let m = 1; m <= 12; m++) {
            const row = rows2026.find(r => r.MES === m);
            if (row) {
                const val = parseFloat(row.IMPORTE);
                const signo = val < 0 ? 'RESTA' : 'SUMA';
                console.log(`    ${String(m).padStart(3)} | ${val.toFixed(2).padStart(13)}€ | ${signo} a LACLAE`);
            } else {
                console.log(`    ${String(m).padStart(3)} | ${'—'.padStart(13)} | Sin dato`);
            }
        }
    }
    
    // 4. Verificación de los cambios aplicados
    console.log('\n' + '='.repeat(100));
    console.log('VERIFICACIÓN DE CAMBIOS APLICADOS:');
    console.log('='.repeat(100));
    
    // Verificar vendedor 13, 2025, meses 9-12
    const v13_2025 = await query(`
        SELECT MES, IMPORTE FROM JAVIER.VENTAS_B
        WHERE CODIGOVENDEDOR = '13' AND EJERCICIO = 2025 AND MES IN (9, 10, 11, 12)
        ORDER BY MES
    `);
    
    const expected = { 9: 11316.24, 10: 19709.53, 11: 11813.10, 12: 39528.40 };
    console.log('\n  Vendedor 13 - 2025 (meses 9-12):');
    console.log('  MES | ESPERADO  | ACTUAL    | ESTADO');
    console.log('  ' + '-'.repeat(45));
    for (const [mes, exp] of Object.entries(expected)) {
        const row = v13_2025.find(r => r.MES === parseInt(mes));
        const actual = row ? parseFloat(row.IMPORTE) : null;
        const ok = actual !== null && Math.abs(actual - exp) < 0.01;
        console.log(`  ${mes.padStart(3)} | ${exp.toFixed(2).padStart(9)} | ${actual !== null ? actual.toFixed(2) : 'N/A'.padStart(9)} | ${ok ? '✅ OK' : '❌ ERROR'}`);
    }
    
    // Verificar 2026 - mes 2
    const m2_2026 = await query(`
        SELECT CODIGOVENDEDOR, IMPORTE FROM JAVIER.VENTAS_B
        WHERE EJERCICIO = 2026 AND MES = 2
        ORDER BY CODIGOVENDEDOR
    `);
    
    const expectedM2 = { '1': -479.72, '13': 15652.84, '97': -416.47 };
    console.log('\n  2026 - Mes 2 (febrero):');
    console.log('  VENDEDOR | ESPERADO   | ACTUAL     | ESTADO');
    console.log('  ' + '-'.repeat(50));
    for (const [vendedor, exp] of Object.entries(expectedM2)) {
        const row = m2_2026.find(r => String(r.CODIGOVENDEDOR) === vendedor);
        const actual = row ? parseFloat(row.IMPORTE) : null;
        const ok = actual !== null && Math.abs(actual - exp) < 0.01;
        console.log(`  ${vendedor.padStart(8)} | ${exp.toFixed(2).padStart(10)} | ${actual !== null ? actual.toFixed(2).padStart(10) : 'N/A'.padStart(10)} | ${ok ? '✅ OK' : '❌ ERROR'}`);
    }
    
    // Verificar 2026 - mes 3
    const m3_2026 = await query(`
        SELECT CODIGOVENDEDOR, IMPORTE FROM JAVIER.VENTAS_B
        WHERE EJERCICIO = 2026 AND MES = 3
        ORDER BY CODIGOVENDEDOR
    `);
    
    const expectedM3 = { '1': -614.75, '13': 20380.15, '97': -887.00 };
    console.log('\n  2026 - Mes 3 (marzo):');
    console.log('  VENDEDOR | ESPERADO   | ACTUAL     | ESTADO');
    console.log('  ' + '-'.repeat(50));
    for (const [vendedor, exp] of Object.entries(expectedM3)) {
        const row = m3_2026.find(r => String(r.CODIGOVENDEDOR) === vendedor);
        const actual = row ? parseFloat(row.IMPORTE) : null;
        const ok = actual !== null && Math.abs(actual - exp) < 0.01;
        console.log(`  ${vendedor.padStart(8)} | ${exp.toFixed(2).padStart(10)} | ${actual !== null ? actual.toFixed(2).padStart(10) : 'N/A'.padStart(10)} | ${ok ? '✅ OK' : '❌ ERROR'}`);
    }
    
    // 5. Verificar que no hay duplicados
    const duplicates = await query(`
        SELECT CODIGOVENDEDOR, EJERCICIO, MES, COUNT(*) as CNT
        FROM JAVIER.VENTAS_B
        GROUP BY CODIGOVENDEDOR, EJERCICIO, MES
        HAVING COUNT(*) > 1
    `);
    
    console.log('\n' + '='.repeat(100));
    if (duplicates.length === 0) {
        console.log('✅ No hay registros duplicados en VENTAS_B');
    } else {
        console.log('❌ REGISTROS DUPLICADOS ENCONTRADOS:');
        duplicates.forEach(r => {
            console.log(`   Vendedor ${r.CODIGOVENDEDOR}, Año ${r.EJERCICIO}, Mes ${r.MES}: ${r.CNT} registros`);
        });
    }
    
    console.log('\n' + '='.repeat(100));
    console.log('FIN DE VERIFICACIÓN');
    console.log('='.repeat(100) + '\n');
    
    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
