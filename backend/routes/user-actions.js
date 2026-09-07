/**
 * GMP User Action Logging - Track app usage for closed testing
 * Logs all user actions to local files for monitoring
 */
const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const LOG_DIR = path.join(__dirname, '../logs/user-actions');
const ACTION_MAX = 80;
const SCREEN_MAX = 80;

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function clip(value, max) {
    return String(value || '').trim().slice(0, max);
}

function sanitizeLogBody(body = {}) {
    return {
        userId: clip(body.userId, 40),
        action: clip(body.action, ACTION_MAX),
        screen: clip(body.screen, SCREEN_MAX),
        appVersion: clip(body.appVersion, 32),
        deviceModel: clip(body.deviceModel || body.deviceInfo, 64),
        osVersion: clip(body.osVersion, 32),
    };
}

function sendLogError(res, error, code) {
    logger.error(`[USER-ACTIONS] ${code}: ${error.message}`);
    if (res.headersSent) return;
    return res.status(500).json({
        success: false,
        code,
        error: 'No se pudo registrar la actividad',
    });
}

/**
 * POST /api/logs/user-action
 * Log user actions (screen views, button clicks, etc.)
 */
router.post('/user-action', async (req, res) => {
    try {
        const action = clip(req.body?.action, ACTION_MAX);
        const screen = clip(req.body?.screen, SCREEN_MAX);
        if (!action || !screen) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_USER_ACTION',
                error: 'action y screen son obligatorios',
            });
        }

        const safe = sanitizeLogBody(req.body);
        const logEntry = {
            timestamp: new Date().toISOString(),
            userId: safe.userId,
            action: safe.action,
            screen: safe.screen,
            appVersion: safe.appVersion,
            ip: req.ip || req.socket?.remoteAddress || 'unknown',
        };

        const dateStr = new Date().toISOString().split('T')[0];
        const logFile = path.join(LOG_DIR, `actions-${dateStr}.json`);
        await fsPromises.appendFile(logFile, JSON.stringify(logEntry) + '\n');

        logger.info(`Action: ${safe.userId || 'anon'} → ${safe.action} @ ${safe.screen}`);
        res.json({ success: true });
    } catch (error) {
        return sendLogError(res, error, 'USER_ACTION_LOG_ERROR');
    }
});

/**
 * POST /api/logs/app-install
 * Track new app installations
 */
router.post('/app-install', async (req, res) => {
    try {
        const safe = sanitizeLogBody(req.body);
        const logEntry = {
            timestamp: new Date().toISOString(),
            event: 'APP_INSTALL',
            userId: safe.userId,
            appVersion: safe.appVersion,
            deviceModel: safe.deviceModel,
            osVersion: safe.osVersion,
            ip: req.ip || req.socket?.remoteAddress || 'unknown',
        };

        const dateStr = new Date().toISOString().split('T')[0];
        const logFile = path.join(LOG_DIR, `installs-${dateStr}.json`);
        await fsPromises.appendFile(logFile, JSON.stringify(logEntry) + '\n');

        logger.info(`NEW INSTALL v${safe.appVersion || '?'} device=${safe.deviceModel || '?'}`);
        res.json({ success: true, registered: true });
    } catch (error) {
        return sendLogError(res, error, 'APP_INSTALL_LOG_ERROR');
    }
});

/**
 * GET /api/logs/stats
 * Get today's activity statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const dateStr = new Date().toISOString().split('T')[0];
        const actionsFile = path.join(LOG_DIR, `actions-${dateStr}.json`);
        const installsFile = path.join(LOG_DIR, `installs-${dateStr}.json`);

        let actionsCount = 0;
        let installsCount = 0;
        const uniqueUsers = new Set();

        if (fs.existsSync(actionsFile)) {
            const lines = (await fsPromises.readFile(actionsFile, 'utf8')).split('\n').filter(Boolean);
            actionsCount = lines.length;
            lines.forEach((line) => {
                try {
                    const entry = JSON.parse(line);
                    if (entry.userId) uniqueUsers.add(entry.userId);
                } catch (parseErr) {
                    logger.warn(`[USER-ACTIONS] stats skipped malformed line: ${parseErr.message}`);
                }
            });
        }
        if (fs.existsSync(installsFile)) {
            installsCount = (await fsPromises.readFile(installsFile, 'utf8')).split('\n').filter(Boolean).length;
        }

        res.json({
            date: dateStr,
            actionsToday: actionsCount,
            installsToday: installsCount,
            uniqueUsersToday: uniqueUsers.size,
        });
    } catch (error) {
        return sendLogError(res, error, 'USER_ACTION_STATS_ERROR');
    }
});

module.exports = router;
