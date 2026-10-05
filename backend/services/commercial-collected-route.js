'use strict';

const COBRO_COMERCIAL_MARKER = '[COBRO_COMERCIAL]';

const ALLOWED_PAIRS = Object.freeze({
  'JAVIER.TEST_PEDIDOS_CAB': 'JAVIER.TEST_COBROS',
  'JAVIER.PEDIDOS_CAB': 'JAVIER.COBROS',
});

function text(value) {
  return String(value ?? '').trim();
}

function roundMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function paymentCovers(paid, total) {
  const paidCents = Math.round(roundMoney(paid) * 100);
  const totalCents = Math.round(roundMoney(total) * 100);
  if (paidCents <= 0) return false;
  if (totalCents <= 0) return true;
  return paidCents + 1 >= totalCents;
}

function documentIdentity(cliente, serie, terminal, numero) {
  const client = text(cliente);
  const series = text(serie);
  const number = Number(numero);
  const term = Number(terminal);
  if (!client || !series || !Number.isFinite(number) || number <= 0) return null;
  if (!Number.isFinite(term) || term < 0) return null;
  return `${client}|${series}|${term}|${number}`;
}

function parseCobroReference(raw) {
  const ref = text(raw);
  const pedido = /^PEDIDO:(\d+):(.+)$/.exec(ref);
  const body = pedido ? pedido[2] : ref.replace(/^CVC:/i, '');
  const parts = body.split('-').map((part) => part.trim()).filter(Boolean);
  let serie = '';
  let terminal = null;
  let numero = null;
  if (parts.length >= 3 && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[parts.length - 1])) {
    serie = parts[0];
    terminal = Number(parts[1]);
    numero = Number(parts[parts.length - 1]);
  } else if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    serie = parts[0];
    numero = Number(parts[1]);
  }
  return {
    pedidoId: pedido ? pedido[1] : null,
    serie,
    terminal,
    numero,
  };
}

function emptyIndex() {
  return {
    pedidoIds: new Set(),
    documents: new Set(),
    paidByDocument: new Map(),
  };
}

function addPaid(index, key, amount) {
  if (!key) return;
  const current = index.paidByDocument.get(key) || 0;
  index.paidByDocument.set(key, roundMoney(current + roundMoney(amount)));
}

function indexCommercialCollections({ cobros = [], pedidos = [] } = {}) {
  const index = emptyIndex();
  const paidByPedido = new Map();
  const paidByLooseDoc = new Map();

  for (const row of cobros) {
    const amount = roundMoney(row.IMPORTE ?? row.importe);
    if (amount <= 0) continue;
    const cliente = text(row.CLIENTE ?? row.CODIGO_CLIENTE);
    const parsed = parseCobroReference(row.REFERENCIA ?? row.referencia);
    if (parsed.pedidoId) {
      paidByPedido.set(
        parsed.pedidoId,
        roundMoney((paidByPedido.get(parsed.pedidoId) || 0) + amount),
      );
    }
    if (parsed.terminal != null && parsed.numero) {
      addPaid(
        { paidByDocument: paidByLooseDoc },
        documentIdentity(cliente, parsed.serie, parsed.terminal, parsed.numero),
        amount,
      );
    }
  }

  for (const [key, amount] of paidByLooseDoc) {
    index.paidByDocument.set(key, amount);
  }

  for (const row of pedidos) {
    const id = text(row.ID ?? row.id);
    const cliente = text(row.CLIENTE ?? row.CODIGOCLIENTE);
    const total = roundMoney(row.IMPORTE_TOTAL ?? row.IMPORTETOTAL);
    const marker = text(row.OBSERVACIONES).includes(COBRO_COMERCIAL_MARKER);
    const paid = roundMoney(paidByPedido.get(id) || 0);
    const covered = marker || paymentCovers(paid, total);
    if (!covered) continue;
    if (id) index.pedidoIds.add(id);
    const own = documentIdentity(
      cliente,
      row.SERIE ?? row.SERIEPEDIDO,
      row.TERMINAL ?? row.TERMINALPEDIDO,
      row.NUMERO ?? row.NUMEROPEDIDO,
    );
    const system = documentIdentity(
      cliente,
      row.SYSTEM_SERIE ?? row.SYSTEM_SERIEPEDIDO,
      row.SYSTEM_TERMINAL ?? row.SYSTEM_TERMINALPEDIDO,
      row.SYSTEM_NUMERO ?? row.SYSTEM_NUMEROPEDIDO,
    );
    if (own) index.documents.add(own);
    if (system && system !== own) index.documents.add(system);
  }

  return index;
}

function routeRowAmount(row) {
  const total = roundMoney(row?.IMPORTETOTAL ?? row?.IMPORTE ?? row?.CAC_IMPORTETOTAL);
  return total;
}

function shouldHideCommercialCollectedRow(row, index) {
  if (!row || !index) return false;
  if (text(row.OBSERVACIONES).includes(COBRO_COMERCIAL_MARKER)) return true;
  const token = text(row.COBRO_PROPIO_SN).toUpperCase();
  if (token === 'S' || token === 'SI' || token === 'TRUE' || token === '1') return true;
  const pedidoId = text(row.PEDIDO_ID);
  if (pedidoId && index.pedidoIds.has(pedidoId)) return true;
  const cliente = text(row.CLIENTE || row.codigoCliente);
  const keys = [
    documentIdentity(cliente, row.SERIEALBARAN, row.TERMINALALBARAN, row.NUMEROALBARAN),
    documentIdentity(cliente, row.SYSTEM_SERIE, row.SYSTEM_TERMINAL, row.SYSTEM_NUMERO),
  ].filter(Boolean);
  if (keys.some((key) => index.documents.has(key))) return true;
  const amount = routeRowAmount(row);
  return keys.some((key) => paymentCovers(index.paidByDocument.get(key), amount));
}

function tablesAllowed(pedidosTable, cobrosTable) {
  return ALLOWED_PAIRS[text(pedidosTable)] === text(cobrosTable);
}

async function loadCommercialCollectedIndex(queryWithParams, {
  clientCodes = [],
  pedidosTable,
  cobrosTable,
} = {}) {
  const clients = [...new Set(clientCodes.map(text).filter(Boolean))].slice(0, 200);
  if (!clients.length || typeof queryWithParams !== 'function') return emptyIndex();
  if (!tablesAllowed(pedidosTable, cobrosTable)) return emptyIndex();
  const placeholders = clients.map(() => '?').join(', ');
  const cobroRows = await queryWithParams(
    `SELECT TRIM(REFERENCIA) AS REFERENCIA,
            TRIM(CODIGO_CLIENTE) AS CLIENTE,
            COALESCE(SUM(IMPORTE), 0) AS IMPORTE
       FROM ${cobrosTable}
      WHERE IMPORTE > 0
        AND TRIM(CODIGO_CLIENTE) IN (${placeholders})
      GROUP BY TRIM(REFERENCIA), TRIM(CODIGO_CLIENTE)`,
    clients,
    false,
    false,
  );
  const pedidoIds = [...new Set(
    (cobroRows || [])
      .map((row) => parseCobroReference(row.REFERENCIA).pedidoId)
      .filter(Boolean),
  )].slice(0, 200);
  const markerClause = `LOCATE('${COBRO_COMERCIAL_MARKER}', COALESCE(OBSERVACIONES, '')) > 0`;
  const idClause = pedidoIds.length
    ? `OR ID IN (${pedidoIds.map(() => '?').join(', ')})`
    : '';
  const pedidoRows = await queryWithParams(
    `SELECT ID,
            TRIM(CODIGOCLIENTE) AS CLIENTE,
            COALESCE(IMPORTETOTAL, 0) AS IMPORTE_TOTAL,
            TRIM(SERIEPEDIDO) AS SERIE,
            COALESCE(TERMINAL, TERMINALPEDIDO, 0) AS TERMINAL,
            NUMEROPEDIDO AS NUMERO,
            TRIM(SYSTEM_SERIEPEDIDO) AS SYSTEM_SERIE,
            COALESCE(SYSTEM_TERMINALPEDIDO, 0) AS SYSTEM_TERMINAL,
            COALESCE(SYSTEM_NUMEROPEDIDO, 0) AS SYSTEM_NUMERO,
            COALESCE(OBSERVACIONES, '') AS OBSERVACIONES
       FROM ${pedidosTable}
      WHERE ESTADO IN ('CONFIRMADO', 'ENVIADO')
        AND TRIM(CODIGOCLIENTE) IN (${placeholders})
        AND (${markerClause} ${idClause})`,
    [...clients, ...pedidoIds.map((id) => Number(id))],
    false,
    false,
  );
  return indexCommercialCollections({
    cobros: cobroRows || [],
    pedidos: pedidoRows || [],
  });
}

module.exports = {
  COBRO_COMERCIAL_MARKER,
  documentIdentity,
  indexCommercialCollections,
  loadCommercialCollectedIndex,
  parseCobroReference,
  paymentCovers,
  shouldHideCommercialCollectedRow,
  tablesAllowed,
};
