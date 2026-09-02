const impl = require('./index');

module.exports = {
    createOrder: impl.createOrder,
    getOrders: impl.getOrders,
    getOrderDetail: impl.getOrderDetail,
    updateOrderLine: impl.updateOrderLine,
    deleteOrderLine: impl.deleteOrderLine,
    confirmOrder: impl.confirmOrder,
    updateOrderStatus: impl.updateOrderStatus,
    assertOrderEditable: impl.assertOrderEditable,
    isOrderTransitionAllowed: impl.isOrderTransitionAllowed,
    canonicalOrderStatus: impl.canonicalOrderStatus,
    storedOrderStatus: impl.storedOrderStatus,
    getOrderVendorForAuth: impl.getOrderVendorForAuth,
    getOrderAlbaran: impl.getOrderAlbaran,
    getBolsaMovementsForOrder: impl.getBolsaMovementsForOrder,
    getNextOrderNumber: impl.getNextOrderNumber,
    getDeliveryOptions: impl.getDeliveryOptions,
    getAvailableVehicles: impl.getAvailableVehicles,
    getDefaultTruckAssignment: impl.getDefaultTruckAssignment,
    getClientOrderDefaults: impl.getClientOrderDefaults,
};
