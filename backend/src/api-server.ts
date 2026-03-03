import express from 'express';
import cors from 'cors';
import odbc from 'odbc';

const app = express();
const PORT = 3000;
const HOST_IP = '192.168.1.238';

// Middleware
app.use(cors());
app.use(express.json());

// ODBC Connection String
const ODBC_CONNECTION = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208;';

// Helper: Execute query
async function query(sql: string): Promise<any[]> {
    const conn = await odbc.connect(ODBC_CONNECTION);
    try {
        const result = await conn.query(sql);
        return result as any[];
    } finally {
        await conn.close();
    }
}

// ============================================
// ENDPOINTS
// ============================================

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// GET /api/clientes - Lista de clientes
app.get('/api/clientes', async (req, res) => {
    try {
        const clientes = await query(`
      SELECT * FROM DSEDAC.CLI 
      FETCH FIRST 100 ROWS ONLY
    `);
        res.json(clientes);
    } catch (error: any) {
        console.error('Error fetching clientes:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/cliente/:id - Detalle de cliente
app.get('/api/cliente/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Datos básicos del cliente
        const cliente = await query(`SELECT * FROM DSEDAC.CLI WHERE CODCLI = '${id}'`);

        // Historial de ventas (CAC = Cabecera Albarán/Factura)
        const ventas = await query(`
      SELECT * FROM DSEDAC.CAC 
      WHERE CLICAC = '${id}' 
      ORDER BY FECCAC DESC 
      FETCH FIRST 50 ROWS ONLY
    `);

        res.json({
            cliente: cliente[0] || null,
            ventas: ventas,
            totalVentas: ventas.length,
        });
    } catch (error: any) {
        console.error('Error fetching cliente detail:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/rutero - Clientes del día para el comercial
app.get('/api/rutero', async (req, res) => {
    try {
        // Obtener clientes con datos de ruta
        const rutero = await query(`
      SELECT C.*, 
        (SELECT SUM(TOTCAC) FROM DSEDAC.CAC WHERE CLICAC = C.CODCLI) as TOTAL_VENTAS
      FROM DSEDAC.CLI C
      FETCH FIRST 20 ROWS ONLY
    `);
        res.json(rutero);
    } catch (error: any) {
        console.error('Error fetching rutero:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/ventas - Estadísticas globales de ventas
app.get('/api/ventas/stats', async (req, res) => {
    try {
        // Ventas del día actual
        const hoy = await query(`
      SELECT SUM(TOTCAC) as TOTAL 
      FROM DSEDAC.CAC 
      WHERE DATE(FECCAC) = CURRENT_DATE
    `);

        // Ventas del mes
        const mes = await query(`
      SELECT SUM(TOTCAC) as TOTAL 
      FROM DSEDAC.CAC 
      WHERE YEAR(FECCAC) = YEAR(CURRENT_DATE) AND MONTH(FECCAC) = MONTH(CURRENT_DATE)
    `);

        // Ventas últimos 7 días (para gráfico)
        const trend = await query(`
      SELECT DATE(FECCAC) as FECHA, SUM(TOTCAC) as TOTAL 
      FROM DSEDAC.CAC 
      WHERE FECCAC >= CURRENT_DATE - 7 DAYS
      GROUP BY DATE(FECCAC)
      ORDER BY FECHA
    `);

        res.json({
            ventasHoy: hoy[0]?.TOTAL || 0,
            ventasMes: mes[0]?.TOTAL || 0,
            tendencia: trend,
        });
    } catch (error: any) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/productos - Catálogo de productos
app.get('/api/productos', async (req, res) => {
    try {
        const productos = await query(`
      SELECT * FROM DSEDAC.ART 
      FETCH FIRST 100 ROWS ONLY
    `);
        res.json(productos);
    } catch (error: any) {
        console.error('Error fetching productos:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║       🚀 GMP DATA API SERVER - REAL DATA BRIDGE 🚀        ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  📡 Server running on: http://${HOST_IP}:${PORT}          ║`);
    console.log('║  🔗 ODBC Connection: DSN=GMP                              ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║  ENDPOINTS:                                               ║');
    console.log('║    GET /api/health      - Health check                    ║');
    console.log('║    GET /api/clientes    - List all clients                ║');
    console.log('║    GET /api/cliente/:id - Client details + sales          ║');
    console.log('║    GET /api/rutero      - Today\'s route                   ║');
    console.log('║    GET /api/ventas/stats- Sales statistics                ║');
    console.log('║    GET /api/productos   - Product catalog                 ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('📱 Configure Flutter app to connect to this IP!');
});
