const impl = require('./index');

module.exports = {
    getProducts: impl.getProducts,
    getProductDetail: impl.getProductDetail,
    getProductDetailRaw: impl.getProductDetailRaw,
    getStock: impl.getStock,
    getStockBatch: impl.getStockBatch,
    getProductStock: impl.getProductStock,
    getFamilies: impl.getFamilies,
    getFamiliesDetailed: impl.getFamiliesDetailed,
    getBrands: impl.getBrands,
    getProductFamilies: impl.getProductFamilies,
    getProductBrands: impl.getProductBrands,
    getActivePromotions: impl.getActivePromotions,
    getActivePromotionsPMR: impl.getActivePromotionsPMR,
    getActivePromotionsV2: impl.getActivePromotionsV2,
    getClientTariffsForLines: impl.getClientTariffsForLines,
    getArticleIvaCodesForLines: impl.getArticleIvaCodesForLines,
    applyConfiguredPricingToProduct: impl.applyConfiguredPricingToProduct,
    applyConfiguredPricingToProducts: impl.applyConfiguredPricingToProducts,
    effectiveMinPriceFromRow: impl.effectiveMinPriceFromRow,
};
