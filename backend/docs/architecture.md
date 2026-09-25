# Arquitectura backend — DDD canónico (2026-09-25)

> DDD (`backend/src/modules` + `backend/src/core`) es único soportado desde 2026-09-25. No añadir rutas bajo `backend/routes/` o `backend/src/routes/`; todo desarrollo nuevo va en `backend/src/modules/<dominio>/` reutilizando `backend/src/core` (application/domain/infrastructure). `backend/README.md` líneas 11-14 queda desactualizado donde dice "19 routers": el conteo real verificado es 33 legacy / 22 `src/routes` / 19 `modules` / 14 `backend/middleware` / 6 `src/middleware` / parity 1.

## Inventario verificado (solo lectura, rama `test` @ `7239f17`)

- `backend/routes/*.js`: 33 ficheros legacy (directorio contiene además `auth.ts` + `repartidor-finanzas.js.tmp2` = 35 entradas totales, fuera de conteo canónico).
- `backend/src/routes`: 22 ficheros (mezcla `.ts`/`.js`, incluye duplicados `dashboard.routes.js/.ts` y `planner.routes.js` sin `.ts`).
- `backend/src/modules`: 19 dominios (analytics, auth, chatbot, clients, cobros, commissions, dashboard, entregas, export, facturas, filters, kpi-alerts, master, objectives, pedidos, planner, repartidor, rutero, warehouse).
- `backend/middleware`: 14 ficheros — middleware canónico legacy (auth JWT, rate-limit, prometheus, http-cache, seguridad).
- `backend/src/middleware`: 6 ficheros `.ts` (capa TS, no canónica en runtime actual).
- `backend/src/core/{application,domain,infrastructure}`: base DDD compartida.
- `backend/docs/`: antes 4 ficheros (`PRODUCTION_CHECKLIST.md`, `recommended-indices.sql`, `testing-setup.md`, `VENTAS_B_documentacion.md`); este `architecture.md` es el quinto y el único normativo DDD.

## Reglas (WS2 DDD-CONSOLIDATION-001-FINAL — archive total autorizado Javier 100%, supera nota docs-only previa)

1. Legacy `backend/routes/` congelado: parity 1/33, sin nuevas rutas ni migraciones sin autorización de Javier.
2. TS archivado WS2 (2026-09-25, test @ 7239f17): `backend/src/routes/` 22 ficheros + `src/server.ts` + `src/index.ts` movidos a `backend/docs/archive/ts-routes-7239f17/` (mv fisico pendiente shell; referencias vivas eliminadas en app.js/ecosystem/contract-parity). `USE_TS_ROUTES` retirado; modo 'typescript' muerto eliminado de reparto-runtime (validacion fail-closed conserva rechazo de true). No reintroducir familia TS.
3. Middleware canónico es `backend/middleware` (legacy en producción); `src/middleware` es referencia TS no activa.
4. `REPARTO_*/REPARTIDOR_*`, DB2 y producción fuera de alcance de este workstream (verificado: sin diff REPARTO en WS2).
