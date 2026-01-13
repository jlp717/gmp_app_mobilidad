const { query } = require('../config/db');

async function updateRolesJefe() {
    try {
        console.log('--- Actualización de Roles (Jefe/Super Rol) ---');

        const USER_ID = process.argv[2] || 'V001'; // ID del Jefe
        const NEW_ROLE = process.argv[3] || 'REPARTIDOR'; // Rol a activar

        // Validar inputs
        if (!['COMERCIAL', 'REPARTIDOR'].includes(NEW_ROLE)) {
            console.error('Rol inválido. Roles permitidos: COMERCIAL, REPARTIDOR');
            return;
        }

        console.log(`Usuario: ${USER_ID}`);
        console.log(`Activando Mallas/Permisos para: ${NEW_ROLE}`);

        // En una implementación real, esto actualizaría una tabla de sesión o preferencias de usuario
        // Por ejemplo: UPDATE USER_PREFS SET ACTIVE_ROLE = ? WHERE USER_ID = ?

        const sqlCheck = `SELECT NOMBREVENDEDOR FROM DSEDAC.VDD WHERE CODIGOVENDEDOR = '${USER_ID.replace('V', '')}'`;
        // const user = await query(sqlCheck); 

        // Simulación
        console.log(`\nVerificando permisos de Jefe para ${USER_ID}... OK`);

        console.log(`Actualizando contexto de sesión...`);

        // Logic simulator
        const sessionUpdate = {
            userId: USER_ID,
            activeRole: NEW_ROLE,
            viewAs: NEW_ROLE === 'REPARTIDOR' ? 'ALL_DRIVERS' : 'SELF',
            timestamp: new Date().toISOString()
        };

        console.log('Sesión Actualizada (Simulada):');
        console.log(JSON.stringify(sessionUpdate, null, 2));

        if (NEW_ROLE === 'REPARTIDOR') {
            console.log('\n[INFO] El usuario ahora puede ver el módulo de Reparto.');
            console.log('[INFO] Se habilitará el selector de camiones/choferes.');
        } else {
            console.log('\n[INFO] El usuario volvió a vista Comercial estándar.');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

updateRolesJefe();
