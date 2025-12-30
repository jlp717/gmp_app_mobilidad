/**
 * Explore database for potential new features
 * Run with: node explore_features.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function explore() {
    console.log('='.repeat(70));
    console.log('EXPLORING DATABASE FOR NEW FEATURES');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Check for pending invoices/payments (CVC table)
        console.log('\n1. 📋 PENDING INVOICES (for alerts/notifications)...');
        try {
            const pending = await conn.query(`
        SELECT COUNT(*) as TOTAL, SUM(IMPORTEVENCIMIENTO) as AMOUNT
        FROM DSEDAC.CVC
        WHERE ANOEMISION = 2024
      `);
            console.log(`   Total invoices: ${pending[0]?.TOTAL}, Amount: ${parseFloat(pending[0]?.AMOUNT || 0).toFixed(2)}€`);
        } catch (e) { console.log('   Error:', e.message); }

        // 2. Check for client contact info (for call/email tracking)
        console.log('\n2. 📞 CLIENT CONTACT FIELDS...');
        try {
            const contacts = await conn.query(`
        SELECT 
          CODIGOCLIENTE,
          NOMBRECLIENTE,
          TELEFONO1,
          TELEFONO2,
          PERSONACONTACTO,
          EMAIL
        FROM DSEDAC.CLI
        WHERE TELEFONO1 IS NOT NULL OR EMAIL IS NOT NULL
        FETCH FIRST 3 ROWS ONLY
      `);
            contacts.forEach(c => {
                console.log(`   ${c.CODIGOCLIENTE?.trim()} | Tel: ${c.TELEFONO1?.trim() || 'N/A'} | Email: ${c.EMAIL?.trim() || 'N/A'} | Contact: ${c.PERSONACONTACTO?.trim() || 'N/A'}`);
            });
        } catch (e) { console.log('   Error:', e.message); }

        // 3. Check order/delivery status tables
        console.log('\n3. 📦 ORDER TABLES (for delivery tracking)...');
        try {
            const tables = await conn.query(`
        SELECT TABNAME FROM SYSCAT.TABLES 
        WHERE TABSCHEMA = 'DSEDAC' 
          AND (TABNAME LIKE '%PED%' OR TABNAME LIKE '%ENV%' OR TABNAME LIKE '%ALB%' OR TABNAME LIKE '%ORD%')
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('   Order-related tables:');
            tables.forEach(t => console.log(`     - ${t.TABNAME}`));
        } catch (e) { console.log('   Error:', e.message); }

        // 4. Check for notes/comments fields
        console.log('\n4. 📝 CLIENT NOTES/OBSERVATIONS...');
        try {
            const notes = await conn.query(`
        SELECT CODIGOCLIENTE, OBSERVACIONES, OBSERVACIONES2
        FROM DSEDAC.CLI
        WHERE OBSERVACIONES IS NOT NULL AND LENGTH(TRIM(OBSERVACIONES)) > 0
        FETCH FIRST 3 ROWS ONLY
      `);
            notes.forEach(n => {
                console.log(`   ${n.CODIGOCLIENTE?.trim()}: "${(n.OBSERVACIONES?.trim() || '').substring(0, 50)}..."`);
            });
        } catch (e) { console.log('   Error:', e.message); }

        // 5. Check for promotions/discounts tables
        console.log('\n5. 🏷️ PROMOTIONS/DISCOUNT TABLES...');
        try {
            const promos = await conn.query(`
        SELECT TABNAME FROM SYSCAT.TABLES 
        WHERE TABSCHEMA = 'DSEDAC' 
          AND (TABNAME LIKE '%PROM%' OR TABNAME LIKE '%DESC%' OR TABNAME LIKE '%OFE%' OR TABNAME LIKE '%TAR%')
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('   Promo-related tables:');
            promos.forEach(t => console.log(`     - ${t.TABNAME}`));
        } catch (e) { console.log('   Error:', e.message); }

        // 6. Check for sales rankings
        console.log('\n6. 🏆 VENDEDOR RANKINGS (current year)...');
        try {
            const rankings = await conn.query(`
        SELECT 
          CODIGOVENDEDOR,
          SUM(IMPORTEVENTA) as VENTAS
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = 2024
        GROUP BY CODIGOVENDEDOR
        ORDER BY VENTAS DESC
        FETCH FIRST 5 ROWS ONLY
      `);
            console.log('   Top 5 commercials 2024:');
            let rank = 1;
            rankings.forEach(r => {
                console.log(`     #${rank++} Vendedor ${r.CODIGOVENDEDOR?.trim()}: ${parseFloat(r.VENTAS).toFixed(2)}€`);
            });
        } catch (e) { console.log('   Error:', e.message); }

        // 7. Check for alerts/warnings fields
        console.log('\n7. ⚠️ CLIENT ALERT FIELDS (blocked, credit, risk)...');
        try {
            const alerts = await conn.query(`
        SELECT 
          CODIGOCLIENTE,
          BLOQUEADO,
          BLOQUEADOVENCIDOS,
          ASEGURADO,
          TIPORIESGO
        FROM DSEDAC.CLI
        WHERE BLOQUEADO = 'S' OR BLOQUEADOVENCIDOS = 'S'
        FETCH FIRST 5 ROWS ONLY
      `);
            if (alerts.length > 0) {
                console.log('   Clients with alerts:');
                alerts.forEach(a => {
                    console.log(`     ${a.CODIGOCLIENTE?.trim()} | Bloq: ${a.BLOQUEADO?.trim()} | BloqVenc: ${a.BLOQUEADOVENCIDOS?.trim()} | Risk: ${a.TIPORIESGO?.trim()}`);
                });
            } else {
                console.log('   No blocked clients found');
            }
        } catch (e) { console.log('   Error:', e.message); }

        // 8. Check for product categories (families)
        console.log('\n8. 📂 PRODUCT FAMILIES (for filtering)...');
        try {
            const families = await conn.query(`
        SELECT CODIGOFAMILIA, DESCRIPCIONFAMILIA
        FROM DSEDAC.FAM
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('   Product families:');
            families.forEach(f => console.log(`     ${f.CODIGOFAMILIA?.trim()} | ${f.DESCRIPCIONFAMILIA?.trim()}`));
        } catch (e) { console.log('   Error:', e.message); }

        // 9. Check for visit schedule in CLI
        console.log('\n9. 📅 CLIENT SCHEDULE FIELDS...');
        try {
            const schedule = await conn.query(`
        SELECT COLNAME FROM SYSCAT.COLUMNS 
        WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'CLI'
          AND (COLNAME LIKE '%VISIT%' OR COLNAME LIKE '%RUTA%' OR COLNAME LIKE '%DIA%' OR COLNAME LIKE '%HORA%')
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('   Schedule-related columns in CLI:');
            schedule.forEach(s => console.log(`     - ${s.COLNAME}`));
        } catch (e) { console.log('   Error:', e.message); }

        // 10. Check for payment terms
        console.log('\n10. 💳 PAYMENT TERMS FIELDS...');
        try {
            const terms = await conn.query(`
        SELECT COLNAME FROM SYSCAT.COLUMNS 
        WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'CLI'
          AND (COLNAME LIKE '%PAGO%' OR COLNAME LIKE '%CRED%' OR COLNAME LIKE '%DIAS%' OR COLNAME LIKE '%VENC%')
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('   Payment-related columns in CLI:');
            terms.forEach(t => console.log(`     - ${t.COLNAME}`));
        } catch (e) { console.log('   Error:', e.message); }

        console.log('\n' + '='.repeat(70));
        console.log('EXPLORATION COMPLETE');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('Connection error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

explore().catch(console.error);
