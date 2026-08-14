'use strict';

function isErpYesFlag(value) {
  return String(value || '').trim().toUpperCase() === 'S';
}

function mobilityFlagsFromRow(row = {}) {
  return {
    permitePreventa: isErpYesFlag(row.PREVENTISTA_SN ?? row.PERMITEPREVENTASN),
    permiteReparto: isErpYesFlag(row.REPARTIDOR_SN ?? row.PERMITEREPARTOSN),
    isJefeVentas: isErpYesFlag(row.JEFE_SN ?? row.JEFEVENTASSN),
  };
}

function defaultMobilityRole(flags = {}) {
  if (flags.isJefeVentas) return 'JEFE_VENTAS';
  if (flags.permiteReparto && !flags.permitePreventa) return 'REPARTIDOR';
  return 'COMERCIAL';
}

module.exports = {
  isErpYesFlag,
  mobilityFlagsFromRow,
  defaultMobilityRole,
};
