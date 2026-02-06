require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

// Configuration
// Using 95, 96, 97 to avoid conflicts with real commercials (usually 1-50) and Diego (99).
const NEW_USERS = [
    { code: '95', name: 'MARILOLA', pass: 9322 },
    { code: '96', name: 'MARTIN', pass: 9322 },
    { code: '97', name: 'ALBERTO', pass: 9322 }
];

async function createSalesManagers() {
    console.log('🚀 Creating Sales Managers (Jefe de Ventas)...');

    for (const user of NEW_USERS) {
        console.log(`\n👤 Processing ${user.name} (Code: ${user.code})...`);
        const { code, name, pass } = user;

        try {
            // 1. VDPL1 (Login/Pin)
            const check = await query(`SELECT * FROM DSEDAC.VDPL1 WHERE TRIM(CODIGOVENDEDOR) = '${code}'`, false, false);
            if (check.length > 0) {
                console.log(`   - Updating PIN in VDPL1...`);
                await query(`UPDATE DSEDAC.VDPL1 SET CODIGOPIN = ${pass} WHERE CODIGOVENDEDOR = '${code}'`);
            } else {
                console.log(`   - Inserting into VDPL1...`);
                await query(`INSERT INTO DSEDAC.VDPL1 (CODIGOVENDEDOR, CODIGOPIN) VALUES ('${code}', ${pass})`);
            }

            // 2. VDD (Name)
            const checkVDD = await query(`SELECT * FROM DSEDAC.VDD WHERE TRIM(CODIGOVENDEDOR) = '${code}'`, false, false);
            if (checkVDD.length === 0) {
                console.log(`   - Inserting into VDD...`);
                await query(`INSERT INTO DSEDAC.VDD (CODIGOVENDEDOR, NOMBREVENDEDOR) VALUES ('${code}', '${name}')`);
            } else {
                console.log(`   - Updating Name in VDD...`);
                await query(`UPDATE DSEDAC.VDD SET NOMBREVENDEDOR = '${name}' WHERE CODIGOVENDEDOR = '${code}'`);
            }

            // 3. VDC (Subcompany / Type)
            const checkVDC = await query(`SELECT * FROM DSEDAC.VDC WHERE TRIM(CODIGOVENDEDOR) = '${code}' AND SUBEMPRESA = 'GMP'`, false, false);
            if (checkVDC.length === 0) {
                console.log(`   - Inserting into VDC...`);
                await query(`INSERT INTO DSEDAC.VDC (CODIGOVENDEDOR, SUBEMPRESA, TIPOVENDEDOR) VALUES ('${code}', 'GMP', 'ADMIN')`);
            } else {
                console.log(`   - Ensuring VDC is ADMIN...`);
                await query(`UPDATE DSEDAC.VDC SET TIPOVENDEDOR = 'ADMIN' WHERE CODIGOVENDEDOR = '${code}' AND SUBEMPRESA = 'GMP'`);
            }

            // 4. VDDX (Permissions / Jefe Ventas Flag)
            const checkVDDX = await query(`SELECT * FROM DSEDAC.VDDX WHERE TRIM(CODIGOVENDEDOR) = '${code}'`, false, false);
            if (checkVDDX.length > 0) {
                console.log(`   - Updating Authorization in VDDX...`);
                await query(`UPDATE DSEDAC.VDDX SET JEFEVENTASSN = 'S' WHERE CODIGOVENDEDOR = '${code}'`);
            } else {
                console.log(`   - Inserting into VDDX...`);
                await query(`INSERT INTO DSEDAC.VDDX (CODIGOVENDEDOR, JEFEVENTASSN) VALUES ('${code}', 'S')`);
            }

            console.log(`✅ ${name} setup complete.`);

        } catch (e) {
            console.error(`❌ Error processing ${name}: ${e.message}`);
        }
    }

    console.log('\n✨ All users processed.');
    process.exit();
}

createSalesManagers();
