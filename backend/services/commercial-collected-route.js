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
    paidByPedido: new Map(),
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
  index.paidByPedido = paidByPedido;

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

function rowMarkedCollected(row) {
  if (text(row?.OBSERVACIONES).includes(COBRO_COMERCIAL_MARKER)) return true;
  const token = text(row?.COBRO_PROPIO_SN).toUpperCase();
  return token === 'S' || token === 'SI' || token === 'TRUE' || token === '1';
}

function documentKeysForRow(row) {
  const cliente = text(row?.CLIENTE || row?.codigoCliente || row?.CODIGOCLIENTEALBARAN);
  return [
    documentIdentity(
      cliente,
      row?.SERIEALBARAN ?? row?.serieDocumento ?? row?.SERIEDOCUMENTO,
      row?.TERMINALALBARAN ?? row?.terminalDocumento ?? row?.TERMINALDOCUMENTO,
      row?.NUMEROALBARAN ?? row?.numeroDocumento ?? row?.NUMERODOCUMENTO,
    ),
    documentIdentity(cliente, row?.SYSTEM_SERIE, row?.SYSTEM_TERMINAL, row?.SYSTEM_NUMERO),
  ].filter(Boolean);
}

/**
 * A commercial collection covers the delivery stop's cobro, or only part of it.
 * It never decides whether the stop itself is shown.
 */
function commercialCollectionStatus(row, index) {
  const amount = routeRowAmount(row);
  if (!row || !index) {
    return { covered: false, paid: 0, partial: false, amount };
  }
  const keys = documentKeysForRow(row);
  let paid = 0;
  for (const key of keys) {
    paid = Math.max(paid, roundMoney(index.paidByDocument.get(key) || 0));
  }
  const pedidoId = text(row.PEDIDO_ID ?? row.pedidoId);
  if (pedidoId && index.paidByPedido) {
    paid = Math.max(paid, roundMoney(index.paidByPedido.get(pedidoId) || 0));
  }
  const covered = rowMarkedCollected(row)
    || (pedidoId && index.pedidoIds.has(pedidoId))
    || keys.some((key) => index.documents.has(key))
    || paymentCovers(paid, amount);
  if (covered) {
    return {
      covered: true,
      paid: Math.max(paid, amount),
      partial: false,
      amount,
    };
  }
  if (paid > 0.004) {
    return { covered: false, paid, partial: true, amount };
  }
  return { covered: false, paid: 0, partial: false, amount };
}

function applyCommercialCollectionToRouteItem(item, status) {
  if (!item || !status || (!status.covered && !(status.paid > 0.004))) return item;
  const document = roundMoney(item.importe ?? item.amount);
  const driverPaid = roundMoney(item.importeCobrado);
  const commercialPaid = status.covered
    ? Math.max(roundMoney(status.paid), Math.max(roundMoney(document - driverPaid), 0))
    : roundMoney(status.paid);
  const totalPaid = status.covered
    ? Math.max(document, roundMoney(driverPaid + commercialPaid))
    : roundMoney(Math.min(document, driverPaid + commercialPaid));
  const remaining = roundMoney(Math.max(document - totalPaid, 0));
  if (status.covered || remaining <= 0.004) {
    return {
      ...item,
      cobrado: true,
      cobradoPorComercial: true,
      importeCobrado: roundMoney(Math.max(totalPaid, document)),
      importePendienteCobro: 0,
      importeDisponibleCobro: 0,
      puedeCobrarse: false,
      cobroParcial: false,
      cobroDocumentoEstado: 'YA_COBRADO',
      saldoMotivo: 'Ya está cobrado',
    };
  }
  return {
    ...item,
    cobrado: totalPaid > 0.004,
    cobradoPorComercial: false,
    importeCobrado: totalPaid,
    importePendienteCobro: remaining,
    importeDisponibleCobro: remaining,
    puedeCobrarse: true,
    cobroParcial: true,
    cobroDocumentoEstado: 'AVAILABLE',
    saldoMotivo: null,
  };
}

function vencimientoRow(item) {
  const keys = item?.keys || {};
  return {
    CLIENTE: item?.codigoCliente,
    SERIEALBARAN: keys.serieDocumento,
    TERMINALALBARAN: keys.terminalDocumento,
    NUMEROALBARAN: keys.numeroDocumento,
    IMPORTETOTAL: item?.importe,
  };
}

function applyCommercialCollectionToVencimiento(item, index) {
  if (!item) return item;
  const status = commercialCollectionStatus(vencimientoRow(item), index);
  if (!status.covered && !(status.paid > 0.004)) return item;
  const remaining = status.covered
    ? 0
    : roundMoney(Math.max(roundMoney(item.importePendiente) - status.paid, 0));
  if (status.covered || remaining <= 0.004) {
    return {
      ...item,
      importePendiente: 0,
      cobradoPorComercial: true,
    };
  }
  return {
    ...item,
    importePendiente: remaining,
    cobradoPorComercial: false,
  };
}

function historyParts(document) {
  if (Array.isArray(document?.albaranes) && document.albaranes.length) {
    return document.albaranes.map((part) => ({
      serie: part.serie,
      terminal: part.terminal,
      numero: part.numero,
      amount: part.amount,
    }));
  }
  return [{
    serie: document?.serie,
    terminal: document?.terminal,
    numero: document?.albaranNumber || document?.number,
    amount: document?.amount,
  }];
}

function applyCommercialCollectionToHistoryDocument(document, cliente, index) {
  if (!document || !index) return document;
  const parts = historyParts(document);
  let paid = 0;
  let coveredParts = 0;
  for (const part of parts) {
    const partAmount = roundMoney(part.amount || document.amount);
    const status = commercialCollectionStatus({
      CLIENTE: cliente,
      SERIEALBARAN: part.serie,
      TERMINALALBARAN: part.terminal,
      NUMEROALBARAN: part.numero,
      IMPORTETOTAL: partAmount,
    }, index);
    if (status.covered) {
      coveredParts += 1;
      paid = roundMoney(paid + Math.max(status.paid, partAmount));
    } else {
      paid = roundMoney(paid + status.paid);
    }
  }
  const documentAmount = roundMoney(document.amount);
  const covered = parts.length > 0 && coveredParts === parts.length;
  const commercialPaid = covered ? Math.max(paid, documentAmount) : paid;
  if (!covered && commercialPaid <= 0.004) return document;
  const next = applyCommercialCollectionToRouteItem({
    ...document,
    importe: documentAmount,
    importeCobrado: document.importeCobrado,
  }, {
    covered,
    paid: commercialPaid,
  });
  return {
    ...next,
    pending: next.cobradoPorComercial ? 0 : next.importePendienteCobro,
  };
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
  applyCommercialCollectionToHistoryDocument,
  applyCommercialCollectionToRouteItem,
  applyCommercialCollectionToVencimiento,
  commercialCollectionStatus,
  documentIdentity,
  indexCommercialCollections,
  loadCommercialCollectedIndex,
  parseCobroReference,
  paymentCovers,
  tablesAllowed,
};
