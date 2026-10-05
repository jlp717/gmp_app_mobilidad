'use strict';

function text(value) {
  return String(value ?? '').trim();
}

function routeDocumentId(row) {
  const cliente = text(row?.CLIENTE || row?.codigoCliente);
  const serie = text(row?.SERIEALBARAN || row?.serie);
  const ejercicio = row?.EJERCICIOALBARAN ?? row?.ejercicio;
  const terminal = row?.TERMINALALBARAN ?? row?.terminal;
  const numero = row?.NUMEROALBARAN ?? row?.numero;
  return `${ejercicio}-${serie}-${terminal}-${numero}-${cliente}`;
}

function syncedRouteId(row) {
  const numero = Number(row?.SYSTEM_NUMERO || row?.SYSTEM_NUMEROPEDIDO || 0);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  const cliente = text(row?.CLIENTE || row?.codigoCliente);
  const serie = text(row?.SYSTEM_SERIE || row?.SYSTEM_SERIEPEDIDO);
  const ejercicio = row?.SYSTEM_EJERCICIO || row?.SYSTEM_EJERCICIOPEDIDO;
  const terminal = row?.SYSTEM_TERMINAL || row?.SYSTEM_TERMINALPEDIDO;
  return `${ejercicio}-${serie}-${terminal}-${numero}-${cliente}`;
}

/**
 * A confirmed commercial order is a second pending stop when the same
 * document is already on the DSEDAC route. A cobro en mano still belongs
 * on the driver's route as a delivery; the collection flag is applied later.
 * Rows without a driver are not route stops.
 */
function shouldKeepAnteroomPedido(row, existingIds) {
  const ids = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  const driver = text(row?.CODIGO_REPARTIDOR);
  if (!driver) return false;
  if (ids.has(routeDocumentId(row))) return false;
  const synced = syncedRouteId(row);
  if (synced && ids.has(synced)) return false;
  return true;
}

module.exports = {
  routeDocumentId,
  shouldKeepAnteroomPedido,
  syncedRouteId,
};
