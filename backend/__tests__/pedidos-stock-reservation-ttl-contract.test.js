'use strict';

const fs = require('fs');
const path = require('path');

const sharedSource = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'pedidos', '_shared.js'),
  'utf8',
);
const pedidosSource = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'pedidos', 'index.js'),
  'utf8',
);

describe('24-hour draft stock reservation boundary', () => {
  test('availability is based on immutable order creation time and excludes the exact cutoff', () => {
    expect(sharedSource).toMatch(
      /C\.CREATED_AT\s*>\s*CURRENT TIMESTAMP\s*-\s*\$\{DRAFT_STOCK_RESERVATION_HOURS\}\s+HOURS/,
    );
    expect(sharedSource).not.toMatch(
      /SR\.CREATED_AT\s*(?:>|>=)\s*CURRENT TIMESTAMP\s*-\s*\$\{DRAFT_STOCK_RESERVATION_HOURS\}/,
    );
  });

  test('purge owns the complementary exact cutoff on the DB clock', () => {
    const purgeStart = pedidosSource.indexOf('async function purgeExpiredDraftReservations');
    const purgeEnd = pedidosSource.indexOf('async function cancelOrder', purgeStart);
    const purgeSource = pedidosSource.slice(purgeStart, purgeEnd);

    expect(purgeSource).toMatch(
      /C\.CREATED_AT\s*<=\s*CURRENT TIMESTAMP\s*-\s*\$\{DRAFT_STOCK_RESERVATION_HOURS\}\s+HOURS/,
    );
    expect(purgeSource).toMatch(
      /AND CREATED_AT\s*<=\s*CURRENT TIMESTAMP\s*-\s*\$\{DRAFT_STOCK_RESERVATION_HOURS\}\s+HOURS/g,
    );
    expect(purgeSource).not.toMatch(
      /CREATED_AT\s*<\s*CURRENT TIMESTAMP\s*-\s*\$\{DRAFT_STOCK_RESERVATION_HOURS\}/,
    );
  });

  test('editing reservation rows cannot renew the canonical order timestamp', () => {
    const refreshStart = pedidosSource.indexOf('async function refreshDraftStockReservation');
    const refreshEnd = pedidosSource.indexOf('async function initPedidosTables', refreshStart);
    const refreshSource = pedidosSource.slice(refreshStart, refreshEnd);

    expect(refreshSource).not.toMatch(/UPDATE\s+[^;]*PEDIDOS_CAB[^;]*CREATED_AT/is);
  });
});

