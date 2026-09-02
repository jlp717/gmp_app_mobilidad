const impl = require('./index');

module.exports = {
    getOrderStats: impl.getOrderStats,
    getOrderAnalytics: impl.getOrderAnalytics,
    getProductHistory: impl.getProductHistory,
    getRecommendations: impl.getRecommendations,
    getClientBalance: impl.getClientBalance,
    getClientPricing: impl.getClientPricing,
};
