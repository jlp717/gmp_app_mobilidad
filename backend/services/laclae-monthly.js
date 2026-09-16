'use strict';

/**
 * Monthly LACLAE rollup in JAVIER only.
 * Enabled when LACLAE_MONTHLY_ENABLED is not 'false' AND the table has rows.
 */

const TABLE = 'JAVIER.LACLAE_MONTHLY';
let readyMemo = { at: 0, ok: false };

function isMonthlyFlagOn(env = process.env) {
  return String(env.LACLAE_MONTHLY_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function monthlyTable() {
  return TABLE;
}

async function isLaclaeMonthlyReady(queryWithParams, env = process.env) {
  if (!isMonthlyFlagOn(env)) return false;
  if (Date.now() - readyMemo.at < 30_000) return readyMemo.ok;
  try {
    const exists = await queryWithParams(
      `SELECT 1 AS OK
         FROM QSYS2.SYSTABLES
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
        FETCH FIRST 1 ROW ONLY`,
      ['JAVIER', 'LACLAE_MONTHLY'],
    );
    if (!exists?.length) {
      readyMemo = { at: Date.now(), ok: false };
      return false;
    }
    const probe = await queryWithParams(
      `SELECT ANO FROM ${TABLE} FETCH FIRST 1 ROW ONLY`,
      [],
    );
    readyMemo = { at: Date.now(), ok: Array.isArray(probe) && probe.length > 0 };
    return readyMemo.ok;
  } catch (_) {
    readyMemo = { at: Date.now(), ok: false };
    return false;
  }
}

function resetLaclaeMonthlyReadyMemo() {
  readyMemo = { at: 0, ok: false };
}

module.exports = {
  monthlyTable,
  isMonthlyFlagOn,
  isLaclaeMonthlyReady,
  resetLaclaeMonthlyReadyMemo,
};
