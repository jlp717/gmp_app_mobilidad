// promotions.js — fachada compat del split (L8b):
// re-exporta promotions-v1 + promotions-v2.
// Sin cambios de comportamiento: mismas referencias (index.js la consume igual).
module.exports = {
    ...require('./promotions-v1'),
    ...require('./promotions-v2'),
};
