// similarity.js — fachada compat del split (L8b):
// re-exporta similarity-essence + similarity-products.
// Sin cambios de comportamiento: mismas referencias (index.js la consume igual).
module.exports = {
    ...require('./similarity-essence'),
    ...require('./similarity-products'),
};
