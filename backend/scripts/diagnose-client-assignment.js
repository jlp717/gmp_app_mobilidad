/**
 * Script de Diagnóstico: Verificar asignación de cliente a vendedor
 * Usa la caché LACLAE que ya funciona
 * 
 * Ejecutar en el servidor: node scripts/diagnose-client-assignment.js
 */

const { loadLaclaeCache, getClientDays } = require('../services/laclae');
const { initDb } = require('../config/db');

async function diagnoseClientAssignment() {
    const clientCode = '4300008335';

    console.log('='.repeat(60));
    console.log('DIAGNÓSTICO: Asignación Cliente-Vendedor');
    console.log(`Cliente: ${clientCode}`);
    console.log('='.repeat(60));

    try {
        // Initialize DB and load cache
        await initDb();
        console.log('\nCargando caché LACLAE...');
        await loadLaclaeCache();

        console.log('\n1. BUSCAR CLIENTE EN CACHE LACLAE');
        console.log('-'.repeat(40));

        // Get client days (this searches all vendors)
        const clientDays = getClientDays(null, clientCode);

        if (clientDays) {
            console.log(`   Cliente encontrado!`);
            console.log(`   Días de Visita: ${clientDays.visitDays.join(', ') || 'N/A'}`);
            console.log(`   Días de Reparto: ${clientDays.deliveryDays.join(', ') || 'N/A'}`);
            if (clientDays.foundVendor) {
                console.log(`   Vendedor en caché: ${clientDays.foundVendor}`);
            }
        } else {
            console.log(`   Cliente NO encontrado en caché LACLAE`);
        }

        // The cache structure is: laclaeCache[vendedor][cliente]
        // Let's access it directly to find all vendors for this client
        console.log('\n2. VENDEDORES CON ESTE CLIENTE');
        console.log('-'.repeat(40));

        // Access the internal cache (we need to export it or check manually)
        // Since we can't easily access internal cache, let's try known vendor codes
        const knownVendors = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
            '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
            'ZZ', 'Z1', 'Z2'];

        for (const vendor of knownVendors) {
            const days = getClientDays(vendor, clientCode);
            if (days && days.visitDays.length > 0) {
                console.log(`   Vendedor ${vendor}: Visita ${days.visitDaysShort}, Reparto ${days.deliveryDaysShort}`);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('CONCLUSIÓN');
        console.log('='.repeat(60));
        console.log('Si el cliente aparece con vendedor "20" o "ZZ", ese es el');
        console.log('vendedor registrado en la tabla DSED.LACLAE.');
        console.log('Para cambiar la asignación, hay que modificar RUTERO_CONFIG.');

    } catch (error) {
        console.error('Error:', error.message);
    }

    process.exit(0);
}

diagnoseClientAssignment();
