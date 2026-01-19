/**
 * GMP User Action Logging - Track app usage for closed testing
 * Logs all user actions to local files for monitoring
 */
const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const fs = require('fs');
const path = require('path');

// Log directory
const LOG_DIR = path.join(__dirname, '../logs/user-actions');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * POST /api/logs/user-action
 * Log user actions (screen views, button clicks, etc.)
 */
router.post('/user-action', async (req, res) => {
    try {
        const {
            userId,
            userEmail,
            action,
            screen,
            metadata = {},
            appVersion,
            deviceInfo
        } = req.body;

        const logEntry = {
            timestamp: new Date().toISOString(),
            userId,
            userEmail,
            action,
            screen,
            metadata,
            appVersion,
            deviceInfo,
            ip: req.ip || req.connection?.remoteAddress || 'unknown'
        };

        // Write to daily log file
        const dateStr = new Date().toISOString().split('T')[0];
        const logFile = path.join(LOG_DIR, `actions-${dateStr}.json`);
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');

        logger.info(`📱 Action: ${userId} → ${action} @ ${screen}`);
        res.json({ success: true });
    } catch (error) {
        logger.error(`Logging error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/logs/app-install
 * Track new app installations
 */
router.post('/app-install', async (req, res) => {
    try {
        const {
            userId,
            userEmail,
            appVersion,
            deviceModel,
            osVersion
        } = req.body;

        const logEntry = {
            timestamp: new Date().toISOString(),
            event: 'APP_INSTALL',
            userId,
            userEmail,
            appVersion,
            deviceModel,
            osVersion,
            ip: req.ip
        };

        const dateStr = new Date().toISOString().split('T')[0];
        const logFile = path.join(LOG_DIR, `installs-${dateStr}.json`);
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');

        logger.info(`📲 NEW INSTALL: ${userEmail} v${appVersion} on ${deviceModel}`);
        res.json({ success: true, registered: true });
    } catch (error) {
        logger.error(`Install log error: ${error.message}`);
        res.status(500).json({ error: error.message });
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

        let actionsCount = 0, installsCount = 0, uniqueUsers = new Set();

        if (fs.existsSync(actionsFile)) {
            const lines = fs.readFileSync(actionsFile, 'utf8').split('\n').filter(Boolean);
            actionsCount = lines.length;
            lines.forEach(line => {
                try {
                    const entry = JSON.parse(line);
                    if (entry.userId) uniqueUsers.add(entry.userId);
                } catch (e) { }
            });
        }
        if (fs.existsSync(installsFile)) {
            installsCount = fs.readFileSync(installsFile, 'utf8').split('\n').filter(Boolean).length;
        }

        res.json({
            date: dateStr,
            actionsToday: actionsCount,
            installsToday: installsCount,
            uniqueUsersToday: uniqueUsers.size
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
