const { query, initDb } = require('../config/db');

async function createCommercialTargets() {
    await initDb();

    // 1. Create the main COMMERCIAL_TARGETS table (DB2 compatible syntax)
    console.log('=== Creating COMMERCIAL_TARGETS Table ===');
    try {
        await query(`
            CREATE TABLE JAVIER.COMMERCIAL_TARGETS (
                ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1),
                CODIGOVENDEDOR VARCHAR(10) NOT NULL,
                ANIO INTEGER NOT NULL,
                MES INTEGER,
                IMPORTE_OBJETIVO DECIMAL(12,2) NOT NULL,
                IMPORTE_BASE_COMISION DECIMAL(12,2),
                PORCENTAJE_MEJORA DECIMAL(5,2) DEFAULT 10.00,
                DESCRIPCION VARCHAR(200),
                ACTIVO SMALLINT DEFAULT 1,
                VIGENTE_DESDE DATE NOT NULL,
                VIGENTE_HASTA DATE,
                CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CREATED_BY VARCHAR(50),
                PRIMARY KEY (ID)
            )
        `, false);
        console.log('✅ Table COMMERCIAL_TARGETS created successfully');
    } catch (e) {
        if (e.message.includes('already exists') || e.message.includes('exists')) {
            console.log('⚠️ Table already exists, continuing...');
        } else {
            console.log('❌ Error creating table:', e.message);
            // Try to continue anyway
        }
    }

    // 2. Create history table
    console.log('\n=== Creating COMMERCIAL_TARGETS_HISTORY Table ===');
    try {
        await query(`
            CREATE TABLE JAVIER.COMMERCIAL_TARGETS_HISTORY (
                ID INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1),
                TARGET_ID INTEGER,
                CODIGOVENDEDOR VARCHAR(10) NOT NULL,
                ANIO INTEGER NOT NULL,
                MES INTEGER,
                OLD_IMPORTE DECIMAL(12,2),
                NEW_IMPORTE DECIMAL(12,2),
                CHANGE_TYPE VARCHAR(20),
                CHANGE_DATE TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CHANGED_BY VARCHAR(50),
                MOTIVO VARCHAR(200),
                PRIMARY KEY (ID)
            )
        `, false);
        console.log('✅ History table created');
    } catch (e) {
        if (e.message.includes('exists')) {
            console.log('⚠️ History table already exists');
        } else {
            console.log('❌ Error:', e.message);
        }
    }

    // 3. Insert data for commercial #15
    console.log('\n=== Inserting Data for Commercial #15 ===');

    const objetivo = 25000.00;
    const baseComision = Math.round((objetivo / 1.10) * 100) / 100; // 22,727.27€

    console.log(`Objective: ${objetivo}€`);
    console.log(`Commission Base: ${baseComision}€`);

    for (let mes = 1; mes <= 12; mes++) {
        try {
            await query(`
                INSERT INTO JAVIER.COMMERCIAL_TARGETS 
                (CODIGOVENDEDOR, ANIO, MES, IMPORTE_OBJETIVO, IMPORTE_BASE_COMISION, PORCENTAJE_MEJORA, DESCRIPCION, VIGENTE_DESDE, CREATED_BY)
                VALUES ('15', 2026, ${mes}, ${objetivo}, ${baseComision}, 10.00, 'Comercial nuevo - objetivo fijo mensual', CURRENT_DATE, 'SYSTEM')
            `, false);
            console.log(`✅ Month ${mes} inserted`);
        } catch (e) {
            console.log(`❌ Month ${mes}:`, e.message.substring(0, 50));
        }
    }

    // 4. Record history
    try {
        await query(`
            INSERT INTO JAVIER.COMMERCIAL_TARGETS_HISTORY 
            (CODIGOVENDEDOR, ANIO, MES, NEW_IMPORTE, CHANGE_TYPE, CHANGED_BY, MOTIVO)
            VALUES ('15', 2026, 0, ${objetivo}, 'INITIAL', 'SYSTEM', 'Configuracion inicial comercial nuevo')
        `, false);
        console.log('✅ History recorded');
    } catch (e) {
        console.log('History error:', e.message.substring(0, 50));
    }

    // 5. Verify
    console.log('\n=== Verification ===');
    try {
        const data = await query(`SELECT * FROM JAVIER.COMMERCIAL_TARGETS WHERE CODIGOVENDEDOR = '15' FETCH FIRST 3 ROWS ONLY`, false);
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.log('Verify error:', e.message);
    }

    process.exit();
}

createCommercialTargets();
