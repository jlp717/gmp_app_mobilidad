/**
 * Script de Verificación: Ventas Bartolo (02) - Semana 1 de 2026
 * 
 * Objetivo: Comparar ventas acumuladas de la primera semana (1-5 Enero 2026)
 * con el total que muestra el Rutero.
 * 
 * Ejecutar: node scripts/verify-bartolo-week1.js
 */

const { query, initDb } = require('../config/db');
const { LACLAE_SALES_FILTER } = require('../utils/common');

async function verifyBartoloWeek1() {
    // Initialize DB connection first
    await initDb();
    console.log('='.repeat(60));
    console.log('🔍 VERIFICACIÓN: Ventas Bartolo (02) - Semana 1 de 2026');
    console.log('='.repeat(60));

    const vendedor = '02'; // BARTOLO
    const year = 2026;
    const prevYear = 2025;

    // Semana 1 de 2026: Lunes 30 Dic - Domingo 5 Ene? 
    // No, Semana 1 real: 1 Ene (Jueves) - 5 Ene (Domingo)
    // Para "semana completada", usamos hasta último domingo: 5 Ene
    const week1EndMonth = 1; // Enero
    const week1EndDay = 5;   // Domingo 5

    try {
        // 1. Total Semana 1 (1 Ene - 5 Ene 2026)
        console.log('\n📊 1. VENTAS SEMANA 1 (1-5 Enero 2026)');
        console.log('-'.repeat(40));

        const week1Sql = `
            SELECT 
                SUM(L.LCIMVT) as TOTAL_VENTAS,
                SUM(L.LCIMCT) as TOTAL_COSTE,
                COUNT(DISTINCT L.LCCDCL) as CLIENTES_ACTIVOS
            FROM DSED.LACLAE L
            WHERE L.R1_T8CDVD = '${vendedor}'
              AND L.LCAADC = ${year}
              AND ${LACLAE_SALES_FILTER}
              AND (L.LCMMDC < ${week1EndMonth} OR (L.LCMMDC = ${week1EndMonth} AND L.LCDDDC <= ${week1EndDay}))
        `;

        const week1Result = await query(week1Sql);
        const week1Sales = parseFloat(week1Result[0]?.TOTAL_VENTAS) || 0;
        const week1Clients = parseInt(week1Result[0]?.CLIENTES_ACTIVOS) || 0;

        console.log(`   Ventas Netas (sin IVA): ${week1Sales.toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        console.log(`   Clientes Activos: ${week1Clients}`);

        // 2. Total Semana 1 del año anterior (1-5 Enero 2025) para comparación YoY
        console.log('\n📊 2. VENTAS SEMANA 1 (1-5 Enero 2025) - Comparativa');
        console.log('-'.repeat(40));

        const week1PrevSql = `
            SELECT 
                SUM(L.LCIMVT) as TOTAL_VENTAS,
                COUNT(DISTINCT L.LCCDCL) as CLIENTES_ACTIVOS
            FROM DSED.LACLAE L
            WHERE L.R1_T8CDVD = '${vendedor}'
              AND L.LCAADC = ${prevYear}
              AND ${LACLAE_SALES_FILTER}
              AND (L.LCMMDC < ${week1EndMonth} OR (L.LCMMDC = ${week1EndMonth} AND L.LCDDDC <= ${week1EndDay}))
        `;

        const week1PrevResult = await query(week1PrevSql);
        const week1PrevSales = parseFloat(week1PrevResult[0]?.TOTAL_VENTAS) || 0;

        console.log(`   Ventas Netas 2025: ${week1PrevSales.toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);

        // YoY %
        const yoyPercent = week1PrevSales > 0
            ? ((week1Sales - week1PrevSales) / week1PrevSales * 100).toFixed(1)
            : (week1Sales > 0 ? 100 : 0);
        console.log(`   Variación YoY: ${yoyPercent >= 0 ? '+' : ''}${yoyPercent}%`);

        // 3. Desglose por Cliente (Top 10)
        console.log('\n📊 3. DESGLOSE POR CLIENTE (Top 10) - Semana 1');
        console.log('-'.repeat(40));

        const clientBreakdownSql = `
            SELECT 
                TRIM(L.LCCDCL) as CLIENTE,
                SUM(L.LCIMVT) as VENTAS
            FROM DSED.LACLAE L
            WHERE L.R1_T8CDVD = '${vendedor}'
              AND L.LCAADC = ${year}
              AND ${LACLAE_SALES_FILTER}
              AND (L.LCMMDC < ${week1EndMonth} OR (L.LCMMDC = ${week1EndMonth} AND L.LCDDDC <= ${week1EndDay}))
            GROUP BY L.LCCDCL
            ORDER BY VENTAS DESC
            FETCH FIRST 10 ROWS ONLY
        `;

        const clientBreakdown = await query(clientBreakdownSql);
        let runningTotal = 0;

        clientBreakdown.forEach((c, i) => {
            const sales = parseFloat(c.VENTAS) || 0;
            runningTotal += sales;
            console.log(`   ${(i + 1).toString().padStart(2)}. ${c.CLIENTE.padEnd(15)} → ${sales.toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        });

        console.log(`   ${''.padEnd(20)}─────────────────`);
        console.log(`   ${''.padEnd(20)}Top10: ${runningTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);

        // 4. Total YTD completo (hasta hoy, 10 Enero)
        console.log('\n📊 4. TOTAL YTD (1 Ene - 10 Ene 2026) - Referencia Usuario');
        console.log('-'.repeat(40));

        const ytdSql = `
            SELECT 
                SUM(L.LCIMVT) as TOTAL_VENTAS
            FROM DSED.LACLAE L
            WHERE L.R1_T8CDVD = '${vendedor}'
              AND L.LCAADC = ${year}
              AND ${LACLAE_SALES_FILTER}
              AND (L.LCMMDC < 1 OR (L.LCMMDC = 1 AND L.LCDDDC <= 10))
        `;

        const ytdResult = await query(ytdSql);
        const ytdSales = parseFloat(ytdResult[0]?.TOTAL_VENTAS) || 0;

        console.log(`   Total YTD (hasta 10 Ene): ${ytdSales.toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        console.log(`   (Usuario reportó: 30.693,16€)`);

        // 5. Resumen
        console.log('\n' + '='.repeat(60));
        console.log('📋 RESUMEN');
        console.log('='.repeat(60));
        console.log(`   Semana 1 (1-5 Ene 2026): ${week1Sales.toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        console.log(`   Semana 1 (1-5 Ene 2025): ${week1PrevSales.toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        console.log(`   Variación YoY: ${yoyPercent >= 0 ? '+' : ''}${yoyPercent}%`);
        console.log(`   YTD Completo (hasta 10 Ene): ${ytdSales.toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

verifyBartoloWeek1();
