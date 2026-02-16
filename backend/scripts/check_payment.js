/**
 * Verificar condiciones de pago
 * Uso: node check_payment.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../config/db');

async function main() {
    console.log('\n📊 DIAGNÓSTICO CONDICIONES DE PAGO\n');

    // 1. Ver todas las condiciones de pago configuradas
    console.log('1️⃣ Configuración en JAVIER.PAYMENT_CONDITIONS:');
    try {
        const conditions = await query(`
            SELECT CODIGO, DESCRIPCION, TIPO, DIAS_PAGO, DEBE_COBRAR, PUEDE_COBRAR, ACTIVO
            FROM JAVIER.PAYMENT_CONDITIONS
            ORDER BY CODIGO
        `, false);

        if (conditions.length === 0) {
            console.log('   ⚠️ TABLA VACÍA - No hay condiciones configuradas!');
        } else {
            conditions.forEach(c => {
                console.log(`   ${c.CODIGO}: ${c.DESCRIPCION} | DEBE_COBRAR=${c.DEBE_COBRAR} | PUEDE_COBRAR=${c.PUEDE_COBRAR} | ACTIVO=${c.ACTIVO}`);
            });
        }
    } catch (e) {
        console.log(`   Error: ${e.message}`);
    }

    // 2. Ver las formas de pago que realmente usan los albaranes hoy
    console.log('\n2️⃣ Formas de pago usadas en albaranes de hoy:');
    try {
        const today = new Date();
        const used = await query(`
            SELECT TRIM(CPC.CODIGOFORMAPAGO) as FP, COUNT(*) as CNT
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE OPP.ANOREPARTO = ${today.getFullYear()} 
              AND OPP.MESREPARTO = ${today.getMonth() + 1}
              AND OPP.DIAREPARTO = ${today.getDate()}
            GROUP BY TRIM(CPC.CODIGOFORMAPAGO)
            ORDER BY CNT DESC
        `, false);

        used.forEach(u => console.log(`   Código '${u.FP}': ${u.CNT} albaranes`));
    } catch (e) {
        console.log(`   Error: ${e.message}`);
    }

    // 3. Verificar si existe tabla FORMAS_PAGO en DSEDAC para ver descripciones originales
    console.log('\n3️⃣ Formas de pago en DSEDAC.FPA (si existe):');
    try {
        const fpa = await query(`
            SELECT CODIGOFORMAPAGO, DESCRIPCION FROM DSEDAC.FPA FETCH FIRST 10 ROWS ONLY
        `, false);
        fpa.forEach(f => console.log(`   ${f.CODIGOFORMAPAGO}: ${f.DESCRIPCION}`));
    } catch (e) {
        console.log(`   (Tabla FPA no disponible o error: ${e.message})`);
    }

    console.log('\n✅ Diagnóstico completado');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
