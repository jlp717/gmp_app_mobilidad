/**
 * GMP App - WebSocket Cache Manager
 * ===================================
 * Real-time cache invalidation via WebSockets
 * Enables instant cache sync across all connected clients
 */

const WebSocket = require('ws');
const logger = require('../middleware/logger');
const { redisCache } = require('./redis-cache');

// Configuration
const WS_PORT = parseInt(process.env.WS_PORT, 10) || 3335;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

class WebSocketCacheManager {
    constructor() {
        this.wss = null;
        this.clients = new Map(); // clientId -> { ws, subscriptions, lastHeartbeat }
        this.heartbeatInterval = null;
        this.messageHandlers = new Map();
        this.stats = {
            totalConnections: 0,
            activeConnections: 0,
            messagesReceived: 0,
            messagesSent: 0,
            invalidationsBroadcast: 0,
        };
    }

    /**
     * Initialize WebSocket server
     */
    init(server = null) {
        try {
            if (server) {
                // Attach to existing HTTP server
                this.wss = new WebSocket.Server({ server, path: '/ws/cache' });
            } else {
                // Create standalone server
                this.wss = new WebSocket.Server({ port: WS_PORT });
            }

            this.wss.on('connection', (ws, req) => this._handleConnection(ws, req));
            this.wss.on('error', (error) => {
                logger.error(`[WSCache] Server error: ${error.message}`);
            });

            // Start heartbeat checker
            this._startHeartbeat();

            // Setup message handlers
            this._setupMessageHandlers();

            logger.info(`[WSCache] ✅ WebSocket server started on port ${WS_PORT}`);
            return true;
        } catch (error) {
            logger.error(`[WSCache] ❌ Failed to start: ${error.message}`);
            return false;
        }
    }

    /**
     * Handle new WebSocket connection
     */
    _handleConnection(ws, req) {
        const clientId = this._generateClientId();
        const clientIp = req.socket.remoteAddress;

        // Store client
        this.clients.set(clientId, {
            ws,
            subscriptions: new Set(['default']),
            lastHeartbeat: Date.now(),
            ip: clientIp,
            connectedAt: new Date(),
        });

        this.stats.totalConnections++;
        this.stats.activeConnections = this.clients.size;

        logger.info(`[WSCache] Client connected: ${clientId} from ${clientIp}`);

        // Send welcome message with client ID
        this._send(ws, {
            type: 'connected',
            clientId,
            timestamp: new Date().toISOString(),
        });

        // Handle messages
        ws.on('message', (data) => {
            this.stats.messagesReceived++;
            this._handleMessage(clientId, data);
        });

        // Handle disconnect
        ws.on('close', () => {
            this.clients.delete(clientId);
            this.stats.activeConnections = this.clients.size;
            logger.info(`[WSCache] Client disconnected: ${clientId}`);
        });

        // Handle errors
        ws.on('error', (error) => {
            logger.warn(`[WSCache] Client ${clientId} error: ${error.message}`);
        });

        // Handle pong (heartbeat response)
        ws.on('pong', () => {
            const client = this.clients.get(clientId);
            if (client) {
                client.lastHeartbeat = Date.now();
            }
        });
    }

    /**
     * Setup message handlers
     */
    _setupMessageHandlers() {
        // Subscribe to cache keys
        this.messageHandlers.set('subscribe', (clientId, data) => {
            const client = this.clients.get(clientId);
            if (client && data.channels) {
                data.channels.forEach(channel => client.subscriptions.add(channel));
                logger.info(`[WSCache] Client ${clientId} subscribed to: ${data.channels.join(', ')}`);
            }
        });

        // Unsubscribe from cache keys
        this.messageHandlers.set('unsubscribe', (clientId, data) => {
            const client = this.clients.get(clientId);
            if (client && data.channels) {
                data.channels.forEach(channel => client.subscriptions.delete(channel));
            }
        });

        // Request cache invalidation
        this.messageHandlers.set('invalidate', (clientId, data) => {
            if (data.pattern) {
                this.broadcastInvalidation(data.pattern, clientId);
            }
        });

        // Heartbeat
        this.messageHandlers.set('ping', (clientId) => {
            const client = this.clients.get(clientId);
            if (client) {
                client.lastHeartbeat = Date.now();
                this._send(client.ws, { type: 'pong', timestamp: Date.now() });
            }
        });
    }

    /**
     * Handle incoming message
     */
    _handleMessage(clientId, rawData) {
        try {
            const data = JSON.parse(rawData.toString());
            const handler = this.messageHandlers.get(data.type);

            if (handler) {
                handler(clientId, data);
            } else {
                logger.warn(`[WSCache] Unknown message type: ${data.type}`);
            }
        } catch (error) {
            logger.warn(`[WSCache] Invalid message from ${clientId}: ${error.message}`);
        }
    }

    /**
     * Broadcast cache invalidation to all subscribed clients
     */
    broadcastInvalidation(pattern, excludeClientId = null) {
        const message = {
            type: 'cache_invalidation',
            pattern,
            timestamp: new Date().toISOString(),
        };

        let sentCount = 0;
        for (const [clientId, client] of this.clients) {
            if (clientId === excludeClientId) continue;

            // Check if client is subscribed to this pattern
            if (this._matchesSubscription(pattern, client.subscriptions)) {
                if (this._send(client.ws, message)) {
                    sentCount++;
                }
            }
        }

        // Also invalidate in Redis cache
        redisCache.invalidatePattern(pattern).catch(err => {
            logger.warn(`[WSCache] Redis invalidation failed: ${err.message}`);
        });

        this.stats.invalidationsBroadcast++;
        logger.info(`[WSCache] 📢 Broadcast invalidation: ${pattern} (${sentCount} clients)`);

        return sentCount;
    }

    /**
     * Check if pattern matches any subscription
     */
    _matchesSubscription(pattern, subscriptions) {
        if (subscriptions.has('default') || subscriptions.has('*')) {
            return true;
        }

        for (const sub of subscriptions) {
            if (pattern.startsWith(sub) || sub.startsWith(pattern.split('*')[0])) {
                return true;
            }
        }

        return false;
    }

    /**
     * Send message to client
     */
    _send(ws, data) {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(data));
                this.stats.messagesSent++;
                return true;
            }
        } catch (error) {
            logger.warn(`[WSCache] Send error: ${error.message}`);
        }
        return false;
    }

    /**
     * Start heartbeat checker
     */
    _startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            const now = Date.now();
            const timeout = HEARTBEAT_INTERVAL * 2;

            for (const [clientId, client] of this.clients) {
                if (now - client.lastHeartbeat > timeout) {
                    // Client unresponsive, terminate
                    logger.warn(`[WSCache] Client ${clientId} unresponsive, terminating`);
                    client.ws.terminate();
                    this.clients.delete(clientId);
                } else {
                    // Send ping
                    if (client.ws.readyState === WebSocket.OPEN) {
                        client.ws.ping();
                    }
                }
            }

            this.stats.activeConnections = this.clients.size;
        }, HEARTBEAT_INTERVAL);
    }

    /**
     * Generate unique client ID
     */
    _generateClientId() {
        return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get connection statistics
     */
    getStats() {
        return {
            ...this.stats,
            clients: Array.from(this.clients.entries()).map(([id, client]) => ({
                id,
                ip: client.ip,
                subscriptions: Array.from(client.subscriptions),
                connectedAt: client.connectedAt,
                lastHeartbeat: new Date(client.lastHeartbeat),
            })),
        };
    }

    /**
     * Notify all clients of data change
     * Use this when data is updated via API
     */
    notifyDataChange(entityType, entityId, action = 'updated') {
        const pattern = `${entityType}:*`;
        const message = {
            type: 'data_change',
            entityType,
            entityId,
            action, // 'created', 'updated', 'deleted'
            timestamp: new Date().toISOString(),
        };

        // Broadcast to all clients
        for (const [clientId, client] of this.clients) {
            this._send(client.ws, message);
        }

        // Invalidate cache
        this.broadcastInvalidation(pattern);
    }

    /**
     * Shutdown WebSocket server
     */
    close() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        if (this.wss) {
            // Close all connections
            for (const [clientId, client] of this.clients) {
                client.ws.close(1000, 'Server shutting down');
            }

            this.wss.close(() => {
                logger.info('[WSCache] Server closed');
            });
        }
    }
}

// Singleton instance
const wsCacheManager = new WebSocketCacheManager();

module.exports = {
    wsCacheManager,
    initWSCache: (server) => wsCacheManager.init(server),
    broadcastInvalidation: (pattern) => wsCacheManager.broadcastInvalidation(pattern),
    notifyDataChange: (type, id, action) => wsCacheManager.notifyDataChange(type, id, action),
    getWSStats: () => wsCacheManager.getStats(),
};
