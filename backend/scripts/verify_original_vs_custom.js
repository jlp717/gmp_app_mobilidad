const { query, initDb } = require('../config/db');
const { loadLaclaeCache, getClientsForDay } = require('../services/laclae');

async function verify() {
    try {
        await initDb();
        console.log('🔧 Loading cache...');
        await loadLaclaeCache();

        const vendor = '33';
        const day = 'sabado';

        console.log(`\n📊 COMPARACIÓN: Vendor ${vendor} - ${day}`);
        console.log('='.repeat(60));

        // Get both lists
        const custom = getClientsForDay(vendor, day, 'comercial', false) || [];
        const original = getClientsForDay(vendor, day, 'comercial', true) || [];

        console.log(`\n✅ PERSONALIZADO (con cambios del comercial): ${custom.length} clientes`);
        console.log(`✅ ORIGINAL (sin cambios, solo DB natural): ${original.length} clientes`);

        // Find differences
        const onlyInCustom = custom.filter(c => !original.includes(c));
        const onlyInOriginal = original.filter(c => !custom.includes(c));

        if (onlyInCustom.length > 0) {
            console.log(`\n🔵 Clientes que SOLO aparecen en PERSONALIZADO (movidos aquí por el comercial):`);
            onlyInCustom.forEach(c => console.log(`   - ${c}`));
        }

        if (onlyInOriginal.length > 0) {
            console.log(`\n🔴 Clientes que SOLO aparecen en ORIGINAL (bloqueados/movidos por el comercial):`);
            onlyInOriginal.forEach(c => console.log(`   - ${c}`));
        }

        if (onlyInCustom.length === 0 && onlyInOriginal.length === 0) {
            console.log(`\n⚠️ Ambas listas son IDÉNTICAS (el comercial no ha hecho cambios para este día)`);
        }

        // Check miercoles too (where we applied blocks)
        console.log('\n' + '='.repeat(60));
        const customMi = getClientsForDay(vendor, 'miercoles', 'comercial', false) || [];
        const originalMi = getClientsForDay(vendor, 'miercoles', 'comercial', true) || [];
        console.log(`\n📊 MIÉRCOLES:`);
        console.log(`   PERSONALIZADO: ${customMi.length} clientes`);
        console.log(`   ORIGINAL: ${originalMi.length} clientes`);
        console.log(`   Diferencia: ${originalMi.length - customMi.length} (bloqueados con !miercoles)`);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}
verify();
