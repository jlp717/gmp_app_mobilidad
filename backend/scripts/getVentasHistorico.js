const { query } = require('../config/db');

async function getVentasHistorico() {
    try {
        console.log('--- Consultando Histórico de Ventas (Comparativa Mensual) ---');

        // Ejemplo: Consultar para un cliente específico o global
        // Ajusta el CODIGOCLIENTE o VENDEDOR según necesites probar
        const CODIGO_CLIENTE = process.argv[2] || '9900'; // Default test client
        const YEAR_CURRENT = new Date().getFullYear();
        const YEAR_PREVIOUS = YEAR_CURRENT - 1;

        console.log(`Cliente: ${CODIGO_CLIENTE}`);
        console.log(`Comparando Año ${YEAR_CURRENT} vs ${YEAR_PREVIOUS}`);

        // Consulta SQL para obtener ventas por mes para los dos años
        // Asumiendo tabla de movimientos o agregados. Ajustar según esquema real (ej. FAC, LFA, etc.)
        // Usaremos una estructura genérica basada en lo que solemos ver en GMP (LFA/FAC)
        // Nota: Ajusta los nombres de tabla/columnas si difieren en tu DB real.

        const sql = `
            SELECT 
                MONTH(FECHA) as MES,
                YEAR(FECHA) as ANIO,
                SUM(BASEIMPONIBLE) as TOTAL_VENTAS
            FROM DSEDAC.LFA
            WHERE CODIGOCLIENTE = '${CODIGO_CLIENTE}'
              AND YEAR(FECHA) IN (${YEAR_PREVIOUS}, ${YEAR_CURRENT})
            GROUP BY MONTH(FECHA), YEAR(FECHA)
            ORDER BY MONTH(FECHA)
        `;

        console.log(`Ejecutando Query...`);
        // const results = await query(sql); // Descomentar si la tabla existe y es correcta

        // MOCK DATA para demostración si no hay conexión real o tabla específica
        // Generamos datos para simular la casuística solicitada:
        // Mes 1: Ventas año pasado 0, este año 100 -> NUEVO (Azul)
        // Mes 2: Ventas año pasado 100, este año 120 -> MEJORA (Verde)
        // Mes 3: Ventas año pasado 100, este año 80 -> DESMEJORA (Rojo)

        const mockResults = [
            { MES: 1, ANIO: YEAR_PREVIOUS, TOTAL_VENTAS: 0 },
            { MES: 1, ANIO: YEAR_CURRENT, TOTAL_VENTAS: 150.50 },
            { MES: 2, ANIO: YEAR_PREVIOUS, TOTAL_VENTAS: 1000.00 },
            { MES: 2, ANIO: YEAR_CURRENT, TOTAL_VENTAS: 1200.00 },
            { MES: 3, ANIO: YEAR_PREVIOUS, TOTAL_VENTAS: 500.00 },
            { MES: 3, ANIO: YEAR_CURRENT, TOTAL_VENTAS: 400.00 },
        ];

        console.log('\nResultados Raw (Simulados):');
        console.table(mockResults);

        // Procesamiento para visualizar la lógica de colores
        console.log('\n--- Análisis de Colores ---');

        const months = {};
        mockResults.forEach(r => {
            if (!months[r.MES]) months[r.MES] = { prev: 0, curr: 0 };
            if (r.ANIO === YEAR_PREVIOUS) months[r.MES].prev = r.TOTAL_VENTAS;
            if (r.ANIO === YEAR_CURRENT) months[r.MES].curr = r.TOTAL_VENTAS;
        });

        Object.keys(months).forEach(mes => {
            const { prev, curr } = months[mes];
            let status = 'NORMAL';
            let color = 'WHITE';

            if (prev === 0 && curr > 0) {
                status = 'NUEVO (Cliente no compró este mes el año pasado)';
                color = '#0000FF (AZUL)';
            } else if (curr > prev) {
                status = 'MEJORA';
                color = '#00FF00 (VERDE)';
            } else if (curr < prev) {
                status = 'DESMEJORA';
                color = '#FF0000 (ROJO)';
            } else {
                status = 'IGUAL / SIN VENTAS';
                color = 'GRAY';
            }

            console.log(`Mes ${mes}: Prev=${prev.toFixed(2)}, Curr=${curr.toFixed(2)} -> ${status} [${color}]`);
        });

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

getVentasHistorico();
