/**
 * Feature Flags Configuration
 * ============================
 * Centralized feature flags for progressive rollout.
 * Flags are read from environment variables with safe defaults.
 *
 * Usage:
 *   const { flags } = require('./config/feature-flags');
 *   if (flags.SHOW_IVA_BREAKDOWN) { ... }
 */

const logger = require('../middleware/logger');

const flags = {
    /**
     * SHOW_IVA_BREAKDOWN
     * When true: repartidor endpoints return netoSum, ivaSum, ivaBreakdown[], checksum
     * When false: only importe (backward compatible)
     * Default: false (off)
     */
    SHOW_IVA_BREAKDOWN: process.env.SHOW_IVA_BREAKDOWN === 'true',

    /**
     * CANARY_REPARTIDORES
     * Comma-separated list of repartidor IDs for canary rollout.
     * If set and SHOW_IVA_BREAKDOWN is true, only these repartidores get the new fields.
     * If empty, all repartidores get it (when flag is true).
     */
    CANARY_REPARTIDORES: (process.env.CANARY_REPARTIDORES || '').split(',').map(s => s.trim()).filter(Boolean),
};

/**
 * Check if a repartidor should see IVA breakdown.
 * @param {string} repartidorId
 * @returns {boolean}
 */
function shouldShowIvaBreakdown(repartidorId) {
    if (!flags.SHOW_IVA_BREAKDOWN) return false;
    if (flags.CANARY_REPARTIDORES.length === 0) return true; // All repartidores
    return flags.CANARY_REPARTIDORES.includes(repartidorId.trim());
}

// Log active flags on load (mask sensitive data)
logger.info(`[FEATURE_FLAGS] SHOW_IVA_BREAKDOWN=${flags.SHOW_IVA_BREAKDOWN}, CANARY_REPARTIDORES=[${flags.CANARY_REPARTIDORES.length} IDs]`);

module.exports = { flags, shouldShowIvaBreakdown };
