/**
 * Create JAVIER.PAYMENT_CONDITIONS table to manage payment types
 * This replaces hardcoded PAYMENT_TYPES mapping in entregas.js
 */

const { query, initDb } = require('../config/db');

async function createPaymentConditionsTable() {
    await initDb();

    console.log('=== CREATING JAVIER.PAYMENT_CONDITIONS TABLE ===\n');

    // Drop if exists (for development)
    try {
        await query(`DROP TABLE JAVIER.PAYMENT_CONDITIONS`, false);
        console.log('Dropped existing table');
    } catch (e) {
        console.log('Table did not exist (OK)');
    }

    // Create table
    try {
        await query(`
            CREATE TABLE JAVIER.PAYMENT_CONDITIONS (
                CODIGO VARCHAR(10) NOT NULL PRIMARY KEY,
                DESCRIPCION VARCHAR(100) NOT NULL,
                TIPO VARCHAR(20) NOT NULL,           -- CONTADO, CREDITO, REPOSICION, TRANSFERENCIA, DOMICILIADO, GIRO, PAGARE
                DIAS_PAGO INTEGER DEFAULT 0,          -- Días para pago (0=inmediato, 7=repo, 30, 60, etc.)
                DEBE_COBRAR CHAR(1) DEFAULT 'N',      -- S/N: Repartidor DEBE cobrar
                PUEDE_COBRAR CHAR(1) DEFAULT 'N',     -- S/N: Repartidor PUEDE cobrar (opcional)
                COLOR VARCHAR(10) DEFAULT 'green',   -- red, green, orange
                ACTIVO CHAR(1) DEFAULT 'S',
                CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                NOTAS VARCHAR(200)
            )
        `, false);
        console.log('✅ Table created successfully');
    } catch (e) {
        console.log('Error creating table:', e.message);
        process.exit(1);
    }

    // Insert payment conditions based on typical ERP patterns and user requirements
    const conditions = [
        // CONTADO - Must collect immediately
        { codigo: '01', desc: 'CONTADO', tipo: 'CONTADO', dias: 0, debe: 'S', puede: 'S', color: 'red' },
        { codigo: 'C2', desc: 'CONTADO', tipo: 'CONTADO', dias: 0, debe: 'S', puede: 'S', color: 'red' },
        { codigo: 'C5', desc: 'CONTADO', tipo: 'CONTADO', dias: 0, debe: 'S', puede: 'S', color: 'red' },

        // REPOSICIÓN - Must collect on next visit
        { codigo: 'RP', desc: 'REPOSICIÓN', tipo: 'REPOSICION', dias: 7, debe: 'S', puede: 'S', color: 'red' },

        // CRÉDITO - No collection needed
        { codigo: '02', desc: 'CRÉDITO', tipo: 'CREDITO', dias: 30, debe: 'N', puede: 'N', color: 'green' },

        // DOMICILIADO - Bank direct debit, no collection
        { codigo: 'D1', desc: 'RECIBO DOMICILIADO 0 DÍAS', tipo: 'DOMICILIADO', dias: 2, debe: 'N', puede: 'N', color: 'green' },
        { codigo: 'D2', desc: 'RECIBO DOMICILIADO 15 DÍAS', tipo: 'DOMICILIADO', dias: 15, debe: 'N', puede: 'N', color: 'green' },
        { codigo: 'D3', desc: 'RECIBO DOMICILIADO 30 DÍAS', tipo: 'DOMICILIADO', dias: 30, debe: 'N', puede: 'N', color: 'green' },
        { codigo: 'D4', desc: 'RECIBO DOMICILIADO 45 DÍAS', tipo: 'DOMICILIADO', dias: 45, debe: 'N', puede: 'N', color: 'green' },
        { codigo: 'D6', desc: 'RECIBO DOMICILIADO 60 DÍAS', tipo: 'DOMICILIADO', dias: 60, debe: 'N', puede: 'N', color: 'green' },
        { codigo: 'D8', desc: 'RECIBO DOMICILIADO 80 DÍAS', tipo: 'DOMICILIADO', dias: 80, debe: 'N', puede: 'N', color: 'green' },
        { codigo: 'D9', desc: 'RECIBO DOMICILIADO 90 DÍAS', tipo: 'DOMICILIADO', dias: 90, debe: 'N', puede: 'N', color: 'green' },
        { codigo: 'DA', desc: 'RECIBO DOMICILIADO 120 DÍAS', tipo: 'DOMICILIADO', dias: 120, debe: 'N', puede: 'N', color: 'green' },

        // TRANSFERENCIA - Optional collection (may want to collect cash instead)
        { codigo: 'T0', desc: 'TRANSFERENCIA', tipo: 'TRANSFERENCIA', dias: 0, debe: 'N', puede: 'S', color: 'orange' },
        { codigo: 'T1', desc: 'TRANSFERENCIA 30 DÍAS', tipo: 'TRANSFERENCIA', dias: 30, debe: 'N', puede: 'S', color: 'orange' },

        // GIRO - Bank draft, no collection
        { codigo: 'G1', desc: 'GIRO 30 DÍAS', tipo: 'GIRO', dias: 30, debe: 'N', puede: 'N', color: 'green' },
        { codigo: 'G6', desc: 'GIRO 60 DÍAS', tipo: 'GIRO', dias: 60, debe: 'N', puede: 'N', color: 'green' },

        // PAGARÉ - Promissory note
        { codigo: 'PG', desc: 'PAGARÉ', tipo: 'PAGARE', dias: 30, debe: 'N', puede: 'N', color: 'green' },
        { codigo: 'P1', desc: 'PAGARÉ 30 DÍAS', tipo: 'PAGARE', dias: 30, debe: 'N', puede: 'N', color: 'green' },
    ];

    console.log('\nInserting payment conditions...');
    for (const c of conditions) {
        try {
            await query(`
                INSERT INTO JAVIER.PAYMENT_CONDITIONS 
                (CODIGO, DESCRIPCION, TIPO, DIAS_PAGO, DEBE_COBRAR, PUEDE_COBRAR, COLOR)
                VALUES ('${c.codigo}', '${c.desc}', '${c.tipo}', ${c.dias}, '${c.debe}', '${c.puede}', '${c.color}')
            `, false);
            console.log(`  ✅ ${c.codigo}: ${c.desc}`);
        } catch (e) {
            console.log(`  ❌ ${c.codigo}: ${e.message}`);
        }
    }

    console.log('\n=== VERIFICATION ===');
    try {
        const verify = await query(`SELECT * FROM JAVIER.PAYMENT_CONDITIONS ORDER BY CODIGO`);
        console.log(`Total records: ${verify.length}`);
        verify.forEach(r => {
            const mustCollect = r.DEBE_COBRAR === 'S' ? '🔴' : (r.PUEDE_COBRAR === 'S' ? '🟠' : '🟢');
            console.log(`  ${mustCollect} ${r.CODIGO}: ${r.DESCRIPCION} (${r.TIPO}, ${r.DIAS_PAGO}d)`);
        });
    } catch (e) {
        console.log('Verification error:', e.message);
    }

    process.exit();
}

createPaymentConditionsTable();
