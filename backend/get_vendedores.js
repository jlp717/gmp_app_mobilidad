/**
 * Get vendedores list from VDC
 * Run with: node get_vendedores.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function getVendedores() {
    console.log('='.repeat(80));
    console.log('LISTA COMPLETA DE VENDEDORES (para poder hacer login)');
    console.log('='.repeat(80));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Get all vendedores from VDC
        console.log('\n👤 VENDEDORES EN VDC:');
        console.log('-'.repeat(70));

        const vendedores = await conn.query(`
      SELECT 
        CODIGOVENDEDOR,
        NOMBREVENDEDOR,
        TIPOVENDEDOR
      FROM DSEDAC.VDC
      ORDER BY CODIGOVENDEDOR
    `);

        console.log('Código | Nombre                              | Tipo | Login (código como usuario)');
        console.log('-'.repeat(80));
        vendedores.forEach(v => {
            const code = (v.CODIGOVENDEDOR || '').trim();
            const name = (v.NOMBREVENDEDOR || '').trim().substring(0, 35).padEnd(35);
            const tipo = (v.TIPOVENDEDOR || '').trim().padEnd(4);
            console.log(`${code.padEnd(6)} | ${name} | ${tipo} | Usuario: ${code}`);
        });

        console.log('\n\n📊 RESUMEN:');
        console.log(`  Total vendedores: ${vendedores.length}`);
        console.log(`  Tipo P (Promotor): ${vendedores.filter(v => v.TIPOVENDEDOR?.trim() === 'P').length}`);
        console.log(`  Tipo A (Autónomo): ${vendedores.filter(v => v.TIPOVENDEDOR?.trim() === 'A').length}`);

        // Specific famous vendedores
        console.log('\n\n🌟 VENDEDORES DESTACADOS:');
        console.log('-'.repeat(50));
        const famous = ['33', '93', '03', '10', '16', '02'];
        vendedores.filter(v => famous.includes(v.CODIGOVENDEDOR?.trim())).forEach(v => {
            console.log(`  ${v.CODIGOVENDEDOR?.trim()} = ${v.NOMBREVENDEDOR?.trim()}`);
        });

        console.log('\n' + '='.repeat(80));
        console.log('NOTA: Para login, usa el código de vendedor como usuario.');
        console.log('Las contraseñas dependen de la configuración en JAVIER.CUSTOMER_PASSWORDS');
        console.log('='.repeat(80));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

getVendedores().catch(console.error);
