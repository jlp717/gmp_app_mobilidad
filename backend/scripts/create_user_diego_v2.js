const { query } = require('../config/db');

async function createUser() {
    const USER = 'DIEGO';
    const PASS = 9322; // Numeric
    const NAME = 'DIEGO ADMIN';

    console.log(`Creating user ${USER} with PIN ${PASS}...`);

    try {
        // 1. DSEDAC.VDPL1
        console.log('Checking VDPL1...');
        const check = await query(`SELECT * FROM DSEDAC.VDPL1 WHERE TRIM(CODIGOVENDEDOR) = '${USER}'`, false, false);

        if (check.length > 0) {
            console.log('User exists in VDPL1. Updating PIN...');
            await query(`UPDATE DSEDAC.VDPL1 SET CODIGOPIN = ${PASS} WHERE CODIGOVENDEDOR = '${USER}'`);
        } else {
            console.log('Inserting into VDPL1...');
            // Try numeric pin
            await query(`INSERT INTO DSEDAC.VDPL1 (CODIGOVENDEDOR, CODIGOPIN) VALUES ('${USER}', ${PASS})`);
        }

        // 2. DSEDAC.VDD
        const checkVDD = await query(`SELECT * FROM DSEDAC.VDD WHERE TRIM(CODIGOVENDEDOR) = '${USER}'`, false, false);
        if (checkVDD.length === 0) {
            console.log('Inserting into VDD...');
            await query(`INSERT INTO DSEDAC.VDD (CODIGOVENDEDOR, NOMBREVENDEDOR) VALUES ('${USER}', '${NAME}')`);
        }

        // 3. DSEDAC.VDC
        const checkVDC = await query(`SELECT * FROM DSEDAC.VDC WHERE TRIM(CODIGOVENDEDOR) = '${USER}' AND SUBEMPRESA = 'GMP'`, false, false);
        if (checkVDC.length === 0) {
            console.log('Inserting into VDC...');
            await query(`INSERT INTO DSEDAC.VDC (CODIGOVENDEDOR, SUBEMPRESA, TIPOVENDEDOR) VALUES ('${USER}', 'GMP', 'ADMIN')`);
        }

        // 4. DSEDAC.VDDX
        const checkVDDX = await query(`SELECT * FROM DSEDAC.VDDX WHERE TRIM(CODIGOVENDEDOR) = '${USER}'`, false, false);
        if (checkVDDX.length > 0) {
            console.log('Updating VDDX...');
            await query(`UPDATE DSEDAC.VDDX SET JEFEVENTASSN = 'S' WHERE CODIGOVENDEDOR = '${USER}'`);
        } else {
            console.log('Inserting into VDDX...');
            await query(`INSERT INTO DSEDAC.VDDX (CODIGOVENDEDOR, JEFEVENTASSN) VALUES ('${USER}', 'S')`);
        }

        console.log('✅ User DIEGO created/updated successfully.');

    } catch (e) {
        console.error('❌ Error:', e.message);
        if (e.odbcErrors) console.error(JSON.stringify(e.odbcErrors, null, 2));
    }
    process.exit();
}

createUser();
