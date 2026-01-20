const { query, initDb } = require('../config/db');

async function inspectTables() {
    try {
        await initDb();

        const candidates = [
            'OBJETIVOS_MENSUALES', 'OBJETIVOS', 'METAS',
            'COMISIONES_ESPECIALES', 'CONDICIONES_COMERCIALES', 'EXCEPCIONES_COMISIONES'
        ]; // Need to see the previous output to know real names, guessing for now or will use what I find.

        // Actually, let's just inspect ALL tables in JAVIER for now since I can't see the output yet clearly.
        // Or better, let's look for likely names based on previous command output if I had it.
        // Since I don't have the output yet (it's in the next turn), I'll write a generic inspector.

        console.log("🔍 Inspecting specific tables...");

        const tablesToCheck = [
            'OBJETIVOS_COMERCIALES',
            'CONFIGURACION_COMISIONES'
        ];

        for (const table of tablesToCheck) {
            try {
                console.log(`\n--- ${table} ---`);
                const rows = await query(`SELECT * FROM JAVIER.${table} FETCH FIRST 5 ROWS ONLY`, false);
                console.log(rows);
            } catch (e) {
                console.log(`Could not read ${table}: ${e.message}`);
            }
        }

    } catch (error) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit();
    }
}

inspectTables();
