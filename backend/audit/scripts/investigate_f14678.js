#!/usr/bin/env node
/**
 * Investigación profunda de la factura F-14678
 * y del flujo histórico de repartidores para detectar
 * campos "Pendiente"/"Entregado" y los importes 9.013,64€ / 16.539,32€
 */

const odbc = require('odbc');

const DSN = process.env.ODBC_DSN || 'GMP';
const UID = process.env.ODBC_UID || 'JAVIER';
const PWD = process.env.ODBC_PWD || 'JAVIER';
const CONN_STR = `DSN=${DSN};UID=${UID};PWD=${PWD};NAM=1;CCSID=1208;`;

async function main() {
    let conn;
    try {
        conn = await odbc.connect(CONN_STR);
        console.log('✅ Connected\n');

        // ────────────────────────────────────────────────
        // 1. Buscar factura 14678 en CAC (todas las series)
        // ────────────────────────────────────────────────
        console.log('═══ 1. CAC rows for NUMEROFACTURA = 14678 ═══');
        const cac14678 = await conn.query(`
            SELECT
                TRIM(CAC.SERIEFACTURA) as SERIE,
                CAC.NUMEROFACTURA,
                CAC.EJERCICIOFACTURA,
                CAC.EJERCICIOALBARAN, TRIM(CAC.SERIEALBARAN) as SERIE_ALB,
                CAC.TERMINALALBARAN, CAC.NUMEROALBARAN,
                CAC.DIAFACTURA, CAC.MESFACTURA, CAC.ANOFACTURA,
                TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE,
                CAC.IMPORTETOTAL,
                CAC.IMPORTEBASEIMPONIBLE1 as BI1,
                CAC.IMPORTEBASEIMPONIBLE2 as BI2,
                CAC.IMPORTEBASEIMPONIBLE3 as BI3,
                CAC.IMPORTEIVA1 as IVA1,
                CAC.IMPORTEIVA2 as IVA2,
                CAC.IMPORTEIVA3 as IVA3,
                CAC.PORCENTAJEIVA1 as PCT1,
                CAC.PORCENTAJEIVA2 as PCT2,
                CAC.PORCENTAJEIVA3 as PCT3
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CAC.CODIGOCLIENTEFACTURA
            WHERE CAC.NUMEROFACTURA = 14678
            ORDER BY CAC.EJERCICIOFACTURA DESC, CAC.SERIEFACTURA
        `);
        console.log(`Found ${cac14678.length} CAC rows`);
        for (const r of cac14678) {
            const base = (parseFloat(r.BI1) || 0) + (parseFloat(r.BI2) || 0) + (parseFloat(r.BI3) || 0);
            const iva = (parseFloat(r.IVA1) || 0) + (parseFloat(r.IVA2) || 0) + (parseFloat(r.IVA3) || 0);
            console.log(`  ${r.SERIE}-${r.NUMEROFACTURA} (${r.EJERCICIOFACTURA}) | Alb: ${r.SERIE_ALB}-${r.TERMINALALBARAN}-${r.NUMEROALBARAN}`);
            console.log(`    Cliente: ${r.CLIENTE} ${r.NOMBRE}`);
            console.log(`    Fecha: ${r.DIAFACTURA}/${r.MESFACTURA}/${r.ANOFACTURA}`);
            console.log(`    IMPORTETOTAL=${r.IMPORTETOTAL} | base_sum=${base.toFixed(2)} | iva_sum=${iva.toFixed(2)}`);
            console.log(`    BI1=${r.BI1} (${r.PCT1}%) IVA1=${r.IVA1} | BI2=${r.BI2} (${r.PCT2}%) IVA2=${r.IVA2} | BI3=${r.BI3} (${r.PCT3}%) IVA3=${r.IVA3}`);
            console.log('');
        }

        // ────────────────────────────────────────────────
        // 2. Aggregated totals (como lo haría getFacturaDetail)
        // ────────────────────────────────────────────────
        if (cac14678.length > 0) {
            const serie = cac14678[0].SERIE;
            const ejercicio = cac14678[0].EJERCICIOFACTURA;
            console.log(`═══ 2. Aggregated totals for ${serie}-14678 (ej=${ejercicio}) ═══`);
            const agg = await conn.query(`
                SELECT
                    SUM(CAC.IMPORTETOTAL) as TOTAL,
                    SUM(CAC.IMPORTEBASEIMPONIBLE1) as BI1,
                    SUM(CAC.IMPORTEBASEIMPONIBLE2) as BI2,
                    SUM(CAC.IMPORTEBASEIMPONIBLE3) as BI3,
                    SUM(CAC.IMPORTEIVA1) as IVA1,
                    SUM(CAC.IMPORTEIVA2) as IVA2,
                    SUM(CAC.IMPORTEIVA3) as IVA3,
                    COUNT(*) as NUM_ALBARANES
                FROM DSEDAC.CAC CAC
                WHERE TRIM(CAC.SERIEFACTURA) = '${serie}'
                  AND CAC.NUMEROFACTURA = 14678
                  AND CAC.EJERCICIOFACTURA = ${ejercicio}
            `);
            if (agg.length > 0) {
                const a = agg[0];
                const totalBase = (parseFloat(a.BI1) || 0) + (parseFloat(a.BI2) || 0) + (parseFloat(a.BI3) || 0);
                const totalIva = (parseFloat(a.IVA1) || 0) + (parseFloat(a.IVA2) || 0) + (parseFloat(a.IVA3) || 0);
                console.log(`  Albaranes: ${a.NUM_ALBARANES}`);
                console.log(`  SUM(IMPORTETOTAL) = ${a.TOTAL}`);
                console.log(`  SUM bases = ${totalBase.toFixed(2)}`);
                console.log(`  SUM iva = ${totalIva.toFixed(2)}`);
                console.log(`  Recalc total = ${(totalBase + totalIva).toFixed(2)}`);
                console.log(`  User expects: sin IVA=416.73, con IVA=454.77`);
                console.log('');
            }
        }

        // ────────────────────────────────────────────────
        // 3. Line items from LAC for this invoice
        // ────────────────────────────────────────────────
        if (cac14678.length > 0) {
            const serie = cac14678[0].SERIE;
            const ejercicio = cac14678[0].EJERCICIOFACTURA;
            console.log(`═══ 3. LAC line items for ${serie}-14678 ═══`);
            const lines = await conn.query(`
                SELECT
                    TRIM(LAC.CODIGOARTICULO) as CODIGO,
                    TRIM(LAC.DESCRIPCION) as DESC,
                    LAC.CANTIDADUNIDADES as CANT,
                    LAC.PRECIOVENTA as PRECIO,
                    LAC.IMPORTEVENTA as IMPORTE,
                    LAC.PORCENTAJEDESCUENTO as DTO
                FROM DSEDAC.LAC LAC
                INNER JOIN DSEDAC.CAC CAC
                    ON LAC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
                    AND LAC.SERIEALBARAN = CAC.SERIEALBARAN
                    AND LAC.TERMINALALBARAN = CAC.TERMINALALBARAN
                    AND LAC.NUMEROALBARAN = CAC.NUMEROALBARAN
                WHERE TRIM(CAC.SERIEFACTURA) = '${serie}'
                  AND CAC.NUMEROFACTURA = 14678
                  AND CAC.EJERCICIOFACTURA = ${ejercicio}
                ORDER BY LAC.SECUENCIA
            `);
            let lineSum = 0;
            for (const l of lines) {
                const imp = parseFloat(l.IMPORTE) || 0;
                lineSum += imp;
                console.log(`  ${l.CODIGO} | ${l.DESC} | cant=${l.CANT} precio=${l.PRECIO} imp=${imp.toFixed(2)} dto=${l.DTO}%`);
            }
            console.log(`  ─── LINE SUM = ${lineSum.toFixed(2)} ───`);
            console.log('');
        }

        // ────────────────────────────────────────────────
        // 4. Buscar 9013.64 y 16539.32 en CAC
        // ────────────────────────────────────────────────
        console.log('═══ 4. Buscando importes 9013.64 y 16539.32 en CAC ═══');
        const suspicious1 = await conn.query(`
            SELECT
                TRIM(CAC.SERIEFACTURA) as SERIE, CAC.NUMEROFACTURA, CAC.EJERCICIOFACTURA,
                TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE,
                CAC.IMPORTETOTAL,
                CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3 as BASE
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CAC.CODIGOCLIENTEFACTURA
            WHERE (ABS(CAC.IMPORTETOTAL - 9013.64) < 0.01
               OR ABS(CAC.IMPORTETOTAL - 16539.32) < 0.01
               OR ABS(CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3 - 9013.64) < 0.01
               OR ABS(CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3 - 16539.32) < 0.01)
            FETCH FIRST 20 ROWS ONLY
        `);
        console.log(`Found ${suspicious1.length} rows matching 9013.64 or 16539.32`);
        for (const r of suspicious1) {
            console.log(`  ${r.SERIE}-${r.NUMEROFACTURA} (${r.EJERCICIOFACTURA}) | ${r.CLIENTE} ${r.NOMBRE} | total=${r.IMPORTETOTAL} base=${r.BASE}`);
        }
        console.log('');

        // ────────────────────────────────────────────────
        // 5. Buscar en CVC (cobros/vencimientos) para el cliente de F-14678
        // ────────────────────────────────────────────────
        if (cac14678.length > 0) {
            const cliente = cac14678[0].CLIENTE;
            console.log(`═══ 5. CVC (cobros/vencimientos) para cliente ${cliente} ═══`);
            try {
                const cvc = await conn.query(`
                    SELECT
                        CVC.EJERCICIODOCUMENTO, CVC.SERIEDOCUMENTO, CVC.NUMERODOCUMENTO,
                        CVC.IMPORTEPENDIENTE, CVC.IMPORTERECIBO, CVC.IMPORTEEFECTO,
                        TRIM(CVC.CODIGOCLIENTE) as CLI
                    FROM DSEDAC.CVC CVC
                    WHERE TRIM(CVC.CODIGOCLIENTE) = '${cliente}'
                      AND (ABS(CVC.IMPORTEPENDIENTE - 9013.64) < 0.01
                        OR ABS(CVC.IMPORTEPENDIENTE - 16539.32) < 0.01
                        OR ABS(CVC.IMPORTERECIBO - 9013.64) < 0.01
                        OR ABS(CVC.IMPORTERECIBO - 16539.32) < 0.01
                        OR ABS(CVC.IMPORTEEFECTO - 9013.64) < 0.01
                        OR ABS(CVC.IMPORTEEFECTO - 16539.32) < 0.01)
                    FETCH FIRST 20 ROWS ONLY
                `);
                console.log(`Found ${cvc.length} CVC rows with these amounts`);
                for (const r of cvc) {
                    console.log(`  Doc: ${r.SERIEDOCUMENTO}-${r.NUMERODOCUMENTO} (${r.EJERCICIODOCUMENTO}) | pendiente=${r.IMPORTEPENDIENTE} recibo=${r.IMPORTERECIBO} efecto=${r.IMPORTEEFECTO}`);
                }
            } catch (e) {
                console.log(`  CVC query failed: ${e.message}`);
            }
            console.log('');

            // Also check total pendiente for this client
            console.log(`═══ 5b. Total pendiente para cliente ${cliente} ═══`);
            try {
                const pending = await conn.query(`
                    SELECT
                        SUM(CVC.IMPORTEPENDIENTE) as TOTAL_PENDIENTE,
                        SUM(CVC.IMPORTERECIBO) as TOTAL_RECIBOS,
                        COUNT(*) as NUM_DOCS
                    FROM DSEDAC.CVC CVC
                    WHERE TRIM(CVC.CODIGOCLIENTE) = '${cliente}'
                      AND CVC.IMPORTEPENDIENTE > 0
                `);
                if (pending.length > 0) {
                    console.log(`  Total pendiente: ${pending[0].TOTAL_PENDIENTE}`);
                    console.log(`  Total recibos: ${pending[0].TOTAL_RECIBOS}`);
                    console.log(`  Num docs: ${pending[0].NUM_DOCS}`);
                }
            } catch (e) {
                console.log(`  Pending query failed: ${e.message}`);
            }
            console.log('');
        }

        // ────────────────────────────────────────────────
        // 6. Buscar en repartidor history el doc 14678
        // ────────────────────────────────────────────────
        console.log('═══ 6. CPC+OPP para NUMEROFACTURA referenciando 14678 ═══');
        try {
            // CAC stores the factura link, CPC has the delivery
            if (cac14678.length > 0) {
                const albs = cac14678.map(r =>
                    `(CPC.EJERCICIOALBARAN=${r.EJERCICIOALBARAN} AND CPC.SERIEALBARAN='${r.SERIE_ALB}' AND CPC.TERMINALALBARAN=${r.TERMINALALBARAN} AND CPC.NUMEROALBARAN=${r.NUMEROALBARAN})`
                ).join(' OR ');

                const cpc = await conn.query(`
                    SELECT
                        CPC.EJERCICIOALBARAN, TRIM(CPC.SERIEALBARAN) as SERIE, CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                        CPC.IMPORTETOTAL, CPC.IMPORTEBRUTO,
                        TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                        TRIM(CPC.CONFORMADOSN) as CONFORMADO,
                        CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO
                    FROM DSEDAC.CPC CPC
                    WHERE ${albs}
                `);
                console.log(`Found ${cpc.length} CPC rows linked to F-14678`);
                for (const r of cpc) {
                    console.log(`  Alb: ${r.SERIE}-${r.TERMINALALBARAN}-${r.NUMEROALBARAN} | total=${r.IMPORTETOTAL} bruto=${r.IMPORTEBRUTO} | conformado=${r.CONFORMADO} | ${r.DIADOCUMENTO}/${r.MESDOCUMENTO}/${r.ANODOCUMENTO}`);
                }

                // Check DELIVERY_STATUS for these
                for (const r of cpc) {
                    const dsId = `${r.EJERCICIOALBARAN}-${r.SERIE}-${r.TERMINALALBARAN}-${r.NUMEROALBARAN}`;
                    try {
                        const ds = await conn.query(`SELECT * FROM JAVIER.DELIVERY_STATUS WHERE ID LIKE '${dsId}%'`);
                        if (ds.length > 0) {
                            console.log(`  DELIVERY_STATUS for ${dsId}: status=${ds[0].STATUS} firma=${ds[0].FIRMA_PATH || 'NULL'} repartidor=${ds[0].REPARTIDOR_ID}`);
                        }
                    } catch (_) {}
                }
            }
        } catch (e) {
            console.log(`  CPC query failed: ${e.message}`);
        }
        console.log('');

        // ────────────────────────────────────────────────
        // 7. Buscar si "Pendiente"/"Entregado" vienen de CVC
        // ────────────────────────────────────────────────
        console.log('═══ 7. Columnas CVC disponibles ═══');
        try {
            const cols = await conn.query(`
                SELECT COLUMN_NAME, DATA_TYPE
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CVC'
                ORDER BY ORDINAL_POSITION
            `);
            console.log(`CVC has ${cols.length} columns:`);
            for (const c of cols) {
                const name = (c.COLUMN_NAME || '').trim();
                if (name.includes('PEND') || name.includes('ENTREG') || name.includes('IMPORT') || name.includes('ESTADO') || name.includes('COBR')) {
                    console.log(`  >>> ${name} (${c.DATA_TYPE})`);
                }
            }
        } catch (e) {
            console.log(`  Schema query failed: ${e.message}`);
        }
        console.log('');

        // ────────────────────────────────────────────────
        // 8. Explorar si hay una tabla de histórico de repartidores
        // ────────────────────────────────────────────────
        console.log('═══ 8. Tablas JAVIER.* disponibles ═══');
        try {
            const tables = await conn.query(`
                SELECT TABLE_NAME FROM QSYS2.SYSTABLES
                WHERE TABLE_SCHEMA = 'JAVIER'
                ORDER BY TABLE_NAME
            `);
            for (const t of tables) {
                console.log(`  JAVIER.${(t.TABLE_NAME || '').trim()}`);
            }
        } catch (e) {
            console.log(`  Schema query failed: ${e.message}`);
        }

        console.log('\n═══ DONE ═══');

    } catch (error) {
        console.error('❌ Fatal:', error.message);
    } finally {
        if (conn) try { await conn.close(); } catch (_) {}
    }
}

main();
