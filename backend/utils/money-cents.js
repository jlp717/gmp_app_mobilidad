'use strict';

/**
 * Money in integer cents. Number.EPSILON makes values like 0.005 become 0.01.
 * A 1e-8 nudge only corrects binary noise (8.43 * 100 === 842.9999999999999).
 */
function moneyCents(raw) {
  const number = Number(raw);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100 + Math.sign(number) * 1e-8);
}

function roundMoney(raw) {
  return moneyCents(raw) / 100;
}

function sumMoney(values) {
  const cents = (values || []).reduce((total, value) => total + moneyCents(value), 0);
  return cents / 100;
}

/**
 * A day with no collections, expenses or adjustments must not show a phantom
 * cent in "Total a ingresar". A real carried balance above one cent stays.
 */
function settleIdleDeposit({
  cobrosCount = 0,
  totalEfectivo = 0,
  totalCheques = 0,
  totalTarjeta = 0,
  totalPostdatados = 0,
  gastos = 0,
  ajustes = 0,
  ingresoBanco = 0,
  saldoActual = 0,
  totalAIngresar = 0,
} = {}) {
  const idle = [
    cobrosCount,
    totalEfectivo,
    totalCheques,
    totalTarjeta,
    totalPostdatados,
    gastos,
    ajustes,
    ingresoBanco,
  ].every((value) => moneyCents(value) === 0);
  const depositCents = moneyCents(totalAIngresar);
  if (idle && Math.abs(depositCents) <= 1) {
    return Object.freeze({ saldoActual: 0, totalAIngresar: 0 });
  }
  return Object.freeze({
    saldoActual: roundMoney(saldoActual),
    totalAIngresar: depositCents / 100,
  });
}

module.exports = {
  moneyCents,
  roundMoney,
  sumMoney,
  settleIdleDeposit,
};
