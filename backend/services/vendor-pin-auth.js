'use strict';

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');
const {
    verifyPassword,
    hashPassword,
    allowPlaintextPinAuth,
} = require('../middleware/auth');

const BCRYPT_PIN_RE = /^\$2[aby]\$/;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

// Lockout por CUENTA (complementa al lockout por IP de bruteForceIpTracker):
// N fallos de PIN para el mismo vendedor en la ventana => bloqueo temporal.
const PIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const PIN_LOCKOUT_MS = 30 * 60 * 1000;
const PIN_MAX_FAILURES = parseInt(process.env.PIN_MAX_FAILURES || '5', 10);
const pinFailureTracker = new Map();

function pinAccountLocked(code) {
    const entry = pinFailureTracker.get(code);
    if (!entry) return false;
    if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
        pinFailureTracker.delete(code);
        return false;
    }
    return Boolean(entry.lockedUntil);
}

function recordPinFailure(code, requestId) {
    const now = Date.now();
    let entry = pinFailureTracker.get(code);
    if (!entry || now - entry.lastFail > PIN_FAILURE_WINDOW_MS) {
        entry = { failures: 0, lastFail: now, lockedUntil: null };
    }
    entry.failures += 1;
    entry.lastFail = now;
    if (entry.failures >= PIN_MAX_FAILURES) {
        entry.lockedUntil = now + PIN_LOCKOUT_MS;
        logger.warn(`[${requestId}] PIN account lockout for vendor ${code}: ${entry.failures} failures — locked 30min`);
    }
    pinFailureTracker.set(code, entry);

    // Limpieza periodica de entradas frias (unref: no impide el exit).
    if (pinFailureTracker.size > 500) {
        for (const [k, v] of pinFailureTracker) {
            if (now - v.lastFail > PIN_FAILURE_WINDOW_MS * 4 && !v.lockedUntil) {
                pinFailureTracker.delete(k);
            }
        }
    }
}

function clearPinFailures(code) {
    pinFailureTracker.delete(code);
}

function normalizePin(value) {
    return value == null ? '' : String(value).trim();
}

function isBcryptHash(value) {
    return BCRYPT_PIN_RE.test(normalizePin(value));
}

async function loadMigratedPinHash(vendedorCode, requestId = 'auth') {
    try {
        const rows = await queryWithParams(`
            SELECT PIN_HASH
            FROM JAVIER.VENDOR_PIN_HASHES
            WHERE CODIGOVENDEDOR = ?
        `, [vendedorCode], false);
        return normalizePin(rows?.[0]?.PIN_HASH) || null;
    } catch (error) {
        logger.debug(`[${requestId}] PIN hash lookup unavailable for vendor ${vendedorCode}: ${error.message}`);
        return null;
    }
}

async function migratePlaintextPinHash(vendedorCode, candidatePin, requestId = 'auth') {
    try {
        const newHash = await hashPassword(candidatePin, BCRYPT_ROUNDS);
        await queryWithParams(`
            MERGE INTO JAVIER.VENDOR_PIN_HASHES AS target
            USING (VALUES(CAST(? AS VARCHAR(20)), CAST(? AS VARCHAR(100))))
                AS source(CODIGOVENDEDOR, PIN_HASH)
            ON target.CODIGOVENDEDOR = source.CODIGOVENDEDOR
            WHEN MATCHED THEN
                UPDATE SET PIN_HASH = source.PIN_HASH, UPDATED_AT = CURRENT_TIMESTAMP
            WHEN NOT MATCHED THEN
                INSERT (CODIGOVENDEDOR, PIN_HASH, UPDATED_AT)
                VALUES (source.CODIGOVENDEDOR, source.PIN_HASH, CURRENT_TIMESTAMP)
        `, [vendedorCode, newHash], false);
        logger.info(`[${requestId}] Migrated vendor ${vendedorCode} PIN to bcrypt hash`);
    } catch (error) {
        logger.warn(`[${requestId}] Failed to migrate PIN hash for ${vendedorCode}: ${error.message}`);
    }
}

async function verifyVendorPin({ vendedorCode, candidatePin, dbPin, requestId = 'auth' }) {
    const code = normalizePin(vendedorCode);
    const pin = normalizePin(candidatePin);
    const legacyPin = normalizePin(dbPin);

    if (!code || !pin) {
        return { valid: false, reason: 'missing_vendor_or_pin' };
    }

    if (pinAccountLocked(code)) {
        logger.warn(`[${requestId}] Rejected PIN attempt on locked vendor ${code}`);
        return { valid: false, reason: 'account_locked' };
    }

    const migratedHash = await loadMigratedPinHash(code, requestId);
    if (migratedHash) {
        const valid = await verifyPassword(pin, migratedHash);
        if (valid) clearPinFailures(code); else recordPinFailure(code, requestId);
        return {
            valid,
            method: valid ? 'migrated_hash' : null,
            reason: valid ? null : 'migrated_hash_mismatch',
        };
    }

    if (isBcryptHash(legacyPin)) {
        const valid = await verifyPassword(pin, legacyPin);
        if (valid) clearPinFailures(code); else recordPinFailure(code, requestId);
        return {
            valid,
            method: valid ? 'legacy_bcrypt' : null,
            reason: valid ? null : 'legacy_bcrypt_mismatch',
        };
    }

    if (legacyPin && legacyPin === pin) {
        if (!allowPlaintextPinAuth()) {
            recordPinFailure(code, requestId);
            return { valid: false, reason: 'plaintext_pin_denied' };
        }
        await migratePlaintextPinHash(code, pin, requestId);
        clearPinFailures(code);
        return { valid: true, method: 'plaintext_migrated' };
    }

    recordPinFailure(code, requestId);
    return { valid: false, reason: 'pin_mismatch' };
}

module.exports = {
    verifyVendorPin,
    _private: {
        isBcryptHash,
        loadMigratedPinHash,
        migratePlaintextPinHash,
        pinAccountLocked,
        recordPinFailure,
        clearPinFailures,
    },
};
