const logger = require('../middleware/logger');
const { getPool } = require('../config/db');

// LACLAE Cache for fast visit/delivery day lookups
// Structure: { vendedor: { clientCode: { visitDays: [], deliveryDays: [] } } }
// PRODUCTION-READY: LRU eviction with MAX_ENTRIES limit to prevent memory exhaustion
const MAX_CACHE_ENTRIES = 50000; // Max vendor-client pairs (50k entries ~ 50-100MB)
const MAX_CONFIG_ENTRIES = 10000; // Max rutero config entries
let laclaeCache = {};
let laclaeCacheReady = false;
let laclaeCacheLoadAttempted = false;
let laclaeCacheLastLoadTime = null;
let laclaeCacheAccessOrder = []; // LRU tracking: [vendor-client-key, ...]
let ruteroConfigCache = {};
let ruteroConfigAccessOrder = []; // LRU tracking for config
let laclaeCacheLoadPromise = null;

function toDayArray(days) {
    if (Array.isArray(days)) return days;
    if (days instanceof Set) return Array.from(days);
    return [];
}

/** CLI.ANOBAJA: 0 / NULL = active. Non-zero = baja (used on vendor transfers). */
function isAnoBaja(value) {
    const n = Number(value);
    return Number.isFinite(n) && n !== 0;
}

function ensureCacheEntry(cache, accessOrder, vendor, client, extras = {}) {
    if (!cache[vendor]) cache[vendor] = {};
    if (!cache[vendor][client]) {
        cache[vendor][client] = {
            visitDays: new Set(),
            deliveryDays: new Set(),
            isBaja: false,
            ...extras,
        };
        accessOrder.push(`${vendor}::${client}`);
    } else if (extras.naturalOrder && !cache[vendor][client].naturalOrder) {
        cache[vendor][client].naturalOrder = extras.naturalOrder;
    }
    if (extras.isBaja) cache[vendor][client].isBaja = true;
    return cache[vendor][client];
}

function normalizeCodeList(value) {
    if (value === undefined || value === null) return [];
    const values = Array.isArray(value) ? value : [value];
    return values
        .flatMap(v => String(v ?? '').split(','))
        .map(v => v.trim())
        .filter(v => v && !['undefined', 'null', 'N/A', 'ALL'].includes(v.toUpperCase()) && v.length <= 10);
}

function expandVendorCacheCodes(value) {
    return [...new Set(normalizeCodeList(value).flatMap(code => {
        const raw = String(code || '').trim();
        const unpadded = raw.replace(/^0+/, '') || raw;
        const padded = /^\d{1,2}$/.test(unpadded) ? unpadded.padStart(2, '0') : raw;
        return [raw, unpadded, padded].filter(Boolean);
    }))];
}

// Evict oldest entries when cache exceeds limit
function evictLaclaeCache(maxEntries) {
    while (laclaeCacheAccessOrder.length > maxEntries) {
        const oldest = laclaeCacheAccessOrder.shift();
        if (oldest) {
            const [vendor, client] = oldest.split('::');
            if (vendor && client && laclaeCache[vendor]) {
                delete laclaeCache[vendor][client];
                if (Object.keys(laclaeCache[vendor]).length === 0) {
                    delete laclaeCache[vendor];
                }
            }
        }
    }
}

function evictRuteroConfigCache(maxEntries) {
    while (ruteroConfigAccessOrder.length > maxEntries) {
        const oldest = ruteroConfigAccessOrder.shift();
        if (oldest) {
            const [vendor, client] = oldest.split('::');
            if (vendor && client && ruteroConfigCache[vendor]) {
                delete ruteroConfigCache[vendor][client];
                if (Object.keys(ruteroConfigCache[vendor]).length === 0) {
                    delete ruteroConfigCache[vendor];
                }
            }
        }
    }
}

// Track access for LRU
function trackLaclaeAccess(vendor, client) {
    const key = `${vendor}::${client}`;
    const idx = laclaeCacheAccessOrder.indexOf(key);
    if (idx !== -1) laclaeCacheAccessOrder.splice(idx, 1);
    laclaeCacheAccessOrder.push(key);
    evictLaclaeCache(MAX_CACHE_ENTRIES);
}

function trackRuteroConfigAccess(vendor, client) {
    const key = `${vendor}::${client}`;
    const idx = ruteroConfigAccessOrder.indexOf(key);
    if (idx !== -1) ruteroConfigAccessOrder.splice(idx, 1);
    ruteroConfigAccessOrder.push(key);
    evictRuteroConfigCache(MAX_CONFIG_ENTRIES);
}

// P2: Prevent reload - once attempted, stay in same state
function isCacheReady() {
    return laclaeCacheReady;
}

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
    if (laclaeCacheLoadPromise) {
        return laclaeCacheLoadPromise;
    }

    laclaeCacheLoadPromise = loadLaclaeCacheInternal();
    try {
        return await laclaeCacheLoadPromise;
    } finally {
        laclaeCacheLoadPromise = null;
    }
}

async function loadLaclaeCacheInternal() {
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
            const nextLaclaeCache = {};
            const nextLaclaeCacheAccessOrder = [];

            // 1. Load Master Route Config from DSEDAC.CDVI (Cuadro de Visitas)
            // This ensures NEW clients without sales are included
            logger.info('   Loading Master Route Config from DSEDAC.CDVI...');
            // Include clients with ANOBAJA (vendor transfers mark the previous ficha as baja).
            // Sales scope needs them; visit helpers skip isBaja so they do not appear on the day route.
            const cdviRows = await conn.query(`
                SELECT 
                    TRIM(C.CODIGOVENDEDOR) as VENDEDOR,
                    TRIM(C.CODIGOCLIENTE) as CLIENTE,
                    K.ANOBAJA as ANOBAJA,
                    C.DIAVISITALUNESSN as VIS_L, 
                    C.DIAVISITAMARTESSN as VIS_M, 
                    C.DIAVISITAMIERCOLESSN as VIS_X,
                    C.DIAVISITAJUEVESSN as VIS_J, 
                    C.DIAVISITAVIERNESSN as VIS_V, 
                    C.DIAVISITASABADOSN as VIS_S, 
                    C.DIAVISITADOMINGOSN as VIS_D,
                    C.ORDENVISITALUNES as OR_L,
                    C.ORDENVISITAMARTES as OR_M,
                    C.ORDENVISITAMIERCOLES as OR_X,
                    C.ORDENVISITAJUEVES as OR_J,
                    C.ORDENVISITAVIERNES as OR_V,
                    C.ORDENVISITASABADO as OR_S,
                    C.ORDENVISITADOMINGO as OR_D
                FROM DSEDAC.CDVI C
                JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
                WHERE (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
                  AND (  -- EXCLUDE zombie entries with NO visit days assigned
                    TRIM(C.DIAVISITALUNESSN) = 'S' OR TRIM(C.DIAVISITAMARTESSN) = 'S' OR
                    TRIM(C.DIAVISITAMIERCOLESSN) = 'S' OR TRIM(C.DIAVISITAJUEVESSN) = 'S' OR
                    TRIM(C.DIAVISITAVIERNESSN) = 'S' OR TRIM(C.DIAVISITASABADOSN) = 'S' OR
                    TRIM(C.DIAVISITADOMINGOSN) = 'S'
                  )
            `);

            const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
            // CDVI mapping: Sunday is usually handled, checking sample data

            cdviRows.forEach(row => {
                if (!row.VENDEDOR || !row.CLIENTE) return;

                const entry = ensureCacheEntry(
                    nextLaclaeCache,
                    nextLaclaeCacheAccessOrder,
                    row.VENDEDOR,
                    row.CLIENTE,
                    {
                        isBaja: isAnoBaja(row.ANOBAJA),
                        naturalOrder: {
                            lunes: Number(row.OR_L) || 0,
                            martes: Number(row.OR_M) || 0,
                            miercoles: Number(row.OR_X) || 0,
                            jueves: Number(row.OR_J) || 0,
                            viernes: Number(row.OR_V) || 0,
                            sabado: Number(row.OR_S) || 0,
                            domingo: Number(row.OR_D) || 0
                        }
                    }
                );

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
          L.R1_T8CDVD as VENDEDOR,
          L.LCCDCL as CLIENTE,
          C.ANOBAJA as ANOBAJA,
          L.R1_T8DIVL as VIS_L, L.R1_T8DIVM as VIS_M, L.R1_T8DIVX as VIS_X,
          L.R1_T8DIVJ as VIS_J, L.R1_T8DIVV as VIS_V, L.R1_T8DIVS as VIS_S, L.R1_T8DIVD as VIS_D,
          L.R1_T8DIRL as DEL_L, L.R1_T8DIRM as DEL_M, L.R1_T8DIRX as DEL_X,
          L.R1_T8DIRJ as DEL_J, L.R1_T8DIRV as DEL_V, L.R1_T8DIRS as DEL_S, L.R1_T8DIRD as DEL_D
        FROM DSED.LACLAE L
        JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
        WHERE L.R1_T8CDVD IS NOT NULL 
          AND L.LCCDCL IS NOT NULL
          AND L.LCAADC >= ?
      `, [startYear]);

            const visitCols = ['VIS_D', 'VIS_L', 'VIS_M', 'VIS_X', 'VIS_J', 'VIS_V', 'VIS_S'];
            const deliveryCols = ['DEL_D', 'DEL_L', 'DEL_M', 'DEL_X', 'DEL_J', 'DEL_V', 'DEL_S'];

            rows.forEach(row => {
                const vendedor = row.VENDEDOR?.trim() || '';
                const cliente = row.CLIENTE?.trim() || '';
                if (!vendedor || !cliente) return;

                const entry = ensureCacheEntry(
                    nextLaclaeCache,
                    nextLaclaeCacheAccessOrder,
                    vendedor,
                    cliente,
                    { isBaja: isAnoBaja(row.ANOBAJA) }
                );

                for (let i = 0; i < 7; i++) {
                    if (row[visitCols[i]] === 'S') entry.visitDays.add(dayNames[i]);
                    if (row[deliveryCols[i]] === 'S') entry.deliveryDays.add(dayNames[i]);
                }
            });

            // Convert Sets to Arrays for compatibility
            Object.values(nextLaclaeCache).forEach(vendorClients => {
                Object.values(vendorClients).forEach(clientData => {
                    clientData.visitDays = Array.from(clientData.visitDays);
                    clientData.deliveryDays = Array.from(clientData.deliveryDays);
                });
            });

            // Load Overrides
            await loadRuteroConfigCache(conn);

            const vendorCount = Object.keys(nextLaclaeCache).length;
            const totalClients = Object.values(nextLaclaeCache).reduce((sum, v) => sum + Object.keys(v).length, 0);
            const duration = Date.now() - start;

            logger.info(`📅 LACLAE/CDVI cache loaded: ${vendorCount} vendors, ${totalClients} clients in ${duration}ms`);
            laclaeCache = nextLaclaeCache;
            laclaeCacheAccessOrder = nextLaclaeCacheAccessOrder;
            evictLaclaeCache(MAX_CACHE_ENTRIES);
            laclaeCacheReady = true;
            laclaeCacheLoadAttempted = true;
            laclaeCacheLastLoadTime = Date.now();

        } finally {
            await conn.close();
        }
    } catch (error) {
        logger.warn(`⚠️ LACLAE cache failed to load: ${error.message} - using hash fallback`);
        if (Object.keys(laclaeCache).length === 0) {
            laclaeCacheReady = false;
        }
        laclaeCacheLoadAttempted = true; // P2: Mark as attempted, never retry
    }
}

// P2: Get clients for a day - NEVER reloads, uses fallback if not ready
function getClientsForDay(vendedorCodes, day, role = 'comercial', ignoreOverrides = false) {
    // P2: If cache not ready and we've attempted load, use fallback (don't retry)
    if (!laclaeCacheReady && laclaeCacheLoadAttempted) {
        logger.warn('[LACLAE] Cache not ready, using fallback (no reload)');
        return null;
    }
    
    if (!laclaeCacheReady) {
        // First request before cache loaded - trigger async load but return null
        logger.warn('[LACLAE] Cache not yet loaded, triggering background load');
        loadLaclaeCache().catch(() => {});
        return null;
    }

    const dayLower = day.toLowerCase();
    const isDelivery = role === 'repartidor';
    let finalClients = new Set();

    const requestedVendors = normalizeCodeList(vendedorCodes);
    const vendedors = requestedVendors.length > 0 ? requestedVendors : Object.keys(laclaeCache);

    vendedors.forEach(vendedor => {
        const vendorClients = laclaeCache[vendedor] || {};
        const configClients = ruteroConfigCache[vendedor] || {};

        Object.entries(vendorClients).forEach(([clientCode, data]) => {
            // Baja fichas stay in sales scope but must not appear on the day route
            if (data.isBaja) return;

            const days = toDayArray(isDelivery ? data.deliveryDays : data.visitDays);

            let shouldInclude = false;

            if (!ignoreOverrides) {
                const clientOverrides = configClients[clientCode] || {};
                const overrideForDay = clientOverrides[dayLower];

                if (overrideForDay) {
                    // Entry exists for this day - check if it's a block (order < 0) or positive
                    shouldInclude = overrideForDay.order >= 0;
                } else {
                    // No override for this specific day - use natural days
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

        logger.debug(`📊 getClientsForDay('${vendedor}', '${day}'): Found ${finalClients.size} so far`);

        // Add clients that exist ONLY in RuteroConfig (orphan overrides)
        if (!ignoreOverrides) {
            Object.entries(configClients).forEach(([clientCode, cfg]) => {
                const overrideForDay = cfg[dayLower];
                // Only add POSITIVE overrides (order >= 0)
                if (overrideForDay && overrideForDay.order >= 0) {
                    finalClients.add(clientCode);
                }
            });
        }
    });

    return Array.from(finalClients);
}

// Get week counts from cache - FIXED: Respects blocking entries (ORDEN = -1) and ignoreOverrides flag
function getWeekCountsFromCache(vendedorCodes, role = 'comercial', ignoreOverrides = false) {
    if (!laclaeCacheReady) return null; // Use fallback

    const isDelivery = role === 'repartidor';
    const counts = { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 };
    const clientsSet = { lunes: new Set(), martes: new Set(), miercoles: new Set(), jueves: new Set(), viernes: new Set(), sabado: new Set(), domingo: new Set() };

    const requestedVendors = normalizeCodeList(vendedorCodes);
    const vendedors = requestedVendors.length > 0 ? requestedVendors : Object.keys(laclaeCache);

    vendedors.forEach(vendedor => {
        const vendorClients = laclaeCache[vendedor] || {};
        const configClients = ruteroConfigCache[vendedor] || {};

        Object.entries(vendorClients).forEach(([clientCode, data]) => {
            if (data.isBaja) return;

            const days = toDayArray(isDelivery ? data.deliveryDays : data.visitDays);

            if (!ignoreOverrides) {
                const clientOverrides = configClients[clientCode] || {};

                // 1. Add POSITIVE overrides (order >= 0)
                Object.entries(clientOverrides).forEach(([day, cfg]) => {
                    if (cfg.order >= 0 && counts.hasOwnProperty(day)) {
                        clientsSet[day].add(clientCode);
                    }
                });

                // 2. Add Natural Days (if no override exists for that day)
                days.forEach(day => {
                    if (counts.hasOwnProperty(day) && !clientOverrides[day]) {
                        clientsSet[day].add(clientCode);
                    }
                });
            } else {
                // Ignore overrides - purely natural counts from AS400
                days.forEach(day => {
                    if (counts.hasOwnProperty(day)) {
                        clientsSet[day].add(clientCode);
                    }
                });
            }
        });

        // Also add orphan overrides (clients only in RuteroConfig, not in LACLAE)
        if (!ignoreOverrides) {
            Object.entries(configClients).forEach(([clientCode, overrides]) => {
                Object.entries(overrides).forEach(([day, cfg]) => {
                    if (cfg.order >= 0 && counts.hasOwnProperty(day)) {
                        clientsSet[day].add(clientCode);
                    }
                });
            });
        }
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

    const requestedVendors = normalizeCodeList(vendedorCodes);
    const vendedors = requestedVendors.length > 0 ? requestedVendors : Object.keys(laclaeCache);

    vendedors.forEach(vendedor => {
        const vendorClients = laclaeCache[vendedor] || {};
        Object.entries(vendorClients).forEach(([clientCode, data]) => {
            if (data.isBaja) return;
            const days = toDayArray(isDelivery ? data.deliveryDays : data.visitDays);
            if (days.length > 0) {
                allClients.add(clientCode);
            }
        });
    });

    return allClients.size;
}

// Get client codes from cache (for sales/commission/objective client-scope).
// Includes clients with ANOBAJA (vendor transfers). Visit helpers filter those out.
// Delivery-only entries (from LACLAE history) are excluded — those clients
// belong to another vendor for sales purposes and only appear in repartidor views.
function getClientCodesFromCache(vendedorCodes) {
    if (!laclaeCacheReady) return null;

    const allClients = new Set();

    // Handle 'ALL' or empty string - use all vendors
    if (!vendedorCodes || vendedorCodes === 'ALL' || vendedorCodes.trim() === '') {
        Object.keys(laclaeCache).forEach(vendedor => {
            const vendorClients = laclaeCache[vendedor] || {};
            Object.entries(vendorClients).forEach(([clientCode, data]) => {
                if (toDayArray(data.visitDays).length > 0) {
                    allClients.add(clientCode);
                }
            });
        });
        return Array.from(allClients);
    }

    const vendedors = expandVendorCacheCodes(vendedorCodes);

    vendedors.forEach(vendedor => {
        const vendorClients = laclaeCache[vendedor] || {};
        Object.entries(vendorClients).forEach(([clientCode, data]) => {
            if (toDayArray(data.visitDays).length > 0) {
                allClients.add(clientCode);
            }
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

// P7: Get aggregated active VISIT days for vendor(s) - handles single or comma-separated
function getVendorActiveDaysFromCache(vendedorCode) {
    if (!laclaeCacheReady || !vendedorCode) {
        logger.debug(`getVendorActiveDaysFromCache: cache not ready or no vendedorCode`);
        return [];
    }

    // P7: Split comma-separated codes and process each
    const codes = expandVendorCacheCodes(vendedorCode);
    const daysSet = new Set();
    let totalClients = 0;

    codes.forEach(code => {
        const vendorClients = laclaeCache[code];
        if (vendorClients) {
            totalClients += Object.keys(vendorClients).length;
            Object.values(vendorClients).forEach(clientData => {
                toDayArray(clientData.visitDays).forEach(d => daysSet.add(d));
            });
        }
    });

    if (daysSet.size === 0 && codes.length > 0) {
        logger.debug(`Vendors [${codes.join(',')}] not in LACLAE cache. Available: ${Object.keys(laclaeCache).slice(0, 10).join(', ')}...`);
        return [];
    }

    const result = Array.from(daysSet);
    logger.debug(`Vendors [${codes.join(',')}] visit days: ${result.join(', ')} (${totalClients} clients)`);
    return result; // Returns ['lunes', 'martes'...]
}

// Get aggregated active DELIVERY days for a vendor (for repartidores in rutero)
// P7: Get delivery days for vendor(s) - handles single or comma-separated
function getVendorDeliveryDaysFromCache(vendedorCode) {
    if (!laclaeCacheReady || !vendedorCode) return [];

    // P7: Split comma-separated codes and process each
    const codes = expandVendorCacheCodes(vendedorCode);
    const daysSet = new Set();

    codes.forEach(code => {
        const vendorClients = laclaeCache[code] || {};
        Object.values(vendorClients).forEach(clientData => {
            toDayArray(clientData.deliveryDays).forEach(d => daysSet.add(d));
        });
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
        // Return the first POSITIVE override day (skip blocking entries with order < 0)
        const positiveDays = Object.entries(clientOverrides)
            .filter(([, cfg]) => cfg.order >= 0)
            .map(([day]) => day);
        if (positiveDays.length > 0) return positiveDays[0];
    }

    // 2. Buscar días naturales en LACLAE
    const vendorClients = laclaeCache[vendedorStr] || {};
    const clientData = vendorClients[clientStr];
    const visitDays = clientData ? toDayArray(clientData.visitDays) : [];
    if (visitDays.length > 0) {
        // Devolver el primer día de visita natural
        return visitDays[0];
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
            const visitDays = toDayArray(data.visitDays);
            const deliveryDays = toDayArray(data.deliveryDays);
            return {
                visitDays,
                deliveryDays,
                visitDaysShort: visitDays.map(d => dayLabels[d] || d).join(''),
                deliveryDaysShort: deliveryDays.map(d => dayLabels[d] || d).join('')
            };
        }
    }

    // Search all vendors — prefer entries with actual visit days over empty ones
    let fallbackResult = null;
    for (const [vCode, vendorData] of Object.entries(laclaeCache)) {
        if (vendorData[trimmedClient]) {
            const data = vendorData[trimmedClient];
            const visitDays = toDayArray(data.visitDays);
            const deliveryDays = toDayArray(data.deliveryDays);
            const result = {
                visitDays,
                deliveryDays,
                visitDaysShort: visitDays.map(d => dayLabels[d] || d).join(''),
                deliveryDaysShort: deliveryDays.map(d => dayLabels[d] || d).join(''),
                foundVendor: vCode
            };
            // Return immediately if this vendor has actual visit days
            if (visitDays.length > 0) {
                return result;
            }
            // Otherwise keep as fallback (e.g. delivery-only entries from LACLAE)
            if (!fallbackResult) fallbackResult = result;
        }
    }
    if (fallbackResult) return fallbackResult;

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

// Clear all caches (for graceful shutdown)
function clearLaclaeCache() {
    laclaeCache = {};
    laclaeCacheReady = false;
    laclaeCacheLoadAttempted = false;
    laclaeCacheLastLoadTime = null;
    laclaeCacheAccessOrder = [];
    ruteroConfigCache = {};
    ruteroConfigAccessOrder = [];
    logger.info('📴 LACLAE cache fully cleared');
}

/** Test-only: inject laclae cache shape without hitting DB2. */
function __setLaclaeCacheForTests(cache, { ready = true } = {}) {
    laclaeCache = cache || {};
    laclaeCacheAccessOrder = [];
    Object.entries(laclaeCache).forEach(([vendor, clients]) => {
        Object.keys(clients || {}).forEach((client) => {
            laclaeCacheAccessOrder.push(`${vendor}::${client}`);
        });
    });
    laclaeCacheReady = !!ready;
    laclaeCacheLoadAttempted = true;
    laclaeCacheLastLoadTime = Date.now();
}

module.exports = {
    loadLaclaeCache,
    isCacheReady,
    isCacheLoadAttempted: () => laclaeCacheLoadAttempted,
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
    getClientDays,
    getNaturalOrder,
    ruteroConfigCache,
    laclaeCacheLastLoadTime: () => laclaeCacheLastLoadTime,
    clearLaclaeCache,
    __setLaclaeCacheForTests,
    isAnoBaja,
};
