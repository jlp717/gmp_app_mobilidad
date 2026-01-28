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

            if (!ruteroConfigCache[r.VENDEDOR][r.CLIENTE]) {
                ruteroConfigCache[r.VENDEDOR][r.CLIENTE] = {};
            }
            // Store by DAY
            ruteroConfigCache[r.VENDEDOR][r.CLIENTE][r.DIA?.toLowerCase()] = {
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
// NOW ENHANCED: Merges data from DSEDAC.CDVI (Master Route Config) + DSED.LACLAE (Sales/History)
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
            laclaeCache = {};

            // 1. Load Master Route Config from DSEDAC.CDVI (Cuadro de Visitas)
            // This ensures NEW clients without sales are included
            logger.info('   Loading Master Route Config from DSEDAC.CDVI...');
            const cdviRows = await conn.query(`
                SELECT 
                    TRIM(CODIGOVENDEDOR) as VENDEDOR,
                    TRIM(CODIGOCLIENTE) as CLIENTE,
                    DIAVISITALUNESSN as VIS_L, 
                    DIAVISITAMARTESSN as VIS_M, 
                    DIAVISITAMIERCOLESSN as VIS_X,
                    DIAVISITAJUEVESSN as VIS_J, 
                    DIAVISITAVIERNESSN as VIS_V, 
                    DIAVISITASABADOSN as VIS_S, 
                    DIAVISITADOMINGOSN as VIS_D,
                    ORDENVISITALUNES as OR_L,
                    ORDENVISITAMARTES as OR_M,
                    ORDENVISITAMIERCOLES as OR_X,
                    ORDENVISITAJUEVES as OR_J,
                    ORDENVISITAVIERNES as OR_V,
                    ORDENVISITASABADO as OR_S,
                    ORDENVISITADOMINGO as OR_D
                FROM DSEDAC.CDVI
                WHERE (MARCAACTUALIZACION <> 'B' OR MARCAACTUALIZACION IS NULL OR TRIM(MARCAACTUALIZACION) = '')  -- Fix: Handle spaces too
            `);

            const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
            // CDVI mapping: Sunday is usually handled, checking sample data

            cdviRows.forEach(row => {
                if (!row.VENDEDOR || !row.CLIENTE) return;

                if (!laclaeCache[row.VENDEDOR]) laclaeCache[row.VENDEDOR] = {};
                if (!laclaeCache[row.VENDEDOR][row.CLIENTE]) {
                    laclaeCache[row.VENDEDOR][row.CLIENTE] = {
                        visitDays: new Set(),
                        deliveryDays: new Set(),
                        naturalOrder: {
                            lunes: Number(row.OR_L) || 0,
                            martes: Number(row.OR_M) || 0,
                            miercoles: Number(row.OR_X) || 0,
                            jueves: Number(row.OR_J) || 0,
                            viernes: Number(row.OR_V) || 0,
                            sabado: Number(row.OR_S) || 0,
                            domingo: Number(row.OR_D) || 0
                        }
                    };
                }

                const entry = laclaeCache[row.VENDEDOR][row.CLIENTE];

                // Map 'S' to days (Handle 'S ' with trim)
                if (String(row.VIS_D).trim() === 'S') entry.visitDays.add('domingo');
                if (String(row.VIS_L).trim() === 'S') entry.visitDays.add('lunes');
                if (String(row.VIS_M).trim() === 'S') entry.visitDays.add('martes');
                if (String(row.VIS_X).trim() === 'S') entry.visitDays.add('miercoles');
                if (String(row.VIS_J).trim() === 'S') entry.visitDays.add('jueves');
                if (String(row.VIS_V).trim() === 'S') entry.visitDays.add('viernes');
                if (String(row.VIS_S).trim() === 'S') entry.visitDays.add('sabado');

                if (String(row.CLIENTE).includes('9046')) {
                    logger.info(`🔍 DEBUG 9046 MATCH: '${row.CLIENTE}' Vend '${row.VENDEDOR}' Flags L:${row.VIS_L} V:${row.VIS_V} (Hex V: ${Buffer.from(String(row.VIS_V)).toString('hex')}) -> Days: ${Array.from(entry.visitDays).join(',')}`);
                }
            });

            logger.info(`   ✅ Loaded ${cdviRows.length} route configs from CDVI`);
            const v15Count = cdviRows.filter(r => r.VENDEDOR === '15').length;
            logger.info(`   🔎 DEBUG: Vendor 15 has ${v15Count} clients in CDVI cache`);


            // 2. Load Sales/History data from DSED.LACLAE (Legacy source + Delivery Info)
            // Load base LACLAE data (Optimized: Current + Previous Year only)
            const currentYear = new Date().getFullYear();
            const startYear = currentYear - 1;

            const rows = await conn.query(`
        SELECT DISTINCT
          R1_T8CDVD as VENDEDOR,
          LCCDCL as CLIENTE,
          R1_T8DIVL as VIS_L, R1_T8DIVM as VIS_M, R1_T8DIVX as VIS_X,
          R1_T8DIVJ as VIS_J, R1_T8DIVV as VIS_V, R1_T8DIVS as VIS_S, R1_T8DIVD as VIS_D,
          R1_T8DIRL as DEL_L, R1_T8DIRM as DEL_M, R1_T8DIRX as DEL_X,
          R1_T8DIRJ as DEL_J, R1_T8DIRV as DEL_V, R1_T8DIRS as DEL_S, R1_T8DIRD as DEL_D
        FROM DSED.LACLAE
        WHERE R1_T8CDVD IS NOT NULL 
          AND LCCDCL IS NOT NULL
          AND LCAADC >= ${startYear}
      `);

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

            logger.info(`📅 LACLAE/CDVI cache loaded: ${vendorCount} vendors, ${totalClients} clients in ${duration}ms`);
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
function getClientsForDay(vendedorCodes, day, role = 'comercial', ignoreOverrides = false) {
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

            let shouldInclude = false;

            if (!ignoreOverrides) {
                // Check override FOR THIS DAY SPECIFICALLY
                const clientOverrides = configClients[clientCode] || {};
                const overrideForDay = clientOverrides[dayLower];

                if (overrideForDay) {
                    // Clearly overridden for this day -> INCLUDE
                    shouldInclude = true;
                } else {
                    // No override for this specific day.
                    // CHECK: Does the user expect this day to be blocked if another day has an override?
                    // Previous logic: YES. New logic: NO (Additive/Fallback behaviors).
                    // If we have Natural Visit Day AND no specific override blocking it -> INCLUDE
                    if (days.includes(dayLower)) shouldInclude = true;
                }
            } else {
                // Ignore overrides - PURE NATURAL ROUTE
                if (days.includes(dayLower)) shouldInclude = true;
            }

            if (shouldInclude) {
                finalClients.add(clientCode);
            }
        });

        console.log(`📊 getClientsForDay('${vendedor}', '${day}'): Found ${finalClients.size} so far`);

        // 2. Add clients that exist ONLY in RuteroConfig (orphan overrides)
        // ONLY if NOT ignoring overrides
        if (!ignoreOverrides) {
            Object.entries(configClients).forEach(([clientCode, cfg]) => {
                const clientOverrides = configClients[clientCode] || {};
                if (clientOverrides[dayLower]) {
                    finalClients.add(clientCode);
                }
            });
        }
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
            // Check if this client has ANY overrides
            const clientOverrides = configClients[clientCode] || {};
            const overrideDays = Object.keys(clientOverrides);

            // 1. Add overrides
            overrideDays.forEach(day => {
                if (counts.hasOwnProperty(day)) {
                    clientsSet[day].add(clientCode);
                }
            });

            // 2. Add Natural Days (IF NOT OVERRIDDEN on that day? Or additive?)
            // Fallback logic says: If no override for day, allow natural.
            days.forEach(day => {
                if (counts.hasOwnProperty(day) && !clientOverrides[day]) {
                    clientsSet[day].add(clientCode);
                }
            });
        });

        // Also add clients that exist ONLY in RuteroConfig (orphan overrides)
        // Also add clients that exist ONLY in RuteroConfig (orphans)
        Object.entries(configClients).forEach(([clientCode, overrides]) => {
            Object.keys(overrides).forEach(day => {
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
    // 1. Buscar overrides en RUTERO_CONFIG
    const configClients = ruteroConfigCache[vendedorStr] || {};
    const clientOverrides = configClients[clientStr];

    if (clientOverrides) {
        // Return the first override day found (not perfect but acceptable for simple current-day logic)
        // Or if today matches execution day?
        // This function is ambiguous in multi-day. Let's return the first key.
        const days = Object.keys(clientOverrides);
        if (days.length > 0) return days[0];
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

/**
 * Get visit and delivery days for a specific client
 * @param {string} vendorCode - Vendor code (optional, will search all if not provided)
 * @param {string} clientCode - Client code
 * @returns { visitDays: string[], deliveryDays: string[] } or null
 */
function getClientDays(vendorCode, clientCode) {
    if (!laclaeCacheReady || !clientCode) return null;

    const dayLabels = {
        'lunes': 'L', 'martes': 'M', 'miercoles': 'X',
        'jueves': 'J', 'viernes': 'V', 'sabado': 'S', 'domingo': 'D'
    };

    const trimmedClient = clientCode.trim();

    // If vendor specified, search only there
    if (vendorCode) {
        const vendorData = laclaeCache[vendorCode.trim()];
        if (vendorData && vendorData[trimmedClient]) {
            const data = vendorData[trimmedClient];
            return {
                visitDays: data.visitDays || [],
                deliveryDays: data.deliveryDays || [],
                visitDaysShort: (data.visitDays || []).map(d => dayLabels[d] || d).join(''),
                deliveryDaysShort: (data.deliveryDays || []).map(d => dayLabels[d] || d).join('')
            };
        }
    }

    // Search all vendors
    for (const [vCode, vendorData] of Object.entries(laclaeCache)) {
        if (vendorData[trimmedClient]) {
            const data = vendorData[trimmedClient];
            return {
                visitDays: data.visitDays || [],
                deliveryDays: data.deliveryDays || [],
                visitDaysShort: (data.visitDays || []).map(d => dayLabels[d] || d).join(''),
                deliveryDaysShort: (data.deliveryDays || []).map(d => dayLabels[d] || d).join(''),
                foundVendor: vCode
            };
        }
    }

    return null;
}

/**
 * Get natural order for a client on a specific day
 */
function getNaturalOrder(vendorCode, clientCode, day) {
    if (!laclaeCacheReady || !vendorCode || !clientCode || !day) return 9999;

    const vendorData = laclaeCache[vendorCode.trim()];
    if (!vendorData) return 9999;

    const clientData = vendorData[clientCode.trim()];
    if (!clientData || !clientData.naturalOrder) return 9999;

    const order = clientData.naturalOrder[day.toLowerCase()];
    // If order is 0, return 9999 (so it falls back to Code/Name sort logic)
    // Actually, planner will handle fallback logic. Let's return the raw value.
    return order || 0;
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
    getClientCurrentDay,
    reloadRuteroConfig,
    getClientCurrentDay,
    getClientDays,
    getNaturalOrder
};
