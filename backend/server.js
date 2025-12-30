/**
 * GMP SALES APP - PROFESSIONAL BACKEND SERVER
 * Real data from IBM DB2 - Complete with logging, rate limiting, and enhanced endpoints
 * Date range: 2023-01-01 to current date
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const odbc = require('odbc');
const winston = require('winston');
const rateLimit = require('express-rate-limit');

// =============================================================================
// WINSTON LOGGER CONFIGURATION
// =============================================================================
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) =>
      `${timestamp} [${level.toUpperCase().padEnd(5)}] ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'server.log', maxsize: 5242880, maxFiles: 5 })
  ]
});

const app = express();
const PORT = process.env.PORT || 3333;

// =============================================================================
// DATE CONSTANTS (Dynamic: Current year - 2 years for 3-year window)
// Example: In 2025 → shows 2023-2025, In 2026 → shows 2024-2026
// =============================================================================
const getCurrentDate = () => new Date();
const getCurrentYear = () => getCurrentDate().getFullYear();
const MIN_YEAR = getCurrentYear() - 2; // Dynamic: always 3 years of data

// =============================================================================
// SALES FILTER CONSTANTS (Applied to all LAC queries for correct sales totals)
// LPCVT: Remove SC (Sin Contado), keep CC (Contado) and VC (Venta Crédito)
// LCSRAB: Remove series K, N, O, G from SERIEALBARAN
// =============================================================================
const LAC_SALES_FILTER = `TIPOVENTA IN ('CC', 'VC') AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')`;
const LAC_TIPOVENTA_FILTER = `TIPOVENTA IN ('CC', 'VC')`;
const LAC_SERIEALBARAN_FILTER = `SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')`;

// =============================================================================
// MIDDLEWARE
// =============================================================================
app.use(cors());
app.use(helmet());
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  level: 6, // Balanced compression level
  threshold: 1024 // Only compress responses > 1KB
}));
app.use(express.json({ limit: '10kb' })); // Limit body size for security

// General rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: { error: 'Demasiadas solicitudes, intente de nuevo más tarde' }
});
app.use('/api/', limiter);

// STRICT rate limiter for login endpoint - prevent brute force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 login attempts per 15 minutes per IP
  message: { error: 'Demasiados intentos de login. Espera 15 minutos antes de intentar de nuevo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Track failed login attempts per username (in-memory - consider Redis for production)
const failedLoginAttempts = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_TIME = 30 * 60 * 1000; // 30 minutes lockout

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    logger[logLevel](`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// =============================================================================
// DATABASE CONNECTION (Credentials from environment variables for security)
// =============================================================================
const dotenv = require('dotenv');
dotenv.config();

// Build connection string from environment variables (fallback to defaults for development)
const DB_UID = process.env.ODBC_UID || 'JAVIER';
const DB_PWD = process.env.ODBC_PWD || 'JAVIER';
const DB_DSN = process.env.ODBC_DSN || 'GMP';
const DB_CONFIG = `DSN=${DB_DSN};UID=${DB_UID};PWD=${DB_PWD};NAM=1;`;
let dbPool = null;

// LACLAE Cache for fast visit/delivery day lookups
// Structure: { vendedor: { clientCode: { visitDays: [], deliveryDays: [] } } }
let laclaeCache = {};
let laclaeCacheReady = false;

async function initDb() {
  try {
    dbPool = await odbc.pool(DB_CONFIG);
    logger.info('✅ Database connection pool initialized');
  } catch (error) {
    logger.error(`❌ Database connection failed: ${error.message}`);
    process.exit(1);
  }
}

// Load LACLAE visit/delivery data into memory cache
async function loadLaclaeCache() {
  logger.info('📅 Loading LACLAE cache (visit/delivery days)...');
  const start = Date.now();

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

async function query(sql, logQuery = true) {
  const start = Date.now();
  const conn = await dbPool.connect();
  try {
    const result = await conn.query(sql);
    const duration = Date.now() - start;
    if (logQuery) {
      const preview = sql.replace(/\s+/g, ' ').substring(0, 100);
      logger.info(`📊 Query (${duration}ms): ${preview}... → ${result.length} rows`);
    }
    return result;
  } catch (error) {
    logger.error(`❌ Query Error: ${error.message}`);
    throw error;
  } finally {
    await conn.close();
  }
}

/**
 * Execute a parameterized query to prevent SQL injection
 * Uses ODBC prepared statements with ? placeholders
 * @param {string} sql - SQL query with ? placeholders
 * @param {Array} params - Array of parameter values in order
 * @param {boolean} logQuery - Whether to log the query (false for sensitive queries)
 * @returns {Promise<Array>} Query results
 */
async function queryWithParams(sql, params = [], logQuery = true) {
  const start = Date.now();
  const conn = await dbPool.connect();
  try {
    // Use prepared statement for parameterized query
    const stmt = await conn.createStatement();
    await stmt.prepare(sql);
    const result = await stmt.execute(params);
    await stmt.close();

    const duration = Date.now() - start;
    if (logQuery) {
      const preview = sql.replace(/\s+/g, ' ').substring(0, 80);
      logger.info(`📊 Parameterized Query (${duration}ms): ${preview}... → ${result.length} rows`);
    }
    return result;
  } catch (error) {
    logger.error(`❌ Parameterized Query Error: ${error.message}`);
    throw error;
  } finally {
    await conn.close();
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
function buildVendedorFilter(vendedorCodes, tableAlias = '') {
  if (!vendedorCodes || vendedorCodes === 'ALL') return '';
  const prefix = tableAlias ? `${tableAlias}.` : '';

  // Always use string format with TRIM since CODIGOVENDEDOR is CHAR type
  const codes = vendedorCodes.split(',').map(c => `'${c.trim()}'`).join(',');
  return `AND TRIM(${prefix}CODIGOVENDEDOR) IN (${codes})`;
}

function buildDateFilter(yearParam, monthParam, tableAlias = '') {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const now = getCurrentDate();
  const year = parseInt(yearParam) || now.getFullYear();
  const month = parseInt(monthParam) || (now.getMonth() + 1);
  return { year, month, filter: `AND ${prefix}ANODOCUMENTO >= ${MIN_YEAR}` };
}

function formatCurrency(value) {
  // Returns raw number - formatting done in Flutter frontend with Spanish locale
  return parseFloat(value) || 0;
}

// =============================================================================
// LOGIN ENDPOINT (with security protections)
// =============================================================================
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const requestId = Date.now().toString(36);

  try {
    const { username, password } = req.body;

    // Input validation
    if (!username || !password) {
      logger.warn(`[${requestId}] Login attempt with missing credentials`);
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    // Sanitize and normalize inputs
    const safeUser = username.replace(/[^a-zA-Z0-9]/g, '').trim().toUpperCase();

    if (safeUser.length < 2 || safeUser.length > 50) {
      logger.warn(`[${requestId}] Login attempt with invalid username length: ${safeUser.length}`);
      return res.status(400).json({ error: 'Usuario inválido' });
    }

    // Check if account is locked out due to failed attempts
    const lockoutInfo = failedLoginAttempts.get(safeUser);
    if (lockoutInfo && lockoutInfo.count >= MAX_FAILED_ATTEMPTS) {
      const timeSinceLockout = Date.now() - lockoutInfo.lastAttempt;
      if (timeSinceLockout < LOCKOUT_TIME) {
        const minutesRemaining = Math.ceil((LOCKOUT_TIME - timeSinceLockout) / 60000);
        logger.warn(`[${requestId}] Locked account access attempt: ${safeUser}`);
        return res.status(429).json({
          error: `Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutesRemaining} minutos.`
        });
      } else {
        // Lockout expired, reset counter
        failedLoginAttempts.delete(safeUser);
      }
    }

    // Use parameterized query to prevent SQL injection
    const trimmedPwd = password.trim();

    // Query database for user using parameterized query
    // Uses ? placeholders to prevent SQL injection
    const users = await queryWithParams(`
      SELECT ID, CODIGOUSUARIO, NOMBREUSUARIO, PASSWORD, SUBEMPRESA, DELEGACION, GRUPO
      FROM DSEDAC.APPUSUARIOS
      WHERE UPPER(TRIM(CODIGOUSUARIO)) = ?
        AND TRIM(PASSWORD) = ?
        AND SUBEMPRESA = 'GMP'
      FETCH FIRST 1 ROWS ONLY
    `, [safeUser, trimmedPwd], false); // Don't log query with password

    if (users.length === 0) {
      // Track failed attempt
      const currentAttempts = failedLoginAttempts.get(safeUser) || { count: 0, lastAttempt: 0 };
      currentAttempts.count += 1;
      currentAttempts.lastAttempt = Date.now();
      failedLoginAttempts.set(safeUser, currentAttempts);

      const remainingAttempts = MAX_FAILED_ATTEMPTS - currentAttempts.count;

      logger.warn(`[${requestId}] ❌ Login failed for user: ${safeUser} (attempt ${currentAttempts.count}/${MAX_FAILED_ATTEMPTS})`);

      if (remainingAttempts <= 0) {
        return res.status(429).json({
          error: 'Cuenta bloqueada por demasiados intentos fallidos. Espera 30 minutos.'
        });
      }

      return res.status(401).json({
        error: `Credenciales inválidas. Te quedan ${remainingAttempts} intentos.`
      });
    }

    // Successful login - clear any failed attempts
    failedLoginAttempts.delete(safeUser);

    const user = users[0];
    const searchPattern = (user.NOMBREUSUARIO || '').trim().toUpperCase().substring(0, 4);

    let vendedorInfo = [];
    if (searchPattern.length >= 2) {
      vendedorInfo = await query(`
        SELECT V.CODIGOVENDEDOR, V.TIPOVENDEDOR, X.JEFEVENTASSN, X.CORREOELECTRONICO
        FROM DSEDAC.VDC V
        LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
        WHERE V.SUBEMPRESA = 'GMP' AND UPPER(X.CORREOELECTRONICO) LIKE '%${searchPattern}%'
        FETCH FIRST 1 ROWS ONLY
      `);
    }

    const allVendedores = await query(`
      SELECT DISTINCT TRIM(CODIGOVENDEDOR) as CODE FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'
    `);
    const vendedorCodes = allVendedores.map(v => v.CODE);

    let vendedorCode = null;
    let isJefeVentas = false;
    let tipoVendedor = null;

    if (vendedorInfo.length > 0) {
      vendedorCode = vendedorInfo[0].CODIGOVENDEDOR?.trim();
      isJefeVentas = vendedorInfo[0].JEFEVENTASSN === 'S';
      tipoVendedor = vendedorInfo[0].TIPOVENDEDOR?.trim();
    } else {
      isJefeVentas = true;
    }

    const response = {
      user: {
        id: user.ID,
        code: user.CODIGOUSUARIO?.trim(),
        name: user.NOMBREUSUARIO?.trim(),
        company: user.SUBEMPRESA?.trim(),
        delegation: user.DELEGACION?.trim() || '',
        vendedorCode: vendedorCode,
        isJefeVentas: isJefeVentas,
        tipoVendedor: tipoVendedor || '-',
        role: isJefeVentas ? 'JEFE_VENTAS' : 'COMERCIAL'
      },
      vendedorCodes: isJefeVentas ? vendedorCodes : (vendedorCode ? [vendedorCode] : vendedorCodes),
      token: Buffer.from(`${user.ID}:${user.CODIGOUSUARIO}:${Date.now()}`).toString('base64')
    };

    logger.info(`✅ Login successful: ${user.CODIGOUSUARIO} (${response.user.role})`);
    res.json(response);

  } catch (error) {
    logger.error(`Login error: ${error.message}`);
    res.status(500).json({ error: 'Error de autenticación', details: error.message });
  }
});

// =============================================================================
// DASHBOARD METRICS
// =============================================================================
// =============================================================================
// KPI CARDS ENDPOINT (Updated to use DSEDAC.LAC for proper history)
// =============================================================================
app.get('/api/dashboard/metrics', async (req, res) => {
  try {
    const { vendedorCodes, year, month } = req.query;
    const now = getCurrentDate();
    const currentYear = parseInt(year) || now.getFullYear();
    const currentMonth = parseInt(month) || (now.getMonth() + 1);

    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    // Query Current Year Data from LAC (Lineas Albarán Clientes)
    // Margin calculated as Sales - Cost
    const currentData = await query(`
      SELECT 
        COALESCE(SUM(IMPORTEVENTA), 0) as sales,
        COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) as margin,
        COALESCE(SUM(CANTIDADENVASES), 0) as boxes,
        COUNT(DISTINCT CODIGOCLIENTEALBARAN) as activeClients
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO = ${currentYear} 
        AND MESDOCUMENTO = ${currentMonth} 
        AND ${LAC_SALES_FILTER}
        ${vendedorFilter}
    `);

    // Query Last Year Data (Same Month)
    const lastData = await query(`
      SELECT 
        COALESCE(SUM(IMPORTEVENTA), 0) as sales,
        COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) as margin,
        COALESCE(SUM(CANTIDADENVASES), 0) as boxes
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO = ${currentYear - 1} 
        AND MESDOCUMENTO = ${currentMonth} 
        AND ${LAC_SALES_FILTER}
        ${vendedorFilter}
    `);

    // Today's metrics (using LAC for consistency)
    const today = now.getDate();
    // Only fetch if requesting current month
    let todaySales = 0;
    let todayOrders = 0;

    if (currentYear === now.getFullYear() && currentMonth === (now.getMonth() + 1)) {
      const todayData = await query(`
            SELECT COALESCE(SUM(IMPORTEVENTA), 0) as sales, COUNT(*) as orders
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ${currentYear} AND MESDOCUMENTO = ${currentMonth} AND DIADOCUMENTO = ${today} AND ${LAC_SALES_FILTER} ${vendedorFilter}
        `);
      todaySales = parseFloat(todayData[0]?.SALES) || 0;
      todayOrders = parseInt(todayData[0]?.ORDERS) || 0;
    }

    const curr = currentData[0] || {};
    const last = lastData[0] || {};

    const currentSales = parseFloat(curr.SALES) || 0;
    const lastSales = parseFloat(last.SALES) || 0;

    // Calculate variations
    const calcVar = (curr, prev) => prev && prev !== 0 ? ((curr - prev) / prev) * 100 : 0;
    const growthPercent = calcVar(currentSales, lastSales);

    res.json({
      period: { year: currentYear, month: currentMonth },
      // Return raw numbers (not formatted strings) to avoid type errors in frontend
      totalSales: currentSales,
      totalBoxes: parseFloat(curr.BOXES) || 0,
      totalOrders: todayOrders || 0, // Use today's orders count for now
      totalMargin: parseFloat(curr.MARGIN) || 0,
      uniqueClients: parseInt(curr.ACTIVECLIENTS) || 0,
      avgOrderValue: todayOrders > 0 ? todaySales / todayOrders : 0,
      todaySales: todaySales,
      todayOrders: todayOrders,
      lastMonthSales: lastSales,
      growthPercent: Math.round(growthPercent * 10) / 10,

      // Detailed object structure for new frontend (if applicable)
      sales: {
        value: currentSales,
        variation: growthPercent,
        trend: currentSales >= lastSales ? 'up' : 'down'
      },
      margin: {
        value: parseFloat(curr.MARGIN) || 0,
        variation: calcVar(parseFloat(curr.MARGIN), parseFloat(last.MARGIN)),
        trend: parseFloat(curr.MARGIN) >= parseFloat(last.MARGIN) ? 'up' : 'down'
      },
      clients: {
        value: parseInt(curr.ACTIVECLIENTS) || 0,
        variation: 0,
        trend: 'neutral'
      },
      boxes: {
        value: parseFloat(curr.BOXES) || 0,
        variation: calcVar(parseFloat(curr.BOXES), parseFloat(last.BOXES)),
        trend: parseFloat(curr.BOXES) >= parseFloat(last.BOXES) ? 'up' : 'down'
      }
    });

  } catch (error) {
    logger.error(`Metrics error: ${error.message}`);
    res.status(500).json({ error: 'Error calculating metrics', details: error.message });
  }
});

// =============================================================================
// MATRIX DATA - Power BI Style Pivoted Data (Using LAC for reliability)
// =============================================================================
app.get('/api/dashboard/matrix-data', async (req, res) => {
  try {
    const { vendedorCodes, groupBy = 'vendor', year } = req.query;

    const selectedYear = parseInt(year) || getCurrentDate().getFullYear();
    const prevYear = selectedYear - 1;

    // Build vendedor filter
    const vendedorFilter = vendedorCodes && vendedorCodes !== 'ALL'
      ? `AND L.CODIGOVENDEDOR IN (${vendedorCodes.split(',').map(c => `'${c.trim()}'`).join(',')})`
      : '';

    let rawData;

    if (groupBy === 'vendor') {
      // Group by commercial - using LAC (reliable, indexed)
      rawData = await query(`
        SELECT 
          L.CODIGOVENDEDOR as CODE,
          L.ANODOCUMENTO as YEAR,
          L.MESDOCUMENTO as MONTH,
          SUM(L.IMPORTEVENTA) as SALES,
          SUM(L.IMPORTEVENTA - L.IMPORTECOSTO) as MARGIN
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
          AND CA.CCYEAB = L.LCYEAB 
          AND CA.CCSRAB = L.LCSRAB 
          AND CA.CCTRAB = L.LCTRAB 
          AND CA.CCNRAB = L.LCNRAB
        WHERE L.ANODOCUMENTO IN (${selectedYear}, ${prevYear})
          AND L.CODIGOVENDEDOR IS NOT NULL
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(CA.CCSNSD, '') <> 'E'
          ${vendedorFilter}
        GROUP BY L.CODIGOVENDEDOR, L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY YEAR DESC, MONTH DESC
      `);

    } else if (groupBy === 'product') {
      // Group by product
      rawData = await query(`
        SELECT 
          L.CODIGOARTICULO as CODE,
          COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCIONARTICULO)) as NAME,
          A.CODIGOFAMILIA as FAMILY,
          L.ANODOCUMENTO as YEAR,
          L.MESDOCUMENTO as MONTH,
          SUM(L.IMPORTEVENTA) as SALES,
          SUM(L.IMPORTEVENTA - L.IMPORTECOSTO) as MARGIN
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
          AND CA.CCYEAB = L.LCYEAB 
          AND CA.CCSRAB = L.LCSRAB 
          AND CA.CCTRAB = L.LCTRAB 
          AND CA.CCNRAB = L.LCNRAB
        WHERE L.ANODOCUMENTO IN (${selectedYear}, ${prevYear})
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(CA.CCSNSD, '') <> 'E'
          ${vendedorFilter}
        GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCIONARTICULO, A.CODIGOFAMILIA, L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY YEAR DESC, MONTH DESC
        FETCH FIRST 500 ROWS ONLY
      `);

    } else if (groupBy === 'client') {
      // Group by client
      rawData = await query(`
        SELECT 
          L.CODIGOCLIENTEALBARAN as CODE,
          COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as NAME,
          L.ANODOCUMENTO as YEAR,
          L.MESDOCUMENTO as MONTH,
          SUM(L.IMPORTEVENTA) as SALES,
          SUM(L.IMPORTEVENTA - L.IMPORTECOSTO) as MARGIN
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
        LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
          AND CA.CCYEAB = L.LCYEAB 
          AND CA.CCSRAB = L.LCSRAB 
          AND CA.CCTRAB = L.LCTRAB 
          AND CA.CCNRAB = L.LCNRAB
        WHERE L.ANODOCUMENTO IN (${selectedYear}, ${prevYear})
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(CA.CCSNSD, '') <> 'E'
          ${vendedorFilter}
        GROUP BY L.CODIGOCLIENTEALBARAN, C.NOMBREALTERNATIVO, C.NOMBRECLIENTE, L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY YEAR DESC, MONTH DESC
        FETCH FIRST 500 ROWS ONLY
      `);

    } else if (groupBy === 'family') {
      // Group by product family
      rawData = await query(`
        SELECT 
          A.CODIGOFAMILIA as CODE,
          F.DESCRIPCIONFAMILIA as NAME,
          L.ANODOCUMENTO as YEAR,
          L.MESDOCUMENTO as MONTH,
          SUM(L.IMPORTEVENTA) as SALES,
          SUM(L.IMPORTEVENTA - L.IMPORTECOSTO) as MARGIN
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        LEFT JOIN DSEDAC.FAM F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA
        LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
          AND CA.CCYEAB = L.LCYEAB 
          AND CA.CCSRAB = L.LCSRAB 
          AND CA.CCTRAB = L.LCTRAB 
          AND CA.CCNRAB = L.LCNRAB
        WHERE L.ANODOCUMENTO IN (${selectedYear}, ${prevYear})
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(CA.CCSNSD, '') <> 'E'
          ${vendedorFilter}
        GROUP BY A.CODIGOFAMILIA, F.DESCRIPCIONFAMILIA, L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY YEAR DESC, MONTH DESC
      `);
    } else {
      return res.status(400).json({ error: 'groupBy debe ser: vendor, product, client, o family' });
    }

    // Pivot the data by month
    const pivoted = {};
    const months = new Set();

    rawData.forEach(row => {
      const id = row.CODE?.trim() || 'unknown';
      const name = row.NAME?.trim() || id;

      if (!pivoted[id]) {
        pivoted[id] = {
          id,
          name: groupBy === 'vendor' ? `Comercial ${id}` : name,
          type: groupBy,
          data: {},
          total: 0,
          margin: 0
        };
      }

      const period = `${row.YEAR}-${String(row.MONTH).padStart(2, '0')}`;
      months.add(period);

      const sales = parseFloat(row.SALES) || 0;
      const margin = parseFloat(row.MARGIN) || 0;

      if (!pivoted[id].data[period]) {
        pivoted[id].data[period] = { sales: 0, margin: 0 };
      }
      pivoted[id].data[period].sales += sales;
      pivoted[id].data[period].margin += margin;
      pivoted[id].total += sales;
      pivoted[id].margin += margin;
    });

    // Sort by total and limit
    const rows = Object.values(pivoted)
      .sort((a, b) => b.total - a.total)
      .slice(0, 50);

    const periodList = Array.from(months).sort();

    res.json({
      rows,
      periods: periodList,
      groupBy,
      year: selectedYear,
      prevYear
    });

  } catch (error) {
    logger.error(`Matrix data error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo datos matriciales', details: error.message });
  }
});

// =============================================================================
// CLIENTS LIST (with proper names, route descriptions, accumulated totals)
// =============================================================================
app.get('/api/clients', async (req, res) => {
  try {
    const { vendedorCodes, search, limit = 100 } = req.query;

    // Build vendedor filter
    const vendedorFilter = vendedorCodes
      ? `AND L.CODIGOVENDEDOR IN (${vendedorCodes.split(',').map(c => `'${c.trim()}'`).join(',')})`
      : '';

    // Build search filter
    let searchFilter = '';
    if (search && search.length > 0) {
      const s = search.replace(/'/g, "''"); // Escape quotes
      searchFilter = `AND (UPPER(C.NOMBRECLIENTE) LIKE UPPER('%${s}%') 
        OR UPPER(C.NOMBREALTERNATIVO) LIKE UPPER('%${s}%')
        OR C.CODIGOCLIENTE LIKE '%${s}%')`;
    }

    // Simpler query - get clients with sales data
    const clientsData = await query(`
      SELECT 
        C.CODIGOCLIENTE as CODE,
        COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as NAME,
        TRIM(C.DIRECCION) as ADDRESS,
        TRIM(C.POBLACION) as CITY,
        TRIM(C.TELEFONO1) as PHONE,
        TRIM(C.CODIGORUTA) as ROUTE_CODE,
        SUM(L.IMPORTEVENTA) as TOTAL_SALES,
        COUNT(*) as NUM_ORDERS,
        MAX(L.ANODOCUMENTO) as LAST_YEAR,
        MAX(L.MESDOCUMENTO) as LAST_MONTH
      FROM DSEDAC.LAC L
      JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      WHERE L.ANODOCUMENTO >= ${MIN_YEAR}
        ${vendedorFilter}
        ${searchFilter}
      GROUP BY C.CODIGOCLIENTE, C.NOMBREALTERNATIVO, C.NOMBRECLIENTE, C.DIRECCION, C.POBLACION, C.TELEFONO1, C.CODIGORUTA
      ORDER BY TOTAL_SALES DESC
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `);

    // Get route descriptions separately (faster)
    const routeCodes = [...new Set(clientsData.map(r => r.ROUTE_CODE?.trim()).filter(Boolean))];
    let routeMap = {};
    if (routeCodes.length > 0) {
      try {
        const routeList = routeCodes.slice(0, 50).map(c => `'${c}'`).join(',');
        const routes = await query(`
          SELECT CODIGORUTA, DESCRIPCIONRUTA 
          FROM DSEDAC.RUT 
          WHERE CODIGORUTA IN (${routeList})
        `);
        routes.forEach(r => {
          routeMap[r.CODIGORUTA?.trim()] = r.DESCRIPCIONRUTA?.trim() || '';
        });
      } catch (e) {
        // Ignore route errors
      }
    }

    const clients = clientsData.map(row => {
      const routeCode = row.ROUTE_CODE?.trim() || '';
      const lastYear = row.LAST_YEAR || '';
      const lastMonth = row.LAST_MONTH || '';

      return {
        code: row.CODE?.trim() || '',
        name: row.NAME?.trim() || 'Sin nombre',
        address: row.ADDRESS?.trim() || '',
        city: row.CITY?.trim() || '',
        phone: row.PHONE?.trim() || '',
        route: routeMap[routeCode] || routeCode,
        routeCode,
        totalPurchases: parseFloat(row.TOTAL_SALES) || 0,
        numOrders: parseInt(row.NUM_ORDERS) || 0,
        lastPurchase: lastYear && lastMonth ? `${lastYear}-${String(lastMonth).padStart(2, '0')}` : ''
      };
    });

    res.json({
      clients,
      count: clients.length,
      dateRange: { from: `${MIN_YEAR}-01-01`, to: 'today' }
    });

  } catch (error) {
    logger.error(`Clients list error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo clientes', details: error.message });
  }
});

// =============================================================================
// SALES EVOLUTION (Using CVC for history)
// =============================================================================
// SALES EVOLUTION (Multi-year comparison, weekly/monthly, YTD support)
// =============================================================================
app.get('/api/dashboard/sales-evolution', async (req, res) => {
  try {
    const { vendedorCodes, years, granularity = 'month', upToToday = 'false', months = 36 } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    // Parse years
    const now = getCurrentDate();
    const selectedYears = years ? years.split(',').map(y => parseInt(y.trim())) : [now.getFullYear()];
    const yearsFilter = `AND ANODOCUMENTO IN (${selectedYears.join(',')})`;

    // YTD filter logic
    let dateFilter = '';
    if (upToToday === 'true') {
      const currentMonth = now.getMonth() + 1;
      const currentDay = now.getDate();
      dateFilter = `AND (ANODOCUMENTO < ${now.getFullYear()} OR (ANODOCUMENTO = ${now.getFullYear()} AND MESDOCUMENTO < ${currentMonth}) OR (ANODOCUMENTO = ${now.getFullYear()} AND MESDOCUMENTO = ${currentMonth} AND DIADOCUMENTO <= ${currentDay}))`;
    }

    let resultData = [];

    if (granularity === 'week') {
      // Weekly: Get DAILY data and aggregate in JS
      const dailyQuery = `
        SELECT ANODOCUMENTO as year, MESDOCUMENTO as month, DIADOCUMENTO as day,
               SUM(IMPORTEVENTA) as sales,
               COUNT(DISTINCT NUMERODOCUMENTO) as orders,
               COUNT(DISTINCT CODIGOCLIENTEALBARAN) as clients
        FROM DSEDAC.LAC
        WHERE ${LAC_SALES_FILTER} ${yearsFilter} ${dateFilter} ${vendedorFilter}
        GROUP BY ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
      `;
      const dailyData = await query(dailyQuery, false);

      const weeklyMap = {};
      dailyData.forEach(row => {
        const date = new Date(row.YEAR, row.MONTH - 1, row.DAY);
        const startOfYear = new Date(row.YEAR, 0, 1);
        const days = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000));
        const week = Math.ceil((days + startOfYear.getDay() + 1) / 7);
        const key = `${row.YEAR}-W${String(week).padStart(2, '0')}`;

        if (!weeklyMap[key]) {
          weeklyMap[key] = { year: row.YEAR, week: week, month: row.MONTH, totalSales: 0, totalOrders: 0, uniqueClients: 0 };
        }
        weeklyMap[key].totalSales += parseFloat(row.SALES) || 0;
        weeklyMap[key].totalOrders += parseInt(row.ORDERS) || 0;
        weeklyMap[key].uniqueClients += parseInt(row.CLIENTS) || 0;
      });

      resultData = Object.values(weeklyMap).sort((a, b) => (b.year * 100 + b.week) - (a.year * 100 + a.week));

    } else {
      // Monthly: Simple Group By Month
      const monthlyQuery = `
        SELECT ANODOCUMENTO as year, MESDOCUMENTO as month,
               SUM(IMPORTEVENTA) as totalSales,
               COUNT(DISTINCT NUMERODOCUMENTO) as totalOrders,
               COUNT(DISTINCT CODIGOCLIENTEALBARAN) as uniqueClients
        FROM DSEDAC.LAC
        WHERE ${LAC_SALES_FILTER} ${yearsFilter} ${dateFilter} ${vendedorFilter}
        GROUP BY ANODOCUMENTO, MESDOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
      `;
      const rows = await query(monthlyQuery);
      resultData = rows.map(r => ({
        year: r.YEAR, month: r.MONTH,
        totalSales: parseFloat(r.TOTALSALES) || 0,
        totalOrders: parseInt(r.TOTALORDERS) || 0,
        uniqueClients: parseInt(r.UNIQUECLIENTS) || 0
      }));
    }

    // Apply row limit in JS to be safe
    const limitedData = resultData.slice(0, parseInt(months) || 36);

    res.json(limitedData);

  } catch (error) {
    logger.error(`Evolution error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo evolución', details: error.message });
  }
});

// =============================================================================
// YOY COMPARISON (Using CVC)
// =============================================================================
app.get('/api/analytics/yoy-comparison', async (req, res) => {
  try {
    const { vendedorCodes, year, month } = req.query;
    const currentYear = parseInt(year) || getCurrentDate().getFullYear();
    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    // Optional month filter
    const monthFilter = month ? `AND MESDOCUMENTO = ${month}` : '';

    const getData = async (yr) => {
      const result = await query(`
          SELECT 
            SUM(IMPORTEVENTA) as sales, 
            SUM(IMPORTEVENTA - IMPORTECOSTO) as margin,
            COUNT(DISTINCT CODIGOCLIENTEALBARAN) as clients
          FROM DSEDAC.LAC 
          WHERE ANODOCUMENTO = ${yr} AND ${LAC_SALES_FILTER} ${monthFilter} ${vendedorFilter}
        `);
      return result[0] || {};
    };

    const curr = await getData(currentYear);
    const lastYr = currentYear - 1;
    const prev = await getData(lastYr);

    const currSales = parseFloat(curr.SALES) || 0;
    const prevSales = parseFloat(prev.SALES) || 0;
    const currMargin = parseFloat(curr.MARGIN) || 0;
    const prevMargin = parseFloat(prev.MARGIN) || 0;

    const calcGrowth = (curr, prev) => prev && prev !== 0 ? ((curr - prev) / prev) * 100 : 0;

    res.json({
      currentYear: {
        year: currentYear,
        sales: formatCurrency(currSales),
        margin: formatCurrency(currMargin),
        boxes: 0
      },
      lastYear: {
        year: lastYr,
        sales: formatCurrency(prevSales),
        margin: formatCurrency(prevMargin),
        boxes: 0
      },
      currentPeriod: { year: currentYear, sales: formatCurrency(currSales) },
      previousPeriod: { year: lastYr, sales: formatCurrency(prevSales) },
      growth: {
        salesPercent: Math.round(calcGrowth(currSales, prevSales) * 10) / 10,
        salesGrowth: Math.round(calcGrowth(currSales, prevSales) * 10) / 10,
        marginPercent: Math.round(calcGrowth(currMargin, prevMargin) * 10) / 10
      }
    });

  } catch (error) {
    logger.error(`YoY error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo comparación', details: error.message });
  }
});

// ... (Recent Sales and Margins kept on LINDTO/Mixed or modified if needed) ...

// =============================================================================
// TOP CLIENTS (Using CVC)
// =============================================================================
app.get('/api/analytics/top-clients', async (req, res) => {
  try {
    const { vendedorCodes, year, month, limit = 10 } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    let dateFilter = '';
    if (year) dateFilter += ` AND ANODOCUMENTO = ${year}`;
    if (month) dateFilter += ` AND MESDOCUMENTO = ${month}`;

    const topClients = await query(`
      SELECT 
        CODIGOCLIENTEALBARAN as code,
        SUM(IMPORTEVENTA) as totalSales,
        COUNT(*) as transactions
      FROM DSEDAC.LAC
      WHERE 1=1 ${dateFilter} ${vendedorFilter}
      GROUP BY CODIGOCLIENTEALBARAN
      ORDER BY totalSales DESC
      FETCH FIRST ${limit} ROWS ONLY
    `);

    // Get client names from CLI table
    const enhancedClients = await Promise.all(topClients.map(async (c) => {
      const info = await query(`SELECT NOMBRECLIENTE, POBLACION FROM DSEDAC.CLI WHERE CODIGOCLIENTE = '${c.CODE}' FETCH FIRST 1 ROWS ONLY`);
      return {
        code: c.CODE?.trim(),
        name: info[0]?.NOMBRECLIENTE?.trim() || `Cliente ${c.CODE}`,
        city: info[0]?.POBLACION?.trim() || '',
        totalSales: formatCurrency(c.TOTALSALES),
        year: year || new Date().getFullYear()
      };
    }));

    res.json({ clients: enhancedClients });

  } catch (error) {
    logger.error(`Top clients error: ${error.message}`);
    res.status(500).json({ error: 'Error top clients', details: error.message });
  }
});

// =============================================================================
// TRENDS (Updated to use DSEDAC.LAC for proper history)
// =============================================================================
app.get('/api/analytics/trends', async (req, res) => {
  try {
    const { vendedorCodes } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    // Get last 6 months from LAC
    const history = await query(`
      SELECT ANODOCUMENTO as year, MESDOCUMENTO as month, SUM(IMPORTEVENTA) as sales
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO >= 2024 ${vendedorFilter}
      GROUP BY ANODOCUMENTO, MESDOCUMENTO
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
      FETCH FIRST 6 ROWS ONLY
    `);

    // Simple prediction logic
    let trend = 'stable';
    const sales = history.map(h => parseFloat(h.SALES)).reverse(); // Chronological order
    if (sales.length >= 2) {
      if (sales[sales.length - 1] > sales[0] * 1.1) trend = 'upward';
      else if (sales[sales.length - 1] < sales[0] * 0.9) trend = 'downward';
    }

    // Generate basic predictions
    const lastMonth = sales.length > 0 ? sales[sales.length - 1] : 0;
    const predictions = [
      { period: 'Next +1', predictedSales: lastMonth * (trend === 'upward' ? 1.05 : 0.95), confidence: 0.75 },
      { period: 'Next +2', predictedSales: lastMonth * (trend === 'upward' ? 1.10 : 0.90), confidence: 0.60 },
      { period: 'Next +3', predictedSales: lastMonth * (trend === 'upward' ? 1.15 : 0.85), confidence: 0.45 }
    ];

    res.json({ trend, predictions });

  } catch (error) {
    logger.error(`Trends error: ${error.message}`);
    res.status(500).json({ error: 'Error calculating trends', details: error.message });
  }
});

// =============================================================================
// RECENT SALES
// =============================================================================
app.get('/api/dashboard/recent-sales', async (req, res) => {
  try {
    const { vendedorCodes, limit = 20 } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

    const sales = await query(`
      SELECT 
        L.ANODOCUMENTO as year, L.MESDOCUMENTO as month, L.DIADOCUMENTO as day,
        L.CODIGOCLIENTEALBARAN as clientCode,
        C.NOMBRECLIENTE as clientName, L.CODIGOVENDEDOR as vendedorCode,
        L.SERIEDOCUMENTO as docType,
        SUM(L.IMPORTEVENTA) as totalEuros,
        SUM(L.CANTIDADENVASES) as totalBoxes,
        SUM(L.IMPORTEMARGENREAL) as totalMargin,
        COUNT(*) as numLines
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      WHERE L.ANODOCUMENTO >= ${MIN_YEAR} ${vendedorFilter}
      GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO, L.DIADOCUMENTO,
        L.CODIGOCLIENTEALBARAN, C.NOMBRECLIENTE, L.CODIGOVENDEDOR, L.SERIEDOCUMENTO
      ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
        `);

    res.json({
      sales: sales.map(s => ({
        date: `${s.YEAR} - ${String(s.MONTH).padStart(2, '0')
          } -${String(s.DAY).padStart(2, '0')} `,
        clientCode: s.CLIENTCODE?.trim(),
        clientName: s.CLIENTNAME?.trim() || 'Sin nombre',
        vendedorCode: s.VENDEDORCODE?.trim(),
        type: s.DOCTYPE?.trim() || 'VT',
        totalEuros: formatCurrency(s.TOTALEUROS),
        totalMargin: formatCurrency(s.TOTALMARGIN),
        totalBoxes: parseInt(s.TOTALBOXES) || 0,
        numLines: parseInt(s.NUMLINES) || 0
      }))
    });

  } catch (error) {
    logger.error(`Recent sales error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo ventas', details: error.message });
  }
});

// =============================================================================
// CLIENTS LIST
// =============================================================================
app.get('/api/clients', async (req, res) => {
  try {
    const { vendedorCodes, search, limit = 100, offset = 0 } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    let searchFilter = '';
    if (search) {
      const safeSearch = search.replace(/'/g, "''").trim().toUpperCase();
      searchFilter = `AND(UPPER(C.NOMBRECLIENTE) LIKE '%${safeSearch}%' 
                      OR C.CODIGOCLIENTE LIKE '%${safeSearch}%'
                      OR UPPER(C.POBLACION) LIKE '%${safeSearch}%'
                      OR C.NIF LIKE '%${safeSearch}%')`;
    }

    const clients = await query(`
      SELECT DISTINCT
    C.CODIGOCLIENTE as code, C.NOMBRECLIENTE as name, C.NIF as nif,
      C.DIRECCION as address, C.POBLACION as city, C.PROVINCIA as province,
      C.CODIGOPOSTAL as postalCode, C.TELEFONO1 as phone, C.TELEFONO2 as phone2,
      C.CODIGORUTA as route, C.PERSONACONTACTO as contactPerson,
      COALESCE(S.TOTAL_PURCHASES, 0) as totalPurchases,
      COALESCE(S.NUM_ORDERS, 0) as numOrders,
      COALESCE(S.LAST_PURCHASE_YEAR, 0) as lastYear,
      COALESCE(S.LAST_PURCHASE_MONTH, 0) as lastMonth,
      COALESCE(S.TOTAL_MARGIN, 0) as totalMargin
      FROM DSEDAC.CLI C
      LEFT JOIN(
        SELECT CODIGOCLIENTEALBARAN,
        SUM(IMPORTEVENTA) as TOTAL_PURCHASES,
        SUM(IMPORTEMARGENREAL) as TOTAL_MARGIN,
        COUNT(DISTINCT ANODOCUMENTO || '-' || MESDOCUMENTO || '-' || DIADOCUMENTO) as NUM_ORDERS,
        MAX(ANODOCUMENTO) as LAST_PURCHASE_YEAR,
        MAX(CASE WHEN ANODOCUMENTO = (SELECT MAX(ANODOCUMENTO) FROM DSEDAC.LINDTO L2 
                        WHERE L2.CODIGOCLIENTEALBARAN = DSEDAC.LINDTO.CODIGOCLIENTEALBARAN) 
                   THEN MESDOCUMENTO ELSE 0 END) as LAST_PURCHASE_MONTH
        FROM DSEDAC.LINDTO 
        WHERE ANODOCUMENTO >= ${MIN_YEAR} ${vendedorFilter}
        GROUP BY CODIGOCLIENTEALBARAN
      ) S ON C.CODIGOCLIENTE = S.CODIGOCLIENTEALBARAN
      WHERE C.ANOBAJA = 0 ${searchFilter}
      ORDER BY COALESCE(S.TOTAL_PURCHASES, 0) DESC
      OFFSET ${parseInt(offset)} ROWS
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `);

    res.json({
      clients: clients.map(c => ({
        code: c.CODE?.trim(),
        name: c.NAME?.trim() || 'Sin nombre',
        nif: c.NIF?.trim(),
        address: c.ADDRESS?.trim(),
        city: c.CITY?.trim(),
        province: c.PROVINCE?.trim(),
        postalCode: c.POSTALCODE?.trim(),
        phone: c.PHONE?.trim(),
        phone2: c.PHONE2?.trim(),
        route: c.ROUTE?.trim(),
        contactPerson: c.CONTACTPERSON?.trim(),
        totalPurchases: formatCurrency(c.TOTALPURCHASES),
        totalMargin: formatCurrency(c.TOTALMARGIN),
        numOrders: parseInt(c.NUMORDERS) || 0,
        lastPurchase: c.LASTYEAR > 0 ? `${c.LASTYEAR} -${String(c.LASTMONTH).padStart(2, '0')} ` : null
      })),
      hasMore: clients.length === parseInt(limit)
    });

  } catch (error) {
    logger.error(`Clients error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo clientes', details: error.message });
  }
});

// =============================================================================
// CLIENT DETAIL
// =============================================================================
app.get('/api/clients/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { vendedorCodes } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);
    const clientCode = code.trim();

    // Basic client info - using parameterized query
    const clientInfo = await queryWithParams(`
      SELECT C.CODIGOCLIENTE as code, C.NOMBRECLIENTE as name, C.NIF as nif,
  C.DIRECCION as address, C.POBLACION as city, C.PROVINCIA as province,
  C.CODIGOPOSTAL as postalCode, C.TELEFONO1 as phone, C.TELEFONO2 as phone2,
  C.CODIGORUTA as route, C.PERSONACONTACTO as contactPerson,
  C.OBSERVACIONES1 as notes, C.ANOALTA as yearCreated
      FROM DSEDAC.CLI C
      WHERE C.CODIGOCLIENTE = ?
      FETCH FIRST 1 ROWS ONLY
  `, [clientCode]);

    if (clientInfo.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Sales summary - parameterized query
    const salesSummary = await queryWithParams(`
      SELECT 
        SUM(IMPORTEVENTA) as totalSales,
        SUM(IMPORTEMARGENREAL) as totalMargin,
        SUM(CANTIDADENVASES) as totalBoxes,
        COUNT(*) as totalLines,
        COUNT(DISTINCT ANODOCUMENTO || '-' || MESDOCUMENTO || '-' || DIADOCUMENTO) as numOrders
      FROM DSEDAC.LINDTO
      WHERE CODIGOCLIENTEALBARAN = ? 
        AND ANODOCUMENTO >= ${MIN_YEAR} 
        AND TIPOVENTA <> 'SC'
        AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')
        ${vendedorFilter}
    `, [clientCode]);

    // Monthly sales trend (last 12 months) - parameterized
    const monthlyTrend = await queryWithParams(`
      SELECT ANODOCUMENTO as year, MESDOCUMENTO as month,
        SUM(IMPORTEVENTA) as sales, SUM(IMPORTEMARGENREAL) as margin
      FROM DSEDAC.LINDTO
      WHERE CODIGOCLIENTEALBARAN = ? 
        AND ANODOCUMENTO >= ${MIN_YEAR} 
        AND TIPOVENTA <> 'SC'
        AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')
        ${vendedorFilter}
      GROUP BY ANODOCUMENTO, MESDOCUMENTO
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
      FETCH FIRST 12 ROWS ONLY
  `, [clientCode]);

    // Top products for this client - parameterized
    const topProducts = await queryWithParams(`
      SELECT L.CODIGOARTICULO as code,
  COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION)) as name,
  SUM(L.IMPORTEVENTA) as totalSales,
  SUM(L.CANTIDADENVASES) as totalBoxes,
  COUNT(*) as timesOrdered
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.ART A ON TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
      WHERE L.CODIGOCLIENTEALBARAN = ? AND L.ANODOCUMENTO >= ${MIN_YEAR} ${vendedorFilter}
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION
      ORDER BY totalSales DESC
      FETCH FIRST 10 ROWS ONLY
  `, [clientCode]);

    // Payment status from CVC
    const paymentStatus = await query(`
SELECT
SUM(CASE WHEN SITUACION = 'C' THEN IMPORTEVENCIMIENTO ELSE 0 END) as paid,
  SUM(CASE WHEN SITUACION = 'P' THEN IMPORTEPENDIENTE ELSE 0 END) as pending,
  COUNT(CASE WHEN SITUACION = 'P' THEN 1 END) as pendingCount
      FROM DSEDAC.CVC
      WHERE CODIGOCLIENTEALBARAN = '${safeCode}' AND ANOEMISION >= ${MIN_YEAR}
`);

    const c = clientInfo[0];
    const s = salesSummary[0] || {};
    const p = paymentStatus[0] || {};

    res.json({
      client: {
        code: c.CODE?.trim(),
        name: c.NAME?.trim(),
        nif: c.NIF?.trim(),
        address: c.ADDRESS?.trim(),
        city: c.CITY?.trim(),
        province: c.PROVINCE?.trim(),
        postalCode: c.POSTALCODE?.trim(),
        phone: c.PHONE?.trim(),
        phone2: c.PHONE2?.trim(),
        route: c.ROUTE?.trim(),
        contactPerson: c.CONTACTPERSON?.trim(),
        notes: c.NOTES?.trim(),
        yearCreated: c.YEARCREATED
      },
      summary: {
        totalSales: formatCurrency(s.TOTALSALES),
        totalMargin: formatCurrency(s.TOTALMARGIN),
        marginPercent: s.TOTALSALES > 0 ? Math.round((s.TOTALMARGIN / s.TOTALSALES) * 1000) / 10 : 0,
        totalBoxes: parseInt(s.TOTALBOXES) || 0,
        numOrders: parseInt(s.NUMORDERS) || 0,
        avgOrderValue: s.NUMORDERS > 0 ? formatCurrency(s.TOTALSALES) / parseInt(s.NUMORDERS) : 0
      },
      payments: {
        paid: formatCurrency(p.PAID),
        pending: formatCurrency(p.PENDING),
        pendingCount: parseInt(p.PENDINGCOUNT) || 0
      },
      monthlyTrend: monthlyTrend.map(m => ({
        period: `${m.YEAR} -${String(m.MONTH).padStart(2, '0')} `,
        sales: formatCurrency(m.SALES),
        margin: formatCurrency(m.MARGIN)
      })).reverse(),
      topProducts: topProducts.map(p => ({
        code: p.CODE?.trim(),
        name: p.NAME?.trim() || 'Producto desconocido',
        totalSales: formatCurrency(p.TOTALSALES),
        totalBoxes: parseInt(p.TOTALBOXES) || 0,
        timesOrdered: parseInt(p.TIMESORDERED) || 0
      }))
    });

  } catch (error) {
    logger.error(`Client detail error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo detalle del cliente', details: error.message });
  }
});

// =============================================================================
// CLIENT SALES HISTORY
// =============================================================================
app.get('/api/clients/:code/sales-history', async (req, res) => {
  try {
    const { code } = req.params;
    const { vendedorCodes, limit = 50, offset = 0 } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);
    const clientCode = code.trim();

    // Parameterized query for safety
    const sales = await queryWithParams(`
      SELECT ANODOCUMENTO as year, MESDOCUMENTO as month, DIADOCUMENTO as day,
  CODIGOARTICULO as productCode,
  COALESCE(DESCRIPCION, 'Sin descripción') as productName,
  CANTIDADENVASES as boxes, CANTIDADUNIDADES as units,
  IMPORTEVENTA as amount, IMPORTEMARGENREAL as margin,
  CODIGOVENDEDOR as vendedor
      FROM DSEDAC.LINDTO
      WHERE CODIGOCLIENTEALBARAN = ? AND ANODOCUMENTO >= ${MIN_YEAR} 
        AND TIPOVENTA <> 'SC'
        AND SERIEALBARAN NOT IN ('K', 'N', 'O', 'G')
        ${vendedorFilter}
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
      OFFSET ${parseInt(offset)} ROWS
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `, [clientCode]);

    res.json({
      history: sales.map(s => ({
        date: `${s.YEAR} -${String(s.MONTH).padStart(2, '0')} -${String(s.DAY).padStart(2, '0')} `,
        productCode: s.PRODUCTCODE?.trim(),
        productName: s.PRODUCTNAME?.trim(),
        boxes: parseInt(s.BOXES) || 0,
        units: parseInt(s.UNITS) || 0,
        amount: formatCurrency(s.AMOUNT),
        margin: formatCurrency(s.MARGIN),
        vendedor: s.VENDEDOR?.trim()
      })),
      hasMore: sales.length === parseInt(limit)
    });

  } catch (error) {
    logger.error(`Client history error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo historial', details: error.message });
  }
});

// =============================================================================
// ROUTER CALENDAR
// =============================================================================
app.get('/api/router/calendar', async (req, res) => {
  try {
    const { vendedorCodes } = req.query;
    const now = getCurrentDate();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);
    const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

    const activities = await query(`
SELECT
L.ANODOCUMENTO as year, L.MESDOCUMENTO as month, L.DIADOCUMENTO as day,
  L.CODIGOCLIENTEALBARAN as clientCode, C.NOMBRECLIENTE as clientName,
  C.DIRECCION as clientAddress, C.POBLACION as clientCity,
  C.TELEFONO1 as clientPhone, L.CODIGOVENDEDOR as vendedorCode,
  SUM(L.IMPORTEVENTA) as totalSale,
  SUM(L.IMPORTEMARGENREAL) as totalMargin,
  COUNT(*) as numLines,
  COUNT(DISTINCT L.CODIGOARTICULO) as numProducts
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      WHERE L.ANODOCUMENTO = ${year} AND L.MESDOCUMENTO = ${month} ${vendedorFilter}
      GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO, L.DIADOCUMENTO,
  L.CODIGOCLIENTEALBARAN, C.NOMBRECLIENTE, C.DIRECCION, C.POBLACION,
  C.TELEFONO1, L.CODIGOVENDEDOR
      ORDER BY L.DIADOCUMENTO DESC, totalSale DESC
    `);

    // Group by day
    const dayMap = {};
    activities.forEach(a => {
      const day = a.DAY;
      if (!dayMap[day]) {
        dayMap[day] = { day, visits: [], totalSales: 0, totalClients: 0 };
      }
      dayMap[day].visits.push({
        client: {
          code: a.CLIENTCODE?.trim(),
          name: a.CLIENTNAME?.trim(),
          address: a.CLIENTADDRESS?.trim(),
          city: a.CLIENTCITY?.trim(),
          phone: a.CLIENTPHONE?.trim()
        },
        vendedorCode: a.VENDEDORCODE?.trim(),
        sale: formatCurrency(a.TOTALSALE),
        margin: formatCurrency(a.TOTALMARGIN),
        numLines: parseInt(a.NUMLINES) || 0,
        numProducts: parseInt(a.NUMPRODUCTS) || 0
      });
      dayMap[day].totalSales += formatCurrency(a.TOTALSALE);
      dayMap[day].totalClients++;
    });

    res.json({
      period: { year, month },
      days: Object.values(dayMap).sort((a, b) => b.day - a.day),
      summary: {
        totalDaysWithActivity: Object.keys(dayMap).length,
        totalVisits: activities.length,
        totalSales: activities.reduce((sum, a) => sum + formatCurrency(a.TOTALSALE), 0)
      }
    });

  } catch (error) {
    logger.error(`Router error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo rutero', details: error.message });
  }
});

// =============================================================================
// RUTERO POR DÍA DE LA SEMANA (COMERCIAL / REPARTIDOR)
// =============================================================================

const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// OLD DUPLICATE - COMMENTED OUT - Using endpoint at line ~3130 instead
// GET /api/rutero/week - DISABLED (duplicate, no vendedorCodes filter)
/*
app.get('/api/rutero/week_OLD', async (req, res) => {
  try {
    const { role = 'comercial' } = req.query;

    // Select columns based on role:
    // comercial = R1_T8DIV* (Día de Visita)
    // repartidor = R1_T8DIR* (Día de Reparto)
    const prefix = role === 'repartidor' ? 'R1_T8DIR' : 'R1_T8DIV';

    const result = await query(`
      SELECT 
        COUNT(DISTINCT CASE WHEN ${prefix}L = 'S' THEN LCCDCL END) AS lunes,
        COUNT(DISTINCT CASE WHEN ${prefix}M = 'S' THEN LCCDCL END) AS martes,
        COUNT(DISTINCT CASE WHEN ${prefix}X = 'S' THEN LCCDCL END) AS miercoles,
        COUNT(DISTINCT CASE WHEN ${prefix}J = 'S' THEN LCCDCL END) AS jueves,
        COUNT(DISTINCT CASE WHEN ${prefix}V = 'S' THEN LCCDCL END) AS viernes,
        COUNT(DISTINCT CASE WHEN ${prefix}S = 'S' THEN LCCDCL END) AS sabado,
        COUNT(DISTINCT CASE WHEN ${prefix}D = 'S' THEN LCCDCL END) AS domingo,
        COUNT(DISTINCT LCCDCL) AS total
      FROM DSED.LACLAE
      WHERE LCTPLN = 'T'
    `);

    const row = result[0] || {};

    res.json({
      role,
      roleDescription: role === 'repartidor' ? 'Días de Reparto' : 'Días de Visita',
      week: {
        lunes: parseInt(row.LUNES) || 0,
        martes: parseInt(row.MARTES) || 0,
        miercoles: parseInt(row.MIERCOLES) || 0,
        jueves: parseInt(row.JUEVES) || 0,
        viernes: parseInt(row.VIERNES) || 0,
        sabado: parseInt(row.SABADO) || 0,
        domingo: parseInt(row.DOMINGO) || 0
      },
      total: parseInt(row.TOTAL) || 0,
      todayName: WEEKDAY_NAMES[new Date().getDay()]
    });

  } catch (error) {
    logger.error(`Rutero week error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo rutero semanal', details: error.message });
  }
});
*/

// Mapeo día -> índice de día de la semana
const DAY_INDEX_MAP = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3,
  jueves: 4, viernes: 5, sabado: 6
};

// OLD DUPLICATE - COMMENTED OUT - Using endpoint at line ~3195 instead
// GET /api/rutero/day/:dia - DISABLED (duplicate, no proper vendedorCodes filter)
/*
app.get('/api/rutero/day_OLD/:dia', async (req, res) => {
  try {
    const { dia } = req.params;
    const { role = 'comercial', vendedorCodes, year, month } = req.query; // role: 'comercial' | 'repartidor'
    const now = getCurrentDate();
    const targetYear = parseInt(year) || now.getFullYear();
    const targetMonth = parseInt(month) || (now.getMonth() + 1);

    const diaLower = dia.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // Select column prefix based on role:
    // comercial = R1_T8DIV* (Día de Visita)
    // repartidor = R1_T8DIR* (Día de Reparto/Distribución)
    const prefix = role === 'repartidor' ? 'R1_T8DIR' : 'R1_T8DIV';

    // Mapeo de día a sufijo de columna
    let daySuffix = '';
    switch (diaLower) {
      case 'lunes': daySuffix = 'L'; break;
      case 'martes': daySuffix = 'M'; break;
      case 'miercoles': daySuffix = 'X'; break;
      case 'jueves': daySuffix = 'J'; break;
      case 'viernes': daySuffix = 'V'; break;
      case 'sabado': daySuffix = 'S'; break;
      case 'domingo': daySuffix = 'D'; break;
      default:
        return res.status(400).json({ error: 'Día inválido. Usar: lunes, martes, miercoles, jueves, viernes, sabado, domingo' });
    }

    const dayColumn = `${prefix}${daySuffix}`;

    // Obtener clientes únicos para este día desde LACLAE
    // Using NOMBREALTERNATIVO for razón social with fallback to NOMBRECLIENTE
    const clients = await query(`
      SELECT DISTINCT
        L.LCCDCL as codigo,
        COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as razonSocial,
        C.NOMBRECLIENTE as nombreCompleto,
        C.DIRECCION as direccion,
        C.POBLACION as poblacion,
        C.PROVINCIA as provincia,
        C.TELEFONO1 as telefono,
        C.CODIGORUTA as ruta,
        C.PERSONACONTACTO as contacto
      FROM DSED.LACLAE L
      LEFT JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
      WHERE L.LCTPLN = 'T'
        AND L.${dayColumn} = 'S'
        AND L.LCCDCL IS NOT NULL
        AND L.LCCDCL <> ''
      ORDER BY razonSocial
      FETCH FIRST 150 ROWS ONLY
    `);

    // Obtener ventas para estos clientes para calcular estado
    const clientCodes = clients.map(c => `'${c.CODIGO.trim()}'`).join(',');

    let salesMap = {};
    if (clientCodes.length > 0) {
      // Ventas Mes Actual (targetYear)
      const currentSalesData = await query(`
        SELECT CODIGOCLIENTEALBARAN as code, SUM(IMPORTEVENTA) as sales
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = ${targetYear} 
          AND MESDOCUMENTO = ${targetMonth}
          AND CODIGOCLIENTEALBARAN IN (${clientCodes})
        GROUP BY CODIGOCLIENTEALBARAN
      `);

      // Ventas Año Anterior (targetYear - 1)
      const lastSalesData = await query(`
        SELECT CODIGOCLIENTEALBARAN as code, SUM(IMPORTEVENTA) as sales
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = ${targetYear - 1} 
          AND MESDOCUMENTO = ${targetMonth}
          AND CODIGOCLIENTEALBARAN IN (${clientCodes})
        GROUP BY CODIGOCLIENTEALBARAN
      `);

      // Mapear resultados
      currentSalesData.forEach(r => {
        const code = r.CODE.trim();
        if (!salesMap[code]) salesMap[code] = { current: 0, last: 0 };
        salesMap[code].current = parseFloat(r.SALES) || 0;
      });

      lastSalesData.forEach(r => {
        const code = r.CODE.trim();
        if (!salesMap[code]) salesMap[code] = { current: 0, last: 0 };
        salesMap[code].last = parseFloat(r.SALES) || 0;
      });
    }

    // Formatear clientes with razón social
    const enrichedClients = clients.map(c => {
      const address = c.DIRECCION?.trim() || '';
      const city = c.POBLACION?.trim() || '';
      const province = c.PROVINCIA?.trim() || '';
      const fullAddress = [address, city, province].filter(Boolean).join(', ');

      const code = c.CODIGO?.trim() || '';
      const sales = salesMap[code] || { current: 0, last: 0 };
      const currentSales = sales.current;
      const lastSales = sales.last;
      const variation = lastSales > 0 ? ((currentSales - lastSales) / lastSales) * 100 : (currentSales > 0 ? 100 : 0);

      return {
        code: code,
        name: c.RAZONSOCIAL?.trim() || c.NOMBRECOMPLETO?.trim() || 'Sin nombre',
        razonSocial: c.RAZONSOCIAL?.trim() || '',
        nombreCompleto: c.NOMBRECOMPLETO?.trim() || '',
        address: address,
        city: city,
        province: province,
        phone: c.TELEFONO?.trim() || '',
        route: c.RUTA?.trim() || '',
        contact: c.CONTACTO?.trim() || '',
        mapsUrl: fullAddress
          ? `https://maps.google.com/?q=${encodeURIComponent(fullAddress + ', España')}`
          : null,
        status: {
          currentMonthSales: currentSales,
          lastYearSamePeriod: lastSales,
          variation: Math.round(variation * 10) / 10,
          isPositive: variation >= 0
        }
      };
    });

    res.json({
      day: dia,
      role,
      roleDescription: role === 'repartidor' ? 'Día de Reparto' : 'Día de Visita',
      year: targetYear,
      month: targetMonth,
      clients: enrichedClients,
      summary: {
        totalClients: enrichedClients.length,
        positive: enrichedClients.filter(c => c.status.isPositive).length,
        negative: enrichedClients.filter(c => !c.status.isPositive).length,
        withPhone: enrichedClients.filter(c => c.phone).length,
        withAddress: enrichedClients.filter(c => c.address).length
      }
    });

  } catch (error) {
    logger.error(`Rutero day error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo rutero del día', details: error.message });
  }
});
*/

// GET /api/rutero/client/:code/status - Estado del cliente con comparación YoY
app.get('/api/rutero/client/:code/status', async (req, res) => {
  try {
    const { code } = req.params;
    const clientCode = code.trim();
    const now = getCurrentDate();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Ventas por mes del año actual (usando LAC) - parameterized
    const currentYearData = await queryWithParams(`
      SELECT MESDOCUMENTO as month, SUM(IMPORTEVENTA) as sales, SUM(IMPORTEVENTA - IMPORTECOSTO) as margin
      FROM DSEDAC.LAC
      WHERE CODIGOCLIENTEALBARAN = ? AND ANODOCUMENTO = ${currentYear}
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
    `, [clientCode]);

    // Ventas por mes del año anterior (usando LAC) - parameterized
    const lastYearData = await queryWithParams(`
      SELECT MESDOCUMENTO as month, SUM(IMPORTEVENTA) as sales, SUM(IMPORTEVENTA - IMPORTECOSTO) as margin
      FROM DSEDAC.LAC
      WHERE CODIGOCLIENTEALBARAN = ? AND ANODOCUMENTO = ${currentYear - 1}
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
    `, [clientCode]);

    // Crear mapa de comparación
    const comparison = [];
    for (let m = 1; m <= 12; m++) {
      const curr = currentYearData.find(d => d.MONTH === m);
      const last = lastYearData.find(d => d.MONTH === m);
      const currSales = parseFloat(curr?.SALES) || 0;
      const lastSales = parseFloat(last?.SALES) || 0;
      const variation = lastSales > 0 ? ((currSales - lastSales) / lastSales) * 100 : (currSales > 0 ? 100 : 0);

      comparison.push({
        month: m,
        currentYear: currSales,
        lastYear: lastSales,
        variation: Math.round(variation * 10) / 10,
        isPositive: variation >= 0
      });
    }

    // Totales YTD (Accumulated)
    // Sum only up to current month for accurate "at this point in time" comparison?
    // User asked for "Evolucion y acumulado". 
    // We will sum everything up to current month for YTD.
    const ytdCurrent = comparison.filter(c => c.month <= currentMonth).reduce((sum, c) => sum + c.currentYear, 0);
    const ytdLast = comparison.filter(c => c.month <= currentMonth).reduce((sum, c) => sum + c.lastYear, 0);
    const ytdVariation = ytdLast > 0 ? ((ytdCurrent - ytdLast) / ytdLast) * 100 : (ytdCurrent > 0 ? 100 : 0);

    // Also calculate Full Year forecast or total if needed, but YTD is standard.

    res.json({
      clientCode: code,
      currentYear,
      comparison,
      ytd: {
        currentYear: ytdCurrent,
        lastYear: ytdLast,
        variation: Math.round(ytdVariation * 10) / 10,
        isPositive: ytdVariation >= 0
      }
    });

  } catch (error) {
    logger.error(`Client status error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo estado del cliente', details: error.message });
  }
});

// =============================================================================
// RUTERO CLIENT COMPREHENSIVE DETAIL (Exhaustive breakdown - NO objectives)
// =============================================================================
app.get('/api/rutero/client/:code/detail', async (req, res) => {
  try {
    const { code } = req.params;
    const { year, filterMonth } = req.query;
    const safeCode = code.replace(/'/g, "''").trim();
    const now = getCurrentDate();
    const targetYear = parseInt(year) || now.getFullYear();

    // 1. Client Info with Razón Social
    const clientInfo = await query(`
      SELECT 
        CODIGOCLIENTE as code,
        COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), TRIM(NOMBRECLIENTE)) as razonSocial,
        NOMBRECLIENTE as nombreCompleto,
        NIF, DIRECCION, POBLACION, PROVINCIA, CODIGOPOSTAL,
        TELEFONO1, TELEFONO2, PERSONACONTACTO, CODIGORUTA
      FROM DSEDAC.CLI
      WHERE CODIGOCLIENTE = '${safeCode}'
      FETCH FIRST 1 ROWS ONLY
    `);

    if (clientInfo.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // 2. Monthly Sales Breakdown (Current + Last Year)
    let salesByMonth = [];
    try {
      salesByMonth = await query(`
        SELECT 
          L.ANODOCUMENTO as year,
          L.MESDOCUMENTO as month,
          SUM(L.IMPORTEVENTA) as sales,
          SUM(L.IMPORTEMARGENREAL) as margin,
          COUNT(DISTINCT L.NUMERODOCUMENTO) as invoices,
          COUNT(DISTINCT L.CODIGOARTICULO) as products
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
          AND C.CCYEAB = L.LCYEAB 
          AND C.CCSRAB = L.LCSRAB 
          AND C.CCTRAB = L.LCTRAB 
          AND C.CCNRAB = L.LCNRAB
        WHERE L.CODIGOCLIENTEALBARAN = '${safeCode}'
          AND L.ANODOCUMENTO IN (${targetYear}, ${targetYear - 1})
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(C.CCSNSD, '') <> 'E'
        GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC
      `);
    } catch (e) {
      logger.warn(`Sales by month query failed, trying simpler version: ${e.message}`);
      // Fallback without margin
      salesByMonth = await query(`
        SELECT 
          ANODOCUMENTO as year,
          MESDOCUMENTO as month,
          SUM(IMPORTEVENTA) as sales,
          0 as margin,
          COUNT(DISTINCT NUMERODOCUMENTO) as invoices,
          COUNT(DISTINCT CODIGOARTICULO) as products
        FROM DSEDAC.LAC
        WHERE CODIGOCLIENTEALBARAN = '${safeCode}'
          AND ANODOCUMENTO IN (${targetYear}, ${targetYear - 1})
        GROUP BY ANODOCUMENTO, MESDOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
      `);
    }

    // 3. Product Purchases with Dates (filterable by month)
    let productFilter = '';
    if (filterMonth) {
      productFilter = `AND MESDOCUMENTO = ${parseInt(filterMonth)}`;
    }

    let productPurchases = [];
    try {
      productPurchases = await query(`
        SELECT 
          L.CODIGOARTICULO as productCode,
          L.DESCRIPCION as productName,
          L.ANODOCUMENTO as year,
          L.MESDOCUMENTO as month,
          L.DIADOCUMENTO as day,
          L.PRECIOVENTA as price,
          L.CANTIDADUNIDADES as quantity,
          L.IMPORTEVENTA as total,
          L.CODIGOLOTE as lote,
          L.REFERENCIADOCUMENTO as ref,
          L.NUMERODOCUMENTO as invoice
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
          AND C.CCYEAB = L.LCYEAB 
          AND C.CCSRAB = L.LCSRAB 
          AND C.CCTRAB = L.LCTRAB 
          AND C.CCNRAB = L.LCNRAB
        WHERE L.CODIGOCLIENTEALBARAN = '${safeCode}'
          AND L.ANODOCUMENTO = ${targetYear}
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(C.CCSNSD, '') <> 'E'
          ${productFilter}
        ORDER BY L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
        FETCH FIRST 300 ROWS ONLY
      `);
    } catch (e) {
      logger.warn(`Product purchases query failed: ${e.message}`);
    }

    // 4. Yearly Totals (last 3 years)
    let yearlyTotals = [];
    try {
      yearlyTotals = await query(`
        SELECT 
          L.ANODOCUMENTO as year,
          SUM(L.IMPORTEVENTA) as totalSales,
          SUM(L.IMPORTEMARGENREAL) as totalMargin,
          COUNT(DISTINCT L.MESDOCUMENTO) as activeMonths,
          COUNT(DISTINCT L.NUMERODOCUMENTO) as totalInvoices
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
          AND C.CCYEAB = L.LCYEAB 
          AND C.CCSRAB = L.LCSRAB 
          AND C.CCTRAB = L.LCTRAB 
          AND C.CCNRAB = L.LCNRAB
        WHERE L.CODIGOCLIENTEALBARAN = '${safeCode}'
          AND L.ANODOCUMENTO >= ${targetYear - 2}
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(C.CCSNSD, '') <> 'E'
        GROUP BY L.ANODOCUMENTO
        ORDER BY L.ANODOCUMENTO DESC
      `);
    } catch (e) {
      logger.warn(`Yearly totals margin query failed, trying simpler version: ${e.message}`);
      try {
        yearlyTotals = await query(`
          SELECT 
            L.ANODOCUMENTO as year,
            SUM(L.IMPORTEVENTA) as totalSales,
            0 as totalMargin,
            COUNT(DISTINCT L.MESDOCUMENTO) as activeMonths,
            COUNT(DISTINCT L.NUMERODOCUMENTO) as totalInvoices
          FROM DSEDAC.LAC L
          LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
            AND C.CCYEAB = L.LCYEAB 
            AND C.CCSRAB = L.LCSRAB 
            AND C.CCTRAB = L.LCTRAB 
            AND C.CCNRAB = L.LCNRAB
          WHERE L.CODIGOCLIENTEALBARAN = '${safeCode}'
            AND L.ANODOCUMENTO >= ${targetYear - 2}
            -- Matrix cleanup filters
            AND L.LCTPVT <> 'SC'
            AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
            AND COALESCE(C.CCSNSD, '') <> 'E'
          GROUP BY L.ANODOCUMENTO
          ORDER BY L.ANODOCUMENTO DESC
        `);
      } catch (e2) {
        logger.warn(`Yearly totals fallback query failed: ${e2.message}`);
        yearlyTotals = [];
      }
    }

    // 5. Top Products for This Client (this year)
    let topProducts = [];
    try {
      topProducts = await query(`
        SELECT 
          L.CODIGOARTICULO as code,
          MAX(L.DESCRIPCION) as name,
          SUM(L.IMPORTEVENTA) as totalSales,
          SUM(L.CANTIDADUNIDADES) as totalUnits,
          COUNT(*) as purchases
        FROM DSEDAC.LAC L
        LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
          AND C.CCYEAB = L.LCYEAB 
          AND C.CCSRAB = L.LCSRAB 
          AND C.CCTRAB = L.LCTRAB 
          AND C.CCNRAB = L.LCNRAB
        WHERE L.CODIGOCLIENTEALBARAN = '${safeCode}'
          AND L.ANODOCUMENTO = ${targetYear}
          -- Matrix cleanup filters
          AND L.LCTPVT <> 'SC'
          AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
          AND COALESCE(C.CCSNSD, '') <> 'E'
        GROUP BY L.CODIGOARTICULO
        ORDER BY SUM(L.IMPORTEVENTA) DESC
        FETCH FIRST 20 ROWS ONLY
      `);
    } catch (e) {
      logger.warn(`Top products query failed: ${e.message}`);
    }

    // 6. Purchase frequency - calculate average days between purchases
    let purchaseFreq = [];
    try {
      purchaseFreq = await query(`
        SELECT 
          COUNT(DISTINCT DIADOCUMENTO || MESDOCUMENTO || ANODOCUMENTO) as purchaseDays,
          MIN(MESDOCUMENTO) as firstMonth,
          MAX(MESDOCUMENTO) as lastMonth
        FROM DSEDAC.LAC
        WHERE CODIGOCLIENTEALBARAN = '${safeCode}'
          AND ANODOCUMENTO = ${targetYear}
      `);
    } catch (e) {
      logger.warn(`Purchase frequency query failed: ${e.message}`);
      purchaseFreq = [{ PURCHASEDAYS: 0, FIRSTMONTH: 1, LASTMONTH: 12 }];
    }

    // Process data
    const c = clientInfo[0];

    // Build monthly comparison with explicit € formatting data
    const monthlyData = [];
    for (let m = 1; m <= 12; m++) {
      const currRow = salesByMonth.find(r => r.YEAR === targetYear && r.MONTH === m);
      const lastRow = salesByMonth.find(r => r.YEAR === targetYear - 1 && r.MONTH === m);

      const currSales = parseFloat(currRow?.SALES) || 0;
      const lastSales = parseFloat(lastRow?.SALES) || 0;
      const variation = lastSales > 0
        ? ((currSales - lastSales) / lastSales) * 100
        : (currSales > 0 ? 100 : 0);

      monthlyData.push({
        month: m,
        monthName: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][m - 1],
        currentYear: currSales,
        currentYearFormatted: `${currSales.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`,
        lastYear: lastSales,
        lastYearFormatted: `${lastSales.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`,
        variation: Math.round(variation * 10) / 10,
        isPositive: variation >= 0,
        margin: parseFloat(currRow?.MARGIN) || 0,
        invoices: parseInt(currRow?.INVOICES) || 0,
        products: parseInt(currRow?.PRODUCTS) || 0
      });
    }

    // Calculate totals and averages
    const currentYearTotal = yearlyTotals.find(y => y.YEAR === targetYear);
    const lastYearTotal = yearlyTotals.find(y => y.YEAR === targetYear - 1);

    const totalCurrent = parseFloat(currentYearTotal?.TOTALSALES) || 0;
    const totalLast = parseFloat(lastYearTotal?.TOTALSALES) || 0;
    const monthlyAverage = totalCurrent / 12; // Always divide by 12 as per requirement

    // Calculate purchase frequency insights
    const freq = purchaseFreq[0] || {};
    const purchaseDays = parseInt(freq.PURCHASEDAYS) || 0;
    const monthsActive = (parseInt(freq.LASTMONTH) || 1) - (parseInt(freq.FIRSTMONTH) || 1) + 1;
    const avgPurchasesPerMonth = monthsActive > 0 ? purchaseDays / monthsActive : 0;

    res.json({
      client: {
        code: c.CODE?.trim(),
        razonSocial: c.RAZONSOCIAL?.trim() || c.NOMBRECOMPLETO?.trim(),
        nombreCompleto: c.NOMBRECOMPLETO?.trim(),
        nif: c.NIF?.trim(),
        address: c.DIRECCION?.trim(),
        city: c.POBLACION?.trim(),
        province: c.PROVINCIA?.trim(),
        postalCode: c.CODIGOPOSTAL?.trim(),
        phone: c.TELEFONO1?.trim(),
        phone2: c.TELEFONO2?.trim(),
        contact: c.PERSONACONTACTO?.trim(),
        route: c.CODIGORUTA?.trim()
      },
      year: targetYear,

      // Monthly breakdown with chart-ready data
      monthlyData,

      // Chart axis helper - max value for Y axis
      chartAxisMax: Math.max(...monthlyData.map(m => Math.max(m.currentYear, m.lastYear))) * 1.1,

      // Totals with formatted values
      totals: {
        currentYear: totalCurrent,
        currentYearFormatted: `${totalCurrent.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`,
        lastYear: totalLast,
        lastYearFormatted: `${totalLast.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`,
        variation: totalLast > 0
          ? Math.round(((totalCurrent - totalLast) / totalLast) * 1000) / 10
          : 0,
        monthlyAverage: monthlyAverage,
        monthlyAverageFormatted: `${monthlyAverage.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`,
        isPositive: totalCurrent >= totalLast
      },

      // Product purchases - detailed list
      productPurchases: productPurchases.map(p => ({
        productCode: p.PRODUCTCODE?.trim(),
        productName: p.PRODUCTNAME?.trim(),
        date: `${p.YEAR}-${String(p.MONTH).padStart(2, '0')}-${String(p.DAY).padStart(2, '0')}`,
        year: p.YEAR,
        month: p.MONTH,
        day: p.DAY,
        price: formatCurrency(p.PRICE),
        priceFormatted: `${(parseFloat(p.PRICE) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`,
        quantity: parseFloat(p.QUANTITY) || 0,
        total: formatCurrency(p.TOTAL),
        totalFormatted: `${(parseFloat(p.TOTAL) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`,
        lote: p.LOTE?.trim() || '',
        ref: p.REF?.trim() || '',
        invoice: p.INVOICE?.trim() || ''
      })),

      // Top products
      topProducts: topProducts.map(p => ({
        code: p.CODE?.trim(),
        name: p.NAME?.trim(),
        totalSales: formatCurrency(p.TOTALSALES),
        totalSalesFormatted: `${(parseFloat(p.TOTALSALES) || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`,
        totalUnits: parseFloat(p.TOTALUNITS) || 0,
        purchases: parseInt(p.PURCHASES) || 0
      })),

      // Yearly totals for comparison
      yearlyTotals: yearlyTotals.map(y => ({
        year: y.YEAR,
        totalSales: formatCurrency(y.TOTALSALES),
        totalSalesFormatted: `${(parseFloat(y.TOTALSALES) || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`,
        totalMargin: formatCurrency(y.TOTALMARGIN),
        activeMonths: parseInt(y.ACTIVEMONTHS) || 0,
        totalInvoices: parseInt(y.TOTALINVOICES) || 0,
        monthlyAverage: formatCurrency((parseFloat(y.TOTALSALES) || 0) / 12),
        monthlyAverageFormatted: `${((parseFloat(y.TOTALSALES) || 0) / 12).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`
      })),

      // Purchase frequency insights
      purchaseFrequency: {
        totalPurchaseDays: purchaseDays,
        avgPurchasesPerMonth: Math.round(avgPurchasesPerMonth * 10) / 10,
        isFrequentBuyer: avgPurchasesPerMonth >= 4
      }
    });

  } catch (error) {
    logger.error(`Rutero client detail error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo detalle del cliente', details: error.message });
  }
});

// =============================================================================
// OBJETIVOS COMERCIALES (Datos reales de DSEDAC.COFC y DSEDAC.CMV)
// =============================================================================

// Mapeo mes número -> campo de cuota en COFC
const MONTH_QUOTA_MAP = {
  1: 'CUOTAENERO', 2: 'CUOTAFEBRERO', 3: 'CUOTAMARZO', 4: 'CUOTAABRIL',
  5: 'CUOTAMAYO', 6: 'CUOTAJUNIO', 7: 'CUOTAJULIO', 8: 'CUOTAAGOSTO',
  9: 'CUOTASEPTIEMBRE', 10: 'CUOTAOCTUBRE', 11: 'CUOTANOVIEMBRE', 12: 'CUOTADICIEMBRE'
};

// GET /api/objectives - Obtener objetivos y progreso (datos reales de COFC/CMV)
app.get('/api/objectives', async (req, res) => {
  try {
    const { vendedorCodes, year, month } = req.query;
    const now = getCurrentDate();
    const targetYear = parseInt(year) || now.getFullYear();
    const targetMonth = parseInt(month) || (now.getMonth() + 1);
    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    // Intentar obtener objetivos desde DSEDAC.COFC (cuotas mensuales)
    let salesObjective = 0;
    let marginObjective = 0;
    let objectiveSource = 'calculated'; // 'database' o 'calculated'

    try {
      // Obtener cuota del mes desde COFC (puede estar vinculada a vendedor o global)
      // Nota: Si hay filtro de vendedor, quizás deberíamos filtrar la cuota también
      const quotaField = MONTH_QUOTA_MAP[targetMonth];
      if (quotaField) {
        // Si hay vendedor específico, intentar filtrar COFC si tiene columna vendedor (o usar CMV)
        // Por ahora mantenemos lógica global si no es específica
        const quotaResult = await query(`
          SELECT COALESCE(SUM(${quotaField}), 0) as quota
          FROM DSEDAC.COFC
          WHERE CODIGOTIPOCUOTA IS NOT NULL
        `, false);

        if (quotaResult[0] && parseFloat(quotaResult[0].QUOTA) > 0) {
          salesObjective = parseFloat(quotaResult[0].QUOTA);
          objectiveSource = 'database';
        }
      }
    } catch (e) {
      logger.warn(`COFC query failed, using calculated objectives: ${e.message}`);
    }

    // Intentar obtener objetivo de CMV (por vendedor) si no hay cuota global y se pide un vendedor
    if (salesObjective === 0 && vendedorCodes && vendedorCodes !== 'ALL') {
      try {
        const code = vendedorCodes.split(',')[0].trim();
        const cmvResult = await query(`
          SELECT COALESCE(IMPORTEOBJETIVO, 0) as objetivo,
                 COALESCE(PORCENTAJEOBJETIVO, 0) as porcentaje
          FROM DSEDAC.CMV 
          WHERE TRIM(CODIGOVENDEDOR) = '${code}'
        `, false);

        if (cmvResult[0]) {
          const cmvObjective = parseFloat(cmvResult[0].OBJETIVO) || 0;
          const cmvPercentage = parseFloat(cmvResult[0].PORCENTAJE) || 0;

          if (cmvObjective > 0) {
            salesObjective = cmvObjective;
            objectiveSource = 'database';
          } else if (cmvPercentage > 0) {
            // Si hay porcentaje objetivo, calcular basado en año anterior (usando LAC)
            const lastYearSales = await query(`
              SELECT COALESCE(SUM(IMPORTEVENTA), 0) as sales
              FROM DSEDAC.LAC
              WHERE ANODOCUMENTO = ${targetYear - 1} AND MESDOCUMENTO = ${targetMonth} ${vendedorFilter}
            `, false);
            const lastSales = parseFloat(lastYearSales[0]?.SALES) || 0;
            salesObjective = lastSales * (1 + cmvPercentage / 100);
            objectiveSource = 'database';
          }
        }
      } catch (e) {
        logger.warn(`CMV query failed: ${e.message}`);
      }
    }

    // Ventas del mes actual (usando LAC)
    // Aplicamos vendedorFilter para que coincida con lo solicitado (Global o Vendedor)
    const currentSales = await query(`
      SELECT 
        COALESCE(SUM(IMPORTEVENTA), 0) as sales,
        COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) as margin,
        COUNT(DISTINCT CODIGOCLIENTEALBARAN) as clients
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO = ${targetYear} AND MESDOCUMENTO = ${targetMonth} ${vendedorFilter}
    `);

    // Ventas del mismo mes año anterior (usando LAC)
    const lastYearSales = await query(`
      SELECT 
        COALESCE(SUM(IMPORTEVENTA), 0) as sales,
        COALESCE(SUM(IMPORTEVENTA - IMPORTECOSTO), 0) as margin,
        COUNT(DISTINCT CODIGOCLIENTEALBARAN) as clients
      FROM DSEDAC.LAC
      WHERE ANODOCUMENTO = ${targetYear - 1} AND MESDOCUMENTO = ${targetMonth} ${vendedorFilter}
    `);

    const curr = currentSales[0] || {};
    const last = lastYearSales[0] || {};

    const salesCurrent = parseFloat(curr.SALES) || 0;
    const salesLast = parseFloat(last.SALES) || 0;

    // Si no encontramos objetivo en BD, calcular como +10% sobre año anterior
    if (salesObjective === 0) {
      salesObjective = salesLast * 1.10;
    }
    // Si sigue siendo 0 (sin histórico), poner un default simbólico o 0
    if (salesObjective === 0 && salesCurrent > 0) salesObjective = salesCurrent * 1.1;

    const salesProgress = salesObjective > 0 ? (salesCurrent / salesObjective) * 100 : 0;

    const marginCurrent = parseFloat(curr.MARGIN) || 0;
    const marginLast = parseFloat(last.MARGIN) || 0;
    // Si no hay marginObjective global, usar histórico + 10%
    marginObjective = marginObjective || (marginLast * 1.10);
    const marginProgress = marginObjective > 0 ? (marginCurrent / marginObjective) * 100 : 0;

    const clientsCurrent = parseInt(curr.CLIENTS) || 0;
    const clientsLast = parseInt(last.CLIENTS) || 0;
    const clientsObjective = Math.ceil(clientsLast * 1.05);
    const clientsProgress = clientsObjective > 0 ? (clientsCurrent / clientsObjective) * 100 : 0;

    // Alertas
    const alerts = [];
    if (salesProgress < 80) alerts.push({ type: 'warning', message: `Ventas al ${salesProgress.toFixed(0)}% del objetivo` });
    if (salesProgress < 50) alerts.push({ type: 'danger', message: 'Ventas muy por debajo del objetivo' });
    if (marginProgress < 70) alerts.push({ type: 'warning', message: 'Margen por debajo del esperado' });

    res.json({
      period: { year: targetYear, month: targetMonth },
      objectiveSource,
      objectives: {
        sales: {
          target: salesObjective,
          current: salesCurrent,
          lastYear: salesLast,
          progress: Math.round(salesProgress * 10) / 10,
          variation: salesLast > 0 ? Math.round(((salesCurrent - salesLast) / salesLast) * 1000) / 10 : 0
        },
        margin: {
          target: marginObjective,
          current: marginCurrent,
          lastYear: marginLast,
          progress: Math.round(marginProgress * 10) / 10
        },
        clients: {
          target: clientsObjective,
          current: clientsCurrent,
          lastYear: clientsLast,
          progress: Math.round(clientsProgress * 10) / 10
        }
      },
      alerts
    });

  } catch (error) {
    logger.error(`Objectives error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo objetivos', details: error.message });
  }
});

// [DELETED] Duplicate /api/objectives/by-client - See line ~3156 for the correct implementation

// Duplicate route deleted //

// [DELETED] Old /api/objectives/matrix endpoint - Using new implementation at line ~3077 























// =============================================================================
// TOP PRODUCTS (with real descriptions from ART)
// =============================================================================
app.get('/api/analytics/top-products', async (req, res) => {
  try {
    const { vendedorCodes, limit = 20 } = req.query;
    const now = getCurrentDate();
    const year = parseInt(req.query.year) || now.getFullYear();
    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    const products = await query(`
      SELECT L.CODIGOARTICULO as code,
  COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION), 'Producto ' || TRIM(L.CODIGOARTICULO)) as name,
  A.CODIGOMARCA as brand,
  A.CODIGOFAMILIA as family,
  SUM(L.IMPORTEVENTA) as totalSales,
  SUM(L.IMPORTEMARGENREAL) as totalMargin,
  SUM(L.CANTIDADENVASES) as totalBoxes,
  SUM(L.CANTIDADUNIDADES) as totalUnits,
  COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) as numClients
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.ART A ON TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
      WHERE L.ANODOCUMENTO = ${year} ${vendedorFilter}
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION, A.CODIGOMARCA, A.CODIGOFAMILIA
      ORDER BY totalSales DESC
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `);

    res.json({
      year,
      products: products.map(p => ({
        code: p.CODE?.trim(),
        name: p.NAME?.trim(),
        brand: p.BRAND?.trim(),
        family: p.FAMILY?.trim(),
        totalSales: formatCurrency(p.TOTALSALES),
        totalMargin: formatCurrency(p.TOTALMARGIN),
        marginPercent: p.TOTALSALES > 0 ? Math.round((p.TOTALMARGIN / p.TOTALSALES) * 1000) / 10 : 0,
        totalBoxes: parseInt(p.TOTALBOXES) || 0,
        totalUnits: parseInt(p.TOTALUNITS) || 0,
        numClients: parseInt(p.NUMCLIENTS) || 0
      }))
    });
  } catch (error) {
    logger.error(`Top Products error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo productos', details: error.message });
  }
});

// =============================================================================
// TOP CLIENTS
// =============================================================================
app.get('/api/analytics/top-clients', async (req, res) => {
  try {
    const { vendedorCodes, limit = 20 } = req.query;
    const now = getCurrentDate();
    const year = parseInt(req.query.year) || now.getFullYear();
    const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

    const clients = await query(`
      SELECT L.CODIGOCLIENTEALBARAN as code,
  MIN(C.NOMBRECLIENTE) as name,
  MIN(C.POBLACION) as city,
  SUM(L.IMPORTEVENTA) as totalSales,
  SUM(L.IMPORTEMARGENREAL) as totalMargin,
  SUM(L.CANTIDADENVASES) as totalBoxes,
  COUNT(DISTINCT L.ANODOCUMENTO || '-' || L.MESDOCUMENTO || '-' || L.DIADOCUMENTO) as numOrders,
  COUNT(DISTINCT L.CODIGOARTICULO) as numProducts
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      WHERE L.ANODOCUMENTO = ${year} ${vendedorFilter}
      GROUP BY L.CODIGOCLIENTEALBARAN
      ORDER BY totalSales DESC
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `);

    res.json({
      year,
      clients: clients.map(c => ({
        code: c.CODE?.trim(),
        name: c.NAME?.trim() || 'Cliente desconocido',
        city: c.CITY?.trim(),
        totalSales: formatCurrency(c.TOTALSALES),
        totalMargin: formatCurrency(c.TOTALMARGIN),
        marginPercent: c.TOTALSALES > 0 ? Math.round((c.TOTALMARGIN / c.TOTALSALES) * 1000) / 10 : 0,
        totalBoxes: parseInt(c.TOTALBOXES) || 0,
        numOrders: parseInt(c.NUMORDERS) || 0,
        numProducts: parseInt(c.NUMPRODUCTS) || 0
      }))
    });
  } catch (error) {
    logger.error(`Top Clients error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo clientes top', details: error.message });
  }
});

// =============================================================================
// PRODUCTS LIST
// =============================================================================
app.get('/api/products', async (req, res) => {
  try {
    const { search, limit = 50, offset = 0 } = req.query;

    let searchFilter = '';
    if (search) {
      const safeSearch = search.replace(/'/g, "''").trim().toUpperCase();
      searchFilter = `AND(UPPER(DESCRIPCIONARTICULO) LIKE '%${safeSearch}%' 
                      OR CODIGOARTICULO LIKE '%${safeSearch}%'
                      OR UPPER(CODIGOMARCA) LIKE '%${safeSearch}%')`;
    }

    const products = await query(`
      SELECT CODIGOARTICULO as code, DESCRIPCIONARTICULO as name,
  CODIGOMARCA as brand, CODIGOFAMILIA as family,
  UNIDADESCAJA as unitsPerBox, PESO as weight
      FROM DSEDAC.ART
      WHERE ANOBAJA = 0 ${searchFilter}
      ORDER BY DESCRIPCIONARTICULO
      OFFSET ${parseInt(offset)} ROWS
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `);

    res.json({
      products: products.map(p => ({
        code: p.CODE?.trim(),
        name: p.NAME?.trim() || 'Sin nombre',
        brand: p.BRAND?.trim(),
        family: p.FAMILY?.trim(),
        unitsPerBox: parseInt(p.UNITSPERBOX) || 1,
        weight: parseFloat(p.WEIGHT) || 0
      })),
      hasMore: products.length === parseInt(limit)
    });

  } catch (error) {
    logger.error(`Products error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo productos', details: error.message });
  }
});

// =============================================================================
// VENDEDORES LIST
// =============================================================================
app.get('/api/vendedores', async (req, res) => {
  try {
    const now = getCurrentDate();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);

    const vendedores = await query(`
SELECT
V.CODIGOVENDEDOR as code,
  V.TIPOVENDEDOR as type,
  X.CORREOELECTRONICO as email,
  X.JEFEVENTASSN as isJefe,
  COALESCE(S.TOTAL_VENTAS, 0) as totalSales,
  COALESCE(S.TOTAL_MARGEN, 0) as totalMargin,
  COALESCE(S.TOTAL_ENVASES, 0) as totalBoxes,
  COALESCE(S.TOTAL_CLIENTES, 0) as totalClients
      FROM DSEDAC.VDC V
      LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
      LEFT JOIN(
    SELECT CODIGOVENDEDOR,
    SUM(IMPORTEVENTA) as TOTAL_VENTAS,
    SUM(IMPORTEMARGENREAL) as TOTAL_MARGEN,
    SUM(CANTIDADENVASES) as TOTAL_ENVASES,
    COUNT(DISTINCT CODIGOCLIENTEALBARAN) as TOTAL_CLIENTES
        FROM DSEDAC.LINDTO WHERE ANODOCUMENTO = ${year} AND MESDOCUMENTO = ${month}
        GROUP BY CODIGOVENDEDOR
  ) S ON TRIM(V.CODIGOVENDEDOR) = TRIM(S.CODIGOVENDEDOR)
      WHERE V.SUBEMPRESA = 'GMP'
      ORDER BY COALESCE(S.TOTAL_VENTAS, 0) DESC
    `);

    res.json({
      period: { year, month },
      vendedores: vendedores.map(v => ({
        code: v.CODE?.trim(),
        type: v.TYPE?.trim() || '-',
        email: v.EMAIL?.trim(),
        isJefe: v.ISJEFE === 'S',
        totalSales: formatCurrency(v.TOTALSALES),
        totalMargin: formatCurrency(v.TOTALMARGIN),
        totalBoxes: parseInt(v.TOTALBOXES) || 0,
        totalClients: parseInt(v.TOTALCLIENTS) || 0
      }))
    });

  } catch (error) {
    logger.error(`Vendedores error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo vendedores', details: error.message });
  }
});

// =============================================================================
// ANALYTICS - MARGIN ANALYSIS
// =============================================================================
app.get('/api/analytics/margins', async (req, res) => {
  try {
    const { vendedorCodes } = req.query;
    const now = getCurrentDate();
    const year = parseInt(req.query.year) || now.getFullYear();
    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    // Monthly margin evolution
    const monthlyMargins = await query(`
      SELECT MESDOCUMENTO as month,
  SUM(IMPORTEVENTA) as sales,
  SUM(IMPORTEMARGENREAL) as margin
      FROM DSEDAC.LINDTO
      WHERE ANODOCUMENTO = ${year} ${vendedorFilter}
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
  `);

    // Margin by product family
    const familyMargins = await query(`
      SELECT COALESCE(A.CODIGOFAMILIA, 'SIN FAM') as family,
  SUM(L.IMPORTEVENTA) as sales,
  SUM(L.IMPORTEMARGENREAL) as margin
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.ART A ON TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
      WHERE L.ANODOCUMENTO = ${year} ${vendedorFilter}
      GROUP BY A.CODIGOFAMILIA
      ORDER BY sales DESC
      FETCH FIRST 10 ROWS ONLY
    `);

    res.json({
      year,
      monthlyMargins: monthlyMargins.map(m => ({
        month: m.MONTH,
        sales: formatCurrency(m.SALES),
        margin: formatCurrency(m.MARGIN),
        marginPercent: m.SALES > 0 ? Math.round((m.MARGIN / m.SALES) * 1000) / 10 : 0
      })),
      familyMargins: familyMargins.map(f => ({
        family: f.FAMILY?.trim() || 'Sin familia',
        sales: formatCurrency(f.SALES),
        margin: formatCurrency(f.MARGIN),
        marginPercent: f.SALES > 0 ? Math.round((f.MARGIN / f.SALES) * 1000) / 10 : 0
      }))
    });

  } catch (error) {
    logger.error(`Margins error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo márgenes', details: error.message });
  }
});

// =============================================================================
// ANALYTICS - TREND PREDICTIONS (Moving Average)
// =============================================================================
app.get('/api/analytics/trends', async (req, res) => {
  try {
    const { vendedorCodes } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    // Use CVC for consistent sales data (Facturación Real)
    // Get last 24 months to detect seasonality
    const monthlyData = await query(`
SELECT
ANOEMISION as year,
  MESEMISION as month,
  SUM(IMPORTEVENCIMIENTO) as sales
      FROM DSEDAC.CVC
      JOIN DSEDAC.VDC V ON TRIM(V.CODIGOVENDEDOR) = TRIM(DSEDAC.CVC.CODIGOVENDEDOR)
      WHERE ANOEMISION >= 2023 AND V.SUBEMPRESA = 'GMP' ${vendedorFilter}
      GROUP BY ANOEMISION, MESEMISION
      ORDER BY ANOEMISION ASC, MESEMISION ASC
    `);

    // Process data for analysis
    const salesData = monthlyData.map(m => ({
      year: m.YEAR,
      month: m.MONTH,
      period: `${m.YEAR} -${String(m.MONTH).padStart(2, '0')} `,
      sales: parseFloat(m.SALES) || 0
    }));

    if (salesData.length < 12) {
      // Not enough data for meaningful prediction, create simple fallback
      const predictions = [];
      if (salesData.length > 0) {
        const lastPoint = salesData[salesData.length - 1];
        const avgSales = salesData.reduce((sum, m) => sum + m.sales, 0) / salesData.length;

        for (let i = 1; i <= 3; i++) {
          let nextMonth = lastPoint.month + i;
          let nextYear = lastPoint.year;
          if (nextMonth > 12) { nextMonth -= 12; nextYear++; }
          predictions.push({
            year: nextYear,
            month: nextMonth,
            period: `${nextYear} -${String(nextMonth).padStart(2, '0')} `,
            predictedSales: Math.round(avgSales * 100) / 100,
            confidence: 0.5
          });
        }
      }

      res.json({
        historical: salesData.slice(-6),
        predictions: predictions,
        trend: 'stable',
        avgMonthlyGrowth: 0
      });
      return;
    }

    // 1. Calculate Recent Trend (Last 3 months vs Previous 3 months)
    const last3Months = salesData.slice(-3);
    const prev3Months = salesData.slice(-6, -3);

    const avgLast3 = last3Months.reduce((sum, m) => sum + m.sales, 0) / 3;
    const avgPrev3 = prev3Months.reduce((sum, m) => sum + m.sales, 0) / 3;

    // Trend factor (e.g., 1.05 means 5% growth) - capped at +/- 20% to avoid extreme predictions
    let trendFactor = avgPrev3 > 0 ? avgLast3 / avgPrev3 : 1.0;
    trendFactor = Math.max(0.8, Math.min(1.2, trendFactor));

    // 2. Generate Predictions based on Seasonality (Same month last year * Trend Factor)
    const predictions = [];
    const lastPoint = salesData[salesData.length - 1];

    for (let i = 1; i <= 3; i++) {
      let nextMonth = lastPoint.month + i;
      let nextYear = lastPoint.year;
      if (nextMonth > 12) { nextMonth -= 12; nextYear++; }

      // Find same month last year (or 2 years ago if data allows, prioritize last year)
      const sameMonthLastYear = salesData.find(d => d.year === nextYear - 1 && d.month === nextMonth);

      let predictedSales = 0;
      if (sameMonthLastYear) {
        predictedSales = sameMonthLastYear.sales * trendFactor;
      } else {
        // Fallback to simple moving average if no historical data for that month
        predictedSales = avgLast3;
      }

      predictions.push({
        year: nextYear,
        month: nextMonth,
        period: `${nextYear} -${String(nextMonth).padStart(2, '0')} `,
        predictedSales: Math.round(predictedSales * 100) / 100,
        confidence: Math.max(0.4, 0.85 - (i * 0.1)) // Confidence drops over time
      });
    }

    // Determine visual trend text
    const trendSlope = avgPrev3 > 0 ? (avgLast3 - avgPrev3) / avgPrev3 : 0;
    let trendText = 'stable';
    if (trendSlope > 0.05) trendText = 'upward';
    if (trendSlope < -0.05) trendText = 'downward';

    res.json({
      historical: salesData.slice(-6), // Show last 6 months history
      predictions,
      trend: trendText,
      avgMonthlyGrowth: trendSlope * 100 // Percentage
    });

  } catch (error) {
    logger.error(`Trends error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo tendencias', details: error.message });
  }
});

// =============================================================================
// CLIENT COMPARISON
// =============================================================================
app.get('/api/clients/compare', async (req, res) => {
  try {
    const { codes, vendedorCodes } = req.query;
    if (!codes) {
      return res.status(400).json({ error: 'Se requieren códigos de cliente (codes=CLI1,CLI2)' });
    }

    const clientCodes = codes.split(',').map(c => `'${c.trim()}'`).join(',');
    const now = getCurrentDate();
    const year = now.getFullYear();
    const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

    // Get comparison data for each client
    const comparison = await query(`
SELECT
L.CODIGOCLIENTEALBARAN as code,
  MIN(C.NOMBRECLIENTE) as name,
  MIN(C.POBLACION) as city,
  SUM(L.IMPORTEVENTA) as totalSales,
  SUM(L.IMPORTEMARGENREAL) as totalMargin,
  SUM(L.CANTIDADENVASES) as totalBoxes,
  COUNT(DISTINCT L.ANODOCUMENTO || '-' || L.MESDOCUMENTO) as activeMonths,
  COUNT(DISTINCT L.CODIGOARTICULO) as uniqueProducts,
  AVG(L.IMPORTEVENTA) as avgOrderValue,
  MIN(L.ANODOCUMENTO * 100 + L.MESDOCUMENTO) as firstPurchase,
  MAX(L.ANODOCUMENTO * 100 + L.MESDOCUMENTO) as lastPurchase
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      WHERE L.CODIGOCLIENTEALBARAN IN(${clientCodes})
        AND L.ANODOCUMENTO >= ${MIN_YEAR} ${vendedorFilter}
      GROUP BY L.CODIGOCLIENTEALBARAN
  `);

    // Get monthly breakdown for each client
    const monthlyBreakdown = await query(`
SELECT
CODIGOCLIENTEALBARAN as code,
  ANODOCUMENTO as year,
  MESDOCUMENTO as month,
  SUM(IMPORTEVENTA) as sales
      FROM DSEDAC.LINDTO
      WHERE CODIGOCLIENTEALBARAN IN(${clientCodes})
        AND ANODOCUMENTO >= ${year - 1} ${vendedorFilter}
      GROUP BY CODIGOCLIENTEALBARAN, ANODOCUMENTO, MESDOCUMENTO
      ORDER BY ANODOCUMENTO, MESDOCUMENTO
  `);

    const clientsData = comparison.map(c => ({
      code: c.CODE?.trim(),
      name: c.NAME?.trim() || 'Sin nombre',
      city: c.CITY?.trim(),
      totalSales: formatCurrency(c.TOTALSALES),
      totalMargin: formatCurrency(c.TOTALMARGIN),
      marginPercent: c.TOTALSALES > 0 ? Math.round((c.TOTALMARGIN / c.TOTALSALES) * 1000) / 10 : 0,
      totalBoxes: parseInt(c.TOTALBOXES) || 0,
      activeMonths: parseInt(c.ACTIVEMONTHS) || 0,
      uniqueProducts: parseInt(c.UNIQUEPRODUCTS) || 0,
      avgOrderValue: formatCurrency(c.AVGORDERVALUE),
      monthly: monthlyBreakdown
        .filter(m => m.CODE?.trim() === c.CODE?.trim())
        .map(m => ({
          period: `${m.YEAR} -${String(m.MONTH).padStart(2, '0')} `,
          sales: formatCurrency(m.SALES)
        }))
    }));

    res.json({ clients: clientsData });

  } catch (error) {
    logger.error(`Client compare error: ${error.message} `);
    res.status(500).json({ error: 'Error comparando clientes', details: error.message });
  }
});

// =============================================================================
// EXPORT DATA (for PDF generation)
// =============================================================================
app.get('/api/export/client-report', async (req, res) => {
  try {
    const { code, vendedorCodes } = req.query;
    if (!code) {
      return res.status(400).json({ error: 'Se requiere código de cliente' });
    }

    const safeCode = code.replace(/'/g, "''").trim();
    const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

    // Get complete client data for PDF report
    const [clientInfo] = await query(`
      SELECT CODIGOCLIENTE as code, NOMBRECLIENTE as name, NIF as nif,
  DIRECCION as address, POBLACION as city, PROVINCIA as province,
  CODIGOPOSTAL as postalCode, TELEFONO1 as phone, CODIGORUTA as route
      FROM DSEDAC.CLI WHERE CODIGOCLIENTE = '${safeCode}'
  `);

    // Yearly summary
    const yearlySummary = await query(`
      SELECT ANODOCUMENTO as year,
  SUM(IMPORTEVENTA) as sales,
  SUM(IMPORTEMARGENREAL) as margin,
  SUM(CANTIDADENVASES) as boxes,
  COUNT(DISTINCT MESDOCUMENTO) as activeMonths
      FROM DSEDAC.LINDTO
      WHERE CODIGOCLIENTEALBARAN = '${safeCode}' 
        AND ANODOCUMENTO >= ${MIN_YEAR} ${vendedorFilter}
      GROUP BY ANODOCUMENTO
      ORDER BY ANODOCUMENTO
  `);

    // Top 10 products
    const topProducts = await query(`
      SELECT L.CODIGOARTICULO as code,
  COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION), 'Producto') as name,
  SUM(L.IMPORTEVENTA) as sales,
  SUM(L.CANTIDADENVASES) as boxes,
  COUNT(*) as orders
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.ART A ON TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
      WHERE L.CODIGOCLIENTEALBARAN = '${safeCode}' 
        AND L.ANODOCUMENTO >= ${MIN_YEAR} ${vendedorFilter}
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION
      ORDER BY sales DESC
      FETCH FIRST 10 ROWS ONLY
    `);

    res.json({
      exportDate: new Date().toISOString(),
      client: clientInfo ? {
        code: clientInfo.CODE?.trim(),
        name: clientInfo.NAME?.trim(),
        nif: clientInfo.NIF?.trim(),
        address: clientInfo.ADDRESS?.trim(),
        city: clientInfo.CITY?.trim(),
        province: clientInfo.PROVINCE?.trim(),
        phone: clientInfo.PHONE?.trim(),
        route: clientInfo.ROUTE?.trim()
      } : null,
      yearlySummary: yearlySummary.map(y => ({
        year: y.YEAR,
        sales: formatCurrency(y.SALES),
        margin: formatCurrency(y.MARGIN),
        boxes: parseInt(y.BOXES) || 0,
        activeMonths: parseInt(y.ACTIVEMONTHS) || 0
      })),
      topProducts: topProducts.map(p => ({
        code: p.CODE?.trim(),
        name: p.NAME?.trim(),
        sales: formatCurrency(p.SALES),
        boxes: parseInt(p.BOXES) || 0,
        orders: parseInt(p.ORDERS) || 0
      }))
    });

  } catch (error) {
    logger.error(`Export error: ${error.message} `);
    res.status(500).json({ error: 'Error exportando datos', details: error.message });
  }
});

// =============================================================================
// SALES HISTORY EXPLORER (Detailed Product Sales)
// =============================================================================
app.get('/api/sales-history', async (req, res) => {
  try {
    const {
      vendedorCodes,
      clientCode,
      productSearch,
      startDate,
      endDate,
      limit = 100,
      offset = 0
    } = req.query;

    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    let whereClause = `WHERE 1=1 ${vendedorFilter}`;

    // Filter by Client
    if (clientCode) {
      whereClause += ` AND CODIGOCLIENTEALBARAN = '${clientCode.trim()}'`;
    }

    // Filter by Product (Code or Description) or Batch/Reference
    if (productSearch) {
      const term = productSearch.toUpperCase().trim();
      // DB2 LIKE is case sensitive usually, ensure upper if data is upper
      whereClause += ` AND (UPPER(DESCRIPCION) LIKE '%${term}%' OR CODIGOARTICULO LIKE '%${term}%' OR REFERENCIA LIKE '%${term}%')`;
    }

    // Filter by Date Range (YYYY-MM-DD)
    // Construct simplified integer date YYYYMMDD for comparison if possible, or individual fields
    if (startDate) {
      const start = new Date(startDate);
      const startNum = start.getFullYear() * 10000 + (start.getMonth() + 1) * 100 + start.getDate();
      whereClause += ` AND (ANODOCUMENTO * 10000 + MESDOCUMENTO * 100 + DIADOCUMENTO) >= ${startNum}`;
    }

    if (endDate) {
      const end = new Date(endDate);
      const endNum = end.getFullYear() * 10000 + (end.getMonth() + 1) * 100 + end.getDate();
      whereClause += ` AND (ANODOCUMENTO * 10000 + MESDOCUMENTO * 100 + DIADOCUMENTO) <= ${endNum}`;
    } else {
      // Validation: if no end date, maybe limit to recent years to avoid huge scans if no client selected?
      // But limit 100 helps.
      whereClause += ` AND ANODOCUMENTO >= ${MIN_YEAR}`;
    }

    const querySql = `
      SELECT 
        ANODOCUMENTO as year, 
        MESDOCUMENTO as month, 
        DIADOCUMENTO as day,
        CODIGOCLIENTEALBARAN as clientCode,
        CODIGOARTICULO as productCode,
        DESCRIPCION as productName,
        IMPORTEVENTA as total,
        PRECIOVENTA as price,
        CANTIDADUNIDADES as quantity,
        TRAZABILIDADALBARAN as lote,
        REFERENCIA as ref,
        NUMERODOCUMENTO as invoice
      FROM DSEDAC.LAC
      ${whereClause}
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
      OFFSET ${offset} ROWS
      FETCH FIRST ${limit} ROWS ONLY
    `;

    const rows = await query(querySql);

    // Format for frontend
    const formattedRows = rows.map(r => ({
      date: `${r.YEAR}-${String(r.MONTH).padStart(2, '0')}-${String(r.DAY).padStart(2, '0')}`,
      year: r.YEAR,
      month: r.MONTH,
      clientCode: r.CLIENTCODE?.trim(),
      productCode: r.PRODUCTCODE?.trim(),
      productName: r.PRODUCTNAME?.trim(),
      price: formatCurrency(r.PRICE),
      quantity: parseFloat(r.QUANTITY) || 0,
      total: formatCurrency(r.TOTAL),
      lote: r.LOTE?.trim() || '',
      ref: r.REF?.trim() || '',
      invoice: r.INVOICE?.trim()
    }));

    res.json({
      rows: formattedRows,
      count: formattedRows.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    logger.error(`Sales history error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo histórico de ventas', details: error.message });
  }
});

// =============================================================================
// OBJECTIVES EVOLUTION - Optimized multi-year monthly data
// =============================================================================
app.get('/api/objectives/evolution', async (req, res) => {
  try {
    const { vendedorCodes, years } = req.query;
    const now = getCurrentDate();

    // Parse years - default to current year
    const yearsArray = years ? years.split(',').map(y => parseInt(y.trim())).filter(y => y >= MIN_YEAR) : [now.getFullYear()];

    // Include previous years for dynamic objective calculation
    const allYears = [...yearsArray, ...yearsArray.map(y => y - 1)];
    const uniqueYears = [...new Set(allYears)];
    const yearsFilter = uniqueYears.join(',');

    const vendedorFilter = buildVendedorFilter(vendedorCodes);

    // Single optimized query - get monthly totals per year
    const rows = await query(`
      SELECT 
        L.ANODOCUMENTO as YEAR,
        L.MESDOCUMENTO as MONTH,
        SUM(L.IMPORTEVENTA) as SALES,
        SUM(L.IMPORTECOSTO) as COST,
        COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) as CLIENTS
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
        AND C.CCYEAB = L.LCYEAB 
        AND C.CCSRAB = L.LCSRAB 
        AND C.CCTRAB = L.LCTRAB 
        AND C.CCNRAB = L.LCNRAB
      WHERE L.ANODOCUMENTO IN (${yearsFilter})
        -- Matrix consistency filters
        AND L.LCTPVT <> 'SC'
        AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
        AND COALESCE(C.CCSNSD, '') <> 'E'
        ${vendedorFilter.replace(/CODIGOVENDEDOR/g, 'L.CODIGOVENDEDOR')}
      GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO
      ORDER BY L.ANODOCUMENTO, L.MESDOCUMENTO
    `);

    // Organize by year
    const yearlyData = {};
    const yearTotals = {};

    yearsArray.forEach(year => {
      // Calculate Annual Objective first: Total Previous Year Sales * 1.10
      let prevYearTotal = 0;
      let currentYearTotalSoFar = 0;

      const dataLog = [];
      for (let m = 1; m <= 12; m++) {
        const row = rows.find(r => r.YEAR == year && r.MONTH == m); // Loose equality
        const prevRow = rows.find(r => r.YEAR == (year - 1) && r.MONTH == m);

        if (prevRow) prevYearTotal += parseFloat(prevRow.SALES) || 0;
        if (row) currentYearTotalSoFar += parseFloat(row.SALES) || 0;

        // Debug first month to see what we found
        if (m === 1) {
          console.log(`[DEBUG] Year ${year} Month 1 - Found Row:`, row ? `${row.YEAR} Sales: ${row.SALES}` : 'None');
        }
      }

      const annualObjective = prevYearTotal > 0 ? prevYearTotal * 1.10 : (currentYearTotalSoFar > 0 ? currentYearTotalSoFar * 1.10 : 0);
      console.log(`[DEBUG] Year: ${year}, PrevTotal: ${prevYearTotal}, CurrentTotal: ${currentYearTotalSoFar}, AnnualObj: ${annualObjective}`);
      const monthlyObjective = annualObjective / 12;

      yearlyData[year] = [];

      for (let m = 1; m <= 12; m++) {
        const row = rows.find(r => r.YEAR == year && r.MONTH == m);
        const sales = row ? parseFloat(row.SALES) || 0 : 0;
        const cost = row ? parseFloat(row.COST) || 0 : 0;
        const clients = row ? parseInt(row.CLIENTS) || 0 : 0;

        yearlyData[year].push({
          month: m,
          sales: sales,
          cost: cost,
          margin: sales - cost,
          clients: clients,
          objective: monthlyObjective // Flat monthly value
        });
      }

      const data = yearlyData[year];
      yearTotals[year] = {
        totalSales: data.reduce((sum, m) => sum + m.sales, 0),
        totalCost: data.reduce((sum, m) => sum + m.cost, 0),
        totalMargin: data.reduce((sum, m) => sum + m.margin, 0),
        annualObjective: annualObjective
      };
    });

    res.json({
      years: yearsArray,
      yearlyData,
      yearTotals,
      monthNames: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    });

  } catch (error) {
    logger.error(`Objectives evolution error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo evolución de objetivos', details: error.message });
  }
});

// =============================================================================
// OBJECTIVES MATRIX - Client purchase history by product family
// =============================================================================
app.get('/api/objectives/matrix', async (req, res) => {
  try {
    const {
      clientCode, years, startMonth = '1', endMonth = '12',
      productCode, productName, familyCode, subfamilyCode
    } = req.query;

    if (!clientCode) {
      return res.status(400).json({ error: 'clientCode is required' });
    }

    // Parse years and range
    const yearsArray = years ? years.split(',').map(y => parseInt(y.trim())).filter(y => y >= 2015) : [new Date().getFullYear()];
    const monthStart = parseInt(startMonth);
    const monthEnd = parseInt(endMonth);

    // Determine years to fetch (include previous year for YoY if needed)
    const allYearsToFetch = new Set(yearsArray);
    yearsArray.forEach(y => allYearsToFetch.add(y - 1));
    const yearsFilter = Array.from(allYearsToFetch).join(',');

    // Build filter conditions
    let filterConditions = '';
    if (productCode && productCode.trim()) {
      filterConditions += ` AND UPPER(L.CODIGOARTICULO) LIKE '%${productCode.trim().toUpperCase()}%'`;
    }
    if (productName && productName.trim()) {
      filterConditions += ` AND (UPPER(A.DESCRIPCIONARTICULO) LIKE '%${productName.trim().toUpperCase()}%' OR UPPER(L.DESCRIPCION) LIKE '%${productName.trim().toUpperCase()}%')`;
    }
    if (familyCode && familyCode.trim()) {
      filterConditions += ` AND A.CODIGOFAMILIA = '${familyCode.trim()}'`;
    }
    if (subfamilyCode && subfamilyCode.trim()) {
      filterConditions += ` AND A.CODIGOSUBFAMILIA = '${subfamilyCode.trim()}'`;
    }

    // Get product purchases for this client
    const rows = await query(`
      SELECT 
        L.CODIGOARTICULO as PRODUCT_CODE,
        COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION)) as PRODUCT_NAME,
        COALESCE(A.CODIGOFAMILIA, 'SIN_FAM') as FAMILY_CODE,
        COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') as SUBFAMILY_CODE,
        COALESCE(TRIM(A.UNIDADMEDIDA), 'UDS') as UNIT_TYPE,
        L.ANODOCUMENTO as YEAR,
        L.MESDOCUMENTO as MONTH,
        SUM(L.IMPORTEVENTA) as SALES,
        SUM(L.IMPORTECOSTO) as COST,
        SUM(L.CANTIDADUNIDADES) as UNITS,
        -- Discount detection AND details
        SUM(CASE WHEN L.PRECIOTARIFACLIENTE <> 0 AND L.PRECIOTARIFA01 <> 0 
                  AND L.PRECIOTARIFACLIENTE <> L.PRECIOTARIFA01 THEN 1 ELSE 0 END) as HAS_SPECIAL_PRICE,
        SUM(CASE WHEN L.PORCENTAJEDESCUENTO <> 0 OR L.IMPORTEDESCUENTOUNIDAD <> 0 THEN 1 ELSE 0 END) as HAS_DISCOUNT,
        AVG(CASE WHEN L.PORCENTAJEDESCUENTO <> 0 THEN L.PORCENTAJEDESCUENTO ELSE NULL END) as AVG_DISCOUNT_PCT,
        AVG(CASE WHEN L.IMPORTEDESCUENTOUNIDAD <> 0 THEN L.IMPORTEDESCUENTOUNIDAD ELSE NULL END) as AVG_DISCOUNT_EUR,
        -- Average prices for comparison
        AVG(L.PRECIOTARIFACLIENTE) as AVG_CLIENT_TARIFF,
        AVG(L.PRECIOTARIFA01) as AVG_BASE_TARIFF
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
      LEFT JOIN DSEDAC.CAC C ON C.CCSBAB = L.LCSBAB 
        AND C.CCYEAB = L.LCYEAB 
        AND C.CCSRAB = L.LCSRAB 
        AND C.CCTRAB = L.LCTRAB 
        AND C.CCNRAB = L.LCNRAB
      WHERE L.CODIGOCLIENTEALBARAN = '${clientCode}'
        AND L.ANODOCUMENTO IN(${yearsFilter})
        AND L.MESDOCUMENTO BETWEEN ${monthStart} AND ${monthEnd}
        -- FILTERS to match LACLAE logic
        AND L.LCTPVT <> 'SC'                                -- Exclude Sin Cargo (SC)
        AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')            -- Exclude internal Series
        AND COALESCE(C.CCSNSD, '') <> 'E'                   -- Exclude LAE documents
        ${filterConditions}
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION, A.CODIGOFAMILIA, A.CODIGOSUBFAMILIA, A.UNIDADMEDIDA, L.ANODOCUMENTO, L.MESDOCUMENTO
      ORDER BY SALES DESC
    `);

    // Get family names and available filters properly
    const familyNames = {};
    const subfamilyNames = {};

    // Logic to build distinct filter lists based on ACTUAL data found
    const availableFamiliesMap = new Map();
    const availableSubfamiliesMap = new Map();

    try {
      // 1. Load Name Maps
      const famRows = await query(`SELECT CODIGOFAMILIA, DESCRIPCIONFAMILIA FROM DSEDAC.FAM`);
      famRows.forEach(r => { familyNames[r.CODIGOFAMILIA?.trim()] = r.DESCRIPCIONFAMILIA?.trim() || r.CODIGOFAMILIA?.trim(); });
      // SFM Empty

    } catch (e) {
      logger.warn(`Could not load family names: ${e.message}`);
    }

    // Build hierarchy: Family -> Subfamily -> Product
    const familyMap = new Map();
    let grandTotalSales = 0, grandTotalCost = 0, grandTotalUnits = 0;
    const productSet = new Set();

    // Monthly YoY Calculation
    const monthlyStats = new Map();
    for (let m = 1; m <= 12; m++) monthlyStats.set(m, { currentSales: 0, prevSales: 0, currentUnits: 0 });

    const isSelectedYear = (y) => yearsArray.includes(y);
    const isPrevYear = (y) => yearsArray.some(selected => selected - 1 === y);

    rows.forEach(row => {
      const famCode = row.FAMILY_CODE?.trim() || 'SIN_FAM';
      const subfamCode = row.SUBFAMILY_CODE?.trim() || 'General';
      const prodCode = row.PRODUCT_CODE?.trim() || '';
      const prodName = row.PRODUCT_NAME?.trim() || 'Sin nombre';
      const unitType = row.UNIT_TYPE?.trim() || 'UDS';
      const year = parseInt(row.YEAR);
      const month = parseInt(row.MONTH);
      const sales = parseFloat(row.SALES) || 0;
      const cost = parseFloat(row.COST) || 0;
      const units = parseFloat(row.UNITS) || 0;

      const hasSpecialPrice = parseInt(row.HAS_SPECIAL_PRICE) > 0;
      const hasDiscount = parseInt(row.HAS_DISCOUNT) > 0;
      const avgDiscountPct = parseFloat(row.AVG_DISCOUNT_PCT) || 0;
      const avgDiscountEur = parseFloat(row.AVG_DISCOUNT_EUR) || 0;

      const avgClientTariff = parseFloat(row.AVG_CLIENT_TARIFF) || 0;
      const avgBaseTariff = parseFloat(row.AVG_BASE_TARIFF) || 0;

      // Populate Distinct Filter Maps
      if (!availableFamiliesMap.has(famCode)) {
        availableFamiliesMap.set(famCode, {
          code: famCode,
          name: familyNames[famCode] ? `${famCode} - ${familyNames[famCode]}` : famCode
        });
      }
      if (!availableSubfamiliesMap.has(subfamCode)) {
        availableSubfamiliesMap.set(subfamCode, {
          code: subfamCode,
          name: subfamilyNames[subfamCode] ? `${subfamCode} - ${subfamilyNames[subfamCode]}` : subfamCode
        });
      }

      // Update Monthly Stats
      const mStat = monthlyStats.get(month);
      if (isSelectedYear(year)) {
        mStat.currentSales += sales;
        mStat.currentUnits += units;
      } else if (isPrevYear(year)) {
        mStat.prevSales += sales;
      }

      // Only add to Grand Totals if it's a Selected Year
      if (isSelectedYear(year)) {
        grandTotalSales += sales;
        grandTotalCost += cost;
        grandTotalUnits += units;
        productSet.add(prodCode);
      }

      // Add to hierarchy
      if (isSelectedYear(year) || isPrevYear(year)) {
        // Family
        if (!familyMap.has(famCode)) {
          familyMap.set(famCode, {
            familyCode: famCode,
            familyName: familyNames[famCode] ? `${famCode} - ${familyNames[famCode]}` : famCode,
            totalSales: 0, totalCost: 0, totalUnits: 0,
            subfamilies: new Map()
          });
        }
        const family = familyMap.get(famCode);

        if (isSelectedYear(year)) {
          family.totalSales += sales;
          family.totalCost += cost;
          family.totalUnits += units;
        }

        // Subfamily
        const subfamName = subfamilyNames[subfamCode] ? `${subfamCode} - ${subfamilyNames[subfamCode]}` : subfamCode;
        if (!family.subfamilies.has(subfamCode)) {
          family.subfamilies.set(subfamCode, {
            subfamilyCode: subfamCode,
            subfamilyName: subfamName,
            totalSales: 0, totalCost: 0, totalUnits: 0,
            products: new Map()
          });
        }
        const subfamily = family.subfamilies.get(subfamCode);

        if (isSelectedYear(year)) {
          subfamily.totalSales += sales;
          subfamily.totalCost += cost;
          subfamily.totalUnits += units;
        }

        // Product
        if (!subfamily.products.has(prodCode)) {
          subfamily.products.set(prodCode, {
            productCode: prodCode,
            productName: prodName,
            unitType: unitType,
            totalSales: 0, totalCost: 0, totalUnits: 0,
            prevYearSales: 0, prevYearCost: 0, prevYearUnits: 0,
            hasDiscount: false, hasSpecialPrice: false,
            avgDiscountPct: 0, avgDiscountEur: 0,
            avgClientTariff: 0, avgBaseTariff: 0,
            monthlyData: {}
          });
        }
        const product = subfamily.products.get(prodCode);

        if (isSelectedYear(year)) {
          product.totalSales += sales;
          product.totalCost += cost;
          product.totalUnits += units;

          if (hasDiscount) product.hasDiscount = true;
          if (avgDiscountPct > 0) product.avgDiscountPct = avgDiscountPct;
          if (avgDiscountEur > 0) product.avgDiscountEur = avgDiscountEur;

          if (hasSpecialPrice) product.hasSpecialPrice = true;
          if (avgClientTariff > 0) product.avgClientTariff = avgClientTariff;
          if (avgBaseTariff > 0) product.avgBaseTariff = avgBaseTariff;
        } else if (isPrevYear(year)) {
          product.prevYearSales += sales;
          product.prevYearCost += cost;
          product.prevYearUnits += units;
        }

        // Product Monthly Data
        if (!product.monthlyData[year]) product.monthlyData[year] = {};
        if (!product.monthlyData[year][month]) product.monthlyData[year][month] = {
          sales: 0, units: 0, avgDiscountPct: 0, avgDiscountEur: 0
        };
        product.monthlyData[year][month].sales += sales;
        product.monthlyData[year][month].units += units;
        if (avgDiscountPct > 0) product.monthlyData[year][month].avgDiscountPct = avgDiscountPct;
        if (avgDiscountEur > 0) product.monthlyData[year][month].avgDiscountEur = avgDiscountEur;
      }
    });

    // Helper
    const getSalesForKey = (keyCode, filterFn) => {
      let total = 0;
      rows.forEach(r => {
        if (filterFn(r) && isPrevYear(parseInt(r.YEAR))) {
          total += (parseFloat(r.SALES) || 0);
        }
      });
      return total;
    };

    // Construct Flat Monthly Totals Response
    const flatMonthlyTotals = {};
    monthlyStats.forEach((val, month) => {
      const variation = val.prevSales > 0 ? ((val.currentSales - val.prevSales) / val.prevSales) * 100 : null;
      let yoyTrend = 'neutral';
      if (val.prevSales > 0) {
        if (val.currentSales > val.prevSales) yoyTrend = 'up';
        else if (val.currentSales < val.prevSales) yoyTrend = 'down';
      }

      flatMonthlyTotals[month] = {
        sales: val.currentSales,
        units: val.currentUnits,
        prevSales: val.prevSales,
        yoyVariation: variation !== null ? parseFloat(variation.toFixed(1)) : null,
        yoyTrend: yoyTrend
      };
    });

    // Finalize Structure
    const families = Array.from(familyMap.values()).map(f => {
      const subfamilies = Array.from(f.subfamilies.values()).map(s => {
        const products = Array.from(s.products.values()).map(p => {
          const prevSales = getSalesForKey(p.productCode, r => r.PRODUCT_CODE === p.productCode);
          const variation = prevSales > 0 ? ((p.totalSales - prevSales) / prevSales) * 100 : 0;

          let yoyTrend = 'neutral';
          if (variation > 5) yoyTrend = 'up';
          if (variation < -5) yoyTrend = 'down';

          const margin = p.totalSales - p.totalCost;
          const marginPercent = p.totalSales > 0 ? (margin / p.totalSales) * 100 : 0;
          const avgPrice = p.totalUnits > 0 ? (p.totalSales / p.totalUnits) : 0;
          const avgCost = p.totalUnits > 0 ? (p.totalCost / p.totalUnits) : 0;
          const marginPerUnit = avgPrice - avgCost;
          const prevAvgPrice = p.prevYearUnits > 0 ? p.prevYearSales / p.prevYearUnits : 0;

          // Flatten Monthly Data
          const flatMonthly = {};
          for (let m = 1; m <= 12; m++) {
            flatMonthly[m.toString()] = { selectedSales: 0, selectedUnits: 0, prevSales: 0, prevUnits: 0 };
          }
          Object.keys(p.monthlyData).forEach(yearStr => {
            const y = parseInt(yearStr);
            const mData = p.monthlyData[yearStr];
            Object.keys(mData).forEach(mStr => {
              if (isSelectedYear(y)) {
                flatMonthly[mStr].selectedSales += mData[mStr].sales || 0;
                flatMonthly[mStr].selectedUnits += mData[mStr].units || 0;
              } else if (isPrevYear(y)) {
                flatMonthly[mStr].prevSales += mData[mStr].sales || 0;
                flatMonthly[mStr].prevUnits += mData[mStr].units || 0;
              }
            });
          });

          const monthlyOutput = {};
          Object.keys(flatMonthly).forEach(mStr => {
            const d = flatMonthly[mStr];
            let mTrend = 'neutral';
            let mVar = 0;
            if (d.prevSales > 0) {
              mVar = ((d.selectedSales - d.prevSales) / d.prevSales) * 100;
              if (mVar > 5) mTrend = 'up'; else if (mVar < -5) mTrend = 'down';
            } else if (d.selectedSales > 0) mTrend = 'up';

            monthlyOutput[mStr] = {
              sales: d.selectedSales,
              yoyTrend: mTrend,
              yoyVariation: mVar
            };
          });

          return {
            code: p.productCode,
            name: p.productName,
            unitType: p.unitType || 'UDS',
            totalSales: parseFloat(p.totalSales.toFixed(2)),
            totalUnits: parseFloat(p.totalUnits.toFixed(2)),
            totalCost: parseFloat(p.totalCost.toFixed(2)),
            totalMarginPercent: parseFloat(marginPercent.toFixed(1)),
            avgUnitPrice: parseFloat(avgPrice.toFixed(2)),
            avgUnitCost: parseFloat(avgCost.toFixed(2)),
            marginPerUnit: parseFloat(marginPerUnit.toFixed(2)),
            prevYearSales: parseFloat(p.prevYearSales.toFixed(2)),
            prevYearUnits: parseFloat(p.prevYearUnits.toFixed(2)),
            prevYearAvgPrice: parseFloat(prevAvgPrice.toFixed(2)),
            hasDiscount: p.hasDiscount,
            hasSpecialPrice: p.hasSpecialPrice,
            avgDiscountPct: p.avgDiscountPct,
            avgDiscountEur: p.avgDiscountEur,
            monthlyData: monthlyOutput,
            yoyTrend,
            yoyVariation: parseFloat(variation.toFixed(1))
          };
        }).sort((a, b) => b.totalSales - a.totalSales);

        const margin = s.totalSales - s.totalCost;
        const marginPercent = s.totalSales > 0 ? (margin / s.totalSales) * 100 : 0;
        return {
          subfamilyCode: s.subfamilyCode,
          subfamilyName: s.subfamilyName,
          totalSales: parseFloat(s.totalSales.toFixed(2)),
          totalUnits: s.totalUnits,
          totalMarginPercent: parseFloat(marginPercent.toFixed(1)),
          products
        };
      }).sort((a, b) => b.totalSales - a.totalSales);

      const margin = f.totalSales - f.totalCost;
      const marginPercent = f.totalSales > 0 ? (margin / f.totalSales) * 100 : 0;
      return {
        familyCode: f.familyCode,
        familyName: f.familyName,
        totalSales: parseFloat(f.totalSales.toFixed(2)),
        totalUnits: f.totalUnits,
        totalMarginPercent: parseFloat(marginPercent.toFixed(1)),
        subfamilies
      };
    }).sort((a, b) => b.totalSales - a.totalSales);

    res.json({
      clientCode,
      grandTotal: {
        sales: grandTotalSales,
        cost: grandTotalCost,
        margin: grandTotalSales - grandTotalCost,
        units: grandTotalUnits,
        products: productSet.size
      },
      monthlyTotals: flatMonthlyTotals,
      availableFilters: {
        families: Array.from(availableFamiliesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
        subfamilies: Array.from(availableSubfamiliesMap.values()).sort((a, b) => a.name.localeCompare(b.name))
      },
      families,
      years: yearsArray,
      months: { start: monthStart, end: monthEnd }
    });

  } catch (error) {
    logger.error(`Objectives matrix error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo matriz de cliente', details: error.message });
  }
});

// =============================================================================
// OBJECTIVES BY CLIENT - Aggregated client data for selected periods
// =============================================================================
app.get('/api/objectives/by-client', async (req, res) => {
  try {
    const { vendedorCodes, years, months } = req.query;
    const now = getCurrentDate();

    // Parse years and months - default to full year
    const yearsArray = years ? years.split(',').map(y => parseInt(y.trim())).filter(y => y >= MIN_YEAR) : [now.getFullYear()];
    const monthsArray = months ? months.split(',').map(m => parseInt(m.trim())).filter(m => m >= 1 && m <= 12) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    const yearsFilter = yearsArray.join(',');
    const monthsFilter = monthsArray.join(',');
    const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

    // Main year for objective calculation
    const mainYear = Math.max(...yearsArray);
    const prevYear = mainYear - 1;

    // Query 1: Get current period client data (no limit - show all clients)
    const currentRows = await query(`
      SELECT 
        L.CODIGOCLIENTEALBARAN as CODE,
        COALESCE(NULLIF(TRIM(MIN(C.NOMBREALTERNATIVO)), ''), MIN(C.NOMBRECLIENTE)) as NAME,
        MIN(C.DIRECCION) as ADDRESS,
        MIN(C.CODIGOPOSTAL) as POSTALCODE,
        MIN(C.POBLACION) as CITY,
        SUM(L.IMPORTEVENTA) as SALES,
        SUM(L.IMPORTECOSTO) as COST
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
        AND CA.CCYEAB = L.LCYEAB 
        AND CA.CCSRAB = L.LCSRAB 
        AND CA.CCTRAB = L.LCTRAB 
        AND CA.CCNRAB = L.LCNRAB
      WHERE L.ANODOCUMENTO IN(${yearsFilter})
        AND L.MESDOCUMENTO IN(${monthsFilter})
        -- Matrix cleanup filters
        AND L.LCTPVT <> 'SC'
        AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
        AND COALESCE(CA.CCSNSD, '') <> 'E'
        ${vendedorFilter}
      GROUP BY L.CODIGOCLIENTEALBARAN
      ORDER BY SALES DESC
    `);

    // Query 2: Get previous year data for same period (for objective calculation)
    const prevRows = await query(`
      SELECT 
        L.CODIGOCLIENTEALBARAN as CODE,
        SUM(L.IMPORTEVENTA) as PREV_SALES
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.CAC CA ON CA.CCSBAB = L.LCSBAB 
        AND CA.CCYEAB = L.LCYEAB 
        AND CA.CCSRAB = L.LCSRAB 
        AND CA.CCTRAB = L.LCTRAB 
        AND CA.CCNRAB = L.LCNRAB
      WHERE L.ANODOCUMENTO = ${prevYear}
        AND L.MESDOCUMENTO IN(${monthsFilter})
        -- Matrix cleanup filters
        AND L.LCTPVT <> 'SC'
        AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
        AND COALESCE(CA.CCSNSD, '') <> 'E'
        ${vendedorFilter}
      GROUP BY L.CODIGOCLIENTEALBARAN
    `);

    // Create map of previous year sales by client
    const prevSalesMap = new Map();
    prevRows.forEach(r => {
      prevSalesMap.set(r.CODE?.trim() || '', parseFloat(r.PREV_SALES) || 0);
    });

    const clients = currentRows.map(r => {
      const code = r.CODE?.trim() || '';
      const sales = parseFloat(r.SALES) || 0;
      const cost = parseFloat(r.COST) || 0;
      const margin = sales - cost;
      const prevSales = prevSalesMap.get(code) || 0;

      // Objective: Previous year sales + 10%, or current sales if no history
      const objective = prevSales > 0 ? prevSales * 1.10 : sales;
      const progress = objective > 0 ? (sales / objective) * 100 : (sales > 0 ? 100 : 0);

      // Status based on progress
      let status = 'critical';
      if (progress >= 100) status = 'achieved';
      else if (progress >= 80) status = 'ontrack';
      else if (progress >= 50) status = 'atrisk';

      return {
        code,
        name: r.NAME?.trim() || 'Sin nombre',
        address: r.ADDRESS?.trim() || '',
        postalCode: r.POSTALCODE?.trim() || '',
        city: r.CITY?.trim() || '',
        current: sales,
        objective: objective,
        prevYear: prevSales,
        margin: margin,
        progress: Math.round(progress * 10) / 10,
        status: status
      };
    });

    // Summary counts
    const achieved = clients.filter(c => c.status === 'achieved').length;
    const ontrack = clients.filter(c => c.status === 'ontrack').length;
    const atrisk = clients.filter(c => c.status === 'atrisk').length;
    const critical = clients.filter(c => c.status === 'critical').length;

    res.json({
      clients,
      count: clients.length,
      periodObjective: clients.reduce((sum, c) => sum + c.objective, 0),
      totalSales: clients.reduce((sum, c) => sum + c.current, 0),
      years: yearsArray,
      months: monthsArray,
      summary: { achieved, ontrack, atrisk, critical }
    });

  } catch (error) {
    logger.error(`Objectives by-client error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo objetivos por cliente', details: error.message });
  }
});

// =============================================================================
// RUTERO - Route planner using REAL visit/delivery days from DSED.LACLAE
// LACLAE columns: LCCDCL=client, R1_T8CDVD=vendedor
// Visit days: R1_T8DIVL (Lunes), R1_T8DIVM (Martes), R1_T8DIVX (Miércoles), etc.
// Delivery days: R1_T8DIRL (Lunes), R1_T8DIRM (Martes), R1_T8DIRX (Miércoles), etc.
// =============================================================================

// =============================================================================
// RUTERO - FAST VERSION (NO LACLAE - uses LAC only with hash distribution)
// LACLAE has 2.6M rows and no useful index, making queries take 30+ seconds
// This version uses LAC (indexed by vendedor) and distributes clients by hash
// =============================================================================

// Hash function to distribute clients across days (0-6 = Sun-Sat)
function getClientDayIndex(clientCode) {
  if (!clientCode) return 1; // Default Monday
  const hash = clientCode.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return (hash % 7); // 0=Sun, 1=Mon, 2=Tue, etc.
}

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// GET /api/rutero/week - Client counts per day using LACLAE CACHE (fast!)
// Cache is loaded at startup from DSED.LACLAE
app.get('/api/rutero/week', async (req, res) => {
  try {
    const { vendedorCodes, role } = req.query;
    const now = getCurrentDate();

    logger.info(`[RUTERO WEEK] vendedorCodes: "${vendedorCodes}", role: "${role}"`);

    // Try to use cache first (instant response)
    const cachedCounts = getWeekCountsFromCache(vendedorCodes, role || 'comercial');

    if (cachedCounts) {
      // Calculate total unique clients from cache
      const totalClients = getTotalClientsFromCache(vendedorCodes, role || 'comercial');

      const todayName = DAY_NAMES[now.getDay()];
      logger.info(`[RUTERO WEEK] From cache: ${JSON.stringify(cachedCounts)}, total: ${totalClients}`);

      return res.json({
        week: cachedCounts,
        todayName,
        role: role || 'comercial',
        totalUniqueClients: totalClients
      });
    }

    // Fallback: Cache not ready, return empty (will reload on next request after cache loads)
    logger.warn(`[RUTERO WEEK] Cache not ready, returning empty`);
    res.json({
      week: { lunes: 0, martes: 0, miercoles: 0, jueves: 0, viernes: 0, sabado: 0, domingo: 0 },
      todayName: DAY_NAMES[now.getDay()],
      role: role || 'comercial',
      totalUniqueClients: 0,
      cacheStatus: 'loading'
    });
  } catch (error) {
    logger.error(`Rutero week error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo rutero semana', details: error.message });
  }
});



// GET /api/rutero/vendedores - List of salespeople for "View as" feature (from CACHE + VEN names)
// Used by sales manager to select which salesperson's route to view
app.get('/api/rutero/vendedores', async (req, res) => {
  try {
    // Try cache first for codes and client counts
    const cachedVendedores = getVendedoresFromCache();

    if (cachedVendedores && cachedVendedores.length > 0) {
      // Get vendor names from VEN table
      const codes = cachedVendedores.map(v => `'${v.code}'`).join(',');

      try {
        const namesResult = await query(`
          SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME 
          FROM DSEDAC.VEN 
          WHERE CODIGOVENDEDOR IN (${codes})
        `);

        // Create a map of code -> name
        const nameMap = {};
        namesResult.forEach(row => {
          nameMap[row.CODE?.trim()] = row.NAME?.trim() || '';
        });

        // Merge names with cached data
        const vendedoresConNombres = cachedVendedores.map(v => ({
          code: v.code,
          name: nameMap[v.code] || `Vendedor ${v.code}`,
          clients: v.clients
        }));

        logger.info(`[RUTERO VENDEDORES] From cache with names: ${vendedoresConNombres.length} salespeople`);
        return res.json({
          vendedores: vendedoresConNombres,
          count: vendedoresConNombres.length
        });
      } catch (queryError) {
        // If name query fails, return cache data without names
        logger.warn(`[RUTERO VENDEDORES] Name query failed, returning codes only: ${queryError.message}`);
        return res.json({
          vendedores: cachedVendedores,
          count: cachedVendedores.length
        });
      }
    }

    // Fallback: Cache not ready
    logger.warn(`[RUTERO VENDEDORES] Cache not ready`);
    res.json({
      vendedores: [],
      count: 0,
      cacheStatus: 'loading'
    });
  } catch (error) {
    logger.error(`Rutero vendedores error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo vendedores', details: error.message });
  }
});

// =============================================================================
// RUTERO CONFIGURATION (Drag & Drop Reordering)
// =============================================================================
app.post('/api/rutero/config', async (req, res) => {
  let conn;
  try {
    const { vendedor, dia, orden } = req.body;

    if (!vendedor || !dia || !orden || !Array.isArray(orden)) {
      return res.status(400).json({ error: 'Datos inválidos. Se requiere vendedor, dia y array de orden.' });
    }

    // Connect manually for transaction support
    const odbc = require('odbc');
    conn = await odbc.connect(CONNECTION_STRING);
    await conn.beginTransaction();

    // 1. Delete existing config for this vendor/day
    await conn.query(`DELETE FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '${vendedor}' AND DIA = '${dia}'`);

    // 2. Insert new order
    // Note: ODBC basic driver might not support batch inserts efficiently, so we loop.
    // Given < 100 items, this is acceptable.
    for (const item of orden) {
      if (item.cliente) {
        await conn.query(`
          INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN) 
          VALUES ('${vendedor}', '${dia}', '${item.cliente}', ${parseInt(item.posicion) || 0})
        `);
      }
    }

    await conn.commit();
    res.json({ success: true, message: 'Orden actualizado' });

  } catch (error) {
    if (conn) {
      try { await conn.rollback(); } catch (e) { }
    }
    logger.error(`Rutero config save error: ${error.message}`);
    res.status(500).json({ error: 'Error guardando orden', details: error.message });
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { }
    }
  }
});

app.get('/api/rutero/config', async (req, res) => {
  try {
    const { vendedor, dia } = req.query;
    if (!vendedor || !dia) return res.status(400).json({ error: 'Vendedor y dia requeridos' });

    const rows = await query(`
      SELECT CLIENTE, ORDEN 
      FROM JAVIER.RUTERO_CONFIG 
      WHERE VENDEDOR = '${vendedor}' AND DIA = '${dia}' 
      ORDER BY ORDEN ASC
    `);

    res.json({ config: rows });
  } catch (error) {
    logger.error(`Rutero config fetch error: ${error.message}`);
    res.status(500).json({ error: 'Error recuperando orden' });
  }
});

// GET /api/rutero/day/:day - Client list for a specific day from CDVI (visits) or CDLO (reparto)
// Status shows YTD sales for entire year up to week N-1, comparing with same period previous year
app.get('/api/rutero/day/:day', async (req, res) => {
  try {
    const { day } = req.params;
    const { vendedorCodes, year, role } = req.query;
    const now = getCurrentDate();
    const currentYear = parseInt(year) || now.getFullYear();
    const previousYear = currentYear - 1;
    const isVisit = role !== 'repartidor';

    // Simple YTD: Use all data up to yesterday (or today if early morning)
    // Yesterday's date for comparison
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    // End date for current year: yesterday or Dec 31 of current year if looking at past year
    const endMonthCurrent = yesterday.getMonth() + 1;
    const endDayCurrent = yesterday.getDate();
    // For previous year comparison, use same day of year
    const endMonthPrevious = endMonthCurrent;
    const endDayPrevious = endDayCurrent;

    // Validate day
    const dayIndex = DAY_NAMES.indexOf(day.toLowerCase());
    if (dayIndex === -1) {
      return res.status(400).json({ error: 'Día inválido', day });
    }

    // Map day to column names
    const dayColumnMap = {
      'lunes': 'LUNES', 'martes': 'MARTES', 'miercoles': 'MIERCOLES',
      'jueves': 'JUEVES', 'viernes': 'VIERNES', 'sabado': 'SABADO', 'domingo': 'DOMINGO'
    };
    const dayName = dayColumnMap[day.toLowerCase()] || 'LUNES';

    // Fetch custom order
    let orderMap = new Map();
    try {
      const primaryVendor = vendedorCodes ? vendedorCodes.split(',')[0].trim() : '';
      if (primaryVendor) {
        // Enforce lowercase for day to match frontend
        const configRows = await query(`
          SELECT CLIENTE, ORDEN 
          FROM JAVIER.RUTERO_CONFIG 
          WHERE VENDEDOR = '${primaryVendor}' AND DIA = '${day.toLowerCase()}'
        `);
        configRows.forEach(r => orderMap.set(r.CLIENTE.trim(), r.ORDEN));
      }
    } catch (e) {
      logger.warn(`Order config error: ${e.message}`);
    }

    logger.info(`[RUTERO DAY] day=${day}, isVisit=${isVisit}, vendedor=${vendedorCodes}, YTD up to ${endMonthCurrent}/${endDayCurrent}`);

    // Current date for vacation filter
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const currentYearNow = now.getFullYear();

    // Get client codes for the selected day from CACHE (fast!)
    let dayClientCodes = getClientsForDay(vendedorCodes, day, role || 'comercial');

    if (!dayClientCodes) {
      // Cache not ready - return empty
      logger.warn(`[RUTERO DAY] Cache not ready`);
      return res.json({
        clients: [],
        count: 0,
        day,
        cacheStatus: 'loading'
      });
    }

    logger.info(`[RUTERO DAY] From cache: ${dayClientCodes.length} clients for ${day}`);

    if (dayClientCodes.length === 0) {
      return res.json({
        clients: [],
        count: 0,
        day,
        year: currentYear,
        compareYear: previousYear
      });
    }

    // Build client filter for LAC queries (limit to batch size, properly escaped)
    const batchSize = 200;
    const clientBatch = dayClientCodes.slice(0, batchSize);
    // Escape any quotes in client codes
    const safeClientFilter = clientBatch.map(c => `'${c.replace(/'/g, "''")}'`).join(',');
    const clientFilter = `L.CODIGOCLIENTEALBARAN IN (${safeClientFilter})`;

    // Get YTD cumulative sales for CURRENT YEAR up to yesterday (no CPC join - it's per-order GPS)
    const currentYearRows = await query(`
      SELECT 
        L.CODIGOCLIENTEALBARAN as CODE,
        COALESCE(NULLIF(TRIM(MIN(C.NOMBREALTERNATIVO)), ''), MIN(C.NOMBRECLIENTE)) as NAME,
        MIN(C.DIRECCION) as ADDRESS,
        MIN(C.POBLACION) as CITY,
        MIN(C.TELEFONO1) as PHONE,
        SUM(L.IMPORTEVENTA) as SALES,
        SUM(L.IMPORTECOSTO) as COST
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      WHERE ${clientFilter}
        AND L.ANODOCUMENTO = ${currentYear}
        AND ${LAC_SALES_FILTER}
        AND (L.MESDOCUMENTO < ${endMonthCurrent} OR (L.MESDOCUMENTO = ${endMonthCurrent} AND L.DIADOCUMENTO <= ${endDayCurrent}))
      GROUP BY L.CODIGOCLIENTEALBARAN
    `);

    // Get YTD for previous year same period
    const prevYearMap = new Map();
    const prevYearRows = await query(`
      SELECT 
        L.CODIGOCLIENTEALBARAN as CODE,
        SUM(L.IMPORTEVENTA) as SALES,
        SUM(L.IMPORTECOSTO) as COST
      FROM DSEDAC.LAC L
      WHERE ${clientFilter}
        AND L.ANODOCUMENTO = ${previousYear}
        AND ${LAC_SALES_FILTER}
        AND (L.MESDOCUMENTO < ${endMonthPrevious} OR (L.MESDOCUMENTO = ${endMonthPrevious} AND L.DIADOCUMENTO <= ${endDayPrevious}))
      GROUP BY L.CODIGOCLIENTEALBARAN
    `);
    prevYearRows.forEach(r => {
      prevYearMap.set(r.CODE?.trim() || '', {
        sales: parseFloat(r.SALES) || 0,
        cost: parseFloat(r.COST) || 0
      });
    });

    // Get GPS coordinates from DSEMOVIL.CLIENTES (accurate per-client GPS)
    let gpsMap = new Map();
    try {
      const gpsResult = await query(`
        SELECT CODIGO, LATITUD, LONGITUD
        FROM DSEMOVIL.CLIENTES
        WHERE CODIGO IN (${clientBatch.map(c => `'${c}'`).join(',')})
          AND LATITUD IS NOT NULL AND LATITUD <> 0
      `);
      gpsResult.forEach(g => {
        gpsMap.set(g.CODIGO?.trim() || '', {
          lat: parseFloat(g.LATITUD) || null,
          lon: parseFloat(g.LONGITUD) || null
        });
      });
    } catch (e) {
      logger.warn(`Could not load GPS data: ${e.message}`);
    }

    // Build response with YTD data and YoY comparison
    const clients = currentYearRows.map(r => {
      const code = r.CODE?.trim() || '';
      const ytdSales = parseFloat(r.SALES) || 0;
      const ytdCost = parseFloat(r.COST) || 0;
      const ytdMargin = ytdSales > 0 ? ((ytdSales - ytdCost) / ytdSales * 100) : 0;

      const prevData = prevYearMap.get(code) || { sales: 0, cost: 0 };
      const prevSales = prevData.sales;

      // YoY variation
      const yoyVariation = prevSales > 0
        ? ((ytdSales - prevSales) / prevSales * 100)
        : (ytdSales > 0 ? 100 : 0);
      const isPositive = ytdSales >= prevSales;

      // Get GPS from DSEMOVIL.CLIENTES
      const gps = gpsMap.get(code) || { lat: null, lon: null };

      return {
        code,
        name: r.NAME?.trim() || 'Sin nombre',
        address: r.ADDRESS?.trim() || '',
        city: r.CITY?.trim() || '',
        phone: r.PHONE?.trim() || '',
        latitude: gps.lat,
        longitude: gps.lon,
        status: {
          isPositive,
          ytdSales: Math.round(ytdSales * 100) / 100,
          ytdPrevYear: Math.round(prevSales * 100) / 100,
          yoyVariation: Math.round(yoyVariation * 10) / 10,
          margin: Math.round(ytdMargin * 10) / 10,
          currentMonthSales: ytdSales,
          prevMonthSales: prevSales,
          variation: yoyVariation
        }
      };
    }).sort((a, b) => {
      // 1. Custom Order
      const orderA = orderMap.has(a.code) ? orderMap.get(a.code) : 999999;
      const orderB = orderMap.has(b.code) ? orderMap.get(b.code) : 999999;

      if (orderA !== orderB) {
        return orderA - orderB;
      }

      // 2. Fallback: Sales Descending
      return b.status.ytdSales - a.status.ytdSales;
    });

    res.json({
      clients,
      count: clients.length,
      totalDayClients: dayClientCodes.length,
      day,
      year: currentYear,
      compareYear: previousYear,
      ytdUpTo: `${endMonthCurrent}/${endDayCurrent}/${currentYear}`
    });
  } catch (error) {
    logger.error(`Rutero day error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo rutero día', details: error.message });
  }
});

// =============================================================================
// AI CHATBOT ENDPOINT
// =============================================================================
const { handleChatMessage } = require('./src/chatbot/chatbot_handler');

app.post('/api/chatbot/message', async (req, res) => {
  try {
    const { message, vendedorCodes, clientCode } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Mensaje requerido' });
    }

    // Get database connection using odbc directly
    const odbc = require('odbc');
    const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

    try {
      const response = await handleChatMessage(
        conn,
        message,
        vendedorCodes ? vendedorCodes.split(',') : [],
        clientCode
      );
      res.json({ response, timestamp: new Date().toISOString() });
    } finally {
      await conn.close();
    }
  } catch (error) {
    logger.error(`Chatbot error: ${error.message}`);
    res.status(500).json({
      error: 'Error procesando mensaje',
      response: '❌ Lo siento, hubo un error. Intenta de nuevo.'
    });
  }
});

// =============================================================================
// HEALTH CHECK
// =============================================================================
app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1 as ok FROM SYSIBM.SYSDUMMY1', false);
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
      dateRange: { from: `${MIN_YEAR}-01-01`, to: 'today' },
      endpoints: [
        '/api/auth/login', '/api/dashboard/metrics', '/api/dashboard/sales-evolution',
        '/api/dashboard/yoy-comparison', '/api/dashboard/recent-sales', '/api/clients',
        '/api/clients/:code', '/api/clients/compare', '/api/router/calendar',
        '/api/analytics/top-products', '/api/analytics/top-clients', '/api/analytics/margins',
        '/api/analytics/trends', '/api/products', '/api/vendedores', '/api/export/client-report'
      ]
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// =============================================================================
// START SERVER
// =============================================================================
initDb().then(async () => {
  // Load LACLAE cache in background (non-blocking for startup)
  loadLaclaeCache().catch(err => logger.warn(`LACLAE cache error: ${err.message}`));

  app.listen(PORT, '0.0.0.0', () => {
    logger.info('═'.repeat(60));
    logger.info(`  GMP Sales Analytics Server - http://192.168.1.238:${PORT}`);
    logger.info(`  Listening on ALL interfaces (0.0.0.0:${PORT})`);
    logger.info(`  Connected to DB2 via ODBC - All Real Data`);
    logger.info(`  Date Range: ${MIN_YEAR}-01-01 to ${getCurrentDate().toISOString().split('T')[0]}`);
    logger.info('═'.repeat(60));
  });
}).catch(err => {
  logger.error(`Server startup failed: ${err.message}`);
  process.exit(1);
});
