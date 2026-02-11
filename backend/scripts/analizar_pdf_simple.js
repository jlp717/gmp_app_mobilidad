// =============================================================================
// ANÁLISIS RÁPIDO PDF vs SISTEMA
// =============================================================================
const { query } = require('../config/db');

async function analizarRapido() {
    try {
        console.log('🔍 ANÁLISIS PDF (51.809,43€) vs SISTEMA (49.330,26€)\n');
        console.log('Diferencia a explicar: 2.479,17€\n');
        console.log('='.repeat(80));
        
        const fecha = { dia: 11, mes: 2, anio: 2026 };

        // Query con filtros del sistema
        const q1 = `
            SELECT SUM(L.LCIMVT) AS total
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${fecha.anio} AND L.LCMMDC = ${fecha.mes} AND L.LCDDDC = ${fecha.dia}
                AND L.TPDC = 'LAC'
                AND L.LCTPVT IN ('CC', 'VC')
                AND L.LCCLLN IN ('AB', 'VT')
                AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
        `;

        // Query sin filtros (como el PDF)
        const q2 = `
            SELECT SUM(L.LCIMVT) AS total
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${fecha.anio} AND L.LCMMDC = ${fecha.mes} AND L.LCDDDC = ${fecha.dia}
                AND L.TPDC = 'LAC'
        `;

        // Query de registros excluidos
        const q3 = `
            SELECT 
                CASE 
                    WHEN L.LCTPVT NOT IN ('CC', 'VC') THEN 'Tipo Venta NO válido'
                    WHEN L.LCCLLN NOT IN ('AB', 'VT') THEN 'Clase Línea NO válida'
                    WHEN L.LCSRAB IN ('N', 'Z', 'G', 'D') THEN 'Serie EXCLUIDA'
                    ELSE 'Otro'
                END AS motivo,
                COUNT(*) as registros,
                SUM(L.LCIMVT) AS total
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${fecha.anio} AND L.LCMMDC = ${fecha.mes} AND L.LCDDDC = ${fecha.dia}
                AND L.TPDC = 'LAC'
                AND (
                    L.LCTPVT NOT IN ('CC', 'VC')
                    OR L.LCCLLN NOT IN ('AB', 'VT')
                    OR L.LCSRAB IN ('N', 'Z', 'G', 'D')
                )
            GROUP BY 
                CASE 
                    WHEN L.LCTPVT NOT IN ('CC', 'VC') THEN 'Tipo Venta NO válido'
                    WHEN L.LCCLLN NOT IN ('AB', 'VT') THEN 'Clase Línea NO válida'
                    WHEN L.LCSRAB IN ('N', 'Z', 'G', 'D') THEN 'Serie EXCLUIDA'
                    ELSE 'Otro'
                END
        `;

        console.log('\n📊 Calculando...\n');

        const [r1, r2, r3] = await Promise.all([
            query(q1),
            query(q2),
            query(q3)
        ]);

        const sistema = parseFloat(r1[0]?.TOTAL || 0);
        const sinFiltros = parseFloat(r2[0]?.TOTAL || 0);
        
        console.log('RESULTADOS:');
        console.log('-'.repeat(80));
        console.log(`1. Sistema (CON filtros):    ${sistema.toFixed(2)}€`);
        console.log(`2. Total (SIN filtros):      ${sinFiltros.toFixed(2)}€`);
        console.log(`3. Diferencia:               ${(sinFiltros - sistema).toFixed(2)}€\n`);

        console.log('REGISTROS EXCLUIDOS:');
        console.log('-'.repeat(80));
        let totalExcluido = 0;
        r3.forEach(row => {
            const total = parseFloat(row.TOTAL || 0);
            totalExcluido += total;
            console.log(`${row.MOTIVO.padEnd(30)} ${String(row.REGISTROS).padStart(4)} registros  ${total.toFixed(2).padStart(12)}€`);
        });
        console.log('-'.repeat(80));
        console.log(`TOTAL EXCLUIDO:                                    ${totalExcluido.toFixed(2).padStart(12)}€\n`);

        console.log('CONCLUSIÓN PARA EL JEFE DE VENTAS:');
        console.log('='.repeat(80));
        console.log(`\n📄 PDF muestra:                      51.809,43€`);
        console.log(`📱 Sistema muestra:                  ${sistema.toFixed(2)}€`);
        console.log(`📊 Diferencia:                       ${(51809.43 - sistema).toFixed(2)}€\n`);

        const difConSinFiltros = Math.abs(51809.43 - sinFiltros);
        
        if (difConSinFiltros < 10) {
            console.log('✅ ¡COINCIDE! El PDF NO aplica los filtros del sistema');
            console.log('\n💡 EXPLICACIÓN:');
            console.log('-'.repeat(80));
            console.log(`El PDF incluye los ${totalExcluido.toFixed(2)}€ de registros que el sistema`);
            console.log('excluye correctamente:');
            console.log('  • Tipos de venta no válidos (traspasos, embalajes, etc.)');
            console.log('  • Clases de línea auxiliares (no son producto vendido)');
            console.log('  • Series especiales (anulados, garantías, etc.)');
            console.log(`\n➡️  La cifra correcta de VENTAS REALES es: ${sistema.toFixed(2)}€`);
        } else {
            console.log(`⚠️  Hay ${difConSinFiltros.toFixed(2)}€ de diferencia adicional a investigar`);
        }

        console.log('\n' + '='.repeat(80));
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

analizarRapido();
