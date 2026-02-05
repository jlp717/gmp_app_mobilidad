require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../config/db');
const { generateInvoicePDF } = require('../app/services/pdfService');
const fs = require('fs');
const path = require('path');

async function main() {
    console.log(`\n📄 PDF VERIFICATION (CAC/LAC FALLBACK)\n`);

    // 1. Find a real invoice via CAC
    // Find CAC with NUMEROFACTURA > 0
    const sqlFac = `
        SELECT * FROM DSEDAC.CAC 
        WHERE NUMEROFACTURA > 0 
        ORDER BY EJERCICIOALBARAN DESC
        FETCH FIRST 1 ROW ONLY
    `
    const headers = await query(sqlFac, false);

    if (!headers || headers.length === 0) {
        console.error('No invoices found in CAC');
        process.exit(1);
    }
    // We need to fetch CLIENT details too, like in the real endpoint
    let header = headers[0];
    const { NUMEROFACTURA, SERIEFACTURA, EJERCICIOFACTURA } = header;

    console.log(`✅ Invoice found in CAC: ${EJERCICIOFACTURA}-${SERIEFACTURA}-${NUMEROFACTURA}`);

    // Now fetch full header like in Repartidor.js
    const realHeaderSql = `
            SELECT 
                CAC.EJERCICIOALBARAN, CAC.SERIEALBARAN, CAC.NUMEROALBARAN,
                CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
                CAC.DIADOCUMENTO as DIAFACTURA, CAC.MESDOCUMENTO as MESFACTURA, CAC.ANODOCUMENTO as ANOFACTURA,
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CODIGOCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
                TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
                TRIM(COALESCE(CLI.PROVINCIA, '')) as PROVINCIACLIENTEFACTURA,
                TRIM(COALESCE(CLI.CODIGOPOSTAL, '')) as CPCLIENTEFACTURA,
                TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
            WHERE CAC.NUMEROFACTURA = ${NUMEROFACTURA} 
              AND CAC.SERIEFACTURA = '${SERIEFACTURA}' 
              AND CAC.EJERCICIOFACTURA = ${EJERCICIOFACTURA}
            FETCH FIRST 1 ROW ONLY
    `;
    const realHeaders = await query(realHeaderSql, false);
    header = realHeaders[0];

    console.log(`   Customer: ${header.NOMBRECLIENTEFACTURA}`);

    // 2. Fetch Lines
    const sqlLines = `
            SELECT 
                LAC.CODIGOARTICULO,
                LAC.DESCRIPCION as DESCRIPCIONARTICULO,
                '' as LOTEARTICULO, -- Column missing in LAC
                LAC.CANTIDADUNIDADES as CANTIDADARTICULO,
                0 as CAJASARTICULO, -- Column missing in LAC
                LAC.IMPORTEVENTA as IMPORTENETOARTICULO,
                0 as PORCENTAJEIVAARTICULO, -- Column missing in LAC
                0 as PORCENTAJERECARGOARTICULO, -- Column missing in LAC
                LAC.PORCENTAJEDESCUENTO as PORCENTAJEDESCUENTOARTICULO,
                LAC.PRECIOVENTA as PRECIOARTICULO
            FROM DSEDAC.LAC LAC
            INNER JOIN DSEDAC.CAC CAC 
                 ON LAC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN 
                 AND LAC.SERIEALBARAN = CAC.SERIEALBARAN 
                 AND LAC.TERMINALALBARAN = CAC.TERMINALALBARAN 
                 AND LAC.NUMEROALBARAN = CAC.NUMEROALBARAN
            WHERE CAC.NUMEROFACTURA = ${NUMEROFACTURA} 
              AND CAC.SERIEFACTURA = '${SERIEFACTURA}' 
              AND CAC.EJERCICIOFACTURA = ${EJERCICIOFACTURA}
            ORDER BY CAC.ANODOCUMENTO, CAC.MESDOCUMENTO, CAC.DIADOCUMENTO, CAC.NUMEROALBARAN, LAC.SECUENCIA
    `;
    const lines = await query(sqlLines, false);
    console.log(`   Lines: ${lines.length}`);

    // 3. Generate PDF
    try {
        const buffer = await generateInvoicePDF({ header, lines });
        const outPath = path.join(__dirname, 'test_invoice.pdf');
        fs.writeFileSync(outPath, buffer);
        console.log(`✅ PDF generated successfully: ${outPath} (${buffer.length} bytes)`);
    } catch (e) {
        console.error('❌ PDF Generation Error:', e);
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
