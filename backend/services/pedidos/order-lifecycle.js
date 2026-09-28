// order-lifecycle.js — fachada compat del split (lote 2026-09-28 + L8b):
// re-exporta order-idempotency + order-states + order-drafts.
// Sin cambios de comportamiento: mismas referencias (index.js la consume igual).
module.exports = {
    ...require('./order-idempotency'),
    ...require('./order-states'),
    ...require('./order-drafts'),
};
