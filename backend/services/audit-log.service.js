'use strict';

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

let _auditTableExists = null;

async function auditTableExists() {
  if (_auditTableExists !== null) return _auditTableExists;
  try {
    await queryWithParams(
      `SELECT 1 FROM JAVIER.REPARTIDOR_COBROS_AUDIT FETCH FIRST 1 ROW ONLY`,
      [],
      false,
      false,
    );
    _auditTableExists = true;
  } catch (error) {
    const msg = String(error.message || '').toLowerCase();
    const odbcStates = (error.odbcErrors || []).map((e) => e.state);
    if (msg.includes('not found') || odbcStates.includes('42S02') || msg.includes('-204')) {
      _auditTableExists = false;
    } else {
      _auditTableExists = false;
      logger.warn(`[AUDIT_LOG] Unexpected error checking audit table: ${error.message}`);
    }
  }
  return _auditTableExists;
}

function safePreview(value, maxLength = 80) {
  const raw = String(value || '').trim();
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength)}...`;
}

function hashTokenPreview(token) {
  if (!token) return '';
  if (token.length <= 16) return token;
  return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

async function logPaymentEvent({
  eventType,
  operador,
  codigoRepartidor,
  idempotencyToken,
  documento,
  payload,
  errorCode,
}) {
  const exists = await auditTableExists();
  if (!exists) {
    logger.warn(`[AUDIT_LOG] Skipping audit log: REPARTIDOR_COBROS_AUDIT does not exist. eventType=${eventType}`);
    return;
  }

  const tokenPreview = hashTokenPreview(idempotencyToken);
  const docPreview = safePreview(documento, 100);
  const payloadPreview = safePreview(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    500,
  );

  try {
    await queryWithParams(
      `INSERT INTO JAVIER.REPARTIDOR_COBROS_AUDIT (
        EVENT_TYPE, OPERADOR, CODIGO_REPARTIDOR,
        IDEMPOTENCY_TOKEN_PREVIEW, DOCUMENTO_PREVIEW,
        PAYLOAD_PREVIEW, ERROR_CODE
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        eventType,
        operador || '',
        codigoRepartidor || '',
        tokenPreview,
        docPreview,
        payloadPreview,
        errorCode || '',
      ],
      false,
      false,
    );
  } catch (error) {
    logger.warn(`[AUDIT_LOG] Failed to write audit entry: ${error.message}`);
  }
}

module.exports = {
  logPaymentEvent,
  hashTokenPreview,
};
