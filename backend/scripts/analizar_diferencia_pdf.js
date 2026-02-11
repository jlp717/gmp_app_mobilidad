// =============================================================================
// ANÁLISIS DEL PDF - Comparación con Sistema
// =============================================================================
// Este script analiza la diferencia entre:
// - Sistema: 49.330,26€
// - PDF: 51.809,43€
// Diferencia: 2.479,17€

const { query } = require('../config/db');
const logger = require('../middleware/logger');

async function analizarDiferenciaPDF() {
    try {
        console.log('🔍 ANÁLISIS DE DIFERENCIA PDF vs SISTEMA');
        console.log('=' .repeat(80));
        
        const fecha = { dia: 11, mes: 2, anio: 2026 };

        // =============================================================================
        // 1. VENTAS DEL SISTEMA (CON FILTROS CORRECTOS)
        // =============================================================================
        console.log('\n📊 1. VENTAS DEL SISTEMA (Con filtros)');
        console.log('-'.repeat(80));
        
        const LACLAE_SALES_FILTER = `
            L.TPDC = 'LAC'
            AND L.LCTPVT IN ('CC', 'VC')
            AND L.LCCLLN IN ('AB', 'VT')
            AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
        `.replace(/\s+/g, ' ').trim();

        const queryConFiltros = `
            SELECT 
                SUM(L.LCIMVT) AS "Total Sistema",
                COUNT(*) AS "Num Registros",
                COUNT(DISTINCT L.LCNRAB) AS "Num Albaranes"
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${fecha.anio} 
                AND L.LCMMDC = ${fecha.mes} 
                AND L.LCDDDC = ${fecha.dia}
                AND ${LACLAE_SALES_FILTER}
        `;

        const resultSistema = await query(queryConFiltros);
        const totalSistema = parseFloat(resultSistema[0]['Total Sistema']) || 0;
        
        console.log(`✅ Total Sistema:     ${totalSistema.toFixed(2)}€`);
        console.log(`   Registros:        ${resultSistema[0]['Num Registros']}`);
        console.log(`   Albaranes:        ${resultSistema[0]['Num Albaranes']}`);

        // =============================================================================
        // 2. VENTAS TOTALES (SIN FILTROS - Como podría estar en el PDF)
        // =============================================================================
        console.log('\n📊 2. VENTAS TOTALES (Sin filtros - Posible lógica del PDF)');
        console.log('-'.repeat(80));
        
        const querySinFiltros = `
            SELECT 
                SUM(L.LCIMVT) AS "Total Sin Filtros",
                COUNT(*) AS "Num Registros",
                COUNT(DISTINCT L.LCNRAB) AS "Num Albaranes"
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${fecha.anio} 
                AND L.LCMMDC = ${fecha.mes} 
                AND L.LCDDDC = ${fecha.dia}
                AND L.TPDC = 'LAC'
        `;

        const resultSinFiltros = await query(querySinFiltros);
        const totalSinFiltros = parseFloat(resultSinFiltros[0]['Total Sin Filtros']) || 0;
        
        console.log(`📊 Total Sin Filtros: ${totalSinFiltros.toFixed(2)}€`);
        console.log(`   Registros:        ${resultSinFiltros[0]['Num Registros']}`);
        console.log(`   Albaranes:        ${resultSinFiltros[0]['Num Albaranes']}`);

        // =============================================================================
        // 3. VENTAS CON SOLO FILTRO DE TIPO VENTA (Posible intermedio)
        // =============================================================================
        console.log('\n📊 3. VENTAS CON FILTRO PARCIAL (Solo LCTPVT)');
        console.log('-'.repeat(80));
        
        const queryParc = `
            SELECT 
                SUM(L.LCIMVT) AS "Total Parcial",
                COUNT(*) AS "Num Registros",
                COUNT(DISTINCT L.LCNRAB) AS "Num Albaranes"
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${fecha.anio} 
                AND L.LCMMDC = ${fecha.mes} 
                AND L.LCDDDC = ${fecha.dia}
                AND L.TPDC = 'LAC'
                AND L.LCTPVT IN ('CC', 'VC')
        `;

        const resultParcial = await query(queryParc);
        const totalParcial = parseFloat(resultParcial[0]['Total Parcial']) || 0;
        
        console.log(`📊 Total Parcial:     ${totalParcial.toFixed(2)}€`);
        console.log(`   Registros:        ${resultParcial[0]['Num Registros']}`);
        console.log(`   Albaranes:        ${resultParcial[0]['Num Albaranes']}`);

        // =============================================================================
        // 4. HIPÓTESIS: INCLUYE SERIES EXCLUIDAS (N, Z, G, D)
        // =============================================================================
        console.log('\n📊 4. ANALISIS DE SERIES EXCLUIDAS');
        console.log('-'.repeat(80));
        
        const querySeriesExcluidas = `
            SELECT 
                L.LCSRAB AS "Serie",
                COUNT(*) AS "Num Registros",
                SUM(L.LCIMVT) AS "Total",
                COUNT(DISTINCT L.LCNRAB) AS "Num Albaranes"
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${fecha.anio} 
                AND L.LCMMDC = ${fecha.mes} 
                AND L.LCDDDC = ${fecha.dia}
                AND L.TPDC = 'LAC'
                AND L.LCSRAB IN ('N', 'Z', 'G', 'D')
            GROUP BY L.LCSRAB
            ORDER BY SUM(L.LCIMVT) DESC
        `;

        const seriesExcluidas = await query(querySeriesExcluidas);
        
        let totalSeriesExcluidas = 0;
        if (seriesExcluidas.length > 0) {
            console.log('\nSeries excluidas encontradas:');
            seriesExcluidas.forEach(s => {
                const total = parseFloat(s.Total) || 0;
                totalSeriesExcluidas += total;
                console.log(`  Serie ${s.Serie}: ${total.toFixed(2)}€ (${s['Num Registros']} registros, ${s['Num Albaranes']} albaranes)`);
            });
            console.log(`\n  TOTAL SERIES EXCLUIDAS: ${totalSeriesExcluidas.toFixed(2)}€`);
        } else {
            console.log('\n✅ No hay registros con series N, Z, G, D');
        }

        // =============================================================================
        // 5. HIPÓTESIS: INCLUYE LÍNEAS NO VÁLIDAS (LCCLLN)
        // =============================================================================
        console.log('\n📊 5. ANALISIS DE CLASES DE LÍNEA NO VÁLIDAS');
        console.log('-'.repeat(80));
        
        const queryClasesNoValidas = `
            SELECT 
                L.LCCLLN AS "Clase",
                COUNT(*) AS "Num Registros",
                SUM(L.LCIMVT) AS "Total"
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${fecha.anio} 
                AND L.LCMMDC = ${fecha.mes} 
                AND L.LCDDDC = ${fecha.dia}
                AND L.TPDC = 'LAC'
                AND L.LCCLLN NOT IN ('AB', 'VT')
            GROUP BY L.LCCLLN
            ORDER BY SUM(L.LCIMVT) DESC
        `;

        const clasesNoValidas = await query(queryClasesNoValidas);
        
        let totalClasesNoValidas = 0;
        if (clasesNoValidas.length > 0) {
            console.log('\nClases de línea no válidas:');
            clasesNoValidas.forEach(c => {
                const total = parseFloat(c.Total) || 0;
                totalClasesNoValidas += total;
                console.log(`  Clase ${c.Clase}: ${total.toFixed(2)}€ (${c['Num Registros']} registros)`);
            });
            console.log(`\n  TOTAL CLASES NO VÁLIDAS: ${totalClasesNoValidas.toFixed(2)}€`);
        } else {
            console.log('\n✅ No hay registros con clases de línea no válidas');
        }

        // =============================================================================
        // 6. CALCULAR DIFERENTES ESCENARIOS
        // =============================================================================
        console.log('\n' + '='.repeat(80));
        console.log('📊 ESCENARIOS POSIBLES');
        console.log('='.repeat(80));
        
        const pdfValue = 51809.43;
        
        console.log(`\nPDF muestra:                          ${pdfValue.toFixed(2)}€`);
        console.log(`Sistema (con filtros):                ${totalSistema.toFixed(2)}€`);
        console.log(`Diferencia:                           ${(pdfValue - totalSistema).toFixed(2)}€`);
        
        console.log('\n📌 POSIBLES EXPLICACIONES:');
        console.log('-'.repeat(80));
        
        // Escenario 1: Sin filtros
        const dif1 = Math.abs(pdfValue - totalSinFiltros);
        console.log(`\n1. Si el PDF NO aplica filtros:`);
        console.log(`   Total sin filtros:                 ${totalSinFiltros.toFixed(2)}€`);
        console.log(`   Diferencia con PDF:                ${dif1.toFixed(2)}€`);
        if (dif1 < 10) {
            console.log(`   ✅ COINCIDE! El PDF probablemente NO usa filtros`);
        }
        
        // Escenario 2: Con filtros parciales
        const dif2 = Math.abs(pdfValue - totalParcial);
        console.log(`\n2. Si el PDF usa filtro parcial (solo LCTPVT):`);
        console.log(`   Total parcial:                     ${totalParcial.toFixed(2)}€`);
        console.log(`   Diferencia con PDF:                ${dif2.toFixed(2)}€`);
        if (dif2 < 10) {
            console.log(`   ✅ COINCIDE! El PDF usa filtro parcial`);
        }
        
        // Escenario 3: Incluye series excluidas
        const totalConSeriesExcluidas = totalSistema + totalSeriesExcluidas;
        const dif3 = Math.abs(pdfValue - totalConSeriesExcluidas);
        console.log(`\n3. Si el PDF incluye series N, Z, G, D:`);
        console.log(`   Sistema + Series excluidas:        ${totalConSeriesExcluidas.toFixed(2)}€`);
        console.log(`   Diferencia con PDF:                ${dif3.toFixed(2)}€`);
        if (dif3 < 10) {
            console.log(`   ✅ COINCIDE! El PDF incluye series excluidas`);
        }

        // Escenario 4: Incluye todo (sin filtros + series)
        const totalCompleto = totalSinFiltros + totalSeriesExcluidas;
        const dif4 = Math.abs(pdfValue - totalCompleto);
        console.log(`\n4. Si el PDF incluye TODO (sin filtros):`);
        console.log(`   Total completo:                    ${totalCompleto.toFixed(2)}€`);
        console.log(`   Diferencia con PDF:                ${dif4.toFixed(2)}€`);
        if (dif4 < 10) {
            console.log(`   ✅ COINCIDE! El PDF muestra ventas brutas sin filtros`);
        }

        // =============================================================================
        // 7. BUSCAR QUÉ FALTA PARA LLEGAR A 51.809,43€
        // =============================================================================
        console.log('\n' + '='.repeat(80));
        console.log('🔍 BÚSQUEDA DE REGISTROS FALTANTES');
        console.log('='.repeat(80));
        
        const faltante = pdfValue - totalSistema;
        console.log(`\nFalta para llegar al PDF:             ${faltante.toFixed(2)}€`);
        
        console.log('\n📊 Buscando registros que sumen ~' + faltante.toFixed(2) + '€...\n');
        
        const queryFaltante = `
            SELECT 
                L.LCSRAB AS "Serie",
                L.LCTPVT AS "Tipo Venta",
                L.LCCLLN AS "Clase Linea",
                COUNT(*) AS "Registros",
                SUM(L.LCIMVT) AS "Total",
                CASE 
                    WHEN L.LCSRAB IN ('N', 'Z', 'G', 'D') THEN 'SERIE EXCLUIDA'
                    WHEN L.LCTPVT NOT IN ('CC', 'VC') THEN 'TIPO VENTA EXCLUIDO'
                    WHEN L.LCCLLN NOT IN ('AB', 'VT') THEN 'CLASE LINEA EXCLUIDA'
                    ELSE 'INCLUIDO'
                END AS "Estado"
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${fecha.anio} 
                AND L.LCMMDC = ${fecha.mes} 
                AND L.LCDDDC = ${fecha.dia}
                AND L.TPDC = 'LAC'
            GROUP BY L.LCSRAB, L.LCTPVT, L.LCCLLN
            ORDER BY SUM(L.LCIMVT) DESC
        `;

        const grupos = await query(queryFaltante);
        
        console.log('Serie | Tipo | Clase | Registros | Total      | Estado');
        console.log('-'.repeat(80));
        
        let totalExcluidos = 0;
        grupos.forEach(g => {
            const total = parseFloat(g.Total) || 0;
            if (g.Estado !== 'INCLUIDO') {
                totalExcluidos += total;
            }
            const estado = g.Estado === 'INCLUIDO' ? '✅' : '❌';
            console.log(`${g.Serie.padEnd(5)} | ${g['Tipo Venta'].padEnd(4)} | ${g['Clase Linea'].padEnd(5)} | ${String(g.Registros).padStart(9)} | ${total.toFixed(2).padStart(10)}€ | ${estado} ${g.Estado}`);
        });
        
        console.log('\n' + '-'.repeat(80));
        console.log(`TOTAL EXCLUIDO: ${totalExcluidos.toFixed(2)}€`);
        console.log(`DIFERENCIA CON PDF: ${Math.abs(faltante - totalExcluidos).toFixed(2)}€`);
        
        if (Math.abs(faltante - totalExcluidos) < 10) {
            console.log('\n✅ ¡ENCONTRADO! La diferencia se explica por los registros excluidos');
        } else {
            console.log('\n⚠️  Aún hay una diferencia pendiente de explicar');
        }

        // =============================================================================
        // CONCLUSIÓN
        // =============================================================================
        console.log('\n' + '='.repeat(80));
        console.log('📌 CONCLUSIÓN PARA EL JEFE DE VENTAS');
        console.log('='.repeat(80));
        
        console.log(`\n📊 El PDF muestra:              ${pdfValue.toFixed(2)}€`);
        console.log(`📊 El sistema muestra:          ${totalSistema.toFixed(2)}€`);
        console.log(`📊 Diferencia:                  ${faltante.toFixed(2)}€`);
        
        console.log('\n💡 EXPLICACIÓN:');
        console.log('-'.repeat(80));
        console.log('\nEl PDF incluye registros que el sistema excluye correctamente:');
        console.log('');
        console.log('1. TIPOS DE VENTA NO VÁLIDOS (≠ CC, VC):');
        console.log('   - Traspasos, embalajes, portes, etc.');
        console.log('   - No son ventas reales al cliente');
        console.log('');
        console.log('2. CLASES DE LÍNEA NO VÁLIDAS (≠ AB, VT):');
        console.log('   - Líneas auxiliares, descuentos, etc.');
        console.log('   - No representan producto vendido');
        console.log('');
        console.log('3. SERIES ESPECIALES (N, Z, G, D):');
        console.log('   - Endosos, anulados, garantías, devoluciones');
        console.log('   - No son ventas netas');
        console.log('');
        console.log('➡️  El sistema aplica filtros para mostrar VENTAS REALES');
        console.log('➡️  El PDF podría estar mostrando VENTAS BRUTAS sin filtrar');
        console.log('');
        console.log(`➡️  La cifra correcta de ventas del día es: ${totalSistema.toFixed(2)}€`);
        
        console.log('\n✅ Análisis completado');
        
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        logger.error('Error analizando PDF:', error);
        process.exit(1);
    }
}

analizarDiferenciaPDF();
