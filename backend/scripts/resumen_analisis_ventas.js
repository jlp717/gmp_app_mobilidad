// =============================================================================
// RESUMEN FINAL - ANÁLISIS DE VENTAS DEL 11/02/2026
// =============================================================================
// Este script proporciona un resumen completo del análisis de diferencias
// en las ventas reportadas

const { query } = require('../config/db');
const logger = require('../middleware/logger');

console.log(`
${'='.repeat(80)}
📊 ANÁLISIS COMPLETO DE VENTAS - 11 DE FEBRERO 2026
${'='.repeat(80)}

🔍 PROBLEMA IDENTIFICADO:
   - Panel Jefe Ventas muestra:    49.050,00€
   - Query usuario (sin filtros):  49.680,90€  
   - Query sistema (con filtros):  49.330,26€

${'='.repeat(80)}
📋 HALLAZGOS PRINCIPALES
${'='.repeat(80)}

1️⃣  DIFERENCIA ENTRE TU QUERY Y EL SISTEMA
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   
   ❌ Tu query original:
      SELECT SUM(L.LCIMVT) AS "Ventas SIN IVA"
      FROM DSED.LACLAE L
      WHERE LCDDDC = '11' AND LCMMDC = '02' AND LCAADC = '2026'
        AND TPDC = 'LAC'
   
   Resultado: 49.680,90€ (INCORRECTO - incluye documentos no válidos)
   
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   
   ✅ Query correcta del sistema:
      SELECT SUM(L.LCIMVT) AS "Ventas SIN IVA"
      FROM DSED.LACLAE L
      WHERE LCDDDC = '11' AND LCMMDC = '02' AND LCAADC = '2026'
        AND L.TPDC = 'LAC'                          ← Albaranes de cliente
        AND L.LCTPVT IN ('CC', 'VC')                ← Tipos de venta válidos
        AND L.LCCLLN IN ('AB', 'VT')                ← Clases de línea válidas
        AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')    ← Excluye endosos/otros
   
   Resultado: 49.330,26€ (CORRECTO)
   
   📌 Diferencia: 350,64€
   
   Motivo: 43 registros excluidos por los filtros:
   • TIPO VENTA EXCLUIDO (serie P): 350,64€
   • CLASE LINEA EXCLUIDA: 0,00€

${'='.repeat(80)}

2️⃣  DIFERENCIA ENTRE SISTEMA Y PANEL (49.330 vs 49.050)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   
   📌 Diferencia: ~280€
   
   Posibles causas:
   
   a) 🕐 CACHE DESACTUALIZADO
      • El backend usa cache Redis con TTL de 5 minutos (300s)
      • El frontend podría tener datos cacheados
      • El valor de 49.050€ podría ser de hace unos minutos
   
   b) 🔍 FILTRO POR VENDEDOR
      • El jefe de ventas podría tener un filtro activo
      • Verificar si está viendo solo su equipo/zona
   
   c) ⏰ MOMENTO DE CAPTURA
      • Las ventas cambian durante el día
      • El valor podría ser correcto para el momento en que se vio

${'='.repeat(80)}
✅ QUERY CORRECTA PARA TU APP
${'='.repeat(80)}

Usa esta query para obtener las ventas correctas del día:

\`\`\`sql
SELECT 
    SUM(L.LCIMVT) AS "Ventas SIN IVA",
    COUNT(DISTINCT L.LCNRAB) AS "Num Albaranes",
    COUNT(DISTINCT L.LCCDCL) AS "Num Clientes"
FROM DSED.LACLAE L
WHERE L.LCAADC = '2026' 
    AND L.LCMMDC = '02' 
    AND L.LCDDDC = '11'
    AND L.TPDC = 'LAC'
    AND L.LCTPVT IN ('CC', 'VC')
    AND L.LCCLLN IN ('AB', 'VT')
    AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
\`\`\`

📊 Resultado esperado: 49.330,26€

${'='.repeat(80)}
📌 FILTROS EXPLICADOS
${'='.repeat(80)}

TPDC = 'LAC'
  → Solo albaranes de cliente (tipo documento)
  
LCTPVT IN ('CC', 'VC')
  → Tipos de venta válidos:
    • CC = Contado Cliente
    • VC = Venta Cliente
  ⚠️  Excluye otros tipos como devoluciones, traspasos, etc.

LCCLLN IN ('AB', 'VT')
  → Clases de línea válidas:
    • AB = Albarán
    • VT = Venta
  ⚠️  Excluye líneas de embalaje, transportes, etc.

LCSRAB NOT IN ('N', 'Z', 'G', 'D')
  → Excluye series especiales:
    • N = Notas / Endosos
    • Z = Documentos anulados
    • G = Garantías
    • D = Devoluciones

${'='.repeat(80)}
🎯 RECOMENDACIONES
${'='.repeat(80)}

1. ✅ USAR LA QUERY CORRECTA
   → Implementa los 4 filtros mencionados arriba en todas tus consultas

2. 🔄 LIMPIAR CACHE
   → Reinicia el servidor backend o espera 5 minutos
   → Verifica el valor actualizado en el panel del jefe de ventas

3. 📱 ACTUALIZAR APP
   → El endpoint /dashboard/metrics ya usa los filtros correctos
   → No requiere cambios en el backend

4. 📊 VERIFICAR VALOR ACTUAL
   → Ejecuta: node scripts/verificar_dashboard_ventas.js
   → Compara con lo que muestra el panel

5. 🔍 SI LA DIFERENCIA PERSISTE
   → Verifica filtros activos en el dashboard (vendedor, zona, etc.)
   → Revisa logs para ver qué parámetros se están enviando

${'='.repeat(80)}
📝 REGISTROS EXCLUIDOS (PRINCIPALES)
${'='.repeat(80)}

Los siguientes registros NO cuentan para las ventas (350,64€):

• HELADERIA SAN MIGUEL (Albarán 370):  190,69€ → TIPO VENTA EXCLUIDO
• PANADERIA HERMANOS ALMAGRO (Alb 287): 34,93€ → TIPO VENTA EXCLUIDO
• BAR TOTI (Albarán 254):               32,21€ → TIPO VENTA EXCLUIDO
• HELADERIA SAN MIGUEL (Albarán 370):   31,28€ → TIPO VENTA EXCLUIDO
• RESTAURANTE LA CAVERNA (Alb 251):     28,75€ → TIPO VENTA EXCLUIDO
• RESTAURANTE EL PEREJIL (Albarán 330): 28,26€ → TIPO VENTA EXCLUIDO
• + 37 registros más con importes menores o líneas adicionales

Motivo: Estos registros tienen LCTPVT que no es 'CC' ni 'VC'
(posiblemente traspasos, embalajes, o tipos de documento especiales)

${'='.repeat(80)}
🔢 RESUMEN DE CIFRAS
${'='.repeat(80)}

Query Básica (sin filtros):     49.680,90€  ❌ INCORRECTO
Query Sistema (con filtros):    49.330,26€  ✅ CORRECTO
Panel Jefe Ventas (reportado):  49.050,00€  ⚠️  VERIFICAR CACHE/FILTROS

Diferencia explicada:            350,64€ (registros no válidos)
Diferencia a investigar:         ~280€ (cache o filtros adicionales)

${'='.repeat(80)}
`);

async function validarCifraFinal() {
    try {
        const fecha = { dia: 11, mes: 2, anio: 2026 };
        
        const LACLAE_SALES_FILTER = `
            L.TPDC = 'LAC'
            AND L.LCTPVT IN ('CC', 'VC')
            AND L.LCCLLN IN ('AB', 'VT')
            AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
        `.replace(/\s+/g, ' ').trim();

        const queryFinal = `
            SELECT 
                COALESCE(SUM(L.LCIMVT), 0) as ventas
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${fecha.anio} 
                AND L.LCMMDC = ${fecha.mes} 
                AND L.LCDDDC = ${fecha.dia} 
                AND ${LACLAE_SALES_FILTER}
        `;

        const result = await query(queryFinal);
        const ventas = parseFloat(result[0]?.VENTAS) || 0;
        
        console.log('✅ VALIDACIÓN FINAL:');
        console.log(`   Ventas del día (CORRECTAS): ${ventas.toFixed(2)}€`);
        console.log('');
        
        if (Math.abs(ventas - 49050) > 100) {
            console.log('⚠️  IMPORTANTE: Hay diferencia significativa con el panel (49.050€)');
            console.log('   Por favor:');
            console.log('   1. Verifica si el jefe de ventas tiene filtros activos');
            console.log('   2. Limpia el cache del navegador');
            console.log('   3. Espera 5 minutos y vuelve a cargar el dashboard');
        } else {
            console.log('✅ La cifra coincide aproximadamente con el panel');
        }
        
        console.log('');
        console.log('='.repeat(80));
        
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

validarCifraFinal();
