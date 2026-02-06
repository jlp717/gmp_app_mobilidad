const { query } = require('../config/db');

async function createUser() {
    const USER = 'DIEGO';
    const PASS = '9322';
    const NAME = 'DIEGO ADMIN';

    console.log(`Creating user ${USER}...`);

    try {
        // 1. DSEDAC.VDPL1 (Credentials)
        // Check if exists
        const check = await query(`SELECT 1 FROM DSEDAC.VDPL1 WHERE CODIGOVENDEDOR = '${USER}'`);
        if (check.length > 0) {
            console.log('User already exists in VDPL1. Updating password...');
            await query(`UPDATE DSEDAC.VDPL1 SET CODIGOPIN = '${PASS}' WHERE CODIGOVENDEDOR = '${USER}'`);
        } else {
            console.log('Inserting into VDPL1...');
            await query(`INSERT INTO DSEDAC.VDPL1 (CODIGOVENDEDOR, CODIGOPIN) VALUES ('${USER}', '${PASS}')`);
        }

        // 2. DSEDAC.VDD (Name)
        const checkVDD = await query(`SELECT 1 FROM DSEDAC.VDD WHERE CODIGOVENDEDOR = '${USER}'`);
        if (checkVDD.length === 0) {
            console.log('Inserting into VDD...');
            await query(`INSERT INTO DSEDAC.VDD (CODIGOVENDEDOR, NOMBREVENDEDOR) VALUES ('${USER}', '${NAME}')`);
        }

        // 3. DSEDAC.VDC (Company Link)
        const checkVDC = await query(`SELECT 1 FROM DSEDAC.VDC WHERE CODIGOVENDEDOR = '${USER}' AND SUBEMPRESA = 'GMP'`);
        if (checkVDC.length === 0) {
            console.log('Inserting into VDC...');
            await query(`INSERT INTO DSEDAC.VDC (CODIGOVENDEDOR, SUBEMPRESA, TIPOVENDEDOR) VALUES ('${USER}', 'GMP', 'ADMIN')`);
        }

        // 4. DSEDAC.VDDX (Privileges)
        const checkVDDX = await query(`SELECT 1 FROM DSEDAC.VDDX WHERE CODIGOVENDEDOR = '${USER}'`);
        if (checkVDDX.length > 0) {
            console.log('Updating VDDX privileges...');
            await query(`UPDATE DSEDAC.VDDX SET JEFEVENTASSN = 'S' WHERE CODIGOVENDEDOR = '${USER}'`);
        } else {
            console.log('Inserting into VDDX...');
            await query(`INSERT INTO DSEDAC.VDDX (CODIGOVENDEDOR, JEFEVENTASSN) VALUES ('${USER}', 'S')`);
        }

        console.log('✅ User DIEGO created successfully.');

    } catch (e) {
        console.error('❌ Error creating user:', e.message);
    }
    process.exit();
}

createUser();
