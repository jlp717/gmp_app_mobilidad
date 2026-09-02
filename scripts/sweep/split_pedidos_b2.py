"""Facade-split pedidos.service.js into pedidos/{catalog,write,analytics,search}."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend/services/pedidos.service.js"
DEST_DIR = ROOT / "backend/services/pedidos"
IMPL = DEST_DIR / "index.js"

GROUPS = {
    "search.js": [
        "searchProducts",
        "searchProductsWithStock",
        "getSimilarProducts",
        "getComplementaryProducts",
    ],
    "catalog.js": [
        "getProducts",
        "getProductDetail",
        "getProductDetailRaw",
        "getStock",
        "getStockBatch",
        "getProductStock",
        "getFamilies",
        "getFamiliesDetailed",
        "getBrands",
        "getProductFamilies",
        "getProductBrands",
        "getActivePromotions",
        "getActivePromotionsPMR",
        "getActivePromotionsV2",
        "getClientTariffsForLines",
        "getArticleIvaCodesForLines",
        "applyConfiguredPricingToProduct",
        "applyConfiguredPricingToProducts",
        "effectiveMinPriceFromRow",
    ],
    "write.js": [
        "createOrder",
        "getOrders",
        "getOrderDetail",
        "updateOrderLine",
        "deleteOrderLine",
        "confirmOrder",
        "updateOrderStatus",
        "assertOrderEditable",
        "isOrderTransitionAllowed",
        "canonicalOrderStatus",
        "storedOrderStatus",
        "getOrderVendorForAuth",
        "getOrderAlbaran",
        "getBolsaMovementsForOrder",
        "getNextOrderNumber",
        "getDeliveryOptions",
        "getAvailableVehicles",
        "getDefaultTruckAssignment",
        "getClientOrderDefaults",
    ],
    "analytics.js": [
        "getOrderStats",
        "getOrderAnalytics",
        "getProductHistory",
        "getRecommendations",
        "getClientBalance",
        "getClientPricing",
    ],
}


def rewrite_requires(text: str) -> str:
    text = text.replace("require('../", "require('../../")
    text = text.replace("require('./", "require('../")
    text = text.replace("require('../../query-optimizer')", "require('../query-optimizer')")
    text = text.replace("require('../../redis-cache')", "require('../redis-cache')")
    return text


def main() -> None:
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    original = SRC.read_text(encoding="utf-8")
    impl_text = rewrite_requires(original)
    IMPL.write_text(impl_text, encoding="utf-8")

    export_match = re.search(r"module\.exports\s*=\s*\{([\s\S]*?)\};", original)
    exported = []
    if export_match:
        exported = re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*,", export_match.group(1))
        exported += re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*$", export_match.group(1), re.M)

    grouped = set()
    for filename, names in GROUPS.items():
        grouped.update(names)
        body = "const impl = require('./index');\n\nmodule.exports = {\n"
        body += "".join(f"    {name}: impl.{name},\n" for name in names)
        body += "};\n"
        (DEST_DIR / filename).write_text(body, encoding="utf-8")

    leftover = [name for name in exported if name not in grouped and name != "_private"]
    leftover_body = "const impl = require('./index');\n\nmodule.exports = {\n"
    leftover_body += "".join(f"    {name}: impl.{name},\n" for name in leftover)
    leftover_body += "    _private: impl._private,\n};\n"
    (DEST_DIR / "shared.js").write_text(leftover_body, encoding="utf-8")

    facade = """'use strict';

const search = require('./pedidos/search');
const catalog = require('./pedidos/catalog');
const write = require('./pedidos/write');
const analytics = require('./pedidos/analytics');
const shared = require('./pedidos/shared');

module.exports = {
    ...search,
    ...catalog,
    ...write,
    ...analytics,
    ...shared,
};
"""
    SRC.write_text(facade, encoding="utf-8")
    print("pedidos.service.js lines", len(facade.splitlines()))
    print("impl lines", len(impl_text.splitlines()))


if __name__ == "__main__":
    main()
