/**
 * GMP App - TensorFlow.js Predictive Cache
 * =========================================
 * ML-based cache prediction using TensorFlow.js
 * Predicts which data users will need next
 */

const tf = require('@tensorflow/tfjs-node');
const logger = require('../../middleware/logger');
const { redisCache, TTL } = require('../redis-cache');
const fs = require('fs');
const path = require('path');

// Model configuration
const MODEL_CONFIG = {
    inputFeatures: 10,
    hiddenUnits: [64, 32, 16],
    outputClasses: 20, // Top 20 cacheable endpoints
    learningRate: 0.001,
    batchSize: 32,
    epochs: 50,
    modelPath: path.join(__dirname, '../../models/cache-predictor'),
};

// Access pattern history
const accessHistory = [];
const MAX_HISTORY = 10000;

// Endpoint to index mapping
const endpointIndex = new Map();
const indexToEndpoint = new Map();
let nextEndpointIndex = 0;

class PredictiveCacheService {
    constructor() {
        this.model = null;
        this.isTraining = false;
        this.lastPrediction = null;
        this.stats = {
            predictions: 0,
            hits: 0,
            prefetches: 0,
            modelVersion: 0,
        };
    }

    /**
     * Initialize the predictive cache service
     */
    async init() {
        try {
            // Try to load existing model
            if (fs.existsSync(MODEL_CONFIG.modelPath)) {
                this.model = await tf.loadLayersModel(`file://${MODEL_CONFIG.modelPath}/model.json`);
                logger.info('[PredictiveCache] ✅ Loaded existing model');
            } else {
                // Create new model
                this.model = this._createModel();
                logger.info('[PredictiveCache] ✅ Created new model');
            }
            return true;
        } catch (error) {
            logger.warn(`[PredictiveCache] ⚠️ Init error: ${error.message}`);
            return false;
        }
    }

    /**
     * Create neural network model
     */
    _createModel() {
        const model = tf.sequential();

        // Input layer
        model.add(tf.layers.dense({
            units: MODEL_CONFIG.hiddenUnits[0],
            activation: 'relu',
            inputShape: [MODEL_CONFIG.inputFeatures],
        }));

        // Hidden layers
        for (let i = 1; i < MODEL_CONFIG.hiddenUnits.length; i++) {
            model.add(tf.layers.dense({
                units: MODEL_CONFIG.hiddenUnits[i],
                activation: 'relu',
            }));
            model.add(tf.layers.dropout({ rate: 0.2 }));
        }

        // Output layer (softmax for probability distribution)
        model.add(tf.layers.dense({
            units: MODEL_CONFIG.outputClasses,
            activation: 'softmax',
        }));

        // Compile model
        model.compile({
            optimizer: tf.train.adam(MODEL_CONFIG.learningRate),
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy'],
        });

        return model;
    }

    /**
     * Record access pattern
     */
    recordAccess(userId, endpoint, metadata = {}) {
        const now = Date.now();
        const hour = new Date().getHours();
        const dayOfWeek = new Date().getDay();

        // Register endpoint if new
        if (!endpointIndex.has(endpoint)) {
            endpointIndex.set(endpoint, nextEndpointIndex);
            indexToEndpoint.set(nextEndpointIndex, endpoint);
            nextEndpointIndex++;
        }

        // Create access record
        const record = {
            userId,
            endpoint,
            endpointIdx: endpointIndex.get(endpoint),
            timestamp: now,
            hour,
            dayOfWeek,
            sessionDuration: metadata.sessionDuration || 0,
            previousEndpoint: accessHistory.length > 0 ? accessHistory[accessHistory.length - 1].endpoint : null,
            deviceType: metadata.deviceType || 'unknown',
            ...metadata,
        };

        accessHistory.push(record);

        // Limit history size
        if (accessHistory.length > MAX_HISTORY) {
            accessHistory.shift();
        }

        return record;
    }

    /**
     * Extract features from access history
     */
    _extractFeatures(history, targetIdx) {
        const features = [];

        for (let i = targetIdx - 1; i >= Math.max(0, targetIdx - 5); i--) {
            const record = history[i];
            features.push(
                record.endpointIdx / MODEL_CONFIG.outputClasses, // Normalized endpoint
                record.hour / 24, // Normalized hour
                record.dayOfWeek / 7, // Normalized day
            );
        }

        // Pad if not enough history
        while (features.length < MODEL_CONFIG.inputFeatures) {
            features.push(0);
        }

        return features.slice(0, MODEL_CONFIG.inputFeatures);
    }

    /**
     * Predict next endpoints user will access
     */
    async predict(userId, currentEndpoint) {
        if (!this.model) {
            await this.init();
        }

        try {
            // Get user's recent history
            const userHistory = accessHistory.filter(r => r.userId === userId).slice(-10);

            if (userHistory.length < 3) {
                // Not enough history, return popular endpoints
                return this._getPopularEndpoints();
            }

            // Extract features
            const features = this._extractFeatures(userHistory, userHistory.length);

            // Make prediction
            const inputTensor = tf.tensor2d([features]);
            const prediction = this.model.predict(inputTensor);
            const probabilities = await prediction.data();

            // Clean up tensors
            inputTensor.dispose();
            prediction.dispose();

            // Get top 5 predictions
            const predictions = Array.from(probabilities)
                .map((prob, idx) => ({ endpoint: indexToEndpoint.get(idx), probability: prob }))
                .filter(p => p.endpoint && p.endpoint !== currentEndpoint)
                .sort((a, b) => b.probability - a.probability)
                .slice(0, 5);

            this.stats.predictions++;
            this.lastPrediction = {
                timestamp: new Date(),
                predictions,
            };

            return predictions;
        } catch (error) {
            logger.warn(`[PredictiveCache] Prediction error: ${error.message}`);
            return this._getPopularEndpoints();
        }
    }

    /**
     * Get most popular endpoints as fallback
     */
    _getPopularEndpoints() {
        const counts = {};
        for (const record of accessHistory.slice(-1000)) {
            counts[record.endpoint] = (counts[record.endpoint] || 0) + 1;
        }

        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([endpoint, count]) => ({
                endpoint,
                probability: count / accessHistory.length,
            }));
    }

    /**
     * Prefetch predicted endpoints
     */
    async prefetch(predictions, fetchFn) {
        const prefetched = [];

        for (const { endpoint, probability } of predictions) {
            // Only prefetch if probability > 30%
            if (probability < 0.3) continue;

            try {
                // Check if already cached
                const cached = await redisCache.get('prefetch', endpoint);
                if (cached) continue;

                // Fetch and cache
                const data = await fetchFn(endpoint);
                await redisCache.set('prefetch', endpoint, data, TTL.SHORT);

                prefetched.push(endpoint);
                this.stats.prefetches++;
            } catch (error) {
                logger.warn(`[PredictiveCache] Prefetch error for ${endpoint}: ${error.message}`);
            }
        }

        if (prefetched.length > 0) {
            logger.info(`[PredictiveCache] 🔮 Prefetched: ${prefetched.join(', ')}`);
        }

        return prefetched;
    }

    /**
     * Train model on accumulated history
     */
    async train() {
        if (this.isTraining) {
            logger.warn('[PredictiveCache] Training already in progress');
            return false;
        }

        if (accessHistory.length < 100) {
            logger.warn('[PredictiveCache] Not enough data for training');
            return false;
        }

        this.isTraining = true;
        logger.info('[PredictiveCache] 🎓 Starting model training...');

        try {
            // Prepare training data
            const { xs, ys } = this._prepareTrainingData();

            // Train
            await this.model.fit(xs, ys, {
                epochs: MODEL_CONFIG.epochs,
                batchSize: MODEL_CONFIG.batchSize,
                validationSplit: 0.2,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        if (epoch % 10 === 0) {
                            logger.info(`[PredictiveCache] Epoch ${epoch}: loss=${logs.loss.toFixed(4)}, acc=${logs.acc.toFixed(4)}`);
                        }
                    },
                },
            });

            // Save model
            await this._saveModel();

            // Cleanup tensors
            xs.dispose();
            ys.dispose();

            this.stats.modelVersion++;
            logger.info('[PredictiveCache] ✅ Training complete');

            return true;
        } catch (error) {
            logger.error(`[PredictiveCache] Training error: ${error.message}`);
            return false;
        } finally {
            this.isTraining = false;
        }
    }

    /**
     * Prepare training data
     */
    _prepareTrainingData() {
        const xData = [];
        const yData = [];

        for (let i = 5; i < accessHistory.length; i++) {
            const features = this._extractFeatures(accessHistory, i);
            const targetIdx = accessHistory[i].endpointIdx % MODEL_CONFIG.outputClasses;

            // One-hot encode target
            const oneHot = new Array(MODEL_CONFIG.outputClasses).fill(0);
            oneHot[targetIdx] = 1;

            xData.push(features);
            yData.push(oneHot);
        }

        return {
            xs: tf.tensor2d(xData),
            ys: tf.tensor2d(yData),
        };
    }

    /**
     * Save model to disk
     */
    async _saveModel() {
        if (!fs.existsSync(MODEL_CONFIG.modelPath)) {
            fs.mkdirSync(MODEL_CONFIG.modelPath, { recursive: true });
        }
        await this.model.save(`file://${MODEL_CONFIG.modelPath}`);
        logger.info(`[PredictiveCache] Model saved to ${MODEL_CONFIG.modelPath}`);
    }

    /**
     * Get service statistics
     */
    getStats() {
        const hitRate = this.stats.predictions > 0
            ? (this.stats.hits / this.stats.predictions * 100).toFixed(2)
            : 0;

        return {
            ...this.stats,
            hitRate: `${hitRate}%`,
            historySize: accessHistory.length,
            uniqueEndpoints: endpointIndex.size,
            isTraining: this.isTraining,
            lastPrediction: this.lastPrediction,
        };
    }
}

// Singleton instance
const predictiveCache = new PredictiveCacheService();

module.exports = {
    predictiveCache,
    initPredictiveCache: () => predictiveCache.init(),
    recordAccess: (userId, endpoint, meta) => predictiveCache.recordAccess(userId, endpoint, meta),
    predict: (userId, endpoint) => predictiveCache.predict(userId, endpoint),
    prefetch: (predictions, fn) => predictiveCache.prefetch(predictions, fn),
    trainModel: () => predictiveCache.train(),
    getPredictiveStats: () => predictiveCache.getStats(),
};
