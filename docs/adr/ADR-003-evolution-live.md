# ADR-003 — Evolution live sin rollup snapshot

- Estado: Aceptada
- Fecha: 2026-09-25
- Modelo: Muse Spark 1.3 (maximo)
- Decisor: Javier
- Etiquetas: objectives, evolution, LACLAE, live, cache

## Contexto

`routes/objectives.js` servia evolucion con riesgo de mezclar snapshot mensual
(`JAVIER.LACLAE_MONTHLY`) con vivo, y queries por-vendedor (N scans LACLAE)
para alcances multi-vendor. El mes abierto quedaba congelado al snapshot.

## Decision

Evolution siempre live contra ERP, sin rollup snapshot:

- Sin `laclae-monthly` en la ruta de evolution: `JAVIER.LACLAE_MONTHLY`
  queda como util (`backend/services/laclae-monthly.js`) pero
  `fetchObjectiveEvolutionRows` no lo lee; agrega directo sobre
  `comercialErpTable('LACLAE')` con `LACLAE_SALES_FILTER`.
- `overlayOpenMonthFromLiveLaclae(rows, now, vendorCodes)`: refresca solo el
  mes abierto (ano/mes de `getCurrentDate()`) desde LACLAE vivo y lo fusiona
  (patch o push) sobre las filas agregadas.
- Version de cache `OBJECTIVES_CACHE_VERSION = 'v20260921-live-all-months'`;
  claves `obj:evolution:rows:<version>:ALL:<years>` y
  `obj:evolution:rows:<version>:<codes>:<years>` con TTL 600s.
- Agregado por alcance, no por vendedor: una sola query con
  `(LCMMDC < 3 AND LCCDVD IN (...)) OR (LCMMDC >= 3 AND R1_T8CDVD IN (...))`;
  `safeVendorCodes` sanitizados (`sanitizeForSQL`, mayusculas, <=2 chars,
  sin `UNK`); alcance vacio => `[]` con warn, nunca `WHERE VENDEDOR='ALL'`.
- Caso 1 vendedor delega a `fetchObjectiveEvolutionRowsByClientScope`.

## Consecuencias

Positivas:
- Mes abierto siempre vivo; historico y abierto coherentes.
- Un scan por alcance en vez de N scans; cache versionada invalida mezclas viejas.

Negativas / riesgos:
- TTL 600s: el mes abierto puede tardar hasta 10 min en reflejar el ERP.
- Sin snapshot: picos de carga van directos a LACLAE; `CircuitBreaker`
  `objectives-by-client` es el unico fusible.

## Evidencias

Ficheros (verificados con Glob esta sesion):
- `backend/routes/objectives.js` (`OBJECTIVES_CACHE_VERSION`,
  `overlayOpenMonthFromLiveLaclae`, `fetchObjectiveEvolutionRows`,
  filtro `LCMMDC < 3 LCCDVD / >= 3 R1_T8CDVD`, `redisCache.set(...600)`)
- `backend/services/laclae-monthly.js` (rollup `JAVIER.LACLAE_MONTHLY`, no usado
  en evolution)
- `backend/services/laclae.js` (cache de clientes, no snapshot de evolution)
- `backend/services/evolution.service.js` (servicio evolution)
- `backend/routes/evolution.js` (ruta evolution)
- `backend/services/redis-cache.js` (capa `route` usada por evolution)

Gates:
- Gate live: evolution responde sin leer `LACLAE_MONTHLY` (grep ruta = 0 hits).
- Gate overlay: mes abierto fusionado con `SALES/COST/CLIENTS` vivos.
- Gate alcance: `ALL` sin `VENDEDOR='ALL'`; vacio => `[]` + warn.
