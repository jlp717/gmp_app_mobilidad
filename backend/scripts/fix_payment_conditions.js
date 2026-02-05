/**
 * Agregar condiciones de pago faltantes
 * Uso: node fix_payment_conditions.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../config/db');

async function main() {
    console.log('\n🔧 AGREGANDO CONDICIONES DE PAGO FALTANTES\n');

    // Códigos faltantes encontrados en el diagnóstico
    const missing = [
        { code: 'R8', desc: 'REPOSICIÓN 80 DÍAS', tipo: 'REPOSICION', dias: 80, debe: 'S', puede: 'S', color: 'orange' },
        { code: 'R9', desc: 'REPOSICIÓN 90 DÍAS', tipo: 'REPOSICION', dias: 90, debe: 'S', puede: 'S', color: 'orange' },
        { code: 'EN', desc: 'ENTREGA', tipo: 'CONTADO', dias: 0, debe: 'S', puede: 'S', color: 'red' },
        { code: 'CR', desc: 'CRÉDITO ESPECIAL', tipo: 'CREDITO', dias: 30, debe: 'N', puede: 'S', color: 'green' },
    ];

    for (const m of missing) {
        try {
            // Verificar si ya existe
            const exists = await query(`SELECT 1 FROM JAVIER.PAYMENT_CONDITIONS WHERE CODIGO = '${m.code}'`, false);
            if (exists.length > 0) {
                console.log(`   ⏭️ ${m.code} ya existe, saltando`);
                continue;
            }

            await query(`
                INSERT INTO JAVIER.PAYMENT_CONDITIONS 
                (CODIGO, DESCRIPCION, TIPO, DIAS_PAGO, DEBE_COBRAR, PUEDE_COBRAR, COLOR, ACTIVO)
                VALUES ('${m.code}', '${m.desc}', '${m.tipo}', ${m.dias}, '${m.debe}', '${m.puede}', '${m.color}', 'S')
            `, false);
            console.log(`   ✅ Agregado: ${m.code} - ${m.desc}`);
        } catch (e) {
            console.log(`   ❌ Error agregando ${m.code}: ${e.message}`);
        }
    }

    console.log('\n📋 Tabla actualizada:');
    const all = await query(`SELECT CODIGO, DESCRIPCION, DEBE_COBRAR, PUEDE_COBRAR FROM JAVIER.PAYMENT_CONDITIONS ORDER BY CODIGO`, false);
    all.forEach(r => console.log(`   ${r.CODIGO}: DEBE=${r.DEBE_COBRAR}, PUEDE=${r.PUEDE_COBRAR}`));

    console.log('\n✅ Completado');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
