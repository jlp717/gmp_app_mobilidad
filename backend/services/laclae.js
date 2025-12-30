const logger = require('../middleware/logger');
const { getPool } = require('../config/db');

// LACLAE Cache for fast visit/delivery day lookups
// Structure: { vendedor: { clientCode: { visitDays: [], deliveryDays: [] } } }
let laclaeCache = {};
let laclaeCacheReady = false;

// Load LACLAE visit/delivery data into memory cache
async function loadLaclaeCache() {
    logger.info('📅 Loading LACLAE cache (visit/delivery days)...');
    const start = Date.now();

    const dbPool = getPool();
    if (!dbPool) {
        logger.error('❌ Database pool not initialized - cannot load LACLAE cache');
        return;
    }

    try {
        const conn = await dbPool.connect();
        try {
            // Load visit/delivery flags for all clients - this takes a while but only once at startup
            const rows = await conn.query(`
        SELECT DISTINCT
          R1_T8CDVD as VENDEDOR,
          LCCDCL as CLIENTE,
          R1_T8DIVL as VIS_L, R1_T8DIVM as VIS_M, R1_T8DIVX as VIS_X,
          R1_T8DIVJ as VIS_J, R1_T8DIVV as VIS_V, R1_T8DIVS as VIS_S, R1_T8DIVD as VIS_D,
          R1_T8DIRL as DEL_L, R1_T8DIRM as DEL_M, R1_T8DIRX as DEL_X,
          R1_T8DIRJ as DEL_J, R1_T8DIRV as DEL_V, R1_T8DIRS as DEL_S, R1_T8DIRD as DEL_D
        FROM DSED.LACLAE
        WHERE R1_T8CDVD IS NOT NULL AND LCCDCL IS NOT NULL
      `);

            // Build the cache
            laclaeCache = {};
            const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
            const visitCols = ['VIS_D', 'VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V', 'VIS_S'];
            const deliveryCols = ['DEL_D', 'DEL_L', 'DEL_M', 'DEL_X', 'DEL_J', 'DEL_V', 'DEL_S'];

            rows.forEach(row => {
                const vendedor = row.VENDEDOR?.trim() || '';
                const cliente = row.CLIENTE?.trim() || '';
                if (!vendedor || !cliente) return;

                if (!laclaeCache[vendedor]) laclaeCache[vendedor] = {};

                // Parse visit days
                const visitDays = [];
                const deliveryDays = [];

                for (let i = 0; i < 7; i++) {
                    if (row[visitCols[i]] === 'S') visitDays.push(dayNames[i]);
                    if (row[deliveryCols[i]] === 'S') deliveryDays.push(dayNames[i]);
                }

                laclaeCache[vendedor][cliente] = { visitDays, deliveryDays };
            });

            const vendorCount = Object.keys(laclaeCache).length;
            const totalClients = Object.values(laclaeCache).reduce((sum, v) => sum + Object.keys(v).length, 0);
            const duration = Date.now() - start;

            logger.info(`📅 LACLAE cache loaded: ${vendorCount} vendors, ${totalClients} clients in ${duration}ms`);
            laclaeCacheReady = true;

        } finally {
            await conn.close();
        }
    } catch (error) {
        logger.warn(`⚠️ LACLAE cache failed to load: ${error.message} - using hash fallback`);
        laclaeCacheReady = false;
    }
}

// Get clients for a day from cache
function getClientsForDay(vendedorCodes, day, role = 'comercial') {
    if (!laclaeCacheReady) return null; // Use fallback

    const dayLower = day.toLowerCase();
    const isDelivery = role === 'repartidor';
    const clients = [];

    const vendedors = vendedorCodes ? vendedorCodes.split(',').map(c => c.trim()) : Object.keys(laclaeCache);

    vendedors.forEach(vendedor => {
        const vendorClients = laclaeCache[vendedor] || {};
        Object.entries(vendorClients).forEach(([clientCode, data]) => {
            const days = isDelivery ? data.deliveryDays : data.visitDays;
            if (days.includes(dayLower)) {
                clients.push(clientCode);
            }
        });
    });

    return [...new Set(clients)]; // Unique clients
}

// Get week counts from cache
function getWeekCountsFromCache(vendedorCodes, role = 'comercial') {
    if (!laclaeCacheReady) return null; // Use fallback

    const isDelivery = role === 'repartidor';
    const counts = { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 };
    const clientsSet = { lunes: new Set(), martes: new Set(), miercoles: new Set(), jueves: new Set(), viernes: new Set(), sabado: new Set(), domingo: new Set() };

    const vendedors = vendedorCodes ? vendedorCodes.split(',').map(c => c.trim()) : Object.keys(laclaeCache);

    vendedors.forEach(vendedor => {
        const vendorClients = laclaeCache[vendedor] || {};
        Object.entries(vendorClients).forEach(([clientCode, data]) => {
            const days = isDelivery ? data.deliveryDays : data.visitDays;
            days.forEach(day => {
                if (counts.hasOwnProperty(day)) {
                    clientsSet[day].add(clientCode);
                }
            });
        });
    });

    Object.keys(counts).forEach(day => {
        counts[day] = clientsSet[day].size;
    });

    return counts;
}

// Get total unique clients from cache
function getTotalClientsFromCache(vendedorCodes, role = 'comercial') {
    if (!laclaeCacheReady) return 0;

    const isDelivery = role === 'repartidor';
    const allClients = new Set();

    const vendedors = vendedorCodes ? vendedorCodes.split(',').map(c => c.trim()) : Object.keys(laclaeCache);

    vendedors.forEach(vendedor => {
        const vendorClients = laclaeCache[vendedor] || {};
        Object.entries(vendorClients).forEach(([clientCode, data]) => {
            const days = isDelivery ? data.deliveryDays : data.visitDays;
            if (days.length > 0) {
                allClients.add(clientCode);
            }
        });
    });

    return allClients.size;
}

// Get list of vendedores from cache
function getVendedoresFromCache() {
    if (!laclaeCacheReady) return null;

    return Object.entries(laclaeCache).map(([code, clients]) => ({
        code,
        clients: Object.keys(clients).length
    })).sort((a, b) => b.clients - a.clients);
}

module.exports = {
    loadLaclaeCache,
    getClientsForDay,
    getWeekCountsFromCache,
    getTotalClientsFromCache,
    getVendedoresFromCache
};
