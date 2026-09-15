## Summary

- `/matrix-data` reads `DSED.LACLAE` with `LACLAE_SALES_FILTER` (no correlated `EXISTS` to CAC per LAC row). Cache key bumped to `dashboard:matrix:v5`.
- `/sales-history` uses sargable ANO/MES/DIA bounds and `authorizeVendorScope` (COMERCIAL cannot query `ALL`). Cache key `analytics:sales-history:v2`.
- Totals now follow the same LACLAE sales filter as the rest of the dashboard; live 3-vendor comparison is BLOCKED until the tunnel answers.

## Test plan

- [x] `cd backend && npx jest --forceExit --no-coverage` dashboard-matrix-month-contract, dashboard-filters, analytics-sales-history, sargable-document-date
- [ ] Tunnel re-probe of `/matrix-data` (967 ms baseline) — document if unreachable
- [ ] Do not merge / deploy from this PR
