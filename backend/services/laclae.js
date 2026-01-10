const logger = require('../middleware/logger');
const { getPool } = require('../config/db');

// LACLAE Cache for fast visit/delivery day lookups
// Structure: { vendedor: { clientCode: { visitDays: [], deliveryDays: [] } } }
let laclaeCache = {};
let laclaeCacheReady = false;

// Load LACLAE visit/delivery data into memory cache
// Rutero Configuration Cache (Overrides)
// Structure: { clientCode: { day: 'lunes', order: 1, vendedor: 'XX' } }
// Note: clientCode is unique enough, but technically a client could be visited by multiple vendors?
// Assuming JAVIER.RUTERO_CONFIG is per pair VENDEDOR-CLIENTE.
// Structure: { vendor: { clientCode: { day: 'lunes', order: 1 } } }
let ruteroConfigCache = {};

async function loadRuteroConfigCache(conn) {
    try {
        const rows = await conn.query(`
            SELECT TRIM(VENDEDOR) as VENDEDOR, TRIM(CLIENTE) as CLIENTE, TRIM(DIA) as DIA, ORDEN
            FROM JAVIER.RUTERO_CONFIG
        `);

        ruteroConfigCache = {};
        rows.forEach(r => {
            if (!r.VENDEDOR || !r.CLIENTE) return;
            if (!ruteroConfigCache[r.VENDEDOR]) ruteroConfigCache[r.VENDEDOR] = {};

            ruteroConfigCache[r.VENDEDOR][r.CLIENTE] = {
                day: r.DIA?.toLowerCase(),
                order: r.ORDEN
            };
        });
        logger.info(`📅 Rutero Config loaded: ${rows.length} overrides`);
    } catch (e) {
        logger.warn(`⚠️ Failed to load Rutero Config (might not exist yet): ${e.message}`);
    }
}

// Reload function exposed for planner.js
async function reloadRuteroConfig() {
    const dbPool = getPool();
    if (!dbPool) return;
    try {
        const conn = await dbPool.connect();
        await loadRuteroConfigCache(conn);
        await conn.close();
    } catch (e) {
        logger.error(`Reload config failed: ${e.message}`);
    }
}


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
            // Load base LACLAE data
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

                if (!laclaeCache[vendedor][cliente]) {
                    laclaeCache[vendedor][cliente] = {
                        visitDays: new Set(),
                        deliveryDays: new Set()
                    };
                }

                const entry = laclaeCache[vendedor][cliente];

                for (let i = 0; i < 7; i++) {
                    if (row[visitCols[i]] === 'S') entry.visitDays.add(dayNames[i]);
                    if (row[deliveryCols[i]] === 'S') entry.deliveryDays.add(dayNames[i]);
                }
            });

            // Convert Sets to Arrays for compatibility
            Object.values(laclaeCache).forEach(vendorClients => {
                Object.values(vendorClients).forEach(clientData => {
                    clientData.visitDays = Array.from(clientData.visitDays);
                    clientData.deliveryDays = Array.from(clientData.deliveryDays);
                });
            });

            // Load Overrides
            await loadRuteroConfigCache(conn);

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
    let finalClients = new Set();

    const vendedors = vendedorCodes ? vendedorCodes.split(',').map(c => c.trim()) : Object.keys(laclaeCache);

    vendedors.forEach(vendedor => {
        // 1. Get Natural Clients (LACLAE)
        const vendorClients = laclaeCache[vendedor] || {};
        const configClients = ruteroConfigCache[vendedor] || {};

        Object.entries(vendorClients).forEach(([clientCode, data]) => {
            const days = isDelivery ? data.deliveryDays : data.visitDays;

            // Check override
            const override = configClients[clientCode];

            let shouldInclude = false;

            if (override) {
                // If overridden, ONLY appear if override day matches
                if (override.day === dayLower) shouldInclude = true;
            } else {
                // No override, use natural days
                if (days.includes(dayLower)) shouldInclude = true;
            }

            if (shouldInclude) {
                finalClients.add(clientCode);
            }
        });

        // 2. Add clients that exist ONLY in RuteroConfig (orphan overrides? rare but possible)
        // or clients that were missed above because they aren't in LACLAE cache for this vendor?
        // Let's iterate configClients ensuring we catch anyone moved TO this day
        Object.entries(configClients).forEach(([clientCode, cfg]) => {
            if (cfg.day === dayLower) {
                finalClients.add(clientCode);
            }
        });
    });

    return Array.from(finalClients);
}

// Get week counts from cache - FIXED: Considera los overrides de RUTERO_CONFIG
function getWeekCountsFromCache(vendedorCodes, role = 'comercial') {
    if (!laclaeCacheReady) return null; // Use fallback

    const isDelivery = role === 'repartidor';
    const counts = { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 };
    const clientsSet = { lunes: new Set(), martes: new Set(), miercoles: new Set(), jueves: new Set(), viernes: new Set(), sabado: new Set(), domingo: new Set() };

    const vendedors = vendedorCodes ? vendedorCodes.split(',').map(c => c.trim()) : Object.keys(laclaeCache);

    vendedors.forEach(vendedor => {
        const vendorClients = laclaeCache[vendedor] || {};
        const configClients = ruteroConfigCache[vendedor] || {};
        
        // Set of clients that have been moved via RUTERO_CONFIG
        const movedClients = new Set(Object.keys(configClients));
        
        Object.entries(vendorClients).forEach(([clientCode, data]) => {
            const days = isDelivery ? data.deliveryDays : data.visitDays;
            
            // Check if this client has an override
            const override = configClients[clientCode];
            
            if (override) {
                // Client has override - only count on override day
                const overrideDay = override.day;
                if (counts.hasOwnProperty(overrideDay)) {
                    clientsSet[overrideDay].add(clientCode);
                }
            } else {
                // No override - use natural days from LACLAE
                days.forEach(day => {
                    if (counts.hasOwnProperty(day)) {
                        clientsSet[day].add(clientCode);
                    }
                });
            }
        });
        
        // Also add clients that exist ONLY in RuteroConfig (orphan overrides)
        Object.entries(configClients).forEach(([clientCode, cfg]) => {
            if (counts.hasOwnProperty(cfg.day)) {
                clientsSet[cfg.day].add(clientCode);
            }
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

// Get client codes from cache (for optimization)
function getClientCodesFromCache(vendedorCodes) {
    if (!laclaeCacheReady) return null;

    const allClients = new Set();

    const vendedors = vendedorCodes ? vendedorCodes.split(',').map(c => c.trim()) : Object.keys(laclaeCache);

    vendedors.forEach(vendedor => {
        const vendorClients = laclaeCache[vendedor] || {};
        Object.keys(vendorClients).forEach(clientCode => {
            allClients.add(clientCode);
        });
    });

    return Array.from(allClients);
}

// Get list of vendedores from cache
function getVendedoresFromCache() {
    if (!laclaeCacheReady) return null;

    return Object.entries(laclaeCache).map(([code, clients]) => ({
        code,
        clients: Object.keys(clients).length
    })).sort((a, b) => b.clients - a.clients);
}

// Get aggregated active VISIT days for a vendor (if they have ANY client with visit on that day)
function getVendorActiveDaysFromCache(vendedorCode) {
    if (!laclaeCacheReady || !vendedorCode) {
        console.log(`⚠️ getVendorActiveDaysFromCache: cache not ready or no vendedorCode`);
        return [];
    }

    const trimmedCode = vendedorCode.trim();
    const vendorClients = laclaeCache[trimmedCode];

    if (!vendorClients) {
        console.log(`⚠️ Vendor ${trimmedCode} not in LACLAE cache. Available: ${Object.keys(laclaeCache).slice(0, 10).join(', ')}...`);
        return [];
    }

    const daysSet = new Set();
    Object.values(vendorClients).forEach(clientData => {
        if (clientData.visitDays) {
            clientData.visitDays.forEach(d => daysSet.add(d));
        }
    });

    const result = Array.from(daysSet);
    console.log(`📅 Vendor ${trimmedCode} visit days: ${result.join(', ')} (${Object.keys(vendorClients).length} clients)`);
    return result; // Returns ['lunes', 'martes'...]
}

// Get aggregated active DELIVERY days for a vendor (for repartidores in rutero)
function getVendorDeliveryDaysFromCache(vendedorCode) {
    if (!laclaeCacheReady || !vendedorCode) return [];

    const trimmedCode = vendedorCode.trim();
    const vendorClients = laclaeCache[trimmedCode] || {};

    const daysSet = new Set();
    Object.values(vendorClients).forEach(clientData => {
        if (clientData.deliveryDays) {
            clientData.deliveryDays.forEach(d => daysSet.add(d));
        }
    });

    return Array.from(daysSet);
}

// Debug: Get list of vendor codes in cache
function getCachedVendorCodes() {
    if (!laclaeCacheReady) return [];
    return Object.keys(laclaeCache);
}

/**
 * Obtiene el día actual de un cliente para un vendedor
 * Primero busca en RUTERO_CONFIG (override), si no existe, usa LACLAE (días naturales)
 * @returns {string|null} El día en minúsculas o null si no está asignado
 */
function getClientCurrentDay(vendedor, clientCode) {
    if (!laclaeCacheReady) return null;
    
    const vendedorStr = String(vendedor).trim();
    const clientStr = String(clientCode).trim();
    
    // 1. Buscar override en RUTERO_CONFIG
    const configClients = ruteroConfigCache[vendedorStr] || {};
    if (configClients[clientStr]) {
        return configClients[clientStr].day || null;
    }
    
    // 2. Buscar días naturales en LACLAE
    const vendorClients = laclaeCache[vendedorStr] || {};
    const clientData = vendorClients[clientStr];
    if (clientData && clientData.visitDays && clientData.visitDays.length > 0) {
        // Devolver el primer día de visita natural
        return clientData.visitDays[0];
    }
    
    return null;
}

module.exports = {
    loadLaclaeCache,
    getClientsForDay,
    getWeekCountsFromCache,
    getTotalClientsFromCache,
    getClientCodesFromCache,
    getVendedoresFromCache,
    getVendorActiveDaysFromCache,
    getVendorDeliveryDaysFromCache,
    getCachedVendorCodes,
    reloadRuteroConfig,
    getClientCurrentDay
};
