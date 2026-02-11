// =============================================================================
// VALIDACIÓN DE VENTAS DEL DÍA - 11/02/2026
// =============================================================================
// Este script compara:
// 1. La query SQL básica del usuario (49.680,90€)
// 2. La query con filtros del sistema (debería dar ~49.050€)
// 3. Identifica exactamente qué registros difieren (endosos y otros)

const { query } = require('../config/db');
const logger = require('../middleware/logger');

async function validarVentasHoy() {
    try {
        console.log('🔍 VALIDACIÓN DE VENTAS DEL 11/02/2026');
        console.log('=' .repeat(80));

        const fecha = { dia: 11, mes: 2, anio: 2026 };

        // =============================================================================
        // 1. QUERY BÁSICA DEL USUARIO (Sin filtros adicionales)
        // =============================================================================
        console.log('\n📊 1. QUERY BÁSICA (Como la del usuario)');
        console.log('-'.repeat(80));
        
        const queryBasica = `
            SELECT 
                SUM(L.LCIMVT) AS "Ventas SIN IVA",
                COUNT(*) AS "Num Registros",
                COUNT(DISTINCT L.LCCDCL) AS "Num Clientes",
                COUNT(DISTINCT L.LCNRAB) AS "Num Albaranes"
            FROM DSED.LACLAE L
            WHERE LCDDDC = '${fecha.dia}' 
                AND LCMMDC = '${String(fecha.mes).padStart(2, '0')}' 
                AND LCAADC = '${fecha.anio}'
                AND TPDC = 'LAC'
        `;

        const resultBasico = await query(queryBasica);
        const ventasBasicas = parseFloat(resultBasico[0]['Ventas SIN IVA']) || 0;
        
        console.log(`✅ Total Ventas (sin filtros):    ${ventasBasicas.toFixed(2)}€`);
        console.log(`   - Registros:                  ${resultBasico[0]['Num Registros']}`);
        console.log(`   - Clientes:                   ${resultBasico[0]['Num Clientes']}`);
        console.log(`   - Albaranes:                  ${resultBasico[0]['Num Albaranes']}`);

        // =============================================================================
        // 2. QUERY CON FILTROS DEL SISTEMA (La que usa el dashboard)
        // =============================================================================
        console.log('\n📊 2. QUERY DEL SISTEMA (Con filtros aplicados)');
        console.log('-'.repeat(80));
        
        const queryConFiltros = `
            SELECT 
                SUM(L.LCIMVT) AS "Ventas SIN IVA",
                COUNT(*) AS "Num Registros",
                COUNT(DISTINCT L.LCCDCL) AS "Num Clientes",
                COUNT(DISTINCT L.LCNRAB) AS "Num Albaranes"
            FROM DSED.LACLAE L
            WHERE LCDDDC = '${fecha.dia}' 
                AND LCMMDC = '${String(fecha.mes).padStart(2, '0')}' 
                AND LCAADC = '${fecha.anio}'
                AND L.TPDC = 'LAC'
                AND L.LCTPVT IN ('CC', 'VC')
                AND L.LCCLLN IN ('AB', 'VT')
                AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
        `;

        const resultFiltrado = await query(queryConFiltros);
        const ventasFiltradas = parseFloat(resultFiltrado[0]['Ventas SIN IVA']) || 0;
        
        console.log(`✅ Total Ventas (con filtros):    ${ventasFiltradas.toFixed(2)}€`);
        console.log(`   - Registros:                  ${resultFiltrado[0]['Num Registros']}`);
        console.log(`   - Clientes:                   ${resultFiltrado[0]['Num Clientes']}`);
        console.log(`   - Albaranes:                  ${resultFiltrado[0]['Num Albaranes']}`);

        // =============================================================================
        // 3. DIFERENCIA Y REGISTROS EXCLUIDOS
        // =============================================================================
        const diferencia = ventasBasicas - ventasFiltradas;
        console.log('\n💡 DIFERENCIA');
        console.log('-'.repeat(80));
        console.log(`Diferencia:                       ${diferencia.toFixed(2)}€`);
        console.log(`Diferencia registros:             ${resultBasico[0]['Num Registros'] - resultFiltrado[0]['Num Registros']}`);

        // =============================================================================
        // 4. IDENTIFICAR REGISTROS EXCLUIDOS (Endosos y otros)
        // =============================================================================
        console.log('\n🔍 REGISTROS EXCLUIDOS POR LOS FILTROS');
        console.log('-'.repeat(80));
        
        const queryExcluidos = `
            SELECT 
                L.LCNRAB AS "Num Albaran",
                L.LCSRAB AS "Serie",
                L.LCTPVT AS "Tipo Venta",
                L.LCCLLN AS "Clase Linea",
                L.LCCDCL AS "Cod Cliente",
                CLI.NOMBREALTERNATIVO AS "Cliente",
                L.LCIMVT AS "Importe SIN IVA",
                CASE 
                    WHEN L.LCSRAB IN ('N', 'Z', 'G', 'D') THEN 'SERIE EXCLUIDA (Endoso/Otros)'
                    WHEN L.LCTPVT NOT IN ('CC', 'VC') THEN 'TIPO VENTA EXCLUIDO'
                    WHEN L.LCCLLN NOT IN ('AB', 'VT') THEN 'CLASE LINEA EXCLUIDA'
                    ELSE 'OTRO'
                END AS "Motivo Exclusion"
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.CLI AS CLI ON L.LCCDCL = CLI.CODIGOCLIENTE
            WHERE LCDDDC = '${fecha.dia}' 
                AND LCMMDC = '${String(fecha.mes).padStart(2, '0')}' 
                AND LCAADC = '${fecha.anio}'
                AND L.TPDC = 'LAC'
                AND (
                    L.LCSRAB IN ('N', 'Z', 'G', 'D')
                    OR L.LCTPVT NOT IN ('CC', 'VC')
                    OR L.LCCLLN NOT IN ('AB', 'VT')
                )
            ORDER BY L.LCNRAB, L.LCIMVT DESC
        `;

        const registrosExcluidos = await query(queryExcluidos);
        
        if (registrosExcluidos.length > 0) {
            console.log(`\n❌ Se encontraron ${registrosExcluidos.length} registros excluidos:\n`);
            
            let totalExcluido = 0;
            const porMotivo = {};
            
            registrosExcluidos.forEach((reg, idx) => {
                const importe = parseFloat(reg['Importe SIN IVA']) || 0;
                totalExcluido += importe;
                
                const motivo = reg['Motivo Exclusion'];
                porMotivo[motivo] = (porMotivo[motivo] || 0) + importe;
                
                console.log(`${idx + 1}. Albarán: ${reg['Num Albaran']} | Serie: ${reg['Serie']} | Cliente: ${reg['Cliente'] || 'N/A'}`);
                console.log(`   Importe: ${importe.toFixed(2)}€ | Motivo: ${motivo}`);
                console.log('');
            });
            
            console.log('\n📈 RESUMEN POR MOTIVO DE EXCLUSIÓN:');
            console.log('-'.repeat(80));
            Object.entries(porMotivo).forEach(([motivo, total]) => {
                console.log(`${motivo}: ${total.toFixed(2)}€`);
            });
            console.log(`\nTotal Excluido: ${totalExcluido.toFixed(2)}€`);
        } else {
            console.log('✅ No se encontraron registros excluidos');
        }

        // =============================================================================
        // 5. ANÁLISIS DE SERIES (Para identificar endosos)
        // =============================================================================
        console.log('\n📋 ANÁLISIS POR SERIE DE ALBARÁN');
        console.log('-'.repeat(80));
        
        const querySeries = `
            SELECT 
                L.LCSRAB AS "Serie",
                COUNT(*) AS "Num Registros",
                SUM(L.LCIMVT) AS "Total Ventas",
                COUNT(DISTINCT L.LCNRAB) AS "Num Albaranes",
                CASE 
                    WHEN L.LCSRAB IN ('N', 'Z', 'G', 'D') THEN '❌ EXCLUIDA'
                    ELSE '✅ INCLUIDA'
                END AS "Estado"
            FROM DSED.LACLAE L
            WHERE LCDDDC = '${fecha.dia}' 
                AND LCMMDC = '${String(fecha.mes).padStart(2, '0')}' 
                AND LCAADC = '${fecha.anio}'
                AND L.TPDC = 'LAC'
            GROUP BY L.LCSRAB
            ORDER BY SUM(L.LCIMVT) DESC
        `;

        const series = await query(querySeries);
        
        console.log('\nSerie | Estado      | Registros | Albaranes | Total Ventas');
        console.log('-'.repeat(80));
        series.forEach(s => {
            const total = parseFloat(s['Total Ventas']) || 0;
            console.log(`${s['Serie'].padEnd(5)} | ${s['Estado'].padEnd(11)} | ${String(s['Num Registros']).padStart(9)} | ${String(s['Num Albaranes']).padStart(9)} | ${total.toFixed(2).padStart(12)}€`);
        });

        // =============================================================================
        // CONCLUSIÓN
        // =============================================================================
        console.log('\n' + '='.repeat(80));
        console.log('📌 CONCLUSIÓN');
        console.log('='.repeat(80));
        console.log(`\n1. Ventas SIN filtros (tu query):     ${ventasBasicas.toFixed(2)}€`);
        console.log(`2. Ventas CON filtros (sistema):      ${ventasFiltradas.toFixed(2)}€`);
        console.log(`3. Diferencia:                        ${diferencia.toFixed(2)}€`);
        
        console.log('\n💡 RECOMENDACIÓN:');
        console.log('-'.repeat(80));
        if (Math.abs(diferencia) < 1) {
            console.log('✅ Las ventas coinciden. El dashboard muestra la cifra correcta.');
        } else {
            console.log(`⚠️  Hay una diferencia de ${diferencia.toFixed(2)}€`);
            console.log('\nLos filtros que usa el sistema son:');
            console.log('  - TPDC = \'LAC\'                    (Solo albaranes de cliente)');
            console.log('  - LCTPVT IN (\'CC\', \'VC\')         (Tipos de venta válidos)');
            console.log('  - LCCLLN IN (\'AB\', \'VT\')         (Clases de línea válidas)');
            console.log('  - LCSRAB NOT IN (\'N\',\'Z\',\'G\',\'D\') (Excluye endosos y otros)');
            console.log('\n➡️  La cifra correcta que debería mostrar tu app es: ' + ventasFiltradas.toFixed(2) + '€');
            console.log('    (Esta cifra excluye endosos y otros documentos no válidos)');
        }

        console.log('\n✅ Validación completada');
        
        process.exit(0);

    } catch (error) {
        console.error('❌ Error en la validación:', error);
        logger.error('Error validando ventas:', error);
        process.exit(1);
    }
}

// Ejecutar
validarVentasHoy();
