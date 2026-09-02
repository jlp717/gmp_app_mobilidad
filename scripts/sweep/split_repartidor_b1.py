"""Extract shared repartidor helpers so repartidor.js stays under 1800 LOC."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend/routes/repartidor.js"
CONTEXT = ROOT / "backend/routes/repartidor-route-context.js"
HISTORY = ROOT / "backend/routes/repartidor-history-routes.js"
DOCUMENTS = ROOT / "backend/routes/repartidor-document-routes.js"

lines = SRC.read_text(encoding="utf-8").splitlines(keepends=True)

# 1-indexed inclusive ranges from the live file.
HELPER_START, HELPER_END = 81, 424
HISTORY_START, HISTORY_END = 696, 1860
DOCS_START, DOCS_END = 2314, len(lines)

imports = "".join(lines[:80])
helpers = "".join(lines[HELPER_START - 1:HELPER_END])
history = "".join(lines[HISTORY_START - 1:HISTORY_END])
documents = "".join(line for line in lines[DOCS_START - 1:DOCS_END] if not line.startswith("module.exports"))

context_exports = [
    "configureRepartidorPdfTimeout",
    "normalizedRole",
    "isRepartoPrivileged",
    "canonicalRepartidorCode",
    "authorizeSingleRepartidorId",
    "sendRouteError",
    "parseBoundedInt",
    "parseRuteroOrigin",
    "parseRuteroDepartureMinute",
    "parseIsoDate",
    "parsePagination",
    "authorizedRepartidorIds",
    "parseAlbaranOwnershipKey",
    "parseInvoiceOwnershipKey",
    "resolveAlbaranOwners",
    "resolveInvoiceOwners",
    "resolveDeliveryOwners",
    "rawRepartidorId",
    "hintedRepartidorId",
    "uniqueActorCodes",
    "normalizeVendorCode",
    "actorVendorCodes",
    "vendorCodesIntersect",
    "authorizeResolvedOwner",
    "documentOwnershipGuard",
    "prevalidateStrictDocumentOwner",
    "strictRepartoDocumentOwner",
    "albaranQueryOwnership",
    "albaranParamOwnership",
    "invoiceParamOwnership",
    "documentBodyOwnership",
    "validateDocumentEmailRequest",
    "deliveryOwnership",
    "legacySignatureOwnership",
    "canonicalRepartoMutationRequired",
]

CONTEXT.write_text(
    imports
    + helpers
    + "\nmodule.exports = {\n"
    + "".join(f"    {name},\n" for name in context_exports)
    + "};\n",
    encoding="utf-8",
)

destructure = ",\n    ".join(context_exports)
require_block = (
    "const {\n    "
    + destructure
    + "\n} = require('./repartidor-route-context');\n"
)

HISTORY.write_text(
    imports
    + require_block
    + "\nfunction mountRepartidorHistoryRoutes(router) {\n"
    + history
    + "\n}\n\nmodule.exports = { mountRepartidorHistoryRoutes };\n",
    encoding="utf-8",
)

DOCUMENTS.write_text(
    imports
    + require_block
    + "\nfunction mountRepartidorDocumentRoutes(router) {\n"
    + documents
    + "\n}\n\nmodule.exports = { mountRepartidorDocumentRoutes };\n",
    encoding="utf-8",
)

kept = (
    lines[:80]
    + [require_block + "\n"]
    + [
        "const { mountRepartidorHistoryRoutes } = require('./repartidor-history-routes');\n",
        "const { mountRepartidorDocumentRoutes } = require('./repartidor-document-routes');\n",
        "\n",
    ]
    + lines[424:695]
    + ["\nmountRepartidorHistoryRoutes(router);\n"]
    + lines[1860:2313]
    + ["\nmountRepartidorDocumentRoutes(router);\n"]
    + [
        "\nmodule.exports = router;\n",
        "module.exports.repartidorBreaker = repartidorBreaker;\n",
    ]
)

SRC.write_text("".join(kept), encoding="utf-8")
print("repartidor.js lines", len("".join(kept).splitlines()))
print("context lines", len(CONTEXT.read_text(encoding="utf-8").splitlines()))
print("history lines", len(HISTORY.read_text(encoding="utf-8").splitlines()))
print("documents lines", len(DOCUMENTS.read_text(encoding="utf-8").splitlines()))
