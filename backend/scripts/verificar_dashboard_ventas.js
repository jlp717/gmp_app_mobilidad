// =============================================================================
// VERIFICAR VENTAS EN DASHBOARD - Comparar con valor real
// =============================================================================
// Este script verifica qué está devolviendo el endpoint del dashboard
// para las ventas de hoy y lo compara con la query correcta

const { query } = require('../config/db');
const logger = require('../middleware/logger');

async function verificarDashboard() {
    try {
        console.log('🔍 VERIFICACIÓN DEL ENDPOINT DASHBOARD');
        console.log('=' .repeat(80));

        const fecha = { dia: 11, mes: 2, anio: 2026 };

        // =============================================================================
        // 1. SIMULAR LO QUE HACE EL ENDPOINT (todaySales)
        // =============================================================================
        console.log('\n📊 1. QUERY DEL ENDPOINT DASHBOARD (todaySales)');
        console.log('-'.repeat(80));
        
        // Esta es la query que usa el dashboard en la línea 71 (aprox)
        const LACLAE_SALES_FILTER = `
            L.TPDC = 'LAC'
            AND L.LCTPVT IN ('CC', 'VC')
            AND L.LCCLLN IN ('AB', 'VT')
            AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
        `.replace(/\s+/g, ' ').trim();

        const todayDataSql = `
            SELECT 
                COALESCE(SUM(L.LCIMVT), 0) as sales, 
                COUNT(DISTINCT L.LCNRAB) as orders
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${fecha.anio} 
                AND L.LCMMDC = ${fecha.mes} 
                AND L.LCDDDC = ${fecha.dia} 
                AND ${LACLAE_SALES_FILTER}
        `;

        console.log('Query ejecutada:');
        console.log(todayDataSql.replace(/\s+/g, ' '));
        console.log('');

        const todayData = await query(todayDataSql);
        const todaySales = parseFloat(todayData[0]?.SALES) || 0;
        const todayOrders = parseInt(todayData[0]?.ORDERS) || 0;
        
        console.log(`✅ todaySales:  ${todaySales.toFixed(2)}€`);
        console.log(`✅ todayOrders: ${todayOrders}`);

        // =============================================================================
        // 2. VERIFICAR CON FILTRO POR VENDEDOR (Si aplica)
        // =============================================================================
        console.log('\n📊 2. ANÁLISIS POR VENDEDOR');
        console.log('-'.repeat(80));
        
        const porVendedor = `
            SELECT 
                L.LCCDVD AS vendedor,
                VDD.CODIGONOMBRE AS nombre_vendedor,
                COUNT(DISTINCT L.LCNRAB) as albaranes,
                COALESCE(SUM(L.LCIMVT), 0) as ventas
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.VDD ON L.LCCDVD = VDD.CODIGOVENDEDOR
            WHERE L.LCAADC = ${fecha.anio} 
                AND L.LCMMDC = ${fecha.mes} 
                AND L.LCDDDC = ${fecha.dia} 
                AND ${LACLAE_SALES_FILTER}
            GROUP BY L.LCCDVD, VDD.CODIGONOMBRE
            ORDER BY ventas DESC
        `;

        const vendedores = await query(porVendedor);
        
        console.log('\nVendedor | Nombre                    | Albaranes | Ventas');
        console.log('-'.repeat(80));
        
        let totalVentas = 0;
        vendedores.forEach(v => {
            const ventas = parseFloat(v.ventas) || 0;
            totalVentas += ventas;
            const nombre = (v.nombre_vendedor || 'N/A').padEnd(25).substring(0, 25);
            console.log(`${String(v.vendedor).padStart(8)} | ${nombre} | ${String(v.albaranes).padStart(9)} | ${ventas.toFixed(2).padStart(12)}€`);
        });
        
        console.log('-'.repeat(80));
        console.log(`TOTAL:                                            ${totalVentas.toFixed(2).padStart(12)}€`);

        // =============================================================================
        // 3. VERIFICAR SI HAY FILTRO POR JEFE DE VENTAS
        // =============================================================================
        console.log('\n📊 3. VERIFICAR POSIBLES FILTROS ADICIONALES');
        console.log('-'.repeat(80));
        
        // Buscar si algún vendedor es jefe de ventas
        const jefeVentasQuery = `
            SELECT 
                CODIGOVENDEDOR,
                CODIGONOMBRE,
                JEFEVENTASSN
            FROM DSEDAC.VDD
            WHERE JEFEVENTASSN = 'S'
        `;

        const jefes = await query(jefeVentasQuery);
        
        if (jefes.length > 0) {
            console.log(`\n✅ Se encontraron ${jefes.length} jefes de ventas:`);
            jefes.forEach(j => {
                console.log(`   - ${j.CODIGOVENDEDOR}: ${j.CODIGONOMBRE}`);
            });
            
            // Ver ventas de sus equipos
            console.log('\n📊 Ventas por equipo de jefe de ventas:');
            for (const jefe of jefes) {
                const ventasEquipo = vendedores.filter(v => {
                    // Aquí deberías tener la lógica de jerarquía si existe
                    return true; // Por ahora mostramos todos
                });
                
                const totalEquipo = ventasEquipo.reduce((sum, v) => sum + (parseFloat(v.ventas) || 0), 0);
                console.log(`   Jefe ${jefe.CODIGOVENDEDOR} (${jefe.CODIGONOMBRE}): ${totalEquipo.toFixed(2)}€`);
            }
        } else {
            console.log('\n⚠️  No se encontraron jefes de ventas con JEFEVENTASSN = S');
        }

        // =============================================================================
        // CONCLUSIÓN
        // =============================================================================
        console.log('\n' + '='.repeat(80));
        console.log('📌 RESUMEN');
        console.log('='.repeat(80));
        console.log(`\n1. Ventas del día (endpoint):         ${todaySales.toFixed(2)}€`);
        console.log(`2. Ordenes del día:                    ${todayOrders}`);
        console.log(`3. Panel jefe ventas muestra:         49.050,00€ (DATO PROPORCIONADO)`);
        console.log(`4. Diferencia:                         ${Math.abs(todaySales - 49050).toFixed(2)}€`);
        
        if (Math.abs(todaySales - 49050) > 1) {
            console.log('\n⚠️  HAY UNA DISCREPANCIA');
            console.log('\nPosibles causas:');
            console.log('  1. Cache desactualizado en el frontend/backend');
            console.log('  2. El panel del jefe de ventas tiene filtros adicionales');
            console.log('  3. El dato de 49.050€ es de un momento anterior del día');
            console.log('  4. Hay un filtro por vendedor o equipo aplicado');
            console.log('\n💡 ACCIÓN RECOMENDADA:');
            console.log('  - Limpiar cache: Verificar TTL en redis-cache.js');
            console.log('  - Revisar si el frontend tiene cache local');
            console.log('  - Confirmar que no hay filtros adicionales en el panel');
        } else {
            console.log('\n✅ Los valores coinciden (diferencia mínima)');
        }

        console.log('\n✅ Verificación completada');
        
        process.exit(0);

    } catch (error) {
        console.error('❌ Error en la verificación:', error);
        logger.error('Error verificando dashboard:', error);
        process.exit(1);
    }
}

// Ejecutar
verificarDashboard();
