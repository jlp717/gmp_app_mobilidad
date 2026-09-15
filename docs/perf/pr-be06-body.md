## Summary

- Slim `/entregas/pendientes` list JSON: IVA/bases (`netoSum`, `ivaSum`, `ivaBreakdown`, `checksum`) stay off the list unless `SHOW_IVA_BREAKDOWN=true`. Detail `/albaran` still returns the tax stack. Collectable amounts stay CPC-capped (`importe` / `importeDisponibleCobro` unchanged).
- Replace `SELECT * FROM ranked_deliveries` with an explicit column list. Tax columns remain in the CTE so `resolveDeliveryAmount` / LAC-skip keep the same money path.
- Slim `/rutero/day` clients: drop duplicate `phone`/`phone2`/`observationBy`; keep `phones[]`, `status`, `orderStatus` (Flutter list).
- Raise default `MAX_ETAG_ARRAY_ITEMS` 200 → 1000 so JEFE day lists (~201+) can still 304.

## Test plan

- [x] `cd backend && npx jest --forceExit --no-coverage` entregas-contract-hardening, entregas-route-gap-coverage, planner-rutero-day, http-cache-middleware (4 suites / 79 tests, exit 0)
- [ ] `flutter test test/features/entregas test/features/repartidor` (list `fromJson` already treats IVA as optional)
- [ ] Do not merge / deploy from this PR

## Money invariants (BE-06)

- Saldo cobrable = documento CPC, no deuda CVC del cliente.
- Liquidación no se genera sin cobros del periodo (untouched).
- List importe still comes from `resolveDeliveryAmount` (CPC total → CAC → tax stack).
