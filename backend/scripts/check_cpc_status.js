/**
 * check_cpc_status.js - Investigar campos de estado en CPC y líneas LAC reales
 * Ejecutar: node scripts/check_cpc_status.js
 */
const { initDb, query } = require('../config/db');

async function main() {
    await initDb();
    console.log('\n=== INVESTIGACIÓN CPC STATUS + LAC LINES ===\n');

    // 1. Ver qué valores tiene CONFORMADOSN, SITUACIONALBARAN, ENVIADOSN, IMPRESOSN en CPC
    console.log('--- 1. VALORES DE CAMPOS DE ESTADO EN CPC (feb 2026) ---');
    try {
        const stats = await query(`
            SELECT
                TRIM(CONFORMADOSN) as CONFORMADO,
                TRIM(SITUACIONALBARAN) as SIT_ALBARAN,
                TRIM(ENVIADOSN) as ENVIADO,
                TRIM(IMPRESOSN) as IMPRESO,
                TRIM(SITUACIONPEDIDO) as SIT_PEDIDO,
                TRIM(SITUACIONCARGA) as SIT_CARGA,
                COUNT(*) as TOTAL
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 2
            GROUP BY CONFORMADOSN, SITUACIONALBARAN, ENVIADOSN, IMPRESOSN, SITUACIONPEDIDO, SITUACIONCARGA
            ORDER BY TOTAL DESC
        `, false);
        stats.forEach(s => {
            console.log(`  CONFORMADO='${s.CONFORMADO}' SIT_ALB='${s.SIT_ALBARAN}' ENVIADO='${s.ENVIADO}' IMPRESO='${s.IMPRESO}' SIT_PED='${s.SIT_PEDIDO}' SIT_CARGA='${s.SIT_CARGA}' → ${s.TOTAL} registros`);
        });
    } catch (e) {
        console.log('  Error:', e.message);
    }

    // 2. Ver si DIALLEGADA tiene datos útiles
    console.log('\n--- 2. DIALLEGADA/HORALLEGADA en CPC (feb 2026) ---');
    try {
        const llegada = await query(`
            SELECT
                DIALLEGADA, MESLLEGADA, ANOLLEGADA, HORALLEGADA,
                COUNT(*) as TOTAL
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 2
            GROUP BY DIALLEGADA, MESLLEGADA, ANOLLEGADA, HORALLEGADA
            ORDER BY TOTAL DESC
            FETCH FIRST 10 ROWS ONLY
        `, false);
        llegada.forEach(l => {
            console.log(`  LLEGADA: ${l.DIALLEGADA}/${l.MESLLEGADA}/${l.ANOLLEGADA} ${l.HORALLEGADA} → ${l.TOTAL} registros`);
        });
    } catch (e) {
        console.log('  Error:', e.message);
    }

    // 3. Sample LAC con datos de producto real (no líneas de tipo T=total)
    console.log('\n--- 3. SAMPLE LAC con productos reales (TIPOLINEA != T) ---');
    try {
        const lines = await query(`
            SELECT
                LAC.SECUENCIA,
                TRIM(LAC.CODIGOARTICULO) as ARTICULO,
                TRIM(LAC.DESCRIPCION) as DESC_ART,
                TRIM(LAC.TIPOLINEA) as TIPO,
                LAC.CANTIDADENVASES as BULTOS,
                LAC.CANTIDADUNIDADES as UNIDADES,
                LAC.PRECIOVENTA as PRECIO,
                LAC.PORCENTAJEDESCUENTO as DTO,
                LAC.IMPORTEVENTA as IMPORTE,
                TRIM(LAC.CODIGOIVA) as COD_IVA
            FROM DSEDAC.LAC LAC
            WHERE LAC.EJERCICIOALBARAN = 2026
              AND LAC.SERIEALBARAN = 'S'
              AND TRIM(LAC.TIPOLINEA) != 'T'
              AND TRIM(LAC.CODIGOARTICULO) != ''
            FETCH FIRST 10 ROWS ONLY
        `, false);
        lines.forEach((l, i) => {
            console.log(`  ${i + 1}. [${l.TIPO}] Art=${l.ARTICULO} | ${l.DESC_ART} | Bultos=${l.BULTOS} | Uds=${l.UNIDADES} | Precio=${l.PRECIO} | Dto=${l.DTO}% | Importe=${l.IMPORTE} | IVA=${l.COD_IVA}`);
        });
    } catch (e) {
        console.log('  Error:', e.message);
    }

    // 4. Mapeo de CODIGOIVA a porcentajes reales
    console.log('\n--- 4. TABLA IVA (si existe) ---');
    try {
        const ivaTable = await query(`
            SELECT * FROM DSEDAC.IVA
            FETCH FIRST 10 ROWS ONLY
        `, false);
        if (ivaTable.length > 0) {
            console.log('  Columnas:', Object.keys(ivaTable[0]).join(', '));
            ivaTable.forEach(r => {
                const vals = Object.entries(r).filter(([k, v]) => v !== null && v !== '' && v !== 0).map(([k, v]) => `${k}=${v}`).join(', ');
                console.log(`  ${vals}`);
            });
        }
    } catch (e) {
        console.log('  No existe DSEDAC.IVA:', e.message);
        // Try IMP
        try {
            const impTable = await query(`
                SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME LIKE '%IVA%'
            `, false);
            console.log('  Tablas IVA:', impTable.map(r => r.COLUMN_NAME).join(', '));
        } catch (e2) {
            console.log('  No tables found');
        }
    }

    // 5. Ver CPC con totales desglosados por IVA para un albarán concreto
    console.log('\n--- 5. SAMPLE CPC con desglose IVA ---');
    try {
        const cpcSample = await query(`
            SELECT
                EJERCICIOALBARAN, TRIM(SERIEALBARAN) as SERIE, TERMINALALBARAN, NUMEROALBARAN,
                IMPORTEBASEIMPONIBLE1 as BI1, PORCENTAJEIVA1 as IVA1, IMPORTEIVA1 as IIVA1,
                IMPORTEBASEIMPONIBLE2 as BI2, PORCENTAJEIVA2 as IVA2, IMPORTEIVA2 as IIVA2,
                IMPORTEBRUTO, IMPORTETOTAL,
                TRIM(CONFORMADOSN) as CONFORMADO,
                NUMEROBULTOS
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 2 AND SERIEALBARAN = 'S'
            FETCH FIRST 5 ROWS ONLY
        `, false);
        cpcSample.forEach((c, i) => {
            console.log(`\n  Albarán ${c.EJERCICIOALBARAN}-${c.SERIE}-${c.TERMINALALBARAN}-${c.NUMEROALBARAN}:`);
            console.log(`    BI1=${c.BI1} IVA1%=${c.IVA1} IVA1€=${c.IIVA1}`);
            console.log(`    BI2=${c.BI2} IVA2%=${c.IVA2} IVA2€=${c.IIVA2}`);
            console.log(`    BRUTO=${c.IMPORTEBRUTO} TOTAL=${c.IMPORTETOTAL}`);
            console.log(`    CONFORMADO=${c.CONFORMADO} BULTOS=${c.NUMEROBULTOS}`);
        });
    } catch (e) {
        console.log('  Error:', e.message);
    }

    // 6. Contar entregas por día para ver si hay patrón de "completado"
    console.log('\n--- 6. ENTREGAS POR DÍA (feb 2026, repartidor 94) ---');
    try {
        const daily = await query(`
            SELECT OPP.DIAREPARTO, COUNT(DISTINCT CPC.NUMEROALBARAN) as ALBARANES,
                   SUM(CASE WHEN DS.STATUS = 'ENTREGADO' THEN 1 ELSE 0 END) as COMPLETADOS_APP
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN JAVIER.DELIVERY_STATUS DS
              ON DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(COALESCE(CPC.SERIEALBARAN, '')) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10)))
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '94'
              AND OPP.MESREPARTO = 2 AND OPP.ANOREPARTO = 2026
            GROUP BY OPP.DIAREPARTO
            ORDER BY OPP.DIAREPARTO
        `, false);
        daily.forEach(d => {
            console.log(`  Día ${d.DIAREPARTO}: ${d.ALBARANES} albaranes, ${d.COMPLETADOS_APP} completados via app`);
        });
    } catch (e) {
        console.log('  Error:', e.message);
    }

    console.log('\n=== FIN ===');
    process.exit(0);
}

main().catch(e => {
    console.error('Error fatal:', e.message);
    process.exit(1);
});
