'use strict';

/**
 * Drop diagnostic duplicates from ALL/grouped commission summaries.
 * Money fields (actual, target, complianceCtx.commission, payments) stay.
 */
function slimMonthForWire(month) {
  if (!month || typeof month !== 'object') return month;
  const {
    liveMetrics,
    historicalSnapshot,
    paymentSnapshot,
    ...kept
  } = month;
  return kept;
}

function slimVendorForWire(vendor) {
  if (!vendor || typeof vendor !== 'object') return vendor;
  return {
    vendedorCode: vendor.vendedorCode,
    vendorName: vendor.vendorName,
    grandTotalCommission: vendor.grandTotalCommission,
    isExcluded: vendor.isExcluded,
    payments: vendor.payments,
    quarters: vendor.quarters,
    months: Array.isArray(vendor.months)
      ? vendor.months.map(slimMonthForWire)
      : vendor.months,
  };
}

function slimGroupedSummaryForWire(result) {
  if (!result || typeof result !== 'object') return result;
  if (!Array.isArray(result.breakdown)) return result;
  return {
    ...result,
    breakdown: result.breakdown.map(slimVendorForWire),
    months: Array.isArray(result.months)
      ? result.months.map(slimMonthForWire)
      : result.months,
  };
}

module.exports = {
  slimMonthForWire,
  slimVendorForWire,
  slimGroupedSummaryForWire,
};
