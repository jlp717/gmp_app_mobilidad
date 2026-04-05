/**
 * AUDIT LOGGING MIDDLEWARE
 * ========================
 * Enterprise-grade request/audit logging for full traceability.
 * Logs: IP, user, role, action, duration, status, user-agent.
 * 
 * Writes to:
 *  - Console (via Winston) for PM2 real-time monitoring
 *  - audit.log file (rotated, 10MB × 10 files = 100MB max)
 *  - In-memory ring buffer for /api/optimization/audit-log endpoint
 */
const winston = require('winston');
const crypto = require('crypto');
const fs = require('fs');

// =============================================================================
// AUDIT LOGGER (separate from main logger to keep audit trail clean)
// =============================================================================
const auditLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({
            filename: 'logs/audit.log',
            maxsize: 10 * 1024 * 1024, // 10MB per file
            maxFiles: 10,              // Keep 10 rotated files (100MB total)
            tailable: true
        })
    ]
});

// =============================================================================
// IMMUTABLE AUDIT LOG — append-only, never rotated, legal-grade evidence
// =============================================================================
const IMMUTABLE_LOG_PATH = 'logs/audit-immutable.log';
function writeImmutable(entry) {
    try {
        const line = JSON.stringify({ ...entry, _ts: new Date().toISOString() }) + '\n';
        fs.appendFileSync(IMMUTABLE_LOG_PATH, line, 'utf8');
    } catch (e) {
        // Silent fail — do not crash the server for audit logging
    }
}

// =============================================================================
// IN-MEMORY RING BUFFER for recent audit entries (last 500)
// =============================================================================
const RING_BUFFER_SIZE = 500;
const auditRingBuffer = [];

function pushAuditEntry(entry) {
    auditRingBuffer.push(entry);
    if (auditRingBuffer.length > RING_BUFFER_SIZE) {
        auditRingBuffer.shift();
    }
}

// =============================================================================
// SESSION TRACKER - track active sessions (login/IP/role)
// =============================================================================
const activeSessions = new Map(); // userId → { ip, lastSeen, role, loginTime, userAgent, requestCount }

function trackSession(userId, ip, role, userAgent, deviceInfo) {
    const existing = activeSessions.get(userId);
    if (existing) {
        existing.lastSeen = new Date().toISOString();
        existing.requestCount++;
        // Update device info if present
        if (deviceInfo) existing.deviceInfo = deviceInfo;
        // Detect IP change (suspicious activity)
        if (existing.ip !== ip) {
            existing.ipHistory = existing.ipHistory || [existing.ip];
            if (!existing.ipHistory.includes(ip)) {
                existing.ipHistory.push(ip);
            }
            existing.ip = ip;
        }
    } else {
        activeSessions.set(userId, {
            ip,
            role: role || 'unknown',
            loginTime: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            userAgent: userAgent || 'unknown',
            deviceInfo: deviceInfo || null,
            requestCount: 1,
            ipHistory: [ip]
        });
    }
}

// =============================================================================
// IP EXTRACTION (handles proxies, load balancers, ngrok)
// =============================================================================
function getClientIP(req) {
    // Priority: X-Forwarded-For (first IP) > X-Real-IP > req.ip > socket
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        // X-Forwarded-For can be: "client, proxy1, proxy2"
        return forwarded.split(',')[0].trim();
    }
    return req.headers['x-real-ip'] || req.ip || req.socket?.remoteAddress || 'unknown';
}

// =============================================================================
// MAIN AUDIT MIDDLEWARE
// =============================================================================
function auditMiddleware(req, res, next) {
    const startTime = Date.now();
    const requestId = crypto.randomBytes(4).toString('hex'); // 8-char unique ID
    const clientIP = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    // DEVICE FINGERPRINT — extracted from custom headers sent by Flutter app
    const deviceInfo = {
        appVersion: req.headers['x-app-version'] || null,
        deviceModel: req.headers['x-device-model'] || null,
        deviceOS: req.headers['x-device-os'] || null,
        deviceId: req.headers['x-device-id'] || null,
    };

    // Attach to request for downstream use
    req.requestId = requestId;
    req.clientIP = clientIP;
    req.deviceInfo = deviceInfo;

    // Capture response
    const originalEnd = res.end;
    let responseSize = 0;

    res.end = function (chunk, encoding) {
        if (chunk) {
            responseSize = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, encoding);
        }
        res.end = originalEnd;
        res.end(chunk, encoding);
    };

    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const userId = req.user?.code || 'anonymous';
        const userRole = req.user?.role || req.user?.id || '-';

        // Skip health checks and static assets
        if (req.path === '/api/health' || req.path.startsWith('/static')) {
            return;
        }

        // Track session
        if (userId !== 'anonymous') {
            trackSession(userId, clientIP, userRole, userAgent, deviceInfo);
        }

        // Build audit entry
        const entry = {
            timestamp: new Date().toISOString(),
            requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration,
            ip: clientIP,
            user: userId,
            role: userRole,
            userAgent: shortenUserAgent(userAgent),
            query: sanitizeQuery(req.query),
            responseSize,
            // DEVICE FINGERPRINT
            appVersion: deviceInfo.appVersion,
            deviceModel: deviceInfo.deviceModel,
            deviceOS: deviceInfo.deviceOS,
            deviceId: deviceInfo.deviceId,
        };

        // Classify severity
        const isSlow = duration > 3000;
        const isError = res.statusCode >= 400;
        const isAuth = req.path.includes('/login') || req.path.includes('/switch-role');
        const isSensitive = req.path.includes('/commissions') || req.path.includes('/export');

        // Always log to audit file
        auditLogger.info(entry);

        // Push to ring buffer
        pushAuditEntry(entry);

        // Write sensitive actions to immutable log
        if (isAuth || isSensitive || isError) {
            writeImmutable(entry);
        }

        // Console log format for PM2 (concise, structured)
        const statusIcon = isError ? '❌' : isSlow ? '🐌' : '✅';
        const authTag = isAuth ? ' [AUTH]' : '';
        const sensitiveTag = isSensitive ? ' [SENSITIVE]' : '';
        const deviceTag = deviceInfo.appVersion ? ` | App:${deviceInfo.appVersion} Dev:${deviceInfo.deviceModel || '?'}` : '';

        // Only log important stuff to console (reduce noise)
        if (isAuth || isError || isSlow || isSensitive || res.statusCode === 200) {
            const logger = require('./logger');
            logger.info(
                `[AUDIT] ${statusIcon} ${req.method} ${req.path} → ${res.statusCode} (${duration}ms) | IP: ${clientIP} | User: ${userId}${authTag}${sensitiveTag}${deviceTag}`
            );
        }
    });

    next();
}

// =============================================================================
// LOGIN AUDIT (call explicitly from auth route for detailed login tracking)
// =============================================================================
function auditLogin(req, vendorCode, vendorName, role, success) {
    const clientIP = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const deviceInfo = req.deviceInfo || {
        appVersion: req.headers['x-app-version'] || null,
        deviceModel: req.headers['x-device-model'] || null,
        deviceOS: req.headers['x-device-os'] || null,
        deviceId: req.headers['x-device-id'] || null,
    };

    const entry = {
        timestamp: new Date().toISOString(),
        event: 'LOGIN',
        success,
        vendorCode,
        vendorName,
        role,
        ip: clientIP,
        userAgent: shortenUserAgent(userAgent),
        fullUserAgent: userAgent,
        // DEVICE FINGERPRINT
        appVersion: deviceInfo.appVersion,
        deviceModel: deviceInfo.deviceModel,
        deviceOS: deviceInfo.deviceOS,
        deviceId: deviceInfo.deviceId,
    };

    auditLogger.info(entry);
    pushAuditEntry(entry);
    writeImmutable(entry); // Logins ALWAYS go to immutable log

    if (success) {
        trackSession(vendorCode, clientIP, role, userAgent, deviceInfo);
    }

    const logger = require('./logger');
    const icon = success ? '🔑' : '🚫';
    const deviceTag = deviceInfo.appVersion ? ` | App:${deviceInfo.appVersion} Dev:${deviceInfo.deviceModel || '?'} OS:${deviceInfo.deviceOS || '?'} ID:${deviceInfo.deviceId || '?'}` : '';
    logger.info(`[AUDIT] ${icon} LOGIN ${success ? 'OK' : 'FAILED'}: ${vendorName || vendorCode} (${vendorCode}) | Role: ${role} | IP: ${clientIP}${deviceTag}`);
}

// =============================================================================
// DATA ACCESS AUDIT — log exactly what data a user viewed
// Call from sensitive routes (commissions, exports, etc.)
// =============================================================================
function auditDataAccess(req, action, details) {
    const clientIP = getClientIP(req);
    const userId = req.user?.code || 'anonymous';
    const userRole = req.user?.role || '-';
    const deviceInfo = req.deviceInfo || {};

    const entry = {
        timestamp: new Date().toISOString(),
        event: 'DATA_ACCESS',
        action,
        user: userId,
        role: userRole,
        ip: clientIP,
        appVersion: deviceInfo.appVersion || null,
        deviceModel: deviceInfo.deviceModel || null,
        deviceOS: deviceInfo.deviceOS || null,
        deviceId: deviceInfo.deviceId || null,
        ...details,
    };

    auditLogger.info(entry);
    pushAuditEntry(entry);
    writeImmutable(entry); // Data access ALWAYS goes to immutable log

    const logger = require('./logger');
    const detailStr = Object.entries(details).map(([k, v]) => `${k}=${v}`).join(' ');
    const deviceTag = deviceInfo.appVersion ? ` | App:${deviceInfo.appVersion} Dev:${deviceInfo.deviceModel || '?'}` : '';
    logger.info(`[AUDIT] 📊 DATA_ACCESS: ${action} | User:${userId} | ${detailStr} | IP:${clientIP}${deviceTag}`);
}

// =============================================================================
// HELPERS
// =============================================================================
function shortenUserAgent(ua) {
    if (!ua || ua === 'unknown') return 'unknown';
    // Extract meaningful part: "Dart/3.5" or "Mozilla/5.0 (...) Chrome/..."
    if (ua.startsWith('Dart/')) return ua.split(' ')[0]; // "Dart/3.5"
    const match = ua.match(/(Chrome|Firefox|Safari|Edge|Dart)\/[\d.]+/);
    return match ? match[0] : ua.substring(0, 50);
}

function sanitizeQuery(queryObj) {
    if (!queryObj || Object.keys(queryObj).length === 0) return undefined;
    // Only keep non-sensitive, relevant query params
    const safe = {};
    const allowedKeys = ['year', 'month', 'vendedorCode', 'vendedorCodes', 'limit', 'search', 'page'];
    for (const key of allowedKeys) {
        if (queryObj[key] !== undefined) {
            safe[key] = String(queryObj[key]).substring(0, 100); // Truncate long values
        }
    }
    return Object.keys(safe).length > 0 ? safe : undefined;
}

// =============================================================================
// EXPORTS
// =============================================================================
module.exports = {
    auditMiddleware,
    auditLogin,
    auditDataAccess,
    getRecentAuditEntries: () => [...auditRingBuffer],
    getActiveSessions: () => {
        const sessions = {};
        activeSessions.forEach((v, k) => { sessions[k] = v; });
        return sessions;
    },
    getClientIP
};
