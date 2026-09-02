const impl = require('./index');

module.exports = {
    searchProducts: impl.searchProducts,
    searchProductsWithStock: impl.searchProductsWithStock,
    getSimilarProducts: impl.getSimilarProducts,
    getComplementaryProducts: impl.getComplementaryProducts,
};
