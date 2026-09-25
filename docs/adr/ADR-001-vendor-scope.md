# ADR-001 — Vendor-scope canonico

- Estado: Aceptada
- Fecha: 2026-09-25
- Modelo: Muse Spark 1.3 (maximo)
- Decisor: Javier
- Etiquetas: seguridad, vendor-scope, BOLA, ALL

## Contexto

Endpoints economicos filtraban por vendedor con logica dispersa. Riesgo BOLA:
devolver dinero/cobros/liquidacion de codigos fuera del alcance firmado del token.
Jefe_ventas trae JWT con ~80-90 comerciales; equipo 80 tiene 5 visibles.
`WHERE VENDEDOR='ALL'` literal seria fuga/incorrecto: ALL nunca es codigo real.
F2a unifico bolsa/cobros/liquidacion/clients/notifications bajo una sola regla.

## Decision

`backend/middleware/vendor-scope.js` es canonico y unico:

- `authorizeVendorScope` / `requireVendorQueryScope` / `resolveVendorScope`:
  unica puerta de alcance. `requestedCodes='ALL'` solo pasa con rol
  financiero (`ADMIN`, `JEFE_VENTAS` / `isJefeVentas`).
- `normalizeCode` + `userScopeCodes`: `ALL`/`UNK` jamas entran al set permitido.
- Manager sin visibles = catalogo: si `visibleCodes` cubre catalogo activo GMP
  (`visibleContainsCatalog`) o set amplio (`isCompanyWideVisibleSet`,
  `COMPANY_WIDE_SALES_VENDOR_MIN = 20`), resuelve a catalogo, no a 403.
- `ALL` literal solo en dos casos: contra catalogo cacheado 1h
  (`refreshActiveGmpVendorCatalog`, `CATALOG_TTL_MS`), o set >= 20
  (jefe_ventas con >= 20 vendedores no expande JWT a IN de ~80-94).
- F2a: `bolsa`, `cobros`, `comercial-liquidacion`, `clients`, `notifications`
  pasan por este middleware. Sin bypass.

## Consecuencias

Positivas:
- Una sola regla BOLA auditable; sin `WHERE VENDEDOR='ALL'`.
- JWT compacto para jefe_ventas; catalogo resuelto en servidor.
- Manager con equipo pequeno sigue viendo su equipo; manager amplio = catalogo.

Negativas / riesgos:
- Catalogo cacheado 1h: altas/bajas de vendedores tardan hasta 1h en reflejarse.
- `isSalesVendorCode` solo acepta 1-2 digitos: codigos futuros no numericos
  quedan fuera hasta ampliar el predicado.

## Evidencias

Ficheros (verificados con Glob esta sesion):
- `backend/middleware/vendor-scope.js` (canon, `COMPANY_WIDE_SALES_VENDOR_MIN = 20`,
  `visibleContainsCatalog`, `isCompanyWideVisibleSet`, `requireVendorQueryScope`)
- `backend/routes/bolsa.js` (F2a unificada)
- `backend/routes/cobros.js` (F2a unificada)
- `backend/routes/comercial-liquidacion.js` (F2a unificada)
- `backend/routes/clients.js` (F2a unificada)
- `backend/routes/notifications.js` (F2a unificada)
- `backend/routes/analytics.js` (`requireVendorQueryScope` en yoy/top-clients/trends)

Gates:
- Gate BOLA: `authorizeVendorScope` deniega `out_of_scope` con `denied[]`.
- Gate ALL: `all_requires_financial_role` sin rol financiero.
- Gate catalogo: TTL 1h + `salesVendorCodesFrom` filtra `ALL`/`UNK`.
